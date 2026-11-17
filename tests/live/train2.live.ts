/**
 * Sitting P3-3: handler compile train #2 (plan 5.4; DEC-048 "Live sittings" item 3, DEC-050 "Next",
 * DEC-051). The first compile of the Phase 3 shipped handlers, in two gates, each with its own
 * launch and its own budget of three relaunches (plan 5.4 item 5).
 *
 * A GUI Workbench on the 2.0 sandbox, launched on the scratch profile after the two-pass pre-flight
 * (as S-F did), WITHOUT `-scriptAuthorizeAll`, with the shipped bundle (28 files incl.
 * EMCP_WB_BuildStamp.c), the read-only probe pack (`mod-dev/probe`: moduleMatrix, layerRead) and the
 * mutating pack (`mod-dev/probe-mut`: createSandboxWorlds, as S-E se-03). The launch is the
 * pre-flight's (scripts/live/preflight.ts); this script never launches, never takes the lease for
 * itself (the lane given with --id holds it), and reaches Workbench through the shipped TS tools
 * (wb_module, wb_container, wb_plugin, wb_bi, wb_gui) over a `WorkbenchClient` WITHOUT a Config (no
 * lease, no auto-launch, no handler recovery), plus single raw sockets (s-c-natives rawNetCall) for
 * Ping, Info, the natives and the probe packs.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline and the ACTION PLAN (the JSON array
 * `scripts/live/dry-run.ts` checks), checks the plan against the policy and writes it to --out.
 * `--emit-queue <file>` writes the queue (docs/v2/sessions/queues/P3-3-queue.json; a test keeps the
 * two equal). The runbook is docs/v2/sessions/queues/P3-3.md.
 *
 * Phases (the queue's `launch`): "offline-0" before gate 1 (install, plant; no Workbench running),
 * 1 (gate 1), 2 (gate 2, a new launch, only when gate 1's verdict passed). Each step writes
 * `<run>/<step>.json`; a step is never run twice in a run folder and a stopped step is never retried
 * (plan 5.3): a relaunch takes a new run folder in the same sitting folder.
 *
 * Stop rules (every live step): a dialog-like window already up (owned, #32770, a known modal
 * title, disabled) refuses the step before anything is sent. While the step runs the pid's window
 * list is polled; a new dialog-like window is a HANDOFF, any other new window a STOP unless it is
 * an expected editor window (class Qt683QWindowIcon, unowned, title exactly as S-E's se-24 record).
 * The first verdict CUTS the step: its next call or wait throws (nothing more is sent), the record
 * says `cut: true`, the process exits explicitly. An UNPROVEN or GATED refusal is a record (status
 * "observed"), never a failure. Three relaunches per gate, counted by distinct pid in
 * `<sitting>/relaunches.json`; every live step checks the recorded pid is its gate's counted launch;
 * a fifth launch of a gate is refused (split the train, restore the last-known-good set).
 *
 * Usage:
 *   npx --no tsx tests/live/train2.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/train2.live.ts --really --id <lane id> --sandbox <dir> --sitting-dir <dir>
 *       (--from <step> | --only <step>) [--until <step>] [--run-dir <dir in the sitting>]
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/train2.live.ts restore --sandbox <dir> [--id <lane id> --really]
 *   npx --no tsx tests/live/train2.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane id> --really]
 *
 * Exit: 0 done (or dry run passed), 1 refused or plan check failed, 2 usage, 3 stopped,
 *       4 aborted (not the sandbox), 5 handoff (owner action needed; resume as printed).
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { DEFAULT_SNAPSHOT_BOUNDS, snapshotPlanAction, type UiaNode } from "../../src/gui/uia.js";
import { MODULE_IDS, moduleAllowsRead } from "../../src/manifest/vocabulary.js";
import { loadAllowList, loadCatalog, runPlugin } from "../../src/tools/wb-plugin.js";
import { runBi } from "../../src/tools/wb-bi.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runGui } from "../../src/tools/wb-gui.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { BUILD_STAMP_FILE, WorkbenchClient, bundleDigest } from "../../src/workbench/client.js";
import { readStamp } from "../../scripts/build-stamp.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../scripts/live/evidence.js";
import { Lane } from "../../scripts/live/lane.js";
import {
  BUNDLED_HANDLER_DIR,
  HANDLER_FOLDER,
  MOD_DEV_ROOT,
  WORKBENCH_EXE,
  handlerFiles,
  installHandlers,
  installProbePacks,
  probePackTarget,
} from "../../scripts/live/launch.js";
import { DEFAULT_PORT } from "../../scripts/live/netcall.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { runPowerShell } from "../../scripts/live/powershell.js";
import { newestSessionLog } from "../../scripts/live/preflight.js";
import {
  WINDOWS_SCRIPT,
  parseWindows,
  rawNetCall,
  type RawCallResult,
  type WindowInfo,
} from "../../scripts/live/s-c-natives.js";
import { probeFacts, probeStatus } from "../../scripts/live/s-d-train1.js";
import {
  firstScalar,
  isThrowawayWorld,
  registrationProblem,
} from "../../scripts/live/s-e-train1b.js";
import { processByPid, processesByImage, defaultExec } from "../../scripts/live/win.js";
import { DEFAULT_BOUNDS as WALK_DEFAULT_BOUNDS } from "../../tools/uia/walk.js";
import {
  BENIGN_TOOL_WINDOW_CLASS,
  BENIGN_TOOL_WINDOW_TITLE,
  EDITOR_WINDOW_CLASS,
  EXIT,
  StepCut,
  StopBattery,
  WINDOW_POLL_MS,
  baselineRefusal,
  isBenignToolWindow,
  isDialogWindow,
  isExpectedWindow,
  watched,
  windowVerdict,
} from "../../scripts/census/live/common.js";

// The window rule and the step runner live in scripts/census/live/common.ts (Phase 4, plan 6.1);
// re-exported so this script's names are unchanged.
export {
  BENIGN_TOOL_WINDOW_CLASS,
  BENIGN_TOOL_WINDOW_TITLE,
  EDITOR_WINDOW_CLASS,
  EXIT,
  StopBattery,
  baselineRefusal,
  isBenignToolWindow,
  isDialogWindow,
  isExpectedWindow,
  windowVerdict,
};

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P3-3";
export const SCRIPT_PATH = "tests/live/train2.live.ts";
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "P3-3-queue.json");

/** The flag no P3-3 launch carries (DEC-048: without it unless the go says otherwise). */
export const NEVER_FLAG = "-scriptAuthorizeAll";
/** The launch arguments the plan records; pre-flight builds the real ones. */
export const LAUNCH_ARGS: readonly string[] = ["-gproj", `<sandbox>/${SANDBOX_NAME}.gproj`];

/** The last-known-good handler set (plan 5.4 item 5): the 1.x set at this local tag. */
export const LKG_TAG = "v2-phase2-exit";
export const HANDLER_REL = `mod/Scripts/WorkbenchGame/${HANDLER_FOLDER}`;
/** The bundle's file count and its compiled handler count (DEC-050 LINT and INFO). */
export const SHIPPED_FILES = 28;
export const HANDLER_COUNT = 24;

export const PING = "EMCP_WB_Ping";
export const INFO = "EMCP_WB_Info";
export const EDITOR_CONTROL = "EMCP_WB_EditorControl";
export const PROBE_API = "ECEN_Probe";
export const MUT_API = "ECEN_ProbeMut";
export const PROBE_PACKS = ["probe", "probe-mut"] as const;

/** Every write by a live step lies under this folder (the offline install and restore write the handler and probe folders). */
export const THROWAWAY = "_throwaway";
export const P33_ROOT = `${THROWAWAY}/P33`;
export const WORLDS_DIR = `${P33_ROOT}/worlds`;
export const TINY_NAME = "EMCP_P33_Tiny";
export const FLAT_NAME = "EMCP_P33_Flat";
export const TINY_WORLD = `${WORLDS_DIR}/${TINY_NAME}.ent`;
/** The planted .conf copy (S-E's u16 known-good target: vanilla inputCommon.conf, DEC-044 U16). */
export const VANILLA_CONF = "configs/inputCommon.conf";
export const PLANT_CONF = `${P33_ROOT}/u16/inputCommon.conf`;
/** The file the parser writes for the engine-accept check. */
export const CST_CONF = `${P33_ROOT}/cst/emcp_p33_cst.conf`;

export const PLANT_FILE = "plant-p33.json";
export const WORLDS_FILE = "worlds-p33.json";
export const RELAUNCH_FILE = "relaunches.json";
export const gateVerdictFile = (gate: 1 | 2): string => `gate-${gate}.json`;
export const MAX_RELAUNCHES = 3;

/** The one dock toggle wb_module action sends (policy execute_action.allow_list, S-D U9 labels). */
export const TOGGLE_MODULE = "WorldEditor";
export const TOGGLE_PATH: readonly string[] = ["Window", "Hierarchy"];
/** wb_bi call: three of the 14 verified read handlers (DEC-040). */
export const BI_CALLS = ["CheckGUID", "LocateProject", "GetLoadedProjects"] as const;

const DEBUG_TITLE =
  // The "Debugging: … on port: n" part is absent on some launches (P3-3 gate 2 launch 3, 2026-10-10,
  // with -scriptAuthorizeAll: "Script Editor - Configuration: WORKBENCH").
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
/** Titles the Script Editor open may add (EV-S-E-044; the bare title is [unverified]). */
export const SCRIPT_EDITOR_WINDOWS: readonly RegExp[] = [DEBUG_TITLE, /^Script Editor$/];
/** Titles the World Editor module open fans out (DEC-045; the se-24 list in EV-S-E-044). */
export const WORLD_EDITOR_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  DEBUG_TITLE,
  /^Enfusion Workbench - EMCP2 sandbox \(2\.0 live lane\)$/,
  /^Procedural Animation Editor$/,
  /^String Editor$/,
  /^Behavior Editor - EMCP2_sandbox$/,
  /^Audio Editor$/,
  /^Animation Editor$/,
];

