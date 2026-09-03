import { describe, it, expect } from "vitest";
import {
  encodeInt32LE,
  decodeInt32LE,
  encodePascalString,
  decodePascalString,
  encodeRequest,
  decodeResponse,
} from "../../src/workbench/protocol.js";

describe("protocol", () => {
  describe("encodeInt32LE / decodeInt32LE", () => {
    it("encodes 0", () => {
      const buf = encodeInt32LE(0);
      expect(buf).toEqual(Buffer.from([0, 0, 0, 0]));
    });

    it("encodes 1 as little-endian", () => {
      const buf = encodeInt32LE(1);
      expect(buf).toEqual(Buffer.from([1, 0, 0, 0]));
    });

    it("encodes 256", () => {
      const buf = encodeInt32LE(256);
      expect(buf).toEqual(Buffer.from([0, 1, 0, 0]));
    });

    it("encodes negative values", () => {
      const buf = encodeInt32LE(-1);
      expect(buf).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    });

    it("round-trips arbitrary values", () => {
      for (const val of [0, 1, 127, 255, 256, 65535, 1000000, -1, -42]) {
        const buf = encodeInt32LE(val);
        const { value, bytesRead } = decodeInt32LE(buf, 0);
        expect(value).toBe(val);
        expect(bytesRead).toBe(4);
      }
    });

    it("decodes at non-zero offset", () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32LE(42, 4);
      const { value } = decodeInt32LE(buf, 4);
      expect(value).toBe(42);
    });

    it("throws if buffer too short", () => {
      expect(() => decodeInt32LE(Buffer.alloc(2), 0)).toThrow("Buffer too short");
    });
  });

  describe("encodePascalString / decodePascalString", () => {
    it("encodes empty string", () => {
      const buf = encodePascalString("");
      expect(buf.length).toBe(4); // just the length prefix
      const { value } = decodePascalString(buf, 0);
      expect(value).toBe("");
    });

    it("round-trips ASCII strings", () => {
      const s = "Hello, Workbench!";
      const buf = encodePascalString(s);
      expect(buf.length).toBe(4 + s.length);
      const { value, bytesRead } = decodePascalString(buf, 0);
      expect(value).toBe(s);
      expect(bytesRead).toBe(4 + s.length);
    });

    it("round-trips UTF-8 strings", () => {
      const s = "Ünïcödé テスト";
      const buf = encodePascalString(s);
      const { value } = decodePascalString(buf, 0);
      expect(value).toBe(s);
    });

    it("decodes at non-zero offset", () => {
      const prefix = Buffer.from([0xaa, 0xbb]);
      const encoded = encodePascalString("test");
      const combined = Buffer.concat([prefix, encoded]);
      const { value } = decodePascalString(combined, 2);
      expect(value).toBe("test");
    });

    it("throws if buffer too short for length", () => {
      expect(() => decodePascalString(Buffer.alloc(2), 0)).toThrow("Buffer too short");
    });

    it("throws if buffer too short for content", () => {
      const buf = Buffer.alloc(5);
      buf.writeInt32LE(100, 0); // claims 100 bytes but only 1 available
      expect(() => decodePascalString(buf, 0)).toThrow("Buffer too short");
    });
  });

  describe("encodeRequest", () => {
    it("produces correct wire format", () => {
      const buf = encodeRequest("TestClient", "ReloadScripts");

      // Protocol version = 1
      expect(buf.readInt32LE(0)).toBe(1);

      // Client ID
      let offset = 4;
      const clientIdLen = buf.readInt32LE(offset);
      expect(clientIdLen).toBe(10); // "TestClient"
      offset += 4;
      const clientId = buf.toString("utf-8", offset, offset + clientIdLen);
      expect(clientId).toBe("TestClient");
      offset += clientIdLen;

      // Content type
      const contentTypeLen = buf.readInt32LE(offset);
      expect(contentTypeLen).toBe(7); // "JsonRPC"
      offset += 4;
      const contentType = buf.toString("utf-8", offset, offset + contentTypeLen);
      expect(contentType).toBe("JsonRPC");
      offset += contentTypeLen;

      // Payload
      const payloadLen = buf.readInt32LE(offset);
      offset += 4;
      const payload = buf.toString("utf-8", offset, offset + payloadLen);
      const parsed = JSON.parse(payload);
      expect(parsed.APIFunc).toBe("ReloadScripts");
    });

    it("includes params in payload", () => {
      const buf = encodeRequest("C", "EMCP_WB_Ping", { foo: "bar", n: 42 });

      // Find payload (skip version + clientId + contentType)
      let offset = 4;
      const { bytesRead: b1 } = decodePascalString(buf, offset);
      offset += b1;
      const { bytesRead: b2 } = decodePascalString(buf, offset);
      offset += b2;
      const { value: payload } = decodePascalString(buf, offset);

      const parsed = JSON.parse(payload);
      expect(parsed.APIFunc).toBe("EMCP_WB_Ping");
      expect(parsed.foo).toBe("bar");
      expect(parsed.n).toBe(42);
    });
  });

  describe("decodeResponse", () => {
    it("decodes status + JSON payload (real Workbench format)", () => {
      const status = encodePascalString("Ok");
      const payload = encodePascalString(JSON.stringify({ count: 5, items: ["a"] }));
      const buf = Buffer.concat([status, payload]);
      const result = decodeResponse<{ count: number; items: string[] }>(buf);
      expect(result.count).toBe(5);
      expect(result.items).toEqual(["a"]);
    });

    it("throws on error status (e.g. Undefined API func)", () => {
      const buf = encodePascalString("Undefined API func");
      expect(() => decodeResponse(buf)).toThrow("Workbench error: Undefined API func");
    });

    it("throws on invalid JSON in payload", () => {
      const status = encodePascalString("Ok");
      const payload = encodePascalString("not json at all");
      const buf = Buffer.concat([status, payload]);
      expect(() => decodeResponse(buf)).toThrow("Failed to parse response JSON");
    });

    it("throws on empty buffer", () => {
      expect(() => decodeResponse(Buffer.alloc(0))).toThrow("Buffer too short");
    });
  });

  describe("decodePascalString malformed lengths", () => {
    it("throws on a negative length prefix", () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32LE(-5, 0);
      expect(() => decodePascalString(buf, 0)).toThrow(/Invalid string length: -5/);
    });

    it("throws on a length above the 16 MB cap without allocating", () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32LE(16 * 1024 * 1024 + 1, 0);
      expect(() => decodePascalString(buf, 0)).toThrow(/exceeds maximum allowed/);
    });

    it("accepts a length exactly at the cap only when the bytes are present", () => {
      const buf = Buffer.alloc(8);
      buf.writeInt32LE(16 * 1024 * 1024, 0);
      // Length is legal, but the buffer is short → "too short", not "exceeds".
      expect(() => decodePascalString(buf, 0)).toThrow(/Buffer too short/);
    });
  });

  describe("decodeResponse truncated second string", () => {
    it("throws 'Buffer too short' when the payload length prefix is cut off", () => {
      const status = encodePascalString("Ok");
      const truncatedPrefix = Buffer.from([0x10, 0x00]); // half an int32
      expect(() => decodeResponse(Buffer.concat([status, truncatedPrefix]))).toThrow(
        /Buffer too short to read int32/,
      );
    });

    it("throws 'Buffer too short' when the payload body is cut off mid-way", () => {
      const status = encodePascalString("Ok");
      const payload = encodePascalString(JSON.stringify({ count: 5, items: ["a", "b"] }));
      const truncated = payload.subarray(0, payload.length - 4);
      expect(() => decodeResponse(Buffer.concat([status, truncated]))).toThrow(
        /Buffer too short to read string/,
      );
    });

    it("does not surface a truncated body as a JSON parse error", () => {
      const status = encodePascalString("Ok");
      const payload = encodePascalString(JSON.stringify({ a: 1 }));
      const truncated = payload.subarray(0, payload.length - 1);
      expect(() => decodeResponse(Buffer.concat([status, truncated]))).not.toThrow(
        /Failed to parse response JSON/,
      );
    });
  });

  describe("decodeResponse edge cases", () => {
    it("should throw when status is Ok but no payload follows", () => {
      // Encode just "Ok" status with no payload
      const buf = encodePascalString("Ok");
      expect(() => decodeResponse(buf)).toThrow(/no payload/i);
    });

    it("should throw when status is Ok but payload is empty string", () => {
      const buf = Buffer.concat([encodePascalString("Ok"), encodePascalString("")]);
      expect(() => decodeResponse(buf)).toThrow(/empty payload/i);
    });
  });
});
