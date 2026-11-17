import { afterAll, describe, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import {
  EXIT,
  buildWalkerQueue,
  deriveId,
  runWalker,
  runWalkerSteps,
  validateLine,
  type LiveObservation,
  type WalkerDeps,
  type WalkerOptions,
  type WalkerStep,
} from "../../scripts/census/live/common.js";
import { run as runNormalise } from "../../scripts/census/live/normalise.js";
import {
  MENUS_STEP,
  SCRIPT,
  WALK_STEP,
  def,
  launcherMenuTitles,
  launcherSteps,
  menuLines,
  menuTitlesOf,
  walkToLines,
  type LauncherKernel,
  type MenusDoc,
  type WalkDoc,
} from "../../scripts/census/live/L14-launcher.js";

const TMP = mkdtempSync(join(tmpdir(), "emcp-p4-l14-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const FIX = join(__dirname, "fixtures", "live");
const walkDoc = JSON.parse(readFileSync(join(FIX, "L14-launcher-walk.json"), "utf-8")) as WalkDoc;
const menusDoc = JSON.parse(
  readFileSync(join(FIX, "L14-launcher-menus.json"), "utf-8"),
) as MenusDoc;
const SHA_W = "a".repeat(64);
const SHA_M = "b".repeat(64);
const SEL = { module: "Launcher", allowOwned: false };
const PSEL = { module: "Launcher", state: {}, allowOwned: false };

const policyWith = (titles: string[] | null): CensusPolicy => {
  const p = JSON.parse(JSON.stringify(loadPolicy())) as CensusPolicy;
  const um = p.live_lane!.uia_menu as { titles_by_module: Record<string, string[]> };
  if (titles) um.titles_by_module.Launcher = titles;
  return p;
};

function fakeKernel(over: Partial<LauncherKernel> = {}): LauncherKernel & { calls: string[] } {
  const k = {
    calls: [] as string[],
    async walk() {
      k.calls.push("walk");
      return { doc: walkDoc, sha256: SHA_W };
    },
    async menus(a: { titles: string[] }) {
      k.calls.push(`menus:${a.titles.join(",")}`);
      return { doc: menusDoc, sha256: SHA_M };
    },
    readWalk: () => walkDoc,
    ...over,
  };
  return k as LauncherKernel & { calls: string[] };
}

const win = (title: string, hwnd: number, cls = "Qt683QWindowIcon", owner = 0): WindowInfo => ({
  hwnd,
  pid: 4242,
  className: cls,
  title,
  owner,
  enabled: true,
  rect: [0, 0, 1, 1],
  monitor: [0, 0, 1, 1],
  primary: true,
});

function fakeDeps(files: Map<string, string>, windows: () => WindowInfo[] = () => []) {
  const order: string[] = [];
  const d: WalkerDeps & { order: string[] } = {
    order,
    windows: async () => windows(),
    sleep: async () => undefined,
    now: () => 1_760_000_000_000,
    recordedPid: () => 4242,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    exists: (p) => files.has(p),
    writeFile: (p, t, exclusive) => {
      if (exclusive && files.has(p)) throw new Error("exists");
      order.push(`write:${p.replace(/\\/g, "/").split("/").pop()}`);
      files.set(p, t);
    },
    appendFile: (p, t) => files.set(p, (files.get(p) ?? "") + t),
    log: () => undefined,
  };
  return d;
}

const opts = (runDir: string): WalkerOptions => ({
  enumerator: "L14",
  script: SCRIPT,
  session: "P4-7",
  runDir,
  module: "Launcher",
  state: { mode: "edit", selection: "none" },
  allowOwned: false,
  evidenceDir: null,
  ph: { v2: "/nowhere" },
  build: "test",
});

const obsOf = (files: Map<string, string>): LiveObservation[] =>
  [...files.entries()]
    .filter(([k]) => k.endsWith(".obs.jsonl"))
    .flatMap(([, t]) =>
      t
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LiveObservation),
    );

/** A step whose body only waits, so the window poller decides the outcome. */
const waiting = (s: WalkerStep): WalkerStep => ({
  ...s,
  run: async (ctx) => {
    await ctx.sleep(1);
    return { status: "pass", summary: "" };
  },
});

describe("L14 plan", () => {
  it("holds only a uia-read while the policy has no Launcher titles, and passes the checker", () => {
    const policy = policyWith(null);
    expect(launcherMenuTitles(policy)).toBeNull();
    const steps = launcherSteps(fakeKernel(), policy)(SEL);
    expect(steps.map((s) => s.id)).toEqual([WALK_STEP, MENUS_STEP]);
    const plan = steps.flatMap((s) => s.plan(PSEL));
    expect(plan.map((a) => a.kind)).toEqual(["uia-read"]);
    expect(checkPlan(plan, policy, { script: SCRIPT }).ok).toBe(true);
  });
  it("adds one Expand/Collapse-only uia-menu once the policy lists Launcher titles", () => {
    const policy = policyWith(["File", "Help"]);
    const plan = launcherSteps(fakeKernel(), policy)(SEL).flatMap((s) => s.plan(PSEL));
    expect(plan.map((a) => a.kind)).toEqual(["uia-read", "uia-menu"]);
    expect(plan[1]).toMatchObject({ module: "Launcher", calls: ["Expand", "Collapse"], depth: 1 });
    expect(checkPlan(plan, policy, { script: SCRIPT }).ok).toBe(true);
  });
  it("holds no forbidden action: no key, Enter, invoke, ExecuteAction, net-call, launch or typing", () => {
    for (const titles of [null, ["File", "Help"]]) {
      const policy = policyWith(titles);
      const plan = launcherSteps(
        fakeKernel(),
        policy,
      )({ module: "Launcher", allowOwned: true }).flatMap((s) =>
        s.plan({ module: "Launcher", state: {}, allowOwned: true }),
      );
      expect(plan.every((a) => a.kind === "uia-read" || a.kind === "uia-menu")).toBe(true);
      expect(JSON.stringify(plan)).not.toMatch(
        /"key"|"keys"|enter|invoke|execute-action|net-call|"launch"|-gproj|type/i,
      );
    }
    const walk = launcherSteps(fakeKernel(), policyWith(null))(SEL)[0];
    expect(walk.plan(PSEL)[0]).toMatchObject({ readOnly: true });
  });
  it("orders steps read-only then reversible, as validateQueue requires", () => {
    const steps = launcherSteps(fakeKernel(), policyWith(null))(SEL);
    expect(steps.map((s) => s.risk)).toEqual(["read-only", "reversible"]);
    expect(steps[1].popups).toBe(true);
    expect(steps[0].popups).toBeUndefined();
    const queue = buildWalkerQueue(def, steps);
    expect(validateQueue(queue, false)).toHaveLength(2);
    expect(queue.session).toBe("P4-7");
  });
  it("the CLI dry run prints PASS and writes the plan", async () => {
    const out = join(TMP, "plan.json");
    const said: string[] = [];
    const code = await runWalker(def, ["--out", out, "--outline", join(TMP, "o.txt")], {
      out: (l) => said.push(l),
    });
    expect(code).toBe(EXIT.done);
    expect(said.join("\n")).toContain("PASS");
    const plan = JSON.parse(readFileSync(out, "utf-8"));
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT }).ok).toBe(true);
  });
});

