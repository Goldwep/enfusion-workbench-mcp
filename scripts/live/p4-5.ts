/**
 * Sitting P4-5, the World Editor's entity-selected state and play mode, hand-free (design
 * docs/v2/design/phase4-live-census.md §3 state matrix: edit/entity and play; DEC-053, DEC-054).
 * A THIN orchestrator in `p4-1.ts`'s shape: every live step is a census walker's step run through
 * that walker's own CLI, or one raw NET call through `scripts/live/netcall.ts`. The world route
 * (w-01..w-04), the plant and the rollback are P4-1's, reused as they are (`plant` and `rollback`
 * here delegate to `p4-1.ts`'s offline subcommands under `_throwaway/P4/`).
 *
 * What P4-1 did by the owner's hand, P4-5 does by NET calls inside the throwaway world only:
 *
 *   e-00  EMCP_WB_CreateEntity: ONE static vanilla rock (no script side effects) at the origin,
 *         layer 0 ("default", the tiny world's only layer, DEC-054), named EMCP_P4_Rock
 *   e-01  EMCP_WB_SelectEntity select EMCP_P4_Rock (the handler reads the selection back)
 *   e-02  EMCP_WB_SelectEntity getSelected (read-only; selectedCount 1); main also reads
 *         "Selected: 1" in the Hierarchy of e-03's L01 walk (or `wb_gui find`)
 *   edit/entity  L01, L03, L02, L06 (the Object Properties grid's first real rows), L05 as a hand
 *         block (a real right-click by main's computer use, read --passive; DEC-091 ruling 2)
 *   p-01  EMCP_WB_EditorControl play (SwitchToGameMode(false, false): play in the viewport)
 *   p-02  ECEN_Probe info: fact isGameMode "1" is the readable play signal (the switch is void;
 *         GetState's mode stays "edit" while the world plays in the viewport, P4-5 2026-10-12)
 *   play  L15 `--state mode=play` (diag walk and diagReads), L01 `--state mode=play,selection=none`
 *   p-05  EMCP_WB_EditorControl stop; p-06 ECEN_Probe info isGameMode "0"
 *   close WM_CLOSE: the unsaved world prompts to save changes: a HANDOFF the main session answers
 *         as the owner's hand, Don't Save; then the full post-flight and the rollback.
 *
 * The world is never saved. DRY RUN BY DEFAULT, as p4-1.ts: prints the outline, checks every
 * entry's plan under its own script, validates the P4-5 queue. `--entry <id> [--really]` runs one.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-5.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-5.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir> [--only-step <step>] [--really]
 *   npx --no tsx scripts/live/p4-5.ts plant|rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: as p4-1.ts.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildWalkerQueue,
  parseState,
  walkerPlan,
  type ObservedState,
  type WalkerStep,
} from "../census/live/common.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import {
  FLAT_NAME,
  P4_ROOT,
  PLANT_CONF,
  PLANT_FILE,
  SAA,
  TINY_NAME,
  TINY_WORLD,
  VANILLA_CONF,
  WALKERS,
  WORLDS_DIR,
  L05_HAND,
  defFor,
  main as p41Main,
  type WalkerKey,
} from "./p4-1.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P4-5";
export const SCRIPT_PATH = "scripts/live/p4-5.ts";
export const P41_SCRIPT = "scripts/live/p4-1.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-5.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-5-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const NETCALL = "scripts/live/netcall.ts";
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const SCRATCH_INI = "<sitting>/p4-scratch.ini";
export const PACKS = ["mod-dev/probe", "mod-dev/probe-mut"] as const;
export const MAX_RELAUNCHES = 3;

/**
 * The one entity: a static vanilla rock. In 1.8.0.13's paks (game_read, 2026-10-12):
 * SCR_IndestructibleEnvironmentalEntity with a MeshObject and a Static RigidBody only, parent
 * `{B94DDC61F0B7F9D7}Prefabs/Rocks/Rock_Base.et`; its GUID read from the DefaultLibrary child
 * `PrefabLibrary/DefaultLibrary/Rocks/Granite/GraniteRock_01/GraniteRock_01.et` that inherits it.
 */
export const ROCK_PREFAB = "{9633134198F3AB1A}Prefabs/Rocks/Granite/GraniteRock_01.et";
export const ENTITY_NAME = "EMCP_P4_Rock";

