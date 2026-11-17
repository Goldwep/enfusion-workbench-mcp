/**
 * E04 — NET surface (plan 4.5): everything a client can call on Workbench's
 * NET API port, read from the game's script source (`src/census/net-surface.ts`).
 *
 * Rows:
 *  - net-function: the built-in `APIFunc` names documented in
 *    `scripts/WorkbenchGameCommon/NetApiDocs.c`, with the documented request
 *    and response shape. `unverified` carries the three-column status: documented
 *    by Bohemia, named in the executable (from E05's observation file), answering
 *    on this build (not verified live).
 *  - net-handler: every class whose parent chain reaches `NetApiHandler`,
 *    including `ExampleCall` (declared only under `#ifdef DOXYGEN`).
 *  - net-field: every request and response key those handlers register
 *    (`RegV`, `RegAll`, top-level `OnPack` keys), inherited ones included.
 *
 * Raw material (the full handler table, the cross-check against the Blender
 * add-on's call sites from E19, the cross-check against E08's shipped docs)
 * goes to `<artifacts>/census/<build>/E04/`.
 *
 *   npx tsx scripts/census/enumerators/e04-net-surface.ts [--build <tag>] [--game <dir>]
 *       [--sources <dir>] [--artifacts <dir>] [--index <dir>] [--tools <dir>] [--out <file under observations/E04/>]
 *       [--data <dir>] [--json] [--emit-contract]
 *
 * --index <dir>     artifacts root that holds E02's source index (default: --artifacts)
 * --tools <dir>     Tools install whose Blender/ folder the cross-check re-reads at
 *                   E19's call sites (default: ENFUSION_WORKBENCH_PATH); read only
 * --sources <dir>   read `scripts/**.c` from a directory instead of the game paks
 *                   (tests and offline checks; the source index is then built in memory)
 * --emit-contract   print the contract table for tests/contracts/bi-handlers.contract.test.ts
 *
 * Exit: 0 written; 1 --out refused or a row failed the schema; 2 usage or no
 * data (no game install and no --sources); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, formatJson, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import {
  NET_DOCS_FILE,
  SourceTexts,
  analyzeHandlers,
  contractTable,
  crossCheck,
  handlerSignature,
  parseNetApiDocs,
  parseShapeSignature,
  pythonResponseReads,
  shapeSignature,
  type BlenderNetFunction,
  type ContractEntry,
  type FieldInfo,
  type HandlerInfo,
  type NativeDoc,
  type RescanRead,
} from "../../../src/census/net-surface.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  isScriptSource,
  SOURCE_INDEX_FILE,
  loadSourceIndex,
  pakRef,
  saveSourceIndex,
  sourceIndexPath,
  sourceIndexText,
  type SourceIndex,
} from "../../../src/census/source-index.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
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

export const ENUMERATOR_ID = "E04";
/** Registered generator path (must equal universes.json `enumerators.E04.generator`). */
export const GENERATOR = "scripts/census/enumerators/e04-net-surface.ts";
const ANSWERING = "answering on this build: not verified live";

// ── Source backends ───────────────────────────────────────────────────────────

/** Where the script sources come from: the game paks or a directory (tests). */
export interface SourceBackend {
  allFilePaths(): string[];
  readText(path: string): string | undefined;
  readBytes(path: string): Buffer | undefined;
  /** Placeholder prefix for header input paths. */
  placeholder: string;
}

export function pakBackend(vfs: PakVirtualFS): SourceBackend {
  return {
    allFilePaths: () => vfs.allFilePaths(),
    readText: (p) => (vfs.exists(p) ? vfs.readTextFile(p) : undefined),
    readBytes: (p) => (vfs.exists(p) ? vfs.readFile(p) : undefined),
    placeholder: "<game>/addons/**/",
  };
}

export function dirBackend(root: string): SourceBackend {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort(compareCodeUnits)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(root, p).replace(/\\/g, "/"));
    }
  };
  walk(root);
  const abs = (p: string): string => join(root, ...p.split("/"));
  return {
    allFilePaths: () => files,
    readText: (p) => (existsSync(abs(p)) ? readFileSync(abs(p), "utf-8") : undefined),
    readBytes: (p) => (existsSync(abs(p)) ? readFileSync(abs(p)) : undefined),
    placeholder: "<sources>/",
  };
}

