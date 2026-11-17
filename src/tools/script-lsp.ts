/**
 * `script_lsp`: a read-only client of the Workbench's own language server (the Script Editor's
 * LSP, JSON-RPC 2.0 over TCP on 127.0.0.1, ini keys `LSP_Enabled`/`LSP_Port`, default port 5776),
 * wave W3 (phase5-w3-spec.md section 2.4).
 *
 *   status          connect (or reuse the session), initialize, answer the server's capabilities
 *   diagnostics     didOpen (or didChange) of the file, then textDocument/diagnostic when the
 *                   server offers it, else the next textDocument/publishDiagnostics; paged
 *   hover           textDocument/hover
 *   definition      textDocument/definition
 *   implementation  textDocument/implementation
 *   completion      textDocument/completion; paged
 *   signature       textDocument/signatureHelp
 *
 * GATED (ruling W3 OD-6, DEC-063): U20 is reopened, because the recorded LSP answer of DEC-053
 * was a null result. Every action answers GATED with the reason until the main session sets the
 * environment variable ENFUSION_SCRIPT_LSP=1 after probe P-W3-23 passes. While gated nothing is
 * read, nothing connects and no session object exists.
 *
 * Behind the gate:
 * - One session at a time, one call at a time: a call while another runs answers BUSY. A server
 *   that closes the connection before answering initialize answers BUSY too (another client may
 *   hold it; P-W3-25 decides whether a second client is served).
 * - The client never sends didSave, willSave or willSaveWaitUntil and never writes a file.
 *   `text` is sent as the document's in-memory content (didOpen, or didChange when the document
 *   is open with other text). A server request to apply an edit is answered `applied: false`.
 * - The session closes after an idle time, or on `closeScriptLspSessions()`: didClose of every
 *   open document, `shutdown`, `exit`, then the socket (P-W3-25 checks the Workbench survives).
 * - A request with no answer in time answers WEDGED and the session is closed; nothing is retried.
 * - Lines and characters are 0-based (LSP positions, as wb_script_editor's lines).
 *
 * The tool has no Workbench handler and no contract: its description is the constant below and
 * stays within the 400-character cap. Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { Config } from "../config.js";
import { DESCRIPTION_MAX } from "../manifest/generate.js";
import {
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  nextCursor,
  parseCursor,
  type ActionOk,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { isPathInsideRoot } from "../utils/path-guard.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const TOOL_NAME = "script_lsp";

export const SCRIPT_LSP_ACTIONS = [
  "status",
  "diagnostics",
  "hover",
  "definition",
  "implementation",
  "completion",
  "signature",
] as const;
export type ScriptLspAction = (typeof SCRIPT_LSP_ACTIONS)[number];

/** The configuration switch: "1" opens the gate. The main session sets it after P-W3-23. */
export const GATE_ENV = "ENFUSION_SCRIPT_LSP";
/** The LSP port (the ini key LSP_Port); 5776 when unset. */
export const PORT_ENV = "ENFUSION_LSP_PORT";
export const LSP_HOST = "127.0.0.1";
export const LSP_DEFAULT_PORT = 5776;

/** LSP_OFF (phase5-w3-spec.md section 1) is in the shared vocabulary. */
export type ScriptLspCode = ErrorCode;

export const GATE_REASON =
  "script_lsp waits for probe P-W3-23: the Workbench language server's answer to initialize is unproven (U20 reopened, W3 OD-6); nothing was sent";
export const GATE_NEXT = `The main session sets ${GATE_ENV}=1 once P-W3-23 passes. Until then: wb_scripts validate for diagnostics; api_search, script_class_hierarchy and script_overrides for symbols.`;

export const SCRIPT_LSP_DESCRIPTION =
  "Read-only client of the Workbench language server (Script Editor LSP on 127.0.0.1, port LSP_Port, default 5776). " +
  "Actions: status, diagnostics, hover, definition, implementation, completion, signature on a project .c " +
  "(path; 0-based line and character; text = unsaved content, never written). " +
  `GATED until probe P-W3-23 passes and ${GATE_ENV}=1; LSP_OFF while the port is closed.`;

/** Every timeout of the client, in ms. */
export interface LspTimeouts {
  connect: number;
  initialize: number;
  request: number;
  diagnostics: number;
  shutdown: number;
  idle: number;
}

export const DEFAULT_TIMEOUTS: LspTimeouts = {
  connect: 5_000,
  initialize: 30_000,
  request: 15_000,
  diagnostics: 10_000,
  shutdown: 3_000,
  idle: 120_000,
};

/** Never sent by this client (the file is never written through the server). */
export const FORBIDDEN_METHODS: ReadonlySet<string> = new Set([
  "textDocument/didSave",
  "textDocument/willSave",
  "textDocument/willSaveWaitUntil",
  "workspace/executeCommand",
]);

/** The longest hover or documentation text answered (longer text is cut, with a warning). */
export const TEXT_MAX = 8_000;
/** The largest frame accepted from the server. */
export const FRAME_MAX = 64 * 1024 * 1024;

// ── Framing ──────────────────────────────────────────────────────────────────

