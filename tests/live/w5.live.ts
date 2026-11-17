/**
 * Wave W5 (Audio, Particle, Navmesh), the live battery (docs/v2/design/phase5-w5-spec.md section
 * 6, its ruling DEC-068, DEC-058). Built on the battery that ran live through four fix-up rounds,
 * tests/live/w2.live.ts: the same CLI, the same evidence, the same hand mechanism, the same stop
 * rules, and its lessons (a .meta lies beside the resource the register answered; an offline copy
 * is edited before the engine first loads it, never after; a packed file resolves by GUID; a file
 * opens only in the module that owns its type; verdicts are per item; the FAIL counter counts per
 * independent step).
 *
 * A GUI Workbench on the live lane's test bed (EMCP2_sandbox), launched by the two-pass pre-flight on
 * the scratch profile with `-scriptAuthorizeAll` (DEC-053 ruling 2, the standing go), with the
 * shipped bundle installed and NO probe pack. This script never launches the GUI Workbench, never
 * takes the lease for itself (the lane given with --id holds it) and reaches Workbench through the
 * shipped TS tools run IN PROCESS (`wb_audio`, `wb_particle`, `wb_navmesh`, `wb_resources`,
 * `wb_container`, `wb_module`, `wb_world`, `wb_entity`, `wb_gui`, the 1.x `terrain_navmesh_status`)
 * over a `WorkbenchClient` WITHOUT a Config, so each step tests the TS mapping and the handler
 * together. The three W5 offline tools (`audio`, `particle`, `navmesh`) and the 1.x
 * `particle_inspect` and `wb_cli_run` run in process on the test project's folder, passed in as
 * `projectPath`; no handler or tool names it.
 *
 * DRY RUN BY DEFAULT. Without --really it prints the outline, checks the ACTION PLAN with
 * `scripts/live/dry-run.ts` checkPlan and the queue with preflight's validateQueue; `--out` writes
 * the plan, `--outline` the outline, `--emit-queue` the queue (docs/v2/sessions/queues/W5-queue.json;
 * a test keeps the two equal). The runbook is docs/v2/sessions/queues/W5.md.
 *
 * Blocks (one launch; each block is ordered read-only, reversible, mutating for the queue):
 *   W5.0 setup     the test-bed gate, the snapshot, the compile gate (P-W5-08 compile half), the
 *                  offline reads of the three tools and the 53 vanilla .nmn headers (P-W5-17), the
 *                  offline writes on round-trip copies (dry run, confirm, inverse, byte compare; the
 *                  GATED actions for their refusal), the five live fixtures registered, the
 *                  throwaway world (wb_world new, an SCR_AIWorld prefab and two props, saved)
 *   W5.1 audio     AudioSystem in play mode (fix-up 1: P-W5-06 KILLED in run 1, repointed to
 *                  P-W5-10): the edit-mode refusal, then inside wb_world play the reads, play /
 *                  playSound / stop, variables, masters, pause, each runtime write set back
 *   W5.2 particle  a ParticleEffectEntity in the throwaway world (P-W5-07, 08, 09): spawn, stats,
 *                  control, simulate, param, setParam (set back), remove, undo, remove again
 *   W5.3 sound     an entity's sound component (P-W5-16): entityEvents, entityPlay, setSignal
 *   W5.4 accept    the engine-accept proofs of the offline tools (P-W5-02, 03, 04, 05): each edits
 *                  its own throwaway copy BEFORE the engine first loads it, Workbench then loads it
 *                  and the changed value is read back; independent steps
 *   W5.5 navmesh   the throwaway world's AIWorld (P-W5-11, 15): status, tile, rebuild (confirm)
 *   W5.6 vanilla   a vanilla world opened read-only, never saved (P-W5-13, 14): status paged,
 *                  STALE_CURSOR, tile, load, reachable; the throwaway world reopened after
 *   W5.7 editor    wb_audio open (dry runs; the confirm GATED until P-W5-12), the Audio Editor
 *                  module open and front, close refused, no modal
 *   W5.8 play      play mode (P-W5-10): the runtime calls answered in play, back in edit mode
 *   W5.9 aliases   particle_inspect, terrain_navmesh_status, wb_cli_run navmeshGenerate/navmeshBake
 *                  refusals (nothing spawned)
 *   W5.10 close    the net-zero hash diff and the closable step
 * Hand steps: none. The spec (section 6) justifies none: every oracle is a handle, a readback, a
 * count, a tile state, a file mtime, a window title or the modal watchdog. `--skip-hand` is kept and
 * records a hand step HELD, should one be added at the END of the battery in one block.
 *
 * P-W5-01 (the headless bake) runs in its own process after the post-flight, through this
 * script's `bake` subcommand (wb_cli_run navmeshBake in process, its policy gate lifted for that
 * process only, the shipped 600 s watchdog that ends only the PID it started). Everything under
 * _throwaway/W5/ (plant, world, created files, accept copies, bake output, .meta files) is removed
 * by `rollback` once Workbench is closed.
 *
 * Stop rules (W2's): a dialog-like window already up refuses the step; the pid's windows are polled
 * while a step runs (scripts/census/live/common.ts `watched`): a new dialog-like or disabled window
 * is a HANDOFF that names the title and the answer (never Save), any other new window a STOP, and
 * the first verdict cuts the step. A LOST, WEDGED or MODAL_OPEN client error stops the battery;
 * three consecutive unexpected FAILs in one unit stop it (failUnitOf: the count resets at a block
 * boundary, and each step of an independent block, W5.4, is its own unit). A mutating call is never
 * retried. A probe whose kill criterion is met is recorded KILLED with the observed value; steps
 * that depend on it are SKIPPED and the battery continues.
 *
 * Usage:
 *   npx --no tsx tests/live/w5.live.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx tests/live/w5.live.ts plant --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w5.live.ts --really --id <lane> --sandbox <dir> --sitting-dir <dir>
 *       [--from <step>] [--until <step>] [--only <step>] [--skip-hand] [--run-dir <dir in the sitting>]
 *       [--update-baseline]  (the regression guard, tests/live/baseline.ts: rewrite <wave>-baseline.json from this sitting)
 *       [--port 5775] [--evidence-dir <dir>] [--build <tag>] [--lease-path p] [--marker-path p]
 *   npx --no tsx tests/live/w5.live.ts bake --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *   npx --no tsx tests/live/w5.live.ts rollback --sandbox <dir> --sitting-dir <dir> [--id <lane> --really]
 *
 * Exit: 0 done (or dry run passed), 1 refused / plan check failed / a step FAILED, 2 usage,
 *       3 stopped, 4 aborted (not the test bed), 5 handoff (a dialog; owner hand).
 */

import { createHash } from "node:crypto";
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
import { loadConfig, type Config } from "../../src/config.js";
import { WorkbenchClient, WorkbenchError, bundleDigest } from "../../src/workbench/client.js";
import { runAudio as runWbAudio } from "../../src/tools/wb-audio.js";
import { runParticle as runWbParticle } from "../../src/tools/wb-particle.js";
import { REBUILD_WEAK_ORACLE, runNavmesh as runWbNavmesh } from "../../src/tools/wb-navmesh.js";
import { runResources } from "../../src/tools/wb-resources.js";
import { runContainer } from "../../src/tools/wb-container.js";
import { runModule, type ModuleArgs } from "../../src/tools/wb-module.js";
import { runWorld } from "../../src/tools/wb-world.js";
import { runEntity } from "../../src/tools/wb-entity.js";
import { runGui } from "../../src/tools/wb-gui.js";
import {
  AUDIO_GATES,
  GRAPH_ACTIONS as AUDIO_GRAPH_ACTIONS,
  READ_ACTIONS as AUDIO_READ_ACTIONS,
  WRITE_ACTIONS as AUDIO_WRITE_ACTIONS,
  runAudio as runOfflineAudio,
  type AudioGates,
  type AudioRequest,
} from "../../src/tools/audio.js";
import {
  READ_ACTIONS as PARTICLE_READ_ACTIONS,
  WRITE_ACTIONS as PARTICLE_WRITE_ACTIONS,
  runParticle as runOfflineParticle,
  type ParticleRequest,
} from "../../src/tools/particle.js";
import {
  NAVMESH_ACTIONS,
  runNavmesh as runOfflineNavmesh,
  type NavmeshArgs,
} from "../../src/tools/navmesh.js";
import { registerParticleInspect } from "../../src/tools/particle-inspect.js";
import { registerTerrainNavmeshStatus } from "../../src/tools/terrain-navmesh-status.js";
import { loadCliPolicy, planFor, registerWbCliRun } from "../../src/tools/wb-cli-run.js";
import { applyGraphOp, readGraph, type AudioGraphModel } from "../../src/formats/audio-graph.js";
import { loadAudioModel } from "../../src/formats/audio-model.js";
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
import { runPowerShell } from "../../scripts/live/powershell.js";
import { validateQueue } from "../../scripts/live/preflight.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../scripts/live/s-c-natives.js";
import { WORKBENCH_EXE } from "../../scripts/live/launch.js";
import { defaultExec, processesByImage } from "../../scripts/live/win.js";
import {
  BUSY_GRACE_MS,
  EXIT,
  StepCut,
  StopBattery,
  isBusyWindow,
  watched,
} from "../../scripts/census/live/common.js";

export { EXIT, StopBattery };

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "W5";
/** The last step; the runner also runs it after a stop (not after a dialog, LOST or WEDGED). */
export const CLOSABLE_STEP = "w5-99-closable";
export const GATE_STEP = "w5-00-gate";
export const SCRIPT_PATH = "tests/live/w5.live.ts";
export const RUNBOOK = "docs/v2/sessions/queues/W5.md";
export const QUEUE_REL = "docs/v2/sessions/queues/W5-queue.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));

/** The one switch the launch carries, on the owner's standing go (DEC-053 ruling 2). */
export const SAA = "-scriptAuthorizeAll";
export const LAUNCH_ARGS: readonly string[] = [
  "-gproj",
  `<sandbox>/${SANDBOX_NAME}.gproj`,
  "-forceSettings",
  "<sitting>/w5-scratch.ini",
  SAA,
];

/** Every file the battery creates lies under this folder. */
export const THROWAWAY = "_throwaway";
export const W5_ROOT = `${THROWAWAY}/W5`;

/** The five live fixtures (planted offline, registered by w5-04, never edited). */
export const FX_ACP = `${W5_ROOT}/W5_snd.acp`;
export const FX_SIG = `${W5_ROOT}/W5_sig.sig`;
export const FX_VARS = `${W5_ROOT}/W5_vars.conf`;
export const FX_PTC = `${W5_ROOT}/W5_fx.ptc`;
export const FX_AFM = `${W5_ROOT}/W5_mix.afm`;
export const LIVE_FIXTURES: readonly string[] = [FX_ACP, FX_SIG, FX_VARS, FX_PTC, FX_AFM];

/**
 * The engine-accept copies (W5.4): each is edited offline FIRST and registered and loaded only
 * after, so the engine never caches the unedited bytes (W2 fix-up 1, run 1's lesson).
 */
export const OFF_DIR = `${W5_ROOT}/off`;
export const OFF_ACP = `${OFF_DIR}/W5_off.acp`;
export const OFF_GRAPH = `${OFF_DIR}/W5_graph.acp`;
export const OFF_SIG = `${OFF_DIR}/W5_off.sig`;
export const OFF_VARS = `${OFF_DIR}/W5_off_vars.conf`;
export const OFF_AFM = `${OFF_DIR}/W5_off.afm`;
export const OFF_PTC = `${OFF_DIR}/W5_off.ptc`;
/** Written by w5-46 from the overrideConfig dry run's planned text (never planted). */
export const OFF_NAV = `${OFF_DIR}/W5_navmesh.conf`;

/** The round-trip copies (w5-03): written and restored offline, never registered. */
export const RT_DIR = `${W5_ROOT}/rt`;
export const RT_ACP = `${RT_DIR}/W5_rt.acp`;
export const RT_SIG = `${RT_DIR}/W5_rt.sig`;
export const RT_VARS = `${RT_DIR}/W5_rt_vars.conf`;
export const RT_AFM = `${RT_DIR}/W5_rt.afm`;
export const RT_PTC = `${RT_DIR}/W5_rt.ptc`;

export const PLANTED: readonly string[] = [
  ...LIVE_FIXTURES,
  OFF_ACP,
  OFF_GRAPH,
  OFF_SIG,
  OFF_VARS,
  OFF_AFM,
  OFF_PTC,
  RT_ACP,
  RT_SIG,
  RT_VARS,
  RT_AFM,
  RT_PTC,
];

/** Folders the plant makes (a create refuses a target whose parent folder is missing). */
export const CREATED_DIR = `${W5_ROOT}/created`;
export const WORLDS_DIR = `${W5_ROOT}/worlds`;
/** P-W5-01's -saveDir (the `bake` subcommand, after the post-flight). */
export const BAKE_DIR = `${W5_ROOT}/bake`;
export const PLANT_DIRS: readonly string[] = [CREATED_DIR, WORLDS_DIR, BAKE_DIR];
/** The tiny world (OD-4): the only world rebuild and the bake ever touch. */
export const WORLD = `${WORLDS_DIR}/EMCP_W5_Tiny.ent`;
/** The creates of w5-47 (offline skeletons, then registered and loaded). */
export const CREATED_ACP = `${CREATED_DIR}/W5_new.acp`;
export const CREATED_AFM = `${CREATED_DIR}/W5_new.afm`;
export const CREATED_VARS = `${CREATED_DIR}/W5_new_vars.conf`;
export const CREATED_PTC = `${CREATED_DIR}/W5_new.ptc`;

/**
 * Vanilla sources of the plant (read from the paks; sizes measured on 1.9.0.37). V_RALLY is RallyDLC's
 * (addons/rally/data.pak), not a dependency of the sandbox: the engine loads the copy but not its
 * samples (fix-up 1; the offline and accept steps that read its structure are unaffected).
 */
export const V_RALLY = "Sounds/Music/Rally/Music_Rally.acp"; // 3,921 bytes, 4 events, 4 banks
export const V_SIG = "Sounds/UI/UI_Respawn.sig"; // 1,073 bytes, a compiled block
export const V_VARS = "Sounds/_SharedData/LocalVariables/LocalVariables_VON.conf"; // 99 bytes
export const V_FX = "Particles/Enviroment/Fireflies.ptc"; // 906 bytes, 2 emitters
export const V_AFM = "Sounds/FinalMix_UI_Music.afm"; // 832 bytes, 2 buses

/**
 * Vanilla resources the runtime steps name (read-only; GUIDs from references in the paks). Each must
 * lie in the ArmaReforger addon (addons/data), the sandbox's only dependency: fix-up 1 found that
 * Music_Rally.acp, its samples and SoundSource_Crowd.et are RallyDLC's (addons/rally/data.pak), so
 * the engine answered "Wrong GUID/name" and "Failed to open" for them in run 1.
 */
export const V_PLAY_ACP = "{AC072A5AAF5C6923}Sounds/Weapons/Grenades/M67/Weapons_M67_Fuze.acp";
export const V_PLAY_EVENT = "SOUND_THROWN";
/** A sample of V_PLAY_ACP (its Filename line; addons/data data009.pak). */
export const V_SAMPLE =
  "{1DE4ADE43E8487C6}Sounds/Weapons/Grenades/M67/Samples/Weapons_M67_Fuze_SafetyLever_01.wav";
export const V_GLOBAL_VARS = "{A60F08955792B575}Sounds/_SharedData/Variables/GlobalVariables.conf";
export const V_GLOBAL_VAR = "GInterior";
export const V_COPY_FROM = "Particles/Enviroment/Moths.ptc";
/** The new sample addSample adds (a vanilla .snd that Music_Rally's Menu bank holds). */
export const V_ADD_SAMPLE =
  "{F8F2795D6CA00BD1}Sounds/Music/Rally/Samples/Music_Rally_Menu_Loop.snd";
/** OD-4: the vanilla SCR_AIWorld prefab (SCR_AIWorld_Arland.et names it as its ancestor). */
export const AIWORLD_PREFAB = "{E0A05C76552E7F58}Prefabs/AI/SCR_AIWorld.et";
/** A small prop (W1's PROP, proven placeable in W1's battery). */
export const BOX_PREFAB = "{3F23DA7ACAC0ED90}Prefabs/Props/Civilian/GlassBeer_01/GlassBeer_01.et";
/**
 * P-W5-16: a vanilla prefab with SignalsManagerComponent and a SoundComponent (an SndComponent: the
 * handler's fallback, fix-up 1), in addons/data data007.pak; its GUID from the inheritance line of
 * LampKerosene_01's children. Its .acp (data008.pak) has SOUND_TURN_ON and SOUND_TURN_OFF. Run 1's
 * SoundSource_Crowd.et is RallyDLC's, outside the sandbox's dependencies: create answered null.
 */
export const SOUND_PREFAB = "{1CE762D0A53A395A}Prefabs/Props/Civilian/LampKerosene_01/LampKerosene_01_base.et";
export const SOUND_PREFAB_ACP = "Sounds/Props/Civilian/LampKerosene_01/Props_LampKerosene_01.acp";
/** P-W5-13/14: a vanilla world whose AIWorld lists a baked navmesh (opened read-only). */
export const VANILLA_NAV_WORLD = "worlds/GameMaster/GM_Arland.ent";
export const VANILLA_NAV_CONF = "Configs/Navmesh/Navmesh_GM_Arland_Soldier.conf";
export const VANILLA_NMN = "worlds/GameMaster/Navmeshes/GM_Arland.nmn";
export const VANILLA_AIWORLD_ET = "Prefabs/AI/SCR_AIWorld_Arland.et";
/** w5-46's edit of the navmesh files config copy: another vanilla .nmn. */
export const NAV_OVERRIDE_REF = "{804386FFEB7B7EFD}worlds/MP/Navmeshes/LowResArland.nmn";
/** The closable fallback (vanilla, opened read-only, never saved; W1's). */
export const VANILLA_WORLD = "worlds/Arland/EmptyArland.ent";

/** Entity names the battery places (in the throwaway world only). */
export const AIWORLD_NAME = "EMCP_W5_AIWorld";
export const BOX_NAMES: readonly string[] = ["EMCP_W5_Box1", "EMCP_W5_Box2"];
export const FX_NAME = "EMCP_W5_Fx";
export const FX_ACCEPT_NAME = "EMCP_W5_FxAccept";
export const FX_PLAY_NAME = "EMCP_W5_FxPlay";
export const SND_NAME = "EMCP_W5_Snd";

/** Offline facts of the planted copies (from the vanilla text). */
export const RALLY_EVENT = "SOUND_MUSIC_RALLY";
export const RALLY_EVENT_2 = "SOUND_MUSIC_RALLY_MENU";
export const RALLY_BANK = "All";
export const RALLY_BANK_ID = 70660;
export const RALLY_MIXER_ID = 6155;
export const RALLY_MIXER_PORT = 22535;
export const FX_EMITTERS: readonly string[] = ["Fireflies", "Fireflies_LOD1"];

/** The 64 m rebuild box of w5-51 (BOX_MAX is 512 m) and a box above it. */
export const REBUILD_MIN = "-32 -16 -32";
export const REBUILD_MAX = "32 16 32";
export const TOO_LARGE_MIN = "-300 -10 -300";
export const TOO_LARGE_MAX = "300 10 300";

export const PLANT_FILE = "plant-w5.json";
export const RESULT_FILE = "w5-result.json";
export const BAKE_FILE = "w5-bake.json";
export const BATTERY_SNAPSHOT_FILE = "w5-battery-snapshot.json";
export const BATTERY_SNAPSHOT_KIND = "w5-battery-snapshot";
/** Files whose change outside _throwaway/W5/ is recorded, not a FAIL (the resource database). */
export const NETZERO_TOLERATED: readonly string[] = ["resourceDatabase.rdb"];
/** How long a hand step waits for the main session's answer file (per request). */
export const HAND_WAIT_MS = 900_000;

export const TIMEOUTS = {
  step: 180_000,
  open: 600_000,
  poll: 5_000,
} as const;

/** The audio gates the probe steps pass in process (P-W5-04, P-W5-05); the shipped gates stay off. */
export const PROBE_GATES: AudioGates = { sigWrites: true, graphActions: true };

/**
 * Blocks whose steps are independent proofs: each W5.4 accept edits its own copy and checks it
 * alone, so three failing in a row says nothing about the session (W2 run 3).
 */
export const INDEPENDENT_BLOCKS: ReadonlySet<string> = new Set(["W5.4"]);

/** The unit the consecutive-FAIL stop counts in: the step itself in an independent block, else its block. */
export function failUnitOf(s: { id: string; block: string }): string {
  return INDEPENDENT_BLOCKS.has(s.block) ? `${s.block}/${s.id}` : s.block;
}

/** Client codes that stop the battery (the brief's stop rules). */
export const STOP_CODES: ReadonlySet<string> = new Set(["LOST", "WEDGED", "MODAL_OPEN"]);
/**
 * Refusal codes that prove a handler compiled and answered (the compile gate): a domain refusal is
 * an answer. UNREACHABLE, HANDLER_ERROR or an unknown-handler answer is not.
 */
export const DOMAIN_CODES: ReadonlySet<string> = new Set([
  "ENGINE_FALSE",
  "STALE_CURSOR",
  "RESOURCE_NOT_FOUND",
  "PATH_NOT_FOUND",
  "INVALID_ARGUMENT",
  "NOT_IN_PROJECT",
  "WRONG_MODE",
  "NO_WORLD",
  "ENTITY_NOT_FOUND",
  "NO_AI_WORLD",
  "NO_NAVMESH_COMPONENT",
  "NOT_SCR_AI_WORLD",
  "NO_SOUND_COMPONENT",
  "NO_SIGNALS_MANAGER",
  "NO_SOUND_WORLD",
  "EVENT_NOT_FOUND",
  "VARIABLE_NOT_FOUND",
  "PLAY_FAILED",
  "NOT_A_PARTICLE_EFFECT",
  "NO_PARTICLES",
  "BOX_TOO_LARGE",
  "WRONG_MODULE",
  "GATED",
  "UNPROVEN",
]);

/** Titles a step may add: W1's list plus the Audio Editor (W5.7). */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
export const WORKBENCH_WINDOWS: readonly RegExp[] = [
  /^World Editor - .+$/,
  /^World Editor$/,
  DEBUG_TITLE,
  /^Enfusion Workbench( - .+)?$/,
  /^Arma Reforger Workbench$/,
  /^Procedural Animation Editor$/,
  /^String Editor$/,
  /^Behavior Editor - EMCP2_sandbox$/,
  /^Audio Editor( - .+)?$/,
  /^Animation Editor$/,
];
export const AUDIO_EDITOR_TITLE = /^Audio Editor( - .+)?$/;

// ── Coverage tables ──────────────────────────────────────────────────────────

/** The W5 contracts in contracts/ and the TS tool that drives each. */
export const W5_CONTRACTS = {
  EMCP_WB_Audio: "wb_audio",
  EMCP_WB_Particle: "wb_particle",
  EMCP_WB_Navmesh: "wb_navmesh",
} as const;

/** The TypeScript-only actions of the wave's tools (spec 2.4: the 49 offline actions, the aliases, the CLI verbs). */
export const TS_ONLY_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  audio: [...AUDIO_READ_ACTIONS, ...AUDIO_WRITE_ACTIONS, ...AUDIO_GRAPH_ACTIONS],
  particle: [...PARTICLE_READ_ACTIONS, ...PARTICLE_WRITE_ACTIONS],
  navmesh: [...NAVMESH_ACTIONS],
  particle_inspect: ["inspect"],
  terrain_navmesh_status: ["status"],
  wb_cli_run: ["navmeshGenerate", "navmeshBake"],
};

/** Contract and TS-only actions no step exercises, with the reason. Every one is exercised. */
export const NOT_EXERCISED: Readonly<Record<string, string>> = {};

/** Probes no step can settle in this battery, with the reason (the rest are assigned to steps). */
export const NOT_TESTABLE: Readonly<Record<string, string>> = {
  "P-W5-01":
    "the headless bake is its own Workbench process (-wbModule=WorldEditor -autogenerate, a 600 s watchdog that ends only the PID it started); it cannot run beside the GUI Workbench this battery drives on the same profile and project, so it runs after the post-flight through this script's `bake` subcommand (W5.md step 7), last, as the spec's run order says; its verdict lands in <sitting>/w5-bake.json and w5-result.json reads it",
};

/** The probe ids P-W5-01 .. P-W5-17. */
export const PROBE_IDS: readonly string[] = Array.from(
  { length: 17 },
  (_, i) => `P-W5-${String(i + 1).padStart(2, "0")}`,
);

// ── Types ────────────────────────────────────────────────────────────────────

export type W5Tool =
  | "wb_audio"
  | "wb_particle"
  | "wb_navmesh"
  | "wb_resources"
  | "wb_container"
  | "wb_module"
  | "wb_world"
  | "wb_entity"
  | "wb_gui"
  | "terrain_navmesh_status";

export type OfflineTool = "audio" | "particle" | "navmesh" | "particle_inspect" | "wb_cli_run";

export const HANDLER_OF: Readonly<Record<W5Tool, string>> = {
  wb_audio: "EMCP_WB_Audio",
  wb_particle: "EMCP_WB_Particle",
  wb_navmesh: "EMCP_WB_Navmesh",
  wb_resources: "EMCP_WB_Resources",
  wb_container: "EMCP_WB_Container",
  wb_module: "EMCP_WB_Module",
  wb_world: "EMCP_WB_World",
  wb_entity: "EMCP_WB_Entity",
  wb_gui: "<wb_gui: the UIA window list of the pid, no NET call>",
  terrain_navmesh_status: "EMCP_WB_Navmesh",
};

export type Block =
  | "W5.0"
  | "W5.1"
  | "W5.2"
  | "W5.3"
  | "W5.4"
  | "W5.5"
  | "W5.6"
  | "W5.7"
  | "W5.8"
  | "W5.9"
  | "W5.10";
export type Risk = "read-only" | "reversible" | "mutating";
export type Verdict = "PASS" | "FAIL" | "KILLED" | "NOT-RUN" | "SKIPPED";
export type RecordStatus = Verdict | "STOPPED" | "HANDOFF" | "ABORTED" | "HELD";

export interface ProbeResult {
  id: string;
  /** SETTLED: answered as the probe asks; KILLED: its kill criterion is met; PARTIAL: part answered. */
  result: "SETTLED" | "KILLED" | "PARTIAL";
  /** The observed values, verbatim from the readbacks. */
  observed: Record<string, unknown>;
  note: string;
}

export interface ToolResponse {
  ok: boolean;
  action?: string;
  target?: string;
  code?: string;
  message?: string;
  changed?: unknown;
  readback?: unknown;
  next?: string;
  warnings?: string[];
  [extra: string]: unknown;
}

export interface UndoResult {
  ok: boolean;
  message: string;
  code?: string;
}

export interface StepOutcome {
  status: Verdict;
  detail: string;
  evidence: Record<string, unknown>;
  probes?: ProbeResult[];
}

export interface StepRecord {
  step: string;
  block: Block;
  title: string;
  status: RecordStatus;
  detail: string;
  startedAt: string;
  endedAt: string;
  probes: ProbeResult[];
  evidence: Record<string, unknown>;
  stop?: string;
}

/** The game data, read from the paks (P-W5-17). */
export interface VanillaFs {
  paths: () => string[];
  read: (p: string) => Buffer;
}

