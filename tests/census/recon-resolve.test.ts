/**
 * The recon carry-over resolver (src/census/recon-resolve.ts) and its CLI
 * (scripts/census/recon-resolve.ts). Synthetic ledger rows, recon tables,
 * script sources and executable strings are built inside each test; nothing
 * reads the real census, the game install or the artifacts folder.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadUniverses } from "../../src/census/census-config.js";
import { foldState } from "../../src/census/state.js";
import {
  aliasAcceptable,
  awaitsLiveKinds,
  capitalPrefixes,
  checkProposals,
  countArgs,
  exeStringsFromTsv,
  extMentions,
  memberMentions,
  readReconLine,
  reconOffenders,
  resolveRecon,
  typeMentions,
  WORKBENCH_SCOPE,
  type ManualDecision,
  type Proposal,
  type ResolveInputs,
} from "../../src/census/recon-resolve.js";
import type { Row } from "../../src/census/schemas.js";
import { buildSourceIndex, saveSourceIndex } from "../../src/census/source-index.js";
import { aliasesText } from "../../src/census/writers.js";
import { WORKBENCH_SCOPE as E02_SCOPE } from "../../scripts/census/enumerators/e02-script-source.js";
import { run as runBuild } from "../../scripts/census/build.js";
import { run as runResolve } from "../../scripts/census/recon-resolve.js";
import {
  apiClass,
  apiMethod,
  makeCensus,
  runIn,
  writeEvidence,
  writeObservations,
  writeRepoFile,
} from "./helpers.js";

const BUILD = "1.0.0.1";

// ── Synthetic inputs ──────────────────────────────────────────────────────────

/** A ledger row with only the fields the resolver reads. */
function row(
  id: string,
  dim: string,
  kind: string,
  enumerator: string,
  extra: Partial<Row> & { ref?: string; quote?: string } = {},
): Row {
  const { ref, quote, ...rest } = extra;
  return {
    id,
    dim,
    kind,
    module: "none",
    aggregate: false,
    paths: [],
    tier: "T0",
    sources: [
      {
        enumerator,
        build: BUILD,
        ref: ref ?? (enumerator === "E01" ? "<repo>/docs/v2/recon/t.md#L4" : "pak:scripts/x.c#L1"),
        quote,
        confidence: enumerator === "E01" ? "low" : "high",
      },
    ],
    ...rest,
  } as unknown as Row;
}

const HEADER =
  "| Feature | Kind | What it does | Script API (class.method or none) | Automation path | Current MCP coverage (tool name) | Evidence | Confidence |";
const SEP = "|---|---|---|---|---|---|---|---|";

/** A recon file whose table rows start at line 4. */
function reconFile(heading: string, rows: string[]): string[] {
  return [`## ${heading}`, HEADER, SEP, ...rows];
}

function tableRow(
  label: string,
  kind: string,
  what: string,
  api: string,
  coverage = "none",
  automation = "net-api-handler",
): string {
  return `| ${label} | ${kind} | ${what} | ${api} | ${automation} | ${coverage} | SRC | H |`;
}

/** A source index over a Workbench-scope file and a game file. */
function sourceIndex(): ReturnType<typeof buildSourceIndex> {
  return buildSourceIndex(
    [
      {
        path: "scripts/WorkbenchGame/FooTool.c",
        text: [
          "class FooTool : WorkbenchPlugin",
          "{",
          "\tvoid Bar(int a, int b);",
          "\tvoid Twice(int a);",
          "\tvoid Twice(int a, int b);",
          "\tstatic int Once(string s, int n = 0);",
          "\tvoid SaveThing();",
          "}",
          "",
        ].join("\n"),
      },
      {
        path: "scripts/WorkbenchGame/ModDef.c",
        text: [
          "class ModDef",
          "{",
          "\tproto external bool Close();",
          "}",
          "class StrEditor : ModDef",
          "{",
          "}",
          "",
        ].join("\n"),
      },
      {
        path: "scripts/Game/Sound/GameThing.c",
        text: [
          "class GameThing",
          "{",
          "\tprivate void GameThing();",
          "\tproto external void Play(string name);",
          "\tproto external void Stop();",
          "}",
          "class OtherOne",
          "{",
          "\tvoid GetShared();",
          "}",
          "class AnotherOne",
          "{",
          "\tvoid GetShared();",
          "}",
          "",
        ].join("\n"),
      },
    ],
    { build: BUILD },
  );
}

/** The measured side of the synthetic ledger. */
function measuredRows(): Row[] {
  return [
    row("api:FooTool", "api", "class", "E02"),
    row("api:FooTool.Bar/2", "api", "method", "E02", { label: "Bar" }),
    row("api:FooTool.Twice/1", "api", "method", "E02", { label: "Twice" }),
    row("api:FooTool.Twice/2", "api", "method", "E02", { label: "Twice" }),
    row("api:FooTool.Once/2", "api", "static-method", "E02", { label: "Once" }),
    row("api:FooTool.SaveThing/0", "api", "method", "E02", { label: "SaveThing" }),
    row("schema:IOPItemOpAbsClass", "schema", "schema-class", "E10"),
    row("schema:AnimSrcNodeBlend", "schema", "schema-class", "E10"),
    row("schema:AnimSrcNodeBlend.BlendFn", "schema", "schema-key", "E10"),
    row("schema:BtVariableEntity", "schema", "schema-class", "E10"),
    row("schema:BtVariableGroup", "schema", "schema-class", "E10"),
    row("schema:GroupClass", "schema", "schema-class", "E10"),
    row("file:.agf", "file", "file-type", "E09"),
    row("file:.agr", "file", "file-type", "E09"),
    row("file:.conf", "file", "file-type", "E09"),
    row("mcp:tool/script_lint", "mcp", "mcp-tool", "E11"),
    row("mcp:tool/logs_list", "mcp", "mcp-tool", "E11"),
    row("mcp:tool/logs_tail", "mcp", "mcp-tool", "E11"),
    row("link:enfusion://WorldEditor", "link", "link-format", "E07"),
    row("setting:Workbench/NetAPI_Enabled", "setting", "option", "E06"),
    row("setting:World Editor%2FTerrainModule/a", "setting", "setting-key", "E06"),
    row("setting:World Editor%2FTerrainModule/b", "setting", "setting-key", "E06"),
  ];
}

const EXE = exeStringsFromTsv(
  [
    "offset\tstring",
    "0x10\tIOPItemOpCosClass",
    "0x20\tbt;fsm",
    "0x30\t?apr",
    "0x40\t%s/%s.dlg",
    "0x50\tInvertMouse",
  ].join("\n"),
);

function inputs(
  rows: Row[],
  files: Record<string, string[]>,
  extra: Partial<ResolveInputs> = {},
): ResolveInputs {
  return {
    rows,
    awaitsLive: new Set(),
    source: sourceIndex(),
    exe: EXE,
    readRecon: (f) => files[f],
    manual: {},
    ...extra,
  };
}

