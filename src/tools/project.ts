import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { relative, resolve, dirname } from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import type { Config } from "../config.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { listDirectory, formatSize } from "../utils/dir-listing.js";
import { assertInsideAnyRoot, assertInsideRoot } from "../utils/path-guard.js";
import { readTextFileBounded } from "../utils/safe-read.js";

export function registerProject(server: McpServer, config: Config): void {
  server.registerTool(
    "project",
    {
      description:
        "Browse, read, or write files in an Arma Reforger Workbench project directory. Use action='browse' to list files, action='read' to read a file, action='write' to write a file.",
      inputSchema: {
        action: z
          .enum(["browse", "read", "write"])
          .describe(
            "Operation to perform: browse (list files), read (read a file), write (write a file)",
          ),
        path: z
          .string()
          .optional()
          .describe(
            "(browse) Subdirectory to list within the project (e.g., 'Scripts/Game', 'Prefabs'). Omit for project root. " +
              "(read) Relative path within the project (e.g., 'Scripts/Game/MyScript.c', 'MyMod.gproj'). " +
              "(write) Relative path within the project (e.g., 'Scripts/Game/MyScript.c').",
          ),
        pattern: z
          .string()
          .optional()
          .describe("(browse) File extension filter (e.g., '*.c', '*.et')"),
        content: z.string().optional().describe("(write) File content to write"),
        createDirectories: z
          .boolean()
          .optional()
          .describe("(write) Create parent directories if they don't exist. Default: true."),
        projectPath: z
          .string()
          .optional()
          .describe("Absolute path to the project directory. Uses configured default if omitted."),
      },
    },
    async ({ action, path: inputPath, pattern, content, createDirectories, projectPath }) => {
      const basePath = projectPath || config.projectPath;

      if (!basePath) {
        return {
          content: [
            {
              type: "text",
              text: "No project path configured. Set ENFUSION_PROJECT_PATH environment variable or provide projectPath parameter.",
            },
          ],
          isError: true,
        };
      }

      // H7 containment: an LLM-supplied projectPath must stay inside a
      // configured root. Writes are confined to the user project; reads /
      // browses may also target the other configured (read-only) roots.
      if (projectPath) {
        try {
          const resolvedBase = resolve(projectPath);
          if (action === "write") {
            assertInsideRoot(resolvedBase, config.projectPath, "projectPath");
          } else {
            assertInsideAnyRoot(
              resolvedBase,
              [
                config.projectPath,
                config.workshopPath,
                config.corePath,
                config.gamePath,
                config.extractedPath,
              ],
              "projectPath",
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
        }
      }

      if (action === "browse") {
        try {
          const subPath = inputPath ?? "";
          const targetPath = subPath ? validateProjectPath(basePath, subPath) : basePath;

          const entries = listDirectory(targetPath, pattern);
          const relPath = relative(basePath, targetPath) || ".";

          const lines: string[] = [];
          lines.push(`Project: ${basePath}`);
          lines.push(`Path: ${relPath === "." ? "(root)" : relPath}`);
          lines.push("");

          let fileCount = 0;
          let dirCount = 0;

          for (const entry of entries) {
            if (entry.isDirectory) {
              lines.push(`  ${entry.name}/`);
              dirCount++;
            } else {
              const typeTag = entry.type ? `[${entry.type}]` : "";
              const sizeStr = formatSize(entry.size);
              lines.push(`  ${entry.name.padEnd(40)} ${typeTag.padEnd(12)} ${sizeStr}`);
              fileCount++;
            }
          }

          lines.push("");
          lines.push(`Total: ${fileCount} files, ${dirCount} directories`);

          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [{ type: "text", text: `Error browsing project: ${msg}` }],
            isError: true,
          };
        }
      }

      if (action === "read") {
        if (!inputPath) {
          return {
            content: [{ type: "text", text: "action='read' requires a 'path' parameter." }],
            isError: true,
          };
        }

        try {
          const fullPath = validateProjectPath(basePath, inputPath);

          if (!existsSync(fullPath)) {
            return {
              content: [{ type: "text", text: `File not found: ${inputPath}` }],
              isError: true,
            };
          }

          const fileContent = readTextFileBounded(fullPath);
          return {
            content: [{ type: "text", text: fileContent }],
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [{ type: "text", text: `Error reading file: ${msg}` }],
            isError: true,
          };
        }
      }

      if (action === "write") {
        if (!inputPath) {
          return {
            content: [{ type: "text", text: "action='write' requires a 'path' parameter." }],
            isError: true,
          };
        }
        if (content === undefined) {
          return {
            content: [{ type: "text", text: "action='write' requires a 'content' parameter." }],
            isError: true,
          };
        }

        try {
          const fullPath = validateProjectPath(basePath, inputPath);
          // Final-path containment (catches junctions planted under basePath).
          assertInsideRoot(fullPath, config.projectPath, "path");
          const shouldCreateDirs = createDirectories !== false;

          if (shouldCreateDirs) {
            mkdirSync(dirname(fullPath), { recursive: true });
          }

          writeFileSync(fullPath, content, "utf-8");
          const sizeBytes = Buffer.byteLength(content, "utf-8");

          return {
            content: [
              {
                type: "text",
                text: `File written: ${inputPath} (${sizeBytes} bytes)`,
              },
            ],
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [{ type: "text", text: `Error writing file: ${msg}` }],
            isError: true,
          };
        }
      }

      return {
        content: [{ type: "text", text: `Unknown action: ${action}` }],
        isError: true,
      };
    },
  );
}
