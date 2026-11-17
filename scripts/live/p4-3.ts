/**
 * Sitting P4-3, a HAND-FREE pass in `p4-2.ts`'s shape (main's brief of 2026-10-12, after P4-2): the
 * six editors P4-2 only opened get L10 then L02 (menus.py expands and collapses only, `--state none`)
 * then L07; the Navmesh module (its own window, titled like the main one) gets L10, L01, L03, L07;
 * WorldEditor and ResourceManager get L10 then L07 only (their L02 ran in P4-1). Every live step is a
 * step of a census walker run through that walker's own CLI.
 *
 * One lane, one launch, the read-only probe pack only (no world is created, so `P4-3` is NOT in
 * `PROBE_MUT_SESSIONS`), `-scriptAuthorizeAll` on the owner's standing go (DEC-053 ruling 2), the
 * scratch ini; the plant and rollback are `p4-1.ts plant` and `p4-1.ts rollback`. SetOpenedResource
 * is NOT called: each editor opens empty. No owner hands: a HANDOFF (exit 5) ends that entry and
 * main skips to the next module.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-3.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-3.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir> [--only-step <step>] [--really]
 *
 * Exit: the child's exit code for a real entry; the dry run 0 passed, 1 failed, 2 usage.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWalkerQueue, walkerPlan, type WalkerStep } from "../census/live/common.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import {
  MAX_RELAUNCHES,
  P4_ROOT,
  PLANT_CONF,
  PLANT_FILE,
  PROBE_RANK,
  SAA,
  VANILLA_CONF,
  WALKERS,
  commandLine,
  walkerDefs,
  SCRIPT_PATH as P41_SCRIPT,
} from "./p4-1.js";
import { REPO_ROOT, SANDBOX_NAME, defaultPlaceholderContext, toPlaceholders } from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";

export const SESSION = "P4-3";
export const SCRIPT_PATH = "scripts/live/p4-3.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-3.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-3-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const SCRATCH_INI = "<sitting>/p4-scratch.ini";
/** Read-only pack only: no world is created, so the mutating pack stays out. */
export const PACKS = ["mod-dev/probe"] as const;
/** `--state none`: the empty state; none of these modules has a mode axis (state-matrix.json). */
export const STATE = "none";

/** Per module, the walkers after its L10 (L02 is menus.py expand/collapse only; L01 and L03 only where L02 does not serve). */
export const MODULES = [
  { nn: "01", module: "LocalizationEditor", ws: ["L02", "L07"] },
  { nn: "02", module: "BehaviorEditor", ws: ["L02", "L07"] },
  { nn: "03", module: "AudioEditor", ws: ["L02", "L07"] },
  { nn: "04", module: "AnimEditor", ws: ["L02", "L07"] },
  { nn: "05", module: "ProcAnimEditor", ws: ["L02", "L07"] },
  { nn: "06", module: "ScriptEditor", ws: ["L02", "L07"] },
  { nn: "09", module: "NavmeshGeneratorMain", ws: ["L01", "L03", "L07"] },
  { nn: "07", module: "WorldEditor", ws: ["L07"] },
  { nn: "08", module: "ResourceManager", ws: ["L07"] },
] as const;

export type WalkerKey = "L01" | "L02" | "L03" | "L07" | "L10";
export type Phase = "offline-0" | "L1" | "close";

export interface WalkerEntry {
  kind: "walker";
  id: string;
  phase: "L1";
  walker: WalkerKey;
  /** The module the walker is given (`Shared` for L10, which ignores it). */
  module: string;
  /** The module this entry serves (its run folder). */
  target: string;
  runSub: string;
  only?: string;
  answers: string;
}
export interface SelfEntry {
  kind: "self";
  id: string;
  phase: Phase;
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
}
export type Entry = WalkerEntry | SelfEntry | HandEntry;
export type RunEntry = WalkerEntry | SelfEntry;

