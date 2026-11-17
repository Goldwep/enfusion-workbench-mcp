/**
 * Read-only view of the census safety policy, `data/census/policy.json`
 * (written by the main session only, plan 6.1). The harness reads the deny
 * lists (labels, APIs and command-line switches), the ExecuteAction
 * allow-list, the dry-run exceptions and the caps of a passive accessibility
 * read (`live_lane.uia_read`) from it and never writes it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./paths.js";

/** Default policy location. */
export const POLICY_PATH = join(REPO_ROOT, "data", "census", "policy.json");

export interface DryRunException {
  id: string;
  /** Script the exception belongs to, e.g. "scripts/live/modal-test.ts". */
  script?: string;
  /** The rule it lifts, e.g. "key-enter". */
  allows: string;
  target: { windowClassMatches?: string; titleMatches?: string };
  why?: string;
}

/** The parts of policy.json the harness reads. Other keys are ignored. */
export interface CensusPolicy {
  execute_action?: {
    /** Paths with a passing live result (DEC-100): the only list a shipped tool or handler reads. */
    allow_list?: Array<string | string[]>;
    /**
     * Paths with no live result yet (DEC-100): compiled into the development-only probe pack only,
     * run by a live battery under its explicit candidate override, never by a shipped tool.
     */
    candidates?: Array<string | string[]>;
    /** Paths a live run observed opening a dialog (DEC-100): never on allow_list or candidates. */
    dialog_openers?: Array<string | string[]>;
    deny_list_seed?: string[];
  };
  deny_lists?: Record<string, { labels?: string[]; api?: string[]; cli_switches?: string[] }>;
  dry_run?: {
    forbidden?: string[];
    exceptions?: DryRunException[];
  };
  live_lane?: {
    /** Caps on the bounds of a passive accessibility read (`uia-read`, tools/uia/walk.ts). */
    uia_read?: Record<string, unknown>;
    [extra: string]: unknown;
  };
}

/** Load and parse a policy file. */
export function loadPolicy(path: string = POLICY_PATH): CensusPolicy {
  return JSON.parse(readFileSync(path, "utf-8")) as CensusPolicy;
}

/** Every UI label on a deny list: the ExecuteAction seed plus every `deny_lists.*.labels`. */
export function deniedLabels(policy: CensusPolicy): string[] {
  const out = [...(policy.execute_action?.deny_list_seed ?? [])];
  for (const list of Object.values(policy.deny_lists ?? {})) {
    if (list && Array.isArray(list.labels)) out.push(...list.labels);
  }
  return [...new Set(out)];
}

/** API names the harness never sends: never-on-a-live-instance and development-only. */
export function deniedApiNames(policy: CensusPolicy): string[] {
  const lists = policy.deny_lists ?? {};
  return [
    ...(lists.never_called_on_live_instance?.api ?? []),
    ...(lists.development_only_never_shipped_enabled?.api ?? []),
  ];
}

/** Every command-line switch on a deny list (`deny_lists.*.cli_switches`), lower case. */
export function deniedSwitchNames(policy: CensusPolicy): string[] {
  const out = new Set<string>();
  for (const list of Object.values(policy.deny_lists ?? {})) {
    if (list && Array.isArray(list.cli_switches)) {
      for (const s of list.cli_switches) out.add(s.toLowerCase());
    }
  }
  return [...out];
}

/**
 * The first launch argument whose switch name is on a deny list, or null. The
 * switch name is the argument up to an `=`, compared without case, so
 * `-clearSettings` and `-CLEARSETTINGS=1` both match. Arguments that do not
 * start with `-` are values and are not switches.
 */
export function deniedSwitch(args: readonly string[], policy: CensusPolicy): string | null {
  const denied = new Set(deniedSwitchNames(policy));
  for (const a of args) {
    if (!a.startsWith("-")) continue;
    if (denied.has(a.split("=")[0].toLowerCase())) return a;
  }
  return null;
}

/**
 * The denied entry `apiFunc` matches, or null (case-insensitive). A dotted
 * entry such as "Workbench.Exit" matches only itself; a bare entry such as
 * "RunCommandline" matches itself and any "<Class>.RunCommandline".
 */
export function deniedApi(apiFunc: string, denied: string[]): string | null {
  const f = apiFunc.trim().toLowerCase();
  for (const d of denied) {
    const dl = d.toLowerCase();
    if (f === dl) return d;
    if (!dl.includes(".") && f.endsWith(`.${dl}`)) return d;
  }
  return null;
}