export function frame(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf-8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

export class FrameError extends Error {}

/** Incremental Content-Length decoder. Throws FrameError on a frame it cannot read. */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: unknown[] = [];
    for (;;) {
      const sepAt = this.buf.indexOf("\r\n\r\n");
      if (sepAt === -1) {
        if (this.buf.length > 4096) throw new FrameError("LSP header longer than 4096 bytes");
        break;
      }
      const header = this.buf.subarray(0, sepAt).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) throw new FrameError("LSP frame without Content-Length");
      const len = Number(m[1]);
      if (len > FRAME_MAX) throw new FrameError(`LSP frame of ${len} bytes is over the limit`);
      if (this.buf.length < sepAt + 4 + len) break;
      const body = this.buf.subarray(sepAt + 4, sepAt + 4 + len).toString("utf-8");
      this.buf = this.buf.subarray(sepAt + 4 + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        throw new FrameError("LSP frame body is not JSON");
      }
    }
    return out;
  }
}

// ── Transport ────────────────────────────────────────────────────────────────

/** The byte stream to the server (a TCP socket; a fake in tests). */
export interface LspTransport {
  write(data: Buffer): void;
  onData(cb: (d: Buffer) => void): void;
  onClose(cb: () => void): void;
  destroy(): void;
}

/** Opens a transport; rejects with an Error whose `code` names the failure (ECONNREFUSED...). */
export type LspConnector = (host: string, port: number, timeoutMs: number) => Promise<LspTransport>;

export const netConnector: LspConnector = (host, port, timeoutMs) =>
  new Promise((res, rej) => {
    const s = connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      rej(Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" }));
    }, timeoutMs);
    s.once("error", (e) => {
      clearTimeout(t);
      rej(e);
    });
    s.once("connect", () => {
      clearTimeout(t);
      s.removeAllListeners("error");
      s.on("error", () => s.destroy());
      res({
        write: (d) => {
          s.write(d);
        },
        onData: (cb) => {
          s.on("data", cb);
        },
        onClose: (cb) => {
          s.on("close", cb);
        },
        destroy: () => {
          s.destroy();
        },
      });
    });
  });

// ── JSON-RPC session ─────────────────────────────────────────────────────────

export class LspTimeout extends Error {
  constructor(
    readonly method: string,
    readonly ms: number,
  ) {
    super(`no answer to ${method} within ${ms} ms`);
  }
}

export class LspClosed extends Error {
  constructor(readonly method: string) {
    super(`the language server closed the connection before answering ${method}`);
  }
}

export interface RpcError {
  code: number;
  message: string;
}

export type RpcAnswer = { result: unknown } | { error: RpcError };

interface Pending {
  method: string;
  resolve: (a: RpcAnswer) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Published {
  seq: number;
  diagnostics: unknown[];
}

/** One JSON-RPC connection to the language server. */
export class LspSession {
  private reader = new FrameReader();
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private published = new Map<string, Published>();
  private publishSeq = 0;
  private diagWaiters: Array<() => void> = [];
  private docs = new Map<string, { version: number; text: string }>();
  closed = false;
  capabilities: Record<string, unknown> = {};
  serverInfo: unknown = null;
  /** Methods of the server-to-client requests answered, with counts. */
  readonly serverRequests: Record<string, number> = {};
  readonly openedAt = Date.now();

