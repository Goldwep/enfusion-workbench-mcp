import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import {
  FORBIDDEN_METHODS,
  FrameReader,
  frame,
  lspOptionsRefusal,
  messagePlan,
  runLspPlan,
  shapeOf,
  type LspOptions,
} from "../../scripts/live/lsp-probe.js";

type Msg = Record<string, unknown>;

/** A mock LSP server: records every message per connection and answers by a handler. */
function mockServer(answer: (m: Msg, sock: Socket) => Msg | null): Promise<{
  server: Server;
  port: number;
  seen: Msg[][];
}> {
  const seen: Msg[][] = [];
  const server = createServer((sock) => {
    const mine: Msg[] = [];
    seen.push(mine);
    const r = new FrameReader();
    sock.on("data", (d: Buffer) => {
      for (const m of r.push(d) as Msg[]) {
        mine.push(m);
        const a = answer(m, sock);
        if (a) sock.write(frame(a));
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      res({ server, port: typeof addr === "object" && addr ? addr.port : 0, seen });
    }),
  );
}

let open: Server | null = null;
afterEach(() => {
  open?.close();
  open = null;
});

const SANDBOX = join(tmpdir(), "emcp-lsp-none", "EMCP2_sandbox");
const base = (port: number, o: Partial<LspOptions> = {}): LspOptions => ({
  port,
  netPort: 5775,
  plan: "session",
  sandboxDir: SANDBOX,
  timeoutMs: 2_000,
  waitScale: 0.01,
  ...o,
});

describe("framing", () => {
  it("frames and decodes split and joined chunks", () => {
    const a = frame({ id: 1, x: "é" });
    const b = frame({ id: 2 });
    const r = new FrameReader();
    const all = Buffer.concat([a, b]);
    expect(r.push(all.subarray(0, 5))).toEqual([]);
    expect(r.push(all.subarray(5))).toEqual([{ id: 1, x: "é" }, { id: 2 }]);
  });

  it("shapes keep keys and lengths, never strings", () => {
    expect(shapeOf({ contents: { value: "secret text" }, items: [1, 2] })).toEqual({
      contents: { keys: ["value"] },
      items: { array: 2 },
    });
    expect(JSON.stringify(shapeOf({ a: "secret text" }))).not.toContain("secret");
  });
});

describe("refusals", () => {
  it("refuses another host, port = net port, and a bad plan", () => {
    expect(lspOptionsRefusal(base(5776, { host: "10.0.0.1" }))).toMatch(/127\.0\.0\.1 only/);
    expect(lspOptionsRefusal(base(5775))).toMatch(/one NET call/);
    expect(lspOptionsRefusal(base(5776, { plan: "x" as "session" }))).toMatch(/--plan/);
    expect(lspOptionsRefusal(base(5776))).toBeNull();
  });

  it("F-H1: --hover-uri only inside the 2.0 sandbox", () => {
    const inside = pathToFileURL(join(SANDBOX, "Scripts", "Game", "x.c")).href;
    const outside = pathToFileURL(join(tmpdir(), "elsewhere.c")).href;
    const escape = pathToFileURL(join(SANDBOX, "..", "other", "x.c")).href;
    expect(lspOptionsRefusal(base(5776, { hoverUri: inside }))).toBeNull();
    expect(lspOptionsRefusal(base(5776, { hoverUri: outside }))).toMatch(
      /not inside the 2.0 sandbox/,
    );
    expect(lspOptionsRefusal(base(5776, { hoverUri: escape }))).toMatch(
      /not inside the 2.0 sandbox/,
    );
    expect(lspOptionsRefusal(base(5776, { hoverUri: "http://x/y.c" }))).toMatch(/file:\/\/\//);
  });

  it("the dry-run plan lists the session in order", () => {
    expect(messagePlan("session").map((s) => s.split(" ")[1])).toEqual([
      "initialize",
      "initialized",
      "textDocument/didOpen",
      "textDocument/diagnostic",
      "textDocument/hover",
      "textDocument/completion",
      "socket",
    ]);
  });
});

describe("runLspPlan against a mock server", () => {
  it("session: sends the plan in order, never a forbidden method, echoes no text", async () => {
    const m = await mockServer((msg) =>
      msg.id !== undefined
        ? {
            jsonrpc: "2.0",
            id: msg.id,
            result:
              msg.method === "initialize"
                ? { capabilities: { hoverProvider: true } }
                : { items: [{ label: "server says secret" }] },
          }
        : null,
    );
    open = m.server;
    const rep = await runLspPlan(base(m.port));
    expect(rep.result).toBe("ok");
    expect(rep.diagnostics).toBe("pull");
    const methods = m.seen[0].map((x) => x.method);
    expect(methods).toEqual([
      "initialize",
      "initialized",
      "textDocument/didOpen",
      "textDocument/diagnostic",
      "textDocument/hover",
      "textDocument/completion",
    ]);
    for (const x of m.seen[0]) expect(FORBIDDEN_METHODS.has(String(x.method))).toBe(false);
    expect(JSON.stringify(rep)).not.toContain("secret");
    expect(JSON.stringify(rep)).not.toContain("EMCP2_UndeclaredType");
    expect(rep.messages.find((x) => x.method === "initialize")!.shape).toEqual({
      capabilities: { keys: ["hoverProvider"] },
    });
  });

  it("falls back to publishDiagnostics when the pull request errors", async () => {
    const m = await mockServer((msg, sock) => {
      if (msg.method === "textDocument/diagnostic") {
        sock.write(
          frame({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {} }),
        );
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } };
      }
      return msg.id !== undefined ? { jsonrpc: "2.0", id: msg.id, result: {} } : null;
    });
    open = m.server;
    const rep = await runLspPlan(base(m.port));
    expect(rep.diagnostics).toBe("push");
    expect(rep.messages.find((x) => x.method === "textDocument/diagnostic")!.error).toEqual({
      code: -32601,
    });
  });

  it("no answer to initialize is result no-answer, not a throw", async () => {
    const m = await mockServer(() => null);
    open = m.server;
    const rep = await runLspPlan(base(m.port, { timeoutMs: 200 }));
    expect(rep.result).toBe("no-answer");
    expect(m.seen[0].map((x) => x.method)).toEqual(["initialize"]);
  });

  it("second-client: two sockets, one initialize each, nothing else", async () => {
    const m = await mockServer((msg) =>
      msg.id !== undefined ? { jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } } : null,
    );
    open = m.server;
    const rep = await runLspPlan(base(m.port, { plan: "second-client" }));
    expect(rep.result).toBe("ok");
    expect(m.seen.length).toBe(2);
    expect(m.seen.map((s) => s.map((x) => x.method))).toEqual([["initialize"], ["initialize"]]);
  });

  it("a closed port is connect-failed", async () => {
    const m = await mockServer(() => null);
    const port = m.port;
    await new Promise((r) => m.server.close(r));
    const rep = await runLspPlan(base(port));
    expect(rep.result).toBe("connect-failed");
  });
});

describe("lsp-probe.ts source scan", () => {
  const src = readFileSync(join(REPO_ROOT, "scripts", "live", "lsp-probe.ts"), "utf-8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/FORBIDDEN_METHODS[^;]*;/, "");
  it("never names didSave, didChange, shutdown or exit as a sent method", () => {
    for (const m of ["didSave", "didChange", '"shutdown"', '"exit"']) expect(code).not.toContain(m);
  });
  it("its only file write is the --out JSON", () => {
    const writes =
      code.match(
        /\b(writeFileSync|appendFileSync|createWriteStream|writeFile|mkdirSync|unlinkSync|rmSync|renameSync)\s*\(/g,
      ) ?? [];
    expect(writes).toEqual(["writeFileSync("]);
    expect(code).toMatch(/writeFileSync\(out,/);
  });
});