// ── E05 / E08 / E19 inputs ────────────────────────────────────────────────────

interface ObsLine {
  kind?: string;
  key?: Record<string, unknown>;
  ref?: string;
  signature?: string;
}

function readObservationFile(file: string): ObsLine[] | undefined {
  if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .slice(1)
    .map((l) => JSON.parse(l) as ObsLine);
}

/** E05's net-function names with their executable refs (undefined when E05 has no file). */
export function e05Natives(paths: CensusPaths, build: string): Map<string, string> | undefined {
  const rows = readObservationFile(join(paths.observations, "E05", `${build}.jsonl`));
  if (!rows) return undefined;
  const out = new Map<string, string>();
  for (const r of rows)
    if (r.kind === "net-function" && typeof r.key?.native === "string")
      out.set(r.key.native, r.ref ?? "");
  return out;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface RowsResult {
  observations: { id: string; obs: Observation }[];
  /** Rows not emitted, with the reason. */
  leftOut: { what: string; why: string; handler?: string }[];
}

function nativeRow(n: NativeDoc, e05: Map<string, string> | undefined): Observation {
  const exe = e05?.get(n.name);
  const named =
    e05 === undefined
      ? "named in the executable: unknown (no E05 observation file at this build)"
      : exe !== undefined
        ? `named in the executable: yes (E05 ${exe})`
        : "named in the executable: no (E05 lists no net-function of this name)";
  const status = ["documented by Bohemia: yes (NetApiDocs.c)", named, ANSWERING];
  if (e05 !== undefined && exe === undefined)
    status.push(`${n.name} is documented by Bohemia and absent from the executable`);
  return {
    dim: "net",
    kind: "net-function",
    module: "none",
    key: { native: n.name },
    parent_key: null,
    label: n.name,
    signature: shapeSignature(n.name, n.request, n.response),
    origin: "vanilla",
    ref: pakRef({ file: NET_DOCS_FILE, line: n.line }),
    quote: n.quote,
    confidence: "high",
    unverified: status,
  };
}

function siteText(s: { api: string; file: string; line: number }): string {
  return `${s.api} at ${pakRef(s)}`;
}

/**
 * `children` is the number of fields the source shows; undefined when some of
 * them could not be emitted (`leftOutFields`), so the ledger does not count the
 * handler as fully enumerated.
 */
function handlerRow(
  h: HandlerInfo,
  children: number | undefined,
  quote: string | undefined,
  leftOutFields: string[] = [],
): Observation {
  const unverified: string[] = [];
  if (h.doxygenOnly)
    unverified.push(
      "declared only under #ifdef DOXYGEN in NetApiDocs.c: documentation, not compiled in a Workbench session",
    );
  else unverified.push(ANSWERING);
  if (h.dialogs.length)
    unverified.push(
      `modal blocks from the code path: ${h.dialogs.map(siteText).join("; ")} inside the call; that it parks the NET queue is not verified live`,
    );
  if (h.writers.length)
    unverified.push(
      `risk_hint mutating from the code path: ${h.writers.map(siteText).join("; ")}; not verified live`,
    );
  if (h.requestNote) unverified.push(`request: ${h.requestNote}`);
  if (h.responseNote) unverified.push(`response: ${h.responseNote}`);
  for (const d of h.dynamic) unverified.push(`dynamic keys: ${d}`);
  unverified.push(
    `module ${h.module}: ${h.moduleRule}${h.drives.length ? ` (${h.drives.join(", ")})` : ""}`,
  );
  if (leftOutFields.length)
    unverified.push(
      `children_count left off: the source shows ${h.fields.length} field(s), ${leftOutFields.length} without a row (${leftOutFields.join("; ")})`,
    );
  return {
    dim: "net",
    kind: "net-handler",
    module: h.module,
    key: { handler: h.name },
    parent_key: null,
    label: h.name,
    class_name: h.name,
    signature: handlerSignature(h),
    ...(h.what ? { what: h.what } : {}),
    ...(h.writers.length ? { risk_hint: "mutating" as const } : {}),
    origin: "vanilla",
    ref: pakRef(h),
    ...(quote ? { quote } : {}),
    confidence: "high",
    ...(children !== undefined ? { children_count: children } : {}),
    ...(h.dialogs.length ? { modal: "blocks" as const } : {}),
    unverified,
  };
}

function fieldRow(h: HandlerInfo, f: FieldInfo, quote: string | undefined): Observation {
  const unverified: string[] = [];
  if (f.mechanism === "RegAll")
    unverified.push(
      `registered by RegAll() in ${f.registered_in} (every variable on the object; ref is the member declaration)`,
    );
  if (f.mechanism === "OnPack")
    unverified.push(`written by ${f.struct}.OnPack (the key exists only in the response JSON)`);
  if (f.inherited)
    unverified.push(`inherited: registered by ${f.registered_in}, a parent of ${f.struct}`);
  if (f.unregistered_at) unverified.push(`UnregV at ${f.unregistered_at} may remove it`);
  if (f.type === "unknown") unverified.push("RegV names no member variable of the class chain");
  return {
    dim: "net",
    kind: "net-field",
    module: h.module,
    key: f.dir === "req" ? { handler: h.name, req: f.name } : { handler: h.name, resp: f.name },
    parent_key: { dim: "net", kind: "net-handler", module: h.module, key: { handler: h.name } },
    label: f.name,
    class_name: f.struct,
    signature: f.type,
    ...(f.doc ? { what: f.doc } : {}),
    origin: "vanilla",
    ref: pakRef(f),
    ...(quote ? { quote } : {}),
    confidence: f.mechanism === "RegV" || f.mechanism === "OnPack" ? "high" : "medium",
    ...(unverified.length ? { unverified } : {}),
  };
}

/** Observation rows for the natives, the handlers and their fields, sorted by id. */
export function observationRows(
  natives: NativeDoc[],
  handlers: HandlerInfo[],
  src: SourceTexts,
  e05: Map<string, string> | undefined,
): RowsResult {
  const out: { id: string; obs: Observation }[] = [];
  const leftOut: RowsResult["leftOut"] = [];
  const push = (obs: Observation): boolean => {
    let id: string;
    try {
      id = deriveId(obs);
    } catch (e) {
      leftOut.push({
        what: `${obs.kind} ${JSON.stringify(obs.key)}`,
        why: e instanceof Error ? e.message : String(e),
        ...(typeof obs.key.handler === "string" ? { handler: obs.key.handler } : {}),
      });
      return false;
    }
    if (allStrings(obs).some(containsMachinePath)) {
      leftOut.push({ what: id, why: "holds a machine path" });
      return false;
    }
    observationSchema.parse(obs);
    out.push({ id, obs });
    return true;
  };
  for (const n of natives) push(nativeRow(n, e05));
  for (const h of handlers) {
    const missing: string[] = [];
    for (const f of h.fields)
      if (!push(fieldRow(h, f, src.quote(f.file, f.line))))
        missing.push(`${f.dir} ${JSON.stringify(f.name)}: ${leftOut[leftOut.length - 1].why}`);
    // children_count is what the source shows; claim it only when every child has a row.
    push(handlerRow(h, missing.length ? undefined : h.fields.length, h.quote, missing));
  }
  const seen = new Set<string>();
  for (const o of out) {
    if (seen.has(o.id)) throw new Error(`duplicate id ${o.id}`);
    seen.add(o.id);
  }
  out.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { observations: out, leftOut };
}

export function observationFileText(
  rows: RowsResult,
  build: string,
  inputs: { path: string; sha256: string }[],
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs,
    provisional: false,
    row_count: rows.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...rows.observations.map((o) => jsonlLine(o.obs))].join("\n") +
    "\n"
  );
}