export const STATES = {
  "edit-none": "mode=edit,selection=none",
  "edit-entity": "mode=edit,selection=entity",
  play: "mode=play",
  "play-none": "mode=play,selection=none",
} as const;
export type StateTag = keyof typeof STATES;
export function stateOf(tag: StateTag): ObservedState {
  const s = parseState(STATES[tag]);
  if (typeof s === "string") throw new Error(s);
  return s;
}

// ── The sequence ─────────────────────────────────────────────────────────────

export type Phase = "offline-0" | "L1" | "close";

export interface WalkerEntry {
  kind: "walker";
  id: string;
  phase: "L1";
  walker: WalkerKey;
  module: string;
  state: StateTag;
  /** The run folder under the sitting folder (a step never runs twice in one folder). */
  runSub: string;
  sel: "all" | { only: string } | { fromPrefix: string };
  flags?: string[];
  answers: string;
  ownerHand?: string;
}

export interface NetEntry {
  kind: "net";
  id: string;
  phase: "L1";
  apiFunc: string;
  params: Record<string, unknown>;
  timeoutMs: number;
  risk: "read-only" | "reversible" | "mutating";
  expected: string;
  kill: string;
  sideEffects: string[];
  rollback: string;
  answers: string;
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
  /** The entry ends on a HANDOFF the main session answers as the owner's hand. */
  handoff?: boolean;
  text: string;
  command?: string;
  ownerHand?: string;
}

export type Entry = WalkerEntry | NetEntry | SelfEntry | HandEntry;
export type RunEntry = WalkerEntry | NetEntry | SelfEntry;

const w = (
  id: string,
  walker: WalkerKey,
  state: StateTag,
  runSub: string,
  answers: string,
  extra: Partial<WalkerEntry> = {},
): WalkerEntry => ({
  kind: "walker",
  id,
  phase: "L1",
  walker,
  module: "WorldEditor",
  state,
  runSub,
  sel: "all",
  answers,
  ...extra,
});

const net = (e: Omit<NetEntry, "kind" | "phase">): NetEntry => ({
  kind: "net",
  phase: "L1",
  ...e,
});

const HEARTBEAT = "npx --no tsx scripts/live/lane.ts heartbeat --id <lane>";

export const LAUNCH_COMMAND =
  `npx --no tsx scripts/live/launch.ts --install-handlers "<sandbox>" ${PACKS.map((p) => `--probe-pack ${p}`).join(" ")} --id <lane> --really; ` +
  `then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P4-5" --id <lane> --queue ${QUEUE_REL} --probe-pack --force-settings "${SCRATCH_INI}" --u12-passed --script-authorize-all --owner-go-script-authorize-all ` +
  "(pass 1 --until 7; before pass 2 build the scratch ini fresh from the pass-1 export as S-D.md 'Before the sitting' item 6; pass 2 --really)";

export const CLOSE_COMMAND =
  "npx --no tsx scripts/live/postflight.ts --id <lane> --registry-before <reg> --sandbox <sandbox> --remove-probe-mut --remove-probe --session-number <NNN> --really; " +
  `npx --no tsx ${SCRIPT_PATH} rollback --sandbox <sandbox> --sitting-dir <sitting> --id <lane> --really`;

const NO_SAVE = `never saved: Don't Save at the close prompt; the rollback removes ${P4_ROOT}/`;

