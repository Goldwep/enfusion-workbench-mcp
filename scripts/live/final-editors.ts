/**
 * The final pass, one Workbench editor per launch (docs/v2/sessions/queues/FINAL-editors.md), on
 * build 1.9.0.37 with the fixtures of `scripts/live/editor-fixtures.ts`.
 *
 * The step tables below are the runbook's table as data: per editor, the ordered tool calls,
 * their arguments, the risk class, whether the 2.0 guard allows them only in `EMCP2_sandbox`, the
 * expectation (checked) and what to record. `--emit-queue` writes them to
 * docs/v2/sessions/queues/FINAL-editors.json (tests/live-harness/final-editors.test.ts keeps the
 * file equal); a real run refuses a stale file. The queue's `probes` list is the pre-flight's
 * step-7 form (validateQueue), one `launch` block per editor and risk run (`<nn>-<Editor>.<n>`).
 *
 * One editor per launch, nothing retried, nothing saved:
 *
 *   lane     `lane.ts start` (the lease); the post-flight releases it
 *   install  `launch.ts --install-handlers <project>` (the 2.0 handlers, runbook rule 3)
 *   launch   `preflight.ts --variant default ... --really` (steps 1-9: the launch and the assert)
 *   steps    the editor's steps in order, through the MCP tools in process (the same tool code
 *            the server serves); after each one `wb_gui modals` on the recorded pid. The first
 *            unexpected dialog, mismatch or timeout ends the editor (recorded, not retried)
 *   close    `postflight.ts ... --really` (one WM_CLOSE; a save prompt is a hazard it reports and
 *            never answers: the owner's Don't Save)
 *   record   one JSONL per editor in the run folder; one evidence record (evidence.ts)
 *
 * Write steps (`sandboxOnly`) run only when the opened project is `EMCP2_sandbox`; elsewhere
 * they are recorded as skipped (the handlers refuse them there, runbook rule 2). The Particle
 * Editor is never read (DEC-042): its plan holds `wb_module open` and `front` only, and the
 * runner refuses any other Workbench call on it before sending. No step saves (`wb_save`,
 * `wb_module save` and `confirm: true` are refused). Hand steps (the owner's double click) are
 * listed and recorded, never performed.
 *
 * Launch gate: the dry-run gate's `launch-not-sandbox` rule (plan 5.1) cannot be lifted, so only
 * `--layout sandbox` (the fixtures regenerated into the sandbox, runbook rule 2) can be launched.
 * `--layout projects` (one fixture project per editor) is planned and checked, and its real run
 * is refused until that rule is ruled on.
 *
 * Usage:
 *   npx --no tsx scripts/live/final-editors.ts --editor <name>|all [--dry-run] [--layout sandbox|projects]
 *       [--sandbox <dir>] [--fixtures <dir>] [--emit-queue <file>]
 *   npx --no tsx scripts/live/final-editors.ts --editor <name> --go --id <lane> --lint passed|triaged
 *       --force-settings <scratch ini> [--sandbox <dir>] [--out-dir <run folder>] [--registry-key <key>]
 *
 * Without `--go` it is a dry run (nothing is launched, spawned or written but `--emit-queue`).
 * Exit: 0 passed, 1 failed or stopped, 2 usage or refused.
 */

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { MODULE_TITLES } from "../census/live/common.js";
import { loadConfig } from "../../src/config.js";
import { moduleAllowsRead, type ModuleId } from "../../src/manifest/vocabulary.js";
import { isMainModule, parseArgs } from "./cli.js";
import { checkPlan, formatResult, type PlanAction } from "./dry-run.js";
import { EDITORS, type Editor } from "./editor-fixtures.js";
import { DEFAULT_EVIDENCE_DIR, writeEvidence } from "./evidence.js";
import { Lane } from "./lane.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  artifactsDir,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { loadPolicy } from "./policy.js";
import { validateQueue } from "./preflight.js";
import { outsideArtifacts } from "./session-common.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SESSION = "FINAL-editors";
export const BUILD = "1.9.0.37";
export const SCRIPT_PATH = "scripts/live/final-editors.ts";
export const RUNBOOK = "docs/v2/sessions/queues/FINAL-editors.md";
export const QUEUE_REL = "docs/v2/sessions/queues/FINAL-editors.json";
export const DEFAULT_QUEUE = join(REPO_ROOT, ...QUEUE_REL.split("/"));
export const LANE = "scripts/live/lane.ts";
export const LAUNCH = "scripts/live/launch.ts";
export const PREFLIGHT = "scripts/live/preflight.ts";
export const POSTFLIGHT = "scripts/live/postflight.ts";
export const SAA = "-scriptAuthorizeAll";
/** Win32 dialog window class: what the mock's accessibility tree marks a dialog with. */
export const DIALOG_CLASS = "#32770";

const FX = "EMCPFixtures";
/** Per editor, the fixture files `planFixtures` writes (the test keeps this equal to the plan). */
export const FIXTURES: Readonly<Record<Editor, readonly string[]>> = {
  WorldEditor: [`worlds/${FX}/FixtureWorld.ent`, `worlds/${FX}/FixtureWorld_Layers/default.layer`],
  ResourceManager: ["et", "conf", "layout", "imageset", "emat", "styles"].map(
    (e) => `${FX}/ResourceManager/Fixture.${e}`,
  ),
  ScriptEditor: [`Scripts/Game/${FX}/EMCP_FixtureScript.c`],
  AnimEditor: ["aw", "agr", "agf", "ast", "asi"].map((e) => `${FX}/AnimEditor/tripods.${e}`),
  AudioEditor: [`${FX}/AudioEditor/Fixture.acp`, `${FX}/AudioEditor/Fixture.sig`],
  BehaviorEditor: [
    `AI/BehaviorTrees/${FX}/Fixture_Guard.bt`,
    `AI/BehaviorTrees/${FX}/Fixture_Animate.bt`,
  ],
  ParticleEditor: [`${FX}/ParticleEditor/Fixture.ptc`],
  ProcAnimEditor: [`${FX}/ProcAnimEditor/Fixture.pap`, `${FX}/ProcAnimEditor/Fixture.siga`],
  LocalizationEditor: [`${FX}/LocalizationEditor/Fixture.st`],
  DialogueEditor: [],
};

/**
 * The fixture types the 1.9 smoke scan answered `resource not registered ... Setting null GUID`
 * for (runbook, smoke result): each gets `wb_resources register` (writes its .meta, the one save
 * the runbook allows) before its editor's steps.
 */
export const UNREGISTERED_EXTS = [
  ".ent",
  ".et",
  ".conf",
  ".emat",
  ".imageset",
  ".layout",
  ".styles",
  ".ptc",
] as const;

const READ_MS = 30_000;
const OPEN_MS = 60_000;
const OFFLINE_MS = 60_000;
const RELOAD_MS = 180_000;

// ── Step model ───────────────────────────────────────────────────────────────

export type Risk = "read-only" | "reversible" | "mutating";
const RISK_ORDER: readonly Risk[] = ["read-only", "reversible", "mutating"];

export interface Expect {
  /** "ok": the tool must answer without error; "any": the answer is recorded, never a mismatch. */
  status: "ok" | "any";
  /** Strings the answer must contain (placeholders resolved). */
  contains?: string[];
  /** Strings the answer must not contain (placeholders resolved). */
  absent?: string[];
}