  constructor(private readonly transport: LspTransport) {
    transport.onData((d) => this.onData(d));
    transport.onClose(() => this.onClose());
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new LspClosed(p.method));
    }
    this.pending.clear();
    for (const w of this.diagWaiters.splice(0)) w();
  }

  private onData(d: Buffer): void {
    let msgs: unknown[];
    try {
      msgs = this.reader.push(d);
    } catch {
      // An unreadable stream: the session cannot be trusted any more.
      this.destroy();
      return;
    }
    for (const raw of msgs) {
      if (raw === null || typeof raw !== "object") continue;
      const m = raw as Record<string, unknown>;
      const method = typeof m.method === "string" ? m.method : undefined;
      if (method !== undefined && m.id !== undefined) this.answerServer(method, m.id, m.params);
      else if (method !== undefined) this.onNotification(method, m.params);
      else if (typeof m.id === "number" && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error && typeof m.error === "object") {
          const e = m.error as Record<string, unknown>;
          p.resolve({
            error: {
              code: typeof e.code === "number" ? e.code : 0,
              message: typeof e.message === "string" ? e.message : "",
            },
          });
        } else p.resolve({ result: m.result ?? null });
      }
    }
  }

  /** A server-to-client request: answered without reading or writing anything. */
  private answerServer(method: string, id: unknown, params: unknown): void {
    this.serverRequests[method] = (this.serverRequests[method] ?? 0) + 1;
    let result: unknown = null;
    if (method === "workspace/configuration") {
      const items = (params as { items?: unknown[] } | undefined)?.items;
      result = Array.isArray(items) ? items.map(() => null) : [];
    } else if (method === "workspace/applyEdit") {
      result = { applied: false, failureReason: "this client never applies edits" };
    } else if (method === "workspace/workspaceFolders") {
      result = null;
    }
    this.send({ jsonrpc: "2.0", id, result });
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== "textDocument/publishDiagnostics") return;
    const p = (params ?? {}) as { uri?: unknown; diagnostics?: unknown };
    if (typeof p.uri !== "string") return;
    this.publishSeq++;
    this.published.set(uriKey(p.uri), {
      seq: this.publishSeq,
      diagnostics: Array.isArray(p.diagnostics) ? p.diagnostics : [],
    });
    for (const w of this.diagWaiters.splice(0)) w();
  }

  private send(msg: Record<string, unknown>): void {
    const method = typeof msg.method === "string" ? msg.method : null;
    if (method && FORBIDDEN_METHODS.has(method)) {
      throw new Error(`refused: ${method} is never sent by this client`);
    }
    if (this.closed) return;
    this.transport.write(frame(msg));
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Resolves with the answer; rejects LspTimeout or LspClosed. */
  request(method: string, params: unknown, timeoutMs: number): Promise<RpcAnswer> {
    if (this.closed) return Promise.reject(new LspClosed(method));
    const id = this.nextId++;
    return new Promise<RpcAnswer>((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new LspTimeout(method, timeoutMs));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: res, reject: rej, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** initialize, then initialized. Answers the InitializeResult or the server's error. */
  async initialize(rootUri: string | null, timeoutMs: number): Promise<RpcAnswer> {
    const a = await this.request("initialize", initializeParams(rootUri), timeoutMs);
    if ("result" in a) {
      const r = (a.result ?? {}) as Record<string, unknown>;
      this.capabilities =
        r.capabilities && typeof r.capabilities === "object"
          ? (r.capabilities as Record<string, unknown>)
          : {};
      this.serverInfo = r.serverInfo ?? null;
      this.notify("initialized", {});
    }
    return a;
  }

  /** The publishDiagnostics sequence number of a uri (0 when none came). */
  publishedSeq(uri: string): number {
    return this.published.get(uriKey(uri))?.seq ?? 0;
  }

  publishedDiagnostics(uri: string): unknown[] | undefined {
    return this.published.get(uriKey(uri))?.diagnostics;
  }

  /** Waits until a publishDiagnostics for `uri` newer than `afterSeq` arrives, or the time ends. */
  async waitPublished(uri: string, afterSeq: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.publishedSeq(uri) > afterSeq) return true;
      const left = deadline - Date.now();
      if (left <= 0 || this.closed) return false;
      await new Promise<void>((res) => {
        const t = setTimeout(() => {
          const i = this.diagWaiters.indexOf(done);
          if (i >= 0) this.diagWaiters.splice(i, 1);
          res();
        }, left);
        const done = () => {
          clearTimeout(t);
          res();
        };
        this.diagWaiters.push(done);
      });
    }
  }

  /**
   * Makes the server's copy of the document equal `text`: didOpen when it is not open, didChange
   * (full text) when it is open with other text. Answers what was sent.
   */
  sync(uri: string, text: string): "opened" | "changed" | "unchanged" {
    const doc = this.docs.get(uri);
    if (!doc) {
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "enforce", version: 1, text },
      });
      this.docs.set(uri, { version: 1, text });
      return "opened";
    }
    if (doc.text === text) return "unchanged";
    doc.version++;
    doc.text = text;
    this.notify("textDocument/didChange", {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }],
    });
    return "changed";
  }

  get openDocuments(): number {
    return this.docs.size;
  }

  /** didClose of every open document, shutdown, exit, then the socket. Never throws. */
  async close(shutdownMs: number): Promise<{ shutdown: "answered" | "no-answer" | "closed" }> {
    if (this.closed) return { shutdown: "closed" };
    let shutdown: "answered" | "no-answer" | "closed" = "no-answer";
    try {
      for (const uri of this.docs.keys()) {
        this.notify("textDocument/didClose", { textDocument: { uri } });
      }
      this.docs.clear();
      await this.request("shutdown", null, shutdownMs);
      shutdown = "answered";
      this.notify("exit", null);
    } catch (e) {
      shutdown = e instanceof LspClosed ? "closed" : "no-answer";
    }
    this.destroy();
    return { shutdown };
  }

  /** Drops the connection without the shutdown sequence. */
  destroy(): void {
    this.transport.destroy();
    this.onClose();
  }
}

function initializeParams(rootUri: string | null): Record<string, unknown> {
  return {
    processId: process.pid,
    clientInfo: { name: "enfusion-mcp" },
    rootUri,
    capabilities: {
      textDocument: {
        synchronization: { didSave: false, willSave: false, willSaveWaitUntil: false },
        hover: { contentFormat: ["markdown", "plaintext"] },
        definition: { linkSupport: true },
        implementation: { linkSupport: true },
        completion: { completionItem: { snippetSupport: false } },
        signatureHelp: {
          signatureInformation: { parameterInformation: { labelOffsetSupport: true } },
        },
        publishDiagnostics: {},
        diagnostic: {},
      },
      workspace: { applyEdit: false, configuration: false, workspaceFolders: false },
    },
  };
}

/** A comparable form of a file URI (decoded; case-folded on Windows). */
export function uriKey(uri: string): string {
  try {
    const p = resolve(fileURLToPath(uri));
    return process.platform === "win32" ? p.toLowerCase() : p;
  } catch {
    return uri;
  }
}