export function buildSequence(): Entry[] {
  return [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      text: "the lease for the one lane (kept to the post-flight); heartbeat during any hand longer than 10 min (the lease orphans after about 15 min, DEC-053)",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-5" --id <lane>',
    },
    {
      kind: "self",
      id: "o-00-plant",
      phase: "offline-0",
      sub: "plant",
      answers: `P4-1's plant (${VANILLA_CONF} at <sandbox>/${PLANT_CONF}); STOP if <sandbox>/${P4_ROOT}/ exists (P4-1's rollback must have run)`,
    },
    {
      kind: "hand",
      id: "h-launch",
      phase: "L1",
      launches: true,
      text: `the launch: handlers and both packs, two-pass pre-flight on the P4-5 queue (session P4-5 lets step 7 accept the mutating pack), the scratch ini, ${SAA} on the owner's standing go (DEC-053)`,
      command: LAUNCH_COMMAND,
      ownerHand: "the launch go in chat",
    },
    net({
      id: "w-01-worlds-create",
      apiFunc: "ECEN_ProbeMut",
      params: {
        action: "createSandboxWorlds",
        target: `$${SANDBOX_NAME}:${WORLDS_DIR}`,
        tinyName: TINY_NAME,
        terrainName: FLAT_NAME,
        terrainEntities: [],
      },
      timeoutMs: 120_000,
      risk: "mutating",
      expected: `status ok, both worlds Registered "true"; files new only under ${WORLDS_DIR}/`,
      kill: "refused, error, a prompt (the flag missing) or a file new outside the folder: STOP, nothing retried",
      sideEffects: [`world files and .meta under <sandbox>/${WORLDS_DIR}/`],
      rollback: `removed with ${P4_ROOT}/ by \`p4-5.ts rollback\``,
      answers: "P4-1 w-01 (DEC-045 se-03 route)",
    }),
    w(
      "w-02-world-editor",
      "L10",
      "edit-none",
      "world",
      "the World Editor module opened by L10's step (P4-1 w-02)",
      { module: "Shared", sel: { only: "p4-l10-07-WorldEditor" } },
    ),
    net({
      id: "w-03-world-open",
      apiFunc: "EMCP_WB_EditorControl",
      params: { action: "openResource", path: TINY_WORLD },
      timeoutMs: 600_000,
      risk: "mutating",
      expected: `"Opened resource: ${TINY_WORLD}"`,
      kill: "no answer within the budget: STOP; a dialog: HANDOFF (closed, never Save)",
      sideEffects: ["the tiny world loads in the World Editor"],
      rollback: "the post-flight close",
      answers: "P4-1 w-03",
    }),
    net({
      id: "w-04-world-check",
      apiFunc: "ECEN_Probe",
      params: { action: "layerRead", subScene: -1, page: 0 },
      timeoutMs: 30_000,
      risk: "read-only",
      expected: `worldPath names ${TINY_WORLD}; one sub-scene, one layer "default" (DEC-054); main checks the title names ${TINY_NAME}`,
      kill: "another world named: STOP before the create",
      sideEffects: [],
      rollback: "none",
      answers: "P4-1 w-04",
    }),
    // ── edit/entity, hand-free ──
    net({
      id: "e-00-entity-create",
      apiFunc: "EMCP_WB_CreateEntity",
      params: { prefab: ROCK_PREFAB, position: "0 0 0", name: ENTITY_NAME, layerID: 0 },
      timeoutMs: 30_000,
      risk: "mutating",
      expected: `status ok, entityName ${ENTITY_NAME}, entityClass SCR_IndestructibleEnvironmentalEntity, position 0 0 0, no warning`,
      kill: "an error, a warning, another name, or the title naming another world: STOP, nothing retried",
      sideEffects: [`one entity ${ENTITY_NAME} in the unsaved tiny world, layer default`],
      rollback: NO_SAVE,
      answers:
        "design 3 state matrix: edit/entity needs one entity (DEC-054: the tiny world has only a layer)",
    }),
    net({
      id: "e-01-entity-select",
      apiFunc: "EMCP_WB_SelectEntity",
      params: { action: "select", name: ENTITY_NAME },
      timeoutMs: 30_000,
      risk: "reversible",
      expected: `status ok, "Entity selected: ${ENTITY_NAME}", selectedCount 1 (the handler reads the selection back)`,
      kill: "status error: STOP",
      sideEffects: ["the World Editor selection (not saved with the world)"],
      rollback: "the selection ends with the close",
      answers: "the edit/entity state without the owner's hand",
    }),
    net({
      id: "e-02-selection-check",
      apiFunc: "EMCP_WB_SelectEntity",
      params: { action: "getSelected" },
      timeoutMs: 30_000,
      risk: "read-only",
      expected: `selectedCount 1, the one name ${ENTITY_NAME}; main also reads "Selected: 1" in the Hierarchy of e-03's walk (or wb_gui find)`,
      kill: "a count other than 1: STOP before any walk",
      sideEffects: [],
      rollback: "none",
      answers: "the state oracle for edit/entity",
    }),
    w(
      "e-03-l01",
      "L01",
      "edit-entity",
      "edit-entity",
      "L01 snapshot with the rock selected; its walk carries the Hierarchy's Selected: 1",
    ),
    w("e-04-l03", "L03", "edit-entity", "edit-entity", "L03 chrome with an entity selected", {
      ownerHand: "Esc on a popup left open (HANDOFF)",
    }),
    w(
      "e-05-l02",
      "L02",
      "edit-entity",
      "edit-entity",
      "L02 the World Editor titles with an entity selected",
      { ownerHand: "front the Workbench; Esc on a HANDOFF" },
    ),
    w(
      "e-06-l06",
      "L06",
      "edit-entity",
      "edit-entity",
      "L06: the Object Properties grid's first real rows (the rock's); D16c editors deferred",
    ),
    {
      kind: "hand",
      id: "h-l05-targets",
      phase: "L1",
      text: `main runs \`L05-context.ts --propose <e-03 L01 walk> --module WorldEditor\`, copies the ${ENTITY_NAME} Hierarchy row and the viewport (@WorldRenderWindowQt.1) into policy live_lane.uia_context.targets and re-emits this queue; without them e-07 walks the listed targets only; heartbeat the lease`,
      command: HEARTBEAT,
    },
    // DEC-091 ruling 2: L05 is a hand block; ShowContextMenu is not planned (DEC-090).
    w(
      "e-07-l05-hand",
      "L05",
      "edit-entity",
      "edit-entity",
      "L05 the entity's Hierarchy row and the viewport in edit/entity, each opened by hand",
      { sel: { fromPrefix: "p4-l05-hand" }, flags: ["--passive"], ownerHand: L05_HAND },
    ),
    // ── play ──
    net({
      id: "p-01-play",
      apiFunc: "EMCP_WB_EditorControl",
      params: { action: "play", debugMode: false, fullScreen: false },
      timeoutMs: 60_000,
      risk: "reversible",
      expected: '"Switched to game mode" (SwitchToGameMode is void: p-02 reads the state)',
      kill: "an error or a new top-level window: STOP; a dialog: HANDOFF",
      sideEffects: ["the World Editor plays the tiny world in the viewport (windowed, not debug)"],
      rollback: "p-05 stop",
      answers: "design 3 state matrix: play",
    }),
    net({
      id: "p-02-play-check",
      apiFunc: "ECEN_Probe",
      params: { action: "info", page: 0 },
      timeoutMs: 30_000,
      risk: "read-only",
      expected:
        'fact isGameMode "1" (WorldEditorAPI.IsGameMode; the API stays available while the world plays in the viewport, so GetState mode "edit" is no signal: P4-5 2026-10-12); while it says "0" main re-reads after 10 s, three reads at most',
      kill: 'still "0" after the third read, or no answer: p-05 stop, then STOP',
      sideEffects: [],
      rollback: "none",
      answers: "the readable play signal",
    }),
    w(
      "p-03-l15",
      "L15",
      "play",
      "play",
      "L15 play: the diag walk and the diagReads with the hazard list (L15's play block)",
    ),
    w("p-04-l01", "L01", "play-none", "play", "L01 snapshot of the World Editor in play"),
    net({
      id: "p-05-stop",
      apiFunc: "EMCP_WB_EditorControl",
      params: { action: "stop" },
      timeoutMs: 60_000,
      risk: "reversible",
      expected: '"Switched to edit mode"',
      kill: "an error: HANDOFF (the owner's hand stops play)",
      sideEffects: ["the World Editor back in edit mode"],
      rollback: "none",
      answers: "play ends before the close",
    }),
    net({
      id: "p-06-edit-check",
      apiFunc: "ECEN_Probe",
      params: { action: "info", page: 0 },
      timeoutMs: 30_000,
      risk: "read-only",
      expected: 'fact isGameMode "0"',
      kill: 'not "0" after three reads: HANDOFF',
      sideEffects: [],
      rollback: "none",
      answers: "edit mode restored",
    }),
    {
      kind: "hand",
      id: "h-close",
      phase: "close",
      handoff: true,
      text: `the full post-flight: one WM_CLOSE to the recorded main window (DEC-053); the unsaved tiny world prompts to save changes: a HANDOFF the main session answers as the owner's hand, Don't Save (never Save); then net-zero diff, registry comparison, both packs removed, lease ended; then rollback of ${P4_ROOT}/`,
      command: CLOSE_COMMAND,
      ownerHand: "Don't Save on the save-changes prompt",
    },
  ];
}

