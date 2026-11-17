/**
 * logs_filter / logs_tail / logs_summarize_errors: a missing session, logs root or channel file is
 * an error, never a clean verdict (read-knowledge-08), and a logs_filter cursor is bound to the
 * session folder it was cut from, not to the 'latest' ref (read-knowledge-09).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";
import { registerLogsFilter } from "../../src/tools/logs-filter.js";
import { registerLogsTail } from "../../src/tools/logs-tail.js";
import { registerLogsSummarizeErrors } from "../../src/tools/logs-summarize-errors.js";

let logs: string;

beforeEach(() => {
  logs = mkdtempSync(join(tmpdir(), "logs-tools-"));
});
afterEach(() => rmSync(logs, { recursive: true, force: true }));

function session(name: string, files: Record<string, string>): string {
  const dir = join(logs, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text, "utf-8");
  return dir;
}

describe("missing session or channel is an error (read-knowledge-08)", () => {
  it("logs_summarize_errors on a session without error.log is isError, not 'clean session'", async () => {
    const dir = session("logs_2026-01-01_10-00-00", { "console.log": "x\n" });
    const tool = captureTool((s) => registerLogsSummarizeErrors(s, makeConfig({ logsPath: logs })));
    const r = await tool({ which: "workbench", session: dir, channel: "error", top_n: 15 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/No error\.log in session/);
    expect(textOf(r)).not.toMatch(/clean session/);

    const gone = await tool({ which: "workbench", session: "logs_2030-01-01_00-00-00", channel: "error", top_n: 15 });
    expect(gone.isError).toBe(true);
    expect(textOf(gone)).toMatch(/not found/);
  });

  it("logs_tail and logs_filter answer isError for a missing channel file", async () => {
    const dir = session("logs_2026-01-01_10-00-00", { "console.log": "x\n" });
    const cfg = makeConfig({ logsPath: logs });
    const tail = captureTool((s) => registerLogsTail(s, cfg));
    const t = await tail({ which: "workbench", session: dir, channel: "error", lines: 50 });
    expect(t.isError).toBe(true);
    const filter = captureTool((s) => registerLogsFilter(s, cfg));
    const f = await filter({ which: "workbench", session: dir, channel: "error", level: "any", limit: 10 });
    expect(f.isError).toBe(true);
  });
});

describe("logs_filter cursor binds the resolved session (read-knowledge-09)", () => {
  it("a cursor cut from 'latest' is refused once a newer session appears", async () => {
    session("logs_2026-01-01_10-00-00", { "console.log": "a\nb\nc\n" });
    const tool = captureTool((s) => registerLogsFilter(s, makeConfig({ logsPath: logs })));
    const args = { which: "workbench", session: "latest", channel: "console", level: "any", limit: 1 };
    const p1 = await tool(args);
    expect(p1.isError).toBeUndefined();
    const cursor = /next_cursor: (\S+)/.exec(textOf(p1))?.[1];
    expect(cursor).toBeTruthy();

    // Same session still latest: page 2 is accepted.
    const p2 = await tool({ ...args, cursor });
    expect(p2.isError).toBeUndefined();

    session("logs_2026-01-02_10-00-00", { "console.log": "z\ny\nx\n" });
    const p3 = await tool({ ...args, cursor });
    expect(p3.isError).toBe(true);
    expect(textOf(p3)).toMatch(/cursor/i);
  });
});