// ── Responses ────────────────────────────────────────────────────────────────

export interface ScriptLspError {
  ok: false;
  action: string;
  target: string;
  code: ScriptLspCode;
  message: string;
  next: string;
  warnings: string[];
}

export type ScriptLspResponse = ActionOk | ScriptLspError;

function defaultNext(code: ScriptLspCode): string {
  return ERROR_CODES[code];
}

function fail(
  action: string,
  target: string,
  code: ScriptLspCode,
  message: string,
  next?: string,
): ScriptLspError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || defaultNext(code),
    warnings: [],
  };
}

class Refusal extends Error {
  constructor(
    readonly code: ScriptLspCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
  }
}

export function toToolResult(r: ScriptLspResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Request checks ───────────────────────────────────────────────────────────

export const INPUT_SCHEMA = z
  .object({
    action: z.enum(SCRIPT_LSP_ACTIONS),
    path: z.string().optional(),
    text: z.string().max(4_000_000).optional(),
    line: z.number().int().min(0).optional(),
    character: z.number().int().min(0).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(LIMIT_MAX).optional(),
  })
  .strict();
export type ScriptLspInput = z.infer<typeof INPUT_SCHEMA>;

const POSITION_ACTIONS: ReadonlySet<string> = new Set([
  "hover",
  "definition",
  "implementation",
  "completion",
  "signature",
]);
const PAGED_ACTIONS: ReadonlySet<string> = new Set(["diagnostics", "completion"]);

/** The keys each action takes besides `action`. */
export const ACTION_KEYS: Readonly<Record<ScriptLspAction, readonly string[]>> = {
  status: [],
  diagnostics: ["path", "text", "cursor", "limit"],
  hover: ["path", "text", "line", "character"],
  definition: ["path", "text", "line", "character"],
  implementation: ["path", "text", "line", "character"],
  completion: ["path", "text", "line", "character", "cursor", "limit"],
  signature: ["path", "text", "line", "character"],
};

/** A checked request (no I/O has happened yet). */
export type Prepared =
  | { ok: true; action: ScriptLspAction; target: string; input: ScriptLspInput }
  | { ok: false; error: ScriptLspError };

function targetOf(raw: Record<string, unknown>): string {
  return typeof raw.path === "string" && raw.path !== "" ? `path:${raw.path}` : "lsp";
}

/** The gate: null when open, else the reason. */
export function gateReason(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[GATE_ENV] === "1" ? null : GATE_REASON;
}

/** Checks a request against the action's keys and the shared rules. Nothing is read or sent. */
export function prepareRequest(input: unknown): Prepared {
  const raw = (input ?? {}) as Record<string, unknown>;
  const action = typeof raw.action === "string" ? raw.action : "";
  const target = targetOf(raw);
  if (!(SCRIPT_LSP_ACTIONS as readonly string[]).includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `unknown action '${action}'; one of ${SCRIPT_LSP_ACTIONS.join(", ")}`,
      ),
    };
  }
  const parsed = INPUT_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data;
  const a = req.action;
  const allowed = new Set(ACTION_KEYS[a]);
  const extra = Object.keys(req).filter((k) => k !== "action" && !allowed.has(k));
  if (extra.length) {
    return {
      ok: false,
      error: fail(
        a,
        target,
        "INVALID_ARGUMENT",
        `${a} does not take ${extra.join(", ")}${allowed.size ? `; it takes ${[...allowed].join(", ")}` : ""}`,
      ),
    };
  }
  if (a !== "status" && (req.path === undefined || req.path.trim() === "")) {
    return {
      ok: false,
      error: fail(a, target, "INVALID_ARGUMENT", `${a} needs path: a project-relative .c file`),
    };
  }
  if (POSITION_ACTIONS.has(a) && (req.line === undefined || req.character === undefined)) {
    return {
      ok: false,
      error: fail(a, target, "INVALID_ARGUMENT", `${a} needs line and character (both 0-based)`),
    };
  }
  if (req.path !== undefined) {
    let rel: string;
    try {
      rel = checkRelativePath(req.path);
    } catch (e) {
      if (e instanceof VocabularyError) {
        return { ok: false, error: fail(a, target, e.code, e.message) };
      }
      throw e;
    }
    if (!rel.toLowerCase().endsWith(".c")) {
      return {
        ok: false,
        error: fail(a, target, "INVALID_ARGUMENT", `path must be an Enforce script (.c): ${rel}`),
      };
    }
    req.path = rel;
  }
  if (PAGED_ACTIONS.has(a) && typeof req.cursor === "string" && req.cursor !== "") {
    try {
      parseCursor(req.cursor);
    } catch (e) {
      if (e instanceof VocabularyError) {
        return { ok: false, error: fail(a, target, e.code, e.message) };
      }
      throw e;
    }
  }
  return { ok: true, action: a, target: targetOf(req), input: req };
}

// ── Answer shaping ───────────────────────────────────────────────────────────

const SEVERITY = ["", "error", "warning", "information", "hint"];