export interface StepDef {
  id: string;
  /** The MCP tool, or "owner" for a hand step. */
  tool: string;
  /** Arguments; `<project>`, `<gproj>`, `<projectName>` and `<pid>` are resolved at run time. */
  args: Record<string, unknown>;
  risk: Risk;
  /** The 2.0 guard allows it only while `EMCP2_sandbox` is the opened project. */
  sandboxOnly: boolean;
  /** What it writes, or null. Never a Workbench save. */
  writes: string | null;
  /** Reads files only; needs no Workbench (still run inside the launch, in order). */
  offline: boolean;
  /** The owner's hand: listed and recorded, never performed by the orchestrator. */
  hand: boolean;
  expect: Expect;
  expectation: string;
  record: string;
  timeoutMs: number;
  /** Fixture files the step names (derived from its arguments). */
  fixtures: string[];
}

export interface EditorPlan {
  nn: string;
  editor: Editor;
  /** The wb_module id, or null (DialogueEditor is not one yet). */
  module: ModuleId | null;
  fixtures: readonly string[];
  steps: StepDef[];
}

type Draft = Omit<
  StepDef,
  | "id"
  | "fixtures"
  | "risk"
  | "sandboxOnly"
  | "writes"
  | "offline"
  | "hand"
  | "expect"
  | "timeoutMs"
> &
  Partial<
    Pick<StepDef, "risk" | "sandboxOnly" | "writes" | "offline" | "hand" | "expect" | "timeoutMs">
  >;

const d = (
  tool: string,
  args: Record<string, unknown>,
  rest: Omit<Draft, "tool" | "args">,
): Draft => ({ tool, args, ...rest });

/** `<project>/<rel>`: an absolute file path for the offline tools. */
const abs = (rel: string): string => `<project>/${rel}`;
const slug = (s: string): string =>
  s
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

/** A window title pattern for `wb_gui` (it anchors the pattern itself). */
export function windowTitle(editor: Editor): string {
  if (editor === "BehaviorEditor") return "Behavior Editor( - .+)?"; // the title names the project
  const t = MODULE_TITLES[editor]?.pattern;
  return t ? t.replace(/^\^/, "").replace(/\$$/, "") : `${editor}.*`;
}

function registerSteps(editor: Editor): Draft[] {
  return FIXTURES[editor]
    .filter((f) => UNREGISTERED_EXTS.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) =>
      d(
        "wb_resources",
        { action: "register", path: f },
        {
          risk: "mutating",
          writes: `${f}.meta (the one save the runbook allows)`,
          timeoutMs: OPEN_MS,
          expectation:
            "registered: the smoke scan's `resource not registered` warning for this file does not come back",
          record: "the answer and the GUID the .meta now carries",
        },
      ),
    );
}

function commonSteps(editor: Editor, module: ModuleId | null): Draft[] {
  const out: Draft[] = [
    d(
      "wb_module",
      { action: "list" },
      editor === "DialogueEditor"
        ? {
            expect: { status: "ok" },
            expectation: "the 2.0 handlers list ten modules; DialogueEditor is not one of them yet",
            record: "whether a DialogueEditor entry appears anywhere in the answer",
          }
        : {
            expect: { status: "ok", contains: [editor] },
            expectation:
              editor === "ParticleEditor"
                ? "ParticleEditor is listed under unreadModules, never read"
                : `${editor} is listed under modules`,
            record: "modules, unreadModules and open as answered",
          },
    ),
  ];
  if (module && moduleAllowsRead(module))
    out.push(
      d(
        "wb_module",
        { action: "info", module },
        {
          risk: "reversible",
          timeoutMs: OPEN_MS,
          expectation: `${module}'s containers; opens the module if it was closed (GetModule)`,
          record: "the container list and whether the module was opened by this call",
        },
      ),
    );
  out.push(
    d(
      "logs_tail",
      { which: "workbench", session: "latest", channel: "error", lines: 200 },
      {
        expect: { status: "ok", absent: ["<projectName>"] },
        expectation: "no error line naming the project",
        record: "the error lines, if any",
      },
    ),
  );
  return out;
}

const guiTree = (editor: Editor, what: string): Draft =>
  d(
    "wb_gui",
    {
      action: "tree",
      pid: "<pid>",
      windowTitle: windowTitle(editor),
      depth: 12,
      label: slug(`${editor}-${what}`),
    },
    {
      timeoutMs: OPEN_MS,
      expect: { status: "any" },
      expectation: `the ${editor} window's accessibility tree (title pattern from MODULE_TITLES; a miss is recorded)`,
      record: `${what}: window title, class and the tree file`,
    },
  );

const moduleOpen = (module: ModuleId): Draft =>
  d(
    "wb_module",
    { action: "open", module },
    {
      risk: "reversible",
      timeoutMs: OPEN_MS,
      expectation: `${module} opens (Workbench.OpenModule)`,
      record: "the answer and the window that appeared",
    },
  );

/**
 * setResource: the 2.0 guard runs it only in the sandbox, and the tool still refuses every module
 * but the World Editor (WORLD_EDITOR_ONLY, Phase 3): the answer is recorded, never a mismatch.
 */
const setResource = (module: ModuleId, rel: string, what: string): Draft =>
  d(
    "wb_module",
    { action: "setResource", module, target: `path:${rel}` },
    {
      risk: "reversible",
      sandboxOnly: true,
      timeoutMs: OPEN_MS,
      expect: { status: module === "WorldEditor" ? "ok" : "any" },
      expectation:
        module === "WorldEditor"
          ? `${rel} opens in the World Editor`
          : `open question: does setResource reach ${module}? today the tool answers MODULE_NOT_SUPPORTED (World Editor only)`,
      record: `${what}: the answer (code, message) and the window title`,
    },
  );

const resOpen = (
  rel: string,
  expectation: string,
  record: string,
  status: "ok" | "any" = "ok",
): Draft =>
  d(
    "wb_resources",
    { action: "open", path: rel },
    { risk: "reversible", timeoutMs: OPEN_MS, expect: { status }, expectation, record },
  );

const offline = (
  tool: string,
  args: Record<string, unknown>,
  expectation: string,
  record: string,
  status: "ok" | "any" = "ok",
): Draft =>
  d(tool, args, { offline: true, timeoutMs: OFFLINE_MS, expect: { status }, expectation, record });

const hand = (text: string, record: string): Draft =>
  d("owner", { text }, { hand: true, expect: { status: "any" }, expectation: text, record });

