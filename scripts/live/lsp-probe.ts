/**
 * LSP client probe for session S-F (blocker B5; U20, L269, L378, L419). Workbench's LSP server
 * is enabled by the ini (`[Workbench] LSP_Enabled`, `LSP_Port`, attested as WorkbenchOptionsClass
 * options in E05 options-strings.tsv; `-lsp` is not an attested switch), never by a flag.
 *
 * Raw TCP to 127.0.0.1 only, Content-Length framing (JSON-RPC 2.0). Plans:
 *
 *   session        initialize; initialized; textDocument/didOpen of an in-memory text with one
 *                  planted error under a sandbox URI that does not exist on disk (never written);
 *                  textDocument/diagnostic, or when the server does not answer it a wait of up to
 *                  10 s for textDocument/publishDiagnostics; one textDocument/hover and one
 *                  textDocument/completion (on --hover-uri when given, else the in-memory
 *                  document); then the socket is closed;
 *   second-client  a first socket that sends initialize and is held; a second socket that sends
 *                  initialize; a short wait; both closed.
 *
 * Never sent: didSave, didChange, shutdown, exit (Q8: `exit` may end more than the LSP server;
 * the sockets are closed instead). A server-to-client request is answered with a null result (no
 * file is ever read or written for it). No answer to initialize within --timeout-ms is
 * `result: "no-answer"`, not a throw. The output records per message the method, answered or
 * not, the time, and the shape of the result (keys and array lengths only): no source text and
 * no server string is echoed back. The only file written is the --out JSON, inside the artifacts
 * folder, created and never overwritten.
 *
 * --port equal to --net-port is refused (one NET call at a time; the LSP socket is the only
 * second connection of S-F). A real run needs --really, win32 and the lease held by this lane
 * (--id); without --really, or with --dry-run, the message plan is printed and nothing connects.
 *
 * Usage:
 *   npx tsx scripts/live/lsp-probe.ts --port <n> --net-port <n> --plan session|second-client
 *       [--sandbox <dir>] [--hover-uri <file uri>] [--timeout-ms 30000] [--out <json>]
 *       [--id <lane id> [--lease-path p] [--marker-path p] --really] [--dry-run]
 *
 * Exit code: 0 ran (whatever the server answered, including no-answer) or dry run, 1 refused or
 * failed, 2 usage error.
 */

import { existsSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import { SANDBOX_NAME, artifactsDir, defaultPlaceholderContext, toPlaceholders } from "./paths.js";

export const LSP_HOST = "127.0.0.1";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DIAGNOSTIC_WAIT_MS = 10_000;
export const SECOND_CLIENT_HOLD_MS = 2_000;

/** Methods this client never sends (Q8). */
export const FORBIDDEN_METHODS: ReadonlySet<string> = new Set([
  "textDocument/didSave",
  "textDocument/didChange",
  "textDocument/willSave",
  "textDocument/willSaveWaitUntil",
  "workspace/applyEdit",
  "workspace/executeCommand",
  "shutdown",
  "exit",
]);

export type LspPlan = "session" | "second-client";

/** The in-memory document: one planted error (an undeclared type), never written to disk. */
export const PROBE_TEXT = [
  "class EMCP2_LspProbe",
  "{",
  "\tvoid Probe()",
  "\t{",
  "\t\tEMCP2_UndeclaredType planted;",
  "\t}",
  "}",
  "",
].join("\n");

/** Where hover and completion point inside PROBE_TEXT (the `planted` line, at its type). */
export const PROBE_POSITION = { line: 4, character: 4 };

export function probeUri(sandboxDir: string): string {
  return pathToFileURL(join(sandboxDir, "Scripts", "__lsp_probe__.c")).href;
}

export interface LspOptions {
  host?: string;
  port: number;
  netPort: number;
  plan: LspPlan;
  timeoutMs?: number;
  /** The 2.0 sandbox folder; the probe URI lies under it and must not exist on disk. */
  sandboxDir: string;
  hoverUri?: string;
  /** Test seam: time scale for the fixed waits (1 in real runs). */
  waitScale?: number;
}

export function lspOptionsRefusal(o: LspOptions): string | null {
  const host = o.host ?? LSP_HOST;
  if (host !== LSP_HOST) return `refused: host ${host}; this client connects to ${LSP_HOST} only`;
  for (const [name, p] of [
    ["--port", o.port],
    ["--net-port", o.netPort],
  ] as const) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) return `${name} must be a port number`;
  }
  if (o.port === o.netPort) {
    return "refused: --port equals --net-port (one NET call at a time; never a second NET connection)";
  }
  if (o.plan !== "session" && o.plan !== "second-client") {
    return "--plan must be session or second-client";
  }
  if (o.timeoutMs !== undefined && (!Number.isInteger(o.timeoutMs) || o.timeoutMs <= 0)) {
    return "--timeout-ms must be a positive integer";
  }
  if (o.hoverUri !== undefined) {
    // Hover and completion on a URI never opened make the server read it from disk: only a
    // file inside the 2.0 sandbox is allowed (review F-H1).
    let p: string;
    try {
      p = fileURLToPath(o.hoverUri);
    } catch {
      return "--hover-uri must be a file:/// URI";
    }
    if (!o.hoverUri.startsWith("file:///")) return "--hover-uri must be a file:/// URI";
    const rel = relative(resolve(o.sandboxDir), resolve(p));
    if (
      !o.sandboxDir ||
      rel === "" ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel)
    ) {
      return "refused: --hover-uri is not inside the 2.0 sandbox folder";
    }
  }
  return null;
}

