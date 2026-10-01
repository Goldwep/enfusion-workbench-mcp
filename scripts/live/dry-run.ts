/**
 * The action-plan checker of the dry-run gate (plan 6.2, BATTERY-AUTHOR row):
 * every live script has a dry-run mode against a mocked NET and accessibility
 * layer that fails if it would issue an invoke on a menu leaf, an Enter or
 * accelerator key, or a deny-listed path. The only exceptions are named
 * entries in `policy.json` (`dry_run.exceptions`), written by the main session.
 *
 * An action plan is a JSON array of `{ kind, target, ... }`:
 *
 *   net-call        { kind, target: "<APIFunc>" | { apiFunc }, params? }
 *   menu-open       { kind, target: { path: [...labels], window? } }
 *   invoke          { kind, target: { path | automationId, window? }, dialog?, role? }
 *   key             { kind, keys: "Ctrl+S" | "Enter" | ..., target?: { window } }
 *   execute-action  { kind, target: { path: [...labels], module? } }
 *   screenshot      { kind, target? }
 *
 * Any action may name `exception: "<policy exception id>"`.
 *
 * Rules (the first four are the policy's `dry_run.forbidden` names):
 *   invoke-menu-leaf    an invoke or menu-open whose target resolves to a
 *                       MenuItem with no children
 *   key-enter           Enter in any spelling (Enter, Return, {ENTER}, ~, VK_RETURN)
 *   key-accelerator     an Alt or Ctrl combination, Alt or Ctrl alone, SendKeys
 *                       `%` or `^` prefixes, or F10 (activates the menu bar)
 *   deny-listed-path    an invoke or execute-action whose path or label is on a
 *                       deny list; `<dialog>:confirm` entries match an invoke
 *                       with `dialog` and `role: "confirm"`
 *   not-allow-listed    an execute-action whose path is not on
 *                       `execute_action.allow_list` (plan 5.3)
 *   deny-listed-api     a net-call to a never-on-a-live-instance or
 *                       development-only API
 *   unresolved-target   an invoke or menu-open whose target cannot be found in
 *                       the mocked accessibility tree (a leaf cannot be ruled out)
 *   unknown-kind        any kind not listed above
 *
 * An exception lifts exactly the rule it names (`allows`) for an action that
 * names it, only when the action's target window class and title equal the
 * exception's `target.windowClassMatches` and `target.titleMatches` exactly,
 * only for the script the exception names, and at most once per plan (the
 * modal test may post ONE Enter). Exact equality, not a pattern, is deliberate.
 *
 * Usage:
 *   npx tsx scripts/live/dry-run.ts <plan.json> [--uia <tree.json>] [--script <path>]
 *       [--policy <policy.json>]
 * Exit code 0 on pass, 1 on fail.
 */

import { readFileSync } from "node:fs";
import { isMainModule, parseArgs } from "./cli.js";
import { MockUia, isMenuLeaf, normalizeLabel, type UiaNode } from "./mock/uia.js";
import {
  deniedApi,
  deniedApiNames,
  deniedLabels,
  loadPolicy,
  type CensusPolicy,
  type DryRunException,
} from "./policy.js";

// ── Types ────────────────────────────────────────────────────────────────────

