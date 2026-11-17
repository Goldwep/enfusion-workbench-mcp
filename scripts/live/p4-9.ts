/**
 * Sitting P4-9, the Resource Manager's eight sub-editors (owner ruling 9 of
 * docs/v2/inbox/EXIT-GATE-RULINGS.md, 2026-11-03: this sitting rather than wave W2). In `p4-3.ts`'s
 * shape: one lane, one launch, the read-only probe pack only, `-scriptAuthorizeAll` on the owner's
 * standing go (DEC-053 ruling 2), the scratch ini; the plant and rollback are `p4-1.ts plant` and
 * `p4-1.ts rollback`. Every live step is a census walker's step run through that walker's own CLI,
 * or one raw NET call through `scripts/live/netcall.ts`.
 *
 * Per sub-editor (ResourceManager.Config, .Layout, .Imageset, .Model, .Texture, .Material, .Font,
 * .Styles), one vanilla resource of its type, in this order:
 *
 *   sNN-open    the native `OpenResource { ResourceName }` (src/workbench/native.ts: MUTATE, it
 *               opens a tab) on a project-relative vanilla path, the form S-C sc-08 and S-D sd-12
 *               sent; S-C sc-08 (1.8.0.13) opened the .conf, .layout, .emat and .xob below with
 *               Opened true and NO new top-level window: the sub-editors are tabs of the RM window
 *   hNN-tab     main reads the windows: the tab is in the RM window, no dialog, no new top-level
 *               window. s01 is the PROBE of the title the sub-editor rows are read under; a new
 *               window or a title MODULE_TITLES does not match is a HANDOFF: main records class and
 *               title, the sub-editor's walks do not run, its close follows
 *   sNN-l10     L10's ResourceManager step (open, front, info): RM fronted, container classes of the
 *               opened tab and the RM window title recorded in the sub-editor's run folder
 *   sNN-l01     L01 snapshot of the RM window with the tab active, `--module ResourceManager.<X>`
 *   sNN-l02     L02 (menus.py expand and collapse only); blocked until policy
 *               live_lane.uia_menu.titles_by_module names the sub-editor (main's file)
 *   sNN-l03     L03 chrome (and its Window-menu step once the titles name Window)
 *   sNN-l07     L07 PNGs of the RM window and its opaque regions with the tab active
 *   hNN-close   the owner closes the tab by hand (nothing was edited, so no prompt is expected; a
 *               save prompt is answered Don't Save, never Save)
 *
 * Stretch, last and hand-off gated: L05 on the Resource Browser, one file of each type, state
 * `resource_type=<ext>` (state-matrix.json: the ResourceManager context-menu axis). L05 reads its
 * targets from policy live_lane.uia_context.targets; until main copies `L05_TARGETS` there those
 * entries plan nothing and are reported blocked.
 *
 * Every walk passes `--state none` except L05's. A HANDOFF (exit 5) or STOP ends that entry; main
 * records it and goes to the sub-editor's close. A step never runs twice: each sub-editor has its
 * own run folder `<sitting>/<Module>/`, each L05 file `<sitting>/RB-<ext>/`.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-9.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-9.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir> [--only-step <step>] [--really]
 *   npx --no tsx scripts/live/p4-9.ts plant|rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: the child's exit code for a real entry; the dry run 0 passed, 1 failed, 2 usage.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MODULE_TITLES,
  buildWalkerQueue,
  parseState,
  walkerPlan,
  type ObservedState,
  type WalkerStep,
} from "../census/live/common.js";
import { RESOURCE_DOCK } from "../census/live/L05-context.js";
import { titlesFor } from "../../tools/uia/menus.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import {
  MAX_RELAUNCHES,
  NETCALL,
  P4_ROOT,
  PLANT_CONF,
  PLANT_FILE,
  PROBE_RANK,
  SAA,
  VANILLA_CONF,
  WALKERS,
  commandLine,
  main as p41Main,
  walkerDefs,
  SCRIPT_PATH as P41_SCRIPT,
} from "./p4-1.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "P4-9";
export const SCRIPT_PATH = "scripts/live/p4-9.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-9.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-9-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const SCRATCH_INI = "<sitting>/p4-scratch.ini";
/** Read-only pack only: no world is created, so `P4-9` is not in PROBE_MUT_SESSIONS. */
export const PACKS = ["mod-dev/probe"] as const;
/** `--state none` for every walk but L05's (the sub-editors declare no axis, state-matrix.json). */
export const STATE = "none";
/** OpenResource's budget: src/workbench/native.ts NATIVE_TIMEOUTS.gui. */
export const OPEN_TIMEOUT_MS = 60_000;
/** L10's ResourceManager step (MODULE_MATRIX row 8): open, front, info. */
export const L10_RM_STEP = "p4-l10-08-ResourceManager";

