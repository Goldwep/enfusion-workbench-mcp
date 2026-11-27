/**
 * Wave W11 (engine accept), the live battery for docs/v2/inbox/phase7/write-safety-audit.md gaps 4
 * to 12: one live proof per offline writer and file type that the engine accepts a file the tool
 * wrote. Built in the form of tests/live/w10.live.ts and w9.live.ts: the same CLI, gate, lane,
 * build stamp, battery snapshot and net-zero check, the same evidence and live-result lines for
 * promote.ts, the same stop rules and the window watch with W8's busy grace (WATCH_OPTIONS).
 *
 * ONE STEP PER WRITER AND TYPE. Each writer step writes a throwaway file under _throwaway/W11/ with
 * the tool's OWN code path, run in process (the exported runner, or the registered MCP handler
 * captured by captureServer), and then asks Workbench to load it through read-only handlers:
 *   - container: `wb_resources register` (writes the .meta, under _throwaway/W11/ only), then
 *     `wb_container describe` on `path:` (summary, then pages), looking for the written value;
 *   - gproj: `wb_container describe` on `path:` without a register (W2 run 3: RegisterResourceFile
 *     answers false for a .gproj);
 *   - world: `wb_resources register` of the .ent, `wb_module setResource` in the World Editor, then
 *     `wb_layers list` and `wb_entity list` per layer;
 *   - script: `wb_script_editor open` and `getLines`, compared with the bytes on disk (opened, not
 *     compiled: a compile check needs the file under a module's Scripts folder, outside the
 *     throwaway folder, so it is excluded; see EXCLUDED).
 * The step records PASS with the engine's read, or FAIL with the engine's error. A writer that
 * fails offline is a FAIL of the writer, recorded apart from the engine. A missing fixture or a
 * refactor plan that would touch a file outside _throwaway/W11/ is NOT-RUN, and nothing is
 * committed. A live result names the writer's census row only on PASS.
 *
 * Nothing saves. No step sends a save, a close, a container set, a registry write or a dialog
 * opener; EXCLUDED lists the writers and checks left out for that reason (wb_terrain_edit first).
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch ini `<sitting>/scratch.ini` with `-scriptAuthorizeAll` (DEC-053 ruling 2), the shipped
 * bundle installed, no probe pack. This script never launches and never takes the lease.
 *
 * DRY RUN BY DEFAULT: without --really it prints the outline and checks the ACTION PLAN with
 * checkPlan, the battery's own plan check and the queue. The runbook is
 * docs/v2/sessions/W11-runbook.md; the noise list docs/v2/sessions/queues/w11-noise.json.
 *
 * Usage:
 *   npx --no tsx tests/live/w11.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w11.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w11.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w11.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: 0 done (or dry run passed), 1 refused / plan check failed / a step FAILED, 2 usage,
 *       3 stopped, 4 aborted (not the test bed), 5 handoff (a dialog; owner hand).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { loadConfig, type Config } from "../../src/config.js";
import { readCurrentBuild } from "../../src/gui/locators.js";
import { DEFAULT_CENSUS_ROOT } from "../../src/census/ledger-io.js";
import { runResources } from "../../src/tools/wb-resources.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runLayers } from "../../src/tools/wb-layers.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runScriptEditor } from "../../src/tools/wb-script-editor.js";
import { runConfigEdit, type ConfigEditArgs } from "../../src/tools/config-edit.js";
import { runProcAnim, type ProcAnimRequest } from "../../src/tools/procanim.js";
import {
  runAnimationWorkspace,
  type WorkspaceRequest,
} from "../../src/tools/animation-workspace.js";
import { registerScenarioCreate } from "../../src/tools/scenario-create.js";
import { registerScenarioApplyTemplate } from "../../src/tools/scenario-apply-template.js";
import { registerScenarioCloneArea } from "../../src/tools/scenario-clone-area.js";
import { registerPrefab } from "../../src/tools/prefab.js";
import { registerLayoutCreate } from "../../src/tools/layout-create.js";
import { registerConfigCreate } from "../../src/tools/config-create.js";
import { registerFactionCreate } from "../../src/tools/faction-create.js";
import { registerBuildingSetup } from "../../src/tools/building-setup.js";
import { registerMod } from "../../src/tools/mod.js";
import { PatternLibrary } from "../../src/patterns/loader.js";
import { registerProject } from "../../src/tools/project.js";
import { registerGameDuplicate } from "../../src/tools/game-duplicate.js";
import { registerWbEntityDuplicate } from "../../src/tools/wb-entity-duplicate.js";
import { registerScriptCreate } from "../../src/tools/script-create.js";
import {
  buildPlan as replaceGuidPlan,
  registerRefactorReplaceGuid,
} from "../../src/tools/refactor-replace-guid.js";
import {
  buildPlan as movePathPlan,
  registerRefactorMoveResourcePath,
} from "../../src/tools/refactor-move-resource-path.js";
import { registerRefactorRenameProjectId } from "../../src/tools/refactor-rename-project-id.js";
import { registerRefactorNormalizeDependencies } from "../../src/tools/refactor-normalize-dependencies.js";
import { registerScriptFormat } from "../../src/tools/script-format.js";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import { crawl } from "../../src/project-index/crawler.js";
import { isMainModule, liveGateReason, parseArgs } from "../../scripts/live/cli.js";
import { UPDATE_BASELINE_FLAG, applyBaselineGuard } from "./baseline.js";
import { checkPlan, formatResult, type PlanAction } from "../../scripts/live/dry-run.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "../../scripts/live/evidence.js";
import { Lane } from "../../scripts/live/lane.js";
import { DEFAULT_PORT } from "../../scripts/live/netcall.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "../../scripts/live/paths.js";
import { loadPolicy, type CensusPolicy } from "../../scripts/live/policy.js";
import { lastLine, runPowerShell } from "../../scripts/live/powershell.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../scripts/live/s-c-natives.js";
import { WORKBENCH_EXE } from "../../scripts/live/launch.js";
import { defaultExec, processesByImage } from "../../scripts/live/win.js";
import {
  EXIT,
  StepCut,
  StopBattery,
  baselineRefusal,
  watched,
} from "../../scripts/census/live/common.js";
import { changedFiles, recordPath } from "./w2.live.js";
import {
  WATCH_OPTIONS,
  WORKBENCH_WINDOWS,
  captureServer,
  carriesForceSettings,
  responseOf,
} from "./w8.live.js";
import {
  GPROJ,
  LAUNCH_ARGS,
  SCRATCH_INI,
  STOP_CODES,
  THROWAWAY,
  handAnswer,
  resultTable,
  selectSteps,
  verdictOf,
} from "./w9.live.js";

export { EXIT, LAUNCH_ARGS, StopBattery, recordPath, selectSteps };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W11";
export const SCRIPT_PATH = "tests/live/w11.live.ts";
export const RUNBOOK = "docs/v2/sessions/W11-runbook.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W11-queue.json";
export const NOISE_REL = "docs/v2/sessions/queues/w11-noise.json";
export const AUDIT_REL = "docs/v2/inbox/phase7/write-safety-audit.md";

export const GATE_STEP = "w11-00-gate";
export const NETZERO_STEP = "w11-95-netzero";
export const CLOSABLE_STEP = "w11-99-closable";

export const W11_ROOT = `${THROWAWAY}/W11`;
export const CONFIG_DIR = `${W11_ROOT}/config`;
export const PROCANIM_DIR = `${W11_ROOT}/procanim`;
export const ANIM_DIR = `${W11_ROOT}/anim`;
export const REFACTOR_DIR = `${W11_ROOT}/refactor`;
export const SCENARIO_DIR = `${W11_ROOT}/scenario`;
export const CREATE_DIR = `${W11_ROOT}/create`;
export const GPROJ_DIR = `${W11_ROOT}/gproj`;
export const SCRIPT_DIR = `${W11_ROOT}/script`;
export const PLANT_DIRS: readonly string[] = [
  W11_ROOT,
  CONFIG_DIR,
  PROCANIM_DIR,
  ANIM_DIR,
  REFACTOR_DIR,
  SCENARIO_DIR,
  CREATE_DIR,
  GPROJ_DIR,
  SCRIPT_DIR,
];
export const PLANT_FILE = "plant-w11.json";
export const RESULT_FILE = "w11-result.json";
export const BATTERY_SNAPSHOT_FILE = "w11-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w11-battery-snapshot";
/** Files whose change outside _throwaway/W11/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** Describe pages read per file (200 rows each). */
export const ACCEPT_PAGES = 5;
export const PAGE_FIELDS = "path,name,type,value";

export const TIMEOUTS = {
  writer: 180_000,
  open: 600_000,
  poll: 5_000,
  ping: 10_000,
} as const;

/** The config_edit types of gap 4 and the vanilla file each copy is planted from (verified in the 1.9.0.37 paks). */
export const CONFIG_CASES: ReadonlyArray<{ ext: string; rel: string; from: string }> = [
  {
    ext: ".emat",
    rel: `${CONFIG_DIR}/W11_mat.emat`,
    from: "Assets/Vegetation/Tree/Pinus_Sylvestris/Dst/Data/t_pinus_sylvestris_02_Hero_3s_polyplane_dst.emat",
  },
  {
    ext: ".gamemat",
    rel: `${CONFIG_DIR}/W11_game.gamemat`,
    from: "Common/Materials/Game/Tree/tree_picea_abies.gamemat",
  },
  {
    ext: ".physmat",
    rel: `${CONFIG_DIR}/W11_phys.physmat`,
    from: "Common/Materials/Physics/aramid.physmat",
  },
  {
    ext: ".vhcsurf",
    rel: `${CONFIG_DIR}/W11_surf.vhcsurf`,
    from: "Common/Materials/Vehicles/asphalt_rugged.vhcsurf",
  },
  { ext: ".styles", rel: `${CONFIG_DIR}/W11_editor.styles`, from: "UI/Styles/editor.styles" },
];

export const VANILLA_PHYSMAT = "Common/Materials/Physics/aramid.physmat";
export const SIGA_SOURCE = "anims/proc/wheel_rot.siga";
export const SIGA = `${PROCANIM_DIR}/W11_wheel_rot.siga`;
/** The node move on the .siga copy: node 1 ("rotation" input), to a position no vanilla node has. */
export const SIGA_MOVE = { node: "1", x: 31.5, y: -4.25 } as const;
/**
 * The scalar edit on the same node (W11 run 5: the moved `tl` is a VECTOR2 row, which the describe
 * and get answer no value for): `valueMax` is a SCALAR (360 in the vanilla file), so the engine's
 * read of the edited .siga can be seen. 357.25 is exact in binary, so its ToString is the needle.
 */
export const SIGA_SET = { node: "1", key: "valueMax", value: 357.25, path: "Inputs[0].valueMax" } as const;
/**
 * The moved position as the read path answers a VECTOR2 since the W11 run 6 handler change
 * (EMCP_WB_Container.ReadValueText: "x y", each component's ToString; 31.5 and -4.25 are exact in
 * binary), and the container path get reads it on.
 */
export const SIGA_TL = { path: "Inputs[0].tl", needle: `${SIGA_MOVE.x} ${SIGA_MOVE.y}` } as const;

export const AW_CREATE = `${ANIM_DIR}/ae/W11_new.aw`;
export const AE_CREATED = `${ANIM_DIR}/ae/W11_new_EventTable.ae`;
/**
 * The vanilla .ae controls, planted byte for byte: the only two .ae files in the 1.9.0.37 paks
 * (PakVirtualFS listing, 2026-11-14). ak_type.ae (18 bytes) is byte-identical to the table
 * animation_workspace create writes; player_EventTable.ae (239 bytes) is an AnimEventTable.
 */
export const AE_CONTROLS: ReadonlyArray<{ rel: string; from: string }> = [
  { rel: `${ANIM_DIR}/control/W11_ctl_ak_type.ae`, from: "Assets/Weapons/Rifles/AK74/ak_type.ae" },
  { rel: `${ANIM_DIR}/control/W11_ctl_player_EventTable.ae`, from: "anims/workspaces/player/player_EventTable.ae" },
];
export const AW_AEX_SOURCE = "anims/workspaces/generic/ammobelt/ammo_D60T.aw";
export const AW_AEX_TARGET = `${ANIM_DIR}/aex/W11_ammo.aw`;
export const AW_ASY_SOURCE = "Assets/Items/Fuel/workspaces/Jerrycan.aw";
export const AW_ASY_TARGET = `${ANIM_DIR}/asy/W11_jerrycan.aw`;

export const REF_PARENT = `${REFACTOR_DIR}/W11_parent.physmat`;
export const REF_CHILD = `${REFACTOR_DIR}/W11_child.physmat`;
export const REF_CHILD_FRICTION = 0.55;
/**
 * The file that references the parent's GUID for refactor_replace_guid, written by the battery once
 * the parent is registered. The project index scans only SCANNABLE_EXTENSIONS
 * (src/project-index/resource-scan.ts:31), which leave out .physmat, so the createInherited child is
 * never a plan candidate (run 2: 0 files); a .conf is scanned and its `{GUID}path` value indexed.
 */
export const REF_CONF = `${REFACTOR_DIR}/W11_ref.conf`;
/**
 * The move source: a generated .et. refactor_move_resource_path needs a `resources` row at the
 * path, and the index takes a resource GUID only from the file's root (id, GUID or ID property,
 * resource-scan.ts:343), never from the .meta; a .physmat has neither (run 2: "No resource indexed").
 */
export const MOVE_SOURCE = `${REFACTOR_DIR}/W11_move.et`;
export const MOVE_TARGET = `${REFACTOR_DIR}/moved/W11_moved.et`;
export const MOVE_FIXTURE_ID = "57110000C0FFEE01";
export const MOVE_FIXTURE = `GenericEntity {\n ID "${MOVE_FIXTURE_ID}"\n}\n`;

export const SCEN_A = { dir: `${SCENARIO_DIR}/a`, name: "W11_ConflictA" } as const;
export const SCEN_B = { dir: `${SCENARIO_DIR}/b`, name: "W11_ConflictB" } as const;
export const SCENARIO_WORLD = "arland";
export const SCENARIO_BASES: ReadonlyArray<Record<string, unknown>> = [
  { name: "W11_MOB_US", position: "1500 0 2500", faction: "US", type: "MOB" },
  { name: "W11_MOB_USSR", position: "3500 0 2500", faction: "USSR", type: "MOB" },
  { name: "W11_BaseA", position: "2000 0 2000", faction: "FIA", type: "base" },
  { name: "W11_BaseB", position: "3000 0 3000", faction: "FIA", type: "base" },
];
export const TEMPLATE_NAME = "checkpoint";
export const TEMPLATE_POSITION = { x: 2500, y: 0, z: 2500 } as const;
export const CLONE_AREA = { minX: 1900, minZ: 1900, maxX: 2100, maxZ: 2100 } as const;
export const CLONE_TRANSLATE = { x: 50, z: 50 } as const;
export const CLONE_LAYER = "W11_Clone.layer";

export const GAME_DUP_SOURCE = "Prefabs/Structures/Core/ProbeVolume_Base.et";
/** A vanilla .conf for game_duplicate's .conf copy: one RESOURCE_NAME (NavmeshFile), which describe reads (EV-W5-102). */
export const GAME_DUP_CONF_SOURCE = "Configs/Navmesh/Navmesh_GM_Arland_Soldier.conf";
/** mod create's pattern case: game-mode writes two .c scripts and one SCR_MissionHeader .conf. */
export const MOD_PATTERN = "game-mode";
export const MOD_PATTERN_PREFIX = "W11GM";
export const FORMAT_SCRIPT = `${SCRIPT_DIR}/W11_format.c`;
export const RENAME_GPROJ = `${GPROJ_DIR}/rename/W11_rename.gproj`;
export const NORMALIZE_GPROJ = `${GPROJ_DIR}/normalize/W11_normalize.gproj`;
export const RENAMED_ID = "EMCP2_W11_RENAMED";
export const BUILDING_MANIFEST_FILE = "w11-building-manifest.json";

/** The planted script_format fixture: trailing blanks and mixed indents for the formatter to fix. */
export const FORMAT_FIXTURE = [
  "// W11 script_format fixture, generated by tests/live/w11.live.ts plant   ",
  "class W11_FormatProbe   ",
  "{",
  "\tint m_iValue = 1;   ",
  "  void Probe()  ",
  "  {",
  "\t\tm_iValue = 2;",
  "  }",
  "}",
  "",
].join("\r\n");

/**
 * Writers and checks this battery leaves out, with the reason (each needs a save, a registry
 * write, a dialog, a world edit or a write outside _throwaway/W11/).
 */
