/**
 * E03 — Plugin and tool registry (plan 4.5; Phase 1).
 *
 * Reads the E02 source index (`src/census/source-index.ts`, artifacts folder)
 * and, for method bodies, the script text through the pak reader
 * (`src/pak/vfs.ts`; nothing is unpacked, nothing is executed). The
 * extraction and the modal classification live in
 * `src/census/plugin-registry.ts`; this script turns them into observation
 * rows, the plugin catalog and the headline counts.
 *
 * WHAT IS EMITTED (dim plugin):
 *  - plugin / tool, key {class}: one row per class declaration carrying
 *    `WorkbenchPluginAttribute` (plugin) or `WorkbenchToolAttribute` (tool).
 *    label = the attribute's name argument, what = its description, shortcut_default
 *    = its shortcut, class_name, signature = the annotation as written, module
 *    by the shared rule (single wbModules entry, else Shared), modal from the
 *    Run() analysis, which follows every script call to closure (`opens` when
 *    Run reaches a dialog at any depth, `none` when the search was complete,
 *    every call resolved and no dialog was found), risk_hint only where the
 *    code states it (Run or any other entry point of the class reaches
 *    Workbench.Exit or FileIO.DeleteFile: destructive; Run reaches an upload
 *    or publish call: external; a dialog directly in Run: mutating), the
 *    classification caveats in `unverified`, and children_count = the child
 *    rows emitted for it.
 *  - plugin-setting, key {class, attr}: every `[Attribute]` member of the
 *    class and of its script base classes (signature = type, name and the
 *    Attribute's default; what = its desc argument).
 *  - plugin-button, key {class, button}: every `[ButtonAttribute]` method of
 *    the class and its script base classes (label = the button label).
 *  - plugin-cli-arg, key {class, cli}: every command-line argument read by
 *    `WBModuleDef.GetCmdLine`, `System.GetCLIParam` or `System.IsCLIParam`
 *    from the class's methods to call depth 3 (name normalised to one
 *    leading `-`).
 *
 * The full per-class table (overrides, dialog, exit, process, delete and
 * write call sites with paths, unresolved calls, verdict) goes to
 * `<artifacts>/census/<build>/E03/plugin-catalog.json`, never into the
 * repository.
 *
 *   npx tsx scripts/census/enumerators/e03-plugin-registry.ts [--build <tag>] [--game <dir>]
 *       [--data <dir>] [--out <file under observations/E03/>] [--artifacts <dir>]
 *       [--no-artifacts] [--json]
 *
 * Exit: 0 written; 1 refused, or a row failed the schema; 2 usage or NO DATA
 * (no source index and no game install, or no game install to read bodies
 * from); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, formatJson, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import {
  CallResolver,
  MAX_DEPTH,
  SEARCH_LIMIT,
  analyzeClass,
  buttonWhat,
  commentedAttributes,
  minDepth,
  pluginClasses,
  verdictOf,
  type ClassAnalysis,
  type Effect,
  type Reach,
  type TextReader,
  type Verdict,
} from "../../../src/census/plugin-registry.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  pakRef,
  saveSourceIndex,
  sourceIndexPath,
  sourceIndexText,
  type SourceIndex,
} from "../../../src/census/source-index.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import { REPO_ROOT, artifactsDir } from "../../live/paths.js";
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
export const ENUMERATOR_ID = "E03";
/** Registered generator path (must equal universes.json `enumerators.E03.generator`). */
export const GENERATOR = "scripts/census/enumerators/e03-plugin-registry.ts";
const QUOTE_MAX = 200;
const WHAT_MAX = 400;

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface E03Result {
  observations: { id: string; obs: Observation }[];
  analyses: ClassAnalysis[];
  /** Fields dropped from a row because they held a machine path. */
  scrubbed: { id: string; field: string }[];
  /** Child rows not emitted, with the reason (a key emitted twice). */
  dropped: { id: string; reason: string }[];
}

const collapse = (s: string | undefined): string | undefined => {
  if (s === undefined) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > WHAT_MAX ? t.slice(0, WHAT_MAX) : t;
};