function editorSteps(editor: Editor): Draft[] {
  const F = FIXTURES[editor];
  switch (editor) {
    case "WorldEditor": {
      const world = F[0];
      const prefab = "{54C68E438DD34265}Prefabs/Items/Equipment/Radios/Radio_R107M.et";
      const probe = "EMCP_Fixture_Radio_B";
      return [
        resOpen(
          world,
          "the fixture world opens in the World Editor (a sub-scene of Arland)",
          "the window title; the world named in wb_state",
        ),
        d(
          "wb_state",
          {},
          {
            expectation: "edit mode, the fixture world loaded",
            record: "mode and world as answered",
          },
        ),
        d(
          "wb_resources",
          { action: "getInfo", path: F[1] },
          {
            expect: { status: "any" },
            expectation:
              "the world's default layer file (the smoke scan said nothing about .layer)",
            record: "GUID, type and size, or the answer for an unregistered layer",
          },
        ),
        d(
          "wb_entity_list",
          { nameFilter: "EMCP_Fixture_Radio", limit: 50 },
          {
            expect: { status: "ok", contains: ["EMCP_Fixture_Radio"] },
            expectation: `one entity, EMCP_Fixture_Radio, in ${F[1]}`,
            record: "the entity count and names",
          },
        ),
        d(
          "wb_entity_inspect",
          { name: "EMCP_Fixture_Radio" },
          {
            expect: { status: "ok", contains: ["Radio_R107M"] },
            expectation: "the radio prefab at 2056 40.5 2048",
            record: "prefab, coords and components",
          },
        ),
        d(
          "wb_layers",
          { action: "list" },
          {
            expect: { status: "ok", contains: ["default"] },
            expectation: "the default layer of the fixture world",
            record: "the layer list",
          },
        ),
        d(
          "wb_terrain",
          { action: "getHeight", x: 2056, z: 2048 },
          { expectation: "Arland's terrain under the radio", record: "the height" },
        ),
        d(
          "wb_entity_select",
          { action: "select", name: "EMCP_Fixture_Radio" },
          {
            risk: "reversible",
            expectation: "the radio is selected",
            record: "the selection as answered",
          },
        ),
        d(
          "wb_entity_create",
          { prefab, position: "2060 40.5 2048", name: probe },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "one entity in the open world (never saved)",
            expectation: `${probe} is created`,
            record: "the answer and the new entity's name",
          },
        ),
        d(
          "wb_entity_modify",
          { name: probe, action: "move", value: "2064 40.5 2048" },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "the probe entity's position (never saved)",
            expectation: `${probe} moves`,
            record: "the answer",
          },
        ),
        d(
          "wb_undo_redo",
          { action: "undo" },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "undoes the move",
            expectation: "the move is undone",
            record: "the answer",
          },
        ),
        d(
          "wb_entity_delete",
          { name: probe },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "removes the probe entity (never saved)",
            expectation: `${probe} is deleted`,
            record: "the answer",
          },
        ),
      ];
    }
    case "ResourceManager": {
      const [et, conf, layout, imageset, emat, styles] = F;
      const out: Draft[] = [];
      for (const f of F)
        out.push(
          d(
            "wb_resources",
            { action: "getInfo", path: f },
            {
              expectation: `${basename(f)} has a GUID after the register`,
              record: "GUID, type and size",
            },
          ),
          resOpen(
            f,
            `${basename(f)} opens`,
            "P4-9's question: a tab of the Resource Manager window or a window of its own (the windows after the call)",
            "any",
          ),
        );
      out.push(
        setResource("ResourceManager", conf, "the Resource Manager"),
        d(
          "wb_container",
          { action: "describe", target: `path:${conf}` },
          {
            expectation: "the config's top-level rows",
            record: "the row count and the first rows",
          },
        ),
        d(
          "wb_container",
          { action: "get", target: `path:${et}`, path: "components[1].m_fMass" },
          {
            expect: { status: "any" },
            expectation: "the generated prefab's RigidBody mass, 1.0",
            record: "the value; the prefab's parent is given without a GUID: watch the log",
          },
        ),
        offline(
          "prefab",
          { action: "inspect", path: et, projectPath: "<project>" },
          "the generated prop prefab and its parent",
          "the ancestry as answered",
        ),
        offline(
          "material_inspect",
          { material_path: abs(emat) },
          "the copied material's class and parameters",
          "class and parameter count",
        ),
        offline(
          "ui_layout_inspect",
          { layout_path: abs(layout) },
          "the copied layout's widget tree",
          "the root widget and count",
        ),
        offline(
          "ui_layout_inspect",
          { layout_path: abs(imageset) },
          "open question: does the layout reader take an .imageset? (no imageset tool exists)",
          "the answer",
          "any",
        ),
        offline(
          "ui_styles_inspect",
          { styles_path: abs(styles) },
          "the copied styles",
          "the style count",
        ),
      );
      return out;
    }
    case "ScriptEditor": {
      const c = F[0];
      return [
        d(
          "wb_scripts",
          { action: "status" },
          {
            expectation: "the scripts compiled with the project (smoke: they did)",
            record: "the status as answered",
          },
        ),
        d(
          "wb_scripts",
          { action: "validate" },
          {
            risk: "reversible",
            timeoutMs: RELOAD_MS,
            expectation: "no error naming EMCP_FixtureScript",
            record: "the validation result",
          },
        ),
        d(
          "wb_script_editor",
          { action: "openFile", path: c },
          {
            risk: "reversible",
            timeoutMs: OPEN_MS,
            expectation: "the fixture script opens in the Script Editor",
            record: "the answer and the window title",
          },
        ),
        d(
          "wb_script_editor",
          { action: "getLinesCount" },
          { expectation: "the fixture's line count", record: "the count" },
        ),
        d(
          "wb_script_editor",
          { action: "getLine", line: 1 },
          { expectation: "the fixture's first line", record: "the text" },
        ),
        d(
          "wb_script_editor",
          { action: "insertLine", line: 1, text: "// EMCP final pass probe line" },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "one line in the editor buffer (never saved)",
            expectation: "the line is inserted",
            record: "the answer and the new line count",
          },
        ),
        d(
          "wb_script_editor",
          { action: "removeLine", line: 1 },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "removes the probe line (the buffer is back, still dirty: Don't Save)",
            expectation: "the line is removed",
            record: "the answer and the line count",
          },
        ),
        d(
          "wb_scripts",
          { action: "reload", scope: "scripts" },
          {
            risk: "mutating",
            sandboxOnly: true,
            timeoutMs: RELOAD_MS,
            expectation: "the reload compiles",
            record: "the reload answer",
          },
        ),
        offline("script_lint", { script_path: abs(c) }, "no lint error", "the findings"),
        offline(
          "script_analyze",
          { script_path: abs(c) },
          "one class, EMCP_FixtureScript",
          "classes and methods",
        ),
      ];
    }
    case "AnimEditor": {
      const [aw, agr, agf, ast, asi] = F;
      return [
        moduleOpen("AnimEditor"),
        setResource("AnimEditor", aw, "the copied workspace (it names the vanilla graph by GUID)"),
        guiTree(editor, "the Animation Editor"),
        ...[agr, agf, ast, asi].map((f) =>
          offline(
            "animation_graph",
            { action: "inspect", path: f, source: "mod", projectPath: "<project>" },
            `${basename(f)} reads (a copy whose references still point at the vanilla files)`,
            "the summary as answered",
          ),
        ),
      ];
    }
    case "AudioEditor": {
      const [acp, sig] = F;
      return [
        moduleOpen("AudioEditor"),
        setResource("AudioEditor", acp, "the audio project"),
        guiTree(editor, "the Audio Editor"),
        d(
          "wb_container",
          { action: "describe", target: `path:${acp}` },
          {
            expect: { status: "any" },
            expectation: "the audio project's top-level rows",
            record: "the row count and the first rows",
          },
        ),
        resOpen(
          sig,
          "open question: which module opens a .sig",
          "the module and window that opened it",
          "any",
        ),
      ];
    }
    case "BehaviorEditor": {
      const [guard, animate] = F;
      const bt = (action: string, f: string): Draft =>
        offline(
          "behavior_tree",
          { action, path: f, projectPath: "<project>" },
          `${basename(f)}: ${action} answers without an error`,
          `the ${action} outline`,
        );
      return [
        bt("inspect", guard),
        bt("validate", guard),
        bt("inspect", animate),
        bt("validate", animate),
        moduleOpen("BehaviorEditor"),
        setResource(
          "BehaviorEditor",
          guard,
          "Fixture_Guard.bt (the 1.x wb_open_resource did not reach this editor)",
        ),
        guiTree(editor, "Fixture_Guard in the Item explorer"),
        setResource("BehaviorEditor", animate, "Fixture_Animate.bt"),
        guiTree(editor, "Fixture_Animate in the Item explorer"),
        d(
          "behavior_tree",
          {
            action: "edit",
            path: guard,
            projectPath: "<project>",
            ops: [{ op: "set_property", node: "Hold", key: "Period", value: 3 }],
          },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: `${guard} on disk (Hold.Period 2 -> 3); regenerate with editor-fixtures.ts --overwrite`,
            expectation: "Hold's Period is 3 in the file",
            record: "the edit answer",
          },
        ),
        setResource("BehaviorEditor", guard, "Fixture_Guard.bt reopened after the edit"),
        { ...guiTree(editor, "Fixture_Guard after the edit (compare Period)"), sandboxOnly: true },
      ];
    }
    case "ParticleEditor":
      return [
        offline(
          "particle_inspect",
          { particle_path: abs(F[0]) },
          "the copied effect's emitters",
          "the emitter count",
        ),
        moduleOpen("ParticleEditor"),
        d(
          "wb_module",
          { action: "front", module: "ParticleEditor" },
          {
            risk: "reversible",
            expectation: "the Particle Editor window is in front",
            record: "the answer",
          },
        ),
        hand(
          `the owner opens ${F[0]} by double click (the module is never read, DEC-042)`,
          "what the owner saw",
        ),
      ];
    case "ProcAnimEditor": {
      const [pap, siga] = F;
      return [
        moduleOpen("ProcAnimEditor"),
        setResource(
          "ProcAnimEditor",
          pap,
          "the procedural animation (first open of the type by a tool)",
        ),
        guiTree(editor, "the Procedural Animation Editor"),
        resOpen(siga, "first open of a .siga by a tool", "the window title it opens in", "any"),
      ];
    }
    case "LocalizationEditor": {
      const st = F[0];
      const key = "STR_EMCPFixtures_Three";
      return [
        moduleOpen("LocalizationEditor"),
        d(
          "wb_localization",
          { action: "getTable" },
          {
            expect: { status: "any" },
            expectation:
              "open question: is the hand-written .st the project's table (STR_EMCPFixtures_One and _Two)",
            record: "the table answered and whether it names the two keys",
          },
        ),
        d(
          "wb_localization",
          { action: "listLanguages" },
          { expectation: "the language list", record: "the languages" },
        ),
        d(
          "wb_localization",
          { action: "insert", itemId: key, value: "Fixture string three" },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "a third key in the open table (never saved)",
            expectation: `${key} is inserted`,
            record: "the answer",
          },
        ),
        d(
          "wb_localization",
          {
            action: "modify",
            itemId: key,
            property: "Original",
            value: "Fixture string three, modified",
          },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "that key's Original (never saved)",
            expectation: `${key} is modified`,
            record: "the answer",
          },
        ),
        d(
          "wb_localization",
          { action: "delete", itemId: key },
          {
            risk: "mutating",
            sandboxOnly: true,
            writes: "removes the third key (never saved)",
            expectation: `${key} is deleted`,
            record: "the answer",
          },
        ),
        offline(
          "ui_localization_audit",
          { gproj_path: "<gproj>", extra_tables: [abs(st)] },
          "the two keys found in the fixture table",
          "the audit summary",
        ),
      ];
    }
    case "DialogueEditor":
      return [
        {
          ...guiTree("WorldEditor", "a Dialogue Editor entry under the Editors menu"),
          expectation:
            "new in 1.9: is there a Dialogue Editor entry under Editors (read the main window's tree)",
        },
        hand(
          "if the owner opens the Dialogue Editor from the Editors menu: its window title, then wb_gui tree of it",
          "the window title and what it saves, under which extension",
        ),
      ];
  }
}

