/**
 * Sitting P4-1, the World Editor census (design docs/v2/design/phase4-live-census.md §3 and §3.1,
 * the owner rulings of 2026-10-10, DEC-053): a THIN orchestrator in `p3-1.ts`'s shape. Every live
 * step is a step of a census walker (`scripts/census/live/L*.ts`), run through that walker's own CLI
 * (its gate, window rule, handoffs, records and evidence) or one raw NET call through
 * `scripts/live/netcall.ts`. What this file adds is the ORDER, the flags each invocation gets, the
 * per-state run folders, the combined dry-run plan, the P4-1 queue, and the two offline
 * subcommands train2's tiny-world route needs under `_throwaway/P4/` (`plant`, `rollback`).
 *
 * One lane, owner present, ONE launch (plan 5.4: up to three relaunches) on the scratch profile
 * with both packs and `-scriptAuthorizeAll` on the owner's standing go (DEC-053 ruling 2):
 *
 *   offline-0  plant the U16 known-good copy under <sandbox>/_throwaway/P4/u16/ (D16a)
 *   L1 world   createSandboxWorlds into _throwaway/P4/worlds/ (netcall, as P3-3 g2-07); the World
 *              Editor opened by L10's module step; openResource of the tiny world and a layerRead
 *              (netcall, as g2-08). train2's step bodies are bound to _throwaway/P33/ and its own
 *              runner, so they are composed here as raw calls, not imported.
 *   edit/none  L01, L03, L02, L06, L09, L15 (edit)
 *   once       L10 (all modules), L02 on the Resource Manager (L17's gate input), L11, then L04
 *              (D14 Options first, the six list 1 dialogs as one owner-go block), L05 (a hand
 *              block: each target right-clicked by hand and read --passive, DEC-091), L07, L17
 *   edit/entity the OWNER selects one entity of the tiny world by hand (no allow-listed read-only
 *              selection route exists: EMCP_WB_SelectEntity is on no policy list), then L01, L03,
 *              L02, L05, L06 again (design 3.1 step 5)
 *   close      the full post-flight: one WM_CLOSE to the recorded main window (DEC-053: the harness
 *              closes), both packs removed, registry compared, lease ended; `rollback` of
 *              _throwaway/P4/.
 *
 * DRY RUN BY DEFAULT: prints the sequence and each entry's worst case; builds the combined action
 * plan (each walker's own plan for the entry's steps, the netcalls, the launch) and checks every
 * entry's part with dry-run.ts checkPlan under that entry's script; validates the P4-1 queue with
 * preflight.ts validateQueue. `--out` writes the plan, `--outline` the outline, `--emit-queue` the
 * queue. A real invocation runs ONE entry: `--entry <id> [--really]` spawns the composed command.
 * Hand entries are printed, never run.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-1.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-1.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir in the artifacts folder> [--only-step <step>] [--really]
 *   npx --no tsx scripts/live/p4-1.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx scripts/live/p4-1.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: the child's exit code for a real entry (walkers: 0 done, 1 refused, 2 usage, 3 stopped,
 *       4 aborted, 5 handoff); the dry run 0 passed, 1 plan or queue check failed, 2 usage.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../../src/config.js";
import {
  buildWalkerQueue,
  parseState,
  walkerPlan,
  type ObservedState,
  type WalkerDef,
  type WalkerStep,
} from "../census/live/common.js";
import { def as l01 } from "../census/live/L01-snapshot.js";
import { l02Def } from "../census/live/L02-menus.js";
import { l03Def } from "../census/live/L03-chrome.js";
import { l04Def } from "../census/live/L04-dialogs.js";
import { l05Def } from "../census/live/L05-context.js";
import { makeDef as l06Make, realKernels as l06Kernels } from "../census/live/L06-grids.js";
import { def as l07 } from "../census/live/L07-screens.js";
import { l09Def } from "../census/live/L09-actions.js";
import { def as l10 } from "../census/live/L10-modules.js";
import { def as l11 } from "../census/live/L11-plugins.js";
import { makeDef as l15Make, realKernel as l15Kernel } from "../census/live/L15-diag.js";
import { def as l17 } from "../census/live/L17-qt.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { Lane } from "./lane.js";
import { WORKBENCH_EXE } from "./launch.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";
import { firstScalar } from "./s-e-train1b.js";
import { defaultExec, processesByImage } from "./win.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P4-1";
export const SCRIPT_PATH = "scripts/live/p4-1.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-1.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-1-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const NETCALL = "scripts/live/netcall.ts";
/** The one switch this sitting launches with, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";

export const THROWAWAY = "_throwaway";
export const P4_ROOT = `${THROWAWAY}/P4`;
/** train2's U16 known-good source (tests/live/train2.live.ts VANILLA_CONF; a test keeps them equal). */
export const VANILLA_CONF = "configs/inputCommon.conf";
export const PLANT_CONF = `${P4_ROOT}/u16/inputCommon.conf`;
export const PLANT_FILE = "plant-p4.json";
export const WORLDS_DIR = `${P4_ROOT}/worlds`;
export const TINY_NAME = "EMCP_P4_Tiny";
export const FLAT_NAME = "EMCP_P4_Flat";
export const TINY_WORLD = `${WORLDS_DIR}/${TINY_NAME}.ent`;
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const SCRATCH_INI = "<sitting>/p4-scratch.ini";
export const PACKS = ["mod-dev/probe", "mod-dev/probe-mut"] as const;
/** Plan 5.4: one launch, up to three relaunches (a relaunch takes new run folders). */
export const MAX_RELAUNCHES = 3;

