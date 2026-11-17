/**
 * Sitting P4-8, the blind exploration (plan 4.6; design docs/v2/design/phase4-live-census.md §3,
 * the P4-8 row; DEC-054, DEC-055). A THIN orchestrator in `p4-5.ts`'s shape: every live step is a
 * census walker's step run through its own CLI, one raw NET call through `scripts/live/netcall.ts`,
 * or one draw run through `scripts/census/blind.ts walk` (one step per draw; the raw document lands
 * as `<sitting>/<module>-<stateTag>/b-NNN-{menus,context,walk}.json`). The draws come from
 * `docs/v2/sessions/queues/P4-8-draws.json` (`blind.ts draw`); `blind.ts check` scores them after
 * the sitting.
 *
 * Run order (module switches and state changes kept minimal):
 *   the world route        P4-5's w-01..w-04 (worlds created, World Editor opened by L10, tiny world
 *                          opened, layerRead); s-00 getSelected (count 0): edit/none
 *   WorldEditor edit/none  its draws: menus, sub-menus, dialogs (owner-opened), context menus last
 *                          (ShowContextMenu may move the selection)
 *   h-layer                the owner clicks the `default` layer row in the Hierarchy (the P4-1
 *                          remainder's route); s-01 getSelected (count 0: a layer is not an entity)
 *   WorldEditor edit/layer its draws
 *   P4-5's e-00..e-02      create the rock, select it, getSelected (count 1): edit/entity
 *   WorldEditor edit/entity its draws
 *   every other module     L10's open step for it (`p4-l10-NN-<Module>`), then its draws (`none`)
 *   h-close                WM_CLOSE; the unsaved world's save prompt is the owner's "No" (never Save)
 *
 * Never Save, never click, no ExecuteAction off the allow-list (the blind steps send none at all);
 * the per-step window watch and the D13 stops are the walkers' (common.ts). DRY RUN BY DEFAULT:
 * prints the outline, checks every entry's plan under its own script, validates the queue.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-8.ts [--draws <plan.json>] [--out <plan.json>] [--outline <file>]
 *       [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-8.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir> [--only-step <step>] [--really]
 *   npx --no tsx scripts/live/p4-8.ts plant|rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: the child's exit code for a real entry; the dry run 0 passed, 1 failed, 2 usage.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SCRIPT as BLIND_SCRIPT,
  KIND_ORDER,
  MODULE_ORDER,
  blindDef,
  liveStates,
  loadDrawPlan,
  runSubOf,
  type Draw,
} from "../census/blind.js";
import {
  buildWalkerQueue,
  parseState,
  walkerPlan,
  type ObservedState,
  type WalkerStep,
} from "../census/live/common.js";
import { MODULE_MATRIX, moduleStepId } from "../census/live/L10-modules.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import {
  P4_ROOT,
  PLANT_CONF,
  PLANT_FILE,
  SAA,
  VANILLA_CONF,
  WALKERS,
  main as p41Main,
  walkerDefs,
} from "./p4-1.js";
import { buildSequence as p45Sequence, ENTITY_NAME, type NetEntry } from "./p4-5.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P4-8";
export const SCRIPT_PATH = "scripts/live/p4-8.ts";
export const P41_SCRIPT = "scripts/live/p4-1.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-8.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-8-queue.json";
export const DRAWS_REL = "docs/v2/sessions/queues/P4-8-draws.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const DEFAULT_DRAWS = join(REPO_ROOT, ...DRAWS_REL.split("/"));
export const NETCALL = "scripts/live/netcall.ts";
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const SCRATCH_INI = "<sitting>/p4-scratch.ini";
export const PACKS = ["mod-dev/probe", "mod-dev/probe-mut"] as const;
export const MAX_RELAUNCHES = 3;
/** The World Editor's three live states, in run order (none, then layer, then entity). */
export const WE_STATES = liveStates("WorldEditor");

