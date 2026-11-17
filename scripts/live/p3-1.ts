/**
 * Sitting P3-1 (DEC-048 "Live sittings" item 1, DEC-050 and DEC-051 "Next"): a THIN orchestrator over
 * the existing sitting scripts. It holds no step of its own: every step it names is a step of
 * `scripts/live/s-f-gui.ts` (S-F) or `scripts/live/s-e-train1b.ts` (S-E), run through that
 * script's own CLI (one declared block or one `--only` step per invocation, its gate, its
 * handoffs, its records and evidence). What this file adds is the ORDER, the flags each
 * invocation gets, P3-1's button rulings, the combined dry-run plan and the P3-1 queue.
 *
 * Owner present, without `-scriptAuthorizeAll` (on BC only, the owner may choose it: BC_FLAG_NOTE),
 * one lane. Three launches (plan 5.4's budget for
 * the sitting, none spare):
 *
 *   Part A, the S-F repeat (two launches, S-F's queue and the read-only pack with ECEN_ProbeAuth):
 *     offline-0  sf-p2 (U23 `.dlg` scan), sf-p1 (U36 input ini)
 *     A1         U27 in a FRESH process: FileExists (sf-04) and OpenFile (sf-09) BEFORE any
 *                FindFiles; FindFiles (sf-02) with the deliberate No; FindFiles again (sf-03)
 *                with Yes to All; FindFiles from the second call site (sf-05): Yes to All's
 *                scope. Then sf-12 to sf-14 (U21 scripted Expand background and front, U31).
 *     offline-1  sf-p3 (U36 re-read with the fixed counter), sf-p4 (U22 inputs, the preset token)
 *     A2         sf-20 gate, sf-22/sf-23 (U22 preset half), sf-24/sf-25 (U20), sf-26/sf-27 (U36
 *                page, the close)
 *     offline-2  sf-p5 (U36 re-read)
 *   Parts B and C share ONE S-E launch (both packs; only S-E's queue lets pre-flight step 7 accept
 *   the mutating pack, and S-F's gate stops on it, so they cannot ride an S-F launch):
 *     offline-bc `s-e-train1b.ts plant` (the u11 `.pap` ProcAnimEditor's target lives in)
 *     BC         se-05 (the u16 copies, AudioEditor's target), se-07 AudioEditor and
 *                ProcAnimEditor (package G's containerWriteTest retry, fact `pathForm`), se-16 LAST
 *                (U4/U14: plant, reload expecting failure, remove, reload again, record).
 *
 * DRY RUN BY DEFAULT: prints the sequence, the launch count and each invocation's worst case;
 * builds the combined action plan (the sub-scripts' own plan actions for the selected steps plus
 * the three launches) and checks it with dry-run.ts's checkPlan; validates the P3-1 queue with
 * preflight.ts's validateQueue. `--out` writes the plan, `--emit-queue` the queue.
 *
 * A real invocation runs ONE entry: `--really --entry <id>` spawns the sub-script with the argv
 * this file composes and returns its exit code. Hand entries (lease, pre-flight and launch, the
 * owner's close, post-flight, rollback) are printed, never run: the main session runs them.
 *
 * Usage:
 *   npx --no tsx scripts/live/p3-1.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *       [--sandbox <dir>]
 *   npx --no tsx scripts/live/p3-1.ts --entry <id> [--print] --id <lane id> [--really]
 *       [--sf-run-dir <dir>] [--se-run-dir <dir>] [--registry-export <reg>] [--force-settings <ini>]
 *       [--sandbox <dir>] [--ini-in <scrubbed ini>]
 *       [--owner-clicked <button>[,<button>...] [--owner-deviation]]
 *       [--only-step <step id> [--owner-done]]
 *
 * Exit: the sub-script's exit code for a real entry (0 done, 1 refused, 2 usage, 3 stopped,
 *       4 aborted, 5 handoff); for the dry run 0 passed, 1 plan or queue check failed, 2 usage.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";
import { AUTH_BUTTONS, type AuthButton } from "./s-d-train1.js";
import * as se from "./s-e-train1b.js";
import * as sf from "./s-f-gui.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P3-1";
export const SCRIPT_PATH = "scripts/live/p3-1.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P3-1.md";
export const DEFAULT_QUEUE = join(REPO_ROOT, "docs", "v2", "sessions", "queues", "P3-1-queue.json");
/** The session log number of the sitting (sessions/013-...), and its evidence prefix. */
export const SESSION_NUMBER = "013";
export const EVIDENCE_SESSION = `s${SESSION_NUMBER}`;

