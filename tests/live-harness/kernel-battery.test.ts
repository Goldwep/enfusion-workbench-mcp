import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchError } from "../../src/workbench/client.js";
import { checkPlan, main as dryRunMain } from "../../scripts/live/dry-run.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { defaultPlaceholderContext, SANDBOX_NAME } from "../../scripts/live/paths.js";
import type { WatchReport } from "../../src/gui/modal-watchdog.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  EXIT,
  MODAL_ACTION,
  NEVER_FLAG,
  PLANT_FILE,
  PLANT_FOLDER,
  PROBE_API,
  buildActionPlan,
  buildSteps,
  acknowledge,
  main,
  plantTarget,
  runBattery,
  selectSteps,
  type KernelDeps,
  type KernelOptions,
} from "../live/kernel.live.js";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function tmp(): string {
  const r = mkdtempSync(join(tmpdir(), "kernel-battery-"));
  roots.push(r);
  return r;
}

const DIGEST = "abc123";

function modal(title: string, authorization: boolean, hwnd: number): WatchReport["modals"][number] {
  return {
    hwnd,
    title,
    className: "#32770",
    owned: true,
    buttons: ["OK"],
    basis: "baseline" as const,
    authorization,
    decision: { decision: "report-and-wait" as const, reason: "no rule" },
  };
}

function report(modals: WatchReport["modals"]): WatchReport {
  return {
    ok: true,
    pid: 4242,
    error: null,
    baselineTaken: false,
    windows: 1 + modals.length,
    policy: "default: report and wait",
    modals,
  };
}

const MAIN: WindowInfo = {
  hwnd: 10,
  pid: 4242,
  className: "QWindowIcon",
  title: "Workbench",
  owner: 0,
  enabled: true,
  rect: [0, 0, 1, 1],
  monitor: [0, 0, 1, 1],
  primary: true,
};

function dialog(title: string): WindowInfo {
  return { ...MAIN, hwnd: 11, className: "#32770", title, owner: 10 };
}

interface FakeOpts {
  scriptsCompiled?: boolean;
  projectFound?: boolean;
  projectName?: string;
  pingAfterRecovery?: boolean;
  reloadThrowsFirst?: boolean;
  /** The dialog the modal probe opens (default the probe modal). */
  modalTitle?: string;
  modalAuthorization?: boolean;
  /** The dialog stays open after the call ends. */
  leaveOpen?: boolean;
  /** A dialog is already open before the probe. */
  preDialog?: boolean;
  /** A reload raises a dialog that stays. */
  reloadDialog?: boolean;
  removeThrows?: boolean;
  secondNotRefused?: boolean;
}

function fake(o: FakeOpts = {}): { deps: KernelDeps; sent: string[]; files: Set<string> } {
  const sent: string[] = [];
  const files = new Set<string>();
  let clock = 1_000_000;
  let reloads = 0;
  let recovered = false;
  let open: string | null = o.preDialog ? "Some old dialog" : null;
  let watchesWhileOpen = 0;
  let closeCall: (() => void) | null = null;
  const probe = async (api: string, params: Record<string, unknown> = {}) => {
    sent.push(`probe:${api}${params.action ? `:${String(params.action)}` : ""}`);
    clock += 5;
    if (api === "IsWorkbenchRunning") return { ScriptsCompiled: o.scriptsCompiled ?? true };
    if (api === "EMCP_WB_Ping") {
      if (recovered && o.pingAfterRecovery === false)
        throw new WorkbenchError("refused", "CONNECTION_REFUSED");
      return { buildStamp: DIGEST };
    }
    if (api === "EMCP_WB_Info")
      return { projectFound: o.projectFound ?? true, projectName: o.projectName ?? SANDBOX_NAME };
    if (api === PROBE_API) {
      open = o.modalTitle ?? "ECEN probe modal";
      // The call returns when the "owner" closes the dialog (after two watches see it).
      await new Promise<void>((done) => (closeCall = done));
      return { ok: true };
    }
    return {};
  };
  const call = async (
    api: string,
    _p: Record<string, unknown> = {},
    opts: { access?: string } = {},
  ) => {
    sent.push(`call:${api}:${opts.access ?? "mutate"}`);
    if (api === "EMCP_WB_Ping") throw new WorkbenchError("refused", "CONNECTION_REFUSED");
    if (api === "ReloadScripts") {
      reloads++;
      if (reloads === 2) recovered = true;
      if (o.reloadDialog) open = "Script error";
      if (reloads === 1 && o.reloadThrowsFirst) throw new WorkbenchError("boom", "LOST");
      return { Result: "Compilation failed" };
    }
    return {};
  };
  const deps: KernelDeps = {
    client: { probe, call } as unknown as KernelDeps["client"],
    rawPing: async () => {
      sent.push("raw:EMCP_WB_Ping");
      return {
        ok: sent.length % 3 === 0,
        timedOut: false,
        bytesSent: 1,
        bytesReceived: 0,
        durationMs: 3,
      };
    },
    bundleDigest: () => DIGEST,
    workbenchPid: () => 4242,
    secondLease: async () =>
      o.secondNotRefused
        ? { code: 0, output: "lease acquired" }
        : { code: 1, output: "Lease held by v2-harness:p32 (purpose ...)" },
    watchdog: {
      watch: async () => {
        if (open === null) return report([]);
        const r = report([modal(open, o.modalAuthorization ?? false, 11)]);
        if (closeCall && ++watchesWhileOpen >= 2) {
          if (!o.leaveOpen) open = null;
          const c = closeCall;
          closeCall = null;
          c();
        }
        return r;
      },
    },
    listWindows: async () => (open === null ? [MAIN] : [MAIN, dialog(open)]),
    compileLogExcerpt: () => "SCRIPT (E): compile error",
    readText: (p) => readFileSync(p, "utf-8"),
    writeText: (p, t) => {
      files.add(p);
      writeFileSync(p, t, "utf-8");
    },
    removeFile: (p) => {
      if (o.removeThrows) throw new Error("EBUSY: locked");
      unlinkSync(p);
    },
    exists: (p) => existsSync(p),
    makeDir: (p) => mkdirSync(p, { recursive: true }),
    removeDirIfEmpty: (p) => {
      if (!existsSync(p) || readdirSync(p).length) return false;
      rmdirSync(p);
      return true;
    },
    now: () => (clock += 1),
    sleep: async () => {},
    log: () => {},
  };
  return { deps, sent, files };
}

