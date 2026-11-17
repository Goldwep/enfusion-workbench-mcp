/**
 * The L01/L03 re-walk of the eight Resource Manager sub-editors (W8 follow-up 2.1,
 * `docs/v2/inbox/w8/followups.md` item 2; runbook block 5b of `docs/v2/sessions/queues/W8.md`).
 * Hand-free, in a lane whose Workbench is already up on the sandbox. For each sub-editor of
 * `VIEWER_EXTENSIONS` (Config, Font, Imageset, Layout, Material, Model, Styles, Texture), in order:
 *
 *   open    `wb_module open ResourceManager` (the RM window fronted, as w8-30 has it), then
 *           one vanilla read-only resource in it, the P4-9 route that w8-30 and w8-75 take
 *           (w8.live.ts `openViewerResource`: the first registered `wb_resources search` hit of the
 *           sub-editor's type, `wb_module setResource` on the Resource Manager), watched
 *   L01     `L01-snapshot.ts --really` for `ResourceManager.<X>`, `--state none`, `--build`, into
 *           the sub-editor's run folder `<run-root>/ResourceManager.<X>/` (a child process)
 *   L03     `L03-chrome.ts --really` for the same module, state, build and run folder (it reads the
 *           L01 walk file there and sends nothing for the walk)
 *   close   `File > Close` through w8-75's clean close (w8.live.ts `viewerCloseRow` and
 *           `closeViewerDocument`), watched. Never Save. A save prompt is a STOP of the whole run and
 *           is not answered; no File/Close row in the carried locators leaves the tab open and is a
 *           per-editor failure.
 *
 * The open and the close run under common.ts `watched` with the busy grace (`BUSY_GRACE_MS`), on
 * the pid the lane recorded; the walkers watch their own steps. A per-editor failure (no file, an
 * open refused, a walker that exits 1 or 3, no close row, a close refused) is recorded and the run
 * goes on to the next sub-editor. A HANDOFF (exit 5), an ABORT (exit 4) or a save prompt ends the
 * whole run: a dialog may be up and nothing more is sent.
 *
 * Gate (before any open, like the batteries' test-bed gate): `--really` and `--id`; the lane holds
 * the lease; `--sandbox` is the 2.0 sandbox folder; `--run-root` lies in the artifacts folder and
 * none of the selected run folders exists (a walk never runs twice in one folder); the recorded pid
 * is a Workbench image; EMCP_WB_Info says projectFound with projectName EMCP2_sandbox (else ABORT,
 * exit 4); EMCP_WB_Ping's buildStamp equals the bundle digest (else STOP, exit 3).
 *
 * Writes `<run-root>/ResourceManager.<X>/rewalk-result.json` per sub-editor and
 * `<run-root>/rewalk-summary.json` (`rewalk-summary-<X>.json` for an `--only` run, so one
 * sub-editor at a time may share a run root with a hand close between). At 789d918 the carried
 * 1.9.0.37 locator file holds no `ResourceManager.<X>` record and the ledger no sub-editor
 * `File/Close` row (followups item 2.3), so until one is carried every close is "not done" and the
 * tab stays open: the summary lists it under `openTabs`. Exit: 0 every selected sub-editor walked and closed; 3 one or
 * more failed, or the run stopped; 4 aborted; 5 handoff; 1 refused; 2 usage.
 *
 *   npx --no tsx scripts/census/live/rewalk-subeditors.ts [--run-root <dir>]        (prints the plan; refused)
 *   npx --no tsx scripts/census/live/rewalk-subeditors.ts --really --id <lane> --sandbox <dir>
 *       --run-root <dir> --build <tag> [--only Config,Font,...] [--port <n>]
 *       [--lease-path <p>] [--marker-path <p>]
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkbenchClient, bundleDigest } from "../../../src/workbench/client.js";
import { loadLocatorRecords, type LocatorRecord } from "../../../src/gui/locators.js";
import { DEFAULT_CENSUS_ROOT } from "../../../src/census/ledger-io.js";
import { liveGateReason, parseArgs } from "../../live/cli.js";
import { Lane } from "../../live/lane.js";
import { DEFAULT_PORT } from "../../live/netcall.js";
import { REPO_ROOT, SANDBOX_NAME, artifactsDir } from "../../live/paths.js";
import { outsideArtifacts } from "../../live/session-common.js";
import { WALKERS, commandLine, walkerDefs } from "../../live/p4-1.js";
import {
  VIEWER_EXTENSIONS,
  closeViewerDocument,
  openViewerResource,
  viewerCloseRow,
  type ToolResponse,
  type ViewerCalls,
} from "../../../tests/live/w8.live.js";
import {
  BUSY_GRACE_MS,
  EXIT,
  HEARTBEAT_MS,
  StopBattery,
  isMainModule,
  laneArgv,
  parseState,
  pidRefusal,
  realWalkerDeps,
  watched,
  type WalkerLane,
  type WatchDeps,
} from "./common.js";

export const SCRIPT = "scripts/census/live/rewalk-subeditors.ts";
/** The session the walkers' evidence records carry. */
export const SESSION = "W8-rewalk";
/** The state of every walk: the sub-editors declare no axis (state-matrix.json; P4-9). */
export const STATE = "none";
/** The wait after setResource before the walk (the tab draws; w8-30 polls once). */
export const OPEN_SETTLE_MS = 2_000;
export const RESULT_FILE = "rewalk-result.json";
export const SUMMARY_FILE = "rewalk-summary.json";
/** The eight sub-editors, in VIEWER_EXTENSIONS order. */
export const SUB_EDITORS: readonly string[] = Object.keys(VIEWER_EXTENSIONS);