export interface W5Deps {
  /** One shipped TS tool, run in process against a client WITHOUT a Config. */
  tool: (name: W5Tool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /**
   * One offline TS tool, run in process with projectPath set to the test project's folder.
   * `probeGates: true` (audio only) passes PROBE_GATES for that one call (P-W5-04, P-W5-05).
   */
  offline: (name: OfflineTool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** EMCP_WB_EditorControl {action: "undo"} / {action: "redo"} (World Editor Edit menu), never retried. */
  undo: () => Promise<UndoResult>;
  redo: () => Promise<UndoResult>;
  /** EMCP_WB_Info and EMCP_WB_Ping through client.probe (reads). */
  info: () => Promise<Record<string, unknown> | null>;
  ping: () => Promise<Record<string, unknown> | null>;
  bundleDigest: () => string | null;
  windows: () => Promise<WindowInfo[]>;
  recordedPid: () => number | null;
  /** The game paks; null when they cannot be opened. */
  vanilla: () => VanillaFs | null;
  readBytes: (path: string) => Buffer;
  writeBytes: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  /** Relative paths of every file under `dir` (forward slashes), [] when absent. */
  listTree: (dir: string) => string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface W5Options {
  runDir: string;
  sittingDir: string;
  sandboxDir: string;
  evidenceDir: string | null;
  ph: PlaceholderContext;
  build: string;
  /** --skip-hand: a hand step is recorded HELD instead of waiting for the hand. */
  skipHand?: boolean;
}

/** What a step left behind: undo points still on the stack and state to restore. */
export interface Debt {
  undos: number;
  restorers: Array<{ label: string; fn: () => Promise<unknown> }>;
}

export interface StepContext {
  deps: W5Deps;
  opts: W5Options;
  prior: (id: string) => StepRecord | null;
  /** True when the probe is recorded KILLED in this run folder (a step's conditional half). */
  killed: (probe: string) => boolean;
  calls: Array<Record<string, unknown>>;
  debt: Debt;
  /** Values steps share within one run (fixture resource names). */
  state: Map<string, string>;
  /** A tool call: guarded by the window poller; a stop code throws unless `tolerate`. */
  tool: (
    name: W5Tool,
    args: Record<string, unknown>,
    o?: { restore?: boolean; tolerate?: boolean },
  ) => Promise<ToolResponse>;
  offline: (name: OfflineTool, args: Record<string, unknown>) => Promise<ToolResponse>;
  /** One Edit > Undo / Redo; an undo pays one undo point when it answers ok. */
  undo: () => Promise<UndoResult>;
  redo: () => Promise<UndoResult>;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

/** One offline tool call a step makes (no NET call; in the coverage and write checks). */
export interface OfflineCall {
  tool: OfflineTool;
  action: string;
  params: Record<string, unknown>;
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
  /** Probe ids this step settles (fully or in part). */
  probes: string[];
  /** Probes whose KILLED result skips this step. */
  dependsOn?: string[];
  /** Project-relative files or folders this step may create or change. */
  writes: string[];
  expectsWindows?: readonly RegExp[];
  /** A hand step: the main session's hand answers a request file (none in W5). */
  hand?: boolean;
  plan: () => PlanAction[];
  offlineCalls?: () => OfflineCall[];
  run: (ctx: StepContext) => Promise<StepOutcome>;
}

// ── Small helpers ────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function field(o: unknown, name: string): unknown {
  return o && typeof o === "object" ? (o as Raw)[name] : undefined;
}

function S(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function N(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function rb(r: ToolResponse | null | undefined): Raw {
  return r && r.readback && typeof r.readback === "object" ? (r.readback as Raw) : {};
}

/** A record of a response; its readback cut to `cap` characters of JSON (offline reads are long). */
function brief(r: ToolResponse | null | undefined, cap = 6000): Raw | null {
  if (!r) return null;
  const text = JSON.stringify(r.readback ?? null);
  const readback = text.length > cap ? { cut: `${text.slice(0, cap)}...` } : (r.readback ?? null);
  return r.ok
    ? { ok: true, readback, warnings: r.warnings ?? [] }
    : { ok: false, code: r.code ?? null, message: r.message ?? null, readback };
}

function why(r: ToolResponse): string {
  return `${S(r.action)}: ${S(r.code)} ${S(r.message)}`.trim();
}

function sha256(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

function abs(sandboxDir: string, rel: string): string {
  return join(sandboxDir, ...rel.split("/"));
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => S(x)) : [];
}

function rowsOf(r: ToolResponse | null | undefined): Raw[] {
  const rows = rb(r).rows;
  return Array.isArray(rows) ? (rows as Raw[]) : [];
}

function readJson<T>(path: string, deps: Pick<W5Deps, "exists" | "readBytes">): T | null {
  if (!deps.exists(path)) return null;
  try {
    return JSON.parse(deps.readBytes(path).toString("utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown, deps: Pick<W5Deps, "writeBytes">): void {
  deps.writeBytes(path, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf-8"));
}

const settled = (id: string, observed: Raw, note = ""): ProbeResult => ({
  id,
  result: "SETTLED",
  observed,
  note,
});
const killed = (id: string, observed: Raw, note: string): ProbeResult => ({
  id,
  result: "KILLED",
  observed,
  note,
});
const partial = (id: string, observed: Raw, note: string): ProbeResult => ({
  id,
  result: "PARTIAL",
  observed,
  note,
});

/** A step's verdict from its checks: any failed check FAIL, else KILLED when a probe was killed. */
function verdictOf(
  fails: string[],
  probes: ProbeResult[],
  passDetail: string,
): Pick<StepOutcome, "status" | "detail"> {
  if (fails.length) return { status: "FAIL", detail: fails.join("; ") };
  const k = probes.filter((p) => p.result === "KILLED");
  if (k.length) return { status: "KILLED", detail: k.map((p) => `${p.id}: ${p.note}`).join("; ") };
  return { status: "PASS", detail: passDetail };
}

/** The bytes of a sandbox file, or null when it is absent. */
function bytesOf(ctx: StepContext, rel: string): Buffer | null {
  const p = abs(ctx.opts.sandboxDir, rel);
  return ctx.deps.exists(p) ? ctx.deps.readBytes(p) : null;
}

function same(a: Buffer | null, b: Buffer | null): boolean {
  return !!a && !!b && a.equals(b);
}

/** Lines removed from `a` and added in `b` (longest common subsequence; W1's exactLineDiff). */
export function exactLineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const x = a.split(/\r?\n/);
  const y = b.split(/\r?\n/);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++;
  const xs = x.slice(head, x.length - tail);
  const ys = y.slice(head, y.length - tail);
  const m = xs.length;
  const n = ys.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      t[i]![j] = xs[i] === ys[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (xs[i] === ys[j]) {
      i++;
      j++;
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) removed.push(xs[i++]!);
    else added.push(ys[j++]!);
  }
  while (i < m) removed.push(xs[i++]!);
  while (j < n) added.push(ys[j++]!);
  return { removed, added };
}

/** A diff summary for the record (the lines themselves, capped). */
function diffOf(a: Buffer | null, b: Buffer | null): Raw {
  const d = exactLineDiff(a ? a.toString("utf-8") : "", b ? b.toString("utf-8") : "");
  return { removed: d.removed.slice(0, 20), added: d.added.slice(0, 20) };
}

/** True when two floats agree to 1e-3 (the engine reads floats back through text). */
export function near(a: unknown, b: number, eps = 1e-3): boolean {
  const n = N(a);
  return n !== null && Math.abs(n - b) <= eps;
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** The plan entry of one tool call: the handler it sends to, the wire action, tool and action. */
export function tc(
  tool: W5Tool,
  action: string,
  params: Raw = {},
  extra: { toolAction?: string; note?: string; target?: string } = {},
): PlanAction {
  return {
    kind: "net-call",
    target: extra.target ?? HANDLER_OF[tool],
    params: { action, ...params },
    tool,
    toolAction: extra.toolAction ?? action,
    note: extra.note ?? "through the shipped TS tool, in process",
  } as PlanAction;
}

/** One offline call of a step (no NET call). */
export function oc(tool: OfflineTool, action: string, params: Raw = {}): OfflineCall {
  return { tool, action, params: { action, ...params } };
}

/** The shipped undo or redo: its net-call and the ExecuteAction it runs (the checker reads the path). */
export function editPlan(what: "Undo" | "Redo", times = 1): PlanAction[] {
  const out: PlanAction[] = [];
  for (let i = 0; i < times; i++) {
    out.push({
      kind: "net-call",
      target: "EMCP_WB_EditorControl",
      params: { action: what.toLowerCase() },
      note: `Edit > ${what} through the shipped EditorControl`,
    } as PlanAction);
    out.push({
      kind: "execute-action",
      target: { path: ["Edit", what], module: "WorldEditor" },
      via: `EMCP_WB_EditorControl {action: ${what.toLowerCase()}}`,
    } as PlanAction);
  }
  return out;
}

/** Tool actions that write a file (the plan scan of the harness test checks their paths). */
export const FILE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  "wb_resources.register",
  "wb_world.new",
  "wb_world.register",
  "wb_module.save",
  "wb_audio.open",
]);

/** The offline write actions (a confirmed one names a file under _throwaway/W5/; the harness checks). */
export const OFFLINE_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  ...AUDIO_WRITE_ACTIONS.map((a) => `audio.${a}`),
  ...AUDIO_GRAPH_ACTIONS.map((a) => `audio.${a}`),
  ...PARTICLE_WRITE_ACTIONS.map((a) => `particle.${a}`),
  "navmesh.overrideConfig",
]);

const WINDOW_KILL =
  "a new dialog-like window: HANDOFF (nothing sent to it; the record names the title and the answer, never Save); any other new window: STOP; LOST, WEDGED or MODAL_OPEN: STOP";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The planted files on disk (offline steps need no registration first). */
async function ensureFixturesOnDisk(ctx: StepContext): Promise<void> {
  const missing = PLANTED.filter((rel) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)));
  if (missing.length)
    throw new StopBattery(
      "stopped",
      `planted file(s) absent: ${missing.join(", ")}: run \`w5.live.ts plant\` first (nothing is sent for a file that is not on disk)`,
    );
}

/**
 * The live fixtures on disk and registered, with their resource names (cached for the run). A
 * resolve that finds a .meta needs nothing more; a fixture without one (a resumed run that did not
 * pass w5-04) is registered here. A planted file that is absent stops the battery.
 */
async function ensureFixtures(ctx: StepContext): Promise<Record<string, string>> {
  await ensureFixturesOnDisk(ctx);
  const out: Record<string, string> = {};
  for (const rel of LIVE_FIXTURES) {
    const cached = ctx.state.get(rel);
    if (cached) {
      out[rel] = cached;
      continue;
    }
    const r = await ctx.tool("wb_resources", { action: "resolve", path: rel });
    let name = r.ok && rb(r).hasMeta === true ? S(rb(r).resourceName) : "";
    if (!name) {
      const reg = await ctx.tool("wb_resources", { action: "register", path: rel, confirm: true });
      name = S(rb(reg).resourceName);
      if (!reg.ok || !name)
        throw new StopBattery(
          "stopped",
          `the fixture ${rel} could not be registered (${why(reg)}): no step on it is sent`,
          { resolve: brief(r), register: brief(reg) },
        );
    }
    ctx.state.set(rel, name);
    out[rel] = name;
  }
  return out;
}

function fixturePlan(): PlanAction[] {
  return LIVE_FIXTURES.flatMap((rel) => [
    tc("wb_resources", "resolve", { path: rel }, { note: "the fixture's resource name" }),
    tc(
      "wb_resources",
      "register",
      { path: rel, confirm: true },
      { note: "only when resolve finds no .meta (a resumed run that did not pass w5-04)" },
    ),
  ]);
}

/** The GUID of a resource name `{GUID}path`, "" when it has none. */
export function guidOf(name: string): string {
  const m = /^\{([0-9A-Fa-f]{16})\}/.exec(name);
  return m ? m[1]!.toUpperCase() : "";
}

/**
 * The project-relative .meta of a source file: `<resource path>.meta` when its resource name names
 * a file (W2 fix-up 1: a .png registers as .edds; the W5 types register as themselves, unproven),
 * else `<rel>.meta`.
 */
export function metaRelOf(rel: string, resourceName = ""): string {
  const path = resourceName.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (guidOf(resourceName) && path !== "") return `${path}.meta`;
  return `${rel}.meta`;
}

/** Register an offline-edited copy (after its edit; the engine's first load sees the edit). */
async function registerCopy(
  ctx: StepContext,
  rel: string,
  evidence: Raw,
  fails: string[],
): Promise<string> {
  const reg = await ctx.tool("wb_resources", { action: "register", path: rel, confirm: true });
  evidence.register = brief(reg);
  const name = S(rb(reg).resourceName);
  if (!reg.ok) fails.push(`register ${rel}: ${why(reg)}`);
  else if (!guidOf(name)) fails.push(`register ${rel}: no {GUID} in '${name}'`);
  return name;
}

/**
 * Engine reads of one value by property path: each candidate path is sent until one answers ok
 * (the dotted forms of a nested array element are not proven for these file types; the record
 * names which form the engine took). Reads only.
 */
async function getAny(
  ctx: StepContext,
  target: string,
  paths: readonly string[],
): Promise<{ path: string | null; value: string | null; tried: Raw[] }> {
  const tried: Raw[] = [];
  for (const path of paths) {
    const g = await ctx.tool("wb_container", { action: "get", target, path });
    tried.push({ path, ...(brief(g, 600) ?? {}) });
    if (g.ok) return { path, value: S(rb(g).value), tried };
  }
  return { path: null, value: null, tried };
}

// ── World (the throwaway tiny world, OD-4) ───────────────────────────────────

/** Why the battery refuses to open `rel`: a world under _throwaway/ must exist on disk. */
export function missingWorldRefusal(
  ctx: { opts: { sandboxDir: string }; deps: { exists(p: string): boolean } },
  rel: string,
): string | null {
  const r = rel.replace(/\\/g, "/");
  if (!r.startsWith(`${THROWAWAY}/`)) return null;
  if (ctx.deps.exists(abs(ctx.opts.sandboxDir, r))) return null;
  return `the world ${r} is not on disk under the sandbox: the open is not sent`;
}

/** The open world's project-relative path ("$EMCP2_sandbox:" and backslashes stripped). */
export function openRel(worldPath: string): string {
  return worldPath.replace(/\\/g, "/").replace(/^\$[^:]*:/, "");
}

/** True for the throwaway world (the only world the battery saves). */
export function isSavableThrowaway(rel: string): boolean {
  return openRel(rel).toLowerCase() === WORLD.toLowerCase();
}

/** Open a world in the World Editor and wait until wb_world state names it. */
async function openWorld(
  ctx: StepContext,
  rel: string,
): Promise<{ ok: boolean; evidence: Raw; worldPath: string }> {
  const refusal = missingWorldRefusal(ctx, rel);
  if (refusal) return { ok: false, worldPath: "", evidence: { refused: refusal } };
  const open = await ctx.tool("wb_module", { action: "open", module: "WorldEditor" });
  const set = await ctx.tool("wb_module", {
    action: "setResource",
    module: "WorldEditor",
    target: `path:${rel}`,
  });
  const started = ctx.deps.now();
  let polls = 0;
  let worldPath = "";
  for (;;) {
    polls++;
    const st = await ctx.tool("wb_world", { action: "state" });
    worldPath = S(rb(st).worldPath);
    const ready = st.ok && worldPath.toLowerCase().endsWith(rel.toLowerCase());
    if (ready || !set.ok || ctx.deps.now() - started + TIMEOUTS.poll > TIMEOUTS.open) {
      const settled = ready ? await waitNotBusy(ctx) : null;
      return {
        ok: ready && settled?.ok !== false,
        worldPath,
        evidence: { open: brief(open), setResource: brief(set), polls, worldPath, settled },
      };
    }
    await ctx.sleep(TIMEOUTS.poll);
  }
}

/**
 * Fix-up 2: waits until no window of the Workbench pid is busy (`isBusyWindow`: disabled, unowned,
 * editor or tool class), at most BUSY_GRACE_MS. W5 run 2: worldPath named GM_Arland while the
 * load's tail still had the World Editor window disabled (the post-flight close met it ~9 s after
 * "Entities load"). Reads the window list only; nothing is sent to any window.
 */
async function waitNotBusy(ctx: StepContext): Promise<{ ok: boolean; polls: number; busy: string[] }> {
  const pid = ctx.deps.recordedPid();
  const started = ctx.deps.now();
  let polls = 0;
  for (;;) {
    polls++;
    const busy =
      pid === null
        ? []
        : (await ctx.deps.windows())
            .filter((w) => w.pid === pid && isBusyWindow(w))
            .map((w) => `${w.className} "${w.title}"`);
    if (!busy.length) return { ok: true, polls, busy };
    if (ctx.deps.now() - started + TIMEOUTS.poll > BUSY_GRACE_MS) return { ok: false, polls, busy };
    await ctx.sleep(TIMEOUTS.poll);
  }
}

function openPlan(rel: string): PlanAction[] {
  return [
    tc("wb_module", "open", { moduleName: "WorldEditor" }),
    tc("wb_module", "setResource", { moduleName: "WorldEditor", path: rel }),
    tc("wb_world", "state", {}, { note: "polled until worldPath names the world" }),
  ];
}

/**
 * The open throwaway world saved in place (W1 run 6: a world switch that meets a dirty world
 * raises the engine's save prompt). Null when the open world is not the throwaway world: nothing
 * else is ever saved.
 */
async function saveThrowaway(ctx: StepContext): Promise<Raw | null> {
  const st = await ctx.tool("wb_world", { action: "state" });
  const rel = openRel(S(rb(st).worldPath));
  if (!st.ok || !isSavableThrowaway(rel)) return null;
  const sv = await ctx.tool("wb_module", { action: "save", module: "WorldEditor", confirm: true });
  // Saved: what the step owed is now on disk; undoing it would make the world dirty again.
  ctx.debt.undos = 0;
  return { world: rel, save: brief(sv), ok: sv.ok };
}

function saveThrowawayPlan(note: string): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc(
      "wb_module",
      "save",
      { moduleName: "WorldEditor", confirm: true, path: WORLD },
      { note: `${note}; sent only while the open world is ${WORLD}` },
    ),
  ];
}

/** Places the AIWorld prefab and the two props in the open throwaway world, then saves it. */
async function populateWorld(ctx: StepContext, evidence: Raw, fails: string[]): Promise<void> {
  const ai = await ctx.tool("wb_entity", {
    action: "create",
    prefab: AIWORLD_PREFAB,
    name: AIWORLD_NAME,
    coords: "0 0 0",
  });
  evidence.createAIWorld = brief(ai);
  if (!ai.ok) fails.push(`create ${AIWORLD_NAME}: ${why(ai)}`);
  for (const [i, name] of BOX_NAMES.entries()) {
    const b = await ctx.tool("wb_entity", {
      action: "create",
      prefab: BOX_PREFAB,
      name,
      coords: `${4 + 4 * i} 0 ${4 + 4 * i}`,
    });
    evidence[`create${name}`] = brief(b);
    if (!b.ok) fails.push(`create ${name}: ${why(b)}`);
  }
  const sv = await saveThrowaway(ctx);
  evidence.save = sv;
  if (!sv?.ok) fails.push("the throwaway world was not saved after the placement");
}

function populatePlan(): PlanAction[] {
  return [
    tc("wb_entity", "list", { name: AIWORLD_NAME }, { note: "placed already?" }),
    tc("wb_entity", "create", { prefab: AIWORLD_PREFAB, name: AIWORLD_NAME, coords: "0 0 0" }),
    ...BOX_NAMES.map((name, i) =>
      tc("wb_entity", "create", {
        prefab: BOX_PREFAB,
        name,
        coords: `${4 + 4 * i} 0 ${4 + 4 * i}`,
      }),
    ),
    ...saveThrowawayPlan("the placement saved"),
  ];
}

/**
 * The W5 world on disk, registered, open and populated (`wb_world new` and the placement when
 * absent: a resumed run that did not pass w5-05). The open world is saved first when it is the
 * throwaway world; any other open world is vanilla and read-only (W5.6), never edited.
 */
async function ensureWorld(ctx: StepContext, evidence: Raw, fails: string[]): Promise<boolean> {
  const st = await ctx.tool("wb_world", { action: "state" });
  const present = ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD));
  let open = st.ok && isSavableThrowaway(S(rb(st).worldPath));
  evidence.worldPresent = present;
  if (!open) {
    if (!present) {
      const dry = await ctx.tool("wb_world", { action: "new", path: WORLD });
      evidence.newDry = brief(dry);
      if (ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD)))
        fails.push("the world dry run wrote it");
      const made = await ctx.tool("wb_world", { action: "new", path: WORLD, confirm: true });
      evidence.newConfirm = brief(made);
      if (!made.ok) {
        fails.push(`new: ${why(made)}`);
        return false;
      }
    }
    const reg = await ctx.tool("wb_world", { action: "register", path: WORLD });
    evidence.register = brief(reg);
    if (!reg.ok) {
      fails.push(`register: ${why(reg)}`);
      return false;
    }
    const o = await openWorld(ctx, WORLD);
    evidence.open = o.evidence;
    if (!o.ok) {
      fails.push(`the W5 world did not open ('${o.worldPath}')`);
      return false;
    }
    open = true;
  } else evidence.world = "already open";
  const placed = await ctx.tool("wb_entity", { action: "list", name: AIWORLD_NAME });
  evidence.placed = brief(placed, 800);
  const n = N(rb(placed).total) ?? rowsOf(placed).length;
  if (placed.ok && n === 0) await populateWorld(ctx, evidence, fails);
  return open;
}

function worldPlan(): PlanAction[] {
  return [
    tc("wb_world", "state"),
    tc(
      "wb_world",
      "register",
      { path: WORLD },
      { toolAction: "new", note: "offline writer (dry run)" },
    ),
    tc(
      "wb_world",
      "register",
      { path: WORLD, confirm: true },
      { toolAction: "new", note: "offline writer in TS, then register (when absent)" },
    ),
    tc("wb_world", "register", { path: WORLD }),
    ...openPlan(WORLD),
    ...populatePlan(),
  ];
}

// ── Play mode (fix-up 1) ─────────────────────────────────────────────────────

/**
 * Probe P-W5-06 was KILLED in W5 run 1 (w5-11: the known-good vanilla event answered handle 256
 * not playing in edit mode; w5-10: GetVariableIDByName -1 for GInterior, which GlobalVariables.conf
 * holds). Its repoint: the AudioSystem actions refuse WRONG_MODE in edit mode and the battery runs
 * them inside wb_world play (P-W5-10). The note every later run carries for it.
 */
export const P6_CARRIED =
  "carried from W5 run 1 (w5-11-audio-play: the vanilla event answered handle 256, playing false, in edit mode): the AudioSystem actions refuse WRONG_MODE in edit mode and run inside wb_world play";

/** What one play round answered (inPlay). */
export interface PlayRound<T> {
  /** The throwaway world saved before the play (w5-80's order). */
  save: Raw | null;
  play: ToolResponse | null;
  during: ToolResponse | null;
  result: T | null;
  stop: ToolResponse | null;
  after: ToolResponse;
}

/**
 * Runs `fn` inside wb_world play, after the throwaway world is saved: the stop is owed (a restorer) from before the play, sent in a
 * finally path and the restorer removed once sent; the state after is read. `fn` runs only when
 * the play answered ok.
 */
async function inPlay<T>(ctx: StepContext, fn: () => Promise<T>): Promise<PlayRound<T>> {
  const save = await saveThrowaway(ctx);
  const owed = {
    label: "wb_world stop",
    fn: () => ctx.deps.tool("wb_world", { action: "stop" }),
  };
  ctx.debt.restorers.push(owed);
  let play: ToolResponse | null = null;
  let during: ToolResponse | null = null;
  let result: T | null = null;
  let stop: ToolResponse | null = null;
  try {
    play = await ctx.tool("wb_world", { action: "play", debugMode: false, fullScreen: false });
    if (play.ok) {
      during = await ctx.tool("wb_world", { action: "state" });
      result = await fn();
    }
  } finally {
    if (!ctx.signal.aborted) {
      stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
      const i = ctx.debt.restorers.indexOf(owed);
      if (i >= 0) ctx.debt.restorers.splice(i, 1);
    }
  }
  const after = await ctx.tool("wb_world", { action: "state" });
  return { save, play, during, result, stop, after };
}

function playPlan(calls: PlanAction[]): PlanAction[] {
  return [
    ...saveThrowawayPlan("the world saved before play"),
    tc("wb_world", "play", { debugMode: false, fullScreen: false }),
    tc("wb_world", "state"),
    ...calls,
    tc("wb_world", "stop"),
    tc("wb_world", "state"),
  ];
}

/** A handler answer: ok, or a refusal with one of the wave's domain codes. */
function answeredInPlay(r: ToolResponse | null): boolean {
  return !!r && (r.ok || DOMAIN_CODES.has(S(r.code)));
}

/** The play round's own failures: play started, the calls answered, back in edit mode. */
function playFails(round: PlayRound<unknown>, fails: string[]): void {
  if (!round.play?.ok) fails.push(`wb_world play: ${round.play ? why(round.play) : "not sent"}`);
  if (!round.stop?.ok) fails.push(`wb_world stop: ${round.stop ? why(round.stop) : "not sent"}`);
  else if (S(rb(round.after).mode) !== "edit")
    fails.push(`not back in edit mode (${S(rb(round.after).mode)})`);
}

/**
 * P-W5-10 (the audio half) from a play round: KILLED when the NET queue did not answer during play
 * or stop did not return to edit mode (the probe's kill criterion), PARTIAL when play did not start.
 */
function judgePlayAudio(round: PlayRound<unknown>, calls: Array<ToolResponse | null>): ProbeResult {
  const observed = {
    play: round.play ? (round.play.ok ? (rb(round.play).mode ?? "ok") : S(round.play.code)) : null,
    stateDuringPlay: round.during?.ok
      ? (rb(round.during).mode ?? null)
      : S(round.during?.code ?? ""),
    calls: calls.map((r) => (r ? (r.ok ? "ok" : S(r.code)) : "not sent")),
    modeAfter: rb(round.after).mode ?? null,
  };
  if (!round.play?.ok)
    return partial(
      "P-W5-10",
      observed,
      `play did not start: ${round.play ? why(round.play) : "not sent"}`,
    );
  const net = [round.during, ...calls].every(answeredInPlay);
  const backInEdit = !!round.stop?.ok && S(rb(round.after).mode) === "edit";
  if (!net || !backInEdit)
    return killed(
      "P-W5-10",
      observed,
      !net
        ? "the handler NET queue did not answer during play (audio half)"
        : "stop did not return to edit mode",
    );
  return settled("P-W5-10", observed, "the AudioSystem calls answer in play mode; back in edit");
}

// ── Particle effect entity ───────────────────────────────────────────────────

/** `name:<name>` stats of a placed effect; spawns it (confirm) when it is not there (a resumed run). */
async function ensureEffect(
  ctx: StepContext,
  effect: string,
  name: string,
  evidence: Raw,
): Promise<ToolResponse> {
  const st = await ctx.tool("wb_particle", { action: "stats", entity: `name:${name}` });
  if (st.ok || st.code !== "ENTITY_NOT_FOUND") return st;
  const sp = await ctx.tool("wb_particle", {
    action: "spawn",
    effect,
    name,
    coords: "0 1 0",
    confirm: true,
  });
  evidence[`respawn${name}`] = brief(sp);
  return ctx.tool("wb_particle", { action: "stats", entity: `name:${name}` });
}

// ── Hand requests (W1's mechanism; W5 has no hand step) ──────────────────────

/** The request and answer files of one hand observation, in the run folder (never reused). */
export function handFiles(runDir: string, key: string): { request: string; answer: string } {
  return {
    request: join(runDir, `hand-${key}.request.json`),
    answer: join(runDir, `hand-${key}.json`),
  };
}

/** The one HAND REQUEST log line: the run folder and the full answer-file path. */
export function handLine(runDir: string, key: string, instruction: string): string {
  return `HAND REQUEST ${key}: ${instruction} | run folder: ${runDir} | write the answer (JSON) to: ${handFiles(runDir, key).answer}`;
}

/**
 * Asks the main session's hand for one observation or action: writes the request file, logs one
 * HAND REQUEST line and polls for the answer file (JSON) up to HAND_WAIT_MS. Null when none came.
 * Kept for a hand step added at the END of the battery (spec 6 justifies none today).
 */
export async function awaitHand(
  ctx: StepContext,
  key: string,
  instruction: string,
): Promise<Raw | null> {
  const f = handFiles(ctx.opts.runDir, key);
  writeJson(
    f.request,
    {
      key,
      instruction,
      answer: basename(f.answer),
      answerPath: f.answer,
      runDir: ctx.opts.runDir,
      askedAt: new Date(ctx.deps.now()).toISOString(),
    },
    ctx.deps,
  );
  ctx.deps.log(handLine(ctx.opts.runDir, key, instruction));
  const started = ctx.deps.now();
  for (;;) {
    const a = readJson<Raw>(f.answer, ctx.deps);
    if (a) return a;
    if (ctx.deps.now() - started + TIMEOUTS.poll > HAND_WAIT_MS) return null;
    await ctx.sleep(TIMEOUTS.poll);
  }
}

// ── Net-zero (W2's snapshot, rooted at _throwaway/W5/) ───────────────────────

export interface BatterySnapshot {
  kind: typeof BATTERY_SNAPSHOT_KIND;
  root: string;
  taken_at: string;
  taken_by?: "gate" | "run start";
  files: Record<string, string>;
}

/** sha256 of every sandbox file outside _throwaway/W5/. */
export function sandboxHashes(
  sandboxDir: string,
  deps: Pick<W5Deps, "listTree" | "readBytes">,
): Record<string, string> {
  return Object.fromEntries(
    deps
      .listTree(sandboxDir)
      .filter((f) => !f.startsWith(`${W5_ROOT}/`))
      .map((f) => [f, sha256(deps.readBytes(abs(sandboxDir, f)))]),
  );
}

/**
 * Writes the battery's before-snapshot into the sitting folder when none is there, and answers
 * whether it did. runBattery calls it before the first step of every run that does not begin at
 * the gate (--from, --only), so w5-95 always has a baseline (W1 run 7).
 */
export function ensureBatterySnapshot(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W5Deps, "exists" | "readBytes" | "writeBytes" | "listTree" | "now">,
  takenBy: "gate" | "run start",
): boolean {
  const snap = join(sittingDir, BATTERY_SNAPSHOT_FILE);
  if (deps.exists(snap)) return false;
  const taken: BatterySnapshot = {
    kind: BATTERY_SNAPSHOT_KIND,
    root: sandboxDir,
    taken_at: new Date(deps.now()).toISOString(),
    taken_by: takenBy,
    files: sandboxHashes(sandboxDir, deps),
  };
  writeJson(snap, taken, deps);
  return true;
}

export function changedFiles(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
}

/** w5-95's comparison: the battery's snapshot against the sandbox now, outside _throwaway/W5/. */
export function netZeroDiff(
  sittingDir: string,
  sandboxDir: string,
  deps: Pick<W5Deps, "exists" | "readBytes" | "listTree">,
): { takenBy: string; takenAt: string; changed: string[] } | null {
  const snap = readJson<BatterySnapshot>(join(sittingDir, BATTERY_SNAPSHOT_FILE), deps);
  if (!snap || snap.kind !== BATTERY_SNAPSHOT_KIND || typeof snap.files !== "object") return null;
  const before = Object.fromEntries(
    Object.entries(snap.files).filter(([f]) => !f.startsWith(`${W5_ROOT}/`)),
  );
  return {
    takenBy: S(snap.taken_by),
    takenAt: S(snap.taken_at),
    changed: changedFiles(before, sandboxHashes(sandboxDir, deps)),
  };
}

// ── Offline: the .nmn headers (P-W5-17) ──────────────────────────────────────

/** Every vanilla .nmn in the paks (53 on 1.9.0.37). */
export function vanillaNmn(fs: VanillaFs): string[] {
  return fs
    .paths()
    .filter((p) => p.toLowerCase().endsWith(".nmn"))
    .sort();
}

/**
 * P-W5-17's judgement over the `navmesh header` answers: SETTLED when every header reads as the
 * format says (ok) and names a tile size; KILLED when headers do not read consistently; PARTIAL
 * when they read but a tile size is missing for some.
 */
export function judgeNmnHeaders(heads: Array<{ path: string; r: ToolResponse }>): ProbeResult {
  const bad = heads.filter((h) => !h.r.ok || rb(h.r).ok === false);
  const sizes: Record<string, number> = {};
  let noSize = 0;
  for (const h of heads) {
    // The header answers tileSize as [x, z] (24 24 on GM_Arland.nmn); a scalar is taken as is.
    const ts = rb(h.r).tileSize ?? field(rb(h.r).fields, "tileSize");
    const n = N(Array.isArray(ts) ? ts[0] : ts);
    if (n === null) noSize++;
    else sizes[String(n)] = (sizes[String(n)] ?? 0) + 1;
  }
  const observed = {
    files: heads.length,
    unreadable: bad.slice(0, 10).map((h) => ({ path: h.path, code: h.r.code ?? null })),
    tileSizes: sizes,
    withoutTileSize: noSize,
    first: heads[0] ? rb(heads[0].r) : null,
  };
  if (heads.length === 0) return partial("P-W5-17", observed, "no vanilla .nmn found in the paks");
  if (bad.length)
    return killed(
      "P-W5-17",
      observed,
      `${bad.length} of ${heads.length} headers do not read as the format says: header reports raw fields`,
    );
  if (noSize)
    return partial(
      "P-W5-17",
      observed,
      `every header reads; ${noSize} name no tile size: those fields stay raw`,
    );
  return settled(
    "P-W5-17",
    observed,
    `all ${heads.length} headers read (magic, version, tile size ${Object.keys(sizes).join("/")})`,
  );
}

// ── Offline: round trips (w5-03) ─────────────────────────────────────────────

/** One write with its inverse on a round-trip copy: dry run, confirm, inverse, byte compare. */
export interface RoundTrip {
  key: string;
  tool: "audio" | "particle";
  path: string;
  edit: Raw;
  inverse: Raw;
}

/** The round trips of w5-03 (the edits and their inverses on the rt/ copies). */
export const ROUND_TRIPS: readonly RoundTrip[] = [
  {
    key: "audio.set",
    tool: "audio",
    path: RT_ACP,
    edit: { action: "set", node: RALLY_BANK, key: "Volume", value: 2 },
    inverse: { action: "set", node: RALLY_BANK, key: "Volume", value: 3 },
  },
  {
    key: "audio.renameEvent",
    tool: "audio",
    path: RT_ACP,
    edit: { action: "renameEvent", event: RALLY_EVENT, name: "EMCP_W5_RT" },
    inverse: { action: "renameEvent", event: "EMCP_W5_RT", name: RALLY_EVENT },
  },
  {
    key: "audio.addSample",
    tool: "audio",
    path: RT_ACP,
    edit: { action: "addSample", bank: RALLY_BANK, file: V_ADD_SAMPLE, name: "EMCP_W5_Sample" },
    inverse: { action: "removeSample", bank: RALLY_BANK, sample: "EMCP_W5_Sample" },
  },
  {
    key: "audio.setSample",
    tool: "audio",
    path: RT_ACP,
    edit: {
      action: "setSample",
      bank: RALLY_BANK,
      sample: "Music_SynthBlades.snd",
      probability: 60,
    },
    inverse: {
      action: "setSample",
      bank: RALLY_BANK,
      sample: "Music_SynthBlades.snd",
      probability: 70,
    },
  },
  {
    key: "audio.set.afm",
    tool: "audio",
    path: RT_AFM,
    edit: { action: "set", node: "Music", key: "limit", value: 3 },
    inverse: { action: "set", node: "Music", key: "limit", value: 2 },
  },
  {
    key: "audio.addVariable",
    tool: "audio",
    path: RT_VARS,
    edit: { action: "addVariable", name: "EMCP_W5_RtVar", source: "Constant", value: 0.5 },
    inverse: { action: "removeVariable", name: "EMCP_W5_RtVar" },
  },
  {
    key: "particle.set",
    tool: "particle",
    path: RT_PTC,
    edit: { action: "set", emitter: "Fireflies", props: { BirthRate: 2 } },
    inverse: { action: "set", emitter: "Fireflies", props: { BirthRate: 1 } },
  },
  {
    key: "particle.setCurve",
    tool: "particle",
    path: RT_PTC,
    edit: {
      action: "setCurve",
      emitter: "Fireflies",
      curve: "Alpha",
      points: [0, 0, 0.5, 1, 1, 0],
    },
    inverse: {
      action: "setCurve",
      emitter: "Fireflies",
      curve: "Alpha",
      points: [0, 0, 0.375, 1, 0.62, 1, 1, 0],
    },
  },
  {
    key: "particle.addEmitter",
    tool: "particle",
    path: RT_PTC,
    edit: { action: "addEmitter", name: "EMCP_W5_Em" },
    inverse: { action: "removeEmitter", emitter: "EMCP_W5_Em" },
  },
  {
    key: "particle.cloneEmitter",
    tool: "particle",
    path: RT_PTC,
    edit: { action: "cloneEmitter", emitter: "Fireflies", name: "EMCP_W5_Clone" },
    inverse: { action: "removeEmitter", emitter: "EMCP_W5_Clone" },
  },
  {
    key: "particle.copyEmitter",
    tool: "particle",
    path: RT_PTC,
    edit: { action: "copyEmitter", from: V_COPY_FROM, index: 0, name: "EMCP_W5_Copy" },
    inverse: { action: "removeEmitter", emitter: "EMCP_W5_Copy" },
  },
  {
    key: "particle.renameEmitter",
    tool: "particle",
    path: RT_PTC,
    edit: { action: "renameEmitter", emitter: "Fireflies_LOD1", name: "EMCP_W5_Ren" },
    inverse: { action: "renameEmitter", emitter: "EMCP_W5_Ren", name: "Fireflies_LOD1" },
  },
  {
    key: "particle.moveEmitter",
    tool: "particle",
    path: RT_PTC,
    edit: { action: "moveEmitter", emitter: "Fireflies_LOD1", at: 0 },
    inverse: { action: "moveEmitter", emitter: "Fireflies_LOD1", at: 1 },
  },
];

