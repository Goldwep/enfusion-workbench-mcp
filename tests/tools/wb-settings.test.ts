import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RECORD_SUFFIX, scratchDir } from "../../src/settings/ini-edit.js";
import { REGISTRY_KEY, exportsDir } from "../../src/settings/reg-export.js";
import {
  ACTIONS,
  SETTINGS_GATES,
  WB_SETTINGS_ANNOTATIONS,
  WB_SETTINGS_DESCRIPTION,
  registerWbSettings,
  runSettings,
  type SettingsDeps,
  type SettingsResponse,
} from "../../src/tools/wb-settings.js";
import { captureTool, textOf } from "./_tool-harness.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

// Planted personal data is assembled at test time, never written whole into the repository.
const ACCT = ["tst", "acct"].join("");
const HOST = ["TST", "HOST9"].join("");
const ROOT_KEY = "HKEY_CURRENT_USER\\Software\\Bohemia Interactive\\Arma Reforger Workbench";
const RUNNING = '"ArmaReforgerWorkbenchSteamDiag.exe","4242","Console","1","100,000 K"';

function regText(extra: string[] = [], netApi = "1"): string {
  return [
    "Windows Registry Editor Version 5.00",
    "",
    `[${ROOT_KEY}]`,
    '"Version"="1"',
    "",
    `[${ROOT_KEY}\\Workbench]`,
    `"NetAPI_Enabled"="${netApi}"`,
    '"NetAPI_Port"=dword:0000167f',
    '"Theme"="Dark"',
    '"LastProject"="x"',
    '"SteamId"="12345"',
    '"Layout"=hex:01,02',
    `"ProjectDir"="D:\\\\mods\\\\${ACCT}"`,
    ...extra,
    "",
    `[${ROOT_KEY}\\Workbench\\RecentFiles]`,
    '"0"="a"',
    "",
    `[${ROOT_KEY}\\World Editor]`,
    '"ScriptDebugMode"="true"',
    '"CameraSpeed"="12"',
    "",
    `[${ROOT_KEY}\\Workbench\\PropertyGrid\\unnamed]`,
    '"World Editor>Hide"="true"',
    "",
  ].join("\r\n");
}

const utf16 = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Harness {
  root: string;
  calls: string[][];
  deps: SettingsDeps;
  state: { tasklist: string | Error; reg: string | Error };
  run: (args: Record<string, unknown>) => SettingsResponse;
}

function harness(over: Partial<SettingsDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "wbset-tool-"));
  dirs.push(root);
  const calls: string[][] = [];
  const state: Harness["state"] = { tasklist: "", reg: regText() };
  let tick = 0;
  const deps: SettingsDeps = {
    artifactsDir: () => root,
    platform: "win32",
    env: { USERNAME: ACCT, COMPUTERNAME: HOST },
    now: () => new Date(Date.UTC(2026, 10, 12, 10, 0, 0, tick++)),
    exec: (file, args) => {
      calls.push([file, ...args]);
      if (file === "tasklist") {
        if (state.tasklist instanceof Error) throw state.tasklist;
        return state.tasklist;
      }
      if (file === "reg") {
        if (state.reg instanceof Error) throw state.reg;
        writeFileSync(args[2], utf16(state.reg));
        return "The operation completed successfully.";
      }
      throw new Error(`unexpected ${file}`);
    },
    ...over,
  };
  return { root, calls, deps, state, run: (args) => runSettings(args, deps) };
}

function okOf(r: SettingsResponse) {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r as typeof r & { readback: Record<string, unknown>; dryRun?: boolean };
}
function errOf(r: SettingsResponse) {
  if (r.ok) throw new Error("expected an error, got ok");
  return r;
}

/** Registry calls are only ever `reg export <key> <new file>`. */
function onlyExports(calls: string[][]): void {
  for (const c of calls.filter((x) => x[0] === "reg")) {
    expect(c.slice(0, 3)).toEqual(["reg", "export", REGISTRY_KEY]);
    expect(c).toHaveLength(4);
  }
}

function makeProfile(h: Harness, name = "dev"): string {
  const r = okOf(h.run({ action: "profile", name, confirm: true }));
  return r.readback.forceSettings as string;
}

