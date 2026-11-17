/**
 * The scratch-settings ini a live launch takes with `-forceSettings` (DEC-038), built from the
 * registry export pre-flight pass 1 writes (`--until 7`). One command for every runbook (W1.md,
 * P4-*.md, S-D.md "Before the sitting" item 6); the copy outside the repository was lost
 * (W1 fix-up 3).
 *
 * Steps, all offline (the registry is never read or written here; only the export file is):
 *   1 scrub    s-b-scratch-profile.ts buildScratchIni: E06's personal-data rules, the known-path
 *              check, the NET API kept as exported and required enabled
 *   2 debug    `ScriptDebugMode=false` in `[World%20Editor]` (ini-edit.ts setValues, created when
 *              absent): a VM exception must not raise the VME dialog (S-C, s-c-natives
 *              iniScriptDebugMode)
 *   3 check    no line names a script authorization (the launch's `-scriptAuthorizeAll` is the only
 *              authorization, DEC-041); the result is refused otherwise
 *
 * The ini must lie inside the artifacts folder, outside any git working tree, in an existing
 * folder, and is created, never overwritten (ini-edit.ts newFileRefusal; pre-flight's
 * forceSettingsFileRefusal then accepts it). Refused while any Workbench process runs (it holds
 * its settings and writes them back at exit). Without --really it prints what it would write.
 *
 * Usage:
 *   npx --no tsx scripts/live/scratch-ini.ts --from <registry export .reg> --out <ini> [--really]
 *
 * Exit code: 0 written (or dry run), 1 refused or failed, 2 usage error.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  decodeRegText,
  parseRegText,
  personalContextFromEnv,
  type PersonalContext,
} from "../census/enumerators/e06-settings-store.js";
import { isMainModule, parseArgs } from "./cli.js";
import { newFileRefusal, setValues, sha256, workbenchRunningRefusal } from "./ini-edit.js";
import {
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { buildScratchIni } from "./s-b-scratch-profile.js";
import { iniScriptDebugMode } from "./s-c-natives.js";
import type { ExecFn } from "./win.js";

export const DEBUG_SECTION = "World%20Editor";
export const DEBUG_KEY = "ScriptDebugMode";
/** A line that names a script authorization (DEC-041: only the launch flag authorizes). */
export const AUTHORIZATION_RE = /authori[sz]/i;

export interface ScratchIniResult {
  text: string;
  sections: string[];
  kept: number;
  dropped: Record<string, number>;
  debugLine: string | null;
}

/**
 * The scratch ini from the bytes of a registry export (UTF-16 or UTF-8 `.reg`). Throws when the
 * scrub refuses (no enabled NET API, the personal-data gate), when Script Debug Mode does not read
 * off afterwards, or when a line names a script authorization. Pure but for its arguments.
 */
export function scratchIniFromExport(
  exportBytes: Buffer,
  personal: PersonalContext,
  placeholders: PlaceholderContext,
): ScratchIniResult {
  const scrubbed = buildScratchIni(
    parseRegText(decodeRegText(exportBytes)),
    personal,
    placeholders,
  );
  const { text } = setValues(scrubbed.text, [
    { section: DEBUG_SECTION, key: DEBUG_KEY, value: "false", create: true },
  ]);
  const debug = iniScriptDebugMode(text);
  if (debug.state !== "off")
    throw new Error(`${DEBUG_KEY} does not read off in [${DEBUG_SECTION}] (${debug.line})`);
  const auth = text.split(/\r?\n/).filter((l) => AUTHORIZATION_RE.test(l));
  if (auth.length)
    throw new Error(
      `the scratch ini names a script authorization on ${auth.length} line(s); only the launch's -scriptAuthorizeAll may authorize (DEC-041)`,
    );
  return {
    text,
    sections: scrubbed.sections,
    kept: scrubbed.kept,
    dropped: scrubbed.dropped,
    debugLine: debug.line,
  };
}

export interface ScratchIniDeps {
  artifactsRoot: string;
  personal: PersonalContext;
  placeholders: PlaceholderContext;
  platform: NodeJS.Platform;
  exec?: ExecFn;
  log: (line: string) => void;
}

export function main(argv: string[], deps?: Partial<ScratchIniDeps>): number {
  const d: ScratchIniDeps = {
    artifactsRoot: deps?.artifactsRoot ?? artifactsDir(),
    personal: deps?.personal ?? personalContextFromEnv(),
    placeholders: deps?.placeholders ?? defaultPlaceholderContext(),
    platform: deps?.platform ?? process.platform,
    exec: deps?.exec,
    log: deps?.log ?? ((l) => console.log(l)),
  };
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, ["from", "out"]);
  } catch (e) {
    d.log(`usage: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const from = args.options.from;
  const out = args.options.out;
  if (!from || !out) {
    d.log("usage: scratch-ini.ts --from <registry export .reg> --out <ini> [--really]");
    return 2;
  }
  const ph = (p: string): string => toPlaceholders(p, d.placeholders);
  const outRefusal = newFileRefusal(out, d.artifactsRoot);
  if (outRefusal) {
    d.log(`refused: ${ph(outRefusal)}`);
    return 1;
  }
  const running = workbenchRunningRefusal(d.platform, d.exec);
  if (running) {
    d.log(`refused: ${running}`);
    return 1;
  }
  let built: ScratchIniResult;
  try {
    built = scratchIniFromExport(readFileSync(from), d.personal, d.placeholders);
  } catch (e) {
    d.log(`refused: ${ph(e instanceof Error ? e.message : String(e))}`);
    return 1;
  }
  const summary =
    `${built.kept} values in ${built.sections.length} sections; dropped ${JSON.stringify(built.dropped)}; ` +
    `${built.debugLine}; sha256 ${sha256(built.text)}`;
  if (!args.flags.has("really")) {
    d.log(`dry run: would write ${ph(out)}: ${summary}`);
    return 0;
  }
  writeFileSync(out, built.text, "utf-8");
  d.log(`wrote ${ph(out)}: ${summary}`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