// ── Analysis entry point ──────────────────────────────────────────────────────

export interface Analysis {
  index: SourceIndex;
  src: SourceTexts;
  natives: NativeDoc[];
  handlers: HandlerInfo[];
  table: ContractEntry[];
}

export function analyze(index: SourceIndex, backend: SourceBackend): Analysis {
  const src = new SourceTexts((p) => backend.readText(p));
  const docs = src.lines(NET_DOCS_FILE);
  const natives = docs ? parseNetApiDocs(docs.join("\n")) : [];
  const handlers = analyzeHandlers(index, src);
  return { index, src, natives, handlers, table: contractTable(handlers, natives) };
}

/**
 * Header inputs: every script file the analysis read, hashed over its bytes;
 * E02's source index (class hierarchy, members and types every row depends
 * on); E05's file.
 */
export function inputsOf(
  a: Analysis,
  backend: SourceBackend,
  e05File: string | undefined,
  indexInput?: { path: string; sha256: string },
): { path: string; sha256: string }[] {
  const out = [...a.src.touched]
    .sort(compareCodeUnits)
    .map((f) => ({
      path: `${backend.placeholder}${f}`,
      sha256: sha256(backend.readBytes(f) ?? ""),
    }));
  if (indexInput) out.push(indexInput);
  if (e05File && existsSync(e05File))
    out.push({
      path: `<repo>/data/census/observations/E05/${e05File.split(/[\\/]/).pop()}`,
      sha256: sha256(readFileSync(e05File)),
    });
  return out;
}