/** The runbook's ten editors with their steps, ids assigned in order. */
export function buildEditors(): EditorPlan[] {
  return EDITORS.map((editor, i) => {
    const nn = String(i + 1).padStart(2, "0");
    const module = editor === "DialogueEditor" ? null : (editor as ModuleId);
    const drafts = [
      ...registerSteps(editor),
      ...commonSteps(editor, module),
      ...editorSteps(editor),
    ];
    const files = FIXTURES[editor];
    const steps = drafts.map((x, j): StepDef => {
      const text = JSON.stringify(x.args);
      const action = typeof x.args.action === "string" ? x.args.action : "";
      return {
        id: `${nn}-${String(j + 1).padStart(2, "0")}-${slug(`${x.tool}-${action}`)}`,
        tool: x.tool,
        args: x.args,
        risk: x.risk ?? "read-only",
        sandboxOnly: x.sandboxOnly ?? false,
        writes: x.writes ?? null,
        offline: x.offline ?? false,
        hand: x.hand ?? false,
        expect: x.expect ?? { status: "ok" },
        expectation: x.expectation,
        record: x.record,
        timeoutMs: x.timeoutMs ?? READ_MS,
        fixtures: files.filter((f) => text.includes(f)),
      };
    });
    return { nn, editor, module, fixtures: files, steps };
  });
}

// ── Guards ───────────────────────────────────────────────────────────────────

/** Why a step would read the Particle Editor module, or null (DEC-042: its read crashed). */
export function particleRead(
  editor: Editor,
  step: Pick<StepDef, "tool" | "args" | "hand">,
): string | null {
  if (step.hand) return null;
  const a = step.args;
  const action = typeof a.action === "string" ? a.action : "";
  const openOrFront = step.tool === "wb_module" && (action === "open" || action === "front");
  if (a.module === "ParticleEditor" && !openOrFront)
    return `${step.tool} ${action} on ParticleEditor reads the module (only open and front are sent)`;
  if (
    step.tool === "wb_gui" &&
    typeof a.windowTitle === "string" &&
    /particle/i.test(a.windowTitle)
  )
    return "wb_gui on the Particle Editor window reads it";
  if (editor !== "ParticleEditor") return null;
  const allowed =
    step.tool === "logs_tail" ||
    step.tool === "particle_inspect" ||
    (step.tool === "wb_resources" && action === "register") ||
    (step.tool === "wb_module" && (action === "list" || openOrFront));
  return allowed
    ? null
    : `${step.tool} ${action} is not one of the Particle Editor's allowed calls (list, open, front, register, offline)`;
}

/** Why a step would save, or null: the pass never saves (register's .meta is the one write the runbook allows). */
export function saveRefusal(step: Pick<StepDef, "tool" | "args">): string | null {
  if (step.tool === "wb_save") return "wb_save is never sent";
  if (step.args.action === "save") return `${step.tool} save is never sent`;
  if (step.args.confirm === true) return "confirm: true is never sent";
  return null;
}