export const SCRIPTS = { "s-f": sf.SCRIPT_PATH, "s-e": "scripts/live/s-e-train1b.ts" } as const;
export type ScriptKey = keyof typeof SCRIPTS;

/** The phases, in order. A1, A2 and BC are the three launches. */
export type Phase = "offline-0" | "A1" | "offline-1" | "A2" | "offline-2" | "offline-bc" | "BC";
export const LAUNCHES: readonly Phase[] = ["A1", "A2", "BC"];
export type Part = "A" | "B" | "C";

/** The pre-flight queue each launch uses (step 7 accepts the mutating pack only under S-E or P3-3; P3-1 is neither). */
export const LAUNCH_QUEUE: Readonly<Record<"A1" | "A2" | "BC", string>> = {
  A1: "docs/v2/sessions/queues/S-F-queue.json",
  A2: "docs/v2/sessions/queues/S-F-queue.json",
  BC: "docs/v2/sessions/queues/S-E-queue.json",
};
/** The packs launch.ts installs for each launch (it deletes every other ECEN_*.c there). */
export const LAUNCH_PACKS: Readonly<Record<"A1" | "A2" | "BC", readonly string[]>> = {
  A1: ["mod-dev/probe"],
  A2: ["mod-dev/probe"],
  BC: ["mod-dev/probe", "mod-dev/probe-mut"],
};

export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const LAUNCH_INI: Readonly<Record<"A1" | "A2" | "BC", string>> = {
  A1: `<sf-run>/${sf.INI_LAUNCH1}`,
  A2: `<sf-run>/${sf.INI_LAUNCH2}`,
  BC: "<se-run>/se-scratch.ini",
};

// Step ids (all defined in the sub-scripts; a test checks each one exists there).
const SF = {
  p2: "sf-p2-dlg-consumers-static",
  p1: "sf-p1-ini-launch1",
  gate1: "sf-00-gate",
  findA: "sf-02-u27-findfiles",
  findAgain: "sf-03-u27-findfiles-again",
  exists: "sf-04-u27-fileexists",
  findB: "sf-05-u27-findfiles-line-b",
  open: "sf-09-u27-openfile-yes-to-all",
  menusBg: "sf-12-u21-menus-background",
  menusFg: "sf-13-u21-menus-foreground",
  qt: "sf-14-u31-qt-introspection",
  p3: "sf-p3-ini-after-launch1",
  p4: "sf-p4-ini-launch2",
  gate2: "sf-20-gate",
  lspPort: "sf-22-u22-lsp-port",
  preset: "sf-23-u22-plugin-preset",
  lsp: "sf-24-u20-lsp-session",
  lsp2: "sf-25-u20-coexistence",
  shortcuts: "sf-26-u36-shortcuts-page-owner",
  close: "sf-27-close-test",
  p5: "sf-p5-ini-after-launch2",
} as const;
const SE = {
  gate: "se-00-gate",
  save: "se-05-u16-save",
  audio: "se-07-u8-AudioEditor",
  procAnim: "se-07-u8-ProcAnimEditor",
  reload: "se-16-u14-reload-broken",
} as const;

/**
 * P3-1's buttons at an authorization prompt (DEC-048 item 1; DEC-047 U27 row). FileExists is
 * answered No, so no grant precedes OpenFile in the fresh process (review P31-03); OpenFile gets
 * Yes; the first FindFiles the deliberate No; FindFiles again Yes to All; the second call site
 * shows Yes to All's scope. Every S-F invocation carries them as `--ruled-buttons`, so S-F's
 * handoff names them and its `--owner-clicked-deviation` means a press other than THESE.
 */
export const P31_BUTTON: Readonly<Record<string, AuthButton>> = {
  [SF.exists]: "No",
  [SF.open]: "Yes",
  [SF.findA]: "No",
  [SF.findAgain]: "YesToAll",
  [SF.findB]: "Yes",
};
/** In the BC launch the U27 experiment is over: the first prompt gets Yes to All. */
export const BC_BUTTON: AuthButton = "YesToAll";

export function p31Button(step: string): AuthButton {
  if (step.startsWith("se-")) return BC_BUTTON;
  return P31_BUTTON[step] ?? "Yes";
}

