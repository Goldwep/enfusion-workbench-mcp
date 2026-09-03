/**
 * `wb_build_data` — wrap `-wbModule=ResourceManager -buildData <platform>
 * <outDir>` for CI / pack automation (L3-7).
 *
 * Produces packed `.pak` output from a project's resources. The Workbench
 * does the pak compression; this tool just orchestrates and surfaces any
 * errors.
 *
 * Argv form (review 2026-09 H9) follows the BIKI "Workbench -
 * ResourceManager Module → buildData" section (data/wiki/export.xml
 * ~line 100620):
 *   ArmaReforgerWorkbenchSteamDiag.exe -wbModule=ResourceManager -buildData PC "C:\Data\PCData"
 * Without `-wbModule=ResourceManager` the exe boots the default GUI and
 * `-buildData` is never honoured — the run "succeeds" with an empty
 * out_dir. The same doc states the Workbench exits once the build
 * completes, so process exit IS the completion signal here (unlike
 * `-validate`).
 *
 * Success is derived from artefacts, not process state (H10): after exit
 * the out_dir must contain at least one file written during the run
 * (the doc guarantees `resourceDatabase.rdb` on every completed build).
 *
 * Long builds (H11): the default `timeout_seconds` fits one MCP call;
 * for anything bigger use `action:"start"` (returns a job id at once)
 * and `action:"poll"` — the build then runs under the in-process
 * JobStore and outlives the originating call.
 *
 * Launch hardening (2026-08-31): runs under the shared LaunchWatchdog —
 * a launcher picker hold is auto-confirmed (restore + Enter), a genuine
 * block reports a diagnosis with dependency remedies instead of a bare
 * timeout, and the warn-only dep pre-flight annotates the output.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config.js";
import {
  finishRun,
  runWorkbench,
  tailLines,
  type ArtefactCheckResult,
  headlessSpawnBlocker,
} from "../workbench/cli-runner.js";
import { LaunchWatchdog } from "../workbench/launch-watchdog.js";
import { inspectProcessWindows, nudgeEnfusionLauncher } from "../workbench/launcher-nudge.js";
import { WorkbenchLaunchTracker, snapshotSessionDirs } from "../workbench/launch-tracker.js";
import {
  buildPreflightNote,
  buildStuckReport,
  buildTimeoutDiagnostics,
} from "../workbench/launch-reports.js";
import { checkWorkbenchVisibleDeps, type WbDepsCheck } from "../workbench/wb-deps.js";
import { JobStore } from "../runtime/job.js";

export const BUILD_PLATFORMS = ["PC", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5"] as const;
export type BuildPlatform = (typeof BUILD_PLATFORMS)[number];

/** Default wall-clock budget in seconds — fits one MCP call (H11). */
export const DEFAULT_BUILD_TIMEOUT_S = 100;

/**
 * Build the -buildData argv. `-wbModule=ResourceManager` is mandatory
 * (BIKI, see file header); the platform and out dir are positional
 * values after `-buildData`; `-wbProjectPath` and its value ride as
 * separate entries (engine tokenizer gotcha, see cli-runner.ts).
 */
export function buildBuildDataArgs(
  platform: BuildPlatform,
  outDirFull: string,
  gprojFull: string,
): string[] {
  return [
    "-wbModule=ResourceManager",
    "-buildData",
    platform,
    outDirFull,
    "-wbProjectPath",
    gprojFull,
    "-noPause",
  ];
}

/** Bounded recursive walk — enough to answer "did the build write anything?". */
const MAX_WALK_ENTRIES = 20_000;

/**
 * Count files under `dir`, and how many were modified at/after `sinceMs`.
 * Pure fs read; never throws on a missing dir (reports zero).
 */
export function countOutputFiles(dir: string, sinceMs: number): { total: number; fresh: number } {
  let total = 0;
  let fresh = 0;
  let visited = 0;
  const stack = [dir];
  while (stack.length > 0 && visited < MAX_WALK_ENTRIES) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (++visited > MAX_WALK_ENTRIES) break;
      const full = join(cur, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        total += 1;
        // 2 s slack: FAT/NTFS mtime granularity + clock skew on the run start.
        if (st.mtimeMs >= sinceMs - 2000) fresh += 1;
      }
    }
  }
  return { total, fresh };
}

