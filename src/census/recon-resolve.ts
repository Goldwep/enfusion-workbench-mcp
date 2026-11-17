/**
 * The recon carry-over resolver (plan 4.5, gate G6 "every E01 row merged into
 * a row made by a real enumerator or explained"). E01 imported the hand-written
 * recon tables as provisional rows; a row whose id equals a measured row's id
 * merged by itself. This module proposes a resolution for every other E01 row
 * of a kind that closes offline, by rules, never by a hand list:
 *
 *   merged-via-alias:<id>   the same thing is a measured row of the same dim
 *                           under another id (applied as an alias, so the row
 *                           joins; acceptAlias's checks must hold)
 *   duplicate-of:<id>       the same thing is a measured row an alias cannot
 *                           join (another dim, another kind, or the recon row
 *                           names several things each with its own row)
 *   out-of-scope:<pak>#L<n> the thing is real, the source index declares it,
 *                           and plan 1.4 keeps it out of the ledger (a game or
 *                           engine declaration outside the seven Workbench
 *                           folders of DEC-018)
 *   absent-in-build:<what>  nothing of that name in the source index, in any
 *                           measured row or in the executable's strings
 *   recon-error:<file>#L<n> the row is not a thing of that kind at all (a GUI
 *                           function filed as a method, a settings subtree, a
 *                           heading, prose)
 *
 * Every proposal records the rule that fired and its evidence. A row no rule
 * settles goes to the unresolved list with what was tried. Rules run most
 * specific first; the first that settles a row wins. Refusals are deliberate:
 * an ambiguous name or several arities never pick one, an alias never crosses
 * dims or kinds (that is a duplicate), a list of names none of which exists
 * and a file extension alone are never ruled absent, absence is never ruled
 * without the source index and the executable strings, and a name only the
 * executable holds stays unresolved for the main session. An alias that would
 * put one recon row's reading on a row it does not describe alone (several
 * recon rows naming one target, a target that already carries a recon
 * observation, an inherited base-class member described in one module) becomes
 * a duplicate; every other alias records its `merge_effect`. `MANUAL` holds the
 * few decisions read by hand, each naming the recon line it rests on.
 *
 * Pure apart from what the caller injects (`ResolveInputs`): the ledger rows,
 * the source index, the executable's strings and a reader for the recon files.
 */
import { compareCodeUnits } from "./canon.js";
import type { Alias, Row } from "./schemas.js";
import {
  classChain,
  findClass,
  findEnum,
  methodsOf,
  pakRef,
  subclassesOf,
  type MethodRecord,
  type SourceIndex,
} from "./source-index.js";
import type { StateOverlay } from "./state.js";
import { PATH_KINDS } from "./vocab.js";

// ── Vocabulary ────────────────────────────────────────────────────────────────

export const RESOLUTION_KINDS = [
  "merged-via-alias",
  "duplicate-of",
  "out-of-scope",
  "absent-in-build",
  "recon-error",
] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

/** Who the alias of a merged-via-alias proposal names as its proposer. */
export const PROPOSED_BY = "recon-resolve";

/**
 * Plan 1.4 Workbench API scope (DEC-018). Repeats `WORKBENCH_SCOPE` of
 * `scripts/census/enumerators/e02-script-source.ts` (src cannot import
 * scripts); the test keeps the two equal.
 */
export const WORKBENCH_SCOPE = [
  "scripts/Core/generated/WorkbenchAPI/",
  "scripts/GameLib/generated/WorkbenchAPI/",
  "scripts/GameLib/workbench/",
  "scripts/Workbench/",
  "scripts/WorkbenchCommon/",
  "scripts/WorkbenchGame/",
  "scripts/WorkbenchGameCommon/",
] as const;

export function inWorkbenchScope(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return WORKBENCH_SCOPE.some((s) => p.startsWith(s.toLowerCase()));
}

/** Recon-mistake categories counted for the main session. */
export const MISTAKES = {
  freeTextId: "free-text id for a real row (label instead of the name)",
  kindMisread: "kind misread",
  documentBlock: "document block class filed as an API class",
  aggregate: "aggregate: several things in one row",
  outOfScope: "game or engine symbol outside the Workbench scope",
  nonExistent: "names something the build does not contain",
  guiFunction: "GUI function or workflow filed as an API member",
  settingsSubtree: "settings subtree or store filed as one key",
  prose: "prose or heading, not a thing of that kind",
  crossDim: "real thing filed under the wrong dimension",
  documentEnum: "value set of a document key filed as a script enum",
} as const;

// ── Inputs and outputs ────────────────────────────────────────────────────────

/** One row of a recon table, read back from the recon file at the E01 ref. */
export interface ReconLine {
  /** Recon file name (`world-editor.md`). */
  file: string;
  line: number;
  /** The raw table row. */
  raw: string;
  /** Cells by normalised header name (`feature`, `kind`, `script api`, `current mcp coverage`, ...). */
  cells: Record<string, string>;
  /** Nearest markdown heading above the table. */
  heading: string;
}

export interface ExeStrings {
  /** Offset text (`0x2faf2bc`) and string of the first executable string holding `needle` as a word. */
  find(needle: string): { offset: string; text: string } | undefined;
}

/**
 * Executable strings from E05's `ascii.tsv` (`<offset>\t<string>` per line,
 * any header line ignored). `find` tries an exact string first, then the
 * needle as a whole word inside a string (`fsm` in `bt;fsm`).
 */
