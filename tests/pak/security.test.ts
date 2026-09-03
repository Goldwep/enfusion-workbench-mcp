import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { parsePakIndex, MAX_PAK_FILE_BYTES } from "../../src/pak/reader.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";

/**
 * Hand-rolled malformed-.pak builders for the untrusted-binary attack surface
 * (PAK-1..4). These deliberately produce buffers that a well-behaved packer
 * would never emit: lying decompressedLen headers, truncated FILE chunks, and
 * pathologically deep directory trees. The point is that the parser/reader
 * refuses them with a friendly error rather than OOMing or throwing a raw
 * RangeError / blowing the call stack.
 */

// ── Low-level chunk assembly ─────────────────────────────────────────────────

/** Wrap a payload in the FORM/PAC1 + HEAD + DATA + FILE chunk envelope. */
function assemblePak(dataPayload: Buffer, fileTreeBuf: Buffer): Buffer {
  const headLen = 0x1c;
  const headPayload = Buffer.alloc(headLen);

  const totalPayload = 4 + 8 + headLen + 8 + dataPayload.length + 8 + fileTreeBuf.length;
  const buf = Buffer.alloc(8 + totalPayload);
  let pos = 0;

  buf.write("FORM", pos, 4, "ascii");
  pos += 4;
  buf.writeUInt32BE(totalPayload, pos);
  pos += 4;
  buf.write("PAC1", pos, 4, "ascii");
  pos += 4;

  buf.write("HEAD", pos, 4, "ascii");
  pos += 4;
  buf.writeUInt32BE(headLen, pos);
  pos += 4;
  headPayload.copy(buf, pos);
  pos += headLen;

  buf.write("DATA", pos, 4, "ascii");
  pos += 4;
  buf.writeUInt32BE(dataPayload.length, pos);
  pos += 4;
  dataPayload.copy(buf, pos);
  pos += dataPayload.length;

  buf.write("FILE", pos, 4, "ascii");
  pos += 4;
  buf.writeUInt32BE(fileTreeBuf.length, pos);
  pos += 4;
  fileTreeBuf.copy(buf, pos);

  return buf;
}

/** Serialize a single file entry into the FILE-tree wire format. */
function fileEntry(opts: {
  name: string;
  offset: number;
  compressedLen: number;
  decompressedLen: number;
  compressed: boolean;
}): Buffer {
  const nameBuf = Buffer.from(opts.name, "utf-8");
  const header = Buffer.alloc(2);
  header.writeUInt8(1, 0); // kind = file
  header.writeUInt8(nameBuf.length, 1);

  const meta = Buffer.alloc(20); // offset+cLen+dLen+unknown+unk2+compressed+lvl+ts
  meta.writeUInt32LE(opts.offset, 0);
  meta.writeUInt32LE(opts.compressedLen, 4);
  meta.writeUInt32LE(opts.decompressedLen, 8);
  meta.writeUInt32LE(0, 12);
  meta.writeUInt16LE(0, 16);
  meta.writeUInt8(opts.compressed ? 1 : 0, 18);
  meta.writeUInt8(opts.compressed ? 6 : 0, 19);
  const ts = Buffer.alloc(4);
  ts.writeUInt32LE(0, 0);

  return Buffer.concat([header, nameBuf, meta, ts]);
}

/** Serialize a directory header (kind + name + childCount). */
function dirHeader(name: string, childCount: number): Buffer {
  const nameBuf = Buffer.from(name, "utf-8");
  const header = Buffer.alloc(2);
  header.writeUInt8(0, 0); // kind = dir
  header.writeUInt8(nameBuf.length, 1);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(childCount, 0);
  return Buffer.concat([header, nameBuf, count]);
}

// ── Test fixtures ────────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), "enfusion-mcp-pak-security-" + process.pid);
const GAME_DIR = join(TEST_DIR, "game");
const ADDONS_DIR = join(GAME_DIR, "addons");

function resetSingleton(): void {
  (PakVirtualFS as any).instance = null;
  (PakVirtualFS as any).instanceGamePath = null;
}

beforeAll(() => {
  mkdirSync(ADDONS_DIR, { recursive: true });
});