// ── The sequence ─────────────────────────────────────────────────────────────

export type Phase = "offline-0" | "L1" | "close";

export interface WalkerEntry {
  kind: "walker";
  id: string;
  phase: "L1";
  walker: "L10";
  module: "Shared";
  /** `--state` syntax. */
  state: string;
  runSub: string;
  only: string;
  answers: string;
}

export interface BlindEntry {
  kind: "blind";
  id: string;
  phase: "L1";
  draw: Draw;
  runSub: string;
}

export interface SelfEntry {
  kind: "self";
  id: string;
  phase: "offline-0";
  sub: "plant";
  answers: string;
}

export interface HandEntry {
  kind: "hand";
  id: string;
  phase: Phase;
  launches?: boolean;
  handoff?: boolean;
  text: string;
  command?: string;
  ownerHand?: string;
}

export type Entry = WalkerEntry | NetEntry | BlindEntry | SelfEntry | HandEntry;
export type RunEntry = WalkerEntry | NetEntry | BlindEntry | SelfEntry;

const HEARTBEAT = "npx --no tsx scripts/live/lane.ts heartbeat --id <lane>";

export const LAUNCH_COMMAND =
  `npx --no tsx scripts/live/launch.ts --install-handlers "<sandbox>" ${PACKS.map((p) => `--probe-pack ${p}`).join(" ")} --id <lane> --really; ` +
  `then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P4-8" --id <lane> --queue ${QUEUE_REL} --probe-pack --force-settings "${SCRATCH_INI}" --u12-passed --script-authorize-all --owner-go-script-authorize-all ` +
  "(pass 1 --until 7; before pass 2 build the scratch ini fresh from the pass-1 export as S-D.md 'Before the sitting' item 6; pass 2 --really)";

export const CLOSE_COMMAND =
  "npx --no tsx scripts/live/postflight.ts --id <lane> --registry-before <reg> --sandbox <sandbox> --remove-probe-mut --remove-probe --session-number <NNN> --really; " +
  `npx --no tsx ${SCRIPT_PATH} rollback --sandbox <sandbox> --sitting-dir <sitting> --id <lane> --really`;

/** P4-5's net entry `id`, as it is (the world route and the entity create are reused, not copied). */
function fromP45(id: string): NetEntry {
  const e = p45Sequence().find((x) => x.id === id);
  if (!e || e.kind !== "net") throw new Error(`p4-5.ts has no net entry ${id}`);
  return { ...e, answers: `P4-5 ${id}: ${e.answers}` };
}

function selectionCheck(id: string, count: 0 | 1, why: string): NetEntry {
  return {
    kind: "net",
    id,
    phase: "L1",
    apiFunc: "EMCP_WB_SelectEntity",
    params: { action: "getSelected" },
    timeoutMs: 30_000,
    risk: "read-only",
    expected: `selectedCount ${count}${why}`,
    kill: `a count other than ${count}: STOP before any draw of the state`,
    sideEffects: [],
    rollback: "none",
    answers: "the state oracle before the state's draws",
  };
}

function l10Open(module: string): WalkerEntry {
  const i = MODULE_MATRIX.findIndex((m) => m.id === module);
  if (i < 0) throw new Error(`L10 has no open step for ${module}`);
  return {
    kind: "walker",
    id: `m-${module}-open`,
    phase: "L1",
    walker: "L10",
    module: "Shared",
    state: "none",
    runSub: `${module}-open`,
    only: moduleStepId(i + 1, module),
    answers: `${module} opened empty (no SetOpenedResource), fronted, info: L10's open route, once`,
  };
}

function blindEntries(draws: readonly Draw[], module: string, state: string): BlindEntry[] {
  return draws
    .filter((d) => d.module === module && d.state === state)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : 1))
    .map((d) => ({ kind: "blind", id: d.id, phase: "L1", draw: d, runSub: runSubOf(d) }));
}

