/**
 * L15, the Diag Menu and debug-panel walk (PLAN 4.5 L15; design `docs/v2/design/phase4-live-census.md`
 * section 4, row L15; universes.json L15: kinds diag-menu, diag-option, debug-panel).
 *
 * Two steps per mode, both read-only:
 *
 *   p4-l15-<mode>-walk   one passive `uia-read` (tools/uia/walk.ts) of the World Editor window. The
 *                        Diag Menu and DbgUI panels are drawn by the engine inside the render window
 *                        (P3-3 walk: `WorldRenderWindowQt` is a childless Group), so UIA is expected to
 *                        expose none of them. Any node whose name or automation id says "diag" or
 *                        "debug" becomes a `debug-panel` line; the render window's child count is
 *                        recorded as the evidence for "not exposed".
 *   p4-l15-<mode>-diag   the probe pack's `diagRead` (U34, DEC-042: answered in edit mode) once per
 *                        SCR_DebugMenuID option the E14 rows name, by enum name only. Never `diagSet`
 *                        (that is the mutating pack's), never `diagMenu` (it calls SelectMenuByName,
 *                        which changes the shown menu), never an engine id (the compiled engine list is
 *                        empty). An answered read becomes a `diag-option` line with E14's key, so the
 *                        build reconciles it against the E14 row; a reconcile file lists what E14 has
 *                        and this step could or could not read.
 *
 * Edit mode is the default (`--state` absent: mode=edit, selection=none) and is what the P4-1 queue
 * holds. Play mode is a separate block: `--state mode=play` gives the `p4-l15-play-*` steps only, run
 * in a later sitting with `--session` naming it.
 *
 * Usage (design 2.1):
 *   npx --no tsx scripts/census/live/L15-diag.ts [--out plan.json] [--outline file] [--emit-queue q.json]
 *   npx --no tsx scripts/census/live/L15-diag.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module WorldEditor [--state mode=play] --from|--only <step>
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LANE_RECORDED_PID, type PlanAction } from "../../live/dry-run.js";
import { netCall, DEFAULT_PORT } from "../../live/netcall.js";
import { REPO_ROOT, toPlaceholders } from "../../live/paths.js";
import { DEFAULT_BOUNDS as WALK_DEFAULT_BOUNDS } from "../../../tools/uia/walk.js";
import {
  EDITOR_WINDOW_CLASS,
  MODULE_TITLES,
  chooseKey,
  isMainModule,
  laneArgv,
  normalizeLabel,
  runWalker,
  stateTag,
  StopBattery,
  type LiveObservation,
  type ObservedState,
  type WalkerDef,
  type WalkerOptions,
  type WalkerStep,
  type WalkerStepContext,
} from "./common.js";
import type { WindowInfo } from "../../live/s-c-natives.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SCRIPT = "scripts/census/live/L15-diag.ts";
export const ENUMERATOR = "L15";
/** The probe pack's one NET function (s-d-train1 PROBE_API). */
export const PROBE_API = "ECEN_Probe";
/**
 * The E14 file of the census build (`current-build.json`). P4-5 2026-11-13: the path was pinned to
 * 1.8.0.13 and the 1.9.0.37 play block planned 201 options from it; the 1.9.0.37 E14 file names
 * 204 (DEBUGUI_CHARACTER_HYDRATION_STAMINA_BOOST, DEBUGUI_VEHICLES_SOUNDIMPACT_DIAG and
 * DEBUGUI_AMBIENT_VEHICLE_SPAWNER are new), so those three were never read.
 */
