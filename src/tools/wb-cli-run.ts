/**
 * `wb_cli_run` v2 — curated Workbench command-line runner (DEC-048 package B).
 *
 * What changed from 1.x:
 *
 *  - The allow-list of verbs and CLI plugins is DATA: it is read from
 *    `data/census/policy.json` under `cli_run.allow_list` (entries
 *    `verb:<name>` and `plugin:<Name>`). A verb or plugin that is not listed
 *    is refused with NOT_ALLOWLISTED before anything is spawned. A policy file
 *    without the key means an empty list: everything is refused.
 *  - The argv names the project with `-gproj` (DEC-047 L7), never with the
 *    switch KD-001 recorded, and never carries `-clearSettings`
 *    (`runWorkbench` refuses it again). Every run carries
 *    `-scriptAuthorizeAll` (the 2.0 release standard, owner ruling 2026-11-06).
 *  - Publish and pack verbs (`packAddon`, `publishAddon`) are PREPARED, never
 *    executed. They bypass the allow-list BY DESIGN (nothing is spawned, so a
 *    missing policy key still answers a prepared command line, ok:true).
 *  - A `-validate=<CFG>` run ends on the "Script validation successful." line
 *    (VALIDATE_SUCCESS_LINE) and only that run's own child process tree is
 *    killed (runWorkbench kills the spawned pid).
 *  - The module switch is part of the verb: buildScripts carries
 *    `-wbModule=ScriptEditor` before `-validate=`, a plugin run carries
 *    pluginModuleArg() before `-plugin=`. Without it Workbench starts, echoes
 *    the switches and never acts on them (2026-11-14, 1.9.0.37:
 *    docs/v2/inbox/phase7/cli-battery-1.9.md).
 *
 * Launch hardening kept from 1.x: the LaunchWatchdog restores a launcher held
 * at its Projects picker and posts Enter, a genuine block (picker, Missing
 * Addon Dependencies modal) fails fast with a diagnosis, and project targets
 * get the warn-only dependency GUID pre-flight.
 *
 * Waves W5 and W6 (DEC-068 OD-2, DEC-069 OD-13, phase5-w6-spec.md 2.5):
 *
 *  - `navmeshBake` is a probe-only verb: `-wbModule=WorldEditor -autogenerate
 *    <world> -saveDir <dir>` under a fixed 600 s watchdog that ends only the
 *    process this run started. Until `verb:navmeshBake` is in the allow-list
 *    (the integrator adds it after P-W5-01 passes) it answers GATED.
 *    `navmeshGenerate` keeps refusing MODULE_NOT_SUPPORTED on 1.9.
 *  - The CLI plugin candidates of W6 answer GATED until their `plugin:<Name>`
 *    entry is listed (after P-W6-08), and carry per-plugin path rules: paths
 *    to read stay inside the project, output folders lie under the artifacts
 *    folder, and the Resave plugins take the project itself as `addonPath` and
 *    are a dry run unless `confirm: true`. No run ever carries -forceSettings
 *    (DEC-053 L7). AddonBuildInfoTool is unchanged (DEC-037).
 *
 * Wave W7 (DEC-075 OD-9 and OD-5, phase5-w7-spec.md):
 *
 *  - `SCR_TerrainEntityVariantReplacementPlugin` answers GATED until its
 *    `plugin:` entry is listed (after P-W7-15). Its world (`tevrWorld`, an
 *    absolute .ent) lies inside the project, and it is a dry run unless
 *    `confirm: true`. Its argv follows the class's own CLI usage note:
 *    `-wbModule=WorldEditor` and `-exitAfterInit` with the `-plugin=` token.
 *  - OD-5's world gate: a confirmed run on a world that is not under the
 *    project's top-level `_throwaway/` folder refuses GATED unless policy.json
 *    `terrain_edit.any_world` is true (read here, never written).
 *  - Shore and flow maps have no CLI route (OD-8): `BuildShoreMap` and the flow
 *    map plugins stay off every list and answer NOT_ALLOWLISTED.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Config } from "../config.js";
import { DEFAULT_CENSUS_ROOT } from "../census/ledger-io.js";
import { defaultArtifactsDir } from "../census/source-index.js";
import {
  DEFAULT_TIMEOUT_MS,
  finishRun,
  runWorkbench,
  tailLines,
  headlessSpawnBlocker,
  assertNoRefusedSwitches,
} from "../workbench/cli-runner.js";
import { buildWorkbenchArgs } from "../workbench/client.js";
import { LaunchWatchdog } from "../workbench/launch-watchdog.js";
import { inspectProcessWindows, nudgeEnfusionLauncher } from "../workbench/launcher-nudge.js";
import { WorkbenchLaunchTracker, snapshotSessionDirs } from "../workbench/launch-tracker.js";
import {
  buildPreflightNote,
  buildStuckReport,
  buildTimeoutDiagnostics,
} from "../workbench/launch-reports.js";
import { checkWorkbenchVisibleDeps, type WbDepsCheck } from "../workbench/wb-deps.js";
import { VALIDATE_MODULE_ARG, ValidateRunTracker } from "./wb-validate-scripts.js";
import {
  ERROR_CODES,
  type ActionError,
  type ActionOk,
  type ErrorCode,
} from "../manifest/vocabulary.js";

// ── Verbs ─────────────────────────────────────────────────────────────────────

/** Verbs with a fixed argv template; each needs a `verb:<name>` entry in the allow-list. */
export const RUN_VERBS = [
  "openProject",
  "buildScripts",
  "navmeshGenerate",
  "forceSaveAll",
  "navmeshBake",
] as const;
export type RunVerb = (typeof RUN_VERBS)[number];

/** navmeshBake's watchdog: the run is ended (its own PID only) after 600 s (DEC-068 OD-2). */
export const NAVMESH_BAKE_TIMEOUT_S = 600;

/** A gate: the probe that must pass and the policy entry (the switch) that opens it. */
export interface Gate {
  probe: string;
  switch: string;
}

/** Verbs built ahead of their probe: GATED until the policy entry is listed. */
export const GATED_VERBS: Readonly<Record<string, Gate>> = {
  navmeshBake: {
    probe: "P-W5-01",
    switch: "policy.json cli_run.allow_list entry verb:navmeshBake",
  },
};