/** Actions w5-03 sends only for their refusal (gated or project-only), with the code expected. */
export const REFUSALS: ReadonlyArray<{ tool: OfflineTool; params: Raw; codes: readonly string[] }> =
  [
    {
      tool: "audio",
      params: {
        action: "setSimValue",
        path: RT_SIG,
        node: "countdownValue",
        value: 5,
        confirm: true,
      },
      codes: ["READ_ONLY_SOURCE"],
    },
    ...AUDIO_GRAPH_ACTIONS.map((a) => ({
      tool: "audio" as const,
      params: { action: a, path: RT_ACP, args: {}, confirm: true },
      codes: ["UNPROVEN"],
    })),
    {
      tool: "navmesh",
      params: {
        action: "overrideConfig",
        path: VANILLA_NAV_CONF,
        overrides: [NAV_OVERRIDE_REF],
      },
      codes: ["GATED"],
    },
    {
      tool: "audio",
      params: {
        action: "set",
        path: V_RALLY,
        node: RALLY_BANK,
        key: "Volume",
        value: 2,
        confirm: true,
      },
      codes: ["NOT_IN_PROJECT"],
    },
  ];

// ── Steps ────────────────────────────────────────────────────────────────────

/** The offline reads of w5-02 (every read action of the three tools, on fixtures and vanilla paths). */
export function offlineReads(): OfflineCall[] {
  return [
    oc("audio", "inspect", { path: FX_ACP }),
    oc("audio", "inspect", { path: V_RALLY }),
    oc("audio", "events", { path: FX_ACP }),
    oc("audio", "events", { path: SOUND_PREFAB_ACP }),
    oc("audio", "nodes", { path: FX_ACP }),
    oc("audio", "node", { path: FX_ACP, node: RALLY_BANK }),
    oc("audio", "graph", { path: FX_ACP }),
    oc("audio", "samples", { path: FX_ACP, bank: RALLY_BANK }),
    oc("audio", "refs", { path: FX_ACP }),
    oc("audio", "variables", { path: FX_VARS }),
    oc("audio", "variables", { path: "Sounds/_SharedData/Variables/GlobalVariables.conf" }),
    oc("audio", "mixer", { path: FX_AFM }),
    oc("audio", "signal", { path: FX_SIG }),
    oc("audio", "validate", { path: FX_ACP }),
    oc("audio", "catalog", { kind: "acp", limit: 5 }),
    oc("particle", "inspect", { path: FX_PTC }),
    oc("particle", "inspect", { path: V_FX }),
    oc("particle", "emitters", { path: FX_PTC }),
    oc("particle", "emitter", { path: FX_PTC, emitter: "Fireflies" }),
    oc("particle", "curves", { path: FX_PTC, emitter: "Fireflies" }),
    oc("particle", "refs", { path: FX_PTC }),
    oc("particle", "validate", { path: FX_PTC }),
    oc("particle", "diff", { path: FX_PTC, against: V_COPY_FROM }),
    oc("particle", "catalog", { limit: 5 }),
    oc("navmesh", "status", { path: VANILLA_NAV_CONF }),
    oc("navmesh", "status", { path: VANILLA_AIWORLD_ET }),
    oc("navmesh", "header", { path: VANILLA_NMN }),
    oc("navmesh", "tiles", { path: VANILLA_NMN, limit: 5 }),
    oc("navmesh", "config", { path: VANILLA_NAV_CONF }),
    oc("navmesh", "projects", {}),
  ];
}