export const EXCLUDED: ReadonlyArray<{ what: string; gap: string; why: string }> = [
  {
    what: "wb_terrain_edit backup and restore",
    gap: "8",
    why: "the restore rewrites a terrain and needs the owner's hand-built throwaway terrain world (OI-W7-1); W7's w7-23, w7-24, w7-70 own it",
  },
  {
    what: "wb_settings scratch ini",
    gap: "7",
    why: "the accept is Workbench reading the ini through its Options dialog; it needs the GUI locator rows for 1.9.0.37 (policy gui.rows_enabled) and a dialog",
  },
  {
    what: "the compile check of script_create, script_format and mod create scripts",
    gap: "10, 11",
    why: "wb_scripts validate compiles the module's Scripts folders only, so the file would have to sit outside _throwaway/W11/, and a broken file there stops the module (DEC-035); the Script Editor open and read-back stands in (opened, not compiled)",
  },
  {
    what: "config_edit override",
    gap: "4",
    why: "it writes the game file's own path in the project, outside _throwaway/W11/",
  },
  {
    what: "mod build, project_settings, the scenario world save",
    gap: "-",
    why: "a build packs the addon; project_settings already has EV-W2-167; a world save is a save",
  },
  {
    what: "refactor_replace_guid with include_workshop",
    gap: "11",
    why: "it would edit files in workshop projects outside the test bed",
  },
  {
    what: "the PARTIAL rulings of P-W2-20, P-W2-21, P-W4-16, P-W4-24, P-W4-25, P-W4-28",
    gap: "12",
    why: "an owner ruling, not a live step",
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

/** The read-only engine tools the battery sends (plus register, which writes a .meta under _throwaway/W11/). */
export type W11Tool =
  | "wb_resources"
  | "wb_container"
  | "wb_module"
  | "wb_world"
  | "wb_layers"
  | "wb_entity"
  | "wb_script_editor";

/** The offline writers, run in process with the tool's own code. */
export type OfflineTool =
  | "config_edit"
  | "procanim"
  | "animation_workspace"
  | "scenario_create_conflict"
  | "scenario_apply_template"
  | "scenario_clone_area"
  | "prefab"
  | "layout_create"
  | "config_create"
  | "faction_create"
  | "building_setup"
  | "mod"
  | "project"
  | "game_duplicate"
  | "script_create"
  | "refactor_replace_guid"
  | "refactor_move_resource_path"
  | "refactor_rename_project_id"
  | "refactor_normalize_dependencies"
  | "script_format"
  | "wb_entity_duplicate";

export type Block = "W11.0" | "W11.1" | "W11.2" | "W11.3" | "W11.4" | "W11.5" | "W11.6" | "W11.7" | "W11.9";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED";
/** NOT-JUDGED: the oracle cannot judge the file type (its vanilla control is refused too). */
export type AcceptResult = "ACCEPTED" | "PARTIAL" | "REJECTED" | "NOT-JUDGED";
export type Oracle = "state-readback" | "returned-true-only";

export interface ToolResponse {
  ok: boolean;
  action?: string;
  target?: string;
  code?: string;
  message?: string;
  readback?: unknown;
  warnings?: string[];
  [extra: string]: unknown;
}

/** One file's engine read. */
export interface FileAccept {
  rel: string;
  via: "container" | "gproj" | "world" | "script";
  result: AcceptResult;
  /** The engine's error when REJECTED; what was not read back when PARTIAL. */
  error?: string;
  found?: Record<string, boolean>;
  evidence: Raw;
}

export interface StepOutcome {
  status: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
  results?: { file: string; lines: Raw[] };
}

export interface StepRecord {
  step: string;
  block: Block;
  title: string;
  status: RecordStatus;
  detail: string;
  startedAt: string;
  endedAt: string;
  evidence: Record<string, unknown>;
  evidenceId?: string | null;
  stop?: string;
}

/** A refactor plan's files, read before the commit (absolute paths). */
export interface RefactorPlan {
  ok: boolean;
  files: string[];
  detail: string;
}

export interface W11Deps {
  /** One engine tool, run in process against a client WITHOUT a Config. */
  tool: (name: W11Tool, args: Raw) => Promise<ToolResponse>;
  /** One offline writer, run in process with the test bed as its project. */
  offline: (name: OfflineTool, args: Raw) => Promise<ToolResponse>;
  /** The plan a GUID replace or a path move would commit, from a fresh index of the test bed. */
  refactorPlan: (
    kind: "replace_guid" | "move_resource_path",
    args: Raw,
  ) => Promise<RefactorPlan>;
  info: () => Promise<Raw | null>;
  ping: () => Promise<Raw | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  commandLine: (pid: number) => Promise<string | null>;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  listTree: (dir: string) => string[];
  newGuid: () => string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W11Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
}

export interface StepContext {
  deps: W11Deps;
  opts: W11Options;
  calls: Array<Record<string, unknown>>;
  tool: (name: W11Tool, args: Raw, o?: { tolerate?: boolean }) => Promise<ToolResponse>;
  offline: (name: OfflineTool, args: Raw) => Promise<ToolResponse>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

/** One offline call as the plan records it (paths relative to the test bed, or `<sandbox>/...`). */
export interface OfflineCall {
  tool: OfflineTool;
  params: Raw;
  note?: string;
}

export interface StepDef {
  id: string;
  block: Block;
  title: string;
  risk: Risk;
  timeout_ms: number;
  expected: string;
  kill_criterion: string;
  side_effects: string[];
  rollback: string;
  writes: string[];
  /** The census rows a PASS names (promote.ts links each to this file). */
  rows: string[];
  /** The write-safety audit gap the step closes. */
  gap: string;
  expectsWindows?: readonly RegExp[];
  plan: () => PlanAction[];
  offlineCalls: () => OfflineCall[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

type Raw = Record<string, unknown>;

// ── Small helpers ────────────────────────────────────────────────────────────

function S(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function rb(r: ToolResponse | null | undefined): Raw {
  return r && r.readback && typeof r.readback === "object" ? (r.readback as Raw) : {};
}

function brief(r: ToolResponse | null | undefined): Raw | null {
  if (!r) return null;
  return r.ok
    ? { ok: true, readback: r.readback ?? null, warnings: r.warnings ?? [] }
    : { ok: false, code: r.code ?? null, message: r.message ?? null };
}

/** An offline answer with its text cut short (the creators answer with the whole generated file). */
function briefOffline(r: ToolResponse | null | undefined): Raw | null {
  if (!r) return null;
  return {
    ok: r.ok,
    code: r.code ?? null,
    message: S(r.message).slice(0, 600) || null,
    ...(r.readback && typeof r.readback === "object" && !("text" in (r.readback as Raw))
      ? { readback: JSON.stringify(r.readback).length <= 4000 ? r.readback : JSON.stringify(r.readback).slice(0, 4000) }
      : {}),
  };
}

function why(r: ToolResponse): string {
  return `${S(r.action)}: ${S(r.code)} ${S(r.message)}`.trim();
}

function sha256(b: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(root: string, rel: string): string {
  return join(root, ...rel.split("/"));
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function readJson<T>(path: string, deps: Pick<W11Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W11Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

function rowsOf(r: ToolResponse | null | undefined): Raw[] {
  const rows = rb(r).rows;
  return Array.isArray(rows) ? (rows as Raw[]) : [];
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => S(x)) : [];
}

/** True when `rel` is `dir` itself or lies under it (forward slashes, case-insensitive). */
export function under(rel: string, dir: string): boolean {
  const r = rel.replace(/\\/g, "/").toLowerCase();
  const d = dir.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
  return r === d || r.startsWith(`${d}/`);
}

/** An absolute path inside the test bed, as a test-bed-relative path ("" when outside). */
export function relOf(sandboxDir: string, absPath: string): string {
  const a = resolve(absPath).replace(/\\/g, "/");
  const s = resolve(sandboxDir).replace(/\\/g, "/").replace(/\/$/, "");
  return a.toLowerCase().startsWith(`${s.toLowerCase()}/`) ? a.slice(s.length + 1) : "";
}

/** The first 16-hex GUID in a text ({...} or quoted), upper case; "" when none. */
export function guidIn(text: string): string {
  const m = /\{([0-9A-Fa-f]{16})\}/.exec(text) ?? /"([0-9A-Fa-f]{16})"/.exec(text);
  return m ? m[1]!.toUpperCase() : "";
}

function textAt(ctx: StepContext, rel: string): string {
  const p = abs(ctx.opts.sandboxDir, rel);
  return ctx.deps.exists(p) ? ctx.deps.readBytes(p).toString("utf-8") : "";
}

function onDisk(ctx: StepContext, rel: string): boolean {
  return ctx.deps.exists(abs(ctx.opts.sandboxDir, rel));
}

/** Files under `dir` (test-bed-relative), .meta and .bak left out. */
function filesUnder(ctx: StepContext, dir: string): string[] {
  return ctx.deps
    .listTree(abs(ctx.opts.sandboxDir, dir))
    .filter((f) => !/\.(meta|bak)$/i.test(f))
    .map((f) => `${dir}/${f}`);
}

function newFiles(before: readonly string[], after: readonly string[], ext?: RegExp): string[] {
  const had = new Set(before);
  return after.filter((f) => !had.has(f) && (!ext || ext.test(f)));
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

export const ROUTE_OF: Readonly<Record<W11Tool, string>> = {
  wb_resources: "EMCP_WB_Resources",
  wb_container: "EMCP_WB_Container",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_layers: "EMCP_WB_Layers",
  wb_entity: "EMCP_WB_Entity",
  wb_script_editor: "EMCP_WB_ScriptEditor",
};

export function tc(tool: W11Tool, action: string, params: Raw = {}, note?: string): PlanAction {
  return {
    kind: "net-call",
    target: ROUTE_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: action,
    note: note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

export function oc(tool: OfflineTool, params: Raw, note?: string): OfflineCall {
  return { tool, params, ...(note ? { note } : {}) };
}

/** The engine tool actions the battery may send. Nothing saves, closes, sets or opens a dialog. */
export const ACTIONS_ALLOWED: Readonly<Record<W11Tool, ReadonlySet<string>>> = {
  wb_resources: new Set(["register", "resolve"]),
  wb_container: new Set(["describe", "get"]),
  wb_module: new Set(["open", "setResource"]),
  wb_world: new Set(["state"]),
  wb_layers: new Set(["list"]),
  wb_entity: new Set(["list"]),
  wb_script_editor: new Set(["open", "getLines", "state"]),
};

/** Offline params that name a file or folder the writer writes: each must lie under _throwaway/W11/. */
export const WRITE_PARAMS: readonly string[] = [
  "path",
  "target",
  "newPath",
  "out_path",
  "outputDir",
  "destPath",
  "gproj_path",
  "script_path",
  "target_layer_path",
  "dest_layer_path",
  "projectPath",
  "old_path",
  "new_path",
  "eventTable",
];

/** Offline params that only name a file the writer reads (vanilla sources may lie anywhere). */
const READ_PARAMS_BY_TOOL: Readonly<Partial<Record<OfflineTool, readonly string[]>>> = {
  // duplicate reads the game workspace at `path` and writes the set at `target`.
  animation_workspace: ["path"],
};

/** A plan path as a test-bed-relative path: `<sandbox>/x` and `x` both give `x`. */
export function planRel(v: string): string {
  return v.replace(/\\/g, "/").replace(/^<sandbox>\//, "");
}

/**
 * The battery's own gate over the plan, beside checkPlan: only the allowed engine actions, every
 * engine target and every offline write under _throwaway/W11/, no config_edit override, no
 * refactor commit outside the test bed, no workshop edit.
 */
export function w11PlanViolations(steps: readonly StepDef[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    s.plan().forEach((a, i) => {
      if (a.kind !== "net-call" || typeof a.tool !== "string") return;
      const tool = a.tool as W11Tool;
      const p = (a.params ?? {}) as Raw;
      const where = `${s.id} action ${i} (${tool}.${S(a.toolAction)})`;
      const allowed = ACTIONS_ALLOWED[tool];
      if (!allowed) {
        out.push(`${where}: ${tool} is not a W11 tool`);
        return;
      }
      if (!allowed.has(S(a.toolAction))) out.push(`${where}: not an allowed ${tool} action`);
      // A wb_container `path` is a property path inside the target, not a file.
      for (const k of tool === "wb_container" ? ["target"] : ["path", "target"]) {
        const v = S(p[k]);
        if (!v || v.startsWith("<")) continue;
        const rel = planRel(v.replace(/^path:/, ""));
        if (!under(rel, W11_ROOT)) out.push(`${where}: ${k} ${v} is outside ${W11_ROOT}/`);
      }
      if (truthy(p.buildRuntime)) out.push(`${where}: register builds no runtime resource here`);
    });
    s.offlineCalls().forEach((c, i) => {
      const where = `${s.id} offline ${i} (${c.tool})`;
      const reads = READ_PARAMS_BY_TOOL[c.tool] ?? [];
      for (const k of WRITE_PARAMS) {
        if (reads.includes(k) && S(c.params.action) === "duplicate") continue;
        let v = c.params[k];
        // project write resolves `path` against its projectPath.
        if (c.tool === "project" && k === "path" && typeof v === "string" && typeof c.params.projectPath === "string")
          v = `${planRel(c.params.projectPath)}/${v}`;
        if (typeof v !== "string" || v.startsWith("<the")) continue;
        if (!under(planRel(v), W11_ROOT)) out.push(`${where}: ${k} ${v} is outside ${W11_ROOT}/`);
      }
      if (c.tool === "config_edit" && S(c.params.action) === "override")
        out.push(`${where}: config_edit override writes outside the throwaway folder`);
      if (c.tool === "refactor_replace_guid" && truthy(c.params.include_workshop))
        out.push(`${where}: include_workshop edits workshop projects`);
      if (c.tool === "mod" && S(c.params.action) !== "create")
        out.push(`${where}: mod ${S(c.params.action)} is not a writer this battery runs`);
      if (c.tool === "project" && S(c.params.action) !== "write")
        out.push(`${where}: project ${S(c.params.action)} is not a writer`);
    });
  }
  return out;
}

// ── Engine reads ─────────────────────────────────────────────────────────────

/**
 * `rel` registered (unless `noRegister`: a .gproj) and read with wb_container describe on `path:`
 * (summary, then up to ACCEPT_PAGES pages), looking for each needle in what the engine answered.
 * When a needle is not in the describe rows and `get` names container paths, the second read-back:
 * wb_container get on `path:` with each exact property path (the variable's own value, type and
 * set flags), looking for the needle there (W11 run 5: .styles, faction_create and normalize were
 * PARTIAL on describe alone).
 * REJECTED: no describe answered ok (the engine's error recorded). PARTIAL: loaded, a needle not
 * seen. ACCEPTED: loaded and every needle read back.
 */
export async function engineRead(
  ctx: StepContext,
  rel: string,
  needles: readonly string[],
  o: { noRegister?: boolean; watch?: RegExp; get?: readonly string[] } = {},
): Promise<FileAccept> {
  const reg = o.noRegister
    ? null
    : await ctx.tool("wb_resources", { action: "register", path: rel, confirm: true });
  const sum = await ctx.tool("wb_container", { action: "describe", target: `path:${rel}` });
  const pages: ToolResponse[] = [];
  let cursor = "";
  for (let i = 0; i < ACCEPT_PAGES; i++) {
    const p = await ctx.tool("wb_container", {
      action: "describe",
      target: `path:${rel}`,
      mode: "page",
      fields: PAGE_FIELDS,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    pages.push(p);
    cursor = S(rb(p).nextCursor);
    if (!p.ok || !cursor) break;
  }
  const children = strs(rb(sum).children);
  const rows = pages.flatMap((p) => rowsOf(p));
  const all: unknown[] = [rb(sum), ...children, ...rows];
  const found: Record<string, boolean> = Object.fromEntries(
    needles.map((n) => [n, all.some((x) => JSON.stringify(x).includes(n))]),
  );
  const loaded = sum.ok || pages.some((p) => p.ok);
  // The second read-back: the exact property paths, only when describe missed a needle.
  const gets: Raw[] = [];
  if (loaded && o.get?.length && needles.some((n) => !found[n])) {
    for (const path of o.get) {
      const g = await ctx.tool("wb_container", { action: "get", target: `path:${rel}`, path }, { tolerate: true });
      gets.push({ path, ...(brief(g) ?? {}) });
      if (g.ok) for (const n of needles) if (JSON.stringify(rb(g)).includes(n)) found[n] = true;
    }
  }
  const evidence: Raw = {
    register: reg ? brief(reg) : "not sent (a .gproj is read by path)",
    summary: sum.ok
      ? { rootClass: rb(sum).rootClass ?? null, total: rb(sum).total ?? null, children }
      : brief(sum),
    pages: pages.length,
    rows: rows.length,
    pageErrors: pages.filter((p) => !p.ok).map(brief),
    hits: Object.fromEntries(
      needles.map((n) => [
        n,
        [...children, ...rows].filter((x) => JSON.stringify(x).includes(n)).slice(0, 6),
      ]),
    ),
    ...(o.watch ? { watched: rows.filter((x) => o.watch!.test(S(x.path))).slice(0, 6) } : {}),
    ...(gets.length ? { get: gets } : {}),
  };
  if (!loaded) {
    const err = [sum, ...pages].find((r) => !r.ok) ?? sum;
    return {
      rel,
      via: o.noRegister ? "gproj" : "container",
      result: "REJECTED",
      error: `${S(err.code)} ${S(err.message)}`.trim() || "describe refused",
      found,
      evidence,
    };
  }
  const missing = needles.filter((n) => !found[n]);
  return {
    rel,
    via: o.noRegister ? "gproj" : "container",
    result: missing.length ? "PARTIAL" : "ACCEPTED",
    ...(missing.length
      ? {
          error: `loaded; not read back in the describe rows${o.get?.length ? ` or by get on ${o.get.join(", ")}` : ""}: ${missing.join(", ")}`,
        }
      : {}),
    found,
    evidence,
  };
}

export function engineReadPlan(
  rel: string,
  o: { noRegister?: boolean; get?: readonly string[] } = {},
): PlanAction[] {
  return [
    ...(o.noRegister ? [] : [tc("wb_resources", "register", { path: rel, confirm: true })]),
    tc("wb_container", "describe", { target: `path:${rel}` }),
    tc(
      "wb_container",
      "describe",
      { target: `path:${rel}`, mode: "page", fields: PAGE_FIELDS, limit: 200 },
      `paged by nextCursor, at most ${ACCEPT_PAGES} pages`,
    ),
    ...(o.get ?? []).map((path) =>
      tc("wb_container", "get", { target: `path:${rel}`, path }, "sent only when describe misses a needle"),
    ),
  ];
}

/** Lines of a text, CRLF and LF alike, the trailing empty line dropped. */
function linesOf(text: string): string[] {
  const l = text.split(/\r?\n/);
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
}

/** The Script Editor opens `rel`; its lines (paged, 200 a page, at most 10 pages) against the disk. */
export async function scriptRead(ctx: StepContext, rel: string): Promise<FileAccept> {
  const o = await ctx.tool("wb_script_editor", { action: "open", path: rel });
  const evidence: Raw = { open: brief(o) };
  if (!o.ok)
    return {
      rel,
      via: "script",
      result: "REJECTED",
      error: `${S(o.code)} ${S(o.message)}`.trim(),
      evidence,
    };
  const got: string[] = [];
  let start = 0;
  for (let i = 0; i < 10; i++) {
    const r = await ctx.tool("wb_script_editor", { action: "getLines", start, limit: 200 });
    if (!r.ok) {
      evidence.getLines = brief(r);
      break;
    }
    const rows = Array.isArray(rb(r).rows) ? (rb(r).rows as unknown[]).map(S) : [];
    got.push(...rows);
    if (rows.length < 200) break;
    start += rows.length;
  }
  const disk = linesOf(textAt(ctx, rel));
  const editor = got.map((l) => l.replace(/\r$/, ""));
  while (editor.length > disk.length && editor[editor.length - 1] === "") editor.pop();
  const first = disk.findIndex((l, i) => editor[i] !== l);
  const same = first === -1 && editor.length === disk.length;
  Object.assign(evidence, { diskLines: disk.length, editorLines: editor.length });
  if (!same)
    evidence.firstDiff = {
      line: first === -1 ? disk.length : first,
      disk: disk[first] ?? null,
      editor: editor[first === -1 ? disk.length : first] ?? null,
    };
  return {
    rel,
    via: "script",
    result: same ? "ACCEPTED" : "PARTIAL",
    ...(same ? {} : { error: "opened; the editor's lines differ from the bytes on disk" }),
    evidence,
  };
}

function scriptReadPlan(rel: string): PlanAction[] {
  return [
    tc("wb_script_editor", "open", { path: rel }),
    tc("wb_script_editor", "getLines", { start: 0, limit: 200 }, "paged, at most 10 pages"),
  ];
}

/** One layer the world read expects, with the least entity count it must list. */
export interface LayerExpect {
  file: string;
  minEntities: number;
}

/**
 * The world `ent` registered and opened in the World Editor (setResource, polled until
 * worldPath names it), then wb_layers list and, per expected layer, wb_entity list on it.
 */
export async function worldRead(
  ctx: StepContext,
  ent: string,
  layers: readonly LayerExpect[],
): Promise<{ opened: boolean; accepts: FileAccept[]; evidence: Raw }> {
  const evidence: Raw = {};
  const reg = await ctx.tool("wb_resources", { action: "register", path: ent, confirm: true });
  evidence.register = brief(reg);
  evidence.module = brief(await ctx.tool("wb_module", { action: "open", module: "WorldEditor" }));
  const set = await ctx.tool("wb_module", {
    action: "setResource",
    module: "WorldEditor",
    target: `path:${ent}`,
  });
  evidence.setResource = brief(set);
  const started = ctx.deps.now();
  let polls = 0;
  let worldPath = "";
  let opened = false;
  for (;;) {
    polls++;
    const st = await ctx.tool("wb_world", { action: "state" });
    worldPath = S(rb(st).worldPath);
    opened = st.ok && worldPath.toLowerCase().endsWith(ent.toLowerCase());
    if (opened || !set.ok || ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open) break;
    await ctx.sleep(TIMEOUTS.poll);
  }
  Object.assign(evidence, { polls, worldPath });
  if (!opened) {
    const err = !set.ok ? `${S(set.code)} ${S(set.message)}`.trim() : `the world did not open ('${worldPath}')`;
    return {
      opened,
      evidence,
      accepts: [ent, ...layers.map((l) => l.file)].map((rel) => ({
        rel,
        via: "world" as const,
        result: "REJECTED" as const,
        error: err,
        evidence: {},
      })),
    };
  }
  const list = await ctx.tool("wb_layers", { action: "list" });
  const listed = Array.isArray(rb(list).layers) ? (rb(list).layers as Raw[]) : [];
  evidence.layers = list.ok ? listed.map((x) => S(x.path) || S(x.name)) : brief(list);
  const accepts: FileAccept[] = [{ rel: ent, via: "world", result: "ACCEPTED", evidence: { worldPath } }];
  for (const l of layers) {
    const name = basename(l.file).replace(/\.layer$/i, "").toLowerCase();
    const row = listed.find((x) => {
      const p = (S(x.path) || S(x.name)).replace(/\\/g, "/").toLowerCase();
      return p.endsWith(l.file.toLowerCase()) || basename(p).replace(/\.layer$/, "") === name;
    });
    if (!row) {
      accepts.push({
        rel: l.file,
        via: "world",
        result: "REJECTED",
        error: list.ok ? "the World Editor does not list the layer" : `wb_layers list: ${why(list)}`,
        evidence: {},
      });
      continue;
    }
    const ents = await ctx.tool("wb_entity", {
      action: "list",
      layer: S(row.path) || l.file,
      limit: 200,
    });
    const count = Number(rb(ents).total ?? rowsOf(ents).length);
    const ev: Raw = { layer: S(row.path) || S(row.name), entities: ents.ok ? count : brief(ents) };
    accepts.push(
      ents.ok && count >= l.minEntities
        ? { rel: l.file, via: "world", result: "ACCEPTED", evidence: ev }
        : {
            rel: l.file,
            via: "world",
            result: "PARTIAL",
            error: ents.ok
              ? `listed with ${count} entities, fewer than ${l.minEntities}`
              : `listed; wb_entity list: ${why(ents)}`,
            evidence: ev,
          },
    );
  }
  return { opened, accepts, evidence };
}

function worldReadPlan(ent: string): PlanAction[] {
  return [
    tc("wb_resources", "register", { path: ent, confirm: true }),
    tc("wb_module", "open", { module: "WorldEditor" }),
    tc("wb_module", "setResource", { module: "WorldEditor", target: `path:${ent}` }),
    tc("wb_world", "state", {}, "polled until worldPath names the world"),
    tc("wb_layers", "list"),
    tc("wb_entity", "list", { layer: "<each expected layer>", limit: 200 }),
  ];
}

// ── Snapshot and net-zero ────────────────────────────────────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W11/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W11Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W11_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W11Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
  takenBy: "gate" | "run start",
): boolean {
  const snap = join(sittingDir, BATTERY_SNAPSHOT_FILE);
  if (deps.exists(snap)) return false;
  const taken: BatterySnapshot = {
    kind: BATTERY_SNAPSHOT_KIND,
    taken_at: new Date(deps.now()).toISOString(),
    taken_by: takenBy,
    files: sandboxHashes(sandboxDir, deps),
  };
  writeJson(snap, taken, deps);
  return true;
}

export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W11Deps, "exists" | "readBytes" | "listTree">,
): { takenAt: string; changed: string[]; tolerated: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const all = changedFiles(snap.files, sandboxHashes(sandboxDir, deps));
  const tolerated = all.filter((f) => NETZERO_TOLERATED.includes(basename(f)));
  return {
    takenAt: S(snap.taken_at),
    changed: all.filter((f) => !tolerated.includes(f)),
    tolerated,
  };
}

// ── Live result lines ────────────────────────────────────────────────────────

export function liveResultLine(stepId: string, rowId: string, oracle: Oracle, date: string): Raw {
  return { live_result: { test: stepId, rows: [rowId], verdict: "pass", oracle, date } };
}

export function liveTestLine(stepId: string, rowId: string): Raw {
  return { id: rowId, tests: [{ id: stepId, file: SCRIPT_PATH, kind: "live" }] };
}

export function liveFileOf(stepId: string): string {
  return `w11-live-${stepId}.jsonl`;
}

/**
 * A writer step's verdict from its offline failures and its engine reads. The writer failing is
 * a FAIL of the writer; an engine REJECTED is a FAIL that records the engine's error; PARTIAL
 * passes with what was not read back named. Live lines only on PASS: `state-readback` when every
 * read is ACCEPTED, else `returned-true-only`.
 */
export function writerOutcome(
  ctx: StepContext,
  stepId: string,
  rows: readonly string[],
  writerFails: string[],
  accepts: FileAccept[],
  evidence: Raw,
  passDetail: string,
): StepOutcome {
  evidence.accepts = accepts;
  const lines: Raw[] = [];
  const results = { file: liveFileOf(stepId), lines };
  if (writerFails.length)
    return {
      status: "FAIL",
      detail: `the writer failed offline: ${writerFails.join("; ")}`,
      evidence,
      results,
    };
  if (!accepts.length)
    return { status: "FAIL", detail: "no file was read by the engine", evidence, results };
  const rejected = accepts.filter((a) => a.result === "REJECTED");
  if (rejected.length)
    return {
      status: "FAIL",
      detail: `the engine refused ${rejected.map((a) => `${a.rel} (${a.via}: ${a.error})`).join("; ")}`,
      evidence,
      results,
    };
  if (!accepts.some((a) => a.result === "ACCEPTED" || a.result === "PARTIAL"))
    return {
      status: "NOT-RUN",
      detail: `the oracle judged no file: ${accepts.map((a) => `${a.rel} (${a.error})`).join("; ")}`,
      evidence,
    };
  // A NOT-JUDGED file weakens the proof like a PARTIAL one: the oracle drops to returned-true-only.
  const partial = accepts.filter((a) => a.result === "PARTIAL" || a.result === "NOT-JUDGED");
  const oracle: Oracle = partial.length ? "returned-true-only" : "state-readback";
  const date = new Date(ctx.deps.now()).toISOString().slice(0, 10);
  for (const r of rows) lines.push(liveTestLine(stepId, r), liveResultLine(stepId, r, oracle, date));
  return {
    status: "PASS",
    detail: `${passDetail}; engine ${accepts.map((a) => `${a.rel.split("/").pop()} ${a.result}`).join(", ")}${partial.length ? ` (${partial.map((a) => `${a.result}: ${a.error}`).join("; ")})` : ""}`,
    evidence,
    results,
  };
}

function notRun(detail: string, evidence: Raw = {}): StepOutcome {
  return { status: "NOT-RUN", detail, evidence };
}

/** An offline answer that failed, as a writer failure line. */
function offFail(label: string, r: ToolResponse, fails: string[]): boolean {
  if (r.ok) return false;
  fails.push(`${label}: ${S(r.code) || "error"} ${S(r.message).slice(0, 300)}`.trim());
  return true;
}

// ── W11.1 config_edit (gap 4) ────────────────────────────────────────────────

/**
 * The scalar the config_edit step edits: the first float, else the first int other than 0 and 1,
 * else the first plain word string (no GUID or path) whose key is not Name, else the first Name,
 * else the first bool (flipped). Name comes last among the strings since W11 run 6: on the .styles
 * root the engine answered get Name as STRING "" with isSet false, so a Name edit is not visible to
 * the engine there; a nested WSItem Image is an ordinary variable the describe rows carry. config_edit read answers a value as its source text, quotes included; the set
 * keeps a slot's quoting, so the new value is sent bare.
 */
export function pickScalar(
  entries: readonly Raw[],
): { path: string; key: string; before: string; after: number | string; needle: string } | null {
  const unq = (v: string): string => (/^".*"$/.test(v) ? v.slice(1, -1) : v);
  const scalars = entries
    .filter((e) => S(e.kind) === "scalar" && S(e.path))
    .map((e) => ({ path: S(e.path), key: S(e.key), raw: S(e.value), value: unq(S(e.value)), quoted: /^".*"$/.test(S(e.value)) }));
  const float = scalars.find((e) => !e.quoted && /^-?\d+\.\d+$/.test(e.value));
  if (float) return { path: float.path, key: float.key, before: float.raw, after: 7.0625, needle: "7.0625" };
  const int = scalars.find((e) => !e.quoted && /^-?\d+$/.test(e.value) && !["0", "1"].includes(e.value));
  if (int) {
    const v = Number(int.value) + 1;
    return { path: int.path, key: int.key, before: int.raw, after: v, needle: String(v) };
  }
  const word = (e: (typeof scalars)[number]): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(e.value) && !/^(true|false)$/i.test(e.value);
  const str = scalars.find((e) => e.key !== "Name" && word(e)) ?? scalars.find(word);
  if (str) {
    const v = `${str.value}W11`;
    return { path: str.path, key: str.key, before: str.raw, after: v, needle: v };
  }
  const bool = scalars.find((e) => !e.quoted && /^(true|false)$/i.test(e.value));
  if (bool) {
    const v = /^true$/i.test(bool.value) ? "false" : "true";
    return { path: bool.path, key: bool.key, before: bool.raw, after: v, needle: v };
  }
  return null;
}

/**
 * A config_edit property path as a wb_container property path: config_edit names the single root
 * object `[0]`, the container walk starts inside it (`[0].Name` is `Name`).
 */
export function containerPath(configEditPath: string): string {
  return configEditPath.replace(/^\[0\]\.?/, "");
}

/**
 * The get paths for a pick: only a top-level variable. config_edit names a lone child block by its
 * class key (`Styles.WSStyle`) where the container path indexes it (`Styles[0]`), so a nested
 * pick is judged on the describe rows alone and its row is watched instead.
 */
export function pickGets(configEditPath: string): string[] {
  const p = containerPath(configEditPath);
  return /[.[]/.test(p) ? [] : [p];
}

/** Rows whose last path segment is the pick's key (recorded in the evidence). */
export function pickWatch(key: string): RegExp {
  return new RegExp(`(^|\\.)${key.replace(/[^A-Za-z0-9_]/g, "")}$`);
}

function configStep(c: (typeof CONFIG_CASES)[number], i: number): StepDef {
  const id = `w11-1${i}-${c.ext.slice(1)}`;
  return {
    id,
    block: "W11.1",
    title: `config_edit set on a ${c.ext} copy (planted from the paks), then register and describe on path:`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the set's dry run writes nothing; the set writes the value; the engine loads the ${c.ext} and reads the value back`,
    kill_criterion: "the engine refuses the file: FAIL with its error; the writer fails: FAIL",
    side_effects: [`${c.rel} edited (+ .meta)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [c.rel],
    rows: ["mcp:action/config_edit.set"],
    gap: "4",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => engineReadPlan(c.rel, { get: ["<the picked scalar>"] }),
    offlineCalls: () => [
      oc("config_edit", { action: "read", path: c.rel, depth: 8 }),
      oc("config_edit", { action: "set", path: c.rel, property: "<the picked scalar>", value: "<new>" }),
      oc("config_edit", {
        action: "set",
        path: c.rel,
        property: "<the picked scalar>",
        value: "<new>",
        confirm: true,
      }),
    ],
    run: async (ctx) => {
      const evidence: Raw = { file: c.rel, plantedFrom: c.from };
      if (!onDisk(ctx, c.rel)) return notRun(`${c.rel} is not planted: run \`w11.live.ts plant\``, evidence);
      const fails: string[] = [];
      const rd = await ctx.offline("config_edit", { action: "read", path: c.rel, depth: 8 });
      const entries = Array.isArray(rb(rd).entries) ? (rb(rd).entries as Raw[]) : [];
      evidence.read = { ok: rd.ok, code: rd.code ?? null, entries: entries.length };
      if (offFail("read", rd, fails)) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const pick = pickScalar(entries);
      evidence.pick = pick;
      if (!pick) return notRun(`config_edit read lists no float, int, word string or bool scalar in ${c.rel}`, evidence);
      const before = ctx.deps.readBytes(abs(ctx.opts.sandboxDir, c.rel));
      const dry = await ctx.offline("config_edit", {
        action: "set",
        path: c.rel,
        property: pick.path,
        value: pick.after,
      });
      evidence.setDry = briefOffline(dry);
      offFail("set dry run", dry, fails);
      if (!before.equals(ctx.deps.readBytes(abs(ctx.opts.sandboxDir, c.rel))))
        fails.push("the set dry run wrote");
      const set = await ctx.offline("config_edit", {
        action: "set",
        path: c.rel,
        property: pick.path,
        value: pick.after,
        confirm: true,
      });
      evidence.set = briefOffline(set);
      offFail("set", set, fails);
      if (!fails.length && !textAt(ctx, c.rel).includes(pick.needle))
        fails.push(`the file does not hold ${pick.needle} after the set`);
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      // W11 run 5: the .styles root Name was not in the describe rows; get reads a top-level variable
      // itself. Run 6: get Name answered "" unset, so the pick now prefers another word (pickScalar).
      const a = await engineRead(ctx, c.rel, [pick.needle], { get: pickGets(pick.path), watch: pickWatch(pick.key) });
      return writerOutcome(ctx, id, ["mcp:action/config_edit.set"], [], [a], evidence, `${pick.key} ${pick.before} -> ${pick.needle}`);
    },
  };
}

// ── W11.2 procanim .siga (gap 5) ─────────────────────────────────────────────

/** The moved node's element row and its `tl` row (node id 1 is Inputs[0]). */
export const SIGA_TL_ROW = /(^|\.)Inputs\[0\](\.tl|\.valueMax)?$/;
/**
 * The describe types EMCP_WB_Container.Walk answers a value for (ReadValueText since the W11 run 6
 * handler change; the five scalar types before it, which is what run 6 and earlier observed).
 */
export const VALUED_TYPES: readonly string[] = [
  "SCALAR",
  "INTEGER",
  "BOOLEAN",
  "STRING",
  "RESOURCE_NAME",
  "VECTOR2",
  "VECTOR3",
  "STRING_ARRAY",
  "RESOURCE_NAME_ARRAY",
  "INTEGER_ARRAY",
  "SCALAR_ARRAY",
  "BOOLEAN_ARRAY",
];

/**
 * Why the moved position was not read back, from the watched rows. Run 1 (1.9.0.37): 86 rows on
 * one page (not a paging miss), no 31.5 anywhere: Walk fills the value column only for VALUED_TYPES,
 * so if the node position (`tl`, two numbers on one line) has another type its row has no value.
 * Run 1 did not record the tl row's type; the watched rows record it from run 2 on.
 */
export function sigaMissReason(a: FileAccept): string {
  const watched = Array.isArray(a.evidence.watched) ? (a.evidence.watched as Raw[]) : [];
  const tl = watched.find((r) => /\.tl$/.test(S(r.path)));
  const x = String(SIGA_MOVE.x);
  if (!tl)
    return `loaded; no Inputs[0].tl row in the ${S(a.evidence.rows)} describe rows${watched.length ? "" : " (no Inputs[0] row either)"}, so ${x} cannot be read back`;
  if (!VALUED_TYPES.includes(S(tl.type)))
    return `loaded; ${S(tl.path)} is a ${S(tl.type) || "typeless"} row and the describe answers a value only for ${VALUED_TYPES.join(", ")}, so ${x} cannot be read back`;
  return `loaded; ${S(tl.path)} reads "${S(tl.value)}", not ${x}`;
}

function sigaStep(): StepDef {
  const id = "w11-20-siga";
  const rows = ["mcp:action/procanim.create", "mcp:action/procanim.edit"];
  const edit = {
    action: "edit",
    path: SIGA,
    ops: [
      { op: "move_node", node: SIGA_MOVE.node, x: SIGA_MOVE.x, y: SIGA_MOVE.y },
      { op: "set_property", node: SIGA_SET.node, key: SIGA_SET.key, value: SIGA_SET.value },
    ],
    confirm: true,
  };
  return {
    id,
    block: "W11.2",
    title: `procanim create (a copy of ${SIGA_SOURCE}) and edit (move_node, set_property ${SIGA_SET.key}), then register and describe the .siga on path:`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the copy is written, the node moved to ${SIGA_MOVE.x} ${SIGA_MOVE.y} and its ${SIGA_SET.key} set to ${SIGA_SET.value}; the engine loads the .siga and reads ${SIGA_SET.value} and the VECTOR2 position ${SIGA_TL.needle} (describe, else get on ${SIGA_SET.path}, ${SIGA_TL.path})`,
    kill_criterion: "the engine refuses the .siga: FAIL with its error; the writer fails: FAIL",
    side_effects: [`${SIGA} (+ .bak, .meta)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [SIGA],
    rows,
    gap: "5",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => engineReadPlan(SIGA, { get: [SIGA_SET.path, SIGA_TL.path] }),
    offlineCalls: () => [
      oc("procanim", { action: "create", path: SIGA, source: SIGA_SOURCE, confirm: true }),
      oc("procanim", edit),
      oc("procanim", { action: "validate", path: SIGA }),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, SIGA)) {
        const c = await ctx.offline("procanim", {
          action: "create",
          path: SIGA,
          source: SIGA_SOURCE,
          confirm: true,
        });
        evidence.create = briefOffline(c);
        offFail("create", c, fails);
      } else evidence.create = "already on disk (a resumed run)";
      if (!fails.length) {
        const e = await ctx.offline("procanim", edit);
        evidence.edit = briefOffline(e);
        offFail("edit", e, fails);
        const v = await ctx.offline("procanim", { action: "validate", path: SIGA });
        evidence.validate = briefOffline(v);
      }
      for (const v of [SIGA_MOVE.x, SIGA_SET.value])
        if (!fails.length && !textAt(ctx, SIGA).includes(String(v)))
          fails.push(`the .siga does not hold ${v} after the edit`);
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const a = await engineRead(ctx, SIGA, [String(SIGA_SET.value), SIGA_TL.needle], {
        watch: SIGA_TL_ROW,
        get: [SIGA_SET.path, SIGA_TL.path],
      });
      // The moved position is judged since run 6 (the handler answers VECTOR2); the reason stays recorded.
      evidence.position = sigaMissReason(a);
      return writerOutcome(ctx, id, rows, [], [a], evidence, `the .siga copy edited (${SIGA_SET.key} ${SIGA_SET.value})`);
    },
  };
}

// ── W11.3 animation_workspace .ae .aex .asy (gap 6) ──────────────────────────

/** Our .ae (and its .meta) against the smallest planted vanilla control, line by line. */
export function aeDiff(ctx: StepContext, ours: string, controls: readonly FileAccept[]): Raw {
  const byte = (rel: string): number => Buffer.byteLength(textAt(ctx, rel));
  const ctl = [...controls].sort((a, b) => byte(a.rel) - byte(b.rel))[0];
  if (!ctl) return { against: null };
  const lineDiff = (a: string, b: string): Raw[] => {
    const la = linesOf(a);
    const lb = linesOf(b);
    const out: Raw[] = [];
    for (let i = 0; i < Math.max(la.length, lb.length) && out.length < 20; i++)
      if (la[i] !== lb[i]) out.push({ line: i + 1, ours: la[i] ?? null, vanilla: lb[i] ?? null });
    return out;
  };
  const a = textAt(ctx, ours);
  const b = textAt(ctx, ctl.rel);
  return {
    against: ctl.rel,
    againstResult: ctl.result,
    identical: a === b,
    bytes: { ours: Buffer.byteLength(a), vanilla: Buffer.byteLength(b) },
    lines: lineDiff(a, b),
    meta: lineDiff(textAt(ctx, `${ours}.meta`), textAt(ctx, `${ctl.rel}.meta`)),
  };
}

function aeStep(): StepDef {
  const id = "w11-30-ae-create";
  const rows = ["mcp:action/animation_workspace.create"];
  return {
    id,
    block: "W11.3",
    title: "animation_workspace create (a workspace and its empty event table .ae), then describe the .ae and the .aw on path:",
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected:
      "create writes and registers the .aw and the .ae; the two vanilla .ae controls are described first; the engine loads both new files; the .aw names the .ae's GUID when its text holds it",
    kill_criterion:
      "the engine refuses the .ae while a vanilla control loads: FAIL with its error and a diff against the smallest control; every control refused too: the .ae is NOT-JUDGED (not a FAIL); the writer fails: FAIL",
    side_effects: [`${AW_CREATE}, ${AE_CREATED} (+ .meta)`, `a .meta beside each planted control under ${ANIM_DIR}/control/`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [AW_CREATE, AE_CREATED],
    rows,
    gap: "6",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [
      tc("wb_resources", "register", { path: AW_CREATE, confirm: true }, "registerProjectFile inside animation_workspace create"),
      tc("wb_resources", "register", { path: AE_CREATED, confirm: true }, "registerProjectFile inside animation_workspace create"),
      ...AE_CONTROLS.flatMap((c) => engineReadPlan(c.rel)),
      ...engineReadPlan(AE_CREATED),
      ...engineReadPlan(AW_CREATE),
    ],
    offlineCalls: () => [
      oc("animation_workspace", { action: "create", target: AW_CREATE }),
      oc("animation_workspace", { action: "create", target: AW_CREATE, confirm: true }),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, AW_CREATE)) {
        const dry = await ctx.offline("animation_workspace", { action: "create", target: AW_CREATE });
        evidence.dry = briefOffline(dry);
        const files = strs(rb(dry).files);
        if (dry.ok && files.some((f) => !under(f, W11_ROOT)))
          return notRun(`create would write outside ${W11_ROOT}/: ${files.join(", ")}`, evidence);
        const c = await ctx.offline("animation_workspace", {
          action: "create",
          target: AW_CREATE,
          confirm: true,
        });
        evidence.create = briefOffline(c);
        offFail("create", c, fails);
      } else evidence.create = "already on disk (a resumed run)";
      if (!fails.length && !onDisk(ctx, AE_CREATED)) fails.push(`create wrote no ${AE_CREATED}`);
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      // The vanilla controls first: whether describe on path: can load ANY .ae at all.
      const controls: FileAccept[] = [];
      const unplanted: string[] = [];
      for (const c of AE_CONTROLS) {
        if (onDisk(ctx, c.rel)) controls.push(await engineRead(ctx, c.rel, []));
        else unplanted.push(c.rel);
      }
      evidence.controls = controls.map((c) => ({ rel: c.rel, result: c.result, error: c.error ?? null, evidence: c.evidence }));
      if (unplanted.length) evidence.controlsNotPlanted = unplanted;
      const ae = await engineRead(ctx, AE_CREATED, []);
      const aeGuid = guidIn(textAt(ctx, `${AE_CREATED}.meta`));
      evidence.aeGuid = aeGuid || null;
      // animation_workspace create writes no event-table link into the .aw (workspaceSkeleton), so
      // the GUID is a needle only when the .aw text actually holds it.
      const awNamesAe = !!aeGuid && textAt(ctx, AW_CREATE).toUpperCase().includes(aeGuid);
      evidence.awNamesAe = awNamesAe;
      const aw = await engineRead(ctx, AW_CREATE, awNamesAe ? [aeGuid] : []);
      const loadedCtl = controls.filter((c) => c.result !== "REJECTED");
      if (ae.result === "REJECTED") {
        if (!loadedCtl.length) {
          ae.result = "NOT-JUDGED";
          ae.error = `the oracle cannot judge .ae: describe refused ours (${ae.error}) and ${
            controls.length
              ? `every vanilla control too (${controls.map((c) => `${c.rel.split("/").pop()}: ${c.error}`).join("; ")})`
              : "no vanilla control was planted"
          }`;
        } else evidence.diff = aeDiff(ctx, AE_CREATED, controls);
      }
      const note = awNamesAe ? "" : `; the .aw names no event table (no ${aeGuid || "GUID"} in its text)`;
      return writerOutcome(ctx, id, rows, [], [ae, aw], evidence, `workspace and event table created${note}`);
    },
  };
}

function dupStep(kind: "aex" | "asy", n: number, source: string, target: string): StepDef {
  const id = `w11-3${n}-${kind}-duplicate`;
  const dir = dirname(target).replace(/\\/g, "/");
  const rows = ["mcp:action/animation_workspace.duplicate"];
  return {
    id,
    block: "W11.3",
    title: `animation_workspace duplicate of ${source} (its .${kind} rewritten with the copies' GUIDs), then describe the .${kind} copy and the .aw copy on path:`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the dry run maps every copy under ${dir}/; the confirm copies and registers the set; the engine loads the .${kind} copy; the .aw copy names the .${kind} copy's GUID`,
    kill_criterion: `a copy mapped outside the throwaway folder: NOT-RUN, nothing written; the engine refuses the .${kind}: FAIL with its error`,
    side_effects: [`the duplicated set under ${dir}/ (+ .meta)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [dir],
    rows,
    gap: "6",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [
      tc("wb_resources", "register", { path: `${dir}/<each copy>`, confirm: true }, "registerProjectFile inside animation_workspace duplicate"),
      ...engineReadPlan(`${dir}/<the .${kind} copy>`),
      ...engineReadPlan(target),
    ],
    offlineCalls: () => [
      oc("animation_workspace", { action: "duplicate", path: source, target }),
      oc("animation_workspace", { action: "duplicate", path: source, target, confirm: true }),
    ],
    run: async (ctx) => {
      const evidence: Raw = { source };
      const fails: string[] = [];
      if (!onDisk(ctx, target)) {
        const dry = await ctx.offline("animation_workspace", { action: "duplicate", path: source, target });
        const map = Array.isArray(rb(dry).map) ? (rb(dry).map as Raw[]) : [];
        evidence.dry = { ok: dry.ok, code: dry.code ?? null, message: dry.message ?? null, map };
        if (offFail("duplicate dry run", dry, fails)) return writerOutcome(ctx, id, [], fails, [], evidence, "");
        const outside = map.map((m) => S(m.to)).filter((t) => !under(t, dir));
        if (outside.length)
          return notRun(`duplicate maps copies outside ${dir}/: ${outside.join(", ")}; nothing written`, evidence);
        if (!map.some((m) => S(m.ext).toLowerCase() === kind))
          return notRun(`the duplicate's set holds no .${kind}`, evidence);
        const c = await ctx.offline("animation_workspace", {
          action: "duplicate",
          path: source,
          target,
          confirm: true,
        });
        evidence.duplicate = briefOffline(c);
        offFail("duplicate", c, fails);
      } else evidence.duplicate = "already on disk (a resumed run)";
      const copy = filesUnder(ctx, dir).find((f) => f.toLowerCase().endsWith(`.${kind}`));
      if (!fails.length && !copy) fails.push(`no .${kind} copy under ${dir}/`);
      if (fails.length || !copy) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const copyGuid = guidIn(textAt(ctx, `${copy}.meta`));
      evidence.copy = copy;
      evidence.copyGuid = copyGuid || null;
      const a = await engineRead(ctx, copy, []);
      const w = await engineRead(ctx, target, copyGuid ? [copyGuid] : []);
      return writerOutcome(ctx, id, rows, [], [a, w], evidence, `.${kind} copy rewritten`);
    },
  };
}

// ── W11.4 refactors over the project index (gap 11) ──────────────────────────

/** A refactor plan's files outside _throwaway/W11/ (test-bed-relative, or the absolute path). */
function planOutside(ctx: StepContext, plan: RefactorPlan): string[] {
  return plan.files
    .filter((f) => !under(relOf(ctx.opts.sandboxDir, f), W11_ROOT))
    .map((f) => relOf(ctx.opts.sandboxDir, f) || f);
}

/** A .gproj under _throwaway/W11/ would shadow the test bed in a fresh index (same project ID). */
function gprojUnderThrowaway(ctx: StepContext): string[] {
  return ctx.deps.listTree(abs(ctx.opts.sandboxDir, W11_ROOT)).filter((f) => /\.gproj$/i.test(f));
}

/**
 * The referencing .conf: one `{GUID}path` value the ref scan indexes (ref-scan.ts GUID_REF_RE), in a
 * class the engine knows (SCR_EntityCatalogEntry, whose m_sEntityPrefab is a ResourceName that
 * describe answers a value for), so w11-42 can have the engine read the rewritten reference. Runs 3
 * to 5 used an unknown class (W11_RefProbe), which no engine read could judge.
 */
export const REF_CONF_CLASS = "SCR_EntityCatalogEntry";
export const REF_CONF_VAR = "m_sEntityPrefab";
export function refConfText(resourceName: string): string {
  return `${REF_CONF_CLASS} {\n ${REF_CONF_VAR} "${resourceName}"\n}\n`;
}

function replaceGuidStep(): StepDef {
  const id = "w11-40-replace-guid";
  const rows = ["mcp:action/refactor_replace_guid.run", "mcp:action/config_edit.createInherited"];
  return {
    id,
    block: "W11.4",
    title:
      "refactor_replace_guid: a planted parent .physmat registered, a child made by config_edit createInherited, the parent's GUID replaced (plan checked first), then the child described on path:",
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the plan holds ${REF_CONF} (a .conf that names the parent, written by the battery) and only files under ${REFACTOR_DIR}/; the commit rewrites it, the parent's .meta and the child's ancestor; the engine loads the child with its own Friction ${REF_CHILD_FRICTION} and the parent's Restitution`,
    kill_criterion:
      "a plan file outside the throwaway folder, or a plan without the .conf: NOT-RUN, nothing committed; the parent's .meta or the child left on the old GUID: FAIL naming it; the engine refuses the child: FAIL with its error",
    side_effects: [`${REF_CONF} written by the battery`, `${REF_CONF}, ${REF_PARENT}.meta and ${REF_CHILD} rewritten (+ .bak)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [REF_PARENT, REF_CHILD, REF_CONF],
    rows,
    gap: "11",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [
      tc("wb_resources", "register", { path: REF_PARENT, confirm: true }),
      tc("wb_resources", "register", { path: REF_CHILD, confirm: true }),
      tc("wb_resources", "register", { path: REF_PARENT, confirm: true }, "after the replace: the new GUID"),
      ...engineReadPlan(REF_CHILD),
    ],
    offlineCalls: () => [
      oc("config_edit", {
        action: "createInherited",
        path: REF_PARENT,
        ancestor: "<the parent's resource name>",
        newPath: REF_CHILD,
        values: { Friction: REF_CHILD_FRICTION },
        confirm: true,
      }),
      oc("refactor_replace_guid", { old_guid: "<the parent's GUID>", new_guid: "<minted>", commit: false, force: true, include_workshop: false }),
      oc("refactor_replace_guid", { old_guid: "<the parent's GUID>", new_guid: "<minted>", commit: true, force: true, include_workshop: false }),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, REF_PARENT)) return notRun(`${REF_PARENT} is not planted`, evidence);
      const shadow = gprojUnderThrowaway(ctx);
      if (shadow.length)
        return notRun(`a .gproj under ${W11_ROOT}/ would shadow the test bed in the index: ${shadow.join(", ")}`, evidence);
      const reg = await ctx.tool("wb_resources", { action: "register", path: REF_PARENT, confirm: true });
      evidence.registerParent = brief(reg);
      const parentName = S(rb(reg).resourceName);
      const oldGuid = guidIn(parentName) || guidIn(textAt(ctx, `${REF_PARENT}.meta`));
      if (!oldGuid) return notRun(`the parent has no GUID after register (${why(reg)})`, evidence);
      if (!onDisk(ctx, REF_CHILD)) {
        const ci = await ctx.offline("config_edit", {
          action: "createInherited",
          path: REF_PARENT,
          ancestor: parentName || `{${oldGuid}}${REF_PARENT}`,
          newPath: REF_CHILD,
          values: { Friction: REF_CHILD_FRICTION },
          confirm: true,
        });
        evidence.createInherited = briefOffline(ci);
        if (offFail("createInherited", ci, fails)) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      }
      evidence.registerChild = brief(await ctx.tool("wb_resources", { action: "register", path: REF_CHILD, confirm: true }));
      // A scanned file that references the parent (the index never scans the .physmat child).
      const refName = parentName || `{${oldGuid}}${REF_PARENT}`;
      if (!onDisk(ctx, REF_CONF))
        ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, REF_CONF), Buffer.from(refConfText(refName), "utf-8"));
      evidence.refConf = { path: REF_CONF, references: refName };
      const newGuid = ctx.deps.newGuid();
      evidence.oldGuid = oldGuid;
      evidence.newGuid = newGuid;
      const args = { old_guid: oldGuid, new_guid: newGuid, force: true, include_workshop: false };
      const plan = await ctx.deps.refactorPlan("replace_guid", args);
      evidence.plan = { ok: plan.ok, detail: plan.detail, files: plan.files.map((f) => relOf(ctx.opts.sandboxDir, f) || f) };
      if (!plan.ok) return notRun(`the replace plan failed: ${plan.detail}`, evidence);
      const outside = planOutside(ctx, plan);
      if (outside.length) return notRun(`the replace plan touches files outside ${W11_ROOT}/: ${outside.join(", ")}`, evidence);
      if (!plan.files.length) return notRun("the replace plan holds no file", evidence);
      if (!plan.files.some((f) => under(relOf(ctx.opts.sandboxDir, f), REF_CONF)))
        return notRun(`the replace plan does not hold ${REF_CONF}`, evidence);
      const dry = await ctx.offline("refactor_replace_guid", { ...args, commit: false });
      evidence.dry = briefOffline(dry);
      const c = await ctx.offline("refactor_replace_guid", { ...args, commit: true });
      evidence.commit = briefOffline(c);
      offFail("commit", c, fails);
      if (!fails.length && !textAt(ctx, REF_CONF).toUpperCase().includes(newGuid))
        fails.push(`${REF_CONF} does not name ${newGuid} after the commit`);
      // The GUID's owner is the parent's .meta; the plan's owner lookup reads the index's resources
      // table, which never holds a .meta GUID, so the .meta is left on the old GUID.
      const metaGuid = guidIn(textAt(ctx, `${REF_PARENT}.meta`));
      evidence.parentMetaGuidAfter = metaGuid || null;
      evidence.childNamesNew = textAt(ctx, REF_CHILD).toUpperCase().includes(newGuid);
      if (!fails.length && metaGuid !== newGuid)
        fails.push(
          `${REF_PARENT}.meta still holds ${metaGuid || "no GUID"} after the commit: the rewritten reference names ${newGuid}, which no resource owns`,
        );
      if (!fails.length && !evidence.childNamesNew) fails.push(`the child does not name ${newGuid} after the commit`);
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      evidence.reregisterParent = brief(await ctx.tool("wb_resources", { action: "register", path: REF_PARENT, confirm: true }));
      const restitution = /Restitution\s+([-\d.]+)/.exec(textAt(ctx, REF_PARENT))?.[1] ?? "";
      const a = await engineRead(ctx, REF_CHILD, [String(REF_CHILD_FRICTION), ...(restitution ? [restitution] : [])]);
      return writerOutcome(ctx, id, rows, [], [a], evidence, `${oldGuid} -> ${newGuid}`);
    },
  };
}

/**
 * The .conf reference w11-40 rewrote, read by the engine (audit: "refactor_replace_guid: a .conf
 * reference"). Read only: it writes nothing but the register's .meta. NOT-RUN unless w11-40 left
 * the .conf naming the parent's current GUID.
 */
function replaceGuidConfStep(): StepDef {
  const id = "w11-42-replace-guid-conf";
  const rows = ["mcp:action/refactor_replace_guid.run"];
  return {
    id,
    block: "W11.4",
    title: `the ${REF_CONF} w11-40 rewrote, registered and described on path: (the reference names the new GUID)`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the engine loads ${REF_CONF} and reads ${REF_CONF_VAR} with the parent's new GUID`,
    kill_criterion: "the engine refuses the .conf: FAIL with its error; w11-40 did not rewrite it: NOT-RUN",
    side_effects: [`${REF_CONF}.meta (register)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [],
    rows,
    gap: "11",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => engineReadPlan(REF_CONF, { get: [REF_CONF_VAR] }),
    offlineCalls: () => [],
    run: async (ctx) => {
      const evidence: Raw = {};
      if (!onDisk(ctx, REF_CONF)) return notRun(`${REF_CONF} is not on disk: run w11-40 first`, evidence);
      const text = textAt(ctx, REF_CONF);
      const named = guidIn(text);
      const parentGuid = guidIn(textAt(ctx, `${REF_PARENT}.meta`));
      Object.assign(evidence, { named: named || null, parentGuid: parentGuid || null });
      if (!text.includes(REF_CONF_CLASS))
        return notRun(
          `${REF_CONF} is not the ${REF_CONF_CLASS} fixture (an older run's file): roll back and rerun w11-40`,
          evidence,
        );
      if (!named || named !== parentGuid)
        return notRun(
          `${REF_CONF} names ${named || "no GUID"}, the parent's .meta ${parentGuid || "none"}: w11-40 did not commit`,
          evidence,
        );
      const a = await engineRead(ctx, REF_CONF, [named], { get: [REF_CONF_VAR] });
      return writerOutcome(ctx, id, rows, [], [a], evidence, `the rewritten reference names ${named}`);
    },
  };
}

function movePathStep(): StepDef {
  const id = "w11-41-move-resource-path";
  const rows = ["mcp:action/refactor_move_resource_path.run"];
  return {
    id,
    block: "W11.4",
    title: "refactor_move_resource_path: a planted .physmat registered, moved (plan checked first), then the moved file described on path:",
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the plan touches only files under ${REFACTOR_DIR}/; the file and its .meta move; the engine loads the file at the new path`,
    kill_criterion: "a plan file outside the throwaway folder: NOT-RUN, nothing committed; the engine refuses the moved file: FAIL with its error",
    side_effects: [`${MOVE_SOURCE} moved to ${MOVE_TARGET} (+ .meta)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [MOVE_SOURCE, MOVE_TARGET],
    rows,
    gap: "11",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [tc("wb_resources", "register", { path: MOVE_SOURCE, confirm: true }), ...engineReadPlan(MOVE_TARGET)],
    offlineCalls: () => [
      oc("refactor_move_resource_path", { project_root: "<sandbox>", old_path: MOVE_SOURCE, new_path: MOVE_TARGET, commit: false, force: true }),
      oc("refactor_move_resource_path", { project_root: "<sandbox>", old_path: MOVE_SOURCE, new_path: MOVE_TARGET, commit: true, force: true }),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, MOVE_TARGET)) {
        if (!onDisk(ctx, MOVE_SOURCE)) return notRun(`${MOVE_SOURCE} is not planted`, evidence);
        const shadow = gprojUnderThrowaway(ctx);
        if (shadow.length)
          return notRun(`a .gproj under ${W11_ROOT}/ would shadow the test bed in the index: ${shadow.join(", ")}`, evidence);
        evidence.register = brief(await ctx.tool("wb_resources", { action: "register", path: MOVE_SOURCE, confirm: true }));
        if (!guidIn(textAt(ctx, `${MOVE_SOURCE}.meta`))) return notRun("the file has no .meta GUID after register", evidence);
        const args = { project_root: ctx.opts.sandboxDir, old_path: MOVE_SOURCE, new_path: MOVE_TARGET, force: true };
        const plan = await ctx.deps.refactorPlan("move_resource_path", args);
        evidence.plan = { ok: plan.ok, detail: plan.detail, files: plan.files.map((f) => relOf(ctx.opts.sandboxDir, f) || f) };
        if (!plan.ok) return notRun(`the move plan failed: ${plan.detail}`, evidence);
        const outside = planOutside(ctx, plan);
        if (outside.length) return notRun(`the move plan touches files outside ${W11_ROOT}/: ${outside.join(", ")}`, evidence);
        const dry = await ctx.offline("refactor_move_resource_path", { ...args, commit: false });
        evidence.dry = briefOffline(dry);
        const c = await ctx.offline("refactor_move_resource_path", { ...args, commit: true });
        evidence.commit = briefOffline(c);
        // The tool answers a refusal as ordinary text (no isError), even with commit: true.
        if (!offFail("commit", c, fails) && /❌/.test(S(c.message)))
          fails.push(`commit refused in its text: ${S(c.message).split("\n").find((l) => l.includes("❌"))?.trim()}`);
      } else evidence.move = "already moved (a resumed run)";
      if (!fails.length && (!onDisk(ctx, MOVE_TARGET) || !onDisk(ctx, `${MOVE_TARGET}.meta`)))
        fails.push("the file or its .meta is not at the new path");
      if (!fails.length && onDisk(ctx, MOVE_SOURCE)) fails.push("the old path still holds the file");
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      if (!textAt(ctx, MOVE_TARGET).includes(MOVE_FIXTURE_ID)) fails.push("the moved file is not the planted fixture");
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const a = await engineRead(ctx, MOVE_TARGET, []);
      return writerOutcome(ctx, id, rows, [], [a], evidence, "moved");
    },
  };
}

// ── W11.5 scenario .layer writes (gap 9) ─────────────────────────────────────

function scenFiles(s: { dir: string; name: string }) {
  const layers = `${s.dir}/Worlds/${s.name}_Layers`;
  return {
    conf: `${s.dir}/Missions/${s.name}.conf`,
    ent: `${s.dir}/Worlds/${s.name}.ent`,
    layers,
    def: `${layers}/default.layer`,
    bases: `${layers}/Bases.layer`,
    defenders: `${layers}/Defenders.layer`,
    clone: `${layers}/${CLONE_LAYER}`,
  };
}

function scenArgs(ctx: StepContext | null, s: { dir: string; name: string }): Raw {
  return {
    scenarioName: s.name,
    worldName: SCENARIO_WORLD,
    bases: SCENARIO_BASES,
    civVehicleCount: 0,
    projectPath: ctx ? abs(ctx.opts.sandboxDir, s.dir) : `<sandbox>/${s.dir}`,
  };
}

function scenarioCreateStep(): StepDef {
  const id = "w11-50-scenario-create";
  const A = scenFiles(SCEN_A);
  const B = scenFiles(SCEN_B);
  const rows = ["mcp:action/scenario_create_conflict.run"];
  return {
    id,
    block: "W11.5",
    title: `scenario_create_conflict writes two scenarios on ${SCENARIO_WORLD} (A read now, B edited by w11-51/52); A's mission header described, A's world opened and its layers listed`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.open + TIMEOUTS.writer,
    expected: "both scenarios written; the engine loads A's mission header; A's world opens in the World Editor and lists default, Bases and Defenders with entities",
    kill_criterion: "the world does not open or a layer is not listed: FAIL with the engine's answer; the writer fails: FAIL",
    side_effects: [`${SCEN_A.dir}/ and ${SCEN_B.dir}/ written (+ .meta); the World Editor opens A (never saved)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/ after Workbench is closed",
    writes: [SCEN_A.dir, SCEN_B.dir],
    rows,
    gap: "9",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [...engineReadPlan(A.conf), ...worldReadPlan(A.ent)],
    offlineCalls: () => [oc("scenario_create_conflict", scenArgs(null, SCEN_A)), oc("scenario_create_conflict", scenArgs(null, SCEN_B))],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      for (const [k, s] of [["a", SCEN_A], ["b", SCEN_B]] as const) {
        if (onDisk(ctx, scenFiles(s).ent)) {
          evidence[k] = "already on disk (a resumed run)";
          continue;
        }
        const r = await ctx.offline("scenario_create_conflict", scenArgs(ctx, s));
        evidence[k] = briefOffline(r);
        offFail(`create ${s.name}`, r, fails);
        if (!fails.length && !onDisk(ctx, scenFiles(s).ent)) fails.push(`no ${scenFiles(s).ent} after the create`);
      }
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const conf = await engineRead(ctx, A.conf, [SCEN_A.name]);
      const w = await worldRead(ctx, A.ent, [
        { file: A.def, minEntities: 1 },
        { file: A.bases, minEntities: 1 },
        { file: A.defenders, minEntities: 1 },
      ]);
      evidence.world = w.evidence;
      return writerOutcome(ctx, id, rows, [], [conf, ...w.accepts], evidence, "scenario A loads");
    },
  };
}

function applyTemplateStep(): StepDef {
  const id = "w11-51-apply-template";
  const B = scenFiles(SCEN_B);
  const args = (ctx: StepContext | null, dry: boolean): Raw => ({
    target_layer_path: ctx ? abs(ctx.opts.sandboxDir, B.defenders) : `<sandbox>/${B.defenders}`,
    template_name: TEMPLATE_NAME,
    position: TEMPLATE_POSITION,
    rotation_yaw_deg: 0,
    dry_run: dry,
    force: true,
  });
  return {
    id,
    block: "W11.5",
    title: `scenario_apply_template ${TEMPLATE_NAME} into B's Defenders.layer (offline; the engine reads it in w11-53)`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: "the dry run writes nothing; the write leaves a .bak and a longer layer",
    kill_criterion: "the writer fails or the dry run writes: FAIL",
    side_effects: [`${B.defenders} rewritten (+ .bak)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [B.defenders],
    rows: [],
    gap: "9",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [],
    offlineCalls: () => [oc("scenario_apply_template", args(null, true)), oc("scenario_apply_template", args(null, false))],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, B.defenders)) return notRun(`${B.defenders} is absent: run w11-50 first`, evidence);
      if (onDisk(ctx, `${B.defenders}.bak`)) return { status: "PASS", detail: "already applied (a resumed run)", evidence };
      const before = ctx.deps.readBytes(abs(ctx.opts.sandboxDir, B.defenders));
      const dry = await ctx.offline("scenario_apply_template", args(ctx, true));
      evidence.dry = briefOffline(dry);
      offFail("dry run", dry, fails);
      if (!before.equals(ctx.deps.readBytes(abs(ctx.opts.sandboxDir, B.defenders)))) fails.push("the dry run wrote");
      const w = await ctx.offline("scenario_apply_template", args(ctx, false));
      evidence.write = briefOffline(w);
      offFail("write", w, fails);
      const after = textAt(ctx, B.defenders);
      evidence.bytes = { before: before.length, after: Buffer.byteLength(after) };
      if (!fails.length && Buffer.byteLength(after) <= before.length) fails.push("the layer did not grow");
      if (!fails.length && !onDisk(ctx, `${B.defenders}.bak`)) fails.push("no .bak beside the layer");
      return { ...verdictOf(fails, "template stamped; the engine reads B in w11-53"), evidence };
    },
  };
}

function cloneAreaStep(): StepDef {
  const id = "w11-52-clone-area";
  const B = scenFiles(SCEN_B);
  const args = (ctx: StepContext | null, dry: boolean): Raw => ({
    source_layer_path: ctx ? abs(ctx.opts.sandboxDir, B.bases) : `<sandbox>/${B.bases}`,
    dest_layer_path: ctx ? abs(ctx.opts.sandboxDir, B.clone) : `<sandbox>/${B.clone}`,
    area: CLONE_AREA,
    translate: CLONE_TRANSLATE,
    dry_run: dry,
    force: true,
  });
  return {
    id,
    block: "W11.5",
    title: `scenario_clone_area from B's Bases.layer into ${CLONE_LAYER} (offline; the engine reads it in w11-53)`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: "the dry run writes nothing; the write creates the clone layer",
    kill_criterion: "the writer fails or the dry run writes: FAIL",
    side_effects: [`${B.clone} written`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [B.clone],
    rows: [],
    gap: "9",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [],
    offlineCalls: () => [
      oc("scenario_clone_area", { ...args(null, true), source_layer_path: `<sandbox>/${B.bases}` }),
      oc("scenario_clone_area", args(null, false)),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, B.bases)) return notRun(`${B.bases} is absent: run w11-50 first`, evidence);
      if (onDisk(ctx, B.clone)) return { status: "PASS", detail: "already cloned (a resumed run)", evidence };
      const dry = await ctx.offline("scenario_clone_area", args(ctx, true));
      evidence.dry = briefOffline(dry);
      offFail("dry run", dry, fails);
      if (onDisk(ctx, B.clone)) fails.push("the dry run wrote");
      const w = await ctx.offline("scenario_clone_area", args(ctx, false));
      evidence.write = briefOffline(w);
      offFail("write", w, fails);
      if (!fails.length && !onDisk(ctx, B.clone)) fails.push("no clone layer after the write");
      return { ...verdictOf(fails, "area cloned; the engine reads B in w11-53"), evidence };
    },
  };
}

function scenarioOpenStep(): StepDef {
  const id = "w11-53-scenario-open";
  const B = scenFiles(SCEN_B);
  return {
    id,
    block: "W11.5",
    title: `B's world opened in the World Editor: its layers listed, Defenders.layer (apply_template) and ${CLONE_LAYER} (clone_area) with their entities`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.open + 60_000,
    expected: `B opens; the World Editor lists Defenders and ${CLONE_LAYER}, each with entities`,
    kill_criterion: "the world does not open or a layer is not listed: FAIL with the engine's answer",
    side_effects: ["the World Editor opens B (never saved)"],
    rollback: "none: nothing is edited; `w11.live.ts rollback` removes the files",
    writes: [],
    rows: ["mcp:action/scenario_apply_template.run", "mcp:action/scenario_clone_area.run"],
    gap: "9",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => worldReadPlan(B.ent),
    offlineCalls: () => [],
    run: async (ctx) => {
      const evidence: Raw = {};
      const missing = [B.ent, `${B.defenders}.bak`, B.clone].filter((f) => !onDisk(ctx, f));
      if (missing.length) return notRun(`not written yet: ${missing.join(", ")} (w11-50, 51, 52)`, evidence);
      const w = await worldRead(ctx, B.ent, [
        { file: B.defenders, minEntities: 1 },
        { file: B.clone, minEntities: 1 },
      ]);
      evidence.world = w.evidence;
      const by = (f: string) => w.accepts.filter((a) => a.rel === B.ent || a.rel === f);
      // One live result per writer: each names its own layer's read.
      const tpl = writerOutcome(ctx, id, ["mcp:action/scenario_apply_template.run"], [], by(B.defenders), {}, "template layer");
      const cln = writerOutcome(ctx, id, ["mcp:action/scenario_clone_area.run"], [], by(B.clone), {}, "clone layer");
      const out = writerOutcome(ctx, id, [], [], w.accepts, evidence, "scenario B loads");
      out.results = { file: liveFileOf(id), lines: [...(tpl.results?.lines ?? []), ...(cln.results?.lines ?? [])] };
      evidence.perWriter = { apply_template: tpl.status, clone_area: cln.status };
      return out;
    },
  };
}

/** wb_entity_duplicate's copy: a named vanilla-prefab entity of B's default.layer, saved as a new .et. */
export const ENTITY_DUP_DIR = `${CREATE_DIR}/entity-duplicate`;
export const ENTITY_DUP_DEST = `${ENTITY_DUP_DIR}/W11_entdup.et`;

/**
 * The first named entity of a layer text whose prefab is a vanilla one (`Prefabs/...` with a real
 * GUID): `<Class> <Name> : "{GUID}Prefabs/....et"`. Template placeholders (`{000000000000000n}`)
 * are skipped: their ancestor is in no pak.
 */
export function namedVanillaEntity(text: string): { cls: string; name: string; prefab: string } | null {
  const re = /^(\w+) (\w+) : "\{([0-9A-Fa-f]{16})\}(Prefabs\/[^"]+\.et)"/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (/^0{15}[0-9A-Fa-f]$/.test(m[3]!)) continue;
    return { cls: m[1]!, name: m[2]!, prefab: m[4]! };
  }
  return null;
}

function entityDuplicateStep(): StepDef {
  const id = "w11-54-entity-duplicate";
  const row = "mcp:action/wb_entity_duplicate.run";
  const B = scenFiles(SCEN_B);
  const args = (name: string): Raw => ({
    entityName: name,
    destPath: ENTITY_DUP_DEST,
    modName: SANDBOX_NAME,
    replaceInScene: false,
  });
  return {
    id,
    block: "W11.5",
    title: `wb_entity_duplicate (replaceInScene false) of a named vanilla-prefab entity in B's default.layer: the placed entity written by createTemplate to ${ENTITY_DUP_DEST}, then described on path:`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `B is open (w11-53); createTemplate (confirm) writes ${ENTITY_DUP_DEST} and answers its resource name (else the tool registers it); the engine loads the file; the entity becomes an instance of it (the handler's one undo step), nothing is created or deleted`,
    kill_criterion: "no named vanilla entity in B, or B not open: NOT-RUN; the tool fails: FAIL; the engine refuses the copy: FAIL with its error",
    side_effects: [`${ENTITY_DUP_DEST} (+ .meta); in B (in memory, unsaved) the entity becomes an instance of the new prefab; nothing created or deleted (replaceInScene false)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [ENTITY_DUP_DIR],
    rows: [row],
    gap: "10",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [
      { kind: "net-call", target: "EMCP_WB_GetState", note: "the tool's edit-mode gate (a read)" } as PlanAction,
      {
        kind: "net-call",
        target: "EMCP_WB_Prefabs",
        params: { action: "createTemplate", entity: "name:<the default.layer entity>", path: ENTITY_DUP_DEST, confirm: true },
        note: "inside wb_entity_duplicate, in process (open-findings lta-08)",
      } as PlanAction,
      tc("wb_resources", "register", { path: ENTITY_DUP_DEST, confirm: true }, "registerProjectFile inside wb_entity_duplicate, only when createTemplate answers no resource name and left no .meta"),
      ...engineReadPlan(ENTITY_DUP_DEST),
    ],
    offlineCalls: () => [oc("wb_entity_duplicate", args("<the default.layer entity>"))],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, B.def)) return notRun(`not written yet: ${B.def} (w11-50)`, evidence);
      const ent = namedVanillaEntity(textAt(ctx, B.def));
      if (!ent) return notRun(`no named vanilla-prefab entity in ${B.def}`, evidence);
      evidence.entity = ent;
      if (onDisk(ctx, ENTITY_DUP_DEST)) evidence.write = "already on disk (a resumed run)";
      else {
        const st = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
        const wp = S(rb(st).worldPath);
        evidence.worldPath = wp || null;
        if (!wp.endsWith(B.ent)) return notRun(`B is not the open world (worldPath ${wp || "none"}): w11-53 opens it`, evidence);
        const r = await ctx.offline("wb_entity_duplicate", args(ent.name));
        evidence.write = briefOffline(r);
        offFail("wb_entity_duplicate", r, fails);
        if (!fails.length && !onDisk(ctx, ENTITY_DUP_DEST)) fails.push(`wb_entity_duplicate wrote no ${ENTITY_DUP_DEST}`);
      }
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const a = await engineRead(ctx, ENTITY_DUP_DEST, []);
      return writerOutcome(ctx, id, [row], [], [a], evidence, `${ent.name} (${ent.prefab}) saved as a new .et`);
    },
  };
}

// ── W11.6 template creators and copies (gap 10) ──────────────────────────────

interface CreatorSpec {
  n: number;
  /** The step id, when it is not `w11-6<n>-<slug>`. */
  id?: string;
  tool: OfflineTool;
  slug: string;
  row: string;
  /** Files of these types under the case folder are read by the engine. */
  ext: RegExp;
  read: "container" | "gproj" | "script";
  /** Per file, when the case writes more than one kind (mod with a pattern: .c and .conf). */
  readOf?: (file: string) => "container" | "gproj" | "script";
  args: (ctx: StepContext | null, dir: string) => Raw;
  needles?: (text: string) => string[];
  /** The second read-back's container paths (engineRead `get`), sent when describe misses a needle. */
  get?: readonly string[];
  /** Before the call (a fixture the call reads). */
  prepare?: (ctx: StepContext, dir: string) => string | null;
}

export const BUILDING_MANIFEST = {
  building_name: "W11_Building",
  export_root: "W11",
  structure: { fbx: "W11/W11_Building.fbx", sockets: ["socket_part_01"] },
  parts: [
    {
      name: "W11_Part",
      type: "wall",
      socket_prefix: "socket_",
      socket_name: "socket_part_01",
      unique: true,
      fbx: "W11/W11_Part.fbx",
      phases: [{ index: 1, fbx: "W11/W11_Part_dst1.fbx" }],
    },
  ],
} as const;

export const CREATORS: readonly CreatorSpec[] = [
  {
    n: 0,
    tool: "prefab",
    slug: "prefab",
    row: "mcp:action/prefab.create",
    ext: /\.et$/i,
    read: "container",
    args: (ctx, dir) => ({ action: "create", name: "W11_Prop", prefabType: "prop", projectPath: ctxAbs(ctx, dir) }),
  },
  {
    n: 1,
    tool: "layout_create",
    slug: "layout-create",
    row: "mcp:action/layout_create.run",
    ext: /\.layout$/i,
    read: "container",
    args: (ctx, dir) => ({ name: "W11_Hud", layoutType: "hud", projectPath: ctxAbs(ctx, dir) }),
  },
  {
    n: 2,
    tool: "config_create",
    slug: "config-create",
    row: "mcp:action/config_create.run",
    ext: /\.conf$/i,
    read: "container",
    args: (ctx, dir) => ({
      configType: "entity-catalog",
      name: "W11_Catalog",
      categoryName: "W11",
      prefabRefs: [],
      projectPath: ctxAbs(ctx, dir),
    }),
  },
  {
    n: 3,
    tool: "faction_create",
    slug: "faction-create",
    row: "mcp:action/faction_create.run",
    ext: /\.conf$/i,
    read: "container",
    args: (_ctx, dir) => ({
      faction_key: "W11F",
      display_name: "W11 Faction",
      color_rgb: { r: 40, g: 120, b: 200 },
      out_path: `${dir}/W11_Faction.conf`,
      dry_run: false,
      // The test bed is a git repo and _throwaway/ is untracked, so the git-clean guard refuses
      // (run 2). force also allows an overwrite; the path is new under the throwaway folder.
      force: true,
    }),
    needles: () => ["W11F"],
    // W11 run 5: describe (43 rows) did not show the key. Run 6: get m_sFactionKey answered
    // PATH_NOT_FOUND, siblings FactionKey, FactionColor, UIInfo: the engine's SCR_Faction variable is
    // FactionKey. faction_create writes m_sFactionKey, which the engine does not read (a tool defect,
    // recorded in the runbook), so this stays PARTIAL until the tool writes FactionKey.
    get: ["FactionKey"],
  },
  {
    n: 4,
    tool: "building_setup",
    slug: "building-setup",
    row: "mcp:action/building_setup.run",
    ext: /\.et$/i,
    read: "container",
    args: (ctx, dir) => ({
      manifestPath: ctx ? join(ctx.opts.sittingDir, BUILDING_MANIFEST_FILE) : `<sitting>/${BUILDING_MANIFEST_FILE}`,
      modPrefix: "",
      outputDir: ctxAbs(ctx, dir),
      dryRun: false,
    }),
    prepare: (ctx) => {
      writeJson(join(ctx.opts.sittingDir, BUILDING_MANIFEST_FILE), BUILDING_MANIFEST, ctx.deps);
      return null;
    },
  },
  {
    n: 5,
    tool: "game_duplicate",
    slug: "game-duplicate",
    row: "mcp:action/game_duplicate.run",
    ext: /\.et$/i,
    read: "container",
    args: (_ctx, dir) => ({ sourcePath: GAME_DUP_SOURCE, destPath: `${dir}/W11_dup.et`, modName: SANDBOX_NAME, register: false }),
  },
  {
    n: 6,
    tool: "project",
    slug: "project-write",
    row: "mcp:action/project.write",
    ext: /\.physmat$/i,
    read: "container",
    args: (ctx, dir) => ({
      action: "write",
      path: "W11_project.physmat",
      content: ctx ? textAt(ctx, CONFIG_CASES[2]!.rel) || "<the planted .physmat text>" : "<the planted .physmat text>",
      createDirectories: true,
      projectPath: ctxAbs(ctx, dir),
    }),
    prepare: (ctx) => (onDisk(ctx, CONFIG_CASES[2]!.rel) ? null : `${CONFIG_CASES[2]!.rel} is not planted`),
    needles: (t) => {
      const f = /Friction\s+([-\d.]+)/.exec(t)?.[1];
      return f ? [f] : [];
    },
  },
  {
    n: 7,
    tool: "script_create",
    slug: "script-create",
    row: "mcp:action/script_create.run",
    ext: /\.c$/i,
    read: "script",
    args: (ctx, dir) => ({ className: "W11_ProbeComponent", scriptType: "component", projectPath: ctxAbs(ctx, dir) }),
  },
  {
    n: 8,
    tool: "mod",
    slug: "mod-create",
    row: "mcp:action/mod.create",
    ext: /\.gproj$/i,
    read: "gproj",
    args: (ctx, dir) => ({ action: "create", name: "W11Addon", projectPath: ctxAbs(ctx, dir) }),
    needles: () => ["W11Addon"],
  },
  {
    // game_duplicate's .conf copy (audit: "game_duplicate: .conf copy"); the .et copy is w11-65.
    n: 9,
    tool: "game_duplicate",
    slug: "game-duplicate-conf",
    row: "mcp:action/game_duplicate.run",
    ext: /\.conf$/i,
    read: "container",
    args: (_ctx, dir) => ({
      sourcePath: GAME_DUP_CONF_SOURCE,
      destPath: `${dir}/W11_dup.conf`,
      modName: SANDBOX_NAME,
      register: false,
    }),
    needles: (t) => {
      const g = /"\{([0-9A-Fa-f]{16})\}/.exec(t)?.[1];
      return g ? [g.toUpperCase()] : [];
    },
    get: ["NavmeshFile"],
  },
  {
    // mod create with a pattern: the .c scripts and the .conf it writes (audit: "mod: .c .conf");
    // the bare create (w11-68) writes the .gproj alone.
    n: 10,
    id: "w11-6a-mod-pattern",
    tool: "mod",
    slug: "mod-pattern",
    row: "mcp:action/mod.create",
    ext: /\.(c|conf)$/i,
    read: "container",
    readOf: (f) => (/\.c$/i.test(f) ? "script" : "container"),
    args: (ctx, dir) => ({
      action: "create",
      name: "W11AddonGM",
      prefix: MOD_PATTERN_PREFIX,
      pattern: MOD_PATTERN,
      projectPath: ctxAbs(ctx, dir),
    }),
    needles: (t) => {
      const v = /m_sName\s+"([^"]+)"/.exec(t)?.[1];
      return v ? [v] : [];
    },
    get: ["m_sName"],
  },
];

function ctxAbs(ctx: StepContext | null, rel: string): string {
  return ctx ? abs(ctx.opts.sandboxDir, rel) : `<sandbox>/${rel}`;
}

function creatorStep(c: CreatorSpec): StepDef {
  const id = c.id ?? `w11-6${c.n}-${c.slug}`;
  const dir = `${CREATE_DIR}/${c.slug}`;
  const readWord =
    c.read === "script"
      ? "opened in the Script Editor and read back (not compiled)"
      : c.read === "gproj"
        ? "described on path: (a .gproj is not registered)"
        : "registered and described on path:";
  return {
    id,
    block: "W11.6",
    title: `${c.tool} writes under ${dir}/; each new ${c.ext.source.replace(/[\\$]/g, "").replace("i", "")} file ${readWord}`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the tool writes at least one new file under ${dir}/; the engine loads each (at most 3 read)`,
    kill_criterion: "the engine refuses a file: FAIL with its error; the tool writes nothing or fails: FAIL",
    side_effects: [`new files under ${dir}/ (+ .meta)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [dir],
    rows: [c.row],
    gap: "10",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [
      ...(c.read === "script" || c.readOf
        ? scriptReadPlan(`${dir}/<the new ${c.readOf ? ".c " : ""}file>`)
        : []),
      ...(c.read !== "script"
        ? engineReadPlan(`${dir}/<each new ${c.readOf ? ".conf " : ""}file>`, {
            noRegister: c.read === "gproj",
            ...(c.get ? { get: c.get } : {}),
          })
        : []),
    ],
    offlineCalls: () => [oc(c.tool, c.args(null, dir))],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      const blocked = c.prepare?.(ctx, dir) ?? null;
      if (blocked) return notRun(blocked, evidence);
      const before = filesUnder(ctx, dir);
      let made = before.filter((f) => c.ext.test(f));
      if (made.length) evidence.write = "already on disk (a resumed run)";
      else {
        const r = await ctx.offline(c.tool, c.args(ctx, dir));
        evidence.write = briefOffline(r);
        offFail(c.tool, r, fails);
        made = newFiles(before, filesUnder(ctx, dir), c.ext);
        if (!fails.length && !made.length) fails.push(`${c.tool} wrote no ${c.ext.source} file under ${dir}/`);
      }
      evidence.files = made;
      const outside = made.filter((f) => !under(f, dir));
      if (outside.length) fails.push(`written outside ${dir}/: ${outside.join(", ")}`);
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const accepts: FileAccept[] = [];
      for (const f of made.slice(0, 3)) {
        const needles = c.needles?.(textAt(ctx, f)) ?? [];
        const read = c.readOf?.(f) ?? c.read;
        accepts.push(
          read === "script"
            ? await scriptRead(ctx, f)
            : await engineRead(ctx, f, needles, {
                noRegister: read === "gproj",
                ...(c.get ? { get: c.get } : {}),
              }),
        );
      }
      return writerOutcome(ctx, id, [c.row], [], accepts, evidence, `${made.length} file(s) written`);
    },
  };
}

// ── W11.7 byte splices on .gproj copies and a script (gap 11) ────────────────

/** The project ID of a .gproj text ("" when none). */
export function gprojId(text: string): string {
  return /^\s*ID\s+"([^"]+)"/m.exec(text)?.[1] ?? "";
}

/**
 * The fixture for normalize: the first dependency line doubled, so the normaliser has a duplicate
 * to drop. Returns the text unchanged when the copy has no Dependencies block.
 */
export function withDuplicateDependency(text: string): { text: string; dep: string } {
  const m = /(Dependencies\s*\{\r?\n)(\s*"([0-9A-Fa-f]{16})"\r?\n)/.exec(text);
  if (!m) return { text, dep: "" };
  const at = m.index + m[1]!.length;
  return { text: text.slice(0, at) + m[2]! + text.slice(at), dep: m[3]!.toUpperCase() };
}

function copyGproj(ctx: StepContext, rel: string): boolean {
  const src = join(ctx.opts.sandboxDir, `${SANDBOX_NAME}.gproj`);
  if (!ctx.deps.exists(src)) return false;
  ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, rel), ctx.deps.readBytes(src));
  return true;
}

function renameIdStep(): StepDef {
  const id = "w11-70-rename-project-id";
  const rows = ["mcp:action/refactor_rename_project_id.run"];
  const args = (ctx: StepContext | null, oldId: string, commit: boolean): Raw => ({
    gproj_path: ctxAbs(ctx, RENAME_GPROJ),
    old_id: oldId,
    new_id: RENAMED_ID,
    commit,
    force: true,
  });
  return {
    id,
    block: "W11.7",
    title: `refactor_rename_project_id on a COPY of the test bed's .gproj (the real file is never written), then the copy described on path:`,
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: `the copy's ID becomes ${RENAMED_ID}; the engine loads the copy and reads it`,
    kill_criterion: "the engine refuses the copy: FAIL with its error; the real .gproj changed: FAIL at net-zero",
    side_effects: [`${RENAME_GPROJ} (a copy) written and renamed (+ .bak)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [RENAME_GPROJ],
    rows,
    gap: "11",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => engineReadPlan(RENAME_GPROJ, { noRegister: true }),
    offlineCalls: () => [
      oc("refactor_rename_project_id", args(null, "<the copy's ID>", false)),
      oc("refactor_rename_project_id", args(null, "<the copy's ID>", true)),
    ],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, RENAME_GPROJ) && !copyGproj(ctx, RENAME_GPROJ))
        return notRun(`no <sandbox>/${SANDBOX_NAME}.gproj to copy`, evidence);
      const oldId = gprojId(textAt(ctx, RENAME_GPROJ));
      evidence.oldId = oldId || null;
      if (oldId !== RENAMED_ID) {
        if (!oldId) return notRun("the copy has no ID line", evidence);
        evidence.dry = briefOffline(await ctx.offline("refactor_rename_project_id", args(ctx, oldId, false)));
        const c = await ctx.offline("refactor_rename_project_id", args(ctx, oldId, true));
        evidence.commit = briefOffline(c);
        offFail("commit", c, fails);
      }
      if (!fails.length && gprojId(textAt(ctx, RENAME_GPROJ)) !== RENAMED_ID) fails.push(`the copy's ID is not ${RENAMED_ID}`);
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const a = await engineRead(ctx, RENAME_GPROJ, [RENAMED_ID], { noRegister: true });
      return writerOutcome(ctx, id, rows, [], [a], evidence, `${oldId} -> ${RENAMED_ID}`);
    },
  };
}

function normalizeStep(): StepDef {
  const id = "w11-71-normalize-dependencies";
  const rows = ["mcp:action/refactor_normalize_dependencies.run"];
  const args = (ctx: StepContext | null, commit: boolean): Raw => ({
    gproj_path: ctxAbs(ctx, NORMALIZE_GPROJ),
    check_resolution: false,
    commit,
    force: true,
  });
  return {
    id,
    block: "W11.7",
    title: "refactor_normalize_dependencies on a COPY of the test bed's .gproj with its first dependency doubled, then the copy described on path:",
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: "the duplicate dependency is dropped; the engine loads the copy and reads the dependency GUID",
    kill_criterion: "the engine refuses the copy: FAIL with its error",
    side_effects: [`${NORMALIZE_GPROJ} (a copy) written and normalised (+ .bak)`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [NORMALIZE_GPROJ],
    rows,
    gap: "11",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => engineReadPlan(NORMALIZE_GPROJ, { noRegister: true, get: ["Dependencies"] }),
    offlineCalls: () => [oc("refactor_normalize_dependencies", args(null, false)), oc("refactor_normalize_dependencies", args(null, true))],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      let dep = "";
      if (!onDisk(ctx, NORMALIZE_GPROJ)) {
        if (!copyGproj(ctx, NORMALIZE_GPROJ)) return notRun(`no <sandbox>/${SANDBOX_NAME}.gproj to copy`, evidence);
        const d = withDuplicateDependency(textAt(ctx, NORMALIZE_GPROJ));
        if (!d.dep) return notRun("the copy has no Dependencies entry to double", evidence);
        dep = d.dep;
        ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, NORMALIZE_GPROJ), Buffer.from(d.text, "utf-8"));
        evidence.fixture = `dependency ${dep} doubled in the copy`;
        const before = textAt(ctx, NORMALIZE_GPROJ);
        evidence.dry = briefOffline(await ctx.offline("refactor_normalize_dependencies", args(ctx, false)));
        if (textAt(ctx, NORMALIZE_GPROJ) !== before) fails.push("the dry run wrote");
        const c = await ctx.offline("refactor_normalize_dependencies", args(ctx, true));
        evidence.commit = briefOffline(c);
        offFail("commit", c, fails);
        const count = (textAt(ctx, NORMALIZE_GPROJ).toUpperCase().match(new RegExp(`"${dep}"`, "g")) ?? []).length;
        evidence.occurrences = count;
        if (!fails.length && count !== 1) fails.push(`the dependency appears ${count} times after the commit`);
      } else {
        evidence.normalize = "already on disk (a resumed run)";
        dep = /Dependencies\s*\{\s*"([0-9A-Fa-f]{16})"/.exec(textAt(ctx, NORMALIZE_GPROJ))?.[1]?.toUpperCase() ?? "";
      }
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      // W11 run 5: describe answers no value for the Dependencies array; get on the variable is the
      // second read-back (a handler that answers array values would make it judgeable: audit md).
      const a = await engineRead(ctx, NORMALIZE_GPROJ, dep ? [dep] : [], {
        noRegister: true,
        get: ["Dependencies"],
      });
      return writerOutcome(ctx, id, rows, [], [a], evidence, "duplicate dependency dropped");
    },
  };
}

function scriptFormatStep(): StepDef {
  const id = "w11-72-script-format";
  const rows = ["mcp:action/script_format.run"];
  const args = (ctx: StepContext | null, commit: boolean): Raw => ({
    script_path: ctxAbs(ctx, FORMAT_SCRIPT),
    commit,
    force: true,
  });
  return {
    id,
    block: "W11.7",
    title: "script_format on the planted fixture (trailing blanks, mixed indents), then the Script Editor opens it and its lines are read back (opened, not compiled)",
    risk: "mutating",
    timeout_ms: TIMEOUTS.writer,
    expected: "the dry run writes nothing; the commit changes the file; the Script Editor shows the formatted bytes",
    kill_criterion: "the Script Editor does not open the file: FAIL with its error; the formatter fails: FAIL",
    side_effects: [`${FORMAT_SCRIPT} rewritten (+ .bak); a Script Editor tab opened`],
    rollback: "`w11.live.ts rollback` removes _throwaway/W11/",
    writes: [FORMAT_SCRIPT],
    rows,
    gap: "11",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => scriptReadPlan(FORMAT_SCRIPT),
    offlineCalls: () => [oc("script_format", args(null, false)), oc("script_format", args(null, true))],
    run: async (ctx) => {
      const evidence: Raw = {};
      const fails: string[] = [];
      if (!onDisk(ctx, FORMAT_SCRIPT)) return notRun(`${FORMAT_SCRIPT} is not planted`, evidence);
      const before = textAt(ctx, FORMAT_SCRIPT);
      if (before === FORMAT_FIXTURE) {
        evidence.dry = briefOffline(await ctx.offline("script_format", args(ctx, false)));
        if (textAt(ctx, FORMAT_SCRIPT) !== before) fails.push("the dry run wrote");
        const c = await ctx.offline("script_format", args(ctx, true));
        evidence.commit = briefOffline(c);
        offFail("commit", c, fails);
        if (!fails.length && textAt(ctx, FORMAT_SCRIPT) === before) fails.push("the commit left the fixture unchanged");
      } else evidence.format = "already formatted (a resumed run)";
      if (fails.length) return writerOutcome(ctx, id, [], fails, [], evidence, "");
      const a = await scriptRead(ctx, FORMAT_SCRIPT);
      return writerOutcome(ctx, id, rows, [], [a], evidence, "formatted");
    },
  };
}

// ── Gate, net-zero, closable ─────────────────────────────────────────────────

/** The test-bed gate: throws StopBattery on any miss. */
async function testBedGate(ctx: StepContext): Promise<StepOutcome> {
  const info = await ctx.deps.info();
  const projectName = info ? info.projectName : undefined;
  const evidence: Raw = { projectFound: info?.projectFound ?? null, projectName: projectName ?? null };
  // The test-bed check lives here, in the battery, never in a shipped handler (DEC-058).
  if (!truthy(info?.projectFound) || projectName !== SANDBOX_NAME)
    throw new StopBattery(
      "aborted",
      `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the live lane's test bed`,
      evidence,
    );
  const ping = await ctx.deps.ping();
  const stamp = S(ping?.buildStamp);
  const digest = ctx.deps.bundleDigest();
  evidence.stamp = stamp || null;
  evidence.digest = digest;
  if (!stamp || !digest || stamp !== digest)
    throw new StopBattery("stopped", "the build stamp does not match the bundle digest", evidence);
  const missing = PLANT_DIRS.filter((d) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, d)));
  evidence.planted = missing.length === 0;
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `the planted folder(s) ${missing.map((d) => `<sandbox>/${d}/`).join(", ")} are absent: run \`w11.live.ts plant\` first`,
      evidence,
    );
  const pid = ctx.deps.recordedPid();
  const cmd = pid === null ? null : await ctx.deps.commandLine(pid);
  const ini = join(ctx.opts.sittingDir, SCRATCH_INI);
  evidence.forceSettings = cmd === null ? "unread" : carriesForceSettings(cmd, ini);
  if (cmd === null || !carriesForceSettings(cmd, ini))
    throw new StopBattery(
      "stopped",
      `the Workbench process does not carry -forceSettings <sitting>/${SCRATCH_INI}: the registry would take its settings at exit`,
      evidence,
    );
  if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
    evidence.snapshotTaken = true;
  evidence.snapshot = BATTERY_SNAPSHOT_FILE;
  return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
}

async function netZero(ctx: StepContext): Promise<StepOutcome> {
  const fails: string[] = [];
  const evidence: Raw = {};
  const st = await ctx.tool("wb_world", { action: "state" });
  evidence.mode = rb(st).mode ?? null;
  evidence.worldPath = rb(st).worldPath ?? null;
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit") fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const diff = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
  evidence.diff = diff;
  if (!diff) fails.push(`no ${BATTERY_SNAPSHOT_FILE}`);
  else if (diff.changed.length) fails.push(`changed outside ${W11_ROOT}/: ${diff.changed.join(", ")}`);
  return { ...verdictOf(fails, "net-zero: nothing changed outside the throwaway folder"), evidence };
}

/** The last step, also run after a stop: Workbench left closable, nothing saved. */
export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st = await ctx.tool("wb_world", { action: "state" }, { tolerate: true });
  evidence.state = brief(st);
  if (st.ok && S(rb(st).mode) && S(rb(st).mode) !== "edit") fails.push(`mode ${S(rb(st).mode)}, not edit`);
  const pid = ctx.deps.recordedPid();
  const left = pid === null ? null : baselineRefusal(await ctx.deps.windows(), pid);
  evidence.dialog = left;
  if (left) fails.push(left);
  const open = S(rb(st).worldPath);
  return {
    ...verdictOf(fails, open ? `closable: '${open}' left open and unedited; never saved` : "closable: no world open"),
    evidence,
  };
}

export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W11.9",
    title: "leave Workbench closable: the open world and Script Editor tabs left unedited (never saved), no dialog up",
    risk: "reversible",
    timeout_ms: 60_000,
    expected: "edit mode, no dialog-like window; the post-flight WM_CLOSE exits without a save prompt",
    kill_criterion: "a dialog is left or the mode is not edit: FAIL (the runbook's hand answers a save prompt No)",
    side_effects: [],
    rollback: "none: nothing is edited",
    writes: [],
    rows: [],
    gap: "-",
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [tc("wb_world", "state")],
    offlineCalls: () => [],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export function buildSteps(): StepDef[] {
  return [
    {
      id: GATE_STEP,
      block: "W11.0",
      title: "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, plant, -forceSettings, sandbox snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; the planted folders on disk; the process carries -forceSettings <sitting>/${SCRATCH_INI}`,
      kill_criterion: "not the test bed: ABORTED, nothing else runs; a stamp mismatch, a missing plant or no -forceSettings: STOPPED",
      side_effects: [`<sitting>/${BATTERY_SNAPSHOT_FILE} written (first run of the sitting only)`],
      rollback: "none (reads; the snapshot is a file in the sitting folder)",
      writes: [],
      rows: [],
      gap: "-",
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      offlineCalls: () => [],
      run: async (ctx) => testBedGate(ctx),
    },
    ...CONFIG_CASES.map(configStep),
    sigaStep(),
    aeStep(),
    dupStep("aex", 1, AW_AEX_SOURCE, AW_AEX_TARGET),
    dupStep("asy", 2, AW_ASY_SOURCE, AW_ASY_TARGET),
    // The index steps run before any .gproj lands under _throwaway/W11/ (W11.6 mod, W11.7 copies).
    replaceGuidStep(),
    replaceGuidConfStep(),
    movePathStep(),
    scenarioCreateStep(),
    applyTemplateStep(),
    cloneAreaStep(),
    scenarioOpenStep(),
    entityDuplicateStep(),
    ...CREATORS.map(creatorStep),
    renameIdStep(),
    normalizeStep(),
    scriptFormatStep(),
    {
      id: NETZERO_STEP,
      block: "W11.9",
      title: "net-zero: the sandbox outside _throwaway/W11/ against the battery snapshot; edit mode",
      risk: "read-only",
      timeout_ms: 120_000,
      expected: "no file outside _throwaway/W11/ changed (resourceDatabase.rdb recorded, not failed)",
      kill_criterion: "a change outside the throwaway folder: FAIL",
      side_effects: [],
      rollback: "none",
      writes: [],
      rows: [],
      gap: "-",
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [tc("wb_world", "state")],
      offlineCalls: () => [],
      run: async (ctx) => netZero(ctx),
    },
    closableStep(),
  ];
}

// ── Plan, outline, queue ─────────────────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    target: { gproj: GPROJ } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: "performed by scripts/live/preflight.ts per the runbook, not by this script",
  } as PlanAction;
}

