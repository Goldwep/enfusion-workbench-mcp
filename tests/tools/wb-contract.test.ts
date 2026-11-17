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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
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
import {
  registerWbEntityDuplicate,
  locateAncestorSource,
} from "../../src/tools/wb-entity-duplicate.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { loadConfig } from "../../src/config.js";
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
// H1 / live-tools-a-02: wb_entity_duplicate — the world transform and parent come from
// EMCP_WB_Entity get, the copy is read back the same way, and the original is never deleted
// unless the read-back copy is where the original is (top level).
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
    /** EMCP_WB_Entity get of the original (name:Orig). */
    orig?: Payload;
    /** EMCP_WB_Entity get of the copy (name:Orig_copy). */
    copy?: Payload;
    /** The 1.x getWorldTransform answer (the source's own coords: parent-local for a child). */
    transform?: Payload;
    create?: Payload;
    del?: Payload;
  };

  const top = (coords: string, angles = "0 0 0"): Payload => ({
    status: "ok",
    code: "",
    coords,
    angles,
    parentId: "",
    parentName: "",
  });

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
        if (apiFunc === "EMCP_WB_Resources")
          return {
            status: "ok",
            message: "registered Prefabs/Copy.et",
            registered: 1,
            dryRun: 0,
            resourceName: "{1111111111111111}Prefabs/Copy.et",
          };
        if (apiFunc === "EMCP_WB_Entity" && params.action === "get" && params.entity === "name:Orig")
          return script.orig ?? { status: "error", code: "NOT_FOUND", message: "no entity" };
        if (
          apiFunc === "EMCP_WB_Entity" &&
          params.action === "get" &&
          params.entity === "name:Orig_copy"
        )
          return script.copy ?? { status: "error", code: "NOT_FOUND", message: "no entity" };
        if (apiFunc === "EMCP_WB_ModifyEntity" && params.action === "getWorldTransform")
          return script.transform ?? { status: "error", message: "no transform" };
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
      const ancestor = calls.filter((c) => c.apiFunc === "EMCP_WB_Prefabs");
      const registered = calls.filter((c) => c.apiFunc === "EMCP_WB_Resources");
      const gets = calls.filter((c) => c.apiFunc === "EMCP_WB_Entity");
      return { result, text: text(result), created, deleted, copyExists, ancestor, registered, gets };
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }

  it("registers the copy through the W2 handler: project-relative path, confirm true", async () => {
    const r = await runDup({});
    expect(r.copyExists).toBe(true);
    expect(r.registered.map((c) => c.params)).toEqual([
      { action: "register", path: "Prefabs/Copy.et", buildRuntime: false, confirm: true },
    ]);
  });

  const createdOk = { status: "ok", entityName: "Orig_copy", entityClass: "X", position: "10 20 30" };

  it("places at the world transform, reads the copy back, then deletes the original", async () => {
    const r = await runDup({
      orig: top("10 20 30", "0 90 0"),
      copy: top("10 20 30", "0 90 0"),
      create: createdOk,
    });
    expect(r.result.isError).not.toBe(true);
    expect(r.created.length).toBe(1);
    expect(r.created[0]?.params.position).toBe("10 20 30");
    expect(r.created[0]?.params.rotation).toBe("0 90 0");
    expect(r.gets.map((c) => c.params.entity)).toEqual(["name:Orig", "name:Orig_copy"]);
    expect(r.deleted.length).toBe(1);
    expect(r.text).toContain("Entity duplicated successfully");
    expect(r.text).toContain("at 10 20 30");
    expect(r.copyExists).toBe(true);
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

  it("never deletes the original when the read-back copy is elsewhere, whatever create echoes", async () => {
    // The shipped CreateEntity echoed the request: an echo of the same position proves nothing.
    const r = await runDup({ orig: top("10 20 30"), copy: top("0 0 0"), create: createdOk });
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(1);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("original NOT deleted");
    expect(r.text).toContain("Read back: 0 0 0");
  });

  it("never deletes the original when the copy cannot be read back", async () => {
    const r = await runDup({ orig: top("10 20 30"), create: createdOk });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("original NOT deleted");
  });

  it("leaves the scene alone for a child entity (its own coords are parent-local)", async () => {
    // getWorldTransform answers the child's local coords and create echoed them: the 1.x check
    // passed and the original was deleted, the copy at the local offset from the world origin.
    const r = await runDup({
      orig: { ...top("101 2 3"), parentId: "id:0x00000000000000aa", parentName: "Building" },
      transform: {
        status: "ok",
        properties: [{ name: "position", type: "vector", value: "1 2 3" }],
      },
      create: { ...createdOk, position: "1 2 3" },
      copy: top("1 2 3"),
    });
    expect(r.result.isError).toBe(true);
    expect(r.created.length).toBe(0);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("is a child of Building");
    expect(r.copyExists).toBe(true);
  });

  it("never deletes the original when CreateEntity reports a handler error", async () => {
    const r = await runDup({
      orig: top("1 1 1"),
      create: { status: "error", message: "CreateEntity returned null" },
    });
    expect(r.result.isError).toBe(true);
    expect(r.deleted.length).toBe(0);
    expect(r.text).toContain("CreateEntity returned null");
  });

  it("asks the W1 Prefabs handler for the ancestor by entity reference, not entityName", async () => {
    const r = await runDup({});
    expect(r.ancestor[0]?.params).toEqual({ action: "getAncestor", entity: "name:Orig" });
  });
});