/**
 * One vanilla resource per sub-editor, as the project-relative ResourceName OpenResource takes
 * (S-C sc-08 and S-D sd-12 sent this bare form for vanilla files; the sandbox depends on the core
 * ArmaReforger data). Read from the 1.8.0.13 paks with game_browse/game_read (2026-11-03).
 * `opened`: S-C sc-08 (1.8.0.13) answered Opened true for this exact name; the others are
 * [unverified] until s0N-open.
 */
export const SUB_EDITORS = [
  {
    nn: "01",
    module: "ResourceManager.Config",
    ext: "conf",
    resource: VANILLA_CONF,
    opened: "S-C sc-08 and S-D sd-12: Opened true (15,099 bytes)",
  },
  {
    nn: "02",
    module: "ResourceManager.Layout",
    ext: "layout",
    resource: "UI/layouts/Camera/ManualCameraCrosshair.layout",
    opened: "S-C sc-08: Opened true",
  },
  {
    nn: "03",
    module: "ResourceManager.Imageset",
    ext: "imageset",
    resource: "UI/Imagesets/ScrollbarRectangles.imageset",
    opened: null,
  },
  {
    nn: "04",
    module: "ResourceManager.Model",
    ext: "xob",
    resource: "system/wbdata/CompassGizmo/NESW.xob",
    opened: "S-C sc-08: Opened true (and OpenXOB in sc-08b)",
  },
  {
    nn: "05",
    module: "ResourceManager.Texture",
    ext: "edds",
    // GUID {C518DC484A78B9F0}, as ScrollbarRectangles.imageset references it; 1.3 KB.
    resource: "UI/Textures/WidgetLibrary/ScrollBarRectangles.edds",
    opened: null,
  },
  {
    nn: "06",
    module: "ResourceManager.Material",
    ext: "emat",
    resource: "system/materials/lightSourceDefault.emat",
    opened: "S-C sc-08: Opened true",
  },
  {
    nn: "07",
    module: "ResourceManager.Font",
    ext: "fnt",
    resource: "UI/Fonts/Roboto/Roboto_Regular.fnt",
    opened: null,
  },
  {
    nn: "08",
    module: "ResourceManager.Styles",
    ext: "styles",
    resource: "UI/Styles/editor.styles",
    opened: null,
  },
] as const;

/** The base name the Resource Browser lists for a resource (L05's target label) [unverified]. */
export const baseName = (resource: string): string => resource.split("/").pop() ?? resource;

/**
 * The L05 targets main copies into policy live_lane.uia_context.targets for the stretch block:
 * one per type, the file the owner shows in the Resource Browser (L05-context.ts deriveTargets
 * proposes this shape from an L01 walk: `[RESOURCE_DOCK, <item name>]`).
 */
export const L05_TARGETS = SUB_EDITORS.map((s) => ({
  module: "ResourceManager",
  path: [RESOURCE_DOCK, baseName(s.resource)],
}));

export const WALKS = ["L01", "L02", "L03", "L07"] as const;
export type WalkerKey = "L01" | "L02" | "L03" | "L05" | "L07" | "L10";
export type Phase = "offline-0" | "L1" | "close";

// ── The sequence ─────────────────────────────────────────────────────────────