function options(ownerPresent = true): KernelOptions {
  const root = tmp();
  const sandboxDir = join(root, SANDBOX_NAME);
  mkdirSync(sandboxDir, { recursive: true });
  return {
    runDir: join(root, "run"),
    sandboxDir,
    ownerPresent,
    evidenceDir: null,
    ph: defaultPlaceholderContext({}),
    build: "test",
  };
}

const IDS = buildSteps().map((s) => s.id);

describe("kernel battery: the plan", () => {
  it("passes the dry-run checker with the launch and no -scriptAuthorizeAll", () => {
    const plan = buildActionPlan();
    expect(checkPlan(plan, loadPolicy(), { script: "tests/live/kernel.live.ts" }).ok).toBe(true);
    const launch = plan.filter((a) => a.kind === "launch");
    expect(launch).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toContain(NEVER_FLAG);
  });

  it("holds exactly one dialog-capable call: the probe pack's modalTest, in the owner-present step", () => {
    const modal = buildActionPlan().filter(
      (a) => a.kind === "net-call" && a.target === PROBE_API,
    ) as Array<Record<string, unknown>>;
    expect(modal).toHaveLength(1);
    expect(modal[0].params).toEqual({ action: MODAL_ACTION });
    expect(modal[0].step).toBe("k-08-modal-watchdog");
    expect(
      buildSteps()
        .filter((s) => s.ownerPresent)
        .map((s) => s.id),
    ).toEqual(["k-08-modal-watchdog"]);
  });

  it("main's dry run writes a plan dry-run.ts accepts", async () => {
    const out = join(tmp(), "plan.json");
    const lines: string[] = [];
    expect(await main(["--out", out], { out: (l) => lines.push(l) })).toBe(EXIT.done);
    expect(lines.at(-1)).toBe("PASS");
    expect(dryRunMain([out, "--script", "tests/live/kernel.live.ts"])).toBe(0);
  });

  it("refuses -scriptAuthorizeAll and a real run without a held lease", async () => {
    expect(await main([NEVER_FLAG], { out: () => {} })).toBe(EXIT.usage);
    const o = options();
    expect(
      await main(["--really", "--id", "t1", "--sandbox", o.sandboxDir], {
        out: () => {},
        platform: "win32",
        leaseHeld: false,
      }),
    ).toBe(EXIT.refused);
  });

  it("refuses a run folder outside the artifacts folder", async () => {
    const o = options();
    const lines: string[] = [];
    const code = await main(
      ["--really", "--id", "t1", "--sandbox", o.sandboxDir, "--run-dir", join(tmp(), "elsewhere")],
      {
        out: (l) => lines.push(l),
        platform: "win32",
        leaseHeld: true,
        artifactsRoot: tmp(),
        deps: fake().deps,
      },
    );
    expect(code).toBe(EXIT.refused);
    expect(lines.join("\n")).toMatch(/artifacts folder/);
  });

  it("plans the launch with the scratch ini, as the runbook launches", () => {
    const launch = buildActionPlan().find((a) => a.kind === "launch") as unknown as {
      args: string[];
    };
    expect(launch.args).toContain("-forceSettings");
  });

  it("selects --only and --from, refuses both", () => {
    const steps = buildSteps();
    expect((selectSteps(steps, { only: "k-08-modal-watchdog" }) as unknown[]).length).toBe(1);
    expect((selectSteps(steps, { from: "k-09-u4-plant-reload" }) as unknown[]).length).toBe(2);
    expect(typeof selectSteps(steps, { from: "k-01-readiness", only: "k-02-build-stamp" })).toBe(
      "string",
    );
  });
});