export function buildActionPlan(steps: StepDef[] = buildSteps()): PlanAction[] {
  const out: PlanAction[] = [launchAction()];
  for (const s of steps) for (const a of s.plan()) out.push({ ...a, step: s.id } as PlanAction);
  return out;
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: engine-accept battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map((s) => `  [${s.block}] ${s.id} (${s.risk}${s.gap !== "-" ? `, gap ${s.gap}` : ""}): ${s.title}`),
    `  excluded: ${EXCLUDED.map((e) => e.what).join("; ")}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w11.live.ts --emit-queue` from its step table. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W11 sends no ECEN_Probe call.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [AUDIT_REL, "DEC-053", "DEC-058", "DEC-101", "PLAN 5.3", "PLAN 11 criterion 7"],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note: "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    not_exercised: Object.fromEntries(EXCLUDED.map((e) => [e.what, e.why])),
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.block,
      title: s.title,
      settles: [],
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
    })),
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

function makeCtx(
  deps: W11Deps,
  opts: W11Options,
  calls: Array<Record<string, unknown>>,
  abort: AbortController,
  onStop: (code: string) => void,
  guardOn: boolean,
): StepContext {
  const guard = (what: string): void => {
    if (guardOn && abort.signal.aborted) {
      calls.push({ notSent: what });
      throw new StepCut();
    }
  };
  return {
    deps,
    opts,
    calls,
    signal: abort.signal,
    sleep: async (ms) => {
      guard("sleep");
      await deps.sleep(ms);
      guard("sleep");
    },
    offline: async (name, args) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.offline(name, args);
      calls.push({ offline: name, action: S(args.action) || null, ok: r.ok, code: r.code ?? null });
      return r;
    },
    tool: async (name, args, o = {}) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.tool(name, args);
      calls.push({ tool: name, action: S(args.action), ok: r.ok, code: r.code ?? null });
      if (guardOn && !r.ok && STOP_CODES.has(S(r.code)) && !(o.tolerate && r.code !== "MODAL_OPEN")) {
        onStop(S(r.code));
        throw new StopBattery(
          r.code === "MODAL_OPEN" ? "handoff" : "stopped",
          `${name} ${S(args.action)} answered ${r.code}: ${r.message ?? ""}`,
        );
      }
      return r;
    },
  };
}

