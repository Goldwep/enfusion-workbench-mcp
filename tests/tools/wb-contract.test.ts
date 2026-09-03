/**
 * Contract tests for the wb_* tools: every payload below is built ONLY from
 * the keys the Enforce handlers actually emit (docs/CODE-REVIEW-2026-09-fable5.md
 * appendix, "handler action / response-key inventory"). A tool that reads a
 * key the handler never sends fails here.
 *
 * Also asserts that an in-payload `{status:"error", message:"boom"}` makes
 * every tool return isError:true with the handler message, that mode-gate
 * refusals set isError, and that `result:false` (Clipboard/ExecuteAction)
 * is treated as failure.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import type { Config } from "../../src/config.js";

import { registerWbConnect } from "../../src/tools/wb-connect.js";
import { registerWbState } from "../../src/tools/wb-state.js";
import { registerWbReload } from "../../src/tools/wb-reload.js";
import { registerWbEditorTools } from "../../src/tools/wb-editor.js";
import { registerWbExecuteAction } from "../../src/tools/wb-execute-action.js";
import { registerWbEntityTools } from "../../src/tools/wb-entities.js";
import { registerWbComponent } from "../../src/tools/wb-components.js";
import { registerWbTerrain } from "../../src/tools/wb-terrain.js";
import { registerWbLayers } from "../../src/tools/wb-layers.js";
import { registerWbResources } from "../../src/tools/wb-resources.js";
import { registerWbPrefabs } from "../../src/tools/wb-prefabs.js";
import { registerWbClipboard } from "../../src/tools/wb-clipboard.js";
import { registerWbScriptEditor } from "../../src/tools/wb-script-editor.js";
import { registerWbLocalization } from "../../src/tools/wb-localization.js";
import { registerWbProjects } from "../../src/tools/wb-projects.js";
import { registerWbLaunch } from "../../src/tools/wb-launch.js";
import { registerWbEntityDuplicate } from "../../src/tools/wb-entity-duplicate.js";
import { isHandlerError } from "../../src/workbench/response.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<ToolResult>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _meta: unknown, handler: ToolHandler) {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

type Payload = Record<string, unknown>;
type CallFn = (apiFunc: string, params: Record<string, unknown>) => Payload;

function fakeClient(mode: "edit" | "play" | "unknown", callImpl: CallFn) {
  const calls: { apiFunc: string; params: Record<string, unknown> }[] = [];
  const client = {
    state: { connected: true, mode, lastUpdated: Date.now() },
    lastLaunchNotes: [] as string[],
    inFlightLaunchTarget: null as string | null,
    ping: vi.fn(async () => true),
    ensureRunning: vi.fn(async () => undefined),
    cleanupHandlerScripts: vi.fn(() => false),
    call: vi.fn(async (apiFunc: string, params: Record<string, unknown> = {}) => {
      calls.push({ apiFunc, params });
      return callImpl(apiFunc, params);
    }),
  };
  return { client: client as unknown as WorkbenchClient, calls };
}

function text(r: ToolResult): string {
  return r.content.map((c) => c.text).join("\n");
}

const dummyConfig = {
  workbenchPath: "C:/wb",
  projectPath: "C:/proj",
  gamePath: "C:/game",
  dataDir: "C:/data",
  patternsDir: "C:/patterns",
  workbenchHost: "127.0.0.1",
  workbenchPort: 5775,
  projectIndexPath: "C:/idx.db",
  logsPath: "C:/logs",
} as Config;

function registerAll(server: McpServer, client: WorkbenchClient) {
  registerWbConnect(server, client);
  registerWbState(server, client);
  registerWbReload(server, client);
  registerWbEditorTools(server, client);
  registerWbExecuteAction(server, client);
  registerWbEntityTools(server, client);
  registerWbComponent(server, client);
  registerWbTerrain(server, client);
  registerWbLayers(server, client);
  registerWbResources(server, client);
  registerWbPrefabs(server, client);
  registerWbClipboard(server, client);
  registerWbScriptEditor(server, client);
  registerWbLocalization(server, client);
  registerWbProjects(server, client);
  registerWbLaunch(server, { ...dummyConfig }, client);
}

async function run(
  tool: string,
  args: Record<string, unknown>,
  payload: Payload,
  mode: "edit" | "play" | "unknown" = "edit",
) {
  const { server, tools } = fakeServer();
  const { client, calls } = fakeClient(mode, () => payload);
  registerAll(server, client);
  const handler = tools.get(tool);
  if (!handler) throw new Error(`tool not registered: ${tool}`);
  const result = await handler(args, {});
  return { result, calls, text: text(result) };
}

// ---------------------------------------------------------------------------
// Table: tool × args × inventory-only payload × expected rendered fragments
// ---------------------------------------------------------------------------

interface Row {
  tool: string;
  args: Record<string, unknown>;
  mode?: "edit" | "play";
  payload: Payload;
  expect: string[];
  /** apiFunc the tool must have called with this payload */
  apiFunc: string;
}

