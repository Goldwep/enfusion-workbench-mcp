import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { routeAlias } from "../manifest/aliases.js";
import { VocabularyError, errorResponse } from "../manifest/vocabulary.js";
import { runModule, toToolResult, type ModuleArgs } from "./wb-module.js";
import { runEntity } from "./wb-entity.js";
import { runView } from "./wb-view.js";
import { runContainer } from "./wb-container.js";
import { formatConnectionStatus, requireEditMode, requirePlayMode } from "../workbench/status.js";
import {
  isHandlerError,
  handlerErrorResponse,
  handlerErrorMessage,
  modeGateResponse,
} from "../workbench/response.js";

/**
 * EditorControl `openResource` historically returned `status: "ok"` even when
 * `SetOpenedResource` returned false, with the failure only visible in the
 * message text. The handler is being corrected to return an explicit error;
 * this stays as a defensive read so an older handler build can't render a
 * failed open as "Resource Opened".
 */
export function openResourceFailed(result: Record<string, unknown>): boolean {
  if (isHandlerError(result)) return true;
  const msg = typeof result.message === "string" ? result.message : "";
  return /returned false/i.test(msg);
}

/** A routed tool's JSON response as a tool result (the shape every Phase 3 and W1 tool answers). */
function jsonResult(r: { ok: boolean }) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

/**
 * Routes a 1.x name through aliases.ts into its Phase 3 or W1 tool (wb_module, wb_entity, wb_view
 * or wb_container) and runs it; a refused argument is a coded error. The name is historical: the
 * census enumerator (E11) reads alias links from calls to this function.
 */
export async function runAliasViaModule(
  client: WorkbenchClient,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    const routed = routeAlias(name, args);
    if (!routed) throw new Error(`${name} alias is not routed`);
    switch (routed.tool) {
      case "wb_module":
        return toToolResult(await runModule(client, routed.args as unknown as ModuleArgs));
      case "wb_entity":
        return jsonResult(await runEntity(client, routed.args));
      case "wb_view":
        return jsonResult(await runView(client, routed.args));
      case "wb_container":
        return jsonResult(await runContainer(client, routed.args));
      default:
        throw new Error(`${name} routes to ${routed.tool}, which runAliasViaModule cannot run`);
    }
  } catch (e) {
    if (e instanceof VocabularyError) {
      return toToolResult(errorResponse(name, "open:WorldEditor", e.code, e.message));
    }
    throw e;
  }
}

export function registerWbEditorTools(server: McpServer, client: WorkbenchClient): void {
  // wb_play — Switch to game mode (Play in Editor)
  server.registerTool(
    "wb_play",
    {
      description:
        "Switch Workbench to game (play) mode. Compiles scripts and launches the world for testing. Equivalent to pressing Play in the World Editor. Requires edit mode.",
      inputSchema: {
        debugMode: z
          .boolean()
          .optional()
          .describe("Enable debug mode (script breakpoints, extra logging)"),
        fullScreen: z
          .boolean()
          .optional()
          .describe("Launch in full-screen mode instead of windowed"),
      },
    },
    async ({ debugMode, fullScreen }) => {
      const modeErr = requireEditMode(client, "start play mode");
      if (modeErr) {
        return modeGateResponse(modeErr, client);
      }
      try {
        const params: Record<string, unknown> = { action: "play" };
        if (debugMode !== undefined) params.debugMode = debugMode;
        if (fullScreen !== undefined) params.fullScreen = fullScreen;

        const result = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", params);
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, "Error starting play mode");
        }
        client.noteMode("play");

        return {
          content: [
            {
              type: "text" as const,
              text: `**Play Mode Started**\n\nWorkbench is now compiling and entering game mode.${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error starting play mode: ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // wb_stop — Switch to edit mode
  server.registerTool(
    "wb_stop",
    {
      description:
        "Stop game mode and return to the World Editor. Equivalent to pressing Stop in the World Editor. Requires play mode.",
      inputSchema: {},
    },
    async () => {
      const modeErr = requirePlayMode(client, "stop play mode");
      if (modeErr) {
        return modeGateResponse(modeErr, client);
      }
      try {
        const result = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", {
          action: "stop",
        });
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, "Error stopping play mode");
        }
        client.noteMode("edit");

        return {
          content: [
            {
              type: "text" as const,
              text: `**Edit Mode Restored**\n\nWorkbench has returned to edit mode.${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error stopping play mode: ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // wb_save — alias of wb_module save (dry run unless confirm: true; design section 6)
  server.registerTool(
    "wb_save",
    {
      description:
        "Alias of wb_module save on the World Editor. Without confirm: true this is a dry run that names the world and writes nothing; confirm: true saves. " +
        "Save As is not supported: passing `path` is refused with INVALID_ARGUMENT.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Save As path (1.x name): refused, Save As is not supported."),
        confirm: z.boolean().optional().describe("true writes the world; otherwise a dry run"),
      },
      annotations: {
        title: "Save the world",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ path, confirm }) =>
      runAliasViaModule(client, "wb_save", { path, ...(confirm === undefined ? {} : { confirm }) }),
  );

  // wb_undo_redo — Undo or redo
  server.registerTool(
    "wb_undo_redo",
    {
      description: "Undo or redo the last action in the World Editor.",
      inputSchema: {
        action: z.enum(["undo", "redo"]).describe("Whether to undo or redo"),
      },
    },
    async ({ action }) => {
      try {
        const result = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", {
          action,
        });
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, `Error performing ${action}`);
        }

        const label = action === "undo" ? "Undo" : "Redo";
        return {
          content: [
            {
              type: "text" as const,
              text: `**${label} Complete**${result.message ? `\n\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing ${action}: ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // wb_open_resource — alias of wb_module setResource in the owning module (absolute paths refused)
  server.registerTool(
    "wb_open_resource",
    {
      description:
        "Alias of wb_module setResource: opens a project-relative resource in the module that owns its file type (a .ent or .et in the World Editor, a .conf, .emat or .layout in the Resource Manager). An absolute path is refused with ABSOLUTE_PATH.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Project-relative resource path (e.g., 'Worlds/Test.ent'); absolute paths are refused",
          ),
      },
      annotations: {
        title: "Open a resource",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ path }) => runAliasViaModule(client, "wb_open_resource", { path }),
  );
}
