import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
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

  // wb_save — Save the current world
  server.registerTool(
    "wb_save",
    {
      description:
        "Save the current world in the World Editor. Optionally save to a new path (Save As). Only works in edit mode. " +
        "Note: Save As is not currently supported by the Workbench script API — passing `path` reports an error rather than silently overwriting the current world.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("File path for Save As. Omit to save to the current file."),
      },
    },
    async ({ path }) => {
      const modeErr = requireEditMode(client, "save");
      if (modeErr) {
        return modeGateResponse(modeErr, client);
      }
      try {
        const params: Record<string, unknown> = {
          action: path ? "saveAs" : "save",
        };
        if (path) params.path = path;

        // Save can open a modal dialog for unsaved worlds — use longer timeout
        const result = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", params, {
          timeout: 30_000,
        });
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, path ? "Error in Save As" : "Error saving");
        }

        const message = typeof result.message === "string" ? result.message : "";

        if (path) {
          // Only claim "Saved as: <path>" when the handler confirms the new
          // path in its message. Anything else (e.g. "SaveAs not available,
          // used Save instead") means the current world was written — or
          // nothing was — and the caller must not believe a new file exists.
          if (!message.includes(path)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**Save As NOT performed** — the handler did not confirm a save to \`${path}\`.\n${message || "(no handler message)"}\n\nThe world was not saved under the requested path.${formatConnectionStatus(client)}`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `**Save Complete**\n\nSaved as: ${path}\n${message}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        // Plain save: the handler currently reports "Save returned false"
        // with status ok when nothing was written. Treat that as a failure.
        if (/returned false/i.test(message)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Save NOT confirmed** — ${message}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `**Save Complete**\n\nWorld saved.${message ? `\n${message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("timed out")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Save Pending** — Workbench opened a save dialog that requires user confirmation. The world will be saved once the user clicks OK in Workbench. This is normal for worlds that haven't been saved before.${formatConnectionStatus(client)}`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Error saving: ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
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

  // wb_open_resource — Open a resource in Workbench
  server.registerTool(
    "wb_open_resource",
    {
      description:
        "Open a resource file in the appropriate Workbench editor (e.g., a .et prefab in the Prefab Editor, a .c script in the Script Editor).",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Resource path to open (e.g., 'Prefabs/Weapons/AK47.et', 'Scripts/Game/MyScript.c')",
          ),
      },
    },
    async ({ path }) => {
      try {
        const result = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", {
          action: "openResource",
          path,
        });
        if (openResourceFailed(result)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Resource NOT opened**: ${path}\n${handlerErrorMessage(result)}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `**Resource Opened**\n\nOpened: ${path}${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error opening resource: ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
