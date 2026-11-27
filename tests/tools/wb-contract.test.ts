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
  const calls: { apiFunc: string; params: Record<string, unknown>; options?: unknown }[] = [];
  const client = {
    state: { connected: true, mode, lastUpdated: Date.now() } as { connected: boolean; mode: string; lastUpdated: number },
    noteMode(m: "edit" | "play") {
      client.state.mode = m;
    },
    lastLaunchNotes: [] as string[],
    inFlightLaunchTarget: null as string | null,
    ping: vi.fn(async () => true),
    // wb_launch classifies the Ping answer and checks the open project (live-client-02/-04).
    pingStatus: vi.fn(async () => ({ kind: "up" as const })),
    openProjectMatch: vi.fn(async () => ({ match: "loaded" as const, reported: "MyMod" })),
    assertProjectLoaded: vi.fn(async () => undefined),
    recoverHandlers: vi.fn(async () => undefined),
    // wb_connect reads native readiness through probe() (DEC-048 package B).
    probe: vi.fn(async (apiFunc: string, params: Record<string, unknown> = {}) => {
      if (apiFunc === "IsWorkbenchRunning") return { ScriptsCompiled: true };
      calls.push({ apiFunc, params });
      return callImpl(apiFunc, params);
    }),
    lastBuildCheck: null,
    queue: { inFlight: () => null, depth: 0 },
    ensureRunning: vi.fn(async () => undefined),
    cleanupHandlerScripts: vi.fn(() => false),
    call: vi.fn(async (apiFunc: string, params: Record<string, unknown> = {}, options?: unknown) => {
      calls.push({ apiFunc, params, options });
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
    tool: "wb_undo_redo",
    args: { action: "undo" },
    apiFunc: "EMCP_WB_EditorControl",
    payload: { status: "ok", action: "undo", message: "Undo executed" },
    expect: ["Undo Complete", "Undo executed"],
  },
  {
    // W8 OD-1 (DEC-076): an alias of wb_menu run; Window,Hierarchy is allow-listed and safe.
    tool: "wb_execute_action",
    args: { menuPath: "Window, Hierarchy" },
    apiFunc: "EMCP_WB_ExecuteAction",
    payload: {
      status: "ok",
      message: "Action executed successfully",
    },
    expect: ['"action": "run"', '"ran": true', '"path": "Window,Hierarchy"'],
  },
  // W1 (DEC-061): the six 1.x entity tools are aliases of wb_entity / wb_view (OD-1), and
  // wb_terrain, wb_layers and wb_prefabs answer the W1 JSON shape; payloads hold only the keys
  // the reworked handlers emit (contracts/EMCP_WB_*.json response lists).
  {
    tool: "wb_entity_create",
    args: { prefab: "{ABC}Prefabs/x.et", position: "100 0 200" },
    apiFunc: "EMCP_WB_Entity",
    payload: {
      status: "ok",
      action: "create",
      id: "0x00000000000000ab",
      name: "Soldier_7",
      className: "SCR_ChimeraCharacter",
      layer: "default",
      undoName: "Create entity",
    },
    expect: ['"ok": true', "Soldier_7", "SCR_ChimeraCharacter"],
  },
  {
    tool: "wb_entity_delete",
    args: { name: "Soldier_7" },
    apiFunc: "EMCP_WB_Entity",
    payload: {
      status: "ok",
      action: "delete",
      deleted: ["0x00000000000000ab"],
      missing: [],
      undoName: "Delete",
    },
    expect: ['"ok": true', "0x00000000000000ab"],
  },
  {
    tool: "wb_entity_list",
    args: { offset: 0, limit: 2 },
    apiFunc: "EMCP_WB_Entity",
    payload: {
      status: "ok",
      action: "list",
      rows: [
        "0x00000000000000a1|Alpha|GenericEntity||default|0|0",
        "0x00000000000000a2|Bravo|SCR_ChimeraCharacter||default|0|0",
      ],
      total: 120,
      nextCursor: "2:120",
    },
    expect: ["Alpha", "GenericEntity", "Bravo", "2:120"],
  },
  {
    tool: "wb_entity_inspect",
    args: { name: "Alpha" },
    apiFunc: "EMCP_WB_Entity",
    payload: {
      status: "ok",
      action: "get",
      id: "0x00000000000000a1",
      name: "Alpha",
      niceName: "Alpha",
      className: "GenericEntity",
      layer: "default",
      subScene: 0,
      coords: "1 2 3",
      angles: "0 90 0",
      visible: 1,
      selected: 0,
      childCount: 0,
      components: ["0|MeshObject"],
    },
    expect: ["entity:name:Alpha", "GenericEntity", "0 90 0", "MeshObject"],
  },
  {
    tool: "wb_entity_modify",
    args: { name: "Alpha", action: "getWorldTransform", memberIndex: -1 },
    apiFunc: "EMCP_WB_Entity",
    payload: {
      status: "ok",
      action: "get",
      id: "0x00000000000000a1",
      name: "Alpha",
      className: "GenericEntity",
      coords: "10 20 30",
      angles: "0 45 0",
      components: [],
    },
    expect: ['"coords": "10 20 30"', '"angles": "0 45 0"'],
  },
  {
    tool: "wb_entity_modify",
    args: { name: "Alpha", action: "move", value: "5 5 5", memberIndex: -1 },
    apiFunc: "EMCP_WB_Entity",
    payload: {
      status: "ok",
      action: "transform",
      before: "1 2 3||",
      after: "5 5 5||",
      undoName: "Transform",
    },
    expect: ['"ok": true', "5 5 5"],
  },
  {
    tool: "wb_entity_select",
    args: { action: "getSelected" },
    apiFunc: "EMCP_WB_View",
    payload: {
      status: "ok",
      action: "selection",
      rows: ["0x00000000000000a1|Alpha|GenericEntity||default|0|0"],
      mainId: "0x00000000000000a1",
      total: 1,
    },
    expect: ["Alpha", "GenericEntity"],
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
    payload: { status: "ok", action: "heights", rows: ["100|200|true|42.5"], sampleCount: 1 },
    expect: ['"height": 42.5', '"onTerrain": true', "sent as heights"],
  },
  {
    tool: "wb_terrain",
    args: { action: "getBounds" },
    apiFunc: "EMCP_WB_Terrain",
    payload: {
      status: "ok",
      action: "info",
      hasTerrain: 1,
      boundsMin: "0 0 0",
      boundsMax: "4096 0 4096",
    },
    expect: ['"min": "0 0 0"', '"max": "4096 0 4096"', '"sizeX": 4096'],
  },
  {
    tool: "wb_layers",
    args: { action: "list", subScene: 0 },
    apiFunc: "EMCP_WB_Layers",
    payload: {
      status: "ok",
      action: "list",
      currentSubScene: 0,
      rows: ["0|Default|true|false|5", "3|Roads|true|false|2"],
    },
    expect: ['"path": "Default"', '"path": "Roads"'],
  },
  {
    tool: "wb_layers",
    args: { action: "isVisible", subScene: 0, layerID: 3 },
    apiFunc: "EMCP_WB_Layers",
    payload: {
      status: "ok",
      action: "list",
      currentSubScene: 0,
      rows: ["0|Default|true|false|5", "3|Roads|true|false|2"],
    },
    expect: ['"layerID": 3', '"visible": true', "layer:Roads"],
  },
  {
    tool: "wb_layers",
    args: { action: "getInfo", subScene: 0, layerID: 3 },
    apiFunc: "EMCP_WB_Layers",
    payload: {
      status: "ok",
      action: "list",
      currentSubScene: 0,
      rows: ["0|Default|true|false|5", "3|Roads|true|false|2"],
    },
    expect: ['"layerID": 3', '"entityCount": 2'],
  },
  {
    tool: "wb_resources",
    // W2: register is a dry run unless confirm; the answer is the shared response shape.
    args: { action: "register", path: "Prefabs/x.et", confirm: true },
    apiFunc: "EMCP_WB_Resources",
    payload: {
      status: "ok",
      action: "register",
      message: "registered Prefabs/x.et",
      registered: 1,
      dryRun: 0,
      resourceName: "{0123456789ABCDEF}Prefabs/x.et",
      guid: "0123456789ABCDEF",
    },
    expect: ["{0123456789ABCDEF}Prefabs/x.et", '"ok": true'],
  },
  {
    tool: "wb_prefabs",
    args: { action: "getAncestor", entityName: "Alpha" },
    apiFunc: "EMCP_WB_Prefabs",
    payload: {
      status: "ok",
      action: "getAncestor",
      ancestorPath: "{0123456789ABCDEF}Prefabs/x.et",
    },
    expect: ["{0123456789ABCDEF}Prefabs/x.et", "1.x entityName mapped"],
  },
  {
    tool: "wb_prefabs",
    args: {
      action: "createTemplate",
      entityName: "Alpha",
      templatePath: "Prefabs/A.et",
      confirm: true,
    },
    apiFunc: "EMCP_WB_Prefabs",
    payload: {
      status: "ok",
      action: "createTemplate",
      dryRun: 0,
      savedPath: "Prefabs/A.et",
      resourceName: "{0123456789ABCDEF}Prefabs/A.et",
    },
    expect: ["Prefabs/A.et", "{0123456789ABCDEF}Prefabs/A.et", "1.x templatePath mapped"],
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
    // W3: the 1.x names map to state and getLines (DEC-061); the answer is the shared shape.
    args: { action: "getLinesCount" },
    apiFunc: "EMCP_WB_ScriptEditor",
    payload: { status: "ok", message: "ok", opened: 1, file: "Scripts/Game/A.c", linesCount: 77 },
    expect: ['"linesCount": 77', "getLinesCount"],
  },
  {
    tool: "wb_script_editor",
    args: { action: "getLine", line: 3 },
    apiFunc: "EMCP_WB_ScriptEditor",
    payload: { status: "ok", message: "ok", start: 2, total: 9, rows: ["int x = 1;"] },
    expect: ['"line": 3', "int x = 1;"],
  },
  {
    tool: "wb_script_editor",
    args: { action: "getCurrentFile" },
    apiFunc: "EMCP_WB_ScriptEditor",
    payload: { status: "ok", message: "ok", opened: 1, file: "Scripts/Game/A.c", linesCount: 5 },
    expect: ["Scripts/Game/A.c"],
  },
  {
    tool: "wb_localization",
    // W3 (KD-009): the 1.x names map to list, columns and insert over the Items array.
    args: { action: "getTable" },
    apiFunc: "EMCP_WB_Localization",
    payload: {
      status: "ok",
      message: "ok",
      columns: ["index", "Id", "Target_en_us", "Target_fr_fr"],
      rows: ["0|KEY_HELLO|Hello|Bonjour"],
      total: 1,
      nextCursor: "",
    },
    expect: ["KEY_HELLO", "Hello", "Bonjour", "getTable"],
  },
  {
    tool: "wb_localization",
    args: { action: "listLanguages" },
    apiFunc: "EMCP_WB_Localization",
    payload: {
      status: "ok",
      message: "ok",
      itemClass: "CustomStringTableItem",
      columns: ["Id|STRING|", "Target_en_us|STRING|", "Target_fr_fr|STRING|"],
    },
    expect: ['"languages"', "fr_fr"],
  },
  {
    tool: "wb_localization",
    args: { action: "insert", itemId: "KEY_NEW", value: "x" },
    apiFunc: "EMCP_WB_Localization",
    payload: {
      status: "ok",
      message: "inserted",
      id: "KEY_NEW",
      index: 0,
      total: 1,
      after: ["Id|KEY_NEW", "Target_en_us|x"],
    },
    expect: ["KEY_NEW"],
  },
  // wb_projects open sends nothing since live-tools-b-3 (tests/tools/wb-projects.test.ts).
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
    ["wb_component", { entityName: "x", action: "add", componentClass: "RigidBody" }, "play"],
    ["wb_clipboard", { action: "paste" }, "play"],
    ["wb_execute_action", { menuPath: "Window,Hierarchy" }, "play"],
    // wb_localization, wb_resources and wb_script_editor left this list in W2/W3: their handlers
    // guard the mode where it matters (prefabFromModel: WRONG_MODE), not the TS side.
  ];
  for (const [tool, args, mode] of gated) {
    it(`${tool} in ${mode} mode`, async () => {
      const { result, calls, text } = await run(tool, args, { status: "ok" }, mode);
      expect(result.isError, text).toBe(true);
      expect(text).toMatch(/Cannot /);
      expect(calls.length).toBe(0);
    });
  }

  // W1 (DEC-061): the mode check moved into the handlers. In play mode the call is sent and the
  // handler's WRONG_MODE refusal comes back as an error with its code and message.
  const handlerGated: [string, Record<string, unknown>, string][] = [
    ["wb_entity_create", { prefab: "x" }, "EMCP_WB_Entity"],
    ["wb_entity_delete", { name: "x" }, "EMCP_WB_Entity"],
    [
      "wb_entity_modify",
      { name: "x", action: "move", value: "1 1 1", memberIndex: -1 },
      "EMCP_WB_Entity",
    ],
    ["wb_layers", { action: "lock", layer: "Default" }, "EMCP_WB_Layers"],
    ["wb_prefabs", { action: "save", confirm: true }, "EMCP_WB_Prefabs"],
  ];
  for (const [tool, args, api] of handlerGated) {
    it(`${tool} in play mode: the handler's WRONG_MODE comes back as an error`, async () => {
      const { result, calls, text } = await run(
        tool,
        args,
        { status: "refused", code: "WRONG_MODE", message: "Cannot edit in play mode" },
        "play",
      );
      expect(result.isError, text).toBe(true);
      expect(text).toContain("WRONG_MODE");
      expect(calls.map((c) => c.apiFunc)).toEqual([api]);
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

  it("wb_execute_action: engine false → isError; blocked and unlisted paths send nothing; path is normalized", async () => {
    const failed = await run(
      "wb_execute_action",
      { menuPath: "Window,Hierarchy" },
      { status: "error", message: "ExecuteAction returned false" },
    );
    expect(failed.result.isError).toBe(true);
    expect(failed.text).toContain("ENGINE_FALSE");

    // W8 OD-1: the alias runs only what wb_menu run allows.
    const unlisted = await run("wb_execute_action", { menuPath: "Edit,Nope" }, { status: "ok" });
    expect(unlisted.result.isError).toBe(true);
    expect(unlisted.text).toContain("NOT_ALLOWLISTED");
    expect(unlisted.calls.length).toBe(0);

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
      { menuPath: " Window , Hierarchy " },
      { status: "ok", message: "Action executed successfully" },
    );
    expect(ok.calls[0]?.params.menuPath).toBe("Window,Hierarchy");

    // A mutating allow-listed item is a dry run unless confirm, as on wb_menu run.
    const dry = await run("wb_execute_action", { menuPath: "Edit,Undo" }, { status: "ok" });
    expect(dry.result.isError).not.toBe(true);
    expect(dry.text).toContain('"dryRun": true');
    expect(dry.calls.length).toBe(0);
  });

  it("wb_prefabs createTemplate refuses addonName (the open project is the target) and sends nothing", async () => {
    const { result, calls, text } = await run(
      "wb_prefabs",
      {
        action: "createTemplate",
        entityName: "A",
        templatePath: "Prefabs/A.et",
        addonName: "MyMod",
      },
      { status: "ok" },
    );
    expect(result.isError).toBe(true);
    expect(text).toContain("INVALID_ARGUMENT");
    expect(calls).toHaveLength(0);
  });

  it("wb_entity_create refuses layerID (wb_entity create takes a layer path) and sends nothing", async () => {
    const { result, calls, text } = await run(
      "wb_entity_create",
      { prefab: "x", layerID: 4 },
      { status: "ok" },
    );
    expect(result.isError).toBe(true);
    expect(text).toContain("INVALID_ARGUMENT");
    expect(text).toContain("wb_entity create");
    expect(calls).toHaveLength(0);
  });

  it("wb_entity_select getSelected with nothing selected is not an error", async () => {
    const { result, text } = await run(
      "wb_entity_select",
      { action: "getSelected" },
      { status: "ok", action: "selection", rows: [], mainId: "", total: 0 },
    );
    expect(result.isError).not.toBe(true);
    expect(text).toContain('"total": 0');
  });

  it("wb_terrain getHeight never prints a default height when the key is missing", async () => {
    const { text } = await run(
      "wb_terrain",
      { action: "getHeight", x: 1, z: 2 },
      { status: "ok", message: "weird" },
    );
    expect(text).not.toMatch(/"height": 0\b/);
  });

  it("wb_layers isVisible reads list and finds the row by layer ID (no layerPath field)", async () => {
    const { calls, text } = await run(
      "wb_layers",
      { action: "isVisible", subScene: 0, layerID: 7 },
      { status: "ok", action: "list", currentSubScene: 0, rows: ["7|Roads|true|false|2"] },
    );
    expect(calls[0]?.params).toEqual({ action: "list", subScene: 0 });
    expect(calls[0]?.params).not.toHaveProperty("layerPath");
    expect(text).toContain('"visible": true');
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

  it("wb_state sends GetState as a read (live-client-05)", async () => {
    const { calls } = await run("wb_state", {}, { status: "ok", mode: "edit" });
    expect(calls[0]?.apiFunc).toBe("EMCP_WB_GetState");
    expect(calls[0]?.options).toEqual({ access: "read" });
  });

  it("wb_play then wb_stop: the cached mode follows the switch (live-tools-a-07)", async () => {
    const { server, tools } = fakeServer();
    const { client, calls } = fakeClient("edit", (_f, p) => ({ status: "ok", action: p.action }));
    registerAll(server, client);
    const play = await tools.get("wb_play")!({}, {});
    expect(play.isError).not.toBe(true);
    expect(client.state.mode).toBe("play");
    const stop = await tools.get("wb_stop")!({}, {});
    expect(stop.isError).not.toBe(true);
    expect(text(stop)).toContain("Edit Mode Restored");
    expect(calls.map((c) => c.params.action)).toEqual(["play", "stop"]);
    expect(client.state.mode).toBe("edit");
  });
});

// ---------------------------------------------------------------------------
// wb_entity_duplicate (open-findings lta-05 and lta-08, Option 1 each): the engine writes the
// placed entity through EMCP_WB_Prefabs createTemplate (any ancestor, overrides kept), the copy is
// created through EMCP_WB_Entity create on the original's layer, read back by its id, and only
// then is the original deleted and the copy renamed to the original's name. A child is refused.
// ---------------------------------------------------------------------------

describe("wb_entity_duplicate (createTemplate, W1 create on the original's layer)", () => {
  const LAYER = "default";
  const COPY_ID = "id:0x00000000000000c1";
  const REL = "Prefabs/Copy.et";

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "wb-dup-"));
    const projectPath = join(root, "project");
    mkdirSync(join(projectPath, "MyMod"), { recursive: true });
    writeFileSync(join(projectPath, "MyMod", "MyMod.gproj"), "GameProject {}");
    // No game data at all: createTemplate needs none (lta-08: project and dependency prefabs).
    const config = { ...dummyConfig, gamePath: join(root, "no-game"), projectPath } as Config;
    return { root, config, dest: join(projectPath, "MyMod", "Prefabs", "Copy.et") };
  }

  type Script = {
    /** EMCP_WB_Prefabs createTemplate answer; default ok with a resource name. */
    tpl?: Payload;
    /** false: the handler answers ok but writes no file. */
    writes?: boolean;
    /** EMCP_WB_Entity get of the original (name:Orig). */
    orig?: Payload;
    /** EMCP_WB_Entity get of the copy (its id, or name:Orig_copy). */
    copy?: Payload;
    create?: Payload;
    del?: Payload;
    /** get of name:Orig after a failed delete. */
    origAfterDelete?: Payload;
    rename?: Payload;
    register?: Payload;
    /** get of name:Orig_copy BEFORE the create: an entity left by an earlier run. Default none. */
    stale?: Payload;
    /** What Workbench says of the addon's .gproj (default loaded). */
    project?: "loaded" | "other" | "unknown";
  };

  const top = (coords: string, angles = "0 0 0", layer = LAYER): Payload => ({
    status: "ok",
    code: "",
    coords,
    angles,
    parentId: "",
    parentName: "",
    layer,
    subScene: 0,
  });

  const createdOk: Payload = {
    status: "ok",
    code: "",
    action: "create",
    id: COPY_ID,
    name: "Orig_copy",
    className: "X",
    parentId: "",
    layer: LAYER,
  };

  async function runDup(script: Script, args: Record<string, unknown> = {}) {
    const fx = fixture();
    try {
      const { server, tools } = fakeServer();
      let deleted = false;
      let createSent = false;
      const { client, calls } = fakeClient("edit", (apiFunc, params) => {
        if (apiFunc === "EMCP_WB_Prefabs" && params.action === "createTemplate") {
          const answer = script.tpl ?? {
            status: "ok",
            code: "",
            action: "createTemplate",
            dryRun: false,
            savedPath: REL,
            resourceName: `{2222222222222222}${REL}`,
            undoName: "EMCP createTemplate",
            message: "prefab written",
          };
          if (answer.status === "ok" && script.writes !== false) writeFileSync(fx.dest, "GenericEntity {}");
          return answer;
        }
        if (apiFunc === "EMCP_WB_Resources")
          return (
            script.register ?? {
              status: "ok",
              message: "registered",
              registered: 1,
              dryRun: 0,
              resourceName: `{1111111111111111}${REL}`,
            }
          );
        if (apiFunc === "EMCP_WB_Entity" && params.action === "get") {
          if (params.entity === "name:Orig")
            return deleted
              ? (script.origAfterDelete ?? { status: "error", code: "ENTITY_NOT_FOUND", message: "none" })
              : (script.orig ?? { status: "error", code: "ENTITY_NOT_FOUND", message: "no entity" });
          if (params.entity === COPY_ID || params.entity === "name:Orig_copy")
            return (
              (createSent ? script.copy : script.stale) ?? {
                status: "error",
                code: "ENTITY_NOT_FOUND",
                message: "no entity",
              }
            );
        }
        if (apiFunc === "EMCP_WB_Entity" && params.action === "create") {
          createSent = true;
          return script.create ?? { status: "error", code: "ENGINE_FALSE", message: "create not scripted" };
        }
        if (apiFunc === "EMCP_WB_Entity" && params.action === "delete") {
          deleted = true;
          return script.del ?? { status: "ok", code: "", deleted: ["id:0x00000000000000a1"], missing: [] };
        }
        if (apiFunc === "EMCP_WB_Entity" && params.action === "rename")
          return script.rename ?? { status: "ok", code: "", id: COPY_ID, before: "Orig_copy", after: "Orig" };
        return { status: "error", message: `unexpected ${apiFunc} ${String(params.action)}` };
      });
      if (script.project) {
        const match = script.project;
        client.openProjectMatch = vi.fn(async () => ({ match, reported: "OtherMod" }));
      }
      registerWbEntityDuplicate(server, fx.config, client);
      const handler = tools.get("wb_entity_duplicate")!;
      const result = await handler(
        { entityName: "Orig", destPath: REL, modName: "MyMod", replaceInScene: true, ...args },
        {},
      );
      const of = (api: string, action?: string) =>
        calls.filter((c) => c.apiFunc === api && (action === undefined || c.params.action === action));
      return {
        result,
        text: text(result),
        calls,
        templates: of("EMCP_WB_Prefabs", "createTemplate"),
        created: of("EMCP_WB_Entity", "create"),
        deleted: of("EMCP_WB_Entity", "delete"),
        renamed: of("EMCP_WB_Entity", "rename"),
        gets: of("EMCP_WB_Entity", "get"),
        registered: of("EMCP_WB_Resources"),
        legacy: calls.filter((c) => /^EMCP_WB_(CreateEntity|DeleteEntity|ModifyEntity)$/.test(c.apiFunc)),
        fileExists: existsSync(fx.dest),
      };
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }

  it("refuses before createTemplate when Workbench has not loaded the addon modName names", async () => {
    const r = await runDup({ project: "other" });
    expect(r.result.isError).toBe(true);
    expect(r.text).toContain("is not a project Workbench has loaded (loaded: OtherMod)");
    expect(r.templates).toHaveLength(0);
    expect(r.created).toHaveLength(0);
    expect(r.fileExists).toBe(false);
  });

  it("places no copy when an entity already holds the temporary name", async () => {
    const r = await runDup({ orig: top("1 2 3"), stale: top("9 9 9"), create: createdOk, copy: top("1 2 3") });
    expect(r.result.isError).toBe(true);
    expect(r.text).toContain('An entity named "Orig_copy" already stands in the world');
    expect(r.created).toHaveLength(0);
    expect(r.deleted).toHaveLength(0);
    expect(r.renamed).toHaveLength(0);
  });

  it("saves through createTemplate with confirm, by entity reference, with no game data needed (lta-08)", async () => {
    const r = await runDup({}, { replaceInScene: false });
    expect(r.result.isError).not.toBe(true);
    expect(r.templates.map((c) => c.params)).toEqual([
      { action: "createTemplate", entity: "name:Orig", path: REL, confirm: true },
    ]);
    expect(r.templates[0]?.options).toMatchObject({ access: "mutate" });
    expect(r.text).toContain("Prefab saved successfully");
    expect(r.text).toContain("GUID: 2222222222222222");
    expect(r.text).toContain("Unverified");
    // The engine wrote the .meta (resourceName): no W2 registration, no world edit.
    expect(r.registered).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.deleted).toEqual([]);
    expect(r.legacy).toEqual([]);
  });

  it("registers through the W2 handler only when createTemplate gave no resource name and left no .meta", async () => {
    const r = await runDup(
      { tpl: { status: "ok", code: "", dryRun: false, savedPath: REL, resourceName: "", message: "prefab written" } },
      { replaceInScene: false },
    );
    expect(r.registered.map((c) => c.params)).toEqual([
      { action: "register", path: REL, buildRuntime: false, confirm: true },
    ]);
    expect(r.text).toContain("GUID: 1111111111111111");
  });

  it("a createTemplate refusal writes nothing and touches no entity", async () => {
    const r = await runDup({
      tpl: { status: "refused", code: "NOT_IN_PROJECT", message: "NewTargetInProject: outside", next: "pass a path inside the project" },
      orig: top("1 1 1"),
    });
    expect(r.result.isError).toBe(true);
    expect(r.text).toContain("Prefab not saved");
    expect(r.text).toContain("NOT_IN_PROJECT");
    expect(r.created).toEqual([]);
    expect(r.deleted).toEqual([]);
  });

  it("an ok answer with no file on disk fails the read-back", async () => {
    const r = await runDup({ writes: false, orig: top("1 1 1") });
    expect(r.result.isError).toBe(true);
    expect(r.text).toContain("the file is not on disk");
    expect(r.created).toEqual([]);
  });

  it("creates on the original's layer, reads the copy back by id, deletes, then renames to the original's name (lta-05)", async () => {
    const r = await runDup({
      orig: top("10 20 30", "0 90 0", "Layers/Props"),
      copy: top("10 20 30", "0 90 0", "Layers/Props"),
      create: { ...createdOk, layer: "Layers/Props" },
    });
    expect(r.result.isError, r.text).not.toBe(true);
    expect(r.created.map((c) => c.params)).toEqual([
      {
        action: "create",
        prefab: `{2222222222222222}${REL}`,
        name: "Orig_copy",
        coords: "10 20 30",
        angles: "0 90 0",
        layer: "Layers/Props",
      },
    ]);
    expect(r.gets.map((c) => c.params.entity)).toEqual(["name:Orig", "name:Orig_copy", COPY_ID]);
    expect(r.deleted.map((c) => c.params)).toEqual([{ action: "delete", entities: ["name:Orig"] }]);
    expect(r.renamed.map((c) => c.params)).toEqual([{ action: "rename", entity: COPY_ID, name: "Orig" }]);
    // Order: create, read-back, delete, rename.
    const order = r.calls
      .filter((c) => c.apiFunc === "EMCP_WB_Entity")
      .map((c) => `${String(c.params.action)}`);
    expect(order).toEqual(["get", "get", "create", "get", "delete", "rename"]);
    expect(r.text).toContain("Entity duplicated successfully");
    expect(r.text).toContain('on layer "Layers/Props"');
    expect(r.legacy).toEqual([]);
  });

  it("aborts before creating or deleting anything when the position cannot be read", async () => {
    const r = await runDup({});
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(0);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("NOT deleted");
    expect(r.fileExists).toBe(true);
  });

  it("never deletes the original when the read-back copy is elsewhere", async () => {
    const r = await runDup({ orig: top("10 20 30"), copy: top("0 0 0"), create: createdOk });
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(1);
    expect(r.deleted.length).toBe(0);
    expect(r.renamed.length).toBe(0);
    expect(r.text).toContain("original NOT deleted");
    expect(r.text).toContain("the copy is at 0 0 0");
    expect(r.text).toContain(`New entity placed as: Orig_copy (${COPY_ID})`);
  });

  it("never deletes the original when the copy reads back on another layer", async () => {
    const r = await runDup({
      orig: top("10 20 30", "0 0 0", "Layers/Props"),
      copy: top("10 20 30", "0 0 0", "default"),
      create: createdOk,
    });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain('the copy is on layer "default"');
  });

  it("never deletes the original when the copy cannot be read back", async () => {
    const r = await runDup({ orig: top("10 20 30"), create: createdOk });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("original NOT deleted");
  });

  it("leaves the scene alone for a child entity", async () => {
    const r = await runDup({
      orig: { ...top("101 2 3"), parentId: "id:0x00000000000000aa", parentName: "Building" },
      create: createdOk,
      copy: top("101 2 3"),
    });
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(0);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("is a child of Building");
    expect(r.fileExists).toBe(true);
  });

  it("never deletes the original when create answers an error with nothing created", async () => {
    const r = await runDup({
      orig: top("1 1 1"),
      create: { status: "error", code: "ENGINE_FALSE", message: "the create call returned null; nothing was created" },
    });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("Prefab saved but placement failed");
    expect(r.text).toContain("the create call returned null");
  });

  it("a create error after the entity stands names the copy and never advises placing again (lta-04)", async () => {
    const r = await runDup({
      orig: top("1 1 1"),
      create: {
        status: "error",
        code: "ENGINE_FALSE",
        message: "created, but RenameEntity to 'Orig_copy' returned false (name in use?)",
        id: "id:0x0000000000000042",
        name: "Entity_42",
      },
    });
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(1);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("Copy placed, but not under the requested name");
    expect(r.text).toContain("New entity placed as: Entity_42 (id:0x0000000000000042)");
    expect(r.text).not.toContain("Place manually using");
  });

  it("a failed delete reads the original back and says both stand; nothing is renamed", async () => {
    const r = await runDup({
      orig: top("1 1 1"),
      copy: top("1 1 1"),
      create: createdOk,
      del: { status: "error", code: "ENGINE_FALSE", message: "the delete call returned false" },
      origAfterDelete: top("1 1 1"),
    });
    expect(r.result.isError).toBe(true);
    expect(r.renamed.length).toBe(0);
    expect(r.text).toContain("both stand");
    expect(r.text).toContain(`New entity placed as: Orig_copy (${COPY_ID})`);
  });

  it("a failed rename after the delete says the original is gone and the copy keeps its temporary name", async () => {
    const r = await runDup({
      orig: top("1 1 1"),
      copy: top("1 1 1"),
      create: createdOk,
      rename: { status: "error", code: "ENGINE_FALSE", message: "RenameEntity returned false (name in use?)" },
    });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(1);
    expect(r.text).toContain("copy keeps its temporary name");
    expect(r.text).toContain('Original "Orig": deleted');
    expect(r.text).not.toContain("successfully");
  });
});