export function buildSteps(): StepDef[] {
  return [
    // ── W5.0 setup ──
    {
      id: GATE_STEP,
      block: "W5.0",
      title:
        "the test-bed gate: EMCP_WB_Info names EMCP2_sandbox, build stamp, plant, sandbox snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected: `Info projectFound with projectName ${SANDBOX_NAME}; Ping buildStamp equals the bundle digest; every planted file is on disk`,
      kill_criterion:
        "not the test bed: ABORTED, nothing else runs; a stamp mismatch or a missing plant: STOPPED",
      side_effects: [`<sitting>/${BATTERY_SNAPSHOT_FILE} written (first run of the sitting only)`],
      rollback: "none (reads; the snapshot is a file in the sitting folder)",
      probes: [],
      writes: [],
      plan: () => [
        { kind: "net-call", target: "EMCP_WB_Info" } as PlanAction,
        { kind: "net-call", target: "EMCP_WB_Ping" } as PlanAction,
      ],
      run: async (ctx) => {
        const info = await ctx.deps.info();
        const projectFound = field(info, "projectFound");
        const projectName = field(info, "projectName");
        const found =
          projectFound === true ||
          projectFound === 1 ||
          projectFound === "1" ||
          projectFound === "true";
        const evidence: Raw = { info, projectFound, projectName };
        // The test-bed check lives here, in the battery, never in a shipped handler (DEC-058).
        if (!found || projectName !== SANDBOX_NAME)
          throw new StopBattery(
            "aborted",
            `EMCP_WB_Info does not say projectFound with projectName ${SANDBOX_NAME}: not the live lane's test bed`,
            evidence,
          );
        const ping = await ctx.deps.ping();
        const stamp = S(field(ping, "buildStamp"));
        const digest = ctx.deps.bundleDigest();
        evidence.stamp = stamp || null;
        evidence.digest = digest;
        if (!stamp || !digest || stamp !== digest)
          throw new StopBattery(
            "stopped",
            "the build stamp does not match the bundle digest",
            evidence,
          );
        const missing = PLANTED.filter((rel) => !ctx.deps.exists(abs(ctx.opts.sandboxDir, rel)));
        if (missing.length)
          throw new StopBattery(
            "stopped",
            `planted file(s) absent: ${missing.join(", ")}: run \`w5.live.ts plant\` first`,
            evidence,
          );
        if (ensureBatterySnapshot(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps, "gate"))
          evidence.snapshotTaken = true;
        evidence.snapshot = BATTERY_SNAPSHOT_FILE;
        return { status: "PASS", detail: `test bed ${SANDBOX_NAME}, stamp ${stamp}`, evidence };
      },
    },
    {
      id: "w5-01-handlers",
      block: "W5.0",
      title:
        "compile gate: each new handler answers (Audio, Particle, Navmesh); the Particle handler's GetParam lines compiled (P-W5-08 compile half)",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "wb_audio masters answers ok (five masters); wb_particle stats of a missing entity and wb_navmesh status answer a domain refusal (NO_WORLD, ENTITY_NOT_FOUND, NO_AI_WORLD, ...) or ok, never an unknown handler",
      kill_criterion:
        "the Particle handler does not answer (UNREACHABLE, HANDLER_ERROR, an unknown handler): P-W5-08 KILLED (a compile error, likely the out void GetParam); another handler dead: FAIL",
      side_effects: [],
      rollback: "none",
      probes: ["P-W5-08"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_audio", "masters"),
        tc("wb_particle", "stats", { entity: "name:EMCP_W5_NoSuchEntity" }),
        tc("wb_navmesh", "status", { limit: 1 }),
      ],
      run: async (ctx) => {
        const a = await ctx.tool("wb_audio", { action: "masters" });
        const p = await ctx.tool("wb_particle", {
          action: "stats",
          entity: "name:EMCP_W5_NoSuchEntity",
        });
        const n = await ctx.tool("wb_navmesh", { action: "status", limit: 1 });
        const answered = (r: ToolResponse) => r.ok || DOMAIN_CODES.has(S(r.code));
        const observed = {
          audio: a.ok ? "ok" : S(a.code),
          particle: p.ok ? "ok" : S(p.code),
          navmesh: n.ok ? "ok" : S(n.code),
        };
        const fails: string[] = [];
        if (!answered(a)) fails.push(`EMCP_WB_Audio does not answer: ${why(a)}`);
        if (!answered(n)) fails.push(`EMCP_WB_Navmesh does not answer: ${why(n)}`);
        const p8 = answered(p)
          ? partial(
              "P-W5-08",
              observed,
              "EMCP_WB_Particle compiled with the out void GetParam lines; the value half is w5-22",
            )
          : killed(
              "P-W5-08",
              observed,
              `EMCP_WB_Particle does not answer (${S(p.code)} ${S(p.message)}): read the compile error in script.log; param is removed`,
            );
        return {
          ...verdictOf(fails, [p8], "the three handlers answer"),
          evidence: { masters: brief(a), stats: brief(p), status: brief(n) },
          probes: [p8],
        };
      },
    },
    {
      id: "w5-02-offline-reads",
      block: "W5.0",
      title:
        "offline (no Workbench call): every read action of audio, particle and navmesh on the fixtures and on vanilla pak paths; navmesh header over every vanilla .nmn (P-W5-17)",
      risk: "read-only",
      timeout_ms: 300_000,
      expected:
        "each read answers ok on the fixture and on the pak path (vanilla readable); the 53 .nmn headers read EV 02 00, version 3 and a tile size (24, 51 or 204); tiles of GM_Arland.nmn answer a count",
      kill_criterion:
        "P-W5-17: headers do not read consistently (header reports raw fields); a read that throws or refuses: FAIL with the item",
      side_effects: [],
      rollback: "none (reads from the project and the game paks in this process)",
      probes: ["P-W5-17"],
      writes: [],
      plan: () => [],
      offlineCalls: () => [
        ...offlineReads(),
        oc("navmesh", "header", { path: "<each vanilla .nmn>" }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const items: Raw = {};
        for (const c of offlineReads()) {
          const r = await ctx.offline(c.tool, c.params);
          const key = `${c.tool}.${c.action} ${S(c.params.path) || S(c.params.kind) || ""}`.trim();
          items[key] = r.ok ? "ok" : S(r.code);
          evidence[key] = brief(r, 1500);
          if (!r.ok) fails.push(`${key}: ${why(r)}`);
        }
        const fs = ctx.deps.vanilla();
        let p17: ProbeResult;
        if (!fs) {
          p17 = partial("P-W5-17", {}, "the game paks could not be opened (ENFUSION_GAME_PATH)");
        } else {
          const heads: Array<{ path: string; r: ToolResponse }> = [];
          for (const path of vanillaNmn(fs))
            heads.push({ path, r: await ctx.offline("navmesh", { action: "header", path }) });
          p17 = judgeNmnHeaders(heads);
        }
        evidence.perItem = items;
        return {
          ...verdictOf(fails, [p17], `${Object.keys(items).length} reads answered`),
          evidence,
          probes: [p17],
        };
      },
    },
    {
      id: "w5-03-offline-writes",
      block: "W5.0",
      title:
        "offline (no Workbench call): every write action on the round-trip copies (dry run, confirm, inverse, byte compare); the gated actions for their refusal; navmesh overrideConfig as a dry run",
      risk: "mutating",
      timeout_ms: 180_000,
      expected:
        "each dry run leaves the bytes; each confirm changes them; each inverse returns the copy byte-identical; .sig writes refuse READ_ONLY_SOURCE, the five graph actions UNPROVEN, overrideConfig with overrides GATED, a write to a vanilla path NOT_IN_PROJECT; overrideConfig's dry run plans the copy and writes nothing",
      kill_criterion:
        "no probe: an item that does not round-trip, a dry run that writes or a gated action that writes: FAIL with the item (verdicts per item)",
      side_effects: [`${RT_DIR}/ copies edited and restored`],
      rollback: "each inverse; `rollback` removes _throwaway/W5/",
      probes: [],
      writes: [RT_ACP, RT_AFM, RT_VARS, RT_PTC],
      plan: () => [],
      offlineCalls: () => [
        ...ROUND_TRIPS.flatMap((t) => [
          oc(t.tool, S(t.edit.action), { ...t.edit, path: t.path }),
          oc(t.tool, S(t.edit.action), { ...t.edit, path: t.path, confirm: true }),
          oc(t.tool, S(t.inverse.action), { ...t.inverse, path: t.path, confirm: true }),
        ]),
        ...REFUSALS.map((r) => oc(r.tool, S(r.params.action), r.params)),
        oc("navmesh", "overrideConfig", {
          path: VANILLA_NAV_CONF,
          navmeshFile: NAV_OVERRIDE_REF,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const verdicts: Raw = {};
        for (const t of ROUND_TRIPS) {
          const start = bytesOf(ctx, t.path);
          const dry = await ctx.offline(t.tool, { ...t.edit, path: t.path });
          const afterDry = bytesOf(ctx, t.path);
          const conf = await ctx.offline(t.tool, { ...t.edit, path: t.path, confirm: true });
          const edited = bytesOf(ctx, t.path);
          const inv = await ctx.offline(t.tool, { ...t.inverse, path: t.path, confirm: true });
          const end = bytesOf(ctx, t.path);
          const item: string[] = [];
          if (!dry.ok) item.push(`dry run ${why(dry)}`);
          if (!same(start, afterDry)) item.push("the dry run wrote");
          if (!conf.ok) item.push(`confirm ${why(conf)}`);
          else if (same(start, edited)) item.push("the confirm changed nothing");
          if (!inv.ok) item.push(`inverse ${why(inv)}`);
          if (!same(start, end))
            item.push(`not byte-identical: ${JSON.stringify(diffOf(start, end))}`);
          // A failed inverse leaves the copy edited: the planted bytes are put back so the next
          // round trip starts from them (the file lies under _throwaway/W5/rt/, never registered).
          if (!same(start, end) && start)
            ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, t.path), start);
          verdicts[t.key] = item.length ? `FAIL: ${item.join(", ")}` : "PASS";
          evidence[t.key] = {
            dry: brief(dry, 1500),
            confirm: brief(conf, 1500),
            inverse: brief(inv, 800),
            editDiff: diffOf(start, edited),
          };
          if (item.length) fails.push(`${t.key}: ${item.join(", ")}`);
        }
        for (const r of REFUSALS) {
          const p = S(r.params.path);
          const before = p.startsWith(`${W5_ROOT}/`) ? bytesOf(ctx, p) : null;
          const a = await ctx.offline(r.tool, r.params);
          const after = p.startsWith(`${W5_ROOT}/`) ? bytesOf(ctx, p) : null;
          const key = `${r.tool}.${S(r.params.action)} (refusal)`;
          const item: string[] = [];
          if (a.ok || !r.codes.includes(S(a.code)))
            item.push(`answered ${a.ok ? "ok" : S(a.code)}, expected ${r.codes.join(" or ")}`);
          if (before && !same(before, after)) item.push("the refused call wrote");
          verdicts[key] = item.length ? `FAIL: ${item.join(", ")}` : `PASS (${S(a.code)})`;
          evidence[key] = brief(a, 800);
          if (item.length) fails.push(`${key}: ${item.join(", ")}`);
        }
        const projectCopy = abs(ctx.opts.sandboxDir, VANILLA_NAV_CONF);
        const existedBefore = ctx.deps.exists(projectCopy);
        const ov = await ctx.offline("navmesh", {
          action: "overrideConfig",
          path: VANILLA_NAV_CONF,
          navmeshFile: NAV_OVERRIDE_REF,
        });
        evidence["navmesh.overrideConfig (dry run)"] = brief(ov, 1500);
        const ovItem: string[] = [];
        if (!ov.ok) ovItem.push(why(ov));
        else if (rb(ov).dryRun !== true) ovItem.push("not answered as a dry run");
        if (!existedBefore && ctx.deps.exists(projectCopy))
          ovItem.push("the dry run wrote the copy");
        verdicts["navmesh.overrideConfig (dry run)"] = ovItem.length
          ? `FAIL: ${ovItem.join(", ")}`
          : "PASS";
        if (ovItem.length) fails.push(`navmesh.overrideConfig: ${ovItem.join(", ")}`);
        evidence.perItem = verdicts;
        return {
          ...verdictOf(
            fails,
            [],
            `${ROUND_TRIPS.length} round trips byte-identical, ${REFUSALS.length} refusals`,
          ),
          evidence,
        };
      },
    },
    {
      id: "w5-04-register",
      block: "W5.0",
      title: "wb_resources register the five live fixtures (dry run, then confirm), resolve each",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "each dry run writes no .meta; each confirm answers registered with a {GUID}path and a .meta beside the resource it names; resolve answers hasMeta",
      kill_criterion: `a fixture is not registered: FAIL, and the steps that need it STOP; ${WINDOW_KILL}`,
      side_effects: LIVE_FIXTURES.map((r) => metaRelOf(r)),
      rollback:
        "`w5.live.ts rollback` removes _throwaway/W5/ (with the .meta files) after Workbench is closed",
      probes: [],
      writes: LIVE_FIXTURES.map((r) => metaRelOf(r)),
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () =>
        LIVE_FIXTURES.flatMap((rel) => [
          tc("wb_resources", "register", { path: rel }, { note: "dry run" }),
          tc("wb_resources", "register", { path: rel, confirm: true }),
          tc("wb_resources", "resolve", { path: rel }),
        ]),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureFixturesOnDisk(ctx);
        for (const rel of LIVE_FIXTURES) {
          const planned = metaRelOf(rel);
          const metaBefore = bytesOf(ctx, planned);
          const dry = await ctx.tool("wb_resources", { action: "register", path: rel });
          const metaAfterDry = bytesOf(ctx, planned);
          const conf = await ctx.tool("wb_resources", {
            action: "register",
            path: rel,
            confirm: true,
          });
          const res = await ctx.tool("wb_resources", { action: "resolve", path: rel });
          const name = S(rb(conf).resourceName) || S(rb(res).resourceName);
          // The .meta the engine wrote: beside the resource the register answered (fix-up 1).
          const metaRel = metaRelOf(rel, name);
          evidence[rel] = {
            metaBefore: !!metaBefore,
            metaRel,
            metaPlanned: planned,
            dry: brief(dry),
            confirm: brief(conf),
            resolve: brief(res),
          };
          if (!metaBefore && metaAfterDry) fails.push(`${rel}: the dry run wrote ${planned}`);
          if (!conf.ok) fails.push(`${rel}: ${why(conf)}`);
          else if (!bytesOf(ctx, metaRel))
            fails.push(`${rel}: no ${metaRel} on disk after register`);
          if (!res.ok) fails.push(`${rel}: resolve ${why(res)}`);
          if (!guidOf(name)) fails.push(`${rel}: no {GUID} in '${name}'`);
          else ctx.state.set(rel, name);
        }
        return { ...verdictOf(fails, [], `${LIVE_FIXTURES.length} fixtures registered`), evidence };
      },
    },
    {
      id: "w5-05-world",
      block: "W5.0",
      title:
        "the tiny throwaway world (OD-4): wb_world new (dry run, then confirm), register, open; the vanilla SCR_AIWorld prefab and two props placed; saved",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 120_000,
      expected:
        "the dry run writes no world; new writes the .ent under _throwaway/W5/worlds/; it opens; three entities placed (EMCP_W5_AIWorld from SCR_AIWorld.et, two GlassBeer props); the save answers ok",
      kill_criterion: `the world does not open or a placement fails: FAIL (the runtime steps need it); ${WINDOW_KILL}`,
      side_effects: [`${WORLD} and its layers written and saved`],
      rollback: "`rollback` removes _throwaway/W5/ (the world is never anywhere else)",
      probes: [],
      writes: [WORLDS_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => worldPlan(),
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureFixtures(ctx);
        const ok = await ensureWorld(ctx, evidence, fails);
        if (!ok && !fails.length) fails.push("the W5 world is not open");
        return { ...verdictOf(fails, [], `${WORLD} open with its AIWorld`), evidence };
      },
    },

    // ── W5.1 audio runtime (P-W5-06 KILLED in run 1: the AudioSystem calls run in play mode) ──
    {
      id: "w5-10-audio-reads",
      block: "W5.1",
      title:
        "AudioSystem reads in play mode (fix-up 1: P-W5-06 KILLED in run 1, repointed to P-W5-10): masters refused WRONG_MODE in edit mode; in wb_world play: masters, variable (vanilla GlobalVariables GInterior, the fixture's VONAmplitude), outputStates, audible, isPlaying of handle 0; back in edit mode; soundMap at two positions",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 180_000,
      expected:
        "edit mode: masters answers WRONG_MODE (the play-mode guard); in play: masters answers five masters (SFX, Music, VoiceChat, Dialog, UI), variable id >= 0 for GInterior, outputStates answers a count, audible answers an audibility; the fixture variable and isPlaying of handle 0 are recorded, not judged (unproven in play mode); stop returns to edit mode; soundMap answers values or NO_SOUND_WORLD",
      kill_criterion:
        "P-W5-10 (audio half): the handler NET queue does not answer during play, or stop does not return to edit mode (w5-11 and w5-12 are SKIPPED); a crash (LOST stops the battery)",
      side_effects: ["play mode entered and left; the throwaway world saved before the play"],
      rollback: "wb_world stop in a finally path (a restorer from before the play)",
      probes: ["P-W5-06", "P-W5-10"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_audio", "masters", {}, { note: "edit mode: refused WRONG_MODE (fix-up 1)" }),
        ...playPlan([
          tc("wb_audio", "masters"),
          tc("wb_audio", "variable", { resource: V_GLOBAL_VARS, name: V_GLOBAL_VAR }),
          tc("wb_audio", "variable", {
            resource: "<W5_vars.conf resource name>",
            name: "VONAmplitude",
          }),
          tc("wb_audio", "outputStates"),
          tc("wb_audio", "outputStates", { resource: "<W5_mix.afm resource name>", name: "Music" }),
          tc("wb_audio", "audible", {
            resource: V_PLAY_ACP,
            eventName: V_PLAY_EVENT,
            position: "0 1 0",
          }),
          tc("wb_audio", "isPlaying", { handle: 0 }),
        ]),
        tc("wb_audio", "soundMap", { position: "0 0 0" }),
        tc("wb_audio", "soundMap", { position: "50 0 50" }),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const edit = await ctx.tool("wb_audio", { action: "masters" });
        const round = await inPlay(ctx, async () => ({
          masters: await ctx.tool("wb_audio", { action: "masters" }),
          variableVanilla: await ctx.tool("wb_audio", {
            action: "variable",
            resource: V_GLOBAL_VARS,
            name: V_GLOBAL_VAR,
          }),
          variableFixture: await ctx.tool("wb_audio", {
            action: "variable",
            resource: fx[FX_VARS]!,
            name: "VONAmplitude",
          }),
          outputStates: await ctx.tool("wb_audio", { action: "outputStates" }),
          outputStatesAfm: await ctx.tool("wb_audio", {
            action: "outputStates",
            resource: fx[FX_AFM]!,
            name: "Music",
          }),
          audible: await ctx.tool("wb_audio", {
            action: "audible",
            resource: V_PLAY_ACP,
            eventName: V_PLAY_EVENT,
            position: "0 1 0",
          }),
          isPlaying: await ctx.tool("wb_audio", { action: "isPlaying", handle: 0 }),
        }));
        const s1 = await ctx.tool("wb_audio", { action: "soundMap", position: "0 0 0" });
        const s2 = await ctx.tool("wb_audio", { action: "soundMap", position: "50 0 50" });
        const r = round.result;
        Object.assign(evidence, {
          editModeMasters: brief(edit),
          saveBeforePlay: round.save,
          play: brief(round.play),
          stateDuringPlay: brief(round.during),
          masters: brief(r?.masters),
          variableVanilla: brief(r?.variableVanilla),
          variableFixture: brief(r?.variableFixture),
          outputStates: brief(r?.outputStates),
          outputStatesAfm: brief(r?.outputStatesAfm),
          audible: brief(r?.audible),
          isPlaying: brief(r?.isPlaying),
          stop: brief(round.stop),
          stateAfter: brief(round.after),
          soundMap: [brief(s1), brief(s2)],
        });
        const p6 = killed(
          "P-W5-06",
          { editModeMasters: edit.ok ? "ok" : S(edit.code) },
          P6_CARRIED,
        );
        if (edit.ok)
          fails.push(
            "masters answered in edit mode: the play-mode guard is missing (a stale handler bundle?)",
          );
        else if (edit.code !== "WRONG_MODE")
          fails.push(`masters in edit mode: ${why(edit)}, not WRONG_MODE`);
        playFails(round, fails);
        const p10 = judgePlayAudio(
          round,
          r ? [r.masters, r.variableVanilla, r.outputStates, r.audible] : [],
        );
        const masters = (rb(r?.masters).masters ?? {}) as Raw;
        const id = N(rb(r?.variableVanilla).id);
        if (r && p10.result !== "KILLED") {
          if (!r.masters.ok) fails.push(`masters: ${why(r.masters)}`);
          else if (Object.keys(masters).length !== 5)
            fails.push(`masters answered ${Object.keys(masters).length} masters, not 5`);
          if (!r.variableVanilla.ok) fails.push(`variable GInterior: ${why(r.variableVanilla)}`);
          else if (id === null || id < 0) fails.push(`variable GInterior id ${S(id)}`);
          for (const [k, x] of [
            ["outputStates", r.outputStates],
            ["outputStates (.afm)", r.outputStatesAfm],
            ["audible", r.audible],
          ] as const)
            if (!x.ok) fails.push(`${k}: ${why(x)}`);
        }
        // Recorded, not judged: whether the AudioSystem knows a variables .conf no running sound
        // references, and what handle 0 is in play mode, are unproven (fix-up 1).
        evidence.recordedOnly = {
          variableFixture: r ? (r.variableFixture.ok ? rb(r.variableFixture) : S(r.variableFixture.code)) : null,
          isPlayingHandle0: r ? (r.isPlaying.ok ? rb(r.isPlaying).playing : S(r.isPlaying.code)) : null,
        };
        for (const [k, x] of [
          ["soundMap 0", s1],
          ["soundMap 50", s2],
        ] as const)
          if (!x.ok && x.code !== "NO_SOUND_WORLD") fails.push(`${k}: ${why(x)}`);
        return {
          ...verdictOf(
            fails,
            [p10],
            `in play: masters ${Object.keys(masters).join(", ")}; GInterior id ${S(id)}`,
          ),
          evidence,
          probes: [p6, p10],
        };
      },
    },
    {
      id: "w5-11-audio-play",
      block: "W5.1",
      title:
        "AudioSystem play in play mode (fix-up 1): play a vanilla weapon event, isPlaying, stop; play it again and stop with a fade; playSound a vanilla sample, stop; the fixture's event played and recorded (its samples are RallyDLC's); fix-up 2: the vanilla event is played at the camera (the listener), after an audible read there",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 180_000,
      expected:
        "in play: audible at the camera is not -1 (recorded); each vanilla play answers a handle != 0 and playing true; isPlaying true; stop answers playing false; after the fade and a 1 s wait isPlaying is false; playSound answers a handle; the fixture event's answer is recorded; back in edit mode",
      kill_criterion:
        "a play that answers no handle, or a sound still playing after its stop: FAIL; P-W5-10 KILLED in w5-10 skips this step",
      side_effects: ["sounds play in play mode and are stopped; play mode entered and left"],
      rollback:
        "stop of every handle played (also after a cut, through the restorers); wb_world stop in a finally path",
      probes: [],
      dependsOn: ["P-W5-10"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        ...playPlan([
          tc("wb_audio", "audible", { resource: V_PLAY_ACP, eventName: V_PLAY_EVENT }),
          tc("wb_audio", "play", { resource: V_PLAY_ACP, eventName: V_PLAY_EVENT }),
          tc("wb_audio", "isPlaying", { handle: "<handle>" }),
          tc("wb_audio", "stop", { handle: "<handle>" }),
          tc("wb_audio", "play", { resource: V_PLAY_ACP, eventName: V_PLAY_EVENT }),
          tc("wb_audio", "stop", { handle: "<handle>", fadeTime: "0.5" }),
          tc("wb_audio", "isPlaying", { handle: "<handle>" }),
          tc("wb_audio", "play", { resource: "<W5_snd.acp resource name>", eventName: RALLY_EVENT }),
          tc("wb_audio", "stop", { handle: "<handle>" }),
          tc("wb_audio", "playSound", { resource: V_SAMPLE }),
          tc("wb_audio", "stop", { handle: "<handle>" }),
        ]),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const owe = (h: number | null, label: string) => {
          if (h !== null && h > 0)
            ctx.debt.restorers.push({
              label: `stop ${label}`,
              fn: () => ctx.deps.tool("wb_audio", { action: "stop", handle: h }),
            });
        };
        const stopOwed = async (h: number | null, extra: Raw = {}) => {
          if (h === null || h <= 0) return null;
          const st = await ctx.tool(
            "wb_audio",
            { action: "stop", handle: h, ...extra },
            { restore: true },
          );
          if (st.ok) ctx.debt.restorers.pop();
          return st;
        };
        // Fix-up 2: run 2 played SOUND_THROWN at 0 1 0 and got an invalid handle; w5-10 of the same
        // run read IsAudible -1 for that event and position with the listener (the camera) 399.982 m
        // away, while the fixture event, played at the camera, answered a handle. So the vanilla
        // event plays at the camera (position left out) and the audibility there is recorded first.
        const playVanilla = () =>
          ctx.tool("wb_audio", {
            action: "play",
            resource: V_PLAY_ACP,
            eventName: V_PLAY_EVENT,
          });
        const round = await inPlay(ctx, async () => {
          const aud = await ctx.tool("wb_audio", {
            action: "audible",
            resource: V_PLAY_ACP,
            eventName: V_PLAY_EVENT,
          });
          const p1 = await playVanilla();
          const h1 = N(rb(p1).handle);
          owe(h1, "vanilla event");
          const i1 = h1 !== null ? await ctx.tool("wb_audio", { action: "isPlaying", handle: h1 }) : null;
          const st1 = await stopOwed(h1);
          const p2 = await playVanilla();
          const h2 = N(rb(p2).handle);
          owe(h2, "vanilla event (fade)");
          const st2 = await stopOwed(h2, { fadeTime: "0.5" });
          await ctx.sleep(1_000);
          const i2 = h2 !== null ? await ctx.tool("wb_audio", { action: "isPlaying", handle: h2 }) : null;
          const pf = await ctx.tool("wb_audio", {
            action: "play",
            resource: fx[FX_ACP]!,
            eventName: RALLY_EVENT,
          });
          const hf = N(rb(pf).handle);
          owe(hf, "fixture event");
          const stf = await stopOwed(hf);
          const p3 = await ctx.tool("wb_audio", { action: "playSound", resource: V_SAMPLE });
          const h3 = N(rb(p3).handle);
          owe(h3, "sample");
          const st3 = await stopOwed(h3);
          return { aud, p1, h1, i1, st1, p2, h2, st2, i2, pf, stf, p3, h3, st3 };
        });
        const r = round.result;
        Object.assign(evidence, {
          saveBeforePlay: round.save,
          play: brief(round.play),
          stateDuringPlay: brief(round.during),
          audibleAtCamera: brief(r?.aud),
          playVanilla: brief(r?.p1),
          isPlaying: brief(r?.i1),
          stopVanilla: brief(r?.st1),
          playVanillaFade: brief(r?.p2),
          stopFade: brief(r?.st2),
          isPlayingAfterFade: brief(r?.i2),
          playFixture: brief(r?.pf),
          stopFixture: brief(r?.stf),
          playSound: brief(r?.p3),
          stopSound: brief(r?.st3),
          stop: brief(round.stop),
          stateAfter: brief(round.after),
          fixtureNote:
            "W5_snd.acp is planted from RallyDLC's Music_Rally.acp; the sandbox depends only on ArmaReforger, so its samples do not resolve (run 1 console.log: Wrong GUID/name for each .snd): its play is recorded, not judged",
        });
        playFails(round, fails);
        if (r) {
          if (!r.p1.ok || !r.h1) fails.push(`play: ${r.p1.ok ? `handle ${S(r.h1)}` : why(r.p1)}`);
          else if (rb(r.p1).playing !== true)
            fails.push(`play answered handle ${S(r.h1)} not playing in play mode`);
          if (r.st1 && !r.st1.ok) fails.push(`stop: ${why(r.st1)}`);
          else if (r.st1 && rb(r.st1).playing === true) fails.push("still playing after stop");
          if (!r.p2.ok || !r.h2) fails.push(`play (fade): ${r.p2.ok ? `handle ${S(r.h2)}` : why(r.p2)}`);
          if (r.st2 && !r.st2.ok) fails.push(`stop with a fade: ${why(r.st2)}`);
          if (r.i2?.ok && rb(r.i2).playing === true)
            fails.push("the vanilla event still plays 1 s after a 0.5 s fade");
          if (!r.p3.ok || !r.h3) fails.push(`playSound: ${r.p3.ok ? `handle ${S(r.h3)}` : why(r.p3)}`);
          if (r.st3 && !r.st3.ok) fails.push(`stop of the sample: ${why(r.st3)}`);
        }
        return {
          ...verdictOf(fails, [], `handles ${S(r?.h1)}, ${S(r?.h2)}, ${S(r?.h3)} in play mode`),
          evidence,
        };
      },
    },
    {
      id: "w5-12-audio-state",
      block: "W5.1",
      title:
        "AudioSystem state writes in play mode (fix-up 1), each set back: setVariable and back, resetVariables; setMaster SFX and back; pause SFX and resume",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 180_000,
      expected:
        "in play: setVariable answers before/after and variable reads the new value; the set back reads the value before; resetVariables answers reset; setMaster reads back and is set back; pause answers paused true, resume paused false; masters at the end equal masters at the start; back in edit mode",
      kill_criterion: `a write that does not read back or is not restored: FAIL; P-W5-10 KILLED in w5-10 skips this step; ${WINDOW_KILL}`,
      side_effects: ["runtime audio state changed and restored in play mode; nothing saved"],
      rollback:
        "setVariable/setMaster back to the value before, pause resume (restorers after a cut); wb_world stop in a finally path",
      probes: [],
      dependsOn: ["P-W5-10"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        ...playPlan([
          tc("wb_audio", "masters"),
          tc("wb_audio", "variable", { resource: V_GLOBAL_VARS, name: V_GLOBAL_VAR }),
          tc("wb_audio", "setVariable", {
            resource: V_GLOBAL_VARS,
            name: V_GLOBAL_VAR,
            value: "<other>",
          }),
          tc("wb_audio", "variable", { resource: V_GLOBAL_VARS, name: V_GLOBAL_VAR }),
          tc("wb_audio", "setVariable", {
            resource: V_GLOBAL_VARS,
            name: V_GLOBAL_VAR,
            value: "<before>",
          }),
          tc("wb_audio", "resetVariables"),
          tc("wb_audio", "setMaster", { master: "SFX", value: "<other>" }),
          tc("wb_audio", "setMaster", { master: "SFX", value: "<before>" }),
          tc("wb_audio", "pause", { masters: ["SFX"] }),
          tc("wb_audio", "pause", { masters: ["SFX"], resume: true }),
          tc("wb_audio", "masters"),
        ]),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const round = await inPlay(ctx, async () => {
          const m0 = await ctx.tool("wb_audio", { action: "masters" });
          const v0 = await ctx.tool("wb_audio", {
            action: "variable",
            resource: V_GLOBAL_VARS,
            name: V_GLOBAL_VAR,
          });
          const before = N(rb(v0).value) ?? 0;
          const other = before === 0.5 ? 0.25 : 0.5;
          ctx.debt.restorers.push({
            label: "setVariable back",
            fn: () =>
              ctx.deps.tool("wb_audio", {
                action: "setVariable",
                resource: V_GLOBAL_VARS,
                name: V_GLOBAL_VAR,
                value: String(before),
              }),
          });
          const sv = await ctx.tool("wb_audio", {
            action: "setVariable",
            resource: V_GLOBAL_VARS,
            name: V_GLOBAL_VAR,
            value: String(other),
          });
          const v1 = await ctx.tool("wb_audio", {
            action: "variable",
            resource: V_GLOBAL_VARS,
            name: V_GLOBAL_VAR,
          });
          const back = await ctx.tool(
            "wb_audio",
            {
              action: "setVariable",
              resource: V_GLOBAL_VARS,
              name: V_GLOBAL_VAR,
              value: String(before),
            },
            { restore: true },
          );
          if (back.ok) ctx.debt.restorers.pop();
          const reset = await ctx.tool("wb_audio", { action: "resetVariables" });
          const sfx = N(field(rb(m0).masters, "SFX")) ?? 1;
          const sfxOther = sfx >= 0.5 ? sfx / 2 : Math.min(1, sfx + 0.25);
          ctx.debt.restorers.push({
            label: "setMaster SFX back",
            fn: () =>
              ctx.deps.tool("wb_audio", { action: "setMaster", master: "SFX", value: String(sfx) }),
          });
          const sm = await ctx.tool("wb_audio", {
            action: "setMaster",
            master: "SFX",
            value: String(sfxOther),
          });
          const smBack = await ctx.tool(
            "wb_audio",
            { action: "setMaster", master: "SFX", value: String(sfx) },
            { restore: true },
          );
          if (smBack.ok) ctx.debt.restorers.pop();
          ctx.debt.restorers.push({
            label: "resume SFX",
            fn: () =>
              ctx.deps.tool("wb_audio", { action: "pause", masters: ["SFX"], resume: true }),
          });
          const pa = await ctx.tool("wb_audio", { action: "pause", masters: ["SFX"] });
          const re = await ctx.tool(
            "wb_audio",
            { action: "pause", masters: ["SFX"], resume: true },
            { restore: true },
          );
          if (re.ok) ctx.debt.restorers.pop();
          const m1 = await ctx.tool("wb_audio", { action: "masters" });
          return { m0, v0, other, sv, v1, back, reset, sfxOther, sm, smBack, pa, re, m1 };
        });
        const r = round.result;
        Object.assign(evidence, {
          saveBeforePlay: round.save,
          play: brief(round.play),
          stateDuringPlay: brief(round.during),
          mastersBefore: brief(r?.m0),
          variableBefore: brief(r?.v0),
          setVariable: brief(r?.sv),
          variableAfter: brief(r?.v1),
          setVariableBack: brief(r?.back),
          resetVariables: brief(r?.reset),
          setMaster: brief(r?.sm),
          setMasterBack: brief(r?.smBack),
          pause: brief(r?.pa),
          resume: brief(r?.re),
          mastersAfter: brief(r?.m1),
          stop: brief(round.stop),
          stateAfter: brief(round.after),
        });
        playFails(round, fails);
        if (r) {
          if (!r.sv.ok) fails.push(`setVariable: ${why(r.sv)}`);
          else if (!near(rb(r.v1).value, r.other))
            fails.push(`variable reads ${S(rb(r.v1).value)}, not ${r.other}`);
          if (!r.back.ok) fails.push(`setVariable back: ${why(r.back)}`);
          if (!r.reset.ok) fails.push(`resetVariables: ${why(r.reset)}`);
          if (!r.sm.ok) fails.push(`setMaster: ${why(r.sm)}`);
          else if (!near(rb(r.sm).after, r.sfxOther))
            fails.push(`setMaster after ${S(rb(r.sm).after)}`);
          if (!r.smBack.ok) fails.push(`setMaster back: ${why(r.smBack)}`);
          if (!r.pa.ok || rb(r.pa).paused !== true)
            fails.push(`pause: ${r.pa.ok ? "paused not true" : why(r.pa)}`);
          if (!r.re.ok || rb(r.re).paused !== false)
            fails.push(`resume: ${r.re.ok ? "paused not false" : why(r.re)}`);
          if (JSON.stringify(rb(r.m0).masters) !== JSON.stringify(rb(r.m1).masters))
            fails.push(
              `masters not restored: ${JSON.stringify(rb(r.m0).masters)} -> ${JSON.stringify(rb(r.m1).masters)}`,
            );
        }
        return { ...verdictOf(fails, [], "variables, masters and pause restored in play mode"), evidence };
      },
    },

    // ── W5.2 particle (P-W5-07, 08, 09) ──
    {
      id: "w5-20-particle-spawn",
      block: "W5.2",
      title:
        "wb_particle spawn of the fixture .ptc in the throwaway world (dry run, then confirm) and stats (P-W5-07)",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "the dry run places nothing (stats ENTITY_NOT_FOUND); the confirm answers the entity; stats: effectPath set, emitters 2 equal to the offline count, emitterNames Fireflies and Fireflies_LOD1, state PLAYING or STOPPED",
      kill_criterion:
        "P-W5-07: GetParticles null (NO_PARTICLES), emitters 0 for the 2-emitter .ptc, or a crash: stats, control, simulate, param, setParam move to play mode (their steps SKIPPED)",
      side_effects: [
        `entity ${FX_NAME} placed in ${WORLD} (in memory; saved by w5-23 after its removal)`,
      ],
      rollback: "w5-23 removes it; a restorer removes it after a cut",
      probes: ["P-W5-07"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_particle", "spawn", {
          effect: "<W5_fx.ptc resource name>",
          name: FX_NAME,
          coords: "0 1 0",
        }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "spawn", {
          effect: "<W5_fx.ptc resource name>",
          name: FX_NAME,
          coords: "0 1 0",
          confirm: true,
        }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
      ],
      offlineCalls: () => [oc("particle", "emitters", { path: FX_PTC })],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const offline = await ctx.offline("particle", { action: "emitters", path: FX_PTC });
        const offCount = (textOfFixture(ctx, FX_PTC).match(/EmitterDef /g) ?? []).length;
        const dry = await ctx.tool("wb_particle", {
          action: "spawn",
          effect: fx[FX_PTC]!,
          name: FX_NAME,
          coords: "0 1 0",
        });
        const afterDry = await ctx.tool("wb_particle", {
          action: "stats",
          entity: `name:${FX_NAME}`,
        });
        const existed = afterDry.ok;
        const sp = existed
          ? null
          : await ctx.tool("wb_particle", {
              action: "spawn",
              effect: fx[FX_PTC]!,
              name: FX_NAME,
              coords: "0 1 0",
              confirm: true,
            });
        if (sp?.ok)
          ctx.debt.restorers.push({
            label: `remove ${FX_NAME}`,
            fn: () =>
              ctx.deps.tool("wb_particle", {
                action: "remove",
                entity: `name:${FX_NAME}`,
                confirm: true,
              }),
          });
        const st = await ctx.tool("wb_particle", { action: "stats", entity: `name:${FX_NAME}` });
        Object.assign(evidence, {
          offlineEmitters: brief(offline, 1500),
          offlineCount: offCount,
          dry: brief(dry),
          statsAfterDry: brief(afterDry),
          spawn: brief(sp),
          stats: brief(st),
        });
        if (!dry.ok || rb(dry).dryRun !== true)
          fails.push(`dry run: ${dry.ok ? "dryRun not true" : why(dry)}`);
        if (existed)
          evidence.note = `${FX_NAME} was already placed (a resumed run): no second spawn`;
        if (sp && !sp.ok) fails.push(`spawn: ${why(sp)}`);
        // The record keeps the spawn: the following steps run on it (they fail on their own).
        if (sp?.ok) ctx.debt.restorers = [];
        const names = strs(rb(st).emitterNames);
        const emitters = N(rb(st).emitters);
        const observed = {
          code: st.ok ? null : S(st.code),
          effectPath: rb(st).effectPath ?? null,
          state: rb(st).state ?? null,
          emitters,
          particles: rb(st).particles ?? null,
          emitterNames: names,
          offlineCount: offCount,
        };
        const p7 =
          !st.ok || emitters === null || emitters === 0
            ? killed(
                "P-W5-07",
                observed,
                `no live Particles in edit mode (${st.ok ? `emitters ${S(emitters)}` : why(st)}): stats, control, simulate, param and setParam move to play mode`,
              )
            : emitters === offCount && FX_EMITTERS.every((n) => names.includes(n))
              ? settled("P-W5-07", observed, `emitters ${emitters} = the .ptc's, names match`)
              : partial(
                  "P-W5-07",
                  observed,
                  `emitters ${emitters} (offline ${offCount}), names ${names.join(", ")}`,
                );
        return {
          ...verdictOf(fails, [p7], `${FX_NAME} placed, ${S(emitters)} emitters`),
          evidence,
          probes: [p7],
        };
      },
    },
    {
      id: "w5-21-particle-control",
      block: "W5.2",
      title:
        "wb_particle control (pause, play, stopEmission, restart, stop, play) and simulate 1 s after a restart (P-W5-09)",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "each op answers stateBefore and state; after restart then simulate seconds 1: particles > 0 and time grown by about 1",
      kill_criterion:
        "P-W5-09: particles stay 0 and time unchanged after simulate: simulate moves to play mode",
      side_effects: [`${FX_NAME}'s runtime state changed; it ends playing`],
      rollback: "the last op is play",
      probes: ["P-W5-09"],
      dependsOn: ["P-W5-07"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        ...["pause", "play", "stopEmission", "restart", "stop", "play"].map((op) =>
          tc("wb_particle", "control", { entity: `name:${FX_NAME}`, op }),
        ),
        tc("wb_particle", "control", { entity: `name:${FX_NAME}`, op: "restart" }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "simulate", { entity: `name:${FX_NAME}`, seconds: "1", minFps: "30" }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const st0 = await ensureEffect(ctx, fx[FX_PTC]!, FX_NAME, evidence);
        evidence.stats = brief(st0);
        const ops: Raw = {};
        for (const op of ["pause", "play", "stopEmission", "restart", "stop", "play"]) {
          const r = await ctx.tool("wb_particle", {
            action: "control",
            entity: `name:${FX_NAME}`,
            op,
          });
          ops[op === "play" && ops.play ? "play (again)" : op] = brief(r, 600);
          if (!r.ok) fails.push(`control ${op}: ${why(r)}`);
        }
        evidence.control = ops;
        const rs = await ctx.tool("wb_particle", {
          action: "control",
          entity: `name:${FX_NAME}`,
          op: "restart",
        });
        const a = await ctx.tool("wb_particle", { action: "stats", entity: `name:${FX_NAME}` });
        const sim = await ctx.tool("wb_particle", {
          action: "simulate",
          entity: `name:${FX_NAME}`,
          seconds: "1",
          minFps: "30",
        });
        const b = await ctx.tool("wb_particle", { action: "stats", entity: `name:${FX_NAME}` });
        Object.assign(evidence, {
          restart: brief(rs),
          before: brief(a),
          simulate: brief(sim),
          after: brief(b),
        });
        const t0 = N(rb(a).time) ?? 0;
        const t1 = N(rb(b).time) ?? N(rb(sim).time) ?? 0;
        const parts = N(rb(b).particles) ?? N(rb(sim).particles) ?? 0;
        const observed = {
          timeBefore: t0,
          timeAfter: t1,
          particlesAfter: parts,
          simulate: rb(sim),
        };
        const p9 = !sim.ok
          ? killed("P-W5-09", { ...observed, code: S(sim.code) }, `simulate refused: ${why(sim)}`)
          : parts === 0 && t1 === t0
            ? killed(
                "P-W5-09",
                observed,
                "particles stay 0 and time unchanged: simulate moves to play mode",
              )
            : parts > 0 && t1 - t0 > 0.5
              ? settled("P-W5-09", observed, `particles ${parts}, time +${(t1 - t0).toFixed(2)} s`)
              : partial("P-W5-09", observed, `particles ${parts}, time ${t0} -> ${t1}`);
        return { ...verdictOf(fails, [p9], "every op answered"), evidence, probes: [p9] };
      },
    },
    {
      id: "w5-22-particle-param",
      block: "W5.2",
      title:
        "wb_particle param BIRTH_RATE of emitter 0 against the offline value (P-W5-08); setParam and setParam multiply, each set back",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "param answers value and original 1 (Fireflies' BirthRate offline); setParam 3 reads back 3; multiply 2 reads back 2 (MultParam sets the multiple of the ORIGINAL value: original 1 x 2, fix-up 1); the set back reads 1",
      kill_criterion:
        "P-W5-08: param refuses UNPROVEN or the value is always 0: param is removed and setParam's readback is weak",
      side_effects: [`${FX_NAME}'s emitter 0 birth rate changed and set back (runtime only)`],
      rollback: "setParam back to the value before (restorer after a cut)",
      probes: ["P-W5-08"],
      dependsOn: ["P-W5-07"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "param", { entity: `name:${FX_NAME}`, emitter: 0, param: "BIRTH_RATE" }),
        tc("wb_particle", "setParam", {
          entity: `name:${FX_NAME}`,
          emitter: 0,
          param: "BIRTH_RATE",
          value: "3",
        }),
        tc("wb_particle", "setParam", {
          entity: `name:${FX_NAME}`,
          emitter: 0,
          param: "BIRTH_RATE",
          value: "2",
          multiply: true,
        }),
        tc("wb_particle", "setParam", {
          entity: `name:${FX_NAME}`,
          emitter: 0,
          param: "BIRTH_RATE",
          value: "<before>",
        }),
        tc("wb_particle", "param", { entity: `name:${FX_NAME}`, emitter: 0, param: "BIRTH_RATE" }),
      ],
      offlineCalls: () => [oc("particle", "emitter", { path: FX_PTC, emitter: "Fireflies" })],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        await ensureEffect(ctx, fx[FX_PTC]!, FX_NAME, evidence);
        const off = await ctx.offline("particle", {
          action: "emitter",
          path: FX_PTC,
          emitter: "Fireflies",
        });
        const offRate = Number(
          /BirthRate\s+([-\d.eE]+)/.exec(textOfFixture(ctx, FX_PTC))?.[1] ?? "NaN",
        );
        const ent = `name:${FX_NAME}`;
        const p0 = await ctx.tool("wb_particle", {
          action: "param",
          entity: ent,
          emitter: 0,
          param: "BIRTH_RATE",
        });
        const before = N(rb(p0).value) ?? offRate;
        ctx.debt.restorers.push({
          label: "setParam back",
          fn: () =>
            ctx.deps.tool("wb_particle", {
              action: "setParam",
              entity: ent,
              emitter: 0,
              param: "BIRTH_RATE",
              value: String(before),
            }),
        });
        const s1 = await ctx.tool("wb_particle", {
          action: "setParam",
          entity: ent,
          emitter: 0,
          param: "BIRTH_RATE",
          value: "3",
        });
        const s2 = await ctx.tool("wb_particle", {
          action: "setParam",
          entity: ent,
          emitter: 0,
          param: "BIRTH_RATE",
          value: "2",
          multiply: true,
        });
        const s3 = await ctx.tool(
          "wb_particle",
          {
            action: "setParam",
            entity: ent,
            emitter: 0,
            param: "BIRTH_RATE",
            value: String(before),
          },
          { restore: true },
        );
        if (s3.ok) ctx.debt.restorers.pop();
        const p1 = await ctx.tool("wb_particle", {
          action: "param",
          entity: ent,
          emitter: 0,
          param: "BIRTH_RATE",
        });
        Object.assign(evidence, {
          offlineEmitter: brief(off, 1500),
          offlineBirthRate: offRate,
          param: brief(p0),
          setParam: brief(s1),
          setParamMultiply: brief(s2),
          setParamBack: brief(s3),
          paramAfter: brief(p1),
        });
        const observed = {
          value: rb(p0).value ?? null,
          original: rb(p0).original ?? null,
          offline: offRate,
          code: p0.ok ? null : S(p0.code),
          setAfter: rb(s1).after ?? null,
          multiplyAfter: rb(s2).after ?? null,
        };
        const p8 = !p0.ok
          ? p0.code === "UNPROVEN"
            ? killed(
                "P-W5-08",
                observed,
                "param refuses UNPROVEN: GetParam did not pass; param is removed",
              )
            : partial("P-W5-08", observed, `param refused ${why(p0)}`)
          : N(rb(p0).value) === 0 && N(rb(s1).after) === 0
            ? killed(
                "P-W5-08",
                observed,
                "the value is always 0: param is removed; setParam's readback is weak",
              )
            : near(rb(p0).value, offRate)
              ? settled(
                  "P-W5-08",
                  observed,
                  `GetParam reads ${S(rb(p0).value)} = the .ptc's BirthRate`,
                )
              : partial(
                  "P-W5-08",
                  observed,
                  `GetParam reads ${S(rb(p0).value)}, offline ${offRate}`,
                );
        if (!s1.ok) fails.push(`setParam: ${why(s1)}`);
        else if (p0.ok && !near(rb(s1).after, 3))
          fails.push(`setParam after ${S(rb(s1).after)}, not 3`);
        // MultParam "Sets a given parameter of a given emitter to the multiple of its ORIGINAL value
        // from the effect's definition" (API index; Particles.c:128 in the paks: MultParam 0.50 then
        // 0.75 of 100 gives 50 then 75). Run 1 read 3 -> 2 for x2 of the original 1 (fix-up 1).
        const original = N(rb(p0).original) ?? offRate;
        if (!s2.ok) fails.push(`setParam multiply: ${why(s2)}`);
        else if (p0.ok && !near(rb(s2).after, original * 2))
          fails.push(`multiply after ${S(rb(s2).after)}, not ${original * 2} (2 x the original ${original})`);
        if (!s3.ok) fails.push(`setParam back: ${why(s3)}`);
        if (p1.ok && !near(rb(p1).value, before))
          fails.push(`not set back: ${S(rb(p1).value)} (before ${before})`);
        return {
          ...verdictOf(fails, [p8], `birth rate ${S(rb(p0).value)}`),
          evidence,
          probes: [p8],
        };
      },
    },
    {
      id: "w5-23-particle-remove",
      block: "W5.2",
      title:
        "wb_particle remove (dry run, then confirm); Edit > Undo brings it back, a second remove removes it again; the throwaway world saved",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "the dry run keeps the entity (stats ok); the confirm removes it (stats ENTITY_NOT_FOUND); undo restores it (stats ok); the second remove removes it; the save answers ok",
      kill_criterion: `a remove that does not remove or an undo that does not restore: FAIL; ${WINDOW_KILL}`,
      side_effects: [`${WORLD} saved without ${FX_NAME}`],
      rollback: "the second remove; the world is saved only under _throwaway/W5/",
      probes: [],
      dependsOn: ["P-W5-07"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "remove", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "remove", { entity: `name:${FX_NAME}`, confirm: true }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        ...editPlan("Undo"),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        tc("wb_particle", "remove", { entity: `name:${FX_NAME}`, confirm: true }),
        tc("wb_particle", "stats", { entity: `name:${FX_NAME}` }),
        ...saveThrowawayPlan(`the world saved without ${FX_NAME}`),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const ent = `name:${FX_NAME}`;
        const s0 = await ensureEffect(ctx, fx[FX_PTC]!, FX_NAME, evidence);
        const dry = await ctx.tool("wb_particle", { action: "remove", entity: ent });
        const s1 = await ctx.tool("wb_particle", { action: "stats", entity: ent });
        const rm = await ctx.tool("wb_particle", { action: "remove", entity: ent, confirm: true });
        const s2 = await ctx.tool("wb_particle", { action: "stats", entity: ent });
        const un = rm.ok ? await ctx.undo() : null;
        const s3 = un ? await ctx.tool("wb_particle", { action: "stats", entity: ent }) : null;
        // Edit > Redo is not on the policy's ExecuteAction allow-list: the undone remove is
        // removed again by the tool (confirm), which is what a redo would have done.
        const again = s3?.ok
          ? await ctx.tool("wb_particle", { action: "remove", entity: ent, confirm: true })
          : null;
        const s4 = again ? await ctx.tool("wb_particle", { action: "stats", entity: ent }) : null;
        const sv = await saveThrowaway(ctx);
        Object.assign(evidence, {
          statsBefore: brief(s0),
          dry: brief(dry),
          statsAfterDry: brief(s1),
          remove: brief(rm),
          statsAfterRemove: brief(s2),
          undo: un,
          statsAfterUndo: brief(s3),
          removeAgain: brief(again),
          statsAfterRemoveAgain: brief(s4),
          save: sv,
        });
        if (!s0.ok) fails.push(`no ${FX_NAME} to remove: ${why(s0)}`);
        if (!dry.ok || rb(dry).dryRun !== true)
          fails.push(`remove dry run: ${dry.ok ? "dryRun not true" : why(dry)}`);
        if (!s1.ok) fails.push("the dry run removed the entity");
        if (!rm.ok) fails.push(`remove: ${why(rm)}`);
        else if (s2.ok || s2.code !== "ENTITY_NOT_FOUND")
          fails.push("the entity is still there after remove");
        if (un && !un.ok) fails.push(`undo: ${un.message}`);
        else if (s3 && !s3.ok) fails.push(`undo did not bring it back: ${why(s3)}`);
        if (again && !again.ok) fails.push(`remove again: ${why(again)}`);
        else if (s4?.ok) fails.push("the second remove did not remove it");
        if (!sv?.ok) fails.push("the throwaway world was not saved");
        return { ...verdictOf(fails, [], "remove, undo, remove again; saved"), evidence };
      },
    },

    // ── W5.3 entity sound (P-W5-16) ──
    {
      id: "w5-30-entity-sound",
      block: "W5.3",
      title:
        "an entity's sound component in edit mode (P-W5-16): a vanilla LampKerosene_01_base placed (fix-up 1: a base-game prefab with a SoundComponent and a SignalsManagerComponent); entityEvents against the offline events of its .acp; entityPlay, stop; setSignal and back; deleted and the world saved",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "the create answers ok; entityEvents answers the component and either events equal to `audio events` of Props_LampKerosene_01.acp, or (an SndComponent, which has no GetEvents) no events, its signals and the offline-events warning; entityPlay (an event of the handler or, failing that, of the offline list) is recorded, not judged (the AudioSystem does not run in edit mode, P-W5-06 run 1); setSignal answers, set back when set; the entity deleted and the world saved",
      kill_criterion:
        "P-W5-16: NO_SOUND_COMPONENT on a prefab whose source shows the component: entityEvents falls back offline; entityPlay and setSignal go to play mode",
      side_effects: [`entity ${SND_NAME} placed, then deleted; ${WORLD} saved`],
      rollback: "wb_entity delete; the save (only the throwaway world)",
      probes: ["P-W5-16"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_entity", "create", { prefab: SOUND_PREFAB, name: SND_NAME, coords: "2 0 2" }),
        tc("wb_audio", "entityEvents", { entity: `name:${SND_NAME}` }),
        tc("wb_audio", "entityPlay", { entity: `name:${SND_NAME}`, eventName: "<first event>" }),
        tc("wb_audio", "stop", { handle: "<handle>" }),
        tc("wb_audio", "setSignal", {
          entity: `name:${SND_NAME}`,
          name: "<first signal>",
          value: "1",
        }),
        tc("wb_audio", "setSignal", {
          entity: `name:${SND_NAME}`,
          name: "<first signal>",
          value: "<before>",
        }),
        tc("wb_entity", "delete", { entities: [`name:${SND_NAME}`] }),
        ...saveThrowawayPlan(`the world saved without ${SND_NAME}`),
      ],
      offlineCalls: () => [oc("audio", "events", { path: SOUND_PREFAB_ACP })],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const ent = `name:${SND_NAME}`;
        const off = await ctx.offline("audio", { action: "events", path: SOUND_PREFAB_ACP });
        const offEvents = (rowsOf(off).length ? rowsOf(off) : ((rb(off).events ?? []) as Raw[]))
          .map((e) => S(e.name ?? e))
          .filter((x) => x !== "")
          .sort();
        const listed = await ctx.tool("wb_entity", { action: "list", name: SND_NAME });
        const present = (N(rb(listed).total) ?? rowsOf(listed).length) > 0;
        const cr = present
          ? null
          : await ctx.tool("wb_entity", {
              action: "create",
              prefab: SOUND_PREFAB,
              name: SND_NAME,
              coords: "2 0 2",
            });
        if (cr?.ok)
          ctx.debt.restorers.push({
            label: `delete ${SND_NAME}`,
            fn: () => ctx.deps.tool("wb_entity", { action: "delete", entities: [ent] }),
          });
        const ev = await ctx.tool("wb_audio", { action: "entityEvents", entity: ent });
        const events = strs(rb(ev).events);
        const signals = strs(rb(ev).signals);
        // An SndComponent lists no events (no GetEvents): the offline list names the one to play.
        const playEvent = events[0] ?? (ev.ok ? offEvents[0] : undefined);
        let play: ToolResponse | null = null;
        let stop: ToolResponse | null = null;
        if (playEvent) {
          play = await ctx.tool("wb_audio", {
            action: "entityPlay",
            entity: ent,
            eventName: playEvent,
          });
          const h = N(rb(play).handle);
          if (h !== null && h > 0) stop = await ctx.tool("wb_audio", { action: "stop", handle: h });
        }
        let sig: ToolResponse | null = null;
        let sigBack: ToolResponse | null = null;
        if (signals[0]) {
          sig = await ctx.tool("wb_audio", {
            action: "setSignal",
            entity: ent,
            name: signals[0],
            value: "1",
          });
          if (sig.ok && rb(sig).set === true)
            sigBack = await ctx.tool("wb_audio", {
              action: "setSignal",
              entity: ent,
              name: signals[0],
              value: S(rb(sig).before) || "0",
            });
        }
        const del = await ctx.tool("wb_entity", { action: "delete", entities: [ent] });
        if (del.ok) ctx.debt.restorers = [];
        const sv = await saveThrowaway(ctx);
        Object.assign(evidence, {
          offlineEvents: offEvents,
          offline: brief(off, 1500),
          create: brief(cr),
          entityEvents: brief(ev),
          entityPlay: brief(play),
          stop: brief(stop),
          setSignal: brief(sig),
          setSignalBack: brief(sigBack),
          delete: brief(del),
          save: sv,
        });
        const observed = {
          code: ev.ok ? null : S(ev.code),
          component: rb(ev).component ?? null,
          events,
          signals,
          offlineEvents: offEvents,
        };
        const sorted = [...events].sort();
        const p16 = !ev.ok
          ? ev.code === "NO_SOUND_COMPONENT"
            ? killed(
                "P-W5-16",
                observed,
                "no sound component in edit mode on a prefab whose source has one: entityEvents falls back offline, entityPlay and setSignal go to play mode",
              )
            : partial("P-W5-16", observed, `entityEvents refused ${why(ev)}`)
          : events.length > 0 && JSON.stringify(sorted) === JSON.stringify(offEvents)
            ? settled("P-W5-16", observed, `${events.length} events equal the .acp's`)
            : events.length === 0 && S(rb(ev).component) !== ""
              ? partial(
                  "P-W5-16",
                  observed,
                  `the component (${S(rb(ev).component)}) is found in edit mode; it is an SndComponent with no GetEvents, so the events come from the offline .acp (${offEvents.join(", ") || "none"})`,
                )
              : partial(
                "P-W5-16",
                observed,
                `events ${events.join(", ") || "none"}; offline ${offEvents.join(", ") || "none"}`,
              );
        if (cr && !cr.ok) fails.push(`create ${SND_NAME}: ${why(cr)}`);
        // entityPlay in edit mode is recorded, not judged: the AudioSystem does not run in edit mode
        // (P-W5-06 KILLED in run 1); P-W5-16's play half stays open.
        evidence.entityPlayNote = play
          ? `${playEvent}: ${play.ok ? `handle ${S(rb(play).handle)}, playing ${S(rb(play).playing)}` : why(play)} (recorded, not judged: P-W5-06)`
          : "not sent (no event)";
        if (ev.ok && events.length === 0 && !(ev.warnings ?? []).some((w) => /no GetEvents/.test(w)))
          fails.push("entityEvents answered no events without the offline-events warning");
        if (sig && !sig.ok) fails.push(`setSignal: ${why(sig)}`);
        if (sigBack && !sigBack.ok) fails.push(`setSignal back: ${why(sigBack)}`);
        if (!del.ok) fails.push(`delete ${SND_NAME}: ${why(del)}`);
        if (!sv?.ok) fails.push("the throwaway world was not saved");
        return {
          ...verdictOf(fails, [p16], `${events.length} events, ${signals.length} signals`),
          evidence,
          probes: [p16],
        };
      },
    },

    // ── W5.4 engine accept of the offline tools (independent steps) ──
    {
      id: "w5-40-accept-acp",
      block: "W5.4",
      title:
        "audio set (bank Volume) and renameEvent on the offline .acp copy, then Workbench loads it: describe, the Volume read back, the renamed event plays (P-W5-02); the copy restored",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "both writes write; after register, describe answers AudioClass; a get of the bank's Volume reads 2; play of EMCP_W5_ACCEPT answers a handle != 0 while the unedited SOUND_MUSIC_RALLY also plays; the inverses return the copy byte-identical",
      kill_criterion:
        "P-W5-02: LoadContainer null (describe refuses), a parse error, or a modal: every audio write stays dry run only",
      side_effects: [`${OFF_ACP} edited, registered (+ .meta), restored on disk`],
      rollback: "the inverse writes; `rollback` removes the files",
      probes: ["P-W5-02"],
      writes: [OFF_ACP, metaRelOf(OFF_ACP)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_resources", "register", { path: OFF_ACP, confirm: true }),
        tc("wb_container", "describe", { target: `path:${OFF_ACP}` }),
        tc("wb_container", "get", { target: `path:${OFF_ACP}`, path: "<the bank's Volume>" }),
        tc("wb_audio", "play", {
          resource: "<W5_off.acp resource name>",
          eventName: "EMCP_W5_ACCEPT",
        }),
        tc("wb_audio", "play", { resource: "<W5_off.acp resource name>", eventName: RALLY_EVENT }),
        tc("wb_audio", "stop", { handle: "<handle>" }),
      ],
      offlineCalls: () => [
        oc("audio", "set", {
          path: OFF_ACP,
          node: RALLY_BANK,
          key: "Volume",
          value: 2,
          confirm: true,
        }),
        oc("audio", "renameEvent", {
          path: OFF_ACP,
          event: RALLY_EVENT_2,
          name: "EMCP_W5_ACCEPT",
          confirm: true,
        }),
        oc("audio", "renameEvent", {
          path: OFF_ACP,
          event: "EMCP_W5_ACCEPT",
          name: RALLY_EVENT_2,
          confirm: true,
        }),
        oc("audio", "set", {
          path: OFF_ACP,
          node: RALLY_BANK,
          key: "Volume",
          value: 3,
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const start = bytesOf(ctx, OFF_ACP);
        const e1 = await ctx.offline("audio", {
          action: "set",
          path: OFF_ACP,
          node: RALLY_BANK,
          key: "Volume",
          value: 2,
          confirm: true,
        });
        const e2 = await ctx.offline("audio", {
          action: "renameEvent",
          path: OFF_ACP,
          event: RALLY_EVENT_2,
          name: "EMCP_W5_ACCEPT",
          confirm: true,
        });
        const edited = bytesOf(ctx, OFF_ACP);
        const name = await registerCopy(ctx, OFF_ACP, evidence, fails);
        const T = `path:${OFF_ACP}`;
        const d = await ctx.tool("wb_container", { action: "describe", target: T });
        const vol = await getAny(ctx, T, [
          "banks_local[0].Volume",
          "banks_local.0.Volume",
          "banks_local[BankLocalClass].Volume",
        ]);
        const playable = !ctx.killed("P-W5-06");
        const pe =
          playable && name
            ? await ctx.tool("wb_audio", {
                action: "play",
                resource: name,
                eventName: "EMCP_W5_ACCEPT",
              })
            : null;
        const pu =
          playable && name
            ? await ctx.tool("wb_audio", { action: "play", resource: name, eventName: RALLY_EVENT })
            : null;
        for (const p of [pe, pu]) {
          const h = N(rb(p).handle);
          if (h !== null && h > 0) await ctx.tool("wb_audio", { action: "stop", handle: h });
        }
        const i1 = await ctx.offline("audio", {
          action: "renameEvent",
          path: OFF_ACP,
          event: "EMCP_W5_ACCEPT",
          name: RALLY_EVENT_2,
          confirm: true,
        });
        const i2 = await ctx.offline("audio", {
          action: "set",
          path: OFF_ACP,
          node: RALLY_BANK,
          key: "Volume",
          value: 3,
          confirm: true,
        });
        const end = bytesOf(ctx, OFF_ACP);
        Object.assign(evidence, {
          set: brief(e1, 1500),
          renameEvent: brief(e2, 1500),
          editDiff: diffOf(start, edited),
          describe: brief(d, 1500),
          volume: vol,
          playEdited: brief(pe),
          playUnedited: brief(pu),
          inverse: [brief(i1, 400), brief(i2, 400)],
          restoredIdentical: same(start, end),
        });
        if (!e1.ok) fails.push(`set: ${why(e1)}`);
        if (!e2.ok) fails.push(`renameEvent: ${why(e2)}`);
        if (!same(start, end))
          fails.push(`not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`);
        const observed = {
          describe: d.ok ? (rb(d).rootClass ?? "ok") : S(d.code),
          volume: vol.value,
          volumePath: vol.path,
          playEditedHandle: pe ? (rb(pe).handle ?? S(pe.code)) : "not sent (P-W5-06 killed)",
          playUneditedHandle: pu ? (rb(pu).handle ?? S(pu.code)) : null,
        };
        const p2 = !d.ok
          ? killed(
              "P-W5-02",
              observed,
              `the engine did not load the edited .acp (${why(d)}): audio writes stay dry run`,
            )
          : pe && N(rb(pe).handle) && near(vol.value, 2)
            ? settled("P-W5-02", observed, "loaded; Volume reads 2; the renamed event plays")
            : pe && !N(rb(pe).handle) && N(rb(pu).handle)
              ? killed(
                  "P-W5-02",
                  observed,
                  "the renamed event does not play while the unedited one does",
                )
              : partial(
                  "P-W5-02",
                  observed,
                  `loaded (${S(rb(d).rootClass)}); Volume ${vol.value ?? "not read by any path form"}; play ${pe ? S(rb(pe).handle) : "not sent"}`,
                );
        return { ...verdictOf(fails, [p2], "the .acp edit loaded"), evidence, probes: [p2] };
      },
    },
    {
      id: "w5-41-accept-ptc",
      block: "W5.4",
      title:
        "particle set (BirthRate 5) on the offline .ptc copy, then Workbench loads it: describe, BirthRate read back; spawned, stats emitters, param (P-W5-03 .ptc); the copy restored",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "the write writes; describe answers EffectDef; a get of emitter 0's BirthRate reads 5; a spawn of it reports 2 emitters (and param 5 when P-W5-08 passed); removed, the world saved; the inverse returns the copy byte-identical",
      kill_criterion:
        "P-W5-03 (.ptc): LoadContainer null, a parse error, or a modal: .ptc writes stay dry run",
      side_effects: [
        `${OFF_PTC} edited, registered (+ .meta), restored; ${FX_ACCEPT_NAME} placed and removed`,
      ],
      rollback: "the inverse write; remove; the save of the throwaway world",
      probes: ["P-W5-03"],
      writes: [OFF_PTC, metaRelOf(OFF_PTC), WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_resources", "register", { path: OFF_PTC, confirm: true }),
        tc("wb_container", "describe", { target: `path:${OFF_PTC}` }),
        tc("wb_container", "get", { target: `path:${OFF_PTC}`, path: "<emitter 0 BirthRate>" }),
        tc("wb_particle", "spawn", {
          effect: "<W5_off.ptc resource name>",
          name: FX_ACCEPT_NAME,
          coords: "2 1 0",
          confirm: true,
        }),
        tc("wb_particle", "stats", { entity: `name:${FX_ACCEPT_NAME}` }),
        tc("wb_particle", "param", {
          entity: `name:${FX_ACCEPT_NAME}`,
          emitter: 0,
          param: "BIRTH_RATE",
        }),
        tc("wb_particle", "remove", { entity: `name:${FX_ACCEPT_NAME}`, confirm: true }),
        ...saveThrowawayPlan(`the world saved without ${FX_ACCEPT_NAME}`),
      ],
      offlineCalls: () => [
        oc("particle", "set", {
          path: OFF_PTC,
          emitter: "Fireflies",
          props: { BirthRate: 5 },
          confirm: true,
        }),
        oc("particle", "set", {
          path: OFF_PTC,
          emitter: "Fireflies",
          props: { BirthRate: 1 },
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const start = bytesOf(ctx, OFF_PTC);
        const e1 = await ctx.offline("particle", {
          action: "set",
          path: OFF_PTC,
          emitter: "Fireflies",
          props: { BirthRate: 5 },
          confirm: true,
        });
        const edited = bytesOf(ctx, OFF_PTC);
        const name = await registerCopy(ctx, OFF_PTC, evidence, fails);
        const T = `path:${OFF_PTC}`;
        const d = await ctx.tool("wb_container", { action: "describe", target: T });
        const br = await getAny(ctx, T, [
          "Emitters[0].BirthRate",
          "Emitters.0.BirthRate",
          "Emitters[EmitterDef].BirthRate",
        ]);
        let sp: ToolResponse | null = null;
        let st: ToolResponse | null = null;
        let pm: ToolResponse | null = null;
        let rm: ToolResponse | null = null;
        if (!ctx.killed("P-W5-07") && name) {
          sp = await ctx.tool("wb_particle", {
            action: "spawn",
            effect: name,
            name: FX_ACCEPT_NAME,
            coords: "2 1 0",
            confirm: true,
          });
          if (sp.ok) {
            ctx.debt.restorers.push({
              label: `remove ${FX_ACCEPT_NAME}`,
              fn: () =>
                ctx.deps.tool("wb_particle", {
                  action: "remove",
                  entity: `name:${FX_ACCEPT_NAME}`,
                  confirm: true,
                }),
            });
            st = await ctx.tool("wb_particle", {
              action: "stats",
              entity: `name:${FX_ACCEPT_NAME}`,
            });
            if (!ctx.killed("P-W5-08"))
              pm = await ctx.tool("wb_particle", {
                action: "param",
                entity: `name:${FX_ACCEPT_NAME}`,
                emitter: 0,
                param: "BIRTH_RATE",
              });
            rm = await ctx.tool(
              "wb_particle",
              { action: "remove", entity: `name:${FX_ACCEPT_NAME}`, confirm: true },
              { restore: true },
            );
            if (rm.ok) ctx.debt.restorers.pop();
          }
        }
        const sv = await saveThrowaway(ctx);
        const i1 = await ctx.offline("particle", {
          action: "set",
          path: OFF_PTC,
          emitter: "Fireflies",
          props: { BirthRate: 1 },
          confirm: true,
        });
        const end = bytesOf(ctx, OFF_PTC);
        Object.assign(evidence, {
          set: brief(e1, 1500),
          editDiff: diffOf(start, edited),
          describe: brief(d, 1500),
          birthRate: br,
          spawn: brief(sp),
          stats: brief(st),
          param: brief(pm),
          remove: brief(rm),
          save: sv,
          inverse: brief(i1, 400),
          restoredIdentical: same(start, end),
        });
        if (!e1.ok) fails.push(`set: ${why(e1)}`);
        if (sp && !sp.ok) fails.push(`spawn of the edited copy: ${why(sp)}`);
        if (sp?.ok && !rm?.ok) fails.push(`remove ${FX_ACCEPT_NAME}: ${rm ? why(rm) : "not sent"}`);
        if (!same(start, end))
          fails.push(`not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`);
        const observed = {
          format: ".ptc",
          describe: d.ok ? (rb(d).rootClass ?? "ok") : S(d.code),
          birthRate: br.value,
          birthRatePath: br.path,
          emitters: rb(st).emitters ?? null,
          param: rb(pm).value ?? null,
        };
        const p3 = !d.ok
          ? killed(
              "P-W5-03",
              observed,
              `.ptc: the engine did not load the edited copy (${why(d)}): .ptc writes stay dry run`,
            )
          : near(br.value, 5) || near(rb(pm).value, 5)
            ? settled("P-W5-03", observed, ".ptc: loaded with BirthRate 5")
            : partial(
                "P-W5-03",
                observed,
                `.ptc: loaded (${S(rb(d).rootClass)}); BirthRate not read back by any path form`,
              );
        return { ...verdictOf(fails, [p3], ".ptc edit loaded"), evidence, probes: [p3] };
      },
    },
    {
      id: "w5-42-accept-vars",
      block: "W5.4",
      title:
        "audio addVariable on the offline variables .conf copy, then Workbench loads it: describe, wb_audio variable finds the new variable in wb_world play (fix-up 2: run 2 sent it in edit mode, WRONG_MODE) (P-W5-03 variables .conf); the copy restored",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "the write writes; describe answers AudioVariablesClass; in play, wb_audio variable of EMCP_W5_Var answers id >= 0, then back in edit mode; removeVariable returns the copy byte-identical",
      kill_criterion:
        "P-W5-03 (variables .conf): LoadContainer null, a parse error, or a modal: its writes stay dry run",
      side_effects: [`${OFF_VARS} edited, registered (+ .meta), restored`],
      rollback: "removeVariable; `rollback` removes the files",
      probes: ["P-W5-03"],
      writes: [OFF_VARS, metaRelOf(OFF_VARS)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_resources", "register", { path: OFF_VARS, confirm: true }),
        tc("wb_container", "describe", { target: `path:${OFF_VARS}` }),
        ...playPlan([
          tc("wb_audio", "variable", {
            resource: "<W5_off_vars.conf resource name>",
            name: "EMCP_W5_Var",
          }),
        ]),
      ],
      offlineCalls: () => [
        oc("audio", "addVariable", {
          path: OFF_VARS,
          name: "EMCP_W5_Var",
          source: "Constant",
          value: 0.25,
          confirm: true,
        }),
        oc("audio", "removeVariable", { path: OFF_VARS, name: "EMCP_W5_Var", confirm: true }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const start = bytesOf(ctx, OFF_VARS);
        const e1 = await ctx.offline("audio", {
          action: "addVariable",
          path: OFF_VARS,
          name: "EMCP_W5_Var",
          source: "Constant",
          value: 0.25,
          confirm: true,
        });
        const edited = bytesOf(ctx, OFF_VARS);
        const name = await registerCopy(ctx, OFF_VARS, evidence, fails);
        const d = await ctx.tool("wb_container", {
          action: "describe",
          target: `path:${OFF_VARS}`,
        });
        // Fix-up 2: variable is play-mode guarded (fix-up 1); run 2 sent it in edit mode (WRONG_MODE).
        const round = name
          ? await inPlay(ctx, () =>
              ctx.tool("wb_audio", { action: "variable", resource: name, name: "EMCP_W5_Var" }),
            )
          : null;
        if (round) playFails(round, fails);
        const v = round?.result ?? null;
        const i1 = await ctx.offline("audio", {
          action: "removeVariable",
          path: OFF_VARS,
          name: "EMCP_W5_Var",
          confirm: true,
        });
        const end = bytesOf(ctx, OFF_VARS);
        Object.assign(evidence, {
          addVariable: brief(e1, 1500),
          editDiff: diffOf(start, edited),
          describe: brief(d, 1500),
          variable: brief(v),
          inverse: brief(i1, 400),
          restoredIdentical: same(start, end),
        });
        if (!e1.ok) fails.push(`addVariable: ${why(e1)}`);
        if (!same(start, end))
          fails.push(`not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`);
        const id = N(rb(v).id);
        const observed = {
          format: "variables .conf",
          describe: d.ok ? (rb(d).rootClass ?? "ok") : S(d.code),
          variableId: v ? (v.ok ? id : S(v.code)) : null,
        };
        const p3 = !d.ok
          ? killed(
              "P-W5-03",
              observed,
              `variables .conf: not loaded (${why(d)}): its writes stay dry run`,
            )
          : v?.ok && id !== null && id >= 0
            ? settled("P-W5-03", observed, `variables .conf: loaded; EMCP_W5_Var id ${id}`)
            : partial(
                "P-W5-03",
                observed,
                "variables .conf: loaded; the new variable is not found by AudioSystem",
              );
        return { ...verdictOf(fails, [p3], "variables .conf edit loaded"), evidence, probes: [p3] };
      },
    },
    {
      id: "w5-43-accept-afm",
      block: "W5.4",
      title:
        "audio set (bus Music limit 3) on the offline .afm copy, then Workbench loads it: describe, the limit read back, outputStates on it in wb_world play (fix-up 2: run 2 sent it in edit mode, WRONG_MODE) (P-W5-03 .afm); the copy restored",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "the write writes; describe answers AudioOutputStateResClass; a get of the Music bus's limit reads 3; in play, outputStates answers (ok or a domain code), then back in edit mode; the inverse returns the copy byte-identical",
      kill_criterion:
        "P-W5-03 (.afm): LoadContainer null, a parse error, or a modal: .afm writes stay dry run",
      side_effects: [`${OFF_AFM} edited, registered (+ .meta), restored`],
      rollback: "the inverse write; `rollback` removes the files",
      probes: ["P-W5-03"],
      writes: [OFF_AFM, metaRelOf(OFF_AFM)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_resources", "register", { path: OFF_AFM, confirm: true }),
        tc("wb_container", "describe", { target: `path:${OFF_AFM}` }),
        tc("wb_container", "get", { target: `path:${OFF_AFM}`, path: "<Music bus limit>" }),
        ...playPlan([
          tc("wb_audio", "outputStates", { resource: "<W5_off.afm resource name>", name: "Music" }),
        ]),
      ],
      offlineCalls: () => [
        oc("audio", "set", { path: OFF_AFM, node: "Music", key: "limit", value: 3, confirm: true }),
        oc("audio", "set", { path: OFF_AFM, node: "Music", key: "limit", value: 2, confirm: true }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const start = bytesOf(ctx, OFF_AFM);
        const e1 = await ctx.offline("audio", {
          action: "set",
          path: OFF_AFM,
          node: "Music",
          key: "limit",
          value: 3,
          confirm: true,
        });
        const edited = bytesOf(ctx, OFF_AFM);
        const name = await registerCopy(ctx, OFF_AFM, evidence, fails);
        const T = `path:${OFF_AFM}`;
        const d = await ctx.tool("wb_container", { action: "describe", target: T });
        const lim = await getAny(ctx, T, [
          "Mixers[0].limit",
          "Mixers.0.limit",
          "Mixers[OBusClass].limit",
        ]);
        // Fix-up 2: outputStates is play-mode guarded (fix-up 1, P-W5-06); run 2 sent it in edit
        // mode and it answered WRONG_MODE, so it runs inside wb_world play now.
        const round = name
          ? await inPlay(ctx, () =>
              ctx.tool("wb_audio", { action: "outputStates", resource: name, name: "Music" }),
            )
          : null;
        const os = round?.result ?? null;
        const i1 = await ctx.offline("audio", {
          action: "set",
          path: OFF_AFM,
          node: "Music",
          key: "limit",
          value: 2,
          confirm: true,
        });
        const end = bytesOf(ctx, OFF_AFM);
        Object.assign(evidence, {
          set: brief(e1, 1500),
          editDiff: diffOf(start, edited),
          describe: brief(d, 1500),
          limit: lim,
          playRound: round
            ? { play: brief(round.play), stop: brief(round.stop), after: brief(round.after) }
            : null,
          outputStates: brief(os),
          inverse: brief(i1, 400),
          restoredIdentical: same(start, end),
        });
        if (!e1.ok) fails.push(`set: ${why(e1)}`);
        if (round) {
          playFails(round, fails);
          if (round.play?.ok && !answeredInPlay(os))
            fails.push(`outputStates in play: ${os ? why(os) : "not answered"}`);
        }
        if (!same(start, end))
          fails.push(`not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`);
        const observed = {
          format: ".afm",
          describe: d.ok ? (rb(d).rootClass ?? "ok") : S(d.code),
          limit: lim.value,
          limitPath: lim.path,
          outputStates: os?.ok ? rb(os) : S(os?.code),
        };
        const p3 = !d.ok
          ? killed("P-W5-03", observed, `.afm: not loaded (${why(d)}): .afm writes stay dry run`)
          : near(lim.value, 3)
            ? settled("P-W5-03", observed, ".afm: loaded with limit 3")
            : partial(
                "P-W5-03",
                observed,
                `.afm: loaded (${S(rb(d).rootClass)}); limit not read back by any path form`,
              );
        return { ...verdictOf(fails, [p3], ".afm edit loaded"), evidence, probes: [p3] };
      },
    },
    {
      id: "w5-44-accept-sig",
      block: "W5.4",
      title:
        "the .sig compiled block (P-W5-04) and the .sig accept (P-W5-03 .sig): setSimValue on the offline .sig copy (shipped gates: READ_ONLY_SOURCE; probe gates: SIG_COMPILED_STALE; acceptStale: written), then Workbench loads it; the copy restored",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "with the shipped gates READ_ONLY_SOURCE (nothing written); with the probe gates the compiled block is detected (SIG_COMPILED_STALE, nothing written); with acceptStale the edit writes, describe answers AudioSignalResClass and the input's value reads 5; the inverse returns the copy byte-identical",
      kill_criterion:
        "P-W5-04: the edit is written and the compiled block cannot be detected offline (.sig read-only, READ_ONLY_SOURCE); P-W5-03 (.sig): LoadContainer null, a parse error, or a modal",
      side_effects: [`${OFF_SIG} edited, registered (+ .meta), restored`],
      rollback: "setSimValue back (probe gates, acceptStale); `rollback` removes the files",
      probes: ["P-W5-03", "P-W5-04"],
      writes: [OFF_SIG, metaRelOf(OFF_SIG)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_resources", "register", { path: OFF_SIG, confirm: true }),
        tc("wb_container", "describe", { target: `path:${OFF_SIG}` }),
        tc("wb_container", "get", {
          target: `path:${OFF_SIG}`,
          path: "<input countdownValue value>",
        }),
      ],
      offlineCalls: () => [
        oc("audio", "setSimValue", {
          path: OFF_SIG,
          node: "countdownValue",
          value: 5,
          confirm: true,
        }),
        oc("audio", "setSimValue", {
          path: OFF_SIG,
          node: "countdownValue",
          value: 5,
          confirm: true,
          probeGates: true,
        }),
        oc("audio", "setSimValue", {
          path: OFF_SIG,
          node: "countdownValue",
          value: 5,
          confirm: true,
          acceptStale: true,
          probeGates: true,
        }),
        oc("audio", "setSimValue", {
          path: OFF_SIG,
          node: "countdownValue",
          value: 3,
          confirm: true,
          acceptStale: true,
          probeGates: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const start = bytesOf(ctx, OFF_SIG);
        const base = {
          action: "setSimValue",
          path: OFF_SIG,
          node: "countdownValue",
          confirm: true,
        };
        const shipped = await ctx.offline("audio", { ...base, value: 5 });
        const afterShipped = bytesOf(ctx, OFF_SIG);
        const probe = await ctx.offline("audio", { ...base, value: 5, probeGates: true });
        const afterProbe = bytesOf(ctx, OFF_SIG);
        const stale = await ctx.offline("audio", {
          ...base,
          value: 5,
          acceptStale: true,
          probeGates: true,
        });
        const edited = bytesOf(ctx, OFF_SIG);
        await registerCopy(ctx, OFF_SIG, evidence, fails);
        const T = `path:${OFF_SIG}`;
        const d = await ctx.tool("wb_container", { action: "describe", target: T });
        const val = await getAny(ctx, T, [
          "Inputs[0].value",
          "Inputs.0.value",
          "Inputs[IOPItemInputClass].value",
        ]);
        const inv = await ctx.offline("audio", {
          ...base,
          value: 3,
          acceptStale: true,
          probeGates: true,
        });
        const end = bytesOf(ctx, OFF_SIG);
        Object.assign(evidence, {
          shippedGates: brief(shipped, 800),
          probeGates: brief(probe, 800),
          acceptStale: brief(stale, 1500),
          editDiff: diffOf(start, edited),
          describe: brief(d, 1500),
          value: val,
          inverse: brief(inv, 400),
          restoredIdentical: same(start, end),
        });
        if (shipped.ok || shipped.code !== "READ_ONLY_SOURCE")
          fails.push(
            `shipped gates answered ${shipped.ok ? "ok" : S(shipped.code)}, not READ_ONLY_SOURCE`,
          );
        if (!same(start, afterShipped)) fails.push("the shipped-gate refusal wrote");
        if (!probe.ok && !same(start, afterProbe))
          fails.push("the SIG_COMPILED_STALE refusal wrote");
        if (!stale.ok) fails.push(`acceptStale write: ${why(stale)}`);
        if (!same(start, end)) {
          fails.push(`not restored byte-identical: ${JSON.stringify(diffOf(start, end))}`);
          if (start) ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, OFF_SIG), start);
        }
        const o4 = {
          probeGatesCode: probe.ok ? "written" : S(probe.code),
          compiledBlockInFile: /\bcompiled\s+IOPCompiledClass\b/.test(
            start?.toString("utf-8") ?? "",
          ),
          editDiff: diffOf(start, edited),
        };
        const p4 =
          probe.code === "SIG_COMPILED_STALE"
            ? settled(
                "P-W5-04",
                o4,
                "the tool detects the compiled block offline and refuses SIG_COMPILED_STALE",
              )
            : probe.ok && o4.compiledBlockInFile
              ? killed(
                  "P-W5-04",
                  o4,
                  "the edit was written over a compiled block that the tool did not detect: .sig writes stay READ_ONLY_SOURCE",
                )
              : partial(
                  "P-W5-04",
                  o4,
                  `probe gates answered ${probe.ok ? "ok" : S(probe.code)}; the graph-versus-compiled half needs an .acp playing the copy`,
                );
        const o3 = {
          format: ".sig",
          describe: d.ok ? (rb(d).rootClass ?? "ok") : S(d.code),
          value: val.value,
          valuePath: val.path,
        };
        const p3 = !d.ok
          ? killed("P-W5-03", o3, `.sig: not loaded (${why(d)}): .sig writes stay dry run`)
          : near(val.value, 5)
            ? settled("P-W5-03", o3, ".sig: loaded with the input's value 5")
            : partial(
                "P-W5-03",
                o3,
                `.sig: loaded (${S(rb(d).rootClass)}); the value not read back by any path form`,
              );
        return { ...verdictOf(fails, [p3, p4], ".sig accept"), evidence, probes: [p3, p4] };
      },
    },
    {
      id: "w5-45-accept-graph",
      block: "W5.4",
      title:
        "offline graph authoring (P-W5-05) on the graph copy: the five graph actions as dry runs (probe gates), then addNode, connect (bank to sound, sound to mixer) and group applied in process, the sound's outState set; Workbench loads it and plays the new event; the inverse ops and a byte compare",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "each dry run answers ok and writes nothing; after the applied ops the new id keeps the SoundClass code and every link points at a node; describe answers AudioClass; play of EMCP_probe answers a handle != 0 while the unedited SOUND_MUSIC_RALLY plays; removeNode of the new node and the group returns the original bytes",
      kill_criterion:
        "P-W5-05: load fails, or play answers 0 for EMCP_probe while the unedited event plays: the graph actions are not built and their rows go W8",
      side_effects: [
        `${OFF_GRAPH} edited (graph ops written by this process), registered (+ .meta), restored`,
      ],
      rollback:
        "removeNode of what was added; the original bytes written back if the inverse differs",
      probes: ["P-W5-05"],
      writes: [OFF_GRAPH, metaRelOf(OFF_GRAPH)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...worldPlan(),
        tc("wb_resources", "register", { path: OFF_GRAPH, confirm: true }),
        tc("wb_container", "describe", { target: `path:${OFF_GRAPH}` }),
        tc("wb_audio", "play", {
          resource: "<W5_graph.acp resource name>",
          eventName: "EMCP_probe",
        }),
        tc("wb_audio", "play", {
          resource: "<W5_graph.acp resource name>",
          eventName: RALLY_EVENT,
        }),
        tc("wb_audio", "stop", { handle: "<handle>" }),
      ],
      offlineCalls: () => [
        ...GRAPH_DRY_RUNS.map((g) =>
          oc("audio", g.action, { path: OFF_GRAPH, args: g.args, probeGates: true }),
        ),
        oc("audio", "set", {
          path: OFF_GRAPH,
          node: "EMCP_probe",
          key: "outState",
          value: RALLY_MIXER_ID,
          confirm: true,
        }),
        oc("audio", "set", {
          path: OFF_GRAPH,
          node: "EMCP_probe",
          key: "outStatePort",
          value: RALLY_MIXER_PORT,
          confirm: true,
        }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const start = bytesOf(ctx, OFF_GRAPH);
        const dryRuns: Raw = {};
        for (const g of GRAPH_DRY_RUNS) {
          const r = await ctx.offline("audio", {
            action: g.action,
            path: OFF_GRAPH,
            args: g.args,
            probeGates: true,
          });
          dryRuns[g.action] = brief(r, 1200);
          if (!r.ok) fails.push(`${g.action} dry run: ${why(r)}`);
        }
        if (!same(start, bytesOf(ctx, OFF_GRAPH))) fails.push("a graph dry run wrote");
        // The ops applied in process (AUDIO_GRAPH_PROVEN keeps the tool's confirm GATED until this
        // probe passes): the same applyGraphOp the tool dispatches to, on the copy's bytes.
        const applied = start
          ? applyProbeGraph(start)
          : {
              ok: false,
              steps: {},
              bytes: null,
              newId: null,
              groupId: null,
              problems: ["no bytes"],
            };
        evidence.applied = {
          ok: applied.ok,
          steps: applied.steps,
          newId: applied.newId,
          groupId: applied.groupId,
          problems: applied.problems,
        };
        if (applied.bytes) ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, OFF_GRAPH), applied.bytes);
        const o1 = applied.ok
          ? await ctx.offline("audio", {
              action: "set",
              path: OFF_GRAPH,
              node: "EMCP_probe",
              key: "outState",
              value: RALLY_MIXER_ID,
              confirm: true,
            })
          : null;
        const o2 = applied.ok
          ? await ctx.offline("audio", {
              action: "set",
              path: OFF_GRAPH,
              node: "EMCP_probe",
              key: "outStatePort",
              value: RALLY_MIXER_PORT,
              confirm: true,
            })
          : null;
        const edited = bytesOf(ctx, OFF_GRAPH);
        const name = applied.ok ? await registerCopy(ctx, OFF_GRAPH, evidence, fails) : "";
        const d = name
          ? await ctx.tool("wb_container", { action: "describe", target: `path:${OFF_GRAPH}` })
          : null;
        const playable = !ctx.killed("P-W5-06") && !!name;
        const pn = playable
          ? await ctx.tool("wb_audio", { action: "play", resource: name, eventName: "EMCP_probe" })
          : null;
        const pu = playable
          ? await ctx.tool("wb_audio", { action: "play", resource: name, eventName: RALLY_EVENT })
          : null;
        for (const p of [pn, pu]) {
          const h = N(rb(p).handle);
          if (h !== null && h > 0) await ctx.tool("wb_audio", { action: "stop", handle: h });
        }
        // The inverse: removeNode of the group and the new node (their links go with them), then
        // the two outState keys go with the node. A difference is recorded and the original bytes
        // are written back (the copy lies under _throwaway/W5/off/).
        const inverse =
          edited && applied.newId !== null
            ? invertProbeGraph(edited, applied.newId, applied.groupId)
            : null;
        const restored = !!inverse?.bytes && !!start && inverse.bytes.equals(start);
        if (start) ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, OFF_GRAPH), start);
        Object.assign(evidence, {
          dryRuns,
          outState: [brief(o1, 400), brief(o2, 400)],
          editDiff: diffOf(start, edited),
          describe: brief(d, 1500),
          playNew: brief(pn),
          playUnedited: brief(pu),
          inverse: inverse
            ? { steps: inverse.steps, identical: restored, diff: diffOf(start, inverse.bytes) }
            : null,
        });
        if (!applied.ok) fails.push(`the graph ops did not apply: ${applied.problems.join("; ")}`);
        if (o1 && !o1.ok) fails.push(`set outState: ${why(o1)}`);
        if (o2 && !o2.ok) fails.push(`set outStatePort: ${why(o2)}`);
        if (applied.ok && !restored) fails.push("the inverse ops do not return the original bytes");
        const observed = {
          newId: applied.newId,
          classCode: applied.newId !== null ? applied.newId & 1023 : null,
          problems: applied.problems,
          describe: d ? (d.ok ? (rb(d).rootClass ?? "ok") : S(d.code)) : "not sent",
          playNew: pn ? (rb(pn).handle ?? S(pn.code)) : "not sent",
          playUnedited: pu ? (rb(pu).handle ?? S(pu.code)) : "not sent",
        };
        const p5 = !applied.ok
          ? killed(
              "P-W5-05",
              observed,
              "the id scheme or the ops could not be applied to the corpus file",
            )
          : d && !d.ok
            ? killed("P-W5-05", observed, `the engine did not load the authored graph (${why(d)})`)
            : pn && !N(rb(pn).handle) && N(rb(pu).handle)
              ? killed(
                  "P-W5-05",
                  observed,
                  "EMCP_probe does not play while the unedited event does: the graph rows go W8",
                )
              : pn && N(rb(pn).handle)
                ? settled("P-W5-05", observed, "the authored node loads and plays")
                : partial(
                    "P-W5-05",
                    observed,
                    "loaded; play not judged (P-W5-06 killed or not sent)",
                  );
        return {
          ...verdictOf(fails, [p5], "graph authored, loaded and played"),
          evidence,
          probes: [p5],
        };
      },
    },
    {
      id: "w5-46-accept-navmesh",
      block: "W5.4",
      title:
        "navmesh overrideConfig (dry run) of a vanilla Navmesh_*.conf with another NavmeshFile; its planned text written to a throwaway copy; Workbench loads the copy and reads NavmeshFile back",
      risk: "mutating",
      timeout_ms: 120_000,
      expected:
        "the dry run writes nothing at the game file's path and plans text differing from the vanilla file in the NavmeshFile line only; after register, a get of NavmeshFile on the copy reads LowResArland.nmn; navmesh config reads the same offline",
      kill_criterion:
        "no probe: the planned text does not load or reads another NavmeshFile: FAIL (navmesh.overrideConfig stays dry run plus a LoadContainer accept, P-W5-01's repoint)",
      side_effects: [`${OFF_NAV} written by this process (+ .meta)`],
      rollback: "`rollback` removes the files",
      probes: [],
      writes: [OFF_NAV, metaRelOf(OFF_NAV)],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        tc("wb_resources", "register", { path: OFF_NAV, confirm: true }),
        tc("wb_container", "get", { target: `path:${OFF_NAV}`, path: "NavmeshFile" }),
      ],
      offlineCalls: () => [
        oc("navmesh", "overrideConfig", { path: VANILLA_NAV_CONF, navmeshFile: NAV_OVERRIDE_REF }),
        oc("navmesh", "config", { path: OFF_NAV }),
      ],
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const projectCopy = abs(ctx.opts.sandboxDir, VANILLA_NAV_CONF);
        const existed = ctx.deps.exists(projectCopy);
        const ov = await ctx.offline("navmesh", {
          action: "overrideConfig",
          path: VANILLA_NAV_CONF,
          navmeshFile: NAV_OVERRIDE_REF,
        });
        const text = S(rb(ov).text);
        if (!existed && ctx.deps.exists(projectCopy))
          fails.push("the dry run wrote at the game file's path");
        if (!ov.ok || !text)
          fails.push(`overrideConfig dry run: ${ov.ok ? "no planned text" : why(ov)}`);
        let get: ToolResponse | null = null;
        let cfg: ToolResponse | null = null;
        if (text) {
          ctx.deps.writeBytes(abs(ctx.opts.sandboxDir, OFF_NAV), Buffer.from(text, "utf-8"));
          await registerCopy(ctx, OFF_NAV, evidence, fails);
          get = await ctx.tool("wb_container", {
            action: "get",
            target: `path:${OFF_NAV}`,
            path: "NavmeshFile",
          });
          cfg = await ctx.offline("navmesh", { action: "config", path: OFF_NAV });
        }
        Object.assign(evidence, {
          overrideConfig: brief(ov, 2000),
          get: brief(get),
          config: brief(cfg, 1500),
        });
        if (get && (!get.ok || !S(rb(get).value).includes("LowResArland.nmn")))
          fails.push(`the engine reads NavmeshFile ${get.ok ? `'${S(rb(get).value)}'` : why(get)}`);
        if (cfg && !cfg.ok) fails.push(`navmesh config of the copy: ${why(cfg)}`);
        return {
          ...verdictOf(fails, [], "the planned config loads with the new NavmeshFile"),
          evidence,
        };
      },
    },
    {
      id: "w5-47-accept-create",
      block: "W5.4",
      title:
        "audio create (.acp, .afm, variables .conf) and particle create (.ptc): dry run, then confirm under _throwaway/W5/created/; each registered and loaded",
      risk: "mutating",
      timeout_ms: 150_000,
      expected:
        "each dry run writes no file; each confirm writes the skeleton; register and describe answer the root class (AudioClass, AudioOutputStateResClass, AudioVariablesClass, EffectDef)",
      kill_criterion:
        "no probe (P-W5-02 records the skeleton accept): a create that does not write or does not load: FAIL with the item",
      side_effects: [`${CREATED_DIR}/ skeletons (+ .meta)`],
      rollback: "`rollback` removes the files",
      probes: [],
      writes: [CREATED_ACP, CREATED_AFM, CREATED_VARS, CREATED_PTC, CREATED_DIR],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () =>
        CREATES.flatMap((c) => [
          tc("wb_resources", "register", { path: c.path, confirm: true }),
          tc("wb_container", "describe", { target: `path:${c.path}` }),
        ]),
      offlineCalls: () =>
        CREATES.flatMap((c) => [
          oc(c.tool, "create", { path: c.path, ...c.extra }),
          oc(c.tool, "create", { path: c.path, ...c.extra, confirm: true }),
        ]),
      run: async (ctx) => {
        await ensureFixturesOnDisk(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const verdicts: Raw = {};
        for (const c of CREATES) {
          const item: string[] = [];
          const ev: Raw = {};
          const existed = !!bytesOf(ctx, c.path);
          const dry = await ctx.offline(c.tool, { action: "create", path: c.path, ...c.extra });
          if (!existed && bytesOf(ctx, c.path)) item.push("the dry run wrote");
          const conf = existed
            ? null
            : await ctx.offline(c.tool, {
                action: "create",
                path: c.path,
                ...c.extra,
                confirm: true,
              });
          if (conf && !conf.ok) item.push(`create ${why(conf)}`);
          if (!bytesOf(ctx, c.path)) item.push("no file after create");
          else {
            await registerCopy(ctx, c.path, ev, item);
            const d = await ctx.tool("wb_container", {
              action: "describe",
              target: `path:${c.path}`,
            });
            ev.describe = brief(d, 800);
            if (!d.ok) item.push(`not loaded: ${why(d)}`);
            else if (S(rb(d).rootClass) && S(rb(d).rootClass) !== c.rootClass)
              item.push(`root class ${S(rb(d).rootClass)}, not ${c.rootClass}`);
          }
          Object.assign(ev, { dry: brief(dry, 600), confirm: brief(conf, 600), existed });
          evidence[c.path] = ev;
          verdicts[c.path] = item.length ? `FAIL: ${item.join(", ")}` : "PASS";
          if (item.length) fails.push(`${c.path}: ${item.join(", ")}`);
        }
        evidence.perItem = verdicts;
        return {
          ...verdictOf(fails, [], `${CREATES.length} skeletons created and loaded`),
          evidence,
        };
      },
    },

    // ── W5.5 navmesh on the throwaway world (P-W5-11, P-W5-15) ──
    {
      id: "w5-50-nav-status",
      block: "W5.5",
      title:
        "wb_navmesh status and tile on the throwaway world (P-W5-11): the AIWorld reached in edit mode",
      risk: "read-only",
      timeout_ms: 120_000,
      expected:
        "status answers aiWorld (GetAIWorld or the entity scan), component true for the first navmesh project, bounds; tile at the origin answers loaded/valid/requested",
      kill_criterion:
        "P-W5-11: NO_AI_WORLD by both routes in edit mode: wb_navmesh moves to play mode; the offline navmesh status stays the oracle",
      side_effects: [],
      rollback: "none",
      probes: ["P-W5-11"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_navmesh", "status", { limit: 50 }),
        tc("wb_navmesh", "tile", { position: "0 0 0" }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const st = await ctx.tool("wb_navmesh", { action: "status", limit: 50 });
        const tl = await ctx.tool("wb_navmesh", { action: "tile", position: "0 0 0" });
        Object.assign(evidence, { status: brief(st), tile: brief(tl) });
        const observed = {
          code: st.ok ? null : S(st.code),
          aiWorld: rb(st).aiWorld ?? null,
          aiWorldClass: rb(st).aiWorldClass ?? null,
          aiWorldFrom: rb(st).aiWorldFrom ?? null,
          component: rb(st).component ?? null,
          boundsMin: rb(st).boundsMin ?? null,
          boundsMax: rb(st).boundsMax ?? null,
          projects: rb(st).projects ?? null,
        };
        const p11 = !st.ok
          ? st.code === "NO_AI_WORLD"
            ? killed(
                "P-W5-11",
                observed,
                "no AIWorld in edit mode by either route: wb_navmesh moves to play mode",
              )
            : partial("P-W5-11", observed, `status refused ${why(st)}`)
          : rb(st).component === true || rb(st).component === "true"
            ? settled(
                "P-W5-11",
                observed,
                `AIWorld ${S(rb(st).aiWorldClass)} reached in edit mode with its component`,
              )
            : partial(
                "P-W5-11",
                observed,
                "AIWorld reached; no navmesh component for the first project",
              );
        if (!tl.ok && tl.code !== "NO_NAVMESH_COMPONENT") fails.push(`tile: ${why(tl)}`);
        return {
          ...verdictOf(fails, [p11], `aiWorld ${S(rb(st).aiWorld)}`),
          evidence,
          probes: [p11],
        };
      },
    },
    {
      id: "w5-51-nav-rebuild",
      block: "W5.5",
      title:
        "wb_navmesh rebuild of a 64 m box (dry run, then confirm), a box over 512 m refused, rebuildEntity of a prop (dry run, then confirm) on the throwaway world (P-W5-15); tile and files before and after",
      risk: "mutating",
      timeout_ms: 180_000,
      expected:
        "the box over 512 m answers BOX_TOO_LARGE (nothing sent); the dry runs answer dryRun; the confirms answer requested and carry the weak-oracle warning (fix-up 1: P-W5-15 KILLED in run 1 with no observable change, its repoint); the tile state is recorded; no file of the sandbox changes (in-memory only); the world saved",
      kill_criterion:
        "P-W5-15: a crash or a modal (rebuild and rebuildEntity dropped, rows to the W8 Navmesh Tool); no observable change at all (rebuild stays with a weak oracle and a warning: applied in fix-up 1, so that outcome is recorded, not a KILLED step)",
      side_effects: [
        "a navmesh rebuild requested in memory on the throwaway world; the world saved",
      ],
      rollback: "none in memory (nothing is saved but the throwaway world); `rollback` removes it",
      probes: ["P-W5-15"],
      dependsOn: ["P-W5-11"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_navmesh", "tile", { position: "0 0 0" }),
        tc(
          "wb_navmesh",
          "rebuild",
          { min: TOO_LARGE_MIN, max: TOO_LARGE_MAX, confirm: true },
          {
            note: "refused BOX_TOO_LARGE by the TS before sending",
          },
        ),
        tc("wb_navmesh", "rebuild", { min: REBUILD_MIN, max: REBUILD_MAX }),
        tc("wb_navmesh", "rebuild", { min: REBUILD_MIN, max: REBUILD_MAX, confirm: true }),
        tc("wb_navmesh", "tile", { position: "0 0 0" }),
        tc("wb_navmesh", "rebuildEntity", { entity: `name:${BOX_NAMES[0]}` }),
        tc("wb_navmesh", "rebuildEntity", { entity: `name:${BOX_NAMES[0]}`, confirm: true }),
        tc("wb_navmesh", "status", { limit: 50 }),
        ...saveThrowawayPlan("the world saved after the rebuild"),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const hashBefore = sandboxHashes(ctx.opts.sandboxDir, ctx.deps);
        const t0 = await ctx.tool("wb_navmesh", { action: "tile", position: "0 0 0" });
        const big = await ctx.tool("wb_navmesh", {
          action: "rebuild",
          min: TOO_LARGE_MIN,
          max: TOO_LARGE_MAX,
          confirm: true,
        });
        const dry = await ctx.tool("wb_navmesh", {
          action: "rebuild",
          min: REBUILD_MIN,
          max: REBUILD_MAX,
        });
        const rq = await ctx.tool("wb_navmesh", {
          action: "rebuild",
          min: REBUILD_MIN,
          max: REBUILD_MAX,
          confirm: true,
        });
        await ctx.sleep(5_000);
        const t1 = await ctx.tool("wb_navmesh", { action: "tile", position: "0 0 0" });
        const ed = await ctx.tool("wb_navmesh", {
          action: "rebuildEntity",
          entity: `name:${BOX_NAMES[0]}`,
        });
        const ec = await ctx.tool("wb_navmesh", {
          action: "rebuildEntity",
          entity: `name:${BOX_NAMES[0]}`,
          confirm: true,
        });
        const st = await ctx.tool("wb_navmesh", { action: "status", limit: 50 });
        const sv = await saveThrowaway(ctx);
        const changed = changedFiles(
          hashBefore,
          sandboxHashes(ctx.opts.sandboxDir, ctx.deps),
        ).filter((f) => !NETZERO_TOLERATED.includes(f));
        Object.assign(evidence, {
          tileBefore: brief(t0),
          tooLarge: brief(big),
          dry: brief(dry),
          rebuild: brief(rq),
          tileAfter: brief(t1),
          rebuildEntityDry: brief(ed),
          rebuildEntity: brief(ec),
          statusAfter: brief(st, 2000),
          save: sv,
          filesChangedOutsideW5: changed,
        });
        if (big.ok || big.code !== "BOX_TOO_LARGE")
          fails.push(`the 600 m box answered ${big.ok ? "ok" : S(big.code)}`);
        if (!dry.ok || rb(dry).dryRun !== true)
          fails.push(`rebuild dry run: ${dry.ok ? "dryRun not true" : why(dry)}`);
        if (!ed.ok && ed.code !== "NOT_SCR_AI_WORLD")
          fails.push(`rebuildEntity dry run: ${why(ed)}`);
        if (!sv?.ok) fails.push("the throwaway world was not saved");
        const flags = (r: ToolResponse) =>
          `${S(rb(r).loaded)}/${S(rb(r).valid)}/${S(rb(r).requested)}`;
        const observed = {
          code: rq.ok ? null : S(rq.code),
          requested: rb(rq).requested ?? null,
          tileBefore: t0.ok ? flags(t0) : S(t0.code),
          tileAfter: t1.ok ? flags(t1) : S(t1.code),
          rebuildEntity: ec.ok ? rb(ec) : S(ec.code),
          persisted: changed,
        };
        const moved = t0.ok && t1.ok && flags(t0) !== flags(t1);
        // Fix-up 1 applied P-W5-15's no-change repoint: each confirmed request carries the warning.
        for (const [k, x] of [
          ["rebuild", rq],
          ["rebuildEntity", ec],
        ] as const)
          if (x.ok && rb(x).requested === true && !(x.warnings ?? []).includes(REBUILD_WEAK_ORACLE))
            fails.push(`${k} confirmed without the weak-oracle warning (P-W5-15 repoint)`);
        const p15 = !rq.ok
          ? partial("P-W5-15", observed, `rebuild refused ${why(rq)}`)
          : moved || rb(t1).requested === true
            ? settled(
                "P-W5-15",
                observed,
                `request accepted; tile ${observed.tileBefore} -> ${observed.tileAfter}; ${changed.length ? `files changed: ${changed.join(", ")}` : "no file changed (in memory only)"}`,
              )
            : killed(
                "P-W5-15",
                observed,
                `no observable change at all: rebuild stays with a weak oracle and a warning (applied in fix-up 1; tile ${observed.tileBefore} -> ${observed.tileAfter})`,
              );
        // The no-change kill is applied (the warning above), so it no longer makes the step KILLED;
        // a crash or a modal would have stopped the step before this line.
        return {
          ...verdictOf(fails, [], `rebuild requested; P-W5-15 ${p15.result}`),
          evidence,
          probes: [p15],
        };
      },
    },

    // ── W5.6 navmesh on a vanilla world, read-only (P-W5-13, P-W5-14) ──
    {
      id: "w5-60-nav-vanilla",
      block: "W5.6",
      title:
        "a vanilla world with a baked navmesh opened read-only (GM_Arland, never saved): status paged twice and a stale cursor, tile, load, tile again, reachable (P-W5-13, P-W5-14); then the throwaway world reopened (fix-up 1: run 1 ended with GM_Arland open); fix-up 2: each world switch waits until no Workbench window is busy (disabled, unowned), the runner judging a busy window by its lifetime (run 2 cut here on the load's tool window)",
      risk: "reversible",
      timeout_ms: TIMEOUTS.open + 180_000,
      expected:
        "the throwaway world is saved before the switch; status pages with nextCursor; a cursor of another total answers STALE_CURSOR; a grid point reads valid where offline tiles exist; load then tile reads loaded within the poll; reachable answers found true with a point that differs from the input; the throwaway world is open again at the end (GM_Arland unsaved)",
      kill_criterion:
        "P-W5-13: all false everywhere (tile and load move to play mode, the grid is dropped); P-W5-14: the point equals the zero vector or the input (reachable answers found only)",
      side_effects: [
        "the World Editor switches to the vanilla world (unedited; tiles loaded in memory), then back to the throwaway world",
      ],
      rollback:
        "the throwaway world reopened in a finally path (a restorer from before the vanilla open); GM_Arland is never saved",
      probes: ["P-W5-13", "P-W5-14"],
      dependsOn: ["P-W5-11"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...saveThrowawayPlan("the throwaway world saved before the switch"),
        ...openPlan(VANILLA_NAV_WORLD),
        tc("wb_navmesh", "status", { limit: 100 }),
        tc("wb_navmesh", "status", { limit: 100, cursor: "<nextCursor>" }),
        tc("wb_navmesh", "status", { cursor: "0:<total+5>" }),
        tc("wb_navmesh", "tile", { position: "<a valid grid point>" }),
        tc("wb_navmesh", "load", { position: "<a valid grid point>" }),
        tc("wb_navmesh", "tile", { position: "<a valid grid point>" }),
        tc("wb_navmesh", "reachable", { position: "<the point + 3 m>", distance: "20" }),
        ...openPlan(WORLD),
      ],
      offlineCalls: () => [oc("navmesh", "tiles", { path: VANILLA_NMN, limit: 1 })],
      run: async (ctx) => {
        const evidence: Raw = {};
        const fails: string[] = [];
        evidence.saveBefore = await saveThrowaway(ctx);
        // Fix-up 1: run 1 was cut in this step (a dialog-like window during the GM_Arland load) and
        // ended with the vanilla world open. The throwaway world is owed back from before the
        // switch (a restorer, run after a stop that is not a dialog, LOST or WEDGED) and reopened
        // in the finally path below; GM_Arland is never saved (saveThrowaway saves only WORLD).
        const owedBack = {
          label: `reopen ${WORLD}`,
          fn: () =>
            ctx.deps.tool("wb_module", {
              action: "setResource",
              module: "WorldEditor",
              target: `path:${WORLD}`,
            }),
        };
        ctx.debt.restorers.push(owedBack);
        try {
          return await vanillaReads(ctx, evidence, fails);
        } finally {
          if (!ctx.signal.aborted) {
            const back = await openWorld(ctx, WORLD);
            evidence.reopen = back.evidence;
            const i = ctx.debt.restorers.indexOf(owedBack);
            if (i >= 0) ctx.debt.restorers.splice(i, 1);
            if (!back.ok)
              throw new StopBattery(
                "stopped",
                `${WORLD} did not reopen after ${VANILLA_NAV_WORLD} ('${back.worldPath}')`,
                evidence,
              );
          }
        }
      },
    },

    // ── W5.7 Audio Editor (P-W5-12) ──
    {
      id: "w5-70-audio-editor",
      block: "W5.7",
      title:
        "wb_audio open: dry runs of the .acp and .sig fixtures, the .afm and a .ptc refused WRONG_MODULE before sending, the confirm GATED (P-W5-12); the Audio Editor module opened and fronted, close refused, no modal",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "the dry runs answer dryRun with module AudioEditor and open nothing; .afm (owner ResourceManager until OD-3) and .ptc answer WRONG_MODULE with nothing sent; the confirm answers GATED; wb_module open AudioEditor adds an 'Audio Editor' window; wb_gui modals lists no modal; front answers; close is refused",
      kill_criterion:
        "P-W5-12 half: a modal or a crash on the module open; a dry run that opens a window; the confirm half needs the probe build (OPEN_PROVEN)",
      side_effects: [
        "the Audio Editor module window opened (no document); it stays until Workbench closes",
      ],
      rollback: "none: the module holds no document (close is refused, DEC-045)",
      probes: ["P-W5-12"],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        tc("wb_audio", "open", { path: FX_ACP }),
        tc("wb_audio", "open", { path: FX_SIG }),
        tc(
          "wb_audio",
          "open",
          { path: FX_AFM },
          { note: "refused WRONG_MODULE by the TS before sending (OD-3)" },
        ),
        tc(
          "wb_audio",
          "open",
          { path: FX_PTC },
          { note: "refused WRONG_MODULE by the TS before sending" },
        ),
        tc(
          "wb_audio",
          "open",
          { path: FX_ACP, confirm: true },
          { note: "refused GATED by the TS before sending (P-W5-12)" },
        ),
        tc("wb_module", "open", { moduleName: "AudioEditor" }),
        tc("wb_gui", "modals", { pid: "<the Workbench pid>" }),
        tc("wb_module", "front", { moduleName: "AudioEditor" }),
        tc("wb_module", "close", { moduleName: "AudioEditor" }, { note: "refused (DEC-045)" }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        const pid = ctx.deps.recordedPid() ?? 0;
        const w0 = (await ctx.deps.windows()).filter((w) => w.pid === pid).map((w) => w.title);
        const d1 = await ctx.tool("wb_audio", { action: "open", path: FX_ACP });
        const d2 = await ctx.tool("wb_audio", { action: "open", path: FX_SIG });
        const w1 = (await ctx.deps.windows()).filter((w) => w.pid === pid).map((w) => w.title);
        const r1 = await ctx.tool("wb_audio", { action: "open", path: FX_AFM });
        const r2 = await ctx.tool("wb_audio", { action: "open", path: FX_PTC });
        const g = await ctx.tool("wb_audio", { action: "open", path: FX_ACP, confirm: true });
        const mo = await ctx.tool("wb_module", { action: "open", module: "AudioEditor" });
        await ctx.sleep(2_000);
        const w2 = (await ctx.deps.windows()).filter((w) => w.pid === pid).map((w) => w.title);
        const md = await ctx.tool("wb_gui", { action: "modals", pid });
        const mf = await ctx.tool("wb_module", { action: "front", module: "AudioEditor" });
        const mc = await ctx.tool("wb_module", { action: "close", module: "AudioEditor" });
        Object.assign(evidence, {
          windowsBefore: w0,
          dryAcp: brief(d1),
          drySig: brief(d2),
          windowsAfterDryRuns: w1,
          afm: brief(r1),
          ptc: brief(r2),
          confirm: brief(g),
          moduleOpen: brief(mo),
          windowsAfterOpen: w2,
          modals: brief(md),
          front: brief(mf),
          close: brief(mc),
        });
        for (const [k, r] of [
          ["dry run .acp", d1],
          ["dry run .sig", d2],
        ] as const) {
          if (!r.ok) fails.push(`${k}: ${why(r)}`);
          else if (rb(r).dryRun !== true) fails.push(`${k}: not answered as a dry run`);
        }
        if (w1.length > w0.length)
          fails.push(`a dry run added a window: ${w1.filter((t) => !w0.includes(t)).join(", ")}`);
        if (r1.ok || r1.code !== "WRONG_MODULE")
          fails.push(`.afm answered ${r1.ok ? "ok" : S(r1.code)}, not WRONG_MODULE`);
        if (r2.ok || r2.code !== "WRONG_MODULE")
          fails.push(`.ptc answered ${r2.ok ? "ok" : S(r2.code)}, not WRONG_MODULE`);
        if (g.ok || g.code !== "GATED")
          fails.push(`the confirm answered ${g.ok ? "ok" : S(g.code)}, not GATED`);
        if (!mo.ok) fails.push(`wb_module open AudioEditor: ${why(mo)}`);
        if (!mf.ok) fails.push(`front: ${why(mf)}`);
        if (mc.ok) fails.push("wb_module close AudioEditor answered ok (DEC-045 refuses it)");
        const modals = Array.isArray(rb(md).modals) ? (rb(md).modals as unknown[]) : [];
        const editorShown = w2.some((t) => AUDIO_EDITOR_TITLE.test(t));
        const o12 = {
          moduleOpen: mo.ok ? "ok" : S(mo.code),
          audioEditorWindow: w2.filter((t) => AUDIO_EDITOR_TITLE.test(t)),
          modals,
          confirm: g.ok ? "ok" : S(g.code),
          afm: r1.ok ? "ok" : S(r1.code),
        };
        const p12 =
          modals.length > 0
            ? killed(
                "P-W5-12",
                o12,
                "a modal on the Audio Editor open: open is removed, the Open rows go W8",
              )
            : partial(
                "P-W5-12",
                o12,
                `the Audio Editor ${editorShown ? "opens" : "module answered"} with no modal; Workbench.OpenResource of an .acp/.sig/.afm stays GATED (OPEN_PROVEN false in EMCP_WB_Audio.c and wb-audio.ts): that half runs on a probe build`,
              );
        return {
          ...verdictOf(fails, [p12], "dry runs, refusals and the module open"),
          evidence,
          probes: [p12],
        };
      },
    },

    // ── W5.8 play mode (P-W5-10) ──
    {
      id: "w5-80-play-mode",
      block: "W5.8",
      title:
        "play mode (P-W5-10): an effect placed and the throwaway world saved; wb_world play; wb_audio play and masters, wb_particle stats, wb_navmesh status in play; wb_world stop back to edit; the effect removed and the world saved",
      risk: "mutating",
      timeout_ms: TIMEOUTS.open + 240_000,
      expected:
        "the calls answer in play mode (ok or a WRONG_MODE refusal: the handler answered); stop returns to edit mode; the effect removed and the world saved",
      kill_criterion:
        "P-W5-10: the handler NET queue does not answer during play, or stop does not return to edit mode: runtime rows that also failed in edit mode go not-automatable",
      side_effects: [
        `${FX_PLAY_NAME} placed and removed; play mode entered and left; ${WORLD} saved`,
      ],
      rollback: "wb_world stop in a finally path; remove; the save of the throwaway world",
      probes: ["P-W5-10"],
      writes: [WORLD],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc("wb_particle", "spawn", {
          effect: "<W5_fx.ptc resource name>",
          name: FX_PLAY_NAME,
          coords: "0 1 2",
          confirm: true,
        }),
        ...saveThrowawayPlan("the world saved before play"),
        tc("wb_world", "play", { debugMode: false, fullScreen: false }),
        tc("wb_world", "state"),
        tc("wb_audio", "masters"),
        tc("wb_audio", "play", { resource: V_PLAY_ACP, eventName: V_PLAY_EVENT }),
        tc("wb_audio", "stop", { handle: "<handle>" }),
        tc("wb_particle", "stats", { entity: `name:${FX_PLAY_NAME}` }),
        tc("wb_navmesh", "status", { limit: 10 }),
        tc("wb_world", "stop"),
        tc("wb_world", "state"),
        tc("wb_particle", "remove", { entity: `name:${FX_PLAY_NAME}`, confirm: true }),
        ...saveThrowawayPlan(`the world saved without ${FX_PLAY_NAME}`),
      ],
      run: async (ctx) => {
        const fx = await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const sp = ctx.killed("P-W5-07")
          ? null
          : await ctx.tool("wb_particle", {
              action: "spawn",
              effect: fx[FX_PTC]!,
              name: FX_PLAY_NAME,
              coords: "0 1 2",
              confirm: true,
            });
        evidence.spawn = brief(sp);
        evidence.saveBefore = await saveThrowaway(ctx);
        let play: ToolResponse | null = null;
        let during: ToolResponse | null = null;
        let masters: ToolResponse | null = null;
        let aplay: ToolResponse | null = null;
        let astop: ToolResponse | null = null;
        let stats: ToolResponse | null = null;
        let nav: ToolResponse | null = null;
        let stop: ToolResponse | null = null;
        // The stop is owed from here: the runner sends it even when the step is cut.
        ctx.debt.restorers.push({
          label: "wb_world stop",
          fn: () => ctx.deps.tool("wb_world", { action: "stop" }),
        });
        try {
          play = await ctx.tool("wb_world", {
            action: "play",
            debugMode: false,
            fullScreen: false,
          });
          during = await ctx.tool("wb_world", { action: "state" });
          masters = await ctx.tool("wb_audio", { action: "masters" });
          aplay = await ctx.tool("wb_audio", {
            action: "play",
            resource: V_PLAY_ACP,
            eventName: V_PLAY_EVENT,
          });
          const h = N(rb(aplay).handle);
          if (h !== null && h > 0)
            astop = await ctx.tool("wb_audio", { action: "stop", handle: h });
          if (sp?.ok)
            stats = await ctx.tool("wb_particle", {
              action: "stats",
              entity: `name:${FX_PLAY_NAME}`,
            });
          nav = await ctx.tool("wb_navmesh", { action: "status", limit: 10 });
        } finally {
          if (!ctx.signal.aborted) {
            stop = await ctx.tool("wb_world", { action: "stop" }, { restore: true });
            ctx.debt.restorers.pop();
          }
        }
        const after = await ctx.tool("wb_world", { action: "state" });
        const rm = sp?.ok
          ? await ctx.tool("wb_particle", {
              action: "remove",
              entity: `name:${FX_PLAY_NAME}`,
              confirm: true,
            })
          : null;
        const sv = await saveThrowaway(ctx);
        Object.assign(evidence, {
          play: brief(play),
          stateDuringPlay: brief(during),
          masters: brief(masters),
          audioPlay: brief(aplay),
          audioStop: brief(astop),
          stats: brief(stats),
          navmesh: brief(nav),
          stop: brief(stop),
          stateAfter: brief(after),
          remove: brief(rm),
          saveAfter: sv,
        });
        const answered = (r: ToolResponse | null) => !!r && (r.ok || DOMAIN_CODES.has(S(r.code)));
        const observed = {
          playMode: rb(play).mode ?? null,
          stateDuringPlay: during?.ok ? (rb(during).mode ?? null) : S(during?.code),
          masters: masters?.ok ? rb(masters).masters : S(masters?.code),
          audioPlay: aplay?.ok ? rb(aplay).handle : S(aplay?.code),
          particleStats: stats ? (stats.ok ? rb(stats).emitters : S(stats.code)) : "not sent",
          navmesh: nav?.ok ? (rb(nav).aiWorld ?? "ok") : S(nav?.code),
          modeAfter: rb(after).mode ?? null,
        };
        const net = [during, masters, aplay, nav].every(answered);
        const backInEdit = !!stop?.ok && S(rb(after).mode) === "edit";
        const p10 = !play?.ok
          ? partial("P-W5-10", observed, `play did not start: ${play ? why(play) : "not sent"}`)
          : !net || !backInEdit
            ? killed(
                "P-W5-10",
                observed,
                !net
                  ? "the handler NET queue did not answer during play"
                  : "stop did not return to edit mode",
              )
            : masters?.ok && aplay?.ok
              ? settled("P-W5-10", observed, "the runtime calls answer in play mode; back in edit")
              : partial(
                  "P-W5-10",
                  observed,
                  "the handlers answered in play (some refused WRONG_MODE by design); back in edit",
                );
        if (!backInEdit) fails.push(`not back in edit mode (${S(rb(after).mode)})`);
        if (sp && !sp.ok) fails.push(`spawn of ${FX_PLAY_NAME}: ${why(sp)}`);
        if (sp?.ok && !rm?.ok) fails.push(`remove ${FX_PLAY_NAME}: ${rm ? why(rm) : "not sent"}`);
        if (!sv?.ok) fails.push("the throwaway world was not saved");
        return { ...verdictOf(fails, [p10], "play round trip"), evidence, probes: [p10] };
      },
    },

    // ── W5.9 aliases ──
    {
      id: "w5-90-aliases",
      block: "W5.9",
      title:
        "1.x names (OD-1): particle_inspect with particle_path (project, pak and absolute paths); terrain_navmesh_status (world_path refused, then the open world); wb_cli_run navmeshGenerate and navmeshBake refused (nothing spawned)",
      risk: "reversible",
      timeout_ms: 120_000,
      expected:
        "particle_inspect answers the inspect JSON for the three path forms; terrain_navmesh_status with world_path is refused, without it answers wb_navmesh status of the open world; navmeshGenerate answers NOT_ALLOWLISTED or MODULE_NOT_SUPPORTED and navmeshBake GATED, neither sent when its verb is allow-listed",
      kill_criterion: `a call fails other than the expected refusal: FAIL; a Workbench process spawned: FAIL; ${WINDOW_KILL}`,
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      expectsWindows: WORKBENCH_WINDOWS,
      plan: () => [
        ...fixturePlan(),
        ...worldPlan(),
        tc(
          "terrain_navmesh_status",
          "status",
          { world_path: WORLD },
          { note: "refused: world_path has no equivalent" },
        ),
        tc("terrain_navmesh_status", "status", { limit: 10 }),
      ],
      offlineCalls: () => [
        oc("particle_inspect", "inspect", { particle_path: FX_PTC }),
        oc("particle_inspect", "inspect", { particle_path: V_FX }),
        oc("particle_inspect", "inspect", { particle_path: "<absolute path of W5_fx.ptc>" }),
        oc("wb_cli_run", "navmeshGenerate", { target: WORLD }),
        oc("wb_cli_run", "navmeshBake", { target: WORLD, save_dir: `<sandbox>/${BAKE_DIR}` }),
      ],
      run: async (ctx) => {
        await ensureFixtures(ctx);
        const evidence: Raw = {};
        const fails: string[] = [];
        await ensureWorld(ctx, evidence, fails);
        const forms = [FX_PTC, V_FX, abs(ctx.opts.sandboxDir, FX_PTC)];
        const pis: Raw = {};
        for (const p of forms) {
          const r = await ctx.offline("particle_inspect", { action: "inspect", particle_path: p });
          pis[p === forms[2] ? "<absolute>" : p] = brief(r, 1200);
          if (!r.ok) fails.push(`particle_inspect ${p === forms[2] ? "<absolute>" : p}: ${why(r)}`);
        }
        const t1 = await ctx.tool("terrain_navmesh_status", {
          action: "status",
          world_path: WORLD,
        });
        const t2 = await ctx.tool("terrain_navmesh_status", { action: "status", limit: 10 });
        const gproj = abs(ctx.opts.sandboxDir, `${SANDBOX_NAME}.gproj`);
        const g1 = await ctx.offline("wb_cli_run", {
          action: "navmeshGenerate",
          gproj,
          target: WORLD,
        });
        const g2 = await ctx.offline("wb_cli_run", {
          action: "navmeshBake",
          gproj,
          target: WORLD,
          save_dir: abs(ctx.opts.sandboxDir, BAKE_DIR),
        });
        Object.assign(evidence, {
          particleInspect: pis,
          terrainWithWorldPath: brief(t1),
          terrain: brief(t2),
          navmeshGenerate: brief(g1),
          navmeshBake: brief(g2),
        });
        if (t1.ok) fails.push("terrain_navmesh_status with world_path answered ok (it is refused)");
        if (!t2.ok && !DOMAIN_CODES.has(S(t2.code)))
          fails.push(`terrain_navmesh_status: ${why(t2)}`);
        if (g1.ok || !["NOT_ALLOWLISTED", "MODULE_NOT_SUPPORTED", "NOT_SENT"].includes(S(g1.code)))
          fails.push(`navmeshGenerate answered ${g1.ok ? "ok" : S(g1.code)}`);
        if (g2.ok || !["GATED", "NOT_SENT"].includes(S(g2.code)))
          fails.push(`navmeshBake answered ${g2.ok ? "ok" : S(g2.code)}`);
        return { ...verdictOf(fails, [], "1.x names answer"), evidence };
      },
    },

    // ── W5.10 net-zero and close-out ──
    {
      id: "w5-95-netzero",
      block: "W5.10",
      title: "net-zero: the sandbox outside _throwaway/W5/ hashed against the battery's snapshot",
      risk: "read-only",
      timeout_ms: 60_000,
      expected:
        "no file outside _throwaway/W5/ changed (resourceDatabase.rdb recorded, not failed)",
      kill_criterion: "any other change: FAIL with the paths",
      side_effects: [],
      rollback: "none",
      probes: [],
      writes: [],
      plan: () => [],
      run: async (ctx) => {
        const nz = netZeroDiff(ctx.opts.sittingDir, ctx.opts.sandboxDir, ctx.deps);
        if (!nz)
          return {
            status: "NOT-RUN",
            detail: `no ${BATTERY_SNAPSHOT_FILE} in the sitting folder`,
            evidence: {},
          };
        const tolerated = nz.changed.filter((f) => NETZERO_TOLERATED.includes(f));
        const bad = nz.changed.filter((f) => !NETZERO_TOLERATED.includes(f));
        const evidence: Raw = {
          snapshotTakenBy: nz.takenBy,
          snapshotTakenAt: nz.takenAt,
          tolerated,
          changed: bad,
        };
        return {
          ...verdictOf(
            bad.length ? [`changed outside ${W5_ROOT}/: ${bad.join(", ")}`] : [],
            [],
            `net-zero outside ${W5_ROOT}/${tolerated.length ? ` (${tolerated.join(", ")} recorded)` : ""}${nz.takenBy === "run start" ? `; the snapshot was taken at the start of a resumed run (${nz.takenAt})` : ""}`,
          ),
          evidence,
        };
      },
    },
    closableStep(),
  ];
}

