/**
 * Phase 0 exit gate for the plan 5.1 guards (2.0 plan, section 5.1, "How the
 * 2.0 session verifies the guards").
 *
 * Spawns the built server (`node <repo>/dist/index.js`) as its own stdio
 * process, made unable to launch or reach anything, and speaks MCP to it:
 *
 *   Case A — marker absent, no lease:
 *     tools/call wb_state                      → isError, auto-launch refused
 *   Case B — marker present, lease held by session "other" (fresh heartbeat):
 *     tools/call wb_launch {gprojPath: <tmp>/addons/X/X.gproj} → lease refusal
 *     tools/call wb_state                      → lease refusal
 *
 * The child's environment is built from scratch here: the Workbench path is a
 * directory that does not exist, the port was bound and closed, the addons
 * directory is empty, and the lease, marker, index, logs, core, game and home
 * locations are all inside one temporary directory. The script refuses to
 * spawn anything unless every one of those overrides is set and points into
 * that directory, so it can never reach a real project or a real Workbench.
 *
 * Usage (after `npm run build`):  npx tsx scripts/guards-check.ts
 * Prints PASS/FAIL per case; exits 1 on any FAIL, 2 when it refuses to run.
 *
 * `runGuardCases` is also used by tests/workbench/spawned-guards.test.ts with
 * a tsx command against src/, so the test and the gate run the same cases.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Startup loads the data indexes; allow this long for each MCP reply. */
const REPLY_TIMEOUT_MS = 60_000;

/** Every path-valued override the child must receive, all inside the temp dir. */
const PATH_OVERRIDES = [
  "ENFUSION_WORKBENCH_PATH",
  "ENFUSION_PROJECT_PATH",
  "ENFUSION_LEASE_PATH",
  "ENFUSION_NO_AUTOLAUNCH_PATH",
  "ENFUSION_PROJECT_INDEX_PATH",
  "ENFUSION_LOGS_PATH",
  "ENFUSION_CORE_PATH",
  "ENFUSION_GAME_PATH",
  "ENFUSION_GAME_LOGS_PATH",
  "ENFUSION_WORKSHOP_PATH",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "TEMP",
  "TMP",
] as const;

export interface CaseResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface GuardSandbox {
  root: string;
  addons: string;
  leasePath: string;
  markerPath: string;
  port: number;
  env: Record<string, string>;
}

interface RpcResponse {
  id?: number;
  result?: { isError?: boolean; content?: { type: string; text?: string }[] };
  error?: { message: string };
}

/** A port that was bound and released, so connecting to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

/** Build the temporary world and the child's complete environment. */
export async function createGuardSandbox(): Promise<GuardSandbox> {
  const root = mkdtempSync(join(tmpdir(), "emcp-guards-check-"));
  const addons = join(root, "addons");
  const home = join(root, "home");
  for (const d of [addons, home, join(root, "logs"), join(root, "tmp")]) {
    mkdirSync(d, { recursive: true });
  }
  const port = await closedPort();
  const env: Record<string, string> = {
    ENFUSION_WORKBENCH_PATH: join(root, "absent"),
    ENFUSION_WORKBENCH_HOST: "127.0.0.1",
    ENFUSION_WORKBENCH_PORT: String(port),
    ENFUSION_PROJECT_PATH: addons,
    ENFUSION_LEASE_PATH: join(root, "lease.json"),
    ENFUSION_NO_AUTOLAUNCH_PATH: join(root, "no-autolaunch"),
    ENFUSION_PROJECT_INDEX_PATH: join(root, "idx.db"),
    ENFUSION_LOGS_PATH: join(root, "logs"),
    ENFUSION_CORE_PATH: join(root, "core"),
    ENFUSION_GAME_PATH: join(root, "game"),
    ENFUSION_GAME_LOGS_PATH: join(root, "game-logs"),
    ENFUSION_WORKSHOP_PATH: join(root, "workshop"),
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: join(home, "AppData", "Local"),
    APPDATA: join(home, "AppData", "Roaming"),
    TEMP: join(root, "tmp"),
    TMP: join(root, "tmp"),
  };
  // Only what a Node process needs to start; nothing else is inherited (in
  // particular no ENFUSION_DEFAULT_MOD and no real home directory).
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.platform === "win32" && process.env.SystemRoot) {
    env.SystemRoot = process.env.SystemRoot;
  }
  return {
    root,
    addons,
    leasePath: env.ENFUSION_LEASE_PATH,
    markerPath: env.ENFUSION_NO_AUTOLAUNCH_PATH,
    port,
    env,
  };
}

