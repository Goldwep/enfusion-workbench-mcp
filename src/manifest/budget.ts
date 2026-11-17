import { spawn } from "node:child_process";
import { filterTools } from "./tiers.js";

/** Byte budgets (phase3-tool-surface.md section 7), measured as JSON.stringify(tools).length. */
export const CORE_BUDGET = 35_000;
/**
 * DEC-065: the full list grows with every wave of the complete toolbox; the core/extended split is
 * settled from Phase 6 measurements. DEC-077: 210,000 once W7 and W8 landed (203,194 after the trim).
 */
export const FULL_BUDGET = 210_000;

export interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface BudgetReport {
  coreChars: number;
  fullChars: number;
  coreTools: number;
  fullTools: number;
  coreOk: boolean;
  fullOk: boolean;
}

export function listChars(tools: ListedTool[]): number {
  return JSON.stringify(tools).length;
}

/** Core is measured on the list filtered by the tiers table with ENFUSION_TOOLSET=core. */
export function checkBudget(tools: ListedTool[]): BudgetReport {
  const core = filterTools(tools, { ENFUSION_TOOLSET: "core" });
  const coreChars = listChars(core);
  const fullChars = listChars(tools);
  return {
    coreChars,
    fullChars,
    coreTools: core.length,
    fullTools: tools.length,
    coreOk: coreChars <= CORE_BUDGET,
    fullOk: fullChars <= FULL_BUDGET,
  };
}

/** Spawns the server entry over stdio, sends initialize + tools/list, returns the tools. */
export function fetchToolsList(entry: string, timeoutMs = 60_000): Promise<ListedTool[]> {
  return new Promise((resolve, reject) => {
    // The budget is over the FULL list: the dist is started under ENFUSION_TOOLSET=all whatever the
    // developer's shell holds (the registration gate of src/server.ts would otherwise hide tools).
    const child = spawn(process.execPath, [entry], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, ENFUSION_TOOLSET: "all", ENFUSION_TOOLS: "" },
    });
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + "\n");
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`tools/list timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString("utf-8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: { id?: number; result?: { tools?: ListedTool[] } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // a non-JSON line on stdout is not ours
        }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result?.tools ?? []);
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "budget", version: "0" },
      },
    });
  });
}
