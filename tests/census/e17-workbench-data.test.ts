import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadConfig } from "../../src/config.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import {
  comparePaks,
  documentationLinkRows,
  enumerate,
  extOf,
  loadRealSources,
  measureScope,
  memoryPak,
  observationFileText,
  parseConf,
  parseMemberDecl,
  resolveOwners,
  run as runE17,
  scanScript,
  scopeFamily,
  splitArgs,
  stripBlockComments,
  tokenize,
  totalsOf,
  welcomeRows,
  type PakLike,
  type Sources,
} from "../../scripts/census/enumerators/e17-workbench-data.js";
import { makeCensus, runIn, writeObservations } from "./helpers.js";

// ── Synthetic input ──────────────────────────────────────────────────────────

const DOC_LINKS = [
  "WBDocumentation {",
  " Links {",
  '  WBDocumentationLink "{1111111111111111}" {',
  '   Key "Resource Manager"',
  '   LinkURL "https://example.test/wiki/Resource_Manager"',
  "  }",
  '  WBDocumentationLink "{2222222222222222}" {',
  '   Key "Script Editor"',
  '   LinkURL "https://example.test/wiki/Script_Editor"',
  "  }",
  '  WBDocumentationLink "{3333333333333333}" {',
  '   Key "Something Else"',
  '   LinkURL "https://example.test/wiki/Something_Else"',
  "  }",
  " }",
  "}",
  "",
].join("\n");

const WELCOME = [
  "WelcomeScreen {",
  ' LogoLink WelcomeScreenLink "{4444444444444444}" {',
  '  LinkText "Visit the site"',
  '  LinkURL "https://example.test/"',
  " }",
  ' LogoImagePath ":/Synthetic/logo.png"',
  " Links {",
  '  WelcomeScreenLink "{5555555555555555}" {',
  '   LinkText "Docs for mods"',
  '   LinkURL "https://example.test/mods"',
  "  }",
  '  WelcomeScreenLink "{6666666666666666}" {',
  '   LinkText "Forum"',
  '   LinkURL "https://example.test/forum"',
  "  }",
  " }",
  "}",
  "",
].join("\n");

/** Scripts that exercise every way a config file is tied to a plugin member. */
const SCRIPT_A = [
  "#ifdef WORKBENCH",
  '[WorkbenchPluginAttribute(name: "Sample A", wbModules: { "ScriptEditor" })]',
  "class SCR_SampleAPlugin : ScriptEditorPlugin",
  "{",
  '\t[Attribute(defvalue: "{AAAAAAAAAAAAAAAA}Configs/Workbench/SampleA/Default.conf", desc: "Pick the A config.", params: "conf")]',
  "\tprotected ResourceName m_sConfig;",
  "",
  '\t[Attribute(defvalue: "{BBBBBBBBBBBBBBBB}Configs/Workbench/SampleA/Missing.conf", params: "conf")]',
  "\tprotected ResourceName m_sMissing;",
  "",
  '\tprotected static const ResourceName HARD = "{CCCCCCCCCCCCCCCC}Configs/Workbench/SampleA/Hard.conf";',
  "}",
  "",
].join("\n");

const SCRIPT_B = [
  '[WorkbenchToolAttribute("Sample B", "desc")]',
  "class SCR_SampleBTool : WorldEditorTool",
  "{",
  '\t[Attribute(desc: "Takes a SCR_BConfig .conf")]',
  "\tprotected ref SCR_BConfig m_Cfg;",
  "}",
  "",
].join("\n");

const SCRIPT_C = [
  '[WorkbenchPluginAttribute(name: "Sample C", wbModules: { "ResourceManager", "WorldEditor" })]',
  "class SCR_SampleCPlugin : ResourceManagerPlugin",
  "{",
  '\t[Attribute("", UIWidgets.ResourceNamePicker, "Pick a C config.", "conf", null, "Settings")]',
  "\tprotected ResourceName m_sPick;",
  "",
  "\tvoid Run()",
  "\t{",
  "\t\tSCR_CTemplates t = SCR_CTemplates.Cast(null);",
  "\t}",
  "}",
  "",
  "class SCR_CTemplates",
  "{",
  "}",
  "",
].join("\n");

const SCRIPT_D = [
  "/*",
  "#ifdef WORKBENCH",
  '[WorkbenchPluginAttribute(name: "Commented out", wbModules: { "WorldEditor" })]',
  "class SCR_SampleDPlugin : WorkbenchPlugin",
  "{",
  '\t[Attribute(defvalue: "{DDDDDDDDDDDDDDDD}Configs/Workbench/SampleD/D.conf", params: "conf")]',
  "\tprivate ResourceName m_Config;",
  "}",
  "#endif",
  "*/",
  "",
].join("\n");