/** Every problem of the plan the runner would refuse anyway, so the dry run shows it first. */
export function planProblems(editors: EditorPlan[] = buildEditors()): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const e of editors)
    for (const s of e.steps) {
      if (ids.has(s.id)) out.push(`${s.id}: duplicate id`);
      ids.add(s.id);
      const p = particleRead(e.editor, s);
      if (p) out.push(`${s.id}: ${p}`);
      const v = saveRefusal(s);
      if (v) out.push(`${s.id}: ${v}`);
      if (
        s.risk === "mutating" &&
        !s.sandboxOnly &&
        !(s.tool === "wb_resources" && s.args.action === "register")
      )
        out.push(`${s.id}: a mutating step outside the sandbox`);
    }
  return out;
}

// ── Queue ────────────────────────────────────────────────────────────────────

export function launchAction(gproj = `<sandbox>/${SANDBOX_NAME}.gproj`): PlanAction {
  return {
    kind: "launch",
    step: "final-launch",
    target: { gproj } as unknown as PlanAction["target"],
    args: ["-gproj", gproj, "-forceSettings", "<sitting>/final-scratch.ini", SAA],
    ownerGo: "scriptAuthorizeAll",
  } as PlanAction;
}

const KILL =
  "an unexpected dialog (wb_gui modals), a mismatch with `expect`, or a timeout: this editor stops here, nothing retried; the post-flight closes it (Don't Save on any prompt)";

function rollbackOf(s: StepDef): string {
  if (s.tool === "wb_resources" && s.args.action === "register")
    return "the .meta stays (the one save the runbook allows); delete it by hand with the fixture to undo";
  if (s.tool === "behavior_tree")
    return "regenerate the tree: editor-fixtures.ts --out <sandbox> --layout sandbox --overwrite --really";
  if (s.writes) return "never saved: the post-flight's close discards it (Don't Save)";
  return "nothing to roll back";
}

/** The pre-flight's step-7 probes: one launch block per editor and risk run (validateQueue). */
export function queueProbes(
  editors: EditorPlan[] = buildEditors(),
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const e of editors) {
    let block = 1;
    let last = -1;
    for (const s of e.steps) {
      if (s.hand) continue;
      const rank = RISK_ORDER.indexOf(s.risk);
      if (rank < last) block++;
      last = rank;
      out.push({
        id: s.id,
        title: `${e.editor}: ${s.tool} ${JSON.stringify(s.args)}`,
        timeout_ms: s.timeoutMs,
        expected: s.expectation,
        kill_criterion: KILL,
        side_effects: s.writes ? [s.writes] : [],
        rollback: rollbackOf(s),
        risk_class: s.risk,
        launch: `${e.nn}-${e.editor}.${block}`,
        editor: e.editor,
        sandbox_only: s.sandboxOnly,
      });
    }
  }
  return out;
}

export function buildQueue(editors: EditorPlan[] = buildEditors()): Record<string, unknown> {
  return {
    $comment:
      "Generated by `scripts/live/final-editors.ts --emit-queue` from its step tables (the runbook's table as data); tests/live-harness/final-editors.test.ts keeps this file equal and a real run refuses a stale one. `editors`: per editor the ordered steps (tool, args, risk, sandboxOnly, writes, offline, hand, expect, expectation, record). Placeholders <project>, <gproj>, <projectName>, <pid> are resolved at run time. `probes`: the pre-flight's step-7 form; `launch` is `<nn>-<Editor>.<n>`, one block per risk run inside that editor's one launch.",
    session: SESSION,
    script: SCRIPT_PATH,
    runbook: RUNBOOK,
    build: BUILD,
    rules: [
      "one Workbench, one editor per launch; each launch needs the owner's go (--go, one editor at a time); -scriptAuthorizeAll on the standing go (DEC-053)",
      "never saved: no wb_save, no wb_module save, no confirm true; a save prompt is the post-flight's hazard, answered Don't Save by the owner",
      "sandboxOnly steps run only while EMCP2_sandbox is the opened project (the 2.0 guard refuses them elsewhere): skipped and recorded otherwise",
      "the first unexpected dialog, mismatch or timeout stops that editor; nothing is retried",
      "ParticleEditor is never read (DEC-042): wb_module open and front only",
      "wb_resources register first for the types the 1.9 smoke scan reported unregistered: " +
        UNREGISTERED_EXTS.join(" "),
      "launch gate: launch-not-sandbox is unliftable (plan 5.1), so only the sandbox layout launches",
    ],
    unregistered_exts: UNREGISTERED_EXTS,
    editors: editors.map((e) => ({
      nn: e.nn,
      editor: e.editor,
      module: e.module,
      project: `EMCP2_fx_${e.editor}`,
      fixtures: e.fixtures,
      steps: e.steps.map((s) => ({
        id: s.id,
        tool: s.tool,
        args: s.args,
        risk: s.risk,
        sandboxOnly: s.sandboxOnly,
        writes: s.writes,
        offline: s.offline,
        hand: s.hand,
        expect: s.expect,
        expectation: s.expectation,
        record: s.record,
        timeout_ms: s.timeoutMs,
        fixtures: s.fixtures,
      })),
    })),
    probes: queueProbes(editors),
  };
}

/** The queue file as the emitter writes it. */
export const queueText = (): string => JSON.stringify(buildQueue(), null, 2) + "\n";

/** The file holds the queue this script builds (compared as JSON, so formatting does not matter). */
export function queueFileFresh(path: string = DEFAULT_QUEUE): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(readFileSync(path, "utf-8")), JSON.parse(queueText()));
  } catch {
    return false;
  }
}

// ── The runner ───────────────────────────────────────────────────────────────

export interface RunContext {
  /** The opened project's folder (absolute). */
  projectDir: string;
  gproj: string;
  /** The Workbench pid the lane recorded, or null. */
  pid: number | null;
}

export const isSandbox = (projectDir: string): boolean =>
  basename(resolve(projectDir)).toLowerCase() === SANDBOX_NAME.toLowerCase();

export interface ToolOutcome {
  ok: boolean;
  text: string;
  timedOut?: boolean;
}

export interface StepDeps {
  /** One tool call. It never retries; a timeout answers `timedOut`. */
  call: (step: StepDef, args: Record<string, unknown>, timeoutMs: number) => Promise<ToolOutcome>;
  /** The open dialogs of the pid (wb_gui modals); `ok` false when they could not be read. */
  dialogs: (pid: number | null) => Promise<{ ok: boolean; modals: string[]; detail?: string }>;
  heartbeat?: () => void;
  now?: () => number;
}

export type StepStatus =
  | "ok"
  | "recorded"
  | "skipped"
  | "hand"
  | "refused"
  | "mismatch"
  | "error"
  | "timeout"
  | "dialog";

export interface StepRecord {
  type: "step";
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: StepStatus;
  detail: string;
  expectation: string;
  record: string;
  response?: string;
  modals?: string[];
  duration_ms?: number;
}

export interface EditorResult {
  editor: Editor;
  outcome: "passed" | "stopped";
  stoppedAt: string | null;
  reason: string | null;
  records: StepRecord[];
}

const STOPS: ReadonlySet<StepStatus> = new Set([
  "refused",
  "mismatch",
  "error",
  "timeout",
  "dialog",
]);