export const LAUNCH_COMMAND =
  `npx --no tsx scripts/live/launch.ts --install-handlers "<sandbox>" ${PACKS.map((p) => `--probe-pack ${p}`).join(" ")} --id <lane> --really; ` +
  `then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P4-3" --id <lane> --queue ${QUEUE_REL} --probe-pack --force-settings "${SCRATCH_INI}" --u12-passed --script-authorize-all --owner-go-script-authorize-all ` +
  "(pass 1 --until 7; before pass 2 build the scratch ini fresh from the pass-1 export as S-D.md 'Before the sitting' item 6; pass 2 --really)";

export const CLOSE_COMMAND =
  "npx --no tsx scripts/live/postflight.ts --id <lane> --registry-before <reg> --sandbox <sandbox> --remove-probe --session-number <NNN> --really; " +
  `npx --no tsx ${P41_SCRIPT} rollback --sandbox <sandbox> --sitting-dir <sitting> --id <lane> --really`;

export function buildSequence(): Entry[] {
  const seq: Entry[] = [
    {
      kind: "hand",
      id: "h-lease",
      phase: "offline-0",
      text: "the lease for the one lane (kept to the post-flight); no owner hand, so no heartbeat block is planned (the lease orphans after about 15 min, DEC-053: heartbeat between modules if the pass runs long)",
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-3" --id <lane>',
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
      text: `the launch: handlers and the read-only probe pack, two-pass pre-flight on the P4-3 queue, the scratch ini, ${SAA} on the owner's standing go (DEC-053); no mutating pack (no world is created)`,
      command: LAUNCH_COMMAND,
    },
  ];
  for (const { nn, module, ws } of MODULES) {
    const m = `m${nn}`;
    const base = { kind: "walker" as const, phase: "L1" as const, target: module, runSub: module };
    seq.push({
      ...base,
      id: `${m}-l10`,
      walker: "L10",
      module: "Shared",
      only: `p4-l10-${nn}-${module}`,
      answers: `${module} opened empty (no SetOpenedResource), fronted, info; its window title`,
    });
    for (const w of ws)
      seq.push({
        ...base,
        id: `${m}-${w.toLowerCase()}`,
        walker: w,
        module,
        answers: `${w} of the ${module} window, empty state`,
      });
  }
  seq.push({
    kind: "hand",
    id: "h-close",
    phase: "close",
    text: "the full post-flight: one WM_CLOSE to the recorded main window (DEC-053), net-zero diff, registry comparison, the probe pack removed, lease ended; then rollback of _throwaway/P4/",
    command: CLOSE_COMMAND,
  });
  return seq;
}

export const runEntries = (seq: Entry[] = buildSequence()): RunEntry[] =>
  seq.filter((e): e is RunEntry => e.kind !== "hand");
export const launchCount = (seq: Entry[] = buildSequence()): number =>
  seq.filter((e) => e.kind === "hand" && e.launches).length;

const SEL = (e: WalkerEntry) => ({ module: e.module, state: {}, allowOwned: false });

export function entrySteps(e: WalkerEntry): WalkerStep[] {
  const all = walkerDefs()[e.walker].steps(SEL(e));
  return e.only ? all.filter((s) => s.id === e.only) : all;
}

export function entryWorstCaseMs(e: RunEntry): number {
  if (e.kind === "self") return 30_000;
  return entrySteps(e).reduce((n, s) => n + s.timeout_ms, 0);
}

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
  if (!input.sittingDir) return { refusal: "pass --sitting-dir <dir>" };
  if (!input.laneId) return { refusal: "--id <lane id> is required" };
  if (!input.sandbox) return { refusal: "--sandbox <the 2.0 sandbox folder> is required" };
  const lane = ["--id", input.laneId];
  if (e.kind === "self") {
    const argv = ["plant", "--sandbox", input.sandbox, "--sitting-dir", input.sittingDir, ...lane];
    if (input.really) argv.push("--really");
    return { argv, script: P41_SCRIPT };
  }
  const steps = entrySteps(e);
  if (!steps.length) return { refusal: `${entryId}: ${e.walker} plans no step for ${e.module}` };
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
    STATE,
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
    step: "p4-3-launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI, SAA],
    ownerGo: "scriptAuthorizeAll",
    note: `pre-flight step 8 with ${QUEUE_REL}; pack ${PACKS.join(", ")}; ${SAA} on the owner's standing go (DEC-053 ruling 2)`,
  } as PlanAction;
}