const COMPLETION_KIND = [
  "",
  "text",
  "method",
  "function",
  "constructor",
  "field",
  "variable",
  "class",
  "interface",
  "module",
  "property",
  "unit",
  "value",
  "enum",
  "keyword",
  "snippet",
  "color",
  "file",
  "reference",
  "folder",
  "enumMember",
  "constant",
  "struct",
  "event",
  "operator",
  "typeParameter",
];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

interface Span {
  line: number | null;
  character: number | null;
  endLine: number | null;
  endCharacter: number | null;
}

function spanOf(range: unknown): Span {
  const r = obj(range);
  const s = obj(r.start);
  const e = obj(r.end);
  return {
    line: num(s.line),
    character: num(s.character),
    endLine: num(e.line),
    endCharacter: num(e.character),
  };
}

export interface DiagnosticRow extends Span {
  severity: string;
  message: string;
  code: string | null;
  source: string | null;
}

export function mapDiagnostics(list: unknown[]): DiagnosticRow[] {
  return list.map((d) => {
    const o = obj(d);
    const sev = num(o.severity);
    return {
      ...spanOf(o.range),
      severity: sev !== null && SEVERITY[sev] ? SEVERITY[sev] : "unknown",
      message: str(o.message),
      code: typeof o.code === "string" || typeof o.code === "number" ? String(o.code) : null,
      source: typeof o.source === "string" ? o.source : null,
    };
  });
}

/** MarkupContent | MarkedString | MarkedString[] as plain text. */
export function markupText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v))
    return v
      .map(markupText)
      .filter((s) => s !== "")
      .join("\n\n");
  const o = obj(v);
  return str(o.value);
}

function cut(text: string, what: string, warnings: string[]): string {
  if (text.length <= TEXT_MAX) return text;
  warnings.push(`${what} was cut to ${TEXT_MAX} of ${text.length} characters`);
  return text.slice(0, TEXT_MAX);
}

export interface LocationRow extends Span {
  /** Project-relative path when the file is inside the project, else null. */
  path: string | null;
  uri: string;
}

/** Location | Location[] | LocationLink[] | null as rows. */
export function mapLocations(result: unknown, projectRoot: string): LocationRow[] {
  if (result === null || result === undefined) return [];
  const list = Array.isArray(result) ? result : [result];
  const rows: LocationRow[] = [];
  for (const item of list) {
    const o = obj(item);
    const uri = str(o.uri) || str(o.targetUri);
    if (!uri) continue;
    const range = o.uri !== undefined ? o.range : (o.targetSelectionRange ?? o.targetRange);
    rows.push({ path: projectPathOf(uri, projectRoot), uri, ...spanOf(range) });
  }
  return rows;
}

function projectPathOf(uri: string, projectRoot: string): string | null {
  if (!projectRoot) return null;
  let abs: string;
  try {
    abs = fileURLToPath(uri);
  } catch {
    return null;
  }
  const root = resolve(projectRoot);
  if (!isPathInsideRoot(resolve(abs), root)) return null;
  return relative(root, resolve(abs)).split(sep).join("/");
}

export interface CompletionRow {
  label: string;
  kind: string | null;
  detail: string | null;
}

export function mapCompletion(result: unknown): { items: CompletionRow[]; isIncomplete: boolean } {
  const list = Array.isArray(result) ? result : obj(result).items;
  const isIncomplete = !Array.isArray(result) && obj(result).isIncomplete === true;
  const items = (Array.isArray(list) ? list : []).map((it) => {
    const o = obj(it);
    const k = num(o.kind);
    return {
      label: str(o.label),
      kind: k !== null && COMPLETION_KIND[k] ? COMPLETION_KIND[k] : null,
      detail: typeof o.detail === "string" ? o.detail : null,
    };
  });
  return { items, isIncomplete };
}

export interface SignatureRow {
  label: string;
  documentation: string;
  parameters: string[];
}

export function mapSignatures(result: unknown): {
  signatures: SignatureRow[];
  activeSignature: number | null;
  activeParameter: number | null;
} {
  const r = obj(result);
  const sigs = Array.isArray(r.signatures) ? r.signatures : [];
  return {
    signatures: sigs.map((s) => {
      const o = obj(s);
      const label = str(o.label);
      const params = Array.isArray(o.parameters) ? o.parameters : [];
      return {
        label,
        documentation: markupText(o.documentation),
        parameters: params.map((p) => {
          const l = obj(p).label;
          if (Array.isArray(l) && l.length === 2 && typeof l[0] === "number") {
            return label.slice(l[0], Number(l[1]));
          }
          return str(l);
        }),
      };
    }),
    activeSignature: num(r.activeSignature),
    activeParameter: num(r.activeParameter),
  };
}

/** Which of the requests the server says it serves (from its InitializeResult). */
export function capabilitySummary(c: Record<string, unknown>): Record<string, boolean | number> {
  const has = (k: string) => c[k] !== undefined && c[k] !== null && c[k] !== false;
  const sync = c.textDocumentSync;
  return {
    hover: has("hoverProvider"),
    definition: has("definitionProvider"),
    implementation: has("implementationProvider"),
    completion: has("completionProvider"),
    signature: has("signatureHelpProvider"),
    pullDiagnostics: has("diagnosticProvider"),
    textDocumentSync: typeof sync === "number" ? sync : (num(obj(sync).change) ?? 0),
  };
}