/** Placeholders of a step's arguments, resolved for one run. */
export function resolveArgs<T>(value: T, ctx: RunContext): T {
  const name = basename(resolve(ctx.projectDir));
  const project = resolve(ctx.projectDir).replace(/\\/g, "/");
  const sub = (s: string): unknown => {
    if (s === "<pid>") return ctx.pid;
    return s
      .replace(/<project>/g, project)
      .replace(/<gproj>/g, resolve(ctx.gproj).replace(/\\/g, "/"))
      .replace(/<projectName>/g, name);
  };
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? sub(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(value) as T;
}

function check(step: StepDef, out: ToolOutcome, ctx: RunContext): string | null {
  if (step.expect.status === "any") return null;
  if (!out.ok) return `the tool answered an error: ${out.text.slice(0, 300)}`;
  for (const c of resolveArgs(step.expect.contains ?? [], ctx))
    if (!out.text.includes(c)) return `the answer does not contain ${JSON.stringify(c)}`;
  for (const a of resolveArgs(step.expect.absent ?? [], ctx))
    if (out.text.includes(a)) return `the answer contains ${JSON.stringify(a)}`;
  return null;
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<T>((r) => {
    timer = setTimeout(() => r(onTimeout), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one editor's steps on the launched Workbench, in order, stopping at the first unexpected
 * dialog, mismatch, timeout or refusal. Sandbox-only steps outside the sandbox and hand steps are
 * recorded and skipped. `onRecord` sees each record as it is made (the JSONL writer).
 */
export async function runEditor(
  plan: EditorPlan,
  ctx: RunContext,
  deps: StepDeps,
  onRecord: (r: StepRecord) => void = () => undefined,
): Promise<EditorResult> {
  const now = deps.now ?? (() => Date.now());
  const sandbox = isSandbox(ctx.projectDir);
  const records: StepRecord[] = [];
  const push = (r: StepRecord): void => {
    records.push(r);
    onRecord(r);
  };
  const base = (s: StepDef, args: Record<string, unknown>) => ({
    type: "step" as const,
    id: s.id,
    tool: s.tool,
    args,
    expectation: s.expectation,
    record: s.record,
  });
  for (const s of plan.steps) {
    const args = resolveArgs(s.args, ctx);
    if (s.hand) {
      push({
        ...base(s, args),
        status: "hand",
        detail: "the owner's hand: not performed by the orchestrator",
      });
      continue;
    }
    if (s.sandboxOnly && !sandbox) {
      push({
        ...base(s, args),
        status: "skipped",
        detail: `not the sandbox: the 2.0 guard runs this only in ${SANDBOX_NAME}`,
      });
      continue;
    }
    const refusal = particleRead(plan.editor, s) ?? saveRefusal(s);
    if (refusal) {
      push({ ...base(s, args), status: "refused", detail: `refused before sending: ${refusal}` });
      return { editor: plan.editor, outcome: "stopped", stoppedAt: s.id, reason: refusal, records };
    }
    deps.heartbeat?.();
    const started = now();
    const out = await withTimeout(deps.call(s, args, s.timeoutMs), s.timeoutMs + 5_000, {
      ok: false,
      text: `no answer within ${s.timeoutMs} ms`,
      timedOut: true,
    });
    const duration_ms = now() - started;
    let status: StepStatus = s.expect.status === "any" ? "recorded" : "ok";
    let detail = out.ok ? "answered" : "answered an error";
    if (out.timedOut) {
      status = "timeout";
      detail = `timed out after ${s.timeoutMs} ms (not retried)`;
    } else {
      const m = check(s, out, ctx);
      if (m) {
        status = out.ok ? "mismatch" : "error";
        detail = m;
      }
    }
    let modals: string[] | undefined;
    if (!STOPS.has(status)) {
      const dl = await deps.dialogs(ctx.pid);
      if (!dl.ok) {
        status = "dialog";
        detail = `the open dialogs could not be read (${dl.detail ?? "no detail"}): stopped`;
      } else if (dl.modals.length) {
        modals = dl.modals;
        status = "dialog";
        detail = `unexpected dialog: ${dl.modals.join(", ")}`;
      }
    }
    push({
      ...base(s, args),
      status,
      detail,
      response: out.text.slice(0, 4_000),
      duration_ms,
      ...(modals ? { modals } : {}),
    });
    if (STOPS.has(status))
      return { editor: plan.editor, outcome: "stopped", stoppedAt: s.id, reason: detail, records };
  }
  return { editor: plan.editor, outcome: "passed", stoppedAt: null, reason: null, records };
}

/** The dialogs of a mock accessibility tree: top-level windows of the dialog class. */
export function dialogsFromUia(root: {
  children?: Array<{ controlType: string; name: string; className?: string }>;
}): string[] {
  return (root.children ?? [])
    .filter((w) => w.controlType === "Window" && w.className === DIALOG_CLASS)
    .map((w) => w.name);
}

// ── One launch ───────────────────────────────────────────────────────────────

export type Layout = "sandbox" | "projects";

export interface ProjectRef {
  projectDir: string;
  gproj: string;
}

export function projectFor(
  editor: Editor,
  layout: Layout,
  roots: { sandbox: string; fixtures: string },
): ProjectRef {
  if (layout === "sandbox")
    return { projectDir: roots.sandbox, gproj: join(roots.sandbox, `${SANDBOX_NAME}.gproj`) };
  const dir = join(roots.fixtures, `EMCP2_fx_${editor}`);
  return { projectDir: dir, gproj: join(dir, "addon.gproj") };
}

export interface LaunchOptions {
  laneId: string;
  lint: string;
  forceSettings: string;
  registryKey?: string;
}

/** The lifecycle commands of one editor's launch, as [script, argv] (the post-flight's evidence files are found after the launch). */
export function lifecycle(
  plan: EditorPlan,
  project: ProjectRef,
  o: LaunchOptions,
): Record<"lane" | "install" | "preflight", [string, string[]]> {
  const purpose = `${SESSION} ${plan.nn} ${plan.editor}`;
  return {
    lane: [LANE, ["start", "--purpose", purpose, "--id", o.laneId]],
    install: [LAUNCH, ["--install-handlers", project.projectDir, "--id", o.laneId, "--really"]],
    preflight: [
      PREFLIGHT,
      [
        "--variant",
        "default",
        "--purpose",
        purpose,
        "--id",
        o.laneId,
        "--queue",
        QUEUE_REL,
        "--sandbox",
        project.projectDir,
        "--gproj",
        project.gproj,
        "--lint",
        o.lint,
        "--force-settings",
        o.forceSettings,
        "--u12-passed",
        "--script-authorize-all",
        "--owner-go-script-authorize-all",
        ...(o.registryKey ? ["--registry-key", o.registryKey] : []),
        "--really",
      ],
    ],
  };
}

export function postflightArgs(
  project: ProjectRef,
  o: LaunchOptions,
  found: { before: string | null; registry: string | null },
): string[] {
  return [
    "--id",
    o.laneId,
    "--sandbox",
    project.projectDir,
    ...(found.before ? ["--before", found.before] : []),
    ...(found.registry ? ["--registry-before", found.registry] : []),
    ...(o.registryKey ? ["--registry-key", o.registryKey] : []),
    "--really",
  ];
}

/** The newest file in `dir` whose name matches `re` and that was written at or after `since`. */
export function newestSince(dir: string, re: RegExp, since: number): string | null {
  let best: { p: string; t: number } | null = null;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const n of names) {
    if (!re.test(n)) continue;
    const p = join(dir, n);
    const t = statSync(p).mtimeMs;
    if (t >= since && (!best || t > best.t)) best = { p, t };
  }
  return best?.p ?? null;
}

export interface LaunchDeps extends StepDeps {
  spawnChild: (script: string, argv: string[]) => Promise<number>;
  recordedPid: () => number | null;
  artifactsRoot: string;
  writeEvidence?: (summary: string, artifact: string) => string | null;
  log: (line: string) => void;
}

/**
 * One editor, one launch: lease, handler install, pre-flight with the launch, the steps, the
 * post-flight (which closes, compares and releases), the JSONL and the evidence record.
 */
export async function runLaunch(
  plan: EditorPlan,
  project: ProjectRef,
  opts: LaunchOptions & { outDir: string },
  deps: LaunchDeps,
): Promise<EditorResult> {
  const ph = defaultPlaceholderContext({
    v2: REPO_ROOT,
    ...(isSandbox(project.projectDir) ? { sandbox: project.projectDir } : {}),
  });
  const file = join(opts.outDir, `${plan.nn}-${plan.editor}.jsonl`);
  mkdirSync(opts.outDir, { recursive: true });
  const line = (o: Record<string, unknown>, flag: "a" | "wx" = "a"): void =>
    (flag === "wx" ? writeFileSync : appendFileSync)(
      file,
      toPlaceholders(JSON.stringify(o), ph) + "\n",
      { encoding: "utf-8", flag },
    );
  line(
    {
      type: "header",
      session: SESSION,
      editor: plan.editor,
      build: BUILD,
      project: project.gproj,
      sandbox: isSandbox(project.projectDir),
      queue: QUEUE_REL,
      started_at: new Date().toISOString(),
    },
    "wx",
  );
  const cmds = lifecycle(plan, project, opts);
  const ran: Array<{ step: string; code: number }> = [];
  const stopped = (reason: string, records: StepRecord[] = []): EditorResult => ({
    editor: plan.editor,
    outcome: "stopped",
    stoppedAt: null,
    reason,
    records,
  });
  const since = Date.now() - 1_000;
  let result: EditorResult;
  const go = async (k: "lane" | "install" | "preflight"): Promise<boolean> => {
    deps.log(`${plan.editor} ${k}: ${toPlaceholders(`${cmds[k][0]} ${cmds[k][1].join(" ")}`, ph)}`);
    const code = await deps.spawnChild(...cmds[k]);
    ran.push({ step: k, code });
    return code === 0;
  };
  if (!(await go("lane"))) {
    result = stopped("lane.ts start refused (the lease is held or orphaned): nothing launched");
    line({ type: "end", outcome: result.outcome, reason: result.reason, lifecycle: ran });
    return result;
  }
  if (!(await go("install"))) result = stopped("the handler install failed: nothing launched");
  else if (!(await go("preflight")))
    result = stopped("the pre-flight stopped (its step and instruction are above)");
  else {
    const pid = deps.recordedPid();
    const ctx: RunContext = { ...project, pid };
    const base = await deps.dialogs(pid); // first look at the pid: the watchdog's baseline
    if (!base.ok)
      result = stopped(
        `the open dialogs could not be read after the launch (${base.detail ?? "no detail"})`,
      );
    else if (base.modals.length)
      result = stopped(`a dialog is open after the launch: ${base.modals.join(", ")}`);
    else
      result = await runEditor(plan, ctx, deps, (r) =>
        line(r as unknown as Record<string, unknown>),
      );
  }
  const found = {
    before: newestSince(deps.artifactsRoot, /^snapshot-before-.*\.json$/, since),
    registry: newestSince(deps.artifactsRoot, /^registry-before-.*\.reg$/, since),
  };
  const post = postflightArgs(project, opts, found);
  deps.log(`${plan.editor} postflight: ${toPlaceholders(`${POSTFLIGHT} ${post.join(" ")}`, ph)}`);
  ran.push({ step: "postflight", code: await deps.spawnChild(POSTFLIGHT, post) });
  line({
    type: "end",
    outcome: result.outcome,
    stopped_at: result.stoppedAt,
    reason: result.reason,
    lifecycle: ran,
  });
  const ev = deps.writeEvidence?.(
    `${plan.editor}: ${result.outcome}${result.stoppedAt ? ` at ${result.stoppedAt}` : ""}${result.reason ? ` (${result.reason})` : ""}; ${result.records.length} steps recorded`,
    file,
  );
  if (ev) deps.log(`evidence: ${toPlaceholders(ev, ph)}`);
  return result;
}

// ── Real dependencies (behind --go only) ─────────────────────────────────────

const TSX_IMPORT = (): string => pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function defaultSpawn(script: string, argv: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      ["--import", TSX_IMPORT(), join(REPO_ROOT, script), ...argv],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      },
    );
    child.on("exit", (code) => res(code ?? 1));
    child.on("error", () => res(1));
  });
}