export const TIMEOUTS = {
  cheap: 10_000,
  read: 30_000,
  /** World load and module open (S-E se-08: 600 s budget, ready in about 2 s). */
  open: 600_000,
  save: 120_000,
  poll: 5_000,
  windowPoll: WINDOW_POLL_MS,
  walk: 660_000,
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export type Phase = "offline-0" | 1 | 2;
export type Risk = "read-only" | "reversible" | "mutating";
export type StepStatus =
  | "pass"
  | "fail"
  | "observed"
  | "skipped"
  | "stopped"
  | "aborted"
  | "handoff";

export interface StepRecord {
  step: string;
  phase: Phase;
  title: string;
  proves: string;
  status: StepStatus;
  startedAt: string;
  endedAt: string;
  evidence: Record<string, unknown>;
  stop?: string;
}

export interface StepOutcome {
  status: StepStatus;
  evidence: Record<string, unknown>;
}

/** What a shipped TS tool answers (design section 4). */
export interface ToolResponse {
  ok: boolean;
  action?: string;
  target?: string;
  code?: string;
  message?: string;
  changed?: unknown;
  readback?: unknown;
  next?: string;
  warnings?: string[];
  [extra: string]: unknown;
}

export type ToolName = "wb_module" | "wb_container" | "wb_plugin" | "wb_bi" | "wb_gui";

export interface WalkResult {
  ok: boolean;
  tree: UiaNode | null;
  summary: Record<string, unknown> | null;
  detail: string;
}

export interface InstallReport {
  shipped: string[];
  probe: string[];
  digest: string | null;
  stamp: string | null;
}

export interface Train2Deps {
  /** One shipped TS tool, run against a client WITHOUT a Config. */
  tool: (name: ToolName, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** One raw socket, never retried (Ping, Info, natives, probe packs, EditorControl). */
  net: (
    apiFunc: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<RawCallResult>;
  /** The passive walker (tools/uia/walk.ts) on one window of the recorded pid. */
  walk: (target: { pid: number; className: string; titlePattern: string }) => Promise<WalkResult>;
  /** Every top-level window (s-c-natives WINDOWS_SCRIPT). */
  windows: () => Promise<WindowInfo[]>;
  bundleDigest: () => string | null;
  /** The Workbench pid the lane recorded at the launch, and that pid's image (null: gone). */
  recordedPid: () => number | null;
  processImage: (pid: number) => string | null;
  /** Pids of running Workbench images (the offline steps need none). */
  workbenchPids: () => number[];
  /** The newest session log's text, or null. */
  sessionLog: () => string | null;
  install: (sandboxDir: string) => InstallReport;
  /** Blob ids of the last-known-good set (`git ls-tree <tag> <HANDLER_REL>`). */
  lkgFiles: () => Array<{ name: string; blob: string }>;
  /** Vanilla bytes from the game paks (read-only). */
  readVanilla: (vpath: string) => Buffer;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface Train2Options {
  runDir: string;
  /** The sitting folder: relaunch counter and gate verdicts live here, across run folders. */
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

export interface StepContext {
  deps: Train2Deps;
  opts: Train2Options;
  prior: (id: string) => StepRecord | null;
  /** Records the raw calls and tool answers of the running step. */
  calls: Array<Record<string, unknown>>;
  tool: (name: ToolName, args: Record<string, unknown>) => Promise<ToolResponse>;
  net: (
    apiFunc: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<RawCallResult>;
  /** A wait that ends the step once the window poller has cut it. */
  sleep: (ms: number) => Promise<void>;
  /** Aborted when the window poller stops the step: no further call is sent (TRAIN2-01). */
  signal: AbortSignal;
}

export interface StepDef {
  id: string;
  phase: Phase;
  title: string;
  /** The decision that proved the route, or "first compile" (DEC-050/051: unproven until now). */
  proves: string;
  risk: Risk;
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  /** Titles a step that opens a module may add; any other new window stops the run. */
  expectsWindows?: readonly RegExp[];
  plan: () => PlanAction[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const S = (v: unknown): string => (typeof v === "string" ? v : "");

function field(o: unknown, name: string): unknown {
  return o && typeof o === "object" ? (o as Record<string, unknown>)[name] : undefined;
}

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

function net(apiFunc: string, params?: Record<string, unknown>, note?: string): PlanAction {
  const a: Record<string, unknown> = { kind: "net-call", target: apiFunc };
  if (params) a.params = params;
  if (note) a.note = note;
  return a as PlanAction;
}

/** The plan entry of a tool call: the handler it sends to, with the wire action. */
function toolNet(handler: string, params: Record<string, unknown>, note?: string): PlanAction {
  return net(handler, params, note ?? "through the shipped TS tool");
}

/** A refusal the battery records, never counts as a failure (the brief's stop rules). */
export const RECORD_ONLY_CODES: ReadonlySet<string> = new Set(["UNPROVEN", "GATED"]);

export function recordOnly(r: ToolResponse): boolean {
  return !r.ok && typeof r.code === "string" && RECORD_ONLY_CODES.has(r.code);
}

/** Lines of a session log that name a shipped or probe class with an error. */
export function compileErrors(log: string): string[] {
  return log
    .split(/\r?\n/)
    .filter((l) => /(EMCP_WB_|ECEN_)/.test(l) && /error|cannot|undefined|unknown/i.test(l))
    .slice(0, 20);
}

/** controlType+name of every node, depth first. */
export function flattenTree(n: UiaNode | null | undefined, out: string[] = []): string[] {
  if (!n) return out;
  out.push(`${n.controlType}|${n.name}`);
  for (const c of n.children ?? []) flattenTree(c, out);
  return out;
}

/** Node-for-node comparison on controlType+name (DEC-051: the GUI route is unproven). */
export function compareTrees(
  gui: UiaNode | null,
  walk: UiaNode | null,
): {
  equal: boolean;
  guiNodes: number;
  walkNodes: number;
  firstDiff: number | null;
  diffs: string[];
} {
  const a = flattenTree(gui);
  const b = flattenTree(walk);
  const diffs: string[] = [];
  let firstDiff: number | null = null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      if (firstDiff === null) firstDiff = i;
      if (diffs.length < 20)
        diffs.push(`#${i}: gui ${a[i] ?? "(none)"} | walk ${b[i] ?? "(none)"}`);
    }
  }
  return { equal: firstDiff === null, guiNodes: a.length, walkNodes: b.length, firstDiff, diffs };
}

/**
 * Looser compare (P3-3 gate 2): controlType sequence strict; names compared only where both are
 * non-empty, trimmed and case-insensitive. A node-count mismatch is never equal.
 */
export function compareTreesLoose(
  gui: UiaNode | null,
  walk: UiaNode | null,
): {
  equal: boolean;
  guiNodes: number;
  walkNodes: number;
  controlTypesEqual: boolean;
  nameDiffs: number;
  nameDiffSample: string[];
} {
  const a = flattenTree(gui).map((x) => splitNode(x));
  const b = flattenTree(walk).map((x) => splitNode(x));
  let typesEqual = a.length === b.length;
  let nameDiffs = 0;
  const sample: string[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].type !== b[i].type) typesEqual = false;
    const x = a[i].name.trim();
    const y = b[i].name.trim();
    if (x && y && x.toLowerCase() !== y.toLowerCase()) {
      nameDiffs++;
      if (sample.length < 5)
        sample.push("#" + i + " " + a[i].type + ': gui "' + x + '" | walk "' + y + '"');
    }
  }
  return {
    equal: typesEqual,
    guiNodes: a.length,
    walkNodes: b.length,
    controlTypesEqual: typesEqual,
    nameDiffs,
    nameDiffSample: sample,
  };
}

function splitNode(s: string): { type: string; name: string } {
  const i = s.indexOf("|");
  return { type: s.slice(0, i), name: s.slice(i + 1) };
}

/**
 * The full dotted container path of the describe row whose name and value match (the handler
 * grammar needs it; a bare variable name is PATH_NOT_FOUND). Summary artifact first, then a page.
 */
async function describePath(
  ctx: StepContext,
  target: string,
  name: string,
  value: string,
): Promise<{
  chosen: string;
  rows: number;
  fromArtifact: boolean;
  ok: boolean;
  code: string | null;
  message: string | null;
}> {
  const sum = await ctx.tool("wb_container", { action: "describe", target });
  const art = S(field(sum.readback, "artifact"));
  const artDoc = art
    ? readJson<{ rows?: unknown[] }>(
        join(artifactsDir(), ...art.replace(/^<artifacts>\//, "").split("/")),
        ctx.deps,
      )
    : null;
  let rows: unknown[] = Array.isArray(artDoc?.rows) ? artDoc.rows : [];
  let last = sum;
  if (!rows.length) {
    const page = await ctx.tool("wb_container", {
      action: "describe",
      target,
      mode: "page",
      limit: 200,
    });
    last = page;
    rows = (field(page.readback, "rows") as unknown[] | undefined) ?? [];
  }
  const row = rows.find((x) => field(x, "name") === name && String(field(x, "value")) === value);
  return {
    chosen: row ? S(field(row, "path")) : "",
    rows: rows.length,
    fromArtifact: !!artDoc,
    ok: sum.ok || last.ok,
    code: last.code ?? sum.code ?? null,
    message: last.message ?? sum.message ?? null,
  };
}

/** The lines that differ between two texts, by position (an offline diff of the save). */
export function lineDiff(before: string, after: string): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i])
      out.push(`${i + 1}: ${JSON.stringify(a[i] ?? null)} -> ${JSON.stringify(b[i] ?? null)}`);
  }
  return out;
}

function readJson<T>(path: string, deps: Pick<Train2Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<Train2Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

interface PlantRecord {
  rel: string;
  sha256: string;
  varName: string;
  value: string;
  next: string;
  throwawayExistedBefore: boolean;
}

function plantRecord(ctx: StepContext): PlantRecord {
  const p = readJson<PlantRecord>(join(ctx.opts.sittingDir, PLANT_FILE), ctx.deps);
  if (!p)
    throw new StopBattery(
      "stopped",
      `${PLANT_FILE} is not in the sitting folder: run p33-o2-plant first`,
    );
  return p;
}

/** Relaunch bookkeeping: distinct pids per gate in `<sitting>/relaunches.json`. */
export function countLaunch(
  sittingDir: string,
  gate: 1 | 2,
  pid: number,
  deps: Pick<Train2Deps, "exists" | "readBytes" | "writeBytes">,
): { launches: number; relaunches: number; refused: string | null } {
  const path = join(sittingDir, RELAUNCH_FILE);
  const book = readJson<Record<string, number[]>>(path, deps);
  if (book === null && deps.exists(path))
    return {
      launches: 0,
      relaunches: 0,
      refused: `${RELAUNCH_FILE} exists but does not parse: STOP`,
    };
  const key = `gate${gate}`;
  const pids = Array.isArray(book?.[key]) ? book![key] : [];
  if (gate === 2 && Array.isArray(book?.gate1) && book!.gate1.includes(pid) && !pids.includes(pid))
    return {
      launches: pids.length,
      relaunches: Math.max(0, pids.length - 1),
      refused: `pid ${pid} was gate 1's launch: gate 2 runs on a new launch`,
    };
  if (!pids.includes(pid)) {
    if (pids.length >= MAX_RELAUNCHES + 1) {
      return {
        launches: pids.length,
        relaunches: pids.length - 1,
        refused:
          `gate ${gate} has spent its ${MAX_RELAUNCHES} relaunches (pids ${pids.join(", ")}): ` +
          "stop, split the train and restore the last-known-good set (`restore`)",
      };
    }
    pids.push(pid);
    writeJson(path, { ...(book ?? {}), [key]: pids }, deps);
  }
  return { launches: pids.length, relaunches: pids.length - 1, refused: null };
}

/**
 * Why a live step of a gate must not run (TRAIN2-05): the recorded pid is not the newest launch the
 * gate's book counted, or (gate 2) gate 1's verdict did not pass for this bundle.
 */
export function liveStepRefusal(
  opts: Pick<Train2Options, "sittingDir">,
  gate: 1 | 2,
  pid: number | null,
  deps: Pick<Train2Deps, "exists" | "readBytes" | "bundleDigest">,
): string | null {
  if (pid === null) return "no recorded Workbench pid";
  const book = readJson<Record<string, number[]>>(join(opts.sittingDir, RELAUNCH_FILE), deps);
  const pids = book?.[`gate${gate}`];
  if (!Array.isArray(pids) || pids[pids.length - 1] !== pid)
    return `pid ${pid} is not gate ${gate}'s counted launch in ${RELAUNCH_FILE}: start the block at p33-g${gate}-00-gate`;
  return gate === 2 ? gate1Refusal(opts.sittingDir, deps) : null;
}

/** Gate 1's verdict must have passed, for the bundle installed now. */
function gate1Refusal(
  sittingDir: string,
  deps: Pick<Train2Deps, "exists" | "readBytes" | "bundleDigest">,
): string | null {
  const v = readJson<{ passed?: boolean; digest?: string | null }>(
    join(sittingDir, gateVerdictFile(1)),
    deps,
  );
  if (v?.passed !== true)
    return `gate 2 runs only after gate 1 passed (${gateVerdictFile(1)} ${v ? "says not passed" : "is absent"})`;
  const digest = deps.bundleDigest();
  if (!v.digest || v.digest !== digest)
    return `${gateVerdictFile(1)} passed for bundle ${v.digest ?? "(none)"}, not the bundle now (${digest ?? "none"})`;
  return null;
}

/** sha256 of every file in the sandbox (project-relative, forward slashes). */
function sandboxHashes(ctx: StepContext): Record<string, string> {
  return Object.fromEntries(
    ctx.deps
      .listTree(ctx.opts.sandboxDir)
      .map((f) => [f, sha256(ctx.deps.readBytes(abs(ctx.opts.sandboxDir, f)))]),
  );
}

/** Files added, removed or changed between two hash maps. */
export function changedFiles(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

// ── Shared step bodies ───────────────────────────────────────────────────────

async function gateStep(ctx: StepContext, gate: 1 | 2): Promise<StepOutcome> {
  if (gate === 2) {
    const why = gate1Refusal(ctx.opts.sittingDir, ctx.deps);
    if (why) throw new StopBattery("stopped", why);
  }
  const pid = ctx.deps.recordedPid();
  if (pid === null)
    throw new StopBattery(
      "stopped",
      "this lane's lease records no Workbench pid: run preflight.ts first",
    );
  const image = ctx.deps.processImage(pid);
  if (image === null || image.toLowerCase() !== WORKBENCH_EXE.toLowerCase())
    throw new StopBattery(
      "stopped",
      `recorded pid ${pid} is ${image ?? "not running"}, not ${WORKBENCH_EXE}`,
    );
  const count = countLaunch(ctx.opts.sittingDir, gate, pid, ctx.deps);
  if (count.refused) throw new StopBattery("stopped", count.refused, { pid, ...count });
  const all = await ctx.deps.windows();
  const windows = all.filter((w) => w.pid === pid);
  const refusal = baselineRefusal(all, pid);
  if (refusal) throw new StopBattery("handoff", refusal, { pid, ...count });
  return {
    status: "pass",
    evidence: {
      pid,
      gate,
      launch: count.launches,
      relaunch: count.relaunches,
      relaunchBudget: `${count.relaunches} of ${MAX_RELAUNCHES}`,
      windows: windows.map((w) => ({ className: w.className, title: w.title, owner: w.owner })),
    },
  };
}

async function compiledStep(ctx: StepContext): Promise<StepOutcome> {
  const r = await ctx.net("IsWorkbenchRunning", {}, TIMEOUTS.cheap);
  const compiled = field(r.response, "ScriptsCompiled");
  const log = ctx.deps.sessionLog();
  const errors = log ? compileErrors(log) : [];
  const evidence = {
    scriptsCompiled: compiled ?? null,
    compileErrors: errors,
    logRead: log !== null,
  };
  if (!r.ok || compiled !== true || errors.length)
    throw new StopBattery(
      "handoff",
      `the first compile did not pass (ScriptsCompiled ${JSON.stringify(compiled ?? r.error ?? null)}, ${errors.length} compile error line(s)): fix offline, close, relaunch (counted)`,
      evidence,
    );
  return { status: "pass", evidence };
}

async function stampStep(ctx: StepContext): Promise<StepOutcome> {
  const r = await ctx.net(PING, {}, TIMEOUTS.cheap);
  const stamp = S(field(r.response, "buildStamp"));
  const digest = ctx.deps.bundleDigest();
  const evidence = { stamp: stamp || null, digest, mode: field(r.response, "mode") ?? null };
  if (!r.ok)
    throw new StopBattery(
      "handoff",
      `Ping did not answer (${r.error}): the handlers are not reached`,
      evidence,
    );
  return { status: stamp && digest && stamp === digest ? "pass" : "fail", evidence };
}

/** Open the World Editor module through the read-only pack (DEC-045, accfe18) when it is not running. */
async function openWorldEditorModule(ctx: StepContext): Promise<Record<string, unknown>> {
  const we = await ctx.net("IsWorldEditorRunning", {}, TIMEOUTS.cheap);
  if (field(we.response, "IsRunning") === true) return { wasRunning: true };
  const m = await ctx.net(
    PROBE_API,
    { action: "moduleMatrix", openModules: true, moduleName: "WorldEditor", page: 0 },
    TIMEOUTS.open,
  );
  return { wasRunning: false, moduleOpen: probeStatus(m.response) ?? m.error ?? null };
}

/** Poll IsWorldEditorRunning and layerRead until the tiny world is the open world (S-E 3f02179). */
async function waitTinyWorld(
  ctx: StepContext,
): Promise<{ ready: boolean; polls: number; facts: Record<string, string> }> {
  const started = ctx.deps.now();
  let polls = 0;
  for (;;) {
    polls++;
    const we = await ctx.net("IsWorldEditorRunning", {}, TIMEOUTS.cheap);
    const l = await ctx.net(
      PROBE_API,
      { action: "layerRead", subScene: -1, page: 0 },
      TIMEOUTS.read,
    );
    const facts = probeFacts(l.response);
    const ready =
      field(we.response, "IsRunning") === true &&
      probeStatus(l.response) === "ok" &&
      isThrowawayWorld(facts, TINY_WORLD);
    const spent =
      ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open ||
      polls * TIMEOUTS.poll >= TIMEOUTS.open;
    if (ready || spent) return { ready, polls, facts };
    await ctx.sleep(TIMEOUTS.poll);
  }
}

function moduleCall(ctx: StepContext, args: ModuleArgs): Promise<ToolResponse> {
  return ctx.tool("wb_module", args as unknown as Record<string, unknown>);
}

function pickScalarRow(readback: unknown): string | null {
  const rows = field(readback, "rows");
  if (!Array.isArray(rows)) return null;
  for (const r of rows) {
    const t = S(field(r, "type")).toLowerCase();
    const p = S(field(r, "path"));
    if (p && /^(int|float|bool|string|resourcename)$/.test(t)) return p;
  }
  return null;
}

// ── Steps ────────────────────────────────────────────────────────────────────

const WINDOW_KILL =
  "a new window the step does not expect: STOP and record; a dialog or a disabled window: HANDOFF (owner hand, nothing sent to it)";

export function buildSteps(): StepDef[] {
  const conf = `path:${PLANT_CONF}`;
  return [
    // ── Offline before gate 1 ──
    {
      id: "p33-o1-install",
      phase: "offline-0",
      title: `install the shipped bundle (${SHIPPED_FILES} files) and both probe packs; record the last-known-good set (${LKG_TAG})`,
      proves: "plan 5.4 items 4 and 5 (install the batch; keep the last-known-good set)",
      risk: "mutating",
      timeout_ms: 60_000,
      expected: `${SHIPPED_FILES} shipped files equal to the bundle, the stamp in ${BUILD_STAMP_FILE} equals the bundle digest, both packs installed; lkg.json names ${LKG_TAG}'s files`,
      kill_criterion:
        "a Workbench image runs, the stamp differs from the digest, or a file count differs: STOP",
      side_effects: [
        `<sandbox>/Scripts/WorkbenchGame/${HANDLER_FOLDER}/ and EnfusionCensus/ written`,
      ],
      rollback:
        "the `restore` subcommand reinstalls the last-known-good set; postflight removes the packs",
      plan: () => [],
      run: async (ctx) => {
        const running = ctx.deps.workbenchPids();
        if (running.length)
          throw new StopBattery(
            "stopped",
            `a Workbench image runs (pid ${running.join(", ")}): the install is offline`,
          );
        const lkg = ctx.deps.lkgFiles();
        const rep = ctx.deps.install(ctx.opts.sandboxDir);
        const extra = rep.shipped.filter((f) => !f.startsWith("EMCP_WB_"));
        writeJson(
          join(ctx.opts.sittingDir, "lkg.json"),
          {
            tag: LKG_TAG,
            files: lkg,
            phase3Only: rep.shipped.filter((f) => !lkg.some((l) => l.name === f)),
            restore:
              "train2.live.ts restore --sandbox <sandbox> --id <lane> --really (no Workbench running)",
          },
          ctx.deps,
        );
        const evidence = { ...rep, lkgFiles: lkg.length, extra };
        const ok =
          rep.shipped.length === SHIPPED_FILES &&
          extra.length === 0 &&
          !!rep.digest &&
          rep.digest === rep.stamp;
        if (!ok)
          throw new StopBattery(
            "stopped",
            "the install does not match the bundle (count, stamp or digest)",
            evidence,
          );
        return { status: "pass", evidence };
      },
    },
    {
      id: "p33-o2-plant",
      phase: "offline-0",
      title: `plant a copy of vanilla ${VANILLA_CONF} at <sandbox>/${PLANT_CONF} (S-E's plant pattern; U16's known-good target)`,
      proves:
        "DEC-044 U16 (the folder exists before the engine writes; SaveContainer into an existing folder)",
      risk: "mutating",
      timeout_ms: 30_000,
      expected: `the copy written byte for byte; ${PLANT_FILE} records its hash and the first top-level scalar (S-E firstScalar)`,
      kill_criterion: `a Workbench image runs, or <sandbox>/${P33_ROOT}/ exists already: STOP`,
      side_effects: [`<sandbox>/${PLANT_CONF}`],
      rollback: `the \`rollback\` subcommand lists and removes <sandbox>/${P33_ROOT}/`,
      plan: () => [],
      run: async (ctx) => {
        if (ctx.deps.workbenchPids().length)
          throw new StopBattery("stopped", "a Workbench image runs: the plant is offline");
        if (ctx.deps.exists(abs(ctx.opts.sandboxDir, P33_ROOT)))
          throw new StopBattery(
            "stopped",
            `<sandbox>/${P33_ROOT}/ exists already (not this sitting's)`,
          );
        const data = ctx.deps.readVanilla(VANILLA_CONF);
        const scalar = firstScalar(data.toString("utf-8"));
        if (!scalar) throw new StopBattery("stopped", `${VANILLA_CONF} holds no scalar line`);
        const throwawayExistedBefore = ctx.deps.exists(abs(ctx.opts.sandboxDir, THROWAWAY));
        ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, PLANT_CONF), data);
        const rec: PlantRecord = {
          rel: PLANT_CONF,
          sha256: sha256(data),
          varName: scalar.varName,
          value: scalar.value,
          next: scalar.next,
          throwawayExistedBefore,
        };
        writeJson(join(ctx.opts.sittingDir, PLANT_FILE), rec, ctx.deps);
        return { status: "pass", evidence: { ...rec, bytes: data.length } };
      },
    },

    // ── Gate 1 ──
    {
      id: "p33-g1-00-gate",
      phase: 1,
      title:
        "the gate: the lane's pid is the Workbench, the launch counted (three relaunches per gate)",
      proves: "plan 5.3 and 5.4 item 5",
      risk: "read-only",
      timeout_ms: 30_000,
      expected: "the recorded pid runs the Workbench image; relaunch n of 3",
      kill_criterion: "no pid, another image, or a fourth relaunch: STOP",
      side_effects: [],
      rollback: "none",
      plan: () => [],
      run: (ctx) => gateStep(ctx, 1),
    },
    {
      id: "p33-g1-01-compile",
      phase: 1,
      title: "IsWorkbenchRunning ScriptsCompiled and the session log's compile lines",
      proves: "first compile (plan 5.4 item 4)",
      risk: "read-only",
      timeout_ms: 30_000,
      expected: "ScriptsCompiled true; no EMCP_WB_ or ECEN_ error line",
      kill_criterion: "false, absent or an error line: HANDOFF (fix offline, relaunch, counted)",
      side_effects: [],
      rollback: "none",
      plan: () => [net("IsWorkbenchRunning")],
      run: compiledStep,
    },
    {
      id: "p33-g1-02-build-stamp",
      phase: 1,
      title: "EMCP_WB_Ping buildStamp equals the bundle digest",
      proves: "first compile (DEC-050 GUARD: the stamp)",
      risk: "read-only",
      timeout_ms: 20_000,
      expected: "buildStamp == client.ts bundleDigest()",
      kill_criterion: `no answer: HANDOFF; a mismatch: FAIL (a stale install); ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "none",
      plan: () => [net(PING, { action: "ping" })],
      run: stampStep,
    },
    {
      id: "p33-g1-03-info",
      phase: 1,
      title: "EMCP_WB_Info info: projectFound, the 10 modules, the 24 handlers",
      proves: "first compile (DEC-050 INFO)",
      risk: "read-only",
      timeout_ms: 20_000,
      expected: `status ok, projectFound true, projectName ${SANDBOX_NAME}, handlerCount ${HANDLER_COUNT}, open+closed+unread name the 10 modules`,
      kill_criterion: `no answer: HANDOFF; ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "none",
      plan: () => [net(INFO, { action: "info" })],
      run: async (ctx) => {
        const r = await ctx.net(INFO, { action: "info" }, TIMEOUTS.cheap);
        if (!r.ok) throw new StopBattery("handoff", `EMCP_WB_Info did not answer (${r.error})`);
        const list = (k: string): string[] =>
          S(field(r.response, k))
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        const named = new Set([
          ...list("openModules"),
          ...list("closedModules"),
          ...list("modules"),
          ...list("unreadModules"),
        ]);
        const missing = MODULE_IDS.filter((m) => !named.has(m));
        const count = Number(field(r.response, "handlerCount"));
        const evidence = {
          status: field(r.response, "status") ?? null,
          projectFound: field(r.response, "projectFound") ?? null,
          projectName: field(r.response, "projectName") ?? null,
          handlerCount: count,
          handlers: list("handlers"),
          modulesMissing: missing,
          worldPathForm: field(r.response, "worldPathForm") ?? null,
          filePromptHazard: field(r.response, "filePromptHazard") ?? null,
        };
        const ok =
          field(r.response, "status") === "ok" &&
          // Enforce JSON booleans serialise as 1/0 (P3-3 gate 1 launch 1, 2026-10-10).
          // DEC-058: Info answers projectFound; the test bed is still the EMCP2_sandbox project.
          [true, "true", 1, "1"].includes(field(r.response, "projectFound") as never) &&
          field(r.response, "projectName") === SANDBOX_NAME &&
          count === HANDLER_COUNT &&
          list("handlers").length === HANDLER_COUNT &&
          missing.length === 0;
        return { status: ok ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g1-05-container-path",
      phase: 1,
      title: `wb_container describe (summary, then one page) and get on ${conf}`,
      proves: "first compile (DEC-050 CONTAINER); the by-path route DEC-042/044 U16 read",
      risk: "read-only",
      timeout_ms: 3 * 30_000,
      expected: `describe ok (summary and page); get <varName from ${PLANT_FILE}> answers the planted value`,
      kill_criterion: WINDOW_KILL,
      side_effects: [],
      rollback: "none",
      plan: () => [
        toolNet("EMCP_WB_Container", { action: "describe", target: conf }),
        toolNet("EMCP_WB_Container", {
          action: "describe",
          target: conf,
          mode: "page",
          limit: 200,
        }),
        toolNet("EMCP_WB_Container", {
          action: "get",
          target: conf,
          path: "<varName from plant-p33.json>",
        }),
      ],
      run: async (ctx) => {
        const p = plantRecord(ctx);
        const sum = await ctx.tool("wb_container", { action: "describe", target: conf });
        const page = await ctx.tool("wb_container", {
          action: "describe",
          target: conf,
          mode: "page",
          limit: 200,
        });
        // The get path is the full dotted container path, taken from a describe row.
        const art = S(field(sum.readback, "artifact"));
        const artDoc = art
          ? readJson<{ rows?: unknown[] }>(
              join(artifactsDir(), ...art.replace(/^<artifacts>\//, "").split("/")),
              ctx.deps,
            )
          : null;
        const rows: unknown[] = Array.isArray(artDoc?.rows)
          ? artDoc.rows
          : ((field(page.readback, "rows") as unknown[] | undefined) ?? []);
        const row = rows.find(
          (x) => field(x, "name") === p.varName && String(field(x, "value")) === p.value,
        );
        const chosen = row ? S(field(row, "path")) : "";
        if (!chosen) {
          return {
            status: "fail",
            evidence: { noRowFor: p.varName, rowsSeen: rows.length, fromArtifact: !!artDoc },
          };
        }
        const get = await ctx.tool("wb_container", {
          action: "get",
          target: conf,
          path: chosen,
        });
        const value = field(get.readback, "value");
        const evidence = {
          chosenPath: chosen,
          fromArtifact: !!artDoc,
          summary: sum.ok ? sum.readback : { code: sum.code, message: sum.message },
          pageRows: Array.isArray(field(page.readback, "rows"))
            ? (field(page.readback, "rows") as unknown[]).length
            : null,
          get: { ok: get.ok, value: value ?? null, code: get.code ?? null, want: p.value },
        };
        const ok = sum.ok && page.ok && get.ok && String(value) === p.value;
        return { status: ok ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g1-04-module-reads",
      phase: 1,
      title:
        "wb_module list, then info on LocalizationEditor only (opens the String Editor; ParticleEditor never sent)",
      proves:
        "first compile (DEC-050 MODULE); info opens the module window (Workbench.GetModule); ParticleEditor never sent (DEC-042)",
      risk: "reversible",
      timeout_ms: 2 * 30_000,
      expected: "list ok (no window); info LocalizationEditor ok, the String Editor window opens",
      kill_criterion: WINDOW_KILL,
      side_effects: ["the String Editor window opens"],
      rollback: "the owner's close at the end of the launch",
      expectsWindows: [/^String Editor$/],
      plan: () => [
        toolNet("EMCP_WB_Module", { action: "list" }),
        toolNet("EMCP_WB_Module", { action: "info", moduleName: "LocalizationEditor" }),
      ],
      run: async (ctx) => {
        const list = await moduleCall(ctx, { action: "list" });
        const r = await moduleCall(ctx, { action: "info", module: "LocalizationEditor" });
        return {
          status: list.ok && r.ok ? "pass" : "fail",
          evidence: {
            list: list.readback ?? list.code,
            info: {
              module: "LocalizationEditor",
              ok: r.ok,
              code: r.code ?? null,
              readback: r.readback ?? null,
            },
          },
        };
      },
    },
    {
      id: "p33-g1-06-script-editor",
      phase: 1,
      title: "wb_module open, front and info on ScriptEditor",
      proves: "DEC-046 (the Script Editor reachable); open/front/info: first compile",
      risk: "reversible",
      timeout_ms: 3 * 60_000,
      expected: "open ok, front ok (the native), info ok with the module open",
      kill_criterion: `${WINDOW_KILL} (Script Editor and its Debugging window are expected)`,
      side_effects: ["the Script Editor window opens"],
      rollback: "the owner's close at the end of the launch",
      expectsWindows: SCRIPT_EDITOR_WINDOWS,
      plan: () => [
        toolNet("EMCP_WB_Module", { action: "open", moduleName: "ScriptEditor" }),
        net(
          "BringModuleWindowToFront",
          { ModuleName: "ScriptEditor" },
          "wb_module front: the native",
        ),
        toolNet("EMCP_WB_Module", { action: "info", moduleName: "ScriptEditor" }),
      ],
      run: async (ctx) => {
        const open = await moduleCall(ctx, { action: "open", module: "ScriptEditor" });
        const front = await moduleCall(ctx, { action: "front", module: "ScriptEditor" });
        const info = await moduleCall(ctx, { action: "info", module: "ScriptEditor" });
        const evidence = {
          open: { ok: open.ok, code: open.code ?? null, readback: open.readback ?? null },
          front: { ok: front.ok, code: front.code ?? null },
          info: { ok: info.ok, readback: info.readback ?? null },
        };
        return { status: open.ok && front.ok && info.ok ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g1-07-verdict",
      phase: 1,
      title: `gate 1's verdict into <sitting>/${gateVerdictFile(1)}`,
      proves: "plan 5.4 (gate 2 only after gate 1)",
      risk: "mutating",
      timeout_ms: 5_000,
      expected: "every gate-1 step pass, observed or skipped",
      kill_criterion: "none (writes the verdict)",
      side_effects: [`<sitting>/${gateVerdictFile(1)}`],
      rollback: "none",
      plan: () => [],
      run: async (ctx) => verdict(ctx, 1),
    },

    // ── Gate 2 (a new launch) ──
    {
      id: "p33-g2-00-gate",
      phase: 2,
      title: "the gate (gate 1 passed; the lane's pid; the launch counted)",
      proves: "plan 5.3 and 5.4 item 5",
      risk: "read-only",
      timeout_ms: 30_000,
      expected: `${gateVerdictFile(1)} passed; the recorded pid runs the Workbench image; relaunch n of 3`,
      kill_criterion: "gate 1 not passed, no pid, another image, or a fourth relaunch: STOP",
      side_effects: [],
      rollback: "none",
      plan: () => [],
      run: (ctx) => gateStep(ctx, 2),
    },
    {
      id: "p33-g2-01-ready",
      phase: 2,
      title: "ScriptsCompiled, the compile lines and the Ping stamp again (this launch)",
      proves: "gate 1 (repeated per launch)",
      risk: "read-only",
      timeout_ms: 40_000,
      expected: "as p33-g1-01 and p33-g1-02",
      kill_criterion: "as p33-g1-01 and p33-g1-02",
      side_effects: [],
      rollback: "none",
      plan: () => [net("IsWorkbenchRunning"), net(PING, { action: "ping" })],
      run: async (ctx) => {
        const c = await compiledStep(ctx);
        const s = await stampStep(ctx);
        return { status: s.status, evidence: { ...c.evidence, ...s.evidence } };
      },
    },
    {
      id: "p33-g2-02-bi-reads",
      phase: 2,
      title: `wb_bi call ${BI_CALLS.join(", ")} (verified read handlers; warnings recorded)`,
      proves: "DEC-040 (S-C verified the 14 reads); wb_bi itself: first live use (DEC-051 BI)",
      risk: "read-only",
      timeout_ms: 3 * 140_000,
      expected:
        "each ok, its warnings and liveNote recorded (CheckGUID exists 1 is not proof, DEC-040)",
      kill_criterion: WINDOW_KILL,
      side_effects: [],
      rollback: "none",
      plan: () => [
        toolNet("CheckGUID", { matName: "<the tiny world's resource name>" }),
        toolNet("LocateProject", { path: "<sandbox, forward slashes>" }),
        toolNet("GetLoadedProjects", {}),
      ],
      run: async (ctx) => {
        const worlds = readJson<{ facts?: Record<string, string> }>(
          join(ctx.opts.sittingDir, WORLDS_FILE),
          ctx.deps,
        );
        const requests: Record<string, Record<string, unknown>> = {
          CheckGUID: { matName: worlds?.facts?.tinyResourceName ?? TINY_WORLD },
          LocateProject: { path: ctx.opts.sandboxDir.replace(/\\/g, "/") },
          GetLoadedProjects: {},
        };
        const out: Record<string, unknown> = {};
        let bad = 0;
        let recorded = 0;
        for (const h of BI_CALLS) {
          const r = await ctx.tool("wb_bi", { action: "call", handler: h, request: requests[h] });
          out[h] = {
            ok: r.ok,
            code: r.code ?? null,
            readback: r.readback ?? null,
            warnings: r.warnings ?? [],
          };
          if (recordOnly(r)) recorded++;
          else if (!r.ok) bad++;
        }
        return { status: bad ? "fail" : recorded ? "observed" : "pass", evidence: out };
      },
    },
    {
      id: "p33-g2-03-plugin-reads",
      phase: 2,
      title:
        "wb_plugin describe and getSettings for the three plugin_read_allow_list plugins (modules opened first)",
      proves:
        "DEC-042 U10 (GetPlugin and attribute reads; the front side effect); wb_plugin: first compile",
      risk: "reversible",
      timeout_ms: 2 * TIMEOUTS.open + 6 * 30_000,
      expected:
        "describe and getSettings ok for each; a module window may come to the front (recorded)",
      kill_criterion: `${WINDOW_KILL} (the module windows are expected)`,
      side_effects: ["the Script Editor and World Editor open; a module window comes to the front"],
      rollback: "the owner's close",
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        toolNet("EMCP_WB_Module", { action: "open", moduleName: "ScriptEditor" }),
        net("IsWorldEditorRunning"),
        net(PROBE_API, {
          action: "moduleMatrix",
          openModules: true,
          moduleName: "WorldEditor",
          page: 0,
        }),
        ...PLUGINS.flatMap(([m, c]) => [
          toolNet("EMCP_WB_Plugin", { action: "describe", moduleName: m, className: c }),
          toolNet("EMCP_WB_Plugin", { action: "getSettings", moduleName: m, className: c }),
        ]),
      ],
      run: async (ctx) => {
        const se = await moduleCall(ctx, { action: "open", module: "ScriptEditor" });
        const we = await openWorldEditorModule(ctx);
        const out: Record<string, unknown> = { scriptEditorOpen: se.ok, worldEditor: we };
        let bad = 0;
        let recorded = 0;
        for (const [m, c] of PLUGINS) {
          const d = await ctx.tool("wb_plugin", {
            action: "describe",
            moduleName: m,
            className: c,
          });
          const g = await ctx.tool("wb_plugin", {
            action: "getSettings",
            moduleName: m,
            className: c,
          });
          out[c] = {
            describe: {
              ok: d.ok,
              code: d.code ?? null,
              readback: d.readback ?? null,
              warnings: d.warnings ?? [],
            },
            getSettings: { ok: g.ok, code: g.code ?? null, readback: g.readback ?? null },
          };
          for (const r of [d, g])
            if (recordOnly(r)) recorded++;
            else if (!r.ok) bad++;
        }
        return { status: bad ? "fail" : recorded ? "observed" : "pass", evidence: out };
      },
    },
    {
      id: "p33-g2-04-gui-tree",
      phase: 2,
      title:
        "wb_gui tree (ENFUSION_GUI=1) on the World Editor window, compared node for node with a walk.ts snapshot of the same window",
      proves:
        "first live use (DEC-051: the PowerShell UIAutomation route is unproven; walk.ts is the proven reader, DEC-046)",
      risk: "reversible",
      timeout_ms: 2 * TIMEOUTS.walk,
      expected:
        "both read the same window (pid, class, title); controlType sequence equal node for node (names compared only where both are non-empty); the menu bar present (L5)",
      kill_criterion: WINDOW_KILL,
      side_effects: [],
      rollback: "none (reads; placed after the step that opened the window)",
      plan: () => [
        snapshotPlanAction(
          {
            pid: "lane-recorded" as unknown as number,
            className: "<World Editor class>",
            titlePattern: "^World Editor",
          },
          DEFAULT_SNAPSHOT_BOUNDS,
        ) as PlanAction,
        {
          kind: "uia-read",
          target: {
            pid: "lane-recorded",
            window: {
              className: "<World Editor class>",
              titlePattern: "^World Editor",
              allowOwned: false,
            },
          },
          readOnly: true,
          view: "control",
          bounds: { ...WALK_DEFAULT_BOUNDS },
          note: "tools/uia/walk.ts, the same window",
        } as unknown as PlanAction,
      ],
      run: async (ctx) => {
        const pid = ctx.deps.recordedPid();
        if (pid === null) throw new StopBattery("stopped", "no recorded pid");
        const we = (await ctx.deps.windows()).find(
          (w) => w.pid === pid && /^World Editor/.test(w.title),
        );
        if (!we)
          return { status: "fail", evidence: { reason: "no World Editor window of the pid" } };
        const titlePattern = `^${we.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
        const gui = await ctx.tool("wb_gui", {
          action: "tree",
          pid,
          className: we.className,
          windowTitle: titlePattern,
        });
        const walk = await ctx.deps.walk({ pid, className: we.className, titlePattern });
        const spilled = S(field(gui.readback, "file"));
        let guiTree = (field(gui.readback, "tree") as UiaNode | undefined) ?? null;
        if (!guiTree && spilled) {
          // A large tree is spilled to the artifacts folder (wb-gui.ts): read it from there.
          const doc = readJson<{ tree?: UiaNode }>(
            join(artifactsDir(), ...spilled.split("/")),
            ctx.deps,
          );
          guiTree = doc?.tree ?? null;
        }
        const cmp = compareTreesLoose(guiTree, walk.tree);
        const menuBar = flattenTree(guiTree).some((n) => n.startsWith("MenuBar|"));
        const evidence = {
          window: { className: we.className, title: we.title },
          gui: {
            ok: gui.ok,
            code: gui.code ?? null,
            file: spilled || null,
            read: guiTree !== null,
          },
          walk: { ok: walk.ok, detail: walk.detail, summary: walk.summary },
          compare: cmp,
          nameDiffs: cmp.nameDiffs,
          nameDiffsFirst5: cmp.nameDiffSample,
          menuBar,
        };
        if (!gui.ok && recordOnly(gui)) return { status: "observed", evidence };
        return { status: gui.ok && walk.ok && cmp.equal && menuBar ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g2-05-module-action",
      phase: 2,
      title: `wb_module action ${TOGGLE_MODULE} ${TOGGLE_PATH.join(" > ")} (keepFocus), then once more to toggle it back`,
      proves:
        "policy execute_action.allow_list (S-D U9 labels, unverified); the action route: first compile",
      risk: "reversible",
      timeout_ms: 2 * 30_000,
      expected:
        "both ok (or ENGINE_FALSE recorded: a wrong label is data); the dock back as it was",
      kill_criterion: WINDOW_KILL,
      side_effects: ["the Hierarchy dock toggles twice"],
      rollback: "the second toggle",
      plan: () => [
        {
          kind: "execute-action",
          target: { path: [...TOGGLE_PATH], module: TOGGLE_MODULE },
        } as PlanAction,
        toolNet("EMCP_WB_Module", {
          action: "action",
          moduleName: TOGGLE_MODULE,
          menuPath: [...TOGGLE_PATH],
          keepFocus: true,
        }),
        {
          kind: "execute-action",
          target: { path: [...TOGGLE_PATH], module: TOGGLE_MODULE },
        } as PlanAction,
        toolNet("EMCP_WB_Module", {
          action: "action",
          moduleName: TOGGLE_MODULE,
          menuPath: [...TOGGLE_PATH],
          keepFocus: true,
        }),
      ],
      run: async (ctx) => {
        const args: ModuleArgs = {
          action: "action",
          module: TOGGLE_MODULE,
          menuPath: [...TOGGLE_PATH],
          keepFocus: true,
        };
        // The dock state: Hierarchy elements of the World Editor window, read before and after.
        const dock = async (): Promise<number | null> => {
          const pid = ctx.deps.recordedPid();
          const we = (await ctx.deps.windows()).find(
            (w) => w.pid === pid && /^World Editor - /.test(w.title),
          );
          if (!we || pid === null) return null;
          const r = await ctx.tool("wb_gui", {
            action: "find",
            pid,
            className: we.className,
            windowTitle: `^${we.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            name: "Hierarchy",
          });
          const total = Number(field(r.readback, "total"));
          return r.ok && Number.isInteger(total) ? total : null;
        };
        const before = await dock();
        const a = await moduleCall(ctx, args);
        const mid = await dock();
        const b = await moduleCall(ctx, args);
        const after = await dock();
        const evidence = {
          first: { ok: a.ok, code: a.code ?? null, readback: a.readback ?? null },
          second: { ok: b.ok, code: b.code ?? null, readback: b.readback ?? null },
          dock: { before, afterFirst: mid, after },
        };
        if (before !== null && after !== null && before !== after)
          return { status: "fail", evidence: { ...evidence, dockChanged: true } };
        if ([a, b].some((r) => !r.ok && r.code === "ENGINE_FALSE"))
          return { status: "observed", evidence };
        if (before === null || after === null)
          return { status: a.ok && b.ok ? "observed" : "fail", evidence };
        return { status: a.ok && b.ok ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g2-06-save-not-sandbox",
      phase: 2,
      title:
        "wb_module save on the World Editor's untitled world: the dry run, then confirm true only when the dry run says the form is not project (NOT_IN_PROJECT)",
      proves:
        "design section 6 (the guard refuses a world outside the open project, DEC-058); first compile",
      risk: "mutating",
      timeout_ms: 2 * 30_000,
      expected:
        'dry run ok with worldPathForm "none"; confirm refused NOT_IN_PROJECT, nothing written',
      kill_criterion: `the dry run reports any form but "none": confirm NOT sent, recorded; a Save As dialog = the guard failed: HANDOFF; ${WINDOW_KILL}`,
      side_effects: ["none when the guard holds"],
      rollback: "none",
      plan: () => [
        toolNet("EMCP_WB_Module", { action: "save", moduleName: "WorldEditor" }),
        toolNet("EMCP_WB_Module", { action: "save", moduleName: "WorldEditor", confirm: true }),
      ],
      run: async (ctx) => {
        const dry = await moduleCall(ctx, { action: "save", module: "WorldEditor" });
        const form = S(field(dry.readback, "worldPathForm")) || S(field(dry, "worldPathForm"));
        const evidence: Record<string, unknown> = {
          dryRun: { ok: dry.ok, form: form || null, readback: dry.readback ?? null },
        };
        if (!dry.ok || form !== "none") {
          evidence.confirm = `not sent: the dry run reported form ${JSON.stringify(form || null)}, not "none" (an untitled world)`;
          return { status: dry.ok ? "observed" : "fail", evidence };
        }
        const c = await moduleCall(ctx, { action: "save", module: "WorldEditor", confirm: true });
        evidence.confirm = {
          ok: c.ok,
          code: c.code ?? null,
          changed: c.changed ?? null,
          message: c.message ?? null,
        };
        // DEC-058: the refusal code is NOT_IN_PROJECT (was NOT_SANDBOX).
        return { status: !c.ok && c.code === "NOT_IN_PROJECT" ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g2-07-worlds-create",
      phase: 2,
      title: `createSandboxWorlds (mutating pack) target $${SANDBOX_NAME}:${WORLDS_DIR}; skipped when the tiny world exists`,
      proves: "DEC-045 (se-03: created worlds registered, GUID-prefixed names)",
      risk: "mutating",
      timeout_ms: TIMEOUTS.save + 60_000,
      expected: `status ok, both Registered "true", both resource names {GUID}-prefixed; files new only under ${WORLDS_DIR}/`,
      kill_criterion: `refused, error, or a file new outside ${WORLDS_DIR}/: STOP; ${WINDOW_KILL}`,
      side_effects: [`world files and .meta under <sandbox>/${WORLDS_DIR}/`],
      rollback: `listed in ${WORLDS_FILE}; removed with ${P33_ROOT}/ by \`rollback\``,
      plan: () => [
        net(MUT_API, {
          action: "createSandboxWorlds",
          target: `$${SANDBOX_NAME}:${WORLDS_DIR}`,
          tinyName: TINY_NAME,
          terrainName: FLAT_NAME,
          terrainEntities: [],
        }),
      ],
      run: async (ctx) => {
        if (ctx.deps.exists(abs(ctx.opts.sandboxDir, TINY_WORLD)))
          return { status: "skipped", evidence: { reason: `${TINY_WORLD} exists already` } };
        const before = ctx.deps.listTree(ctx.opts.sandboxDir);
        const r = await ctx.net(
          MUT_API,
          {
            action: "createSandboxWorlds",
            target: `$${SANDBOX_NAME}:${WORLDS_DIR}`,
            tinyName: TINY_NAME,
            terrainName: FLAT_NAME,
            terrainEntities: [],
          },
          TIMEOUTS.save,
        );
        const after = ctx.deps.listTree(ctx.opts.sandboxDir);
        const created = after.filter((f) => !before.includes(f));
        const stray = created.filter(
          (f) => !f.toLowerCase().startsWith(`${WORLDS_DIR}/`.toLowerCase()),
        );
        const f = probeFacts(r.response);
        const problem = registrationProblem(f);
        writeJson(join(ctx.opts.sittingDir, WORLDS_FILE), { created, facts: f, problem }, ctx.deps);
        const evidence = {
          status: probeStatus(r.response) ?? r.error ?? null,
          created,
          stray,
          problem,
        };
        if (stray.length)
          throw new StopBattery(
            "stopped",
            `files new outside ${WORLDS_DIR}/: ${stray.join(", ")}`,
            evidence,
          );
        if (!r.ok || probeStatus(r.response) !== "ok")
          throw new StopBattery(
            "stopped",
            `createSandboxWorlds answered ${probeStatus(r.response) ?? r.error}`,
            evidence,
          );
        return { status: problem ? "fail" : "pass", evidence };
      },
    },
    {
      id: "p33-g2-08-world-open",
      phase: 2,
      title: `open the World Editor module (ECEN_Probe moduleMatrix) and ${TINY_WORLD} through EMCP_WB_EditorControl openResource`,
      proves:
        "DEC-045 (the shipped SetOpenedResource route with the project-relative path; accfe18, 3f02179)",
      risk: "mutating",
      timeout_ms: 2 * TIMEOUTS.open,
      expected: `"Opened resource: ${TINY_WORLD}"; layerRead names the tiny world with one sub-scene`,
      kill_criterion: `not ready within the budget: FAIL; ${WINDOW_KILL} (the World Editor fans out its module windows)`,
      side_effects: [
        "the World Editor and its module windows open, the tiny world loads (not edited)",
      ],
      rollback: "the owner's close; the world is unedited",
      expectsWindows: WORLD_EDITOR_WINDOWS,
      plan: () => [
        net("IsWorldEditorRunning"),
        net(PROBE_API, {
          action: "moduleMatrix",
          openModules: true,
          moduleName: "WorldEditor",
          page: 0,
        }),
        net(EDITOR_CONTROL, { action: "openResource", path: TINY_WORLD }),
        net(PROBE_API, { action: "layerRead", subScene: -1, page: 0 }),
      ],
      run: async (ctx) => {
        const module = await openWorldEditorModule(ctx);
        const o = await ctx.net(
          EDITOR_CONTROL,
          { action: "openResource", path: TINY_WORLD },
          TIMEOUTS.open,
        );
        const message = S(field(o.response, "message"));
        const w = await waitTinyWorld(ctx);
        const evidence = {
          module,
          openMessage: message || o.error || null,
          ready: w.ready,
          polls: w.polls,
          worldPath: w.facts.worldPath ?? null,
        };
        return { status: /^Opened resource/.test(message) && w.ready ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g2-09-container-world",
      phase: 2,
      title: "wb_container describe (summary, one page) and get on open:WorldEditor",
      proves: "first compile (DEC-050 CONTAINER, the World Editor target)",
      risk: "mutating",
      timeout_ms: 3 * 30_000,
      expected: "describe ok; get on the first scalar row of the page answers a value",
      kill_criterion: `the World Editor not on the tiny world: STOP; ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "none (reads; placed with the writes because it reads the world the open loaded)",
      plan: () => [
        toolNet("EMCP_WB_Container", { action: "describe", target: "open:WorldEditor" }),
        toolNet("EMCP_WB_Container", {
          action: "describe",
          target: "open:WorldEditor",
          mode: "page",
          limit: 50,
        }),
        toolNet("EMCP_WB_Container", {
          action: "get",
          target: "open:WorldEditor",
          path: "<first scalar row>",
        }),
      ],
      run: async (ctx) => {
        const open = ctx.prior("p33-g2-08-world-open");
        if (open?.status !== "pass")
          throw new StopBattery("stopped", "the tiny world is not open (p33-g1-08 did not pass)");
        const t = "open:WorldEditor";
        const sum = await ctx.tool("wb_container", { action: "describe", target: t });
        const page = await ctx.tool("wb_container", {
          action: "describe",
          target: t,
          mode: "page",
          limit: 50,
        });
        const path = pickScalarRow(page.readback);
        const get = path
          ? await ctx.tool("wb_container", { action: "get", target: t, path })
          : null;
        const evidence = {
          summary: sum.ok ? sum.readback : { code: sum.code, message: sum.message },
          pageOk: page.ok,
          getPath: path,
          get: get
            ? { ok: get.ok, readback: get.readback ?? null, code: get.code ?? null }
            : "no scalar row on the page: get not sent",
        };
        return {
          status:
            sum.ok && page.ok && (get === null || get.ok) ? (get ? "pass" : "observed") : "fail",
          evidence,
        };
      },
    },
    {
      id: "p33-g2-10-set-resource-save",
      phase: 2,
      title: `wb_module setResource WorldEditor path:${TINY_WORLD}, then save dry run, then save confirm`,
      proves: "DEC-045 (the SetOpenedResource route); setResource and save: first compile",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 2 * TIMEOUTS.save,
      expected:
        "setResource ok; layerRead names the tiny world; the dry run writes nothing and reports form sandbox; only then confirm, which changes files only under the worlds folder (the whole sandbox hashed)",
      kill_criterion: `not ready: FAIL, no save sent; a file changed outside ${WORLDS_DIR}/: STOP; ${WINDOW_KILL}`,
      side_effects: [`the tiny world re-saved under <sandbox>/${WORLDS_DIR}/`],
      rollback: `removed with ${P33_ROOT}/ by \`rollback\``,
      plan: () => [
        toolNet("EMCP_WB_Module", {
          action: "setResource",
          moduleName: "WorldEditor",
          path: TINY_WORLD,
        }),
        net(PROBE_API, { action: "layerRead", subScene: -1, page: 0 }),
        toolNet("EMCP_WB_Module", { action: "save", moduleName: "WorldEditor" }),
        toolNet("EMCP_WB_Module", { action: "save", moduleName: "WorldEditor", confirm: true }),
      ],
      run: async (ctx) => {
        const set = await moduleCall(ctx, {
          action: "setResource",
          module: "WorldEditor",
          target: `path:${TINY_WORLD}`,
        });
        const w = await waitTinyWorld(ctx);
        const evidence: Record<string, unknown> = {
          setResource: { ok: set.ok, code: set.code ?? null, readback: set.readback ?? null },
          ready: w.ready,
          polls: w.polls,
        };
        if (!set.ok || !w.ready) return { status: "fail", evidence };
        const h0 = sandboxHashes(ctx);
        const dry = await moduleCall(ctx, { action: "save", module: "WorldEditor" });
        const h1 = sandboxHashes(ctx);
        const dryChanged = changedFiles(h0, h1);
        const form = S(field(dry.readback, "worldPathForm"));
        evidence.dry = {
          ok: dry.ok,
          form,
          readback: dry.readback ?? null,
          changedFiles: dryChanged,
        };
        if (dryChanged.length)
          throw new StopBattery(
            "stopped",
            `the dry run changed files: ${dryChanged.join(", ")}`,
            evidence,
          );
        // DEC-058: a world of the open project answers form "project" (was "sandbox").
        if (!dry.ok || form !== "project") {
          evidence.save = `not sent: the dry run answered ${dry.ok ? `form ${JSON.stringify(form)}` : dry.code}`;
          return { status: "fail", evidence };
        }
        const conf = await moduleCall(ctx, {
          action: "save",
          module: "WorldEditor",
          confirm: true,
        });
        const h2 = sandboxHashes(ctx);
        const saveChanged = changedFiles(h1, h2);
        const stray = saveChanged.filter((f) => !f.startsWith(`${WORLDS_DIR}/`));
        evidence.save = {
          ok: conf.ok,
          code: conf.code ?? null,
          readback: conf.readback ?? null,
          changedFiles: saveChanged,
        };
        if (stray.length)
          throw new StopBattery(
            "stopped",
            `the save changed files outside ${WORLDS_DIR}/: ${stray.join(", ")}`,
            evidence,
          );
        return { status: conf.ok ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g2-11-container-write",
      phase: 2,
      title: `wb_container set and save on ${conf}: dry runs first, then confirm; get read back; offline diff against the plant`,
      proves:
        "DEC-044 U16 write (SaveContainer, the project-relative form); set and save: first compile",
      risk: "mutating",
      timeout_ms: 3 * TIMEOUTS.save,
      expected:
        "set ok, save ok, get answers the new value; on disk the CST reads the new value; the line diff recorded (the engine canonicalises, DEC-044)",
      kill_criterion: `a write outside ${PLANT_CONF}: STOP; ${WINDOW_KILL}`,
      side_effects: [`<sandbox>/${PLANT_CONF} rewritten`],
      rollback: `removed with ${P33_ROOT}/ by \`rollback\``,
      plan: () => [
        toolNet("EMCP_WB_Container", {
          action: "set",
          target: conf,
          path: "<dotted path from describe>",
          value: "<next>",
        }),
        toolNet("EMCP_WB_Container", { action: "save", target: conf }),
        toolNet("EMCP_WB_Container", {
          action: "set",
          target: conf,
          path: "<varName>",
          value: "<next>",
          confirm: true,
        }),
        toolNet("EMCP_WB_Container", { action: "save", target: conf, confirm: true }),
        toolNet("EMCP_WB_Container", { action: "get", target: conf, path: "<varName>" }),
      ],
      run: async (ctx) => {
        const p = plantRecord(ctx);
        const file = abs(ctx.opts.sandboxDir, PLANT_CONF);
        const before = ctx.deps.readBytes(file);
        const h0 = sandboxHashes(ctx);
        const dp = await describePath(ctx, conf, p.varName, p.value);
        if (!dp.chosen)
          return {
            status: "fail",
            evidence: { noRowFor: p.varName, want: p.value, describe: dp },
          };
        const drySet = await ctx.tool("wb_container", {
          action: "set",
          target: conf,
          path: dp.chosen,
          value: p.next,
        });
        const drySave = await ctx.tool("wb_container", { action: "save", target: conf });
        const h1 = sandboxHashes(ctx);
        const dryChanged = changedFiles(h0, h1);
        const dryRuns = {
          set: {
            ok: drySet.ok,
            code: drySet.code ?? null,
            message: drySet.message ?? null,
            readback: drySet.readback ?? null,
          },
          save: {
            ok: drySave.ok,
            code: drySave.code ?? null,
            message: drySave.message ?? null,
            readback: drySave.readback ?? null,
          },
          changedFiles: dryChanged,
        };
        if (dryChanged.length)
          throw new StopBattery("stopped", `a dry run changed files: ${dryChanged.join(", ")}`, {
            dryRuns,
          });
        if (!drySet.ok || !drySave.ok)
          return { status: "fail", evidence: { dryRuns, confirm: "not sent: a dry run failed" } };
        const set = await ctx.tool("wb_container", {
          action: "set",
          target: conf,
          path: dp.chosen,
          value: p.next,
          confirm: true,
        });
        const save = await ctx.tool("wb_container", {
          action: "save",
          target: conf,
          confirm: true,
        });
        const get = await ctx.tool("wb_container", {
          action: "get",
          target: conf,
          path: dp.chosen,
        });
        const after = ctx.deps.readBytes(file);
        const stray = changedFiles(h1, sandboxHashes(ctx)).filter((f) => f !== PLANT_CONF);
        if (stray.length)
          throw new StopBattery(
            "stopped",
            `the write changed files beyond ${PLANT_CONF}: ${stray.join(", ")}`,
            {
              dryRuns,
              stray,
            },
          );
        const doc = parseCstBytes(after);
        let onDisk: string | null = null;
        try {
          const g = doc.get(dp.chosen);
          onDisk = g.kind === "scalar" ? (g.values[0] ?? null) : null;
        } catch {
          onDisk = null;
        }
        const diff = lineDiff(before.toString("utf-8"), after.toString("utf-8"));
        const evidence = {
          dryRuns,
          varName: p.varName,
          chosenPath: dp.chosen,
          from: p.value,
          to: p.next,
          set: {
            ok: set.ok,
            code: set.code ?? null,
            message: set.message ?? null,
            readback: set.readback ?? null,
          },
          save: {
            ok: save.ok,
            code: save.code ?? null,
            message: save.message ?? null,
            readback: save.readback ?? null,
          },
          get: {
            ok: get.ok,
            code: get.code ?? null,
            message: get.message ?? null,
            value: field(get.readback, "value") ?? null,
          },
          onDisk,
          diffLines: diff.length,
          diff: diff.slice(0, 40),
          sha256Before: sha256(before),
          sha256After: sha256(after),
        };
        const ok =
          set.ok &&
          save.ok &&
          get.ok &&
          String(field(get.readback, "value")) === p.next &&
          onDisk === p.next;
        return { status: ok ? "pass" : "fail", evidence };
      },
    },
    {
      id: "p33-g2-12-cst-accept",
      phase: 2,
      title: `the parser's engine-accept check: write ${CST_CONF} through src/formats/enfusion-cst.ts, then wb_container get on it`,
      proves: "first live use (DEC-049 D: the lossless CST; accepted = LoadContainer loads it)",
      risk: "mutating",
      timeout_ms: 2 * 30_000,
      expected: "the file written by the CST (one scalar changed); get ok with the CST's value",
      kill_criterion: `a stale ${CST_CONF} of this sitting is replaced (recorded); ${WINDOW_KILL}`,
      side_effects: [`<sandbox>/${CST_CONF}`],
      rollback: `removed with ${P33_ROOT}/ by \`rollback\``,
      plan: () => [
        toolNet("EMCP_WB_Container", {
          action: "get",
          target: `path:${CST_CONF}`,
          path: "<dotted path from describe>",
        }),
      ],
      run: async (ctx) => {
        const p = plantRecord(ctx);
        const target = abs(ctx.opts.sandboxDir, CST_CONF);
        // A file left by an earlier run of this sitting (gate 2 launch 1, 2026-10-10) is the
        // harness's own, inside _throwaway/P33/: it is replaced, and the replacement recorded.
        const replacedStale = ctx.deps.exists(target);
        const doc = parseCstBytes(ctx.deps.readVanilla(VANILLA_CONF));
        const value = String(Number(p.next) + 1);
        // The CST's path grammar is the handler's (DEC-048): resolve the planted scalar's dotted
        // path from a describe of the planted copy (a bare name is PATH_NOT_FOUND for both; P3-3
        // gate 2 launch 3, 2026-10-10).
        const plantPath = await describePath(ctx, `path:${PLANT_CONF}`, p.varName, p.next);
        if (!plantPath.chosen)
          return {
            status: "fail",
            evidence: { replacedStale, noPlantRowFor: p.varName, describe: plantPath },
          };
        doc.set(plantPath.chosen, Number(value));
        const bytes = doc.toBytes();
        ctx.deps.writeBytes(target, bytes);
        const cstTarget = `path:${CST_CONF}`;
        const dp = await describePath(ctx, cstTarget, p.varName, value);
        const written = { rel: CST_CONF, sha256: sha256(bytes), varName: p.varName, value };
        if (!dp.chosen) {
          // describe failed or has no row with the new value: the CST file was not accepted
          return {
            status: "fail",
            evidence: { written, replacedStale, accepted: false, describe: dp },
          };
        }
        const get = await ctx.tool("wb_container", {
          action: "get",
          target: cstTarget,
          path: dp.chosen,
        });
        const evidence = {
          replacedStale,
          written,
          accepted: true,
          chosenPath: dp.chosen,
          get: {
            ok: get.ok,
            code: get.code ?? null,
            message: get.message ?? null,
            value: field(get.readback, "value") ?? null,
          },
        };
        return {
          status: get.ok && String(field(get.readback, "value")) === value ? "pass" : "fail",
          evidence,
        };
      },
    },
    {
      id: "p33-g2-13-verdict",
      phase: 2,
      title: `gate 2's verdict into <sitting>/${gateVerdictFile(2)}`,
      proves: "plan 5.4",
      risk: "mutating",
      timeout_ms: 5_000,
      expected: "every gate-2 step pass, observed or skipped",
      kill_criterion: "none (writes the verdict)",
      side_effects: [`<sitting>/${gateVerdictFile(2)}`],
      rollback: "none",
      plan: () => [],
      run: async (ctx) => verdict(ctx, 2),
    },
  ];
}

/** policy.json plugin_read_allow_list (DEC-042 U10), as the plan names them. */
export const PLUGINS: ReadonlyArray<readonly [string, string]> = [
  ["WorldEditor", "SCR_SnapAndOrientToTerrainPlugin"],
  ["ScriptEditor", "SCR_CopyClassAndMethodPlugin"],
  ["ScriptEditor", "SCR_DebugLinePlugin"],
];

async function verdict(ctx: StepContext, gate: 1 | 2): Promise<StepOutcome> {
  const ids = buildSteps()
    .filter((s) => s.phase === gate && !s.id.endsWith("-verdict"))
    .map((s) => s.id);
  const statuses = Object.fromEntries(ids.map((id) => [id, ctx.prior(id)?.status ?? "not-run"]));
  const passed = Object.values(statuses).every(
    (s) => s === "pass" || s === "observed" || s === "skipped",
  );
  writeJson(
    join(ctx.opts.sittingDir, gateVerdictFile(gate)),
    {
      gate,
      passed,
      statuses,
      runDir: basename(ctx.opts.runDir),
      pid: ctx.deps.recordedPid(),
      digest: ctx.deps.bundleDigest(),
    },
    ctx.deps,
  );
  return { status: passed ? "pass" : "fail", evidence: { passed, statuses } };
}

// ── Plan, outline, queue ─────────────────────────────────────────────────────

/** The launch pre-flight performs before each gate: in the plan so the dry run checks it. */
export function launchAction(gate: 1 | 2): PlanAction {
  return {
    kind: "launch",
    target: { gproj: `<sandbox>/${SANDBOX_NAME}.gproj` } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: `gate ${gate}: performed by scripts/live/preflight.ts per the runbook, not by this script`,
  } as PlanAction;
}

export function buildActionPlan(steps: StepDef[] = buildSteps()): PlanAction[] {
  const out: PlanAction[] = [];
  let lastPhase: Phase | null = null;
  for (const s of steps) {
    if (s.phase !== lastPhase && (s.phase === 1 || s.phase === 2)) out.push(launchAction(s.phase));
    lastPhase = s.phase;
    for (const a of s.plan()) out.push({ ...a, step: s.id } as PlanAction);
  }
  return out;
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: train #2 (${SCRIPT_PATH}), ${steps.length} steps; gate 1 and gate 2 each on its own launch, ${MAX_RELAUNCHES} relaunches per gate`,
    ...steps.map((s) => `  [${s.phase}] ${s.id} (${s.risk}): ${s.title} (proves ${s.proves})`),
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/train2.live.ts --emit-queue` from its step table; tests/live-harness/train2-battery.test.ts keeps this file equal to the table. Validated by scripts/live/preflight.ts validateQueue, per launch.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: "docs/v2/sessions/queues/P3-3.md",
    plan_refs: ["PLAN 5.3", "PLAN 5.4", "PLAN 5.7", "DEC-045", "DEC-048", "DEC-050", "DEC-051"],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note: "pre-flight builds the real arguments; P3-3 never passes -scriptAuthorizeAll",
    relaunch_budget: `${MAX_RELAUNCHES} per gate, counted by distinct pid in <sitting>/${RELAUNCH_FILE}`,
    last_known_good: { tag: LKG_TAG, folder: HANDLER_REL, restore: "train2.live.ts restore" },
    counts: {
      steps: steps.length,
      by_phase: Object.fromEntries(
        (["offline-0", 1, 2] as Phase[]).map((p) => [
          String(p),
          steps.filter((s) => s.phase === p).length,
        ]),
      ),
    },
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.phase,
      title: s.title,
      proves: s.proves,
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
      ...(s.expectsWindows ? { expects_windows: s.expectsWindows.map((r) => r.source) } : {}),
    })),
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export function recordPath(runDir: string, id: string): string {
  return join(runDir, `${id}.json`);
}

export function selectSteps(
  steps: StepDef[],
  sel: { from?: string; only?: string; until?: string },
): StepDef[] | string {
  if (sel.only && (sel.from || sel.until)) return "--only excludes --from and --until";
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  if (sel.only) {
    const i = idx(sel.only);
    return i === -1 ? `${sel.only} is not a step id` : [steps[i]];
  }
  if (!sel.from)
    return "a real run names its steps: --from <step> [--until <step>] or --only <step>";
  const a = idx(sel.from);
  const b = sel.until ? idx(sel.until) : steps.length - 1;
  if (a === -1) return `${sel.from} is not a step id`;
  if (b === -1) return `${sel.until} is not a step id`;
  if (b < a) return "--until comes before --from";
  const out = steps.slice(a, b + 1);
  if (new Set(out.map((s) => s.phase)).size > 1)
    return "one invocation runs one phase (offline-0, gate 1 or gate 2): the gates are separate launches";
  return out;
}

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

export async function runBattery(
  steps: StepDef[],
  deps: Train2Deps,
  opts: Train2Options,
): Promise<BatteryReport> {
  const records: StepRecord[] = [];
  const write = (r: StepRecord): void => {
    const clean = JSON.parse(toPlaceholders(JSON.stringify(r), opts.ph)) as StepRecord;
    const path = recordPath(opts.runDir, r.step);
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    records.push(clean);
    if (opts.evidenceDir) {
      writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary: `${r.step}: ${r.status}${r.stop ? ` (${r.stop})` : ""}; proves ${r.proves}`,
          artifacts: [path],
        },
        opts.ph,
      );
    }
  };
  const prior = (id: string): StepRecord | null =>
    readJson<StepRecord>(recordPath(opts.runDir, id), deps);
  for (const s of steps) {
    if (deps.exists(recordPath(opts.runDir, s.id))) {
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already has a record in this run folder: a step is never run twice (plan 5.3); a relaunch takes a new run folder`,
      };
    }
    deps.log(`step ${s.id}: ${s.title}`);
    const calls: Array<Record<string, unknown>> = [];
    const abort = new AbortController();
    const guard = (what: string): void => {
      if (abort.signal.aborted) {
        calls.push({ notSent: what });
        throw new StepCut();
      }
    };
    const ctx: StepContext = {
      deps,
      opts,
      prior,
      calls,
      signal: abort.signal,
      sleep: async (ms) => {
        guard("sleep");
        await deps.sleep(ms);
        guard("sleep");
      },
      tool: async (name, args) => {
        guard(`${name} ${String(args.action ?? "")}`);
        const r = await deps.tool(name, args);
        calls.push({ tool: name, args, ok: r.ok, code: r.code ?? null });
        return r;
      },
      net: async (apiFunc, params, timeoutMs) => {
        guard(apiFunc);
        const r = await deps.net(apiFunc, params, timeoutMs);
        calls.push({
          net: apiFunc,
          params,
          ok: r.ok,
          error: r.error ?? null,
          durationMs: r.durationMs,
        });
        return r;
      },
    };
    const startedAt = new Date(deps.now()).toISOString();
    const base = { step: s.id, phase: s.phase, title: s.title, proves: s.proves, startedAt };
    try {
      let out: StepOutcome;
      if (s.phase === "offline-0" || s.id.endsWith("-00-gate")) {
        out = await s.run(ctx);
      } else {
        const pid = deps.recordedPid();
        const why = liveStepRefusal(opts, s.phase, pid, deps);
        if (why || pid === null)
          throw new StopBattery("stopped", why ?? "no recorded Workbench pid");
        const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx));
        out = w.value;
        if (w.added.length)
          out.evidence.windowsAdded = w.added.map((x) => ({
            className: x.className,
            title: x.title,
          }));
      }
      write({
        ...base,
        status: out.status,
        endedAt: new Date(deps.now()).toISOString(),
        evidence: { ...out.evidence, calls },
      });
    } catch (e) {
      const stop = e instanceof StopBattery ? e : null;
      const kind = stop?.kind ?? "stopped";
      const message = e instanceof Error ? e.message : String(e);
      write({
        ...base,
        status: kind,
        endedAt: new Date(deps.now()).toISOString(),
        evidence: { ...(stop?.evidence ?? {}), cut: abort.signal.aborted, calls },
        stop: message,
      });
      return {
        exit: kind === "aborted" ? EXIT.aborted : kind === "handoff" ? EXIT.handoff : EXIT.stopped,
        records,
        stoppedAt: s.id,
        message,
      };
    }
  }
  return { exit: EXIT.done, records, stoppedAt: null, message: null };
}

// ── Offline subcommands: restore and rollback ────────────────────────────────

export interface OfflineIo {
  workbenchPids: () => number[];
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
  listTree: (p: string) => string[];
  readBytes: (p: string) => Buffer;
  removeFile: (p: string) => void;
  removeTree: (p: string) => void;
  /** The tag's bytes of one handler file (`git show <tag>:<HANDLER_REL>/<name>`). */
  lkgBytes: (name: string) => Buffer;
  lkgNames: () => string[];
  writeBytes: (p: string, b: Buffer) => void;
  log: (l: string) => void;
}

/**
 * `restore` (plan 5.4 item 5): reinstall the last-known-good set. The installed folder then holds
 * exactly the tag's files: the Phase-3-only files are removed, the tag's 21 written. Dry run unless
 * `really`; refused while a Workbench runs.
 */
export function runRestore(sandboxDir: string, really: boolean, io: OfflineIo): number {
  const dir = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
  const keep = io.lkgNames();
  const present = io.exists(dir) ? io.listDir(dir).filter((f) => f.endsWith(".c")) : [];
  const remove = present.filter((f) => !keep.includes(f));
  io.log(
    `restore ${LKG_TAG}: write ${keep.length} files, remove ${remove.length} (${remove.join(", ") || "none"})`,
  );
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  for (const f of remove) io.removeFile(join(dir, f));
  for (const f of keep) io.writeBytes(join(dir, f), io.lkgBytes(f));
  io.log(`restored ${keep.length} files from ${LKG_TAG}`);
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove `<sandbox>/_throwaway/P33/`; `_throwaway/` only when empty and absent before. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, P33_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${P33_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${P33_ROOT}/ (${files.length} files)`);
  if (!really) {
    io.log("dry run: nothing removed");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  const listing = files.map((rel) => ({
    rel,
    sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))),
  }));
  io.writeBytes(
    join(sittingDir, "throwaway-p33-listing.json"),
    Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
  );
  io.removeTree(dir);
  let plant: { throwawayExistedBefore?: boolean } | null = null;
  try {
    plant = JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as {
      throwawayExistedBefore?: boolean;
    };
  } catch {
    plant = null;
  }
  const top = join(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0)
    io.removeTree(top);
  io.log(`removed <sandbox>/${P33_ROOT}/ (listing in throwaway-p33-listing.json)`);
  return EXIT.done;
}

// ── Real dependencies ────────────────────────────────────────────────────────

function listTreeOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      // A file can vanish between the listing and the stat (Workbench writes its settings
      // through a temp file beside the scratch ini): a vanished entry is not listed.
      let isDir: boolean;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

function git(args: string[]): Buffer {
  return execFileSync("git", ["-C", REPO_ROOT, ...args], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function workbenchPidsReal(): number[] {
  return processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid);
}

export function realDeps(input: {
  port: number;
  lane: Lane;
  runDir: string;
  /** The pak reader, opened by main only when a selected step reads vanilla bytes. */
  vanilla: ((vpath: string) => Buffer) | null;
}): Train2Deps {
  const config = loadConfig();
  const client = new WorkbenchClient("127.0.0.1", input.port);
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_module":
          return (await runModule(
            client,
            args as unknown as ModuleArgs,
          )) as unknown as ToolResponse;
        case "wb_container":
          return (await runContainer(client, args)) as unknown as ToolResponse;
        case "wb_plugin":
          return (await runPlugin(args, {
            client,
            catalog: () => loadCatalog(),
            allowList: () => loadAllowList(),
          })) as unknown as ToolResponse;
        case "wb_bi":
          return (await runBi(args, { client })) as unknown as ToolResponse;
        case "wb_gui":
          return (await runGui(args, {
            env: { ...process.env, ENFUSION_GUI: "1" },
          })) as unknown as ToolResponse;
      }
    },
    net: (apiFunc, params, timeoutMs) =>
      rawNetCall(apiFunc, params, { port: input.port, timeoutMs }),
    walk: (t) =>
      new Promise((done) => {
        const out = join(input.runDir, "p33-g2-04-walk.json");
        const args = [
          "--import",
          "tsx",
          join(REPO_ROOT, "tools", "uia", "walk.ts"),
          "--pid",
          String(t.pid),
          "--class",
          t.className,
          "--title-pattern",
          t.titlePattern,
          "--label",
          "p33-g2-04",
          "--out",
          out,
          "--id",
          input.lane.id,
          "--really",
        ];
        const child = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true });
        let stdout = "";
        child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
        const timer = setTimeout(() => child.kill(), TIMEOUTS.walk);
        child.on("close", (code) => {
          clearTimeout(timer);
          const last = stdout.trim().split(/\r?\n/).pop() ?? "";
          let summary: Record<string, unknown> | null = null;
          try {
            summary = JSON.parse(last) as Record<string, unknown>;
          } catch {
            summary = null;
          }
          let tree: UiaNode | null = null;
          try {
            tree = (JSON.parse(readFileSync(out, "utf-8")) as { tree?: UiaNode }).tree ?? null;
          } catch {
            tree = null;
          }
          done({ ok: code === 0 && tree !== null, tree, summary, detail: `walk.ts exit ${code}` });
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          done({ ok: false, tree: null, summary: null, detail: String(e) });
        });
      }),
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    bundleDigest: () => bundleDigest(),
    recordedPid: () => input.lane.recordedPid(),
    processImage: (pid) => processByPid(defaultExec, pid)?.image ?? null,
    workbenchPids: workbenchPidsReal,
    sessionLog: () => {
      const log = newestSessionLog(config.logsPath);
      return log ? readFileSync(log, "utf-8") : null;
    },
    install: (sandboxDir) => {
      const shipped = installHandlers(sandboxDir, { really: true });
      const packs = installProbePacks(
        sandboxDir,
        PROBE_PACKS.map((p) => join(MOD_DEV_ROOT, p)),
        { really: true },
      );
      const target = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
      const installed = handlerFiles(target);
      const stampSrc = join(target, BUILD_STAMP_FILE);
      return {
        shipped: installed,
        probe: packs.flatMap((p) => p.files),
        digest: bundleDigest(target),
        stamp: existsSync(stampSrc) ? readStamp(readFileSync(stampSrc, "utf-8")) : null,
      };
    },
    lkgFiles: () =>
      git(["ls-tree", LKG_TAG, `${HANDLER_REL}/`])
        .toString("utf-8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => {
          const [meta, path] = l.split("\t");
          return { name: basename(path), blob: meta.split(/\s+/)[2] };
        }),
    readVanilla: (p) => {
      if (!input.vanilla) throw new Error("the pak reader is not open");
      return input.vanilla(p);
    },
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p) => existsSync(p),
    listTree: listTreeOf,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
  };
}

async function pakReader(): Promise<(vpath: string) => Buffer> {
  const { PakVirtualFS } = await import("../../src/pak/vfs.js");
  const vfs = PakVirtualFS.get(loadConfig().gamePath);
  if (!vfs) throw new Error("the game paks could not be opened (ENFUSION_GAME_PATH)");
  return (p) => vfs.readFile(p);
}

function realOfflineIo(): OfflineIo {
  return {
    workbenchPids: workbenchPidsReal,
    exists: (p) => existsSync(p),
    listDir: (p) => readdirSync(p),
    listTree: listTreeOf,
    readBytes: (p) => readFileSync(p),
    removeFile: (p) => unlinkSync(p),
    removeTree: (p) => rmSync(p, { recursive: true, force: false }),
    lkgBytes: (name) => git(["show", `${LKG_TAG}:${HANDLER_REL}/${name}`]),
    lkgNames: () =>
      git(["ls-tree", "--name-only", LKG_TAG, `${HANDLER_REL}/`])
        .toString("utf-8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((p) => basename(p)),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    log: (l) => console.log(l),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "id",
  "sandbox",
  "run-dir",
  "sitting-dir",
  "from",
  "until",
  "only",
  "port",
  "evidence-dir",
  "lease-path",
  "marker-path",
  "build",
] as const;
const FLAGS = ["really"] as const;

/**
 * The sitting folder and the run folder (TRAIN2-06). The sitting folder is named once, explicitly:
 * the offline block creates it (it must not exist yet), every gate block finds it with its plant
 * record. The run folder lies inside it: given, or `<sitting>/<phase>-<time>`.
 */
export function sittingLayout(input: {
  sittingDir: string | undefined;
  runDir: string | undefined;
  phase: Phase;
  exists: (p: string) => boolean;
  now: Date;
  /** The invocation is exactly `--only p33-o1-install` (the reinstall after a failed gate). */
  reinstall?: boolean;
}): { sittingDir: string; runDir: string } | string {
  if (!input.sittingDir) return "--really needs --sitting-dir <one folder per sitting>";
  const sittingDir = resolve(input.sittingDir);
  if (input.phase === "offline-0") {
    // A reinstall (`--only p33-o1-install`, runbook "Relaunch budget" item 3) runs in a new offline
    // run folder of the SAME sitting; anything else of the offline block starts a new sitting.
    if (input.exists(sittingDir) && !input.reinstall)
      return `${sittingDir} exists: the offline block starts a NEW sitting folder (a reinstall is --only p33-o1-install)`;
    if (input.reinstall && !input.exists(join(sittingDir, PLANT_FILE)))
      return `${sittingDir} holds no ${PLANT_FILE}: a reinstall needs the sitting's offline block first`;
  } else if (!input.exists(join(sittingDir, PLANT_FILE))) {
    return `${sittingDir} holds no ${PLANT_FILE}: run the offline block of this sitting first`;
  }
  const tag = input.phase === "offline-0" ? "offline" : `g${input.phase}`;
  const runDir = resolve(
    input.runDir ?? join(sittingDir, `${tag}-${input.now.toISOString().replace(/[:.]/g, "-")}`),
  );
  if (dirname(runDir) !== sittingDir) return `--run-dir must lie directly in ${sittingDir}`;
  return { sittingDir, runDir };
}

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: Train2Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  if (
    argv.some(
      (a) =>
        a.toLowerCase() === NEVER_FLAG.toLowerCase() ||
        a.toLowerCase() === "--script-authorize-all",
    )
  ) {
    say(`refused: ${NEVER_FLAG} is never part of sitting P3-3`);
    return EXIT.usage;
  }
  const sub = argv[0] === "restore" || argv[0] === "rollback" ? argv[0] : null;
  let args;
  try {
    args = parseArgs(sub ? argv.slice(1) : argv, VALUED);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const unknown = [...args.flags].filter((f) => !(FLAGS as readonly string[]).includes(f));
  if (unknown.length) {
    say(`unknown option(s): ${unknown.map((f) => `--${f}`).join(", ")}`);
    return EXIT.usage;
  }
  const o = args.options;
  const really = args.flags.has("really");

  if (sub) {
    if (!o.sandbox || basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
      say(`${sub} needs --sandbox <the 2.0 sandbox folder ${SANDBOX_NAME}>`);
      return EXIT.usage;
    }
    if (really) {
      if (!o.id) {
        say(`${sub} --really needs --id <lane id>`);
        return EXIT.usage;
      }
      const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
      const gate = liveGateReason({
        really,
        platform: over.platform ?? process.platform,
        leaseHeld: over.leaseHeld ?? lane.holdsLease(),
      });
      if (gate) {
        say(gate);
        return EXIT.refused;
      }
    }
    const io = over.offlineIo ?? realOfflineIo();
    const sandbox = resolve(o.sandbox);
    if (sub === "restore")
      return runRestore(sandbox, really, { ...io, log: (l) => say(toPlaceholders(l, ph)) });
    if (!o["sitting-dir"]) {
      say("rollback needs --sitting-dir <the sitting folder>");
      return EXIT.usage;
    }
    return runRollback(sandbox, resolve(o["sitting-dir"]), really, {
      ...io,
      log: (l) => say(toPlaceholders(l, ph)),
    });
  }

  const steps = buildSteps();
  const plan = buildActionPlan(steps);
  const policy = over.policy ?? loadPolicy();
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  if (o["emit-queue"])
    writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    say(formatResult(check));
    return check.ok ? EXIT.done : EXIT.refused;
  }
  if (!check.ok) {
    say(formatResult(check));
    return EXIT.refused;
  }
  const selected = selectSteps(steps, { from: o.from, only: o.only, until: o.until });
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  if (!o.id || !o.sandbox) {
    say("--really needs --id <lane id> and --sandbox <the 2.0 sandbox folder>");
    return EXIT.usage;
  }
  if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    say(`aborted: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
    return EXIT.aborted;
  }
  const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  const gate = liveGateReason({
    really,
    platform: over.platform ?? process.platform,
    leaseHeld: over.leaseHeld ?? lane.holdsLease(),
  });
  if (gate) {
    say(gate);
    return EXIT.refused;
  }
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  const layout = sittingLayout({
    sittingDir: o["sitting-dir"],
    runDir: o["run-dir"],
    phase: selected[0].phase,
    exists: existsSync,
    now: new Date(),
    reinstall: selected.length === 1 && selected[0].id === "p33-o1-install",
  });
  if (typeof layout === "string") {
    say(toPlaceholders(`refused: ${layout}`, ph));
    return EXIT.refused;
  }
  const { sittingDir, runDir } = layout;
  mkdirSync(runDir, { recursive: true });
  let deps = over.deps;
  if (!deps) {
    const needsPaks = selected.some(
      (s) => s.id === "p33-o2-plant" || s.id === "p33-g2-12-cst-accept",
    );
    deps = realDeps({ port, lane, runDir, vanilla: needsPaks ? await pakReader() : null });
    lane.startHeartbeat();
  }
  try {
    const r = await runBattery(selected, deps, {
      runDir,
      sittingDir,
      sandboxDir: resolve(o.sandbox),
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, sandbox: resolve(o.sandbox) },
      build: o.build ?? "unrecorded",
    });
    for (const rec of r.records) say(`${rec.step}: ${rec.status}`);
    if (r.message)
      say(
        toPlaceholders(
          `${r.exit === EXIT.handoff ? "HANDOFF" : r.exit === EXIT.refused ? "REFUSED" : "STOPPED"}: ${r.message}`,
          ph,
        ),
      );
    say(toPlaceholders(`run folder: ${runDir}`, ph));
    return r.exit;
  } finally {
    lane.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  // An explicit exit: a step cut by the window poller may leave a call in flight (TRAIN2-01).
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}
