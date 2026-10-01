/**
 * Live-lane post-flight (plan 5.3 "Post-flight"):
 *
 *   1 net-zero   snapshot diff is empty or every difference is on the expected-
 *                noise list (or explained in LIVE-LOG.md: reported, never hidden)
 *   2 close      if this session started Workbench: CloseMainWindow (a WM_CLOSE
 *                to its main window) on THAT pid only, then wait for the exit
 *                with a timeout. Any window still open after the timeout is
 *                reported as a hazard dialog and never answered. taskkill is
 *                only the recorded recovery path and is never run here. Then
 *                check for an orphaned CrashReporter.exe (report only).
 *   3 registry   compare with the pre-flight export and report differences.
 *                Valid only after a graceful exit. A restore is a registry
 *                write and is NEVER performed here.
 *   4 release    release the lease through Lane.end() (removes only the marker
 *                the lane created) unless the Workbench it started is still
 *                running; then write the session-log skeleton
 *                (docs/v2/sessions/<NNN>-<date>.md) to stdout or --out.
 *
 * Real operations need --really, win32 and the lease held by this lane;
 * otherwise each step reports what it would do.
 *
 * Usage:
 *   npx tsx scripts/live/postflight.ts --id <lane id> [--before <snapshot.json>]
 *       [--noise <list.json>] [--registry-before <file.reg>] [--registry-key <key>]
 *       [--close-timeout-ms 120000] [--session-number NNN] [--out <file.md>] [--really]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectProcessWindows } from "../../src/workbench/launcher-nudge.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import { WORKBENCH_EXE } from "./launch.js";
import { REPO_ROOT, artifactsDir, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { validateRegistryKey } from "./preflight.js";
import { lastLine, runPowerShell, type PowerShellResult } from "./powershell.js";
import {
  diff,
  formatDiff,
  isNetZero,
  readManifest,
  readNoiseList,
  takeSnapshot,
} from "./snapshot.js";
import {
  CRASH_REPORTER_IMAGE,
  defaultExec,
  processByPid,
  processesByImage,
  type ExecFn,
} from "./win.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PostStep {
  step: number;
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface PostflightContext {
  lane: Lane;
  really: boolean;
  platform: NodeJS.Platform;
  /** Pre-flight snapshot manifest file. */
  beforeManifest: string | null;
  noise: string[];
  registryBefore: string | null;
  /** [unverified] registry key name (see preflight.ts). */
  registryKey: string | null;
  closeTimeoutMs: number;
  artifactsDir: string;
  exec: ExecFn;
  powershell: (script: string, env?: Record<string, string>) => Promise<PowerShellResult>;
  /** Titles of a pid's top-level windows (hazard-dialog report); never posts input. */
  windowTitles: (pid: number) => Promise<string[]>;
  now: () => Date;
}

export interface PostflightReport {
  steps: PostStep[];
  /** Hazard dialogs seen during the close; never answered. */
  hazards: string[];
  graceful: boolean;
  released: boolean;
}

// ── Step 1: net-zero ─────────────────────────────────────────────────────────

export function netZeroStep(ctx: PostflightContext): PostStep {
  if (!ctx.beforeManifest) {
    return {
      step: 1,
      name: "net-zero",
      ok: false,
      detail: "no pre-flight snapshot given (--before)",
    };
  }
  const before = readManifest(ctx.beforeManifest);
  const after = takeSnapshot(before.root, before.declared, ctx.now());
  const d = diff(before, after, ctx.noise);
  return {
    step: 1,
    name: "net-zero",
    ok: isNetZero(d),
    detail: isNetZero(d)
      ? formatDiff(d).split("\n")[0] + ` (${d.noise.length} expected-noise differences)`
      : formatDiff(d) +
        "\nEvery difference must be on the expected-noise list or explained in LIVE-LOG.md.",
  };
}

// ── Step 2: graceful close ───────────────────────────────────────────────────