/** The text of a planted fixture, "" when absent. */
function textOfFixture(ctx: StepContext, rel: string): string {
  const b = bytesOf(ctx, rel);
  return b ? b.toString("utf-8") : "";
}

/** w5-47's creates: the offline skeletons and the root class the engine must answer. */
export const CREATES: ReadonlyArray<{
  tool: "audio" | "particle";
  path: string;
  rootClass: string;
  extra: Raw;
}> = [
  { tool: "audio", path: CREATED_ACP, rootClass: "AudioClass", extra: {} },
  { tool: "audio", path: CREATED_AFM, rootClass: "AudioOutputStateResClass", extra: {} },
  { tool: "audio", path: CREATED_VARS, rootClass: "AudioVariablesClass", extra: {} },
  { tool: "particle", path: CREATED_PTC, rootClass: "EffectDef", extra: { name: "EMCP_W5_Em" } },
];

/**
 * w5-45's dry runs of the five graph actions on the unedited graph copy (probe gates; nothing is
 * written): ids of Music_Rally's nodes (sound 69641 SOUND_MUSIC_RALLY, 72713 the menu sound, bank
 * 70660 All, mixer 6155).
 */
export const GRAPH_DRY_RUNS: ReadonlyArray<{ action: string; args: Raw }> = [
  { action: "addNode", args: { class: "SoundClass", name: "EMCP_probe", x: 512, y: 960 } },
  { action: "connect", args: { from: RALLY_BANK_ID, fromPort: 65, to: 72713, toPort: 64 } },
  { action: "disconnect", args: { from: RALLY_BANK_ID, to: 69641 } },
  { action: "group", args: { name: "EMCP_W5_Group", members: [69641, RALLY_BANK_ID] } },
  { action: "removeNode", args: { id: 78857, force: true } },
];