// ── The sequence ─────────────────────────────────────────────────────────────

export type Selection = { only: string } | { from: string; until: string } | { sub: "plant" };

export interface RunEntry {
  kind: "run";
  id: string;
  phase: Phase;
  part: Part[];
  script: ScriptKey;
  sel: Selection;
  /** The sub-script steps this invocation runs (the gate excluded). */
  steps: string[];
  /** What each step answers: the DECISIONS row it closes. */
  answers: string;
  /** A prompt expected from this entry: the button P3-1 rules for it. */
  prompt?: { step: string; button: AuthButton };
  /** Owner-hand steps inside the entry (exit 5 kind owner-hand; resume `--only-step X --owner-done`). */
  ownerHand?: string[];
}

export interface HandEntry {
  kind: "hand";
  id: string;
  phase: Phase;
  part: Part[];
  /** True for the entry that starts a Workbench (pre-flight step 8). */
  launches?: boolean;
  text: string;
  command?: string;
}

export type Entry = RunEntry | HandEntry;

const run = (
  id: string,
  phase: Phase,
  part: Part[],
  script: ScriptKey,
  sel: Selection,
  steps: string[],
  answers: string,
  extra: Partial<RunEntry> = {},
): RunEntry => ({ kind: "run", id, phase, part, script, sel, steps, answers, ...extra });

const auth = (step: string): { step: string; button: AuthButton } => ({
  step,
  button: p31Button(step),
});

/** The two options for the BC launch (review P31-01); the owner chooses in chat before it. */
export const BC_FLAG_NOTE =
  "BC: option A (default) no --script-authorize-all; option B only on the owner's go: pass 2 adds --script-authorize-all --owner-go-script-authorize-all";
const flagText = (launch: "A1" | "A2" | "BC"): string =>
  launch === "BC" ? BC_FLAG_NOTE : "never --script-authorize-all";

const preflightCmd = (launch: "A1" | "A2" | "BC"): string =>
  `npx --no tsx scripts/live/launch.ts --install-handlers "<sandbox>" ${LAUNCH_PACKS[launch]
    .map((p) => `--probe-pack ${p}`)
    .join(
      " ",
    )} --id <lane> --really; then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P3-1 ${launch}" --id <lane> --queue ${LAUNCH_QUEUE[launch]} --probe-pack --force-settings "${LAUNCH_INI[launch]}" --u12-passed (pass 1 --until 7, pass 2 --really; ${flagText(launch)})`;