// ── Headline counts ───────────────────────────────────────────────────────────

export interface HeadlineCounts {
  natives_documented: number;
  natives_named_in_executable: number | null;
  natives_documented_not_in_executable: string[];
  handler_classes: number;
  handlers_active: number;
  handlers_doxygen_only: string[];
  handlers_per_folder: Record<string, number>;
  handlers_per_module: Record<string, number>;
  request_fields: number;
  response_fields: number;
  fields_by_mechanism: Record<string, number>;
  inherited_fields: number;
  modal_handlers: string[];
  mutating_handlers: string[];
  rows: number;
  rows_by_kind: Record<string, number>;
  left_out: number;
}

export function headlineCounts(
  a: Analysis,
  rows: RowsResult,
  e05: Map<string, string> | undefined,
): HeadlineCounts {
  const tally = (xs: string[]): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const x of [...xs].sort(compareCodeUnits)) o[x] = (o[x] ?? 0) + 1;
    return o;
  };
  const fields = a.handlers.flatMap((h) => h.fields);
  return {
    natives_documented: a.natives.length,
    natives_named_in_executable: e05 ? a.natives.filter((n) => e05.has(n.name)).length : null,
    natives_documented_not_in_executable: e05
      ? a.natives.filter((n) => !e05.has(n.name)).map((n) => n.name)
      : [],
    handler_classes: a.handlers.length,
    handlers_active: a.handlers.filter((h) => !h.doxygenOnly).length,
    handlers_doxygen_only: a.handlers.filter((h) => h.doxygenOnly).map((h) => h.name),
    handlers_per_folder: tally(a.handlers.map((h) => h.file.slice(0, h.file.lastIndexOf("/")))),
    handlers_per_module: tally(a.handlers.map((h) => h.module)),
    request_fields: fields.filter((f) => f.dir === "req").length,
    response_fields: fields.filter((f) => f.dir === "resp").length,
    fields_by_mechanism: tally(fields.map((f) => f.mechanism)),
    inherited_fields: fields.filter((f) => f.inherited).length,
    modal_handlers: a.handlers.filter((h) => h.dialogs.length).map((h) => h.name),
    mutating_handlers: a.handlers.filter((h) => h.writers.length).map((h) => h.name),
    rows: rows.observations.length,
    rows_by_kind: tally(rows.observations.map((o) => o.obs.kind)),
    left_out: rows.leftOut.length,
  };
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

export function handlersDocument(a: Analysis, build: string): unknown {
  return {
    $comment:
      "E04 raw material: every NetApiHandler subclass in the game's script source with its request and response classes, registered fields, the modal and file-writing calls on its code path and the modules it drives. Static reading, not execution.",
    enumerator: ENUMERATOR_ID,
    build,
    natives: a.natives,
    handlers: a.handlers,
    contract: a.table,
  };
}

/** One call site as E19's net-call-sites.json lists it (the fields E04 reads). */
export interface BlenderCallSite {
  file: string;
  line: number;
  net_function: string | null;
  response_var: string | null;
}

export interface BlenderRescan {
  /** Keys E19's list lacks, per NET function. */
  added: Map<string, RescanRead[]>;
  sites_read: number;
  /** Sites not re-read, with the reason. */
  sites_skipped: { site: string; why: string }[];
}

