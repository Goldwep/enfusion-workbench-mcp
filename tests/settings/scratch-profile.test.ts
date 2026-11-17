import { describe, expect, it } from "vitest";
import { iniNameFolded, setValues } from "../../src/settings/ini-edit.js";
import { parseRegText, type RegExport } from "../../src/settings/reg-export.js";
import {
  AUTHORIZATION_RE,
  ScrubRefusal,
  buildScratchIni,
  classifyValue,
  holdsKnownPath,
  identifierReason,
  iniEscapedKey,
  iniEscapedString,
  iniKeyOf,
  iniScriptDebugMode,
  iniSection,
  keyShapeReason,
  percentDecoded,
  scalarText,
  scratchIniFromExport,
  scratchInvariantProblem,
} from "../../src/settings/scratch-profile.js";

// Planted personal data is assembled at test time, never written whole into the repository.
const ACCT = ["tst", "acct"].join("");
const PERSONAL = { accountNames: [ACCT], hostNames: [["TST", "HOST9"].join("")] };
const ROOT = "HKEY_CURRENT_USER\\Software\\Bohemia Interactive\\Arma Reforger Workbench";

/** A registry export from `[subkey, lines[]]` pairs (subkey "" is the root). */
function reg(keys: Array<[string, string[]]>): RegExport {
  const out = ["Windows Registry Editor Version 5.00", ""];
  for (const [sub, lines] of keys) {
    out.push(`[${ROOT}${sub ? `\\${sub}` : ""}]`, ...lines, "");
  }
  return parseRegText(out.join("\r\n"));
}

const BASE: Array<[string, string[]]> = [
  ["", ['"Version"="1"']],
  [
    "Workbench",
    [
      '"NetAPI_Enabled"="1"',
      '"NetAPI_Port"=dword:0000167f',
      '"Theme"="Dark"',
      '"LastProject"="x"',
      '"SteamId"="12345"',
      '"Layout"=hex:01,02',
      `"ProjectDir"="D:\\\\mods\\\\${ACCT}"`,
      '@="default"',
    ],
  ],
  ["Workbench\\RecentFiles", ['"0"="a"']],
  ["World Editor", ['"ScriptDebugMode"="true"', '"CameraSpeed"="12"']],
  ["Workbench\\PropertyGrid\\unnamed", ['"World Editor>Hide"="true"']],
];

describe("escaping (QSettings IniFormat)", () => {
  it("escapes keys, sections and strings", () => {
    expect(iniEscapedKey("World Editor")).toBe("World%20Editor");
    expect(iniEscapedKey("a/b")).toBe("a\\b");
    expect(iniEscapedKey("é")).toBe("%E9");
    expect(iniEscapedKey("Ω")).toBe("%U03A9");
    expect(iniSection([])).toBe("General");
    expect(iniSection(["General"])).toBe("%General");
    expect(iniKeyOf(["Workbench", "PropertyGrid", "unnamed"], "World Editor>Hide")).toBe(
      "PropertyGrid\\unnamed\\World%20Editor%3EHide",
    );
    expect(iniEscapedString("a,b")).toBe('"a,b"');
    expect(iniEscapedString(' x"\\')).toBe('" x\\"\\\\"');
    expect(iniEscapedString("\t\n")).toBe("\\t\\n");
  });

  it("converts scalar types and refuses the rest", () => {
    expect(scalarText({ name: "a", type: "REG_DWORD", text: "ffffffff" })).toBe("4294967295");
    const q = Buffer.alloc(8);
    q.writeBigUInt64LE(5n);
    expect(scalarText({ name: "a", type: "REG_QWORD", bytes: q })).toBe("5");
    expect(scalarText({ name: "a", type: "REG_BINARY", bytes: Buffer.from([1]) })).toBeNull();
  });
});

