/**
 * Write-then-rename: the one route by which the offline writers replace a file (review round 1,
 * F9). The bytes go to a temporary sibling in the same folder, and only a complete temporary file
 * is renamed over the target, so a failed write (a full disk, a process killed mid-write) leaves the
 * target as it was instead of cut short. The census ledger writer (src/census/ledger-io.ts) and
 * the refactor tools' atomicCommit (src/refactor/byte-edit.ts) use the same rename.
 *
 * The bytes are written as given (a Buffer is never re-encoded), so a byte-exact writer stays
 * byte exact. On Windows a file another process holds open for a moment (Workbench importing a
 * .meta: W2 run 5, EBUSY) refuses the rename; with `busyRetry` the rename is tried again for about
 * two seconds, the waits of meta-file.ts's writeBusyTolerant. A failure removes the temporary file
 * and rethrows.
 */

import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export interface AtomicWriteOptions {
  /** Create the folder first (default false: a missing folder fails as writeFileSync would). */
  mkdir?: boolean;
  /** Retry a rename refused EBUSY or EPERM for about two seconds (a .meta Workbench holds open). */
  busyRetry?: boolean;
  /** The rename, replaceable for tests. */
  rename?: (from: string, to: string) => void;
}

/** The waits between tries of a busy rename, in ms (meta-file.ts W2 run 5). */
export const BUSY_WAITS_MS = [100, 200, 400, 600, 800] as const;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusy(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM";
}

/** The temporary sibling a write of `file` goes through. */
export function tempSibling(file: string): string {
  return `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/** Renames tmp over file, with the busy retry when asked (rename is replaceable for tests). */
export function renameOver(
  tmp: string,
  file: string,
  busyRetry = false,
  rename: (from: string, to: string) => void = renameSync,
): void {
  for (let i = 0; ; i++) {
    try {
      rename(tmp, file);
      return;
    } catch (e) {
      if (!busyRetry || !isBusy(e) || i >= BUSY_WAITS_MS.length) throw e;
      sleep(BUSY_WAITS_MS[i]!);
    }
  }
}

/**
 * Writes data to file through a temporary sibling and a rename. Throws on failure.
 *
 * W2 regress 2 (2026-11-14, live): Workbench keeps a resource it has open (a .conf in the Resource
 * Manager) without delete sharing, so the rename is refused EPERM for as long as it is open, while
 * a write into the file is allowed. So a rename still refused busy after the retries falls back to
 * writing the target in place, with the complete temporary file kept beside it until that write
 * has returned: a failure then leaves the full new content in the temporary file, and the error
 * names it.
 */
export function writeFileAtomic(
  file: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  if (options.mkdir) mkdirSync(dirname(file), { recursive: true });
  const tmp = tempSibling(file);
  const write = (to: string): void => {
    if (typeof data === "string") writeFileSync(to, data, "utf-8");
    else writeFileSync(to, data);
  };
  try {
    write(tmp);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  try {
    renameOver(tmp, file, true, options.rename);
    return;
  } catch (e) {
    let regular = false;
    try {
      regular = statSync(file).isFile();
    } catch {
      regular = false;
    }
    // Only a regular file held open is written in place; anything else is the rename error.
    if (!isBusy(e) || !regular) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }
  try {
    write(file);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    err.message = `${err.message} (the file is held open by another process; the complete new content is kept in ${tmp})`;
    throw err;
  }
  rmSync(tmp, { force: true });
}