/**
 * Re-reads the Python at every E19 call site that names its NET function and
 * keeps the response in a variable (`pythonResponseReads`), and returns the
 * keys E19's artifact does not list for that function. Files are relative to
 * `<tools>/Blender`.
 */
export function rescanBlender(
  sites: BlenderCallSite[],
  calls: BlenderNetFunction[],
  readPython: (rel: string) => string | undefined,
): BlenderRescan {
  const listed = new Map(calls.map((c) => [c.name, c.response_keys]));
  const added = new Map<string, RescanRead[]>();
  const skipped: BlenderRescan["sites_skipped"] = [];
  let read = 0;
  const ordered = [...sites].sort((x, y) => compareCodeUnits(x.file, y.file) || x.line - y.line);
  for (const s of ordered) {
    const site = `${s.file}#L${s.line}`;
    if (!s.net_function) {
      skipped.push({ site, why: "NET function name not resolved by E19" });
      continue;
    }
    if (!s.response_var) {
      skipped.push({ site, why: "response not kept in a variable" });
      continue;
    }
    if (s.file.includes("!/")) {
      skipped.push({ site, why: "inside a zip archive" });
      continue;
    }
    const text = readPython(s.file);
    if (text === undefined) {
      skipped.push({ site, why: "file not readable under <tools>/Blender" });
      continue;
    }
    read++;
    const known = listed.get(s.net_function) ?? [];
    const list = added.get(s.net_function) ?? [];
    for (const r of pythonResponseReads(text, s.line, s.response_var)) {
      if (known.includes(r.key)) continue;
      const at = `${s.file}#L${r.line}`;
      if (!list.some((x) => x.key === r.key && x.at === at)) list.push({ key: r.key, at });
    }
    if (list.length) added.set(s.net_function, list);
  }
  return { added, sites_read: read, sites_skipped: skipped };
}

export function blenderDocument(
  a: Analysis,
  build: string,
  calls: BlenderNetFunction[] | undefined,
  why?: string,
  rescan?: BlenderRescan,
  rescanWhy?: string,
): unknown {
  if (!calls)
    return { $comment: "E04 cross-check against E19's Blender call sites", build, skipped: why };
  const r = crossCheck(a.table, calls, rescan?.added);
  const keysAdded = r.entries.flatMap((e) =>
    (e.read_added_by_rescan ?? []).map((x) => ({ name: e.name, key: x.key, at: x.at })),
  );
  return {
    $comment:
      "E04 cross-check: the keys the Enfusion Blender Tools add-on sends to and reads from each NET function (E19's net-call-sites.json) against the keys the script handler registers or NetApiDocs.c documents. Response keys are E19's plus any a line re-read of the Python at each call site finds that E19 does not list (read_added_by_rescan; such a key is a gap in E19's artifact). ErrorCode is the client's own result field (the protocol error code), not a payload key.",
    enumerator: ENUMERATOR_ID,
    build,
    rescan: rescan
      ? {
          sites_read: rescan.sites_read,
          sites_skipped: rescan.sites_skipped,
          keys_added_to_e19: keysAdded,
        }
      : { skipped: rescanWhy ?? "not run" },
    summary: {
      called: r.entries.length,
      handlers_called: r.entries.filter((e) => e.kind === "handler").length,
      natives_called: r.entries.filter((e) => e.kind === "native").length,
      unknown_called: r.entries.filter((e) => e.kind === "unknown").map((e) => e.name),
      consistent: r.entries.filter((e) => e.consistent).length,
      exact: r.entries.filter((e) => e.exact).length,
      with_sent_not_declared: r.entries
        .filter((e) => e.sent_not_declared.length)
        .map((e) => e.name),
      with_read_not_declared: r.entries
        .filter((e) => e.read_not_declared.length)
        .map((e) => e.name),
      not_called: r.not_called,
    },
    entries: r.entries,
  };
}