export const runEntries = (seq: Entry[] = buildSequence()): RunEntry[] =>
  seq.filter((e): e is RunEntry => e.kind !== "hand");
export const launchCount = (seq: Entry[] = buildSequence()): number =>
  seq.filter((e) => e.kind === "hand" && e.launches).length;

// ── Steps of an entry ────────────────────────────────────────────────────────

export function walkerSel(e: WalkerEntry): {
  module: string;
  state: ObservedState;
  allowOwned: boolean;
} {
  return {
    module: e.module,
    state: stateOf(e.state),
    allowOwned: (e.flags ?? []).includes("--allow-owned"),
  };
}

export function entrySteps(e: WalkerEntry): WalkerStep[] {
  const all = defFor(e).steps(walkerSel(e));
  if (e.sel === "all") return all;
  if ("only" in e.sel) {
    const id = e.sel.only;
    return all.filter((s) => s.id === id);
  }
  const p = e.sel.fromPrefix;
  return all.filter((s) => s.id.startsWith(p));
}

/** Why an entry cannot run today, or null. */
export function blockedReason(e: RunEntry): string | null {
  if (e.kind !== "walker" || entrySteps(e).length) return null;
  if (e.walker === "L05")
    return "L05 plans nothing for this state: live_lane.uia_context.targets lists no further target (h-l05-targets)";
  return `${e.walker} plans no step for ${STATES[e.state]}`;
}