/**
 * The summary of one invocation: `rewalk-summary.json` for all eight, `rewalk-summary-<X>[-<Y>].json`
 * for an `--only` run, so one sub-editor at a time can share a run root (a hand close between).
 */
export function summaryFile(selected: readonly string[]): string {
  if (selected.length === SUB_EDITORS.length) return SUMMARY_FILE;
  return `rewalk-summary-${selected.map((m) => m.replace(/^ResourceManager\./, "")).join("-")}.json`;
}

type Raw = Record<string, unknown>;

export interface RewalkDeps extends WatchDeps {
  now: () => number;
  recordedPid: () => number | null;
  processImage: (pid: number) => string | null;
  heartbeat: () => void;
  exists: (path: string) => boolean;
  writeFile: (path: string, text: string) => void;
  log: (line: string) => void;
  /** A shipped TS tool, in process (common.ts realWalkerClient). */
  tool: ViewerCalls["tool"];
  info: () => Promise<Raw | null>;
  ping: () => Promise<Raw | null>;
  bundleDigest: () => string | null;
  /** The carried locator records of the build (`data/census/locators/<build>.jsonl`). */
  locators: (build: string) => Map<string, LocatorRecord>;
  /** Run a walker's CLI as a child process; its exit code. */
  walk: (script: string, argv: string[]) => Promise<number>;
}

export interface RewalkOverrides {
  deps?: RewalkDeps;
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  leaseHeld?: boolean;
  artifactsRoot?: string;
}

/** The walker invocation of one sub-editor (L01 or L03), with `--from` its first planned step. */
export function walkArgv(
  walker: "L01" | "L03",
  module: string,
  o: { lane: WalkerLane; sandbox: string; runDir: string; build: string; port: number },
): { script: string; argv: string[] } | { refusal: string } {
  const state = parseState(STATE);
  if (typeof state === "string") return { refusal: state };
  const steps = walkerDefs()[walker].steps({ module, state, allowOwned: false });
  if (!steps.length) return { refusal: `${walker} plans no step for ${module}` };
  return {
    script: WALKERS[walker],
    argv: [
      "--really",
      ...laneArgv(o.lane),
      "--sandbox",
      o.sandbox,
      "--run-dir",
      o.runDir,
      "--module",
      module,
      "--state",
      STATE,
      "--build",
      o.build,
      "--session",
      SESSION,
      "--port",
      String(o.port),
      "--from",
      steps[0].id,
    ],
  };
}

/** `--only Config,Font` (or the full module ids) to module ids; a string is the problem. */
export function selectSubEditors(only: string | undefined): string[] | string {
  if (!only) return [...SUB_EDITORS];
  const out: string[] = [];
  for (const part of only
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = part.startsWith("ResourceManager.") ? part : `ResourceManager.${part}`;
    if (!SUB_EDITORS.includes(m)) return `--only: ${part} is not one of ${SUB_EDITORS.join(", ")}`;
    if (!out.includes(m)) out.push(m);
  }
  return out.length ? out : "--only names no sub-editor";
}

function brief(r: ToolResponse | null | undefined): Raw | null {
  if (!r) return null;
  return r.ok
    ? { ok: true, readback: r.readback ?? null }
    : { ok: false, code: r.code ?? null, message: r.message ?? null };
}

const truthy = (v: unknown): boolean => v === true || v === "true" || v === 1 || v === "1";

