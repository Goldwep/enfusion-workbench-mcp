import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Probe every Steam library listed in libraryfolders.vdf for an installed
 * game directory (one that contains an `addons` folder).
 *
 * The game is often in a DIFFERENT Steam library than the Tools (e.g. Tools
 * on C:\, game on D:\SteamLibrary), so sibling-directory derivation fails on
 * split installs. `hintRoots` are extra Steam roots to try first — pass the
 * library root that contains the Tools install when known.
 */
export function findGameAcrossSteamLibraries(
  gameFolderName: string,
  hintRoots: string[] = [],
): string | null {
  const steamRoots = [...hintRoots, "C:\\Program Files (x86)\\Steam"];
  for (const root of steamRoots) {
    const vdf = join(root, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    let text: string;
    try {
      text = readFileSync(vdf, "utf-8");
    } catch {
      continue;
    }
    // "path"  "D:\\SteamLibrary" lines — capture the value, unescape \\.
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      const lib = m[1].replace(/\\\\/g, "\\");
      const gameDir = join(lib, "steamapps", "common", gameFolderName);
      if (existsSync(join(gameDir, "addons"))) {
        return gameDir;
      }
    }
  }
  return null;
}

/**
 * Steam library root that contains the given install dir.
 *
 * Walks up from `installDir` until it finds an ancestor named `steamapps`
 * and returns that ancestor's parent — so both
 * `…/steamapps/common/Arma Reforger Tools` and
 * `…/steamapps/common/Arma Reforger Tools/Workbench` resolve to the same
 * library root. Falls back to the historical fixed-depth guess (three
 * levels up) when no `steamapps` segment exists in the path.
 */
export function steamRootOf(installDir: string): string {
  let dir = resolve(installDir);
  for (;;) {
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    if (basename(dir).toLowerCase() === "steamapps") return parent;
    dir = parent;
  }
  return resolve(installDir, "..", "..", "..");
}
