/**
 * L10, the module matrix of the Phase 4 live GUI census (design `docs/v2/design/phase4-live-census.md`
 * section 4 and D12/D13; plan 4.5). A re-check per sitting of what Phase 2 learned about the ten
 * Workbench modules, through the shipped `wb_module` tool (`list`, `open`, `front`, `info`):
 *
 *   p4-l10-00-list        read-only: `wb_module list`; the ten ids are present, DialogueEditor is absent
 *   p4-l10-NN-<Module>    reversible, one per module of the nine that may be read: `open`, `front`, `info`
 *                         (`info` calls GetModule, which OPENS a closed module, DEC-053), then the window
 *                         list is read for that module's window title; one `module` line per module
 *
 * ParticleEditor is never sent (DEC-042: its module read crashed the Workbench): no call names it, no
 * plan entry names it. It gets one `module` line from the `list` answer alone, confidence medium.
 *
 * Each module step lists the title it expects as `expectsWindows`; any other new window stops it
 * (common.ts `windowVerdict`), a dialog-like one hands off. The module window titles are those of
 * EV-S-E-044 and train2; the Resource Manager and Navmesh Generator titles are [unverified]: the title
 * found is recorded in the step's artifact and in the line's `unverified`. A `LOST`, `WEDGED` or
 * `MODAL_OPEN` answer ends the run (never retried); any other refusal is recorded as `fail`.
 *
 * Nothing is typed, no key is sent, no menu is invoked. Container counts (`containerCount`,
 * `containerClasses` of `info`) go to the step's artifact `L10-<Module>-module.json`, which each line's
 * `ref` cites by sha256 (the line type has no field for them).
 *
 *   npx --no tsx scripts/census/live/L10-modules.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/census/live/L10-modules.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module Shared [--from|--only <step>]
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runModule, type ModuleArgs } from "../../../src/tools/wb-module.js";
import { MODULE_IDS, moduleAllowsRead, type ModuleId } from "../../../src/manifest/vocabulary.js";
import { WorkbenchClient } from "../../../src/workbench/client.js";
import type { PlanAction } from "../../live/dry-run.js";
import { DEFAULT_PORT } from "../../live/netcall.js";
import { toPlaceholders } from "../../live/paths.js";
import { runPowerShell } from "../../live/powershell.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../live/s-c-natives.js";
import {
  EDITOR_WINDOW_CLASS,
  MODULE_TITLES,
  StopBattery,
  isMainModule,
  runWalker,
  type LiveObservation,
  type WalkerDef,
  type WalkerStep,
  type WalkerStepContext,
} from "./common.js";

// ── The matrix ───────────────────────────────────────────────────────────────

/** Titles World Editor's open fans out (train2 WORLD_EDITOR_WINDOWS, DEC-045): expected on that step. */
const DEBUG_TITLE =
  /^Script Editor - (Debugging: ArmaReforgerWorkbenchSteamDiag\.exe on port: \d+ - )?Configuration: WORKBENCH$/;
const WE_TITLE = /^World Editor( - .+)?$/;
const RM_TITLE = /^Enfusion Workbench( - .+)?$/;

export interface ModuleRow {
  /**
   * NavmeshGeneratorMain left MODULE_IDS with build 1.9.0.37 (W5 OD-5, DEC-068); this P4-1 battery
   * keeps its row as it was run on 1.8.
   */
  id: Exclude<ModuleId, "ParticleEditor"> | "NavmeshGeneratorMain";
  /** The window title the module is expected to show. */
  title: RegExp;
  /** Other windows the step may add besides its own (a fan-out). */
  alsoExpects: readonly RegExp[];
  /** The title is not yet seen live. */
  titleUnverified: boolean;
}

/** The nine modules `wb_module` reads, in step order. */
export const MODULE_MATRIX: readonly ModuleRow[] = [
  { id: "LocalizationEditor", title: /^String Editor$/, alsoExpects: [], titleUnverified: false },
  {
    id: "BehaviorEditor",
    title: /^Behavior Editor - EMCP2_sandbox$/,
    alsoExpects: [],
    titleUnverified: false,
  },
  { id: "AudioEditor", title: /^Audio Editor$/, alsoExpects: [], titleUnverified: false },
  { id: "AnimEditor", title: /^Animation Editor$/, alsoExpects: [], titleUnverified: false },
  {
    id: "ProcAnimEditor",
    title: /^Procedural Animation Editor$/,
    alsoExpects: [],
    titleUnverified: false,
  },
  { id: "ScriptEditor", title: DEBUG_TITLE, alsoExpects: [], titleUnverified: false },
  {
    id: "WorldEditor",
    title: WE_TITLE,
    alsoExpects: [
      DEBUG_TITLE,
      RM_TITLE,
      /^Procedural Animation Editor$/,
      /^String Editor$/,
      /^Behavior Editor - EMCP2_sandbox$/,
      /^Audio Editor$/,
      /^Animation Editor$/,
    ],
    titleUnverified: false,
  },
  { id: "ResourceManager", title: RM_TITLE, alsoExpects: [], titleUnverified: true },
  {
    id: "NavmeshGeneratorMain",
    // common.ts MODULE_TITLES (P4-1 2026-10-12: the window read live is "Arma Reforger Workbench").
    title: new RegExp(MODULE_TITLES.NavmeshGeneratorMain.pattern),
    alsoExpects: [],
    titleUnverified: MODULE_TITLES.NavmeshGeneratorMain.unverified,
  },
];