describe("wb_settings surface", () => {
  it("has the spec's description, within 400 characters", () => {
    expect(WB_SETTINGS_DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(WB_SETTINGS_DESCRIPTION).toContain("The registry is never written.");
    expect(ACTIONS).toEqual([
      "stores",
      "list",
      "get",
      "diff",
      "shortcuts",
      "options",
      "profile",
      "set",
      "unset",
    ]);
    expect(WB_SETTINGS_ANNOTATIONS.readOnlyHint).toBe(false);
  });

  it("registers and answers JSON; a refusal is isError", async () => {
    const h = harness();
    const handler = captureTool((s) => registerWbSettings(s, h.deps));
    const r = await handler({ action: "options" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(textOf(r)).code).toBe("GATED");
    const ok = await handler({ action: "stores" });
    expect(ok.isError).toBe(false);
  });

  it("refuses an unknown action", () => {
    expect(errOf(harness().run({ action: "write" })).code).toBe("INVALID_ARGUMENT");
  });
});

describe("stores", () => {
  it("exports the key read-only into the artifacts folder and lists scratch files", () => {
    const h = harness();
    makeProfile(h);
    const r = okOf(h.run({ action: "stores" }));
    expect(r.readback.registryKey).toBe(REGISTRY_KEY);
    expect(r.readback.exportPath).toMatch(
      /^<artifacts>\/settings\/exports\/registry-\d+T\d+Z\.reg$/,
    );
    expect(r.readback.exports).toBe(2);
    expect(r.readback.scratchFiles).toEqual([{ name: "dev.ini", editable: true, from: "profile" }]);
    expect(JSON.stringify(r)).not.toContain(h.root);
    onlyExports(h.calls);
  });

  it("takes no export off Windows", () => {
    const h = harness({ platform: "linux" });
    const r = okOf(h.run({ action: "stores" }));
    expect(r.readback.exportPath).toBeNull();
    expect(r.warnings[0]).toMatch(/only on Windows/);
    expect(h.calls).toEqual([]);
  });

  it("maps a failed reg export to HANDLER_ERROR", () => {
    const h = harness();
    h.state.reg = new Error("ERROR: The system was unable to find the specified registry key");
    const r = errOf(h.run({ action: "stores" }));
    expect(r.code).toBe("HANDLER_ERROR");
    expect(r.next).toMatch(/Nothing was written/);
  });
});

describe("list and get", () => {
  it("lists the registry with personal keys hidden and personal values withheld", () => {
    const h = harness();
    const r = okOf(h.run({ action: "list" }));
    const keys = r.readback.keys as Array<Record<string, unknown>>;
    const by = (k: string) => keys.find((e) => e.key === k);
    expect(by("Theme")).toEqual({
      section: "Workbench",
      key: "Theme",
      type: "REG_SZ",
      value: "Dark",
    });
    expect(by("NetAPI_Port")?.value).toBe("5759");
    expect(by("SteamId")).toMatchObject({ value: null, withheld: "personal-name:identity-name" });
    expect(by("Layout")).toMatchObject({ value: null, withheld: "type:REG_BINARY" });
    expect(by("ProjectDir")).toMatchObject({
      value: null,
      withheld: "personal-value:machine-path",
    });
    expect(by("LastProject")).toBeUndefined();
    expect(r.readback.hidden).toEqual({ "recent-list": 1, "recent-file-list": 1 });
    expect(r.readback.total).toBe(10);
    expect(JSON.stringify(r)).not.toContain(ACCT);
  });

  it("filters a section by its plain or escaped name", () => {
    const h = harness();
    for (const section of ["World Editor", "World%20Editor"]) {
      const r = okOf(h.run({ action: "list", section }));
      expect((r.readback.keys as Array<{ key: string }>).map((k) => k.key)).toEqual([
        "ScriptDebugMode",
        "CameraSpeed",
      ]);
    }
  });

  it("pages with a cursor and refuses a stale one", () => {
    const h = harness();
    const p1 = okOf(h.run({ action: "list", limit: 4 }));
    expect((p1.readback.keys as unknown[]).length).toBe(4);
    expect(p1.readback.nextCursor).toBe("4:10");
    const p3 = okOf(h.run({ action: "list", limit: 4, cursor: "8:10" }));
    expect((p3.readback.keys as unknown[]).length).toBe(2);
    expect(p3.readback.nextCursor).toBeNull();
    expect(errOf(h.run({ action: "list", cursor: "4:11" })).code).toBe("STALE_CURSOR");
    expect(errOf(h.run({ action: "list", cursor: "bad" })).code).toBe("INVALID_ARGUMENT");
  });

  it("reads from the newest export and says so", () => {
    const h = harness();
    okOf(h.run({ action: "list" }));
    const r = okOf(h.run({ action: "list" }));
    expect(r.warnings.join(" ")).toMatch(/newest export/);
    expect(h.calls.filter((c) => c[0] === "reg")).toHaveLength(1);
  });

  it("gets one key in plain or escaped form, from the registry or a scratch ini", () => {
    const h = harness();
    expect(
      okOf(h.run({ action: "get", section: "World Editor", key: "CameraSpeed" })).readback,
    ).toMatchObject({
      section: "World%20Editor",
      key: "CameraSpeed",
      value: "12",
      type: "REG_SZ",
    });
    expect(
      okOf(
        h.run({
          action: "get",
          section: "Workbench",
          key: "PropertyGrid/unnamed/World Editor>Hide",
        }),
      ).readback.value,
    ).toBe("true");
    makeProfile(h);
    const s = okOf(
      h.run({ action: "get", store: "dev", section: "World%20Editor", key: "ScriptDebugMode" }),
    );
    expect(s.target).toBe("scratch:dev.ini");
    expect(s.readback).toMatchObject({
      value: "false",
      type: "ini",
      store: "<artifacts>/settings/scratch/dev.ini",
    });
  });

  it("refuses a missing key, missing arguments and an unknown store", () => {
    const h = harness();
    expect(errOf(h.run({ action: "get", section: "Workbench", key: "Nope" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      errOf(h.run({ action: "get", section: "Workbench", key: "LastProject" })).message,
    ).toMatch(/hidden/);
    expect(errOf(h.run({ action: "get", section: "Workbench" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(h.run({ action: "list", store: "missing" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(h.run({ action: "list", store: "../x" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(h.run({ action: "list", store: join(h.root, "x.ini") })).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("withholds path-like values in a scratch ini that Workbench wrote back", () => {
    const h = harness();
    const abs = makeProfile(h);
    writeFileSync(abs, readFileSync(abs, "utf-8") + "[Extra]\r\nDir=C:\\x\\y\r\nKeep=7\r\n");
    const r = okOf(h.run({ action: "list", store: "dev", section: "Extra" }));
    expect(r.readback.keys).toEqual([
      {
        section: "Extra",
        key: "Dir",
        type: "ini",
        value: null,
        withheld: "personal-value:machine-path",
      },
      { section: "Extra", key: "Keep", type: "ini", value: "7" },
    ]);
    expect(r.warnings.join(" ")).toMatch(/changed since wb_settings wrote it/);
  });
});

describe("diff", () => {
  it("compares the registry with a scratch profile", () => {
    const h = harness();
    makeProfile(h);
    const r = okOf(h.run({ action: "diff", a: "registry", b: "dev" }));
    expect(r.target).toBe("registry..scratch:dev.ini");
    expect(r.readback.counts).toEqual({ added: 0, removed: 3, changed: 1 });
    expect(r.readback.changed).toEqual([
      { section: "World%20Editor", key: "ScriptDebugMode", before: "true", after: "false" },
    ]);
    expect((r.readback.removed as Array<{ key: string }>).map((e) => e.key).sort()).toEqual([
      "Layout",
      "ProjectDir",
      "SteamId",
    ]);
  });

  it("cuts long lists at the limit and needs both stores", () => {
    const h = harness();
    makeProfile(h);
    const r = okOf(h.run({ action: "diff", a: "registry", b: "dev", limit: 1 }));
    expect((r.readback.removed as unknown[]).length).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/cut at 1/);
    expect(errOf(h.run({ action: "diff", a: "registry" })).code).toBe("INVALID_ARGUMENT");
  });
});

describe("gated reads", () => {
  it("answers GATED for shortcuts and options, naming the probe and the switch", () => {
    const h = harness();
    for (const [action, probe] of [
      ["shortcuts", "P-W8-06"],
      ["options", "P-W8-05"],
    ]) {
      const r = errOf(h.run({ action }));
      expect(r.code).toBe("GATED");
      expect(r.message).toContain(probe);
      expect(r.next).toContain(`SETTINGS_GATES.${action}`);
    }
    expect(h.calls).toEqual([]);
  });

  it("behind an opened switch: shortcuts reads the table, options stays UNPROVEN", () => {
    const h = harness();
    SETTINGS_GATES.shortcuts = true;
    SETTINGS_GATES.options = true;
    try {
      const r = okOf(h.run({ action: "shortcuts" }));
      expect(r.readback.rows).toEqual([{ action: "World%20Editor%3EHide", chord: "true" }]);
      expect(errOf(h.run({ action: "options" })).code).toBe("UNPROVEN");
    } finally {
      SETTINGS_GATES.shortcuts = false;
      SETTINGS_GATES.options = false;
    }
  });
});

describe("profile", () => {
  it("is a dry run unless confirm, and writes nothing then", () => {
    const h = harness();
    const r = okOf(h.run({ action: "profile", name: "dev" }));
    expect(r.dryRun).toBe(true);
    expect(r.readback).toMatchObject({
      path: "<artifacts>/settings/scratch/dev.ini",
      debugLine: "ScriptDebugMode=false",
      netApi: ["NetAPI_Enabled", "NetAPI_Port"],
    });
    expect(existsSync(scratchDir(h.root))).toBe(false);
    onlyExports(h.calls);
  });

  it("writes a new scrubbed ini and its record, then refuses to overwrite it", () => {
    const h = harness();
    const r = okOf(h.run({ action: "profile", name: "dev", confirm: true }));
    expect(r.dryRun).toBe(false);
    const abs = r.readback.forceSettings as string;
    expect(abs).toBe(join(scratchDir(h.root), "dev.ini"));
    const text = readFileSync(abs, "utf-8");
    expect(text).toContain("ScriptDebugMode=false");
    expect(text).toContain("NetAPI_Enabled=1");
    expect(text).not.toMatch(/authori[sz]/i);
    expect(text).not.toContain(ACCT);
    expect(text).not.toContain("D:");
    const rec = JSON.parse(readFileSync(abs + RECORD_SUFFIX, "utf-8"));
    expect(rec).toMatchObject({ kind: "wb_settings-scratch", file: "dev.ini", from: "profile" });
    const again = errOf(h.run({ action: "profile", name: "dev", confirm: true }));
    expect(again.code).toBe("INVALID_ARGUMENT");
    expect(again.message).toMatch(/never overwritten/);
    expect(readFileSync(abs, "utf-8")).toBe(text);
    onlyExports(h.calls);
  });

  it("refuses WB_RUNNING while a Workbench process is listed, or when the list fails", () => {
    const h = harness();
    h.state.tasklist = RUNNING;
    const r = errOf(h.run({ action: "profile", name: "dev", confirm: true }));
    expect(r.code).toBe("WB_RUNNING");
    expect(r.next).toBe(ERROR_CODES.WB_RUNNING);
    expect(r.message).toMatch(/pid 4242/);
    h.state.tasklist = new Error("access denied");
    expect(errOf(h.run({ action: "profile", name: "dev" })).code).toBe("WB_RUNNING");
    expect(h.calls.filter((c) => c[0] === "reg")).toEqual([]);
    expect(existsSync(scratchDir(h.root))).toBe(false);
  });

  it("refuses a bad name, a disabled NET API and an authorization line", () => {
    const h = harness();
    expect(errOf(h.run({ action: "profile", name: "../x" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(h.run({ action: "profile" })).code).toBe("INVALID_ARGUMENT");
    h.state.reg = regText([], "0");
    const off = errOf(h.run({ action: "profile", name: "dev", confirm: true }));
    expect(off.code).toBe("PRECONDITION_UNMET");
    expect(off.next).toMatch(/registry is the owner's/);
    h.state.reg = regText(['"ScriptAuthorizeAll"="1"']);
    expect(errOf(h.run({ action: "profile", name: "dev", confirm: true })).message).toMatch(
      /authorization/,
    );
    expect(existsSync(join(scratchDir(h.root), "dev.ini"))).toBe(false);
  });
});

describe("set and unset", () => {
  it("set is a dry run unless confirm, then writes a new file and leaves the source", () => {
    const h = harness();
    const src = makeProfile(h);
    const before = readFileSync(src, "utf-8");
    const dry = okOf(
      h.run({ action: "set", path: "dev", section: "Workbench", key: "Theme", value: "Light" }),
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.readback).toMatchObject({
      from: "<artifacts>/settings/scratch/dev.ini",
      path: "<artifacts>/settings/scratch/dev-2.ini",
      previous: "Dark",
      after: "Light",
    });
    expect(existsSync(join(scratchDir(h.root), "dev-2.ini"))).toBe(false);
    const r = okOf(
      h.run({
        action: "set",
        path: src,
        section: "Workbench",
        key: "Theme",
        value: "Light",
        confirm: true,
      }),
    );
    expect(r.target).toBe("scratch:dev-2.ini");
    expect(r.readback).toMatchObject({ previous: "Dark", readback: "Light", created: false });
    expect(r.changed).toEqual([{ path: "[Workbench] Theme", before: "Dark", after: "Light" }]);
    const out = readFileSync(join(scratchDir(h.root), "dev-2.ini"), "utf-8");
    expect(out).toBe(before.replace("Theme=Dark", "Theme=Light"));
    expect(readFileSync(src, "utf-8")).toBe(before);
    const rec = JSON.parse(
      readFileSync(join(scratchDir(h.root), "dev-2.ini" + RECORD_SUFFIX), "utf-8"),
    );
    expect(rec.from).toBe("dev.ini");
    // A derived file is itself a scratch ini: the next edit goes to dev-3.
    const next = okOf(
      h.run({
        action: "set",
        path: "dev-2",
        section: "World Editor",
        key: "CameraSpeed",
        value: "20",
        confirm: true,
      }),
    );
    expect(next.target).toBe("scratch:dev-3.ini");
    onlyExports(h.calls);
  });

  it("set creates a missing key and section, escaping plain names and the value", () => {
    const h = harness();
    makeProfile(h);
    const r = okOf(
      h.run({
        action: "set",
        path: "dev",
        section: "Script Editor",
        key: "Font Size",
        value: "a,b",
        name: "fs",
        confirm: true,
      }),
    );
    expect(r.readback).toMatchObject({
      section: "Script%20Editor",
      key: "Font%20Size",
      created: true,
      readback: '"a,b"',
    });
    expect(readFileSync(join(scratchDir(h.root), "fs.ini"), "utf-8")).toContain(
      '[Script%20Editor]\r\nFont%20Size="a,b"\r\n',
    );
  });

  it("unset drops one key into a new file", () => {
    const h = harness();
    makeProfile(h);
    const r = okOf(
      h.run({ action: "unset", path: "dev", section: "Workbench", key: "Theme", confirm: true }),
    );
    expect(r.readback).toMatchObject({ previous: "Dark", readback: null });
    expect(readFileSync(join(scratchDir(h.root), "dev-2.ini"), "utf-8")).not.toContain("Theme=");
    expect(
      errOf(h.run({ action: "unset", path: "dev", section: "Workbench", key: "Nope" })).code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("refuses NOT_SCRATCH outside the folder, without a record, and after a change", () => {
    const h = harness();
    const outside = join(h.root, "x.ini");
    writeFileSync(outside, "[World%20Editor]\r\nScriptDebugMode=false\r\n");
    const args = {
      action: "set",
      section: "Workbench",
      key: "Theme",
      value: "Light",
      confirm: true,
    };
    const a = errOf(h.run({ ...args, path: outside }));
    expect(a.code).toBe("NOT_SCRATCH");
    expect(a.next).toBe(ERROR_CODES.NOT_SCRATCH);
    mkdirSync(scratchDir(h.root), { recursive: true });
    writeFileSync(
      join(scratchDir(h.root), "hand.ini"),
      "[World%20Editor]\r\nScriptDebugMode=false\r\n",
    );
    expect(errOf(h.run({ ...args, path: "hand" })).message).toMatch(/no wb_settings record/);
    expect(errOf(h.run({ ...args, path: "nothere" })).code).toBe("NOT_SCRATCH");
    const abs = makeProfile(h);
    writeFileSync(abs, readFileSync(abs, "utf-8") + "X=1\r\n");
    expect(errOf(h.run({ ...args, path: "dev" })).message).toMatch(/changed since/);
    expect(errOf(h.run({ ...args, action: "unset", path: "dev" })).code).toBe("NOT_SCRATCH");
  });

  it("refuses WB_RUNNING before any write", () => {
    const h = harness();
    makeProfile(h);
    h.state.tasklist = RUNNING;
    const r = errOf(
      h.run({
        action: "set",
        path: "dev",
        section: "Workbench",
        key: "Theme",
        value: "x",
        confirm: true,
      }),
    );
    expect(r.code).toBe("WB_RUNNING");
    expect(
      errOf(h.run({ action: "unset", path: "dev", section: "Workbench", key: "Theme" })).code,
    ).toBe("WB_RUNNING");
    expect(readdirSync(scratchDir(h.root)).filter((f) => f.endsWith(".ini"))).toEqual(["dev.ini"]);
  });

  it("keeps the scratch invariants and the NET API keys", () => {
    const h = harness();
    makeProfile(h);
    const set = (section: string, key: string, value: string) =>
      errOf(h.run({ action: "set", path: "dev", section, key, value, confirm: true }));
    expect(set("World%20Editor", "ScriptDebugMode", "true").message).toMatch(/does not read off/);
    expect(set("Workbench", "NetAPI_Enabled", "0").message).toMatch(/NET API/);
    expect(set("Workbench", "ScriptAuthorizeAll", "1").message).toMatch(/authorization/);
    expect(set("Workbench", "Dir", "C:\\x").message).toMatch(/path or personal data/);
    expect(set("Workbench", "Who", ACCT).message).toMatch(/path or personal data/);
    expect(
      errOf(h.run({ action: "set", path: "dev", section: "Workbench", key: "Theme" })).message,
    ).toMatch(/value is required/);
    expect(
      errOf(
        h.run({
          action: "unset",
          path: "dev",
          section: "World%20Editor",
          key: "ScriptDebugMode",
          confirm: true,
        }),
      ).message,
    ).toMatch(/does not read off/);
    expect(readdirSync(scratchDir(h.root)).filter((f) => f.endsWith(".ini"))).toEqual(["dev.ini"]);
  });

  it("never overwrites an existing output name", () => {
    const h = harness();
    makeProfile(h);
    makeProfile(h, "other");
    const r = errOf(
      h.run({
        action: "set",
        path: "dev",
        section: "Workbench",
        key: "Theme",
        value: "x",
        name: "other",
        confirm: true,
      }),
    );
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toMatch(/never overwritten/);
    expect(
      errOf(
        h.run({
          action: "set",
          path: "dev",
          section: "Workbench",
          key: "Theme",
          value: "x",
          name: "a/b",
        }),
      ).code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("the registry is never written: every reg call is an export", () => {
    const h = harness();
    makeProfile(h);
    h.run({
      action: "set",
      path: "dev",
      section: "Workbench",
      key: "Theme",
      value: "x",
      confirm: true,
    });
    h.run({ action: "unset", path: "dev", section: "Workbench", key: "Theme", confirm: true });
    h.run({ action: "stores" });
    h.run({ action: "diff", a: "registry", b: "dev" });
    onlyExports(h.calls);
    expect(existsSync(exportsDir(h.root))).toBe(true);
  });
});

// Census rows this file tests (W8 close-out, EV-W8-211).
// census:mcp:action/wb_settings.diff
// census:mcp:action/wb_settings.get
// census:mcp:action/wb_settings.list
// census:mcp:action/wb_settings.stores
