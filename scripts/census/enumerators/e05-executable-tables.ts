/**
 * E05 — executable static tables (plan 4.5). Reads the Workbench executable
 * (`<tools>/Workbench/ArmaReforgerWorkbenchSteamDiag.exe`) as bytes with
 * `readFileSync`; it never runs it. Writes derived rows to
 * `data/census/observations/E05/<build>.jsonl` and the raw intermediate tables
 * to the artifacts folder (`<artifacts>/census/<build>/E05/`, plan 4.2,
 * decision D2: executable-derived label tables stay local).
 *
 * What is emitted, and by which method (the methods live in
 * `src/census/exe-tables.ts`):
 *
 *   cli-switch     `-name` literals and argument-marked `-name` tokens in prose
 *                  (`.rdata`, NUL-bounded, 4-byte aligned). Root rows. A prose
 *                  row is confidence high (its string states the argument
 *                  role); a bare literal is medium (the role is read from form).
 *   net-function   the leading verb-led identifiers of the NET dispatcher's
 *                  string block (anchor `Parameter %s required`). Root rows,
 *                  confidence medium: the role is read from position and shape.
 *   module         an rcc directory `:/Workbench/<Module>` whose name is one of
 *                  the 11 Workbench modules. Root rows.
 *   dock, toolbar  the object names in each module's default layout resource
 *                  (`:/Workbench/<Module>/*.gs`, a QMainWindow::saveState
 *                  stream); parent = that module row.
 *                  Object names with plain spaces (`Animation Sets`) are
 *                  emitted; the id form escapes the space.
 *   dialog         RTTI classes deriving from QDialog (Qt's own excluded).
 *   window         RTTI classes deriving from QMainWindow that are not
 *                  WBModule classes (Qt's own excluded).
 *   cli-switch and net-function rows carry module `none`, as every other
 *   enumerator of those dims does (no module owns a switch or a native).
 *   Dialog and window rows: the module is the one the binary shows (a full
 *   module name prefixes the class name, or a module class shares the class's
 *   namespace), else `none` ("this source does not say") with the statement
 *   `owning module not shown by the executable` under `unverified`; those
 *   rows are the residue the live dialog census must locate. A module-less
 *   class is keyed by its class name as a Qt object name when the binary
 *   passes that name to `QObject::setObjectName` (`setObjectNameLiterals`),
 *   otherwise by the path `[<qualified class name>]`. Confidence medium (the
 *   base class is stated by RTTI; the module or the object name is read from
 *   a name or a call site). They carry no parent: the binary does not show
 *   which window opens a dialog.
 *
 * Left out, and counted (the raw tables stay in the artifacts folder):
 * intermediate dialog / window base classes, labels with a mnemonic,
 * default-shortcut literals, action / menu / dock object names that no layout
 * places in a module, QDockWidget and WBModule classes outside the
 * vocabulary, option classes (`*OptionsClass`: their names and the strings
 * beside them go to `options-strings.tsv` for the Options census), settings
 * key names, status-bar items and property-editor kinds (no container or no
 * delimiting structure in the binary).
 *
 *   npx tsx scripts/census/enumerators/e05-executable-tables.ts [--exe <file>] [--build <tag>]
 *       [--out <file under observations/E05/>] [--artifacts <dir> | --no-artifacts] [--data <dir>] [--json]
 *
 * Exit: 0 written; 1 refused (output outside observations/E05/); 2 usage or
 * no executable (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../../../src/config.js";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import {
  OBJECT_NAME_CANDIDATE,
  SHORTCUT_LITERAL,
  asciiStrings,
  demangleTypeName,
  extractNetBlock,
  findRccBundles,
  lowerAscii,
  parseMainWindowState,
  parseRtti,
  peSections,
  searchBytes,
  sectionRange,
  selectSwitches,
  setObjectNameLiterals,
  stringRunAfter,
  switchCandidates,
  type FoundString,
  type LayoutEntry,
  type NetBlock,
  type ObjectNameScan,
  type RccBundle,
  type RttiClass,
  type SearchHits,
  type SwitchCandidate,
  type TypeName,
} from "../../../src/census/exe-tables.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import { MODULES, type Module } from "../../../src/census/vocab.js";
import { artifactsDir, insideGitWorkTree } from "../../live/paths.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "../cli-common.js";

/** Enumerator id. */
export const ENUMERATOR_ID = "E05";
/** Registered generator path (universes.json `enumerators.E05.generator`). */
export const GENERATOR = "scripts/census/enumerators/e05-executable-tables.ts";
/** File name of the executable under `<tools>/Workbench/`. */
export const EXE_NAME = "ArmaReforgerWorkbenchSteamDiag.exe";
const QUOTE_MAX = 200;