/**
 * The module ids `list` answers in `modules` (P3-3 gate 1, p33-g1-04: nine, ParticleEditor not among
 * them but in `unread`, DialogueEditor absent).
 */
export const EXPECTED_LISTED: readonly string[] = [
  ...MODULE_IDS.filter((m) => m !== "ParticleEditor"),
  // Listed on 1.8, where P4-1 ran; it left MODULE_IDS with 1.9.0.37 (W5 OD-5, DEC-068).
  "NavmeshGeneratorMain",
].sort();

const STEP_PREFIX = "p4-l10";
export const LIST_STEP = `${STEP_PREFIX}-00-list`;
export const moduleStepId = (n: number, id: string): string =>
  `${STEP_PREFIX}-${String(n).padStart(2, "0")}-${id}`;

const WINDOW_KILL =
  "a new window the step does not expect: STOP and record; a dialog or a disabled window: HANDOFF (owner hand, nothing sent to it); LOST, WEDGED: STOP, never retried; MODAL_OPEN: HANDOFF";

// ── Plan entries ─────────────────────────────────────────────────────────────

function net(apiFunc: string, params: Record<string, unknown>, note: string): PlanAction {
  return { kind: "net-call", target: apiFunc, params, note } as PlanAction;
}

const moduleNet = (params: Record<string, unknown>, note: string): PlanAction =>
  net("EMCP_WB_Module", params, note);

// ── Dependencies (a fake in tests) ───────────────────────────────────────────

export interface L10Response {
  ok: boolean;
  code?: string;
  message?: string;
  readback?: unknown;
  warnings?: string[];
}

export interface L10Deps {
  /** One shipped `wb_module` call. */
  tool: (args: ModuleArgs) => Promise<L10Response>;
  /** Every top-level window (s-c-natives WINDOWS_SCRIPT). */
  windows: () => Promise<WindowInfo[]>;
  /** Write an artifact file (text) and create its folder. */
  writeArtifact: (path: string, text: string) => void;
}

/** The live dependencies: a client without a Config, the PowerShell window list, plain files. */
export function realL10Deps(port: number = DEFAULT_PORT): L10Deps {
  let client: WorkbenchClient | null = null;
  return {
    tool: async (args) => {
      client ??= new WorkbenchClient("127.0.0.1", port);
      return (await runModule(client, args)) as unknown as L10Response;
    },
    windows: async () => {
      const r = await runPowerShell(WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    writeArtifact: (p, t) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, t, "utf-8");
    },
  };
}

// ── Step bodies ──────────────────────────────────────────────────────────────

/** The one gate on every call: ParticleEditor is never sent (DEC-042), a read-refused module neither. */
export function assertSendable(args: ModuleArgs): void {
  if (args.module === "ParticleEditor" || (args.module && !moduleAllowsRead(args.module)))
    throw new StopBattery("stopped", `${args.module} is never sent (DEC-042)`);
  if (args.action === "close" || args.action === "action" || args.action === "save")
    throw new StopBattery("stopped", `L10 never sends wb_module ${args.action}`);
}

