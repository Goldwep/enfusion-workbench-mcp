import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_FLAGS,
  ValidateRunTracker,
  buildPreflightNote,
  buildStuckReport,
  buildTimeoutDiagnostics,
  buildValidateArgs,
  matchValidationVerdict,
  extractErrorLines,
  extractObsoleteLines,
  snapshotSessionDirs,
  findNewSessionDir,
} from "../../src/tools/wb-validate-scripts.js";
import { runWorkbench, validateArgs } from "../../src/workbench/cli-runner.js";
import { LaunchWatchdog } from "../../src/workbench/launch-watchdog.js";
import type { NudgeOutcome } from "../../src/workbench/launcher-nudge.js";
import type { WbDepsCheck } from "../../src/workbench/wb-deps.js";

const SPACEY_GPROJ =
  "C:\\Users\\<you>\\Documents\\My Games\\ArmaReforgerWorkbench\\addons\\Test1\\addon.gproj";

describe("wb-validate-scripts: buildValidateArgs", () => {
  it("passes -wbProjectPath and the path as separate argv entries", () => {
    const args = buildValidateArgs(SPACEY_GPROJ, "PC");
    const flagIdx = args.indexOf("-wbProjectPath");
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    expect(args[flagIdx + 1]).toBe(SPACEY_GPROJ);
  });

  it("never emits the single-token -wbProjectPath=<path> form", () => {
    // The engine re-tokenizes the raw command line and truncates a
    // whole-token-quoted `-wbProjectPath=<path with spaces>` at the
    // first space (live-repro 2026-08-20).
    const args = buildValidateArgs(SPACEY_GPROJ, "HEADLESS");
    expect(args.some((a) => a.startsWith("-wbProjectPath="))).toBe(false);
  });

  it("survives validateArgs against the tool's own allow-list", () => {
    const args = buildValidateArgs(SPACEY_GPROJ, "PC");
    expect(() => validateArgs(args, ALLOWED_FLAGS)).not.toThrow();
  });

  it("carries the platform config and -noPause", () => {
    const args = buildValidateArgs(SPACEY_GPROJ, "HEADLESS");
    expect(args).toContain("-config=HEADLESS");
    expect(args).toContain("-noPause");
    expect(args).toContain("-validate");
    expect(args).toContain("-wbModule=ScriptEditor");
  });
});

describe("wb-validate-scripts: matchValidationVerdict", () => {
  it("detects a successful verdict", () => {
    expect(
      matchValidationVerdict("20:23:40.719  SCRIPT       : Script validation successful.\n"),
    ).toBe("successful");
  });

  it("detects a failed verdict", () => {
    expect(
      matchValidationVerdict("20:20:57.799  SCRIPT       : Script validation failed.\n"),
    ).toBe("failed");
  });

  it("returns null while no verdict has been logged", () => {
    expect(matchValidationVerdict("SCRIPT : Compiling Game scripts\n")).toBeNull();
    expect(matchValidationVerdict("")).toBeNull();
  });

  it("returns the LAST verdict when the idle GUI recompiled later", () => {
    const failedThenFixed =
      "Script validation failed.\n...\nScript validation successful.\n";
    expect(matchValidationVerdict(failedThenFixed)).toBe("successful");
    const okThenBroken =
      "Script validation successful.\n...\nScript validation failed.\n";
    expect(matchValidationVerdict(okThenBroken)).toBe("failed");
  });
});

