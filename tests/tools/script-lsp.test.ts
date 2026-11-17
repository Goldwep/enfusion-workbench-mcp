import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import type { Config } from "../../src/config.js";
import {
  ACTION_KEYS,
  FORBIDDEN_METHODS,
  FrameError,
  FrameReader,
  GATE_ENV,
  GATE_REASON,
  LSP_DEFAULT_PORT,
  PORT_ENV,
  SCRIPT_LSP_ACTIONS,
  SCRIPT_LSP_DESCRIPTION,
  ScriptLspHost,
  frame,
  gateReason,
  markupText,
  netConnector,
  prepareRequest,
  registerScriptLsp,
  scriptLspDescription,
  type LspConnector,
  type LspTimeouts,
  type LspTransport,
  type ScriptLspDeps,
  type ScriptLspResponse,
} from "../../src/tools/script-lsp.js";

// ── A fake language server ───────────────────────────────────────────────────

type Msg = Record<string, unknown>;

interface Conn {
  received: Msg[];
  send(m: Msg): void;
  /** Writes raw bytes to the client (framing tests). */
  sendRaw(b: Buffer): void;
  close(): void;
  destroyed: boolean;
}

type Handler = (m: Msg, c: Conn) => void;

const PROJECT = resolve(tmpdir(), "emcp-lsp-test-project");
const FILE = "Scripts/Game/Foo.c";
const FILE_ABS = resolve(PROJECT, FILE);
const FILE_URI = pathToFileURL(FILE_ABS).href;
const FILE_TEXT = "class Foo\n{\n\tvoid Bar(int a, float b) {}\n}\n";

const CAPS = {
  hoverProvider: true,
  definitionProvider: true,
  implementationProvider: true,
  completionProvider: {},
  signatureHelpProvider: {},
  textDocumentSync: 1,
};

/** A connector whose every connection is served by `handler` (plus a default initialize). */
function fakeServer(handler: Handler, opts: { caps?: Msg; noInitialize?: boolean } = {}) {
  const conns: Conn[] = [];
  const ports: number[] = [];
  const connector: LspConnector = async (_host, port) => {
    ports.push(port);
    let onData: (d: Buffer) => void = () => {};
    let onClose: () => void = () => {};
    const reader = new FrameReader();
    const conn: Conn = {
      received: [],
      destroyed: false,
      send: (m) => conn.sendRaw(frame({ jsonrpc: "2.0", ...m })),
      sendRaw: (b) => {
        if (!conn.destroyed) setImmediate(() => onData(b));
      },
      close: () => {
        if (conn.destroyed) return;
        conn.destroyed = true;
        setImmediate(() => onClose());
      },
    };
    conns.push(conn);
    const transport: LspTransport = {
      write: (d) => {
        for (const m of reader.push(d) as Msg[]) {
          conn.received.push(m);
          if (m.method === "initialize" && !opts.noInitialize) {
            conn.send({
              id: m.id,
              result: { capabilities: opts.caps ?? CAPS, serverInfo: { name: "fake" } },
            });
            continue;
          }
          if (m.method === "shutdown") {
            conn.send({ id: m.id, result: null });
            continue;
          }
          handler(m, conn);
        }
      },
      onData: (cb) => {
        onData = cb;
      },
      onClose: (cb) => {
        onClose = cb;
      },
      destroy: () => {
        conn.destroyed = true;
      },
    };
    return transport;
  };
  return { connector, conns, ports };
}

const FAST: Partial<LspTimeouts> = {
  connect: 200,
  initialize: 200,
  request: 200,
  diagnostics: 150,
  shutdown: 100,
  idle: 60_000,
};

const OPEN_ENV = { [GATE_ENV]: "1" };

const hosts: ScriptLspHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
});

function host(connector: LspConnector, over: Partial<ScriptLspDeps> = {}) {
  const reads: string[] = [];
  const h = new ScriptLspHost({
    projectPath: PROJECT,
    netPort: 5775,
    env: OPEN_ENV,
    connector,
    readFile: (p) => {
      reads.push(p);
      return FILE_TEXT;
    },
    fileExists: (p) => resolve(p) === FILE_ABS,
    timeouts: FAST,
    ...over,
  });
  hosts.push(h);
  return { h, reads };
}