const CAPABILITY_OF: Partial<Record<ScriptLspAction, string>> = {
  hover: "hoverProvider",
  definition: "definitionProvider",
  implementation: "implementationProvider",
  completion: "completionProvider",
  signature: "signatureHelpProvider",
};

const METHOD_OF: Partial<Record<ScriptLspAction, string>> = {
  hover: "textDocument/hover",
  definition: "textDocument/definition",
  implementation: "textDocument/implementation",
  completion: "textDocument/completion",
  signature: "textDocument/signatureHelp",
};

function page<T>(
  rows: T[],
  cursorRaw: string | undefined,
  limitIn: number | undefined,
): { rows: T[]; total: number; nextCursor: string | null } {
  const total = rows.length;
  const limit = limitIn ?? LIMIT_DEFAULT;
  let start = 0;
  if (cursorRaw) {
    const c = parseCursor(cursorRaw);
    checkCursor(c, total);
    start = c.start;
  }
  return {
    rows: rows.slice(start, start + limit),
    total,
    nextCursor: nextCursor(start, limit, total) ?? null,
  };
}

// ── Host: the gate, the one session, the calls ───────────────────────────────

export interface ScriptLspDeps {
  /** The project folder (config.projectPath); the files the actions read lie under it. */
  projectPath: string;
  /** The Workbench NET port: the LSP port must differ from it. */
  netPort?: number;
  /** Read at every call (the gate and the port). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  connector?: LspConnector;
  readFile?: (absPath: string) => string;
  fileExists?: (absPath: string) => boolean;
  timeouts?: Partial<LspTimeouts>;
}

/** The port from the environment, or a refusal text. */
export function portOf(env: NodeJS.ProcessEnv, netPort?: number): number | string {
  const raw = env[PORT_ENV];
  let port = LSP_DEFAULT_PORT;
  if (raw !== undefined && raw !== "") {
    if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
      return `${PORT_ENV} must be a port number (1 to 65535), got '${raw}'`;
    }
    port = Number(raw);
  }
  if (netPort !== undefined && port === netPort) {
    return `the LSP port ${port} is the Workbench NET port; the LSP_Port ini key holds another port (default ${LSP_DEFAULT_PORT})`;
  }
  return port;
}

/** Owns the gate check, the single session and its idle close. */
export class ScriptLspHost {
  private session: LspSession | null = null;
  private sessionPort: number | null = null;
  private busy = false;
  private idleTimer: NodeJS.Timeout | null = null;
  readonly timeouts: LspTimeouts;
  private readonly connector: LspConnector;
  private readonly readFile: (p: string) => string;
  private readonly fileExists: (p: string) => boolean;
  /** How many sessions were opened (tests read it: none while gated). */
  sessionsOpened = 0;