export interface WalkerEntry {
  kind: "walker";
  id: string;
  phase: "L1";
  walker: WalkerKey;
  /** The module the walker is given (`Shared` for L10, which ignores it). */
  module: string;
  /** `--state`: "none", or `resource_type=<ext>` for L05. */
  state: string;
  /** The run folder under the sitting folder; also the queue id suffix of a repeated step. */
  runSub: string;
  only?: string;
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

const HEARTBEAT = "npx --no tsx scripts/live/lane.ts heartbeat --id <lane>";

export const LAUNCH_COMMAND =
  `npx --no tsx scripts/live/launch.ts --install-handlers "<sandbox>" ${PACKS.map((p) => `--probe-pack ${p}`).join(" ")} --id <lane> --really; ` +
  `then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P4-9" --id <lane> --queue ${QUEUE_REL} --probe-pack --force-settings "${SCRATCH_INI}" --u12-passed --script-authorize-all --owner-go-script-authorize-all ` +
  "(pass 1 --until 7; before pass 2 build the scratch ini fresh from the pass-1 export as S-D.md 'Before the sitting' item 6; pass 2 --really)";

export const CLOSE_COMMAND =
  "npx --no tsx scripts/live/postflight.ts --id <lane> --registry-before <reg> --sandbox <sandbox> --remove-probe --session-number <NNN> --really; " +
  `npx --no tsx ${SCRIPT_PATH} rollback --sandbox <sandbox> --sitting-dir <sitting> --id <lane> --really`;

const NO_SAVE = "never saved: the owner closes the tab by hand; a save prompt is Don't Save";

export function buildSequence(): Entry[] {
  const seq: Entry[] = [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      text: "the lease for the one lane (kept to the post-flight); heartbeat between sub-editors (the lease orphans after about 15 min, DEC-053)",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-9" --id <lane>',
    },
    {
      kind: "self",
      id: "o-00-plant",
      phase: "offline-0",
      sub: "plant",
      answers: `D16a: P4-1's plant (\`p4-1.ts plant\`): ${VANILLA_CONF} at <sandbox>/${PLANT_CONF}; STOP if <sandbox>/${P4_ROOT}/ exists`,
    },
    {
      kind: "hand",
      id: "h-launch",
      phase: "L1",
      launches: true,
      text: `the launch: handlers and the read-only probe pack, two-pass pre-flight on the P4-9 queue, the scratch ini, ${SAA} on the owner's standing go (DEC-053); no mutating pack (no world is created)`,
      command: LAUNCH_COMMAND,
      ownerHand: "the launch go in chat",
    },
  ];
  for (const s of SUB_EDITORS) {
    const m = `s${s.nn}`;
    const base = { kind: "walker" as const, phase: "L1" as const, state: STATE, runSub: s.module };
    const probe = s.nn === "01";
    seq.push({
      kind: "net",
      id: `${m}-open`,
      phase: "L1",
      apiFunc: "OpenResource",
      params: { ResourceName: s.resource },
      timeoutMs: OPEN_TIMEOUT_MS,
      risk: "mutating",
      expected: `Opened true; the ${s.module} tab opens in the RM window, no new top-level window (S-C sc-08)${s.opened ? `; seen before: ${s.opened}` : " [unverified]: first open of this type"}`,
      kill: "Opened false or no answer: this sub-editor ends (its walks are skipped, nothing retried), main goes to its close; a dialog: HANDOFF (Don't Save, never Save)",
      sideEffects: [`a ${s.ext} tab in the Resource Manager window (vanilla, packed, read-only)`],
      rollback: NO_SAVE,
      answers: `owner ruling 9: open ${s.module} on one vanilla .${s.ext}`,
    });
    seq.push({
      kind: "hand",
      id: `h${s.nn}-tab`,
      phase: "L1",
      text:
        `${probe ? "PROBE (first sub-editor): " : ""}main reads the windows of the recorded pid (the next entry's L10 artifact records the RM title; \`wb_gui modals\` for a dialog): ` +
        `the tab is in the RM window and the title matches MODULE_TITLES["${s.module}"] (${MODULE_TITLES[s.module]?.pattern ?? "none"}, [unverified]). ` +
        "A new top-level window, a dialog, or another title: HANDOFF, main records class and title, skips this sub-editor's walks and goes to its close",
      command: HEARTBEAT,
    });
    seq.push({
      ...base,
      id: `${m}-l10`,
      walker: "L10",
      module: "Shared",
      only: L10_RM_STEP,
      answers: `RM opened, fronted, info with the ${s.module} tab active: its container classes and the RM window title`,
    });
    for (const wk of WALKS)
      seq.push({
        ...base,
        id: `${m}-${wk.toLowerCase()}`,
        walker: wk,
        module: s.module,
        answers: `${wk} of the RM window with the ${s.module} tab active (${baseName(s.resource)})`,
        ...(wk === "L02" ? { ownerHand: "Esc on a popup left open (HANDOFF)" } : {}),
      });
    seq.push({
      kind: "hand",
      id: `h${s.nn}-close`,
      phase: "L1",
      handoff: true,
      text: `the owner closes the ${baseName(s.resource)} tab by hand (Window > Close Tab, or the tab's close button); nothing was edited, so no prompt is expected; heartbeat the lease`,
      command: HEARTBEAT,
      ownerHand: "close the tab; a save prompt: Don't Save (never Save)",
    });
  }
  seq.push({
    kind: "hand",
    id: "h-l05-gate",
    phase: "L1",
    text: `STRETCH, only with time left and the owner's go: main has copied L05_TARGETS into policy live_lane.uia_context.targets and re-emitted this queue (else every rb-* entry is blocked and the block is skipped); before each rb-* entry the owner shows that file in the ${RESOURCE_DOCK} dock (navigates to its folder, no double-click, no open)`,
    ownerHand: "navigate the Resource Browser to each file's folder",
  });
  for (const s of SUB_EDITORS)
    seq.push({
      kind: "walker",
      id: `rb-${s.ext}-l05`,
      phase: "L1",
      walker: "L05",
      module: "ResourceManager",
      state: `resource_type=${s.ext}`,
      runSub: `RB-${s.ext}`,
      answers: `L05 the context menu of ${baseName(s.resource)} in the ${RESOURCE_DOCK} (state resource_type=${s.ext})`,
      ownerHand: `show ${baseName(s.resource)} in the ${RESOURCE_DOCK}; Esc on a popup left open (HANDOFF)`,
    });
  seq.push({
    kind: "hand",
    id: "h-close",
    phase: "close",
    handoff: true,
    text: `the full post-flight: one WM_CLOSE to the recorded main window (DEC-053); a save prompt is a HANDOFF the main session answers as the owner's hand, Don't Save (never Save); then net-zero diff, registry comparison, the probe pack removed, lease ended; then rollback of ${P4_ROOT}/`,
    command: CLOSE_COMMAND,
    ownerHand: "Don't Save on any save prompt",
  });
  return seq;
}

