/**
 * E03 plugin and tool registry: extraction of plugin and tool classes with
 * their settings, buttons and command-line arguments, the call analysis and
 * modal classification (src/census/plugin-registry.ts), the observation rows,
 * determinism, acceptance by the ledger in a temporary census copy, and
 * (when the source index and the game are present) the headline counts of
 * build 1.8.0.13. Synthetic sources only, run through the E02 parser.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  CallResolver,
  analyzeClass,
  commentedAttributes,
  evalStringExpr,
  minDepth,
  moduleFromWbModules,
  pluginClasses,
  splitAttributeArgs,
  stringList,
} from "../../src/census/plugin-registry.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  type SourceInput,
} from "../../src/census/source-index.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  GENERATOR,
  buildRows,
  headlineCounts,
  observationFileText,
  reconModalInRun,
  resolveOut,
} from "../../scripts/census/enumerators/e03-plugin-registry.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import { makeCensus } from "./helpers.js";

// ── Synthetic sources ─────────────────────────────────────────────────────────

const FRAMEWORK: SourceInput[] = [
  {
    path: "scripts/Core/proto/EnDebug.c",
    text: "proto void Print(string s);\n",
  },
  {
    path: "scripts/Core/generated/Attributes/Attribute.c",
    text: [
      "class Attribute",
      "{",
      '\tvoid Attribute(string defvalue = "", string uiwidget = "auto", string desc = "", string params = "");',
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "scripts/Core/generated/System/FileIO.c",
    text: ["class FileIO", "{", "\tstatic proto bool DeleteFile(string name);", "}", ""].join("\n"),
  },
  {
    path: "scripts/GameLib/workbench/workbench.c",
    text: [
      "class ButtonAttribute",
      "{",
      '\tvoid ButtonAttribute(string label = "ScriptButton", bool focused = false);',
      "}",
      "class WorkbenchPluginAttribute",
      "{",
      '\tvoid WorkbenchPluginAttribute(string name, string description = "", string shortcut = "", string icon = "", array<string> wbModules = null, string category = "", int awesomeFontCode = 0, array<string> resourceTypes = null);',
      "}",
      "class WorkbenchToolAttribute : WorkbenchPluginAttribute",
      "{",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Workbench.c",
    text: [
      "sealed class Workbench",
      "{",
      "\tstatic proto WBModuleDef GetModule(typename type);",
      '\tstatic proto void Dialog(string caption, string text, string detailedText = "");',
      "\tstatic proto int ScriptDialog(string caption, string text, Class data);",
      "\tstatic proto int RunCmd(string command, bool wait = false);",
      "\tstatic proto void Exit(int exitCode);",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Modules/WBModuleDef.c",
    text: [
      "class WBModuleDef",
      "{",
      "\tproto external bool GetCmdLine(string name, out string value);",
      "}",
      "class WorldEditor : WBModuleDef",
      "{",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Plugins/WorkbenchPlugin.c",
    text: [
      "class WorkbenchPlugin",
      "{",
      "\tevent void Run();",
      "\tevent void RunCommandline();",
      "\tevent void Configure();",
      "}",
      "",
    ].join("\n"),
  },
  {
    path: "scripts/GameLib/generated/WorkbenchAPI/Plugins/WorldEditorTool.c",
    text: [
      "class WorldEditorTool",
      "{",
      "\tevent void OnActivate();",
      "\tevent void OnMousePressEvent(float x, float y, int buttons);",
      "}",
      "",
    ].join("\n"),
  },
];

const PLUGINS: SourceInput[] = [
  {
    // A plugin with settings and a button; Run is dialog-free, Configure opens one.
    path: "scripts/WorkbenchGame/Test/TAG_AlphaPlugin.c",
    text: [
      '[WorkbenchPluginAttribute(name: "Alpha Tool", description: "Does alpha things.\\nSecond line.", shortcut: "Ctrl+Alt+A", wbModules: { "WorldEditor" })]',
      "class TAG_AlphaPlugin : WorkbenchPlugin",
      "{",
      '\t[Attribute(defvalue: "5", desc: "How many items")]',
      "\tprotected int m_iCount;",
      "",
      '\t[Attribute("abc", "edit", "Plain " + "name")]',
      "\tprotected string m_sName;",
      "",
      "\tprotected int m_iNotASetting;",
      "",
      "\toverride void Run()",
      "\t{",
      '\t\tPrint("alpha");',
      "\t\tHelper();",
      "\t}",
      "",
      "\tprotected void Helper()",
      "\t{",
      '\t\tPrint("helper");',
      "\t}",
      "",
      "\toverride void Configure()",
      "\t{",
      '\t\tWorkbench.ScriptDialog("Configure", "", this);',
      "\t}",
      "",
      "\t//! Confirms the dialog.",
      '\t[ButtonAttribute("OK", true)]',
      "\tprotected bool ButtonOK()",
      "\t{",
      "\t\treturn true;",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    // An inherited Run whose dialog sits two calls deep (call depth 3).
    path: "scripts/WorkbenchGame/Test/TAG_BetaPlugin.c",
    text: [
      "class TAG_BasePlugin : WorkbenchPlugin",
      "{",
      '\t[Attribute("1", desc: "Inherited switch")]',
      "\tprotected bool m_bInherited;",
      "",
      "\toverride void Run()",
      "\t{",
      "\t\tStep();",
      "\t}",
      "",
      "\tprotected void Step()",
      "\t{",
      "\t\tDeep();",
      "\t}",
      "",
      "\tprotected void Deep()",
      "\t{",
      '\t\tWorkbench.Dialog("Done", "deep");',
      "\t}",
      "}",
      "",
      '[WorkbenchPluginAttribute("Beta", "", "", "", {"ResourceManager", "WorldEditor"})]',
      "class TAG_BetaPlugin : TAG_BasePlugin",
      "{",
      "}",
      "",
    ].join("\n"),
  },
  {
    // RunCommandline that reads the command line and ends in Workbench.Exit.
    path: "scripts/WorkbenchGame/Test/TAG_GammaPlugin.c",
    text: [
      "[WorkbenchPluginAttribute(name: PLUGIN_NAME)]",
      "class TAG_GammaPlugin : WorkbenchPlugin",
      "{",
      '\tstatic const string PLUGIN_NAME = "Gamma " + "CLI";',
      '\tprotected static const string PARAM_WORLD = "world";',
      "",
      "\toverride void RunCommandline()",
      "\t{",
      "\t\tWorldEditor we = Workbench.GetModule(WorldEditor);",
      "\t\tstring path;",
      '\t\twe.GetCmdLine("-" + PARAM_WORLD, path);',
      '\t\twe.GetCmdLine("-exitAfter", path);',
      "\t\tWorkbench.Exit(0);",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    // A tool class: an event override and a panel button.
    path: "scripts/WorkbenchGame/Test/TAG_DeltaTool.c",
    text: [
      '[WorkbenchToolAttribute(name: "Delta Tool", wbModules: { "WorldEditor" }, awesomeFontCode: 0xF1B2)]',
      "class TAG_DeltaTool : WorldEditorTool",
      "{",
      '\t[Attribute("0.5", UIWidgets.Slider, "Brush size", "0 1 0.1")]',
      "\tprotected float m_fSize;",
      "",
      "\toverride void OnMousePressEvent(float x, float y, int buttons)",
      "\t{",
      '\t\tPrint("press");',
      "\t}",
      "",
      '\t[ButtonAttribute("Do it")]',
      "\tvoid DoIt()",
      "\t{",
      '\t\tFileIO.DeleteFile("x.txt");',
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    // A call that does not resolve (Sleep is declared in no script).
    path: "scripts/WorkbenchGame/Test/TAG_EpsilonPlugin.c",
    text: [
      '[WorkbenchPluginAttribute(name: "Epsilon")]',
      "class TAG_EpsilonPlugin : WorkbenchPlugin",
      "{",
      "\toverride void Run()",
      "\t{",
      "\t\tSleep(10);",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    // A file deletion in Run, and a dialog directly in Run.
    path: "scripts/WorkbenchGame/Test/TAG_ZetaEtaPlugins.c",
    text: [
      '[WorkbenchPluginAttribute(name: "Zeta", wbModules: { "ScriptEditor" })]',
      "class TAG_ZetaPlugin : WorkbenchPlugin",
      "{",
      "\toverride void Run()",
      "\t{",
      '\t\tFileIO.DeleteFile("tmp.txt");',
      "\t}",
      "}",
      "",
      '[WorkbenchPluginAttribute(name: "Eta", wbModules: { "NoSuchEditor" })]',
      "class TAG_EtaPlugin : WorkbenchPlugin",
      "{",
      "\toverride void Run()",
      "\t{",
      '\t\tif (!Workbench.ScriptDialog("Eta", "", this))',
      "\t\t\treturn;",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    // A dialog and a file deletion four calls deep, through a static helper (below call depth 3).
    path: "scripts/WorkbenchGame/Test/TAG_ThetaPlugin.c",
    text: [
      "class TAG_ThetaHelper",
      "{",
      "\tstatic void Level2()",
      "\t{",
      "\t\tLevel3();",
      "\t}",
      "",
      "\tstatic void Level3()",
      "\t{",
      '\t\tWorkbench.Dialog("Deep", "four calls down");',
      '\t\tFileIO.DeleteFile("old.txt");',
      "\t}",
      "}",
      "",
      '[WorkbenchPluginAttribute(name: "Theta", wbModules: { "WorldEditor" })]',
      "class TAG_ThetaPlugin : WorkbenchPlugin",
      "{",
      "\toverride void Run()",
      "\t{",
      "\t\tStep1();",
      "\t}",
      "",
      "\tprotected void Step1()",
      "\t{",
      "\t\tTAG_ThetaHelper.Level2();",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    // Commented-out declarations: no row.
    path: "scripts/WorkbenchGame/Test/TAG_OldPlugin.c",
    text: [
      '//[WorkbenchPluginAttribute(name: "Old")]',
      "class TAG_OldPlugin : WorkbenchPlugin",
      "{",
      "\toverride void Run()",
      "\t{",
      "\t}",
      "}",
      "/*",
      '[WorkbenchToolAttribute(name: "Older")]',
      "class TAG_OlderTool : WorldEditorTool",
      "{",
      "}",
      "*/",
      "",
    ].join("\n"),
  },
];