async function closeOutAfterStop(deps: W11Deps, opts: W11Options, write: (r: StepRecord) => void): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx = makeCtx(deps, opts, calls, new AbortController(), () => undefined, false);
  let out: StepOutcome;
  try {
    out = await def.run(ctx);
  } catch (e) {
    out = { status: "FAIL", detail: `the close-out threw: ${e instanceof Error ? e.message : String(e)}`, evidence: {} };
  }
  write({
    step: def.id,
    block: def.block,
    title: `${def.title} (after a stop)`,
    status: out.status,
    detail: out.detail,
    startedAt,
    endedAt: new Date(deps.now()).toISOString(),
    evidence: { ...out.evidence, calls },
  });
}

/** A FAIL unit: each writer step is its own (one writer's FAIL does not count toward the next's). */
function failUnitOf(s: { id: string; block: string }): string {
  return s.block === "W11.0" || s.block === "W11.9" ? s.block : s.id;
}

export async function runBattery(
  steps: StepDef[],
  deps: W11Deps,
  opts: W11Options,
  all: StepDef[] = buildSteps(),
): Promise<BatteryReport> {
  const records: StepRecord[] = [];
  const write = (r: StepRecord, results?: StepOutcome["results"]): void => {
    const path = recordPath(opts.runDir, r.step);
    let evidenceId: string | null = null;
    if (opts.evidenceDir) {
      deps.writeBytes(path, Buffer.from(toPlaceholders(JSON.stringify(r, null, 2), opts.ph) + "\n", "utf-8"));
      evidenceId = writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary: `${r.step}: ${r.status} - ${r.detail}`.slice(0, 2000),
          artifacts: [path],
        },
        opts.ph,
      ).record.id;
    }
    const clean = JSON.parse(toPlaceholders(JSON.stringify({ ...r, evidenceId }), opts.ph)) as StepRecord;
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    if (results) {
      const lines = results.lines.map((l) => {
        const lr = l.live_result as Raw | undefined;
        return JSON.stringify(lr && evidenceId ? { live_result: { ...lr, evidence: evidenceId } } : l);
      });
      deps.writeBytes(
        join(opts.sittingDir, results.file),
        Buffer.from(lines.join("\n") + (lines.length ? "\n" : ""), "utf-8"),
      );
    }
    records.push(clean);
    writeResult(opts, deps, all);
  };
  if (steps.length && steps[0]!.id !== GATE_STEP)
    ensureBatterySnapshot(opts.sittingDir, opts.sandboxDir, deps, "run start");
  let consecutiveFails = 0;
  let failUnit = "";
  for (const s of steps) {
    const unit = failUnitOf(s);
    if (unit !== failUnit) {
      consecutiveFails = 0;
      failUnit = unit;
    }
    if (deps.exists(recordPath(opts.runDir, s.id)))
      return {
        exit: EXIT.refused,
        records,
        stoppedAt: s.id,
        message: `${s.id} already has a record in this run folder: a step is never run twice (plan 5.3)`,
      };
    const startedAt = new Date(deps.now()).toISOString();
    const base = { step: s.id, block: s.block, title: s.title, startedAt };
    deps.log(`step ${s.id}: ${s.title}`);
    const calls: Array<Record<string, unknown>> = [];
    const abort = new AbortController();
    let clientStop: string | null = null;
    const ctx = makeCtx(deps, opts, calls, abort, (c) => (clientStop = c), true);
    try {
      const pid = deps.recordedPid();
      if (pid === null) throw new StopBattery("stopped", "the lane recorded no Workbench pid: run the pre-flight first");
      const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx), WATCH_OPTIONS);
      const out = w.value;
      if (w.added.length) out.evidence.windowsAdded = w.added.map((x) => ({ className: x.className, title: x.title }));
      write(
        {
          ...base,
          status: out.status,
          detail: out.detail,
          endedAt: new Date(deps.now()).toISOString(),
          evidence: { ...out.evidence, gap: s.gap, calls },
        },
        out.results,
      );
      consecutiveFails = out.status === "FAIL" ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) {
        if (s.id !== CLOSABLE_STEP) await closeOutAfterStop(deps, opts, write);
        return { exit: EXIT.stopped, records, stoppedAt: s.id, message: "three consecutive unexpected failures: the battery stops" };
      }
    } catch (e) {
      const stop = e instanceof StopBattery ? e : null;
      const kind = stop?.kind ?? "stopped";
      const message = e instanceof Error ? e.message : String(e);
      const dialog = kind === "handoff" || clientStop === "MODAL_OPEN";
      const wedged = clientStop === "WEDGED" || clientStop === "LOST";
      const hand = kind === "handoff" ? handAnswer(message, s.id) : null;
      write({
        ...base,
        status: kind === "aborted" ? "ABORTED" : kind === "handoff" ? "HANDOFF" : "STOPPED",
        detail: hand ? `${message}; ${hand.instruction}` : message,
        endedAt: new Date(deps.now()).toISOString(),
        evidence: { ...(stop?.evidence ?? {}), ...(hand ? { handAnswer: hand } : {}), cut: abort.signal.aborted, calls },
        stop: message,
      });
      if (!dialog && !wedged && kind !== "aborted" && s.id !== CLOSABLE_STEP && !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP)))
        await closeOutAfterStop(deps, opts, write);
      return {
        exit: kind === "aborted" ? EXIT.aborted : kind === "handoff" ? EXIT.handoff : EXIT.stopped,
        records,
        stoppedAt: s.id,
        message: hand ? `${message}; ${hand.instruction}` : message,
      };
    }
  }
  const failed = records.some((r) => r.status === "FAIL");
  return { exit: failed ? EXIT.refused : EXIT.done, records, stoppedAt: null, message: failed ? "a step FAILED (see the table)" : null };
}