/** The 11 Workbench modules of the vocabulary (no sub-editors, no pseudo-modules). */
export const WB_MODULES: readonly Module[] = MODULES.filter(
  (m) => !m.includes(".") && !["Launcher", "Shared", "BlenderTools", "none"].includes(m),
);

/** Strings whose presence or absence the plan asks about (plan 2.1 findings 1 and 2). */
export const PROBE_STRINGS: readonly string[] = [
  "-wbProjectPath",
  "wbProjectPath",
  "-gproj",
  "EvaluateScript",
  "ReturnValue",
];

// ── Extraction ────────────────────────────────────────────────────────────────

export interface LayoutTable {
  module: Module;
  path: string;
  payload: number;
  size: number;
  entries: LayoutEntry[];
}

export interface Extraction {
  size: number;
  sha256: string;
  rdata: { lo: number; hi: number };
  strings: FoundString[];
  switches: SwitchCandidate[];
  switchCandidates: SwitchCandidate[];
  net: NetBlock;
  rcc: RccBundle[];
  moduleDirs: { module: Module; offset: number; path: string }[];
  layouts: LayoutTable[];
  /** Layout entries collapsed into an earlier entry of the same path (see `collapseRepeatedLayouts`). */
  repeatedLayouts: RepeatedLayout[];
  rtti: RttiClass[];
  /** Literals passed to QObject::setObjectName. */
  objectNames: ObjectNameScan;
  /** Every NUL-bounded `.rdata` occurrence of each `*OptionsClass` name, with the strings beside it. */
  optionRuns: OptionRun[];
  probes: Record<string, { exact: SearchHits; caseInsensitive: SearchHits }>;
}

export interface OptionRun {
  /** Unqualified class name, `WorkbenchOptionsClass`. */
  className: string;
  /** Offset of the RTTI type descriptor name. */
  rttiOffset: number;
  /** Offset of the `.rdata` literal holding the class name. */
  offset: number;
  strings: FoundString[];
}

/** An identifier-shaped string (a property-name candidate; never a description or a value). */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The `*OptionsClass` RTTI classes and the string run after each `.rdata` occurrence of their name. */
export function optionRuns(
  buf: Buffer,
  rdata: { lo: number; hi: number },
  rtti: readonly RttiClass[],
): OptionRun[] {
  const out: OptionRun[] = [];
  for (const c of rtti) {
    const t = demangleTypeName(c.mangled);
    if (!t || !/OptionsClass$/.test(t.name)) continue;
    const needle = Buffer.from(`\0${t.name}\0`, "latin1");
    for (
      let i = buf.indexOf(needle, rdata.lo);
      i !== -1 && i < rdata.hi;
      i = buf.indexOf(needle, i + 1)
    ) {
      out.push({
        className: t.name,
        rttiOffset: c.offset,
        offset: i + 1,
        strings: stringRunAfter(buf, i + 1, rdata),
      });
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.className, b.className) || a.offset - b.offset);
}

/** A layout entry that repeats an earlier entry's path with the same bytes. */
export interface RepeatedLayout {
  path: string;
  /** Payload offset of the repeat. */
  payload: number;
  /** Payload offset of the entry kept. */
  keptPayload: number;
}

/**
 * One layout per resource path. The rcc tree of build 1.9.0.37 lists
 * `:/Workbench/DialogueEditor/edit.gs` twice: two file nodes with the same
 * name, each with its own payload, and the two payloads are byte-identical.
 * Qt's resource lookup resolves a path to one node, so the second is never
 * what the Workbench loads; emitting both would key every dock of that layout
 * twice. A repeat with the same bytes is collapsed into the first entry (in
 * tree order) and returned so the run can count it; a repeat whose bytes
 * differ is refused, because which one the Workbench reads is not shown by
 * the binary.
 */
