/**
 * E06 settings store: the .reg parser, the Qt storage formats, the saved
 * window-state decode, the personal-data rules, the plugin filter against a
 * source index, the observation file (determinism, refs, header hashes), its
 * acceptance by the ledger in a temporary census, and (when the registry
 * export and the source index are present) the headline counts of build
 * 1.8.0.13. The registry text, the window states, the source index and every
 * planted personal value are built inside the test; nothing is copied from a
 * real export, and planted values are assembled here, never written whole.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/census/build-ledger.js";
import { sha256 } from "../../src/census/canon.js";
import { deriveId } from "../../src/census/ids.js";
import {
  buildSourceIndex,
  parseSourceIndexText,
  saveSourceIndex,
  sourceIndexPath,
} from "../../src/census/source-index.js";
import {
  REG_NAME,
  categoryModule,
  compareLayouts,
  decodeQtByteArray,
  decodeRegText,
  decodeSavedState,
  e05LayoutRows,
  extract,
  gateScan,
  looksLikeOption,
  parsePluginBlock,
  parseRegText,
  personalContextFromEnv,
  personalReason,
  pluginClassesOf,
  qtWrapper,
  run as runE06,
  subtreeReason,
  valueShape,
  valueSignature,
  type PersonalContext,
} from "../../scripts/census/enumerators/e06-settings-store.js";
import { artifactsDir } from "../../scripts/live/paths.js";
import { makeCensus, runIn, writeObservations } from "./helpers.js";

// ── Planted personal values, assembled at run time ────────────────────────────

const ACCOUNT = ["zq", "vx", "jorb"].join("");
const HOST = ["wk", "stn", "-", "99"].join("");
const HOME = ["C:", "Users", ACCOUNT, "Documents", "My Games"].join("\\");
const STEAM = ["7656", "1198", "0".repeat(9)].join("");
const MAIL = ["someone", "@", "example", ".org"].join("");
const WORLD_RES = ["$", "addon", ":Worlds/", ACCOUNT, "Map.ent"].join("");
const CTX: PersonalContext = { accountNames: [ACCOUNT], hostNames: [HOST] };
const BS = "\\";
const ROOT = [
  "HKEY_CURRENT_USER",
  "Software",
  "Bohemia Interactive",
  "Arma Reforger Workbench",
].join(BS);

// ── Synthetic .reg builder ────────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

class RegBuilder {
  private readonly lines: string[] = ["Windows Registry Editor Version 5.00", ""];
  key(rel: string): this {
    this.lines.push("", `[${rel === "" ? ROOT : `${ROOT}${BS}${rel}`}]`);
    return this;
  }
  raw(line: string): this {
    this.lines.push(line);
    return this;
  }
  sz(name: string, value: string): this {
    this.lines.push(`"${esc(name)}"="${esc(value)}"`);
    return this;
  }
  dword(name: string, n: number): this {
    this.lines.push(`"${esc(name)}"=dword:${n.toString(16).padStart(8, "0")}`);
    return this;
  }
  /** hex data wrapped like regedit: a comma, a backslash, then two spaces on the next line. */
  private hex(name: string, prefix: string, bytes: Buffer): this {
    const parts = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
    const head = `"${esc(name)}"=${prefix}`;
    let line = head;
    const out: string[] = [];
    parts.forEach((p, i) => {
      const piece = p + (i < parts.length - 1 ? "," : "");
      if (line.length + piece.length > 60 && i > 0) {
        out.push(line + "\\");
        line = "  " + piece;
      } else line += piece;
    });
    out.push(line);
    this.lines.push(...out);
    return this;
  }
  binary(name: string, bytes: Buffer): this {
    return this.hex(name, "hex:", bytes);
  }
  multiSz(name: string, strings: string[]): this {
    const body = Buffer.from(strings.join("\0") + "\0\0", "utf16le");
    return this.hex(name, "hex(7):", body);
  }
  text(): string {
    return this.lines.join("\r\n") + "\r\n";
  }
  file(): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(this.text(), "utf16le")]);
  }
}

/** QSettings' registry form of a QByteArray: UTF-16LE `@ByteArray(` + one unit per byte + `)`. */
function qtByteArray(raw: Buffer): Buffer {
  return Buffer.from("@ByteArray(" + raw.toString("latin1") + ")", "utf16le");
}

function u32be(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
}
const qstring = (s: string): Buffer =>
  Buffer.concat([u32be(s.length * 2), Buffer.from(s, "utf16le").swap16()]);

/** A `QMainWindow::saveState` stream with the given docks and toolbars. */
function mainWindowState(docks: string[], toolbars: string[], version = 5): Buffer {
  return Buffer.concat([
    u32be(0xff),
    u32be(version),
    Buffer.from([0xfd]),
    u32be(docks.length),
    ...docks.flatMap((d) => [Buffer.from([0xfb]), qstring(d), Buffer.from([0x01]), u32be(0x10)]),
    qstring("not a toolbar"),
    Buffer.from([0xfc]),
    u32be(toolbars.length),
    ...toolbars.flatMap((t) => [u32be(1), qstring(t), Buffer.from([0x01]), u32be(0x20)]),
  ]);
}

/** An empty QVariant, as QSettings stores a plugin with nothing set. */
const emptyVariant = Buffer.from(
  "@Variant(" + Buffer.from([0, 0, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0]).toString("latin1") + ")",
  "utf16le",
);