const textOf = (r: unknown): string =>
  ((r as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .map((c) => c.text ?? "")
    .join("\n");

/** The tools in process: the server's own registration over an in-memory MCP transport. */
export async function mcpStepDeps(lane: Lane): Promise<StepDeps & { close: () => Promise<void> }> {
  process.env.ENFUSION_TOOLSET = "all";
  process.env.ENFUSION_GUI = "1";
  const [{ McpServer }, { Client }, { InMemoryTransport }, { registerTools }, { loadConfig }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/inMemory.js"),
      import("../../src/server.js"),
      import("../../src/config.js"),
    ]);
  const server = new McpServer({ name: "final-editors", version: "0" });
  registerTools(server, loadConfig());
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "final-editors", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<ToolOutcome> => {
    try {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
      return { ok: !(r as { isError?: boolean }).isError, text: textOf(r) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, text: msg, timedOut: /timed? ?out/i.test(msg) };
    }
  };
  return {
    call: (s, args, ms) => callTool(s.tool, args, ms),
    dialogs: async (pid) => {
      if (pid === null) return { ok: false, modals: [], detail: "the lane records no pid" };
      const r = await callTool("wb_gui", { action: "modals", pid }, READ_MS);
      if (!r.ok) return { ok: false, modals: [], detail: r.text.slice(0, 200) };
      try {
        const modals =
          (JSON.parse(r.text) as { readback?: { modals?: Array<{ title?: string }> } }).readback
            ?.modals ?? [];
        return { ok: true, modals: modals.map((m) => m.title ?? "(untitled)") };
      } catch {
        return { ok: false, modals: [], detail: "the modals answer is not JSON" };
      }
    },
    heartbeat: () => void lane.heartbeat(),
    close: () => client.close(),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const VALUED = [
  "editor",
  "layout",
  "sandbox",
  "fixtures",
  "emit-queue",
  "id",
  "lint",
  "force-settings",
  "out-dir",
  "registry-key",
];

export function outline(
  editors: EditorPlan[],
  layout: Layout,
  roots: { sandbox: string; fixtures: string },
): string[] {
  const lines: string[] = [];
  for (const e of editors) {
    const p = projectFor(e.editor, layout, roots);
    const sb = isSandbox(p.projectDir);
    lines.push(
      `${e.nn} ${e.editor} (module ${e.module ?? "none"}): one launch on ${p.gproj}${sb ? "" : " (not the sandbox: write steps skipped)"}`,
    );
    for (const s of e.steps) {
      const mark = s.hand ? "HAND" : s.sandboxOnly && !sb ? "SKIP" : s.offline ? "FILE" : "WB  ";
      lines.push(
        `  ${mark} ${s.id} [${s.risk}${s.sandboxOnly ? ", sandbox" : ""}] ${s.tool} ${JSON.stringify(s.args)}`,
      );
      lines.push(`       expect: ${s.expectation}; record: ${s.record}`);
    }
  }
  return lines;
}

export interface MainOverrides {
  log?: (line: string) => void;
  spawnChild?: (script: string, argv: string[]) => Promise<number>;
  stepDeps?: () => Promise<StepDeps & { close?: () => Promise<void> }>;
  recordedPid?: () => number | null;
  artifactsRoot?: string;
  queueFile?: string;
  writeEvidence?: (summary: string, artifact: string) => string | null;
}

function defaultRoots(o: Record<string, string>): { sandbox: string; fixtures: string } {
  let addons = "<addons>";
  if (!o.sandbox || !o.fixtures) {
    try {
      addons = loadConfig().projectPath || "<addons>";
    } catch {
      addons = "<addons>";
    }
  }
  return {
    sandbox: o.sandbox ?? join(addons, SANDBOX_NAME),
    fixtures: o.fixtures ?? join(addons, "EMCP2_fixtures"),
  };
}

export async function main(argv: string[], over: MainOverrides = {}): Promise<number> {
  const out = over.log ?? ((l: string) => console.log(l));
  // Every printed path in placeholder form (plan 5.2); the sandbox is added once it is known.
  let printPh: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  const log = (l: string): void => out(toPlaceholders(l, printPh));
  let args;
  try {
    args = parseArgs(argv, VALUED);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = args.options;
  if (argv.some((a) => /scriptauthorizeall|script-authorize-all/i.test(a))) {
    log(`refused: ${SAA} is the pre-flight's, never a final-editors argument`);
    return 2;
  }
  const editors = buildEditors();
  if (o["emit-queue"]) {
    mkdirSync(dirname(o["emit-queue"]), { recursive: true });
    writeFileSync(o["emit-queue"], queueText(), "utf-8");
    log(`queue written: ${o["emit-queue"]}`);
    if (!o.editor) return 0;
  }
  if (!o.editor) {
    log(
      "usage: final-editors.ts --editor <name>|all [--dry-run] | --editor <name> --go --id <lane> --lint passed|triaged --force-settings <ini>",
    );
    return 2;
  }
  const picked = o.editor === "all" ? editors : editors.filter((e) => e.editor === o.editor);
  if (!picked.length) {
    log(`unknown editor ${o.editor}: one of ${EDITORS.join(", ")} or all`);
    return 2;
  }
  const layout = (o.layout ?? "sandbox") as Layout;
  if (layout !== "sandbox" && layout !== "projects") {
    log("--layout is sandbox or projects");
    return 2;
  }
  const roots = defaultRoots(o);
  printPh = defaultPlaceholderContext({ v2: REPO_ROOT, sandbox: resolve(roots.sandbox) });
  const go = args.flags.has("go");
  if (go && args.flags.has("dry-run")) {
    log("--go and --dry-run together: pick one");
    return 2;
  }

  // Checks shared by the dry run and the real run.
  let ok = true;
  const problems = planProblems(editors);
  for (const p of problems) log(`PLAN: ${p}`);
  if (problems.length) ok = false;
  const queue = buildQueue(editors);
  try {
    log(`queue: ${validateQueue(queue, false).length} probes, valid (validateQueue)`);
  } catch (e) {
    ok = false;
    log(`queue refused: ${e instanceof Error ? e.message : String(e)}`);
  }
  const qf = over.queueFile ?? DEFAULT_QUEUE;
  const fresh = queueFileFresh(qf);
  if (!fresh) {
    ok = false;
    log(`queue file ${QUEUE_REL} is missing or stale: run --emit-queue ${QUEUE_REL}`);
  }
  const policy = loadPolicy();
  for (const e of picked) {
    const p = projectFor(e.editor, layout, roots);
    const r = checkPlan([launchAction(p.gproj)], policy, { script: SCRIPT_PATH });
    log(`${e.nn} ${e.editor} launch gate: ${r.ok ? "PASS" : formatResult(r)}`);
    if (!r.ok) ok = false;
  }

  if (!go) {
    for (const l of outline(picked, layout, roots)) log(l);
    log(
      `dry run: nothing launched, spawned or written${o["emit-queue"] ? " (but the queue file)" : ""}; a real launch is --editor <name> --go`,
    );
    return ok ? 0 : 1;
  }

  // The real run: one editor, the owner's go, every check passed.
  if (picked.length !== 1) {
    log("refused: --go runs one editor (each launch needs the owner's go)");
    return 2;
  }
  if (layout !== "sandbox") {
    log(
      "refused: the projects layout fails the launch gate (launch-not-sandbox, unliftable, plan 5.1); use --layout sandbox",
    );
    return 2;
  }
  for (const k of ["id", "lint", "force-settings"]) {
    if (!o[k]) {
      log(`refused: --go needs --${k}`);
      return 2;
    }
  }
  if (!ok) {
    log("refused: a check above failed; nothing launched");
    return 2;
  }
  const plan = picked[0];
  const project = projectFor(plan.editor, layout, roots);
  if (!isSandbox(project.projectDir) || !existsSync(project.gproj)) {
    log(`refused: ${project.gproj} is not an existing ${SANDBOX_NAME} project`);
    return 2;
  }
  const artifactsRoot = over.artifactsRoot ?? artifactsDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = o["out-dir"] ?? join(artifactsRoot, "sessions", SESSION, stamp);
  const outside = outsideArtifacts(outDir, artifactsRoot);
  if (outside) {
    log(`refused: ${outside}`);
    return 2;
  }
  const lane = new Lane({ id: o.id });
  const sd = await (over.stepDeps ?? (() => mcpStepDeps(lane)))();
  try {
    const ph: PlaceholderContext = defaultPlaceholderContext({
      v2: REPO_ROOT,
      sandbox: project.projectDir,
    });
    const r = await runLaunch(
      plan,
      project,
      {
        laneId: o.id,
        lint: o.lint,
        forceSettings: o["force-settings"],
        registryKey: o["registry-key"],
        outDir,
      },
      {
        ...sd,
        spawnChild: over.spawnChild ?? defaultSpawn,
        recordedPid: over.recordedPid ?? (() => lane.recordedPid()),
        artifactsRoot,
        writeEvidence:
          over.writeEvidence ??
          ((summary, artifact) =>
            writeEvidence(
              DEFAULT_EVIDENCE_DIR,
              SESSION,
              {
                ran: `${SCRIPT_PATH} --editor ${plan.editor} --go`,
                build: BUILD,
                result_summary: summary,
                artifacts: [artifact],
              },
              ph,
            ).path),
        log,
      },
    );
    log(
      `${plan.editor}: ${r.outcome}${r.stoppedAt ? ` at ${r.stoppedAt}` : ""}${r.reason ? `: ${r.reason}` : ""}`,
    );
    log(`results: ${toPlaceholders(join(outDir, `${plan.nn}-${plan.editor}.jsonl`), ph)}`);
    return r.outcome === "passed" ? 0 : 1;
  } finally {
    await sd.close?.();
  }
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