/**
 * Refuse unless every override is set and confined to the sandbox, the port
 * is the closed one, and the Workbench path does not exist. Returns the list
 * of problems (empty when safe).
 */
export function sandboxProblems(sb: GuardSandbox): string[] {
  const problems: string[] = [];
  const inside = (p: string): boolean => {
    const rel = relative(sb.root, p);
    return isAbsolute(p) && rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  for (const key of PATH_OVERRIDES) {
    const v = sb.env[key];
    if (!v) problems.push(`${key} is not set`);
    else if (!inside(v)) problems.push(`${key} points outside the sandbox`);
  }
  if (sb.env.ENFUSION_WORKBENCH_PORT !== String(sb.port)) {
    problems.push("ENFUSION_WORKBENCH_PORT is not the closed sandbox port");
  }
  if (sb.env.ENFUSION_WORKBENCH_HOST !== "127.0.0.1") {
    problems.push("ENFUSION_WORKBENCH_HOST is not 127.0.0.1");
  }
  if (sb.env.ENFUSION_DEFAULT_MOD !== undefined) {
    problems.push("ENFUSION_DEFAULT_MOD must not be set");
  }
  if (existsSync(sb.env.ENFUSION_WORKBENCH_PATH ?? "")) {
    problems.push("ENFUSION_WORKBENCH_PATH exists (it must not)");
  }
  if (readdirSync(sb.addons).length !== 0) {
    problems.push("the sandbox addons directory is not empty");
  }
  return problems;
}

/** Minimal newline-delimited JSON-RPC client over a child's stdio. */
class StdioRpc {
  private buffer = "";
  private nextId = 1;
  private readonly waiters = new Map<number, (r: RpcResponse) => void>();
  readonly stderrTail: string[] = [];

  constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding("utf-8");
    child.stdout!.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        let msg: RpcResponse;
        try {
          msg = JSON.parse(line) as RpcResponse;
        } catch {
          continue;
        }
        if (typeof msg.id === "number") {
          const w = this.waiters.get(msg.id);
          if (w) {
            this.waiters.delete(msg.id);
            w(msg);
          }
        }
      }
    });
    child.stderr!.setEncoding("utf-8");
    child.stderr!.on("data", (chunk: string) => {
      for (const l of chunk.split("\n")) {
        if (l.trim()) this.stderrTail.push(l);
      }
      if (this.stderrTail.length > 40) this.stderrTail.splice(0, this.stderrTail.length - 40);
    });
  }

  request(method: string, params: Record<string, unknown>): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise<RpcResponse>((resolveReply, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(`no reply to ${method} within ${REPLY_TIMEOUT_MS / 1000}s`));
      }, REPLY_TIMEOUT_MS);
      this.waiters.set(id, (r) => {
        clearTimeout(timer);
        resolveReply(r);
      });
      this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string): void {
    this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }
}

