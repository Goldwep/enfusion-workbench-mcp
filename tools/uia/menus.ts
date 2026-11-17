/**
 * Wrapper of the S-F menu tool `tools/uia/menus.py` (blocker B4, owner ruling Q4: expand and
 * collapse only, never invoke, the Workbench not in front), in the form of walk.ts:
 *
 *   1. builds the run's ACTION PLAN, one `uia-menu` action, and checks it with the dry-run
 *      checker (scripts/live/dry-run.ts checkPlan, data/census/policy.json). A real run needs
 *      that check to pass; until the checker knows the `uia-menu` kind (and policy.json carries
 *      its caps), the check fails with unknown-kind and no real run happens. A fake run prints
 *      the verdict and goes on, since nothing real is touched;
 *   2. applies the single live gate (`--really`, win32, the lease held by this lane) and requires
 *      the target pid to be the Workbench pid this lane recorded;
 *   3. runs `python -B menus.py` with the redaction table (ENFUSION_UIA_REDACT) and, for a real
 *      run only, ENFUSION_UIA_MENU_PLAN_VERDICT=PASS; heartbeats the lease while it runs;
 *   4. passes the JSON through walk.ts's second redaction pass and writes it to the artifacts
 *      folder (never inside a git working tree);
 *   5. prints, as its LAST line, a one-line JSON summary:
 *      { result, exit_code, out, opened, collapsed, leftOpen, second_pass_changed }.
 *
 * Without --really nothing is attached: menus.py prints its plan (dry run).
 *
 * Usage:
 *   npx tsx tools/uia/menus.ts --pid <wb pid> --class <window class> --title <regex>
 *       --menus "<t1>,<t2>" [--module <ModuleId>] [--depth 0|1] [--allow-foreground] [--settle-ms 400]
 *       [--out <file>] [--label <name>] [--policy <policy.json>] [--addons <dir>]
 *       [--id <lane id> [--lease-path p] [--marker-path p] --really] [--dry-run]
 *   npx tsx tools/uia/menus.ts --fake-tree <menus.json> --pid <n> --class <c> --title <re>
 *       --menus "<t1>" [--depth 1] --really
 *
 * `--module` takes the title allow-list from the plan's policy (`live_lane.uia_menu.titles_by_module`,
 * Phase 4 D11), puts `module` on the plan action and passes the list to menus.py as `--allowed`;
 * without it the S-F list MAIN_MENU_TITLES applies (the Resource Manager's eight).
 *
 * Exit code: menus.py's (0 done or dry run, 3 refused, 4 provider unavailable, 5 real run
 * refused, 6 stopped mid-run), 1 when the plan check fails for a real run, the tool timed out or
 * its output is not JSON, 2 on a usage error.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_HEARTBEAT_MS, Lane } from "../../scripts/live/lane.js";
import {
  artifactsDir,
  defaultPlaceholderContext,
  insideGitWorkTree,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import {
  REDACT_ENV,
  UIA_DIR,
  pythonExe,
  redactionTable,
  runWalkerProcess,
  secondPass,
  type RedactionTable,
} from "./walk.js";

export const MENUS_SCRIPT = join(UIA_DIR, "menus.py");
export const SCRIPT_ID = "tools/uia/menus.ts";
export const MENU_ACTION_KIND = "uia-menu";
export const MENU_PLAN_VERDICT_ENV = "ENFUSION_UIA_MENU_PLAN_VERDICT";
/** Mirrors MAIN_MENU_TITLES in menus.py (a test compares the two); the list when no module is named. */
export const MAIN_MENU_TITLES = [
  "File",
  "Editors",
  "View",
  "Edit",
  "Window",
  "Utilities",
  "Plugins",
  "Help",
] as const;
export const AUTH_WINDOW_TITLE = "Script Authorization Required";
/** Per-menu allowance for the child timeout: settle twice plus reads. */
export const PER_MENU_MS = 10_000;
export const KILL_GRACE_MS = 15_000;

export interface MenuOptions {
  pid: number;
  className: string;
  title: string;
  menus: string[];
  /** The census module whose titles_by_module list applies (Phase 4); absent: MAIN_MENU_TITLES. */
  module?: string;
  /** That module's allow-list, read from the policy (`titlesFor`). */
  allowed?: readonly string[];
  depth: 0 | 1;
  allowForeground?: boolean;
  settleMs?: number;
  fakeTree?: string;
  really?: boolean;
  dryRun?: boolean;
}

/** `live_lane.uia_menu.titles_by_module[module]` of a policy, or null when it has none. */
export function titlesFor(policy: CensusPolicy, module: string): string[] | null {
  const block = policy.live_lane?.uia_menu as { titles_by_module?: unknown } | undefined;
  const by = block?.titles_by_module as Record<string, unknown> | undefined;
  if (!by || typeof by !== "object" || !Object.prototype.hasOwnProperty.call(by, module))
    return null;
  const list = by[module];
  if (!Array.isArray(list) || !list.every((t) => typeof t === "string" && t.trim())) return null;
  return [...(list as string[])];
}