describe("wb-validate-scripts: error/obsolete extraction", () => {
  // Real shape: -validate checks every platform config in one run, so the
  // same error line repeats once per configuration with a fresh timestamp.
  const scriptLog = [
    "20:20:51.438  SCRIPT    (E): Scripts/Game/VON/EC29_RadioRegistrationProbe.c(149): error: Too many parameters for 'Format' method",
    "20:20:53.045  SCRIPT    (E): Scripts/Game/VON/EC29_RadioRegistrationProbe.c(149): error: Too many parameters for 'Format' method",
    "20:20:54.605  SCRIPT    (E): Scripts/Game/VON/EC29_RadioRegistrationProbe.c(149): error: Too many parameters for 'Format' method",
    "20:20:49.872    SCRIPT    (E): Can't compile \"Game\" script module!",
    "20:23:32.240    SCRIPT    (W): @\"Scripts/Game/Settings/EC29_RFPropagationSettings.c,57\": 'SCR_JsonLoadContext' is obsolete: Use JsonLoadContext instead.",
    "20:23:34.007  SCRIPT    (W): Scripts/Game/Settings/EC29_RFPropagationSettings.c(57): warning: 'SCR_JsonLoadContext' is obsolete: Use JsonLoadContext instead.",
    "20:23:35.673  SCRIPT    (W): Scripts/Game/Settings/EC29_RFPropagationSettings.c(57): warning: 'SCR_JsonLoadContext' is obsolete: Use JsonLoadContext instead.",
    "20:23:40.719  SCRIPT       : Script validation successful.",
  ].join("\n");

  it("dedupes per-config repeats of the same error and strips timestamps", () => {
    const errors = extractErrorLines(scriptLog);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Too many parameters for 'Format' method");
    expect(errors[0]).not.toMatch(/^\d{2}:\d{2}:\d{2}\./);
    expect(errors[1]).toContain("Can't compile");
  });

  it("dedupes obsolete warnings the same way", () => {
    const obsoletes = extractObsoleteLines(scriptLog);
    // The @"file,57" compile form and the file(57) validation form remain
    // distinct lines; the repeated validation form collapses to one.
    expect(obsoletes).toHaveLength(2);
  });

  it("still ignores '0 errors' summary lines", () => {
    expect(extractErrorLines("build finished, 0 errors")).toHaveLength(0);
  });
});

describe("wb-validate-scripts: log-session discovery", () => {
  let logsRoot: string;
  beforeAll(() => {
    logsRoot = mkdtempSync(join(tmpdir(), "wb-vs-logs-"));
    mkdirSync(join(logsRoot, "logs_2026-08-20_20-20-39"));
    mkdirSync(join(logsRoot, "not_a_session"));
  });
  afterAll(() => {
    rmSync(logsRoot, { recursive: true, force: true });
  });

  it("snapshot only picks up logs_* session dirs", () => {
    const snap = snapshotSessionDirs(logsRoot);
    expect(snap.has("logs_2026-08-20_20-20-39")).toBe(true);
    expect(snap.has("not_a_session")).toBe(false);
  });

  it("findNewSessionDir returns null while nothing new appeared", () => {
    const snap = snapshotSessionDirs(logsRoot);
    expect(findNewSessionDir(logsRoot, snap)).toBeNull();
  });

  it("findNewSessionDir returns the newest post-snapshot session dir", () => {
    const snap = snapshotSessionDirs(logsRoot);
    mkdirSync(join(logsRoot, "logs_2026-08-20_20-23-24"));
    mkdirSync(join(logsRoot, "logs_2026-08-20_20-25-00"));
    expect(findNewSessionDir(logsRoot, snap)).toBe(
      join(logsRoot, "logs_2026-08-20_20-25-00"),
    );
  });

  it("both helpers tolerate a missing logs root", () => {
    const bogus = join(logsRoot, "does-not-exist");
    expect(snapshotSessionDirs(bogus).size).toBe(0);
    expect(findNewSessionDir(bogus, new Set())).toBeNull();
  });
});

describe("cli-runner: pollSignal early exit", () => {
  // Use the node binary itself as a stand-in for the Workbench exe: an
  // idle `setInterval` script mimics -validate's never-exits behavior.
  const IDLE_SCRIPT = "setInterval(() => {}, 1000)";

  it("kills the idling child and reports earlySignal when check fires", async () => {
    const result = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", IDLE_SCRIPT],
      timeoutMs: 15_000,
      pollSignal: { intervalMs: 100, check: () => "successful" },
    });
    expect(result.earlySignal).toBe("successful");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeLessThan(15_000);
  });

  it("falls through to the timeout when check never fires", async () => {
    const result = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", IDLE_SCRIPT],
      timeoutMs: 1_500,
      pollSignal: { intervalMs: 100, check: () => null },
    });
    expect(result.earlySignal).toBeNull();
    expect(result.timedOut).toBe(true);
  }, 15_000);

  it("leaves earlySignal null on a normal exit without pollSignal", async () => {
    const result = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", "process.exit(0)"],
      timeoutMs: 15_000,
    });
    expect(result.earlySignal).toBeNull();
    expect(result.exitCode).toBe(0);
  });

  it("a throwing check is tolerated and does not kill the run", async () => {
    let calls = 0;
    const result = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", IDLE_SCRIPT],
      timeoutMs: 15_000,
      pollSignal: {
        intervalMs: 100,
        check: () => {
          calls += 1;
          if (calls < 3) throw new Error("transient fs race");
          return "successful";
        },
      },
    });
    expect(result.earlySignal).toBe("successful");
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("passes the spawned pid to check and awaits async checks without overlap", async () => {
    const seenPids: (number | undefined)[] = [];
    let inFlight = 0;
    let overlapped = false;
    const result = await runWorkbench({
      workbenchPath: tmpdir(),
      exePath: process.execPath,
      cwd: process.cwd(),
      args: ["-e", IDLE_SCRIPT],
      timeoutMs: 15_000,
      pollSignal: {
        intervalMs: 50,
        check: async ({ pid }) => {
          seenPids.push(pid);
          inFlight += 1;
          if (inFlight > 1) overlapped = true;
          await new Promise((r) => setTimeout(r, 200));
          inFlight -= 1;
          return seenPids.length >= 2 ? "successful" : null;
        },
      },
    });
    expect(result.earlySignal).toBe("successful");
    expect(overlapped).toBe(false);
    expect(seenPids.length).toBeGreaterThanOrEqual(2);
    for (const pid of seenPids) {
      expect(typeof pid).toBe("number");
      expect(pid).toBeGreaterThan(0);
    }
  });
});