export const runEntries = (seq: Entry[] = buildSequence()): RunEntry[] =>
  seq.filter((e): e is RunEntry => e.kind !== "hand");
export const launchCount = (seq: Entry[] = buildSequence()): number =>
  seq.filter((e) => e.kind === "hand" && e.launches).length;

// ── Steps of an entry ────────────────────────────────────────────────────────

export function stateOf(text: string): ObservedState {
  const s = parseState(text);
  if (typeof s === "string") throw new Error(s);
  return s;
}

const SEL = (e: WalkerEntry) => ({ module: e.module, state: stateOf(e.state), allowOwned: false });

export function entrySteps(e: WalkerEntry): WalkerStep[] {
  const all = walkerDefs()[e.walker].steps(SEL(e));
  return e.only ? all.filter((s) => s.id === e.only) : all;
}

/** Why an entry cannot run today, or null. */
export function blockedReason(e: RunEntry): string | null {
  if (e.kind !== "walker" || entrySteps(e).length) return null;
  if (e.walker === "L02" && !titlesFor(loadPolicy(), e.module))
    return `policy live_lane.uia_menu.titles_by_module has no ${e.module} entry (main adds it)`;
  if (e.walker === "L05")
    return `policy live_lane.uia_context.targets has no ResourceManager target for ${e.state} (main copies L05_TARGETS)`;
  return `${e.walker} plans no step for ${e.module}`;
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
    e.state,
    "--session",
    SESSION,
  );
  if (input.onlyStep) {
    if (!steps.some((s) => s.id === input.onlyStep))
      return { refusal: `${input.onlyStep} is not a step of ${entryId}` };
    argv.push("--only", input.onlyStep);
  } else if (e.only) argv.push("--only", e.only);
  else argv.push("--from", steps[0].id);
  return { argv, script: WALKERS[e.walker] };
}

// ── Plan and queue ───────────────────────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    step: "p4-9-launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI, SAA],
    ownerGo: "scriptAuthorizeAll",
    note: `pre-flight step 8 with ${QUEUE_REL}; pack ${PACKS.join(", ")}; ${SAA} on the owner's standing go (DEC-053 ruling 2)`,
  } as PlanAction;
}

export function entryPlan(e: RunEntry): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: P41_SCRIPT, plan: [] };
  if (e.kind === "net")
    return {
      script: NETCALL,
      plan: [{ kind: "net-call", step: e.id, target: e.apiFunc, params: e.params } as PlanAction],
    };
  return { script: WALKERS[e.walker], plan: walkerPlan(entrySteps(e), SEL(e)) };
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
    const blocked = blockedReason(e);
    lines.push(
      `${e.id}: ${r.ok ? "PASS" : formatResult(r)} (${plan.length} actions)${blocked ? `; BLOCKED: ${blocked}` : ""}`,
    );
  }
  return { ok, lines };
}