function syntheticReg(): RegBuilder {
  const b = new RegBuilder();
  b.key("").sz("QtVersion", "6.8.3");
  b.key("Workbench")
    .sz("legacyOptionsLoaded", "true")
    .sz("AutoRebuildScripts", "1")
    .sz("NetAPI_Enabled", "1");
  b.key("Workbench\\PropertyGrid\\entityPropGrid").dword("SplitterPos", 120);
  b.key("Game Project Manager")
    .sz("LastOpenAddonLocation", HOME + "\\addons")
    .sz("ListViewMode", "false")
    .binary("Geometry", qtByteArray(Buffer.from([1, 217, 208, 203, 0, 3])));
  b.key("Game Project Manager\\AddonPresets").multiSz("Preset 1", ["SomeAddonName", "OtherAddon"]);
  b.key("World Editor")
    .sz("currentPerspective", "default")
    .sz("PlayInFullscreen", "false")
    .dword("TranslationGizmoMode", 1)
    .sz("legacyOptionsLoaded", "true");
  b.key("World Editor\\RecentFiles")
    .sz("File1", WORLD_RES)
    .sz("File2", HOME + "\\a.ent");
  b.key(`World Editor\\Worlds\\${WORLD_RES}`);
  b.key(`World Editor\\Worlds\\${WORLD_RES}\\ContentWindow`).sz("CameraPos", "1 2 3");
  b.key("World Editor\\Perspectives\\default")
    .binary(
      "State",
      qtByteArray(
        mainWindowState(
          ["entityTreeDock", "Animation Sets", "logConsoleDock"],
          ["toolBar", "toolbarBasicTools"],
          11,
        ),
      ),
    )
    .binary("Geometry", qtByteArray(Buffer.from([1, 2, 3])));
  b.key("World Editor\\Perspectives\\mine").binary(
    "State",
    qtByteArray(mainWindowState(["secretDock"], ["secretBar"])),
  );
  b.key("Behavior Editor").sz("legacyOptionsLoaded", "true").dword("OPEN_FILE_INDEX", 0);
  b.key("Behavior Editor\\Views\\0FED154A2FA42A19").dword("x", 5).sz("zoom", "1.5");
  b.key("Behavior Editor\\Perspectives\\edit").binary(
    "State",
    qtByteArray(mainWindowState(["itemExplorerPanelDock"], ["toolBar"], 3)),
  );
  b.key("Script Editor")
    .sz("currentPerspective", "edit")
    .dword("SEARCH_REGEXP", 0)
    .binary(
      "OPEN_FILES",
      qtByteArray(Buffer.from(ACCOUNT.split("").flatMap((c) => [0, c.charCodeAt(0)]))),
    )
    .sz("lastSessionFilePath", "")
    .dword("DBG_PORT", 1000);
  const known = (extra: string[] = []): string[] => [
    "KnownPlugin {",
    " m_bAlpha 1",
    ' m_sPath "' + HOME + '\\out"',
    " m_fRatio 0.5",
    ' m_eLevel "ELevel.Debug"',
    " m_aList {",
    " }",
    ...extra,
    "}",
  ];
  b.key("Script Editor\\ScriptTools")
    .multiSz("KnownPlugin", known())
    .multiSz("ConstTool", ["ConstTool {", " m_iCount 3", "}"])
    .multiSz("AddonPlugin", ["AddonPlugin {", " m_sSecret 1", "}"])
    .binary("EmptyPlugin", emptyVariant);
  b.key("World Editor\\Tools")
    .multiSz("KnownPlugin", known([" m_iExtra 7"]))
    .binary("searchSplitterSizes", qtByteArray(Buffer.from([1, 2])));
  // Shortcut table.
  b.key("Workbench\\PropertyGrid\\unnamed")
    .sz("Camera>Move Forward", "true")
    .sz("Common>Undo", "true")
    .sz("World Editor>Add Child Prefab -> To Map", "true")
    .sz("Procedural Animation Editor>Open", "true")
    .sz("String Editor>Insert Item", "true")
    .sz("Script Editor Plugins>Known Thing", "true")
    .sz("Script Editor Plugins>known  thing 2", "true")
    .sz("Script Editor Plugins>Addon Thing", "true")
    .sz("World Editor Plugins>Const Named Tool", "true")
    .sz("World Editor Plugins> Spaced Name", "true");
  b.key("Workbench\\PropertyGrid\\unnamed\\World Editor>Hide").sz("Show (toggle)", "true");
  // Things the parser must skip.
  b.raw("").raw("[HKEY_CURRENT_USER\\Software\\Other Vendor]").sz("Elsewhere", "1");
  b.raw("").raw(`[-${ROOT}\\Gone]`).raw('"x"="y"');
  return b;
}

// ── Synthetic source index ────────────────────────────────────────────────────

