import { openSync, readSync, closeSync, fstatSync, readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import {
  parsePakIndex,
  MAX_PAK_FILE_BYTES,
  type PakIndex,
  type PakDirEntry,
  type PakFileEntry,
} from "./reader.js";
import { logger } from "../utils/logger.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface VfsEntry {
  name: string;
  isDirectory: boolean;
  /** Decompressed size for files, 0 for directories */
  size: number;
}

interface FileRef {
  pakPath: string;
  dataStart: number;
  entry: PakFileEntry;
}

/**
 * Per-pak read-mode record. Reforger 1.8 changed the pak generation: entry
 * offsets became absolute file positions (previously DATA-relative) and
 * compressed payloads gained a zlib wrapper (previously raw deflate). The
 * HEAD version (3 on 1.8 paks) picks the preferred interpretation; the first
 * successful compressed read locks the verified mode for the pak.
 */
interface PakReadMode {
  headVersion: number;
  verified?: { absoluteOffsets: boolean; zlibWrapped: boolean };
}

/** RFC 1950: byte 0 low nibble = deflate(8), and (CMF<<8|FLG) % 31 === 0. */
function looksZlibWrapped(buf: Buffer): boolean {
  return buf.length >= 2 && (buf[0] & 0x0f) === 8 && ((buf[0] << 8) | buf[1]) % 31 === 0;
}

// ── PakVirtualFS ─────────────────────────────────────────────────────────────

/**
 * Virtual filesystem that merges all .pak files in the game's addons/ directory
 * into a single unified file tree. Supports directory listing, file existence
 * checks, and on-demand file reading with automatic zlib decompression.
 *
 * Instantiated lazily as a singleton and cached for the session lifetime.
 */
export class PakVirtualFS {
  private static instance: PakVirtualFS | null = null;
  private static instanceGamePath: string | null = null;

  /** Flat lookup: normalized virtual path → file reference */
  private fileIndex = new Map<string, FileRef>();
  /** Per-pak generation info: pakPath → HEAD version + verified read mode */
  private pakModes = new Map<string, PakReadMode>();
  /** Merged directory tree for browsing */
  private root: PakDirEntry = { kind: "dir", name: "", children: new Map() };

  /** Clear the cached VFS instance, forcing a fresh rebuild on next get(). */
  static invalidate(): void {
    PakVirtualFS.instance = null;
    PakVirtualFS.instanceGamePath = null;
  }

  /**
   * Get or create the singleton VFS for the given game path.
   * Returns null if no .pak files are found.
   */
  static get(gamePath: string): PakVirtualFS | null {
    if (PakVirtualFS.instance && PakVirtualFS.instanceGamePath === gamePath) {
      return PakVirtualFS.instance;
    }

    const addonsPath = join(gamePath, "addons");
    if (!existsSync(addonsPath)) return null;

    let pakFiles: string[];
    try {
      // Scan addons/ directly, then one level deep (e.g. addons/data/, addons/core/)
      const topEntries = readdirSync(addonsPath, { withFileTypes: true });
      pakFiles = topEntries
        .filter((e) => e.isFile() && extname(e.name).toLowerCase() === ".pak")
        .map((e) => join(addonsPath, e.name));

      for (const entry of topEntries) {
        if (!entry.isDirectory()) continue;
        try {
          const subEntries = readdirSync(join(addonsPath, entry.name), { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isFile() && extname(sub.name).toLowerCase() === ".pak") {
              pakFiles.push(join(addonsPath, entry.name, sub.name));
            }
          }
        } catch {
          // Skip unreadable subdirectories
        }
      }

      pakFiles.sort(); // deterministic order — first pak alphabetically wins on duplicates
    } catch {
      return null;
    }

    if (pakFiles.length === 0) return null;

    const vfs = new PakVirtualFS(pakFiles);
    PakVirtualFS.instance = vfs;
    PakVirtualFS.instanceGamePath = gamePath;
    return vfs;
  }

