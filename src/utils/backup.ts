/**
 * The backup a file write keeps beside the file it replaces: `<file>.bak`, or `.bak2`, `.bak3`, ...
 * when earlier backups exist, so the first original bytes and a backup the user already had are
 * never overwritten (review round 1, W4-AS-1; procanim's numbering, now shared). The same rule as
 * src/refactor/byte-edit.ts RBE-3: never clobber a pristine `.bak`.
 */

import { constants, copyFileSync, existsSync } from "node:fs";

/** The most numbered backups of one file. */
export const MAX_BACKUPS = 99;

/**
 * Copies file to its first free backup name and returns that absolute name. When MAX_BACKUPS exist,
 * calls fail (each tool throws its own refusal) and copies nothing.
 */
export function backUp(file: string, fail: (message: string) => never): string {
  for (let i = 1; i <= MAX_BACKUPS; i++) {
    const b = `${file}.bak${i === 1 ? "" : i}`;
    if (existsSync(b)) continue;
    // COPYFILE_EXCL: the copy only creates, so a backup that appeared after the check is never
    // overwritten; the next free name is tried instead (write-safety audit, gap 20).
    try {
      copyFileSync(file, b, constants.COPYFILE_EXCL);
      return b;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return fail(`${MAX_BACKUPS} backups of ${file} exist; clear them first`);
}

/** The project-relative name of a backup: rel plus the suffix backUp gave file. */
export function backupRel(rel: string, file: string, backup: string): string {
  return `${rel}${backup.slice(file.length)}`;
}
