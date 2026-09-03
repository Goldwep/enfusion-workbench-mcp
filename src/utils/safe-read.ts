/**
 * Bounded text-file reading helper. Caps how much data we slurp into memory
 * with `readFileSync(..., "utf-8")` so a malicious or corrupt asset (or a
 * stray multi-GB blob inside a workshop project) can't OOM the Node process.
 *
 * CWE-770 (Allocation of Resources Without Limits or Throttling) fix —
 * called from every read-side scanner that walks user / workshop projects.
 *
 * Default cap: 8 MiB. That's well above the largest legitimate `.agf` /
 * `.asi` / `.agr` / `.conf` / `.et` we've seen in the wild but small
 * enough that we'll trip on a runaway file before exhausting heap. Callers
 * that legitimately need more can pass an explicit `maxBytes` — but the
 * default applies everywhere a generic scan reads user-supplied content.
 *
 * NOT used by the LLM-controlled write tools (faction_create,
 * scenario_clone_area destination write) — those are WRITE paths, not READ
 * paths, and have their own containment guards.
 */

import { readFileSync, statSync } from "node:fs";

/** Default max size for text-file reads. 8 MiB. */
export const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Read a text file into memory with a size cap. Throws if the file's
 * size on disk exceeds `maxBytes`. The cap is checked via `statSync`
 * BEFORE the read, so an oversize file never gets buffered.
 *
 * `path` must be an absolute path the caller has already validated /
 * resolved — this helper is about size, not path safety.
 */
export function readTextFileBounded(path: string, maxBytes: number = MAX_TEXT_FILE_BYTES): string {
  const stat = statSync(path);
  if (stat.size > maxBytes) {
    throw new Error(
      `File too large: ${path} (${stat.size} bytes > ${maxBytes} byte cap). ` +
        `Refusing to read. If this is legitimate, increase the cap or stream the file.`,
    );
  }
  return readFileSync(path, "utf-8");
}