const ROWS: Row[] = [
  {
    tool: "wb_connect",
    args: {},
    apiFunc: "EMCP_WB_Ping",
    payload: { status: "ok", mode: "edit", message: "pong" },
    expect: ["Workbench Connected", "**Mode:** edit", "pong"],
  },
  {
    tool: "wb_state",
    args: {},
    apiFunc: "EMCP_WB_GetState",
    payload: {
      status: "ok",
      message: "State snapshot",
      mode: "edit",
      entityCount: 12,
      selectedCount: 1,
      currentSubScene: 0,
      isPrefabEditMode: false,
      boundsMin: "0 0 0",
      boundsMax: "4096 0 4096",
      selectedNames: ["Soldier_1"],
    },
    expect: ["**Entity Count:** 12", "Soldier_1", "0 0 0 to 4096 0 4096"],
  },
  {
    tool: "wb_reload",
    args: { target: "scripts" },
    apiFunc: "EMCP_WB_Reload",
    payload: { status: "ok", message: "Scripts reloaded" },
    expect: ["Reload Complete", "Scripts reloaded"],
  },
  {
    tool: "wb_play",
    args: {},
    apiFunc: "EMCP_WB_EditorControl",
    payload: { status: "ok", action: "play", message: "Switched to game mode" },
    expect: ["Play Mode Started", "Switched to game mode"],
  },
  {
    tool: "wb_stop",
    args: {},
    mode: "play",
    apiFunc: "EMCP_WB_EditorControl",
    payload: { status: "ok", action: "stop", message: "Switched to edit mode" },
    expect: ["Edit Mode Restored", "Switched to edit mode"],
  },
  {
    tool: "wb_save",
    args: {},
    apiFunc: "EMCP_WB_EditorControl",
    payload: { status: "ok", action: "save", message: "World saved" },
    expect: ["Save Complete", "World saved"],
  },
  {
    tool: "wb_undo_redo",
    args: { action: "undo" },
    apiFunc: "EMCP_WB_EditorControl",
    payload: { status: "ok", action: "undo", message: "Undo executed" },
    expect: ["Undo Complete", "Undo executed"],
  },
  {
    tool: "wb_open_resource",
    args: { path: "worlds/Test.ent" },
    apiFunc: "EMCP_WB_EditorControl",
    payload: { status: "ok", action: "openResource", message: "Opened resource: worlds/Test.ent" },
    expect: ["Resource Opened", "worlds/Test.ent"],
  },
  {
    tool: "wb_execute_action",
    args: { menuPath: "Tools, Reload Scripts" },
    apiFunc: "EMCP_WB_ExecuteAction",
    payload: {
      status: "ok",
      menuPath: "Tools,Reload Scripts",
      message: "Action executed successfully",
    },
    expect: ["Action Executed", "Tools,Reload Scripts", "Action executed successfully"],
  },
  {
    tool: "wb_entity_create",
    args: { prefab: "{ABC}Prefabs/x.et", position: "100 0 200", layerID: 2 },
    apiFunc: "EMCP_WB_CreateEntity",
    payload: {
      status: "ok",
      message: "Entity created from prefab: {ABC}Prefabs/x.et",
      entityName: "Soldier_7",
      entityClass: "SCR_ChimeraCharacter",
      position: "100 0 200",
    },
    expect: ["Entity Created", "Soldier_7", "SCR_ChimeraCharacter", "100 0 200", "Layer ID:** 2"],
  },
  {
    tool: "wb_entity_delete",
    args: { name: "Soldier_7" },
    apiFunc: "EMCP_WB_DeleteEntity",
    payload: {
      status: "ok",
      message: "Deleted",
      deletedName: "Soldier_7",
      deletedClass: "SCR_ChimeraCharacter",
    },
    expect: ["Entity Deleted", "Soldier_7"],
  },
  {
    tool: "wb_entity_list",
    args: { offset: 0, limit: 2 },
    apiFunc: "EMCP_WB_ListEntities",
    payload: {
      status: "ok",
      message: "ok",
      totalCount: 120,
      returnedCount: 2,
      offset: 0,
      entities: [
        { name: "Alpha", className: "GenericEntity", position: "1 2 3" },
        { name: "Bravo", className: "SCR_ChimeraCharacter", position: "4 5 6" },
      ],
    },
    expect: ["showing 2 of 120", "Alpha", "GenericEntity", "1 2 3", "Bravo", "118 more entities"],
  },
  {
    tool: "wb_entity_inspect",
    args: { name: "Alpha" },
    apiFunc: "EMCP_WB_GetEntity",
    payload: {
      status: "ok",
      message: "ok",
      name: "Alpha",
      className: "GenericEntity",
      position: "1 2 3",
      rotation: "0 90 0",
      componentCount: 1,
      layerID: 3,
      subScene: 0,
      varCount: 1,
      properties: [{ name: "coords", value: "1 2 3" }],
      components: [{ className: "MeshObject", index: 0 }],
    },
    expect: [
      "Entity: Alpha",
      "**Class:** GenericEntity",
      "**Rotation:** 0 90 0",
      "**Layer ID:** 3",
      "MeshObject",
      "| coords | 1 2 3 |",
    ],
  },
  {
    tool: "wb_entity_modify",
    args: { name: "Alpha", action: "getWorldTransform", memberIndex: -1 },
    apiFunc: "EMCP_WB_ModifyEntity",
    payload: {
      status: "ok",
      message: "Transform for: Alpha",
      entityName: "Alpha",
      properties: [
        { name: "position", type: "vector", value: "10 20 30" },
        { name: "rotation", type: "vector", value: "0 45 0" },
      ],
    },
    expect: ["Transform: Alpha", "**Position:** 10 20 30", "**Rotation:** 0 45 0"],
  },
  {
    tool: "wb_entity_modify",
    args: { name: "Alpha", action: "move", value: "5 5 5", memberIndex: -1 },
    apiFunc: "EMCP_WB_ModifyEntity",
    payload: { status: "ok", message: "Moved Alpha to 5 5 5", entityName: "Alpha" },
    expect: ["Entity Modified", "Moved to 5 5 5", "Moved Alpha to 5 5 5"],
  },
  {
    tool: "wb_entity_select",
    args: { action: "getSelected" },
    apiFunc: "EMCP_WB_SelectEntity",
    payload: {
      status: "ok",
      message: "ok",
      action: "getSelected",
      selectedCount: 1,
      selectedEntities: [{ name: "Alpha", className: "GenericEntity" }],
    },
    expect: ["Selected Entities** (1)", "Alpha", "(GenericEntity)"],
  },
  {
    tool: "wb_component",
    args: { entityName: "Alpha", action: "list" },
    apiFunc: "EMCP_WB_Components",
    payload: {
      status: "ok",
      message: "ok",
      entityName: "Alpha",
      componentCount: 1,
      components: [{ className: "RigidBody", index: 0 }],
    },
    expect: ["Components on Alpha", "RigidBody"],
  },
  {
    tool: "wb_terrain",
    args: { action: "getHeight", x: 100, z: 200 },
    apiFunc: "EMCP_WB_Terrain",
    payload: { status: "ok", action: "getHeight", message: "h", height: 42.5 },
    expect: ["Terrain Height", "(100, 200)", "**Height (Y):** 42.5"],
  },
  {
    tool: "wb_terrain",
    args: { action: "getBounds" },
    apiFunc: "EMCP_WB_Terrain",
    payload: {
      status: "ok",
      action: "getBounds",
      message: "Terrain bounds retrieved",
      boundsMin: "0 0 0",
      boundsMax: "4096 0 4096",
    },
    expect: [
      "World Bounds",
      "**Min (x y z):** 0 0 0",
      "**Max (x y z):** 4096 0 4096",
      "**Size X:** 4096",
    ],
  },
  {
    tool: "wb_layers",
    args: { action: "list", subScene: 0 },
    apiFunc: "EMCP_WB_Layers",
    payload: {
      status: "ok",
      message: "Found 2 layers across 7 entities",
      action: "list",
      currentSubScene: 0,
      layers: [
        { layerID: 0, entityCount: 5 },
        { layerID: 3, entityCount: 2 },
      ],
    },
    expect: ["Layer ID **0** (5 entities)", "Layer ID **3** (2 entities)"],
  },
  {
    tool: "wb_layers",
    args: { action: "getEntityLayer", subScene: 0, entityName: "Alpha" },
    apiFunc: "EMCP_WB_Layers",
    payload: { status: "ok", message: "Entity 'Alpha' is on layer 2", layerID: 2 },
    expect: ["**Layer ID:** 2"],
  },
  {
    tool: "wb_layers",
    args: { action: "getInfo", subScene: 0, layerID: 3 },
    apiFunc: "EMCP_WB_Layers",
    payload: {
      status: "ok",
      message: "Layer 3: 2 entities",
      layerID: 3,
      layerVisible: true,
      layerLocked: false,
      layerActive: false,
      layerEntityCount: 2,
    },
    expect: ["Layer 3", "**Visible:** true", "**Entities:** 2"],
  },
  {
    tool: "wb_resources",
    args: { action: "register", path: "Prefabs/x.et" },
    apiFunc: "EMCP_WB_Resources",
    payload: { status: "ok", action: "register", message: "Registered", path: "Prefabs/x.et" },
    expect: ["Registered resource: Prefabs/x.et", "Registered"],
  },
  {
    tool: "wb_prefabs",
    args: { action: "getAncestor", entityName: "Alpha" },
    apiFunc: "EMCP_WB_Prefabs",
    payload: {
      status: "ok",
      message: "ok",
      entityName: "Alpha",
      ancestorPath: "{0123456789ABCDEF}Prefabs/x.et",
    },
    expect: ["Ancestor Prefab", "{0123456789ABCDEF}Prefabs/x.et"],
  },
  {
    tool: "wb_prefabs",
    args: { action: "createTemplate", entityName: "Alpha", templatePath: "Prefabs/A.et" },
    apiFunc: "EMCP_WB_Prefabs",
    payload: { status: "ok", message: "Template created", entityName: "Alpha" },
    expect: ["Template Created", "Alpha", "Prefabs/A.et", "Template created"],
  },
  {
    tool: "wb_clipboard",
    args: { action: "copy" },
    apiFunc: "EMCP_WB_Clipboard",
    payload: { status: "ok", action: "copy", result: true, message: "Selected entities copied" },
    expect: ["Copied to clipboard", "Selected entities copied"],
  },
  {
    tool: "wb_script_editor",
    args: { action: "getLinesCount" },
    apiFunc: "EMCP_WB_ScriptEditor",
    payload: { status: "ok", message: "ok", linesCount: 77 },
    expect: ["**Line Count:** 77"],
  },
  {
    tool: "wb_script_editor",
    args: { action: "getLine", line: 3 },
    apiFunc: "EMCP_WB_ScriptEditor",
    payload: { status: "ok", message: "ok", currentLine: 3, lineText: "int x = 1;" },
    expect: ["Line 3", "int x = 1;"],
  },
  {
    tool: "wb_script_editor",
    args: { action: "getCurrentFile" },
    apiFunc: "EMCP_WB_ScriptEditor",
    payload: { status: "ok", message: "ok", currentFile: "Scripts/Game/A.c" },
    expect: ["Scripts/Game/A.c"],
  },
  {
    tool: "wb_localization",
    args: { action: "getTable" },
    apiFunc: "EMCP_WB_Localization",
    payload: {
      status: "ok",
      message: "ok",
      tableItemCount: 1,
      entries: [{ id: "KEY_HELLO", en_us: "Hello", target: "Bonjour", comment: "greeting" }],
    },
    expect: ["Localization Table", "KEY_HELLO", "Hello", "Bonjour", "greeting"],
  },
  {
    tool: "wb_localization",
    args: { action: "listLanguages" },
    apiFunc: "EMCP_WB_Localization",
    payload: { status: "ok", message: "ok", languages: ["en_us", "fr_fr"] },
    expect: ["Language Columns", "fr_fr"],
  },
  {
    tool: "wb_localization",
    args: { action: "insert", itemId: "KEY_NEW", value: "x" },
    apiFunc: "EMCP_WB_Localization",
    payload: { status: "ok", message: "Inserted", itemId: "KEY_NEW" },
    expect: ["Inserted localization entry: **KEY_NEW**"],
  },
  {
    tool: "wb_projects",
    args: { action: "open", name: "C:/mods/My/My.gproj" },
    apiFunc: "EMCP_WB_EditorControl",
    payload: {
      status: "ok",
      action: "openResource",
      message: "Opened resource: C:/mods/My/My.gproj",
    },
    expect: ["Project Opened", "My.gproj"],
  },
];