function err(r: ScriptLspResponse) {
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r)}`);
  return r;
}
function okRb(r: ScriptLspResponse): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.readback as Record<string, unknown>;
}
const methods = (c: Conn) => c.received.map((m) => String(m.method ?? "(answer)"));
const neverForbidden = (c: Conn) => {
  for (const m of methods(c)) expect(FORBIDDEN_METHODS.has(m), m).toBe(false);
};

// ── Description and surface ──────────────────────────────────────────────────

describe("script_lsp surface", () => {
  it("has the seven actions of the spec", () => {
    expect([...SCRIPT_LSP_ACTIONS]).toEqual([
      "status",
      "diagnostics",
      "hover",
      "definition",
      "implementation",
      "completion",
      "signature",
    ]);
    expect(Object.keys(ACTION_KEYS).sort()).toEqual([...SCRIPT_LSP_ACTIONS].sort());
  });

  it("its description fits the 400-char cap and names the gate", () => {
    expect(SCRIPT_LSP_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(scriptLspDescription()).toContain(GATE_ENV);
    expect(scriptLspDescription()).toContain("P-W3-23");
    expect(scriptLspDescription()).not.toMatch(/sandbox/i);
  });

  it("LSP_OFF is a shared vocabulary code", () => {
    expect(ERROR_CODES.LSP_OFF).toMatch(/LSP_Enabled/);
  });
});

// ── The gate ─────────────────────────────────────────────────────────────────

describe("script_lsp gate (W3 OD-6, P-W3-23)", () => {
  it("is closed unless the switch is exactly 1", () => {
    expect(gateReason({})).toBe(GATE_REASON);
    expect(gateReason({ [GATE_ENV]: "0" })).toBe(GATE_REASON);
    expect(gateReason({ [GATE_ENV]: "true" })).toBe(GATE_REASON);
    expect(gateReason({ [GATE_ENV]: "1" })).toBeNull();
  });

  it("answers GATED for every action and opens, reads and sends nothing", async () => {
    let connects = 0;
    const connector: LspConnector = async () => {
      connects++;
      throw new Error("must not connect");
    };
    for (const env of [{}, { [GATE_ENV]: "0" }]) {
      const { h, reads } = host(connector, { env });
      for (const action of SCRIPT_LSP_ACTIONS) {
        const e = err(await h.run({ action, path: FILE, line: 0, character: 0 }));
        expect(e.code, action).toBe("GATED");
        expect(e.message).toBe(GATE_REASON);
        expect(e.next).toContain(GATE_ENV);
      }
      // Even a malformed request of a known action answers GATED, nothing else.
      expect(err(await h.run({ action: "hover", path: "C:/abs.c" })).code).toBe("GATED");
      expect(reads).toEqual([]);
      expect(h.sessionsOpened).toBe(0);
      expect(h.hasSession).toBe(false);
    }
    expect(connects).toBe(0);
  });

  it("refuses an unknown action as INVALID_ARGUMENT even while gated", async () => {
    const { h } = host(fakeServer(() => {}).connector, { env: {} });
    const e = err(await h.run({ action: "rename" }));
    expect(e.code).toBe("INVALID_ARGUMENT");
    expect(e.message).toContain("status");
  });

  it("registers a tool that answers GATED through the MCP surface", async () => {
    let registered: { name: string; def: Msg; cb: (a: Msg) => Promise<unknown> } | undefined;
    const fakeMcp = {
      registerTool: (name: string, def: Msg, cb: (a: Msg) => Promise<unknown>) => {
        registered = { name, def, cb };
      },
    };
    const saved = process.env[GATE_ENV];
    delete process.env[GATE_ENV];
    try {
      const h = registerScriptLsp(
        fakeMcp as never,
        { projectPath: PROJECT, workbenchPort: 5775 } as Config,
      );
      hosts.push(h);
      expect(registered!.name).toBe("script_lsp");
      expect(registered!.def.description).toBe(SCRIPT_LSP_DESCRIPTION);
      const out = (await registered!.cb({ action: "status", path: undefined })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(out.isError).toBe(true);
      expect(JSON.parse(out.content[0].text).code).toBe("GATED");
      expect(h.sessionsOpened).toBe(0);
    } finally {
      if (saved !== undefined) process.env[GATE_ENV] = saved;
    }
  });
});

// ── Request checks ───────────────────────────────────────────────────────────

describe("script_lsp prepareRequest", () => {
  const code = (input: Msg) => {
    const p = prepareRequest(input);
    return p.ok ? "ok" : p.error.code;
  };

  it("accepts each action with its keys", () => {
    expect(code({ action: "status" })).toBe("ok");
    expect(code({ action: "diagnostics", path: FILE, limit: 10, cursor: "0:5" })).toBe("ok");
    for (const a of ["hover", "definition", "implementation", "completion", "signature"]) {
      expect(code({ action: a, path: FILE, line: 1, character: 0 }), a).toBe("ok");
    }
  });

  it("normalises backslashes in the path", () => {
    const p = prepareRequest({ action: "diagnostics", path: "Scripts\\Game\\Foo.c" });
    expect(p.ok && p.input.path).toBe("Scripts/Game/Foo.c");
  });

  it("refuses keys an action does not take", () => {
    const p = prepareRequest({ action: "status", path: FILE });
    expect(!p.ok && p.error.message).toMatch(/status does not take path/);
    expect(code({ action: "hover", path: FILE, line: 0, character: 0, cursor: "0:1" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code({ action: "status", bogus: 1 })).toBe("INVALID_ARGUMENT");
  });

  it("refuses a missing path, position, or a non-script file", () => {
    expect(code({ action: "diagnostics" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "hover", path: FILE })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "hover", path: FILE, line: 0 })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "diagnostics", path: "Prefabs/X.et" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "hover", path: FILE, line: -1, character: 0 })).toBe("INVALID_ARGUMENT");
  });

  it("refuses absolute paths and '..'", () => {
    expect(code({ action: "diagnostics", path: "C:/x/Foo.c" })).toBe("ABSOLUTE_PATH");
    expect(code({ action: "diagnostics", path: "/x/Foo.c" })).toBe("ABSOLUTE_PATH");
    expect(code({ action: "diagnostics", path: "$ArmaReforger:Scripts/X.c" })).toBe(
      "ABSOLUTE_PATH",
    );
    expect(code({ action: "diagnostics", path: "Scripts/../../Foo.c" })).toBe("ABSOLUTE_PATH");
  });

  it("refuses a bad cursor or limit", () => {
    expect(code({ action: "diagnostics", path: FILE, cursor: "x" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "diagnostics", path: FILE, cursor: "5:2" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "completion", path: FILE, line: 0, character: 0, limit: 201 })).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

// ── Framing ──────────────────────────────────────────────────────────────────

describe("script_lsp framing", () => {
  it("frames with a byte Content-Length (UTF-8)", () => {
    const b = frame({ a: "é" });
    const text = b.toString("utf-8");
    expect(text.startsWith("Content-Length: 10\r\n\r\n")).toBe(true);
    expect(text.endsWith('{"a":"é"}')).toBe(true);
  });

  it("decodes split frames and two frames in one chunk", () => {
    const r = new FrameReader();
    const two = Buffer.concat([frame({ n: 1 }), frame({ n: 2 })]);
    expect(r.push(two.subarray(0, 7))).toEqual([]);
    expect(r.push(two.subarray(7, 30))).toEqual([{ n: 1 }]);
    expect(r.push(two.subarray(30))).toEqual([{ n: 2 }]);
    const r2 = new FrameReader();
    expect(r2.push(Buffer.from("Content-Type: x\r\nContent-Length: 2\r\n\r\n{}"))).toEqual([{}]);
  });

  it("throws on a frame it cannot read", () => {
    expect(() => new FrameReader().push(Buffer.from("X: 1\r\n\r\n{}"))).toThrow(FrameError);
    expect(() => new FrameReader().push(Buffer.from("Content-Length: 2\r\n\r\n{x"))).toThrow(
      FrameError,
    );
    expect(() => new FrameReader().push(Buffer.alloc(5000, 65))).toThrow(FrameError);
  });

  it("closes the session on an unreadable stream", async () => {
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/hover") c.sendRaw(Buffer.from("garbage\r\n\r\n"));
    });
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "hover", path: FILE, line: 0, character: 0 }));
    expect(e.code).toBe("LSP_OFF");
    expect(h.hasSession).toBe(false);
  });
});

// ── Connection and initialize ────────────────────────────────────────────────

describe("script_lsp session", () => {
  it("status: connects to 5776, initializes, answers the capabilities", async () => {
    const srv = fakeServer(() => {});
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "status" }));
    expect(srv.ports).toEqual([LSP_DEFAULT_PORT]);
    expect(rb).toMatchObject({
      host: "127.0.0.1",
      port: 5776,
      connected: true,
      reused: false,
      serverInfo: { name: "fake" },
      capabilities: {
        hover: true,
        definition: true,
        implementation: true,
        completion: true,
        signature: true,
        pullDiagnostics: false,
        textDocumentSync: 1,
      },
    });
    const c = srv.conns[0];
    expect(methods(c)).toEqual(["initialize", "initialized"]);
    const init = c.received[0];
    expect(init.jsonrpc).toBe("2.0");
    const params = init.params as Msg;
    expect(params.rootUri).toBe(pathToFileURL(PROJECT).href);
    const sync = ((params.capabilities as Msg).textDocument as Msg).synchronization as Msg;
    expect(sync.didSave).toBe(false);
    expect(((params.capabilities as Msg).workspace as Msg).applyEdit).toBe(false);
    // A second call reuses the session.
    const rb2 = okRb(await h.run({ action: "status" }));
    expect(rb2.reused).toBe(true);
    expect(h.sessionsOpened).toBe(1);
  });

  it("takes the port from ENFUSION_LSP_PORT and refuses a bad one or the NET port", async () => {
    const srv = fakeServer(() => {});
    const a = host(srv.connector, { env: { ...OPEN_ENV, [PORT_ENV]: "6001" } });
    okRb(await a.h.run({ action: "status" }));
    expect(srv.ports).toEqual([6001]);
    for (const bad of ["0", "70000", "abc"]) {
      const b = host(srv.connector, { env: { ...OPEN_ENV, [PORT_ENV]: bad } });
      const e = err(await b.h.run({ action: "status" }));
      expect(e.code, bad).toBe("INVALID_ARGUMENT");
    }
    const c = host(srv.connector, { env: { ...OPEN_ENV, [PORT_ENV]: "5775" } });
    expect(err(await c.h.run({ action: "status" })).message).toMatch(/NET port/);
    expect(srv.ports).toEqual([6001]);
  });

  it("answers LSP_OFF when nothing listens", async () => {
    const connector: LspConnector = async () => {
      throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    };
    const { h } = host(connector);
    const e = err(await h.run({ action: "status" }));
    expect(e.code).toBe("LSP_OFF");
    expect(e.message).toContain("ECONNREFUSED");
    expect(e.next).toBe(ERROR_CODES.LSP_OFF);
  });

  it("answers LSP_OFF when initialize has no answer (the P-W3-23 kill criterion)", async () => {
    const srv = fakeServer(() => {}, { noInitialize: true });
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "status" }));
    expect(e.code).toBe("LSP_OFF");
    expect(e.message).toMatch(/no answer to initialize within 200 ms/);
    expect(srv.conns[0].destroyed).toBe(true);
    expect(h.hasSession).toBe(false);
  });

  it("answers BUSY when the server closes before answering initialize", async () => {
    const srv = fakeServer(
      (m, c) => {
        if (m.method === "initialize") c.close();
      },
      { noInitialize: true },
    );
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "status" }));
    expect(e.code).toBe("BUSY");
    expect(e.message).toContain("P-W3-25");
  });

  it("answers HANDLER_ERROR when initialize answers an error", async () => {
    const srv = fakeServer(
      (m, c) => {
        if (m.method === "initialize") c.send({ id: m.id, error: { code: -32603, message: "no" } });
      },
      { noInitialize: true },
    );
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "status" }));
    expect(e.code).toBe("HANDLER_ERROR");
    expect(e.message).toContain("-32603");
  });

  it("answers server requests without applying anything", async () => {
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/hover") {
        c.send({ id: 900, method: "workspace/configuration", params: { items: [{}, {}] } });
        c.send({ id: 901, method: "workspace/applyEdit", params: { edit: {} } });
        c.send({ id: 902, method: "client/registerCapability", params: {} });
        setTimeout(() => c.send({ id: m.id, result: null }), 20);
      }
    });
    const { h } = host(srv.connector);
    okRb(await h.run({ action: "hover", path: FILE, line: 0, character: 0 }));
    const answers = srv.conns[0].received.filter((m) => m.method === undefined);
    expect(answers.find((a) => a.id === 900)!.result).toEqual([null, null]);
    expect(answers.find((a) => a.id === 901)!.result).toMatchObject({ applied: false });
    expect(answers.find((a) => a.id === 902)!.result).toBeNull();
    const st = okRb(await h.run({ action: "status" }));
    expect(st.serverRequests).toEqual({
      "workspace/configuration": 1,
      "workspace/applyEdit": 1,
      "client/registerCapability": 1,
    });
  });

  it("close(): didClose of open documents, shutdown, exit; never a save", async () => {
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/hover") c.send({ id: m.id, result: null });
    });
    const { h } = host(srv.connector);
    okRb(await h.run({ action: "hover", path: FILE, line: 0, character: 0 }));
    await h.close();
    const c = srv.conns[0];
    expect(methods(c)).toEqual([
      "initialize",
      "initialized",
      "textDocument/didOpen",
      "textDocument/hover",
      "textDocument/didClose",
      "shutdown",
      "exit",
    ]);
    expect(c.destroyed).toBe(true);
    expect(h.hasSession).toBe(false);
    neverForbidden(c);
  });

  it("closes the session after the idle time", async () => {
    const srv = fakeServer(() => {});
    const { h } = host(srv.connector, { timeouts: { ...FAST, idle: 30 } });
    okRb(await h.run({ action: "status" }));
    await new Promise((r) => setTimeout(r, 120));
    expect(methods(srv.conns[0])).toContain("shutdown");
    expect(methods(srv.conns[0])).toContain("exit");
    expect(h.hasSession).toBe(false);
  });

  it("answers BUSY to a call while another runs", async () => {
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/hover")
        setTimeout(() => c.send({ id: m.id, result: null }), 50);
    });
    const { h } = host(srv.connector);
    const first = h.run({ action: "hover", path: FILE, line: 0, character: 0 });
    const second = await h.run({ action: "status" });
    expect(err(second).code).toBe("BUSY");
    okRb(await first);
    okRb(await h.run({ action: "status" }));
  });

  it("answers WEDGED on a request timeout, closes the session, and reconnects next time", async () => {
    const srv = fakeServer(() => {});
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "hover", path: FILE, line: 0, character: 0 }));
    expect(e.code).toBe("WEDGED");
    expect(e.message).toMatch(/textDocument\/hover within 200 ms/);
    expect(methods(srv.conns[0])).toContain("shutdown");
    expect(h.hasSession).toBe(false);
    okRb(await h.run({ action: "status" }));
    expect(h.sessionsOpened).toBe(2);
  });

  it("answers LSP_OFF when the server drops the connection mid-request", async () => {
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/hover") c.close();
    });
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "hover", path: FILE, line: 0, character: 0 }));
    expect(e.code).toBe("LSP_OFF");
    expect(e.message).toMatch(/closed the connection before answering textDocument\/hover/);
  });
});

// ── Documents ────────────────────────────────────────────────────────────────

describe("script_lsp documents", () => {
  it("refuses a missing file, a position past the end, and no project before connecting", async () => {
    const srv = fakeServer(() => {});
    const { h } = host(srv.connector);
    expect(err(await h.run({ action: "diagnostics", path: "Scripts/Nope.c" })).code).toBe(
      "PATH_NOT_FOUND",
    );
    const past = err(await h.run({ action: "hover", path: FILE, line: 99, character: 0 }));
    expect(past.code).toBe("INVALID_ARGUMENT");
    expect(past.message).toMatch(/past the end of the document/);
    expect(
      err(await h.run({ action: "hover", path: FILE, line: 0, character: 50 })).message,
    ).toMatch(/past the end of line 0/);
    const np = host(srv.connector, { projectPath: "" });
    expect(err(await np.h.run({ action: "diagnostics", path: FILE })).code).toBe("NOT_IN_PROJECT");
    expect(srv.conns).toHaveLength(0);
  });

  it("sends text in memory for an unsaved file, and didChange when the text changes", async () => {
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/hover") c.send({ id: m.id, result: null });
    });
    const { h, reads } = host(srv.connector);
    const r1 = await h.run({
      action: "hover",
      path: "Scripts/New.c",
      text: "class New {}\n",
      line: 0,
      character: 6,
    });
    expect(okRb(r1).sent).toBe("opened");
    expect(r1.warnings.join()).toMatch(/no file was written/);
    expect(reads).toEqual([]);
    okRb(await h.run({ action: "hover", path: FILE, line: 0, character: 0 }));
    expect(reads).toEqual([FILE_ABS]);
    const r3 = okRb(
      await h.run({ action: "hover", path: FILE, text: "class Foo {}\n", line: 0, character: 0 }),
    );
    expect(r3.sent).toBe("changed");
    const r4 = okRb(
      await h.run({ action: "hover", path: FILE, text: "class Foo {}\n", line: 0, character: 0 }),
    );
    expect(r4.sent).toBe("unchanged");
    const c = srv.conns[0];
    const open = c.received.filter((m) => m.method === "textDocument/didOpen");
    expect(open).toHaveLength(2);
    expect(((open[1].params as Msg).textDocument as Msg).text).toBe(FILE_TEXT);
    expect(((open[1].params as Msg).textDocument as Msg).languageId).toBe("enforce");
    const change = c.received.filter((m) => m.method === "textDocument/didChange");
    expect(change).toHaveLength(1);
    expect(change[0].params).toEqual({
      textDocument: { uri: FILE_URI, version: 2 },
      contentChanges: [{ text: "class Foo {}\n" }],
    });
    neverForbidden(c);
  });
});

// ── Actions ──────────────────────────────────────────────────────────────────

const diag = (line: number, severity: number, message: string) => ({
  range: { start: { line, character: 1 }, end: { line, character: 4 } },
  severity,
  message,
  code: 12,
  source: "enforce",
});

describe("script_lsp diagnostics", () => {
  it("push: maps publishDiagnostics, pages them, and refuses a stale cursor", async () => {
    let count = 3;
    const srv = fakeServer((m, c) => {
      if (m.method === "textDocument/didOpen" || m.method === "textDocument/didChange") {
        const uri = ((m.params as Msg).textDocument as Msg).uri as string;
        const list = [diag(0, 1, "E1"), diag(1, 2, "W1"), diag(2, 3, "I1"), diag(3, 4, "H1")];
        c.send({
          method: "textDocument/publishDiagnostics",
          params: { uri, diagnostics: list.slice(0, count) },
        });
      }
    });
    const { h } = host(srv.connector);
    const r = await h.run({ action: "diagnostics", path: FILE, limit: 2 });
    const rb = okRb(r);
    expect(rb).toMatchObject({ path: FILE, mode: "push", sent: "opened", total: 3 });
    expect(rb.rows).toEqual([
      {
        line: 0,
        character: 1,
        endLine: 0,
        endCharacter: 4,
        severity: "error",
        message: "E1",
        code: "12",
        source: "enforce",
      },
      {
        line: 1,
        character: 1,
        endLine: 1,
        endCharacter: 4,
        severity: "warning",
        message: "W1",
        code: "12",
        source: "enforce",
      },
    ]);
    expect(rb.nextCursor).toBe("2:3");
    expect(r.ok && r.next).toContain('cursor "2:3"');
    // The text is unchanged: the stored diagnostics answer the next page at once.
    const p2 = okRb(await h.run({ action: "diagnostics", path: FILE, limit: 2, cursor: "2:3" }));
    expect(p2.sent).toBe("unchanged");
    expect((p2.rows as Msg[]).map((x) => x.severity)).toEqual(["information"]);
    expect(p2.nextCursor).toBeNull();
    // The list grows (new text): the old cursor is stale.
    count = 4;
    const stale = err(
      await h.run({
        action: "diagnostics",
        path: FILE,
        text: FILE_TEXT + "\n",
        limit: 2,
        cursor: "2:3",
      }),
    );
    expect(stale.code).toBe("STALE_CURSOR");
  });

  it("pull: uses textDocument/diagnostic when the server offers it", async () => {
    const srv = fakeServer(
      (m, c) => {
        if (m.method === "textDocument/diagnostic") {
          c.send({ id: m.id, result: { kind: "full", items: [diag(2, 1, "bad type")] } });
        }
      },
      { caps: { ...CAPS, diagnosticProvider: { interFileDependencies: false } } },
    );
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "diagnostics", path: FILE }));
    expect(rb.mode).toBe("pull");
    expect(rb.total).toBe(1);
    expect((rb.rows as Msg[])[0]).toMatchObject({
      line: 2,
      severity: "error",
      message: "bad type",
    });
    const req = srv.conns[0].received.find((m) => m.method === "textDocument/diagnostic")!;
    expect(req.params).toEqual({ textDocument: { uri: FILE_URI } });
  });

  it("pull error: falls back to the pushed diagnostics", async () => {
    const srv = fakeServer(
      (m, c) => {
        if (m.method === "textDocument/diagnostic") {
          c.send({ id: m.id, error: { code: -32601, message: "nope" } });
          c.send({
            method: "textDocument/publishDiagnostics",
            params: { uri: FILE_URI, diagnostics: [diag(0, 2, "W")] },
          });
        }
      },
      { caps: { ...CAPS, diagnosticProvider: {} } },
    );
    const { h } = host(srv.connector);
    const r = await h.run({ action: "diagnostics", path: FILE });
    expect(okRb(r)).toMatchObject({ mode: "push", total: 1 });
    expect(r.warnings.join()).toMatch(/answered error -32601/);
  });

  it("none: no diagnostics in time answers zero rows and names the fallback", async () => {
    const srv = fakeServer(() => {});
    const { h } = host(srv.connector);
    const r = await h.run({ action: "diagnostics", path: FILE });
    expect(okRb(r)).toMatchObject({ mode: "none", total: 0, rows: [], nextCursor: null });
    expect(r.warnings.join()).toMatch(/P-W3-24.*wb_scripts validate/);
  });
});

describe("script_lsp position requests", () => {
  /** A server answering `method` with `result`, recording the request. */
  function answering(method: string, result: unknown) {
    return fakeServer((m, c) => {
      if (m.method === method) c.send({ id: m.id, result });
    });
  }

  it("hover: MarkupContent, MarkedString arrays and null", async () => {
    const srv = answering("textDocument/hover", {
      contents: { kind: "markdown", value: "void Bar(int a, float b)" },
      range: { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } },
    });
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "hover", path: FILE, line: 2, character: 7 }));
    expect(rb).toMatchObject({
      path: FILE,
      line: 2,
      character: 7,
      found: true,
      text: "void Bar(int a, float b)",
      range: { line: 2, character: 6, endLine: 2, endCharacter: 9 },
    });
    const req = srv.conns[0].received.find((m) => m.method === "textDocument/hover")!;
    expect(req.params).toEqual({
      textDocument: { uri: FILE_URI },
      position: { line: 2, character: 7 },
    });
    expect(markupText(["a", { language: "c", value: "b" }])).toBe("a\n\nb");

    const nul = answering("textDocument/hover", null);
    const n = host(nul.connector);
    expect(
      okRb(await n.h.run({ action: "hover", path: FILE, line: 0, character: 0 })),
    ).toMatchObject({ found: false, text: "", range: null });
  });

  it("hover: cuts a very long text with a warning", async () => {
    const srv = answering("textDocument/hover", { contents: "x".repeat(9000) });
    const { h } = host(srv.connector);
    const r = await h.run({ action: "hover", path: FILE, line: 0, character: 0 });
    expect((okRb(r).text as string).length).toBe(8000);
    expect(r.warnings.join()).toMatch(/cut to 8000 of 9000/);
  });

  it("definition: a Location inside the project gives a relative path", async () => {
    const other = pathToFileURL(resolve(PROJECT, "Scripts/Game/Base.c")).href;
    const srv = answering("textDocument/definition", {
      uri: other,
      range: { start: { line: 5, character: 1 }, end: { line: 5, character: 9 } },
    });
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "definition", path: FILE, line: 0, character: 6 }));
    expect(rb.found).toBe(true);
    expect(rb.locations).toEqual([
      {
        path: "Scripts/Game/Base.c",
        uri: other,
        line: 5,
        character: 1,
        endLine: 5,
        endCharacter: 9,
      },
    ]);
  });

  it("implementation: LocationLinks outside the project keep only the uri", async () => {
    const outside = pathToFileURL(resolve(tmpdir(), "elsewhere", "Game.c")).href;
    const srv = answering("textDocument/implementation", [
      {
        targetUri: outside,
        targetRange: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
        targetSelectionRange: { start: { line: 3, character: 2 }, end: { line: 3, character: 5 } },
      },
      { notALocation: true },
    ]);
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "implementation", path: FILE, line: 0, character: 6 }));
    expect(rb.locations).toEqual([
      { path: null, uri: outside, line: 3, character: 2, endLine: 3, endCharacter: 5 },
    ]);
    const none = answering("textDocument/implementation", null);
    const n = host(none.connector);
    expect(
      okRb(await n.h.run({ action: "implementation", path: FILE, line: 0, character: 0 })),
    ).toMatchObject({ found: false, locations: [] });
  });

  it("completion: maps kinds and pages a CompletionList", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      label: `Item${i}`,
      kind: i % 2 ? 2 : 7,
      detail: i === 0 ? "class" : undefined,
    }));
    const srv = answering("textDocument/completion", { isIncomplete: true, items });
    const { h } = host(srv.connector);
    const r = await h.run({ action: "completion", path: FILE, line: 2, character: 1, limit: 2 });
    const rb = okRb(r);
    expect(rb).toMatchObject({ isIncomplete: true, total: 5, nextCursor: "2:5" });
    expect(rb.rows).toEqual([
      { label: "Item0", kind: "class", detail: "class" },
      { label: "Item1", kind: "method", detail: null },
    ]);
    expect(r.ok && r.next).toContain('cursor "2:5"');
    const p3 = okRb(
      await h.run({
        action: "completion",
        path: FILE,
        line: 2,
        character: 1,
        limit: 2,
        cursor: "4:5",
      }),
    );
    expect((p3.rows as Msg[]).map((x) => x.label)).toEqual(["Item4"]);
    expect(p3.nextCursor).toBeNull();
    const stale = err(
      await h.run({
        action: "completion",
        path: FILE,
        line: 2,
        character: 1,
        cursor: "2:9",
      }),
    );
    expect(stale.code).toBe("STALE_CURSOR");
  });

  it("completion: a bare item array", async () => {
    const srv = answering("textDocument/completion", [{ label: "a", kind: 99 }]);
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "completion", path: FILE, line: 0, character: 0 }));
    expect(rb).toMatchObject({ isIncomplete: false, total: 1 });
    expect(rb.rows).toEqual([{ label: "a", kind: null, detail: null }]);
  });

  it("signature: labels, offset parameter labels and the active indices", async () => {
    const label = "void Bar(int a, float b)";
    const srv = answering("textDocument/signatureHelp", {
      signatures: [
        {
          label,
          documentation: { kind: "plaintext", value: "Does bar." },
          parameters: [{ label: [9, 14] }, { label: "float b" }],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    });
    const { h } = host(srv.connector);
    const rb = okRb(await h.run({ action: "signature", path: FILE, line: 2, character: 10 }));
    expect(rb).toMatchObject({
      found: true,
      activeSignature: 0,
      activeParameter: 1,
      signatures: [{ label, documentation: "Does bar.", parameters: ["int a", "float b"] }],
    });
    const req = srv.conns[0].received.find((m) => m.method === "textDocument/signatureHelp");
    expect(req).toBeDefined();
  });

  it("warns when the server did not announce the capability, and maps -32601", async () => {
    const srv = fakeServer(
      (m, c) => {
        if (m.method === "textDocument/implementation") {
          c.send({ id: m.id, error: { code: -32601, message: "Unhandled method" } });
        }
        if (m.method === "textDocument/definition") {
          c.send({ id: m.id, error: { code: -32603, message: "boom" } });
        }
      },
      { caps: { hoverProvider: true } },
    );
    const { h } = host(srv.connector);
    const e = err(await h.run({ action: "implementation", path: FILE, line: 0, character: 0 }));
    expect(e.code).toBe("HANDLER_ERROR");
    expect(e.message).toBe(
      "the language server does not implement textDocument/implementation (-32601)",
    );
    const e2 = err(await h.run({ action: "definition", path: FILE, line: 0, character: 0 }));
    expect(e2.message).toMatch(/error -32603: boom/);
    // The session survives an error answer.
    expect(h.sessionsOpened).toBe(1);
  });
});

// ── The real TCP connector, against a loopback fake ──────────────────────────

describe("script_lsp over TCP (loopback fake, no Workbench)", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
  });

  it("speaks JSON-RPC over a socket and shuts down", async () => {
    const seen: string[] = [];
    server = createServer((sock) => {
      const reader = new FrameReader();
      sock.on("data", (d) => {
        for (const m of reader.push(d) as Msg[]) {
          seen.push(String(m.method));
          if (m.method === "initialize") {
            sock.write(frame({ jsonrpc: "2.0", id: m.id, result: { capabilities: CAPS } }));
          } else if (m.method === "shutdown") {
            sock.write(frame({ jsonrpc: "2.0", id: m.id, result: null }));
          } else if (m.method === "exit") sock.end();
        }
      });
    });
    const port = await new Promise<number>((r) =>
      server!.listen(0, "127.0.0.1", () => r((server!.address() as { port: number }).port)),
    );
    const { h } = host(netConnector, { env: { ...OPEN_ENV, [PORT_ENV]: String(port) } });
    const rb = okRb(await h.run({ action: "status" }));
    expect(rb.port).toBe(port);
    await h.close();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual(["initialize", "initialized", "shutdown", "exit"]);
  });

  it("answers LSP_OFF on a closed port", async () => {
    server = createServer();
    const port = await new Promise<number>((r) =>
      server!.listen(0, "127.0.0.1", () => r((server!.address() as { port: number }).port)),
    );
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    const { h } = host(netConnector, {
      env: { ...OPEN_ENV, [PORT_ENV]: String(port) },
      timeouts: { ...FAST, connect: 2000 },
    });
    const e = err(await h.run({ action: "status" }));
    expect(e.code).toBe("LSP_OFF");
    expect(e.message).toContain(`127.0.0.1:${port}`);
  });
});