/** The W6 CLI plugin candidates (spec 2.5): GATED until P-W6-08 passes for the class and it is listed. */
export const GATED_PLUGINS: readonly string[] = [
  "SCR_PrefabValidatorPlugin",
  "SearchXOBPlugin",
  "ResourceTestPlugin",
  "WorldTestPlugin",
  "WorldDataExport",
  "ResourceProcessorPlugin",
  "ResavePlugin",
  "ResaveMetaPlugin",
];

/** The W7 terrain-variant plugin (DEC-075 OD-9): it rewrites a world's layers wholesale. */
export const TERRAIN_VARIANT_PLUGIN = "SCR_TerrainEntityVariantReplacementPlugin";

/** The W7 CLI plugin gates: GATED until their probe passes and the entry is listed. */
export const W7_PLUGIN_GATES: Readonly<Record<string, Gate>> = {
  [TERRAIN_VARIANT_PLUGIN]: {
    probe: "P-W7-15",
    switch: `policy.json cli_run.allow_list entry plugin:${TERRAIN_VARIANT_PLUGIN}`,
  },
};

/** The gate of a plugin candidate, or undefined for a plugin that is not one. */
export function pluginGate(name: string): Gate | undefined {
  if (GATED_PLUGINS.includes(name)) {
    return { probe: "P-W6-08", switch: `policy.json cli_run.allow_list entry plugin:${name}` };
  }
  return Object.hasOwn(W7_PLUGIN_GATES, name) ? W7_PLUGIN_GATES[name] : undefined;
}

/**
 * Plugins that rewrite project files: a dry run unless `confirm: true` (DEC-069 OD-13; the
 * terrain-variant plugin by DEC-075 OD-9).
 */
export const CONFIRM_PLUGINS: ReadonlySet<string> = new Set([
  "ResavePlugin",
  "ResaveMetaPlugin",
  TERRAIN_VARIANT_PLUGIN,
]);

/** OD-5's world gate: its switch, and the project folder a world may be under while it is shut. */
export const TERRAIN_ANY_WORLD_SWITCH = "policy.json terrain_edit.any_world true";
export const THROWAWAY_FOLDER = "_throwaway";

/**
 * True when `world` lies under the project's top-level `_throwaway/` folder (case-insensitive,
 * the handler's IsThrowaway rule in EMCP_WB_TerrainEdit.c). Pure.
 */
export function isThrowawayWorld(world: string, projectDir: string): boolean {
  const rel = relative(resolve(projectDir), resolve(world));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  const parts = rel.split(/[\\/]/);
  return parts.length > 1 && parts[0].toLowerCase() === THROWAWAY_FOLDER;
}

/**
 * The `-wbModule=` a `-plugin=` run needs: the plugin's RunCommandline is called
 * only by the module the command line opens. Without it 1.9.0.37 started, echoed
 * the switches and idled to the timeout (2026-11-14, cli-battery-1.9.md); with
 * `-wbModule=ResourceManager` AddonBuildInfoTool ran and exited 0 in 7.8 s.
 * The variant plugin reads its world through the World Editor (its own CLI usage
 * note, DEC-075 OD-9). Every other CLI plugin in the recon rows (plugins-netapi-cli.md)
 * is run from the ResourceManager; only AddonBuildInfoTool is measured.
 */
export function pluginModuleArg(name: string): string {
  return name === TERRAIN_VARIANT_PLUGIN ? "-wbModule=WorldEditor" : "-wbModule=ResourceManager";
}

/** Publish and pack verbs: prepared, never executed, whatever the allow-list says. */
export const PREPARE_ONLY_VERBS = ["packAddon", "publishAddon"] as const;
export type PrepareVerb = (typeof PREPARE_ONLY_VERBS)[number];

/** The plugin verb: `-plugin=<Name>` with arguments; each plugin needs a `plugin:<Name>` entry. */
export const PLUGIN_VERB = "plugin";

/** Verbs whose target is a .gproj — dependency pre-flight applies. */
const GPROJ_VERBS: ReadonlySet<string> = new Set(["openProject", "buildScripts", PLUGIN_VERB]);

/** Verbs whose `target` is an engine resource path (world or prefab), resolved against the project. */
const RESOURCE_VERBS: ReadonlySet<string> = new Set([
  "navmeshGenerate",
  "forceSaveAll",
  "navmeshBake",
]);

/** Default wall-clock budget in seconds — fits one MCP call (H11). */
export const DEFAULT_CLI_TIMEOUT_S = DEFAULT_TIMEOUT_MS / 1000;

// ── Policy ────────────────────────────────────────────────────────────────────

export interface CliPolicy {
  verbs: ReadonlySet<string>;
  plugins: ReadonlySet<string>;
  /** `cli_run.plugin_args`: the argument keys each plugin may receive; any other key is refused. */
  pluginArgs: ReadonlyMap<string, ReadonlySet<string>>;
  /** `terrain_edit.any_world` (DEC-075 OD-5): true only when the key is literally true. */
  terrainAnyWorld?: boolean;
  /** Where the list came from: the policy key, or why it is empty. */
  source: "policy.json:cli_run.allow_list" | "policy key absent" | "policy file unreadable";
}

/** Policy key this tool reads (proposed to main; see the hand-off). */
export const POLICY_KEY = "cli_run";
/** The policy key of OD-5's world gate (`terrain_edit.any_world`); read only, never written. */
export const TERRAIN_POLICY_KEY = "terrain_edit";

/**
 * Reads `cli_run.allow_list` from policy.json. Entries are strings
 * `verb:<name>` or `plugin:<Name>`; anything else is ignored. A missing file
 * or key gives an empty list (everything refused).
 */