export function e08Document(a: Analysis, build: string, e08: ObsLine[] | undefined): unknown {
  if (!e08)
    return { $comment: "E04 cross-check against E08", build, skipped: "no E08 observation file" };
  const theirs = new Map<string, { request: string[]; response: string[] } | null>();
  for (const r of e08)
    if (r.kind === "net-function" && typeof r.key?.native === "string")
      theirs.set(r.key.native, r.signature ? parseShapeSignature(r.signature) : null);
  const sameSet = (x: string[], y: string[]): boolean =>
    x.length === y.length && x.every((v) => y.includes(v));
  const entries = a.natives.map((n) => {
    const t = theirs.get(n.name);
    const req = n.request.map((f) => f.name);
    const resp = n.response.map((f) => f.name);
    return {
      name: n.name,
      in_e08: t !== undefined,
      request: req,
      e08_request: t?.request ?? null,
      response: resp,
      e08_response: t?.response ?? null,
      agree: !!t && sameSet(req, t.request) && sameSet(resp, t.response),
    };
  });
  return {
    $comment:
      "E04 cross-check: native NET functions documented in NetApiDocs.c (pak source) against E08's rows from the shipped HTML documentation (Page_NetApi.html).",
    enumerator: ENUMERATOR_ID,
    build,
    summary: {
      documented: entries.length,
      in_e08: entries.filter((e) => e.in_e08).length,
      agree: entries.filter((e) => e.agree).length,
      only_in_e08: [...theirs.keys()].filter((k) => !a.natives.some((n) => n.name === k)).sort(),
    },
    entries,
  };
}