export function loadDraws(path: string = DEFAULT_DRAWS): Draw[] {
  return loadDrawPlan(path).draws;
}

export function buildSequence(draws: readonly Draw[] = loadDraws()): Entry[] {
  const known = new Set<string>(MODULE_ORDER);
  const stray = draws.filter((d) => !known.has(d.module) || !liveStates(d.module).includes(d.state));
  if (stray.length)
    throw new Error(`draws outside the sitting's modules and states: ${stray.map((d) => d.id).join(", ")}`);
  const seq: Entry[] = [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      text: "the lease for the one lane (kept to the post-flight); heartbeat during any hand longer than 10 min (the lease orphans after about 15 min, DEC-053)",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-8" --id <lane>',
    },
    {
      kind: "self",
      id: "o-00-plant",
      phase: "offline-0",
      sub: "plant",
      answers: `P4-1's plant (${VANILLA_CONF} at <sandbox>/${PLANT_CONF}); STOP if <sandbox>/${P4_ROOT}/ exists (the last sitting's rollback must have run)`,
    },
    {
      kind: "hand",
      id: "h-launch",
      phase: "L1",
      launches: true,
      text: `the launch: handlers and both packs (the world create and the entity create are ECEN_ProbeMut and EMCP_WB_CreateEntity in the throwaway world), two-pass pre-flight on the P4-8 queue, the scratch ini, ${SAA} on the owner's standing go (DEC-053)`,
      command: LAUNCH_COMMAND,
      ownerHand: "the launch go in chat",
    },
    fromP45("w-01-worlds-create"),
    {
      ...l10Open("WorldEditor"),
      id: "w-02-world-editor",
      state: WE_STATES[0],
      runSub: "world",
      answers: "the World Editor module opened by L10's step (P4-5 w-02)",
    },
    fromP45("w-03-world-open"),
    fromP45("w-04-world-check"),
  ];
  const weGates: Record<string, Entry[]> = {
    [WE_STATES[0]]: [
      selectionCheck("s-00-none-check", 0, "; right after the open nothing is selected (edit/none)"),
    ],
    [WE_STATES[1]]: [
      {
        kind: "hand",
        id: "h-layer",
        phase: "L1",
        text: "the owner clicks the `default` layer row in the Hierarchy once (the P4-1 remainder's route to edit/layer); main confirms the row is highlighted (computer-use zoom on the Hierarchy); heartbeat the lease",
        command: HEARTBEAT,
        ownerHand: "one click on the default layer row",
      },
      selectionCheck(
        "s-01-layer-check",
        0,
        "; a layer is not an entity, so the count stays 0 and main's zoom is the layer oracle",
      ),
    ],
    [WE_STATES[2]]: [
      fromP45("e-00-entity-create"),
      fromP45("e-01-entity-select"),
      fromP45("e-02-selection-check"),
    ],
  };
  for (const state of WE_STATES) {
    seq.push(...(weGates[state] ?? []));
    seq.push(...blindEntries(draws, "WorldEditor", state));
  }
  for (const module of MODULE_ORDER) {
    if (module === "WorldEditor") continue;
    const mine = draws.filter((d) => d.module === module);
    if (!mine.length) continue;
    seq.push(l10Open(module));
    for (const state of liveStates(module)) seq.push(...blindEntries(draws, module, state));
  }
  seq.push({
    kind: "hand",
    id: "h-close",
    phase: "close",
    handoff: true,
    text: `the full post-flight: one WM_CLOSE to the recorded main window (DEC-053); the unsaved tiny world prompts to save changes: a HANDOFF the owner answers "No" (never Save); then net-zero diff, registry comparison, both packs removed, lease ended; then rollback of ${P4_ROOT}/`,
    command: CLOSE_COMMAND,
    ownerHand: '"No" on the save-changes prompt',
  });
  return seq;
}

