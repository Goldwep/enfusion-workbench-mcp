/**
 * Minimal fake McpServer that captures the handler a `register*` function
 * installs, so tool handlers can be invoked directly in unit tests.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";

export type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export function captureTool(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | undefined;
  const fake = {
    registerTool: (_name: string, _def: unknown, h: ToolHandler) => {
      handler = h;
    },
  } as unknown as McpServer;
  register(fake);
  if (!handler) throw new Error("register() did not call registerTool");
  return handler;
}

export function textOf(r: ToolResult): string {
  return r.content.map((c) => c.text).join("\n");
}

export function makeConfig(overrides: Partial<Config>): Config {
  return {
    workbenchPath: "C:/nonexistent/wb",
    projectPath: "C:/nonexistent/proj",
    gamePath: "C:/nonexistent/game",
    dataDir: "C:/nonexistent/data",
    patternsDir: "C:/nonexistent/patterns",
    workbenchHost: "127.0.0.1",
    workbenchPort: 5775,
    projectIndexPath: ":memory:",
    corePath: "C:/nonexistent/core",
    logsPath: "C:/nonexistent/logs",
    ...overrides,
  };
}
