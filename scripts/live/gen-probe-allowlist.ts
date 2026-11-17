/**
 * Generates the lists compiled into the two development-only probe packs
 * (plan 5.3 "ExecuteAction only with paths on the allow-list", 5.4 item 7:
 * the allow-list is compiled into the probe handler, not enforced by the
 * harness). Deterministic: the same policy gives the same bytes.
 *
 *   mod-dev/probe/ECEN_ProbeAllowList.c
 *       from `data/census/policy.json`: `execute_action.allow_list` (the menu
 *       paths `executeAction` may run), `execute_action.candidates` (DEC-100:
 *       paths with no live result yet, which `executeAction` runs only when the
 *       request says `candidate: true`; the shipped generator never compiles
 *       them), every deny-list label
 *       (`execute_action.deny_list_seed` plus `deny_lists.*.labels`), the
 *       refused menu words (`MENU_DENY_WORDS`) and
 *       `probe.diag_read_engine_ids` (entries `{ id, ledger_row }`, the engine
 *       diag options `diagRead` may read; absent today, so empty). A path one
 *       segment of which holds a deny-list label as a run of words, holds a
 *       refused word, or matches a credential or external risk-name rule for
 *       menu items is refused here (labels compared as the dry-run checker
 *       compares them: `normalizeLabel`), and the handler refuses the first
 *       two again at run time. A path on `execute_action.dialog_openers` (a
 *       live run saw it open a dialog, DEC-100) is refused on either list, and
 *       a candidate that is also on the allow-list is refused.
 *   mod-dev/probe-mut/ECEN_ProbeMutLists.c
 *       from `probe_mut.plugin_run_allow_list` (entries `{ module, class,
 *       ledger_row, evidence }`, the plugins `pluginRunDialogFree` may Run())
 *       and `probe_mut.diag_set_allow_list` (entries `{ key, ledger_row }`,
 *       key `script:<SCR_DebugMenuID value>` or `engine:<int id>`, the options
 *       `diagSet` may change). Both keys are absent from policy.json today, so
 *       both lists are empty and the handler refuses every plugin and option.
 *       A plugin class that matches a credential or external risk-name rule of
 *       the policy is refused.
 *
 * Allow-list entries are arrays of segments, or strings split the way the
 * dry-run checker splits them (`A > B` or `A/B`). The handler matches exactly
 * on every segment (no prefix, no case folding), so a segment with leading or
 * trailing white space, a line break, a double quote or a backslash is refused
 * rather than compiled. The generated text is never rewritten to placeholders:
 * a text that holds a home path or another value of the placeholder table is
 * refused (`assertNoPersonalData`), because a rewrite would change compiled
 * string literals.
 *
 * Usage:
 *   npx tsx scripts/live/gen-probe-allowlist.ts [--policy <policy.json>] [--check]
 *
 * Default: write both files. `--check`: write nothing; exit 1 when either file
 * differs from what the policy generates.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMainModule, parseArgs } from "./cli.js";
import { pathOf } from "./dry-run.js";
import { normalizeLabel } from "./mock/uia.js";
import {
  REPO_ROOT,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { POLICY_PATH, deniedLabels, loadPolicy, type CensusPolicy } from "./policy.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** The generated allow-list of the read-only pack. */
export const ALLOW_LIST_FILE = join(REPO_ROOT, "mod-dev", "probe", "ECEN_ProbeAllowList.c");
/** The generated lists of the mutating pack. */
export const MUT_LISTS_FILE = join(REPO_ROOT, "mod-dev", "probe-mut", "ECEN_ProbeMutLists.c");

/** The eleven module types of the Workbench API (children of WBModuleDef). */
export const MODULE_NAMES = [
  "AnimEditor",
  "AudioEditor",
  "BehaviorEditor",
  "DialogueEditor",
  "LocalizationEditor",
  "NavmeshGeneratorMain",
  "ParticleEditor",
  "ProcAnimEditor",
  "ResourceManager",
  "ScriptEditor",
  "WorldEditor",
] as const;