export const ACTION_KINDS = [
  "net-call",
  "menu-open",
  "invoke",
  "key",
  "execute-action",
  "screenshot",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface ActionWindow {
  className?: string;
  title?: string;
}

export interface ActionTarget {
  path?: string[] | string;
  automationId?: string;
  apiFunc?: string;
  module?: string;
  window?: ActionWindow;
}

export interface PlanAction {
  kind: string;
  target?: ActionTarget | string;
  keys?: string;
  key?: string;
  dialog?: string;
  role?: string;
  exception?: string;
  [extra: string]: unknown;
}

export type RuleId =
  | "invoke-menu-leaf"
  | "key-enter"
  | "key-accelerator"
  | "deny-listed-path"
  | "not-allow-listed"
  | "deny-listed-api"
  | "unresolved-target"
  | "unknown-kind";

export interface Violation {
  index: number;
  kind: string;
  rule: RuleId;
  detail: string;
}

export interface CheckOptions {
  /** Mocked accessibility tree the plan's targets resolve against. */
  uia?: UiaNode | MockUia;
  /** Repo-relative path of the script whose plan this is (for exceptions). */
  script?: string;
}

export interface CheckResult {
  ok: boolean;
  violations: Violation[];
  /** Exceptions applied, as `{ index, id, rule }`. */
  exceptionsUsed: Array<{ index: number; id: string; rule: RuleId }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function targetObject(action: PlanAction): ActionTarget {
  if (typeof action.target === "string") return { path: action.target };
  return action.target ?? {};
}

/** A path as a list of labels. Strings split on " > " or "/". */
export function pathOf(path: string[] | string | undefined): string[] {
  if (path === undefined) return [];
  if (Array.isArray(path)) return path;
  return path
    .split(/\s*>\s*|\//)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ENTER_TOKENS = new Set(["enter", "return", "{enter}", "~", "vk_return", "\n", "\r", "\r\n"]);
const MODIFIER_TOKENS = new Set([
  "alt",
  "lalt",
  "ralt",
  "altgr",
  "menu",
  "vk_menu",
  "ctrl",
  "control",
  "lctrl",
  "rctrl",
  "vk_control",
  "{alt}",
  "{ctrl}",
]);

/** Classify a key spec: "enter", "accelerator" or null (plain key). */
export function classifyKey(spec: string): "enter" | "accelerator" | null {
  const raw = spec.trim();
  const lower = raw.toLowerCase();
  if (ENTER_TOKENS.has(lower) || lower.includes("{enter}") || raw.includes("~")) return "enter";
  const tokens = lower.split(/\s*\+\s*/).filter(Boolean);
  if (tokens.some((t) => ENTER_TOKENS.has(t))) return "enter";
  if (tokens.some((t) => MODIFIER_TOKENS.has(t))) return "accelerator";
  // SendKeys notation: ^ is Ctrl, % is Alt.
  if (/[\^%]/.test(raw)) return "accelerator";
  if (tokens.includes("f10") || tokens.includes("{f10}")) return "accelerator";
  return null;
}

function resolveTarget(uia: MockUia | null, t: ActionTarget): UiaNode | null {
  if (!uia) return null;
  let scope: UiaNode = uia.root;
  if (t.window && (t.window.title !== undefined || t.window.className !== undefined)) {
    const w = uia.findWindow(t.window);
    if (!w) return null;
    scope = w;
  }
  if (t.automationId) return uia.findByAutomationId(t.automationId, scope);
  const path = pathOf(t.path);
  if (path.length === 0) return null;
  return uia.findByPath(path, scope);
}

function allowListed(path: string[], allow: Array<string | string[]>): boolean {
  const key = path.map(normalizeLabel).join("/");
  return allow.some((entry) => pathOf(entry).map(normalizeLabel).join("/") === key);
}

function exceptionApplies(
  ex: DryRunException,
  rule: RuleId,
  action: PlanAction,
  script: string | undefined,
): boolean {
  if (ex.allows !== rule) return false;
  if (ex.script !== undefined && ex.script !== script) return false;
  const w = targetObject(action).window;
  if (!w) return false;
  const wantClass = ex.target?.windowClassMatches;
  const wantTitle = ex.target?.titleMatches;
  if (wantClass === undefined && wantTitle === undefined) return false;
  if (wantClass !== undefined && w.className !== wantClass) return false;
  if (wantTitle !== undefined && w.title !== wantTitle) return false;
  return true;
}

// ── Checker ──────────────────────────────────────────────────────────────────

/** Rule violations of one action, before exceptions. */
function actionViolations(
  action: PlanAction,
  policy: CensusPolicy,
  uia: MockUia | null,
): Array<{ rule: RuleId; detail: string }> {
  const out: Array<{ rule: RuleId; detail: string }> = [];
  const t = targetObject(action);
  const denied = deniedLabels(policy).map((l) => [normalizeLabel(l), l] as const);
  const deniedHit = (labels: string[]): string | null => {
    for (const label of labels) {
      const n = normalizeLabel(label);
      const hit = denied.find(([d]) => d === n);
      if (hit) return hit[1];
    }
    return null;
  };

  switch (action.kind) {
    case "screenshot":
      break;
    case "net-call": {
      const apiFunc = typeof action.target === "string" ? action.target : (t.apiFunc ?? "");
      const hit = deniedApi(apiFunc, deniedApiNames(policy));
      if (hit) out.push({ rule: "deny-listed-api", detail: `${apiFunc} is denied (${hit})` });
      break;
    }
    case "key": {
      const spec = action.keys ?? action.key ?? "";
      const cls = classifyKey(spec);
      if (cls === "enter") out.push({ rule: "key-enter", detail: `key "${spec}" is Enter` });
      if (cls === "accelerator") {
        out.push({ rule: "key-accelerator", detail: `key "${spec}" is an accelerator` });
      }
      break;
    }
    case "menu-open":
    case "invoke": {
      const path = pathOf(t.path);
      if (action.kind === "invoke") {
        const labels = [...path];
        if (action.dialog && action.role === "confirm") labels.push(`${action.dialog}:confirm`);
        const hit = deniedHit(labels);
        if (hit) out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
      }
      const node = resolveTarget(uia, t);
      if (!node) {
        const what = t.automationId ? `automationId ${t.automationId}` : path.join(" > ");
        out.push({
          rule: "unresolved-target",
          detail: `target ${what || "(none)"} not found in the accessibility tree`,
        });
      } else {
        if (node.name && action.kind === "invoke") {
          const hit = deniedHit([node.name]);
          if (hit && !out.some((v) => v.rule === "deny-listed-path")) {
            out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
          }
        }
        if (isMenuLeaf(node)) {
          out.push({
            rule: "invoke-menu-leaf",
            detail: `"${node.name}" is a MenuItem with no children`,
          });
        }
      }
      break;
    }
    case "execute-action": {
      const path = pathOf(t.path);
      const hit = deniedHit(path);
      if (hit) out.push({ rule: "deny-listed-path", detail: `"${hit}" is on a deny list` });
      if (!allowListed(path, policy.execute_action?.allow_list ?? [])) {
        out.push({
          rule: "not-allow-listed",
          detail: `ExecuteAction path "${path.join(" > ")}" is not on execute_action.allow_list`,
        });
      }
      break;
    }
    default:
      out.push({ rule: "unknown-kind", detail: `unknown action kind "${action.kind}"` });
  }
  return out;
}

/**
 * Check an action plan against the policy. Fails on any violation that no
 * named exception lifts. Pure apart from reading nothing: the policy and the
 * accessibility tree are passed in.
 */
export function checkPlan(
  plan: PlanAction[],
  policy: CensusPolicy,
  opts: CheckOptions = {},
): CheckResult {
  if (!Array.isArray(plan)) throw new Error("An action plan must be a JSON array");
  const uia = opts.uia ? (opts.uia instanceof MockUia ? opts.uia : new MockUia(opts.uia)) : null;
  const exceptions = policy.dry_run?.exceptions ?? [];
  const used = new Set<string>();
  const result: CheckResult = { ok: true, violations: [], exceptionsUsed: [] };

  plan.forEach((action, index) => {
    const kind = action && typeof action.kind === "string" ? action.kind : String(action?.kind);
    for (const v of actionViolations(action ?? { kind }, policy, uia)) {
      const ex = action?.exception ? exceptions.find((e) => e.id === action.exception) : undefined;
      if (ex && !used.has(ex.id) && exceptionApplies(ex, v.rule, action, opts.script)) {
        used.add(ex.id);
        result.exceptionsUsed.push({ index, id: ex.id, rule: v.rule });
        continue;
      }
      result.violations.push({ index, kind, rule: v.rule, detail: v.detail });
    }
  });
  result.ok = result.violations.length === 0;
  return result;
}

/** Human-readable verdict. */
export function formatResult(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(
    r.ok ? "PASS" : `FAIL: ${r.violations.length} violation${r.violations.length !== 1 ? "s" : ""}`,
  );
  for (const v of r.violations)
    lines.push(`  action ${v.index} (${v.kind}): ${v.rule}: ${v.detail}`);
  for (const e of r.exceptionsUsed)
    lines.push(`  action ${e.index}: exception ${e.id} lifted ${e.rule}`);
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  try {
    const args = parseArgs(argv, ["uia", "script", "policy"]);
    const planPath = args.positional[0];
    if (!planPath) {
      console.error(
        "Usage: dry-run.ts <plan.json> [--uia <tree.json>] [--script <path>] [--policy <p>]",
      );
      return 2;
    }
    const plan = JSON.parse(readFileSync(planPath, "utf-8")) as PlanAction[];
    const policy = loadPolicy(args.options.policy);
    const uia = args.options.uia
      ? (JSON.parse(readFileSync(args.options.uia, "utf-8")) as UiaNode)
      : undefined;
    const r = checkPlan(plan, policy, { uia, script: args.options.script });
    console.log(formatResult(r));
    return r.ok ? 0 : 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