  constructor(private readonly deps: ScriptLspDeps) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(deps.timeouts ?? {}) };
    this.connector = deps.connector ?? netConnector;
    this.readFile = deps.readFile ?? ((p) => readFileSync(p, "utf-8"));
    this.fileExists = deps.fileExists ?? existsSync;
  }

  get hasSession(): boolean {
    return this.session !== null && !this.session.closed;
  }

  /** Runs one request end to end; never throws. */
  async run(input: unknown): Promise<ScriptLspResponse> {
    const raw = (input ?? {}) as Record<string, unknown>;
    const action = typeof raw.action === "string" ? raw.action : "";
    if (
      (SCRIPT_LSP_ACTIONS as readonly string[]).includes(action) &&
      gateReason(this.deps.env ?? process.env)
    ) {
      return fail(action, targetOf(raw), "GATED", GATE_REASON, GATE_NEXT);
    }
    const prepared = prepareRequest(input);
    if (!prepared.ok) return prepared.error;
    const { action: a, target, input: req } = prepared;
    if (this.busy) {
      return fail(
        a,
        target,
        "BUSY",
        "another script_lsp call is running: one session, one call at a time",
        "Retry when the other call has answered.",
      );
    }
    this.busy = true;
    this.clearIdle();
    try {
      return await this.dispatch(a, target, req);
    } catch (e) {
      if (e instanceof Refusal) return fail(a, target, e.code, e.message, e.next);
      if (e instanceof VocabularyError) return fail(a, target, e.code, e.message);
      if (e instanceof LspTimeout) {
        await this.dropSession();
        return fail(
          a,
          target,
          "WEDGED",
          `${e.message}; the session was closed and nothing is retried`,
          "Check the Workbench window (a modal dialog, a script compile); the next call opens a new session.",
        );
      }
      if (e instanceof LspClosed) {
        this.session = null;
        return fail(a, target, "LSP_OFF", e.message);
      }
      return fail(a, target, "HANDLER_ERROR", e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
      this.armIdle();
    }
  }

  /** Closes the session gracefully (didClose, shutdown, exit). Safe to call at any time. */
  async close(): Promise<void> {
    this.clearIdle();
    await this.dropSession();
  }

  private async dropSession(): Promise<void> {
    const s = this.session;
    this.session = null;
    this.sessionPort = null;
    if (s) await s.close(this.timeouts.shutdown);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armIdle(): void {
    if (!this.hasSession) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.busy) void this.dropSession();
    }, this.timeouts.idle);
    this.idleTimer.unref?.();
  }

  private async ensureSession(): Promise<{ s: LspSession; port: number; reused: boolean }> {
    const port = portOf(this.deps.env ?? process.env, this.deps.netPort);
    if (typeof port === "string") throw new Refusal("INVALID_ARGUMENT", port);
    if (this.session && !this.session.closed && this.sessionPort === port) {
      return { s: this.session, port, reused: true };
    }
    if (this.session) await this.dropSession();
    let transport: LspTransport;
    try {
      transport = await this.connector(LSP_HOST, port, this.timeouts.connect);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
      throw new Refusal(
        "LSP_OFF",
        `nothing answers on ${LSP_HOST}:${port} (connect failed: ${code})`,
      );
    }
    this.sessionsOpened++;
    const s = new LspSession(transport);
    const rootUri = this.deps.projectPath
      ? pathToFileURL(resolve(this.deps.projectPath)).href
      : null;
    let a: RpcAnswer;
    try {
      a = await s.initialize(rootUri, this.timeouts.initialize);
    } catch (e) {
      s.destroy();
      if (e instanceof LspClosed) {
        throw new Refusal(
          "BUSY",
          `the language server on port ${port} closed the connection before answering initialize: another client may hold it (P-W3-25)`,
          "Close the other LSP client (an external editor) or wait, then retry.",
        );
      }
      throw new Refusal(
        "LSP_OFF",
        `port ${port} accepted the connection but ${(e as Error).message} (the P-W3-23 kill criterion)`,
      );
    }
    if ("error" in a) {
      s.destroy();
      throw new Refusal(
        "HANDLER_ERROR",
        `the language server answered initialize with error ${a.error.code}: ${a.error.message}`,
      );
    }
    this.session = s;
    this.sessionPort = port;
    return { s, port, reused: false };
  }

  /** The project file of `rel`, its URI and its text (`text` overrides the file). */
  private document(rel: string, text: string | undefined): { uri: string; text: string } {
    const root = this.deps.projectPath;
    if (!root) {
      throw new Refusal(
        "NOT_IN_PROJECT",
        "no project folder is configured (ENFUSION_PROJECT_PATH); the file path cannot be resolved",
      );
    }
    const abs = resolve(root, rel);
    if (!isPathInsideRoot(abs, resolve(root))) {
      throw new Refusal("ABSOLUTE_PATH", `path resolves outside the project: ${rel}`);
    }
    const uri = pathToFileURL(abs).href;
    if (text !== undefined) return { uri, text };
    if (!this.fileExists(abs)) {
      throw new Refusal(
        "PATH_NOT_FOUND",
        `no file ${rel} in the project`,
        "Pass a project-relative .c path that exists, or pass text for an unsaved document.",
      );
    }
    return { uri, text: this.readFile(abs) };
  }

  private async dispatch(
    action: ScriptLspAction,
    target: string,
    req: ScriptLspInput,
  ): Promise<ScriptLspResponse> {
    const warnings: string[] = [];
    // The document is read before connecting, so a bad path costs no session.
    const doc = req.path !== undefined ? this.document(req.path, req.text) : undefined;
    if (doc && POSITION_ACTIONS.has(action)) {
      const lines = doc.text.split(/\r?\n/);
      if (req.line! >= lines.length) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          `line ${req.line} is past the end of the document (${lines.length} lines, 0-based)`,
        );
      }
      if (req.character! > lines[req.line!].length) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          `character ${req.character} is past the end of line ${req.line} (${lines[req.line!].length} characters, 0-based)`,
        );
      }
    }
    const { s, port, reused } = await this.ensureSession();

    if (action === "status") {
      return {
        ok: true,
        action,
        target: `lsp:${LSP_HOST}:${port}`,
        changed: null,
        readback: {
          host: LSP_HOST,
          port,
          connected: true,
          reused,
          serverInfo: s.serverInfo,
          capabilities: capabilitySummary(s.capabilities),
          openDocuments: s.openDocuments,
          serverRequests: { ...s.serverRequests },
        },
        warnings,
      };
    }

    const d = doc!;
    if (req.text !== undefined) {
      warnings.push("text was sent as the document's in-memory content; no file was written");
    }

    if (action === "diagnostics") {
      const before = s.publishedSeq(d.uri);
      const sent = s.sync(d.uri, d.text);
      let mode: "pull" | "push" | "none" = "none";
      let list: unknown[] = [];
      if (s.capabilities.diagnosticProvider) {
        const a = await s.request(
          "textDocument/diagnostic",
          { textDocument: { uri: d.uri } },
          this.timeouts.request,
        );
        if ("result" in a) {
          const items = obj(a.result).items;
          list = Array.isArray(items) ? items : [];
          mode = "pull";
        } else {
          warnings.push(
            `textDocument/diagnostic answered error ${a.error.code}; waited for publishDiagnostics instead`,
          );
        }
      }
      if (mode === "none") {
        const stored = s.publishedDiagnostics(d.uri);
        if (sent === "unchanged" && stored) {
          list = stored;
          mode = "push";
        } else if (await s.waitPublished(d.uri, before, this.timeouts.diagnostics)) {
          list = s.publishedDiagnostics(d.uri) ?? [];
          mode = "push";
        } else {
          warnings.push(
            `no diagnostics arrived within ${this.timeouts.diagnostics} ms: the server may report only after a save (P-W3-24); wb_scripts validate is the fallback`,
          );
        }
      }
      const p = page(mapDiagnostics(list), req.cursor, req.limit);
      const ok: ActionOk = {
        ok: true,
        action,
        target,
        changed: null,
        readback: { path: req.path, mode, sent, ...pageReadback(p) },
        warnings,
      };
      if (p.nextCursor) ok.next = `script_lsp diagnostics with cursor "${p.nextCursor}"`;
      return ok;
    }

    // Position requests.
    const cap = CAPABILITY_OF[action]!;
    if (!s.capabilities[cap]) {
      warnings.push(`the server did not announce ${cap} in its capabilities; asked anyway`);
    }
    const sent = s.sync(d.uri, d.text);
    const position = { line: req.line!, character: req.character! };
    const method = METHOD_OF[action]!;
    const a = await s.request(
      method,
      { textDocument: { uri: d.uri }, position },
      this.timeouts.request,
    );
    if ("error" in a) {
      const notImpl = a.error.code === -32601;
      return fail(
        action,
        target,
        "HANDLER_ERROR",
        notImpl
          ? `the language server does not implement ${method} (-32601)`
          : `the language server answered ${method} with error ${a.error.code}: ${a.error.message}`,
      );
    }
    const result = a.result;
    const at = { path: req.path, line: position.line, character: position.character, sent };
    let readback: Record<string, unknown>;
    let next: string | undefined;
    switch (action) {
      case "hover": {
        const r = obj(result);
        const found = result !== null && result !== undefined;
        readback = {
          ...at,
          found,
          text: found ? cut(markupText(r.contents), "the hover text", warnings) : "",
          range: r.range ? spanOf(r.range) : null,
        };
        break;
      }
      case "definition":
      case "implementation": {
        const locations = mapLocations(result, this.deps.projectPath);
        readback = { ...at, found: locations.length > 0, locations };
        break;
      }
      case "completion": {
        const { items, isIncomplete } = mapCompletion(result);
        const p = page(items, req.cursor, req.limit);
        readback = { ...at, isIncomplete, ...pageReadback(p) };
        if (p.nextCursor) next = `script_lsp completion with cursor "${p.nextCursor}"`;
        break;
      }
      default: {
        const sig = mapSignatures(result);
        for (const x of sig.signatures) {
          x.documentation = cut(x.documentation, "a signature's documentation", warnings);
        }
        readback = { ...at, found: sig.signatures.length > 0, ...sig };
      }
    }
    const ok: ActionOk = { ok: true, action, target, changed: null, readback, warnings };
    if (next) ok.next = next;
    return ok;
  }
}

