import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RECORD_KIND,
  RECORD_SUFFIX,
  iniEntries,
  isPathLike,
  newFileRefusal,
  notScratchReason,
  parseIni,
  recordText,
  resolveScratchPath,
  scratchDir,
  scratchFileName,
  setStructToken,
  setValues,
  sha256,
  unsetValue,
  workbenchRunningRefusal,
} from "../../src/settings/ini-edit.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "wbset-ini-"));
  dirs.push(d);
  return d;
}

const INI =
  "[Workbench]\r\nTheme=Dark\r\nNetAPI_Enabled=1\r\n\r\n[World%20Editor]\r\nScriptDebugMode=false\r\n";

describe("parseIni", () => {
  it("keeps line breaks, sections and keys; comments are not keys", () => {
    const p = parseIni("[a]\n;x=1\nk=v\n");
    expect(p.eol).toBe("\n");
    expect(p.finalEol).toBe(true);
    expect(p.lines.map((l) => l.key)).toEqual([null, null, "k"]);
    expect(iniEntries(INI)).toEqual([
      { section: "Workbench", key: "Theme", value: "Dark" },
      { section: "Workbench", key: "NetAPI_Enabled", value: "1" },
      { section: "World%20Editor", key: "ScriptDebugMode", value: "false" },
    ]);
  });
});

describe("setValues", () => {
  it("replaces one line and changes nothing else", () => {
    const r = setValues(INI, [{ section: "Workbench", key: "Theme", value: "Light" }]);
    expect(r.text).toBe(INI.replace("Theme=Dark", "Theme=Light"));
    expect(r.changes).toEqual([
      {
        section: "Workbench",
        key: "Theme",
        line: 2,
        before: "Theme=Dark",
        after: "Theme=Light",
        created: false,
      },
    ]);
  });

  it("creates a key at the end of its section, or a new section at the end", () => {
    const a = setValues(INI, [{ section: "Workbench", key: "New", value: "1", create: true }]);
    expect(a.text).toBe(INI.replace("NetAPI_Enabled=1\r\n", "NetAPI_Enabled=1\r\nNew=1\r\n"));
    expect(a.changes[0].created).toBe(true);
    const b = setValues(INI, [{ section: "Other", key: "K", value: "v", create: true }]);
    expect(b.text).toBe(INI + "[Other]\r\nK=v\r\n");
    expect(() => setValues(INI, [{ section: "Other", key: "K", value: "v" }])).toThrow(
      /not in the ini/,
    );
  });

  it("refuses NetAPI keys, line breaks, '=' in a key, duplicates and brackets", () => {
    expect(() =>
      setValues(INI, [{ section: "Workbench", key: "NetAPI_Enabled", value: "0" }]),
    ).toThrow(/NET API/);
    expect(() => setValues(INI, [{ section: "Workbench", key: "Theme", value: "a\nb" }])).toThrow(
      /line break/,
    );
    expect(() => setValues(INI, [{ section: "Workbench", key: "a=b", value: "1" }])).toThrow();
    expect(() => setValues(INI, [{ section: "a]b", key: "k", value: "1" }])).toThrow(/bracket/);
    expect(() => setValues("[a]\nk=1\nk=2\n", [{ section: "a", key: "k", value: "3" }])).toThrow(
      /2 times/,
    );
    expect(() => setValues(INI, [])).toThrow();
  });

  it("rewrites one token of a struct value", () => {
    const v = 'Gen {, " m_iImageWidth 512", " m_s x", }';
    expect(setStructToken(v, "m_iImageWidth", "512", "384")).toBe(
      'Gen {, " m_iImageWidth 384", " m_s x", }',
    );
    expect(() => setStructToken(v, "m_iImageWidth", "500", "384")).toThrow(/not 500/);
    expect(() => setStructToken("plain", "a", "1", "2")).toThrow(/struct/);
    const ini = `[ScriptTools]\nGen=${v}\n`;
    const r = setValues(ini, [
      { section: "ScriptTools", key: "Gen", value: "384", token: "m_iImageWidth", old: "512" },
    ]);
    expect(r.text).toContain('" m_iImageWidth 384"');
    expect(() =>
      setValues(ini, [{ section: "ScriptTools", key: "Gen", value: "1", token: "x" }]),
    ).toThrow(/go together/);
  });
});

describe("unsetValue", () => {
  it("drops exactly the one line", () => {
    const r = unsetValue(INI, { section: "Workbench", key: "Theme" });
    expect(r.text).toBe(INI.replace("Theme=Dark\r\n", ""));
    expect(r.change).toMatchObject({ before: "Theme=Dark", after: null, line: 2 });
    expect(() => unsetValue(INI, { section: "Workbench", key: "Nope" })).toThrow(/not in the ini/);
    expect(() => unsetValue(INI, { section: "Workbench", key: "NetAPI_Enabled" })).toThrow(
      /NET API/,
    );
  });
});