describe("L14 mapping", () => {
  const m = walkToLines(walkDoc, SHA_W);
  const ids = m.lines.map((l) => deriveId(l));
  it("emits module Launcher lines that pass validateLine, with state {}", () => {
    expect(m.lines.length).toBeGreaterThan(5);
    for (const l of m.lines) {
      expect(validateLine(l, "L14")).toEqual([]);
      expect(l.module).toBe("Launcher");
      expect(l.observed_state).toEqual({});
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("window root, menu titles, controls; chrome and system menu skipped; list rows deferred", () => {
    expect(ids[0]).toBe("ui:Launcher/window/#EnfusionLauncher");
    expect(m.lines[0].kind).toBe("window");
    expect(m.lines[0].parent_key).toBeNull();
    expect(m.menuTitles).toEqual(["File", "Help", "Mystery"]);
    const titles = m.lines
      .filter((l) => l.kind === "menu")
      .map((l) => (l.key as { path: string[] }).path[0]);
    expect(titles).toEqual(["File", "Help", "Mystery"]);
    for (const gone of ["Close", "System", "<project>"])
      expect(m.lines.some((l) => l.label_raw === gone)).toBe(false);
    const why = Object.keys(m.skipped).join("|");
    expect(why).toMatch(/TitleBar/);
    expect(why).toMatch(/sampled/);
  });
  it("a credential field is recorded passively; a destructive button carries a commit hint", () => {
    expect(m.lines.find((l) => l.label_raw === "Password")?.risk_hint).toBe("credential");
    expect(m.lines.find((l) => l.label_raw === "Remove")?.risk_commit_hint).toBe("destructive");
    expect(m.lines.find((l) => l.label_raw === "Browse...")?.modal).toBe("opens");
    expect(m.lines.find((l) => l.label_raw === "Open")?.risk_commit_hint).toBe("mutating");
  });
  it("the window has no children_count while chrome children were skipped", () => {
    expect(m.lines[0].children_count).toBeUndefined();
  });
  it("a duplicate label under one parent gets an ordinal and low confidence", () => {
    const doc = JSON.parse(JSON.stringify(walkDoc)) as WalkDoc;
    for (let i = 0; i < 2; i++)
      doc.tree!.children!.push({
        controlType: "Button",
        name: "Remove",
        automationId: "x.QPushButton",
        className: "QPushButton",
        childCount: 0,
      });
    doc.tree!.childCount = doc.tree!.children!.length;
    const mm = walkToLines(doc, SHA_W);
    const mids = mm.lines.map((l) => deriveId(l));
    expect(new Set(mids).size).toBe(mids.length);
    expect(mm.lines.filter((l) => l.label_raw === "Remove").pop()!.confidence).toBe("low");
  });
  it("menuLines: items, accelerator, submenu, children_count on the title row, empty names dropped", () => {
    const r = menuLines(menusDoc, SHA_M, m.lines[0]);
    for (const l of r.lines) expect(validateLine(l, "L14")).toEqual([]);
    expect(r.lines.find((l) => l.kind === "menu" && l.label_raw === "File")?.children_count).toBe(
      1,
    );
    expect(r.lines.find((l) => l.label_raw === "Exit")).toMatchObject({
      kind: "menu-item",
      shortcut_default: "Alt+F4",
    });
    expect(r.lines.find((l) => l.label_raw === "Documentation")?.kind).toBe("menu");
    expect(menuTitlesOf(walkDoc)).toEqual(["File", "Help", "Mystery"]);
    const bare = menuLines(
      { menus: [{ title: "File", opened: true, items: [{ controlType: "Menu", name: "" }] }] },
      SHA_M,
      m.lines[0],
    );
    const twice = menuLines(
      {
        menus: [
          {
            title: "File",
            opened: true,
            items: [
              { controlType: "MenuItem", name: "Open" },
              { controlType: "MenuItem", name: "Open" },
            ],
          },
        ],
      },
      SHA_M,
      m.lines[0],
    );
    expect(twice.lines.filter((l) => l.label_raw === "Open")).toHaveLength(1);
    expect(twice.lines.find((l) => l.label_raw === "Open")?.ref).toBe(
      `artifact:${SHA_M}#m/File/Open`,
    );
    expect(twice.lines[0].unverified?.[0]).toMatch(/appears twice/);
    expect(twice.lines[0].children_count).toBeUndefined();
    expect(bare.lines[0].children_count).toBeUndefined();
    expect(bare.lines[0].unverified?.[0]).toMatch(/not readable/);
  });
});

describe("L14 run on fakes", () => {
  it("runs walk then menus; .started precedes the first record; lines validate and merge", async () => {
    const k = fakeKernel();
    const files = new Map<string, string>();
    const d = fakeDeps(files);
    const steps = launcherSteps(k, policyWith(["File", "Help"]))(SEL);
    const r = await runWalkerSteps(steps, d, opts("/run"));
    expect(r.exit).toBe(EXIT.done);
    expect(r.records.map((x) => [x.step, x.status])).toEqual([
      [WALK_STEP, "pass"],
      [MENUS_STEP, "pass"],
    ]);
    expect(k.calls).toEqual(["walk", "menus:File,Help"]);
    expect(d.order.indexOf("write:p4-l14-walk.started")).toBeLessThan(
      d.order.indexOf("write:p4-l14-walk.json"),
    );
    expect(d.order.indexOf("write:p4-l14-walk.json")).toBeLessThan(
      d.order.indexOf("write:p4-l14-menus.started"),
    );
    const lines = obsOf(files);
    for (const l of lines) expect(validateLine(l, "L14")).toEqual([]);
    expect(
      [...files.keys()].some((p) =>
        p.replace(/\\/g, "/").endsWith("L14-Launcher-edit-none.obs.jsonl"),
      ),
    ).toBe(true);
    // normalise.ts: merge, then --check, with the title row's later line (children_count) winning.
    const dir = join(TMP, "data");
    mkdirSync(join(dir, "observations"), { recursive: true });
    cpSync(
      join(__dirname, "..", "..", "data", "census", "universes.json"),
      join(dir, "universes.json"),
    );
    const raw = join(TMP, "L14-raw.obs.jsonl");
    writeFileSync(raw, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const quiet = { out: () => undefined, err: () => undefined };
    const base = ["--enumerator", "L14", "--build", "t", "--data", dir, "--fresh"];
    expect(runNormalise([...base, raw], quiet)).toBe(0);
    expect(runNormalise([...base, "--check", raw], quiet)).toBe(0);
    const target = join(dir, "observations", "L14", "t.jsonl");
    expect(existsSync(target)).toBe(true);
    const merged = readFileSync(target, "utf-8")
      .split("\n")
      .filter(Boolean)
      .slice(1)
      .map((l) => JSON.parse(l) as LiveObservation);
    expect(merged.find((l) => l.kind === "menu" && l.label_raw === "File")?.children_count).toBe(1);
  });
  it("with no policy titles, the menu step opens nothing and says why", async () => {
    const k = fakeKernel();
    const r = await runWalkerSteps(
      launcherSteps(k, policyWith(null))(SEL),
      fakeDeps(new Map()),
      opts("/run2"),
    );
    expect(r.exit).toBe(EXIT.done);
    expect(k.calls).toEqual(["walk"]);
    expect(r.records[1].status).toBe("observed");
    expect(r.records[1].summary).toMatch(/absent/);
  });
  it("a title outside the policy list is not opened", async () => {
    const k = fakeKernel();
    const r = await runWalkerSteps(
      launcherSteps(k, policyWith(["File"]))(SEL),
      fakeDeps(new Map()),
      opts("/run3"),
    );
    expect(k.calls).toEqual(["walk", "menus:File"]);
    expect(r.records[1].summary).toMatch(/not opened: Help, Mystery/);
  });
  it("F22: an allow-listed title outside the Resource Manager's eight is opened; the list goes as allowed", async () => {
    const seen: Array<readonly string[]> = [];
    const k = fakeKernel({
      menus: async (a) => {
        seen.push(a.allowed);
        k.calls.push(`menus:${a.titles.join(",")}`);
        return { doc: menusDoc, sha256: SHA_M };
      },
    });
    await runWalkerSteps(
      launcherSteps(k, policyWith(["File", "Mystery"]))(SEL),
      fakeDeps(new Map()),
      opts("/run-f22"),
    );
    expect(k.calls).toEqual(["walk", "menus:File,Mystery"]);
    expect(seen).toEqual([["File", "Mystery"]]);
  });
  it("a menu popup left open is a HANDOFF with the owner Esc text", async () => {
    const k = fakeKernel({
      menus: async () => ({ doc: { ...menusDoc, leftOpen: [["File"]] }, sha256: SHA_M }),
    });
    const r = await runWalkerSteps(
      launcherSteps(k, policyWith(["File", "Help"]))(SEL),
      fakeDeps(new Map()),
      opts("/run4"),
    );
    expect(r.exit).toBe(EXIT.handoff);
    expect(r.message).toMatch(/Esc once by hand/);
  });
  it("a new editor window stops the walk; a dialog hands off; a stopped step is never retried", async () => {
    let n = 0;
    const walk = launcherSteps(fakeKernel(), policyWith(null))(SEL)[0];
    const d = fakeDeps(new Map(), () => (n++ > 0 ? [win("World Editor - x", 9)] : []));
    expect((await runWalkerSteps([waiting(walk)], d, opts("/run5"))).exit).toBe(EXIT.stopped);
    const again = await runWalkerSteps(
      launcherSteps(fakeKernel(), policyWith(null))(SEL),
      d,
      opts("/run5"),
    );
    expect(again.exit).toBe(EXIT.refused);
    n = 0;
    const handoff = await runWalkerSteps(
      [waiting(walk)],
      fakeDeps(new Map(), () => (n++ > 0 ? [win("Options", 9, "Qt683QWindowIcon", 3)] : [])),
      opts("/run6"),
    );
    expect(handoff.exit).toBe(EXIT.handoff);
  });
  it("the popup pair is benign in the menu step only", async () => {
    const popup = (): WindowInfo[] => [
      win("", 7, "Qt683QWindowPopupDropShadowSaveBits"),
      win("", 8, "SysShadow"),
    ];
    const steps = launcherSteps(fakeKernel(), policyWith(["File", "Help"]))(SEL);
    for (const [idx, want] of [
      [1, EXIT.done],
      [0, EXIT.stopped],
    ] as const) {
      let n = 0;
      const r = await runWalkerSteps(
        [waiting(steps[idx])],
        fakeDeps(new Map(), () => (n++ > 0 ? popup() : [])),
        opts(`/run7-${idx}`),
      );
      expect(r.exit).toBe(want);
    }
  });
  it("a refused walk is a fail, not lines", async () => {
    const k = fakeKernel({
      walk: async () => ({ doc: { refused: true, reason: "no such window" }, sha256: SHA_W }),
    });
    const files = new Map<string, string>();
    const r = await runWalkerSteps(
      launcherSteps(k, policyWith(null))(SEL).slice(0, 1),
      fakeDeps(files),
      opts("/run8"),
    );
    expect(r.records[0].status).toBe("fail");
    expect(obsOf(files)).toHaveLength(0);
  });
});