export const WALKERS = {
  L01: "scripts/census/live/L01-snapshot.ts",
  L02: "scripts/census/live/L02-menus.ts",
  L03: "scripts/census/live/L03-chrome.ts",
  L04: "scripts/census/live/L04-dialogs.ts",
  L05: "scripts/census/live/L05-context.ts",
  L06: "scripts/census/live/L06-grids.ts",
  L07: "scripts/census/live/L07-screens.ts",
  L09: "scripts/census/live/L09-actions.ts",
  L10: "scripts/census/live/L10-modules.ts",
  L11: "scripts/census/live/L11-plugins.ts",
  L15: "scripts/census/live/L15-diag.ts",
  L17: "scripts/census/live/L17-qt.ts",
} as const;
export type WalkerKey = keyof typeof WALKERS;

const noKernel = (): never => {
  throw new Error("p4-1 builds plans and queues only; the walker's own CLI runs its kernel");
};
let defs: Record<WalkerKey, WalkerDef> | null = null;
/** The walkers' definitions (plans and queue fields only; no kernel is called). */
export function walkerDefs(): Record<WalkerKey, WalkerDef> {
  defs ??= {
    L01: l01,
    L02: l02Def(),
    L03: l03Def(),
    L04: l04Def({ policy: loadPolicy(), ownerCloses: false, ownerDone: true, kernel: noKernel }),
    L05: l05Def(),
    L06: l06Make(l06Kernels()),
    L07: l07,
    L09: l09Def(),
    L10: l10,
    L11: l11,
    L15: l15Make(l15Kernel()),
    L17: l17,
  };
  return defs;
}

let passiveL05: WalkerDef | null = null;
/**
 * The definition an entry's steps come from: L05 with `--passive` plans the hand steps (a real
 * right-click by the main session's computer use, read passively), never the ShowContextMenu
 * probe, which is settled negative on 1.9.0.37 (DEC-090, P-L05-ShowContextMenu); DEC-091 ruling 2.
 */
export function defFor(e: { walker: WalkerKey; flags?: string[] }): WalkerDef {
  if (e.walker === "L05" && (e.flags ?? []).includes("--passive"))
    return (passiveL05 ??= l05Def(undefined, undefined, { passive: true }));
  return walkerDefs()[e.walker];
}

/** The owner-hand text of an L05 hand step (DEC-090, DEC-091 ruling 2). */
export const L05_HAND =
  "main's computer use: one real right-click on the target when the step prints OWNER, no menu choice; Esc once after the read (P-L05-hand, DEC-090)";

export const STATES = {
  "edit-none": "mode=edit,selection=none",
  "edit-entity": "mode=edit,selection=entity",
} as const;
export type StateTag = keyof typeof STATES;
export function stateOf(tag: StateTag): ObservedState {
  const s = parseState(STATES[tag]);
  if (typeof s === "string") throw new Error(s);
  return s;
}

