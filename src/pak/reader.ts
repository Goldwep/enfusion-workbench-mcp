import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import { logger } from "../utils/logger.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface PakFileEntry {
  kind: "file";
  name: string;
  /** Byte offset of this file's data within the DATA chunk payload */
  offset: number;
  compressedLen: number;
  decompressedLen: number;
  compressed: boolean;
}

export interface PakDirEntry {
  kind: "dir";
  name: string;
  children: Map<string, PakDirEntry | PakFileEntry>;
}

export interface PakIndex {
  root: PakDirEntry;
  /** Absolute byte position in the .pak file where the DATA payload starts */
  dataStart: number;
  /** Path to the .pak file on disk */
  pakPath: string;
  /**
   * Format version from the HEAD chunk (u16 LE at payload offset 0), 0 when
   * absent/unreadable. 1.8 game paks carry 3 (absolute entry offsets +
   * zlib-wrapped deflate); earlier paks used DATA-relative offsets + raw
   * deflate. Used only as a read-mode hint — reads self-verify either way.
   */
  headVersion: number;
}

// ── Chunk magic constants ────────────────────────────────────────────────────

const MAGIC_FORM = 0x464f524d; // "FORM"
const MAGIC_PAC1 = 0x50414331; // "PAC1"
const MAGIC_HEAD = 0x48454144; // "HEAD"
const MAGIC_DATA = 0x44415441; // "DATA"
const MAGIC_FILE = 0x46494c45; // "FILE"

// ── Untrusted-input limits ───────────────────────────────────────────────────
// .pak files are attacker-controllable (a workshop mod ships its own). The
// header fields below are read straight from disk, so every value derived from
// them has to be sanity-checked before it drives an allocation or a recursion.

/**
 * Hard ceiling for a single entry's read size, enforced in `PakVirtualFS.readFile`
 * (not here at parse time — real game paks legitimately contain entries far
 * larger than anything callers read, e.g. 16 MB textures and 84 MB .ent files,
 * and rejecting them at parse time would discard the whole pak). Mirrors the
 * 8 MiB cap that `safe-read.ts` applies to loose text assets — every pak entry
 * the callers actually read is a script / config / prefab / anim-ref, all far
 * below this. A header that claims more is refused before the allocation and
 * `inflateRawSync`, so a lying value can never trigger a zip-bomb OOM.
 */
export const MAX_PAK_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Maximum directory nesting depth in the FILE tree. `parseEntry` recurses once
 * per directory level, so a maliciously deep tree would otherwise blow the JS
 * call stack. Real Enfusion paks nest only a handful of levels deep; 64 is well
 * past any legitimate layout while keeping recursion bounded.
 */
const MAX_DEPTH = 64;

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a .pak file's metadata without reading the DATA payload.
 * Reads chunk headers to locate the DATA and FILE sections, then parses
 * the FILE chunk's recursive entry tree into an in-memory directory structure.
 */
export function parsePakIndex(pakPath: string): PakIndex {
  const fd = openSync(pakPath, "r");
  try {
    const fileSize = fstatSync(fd).size;

    // ── FORM chunk ───────────────────────────────────────────────────────
    // Layout: "FORM" (4B) + u32BE size + "PAC1" (4B) = 12 bytes
    const formBuf = readAt(fd, 0, 12);
    const formMagic = formBuf.readUInt32BE(0);
    if (formMagic !== MAGIC_FORM) {
      throw new Error(`Not a PAK file: missing FORM header (got 0x${formMagic.toString(16)})`);
    }
    const pac1 = formBuf.readUInt32BE(8);
    if (pac1 !== MAGIC_PAC1) {
      throw new Error(`Not a PAK file: expected PAC1 identifier (got 0x${pac1.toString(16)})`);
    }

    // ── Walk chunks after FORM header ────────────────────────────────────
    // Chunks start at offset 12 (after FORM header).
    // Each chunk: magic (4B BE) + size (4B BE) + payload (size bytes).
    let pos = 12;
    let dataStart = -1;
    let fileChunkOffset = -1;
    let fileChunkLen = 0;
    let headVersion = 0;

    while (pos + 8 <= fileSize) {
      const hdr = readAt(fd, pos, 8);
      const magic = hdr.readUInt32BE(0);
      const chunkLen = hdr.readUInt32BE(4);

      // Bounds check: chunk must fit within the file
      if (chunkLen > fileSize - pos - 8) {
        throw new Error(
          `PAK chunk 0x${magic.toString(16)} at offset ${pos} has size ${chunkLen} but only ${fileSize - pos - 8} bytes remain`,
        );
      }

      if (magic === MAGIC_HEAD) {
        // Version hint lives in the first u16 LE of the HEAD payload
        // (1.8 paks carry 3; see PakIndex.headVersion).
        if (chunkLen >= 2) {
          headVersion = readAt(fd, pos + 8, 2).readUInt16LE(0);
        }
        pos += 8 + chunkLen;
      } else if (magic === MAGIC_DATA) {
        // Record where the DATA payload begins (right after its 8-byte header)
        dataStart = pos + 8;
        pos += 8 + chunkLen;
      } else if (magic === MAGIC_FILE) {
        fileChunkOffset = pos + 8;
        fileChunkLen = chunkLen;
        break; // FILE is the last chunk we care about
      } else {
        // Unknown chunk — skip it
        logger.debug(`PAK unknown chunk 0x${magic.toString(16)} at offset ${pos}, skipping`);
        pos += 8 + chunkLen;
      }
    }

    if (dataStart < 0) {
      throw new Error("PAK file missing DATA chunk");
    }
    if (fileChunkOffset < 0) {
      throw new Error("PAK file missing FILE chunk");
    }

    // ── Parse FILE chunk ─────────────────────────────────────────────────
    const fileBuf = readAt(fd, fileChunkOffset, fileChunkLen);
    const root = parseFileTree(fileBuf);

    return { root, dataStart, pakPath, headVersion };
  } finally {
    closeSync(fd);
  }
}