const INPUTS = [...FRAMEWORK, ...PLUGINS];
const readText = (p: string): string | undefined => INPUTS.find((s) => s.path === p)?.text;
const fixtureIndex = () => buildSourceIndex(INPUTS, { build: "1.0.0.1" });

const rowOf = (r: ReturnType<typeof buildRows>, id: string) => {
  const o = r.observations.find((x) => x.id === id);
  if (!o) throw new Error(`no row ${id}`);
  return o.obs;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

describe("attribute arguments and the module rule", () => {
  it("binds positional and named arguments and evaluates string expressions", () => {
    expect(splitAttributeArgs('"a, b", x: { "c", "d" }, 0xF1')).toEqual([
      { value: '"a, b"' },
      { name: "x", value: '{ "c", "d" }' },
      { value: "0xF1" },
    ]);
    expect(stringList('{ "WorldEditor" , "ResourceManager"}')).toEqual([
      "WorldEditor",
      "ResourceManager",
    ]);
    expect(stringList("null")).toEqual([]);
    expect(stringList("SOME_CONSTANT")).toBeUndefined();
    const consts: Record<string, string> = { A: '"x" + B', B: '"y"' };
    expect(evalStringExpr('"-" + A', (_q, n) => consts[n])).toBe("-xy");
    expect(evalStringExpr('"a\\nb"', () => undefined)).toBe("a\nb");
    expect(evalStringExpr("UNKNOWN", () => undefined)).toBeUndefined();
  });

  it("gives a single vocabulary module, else Shared", () => {
    expect(moduleFromWbModules(["WorldEditor"]).module).toBe("WorldEditor");
    expect(moduleFromWbModules(["WorldEditor", "ResourceManager"]).module).toBe("Shared");
    expect(moduleFromWbModules(undefined).module).toBe("Shared");
    expect(moduleFromWbModules([]).module).toBe("Shared");
    expect(moduleFromWbModules(["NoSuchEditor"]).module).toBe("Shared");
  });

  it("reads the recon's modal-in-Run list", () => {
    const text = [
      '| `SCR_A` "A" | plugin | x | y | plugin-run (Run() opens modal ScriptDialog/Dialog -> blocks handler) | none |',
      '| `SCR_B` "B" | plugin | x | y | plugin-run (Run() has no dialog call in its own body) | none |',
    ].join("\n");
    expect(reconModalInRun(text)).toEqual(["SCR_A"]);
  });
});

// ── Extraction and classification ─────────────────────────────────────────────

describe("plugin and tool classes from synthetic sources", () => {
  it("finds every class with a plugin or tool attribute, kind from the attribute", () => {
    const ix = fixtureIndex();
    const pcs = pluginClasses(ix);
    expect(pcs.map((c) => `${c.kind}:${c.name}:${c.module}`).sort()).toEqual([
      "plugin:TAG_AlphaPlugin:WorldEditor",
      "plugin:TAG_BetaPlugin:Shared",
      "plugin:TAG_EpsilonPlugin:Shared",
      "plugin:TAG_EtaPlugin:Shared",
      "plugin:TAG_GammaPlugin:Shared",
      "plugin:TAG_ThetaPlugin:WorldEditor",
      "plugin:TAG_ZetaPlugin:ScriptEditor",
      "tool:TAG_DeltaTool:WorldEditor",
    ]);
    const gamma = pcs.find((c) => c.name === "TAG_GammaPlugin");
    expect(gamma?.label).toBe("Gamma CLI");
    const comments = commentedAttributes(
      INPUTS.map((s) => s.path),
      readText,
    );
    expect(comments.map((c) => `${c.attribute}:${c.class}:L${c.line}`)).toEqual([
      "WorkbenchPluginAttribute:TAG_OldPlugin:L1",
      "WorkbenchToolAttribute:TAG_OlderTool:L9",
    ]);
  });

  it("classifies Run: safe, a dialog two calls deep, Exit in RunCommandline, unresolved, deletion, direct dialog", () => {
    const ix = fixtureIndex();
    const res = new CallResolver(ix, readText);
    const an = new Map(pluginClasses(ix).map((c) => [c.name, analyzeClass(ix, res, c)]));
    const alpha = an.get("TAG_AlphaPlugin")!;
    expect(alpha.verdict).toBe("safe");
    expect(alpha.modal).toBe("none");
    expect(alpha.run?.unresolved).toEqual([]);
    expect(alpha.configure?.effects.map((e) => `${e.callee}@${e.depth}`)).toEqual([
      "Workbench.ScriptDialog@1",
    ]);
    expect(alpha.overrides.map((o) => o.method).sort()).toEqual(["Configure", "Run"]);

    const beta = an.get("TAG_BetaPlugin")!;
    expect(beta.overrides).toMatchObject([
      { method: "Run", declared_in: "TAG_BasePlugin", inherited: true },
    ]);
    expect(beta.verdict).toBe("modal");
    expect(beta.modal).toBe("opens");
    expect(minDepth(beta.run, "dialog")).toBe(3);
    expect(beta.run?.effects[0].path).toEqual([
      "TAG_BasePlugin.Run",
      "TAG_BasePlugin.Step",
      "TAG_BasePlugin.Deep",
    ]);
    // A search cut above the dialog never gives safe or modal "none": it is unknown, and says why.
    const shallow = analyzeClass(
      ix,
      res,
      pluginClasses(ix).find((c) => c.name === "TAG_BetaPlugin")!,
      2,
    );
    expect(shallow.verdict).toBe("unknown");
    expect(shallow.modal).toBeUndefined();
    expect(shallow.run?.frontier).toBe(1);
    expect(shallow.unverified.join(" ")).toMatch(
      /searched to call depth 2 only.*not classified safe/,
    );
    expect(beta.risk_hint).toBeUndefined();

    // The default search follows calls to closure: a dialog and a deletion at depth 4 are found.
    const theta = an.get("TAG_ThetaPlugin")!;
    expect(theta.verdict).toBe("modal");
    expect(theta.modal).toBe("opens");
    expect(theta.risk_hint).toBe("destructive");
    expect(theta.run?.frontier).toBe(0);
    expect(minDepth(theta.run, "dialog")).toBe(4);
    expect(minDepth(theta.run, "delete")).toBe(4);
    expect(theta.run?.effects.find((e) => e.kind === "dialog")?.path).toEqual([
      "TAG_ThetaPlugin.Run",
      "TAG_ThetaPlugin.Step1",
      "TAG_ThetaHelper.Level2",
      "TAG_ThetaHelper.Level3",
    ]);

    const gamma = an.get("TAG_GammaPlugin")!;
    expect(gamma.verdict).toBe("no-run");
    expect(gamma.modal).toBeUndefined();
    expect(gamma.runCommandline?.effects.map((e) => e.kind)).toEqual(["cli", "cli", "exit"]);
    expect(gamma.cli.map((c) => c.name)).toEqual(["-exitAfter", "-world"]);
    // Exit from RunCommandline: destructive, and the row says the hint does not come from Run.
    expect(gamma.risk_hint).toBe("destructive");
    expect(gamma.unverified.join(" ")).toMatch(
      /risk_hint destructive from TAG_GammaPlugin\.RunCommandline\(\), not from Run\(\): it reaches Workbench\.Exit/,
    );

    const delta = an.get("TAG_DeltaTool")!;
    expect(delta.verdict).toBe("no-run");
    expect(delta.overrides.map((o) => `${o.method}<${o.event_of}`)).toEqual([
      "OnMousePressEvent<WorldEditorTool",
    ]);
    // Its button deletes a file: destructive from a button method.
    expect(delta.risk_hint).toBe("destructive");
    expect(delta.unverified.join(" ")).toMatch(/from TAG_DeltaTool\.DoIt\(\).*FileIO\.DeleteFile/);

    const eps = an.get("TAG_EpsilonPlugin")!;
    expect(eps.verdict).toBe("unknown");
    expect(eps.modal).toBeUndefined();
    expect(eps.unverified[0]).toMatch(/1 call\(s\) did not resolve.*Sleep.*not classified safe/);

    const zeta = an.get("TAG_ZetaPlugin")!;
    expect(zeta.verdict).toBe("effects");
    expect(zeta.risk_hint).toBe("destructive");
    expect(zeta.modal).toBe("none");

    const eta = an.get("TAG_EtaPlugin")!;
    expect(eta.verdict).toBe("modal");
    expect(eta.risk_hint).toBe("mutating");
    expect(minDepth(eta.run, "dialog")).toBe(1);
  });
});

// ── Rows ──────────────────────────────────────────────────────────────────────

describe("E03 observation rows", () => {
  it("emits plugin, tool, setting, button and cli-arg rows with parents and child counts", () => {
    const ix = fixtureIndex();
    const r = buildRows(ix, readText);
    const byKind: Record<string, number> = {};
    for (const o of r.observations) byKind[o.obs.kind] = (byKind[o.obs.kind] ?? 0) + 1;
    expect(byKind).toEqual({
      plugin: 7,
      tool: 1,
      "plugin-setting": 4,
      "plugin-button": 2,
      "plugin-cli-arg": 2,
    });
    expect(rowOf(r, "plugin:TAG_AlphaPlugin")).toMatchObject({
      dim: "plugin",
      kind: "plugin",
      module: "WorldEditor",
      parent_key: null,
      label: "Alpha Tool",
      what: "Does alpha things. Second line.",
      shortcut_default: "Ctrl+Alt+A",
      class_name: "TAG_AlphaPlugin",
      modal: "none",
      children_count: 3,
      ref: "pak:scripts/WorkbenchGame/Test/TAG_AlphaPlugin.c#L1",
      confidence: "high",
    });
    expect(rowOf(r, "plugin:TAG_AlphaPlugin").signature).toMatch(
      /^WorkbenchPluginAttribute\(name: "Alpha Tool", /,
    );
    expect(rowOf(r, "plugin:TAG_AlphaPlugin#attr:m_iCount")).toMatchObject({
      kind: "plugin-setting",
      signature: 'int m_iCount = "5"',
      what: "How many items",
      parent_key: {
        dim: "plugin",
        kind: "plugin",
        module: "WorldEditor",
        key: { class: "TAG_AlphaPlugin" },
      },
      ref: "pak:scripts/WorkbenchGame/Test/TAG_AlphaPlugin.c#L5",
    });
    expect(rowOf(r, "plugin:TAG_AlphaPlugin#attr:m_sName").what).toBe("Plain name");
    expect(rowOf(r, "plugin:TAG_AlphaPlugin#button:ButtonOK")).toMatchObject({
      label: "OK",
      what: "Confirms the dialog.",
    });
    // Inherited setting, cited where its base class declares it.
    expect(rowOf(r, "plugin:TAG_BetaPlugin#attr:m_bInherited")).toMatchObject({
      module: "Shared",
      ref: "pak:scripts/WorkbenchGame/Test/TAG_BetaPlugin.c#L4",
    });
    expect(rowOf(r, "plugin:TAG_GammaPlugin#cli:-world")).toMatchObject({
      label: "-world",
      signature: 'WBModuleDef.GetCmdLine("-" + PARAM_WORLD, path)',
      ref: "pak:scripts/WorkbenchGame/Test/TAG_GammaPlugin.c#L11",
    });
    expect(rowOf(r, "plugin:TAG_DeltaTool")).toMatchObject({ kind: "tool", children_count: 2 });
    expect(rowOf(r, "plugin:TAG_DeltaTool").modal).toBeUndefined();
    expect(rowOf(r, "plugin:TAG_DeltaTool").risk_hint).toBe("destructive");
    expect(rowOf(r, "plugin:TAG_ThetaPlugin")).toMatchObject({
      modal: "opens",
      risk_hint: "destructive",
    });
    expect(rowOf(r, "plugin:TAG_DeltaTool#attr:m_fSize").what).toBe("Brush size");
    expect(rowOf(r, "plugin:TAG_ZetaPlugin").risk_hint).toBe("destructive");
    expect(rowOf(r, "plugin:TAG_EpsilonPlugin").unverified?.length).toBe(1);
    expect(r.observations.some((o) => o.id.startsWith("plugin:TAG_Old"))).toBe(false);
    const counts = headlineCounts(r, 2);
    expect(counts).toMatchObject({
      classes: 8,
      plugin: 7,
      tool: 1,
      commented_out: 2,
      raw_declarations: 10,
      run_commandline: { classes: 1, reach_exit: 1 },
      run_dialog: { any: { depth1: 1, depth2: 1, depth3: 2, any_depth: 3 } },
      verdicts: { safe: 1, modal: 3, exits: 0, effects: 1, unknown: 1, "no-run": 2 },
      destructive: { from_run: 2, from_other_entry: ["TAG_DeltaTool", "TAG_GammaPlugin"] },
    });
  });

  it("is deterministic: two runs give byte-identical files", () => {
    const a = observationFileText(buildRows(fixtureIndex(), readText), fixtureIndex(), "1.0.0.1");
    const b = observationFileText(buildRows(fixtureIndex(), readText), fixtureIndex(), "1.0.0.1");
    expect(a).toBe(b);
    expect(JSON.parse(a.split("\n")[0])).toMatchObject({
      $header: 1,
      enumerator: "E03",
      generator: GENERATOR,
      provisional: false,
      row_count: 16,
    });
  });

  it("builds into the ledger of a temporary census copy with no rejected line and no problem", () => {
    const fx = makeCensus("1.0.0.1");
    const ix = fixtureIndex();
    const dir = join(fx.root, "observations", "E03");
    mkdirSync(dir, { recursive: true });
    const out = resolveOut(fx.paths, undefined, "1.0.0.1");
    expect(out).toBe(join(dir, "1.0.0.1.jsonl"));
    expect(() => resolveOut(fx.paths, join(fx.root, "x.jsonl"), "1.0.0.1")).toThrow(/refusing/);
    writeFileSync(out, observationFileText(buildRows(ix, readText), ix, "1.0.0.1"));
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    expect(built.rows.length).toBe(16);
    expect(built.rows.find((x) => x.id === "plugin:TAG_GammaPlugin#cli:-world")).toMatchObject({
      parent: "plugin:TAG_GammaPlugin",
      kind: "plugin-cli-arg",
    });
    expect(built.rows.find((x) => x.id === "plugin:TAG_AlphaPlugin")?.children_enumerated).toBe(
      true,
    );
  });
});

// ── Real install (skipped without the source index or the game) ──────────────

const BUILD = "1.8.0.13";
const gamePath = loadConfig().gamePath;
const hasGame = !!gamePath && existsSync(join(gamePath, "addons"));
const realIndex = hasGame ? loadSourceIndex(BUILD) : undefined;

describe.skipIf(!realIndex)(`E03 headline counts on the installed game (build ${BUILD})`, () => {
  it("reproduces the population and the classification counts", () => {
    const vfs = PakVirtualFS.get(gamePath)!;
    const read = (f: string): string | undefined => {
      try {
        return vfs.readTextFile(f);
      } catch {
        return undefined;
      }
    };
    const ix = realIndex!;
    const r = buildRows(ix, read);
    const commented = commentedAttributes(
      ix.files.map((f) => f.file),
      read,
    );
    const reconFile = join(REPO_ROOT, "docs", "v2", "recon", "plugins-netapi-cli.md");
    const recon = existsSync(reconFile) ? readFileSync(reconFile, "utf-8") : undefined;
    const c = headlineCounts(r, commented.length, recon, read);
    expect(c).toMatchObject({
      classes: 142,
      plugin: 121,
      tool: 21,
      commented_out: 6,
      raw_declarations: 148,
      per_module: {
        ResourceManager: { plugin: 47, tool: 0 },
        WorldEditor: { plugin: 41, tool: 6 },
        ScriptEditor: { plugin: 14, tool: 0 },
        LocalizationEditor: { plugin: 8, tool: 0 },
        Shared: { plugin: 11, tool: 15 },
      },
      run_commandline: { classes: 14, reach_exit: 12 },
      run_dialog: {
        any: { depth1: 63, depth2: 66, depth3: 69, any_depth: 71 },
        user_dialog_only: { depth1: 58, depth2: 60, depth3: 63, any_depth: 65 },
      },
      // Followed to closure: SCR_AutocompletePlugin (dialog at depth 4) and
      // SCR_AutotestPlugin (depth 5) are modal, SCR_ScenarioFrameworkConversionPlugin_Phase1 unknown.
      verdicts: { safe: 22, modal: 71, exits: 0, effects: 10, unknown: 2, "no-run": 37 },
      risk_hints: { mutating: 50, destructive: 21 },
      destructive: {
        from_run: 9,
        from_other_entry: [
          "AddonBuildInfoTool",
          "BuildShoreMap",
          "GenerateFlowMaps",
          "ResaveMetaPlugin",
          "ResavePlugin",
          "ResourceProcessorPlugin",
          "ResourceTestPlugin",
          "SCR_PrefabValidatorPlugin",
          "SCR_RegisterPlaceableEntitiesPlugin",
          "SearchXOBPlugin",
          "WorldDataExport",
          "WorldTestPlugin",
        ],
      },
      rows: {
        plugin: 121,
        tool: 21,
        "plugin-setting": 525,
        "plugin-button": 180,
        "plugin-cli-arg": 27,
      },
      resource_manager: {
        single_module: 47,
        listed_in_wbModules: 52,
        plugins_without_wbModules: 5,
        tools_without_wbModules: 15,
      },
    });
    expect(c.overrides).toMatchObject({ Run: 105, RunCommandline: 14, Configure: 34 });
    if (recon) {
      expect(c.recon_modal_in_run).toMatchObject({
        listed: 58,
        measured_modal_depth1: 58,
        classified_safe: [],
        not_found: [],
      });
    }
    expect(r.dropped).toEqual([]);
    // The verifier's cases: no class with a dialog or deletion below depth 3 is left at modal "none".
    const byClass = new Map(r.analyses.map((x) => [x.cls.name, x]));
    expect(byClass.get("SCR_AutocompletePlugin")).toMatchObject({
      verdict: "modal",
      modal: "opens",
    });
    expect(minDepth(byClass.get("SCR_AutocompletePlugin")!.run, "dialog")).toBe(4);
    expect(byClass.get("SCR_AutotestPlugin")).toMatchObject({ verdict: "modal", modal: "opens" });
    expect(minDepth(byClass.get("SCR_AutotestPlugin")!.run, "dialog")).toBe(5);
    for (const n of [
      "WorldExporterPlugin",
      "SCR_BasicCodeFormatterPlugin",
      "SCR_TerrainEntityVariantReplacementPlugin",
    ])
      expect(byClass.get(n)?.risk_hint).toBe("destructive");
    expect(r.analyses.filter((x) => (x.run?.frontier ?? 0) > 0)).toEqual([]);
    expect(r.analyses.filter((x) => x.verdict === "safe" && x.modal !== "none")).toEqual([]);
  }, 120_000);
});
