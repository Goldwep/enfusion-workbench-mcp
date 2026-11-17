import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkPlan, type PlanAction } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { SANDBOX_NAME } from "../../scripts/live/paths.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  EXIT,
  deriveId,
  validateLine,
  type LiveObservation,
  type WalkerDeps,
} from "../../scripts/census/live/common.js";
import { mergeObservations, run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  D14_STEP,
  LIST1,
  SCRIPT,
  dialogLines,
  l04Steps,
  list1Labels,
  main,
  type L04Kernel,
  type WalkDoc,
} from "../../scripts/census/live/L04-dialogs.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l04-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = join(__dirname, "fixtures", "live");
const OPTIONS_TEXT = readFileSync(join(FIX, "L04-options-walk.json"), "utf-8");
const LOGIN_TEXT = readFileSync(join(FIX, "L04-login-synthetic.json"), "utf-8");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const PID = 4242;
const MAIN_WIN: WindowInfo = {
  hwnd: 100,
  pid: PID,
  className: "Qt683QWindowIcon",
  title: "World Editor - tiny",
  owner: 0,
  enabled: true,
  rect: [0, 0, 10, 10],
  monitor: [],
  primary: true,
};
const dialogWin = (title: string, hwnd = 200): WindowInfo => ({
  ...MAIN_WIN,
  hwnd,
  title,
  owner: 100,
});

function policyWith(paths: string[][]): CensusPolicy {
  const p = JSON.parse(JSON.stringify(loadPolicy())) as CensusPolicy;
  (p.live_lane as Record<string, unknown>).dialog_openers = { paths };
  // The handler-side allow list must list each opener too (main adds them via gen-action-allowlist.ts).
  p.execute_action = {
    ...p.execute_action,
    allow_list: [...(p.execute_action?.allow_list ?? []), ...paths],
  };
  return p;
}
const LISTED = policyWith([
  ["File", "Options..."],
  ["Tools", "Validate Entities..."],
  ["File", "New World..."],
]);

function planOf(policy: CensusPolicy, flags: { ownerCloses?: boolean } = {}): PlanAction[] {
  return l04Steps(
    {
      policy,
      ownerCloses: flags.ownerCloses === true,
      ownerDone: false,
      kernel: () => {
        throw new Error("no kernel in a plan");
      },
    },
    { module: "WorldEditor" },
  ).flatMap((s) => s.plan({ module: "WorldEditor", state: {}, allowOwned: true }));
}

function assertNoForbidden(plan: PlanAction[], policy: CensusPolicy): void {
  const l1 = list1Labels(policy).map((l) => l.toLowerCase());
  for (const a of plan) {
    expect(["key", "invoke", "menu-open", "net-call"]).not.toContain(a.kind);
    expect(JSON.stringify(a)).not.toMatch(/"(Enter|Return|\{ENTER\})"/);
    if (a.kind === "execute-action") {
      const p = (a.target as { path: string[] }).path.map((x) =>
        x.replace(/\.\.\.$/, "").toLowerCase(),
      );
      for (const seg of p) expect(l1).not.toContain(seg);
      expect(a.opensDialog).toBe(true);
    }
    if (a.kind === "uia-dialog-cancel") expect(a.button).toBe("Cancel");
    if (a.kind === "uia-read")
      expect((a.target as { window: { allowOwned: boolean } }).window.allowOwned).toBe(true);
  }
}

describe("L04 plan", () => {
  it("passes checkPlan on the committed policy, D14 first and blocked until main lists the opener", () => {
    const policy = loadPolicy();
    const steps = l04Steps(
      { policy, ownerCloses: false, ownerDone: false, kernel: () => ({}) as L04Kernel },
      { module: "WorldEditor" },
    );
    expect(steps[0].id).toBe(D14_STEP);
    const plan = planOf(policy);
    expect(checkPlan(plan, policy, { script: SCRIPT }).ok).toBe(true);
    assertNoForbidden(plan, policy);
  });

  it("with the openers listed: D14 opens, reads and cancels; New World never plans; others hand off", () => {
    const steps = l04Steps(
      { policy: LISTED, ownerCloses: false, ownerDone: false, kernel: () => ({}) as L04Kernel },
      { module: "WorldEditor" },
    );
    expect(steps.map((s) => s.id)).toEqual([
      D14_STEP,
      "p4-l04-open-tools-validate-entities",
      ...LIST1.map((d) => `p4-l04-l1-${d.slug}`),
    ]);
    const d14 = steps[0]
      .plan({ module: "WorldEditor", state: {}, allowOwned: true })
      .map((a) => a.kind);
    expect(d14).toEqual(["execute-action", "uia-read", "uia-dialog-cancel"]);
    // Validate Entities has no cancel exception: no scripted Cancel, the owner closes it.
    expect(
      steps[1].plan({ module: "WorldEditor", state: {}, allowOwned: true }).map((a) => a.kind),
    ).toEqual(["execute-action", "uia-read"]);
    for (const s of steps.slice(2))
      expect(
        s.plan({ module: "WorldEditor", state: {}, allowOwned: true }).map((a) => a.kind),
      ).toEqual(["uia-read"]);
    const plan = planOf(LISTED);
    expect(checkPlan(plan, LISTED, { script: SCRIPT }).ok).toBe(true);
    assertNoForbidden(plan, LISTED);
  });

  it("every list 1 opener is on the policy's Appendix B list 1", () => {
    const l1 = list1Labels(loadPolicy());
    for (const d of LIST1) expect(l1).toContain(d.opener);
  });
});

