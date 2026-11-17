import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { registerWbEditorTools } from "../../src/tools/wb-editor.js";
import { registerWbEntityTools } from "../../src/tools/wb-entities.js";

type Handler = (a: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

function setup(...answers: Array<Record<string, unknown>>) {
  const tools = new Map<string, Handler>();
  const sent: { api: string; params: Record<string, unknown> }[] = [];
  const server = {
    registerTool: (n: string, _m: unknown, h: Handler) => void tools.set(n, h),
  } as unknown as McpServer;
  const client = {
    state: { connected: true, mode: "edit", lastUpdated: Date.now() },
    async call(api: string, params: Record<string, unknown> = {}) {
      sent.push({ api, params });
      return answers.shift() ?? { status: "ok" };
    },
    async probe() {
      throw new Error("probe not expected");
    },
  } as unknown as WorkbenchClient;
  registerWbEditorTools(server, client);
  const run = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.get(name)!(args);
    return { r, body: JSON.parse(r.content[0].text) as Record<string, unknown> };
  };
  return { run, sent };
}

describe("1.x wb_save and wb_open_resource route into wb_module", () => {
  it("a bare wb_save sends EMCP_WB_Module save without confirm (dry run)", async () => {
    const { run, sent } = setup({ status: "ok", action: "save", message: "dry run" });
    await run("wb_save", {});
    expect(sent).toHaveLength(1);
    expect(sent[0].api).toBe("EMCP_WB_Module");
    expect(sent[0].params).toEqual({ action: "save", moduleName: "WorldEditor" });
  });

  it("wb_save with confirm: true sends confirm", async () => {
    const { run, sent } = setup({ status: "ok", action: "save" });
    await run("wb_save", { confirm: true });
    expect(sent[0].params).toEqual({ action: "save", moduleName: "WorldEditor", confirm: true });
  });

  it("wb_save with the old path parameter is INVALID_ARGUMENT and sends nothing", async () => {
    const { run, sent } = setup();
    const { r, body } = await run("wb_save", { path: "worlds/New.ent" });
    expect(r.isError).toBe(true);
    expect(body.code).toBe("INVALID_ARGUMENT");
    expect(sent).toHaveLength(0);
  });

  it("wb_open_resource maps path to setResource with the relative path", async () => {
    const { run, sent } = setup({ status: "ok", action: "setResource" });
    await run("wb_open_resource", { path: "Worlds\\Test.ent" });
    expect(sent[0].api).toBe("EMCP_WB_Module");
    expect(sent[0].params).toEqual({
      action: "setResource",
      moduleName: "WorldEditor",
      path: "Worlds/Test.ent",
    });
  });

  it("wb_open_resource refuses an absolute path with ABSOLUTE_PATH before anything is sent", async () => {
    const { run, sent } = setup();
    const { r, body } = await run("wb_open_resource", { path: "C:/x/a.ent" });
    expect(r.isError).toBe(true);
    expect(body.code).toBe("ABSOLUTE_PATH");
    expect(sent).toHaveLength(0);
  });
});

function setupEntityAliases(...answers: Array<Record<string, unknown>>) {
  const tools = new Map<string, Handler>();
  const sent: { api: string; params: Record<string, unknown> }[] = [];
  const server = {
    registerTool: (n: string, _m: unknown, h: Handler) => void tools.set(n, h),
  } as unknown as McpServer;
  const client = {
    state: { connected: true, mode: "edit", lastUpdated: Date.now() },
    async call(api: string, params: Record<string, unknown> = {}) {
      sent.push({ api, params });
      return answers.shift() ?? { status: "ok" };
    },
    async probe() {
      throw new Error("probe not expected");
    },
  } as unknown as WorkbenchClient;
  registerWbEntityTools(server, client);
  const run = async (name: string, args: Record<string, unknown>) => {
    const r = await tools.get(name)!(args);
    return { r, body: JSON.parse(r.content[0].text) as Record<string, unknown> };
  };
  return { run, sent, tools };
}