/** Rows and analyses for every plugin and tool class. `readText` gives a script's text. */
export function buildRows(
  index: SourceIndex,
  readText: TextReader,
  searchDepth = SEARCH_LIMIT,
): E03Result {
  const resolver = new CallResolver(index, readText);
  const lineCache = new Map<string, string[] | undefined>();
  const lineAt = (file: string, line: number): string | undefined => {
    if (!lineCache.has(file)) lineCache.set(file, readText(file)?.split(/\r?\n/));
    const t = lineCache.get(file)?.[line - 1]?.trim();
    return t ? t.slice(0, QUOTE_MAX) : undefined;
  };
  const scrubbed: E03Result["scrubbed"] = [];
  const dropped: E03Result["dropped"] = [];
  const out = new Map<string, Observation>();
  const finish = (raw: Observation): { id: string; obs: Observation } | undefined => {
    for (const f of ["label", "signature", "what", "quote", "shortcut_default"] as const) {
      const v = raw[f];
      if (v === undefined) delete raw[f];
      else if (containsMachinePath(v)) {
        delete raw[f];
        scrubbed.push({ id: "", field: f });
      }
    }
    if (raw.unverified) {
      raw.unverified = raw.unverified.filter((u) => !containsMachinePath(u));
      if (raw.unverified.length === 0) delete raw.unverified;
    }
    const obs = observationSchema.parse(raw);
    const id = deriveId(obs);
    for (const s of scrubbed) if (s.id === "") s.id = id;
    if (out.has(id)) {
      dropped.push({ id, reason: `key emitted twice (second at ${obs.ref})` });
      return undefined;
    }
    out.set(id, obs);
    return { id, obs };
  };

  const analyses: ClassAnalysis[] = [];
  for (const cls of pluginClasses(index)) {
    const a = analyzeClass(index, resolver, cls, searchDepth);
    analyses.push(a);
    const module = cls.module;
    const parentKey = { dim: "plugin" as const, kind: cls.kind, module, key: { class: cls.name } };
    const base = (
      file: string,
      line: number,
    ): Pick<Observation, "origin" | "ref" | "confidence" | "quote"> => {
      const o: Pick<Observation, "origin" | "ref" | "confidence" | "quote"> = {
        origin: "vanilla",
        ref: pakRef({ file, line }),
        confidence: "high",
      };
      const q = lineAt(file, line);
      if (q) o.quote = q;
      return o;
    };
    let children = 0;
    for (const s of a.settings) {
      const def = s.defvalue ?? s.field.init;
      let signature = `${s.field.type} ${s.field.name}${def !== undefined ? ` = ${def}` : ""}`;
      if (containsMachinePath(signature)) {
        // A default that reads as a machine path: keep the type and name only.
        signature = `${s.field.type} ${s.field.name}`;
        scrubbed.push({
          id: `plugin:${cls.name}#attr:${s.field.name}`,
          field: "signature default",
        });
      }
      const r = finish({
        dim: "plugin",
        kind: "plugin-setting",
        module,
        key: { class: cls.name, attr: s.field.name },
        parent_key: parentKey,
        label: s.field.name,
        signature,
        what: collapse(s.desc),
        ...base(s.field.file, s.field.line),
      });
      if (r) children++;
    }
    for (const b of a.buttons) {
      const r = finish({
        dim: "plugin",
        kind: "plugin-button",
        module,
        key: { class: cls.name, button: b.method.name },
        parent_key: parentKey,
        label: collapse(b.label),
        signature: b.method.signature,
        what: collapse(buttonWhat(b)),
        ...base(b.method.file, b.method.line),
      });
      if (r) children++;
    }
    for (const c of a.cli) {
      const r = finish({
        dim: "plugin",
        kind: "plugin-cli-arg",
        module,
        key: { class: cls.name, cli: c.name },
        parent_key: parentKey,
        label: c.name,
        signature: `${c.effect.callee}(${c.effect.args.join(", ")})`,
        ...base(c.effect.file, c.effect.line),
      });
      if (r) children++;
    }
    const row: Observation = {
      dim: "plugin",
      kind: cls.kind,
      module,
      key: { class: cls.name },
      parent_key: null,
      label: collapse(cls.label),
      what: collapse(cls.description),
      shortcut_default: collapse(cls.shortcut),
      class_name: cls.name,
      signature: collapse(cls.signature)?.slice(0, WHAT_MAX),
      children_count: children,
      ...base(cls.decl.file, cls.attr.line),
    };
    if (a.modal) row.modal = a.modal;
    if (a.risk_hint) row.risk_hint = a.risk_hint;
    if (a.unverified.length) row.unverified = a.unverified;
    finish(row);
  }
  const observations = [...out.entries()]
    .map(([id, obs]) => ({ id, obs }))
    .sort((x, y) => compareCodeUnits(x.id, y.id));
  return { observations, analyses, scrubbed, dropped };
}