export const runEntries = (seq: Entry[]): RunEntry[] =>
  seq.filter((e): e is RunEntry => e.kind !== "hand");
export const launchCount = (seq: Entry[]): number =>
  seq.filter((e) => e.kind === "hand" && e.launches).length;

// ── Steps of an entry ────────────────────────────────────────────────────────

function stateOf(text: string): ObservedState {
  const s = parseState(text);
  if (typeof s === "string") throw new Error(s);
  return s;
}

export function walkerSteps(e: WalkerEntry): WalkerStep[] {
  return walkerDefs()
    .L10.steps({ module: e.module, state: stateOf(e.state), allowOwned: false })
    .filter((s) => s.id === e.only);
}

export function blindStep(e: BlindEntry, draws: readonly Draw[]): WalkerStep[] {
  return blindDef(draws)
    .steps({ module: e.draw.module, state: stateOf(e.draw.state), allowOwned: false })
    .filter((s) => s.id === e.id);
}

export function entryWorstCaseMs(e: RunEntry, draws: readonly Draw[]): number {
  if (e.kind === "net") return e.timeoutMs;
  if (e.kind === "self") return 30_000;
  const steps = e.kind === "walker" ? walkerSteps(e) : blindStep(e, draws);
  return steps.reduce((n, s) => n + s.timeout_ms, 0);
}

// ── Composing one invocation ─────────────────────────────────────────────────

export interface ComposeInput {
  laneId: string;
  really: boolean;
  sandbox?: string | null;
  sittingDir?: string | null;
  onlyStep?: string | null;
  /** The draws file the blind entries name (default DRAWS_REL). */
  drawsPath?: string;
}

export function composeArgs(
  entryId: string,
  input: ComposeInput,
  seq: Entry[],
  draws: readonly Draw[],
): { argv: string[]; script: string } | { refusal: string } {
  const e = seq.find((x) => x.id === entryId);
  if (!e) return { refusal: `unknown entry ${entryId}` };
  if (e.kind === "hand")
    return { refusal: `${entryId} is the main session's hand step: ${e.command ?? e.text}` };
  if (!input.laneId) return { refusal: "--id <lane id> is required" };
  if (!input.sandbox) return { refusal: "--sandbox <the 2.0 sandbox folder> is required" };
  const lane = ["--id", input.laneId];
  if (e.kind === "self") {
    if (!input.sittingDir) return { refusal: "plant writes its record: pass --sitting-dir <dir>" };
    const argv = [e.sub, "--sandbox", input.sandbox, "--sitting-dir", input.sittingDir, ...lane];
    if (input.really) argv.push("--really");
    return { argv, script: P41_SCRIPT };
  }
  if (e.kind === "net") {
    const argv = [
      e.apiFunc,
      "--params",
      JSON.stringify(e.params),
      "--timeout-ms",
      String(e.timeoutMs),
      "--sandbox",
      input.sandbox,
    ];
    if (input.really) argv.push("--really", ...lane);
    return { argv, script: NETCALL };
  }
  if (!input.sittingDir)
    return { refusal: "a walker entry runs in <sitting>/<run folder>: pass --sitting-dir <dir>" };
  const steps = e.kind === "walker" ? walkerSteps(e) : blindStep(e, draws);
  if (steps.length !== 1) return { refusal: `${entryId} plans ${steps.length} steps, not one` };
  if (input.onlyStep && input.onlyStep !== steps[0].id)
    return { refusal: `${input.onlyStep} is not a step of ${entryId}` };
  const head = e.kind === "blind" ? ["walk", "--draws", input.drawsPath ?? DRAWS_REL] : [];
  const argv: string[] = [...head];
  if (input.really) argv.push("--really");
  argv.push(
    ...lane,
    "--sandbox",
    input.sandbox,
    "--run-dir",
    join(input.sittingDir, e.runSub),
    "--module",
    e.kind === "walker" ? e.module : e.draw.module,
    "--state",
    e.kind === "walker" ? e.state : e.draw.state,
    "--session",
    SESSION,
    "--only",
    steps[0].id,
  );
  return { argv, script: e.kind === "walker" ? WALKERS.L10 : BLIND_SCRIPT };
}