export function validateMenuOptions(o: Partial<MenuOptions>): string | null {
  if (!Number.isInteger(o.pid) || (o.pid ?? 0) <= 0) return "--pid must be a positive integer";
  if (!o.className) return "--class is required (never a search by title alone)";
  if (!o.title) return "--title is required";
  try {
    new RegExp(o.title);
  } catch {
    return "--title does not compile as a regular expression";
  }
  if (!o.menus || o.menus.length === 0) return "--menus needs at least one title";
  if (o.module !== undefined && !o.allowed)
    return `--module ${o.module} has no titles_by_module list`;
  const allowed: readonly string[] = o.allowed ?? MAIN_MENU_TITLES;
  if (allowed.includes("System")) return "the allow-list may not name the System menu";
  const bad = o.menus.filter((m) => !allowed.includes(m));
  if (bad.length) return `--menus ${bad.join(", ")} not among ${allowed.join(", ")}`;
  if (new Set(o.menus).size !== o.menus.length) return "--menus names a title twice";
  if (o.depth !== 0 && o.depth !== 1) return "--depth must be 0 or 1";
  if (
    o.settleMs !== undefined &&
    (!Number.isInteger(o.settleMs) || o.settleMs < 0 || o.settleMs > 5000)
  ) {
    return "--settle-ms must be 0..5000";
  }
  return null;
}

/** The run's budget, checked against policy live_lane.uia_menu (perMenuMs, totalMs). */
export function menuTimeoutMs(o: Pick<MenuOptions, "menus" | "depth">): number {
  return o.menus.length * PER_MENU_MS * (o.depth === 1 ? 4 : 1);
}

export function buildMenuPlan(o: MenuOptions): PlanAction[] {
  return [
    {
      kind: MENU_ACTION_KIND,
      ...(o.module !== undefined ? { module: o.module } : {}),
      target: { window: { className: o.className, title: o.title } },
      pid: o.pid,
      menus: [...o.menus],
      depth: o.depth,
      calls: ["Expand", "Collapse"],
      allowForeground: Boolean(o.allowForeground),
      timeoutMs: menuTimeoutMs(o),
    },
  ];
}

export function menusArgv(o: MenuOptions, provider: "fake" | "uia"): string[] {
  const argv = ["-B", MENUS_SCRIPT, "--provider", provider];
  if (o.fakeTree) argv.push("--fake-tree", o.fakeTree);
  argv.push("--pid", String(o.pid), "--class", o.className, "--title", o.title);
  argv.push("--menus", o.menus.join(","), "--depth", String(o.depth));
  if (o.allowed) argv.push("--allowed", o.allowed.join(","));
  if (o.allowForeground) argv.push("--allow-foreground");
  if (o.settleMs !== undefined) argv.push("--settle-ms", String(o.settleMs));
  if (o.dryRun) argv.push("--dry-run");
  if (o.really) argv.push("--really");
  return argv;
}

