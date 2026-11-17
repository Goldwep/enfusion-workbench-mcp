import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dropSectionPrefix,
  isPathLike,
  main,
  readKeyNames,
  setValues,
  sha256,
} from "../../scripts/live/ini-edit.js";

// A synthetic ini in the Qt form of the scratch inis; values are placeholders, not owner data.
const INI = [
  "[General]",
  "Version=1",
  "",
  "[Script%20Editor]",
  "LastPath=<v2>\\scripts",
  "",
  "[Workbench]",
  "AutoRebuildScripts=1",
  "NetAPI_Enabled=1",
  "PropertyGrid\\ProjectSettingsGridCommon\\SplitterPos=250",
  "PropertyGrid\\unnamed\\Animation%20Editor%3ELocate%20file=true",
  "PropertyGrid\\unnamed\\Animation%20Editor%3ENew%20Workspace=true",
  "PropertyGrid\\unnamed\\World%20Editor%3EPlay=Ctrl+P",
  'ScriptTools\\SCR_ImageSetGenerator=SCR_ImageSetGenerator {, " m_iImageWidth 512", }',
  "SavedFolder=$profile:Saves",
  "",
  "[World%20Editor]",
  "ScriptDebugMode=false",
  "",
].join("\r\n");

function tmp(): { root: string; art: string; input: string } {
  const root = mkdtempSync(join(tmpdir(), "emcp-ini-"));
  const art = join(root, "artifacts");
  mkdirSync(join(art, "S-F"), { recursive: true });
  const input = join(art, "S-F", "scratch.ini");
  writeFileSync(input, INI);
  return { root, art, input };
}

function quiet(): { out: string[]; deps: Parameters<typeof main>[1] } {
  const out: string[] = [];
  return {
    out,
    deps: {
      platform: "linux",
      log: (s) => out.push(s),
      err: (s) => out.push(`ERR ${s}`),
    },
  };
}

describe("dropSectionPrefix", () => {
  it("drops exactly the prefixed key lines and keeps every other byte", () => {
    const d = dropSectionPrefix(INI, "PropertyGrid\\unnamed\\");
    expect(d.count).toBe(3);
    expect(d.bySection).toEqual({ Workbench: 3 });
    expect(d.dropped.map((x) => x.line)).toEqual([11, 12, 13]);
    const expected = INI.split("\r\n")
      .filter((l) => !l.startsWith("PropertyGrid\\unnamed\\"))
      .join("\r\n");
    expect(d.text).toBe(expected);
    expect(d.text).toContain("PropertyGrid\\ProjectSettingsGridCommon\\SplitterPos=250");
  });
});

describe("setValues", () => {
  it("changes exactly N lines and creates only with create", () => {
    const s = setValues(INI, [
      {
        section: "Workbench",
        key: "ScriptTools\\SCR_ImageSetGenerator",
        value: 'SCR_ImageSetGenerator {, " m_iImageWidth 384", }',
      },
      { section: "Workbench", key: "LSP_Enabled", value: "1", create: true },
      { section: "Workbench", key: "LSP_Port", value: "5776", create: true },
    ]);
    expect(s.changes.map((c) => [c.key, c.created])).toEqual([
      ["ScriptTools\\SCR_ImageSetGenerator", false],
      ["LSP_Enabled", true],
      ["LSP_Port", true],
    ]);
    const a = INI.split("\r\n");
    const b = s.text.split("\r\n");
    expect(b.length).toBe(a.length + 2);
    const removed = a.filter((l) => !b.includes(l));
    expect(removed).toEqual([a[13]]);
    expect(b.indexOf("LSP_Enabled=1")).toBeLessThan(b.indexOf("[World%20Editor]"));
    expect(b.indexOf("LSP_Enabled=1")).toBeGreaterThan(b.indexOf("[Workbench]"));
  });

  it("fails on an absent key without create, and on NetAPI keys always", () => {
    expect(() => setValues(INI, [{ section: "Workbench", key: "LSP_Port", value: "1" }])).toThrow(
      /not in the ini/,
    );
    for (const key of ["NetAPI_Port", "NetAPI_Enabled"]) {
      expect(() =>
        setValues(INI, [{ section: "Workbench", key, value: "0", create: true }]),
      ).toThrow(/refuses/);
    }
  });
});