/** One applied graph sequence: the bytes, the new node and group ids, and what each op answered. */
export interface GraphApply {
  ok: boolean;
  bytes: Buffer | null;
  newId: number | null;
  groupId: number | null;
  steps: Raw;
  problems: string[];
}

/**
 * P-W5-05's edit, applied in process: addNode SoundClass EMCP_probe; connect bank All (port 65)
 * to its input (port 64); connect its output (port 65) to the mixer's input port 22535; group it
 * with the bank. Then the graph invariants: the new id keeps the SoundClass code, every link names
 * a node.
 */
export function applyProbeGraph(start: Buffer): GraphApply {
  const steps: Raw = {};
  const problems: string[] = [];
  try {
    const model = loadAudioModel(start, "acp") as unknown as AudioGraphModel;
    const add = applyGraphOp(model, "addNode", {
      class: "SoundClass",
      name: "EMCP_probe",
      x: 512,
      y: 960,
    });
    steps.addNode = add;
    const g1 = readGraph(model);
    const node = g1.nodes.find((n) => n.name === "EMCP_probe");
    if (!add.ok || !node)
      return {
        ok: false,
        bytes: null,
        newId: null,
        groupId: null,
        steps,
        problems: ["addNode did not add EMCP_probe"],
      };
    const newId = node.id;
    steps.connectIn = applyGraphOp(model, "connect", {
      from: RALLY_BANK_ID,
      fromPort: 65,
      to: newId,
      toPort: 64,
    });
    steps.connectOut = applyGraphOp(model, "connect", {
      from: newId,
      fromPort: 65,
      to: RALLY_MIXER_ID,
      toPort: RALLY_MIXER_PORT,
    });
    steps.group = applyGraphOp(model, "group", {
      name: "EMCP_W5_Group",
      members: [newId, RALLY_BANK_ID],
    });
    for (const k of ["connectIn", "connectOut", "group"])
      if ((steps[k] as { ok?: boolean }).ok !== true) problems.push(`${k} refused`);
    const g2 = readGraph(model);
    const ids = new Set(g2.nodes.map((n) => n.id));
    if (
      (newId & 1023) !==
      ((g1.nodes.find((n) => n.cls === "SoundClass" && n.id !== newId)?.id ?? newId) & 1023)
    )
      problems.push(`the new id ${newId} does not keep the SoundClass code`);
    for (const l of g2.links)
      if (!ids.has(l.from) || !ids.has(l.to))
        problems.push(`a link names a missing node (${l.from} -> ${l.to})`);
    const group = g2.groups.find((g) => (g as { name?: string }).name === "EMCP_W5_Group") as
      | { id?: number }
      | undefined;
    return {
      ok: problems.length === 0,
      bytes: Buffer.from(model.doc.toBytes()),
      newId,
      groupId: group?.id ?? null,
      steps,
      problems,
    };
  } catch (e) {
    return {
      ok: false,
      bytes: null,
      newId: null,
      groupId: null,
      steps,
      problems: [e instanceof Error ? e.message : String(e)],
    };
  }
}

