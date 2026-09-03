/**
 * Path containment guard — ensures a resolved absolute path stays inside
 * a declared project root.
 *
 * Complements `safe-path.ts` (which builds containment-safe paths from
 * filename segments). `path-guard.ts` is for the case where the caller
 * already has a `resolve()`-ed absolute path and just needs to verify
 * it's inside a known root — e.g. an LLM-supplied `out_path` that may
 * be any absolute path on disk.
 *
 * Hardening (audit L6):
 *   - BOTH sides are canonicalised with `fs.realpathSync.native` on the
 *     deepest existing ancestor, so a junction / symlink planted inside
 *     the root that points outside it is refused. Path segments that do
 *     not exist yet (the file about to be written) are re-appended after
 *     canonicalisation.
 *   - Win32 long-path / device prefixes (`\\?\`, `\\.\`, `\\?\UNC\`) are
 *     stripped before normalisation so they can't bypass the `..` fold.
 *   - Comparison is case-insensitive on win32 (NTFS default), so a
 *     case-flipped drive letter or directory name is neither a bypass nor
 *     a false refusal.
 *
 * Uses a trailing-separator check so prefix collisions (e.g.
 * `C:\Proj` vs `C:\ProjEvil`) don't false-pass.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const IS_WIN32 = process.platform === "win32";

/**
 * Strip Windows extended-length / device-namespace prefixes so that
 * `path.resolve` gets to fold `..` segments and normalise separators.
 *
 *   `\\?\C:\x`           → `C:\x`
 *   `\\.\C:\x`           → `C:\x`
 *   `\\?\UNC\srv\share`  → `\\srv\share`
 */
export function stripWin32Prefix(p: string): string {
  if (!IS_WIN32) return p;
  const m = /^[\\/]{2}[?.][\\/](.*)$/.exec(p);
  if (!m) return p;
  const rest = m[1];
  const unc = /^UNC[\\/](.*)$/i.exec(rest);
  if (unc) return `\\\\${unc[1]}`;
  return rest;
}

/**
 * Canonicalise a path for containment comparison:
 *   1. strip win32 device prefixes,
 *   2. `resolve()` (folds `..`, normalises separators),
 *   3. realpath the deepest ancestor that exists on disk,
 *   4. re-append the not-yet-existing tail segments.
 *
 * Never throws — on any fs error it falls back to the plain resolved form.
 */
export function canonicalizePath(p: string): string {
  const abs = resolve(stripWin32Prefix(p));
  const missing: string[] = [];
  let cur = abs;
  // Walk up until something exists (or we hit the filesystem root).
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs; // nothing on this path exists (e.g. unknown drive)
    missing.unshift(basename(cur));
    cur = parent;
  }
  let real: string;
  try {
    real = realpathSync.native(cur);
  } catch {
    real = cur;
  }
  return missing.length > 0 ? join(real, ...missing) : real;
}

function comparable(p: string): string {
  return IS_WIN32 ? p.toLowerCase() : p;
}

/**
 * True iff `resolved` is equal to `root` (after canonicalisation) or a
 * descendant of it. Both sides are canonicalised here (realpath of the
 * deepest existing ancestor) so junction / symlink escapes are refused.
 */
export function isPathInsideRoot(resolved: string, root: string): boolean {
  const target = comparable(canonicalizePath(resolved));
  const rootCanon = comparable(canonicalizePath(root));
  return target === rootCanon || target.startsWith(rootCanon + sep);
}

/**
 * Throw if `resolved` escapes `root`. `label` is the user-facing name of
 * the input (e.g. `"out_path"`) so the error message points at the right
 * argument when an LLM hands us a traversal payload.
 */
export function assertInsideRoot(resolved: string, root: string, label: string): void {
  if (!isPathInsideRoot(resolved, root)) {
    throw new Error(
      `${label} resolves outside project root: ${resolved}. Must be inside ${resolve(root)}.`,
    );
  }
}

/**
 * Throw unless `resolved` is inside at least one of `roots`. Empty /
 * undefined entries are ignored (optional config roots such as
 * `workshopPath` may be unset). Used by tools whose target may
 * legitimately live under the user project OR the workshop dir.
 */
export function assertInsideAnyRoot(
  resolved: string,
  roots: readonly (string | undefined)[],
  label: string,
): void {
  const candidates = roots.filter((r): r is string => typeof r === "string" && r.length > 0);
  if (candidates.length === 0) {
    throw new Error(`${label}: no configured project roots to validate against.`);
  }
  for (const root of candidates) {
    if (isPathInsideRoot(resolved, root)) return;
  }
  throw new Error(
    `${label} resolves outside every configured root: ${resolved}. Must be inside one of: ${candidates
      .map((r) => resolve(r))
      .join(", ")}.`,
  );
}