describe("kernel battery: the run against a fake client", () => {
  it("runs every step in order and records each", async () => {
    const f = fake();
    const o = options();
    const r = await runBattery(buildSteps(), f.deps, o);
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => x.step)).toEqual(IDS);
    const by = Object.fromEntries(r.records.map((x) => [x.step, x]));
    expect(by["k-02-build-stamp"].status).toBe("pass");
    expect(by["k-03-sandbox-info"].evidence.negative).toMatchObject({ kind: "static" });
    expect(by["k-05-queue-burst"].status).toBe("pass");
    expect(by["k-06-mutate-no-retry"].status).toBe("pass");
    expect(by["k-07-lease-second"].status).toBe("pass");
    expect(by["k-08-modal-watchdog"].evidence).toMatchObject({
      pressed: false,
      policyWouldAnswer: false,
    });
    expect(by["k-10-u4-recovery"].evidence.recoveryReloadStillFails).toBe(true);
    for (const id of IDS) expect(existsSync(join(o.runDir, `${id}.json`))).toBe(true);
    // The planted copy is gone and so is the folder the battery made.
    expect(existsSync(join(o.sandboxDir, "Scripts", "WorkbenchGame", PLANT_FOLDER))).toBe(false);
    // The modal call went through probe (read), the mutate-marked Ping through call.
    expect(f.sent).toContain(`probe:${PROBE_API}:${MODAL_ACTION}`);
    expect(f.sent).toContain("call:EMCP_WB_Ping:mutate");
  });

  it("stops with a handoff and the compile log when ScriptsCompiled is false", async () => {
    const f = fake({ scriptsCompiled: false });
    const o = options();
    const r = await runBattery(buildSteps(), f.deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.records.map((x) => x.step)).toEqual(["k-01-readiness"]);
    expect(r.records[0].evidence.compileLog).toContain("compile error");
    expect(f.sent).toEqual(["probe:IsWorkbenchRunning"]);
  });

  // DEC-058: Info answers projectFound and projectName instead of isSandbox.
  it("aborts when Info does not say projectFound", async () => {
    const r = await runBattery(buildSteps(), fake({ projectFound: false }).deps, options());
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stoppedAt).toBe("k-03-sandbox-info");
  });

  it("aborts when Info names a project other than the test bed", async () => {
    const r = await runBattery(buildSteps(), fake({ projectName: "OtherMod" }).deps, options());
    expect(r.exit).toBe(EXIT.aborted);
    expect(r.stoppedAt).toBe("k-03-sandbox-info");
  });

  it("hands off before the modal step without --owner-present and writes no record for it", async () => {
    const o = options(false);
    const f = fake();
    const r = await runBattery(buildSteps(), f.deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.stoppedAt).toBe("k-08-modal-watchdog");
    expect(existsSync(join(o.runDir, "k-08-modal-watchdog.json"))).toBe(false);
    expect(f.sent.some((s) => s.includes(MODAL_ACTION))).toBe(false);
  });

  it("never runs a step twice in a run folder", async () => {
    const o = options();
    await runBattery(
      selectSteps(buildSteps(), { only: "k-07-lease-second" }) as never,
      fake().deps,
      o,
    );
    const r = await runBattery(
      selectSteps(buildSteps(), { only: "k-07-lease-second" }) as never,
      fake().deps,
      o,
    );
    expect(r.exit).toBe(EXIT.refused);
  });

  it("removes the plant even when the reload throws", async () => {
    const o = options();
    const steps = selectSteps(buildSteps(), { only: "k-09-u4-plant-reload" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake({ reloadThrowsFirst: true }).deps, o);
    expect(r.records[0].status).toBe("observed");
    expect(
      existsSync(join(o.sandboxDir, "Scripts", "WorkbenchGame", PLANT_FOLDER, PLANT_FILE)),
    ).toBe(false);
  });

  it("stops when the handlers are gone after the recovery reload (relaunch is the owner's)", async () => {
    const o = options();
    const steps = selectSteps(buildSteps(), { from: "k-09-u4-plant-reload" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake({ pingAfterRecovery: false }).deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.stoppedAt).toBe("k-10-u4-recovery");
    expect(r.message).toMatch(/relaunch is the owner's/);
  });

  it("refuses a plant target in the handler folder or outside the sandbox", () => {
    expect(typeof plantTarget(join(tmp(), "NotTheSandbox"))).toBe("string");
    const t = plantTarget(join(tmp(), SANDBOX_NAME));
    expect(typeof t).toBe("object");
    expect((t as { file: string }).file).toContain(PLANT_FOLDER);
    expect((t as { file: string }).file).not.toMatch(/EnfusionMCP|EnfusionCensus/);
  });

  it("k-08 stops when the window that opens is the authorization prompt, not the probe modal", async () => {
    const o = options();
    const steps = selectSteps(buildSteps(), { only: "k-08-modal-watchdog" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(
      steps,
      fake({ modalTitle: "Script Authorization Required", modalAuthorization: true }).deps,
      o,
    );
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/other than the probe modal/);
  });

  it("k-08 stops before the probe when a dialog is already open, and sends nothing", async () => {
    const f = fake({ preDialog: true });
    const steps = selectSteps(buildSteps(), { only: "k-08-modal-watchdog" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, f.deps, options());
    expect(r.exit).toBe(EXIT.stopped);
    expect(f.sent.some((x) => x.includes(MODAL_ACTION))).toBe(false);
  });

  it("k-08 hands off when the dialog is still open after the call", async () => {
    const steps = selectSteps(buildSteps(), { only: "k-08-modal-watchdog" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake({ leaveOpen: true }).deps, options());
    expect(r.exit).toBe(EXIT.handoff);
  });

  it("k-09 hands off on a dialog after the reload (the plant still removed)", async () => {
    const o = options();
    const steps = selectSteps(buildSteps(), { only: "k-09-u4-plant-reload" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake({ reloadDialog: true }).deps, o);
    expect(r.exit).toBe(EXIT.handoff);
    expect(
      existsSync(join(o.sandboxDir, "Scripts", "WorkbenchGame", PLANT_FOLDER, PLANT_FILE)),
    ).toBe(false);
  });

  it("k-09 stops with the reload evidence when the plant cannot be removed", async () => {
    const o = options();
    const steps = selectSteps(buildSteps(), { only: "k-09-u4-plant-reload" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake({ removeThrows: true }).deps, o);
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.records[0].evidence.removeError).toBeTruthy();
    expect(r.records[0].evidence.reload).toBeTruthy();
  });

  it("k-07 stops when the second process is not refused", async () => {
    const steps = selectSteps(buildSteps(), { only: "k-07-lease-second" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake({ secondNotRefused: true }).deps, options());
    expect(r.exit).toBe(EXIT.stopped);
    expect(r.message).toMatch(/-second/);
  });

  it("refuses a run folder with a dangling started marker until the owner acknowledges it", async () => {
    const o = options();
    mkdirSync(o.runDir, { recursive: true });
    writeFileSync(join(o.runDir, "k-07-lease-second.started"), "{}");
    const steps = selectSteps(buildSteps(), { only: "k-01-readiness" }) as ReturnType<
      typeof buildSteps
    >;
    const r = await runBattery(steps, fake().deps, o);
    expect(r.exit).toBe(EXIT.refused);
    expect(r.message).toMatch(/never recorded/);
    expect(acknowledge(o.runDir, "k-07-lease-second")).toMatch(/acknowledged/);
    expect((await runBattery(steps, fake().deps, o)).exit).toBe(EXIT.done);
    // The acknowledged step itself is never re-run.
    const again = selectSteps(buildSteps(), { only: "k-07-lease-second" }) as ReturnType<
      typeof buildSteps
    >;
    expect((await runBattery(again, fake().deps, o)).exit).toBe(EXIT.refused);
  });

  it("writes a started marker before each step", async () => {
    const o = options();
    const steps = selectSteps(buildSteps(), { only: "k-01-readiness" }) as ReturnType<
      typeof buildSteps
    >;
    await runBattery(steps, fake().deps, o);
    expect(existsSync(join(o.runDir, "k-01-readiness.started"))).toBe(true);
  });
});