function pageReadback<T>(p: { rows: T[]; total: number; nextCursor: string | null }) {
  return { total: p.total, rows: p.rows, nextCursor: p.nextCursor };
}

// ── Registration ─────────────────────────────────────────────────────────────

const hosts = new Set<ScriptLspHost>();

/** Closes every session the registered tool holds (didClose, shutdown, exit). */
export async function closeScriptLspSessions(): Promise<void> {
  await Promise.all([...hosts].map((h) => h.close()));
}

export function scriptLspDescription(): string {
  if (SCRIPT_LSP_DESCRIPTION.length > DESCRIPTION_MAX) {
    throw new Error(
      `${TOOL_NAME}: description is ${SCRIPT_LSP_DESCRIPTION.length} chars, budget ${DESCRIPTION_MAX}`,
    );
  }
  return SCRIPT_LSP_DESCRIPTION;
}

export function registerScriptLsp(server: McpServer, config: Config): ScriptLspHost {
  const host = new ScriptLspHost({
    projectPath: config.projectPath,
    netPort: config.workbenchPort,
  });
  hosts.add(host);
  // A literal name: the census (E11) and the registration tests read it from the call.
  server.registerTool(
    "script_lsp",
    {
      description: scriptLspDescription(),
      inputSchema: {
        action: z.enum(SCRIPT_LSP_ACTIONS),
        path: z.string().optional().describe("Project-relative .c file (every action but status)."),
        text: z
          .string()
          .optional()
          .describe("The document's unsaved content, sent in memory; the file is never written."),
        line: z.number().int().min(0).optional().describe("0-based line (position actions)."),
        character: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("0-based character in the line (position actions)."),
        cursor: z
          .string()
          .optional()
          .describe("diagnostics/completion paging: the nextCursor an earlier answer gave."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe(`Rows per page (default ${LIMIT_DEFAULT}).`),
      },
      annotations: {
        title: "Script language server",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await host.run(input));
    },
  );
  return host;
}
