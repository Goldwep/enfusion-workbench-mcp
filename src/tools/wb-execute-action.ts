import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus, requireEditMode } from "../workbench/status.js";
import { modeGateResponse } from "../workbench/response.js";
import { routeAlias } from "../manifest/aliases.js";
import { runMenu, toToolResult, type MenuArgs } from "./wb-menu.js";

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

/** The handler that runs one menu action. */
export const EXECUTE_ACTION_HANDLER = "EMCP_WB_ExecuteAction";

/**
 * Sends one already-normalized menu path to the handler and answers its raw payload; the caller
 * does its own checks (blocklist, mode, allow-list) first. `wb_menu run` makes the same call in
 * its own file, and wb_execute_action routes there (W8 OD-1).
 */
export async function callExecuteAction(
  client: Pick<WorkbenchClient, "call">,
  normalizedPath: string,
): Promise<Record<string, unknown>> {
  return client.call<Record<string, unknown>>(EXECUTE_ACTION_HANDLER, {
    menuPath: normalizedPath,
  });
}

/**
 * The 1.x menu runner is an alias of `wb_menu run` (W8 OD-1, DEC-076): the route lives in
 * src/manifest/aliases.ts, and the run goes through wb_menu's allow-list, deny words, dialog and
 * risk checks. The 1.x blocklist and edit-mode gate answer first, in their 1.x words.
 */
export function registerWbExecuteAction(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_execute_action",
    {
      description:
        "Alias of wb_menu run on the World Editor: runs a menu action by its comma-separated path (e.g., 'Window,Hierarchy'). " +
        "Segments must be the exact menu labels and must come from a verified source; only allow-listed paths run, and a mutating item is a dry run unless confirm: true. " +
        "Destructive actions (File,Close; File,New; File,Exit) are blocked.",
      inputSchema: {
        menuPath: z
          .string()
          .describe(
            "Comma-separated menu path of exact menu labels from a verified source (e.g., 'Window,Hierarchy')",
          ),
        confirm: z.boolean().optional().describe("true runs a mutating item; else a dry run"),
      },
    },
    async ({ menuPath, confirm }) => {
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
        const routed = routeAlias("wb_execute_action", {
          menuPath: normalizedPath,
          ...(confirm === true ? { confirm: true } : {}),
        });
        if (!routed) throw new Error("wb_execute_action alias is not routed");
        return toToolResult(await runMenu(client, routed.args as unknown as MenuArgs));
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