export function buildSequence(): Entry[] {
  return [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      part: ["A", "B", "C"],
      text: "the lease for the one lane of the sitting (kept until the last post-flight)",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P3-1" --id <lane>',
    },
    run(
      "a-00",
      "offline-0",
      ["A"],
      "s-f",
      { from: SF.p2, until: SF.p1 },
      [SF.p2, SF.p1],
      "U23 (.dlg consumer scan, index path fixed in 16f8078; DEC-047 U23 row); U36 input (sf-launch1.ini without PropertyGrid\\unnamed rows)",
    ),
    {
      kind: "hand",
      id: "h-launch-a1",
      phase: "A1",
      part: ["A"],
      launches: true,
      text: "launch 1 (fresh process, read-only pack incl. ECEN_ProbeAuth.c, no mutating pack, no -scriptAuthorizeAll)",
      command: preflightCmd("A1"),
    },
    run(
      "a-01",
      "A1",
      ["A"],
      "s-f",
      { only: SF.exists },
      [SF.exists],
      "U27: does FileExists prompt in a fresh process before any FindFiles (DEC-047 U27 row, per-method claim)",
      { prompt: auth(SF.exists) },
    ),
    run(
      "a-02",
      "A1",
      ["A"],
      "s-f",
      { only: SF.open },
      [SF.open],
      "U27: does OpenFile prompt before any FindFiles (DEC-047 U27 row)",
      { prompt: auth(SF.open) },
    ),
    run(
      "a-03",
      "A1",
      ["A"],
      "s-f",
      { only: SF.findA },
      [SF.findA],
      "U27: the first FindFiles prompt and the deliberate No: what a refused call returns (DEC-047 U27 row)",
      { prompt: auth(SF.findA) },
    ),
    run(
      "a-04",
      "A1",
      ["A"],
      "s-f",
      { only: SF.findAgain },
      [SF.findAgain],
      "U27: does a No hold for the process (a second prompt or a silent refusal); the Yes to All press (DEC-047 U27 row)",
      { prompt: auth(SF.findAgain) },
    ),
    run(
      "a-05",
      "A1",
      ["A"],
      "s-f",
      { only: SF.findB },
      [SF.findB],
      "U27: Yes to All's scope on a later FindFiles from the second call site (DEC-047 U27 row)",
      { prompt: auth(SF.findB) },
    ),
    run(
      "a-06",
      "A1",
      ["A"],
      "s-f",
      { from: SF.menusBg, until: SF.qt },
      [SF.menusBg, SF.menusFg, SF.qt],
      "U21 the scripted Expand without and with foreground (SysShadow rule fixed in 16f8078); U31 the Qt Introspection label read, then executeAction (DEC-047 U21, U31 rows)",
      { ownerHand: [SF.menusFg] },
    ),
    {
      kind: "hand",
      id: "h-close-a1",
      phase: "A1",
      part: ["A"],
      text: "the owner closes launch 1 (File > Exit, Don't Save); partial post-flight, the lease kept",
      command:
        "npx --no tsx scripts/live/postflight.ts --id <lane> --partial 1,2,3 --registry-before <reg> --sandbox <sandbox> --really",
    },
    run(
      "a-07",
      "offline-1",
      ["A"],
      "s-f",
      { from: SF.p3, until: SF.p4 },
      [SF.p3, SF.p4],
      "U36 re-read after launch 1 with the fixed counter (6e884b8; expected 0 rows, DEC-047 U36 row); U22 inputs (LSP keys, the preset token 512 -> 384 by ini-edit set --token)",
    ),
    {
      kind: "hand",
      id: "h-launch-a2",
      phase: "A2",
      part: ["A"],
      launches: true,
      text: "launch 2 on sf-launch2.ini (read-only pack, no -scriptAuthorizeAll)",
      command: preflightCmd("A2"),
    },
    run(
      "a-08",
      "A2",
      ["A"],
      "s-f",
      { only: SF.gate2 },
      [SF.gate2],
      "the launch-2 gate: a new pid against gate-launch1.json",
    ),
    run(
      "a-09",
      "A2",
      ["A"],
      "s-f",
      { from: SF.lspPort, until: SF.preset },
      [SF.lspPort, SF.preset],
      "U22 the preset half (the struct-valued line's token honoured at the next start; DEC-047 U22 row)",
    ),
    run(
      "a-10",
      "A2",
      ["A"],
      "s-f",
      { from: SF.lsp, until: SF.lsp2 },
      [SF.lsp, SF.lsp2],
      "U20 the LSP session and the second client (lsp-probe --sandbox fixed in 16f8078; DEC-047 U20 row)",
    ),
    run(
      "a-11",
      "A2",
      ["A"],
      "s-f",
      { from: SF.shortcuts, until: SF.close },
      [SF.shortcuts, SF.close],
      "U36 the Shortcuts page opened (owner hand) so launch 2 writes the rows; the close rule",
      { ownerHand: [SF.shortcuts, SF.close] },
    ),
    run(
      "a-12",
      "offline-2",
      ["A"],
      "s-f",
      { only: SF.p5 },
      [SF.p5],
      "U36 re-read after launch 2 with the fixed counter (expected rows > 0; the second sample DEC-047 U36 row asks for)",
    ),
    {
      kind: "hand",
      id: "h-post-a2",
      phase: "offline-2",
      part: ["A"],
      text: "partial post-flight after launch 2, the lease kept for the BC launch",
      command:
        "npx --no tsx scripts/live/postflight.ts --id <lane> --partial 1,2,3 --registry-before <reg> --sandbox <sandbox> --really",
    },
    run(
      "bc-00",
      "offline-bc",
      ["C"],
      "s-e",
      { sub: "plant" },
      [],
      "package G prerequisite: the u11 plants (ProcAnimEditor's target ECEN_SE_U11_stripped.pap); creates the S-E run folder",
    ),
    {
      kind: "hand",
      id: "h-launch-bc",
      phase: "BC",
      part: ["B", "C"],
      launches: true,
      text: "launch 3: both packs (pre-flight step 7 accepts the mutating pack only under session S-E or P3-3, so S-E's queue); before pass 2 build the BC scratch ini fresh from the pass-1 export as S-D.md 'Before the sitting' item 6 does, into <se-run>/se-scratch.ini, and record its name; the owner chooses option A (no -scriptAuthorizeAll) or B (the flag on this launch only)",
      command: preflightCmd("BC"),
    },
    run(
      "bc-01",
      "BC",
      ["C"],
      "s-e",
      { only: SE.save },
      [SE.save],
      "package G prerequisite: the u16 copies (AudioEditor's target UI_Respawn.acp); U16 re-observed, not re-ruled",
      { prompt: auth(SE.save) },
    ),
    run(
      "bc-02",
      "BC",
      ["C"],
      "s-e",
      { only: SE.audio },
      [SE.audio],
      "package G: containerWriteTest on AudioEditor, the fact pathForm (relative | absolute | none) (DEC-048 G; decides how wide wb_module setResource/save go)",
      { prompt: auth(SE.audio) },
    ),
    run(
      "bc-03",
      "BC",
      ["C"],
      "s-e",
      { only: SE.procAnim },
      [SE.procAnim],
      "package G: containerWriteTest on ProcAnimEditor, the fact pathForm (DEC-048 G)",
      { prompt: auth(SE.procAnim) },
    ),
    run(
      "bc-04",
      "BC",
      ["B"],
      "s-e",
      { only: SE.reload },
      [SE.reload],
      "U4 recovery question: plant, ReloadScripts (expect failure), remove, ReloadScripts again, Ping, the WorkbenchGame log lines (DEC-047 U4 row and L1 row: why the recovery reload also answered Compilation failed)",
      { prompt: auth(SE.reload) },
    ),
    {
      kind: "hand",
      id: "h-close-bc",
      phase: "BC",
      part: ["B", "C"],
      text: "the owner closes launch 3 (File > Exit, Don't Save); full post-flight removing both packs; the throwaway removed",
      command: `npx --no tsx scripts/live/postflight.ts --id <lane> --registry-before <reg> --sandbox <sandbox> --remove-probe-mut --remove-probe --session-number ${SESSION_NUMBER} --really; npx --no tsx ${SCRIPTS["s-e"]} rollback --run-dir <se-run> --id <lane> --remove-throwaway --really`,
    },
  ];
}