export interface InputHash {
  path: string;
  sha256: string;
}

/**
 * Header inputs: the source-index file's bytes (`indexBytes`, else the index
 * as `saveSourceIndex` would write it) and, when given, the bytes of the
 * script files whose text was read for bodies and quotes, hashed as
 * `<file>\0<sha256>\n` lines in code-unit order.
 */
export function inputHashes(
  index: SourceIndex,
  build: string,
  indexBytes?: Buffer,
  scriptBytes?: ReadonlyMap<string, Buffer>,
): InputHash[] {
  const out: InputHash[] = [
    {
      path: `<artifacts>/census/${build}/E02/source-index.jsonl`,
      sha256: sha256(indexBytes ?? Buffer.from(sourceIndexText(index))),
    },
  ];
  if (scriptBytes && scriptBytes.size) {
    const lines = [...scriptBytes.keys()]
      .sort(compareCodeUnits)
      .map((f) => `${f}\u0000${sha256(scriptBytes.get(f) as Buffer)}\n`);
    out.push({
      path: `<game>/addons/**/scripts/**/*.c (${scriptBytes.size} files read for method bodies and quotes)`,
      sha256: sha256(lines.join("")),
    });
  }
  return out;
}

/** Exact text of the E03 observation file. */
export function observationFileText(
  result: E03Result,
  index: SourceIndex,
  build: string,
  inputs: readonly InputHash[] = inputHashes(index, build),
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: [...inputs],
    provisional: false,
    row_count: result.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...result.observations.map((o) => jsonlLine(o.obs))].join(
      "\n",
    ) + "\n"
  );
}

// ── Recon cross-check ─────────────────────────────────────────────────────────

/** Classes the recon (plugins-netapi-cli.md section 2.6) lists as opening a modal in Run(). */
export function reconModalInRun(text: string): string[] {
  const out: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (!/Run\(\) opens modal ScriptDialog\/Dialog/.test(l)) continue;
    const m = /^\|\s*`([A-Za-z_]\w*)`/.exec(l);
    if (m) out.push(m[1]);
  }
  return out.sort(compareCodeUnits);
}

// ── Headline counts and catalog ───────────────────────────────────────────────

export interface HeadlineCounts {
  classes: number;
  plugin: number;
  tool: number;
  commented_out: number;
  raw_declarations: number;
  per_module: Record<string, { plugin: number; tool: number }>;
  module_rules: Record<string, number>;
  overrides: Record<string, number>;
  run_commandline: { classes: number; reach_exit: number; names: string[] };
  run_dialog: {
    any: { depth1: number; depth2: number; depth3: number; any_depth: number };
    user_dialog_only: { depth1: number; depth2: number; depth3: number; any_depth: number };
  };
  /** Classes whose Run reaches Exit or a deletion at any depth, and the classes whose destructive hint comes from another entry point. */
  destructive: { from_run: number; from_other_entry: string[] };
  configure_dialog: number;
  verdicts: Record<Verdict, number>;
  risk_hints: Record<string, number>;
  rows: Record<string, number>;
  resource_manager: {
    single_module: number;
    listed_in_wbModules: number;
    plugins_without_wbModules: number;
    tools_without_wbModules: number;
  };
  recon_modal_in_run?: {
    listed: number;
    measured_modal_depth1: number;
    classified_safe: { class: string; justification: string }[];
    not_found: string[];
  };
}

const runDestroys = (x: ClassAnalysis): boolean =>
  (x.run?.effects ?? []).some((e) => e.kind === "exit" || e.kind === "delete");

const countDepth = (a: ClassAnalysis[], pred: (e: Effect) => boolean, k: number): number =>
  a.filter((x) => (x.run?.effects ?? []).some((e) => pred(e) && e.depth <= k)).length;

