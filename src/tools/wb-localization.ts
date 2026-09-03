import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus, requireEditMode } from "../workbench/status.js";
import { isHandlerError, handlerErrorResponse, modeGateResponse } from "../workbench/response.js";

export function registerWbLocalization(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_localization",
    {
      description:
        "Manage localization entries in the Workbench Localization Editor. Insert, delete, or modify string table entries, or get the full localization table.",
      inputSchema: {
        action: z
          .enum(["insert", "delete", "modify", "getTable", "listLanguages"])
          .describe(
            "Action: insert (add new entry), delete (remove entry), modify (update entry), getTable (list all entries), listLanguages (list available language columns)",
          ),
        itemId: z
          .string()
          .optional()
          .describe("Localization item ID / key (required for insert, delete, modify)"),
        property: z
          .string()
          .optional()
          .describe("Property to modify (e.g., 'en_us', 'target', 'comment')"),
        value: z.string().optional().describe("Value to set for insert/modify"),
      },
    },
    async ({ action, itemId, property, value }) => {
      try {
        // Mutating actions require edit mode
        const MUTATING_ACTIONS = ["insert", "delete", "modify"];
        if (MUTATING_ACTIONS.includes(action)) {
          const modeErr = requireEditMode(client, `${action} localization entry`);
          if (modeErr) {
            return modeGateResponse(modeErr, client);
          }
        }

        if ((action === "insert" || action === "delete" || action === "modify") && !itemId) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: \`itemId\` is required for the "${action}" action.`,
              },
            ],
            isError: true,
          };
        }

        if (action === "modify" && !property) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: `property` is required for the modify action.",
              },
            ],
            isError: true,
          };
        }

        const params: Record<string, unknown> = { action };
        if (itemId) params.itemId = itemId;
        if (property) params.property = property;
        if (value !== undefined) params.value = value;

        const result = await client.call<Record<string, unknown>>("EMCP_WB_Localization", params);
        if (isHandlerError(result)) {
          return handlerErrorResponse(result, client, `Error in localization (${action})`);
        }

        if (action === "getTable") {
          // Handler emits tableItemCount + entries[{id,en_us,target,comment}]
          const entries = Array.isArray(result.entries) ? result.entries : [];
          const total =
            typeof result.tableItemCount === "number" ? result.tableItemCount : entries.length;
          if (entries.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**Localization Table:** Empty (no entries)${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
                },
              ],
            };
          }

          const lines = [`**Localization Table** (${entries.length} of ${total} entries)\n`];
          lines.push("| ID | en_us | Target | Comment |");
          lines.push("|---|---|---|---|");
          for (const entry of entries) {
            const e = entry as Record<string, unknown>;
            lines.push(
              `| ${e.id ?? "?"} | ${e.en_us ?? ""} | ${e.target ?? ""} | ${e.comment ?? ""} |`,
            );
          }

          return {
            content: [
              { type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) },
            ],
          };
        }

        if (action === "listLanguages") {
          const langs = Array.isArray(result.languages) ? result.languages : [];
          if (langs.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `**No language columns detected.**\n\n${result.message || ""}${formatConnectionStatus(client)}`,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `**Language Columns** (${langs.length})\n\n${(langs as unknown[]).map((l) => `- ${l}`).join("\n")}${formatConnectionStatus(client)}`,
              },
            ],
          };
        }

        const id = result.itemId ?? itemId;
        const actionLabels: Record<string, string> = {
          insert: `Inserted localization entry: **${id}**`,
          delete: `Deleted localization entry: **${id}**`,
          modify: `Modified **${id}**.${property} = "${value || ""}"`,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `**Localization Updated**\n\n${actionLabels[action]}${result.message ? `\n${result.message}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error in localization (${action}): ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