// ── The sequence ─────────────────────────────────────────────────────────────

export type Phase = "offline-0" | "L1" | "close";

export type Selection = { only: string } | { from: string };

export interface WalkerEntry {
  kind: "walker";
  id: string;
  phase: "L1";
  walker: WalkerKey;
  module: string;
  state: StateTag;
  /** The run folder under the sitting folder (a step never runs twice in one folder). */
  runSub: string;
  /** The walker's first step id for `--only`/`--from`, or a function of its step list. */
  sel: "all" | { only: string } | { fromPrefix: string } | { onlyPrefix: string };
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

const CREATE_PARAMS = {
  action: "createSandboxWorlds",
  target: `$${SANDBOX_NAME}:${WORLDS_DIR}`,
  tinyName: TINY_NAME,
  terrainName: FLAT_NAME,
  terrainEntities: [],
};

const HEARTBEAT = "npx --no tsx scripts/live/lane.ts heartbeat --id <lane>";

export const LAUNCH_COMMAND =
  `npx --no tsx scripts/live/launch.ts --install-handlers "<sandbox>" ${PACKS.map((p) => `--probe-pack ${p}`).join(" ")} --id <lane> --really; ` +
  `then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P4-1" --id <lane> --queue ${QUEUE_REL} --probe-pack --force-settings "${SCRATCH_INI}" --u12-passed --script-authorize-all --owner-go-script-authorize-all ` +
  "(pass 1 --until 7; before pass 2 build the scratch ini fresh from the pass-1 export as S-D.md 'Before the sitting' item 6; pass 2 --really)";

export const CLOSE_COMMAND =
  "npx --no tsx scripts/live/postflight.ts --id <lane> --registry-before <reg> --sandbox <sandbox> --remove-probe-mut --remove-probe --session-number <NNN> --really; " +
  `npx --no tsx ${SCRIPT_PATH} rollback --sandbox <sandbox> --sitting-dir <sitting> --id <lane> --really`;

export function buildSequence(): Entry[] {
  return [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      text: "the lease for the one lane (kept to the post-flight); heartbeat by hand during any owner hand longer than 10 min (the lease orphans after about 15 min, DEC-053)",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-1" --id <lane>',
    },
    {
      kind: "self",
      id: "o-00-plant",
      phase: "offline-0",
      sub: "plant",
      answers: `D16a: the U16 known-good copy of ${VANILLA_CONF} at <sandbox>/${PLANT_CONF} (train2 p33-o2-plant's pattern); STOP if <sandbox>/${P4_ROOT}/ exists`,
    },
    {
      kind: "hand",
      id: "h-launch",
      phase: "L1",
      launches: true,
      text: `the launch: handlers and both packs installed, two-pass pre-flight on the P4-1 queue (session P4-1 lets step 7 accept the mutating pack), the scratch ini, ${SAA} on the owner's standing go (DEC-053); pre-flight asserts the opened project, the handlers and the build stamp`,
      command: LAUNCH_COMMAND,
      ownerHand: "the launch go in chat",
    },
    {
      kind: "net",
      id: "w-01-worlds-create",
      phase: "L1",
      apiFunc: "ECEN_ProbeMut",
      params: CREATE_PARAMS,
      timeoutMs: 120_000,
      risk: "mutating",
      expected: `status ok, both worlds Registered "true", {GUID}-prefixed names; files new only under ${WORLDS_DIR}/`,
      kill: "refused, error, a prompt (the flag missing) or a file new outside the folder: STOP, nothing retried",
      sideEffects: [`world files and .meta under <sandbox>/${WORLDS_DIR}/`],
      rollback: `removed with ${P4_ROOT}/ by \`p4-1.ts rollback\``,
      answers: "D16a: the tiny world, as P3-3 g2-07 (DEC-045 se-03 route)",
    },
    w(
      "w-02-world-editor",
      "L10",
      "edit-none",
      "world",
      "the World Editor module opened by wb_module open/front/info with the window rule (L10's step; train2 g2-08 used moduleMatrix)",
      { module: "Shared", sel: { only: "p4-l10-07-WorldEditor" } },
    ),
    {
      kind: "net",
      id: "w-03-world-open",
      phase: "L1",
      apiFunc: "EMCP_WB_EditorControl",
      params: { action: "openResource", path: TINY_WORLD },
      timeoutMs: 600_000,
      risk: "mutating",
      expected: `"Opened resource: ${TINY_WORLD}"`,
      kill: "no answer within the budget: STOP; a dialog: HANDOFF (the owner closes it, never Save)",
      sideEffects: ["the tiny world loads in the World Editor (not edited)"],
      rollback: "the post-flight close; the world is unedited",
      answers: "D16a: the tiny world open on the DEC-045 route (g2-08's openResource)",
    },
    {
      kind: "net",
      id: "w-04-world-check",
      phase: "L1",
      apiFunc: "ECEN_Probe",
      params: { action: "layerRead", subScene: -1, page: 0 },
      timeoutMs: 30_000,
      risk: "read-only",
      expected: `worldPath names ${TINY_WORLD}; one sub-scene; main also checks the World Editor title names ${TINY_NAME}`,
      kill: "another world named: STOP before any walk",
      sideEffects: [],
      rollback: "none",
      answers: "design 3.1 step 2: the title and the world path name the tiny world",
    },
    // ── State edit/none ──
    w("n-01-l01", "L01", "edit-none", "edit-none", "L01 snapshot of the World Editor window"),
    w(
      "n-02-l03",
      "L03",
      "edit-none",
      "edit-none",
      "L03 chrome from L01's walk file, plus the Window menu read",
      { ownerHand: "Esc on a popup left open (HANDOFF)" },
    ),
    w("n-03-l02", "L02", "edit-none", "edit-none", "L02 the 9 World Editor titles at depth 1", {
      ownerHand: "front the Workbench before the burst; Esc on a HANDOFF",
    }),
    w(
      "n-04-l06",
      "L06",
      "edit-none",
      "edit-none",
      "L06 grid rows (0 rows expected with nothing selected), the container cross-check, D16c deferred editors",
    ),
    w(
      "n-05-l09",
      "L09",
      "edit-none",
      "edit-none",
      "L09 allow-listed Window toggles with dock-count oracles",
      { ownerHand: "re-show a dock by hand on an observed/fail that says so" },
    ),
    w(
      "n-06-l15",
      "L15",
      "edit-none",
      "edit-none",
      "L15 edit: the diag/debug walk and 201 E14 diagRead reads",
    ),
    // ── Once ──
    w(
      "x-01-l10",
      "L10",
      "edit-none",
      "modules",
      "L10 the module matrix: list, then open/front/info on the nine readable modules",
      { module: "Shared" },
    ),
    w(
      "x-02-l02-rm",
      "L02",
      "edit-none",
      "modules",
      "L02 on the Resource Manager's 8 titles: the Utilities label L17's gate reads",
      { module: "ResourceManager", ownerHand: "front the Resource Manager; Esc on a HANDOFF" },
    ),
    w(
      "x-03-l11",
      "L11",
      "edit-none",
      "modules",
      "L11 describe/getSettings of the three allow-listed plugins (modules opened by x-01)",
    ),
    w(
      "x-04-l04-d14",
      "L04",
      "edit-none",
      "dialogs",
      "D14: Options opened by its allow-listed opener and closed by the scripted Cancel within 5 s (owner ruling 1); the registry half is read at post-flight step 3",
      {
        sel: { only: "p4-l04-d14-options" },
        flags: ["--allow-owned"],
        ownerHand: "the D14 watch: the owner watches Options open and close",
      },
    ),
    {
      kind: "hand",
      id: "h-list1-go",
      phase: "L1",
      text: "the owner's one go for the six list 1 dialogs (owner ruling 2); heartbeat the lease first",
      command: HEARTBEAT,
      ownerHand: "the go in chat",
    },
    w(
      "x-05-l04-list1",
      "L04",
      "edit-none",
      "dialogs",
      "the six Appendix B list 1 dialogs (Create World, Create Terrain, Save World As, Pack Project, Publish, Login): owner opens, L04 reads, owner Cancels",
      {
        sel: { fromPrefix: "p4-l04-l1-" },
        flags: ["--allow-owned", "--owner-done"],
        ownerHand:
          "per dialog: click its opener, then Cancel at the HANDOFF; resume with --only-step <next>",
      },
    ),
    // DEC-091 ruling 2: L05 is a hand block; ShowContextMenu is not planned (DEC-090).
    w(
      "x-06-l05-hand",
      "L05",
      "edit-none",
      "edit-none",
      "L05 the Hierarchy and Resource Browser targets, each opened by a real right-click and read passively",
      {
        sel: { fromPrefix: "p4-l05-hand" },
        flags: ["--passive"],
        ownerHand: `navigate the Resource Browser to _throwaway/P4/; ${L05_HAND}`,
      },
    ),
    w(
      "x-08-l07",
      "L07",
      "edit-none",
      "edit-none",
      "L07 PNGs of the World Editor window and its opaque regions",
      { ownerHand: "keep the Workbench visible and unobscured" },
    ),
    w(
      "x-09-l17",
      "L17",
      "edit-none",
      "qt",
      "L17 gated on x-02's 'Qt Introspection Tool' label and the allow list; else absent",
      // P4-1 2026-10-12: without the module L17 ran on WorldEditor and answered "absent: L17 runs
      // on ResourceManager only"; its gate still reads x-02's file from the modules run folder.
      {
        module: "ResourceManager",
        ownerHand: "close the Qt Introspection Tool window at its HANDOFF",
      },
    ),
    // ── State edit/entity ──
    {
      kind: "hand",
      id: "h-select",
      phase: "L1",
      text: "the owner selects one entity of the tiny world in the Hierarchy by hand (no allow-listed read-only selection route; EMCP_WB_SelectEntity is on no policy list); heartbeat the lease",
      command: HEARTBEAT,
      ownerHand: "click one entity in the Hierarchy; nothing else",
    },
    w("e-01-l01", "L01", "edit-entity", "edit-entity", "L01 snapshot with an entity selected"),
    w("e-02-l03", "L03", "edit-entity", "edit-entity", "L03 chrome with an entity selected", {
      ownerHand: "Esc on a popup left open (HANDOFF)",
    }),
    w("e-03-l02", "L02", "edit-entity", "edit-entity", "L02 the 9 titles with an entity selected", {
      ownerHand: "front the Workbench; Esc on a HANDOFF",
    }),
    w(
      "e-04-l05-hand",
      "L05",
      "edit-entity",
      "edit-entity",
      "L05 targets in edit/entity, opened by hand",
      {
        sel: { fromPrefix: "p4-l05-hand" },
        flags: ["--passive"],
        ownerHand: L05_HAND,
      },
    ),
    w(
      "e-06-l06",
      "L06",
      "edit-entity",
      "edit-entity",
      "L06 the visible Object Properties rows; D16c property-editor rows deferred",
    ),
    {
      kind: "hand",
      id: "h-close",
      phase: "close",
      text: "the full post-flight: one WM_CLOSE to the recorded main window (DEC-053), net-zero diff, registry comparison (D14's registry half), both packs removed, lease ended; then rollback of _throwaway/P4/",
      command: CLOSE_COMMAND,
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

/** The walker steps an entry runs (empty when the walker plans none, as L05 without targets). */
export function entrySteps(e: WalkerEntry): WalkerStep[] {
  const all = defFor(e).steps(walkerSel(e));
  if (e.sel === "all") return all;
  if ("only" in e.sel) {
    const id = e.sel.only;
    return all.filter((s) => s.id === id);
  }
  if ("onlyPrefix" in e.sel) {
    const p = e.sel.onlyPrefix;
    return all.filter((s) => s.id.startsWith(p)).slice(0, 1);
  }
  const p = e.sel.fromPrefix;
  const i = all.findIndex((s) => s.id.startsWith(p));
  return i === -1 ? [] : all.slice(i).filter((s) => s.id.startsWith(p));
}

/** Why an entry cannot run today, or null. */
export function blockedReason(e: RunEntry): string | null {
  if (e.kind !== "walker") return null;
  if (entrySteps(e).length) return null;
  if (e.walker === "L05")
    return "L05 plans nothing: live_lane.uia_context.targets is empty (main runs `L05-context.ts --propose <L01 walk> --module WorldEditor` and lists the targets); its steps are hand steps, read --passive (DEC-091)";
  return `${e.walker} plans no step for this selection`;
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
    return { argv, script: SCRIPT_PATH };
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
    step: "p4-1-launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI, SAA],
    ownerGo: "scriptAuthorizeAll",
    note: `pre-flight step 8 with ${QUEUE_REL}; packs ${PACKS.join(", ")}; ${SAA} on the owner's standing go (DEC-053 ruling 2)`,
  } as PlanAction;
}

/** The plan of one entry and the script its exceptions are scoped to. */
export function entryPlan(e: RunEntry): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: SCRIPT_PATH, plan: [] };
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

/** checkPlan per entry, under the script its exceptions name (L04's D14 Cancel is L04's). */
export function checkEntries(seq: Entry[] = buildSequence()): {
  ok: boolean;
  lines: string[];
} {
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

/** The queue probes of the sitting, in run order. */
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
        rollback: `\`p4-1.ts rollback\` lists and removes <sandbox>/${P4_ROOT}/`,
        risk_class: "mutating",
        phase: e.phase,
        entry: e.id,
        script: SCRIPT_PATH,
      });
    else if (e.kind === "net")
      raw.push({
        id: `p4-${e.id}`,
        title: `${e.apiFunc} ${String(e.params.action)}`,
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
  // Ids repeat across states (L03, L06 carry no state in the id): the second gets `@<state>`.
  const seen = new Set<string>();
  // Blocks: contiguous runs whose risk never drops (validateQueue checks order per `launch`).
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
      "Generated by `scripts/live/p4-1.ts --emit-queue` from the walkers' step tables and the sitting's netcalls, in P4-1 run order; tests/live-harness/p4-1.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the one launch (L1.n): the world must be created and opened (mutating) before the walks it serves, so the read-only, reversible, mutating order holds per block. `step` is the walker's own step id; `id` adds @<state> where a step repeats in edit/entity.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase4-live-census.md 3, 3.1, D14, D16a-c",
      "DEC-053 ruling 2",
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
      script: e.kind === "walker" ? WALKERS[e.walker] : e.kind === "net" ? NETCALL : SCRIPT_PATH,
      worst_case_ms: entryWorstCaseMs(e),
      ...(blockedReason(e) ? { blocked: blockedReason(e) } : {}),
    })),
    probes: queueProbes(seq),
  };
}

