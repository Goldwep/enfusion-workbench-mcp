import { describe, it, expect } from "vitest";
import { createSocket } from "node:dgram";
import {
  buildA2SInfoRequest,
  formatHealthReport,
  parseA2SInfoResponse,
  queryA2S,
  validateHost,
  type A2SInfoResult,
} from "../../src/server-mgmt/a2s.js";

describe("a2s — buildA2SInfoRequest", () => {
  it("emits the canonical request without a challenge", () => {
    const buf = buildA2SInfoRequest();
    // FF FF FF FF 54 + "Source Engine Query\0"
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xff);
    expect(buf[2]).toBe(0xff);
    expect(buf[3]).toBe(0xff);
    expect(buf[4]).toBe(0x54);
    expect(buf.subarray(5).toString("utf-8")).toBe("Source Engine Query\0");
  });

  it("appends the LE int32 challenge when given", () => {
    const buf = buildA2SInfoRequest(0x12345678);
    expect(buf.readInt32LE(buf.length - 4)).toBe(0x12345678);
  });
});

describe("a2s — parseA2SInfoResponse", () => {
  /** Helper: build a synthetic info response with a chosen EDF mask. */
  function buildInfoResponse(opts: {
    name: string;
    map: string;
    folder: string;
    game: string;
    appId: number;
    players: number;
    maxPlayers: number;
    bots: number;
    serverType: string;
    environment: string;
    pw: boolean;
    vac: boolean;
    version: string;
    edf?: number;
  }): Buffer {
    const c = (s: string) => Buffer.from(s + "\0", "utf-8");
    const numerics = Buffer.alloc(9);
    // appId is u16 in the A2S wire format — truncate test inputs that exceed 0xFFFF.
    numerics.writeUInt16LE(opts.appId & 0xffff, 0);
    numerics[2] = opts.players;
    numerics[3] = opts.maxPlayers;
    numerics[4] = opts.bots;
    numerics[5] = opts.serverType.charCodeAt(0);
    numerics[6] = opts.environment.charCodeAt(0);
    numerics[7] = opts.pw ? 1 : 0;
    numerics[8] = opts.vac ? 1 : 0;
    const parts: Buffer[] = [
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49]),
      Buffer.from([17]), // protocol byte
      c(opts.name),
      c(opts.map),
      c(opts.folder),
      c(opts.game),
      numerics,
      c(opts.version),
    ];
    if (opts.edf !== undefined) parts.push(Buffer.from([opts.edf]));
    return Buffer.concat(parts);
  }

  it("parses a minimal A2S_INFO response (no EDF)", () => {
    const buf = buildInfoResponse({
      name: "Test Server",
      map: "Eden",
      folder: "armaR",
      game: "Arma Reforger",
      appId: 1874880,
      players: 5,
      maxPlayers: 32,
      bots: 2,
      serverType: "d",
      environment: "w",
      pw: false,
      vac: false,
      version: "1.4.0",
    });
    const parsed = parseA2SInfoResponse(buf);
    if (parsed.kind !== "info") throw new Error("expected info");
    expect(parsed.info.name).toBe("Test Server");
    expect(parsed.info.map).toBe("Eden");
    expect(parsed.info.folder).toBe("armaR");
    expect(parsed.info.game).toBe("Arma Reforger");
    // appId is u16 — 1874880 wraps; verify the raw read value.
    expect(parsed.info.appId).toBe(1874880 & 0xffff);
    expect(parsed.info.players).toBe(5);
    expect(parsed.info.maxPlayers).toBe(32);
    expect(parsed.info.bots).toBe(2);
    expect(parsed.info.serverType).toBe("d");
    expect(parsed.info.environment).toBe("w");
    expect(parsed.info.passwordProtected).toBe(false);
    expect(parsed.info.vac).toBe(false);
    expect(parsed.info.version).toBe("1.4.0");
  });

  it("parses a challenge response", () => {
    const buf = Buffer.alloc(9);
    buf[0] = 0xff;
    buf[1] = 0xff;
    buf[2] = 0xff;
    buf[3] = 0xff;
    buf[4] = 0x41; // challenge opcode
    buf.writeInt32LE(0xCAFEBABE | 0, 5);
    const parsed = parseA2SInfoResponse(buf);
    expect(parsed.kind).toBe("challenge");
    if (parsed.kind === "challenge") {
      expect(parsed.token).toBe(0xCAFEBABE | 0);
    }
  });

  it("rejects bad header", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49]);
    expect(() => parseA2SInfoResponse(buf)).toThrow(/header/);
  });

  it("rejects unexpected opcode", () => {
    const buf = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7f]);
    expect(() => parseA2SInfoResponse(buf)).toThrow(/opcode/);
  });

  it("rejects truncated response", () => {
    expect(() => parseA2SInfoResponse(Buffer.from([0xff, 0xff]))).toThrow(/short/);
  });

  it("parses EDF gamePort extension when bit 0x80 set", () => {
    const base = buildInfoResponse({
      name: "n",
      map: "m",
      folder: "f",
      game: "g",
      appId: 1,
      players: 0,
      maxPlayers: 0,
      bots: 0,
      serverType: "d",
      environment: "w",
      pw: false,
      vac: false,
      version: "1",
      edf: 0x80,
    });
    const gp = Buffer.alloc(2);
    gp.writeUInt16LE(2001, 0);
    const buf = Buffer.concat([base, gp]);
    const parsed = parseA2SInfoResponse(buf);
    if (parsed.kind !== "info") throw new Error("expected info");
    expect(parsed.info.gamePort).toBe(2001);
  });
});