export function e14PathFor(dataDir: string = join(REPO_ROOT, "data", "census")): string {
  const { tag } = JSON.parse(readFileSync(join(dataDir, "current-build.json"), "utf-8")) as {
    tag: string;
  };
  return join(dataDir, "observations", "E14", `${tag}.jsonl`);
}
/** The E14 rows this walk reconciles against: the census build's file. */
export const E14_PATH = e14PathFor();
/** World Editor main window (P3-3 walk: class Qt683QWindowIcon, title "World Editor - <world>"). */
export const WE_WINDOW = {
  className: EDITOR_WINDOW_CLASS,
  titlePattern: MODULE_TITLES.WorldEditor.pattern,
};
/** The module window's object name, the parent of every debug-panel line. */
export const WE_OBJECT_NAME = "worldEditorMain";
/** The engine-drawn viewport (P3-3 walk node 0/15/0/0/0). */
export const RENDER_WINDOW_CLASS = "WorldRenderWindowQt";
/** Per-call timeout of one diagRead (S-D sd-05 answered in 5 to 15 ms). */
export const PROBE_TIMEOUT_MS = 10_000;
/** A node naming a diag or debug surface. */
export const DEBUG_NAME = /diag|debug/i;
/** The only probe parameters a plan may carry: action diagRead and a diagEnum. */
export const ALLOWED_PARAMS: readonly string[] = ["action", "diagEnum"];
/**
 * E14 script options the diag step never reads. DEBUGUI_TASKS_CREATE: P4-1 2026-10-12, the first
 * hand-free run's diag step stopped on a `#32770 "Enfusion engine"` message box after
 * DEBUGUI_DATA_COLLECTION_ENABLE_DIAG answered; DEBUGUI_TASKS_CREATE is the next option in E14
 * order, so the read in flight when the box came up (suspected, not proven: the 2 s window poll
 * cannot pin the read; the per-read window check below can). The pack itself does not refuse it yet.
 */
export const DIAG_READ_HAZARDS: readonly string[] = ["DEBUGUI_TASKS_CREATE"];

/** A message box or a disabled window of the pid that was not in `before` (a modal is up). */
export function modalAfter(
  before: readonly WindowInfo[],
  now: readonly WindowInfo[],
  pid: number,
): WindowInfo | null {
  const had = new Set(
    before.filter((w) => w.className === "#32770" || !w.enabled).map((w) => w.hwnd),
  );
  return (
    now.find(
      (w) => w.pid === pid && (w.className === "#32770" || w.enabled === false) && !had.has(w.hwnd),
    ) ?? null
  );
}

// ── E14 ──────────────────────────────────────────────────────────────────────

export interface E14Option {
  enumName: string;
  path: string[];
  parentPath: string[];
}

export interface E14Index {
  /** Script options with a SCR_DebugMenuID id, in file order. */
  script: E14Option[];
  /** Options whose id is an engine id (`ns::NAME`): not readable while the engine list is empty. */
  engine: number;
  /** Diag menus (no read names a menu without SelectMenuByName). */
  menus: number;
  options: number;
}

/** The E14 rows' SCR_DebugMenuID options (from the `what` text "Id SCR_DebugMenuID.<NAME>"). */
export function indexE14(text: string): E14Index {
  const out: E14Index = { script: [], engine: 0, menus: 0, options: 0 };
  const seen = new Set<string>();
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const l = JSON.parse(raw) as Record<string, unknown>;
    if (l.$header) continue;
    if (l.kind === "diag-menu") out.menus++;
    if (l.kind !== "diag-option") continue;
    out.options++;
    const what = typeof l.what === "string" ? l.what : "";
    const m = /\bSCR_DebugMenuID\.([A-Z0-9_]+)\b/.exec(what);
    const key = l.key as { path?: string[] };
    const parent = l.parent_key as { key?: { path?: string[] } } | null;
    if (m && key?.path && parent?.key?.path && !seen.has(m[1])) {
      seen.add(m[1]);
      out.script.push({ enumName: m[1], path: key.path, parentPath: parent.key.path });
    } else if (/ Id \w+::\w+/.test(what)) out.engine++;
  }
  return out;
}

// ── Kernel (injected; the test passes a fake) ───────────────────────────────

export interface WalkNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  childCount?: number;
  children?: WalkNode[];
}

export interface WalkResult {
  doc: { tree: WalkNode; completed?: boolean | null; partial?: boolean | null };
  path: string;
  sha256: string;
}

export interface ProbeAnswer {
  ok: boolean;
  response?: unknown;
  error?: string;
  timedOut?: boolean;
}

