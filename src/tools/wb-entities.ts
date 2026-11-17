import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { runAliasViaModule } from "./wb-editor.js";

/**
 * The six 1.x entity tools, kept as aliases (OD-1, DEC-061). Each keeps its 1.x input schema and
 * routes through src/manifest/aliases.ts into wb_entity, wb_view or wb_container, which answer in
 * their own JSON shape. A 1.x argument with no equivalent is refused with INVALID_ARGUMENT naming
 * the tool and action to use. Mode checks are the handlers' (WRONG_MODE). wb_entity_duplicate
 * (wb-entity-duplicate.ts) is a composite with no single action and stays on the 1.x handlers.
 * Descriptions are kept short: the aliases count toward the full tools/list budget (140k chars).
 */

/** Drops keys the caller left undefined so the alias mapper sees only real ones. */
function given(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

/** The element list of a 1.x listArrayItems message: "[0:ClassA, 1:ClassB] (2 items)". */
export function parseArrayItems(message: string): { index: number; className: string }[] {
  const m = /^\[(.*)\] \(\d+ items\)$/s.exec(message.trim());
  if (!m || m[1]!.trim() === "") return [];
  return m[1]!.split(", ").map((part) => {
    const at = part.indexOf(":");
    return { index: Number(part.slice(0, at)), className: part.slice(at + 1) };
  });
}

/**
 * 1.x wb_entity_modify listArrayItems. No wb_container action answers an array's elements (get
 * answers the count, describe walks the whole entity to a fixed depth and skips null elements), so
 * the call stays on its 1.x handler, EMCP_WB_ModifyEntity, with the 1.x keys.
 */
export async function runListArrayItems(client: WorkbenchClient, args: Record<string, unknown>) {
  const name = typeof args.name === "string" ? args.name : "";
  const target = `entity:name:${name}`;
  const fail = (code: string, message: string) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { ok: false, action: "listArrayItems", target, code, message, warnings: [] },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  });
  if (name === "") return fail("INVALID_ARGUMENT", "name is required (the 1.x entity name)");
  const params: Record<string, unknown> = { name, action: "listArrayItems" };
  if (typeof args.propertyPath === "string" && args.propertyPath !== "")
    params.propertyPath = args.propertyPath;
  if (typeof args.propertyKey === "string" && args.propertyKey !== "")
    params.propertyKey = args.propertyKey;
  let r: Record<string, unknown>;
  try {
    r = await client.call<Record<string, unknown>>("EMCP_WB_ModifyEntity", params);
  } catch (e) {
    return fail("UNREACHABLE", e instanceof Error ? e.message : String(e));
  }
  const message = typeof r.message === "string" ? r.message : "";
  if (r.status !== "ok") return fail("HANDLER_ERROR", message || "the handler answered an error");
  const items = parseArrayItems(message);
  const ok = {
    ok: true,
    action: "listArrayItems",
    target,
    changed: null,
    readback: { items, count: items.length, message },
    warnings: [
      "1.x listArrayItems answered by its 1.x handler (EMCP_WB_ModifyEntity): no wb_container action lists array elements",
    ],
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(ok, null, 2) }] };
}

export function registerWbEntityTools(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_entity_create",
    {
      description: "1.x alias of wb_entity create. layerID is refused: use layer there.",
      inputSchema: {
        prefab: z.string(),
        position: z.string().optional().describe("'x y z'"),
        rotation: z.string().optional().describe("'pitch yaw roll'"),
        name: z.string().optional(),
        layerID: z.number().int().optional(),
      },
    },
    async (args) => runAliasViaModule(client, "wb_entity_create", given(args)),
  );

  server.registerTool(
    "wb_entity_delete",
    {
      description: "1.x alias of wb_entity delete, by name.",
      inputSchema: {
        name: z.string(),
      },
    },
    async (args) => runAliasViaModule(client, "wb_entity_delete", given(args)),
  );

  server.registerTool(
    "wb_entity_list",
    {
      description: "1.x alias of wb_entity list. Only offset 0: page with its cursor.",
      inputSchema: {
        offset: z.number().default(0),
        limit: z.number().default(50),
        nameFilter: z.string().optional(),
      },
    },
    async (args) => runAliasViaModule(client, "wb_entity_list", given(args)),
  );

  server.registerTool(
    "wb_entity_inspect",
    {
      description: "1.x alias of wb_entity get, by name or index.",
      inputSchema: {
        name: z.string().optional(),
        index: z.number().optional(),
      },
    },
    async (args) => runAliasViaModule(client, "wb_entity_inspect", given(args)),
  );

  server.registerTool(
    "wb_entity_modify",
    {
      description:
        "1.x alias: move, rotate, rename, reparent, getWorldTransform -> wb_entity; makeVisible -> wb_view select; property actions -> wb_container on entity:name:<name>. listArrayItems: 1.x handler.",
      inputSchema: {
        name: z.string(),
        action: z.enum([
          "move",
          "rotate",
          "rename",
          "reparent",
          "setProperty",
          "clearProperty",
          "getProperty",
          "listProperties",
          "listArrayItems",
          "addArrayItem",
          "removeArrayItem",
          "setObjectClass",
          "getWorldTransform",
          "makeVisible",
        ]),
        value: z.string().optional(),
        propertyPath: z.string().optional().describe("component class or dotted path"),
        propertyKey: z.string().optional(),
        memberIndex: z.number().default(-1),
      },
    },
    async (args) =>
      args.action === "listArrayItems"
        ? runListArrayItems(client, given(args))
        : runAliasViaModule(client, "wb_entity_modify", given(args)),
  );

  server.registerTool(
    "wb_entity_select",
    {
      description: "1.x alias of wb_view select and selection.",
      inputSchema: {
        action: z.enum(["select", "deselect", "clear", "getSelected"]),
        name: z.string().optional(),
      },
    },
    async (args) => runAliasViaModule(client, "wb_entity_select", given(args)),
  );
}