describe("scrub rules", () => {
  it("drops key shapes and identifier-shaped values", () => {
    expect(keyShapeReason(["Recent Projects"])).toBe("recent-list");
    expect(keyShapeReason(["D:"])).toBe("drive-segment");
    expect(keyShapeReason(["", "x"])).toBe("unc-segment");
    expect(keyShapeReason(["Workbench"])).toBeNull();
    expect(identifierReason("\\\\server\\share")).toBe("unc-path");
    expect(identifierReason("{12345678-1234-1234-1234-123456789abc}")).toBe("guid");
    expect(identifierReason("0123456789abcdef01")).toBe("long-hex-id");
    expect(identifierReason("[U:1:12345]")).toBe("steamid3");
    expect(identifierReason("S-1-5-21-1-2-3")).toBe("windows-sid");
    expect(identifierReason("10.0.0.1")).toBe("ipv4");
    expect(identifierReason("Dark")).toBeNull();
    expect(percentDecoded("C%3A%5Cx")).toBe("C:\\x");
    expect(percentDecoded("plain")).toBeNull();
  });

  it("classifies each value with S-B's reasons", () => {
    const r = reg(BASE);
    const by = (sub: string, name: string) => {
      const k = r.keys.find((x) => x.segments.join("\\") === sub)!;
      return classifyValue(k.segments, k.values.find((v) => v.name === name)!, PERSONAL);
    };
    expect(by("Workbench", "Theme")).toEqual({ keep: true, text: "Dark" });
    expect(by("Workbench", "NetAPI_Port")).toEqual({ keep: true, text: "5759" });
    expect(by("Workbench", "LastProject")).toEqual({ keep: false, reason: "recent-list" });
    expect(by("Workbench", "SteamId")).toEqual({
      keep: false,
      reason: "personal-name:identity-name",
    });
    expect(by("Workbench", "Layout")).toEqual({ keep: false, reason: "type:REG_BINARY" });
    expect(by("Workbench", "ProjectDir")).toEqual({
      keep: false,
      reason: "personal-value:machine-path",
    });
    expect(by("Workbench", "")).toEqual({ keep: false, reason: "default-value" });
    expect(by("Workbench\\RecentFiles", "0")).toEqual({ keep: false, reason: "recent-file-list" });
  });

  it("finds a known absolute path in any slash style", () => {
    expect(holdsKnownPath("x=C:/Tools/Arma/y", ["C:\\Tools\\Arma"])).toBe(true);
    expect(holdsKnownPath("x=C:\\Tools\\Armageddon", ["C:\\Tools\\Arma"])).toBe(false);
    expect(holdsKnownPath("anything", [])).toBe(false);
  });
});

describe("buildScratchIni and scratchIniFromExport", () => {
  it("keeps the scrubbed values, the NET API, and forces ScriptDebugMode=false", () => {
    const r = scratchIniFromExport(reg(BASE), PERSONAL, []);
    expect(r.text).toBe(
      [
        "[General]",
        "Version=1",
        "",
        "[Workbench]",
        "NetAPI_Enabled=1",
        "NetAPI_Port=5759",
        "PropertyGrid\\unnamed\\World%20Editor%3EHide=true",
        "Theme=Dark",
        "",
        "[World%20Editor]",
        "CameraSpeed=12",
        "ScriptDebugMode=false",
        "",
      ].join("\r\n"),
    );
    expect(r.netApi).toEqual({ NetAPI_Enabled: "1", NetAPI_Port: "5759" });
    expect(r.kept).toBe(7);
    expect(r.dropped).toEqual({
      "recent-list": 1,
      "personal-name:identity-name": 1,
      "type:REG_BINARY": 1,
      "personal-value:machine-path": 1,
      "default-value": 1,
      "recent-file-list": 1,
    });
    expect(r.debugLine).toBe("ScriptDebugMode=false");
    expect(r.text).not.toContain(ACCT);
    expect(r.text.split(/\r?\n/).some((l) => AUTHORIZATION_RE.test(l))).toBe(false);
  });

  it("adds ScriptDebugMode when the registry has none", () => {
    const keys = BASE.filter(([s]) => s !== "World Editor");
    const r = scratchIniFromExport(reg(keys), PERSONAL, []);
    expect(iniScriptDebugMode(r.text)).toEqual({ state: "off", line: "ScriptDebugMode=false" });
  });

  it("refuses an export without the NET API, or with it disabled", () => {
    expect(() => buildScratchIni(reg([["Workbench", ['"Theme"="Dark"']]]), PERSONAL, [])).toThrow(
      ScrubRefusal,
    );
    expect(() =>
      buildScratchIni(reg([["Workbench", ['"NetAPI_Enabled"="0"']]]), PERSONAL, []),
    ).toThrow(/not enabled/);
  });

  it("refuses an authorization line and a known path", () => {
    const auth = reg([["Workbench", ['"NetAPI_Enabled"="1"', '"ScriptAuthorizeAll"="1"']]]);
    expect(() => scratchIniFromExport(auth, PERSONAL, [])).toThrow(/authorization/);
    const known = reg([["Workbench", ['"NetAPI_Enabled"="1"', '"Mode"="Tools9"']]]);
    // A relative-looking value that equals a configured path spelling is still refused.
    expect(() => buildScratchIni(known, PERSONAL, ["Tools9"])).toThrow(/known absolute path/);
  });
});