  private constructor(pakFiles: string[]) {
    const start = Date.now();
    let totalFiles = 0;

    for (const pakPath of pakFiles) {
      try {
        const index = parsePakIndex(pakPath);
        this.pakModes.set(pakPath, { headVersion: index.headVersion });
        const count = this.mergeTree(this.root, index.root, index, "");
        totalFiles += count;
      } catch (e) {
        logger.warn(`Failed to parse pak file ${pakPath}: ${e}`);
        // Continue with other paks — graceful degradation
      }
    }

    const elapsed = Date.now() - start;
    logger.info(
      `PAK VFS initialized: ${pakFiles.length} pak files, ${totalFiles} entries, ` +
        `${this.fileIndex.size} files indexed in ${elapsed}ms`,
    );
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * List entries in a virtual directory.
   * Path uses forward slashes, no leading slash (e.g., "Prefabs/Weapons").
   * Empty string = root.
   */
  listDir(virtualPath: string): VfsEntry[] {
    const dir = this.resolveDir(virtualPath);
    if (!dir) return [];

    const entries: VfsEntry[] = [];
    for (const [name, child] of dir.children) {
      if (child.kind === "dir") {
        entries.push({ name, isDirectory: true, size: 0 });
      } else {
        entries.push({ name, isDirectory: false, size: child.decompressedLen });
      }
    }
    return entries;
  }

  /** Check if a path exists (file or directory). */
  exists(virtualPath: string): boolean {
    const norm = normalizePath(virtualPath);
    if (norm === "") return true; // root always exists
    return this.fileIndex.has(norm) || this.resolveDir(norm) !== null;
  }

  /**
   * Read a file's raw bytes from the pak archive.
   * Opens the .pak, seeks to the correct offset, reads, decompresses if needed.
   *
   * This is the single choke point for every pak read (all external callers go
   * through here or `readTextFile`), so all the untrusted-input guards live
   * here: the declared sizes are validated against `MAX_PAK_FILE_BYTES`, the
   * read window is bounds-checked against the .pak on disk before the
   * allocation, and `inflateRawSync` is capped so a lying header can't drive a
   * zip-bomb OOM.
   */
  readFile(virtualPath: string): Buffer {
    const norm = normalizePath(virtualPath);
    const ref = this.fileIndex.get(norm);
    if (!ref) {
      throw new Error(`File not found in pak: ${virtualPath}`);
    }

    const { pakPath, dataStart, entry } = ref;
    const readLen = entry.compressed ? entry.compressedLen : entry.decompressedLen;

    // Size guard: refuse oversized declared lengths before touching the file.
    // Parse time no longer enforces a ceiling (real paks hold legitimately huge
    // textures/worlds that would otherwise sink the whole pak), so this is THE
    // enforcement point: both compressedLen and decompressedLen are attacker-
    // controlled, and a huge value would otherwise drive a huge Buffer.alloc
    // below. (CWE-770 — bound the allocation, not just the inflate.)
    if (readLen < 0 || readLen > MAX_PAK_FILE_BYTES) {
      throw new Error(
        `Refusing to read pak entry ${virtualPath}: declared length ${readLen} exceeds ` +
          `the ${MAX_PAK_FILE_BYTES} byte cap`,
      );
    }
    if (entry.decompressedLen > MAX_PAK_FILE_BYTES) {
      throw new Error(
        `Refusing to read pak entry ${virtualPath}: decompressed length ${entry.decompressedLen} ` +
          `exceeds the ${MAX_PAK_FILE_BYTES} byte cap`,
      );
    }

    const fd = openSync(pakPath, "r");
    try {
      const pakSize = fstatSync(fd).size;
      const mode = this.pakModes.get(pakPath) ?? { headVersion: 0 };

      // Offset semantics changed with the pak generation: HEAD v3 (1.8+) records
      // absolute file positions, older paks record DATA-relative ones. Try the
      // preferred interpretation first, the other as fallback; a verified mode
      // (locked by a previous successful compressed read) is tried alone first.
      const preferAbsolute = mode.verified?.absoluteOffsets ?? mode.headVersion >= 3;
      const candidates = preferAbsolute
        ? [entry.offset, dataStart + entry.offset]
        : [dataStart + entry.offset, entry.offset];

      let lastError: Error | null = null;
      for (const position of candidates) {
        // Bounds check per candidate: the read window must fit inside the .pak
        // on disk, or a malformed offset/len would read past EOF. Entry data
        // always lives past the 12-byte FORM header.
        if (position < 12 || position + readLen > pakSize) {
          lastError = new Error(
            `Pak entry ${virtualPath} read window [${position}, ${position + readLen}) ` +
              `falls outside the .pak (size ${pakSize})`,
          );
          continue;
        }

        const buf = Buffer.alloc(readLen);
        const bytesRead = readSync(fd, buf, 0, readLen, position);
        if (bytesRead < readLen) {
          lastError = new Error(
            `Truncated read from pak: expected ${readLen} bytes, got ${bytesRead}`,
          );
          continue;
        }

        if (!entry.compressed) {
          // Stored entries carry no signature to verify a candidate against, so
          // the preferred (version-hinted or previously verified) offset wins.
          return buf;
        }

        // Compressed: 1.8 payloads are zlib-wrapped (78 xx), older ones raw
        // deflate — sniff per RFC 1950 rather than trusting the generation.
        // Cap inflate output either way: a malicious header can claim a small
        // compressedLen that decompresses to gigabytes; maxOutputLength makes
        // zlib abort instead of allocating unbounded memory.
        const zlibWrapped = looksZlibWrapped(buf);
        try {
          const out = zlibWrapped
            ? inflateSync(buf, { maxOutputLength: MAX_PAK_FILE_BYTES })
            : inflateRawSync(buf, { maxOutputLength: MAX_PAK_FILE_BYTES });
          if (out.length !== entry.decompressedLen) {
            throw new Error(
              `decompressed to ${out.length} bytes, header declares ${entry.decompressedLen}`,
            );
          }
          // Successful verified decompress locks this pak's mode for all
          // subsequent reads (including stored entries).
          this.pakModes.set(pakPath, {
            headVersion: mode.headVersion,
            verified: { absoluteOffsets: position === entry.offset, zlibWrapped },
          });
          return out;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      }

      throw new Error(
        `Failed to read pak entry ${virtualPath} (tried ${candidates.length} offset ` +
          `interpretation(s), HEAD v${mode.headVersion}): ${lastError?.message ?? "unknown error"}`,
      );
    } finally {
      closeSync(fd);
    }
  }

  /** Read a file as UTF-8 text. */
  readTextFile(virtualPath: string): string {
    return this.readFile(virtualPath).toString("utf-8");
  }

  /** Get decompressed file size without reading/inflating. Returns -1 if not found. */
  fileSize(virtualPath: string): number {
    const norm = normalizePath(virtualPath);
    const ref = this.fileIndex.get(norm);
    return ref ? ref.entry.decompressedLen : -1;
  }

  /** Get all file paths in the VFS (for building the asset search index). */
  allFilePaths(): string[] {
    return Array.from(this.fileIndex.keys());
  }

  /** Get the number of indexed files. */
  get fileCount(): number {
    return this.fileIndex.size;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Merge a parsed pak tree into the unified directory tree.
   * Returns the number of file entries added.
   */
  private mergeTree(
    target: PakDirEntry,
    source: PakDirEntry,
    index: PakIndex,
    pathPrefix: string,
  ): number {
    let count = 0;

    for (const [name, child] of source.children) {
      const childPath = pathPrefix ? `${pathPrefix}/${name}` : name;

      if (child.kind === "dir") {
        // Merge directories: create in target if missing, then recurse
        let targetChild = target.children.get(name);
        if (!targetChild || targetChild.kind !== "dir") {
          targetChild = { kind: "dir", name, children: new Map() };
          target.children.set(name, targetChild);
        }
        count += this.mergeTree(targetChild, child, index, childPath);
      } else {
        // File: add to target and flat index (first pak wins)
        const norm = normalizePath(childPath);
        if (!this.fileIndex.has(norm)) {
          target.children.set(name, child);
          this.fileIndex.set(norm, {
            pakPath: index.pakPath,
            dataStart: index.dataStart,
            entry: child,
          });
          count++;
        }
      }
    }

    return count;
  }

  /** Resolve a virtual path to a directory entry, or null if not found. */
  private resolveDir(virtualPath: string): PakDirEntry | null {
    const norm = normalizePath(virtualPath);
    if (norm === "") return this.root;

    const parts = norm.split("/");
    let current: PakDirEntry = this.root;

    for (const part of parts) {
      const child = current.children.get(part);
      if (!child || child.kind !== "dir") return null;
      current = child;
    }

    return current;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a virtual path: trim slashes, convert backslashes, lowercase. */
function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}