/**
 * PowerShell: CloseMainWindow on the pid in $env:EMCP_PID and wait up to
 * $env:EMCP_TIMEOUT_MS for it to exit. Prints { closeSent, exited }.
 */
export const CLOSE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$p = Get-Process -Id ([int]$env:EMCP_PID)",
  "$sent = $p.CloseMainWindow()",
  "$exited = $p.WaitForExit([int]$env:EMCP_TIMEOUT_MS)",
  "[pscustomobject]@{ closeSent = $sent; exited = $exited } | ConvertTo-Json -Compress",
].join("\n");

export async function closeStep(
  ctx: PostflightContext,
): Promise<{ step: PostStep; graceful: boolean; stillRunning: boolean; hazards: string[] }> {
  const name = "graceful close";
  const pid = ctx.lane.recordedPid();
  if (pid === null) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        detail: "this session started no Workbench; nothing to close",
      },
      graceful: true,
      stillRunning: false,
      hazards: [],
    };
  }
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        skipped: true,
        detail: `${reason}; would send CloseMainWindow to pid ${pid} and wait ${ctx.closeTimeoutMs} ms`,
      },
      graceful: false,
      stillRunning: false,
      hazards: [],
    };
  }
  // A pid alone is not an identity: confirm the image before sending anything.
  const proc = processByPid(ctx.exec, pid);
  if (!proc) {
    return {
      step: { step: 2, name, ok: true, detail: `pid ${pid} is no longer running` },
      graceful: false,
      stillRunning: false,
      hazards: [],
    };
  }
  if (proc.image.toLowerCase() !== WORKBENCH_EXE.toLowerCase()) {
    return {
      step: {
        step: 2,
        name,
        ok: false,
        detail: `pid ${pid} is ${proc.image}, not ${WORKBENCH_EXE}; nothing sent`,
      },
      graceful: false,
      stillRunning: false,
      hazards: [],
    };
  }
  const r = await ctx.powershell(CLOSE_SCRIPT, {
    EMCP_PID: String(pid),
    EMCP_TIMEOUT_MS: String(ctx.closeTimeoutMs),
  });
  const line = r.ok ? lastLine(r.stdout) : null;
  const res = line ? (JSON.parse(line) as { closeSent: boolean; exited: boolean }) : null;
  const crash = processesByImage(ctx.exec, CRASH_REPORTER_IMAGE).map((c) => c.pid);
  const crashNote = crash.length
    ? `; ${CRASH_REPORTER_IMAGE} still running (pid ${crash.join(", ")}), report it`
    : "";
  if (res?.exited) {
    return {
      step: {
        step: 2,
        name,
        ok: true,
        detail: `pid ${pid} exited after CloseMainWindow${crashNote}`,
      },
      graceful: true,
      stillRunning: false,
      hazards: [],
    };
  }
  const hazards = await ctx.windowTitles(pid);
  return {
    step: {
      step: 2,
      name,
      ok: false,
      detail:
        `pid ${pid} did not exit within ${ctx.closeTimeoutMs} ms` +
        (r.error ? ` (${r.error})` : "") +
        (hazards.length ? `; hazard dialog(s), not answered: ${hazards.join(" | ")}` : "") +
        crashNote +
        ". taskkill /T /F on this pid is the recorded recovery path; it is not run here.",
    },
    graceful: false,
    stillRunning: true,
    hazards,
  };
}

// ── Step 3: registry compare ─────────────────────────────────────────────────