export function entryPlan(e: RunEntry): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: P41_SCRIPT, plan: [] };
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
    lines.push(`${e.id}: ${r.ok ? "PASS" : formatResult(r)} (${plan.length} actions)`);
  }
  return { ok, lines };
}

export function queueProbes(seq: Entry[] = buildSequence()): Array<Record<string, unknown>> {
  const raw: Array<Record<string, unknown> & { phase: Phase }> = [];
  for (const e of runEntries(seq)) {
    if (e.kind === "self") {
      raw.push({
        id: "p4-o-00-plant",
        title: `plant a copy of vanilla ${VANILLA_CONF} at <sandbox>/${PLANT_CONF} (p4-1.ts plant)`,
        timeout_ms: 30_000,
        expected: `the copy byte for byte; ${PLANT_FILE} records its hash and the first top-level scalar`,
        kill_criterion: `a Workbench image runs, or <sandbox>/${P4_ROOT}/ exists: STOP`,
        side_effects: [`<sandbox>/${PLANT_CONF}`],
        rollback: `\`p4-1.ts rollback\` lists and removes <sandbox>/${P4_ROOT}/`,
        risk_class: "mutating",
        phase: e.phase,
        entry: e.id,
        script: P41_SCRIPT,
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
        entry: e.id,
        script: WALKERS[e.walker],
        module: e.target,
        state: STATE,
      });
  }
  // L03 and L07 step ids carry no module: a repeat gets `@<Module>`.
  const seen = new Set<string>();
  let block = 0;
  let lastRank = -1;
  let lastPhase: Phase | null = null;
  return raw.map(({ phase, ...p }) => {
    const step = String(p.id);
    let id = step;
    if (seen.has(id)) id = `${step}@${String(p.module)}`;
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
      "Generated by `scripts/live/p4-3.ts --emit-queue` from the walkers' step tables in P4-3 run order; tests/live-harness/p4-3.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the one launch (L1.n): each module's L10 open (mutating: GetModule opens a closed module) precedes its read-only walks. `step` is the walker's own step id; `id` adds @<Module> where a step id repeats. Read-only probe pack only: session P4-3 is not in PROBE_MUT_SESSIONS.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: ["docs/v2/design/phase4-live-census.md 3, D15, D16", "DEC-053 ruling 2", "PLAN 5.4"],
    launches: launchCount(seq),
    max_relaunches: MAX_RELAUNCHES,
    launch_packs: PACKS,
    launch_args: launchAction().args,
    launch_args_note: `pre-flight builds the real arguments; ${SAA} on the owner's standing go (DEC-053)`,
    invocations: runEntries(seq).map((e) => ({
      id: e.id,
      script: entryPlan(e).script,
      worst_case_ms: entryWorstCaseMs(e),
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
    `P4-3: ${launchCount(seq)} launch (up to ${MAX_RELAUNCHES} relaunches); one lane; hand-free; read-only pack; ${SAA} on the owner's standing go; worst case ${Math.round(total / 60_000)} min`,
  ];
  for (const e of seq) {
    if (e.kind === "hand") {
      lines.push(`  ${e.id} [${e.phase}] HAND${e.launches ? " (LAUNCH)" : ""}: ${e.text}`);
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
      `  ${e.id} [${e.phase}] worst case ${Math.round(entryWorstCaseMs(e) / 1000)} s`,
      `      ${cmd}`,
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
    log(`refused: ${SAA} is pre-flight's (h-launch), never a p4-3 argument`);
    return 2;
  }
  const really = args.flags.has("really");
  const sub = args.positional[0];
  if (sub) {
    log(`unknown subcommand ${sub} (plant and rollback are p4-1.ts's)`);
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
  log(toPlaceholders(`P4-3 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