export function queueProbes(seq: Entry[] = buildSequence()): Array<Record<string, unknown>> {
  const raw: Array<Record<string, unknown> & { phase: Phase; sub: string }> = [];
  for (const e of runEntries(seq)) {
    if (e.kind === "self") {
      raw.push({
        id: "p4-o-00-plant",
        title: `plant a copy of vanilla ${VANILLA_CONF} at <sandbox>/${PLANT_CONF} (p4-1.ts plant)`,
        timeout_ms: 30_000,
        expected: `the copy byte for byte; ${PLANT_FILE} records its hash and the first top-level scalar`,
        kill_criterion: `a Workbench image runs, or <sandbox>/${P4_ROOT}/ exists: STOP`,
        side_effects: [`<sandbox>/${PLANT_CONF}`],
        rollback: `\`p4-9.ts rollback\` (p4-1.ts rollback) lists and removes <sandbox>/${P4_ROOT}/`,
        risk_class: "mutating",
        phase: e.phase,
        sub: "offline",
        entry: e.id,
        script: P41_SCRIPT,
      });
      continue;
    }
    if (e.kind === "net") {
      raw.push({
        id: `p4-${e.id}`,
        title: `${e.apiFunc} ${String(e.params.ResourceName ?? "")}`.trim(),
        timeout_ms: e.timeoutMs,
        expected: e.expected,
        kill_criterion: e.kill,
        side_effects: e.sideEffects,
        rollback: e.rollback,
        risk_class: e.risk,
        phase: e.phase,
        sub: e.id,
        entry: e.id,
        script: NETCALL,
      });
      continue;
    }
    const q = buildWalkerQueue(walkerDefs()[e.walker], entrySteps(e), SESSION).probes as Array<
      Record<string, unknown>
    >;
    for (const p of q)
      raw.push({
        ...p,
        phase: e.phase,
        sub: e.runSub,
        entry: e.id,
        script: WALKERS[e.walker],
        module: e.module,
        state: e.state,
      });
  }
  // A step id that repeats (L10's RM step, L03, L07, L05's probe) gets `@<run folder>`.
  const seen = new Set<string>();
  let block = 0;
  let lastRank = -1;
  let lastPhase: Phase | null = null;
  return raw.map(({ phase, sub, ...p }) => {
    const step = String(p.id);
    let id = step;
    // Dots become dashes: an at-sign followed by a dotted module name reads as an e-mail address to the PII gate.
    if (seen.has(id)) id = `${step}@${sub.replace(/\./g, "-")}`;
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
      "Generated by `scripts/live/p4-9.ts --emit-queue` from the walkers' step tables and the OpenResource netcalls, in P4-9 run order; tests/live-harness/p4-9.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the one launch (L1.n). `step` is the walker's own step id; `id` adds @<run folder, dots as dashes> where a step id repeats. Read-only probe pack only: session P4-9 is not in PROBE_MUT_SESSIONS. Blocked entries (L02 without policy titles, L05 without policy targets) plan no probe until main fills the policy and re-emits this file.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/inbox/EXIT-GATE-RULINGS.md ruling 9",
      "docs/v2/design/phase4-live-census.md 3, D15, D16",
      "DEC-053 ruling 2",
      "PLAN 5.4",
    ],
    launches: launchCount(seq),
    max_relaunches: MAX_RELAUNCHES,
    launch_packs: PACKS,
    launch_args: launchAction().args,
    launch_args_note: `pre-flight builds the real arguments; ${SAA} on the owner's standing go (DEC-053)`,
    resources: SUB_EDITORS.map((s) => ({
      module: s.module,
      resource: s.resource,
      seen_open: s.opened ?? "[unverified]",
    })),
    invocations: runEntries(seq).map((e) => ({
      id: e.id,
      script: entryPlan(e).script,
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
  const total = runEntries(seq).reduce((n, e) => n + entryWorstCaseMs(e), 0);
  const lines = [
    `P4-9: ${launchCount(seq)} launch (up to ${MAX_RELAUNCHES} relaunches); one lane; read-only pack; ${SAA} on the owner's standing go; owner present for the tab closes; worst case ${Math.round(total / 60_000)} min`,
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

const writeFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf-8");
};

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
    log(`refused: ${SAA} is pre-flight's (h-launch), never a p4-9 argument`);
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
    let queueOk = true;
    const queue = buildQueue();
    try {
      log(`queue: ${validateQueue(queue, false).length} probes, valid (validateQueue)`);
    } catch (e) {
      queueOk = false;
      log(`queue refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (o.out) writeFile(o.out, JSON.stringify(buildPlan(), null, 2) + "\n");
    if (o.outline) writeFile(o.outline, outline().join("\n") + "\n");
    if (o["emit-queue"]) writeFile(o["emit-queue"], JSON.stringify(queue, null, 2) + "\n");
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
  log(toPlaceholders(`P4-9 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