/** w5-45's inverse: removeNode of the group and of the new node (force), applied in process. */
export function invertProbeGraph(
  edited: Buffer,
  newId: number,
  groupId: number | null,
): { bytes: Buffer | null; steps: Raw } {
  const steps: Raw = {};
  try {
    const model = loadAudioModel(edited, "acp") as unknown as AudioGraphModel;
    if (groupId !== null)
      steps.removeGroup = applyGraphOp(model, "removeNode", { id: groupId, force: true });
    steps.removeNode = applyGraphOp(model, "removeNode", { id: newId, force: true });
    return { bytes: Buffer.from(model.doc.toBytes()), steps };
  } catch (e) {
    steps.error = e instanceof Error ? e.message : String(e);
    return { bytes: null, steps };
  }
}

/**
 * w5-60's reads on the vanilla world (opened here, never saved). The caller saved the throwaway
 * world before and reopens it after, in a finally path (fix-up 1).
 */
async function vanillaReads(ctx: StepContext, evidence: Raw, fails: string[]): Promise<StepOutcome> {
  const o = await openWorld(ctx, VANILLA_NAV_WORLD);
  evidence.open = o.evidence;
  if (!o.ok)
    throw new StopBattery(
      "stopped",
      `${VANILLA_NAV_WORLD} did not open ('${o.worldPath}')`,
      evidence,
    );
  const off = await ctx.offline("navmesh", { action: "tiles", path: VANILLA_NMN, limit: 1 });
  const s1 = await ctx.tool("wb_navmesh", { action: "status", limit: 100 });
  const cur = S(rb(s1).nextCursor);
  const s2 = cur
    ? await ctx.tool("wb_navmesh", { action: "status", limit: 100, cursor: cur })
    : null;
  const total = N(rb(s1).total) ?? 0;
  const stale = await ctx.tool("wb_navmesh", { action: "status", cursor: `0:${total + 5}` });
  const rows = [...rowsOf(s1), ...rowsOf(s2)];
  const pick =
    rows.find((r) => r.valid === true && r.loaded !== true) ??
    rows.find((r) => r.valid === true) ??
    rows[Math.floor(rows.length / 2)] ??
    null;
  const pos = pick ? `${S(pick.x)} 0 ${S(pick.z)}` : "0 0 0";
  const t0 = await ctx.tool("wb_navmesh", { action: "tile", position: pos });
  const ld = await ctx.tool("wb_navmesh", { action: "load", position: pos });
  let t1: ToolResponse | null = null;
  for (let i = 0; i < 3; i++) {
    t1 = await ctx.tool("wb_navmesh", { action: "tile", position: pos });
    if (rb(t1).loaded === true) break;
    await ctx.sleep(2_000);
  }
  const off3 = pick ? `${(N(pick.x) ?? 0) + 3} 0 ${(N(pick.z) ?? 0) + 3}` : "3 0 3";
  const rc = await ctx.tool("wb_navmesh", {
    action: "reachable",
    position: off3,
    distance: "20",
  });
  Object.assign(evidence, {
    offlineTiles: brief(off, 1500),
    status: brief(s1, 3000),
    statusPage2: brief(s2, 1500),
    stale: brief(stale),
    picked: pick,
    tileBefore: brief(t0),
    load: brief(ld),
    tileAfter: brief(t1),
    reachable: brief(rc),
  });
  if (!s1.ok) fails.push(`status: ${why(s1)}`);
  if (cur && s2 && !s2.ok) fails.push(`status page 2: ${why(s2)}`);
  if (stale.ok || stale.code !== "STALE_CURSOR")
    fails.push(`a stale cursor answered ${stale.ok ? "ok" : S(stale.code)}`);
  if (!ld.ok) fails.push(`load: ${why(ld)}`);
  const anyTrue = rows.some((r) => r.valid === true || r.loaded === true);
  const o13 = {
    rows: rows.length,
    validRows: rows.filter((r) => r.valid === true).length,
    loadedRows: rows.filter((r) => r.loaded === true).length,
    offlineTileCount: rb(off).total ?? null,
    picked: pick,
    tileBefore: rb(t0),
    tileAfter: rb(t1),
  };
  const p13 = !s1.ok
    ? partial("P-W5-13", o13, `status refused ${why(s1)}`)
    : !anyTrue && rb(t1).loaded !== true && rb(t0).valid !== true
      ? killed(
          "P-W5-13",
          o13,
          "all false everywhere in edit mode: tile and load move to play mode, the grid is dropped",
        )
      : rb(t1).loaded === true
        ? settled(
            "P-W5-13",
            o13,
            "tile state answers in edit mode and load makes the tile loaded",
          )
        : partial(
            "P-W5-13",
            o13,
            "tile state answers; load did not read loaded within the poll",
          );
  const point = S(rb(rc).point);
  const nums = point
    .split(/[\s,]+/)
    .filter((x) => x !== "")
    .map(Number);
  const isZero = nums.length === 3 && nums.every((n) => n === 0);
  const isInput = point.replace(/\s+/g, " ").trim() === off3;
  const o14 = {
    position: off3,
    found: rb(rc).found ?? null,
    point,
    code: rc.ok ? null : S(rc.code),
  };
  const p14 = !rc.ok
    ? partial("P-W5-14", o14, `reachable refused ${why(rc)}`)
    : rb(rc).found === true && point !== "" && !isZero && !isInput
      ? settled("P-W5-14", o14, `outPosition is written: ${point}`)
      : rb(rc).found === true && (point === "" || isZero || isInput)
        ? killed(
            "P-W5-14",
            o14,
            "the point is the zero vector or the input: reachable answers found only",
          )
        : partial("P-W5-14", o14, "found false at this point: the point is not judged");
  return {
    ...verdictOf(fails, [p13, p14], `${rows.length} grid points read`),
    evidence,
    probes: [p13, p14],
  };
}

/**
 * The last step, also run after a stop: leave Workbench closable by WM_CLOSE. The open world is
 * saved when it is the throwaway world (W1's rule: nothing else is ever saved), then replaced by
 * a fresh load of another world, so no in-memory edit remains in any world.
 */
export function closableStep(): StepDef {
  return {
    id: CLOSABLE_STEP,
    block: "W5.10",
    title:
      "leave Workbench closable: the throwaway world saved if open, then a fresh load (the W5 world, else vanilla EmptyArland); never save anything else",
    risk: "reversible",
    timeout_ms: TIMEOUTS.open + 60_000,
    expected:
      "no world open (nothing to do), or a freshly opened world in edit mode; the post-flight WM_CLOSE exits without a prompt",
    kill_criterion:
      "the world does not open: FAIL (the runbook's hand answers any save prompt with Don't Save / No)",
    side_effects: ["the World Editor opens another world; only the throwaway world is ever saved"],
    rollback: "none: nothing is edited",
    probes: [],
    writes: [WORLD],
    expectsWindows: WORKBENCH_WINDOWS,
    plan: () => [
      tc("wb_world", "state"),
      tc("wb_world", "stop", {}, { note: "only when the state says play" }),
      ...saveThrowawayPlan("the throwaway world saved before the fresh load"),
      ...openPlan(VANILLA_WORLD),
    ],
    run: async (ctx) => leaveClosable(ctx),
  };
}

export async function leaveClosable(ctx: StepContext): Promise<StepOutcome> {
  const evidence: Raw = {};
  const fails: string[] = [];
  const st0 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateBefore = brief(st0);
  if (S(rb(st0).mode) === "play")
    evidence.stop = brief(await ctx.tool("wb_world", { action: "stop" }));
  const open = S(rb(st0).worldPath).toLowerCase();
  if (!st0.ok || open === "") {
    return {
      status: "PASS",
      detail: "no world is open: nothing in the World Editor to leave",
      evidence,
    };
  }
  evidence.save = await saveThrowaway(ctx);
  const target =
    !isSavableThrowaway(open) && ctx.deps.exists(abs(ctx.opts.sandboxDir, WORLD))
      ? WORLD
      : VANILLA_WORLD;
  evidence.target = target;
  const o = await openWorld(ctx, target);
  evidence.open = o.evidence;
  if (!o.ok) fails.push(`${target} did not open ('${o.worldPath}')`);
  const st1 = await ctx.tool("wb_world", { action: "state" });
  evidence.stateAfter = brief(st1);
  if (S(rb(st1).mode) && S(rb(st1).mode) !== "edit")
    fails.push(`mode ${S(rb(st1).mode)}, not edit`);
  return { ...verdictOf(fails, [], `closable: ${target} freshly open`), evidence };
}

// ── Plan, outline, queue ─────────────────────────────────────────────────────

export function launchAction(): PlanAction {
  return {
    kind: "launch",
    target: { gproj: `<sandbox>/${SANDBOX_NAME}.gproj` } as unknown as PlanAction["target"],
    args: [...LAUNCH_ARGS],
    note: "performed by scripts/live/preflight.ts per the runbook, not by this script",
  } as PlanAction;
}

export function buildActionPlan(steps: StepDef[] = buildSteps()): PlanAction[] {
  const out: PlanAction[] = [launchAction()];
  for (const s of steps) for (const a of s.plan()) out.push({ ...a, step: s.id } as PlanAction);
  return out;
}

/** Every offline call of every step, tagged with the step. */
export function offlinePlan(
  steps: StepDef[] = buildSteps(),
): Array<OfflineCall & { step: string }> {
  return steps.flatMap((s) => (s.offlineCalls?.() ?? []).map((c) => ({ ...c, step: s.id })));
}

/** `tool.action` names a step sends, from its plan and its offline calls. */
export function exercisedBy(s: StepDef): string[] {
  return [
    ...new Set([
      ...s
        .plan()
        .filter((a) => typeof a.tool === "string")
        .map((a) => `${String(a.tool)}.${String(a.toolAction)}`),
      ...(s.offlineCalls?.() ?? []).map((c) => `${c.tool}.${c.action}`),
    ]),
  ];
}

export function sessionOutline(steps: StepDef[] = buildSteps()): string[] {
  return [
    `${SESSION}: Audio, Particle, Navmesh battery (${SCRIPT_PATH}), ${steps.length} steps, one launch on ${SANDBOX_NAME}`,
    ...steps.map(
      (s) =>
        `  [${s.block}] ${s.id} (${s.risk}${s.hand ? ", hand" : ""})${s.probes.length ? ` {${s.probes.join(", ")}}` : ""}: ${s.title}`,
    ),
    `  hand steps: ${steps.filter((s) => s.hand).length}`,
    `  not testable in this battery: ${Object.keys(NOT_TESTABLE).join(", ") || "none"}`,
    `  not exercised: ${Object.keys(NOT_EXERCISED).join(", ") || "none"}`,
  ];
}

export function buildQueue(steps: StepDef[] = buildSteps()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `tests/live/w5.live.ts --emit-queue` from its step table; tests/live-harness/w5-battery.test.ts keeps this file equal. Validated by scripts/live/preflight.ts validateQueue. `launch` names an ordered block inside the ONE launch. No probe pack: session W5 is not in PROBE_MUT_SESSIONS and sends no ECEN_Probe call. P-W5-01 runs after the post-flight through `w5.live.ts bake`, its own process.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    plan_refs: [
      "docs/v2/design/phase5-w5-spec.md 2, 3, 6",
      "DEC-053",
      "DEC-058",
      "DEC-061",
      "DEC-068",
      "PLAN 5.3",
      "PLAN 5.4",
    ],
    launches: 1,
    max_relaunches: 3,
    launch_packs: [],
    launch_args: [...LAUNCH_ARGS],
    launch_args_note:
      "pre-flight builds the real arguments; -scriptAuthorizeAll on the owner's standing go (DEC-053)",
    not_testable: { ...NOT_TESTABLE },
    not_exercised: { ...NOT_EXERCISED },
    probes: steps.map((s) => ({
      id: s.id,
      launch: s.block,
      title: s.title,
      settles: s.probes,
      timeout_ms: s.timeout_ms,
      expected: s.expected,
      kill_criterion: s.kill_criterion,
      side_effects: s.side_effects,
      rollback: s.rollback,
      risk_class: s.risk,
      ...(s.dependsOn?.length ? { depends_on: s.dependsOn } : {}),
      ...(s.hand ? { hand: true } : {}),
    })),
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export function recordPath(runDir: string, id: string): string {
  return join(runDir, `${id}.json`);
}

export function selectSteps(
  steps: StepDef[],
  sel: { from?: string; only?: string; until?: string },
): StepDef[] | string {
  if (sel.only && (sel.from || sel.until)) return "--only excludes --from and --until";
  const idx = (id: string): number => steps.findIndex((s) => s.id === id);
  if (sel.only) {
    const i = idx(sel.only);
    return i === -1 ? `${sel.only} is not a step id` : [steps[i]!];
  }
  const a = sel.from ? idx(sel.from) : 0;
  const b = sel.until ? idx(sel.until) : steps.length - 1;
  if (a === -1) return `${sel.from} is not a step id`;
  if (b === -1) return `${sel.until} is not a step id`;
  if (b < a) return "--until comes before --from";
  return steps.slice(a, b + 1);
}

export interface BatteryReport {
  exit: number;
  records: StepRecord[];
  stoppedAt: string | null;
  message: string | null;
}

/** Killed probes recorded in this run folder (they skip the steps that depend on them). */
function killedProbes(
  runDir: string,
  deps: Pick<W5Deps, "exists" | "readBytes">,
  steps: StepDef[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of steps) {
    const r = readJson<StepRecord>(recordPath(runDir, s.id), deps);
    for (const p of r?.probes ?? [])
      if (p.result === "KILLED") out.set(p.id, `${p.id} KILLED in ${s.id}: ${p.note}`);
  }
  return out;
}

/** Undo what a stopped step owes and run its restorers. Never on a dialog, LOST or WEDGED. */
async function cleanupAfterStop(ctx: StepContext, deps: W5Deps): Promise<Raw> {
  const out: Raw = { undos: [] as UndoResult[], restorers: [] as Raw[] };
  for (const r of [...ctx.debt.restorers].reverse()) {
    try {
      const v = (await r.fn()) as ToolResponse | undefined;
      (out.restorers as Raw[]).push({ label: r.label, ok: v?.ok ?? null, code: v?.code ?? null });
    } catch (e) {
      (out.restorers as Raw[]).push({
        label: r.label,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  ctx.debt.restorers = [];
  while (ctx.debt.undos > 0) {
    const u = await deps.undo();
    ctx.debt.undos--;
    (out.undos as UndoResult[]).push(u);
    if (!u.ok) break;
  }
  return out;
}

/** The engine's save prompt: W1 run 2 saw it titled "Loading world" (Yes / No / Cancel). */
export const SAVE_PROMPT_TITLES: readonly string[] = ["Loading world"];

/**
 * What the main session's hand does with a HANDOFF window: the dialog's exact title, the button
 * ("No" / "Don't Save" on a save prompt: never Save, never Yes, never Cancel) and the resume.
 */
export function handAnswer(
  message: string,
  stepId: string,
): { title: string; answer: string; resumeFrom: string; instruction: string } {
  const m = /"([^"]*)"/.exec(message);
  const title = m ? m[1]! : "";
  const savePrompt = SAVE_PROMPT_TITLES.includes(title) || /save/i.test(title);
  const answer = savePrompt ? "No" : "none planned: record the title and text; never Save";
  const resume = `--from ${stepId} in a new run folder`;
  const instruction = savePrompt
    ? `hand: the engine's save prompt "${title}" ("Do you want to save changes?"): press No / Don't Save (never Save, never Yes, never Cancel), then resume ${resume}`
    : `hand: window "${title}": ${answer}; then resume ${resume}`;
  return { title, answer, resumeFrom: stepId, instruction };
}

function makeCtx(
  deps: W5Deps,
  opts: W5Options,
  prior: (id: string) => StepRecord | null,
  killedNow: ReadonlyMap<string, string>,
  state: Map<string, string>,
  calls: Array<Record<string, unknown>>,
  abort: AbortController,
  onStop: (code: string) => void,
  guardOn: boolean,
): StepContext {
  const debt: Debt = { undos: 0, restorers: [] };
  const guard = (what: string): void => {
    if (guardOn && abort.signal.aborted) {
      calls.push({ notSent: what });
      throw new StepCut();
    }
  };
  const edit = async (what: "undo" | "redo"): Promise<UndoResult> => {
    guard(what);
    const u = what === "undo" ? await deps.undo() : await deps.redo();
    calls.push({ [what]: u });
    if (what === "undo" && u.ok && debt.undos > 0) debt.undos--;
    if (guardOn && !u.ok && STOP_CODES.has(S(u.code))) {
      onStop(S(u.code));
      throw new StopBattery(
        u.code === "MODAL_OPEN" ? "handoff" : "stopped",
        `${what} answered ${u.code}: ${u.message}`,
      );
    }
    return u;
  };
  return {
    deps,
    opts,
    prior,
    killed: (p) => killedNow.has(p),
    calls,
    debt,
    state,
    signal: abort.signal,
    sleep: async (ms) => {
      guard("sleep");
      await deps.sleep(ms);
      guard("sleep");
    },
    tool: async (name, args, o = {}) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.tool(name, args);
      calls.push({ tool: name, args, ok: r.ok, code: r.code ?? null });
      if (
        guardOn &&
        !r.ok &&
        STOP_CODES.has(S(r.code)) &&
        !(o.tolerate && r.code !== "MODAL_OPEN")
      ) {
        onStop(S(r.code));
        throw new StopBattery(
          r.code === "MODAL_OPEN" ? "handoff" : "stopped",
          `${name} ${S(args.action)} answered ${r.code}: ${r.message ?? ""}`,
        );
      }
      if (r.ok && !o.restore && S(rb(r).undoName)) debt.undos++;
      return r;
    },
    offline: async (name, args) => {
      guard(`${name} ${S(args.action)}`);
      const r = await deps.offline(name, args);
      calls.push({ offline: name, args, ok: r.ok, code: r.code ?? null });
      return r;
    },
    undo: () => edit("undo"),
    redo: () => edit("redo"),
  };
}

/** The closable step after a stop: no window poll, no stop codes thrown; its record is written. */
async function closeOutAfterStop(
  deps: W5Deps,
  opts: W5Options,
  prior: (id: string) => StepRecord | null,
  write: (r: StepRecord) => void,
): Promise<void> {
  const def = closableStep();
  const startedAt = new Date(deps.now()).toISOString();
  const calls: Array<Record<string, unknown>> = [];
  const ctx = makeCtx(
    deps,
    opts,
    prior,
    new Map(),
    new Map(),
    calls,
    new AbortController(),
    () => undefined,
    false,
  );
  let out: StepOutcome;
  try {
    out = await def.run(ctx);
  } catch (e) {
    out = {
      status: "FAIL",
      detail: `the close-out threw: ${e instanceof Error ? e.message : String(e)}`,
      evidence: {},
    };
  }
  write({
    step: def.id,
    block: def.block,
    title: `${def.title} (after a stop)`,
    status: out.status,
    detail: out.detail,
    startedAt,
    endedAt: new Date(deps.now()).toISOString(),
    probes: [],
    evidence: { ...out.evidence, calls },
  });
}

export async function runBattery(
  steps: StepDef[],
  deps: W5Deps,
  opts: W5Options,
): Promise<BatteryReport> {
  const all = buildSteps();
  const records: StepRecord[] = [];
  const state = new Map<string, string>();
  const write = (r: StepRecord): void => {
    const clean = JSON.parse(toPlaceholders(JSON.stringify(r), opts.ph)) as StepRecord;
    const path = recordPath(opts.runDir, r.step);
    deps.writeBytes(path, Buffer.from(JSON.stringify(clean, null, 2) + "\n", "utf-8"));
    records.push(clean);
    if (opts.evidenceDir) {
      const probes = r.probes.map((p) => `${p.id} ${p.result}`).join(", ");
      writeEvidence(
        opts.evidenceDir,
        SESSION,
        {
          ran: `${SCRIPT_PATH} ${r.step}`,
          build: opts.build,
          result_summary:
            `${r.step}: ${r.status}${probes ? ` [${probes}]` : ""} - ${r.detail}`.slice(0, 2000),
          artifacts: [path],
        },
        opts.ph,
      );
    }
    writeResult(opts, deps, all);
  };
  const prior = (id: string): StepRecord | null =>
    readJson<StepRecord>(recordPath(opts.runDir, id), deps);
  // A run that starts past the gate (--from, --only) takes the battery snapshot now when the
  // sitting has none, so w5-95 always has a baseline (W1 run 7).
  if (steps.length && steps[0]!.id !== GATE_STEP)
    ensureBatterySnapshot(opts.sittingDir, opts.sandboxDir, deps, "run start");
  let consecutiveFails = 0;
  let failUnit = "";
  let held = 0;
  for (const s of steps) {
    // The FAIL count is kept within one unit of dependent steps: it resets at a block boundary,
    // and every step of an independent block is its own unit (failUnitOf). LOST, WEDGED, MODAL
    // and dialog stops are untouched.
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
    if (s.hand && opts.skipHand) {
      held++;
      write({
        ...base,
        status: "HELD",
        detail:
          "--skip-hand: the hand step is held, nothing sent; run it with --only in a new run folder",
        endedAt: startedAt,
        probes: [],
        evidence: {},
      });
      continue;
    }
    const killedNow = killedProbes(opts.runDir, deps, all);
    const blockers = (s.dependsOn ?? []).filter((p) => killedNow.has(p));
    if (blockers.length) {
      write({
        ...base,
        status: "SKIPPED",
        detail: blockers.map((p) => killedNow.get(p)).join("; "),
        endedAt: startedAt,
        probes: [],
        evidence: {},
      });
      continue;
    }
    deps.log(`step ${s.id}: ${s.title}`);
    const calls: Array<Record<string, unknown>> = [];
    const abort = new AbortController();
    let clientStop: string | null = null;
    const ctx = makeCtx(
      deps,
      opts,
      prior,
      killedNow,
      state,
      calls,
      abort,
      (c) => (clientStop = c),
      true,
    );
    try {
      const pid = deps.recordedPid();
      if (pid === null)
        throw new StopBattery(
          "stopped",
          "the lane recorded no Workbench pid: run the pre-flight first",
        );
      // Fix-up 2: a busy-only window change (a disabled unowned editor or tool window, e.g. during
      // the GM_Arland load of w5-60, run 2) is judged by its lifetime, not cut at once.
      const w = await watched(deps, pid, s.expectsWindows, abort, () => s.run(ctx), {
        popups: false,
        busyGraceMs: BUSY_GRACE_MS,
      });
      const out = w.value;
      if (w.added.length)
        out.evidence.windowsAdded = w.added.map((x) => ({
          className: x.className,
          title: x.title,
        }));
      write({
        ...base,
        status: out.status,
        detail: out.detail,
        endedAt: new Date(deps.now()).toISOString(),
        probes: out.probes ?? [],
        evidence: { ...out.evidence, calls },
      });
      consecutiveFails = out.status === "FAIL" ? consecutiveFails + 1 : 0;
      if (consecutiveFails >= 3) {
        if (s.id !== CLOSABLE_STEP && !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP)))
          await closeOutAfterStop(deps, opts, prior, write);
        return {
          exit: EXIT.stopped,
          records,
          stoppedAt: s.id,
          message: "three consecutive unexpected failures: the battery stops",
        };
      }
    } catch (e) {
      const stop = e instanceof StopBattery ? e : null;
      const kind = stop?.kind ?? "stopped";
      const message = e instanceof Error ? e.message : String(e);
      const dialog = kind === "handoff" || clientStop === "MODAL_OPEN";
      const wedged = clientStop === "WEDGED" || clientStop === "LOST";
      let cleanup: Raw | null = null;
      if (!dialog && !wedged && kind !== "aborted") {
        try {
          cleanup = await cleanupAfterStop(ctx, deps);
        } catch (ce) {
          cleanup = { error: ce instanceof Error ? ce.message : String(ce) };
        }
      }
      const hand = kind === "handoff" ? handAnswer(message, s.id) : null;
      write({
        ...base,
        status: kind === "aborted" ? "ABORTED" : kind === "handoff" ? "HANDOFF" : "STOPPED",
        detail: hand ? `${message}; ${hand.instruction}` : message,
        endedAt: new Date(deps.now()).toISOString(),
        probes: [],
        evidence: {
          ...(stop?.evidence ?? {}),
          ...(hand ? { handAnswer: hand } : {}),
          cut: abort.signal.aborted,
          calls,
          cleanup,
          pendingDebt: cleanup
            ? null
            : { undos: ctx.debt.undos, restorers: ctx.debt.restorers.map((r) => r.label) },
        },
        stop: message,
      });
      if (
        !dialog &&
        !wedged &&
        kind !== "aborted" &&
        s.id !== CLOSABLE_STEP &&
        !deps.exists(recordPath(opts.runDir, CLOSABLE_STEP))
      )
        await closeOutAfterStop(deps, opts, prior, write);
      return {
        exit: kind === "aborted" ? EXIT.aborted : kind === "handoff" ? EXIT.handoff : EXIT.stopped,
        records,
        stoppedAt: s.id,
        message: hand ? `${message}; ${hand.instruction}` : message,
      };
    }
  }
  const failed = records.some((r) => r.status === "FAIL");
  return {
    exit: failed ? EXIT.refused : EXIT.done,
    records,
    stoppedAt: null,
    message: failed
      ? "a step FAILED (see the table)"
      : held
        ? `${held} hand step(s) HELD (--skip-hand)`
        : null,
  };
}