describe("isPathLike", () => {
  it("flags paths and variables", () => {
    for (const v of ["a\\b", "a/b", "$x", "<v2>", "%LOCALAPPDATA%"])
      expect(isPathLike(v)).toBe(true);
    expect(isPathLike("Dark")).toBe(false);
  });
});

describe("scratch folder, names and records", () => {
  it("accepts plain names only", () => {
    expect(scratchFileName("dev")).toBe("dev.ini");
    expect(scratchFileName("dev.INI")).toBe("dev.ini");
    for (const bad of ["", ".x", "a/b", "a\\b", "a..b", "a.", "x".repeat(65), "a b"])
      expect(scratchFileName(bad)).toBeNull();
  });

  it("resolves a name or an absolute path inside the folder only", () => {
    const root = tmp();
    const dir = scratchDir(root);
    expect(resolveScratchPath("dev", root)).toBe(join(dir, "dev.ini"));
    expect(resolveScratchPath(join(dir, "dev.ini"), root)).toBe(join(dir, "dev.ini"));
    expect(resolveScratchPath(join(root, "dev.ini"), root)).toBeNull();
    expect(resolveScratchPath(join(dir, "sub", "dev.ini"), root)).toBeNull();
    expect(resolveScratchPath(join(dir, "..", "x.ini"), root)).toBeNull();
    expect(resolveScratchPath("../x", root)).toBeNull();
  });

  it("creates new files only", () => {
    const root = tmp();
    const dir = scratchDir(root);
    mkdirSync(dir, { recursive: true });
    expect(newFileRefusal(join(dir, "a.ini"), root)).toBeNull();
    writeFileSync(join(dir, "a.ini"), "x");
    expect(newFileRefusal(join(dir, "a.ini"), root)).toMatch(/never overwritten/);
    writeFileSync(join(dir, "b.ini" + RECORD_SUFFIX), "x");
    expect(newFileRefusal(join(dir, "b.ini"), root)).toMatch(/never overwritten/);
    expect(newFileRefusal(join(root, "c.ini"), root)).toMatch(/not inside the scratch folder/);
  });

  it("knows a scratch ini this tool made, and nothing else", () => {
    const root = tmp();
    const dir = scratchDir(root);
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "a.ini");
    expect(notScratchReason(f, root)).toMatch(/does not exist/);
    writeFileSync(f, INI);
    expect(notScratchReason(f, root)).toMatch(/no wb_settings record/);
    writeFileSync(f + RECORD_SUFFIX, "{");
    expect(notScratchReason(f, root)).toMatch(/does not parse/);
    const rec = {
      kind: RECORD_KIND,
      file: "a.ini",
      sha256: sha256(INI),
      created: "2026-11-12T00:00:00.000Z",
      from: "profile",
    } as const;
    writeFileSync(f + RECORD_SUFFIX, recordText({ ...rec, file: "b.ini" }));
    expect(notScratchReason(f, root)).toMatch(/not a wb_settings record/);
    writeFileSync(f + RECORD_SUFFIX, recordText(rec));
    expect(notScratchReason(f, root)).toBeNull();
    writeFileSync(f, INI + "X=1\r\n");
    expect(notScratchReason(f, root)).toMatch(/changed since wb_settings wrote it/);
    const outside = join(root, "o.ini");
    writeFileSync(outside, INI);
    expect(notScratchReason(outside, root)).toMatch(/not in the scratch folder/);
  });
});

describe("workbenchRunningRefusal", () => {
  const row = '"ArmaReforgerWorkbenchSteamDiag.exe","4242","Console","1","100,000 K"';

  it("refuses while a Workbench process is listed", () => {
    expect(workbenchRunningRefusal("win32", () => row)).toMatch(/pid 4242/);
    expect(
      workbenchRunningRefusal("win32", () => "INFO: No tasks are running which match."),
    ).toBeNull();
  });

  it("fails closed when the process table cannot be read, and passes off Windows", () => {
    expect(
      workbenchRunningRefusal("win32", () => {
        throw new Error("denied");
      }),
    ).toMatch(/could not list/);
    expect(workbenchRunningRefusal("linux", () => row)).toBeNull();
  });

  it("asks tasklist for the Workbench image with an argv array", () => {
    const calls: string[][] = [];
    workbenchRunningRefusal("win32", (f, a) => {
      calls.push([f, ...a]);
      return "";
    });
    expect(calls).toEqual([
      ["tasklist", "/FI", "IMAGENAME eq ArmaReforgerWorkbenchSteamDiag.exe", "/FO", "CSV", "/NH"],
    ]);
  });
});