describe("wb-validate-scripts: ValidateRunTracker", () => {
  let logsRoot: string;
  beforeAll(() => {
    logsRoot = mkdtempSync(join(tmpdir(), "wb-vs-tracker-"));
  });
  afterAll(() => {
    rmSync(logsRoot, { recursive: true, force: true });
  });

  it("reads console.log only once the session dir is discovered", async () => {
    const tracker = new ValidateRunTracker(logsRoot, snapshotSessionDirs(logsRoot));
    expect(tracker.readConsoleLog()).toBe("");
    const session = join(logsRoot, "logs_2026-08-31_16-00-00");
    mkdirSync(session);
    writeFileSync(join(session, "console.log"), "ENGINE : hello\n");
    await tracker.check({ pid: 1 });
    expect(tracker.sessionDir).toBe(session);
    expect(tracker.readConsoleLog()).toContain("hello");
  });

  it("gives the script.log verdict priority over the watchdog", async () => {
    const prior = snapshotSessionDirs(logsRoot);
    const session = join(logsRoot, "logs_2026-08-31_16-01-00");
    mkdirSync(session);
    writeFileSync(join(session, "script.log"), "SCRIPT : Script validation successful.\n");
    const tracker = new ValidateRunTracker(logsRoot, prior);
    tracker.watchdog = new LaunchWatchdog({
      readConsoleLog: () => {
        throw new Error("watchdog must not be consulted when a verdict exists");
      },
      nudge: async () => {
        throw new Error("unreachable");
      },
      inspectWindows: async () => {
        throw new Error("unreachable");
      },
    });
    expect(await tracker.check({ pid: 1 })).toBe("successful");
  });

  it("falls through to the watchdog while no verdict exists", async () => {
    const prior = snapshotSessionDirs(logsRoot);
    const session = join(logsRoot, "logs_2026-08-31_16-02-00");
    mkdirSync(session);
    writeFileSync(join(session, "console.log"), "no markers yet\n");
    const tracker = new ValidateRunTracker(logsRoot, prior);
    let ticked = 0;
    tracker.watchdog = {
      tick: async () => {
        ticked += 1;
        return null;
      },
    } as unknown as LaunchWatchdog;
    expect(await tracker.check({ pid: 1 })).toBeNull();
    expect(ticked).toBe(1);
  });
});