/** Resolves one recon row (line 4 of `t.md`) against the measured rows. */
function resolveOne(
  recon: Row,
  tableLine: string,
  heading = "2.1 FooTool API",
  extra: Partial<ResolveInputs> = {},
  more: Row[] = [],
): { proposal?: Proposal; reason?: string } {
  const res = resolveRecon(
    inputs([...measuredRows(), ...more, recon], { "t.md": reconFile(heading, [tableLine]) }, extra),
  );
  const p = res.proposals.find((x) => x.id === recon.id);
  const u = res.unresolved.find((x) => x.id === recon.id);
  return { proposal: p, reason: u?.reason };
}

/** Resolves one recon row against the measured rows plus `more`. */
function resolveWith(
  more: Row[],
  recon: Row,
  tableLine: string,
  extra: Partial<ResolveInputs> = {},
): { proposal?: Proposal; reason?: string } {
  return resolveOne(recon, tableLine, undefined, extra, more);
}

// ── Name extraction ───────────────────────────────────────────────────────────

describe("name extraction", () => {
  it("reads Class.Member mentions with arity, continuations, wildcards and constructor calls", () => {
    expect(memberMentions('WorldEditorAPI.AddComment(IEntity e, string c = "") : void')).toEqual([
      { cls: "WorldEditorAPI", member: "AddComment", args: 2 },
    ]);
    expect(
      memberMentions("AudioSystem.GetVariable, SetVariable / ResetVariables()").map(
        (m) => m.member,
      ),
    ).toEqual(["GetVariable", "SetVariable", "ResetVariables"]);
    expect(memberMentions("AudioSystem.MusicProject* (8 methods)")).toEqual([
      { cls: "AudioSystem", member: "MusicProject", wildcard: true },
    ]);
    expect(memberMentions("WBProgressDialog(title, module).SetProgress")[0]).toMatchObject({
      cls: "WBProgressDialog",
      member: "SetProgress",
    });
    expect(memberMentions("pointer.ToString()")).toEqual([
      { cls: "pointer", member: "ToString", args: 0 },
    ]);
    expect(memberMentions("see SCR_TracyPlugin.c and e.g. this")).toEqual([]);
    expect(countArgs('..., "X", ...')).toBeUndefined();
    expect(countArgs("array<int, int> a, int b")).toBe(2);
  });

  it("reads type names from labels, lists and declarations", () => {
    expect(typeMentions("Abs (IOPItemOpAbsClass) x29")).toEqual(["IOPItemOpAbsClass"]);
    expect(typeMentions("AnimSrcIkTargetBinding / AnimSrcNodeIK2BoneTarget")).toEqual([
      "AnimSrcIkTargetBinding",
      "AnimSrcNodeIK2BoneTarget",
    ]);
    expect(typeMentions("Events: AnimSrcEventGeneric / AnimSrcEventAudio")).toEqual([
      "AnimSrcEventGeneric",
      "AnimSrcEventAudio",
    ]);
    expect(
      typeMentions(
        "ForestGeneratorEntity : SCR_AreaGeneratorBaseEntity; prefabs Prefabs/WEGenerators/FG_*",
      ),
    ).toEqual(["ForestGeneratorEntity"]);
    expect(typeMentions("SCR_EScriptTemplateType: None, Entity, WidgetComponent")).toEqual([
      "SCR_EScriptTemplateType",
      "WidgetComponent",
    ]);
    expect(typeMentions("Sound, Bus, IK")).toEqual([]);
    expect(capitalPrefixes("BtVariableEntity")).toEqual(["BtVariable", "Bt"]);
  });

  it("reads extensions, the last of a chain, and not folders or members", () => {
    expect(extMentions(".agf / .agr / .ent.meta")).toEqual(["agf", "agr", "meta"]);
    expect(extMentions("profile/resourceDatabase.rdb + logs/x/{a,b}.log")).toEqual(["rdb", "log"]);
    expect(extMentions("profile/.save/settings/customInputConfigs/")).toEqual([]);
    expect(extMentions("WorldEditorAPI.GetWorld e.g. here")).toEqual([]);
  });

  it("reads a recon table row with its header and heading", () => {
    const lines = reconFile(
      "2.9 LocalizationEditor module API (`sealed class LocalizationEditor : WBModuleDef`)",
      [tableRow("Close", "api-method", "Close it", "`WBModuleDef.Close() : bool`")],
    );
    const r = readReconLine(lines, "t.md", 4);
    expect(r?.cells["script api"]).toBe("`WBModuleDef.Close() : bool`");
    expect(r?.cells["current mcp coverage"]).toBe("none");
    expect(r?.heading).toContain("sealed class LocalizationEditor");
    expect(readReconLine(lines, "t.md", 1)).toBeUndefined();
  });

  it("finds executable strings exactly or as a word", () => {
    expect(EXE.find("IOPItemOpCosClass")?.offset).toBe("0x10");
    expect(EXE.find("fsm")).toEqual({ offset: "0x20", text: "bt;fsm" });
    expect(EXE.find("bt;f")).toBeUndefined();
  });

  it("repeats E02's Workbench scope", () => {
    expect([...WORKBENCH_SCOPE]).toEqual([...E02_SCOPE]);
  });
});

// ── Rules ─────────────────────────────────────────────────────────────────────