/** A kernel answer that ends the run: lost, wedged or a modal in the way. */
function fatalAnswer(r: L10Response, what: string): void {
  if (r.ok) return;
  if (r.code === "MODAL_OPEN")
    throw new StopBattery("handoff", `${what}: MODAL_OPEN, a modal is up: owner hand`);
  if (r.code === "LOST" || r.code === "WEDGED")
    throw new StopBattery("stopped", `${what}: ${r.code}, never retried`);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Redact, write and hash one artifact; the sha256 is of the file as written. */
function storeArtifact(
  deps: L10Deps,
  ctx: WalkerStepContext,
  name: string,
  value: unknown,
): { path: string; sha256: string } {
  const text = toPlaceholders(JSON.stringify(value, null, 2) + "\n", ctx.opts.ph);
  const path = join(dirname(ctx.obsPath), name);
  deps.writeArtifact(path, text);
  return { path, sha256: createHash("sha256").update(text, "utf-8").digest("hex") };
}

const line = (
  module: ModuleId,
  ref: string,
  confidence: LiveObservation["confidence"],
  unverified: string[],
  windowClass?: string,
): LiveObservation => ({
  dim: "ui",
  kind: "module",
  module,
  key: { path: [module] },
  parent_key: null,
  origin: "vanilla",
  label: module,
  label_raw: module,
  ...(windowClass ? { locator: { windowClass } } : {}),
  observed_state: {},
  modal: "none",
  risk_hint: "safe",
  ref,
  confidence,
  ...(unverified.length ? { unverified } : {}),
});

/** Windows of the recorded pid that look like the module's own (editor class, unowned). */
function ownWindows(all: readonly WindowInfo[], pid: number, row: ModuleRow): WindowInfo[] {
  return all.filter(
    (w) =>
      w.pid === pid &&
      w.className === EDITOR_WINDOW_CLASS &&
      w.owner === 0 &&
      row.title.test(w.title),
  );
}

function listStep(deps: L10Deps, seen: { listed: Set<string> | null }): WalkerStep {
  return {
    id: LIST_STEP,
    title:
      "wb_module list: nine readable ids, ParticleEditor under unread, DialogueEditor absent; ParticleEditor row from the list alone",
    risk: "read-only",
    timeout_ms: 60_000,
    expected: `list ok; modules ${EXPECTED_LISTED.join(", ")}; no window opens`,
    kill_criterion: WINDOW_KILL,
    side_effects: [],
    rollback: "none",
    plan: () => [moduleNet({ action: "list" }, "wb_module list: names only, no GetModule")],
    run: async (ctx) => {
      const r = await ctx.call("wb_module list", () => deps.tool({ action: "list" }));
      fatalAnswer(r, "wb_module list");
      const rb = asRecord(r.readback);
      const modules = strs(rb.modules);
      const unread = strs(rb.unread);
      const missing = EXPECTED_LISTED.filter((m) => !modules.includes(m));
      const extra = modules.filter((m) => !EXPECTED_LISTED.includes(m));
      if (r.ok) seen.listed = new Set(modules);
      const art = storeArtifact(deps, ctx, "L10-list.json", {
        step: LIST_STEP,
        ok: r.ok,
        code: r.code ?? null,
        modules,
        open: strs(rb.open),
        unread,
        missing,
        extra,
        dialogueEditorListed: [...modules, ...unread].includes("DialogueEditor"),
      });
      const particle = r.ok && [...modules, ...unread].includes("ParticleEditor");
      if (particle) {
        ctx.emit([
          line("ParticleEditor", `artifact:${art.sha256}#list/ParticleEditor`, "medium", [
            "named by wb_module list only (unread): never opened, fronted or read (DEC-042)",
          ]),
        ]);
      }
      const dialogue = [...modules, ...unread].includes("DialogueEditor");
      const clean = r.ok && !missing.length && !extra.length && particle && !dialogue;
      return {
        status: clean ? "pass" : "fail",
        summary: r.ok
          ? `${modules.length} listed; open [${strs(rb.open).join(", ")}]; unread [${unread.join(", ")}]; missing [${missing.join(", ")}]; extra [${extra.join(", ")}]; ParticleEditor ${particle ? "named" : "NOT named"}; DialogueEditor ${dialogue ? "LISTED" : "absent"}`
          : `list refused: ${r.code ?? "?"}`,
        artifacts: [art],
      };
    },
  };
}

function moduleStep(
  deps: L10Deps,
  seen: { listed: Set<string> | null },
  row: ModuleRow,
  index: number,
): WalkerStep {
  const id = moduleStepId(index, row.id);
  return {
    id,
    title: `wb_module open, front, info on ${row.id}; its window title ${row.title.source}${row.titleUnverified ? " [unverified]" : ""}`,
    // Design 4 and 6: GetModule opens a closed module and wb_module close is refused (DEC-045),
    // so the rollback is the owner's: a mutating step.
    risk: "mutating",
    timeout_ms: 3 * 60_000,
    expected: `open ok, front ok, info ok with isOpen true; the ${row.id} window shows a title matching ${row.title.source}; container count recorded`,
    kill_criterion: WINDOW_KILL,
    side_effects: [`the ${row.id} window opens (GetModule opens a closed module, DEC-053)`],
    rollback: "the owner's close at the end of the launch (wb_module close is refused, DEC-045)",
    expectsWindows: [row.title, ...row.alsoExpects],
    plan: () => [
      moduleNet({ action: "open", moduleName: row.id }, "wb_module open"),
      net("BringModuleWindowToFront", { ModuleName: row.id }, "wb_module front: the native"),
      moduleNet(
        { action: "info", moduleName: row.id },
        "wb_module info: GetModule, opens a closed module",
      ),
    ],
    run: async (ctx) => {
      if (seen.listed && !seen.listed.has(row.id)) {
        return { status: "fail", summary: `${row.id} is not in the list answer: nothing sent` };
      }
      const call = async (action: "open" | "front" | "info"): Promise<L10Response> => {
        // A 1.8 row (NavmeshGeneratorMain) is sent as recorded; 1.9 refuses it (W5 OD-5).
        const args: ModuleArgs = { action, module: row.id as ModuleId };
        assertSendable(args);
        const r = await ctx.call(`wb_module ${action} ${row.id}`, () => deps.tool(args));
        fatalAnswer(r, `wb_module ${action} ${row.id}`);
        return r;
      };
      const open = await call("open");
      const front = open.ok ? await call("front") : null;
      const info = open.ok ? await call("info") : null;
      const ib = asRecord(info?.readback);
      const isOpen = ib.isOpen === true;
      const containerClasses = strs(ib.containerClasses);
      const containerCount = typeof ib.containerCount === "number" ? ib.containerCount : null;
      // The window may take a moment to take its title (se-08: about 2 s).
      let found: WindowInfo[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        found = ownWindows(await ctx.call("window list", () => deps.windows()), ctx.pid, row);
        if (found.length || !open.ok) break;
        await ctx.sleep(2_000);
      }
      const title = found[0]?.title ?? null;
      const art = storeArtifact(deps, ctx, `L10-${row.id}-module.json`, {
        step: id,
        module: row.id,
        expectedTitle: row.title.source,
        titleUnverified: row.titleUnverified,
        open: { ok: open.ok, code: open.code ?? null, readback: open.readback ?? null },
        front: front
          ? { ok: front.ok, code: front.code ?? null, readback: front.readback ?? null }
          : null,
        info: info
          ? { ok: info.ok, code: info.code ?? null, readback: info.readback ?? null }
          : null,
        isOpen,
        containerCount,
        containerClasses,
        windowTitle: title,
        windowClass: found[0]?.className ?? null,
      });
      const notes: string[] = [];
      if (!open.ok) notes.push(`open refused: ${open.code ?? "?"}`);
      if (front && !front.ok) notes.push(`front refused: ${front.code ?? "?"}`);
      if (info && !info.ok) notes.push(`info refused: ${info.code ?? "?"}`);
      if (info?.ok && !isOpen) notes.push("info answered isOpen false");
      if (!title) notes.push("no window with the expected title was found");
      if (row.titleUnverified && title)
        notes.push(`window title recorded live: ${title} (the pattern was [unverified])`);
      const good = open.ok && front?.ok === true && info?.ok === true && isOpen && title !== null;
      ctx.emit([
        line(
          row.id as ModuleId,
          `artifact:${art.sha256}#module/${row.id}`,
          good ? "high" : info?.ok && isOpen ? "medium" : "low",
          notes,
          found[0]?.className,
        ),
      ]);
      return {
        status: good ? "pass" : "fail",
        summary: `${row.id}: open ${open.ok ? "ok" : (open.code ?? "refused")}, front ${front ? (front.ok ? "ok" : (front.code ?? "refused")) : "skipped"}, info ${info ? (info.ok ? `ok isOpen ${isOpen}` : (info.code ?? "refused")) : "skipped"}; containers ${containerCount ?? "?"} [${containerClasses.join(", ")}]; title ${title ?? "not found"}`,
        artifacts: [art],
      };
    },
  };
}

// ── The walker ───────────────────────────────────────────────────────────────

export function buildL10Steps(deps: L10Deps): WalkerStep[] {
  const seen: { listed: Set<string> | null } = { listed: null };
  return [
    listStep(deps, seen),
    ...MODULE_MATRIX.map((row, i) => moduleStep(deps, seen, row, i + 1)),
  ];
}

export function makeL10Def(deps: () => L10Deps): WalkerDef {
  return {
    enumerator: "L10",
    script: "scripts/census/live/L10-modules.ts",
    session: "P4-1",
    defaultModule: "Shared",
    steps: () => buildL10Steps(deps()),
  };
}

let real: L10Deps | null = null;
export const def: WalkerDef = makeL10Def(() => (real ??= realL10Deps()));

if (isMainModule(import.meta.url)) {
  runWalker(def, process.argv.slice(2)).then((c) => process.exit(c));
}