export function menusFileName(label: string, now: Date = new Date()): string {
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48) || "menus";
  return `uia-menus-${safe}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

export interface MenuSummary {
  result: string | null;
  exit_code: number | null;
  out: string | null;
  opened: string[];
  collapsed: string[];
  leftOpen: string[][];
  second_pass_changed: boolean;
}

interface MenuDoc {
  result?: string;
  dry_run?: boolean;
  menus?: Array<{ title: string; opened?: boolean; collapsed?: boolean | null }>;
  leftOpen?: string[][];
}

export function summarize(
  doc: MenuDoc | null,
  code: number | null,
  out: string | null,
  changed: boolean,
): MenuSummary {
  return {
    result: doc ? (doc.dry_run ? "dry-run" : (doc.result ?? null)) : null,
    exit_code: code,
    out,
    opened: (doc?.menus ?? []).filter((m) => m.opened).map((m) => m.title),
    collapsed: (doc?.menus ?? []).filter((m) => m.collapsed).map((m) => m.title),
    leftOpen: doc?.leftOpen ?? [],
    second_pass_changed: changed,
  };
}

/** Run menus.py once, redact twice, write the artifact (when a document came back). */
export async function readMenus(opts: {
  options: MenuOptions;
  provider: "fake" | "uia";
  env: Record<string, string>;
  outPath: string;
  ctx: PlaceholderContext;
  table: RedactionTable;
  python?: string;
  heartbeat?: () => void;
}): Promise<{ summary: MenuSummary; text: string | null; stderr: string }> {
  const o = opts.options;
  const timeoutMs = menuTimeoutMs(o) + KILL_GRACE_MS;
  const run = await runWalkerProcess(
    menusArgv(o, opts.provider),
    opts.env,
    timeoutMs,
    opts.python ?? pythonExe(),
    opts.heartbeat ? { fn: opts.heartbeat, everyMs: DEFAULT_HEARTBEAT_MS } : undefined,
  );
  const stderr = secondPass(run.stderr, opts.ctx, opts.table).text;
  const line = run.stdout.trim().split(/\r?\n/).pop() ?? "";
  let doc: MenuDoc | null = null;
  try {
    doc = line ? (JSON.parse(line) as MenuDoc) : null;
  } catch {
    doc = null;
  }
  if (!doc || run.timedOut || run.aborted) {
    const why = run.timedOut ? "timed out" : run.aborted ? `aborted (${run.aborted})` : "no JSON";
    return {
      summary: summarize(null, run.code, null, false),
      text: null,
      stderr: `${stderr}\nmenus.py ${why}`.trim(),
    };
  }
  const pass = secondPass(JSON.stringify(doc, null, 1), opts.ctx, opts.table);
  let out: string | null = null;
  if (!doc.dry_run) {
    const dir = dirname(resolve(opts.outPath));
    if (insideGitWorkTree(dir)) {
      throw new Error(`refused: ${toPlaceholders(dir, opts.ctx)} is inside a git working tree`);
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(opts.outPath, pass.text, { encoding: "utf-8", flag: "wx" });
    out = toPlaceholders(opts.outPath, opts.ctx);
  }
  const redactedDoc = JSON.parse(pass.text) as MenuDoc;
  return {
    summary: summarize(redactedDoc, run.code, out, pass.changed),
    text: pass.text,
    stderr,
  };
}

const VALUED = [
  "pid",
  "class",
  "title",
  "menus",
  "module",
  "depth",
  "settle-ms",
  "fake-tree",
  "out",
  "label",
  "policy",
  "addons",
  "id",
  "lease-path",
  "marker-path",
] as const;

export async function main(argv: string[]): Promise<number> {
  const ctx = defaultPlaceholderContext();
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    console.error(toPlaceholders(e instanceof Error ? e.message : String(e), ctx));
    return 2;
  }
  const o = args.options;
  const policy = loadPolicy(o.policy);
  const allowed = o.module !== undefined ? titlesFor(policy, o.module) : undefined;
  const options: MenuOptions = {
    pid: o.pid ? Number(o.pid) : Number.NaN,
    className: o.class ?? "",
    title: o.title ?? "",
    menus: (o.menus ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ...(o.module !== undefined ? { module: o.module, allowed: allowed ?? undefined } : {}),
    depth: (o.depth === undefined ? 0 : Number(o.depth)) as 0 | 1,
    allowForeground: args.flags.has("allow-foreground"),
    settleMs: o["settle-ms"] !== undefined ? Number(o["settle-ms"]) : undefined,
    fakeTree: o["fake-tree"],
    really: args.flags.has("really") && !args.flags.has("dry-run"),
    dryRun: args.flags.has("dry-run"),
  };
  const err = validateMenuOptions(options);
  if (err) {
    console.error(err);
    return 2;
  }
  const table = redactionTable(ctx, o.addons, process.env);

  const plan = buildMenuPlan(options);
  const check = checkPlan(plan, policy, { script: SCRIPT_ID });
  console.log(
    `ACTION PLAN (scripts/live/dry-run.ts format): ${toPlaceholders(JSON.stringify(plan), ctx)}`,
  );
  console.log(`dry-run check: ${formatResult(check)}`);

  const provider: "fake" | "uia" = options.fakeTree ? "fake" : "uia";
  const env: Record<string, string> = { [REDACT_ENV]: JSON.stringify(table) };
  let lane: Lane | null = null;
  if (provider === "uia" && options.really) {
    if (!check.ok) {
      console.error(
        "refused: the uia-menu plan did not pass the dry-run checker; nothing is touched",
      );
      return 1;
    }
    lane = o.id
      ? new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] })
      : null;
    const gate = liveGateReason({
      really: true,
      platform: process.platform,
      leaseHeld: lane ? lane.holdsLease() : false,
    });
    if (gate !== null) {
      console.error(gate);
      return 1;
    }
    const recorded = lane!.recordedPid();
    if (recorded !== options.pid) {
      console.error(
        `refused: pid ${options.pid} is not the Workbench this lane recorded (${recorded === null ? "none recorded" : `pid ${recorded}`})`,
      );
      return 1;
    }
    env[MENU_PLAN_VERDICT_ENV] = "PASS";
  }
  const outPath =
    o.out ?? join(artifactsDir(), "uia", menusFileName(`${o.label ?? "menus"}-${provider}`));
  let done;
  try {
    done = await readMenus({
      options,
      provider,
      env,
      outPath,
      ctx,
      table,
      heartbeat: lane ? () => void lane!.heartbeat() : undefined,
    });
  } catch (e) {
    console.error(secondPass(e instanceof Error ? e.message : String(e), ctx, table).text);
    return 1;
  }
  if (done.stderr.trim()) console.error(done.stderr.trim());
  if (done.summary.result === "dry-run" && done.text)
    console.log(done.text.replace(/\s*\n\s*/g, " "));
  console.log(JSON.stringify(done.summary));
  if (done.text === null) return done.summary.exit_code ? done.summary.exit_code : 1;
  return done.summary.exit_code ?? 1;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