export function collapseRepeatedLayouts(
  buf: Buffer,
  layouts: readonly LayoutTable[],
): { layouts: LayoutTable[]; repeated: RepeatedLayout[] } {
  const kept = new Map<string, LayoutTable>();
  const repeated: RepeatedLayout[] = [];
  for (const l of layouts) {
    const prior = kept.get(l.path);
    if (!prior) {
      kept.set(l.path, l);
      continue;
    }
    const a = buf.subarray(prior.payload, prior.payload + prior.size);
    const b = buf.subarray(l.payload, l.payload + l.size);
    if (prior.size !== l.size || !a.equals(b)) {
      throw new Error(
        `E05 rcc lists ${l.path} twice with different bytes (payloads 0x${prior.payload.toString(16)} and 0x${l.payload.toString(16)}); the binary does not show which one is loaded`,
      );
    }
    repeated.push({ path: l.path, payload: l.payload, keptPayload: prior.payload });
  }
  return { layouts: [...kept.values()], repeated };
}

/** Runs every extraction method over the executable's bytes. */
export function extract(buf: Buffer): Extraction {
  const sections = peSections(buf);
  const rdata = sectionRange(sections, ".rdata");
  const rdataSection = sections.find((s) => s.name === ".rdata");
  const strings = asciiStrings(buf, rdata, 2);
  const candidates = switchCandidates(strings);
  const rcc = findRccBundles(buf, rdata);

  const moduleDirs = new Map<Module, { module: Module; offset: number; path: string }>();
  const layouts: LayoutTable[] = [];
  for (const b of rcc) {
    for (const e of b.entries) {
      const dir = /^:\/Workbench\/([^/]+)$/.exec(e.path);
      if (e.dir && dir && (WB_MODULES as readonly string[]).includes(dir[1])) {
        const m = dir[1] as Module;
        const prior = moduleDirs.get(m);
        if (!prior || e.nameOffset < prior.offset)
          moduleDirs.set(m, { module: m, offset: e.nameOffset, path: e.path });
      }
      const file = /^:\/Workbench\/([^/]+)\/[^/]+\.gs$/.exec(e.path);
      if (!e.dir && file && e.flags === 0 && (WB_MODULES as readonly string[]).includes(file[1])) {
        layouts.push({
          module: file[1] as Module,
          path: e.path,
          payload: e.payload,
          size: e.size,
          entries: parseMainWindowState(buf, e.payload, e.size),
        });
      }
    }
  }
  const collapsed = collapseRepeatedLayouts(buf, layouts);
  collapsed.layouts.sort((a, b) => compareCodeUnits(a.path, b.path));

  const lowered = lowerAscii(buf);
  const probes: Extraction["probes"] = {};
  for (const s of PROBE_STRINGS) {
    probes[s] = { exact: searchBytes(buf, s), caseInsensitive: searchBytes(buf, s, lowered) };
  }
  const rtti = rdataSection ? parseRtti(buf, sections, rdata, rdataSection.va) : [];

  return {
    size: buf.length,
    sha256: sha256(buf),
    rdata,
    strings,
    switches: selectSwitches(candidates),
    switchCandidates: candidates,
    net: extractNetBlock(buf, rdata),
    rcc,
    moduleDirs: [...moduleDirs.values()].sort((a, b) => compareCodeUnits(a.module, b.module)),
    layouts: collapsed.layouts,
    repeatedLayouts: collapsed.repeated,
    rtti,
    objectNames: setObjectNameLiterals(buf, sections),
    optionRuns: optionRuns(buf, rdata, rtti),
    probes,
  };
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface LeftOut {
  what: string;
  count: number;
  why: string;
  /** Distinct items (written to the artifacts folder, never to the repository). */
  items: { offset: number; text: string }[];
}

export interface Built {
  observations: { id: string; obs: Observation }[];
  leftOut: LeftOut[];
  /** Rows per kind with the method that produced them. */
  kinds: Record<string, { rows: number; method: string }>;
}

const hex = (n: number): string => `0x${n.toString(16)}`;
const ref = (n: number): string => `exe:${hex(n)}`;

function isQtOwn(t: TypeName): boolean {
  return t.namespaces.length === 0 && /^Q[A-Z]/.test(t.name);
}

/**
 * Module of a class, only where the binary shows it: a full module name
 * prefixing the class name, else the namespace of a module class. Returns null
 * otherwise; there is no fallback module (a default would become part of the
 * row id).
 */
export function moduleOfClass(
  t: TypeName,
  namespaceModules: ReadonlyMap<string, Module>,
): Module | null {
  const byPrefix = [...WB_MODULES]
    .sort((a, b) => b.length - a.length)
    .find((m) => t.name.startsWith(m));
  if (byPrefix) return byPrefix;
  for (const ns of t.namespaces) {
    const m = namespaceModules.get(ns);
    if (m) return m;
  }
  return null;
}

/**
 * True when an object name fits the `#<object name>` id form: plain spaces are
 * allowed (the id escapes them), any other whitespace is not.
 */
export function objectNameFitsId(name: string): boolean {
  return !/[^\S ]/.test(name);
}

/** The `unverified` statement on a dialog or window row whose module the binary does not show. */
export const MODULE_NOT_SHOWN = "owning module not shown by the executable";

const MODULE_PARENT = (m: Module): NonNullable<Observation["parent_key"]> => ({
  dim: "ui",
  kind: "module",
  module: m,
  key: { path: [m] },
});

/** Turns an extraction into observation rows plus the left-out accounting. Pure. */
export function buildRows(x: Extraction): Built {
  const rows: Observation[] = [];
  const kinds: Built["kinds"] = {};
  const count = (kind: string, method: string): void => {
    kinds[kind] = { rows: (kinds[kind]?.rows ?? 0) + 1, method };
  };
  const leftOut: LeftOut[] = [];

  // CLI switches. A prose row's string states the argument role (high); a bare
  // `-name` literal shows only the form, so its role is inferred (medium).
  for (const s of x.switches) {
    rows.push({
      dim: "cli",
      kind: "cli-switch",
      module: "none",
      key: { switch: s.name },
      parent_key: null,
      label: `-${s.name}`,
      origin: "vanilla",
      ref: ref(s.offset),
      quote: s.quote.slice(0, QUOTE_MAX),
      confidence: s.method === "prose" ? "high" : "medium",
    });
    count(
      "cli-switch",
      "NUL-bounded 4-aligned .rdata literal `-name` (confidence medium), or an argument-marked `-name` token in .rdata prose (high); NON_SWITCH_TOKENS excluded",
    );
  }

  // Native NET functions.
  for (const f of x.net.functions) {
    rows.push({
      dim: "net",
      kind: "net-function",
      module: "none",
      key: { native: f.text },
      parent_key: null,
      label: f.text,
      origin: "vanilla",
      ref: ref(f.offset),
      quote: f.text,
      confidence: "medium",
    });
    count(
      "net-function",
      "leading verb-led identifiers of the NET dispatcher string block after `Parameter %s required`",
    );
  }

  // Modules, docks, toolbars.
  for (const d of x.moduleDirs) {
    rows.push({
      dim: "ui",
      kind: "module",
      module: d.module,
      key: { path: [d.module] },
      parent_key: null,
      origin: "vanilla",
      ref: ref(d.offset),
      quote: d.module,
      confidence: "high",
    });
    count("module", "rcc directory :/Workbench/<Module> (hash-verified name table, UTF-16BE)");
  }
  const placed = new Set<string>();
  for (const l of x.layouts) {
    for (const e of l.entries) {
      placed.add(e.name);
      if (!objectNameFitsId(e.name)) {
        throw new Error(
          `E05 layout object name does not fit the id form: ${JSON.stringify(e.name)}`,
        );
      }
      rows.push({
        dim: "ui",
        kind: e.kind,
        module: l.module,
        key: { object_name: e.name },
        parent_key: MODULE_PARENT(l.module),
        object_name: e.name,
        origin: "vanilla",
        ref: ref(e.offset),
        quote: e.name,
        confidence: "high",
      });
      count(
        e.kind,
        `object name in the module's default layout resource ${"(:/Workbench/<Module>/*.gs, QMainWindow::saveState; 0xfb marker = dock, else toolbar)"}`,
      );
    }
  }

  // RTTI: dialogs and windows.
  const named = x.rtti
    .map((c) => ({ c, t: demangleTypeName(c.mangled) }))
    .filter((v): v is { c: RttiClass; t: TypeName } => v.t !== null);
  const isA = (c: RttiClass, base: string): boolean => c.bases.includes(`.?AV${base}@@`);
  const namespaceModules = new Map<string, Module>();
  for (const { c, t } of named) {
    if (isA(c, "WBModule") && (WB_MODULES as readonly string[]).includes(t.name)) {
      for (const ns of t.namespaces) namespaceModules.set(ns, t.name as Module);
    }
  }
  const kindOf = (c: RttiClass, t: TypeName): "dialog" | "window" | null => {
    if (isQtOwn(t)) return null;
    if (isA(c, "QDialog")) return "dialog";
    if (isA(c, "QMainWindow") && !isA(c, "WBModule") && c.mangled !== ".?AVWBModule@@")
      return "window";
    return null;
  };
  const uiClasses = named
    .map((v) => ({ ...v, kind: kindOf(v.c, v.t) }))
    .filter((v): v is { c: RttiClass; t: TypeName; kind: "dialog" | "window" } => v.kind !== null);
  // A class that another dialog or window class derives from is an intermediate
  // base (WBDialog, ParticleSimulationDialogBase): RTTI cannot say it is ever shown.
  const baseOfOther = new Set(uiClasses.flatMap((v) => v.c.bases));
  const intermediate: { offset: number; text: string }[] = [];
  const seenClass = new Set<string>();
  const setObjectNames = new Set(x.objectNames.literals.map((l) => l.text));
  for (const { c, t, kind } of uiClasses) {
    if (baseOfOther.has(c.mangled)) {
      intermediate.push({ offset: c.offset, text: `${kind}\t${t.qualified}` });
      continue;
    }
    const shown = moduleOfClass(t, namespaceModules);
    const module: Module = shown ?? "none";
    const k = `${kind}\u0000${module}\u0000${t.qualified}`;
    if (seenClass.has(k)) continue;
    seenClass.add(k);
    // A module-less class is keyed by its name as a Qt object name only when the
    // binary passes that name to QObject::setObjectName; otherwise by path.
    const byObjectName = shown === null && setObjectNames.has(t.name);
    rows.push({
      dim: "ui",
      kind,
      module,
      key: byObjectName ? { object_name: t.name } : { path: [t.qualified] },
      ...(byObjectName ? { object_name: t.name } : {}),
      class_name: t.qualified,
      origin: "vanilla",
      ref: ref(c.offset),
      quote: c.mangled.slice(0, QUOTE_MAX),
      // The base class is stated by RTTI; the module (or the object name) is read
      // from a name or a call site.
      confidence: "medium",
      ...(shown === null ? { unverified: [MODULE_NOT_SHOWN] } : {}),
    });
    count(
      kind,
      `RTTI class whose base-class array holds ${kind === "dialog" ? "QDialog" : "QMainWindow, not WBModule"} (Qt's own and intermediate bases excluded); module from a full module-name prefix or a module class's namespace, else "none" with "${MODULE_NOT_SHOWN}" unverified, keyed by the class name as object name when the binary passes it to QObject::setObjectName, else by path [class]; confidence medium`,
    );
  }
  leftOut.push({
    what: "intermediate dialog and window base classes",
    count: intermediate.length,
    why: "another dialog or window class derives from it (WBDialog, ParticleSimulationDialogBase); RTTI cannot say it is ever shown on its own",
    items: intermediate,
  });

  leftOut.push({
    what: "repeated rcc layout entries (same path, identical bytes)",
    count: x.repeatedLayouts.length,
    why: "the rcc tree lists the resource path twice with byte-identical payloads; Qt resolves a path to one node, so the repeat's docks and toolbars are the kept entry's and are emitted once",
    items: x.repeatedLayouts.map((r) => ({
      offset: r.payload,
      text: `${r.path} (same bytes as ${hex(r.keptPayload)})`,
    })),
  });

  // Left out: RTTI classes with no row form here.
  const dockClasses = named.filter(({ c, t }) => !isQtOwn(t) && isA(c, "QDockWidget"));
  leftOut.push({
    what: "QDockWidget subclasses (RTTI)",
    count: dockClasses.length,
    why: "a dock's identity is its object name; a class-name row would duplicate the layout-derived dock rows and needs an alias, so the class list stays in the artifacts folder",
    items: dockClasses.map(({ c, t }) => ({ offset: c.offset, text: t.qualified })),
  });
  const otherModules = named.filter(
    ({ c, t }) => isA(c, "WBModule") && !(WB_MODULES as readonly string[]).includes(t.name),
  );
  leftOut.push({
    what: "WBModule subclasses whose name is not one of the 11 modules",
    count: otherModules.length,
    why: "no module of the vocabulary matches the class name; mapping it would be a guess",
    items: otherModules.map(({ c, t }) => ({ offset: c.offset, text: t.qualified })),
  });
  const optionClasses = named.filter(({ t }) => /OptionsClass$/.test(t.name));
  leftOut.push({
    what: "option classes (`*OptionsClass`, RTTI) and their properties",
    count: optionClasses.length,
    why: "no row (main-session ruling): property names, category names, descriptions, defaults and widget kinds share one run and pooled strings are missing from most runs; the class names and the strings beside them are in options-strings.tsv for the Options census",
    items: optionClasses.map(({ c, t }) => ({ offset: c.offset, text: t.qualified })),
  });
  const runStrings = x.optionRuns.flatMap((r) => r.strings);
  leftOut.push({
    what: "strings beside the option class names (options-strings.tsv)",
    count: runStrings.length,
    why: `the NUL-bounded strings after each .rdata occurrence of a *OptionsClass name, up to more than four pointer words in a row; ${runStrings.filter((s) => IDENTIFIER.test(s.text)).length} are identifier-shaped (property-name candidates, also class and widget-kind names); not emitted`,
    items: x.optionRuns.flatMap((r) =>
      r.strings.map((s) => ({ offset: s.offset, text: `${r.className}\t${s.text}` })),
    ),
  });

  // Left out: candidate labels and object names with no established container.
  const aligned = x.strings.filter((s) => s.offset % 4 === 0);
  const distinct = (pred: (s: FoundString) => boolean): { offset: number; text: string }[] => {
    const m = new Map<string, number>();
    for (const s of aligned) if (pred(s) && !m.has(s.text)) m.set(s.text, s.offset);
    return [...m].map(([text, offset]) => ({ offset, text }));
  };
  const mnemonic = distinct(
    (s) =>
      /^(?=[^&]*&[A-Za-z0-9])[A-Za-z0-9 &.,()'/+:-]{2,64}$/.test(s.text) &&
      /[A-Za-z]{2}/.test(s.text),
  );
  leftOut.push({
    what: "labels with a mnemonic marker (menu titles and action labels)",
    count: mnemonic.length,
    why: "string pooling hides which menu or module owns a label; no container is established in the binary",
    items: mnemonic,
  });
  const shortcuts = distinct((s) => SHORTCUT_LITERAL.test(s.text));
  leftOut.push({
    what: "default-shortcut literals of action records",
    count: shortcuts.length,
    why: "a shortcut row needs the action it belongs to; the record order (shortcut, tooltip, label) cannot be segmented reliably once pooled strings drop out",
    items: shortcuts,
  });
  const objectNames = distinct((s) => OBJECT_NAME_CANDIDATE.test(s.text) && !placed.has(s.text));
  leftOut.push({
    what: "Qt object names of actions, menus, docks and toolbars that no default layout places",
    count: objectNames.length,
    why: "only the layout resources show a module container; Designer setupUi blocks lose pooled strings, so block membership is not reliable",
    items: objectNames,
  });
  leftOut.push({
    what: "settings key names, status-bar items, property-editor kinds",
    count: 0,
    why: "not emitted: settings keys appear without their QSettings group (no section to key them by), the binary holds no QStatusBar subclass or status-item table, and the property-editor widget names are scattered single pooled strings (E16 owns the kinds from UIWidgets)",
    items: [],
  });

  // Validate, derive ids, sort.
  const observations: { id: string; obs: Observation }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (allStrings(r).some(containsMachinePath)) {
      throw new Error(`E05 row carries a machine path: ${JSON.stringify(r.key)}`);
    }
    const parsed = observationSchema.parse(r);
    const id = deriveId(parsed);
    if (seen.has(id)) throw new Error(`E05 emitted ${id} twice`);
    seen.add(id);
    observations.push({ id, obs: parsed });
  }
  observations.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { observations, leftOut, kinds };
}

/** Exact text of the E05 observation file. */
export function observationFileText(
  built: Built,
  build: string,
  input: { path: string; sha256: string },
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: [input],
    provisional: false,
    row_count: built.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...built.observations.map((o) => jsonlLine(o.obs))].join(
      "\n",
    ) + "\n"
  );
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

