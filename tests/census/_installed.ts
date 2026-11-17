/**
 * Whether the installed game is the build the census was taken on.
 *
 * Several census tests run an enumerator over the real install and compare with
 * numbers recorded at one build. On another build those numbers are simply not
 * the install's, so such a block skips instead of failing: a game update is not
 * a regression of the enumerator. The check is the corpus baseline's
 * (tests/corpus/_corpus.ts): the census build is the baseline's build and the
 * paks hold the baseline's file count. The Tools install (executable, docs,
 * Blender add-on) is taken to move with the game.
 *
 * True when there is no install to compare: each block has its own skip for that.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { BASELINE_PATH, REPO_ROOT } from "../corpus/_corpus.js";

/** The build the gated blocks' expected numbers were recorded at. */
export const RECORDED_BUILD = "1.8.0.13";

function check(): boolean {
  try {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as {
      build?: string;
      pak_files?: number;
    };
    const tag = (
      JSON.parse(
        readFileSync(join(REPO_ROOT, "data", "census", "current-build.json"), "utf-8"),
      ) as { tag?: string }
    ).tag;
    const gamePath = loadConfig().gamePath;
    if (!gamePath || !existsSync(join(gamePath, "addons"))) return true;
    const vfs = PakVirtualFS.get(gamePath);
    if (!vfs || vfs.fileCount === 0) return true;
    // The numbers in the gated blocks were recorded at RECORDED_BUILD and have not been re-recorded
    // since: with the census moved to a later build they are not the install's either.
    return (
      tag === RECORDED_BUILD && baseline.build === tag && vfs.fileCount === baseline.pak_files
    );
  } catch {
    return true;
  }
}

/** False when a game is installed and it is not the census build (see the file comment). */
export const INSTALL_IS_CENSUS_BUILD = check();