export function headlineCounts(
  result: E03Result,
  commented: number,
  reconText?: string,
  readText?: TextReader,
): HeadlineCounts {
  const a = result.analyses;
  const per_module: HeadlineCounts["per_module"] = {};
  const module_rules: Record<string, number> = {};
  const overrides: Record<string, number> = {};
  for (const x of a) {
    const m = (per_module[x.cls.module] ??= { plugin: 0, tool: 0 });
    m[x.cls.kind]++;
    module_rules[x.cls.moduleRule] = (module_rules[x.cls.moduleRule] ?? 0) + 1;
    for (const o of x.overrides) overrides[o.method] = (overrides[o.method] ?? 0) + 1;
  }
  const verdicts = { safe: 0, modal: 0, exits: 0, effects: 0, unknown: 0, "no-run": 0 } as Record<
    Verdict,
    number
  >;
  for (const x of a) verdicts[x.verdict]++;
  const risk_hints: Record<string, number> = {};
  for (const x of a) if (x.risk_hint) risk_hints[x.risk_hint] = (risk_hints[x.risk_hint] ?? 0) + 1;
  const rows: Record<string, number> = {};
  for (const o of result.observations) rows[o.obs.kind] = (rows[o.obs.kind] ?? 0) + 1;
  const isDialog = (e: Effect): boolean => e.kind === "dialog";
  const isUser = (e: Effect): boolean => e.kind === "dialog" && e.dialog === "user";
  const rc = a.filter((x) => x.runCommandline);
  const has = (x: ClassAnalysis, m: string): boolean => (x.cls.wbModules ?? []).includes(m);
  const out: HeadlineCounts = {
    classes: a.length,
    plugin: a.filter((x) => x.cls.kind === "plugin").length,
    tool: a.filter((x) => x.cls.kind === "tool").length,
    commented_out: commented,
    raw_declarations: a.length + commented,
    per_module,
    module_rules,
    overrides,
    run_commandline: {
      classes: rc.length,
      reach_exit: rc.filter((x) => x.runCommandline?.effects.some((e) => e.kind === "exit")).length,
      names: rc.map((x) => x.cls.name).sort(compareCodeUnits),
    },
    run_dialog: {
      any: {
        depth1: countDepth(a, isDialog, 1),
        depth2: countDepth(a, isDialog, 2),
        depth3: countDepth(a, isDialog, 3),
        any_depth: countDepth(a, isDialog, Infinity),
      },
      user_dialog_only: {
        depth1: countDepth(a, isUser, 1),
        depth2: countDepth(a, isUser, 2),
        depth3: countDepth(a, isUser, 3),
        any_depth: countDepth(a, isUser, Infinity),
      },
    },
    destructive: {
      from_run: a.filter((x) => runDestroys(x)).length,
      from_other_entry: a
        .filter((x) => x.risk_hint === "destructive" && !runDestroys(x))
        .map((x) => x.cls.name)
        .sort(compareCodeUnits),
    },
    configure_dialog: a.filter((x) => x.configure?.effects.some(isDialog)).length,
    verdicts,
    risk_hints,
    rows,
    resource_manager: {
      single_module: a.filter((x) => x.cls.module === "ResourceManager").length,
      listed_in_wbModules: a.filter((x) => has(x, "ResourceManager")).length,
      plugins_without_wbModules: a.filter(
        (x) => x.cls.kind === "plugin" && (x.cls.wbModules ?? []).length === 0,
      ).length,
      tools_without_wbModules: a.filter(
        (x) => x.cls.kind === "tool" && (x.cls.wbModules ?? []).length === 0,
      ).length,
    },
  };
  if (reconText !== undefined) {
    const listed = reconModalInRun(reconText);
    const byName = new Map(a.map((x) => [x.cls.name, x]));
    const classified_safe: { class: string; justification: string }[] = [];
    const not_found: string[] = [];
    let modal1 = 0;
    for (const n of listed) {
      const x = byName.get(n);
      if (!x) {
        not_found.push(n);
        continue;
      }
      if (minDepth(x.run, "dialog") === 1) modal1++;
      if (x.verdict === "safe") {
        const r = x.run as Reach;
        const ov = x.overrides.find((o) => o.method === "Run");
        const line =
          ov && readText ? readText(ov.record.file)?.split(/\r?\n/)[ov.record.line - 1] : "";
        classified_safe.push({
          class: n,
          justification: `Run() at ${ov ? pakRef(ov.record) : "?"} (${(line ?? "").trim()}) makes ${r.calls} resolved calls over ${r.bodies} bodies, followed to closure, and none is a dialog`,
        });
      }
    }
    out.recon_modal_in_run = {
      listed: listed.length,
      measured_modal_depth1: modal1,
      classified_safe,
      not_found,
    };
  }
  return out;
}