const tsv = (rows: readonly (readonly (string | number)[])[]): string =>
  rows.map((r) => r.map((c) => String(c).replace(/[\t\r\n]/g, " ")).join("\t")).join("\n") + "\n";

/** Writes the raw intermediate tables (outside every git working tree). */
export function writeArtifacts(dir: string, x: Extraction, built: Built): string[] {
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "cli-candidates.tsv": tsv([
      ["offset", "method", "name", "excluded", "quote"],
      ...x.switchCandidates.map((c) => [
        hex(c.offset),
        c.method,
        c.name,
        c.excluded ?? "",
        c.quote,
      ]),
    ]),
    "net-block.tsv": tsv([
      ["offset", "text", "function"],
      ...x.net.block.map((s) => [hex(s.offset), s.text, x.net.functions.includes(s) ? "yes" : ""]),
    ]),
    "rcc-entries.tsv": tsv([
      ["bundle_names", "path", "dir", "flags", "name_offset", "payload", "size"],
      ...x.rcc.flatMap((b) =>
        b.entries.map((e) => [
          hex(b.names),
          e.path,
          e.dir ? 1 : 0,
          e.flags,
          hex(e.nameOffset),
          e.payload < 0 ? "" : hex(e.payload),
          e.size,
        ]),
      ),
    ]),
    "layouts.tsv": tsv([
      ["module", "resource", "kind", "object_name", "offset"],
      ...x.layouts.flatMap((l) =>
        l.entries.map((e) => [l.module, l.path, e.kind, e.name, hex(e.offset)]),
      ),
    ]),
    "rtti-classes.tsv": tsv([
      ["offset", "class", "bases"],
      ...x.rtti.map((c) => [hex(c.offset), c.mangled, c.bases.join(" ")]),
    ]),
    "object-names.tsv": tsv([
      ["offset", "object_name", "call_sites"],
      ...x.objectNames.literals.map((l) => [hex(l.offset), l.text, l.sites.map(hex).join(" ")]),
    ]),
    "options-strings.tsv": tsv([
      ["class", "rtti_offset", "name_offset", "string_offset", "identifier", "text"],
      ...x.optionRuns.flatMap((r) =>
        r.strings.length === 0
          ? [[r.className, hex(r.rttiOffset), hex(r.offset), "", "", ""]]
          : r.strings.map((s) => [
              r.className,
              hex(r.rttiOffset),
              hex(r.offset),
              hex(s.offset),
              IDENTIFIER.test(s.text) ? "yes" : "",
              s.text,
            ]),
      ),
    ]),
    "left-out.tsv": tsv([
      ["what", "offset", "text"],
      ...built.leftOut.flatMap((l) => l.items.map((i) => [l.what, hex(i.offset), i.text])),
    ]),
    "probes.json": JSON.stringify(x.probes, null, 2) + "\n",
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return Object.keys(files);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e05-executable-tables.ts [--exe <file>] [--build <tag>] [--out <file under observations/E05/>] [--artifacts <dir> | --no-artifacts] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E05/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E05/ (E05 writes only its own observation directory)",
    );
  }
  return file;
}