export function loadCliPolicy(policyPath = join(DEFAULT_CENSUS_ROOT, "policy.json")): CliPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(policyPath, "utf-8"));
  } catch {
    return {
      verbs: new Set(),
      plugins: new Set(),
      pluginArgs: new Map(),
      source: "policy file unreadable",
    };
  }
  const list =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, { allow_list?: unknown } | undefined>)[POLICY_KEY]?.allow_list
      : undefined;
  const terrainAnyWorld =
    typeof raw === "object" &&
    raw !== null &&
    (raw as Record<string, { any_world?: unknown } | undefined>)[TERRAIN_POLICY_KEY]?.any_world ===
      true;
  if (!Array.isArray(list)) {
    return {
      verbs: new Set(),
      plugins: new Set(),
      pluginArgs: new Map(),
      terrainAnyWorld,
      source: "policy key absent",
    };
  }
  const verbs = new Set<string>();
  const plugins = new Set<string>();
  for (const e of list) {
    if (typeof e !== "string") continue;
    if (e.startsWith("verb:")) verbs.add(e.slice(5));
    else if (e.startsWith("plugin:")) plugins.add(e.slice(7));
  }
  const pluginArgs = new Map<string, ReadonlySet<string>>();
  const rawArgs = (raw as Record<string, { plugin_args?: unknown } | undefined>)[POLICY_KEY]
    ?.plugin_args;
  if (typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)) {
    for (const [name, keys] of Object.entries(rawArgs)) {
      if (Array.isArray(keys)) {
        pluginArgs.set(name, new Set(keys.filter((k): k is string => typeof k === "string")));
      }
    }
  }
  return { verbs, plugins, pluginArgs, terrainAnyWorld, source: "policy.json:cli_run.allow_list" };
}

// ── Argv ──────────────────────────────────────────────────────────────────────

/**
 * Reject anything a resource-path target must never carry: a leading
 * dash (flag smuggling, SEC-004), NUL, double quotes (engine tokenizer),
 * or a `..` segment (escapes the project's addon roots). Returns an error
 * string or null. Pure — exported for tests.
 */
/**
 * Whether this Workbench install still has the headless navmesh generator. The install's own
 * command-line page (`Workbench/docs/EnfusionScriptAPI/html/Page_CLI.html`) is the evidence: up to
 * 1.8 it has a NavmeshGeneratorMain section, from 1.9.0.37 on it has none, and there
 * `-wbModule=NavmeshGeneratorMain -run` starts an ordinary Workbench that never exits (seen
 * 2026-11-06). "unknown" when the page is not there to read.
 */
export function navmeshGeneratorPresence(workbenchPath: string): "present" | "absent" | "unknown" {
  const page = join(
    workbenchPath,
    "Workbench",
    "docs",
    "EnfusionScriptAPI",
    "html",
    "Page_CLI.html",
  );
  try {
    if (!existsSync(page)) return "unknown";
    return /NavmeshGeneratorMain/i.test(readFileSync(page, "utf-8")) ? "present" : "absent";
  } catch {
    return "unknown";
  }
}

export function validateResourceTarget(target: string): string | null {
  if (target.length === 0) return "Target must not be empty";
  if (target.startsWith("-")) return "Target may not start with '-' (looks like a CLI flag)";
  if (target.includes("\0")) return "Target may not contain NULL bytes";
  if (target.includes('"')) return "Target may not contain double quotes";
  if (target.split(/[\\/]/).includes("..")) return "Target may not contain '..' segments";
  return null;
}

/**
 * Switch names a plugin argument key may never take, lower case: every switch
 * this tool builds or refuses, plus the pack and publish families. A policy
 * entry naming one is ignored too.
 */
const KNOWN_SWITCH_KEYS: ReadonlySet<string> = new Set([
  "gproj",
  "wbmodule",
  "run",
  "load",
  "autogenerate",
  "forcesaveall",
  "validate",
  "plugin",
  "exitafterinit",
  "builddata",
  "forcesettings",
  "config",
  "uri",
  "nopause",
  "logcrc",
  "wbprojectpath",
  "clearsettings",
  "scriptauthorizeall",
]);

/** True for a key that is a known Workbench switch (including packAddon* and publishAddon*). */
export function isKnownSwitchKey(key: string): boolean {
  const k = key.replace(/^-+/, "").toLowerCase();
  return KNOWN_SWITCH_KEYS.has(k) || k.startsWith("packaddon") || k.startsWith("publishaddon");
}

/** Null when every key is allowed for the plugin; else the refusal message. */
export function checkPluginArgKeys(
  policy: CliPolicy,
  plugin: string,
  keys: readonly string[],
): string | null {
  const allowed = policy.pluginArgs.get(plugin);
  for (const k of keys) {
    if (isKnownSwitchKey(k)) return `plugin argument '${k}' is a Workbench switch`;
    if (!allowed?.has(k)) {
      return `plugin argument '${k}' is not allowed for ${plugin} (policy.json cli_run.plugin_args)`;
    }
  }
  return null;
}

// ── Per-plugin path rules (phase5-w6-spec.md 2.5) ─────────────────────────────

/** True when `child` is `parent` or lies under it (case-insensitive on Windows via path.relative). */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The project's `ID "<name>"` from its .gproj text (the `$<ID>:` file-system prefix), or null. */
export function readProjectId(gprojContent: string): string | null {
  const m = /^\s*ID\s+"([^"\r\n]+)"/m.exec(gprojContent);
  return m ? m[1] : null;
}

/** What a path rule needs to know about the run. */
export interface PathRuleContext {
  /** The folder of the .gproj. */
  projectDir: string;
  /** The project's ID, null when the .gproj does not carry one. */
  projectId: string | null;
  /** The artifacts folder output folders must lie under. */
  artifactsDir: string;
}

/** A refusal from a path rule. */
export interface RuleRefusal {
  code: "INVALID_ARGUMENT" | "NOT_IN_PROJECT";
  message: string;
}

const hasDotDot = (p: string) => p.split(/[\\/]/).includes("..");

/**
 * A `$<ID>:<path>` resource path of the project itself. Null when it is one;
 * else the refusal. The plugins that search by prefix (SearchResources root
 * path, ResourceProcessor's PathStartsWith) read this form.
 */