export interface L15Kernel {
  e14Text: () => string;
  /** The passive walk of the World Editor window into `outPath` (tools/uia/walk.ts). */
  walk: (ctx: WalkerStepContext, outPath: string) => Promise<WalkResult>;
  /** One probe-pack call; params are only ALLOWED_PARAMS. */
  probe: (params: Record<string, string>, timeoutMs: number) => Promise<ProbeAnswer>;
  /** Write a run-folder artifact (already redacted) and return its sha256. */
  writeArtifact: (path: string, text: string) => string;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * The walk result from walk.ts's exit code and stdout. Its last line's `out` is placeholdered
 * (`%LOCALAPPDATA%\...`, walk.ts toPlaceholders), so the file is read at `outPath`, the path the
 * step passed (P4-1 2026-10-12: reading `summary.out` threw ENOENT inside the child's close
 * handler, an uncaught exception that crashed L15). Throws; the caller rejects.
 */
export function walkResultFrom(
  code: number | null,
  stdout: string,
  outPath: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf-8"),
): WalkResult {
  const last = stdout.trim().split(/\r?\n/).pop() ?? "";
  let summary: { out?: string | null; sha256?: string | null } = {};
  try {
    summary = JSON.parse(last) as typeof summary;
  } catch {
    throw new Error(`walk.ts exit ${code}: its last line is not JSON`);
  }
  if (code !== 0 || !summary.out || !summary.sha256)
    throw new Error(`walk.ts exit ${code}: no walk file`);
  let doc: WalkResult["doc"];
  try {
    doc = JSON.parse(read(outPath)) as WalkResult["doc"];
  } catch (e) {
    throw new Error(
      `walk.ts exit ${code}: the walk file does not read back (${(e as Error).message})`,
    );
  }
  return { doc, path: outPath, sha256: summary.sha256 };
}

/** The real kernel: walk.ts in a child process (the step's `ctx.lane`), netcall.ts for the probe. */
export function realKernel(): L15Kernel {
  return {
    e14Text: () => readFileSync(E14_PATH, "utf-8"),
    walk: (ctx, outPath) =>
      new Promise((resolveWalk, reject) => {
        if (!ctx.lane.id) {
          reject(new StopBattery("stopped", "no --id: walk.ts needs this lane's id"));
          return;
        }
        const args = [
          "--import",
          "tsx",
          join(REPO_ROOT, "tools", "uia", "walk.ts"),
          "--pid",
          String(ctx.pid),
          "--class",
          WE_WINDOW.className,
          "--title-pattern",
          WE_WINDOW.titlePattern,
          "--view",
          "raw",
          "--label",
          "l15-we",
          "--out",
          outPath,
          ...laneArgv(ctx.lane),
          "--really",
        ];
        const child = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true });
        let out = "";
        child.stdout.on("data", (b: Buffer) => (out += b.toString("utf-8")));
        child.stderr.on("data", () => undefined);
        const kill = (): void => {
          child.kill();
        };
        ctx.signal.addEventListener("abort", kill, { once: true });
        child.on("close", (code) => {
          ctx.signal.removeEventListener("abort", kill);
          try {
            resolveWalk(walkResultFrom(code, out, outPath));
          } catch (e) {
            reject(e);
          }
        });
      }),
    probe: async (params, timeoutMs) => {
      const r = await netCall(PROBE_API, params, { timeoutMs, port: DEFAULT_PORT });
      return { ok: r.ok, response: r.response, error: r.error, timedOut: r.timedOut };
    },
    writeArtifact: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, { encoding: "utf-8", flag: "wx" });
      return sha256(text);
    },
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** The probe pack's facts as a record (s-d-train1 probeFacts). */
export function factsOf(response: unknown): Record<string, string> {
  const r = response as { factKeys?: unknown; factValues?: unknown } | undefined;
  const keys = Array.isArray(r?.factKeys) ? (r!.factKeys as unknown[]) : [];
  const values = Array.isArray(r?.factValues) ? (r!.factValues as unknown[]) : [];
  const out: Record<string, string> = {};
  keys.forEach((k, i) => (out[String(k)] = String(values[i] ?? "")));
  return out;
}