export const runEntries = (seq: Entry[] = buildSequence()): RunEntry[] =>
  seq.filter((e): e is RunEntry => e.kind === "run");
export const launchCount = (seq: Entry[] = buildSequence()): number =>
  seq.filter((e) => e.kind === "hand" && e.launches).length;
export const isOfflinePhase = (p: Phase): boolean => p.startsWith("offline");

/** The S-E steps session 007 answered need `--repeat-all` (s-e-train1b.ts selectionRefusal). */
export function needsRepeatAll(e: RunEntry): boolean {
  return e.script === "s-e" && e.steps.some((s) => se.ANSWERED_IN_007.includes(s));
}

export function invocationWorstCaseMs(e: RunEntry): number {
  if ("sub" in e.sel) return 0;
  const sel = { from: null, until: null, only: null, ...e.sel };
  if (e.script === "s-f") return sf.invocationWorstCaseMs(sf.selectedIds(sel));
  return se.invocationWorstCaseMs(se.selectedIds(sel));
}

// ── Composing one invocation ─────────────────────────────────────────────────

export interface ComposeInput {
  laneId: string;
  really: boolean;
  sfRunDir?: string | null;
  seRunDir?: string | null;
  registryExport?: string | null;
  forceSettings?: string | null;
  sandbox?: string | null;
  iniIn?: string | null;
  ownerClicked?: AuthButton[] | null;
  /** The owner pressed another button than P3-1's ruling (recorded by the sub-script as a deviation). */
  ownerDeviation?: boolean;
  /** Run one step of the entry with `--only` (the rest of a block after a stop or an owner hand). */
  onlyStep?: string | null;
  ownerDone?: boolean;
}

/** The entry before this one that runs a sub-script: its prompt is what --owner-clicked answers. */
export function previousRun(id: string, seq: Entry[] = buildSequence()): RunEntry | null {
  const i = seq.findIndex((e) => e.id === id);
  for (let j = i - 1; j >= 0; j--) {
    const e = seq[j];
    if (e.kind === "hand" && e.launches) return null;
    if (e.kind === "run") return e;
  }
  return null;
}