function replyText(r: RpcResponse): string {
  if (r.error) return `JSON-RPC error: ${r.error.message}`;
  return (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

/** Spawn the server, run `body` against it, and always kill the child. */
async function withServer<T>(
  command: string[],
  sb: GuardSandbox,
  body: (rpc: StdioRpc) => Promise<T>,
): Promise<T> {
  const child = spawn(command[0], command.slice(1), {
    cwd: REPO_ROOT,
    env: sb.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  const rpc = new StdioRpc(child);
  try {
    const init = await rpc.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "guards-check", version: "0.0.0" },
    });
    if (init.error) throw new Error(`initialize failed: ${init.error.message}`);
    rpc.notify("notifications/initialized");
    return await body(rpc);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg}\n--- server stderr (tail) ---\n${rpc.stderrTail.join("\n")}`);
  } finally {
    child.stdin?.end();
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  }
}

function callTool(rpc: StdioRpc, name: string, args: Record<string, unknown>) {
  return rpc.request("tools/call", { name, arguments: args });
}

/**
 * Run case A and case B against the server started by `command` (argv,
 * resolved relative to the repository root). Throws when the sandbox is not
 * safe; returns one result per case otherwise.
 */
export async function runGuardCases(command: string[], sb: GuardSandbox): Promise<CaseResult[]> {
  const problems = sandboxProblems(sb);
  if (problems.length > 0) {
    throw new Error(`refusing to run: ${problems.join("; ")}`);
  }
  const results: CaseResult[] = [];

  // Case A — marker absent, no lease: an implicit auto-launch is refused.
  rmSync(sb.markerPath, { force: true });
  rmSync(sb.leasePath, { force: true });
  try {
    const text = await withServer(command, sb, async (rpc) => {
      const r = await callTool(rpc, "wb_state", {});
      const t = replyText(r);
      if (!r.result?.isError) throw new Error(`wb_state was not an error: ${t}`);
      return t;
    });
    const ok =
      text.includes("Auto-launch refused") && text.includes("refusing to pick a fallback addon");
    const untouched = readdirSync(sb.addons).length === 0;
    results.push({
      name: "A: marker absent, wb_state refuses auto-launch without an explicit project",
      pass: ok && untouched,
      detail: ok
        ? untouched
          ? "refused; addons directory untouched"
          : "refused, but something was written into the addons directory"
        : `unexpected reply: ${text}`,
    });
  } catch (e) {
    results.push({
      name: "A: marker absent, wb_state refuses auto-launch without an explicit project",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // Case B — marker present, lease held by "other": every live action refused.
  writeFileSync(sb.markerPath, "", "utf-8");
  const now = new Date().toISOString();
  writeFileSync(
    sb.leasePath,
    JSON.stringify({
      session: "other",
      purpose: "guards-check",
      started_at: now,
      heartbeat_at: now,
      wb_pid: null,
      project: null,
    }),
    "utf-8",
  );
  const gproj = join(sb.addons, "X", "X.gproj");
  const leaseBefore = readFileSync(sb.leasePath, "utf-8");
  try {
    const [launchText, stateText] = await withServer(command, sb, async (rpc) => {
      const l = await callTool(rpc, "wb_launch", { gprojPath: gproj });
      const s = await callTool(rpc, "wb_state", {});
      if (!l.result?.isError) throw new Error(`wb_launch was not an error: ${replyText(l)}`);
      if (!s.result?.isError) throw new Error(`wb_state was not an error: ${replyText(s)}`);
      return [replyText(l), replyText(s)];
    });
    const launchOk = launchText.includes("Workbench lease held by another session");
    const stateOk = stateText.includes("Workbench lease refused (LEASE_HELD)");
    const leaseKept =
      existsSync(sb.leasePath) &&
      readFileSync(sb.leasePath, "utf-8") === leaseBefore &&
      readdirSync(sb.addons).length === 0;
    results.push({
      name: "B: marker present + lease held, wb_launch and wb_state refused by the lease",
      pass: launchOk && stateOk && leaseKept,
      detail: [
        launchOk ? "wb_launch refused by lease" : `wb_launch reply: ${launchText}`,
        stateOk ? "wb_state refused by lease" : `wb_state reply: ${stateText}`,
        leaseKept ? "lease kept, nothing installed" : "lease file changed or addons written",
      ].join("; "),
    });
  } catch (e) {
    results.push({
      name: "B: marker present + lease held, wb_launch and wb_state refused by the lease",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  return results;
}

async function main(): Promise<number> {
  const entry = join(REPO_ROOT, "dist", "index.js");
  if (!existsSync(entry)) {
    console.error(`guards-check: ${relative(REPO_ROOT, entry)} not found; run the build first.`);
    return 2;
  }
  const sb = await createGuardSandbox();
  try {
    const problems = sandboxProblems(sb);
    if (problems.length > 0) {
      console.error(`guards-check: refusing to run: ${problems.join("; ")}`);
      return 2;
    }
    const results = await runGuardCases([process.execPath, entry], sb);
    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}\n      ${r.detail}`);
    }
    const failed = results.filter((r) => !r.pass).length;
    console.log(failed === 0 ? "guards-check: all cases passed" : `guards-check: ${failed} FAIL`);
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`guards-check: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    },
  );
}