// ---------------------------------------------------------------------------
// wb_entity_duplicate on a paks-only install (1.9.0.37 ships no loose prefabs): the ancestor is
// read through the pak VFS, as game_duplicate reads it, and copied byte for byte.
// ---------------------------------------------------------------------------

describe("wb_entity_duplicate reads the ancestor through the pak VFS", () => {
  it("copies the pak bytes when the game has no loose file", async () => {
    const root = mkdtempSync(join(tmpdir(), "wb-dup-pak-"));
    const gamePath = join(root, "game");
    const projectPath = join(root, "project");
    mkdirSync(join(gamePath, "addons", "data"), { recursive: true });
    mkdirSync(join(projectPath, "MyMod"), { recursive: true });
    writeFileSync(join(projectPath, "MyMod", "MyMod.gproj"), "GameProject {}");
    // CRLF, a tab and a non-ASCII byte: a byte copy keeps every one.
    const bytes = Buffer.from('GenericEntity {\r\n\tID "é"\r\n}\r\n', "utf-8");
    const reads: string[] = [];
    const fakeVfs = {
      exists: (p: string) => p === "Prefabs/Packed.et",
      readFile: (p: string) => {
        reads.push(p);
        return bytes;
      },
    } as unknown as PakVirtualFS;
    const spy = vi.spyOn(PakVirtualFS, "get").mockImplementation((g) =>
      g === gamePath ? fakeVfs : null,
    );
    try {
      const config = { ...dummyConfig, gamePath, projectPath } as Config;
      expect(locateAncestorSource(config, "Prefabs/Missing.et")).toMatchObject({
        error: expect.stringContaining("the .pak archives under"),
      });
      const { server, tools } = fakeServer();
      const { client } = fakeClient("edit", (apiFunc) => {
        if (apiFunc === "EMCP_WB_Prefabs")
          return { status: "ok", ancestorPath: "{0123456789ABCDEF}Prefabs/Packed.et" };
        if (apiFunc === "EMCP_WB_Resources")
          return { status: "ok", message: "registered", registered: 1, dryRun: 0 };
        return { status: "error", message: `unexpected ${apiFunc}` };
      });
      registerWbEntityDuplicate(server, config, client);
      const result = await tools.get("wb_entity_duplicate")!(
        { entityName: "Orig", destPath: "Prefabs/Copy.et", modName: "MyMod", replaceInScene: false },
        {},
      );
      expect(result.isError).not.toBe(true);
      expect(text(result)).toContain("Prefab saved successfully");
      expect(reads).toEqual(["Prefabs/Packed.et"]);
      const written = readFileSync(join(projectPath, "MyMod", "Prefabs", "Copy.et"));
      expect(written.equals(bytes)).toBe(true);
    } finally {
      spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The installed game (skipped without one): a vanilla prefab no loose file holds is found.
  const installed = loadConfig().gamePath;
  const vfs = installed && existsSync(join(installed, "addons")) ? PakVirtualFS.get(installed) : null;
  const packed = vfs ? vfs.allFilePaths().filter((p) => p.endsWith(".et")).slice(0, 1) : [];
  it.skipIf(!vfs || packed.length === 0)("finds a vanilla .et in the installed paks", () => {
    const src = locateAncestorSource({ gamePath: installed! }, packed[0]!);
    expect("error" in src).toBe(false);
    if (!("error" in src)) {
      expect(src.read().equals(vfs!.readFile(packed[0]!))).toBe(true);
    }
  });
});