function checkProjectPrefixed(
  key: string,
  value: string,
  ctx: PathRuleContext,
): RuleRefusal | null {
  const m = /^\$([^:\\/]+):(.*)$/.exec(value);
  if (!m) {
    return {
      code: "INVALID_ARGUMENT",
      message: `${key} '${value}' must be a $<project ID>:<path> resource path`,
    };
  }
  if (ctx.projectId === null) {
    return {
      code: "INVALID_ARGUMENT",
      message: "the .gproj carries no ID to check the path against",
    };
  }
  if (m[1].toLowerCase() !== ctx.projectId.toLowerCase() || hasDotDot(m[2])) {
    return {
      code: "NOT_IN_PROJECT",
      message: `${key} '${value}' is not inside the project ($${ctx.projectId}:, no '..')`,
    };
  }
  return null;
}

/**
 * A world (or other resource) inside the project: `$<ID>:<path>`, an absolute
 * path under the project folder, or a project-relative path (with or without a
 * `{GUID}` prefix) that exists in the project folder.
 */
function checkProjectResource(
  key: string,
  value: string,
  ctx: PathRuleContext,
): RuleRefusal | null {
  if (value.startsWith("$")) return checkProjectPrefixed(key, value, ctx);
  if (hasDotDot(value)) {
    return { code: "NOT_IN_PROJECT", message: `${key} '${value}' may not contain '..' segments` };
  }
  if (isAbsolute(value)) {
    return isWithin(value, ctx.projectDir)
      ? null
      : { code: "NOT_IN_PROJECT", message: `${key} '${value}' is not inside the project folder` };
  }
  const rel = value.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (!existsSync(join(ctx.projectDir, rel))) {
    return {
      code: "NOT_IN_PROJECT",
      message: `${key} '${value}' is not a file of the project (looked for ${join(ctx.projectDir, rel)})`,
    };
  }
  return null;
}

/** An absolute output folder under the artifacts folder. */
function checkArtifactsDir(key: string, value: string, ctx: PathRuleContext): RuleRefusal | null {
  if (!isAbsolute(value) || hasDotDot(value) || !isWithin(value, ctx.artifactsDir)) {
    return {
      code: "INVALID_ARGUMENT",
      message: `${key} '${value}' must be an absolute folder under the artifacts folder (${ctx.artifactsDir})`,
    };
  }
  return null;
}

/**
 * An absolute .json file under the artifacts folder: the file a plugin writes
 * (AddonBuildInfoTool's `-ciInfoDst`). It replaces whatever is there, so it
 * may name nothing outside the artifacts folder (total audit live-client-03).
 */
function checkArtifactsJsonFile(
  key: string,
  value: string,
  ctx: PathRuleContext,
): RuleRefusal | null {
  if (
    !isAbsolute(value) ||
    hasDotDot(value) ||
    !/\.json$/i.test(value) ||
    relative(resolve(ctx.artifactsDir), resolve(value)) === "" ||
    !isWithin(value, ctx.artifactsDir)
  ) {
    return {
      code: "NOT_IN_PROJECT",
      message: `${key} '${value}' must be an absolute .json file under the artifacts folder (${ctx.artifactsDir})`,
    };
  }
  return null;
}

/** The project folder itself, as an absolute path. */
function checkProjectItself(key: string, value: string, ctx: PathRuleContext): RuleRefusal | null {
  if (!isAbsolute(value) || relative(resolve(ctx.projectDir), resolve(value)) !== "") {
    return {
      code: "NOT_IN_PROJECT",
      message: `${key} '${value}' must be the project folder itself (${ctx.projectDir}) as an absolute path`,
    };
  }
  return null;
}

/** A bare file extension (`et`, `.conf`). */
function checkExtension(key: string, value: string): RuleRefusal | null {
  return /^\.?[A-Za-z0-9]{1,16}$/.test(value)
    ? null
    : { code: "INVALID_ARGUMENT", message: `${key} '${value}' must be one bare file extension` };
}

/** An absolute .ent file inside the project folder that exists (`-tevrWorld`, DEC-075 OD-9). */
function checkProjectWorldFile(
  key: string,
  value: string,
  ctx: PathRuleContext,
): RuleRefusal | null {
  if (!isAbsolute(value) || !/\.ent$/i.test(value)) {
    return {
      code: "INVALID_ARGUMENT",
      message: `${key} '${value}' must be the absolute path of a .ent world file`,
    };
  }
  if (hasDotDot(value) || !isWithin(value, ctx.projectDir)) {
    return {
      code: "NOT_IN_PROJECT",
      message: `${key} '${value}' is not inside the project folder`,
    };
  }
  if (!existsSync(value)) {
    return { code: "NOT_IN_PROJECT", message: `${key} '${value}' is not a file of the project` };
  }
  return null;
}

/** A SCR_ETerrainEntityVariant value name (`autumn`): one bare identifier. */
function checkVariantName(key: string, value: string): RuleRefusal | null {
  return /^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value)
    ? null
    : { code: "INVALID_ARGUMENT", message: `${key} '${value}' must be one variant name` };
}

/**
 * The conversion config: a `{GUID}<path>.conf` resource name (read only, any addon), or a
 * `$<project ID>:<path>.conf` path of the project.
 */
function checkConfResource(key: string, value: string, ctx: PathRuleContext): RuleRefusal | null {
  if (!/\.conf$/i.test(value)) {
    return { code: "INVALID_ARGUMENT", message: `${key} '${value}' must name a .conf resource` };
  }
  if (value.startsWith("$")) return checkProjectPrefixed(key, value, ctx);
  if (!/^\{[0-9A-Fa-f]{16}\}[^\\:]+$/.test(value) || hasDotDot(value.slice(18))) {
    return {
      code: "INVALID_ARGUMENT",
      message: `${key} '${value}' must be a {GUID}<path>.conf resource name or a $<project ID>: path`,
    };
  }
  return null;
}

type Rule = (key: string, value: string, ctx: PathRuleContext) => RuleRefusal | null;

/** One argument rule: `required` refuses a run without the key; the key matches case-insensitively. */
interface ArgRule {
  key: string;
  required: boolean;
  check: Rule;
}

const commaList =
  (inner: Rule): Rule =>
  (key, value, ctx) => {
    const parts = value.split(",");
    if (parts.some((p) => p.length === 0)) {
      return { code: "INVALID_ARGUMENT", message: `${key} has an empty entry` };
    }
    for (const p of parts) {
      const r = inner(key, p, ctx);
      if (r) return r;
    }
    return null;
  };