const SCRIPT_E = [
  '[WorkbenchPluginAttribute(name: "Sample E")]',
  "class SCR_SampleEPlugin : WorkbenchPlugin",
  "{",
  '\tprotected static const ResourceName DEFAULT_CONFIG = "{EEEEEEEEEEEEEEEE}Configs/Workbench/SampleE/Base.conf";',
  "",
  '\t[Attribute(defvalue: DEFAULT_CONFIG, params: "conf class=SCR_EConfig")]',
  "\tprotected ResourceName m_sConfig;",
  "}",
  "",
].join("\n");

const SCRIPT_URL = [
  "class Helper",
  "{",
  '\tstatic string Link() { return "enfusion://WorldEditor/%1;%2,%3,%4"; }',
  "}",
  "",
].join("\n");

const CONF_A_DEFAULT = ["SCR_AConfig {", ' m_sName "default"', "}", ""].join("\n");
const CONF_A_ALT = ["SCR_AConfig {", ' m_sName "alt"', "}", ""].join("\n");
const CONF_A_OTHER = ["SCR_OtherConfig {", ' m_sName "other root"', "}", ""].join("\n");
const CONF_B = ["SCR_BConfig {", " m_aItems {", " }", "}", ""].join("\n");
const CONF_C = ["SCR_CTemplates {", " m_aItems {", " }", "}", ""].join("\n");
const CONF_E_BASE = [
  "SCR_EConfig {",
  ' m_Child "{FFFFFFFFFFFFFFFF}Configs/Workbench/SampleE/Child.conf"',
  "}",
  "",
].join("\n");
const CONF_E_CHILD = ["SCR_EChild {", " m_x 1", "}", ""].join("\n");
const CONF_LOOSE = ["SCR_LooseConfig {", " m_y 2", "}", ""].join("\n");

const GAME_FILES: Record<string, string | Buffer> = {
  "Configs/Workbench/documentationLinks.conf": DOC_LINKS,
  "Configs/Workbench/welcomeScreen.conf": WELCOME,
  "Configs/Workbench/SampleA/Default.conf": CONF_A_DEFAULT,
  "Configs/Workbench/SampleA/Alt.conf": CONF_A_ALT,
  "Configs/Workbench/SampleA/Other.conf": CONF_A_OTHER,
  "Configs/Workbench/SampleB/One.conf": CONF_B,
  "Configs/Workbench/SampleC/Pick.conf": CONF_C,
  "Configs/Workbench/SampleE/Base.conf": CONF_E_BASE,
  "Configs/Workbench/SampleE/Child.conf": CONF_E_CHILD,
  "Configs/Workbench/Loose/Loose.conf": CONF_LOOSE,
  "WBData/WorldEditor/EntityIcons/Misc/Icon_X.xob": Buffer.from([1, 2, 3]),
  "system/wbdata/WorldEditor/EntityIcons/Circle/Circle.et": [
    'EntityEditIcon : "{165311FA5B10DE3F}system/wbdata/WorldEditor/EntityIcons/EntityEditIcon.et" {',
    ' Object "{51FA2C4DEBF39945}system/wbdata/WorldEditor/EntityIcons/Circle/Circle.xob"',
    "}",
    "",
  ].join("\n"),
  "system/wbdata/Gizmo3D/axisX.xob": Buffer.from([9, 9]),
  // World Editor icon prefab and material that inherit from system/wbdata (outside the scope folders).
  "Prefabs/WorldEditor/EntityIcons/Decal/CameraDecal.et": [
    'GenericEntity : "{8BB60986CA224508}system/wbdata/WorldEditor/EntityIcons/Decal/Decal.et" {',
    ' AssignedMaterial "{0123456789ABCDEF}Prefabs/WorldEditor/EntityIcons/Decal/CameraDecal.emat"',
    "}",
    "",
  ].join("\n"),
  "Prefabs/WorldEditor/EntityIcons/Decal/CameraDecal.emat": [
    'MatPBRBasic : "{AAAAAAAAAAAAAAAA}system/wbdata/Materials/Base.emat" {',
    "}",
    "",
  ].join("\n"),
  "scripts/WorkbenchGame/ScriptEditor/SCR_SampleAPlugin.c": SCRIPT_A,
  "scripts/WorkbenchGame/WorldEditor/SCR_SampleBTool.c": SCRIPT_B,
  "scripts/WorkbenchGame/ResourceManager/SCR_SampleCPlugin.c": SCRIPT_C,
  "scripts/WorkbenchGame/WorldEditor/SCR_SampleDPlugin.c": SCRIPT_D,
  "scripts/WorkbenchGame/WorldEditor/SCR_SampleEPlugin.c": SCRIPT_E,
  "scripts/Game/Helper.c": SCRIPT_URL,
  "Prefabs/Props/Crate.et": "GenericEntity {\n}\n",
};