function runDirsOf(opts: W11Options, deps: Pick<W11Deps, "listTree">): string[] {
  const runs = new Set(deps.listTree(opts.sittingDir).filter((f) => f.includes("/")).map((f) => f.split("/")[0]!));
  return [...runs].sort().map((r) => join(opts.sittingDir, r));
}

/** `<sitting>/w11-result.json`: every step's latest record across the sitting's run folders. */
export function writeResult(
  opts: W11Options,
  deps: Pick<W11Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  for (const dir of runDirsOf(opts, deps))
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(dir, s.id), deps);
      if (r) latest.set(s.id, { ...r, runDir: basename(dir) });
    }
  const value = {
    session: SESSION,
    script: SCRIPT_PATH,
    build: opts.build,
    updated_at: new Date().toISOString(),
    steps: steps.map((s) => {
      const r = latest.get(s.id);
      return r
        ? { id: s.id, gap: s.gap, status: r.status, detail: r.detail, run: r.runDir, evidenceId: r.evidenceId ?? null }
        : { id: s.id, gap: s.gap, status: "NOT-RUN", detail: "no record in this sitting" };
    }),
    excluded: EXCLUDED,
    live_results: steps.filter((s) => s.rows.length).map((s) => liveFileOf(s.id)),
  };
  const clean = JSON.parse(toPlaceholders(JSON.stringify(value), opts.ph)) as unknown;
  writeJson(join(opts.sittingDir, RESULT_FILE), clean, deps);
}