describe("rules", () => {
  it("api-member: a free-text label whose API cell names one measured method merges by alias", () => {
    const r = row("api:method/Do the bar", "api", "method", "E01", { label: "Do the bar" });
    const { proposal } = resolveOne(
      r,
      tableRow("Do the bar", "API method", "Bars", "FooTool.Bar(int a, int b) : void"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "merged-via-alias",
      ref: "api:FooTool.Bar/2",
    });
    expect(proposal?.rule).toBe("api-member");
    expect(proposal?.evidence[0]).toContain("api:FooTool.Bar/2 <- E02");
  });

  it("api-member: a recon method that is a static method is a kind misread, still an alias", () => {
    const r = row("api:method/Once", "api", "method", "E01", { label: "Once" });
    const { proposal } = resolveOne(
      r,
      tableRow("Once", "API method", "x", "FooTool.Once(string s)"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "merged-via-alias",
      ref: "api:FooTool.Once/2",
    });
    expect(proposal?.mistake).toContain("method -> static-method");
  });

  it("refuses: several arities when the recon gives no argument list", () => {
    const r = row("api:method/Twice", "api", "method", "E01", { label: "Twice" });
    const { proposal, reason } = resolveOne(
      r,
      tableRow("Twice", "API method", "x", "FooTool.Twice"),
    );
    expect(proposal).toBeUndefined();
    expect(reason).toMatch(/ambiguous: .*several arities/);
  });

  it("an argument count picks one overload", () => {
    const r = row("api:method/Twice two", "api", "method", "E01", { label: "Twice two" });
    const { proposal } = resolveOne(
      r,
      tableRow("Twice two", "API method", "x", "FooTool.Twice(1, 2)"),
    );
    expect(proposal?.recon_resolution.ref).toBe("api:FooTool.Twice/2");
  });

  it("refuses: an ambiguous bare name declared by two unrelated classes", () => {
    const r = row("api:method/Shared call", "api", "method", "E01", { label: "Shared call" });
    const { proposal, reason } = resolveOne(
      r,
      tableRow("Shared call", "function", "x", "GetShared"),
    );
    expect(proposal).toBeUndefined();
    expect(reason).toMatch(/ambiguous: bare GetShared/);
  });

  it("a call with literal arguments is one use of the method: duplicate, not alias", () => {
    const r = row("api:method/Bar it", "api", "method", "E01", { label: "Bar it" });
    const { proposal } = resolveOne(r, tableRow("Bar it", "function", "x", 'FooTool.Bar(1, "x")'));
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "api:FooTool.Bar/2" });
  });

  it("several measured methods make a duplicate of the first with the list in the note", () => {
    const r = row("api:method/Bar and once", "api", "method", "E01", { label: "Bar and once" });
    const { proposal } = resolveOne(
      r,
      tableRow("Bar and once", "function", "x", 'FooTool.Bar(1, 2) / Once("s")'),
    );
    expect(proposal?.recon_resolution.kind).toBe("duplicate-of");
    expect(proposal?.note).toContain("api:FooTool.Once/2");
  });

  it("out-of-scope: a game method outside the seven Workbench folders", () => {
    const r = row("api:method/Play a sound", "api", "method", "E01", { label: "Play a sound" });
    const { proposal } = resolveOne(
      r,
      tableRow("Play a sound", "function", "x", "GameThing.Play(string)"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "out-of-scope",
      ref: "pak:scripts/Game/Sound/GameThing.c#L4",
    });
  });

  it("out-of-scope: a class wildcard (`GameThing.*`) never stands for the constructor", () => {
    const r = row("api:method/All sounds", "api", "method", "E01", { label: "All sounds" });
    const { proposal } = resolveOne(r, tableRow("All sounds", "function", "x", "GameThing.*"));
    expect(proposal?.recon_resolution).toEqual({
      kind: "out-of-scope",
      ref: "pak:scripts/Game/Sound/GameThing.c#L4",
    });
    expect(proposal?.evidence[0]).toContain("2 member(s) match GameThing.*");
  });

  it("a class wildcard is replaced by the members the what cell names", () => {
    const r = row("api:method/Stop it", "api", "method", "E01", { label: "Stop it" });
    const { proposal } = resolveOne(
      r,
      tableRow("Stop it", "function", "Stop, Nope", "GameThing.*"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "out-of-scope",
      ref: "pak:scripts/Game/Sound/GameThing.c#L5",
    });
    expect(proposal?.evidence).toEqual([
      "GameThing.Stop: source-index GameThing.Stop declared at pak:scripts/Game/Sound/GameThing.c#L5",
    ]);
  });

  it("refuses: an alias across dims becomes a duplicate (a document block class)", () => {
    const r = row("api:class/Abs (IOPItemOpAbsClass) x29", "api", "class", "E01", {
      label: "Abs (IOPItemOpAbsClass) x29",
    });
    const { proposal } = resolveOne(
      r,
      tableRow("Abs (IOPItemOpAbsClass) x29", "signal node", "Absolute value", "none"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "duplicate-of",
      ref: "schema:IOPItemOpAbsClass",
    });
    expect(proposal?.mistake).toBe("document block class filed as an API class");
    const block = measuredRows().find((x) => x.id === "schema:IOPItemOpAbsClass") as Row;
    expect(aliasAcceptable(r, block, [])).toEqual({
      ok: false,
      why: "alias across dims (api -> schema)",
    });
  });

  it("a measured class merges by alias, an attribute class too (kind misread)", () => {
    const r = row("api:attribute/FooTool", "api", "attribute", "E01", { label: "FooTool" });
    const { proposal } = resolveOne(r, tableRow("FooTool", "attribute", "x", "none"));
    expect(proposal?.recon_resolution).toEqual({ kind: "merged-via-alias", ref: "api:FooTool" });
    expect(proposal?.mistake).toContain("attribute -> class");
  });

  it("an executable-only class stays unresolved; a name found nowhere is absent", () => {
    const cos = row("api:class/Cos (IOPItemOpCosClass)", "api", "class", "E01", {
      label: "Cos (IOPItemOpCosClass)",
    });
    expect(
      resolveOne(cos, tableRow("Cos (IOPItemOpCosClass)", "signal node", "Cosine", "none")).reason,
    ).toMatch(/^executable-only name/);
    const ghost = row("api:GhostPlugin", "api", "class", "E01", { label: "GhostPlugin" });
    const { proposal } = resolveOne(ghost, tableRow("GhostPlugin", "class", "x", "none"));
    expect(proposal?.recon_resolution.kind).toBe("absent-in-build");
    expect(proposal?.recon_resolution.ref).toContain("GhostPlugin");
  });

  it("a list of names none of which exists stays unresolved (prose, not absence)", () => {
    const r = row("api:class/Ghost list", "api", "class", "E01", {
      label: "GhostAlpha / GhostBeta",
      aggregate: true,
    });
    const { proposal, reason } = resolveOne(
      r,
      tableRow("GhostAlpha / GhostBeta", "node", "x", "none"),
    );
    expect(proposal).toBeUndefined();
    expect(reason).toMatch(/a list of names none of which/);
  });

  it("api-type-what: abbreviated list items complete against the first full name", () => {
    const r = row("api:Variables", "api", "class", "E01", { label: "Variables" });
    const { proposal } = resolveOne(
      r,
      tableRow("Variables", "sub-structure", "BtVariableEntity, Group (11 types)", "none"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "duplicate-of",
      ref: "schema:BtVariableEntity",
    });
    expect(proposal?.note).toContain("BtVariableGroup -> schema:BtVariableGroup");
    expect(proposal?.note).not.toContain("GroupClass");
  });

  it("schema-key-enum: a document value set is a duplicate of the key", () => {
    const r = row("api:enum/Enum BlendFn", "api", "enum", "E01", { label: "Enum BlendFn" });
    const { proposal } = resolveOne(r, tableRow("Enum BlendFn", "enum", "`S`, `Linear`", "none"));
    expect(proposal?.recon_resolution).toEqual({
      kind: "duplicate-of",
      ref: "schema:AnimSrcNodeBlend.BlendFn",
    });
  });

  it("recon-declared-absence: the recon states the class string is missing and nothing holds it", () => {
    const r = row("api:class/IK Lock", "api", "class", "E01", { label: "IK Lock (wiki)" });
    const { proposal } = resolveOne(
      r,
      tableRow("IK Lock (wiki)", "node", "no `AnimSrcNodeIKLock` in exe", "none"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "absent-in-build",
      ref: "AnimSrcNodeIKLock (source index, measured api and schema rows, executable strings)",
    });
  });

  it("gui-function: a function with no script API is a recon error", () => {
    const r = row("api:method/Add node", "api", "method", "E01", { label: "Add node" });
    const { proposal } = resolveOne(r, tableRow("Add node", "function", "Palette click", "none"));
    expect(proposal?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(proposal?.rule).toBe("gui-function");
  });

  it("file-ext: one extension merges, a list duplicates the first, a config is a .conf", () => {
    const one = row("file:file-type/.agf Animation Graph File", "file", "file-type", "E01", {
      label: ".agf Animation Graph File",
    });
    expect(
      resolveOne(one, tableRow(".agf Animation Graph File", "file-type", "x", "none")).proposal
        ?.recon_resolution,
    ).toEqual({
      kind: "merged-via-alias",
      ref: "file:.agf",
    });
    const list = row("file:file-type/.agf / .agr", "file", "file-type", "E01", {
      label: ".agf / .agr",
      aggregate: true,
    });
    const p = resolveOne(list, tableRow(".agf / .agr", "file type", "x", "none")).proposal;
    expect(p?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "file:.agf" });
    expect(p?.note).toContain(".agr -> file:.agr");
    const cfg = row("file:file-type/.wav resource type config", "file", "file-type", "E01", {
      label: ".wav resource type config",
    });
    expect(
      resolveOne(
        cfg,
        tableRow(
          ".wav resource type config",
          "file type",
          "configs/ResourceTypes/PC/Sound.conf = empty",
          "none",
        ),
      ).proposal?.recon_resolution,
    ).toEqual({ kind: "duplicate-of", ref: "file:.conf" });
  });

  it("file-ext: an executable-only extension stays open; one with no string anywhere is not ruled absent", () => {
    const fsm = row("file:.fsm", "file", "file-type", "E01", { label: ".fsm" });
    expect(resolveOne(fsm, tableRow(".fsm", "file-type", "filter", "none")).reason).toMatch(
      /^executable-only name/,
    );
    const apr = row("file:file-type/.apr export profile", "file", "file-type", "E01", {
      label: ".apr export profile",
    });
    expect(
      resolveOne(apr, tableRow(".apr export profile", "file-type", "x", "none")).reason,
    ).toMatch(/cannot be ruled from its extension alone/);
  });

  it("mcp-tool: tool names in the label or the coverage cell", () => {
    const agg = row("mcp:mcp-tool/logs_list / logs_tail (2)", "mcp", "mcp-tool", "E01", {
      label: "logs_list / logs_tail (2)",
      aggregate: true,
    });
    expect(
      resolveOne(agg, tableRow("logs_list / logs_tail (2)", "mcp-tool", "x", "none")).proposal
        ?.recon_resolution,
    ).toEqual({
      kind: "duplicate-of",
      ref: "mcp:tool/logs_list",
    });
    const cov = row("mcp:mcp-tool/Linter", "mcp", "mcp-tool", "E01", { label: "Linter" });
    expect(
      resolveOne(cov, tableRow("Linter", "offline-tool", "x", "none", "script_lint")).proposal
        ?.recon_resolution,
    ).toEqual({
      kind: "merged-via-alias",
      ref: "mcp:tool/script_lint",
    });
  });

  it("link-url and settings", () => {
    const link = row("link:World-Editor-link", "link", "link-format", "E01", {
      label: "World Editor link",
    });
    expect(
      resolveOne(
        link,
        tableRow("World Editor link", "link format", "`enfusion://WorldEditor/<world>`", "none"),
      ).proposal?.recon_resolution,
    ).toEqual({
      kind: "merged-via-alias",
      ref: "link:enfusion://WorldEditor",
    });
    const key = row(
      "setting:setting-key/Workbench: Enable net API",
      "setting",
      "setting-key",
      "E01",
      {
        label: "Workbench: Enable net API",
      },
    );
    expect(
      resolveOne(key, tableRow("Workbench: Enable net API", "setting", "`NetAPI_Enabled`", "none"))
        .proposal?.recon_resolution,
    ).toEqual({
      kind: "merged-via-alias",
      ref: "setting:Workbench/NetAPI_Enabled",
    });
    const sub = row(
      "setting:setting-key/Persisted state: World Editor/TerrainModule",
      "setting",
      "setting-key",
      "E01",
      {
        label: "Persisted state: World Editor/TerrainModule",
      },
    );
    const p = resolveOne(
      sub,
      tableRow("Persisted state: World Editor/TerrainModule", "settings subtree", "x", "none"),
    ).proposal;
    expect(p?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(p?.rule).toBe("setting-subtree");
  });

  it("manual decisions: an override wins over the rules, otherwise they only fill gaps", () => {
    const r = row("api:method/Do the bar", "api", "method", "E01", { label: "Do the bar" });
    const line = tableRow("Do the bar", "API method", "Bars", "FooTool.Bar(int a, int b)");
    const manual: Record<string, ManualDecision> = {
      [r.id]: {
        kind: "recon-error",
        ref: "@recon",
        read: "t.md#L4",
        note: "read by hand",
        override: true,
      },
    };
    expect(resolveOne(r, line, undefined, { manual }).proposal).toMatchObject({
      rule: "manual",
      recon_resolution: { kind: "recon-error", ref: "t.md#L4" },
    });
    const gap: Record<string, ManualDecision> = {
      [r.id]: { kind: "unresolved", read: "t.md#L4", note: "cannot tell" },
    };
    expect(resolveOne(r, line, undefined, { manual: gap }).proposal?.rule).toBe("api-member");
  });

  it("skips rows that are measured, explained, disposed or await a live enumerator", () => {
    const merged = row("api:FooTool.Bar/2", "api", "method", "E01");
    merged.sources.push({ enumerator: "E02", build: BUILD, ref: "pak:x#L1", confidence: "high" });
    const live = row("ui:menu/x", "ui", "menu-item", "E01");
    const disposed = row("api:method/d", "api", "method", "E01", {
      disposition: { kind: "not-automatable", why: "x", evidence: "EV-a-001" },
    });
    const explained = row("api:method/e", "api", "method", "E01");
    const overlays = new Map([
      [explained.id, { recon_resolution: { kind: "recon-error", ref: "t.md#L1" } }],
    ]);
    const open = row("api:method/f", "api", "method", "E01");
    const out = reconOffenders(
      [merged, live, disposed, explained, open],
      overlays as unknown as Parameters<typeof reconOffenders>[1],
      new Set(["menu-item"]),
    );
    expect(out.map((r) => r.id)).toEqual(["api:method/f"]);
  });
});