describe("L04 node-to-row mapping", () => {
  const doc = JSON.parse(OPTIONS_TEXT) as WalkDoc;
  const lines = dialogLines({ doc, sha256: sha(OPTIONS_TEXT), module: "Shared", title: "Options" });
  it("Options gives the dialog, 7 tabs, its controls; every line conformant", () => {
    for (const l of lines) expect(validateLine(l, "L04")).toEqual([]);
    const ids = lines.map((l) => deriveId(l));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("ui:Shared/dialog/Options");
    expect(lines.filter((l) => l.kind === "tab").map((l) => l.label_raw)).toEqual([
      "General",
      "World Editor",
      "Animation Editor",
      "Script Editor",
      "Audio Editor",
      "Behavior Editor",
      "Shortcuts",
    ]);
    // Tabs get no children (page controls hang off the dialog): no count, so they stay on the frontier.
    expect(lines.filter((l) => l.kind === "tab").every((l) => l.children_count === undefined)).toBe(
      true,
    );
    const sc = lines.find((l) => l.label_raw === "Shortcuts")!;
    expect(deriveId(sc)).toBe("ui:Shared/tab/Options/Shortcuts");
    expect(sc.ref).toBe(`artifact:${sha(OPTIONS_TEXT)}#n/0/1/6`);
    expect(sc.parent_key).toEqual({
      dim: "ui",
      kind: "dialog",
      module: "Shared",
      key: { path: ["Options"] },
    });
    const ok = lines.find((l) => l.label_raw === "OK")!;
    expect(ok.risk_commit_hint).toBe("mutating");
    expect(lines.find((l) => l.label_raw === "Cancel")!.risk_hint).toBe("safe");
    // The Shortcuts grid (392 rows) is sampled: a row, no children_count, no item rows.
    const grid = lines.find((l) => l.kind === "property-group")!;
    expect(grid.children_count).toBeUndefined();
    expect(lines.some((l) => l.label_raw === "Move Forward")).toBe(false);
    // Chrome gives no row.
    expect(lines.some((l) => l.label_raw === "System" || l.label_raw === "Close")).toBe(false);
    const dialog = lines.find((l) => l.kind === "dialog")!;
    expect(dialog.children_count).toBe(lines.filter((l) => l.parent_key?.kind === "dialog").length);
  });

  it("Login: credential fields recorded passively, labels folded from the Text beside them", () => {
    const ld = JSON.parse(LOGIN_TEXT) as WalkDoc;
    const ll = dialogLines({
      doc: ld,
      sha256: sha(LOGIN_TEXT),
      module: "WorldEditor",
      title: "Login",
      credential: true,
    });
    for (const l of ll) expect(validateLine(l, "L04")).toEqual([]);
    const edits = ll.filter((l) => l.locator?.controlType === "Edit");
    expect(edits.map((l) => l.label_raw)).toEqual(["User name", "Password"]);
    for (const e of edits) expect(e.risk_hint).toBe("credential");
  });

  it("the merged lines pass normalise (mergeObservations and --check)", () => {
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const r = mergeObservations([{ source: "fake", text }], {
      enumerator: "L04",
      build: "1.8.0.13",
      def: { generator: SCRIPT },
    });
    expect(r.rejected).toEqual([]);
    const data = join(TMP, "data");
    mkdirSync(data, { recursive: true });
    writeFileSync(
      join(data, "universes.json"),
      readFileSync(join(__dirname, "..", "..", "data", "census", "universes.json")),
    );
    const raw = join(TMP, "L04-WorldEditor-x.obs.jsonl");
    writeFileSync(raw, text);
    const quiet = { out: () => undefined, err: () => undefined };
    expect(
      runNormalise(
        ["--enumerator", "L04", "--build", "1.8.0.13", "--data", data, "--fresh", raw],
        quiet,
      ),
    ).toBe(0);
    expect(
      runNormalise(
        ["--enumerator", "L04", "--build", "1.8.0.13", "--data", data, "--fresh", "--check", raw],
        quiet,
      ),
    ).toBe(0);
  });
});