describe("scratch invariants", () => {
  it("reads ScriptDebugMode only in [World%20Editor]", () => {
    expect(iniScriptDebugMode("[Workbench]\nScriptDebugMode=false\n").state).toBe("absent");
    expect(iniScriptDebugMode("[World%20Editor]\nScriptDebugMode=1\n").state).toBe("on");
    expect(iniScriptDebugMode('[World%20Editor]\nScriptDebugMode="0"\n').state).toBe("off");
  });

  it("names what is wrong, or null", () => {
    expect(scratchInvariantProblem("[World%20Editor]\nScriptDebugMode=false\n")).toBeNull();
    expect(scratchInvariantProblem("[World%20Editor]\nScriptDebugMode=true\n")).toMatch(
      /does not read off/,
    );
    expect(scratchInvariantProblem("[Workbench]\nX=1\n")).toMatch(/absent/);
    expect(
      scratchInvariantProblem("[World%20Editor]\nScriptDebugMode=false\nAuthorized=1\n"),
    ).toMatch(/authorization/);
  });
});

describe("escaped spellings of the guarded names (review W8-SET-01)", () => {
  const OFF = "[World%20Editor]\nScriptDebugMode=false\n";

  it("setValues refuses a NetAPI_ key spelled with an escape", () => {
    expect(() =>
      setValues("[Workbench]\nA=1\n", [
        { section: "Workbench", key: "NetAPI%5FEnabled", value: "false", create: true },
      ]),
    ).toThrow(/NET API/);
  });

  it("an escaped second ScriptDebugMode line is refused", () => {
    expect(scratchInvariantProblem(`${OFF}ScriptDebugMod%65=true\n`)).toMatch(/twice/);
  });

  it("an escaped section spelling is read as the debug section", () => {
    expect(iniScriptDebugMode("[World%20Edito%72]\nScriptDebugMode=true\n").state).toBe("on");
    expect(scratchInvariantProblem(`${OFF}[World%20Edito%72]\nScriptDebugMode=true\n`)).toMatch(
      /twice/,
    );
  });

  it("an escaped authorization key is refused", () => {
    expect(scratchInvariantProblem(`${OFF}[Workbench]\nScript%41uthorizeAll=true\n`)).toMatch(
      /authorization/,
    );
  });

  it("the plain scratch shape still passes", () => {
    expect(scratchInvariantProblem(`${OFF}[Workbench]\nA=1\nB=2\n`)).toBeNull();
    expect(iniNameFolded("World%20Editor")).toBe("world editor");
    expect(iniNameFolded("a%U00E9\\b")).toBe("a\u00e9/b");
  });
});