const TOOLS_FILES: Record<string, string | Buffer> = {
  "system/wbdata/Gizmo3D/axisX.xob": Buffer.from([9, 9]),
  "system/wbdata/WorldEditor/EntityIcons/Circle/Circle.et": [
    'EntityEditIcon : "{165311FA5B10DE3F}system/wbdata/WorldEditor/EntityIcons/EntityEditIcon.et" {',
    ' Object "{51FA2C4DEBF39945}system/wbdata/WorldEditor/EntityIcons/Circle/Circle.xob"',
    "}",
    "",
  ].join("\n"),
  "configs/inputCommon.conf": "x\n",
};

function synthetic(): Sources {
  return { game: memoryPak(GAME_FILES), tools: memoryPak(TOOLS_FILES) };
}

function rowsOf(text: string): Record<string, unknown>[] {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ── Units ────────────────────────────────────────────────────────────────────

describe("e17 scope and measurement", () => {
  it("names the family of a path, ignoring case of the folder names", () => {
    expect(scopeFamily("Configs/Workbench/x.conf")).toBe("Configs/Workbench");
    expect(scopeFamily("configs/workbench/x.conf")).toBe("Configs/Workbench");
    expect(scopeFamily("WBData/a/b.xob")).toBe("WBData");
    expect(scopeFamily("system/wbdata/Gizmo3D/a.xob")).toBe("system/wbdata");
    expect(scopeFamily("WorkbenchStuff/a.txt")).toBe("WorkbenchStuff");
    expect(scopeFamily("Configs/Weapons/a.conf")).toBeNull();
    expect(scopeFamily("scripts/WorkbenchGame/a.c")).toBeNull();
    expect(scopeFamily("system/textures/a.edds")).toBeNull();
  });

  it("counts files per family and extension, sorted", () => {
    const m = measureScope(synthetic().game);
    expect(m["Configs/Workbench"]).toEqual({ files: 10, byExt: { ".conf": 10 } });
    expect(m["WBData"]).toEqual({ files: 1, byExt: { ".xob": 1 } });
    expect(m["system/wbdata"]).toEqual({ files: 2, byExt: { ".et": 1, ".xob": 1 } });
    expect(Object.keys(m)).toEqual(["Configs/Workbench", "WBData", "system/wbdata"]);
    expect(extOf("a/b/c")).toBe("(none)");
    expect(extOf("a/B.EDDS")).toBe(".edds");
  });

  it("compares in-scope files: identical, differs, game-only, tools-only, size-only", () => {
    const game = memoryPak({
      "system/wbdata/a.xob": "same",
      "system/wbdata/b.xob": "game version",
      "system/wbdata/c.xob": "only here",
      "system/wbdata/big.edds": "0123456789",
      "Prefabs/x.et": "ignored out of scope",
    });
    const tools: PakLike = {
      ...memoryPak({
        "system/wbdata/a.xob": "same",
        "system/wbdata/b.xob": "tools version",
        "system/wbdata/d.xob": "tools only",
        "system/wbdata/big.edds": "0123456789",
      }),
      readFile: (p) => {
        if (p.endsWith("big.edds")) throw new Error("over the read cap");
        return Buffer.from(
          p.endsWith("a.xob") ? "same" : p.endsWith("b.xob") ? "tools version" : "tools only",
        );
      },
    };
    const e = comparePaks(game, tools, "in-scope");
    const by = Object.fromEntries(e.map((x) => [x.path, x]));
    expect(by["system/wbdata/a.xob"]).toMatchObject({ status: "identical", method: "sha256" });
    expect(by["system/wbdata/b.xob"]).toMatchObject({ status: "differs", method: "sha256" });
    expect(by["system/wbdata/c.xob"]).toMatchObject({ status: "game-only" });
    expect(by["system/wbdata/d.xob"]).toMatchObject({ status: "tools-only" });
    expect(by["system/wbdata/big.edds"]).toMatchObject({ status: "identical", method: "size" });
    expect(by["Prefabs/x.et"]).toBeUndefined();
    expect(totalsOf(e)).toEqual({
      identical: 2,
      differs: 1,
      "game-only": 1,
      "tools-only": 1,
      size_only: 1,
    });
    // "all" compares every Tools-pak path.
    expect(comparePaks(game, tools, "all").map((x) => x.path)).toEqual([
      "system/wbdata/a.xob",
      "system/wbdata/b.xob",
      "system/wbdata/big.edds",
      "system/wbdata/d.xob",
    ]);
  });
});

describe("e17 config parsing", () => {
  it("tokenizes quoted strings as one token", () => {
    expect(tokenize('LogoLink WelcomeScreenLink "{4444444444444444}" ')).toEqual([
      "LogoLink",
      "WelcomeScreenLink",
      "{4444444444444444}",
    ]);
    expect(tokenize('Key "a b \\"c\\""')).toEqual(["Key", 'a b "c"']);
  });

  it("builds a block tree with line numbers", () => {
    const root = parseConf(DOC_LINKS);
    const top = root.children[0];
    expect(top.head).toEqual(["WBDocumentation"]);
    expect(top.line).toBe(1);
    const links = top.children[0];
    expect(links.head).toEqual(["Links"]);
    expect(links.children).toHaveLength(3);
    expect(links.children[1].props.find((p) => p.key === "LinkURL")?.line).toBe(9);
  });

  it("emits a link-format row per documentation link, citing the LinkURL line", () => {
    const rows = documentationLinkRows(DOC_LINKS);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      dim: "link",
      kind: "link-format",
      module: "ResourceManager",
      key: { name: "https://example.test/wiki/Resource_Manager" },
      label: "Resource Manager",
      ref: "pak:Configs/Workbench/documentationLinks.conf#L5",
      quote: 'LinkURL "https://example.test/wiki/Resource_Manager"',
      confidence: "high",
      parent_key: null,
    });
    expect(rows[1].module).toBe("ScriptEditor");
    expect(rows[2].module).toBe("Shared");
    for (const r of rows) {
      const key = r.key.name ?? "";
      expect(/\s/.test(key)).toBe(false);
    }
  });

  it("emits the Welcome panel with its links as children", () => {
    const w = welcomeRows(WELCOME);
    expect(w.panel).toMatchObject({
      dim: "ui",
      kind: "panel",
      module: "none",
      key: { path: ["WelcomeScreen"] },
      ref: "pak:Configs/Workbench/welcomeScreen.conf#L1",
      quote: "WelcomeScreen {",
      children_count: 3,
      confidence: "medium",
    });
    expect(w.panel?.unverified?.length).toBe(2);
    expect(w.links.map((l) => l.label)).toEqual(["Visit the site", "Docs for mods", "Forum"]);
    expect(w.links.map((l) => l.ref)).toEqual([
      "pak:Configs/Workbench/welcomeScreen.conf#L4",
      "pak:Configs/Workbench/welcomeScreen.conf#L10",
      "pak:Configs/Workbench/welcomeScreen.conf#L14",
    ]);
    expect(w.links.every((l) => l.parent_key?.kind === "panel")).toBe(true);
    expect(w.unrowed).toEqual([{ key: "LogoImagePath", value: ":/Synthetic/logo.png", line: 6 }]);
  });

  it("returns nothing for text that is not a WelcomeScreen", () => {
    expect(welcomeRows("Other {\n}\n")).toEqual({ panel: null, links: [], unrowed: [] });
    expect(documentationLinkRows("Other {\n}\n")).toEqual([]);
  });
});

