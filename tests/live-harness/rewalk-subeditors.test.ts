import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { EDITOR_WINDOW_CLASS, EXIT } from "../../scripts/census/live/common.js";
import type { WindowInfo } from "../../scripts/live/s-c-natives.js";
import {
  RESULT_FILE,
  SUB_EDITORS,
  SUMMARY_FILE,
  main,
  selectSubEditors,
  summaryFile,
  walkArgv,
  type RewalkDeps,
} from "../../scripts/census/live/rewalk-subeditors.js";
import { VIEWER_EXTENSIONS, type ToolResponse } from "../../tests/live/w8.live.js";
import type { LocatorRecord } from "../../src/gui/locators.js";

const ART = join(tmpdir(), "emcp-rewalk-harness", "artifacts");
const ROOT = join(ART, "sessions", "W8", "rewalk");
const SB = join(tmpdir(), "emcp-rewalk-harness", "addons", "EMCP2_sandbox");
const PID = 4242;
const ARGV = ["--really", "--id", "w8", "--sandbox", SB, "--run-root", ROOT, "--build", "1.9.0.37"];

interface Fake {
  deps: RewalkDeps;
  files: Map<string, string>;
  tools: Array<{ name: string; args: Record<string, unknown> }>;
  walks: Array<{ script: string; argv: string[] }>;
}

function fake(
  o: {
    info?: Record<string, unknown> | null;
    stamp?: string;
    walkExit?: (script: string, module: string) => number;
    prompt?: (module: string) => string[];
    noCloseRow?: string[];
    windows?: () => WindowInfo[];
    exists?: string[];
  } = {},
): Fake {
  const files = new Map<string, string>();
  const tools: Fake["tools"] = [];
  const walks: Fake["walks"] = [];
  let current = "";
  const locs = new Map<string, LocatorRecord>();
  for (const m of SUB_EDITORS)
    if (!(o.noCloseRow ?? []).includes(m)) {
      const rowId = `ui:${m}/menu-item/File/Close`;
      locs.set(rowId, { rowId } as unknown as LocatorRecord);
    }
  const deps: RewalkDeps = {
    windows: async () => (o.windows ? o.windows() : []),
    sleep: () => new Promise((r) => setImmediate(r)),
    now: () => 0,
    recordedPid: () => PID,
    processImage: () => "ArmaReforgerWorkbenchSteamDiag.exe",
    heartbeat: () => undefined,
    // A folder exists once a file was written under it.
    exists: (p) =>
      files.has(p) ||
      [...files.keys()].some((k) => k.startsWith(p + sep)) ||
      (o.exists ?? []).includes(p),
    writeFile: (p, t) => {
      files.set(p, t);
    },
    log: () => undefined,
    tool: async (name, args): Promise<ToolResponse> => {
      tools.push({ name, args });
      if (name === "wb_resources") {
        const ext = (args.extensions as string[])[0];
        current = SUB_EDITORS.find((m) => VIEWER_EXTENSIONS[m] === ext) ?? "";
        return { ok: true, readback: { items: [`{0123456789ABCDEF}Data/x.${ext}`] } };
      }
      if (name === "wb_gui" && args.action === "modals")
        return {
          ok: true,
          readback: { modals: (o.prompt?.(current) ?? []).map((title) => ({ title })) },
        };
      return { ok: true, readback: {} };
    },
    info: async () =>
      o.info === undefined ? { projectFound: true, projectName: "EMCP2_sandbox" } : o.info,
    ping: async () => ({ buildStamp: o.stamp ?? "abc123" }),
    bundleDigest: () => "abc123",
    locators: () => locs,
    walk: async (script, argv) => {
      walks.push({ script, argv });
      const module = argv[argv.indexOf("--module") + 1];
      return o.walkExit ? o.walkExit(script, module) : 0;
    },
  };
  return { deps, files, tools, walks };
}

const run = (f: Fake, argv = ARGV, out: string[] = []) =>
  main(argv, {
    deps: f.deps,
    platform: "win32",
    leaseHeld: true,
    artifactsRoot: ART,
    out: (l) => out.push(l),
  });

const summary = (f: Fake, file = SUMMARY_FILE) =>
  JSON.parse(f.files.get(join(ROOT, file)) as string);