// ── FILE tree parser ─────────────────────────────────────────────────────────

/**
 * Parse the recursive file entry tree from the FILE chunk payload.
 *
 * The tree is parsed recursively (one `parseEntry` call per directory level),
 * so recursion depth is capped at MAX_DEPTH to keep a maliciously deep tree
 * from overflowing the call stack. Every fixed-width field read is bounds-
 * checked against the buffer first, so a truncated FILE chunk yields a friendly
 * error instead of a raw RangeError.
 */
function parseFileTree(buf: Buffer): PakDirEntry {
  const state = { offset: 0 };

  // The FILE chunk contains a single root entry (always a directory)
  const root = parseEntry(buf, state, 0);
  if (root.kind !== "dir") {
    throw new Error("PAK FILE chunk root entry is not a directory");
  }
  return root;
}

/** Guard that `count` bytes are readable at `offset` before a fixed-width read. */
function ensureBytes(buf: Buffer, offset: number, count: number): void {
  if (offset + count > buf.length) {
    throw new Error(
      `PAK FILE chunk truncated: need ${count} bytes at offset ${offset} but buffer is only ${buf.length} bytes`,
    );
  }
}

function parseEntry(
  buf: Buffer,
  state: { offset: number },
  depth: number,
): PakDirEntry | PakFileEntry {
  if (depth > MAX_DEPTH) {
    throw new Error(`PAK FILE tree exceeds maximum nesting depth (${MAX_DEPTH})`);
  }

  ensureBytes(buf, state.offset, 2); // entryKind (u8) + nameLen (u8)
  const entryKind = buf.readUInt8(state.offset);
  state.offset += 1;

  const nameLen = buf.readUInt8(state.offset);
  state.offset += 1;

  if (state.offset + nameLen > buf.length) {
    throw new Error(
      `PAK entry name length ${nameLen} exceeds buffer at offset ${state.offset} (buffer size ${buf.length})`,
    );
  }

  const name = buf.toString("utf8", state.offset, state.offset + nameLen);
  state.offset += nameLen;

  if (entryKind === 0) {
    // Directory
    ensureBytes(buf, state.offset, 4); // childCount (u32LE)
    const childCount = buf.readUInt32LE(state.offset);
    state.offset += 4;

    const children = new Map<string, PakDirEntry | PakFileEntry>();
    for (let i = 0; i < childCount; i++) {
      const child = parseEntry(buf, state, depth + 1);
      children.set(child.name, child);
    }

    return { kind: "dir", name, children };
  } else {
    // File: offset (u32LE) + compressedLen (u32LE) + decompressedLen (u32LE)
    //       + unknown (u32LE) + unk2 (u16LE) + compressed (u8)
    //       + compression_level (u8) + timestamp (u32LE) = 20 bytes total
    ensureBytes(buf, state.offset, 20);

    const offset = buf.readUInt32LE(state.offset);
    state.offset += 4;

    const compressedLen = buf.readUInt32LE(state.offset);
    state.offset += 4;

    const decompressedLen = buf.readUInt32LE(state.offset);
    state.offset += 4;

    // No size ceiling here: parse time only records the declared lengths.
    // Real paks contain entries well past MAX_PAK_FILE_BYTES (textures, .ent
    // worlds), and throwing here would reject the entire pak. The ceiling is
    // enforced in PakVirtualFS.readFile, before any allocation or inflate.

    // Skip unknown (u32LE) + unk2 (u16LE)
    state.offset += 6;

    const compressed = buf.readUInt8(state.offset) !== 0;
    state.offset += 1;

    // Skip compression_level (u8) + timestamp (u32LE)
    state.offset += 5;

    return {
      kind: "file",
      name,
      offset,
      compressedLen,
      decompressedLen,
      compressed,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const bytesRead = readSync(fd, buf, 0, length, position);
  if (bytesRead < length) {
    throw new Error(
      `Unexpected EOF: wanted ${length} bytes at offset ${position}, got ${bytesRead}`,
    );
  }
  return buf;
}
