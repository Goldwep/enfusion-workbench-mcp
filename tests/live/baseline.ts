/**
 * The regression guard every wave battery shares (w1, w2, w3 .. w12).
 *
 * A committed baseline per wave, `docs/v2/sessions/queues/<wave>-baseline.json`, maps each step id
 * to the status it ended with in the wave's latest green sitting. A run in which a step that PASSED
 * in the baseline ends KILLED fails (one REGRESSION line per step, exit refused): a1 of W3 came back
 * with four undo steps KILLED and still exited 0. FAIL already fails a run; a step missing from the
 * baseline is not a regression; any other status change is reported by the table, not here.
 *
 * `--update-baseline` on a battery rewrites the wave's file from the sitting's result file
 * (`<sitting>/<wave>-result.json`, every step's latest record) after the run; the run's regression
 * lines are then printed as accepted and do not fail the run.
 *
 * Offline:
 *   npx tsx tests/live/baseline.ts --wave <w1..w12> --sitting <sitting dir> [--write]
 * prints (or with --write writes) the baseline a sitting's result file gives.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isMainModule, parseArgs } from "../../scripts/live/cli.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";

export const BASELINE_DIR = join(REPO_ROOT, "docs", "v2", "sessions", "queues");
export const UPDATE_BASELINE_FLAG = "update-baseline";

export interface Baseline {
  wave: string;
  /** The sitting the statuses come from, `<WAVE>/<sitting>` under `<artifacts>/sessions`. */
  sitting: string;
  /** Step id to the status it ended with in that sitting. */
  steps: Record<string, string>;
}

/** The status fields of a step record or a result-file step the guard reads. */
export interface StatusLike {
  step?: string;
  id?: string;
  status: string;
  detail?: string;
}

export function baselinePath(wave: string, dir: string = BASELINE_DIR): string {
  return join(dir, `${wave.toLowerCase()}-baseline.json`);
}

/** A sitting folder's label: `<WAVE>/<sitting>`, never the user's path. */
export function sittingLabel(sittingDir: string): string {
  return `${basename(dirname(sittingDir))}/${basename(sittingDir)}`;
}

/** Parses a baseline file's text; throws on a malformed one (a broken guard must not pass silently). */
export function parseBaseline(text: string): Baseline {
  const j = JSON.parse(text) as Partial<Baseline>;
  if (!j || typeof j !== "object" || typeof j.wave !== "string" || typeof j.sitting !== "string")
    throw new Error("baseline: wave and sitting must be strings");
  if (!j.steps || typeof j.steps !== "object" || Array.isArray(j.steps))
    throw new Error("baseline: steps must map step ids to statuses");
  for (const [k, v] of Object.entries(j.steps))
    if (typeof v !== "string") throw new Error(`baseline: step ${k} has no status string`);
  return { wave: j.wave, sitting: j.sitting, steps: j.steps as Record<string, string> };
}

/** The wave's baseline, or null when the file is absent. */
export function readBaseline(path: string): Baseline | null {
  if (!existsSync(path)) return null;
  return parseBaseline(readFileSync(path, "utf-8"));
}

/** One REGRESSION line per step that PASSED in the baseline and ended KILLED in `records`. */
export function baselineRegressions(
  records: readonly StatusLike[],
  baseline: Baseline | null,
): string[] {
  if (!baseline) return [];
  const out: string[] = [];
  for (const r of records) {
    const id = r.step ?? r.id;
    if (!id || r.status !== "KILLED") continue;
    if (baseline.steps[id] !== "PASS") continue;
    out.push(
      `REGRESSION ${id}: PASS in ${baseline.sitting}, KILLED now${r.detail ? ` (${r.detail})` : ""}`,
    );
  }
  return out;
}

/** The baseline a sitting's steps give (ids sorted, so a rewrite diffs cleanly). */
export function baselineFromSteps(
  wave: string,
  sitting: string,
  steps: readonly StatusLike[],
): Baseline {
  const pairs: [string, string][] = [];
  for (const s of steps) {
    const id = s.step ?? s.id;
    if (id) pairs.push([id, s.status]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { wave: wave.toLowerCase(), sitting, steps: Object.fromEntries(pairs) };
}

export function serializeBaseline(b: Baseline): string {
  return JSON.stringify(b, null, 2) + "\n";
}

/** The steps of `<sitting>/<wave>-result.json`. */
export function resultSteps(sittingDir: string, resultFile: string): StatusLike[] {
  const j = JSON.parse(readFileSync(join(sittingDir, resultFile), "utf-8")) as {
    steps?: StatusLike[];
  };
  if (!Array.isArray(j.steps)) throw new Error(`${resultFile}: no steps array`);
  return j.steps;
}

export interface GuardIo {
  read: (path: string) => Baseline | null;
  steps: (sittingDir: string, resultFile: string) => StatusLike[];
  write: (path: string, text: string) => void;
}

export const REAL_GUARD_IO: GuardIo = {
  read: readBaseline,
  steps: resultSteps,
  write: (p, t) => writeFileSync(p, t, "utf-8"),
};

export interface GuardOptions {
  wave: string;
  sittingDir: string;
  resultFile: string;
  update: boolean;
  exitDone: number;
  exitRefused: number;
  /** The baseline folder (tests). */
  dir?: string;
}

/**
 * Applies the guard to a battery's report in place: a regression appends its lines to the message
 * and turns a done exit into refused (a stop or handoff keeps its own exit). With `update`, the
 * baseline is rewritten from the sitting's result file instead and the lines are notes. Returns
 * the lines for the battery to print.
 */
export function applyBaselineGuard(
  r: { exit: number; message: string | null; records: readonly StatusLike[] },
  o: GuardOptions,
  io: GuardIo = REAL_GUARD_IO,
): string[] {
  const path = baselinePath(o.wave, o.dir);
  const regressed = baselineRegressions(r.records, io.read(path));
  const out: string[] = [];
  if (o.update) {
    const b = baselineFromSteps(o.wave, sittingLabel(o.sittingDir), io.steps(o.sittingDir, o.resultFile));
    io.write(path, serializeBaseline(b));
    for (const l of regressed) out.push(`${l} (accepted: --${UPDATE_BASELINE_FLAG})`);
    out.push(`baseline ${basename(path)} rewritten from ${b.sitting}: ${Object.keys(b.steps).length} steps`);
    return out;
  }
  if (regressed.length) {
    const lines = regressed.join("; ");
    r.message = r.message ? `${r.message}; ${lines}` : lines;
    if (r.exit === o.exitDone) r.exit = o.exitRefused;
  }
  return out;
}

export function main(argv: string[], say: (l: string) => void = console.log): number {
  const a = parseArgs(argv, ["wave", "sitting", "dir"]);
  const wave = a.options.wave;
  const sitting = a.options.sitting;
  if (!wave || !/^w\d+$/i.test(wave) || !sitting) {
    say("usage: baseline.ts --wave <w1..w12> --sitting <sitting dir> [--dir <dir>] [--write]");
    return 2;
  }
  const b = baselineFromSteps(wave, sittingLabel(sitting), resultSteps(sitting, `${wave.toLowerCase()}-result.json`));
  const text = serializeBaseline(b);
  if (a.flags.has("write")) {
    const p = baselinePath(wave, a.options.dir);
    writeFileSync(p, text, "utf-8");
    say(`wrote ${basename(p)}: ${Object.keys(b.steps).length} steps from ${b.sitting}`);
  } else say(text.trimEnd());
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