const site = (e: Effect): Record<string, unknown> => ({
  kind: e.kind,
  callee: e.callee,
  ...(e.dialog ? { dialog: e.dialog } : {}),
  depth: e.depth,
  ref: pakRef(e),
  path: e.path,
});

function reachJson(r: Reach | undefined): Record<string, unknown> | null {
  if (!r) return null;
  const by = (k: string): Record<string, unknown>[] =>
    r.effects.filter((e) => e.kind === k).map(site);
  return {
    entry: r.entry,
    verdict: verdictOf(r),
    resolved_calls: r.calls,
    bodies_searched: r.bodies,
    frontier: r.frontier,
    min_dialog_depth: minDepth(r, "dialog"),
    dialog_sites: by("dialog"),
    exit_sites: by("exit"),
    process_sites: by("process"),
    delete_sites: by("delete"),
    write_sites: by("write"),
    publish_sites: by("publish"),
    unresolved: r.unresolved.map((u) => ({
      depth: u.depth,
      ref: pakRef(u),
      call: u.text,
      reason: u.reason,
      path: u.path,
    })),
  };
}

/** The plugin catalog (plan layer L3): one entry per class. */
export function catalog(
  result: E03Result,
  build: string,
  counts: HeadlineCounts,
): Record<string, unknown> {
  return {
    $catalog: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    search: `every script call followed to closure (guard: call depth ${SEARCH_LIMIT}); dialog counts also given to depth 1, 2 and ${MAX_DEPTH}; command-line reads to depth ${MAX_DEPTH}`,
    rules: {
      module: "single wbModules entry naming a vocabulary module, else Shared",
      dialog_calls: [
        "Workbench.Dialog",
        "Workbench.ScriptDialog",
        "WorldEditorAPI.ShowItemListDialog",
        "new WBProgressDialog (progress)",
      ],
      exit_calls: ["Workbench.Exit"],
      process_calls: ["Workbench.RunCmd", "Workbench.RunProcess"],
      delete_calls: ["FileIO.DeleteFile"],
      verdict_order: ["exits", "modal", "effects", "unknown", "safe"],
      safe_to_call_from_handler:
        "verdict safe: Run reaches no dialog, Exit, process or deletion, every call resolved and every script call was followed",
      modal:
        "opens: Run reaches a dialog at any depth; none: the search of Run was complete and found none; absent otherwise",
      risk_hint:
        "destructive: Run or another entry point (event override, RunCommandline, button method) reaches Exit or a deletion; external: Run reaches an upload or publish call; mutating: a dialog directly in Run",
    },
    counts,
    classes: result.analyses
      .slice()
      .sort((x, y) => compareCodeUnits(x.cls.name, y.cls.name))
      .map((x) => ({
        class: x.cls.name,
        kind: x.cls.kind,
        id: `plugin:${x.cls.name}`,
        ref: pakRef({ file: x.cls.decl.file, line: x.cls.decl.line }),
        attribute_ref: pakRef({ file: x.cls.decl.file, line: x.cls.attr.line }),
        parent: x.cls.decl.parent ?? null,
        guards: x.cls.decl.guards,
        label: x.cls.label ?? null,
        category: x.cls.category ?? null,
        shortcut: x.cls.shortcut ?? null,
        wbModules: x.cls.wbModules ?? null,
        resourceTypes: x.cls.resourceTypes ?? null,
        module: x.cls.module,
        module_rule: x.cls.moduleRule,
        overrides: x.overrides.map((o) => ({
          method: o.method,
          event_of: o.event_of,
          declared_in: o.declared_in,
          inherited: o.inherited,
          ref: pakRef(o.record),
        })),
        verdict: x.verdict,
        safe_to_call_from_handler: x.verdict === "safe",
        modal: x.modal ?? null,
        risk_hint: x.risk_hint ?? null,
        run: reachJson(x.run),
        configure: reachJson(x.configure),
        run_commandline: reachJson(x.runCommandline),
        other_entries: x.others
          .filter((r) => r.effects.some((e) => e.kind !== "cli"))
          .map((r) => reachJson(r)),
        settings: x.settings.map((s) => ({
          name: s.field.name,
          declared_in: s.declared_in,
          ref: pakRef(s.field),
        })),
        buttons: x.buttons.map((b) => ({
          method: b.method.name,
          label: b.label ?? null,
          declared_in: b.declared_in,
          ref: pakRef(b.method),
        })),
        cli: x.cli.map((c) => ({ name: c.name, written: c.written, ...site(c.effect) })),
        cli_unreadable: x.cliUnreadable.map(site),
        unverified: x.unverified,
      })),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e03-plugin-registry.ts [--build <tag>] [--game <dir>] [--data <dir>] [--out <file under observations/E03/>] [--artifacts <dir>] [--no-artifacts] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E03/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E03/ (E03 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e03-plugin-registry", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        data: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
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
      io.err(`e03-plugin-registry: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const artifactsRoot = values.artifacts ? resolve(values.artifacts) : artifactsDir();
    const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
    const vfs =
      gamePath && existsSync(join(gamePath, "addons")) ? PakVirtualFS.get(gamePath) : null;
    if (!vfs) {
      io.out(
        "NO DATA: no game install with pak files at the configured game path (ENFUSION_GAME_PATH or --game); method bodies cannot be read; nothing written",
      );
      return EXIT_USAGE;
    }
    let index = loadSourceIndex(build, { dir: artifactsRoot });
    if (!index) {
      index = buildSourceIndex(vfs, { build });
      saveSourceIndex(index, { dir: artifactsRoot });
    }
    const indexBytes = readFileSync(sourceIndexPath(build, artifactsRoot));
    const readText: TextReader = (f) => {
      try {
        return vfs.readTextFile(f);
      } catch {
        return undefined;
      }
    };
    // Scripts read for the rows (bodies and quotes), hashed over their bytes.
    const scriptBytes = new Map<string, Buffer>();
    const rowReader: TextReader = (f) => {
      const t = readText(f);
      if (t !== undefined && !scriptBytes.has(f)) scriptBytes.set(f, vfs.readFile(f));
      return t;
    };
    const result = buildRows(index, rowReader);
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(
      out,
      observationFileText(result, index, build, inputHashes(index, build, indexBytes, scriptBytes)),
    );

    const commented = commentedAttributes(
      index.files.map((f) => f.file),
      readText,
    );
    const reconFile = join(REPO_ROOT, "docs", "v2", "recon", "plugins-netapi-cli.md");
    const reconText = existsSync(reconFile) ? readFileSync(reconFile, "utf-8") : undefined;
    const counts = headlineCounts(result, commented.length, reconText, readText);
    let catalogNote = "catalog not written (--no-artifacts)";
    if (!values["no-artifacts"]) {
      const file = join(artifactsRoot, "census", build, ENUMERATOR_ID, "plugin-catalog.json");
      mkdirSync(dirname(file), { recursive: true });
      const cat = catalog(result, build, counts);
      (cat as { commented_out: unknown }).commented_out = commented;
      writeFileAtomic(file, formatJson(cat, ["$catalog", "build", "enumerator", "generator"]));
      catalogNote = `catalog -> <artifacts>/census/${build}/${ENUMERATOR_ID}/plugin-catalog.json`;
    }
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e03-plugin-registry",
          build,
          rows: result.observations.length,
          counts,
          commented_out: commented,
          scrubbed: result.scrubbed,
          dropped: result.dropped,
        }),
      );
      return EXIT_OK;
    }
    io.out(JSON.stringify(counts, null, 2));
    for (const d of result.dropped) io.out(`dropped ${d.id}: ${d.reason}`);
    for (const s of result.scrubbed) io.out(`scrubbed ${s.id}.${s.field} (machine path)`);
    io.out(catalogNote);
    io.out(
      `E03 at build ${build}: ${result.observations.length} observations (${Object.entries(
        counts.rows,
      )
        .sort()
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")}); ${counts.classes} classes, ${counts.commented_out} commented out`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