describe("rewalk-subeditors: arguments and the walker command lines", () => {
  it("covers the eight sub-editors of VIEWER_EXTENSIONS in order", () => {
    expect(SUB_EDITORS).toEqual([
      "ResourceManager.Config",
      "ResourceManager.Font",
      "ResourceManager.Imageset",
      "ResourceManager.Layout",
      "ResourceManager.Material",
      "ResourceManager.Model",
      "ResourceManager.Styles",
      "ResourceManager.Texture",
    ]);
    expect(selectSubEditors("Font,ResourceManager.Model")).toEqual([
      "ResourceManager.Font",
      "ResourceManager.Model",
    ]);
    expect(selectSubEditors("Particle")).toMatch(/not one of/);
  });

  it("gives L01 and L03 their real flags: --state none, --build, the run folder, --from the first step", () => {
    const lane = { id: "w8" };
    const o = {
      lane,
      sandbox: SB,
      runDir: join(ROOT, "ResourceManager.Font"),
      build: "1.9.0.37",
      port: 5775,
    };
    const l01 = walkArgv("L01", "ResourceManager.Font", o);
    const l03 = walkArgv("L03", "ResourceManager.Font", o);
    if ("refusal" in l01 || "refusal" in l03) throw new Error("refused");
    expect(l01.script).toBe("scripts/census/live/L01-snapshot.ts");
    expect(l03.script).toBe("scripts/census/live/L03-chrome.ts");
    for (const a of [l01.argv, l03.argv]) {
      expect(a[0]).toBe("--really");
      expect(a.slice(a.indexOf("--id"), a.indexOf("--id") + 2)).toEqual(["--id", "w8"]);
      expect(a[a.indexOf("--state") + 1]).toBe("none");
      expect(a[a.indexOf("--build") + 1]).toBe("1.9.0.37");
      expect(a[a.indexOf("--module") + 1]).toBe("ResourceManager.Font");
      expect(a[a.indexOf("--run-dir") + 1]).toBe(o.runDir);
    }
    expect(l01.argv[l01.argv.indexOf("--from") + 1]).toBe(
      "p4-l01-snapshot-ResourceManager.Font-none",
    );
    expect(l03.argv[l03.argv.indexOf("--from") + 1]).toBe("p4-l03-chrome");
  });
});

describe("rewalk-subeditors: the gate", () => {
  it("refuses without --really, and without --id, before anything is sent", async () => {
    const f = fake();
    expect(
      await run(
        f,
        ARGV.filter((a) => a !== "--really"),
      ),
    ).toBe(EXIT.refused);
    const noId = ARGV.filter((a, i) => a !== "--id" && ARGV[i - 1] !== "--id");
    expect(await run(f, noId)).toBe(EXIT.refused);
    expect(f.tools).toEqual([]);
    expect(f.walks).toEqual([]);
  });

  it("refuses a sandbox that is not the 2.0 test bed folder", async () => {
    const f = fake();
    const argv = [...ARGV];
    argv[argv.indexOf("--sandbox") + 1] = join(tmpdir(), "OtherAddon");
    expect(await run(f, argv)).toBe(EXIT.aborted);
    expect(f.tools).toEqual([]);
  });

  it("aborts when Info does not name EMCP2_sandbox, and opens nothing", async () => {
    const f = fake({ info: { projectFound: true, projectName: "SomeMod" } });
    expect(await run(f)).toBe(EXIT.aborted);
    expect(f.tools).toEqual([]);
    expect(summary(f).stop.at).toBe("gate");
  });

  it("stops when the build stamp is not the bundle digest", async () => {
    const f = fake({ stamp: "stale" });
    expect(await run(f)).toBe(EXIT.stopped);
    expect(f.tools).toEqual([]);
    expect(f.walks).toEqual([]);
  });

  it("refuses a run root that already holds a sub-editor's run folder", async () => {
    const f = fake({ exists: [join(ROOT, "ResourceManager.Layout")] });
    expect(await run(f)).toBe(EXIT.refused);
    expect(f.tools).toEqual([]);
  });
});