/** Read a `reg export` file (UTF-16LE with BOM, or UTF-8) as text lines. */
export function readRegFile(path: string): string[] {
  const buf = readFileSync(path);
  const text =
    buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe
      ? buf.subarray(2).toString("utf16le")
      : buf.toString("utf-8").replace(/^﻿/, "");
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** Lines only in `before` (removed) and only in `after` (added). Report-only. */
export function compareReg(
  before: string[],
  after: string[],
): { removed: string[]; added: string[] } {
  const a = new Set(after);
  const b = new Set(before);
  return { removed: before.filter((l) => !a.has(l)), added: after.filter((l) => !b.has(l)) };
}

export function registryStep(ctx: PostflightContext, graceful: boolean): PostStep {
  const name = "registry compare";
  if (!ctx.registryBefore) {
    return {
      step: 3,
      name,
      ok: true,
      skipped: true,
      detail: "no pre-flight registry export given; nothing to compare",
    };
  }
  const reason = liveGateReason({
    really: ctx.really,
    platform: ctx.platform,
    leaseHeld: ctx.lane.holdsLease(),
  });
  if (reason) {
    return {
      step: 3,
      name,
      ok: true,
      skipped: true,
      detail: `${reason}; would export the key again and compare`,
    };
  }
  if (!ctx.registryKey)
    return { step: 3, name, ok: false, detail: "no registry key given (--registry-key)" };
  validateRegistryKey(ctx.registryKey);
  mkdirSync(ctx.artifactsDir, { recursive: true });
  const after = join(
    ctx.artifactsDir,
    `registry-after-${ctx.now().toISOString().replace(/[:.]/g, "-")}.reg`,
  );
  ctx.exec("reg", ["export", ctx.registryKey, after]);
  const d = compareReg(readRegFile(ctx.registryBefore), readRegFile(after));
  const validity = graceful
    ? ""
    : " NOT VALID: Workbench did not exit gracefully (a forced kill skips the settings write)";
  return {
    step: 3,
    name,
    ok: true,
    detail:
      `${d.removed.length} lines removed, ${d.added.length} added (after: ${after})${validity}. ` +
      "Report only: a restore is a registry write and needs the owner's go for that session.",
  };
}

// ── Step 4: release and session log ──────────────────────────────────────────

export function releaseStep(
  ctx: PostflightContext,
  stillRunning: boolean,
): { step: PostStep; released: boolean } {
  const name = "release";
  if (stillRunning) {
    return {
      step: {
        step: 4,
        name,
        ok: false,
        detail:
          "the Workbench this session started is still running; the lease is kept so nobody adopts it. Ask the owner.",
      },
      released: false,
    };
  }
  if (!ctx.really) {
    return {
      step: {
        step: 4,
        name,
        ok: true,
        skipped: true,
        detail: `dry run; would release ${ctx.lane.session}`,
      },
      released: false,
    };
  }
  let r;
  try {
    r = ctx.lane.end();
  } catch (e) {
    return {
      step: { step: 4, name, ok: false, detail: e instanceof Error ? e.message : String(e) },
      released: false,
    };
  }
  return {
    step: {
      step: 4,
      name,
      ok: true,
      detail: `lease ${r.released ? "released" : "was not present"}; marker ${r.markerRemoved ? "removed" : `kept (${r.markerNote})`}`,
    },
    released: r.released,
  };
}

/** Next session number from `docs/v2/sessions/NNN-*.md` files. */
export function nextSessionNumber(dir: string): number {
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = /^(\d{3,})-.*\.md$/.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Session-log skeleton (plan 13.1: written in placeholder form). */
export function sessionLogSkeleton(input: {
  number: number;
  date: string;
  laneSession: string;
  report: PostflightReport;
}): string {
  const nnn = String(input.number).padStart(3, "0");
  const lines: string[] = [];
  lines.push(`# Session ${nnn}, ${input.date}`);
  lines.push("");
  lines.push(`- Lane: ${input.laneSession}`);
  lines.push("- Variant: <default | headless-cli | scratch-profile | launcher-walk>");
  lines.push("- Build: <Tools build id>");
  lines.push(`- Probe queue: docs/v2/sessions/${nnn}-queue.json`);
  lines.push("- Pre-flight: <result per step>");
  lines.push("");
  lines.push("## Probes");
  lines.push("");
  lines.push("| Probe | Expected | Result | Evidence |");
  lines.push("|---|---|---|---|");
  lines.push("| <id> | <expected> | <result> | EV-<session>-<seq> |");
  lines.push("");
  lines.push("## Post-flight");
  lines.push("");
  for (const s of input.report.steps) {
    const status = !s.ok ? "FAIL" : s.skipped ? "skipped" : "ok";
    lines.push(`- ${s.step} ${s.name} (${status}): ${s.detail.split("\n").join(" / ")}`);
  }
  lines.push(
    `- Hazard dialogs (never answered): ${input.report.hazards.length ? input.report.hazards.join(" | ") : "none"}`,
  );
  lines.push("");
  lines.push("## Observations and decisions");
  lines.push("");
  lines.push("- <what was learned; decision entries for DECISIONS.md>");
  lines.push("");
  return lines.join("\n");
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runPostflight(ctx: PostflightContext): Promise<PostflightReport> {
  const steps: PostStep[] = [];
  try {
    steps.push(netZeroStep(ctx));
  } catch (e) {
    steps.push({
      step: 1,
      name: "net-zero",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  const close = await closeStep(ctx);
  steps.push(close.step);
  try {
    steps.push(registryStep(ctx, close.graceful));
  } catch (e) {
    steps.push({
      step: 3,
      name: "registry compare",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  const rel = releaseStep(ctx, close.stillRunning);
  steps.push(rel.step);
  return { steps, hazards: close.hazards, graceful: close.graceful, released: rel.released };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, [
      "id",
      "before",
      "noise",
      "registry-before",
      "registry-key",
      "close-timeout-ms",
      "session-number",
      "out",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  if (!o.id) {
    console.error("postflight needs --id <lane id>");
    return 2;
  }
  try {
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const closeTimeoutMs = o["close-timeout-ms"] ? Number(o["close-timeout-ms"]) : 120_000;
    if (!Number.isInteger(closeTimeoutMs) || closeTimeoutMs <= 0) {
      throw new Error("--close-timeout-ms must be a positive integer");
    }
    const ctx: PostflightContext = {
      lane,
      really: args.flags.has("really"),
      platform: process.platform,
      beforeManifest: o.before ?? null,
      noise: o.noise ? readNoiseList(o.noise) : [],
      registryBefore: o["registry-before"] ?? null,
      registryKey: o["registry-key"] ?? process.env.ENFUSION_WB_REGISTRY_KEY ?? null,
      closeTimeoutMs,
      artifactsDir: artifactsDir(),
      exec: defaultExec,
      powershell: (script, env) =>
        runPowerShell(script, { env, timeoutMs: closeTimeoutMs + 30_000 }),
      windowTitles: async (pid) => (await inspectProcessWindows(pid)).windowTitles,
      now: () => new Date(),
    };
    const report = await runPostflight(ctx);
    const sessionsDir = join(REPO_ROOT, "docs", "v2", "sessions");
    const number = o["session-number"]
      ? Number(o["session-number"])
      : nextSessionNumber(sessionsDir);
    const date = ctx.now().toISOString().slice(0, 10);
    const log = toPlaceholders(
      sessionLogSkeleton({ number, date, laneSession: lane.session, report }),
      defaultPlaceholderContext(),
    );
    for (const s of report.steps) {
      console.error(
        `[${!s.ok ? "FAIL" : s.skipped ? "skip" : "ok  "}] ${s.step} ${s.name}: ${s.detail}`,
      );
    }
    if (o.out) {
      writeFileSync(o.out, log, { encoding: "utf-8", flag: "wx" });
      console.log(
        `session log skeleton written to ${toPlaceholders(o.out, defaultPlaceholderContext())}`,
      );
    } else {
      process.stdout.write(log);
    }
    return report.steps.every((s) => s.ok) ? 0 : 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