export function exeStringsFromTsv(text: string): ExeStrings {
  const exact = new Map<string, string>();
  const offsets: string[] = [];
  const texts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab <= 0 || !line.startsWith("0x")) continue;
    const off = line.slice(0, tab);
    const s = line.slice(tab + 1);
    offsets.push(off);
    texts.push(s);
    if (!exact.has(s)) exact.set(s, off);
  }
  const joined = texts.join("\n");
  const starts: number[] = [];
  let p = 0;
  for (const t of texts) {
    starts.push(p);
    p += t.length + 1;
  }
  const cache = new Map<string, { offset: string; text: string } | undefined>();
  return {
    find(needle: string) {
      if (cache.has(needle)) return cache.get(needle);
      let hit: { offset: string; text: string } | undefined;
      const e = exact.get(needle);
      if (e !== undefined) hit = { offset: e, text: needle };
      else {
        const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`).exec(joined);
        if (m) {
          let lo = 0;
          let hi = starts.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= m.index) lo = mid;
            else hi = mid - 1;
          }
          hit = { offset: offsets[lo], text: texts[lo].slice(0, 80) };
        }
      }
      cache.set(needle, hit);
      return hit;
    },
  };
}

export interface ResolveInputs {
  /** Every ledger row (the built ledger). */
  rows: readonly Row[];
  /** Folded state overlays (rows that already carry a recon resolution are skipped). */
  overlays?: ReadonlyMap<string, StateOverlay>;
  /** Kinds whose universe still awaits a live enumerator (G6 reports them as open, not failed). */
  awaitsLive: ReadonlySet<string>;
  /** Accepted aliases (a proposal must not chain through one). */
  aliases?: readonly Alias[];
  source?: SourceIndex;
  exe?: ExeStrings;
  /** Lines of a recon file by name, or undefined when absent. */
  readRecon: (file: string) => readonly string[] | undefined;
  /** Manual decisions (default `MANUAL`). */
  manual?: Readonly<Record<string, ManualDecision>>;
  /**
   * The policy's candidate paths for a kind (`defaultPaths` of census-config),
   * so a merge effect can tell a row's policy defaults (same path and reason)
   * from paths a source proposed.
   */
  defaultPaths?: (kind: string) => readonly { path: string; reason: string }[];
}

export interface Proposal {
  id: string;
  recon_resolution: { kind: ResolutionKind; ref: string };
  rule: string;
  mistake: string;
  evidence: string[];
  note?: string;
  /**
   * merged-via-alias only: what the alias changes on the target when the
   * ledger is rebuilt (buildLedger takes `what` and paths from the recon
   * observation where the measured ones state none); absent when nothing changes.
   */
  merge_effect?: string[];
  /** `<file>#L<line>` of the recon row. */
  recon: string;
}

export interface Unresolved {
  id: string;
  recon: string;
  reason: string;
  tried: string[];
}

export interface ResolveResult {
  proposals: Proposal[];
  unresolved: Unresolved[];
  /** Recon rows considered (E01-only rows of kinds that close offline, not yet explained). */
  considered: number;
}

// ── Recon rows to resolve ─────────────────────────────────────────────────────

const isMeasured = (r: Row): boolean => r.sources.some((s) => s.enumerator !== "E01");

/** Kinds whose `kind:<kind>` universe lists a live enumerator (the same reading as gate G6). */
export function awaitsLiveKinds(universes: {
  universes: readonly { id: string; kind?: string; enumerators: readonly string[] }[];
}): Set<string> {
  return new Set(
    universes.universes
      .filter((u) => u.id === `kind:${u.kind}` && u.enumerators.some((e) => e.startsWith("L")))
      .map((u) => u.kind as string),
  );
}

/** The E01 rows G6 counts as hard offenders: no measured source, no resolution, no disposition, kind closes offline. */
export function reconOffenders(
  rows: readonly Row[],
  overlays: ReadonlyMap<string, StateOverlay> | undefined,
  awaitsLive: ReadonlySet<string>,
): Row[] {
  return rows
    .filter(
      (r) =>
        r.sources.some((s) => s.enumerator === "E01") &&
        !isMeasured(r) &&
        !overlays?.get(r.id)?.recon_resolution &&
        !r.disposition &&
        !awaitsLive.has(r.kind),
    )
    .sort((a, b) => compareCodeUnits(a.id, b.id));
}

// ── Recon file reading ────────────────────────────────────────────────────────

const RECON_REF = /^<repo>\/docs\/v2\/recon\/([^#/]+\.md)#L(\d+)$/;

/** `{file, line}` of an E01 source ref, or undefined. */
export function parseReconRef(ref: string): { file: string; line: number } | undefined {
  const m = RECON_REF.exec(ref);
  return m ? { file: m[1], line: Number(m[2]) } : undefined;
}

/** Splits a markdown table row into trimmed cells (pipes inside backticks are kept). */
export function splitCells(row: string): string[] {
  const t = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  let tick = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "`") tick = !tick;
    if (c === "|" && !tick && t[i - 1] !== "\\") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Header cell as a column name: emphasis, backticks and the parenthesised tail removed, lower case. */
function columnName(h: string): string {
  return h.replace(/[`*_]/g, "").replace(/\(.*$/, "").trim().toLowerCase();
}

/** Reads the recon table row at `file#Lline` with its header and heading. */
export function readReconLine(
  lines: readonly string[],
  file: string,
  line: number,
): ReconLine | undefined {
  const raw = lines[line - 1];
  if (raw === undefined || !raw.trim().startsWith("|")) return undefined;
  let top = line - 1;
  while (top > 0 && lines[top - 1].trim().startsWith("|")) top--;
  const header = splitCells(lines[top]).map(columnName);
  const cellsRaw = splitCells(raw);
  const cells: Record<string, string> = {};
  header.forEach((h, i) => {
    if (h && cells[h] === undefined) cells[h] = cellsRaw[i] ?? "";
  });
  let heading = "";
  for (let i = top - 1; i >= 0; i--) {
    if (/^#{1,6}\s/.test(lines[i])) {
      heading = lines[i].replace(/^#+\s*/, "").trim();
      break;
    }
  }
  return { file, line, raw, cells, heading };
}

function cell(r: ReconLine | undefined, ...names: string[]): string {
  if (!r) return "";
  for (const n of names) {
    for (const [k, v] of Object.entries(r.cells)) if (k === n || k.startsWith(n)) return v;
  }
  return "";
}

const NONE_CELL = /^(?:none|n\/a|-|—|same|script|none-known|\s*)$/i;

// ── Ledger index ──────────────────────────────────────────────────────────────

const API_MEMBER = /^api:([^.#/]+)\.([^/]+)\/(\d+)$/;
const API_TYPE = /^api:([^.#/]+)$/;
const SCHEMA_CLASS = /^schema:([^.#]+)$/;

function decodeSegment(s: string): string {
  return s.replace(/%2F/g, "/").replace(/%20/g, " ").replace(/%23/g, "#").replace(/%25/g, "%");
}

/** Lower-case letters and digits only (`NetAPI_Enabled` -> `netapienabled`). */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface LedgerIndex {
  byId: Map<string, Row>;
  /** Measured method / static-method / event rows by declaring class. */
  members: Map<string, Row[]>;
  /** Measured api class / enum rows by name. */
  types: Map<string, Row>;
  schemaClasses: Map<string, Row>;
  /** Measured schema-key rows by key. */
  schemaKeys: Map<string, Row[]>;
  files: Map<string, Row>;
  tools: Map<string, Row>;
  links: Row[];
  /** Measured setting rows: decoded section and key. */
  settings: { row: Row; section: string; key: string }[];
  natives: Map<string, Row>;
  /** Measured plugin-setting rows by plugin class. */
  pluginSettings: Map<string, Row[]>;
  /** Measured shortcut rows. */
  shortcuts: Row[];
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Lookup tables over the measured rows (rows with at least one non-E01 source). */
export function indexLedger(rows: readonly Row[]): LedgerIndex {
  const ix: LedgerIndex = {
    byId: new Map(),
    members: new Map(),
    types: new Map(),
    schemaClasses: new Map(),
    schemaKeys: new Map(),
    files: new Map(),
    tools: new Map(),
    links: [],
    settings: [],
    natives: new Map(),
    pluginSettings: new Map(),
    shortcuts: [],
  };
  const sorted = [...rows].sort((a, b) => compareCodeUnits(a.id, b.id));
  for (const r of sorted) {
    ix.byId.set(r.id, r);
    if (!isMeasured(r)) continue;
    if (r.kind === "shortcut") ix.shortcuts.push(r);
    let m: RegExpExecArray | null;
    if (r.dim === "api") {
      if ((m = API_MEMBER.exec(r.id))) push(ix.members, m[1], r);
      else if ((m = API_TYPE.exec(r.id)) && (r.kind === "class" || r.kind === "enum"))
        ix.types.set(m[1], r);
    } else if (r.dim === "schema") {
      if ((m = SCHEMA_CLASS.exec(r.id))) ix.schemaClasses.set(m[1], r);
      else if ((m = /^schema:([^.#]+)\.(.+)$/.exec(r.id)))
        push(ix.schemaKeys, decodeSegment(m[2]), r);
    } else if (r.dim === "file" && (m = /^file:\.(.+)$/.exec(r.id))) ix.files.set(m[1], r);
    else if (r.dim === "mcp" && (m = /^mcp:tool\/(.+)$/.exec(r.id))) ix.tools.set(m[1], r);
    else if (r.dim === "link") ix.links.push(r);
    else if (r.dim === "setting" && (m = /^setting:(.+)\/([^/]+)$/.exec(r.id)))
      ix.settings.push({ row: r, section: decodeSegment(m[1]), key: decodeSegment(m[2]) });
    else if (r.dim === "net" && (m = /^net:native\/(.+)$/.exec(r.id))) ix.natives.set(m[1], r);
    else if (r.dim === "plugin" && (m = /^plugin:([^#]+)#attr:/.exec(r.id)))
      push(ix.pluginSettings, m[1], r);
  }
  return ix;
}

function sourceRef(r: Row): string {
  const s = r.sources.find((x) => x.enumerator !== "E01") ?? r.sources[0];
  return `${r.id} <- ${s.enumerator} ${s.ref}`;
}

// ── Name extraction ───────────────────────────────────────────────────────────

/** A `Class.Member(...)` mention. `args` is undefined when the text gives no argument list or elides it. */
export interface MemberMention {
  cls: string;
  /** Member name; for a wildcard (`AudioSystem.*`, `AudioSystem.MusicProject*`) the prefix, possibly empty. */
  member: string;
  args?: number;
  wildcard?: boolean;
}

const FILE_EXT_MEMBERS = new Set([
  "c", "conf", "et", "ent", "layout", "md", "ts", "json", "txt", "meta", "emat", "st", "agf",
  "agr", "pap", "siga", "acp", "sig", "afm", "ptc", "gproj", "xob", "edds", "dds", "png",
]); // prettier-ignore

/** Number of arguments in an argument-list text, or undefined when it is elided (`...`). */
export function countArgs(text: string): number | undefined {
  const t = text.trim();
  if (t === "") return 0;
  if (t.includes("...") || t.includes("…")) return undefined;
  let depth = 0;
  let n = 1;
  for (const c of t) {
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) n++;
  }
  return n;
}

/**
 * Every `Class.Member` / `Class::Member` mention in a text, with bare names
 * that continue a list after it (`A.B / C`, `A.B, C(), D`) attributed to the
 * same class. Class names must start with an upper-case letter or `_`.
 */
export function memberMentions(text: string): MemberMention[] {
  const out: MemberMention[] = [];
  const seen = new Set<string>();
  const add = (cls: string, member: string, args: number | undefined, wildcard = false): void => {
    if (FILE_EXT_MEMBERS.has(member) && !wildcard) return;
    const k = `${cls}.${member}${wildcard ? "*" : ""}/${args ?? "?"}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(wildcard ? { cls, member, wildcard } : { cls, member, args });
  };
  // `WBProgressDialog(title, module).SetProgress` reads as `WBProgressDialog.SetProgress`.
  text = text.replace(/\b([A-Z][A-Za-z0-9_]*)\([^()]*\)\./g, "$1.");
  // A class is capitalised, or a lower-case built-in type followed by a capitalised call (`pointer.ToString()`).
  const head =
    /\b([A-Z_][A-Za-z0-9_]*|[a-z][a-z0-9]*(?=\.[A-Z][A-Za-z0-9_]*\())\s*(?:\.|::)\s*([A-Za-z_~][A-Za-z0-9_]*\*?|\*)/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(text))) {
    const cls = m[1];
    let pos = m.index + m[0].length;
    if (m[2].endsWith("*")) {
      add(cls, m[2].slice(0, -1), undefined, true);
      head.lastIndex = pos;
      continue;
    }
    const first = argsAt(text, pos);
    add(cls, m[2], first.args);
    pos = first.end;
    // Continuations: separators then a bare (not dotted) name.
    for (;;) {
      const rest =
        /^\s*(?:\/|,|\+|\bor\b|\band\b|;)\s*([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*(?:\.|::|:\s))/.exec(
          text.slice(pos),
        );
      if (!rest) break;
      const name = rest[1];
      const after = pos + rest[0].length;
      const a = argsAt(text, after);
      // A bare name only continues a member list when it looks like a method name.
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(name) && !/^_/.test(name)) break;
      add(cls, name, a.args);
      pos = a.end;
    }
    head.lastIndex = pos;
  }
  return out;
}

/** Argument list starting at `pos` (after optional spaces), with its count. */
function argsAt(text: string, pos: number): { args: number | undefined; end: number } {
  let i = pos;
  while (text[i] === " ") i++;
  if (text[i] !== "(") return { args: undefined, end: pos };
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === "(") depth++;
    else if (text[j] === ")") {
      depth--;
      if (depth === 0) return { args: countArgs(text.slice(i + 1, j)), end: j + 1 };
    }
  }
  return { args: undefined, end: pos };
}

const TYPE_LIKE = /^[A-Z][A-Za-z0-9_]*$/;
/**
 * An identifier that reads as a type name rather than an English word: it
 * holds an underscore, or two capitals and a lower-case letter
 * (`IOPItemOpAbsClass`, `ACPClass`, `SCR_X`, `RotationSet`; not `Sound`, `IK`).
 */
export function looksLikeType(s: string): boolean {
  return (
    TYPE_LIKE.test(s) &&
    s.length >= 4 &&
    (/_/.test(s) || ((s.match(/[A-Z]/g)?.length ?? 0) >= 2 && /[a-z]/.test(s)))
  );
}

/**
 * Type names a label or cell names: parenthesised identifiers
 * (`Abs (IOPItemOpAbsClass) x29`), else every type-like word of a list
 * (`AnimSrcIkTargetBinding / AnimSrcNodeIK2BoneTarget`, `A, B (obsolete), C`,
 * `Events: A / B`, `X : Base; Y`, `PAP node RotationSet`). Counts and
 * parenthesised prose are dropped.
 */
export function typeMentions(text: string, opts: { keepParens?: boolean } = {}): string[] {
  const t = text.replace(/`/g, "");
  const paren = [...t.matchAll(/\(([A-Za-z_][A-Za-z0-9_]*)\)/g)]
    .map((m) => m[1])
    .filter(looksLikeType);
  if (paren.length) return [...new Set(paren)];
  const out: string[] = [];
  for (const seg of t.split(/;/)) {
    // `Label: list` (no space before the colon) reads the list; `X : Base` keeps X (a declaration).
    const colon = /^([^:(]*?[a-z]):\s+(.*)$/.exec(seg);
    // `SCR_EScriptTemplateType: None, Entity` names the type before the colon too.
    const lead = colon?.[1].trim();
    if (lead && looksLikeType(lead) && !out.includes(lead)) out.push(lead);
    const raw = colon ? colon[2] : seg;
    const body = (
      opts.keepParens ? raw.replace(/[()]/g, " ") : raw.replace(/\([^)]*\)/g, " ")
    ).split(/\s:\s/)[0];
    // List separators; a slash only separates when spaced (`A / B`), a path (`Prefabs/X/Y`) is no list.
    for (const part of body.split(/\s+\/\s+|\s*,\s*|\s+\+\s+|\s+and\s+|\s+or\s+/)) {
      for (const w of part.trim().split(/\s+/)) {
        if (w.includes("/")) continue;
        const word = w.replace(/[.:]+$/, "");
        if (looksLikeType(word) && !out.includes(word)) out.push(word);
      }
    }
  }
  return out;
}

/**
 * Prefixes of a type name at capital boundaries, longest first
 * (`AnimSrcNodeIK2TwoBoneSolver` -> `AnimSrcNodeIK2TwoBone`, ..., `Anim`).
 */
export function capitalPrefixes(name: string): string[] {
  const out: string[] = [];
  for (let i = name.length - 1; i > 0; i--) {
    if (/[A-Z]/.test(name[i]) && /[a-z0-9]/.test(name[i - 1])) out.push(name.slice(0, i));
  }
  return out;
}

/**
 * File extensions a text names (`.agf`, `*_SMD.conf`, `16-bit .png`,
 * `resourceDatabase.rdb`), lower-cased, in order. A chain such as `.ent.meta`
 * yields its last part only.
 */
export function extMentions(text: string): string[] {
  const out: string[] = [];
  // A dotted segment followed by `/` is a folder (`profile/.save/settings/`), not an extension.
  for (const m of text.matchAll(/((?:\.[A-Za-z][A-Za-z0-9]{0,7})+)(?![A-Za-z0-9_/])/g)) {
    const before = text[m.index - 1] ?? " ";
    // `Class.Method` and `e.g.` are not extensions: a dotted chain after a
    // capitalised identifier is a member access unless it is lower case.
    const chain = m[1].split(".").filter(Boolean);
    const e = chain[chain.length - 1];
    if (/[A-Z]/.test(e)) continue;
    if (/[A-Za-z0-9_]/.test(before) && chain.length === 1 && e.length === 1) continue;
    const lc = e.toLowerCase();
    if (!out.includes(lc)) out.push(lc);
  }
  return out;
}

/** Upper-case format names a label uses for a file type without its extension (`Object import CSV`). */
export function formatWords(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(CSV|TSV|JSON|XML|INI|YAML|TXT)\b/g)].map((m) => m[1]))];
}

/** snake_case tool names a text names. */
export function toolMentions(text: string): string[] {
  return [...new Set([...text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)].map((m) => m[0]))];
}

// ── Resolution of names ───────────────────────────────────────────────────────

type Found =
  | { status: "measured"; row: Row; evidence: string }
  | { status: "out-of-scope"; ref: string; evidence: string }
  | { status: "in-scope-no-row"; ref: string; evidence: string }
  | { status: "ambiguous"; evidence: string }
  | { status: "exe-only"; evidence: string }
  /** `searched` names the inputs searched, for the absent-in-build ref. */
  | { status: "absent"; evidence: string; searched?: string }
  /** Not found, but an input absence needs (the source index, the executable strings) was not loaded. */
  | { status: "unsearched"; evidence: string };

/** The inputs an absence ruling needs that were not loaded, or undefined when all were. */
function missingInputs(
  source: SourceIndex | undefined,
  exe: ExeStrings | undefined,
  needs: { source?: boolean; exe?: boolean },
): string | undefined {
  const missing = [
    needs.source && !source ? "the source index" : undefined,
    needs.exe && !exe ? "the executable strings" : undefined,
  ].filter(Boolean);
  return missing.length ? `${missing.join(" and ")} not loaded` : undefined;
}

const METHOD_KINDS = new Set(["method", "static-method", "event"]);
const TYPE_KINDS = new Set(["class", "enum"]);

function arityFits(m: { arity: number; required: number }, args: number | undefined): boolean {
  return args === undefined || (args >= m.required && args <= m.arity);
}

/**
 * Resolves `Class.Member(args)` through the source index: the declaration in
 * the class or its ancestors (methods first, then fields and enum values),
 * then the measured row of the declaring class, else the declaration (out of
 * scope or in scope without a row). Without a source declaration it falls
 * back to the measured rows of that class. The executable is not consulted
 * for member names: it holds every common word (`Set`, `Load`).
 * A wildcard (`AudioSystem.*`, `AudioSystem.MusicProject*`) resolves to the
 * first member with that prefix, constructor and destructor excepted, and
 * counts the rest; the api-member rule first replaces a bare class wildcard
 * by the member names the row's other cells give.
 */
export function resolveMember(
  mm: MemberMention,
  ix: LedgerIndex,
  source: SourceIndex | undefined,
): Found {
  const label = mm.wildcard
    ? `${mm.cls}.${mm.member}*`
    : `${mm.cls}.${mm.member}${mm.args === undefined ? "" : `/${mm.args}`}`;
  if (source) {
    const all = methodsOf(source, mm.cls);
    // A wildcard never stands for the constructor or destructor (`AudioSystem.*` is not `AudioSystem()`).
    const views = mm.wildcard
      ? all.filter(
          (v) =>
            v.method.name.startsWith(mm.member) &&
            v.method.name !== v.declared_in &&
            !v.method.name.startsWith("~"),
        )
      : all.filter((v) => v.method.name === mm.member);
    if (views.length) {
      if (mm.wildcard) {
        const first = views[0];
        const id = `api:${first.declared_in}.${first.method.name}/${first.method.arity}`;
        const row = ix.byId.get(id);
        const count = `${views.length} member(s) match ${label}`;
        if (row && isMeasured(row))
          return { status: "measured", row, evidence: `${count}; first ${sourceRef(row)}` };
        const ref = pakRef(first.method);
        if (!inWorkbenchScope(first.method.file))
          return { status: "out-of-scope", ref, evidence: `${count}; first declared at ${ref}` };
        return {
          status: "in-scope-no-row",
          ref,
          evidence: `${count}; ${id} declared in scope at ${ref} but has no measured row`,
        };
      }
      const fit = views.filter((v) => arityFits(v.method, mm.args));
      const pool = fit.length ? fit : mm.args === undefined ? views : [];
      if (pool.length === 0)
        return {
          status: "ambiguous",
          evidence: `${label}: ${views.length} declaration(s), none takes ${mm.args} argument(s)`,
        };
      const ids = [
        ...new Set(pool.map((v) => `api:${v.declared_in}.${v.method.name}/${v.method.arity}`)),
      ];
      if (ids.length > 1)
        return { status: "ambiguous", evidence: `${label}: several arities (${ids.join(", ")})` };
      const row = ix.byId.get(ids[0]);
      const decl = pool[0].method;
      if (row && isMeasured(row)) return { status: "measured", row, evidence: sourceRef(row) };
      const ref = pakRef(decl);
      if (!inWorkbenchScope(decl.file))
        return {
          status: "out-of-scope",
          ref,
          evidence: `source-index ${label} declared at ${ref}`,
        };
      return {
        status: "in-scope-no-row",
        ref,
        evidence: `${label} declared in scope at ${ref} but has no measured row ${ids[0]}`,
      };
    }
    if (!mm.wildcard) {
      // Fields and enum values (`SearchResourcesFilter.tags`).
      const chain = classChain(source, mm.cls);
      for (const c of chain) {
        const f = c.fields.find((x) => x.name === mm.member);
        if (f) {
          const ref = pakRef(f);
          if (!inWorkbenchScope(f.file))
            return {
              status: "out-of-scope",
              ref,
              evidence: `source-index field ${label} declared at ${ref}`,
            };
          return {
            status: "in-scope-no-row",
            ref,
            evidence: `field ${label} declared in scope at ${ref}; fields are not ledger rows`,
          };
        }
      }
    }
  }
  // No source declaration: the ledger alone (a class E02 measured but the index lacks).
  const rows = (ix.members.get(mm.cls) ?? []).filter((r) =>
    mm.wildcard ? (r.label ?? "").startsWith(mm.member) : r.label === mm.member,
  );
  if (rows.length === 1 || (mm.wildcard && rows.length > 1))
    return { status: "measured", row: rows[0], evidence: sourceRef(rows[0]) };
  if (rows.length > 1) {
    const arity = rows.filter((r) => mm.args !== undefined && r.id.endsWith(`/${mm.args}`));
    if (arity.length === 1)
      return { status: "measured", row: arity[0], evidence: sourceRef(arity[0]) };
    return {
      status: "ambiguous",
      evidence: `${label}: several arities (${rows.map((r) => r.id).join(", ")})`,
    };
  }
  const missing = missingInputs(source, undefined, { source: true });
  if (missing)
    return {
      status: "unsearched",
      evidence: `${label}: no measured api row; ${missing}, so absence is not ruled`,
    };
  const declared =
    !!source && (classChain(source, mm.cls).length > 0 || !!findEnum(source, mm.cls));
  return {
    status: "absent",
    evidence: `searched the source index (${mm.cls} and its ancestors: methods, fields) and the measured api rows for ${label}${declared ? "" : `; class ${mm.cls} is not declared either`}`,
    searched: "source index, measured api rows",
  };
}

/**
 * Resolves a bare method name (`SaveContainer`, `FixSoundMetaFile`): every
 * method of that name in the source index; one declaring class makes it a
 * member mention, several are ambiguous.
 */
export function resolveBareMethod(
  name: string,
  ix: LedgerIndex,
  source: SourceIndex | undefined,
): Found | undefined {
  if (!source) return undefined;
  const owners = [
    ...new Set(
      source.records
        .filter((r) => r.kind === "method" && r.name === name && r.owner !== undefined)
        .map((r) => (r as MethodRecord).owner as string),
    ),
  ];
  if (owners.length === 0) return undefined;
  if (owners.length > 1) {
    // A modded class or a subclass override repeats the name: prefer the root declaration.
    const roots = owners.filter(
      (o) => !owners.some((p) => p !== o && classChain(source, o).some((c) => c.name === p)),
    );
    // Several unrelated classes: the recon cites engine API, so one native (`proto`) declaration decides.
    const native = roots.filter((o) =>
      source.records.some(
        (r) =>
          r.kind === "method" && r.owner === o && r.name === name && r.modifiers.includes("proto"),
      ),
    );
    const pick = roots.length === 1 ? roots : native.length === 1 ? native : [];
    if (pick.length !== 1)
      return {
        status: "ambiguous",
        evidence: `bare ${name}: declared in ${owners.slice(0, 6).join(", ")}`,
      };
    return resolveMember({ cls: pick[0], member: name }, ix, source);
  }
  return resolveMember({ cls: owners[0], member: name }, ix, source);
}

/**
 * Resolves a type name: measured api class or enum, source declaration,
 * schema block class (also `<name>Class`, the document spelling of a short
 * node name), else the executable.
 */
export function resolveType(
  name: string,
  ix: LedgerIndex,
  source: SourceIndex | undefined,
  exe: ExeStrings | undefined,
  opts: { preferSchema?: boolean } = {},
): Found {
  const t = ix.types.get(name);
  if (t) return { status: "measured", row: t, evidence: sourceRef(t) };
  // In a list of document blocks a measured schema class beats a script declaration of the same name.
  const early = opts.preferSchema ? ix.schemaClasses.get(name) : undefined;
  if (early) return { status: "measured", row: early, evidence: sourceRef(early) };
  if (source) {
    const c = findClass(source, name);
    const decl =
      c?.declarations.find((d) => !d.modded && !d.forward) ??
      c?.declarations.find((d) => !d.forward) ??
      findEnum(source, name)?.declarations[0];
    if (decl) {
      const ref = pakRef(decl);
      if (!inWorkbenchScope(decl.file))
        return { status: "out-of-scope", ref, evidence: `source-index ${name} declared at ${ref}` };
      return {
        status: "in-scope-no-row",
        ref,
        evidence: `${name} declared in scope at ${ref} but has no measured api:${name}`,
      };
    }
  }
  for (const n of name.endsWith("Class") ? [name] : [name, `${name}Class`]) {
    const s = ix.schemaClasses.get(n);
    if (s) return { status: "measured", row: s, evidence: sourceRef(s) };
  }
  for (const n of name.endsWith("Class") ? [name] : [name, `${name}Class`]) {
    const hit = exe?.find(n);
    if (hit)
      return {
        status: "exe-only",
        evidence: `${n}: no measured row, not in the source index; executable string at ${hit.offset} "${hit.text}"`,
      };
  }
  // A member of that name is no type, but no proof of absence either.
  const members = source?.records.filter(
    (r) => (r.kind === "method" || r.kind === "field") && r.name === name,
  );
  if (members?.length)
    return {
      status: "ambiguous",
      evidence: `${name} is declared as a member (${[...new Set(members.map((r) => ("owner" in r ? r.owner : "?") ?? "?"))].slice(0, 4).join(", ")}), not as a type`,
    };
  const missing = missingInputs(source, exe, { source: true, exe: true });
  if (missing)
    return {
      status: "unsearched",
      evidence: `${name}: no measured api or schema row; ${missing}, so absence is not ruled`,
    };
  return {
    status: "absent",
    evidence: `searched measured api and schema rows, the source index (classes, enums, typedefs) and the executable strings for ${name}${name.endsWith("Class") ? "" : ` and ${name}Class`}`,
    searched: "source index, measured api and schema rows, executable strings",
  };
}

/**
 * Resolves the names of a list in which later items may be abbreviated
 * against the first (`AnimSrcNodeIK2TwoBoneSolver, LookAtSolver` ->
 * `AnimSrcNodeIK2LookAtSolver`; `AnimSrcConstraintPosition, Parent` ->
 * `AnimSrcConstraintParent`). An item that resolves as written keeps that.
 */
export function resolveTypeList(
  names: readonly string[],
  ix: LedgerIndex,
  source: SourceIndex | undefined,
  exe: ExeStrings | undefined,
  opts: { preferSchema?: boolean } = {},
): { name: string; f: Found }[] {
  const out: { name: string; f: Found }[] = [];
  const firstFull = names.find((n) => looksLikeType(n));
  const settled = (f: Found): boolean => f.status === "measured" || f.status === "out-of-scope";
  for (const n of names) {
    let f: Found | undefined;
    let shown = n;
    // A plain word after a full name is an abbreviation of the list's prefix
    // (`BtVariableEntity, Group` -> `BtVariableGroup`, not the audio `GroupClass`): try that first.
    const abbreviated = firstFull !== undefined && n !== firstFull && !looksLikeType(n);
    const viaPrefix = (): void => {
      for (const p of capitalPrefixes(firstFull as string)) {
        if (n.startsWith(p)) continue;
        const g = resolveType(`${p}${n}`, ix, source, exe, opts);
        if (settled(g) || (g.status === "exe-only" && (!f || f.status === "absent"))) {
          f = g;
          shown = `${p}${n}`;
          if (settled(g)) break;
        }
      }
    };
    if (abbreviated) viaPrefix();
    if (!f || !settled(f)) {
      const own = resolveType(n, ix, source, exe, opts);
      if (!f || settled(own) || (own.status === "exe-only" && f.status === "absent")) {
        f = own;
        shown = n;
      }
    }
    if (
      !abbreviated &&
      firstFull &&
      n !== firstFull &&
      (!settled(f) || (opts.preferSchema && f.status !== "measured"))
    ) {
      const before = { f, shown };
      viaPrefix();
      // Under preferSchema only a measured completion replaces a script declaration.
      if (opts.preferSchema && before.f && settled(before.f) && f?.status !== "measured") {
        f = before.f;
        shown = before.shown;
      }
    }
    out.push({ name: shown, f: f as Found });
  }
  return out;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/** What a rule sees of one recon row. */
export interface RowView {
  row: Row;
  recon?: ReconLine;
  reconRef: string;
  /** The row's own E01 quote. */
  quote: string;
  label: string;
  /** Recon kind cell, lower case. */
  reconKind: string;
  /** Script API cell (or the row's signature). */
  api: string;
  coverage: string;
  what: string;
  /** Automation-path cell (`file-format (.conf)`). */
  automation: string;
  aggregate: boolean;
}

export interface RuleContext {
  ix: LedgerIndex;
  source?: SourceIndex;
  exe?: ExeStrings;
  aliases: readonly Alias[];
  readRecon: ResolveInputs["readRecon"];
}

type RuleOutcome =
  | { proposal: Omit<Proposal, "id" | "recon"> }
  | { unresolved: { reason: string; tried: string[] } }
  | null;

interface Rule {
  name: string;
  applies: (v: RowView, c: RuleContext) => boolean;
  run: (v: RowView, c: RuleContext) => RuleOutcome;
}

function proposal(
  kind: ResolutionKind,
  ref: string,
  rule: string,
  mistake: string,
  evidence: string[],
  note?: string,
): RuleOutcome {
  return { proposal: { recon_resolution: { kind, ref }, rule, mistake, evidence, note } };
}

/** True when the alias `from -> to` passes acceptAlias's checks (dims, dispositions, chains). */
export function aliasAcceptable(
  from: Row,
  to: Row,
  aliases: readonly Alias[],
): { ok: true } | { ok: false; why: string } {
  if (from.id === to.id) return { ok: false, why: "same id" };
  if (from.dim !== to.dim)
    return { ok: false, why: `alias across dims (${from.dim} -> ${to.dim})` };
  if (from.disposition || to.disposition) return { ok: false, why: "a row carries a disposition" };
  const enums = new Set([...from.sources, ...to.sources].map((s) => s.enumerator));
  if (enums.size === 1) return { ok: false, why: "both ids come from one enumerator" };
  if (aliases.some((a) => a.from === from.id))
    return { ok: false, why: `${from.id} is already aliased` };
  if (aliases.some((a) => a.from === to.id))
    return { ok: false, why: `${to.id} is itself an alias` };
  if (aliases.some((a) => a.to === from.id))
    return { ok: false, why: `${from.id} is an alias target` };
  return { ok: true };
}

/**
 * The common decision for a list of resolved names: one name that is a
 * measured row of the same dim and compatible kind merges by alias; several,
 * or another dim or kind, make a duplicate; only out-of-scope declarations
 * make out-of-scope; nothing anywhere makes absent-in-build. Mixed or
 * executable-only results stay unresolved.
 */
function decide(
  v: RowView,
  c: RuleContext,
  rule: string,
  foundIn: { name: string; f: Found }[],
  compatible: (target: Row) => boolean,
  mistakes: { alias: string; duplicate: string; scope: string },
): RuleOutcome {
  // Two mentions of the same thing (`X.M(a, b)` in one cell, `X.M` in another) count once.
  const seen = new Set<string>();
  const found = foundIn.filter((x) => {
    const k =
      x.f.status === "measured"
        ? x.f.row.id
        : x.f.status === "out-of-scope" || x.f.status === "in-scope-no-row"
          ? x.f.ref
          : `${x.f.status}:${x.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (found.length === 0) return null;
  const evidence = found.map((x) => `${x.name}: ${x.f.evidence}`);
  const ambiguous = found.filter((x) => x.f.status === "ambiguous");
  const measured = found.filter((x) => x.f.status === "measured") as {
    name: string;
    f: Extract<Found, { status: "measured" }>;
  }[];
  const several = found.length > 1 || v.aggregate;
  const describe = (x: { name: string; f: Found }): string =>
    `${x.name} -> ${x.f.status === "measured" ? x.f.row.id : x.f.status === "out-of-scope" ? `out of scope ${x.f.ref}` : x.f.status}`;
  const listNote = several
    ? `names ${found.length} thing(s): ${found.map(describe).join("; ")}`
    : undefined;
  if (ambiguous.length && !several)
    return {
      unresolved: {
        reason: `ambiguous: ${ambiguous[0].f.evidence}`,
        tried: [rule, ...evidence],
      },
    };
  if (measured.length) {
    // Prefer a measured row of the recon row's own dim.
    const best = measured.find((x) => x.f.row.dim === v.row.dim) ?? measured[0];
    const target = best.f.row;
    if (!several && compatible(target)) {
      const ok = aliasAcceptable(v.row, target, c.aliases);
      if (ok.ok) {
        const mistake =
          target.kind === v.row.kind
            ? mistakes.alias
            : `${MISTAKES.kindMisread} (${v.row.kind} -> ${target.kind})`;
        return proposal("merged-via-alias", target.id, rule, mistake, evidence);
      }
      return proposal(
        "duplicate-of",
        target.id,
        rule,
        mistakes.duplicate,
        evidence,
        `alias refused: ${ok.why}`,
      );
    }
    const mistake = several
      ? MISTAKES.aggregate
      : target.dim !== v.row.dim
        ? mistakes.duplicate
        : `${MISTAKES.kindMisread} (${v.row.kind} -> ${target.kind})`;
    return proposal("duplicate-of", target.id, rule, mistake, evidence, listNote);
  }
  const scoped = found.filter((x) => x.f.status === "out-of-scope");
  if (
    scoped.length &&
    found.every(
      (x) => x.f.status === "out-of-scope" || x.f.status === "absent" || x.f.status === "ambiguous",
    )
  ) {
    const first = scoped[0].f as Extract<Found, { status: "out-of-scope" }>;
    return proposal(
      "out-of-scope",
      first.ref,
      rule,
      several ? MISTAKES.aggregate : mistakes.scope,
      evidence,
      listNote,
    );
  }
  if (found.every((x) => x.f.status === "absent")) {
    // A list of names none of which exists is more likely prose than a claim; only a single name is ruled absent.
    if (several)
      return {
        unresolved: {
          reason:
            "a list of names none of which the build holds (prose, or names the recon shortened)",
          tried: [rule, ...evidence],
        },
      };
    const searched = (found[0].f as Extract<Found, { status: "absent" }>).searched;
    if (!searched)
      return {
        unresolved: {
          reason: "found nowhere, but the rule cannot say which inputs it searched",
          tried: [rule, ...evidence],
        },
      };
    return proposal(
      "absent-in-build",
      `${found[0].name} (${searched})`,
      rule,
      MISTAKES.nonExistent,
      evidence,
    );
  }
  return {
    unresolved: {
      reason: found.some((x) => x.f.status === "unsearched")
        ? "input not loaded: a name was found nowhere, but absence is only ruled with the source index and the executable strings loaded"
        : found.some((x) => x.f.status === "exe-only")
          ? "executable-only name: the executable holds it, no measured row and no script declaration"
          : found.some((x) => x.f.status === "in-scope-no-row")
            ? "declared inside the Workbench scope but no measured row"
            : "mixed results",
      tried: [rule, ...evidence],
    },
  };
}

const isApi = (v: RowView): boolean => v.row.dim === "api";

/** Recon kind cells that describe a GUI function or workflow rather than an API member. */
const GUI_KINDS = /^(?:function|plugin hook|plugin-hook|feature|action|gesture|workflow)$/;

const MEMBER_MISTAKES = {
  alias: MISTAKES.freeTextId,
  duplicate: MISTAKES.crossDim,
  scope: MISTAKES.outOfScope,
};

function memberTexts(v: RowView): string {
  return [v.api, v.row.signature ?? ""].filter((s) => s && !NONE_CELL.test(s)).join(" ; ");
}

/** Member mentions of the API cell and signature; the label's only when those name none (`pointer.ToString()`). */
function apiMentions(v: RowView): MemberMention[] {
  const own = memberMentions(memberTexts(v));
  return own.length ? own : memberMentions(v.label);
}

/**
 * A bare class wildcard (`AudioSystem.*`) replaced by the members of that
 * class the label or what cell names (`IsSoundPlayed, TerminateSound, ...`),
 * in the order named; undefined when it is no bare wildcard or names none.
 */
function namedMembers(m: MemberMention, v: RowView, c: RuleContext): MemberMention[] | undefined {
  if (!m.wildcard || m.member !== "" || !c.source) return undefined;
  const declared = new Set(methodsOf(c.source, m.cls).map((x) => x.method.name));
  const names = [
    ...new Set(
      [...`${v.label} ${v.what}`.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)]
        .map((x) => x[1])
        .filter((n) => declared.has(n) && n !== m.cls),
    ),
  ];
  return names.length ? names.map((member) => ({ cls: m.cls, member })) : undefined;
}

/** Bare capitalised method-like names of an API cell that carry no class (`CreateContainer(class) + SaveContainer`). */
function bareNames(text: string): string[] {
  const t = text.replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*(?:\.|::)\s*[A-Za-z_~][A-Za-z0-9_]*\*?/g, " ");
  return [
    ...new Set(
      [...t.matchAll(/\b([A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+)\b/g)]
        .map((m) => m[1])
        .filter(
          (n) =>
            !looksLikeType(n) ||
            /^(?:Get|Set|Is|Has|Create|Read|Write|Save|Load|Fix|On|Find|Do|Check|Register|Rebuild|Clear|Make|Run|Remove|Add)[A-Z]/.test(
              n,
            ),
        ),
    ),
  ];
}

/**
 * Plugin classes a plugin-setting row may belong to, nearest first: its own
 * cells, else the rows above when the recon refers to them with "same file".
 */
function pluginClassesOf(v: RowView, readRecon: RuleContext["readRecon"]): string[] {
  const all = (s: string): string[] =>
    [...s.matchAll(/\b(SCR_[A-Za-z0-9_]*Plugin)\b/g)].map((m) => m[1]);
  const own = all(`${v.api} ${v.row.signature ?? ""} ${v.recon?.raw ?? ""}`);
  if (own.length || !v.recon || !/\bsame file\b/i.test(v.recon.raw)) return own;
  const lines = readRecon(v.recon.file) ?? [];
  const out: string[] = [];
  for (let i = v.recon.line - 2; i >= Math.max(0, v.recon.line - 6); i--)
    for (const n of all(lines[i] ?? "")) if (!out.includes(n)) out.push(n);
  return out;
}

/**
 * NET natives a row names: `built-in NET func X` in the API cell, or
 * `builtin-net-handler (X, ...)` in the automation cell when X is a measured native.
 */
function netNativeNames(v: RowView, c: RuleContext): string[] {
  const out = [...v.api.matchAll(/built-in NET func\s+([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  // Only when the API cell offers no script call (`none (built-in NET function)`) and the label is
  // the native's own name in words: a GUI gesture whose automation path is a native stays a gesture.
  if (out.length === 0 && /^\s*none\b/i.test(v.api))
    for (const m of (v.recon?.raw ?? "").matchAll(
      /builtin-net-handler\s*\(([A-Za-z][A-Za-z0-9_]*)/g,
    ))
      if (c.ix.natives.has(m[1]) && normName(m[1]) === normName(v.label) && !out.includes(m[1]))
        out.push(m[1]);
  return out;
}

/** Short node names of the shared IOP library (audio `.sig`, ProcAnim `.siga`) and the class spellings tried for them. */
const IOP_TEMPLATES = ["IOPItemOp%Class", "IOPInput%Class", "SignalOp%Class", "%Class"] as const;

function iopNames(label: string): string[] {
  const list = label.replace(/^[^,]*?\b(?:ops|inputs|math ops)\s+/i, "");
  if (list === label) return [];
  return list
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Z][A-Za-z0-9]*$/.test(s));
}

const RULES: readonly Rule[] = [
  // ── net natives named in an API cell ─────────────────────────────────────
  {
    name: "net-native",
    applies: (v, c) => isApi(v) && netNativeNames(v, c).length > 0,
    run: (v, c) => {
      const names = netNativeNames(v, c);
      const found = names.map((n) => {
        const r = c.ix.natives.get(n);
        const hit = r ? undefined : c.exe?.find(n);
        const f: Found = r
          ? { status: "measured", row: r, evidence: sourceRef(r) }
          : hit
            ? {
                status: "exe-only",
                evidence: `no measured net:native/${n}; executable string at ${hit.offset}`,
              }
            : c.exe
              ? {
                  status: "absent",
                  evidence: `no measured net:native/${n} and no executable string ${n}`,
                  searched: "measured net rows, executable strings",
                }
              : {
                  status: "unsearched",
                  evidence: `no measured net:native/${n}; the executable strings not loaded`,
                };
        return { name: n, f };
      });
      return decide(v, c, "net-native", found, () => false, {
        alias: MISTAKES.crossDim,
        duplicate: MISTAKES.crossDim,
        scope: MISTAKES.outOfScope,
      });
    },
  },
  // ── The recon itself states the name is absent from the executable ──────
  {
    name: "recon-declared-absence",
    applies: (v) =>
      /\bno `([A-Za-z_][A-Za-z0-9_]*)`(?: string)? in (?:the )?exe\b/.test(v.recon?.raw ?? v.quote),
    run: (v, c) => {
      const name = /\bno `([A-Za-z_][A-Za-z0-9_]*)`(?: string)? in (?:the )?exe\b/.exec(
        v.recon?.raw ?? v.quote,
      )?.[1] as string;
      const f = resolveType(name, c.ix, c.source, c.exe);
      if (f.status !== "absent") return null;
      return proposal(
        "absent-in-build",
        `${name} (source index, measured api and schema rows, executable strings)`,
        "recon-declared-absence",
        MISTAKES.nonExistent,
        [`recon: "no \`${name}\` in exe"`, f.evidence],
        "a wiki-only node: the recon found no class string for it, and none of the build's sources holds it",
      );
    },
  },
  // ── Value enums of document keys (`Enum BlendFn`) ────────────────────────
  {
    name: "schema-key-enum",
    applies: (v) => isApi(v) && v.row.kind === "enum" && /^Enum\s+\S/.test(v.label),
    run: (v, c) => {
      const keys = v.label
        .replace(/^Enum\s+/, "")
        .split(/\s*\/\s*/)
        .map((k) => k.trim().split(/\s+/)[0]);
      const found: { name: string; f: Found }[] = [];
      const users: string[] = [];
      for (const k of keys) {
        const rows = (c.ix.schemaKeys.get(k) ?? []).filter((r) => r.kind === "schema-key");
        if (rows.length === 0) continue;
        users.push(`${k}: ${rows.map((r) => r.id).join(", ")}`);
        found.push({
          name: k,
          f: {
            status: "measured",
            row: rows[0],
            evidence: `${rows.length} schema key(s) named ${k}; first ${sourceRef(rows[0])}`,
          },
        });
      }
      if (found.length === 0) return null;
      const out = proposal(
        "duplicate-of",
        (found[0].f as Extract<Found, { status: "measured" }>).row.id,
        "schema-key-enum",
        MISTAKES.documentEnum,
        found.map((x) => `${x.name}: ${x.f.evidence}`),
        `the value set of a document key, not a script enum; keys using it: ${users.join("; ")}`,
      );
      return out;
    },
  },
  // ── Type names of class, enum and attribute rows ─────────────────────────
  {
    name: "api-type",
    applies: (v) =>
      isApi(v) &&
      (TYPE_KINDS.has(v.row.kind) || v.row.kind === "attribute") &&
      typeMentions(v.label).length > 0,
    run: (v, c) => {
      // A list label whose items are partly plain words (`Mixer Filter / FilterChain / Variable / Signal / Group`)
      // names the rest in the what cell (`FilterClass x28, FilterChainClass x6, ...`): read both.
      // A parenthesised class (`Amplitude (AmplitudeClass) x1,175`) is the row's own name: no list.
      const names = typeMentions(v.label);
      const items = /\([A-Za-z_][A-Za-z0-9_]*\)/.test(v.label)
        ? 0
        : v.label.split(/\s+\/\s+|\s*,\s*/).filter((s) => /[A-Za-z]/.test(s)).length;
      if (items > names.length)
        for (const n of typeMentions(v.what, { keepParens: true }))
          if (!names.includes(n)) names.push(n);
      return typeDecision(v, c, "api-type", resolveTypeList(names, c.ix, c.source, c.exe));
    },
  },
  // ── Short IOP node names (`SIGA ops Sin, Cos, Tan`) ──────────────────────
  {
    name: "iop-op-names",
    applies: (v) => isApi(v) && iopNames(v.label).length > 1,
    run: (v, c) => {
      const found = iopNames(v.label).map((n) => {
        let best: { name: string; f: Found } | undefined;
        for (const t of IOP_TEMPLATES) {
          const name = t.replace("%", n);
          const s = c.ix.schemaClasses.get(name);
          if (s) {
            best = { name, f: { status: "measured", row: s, evidence: sourceRef(s) } };
            break;
          }
          const hit = c.exe?.find(name);
          if (hit && !best)
            best = {
              name,
              f: { status: "exe-only", evidence: `${name}: executable string at ${hit.offset}` },
            };
        }
        const spellings = IOP_TEMPLATES.map((t) => t.replace("%", n)).join(", ");
        return (
          best ?? {
            name: n,
            f: (c.exe
              ? {
                  status: "absent",
                  evidence: `no schema row or executable string for ${spellings}`,
                  searched: "measured schema rows, executable strings",
                }
              : {
                  status: "unsearched",
                  evidence: `no schema row for ${spellings}; the executable strings not loaded`,
                }) as Found,
          }
        );
      });
      return decide({ ...v, aggregate: true }, c, "iop-op-names", found, () => false, {
        alias: MISTAKES.aggregate,
        duplicate: MISTAKES.aggregate,
        scope: MISTAKES.outOfScope,
      });
    },
  },
  // ── Types listed in the "what" cell of a sub-structure or node group ─────
  // (before the API cell: `Variables | BtVariableEntity, Vector, ... | Node.GetVariableIn`
  // is the document block list, the cell only says how script reads it)
  {
    name: "api-type-what",
    applies: (v) =>
      isApi(v) &&
      TYPE_KINDS.has(v.row.kind) &&
      // A parenthesised class in the label is the row's own name; a bare word (`VarSet items`) is not.
      !/\([A-Za-z_][A-Za-z0-9_]*\)/.test(v.label) &&
      typeMentions(v.what, { keepParens: true }).length > 0,
    run: (v, c) => {
      const names = typeMentions(v.what, { keepParens: true });
      // Short continuations of a list (`AnimSrcNodeIK2TwoBoneSolver 326, LookAtSolver 207`).
      const shorts = [...v.what.matchAll(/(?:^|,\s*|\/\s*)([A-Z][A-Za-z0-9]+)\b/g)].map(
        (m) => m[1],
      );
      const all = [...names, ...shorts.filter((s) => !names.includes(s))];
      const resolved = resolveTypeList(all, c.ix, c.source, c.exe, { preferSchema: true });
      const found = resolved.filter(
        (x) => x.f.status === "measured" || x.f.status === "out-of-scope",
      );
      if (found.length === 0) {
        // Only executable strings: report the row as executable-only rather than "no match".
        const exe = resolved.filter((x) => x.f.status === "exe-only");
        return exe.length
          ? decide({ ...v, aggregate: true }, c, "api-type-what", exe, () => false, MEMBER_MISTAKES)
          : null;
      }
      const out = decide({ ...v, aggregate: true }, c, "api-type-what", found, () => false, {
        alias: MISTAKES.aggregate,
        duplicate: MISTAKES.aggregate,
        scope: MISTAKES.outOfScope,
      });
      const missing = resolved
        .filter((x) => !found.includes(x))
        .map((x) => `${x.name} (${x.f.status})`);
      if (out && "proposal" in out && missing.length)
        out.proposal.note = `${out.proposal.note ?? ""}; also named, without a measured or script row: ${missing.join(", ")}`;
      return out;
    },
  },
  // ── A member row whose label names a measured class (`Module class AnimEditor`) ──
  {
    name: "api-label-class",
    applies: (v, c) =>
      isApi(v) &&
      METHOD_KINDS.has(v.row.kind) &&
      // A one-word label is the member's own name (`BuildShoreMap` is also a plugin class).
      /\s/.test(v.label.trim()) &&
      typeMentions(v.label).filter((n) => c.ix.types.has(n)).length === 1,
    run: (v, c) => {
      const name = typeMentions(v.label).find((n) => c.ix.types.has(n)) as string;
      const r = c.ix.types.get(name) as Row;
      return proposal(
        "duplicate-of",
        r.id,
        "api-label-class",
        `${MISTAKES.kindMisread} (${v.row.kind} -> ${r.kind})`,
        [sourceRef(r), `API cell: ${v.api.slice(0, 120)}`],
        `the label names the ${r.kind} ${name}; the API cell shows how script obtains it`,
      );
    },
  },
  // ── Class.Member mentions in the Script API cell or signature ────────────
  {
    name: "api-member",
    applies: (v) => isApi(v) && apiMentions(v).length > 0,
    run: (v, c) => {
      const mentions = apiMentions(v);
      // The label names the member when it is one of the mentions; then only that one counts.
      const bare = v.label.replace(/\(.*$/, "").trim();
      const own = mentions.filter((m) => m.member === bare || `${m.cls}.${m.member}` === bare);
      const use = (own.length ? own : mentions).flatMap((m) => namedMembers(m, v, c) ?? [m]);
      const found = use.map((mm) => ({
        name: `${mm.cls}.${mm.member}${mm.wildcard ? "*" : mm.args === undefined ? "" : `(${mm.args})`}`,
        f: resolveMember(mm, c.ix, c.source),
      }));
      // A call with literal arguments (`CreateEntityInWindowEx(..., "ParticleEffectEntity", ...)`,
      // `GetResourceName("{GUID}")`) describes one use of the method, not the method: no alias.
      const oneUse = /\(\s*[^)]*"[^"]*"/.test(v.api);
      const out = decide(
        v,
        c,
        "api-member",
        found,
        (t) => !oneUse && METHOD_KINDS.has(t.kind) && METHOD_KINDS.has(v.row.kind),
        MEMBER_MISTAKES,
      );
      if (
        oneUse &&
        out &&
        "proposal" in out &&
        out.proposal.recon_resolution.kind === "duplicate-of" &&
        !out.proposal.note
      )
        out.proposal.note =
          "the row describes one use of the method with literal arguments, not the method";
      if (oneUse && out && "proposal" in out) out.proposal.mistake = MISTAKES.guiFunction;
      return out;
    },
  },
  // ── Bare method names in the API cell (`CreateContainer(class) + SaveContainer`) ──
  {
    name: "api-bare-method",
    applies: (v, c) =>
      isApi(v) &&
      METHOD_KINDS.has(v.row.kind) &&
      !!c.source &&
      bareNames(memberTexts(v)).length > 0,
    run: (v, c) => {
      const found: { name: string; f: Found }[] = [];
      for (const n of bareNames(memberTexts(v))) {
        const f = resolveBareMethod(n, c.ix, c.source);
        if (f) found.push({ name: n, f });
      }
      if (found.length === 0) return null;
      return decide(
        v,
        c,
        "api-bare-method",
        found,
        (t) => METHOD_KINDS.has(t.kind),
        MEMBER_MISTAKES,
      );
    },
  },
  // ── Types in the API cell of a member row (`MaterialValidatorUtils (5 public methods)`, `AudioSystem.*`) ──
  {
    name: "api-type-cell",
    applies: (v) => isApi(v) && typeMentions(memberTexts(v)).length > 0,
    run: (v, c) =>
      typeDecision(
        v,
        c,
        "api-type-cell",
        resolveTypeList(typeMentions(memberTexts(v)), c.ix, c.source, c.exe),
      ),
  },
  // ── A type-like label of a member row (`BaseContainerTools`) ─────────────
  {
    name: "api-type-label",
    applies: (v) => isApi(v) && METHOD_KINDS.has(v.row.kind) && typeMentions(v.label).length > 0,
    run: (v, c) =>
      typeDecision(
        v,
        c,
        "api-type-label",
        resolveTypeList(typeMentions(v.label), c.ix, c.source, c.exe),
      ),
  },
  // ── Measured link formats a non-link row names (`enfusion://AudioEditor/... deep links`) ──
  {
    name: "link-in-text",
    applies: (v) => isApi(v) && /enfusion:\/\/[A-Za-z]/.test(v.recon?.raw ?? v.quote),
    run: (v, c) => {
      const found = linkMentions(v, c);
      if (found.length === 0) return null;
      return decide(v, c, "link-in-text", found, () => false, {
        alias: MISTAKES.crossDim,
        duplicate: MISTAKES.crossDim,
        scope: MISTAKES.outOfScope,
      });
    },
  },
  // ── GUI functions filed as methods (no script API at all) ────────────────
  {
    name: "gui-function",
    applies: (v) =>
      isApi(v) &&
      METHOD_KINDS.has(v.row.kind) &&
      GUI_KINDS.test(v.reconKind) &&
      // The API cell names no script identifier (`none`, `file write + register`), or only a runtime equivalent.
      (NONE_CELL.test(v.api) ||
        !/\b[A-Z][A-Za-z0-9_]{2,}/.test(memberTexts(v)) ||
        /runtime equivalent|outside the editor/i.test(v.api)),
    run: (v) =>
      proposal(
        "recon-error",
        v.reconRef,
        "gui-function",
        MISTAKES.guiFunction,
        [
          `recon kind "${v.reconKind}", Script API cell "${v.api || "(empty)"}": ${(v.recon?.raw ?? v.quote).slice(0, 160)}`,
        ],
        `a GUI function of ${v.row.module} with no script API; E01 read the recon kind "${v.reconKind}" as ${v.row.kind}`,
      ),
  },
  // ── File types ───────────────────────────────────────────────────────────
  {
    // `.wav resource type config | configs/ResourceTypes/<PLATFORM>/Sound.conf`, `LocParser rule configs |
    // 10 configs under ... | file-format (.conf)`: the row is a config file or a set of them, not a file type.
    name: "file-type-config",
    applies: (v, c) =>
      v.row.dim === "file" &&
      /\bconfigs?\b/i.test(v.label) &&
      extMentions(`${v.what} ${v.automation}`).some((e) => c.ix.files.has(e)),
    run: (v, c) => {
      const exts = extMentions(`${v.what} ${v.automation}`).filter((e) => c.ix.files.has(e));
      const out = fileDecision({ ...v, label: "" }, c, exts.slice(0, 1), "file-type-config");
      if (out && "proposal" in out)
        out.proposal.note = `a config file or a set of config files of type .${exts[0]}, not a file type of its own`;
      return out;
    },
  },
  {
    name: "file-ext",
    applies: (v, c) =>
      v.row.dim === "file" && usableExts(extMentions(v.label), v.label, c).length > 0,
    run: (v, c) => {
      const all = extMentions(v.label);
      const usable = usableExts(all, v.label, c);
      // Extensions of the label left out (no measured row, no executable string): the
      // row still names several things, so it never merges, and the note says which.
      const dropped = all.filter((e) => !usable.includes(e)).map((e) => `.${e}`);
      const out = fileDecision(
        dropped.length ? { ...v, aggregate: true } : v,
        c,
        usable,
        "file-ext",
      );
      if (out && "proposal" in out && dropped.length)
        out.proposal.note = [
          out.proposal.note,
          `also named, with no measured file row and no executable string: ${dropped.join(", ")}`,
        ]
          .filter(Boolean)
          .join("; ");
      return out;
    },
  },
  {
    name: "file-ext-in-text",
    applies: (v, c) =>
      v.row.dim === "file" && extMentions(`${v.what} ${v.api}`).some((e) => c.ix.files.has(e)),
    run: (v, c) =>
      fileDecision(
        { ...v, label: "" },
        c,
        extMentions(`${v.what} ${v.api}`)
          .filter((e) => c.ix.files.has(e))
          .slice(0, 4),
        "file-ext-in-text",
      ),
  },
  {
    name: "file-api-type",
    applies: (v) => v.row.dim === "file" && typeMentions(memberTexts(v)).length > 0,
    run: (v, c) => {
      const found = resolveTypeList(typeMentions(memberTexts(v)), c.ix, c.source, c.exe).filter(
        (x) => x.f.status === "measured",
      );
      if (found.length === 0) return null;
      // A row that names a format (`Shapefile .shp`, `Object import CSV`) is that format, not the
      // class that reads it: with no file row for the format there is nothing to be a duplicate of.
      const format = [
        ...extMentions(`${v.label} ${v.what}`).map((e) => `.${e}`),
        ...formatWords(v.label),
      ];
      if (format.length)
        return {
          unresolved: {
            reason: `a file format (${format.join(", ")}) that a measured class reads or writes, with no measured file row: a gap of the file-type census, not a duplicate of the class`,
            tried: ["file-api-type", ...found.map((x) => `${x.name}: ${x.f.evidence}`)],
          },
        };
      return decide(v, c, "file-api-type", found, () => false, {
        alias: MISTAKES.crossDim,
        duplicate: MISTAKES.crossDim,
        scope: MISTAKES.outOfScope,
      });
    },
  },
  {
    name: "file-settings-store",
    applies: (v) =>
      v.row.dim === "file" &&
      // Words of the label and what cell, not of a path inside them (`profile/.save/settings/`).
      /\b(?:registry|settings|state)\b/i.test(`${v.label} ${v.what}`.replace(/\S*\/\S*/g, " ")) &&
      extMentions(v.label).length === 0,
    run: (v) =>
      proposal(
        "recon-error",
        v.reconRef,
        "file-settings-store",
        MISTAKES.settingsSubtree,
        [`label "${v.label}", what "${v.what.slice(0, 120)}"`],
        "persisted editor settings (a section or subtree of the Workbench settings store, registry or ini export), not a file type; whether E06 measured its keys is not part of this ruling",
      ),
  },
  {
    name: "file-no-extension",
    applies: (v) =>
      v.row.dim === "file" &&
      extMentions(`${v.label} ${v.what} ${v.api}`).length === 0 &&
      formatWords(v.label).length === 0,
    run: (v) =>
      proposal(
        "recon-error",
        v.reconRef,
        "file-no-extension",
        MISTAKES.prose,
        [
          `no file extension in label, what or API cell: "${(v.recon?.raw ?? v.quote).slice(0, 160)}"`,
        ],
        "names no file extension: a folder, a set of files or a workflow, not a file type",
      ),
  },
  // ── MCP tools ────────────────────────────────────────────────────────────
  {
    name: "mcp-tool",
    applies: (v) => v.row.dim === "mcp" && v.row.kind === "mcp-tool",
    run: (v, c) => {
      let names = toolMentions(v.label).filter((n) => c.ix.tools.has(n));
      let from = "label";
      if (names.length === 0) {
        names = toolMentions(v.coverage).filter((n) => c.ix.tools.has(n));
        from = "coverage cell";
      }
      if (names.length === 0) return null;
      const found = names.map((n) => {
        const r = c.ix.tools.get(n) as Row;
        return {
          name: n,
          f: { status: "measured", row: r, evidence: `${from}: ${sourceRef(r)}` } as Found,
        };
      });
      const partial = /\bpartial\b/i.test(v.coverage)
        ? `the recon marks the coverage partial: ${v.coverage}`
        : undefined;
      const out = decide(v, c, "mcp-tool", found, (t) => t.kind === "mcp-tool", {
        alias: MISTAKES.freeTextId,
        duplicate: MISTAKES.aggregate,
        scope: MISTAKES.outOfScope,
      });
      if (out && "proposal" in out && partial)
        out.proposal.note = [out.proposal.note, partial].filter(Boolean).join("; ");
      return out;
    },
  },
  // ── Links ────────────────────────────────────────────────────────────────
  {
    name: "link-url",
    applies: (v) => v.row.dim === "link",
    run: (v, c) => {
      const found = linkMentions(v, c);
      if (found.length === 0) return null;
      return decide(v, c, "link-url", found, (t) => t.kind === "link-format", {
        alias: MISTAKES.freeTextId,
        duplicate: MISTAKES.aggregate,
        scope: MISTAKES.outOfScope,
      });
    },
  },
  // ── Settings ─────────────────────────────────────────────────────────────
  {
    name: "setting-subtree",
    applies: (v) => v.row.dim === "setting",
    run: (v, c) => settingSubtree(v, c),
  },
  {
    name: "setting-plugin-persistence",
    applies: (v) =>
      (v.row.dim === "setting" || v.row.kind === "plugin-setting") &&
      /ScriptTools|\[Attribute\]|plugin(?:'s)? persisted|persisted settings|settings persistence/i.test(
        `${v.label} ${v.what}`,
      ),
    run: (v, c) => {
      const e06 = [...c.ix.pluginSettings.values()]
        .flat()
        .filter((r) => r.sources.some((s) => s.enumerator === "E06"));
      if (e06.length === 0) return null;
      return proposal(
        "recon-error",
        v.reconRef,
        "setting-plugin-persistence",
        MISTAKES.settingsSubtree,
        [
          `${e06.length} measured plugin-setting rows carry an E06 (settings store) source; first ${sourceRef(e06[0])}`,
        ],
        `the persistence of every plugin's [Attribute] values (ScriptTools/<Class>), not one key: measured as ${e06.length} plugin-setting rows`,
      );
    },
  },
  {
    name: "setting-key",
    applies: (v) => v.row.dim === "setting",
    run: (v, c) => settingDecision(v, c),
  },
  {
    name: "setting-file",
    applies: (v, c) =>
      v.row.dim === "setting" && extMentions(v.label).some((e) => c.ix.files.has(e)),
    run: (v, c) => {
      const e = extMentions(v.label).find((x) => c.ix.files.has(x)) as string;
      const r = c.ix.files.get(e) as Row;
      return proposal(
        "duplicate-of",
        r.id,
        "setting-file",
        MISTAKES.crossDim,
        [sourceRef(r)],
        `a settings export file of type .${e}, not a key`,
      );
    },
  },
  {
    name: "setting-options-tab",
    applies: (v) => v.row.dim === "setting" && /\btab$/i.test(v.label.trim()),
    run: (v) =>
      proposal(
        "recon-error",
        v.reconRef,
        "setting-options-tab",
        MISTAKES.settingsSubtree,
        [`label "${v.label}": ${v.what.slice(0, 160)}`],
        "a tab of the Options dialog (a group of options), not one key; its options are GUI rows for the live census",
      ),
  },
  {
    name: "setting-shortcuts",
    applies: (v, c) =>
      v.row.dim === "setting" &&
      /\bshortcuts?\b/i.test(`${v.label} ${v.what}`) &&
      c.ix.shortcuts.length > 0,
    run: (v, c) =>
      proposal(
        "recon-error",
        v.reconRef,
        "setting-shortcuts",
        MISTAKES.settingsSubtree,
        [`${c.ix.shortcuts.length} measured shortcut rows (first ${sourceRef(c.ix.shortcuts[0])})`],
        `the shortcut table, not one key: measured as ${c.ix.shortcuts.length} shortcut rows`,
      ),
  },
  {
    // An Options dialog setting the executable declares but this machine's registry never stored.
    name: "setting-exe-option",
    applies: (v, c) => v.row.dim === "setting" && !!c.exe,
    run: (v, c) => {
      const words = v.label
        .replace(/^[A-Za-z ]+:\s*/, "")
        .split(/[\s-]+/)
        .filter(Boolean);
      if (words.length === 0 || words.length > 4) return null;
      const ident = words
        .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
        .join("");
      const hit = c.exe?.find(ident);
      if (!hit) return null;
      return {
        unresolved: {
          reason: `executable-only option: the executable declares ${ident} (${hit.offset}); no measured row, because E06 reads only the keys this machine's registry holds`,
          tried: [
            "setting-exe-option",
            `${ident}: executable string at ${hit.offset} "${hit.text}"`,
          ],
        },
      };
    },
  },
  // ── A plugin option described by its value type ──────────────────────────
  {
    // `Template types | SCR_EScriptTemplateType: None, ...` is the measured attribute
    // `SCR_EScriptTemplateType m_eClassType` of SCR_ScriptTemplatePlugin, not the enum.
    name: "plugin-setting-typed",
    applies: (v) => v.row.kind === "plugin-setting" && typeMentions(v.what).length > 0,
    run: (v, c) => {
      const types = new Set(typeMentions(v.what));
      const classes = pluginClassesOf(v, c.readRecon);
      const typed = [...c.ix.pluginSettings]
        .filter(([cls]) => classes.length === 0 || classes.includes(cls))
        .flatMap(([, rows]) => rows)
        .filter((r) => types.has((r.signature ?? "").trim().split(/\s+/)[0]));
      if (typed.length === 0) return null;
      if (typed.length > 1)
        return {
          unresolved: {
            reason: `ambiguous: ${typed.length} measured plugin settings hold a value of type ${[...types].join(", ")}`,
            tried: ["plugin-setting-typed", ...typed.slice(0, 6).map(sourceRef)],
          },
        };
      return decide(
        v,
        c,
        "plugin-setting-typed",
        [
          {
            name: typed[0].signature as string,
            f: { status: "measured", row: typed[0], evidence: sourceRef(typed[0]) },
          },
        ],
        (t) => t.kind === "plugin-setting",
        {
          alias: MISTAKES.freeTextId,
          duplicate: MISTAKES.aggregate,
          scope: MISTAKES.outOfScope,
        },
      );
    },
  },
  // ── Plugin settings described as a block of a plugin ─────────────────────
  {
    name: "plugin-settings-block",
    // The label must read as a group (`Autocomplete settings (22 attributes ...)`, `VCS Configuration`).
    applies: (v) =>
      v.row.kind === "plugin-setting" &&
      /\b(?:settings|attributes|configuration|options)\b/i.test(v.label),
    run: (v, c) => {
      const cls = pluginClassesOf(v, c.readRecon).find(
        (n) => (c.ix.pluginSettings.get(n) ?? []).length >= 2,
      );
      if (!cls) return null;
      const rows = c.ix.pluginSettings.get(cls) as Row[];
      return proposal(
        "recon-error",
        v.reconRef,
        "plugin-settings-block",
        MISTAKES.aggregate,
        [
          `${rows.length} measured plugin-setting rows plugin:${cls}#attr:* (first ${sourceRef(rows[0])})`,
        ],
        `the settings block of ${cls}, not one setting; its attributes are the ${rows.length} measured rows plugin:${cls}#attr:*`,
      );
    },
  },
];

/** Measured link-format rows the label or recon line names (`enfusion://WorldEditor/<world>`, a URL prefix). */
function linkMentions(v: RowView, c: RuleContext): { name: string; f: Found }[] {
  const text = `${v.label} ${v.recon?.raw ?? v.quote}`;
  const urls = [
    ...new Set(
      [...text.matchAll(/enfusion:\/\/[A-Za-z]*|https?:\/\/[^\s`|)<>]+/g)].map((m) => m[0]),
    ),
  ];
  // `enfusion://ParticleEditor`, `AnimEditor`, `AudioEditor`: the list continues without the scheme.
  if (urls.some((u) => /^enfusion:\/\/[A-Za-z]+$/.test(u))) {
    for (const m of text.matchAll(/`([A-Z][A-Za-z]+)`/g)) {
      const u = `enfusion://${m[1]}`;
      if (!urls.includes(u) && c.ix.links.some((r) => r.id === `link:${u}`)) urls.push(u);
    }
  }
  const found: { name: string; f: Found }[] = [];
  for (const u of urls) {
    const exact = c.ix.links.filter((r) => r.id === `link:${u}`);
    const prefix = exact.length
      ? exact
      : c.ix.links.filter((r) => r.id.length > 12 && u.startsWith(r.id.slice(5)));
    const best = [...prefix].sort((a, b) => b.id.length - a.id.length)[0];
    if (best)
      found.push({ name: u, f: { status: "measured", row: best, evidence: sourceRef(best) } });
  }
  return found;
}

/** The type rule's decision; schema targets record the document-block mistake. */
function typeDecision(
  v: RowView,
  c: RuleContext,
  rule: string,
  found: { name: string; f: Found }[],
): RuleOutcome {
  const blocks = found.some((x) => x.f.status === "measured" && x.f.row.dim === "schema");
  return decide(
    v,
    c,
    rule,
    found,
    (t) =>
      t.dim === "api" &&
      TYPE_KINDS.has(t.kind) &&
      (TYPE_KINDS.has(v.row.kind) || v.row.kind === "attribute"),
    {
      alias: v.row.kind === "attribute" ? MISTAKES.kindMisread : MISTAKES.freeTextId,
      duplicate: blocks ? MISTAKES.documentBlock : MISTAKES.crossDim,
      scope: MISTAKES.outOfScope,
    },
  );
}

/** Extensions worth resolving: a measured file type, an executable string, or the extension a label starts with. */
function usableExts(exts: string[], label: string, c: RuleContext): string[] {
  const lead = /^\.([A-Za-z0-9]+)/.exec(label.trim())?.[1]?.toLowerCase();
  return exts.filter((e) => e === lead || c.ix.files.has(e) || exeExt(e, c) !== undefined);
}

/**
 * An executable string that names extension `e`: the bare string, or `e` in a
 * filter or path (`bt;fsm`, `%s/%s.dlg`, `*.e`). A match inside a mangled
 * symbol (`?apr`) does not count.
 */
function exeExt(e: string, c: RuleContext): { offset: string; text: string } | undefined {
  const esc = e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inList = new RegExp(`(?:^|[;.,*\\s|])${esc}(?:$|[;,\\s|)])`, "i");
  for (const n of [e, e.toUpperCase(), `.${e}`, `*.${e}`]) {
    const hit = c.exe?.find(n);
    if (hit && (hit.text === n || inList.test(hit.text))) return hit;
  }
  return undefined;
}

function fileDecision(v: RowView, c: RuleContext, exts: string[], rule: string): RuleOutcome {
  if (exts.length === 0) return null;
  const typeRow = /^\.[A-Za-z0-9]+(?:\s|$)/.test(v.label.trim()) && exts.length === 1;
  const found = exts.map((e) => {
    const r = c.ix.files.get(e);
    if (r)
      return { name: `.${e}`, f: { status: "measured", row: r, evidence: sourceRef(r) } as Found };
    const hit = exeExt(e, c);
    if (hit)
      return {
        name: `.${e}`,
        f: {
          status: "exe-only",
          evidence: `.${e}: no measured file row; executable string at ${hit.offset} "${hit.text}"`,
        } as Found,
      };
    return {
      name: `.${e}`,
      f: {
        status: "absent",
        evidence: `.${e}: no measured file row; no executable string "${e}", "${e.toUpperCase()}", ".${e}" or "*.${e}"`,
      } as Found,
    };
  });
  // An extension alone is weak evidence of absence: a format the build reads
  // need not appear as a string (the `.apr` export profiles are loaded by
  // AnimExportProfileStorage). Absence stays a question for the reader.
  if (found.every((x) => x.f.status === "absent"))
    return {
      unresolved: {
        reason:
          "extension found in no measured row and no executable string; absence of a file format cannot be ruled from its extension alone",
        tried: [rule, ...found.map((x) => `${x.name}: ${x.f.evidence}`)],
      },
    };
  const out = decide(
    { ...v, aggregate: v.aggregate || !typeRow },
    c,
    rule,
    found,
    (t) => t.kind === "file-type" && typeRow,
    {
      alias: MISTAKES.freeTextId,
      duplicate: typeRow ? MISTAKES.aggregate : MISTAKES.prose,
      scope: MISTAKES.outOfScope,
    },
  );
  if (
    out &&
    "proposal" in out &&
    !typeRow &&
    exts.length === 1 &&
    out.proposal.recon_resolution.kind === "duplicate-of"
  ) {
    out.proposal.mistake = `${MISTAKES.kindMisread} (a file or folder, not a file type)`;
    out.proposal.note = `names a file or location of type .${exts[0]}, not a file type of its own`;
  }
  return out;
}

/** Measured setting rows under a registry path the row names (`World Editor/TerrainModule`, `<Module>/Perspectives/<layout>/State`, `Addon presets`). */
function settingSubtree(v: RowView, c: RuleContext): RuleOutcome {
  const text = `${v.label} ${v.what}`;
  const full = (s: { section: string; key: string }): string => `${s.section}/${s.key}`;
  const hits = new Map<string, Row>();
  const used: string[] = [];
  const paths = [
    ...text.matchAll(
      /((?:<[A-Za-z]+>|[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)(?:\/(?:<[A-Za-z]+>|[A-Za-z_][A-Za-z0-9_]*(?: [A-Z][A-Za-z]*)*))+)/g,
    ),
  ].map((m) => m[1].trim());
  for (const whole of paths) {
    // A multi-word last segment may run into the prose after the path: try it shorter.
    const segs = whole.split("/");
    const lastWords = segs[segs.length - 1].split(" ");
    for (let n = lastWords.length; n >= 1; n--) {
      const p = [...segs.slice(0, -1), lastWords.slice(0, n).join(" ")].join("/");
      const re = new RegExp(
        `^${p
          .split("/")
          .map((seg) => (/^<.*>$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
          .join("/")}(?:/|$)`,
      );
      const under = c.ix.settings.filter((s) => re.test(full(s)));
      if (under.length > 1) {
        used.push(`${p}: ${under.length}`);
        for (const s of under) hits.set(s.row.id, s.row);
        break;
      }
    }
  }
  // "Persisted state: Game Project Manager", "Addon presets": a section named by the label.
  const named = v.label
    .replace(/^Persisted state:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+session$/i, "");
  const norm = normName(named);
  if (norm.length >= 6 && hits.size === 0) {
    const under = c.ix.settings.filter((s) =>
      s.section.split("/").some((seg) => normName(seg) === norm),
    );
    if (under.length > 1) {
      used.push(`section "${named}": ${under.length}`);
      for (const s of under) hits.set(s.row.id, s.row);
    }
  }
  if (hits.size < 2) return null;
  const rows = [...hits.values()].sort((a, b) => compareCodeUnits(a.id, b.id));
  return proposal(
    "recon-error",
    v.reconRef,
    "setting-subtree",
    MISTAKES.settingsSubtree,
    [`${rows.length} measured setting rows under ${used.join("; ")} (first ${sourceRef(rows[0])})`],
    `a settings subtree, not one key: ${rows.length} measured rows (${used.join("; ")})`,
  );
}

/**
 * Setting keys a row names. The label (after a `Section:` prefix) or a single
 * backticked key merges by alias; several keys make a duplicate of the
 * first; a label that names a store (`... state`, `... registry`, `... options`)
 * never merges.
 */
function settingDecision(v: RowView, c: RuleContext): RuleOutcome {
  const byNorm = new Map<string, LedgerIndex["settings"]>();
  for (const s of c.ix.settings) push(byNorm, normName(s.key), s);
  const mod = v.row.module.replace(/([a-z])([A-Z])/g, "$1 $2");
  const pick = (t: string): Row | undefined => {
    let hits = byNorm.get(normName(t)) ?? [];
    if (hits.length > 1) {
      const inMod = hits.filter((h) => h.section === mod || h.section === "Workbench");
      if (inMod.length) hits = inMod;
    }
    return hits.length === 1 ? hits[0].row : undefined;
  };
  const labelKey = v.label.replace(/^[A-Za-z ]+:\s*/, "");
  const store = /\b(?:state|registry|settings|options|layouts|presets|shortcuts|keys)\b/i.test(
    v.label,
  );
  const fromLabel = pick(labelKey);
  if (fromLabel && !store) {
    return decide(
      v,
      c,
      "setting-key",
      [
        {
          name: labelKey,
          f: { status: "measured", row: fromLabel, evidence: sourceRef(fromLabel) },
        },
      ],
      (t) => t.dim === "setting",
      {
        alias: MISTAKES.freeTextId,
        duplicate: MISTAKES.aggregate,
        scope: MISTAKES.outOfScope,
      },
    );
  }
  const text = `${v.what} ${v.recon?.raw ?? v.quote}`;
  const tokens = new Set<string>();
  for (const m of text.matchAll(/`[^`]*?\b([A-Za-z_][A-Za-z0-9_]*)`/g)) tokens.add(m[1]);
  for (const m of text.matchAll(
    /\b([A-Za-z]+(?:_[A-Za-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/g,
  ))
    tokens.add(m[1]);
  const found: { name: string; f: Found }[] = [];
  for (const t of tokens) {
    const r = pick(t);
    if (r && !found.some((x) => x.f.status === "measured" && x.f.row.id === r.id))
      found.push({ name: t, f: { status: "measured", row: r, evidence: sourceRef(r) } });
  }
  if (found.length === 0) return null;
  if (store) {
    const ids = found.map((x) => (x.f as Extract<Found, { status: "measured" }>).row.id);
    return proposal(
      "recon-error",
      v.reconRef,
      "setting-store",
      MISTAKES.settingsSubtree,
      found.map((x) => `${x.name}: ${x.f.evidence}`),
      `names a settings store or group ("${v.label}"), not one key; the measured keys it names: ${ids.join(", ")}`,
    );
  }
  return decide(
    { ...v, aggregate: v.aggregate || store || found.length > 1 },
    c,
    "setting-key",
    found,
    (t) => t.dim === "setting",
    {
      alias: MISTAKES.freeTextId,
      duplicate: MISTAKES.aggregate,
      scope: MISTAKES.outOfScope,
    },
  );
}

// ── Manual decisions ──────────────────────────────────────────────────────────

/**
 * Decisions a careful reader made from the recon line and the sources where
 * no rule settles the row, or where a rule's reading is wrong (`override`).
 * Each names the recon line read and the sources checked. Kind `unresolved`
 * records why a row stays open (undecidable offline).
 */
export interface ManualDecision {
  kind: ResolutionKind | "unresolved";
  /** For merged-via-alias / duplicate-of: the row id; otherwise the ref. `@recon` is the recon row's own `<file>#L<line>`. */
  ref?: string;
  mistake?: string;
  /** What was read: the recon line and any source. */
  read: string;
  /** The finding (for `unresolved`, the reason). */
  note: string;
  /** Applied before the rules: the rules would settle the row on a wrong reading. */
  override?: boolean;
}

export const MANUAL: Readonly<Record<string, ManualDecision>> = {
  "api:EMCP_WB_Common": {
    kind: "absent-in-build",
    ref: "EMCP_WB_Common (source index of the 6,568 game script files, measured api rows, executable strings)",
    mistake: MISTAKES.crossDim,
    read: "mcp-inventory.md#L122; <repo>/mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Common.c",
    note: "a helper class of this repository's own Workbench mod (EnfusionMCP), not of the build; the recon row's Script API cell names the WorldEditorAPI calls it makes, which a rule would mistake for the row itself",
    override: true,
  },
  "api:method/Native script API table registered by the exe": {
    kind: "recon-error",
    ref: "@recon",
    mistake: MISTAKES.aggregate,
    read: "gui-census-feasibility.md#L204",
    note: "the ordered list of every proto function the executable binds (Workbench.*, WBModuleDef.*, ResourceManager.*, WorldEditor.*, LocalizationEditor.*, ScriptEditor.*, DialogueEditor.*), each measured as its own api row by E02; not one method",
    override: true,
  },
  "setting:setting-key/Protocol registration": {
    kind: "recon-error",
    ref: "@recon",
    mistake: `${MISTAKES.kindMisread} (an Options dialog button, not a setting key)`,
    read: "plugins-netapi-cli.md#L394",
    note: "the Options > Workbench button that registers the enfusion:// protocol with the OS; the recon itself found no protocol key on the machine; a GUI action for the live census, not a Workbench setting",
  },
  "setting:setting-key/Persisted state: World Editor%2FWorlds%2F<world>": {
    kind: "recon-error",
    ref: "@recon",
    mistake: MISTAKES.settingsSubtree,
    read: "gui-census-feasibility.md#L166",
    note: "the recon's own kind cell calls it a settings subtree (98-107 keys per world, read from an ini export), not one key, the same reading as its file-type twin 'Per-world editor state'; E06 measured no World Editor/Worlds section in this machine's registry, so its keys are a question for E06 on a profile that has opened a world, not for this row",
  },
  "setting:setting-key/Workbench: Qt Style Sheet": {
    kind: "unresolved",
    read: "resource-manager.md#L556; E05 ascii.tsv and options-strings.tsv",
    note: "an Options dialog field per the wiki; no measured row, and no option identifier in the executable strings (QtStyleSheet and StyleSheet absent; only Qt's setStyleSheet imports and :/Workbench/Common/dark_theme.qss); needs the live Options census or a disposition",
  },
};

// ── Driver ────────────────────────────────────────────────────────────────────

function viewOf(row: Row, readRecon: ResolveInputs["readRecon"]): RowView {
  const src = row.sources.find((s) => s.enumerator === "E01") ?? row.sources[0];
  const at = parseReconRef(src.ref);
  const lines = at ? readRecon(at.file) : undefined;
  const recon = at && lines ? readReconLine(lines, at.file, at.line) : undefined;
  const reconRef = at ? `${at.file}#L${at.line}` : src.ref;
  const api = cell(recon, "script api", "script-api", "api") || row.signature || "";
  return {
    row,
    recon,
    reconRef,
    quote: src.quote ?? "",
    label: row.label ?? "",
    reconKind: cell(recon, "kind").replace(/[`*]/g, "").trim().toLowerCase(),
    api: api.replace(/`/g, ""),
    coverage: cell(recon, "current mcp coverage", "mcp coverage", "coverage").replace(/`/g, ""),
    what: cell(recon, "what").replace(/`/g, ""),
    automation: cell(recon, "automation").replace(/`/g, ""),
    aggregate: row.aggregate || /,.*,/.test(row.label ?? ""),
  };
}

function manualOutcome(
  man: ManualDecision,
  v: RowView,
  tried: string[],
): { proposal?: Proposal; unresolved?: Unresolved } {
  if (man.kind === "unresolved")
    return {
      unresolved: {
        id: v.row.id,
        recon: v.reconRef,
        reason: `manual: ${man.note}`,
        tried: [`manual: read ${man.read}`, ...tried],
      },
    };
  return {
    proposal: {
      id: v.row.id,
      recon_resolution: {
        kind: man.kind,
        ref: man.ref === "@recon" || !man.ref ? v.reconRef : man.ref,
      },
      rule: "manual",
      mistake: man.mistake ?? MISTAKES.prose,
      evidence: [`read ${man.read}`, ...tried],
      note: man.note,
      recon: v.reconRef,
    },
  };
}

/** Runs the rules over every recon offender. Deterministic: rows in id order, rules in table order. */
export function resolveRecon(inputs: ResolveInputs): ResolveResult {
  const ix = indexLedger(inputs.rows);
  const ctx: RuleContext = {
    ix,
    source: inputs.source,
    exe: inputs.exe,
    aliases: inputs.aliases ?? [],
    readRecon: inputs.readRecon,
  };
  const manual = inputs.manual ?? MANUAL;
  const offenders = reconOffenders(inputs.rows, inputs.overlays, inputs.awaitsLive);
  const proposals: Proposal[] = [];
  const unresolved: Unresolved[] = [];
  const record = (o: { proposal?: Proposal; unresolved?: Unresolved }): void => {
    if (o.proposal) proposals.push(o.proposal);
    if (o.unresolved) unresolved.push(o.unresolved);
  };
  for (const row of offenders) {
    const v = viewOf(row, inputs.readRecon);
    const man = manual[row.id];
    if (man?.override) {
      record(manualOutcome(man, v, []));
      continue;
    }
    const tried: string[] = [];
    let settled = false;
    let firstUnresolved: { reason: string; tried: string[] } | undefined;
    for (const rule of RULES) {
      if (!rule.applies(v, ctx)) continue;
      const out = rule.run(v, ctx);
      if (out === null) {
        tried.push(`${rule.name}: no match`);
        continue;
      }
      if ("unresolved" in out) {
        tried.push(
          ...out.unresolved.tried.map((t, i) =>
            i === 0 ? `${t}: ${out.unresolved.reason}` : `  ${t}`,
          ),
        );
        firstUnresolved ??= out.unresolved;
        continue;
      }
      proposals.push({ id: row.id, ...out.proposal, recon: v.reconRef });
      settled = true;
      break;
    }
    if (settled) continue;
    if (man) {
      record(manualOutcome(man, v, tried));
      continue;
    }
    unresolved.push({
      id: row.id,
      recon: v.reconRef,
      reason: firstUnresolved?.reason ?? "no rule matched",
      tried: tried.length ? tried : ["no rule applies to this dim and kind"],
    });
  }
  guardAliases(proposals, ix, inputs.source, inputs.defaultPaths);
  return { proposals, unresolved, considered: offenders.length };
}

// ── Alias guard ───────────────────────────────────────────────────────────────

/**
 * Why an alias `from -> to` would put one recon row's reading on a row it
 * does not describe alone, or undefined. An alias makes the recon observation
 * a source of the target, and buildLedger takes the target's `what` and paths
 * from it where the measured sources state none. That is wrong when several
 * recon rows name the same target (each would compete for its description),
 * when the target already carries a recon observation, and when the target is
 * a member of a base class that module classes inherit and the recon row,
 * filed under one module, describes its use there (`WBModuleDef.Close` as
 * "Close the String Editor").
 */
export function aliasHazard(
  from: Row,
  to: Row,
  sharing: number,
  source: SourceIndex | undefined,
): string | undefined {
  if (sharing > 1)
    return `${sharing} recon rows name ${to.id}; an alias would merge each one's description and paths into it`;
  if (to.sources.some((s) => s.enumerator === "E01"))
    return `${to.id} already carries a recon observation; a second would compete for its description`;
  const m = API_MEMBER.exec(to.id);
  if (m && source && from.module !== to.module && from.module !== "none") {
    const subs = subclassesOf(source, m[1]);
    if (subs.length)
      return `${to.id} is declared on ${m[1]}, which ${subs.length} class(es) inherit; the ${from.module} row describes its use in one module`;
  }
  return undefined;
}

function pathSet(r: Row): string[] {
  return r.paths.map((p) => p.path);
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * What an alias changes on its target at the next build: the description when
 * the target has none, and the candidate paths when the recon proposes some.
 * Risk is not listed: a ledger row cannot tell a risk the recon stated from a
 * policy default, and only a stated one is merged.
 */
export function mergeEffect(
  from: Row,
  to: Row,
  defaultPaths?: ResolveInputs["defaultPaths"],
): string[] {
  const out: string[] = [];
  if (!to.what && from.what)
    out.push(
      `what: none -> the recon's "${from.what.slice(0, 100)}"${from.what.length > 100 ? "..." : ""} (the target is at ${to.tier}; a description counts toward T1)`,
    );
  const fromPaths = pathSet(from);
  const toPaths = pathSet(to);
  if (fromPaths.length && !sameSet(fromPaths, toPaths)) {
    if (defaultPaths) {
      // A policy default carries the policy's reason; a proposed path its source's.
      const proposed = (r: Row): string[] =>
        r.paths
          .filter(
            (p) => !defaultPaths(r.kind).some((d) => d.path === p.path && d.reason === p.reason),
          )
          .map((p) => p.path);
      const fromProposed = proposed(from);
      const toProposed = proposed(to);
      const after = toProposed.length
        ? [...new Set([...toProposed, ...fromProposed])]
        : fromProposed.length
          ? fromProposed
          : toPaths;
      const order = (l: string[]): string[] =>
        [...l].sort(
          (a, b) =>
            PATH_KINDS.indexOf(a as (typeof PATH_KINDS)[number]) -
            PATH_KINDS.indexOf(b as (typeof PATH_KINDS)[number]),
        );
      if (!sameSet(after, toPaths))
        out.push(
          `paths: ${order(toPaths).join(", ") || "none"} -> ${order(after).join(", ")}${toProposed.length ? "" : " (the target's were policy defaults; a proposed path replaces them)"}`,
        );
    } else
      out.push(
        `paths: the target has ${toPaths.join(", ") || "none"}, the recon row ${fromPaths.join(", ")}; the result depends on which are policy defaults`,
      );
  }
  return out;
}

/** Turns hazardous aliases into duplicates and records the merge effect of the rest. */
function guardAliases(
  proposals: Proposal[],
  ix: LedgerIndex,
  source: SourceIndex | undefined,
  defaultPaths: ResolveInputs["defaultPaths"],
): void {
  const sharing = new Map<string, number>();
  for (const p of proposals)
    if (p.recon_resolution.kind === "merged-via-alias")
      sharing.set(p.recon_resolution.ref, (sharing.get(p.recon_resolution.ref) ?? 0) + 1);
  for (const p of proposals) {
    if (p.recon_resolution.kind !== "merged-via-alias") continue;
    const from = ix.byId.get(p.id);
    const to = ix.byId.get(p.recon_resolution.ref);
    if (!from || !to) continue;
    const hazard = aliasHazard(from, to, sharing.get(to.id) ?? 0, source);
    if (hazard) {
      p.recon_resolution = { kind: "duplicate-of", ref: to.id };
      p.note = [p.note, `no alias: ${hazard}`].filter(Boolean).join("; ");
      continue;
    }
    const effect = mergeEffect(from, to, defaultPaths);
    if (effect.length) p.merge_effect = effect;
  }
}

// ── Checks before apply ───────────────────────────────────────────────────────

/** Problems that make a proposal set unsafe to apply (target missing, chains, refused aliases). */
export function checkProposals(
  proposals: readonly Proposal[],
  rows: ReadonlyMap<string, Row>,
  aliases: readonly Alias[],
): string[] {
  const problems: string[] = [];
  // A row resolved twice would be written twice (the dry pass does not see its own writes).
  const seen = new Set<string>();
  for (const p of proposals) {
    if (seen.has(p.id)) problems.push(`${p.id}: proposed more than once`);
    seen.add(p.id);
  }
  const fromIds = new Set(
    proposals.filter((p) => p.recon_resolution.kind === "merged-via-alias").map((p) => p.id),
  );
  for (const p of proposals) {
    const from = rows.get(p.id);
    if (!from) {
      problems.push(`${p.id}: not a ledger row`);
      continue;
    }
    const { kind, ref } = p.recon_resolution;
    if (kind === "merged-via-alias" || kind === "duplicate-of") {
      const to = rows.get(ref);
      if (!to) problems.push(`${p.id}: ${kind} target ${ref} is not a ledger row`);
      else if (!isMeasured(to))
        problems.push(`${p.id}: ${kind} target ${ref} is not a measured row`);
      else if (kind === "merged-via-alias") {
        const ok = aliasAcceptable(from, to, aliases);
        if (!ok.ok) problems.push(`${p.id}: alias refused: ${ok.why}`);
        if (fromIds.has(ref))
          problems.push(`${p.id}: alias target ${ref} is itself proposed as an alias`);
      }
    } else if (kind === "out-of-scope" && !/^pak:.+#L\d+$/.test(ref)) {
      problems.push(`${p.id}: out-of-scope ref ${ref} is not pak:<path>#L<line>`);
    } else if (kind === "recon-error" && !/^[^#\s]+\.md#L\d+$/.test(ref)) {
      problems.push(`${p.id}: recon-error ref ${ref} is not <recon file>#L<line>`);
    }
  }
  return problems;
}

/** Counts by a key, sorted by count then key. */
export function tally<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || compareCodeUnits(a[0], b[0]));
}