/** The draw kinds a batch runs: the ones no hand opens. Dialog and context draws keep their own entries. */
export const BATCH_KINDS = ["menu", "submenu"] as const;

/**
 * One invocation for every menu and sub-menu draw of a module and state (DEC-057): the same steps
 * as the per-draw entries, in one `blind.ts walk` process with no `--only`, one live read per menu
 * title (`--reuse-reads`). The state's hand steps and oracle entries come first, as for the entries.
 */
export function composeBatch(
  sel: { module: string; state: string; from?: string | null },
  input: ComposeInput,
  draws: readonly Draw[],
): { argv: string[]; script: string; ids: string[] } | { refusal: string } {
  if (!input.laneId) return { refusal: "--id <lane id> is required" };
  if (!input.sandbox) return { refusal: "--sandbox <the 2.0 sandbox folder> is required" };
  if (!input.sittingDir)
    return { refusal: "a batch runs in <sitting>/<run folder>: pass --sitting-dir <dir>" };
  const mine = draws.filter(
    (d) =>
      d.module === sel.module &&
      d.state === sel.state &&
      (BATCH_KINDS as readonly string[]).includes(d.kind),
  );
  if (!mine.length)
    return { refusal: `no menu or sub-menu draw for ${sel.module} in state ${sel.state}` };
  const ids = mine.map((d) => d.id);
  if (sel.from && !ids.includes(sel.from))
    return { refusal: `${sel.from} is not a menu or sub-menu draw of ${sel.module} in state ${sel.state}` };
  const argv = ["walk", "--draws", input.drawsPath ?? DRAWS_REL];
  if (input.really) argv.push("--really");
  argv.push(
    "--id",
    input.laneId,
    "--sandbox",
    input.sandbox,
    "--run-dir",
    join(input.sittingDir, runSubOf(mine[0])),
    "--module",
    sel.module,
    "--state",
    sel.state,
    "--session",
    SESSION,
    "--kinds",
    BATCH_KINDS.join(","),
    "--reuse-reads",
  );
  if (sel.from) argv.push("--from", sel.from);
  return { argv, script: BLIND_SCRIPT, ids: sel.from ? ids.slice(ids.indexOf(sel.from)) : ids };
}

/** A command line as printed (JSON params single-quoted). */
export function commandLine(script: string, argv: string[]): string {
  return `npx --no tsx ${script} ${argv.map((a) => (/[\s{"]/.test(a) ? `'${a}'` : a)).join(" ")}`;
}

// ── The combined plan and the queue ──────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    step: "p4-8-launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI, "-scriptAuthorizeAll"],
    ownerGo: "scriptAuthorizeAll",
    note: `pre-flight step 8 with ${QUEUE_REL}; packs ${PACKS.join(", ")}; ${SAA} on the owner's standing go (DEC-053 ruling 2)`,
  } as PlanAction;
}

/** The plan of one entry and the script its exceptions are scoped to. */
export function entryPlan(e: RunEntry, draws: readonly Draw[]): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: P41_SCRIPT, plan: [] };
  if (e.kind === "net")
    return {
      script: NETCALL,
      plan: [{ kind: "net-call", step: e.id, target: e.apiFunc, params: e.params } as PlanAction],
    };
  if (e.kind === "walker") {
    const sel = { module: e.module, state: stateOf(e.state), allowOwned: false };
    return { script: WALKERS.L10, plan: walkerPlan(walkerSteps(e), sel) };
  }
  const sel = { module: e.draw.module, state: stateOf(e.draw.state), allowOwned: false };
  return { script: BLIND_SCRIPT, plan: walkerPlan(blindStep(e, draws), sel) };
}