describe("1.x wb_entity_* tools route into the W1 handlers (OD-1)", () => {
  it("registers the six aliases and not wb_entity_duplicate", () => {
    const { tools } = setupEntityAliases();
    expect([...tools.keys()].sort()).toEqual([
      "wb_entity_create",
      "wb_entity_delete",
      "wb_entity_inspect",
      "wb_entity_list",
      "wb_entity_modify",
      "wb_entity_select",
    ]);
  });

  it("wb_entity_create sends EMCP_WB_Entity create, never the 1.x handler", async () => {
    const { run, sent } = setupEntityAliases();
    await run("wb_entity_create", { prefab: "GenericEntity", position: "1 2 3", name: "A" });
    expect(sent).toHaveLength(1);
    expect(sent[0].api).toBe("EMCP_WB_Entity");
    expect(sent[0].params).toMatchObject({
      action: "create",
      prefab: "GenericEntity",
      coords: "1 2 3",
      name: "A",
    });
  });

  it("wb_entity_create with layerID is INVALID_ARGUMENT and sends nothing", async () => {
    const { run, sent } = setupEntityAliases();
    const { r, body } = await run("wb_entity_create", { prefab: "P", layerID: 1 });
    expect(r.isError).toBe(true);
    expect(body.code).toBe("INVALID_ARGUMENT");
    expect(String(body.message)).toMatch(/wb_entity create/);
    expect(sent).toHaveLength(0);
  });

  it("wb_entity_delete sends one name reference", async () => {
    const { run, sent } = setupEntityAliases();
    await run("wb_entity_delete", { name: "Crate" });
    expect(sent[0].api).toBe("EMCP_WB_Entity");
    expect(sent[0].params).toMatchObject({ action: "delete", entities: ["name:Crate"] });
  });

  it("wb_entity_select select sends EMCP_WB_View select mode set", async () => {
    const { run, sent } = setupEntityAliases();
    await run("wb_entity_select", { action: "select", name: "Crate" });
    expect(sent[0].api).toBe("EMCP_WB_View");
    expect(sent[0].params).toMatchObject({
      action: "select",
      mode: "set",
      entities: ["name:Crate"],
    });
  });

  it("wb_entity_modify setProperty sends EMCP_WB_Container set on the entity target", async () => {
    const { run, sent } = setupEntityAliases();
    await run("wb_entity_modify", {
      name: "Crate",
      action: "setProperty",
      propertyPath: "MeshObject",
      propertyKey: "Object",
      value: "x",
      memberIndex: -1,
    });
    expect(sent[0].api).toBe("EMCP_WB_Container");
    expect(sent[0].params).toMatchObject({
      action: "set",
      path: "components[MeshObject].Object",
      value: "x",
    });
  });

  it("wb_entity_modify listArrayItems stays on its 1.x handler and answers the element list", async () => {
    const { run, sent } = setupEntityAliases({
      status: "ok",
      message: "[0:SCR_ActionA, 1:SCR_ActionB] (2 items)",
    });
    const { r, body } = await run("wb_entity_modify", {
      name: "Crate",
      action: "listArrayItems",
      propertyPath: "SCR_Trigger",
      propertyKey: "m_aActions",
      memberIndex: -1,
    });
    expect(r.isError).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].api).toBe("EMCP_WB_ModifyEntity");
    expect(sent[0].params).toEqual({
      name: "Crate",
      action: "listArrayItems",
      propertyPath: "SCR_Trigger",
      propertyKey: "m_aActions",
    });
    expect(body.ok).toBe(true);
    expect(body.readback).toMatchObject({
      count: 2,
      items: [
        { index: 0, className: "SCR_ActionA" },
        { index: 1, className: "SCR_ActionB" },
      ],
    });
  });

  it("wb_entity_modify listArrayItems: an empty array and a handler error", async () => {
    const empty = setupEntityAliases({
      status: "ok",
      message: "[] (empty or not an object array)",
    });
    const a = await empty.run("wb_entity_modify", {
      name: "Crate",
      action: "listArrayItems",
      propertyKey: "arr",
    });
    expect(a.body.readback).toMatchObject({ count: 0, items: [] });
    const bad = setupEntityAliases({ status: "error", message: "Component not found: X" });
    const b = await bad.run("wb_entity_modify", {
      name: "Crate",
      action: "listArrayItems",
      propertyPath: "X",
      propertyKey: "arr",
    });
    expect(b.r.isError).toBe(true);
    expect(b.body.code).toBe("HANDLER_ERROR");
    expect(String(b.body.message)).toMatch(/Component not found/);
  });
});