const PLUGIN_SOURCES = [
  {
    path: "scripts/WorkbenchGame/Plugins.c",
    text: [
      '[WorkbenchPluginAttribute(name: "Known Thing", wbModules: { "ScriptEditor" })]',
      "class KnownPlugin : KnownBase",
      "{",
      '\t[Attribute("1")]',
      "\tbool m_bAlpha;",
      '\t[Attribute("")]',
      "\tstring m_sPath;",
      '\t[Attribute("0")]',
      "\tfloat m_fRatio;",
      "\tprotected ref array<int> m_aList;",
      "}",
      "class KnownBase : WorkbenchPlugin",
      "{",
      '\t[Attribute("0")]',
      "\tint m_eLevel;",
      "}",
      '[WorkbenchToolAttribute(PLUGIN_NAME, "d", wbModules: { "WorldEditor", "ScriptEditor" })]',
      "class ConstTool : WorldEditorTool",
      "{",
      '\tprotected static const string PLUGIN_NAME = "Const Named Tool";',
      '\t[Attribute("3")]',
      "\tint m_iCount;",
      "}",
      '[WorkbenchPluginAttribute(name: "known thing 2")]',
      "class EmptyPlugin : WorkbenchPlugin",
      "{",
      "}",
      '[WorkbenchPluginAttribute(name: " Spaced Name", wbModules: { "NotAModule" })]',
      "class SpacedPlugin : WorkbenchPlugin",
      "{",
      "}",
      "class NotAPlugin",
      "{",
      "\tint m_iThing;",
      "}",
    ].join("\n"),
  },
];

function syntheticIndex() {
  return buildSourceIndex(PLUGIN_SOURCES, { build: "1.0.0.1" });
}

// ── The .reg parser ───────────────────────────────────────────────────────────

describe("E06 .reg parsing", () => {
  it("decodes UTF-16LE with a BOM, wrapped hex lines, escapes and every value type", () => {
    const reg = parseRegText(decodeRegText(syntheticReg().file()));
    const byPath = new Map(reg.keys.map((k) => [k.segments.join("/"), k]));
    expect(byPath.get("")?.values).toEqual([{ name: "QtVersion", type: "REG_SZ", text: "6.8.3" }]);
    const gpm = byPath.get("Game Project Manager");
    expect(gpm?.values.find((v) => v.name === "LastOpenAddonLocation")?.text).toBe(
      HOME + "\\addons",
    );
    const state = byPath
      .get("World Editor/Perspectives/default")
      ?.values.find((v) => v.name === "State");
    expect(state?.type).toBe("REG_BINARY");
    expect(decodeQtByteArray(state?.bytes ?? Buffer.alloc(0))).not.toBeNull();
    expect(
      byPath.get("World Editor")?.values.find((v) => v.name === "TranslationGizmoMode"),
    ).toEqual({
      name: "TranslationGizmoMode",
      type: "REG_DWORD",
      text: "00000001",
    });
    const multi = byPath
      .get("Script Editor/ScriptTools")
      ?.values.find((v) => v.name === "KnownPlugin");
    expect(multi?.type).toBe("REG_MULTI_SZ");
    expect(reg.outsideKeys).toBe(1);
    expect(reg.deletions).toBe(1);
    expect(reg.keys.some((k) => k.segments[0] === "Gone")).toBe(false);
  });

  it("counts keys and values of the export", () => {
    const reg = parseRegText(syntheticReg().text());
    const x = extract(reg, CTX, syntheticIndex());
    expect(x.registry.keys).toBe(reg.keys.length);
    expect(x.registry.values).toBe(reg.keys.reduce((n, k) => n + k.values.length, 0));
    expect(Object.values(x.registry.byType).reduce((a, b) => a + b, 0)).toBe(x.registry.values);
  });

  it("refuses text that is not a registry export and reads a REGEDIT4 file as 8-bit text", () => {
    expect(() => parseRegText("just some text")).toThrow(/not a registry export/);
    const old = parseRegText(`REGEDIT4\n\n[${ROOT}\\World Editor]\n"PlayInFullscreen"="false"\n`);
    expect(old.keys[0].values[0].text).toBe("false");
    expect(decodeRegText(Buffer.from("REGEDIT4\n", "latin1"))).toBe("REGEDIT4\n");
  });
});

// ── Qt formats ────────────────────────────────────────────────────────────────