describe("e17 script scan", () => {
  it("removes block comments but keeps line numbers and strings", () => {
    const text = 'a /* x\ny */ b\n"/* not a comment */" // line /* c\nz';
    const out = stripBlockComments(text);
    expect(out.split("\n")).toHaveLength(4);
    expect(out).toContain('"/* not a comment */"');
    expect(out).not.toContain("x\n");
    expect(out.split("\n")[1].trim()).toBe("b");
  });

  it("splits attribute arguments at top-level commas", () => {
    expect(splitArgs('"a, b", UIWidgets.X, desc: "d, e", foo(1, 2), { "x", "y" }')).toEqual([
      '"a, b"',
      "UIWidgets.X",
      'desc: "d, e"',
      "foo(1, 2)",
      '{ "x", "y" }',
    ]);
  });

  it("reads member declarations and rejects methods", () => {
    expect(parseMemberDecl("\tprotected ref array<ResourceName> m_aX = {};")).toEqual({
      type: "array<ResourceName>",
      name: "m_aX",
    });
    expect(parseMemberDecl("\tprotected ResourceName m_sConfig;")).toEqual({
      type: "ResourceName",
      name: "m_sConfig",
    });
    expect(parseMemberDecl("\tvoid Run()")).toBeNull();
  });

  it("finds plugin and tool classes with their Attribute members, skipping commented ones", () => {
    const a = scanScript("a.c", stripBlockComments(SCRIPT_A));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      name: "SCR_SampleAPlugin",
      kind: "plugin",
      modules: ["ScriptEditor"],
    });
    expect(a[0].members.map((m) => m.name)).toEqual(["m_sConfig", "m_sMissing"]);
    expect(a[0].members[0]).toMatchObject({
      line: 5,
      lineEnd: 5,
      signature: "ResourceName m_sConfig",
    });
    expect(a[0].consts).toEqual({
      HARD: "{CCCCCCCCCCCCCCCC}Configs/Workbench/SampleA/Hard.conf",
    });
    expect(scanScript("b.c", SCRIPT_B)[0]).toMatchObject({ name: "SCR_SampleBTool", kind: "tool" });
    expect(scanScript("d.c", stripBlockComments(SCRIPT_D))).toEqual([]);
    // Without the stripper the commented plugin would be seen: the stripper matters.
    expect(scanScript("d.c", SCRIPT_D)).toHaveLength(1);
  });
});