/**
 * The path rules of the W6 candidates (spec 2.5) and of AddonBuildInfoTool
 * (live-client-03: it reads the addon at -addonPath and writes -ciInfoDst). A
 * plugin not named here (SearchXOBPlugin) has no path rule.
 */
export const PLUGIN_PATH_RULES: Readonly<Record<string, readonly ArgRule[]>> = {
  // DEC-037: both keys in one token each; the plugin exits with code 2 / 4 without them.
  AddonBuildInfoTool: [
    { key: "addonPath", required: true, check: checkProjectItself },
    { key: "ciInfoDst", required: true, check: checkArtifactsJsonFile },
  ],
  SCR_PrefabValidatorPlugin: [
    { key: "validatePaths", required: true, check: commaList(checkProjectPrefixed) },
  ],
  ResourceTestPlugin: [{ key: "autotest-output-dir", required: true, check: checkArtifactsDir }],
  WorldTestPlugin: [{ key: "world", required: true, check: checkProjectResource }],
  WorldDataExport: [{ key: "saveDir", required: true, check: checkArtifactsDir }],
  ResourceProcessorPlugin: [{ key: "PathStartsWith", required: true, check: checkProjectPrefixed }],
  ResavePlugin: [
    { key: "addonPath", required: true, check: checkProjectItself },
    { key: "extension", required: true, check: (k, v) => checkExtension(k, v) },
  ],
  ResaveMetaPlugin: [
    { key: "addonPath", required: true, check: checkProjectItself },
    { key: "extension", required: true, check: (k, v) => checkExtension(k, v) },
  ],
  // DEC-075 OD-9; the keys are the class's own CLI usage note (data/api/arma-classes.json).
  [TERRAIN_VARIANT_PLUGIN]: [
    { key: "tevrWorld", required: true, check: checkProjectWorldFile },
    { key: "tevrVariant", required: true, check: (k, v) => checkVariantName(k, v) },
    { key: "tevrConfig", required: true, check: checkConfResource },
  ],
};

/** The value of a plugin argument, its key matched case-insensitively. */
function pluginArg(args: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.entries(args).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
}

/** Null when the plugin's arguments pass its path rules; else the first refusal. Pure. */
export function checkPluginPaths(
  plugin: string,
  args: Readonly<Record<string, string>>,
  ctx: PathRuleContext,
): RuleRefusal | null {
  const rules = PLUGIN_PATH_RULES[plugin];
  if (!rules) return null;
  for (const rule of rules) {
    const entry = Object.entries(args).find(([k]) => k.toLowerCase() === rule.key.toLowerCase());
    if (!entry) {
      if (rule.required) {
        return {
          code: "INVALID_ARGUMENT",
          message: `${plugin} needs the argument ${rule.key}`,
        };
      }
      continue;
    }
    const r = rule.check(entry[0], entry[1], ctx);
    if (r) return r;
  }
  return null;
}