const EXIT_NAME: Record<number, string> = {
  0: "done",
  1: "refused",
  2: "usage",
  3: "stopped",
  4: "aborted",
  5: "handoff",
};

/** The test-bed gate: throws StopBattery (aborted on the wrong project, stopped on the stamp). */
export async function testBedGate(deps: RewalkDeps): Promise<Raw> {
  const info = await deps.info();
  const evidence: Raw = {
    projectFound: info?.projectFound ?? null,
    projectName: info?.projectName ?? null,
  };
  // The test-bed check lives here, in the live script, never in a shipped handler (DEC-058).
  if (!truthy(info?.projectFound) || info?.projectName !== SANDBOX_NAME)
    throw new StopBattery(
      "aborted",
      `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the live lane's test bed`,
      evidence,
    );
  const ping = await deps.ping();
  const stamp = typeof ping?.buildStamp === "string" ? ping.buildStamp : "";
  const digest = deps.bundleDigest();
  evidence.stamp = stamp || null;
  evidence.digest = digest;
  if (!stamp || !digest || stamp !== digest)
    throw new StopBattery("stopped", "the build stamp does not match the bundle digest", evidence);
  return evidence;
}

export async function main(argv: string[], over: RewalkOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  let args;
  try {
    args = parseArgs(argv, [
      "id",
      "sandbox",
      "run-root",
      "build",
      "only",
      "port",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const unknown = [...args.flags].filter((f) => f !== "really");
  if (unknown.length || args.positional.length) {
    say(`unknown option(s): ${[...unknown.map((f) => `--${f}`), ...args.positional].join(", ")}`);
    return EXIT.usage;
  }
  const o = args.options;
  const selected = selectSubEditors(o.only);
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    say(`--port ${o.port} is not a port`);
    return EXIT.usage;
  }
  const lane: WalkerLane = {
    id: o.id ?? "<lane>",
    leasePath: o["lease-path"],
    markerPath: o["marker-path"],
  };
  const root = resolve(o["run-root"] ?? "<run-root>");
  const build = o.build ?? "<build>";
  // The plan, printed on every invocation.
  say(`${SCRIPT}: ${selected.length} sub-editor(s), state ${STATE}, build ${build}`);
  for (const m of selected) {
    say(
      `  ${m}: open one vanilla .${VIEWER_EXTENSIONS[m]} (wb_resources search, wb_module setResource)`,
    );
    for (const w of ["L01", "L03"] as const) {
      const a = walkArgv(w, m, {
        lane,
        sandbox: o.sandbox ?? "<sandbox>",
        runDir: join(root, m),
        build,
        port,
      });
      say(`    ${"refusal" in a ? `${w}: ${a.refusal}` : commandLine(a.script, a.argv)}`);
    }
    say(`    File > Close (w8-75 clean close; never Save; a prompt stops the run)`);
  }
  if (!args.flags.has("really") || !o.id) {
    say("refused: the re-walk acts only with --really and --id <lane>");
    return EXIT.refused;
  }
  if (!o.sandbox || !o["run-root"] || !o.build) {
    say("--really needs --sandbox <the 2.0 sandbox folder>, --run-root <dir> and --build <tag>");
    return EXIT.usage;
  }
  if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    say(`aborted: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
    return EXIT.aborted;
  }
  const realLane = over.deps
    ? null
    : new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  const gate = liveGateReason({
    really: true,
    platform: over.platform ?? process.platform,
    leaseHeld: over.leaseHeld ?? realLane?.holdsLease() ?? false,
  });
  if (gate) {
    say(gate);
    return EXIT.refused;
  }
  const outside = outsideArtifacts(root, over.artifactsRoot ?? artifactsDir());
  if (outside) {
    say(`refused: ${outside}`);
    return EXIT.refused;
  }
  const deps = over.deps ?? realDeps(realLane as Lane, port);
  const ran = selected.filter((m) => deps.exists(join(root, m)));
  if (ran.length || deps.exists(join(root, summaryFile(selected)))) {
    say(
      `refused: ${ran.length ? ran.join(", ") : summaryFile(selected)} already in ${root}: a walk never runs twice in one folder; take a new --run-root`,
    );
    return EXIT.refused;
  }
  if (realLane) realLane.startHeartbeat(HEARTBEAT_MS);
  try {
    return await runRewalk(deps, {
      selected,
      root,
      build,
      sandbox: resolve(o.sandbox),
      lane: { id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] },
      port,
      say,
    });
  } finally {
    if (realLane) realLane.stopHeartbeat();
  }
}

export interface RewalkRun {
  selected: string[];
  root: string;
  build: string;
  sandbox: string;
  lane: WalkerLane;
  port: number;
  say: (line: string) => void;
}

/** The re-walk after the CLI checks: the gate, then each sub-editor; the summary is always written. */
export async function runRewalk(deps: RewalkDeps, r: RewalkRun): Promise<number> {
  const startedAt = new Date(deps.now()).toISOString();
  const results: Raw[] = [];
  let stop: { exit: number; message: string; at: string } | null = null;
  let gate: Raw = {};
  const writeSummary = (exit: number): void => {
    const walked = results.filter((x) => x.walked === true).length;
    const closed = results.filter((x) => x.closed === true).length;
    const summary = {
      script: SCRIPT,
      build: r.build,
      state: STATE,
      startedAt,
      endedAt: new Date(deps.now()).toISOString(),
      gate,
      selected: r.selected,
      walked,
      closed,
      openTabs: results.filter((x) => x.opened === true && x.closed !== true).map((x) => x.module),
      notReached: r.selected.filter((m) => !results.some((x) => x.module === m)),
      stop,
      exit,
      exitName: EXIT_NAME[exit] ?? String(exit),
      results: results.map((x) => ({
        module: x.module,
        status: x.status,
        resource: x.resource,
        failures: x.failures,
      })),
      runDirs: results.filter((x) => x.walked === true).map((x) => x.runDir),
    };
    deps.writeFile(join(r.root, summaryFile(r.selected)), JSON.stringify(summary, null, 2) + "\n");
    r.say(
      `rewalk: ${walked} of ${r.selected.length} walked, ${closed} closed${stop ? `; ${EXIT_NAME[stop.exit]} at ${stop.at}: ${stop.message}` : ""}`,
    );
  };

  // ── The gate ──
  try {
    deps.heartbeat();
    const pid = deps.recordedPid();
    const why = pidRefusal(pid, pid === null ? null : deps.processImage(pid));
    if (why) throw new StopBattery("stopped", why);
    gate = await testBedGate(deps);
  } catch (e) {
    const s = e instanceof StopBattery ? e : new StopBattery("stopped", String(e));
    gate = { ...gate, ...s.evidence, refused: s.message };
    const exit = s.kind === "aborted" ? EXIT.aborted : EXIT.stopped;
    stop = { exit, message: s.message, at: "gate" };
    writeSummary(exit);
    return exit;
  }
  const records = deps.locators(r.build);
  const pid = deps.recordedPid() as number;
  const calls: ViewerCalls = {
    tool: (n, a) => deps.tool(n, a),
    sleep: (ms) => deps.sleep(ms),
    pid: () => deps.recordedPid(),
  };
  /** One watched phase (busy grace on); a window verdict throws StopBattery. */
  const phase = async <T>(fn: () => Promise<T>): Promise<T> =>
    (
      await watched(deps, pid, undefined, new AbortController(), fn, {
        busyGraceMs: BUSY_GRACE_MS,
      })
    ).value;

  for (const module of r.selected) {
    const runDir = join(r.root, module);
    const res: Raw = {
      module,
      ext: VIEWER_EXTENSIONS[module],
      runDir,
      build: r.build,
      state: STATE,
      startedAt: new Date(deps.now()).toISOString(),
      opened: false,
      walked: false,
      closed: false,
    };
    const failures: string[] = [];
    const finish = (): void => {
      res.failures = failures;
      res.status = failures.length ? "fail" : "pass";
      res.endedAt = new Date(deps.now()).toISOString();
      deps.writeFile(join(runDir, RESULT_FILE), JSON.stringify(res, null, 2) + "\n");
      results.push(res);
      r.say(`${module}: ${res.status}${failures.length ? ` (${failures.join("; ")})` : ""}`);
    };
    try {
      deps.heartbeat();
      // ── open ──
      const opened = await phase(async () => {
        // The RM window fronted first, as w8-30 has it when it reaches the sub-editors (its RM
        // sweep opened ResourceManager) and P4-9 had it (L10's open-front-info step).
        res.front = brief(
          await deps.tool("wb_module", { action: "open", module: "ResourceManager" }),
        );
        const v = await openViewerResource(calls, module);
        if (v.set?.ok) await deps.sleep(OPEN_SETTLE_MS);
        return v;
      });
      res.resource = opened.resource || null;
      res.search = brief(opened.search);
      res.open = brief(opened.set);
      if (!opened.set) {
        failures.push(`no vanilla .${VIEWER_EXTENSIONS[module]} found`);
        finish();
        continue;
      }
      if (!opened.set.ok) {
        failures.push(
          `setResource refused: ${opened.set.code ?? ""} ${opened.set.message ?? ""}`.trim(),
        );
        finish();
        continue;
      }
      res.opened = true;
      // ── L01, then L03 (it reads L01's walk file in the same run folder) ──
      const exits: Record<string, number> = {};
      for (const w of ["L01", "L03"] as const) {
        deps.heartbeat();
        const a = walkArgv(w, module, {
          lane: r.lane,
          sandbox: r.sandbox,
          runDir,
          build: r.build,
          port: r.port,
        });
        if ("refusal" in a) {
          failures.push(a.refusal);
          continue;
        }
        const code = await deps.walk(a.script, a.argv);
        exits[w] = code;
        res[w.toLowerCase()] = {
          exit: code,
          exitName: EXIT_NAME[code] ?? String(code),
          command: commandLine(a.script, a.argv),
        };
        if (code === EXIT.handoff || code === EXIT.aborted)
          throw new StopBattery(
            code === EXIT.handoff ? "handoff" : "aborted",
            `${w} ended in ${EXIT_NAME[code]} (exit ${code}): a dialog or another project may be up; nothing more is sent`,
          );
        if (code !== EXIT.done) failures.push(`${w} exit ${code} (${EXIT_NAME[code] ?? "?"})`);
      }
      res.walked = exits.L01 === EXIT.done && exits.L03 === EXIT.done;
      // ── close ──
      const row = viewerCloseRow(records, module);
      if (!row) {
        res.close = { done: false, why: `no ${module} File/Close row in the ${r.build} locators` };
        failures.push(`close: no File/Close locator (the tab is left open)`);
        finish();
        continue;
      }
      const c = await phase(() => closeViewerDocument(calls, row.rowId));
      res.close = { rowId: row.rowId, answer: brief(c.close), prompt: c.prompt };
      if (c.prompt.length)
        throw new StopBattery(
          "stopped",
          `File > Close on ${module} raised "${c.prompt[0]}": a save prompt is a stop; it is not answered (never Save)`,
        );
      if (!c.close.ok)
        failures.push(`close refused: ${c.close.code ?? ""} ${c.close.message ?? ""}`.trim());
      else res.closed = true;
      finish();
    } catch (e) {
      const s =
        e instanceof StopBattery
          ? e
          : new StopBattery("stopped", e instanceof Error ? e.message : String(e));
      const exit =
        s.kind === "aborted" ? EXIT.aborted : s.kind === "handoff" ? EXIT.handoff : EXIT.stopped;
      failures.push(`${s.kind}: ${s.message}`);
      res.stop = { kind: s.kind, message: s.message, ...s.evidence };
      finish();
      stop = { exit, message: s.message, at: module };
      writeSummary(exit);
      return exit;
    }
  }
  const exit = results.every((x) => x.status === "pass") ? EXIT.done : EXIT.stopped;
  writeSummary(exit);
  return exit;
}

// ── Real deps ────────────────────────────────────────────────────────────────

const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function realDeps(lane: Lane, port: number): RewalkDeps {
  const base = realWalkerDeps(lane, port);
  const client = new WorkbenchClient("127.0.0.1", port);
  const probe = async (name: string): Promise<Raw | null> => {
    try {
      return (await client.probe(name, {}, { timeout: 10_000 })) as Raw;
    } catch {
      return null;
    }
  };
  return {
    windows: base.windows,
    sleep: base.sleep,
    now: base.now,
    recordedPid: base.recordedPid,
    processImage: base.processImage,
    heartbeat: base.heartbeat,
    exists: base.exists,
    writeFile: (p, t) => base.writeFile(p, t),
    log: base.log,
    tool: async (name, args) => {
      if (!base.client) throw new Error("no tool client");
      return (await base.client.tool(name, args)) as unknown as ToolResponse;
    },
    info: () => probe("EMCP_WB_Info"),
    ping: () => probe("EMCP_WB_Ping"),
    bundleDigest: () => bundleDigest(),
    locators: (build) => loadLocatorRecords(DEFAULT_CENSUS_ROOT, build),
    walk: (script, argv) =>
      new Promise((res) => {
        const child = spawn(
          process.execPath,
          ["--import", TSX_IMPORT, join(REPO_ROOT, script), ...argv],
          { cwd: REPO_ROOT, stdio: "inherit" },
        );
        child.on("exit", (code) => res(code ?? 1));
        child.on("error", () => res(1));
      }),
  };
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