describe("e17 owners of config files", () => {
  function resolved(): ReturnType<typeof resolveOwners> {
    const game = GAME_FILES;
    const confs = Object.keys(game)
      .filter((p) => /^Configs\/Workbench\/Sample[A-E]|^Configs\/Workbench\/Loose/.test(p))
      .map((path) => {
        const text = String(game[path]);
        return { path, size: text.length, rootClass: parseConf(text).children[0].head[0], text };
      });
    const classes = [
      "SCR_SampleAPlugin.c",
      "SCR_SampleBTool.c",
      "SCR_SampleCPlugin.c",
      "SCR_SampleEPlugin.c",
    ].flatMap((f) => {
      const p = Object.keys(game).find((k) => k.endsWith(f)) as string;
      return scanScript(p, stripBlockComments(String(game[p])));
    });
    const lines = new Map(
      classes.map((c) => [c.file, stripBlockComments(String(game[c.file])).split("\n")]),
    );
    return resolveOwners(confs, classes, lines);
  }

  it("links by attribute path, by class, by sibling, and by class body", () => {
    const r = resolved();
    const by = Object.fromEntries(
      r.owners.map((o) => [`${o.cls.name}#${o.member.name}`, Object.fromEntries(o.confs)]),
    );
    expect(by["SCR_SampleAPlugin#m_sConfig"]).toEqual({
      "Configs/Workbench/SampleA/Default.conf": "attribute-path",
      "Configs/Workbench/SampleA/Alt.conf": "sibling",
    });
    expect(by["SCR_SampleBTool#m_Cfg"]).toEqual({
      "Configs/Workbench/SampleB/One.conf": "attribute-class",
    });
    expect(by["SCR_SampleCPlugin#m_sPick"]).toEqual({
      "Configs/Workbench/SampleC/Pick.conf": "class-body",
    });
    expect(by["SCR_SampleEPlugin#m_sConfig"]).toEqual({
      "Configs/Workbench/SampleE/Base.conf": "attribute-path",
    });
  });

  it("reports sub-configs, unlinked files, dangling defaults and hard-wired paths", () => {
    const r = resolved();
    expect([...r.subConfigs]).toEqual([
      ["Configs/Workbench/SampleE/Child.conf", "Configs/Workbench/SampleE/Base.conf"],
    ]);
    expect(r.unlinked).toEqual([
      "Configs/Workbench/Loose/Loose.conf",
      "Configs/Workbench/SampleA/Other.conf",
    ]);
    expect(r.dangling).toEqual([
      {
        script: "scripts/WorkbenchGame/ScriptEditor/SCR_SampleAPlugin.c",
        line: 8,
        literal: "Configs/Workbench/SampleA/Missing.conf",
      },
    ]);
    // HARD is a constant outside any attribute; DEFAULT_CONFIG is used by one, so it is not hard-wired.
    expect(r.hardWired.map((h) => [h.literal, h.exists])).toEqual([
      ["Configs/Workbench/SampleA/Hard.conf", false],
    ]);
  });
});

// ── Whole enumeration over a synthetic pak ───────────────────────────────────