// ── Offline subcommands: plant and rollback ──────────────────────────────────

export interface OfflineIo {
  workbenchPids: () => number[];
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
  listTree: (p: string) => string[];
  readBytes: (p: string) => Buffer;
  writeBytes: (p: string, b: Buffer) => void;
  removeTree: (p: string) => void;
  makeDir: (p: string) => void;
  /** One game file from the paks (throws when absent). */
  readVanilla: (p: string) => Promise<Buffer>;
  log: (l: string) => void;
}

/** What `plant` writes: test-bed-relative path to its source. */
export function plantSources(): Array<{ rel: string; from: string }> {
  return [
    ...CONFIG_CASES.map((c) => ({ rel: c.rel, from: `paks:${c.from}` })),
    ...AE_CONTROLS.map((c) => ({ rel: c.rel, from: `paks:${c.from}` })),
    { rel: REF_PARENT, from: `paks:${VANILLA_PHYSMAT}` },
    { rel: MOVE_SOURCE, from: "generated: the move fixture" },
    { rel: FORMAT_SCRIPT, from: "generated: the script_format fixture" },
  ];
}

/** The generated plant fixtures, by test-bed-relative path. */
const GENERATED: Readonly<Record<string, string>> = { [MOVE_SOURCE]: MOVE_FIXTURE, [FORMAT_SCRIPT]: FORMAT_FIXTURE };