/** The ordered messages of a plan, for --dry-run and the tests. */
export function messagePlan(plan: LspPlan): string[] {
  return plan === "session"
    ? [
        "-> initialize",
        "-> initialized",
        "-> textDocument/didOpen (in memory, never on disk)",
        "-> textDocument/diagnostic (else wait 10 s for publishDiagnostics)",
        "-> textDocument/hover",
        "-> textDocument/completion",
        "close socket",
      ]
    : ["client A -> initialize", "client B -> initialize (A held)", "wait", "close B", "close A"];
}

// ── Framing ──────────────────────────────────────────────────────────────────

export function frame(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf-8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Incremental Content-Length decoder. */
export class FrameReader {
  private buf = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      const sepAt = this.buf.indexOf("\r\n\r\n");
      if (sepAt === -1) break;
      const header = this.buf.subarray(0, sepAt).toString("ascii");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) throw new Error("LSP frame without Content-Length");
      const len = Number(m[1]);
      if (this.buf.length < sepAt + 4 + len) break;
      const body = this.buf.subarray(sepAt + 4, sepAt + 4 + len).toString("utf-8");
      this.buf = this.buf.subarray(sepAt + 4 + len);
      out.push(JSON.parse(body));
    }
    return out;
  }
}

/** Keys and array lengths of a value, never its strings. */
export function shapeOf(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return { array: v.length };
  if (typeof v === "object") {
    if (depth >= 1) return { keys: Object.keys(v as object).sort() };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = shapeOf((v as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  return typeof v;
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface MessageRecord {
  client: string;
  method: string;
  kind: "request" | "notification";
  answered: boolean | null;
  ms: number | null;
  shape?: unknown;
  error?: { code: unknown };
}

interface Pending {
  resolve: (msg: Record<string, unknown> | null) => void;
  timer: NodeJS.Timeout;
}

class LspClient {
  private socket: Socket | null = null;
  private reader = new FrameReader();
  private nextId = 1;
  private pending = new Map<number, Pending>();
  readonly notifications: Record<string, number> = {};
  readonly serverRequests: Record<string, number> = {};
  private diagWaiters: Array<() => void> = [];
  closedByServer = false;

  constructor(
    readonly name: string,
    private readonly records: MessageRecord[],
  ) {}

  open(host: string, port: number, timeoutMs: number): Promise<string | null> {
    return new Promise((res) => {
      const s = connect({ host, port });
      const t = setTimeout(() => {
        s.destroy();
        res("connect timed out");
      }, timeoutMs);
      s.once("connect", () => {
        clearTimeout(t);
        this.socket = s;
        res(null);
      });
      s.once("error", (e) => {
        clearTimeout(t);
        res(`connect failed (${(e as NodeJS.ErrnoException).code ?? e.message})`);
      });
      s.on("data", (d: Buffer) => this.onData(d));
      s.on("close", () => {
        this.closedByServer = this.socket !== null;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.resolve(null);
        }
        this.pending.clear();
      });
    });
  }

  private onData(d: Buffer): void {
    let msgs: unknown[];
    try {
      msgs = this.reader.push(d);
    } catch {
      return;
    }
    for (const m of msgs as Array<Record<string, unknown>>) {
      if (m.method !== undefined && m.id !== undefined) {
        const method = String(m.method);
        this.serverRequests[method] = (this.serverRequests[method] ?? 0) + 1;
        this.write({ jsonrpc: "2.0", id: m.id, result: null });
      } else if (m.method !== undefined) {
        const method = String(m.method);
        this.notifications[method] = (this.notifications[method] ?? 0) + 1;
        if (method === "textDocument/publishDiagnostics") {
          for (const w of this.diagWaiters.splice(0)) w();
        }
      } else if (typeof m.id === "number" && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        p.resolve(m);
      }
    }
  }

  private write(msg: Record<string, unknown>): void {
    const method = typeof msg.method === "string" ? msg.method : null;
    if (method && FORBIDDEN_METHODS.has(method)) {
      throw new Error(`refused: ${method} is never sent by this client`);
    }
    this.socket?.write(frame(msg));
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
    this.records.push({
      client: this.name,
      method,
      kind: "notification",
      answered: null,
      ms: null,
    });
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    const id = this.nextId++;
    const t0 = Date.now();
    const answer = await new Promise<Record<string, unknown> | null>((res) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        res(null);
      }, timeoutMs);
      this.pending.set(id, { resolve: res, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
    const rec: MessageRecord = {
      client: this.name,
      method,
      kind: "request",
      answered: answer !== null,
      ms: answer !== null ? Date.now() - t0 : null,
    };
    if (answer && answer.error)
      rec.error = { code: (answer.error as { code?: unknown }).code ?? null };
    else if (answer) rec.shape = shapeOf(answer.result);
    this.records.push(rec);
    return answer;
  }

  waitDiagnostics(ms: number): Promise<boolean> {
    if ((this.notifications["textDocument/publishDiagnostics"] ?? 0) > 0)
      return Promise.resolve(true);
    return new Promise((res) => {
      const t = setTimeout(() => res(false), ms);
      this.diagWaiters.push(() => {
        clearTimeout(t);
        res(true);
      });
    });
  }

  close(): void {
    const s = this.socket;
    this.socket = null;
    s?.destroy();
  }
}

function initializeParams(): Record<string, unknown> {
  return {
    processId: process.pid,
    clientInfo: { name: "emcp2-lsp-probe" },
    rootUri: null,
    capabilities: {
      textDocument: {
        synchronization: {},
        hover: { contentFormat: ["plaintext"] },
        completion: {},
        diagnostic: {},
        publishDiagnostics: {},
      },
      workspace: { configuration: false, applyEdit: false },
    },
  };
}

export interface LspReport {
  plan: LspPlan;
  port: number;
  result: "ok" | "no-answer" | "connect-failed" | "closed-by-server";
  detail?: string;
  messages: MessageRecord[];
  notifications: Record<string, Record<string, number>>;
  serverRequests: Record<string, Record<string, number>>;
  diagnostics: "pull" | "push" | "none" | null;
  elapsed_ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLspPlan(o: LspOptions): Promise<LspReport> {
  const refusal = lspOptionsRefusal(o);
  if (refusal) throw new Error(refusal);
  const host = o.host ?? LSP_HOST;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scale = o.waitScale ?? 1;
  const uri = probeUri(o.sandboxDir);
  if (existsSync(new URL(uri))) {
    throw new Error(
      "refused: the probe URI exists on disk; the in-memory document must not shadow a file",
    );
  }
  const t0 = Date.now();
  const records: MessageRecord[] = [];
  const clients: LspClient[] = [];
  const report = (
    result: LspReport["result"],
    diagnostics: LspReport["diagnostics"],
    detail?: string,
  ): LspReport => {
    for (const c of clients) c.close();
    return {
      plan: o.plan,
      port: o.port,
      result,
      ...(detail ? { detail } : {}),
      messages: records,
      notifications: Object.fromEntries(clients.map((c) => [c.name, { ...c.notifications }])),
      serverRequests: Object.fromEntries(clients.map((c) => [c.name, { ...c.serverRequests }])),
      diagnostics,
      elapsed_ms: Date.now() - t0,
    };
  };
  const a = new LspClient("A", records);
  clients.push(a);
  const failA = await a.open(host, o.port, timeoutMs);
  if (failA) return report("connect-failed", null, failA);
  const initA = await a.request("initialize", initializeParams(), timeoutMs);
  if (!initA) return report(a.closedByServer ? "closed-by-server" : "no-answer", null);

  if (o.plan === "second-client") {
    const b = new LspClient("B", records);
    clients.push(b);
    const failB = await b.open(host, o.port, timeoutMs);
    if (failB) return report("connect-failed", null, `client B: ${failB}`);
    const initB = await b.request("initialize", initializeParams(), timeoutMs);
    await sleep(SECOND_CLIENT_HOLD_MS * scale);
    return report(initB ? "ok" : "no-answer", null, initB ? undefined : "client B had no answer");
  }

  a.notify("initialized", {});
  a.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "enforce", version: 1, text: PROBE_TEXT },
  });
  let diagnostics: LspReport["diagnostics"] = "none";
  const pull = await a.request("textDocument/diagnostic", { textDocument: { uri } }, timeoutMs);
  if (pull && !pull.error) diagnostics = "pull";
  else if (await a.waitDiagnostics(DIAGNOSTIC_WAIT_MS * scale)) diagnostics = "push";
  const target = o.hoverUri ?? uri;
  await a.request(
    "textDocument/hover",
    { textDocument: { uri: target }, position: PROBE_POSITION },
    timeoutMs,
  );
  await a.request(
    "textDocument/completion",
    { textDocument: { uri: target }, position: PROBE_POSITION },
    timeoutMs,
  );
  return report("ok", diagnostics);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function outRefusal(path: string, root: string): string | null {
  const abs = resolve(path);
  const rel = relative(resolve(root), abs);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    return `--out ${abs} is not inside the artifacts folder`;
  }
  if (!existsSync(dirname(abs))) return `--out: the folder of ${abs} does not exist`;
  if (existsSync(abs)) return `--out ${abs} exists; it is created, never overwritten`;
  return null;
}

/** Why the --sandbox value (after resolve) is not the 2.0 sandbox folder, or null. */
export function sandboxRefusal(sandboxDir: string): string | null {
  return !sandboxDir || !sandboxDir.endsWith(SANDBOX_NAME)
    ? `--sandbox must be the 2.0 sandbox folder (${SANDBOX_NAME})`
    : null;
}

export async function main(argv: string[]): Promise<number> {
  const ph = defaultPlaceholderContext();
  let args;
  try {
    args = parseArgs(argv, [
      "port",
      "net-port",
      "plan",
      "host",
      "sandbox",
      "hover-uri",
      "timeout-ms",
      "out",
      "id",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  const sandboxDir = o.sandbox ? resolve(o.sandbox) : (ph.sandbox ?? "");
  const opts: LspOptions = {
    host: o.host,
    port: Number(o.port),
    netPort: Number(o["net-port"]),
    plan: (o.plan ?? "") as LspPlan,
    timeoutMs: o["timeout-ms"] !== undefined ? Number(o["timeout-ms"]) : undefined,
    sandboxDir,
    hoverUri: o["hover-uri"],
  };
  const refusal = lspOptionsRefusal(opts);
  if (refusal) {
    console.error(refusal);
    return refusal.startsWith("refused") ? 1 : 2;
  }
  const sandboxWhy = sandboxRefusal(sandboxDir);
  if (sandboxWhy) {
    console.error(sandboxWhy);
    return 2;
  }
  const show = (s: string) => toPlaceholders(s, { ...ph, sandbox: sandboxDir });
  console.log(
    `LSP plan ${opts.plan} on ${LSP_HOST}:${opts.port}: ${messagePlan(opts.plan).join("; ")}`,
  );
  console.log(`probe URI (in memory, never written): ${show(probeUri(sandboxDir))}`);
  if (!args.flags.has("really") || args.flags.has("dry-run")) {
    console.log("dry run (pass --really to connect)");
    return 0;
  }
  const lane = o.id
    ? new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] })
    : null;
  const gate = liveGateReason({
    really: true,
    platform: process.platform,
    leaseHeld: lane ? lane.holdsLease() : false,
  });
  if (gate) {
    console.error(gate);
    return 1;
  }
  const out =
    o.out ??
    join(artifactsDir(), `lsp-${opts.plan}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const bad = outRefusal(out, artifactsDir());
  if (bad) {
    console.error(show(`refused: ${bad}`));
    return 1;
  }
  let rep: LspReport;
  try {
    rep = await runLspPlan(opts);
  } catch (e) {
    console.error(show(e instanceof Error ? e.message : String(e)));
    return 1;
  }
  writeFileSync(out, show(JSON.stringify(rep, null, 1)) + "\n", { encoding: "utf-8", flag: "wx" });
  console.log(show(JSON.stringify({ result: rep.result, diagnostics: rep.diagnostics, out })));
  return 0;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
