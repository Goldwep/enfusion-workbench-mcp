/**
 * One raw NET API call (plan 5.3: "One call at a time").
 *
 * Encodes the request with `encodeRequest`, sends it over a fresh TCP socket
 * (half-closing after the write, as `WorkbenchClient.rawCall` does), reads
 * until the peer closes, and decodes with `decodeResponse`. It never launches
 * anything and never retries: plan 5.3 says "On any timeout, do not retry";
 * a timeout is reported and the caller decides.
 *
 * APIFuncs on the policy's never-on-a-live-instance and development-only API
 * lists (`data/census/policy.json`) are refused before any socket is opened.
 *
 * Usage:
 *   npx tsx scripts/live/netcall.ts <APIFunc> [--params '<json>'] [--host 127.0.0.1]
 *       [--port 5775] [--timeout-ms 10000] [--client-id EnfusionMCPHarness]
 *       [--dry-run | --really --id <lane id>]
 * Without --really the call is a dry run that prints the frame length and the
 * JSON payload.
 */

import { Socket } from "node:net";
import { decodeResponse, encodeRequest } from "../../src/workbench/protocol.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import { deniedApi, deniedApiNames, loadPolicy } from "./policy.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Client id for harness calls, distinct from the registered server's "EnfusionMCP". */
export const HARNESS_CLIENT_ID = "EnfusionMCPHarness";

/** Default NET API port (`src/config.ts` workbenchPort). */
export const DEFAULT_PORT = 5775;

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Response size cap, matching `WorkbenchClient` (10 MB). */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

// ── Types ────────────────────────────────────────────────────────────────────

export interface NetCallOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  clientId?: string;
}

export interface NetCallResult {
  ok: boolean;
  /** Decoded payload when ok. */
  response?: unknown;
  /** Error text when not ok (timeout, refused, Workbench error). */
  error?: string;
  timedOut: boolean;
  bytesSent: number;
  bytesReceived: number;
  durationMs: number;
}

export interface FrameDescription {
  apiFunc: string;
  clientId: string;
  /** Total request frame length in bytes. */
  bytes: number;
  /** The JSON payload string inside the frame. */
  payload: string;
}

// ── Frame and call ───────────────────────────────────────────────────────────

/** Describe the request frame without sending it. */
export function describeFrame(
  apiFunc: string,
  params: Record<string, unknown> = {},
  clientId: string = HARNESS_CLIENT_ID,
): FrameDescription {
  const frame = encodeRequest(clientId, apiFunc, params);
  return {
    apiFunc,
    clientId,
    bytes: frame.length,
    payload: JSON.stringify({ ...params, APIFunc: apiFunc }),
  };
}

/** Send one request over a fresh socket and decode the answer. Never retries. */
export function netCall(
  apiFunc: string,
  params: Record<string, unknown> = {},
  opts: NetCallOptions = {},
): Promise<NetCallResult> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = encodeRequest(opts.clientId ?? HARNESS_CLIENT_ID, apiFunc, params);
  const started = Date.now();

  return new Promise((resolvePromise) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finish = (r: Omit<NetCallResult, "bytesSent" | "bytesReceived" | "durationMs">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.on("error", () => {
        /* settled: late socket errors are irrelevant */
      });
      socket.destroy();
      resolvePromise({
        ...r,
        bytesSent: request.length,
        bytesReceived: received,
        durationMs: Date.now() - started,
      });
    };

    const decode = (): void => {
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        finish({ ok: false, error: "connection closed without a response", timedOut: false });
        return;
      }
      try {
        finish({ ok: true, response: decodeResponse(buf), timedOut: false });
      } catch (e) {
        finish({ ok: false, error: e instanceof Error ? e.message : String(e), timedOut: false });
      }
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `timed out after ${timeoutMs} ms (not retried)`, timedOut: true });
    }, timeoutMs);

    socket.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      finish({
        ok: false,
        error: code === "ECONNREFUSED" ? `connection refused at ${host}:${port}` : err.message,
        timedOut: false,
      });
    });
    socket.on("data", (c) => {
      received += c.length;
      if (received > MAX_RESPONSE_SIZE) {
        finish({
          ok: false,
          error: `response exceeded ${MAX_RESPONSE_SIZE} bytes`,
          timedOut: false,
        });
        return;
      }
      chunks.push(c);
    });
    socket.on("end", decode);
    socket.on("close", decode);
    socket.connect(port, host, () => {
      socket.end(request);
    });
  });
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, [
      "params",
      "host",
      "port",
      "timeout-ms",
      "client-id",
      "id",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const apiFunc = args.positional[0];
  if (!apiFunc) {
    console.error("Usage: netcall.ts <APIFunc> [--params <json>] [--dry-run | --really --id <id>]");
    return 2;
  }
  let params: Record<string, unknown> = {};
  try {
    if (args.options.params) params = JSON.parse(args.options.params) as Record<string, unknown>;
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      throw new Error("--params must be a JSON object");
    }
  } catch (e) {
    console.error(`Invalid --params: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const denied = deniedApi(apiFunc, deniedApiNames(loadPolicy()));
  if (denied) {
    console.error(`Refused: ${apiFunc} is on the policy deny list (${denied})`);
    return 1;
  }
  const clientId = args.options["client-id"] ?? HARNESS_CLIENT_ID;
  const frame = describeFrame(apiFunc, params, clientId);
  console.log(`frame: ${frame.bytes} bytes (client id ${frame.clientId})`);
  console.log(`payload: ${frame.payload}`);

  const really = args.flags.has("really") && !args.flags.has("dry-run");
  const lane = args.options.id
    ? new Lane({
        id: args.options.id,
        leasePath: args.options["lease-path"],
        markerPath: args.options["marker-path"],
      })
    : null;
  const reason = liveGateReason({
    really,
    platform: process.platform,
    leaseHeld: lane ? lane.holdsLease() : false,
  });
  if (reason) {
    console.log(reason);
    return args.flags.has("really") && !args.flags.has("dry-run") ? 1 : 0;
  }
  const port = args.options.port ? Number(args.options.port) : DEFAULT_PORT;
  const timeoutMs = args.options["timeout-ms"]
    ? Number(args.options["timeout-ms"])
    : DEFAULT_TIMEOUT_MS;
  lane!.heartbeat();
  const r = await netCall(apiFunc, params, {
    host: args.options.host,
    port,
    timeoutMs,
    clientId,
  });
  console.log(JSON.stringify(r, null, 2));
  return r.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