export function entryWorstCaseMs(e: RunEntry): number {
  if (e.kind === "net") return e.timeoutMs;
  if (e.kind === "self") return 30_000;
  return entrySteps(e).reduce((n, s) => n + s.timeout_ms, 0);
}

// ── Composing one invocation ─────────────────────────────────────────────────

export interface ComposeInput {
  laneId: string;
  really: boolean;
  sandbox?: string | null;
  sittingDir?: string | null;
  onlyStep?: string | null;
}

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
  const blocked = blockedReason(e);
  if (blocked) return { refusal: `${entryId} is blocked: ${blocked}` };
  if (!input.sittingDir)
    return { refusal: "a walker entry runs in <sitting>/<run folder>: pass --sitting-dir <dir>" };
  const steps = entrySteps(e);
  const argv: string[] = [];
  if (input.really) argv.push("--really");
  argv.push(
    ...lane,
    "--sandbox",
    input.sandbox,
    "--run-dir",
    join(input.sittingDir, e.runSub),
    "--module",
    e.module,
    "--state",
    STATES[e.state],
    "--session",
    SESSION,
  );
  if (input.onlyStep) {
    if (!steps.some((s) => s.id === input.onlyStep))
      return { refusal: `${input.onlyStep} is not a step of ${entryId}` };
    argv.push("--only", input.onlyStep);
  } else if (steps.length === 1 && e.sel !== "all") argv.push("--only", steps[0].id);
  else argv.push("--from", steps[0].id);
  argv.push(...(e.flags ?? []));
  return { argv, script: WALKERS[e.walker] };
}

/** A command line as printed (JSON params single-quoted). */
export function commandLine(script: string, argv: string[]): string {
  return `npx --no tsx ${script} ${argv.map((a) => (/[\s{"]/.test(a) ? `'${a}'` : a)).join(" ")}`;
}

// ── The combined plan and the queue ──────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    step: "p4-5-launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI, "-scriptAuthorizeAll"],
    ownerGo: "scriptAuthorizeAll",
    note: `pre-flight step 8 with ${QUEUE_REL}; packs ${PACKS.join(", ")}; ${SAA} on the owner's standing go (DEC-053 ruling 2)`,
  } as PlanAction;
}

/** The plan of one entry and the script its exceptions are scoped to. */
export function entryPlan(e: RunEntry): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: P41_SCRIPT, plan: [] };
  if (e.kind === "net")
    return {
      script: NETCALL,
      plan: [{ kind: "net-call", step: e.id, target: e.apiFunc, params: e.params } as PlanAction],
    };
  return { script: WALKERS[e.walker], plan: walkerPlan(entrySteps(e), walkerSel(e)) };
}

export function buildPlan(seq: Entry[] = buildSequence()): PlanAction[] {
  const out: PlanAction[] = [];
  for (const e of seq) {
    if (e.kind === "hand") {
      if (e.launches) out.push(launchAction());
      continue;
    }
    out.push(...entryPlan(e).plan);
  }
  return out;
}