/** `plant`: the fixtures and folders under _throwaway/W11/ (no Workbench running). */
export async function runPlant(sandboxDir: string, sittingDir: string, really: boolean, io: OfflineIo): Promise<number> {
  for (const s of plantSources()) io.log(`plant: ${s.from} -> <sandbox>/${s.rel}`);
  for (const d of PLANT_DIRS) io.log(`plant: folder <sandbox>/${d}/`);
  io.log(`plant: record <sitting>/${PLANT_FILE}`);
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  if (io.exists(abs(sandboxDir, W11_ROOT))) {
    io.log(`refused: <sandbox>/${W11_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const bytes: Record<string, Buffer> = {};
  try {
    for (const s of plantSources())
      bytes[s.rel] = s.from.startsWith("paks:")
        ? await io.readVanilla(s.from.slice("paks:".length))
        : Buffer.from(GENERATED[s.rel] ?? "", "utf-8");
  } catch (e) {
    io.log(`refused: a vanilla source could not be read (${e instanceof Error ? e.message : String(e)}): nothing written`);
    return EXIT.refused;
  }
  const record = {
    kind: "w11-plant",
    files: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, sha256(b)])),
    dirs: [...PLANT_DIRS],
    throwawayExistedBefore: io.exists(abs(sandboxDir, THROWAWAY)),
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  for (const d of PLANT_DIRS) {
    io.makeDir(abs(sandboxDir, d));
    io.log(`made <sandbox>/${d}/`);
  }
  for (const [rel, b] of Object.entries(bytes)) {
    io.writeBytes(abs(sandboxDir, rel), b);
    io.log(`planted <sandbox>/${rel} (${b.length} bytes, sha256 ${sha256(b)})`);
  }
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W11/; `_throwaway/` only when empty and absent before the plant. */
export function runRollback(sandboxDir: string, sittingDir: string, really: boolean, io: OfflineIo): number {
  const dir = abs(sandboxDir, W11_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W11_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W11_ROOT}/ (${files.length} files)`);
  if (!really) {
    io.log("dry run: nothing removed");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  const listing = files.map((rel) => ({ rel, sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))) }));
  io.writeBytes(join(sittingDir, "throwaway-w11-listing.json"), Buffer.from(JSON.stringify(listing, null, 2) + "\n"));
  io.removeTree(dir);
  let plant: { throwawayExistedBefore?: boolean } | null = null;
  try {
    plant = JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as { throwawayExistedBefore?: boolean };
  } catch {
    plant = null;
  }
  const top = abs(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0) io.removeTree(top);
  io.log(`removed <sandbox>/${W11_ROOT}/ (listing in throwaway-w11-listing.json)`);
  return EXIT.done;
}