function summarizeHits(h: SearchHits): string {
  const f = (a: number[]): string =>
    `${a.length}${a.length ? ` [${a.slice(0, 6).map(hex).join(", ")}${a.length > 6 ? ", ..." : ""}]` : ""}`;
  return `ascii ${f(h.ascii)}, utf16le ${f(h.utf16le)}`;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e05-executable-tables", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        exe: { type: "string" },
        build: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
        data: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    let out: string;
    try {
      out = resolveOut(paths, values.out, build);
    } catch (e) {
      io.err(`e05-executable-tables: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    if (values.artifacts && !values["no-artifacts"] && insideGitWorkTree(values.artifacts)) {
      io.err(
        "e05-executable-tables: refusing --artifacts inside a git working tree; raw executable tables never enter one (plan 4.2)",
      );
      return EXIT_FAIL;
    }
    const exe = values.exe
      ? resolve(values.exe)
      : join(loadConfig().workbenchPath, "Workbench", EXE_NAME);
    if (!existsSync(exe)) {
      io.out("NO DATA: the Workbench executable is not present; nothing extracted");
      return EXIT_USAGE;
    }
    const buf = readFileSync(exe);
    const x = extract(buf);
    const built = buildRows(x);
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(
      out,
      observationFileText(built, build, {
        path: `<tools>/Workbench/${basename(exe)}`,
        sha256: x.sha256,
      }),
    );
    let artifactFiles: string[] = [];
    let artifactsAt = "";
    if (!values["no-artifacts"]) {
      const dir = values.artifacts
        ? resolve(values.artifacts)
        : join(artifactsDir(), "census", build, ENUMERATOR_ID);
      artifactFiles = writeArtifacts(dir, x, built);
      artifactsAt = values.artifacts
        ? "<artifacts>"
        : `<artifacts>/census/${build}/${ENUMERATOR_ID}`;
    }

    const excluded = x.switchCandidates.filter((c) => c.excluded);
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e05-executable-tables",
          build,
          exe: { size: x.size, sha256: x.sha256 },
          rows: built.observations.length,
          kinds: built.kinds,
          switches: x.switches.length,
          switch_candidates: x.switchCandidates.length,
          switches_excluded: excluded.map((c) => ({
            name: c.name,
            offset: hex(c.offset),
            family: c.excluded,
          })),
          net_anchor: x.net.anchor < 0 ? null : hex(x.net.anchor),
          net_functions: x.net.functions.map((f) => ({ name: f.text, offset: hex(f.offset) })),
          rcc_bundles: x.rcc.length,
          layouts: x.layouts.map((l) => ({
            module: l.module,
            path: l.path,
            entries: l.entries.length,
          })),
          rtti_classes: x.rtti.length,
          set_object_name: {
            calls: x.objectNames.calls,
            unresolved: x.objectNames.unresolved,
            literals: x.objectNames.literals.length,
          },
          option_classes: [...new Set(x.optionRuns.map((r) => r.className))],
          option_strings: x.optionRuns.reduce((n, r) => n + r.strings.length, 0),
          probes: Object.fromEntries(
            Object.entries(x.probes).map(([k, v]) => [
              k,
              {
                exact: { ascii: v.exact.ascii.map(hex), utf16le: v.exact.utf16le.map(hex) },
                case_insensitive: {
                  ascii: v.caseInsensitive.ascii.length,
                  utf16le: v.caseInsensitive.utf16le.length,
                  ascii_first: v.caseInsensitive.ascii.slice(0, 20).map(hex),
                  utf16le_first: v.caseInsensitive.utf16le.slice(0, 20).map(hex),
                },
              },
            ]),
          ),
          left_out: built.leftOut.map((l) => ({ what: l.what, count: l.count, why: l.why })),
          artifacts: artifactFiles,
        }),
      );
      return EXIT_OK;
    }
    io.out(`executable: ${x.size} bytes, sha256 ${x.sha256}`);
    io.out(
      `cli switches: ${x.switches.length} (${x.switchCandidates.length} candidates, ${excluded.length} excluded: ${excluded.map((c) => `-${c.name}`).join(" ")})`,
    );
    io.out(
      `net functions: ${x.net.functions.length} (${x.net.functions.map((f) => f.text).join(", ")}) after anchor ${x.net.anchor < 0 ? "absent" : hex(x.net.anchor)}`,
    );
    for (const l of x.layouts) {
      const docks = l.entries.filter((e) => e.kind === "dock").length;
      io.out(`layout ${l.path}: ${docks} docks, ${l.entries.length - docks} toolbars`);
    }
    io.out(
      `setObjectName: ${x.objectNames.calls} call sites, ${x.objectNames.literals.length} distinct literals, ${x.objectNames.unresolved} sites without a literal`,
    );
    for (const r of x.optionRuns) {
      io.out(
        `option class ${r.className} at ${hex(r.offset)}: ${r.strings.length} strings beside it, ${r.strings.filter((s) => IDENTIFIER.test(s.text)).length} identifier-shaped`,
      );
    }
    for (const [k, v] of Object.entries(x.probes)) {
      io.out(
        `probe "${k}": exact ${summarizeHits(v.exact)}; case-insensitive ${summarizeHits(v.caseInsensitive)}`,
      );
    }
    for (const [k, v] of Object.entries(built.kinds).sort((a, b) => compareCodeUnits(a[0], b[0]))) {
      io.out(`rows ${k}: ${v.rows} (${v.method})`);
    }
    for (const l of built.leftOut) io.out(`left out ${l.count}: ${l.what}`);
    if (artifactsAt) io.out(`artifacts: ${artifactFiles.length} files in ${artifactsAt}`);
    io.out(`E05 at build ${build}: ${built.observations.length} observations`);
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