describe("wb_* contract: inventory-only payloads render the emitted values", () => {
  for (const row of ROWS) {
    it(`${row.tool} ${JSON.stringify(row.args)}`, async () => {
      const { result, calls, text } = await run(
        row.tool,
        row.args,
        row.payload,
        row.mode ?? "edit",
      );
      expect(result.isError, text).not.toBe(true);
      expect(
        calls.some((c) => c.apiFunc === row.apiFunc),
        `expected call to ${row.apiFunc}`,
      ).toBe(true);
      for (const frag of row.expect) {
        expect(text).toContain(frag);
      }
    });
  }
});

describe("wb_* contract: status:error payloads set isError with the handler message", () => {
  const seen = new Set<string>();
  for (const row of ROWS) {
    const key = `${row.tool}:${row.args.action ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    it(`${row.tool} ${row.args.action ?? ""}`, async () => {
      const { result, text } = await run(
        row.tool,
        row.args,
        { status: "error", message: "boom" },
        row.mode ?? "edit",
      );
      expect(result.isError, text).toBe(true);
      expect(text).toContain("boom");
    });
  }
});

describe("wb_* contract: mode-gate refusals set isError", () => {
  const gated: [string, Record<string, unknown>, "play" | "unknown"][] = [
    ["wb_play", {}, "play"],
    ["wb_stop", {}, "unknown"],
    ["wb_save", {}, "play"],
    ["wb_entity_create", { prefab: "x" }, "play"],
    ["wb_entity_delete", { name: "x" }, "play"],
    ["wb_entity_modify", { name: "x", action: "move", value: "1 1 1", memberIndex: -1 }, "play"],
    ["wb_component", { entityName: "x", action: "add", componentClass: "RigidBody" }, "play"],
    ["wb_clipboard", { action: "paste" }, "play"],
    ["wb_execute_action", { menuPath: "Tools,Reload Scripts" }, "play"],
    ["wb_layers", { action: "toggleLock", subScene: 0, layerID: 0 }, "play"],
    ["wb_localization", { action: "insert", itemId: "k" }, "play"],
    ["wb_prefabs", { action: "save", entityName: "x" }, "play"],
    ["wb_resources", { action: "register", path: "x" }, "play"],
    ["wb_script_editor", { action: "setLine", line: 1, text: "x" }, "play"],
  ];
  for (const [tool, args, mode] of gated) {
    it(`${tool} in ${mode} mode`, async () => {
      const { result, calls, text } = await run(tool, args, { status: "ok" }, mode);
      expect(result.isError, text).toBe(true);
      expect(text).toMatch(/Cannot /);
      expect(calls.length).toBe(0);
    });
  }
});

describe("wb_* contract: specific drift fixes", () => {
  it("isHandlerError treats result:false as failure unless told otherwise", () => {
    expect(isHandlerError({ status: "ok", result: false })).toBe(true);
    expect(isHandlerError({ status: "ok", result: false }, { ignoreResultFlag: true })).toBe(false);
    expect(isHandlerError({ status: "ok", result: true })).toBe(false);
    expect(isHandlerError({ status: "not_implemented", message: "x" })).toBe(true);
    expect(isHandlerError({ status: "error" })).toBe(true);
    expect(isHandlerError(null)).toBe(false);
  });

  it("wb_clipboard copy with result:false is an error; hasCopied result:false is not", async () => {
    const copy = await run(
      "wb_clipboard",
      { action: "copy" },
      {
        status: "ok",
        result: false,
        message: "CopySelectedEntities returned false (nothing selected?)",
      },
    );
    expect(copy.result.isError).toBe(true);
    expect(copy.text).toContain("nothing selected");

    const has = await run(
      "wb_clipboard",
      { action: "hasCopied" },
      { status: "ok", result: false, message: "Clipboard is empty" },
    );
    expect(has.result.isError).not.toBe(true);
    expect(has.text).toContain("Empty");
  });

  it("wb_execute_action: result:false → isError; padded blocked path is still blocked; path is normalized", async () => {
    const failed = await run(
      "wb_execute_action",
      { menuPath: "Edit,Nope" },
      { status: "ok", result: false, message: "ExecuteAction returned false" },
    );
    expect(failed.result.isError).toBe(true);

    const blocked = await run(
      "wb_execute_action",
      { menuPath: " File , Close " },
      { status: "ok" },
    );
    expect(blocked.result.isError).toBe(true);
    expect(blocked.text).toContain("Blocked");
    expect(blocked.calls.length).toBe(0);

    const ok = await run(
      "wb_execute_action",
      { menuPath: " Edit , Select All " },
      { status: "ok", message: "Action executed successfully" },
    );
    expect(ok.calls[0]?.params.menuPath).toBe("Edit,Select All");
  });

  it("wb_prefabs createTemplate forwards addonName when given", async () => {
    const { calls } = await run(
      "wb_prefabs",
      {
        action: "createTemplate",
        entityName: "A",
        templatePath: "Prefabs/A.et",
        addonName: "MyMod",
      },
      { status: "ok", message: "Template created", entityName: "A" },
    );
    expect(calls[0]?.params.addonName).toBe("MyMod");
    expect(calls[0]?.params.templatePath).toBe("Prefabs/A.et");
  });

  it("wb_entity_create sends layerID (numeric), never layerPath", async () => {
    const { calls } = await run(
      "wb_entity_create",
      { prefab: "x", layerID: 4 },
      { status: "ok", entityName: "e", entityClass: "c", position: "0 0 0" },
    );
    expect(calls[0]?.params.layerID).toBe(4);
    expect(calls[0]?.params).not.toHaveProperty("layerPath");
  });

  it("wb_entity_select getSelected with nothing selected is not an error", async () => {
    const { result, text } = await run(
      "wb_entity_select",
      { action: "getSelected" },
      { status: "ok", selectedCount: 0 },
    );
    expect(result.isError).not.toBe(true);
    expect(text).toContain("No entities selected");
  });

  it("wb_terrain getHeight never prints a default height when the key is missing", async () => {
    const { result, text } = await run(
      "wb_terrain",
      { action: "getHeight", x: 1, z: 2 },
      { status: "ok", message: "weird" },
    );
    expect(result.isError).toBe(true);
    expect(text).not.toMatch(/Height \(Y\):\*\* 0/);
  });

  it("wb_layers sends the layer ID through the handler's layerPath field", async () => {
    const { calls } = await run(
      "wb_layers",
      { action: "isVisible", subScene: 0, layerID: 7 },
      { status: "ok", layerID: 7, layerVisible: true, layerLocked: false },
    );
    expect(calls[0]?.params.layerPath).toBe("7");
  });

  it("wb_save saveAs: handler ok without confirming the new path → isError, no 'Saved as'", async () => {
    const { result, text } = await run(
      "wb_save",
      { path: "worlds/New.ent" },
      { status: "ok", action: "saveAs", message: "SaveAs not available, used Save instead" },
    );
    expect(result.isError).toBe(true);
    expect(text).not.toContain("Saved as:");
    expect(text).toContain("NOT performed");
  });

  it("wb_save saveAs: handler confirms the path → success", async () => {
    const { result, text } = await run(
      "wb_save",
      { path: "worlds/New.ent" },
      { status: "ok", action: "saveAs", message: "Saved as worlds/New.ent" },
    );
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Saved as: worlds/New.ent");
  });

  it("wb_open_resource: ok status with 'returned false' message → isError (defensive)", async () => {
    const { result, text } = await run(
      "wb_open_resource",
      { path: "worlds/X.ent" },
      { status: "ok", message: "SetOpenedResource returned false for: worlds/X.ent" },
    );
    expect(result.isError).toBe(true);
    expect(text).toContain("NOT opened");
  });

  it("wb_projects list: unknown shape is dumped, never 'No projects loaded'", async () => {
    const { result, text } = await run(
      "wb_projects",
      { action: "list" },
      { status: "ok", someKey: "someValue" },
    );
    expect(result.isError).not.toBe(true);
    expect(text).not.toContain("No projects loaded");
    expect(text).toContain("someValue");
  });

  it("wb_projects list: projects[] renders names", async () => {
    const { text } = await run(
      "wb_projects",
      { action: "list" },
      { status: "ok", projects: [{ name: "MyMod", path: "C:/mods/MyMod" }, "OtherMod"] },
    );
    expect(text).toContain("MyMod");
    expect(text).toContain("OtherMod");
  });

  it("wb_launch: openResource failure reports the world did NOT open and sets isError", async () => {
    const { result, text } = await run(
      "wb_launch",
      { world: "worlds/Missing.ent" },
      { status: "error", message: "SetOpenedResource failed" },
    );
    expect(result.isError).toBe(true);
    expect(text).toContain("World NOT opened");
    expect(text).toContain("SetOpenedResource failed");
  });

  it("wb_launch: world opens → no error", async () => {
    const { result, text } = await run(
      "wb_launch",
      { world: "worlds/Ok.ent" },
      { status: "ok", message: "Opened resource: worlds/Ok.ent" },
    );
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Opening world **worlds/Ok.ent**");
  });
});

// ---------------------------------------------------------------------------
// H1: wb_entity_duplicate — position comes from getWorldTransform / message,
// and the original is never deleted unless the copy is verified in place.
// ---------------------------------------------------------------------------

describe("wb_entity_duplicate (H1)", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "wb-dup-"));
    const gamePath = join(root, "game");
    const projectPath = join(root, "project");
    mkdirSync(join(gamePath, "addons", "data", "Prefabs"), { recursive: true });
    writeFileSync(join(gamePath, "addons", "data", "Prefabs", "Src.et"), "GenericEntity {}");
    mkdirSync(join(projectPath, "MyMod"), { recursive: true });
    writeFileSync(join(projectPath, "MyMod", "MyMod.gproj"), "GameProject {}");
    const config = { ...dummyConfig, gamePath, projectPath } as Config;
    return { root, config };
  }

  type Script = {
    transform?: Payload;
    getProperty?: Payload;
    create?: Payload;
    del?: Payload;
  };

  async function runDup(script: Script) {
    const fx = fixture();
    try {
      const { server, tools } = fakeServer();
      const { client, calls } = fakeClient("edit", (apiFunc, params) => {
        if (apiFunc === "EMCP_WB_Prefabs")
          return {
            status: "ok",
            entityName: "Orig",
            ancestorPath: "{0123456789ABCDEF}Prefabs/Src.et",
          };
        if (apiFunc === "EMCP_WB_Resources") return { status: "ok", message: "registered" };
        if (apiFunc === "EMCP_WB_ModifyEntity" && params.action === "getWorldTransform")
          return script.transform ?? { status: "error", message: "no transform" };
        if (apiFunc === "EMCP_WB_ModifyEntity" && params.action === "getProperty")
          return script.getProperty ?? { status: "error", message: "no property" };
        if (apiFunc === "EMCP_WB_CreateEntity")
          return script.create ?? { status: "error", message: "create not scripted" };
        if (apiFunc === "EMCP_WB_DeleteEntity")
          return script.del ?? { status: "ok", deletedName: "Orig", deletedClass: "X" };
        return { status: "error", message: `unexpected ${apiFunc}` };
      });
      registerWbEntityDuplicate(server, fx.config, client);
      const handler = tools.get("wb_entity_duplicate")!;
      const result = await handler(
        { entityName: "Orig", destPath: "Prefabs/Copy.et", modName: "MyMod", replaceInScene: true },
        {},
      );
      const created = calls.filter((c) => c.apiFunc === "EMCP_WB_CreateEntity");
      const deleted = calls.filter((c) => c.apiFunc === "EMCP_WB_DeleteEntity");
      const copyExists = existsSync(join(fx.config.projectPath, "MyMod", "Prefabs", "Copy.et"));
      return { result, text: text(result), created, deleted, copyExists };
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }

  it("uses getWorldTransform position+rotation, verifies placement, then deletes the original", async () => {
    const r = await runDup({
      transform: {
        status: "ok",
        properties: [
          { name: "position", type: "vector", value: "10 20 30" },
          { name: "rotation", type: "vector", value: "0 90 0" },
        ],
      },
      create: { status: "ok", entityName: "Orig_copy", entityClass: "X", position: "10 20 30" },
    });
    expect(r.result.isError).not.toBe(true);
    expect(r.created.length).toBe(1);
    expect(r.created[0]?.params.position).toBe("10 20 30");
    expect(r.created[0]?.params.rotation).toBe("0 90 0");
    expect(r.deleted.length).toBe(1);
    expect(r.text).toContain("Entity duplicated successfully");
    expect(r.text).toContain("at 10 20 30");
    expect(r.copyExists).toBe(true);
  });

  it("falls back to getProperty coords and reads the value from `message` (not `value`)", async () => {
    const r = await runDup({
      getProperty: { status: "ok", message: "5 6 7", entityName: "Orig" },
      create: { status: "ok", entityName: "Orig_copy", entityClass: "X", position: "5 6 7" },
    });
    expect(r.result.isError).not.toBe(true);
    expect(r.created[0]?.params.position).toBe("5 6 7");
    expect(r.deleted.length).toBe(1);
  });

  it("aborts before creating or deleting anything when the position cannot be read", async () => {
    const r = await runDup({});
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(0);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("NOT deleted");
    // the prefab file itself was still saved
    expect(r.copyExists).toBe(true);
  });

  it("never deletes the original when the copy landed somewhere else (e.g. origin)", async () => {
    const r = await runDup({
      transform: {
        status: "ok",
        properties: [{ name: "position", type: "vector", value: "10 20 30" }],
      },
      create: { status: "ok", entityName: "Orig_copy", entityClass: "X", position: "0 0 0" },
    });
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(1);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("original NOT deleted");
  });

  it("never deletes the original when CreateEntity reports a handler error", async () => {
    const r = await runDup({
      transform: {
        status: "ok",
        properties: [{ name: "position", type: "vector", value: "1 1 1" }],
      },
      create: { status: "error", message: "CreateEntity returned null" },
    });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("CreateEntity returned null");
  });
});