// ── Real dependencies ────────────────────────────────────────────────────────

function listTreeOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      let isDir: boolean;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p, r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

function workbenchPidsReal(): number[] {
  return processesByImage(defaultExec, WORKBENCH_EXE).map((r) => r.pid);
}

const COMMAND_LINE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$env:EMCP_PID)',
  "if ($p) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$p.CommandLine)) }",
].join("\n");

/**
 * A fresh in-memory project index of the test bed alone (crawl of the sandbox folder), for the
 * refactors that read one. Nothing is written to the configured index database.
 */
function sandboxIndex(sandboxDir: string) {
  const db = openProjectIndex(":memory:");
  crawl(db, [{ path: sandboxDir, kind: "user" }]);
  return { db, index: new ProjectIndex(db) };
}

type Handler = (args: Raw, extra?: unknown) => Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;

/** The one handler a register function gives the capture server. */
function handlerOf(register: (server: McpServer) => void, name: string): Handler {
  const { server, handlers } = captureServer();
  register(server);
  const h = handlers.get(name);
  if (!h) throw new Error(`${name} registered no handler`);
  return h;
}

/** An MCP handler's answer as a ToolResponse; a text tool's error text is kept as the message. */
async function viaHandler(h: Handler, args: Raw): Promise<ToolResponse> {
  const r = responseOf(await h(args));
  if (!r.ok && !r.code) r.code = "TOOL_ERROR";
  return r;
}

export function realDeps(input: { port: number; lane: Lane; sandboxDir: string }): W11Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const root = artifactsDir();
  // The test project's folder is passed in here; no tool or handler names it.
  const config: Config = { ...loadConfig(), projectPath: input.sandboxDir };
  // game_duplicate resolves the addon as <projectPath>/<modName>: the test bed's parent folder.
  const dupConfig: Config = { ...config, projectPath: dirname(input.sandboxDir) };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  const wrap = async (f: () => Promise<ToolResponse>): Promise<ToolResponse> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof WorkbenchError) return { ok: false, code: e.code, message: e.message };
      return { ok: false, code: "HANDLER_ERROR", message: e instanceof Error ? e.message : String(e) };
    }
  };
  const indexed = async (name: string, reg: (s: McpServer, db: ReturnType<typeof sandboxIndex>) => void, args: Raw) => {
    const ix = sandboxIndex(input.sandboxDir);
    try {
      return await viaHandler(handlerOf((s) => reg(s, ix), name), args);
    } finally {
      ix.db.close();
    }
  };
  return {
    tool: (name, args) =>
      wrap(async () => {
        switch (name) {
          case "wb_resources":
            return asResp(await runResources(client, args));
          case "wb_container":
            return asResp(await runContainer(client, args, { artifactsRoot: root }));
          case "wb_module":
            return asResp(await runModule(client, args as unknown as ModuleArgs));
          case "wb_world":
            return asResp(await runWorld(client, args, { projectRoot: input.sandboxDir, artifactsRoot: root }));
          case "wb_layers":
            return asResp(await runLayers(client, args));
          case "wb_entity":
            return asResp(await runEntity(client, args));
          case "wb_script_editor":
            return asResp(await runScriptEditor(client, args));
        }
      }),
    offline: (name, args) =>
      wrap(async () => {
        const a = { ...args };
        switch (name) {
          case "config_edit":
            return asResp(runConfigEdit({ ...a, projectPath: input.sandboxDir } as unknown as ConfigEditArgs, config));
          case "procanim":
            return asResp(runProcAnim({ ...a, projectPath: input.sandboxDir } as unknown as ProcAnimRequest, config));
          case "animation_workspace":
            // The copies it writes are registered through the live client (registerProjectFile).
            return asResp(
              await runAnimationWorkspace({ ...a, projectPath: input.sandboxDir } as unknown as WorkspaceRequest, config, { client } as never),
            );
          case "scenario_create_conflict":
            return viaHandler(handlerOf((s) => registerScenarioCreate(s, config), name), a);
          case "scenario_apply_template":
            return viaHandler(handlerOf((s) => registerScenarioApplyTemplate(s, config), name), a);
          case "scenario_clone_area":
            return viaHandler(handlerOf((s) => registerScenarioCloneArea(s, config), name), a);
          case "prefab":
            return viaHandler(handlerOf((s) => registerPrefab(s, config), name), a);
          case "layout_create":
            return viaHandler(handlerOf((s) => registerLayoutCreate(s, config), name), a);
          case "config_create":
            return viaHandler(handlerOf((s) => registerConfigCreate(s, config), name), a);
          case "faction_create":
            return viaHandler(handlerOf((s) => registerFactionCreate(s, config), name), a);
          case "building_setup":
            return viaHandler(handlerOf((s) => registerBuildingSetup(s, config), name), a);
          case "mod":
            // create uses no search engine; w11-6a names a pattern, so the real library is passed
            // (run 6: an empty stand-in answered "patterns.get is not a function").
            return viaHandler(
              handlerOf((s) => registerMod(s, config, {} as never, new PatternLibrary(config.patternsDir)), name),
              a,
            );
          case "project":
            return viaHandler(handlerOf((s) => registerProject(s, config), name), a);
          case "game_duplicate":
            return viaHandler(handlerOf((s) => registerGameDuplicate(s, dupConfig, client), name), a);
          case "script_create":
            return viaHandler(handlerOf((s) => registerScriptCreate(s, config), name), a);
          case "refactor_replace_guid":
            return indexed(name, (s, ix) => registerRefactorReplaceGuid(s, ix.db, ix.index, config), a);
          case "refactor_move_resource_path":
            return indexed(name, (s, ix) => registerRefactorMoveResourcePath(s, ix.db, ix.index, config), a);
          case "refactor_rename_project_id":
            return viaHandler(handlerOf((s) => registerRefactorRenameProjectId(s, config), name), a);
          case "refactor_normalize_dependencies": {
            const ix = sandboxIndex(input.sandboxDir);
            try {
              return await viaHandler(handlerOf((s) => registerRefactorNormalizeDependencies(s, ix.index, config), name), a);
            } finally {
              ix.db.close();
            }
          }
          case "script_format":
            return viaHandler(handlerOf((s) => registerScriptFormat(s, config), name), a);
          case "wb_entity_duplicate":
            // The tool gates on the client's cached mode: read it first (EMCP_WB_GetState).
            // Its addon is <projectPath>/<modName>, as game_duplicate's.
            await client.refreshState();
            return viaHandler(handlerOf((s) => registerWbEntityDuplicate(s, dupConfig, client), name), a);
        }
      }),
    refactorPlan: async (kind, args) => {
      const ix = sandboxIndex(input.sandboxDir);
      try {
        if (kind === "replace_guid") {
          const p = replaceGuidPlan(ix.db, ix.index, S(args.old_guid).toUpperCase(), S(args.new_guid).toUpperCase(), {
            includeWorkshop: false,
          });
          return {
            ok: !p.collision,
            files: p.files.map((f) => f.absPath),
            detail: p.collision ? `collision: ${S(p.collisionFile)}` : `${p.files.length} file(s)`,
          };
        }
        const p = movePathPlan(ix.db, ix.index, S(args.old_path), S(args.new_path), S(args.project_root)) as unknown as Raw;
        const files = [
          ...(Array.isArray(p.refFiles) ? (p.refFiles as Raw[]).map((f) => S(f.absPath)) : []),
          S(p.oldAbsPath),
          S(p.newAbsPath),
          ...(p.metaExists ? [S(p.oldMetaAbsPath), S(p.newMetaAbsPath)] : []),
        ].filter(Boolean);
        // MovePlan has no refusal field: the handler refuses on these flags (run 2 read a plan
        // the tool then refused as ok).
        const refusal = !p.resourceFoundInIndex
          ? `no resource indexed at ${S(args.old_path)}`
          : !p.fileExists
            ? "the source file is absent"
            : p.newPathOccupied || p.newMetaOccupied
              ? "the destination (or its .meta) exists"
              : "";
        return { ok: !refusal, files, detail: refusal || `${files.length} path(s)` };
      } catch (e) {
        return { ok: false, files: [], detail: e instanceof Error ? e.message : String(e) };
      } finally {
        ix.db.close();
      }
    },
    info: async () => {
      try {
        return (await client.probe("EMCP_WB_Info", {}, { timeout: 10_000 })) as Raw;
      } catch {
        return null;
      }
    },
    ping: async () => {
      try {
        return (await client.probe("EMCP_WB_Ping", {}, { timeout: TIMEOUTS.ping })) as Raw;
      } catch {
        return null;
      }
    },
    bundleDigest: () => bundleDigest(),
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    recordedPid: () => input.lane.recordedPid(),
    commandLine: async (pid) => {
      const r = await runPowerShell(COMMAND_LINE_SCRIPT, { timeoutMs: 30_000, env: { EMCP_PID: String(pid) } });
      const b64 = lastLine(r.stdout);
      return r.ok && b64 ? Buffer.from(b64.trim(), "base64").toString("utf-8") : null;
    },
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p) => existsSync(p),
    listTree: listTreeOf,
    newGuid: () => randomBytes(8).toString("hex").toUpperCase(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
  };
}

async function openVfs() {
  const { PakVirtualFS } = await import("../../src/pak/vfs.js");
  return PakVirtualFS.get(loadConfig().gamePath);
}

function realOfflineIo(): OfflineIo {
  let vfs: Awaited<ReturnType<typeof openVfs>> | undefined;
  return {
    workbenchPids: workbenchPidsReal,
    exists: (p) => existsSync(p),
    listDir: (p) => readdirSync(p),
    listTree: listTreeOf,
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    removeTree: (p) => rmSync(p, { recursive: true, force: false }),
    makeDir: (p) => mkdirSync(p, { recursive: true }),
    readVanilla: async (p) => {
      vfs ??= await openVfs();
      if (!vfs) throw new Error("the game paks cannot be opened");
      return vfs.readFile(p);
    },
    log: (l) => console.log(l),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "out",
  "outline",
  "emit-queue",
  "id",
  "sandbox",
  "run-dir",
  "sitting-dir",
  "from",
  "until",
  "only",
  "port",
  "evidence-dir",
  "lease-path",
  "marker-path",
  "build",
] as const;
const FLAGS = ["really", "update-baseline"] as const;
const SUBCOMMANDS = ["plant", "rollback"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  steps?: StepDef[];
  deps?: W11Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
}

/** The dry-run gate: the plan against the policy, the W11 plan check and the queue. */
export function dryRunCheck(policy: CensusPolicy, steps: StepDef[] = buildSteps()): { ok: boolean; lines: string[] } {
  const plan = buildActionPlan(steps);
  const check = checkPlan(plan, policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  const own = w11PlanViolations(steps);
  lines.push(own.length ? `W11 plan check: FAIL\n${own.map((v) => `  ${v}`).join("\n")}` : "W11 plan check: PASS");
  let queueOk = true;
  try {
    const q = validateQueue(buildQueue(steps), false);
    lines.push(`queue: ${q.length} probes valid`);
  } catch (e) {
    queueOk = false;
    lines.push(`queue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: check.ok && own.length === 0 && queueOk, lines };
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  const sub = (SUBCOMMANDS as readonly string[]).includes(argv[0] ?? "") ? (argv[0] as (typeof SUBCOMMANDS)[number]) : null;
  let args;
  try {
    args = parseArgs(sub ? argv.slice(1) : argv, VALUED);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
    return EXIT.usage;
  }
  const unknown = [...args.flags].filter((f) => !(FLAGS as readonly string[]).includes(f));
  if (unknown.length) {
    say(`unknown option(s): ${unknown.map((f) => `--${f}`).join(", ")}`);
    return EXIT.usage;
  }
  const o = args.options;
  const really = args.flags.has("really");

  const laneGate = (): { lane: Lane | null; refusal: string | null; code: number } => {
    if (!o.id) return { lane: null, refusal: "--really needs --id <lane id>", code: EXIT.usage };
    const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
    const gate = liveGateReason({
      really,
      platform: over.platform ?? process.platform,
      leaseHeld: over.leaseHeld ?? lane.holdsLease(),
    });
    return { lane, refusal: gate, code: EXIT.refused };
  };

  if (sub) {
    if (!o.sandbox || basename(resolve(o.sandbox)) !== SANDBOX_NAME || !o["sitting-dir"]) {
      say(`${sub} needs --sandbox <the test bed folder ${SANDBOX_NAME}> and --sitting-dir <dir>`);
      return EXIT.usage;
    }
    if (really) {
      const g = laneGate();
      if (g.refusal) {
        say(g.refusal);
        return g.code;
      }
    }
    const io = { ...(over.offlineIo ?? realOfflineIo()), log: (l: string) => say(toPlaceholders(l, ph)) };
    return sub === "plant"
      ? runPlant(resolve(o.sandbox), resolve(o["sitting-dir"]), really, io)
      : runRollback(resolve(o.sandbox), resolve(o["sitting-dir"]), really, io);
  }

  const policy = over.policy ?? loadPolicy();
  const steps = over.steps ?? buildSteps();
  const plan = buildActionPlan(steps);
  const dry = dryRunCheck(policy, steps);
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  if (o["emit-queue"]) writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    for (const l of dry.lines) say(l);
    return dry.ok ? EXIT.done : EXIT.refused;
  }
  if (!dry.ok) {
    for (const l of dry.lines) say(l);
    return EXIT.refused;
  }
  const selected = selectSteps(steps as never, { from: o.from, only: o.only, until: o.until }) as StepDef[] | string;
  if (typeof selected === "string") {
    say(selected);
    return EXIT.usage;
  }
  if (!o.id || !o.sandbox || !o["sitting-dir"]) {
    say("--really needs --id <lane id>, --sandbox <the test bed folder> and --sitting-dir <dir>");
    return EXIT.usage;
  }
  if (basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
    say(`aborted: --sandbox must be the live lane's test bed ${SANDBOX_NAME}`);
    return EXIT.aborted;
  }
  const g = laneGate();
  if (g.refusal) {
    say(g.refusal);
    return g.code;
  }
  const sittingDir = resolve(o["sitting-dir"]);
  const runDir = resolve(o["run-dir"] ?? join(sittingDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  if (dirname(runDir) !== sittingDir) {
    say(`--run-dir must lie directly in ${sittingDir}`);
    return EXIT.usage;
  }
  mkdirSync(runDir, { recursive: true });
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  let deps = over.deps;
  if (!deps) {
    deps = realDeps({ port, lane: g.lane!, sandboxDir: resolve(o.sandbox) });
    g.lane!.startHeartbeat();
  }
  try {
    const r = await runBattery(
      selected,
      deps,
      {
        runDir,
        sittingDir,
        sandboxDir: resolve(o.sandbox),
        evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
        ph: { ...ph, sandbox: resolve(o.sandbox) },
        build: o.build ?? readCurrentBuild(DEFAULT_CENSUS_ROOT) ?? "unrecorded",
      },
      steps,
    );
    for (const l of resultTable(r.records as never)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w11",
      sittingDir,
      resultFile: RESULT_FILE,
      update: args.flags.has(UPDATE_BASELINE_FLAG),
      exitDone: EXIT.done,
      exitRefused: EXIT.refused,
    }))
      say(toPlaceholders(l, ph));
    if (r.message)
      say(
        toPlaceholders(
          `${r.exit === EXIT.handoff ? "HANDOFF" : r.exit === EXIT.done ? "DONE" : r.stoppedAt ? "STOPPED" : "FAILED"}: ${r.message}`,
          ph,
        ),
      );
    say(toPlaceholders(`run folder: ${runDir}; result: ${join(sittingDir, RESULT_FILE)}`, ph));
    return r.exit;
  } finally {
    g.lane?.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}

// Census rows this file tests: a PASS writes a live result naming each, and promote.ts needs the
// row named here for its live test link.
// census:mcp:action/config_edit.set
// census:mcp:action/config_edit.createInherited
// census:mcp:action/procanim.create
// census:mcp:action/procanim.edit
// census:mcp:action/animation_workspace.create
// census:mcp:action/animation_workspace.duplicate
// census:mcp:action/refactor_replace_guid.run
// census:mcp:action/refactor_move_resource_path.run
// census:mcp:action/scenario_create_conflict.run
// census:mcp:action/scenario_apply_template.run
// census:mcp:action/scenario_clone_area.run
// census:mcp:action/prefab.create
// census:mcp:action/layout_create.run
// census:mcp:action/config_create.run
// census:mcp:action/faction_create.run
// census:mcp:action/building_setup.run
// census:mcp:action/game_duplicate.run
// census:mcp:action/wb_entity_duplicate.run
// census:mcp:action/project.write
// census:mcp:action/script_create.run
// census:mcp:action/mod.create
// census:mcp:action/refactor_rename_project_id.run
// census:mcp:action/refactor_normalize_dependencies.run
// census:mcp:action/script_format.run