/** navmeshBake's save folder: absolute, inside the project or under the artifacts folder. */
export function checkBakeSaveDir(
  value: string | undefined,
  ctx: PathRuleContext,
): RuleRefusal | null {
  if (value === undefined || value.length === 0) {
    return { code: "INVALID_ARGUMENT", message: "navmeshBake needs save_dir (absolute folder)" };
  }
  if (value.startsWith("-") || /[\0"\s]/.test(value) || hasDotDot(value) || !isAbsolute(value)) {
    return {
      code: "INVALID_ARGUMENT",
      message: `save_dir '${value}' must be an absolute folder without '..', quotes or white space`,
    };
  }
  if (!isWithin(value, ctx.projectDir) && !isWithin(value, ctx.artifactsDir)) {
    return {
      code: "NOT_IN_PROJECT",
      message: `save_dir '${value}' must lie inside the project or under the artifacts folder`,
    };
  }
  return null;
}

/** A plugin argument key: a letter, then letters, digits, '_' or '-' (`autotest-output-dir`). */
const PLUGIN_ARG_KEY = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Throws when the argv carries -forceSettings: no tool run uses a scratch profile (DEC-053 L7).
 * DEC-053's reason, "headless runs stall under it", is refuted: the stall was the missing
 * -wbModule switch; validate and AddonBuildInfoTool passed with -forceSettings on 2026-11-14
 * (cli-battery-1.9.md). The refusal stays until main rules on it.
 */
export function assertNoForceSettings(args: readonly string[]): void {
  for (const a of args) {
    if (/^--?forcesettings(=|$)/i.test(a)) {
      throw new Error(`Refusing to pass '${a}': headless runs never carry -forceSettings`);
    }
  }
}

export interface PlanInput {
  gproj: string;
  /** Resource path for navmeshGenerate, forceSaveAll and navmeshBake. */
  target?: string;
  /** navmeshBake: the `-saveDir` folder. */
  saveDir?: string;
  /** buildScripts: the `-validate=<CFG>` configuration. */
  configuration?: string;
  plugin?: { name: string; args?: Record<string, string> };
}

/**
 * The argv of a verb: `-gproj <path>` first (DEC-047 L7, the path as its own
 * entry), then the verb's switches. Throws on a bad name or a flag-shaped
 * path (buildWorkbenchArgs).
 */
export function planFor(verb: RunVerb | typeof PLUGIN_VERB, input: PlanInput): string[] {
  const { gproj, target, configuration, plugin, saveDir } = input;
  switch (verb) {
    case "openProject":
      return buildWorkbenchArgs({ gproj, exitAfterInit: true });
    case "buildScripts": {
      // -validate acts only once the Script Editor opens (VALIDATE_MODULE_ARG; 2026-11-14).
      const argv = buildWorkbenchArgs({ gproj, validate: configuration ?? "PC" });
      const at = argv.findIndex((a) => a.startsWith("-validate="));
      argv.splice(at, 0, VALIDATE_MODULE_ARG);
      return argv;
    }
    case "plugin": {
      if (!plugin) throw new Error("plugin verb needs plugin.name");
      // The keys are joined here, not in buildWorkbenchArgs: its name rule has no
      // '-', and ResourceTestPlugin reads `-autotest-output-dir`.
      const variant = plugin.name === TERRAIN_VARIANT_PLUGIN;
      const argv = buildWorkbenchArgs({
        gproj,
        plugin: { name: plugin.name },
        ...(variant ? { exitAfterInit: true } : {}),
      });
      // -plugin= runs only in the module given by -wbModule (pluginModuleArg).
      argv.splice(argv.indexOf(`-plugin=${plugin.name}`), 0, pluginModuleArg(plugin.name));
      for (const [k, v] of Object.entries(plugin.args ?? {})) {
        if (!PLUGIN_ARG_KEY.test(k)) throw new Error(`Bad plugin argument name: ${k}`);
        argv.push(`-${k}=${v}`);
      }
      return argv;
    }
    case "navmeshBake":
      if (!target) throw new Error("navmeshBake needs a target");
      if (!saveDir) throw new Error("navmeshBake needs save_dir");
      return [
        ...buildWorkbenchArgs({ gproj }),
        "-wbModule=WorldEditor",
        "-autogenerate",
        target,
        "-saveDir",
        saveDir,
      ];
    case "navmeshGenerate":
      if (!target) throw new Error("navmeshGenerate needs a target");
      return [
        ...buildWorkbenchArgs({ gproj }),
        "-wbModule=NavmeshGeneratorMain",
        "-run",
        "-autogenerate",
        target,
      ];
    case "forceSaveAll":
      if (!target) throw new Error("forceSaveAll needs a target");
      return [
        ...buildWorkbenchArgs({ gproj }),
        "-wbModule=WorldEditor",
        "-run",
        "-load",
        target,
        "-forceSaveAll",
      ];
  }
}

/**
 * The command line a prepare-only verb WOULD use, for the owner to read and run
 * by hand. [unverified] The `-packAddon` / `-publishAddon` forms come from
 * Bohemia's CLI page (E08 rows); no run of ours has used them.
 */
export function prepareFor(verb: PrepareVerb, gproj: string): string[] {
  const flag = verb === "packAddon" ? "-packAddon" : "-publishAddon";
  return [...buildWorkbenchArgs({ gproj }), "-wbModule=ResourceManager", flag];
}

// ── Responses ─────────────────────────────────────────────────────────────────

type CliErrorCode = ErrorCode;
type Result = { content: { type: "text"; text: string }[]; isError?: true };
/** An error whose code may be RUN_FAILED (a run that ended without success; proposed for vocabulary.ts). */
type CliError = Omit<ActionError, "code"> & { code: ErrorCode | "RUN_FAILED"; readback?: unknown };

function respond(r: ActionOk | CliError): Result {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

function refuse(verb: string, target: string, code: CliErrorCode, message: string, next?: string) {
  const e: CliError = {
    ok: false,
    action: verb,
    target,
    code,
    message,
    next: next ?? ERROR_CODES[code],
    warnings: [],
  };
  return respond(e);
}

function notAllowlisted(verb: string, what: string, policy: CliPolicy) {
  return refuse(
    verb,
    "workbench:cli",
    "NOT_ALLOWLISTED",
    `${what} is not on the allow-list (${policy.source}); nothing was spawned`,
    "Ask the owner to add the entry to policy.json cli_run.allow_list.",
  );
}

function gated(verb: string, what: string, gate: Gate) {
  return refuse(
    verb,
    "workbench:cli",
    "GATED",
    `${what} waits for probe ${gate.probe}; it opens when ${gate.switch} is present; nothing was spawned`,
    `Run ${gate.probe}; on a pass the integrator adds the ${gate.switch}.`,
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

export interface CliRunOptions {
  /** Policy loader; defaults to {@link loadCliPolicy} on every call so an edited policy.json applies at once. */
  policy?: () => CliPolicy;
  /** The artifacts folder output folders must lie under; defaults to {@link defaultArtifactsDir}. */
  artifactsDir?: () => string;
}

export const WB_CLI_RUN_DESCRIPTION =
  "Run an allow-listed Workbench command line (policy.json cli_run; else NOT_ALLOWLISTED, or GATED until its probe). Verbs: " +
  `${[...RUN_VERBS, PLUGIN_VERB].join(", ")}; packAddon, publishAddon only prepared.\n` +
  "Mutating: spawns its own Workbench; paths stay in the project or artifacts folder; Resave plugins need confirm; never -forceSettings; kills only its own child.";

export function registerWbCliRun(
  server: McpServer,
  config: Config,
  options: CliRunOptions = {},
): void {
  const readPolicy = options.policy ?? (() => loadCliPolicy());
  const readArtifactsDir = options.artifactsDir ?? (() => defaultArtifactsDir());
  server.registerTool(
    "wb_cli_run",
    {
      description: WB_CLI_RUN_DESCRIPTION,
      inputSchema: {
        // An enum, not a free string: the verbs are the tool's actions
        // (E11 reads them as such; DEC-056 ruling 12).
        verb: z
          .enum([...RUN_VERBS, PLUGIN_VERB, ...PREPARE_ONLY_VERBS])
          .describe(`${[...RUN_VERBS, PLUGIN_VERB].join(" | ")} | packAddon | publishAddon`),
        gproj: z.string().describe("Path to the .gproj (must exist)"),
        target: z
          .string()
          .optional()
          .describe(
            "navmeshGenerate / forceSaveAll / navmeshBake: engine resource path (worlds/My.ent) or absolute; no '-' lead, no '..'",
          ),
        save_dir: z
          .string()
          .optional()
          .describe(
            "navmeshBake: absolute -saveDir folder, inside the project or under the artifacts folder",
          ),
        confirm: z
          .boolean()
          .optional()
          .describe(
            "ResavePlugin / ResaveMetaPlugin / SCR_TerrainEntityVariantReplacementPlugin: true runs (rewrites files); else a dry run",
          ),
        configuration: z
          .string()
          .default("PC")
          .describe("buildScripts: the -validate=<CFG> configuration"),
        plugin: z
          .object({ name: z.string(), args: z.record(z.string(), z.string()).optional() })
          .optional()
          .describe("plugin verb: -plugin=<name> and its -key=value arguments"),
        timeout_seconds: z
          .number()
          .min(10)
          .max(1800)
          .default(DEFAULT_CLI_TIMEOUT_S)
          .describe(
            `Wall-clock timeout, 10-1800 (default ${DEFAULT_CLI_TIMEOUT_S}); navmeshBake always uses ${NAVMESH_BAKE_TIMEOUT_S}`,
          ),
        launcher_nudge: z
          .boolean()
          .default(true)
          .describe("Auto-confirm the launcher's project picker (Windows)"),
      },
      annotations: {
        title: "Run Workbench command line",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      verb,
      gproj,
      target,
      save_dir,
      confirm,
      configuration,
      plugin,
      timeout_seconds,
      launcher_nudge,
    }) => {
      try {
        const policy = readPolicy();
        const isPrepare = (PREPARE_ONLY_VERBS as readonly string[]).includes(verb);
        const isPlugin = verb === PLUGIN_VERB;
        const isRun = (RUN_VERBS as readonly string[]).includes(verb);

        // 1. Allow-list first: nothing else is looked at for a refused verb. A verb or
        //    plugin built ahead of its probe answers GATED and names its switch.
        if (!isPrepare) {
          if (isPlugin) {
            if (!plugin) {
              return refuse(
                verb,
                "workbench:cli",
                "INVALID_ARGUMENT",
                "plugin verb needs plugin.name",
              );
            }
            if (!policy.plugins.has(plugin.name)) {
              const gate = pluginGate(plugin.name);
              return gate
                ? gated(verb, `plugin '${plugin.name}'`, gate)
                : notAllowlisted(verb, `plugin '${plugin.name}'`, policy);
            }
          } else if (!isRun || !policy.verbs.has(verb)) {
            const gate = GATED_VERBS[verb];
            return gate
              ? gated(verb, `verb '${verb}'`, gate)
              : notAllowlisted(verb, `verb '${verb}'`, policy);
          }
        }

        // 2. Project path.
        if (gproj.startsWith("-") || gproj.includes("\0") || gproj.includes('"')) {
          return refuse(
            verb,
            "workbench:cli",
            "INVALID_ARGUMENT",
            "gproj must not start with '-' or contain NUL or double quotes",
          );
        }
        const gprojFull = resolve(gproj);
        if (!gprojFull.toLowerCase().endsWith(".gproj")) {
          return refuse(verb, gprojFull, "INVALID_ARGUMENT", "gproj must be a .gproj file");
        }

        // 3. Prepare-only verbs stop here: the command line is shown, nothing runs.
        if (isPrepare) {
          const argv = prepareFor(verb as PrepareVerb, gprojFull);
          return respond({
            ok: true,
            action: verb,
            target: gprojFull,
            changed: null,
            readback: { prepared: true, executed: false, argv },
            next: "Nothing was run. Review the command line; the owner runs publish and pack by hand.",
            warnings: ["the command-line form is unverified (Bohemia's CLI page only)"],
          });
        }

        if (!existsSync(gprojFull)) {
          return refuse(verb, gprojFull, "PATH_NOT_FOUND", `.gproj not found: ${gprojFull}`);
        }

        // 4. Resource target.
        let resourceTarget: string | undefined;
        if (RESOURCE_VERBS.has(verb)) {
          const raw = target ?? "";
          const err = validateResourceTarget(raw);
          if (err !== null) {
            return refuse(verb, gprojFull, "INVALID_ARGUMENT", `${err} (got: ${raw})`);
          }
          resourceTarget = isAbsolute(raw) ? resolve(raw) : raw;
          if (isAbsolute(raw) && !existsSync(resourceTarget)) {
            return refuse(
              verb,
              resourceTarget,
              "PATH_NOT_FOUND",
              `Target not found: ${resourceTarget}`,
            );
          }
        }

        // 1.9 removed the navmesh generator module and its switch: started with it the
        // Workbench opens normally and never exits, so nothing is launched there.
        if (
          verb === "navmeshGenerate" &&
          navmeshGeneratorPresence(config.workbenchPath) === "absent"
        ) {
          return refuse(
            verb,
            gprojFull,
            "MODULE_NOT_SUPPORTED",
            "navmeshGenerate is not available on this Workbench: its command-line page no longer lists the NavmeshGeneratorMain module (removed in 1.9 together with -autogenerate); nothing was launched",
          );
        }

        // Path rules need the project folder, its ID and the artifacts folder.
        let ruleCtxCache: PathRuleContext | undefined;
        const ruleCtx = (): PathRuleContext =>
          (ruleCtxCache ??= {
            projectDir: dirname(gprojFull),
            projectId: readProjectId(readFileSync(gprojFull, "utf-8")),
            artifactsDir: readArtifactsDir(),
          });

        let saveDir: string | undefined;
        if (verb === "navmeshBake") {
          const r = checkBakeSaveDir(save_dir, ruleCtx());
          if (r) return refuse(verb, gprojFull, r.code, r.message);
          saveDir = resolve(save_dir as string);
        }

        // 5. Plugin argument keys (per-plugin allow-list) and values.
        if (isPlugin) {
          const keyErr = checkPluginArgKeys(
            policy,
            plugin?.name ?? "",
            Object.keys(plugin?.args ?? {}),
          );
          if (keyErr !== null) return refuse(verb, gprojFull, "INVALID_ARGUMENT", keyErr);
          for (const [k, v] of Object.entries(plugin?.args ?? {})) {
            // White space too: the engine cuts a `-key=value` token at the first
            // space and reads the rest as further switches (cli-runner.ts).
            if (v.includes("\0") || v.includes('"') || /\s/.test(v)) {
              return refuse(
                verb,
                gprojFull,
                "INVALID_ARGUMENT",
                `plugin argument '${k}' must not contain NUL, double quotes or white space`,
              );
            }
          }
          // Per-plugin path rules (spec 2.5).
          const pathErr = checkPluginPaths(plugin?.name ?? "", plugin?.args ?? {}, ruleCtx());
          if (pathErr !== null) return refuse(verb, gprojFull, pathErr.code, pathErr.message);
        }

        let args: string[];
        try {
          args = planFor(verb as RunVerb | typeof PLUGIN_VERB, {
            gproj: gprojFull,
            target: resourceTarget,
            saveDir,
            configuration,
            plugin,
          });
          assertNoRefusedSwitches(args);
          assertNoForceSettings(args);
        } catch (e) {
          return refuse(
            verb,
            gprojFull,
            "INVALID_ARGUMENT",
            e instanceof Error ? e.message : String(e),
          );
        }

        // OD-5's world gate (DEC-075): the variant plugin on a world outside the project's
        // _throwaway/ folder waits for terrain_edit.any_world. The dry run still answers.
        const worldGated =
          isPlugin &&
          plugin?.name === TERRAIN_VARIANT_PLUGIN &&
          policy.terrainAnyWorld !== true &&
          !isThrowawayWorld(pluginArg(plugin.args ?? {}, "tevrWorld") ?? "", dirname(gprojFull));
        const worldGateMessage = `a confirmed ${TERRAIN_VARIANT_PLUGIN} run on a world outside the project's ${THROWAWAY_FOLDER}/ folder waits for the owner (DEC-075 OD-5); it opens when ${TERRAIN_ANY_WORLD_SWITCH} is set`;

        // Plugins that rewrite project files run only with confirm (DEC-069 OD-13).
        if (isPlugin && CONFIRM_PLUGINS.has(plugin?.name ?? "") && confirm !== true) {
          return respond({
            ok: true,
            action: verb,
            target: gprojFull,
            changed: null,
            readback: { dryRun: true, executed: false, plugin: plugin?.name, argv: args },
            next: "Nothing was run. This plugin rewrites project files; repeat with confirm:true to run exactly this command line.",
            warnings: worldGated ? [worldGateMessage] : [],
          });
        }
        if (worldGated) {
          return refuse(
            verb,
            gprojFull,
            "GATED",
            `${worldGateMessage}; nothing was spawned`,
            `Run it on a world under ${THROWAWAY_FOLDER}/, or ask the owner to set ${TERRAIN_ANY_WORLD_SWITCH} (OI-W7-6).`,
          );
        }

        // Warn-only dependency pre-flight for project-targeted verbs.
        let depCheck: WbDepsCheck | null = null;
        let depCheckError: string | undefined;
        if (GPROJ_VERBS.has(verb)) {
          try {
            depCheck = checkWorkbenchVisibleDeps(gprojFull, config);
          } catch (e) {
            depCheckError = e instanceof Error ? e.message : String(e);
          }
        }

        const logsRoot = config.logsPath;
        const priorSessions = snapshotSessionDirs(logsRoot);
        // buildScripts is `-validate` under the hood: it never exits on its own,
        // so the script.log success line is the completion signal.
        const tracker =
          verb === "buildScripts"
            ? new ValidateRunTracker(logsRoot, priorSessions)
            : new WorkbenchLaunchTracker(logsRoot, priorSessions);
        if (launcher_nudge) {
          tracker.watchdog = new LaunchWatchdog({
            readConsoleLog: tracker.readConsoleLog,
            nudge: nudgeEnfusionLauncher,
            inspectWindows: inspectProcessWindows,
          });
        }

        const blocker = headlessSpawnBlocker(undefined, config);
        if (blocker) {
          return {
            content: [{ type: "text" as const, text: blocker }],
            isError: true as const,
          };
        }

        const result = await runWorkbench({
          workbenchPath: config.workbenchPath,
          gamePath: config.gamePath,
          args,
          // navmeshBake's watchdog is fixed (DEC-068 OD-2); runWorkbench ends only the PID it spawned.
          timeoutMs: (verb === "navmeshBake" ? NAVMESH_BAKE_TIMEOUT_S : timeout_seconds) * 1000,
          pollSignal: { intervalMs: 2000, check: tracker.check },
        });

        const consoleTail = tailLines(tracker.readConsoleLog(), 15);

        if (
          result.earlySignal === "stuck:launcher-picker" ||
          result.earlySignal === "stuck:missing-deps"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: buildStuckReport(result.earlySignal, {
                  toolLabel: `wb_cli_run (${verb})`,
                  gprojPath: gprojFull,
                  platform: verb === "buildScripts" ? configuration : undefined,
                  durationMs: result.durationMs,
                  sessionDir: tracker.sessionDir,
                  logsRoot,
                  watchdog: tracker.watchdog!,
                  consoleTail,
                  depCheck,
                  depCheckError,
                }),
              },
            ],
            isError: true as const,
          };
        }

        // Success is derived from evidence, not process state (H10).
        const outcome = finishRun(result);

        const notes: string[] = [];
        if (tracker.watchdog?.nudgeOutcome?.enterPosted) {
          notes.push("launcher project picker was auto-confirmed (window restored, Enter posted)");
        }
        const preflightNote = buildPreflightNote(depCheck);
        if (preflightNote && tracker.watchdog?.cliParamsSeen) notes.push(preflightNote);
        if (result.timedOut && result.earlySignal === null) {
          notes.push(
            ...buildTimeoutDiagnostics({
              watchdog: tracker.watchdog,
              consoleTail,
              depCheck,
              depCheckError,
            }),
          );
        }

        const readback = {
          verb,
          argv: args,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          verdict:
            result.earlySignal === "successful" || result.earlySignal === "failed"
              ? result.earlySignal
              : null,
          sessionDir: tracker.sessionDir ?? null,
          consoleTail: outcome.ok ? undefined : consoleTail,
          stdoutTail: tailLines(result.stdout, 30),
          stderrTail: result.stderr.trim().length > 0 ? tailLines(result.stderr, 10) : undefined,
        };
        if (outcome.ok) {
          return respond({
            ok: true,
            action: verb,
            target: gprojFull,
            changed: null,
            readback,
            warnings:
              verb === "buildScripts" && readback.verdict === "successful"
                ? [
                    ...notes,
                    "A passing -validate is not a handler compile gate: a broken file in the WorkbenchGame module can still pass (DEC-035, U14)",
                  ]
                : notes,
          });
        }
        return respond({
          ok: false,
          action: verb,
          target: gprojFull,
          code: "RUN_FAILED",
          message: outcome.reason ?? "run failed",
          next: "Read the readback tails and the log session; the run is never retried automatically.",
          warnings: notes,
          readback,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error running wb command: ${msg}` }],
          isError: true as const,
        };
      }
    },
  );
}