/** The argv for the sub-script (after its path), or a refusal. */
export function composeArgs(
  entryId: string,
  input: ComposeInput,
  seq: Entry[] = buildSequence(),
): { argv: string[]; script: string } | { refusal: string } {
  const e = seq.find((x) => x.id === entryId);
  if (!e) return { refusal: `unknown entry ${entryId}` };
  if (e.kind === "hand")
    return { refusal: `${entryId} is the main session's hand step: ${e.command ?? e.text}` };
  if (!input.laneId) return { refusal: "--id <lane id> is required" };
  const argv: string[] = [];
  const script = SCRIPTS[e.script];
  const runDirOf = e.script === "s-f" ? input.sfRunDir : input.seRunDir;
  if ("sub" in e.sel) {
    if (!runDirOf)
      return { refusal: "plant creates the S-E run folder: pass --se-run-dir <new dir>" };
    argv.push("plant", "--run-dir", runDirOf, "--id", input.laneId);
    if (input.sandbox) argv.push("--sandbox", input.sandbox);
    if (input.really) argv.push("--really");
    return { argv, script };
  }
  if (input.really) argv.push("--really");
  argv.push("--id", input.laneId);
  if (input.onlyStep) {
    if (!e.steps.includes(input.onlyStep))
      return { refusal: `${input.onlyStep} is not a step of ${entryId}` };
    argv.push("--only", input.onlyStep);
  } else if ("only" in e.sel) argv.push("--only", e.sel.only);
  else argv.push("--from", e.sel.from, "--until", e.sel.until);
  if (input.ownerDone) {
    if (!input.onlyStep || !(e.ownerHand ?? []).includes(input.onlyStep))
      return {
        refusal: "--owner-done resumes an owner-hand step of the entry: --only-step <that step>",
      };
    argv.push("--owner-done");
  }
  // The first S-F invocation creates the run folder; every later one resumes it.
  const first = runEntries(seq).find((r) => r.script === e.script && !("sub" in r.sel));
  const createsRunDir = e.script === "s-f" && first?.id === e.id && !input.onlyStep;
  if (!createsRunDir) {
    if (!runDirOf)
      return {
        refusal: `${entryId} resumes the ${e.script === "s-f" ? "S-F" : "S-E"} run folder: pass --${e.script}-run-dir <dir>`,
      };
    argv.push("--run-dir", runDirOf);
  }
  const offline = isOfflinePhase(e.phase);
  if (offline) argv.push("--offline");
  else {
    if (!input.registryExport || !input.forceSettings)
      return { refusal: "a launch entry needs --registry-export and --force-settings" };
    argv.push("--registry-export", input.registryExport, "--force-settings", input.forceSettings);
  }
  if (e.steps.includes(SF.p1)) {
    if (!input.iniIn) return { refusal: "sf-p1 needs --ini-in <the scrubbed ini>" };
    argv.push("--ini-in", input.iniIn);
  }
  if (input.sandbox) argv.push("--sandbox", input.sandbox);
  if (needsRepeatAll(e)) argv.push("--repeat-all");
  if (input.ownerClicked && input.ownerClicked.length) {
    const prev = previousRun(entryId, seq);
    if (!prev || !prev.prompt)
      return {
        refusal: "--owner-clicked answers the previous entry's prompt; none is expected there",
      };
    const ruled = prev.prompt.button;
    if (input.ownerClicked.some((b) => b !== ruled) && !input.ownerDeviation)
      return {
        refusal: `P3-1 rules ${ruled} at ${prev.prompt.step}; --owner-clicked ${input.ownerClicked.join(",")} differs: pass --owner-deviation to record the owner's real press`,
      };
    argv.push("--owner-clicked", input.ownerClicked.join(","));
    // S-F compares with the --ruled-buttons it is given (P3-1's); S-E has no deviation flag.
    if (prev.script === "s-f" && input.ownerDeviation) argv.push("--owner-clicked-deviation");
  }
  if (e.script === "s-f" && !offline)
    argv.push(
      "--ruled-buttons",
      Object.entries(P31_BUTTON)
        .map(([k, v]) => `${k}=${v}`)
        .join(","),
    );
  return { argv, script };
}

// ── The combined plan and the queue ──────────────────────────────────────────

export function launchAction(launch: "A1" | "A2" | "BC"): PlanAction {
  return {
    kind: "launch",
    step: `p3-1-launch-${launch}`,
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", LAUNCH_INI[launch]],
    note: `pre-flight step 8 with ${LAUNCH_QUEUE[launch]}; packs ${LAUNCH_PACKS[launch].join(", ")}; ${launch === "BC" ? "no -scriptAuthorizeAll unless the owner's go (option B)" : "no -scriptAuthorizeAll"}`,
  };
}