/** Used when the policy carries no credential or external risk-name rule. */
const FALLBACK_RISK_PATTERN =
  /(Login|login|Password|password|Credential|credential|Publish|publish|Upload|upload|Workshop|workshop)/;

/**
 * Words no allow-listed menu segment may hold (compared as whole words of the
 * normalised label, lower case). A menu item named with one of them saves,
 * closes, creates, removes, opens a file dialog, reaches outside the machine
 * or acts on whatever document is current, so it never belongs on the
 * executeAction allow-list of a read-only pack. Compiled into the handler too
 * (`ECEN_ProbeAllowList.DenyWords`), which refuses them again at run time.
 */
export const MENU_DENY_WORDS = [
  "apply",
  "build",
  "clear",
  "close",
  "commit",
  "copy",
  "create",
  "cut",
  "delete",
  "duplicate",
  "exit",
  "export",
  "generate",
  "import",
  "login",
  "logout",
  "move",
  "new",
  "open",
  "overwrite",
  "pack",
  "password",
  "paste",
  "play",
  "publish",
  "quit",
  "reload",
  "remove",
  "rename",
  "replace",
  "reset",
  "restart",
  "revert",
  "run",
  "save",
  "upload",
  "workshop",
] as const;

// ── Policy shape read here ───────────────────────────────────────────────────

export interface PluginRunEntry {
  module: string;
  class: string;
  ledger_row: string;
  evidence: string;
}

export interface DiagSetEntry {
  key: string;
  ledger_row: string;
}

export interface EngineDiagEntry {
  id: number;
  ledger_row: string;
}

