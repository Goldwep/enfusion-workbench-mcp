/**
 * Prune of stale handler files after a handler install.
 *
 * Both installers (WorkbenchClient.installHandlerScripts, which every user's project gets, and
 * scripts/live/launch.ts --install-handlers) used to copy only. After two 1.x handlers were
 * retired (OD-1, session 023), their `.c` files stayed in the test project's
 * `Scripts/WorkbenchGame/EnfusionMCP/` folder and would have kept compiling until they were
 * deleted by hand. After a copy, the installers now delete from that one folder every file named
 * `EMCP_WB_*.c` that the bundle does not hold, and nothing else: never a file of another name,
 * never a sub-folder or anything under one, never a link, never a file outside the folder.
 */

import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** A handler file name the prune may remove: `EMCP_WB_<name>.c`, no path separator. */
export const HANDLER_FILE_PATTERN = /^EMCP_WB_[^/\\]+\.c$/;

/**
 * The `EMCP_WB_*.c` files directly in `dir` that are not in `bundleFiles`, sorted. With `really`
 * they are deleted (a link or anything that is not a regular file is left alone and not listed).
 * A missing folder answers []. Names are compared case-insensitively: Windows paths are.
 */
export function pruneStaleHandlers(
  dir: string,
  bundleFiles: readonly string[],
  opts: { really: boolean },
): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const keep = new Set(bundleFiles.map((f) => f.toLowerCase()));
  const stale = names
    .filter((n) => HANDLER_FILE_PATTERN.test(n) && !keep.has(n.toLowerCase()))
    .filter((n) => {
      try {
        return lstatSync(join(dir, n)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  if (opts.really) for (const n of stale) unlinkSync(join(dir, n));
  return stale;
}
