/**
 * Sitting P4-2, a HAND-FREE pass over the modules other than the World Editor (main's brief of
 * 2026-10-12, after P4-1's first run): a THIN orchestrator in `p4-1.ts`'s shape. Every live step is
 * a step of a census walker run through that walker's own CLI (its gate, window rule, handoffs,
 * records and evidence). What this file adds is the ORDER, the flags, the per-module run folders,
 * the combined dry-run plan, the P4-2 queue, and one offline subcommand (`propose`).
 *
 * One lane, one launch, the read-only probe pack only (no world is created, so the mutating pack
 * is not installed and `P4-2` is NOT in `PROBE_MUT_SESSIONS`), `-scriptAuthorizeAll` on the
 * owner's standing go (DEC-053 ruling 2), the scratch ini:
 *
 *   offline-0  the plant of P4-1 (`p4-1.ts plant`, the same U16 copy under _throwaway/P4/u16/)
 *   L1         per module, in the design's order without WorldEditor and ParticleEditor:
 *              L10 `--only p4-l10-NN-<Module>` (open, front, info), then L01, L03 and L07 on the
 *              module's own window in the empty state (`--state none`: no module here has a
 *              mode axis in state-matrix.json). No L02 (titles_by_module names only WorldEditor
 *              and ResourceManager), no L06 (it plans no step outside the World Editor).
 *              SetOpenedResource is NOT called (package G): each editor opens empty, and that
 *              empty state is what is recorded.
 *   offline    `t-propose`: each module's L01 menu-bar titles to a titles_by_module proposal in
 *              the sitting folder, for main to merge into policy (this file never edits policy).
 *   close      the full post-flight (one WM_CLOSE to the recorded main window, the probe pack
 *              removed); `p4-1.ts rollback` of _throwaway/P4/.
 *
 * No owner hands: a HANDOFF (exit 5) ends that entry and main skips to the next module.
 *
 * Usage:
 *   npx --no tsx scripts/live/p4-2.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/p4-2.ts --entry <id> [--print] --id <lane> --sandbox <dir>
 *       --sitting-dir <dir> [--only-step <step>] [--really]
 *   npx --no tsx scripts/live/p4-2.ts propose --sitting-dir <dir> [--really]
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

export const SESSION = "P4-2";
export const SCRIPT_PATH = "scripts/live/p4-2.ts";
export const RUNBOOK = "docs/v2/sessions/queues/P4-2.md";
export const QUEUE_REL = "docs/v2/sessions/queues/P4-2-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const GPROJ = `<sandbox>/${SANDBOX_NAME}.gproj`;
export const SCRATCH_INI = "<sitting>/p4-scratch.ini";
/** Read-only pack only: no world is created, so the mutating pack stays out. */
export const PACKS = ["mod-dev/probe"] as const;
/** `--state none`: the empty state; none of these modules has a mode axis (state-matrix.json). */
export const STATE = "none";
export const PROPOSAL_FILE = "titles-by-module-proposal.json";

/** The design's order (§3 D15, L10's step numbers), WorldEditor and ParticleEditor left out. */
export const MODULES = [
  { nn: "01", module: "LocalizationEditor" },
  { nn: "02", module: "BehaviorEditor" },
  { nn: "03", module: "AudioEditor" },
  { nn: "04", module: "AnimEditor" },
  { nn: "05", module: "ProcAnimEditor" },
  { nn: "06", module: "ScriptEditor" },
  { nn: "08", module: "ResourceManager" },
  { nn: "09", module: "NavmeshGeneratorMain" },
] as const;

export type WalkerKey = "L01" | "L03" | "L07" | "L10";
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
  sub: "plant" | "propose";
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
  `then npx --no tsx scripts/live/preflight.ts --variant default --purpose "P4-2" --id <lane> --queue ${QUEUE_REL} --probe-pack --force-settings "${SCRATCH_INI}" --u12-passed --script-authorize-all --owner-go-script-authorize-all ` +
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
      command: 'npx --no tsx scripts/live/lane.ts start --purpose "live sitting P4-2" --id <lane>',
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
      text: `the launch: handlers and the read-only probe pack, two-pass pre-flight on the P4-2 queue, the scratch ini, ${SAA} on the owner's standing go (DEC-053); no mutating pack (no world is created)`,
      command: LAUNCH_COMMAND,
    },
  ];
  for (const { nn, module } of MODULES) {
    const m = `m${nn}`;
    const base = { kind: "walker" as const, phase: "L1" as const, target: module, runSub: module };
    seq.push(
      {
        ...base,
        id: `${m}-l10`,
        walker: "L10",
        module: "Shared",
        only: `p4-l10-${nn}-${module}`,
        answers: `${module} opened empty (no SetOpenedResource), fronted, info; its window title`,
      },
      {
        ...base,
        id: `${m}-l01`,
        walker: "L01",
        module,
        answers: `L01 snapshot of the ${module} window, empty state`,
      },
      {
        ...base,
        id: `${m}-l03`,
        walker: "L03",
        module,
        answers: `L03 chrome of the ${module} window from L01's walk`,
      },
      {
        ...base,
        id: `${m}-l07`,
        walker: "L07",
        module,
        answers: `L07 PNGs of the ${module} window and its opaque regions`,
      },
    );
  }
  seq.push(
    {
      kind: "self",
      id: "t-propose",
      phase: "close",
      sub: "propose",
      answers: `each module's L01 menu-bar titles to <sitting>/${PROPOSAL_FILE} (titles_by_module proposal; policy untouched)`,
    },
    {
      kind: "hand",
      id: "h-close",
      phase: "close",
      text: "the full post-flight: one WM_CLOSE to the recorded main window (DEC-053), net-zero diff, registry comparison, the probe pack removed, lease ended; then rollback of _throwaway/P4/",
      command: CLOSE_COMMAND,
    },
  );
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
  if (e.kind === "self") return e.sub === "plant" ? 30_000 : 10_000;
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
  if (e.kind === "self" && e.sub === "propose") {
    const argv = ["propose", "--sitting-dir", input.sittingDir];
    if (input.really) argv.push("--really");
    return { argv, script: SCRIPT_PATH };
  }
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
    step: "p4-2-launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: ["-gproj", GPROJ, "-forceSettings", SCRATCH_INI, SAA],
    ownerGo: "scriptAuthorizeAll",
    note: `pre-flight step 8 with ${QUEUE_REL}; pack ${PACKS.join(", ")}; ${SAA} on the owner's standing go (DEC-053 ruling 2)`,
  } as PlanAction;
}