describe("set --token (struct-token edit)", () => {
  const STRUCT = [
    "[Resource%20Manager]",
    'ScriptTools\\SCR_ImageSetGenerator=SCR_ImageSetGenerator {, " m_iImageWidth 512", " m_iImageHeight 512", }',
    "[Workbench]",
    "AutoRebuildScripts=1",
    "",
  ].join("\r\n");
  const spec = {
    section: "Resource%20Manager",
    key: "ScriptTools\\SCR_ImageSetGenerator",
    token: "m_iImageWidth",
    old: "512",
    value: "384",
  };

  it("rewrites exactly the token and nothing else", () => {
    const s = setValues(STRUCT, [spec]);
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0].after).toBe(
      'ScriptTools\\SCR_ImageSetGenerator=SCR_ImageSetGenerator {, " m_iImageWidth 384", " m_iImageHeight 512", }',
    );
    expect(s.text.split("\r\n").filter((l, i) => l !== STRUCT.split("\r\n")[i])).toHaveLength(1);
  });

  it("refuses a wrong section, a wrong key, a wrong old value, an absent or repeated token", () => {
    expect(() => setValues(STRUCT, [{ ...spec, section: "Workbench" }])).toThrow(/not in the ini/);
    expect(() => setValues(STRUCT, [{ ...spec, key: "ScriptTools\\Other" }])).toThrow(
      /not in the ini/,
    );
    expect(() => setValues(STRUCT, [{ ...spec, old: "511" }])).toThrow(/not --old/);
    expect(() => setValues(STRUCT, [{ ...spec, token: "m_iImageDepth" }])).toThrow(/0 times/);
    const twice = STRUCT.replace('" m_iImageHeight 512"', '" m_iImageWidth 512"');
    expect(() => setValues(twice, [spec])).toThrow(/2 times/);
    expect(() =>
      setValues(INI, [{ ...spec, section: "Workbench", key: "AutoRebuildScripts" }]),
    ).toThrow(/not struct-valued/);
    expect(() => setValues(STRUCT, [{ ...spec, create: true }])).toThrow(/never creates/);
    expect(() => setValues(STRUCT, [{ ...spec, old: undefined }])).toThrow(/go together/);
  });

  it("the CLI form sf-p4 builds: two created LSP keys and the token edit, 3 changes", () => {
    const q = quiet();
    const root = mkdtempSync(join(tmpdir(), "emcp-ini-"));
    try {
      const art = join(root, "artifacts");
      mkdirSync(join(art, "S-F"), { recursive: true });
      const input = join(art, "S-F", "l1.ini");
      writeFileSync(input, STRUCT);
      const out = join(art, "S-F", "l2.ini");
      const rec = join(art, "S-F", "l2.ini.record.json");
      const args = [
        "set",
        "--really",
        "--in",
        input,
        "--out",
        out,
        "--artifacts",
        art,
        "--record",
        rec,
        "--section",
        "Workbench",
        "--key",
        "LSP_Enabled",
        "--value",
        "1",
        "--create",
        "--section",
        "Workbench",
        "--key",
        "LSP_Port",
        "--value",
        "5776",
        "--create",
        "--section",
        spec.section,
        "--key",
        spec.key,
        "--value",
        "384",
        "--token",
        "m_iImageWidth",
        "--old",
        "512",
      ];
      expect(main(args, q.deps)).toBe(0);
      const r = JSON.parse(readFileSync(rec, "utf-8"));
      expect(r.sets).toHaveLength(3);
      expect(readFileSync(out, "utf-8")).toContain('" m_iImageWidth 384"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readKeyNames", () => {
  it("never returns a path-like value", () => {
    const k = readKeyNames(INI);
    expect(k.find((x) => x.key === "LastPath")!.value).toBeNull();
    expect(k.find((x) => x.key === "SavedFolder")!.value).toBeNull();
    expect(k.find((x) => x.key === "AutoRebuildScripts")!.value).toBe("1");
    expect(isPathLike("C:\\x")).toBe(true);
    expect(isPathLike("a/b")).toBe(true);
    expect(isPathLike("\\\\server")).toBe(true);
    expect(isPathLike("true")).toBe(false);
  });
});

describe("ini-edit main", () => {
  it("dry run writes nothing; really writes the ini and a record with hashes, not dropped text", () => {
    const { root, art, input } = tmp();
    try {
      const out = join(art, "S-F", "launch1.ini");
      const rec = join(art, "S-F", "launch1.edit.json");
      const args = [
        "drop-section",
        "--prefix",
        "PropertyGrid\\unnamed\\",
        "--in",
        input,
        "--out",
        out,
        "--artifacts",
        art,
        "--record",
        rec,
      ];
      const q = quiet();
      expect(main(args, q.deps)).toBe(0);
      expect(existsSync(out)).toBe(false);
      expect(main([...args, "--really"], q.deps)).toBe(0);
      const r = JSON.parse(readFileSync(rec, "utf-8"));
      expect(r.in.sha256).toBe(sha256(INI));
      expect(r.out.sha256).toBe(sha256(readFileSync(out, "utf-8")));
      expect(r.drop.count).toBe(3);
      expect(JSON.stringify(r)).not.toContain("Locate%20file");
      // created, never overwritten
      expect(main([...args, "--really"], q.deps)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses paths outside the artifacts folder and --out equal to --in", () => {
    const { root, art, input } = tmp();
    try {
      const outside = join(root, "outside.ini");
      writeFileSync(outside, INI);
      const q = quiet();
      const base = ["--artifacts", art, "--record", join(art, "S-F", "r.json")];
      expect(
        main(
          [
            "drop-section",
            "--prefix",
            "X",
            "--in",
            outside,
            "--out",
            join(art, "S-F", "o.ini"),
            ...base,
          ],
          q.deps,
        ),
      ).toBe(1);
      expect(
        main(
          ["drop-section", "--prefix", "X", "--in", input, "--out", outside + "2", ...base],
          q.deps,
        ),
      ).toBe(1);
      expect(
        main(["drop-section", "--prefix", "X", "--in", input, "--out", input, ...base], q.deps),
      ).toBe(1);
      expect(q.out.join("\n")).toMatch(/not inside the artifacts folder/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses while a Workbench process runs (win32)", () => {
    const { root, art, input } = tmp();
    try {
      const q = quiet();
      const code = main(
        [
          "set",
          "--section",
          "Workbench",
          "--key",
          "AutoRebuildScripts",
          "--value",
          "0",
          "--in",
          input,
          "--out",
          join(art, "S-F", "o.ini"),
          "--artifacts",
          art,
          "--record",
          join(art, "S-F", "r.json"),
        ],
        {
          ...q.deps,
          platform: "win32",
          exec: () => '"ArmaReforgerWorkbenchSteamDiag.exe","4242","Console","1","1 K"\r\n',
        },
      );
      expect(code).toBe(1);
      expect(q.out.join("\n")).toContain("is running");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("read-keys prints names and never a path value", () => {
    const { root, art, input } = tmp();
    try {
      const q = quiet();
      expect(main(["read-keys", "--in", input, "--artifacts", art], q.deps)).toBe(0);
      const text = q.out.join("\n");
      expect(text).toContain("[Workbench] AutoRebuildScripts=1");
      expect(text).toContain("[Script%20Editor] LastPath (path-like value not shown)");
      expect(text).not.toContain("<v2>\\scripts");
      expect(text).not.toContain("$profile");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