describe("wb-validate-scripts: diagnosis report builders", () => {
  const NUDGED: NudgeOutcome = {
    windowFound: true,
    windowTitle: "Enfusion Workbench Launcher",
    wasMinimized: true,
    restored: true,
    enterPosted: true,
    modalDetected: false,
    windowTitles: ["Enfusion Workbench Launcher"],
    error: null,
  };

  function watchdogWith(state: {
    nudge?: NudgeOutcome;
    final?: NudgeOutcome;
    cliParamsSeen?: boolean;
  }): LaunchWatchdog {
    const w = new LaunchWatchdog({
      readConsoleLog: () => "",
      nudge: async () => NUDGED,
      inspectWindows: async () => NUDGED,
    });
    if (state.nudge) w.nudgeOutcome = state.nudge;
    if (state.final) w.finalInspection = state.final;
    if (state.cliParamsSeen) w.cliParamsSeen = true;
    return w;
  }

  const DEP_CHECK_CLEAN: WbDepsCheck = {
    gprojPath: "C:\\proj\\addon.gproj",
    wbAddonsDir: "C:\\wbaddons",
    workshopDir: "C:\\workshop",
    findings: [
      {
        guid: "58D0FB3206B6F859",
        status: "wb-visible",
        locationKind: "base-game",
        gprojPath: "C:\\game\\addons\\data\\ArmaReforger.gproj",
      },
    ],
    allWbVisible: true,
    scannedRoots: [{ kind: "base-game", root: "C:\\game\\addons", addons: 2 }],
  };

  const DEP_CHECK_WORKSHOP_ONLY: WbDepsCheck = {
    ...DEP_CHECK_CLEAN,
    findings: [
      ...DEP_CHECK_CLEAN.findings,
      {
        guid: "5B0D1E4380971EBD",
        status: "workshop-only",
        workshopDirPath: "C:\\workshop\\COALITIONSquadInterface_5B0D1E4380971EBD",
      },
    ],
    allWbVisible: false,
  };

  it("launcher-picker stuck report explains the first-time picker and shows nudge evidence", () => {
    const text = buildStuckReport("stuck:launcher-picker", {
      gprojPath: "C:\\proj\\addon.gproj",
      platform: "PC",
      durationMs: 24_000,
      sessionDir: "C:\\logs\\logs_2026-08-31_15-31-14",
      logsRoot: "C:\\logs",
      watchdog: watchdogWith({ nudge: NUDGED, final: NUDGED }),
      consoleTail: "PROFILING : Workbench Create Engine took: 32.6 ms",
      depCheck: DEP_CHECK_CLEAN,
    });
    expect(text).toContain("held at its Projects picker");
    expect(text).toContain("declines to auto-open");
    expect(text).toContain("restored, Enter posted");
    expect(text).toContain("benign launcher picker hold");
    expect(text).toContain("logs_2026-08-31_15-31-14");
    expect(text).toContain("Workbench Create Engine took");
  });

  it("missing-deps stuck report carries the workshop copy remedy", () => {
    const text = buildStuckReport("stuck:missing-deps", {
      gprojPath: "C:\\proj\\addon.gproj",
      platform: "PC",
      durationMs: 24_000,
      sessionDir: null,
      logsRoot: "C:\\logs",
      watchdog: watchdogWith({
        nudge: { ...NUDGED, modalDetected: true, windowTitles: ["Missing Addon Dependencies"] },
      }),
      consoleTail: "",
      depCheck: DEP_CHECK_WORKSHOP_ONLY,
    });
    expect(text).toContain("Missing Addon Dependencies");
    expect(text).toContain("{5B0D1E4380971EBD}");
    expect(text).toContain("COALITIONSquadInterface_5B0D1E4380971EBD");
    expect(text).toContain('Copy each folder above into "C:\\wbaddons"');
  });

  it("pre-flight note fires only for non-visible deps (warn, never block)", () => {
    // A hard pre-launch block false-positives: launcher-registered projects
    // outside every scanned folder can resolve a dep (live-proven 2026-08-31).
    expect(buildPreflightNote(null)).toBeNull();
    expect(buildPreflightNote(DEP_CHECK_CLEAN)).toBeNull();
    const note = buildPreflightNote(DEP_CHECK_WORKSHOP_ONLY);
    expect(note).toContain("1 declared dep not found");
    expect(note).toContain("launcher-registered project");
    expect(note).toContain("workshop_check_deps");
  });

  it("timeout diagnostics distinguish accepted-but-slow from never-accepted", () => {
    const slow = buildTimeoutDiagnostics({
      watchdog: watchdogWith({ cliParamsSeen: true }),
      consoleTail: "",
      depCheck: DEP_CHECK_CLEAN,
    }).join("\n");
    expect(slow).toContain("WAS accepted");
    expect(slow).not.toContain("Launcher picker hold");

    const stuck = buildTimeoutDiagnostics({
      watchdog: watchdogWith({ nudge: { ...NUDGED, windowFound: false, windowTitles: [] } }),
      consoleTail: "tail here",
      depCheck: DEP_CHECK_WORKSHOP_ONLY,
    }).join("\n");
    expect(stuck).toContain("NOT seen");
    expect(stuck).toContain("no launcher-titled window");
    expect(stuck).toContain("{5B0D1E4380971EBD}");
    expect(stuck).toContain("tail here");
  });
});