export function entryPlan(e: RunEntry): { script: string; plan: PlanAction[] } {
  if (e.kind === "self") return { script: e.sub === "plant" ? P41_SCRIPT : SCRIPT_PATH, plan: [] };
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
      if (e.sub !== "plant") continue; // propose reads files only: no Workbench probe
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
      "Generated by `scripts/live/p4-2.ts --emit-queue` from the walkers' step tables in P4-2 run order; tests/live-harness/p4-2.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the one launch (L1.n): each module's L10 open (mutating: GetModule opens a closed module) precedes its read-only walks. `step` is the walker's own step id; `id` adds @<Module> where a step id repeats. Read-only probe pack only: session P4-2 is not in PROBE_MUT_SESSIONS.",
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

// ── Offline: the titles_by_module proposal ───────────────────────────────────

interface ObsLine {
  kind?: string;
  label?: string;
  label_raw?: string;
  key?: { path?: string[] };
  locator?: { menuPath?: string[] };
  parent_key?: { kind?: string; key?: { path?: string[] } } | null;
}

/**
 * The menu-bar titles of one L01 obs file: `menu` rows one level deep whose parent is the window
 * row (FIX-F convention) or, in a pre-FIX-F file, the QMenuBar region. File order, no duplicates.
 */
export function menuTitles(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let o: ObsLine;
    try {
      o = JSON.parse(raw) as ObsLine;
    } catch {
      continue;
    }
    if (o.kind !== "menu") continue;
    const path = o.locator?.menuPath ?? o.key?.path ?? [];
    if (path.length !== 1) continue;
    const pk = o.parent_key;
    const underWindow =
      pk?.kind === "window" ||
      (pk?.kind === "region" && (pk.key?.path?.[0] ?? "").startsWith("@QMenuBar"));
    if (!underWindow) continue;
    const t = o.label_raw ?? o.label ?? path[0];
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function buildProposal(
  sittingDir: string,
  read: (p: string) => string | null,
): Record<string, unknown> {
  const titles: Record<string, string[]> = {};
  const sources: Record<string, string> = {};
  const missing: string[] = [];
  for (const { module } of MODULES) {
    const rel = `${module}/L01-${module}-none.obs.jsonl`;
    const text = read(join(sittingDir, ...rel.split("/")));
    if (text === null) {
      missing.push(module);
      continue;
    }
    sources[module] = rel;
    titles[module] = menuTitles(text);
  }
  return {
    $comment:
      "Proposal only (p4-2.ts propose): the menu-bar titles each module's L01 read, for main to merge into policy.json live_lane.uia_menu.titles_by_module. Nothing here is policy until main merges it.",
    session: SESSION,
    titles_by_module: titles,
    sources,
    missing,
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
    `P4-2: ${launchCount(seq)} launch (up to ${MAX_RELAUNCHES} relaunches); one lane; hand-free; read-only pack; ${SAA} on the owner's standing go; worst case ${Math.round(total / 60_000)} min`,
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
  readText?: (p: string) => string | null;
  writeText?: (p: string, t: string) => void;
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
    log(`refused: ${SAA} is pre-flight's (h-launch), never a p4-2 argument`);
    return 2;
  }
  const really = args.flags.has("really");
  const sub = args.positional[0];
  if (sub === "propose") {
    if (!o["sitting-dir"]) {
      log("propose needs --sitting-dir <dir>");
      return 2;
    }
    const sitting = resolve(o["sitting-dir"]);
    const read =
      over.readText ?? ((p: string) => (existsSync(p) ? readFileSync(p, "utf-8") : null));
    const prop = buildProposal(sitting, read);
    const text = JSON.stringify(prop, null, 2) + "\n";
    log(text.trimEnd());
    if (!really) {
      log("dry run: nothing written");
      return 0;
    }
    (over.writeText ?? writeFile)(join(sitting, PROPOSAL_FILE), text);
    log(`wrote ${PROPOSAL_FILE}`);
    return 0;
  }
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
  log(toPlaceholders(`P4-2 ${o.entry}: ${commandLine(r.script, r.argv)}`, ph));
  if (args.flags.has("print")) return 0;
  return (over.spawnChild ?? defaultSpawn)(r.script, r.argv);
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
