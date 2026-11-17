/**
 * Generates the Diag Menu catalog of `wb_diag catalog` (wave W8, phase5-w8-spec.md section 4,
 * DEC-076: the integrator runs it). Offline; reads the E02 source index and the game's script
 * sources, writes nothing but the catalog.
 *
 *   npx tsx scripts/census/gen-diag-catalog.ts            write data/census/diag-catalog.json
 *   npx tsx scripts/census/gen-diag-catalog.ts --check    exit 1 when the file differs
 *
 * Options:
 *   --data <dir>     census root (default data/census); the build tag comes from its
 *                    current-build.json unless --build is given
 *   --build <tag>    build of the E02 index (default: current-build.json tag)
 *   --index <file>   the E02 source-index.jsonl (default: the artifacts folder for the build)
 *   --game <dir>     game install whose paks hold the scripts (default: ENFUSION_GAME_PATH or the
 *                    configured game path)
 *   --scripts <dir>  a folder of loose script sources instead of the paks (paths under it are read
 *                    as virtual paths, e.g. <dir>/scripts/Game/X.c)
 *   --out <file>     output (default <data>/diag-catalog.json)
 *
 * Exit: 0 ok; 1 differs (--check) or a failure; 2 usage, no index or no scripts; 3 malformed data.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../../src/config.js";
import { loadCurrentBuild } from "../../src/census/census-config.js";
import { buildDiagCatalog, diagCatalogText, mayRegister } from "../../src/census/diag-catalog.js";
import {
  isScriptSource,
  loadSourceIndex,
  sourceIndexPath,
  type SourceInput,
} from "../../src/census/source-index.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";

const NAME = "gen-diag-catalog";

/** Every file under `dir`, as `/`-separated paths relative to it. */
function listFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

/** Script sources that mention DiagMenu, from a loose folder. */
function folderSources(dir: string): SourceInput[] {
  const out: SourceInput[] = [];
  for (const path of listFiles(dir)) {
    if (!isScriptSource(path)) continue;
    const text = readFileSync(join(dir, path), "utf-8");
    out.push({ path, text: mayRegister(text) ? text : "" });
  }
  return out;
}

/** Script sources that mention DiagMenu, from the game paks. */
function pakSources(vfs: PakVirtualFS): SourceInput[] {
  const out: SourceInput[] = [];
  for (const path of vfs.allFilePaths()) {
    if (!isScriptSource(path)) continue;
    const text = vfs.readTextFile(path);
    out.push({ path, text: mayRegister(text) ? text : "" });
  }
  return out;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, NAME, () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        check: { type: "boolean" },
        data: { type: "string" },
        build: { type: "string" },
        index: { type: "string" },
        game: { type: "string" },
        scripts: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
    });
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    const indexFile = values.index ? resolve(values.index) : sourceIndexPath(build);
    const index = loadSourceIndex(build, { file: indexFile });
    if (!index) {
      io.err(`${NAME}: no E02 source index for build ${build}; run the E02 enumerator first`);
      return EXIT_USAGE;
    }

    let sources: SourceInput[];
    if (values.scripts) {
      const dir = resolve(values.scripts);
      if (!existsSync(dir)) {
        io.err(`${NAME}: --scripts folder not found`);
        return EXIT_USAGE;
      }
      sources = folderSources(dir);
    } else {
      const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
      const vfs =
        gamePath && existsSync(join(gamePath, "addons")) ? PakVirtualFS.get(gamePath) : null;
      if (!vfs) {
        io.err(
          `${NAME}: no game install with paks at the game path (ENFUSION_GAME_PATH or --game)`,
        );
        return EXIT_USAGE;
      }
      sources = pakSources(vfs);
    }

    const catalog = buildDiagCatalog({ index, sources });
    const text = diagCatalogText(catalog);
    const out = values.out ? resolve(values.out) : join(paths.root, "diag-catalog.json");
    const c = catalog.counts;
    const summary = `${c.script} script ids (${c.script_guarded} guarded, ${c.registered} registered, ${c.unknown} unknown), ${c.engine} engine ids`;
    if (values.check) {
      const now = existsSync(out) ? readFileSync(out, "utf-8").replace(/\r\n/g, "\n") : null;
      if (now !== text) {
        io.err(
          `${NAME}: ${now === null ? "missing" : "differs"}: diag-catalog.json; run ${NAME}.ts`,
        );
        return EXIT_FAIL;
      }
      io.out(`${NAME}: diag-catalog.json matches (${summary})`);
      return EXIT_OK;
    }
    writeFileSync(out, text);
    io.out(`${NAME}: wrote diag-catalog.json: ${summary}`);
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