// ── Driving the script against fakes ─────────────────────────────────────────

interface World {
  ws: WindowInfo[];
  calls: string[];
  onOpen?: () => void;
  extraOnWalk?: WindowInfo;
}

function fakes(world: World): { deps: WalkerDeps; kernel: L04Kernel } {
  const deps: WalkerDeps = {
    windows: async () => world.ws.slice(),
    sleep: () => new Promise((r) => setImmediate(r)),
    now: () => Date.now(),
    recordedPid: () => PID,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: existsSync,
    writeFile: (p, t, ex) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t, { flag: ex ? "wx" : "w" });
    },
    appendFile: (p, t) => {
      mkdirSync(dirname(p), { recursive: true });
      appendFileSync(p, t);
    },
    log: () => undefined,
  };
  const kernel: L04Kernel = {
    windows: async () => world.ws.slice(),
    open: async (_m, path) => {
      world.calls.push(`open ${path.join(" > ")}`);
      (world.onOpen ?? (() => world.ws.push(dialogWin("Options"))))();
      return { ok: true };
    },
    walk: async (t, out) => {
      world.calls.push(`walk ${t.titlePattern}`);
      if (world.extraOnWalk) world.ws.push(world.extraOnWalk);
      const text = /Login/.test(t.titlePattern) ? LOGIN_TEXT : OPTIONS_TEXT;
      return { doc: JSON.parse(text) as WalkDoc, path: out, sha256: sha(text) };
    },
    cancel: async (t) => {
      world.calls.push(`cancel ${t.hwnd}`);
      world.ws = world.ws.filter((w) => w.hwnd !== t.hwnd);
      return { invoked: true, detail: "fake" };
    },
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
  };
  return { deps, kernel };
}

let runN = 0;
async function drive(world: World, args: string[], policy: CensusPolicy = LISTED) {
  const runDir = join(TMP, "artifacts", `run-${++runN}`);
  const { deps, kernel } = fakes(world);
  const out: string[] = [];
  const code = await main(
    [
      "--really",
      "--id",
      "lane",
      "--sandbox",
      join(TMP, SANDBOX_NAME),
      "--run-dir",
      runDir,
      "--module",
      "WorldEditor",
      ...args,
    ],
    {
      deps,
      kernel,
      policy,
      platform: "win32",
      leaseHeld: true,
      artifactsRoot: join(TMP, "artifacts"),
      evidenceDir: null,
      out: (l) => out.push(l),
    },
  );
  return {
    code,
    runDir,
    out,
    again: () =>
      main(
        [
          "--really",
          "--id",
          "lane",
          "--sandbox",
          join(TMP, SANDBOX_NAME),
          "--run-dir",
          runDir,
          "--module",
          "WorldEditor",
          ...args,
        ],
        {
          deps,
          kernel,
          policy,
          platform: "win32",
          leaseHeld: true,
          artifactsRoot: join(TMP, "artifacts"),
          evidenceDir: null,
          out: (l) => out.push(l),
        },
      ),
  };
}

function obsLines(runDir: string): LiveObservation[] {
  const f = readdirSync(runDir).filter((n) => n.endsWith(".obs.jsonl"));
  return f.flatMap((n) =>
    readFileSync(join(runDir, n), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LiveObservation),
  );
}