/** The policy as this generator reads it; other keys are ignored. */
export interface ProbePolicy extends CensusPolicy {
  probe?: {
    diag_read_engine_ids?: EngineDiagEntry[];
  };
  probe_mut?: {
    plugin_run_allow_list?: PluginRunEntry[];
    diag_set_allow_list?: DiagSetEntry[];
  };
  row_defaults?: {
    risk_name_rules?: Array<{ kinds?: string[]; pattern?: string; risk?: string }>;
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

/** Why a segment or label cannot be compiled into an Enforce string literal, or null. */
function literalProblem(s: string): string | null {
  if (s === "") return "is empty";
  if (s !== s.trim()) return "has leading or trailing white space";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return "holds a control character";
  if (s.includes('"')) return "holds a double quote";
  if (s.includes("\\")) return "holds a backslash";
  return null;
}

/**
 * The words of a label as the deny check compares them: `normalizeLabel`,
 * then split on every character that is not a lower-case letter or a digit.
 * The handler's `ECEN_ProbeUtil.Words` does the same.
 */
export function labelWords(label: string): string[] {
  return normalizeLabel(label)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when the words of `label` occur in `words` as one contiguous run. */
function containsRun(words: string[], label: string[]): boolean {
  if (label.length === 0) return false;
  return ` ${words.join(" ")} `.includes(` ${label.join(" ")} `);
}

/** Risk-name patterns of the policy that mark a credential or external item of `kind`. */
function riskPatternsFor(policy: ProbePolicy, kind: string): RegExp[] {
  const rules = (policy.row_defaults?.risk_name_rules ?? []).filter(
    (r) =>
      (r.risk === "credential" || r.risk === "external") &&
      typeof r.pattern === "string" &&
      (r.kinds ?? []).includes(kind),
  );
  return rules.length > 0
    ? rules.map((r) => new RegExp(r.pattern as string))
    : [FALLBACK_RISK_PATTERN];
}

/**
 * Why a menu segment may not be allow-listed, or null. Refused: a segment
 * whose words hold the words of a deny-list label as a run ("Delete Selected"
 * holds "Delete"), a segment holding a word of `MENU_DENY_WORDS`, and a
 * segment matching a credential or external risk-name rule of the policy for
 * menu items.
 */
export function segmentProblem(
  seg: string,
  denyLabels: string[],
  menuRisk: RegExp[],
): string | null {
  const words = labelWords(seg);
  for (const d of denyLabels) {
    if (containsRun(words, labelWords(d))) return `holds the deny-list label ${JSON.stringify(d)}`;
  }
  const word = words.find((w) => (MENU_DENY_WORDS as readonly string[]).includes(w));
  if (word !== undefined) return `holds the refused word ${JSON.stringify(word)}`;
  const risky = menuRisk.find((p) => p.test(seg));
  if (risky) return `matches the risk-name rule ${risky}`;
  return null;
}

type MenuListKey = "allow_list" | "candidates" | "dialog_openers";

/** The segment arrays of one `execute_action` list, unvalidated beyond shape, in policy order. */
function rawPaths(policy: ProbePolicy, key: MenuListKey): Array<{ path: string[]; shown: string }> {
  const out: Array<{ path: string[]; shown: string }> = [];
  for (const raw of policy.execute_action?.[key] ?? []) {
    if (!Array.isArray(raw) && typeof raw !== "string") {
      throw new Error(
        `execute_action.${key} entry is neither an array nor a string: ${JSON.stringify(raw)}`,
      );
    }
    const path = pathOf(raw);
    const shown = JSON.stringify(raw);
    if (path.length === 0) throw new Error(`execute_action.${key} entry ${shown} has no segment`);
    for (const seg of path) {
      if (typeof seg !== "string")
        throw new Error(`execute_action.${key} entry ${shown} holds a non-string segment`);
    }
    out.push({ path: [...path], shown });
  }
  return out;
}

/**
 * The paths a live run observed opening a dialog (`execute_action.dialog_openers`, DEC-100), as
 * `\n`-joined keys. Such a path is never compiled into either list, whatever its label says.
 */
export function dialogOpenerKeys(policy: ProbePolicy): Set<string> {
  return new Set(rawPaths(policy, "dialog_openers").map((e) => e.path.join("\n")));
}

/**
 * One `execute_action` list as validated segment arrays, in policy order, duplicates dropped.
 * Throws on a malformed entry, one with a deny-listed segment, and one on `dialog_openers`.
 */
function menuListEntries(policy: ProbePolicy, key: "allow_list" | "candidates"): string[][] {
  const deny = deniedLabels(policy);
  const menuRisk = riskPatternsFor(policy, "menu-item");
  const openers = dialogOpenerKeys(policy);
  const label = key === "allow_list" ? "allow-list" : "candidate";
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const { path, shown } of rawPaths(policy, key)) {
    for (const seg of path) {
      const problem = literalProblem(seg);
      if (problem)
        throw new Error(`${label} entry ${shown}: segment ${JSON.stringify(seg)} ${problem}`);
      const refused = segmentProblem(seg, deny, menuRisk);
      if (refused) {
        throw new Error(
          `${label} entry ${shown}: segment ${JSON.stringify(seg)} ${refused}; refusing to compile it`,
        );
      }
    }
    const k = path.join("\n");
    if (openers.has(k)) {
      throw new Error(
        `${label} entry ${shown} is on execute_action.dialog_openers (a live run saw it open a dialog, DEC-100); refusing to compile it`,
      );
    }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(path);
  }
  return out;
}

/**
 * The allow-list as validated segment arrays, in policy order, duplicates
 * dropped. Throws on a malformed entry, one with a deny-listed segment, and
 * one a live run saw open a dialog (`execute_action.dialog_openers`).
 */
export function allowListEntries(policy: ProbePolicy): string[][] {
  return menuListEntries(policy, "allow_list");
}

/**
 * The candidates (`execute_action.candidates`, DEC-100: paths with no live result yet) as
 * validated segment arrays, checked like the allow-list. A candidate that is also on the
 * allow-list is refused: a path is proven or a candidate, never both. Compiled into the
 * development-only probe pack only, never into the shipped EMCP_WB_ActionAllowList.c.
 */
export function candidateEntries(policy: ProbePolicy): string[][] {
  const allowed = new Set(allowListEntries(policy).map((p) => p.join("\n")));
  const out = menuListEntries(policy, "candidates");
  for (const p of out) {
    if (allowed.has(p.join("\n"))) {
      throw new Error(
        `candidate entry ${JSON.stringify(p)} is also on execute_action.allow_list; a path is proven or a candidate, never both`,
      );
    }
  }
  return out;
}

/** Deny-list labels as compiled, in the order `deniedLabels` gives, each checked. */
export function denyLabelList(policy: ProbePolicy): string[] {
  const labels = deniedLabels(policy);
  for (const l of labels) {
    const problem = literalProblem(l);
    if (problem) throw new Error(`deny-list label ${JSON.stringify(l)} ${problem}`);
  }
  return labels;
}

/** Engine diag option ids `diagRead` may read, in policy order. Throws on a malformed entry. */
export function engineDiagIds(policy: ProbePolicy): number[] {
  const out: number[] = [];
  for (const e of policy.probe?.diag_read_engine_ids ?? []) {
    const shown = JSON.stringify(e);
    if (!e || typeof e !== "object" || !Number.isInteger(e.id) || e.id < 0 || e.id > 1_000_000) {
      throw new Error(
        `probe.diag_read_engine_ids entry ${shown}: id must be an integer in [0, 1000000]`,
      );
    }
    if (typeof e.ledger_row !== "string" || e.ledger_row.trim() === "") {
      throw new Error(`probe.diag_read_engine_ids entry ${shown}: ledger_row required`);
    }
    if (!out.includes(e.id)) out.push(e.id);
  }
  return out;
}

/** Plugin entries as `Module\nClass` keys. Throws on a malformed or risky entry. */
export function pluginRunKeys(policy: ProbePolicy): string[] {
  const patterns = riskPatternsFor(policy, "plugin");
  const out: string[] = [];
  for (const e of policy.probe_mut?.plugin_run_allow_list ?? []) {
    const shown = JSON.stringify(e);
    if (!e || typeof e !== "object")
      throw new Error(`plugin_run_allow_list entry is not an object: ${shown}`);
    if (!(MODULE_NAMES as readonly string[]).includes(e.module)) {
      throw new Error(
        `plugin_run_allow_list entry ${shown}: module must be one of ${MODULE_NAMES.join(", ")}`,
      );
    }
    if (typeof e.class !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.class)) {
      throw new Error(`plugin_run_allow_list entry ${shown}: class must be a script identifier`);
    }
    if (typeof e.ledger_row !== "string" || e.ledger_row.trim() === "") {
      throw new Error(`plugin_run_allow_list entry ${shown}: ledger_row required`);
    }
    if (typeof e.evidence !== "string" || e.evidence.trim() === "") {
      throw new Error(
        `plugin_run_allow_list entry ${shown}: evidence that Run() opens no dialog required`,
      );
    }
    const risky = patterns.find((p) => p.test(e.class));
    if (risky) {
      throw new Error(
        `plugin_run_allow_list entry ${shown}: class matches the risk-name rule ${risky}; refusing to compile it`,
      );
    }
    const key = `${e.module}\n${e.class}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** Diag option keys. Throws on a malformed entry. */
export function diagSetKeys(policy: ProbePolicy): string[] {
  const out: string[] = [];
  for (const e of policy.probe_mut?.diag_set_allow_list ?? []) {
    const shown = JSON.stringify(e);
    if (!e || typeof e !== "object" || typeof e.key !== "string") {
      throw new Error(`diag_set_allow_list entry has no key: ${shown}`);
    }
    if (!/^script:[A-Za-z_][A-Za-z0-9_]*$/.test(e.key) && !/^engine:[0-9]+$/.test(e.key)) {
      throw new Error(
        `diag_set_allow_list entry ${shown}: key must be script:<SCR_DebugMenuID value> or engine:<int id>`,
      );
    }
    if (typeof e.ledger_row !== "string" || e.ledger_row.trim() === "") {
      throw new Error(`diag_set_allow_list entry ${shown}: ledger_row required`);
    }
    if (!out.includes(e.key)) out.push(e.key);
  }
  return out;
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** An Enforce string literal; segments are joined with the escape `\n`. */
function lit(segments: string[]): string {
  return `"${segments.join("\\n")}"`;
}

function fillMethod(doc: string, name: string, param: string, values: string[][]): string[] {
  const lines = [
    `\t//! ${doc}`,
    `\tstatic void ${name}(notnull array<string> ${param})`,
    "\t{",
    `\t\t${param}.Clear();`,
  ];
  for (const v of values) lines.push(`\t\t${param}.Insert(${lit(v)});`);
  lines.push("\t}");
  return lines;
}

function intFillMethod(doc: string, name: string, param: string, values: number[]): string[] {
  const lines = [
    `\t//! ${doc}`,
    `\tstatic void ${name}(notnull array<int> ${param})`,
    "\t{",
    `\t\t${param}.Clear();`,
  ];
  for (const v of values) lines.push(`\t\t${param}.Insert(${v});`);
  lines.push("\t}");
  return lines;
}

function countMethod(doc: string, name: string, n: number): string[] {
  return [`\t//! ${doc}`, `\tstatic int ${name}()`, "\t{", `\t\treturn ${n};`, "\t}"];
}

/** The text of `ECEN_ProbeAllowList.c` for a policy. */
export function renderAllowList(policy: ProbePolicy): string {
  const paths = allowListEntries(policy);
  const candidates = candidateEntries(policy);
  const deny = denyLabelList(policy);
  const engineIds = engineDiagIds(policy);
  const lines = [
    "/**",
    " * ECEN_ProbeAllowList.c - GENERATED FILE, do not edit by hand.",
    " *",
    " * Generated by scripts/live/gen-probe-allowlist.ts from data/census/policy.json:",
    ' * execute_action.allow_list (menu paths executeAction may run, segments joined by "\\n"),',
    " * execute_action.candidates (DEC-100: paths with no live result yet, run only when the request",
    " * says candidate: true; never compiled into the shipped EMCP_WB_ActionAllowList.c), the",
    " * deny-list labels (execute_action.deny_list_seed and deny_lists.*.labels), the refused menu",
    " * words (MENU_DENY_WORDS of the generator) and probe.diag_read_engine_ids (the engine diag",
    " * options diagRead may read). Change the policy and regenerate (mod-dev/README.md).",
    " */",
    "",
    "class ECEN_ProbeAllowList",
    "{",
    ...countMethod("Number of allow-listed menu paths.", "Count", paths.length),
    "",
    ...fillMethod("Allow-listed menu paths, in policy order.", "Paths", "outPaths", paths),
    "",
    ...countMethod(
      "Number of candidate menu paths (DEC-100): a live battery's candidate override only.",
      "CandidateCount",
      candidates.length,
    ),
    "",
    ...fillMethod(
      "Candidate menu paths (DEC-100), in policy order: executeAction runs one only when the request says candidate: true.",
      "Candidates",
      "outPaths",
      candidates,
    ),
    "",
    ...fillMethod(
      "Deny-list labels: a menu path with a segment that holds one as a run of words is refused even when listed.",
      "DenyLabels",
      "outLabels",
      deny.map((d) => [d]),
    ),
    "",
    ...fillMethod(
      "Refused words: a menu path with a segment that holds one as a word is refused even when listed.",
      "DenyWords",
      "outWords",
      MENU_DENY_WORDS.map((w) => [w]),
    ),
    "",
    ...countMethod(
      "Number of engine diag options diagRead may read.",
      "EngineDiagCount",
      engineIds.length,
    ),
    "",
    ...intFillMethod(
      "Engine diag option ids diagRead may read, in policy order.",
      "EngineDiagIds",
      "outIds",
      engineIds,
    ),
    "}",
    "",
  ];
  return lines.join("\n");
}

/** The text of `ECEN_ProbeMutLists.c` for a policy. */
export function renderMutLists(policy: ProbePolicy): string {
  const plugins = pluginRunKeys(policy);
  const diags = diagSetKeys(policy);
  const lines = [
    "/**",
    " * ECEN_ProbeMutLists.c - GENERATED FILE, do not edit by hand.",
    " *",
    " * Generated by scripts/live/gen-probe-allowlist.ts from data/census/policy.json:",
    ' * probe_mut.plugin_run_allow_list (plugins pluginRunDialogFree may Run(), as "Module\\nClass")',
    ' * and probe_mut.diag_set_allow_list (options diagSet may change, as "script:<SCR_DebugMenuID',
    ' * value>" or "engine:<int id>"). Change the policy and regenerate (mod-dev/README.md).',
    " */",
    "",
    "class ECEN_ProbeMutLists",
    "{",
    ...countMethod("Number of plugins pluginRunDialogFree may run.", "PluginCount", plugins.length),
    "",
    ...fillMethod(
      'Plugins pluginRunDialogFree may run, as module and class joined by "\\n".',
      "Plugins",
      "outKeys",
      plugins.map((k) => k.split("\n")),
    ),
    "",
    ...countMethod("Number of diag options diagSet may change.", "DiagCount", diags.length),
    "",
    ...fillMethod(
      "Diag options diagSet may change.",
      "DiagKeys",
      "outKeys",
      diags.map((k) => [k]),
    ),
    "}",
    "",
  ];
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/**
 * Refuses a generated text that holds personal data. The text is compiled
 * into a handler, so it is never rewritten: a placeholder rewrite would change
 * a string literal (a deny label could stop matching, an allow-list entry
 * could change) without notice. A hit is an error to fix in the policy.
 */
export function assertNoPersonalData(
  file: string,
  text: string,
  ctx: PlaceholderContext = defaultPlaceholderContext(),
): string {
  if (toPlaceholders(text, ctx) !== text) {
    throw new Error(
      `${file}: the generated text holds a home path or another value the placeholder table rewrites; ` +
        "refusing to write compiled code that carries it (fix the policy entry)",
    );
  }
  return text;
}

/** The two generated files and their text for a policy file. */
export function generate(
  policyPath: string = POLICY_PATH,
  ctx: PlaceholderContext = defaultPlaceholderContext(),
): Array<{ file: string; text: string }> {
  const policy = loadPolicy(policyPath) as ProbePolicy;
  return [
    {
      file: ALLOW_LIST_FILE,
      text: assertNoPersonalData(ALLOW_LIST_FILE, renderAllowList(policy), ctx),
    },
    {
      file: MUT_LISTS_FILE,
      text: assertNoPersonalData(MUT_LISTS_FILE, renderMutLists(policy), ctx),
    },
  ];
}

export function main(argv: string[]): number {
  let args;
  try {
    args = parseArgs(argv, ["policy"]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const check = args.flags.has("check");
  try {
    const outputs = generate(args.options.policy ?? POLICY_PATH);
    let drift = 0;
    for (const o of outputs) {
      const rel = o.file.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
      const current = existsSync(o.file) ? readFileSync(o.file, "utf-8") : null;
      if (check) {
        if (current !== o.text) {
          console.log(`DRIFT ${rel}: differs from what the policy generates`);
          drift++;
        } else {
          console.log(`ok    ${rel}`);
        }
      } else if (current === o.text) {
        console.log(`unchanged ${rel}`);
      } else {
        writeFileSync(o.file, o.text, "utf-8");
        console.log(`wrote ${rel}`);
      }
    }
    return drift > 0 ? 1 : 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