// ── Offline subcommands: plant and rollback (train2's pattern under _throwaway/P4/) ──

export interface OfflineIo {
  workbenchPids: () => number[];
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
  listTree: (p: string) => string[];
  readVanilla: (vpath: string) => Buffer;
  readBytes: (p: string) => Buffer;
  writeBytes: (p: string, b: Buffer) => void;
  removeTree: (p: string) => void;
  log: (l: string) => void;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const abs = (sandbox: string, rel: string): string => join(sandbox, ...rel.split("/"));

export function runPlant(
  sandbox: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  if (io.workbenchPids().length) {
    io.log("refused: a Workbench image runs: the plant is offline");
    return 1;
  }
  if (io.exists(abs(sandbox, P4_ROOT))) {
    io.log(`stopped: <sandbox>/${P4_ROOT}/ exists already (not this sitting's)`);
    return 3;
  }
  io.log(`plant: ${VANILLA_CONF} -> <sandbox>/${PLANT_CONF}`);
  if (!really) {
    io.log("dry run: nothing written");
    return 0;
  }
  const data = io.readVanilla(VANILLA_CONF);
  const scalar = firstScalar(data.toString("utf-8"));
  if (!scalar) {
    io.log(`stopped: ${VANILLA_CONF} holds no scalar line`);
    return 3;
  }
  const throwawayExistedBefore = io.exists(abs(sandbox, THROWAWAY));
  io.writeBytes(abs(sandbox, PLANT_CONF), data);
  const rec = {
    rel: PLANT_CONF,
    sha256: sha256(data),
    bytes: data.length,
    varName: scalar.varName,
    value: scalar.value,
    next: scalar.next,
    throwawayExistedBefore,
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(rec, null, 2) + "\n"));
  io.log(`planted (sha256 ${rec.sha256}); record ${PLANT_FILE}`);
  return 0;
}