export function statusOf(response: unknown): string | null {
  const s = (response as { status?: unknown } | undefined)?.status;
  return typeof s === "string" ? s : null;
}

/** The line state: only the mode axis (state-matrix: diag-menu and debug-panel declare mode). */
export function lineState(s: ObservedState): ObservedState {
  return { mode: s.mode === "play" ? "play" : "edit" };
}

export function modeOf(s: Pick<WalkerOptions, "state">["state"]): "edit" | "play" {
  return s.mode === "play" ? "play" : "edit";
}

interface Found {
  node: WalkNode;
  path: string;
}

/** Every node of the walk, with its tree path (`0/15/0`), System menu subtree excluded. */
export function nodesOf(root: WalkNode): Found[] {
  const out: Found[] = [];
  const visit = (n: WalkNode, p: string): void => {
    if (n.controlType === "MenuBar" && n.name === "System") return;
    out.push({ node: n, path: p });
    (n.children ?? []).forEach((c, i) => visit(c, `${p}/${i}`));
  };
  visit(root, "0");
  return out;
}

/** debug-panel lines for walk nodes naming a diag or debug surface; the render window's facts. */
export function debugPanelLines(
  w: WalkResult,
  state: ObservedState,
): { lines: LiveObservation[]; render: Found | null; matches: number } {
  const all = nodesOf(w.doc.tree).filter((f) => f.path !== "0");
  const render = all.find((f) => f.node.className === RENDER_WINDOW_CLASS) ?? null;
  const hits = all.filter(
    (f) => DEBUG_NAME.test(f.node.name ?? "") || DEBUG_NAME.test(f.node.automationId ?? ""),
  );
  const names = hits.map((f) => (f.node.automationId ?? "").split(".").pop() ?? "");
  const unnamed = new Map<string, number>();
  const lines = hits.map((f): LiveObservation => {
    const cls = f.node.className ?? "unknown";
    const name = f.node.name ?? "";
    const ord = name.trim() ? undefined : (unnamed.get(cls) ?? 0) + 1;
    if (ord) unnamed.set(cls, ord);
    const id = chooseKey(
      {
        automationId: f.node.automationId,
        className: f.node.className,
        ancestorLabels: [],
        name,
        unnamedOrdinal: ord,
      },
      (o) => names.filter((x) => x === o).length === 1,
    );
    return {
      dim: "ui",
      kind: "debug-panel",
      module: "WorldEditor",
      key: id.key,
      parent_key: {
        dim: "ui",
        kind: "window",
        module: "WorldEditor",
        key: { object_name: WE_OBJECT_NAME },
      },
      origin: "vanilla",
      ...(name ? { label: normalizeLabel(name), label_raw: name } : {}),
      locator: {
        ...(f.node.automationId ? { automationId: f.node.automationId } : {}),
        controlType: f.node.controlType,
        windowClass: WE_WINDOW.className,
      },
      observed_state: lineState(state),
      risk_open_hint: "safe",
      ref: `artifact:${w.sha256}#n/${f.path}`,
      confidence: id.confidence ?? "medium",
      unverified: [
        ...(id.unverified ?? []),
        "named diag or debug by its UIA name or automation id only; not opened",
      ],
    };
  });
  return { lines, render, matches: hits.length };
}

export interface DiagRead {
  enumName: string;
  ok: boolean;
  status: string | null;
  facts: Record<string, string>;
  error?: string;
}

/** A diag-option line for one answered read, keyed as its E14 row. */
export function diagOptionLine(
  opt: E14Option,
  read: DiagRead,
  sha: string,
  state: ObservedState,
): LiveObservation | null {
  if (!read.ok || read.status !== "ok" || read.facts.diagEnum !== opt.enumName) return null;
  return {
    dim: "diag",
    kind: "diag-option",
    module: "Shared",
    key: { path: [...opt.path] },
    parent_key: {
      dim: "diag",
      kind: "diag-menu",
      module: "Shared",
      key: { path: [...opt.parentPath] },
    },
    origin: "vanilla",
    observed_state: lineState(state),
    risk_hint: "safe",
    ref: `artifact:${sha}#d/${opt.enumName}`,
    confidence: "medium",
    unverified: [
      `SCR_DebugMenuID.${opt.enumName} resolved and DiagMenu.GetValue answered (id ${read.facts.diagId ?? "?"}); whether the option is registered in this mode is not shown by a read`,
      "menu path and label taken from the E14 row; the Diag Menu itself is engine-drawn and was not read",
    ],
  };
}