/** The sub-scripts' own plan actions for the selected steps, in P3-1 order, plus the launches. */
export function buildPlan(o: { sandboxDir: string | null } = { sandboxDir: null }): PlanAction[] {
  const sfPlan = sf.buildActionPlan(sf.planInput({ sandboxDir: o.sandboxDir }));
  const sePlan = se.buildActionPlan(
    se.planInput({ sandboxDir: o.sandboxDir, policy: loadPolicy(), nonce: "<nonce>" }),
  );
  const of = (plan: PlanAction[], step: string): PlanAction[] =>
    plan.filter((a) => a.step === step);
  const out: PlanAction[] = [];
  for (const e of buildSequence()) {
    if (e.kind === "hand") {
      if (e.launches) {
        const l = e.phase as "A1" | "A2" | "BC";
        out.push(launchAction(l));
        if (l === "A1") out.push(...of(sfPlan, SF.gate1));
        if (l === "BC") out.push(...of(sePlan, SE.gate));
      }
      continue;
    }
    for (const s of e.steps) out.push(...of(e.script === "s-f" ? sfPlan : sePlan, s));
  }
  out.push({
    kind: "screenshot",
    target: "desktop",
    step: "any",
    when: "only on a timeout or a kill criterion (the sub-script's rule)",
  });
  return out;
}

/** The queue steps of P3-1 in order (the gates first in their launch). */
export function queueSteps(): Array<{ id: string; phase: Phase; script: ScriptKey }> {
  const out: Array<{ id: string; phase: Phase; script: ScriptKey }> = [];
  for (const e of buildSequence()) {
    if (e.kind === "hand") {
      if (e.launches && e.phase === "A1") out.push({ id: SF.gate1, phase: "A1", script: "s-f" });
      if (e.launches && e.phase === "BC") out.push({ id: SE.gate, phase: "BC", script: "s-e" });
      continue;
    }
    for (const s of e.steps) out.push({ id: s, phase: e.phase, script: e.script });
  }
  return out;
}

export function buildQueue(): Record<string, unknown> {
  const pick = (q: Record<string, unknown>): Map<string, Record<string, unknown>> =>
    new Map((q.probes as Array<Record<string, unknown>>).map((p) => [String(p.id), p] as const));
  const sfProbes = pick(sf.buildQueue());
  const seProbes = pick(se.buildQueue());
  const probes = queueSteps().map(({ id, phase, script }) => {
    const p = (script === "s-f" ? sfProbes : seProbes).get(id);
    if (!p) throw new Error(`${id} is not in ${SCRIPTS[script]}'s queue`);
    return {
      ...p,
      launch: phase,
      script: SCRIPTS[script],
      ...(P31_BUTTON[id] ? { p31_button: P31_BUTTON[id] } : {}),
    };
  });
  const seq = buildSequence();
  return {
    $comment:
      "Generated by `scripts/live/p3-1.ts --emit-queue` from the sub-scripts' queues in P3-1 order; tests/live-harness/p3-1.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue per launch. Pre-flight itself runs each launch on the sub-script's own queue (launch_queues): step 7 accepts the mutating pack only under S-E's.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "DEC-048 Live sittings 1",
      "DEC-047 U4, U20, U21, U22, U23, U27, U31, U36, L1",
      "PLAN 5.3",
      "PLAN 5.4",
    ],
    launches: launchCount(seq),
    launch_queues: LAUNCH_QUEUE,
    launch_packs: LAUNCH_PACKS,
    launch_args: Object.fromEntries(
      LAUNCHES.map((l) => [l, launchAction(l as "A1" | "A2" | "BC").args]),
    ),
    launch_args_note:
      "pre-flight builds the real arguments; A1 and A2 never carry -scriptAuthorizeAll; " +
      BC_FLAG_NOTE,
    p31_buttons: { ...P31_BUTTON, "se-* (BC)": BC_BUTTON },
    invocations: runEntries(seq).map((e) => ({
      id: e.id,
      phase: e.phase,
      script: SCRIPTS[e.script],
      selection: e.sel,
      worst_case_ms: invocationWorstCaseMs(e),
    })),
    probes,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "sandbox",
  "entry",
  "id",
  "sf-run-dir",
  "se-run-dir",
  "registry-export",
  "force-settings",
  "ini-in",
  "owner-clicked",
  "only-step",
];