describe("e17 enumeration", () => {
  it("emits the expected rows and passes its own gate", () => {
    const r = enumerate(synthetic());
    expect(r.problems).toEqual([]);
    const kinds: Record<string, number> = {};
    for (const o of r.observations) kinds[o.obs.kind] = (kinds[o.obs.kind] ?? 0) + 1;
    expect(kinds).toEqual({ "link-format": 6, panel: 1, "plugin-setting": 4 });
    const ids = r.observations.map((o) => o.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("plugin:SCR_SampleAPlugin#attr:m_sConfig");
    // A member whose only config path is absent from the paks gives no row.
    expect(ids.some((i) => i.includes("m_sMissing"))).toBe(false);
    expect(ids).toContain("link:https://example.test/mods");
    expect(ids).toContain("ui:none/panel/WelcomeScreen");
    // Weak links (sibling-only or class-body) give medium confidence.
    const byId = Object.fromEntries(r.observations.map((o) => [o.id, o.obs]));
    expect(byId["plugin:SCR_SampleCPlugin#attr:m_sPick"].confidence).toBe("medium");
    expect(byId["plugin:SCR_SampleAPlugin#attr:m_sConfig"].confidence).toBe("high");
    // Modules, by the rule shared with E03, E15 and E18: a single wbModules
    // entry gives the module; none (whatever the base class) or several give Shared.
    expect(byId["plugin:SCR_SampleAPlugin#attr:m_sConfig"].module).toBe("ScriptEditor");
    expect(byId["plugin:SCR_SampleBTool#attr:m_Cfg"].module).toBe("Shared");
    expect(byId["plugin:SCR_SampleCPlugin#attr:m_sPick"].module).toBe("Shared");
    // The parent of a setting names its class with the right kind.
    expect(byId["plugin:SCR_SampleBTool#attr:m_Cfg"].parent_key).toMatchObject({
      kind: "tool",
      key: { class: "SCR_SampleBTool" },
    });
    // The commented-out plugin gives nothing.
    expect(ids.some((i) => i.includes("SampleD"))).toBe(false);
  });

  it("lists what it leaves out, with counts", () => {
    const r = enumerate(synthetic());
    const left = Object.fromEntries(r.leftOut.map((l) => [l.what.split(" (")[0], l.count]));
    expect(
      left["WBData asset files"] ??
        left["WBData asset files (meshes, materials, textures, prefabs)"],
    ).toBe(1);
    expect(r.leftOut.find((l) => l.what.startsWith("system/wbdata"))?.count).toBe(2);
    expect(r.leftOut.find((l) => l.what.includes("sub-configs"))?.count).toBe(1);
    expect(r.leftOut.find((l) => l.what.includes("no plugin member"))?.count).toBe(2);
    expect(r.leftOut.find((l) => l.what.includes("absent from the paks"))?.count).toBe(1);
    expect(r.leftOut.find((l) => l.what.includes("LogoImagePath"))?.count).toBe(1);
    expect(r.leftOut.find((l) => l.what.includes("enfusion://"))?.count).toBe(1);
    expect(r.icons).toEqual([
      {
        path: "Prefabs/WorldEditor/EntityIcons/Decal/CameraDecal.emat",
        ext: ".emat",
        parent: "system/wbdata/Materials/Base.emat",
        object: "",
        material: "",
      },
      {
        path: "Prefabs/WorldEditor/EntityIcons/Decal/CameraDecal.et",
        ext: ".et",
        parent: "system/wbdata/WorldEditor/EntityIcons/Decal/Decal.et",
        object: "",
        material: "Prefabs/WorldEditor/EntityIcons/Decal/CameraDecal.emat",
      },
      {
        path: "system/wbdata/WorldEditor/EntityIcons/Circle/Circle.et",
        ext: ".et",
        parent: "system/wbdata/WorldEditor/EntityIcons/EntityEditIcon.et",
        object: "system/wbdata/WorldEditor/EntityIcons/Circle/Circle.xob",
        material: "",
      },
    ]);
    // The scan for data-driven UI definitions finds no definition file in scope.
    expect(r.uiScan.uiExtFiles).toEqual([]);
    expect(r.uiScan.matches).toEqual([]);
  });

  it("is deterministic and writes only placeholders", () => {
    const a = observationFileText(enumerate(synthetic()), "9.9.9.9");
    const b = observationFileText(enumerate(synthetic()), "9.9.9.9");
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(containsMachinePath(a)).toBe(false);
    const header = JSON.parse(a.split("\n")[0]) as Record<string, unknown>;
    expect(header).toMatchObject({
      $header: 1,
      build: "9.9.9.9",
      enumerator: "E17",
      generator: "scripts/census/enumerators/e17-workbench-data.ts",
      provisional: false,
      row_count: 11,
    });
    const inputs = header.inputs as { path: string; sha256: string }[];
    expect(
      inputs.every((i) => i.path.startsWith("<game>/addons#") && /^[0-9a-f]{64}$/.test(i.sha256)),
    ).toBe(true);
    expect(inputs.map((i) => i.path)).toEqual([...inputs.map((i) => i.path)].sort());
  });

  it("hashes the pak bytes of every input, CRLF scripts included", () => {
    const crlf = SCRIPT_A.replace(/\r?\n/g, "\r\n");
    const files = {
      ...GAME_FILES,
      "scripts/WorkbenchGame/ScriptEditor/SCR_SampleAPlugin.c": crlf,
    };
    const r = enumerate({ game: memoryPak(files), tools: null });
    const want = createHash("sha256").update(Buffer.from(crlf)).digest("hex");
    const got = r.inputs.find((i) => i.path.endsWith("SCR_SampleAPlugin.c"));
    expect(got?.sha256).toBe(want);
    for (const i of r.inputs) {
      const v = i.path.replace("<game>/addons#", "");
      const bytes = memoryPak(files).readFile(v);
      expect(i.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("enumerates without a Tools pak, skipping the comparison", () => {
    const r = enumerate({ game: memoryPak(GAME_FILES), tools: null });
    expect(r.problems).toEqual([]);
    expect(r.compare).toBeNull();
    expect(r.measure.tools).toBeNull();
  });
});

// ── CLI and ledger acceptance ────────────────────────────────────────────────

describe("e17 run and ledger", () => {
  it("writes its observation file and the artifacts tables", () => {
    const fx = makeCensus("1.0.0.1");
    const art = mkdtempSync(join(tmpdir(), "e17-art-"));
    const r = runIn(fx, (argv, io) => runE17(argv, io, () => synthetic()), ["--artifacts", art]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("E17 at build 1.0.0.1: 11 observations");
    const file = join(fx.root, "observations", "E17", "1.0.0.1.jsonl");
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(join(fx.root, "observations"))).toEqual(["E17"]);
    const dir = join(art, "census", "1.0.0.1", "E17");
    expect(readdirSync(dir).sort()).toEqual([
      "config-owners.tsv",
      "entity-icons.tsv",
      "inventory.tsv",
      "summary.json",
      "tools-vs-game.tsv",
    ]);
    const owners = readFileSync(join(dir, "config-owners.tsv"), "utf-8");
    expect(owners).toContain("SCR_SampleAPlugin#m_sConfig\tattribute-path");
    expect(containsMachinePath(owners)).toBe(false);
    // Byte-identical on a second run.
    const first = readFileSync(file, "utf-8");
    runIn(fx, (argv, io) => runE17(argv, io, () => synthetic()), ["--artifacts", art]);
    expect(readFileSync(file, "utf-8")).toBe(first);
  });

  it("answers NO DATA without a game pak, and refuses --out elsewhere", () => {
    const fx = makeCensus("1.0.0.1");
    const none = runIn(fx, (argv, io) => runE17(argv, io, () => ({ game: null, tools: null })), [
      "--no-artifacts",
    ]);
    expect(none.code).toBe(2);
    expect(none.stdout).toContain("NO DATA");
    expect(existsSync(join(fx.root, "observations", "E17"))).toBe(false);
    const bad = runIn(fx, (argv, io) => runE17(argv, io, () => synthetic()), [
      "--no-artifacts",
      "--out",
      join(fx.root, "observations", "E02", "x.jsonl"),
    ]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("refusing --out outside observations/E17/");
  });

  it("refuses an artifacts folder inside a git working tree", () => {
    const fx = makeCensus("1.0.0.1");
    mkdirSync(join(fx.repo, ".git"), { recursive: true });
    const r = runIn(fx, (argv, io) => runE17(argv, io, () => synthetic()), [
      "--artifacts",
      join(fx.repo, "art"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("inside a git working tree");
  });

  it("builds into a ledger with no rejected line and no problem naming its rows", () => {
    const fx = makeCensus("1.0.0.1");
    expect(
      runIn(fx, (argv, io) => runE17(argv, io, () => synthetic()), ["--no-artifacts"]).code,
    ).toBe(0);
    // E03 is not part of this fixture: stand in for it with the plugin rows E17's settings hang from.
    const plugin = (
      cls: string,
      kind: "plugin" | "tool",
      module: string,
    ): Record<string, unknown> => ({
      dim: "plugin",
      kind,
      module,
      key: { class: cls },
      parent_key: null,
      origin: "vanilla",
      ref: `pak:scripts/${cls}.c#L1`,
      confidence: "high",
    });
    const before = buildLedger(fx.paths);
    expect(before.rejected).toEqual([]);
    expect(before.problems.every((p) => p.message.includes("has no row"))).toBe(true);
    expect(before.problems.length).toBeGreaterThan(0);
    writeObservations(fx, "E03", "1.0.0.1", [
      plugin("SCR_SampleAPlugin", "plugin", "ScriptEditor"),
      plugin("SCR_SampleBTool", "tool", "WorldEditor"),
      plugin("SCR_SampleCPlugin", "plugin", "Shared"),
      plugin("SCR_SampleEPlugin", "plugin", "Shared"),
    ]);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    const own = built.rows.filter((r) => r.sources.some((s) => s.enumerator === "E17"));
    expect(own).toHaveLength(11);
    const panel = own.find((r) => r.id === "ui:none/panel/WelcomeScreen");
    expect(panel?.children_enumerated).toBe(true);
    expect(panel?.children_count).toBe(3);
    const link = own.find((r) => r.id === "link:https://example.test/mods");
    expect(link?.parent).toBe("ui:none/panel/WelcomeScreen");
    const setting = own.find((r) => r.id === "plugin:SCR_SampleBTool#attr:m_Cfg");
    expect(setting?.parent).toBe("plugin:SCR_SampleBTool");
    expect(setting?.kind).toBe("plugin-setting");
  });

  it("rejects a hand-edited line that breaks the ledger rules (the gate is real)", () => {
    const fx = makeCensus("1.0.0.1");
    runIn(fx, (argv, io) => runE17(argv, io, () => synthetic()), ["--no-artifacts"]);
    const file = join(fx.root, "observations", "E17", "1.0.0.1.jsonl");
    const text = readFileSync(file, "utf-8").split("\n");
    // A kind E17 may not emit.
    const row = JSON.parse(text[1]) as Record<string, unknown>;
    row.kind = "menu";
    row.dim = "ui";
    row.key = { path: ["X"] };
    text[1] = JSON.stringify(row);
    mkdirSync(join(fx.root, "observations", "E17"), { recursive: true });
    writeObservations(fx, "E17", "1.0.0.1", text.slice(1, -1), { row_count: text.length - 2 });
    const built = buildLedger(fx.paths);
    expect(built.rejected.length).toBeGreaterThan(0);
  });
});

// ── The real install (skipped when the game path is absent) ──────────────────

const realGameAvailable = (() => {
  try {
    return existsSync(join(loadConfig().gamePath, "addons"));
  } catch {
    return false;
  }
})();

describe.skipIf(!realGameAvailable)("e17 against the real install", () => {
  let sources: Sources;
  let result: ReturnType<typeof enumerate>;

  beforeAll(() => {
    const s = loadRealSources();
    if (!s.game) throw new Error("no game pak");
    sources = { game: s.game, tools: s.tools };
    result = enumerate(sources);
  }, 180_000);

  afterAll(() => {
    // Nothing to clean: the paks are only read.
  });

  it("measures the Workbench-owned folders", () => {
    expect(result.measure.game).toEqual({
      "Configs/Workbench": { files: 53, byExt: { ".conf": 53 } },
      WBData: { files: 8, byExt: { ".edds": 7, ".xob": 1 } },
      "system/wbdata": {
        files: 69,
        byExt: { ".edds": 4, ".emat": 22, ".et": 10, ".ptc": 1, ".xob": 32 },
      },
    });
    if (sources.tools) {
      expect(result.measure.tools).toEqual({
        "system/wbdata": {
          files: 69,
          byExt: { ".edds": 4, ".emat": 22, ".et": 10, ".ptc": 1, ".xob": 32 },
        },
      });
      expect(totalsOf(result.compare?.entries ?? [])).toEqual({
        identical: 69,
        differs: 0,
        "game-only": 61,
        "tools-only": 0,
        size_only: 0,
      });
    }
  });

  it("emits 31 rows and passes the gate", () => {
    expect(result.problems).toEqual([]);
    const kinds: Record<string, number> = {};
    for (const o of result.observations) kinds[o.obs.kind] = (kinds[o.obs.kind] ?? 0) + 1;
    expect(kinds).toEqual({ "link-format": 17, panel: 1, "plugin-setting": 13 });
    const gamePaths = new Set(sources.game.allFilePaths());
    for (const o of result.observations) {
      const m = /^pak:([^#]+)/.exec(o.obs.ref);
      expect(m && gamePaths.has(m[1])).toBe(true);
    }
  });

  it("finds no data-driven menu, toolbar, dock, shortcut or layout definition in scope", () => {
    expect(result.uiScan.uiExtFiles).toEqual([]);
    // The word matches are loc-parser rule text and script-template text, never a definition.
    const files = new Set(result.uiScan.matches.map((m) => m.path));
    expect([...files].sort()).toEqual([
      "Configs/Workbench/LocParser/KeyBindingMenu.conf",
      "Configs/Workbench/ScriptTemplatePlugin/ScriptTemplateConfig.conf",
    ]);
    expect(result.uiScan.nameCandidates.filter((c) => c.pak === "tools")).toEqual([]);
  });

  it("writes the same bytes twice", () => {
    expect(observationFileText(result, "1.8.0.13")).toBe(
      observationFileText(enumerate(sources), "1.8.0.13"),
    );
    expect(rowsOf(observationFileText(result, "1.8.0.13"))).toHaveLength(31);
  }, 180_000);
});