/** checkPlan per entry, under the script its exceptions name. */
export function checkEntries(seq: Entry[] = buildSequence()): { ok: boolean; lines: string[] } {
  const policy = loadPolicy();
  const lines: string[] = [];
  let ok = true;
  const launch = checkPlan([launchAction()], policy, { script: SCRIPT_PATH });
  if (!launch.ok) ok = false;
  lines.push(`h-launch: ${launch.ok ? "PASS" : formatResult(launch)}`);
  for (const e of runEntries(seq)) {
    const { script, plan } = entryPlan(e);
    const r = checkPlan(plan, policy, { script });
    if (!r.ok) ok = false;
    lines.push(
      `${e.id}: ${r.ok ? "PASS" : formatResult(r)} (${plan.length} actions${r.exceptionsUsed.length ? `, exceptions ${r.exceptionsUsed.map((x) => x.id).join(", ")}` : ""})`,
    );
  }
  return { ok, lines };
}

export const PROBE_RANK = ["read-only", "reversible", "mutating"] as const;

/** The queue probes of the sitting, in run order (P4-1's block rule). */
export function queueProbes(seq: Entry[] = buildSequence()): Array<Record<string, unknown>> {
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
        rollback: `\`p4-5.ts rollback\` lists and removes <sandbox>/${P4_ROOT}/`,
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
      const q = buildWalkerQueue(defFor(e), entrySteps(e), SESSION).probes as Array<
        Record<string, unknown>
      >;
      for (const p of q)
        raw.push({
          ...p,
          phase: e.phase,
          entry: e.id,
          script: WALKERS[e.walker],
          module: e.module,
          state: STATES[e.state],
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

export function buildQueue(seq: Entry[] = buildSequence()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `scripts/live/p4-5.ts --emit-queue` from the walkers' step tables and the sitting's netcalls, in P4-5 run order; tests/live-harness/p4-5.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the one launch (L1.n). `step` is the walker's own step id; `id` adds @<state> where a step repeats.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase4-live-census.md 3 (state matrix: edit/entity, play)",
      "DEC-053",
      "DEC-054",
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
      script: e.kind === "walker" ? WALKERS[e.walker] : e.kind === "net" ? NETCALL : P41_SCRIPT,
      worst_case_ms: entryWorstCaseMs(e),
      ...(blockedReason(e) ? { blocked: blockedReason(e) } : {}),
    })),
    probes: queueProbes(seq),
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
];

export function outline(seq: Entry[] = buildSequence()): string[] {
  const lines = [
    `P4-5: ${launchCount(seq)} launch (up to ${MAX_RELAUNCHES} relaunches); one lane; ${SAA} on the owner's standing go; the world is never saved`,
  ];
  for (const e of seq) {
    if (e.kind === "hand") {
      lines.push(
        `  ${e.id} [${e.phase}] HAND${e.launches ? " (LAUNCH)" : ""}${e.handoff ? " (HANDOFF)" : ""}: ${e.text}${e.ownerHand ? `; owner: ${e.ownerHand}` : ""}`,
      );
      continue;
    }
    const r = composeArgs(e.id, {
      laneId: "<lane>",
      really: true,
      sandbox: "<sandbox>",
      sittingDir: "<sitting>",
    });
    const cmd = "refusal" in r ? `BLOCKED: ${r.refusal}` : commandLine(r.script, r.argv);
    lines.push(
      `  ${e.id} [${e.phase}] worst case ${Math.round(entryWorstCaseMs(e) / 1000)} s${e.kind === "walker" && e.ownerHand ? `; owner: ${e.ownerHand}` : ""}`,
      `      ${cmd}`,
      `      answers: ${e.answers}`,
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
    log(`refused: ${SAA} is pre-flight's (h-launch), never a p4-5 argument`);
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
  if (!o.entry) {
    for (const l of outline()) log(l);
    const checks = checkEntries();
    for (const l of checks.lines) log(l);
    log(checks.ok ? "PASS (every entry under its own script)" : "FAIL");
    const plan = buildPlan();
    const queue = buildQueue();
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
    if (o.outline) write(o.outline, outline().join("\n") + "\n");
    if (o["emit-queue"]) write(o["emit-queue"], JSON.stringify(queue, null, 2) + "\n");
    return checks.ok && queueOk ? 0 : 1;
  }
  const r = composeArgs(o.entry, {
    laneId: o.id ?? "",
    really,
    sandbox: o.sandbox ?? null,
    sittingDir: o["sitting-dir"] ?? null,
    onlyStep: o["only-step"] ?? null,
  });
  if ("refusal" in r) {
    log(`refused: ${r.refusal}`);
    return 1;
  }
  const ph = defaultPlaceholderContext({
    v2: REPO_ROOT,
    ...(o.sandbox ? { sandbox: o.sandbox } : {}),
  });
  log(toPlaceholders(`P4-5 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