export function buildPlan(seq: Entry[], draws: readonly Draw[]): PlanAction[] {
  const out: PlanAction[] = [];
  for (const e of seq) {
    if (e.kind === "hand") {
      if (e.launches) out.push(launchAction());
      continue;
    }
    out.push(...entryPlan(e, draws).plan);
  }
  return out;
}

/** checkPlan per entry, under the script its exceptions name. */
export function checkEntries(seq: Entry[], draws: readonly Draw[]): { ok: boolean; lines: string[] } {
  const policy = loadPolicy();
  const lines: string[] = [];
  let ok = true;
  const launch = checkPlan([launchAction()], policy, { script: SCRIPT_PATH });
  if (!launch.ok) ok = false;
  lines.push(`h-launch: ${launch.ok ? "PASS" : formatResult(launch)}`);
  for (const e of runEntries(seq)) {
    const { script, plan } = entryPlan(e, draws);
    const r = checkPlan(plan, policy, { script });
    const empty = e.kind === "blind" || e.kind === "walker" ? plan.length === 0 : false;
    if (!r.ok || empty) ok = false;
    lines.push(
      `${e.id}: ${empty ? "FAIL (no plan: the draw's target is not on the policy)" : r.ok ? "PASS" : formatResult(r)} (${plan.length} actions)`,
    );
  }
  return { ok, lines };
}

export const PROBE_RANK = ["read-only", "reversible", "mutating"] as const;

/** The queue probes of the sitting, in run order (P4-5's block rule). */
export function queueProbes(seq: Entry[], draws: readonly Draw[]): Array<Record<string, unknown>> {
  const raw: Array<Record<string, unknown> & { phase: Phase }> = [];
  for (const e of runEntries(seq)) {
    if (e.kind === "self")
      raw.push({
        id: "p4-o-00-plant",
        title: `plant a copy of vanilla ${VANILLA_CONF} at <sandbox>/${PLANT_CONF}`,
        timeout_ms: 30_000,
        expected: `the copy byte for byte; ${PLANT_FILE} records its hash and the first top-level scalar`,
        kill_criterion: `a Workbench image runs, or <sandbox>/${P4_ROOT}/ exists: STOP`,
        side_effects: [`<sandbox>/${PLANT_CONF}`],
        rollback: `\`p4-8.ts rollback\` lists and removes <sandbox>/${P4_ROOT}/`,
        risk_class: "mutating",
        phase: e.phase,
        entry: e.id,
        script: P41_SCRIPT,
      });
    else if (e.kind === "net")
      raw.push({
        id: `p4-${e.id}`,
        title: `${e.apiFunc}${e.params.action ? ` ${String(e.params.action)}` : ""}`,
        timeout_ms: e.timeoutMs,
        expected: e.expected,
        kill_criterion: e.kill,
        side_effects: e.sideEffects,
        rollback: e.rollback,
        risk_class: e.risk,
        phase: e.phase,
        entry: e.id,
        script: NETCALL,
      });
    else {
      const def = e.kind === "walker" ? walkerDefs().L10 : blindDef(draws);
      const steps = e.kind === "walker" ? walkerSteps(e) : blindStep(e, draws);
      const q = buildWalkerQueue(def, steps, SESSION).probes as Array<Record<string, unknown>>;
      for (const p of q)
        raw.push({
          ...p,
          phase: e.phase,
          entry: e.id,
          script: e.kind === "walker" ? WALKERS.L10 : BLIND_SCRIPT,
          module: e.kind === "walker" ? e.module : e.draw.module,
          state: e.kind === "walker" ? e.state : e.draw.state,
        });
    }
  }
  const seen = new Set<string>();
  let block = 0;
  let lastRank = -1;
  let lastPhase: Phase | null = null;
  return raw.map(({ phase, ...p }) => {
    const step = String(p.id);
    let id = step;
    if (seen.has(id)) id = `${step}@${String(p.state).replace(/[=,]/g, "-")}`;
    seen.add(id);
    const rank = (PROBE_RANK as readonly string[]).indexOf(String(p.risk_class));
    if (phase !== lastPhase || rank < lastRank) {
      block = phase === lastPhase ? block + 1 : 1;
      lastPhase = phase;
    }
    lastRank = rank;
    return { ...p, id, step, launch: phase === "L1" ? `L1.${block}` : phase };
  });
}