/** Text of the contract table as a TypeScript literal (for the contract test). */
export function contractText(table: ContractEntry[]): string {
  const q = (xs: string[]): string => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  return [
    "export const DECLARED: readonly ContractRow[] = [",
    ...table.map(
      (e) =>
        `  { name: ${JSON.stringify(e.name)}, kind: ${JSON.stringify(e.kind)}, request: ${q(e.request)}, response: ${q(e.response)}, ref: ${JSON.stringify(e.ref)} },`,
    ),
    "];",
  ].join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e04-net-surface.ts [--build <tag>] [--game <dir> | --sources <dir>] [--artifacts <dir>] [--index <artifacts dir holding E02's source index>] [--tools <dir>] [--out <file under observations/E04/>] [--data <dir>] [--json] [--emit-contract]";

export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E04/ (E04 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e04-net-surface", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        sources: { type: "string" },
        artifacts: { type: "string" },
        index: { type: "string" },
        tools: { type: "string" },
        out: { type: "string" },
        data: { type: "string" },
        json: { type: "boolean" },
        "emit-contract": { type: "boolean" },
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
      io.err(`e04-net-surface: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    for (const [flag, dir] of [
      ["--artifacts", values.artifacts],
      ["--index", values.index],
    ] as const) {
      if (dir && insideGitWorkTree(dir)) {
        io.err(
          `e04-net-surface: refusing ${flag} inside a git working tree; raw artifacts never enter one (plan 4.2)`,
        );
        return EXIT_FAIL;
      }
    }
    const artifactRoot = values.artifacts ? resolve(values.artifacts) : artifactsDir();

    let backend: SourceBackend;
    let index: SourceIndex;
    let indexInput: { path: string; sha256: string };
    if (values.sources) {
      const dir = resolve(values.sources);
      if (!existsSync(dir)) {
        io.out("NO DATA: --sources directory does not exist; nothing written");
        return EXIT_USAGE;
      }
      backend = dirBackend(dir);
      index = buildSourceIndex(
        backend
          .allFilePaths()
          .filter(isScriptSource)
          .map((p) => ({ path: p, text: backend.readText(p) ?? "" })),
        { build },
      );
      indexInput = {
        path: "<sources>/#E02-source-index-built-in-memory",
        sha256: sha256(sourceIndexText(index)),
      };
    } else {
      const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
      const vfs =
        gamePath && existsSync(join(gamePath, "addons")) ? PakVirtualFS.get(gamePath) : null;
      if (!vfs) {
        io.out(
          "NO DATA: no game install with pak files at the configured game path (ENFUSION_GAME_PATH or --game); nothing written",
        );
        return EXIT_USAGE;
      }
      backend = pakBackend(vfs);
      // E02's source index from the artifacts folder; built from the paks and saved when absent.
      const indexRoot = values.index ? resolve(values.index) : artifactRoot;
      const loaded = loadSourceIndex(build, { dir: indexRoot });
      if (loaded) index = loaded;
      else {
        index = buildSourceIndex(vfs, { build });
        saveSourceIndex(index, { dir: indexRoot });
      }
      indexInput = {
        path: `<artifacts>/census/${build}/E02/${SOURCE_INDEX_FILE}`,
        sha256: sha256(readFileSync(sourceIndexPath(build, indexRoot))),
      };
    }

    const a = analyze(index, backend);
    if (values["emit-contract"]) {
      io.out(contractText(a.table));
      return EXIT_OK;
    }
    const e05File = join(paths.observations, "E05", `${build}.jsonl`);
    const e05 = e05Natives(paths, build);
    const rows = observationRows(a.natives, a.handlers, a.src, e05);
    const text = observationFileText(rows, build, inputsOf(a, backend, e05File, indexInput));
    if (containsMachinePath(text)) {
      io.err("e04-net-surface: the observation file would hold a machine path; not written");
      return EXIT_FAIL;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, text);

    // Artifacts.
    const artDir = join(artifactRoot, "census", build, ENUMERATOR_ID);
    mkdirSync(artDir, { recursive: true });
    const sitesFile = join(artifactRoot, "census", build, "E19", "net-call-sites.json");
    let calls: BlenderNetFunction[] | undefined;
    let callsWhy: string | undefined;
    if (existsSync(sitesFile)) {
      const doc = JSON.parse(readFileSync(sitesFile, "utf-8")) as {
        net_functions?: BlenderNetFunction[];
      };
      calls = doc.net_functions ?? [];
    } else callsWhy = "no <artifacts>/census/<build>/E19/net-call-sites.json (run E19 first)";
    let rescan: BlenderRescan | undefined;
    let rescanWhy: string | undefined;
    if (calls) {
      const toolsDir = values.tools ? resolve(values.tools) : loadConfig().workbenchPath;
      const blenderDir = toolsDir ? join(toolsDir, "Blender") : "";
      if (blenderDir && existsSync(blenderDir)) {
        const sites =
          (JSON.parse(readFileSync(sitesFile, "utf-8")) as { call_sites?: BlenderCallSite[] })
            .call_sites ?? [];
        rescan = rescanBlender(sites, calls, (rel) => {
          const f = join(blenderDir, ...rel.split("/"));
          return existsSync(f) ? readFileSync(f, "utf-8") : undefined;
        });
      } else rescanWhy = "no <tools>/Blender directory (ENFUSION_WORKBENCH_PATH or --tools)";
    }
    const e08 = readObservationFile(join(paths.observations, "E08", `${build}.jsonl`));
    const blender = blenderDocument(a, build, calls, callsWhy, rescan, rescanWhy) as {
      summary?: unknown;
    };
    const docs: [string, unknown][] = [
      ["handlers.json", handlersDocument(a, build)],
      ["blender-crosscheck.json", blender],
      ["e08-crosscheck.json", e08Document(a, build, e08)],
    ];
    for (const [name, doc] of docs) {
      const t = formatJson(doc);
      if (containsMachinePath(t)) {
        io.err(`e04-net-surface: ${name} would hold a machine path; not written`);
        return EXIT_FAIL;
      }
      writeFileAtomic(join(artDir, name), t);
    }

    const counts = headlineCounts(a, rows, e05);
    const e08doc = e08Document(a, build, e08) as { summary?: unknown };
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e04-net-surface",
          build,
          counts,
          left_out: rows.leftOut,
          blender: blender.summary ?? null,
          e08: e08doc.summary ?? null,
        }),
      );
      return EXIT_OK;
    }
    for (const l of rows.leftOut) io.out(`left out ${l.what}: ${l.why}`);
    io.out(
      `E04 at build ${build}: ${counts.natives_documented} native functions documented (${counts.natives_named_in_executable ?? "?"} named in the executable), ${counts.handler_classes} handler classes (${counts.handlers_active} active, ${counts.handlers_doxygen_only.length} DOXYGEN-only), ${counts.request_fields} request and ${counts.response_fields} response fields; ${rows.observations.length} rows (${Object.entries(
        counts.rows_by_kind,
      )
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")}), ${rows.leftOut.length} left out`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
