import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import type { Config } from "../config.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { resolveGameDataPath } from "../utils/game-paths.js";

/**
 * Decide text vs binary from the bytes, not the extension: Bohemia's editors
 * write many plain-text formats (animation graphs, behaviour trees, audio and
 * particle documents, ...) that no extension list can keep up with. Text means
 * no NUL byte anywhere in the (size-capped) buffer and valid UTF-8, with an
 * optional UTF-8 BOM. UTF-16/32 documents (BOM-marked) are named, not decoded:
 * this reader only decodes UTF-8.
 */
function sniffText(buf: Buffer): { text: string } | { reason: string } {
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0 && buf[3] === 0) {
    return { reason: "UTF-32LE text (BOM), not decoded by this reader" };
  }
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 0xfe && buf[3] === 0xff) {
    return { reason: "UTF-32BE text (BOM), not decoded by this reader" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { reason: "UTF-16LE text (BOM), not decoded by this reader" };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { reason: "UTF-16BE text (BOM), not decoded by this reader" };
  }
  const nul = buf.indexOf(0);
  if (nul !== -1) return { reason: `contains a NUL byte at offset ${nul}` };
  try {
    // The decoder drops a leading UTF-8 BOM by default.
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
  } catch {
    return { reason: "not valid UTF-8" };
  }
}

function binaryRefusal(subPath: string, ext: string, size: number, reason: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Binary file: ${subPath} (${ext || "no extension"}, ${size} bytes): ${reason}. Only plain-text files can be read.`,
      },
    ],
    isError: true,
  };
}

export function registerGameRead(server: McpServer, config: Config): void {
  server.registerTool(
    "game_read",
    {
      description:
        "Read a file from the base game data. " +
        "Reads from both unpacked files and .pak archives transparently. " +
        "Use this to read vanilla .c script files to understand what to override, " +
        "or inspect prefab .et files and config .conf files.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Relative path within the game data (e.g., 'Scripts/Game/Character/SCR_CharacterControllerComponent.c')",
          ),
      },
    },
    async ({ path: subPathInput }) => {
      let subPath = subPathInput;
      const basePath = resolveGameDataPath(config.gamePath);
      if (!basePath) {
        return {
          content: [
            {
              type: "text",
              text: `Base game not found at ${config.gamePath}. Set ENFUSION_GAME_PATH or ensure Arma Reforger is installed.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const filePath = validateProjectPath(basePath, subPath);

        // Try loose file first
        if (existsSync(filePath)) {
          const stats = statSync(filePath);
          if (stats.isDirectory()) {
            return {
              content: [
                {
                  type: "text",
                  text: `"${subPath}" is a directory. Use game_browse to list its contents.`,
                },
              ],
              isError: true,
            };
          }

          if (stats.size > 512_000) {
            return {
              content: [
                {
                  type: "text",
                  text: `File too large: ${subPath} (${(stats.size / 1024).toFixed(0)} KB). Maximum readable size is 500 KB.`,
                },
              ],
              isError: true,
            };
          }

          const sniffed = sniffText(readFileSync(filePath));
          if ("reason" in sniffed) {
            return binaryRefusal(subPath, extname(filePath).toLowerCase(), stats.size, sniffed.reason);
          }
          return {
            content: [
              {
                type: "text",
                text: `// ${subPath}\n// ${stats.size} bytes\n\n${sniffed.text}`,
              },
            ],
          };
        }

        // Fall through to pak VFS. If the exact key misses, retry with a
        // case-insensitive match against the VFS index (Enfusion paths are
        // case-sensitive inside paks but LLMs frequently get the case wrong).
        const pakVfs = PakVirtualFS.get(config.gamePath);
        let pakPath: string | null = null;
        if (pakVfs) {
          if (pakVfs.exists(subPath)) {
            pakPath = subPath;
          } else {
            const wanted = subPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
            const hit = pakVfs
              .allFilePaths()
              .find((p) => p.replace(/\\/g, "/").toLowerCase() === wanted);
            if (hit !== undefined) pakPath = hit;
          }
        }
        if (pakVfs && pakPath !== null) {
          subPath = pakPath;
          const fileSize = pakVfs.fileSize(subPath);
          if (fileSize > 512_000) {
            return {
              content: [
                {
                  type: "text",
                  text: `File too large: ${subPath} (${(fileSize / 1024).toFixed(0)} KB). Maximum readable size is 500 KB.`,
                },
              ],
              isError: true,
            };
          }

          const sniffed = sniffText(pakVfs.readFile(subPath));
          if ("reason" in sniffed) {
            return binaryRefusal(subPath, extname(subPath).toLowerCase(), fileSize, sniffed.reason);
          }
          return {
            content: [
              {
                type: "text",
                text: `// ${subPath} (from .pak)\n// ${sniffed.text.length} bytes\n\n${sniffed.text}`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: `File not found: ${subPath}` }],
          isError: true,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Error reading game file: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