describe("a2s — validateHost", () => {
  it("accepts hostnames and dotted-quad", () => {
    expect(() => validateHost("example.com")).not.toThrow();
    expect(() => validateHost("127.0.0.1")).not.toThrow();
  });

  it("rejects empty / flag-like / metachar inputs", () => {
    expect(() => validateHost("")).toThrow();
    expect(() => validateHost("-evil")).toThrow(/CLI flag/);
    expect(() => validateHost("foo bar")).toThrow(/forbidden/);
    expect(() => validateHost("foo;ls")).toThrow(/forbidden/);
    expect(() => validateHost("foo$VAR")).toThrow(/forbidden/);
  });
});

describe("a2s — queryA2S (integration with synthetic server)", () => {
  it("performs the challenge round-trip and returns info", async () => {
    const server = createSocket("udp4");
    await new Promise<void>((res) => server.bind(0, "127.0.0.1", res));
    const addr = server.address();
    if (typeof addr === "string") throw new Error("expected AddressInfo");
    const port = addr.port;

    let receivedChallenge = false;
    server.on("message", (msg, rinfo) => {
      // First request: send a challenge. Second: send the info reply.
      if (!receivedChallenge) {
        receivedChallenge = true;
        const ch = Buffer.alloc(9);
        ch[0] = ch[1] = ch[2] = ch[3] = 0xff;
        ch[4] = 0x41;
        ch.writeInt32LE(0xdeadbeef | 0, 5);
        server.send(ch, rinfo.port, rinfo.address);
        return;
      }
      // Verify the second request carried the challenge.
      expect(msg.readInt32LE(msg.length - 4)).toBe(0xdeadbeef | 0);

      const c = (s: string) => Buffer.from(s + "\0", "utf-8");
      const numerics = Buffer.alloc(9);
      numerics.writeUInt16LE(1874880 & 0xffff, 0);
      numerics[2] = 3;
      numerics[3] = 16;
      numerics[4] = 0;
      numerics[5] = "d".charCodeAt(0);
      numerics[6] = "w".charCodeAt(0);
      numerics[7] = 0;
      numerics[8] = 0;
      const info = Buffer.concat([
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
        c("MySrv"),
        c("Eden"),
        c("armaR"),
        c("Arma Reforger"),
        numerics,
        c("1.4.0"),
        Buffer.from([0x00]),
      ]);
      server.send(info, rinfo.port, rinfo.address);
    });

    try {
      const result = await queryA2S("127.0.0.1", port, 3000);
      expect(result.name).toBe("MySrv");
      expect(result.map).toBe("Eden");
      expect(result.players).toBe(3);
      expect(result.maxPlayers).toBe(16);
      expect(result.version).toBe("1.4.0");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it("times out cleanly when no server responds", async () => {
    // Bind a socket and immediately close — that releases the port; any
    // datagram to it will silently drop on most platforms, so the client
    // times out. (We can't rely on a guaranteed-free port without binding,
    // so this is the simplest cross-platform way to provoke a timeout.)
    const tmp = createSocket("udp4");
    await new Promise<void>((res) => tmp.bind(0, "127.0.0.1", res));
    const addr = tmp.address();
    if (typeof addr === "string") throw new Error("expected AddressInfo");
    const closedPort = addr.port;
    await new Promise<void>((res) => tmp.close(() => res()));

    await expect(queryA2S("127.0.0.1", closedPort, 200)).rejects.toThrow(
      /timed out/,
    );
  });

  it("validates inputs before opening any socket", async () => {
    await expect(queryA2S("-evil", 17777, 500)).rejects.toThrow(/CLI flag/);
    await expect(queryA2S("127.0.0.1", 70000, 500)).rejects.toThrow(/port/);
    await expect(queryA2S("127.0.0.1", 17777, 0)).rejects.toThrow(/timeout_ms/);
  });
});

describe("a2s — formatHealthReport", () => {
  it("renders the markdown report with all the expected fields", () => {
    const info: A2SInfoResult = {
      name: "My Server",
      map: "Eden",
      folder: "armaR",
      game: "Arma Reforger",
      appId: 1874880 & 0xffff,
      players: 12,
      maxPlayers: 32,
      bots: 0,
      serverType: "d",
      environment: "w",
      passwordProtected: false,
      vac: false,
      version: "1.4.0",
      gamePort: 2001,
    };
    const text = formatHealthReport("example.com", 17777, info);
    expect(text).toContain("## Server health: `example.com:17777`");
    expect(text).toContain("My Server");
    expect(text).toContain("12 / 32");
    expect(text).toContain("1.4.0");
    expect(text).toContain("Game port:** 2001");
  });
});