describe("rules (api: natives, IOP names, labels, cells, links)", () => {
  const native = row("net:native/BringIt", "net", "native", "E04");

  it("net-native: a built-in NET function is a duplicate of its net row; one found nowhere is absent", () => {
    const r = row("api:method/Bring it", "api", "method", "E01", { label: "Bring it" });
    const { proposal } = resolveWith(
      [native],
      r,
      tableRow("Bring it", "function", "Focus", "built-in NET func `BringIt` {Name}"),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "net:native/BringIt" });
    expect(proposal?.rule).toBe("net-native");
    expect(proposal?.mistake).toBe("real thing filed under the wrong dimension");
    const ghost = row("api:method/Ghost it", "api", "method", "E01", { label: "Ghost it" });
    expect(
      resolveWith(
        [native],
        ghost,
        tableRow("Ghost it", "function", "x", "built-in NET func `GhostNative`"),
      ).proposal?.recon_resolution,
    ).toEqual({
      kind: "absent-in-build",
      ref: "GhostNative (measured net rows, executable strings)",
    });
  });

  it("iop-op-names: short node names try the IOP class spellings; measured ones make a duplicate", () => {
    const r = row("api:class/SIGA ops Abs, Cos, Zzz", "api", "class", "E01", {
      label: "SIGA ops Abs, Cos, Zzz",
    });
    const { proposal } = resolveOne(r, tableRow("SIGA ops Abs, Cos, Zzz", "node", "x", "none"));
    expect(proposal?.recon_resolution).toEqual({
      kind: "duplicate-of",
      ref: "schema:IOPItemOpAbsClass",
    });
    expect(proposal?.rule).toBe("iop-op-names");
    expect(proposal?.note).toContain("IOPItemOpCosClass -> exe-only");
    expect(proposal?.note).toContain("Zzz -> absent");
  });

  it("api-label-class: a member row whose label names a measured class is a duplicate of the class", () => {
    const r = row("api:method/Module class FooTool", "api", "method", "E01", {
      label: "Module class FooTool",
    });
    const { proposal } = resolveOne(
      r,
      tableRow(
        "Module class FooTool",
        "script-api",
        "Module handle",
        "Workbench.GetModule(FooTool)",
      ),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "api:FooTool" });
    expect(proposal?.rule).toBe("api-label-class");
    expect(proposal?.mistake).toBe("kind misread (method -> class)");
  });

  it("api-bare-method: a bare method name declared by one class merges by alias", () => {
    const r = row("api:method/Save the thing", "api", "method", "E01", {
      label: "Save the thing",
    });
    const { proposal } = resolveOne(
      r,
      tableRow("Save the thing", "API method", "Saves", "SaveThing"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "merged-via-alias",
      ref: "api:FooTool.SaveThing/0",
    });
    expect(proposal?.rule).toBe("api-bare-method");
  });

  it("api-type-cell: a class in the API cell of a member row is a duplicate (kind misread)", () => {
    const r = row("api:method/All the foo things", "api", "method", "E01", {
      label: "All the foo things",
    });
    const { proposal } = resolveOne(
      r,
      tableRow("All the foo things", "API", "x", "FooTool (5 public methods)"),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "api:FooTool" });
    expect(proposal?.rule).toBe("api-type-cell");
    expect(proposal?.mistake).toBe("kind misread (method -> class)");
  });

  it("api-type-label: a type-like label of a member row, declared outside the scope", () => {
    const r = row("api:method/GameThing", "api", "method", "E01", { label: "GameThing" });
    const { proposal } = resolveOne(r, tableRow("GameThing", "API", "Plays", "script"));
    expect(proposal?.recon_resolution).toEqual({
      kind: "out-of-scope",
      ref: "pak:scripts/Game/Sound/GameThing.c#L1",
    });
    expect(proposal?.rule).toBe("api-type-label");
  });

  it("api-type: a list label with plain words also reads the classes of the what cell", () => {
    const r = row("api:class/Mixer Thing %2F BtVariableEntity %2F Other", "api", "class", "E01", {
      label: "Mixer Thing / BtVariableEntity / Other",
    });
    const { proposal } = resolveOne(
      r,
      tableRow(
        "Mixer Thing / BtVariableEntity / Other",
        "mixer node",
        "Same classes (GroupClass x28, BtVariableGroup x6)",
        "none",
      ),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "duplicate-of",
      ref: "schema:BtVariableEntity",
    });
    expect(proposal?.note).toContain("names 3 thing(s)");
    expect(proposal?.note).toContain("GroupClass -> schema:GroupClass");
    expect(proposal?.note).toContain("BtVariableGroup -> schema:BtVariableGroup");
  });

  it("link-in-text: a function row that names measured link formats is a duplicate of the first", () => {
    const r = row("api:method/Editor links", "api", "method", "E01", { label: "Editor links" });
    const { proposal } = resolveOne(
      r,
      tableRow("Editor links", "function", "enfusion://WorldEditor/... deep links", "none"),
    );
    expect(proposal?.recon_resolution).toEqual({
      kind: "duplicate-of",
      ref: "link:enfusion://WorldEditor",
    });
    expect(proposal?.rule).toBe("link-in-text");
  });
});

