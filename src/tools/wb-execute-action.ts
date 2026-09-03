import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus, requireEditMode } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse, modeGateResponse } from "../workbench/response.js";

// Menu paths that are destructive and must never be driven through this tool.
// Compared against the *normalized* path (segments trimmed) so " File , Close"
// cannot slip past the check.
const BLOCKED_MENU_PREFIXES = ["File,Close", "File,New", "File,Exit", "File,Quit"];

/**
 * Normalize a comma-separated menu path: split on ",", trim each segment,
 * drop empties, rejoin. Mirrors what the handler does with each segment so the
 * blocklist sees the same string the engine will.
 */
export function normalizeMenuPath(menuPath: string): string {
  return menuPath
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(",");
}

export function isBlockedMenuPath(menuPath: string): boolean {
  const normalized = normalizeMenuPath(menuPath);
  return BLOCKED_MENU_PREFIXES.some((blocked) => normalized.startsWith(blocked));
}

export function registerWbExecuteAction(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_execute_action",
    {
      description:
        "Execute any Workbench menu action by its menu path. Use comma-separated path segments to identify the action (e.g., 'Tools,Reload Scripts' or 'File,Save'). " +
        "Some destructive actions (File,Close; File,New; File,Exit) are blocked for safety.",
      inputSchema: {
        menuPath: z
          .string()
          .describe(
            "Comma-separated menu path (e.g., 'Tools,Reload Scripts', 'File,Save', 'Edit,Undo')",
          ),
      },
    },
    async ({ menuPath }) => {
      try {
        const normalizedPath = normalizeMenuPath(menuPath);
        if (normalizedPath.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: \`menuPath\` is empty after normalization.${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }

        // Block known-destructive menu paths
        if (isBlockedMenuPath(normalizedPath)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Blocked:** "${menuPath}" is a destructive action and cannot be executed via this tool. Perform it manually in Workbench.${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }

        // Mutating actions require edit mode
        const modeErr = requireEditMode(client, `execute menu action "${menuPath}"`);
        if (modeErr) {
          return modeGateResponse(modeErr, client);
        }
        const result = await client.call<Record<string, unknown>>("EMCP_WB_ExecuteAction", {
          menuPath: normalizedPath,
        });
        // isHandlerError also catches `result: false` on an ok payload — the
        // engine's ExecuteAction returned false, so nothing ran.
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, `Error executing action "${menuPath}"`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `**Action Executed**\n\nMenu path: ${result.menuPath ?? normalizedPath}${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing action "${menuPath}": ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