export function runRollback(
  sandbox: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandbox, P4_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${P4_ROOT}/ is absent`);
    return 0;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${P4_ROOT}/ (${files.length} files)`);
  if (!really) {
    io.log("dry run: nothing removed");
    return 0;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return 1;
  }
  const listing = files.map((rel) => ({
    rel,
    sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))),
  }));
  io.writeBytes(
    join(sittingDir, "throwaway-p4-listing.json"),
    Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
  );
  io.removeTree(dir);
  let before: boolean | undefined;
  try {
    before = (
      JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as {
        throwawayExistedBefore?: boolean;
      }
    ).throwawayExistedBefore;
  } catch {
    before = undefined;
  }
  const top = join(sandbox, THROWAWAY);
  if (before === false && io.exists(top) && io.listDir(top).length === 0) io.removeTree(top);
  io.log(`removed <sandbox>/${P4_ROOT}/ (listing in throwaway-p4-listing.json)`);
  return 0;
}

function listTreeOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      if (statSync(p).isDirectory()) walk(p, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out;
}

async function realOfflineIo(needsPaks: boolean): Promise<OfflineIo> {
  let vanilla: ((p: string) => Buffer) | null = null;
  if (needsPaks) {
    const { PakVirtualFS } = await import("../../src/pak/vfs.js");
    const vfs = PakVirtualFS.get(loadConfig().gamePath);
    if (!vfs) throw new Error("the game paks could not be opened (ENFUSION_GAME_PATH)");
    vanilla = (p) => vfs.readFile(p);
  }
  return {
    workbenchPids: () => processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid),
    exists: existsSync,
    listDir: (p) => readdirSync(p),
    listTree: listTreeOf,
    readVanilla: (p) => {
      if (!vanilla) throw new Error("the pak reader is not open");
      return vanilla(p);
    },
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    removeTree: (p) => rmSync(p, { recursive: true, force: false }),
    log: (l) => console.log(l),
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
    `P4-1: ${launchCount(seq)} launch (up to ${MAX_RELAUNCHES} relaunches); one lane; ${SAA} on the owner's standing go`,
  ];
  for (const e of seq) {
    if (e.kind === "hand") {
      lines.push(
        `  ${e.id} [${e.phase}] HAND${e.launches ? " (LAUNCH)" : ""}: ${e.text}${e.ownerHand ? `; owner: ${e.ownerHand}` : ""}`,
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
  offlineIo?: OfflineIo;
  leaseHeld?: boolean;
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
    log(`refused: ${SAA} is pre-flight's (h-launch), never a p4-1 argument`);
    return 2;
  }
  const really = args.flags.has("really");
  const sub = args.positional[0];
  if (sub === "plant" || sub === "rollback") {
    if (!o.sandbox || !o["sitting-dir"]) {
      log(`${sub} needs --sandbox <dir> and --sitting-dir <dir>`);
      return 2;
    }
    if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
      log(`aborted: --sandbox must be the 2.0 sandbox folder ${SANDBOX_NAME}`);
      return 4;
    }
    if (really) {
      if (!o.id) {
        log(`${sub} --really needs --id <lane id>`);
        return 2;
      }
      const held = over.leaseHeld ?? new Lane({ id: o.id }).holdsLease();
      if (!held) {
        log(`refused: the lease is not held by lane ${o.id}`);
        return 1;
      }
    }
    const io = over.offlineIo ?? (await realOfflineIo(sub === "plant" && really));
    const sandbox = resolve(o.sandbox);
    const sitting = resolve(o["sitting-dir"]);
    return sub === "plant"
      ? runPlant(sandbox, sitting, really, io)
      : runRollback(sandbox, sitting, really, io);
  }
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
      const n = validateQueue(queue, false).length;
      log(`queue: ${n} probes, valid (validateQueue)`);
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
  log(toPlaceholders(`P4-1 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