describe("rules (files)", () => {
  const ini = row("file:.ini", "file", "file-type", "E09");

  it("file-ext: an extension of the label with no row and no string is named, and the row never merges", () => {
    const r = row("file:file-type/.agf %2F .zzz", "file", "file-type", "E01", {
      label: ".agf / .zzz",
    });
    const { proposal } = resolveOne(r, tableRow(".agf / .zzz", "file type", "x", "none"));
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "file:.agf" });
    expect(proposal?.note).toContain(
      "also named, with no measured file row and no executable string: .zzz",
    );
  });

  it("file-ext-in-text: a location of a measured type is a duplicate of that type", () => {
    const r = row("file:file-type/Launcher list", "file", "file-type", "E01", {
      label: "Launcher list",
    });
    const { proposal } = resolveOne(
      r,
      tableRow("Launcher list", "profile file", "profile/.projectList.conf (hidden)", "none"),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "file:.conf" });
    expect(proposal?.rule).toBe("file-ext-in-text");
    expect(proposal?.mistake).toBe("kind misread (a file or folder, not a file type)");
  });

  it("file-type-config: a set of configs whose format only the automation cell names", () => {
    const r = row("file:file-type/Rule configs", "file", "file-type", "E01", {
      label: "Rule configs",
    });
    const { proposal } = resolveOne(
      r,
      tableRow(
        "Rule configs",
        "file-type",
        "10 configs under Configs/X",
        "none",
        "none",
        "file-format (.conf)",
      ),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "file:.conf" });
    expect(proposal?.rule).toBe("file-type-config");
  });

  it("file-api-type: a contract read through a class is a duplicate; a format without a file row stays open", () => {
    const contract = row("file:file-type/Plugin contract", "file", "file-type", "E01", {
      label: "Plugin contract",
    });
    const p = resolveOne(
      contract,
      tableRow("Plugin contract", "file type", "x", "FooTool(...)"),
    ).proposal;
    expect(p?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "api:FooTool" });
    expect(p?.rule).toBe("file-api-type");
    const csv = row("file:file-type/Object import CSV", "file", "file-type", "E01", {
      label: "Object import CSV",
    });
    const u = resolveOne(
      csv,
      tableRow("Object import CSV", "file type", "9 fields per line", "FooTool"),
    );
    expect(u.proposal).toBeUndefined();
    expect(u.reason).toMatch(/^a file format \(CSV\) that a measured class reads/);
  });

  it("file-settings-store and file-no-extension: recon errors with accurate notes", () => {
    const store = row("file:file-type/Editor settings (registry)", "file", "file-type", "E01", {
      label: "Editor settings (registry)",
    });
    const s = resolveOne(
      store,
      tableRow("Editor settings (registry)", "file type", "All options", "none"),
    ).proposal;
    expect(s?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(s?.rule).toBe("file-settings-store");
    expect(s?.note).not.toContain("E06 measures");
    const none = row("file:file-type/Load container files", "file", "file-type", "E01", {
      label: "Load container files",
    });
    const n = resolveOne(
      none,
      tableRow("Load container files", "file", "Load any resource", "none"),
    ).proposal;
    expect(n?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(n?.rule).toBe("file-no-extension");
  });

  it("setting-file: a settings export named by its file is a duplicate of the file type", () => {
    const r = row("setting:setting-key/wbDump.ini", "setting", "setting-key", "E01", {
      label: "wbDump.ini",
    });
    const { proposal } = resolveWith(
      [ini],
      r,
      tableRow("wbDump.ini", "settings export", "Same sections as the registry", "none"),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "file:.ini" });
    expect(proposal?.rule).toBe("setting-file");
  });
});

