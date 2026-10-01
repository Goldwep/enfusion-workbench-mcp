/**
 * Scripted fake of the Workbench NET API for the dry-run gate and tests.
 *
 * Responses are keyed by APIFunc. A response is either a JSON payload
 * (answered with status "Ok") or `{ error: "<status>" }` (answered with that
 * status string, which `decodeResponse` turns into "Workbench error: ...").
 * A list of responses is consumed in order; the last one repeats.
 *
 * Two forms:
 *   - `MockNet.call()`: in-process, no socket, for action-plan dry runs.
 *   - `startMockNetServer()`: a real TCP listener on 127.0.0.1 that speaks the
 *     wire protocol of `src/workbench/protocol.ts`, for exercising netcall.ts
 *     end to end without Workbench.
 *
 * Every call is logged, so a test can assert the exact sequence a script
 * would have issued. Response payloads in tests are synthetic: nothing here
 * claims to reproduce what a real Workbench returns.
 */

import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import {
  decodeInt32LE,
  decodePascalString,
  encodePascalString,
} from "../../../src/workbench/protocol.js";

export type MockResponse = Record<string, unknown> | { error: string };

export type MockScript = Record<string, MockResponse | MockResponse[]>;

export interface MockCall {
  apiFunc: string;
  params: Record<string, unknown>;
  clientId?: string;
}

function isError(r: MockResponse): r is { error: string } {
  return typeof (r as { error?: unknown }).error === "string" && Object.keys(r).length === 1;
}

/** Encode a NET response frame: [status][payload], both Pascal strings. */
export function encodeResponseFrame(response: MockResponse): Buffer {
  if (isError(response)) return encodePascalString(response.error);
  return Buffer.concat([encodePascalString("Ok"), encodePascalString(JSON.stringify(response))]);
}

/**
 * Decode a NET request frame (the inverse of `encodeRequest`). Returns null
 * while the buffer is still incomplete.
 */
export function decodeRequestFrame(buf: Buffer): {
  version: number;
  clientId: string;
  contentType: string;
  payload: Record<string, unknown>;
} | null {
  try {
    let off = 0;
    const version = decodeInt32LE(buf, off);
    off += version.bytesRead;
    const clientId = decodePascalString(buf, off);
    off += clientId.bytesRead;
    const contentType = decodePascalString(buf, off);
    off += contentType.bytesRead;
    const payload = decodePascalString(buf, off);
    return {
      version: version.value,
      clientId: clientId.value,
      contentType: contentType.value,
      payload: JSON.parse(payload.value) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export class MockNet {
  readonly calls: MockCall[] = [];
  private readonly cursor = new Map<string, number>();

  constructor(private readonly script: MockScript) {}

  /** The scripted response for the next call of `apiFunc`. */
  next(apiFunc: string): MockResponse {
    const entry = this.script[apiFunc];
    if (entry === undefined) return { error: `Undefined API func ${apiFunc} (mock)` };
    if (!Array.isArray(entry)) return entry;
    if (entry.length === 0) return { error: `No scripted response for ${apiFunc} (mock)` };
    const i = this.cursor.get(apiFunc) ?? 0;
    this.cursor.set(apiFunc, i + 1);
    return entry[Math.min(i, entry.length - 1)];
  }

  /** In-process call: logs it and returns the payload, or throws like decodeResponse. */
  call(apiFunc: string, params: Record<string, unknown> = {}): Record<string, unknown> {
    this.calls.push({ apiFunc, params });
    const r = this.next(apiFunc);
    if (isError(r)) throw new Error(`Workbench error: ${r.error}`);
    return r;
  }
}

export interface MockNetServer {
  port: number;
  host: string;
  mock: MockNet;
  close(): Promise<void>;
}

/**
 * Listen on 127.0.0.1 (ephemeral port unless given) and answer each request
 * from `script`. The client half-closes after writing its request, as
 * `WorkbenchClient.rawCall` does; the server answers and ends the socket.
 * `silentFor` lists APIFuncs that never get an answer (to test timeouts).
 */
export function startMockNetServer(
  script: MockScript,
  opts: { port?: number; silentFor?: string[] } = {},
): Promise<MockNetServer> {
  const mock = new MockNet(script);
  const open = new Set<Socket>();
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    open.add(socket);
    socket.on("close", () => open.delete(socket));
    const chunks: Buffer[] = [];
    let answered = false;
    const answer = (): void => {
      if (answered) return;
      const req = decodeRequestFrame(Buffer.concat(chunks));
      if (!req) return;
      answered = true;
      const apiFunc = String(req.payload.APIFunc ?? "");
      const params = { ...req.payload };
      delete params.APIFunc;
      mock.calls.push({ apiFunc, params, clientId: req.clientId });
      if (opts.silentFor?.includes(apiFunc)) return;
      socket.end(encodeResponseFrame(mock.next(apiFunc)));
    };
    socket.on("data", (c) => {
      chunks.push(c);
      answer();
    });
    socket.on("end", answer);
    socket.on("error", () => {
      /* test peer went away */
    });
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolvePromise({
        port: addr.port,
        host: "127.0.0.1",
        mock,
        close: () =>
          new Promise<void>((r) => {
            // Drop lingering (silent) sockets so close() can finish.
            for (const s of open) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}