/** The bake record of `w5.live.ts bake` (P-W5-01), read into the result file. */
export interface BakeRecord {
  probe: ProbeResult;
  [k: string]: unknown;
}

/** `<sitting>/w5-result.json`: every step's latest record across the sitting's run folders, and each probe's result. */
export function writeResult(
  opts: W5Options,
  deps: Pick<W5Deps, "exists" | "readBytes" | "writeBytes" | "listTree">,
  steps: StepDef[],
): void {
  const latest = new Map<string, StepRecord & { runDir: string }>();
  const runs = new Set(
    deps
      .listTree(opts.sittingDir)
      .filter((f) => f.includes("/"))
      .map((f) => f.split("/")[0]!),
  );
  for (const run of [...runs].sort()) {
    for (const s of steps) {
      const r = readJson<StepRecord>(recordPath(join(opts.sittingDir, run), s.id), deps);
      if (r) latest.set(s.id, { ...r, runDir: run });
    }
  }
  const bake = readJson<BakeRecord>(join(opts.sittingDir, BAKE_FILE), deps);
  const probes: Record<string, unknown> = {};
  for (const id of PROBE_IDS) {
    const hits = steps
      .filter((s) => latest.get(s.id)?.probes?.some((p) => p.id === id))
      .flatMap((s) =>
        latest
          .get(s.id)!
          .probes.filter((p) => p.id === id)
          .map((p) => ({ step: s.id, ...p })),
      );
    probes[id] =
      id === "P-W5-01" && bake?.probe
        ? { result: bake.probe.result, by: [{ step: "bake", ...bake.probe }] }
        : NOT_TESTABLE[id]
          ? { result: "NOT-TESTABLE", note: NOT_TESTABLE[id] }
          : hits.length
            ? {
                result: hits.some((h) => h.result === "KILLED")
                  ? "KILLED"
                  : hits.every((h) => h.result === "SETTLED")
                    ? "SETTLED"
                    : "PARTIAL",
                by: hits,
              }
            : {
                result: "NOT-RUN",
                steps: steps.filter((s) => s.probes.includes(id)).map((s) => s.id),
              };
  }
  const value = {
    session: SESSION,
    script: SCRIPT_PATH,
    build: opts.build,
    updated_at: new Date().toISOString(),
    steps: steps.map((s) => {
      const r = latest.get(s.id);
      return r
        ? {
            id: s.id,
            status: r.status,
            detail: r.detail,
            run: r.runDir,
            probes: r.probes.map((p) => `${p.id} ${p.result}`),
            exercises: exercisedBy(s),
          }
        : {
            id: s.id,
            status: "NOT-RUN",
            detail: "no record in this sitting",
            exercises: exercisedBy(s),
          };
    }),
    probes,
    not_exercised: NOT_EXERCISED,
  };
  const clean = JSON.parse(toPlaceholders(JSON.stringify(value), opts.ph)) as unknown;
  writeJson(join(opts.sittingDir, RESULT_FILE), clean, deps);
}

/** The final stdout table: step id, status, one-line detail. */
export function resultTable(records: StepRecord[]): string[] {
  const w = Math.max(4, ...records.map((r) => r.step.length));
  const line = (a: string, b: string, c: string): string => `${a.padEnd(w)}  ${b.padEnd(8)}  ${c}`;
  return [
    line("step", "status", "detail"),
    line("-".repeat(w), "-".repeat(8), "-".repeat(6)),
    ...records.map((r) => line(r.step, r.status, r.detail.replace(/\s+/g, " ").slice(0, 160))),
  ];
}

// ── Offline subcommands: plant, bake and rollback ────────────────────────────

export interface OfflineIo {
  workbenchPids: () => number[];
  exists: (p: string) => boolean;
  listDir: (p: string) => string[];
  listTree: (p: string) => string[];
  readBytes: (p: string) => Buffer;
  writeBytes: (p: string, b: Buffer) => void;
  makeDir: (p: string) => void;
  removeTree: (p: string) => void;
  readVanilla: (vpath: string) => Promise<Buffer>;
  log: (l: string) => void;
}

/** What `plant` writes: project-relative path to its vanilla source (paks). */
export function plantSources(): Array<{ rel: string; from: string }> {
  return [
    { rel: FX_ACP, from: V_RALLY },
    { rel: FX_SIG, from: V_SIG },
    { rel: FX_VARS, from: V_VARS },
    { rel: FX_PTC, from: V_FX },
    { rel: FX_AFM, from: V_AFM },
    { rel: OFF_ACP, from: V_RALLY },
    { rel: OFF_GRAPH, from: V_RALLY },
    { rel: OFF_SIG, from: V_SIG },
    { rel: OFF_VARS, from: V_VARS },
    { rel: OFF_AFM, from: V_AFM },
    { rel: OFF_PTC, from: V_FX },
    { rel: RT_ACP, from: V_RALLY },
    { rel: RT_SIG, from: V_SIG },
    { rel: RT_VARS, from: V_VARS },
    { rel: RT_AFM, from: V_AFM },
    { rel: RT_PTC, from: V_FX },
  ];
}

/** `plant`: the sixteen copies and three folders under _throwaway/W5/ (no Workbench running). */
export async function runPlant(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): Promise<number> {
  for (const s of plantSources()) io.log(`plant: paks:${s.from} -> <sandbox>/${s.rel}`);
  for (const d of PLANT_DIRS) io.log(`plant: folder <sandbox>/${d}/`);
  if (!really) {
    io.log("dry run: nothing written (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the plant is offline`);
    return EXIT.refused;
  }
  if (io.exists(abs(sandboxDir, W5_ROOT))) {
    io.log(`refused: <sandbox>/${W5_ROOT}/ exists: roll the last sitting back first`);
    return EXIT.refused;
  }
  const throwawayExistedBefore = io.exists(abs(sandboxDir, THROWAWAY));
  const cache = new Map<string, Buffer>();
  const bytes: Record<string, Buffer> = {};
  for (const s of plantSources()) {
    if (!cache.has(s.from)) cache.set(s.from, await io.readVanilla(s.from));
    bytes[s.rel] = cache.get(s.from)!;
  }
  const record = {
    files: Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, sha256(b)])),
    dirs: [...PLANT_DIRS],
    throwawayExistedBefore,
  };
  io.writeBytes(join(sittingDir, PLANT_FILE), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
  for (const [rel, b] of Object.entries(bytes)) {
    io.writeBytes(abs(sandboxDir, rel), b);
    io.log(`planted <sandbox>/${rel} (${b.length} bytes, sha256 ${sha256(b)})`);
  }
  for (const d of PLANT_DIRS) {
    io.makeDir(abs(sandboxDir, d));
    io.log(`made <sandbox>/${d}/`);
  }
  return EXIT.done;
}

/** `rollback`: list (with hashes) and remove <sandbox>/_throwaway/W5/; `_throwaway/` only when empty and absent before. */
export function runRollback(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: OfflineIo,
): number {
  const dir = abs(sandboxDir, W5_ROOT);
  if (!io.exists(dir)) {
    io.log(`nothing to roll back: <sandbox>/${W5_ROOT}/ is absent`);
    return EXIT.done;
  }
  const files = io.listTree(dir);
  io.log(`rollback: list and remove <sandbox>/${W5_ROOT}/ (${files.length} files)`);
  if (!really) {
    io.log("dry run: nothing removed");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")})`);
    return EXIT.refused;
  }
  const listing = files.map((rel) => ({
    rel,
    sha256: sha256(io.readBytes(join(dir, ...rel.split("/")))),
  }));
  io.writeBytes(
    join(sittingDir, "throwaway-w5-listing.json"),
    Buffer.from(JSON.stringify(listing, null, 2) + "\n"),
  );
  io.removeTree(dir);
  let plant: { throwawayExistedBefore?: boolean } | null = null;
  try {
    plant = JSON.parse(io.readBytes(join(sittingDir, PLANT_FILE)).toString("utf-8")) as {
      throwawayExistedBefore?: boolean;
    };
  } catch {
    plant = null;
  }
  const top = abs(sandboxDir, THROWAWAY);
  if (plant?.throwawayExistedBefore === false && io.exists(top) && io.listDir(top).length === 0)
    io.removeTree(top);
  io.log(`removed <sandbox>/${W5_ROOT}/ (listing in throwaway-w5-listing.json)`);
  return EXIT.done;
}

/** What `bake` needs besides the file system: the CLI tool and the offline navmesh reader. */
export interface BakeIo extends OfflineIo {
  /** wb_cli_run in process with navmeshBake listed for this call only (the probe build's policy). */
  cliBake: (args: Raw) => Promise<ToolResponse>;
  /** navmesh (offline) with projectPath set to the sandbox. */
  navmesh: (args: Raw) => ToolResponse;
}

/** The argv navmeshBake would run (printed by the dry run). */
export function bakeArgv(sandboxDir: string): string[] {
  return planFor("navmeshBake", {
    gproj: join(sandboxDir, `${SANDBOX_NAME}.gproj`),
    target: WORLD,
    saveDir: abs(sandboxDir, BAKE_DIR),
  });
}

/**
 * `bake` (P-W5-01), after the post-flight with no Workbench running: wb_cli_run navmeshBake on the
 * throwaway world with its 600 s watchdog (ends only the PID it started), then navmesh header and
 * tiles on the output. Writes <sitting>/w5-bake.json; w5-result.json reads it.
 */
export async function runBake(
  sandboxDir: string,
  sittingDir: string,
  really: boolean,
  io: BakeIo,
): Promise<number> {
  io.log(`bake: ${bakeArgv(sandboxDir).join(" ")}`);
  if (!really) {
    io.log("dry run: nothing spawned (add --really with --id; no Workbench may run)");
    return EXIT.done;
  }
  const pids = io.workbenchPids();
  if (pids.length) {
    io.log(`refused: a Workbench image runs (pid ${pids.join(", ")}): the bake is its own process`);
    return EXIT.refused;
  }
  if (!io.exists(abs(sandboxDir, WORLD))) {
    io.log(
      `refused: ${WORLD} is not on disk (the battery's w5-05 writes it; never bake another world)`,
    );
    return EXIT.refused;
  }
  const bakeAbs = abs(sandboxDir, BAKE_DIR);
  if (io.exists(bakeAbs) && io.listTree(bakeAbs).length) {
    io.log(`refused: <sandbox>/${BAKE_DIR}/ is not empty (a bake ran already in this sitting)`);
    return EXIT.refused;
  }
  const hashes = (): Record<string, string> =>
    sandboxHashes(sandboxDir, { listTree: io.listTree, readBytes: io.readBytes });
  const before = hashes();
  const cli = await io.cliBake({
    verb: "navmeshBake",
    gproj: join(sandboxDir, `${SANDBOX_NAME}.gproj`),
    target: WORLD,
    save_dir: bakeAbs,
    timeout_seconds: 600,
    launcher_nudge: true,
    configuration: "PC",
  });
  const out = io.exists(bakeAbs) ? io.listTree(bakeAbs) : [];
  const nmn = out.filter((f) => f.toLowerCase().endsWith(".nmn"));
  const ntile = out.filter((f) => f.toLowerCase().endsWith(".ntile"));
  const header = nmn[0] ? io.navmesh({ action: "header", path: `${BAKE_DIR}/${nmn[0]}` }) : null;
  const tiles = nmn[0]
    ? io.navmesh({ action: "tiles", path: `${BAKE_DIR}/${nmn[0]}`, limit: 5 })
    : null;
  const changed = changedFiles(before, hashes()).filter((f) => !NETZERO_TOLERATED.includes(f));
  const observed = {
    cli: brief(cli, 3000),
    files: out.slice(0, 50),
    nmn,
    ntileCount: ntile.length,
    header: brief(header, 1500),
    tiles: brief(tiles, 1500),
    changedOutsideW5: changed,
  };
  const probe =
    nmn.length && ntile.length && header?.ok
      ? settled(
          "P-W5-01",
          observed,
          `the bake wrote ${nmn.length} .nmn and ${ntile.length} .ntile; the header reads`,
        )
      : killed(
          "P-W5-01",
          observed,
          cli.ok
            ? "no .nmn/.ntile after the run: the CLI bake rows go absent-in-build, the persisted bake goes W8"
            : `the run did not finish (${why(cli)}): the CLI bake rows go absent-in-build, the persisted bake goes W8`,
        );
  io.writeBytes(
    join(sittingDir, BAKE_FILE),
    Buffer.from(JSON.stringify({ probe, argv: bakeArgv(sandboxDir) }, null, 2) + "\n"),
  );
  io.log(`P-W5-01 ${probe.result}: ${probe.note}`);
  if (changed.length) io.log(`changed outside ${W5_ROOT}/: ${changed.join(", ")}`);
  return changed.length ? EXIT.refused : EXIT.done;
}

// ── Real dependencies ────────────────────────────────────────────────────────

function listTreeOf(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      // A file can vanish between the listing and the stat (Workbench writes its settings
      // through a temp file beside the scratch ini): a vanished entry is not listed.
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

async function openVfs() {
  const { PakVirtualFS } = await import("../../src/pak/vfs.js");
  return PakVirtualFS.get(loadConfig().gamePath);
}

type LegacyToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type LegacyToolCallback = (args: Raw) => Promise<LegacyToolResult>;

/** A registered tool's callback, captured from its register function (the 1.x names). */
function captureTool(register: (server: McpServer) => void): LegacyToolCallback | null {
  const holder: { cb: LegacyToolCallback | null } = { cb: null };
  register({
    registerTool: (_name: string, _def: unknown, cb: LegacyToolCallback) => {
      holder.cb = cb;
    },
  } as unknown as McpServer);
  return holder.cb;
}

/** A registered tool's answer as a ToolResponse (its JSON text when it is one). */
export function legacyResponse(action: string, out: LegacyToolResult): ToolResponse {
  const text = out.content.map((c) => S(c.text)).join("\n");
  try {
    const j = JSON.parse(text) as Raw;
    if (j && typeof j === "object" && typeof j.ok === "boolean") return j as ToolResponse;
  } catch {
    // not JSON: the 1.x text form
  }
  const code =
    /"code"\s*:\s*"([A-Z_]+)"/.exec(text)?.[1] ??
    /\b(NOT_ALLOWLISTED|MODULE_NOT_SUPPORTED|GATED)\b/.exec(text)?.[1];
  return {
    ok: out.isError !== true,
    action,
    ...(out.isError === true ? { code: code ?? "TOOL_ERROR" } : {}),
    message: text.slice(0, 500),
    readback: { text: text.slice(0, 2000) },
  };
}

export function realDeps(input: {
  port: number;
  lane: Lane;
  sandboxDir: string;
  vfs: VanillaFs | null;
}): W5Deps {
  const client = new WorkbenchClient("127.0.0.1", input.port);
  const worldDeps = { projectRoot: input.sandboxDir, artifactsRoot: artifactsDir() };
  const config: Config = { ...loadConfig(), projectPath: input.sandboxDir };
  const asResp = (r: unknown): ToolResponse => r as ToolResponse;
  const editorControl = async (action: "undo" | "redo"): Promise<UndoResult> => {
    try {
      const r = await client.call<Raw>(
        "EMCP_WB_EditorControl",
        { action },
        { access: "mutate", timeout: 30_000 },
      );
      const message = S(r.message);
      const want = action === "undo" ? /^Undo executed/ : /^Redo executed/;
      return { ok: S(r.status) !== "error" && want.test(message), message };
    } catch (e) {
      if (e instanceof WorkbenchError) return { ok: false, message: e.message, code: e.code };
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  };
  return {
    tool: async (name, args) => {
      switch (name) {
        case "wb_audio":
          return asResp(await runWbAudio(client, args));
        case "wb_particle":
          return asResp(await runWbParticle(client, args));
        case "wb_navmesh":
          return asResp(await runWbNavmesh(client, args));
        case "wb_resources":
          return asResp(await runResources(client, args));
        case "wb_container":
          return asResp(await runContainer(client, args, { artifactsRoot: artifactsDir() }));
        case "wb_module":
          return asResp(await runModule(client, args as unknown as ModuleArgs));
        case "wb_world":
          return asResp(await runWorld(client, args, worldDeps));
        case "wb_entity":
          return asResp(await runEntity(client, args));
        case "wb_gui":
          return asResp(await runGui(args, { env: { ...process.env, ENFUSION_GUI: "1" } }));
        case "terrain_navmesh_status": {
          const cb = captureTool((s) => registerTerrainNavmeshStatus(s, client));
          if (!cb)
            return { ok: false, action: "status", code: "INVALID_ARGUMENT", message: "no tool" };
          const { action: _a, ...rest } = args;
          return legacyResponse("status", await cb(rest));
        }
      }
    },
    offline: async (name, args) => {
      // The test project's folder is passed in here; no tool or handler names it.
      const { probeGates, action, ...rest } = args;
      const a = { action, ...rest, projectPath: input.sandboxDir };
      switch (name) {
        case "audio":
          return asResp(
            runOfflineAudio(
              a as unknown as AudioRequest,
              config,
              probeGates === true ? PROBE_GATES : AUDIO_GATES,
            ),
          );
        case "particle":
          return asResp(runOfflineParticle(a as unknown as ParticleRequest, config));
        case "navmesh":
          return asResp(runOfflineNavmesh(a as unknown as NavmeshArgs, config));
        case "particle_inspect": {
          const cb = captureTool((s) => registerParticleInspect(s, undefined, config));
          if (!cb)
            return { ok: false, action: "inspect", code: "INVALID_ARGUMENT", message: "no tool" };
          return legacyResponse("inspect", await cb(rest));
        }
        case "wb_cli_run": {
          const verb = S(action);
          // A verb on the allow-list would spawn a second Workbench beside the GUI one: never sent.
          if (loadCliPolicy().verbs.has(verb))
            return {
              ok: false,
              action: verb,
              code: "NOT_SENT",
              message: `${verb} is on the allow-list: the call would spawn a Workbench, so it is not sent in the GUI sitting`,
            };
          const cb = captureTool((s) => registerWbCliRun(s, config));
          if (!cb) return { ok: false, action: verb, code: "INVALID_ARGUMENT", message: "no tool" };
          return legacyResponse(
            verb,
            await cb({
              verb,
              gproj: S(rest.gproj),
              target: rest.target,
              save_dir: rest.save_dir,
              configuration: "PC",
              timeout_seconds: 60,
              launcher_nudge: false,
            }),
          );
        }
      }
    },
    undo: () => editorControl("undo"),
    redo: () => editorControl("redo"),
    info: async () => {
      try {
        return (await client.probe("EMCP_WB_Info", {}, { timeout: 10_000 })) as Raw;
      } catch {
        return null;
      }
    },
    ping: async () => {
      try {
        return (await client.probe("EMCP_WB_Ping", {}, { timeout: 10_000 })) as Raw;
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
    vanilla: () => input.vfs,
    readBytes: (p) => readFileSync(p),
    writeBytes: (p, b) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, b);
    },
    exists: (p) => existsSync(p),
    listTree: listTreeOf,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (l) => console.log(l),
  };
}

function realOfflineIo(): OfflineIo {
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
    makeDir: (p) => {
      mkdirSync(p, { recursive: true });
    },
    removeTree: (p) => rmSync(p, { recursive: true, force: false }),
    readVanilla: async (vpath) => {
      const vfs = await openVfs();
      if (!vfs) throw new Error("the game paks could not be opened (ENFUSION_GAME_PATH)");
      return vfs.readFile(vpath);
    },
    log: (l) => console.log(l),
  };
}

function realBakeIo(sandboxDir: string): BakeIo {
  const config: Config = { ...loadConfig(), projectPath: sandboxDir };
  return {
    ...realOfflineIo(),
    cliBake: async (args) => {
      // The probe build's policy for this one process: navmeshBake listed, nothing else changed,
      // policy.json untouched (the integrator lists it only after P-W5-01 passes, DEC-068 OD-2).
      const cb = captureTool((s) =>
        registerWbCliRun(s, config, {
          policy: () => {
            const p = loadCliPolicy();
            return { ...p, verbs: new Set([...p.verbs, "navmeshBake"]) };
          },
        }),
      );
      if (!cb)
        return { ok: false, action: "navmeshBake", code: "INVALID_ARGUMENT", message: "no tool" };
      return legacyResponse("navmeshBake", await cb(args));
    },
    navmesh: (args) =>
      runOfflineNavmesh(
        { ...args, projectPath: sandboxDir } as unknown as NavmeshArgs,
        config,
      ) as unknown as ToolResponse,
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
const FLAGS = ["really", "skip-hand", "update-baseline"] as const;
const SUBCOMMANDS = ["plant", "rollback", "bake"] as const;

export interface MainOverrides {
  out?: (line: string) => void;
  platform?: NodeJS.Platform;
  policy?: CensusPolicy;
  deps?: W5Deps;
  leaseHeld?: boolean;
  offlineIo?: OfflineIo;
  bakeIo?: BakeIo;
}

/** The dry-run gate: the plan against the policy and the queue against validateQueue. */
export function dryRunCheck(policy: CensusPolicy): { ok: boolean; lines: string[] } {
  const steps = buildSteps();
  const check = checkPlan(buildActionPlan(steps), policy, { script: SCRIPT_PATH });
  const lines = [formatResult(check)];
  let queueOk = true;
  try {
    const q = validateQueue(buildQueue(steps), false);
    lines.push(`queue: ${q.length} probes valid`);
  } catch (e) {
    queueOk = false;
    lines.push(`queue: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ok: check.ok && queueOk, lines };
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const say = over.out ?? ((l: string) => console.log(l));
  const ph = defaultPlaceholderContext({ v2: REPO_ROOT });
  const sub = (SUBCOMMANDS as readonly string[]).includes(argv[0] ?? "")
    ? (argv[0] as (typeof SUBCOMMANDS)[number])
    : null;
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

  if (sub) {
    if (!o.sandbox || basename(resolve(o.sandbox)) !== SANDBOX_NAME) {
      say(`${sub} needs --sandbox <the test bed folder ${SANDBOX_NAME}>`);
      return EXIT.usage;
    }
    if (!o["sitting-dir"]) {
      say(`${sub} needs --sitting-dir <the sitting folder>`);
      return EXIT.usage;
    }
    if (really) {
      if (!o.id) {
        say(`${sub} --really needs --id <lane id>`);
        return EXIT.usage;
      }
      const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
      const gate = liveGateReason({
        really,
        platform: over.platform ?? process.platform,
        leaseHeld: over.leaseHeld ?? lane.holdsLease(),
      });
      if (gate) {
        say(gate);
        return EXIT.refused;
      }
    }
    const sandbox = resolve(o.sandbox);
    const sitting = resolve(o["sitting-dir"]);
    const log = (l: string) => say(toPlaceholders(l, { ...ph, sandbox }));
    if (sub === "bake") {
      const io = { ...(over.bakeIo ?? realBakeIo(sandbox)), log };
      return runBake(sandbox, sitting, really, io);
    }
    const io = { ...(over.offlineIo ?? realOfflineIo()), log };
    return sub === "plant"
      ? runPlant(sandbox, sitting, really, io)
      : runRollback(sandbox, sitting, really, io);
  }

  const steps = buildSteps();
  const plan = buildActionPlan(steps);
  const policy = over.policy ?? loadPolicy();
  const dry = dryRunCheck(policy);
  if (o.out) {
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  if (o.outline) writeFileSync(o.outline, sessionOutline(steps).join("\n") + "\n", "utf-8");
  if (o["emit-queue"])
    writeFileSync(o["emit-queue"], JSON.stringify(buildQueue(steps), null, 2) + "\n", "utf-8");
  if (!really) {
    for (const l of sessionOutline(steps)) say(l);
    for (const l of dry.lines) say(l);
    return dry.ok ? EXIT.done : EXIT.refused;
  }
  if (!dry.ok) {
    for (const l of dry.lines) say(l);
    return EXIT.refused;
  }
  const selected = selectSteps(steps, { from: o.from, only: o.only, until: o.until });
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
  const lane = new Lane({ id: o.id, leasePath: o["lease-path"], markerPath: o["marker-path"] });
  const gate = liveGateReason({
    really,
    platform: over.platform ?? process.platform,
    leaseHeld: over.leaseHeld ?? lane.holdsLease(),
  });
  if (gate) {
    say(gate);
    return EXIT.refused;
  }
  const sittingDir = resolve(o["sitting-dir"]);
  if (!existsSync(join(sittingDir, PLANT_FILE))) {
    say(
      toPlaceholders(
        `refused: ${sittingDir} holds no ${PLANT_FILE}: run \`w5.live.ts plant\` first`,
        ph,
      ),
    );
    return EXIT.refused;
  }
  const runDir = resolve(
    o["run-dir"] ?? join(sittingDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}`),
  );
  if (dirname(runDir) !== sittingDir) {
    say(`--run-dir must lie directly in ${sittingDir}`);
    return EXIT.usage;
  }
  mkdirSync(runDir, { recursive: true });
  const port = o.port ? Number(o.port) : DEFAULT_PORT;
  let deps = over.deps;
  if (!deps) {
    const v = await openVfs();
    const vfs: VanillaFs | null = v
      ? { paths: () => v.allFilePaths(), read: (p) => v.readFile(p) }
      : null;
    deps = realDeps({ port, lane, sandboxDir: resolve(o.sandbox), vfs });
    lane.startHeartbeat();
  }
  try {
    const r = await runBattery(selected, deps, {
      runDir,
      sittingDir,
      sandboxDir: resolve(o.sandbox),
      evidenceDir: o["evidence-dir"] ?? DEFAULT_EVIDENCE_DIR,
      ph: { ...ph, sandbox: resolve(o.sandbox) },
      build: o.build ?? "unrecorded",
      skipHand: args.flags.has("skip-hand"),
    });
    for (const l of resultTable(r.records)) say(l);
    for (const l of applyBaselineGuard(r, {
      wave: "w5",
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
    lane.stopHeartbeat();
  }
}

if (isMainModule(import.meta.url)) {
  // An explicit exit: a step cut by the window poller may leave a call in flight.
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exitCode = EXIT.stopped;
    },
  );
}

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/audio.catalog
// census:mcp:action/audio.create
// census:mcp:action/audio.events
// census:mcp:action/audio.graph
// census:mcp:action/audio.inspect
// census:mcp:action/audio.mixer
// census:mcp:action/audio.node
// census:mcp:action/audio.nodes
// census:mcp:action/audio.refs
// census:mcp:action/audio.samples
// census:mcp:action/audio.signal
// census:mcp:action/audio.validate
// census:mcp:action/audio.variables
// census:mcp:action/navmesh.config
// census:mcp:action/navmesh.header
// census:mcp:action/navmesh.projects
// census:mcp:action/navmesh.status
// census:mcp:action/navmesh.tiles
// census:mcp:action/particle.catalog
// census:mcp:action/particle.create
// census:mcp:action/particle.curves
// census:mcp:action/particle.diff
// census:mcp:action/particle.emitter
// census:mcp:action/particle.emitters
// census:mcp:action/particle.inspect
// census:mcp:action/particle.refs
// census:mcp:action/particle.set
// census:mcp:action/particle.validate
// census:mcp:action/wb_audio.audible
// census:mcp:action/wb_audio.isPlaying
// census:mcp:action/wb_audio.masters
// census:mcp:action/wb_audio.outputStates
// census:mcp:action/wb_audio.play
// census:mcp:action/wb_audio.playSound
// census:mcp:action/wb_audio.setMaster
// census:mcp:action/wb_audio.setVariable
// census:mcp:action/wb_audio.stop
// census:mcp:action/wb_audio.variable
// census:mcp:action/wb_navmesh.load
// census:mcp:action/wb_navmesh.reachable
// census:mcp:action/wb_navmesh.status
// census:mcp:action/wb_navmesh.tile
// census:mcp:action/wb_particle.control
// census:mcp:action/wb_particle.param
// census:mcp:action/wb_particle.remove
// census:mcp:action/wb_particle.setParam
// census:mcp:action/wb_particle.spawn
// census:mcp:action/wb_particle.stats
// census:mcp:handler-action/EMCP_WB_Audio.audible
// census:mcp:handler-action/EMCP_WB_Audio.isPlaying
// census:mcp:handler-action/EMCP_WB_Audio.masters
// census:mcp:handler-action/EMCP_WB_Audio.outputStates
// census:mcp:handler-action/EMCP_WB_Audio.play
// census:mcp:handler-action/EMCP_WB_Audio.playSound
// census:mcp:handler-action/EMCP_WB_Audio.setMaster
// census:mcp:handler-action/EMCP_WB_Audio.setVariable
// census:mcp:handler-action/EMCP_WB_Audio.stop
// census:mcp:handler-action/EMCP_WB_Audio.variable
// census:mcp:handler-action/EMCP_WB_Navmesh.load
// census:mcp:handler-action/EMCP_WB_Navmesh.reachable
// census:mcp:handler-action/EMCP_WB_Navmesh.status
// census:mcp:handler-action/EMCP_WB_Navmesh.tile
// census:mcp:handler-action/EMCP_WB_Particle.control
// census:mcp:handler-action/EMCP_WB_Particle.param
// census:mcp:handler-action/EMCP_WB_Particle.remove
// census:mcp:handler-action/EMCP_WB_Particle.setParam
// census:mcp:handler-action/EMCP_WB_Particle.spawn
// census:mcp:handler-action/EMCP_WB_Particle.stats