export function outline(): string[] {
  const lines: string[] = [`P3-1: ${launchCount()} launches; one lane; no -scriptAuthorizeAll`];
  for (const e of buildSequence()) {
    if (e.kind === "hand") {
      lines.push(`  ${e.id} [${e.phase}] HAND${e.launches ? " (LAUNCH)" : ""}: ${e.text}`);
      continue;
    }
    const sel =
      "sub" in e.sel
        ? e.sel.sub
        : "only" in e.sel
          ? `--only ${e.sel.only}`
          : `--from ${e.sel.from} --until ${e.sel.until}`;
    lines.push(
      `  ${e.id} [${e.phase}] ${SCRIPTS[e.script]} ${sel}${needsRepeatAll(e) ? " --repeat-all" : ""}${isOfflinePhase(e.phase) && !("sub" in e.sel) ? " --offline" : ""}; worst case ${invocationWorstCaseMs(e)} ms${e.prompt ? `; a prompt: ${e.prompt.button}` : ""}${e.ownerHand ? `; owner hand ${e.ownerHand.join(", ")}` : ""}`,
      `      answers: ${e.answers}`,
    );
  }
  return lines;
}

export interface MainOverrides {
  spawnChild?: (script: string, argv: string[]) => Promise<number>;
  log?: (line: string) => void;
}

const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function defaultSpawn(script: string, argv: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      ["--import", TSX_IMPORT, join(REPO_ROOT, script), ...argv],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => res(code ?? 1));
    child.on("error", () => res(1));
  });
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const log = over.log ?? ((l: string) => console.log(l));
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  if (args.flags.has("script-authorize-all") || argv.some((a) => /scriptauthorizeall/i.test(a))) {
    log(`refused: P3-1 never passes ${sf.NEVER_FLAG}`);
    return 2;
  }
  if (!o.entry) {
    for (const l of outline()) log(l);
    const plan = buildPlan({ sandboxDir: o.sandbox ?? null });
    const check = checkPlan(plan, loadPolicy(), { script: SCRIPT_PATH });
    log(formatResult(check));
    const queue = buildQueue();
    let queueOk = true;
    try {
      const n = validateQueue(queue, false).length;
      log(`queue: ${n} probes, valid (validateQueue, per launch)`);
    } catch (e) {
      queueOk = false;
      log(`queue refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf-8");
    };
    if (o.out) write(o.out, JSON.stringify(plan, null, 2) + "\n");
    if (o.outline) write(o.outline, outline().join("\n") + "\n");
    if (o["emit-queue"]) write(o["emit-queue"], JSON.stringify(queue, null, 2) + "\n");
    return check.ok && queueOk ? 0 : 1;
  }
  let clicked: AuthButton[] | null = null;
  if (o["owner-clicked"]) {
    const list = o["owner-clicked"].split(",").map((s) => s.trim());
    if (list.some((b) => !(AUTH_BUTTONS as readonly string[]).includes(b))) {
      log(`--owner-clicked takes ${AUTH_BUTTONS.join(", ")}`);
      return 2;
    }
    clicked = list as AuthButton[];
  }
  if (args.flags.has("owner-deviation") && !clicked) {
    log("--owner-deviation needs --owner-clicked");
    return 2;
  }
  const really = args.flags.has("really");
  const r = composeArgs(o.entry, {
    laneId: o.id ?? "",
    really,
    sfRunDir: o["sf-run-dir"] ?? null,
    seRunDir: o["se-run-dir"] ?? null,
    registryExport: o["registry-export"] ?? null,
    forceSettings: o["force-settings"] ?? null,
    sandbox: o.sandbox ?? null,
    iniIn: o["ini-in"] ?? null,
    ownerClicked: clicked,
    ownerDeviation: args.flags.has("owner-deviation"),
    onlyStep: o["only-step"] ?? null,
    ownerDone: args.flags.has("owner-done"),
  });
  if ("refusal" in r) {
    log(`refused: ${r.refusal}`);
    return 1;
  }
  const ph = defaultPlaceholderContext({
    v2: REPO_ROOT,
    ...(o.sandbox ? { sandbox: o.sandbox } : {}),
  });
  log(toPlaceholders(`P3-1 ${o.entry}: npx --no tsx ${r.script} ${r.argv.join(" ")}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