afterAll(() => {
  resetSingleton();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── PAK-1: oversized decompressedLen is refused at readFile time ─────────────

describe("PAK-1: zip-bomb / oversized decompressedLen", () => {
  it("indexes an oversized entry but refuses to read it (no OOM)", () => {
    // A tiny compressed payload but a header that LIES, claiming it expands to
    // 4 GiB. Parse time must accept it (real paks contain legitimately huge
    // entries — rejecting one entry would sink the whole pak), but readFile
    // must refuse it before any allocation or inflate is attempted.
    const tiny = deflateRawSync(Buffer.from("x"));
    const data = tiny;
    const tree = Buffer.concat([
      dirHeader("", 2),
      fileEntry({
        name: "bomb.c",
        offset: 0,
        compressedLen: tiny.length,
        decompressedLen: 0xffffffff, // ~4 GiB lie
        compressed: true,
      }),
      fileEntry({
        name: "ok.c",
        offset: 0,
        compressedLen: 0,
        decompressedLen: tiny.length,
        compressed: false,
      }),
    ]);

    // Parse time keeps the entry — the ceiling no longer applies here.
    const pakPath = join(TEST_DIR, "bomb-decl.pak");
    writeFileSync(pakPath, assemblePak(data, tree));
    const index = parsePakIndex(pakPath);
    expect(index.root.children.has("bomb.c")).toBe(true);

    // readFile refuses the oversized entry but the rest of the pak still works.
    resetSingleton();
    rmSync(ADDONS_DIR, { recursive: true, force: true });
    mkdirSync(ADDONS_DIR, { recursive: true });
    writeFileSync(join(ADDONS_DIR, "bomb-decl.pak"), assemblePak(data, tree));

    const vfs = PakVirtualFS.get(GAME_DIR)!;
    expect(vfs).not.toBeNull();
    expect(vfs.exists("bomb.c")).toBe(true);
    expect(() => vfs.readFile("bomb.c")).toThrow(/exceeds|cap/i);
    expect(vfs.readFile("ok.c")).toEqual(data);

    resetSingleton();
    rmSync(ADDONS_DIR, { recursive: true, force: true });
    mkdirSync(ADDONS_DIR, { recursive: true });
  });

  it("MAX_PAK_FILE_BYTES is a sane positive ceiling", () => {
    expect(MAX_PAK_FILE_BYTES).toBeGreaterThan(0);
    expect(MAX_PAK_FILE_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  it("readFile caps inflate output so a runtime zip bomb cannot OOM", () => {
    // Forge a pak that PASSES parse-time checks (decompressedLen within the
    // ceiling) but whose compressed payload actually expands far beyond it.
    // The maxOutputLength cap on inflateRawSync must make the inflate abort.
    const huge = Buffer.alloc(MAX_PAK_FILE_BYTES + 1024 * 1024, 0x41); // highly compressible
    const compressed = deflateRawSync(huge);
    const data = compressed;
    const tree = Buffer.concat([
      dirHeader("", 1),
      fileEntry({
        name: "lie.c",
        offset: 0,
        compressedLen: compressed.length,
        // Lie: claim it stays just under the ceiling so parse-time accepts it.
        decompressedLen: 1024,
        compressed: true,
      }),
    ]);

    resetSingleton();
    rmSync(ADDONS_DIR, { recursive: true, force: true });
    mkdirSync(ADDONS_DIR, { recursive: true });
    writeFileSync(join(ADDONS_DIR, "lie.pak"), assemblePak(data, tree));

    const vfs = PakVirtualFS.get(GAME_DIR)!;
    expect(vfs).not.toBeNull();
    // inflate must refuse — zlib throws when output would exceed maxOutputLength.
    expect(() => vfs.readFile("lie.c")).toThrow();

    resetSingleton();
    rmSync(ADDONS_DIR, { recursive: true, force: true });
    mkdirSync(ADDONS_DIR, { recursive: true });
  });
});

// ── PAK-2: truncated FILE chunk → friendly error, not raw RangeError ─────────

describe("PAK-2: truncated FILE chunk bounds", () => {
  it("gives a friendly error (not a raw RangeError) on a truncated file entry", () => {
    // Directory claims one child, then the buffer is cut off mid-entry so the
    // fixed-width meta reads would run past the end.
    const tree = Buffer.concat([
      dirHeader("", 1),
      // Start of a file entry but truncated: kind + nameLen + partial name only.
      Buffer.from([1, 4]), // file, nameLen=4
      Buffer.from("ab"), // only 2 of the 4 promised name bytes
    ]);

    const pakPath = join(TEST_DIR, "truncated-entry.pak");
    writeFileSync(pakPath, assemblePak(Buffer.alloc(0), tree));

    let err: unknown;
    try {
      parsePakIndex(pakPath);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // Must be our guarded message, not zlib/Buffer's raw "out of range".
    expect((err as Error).message).toMatch(/truncated|exceeds buffer/i);
    expect((err as Error).name).not.toBe("RangeError");
  });

  it("gives a friendly error when a dir childCount read runs past the end", () => {
    const tree = Buffer.concat([
      // dir header with nameLen=0 but the 4-byte childCount is cut off.
      Buffer.from([0, 0]),
      Buffer.from([0x01, 0x02]), // only 2 of 4 childCount bytes
    ]);

    const pakPath = join(TEST_DIR, "truncated-count.pak");
    writeFileSync(pakPath, assemblePak(Buffer.alloc(0), tree));

    expect(() => parsePakIndex(pakPath)).toThrow(/truncated/i);
  });
});

// ── PAK-3: deeply nested tree hits the depth cap, not a stack overflow ───────

describe("PAK-3: directory nesting depth cap", () => {
  it("refuses a pathologically deep tree instead of overflowing the stack", () => {
    // Build a chain of nested single-child directories deeper than MAX_DEPTH.
    const DEPTH = 5000;
    const parts: Buffer[] = [];
    for (let i = 0; i < DEPTH; i++) {
      parts.push(dirHeader("d", 1)); // each dir has exactly one child: the next dir
    }
    parts.push(dirHeader("leaf", 0)); // terminal empty dir
    const tree = Buffer.concat(parts);

    const pakPath = join(TEST_DIR, "deep.pak");
    writeFileSync(pakPath, assemblePak(Buffer.alloc(0), tree));

    expect(() => parsePakIndex(pakPath)).toThrow(/nesting depth/i);
  });

  it("accepts a tree nested within the depth cap", () => {
    const DEPTH = 10;
    const parts: Buffer[] = [];
    for (let i = 0; i < DEPTH; i++) {
      parts.push(dirHeader("d", 1));
    }
    parts.push(dirHeader("leaf", 0));
    const tree = Buffer.concat(parts);

    const pakPath = join(TEST_DIR, "shallow.pak");
    writeFileSync(pakPath, assemblePak(Buffer.alloc(0), tree));

    expect(() => parsePakIndex(pakPath)).not.toThrow();
  });
});

// ── PAK-4: read window must fit the .pak on disk ─────────────────────────────

describe("PAK-4: read window bounds vs. DATA chunk", () => {
  it("refuses a file whose offset+len points past the end of the .pak", () => {
    // A real, small DATA payload but a file entry whose offset/len reach far
    // beyond it. readFile must reject before allocating / reading past EOF.
    const realData = Buffer.from("hello");
    const tree = Buffer.concat([
      dirHeader("", 1),
      fileEntry({
        name: "oob.c",
        offset: 0,
        compressedLen: 0, // not compressed; use decompressedLen as readLen
        decompressedLen: 1024 * 1024, // way bigger than the 5-byte DATA payload
        compressed: false,
      }),
    ]);

    resetSingleton();
    rmSync(ADDONS_DIR, { recursive: true, force: true });
    mkdirSync(ADDONS_DIR, { recursive: true });
    writeFileSync(join(ADDONS_DIR, "oob.pak"), assemblePak(realData, tree));

    const vfs = PakVirtualFS.get(GAME_DIR)!;
    expect(vfs).not.toBeNull();
    expect(() => vfs.readFile("oob.c")).toThrow(/outside the .pak|Truncated read/i);

    resetSingleton();
    rmSync(ADDONS_DIR, { recursive: true, force: true });
    mkdirSync(ADDONS_DIR, { recursive: true });
  });
});