describe("rules (settings and plugin settings)", () => {
  const pluginRow = (attr: string, signature: string, enumerator = "E03"): Row =>
    row(`plugin:SCR_FooPlugin#attr:${attr}`, "plugin", "plugin-setting", enumerator, { signature });

  it("setting-store: a label naming a store with measured keys is a recon error", () => {
    const r = row(
      "setting:setting-key/NET API enable %2F port settings",
      "setting",
      "setting-key",
      "E01",
      {
        label: "NET API enable / port settings",
      },
    );
    const { proposal } = resolveOne(
      r,
      tableRow(
        "NET API enable / port settings",
        "setting",
        "`NetAPI_Enabled` (0/1) and port",
        "none",
      ),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(proposal?.rule).toBe("setting-store");
    expect(proposal?.note).toContain("setting:Workbench/NetAPI_Enabled");
  });

  it("setting-plugin-persistence: the ScriptTools subtree is the measured plugin settings", () => {
    const r = row(
      "setting:setting-key/Persisted state: <Module>%2FScriptTools%2F<PluginClass>",
      "setting",
      "setting-key",
      "E01",
      {
        label: "Persisted state: <Module>/ScriptTools/<PluginClass>",
      },
    );
    const { proposal } = resolveWith(
      [pluginRow("m_a", "bool m_a", "E06")],
      r,
      tableRow(
        "Persisted state: <Module>/ScriptTools/<PluginClass>",
        "settings subtree",
        "Serialized plugin settings",
        "none",
      ),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(proposal?.rule).toBe("setting-plugin-persistence");
  });

  it("setting-options-tab and setting-shortcuts: groups, not keys", () => {
    const tab = row("setting:setting-key/Animation Editor tab", "setting", "setting-key", "E01", {
      label: "Animation Editor tab",
    });
    expect(
      resolveOne(tab, tableRow("Animation Editor tab", "settings", "Event Filter, colours", "none"))
        .proposal?.rule,
    ).toBe("setting-options-tab");
    const keys = row("setting:setting-key/Keyboard shortcuts", "setting", "setting-key", "E01", {
      label: "Keyboard shortcuts",
    });
    const p = resolveWith(
      [row("ui:Shared/shortcut/Save", "ui", "shortcut", "E06")],
      keys,
      tableRow("Keyboard shortcuts", "settings", "Configurable shortcuts", "none"),
    ).proposal;
    expect(p?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(p?.rule).toBe("setting-shortcuts");
  });

  it("setting-exe-option: an option only the executable declares stays open", () => {
    const r = row("setting:setting-key/Workbench: Invert Mouse", "setting", "setting-key", "E01", {
      label: "Workbench: Invert Mouse",
    });
    const { proposal, reason } = resolveOne(
      r,
      tableRow("Workbench: Invert Mouse", "setting", "inverts the camera", "none"),
    );
    expect(proposal).toBeUndefined();
    expect(reason).toMatch(/^executable-only option: the executable declares InvertMouse \(0x50\)/);
  });

  it("plugin-setting-typed: a plugin option described by its value type merges into the attribute of that type", () => {
    const r = row("plugin:plugin-setting/Template types", "plugin", "plugin-setting", "E01", {
      label: "Template types",
    });
    const line =
      "| Template types | plugin-option | SCR_EFooType: None, Entity | none | file-format (.conf) | none | SRC:SCR_FooPlugin.c | H |";
    const one = resolveWith([pluginRow("m_eType", "SCR_EFooType m_eType = 0")], r, line).proposal;
    expect(one?.recon_resolution).toEqual({
      kind: "merged-via-alias",
      ref: "plugin:SCR_FooPlugin#attr:m_eType",
    });
    expect(one?.rule).toBe("plugin-setting-typed");
    // No plugin named: every plugin's settings are searched, and two hold that type.
    const two = resolveWith(
      [
        pluginRow("m_eType", "SCR_EFooType m_eType = 0"),
        row("plugin:SCR_BarPlugin#attr:m_eOther", "plugin", "plugin-setting", "E03", {
          signature: "SCR_EFooType m_eOther = 0",
        }),
      ],
      r,
      line.replace("SRC:SCR_FooPlugin.c", "SRC"),
    );
    expect(two.proposal).toBeUndefined();
    expect(two.reason).toMatch(/^ambiguous: 2 measured plugin settings hold a value of type/);
  });

  it("plugin-settings-block: a settings block of a plugin is its measured attributes", () => {
    const r = row(
      "plugin:plugin-setting/Foo settings (2 attributes)",
      "plugin",
      "plugin-setting",
      "E01",
      {
        label: "Foo settings (2 attributes)",
      },
    );
    const { proposal } = resolveWith(
      [pluginRow("m_a", "bool m_a"), pluginRow("m_b", "bool m_b")],
      r,
      tableRow(
        "Foo settings (2 attributes)",
        "plugin-option",
        "Toggles",
        "SCR_FooPlugin.Configure()",
      ),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "recon-error", ref: "t.md#L4" });
    expect(proposal?.rule).toBe("plugin-settings-block");
    expect(proposal?.note).toContain("2 measured rows plugin:SCR_FooPlugin#attr:*");
  });
});

describe("alias guard and missing inputs", () => {
  it("several recon rows naming one target become duplicates, never aliases", () => {
    const a = row("api:method/Do the bar", "api", "method", "E01", {
      label: "Do the bar",
      ref: "<repo>/docs/v2/recon/t.md#L4",
    });
    const b = row("api:method/Bar again", "api", "method", "E01", {
      label: "Bar again",
      ref: "<repo>/docs/v2/recon/t.md#L5",
    });
    const res = resolveRecon(
      inputs([...measuredRows(), a, b], {
        "t.md": reconFile("2.1 FooTool API", [
          tableRow("Do the bar", "API method", "Bars", "FooTool.Bar(int a, int b)"),
          tableRow("Bar again", "API method", "Bars again", "FooTool.Bar(int a, int b)"),
        ]),
      }),
    );
    expect(res.proposals.map((p) => p.recon_resolution)).toEqual([
      { kind: "duplicate-of", ref: "api:FooTool.Bar/2" },
      { kind: "duplicate-of", ref: "api:FooTool.Bar/2" },
    ]);
    expect(res.proposals[0].note).toContain("no alias: 2 recon rows name api:FooTool.Bar/2");
  });

  it("a target that already carries a recon observation takes no second one", () => {
    const target = row("api:FooTool.Bar/2", "api", "method", "E02", { label: "Bar" });
    target.sources.push({
      enumerator: "E01",
      build: BUILD,
      ref: "<repo>/docs/v2/recon/t.md#L9",
      confidence: "low",
    } as Row["sources"][number]);
    const r = row("api:method/Do the bar", "api", "method", "E01", { label: "Do the bar" });
    const rows = measuredRows().filter((x) => x.id !== target.id);
    const res = resolveRecon(
      inputs([...rows, target, r], {
        "t.md": reconFile("2.1 FooTool API", [
          tableRow("Do the bar", "API method", "Bars", "FooTool.Bar(int a, int b)"),
        ]),
      }),
    );
    expect(res.proposals[0].recon_resolution.kind).toBe("duplicate-of");
    expect(res.proposals[0].note).toContain("already carries a recon observation");
  });

  it("an inherited base-class member described in one module is a duplicate, not an alias", () => {
    const close = row("api:ModDef.Close/0", "api", "method", "E02", {
      label: "Close",
      module: "Shared",
    } as Partial<Row>);
    const r = row("api:method/Close the string editor", "api", "method", "E01", {
      label: "Close the string editor",
      module: "LocalizationEditor",
    } as Partial<Row>);
    const { proposal } = resolveWith(
      [close],
      r,
      tableRow("Close the string editor", "API method", "Close it", "ModDef.Close() : bool"),
    );
    expect(proposal?.recon_resolution).toEqual({ kind: "duplicate-of", ref: "api:ModDef.Close/0" });
    expect(proposal?.note).toContain("declared on ModDef, which 1 class(es) inherit");
  });

  it("an alias records what it changes on the target, telling policy defaults by their reason", () => {
    const defaults = [
      { path: "net-api-handler", reason: "Policy default: a" },
      { path: "gui-automation", reason: "Policy default: b" },
    ];
    // The recon proposes one of the default paths with its own reason: a proposal, not a default.
    const r = row("api:method/Do the bar", "api", "method", "E01", {
      label: "Do the bar",
      what: "Bars the foo",
      risk: "mutating",
      paths: [{ path: "net-api-handler", reason: "recon cell", status: "candidate" }],
    } as Partial<Row>);
    const target = row("api:FooTool.Bar/2", "api", "method", "E02", {
      label: "Bar",
      paths: defaults.map((d) => ({ ...d, status: "candidate" })),
    } as Partial<Row>);
    const res = resolveRecon(
      inputs(
        [...measuredRows().filter((x) => x.id !== target.id), target, r],
        {
          "t.md": reconFile("2.1 FooTool API", [
            tableRow("Do the bar", "API method", "Bars the foo", "FooTool.Bar(int a, int b)"),
          ]),
        },
        { defaultPaths: () => defaults },
      ),
    );
    expect(res.proposals[0].recon_resolution.kind).toBe("merged-via-alias");
    expect(res.proposals[0].merge_effect).toEqual([
      'what: none -> the recon\'s "Bars the foo" (the target is at T0; a description counts toward T1)',
      "paths: net-api-handler, gui-automation -> net-api-handler (the target's were policy defaults; a proposed path replaces them)",
    ]);
  });

  it("without the executable strings or the source index no absence is ruled", () => {
    const ghost = row("api:GhostPlugin", "api", "class", "E01", { label: "GhostPlugin" });
    const line = tableRow("GhostPlugin", "class", "x", "none");
    const noExe = resolveOne(ghost, line, undefined, { exe: undefined });
    expect(noExe.proposal).toBeUndefined();
    expect(noExe.reason).toMatch(/^input not loaded/);
    const noSource = resolveOne(ghost, line, undefined, { source: undefined });
    expect(noSource.proposal).toBeUndefined();
    const m = row("api:method/Ghost call", "api", "method", "E01", { label: "Ghost call" });
    const member = resolveOne(
      m,
      tableRow("Ghost call", "API method", "x", "FooTool.Ghost()"),
      undefined,
      {
        source: undefined,
      },
    );
    expect(member.proposal).toBeUndefined();
    expect(member.reason).toMatch(/^input not loaded/);
  });
});

// ── Determinism and checks ────────────────────────────────────────────────────

describe("determinism and proposal checks", () => {
  const recon = [
    row("api:method/Do the bar", "api", "method", "E01", {
      label: "Do the bar",
      ref: "<repo>/docs/v2/recon/t.md#L4",
    }),
    row("api:method/Add node", "api", "method", "E01", {
      label: "Add node",
      ref: "<repo>/docs/v2/recon/t.md#L5",
    }),
    row("api:class/Abs (IOPItemOpAbsClass) x29", "api", "class", "E01", {
      label: "Abs (IOPItemOpAbsClass) x29",
      ref: "<repo>/docs/v2/recon/t.md#L6",
    }),
  ];
  const files = {
    "t.md": reconFile("2.1 FooTool API", [
      tableRow("Do the bar", "API method", "Bars", "FooTool.Bar(int a, int b)"),
      tableRow("Add node", "function", "Palette click", "none"),
      tableRow("Abs (IOPItemOpAbsClass) x29", "signal node", "Absolute value", "none"),
    ]),
  };

  it("gives the same proposals for the same input, in any row order", () => {
    const a = resolveRecon(inputs([...measuredRows(), ...recon], files));
    const b = resolveRecon(inputs([...recon].reverse().concat(measuredRows().reverse()), files));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.proposals.map((p) => p.id)).toEqual([...recon.map((r) => r.id)].sort());
    expect(a.considered).toBe(3);
  });

  it("checkProposals refuses a missing target, a chain and a cross-dim alias", () => {
    const rows = new Map([...measuredRows(), ...recon].map((r) => [r.id, r]));
    const p = (id: string, kind: Proposal["recon_resolution"]["kind"], ref: string): Proposal => ({
      id,
      recon_resolution: { kind, ref },
      rule: "t",
      mistake: "t",
      evidence: [],
      recon: "t.md#L4",
    });
    const problems = checkProposals(
      [
        p("api:method/Do the bar", "merged-via-alias", "api:Nope/0"),
        p("api:class/Abs (IOPItemOpAbsClass) x29", "merged-via-alias", "schema:IOPItemOpAbsClass"),
        p("api:method/Add node", "out-of-scope", "somewhere"),
      ],
      rows,
      [],
    );
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/not a ledger row/);
    expect(problems.join("\n")).toMatch(/alias across dims/);
    expect(problems.join("\n")).toMatch(/not pak:<path>#L<line>/);
  });
});

// ── The CLI on a temporary census ─────────────────────────────────────────────

describe("recon-resolve.ts on a temporary census", () => {
  function fixture(): {
    fx: ReturnType<typeof makeCensus>;
    dir: string;
    index: string;
    recon: string;
    exe: string;
  } {
    const fx = makeCensus(BUILD);
    writeFileSync(fx.paths.aliases, aliasesText([]));
    writeObservations(fx, "E02", BUILD, [
      apiClass("FooTool", { ref: "pak:scripts/WorkbenchGame/FooTool.c#L1" }),
      apiMethod("FooTool", "Bar", 2),
    ]);
    const reconRow = (label: string, line: number, kind = "method"): Record<string, unknown> => ({
      dim: "api",
      kind,
      module: "Shared",
      key: { name: label },
      label,
      origin: "vanilla",
      ref: `<repo>/docs/v2/recon/world-editor.md#L${line}`,
      quote: label,
      confidence: "low",
      recon_coverage: "none",
    });
    writeObservations(fx, "E01", BUILD, [
      reconRow("Do the bar", 4),
      reconRow("Add node", 5),
      reconRow("GhostPlugin", 6, "class"),
    ]);
    const dir = join(fx.repo, "out");
    mkdirSync(dir, { recursive: true });
    const recon = join(fx.repo, "docs", "v2", "recon");
    writeRepoFile(
      fx,
      "docs/v2/recon/world-editor.md",
      reconFile("2.1 FooTool API", [
        tableRow("Do the bar", "API method", "Bars", "FooTool.Bar(int a, int b)"),
        tableRow("Add node", "function", "Palette click", "none"),
        tableRow("GhostPlugin", "class", "Nothing", "none"),
      ]).join("\n") + "\n",
    );
    const index = join(fx.repo, "source-index.jsonl");
    saveSourceIndex(sourceIndex(), { file: index });
    const exe = join(fx.repo, "ascii.tsv");
    writeFileSync(exe, "offset\tstring\n0x10\tIOPItemOpCosClass\n");
    return { fx, dir, index, recon, exe };
  }

  it("proposes, applies through acceptAlias and appendStatePatch, and the census builds with no recon offender left", () => {
    const { fx, dir, index, recon, exe } = fixture();
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const propose = runIn(fx, runResolve, [
      "--out-dir",
      dir,
      "--source-index",
      index,
      "--exe-strings",
      exe,
      "--recon-dir",
      recon,
      "--json",
    ]);
    expect(propose.code).toBe(0);
    expect(JSON.parse(propose.stdout)).toMatchObject({ considered: 3, proposed: 3, unresolved: 0 });
    const lines = readFileSync(join(dir, "recon-resolutions.jsonl"), "utf-8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).recon_resolution.kind)).toEqual([
      "absent-in-build",
      "recon-error",
      "merged-via-alias",
    ]);
    expect(readFileSync(join(dir, "recon-unresolved.jsonl"), "utf-8")).toBe("");

    // Proposing twice writes the same bytes.
    runIn(fx, runResolve, [
      "--out-dir",
      dir,
      "--source-index",
      index,
      "--exe-strings",
      exe,
      "--recon-dir",
      recon,
    ]);
    expect(readFileSync(join(dir, "recon-resolutions.jsonl"), "utf-8").trim().split("\n")).toEqual(
      lines,
    );

    writeEvidence(fx, "EV-recon-001");
    const apply = runIn(fx, runResolve, [
      "--apply",
      "--evidence",
      "EV-recon-001",
      "--in",
      join(dir, "recon-resolutions.jsonl"),
      "--at",
      "2026-01-01T00:00:00Z",
    ]);
    expect(apply.stderr).toBe("");
    expect(apply.code).toBe(0);
    expect(apply.stdout).toContain("1 alias(es), 2 state patch(es)");

    expect(runIn(fx, runBuild, []).code).toBe(0);
    const built = buildLedger(fx.paths);
    expect(built.problems).toEqual([]);
    const target = built.rows.find((r) => r.id === "api:FooTool.Bar/2");
    expect(target?.sources.map((s) => s.enumerator).sort()).toEqual(["E01", "E02"]);
    expect(built.rows.some((r) => r.id === "api:method/Do the bar")).toBe(false);
    const left = reconOffenders(
      built.rows,
      foldState(fx.paths).overlays,
      awaitsLiveKinds(loadUniverses(fx.paths)),
    );
    expect(left).toEqual([]);
  });

  it("refuses the whole set and writes nothing when one proposal fails a check", () => {
    const { fx, dir } = fixture();
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const bad = [
      {
        id: "api:method/Add node",
        recon_resolution: { kind: "recon-error", ref: "world-editor.md#L5" },
        rule: "t",
        mistake: "t",
        evidence: [],
        recon: "world-editor.md#L5",
      },
      {
        id: "api:method/Do the bar",
        recon_resolution: { kind: "merged-via-alias", ref: "api:Nope/1" },
        rule: "t",
        mistake: "t",
        evidence: [],
        recon: "world-editor.md#L4",
      },
    ];
    const file = join(dir, "bad.jsonl");
    writeFileSync(file, bad.map((b) => JSON.stringify(b)).join("\n") + "\n");
    writeEvidence(fx, "EV-recon-001");
    const before = readFileSync(fx.paths.state, "utf-8");
    const r = runIn(fx, runResolve, ["--apply", "--evidence", "EV-recon-001", "--in", file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("api:Nope/1 is not a ledger row");
    expect(readFileSync(fx.paths.state, "utf-8")).toBe(before);
    expect(JSON.parse(readFileSync(fx.paths.aliases, "utf-8")).aliases).toEqual([]);
  });

  it("refuses a proposals file that names one row twice and writes nothing", () => {
    const { fx, dir } = fixture();
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const line = JSON.stringify({
      id: "api:method/Do the bar",
      recon_resolution: { kind: "merged-via-alias", ref: "api:FooTool.Bar/2" },
      rule: "t",
      mistake: "t",
      evidence: [],
      recon: "world-editor.md#L4",
    });
    const file = join(dir, "dup.jsonl");
    writeFileSync(file, `${line}\n${line}\n`);
    writeEvidence(fx, "EV-recon-001");
    const before = readFileSync(fx.paths.state, "utf-8");
    const r = runIn(fx, runResolve, ["--apply", "--evidence", "EV-recon-001", "--in", file]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("api:method/Do the bar: proposed more than once");
    expect(readFileSync(fx.paths.state, "utf-8")).toBe(before);
    expect(JSON.parse(readFileSync(fx.paths.aliases, "utf-8")).aliases).toEqual([]);
  });

  it("without the executable strings or the source index it writes nothing; --dry-run rules no absence", () => {
    const { fx, dir, index, recon, exe } = fixture();
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const common = ["--out-dir", dir, "--recon-dir", recon];
    const noExe = runIn(fx, runResolve, [
      ...common,
      "--source-index",
      index,
      "--exe-strings",
      join(fx.repo, "no-such.tsv"),
    ]);
    expect(noExe.code).toBe(2);
    expect(noExe.stderr).toContain("no executable strings at");
    const noIndex = runIn(fx, runResolve, [
      ...common,
      "--source-index",
      join(fx.repo, "no-such.jsonl"),
      "--exe-strings",
      exe,
    ]);
    expect(noIndex.code).toBe(2);
    expect(noIndex.stderr).toContain("no source index for build");
    expect(existsSync(join(dir, "recon-resolutions.jsonl"))).toBe(false);
    const dry = runIn(fx, runResolve, [
      ...common,
      "--source-index",
      index,
      "--exe-strings",
      join(fx.repo, "no-such.tsv"),
      "--dry-run",
      "--json",
    ]);
    expect(dry.code).toBe(0);
    const out = JSON.parse(dry.stdout);
    expect(out.by_kind["absent-in-build"]).toBeUndefined();
    expect(out.unresolved).toBe(1);
    expect(existsSync(join(dir, "recon-resolutions.jsonl"))).toBe(false);
  });

  it("refuses --apply without evidence and --propose with --apply", () => {
    const { fx } = fixture();
    expect(runIn(fx, runResolve, ["--apply"]).code).toBe(2);
    expect(runIn(fx, runResolve, ["--apply", "--propose", "--evidence", "EV-recon-001"]).code).toBe(
      2,
    );
    expect(existsSync(join(fx.root, "evidence", "EV-recon-001.json"))).toBe(false);
  });
});