export function buildQueue(seq: Entry[], draws: readonly Draw[]): Record<string, unknown> {
  return {
    $comment:
      "Generated by `scripts/live/p4-8.ts --emit-queue` from the walkers' step tables, P4-5's netcalls and the blind draws (docs/v2/sessions/queues/P4-8-draws.json), in P4-8 run order; tests/live-harness/p4-8.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the one launch (L1.n). `step` is the walker's own step id (a blind step is its draw id).",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    draws: DRAWS_REL,
    plan_refs: [
      "PLAN 4.6 (the blind exploration)",
      "docs/v2/design/phase4-live-census.md 3 (the P4-8 row)",
      "DEC-054",
      "DEC-055",
      "PLAN 5.3",
      "PLAN 5.4",
    ],
    launches: launchCount(seq),
    max_relaunches: MAX_RELAUNCHES,
    launch_packs: PACKS,
    launch_args: launchAction().args,
    launch_args_note: `pre-flight builds the real arguments; ${SAA} on the owner's standing go (DEC-053)`,
    invocations: runEntries(seq).map((e) => ({
      id: e.id,
      script:
        e.kind === "walker"
          ? WALKERS.L10
          : e.kind === "blind"
            ? BLIND_SCRIPT
            : e.kind === "net"
              ? NETCALL
              : P41_SCRIPT,
      worst_case_ms: entryWorstCaseMs(e, draws),
    })),
    probes: queueProbes(seq, draws),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "entry",
  "id",
  "sandbox",
  "sitting-dir",
  "only-step",
  "draws",
  "batch",
  "batch-state",
  "from",
];

export function outline(seq: Entry[], draws: readonly Draw[]): string[] {
  const n = draws.length;
  const dialogs = draws.filter((d) => d.kind === "dialog").length;
  const lines = [
    `P4-8: ${launchCount(seq)} launch (up to ${MAX_RELAUNCHES} relaunches); one lane; ${SAA} on the owner's standing go; ${n} blind draw(s), ${dialogs} owner-opened dialog(s); the world is never saved; the entity is ${ENTITY_NAME}`,
  ];
  for (const e of seq) {
    if (e.kind === "hand") {
      lines.push(
        `  ${e.id} [${e.phase}] HAND${e.launches ? " (LAUNCH)" : ""}${e.handoff ? " (HANDOFF)" : ""}: ${e.text}${e.ownerHand ? `; owner: ${e.ownerHand}` : ""}`,
      );
      continue;
    }
    const r = composeArgs(
      e.id,
      { laneId: "<lane>", really: true, sandbox: "<sandbox>", sittingDir: "<sitting>" },
      seq,
      draws,
    );
    const cmd = "refusal" in r ? `BLOCKED: ${r.refusal}` : commandLine(r.script, r.argv);
    const what =
      e.kind === "blind"
        ? `${e.draw.kind} ${(e.draw.open.menuPath ?? e.draw.open.target ?? [e.draw.open.dialog ?? ""]).join(" > ")}${e.draw.kind === "dialog" ? "; owner: open it, Cancel at the HANDOFF" : ""}`
        : "answers" in e
          ? e.answers
          : "";
    lines.push(
      `  ${e.id} [${e.phase}] worst case ${Math.round(entryWorstCaseMs(e, draws) / 1000)} s; ${what}`,
      `      ${cmd}`,
    );
  }
  return lines;
}

export interface MainOverrides {
  spawnChild?: (script: string, argv: string[]) => Promise<number>;
  log?: (line: string) => void;
  /** plant and rollback: P4-1's offline subcommands (tests pass a fake). */
  offline?: (argv: string[]) => Promise<number>;
}

const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function defaultSpawn(script: string, argv: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      ["--import", TSX_IMPORT, join(REPO_ROOT, script), ...argv],
      { cwd: REPO_ROOT, stdio: "inherit" },
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
  if (argv.some((a) => /scriptauthorizeall|script-authorize-all/i.test(a))) {
    log(`refused: ${SAA} is pre-flight's (h-launch), never a p4-8 argument`);
    return 2;
  }
  const really = args.flags.has("really");
  const sub = args.positional[0];
  if (sub === "plant" || sub === "rollback")
    return (over.offline ?? ((a: string[]) => p41Main(a)))(argv);
  if (sub) {
    log(`unknown subcommand ${sub}`);
    return 2;
  }
  let draws: Draw[];
  try {
    draws = loadDraws(o.draws ? resolve(o.draws) : DEFAULT_DRAWS);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const seq = buildSequence(draws);
  if (o.batch) {
    if (o.entry) {
      log("refused: --batch excludes --entry");
      return 2;
    }
    const b = composeBatch(
      { module: o.batch, state: o["batch-state"] ?? "none", from: o.from ?? null },
      {
        laneId: o.id ?? "",
        really,
        sandbox: o.sandbox ?? null,
        sittingDir: o["sitting-dir"] ?? null,
        ...(o.draws ? { drawsPath: o.draws } : {}),
      },
      draws,
    );
    if ("refusal" in b) {
      log(`refused: ${b.refusal}`);
      return 1;
    }
    const phb = defaultPlaceholderContext({ v2: REPO_ROOT, ...(o.sandbox ? { sandbox: o.sandbox } : {}) });
    log(
      toPlaceholders(
        `P4-8 batch ${o.batch} ${o["batch-state"] ?? "none"}: ${b.ids.length} draw(s) ${b.ids[0]}..${b.ids[b.ids.length - 1]}: ${commandLine(b.script, b.argv)}`,
        phb,
      ),
    );
    if (args.flags.has("print")) return 0;
    return (over.spawnChild ?? defaultSpawn)(b.script, b.argv);
  }
  if (!o.entry) {
    for (const l of outline(seq, draws)) log(l);
    const checks = checkEntries(seq, draws);
    for (const l of checks.lines) log(l);
    log(checks.ok ? "PASS (every entry under its own script)" : "FAIL");
    const plan = buildPlan(seq, draws);
    const queue = buildQueue(seq, draws);
    let queueOk = true;
    try {
      log(`queue: ${validateQueue(queue, false).length} probes, valid (validateQueue)`);
    } catch (e) {
      queueOk = false;
      log(`queue refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf-8");
    };
    if (o.out) write(o.out, JSON.stringify(plan, null, 2) + "\n");
    if (o.outline) write(o.outline, outline(seq, draws).join("\n") + "\n");
    if (o["emit-queue"]) write(o["emit-queue"], JSON.stringify(queue, null, 2) + "\n");
    return checks.ok && queueOk ? 0 : 1;
  }
  const r = composeArgs(
    o.entry,
    {
      laneId: o.id ?? "",
      really,
      sandbox: o.sandbox ?? null,
      sittingDir: o["sitting-dir"] ?? null,
      onlyStep: o["only-step"] ?? null,
      ...(o.draws ? { drawsPath: o.draws } : {}),
    },
    seq,
    draws,
  );
  if ("refusal" in r) {
    log(`refused: ${r.refusal}`);
    return 1;
  }
  const ph = defaultPlaceholderContext({
    v2: REPO_ROOT,
    ...(o.sandbox ? { sandbox: o.sandbox } : {}),
  });
  log(toPlaceholders(`P4-8 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
