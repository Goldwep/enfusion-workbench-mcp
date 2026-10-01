/**
 * Closed vocabularies of the coverage ledger (plan 4.3, 1.4, 4.7).
 *
 * These lists are the single source in code. The published contract is
 * `data/census/schema/*.schema.json`; `tests/census/schema-parity.test.ts`
 * asserts that every `enum` there equals the matching list here.
 */

/** Row dimensions (plan 4.3 `dim`). */
export const DIMS = [
  "ui",
  "api",
  "plugin",
  "net",
  "cli",
  "file",
  "schema",
  "setting",
  "link",
  "diag",
  "mcp",
] as const;
export type Dim = (typeof DIMS)[number];

/** Row kinds (plan 4.3 `kind`, closed vocabulary; 52 values). */
export const KINDS = [
  "module",
  "window",
  "menu",
  "menu-item",
  "toolbar",
  "toolbar-button",
  "dock",
  "panel",
  "tab",
  "dialog",
  "control",
  "property-group",
  "property",
  "property-editor",
  "context-menu",
  "context-item",
  "shortcut",
  "tool",
  "tool-button",
  "canvas-gesture",
  "region",
  "status-item",
  "hazard-dialog",
  "class",
  "method",
  "static-method",
  "event",
  "attribute",
  "enum",
  "enum-value",
  "plugin",
  "plugin-setting",
  "plugin-button",
  "plugin-cli-arg",
  "net-function",
  "net-handler",
  "net-field",
  "cli-switch",
  "link-format",
  "file-type",
  "resource-class",
  "schema-class",
  "schema-key",
  "setting-key",
  "option",
  "diag-menu",
  "diag-option",
  "blender-operator",
  "debug-panel",
  "mcp-tool",
  "mcp-action",
  "handler-action",
] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Modules (plan 4.3 `module`): the 11 `WBModuleDef` modules, the Resource
 * Manager sub-editors listed in plan 1.2, `Launcher`, `Shared`, `BlenderTools`
 * and `none`. The 11 module names and the sub-editor names are [recon] (plan
 * 1.2); a sub-editor the recon did not list needs a vocabulary change here.
 */
export const MODULES = [
  "WorldEditor",
  "ResourceManager",
  "ScriptEditor",
  "LocalizationEditor",
  "DialogueEditor",
  "AnimEditor",
  "ProcAnimEditor",
  "BehaviorEditor",
  "AudioEditor",
  "ParticleEditor",
  "NavmeshGeneratorMain",
  "ResourceManager.Config",
  "ResourceManager.Layout",
  "ResourceManager.Imageset",
  "ResourceManager.Model",
  "ResourceManager.Texture",
  "ResourceManager.Material",
  "ResourceManager.Font",
  "ResourceManager.Styles",
  "Launcher",
  "Shared",
  "BlenderTools",
  "none",
] as const;
export type Module = (typeof MODULES)[number];

/** Risk classes in ascending severity (policy.json `risk_classes` order). */
export const RISKS = ["safe", "mutating", "destructive", "credential", "external"] as const;
export type Risk = (typeof RISKS)[number];

/** Candidate automation paths in plan 4.7 precedence order (plan 4.3 `paths[]`). */
export const PATH_KINDS = [
  "net-api-handler",
  "builtin-net-handler",
  "execute-action",
  "plugin-run",
  "cli",
  "file-format",
  "gui-automation",
  "none-known",
] as const;
export type PathKind = (typeof PATH_KINDS)[number];

/** Status of a candidate path (plan 4.3). */
export const PATH_STATUSES = ["candidate", "verified", "refuted"] as const;
export type PathStatus = (typeof PATH_STATUSES)[number];

/** Source confidence, ascending. */
export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Modal behaviour (plan 4.3 `modal`). */
export const MODALS = ["none", "opens", "blocks"] as const;

/** Coverage tiers (plan 1.4). */
export const TIERS = ["T0", "T1", "T2", "T3", "T4", "T5"] as const;
export type Tier = (typeof TIERS)[number];

/** Row status (plan 4.3). `deferred` is a status, never a disposition (plan 1.4). */
export const STATUSES = ["active", "deferred"] as const;

/**
 * Terminal dispositions (plan 1.4). The reference part of `blocked`,
 * `duplicate-of` and `subsumed-by` is stored in `disposition.ref`.
 */
export const DISPOSITION_KINDS = [
  "excluded-policy",
  "not-automatable",
  "blocked",
  "absent-in-build",
  "duplicate-of",
  "subsumed-by",
] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

/** Dispositions whose reference part is required (plan 1.4). */
export const DISPOSITIONS_WITH_REFERENCE: readonly DispositionKind[] = [
  "blocked",
  "duplicate-of",
  "subsumed-by",
];

/** Dispositions batched for owner sign-off (plan 1.4). */
export const DISPOSITIONS_OWNER_SIGNOFF: readonly DispositionKind[] = [
  "excluded-policy",
  "not-automatable",
];

/** Where a row's target tier came from. */
export const TARGET_SOURCES = ["policy", "risk-override", "override"] as const;

/** MCP link roles: a `read` link supports T3, a `drive` link T4 (plan 1.4). */
export const MCP_ROLES = ["read", "drive"] as const;

/** Kinds of a `tests[]` entry on a row. */
export const TEST_KINDS = ["contract", "negative-safety", "corpus", "live"] as const;

/** Physical ledger shards (main ruling 3). */
export const SHARDS = ["core", "attribute", "schema", "diag"] as const;
export type Shard = (typeof SHARDS)[number];

/** E01 coverage reading of a recon row (plan 2.1). */
export const RECON_COVERAGES = ["covered", "partial", "none"] as const;

/** Tools branch (plan 4.3 `build`). */
export const BRANCHES = ["stable", "experimental"] as const;

/** Live-result verdicts. */
export const VERDICTS = ["pass", "fail", "skip"] as const;

/** Pass oracles, strongest first (plan 1.4; policy.json `pass_oracles`). */
export const ORACLES = ["state-readback", "file-diff", "log-line", "returned-true-only"] as const;

/** State-patch operations (main ruling 5). */
export const PATCH_OPS = ["set", "append", "clear"] as const;

/** Scripts allowed to write state patches (main ruling 5). */
export const PATCH_WRITERS = ["promote.ts", "dispose.ts"] as const;

/** Probe-log operations. */
export const PROBE_OPS = ["open", "outcome", "schedule"] as const;

/** Work item reference (main ruling 6). */
export const WORK_ITEM_PATTERN = /^(WI-\d+|U\d+|D\d+|P-[A-Za-z0-9-]+)$/;

/** Probe id. */
export const PROBE_ID_PATTERN = /^P-[A-Za-z0-9-]+$/;

/** Evidence id `EV-<session>-<seq>` (session grammar of scripts/live/evidence.ts). */
export const EVIDENCE_ID_PATTERN = /^EV-[A-Za-z0-9][A-Za-z0-9_.]*(?:-[A-Za-z0-9_.]+)*-\d{3,}$/;

/** Enumerator id: static `E01`..`E99` or live `L01`..`L99`. */
export const ENUMERATOR_ID_PATTERN = /^[EL]\d{2}$/;

/** `origin` (plan 4.3). */
export const ORIGIN_PATTERN = /^(vanilla|addon:[A-Za-z0-9_.-]+)$/;

/** Numeric index of a tier (`T3` -> 3). */
export function tierIndex(t: Tier): number {
  return TIERS.indexOf(t);
}

/** Numeric severity of a risk class. */
export function riskIndex(r: Risk): number {
  return RISKS.indexOf(r);
}