describe("L04 run against fakes", () => {
  it("--really needs --allow-owned", async () => {
    const r = await drive({ ws: [MAIN_WIN], calls: [] }, ["--only", D14_STEP]);
    expect(r.code).toBe(EXIT.usage);
  });

  it("D14 is refused before any marker while it is blocked", async () => {
    const world = { ws: [MAIN_WIN], calls: [] };
    // Blocked = File > Options... not on dialog_openers.paths (main listed it; empty it here).
    const p = structuredClone(loadPolicy());
    (p.live_lane!.dialog_openers as { paths: string[][] }).paths = [];
    const r = await drive(world, ["--allow-owned", "--only", D14_STEP], p);
    expect(r.code).toBe(EXIT.refused);
    expect(world.calls).toEqual([]);
    expect(existsSync(r.runDir)).toBe(false);
  });

  it("D14 is blocked and refused while File > Options... is not on execute_action.allow_list", async () => {
    const world = { ws: [MAIN_WIN], calls: [] };
    const p = policyWith([["File", "Options..."]]);
    p.execute_action = {
      ...p.execute_action,
      allow_list: (p.execute_action?.allow_list ?? []).filter(
        (e) => !(Array.isArray(e) && e[0] === "File"),
      ),
    };
    const d14 = l04Steps(
      { policy: p, ownerCloses: false, ownerDone: false, kernel: () => ({}) as never },
      { module: "WorldEditor" },
    ).find((s) => s.id === D14_STEP)!;
    expect(d14.title).toContain("NOT_ALLOWLISTED");
    expect(d14.plan({ module: "WorldEditor", state: {}, allowOwned: true })).toEqual([]);
    const r = await drive(world, ["--allow-owned", "--only", D14_STEP], p);
    expect(r.code).toBe(EXIT.refused);
    expect(world.calls).toEqual([]);
  });

  it("D14: open, walk, Cancel, gone: pass; conformant obs; never run twice", async () => {
    const world: World = { ws: [MAIN_WIN], calls: [] };
    const r = await drive(world, ["--allow-owned", "--only", D14_STEP]);
    expect(r.code).toBe(EXIT.done);
    expect(world.calls).toEqual(["open File > Options...", "walk ^Options$", "cancel 200"]);
    const rec = JSON.parse(readFileSync(join(r.runDir, `${D14_STEP}.json`), "utf-8")) as {
      status: string;
    };
    expect(rec.status).toBe("pass");
    expect(existsSync(join(r.runDir, `${D14_STEP}.started`))).toBe(true);
    const lines = obsLines(r.runDir);
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(validateLine(l, "L04")).toEqual([]);
    expect(await r.again()).toBe(EXIT.refused);
    expect(world.calls.length).toBe(3);
  });

  it("an unexpected new window during D14 is a STOP: no Cancel sent", async () => {
    const world: World = {
      ws: [MAIN_WIN],
      calls: [],
      extraOnWalk: { ...MAIN_WIN, hwnd: 300, className: "Odd", title: "x" },
    };
    const r = await drive(world, ["--allow-owned", "--only", D14_STEP]);
    expect(r.code).toBe(EXIT.stopped);
    expect(world.calls.some((c) => c.startsWith("cancel"))).toBe(false);
  });

  it("another dialog during D14 is a HANDOFF", async () => {
    const world: World = {
      ws: [MAIN_WIN],
      calls: [],
      onOpen: () =>
        world.ws.push(dialogWin("Options"), dialogWin("Script Authorization Required", 301)),
    };
    const r = await drive(world, ["--allow-owned", "--only", D14_STEP]);
    expect(r.code).toBe(EXIT.handoff);
    expect(world.calls.some((c) => c.startsWith("cancel"))).toBe(false);
  });

  it("a dialog already up refuses the step (baseline)", async () => {
    const world: World = { ws: [MAIN_WIN, dialogWin("Options")], calls: [] };
    const r = await drive(world, ["--allow-owned", "--only", D14_STEP]);
    expect(r.code).toBe(EXIT.handoff);
    expect(world.calls).toEqual([]);
  });

  it("an opener step hands off for the owner's Cancel after its walk", async () => {
    const world: World = {
      ws: [MAIN_WIN],
      calls: [],
      onOpen: () => world.ws.push(dialogWin("Validate Entities")),
    };
    const r = await drive(world, [
      "--allow-owned",
      "--only",
      "p4-l04-open-tools-validate-entities",
    ]);
    expect(r.code).toBe(EXIT.handoff);
    expect(world.calls.some((c) => c.startsWith("cancel"))).toBe(false);
    expect(r.out.join("\n")).toMatch(/OWNER: press Cancel/);
  });

  it("list 1 needs --owner-done; with it the step waits, walks, hands off; nothing opened or cancelled", async () => {
    const w1: World = { ws: [MAIN_WIN], calls: [] };
    const r1 = await drive(w1, ["--allow-owned", "--only", "p4-l04-l1-login"]);
    expect(r1.code).toBe(EXIT.refused);
    expect(existsSync(r1.runDir)).toBe(false);

    const w2: World = { ws: [MAIN_WIN], calls: [] };
    let polls = 0;
    const r2p = drive(w2, ["--allow-owned", "--owner-done", "--only", "p4-l04-l1-login"]);
    // The owner clicks Login a moment later.
    const t = setInterval(() => {
      if (++polls === 3) w2.ws.push(dialogWin("Login"));
    }, 5);
    const r2 = await r2p;
    clearInterval(t);
    expect(r2.code).toBe(EXIT.handoff);
    expect(w2.calls).toEqual(["walk ^Login$"]);
    const lines = obsLines(r2.runDir);
    expect(lines.filter((l) => l.risk_hint === "credential").length).toBe(2);
    for (const l of lines) expect(validateLine(l, "L04")).toEqual([]);
  });
});