describe("rewalk-subeditors: the eight sub-editors", () => {
  it("opens, walks L01 then L03, and closes each; one result per sub-editor and a summary", async () => {
    const f = fake();
    expect(await run(f)).toBe(EXIT.done);
    expect(
      f.walks.map(
        (w) =>
          `${w.script.includes("L01") ? "L01" : "L03"} ${w.argv[w.argv.indexOf("--module") + 1]}`,
      ),
    ).toEqual(SUB_EDITORS.flatMap((m) => [`L01 ${m}`, `L03 ${m}`]));
    for (const m of SUB_EDITORS) {
      const r = JSON.parse(f.files.get(join(ROOT, m, RESULT_FILE)) as string);
      expect(r.status).toBe("pass");
      expect(r.closed).toBe(true);
    }
    const s = summary(f);
    expect(s.walked).toBe(8);
    expect(s.closed).toBe(8);
    expect(s.runDirs).toEqual(SUB_EDITORS.map((m) => join(ROOT, m)));
    // The RM fronted before each open (w8-30's state), never a Save of any kind.
    const opens = f.tools.filter((t) => t.args.action === "open");
    expect(opens).toHaveLength(8);
    expect(opens.every((t) => t.name === "wb_module" && t.args.module === "ResourceManager")).toBe(
      true,
    );
    expect(f.tools.some((t) => /save/i.test(String(t.args.action)))).toBe(false);
    // The P4-9 route: search then setResource on the Resource Manager; the close is an invoke.
    expect(
      f.tools
        .filter((t) => t.args.action === "setResource")
        .every((t) => t.args.module === "ResourceManager"),
    ).toBe(true);
    expect(f.tools.filter((t) => t.args.action === "invoke").map((t) => t.args.rowId)).toEqual(
      SUB_EDITORS.map((m) => `ui:${m}/menu-item/File/Close`),
    );
  });

  it("goes on to the next sub-editor after a per-editor failure", async () => {
    const f = fake({
      walkExit: (s, m) => (m === "ResourceManager.Font" && s.includes("L01") ? EXIT.stopped : 0),
      noCloseRow: ["ResourceManager.Config"],
    });
    expect(await run(f)).toBe(EXIT.stopped);
    const s = summary(f);
    expect(s.results.map((r: { status: string }) => r.status)).toEqual([
      "fail",
      "fail",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(s.walked).toBe(7);
    expect(s.openTabs).toEqual(["ResourceManager.Config"]);
    expect(s.notReached).toEqual([]);
  });

  it("stops the whole run on a save prompt and never answers it", async () => {
    const f = fake({ prompt: (m) => (m === "ResourceManager.Imageset" ? ["Save changes?"] : []) });
    expect(await run(f)).toBe(EXIT.stopped);
    expect(f.tools.some((t) => t.args.action === "dismiss")).toBe(false);
    expect(f.tools.some((t) => /save/i.test(String(t.args.action)))).toBe(false);
    const s = summary(f);
    expect(s.stop.at).toBe("ResourceManager.Imageset");
    expect(s.notReached).toEqual(SUB_EDITORS.slice(3));
    expect(f.tools.filter((t) => t.args.action === "setResource")).toHaveLength(3);
  });

  it("ends the run when a walker hands off (a dialog may be up)", async () => {
    const f = fake({ walkExit: (s, m) => (m === "ResourceManager.Layout" ? EXIT.handoff : 0) });
    expect(await run(f)).toBe(EXIT.handoff);
    expect(f.walks).toHaveLength(7);
    expect(summary(f).notReached).toEqual(SUB_EDITORS.slice(4));
  });

  it("waits out a busy window inside the grace instead of stopping", async () => {
    let n = 0;
    const busy: WindowInfo = {
      hwnd: 77,
      pid: PID,
      className: EDITOR_WINDOW_CLASS,
      title: "Arma Reforger Workbench",
      owner: 0,
      enabled: false,
      rect: [],
      monitor: [],
      primary: true,
    };
    // The baseline is empty; a busy window shows for a few checks of the first open, then goes.
    const f = fake({ windows: () => (n++ >= 1 && n <= 4 ? [busy] : []) });
    expect(await run(f, [...ARGV, "--only", "Config"])).toBe(EXIT.done);
    expect(summaryFile(["ResourceManager.Config"])).toBe("rewalk-summary-Config.json");
    expect(summary(f, "rewalk-summary-Config.json").walked).toBe(1);
    // A second sub-editor alone may share the run root (a hand close between); Config may not rerun.
    expect(await run(f, [...ARGV, "--only", "Font"])).toBe(EXIT.done);
    expect(await run(f, [...ARGV, "--only", "Config"])).toBe(EXIT.refused);
  });

  it("stops at once on a dialog during an open", async () => {
    const dialog: WindowInfo = {
      hwnd: 88,
      pid: PID,
      className: "#32770",
      title: "Warning",
      owner: 1,
      enabled: true,
      rect: [],
      monitor: [],
      primary: true,
    };
    let n = 0;
    const f = fake({ windows: () => (n++ >= 1 ? [dialog] : []) });
    expect(await run(f, [...ARGV, "--only", "Config"])).toBe(EXIT.handoff);
    expect(f.walks).toEqual([]);
  });
});