describe("E06 Qt storage formats and saved window states", () => {
  it("unwraps a QByteArray stored as UTF-16 text and refuses other forms", () => {
    const raw = Buffer.from([0, 0, 0, 0xff, 0x80, 0xfb, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(decodeQtByteArray(qtByteArray(raw))).toEqual(raw);
    expect(decodeQtByteArray(emptyVariant)).toBeNull();
    expect(decodeQtByteArray(Buffer.from("plain text, not wrapped", "utf16le"))).toBeNull();
    expect(qtWrapper(qtByteArray(raw))).toBe("QByteArray");
    expect(qtWrapper(emptyVariant)).toBe("QVariant");
    expect(qtWrapper(Buffer.from("zz", "utf16le"))).toBeNull();
  });

  it("reads docks and toolbars with the E05 stream parser, spaces included", () => {
    const s = decodeSavedState(
      mainWindowState(["entityTreeDock", "Animation Sets"], ["toolBar"], 6),
    );
    expect(s?.version).toBe(6);
    expect(s?.entries).toEqual([
      { name: "entityTreeDock", kind: "dock" },
      { name: "Animation Sets", kind: "dock" },
      { name: "toolBar", kind: "toolbar" },
    ]);
    expect(decodeSavedState(Buffer.from("not a state at all"))).toBeNull();
  });
});

// ── Personal-data rules ───────────────────────────────────────────────────────

describe("E06 personal-data rules", () => {
  it("names the reason, never the match", () => {
    expect(personalReason(HOME + "\\addons", CTX)).toBe("machine-path");
    expect(personalReason(WORLD_RES, CTX)).toBe("resource-path");
    expect(personalReason(["scripts/WorkbenchGame/", ACCOUNT, "Tool.c"].join(""), CTX)).toBe(
      "file-path",
    );
    expect(personalReason(`hello ${ACCOUNT.toUpperCase()}`, CTX)).toBe("account-name");
    expect(personalReason(`box ${HOST}`, CTX)).toBe("machine-name");
    expect(personalReason(MAIL, CTX)).toBe("e-mail");
    expect(personalReason(`id ${STEAM}`, CTX)).toBe("steam-id");
    expect(personalReason("Map.ent", CTX)).toBe("file-name");
    expect(personalReason("Move Forward", CTX)).toBeNull();
    expect(personalReason("6.8.3", CTX)).toBeNull();
    expect(personalReason("Add Child Prefab -> To Map", CTX)).toBeNull();
  });

  it("gates on the account name, the machine name, Users followed by a slash and drive paths", () => {
    expect(gateScan("clean text", CTX)).toEqual([]);
    expect(gateScan(`x ${ACCOUNT} y`, CTX)).toEqual(["account name"]);
    expect(gateScan(`x ${HOST}`, CTX)).toEqual(["machine name"]);
    expect(gateScan("a Users/b", CTX)).toEqual(["Users followed by a slash"]);
    expect(gateScan("a " + ["D:", "x"].join("\\"), CTX)).toEqual(["drive-letter path"]);
  });

  it("reads the account and machine names of the process without printing them", () => {
    const c = personalContextFromEnv({ USERNAME: ACCOUNT, COMPUTERNAME: HOST, USER: "ab" });
    expect(c.accountNames).toEqual([ACCOUNT]);
    expect(c.hostNames).toEqual([HOST]);
  });

  it("excludes whole subtrees at the source", () => {
    expect(subtreeReason(["World Editor", "RecentFiles"])).toBe("recent-file-list");
    expect(subtreeReason(["World Editor", "Worlds", "x", "y"])).toBe("world-path-keyed");
    expect(subtreeReason(["Behavior Editor", "Views", "0FED154A2FA42A19"])).toBe("file-id-keyed");
    expect(subtreeReason(["World Editor", "Perspectives", "mine"])).toBe(
      "layout-name-user-defined",
    );
    expect(subtreeReason(["World Editor", "Perspectives", "default", "Workbench"])).toBeNull();
    expect(subtreeReason(["World Editor", "Tools", "Move"])).toBeNull();
  });
});

// ── Plugin blocks ─────────────────────────────────────────────────────────────

describe("E06 plugin blocks", () => {
  it("keeps member names and the shape of their values, never the values", () => {
    expect(valueShape("1")).toBe("int");
    expect(valueShape("-0.5")).toBe("number");
    expect(valueShape('"a b"')).toBe("string");
    expect(valueShape("{")).toBe("block");
    expect(valueShape("someToken")).toBe("token");
    const b = parsePluginBlock([
      "P {",
      " m_a 1",
      ' m_b "x y"',
      " m_c {",
      "  m_nested 2",
      " }",
      " m_d 2.5",
      "}",
      "",
      "",
    ]);
    expect(b?.header).toBe("P");
    expect(b?.attrs).toEqual([
      { attr: "m_a", shape: "int" },
      { attr: "m_b", shape: "string" },
      { attr: "m_c", shape: "block" },
      { attr: "m_d", shape: "number" },
    ]);
    expect(parsePluginBlock(["not a block"])).toBeNull();
    expect(parsePluginBlock(["P {", " m_a 1"])).toBeNull();
  });

  it("finds plugin and tool classes in the source index and applies the module rule", () => {
    const p = pluginClassesOf(syntheticIndex());
    expect([...p.keys()].sort()).toEqual([
      "ConstTool",
      "EmptyPlugin",
      "KnownPlugin",
      "SpacedPlugin",
    ]);
    expect(p.get("KnownPlugin")).toEqual({
      kind: "plugin",
      module: "ScriptEditor",
      displayName: "Known Thing",
    });
    expect(p.get("ConstTool")).toEqual({
      kind: "tool",
      module: "Shared",
      displayName: "Const Named Tool",
    });
    expect(p.get("EmptyPlugin")?.module).toBe("Shared");
    expect(p.get("SpacedPlugin")?.module).toBe("Shared");
  });
});

// ── Extraction ────────────────────────────────────────────────────────────────

describe("E06 extraction", () => {
  const x = extract(parseRegText(syntheticReg().text()), CTX, syntheticIndex());

  it("builds the shortcut table: categories, modules, sub-key names, plugin filter, no key sequences", () => {
    expect(x.stats.shortcutActions).toBe(11);
    expect(Object.keys(x.stats.shortcutCategories).sort()).toEqual([
      "Camera",
      "Common",
      "Procedural Animation Editor",
      "Script Editor Plugins",
      "String Editor",
      "World Editor",
      "World Editor Plugins",
    ]);
    const by = Object.fromEntries(x.shortcuts.map((s) => [s.key, s]));
    expect(by["Camera>Move Forward"].module).toBe("Shared");
    expect(by["Common>Undo"].module).toBe("Shared");
    expect(by["Procedural Animation Editor>Open"].module).toBe("ProcAnimEditor");
    expect(by["String Editor>Insert Item"].module).toBe("LocalizationEditor");
    expect(by["World Editor>Add Child Prefab -> To Map"].action).toBe("Add Child Prefab -> To Map");
    // Sub-key rebuilt with the slash the settings backend turned into a key level.
    expect(by["World Editor>Hide/Show (toggle)"]).toMatchObject({
      category: "World Editor",
      action: "Hide/Show (toggle)",
      reconstructed: true,
    });
    // Plugin categories: kept only when the name matches a vanilla attribute name.
    expect(by["Script Editor Plugins>Known Thing"].module).toBe("ScriptEditor");
    expect(by["Script Editor Plugins>known  thing 2"]).toBeDefined();
    expect(by["World Editor Plugins>Const Named Tool"].module).toBe("WorldEditor");
    expect(by["World Editor Plugins> Spaced Name"]).toBeDefined();
    expect(by["Script Editor Plugins>Addon Thing"]).toBeUndefined();
    expect(x.stats.shortcutsDroppedUnknownPlugin).toBe(1);
    expect(x.shortcuts).toHaveLength(10);
    expect(x.stats.valuesKept).toEqual({ "shortcut-table-flag-true": 11 });
    expect(categoryModule("Resource Manager Plugins")).toBe("ResourceManager");
    expect(categoryModule("Compass Gizmo")).toBe("Shared");
  });

  it("decodes docks and toolbars from stock layouts only and merges them per module", () => {
    const names = x.layouts.map((l) => `${l.module}/${l.kind}/${l.object_name}`).sort();
    expect(names).toEqual([
      "BehaviorEditor/dock/itemExplorerPanelDock",
      "BehaviorEditor/toolbar/toolBar",
      "WorldEditor/dock/Animation Sets",
      "WorldEditor/dock/entityTreeDock",
      "WorldEditor/dock/logConsoleDock",
      "WorldEditor/toolbar/toolBar",
      "WorldEditor/toolbar/toolbarBasicTools",
    ]);
    expect(x.layouts.find((l) => l.module === "WorldEditor")?.state_version).toBe(11);
    expect(x.stats.statesDecoded).toBe(2);
    expect(JSON.stringify(x.layouts)).not.toContain("secret");
    expect(x.stats.rowsExcluded["layout-name-user-defined"]).toBe(1);
  });

  it("emits setting keys with their stored type, drops personal subtrees, and counts every value once", () => {
    const keys = x.settings.map((s) => s.key);
    expect(keys).toContain("Workbench/AutoRebuildScripts");
    expect(keys).toContain("Arma Reforger Workbench/QtVersion");
    expect(keys).toContain("Workbench/PropertyGrid/entityPropGrid/SplitterPos");
    expect(keys.some((k) => k.includes("RecentFiles"))).toBe(false);
    expect(keys.some((k) => k.includes("Worlds"))).toBe(false);
    expect(keys.some((k) => k.includes("Views"))).toBe(false);
    expect(keys.some((k) => k.includes("ScriptTools"))).toBe(false);
    expect(keys.some((k) => k.includes("mine"))).toBe(false);
    const sig = (k: string): string => x.settings.find((s) => s.key === k)?.type ?? "";
    expect(sig("Workbench/AutoRebuildScripts")).toBe("REG_SZ (int)");
    expect(sig("World Editor/PlayInFullscreen")).toBe("REG_SZ (bool)");
    expect(sig("Game Project Manager/LastOpenAddonLocation")).toBe("REG_SZ (text)");
    expect(sig("World Editor/TranslationGizmoMode")).toBe("REG_DWORD");
    expect(sig("World Editor/Perspectives/default/State")).toBe("REG_BINARY (QByteArray)");
    expect(sig("Game Project Manager/AddonPresets/Preset 1")).toBe("REG_MULTI_SZ (QStringList)");
    const kept = Object.values(x.stats.valuesKept).reduce((a, b) => a + b, 0);
    const dropped = Object.values(x.stats.valuesDropped).reduce((a, b) => a + b, 0);
    expect(kept + dropped).toBe(x.registry.values);
  });

  it("classes option rows by form and says so", () => {
    const opt = x.settings.filter((s) => s.kind === "option").map((s) => s.key);
    expect(opt).toEqual([
      "Game Project Manager/ListViewMode",
      "Workbench/AutoRebuildScripts",
      "Workbench/NetAPI_Enabled",
      "World Editor/PlayInFullscreen",
      "World Editor/TranslationGizmoMode",
    ]);
    const v = (name: string, type = "REG_SZ") => ({ name, type, text: "x" });
    expect(looksLikeOption(["World Editor"], v("SEARCH_REGEXP"))).toBe(false);
    expect(looksLikeOption(["World Editor"], v("currentPerspective"))).toBe(false);
    expect(looksLikeOption(["World Editor"], v("lastSessionFilePath"))).toBe(false);
    expect(looksLikeOption(["World Editor"], v("Geometry", "REG_BINARY"))).toBe(false);
    expect(looksLikeOption(["World Editor", "Placement"], v("traceWorld"))).toBe(false);
    expect(looksLikeOption([], v("QtVersion"))).toBe(false);
    expect(valueSignature({ name: "n", type: "REG_QWORD", bytes: Buffer.alloc(8) })).toBe(
      "REG_QWORD",
    );
  });

  it("keeps plugin attributes of known classes only, merged across sections", () => {
    expect(x.stats.pluginClassesInExport).toBe(4);
    expect(x.stats.pluginClassesKept).toBe(3);
    expect(x.stats.pluginClassesDropped).toBe(1);
    expect(x.stats.pluginAttrsDropped).toBe(1);
    expect(x.pluginClassesKept).toEqual(["ConstTool", "EmptyPlugin", "KnownPlugin"]);
    const rows = Object.fromEntries(x.pluginSettings.map((r) => [r.key, r]));
    expect(Object.keys(rows).sort()).toEqual([
      "ConstTool/m_iCount",
      "KnownPlugin/m_aList",
      "KnownPlugin/m_bAlpha",
      "KnownPlugin/m_eLevel",
      "KnownPlugin/m_fRatio",
      "KnownPlugin/m_sPath",
    ]);
    // m_iExtra is stored by an older build but no field of the class declares it: dropped, counted.
    expect(x.stats.pluginAttrsUndeclared).toBe(1);
    // m_aList is a declared field without an [Attribute] annotation: kept, counted.
    expect(x.stats.pluginAttrsNotAnnotated).toBe(1);
    expect(rows["KnownPlugin/m_bAlpha"].shape).toBe("int");
    expect(rows["KnownPlugin/m_sPath"].shape).toBe("string");
    expect(rows["KnownPlugin/m_fRatio"].shape).toBe("number");
    expect(rows["KnownPlugin/m_aList"].shape).toBe("block");
    expect(rows["KnownPlugin/m_bAlpha"].sections).toEqual([
      "Script Editor/ScriptTools",
      "World Editor/Tools",
    ]);
    expect(rows["KnownPlugin/m_bAlpha"].module).toBe("ScriptEditor");
    expect(rows["ConstTool/m_iCount"]).toMatchObject({ module: "Shared", plugin_kind: "tool" });
    expect(JSON.stringify(x)).not.toContain("AddonPlugin");
    expect(JSON.stringify(x)).not.toContain("m_sSecret");
  });

  it("carries no planted personal value in any table", () => {
    const text = JSON.stringify(x);
    for (const planted of [ACCOUNT, HOST, HOME, STEAM, MAIL, WORLD_RES, "SomeAddonName"]) {
      expect(text).not.toContain(planted);
    }
    expect(gateScan(text, CTX)).toEqual([]);
    expect(x.stats.valuesDropped["value-has-machine-path"]).toBeGreaterThanOrEqual(1);
    // The account name hidden in a binary session blob is found, counted and dropped.
    expect(x.stats.valuesDropped["value-has-account-name"]).toBe(1);
    expect(x.stats.valuesDropped["recent-file-list"]).toBe(2);
    expect(x.stats.valuesDropped["world-path-keyed"]).toBe(1);
    expect(x.stats.valuesDropped["file-id-keyed"]).toBe(2);
    expect(x.stats.valuesDropped["addon-name-list"]).toBe(1);
  });
});

// ── The observation file ──────────────────────────────────────────────────────

interface Env {
  dir: string;
  reg: string;
  index: string;
  artifacts: string;
}

function makeEnv(build = "1.0.0.1"): Env {
  const dir = mkdtempSync(join(tmpdir(), "e06-"));
  const artifacts = join(dir, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const reg = join(artifacts, REG_NAME);
  writeFileSync(reg, syntheticReg().file());
  const index = join(dir, "source-index.jsonl");
  saveSourceIndex(buildSourceIndex(PLUGIN_SOURCES, { build }), { file: index });
  return { dir, reg, index, artifacts };
}

const runWith = (fx: ReturnType<typeof makeCensus>, env: Env, extra: string[] = []) =>
  runIn(fx, (argv, io) => runE06(argv, io, CTX), [
    "--reg",
    env.reg,
    "--index",
    env.index,
    "--artifacts",
    env.artifacts,
    ...extra,
  ]);

describe("E06 observation file", () => {
  it("writes a deterministic file whose header, refs and tables agree", () => {
    const env = makeEnv();
    const fx = makeCensus("1.0.0.1");
    const first = runWith(fx, env);
    expect(first.code).toBe(0);
    const file = join(fx.root, "observations", "E06", "1.0.0.1.jsonl");
    const text = readFileSync(file, "utf-8");
    const second = runWith(fx, env, ["--no-artifacts"]);
    expect(second.code).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(text);

    const [headerLine, ...lines] = text.trim().split("\n");
    const header = JSON.parse(headerLine);
    expect(header).toMatchObject({
      $header: 1,
      enumerator: "E06",
      build: "1.0.0.1",
      provisional: false,
    });
    expect(header.row_count).toBe(lines.length);
    expect(header.inputs[0]).toEqual({
      path: `<artifacts>/census/1.0.0.1/E06/${REG_NAME}`,
      sha256: sha256(readFileSync(env.reg)),
    });
    expect(header.inputs[1].sha256).toBe(sha256(readFileSync(env.index)));

    // Every ref cites the sha256 of the table file that holds its row key.
    const tables: Record<string, string> = {};
    for (const t of ["shortcuts", "settings", "layouts", "plugin-settings"]) {
      tables[sha256(readFileSync(join(env.artifacts, `${t}.json`)))] = t;
    }
    const rows = lines.map((l) => JSON.parse(l));
    for (const r of rows) {
      const m = /^artifact:([0-9a-f]{64})#(.+)$/.exec(r.ref);
      expect(m).not.toBeNull();
      expect(tables[m?.[1] ?? ""]).toBeDefined();
    }
    const kinds = new Set(rows.map((r) => r.kind));
    expect([...kinds].sort()).toEqual([
      "dock",
      "option",
      "plugin-setting",
      "setting-key",
      "shortcut",
      "toolbar",
    ]);
    expect(rows.every((r) => r.shortcut_default === undefined)).toBe(true);
    expect(
      rows
        .filter((r) => r.kind === "option")
        .every((r) => r.confidence === "low" && r.unverified.length === 1),
    ).toBe(true);
    const sc = rows.find((r) => r.kind === "shortcut" && r.key.path[0] === "Common");
    expect(sc.unverified[0]).toContain("lower bound");
    expect(sc.unverified[0]).toContain("user rebinds");
    const ids = rows.map((r) => deriveId(r));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("holds no planted personal value or machine path in the observation file or any table", () => {
    const env = makeEnv();
    const fx = makeCensus("1.0.0.1");
    expect(runWith(fx, env).code).toBe(0);
    // The fixture really holds the planted values (a vacuous scan would pass too).
    const rawReg = readFileSync(env.reg).subarray(2).toString("utf16le");
    for (const planted of [ACCOUNT, esc(HOME), WORLD_RES, "AddonPlugin"]) {
      expect(rawReg).toContain(planted);
    }
    const files = [
      join(fx.root, "observations", "E06", "1.0.0.1.jsonl"),
      ...["shortcuts", "settings", "layouts", "plugin-settings", "summary"].map((t) =>
        join(env.artifacts, `${t}.json`),
      ),
    ];
    for (const f of files) {
      const t = readFileSync(f, "utf-8");
      for (const planted of [
        ACCOUNT,
        HOST,
        HOME,
        STEAM,
        MAIL,
        WORLD_RES,
        "AddonPlugin",
        "SomeAddonName",
      ]) {
        expect(t, f).not.toContain(planted);
      }
      expect(t).not.toMatch(/\bUsers[\\/]/);
      expect(t).not.toMatch(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/);
    }
  });

  it("is accepted by the ledger in a temporary census, agreeing with E05 and E03 rows", () => {
    const env = makeEnv();
    const fx = makeCensus("1.0.0.1");
    expect(runWith(fx, env).code).toBe(0);
    const mods = [
      "WorldEditor",
      "ResourceManager",
      "ScriptEditor",
      "LocalizationEditor",
      "DialogueEditor",
      "AnimEditor",
      "ProcAnimEditor",
      "BehaviorEditor",
      "AudioEditor",
      "ParticleEditor",
      "NavmeshGeneratorMain",
    ];
    writeObservations(fx, "E05", "1.0.0.1", [
      ...mods.map((m) => ({
        dim: "ui",
        kind: "module",
        module: m,
        key: { path: [m] },
        parent_key: null,
        origin: "vanilla",
        ref: "exe:0x10",
        confidence: "high",
      })),
      {
        dim: "ui",
        kind: "dock",
        module: "WorldEditor",
        key: { object_name: "entityTreeDock" },
        object_name: "entityTreeDock",
        parent_key: {
          dim: "ui",
          kind: "module",
          module: "WorldEditor",
          key: { path: ["WorldEditor"] },
        },
        origin: "vanilla",
        ref: "exe:0x20",
        confidence: "high",
      },
    ]);
    const plugins = [
      ["KnownPlugin", "plugin", "ScriptEditor"],
      ["ConstTool", "tool", "Shared"],
    ] as const;
    writeObservations(
      fx,
      "E03",
      "1.0.0.1",
      plugins.map(([c, kind, module]) => ({
        dim: "plugin",
        kind,
        module,
        key: { class: c },
        parent_key: null,
        origin: "vanilla",
        ref: `pak:scripts/x/${c}.c#L1`,
        confidence: "high",
      })),
    );
    const result = buildLedger(fx.paths);
    expect(result.rejected).toEqual([]);
    const mine = readFileSync(join(fx.root, "observations", "E06", "1.0.0.1.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => deriveId(JSON.parse(l)));
    const named = result.problems.filter(
      (p) => mine.some((id) => p.message.includes(id)) || p.message.includes("E06"),
    );
    expect(named).toEqual([]);
    const dock = result.rows.find((r) => r.id === "ui:WorldEditor/dock/#entityTreeDock");
    expect(dock?.sources.map((s) => s.enumerator).sort()).toEqual(["E05", "E06"]);
    expect(result.rows.filter((r) => mine.includes(r.id))).toHaveLength(mine.length);
  });

  it("expects parent has no row for plugin rows until E03's file exists", () => {
    const env = makeEnv();
    const fx = makeCensus("1.0.0.1");
    expect(runWith(fx, env).code).toBe(0);
    const result = buildLedger(fx.paths);
    expect(result.rejected).toEqual([]);
    const own = result.problems.filter((p) => p.message.includes("#attr:"));
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((p) => /parent plugin:\w+ has no row/.test(p.message))).toBe(true);
  });

  it("prints its usage", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, (argv, io) => runE06(argv, io, CTX), ["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: e06-settings-store.ts");
  });

  it("reports NO DATA when the registry export or the source index is absent", () => {
    const env = makeEnv();
    const fx = makeCensus("1.0.0.1");
    const noReg = runIn(fx, (argv, io) => runE06(argv, io, CTX), [
      "--reg",
      join(env.dir, "missing.reg"),
      "--index",
      env.index,
      "--artifacts",
      env.artifacts,
    ]);
    expect(noReg.code).toBe(2);
    expect(noReg.stdout).toContain("NO DATA");
    const noIndex = runIn(fx, (argv, io) => runE06(argv, io, CTX), [
      "--reg",
      env.reg,
      "--index",
      join(env.dir, "missing.jsonl"),
      "--artifacts",
      env.artifacts,
    ]);
    expect(noIndex.code).toBe(2);
    expect(noIndex.stdout).toContain("NO DATA");
    expect(existsSync(join(fx.root, "observations", "E06", "1.0.0.1.jsonl"))).toBe(false);
  });

  it("refuses an output outside observations/E06/ and an artifacts directory inside a git tree", () => {
    const env = makeEnv();
    const fx = makeCensus("1.0.0.1");
    const out = runWith(fx, env, ["--out", join(fx.root, "ledger.jsonl")]);
    expect(out.code).toBe(1);
    const git = mkdtempSync(join(tmpdir(), "e06-git-"));
    mkdirSync(join(git, ".git"));
    const r = runIn(fx, (argv, io) => runE06(argv, io, CTX), [
      "--reg",
      env.reg,
      "--index",
      env.index,
      "--artifacts",
      join(git, "raw"),
    ]);
    expect(r.code).toBe(1);
    expect(existsSync(join(git, "raw"))).toBe(false);
  });

  it("compares saved docks and toolbars with E05's rows without feeding them into any row", () => {
    const x = extract(parseRegText(syntheticReg().text()), CTX, syntheticIndex());
    const e05 = e05LayoutRows(
      [
        "{}",
        JSON.stringify({ module: "WorldEditor", kind: "dock", object_name: "entityTreeDock" }),
        JSON.stringify({ module: "WorldEditor", kind: "dock", object_name: "onlyInExe" }),
        JSON.stringify({ module: "WorldEditor", kind: "toolbar", object_name: "toolBar" }),
        JSON.stringify({ module: "ParticleEditor", kind: "dock", object_name: "consoleDock" }),
        JSON.stringify({ module: "WorldEditor", kind: "menu", object_name: "ignored" }),
      ].join("\n"),
    );
    const cmp = compareLayouts(x.layouts, e05);
    const we = cmp.find((c) => c.module === "WorldEditor" && c.kind === "dock");
    expect(we?.same).toEqual(["entityTreeDock"]);
    expect(we?.extra).toEqual(["Animation Sets", "logConsoleDock"]);
    expect(we?.missing).toEqual(["onlyInExe"]);
    expect(cmp.find((c) => c.module === "ParticleEditor")?.missing).toEqual(["consoleDock"]);
    expect(cmp.find((c) => c.module === "WorldEditor" && c.kind === "toolbar")?.extra).toEqual([
      "toolbarBasicTools",
    ]);
  });
});

// ── Real export (skipped when the export or the source index is absent) ───────

const REAL_BUILD = "1.8.0.13";
const REAL_REG = join(artifactsDir(), "census", REAL_BUILD, "E06", REG_NAME);
const REAL_INDEX = sourceIndexPath(REAL_BUILD);

describe.skipIf(!existsSync(REAL_REG) || !existsSync(REAL_INDEX))(
  "E06 headline counts on the real registry export",
  () => {
    it("reproduces the 1.8.0.13 measurements", { timeout: 120_000 }, () => {
      const reg = parseRegText(decodeRegText(readFileSync(REAL_REG)));
      const index = parseSourceIndexText(readFileSync(REAL_INDEX, "utf-8"));
      const ctx = personalContextFromEnv();
      const x = extract(reg, ctx, index);
      expect(x.registry.keys).toBe(318);
      expect(x.registry.values).toBe(1631);
      expect(x.registry.outsideKeys).toBe(0);
      expect(x.stats.shortcutActions).toBe(361);
      expect(Object.keys(x.stats.shortcutCategories)).toHaveLength(18);
      expect(x.stats.shortcutCategories["World Editor Plugins"]).toBe(59);
      expect(x.shortcuts.filter((s) => s.reconstructed)).toHaveLength(3);
      expect(x.stats.valuesKept).toEqual({ "shortcut-table-flag-true": 361 });
      const docks = x.layouts.filter((l) => l.kind === "dock");
      const bars = x.layouts.filter((l) => l.kind === "toolbar");
      expect(docks).toHaveLength(73);
      expect(bars).toHaveLength(10);
      expect(docks.filter((l) => l.module === "AudioEditor")).toHaveLength(17);
      expect(x.stats.statesDecoded).toBe(7);
      expect(x.stats.statesUndecodable).toBe(0);
      expect(x.settings.filter((s) => s.kind === "option").length).toBeGreaterThan(0);
      expect(x.stats.pluginClassesInExport).toBe(
        x.stats.pluginClassesKept + x.stats.pluginClassesDropped,
      );
      expect(x.stats.rowsExcluded["world-path-keyed"]).toBeGreaterThan(0);
      const text = JSON.stringify(x);
      expect(gateScan(text, ctx)).toEqual([]);
    });
  },
);