/** Artefact check for finishRun: at least one file written during the run. */
export function buildDataArtefactCheck(outDir: string, startedAtMs: number): ArtefactCheckResult {
  const { total, fresh } = countOutputFiles(outDir, startedAtMs);
  return {
    ok: fresh > 0,
    detail: `${fresh} file${fresh === 1 ? "" : "s"} written this run, ${total} total under ${outDir}`,
  };
}

export interface BuildDataParams {
  gproj_path: string;
  out_dir: string;
  platform: BuildPlatform;
  timeout_seconds: number;
  launcher_nudge: boolean;
}

export interface BuildDataOutcome {
  text: string;
  isError: boolean;
}

/**
 * The build itself — shared by the synchronous `run` action and the
 * JobStore-backed `start` action. Never throws: every failure is a
 * `{ isError:true }` outcome so the job status stays "done" with a
 * readable report rather than "failed" with a bare message.
 */
export async function executeBuildData(
  params: BuildDataParams,
  config: Config,
  log: (line: string) => void = () => {},
): Promise<BuildDataOutcome> {
  const { gproj_path, out_dir, platform, timeout_seconds, launcher_nudge } = params;
  try {
    // Audit-fix L3 B1: flag-smuggle guard MUST run on raw user input,
    // BEFORE resolve() prepends cwd and masks the leading dash.
    for (const p of [gproj_path, out_dir]) {
      if (p.startsWith("-") || p.includes("\0") || p.includes('"')) {
        return {
          text: `Path may not start with '-' or contain NULL bytes or double quotes: ${p}`,
          isError: true,
        };
      }
    }
    const gprojFull = resolve(gproj_path);
    const outFull = resolve(out_dir);
    if (!existsSync(gprojFull)) {
      return { text: `.gproj not found: ${gprojFull}`, isError: true };
    }
    // Post-resolve defense-in-depth (rare but possible if path includes
    // dot-traversal that resolves into a leading dash).
    for (const p of [gprojFull, outFull]) {
      if (p.startsWith("-")) {
        return { text: `Path may not start with '-': ${p}`, isError: true };
      }
    }
    try {
      mkdirSync(outFull, { recursive: true });
    } catch (e) {
      return {
        text: `Cannot create out_dir ${outFull}: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      };
    }

    // Warn-only dependency pre-flight (see wb-validate-scripts.ts for
    // the rationale).
    let depCheck: WbDepsCheck | null = null;
    let depCheckError: string | undefined;
    try {
      depCheck = checkWorkbenchVisibleDeps(gprojFull, config);
    } catch (e) {
      depCheckError = e instanceof Error ? e.message : String(e);
    }

    const blocker = headlessSpawnBlocker();
    if (blocker) return { text: blocker, isError: true };

    const args = buildBuildDataArgs(platform, outFull, gprojFull);
    const logsRoot = config.logsPath;
    const tracker = new WorkbenchLaunchTracker(logsRoot, snapshotSessionDirs(logsRoot));
    if (launcher_nudge) {
      tracker.watchdog = new LaunchWatchdog({
        readConsoleLog: tracker.readConsoleLog,
        nudge: nudgeEnfusionLauncher,
        inspectWindows: inspectProcessWindows,
      });
    }
    const startedAt = Date.now();
    log(`spawn: ${args.join(" ")}`);
    const result = await runWorkbench({
      workbenchPath: config.workbenchPath,
      args,
      timeoutMs: timeout_seconds * 1000,
      pollSignal: { intervalMs: 2000, check: tracker.check },
    });
    log(
      `exit: code=${result.exitCode ?? "(killed)"} timedOut=${result.timedOut} ${(result.durationMs / 1000).toFixed(1)}s`,
    );

    const consoleTail = tailLines(tracker.readConsoleLog(), 15);

    if (
      result.earlySignal === "stuck:launcher-picker" ||
      result.earlySignal === "stuck:missing-deps"
    ) {
      return {
        text: buildStuckReport(result.earlySignal, {
          toolLabel: "wb_build_data",
          gprojPath: gprojFull,
          durationMs: result.durationMs,
          sessionDir: tracker.sessionDir,
          logsRoot,
          watchdog: tracker.watchdog!,
          consoleTail,
          depCheck,
          depCheckError,
        }),
        isError: true,
      };
    }

    const outcome = finishRun(result, () => buildDataArtefactCheck(outFull, startedAt));
    const artefacts = countOutputFiles(outFull, startedAt);

    const lines: string[] = [];
    lines.push(`## wb_build_data: ${platform} → ${outFull}`);
    lines.push("");
    lines.push(`Source: ${gprojFull}`);
    lines.push(
      `Exit code: ${result.exitCode ?? "(killed)"}${result.timedOut ? " — TIMEOUT (process tree killed)" : ""}`,
    );
    lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    lines.push(
      `Output files: ${artefacts.fresh} written this run (${artefacts.total} total under out_dir)`,
    );
    if (tracker.watchdog?.nudgeOutcome?.enterPosted) {
      lines.push(
        "ℹ️ Launcher project picker was auto-confirmed (launcher window restored, Enter posted on the preselected Open).",
      );
    }
    const preflightNote = buildPreflightNote(depCheck);
    if (preflightNote && tracker.watchdog?.cliParamsSeen) {
      lines.push(preflightNote);
    }
    if (tracker.sessionDir) {
      lines.push(`Log session: ${tracker.sessionDir}`);
    }
    lines.push("");
    if (outcome.ok) {
      lines.push("✅ Build complete — output verified in out_dir.");
    } else if (outcome.status === "no-artefacts") {
      lines.push(`❌ Build reported ${outcome.reason}. Tail follows.`);
    } else if (outcome.status === "timeout") {
      lines.push(
        `❌ ${outcome.reason}. Large project? Re-run with a bigger timeout_seconds, or use action:"start" + action:"poll" to run it as a background job.`,
      );
    } else {
      lines.push(`❌ Build failed (${outcome.reason}). Tail follows.`);
    }
    lines.push("");
    if (result.timedOut) {
      lines.push(
        ...buildTimeoutDiagnostics({
          watchdog: tracker.watchdog,
          consoleTail,
          depCheck,
          depCheckError,
        }),
      );
      lines.push("");
    } else if (!outcome.ok && consoleTail.trim().length > 0) {
      lines.push("### console.log tail");
      lines.push("```");
      lines.push(consoleTail);
      lines.push("```");
      lines.push("");
    }
    lines.push("### Last 40 lines (stdout)");
    lines.push("```");
    lines.push(tailLines(result.stdout, 40));
    lines.push("```");
    if (result.stderr.trim().length > 0) {
      lines.push("");
      lines.push("### Last 15 lines (stderr)");
      lines.push("```");
      lines.push(tailLines(result.stderr, 15));
      lines.push("```");
    }
    return { text: lines.join("\n"), isError: !outcome.ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: `Error running buildData: ${msg}`, isError: true };
  }
}

/** Format a JobStore snapshot for the `poll` action. */
export function formatBuildJobStatus(
  jobId: string,
  info: ReturnType<JobStore["status"]>,
): BuildDataOutcome {
  if (!info) {
    return {
      text: `Unknown job_id ${jobId} — it was never started, already evicted (store keeps the last 50), or the server restarted (jobs are in-memory).`,
      isError: true,
    };
  }
  const elapsedMs = info.startedAt === null ? 0 : (info.completedAt ?? Date.now()) - info.startedAt;
  const head =
    `## wb_build_data job ${info.id}\n\n` +
    `Status: ${info.status}\n` +
    `Elapsed: ${(elapsedMs / 1000).toFixed(1)}s\n`;
  if (info.status === "queued" || info.status === "running") {
    const logTail = info.logs.slice(-10).join("\n");
    return {
      text:
        head +
        `\nStill ${info.status} — poll again with action:"poll", job_id:"${info.id}".` +
        (logTail ? `\n\n### Job log\n\`\`\`\n${logTail}\n\`\`\`` : ""),
      isError: false,
    };
  }
  if (info.status === "failed") {
    return { text: head + `\n❌ Job failed: ${info.error ?? "(no message)"}`, isError: true };
  }
  if (info.status === "cancelled") {
    return { text: head + "\nJob was cancelled.", isError: true };
  }
  const outcome = info.result as BuildDataOutcome | undefined;
  if (!outcome) {
    return { text: head + "\n❌ Job finished without a report.", isError: true };
  }
  return { text: head + "\n" + outcome.text, isError: outcome.isError };
}

/** Module-level store: jobs are in-memory and die with the server. */
const buildJobs = new JobStore();

/** Test seam — returns the store backing `action:"start"`/`"poll"`. */
export function getBuildJobStore(): JobStore {
  return buildJobs;
}

export function registerWbBuildData(server: McpServer, config: Config): void {
  server.registerTool(
    "wb_build_data",
    {
      description:
        "Run `ArmaReforgerWorkbenchSteamDiag.exe -wbModule=ResourceManager -buildData <platform> <outDir> -wbProjectPath <gproj>` to produce packed .pak output for a project (Workbench exits when the build completes). " +
        "Success requires at least one file written to out_dir during the run — an exit 0 with an empty out_dir is reported as an error with the log tail. " +
        `Default timeout is ${DEFAULT_BUILD_TIMEOUT_S}s so the call fits an MCP client window; on timeout the whole Workbench process tree is killed. ` +
        'Long builds (1-10 min): either raise `timeout_seconds` explicitly, or use `action:"start"` (returns a job_id immediately, build continues in the background) then `action:"poll"` with that job_id until status is done. ' +
        "If the launcher holds at its Projects picker (waiting for a human click on Open, often minimized), the run auto-confirms it by restoring the window and posting Enter; " +
        "a genuine launch block reports the diagnosis (dependency GUID visibility + remedies) instead of a bare timeout.",
      inputSchema: {
        action: z
          .enum(["run", "start", "poll"])
          .default("run")
          .describe(
            "`run` (default): build synchronously and report. `start`: launch the build as a background job and return its job_id at once. `poll`: report the status/result of a job_id.",
          ),
        job_id: z
          .string()
          .optional()
          .describe("Job id from a previous `start` — required for `poll`, ignored otherwise"),
        gproj_path: z
          .string()
          .optional()
          .describe("Path to the .gproj (absolute or repo-relative). Required for `run`/`start`."),
        out_dir: z
          .string()
          .optional()
          .describe(
            "Output directory (will be created if missing). Absolute or relative to cwd. Required for `run`/`start`.",
          ),
        platform: z.enum(BUILD_PLATFORMS).default("PC").describe("Target platform for pak output"),
        timeout_seconds: z
          .number()
          .min(10)
          .max(1800)
          .default(DEFAULT_BUILD_TIMEOUT_S)
          .describe(
            `Wall-clock timeout in seconds (10-1800, default ${DEFAULT_BUILD_TIMEOUT_S}). Raise it explicitly for big builds, or use action:"start".`,
          ),
        launcher_nudge: z
          .boolean()
          .default(true)
          .describe(
            "Auto-confirm the launcher's project picker by restoring its window and posting Enter when it holds instead of auto-opening (Windows only)",
          ),
      },
    },
    async ({ action, job_id, gproj_path, out_dir, platform, timeout_seconds, launcher_nudge }) => {
      const wrap = (o: BuildDataOutcome) => ({
        content: [{ type: "text" as const, text: o.text }],
        ...(o.isError ? { isError: true as const } : {}),
      });

      if (action === "poll") {
        if (!job_id) {
          return wrap({ text: 'action:"poll" requires job_id', isError: true });
        }
        return wrap(formatBuildJobStatus(job_id, buildJobs.status(job_id)));
      }

      if (!gproj_path || !out_dir) {
        return wrap({
          text: `action:"${action}" requires gproj_path and out_dir`,
          isError: true,
        });
      }
      const params: BuildDataParams = {
        gproj_path,
        out_dir,
        platform,
        timeout_seconds,
        launcher_nudge,
      };

      if (action === "start") {
        const id = buildJobs.spawn<BuildDataOutcome>(
          (ctx) => executeBuildData(params, config, ctx.log),
          "build-data",
        );
        return wrap({
          text:
            `## wb_build_data job started\n\n` +
            `job_id: ${id}\n` +
            `Platform: ${platform}\nSource: ${resolve(gproj_path)}\nOut dir: ${resolve(out_dir)}\n` +
            `Timeout: ${timeout_seconds}s (process tree killed when exceeded)\n\n` +
            `Poll with action:"poll", job_id:"${id}". Jobs are in-memory and do not survive a server restart.`,
          isError: false,
        });
      }

      return wrap(await executeBuildData(params, config));
    },
  );
}