// ── Plan actions ─────────────────────────────────────────────────────────────

function walkAction(step: string): PlanAction {
  return {
    kind: "uia-read",
    step,
    target: {
      pid: LANE_RECORDED_PID,
      window: { ...WE_WINDOW, allowOwned: false },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "raw",
    bounds: { ...WALK_DEFAULT_BOUNDS },
    note: "tools/uia/walk.ts; passive",
  };
}

function diagAction(step: string, enumName: string): PlanAction {
  return {
    kind: "net-call",
    target: PROBE_API,
    params: { action: "diagRead", diagEnum: enumName },
    step,
    probes: ["P-U34"],
    timeout_ms: PROBE_TIMEOUT_MS,
    note: enumName,
  };
}

// ── Steps ────────────────────────────────────────────────────────────────────

function artifactPath(ctx: WalkerStepContext, name: string): string {
  return join(ctx.opts.runDir, `L15-${name}-${stateTag(ctx.opts.state)}.json`);
}

export function buildSteps(
  sel: Pick<WalkerOptions, "module" | "state" | "allowOwned">,
  kernel: L15Kernel,
): WalkerStep[] {
  const mode = modeOf(sel.state);
  const walkId = `p4-l15-${mode}-walk`;
  const diagId = `p4-l15-${mode}-diag`;
  let e14: E14Index | null = null;
  const index = (): E14Index => (e14 ??= indexE14(kernel.e14Text()));
  const playNote =
    mode === "play" ? "; play mode entered by the sitting's own step before this block" : "";

  const walk: WalkerStep = {
    id: walkId,
    title: `passive UIA read of the World Editor window for diag and debug surfaces (${mode} mode)`,
    risk: "read-only",
    timeout_ms: WALK_DEFAULT_BOUNDS.budgetMs + 30_000,
    expected: `a walk file; no Diag Menu node (engine-drawn, ${RENDER_WINDOW_CLASS} childless in P3-3)${playNote}`,
    kill_criterion: "any new window: stop; a dialog-like window: handoff; walk.ts non-zero: stop",
    side_effects: [],
    rollback: "none needed",
    plan: () => [walkAction(walkId)],
    run: async (ctx) => {
      const w = await ctx.call("uia-read", () => kernel.walk(ctx, artifactPath(ctx, "we-walk")));
      const r = debugPanelLines(w, ctx.opts.state);
      if (r.lines.length) ctx.emit(r.lines);
      const rc = r.render?.node.childCount ?? r.render?.node.children?.length;
      return {
        status: "observed",
        summary:
          `${r.matches} diag/debug node(s) in UIA; ` +
          (r.render
            ? `${RENDER_WINDOW_CLASS} at n/${r.render.path} has ${rc ?? 0} child(ren)`
            : `no ${RENDER_WINDOW_CLASS} node`) +
          (w.doc.partial ? "; walk partial" : ""),
        artifacts: [{ path: w.path, sha256: w.sha256 }],
      };
    },
  };

  const diag: WalkerStep = {
    id: diagId,
    title: `probe-pack diagRead of each E14 SCR_DebugMenuID option by name (${mode} mode)`,
    risk: "read-only",
    timeout_ms: Math.max(1, index().script.length) * (PROBE_TIMEOUT_MS + 2_000),
    expected: "one answer per option (S-D sd-05: 3 of 3 ok, value 0); a reconcile file",
    kill_criterion:
      "a call unanswered within its timeout: stop, no retry; any new window: stop; an authorization prompt: handoff",
    side_effects: [],
    rollback: "none needed (reads only; no diagSet, no diagMenu)",
    plan: () =>
      index()
        .script.filter((o) => !DIAG_READ_HAZARDS.includes(o.enumName))
        .map((o) => diagAction(diagId, o.enumName)),
    run: async (ctx) => {
      const ix = index();
      const reads: DiagRead[] = [];
      const before = await ctx.windows();
      for (const o of ix.script) {
        if (DIAG_READ_HAZARDS.includes(o.enumName)) continue;
        const params = { action: "diagRead", diagEnum: o.enumName };
        const a = await ctx.call(`diagRead ${o.enumName}`, () =>
          kernel.probe(params, PROBE_TIMEOUT_MS),
        );
        if (a.timedOut)
          throw new StopBattery(
            "stopped",
            `diagRead ${o.enumName} timed out; no retry (D13 rule 5)`,
          );
        reads.push({
          enumName: o.enumName,
          ok: a.ok,
          status: statusOf(a.response),
          facts: factsOf(a.response),
          ...(a.error ? { error: a.error } : {}),
        });
        // P4-1 2026-10-12: the 2 s poll saw the modal only after ~100 more reads could have gone
        // out. Check after every read and send nothing more once a box or a disabled window is up.
        const box = modalAfter(before, await ctx.windows(), ctx.pid);
        if (box)
          throw new StopBattery(
            "handoff",
            `${box.className} "${box.title}" (enabled ${box.enabled}) is up after diagRead ${o.enumName}: no further read sent; owner hand`,
            { diagReadInFlight: o.enumName },
          );
      }
      const readsText =
        toPlaceholders(
          JSON.stringify({ mode, api: PROBE_API, action: "diagRead", reads }, null, 2),
          ctx.opts.ph,
        ) + "\n";
      const readsPath = artifactPath(ctx, "diag-reads");
      const sha = kernel.writeArtifact(readsPath, readsText);
      const byName = new Map(reads.map((r) => [r.enumName, r]));
      const lines = ix.script
        .map((o) => {
          const r = byName.get(o.enumName);
          return r ? diagOptionLine(o, r, sha, ctx.opts.state) : null;
        })
        .filter((l): l is LiveObservation => l !== null);
      if (lines.length) ctx.emit(lines);
      const answered = new Set(lines.map((l) => l.ref.split("#d/")[1] ?? ""));
      const reconcile = {
        mode,
        e14: { menus: ix.menus, options: ix.options, script: ix.script.length, engine: ix.engine },
        read_ok: lines.length,
        not_answered: ix.script
          .filter((o) => !answered.has(o.enumName) && !DIAG_READ_HAZARDS.includes(o.enumName))
          .map((o) => o.enumName),
        hazard_not_read: ix.script
          .filter((o) => DIAG_READ_HAZARDS.includes(o.enumName))
          .map((o) => o.enumName),
        engine_not_read: `${ix.engine} engine option(s): probe.diag_read_engine_ids is empty`,
        other_not_read: ix.options - ix.script.length - ix.engine,
        menus_not_read: `${ix.menus} menu(s): no read names a menu without SelectMenuByName`,
        reads_sha256: sha,
      };
      const recText = JSON.stringify(reconcile, null, 2) + "\n";
      const recPath = artifactPath(ctx, "reconcile");
      const recSha = kernel.writeArtifact(recPath, recText);
      return {
        status: "observed",
        summary: `${lines.length} of ${ix.script.length} E14 script options answered; ${ix.engine} engine and ${ix.menus} menus not readable`,
        artifacts: [
          { path: readsPath, sha256: sha },
          { path: recPath, sha256: recSha },
        ],
      };
    },
  };
  return [walk, diag];
}

export function makeDef(kernel: L15Kernel): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    script: SCRIPT,
    session: "P4-1",
    defaultModule: "WorldEditor",
    steps: (sel) => buildSteps(sel, kernel),
  };
}

if (isMainModule(import.meta.url)) {
  runWalker(makeDef(realKernel()), process.argv.slice(2)).then((c) => process.exit(c));
}
