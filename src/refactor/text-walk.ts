/**
 * Disk walks shared by the refactor tools.
 *
 * The project index parses only the Enfusion text files it knows
 * (.et/.conf/.layout/...). Other text resources (.physmat, .gamemat,
 * .imageset, .asy, .meta, ...) still carry `{GUID}path` references, so a
 * refactor that must reach every reference walks the editable project roots
 * itself (W11 run 4). These helpers are that walk.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const WALK_SKIP = new Set(["node_modules", ".git", "dist", ".emcp"]);

/** Extensions that are never text resources: skipped without a read. */
const BINARY_EXT = new Set([
  ".edds", ".dds", ".png", ".tga", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".xob", ".fbx",
  ".wav", ".ogg", ".wem", ".bnk", ".pak", ".rdb", ".anm", ".tmf", ".ttf", ".otf", ".zip",
  ".dll", ".exe", ".pdb", ".db", ".sqlite", ".bin",
]);

/** Larger files are not scanned for references. */
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

/** A `.bak` sidecar (also `.bak.<n>`), or an atomic-commit `.tmp.<id>` stage file. */
export function isBackupSidecar(name: string): boolean {
  return /\.bak(\.[^.]+)?$/i.test(name) || /\.tmp\.[^.]+$/i.test(name);
}

/** Every file under `root` that may be a text resource (no symlinks, dot or build folders, sidecars, binaries). */
export function* walkTextCandidates(root: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && !WALK_SKIP.has(e.name)) yield* walkTextCandidates(p);
    } else if (e.isFile() && !isBackupSidecar(e.name) && !BINARY_EXT.has(extname(e.name).toLowerCase())) {
      yield p;
    }
  }
}

/** Every `.meta` sidecar under `root` (same skips as {@link walkTextCandidates}). */
export function* walkMetaFiles(root: string): Generator<string> {
  for (const p of walkTextCandidates(root)) {
    if (p.toLowerCase().endsWith(".meta")) yield p;
  }
}

/** The file as UTF-8 text, or null for a binary (a NUL byte, invalid UTF-8) or an oversized file. */
export function readTextFile(abs: string): string | null {
  try {
    if (statSync(abs).size > MAX_TEXT_BYTES) return null;
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
