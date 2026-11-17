/**
 * L07, the screenshot lane of the Phase 4 live GUI census (design `docs/v2/design/phase4-live-census.md`
 * section 4, D12/D13; plan 4.5 L07 and Phase 4 item 9). The accessibility tree cannot see inside an
 * opaque region (the 3D viewport, a node-graph canvas, a timeline, a curve editor, the terrain
 * minimap), so this lane writes PNG files of them for the ANNOTATOR and records one `region` line per
 * region with the file's sha256 as its `ref`. One step per module and state:
 *
 *   p4-l07-screens   read-only: list the module window (Win32 facts of the lane's pid), one passive
 *                    `uia-read` of it (tools/uia/walk.ts, the proven reader) for the region rectangles,
 *                    then one PNG of the module window and one per region found.
 *
 * Capture is a screen-rectangle copy (the same GDI+ `CopyFromScreen` as `scripts/live/capture.ts`,
 * which `wb_gui screenshot` also runs, but for one rectangle instead of the whole desktop, so a
 * file never shows another application). It sends no message to Workbench: no `PrintWindow` (that
 * posts WM_PRINT to the window and is black for a GPU surface), no key, no click, no focus change. A
 * region or the window is skipped, never captured wrongly, when another window lies above it (the
 * window list is read in z-order) or it lies outside the visible window. Files go to
 * `<run>/L07-shots/` inside the artifacts folder, never inside a git tree (checked per file).
 *
 * Roles (the class-name table `ROLE_TABLE`): the two World Editor classes were read in the P3-3 gate 2
 * walk (`WorldRenderWindowQt`, `TerrainMinimapViewport`); every other pattern is [unverified] until
 * the module is first walked. An unnamed region has an ordinal identity (D7 rule 3, low confidence);
 * its role is carried in `unverified`, never invented as a key. No `canvas-gesture` line is written:
 * what a human can do on a region is the ANNOTATOR's reading of these files.
 *
 * ParticleEditor is never read (DEC-042): its module plan is empty. Nothing is typed, no menu is
 * touched, no dialog is opened or answered.
 *
 *   npx --no tsx scripts/census/live/L07-screens.ts [--out <plan.json>] [--outline <file>] [--emit-queue <file>]
 *   npx --no tsx scripts/census/live/L07-screens.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module WorldEditor [--state mode=edit,selection=none] [--only p4-l07-screens]
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { boundFlag, type WalkBounds } from "../../../tools/uia/walk.js";
import type { PlanAction } from "../../live/dry-run.js";
import { REPO_ROOT, insideGitWorkTree } from "../../live/paths.js";
import { lastLine, runPowerShell } from "../../live/powershell.js";
import { WINDOWS_SCRIPT, parseWindows, type WindowInfo } from "../../live/s-c-natives.js";
import {
  EDITOR_WINDOW_CLASS,
  MODULE_TITLES,
  StopBattery,
  chooseKey,
  isMainModule,
  laneArgv,
  normalizeLabel,
  runWalker,
  stateFor,
  stateTag,
  type LiveKey,
  type LiveObservation,
  type ObservedState,
  type WalkerDef,
  type WalkerStep,
  type WalkerLane,
  type WalkerStepContext,
  type WalkerStepOutcome,
} from "./common.js";

// ── The modules and their regions ────────────────────────────────────────────

export const ENUMERATOR = "L07";
export const STEP_ID = "p4-l07-screens";
/** The sitting that runs L07 (design 3: P4-2, with the play and with-terrain states). */
export const SESSION = "P4-2";

export interface ModuleWindow {
  /** The module window's title as a pattern (walk.ts `--title-pattern`). */
  titlePattern: string;
  /** The title has not been seen live (only L10's matrix says what it should be). */
  titleUnverified: boolean;
  /** Roles the module is known to show; one missing from the walk makes the step `observed`. */
  expectedRoles: readonly string[];
}

/**
 * The modules that have a window of their own and may be read. ParticleEditor is absent on purpose
 * (DEC-042); the Launcher belongs to L14; DialogueEditor is deferred (U23); Shared has no window
 * of its own. Titles follow L10's matrix (EV-S-E-044). The Resource Manager's sub-editors have no
 * window of their own either: they are tabs of the RM window (S-C sc-08), so sitting P4-9 shoots
 * that window with the sub-editor's tab active, under the sub-editor's MODULE_TITLES entry.
 */
export const MODULE_WINDOWS: Readonly<Record<string, ModuleWindow>> = {
  WorldEditor: {
    titlePattern: MODULE_TITLES.WorldEditor.pattern,
    titleUnverified: MODULE_TITLES.WorldEditor.unverified,
    expectedRoles: ["viewport", "terrain-minimap"],
  },
  ResourceManager: {
    titlePattern: MODULE_TITLES.ResourceManager.pattern,
    titleUnverified: MODULE_TITLES.ResourceManager.unverified,
    expectedRoles: [],
  },
  ScriptEditor: {
    titlePattern: MODULE_TITLES.ScriptEditor.pattern,
    titleUnverified: MODULE_TITLES.ScriptEditor.unverified,
    expectedRoles: [],
  },
  LocalizationEditor: {
    titlePattern: MODULE_TITLES.LocalizationEditor.pattern,
    titleUnverified: MODULE_TITLES.LocalizationEditor.unverified,
    expectedRoles: [],
  },
  AnimEditor: {
    titlePattern: MODULE_TITLES.AnimEditor.pattern,
    titleUnverified: MODULE_TITLES.AnimEditor.unverified,
    expectedRoles: [],
  },
  ProcAnimEditor: {
    titlePattern: MODULE_TITLES.ProcAnimEditor.pattern,
    titleUnverified: MODULE_TITLES.ProcAnimEditor.unverified,
    expectedRoles: [],
  },
  BehaviorEditor: {
    titlePattern: MODULE_TITLES.BehaviorEditor.pattern,
    titleUnverified: MODULE_TITLES.BehaviorEditor.unverified,
    expectedRoles: [],
  },
  AudioEditor: {
    titlePattern: MODULE_TITLES.AudioEditor.pattern,
    titleUnverified: MODULE_TITLES.AudioEditor.unverified,
    expectedRoles: [],
  },
  NavmeshGeneratorMain: {
    titlePattern: MODULE_TITLES.NavmeshGeneratorMain.pattern,
    titleUnverified: MODULE_TITLES.NavmeshGeneratorMain.unverified,
    expectedRoles: [],
  },
  ...Object.fromEntries(
    Object.entries(MODULE_TITLES)
      .filter(([m]) => m.startsWith("ResourceManager."))
      .map(([m, t]) => [
        m,
        { titlePattern: t.pattern, titleUnverified: t.unverified, expectedRoles: [] },
      ]),
  ),
};

export interface RoleRule {
  role: string;
  /** Matched against the node's UIA className; first rule that matches wins. */
  className: RegExp;
  /** The class was read live (P3-3 gate 2 walk); false = a pattern awaiting a first walk. */
  observed: boolean;
}

/** The class-name table of opaque regions. Order matters: the minimap before the viewport. */
export const ROLE_TABLE: readonly RoleRule[] = [
  { role: "terrain-minimap", className: /^TerrainMinimapViewport$/, observed: true },
  { role: "viewport", className: /^WorldRenderWindowQt$/, observed: true },
  { role: "viewport", className: /(RenderWindow|Viewport)/i, observed: false },
  { role: "timeline", className: /Timeline/i, observed: false },
  { role: "curve-editor", className: /Curve\w*(Editor|View|Widget|Canvas)$/i, observed: false },
  {
    role: "node-graph",
    className: /(NodeGraph|GraphView|GraphEditor|GraphWidget|GraphicsView|NodeEditor|Canvas)/i,
    observed: false,
  },
];

/** The roles a plan names for a module: those it is known to show, then every pattern role. */
export function plannedRoles(module: string): string[] {
  const known = MODULE_WINDOWS[module]?.expectedRoles ?? [];
  const all = ROLE_TABLE.map((r) => r.role);
  return [...new Set([...known, ...all])];
}

/** The passive walk's bounds (nine, all inside `live_lane.uia_read`). */
export const WALK_BOUNDS: WalkBounds = {
  maxDepth: 16,
  maxNodes: 3000,
  budgetMs: 60_000,
  rowSample: 5,
  maxChildren: 500,
  countCap: 2000,
  callTimeoutMs: 2000,
  slowCallMs: 250,
  maxConsecutiveErrors: 3,
};

const WINDOW_KILL =
  "a new window the step does not expect: STOP and record; a dialog-like or disabled window: HANDOFF (owner hand, nothing is sent to it); a walk or capture timeout: STOP, never retried";

// ── The accessibility tree (tools/uia/walk.ts document) ──────────────────────

export interface UiaNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  /** x, y, width, height in screen pixels, as the walk writes it. */
  rect?: number[];
  enabled?: boolean;
  offscreen?: boolean;
  childCount?: number;
  children?: UiaNode[];
}

export interface Walked {
  node: UiaNode;
  /** Tree path as the walk's `n/<path>` refs write it: `0`, `0/15/0/0`. */
  path: string;
  /** Ancestors, root first. */
  chain: Array<{ node: UiaNode; path: string }>;
}

/** Every node of the tree in document order. */
export function walkNodes(root: UiaNode): Walked[] {
  const out: Walked[] = [];
  const visit = (n: UiaNode, path: string, chain: Walked["chain"]): void => {
    out.push({ node: n, path, chain });
    (n.children ?? []).forEach((c, i) => visit(c, `${path}/${i}`, [...chain, { node: n, path }]));
  };
  visit(root, "0", []);
  return out;
}

/** left, top, right, bottom in screen pixels. */
export type Rect = [number, number, number, number];

/** A walk rect (x, y, w, h) as left, top, right, bottom; null when it is not a usable rectangle. */
export function uiaRect(n: UiaNode): Rect | null {
  const r = n.rect;
  if (!r || r.length !== 4 || r.some((v) => !Number.isFinite(v))) return null;
  if (r[2] <= 0 || r[3] <= 0) return null;
  return [r[0], r[1], r[0] + r[2], r[1] + r[3]];
}

const area = (r: Rect): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);

export function intersect(a: Rect, b: Rect): Rect {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** The first role rule a className matches, or null. */
export function roleOf(className: string | undefined): RoleRule | null {
  if (!className) return null;
  return ROLE_TABLE.find((r) => r.className.test(className)) ?? null;
}

export interface RegionHit {
  role: string;
  observed: boolean;
  path: string;
  node: UiaNode;
  /** 1-based ordinal among the hits of the same className, in document order. */
  ordinal: number;
  /** The nearest QDockWidget ancestor, when there is one. */
  dock: { node: UiaNode; path: string } | null;
}

/**
 * The opaque regions of a walk: nodes whose className is on the role table, outermost only (a match
 * inside a match is the same region), in document order. A node the walk marks offscreen or with no
 * usable rectangle is returned in `skipped`, never captured.
 */
export function findRegions(root: UiaNode): {
  hits: RegionHit[];
  skipped: Array<{ id: string; reason: string }>;
} {
  const hits: RegionHit[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const taken = new Set<string>();
  const perClass = new Map<string, number>();
  for (const w of walkNodes(root)) {
    if (w.chain.some((a) => taken.has(a.path))) continue;
    const rule = roleOf(w.node.className);
    if (!rule) continue;
    taken.add(w.path);
    const cls = w.node.className ?? "";
    const ordinal = (perClass.get(cls) ?? 0) + 1;
    perClass.set(cls, ordinal);
    const id = `${rule.role} ${cls}.${ordinal}`;
    if (w.node.offscreen === true) {
      skipped.push({ id, reason: "the walk marks it offscreen" });
      continue;
    }
    if (!uiaRect(w.node)) {
      skipped.push({ id, reason: "no usable rectangle in the walk" });
      continue;
    }
    const dockHit = [...w.chain].reverse().find((a) => a.node.className === "QDockWidget") ?? null;
    hits.push({
      role: rule.role,
      observed: rule.observed,
      path: w.path,
      node: w.node,
      ordinal,
      dock: dockHit,
    });
  }
  return { hits, skipped };
}

// ── Geometry and occlusion ───────────────────────────────────────────────────

/** Classes that may lie above a window without hiding Workbench pixels that matter. */
const NOT_OCCLUDERS: ReadonlySet<string> = new Set(["Progman", "WorkerW", "SysShadow"]);

/** Win32 rect (l, t, r, b) of a window, or null. */
export function win32Rect(w: WindowInfo): Rect | null {
  return w.rect.length === 4 && w.rect.every(Number.isFinite) ? (w.rect as Rect) : null;
}

/**
 * What a window can show of itself: its rectangle clipped to the monitor it is on. Null when it is
 * minimised (Windows parks those at -32000), degenerate or too small to be a module window.
 */
export function visibleWindowRect(w: WindowInfo): Rect | null {
  const r = win32Rect(w);
  if (!r || r[0] <= -30_000 || r[1] <= -30_000) return null;
  const clipped = w.monitor.length === 4 ? intersect(r, w.monitor as Rect) : r;
  return clipped[2] - clipped[0] >= 200 && clipped[3] - clipped[1] >= 150 ? clipped : null;
}

/** The most a side or bottom edge may differ: the invisible resize frame (8 px at 100%, 16 at 200%). */
export const FRAME_MAX_PX = 16;
/**
 * The most the top edge may sit below the Win32 top: the frame plus the title bar the UIA client
 * rect leaves out (P4-1 2026-10-12: 31 px at 100%). A hard cap: a DPI scale difference moves the
 * edges by far more.
 */
export const TITLE_BAR_MAX_PX = 64;

/**
 * Do the walk and the Win32 list agree on where the window is? Frame-aware: the UIA root rect may lie
 * inside the Win32 rect by up to FRAME_MAX_PX at the sides and bottom and TITLE_BAR_MAX_PX at the
 * top (P4-1 2026-10-12: 319,155,2239,1235 against 311,124,2247,1243, deltas 8/31/8/8, was refused as
 * a DPI difference), and stick out by at most FRAME_MAX_PX. A DPI scale difference fails the caps.
 */
export function spacesAgree(uiaRoot: Rect, win: Rect): boolean {
  const [l, t, r, b] = uiaRoot;
  const inset = [l - win[0], t - win[1], win[2] - r, win[3] - b];
  const caps = [FRAME_MAX_PX, TITLE_BAR_MAX_PX, FRAME_MAX_PX, FRAME_MAX_PX];
  return inset.every((d, i) => Number.isFinite(d) && d >= -FRAME_MAX_PX && d <= caps[i]);
}

/** Windows above `hwnd` in the z-order list that overlap `rect` (descriptions, class and title). */
export function occluders(wins: readonly WindowInfo[], hwnd: number, rect: Rect): string[] {
  const idx = wins.findIndex((w) => w.hwnd === hwnd);
  if (idx === -1) return ["the window is no longer in the window list"];
  return wins
    .slice(0, idx)
    .filter((w) => !NOT_OCCLUDERS.has(w.className))
    .filter((w) => {
      const r = win32Rect(w);
      return r !== null && area(intersect(r, rect)) > 0;
    })
    .map((w) => `${w.className} "${w.title}"`);
}

/** A region's rectangle if at least 90% of it lies inside the window's visible area, else a reason. */
export function regionRect(node: UiaNode, windowRect: Rect): { rect: Rect } | { reason: string } {
  const r = uiaRect(node);
  if (!r) return { reason: "no usable rectangle in the walk" };
  const vis = intersect(r, windowRect);
  if (area(vis) < 0.9 * area(r)) return { reason: "less than 90% of it lies inside the window" };
  if (vis[2] - vis[0] < 16 || vis[3] - vis[1] < 16) return { reason: "smaller than 16 px" };
  return { rect: vis };
}

// ── D8: the state axes the matrix declares for a kind ────────────────────────

// ── Lines ────────────────────────────────────────────────────────────────────

export interface CapturedShot {
  path: string;
  sha256: string;
}

const sha8 = (s: string): string => s.slice(0, 8);

export interface LineInput {
  module: string;
  state: ObservedState;
  walkSha: string;
  root: UiaNode;
  /** The window's PNG, or why there is none (the window line then cites the walk). */
  window: CapturedShot | { skip: string };
  regions: Array<{ hit: RegionHit; shot: CapturedShot }>;
}

type ParentKey = NonNullable<LiveObservation["parent_key"]>;

/**
 * The lines of one step: the module `window` (ref: its PNG), a `dock` for every QDockWidget that
 * holds a captured region (ref: the walk), and one `region` per captured region (ref: its PNG;
 * ordinal identity, low confidence, role in `unverified`). Keys follow D7.
 */
export function buildLines(input: LineInput): LiveObservation[] {
  const { module, state, walkSha, root } = input;
  const lines: LiveObservation[] = [];
  const walkRef = (path: string): string => `artifact:${walkSha}#n/${path}`;
  const windowKey = chooseKey(
    {
      automationId: root.automationId,
      className: root.className,
      ancestorLabels: [],
      name: root.name ?? "",
      moduleWindow: true,
    },
    () => true,
  );
  const windowParent: ParentKey = {
    dim: "ui",
    kind: "window",
    module,
    key: windowKey.key,
  };
  const label = (name: string | undefined): Partial<LiveObservation> =>
    name && name.trim() ? { label: normalizeLabel(name), label_raw: name } : {};
  lines.push({
    dim: "ui",
    kind: "window",
    module,
    key: windowKey.key,
    parent_key: null,
    origin: "vanilla",
    ...label(root.name),
    locator: {
      ...(root.automationId ? { automationId: root.automationId } : {}),
      controlType: root.controlType,
      windowClass: EDITOR_WINDOW_CLASS,
    },
    observed_state: stateFor(module, "window", state),
    modal: "none",
    risk_hint: "safe",
    ref: "skip" in input.window ? walkRef("0") : `artifact:${input.window.sha256}#window`,
    confidence: windowKey.confidence ?? "high",
    unverified: [
      ...(windowKey.unverified ?? []),
      "skip" in input.window
        ? `no window PNG (${input.window.skip}); the tree is the walk ${sha8(walkSha)}`
        : `module window as pixels (${sha8(input.window.sha256)}); the tree is the walk ${sha8(walkSha)}`,
    ],
  });

  // Docks that own a captured region.
  const docks = new Map<string, { node: UiaNode; path: string }>();
  for (const r of input.regions) if (r.hit.dock) docks.set(r.hit.dock.path, r.hit.dock);
  const dockNodes = walkNodes(root).filter((w) => w.node.className === "QDockWidget");
  const dockKeys = new Map<string, LiveKey>();
  for (const [path, d] of docks) {
    const tailCount = (tail: string): number =>
      dockNodes.filter((w) => (w.node.automationId ?? "").split(".").pop() === tail).length;
    const id = chooseKey(
      {
        automationId: d.node.automationId,
        className: d.node.className,
        ancestorLabels: [],
        name: d.node.name ?? "",
      },
      (obj) => tailCount(obj) === 1,
    );
    dockKeys.set(path, id.key);
    lines.push({
      dim: "ui",
      kind: "dock",
      module,
      key: id.key,
      parent_key: windowParent,
      origin: "vanilla",
      ...label(d.node.name),
      locator: {
        ...(d.node.automationId ? { automationId: d.node.automationId } : {}),
        controlType: d.node.controlType,
        windowClass: EDITOR_WINDOW_CLASS,
      },
      observed_state: stateFor(module, "dock", state),
      modal: "none",
      risk_hint: "safe",
      ref: walkRef(path),
      confidence: id.confidence ?? "high",
      ...(id.unverified ? { unverified: id.unverified } : {}),
    });
  }

  const tailOf = (n: UiaNode): string => (n.automationId ?? "").split(".").pop() ?? "";
  for (const r of input.regions) {
    const id = chooseKey(
      {
        automationId: r.hit.node.automationId,
        className: r.hit.node.className,
        ancestorLabels: [],
        name: r.hit.node.name ?? "",
        unnamedOrdinal: r.hit.ordinal,
      },
      (obj) => input.regions.filter((o) => tailOf(o.hit.node) === obj).length === 1,
    );
    const dockKey = r.hit.dock ? dockKeys.get(r.hit.dock.path) : undefined;
    const parent: ParentKey =
      r.hit.dock && dockKey ? { dim: "ui", kind: "dock", module, key: dockKey } : windowParent;
    lines.push({
      dim: "ui",
      kind: "region",
      module,
      key: id.key,
      parent_key: parent,
      origin: "vanilla",
      ...label(r.hit.node.name),
      locator: {
        ...(r.hit.node.automationId ? { automationId: r.hit.node.automationId } : {}),
        controlType: r.hit.node.controlType,
        windowClass: EDITOR_WINDOW_CLASS,
      },
      observed_state: stateFor(module, "region", state),
      modal: "none",
      risk_hint: "safe",
      ref: `artifact:${r.shot.sha256}#region/${r.hit.role}`,
      confidence: id.confidence ?? "low",
      unverified: [
        ...(id.unverified ?? []),
        `role ${r.hit.role}: ${r.hit.observed ? "class read live in the P3-3 gate 2 walk" : "class pattern of the L07 role table, not yet read live"}`,
        `rectangle from the walk ${sha8(walkSha)} at n/${r.hit.path}`,
      ],
    });
  }
  return lines;
}

// ── The kernel: what the step needs from Windows, injectable for tests ──────

export interface WalkResult {
  path: string;
  sha256: string;
  tree: UiaNode;
}

export interface L07Kernel {
  /** The visible top-level windows, z-order first, in DPI-aware screen pixels. */
  windows: () => Promise<WindowInfo[]>;
  /** One passive `uia-read` of a window (tools/uia/walk.ts), written to `outPath`. */
  walk: (a: {
    pid: number;
    hwnd: number;
    className: string;
    titlePattern: string;
    outPath: string;
    lane?: WalkerLane;
  }) => Promise<WalkResult>;
  /** Copy a screen rectangle to a PNG at `outPath`. */
  captureRect: (a: { rect: Rect; outPath: string }) => Promise<{ ok: boolean; detail: string }>;
  exists: (path: string) => boolean;
  sha256: (path: string) => string;
}

/** Makes the process DPI aware before any window call, so every coordinate is a real screen pixel. */
const DPI_PREFIX = [
  "Add-Type -TypeDefinition @'",
  "using System.Runtime.InteropServices;",
  'public static class EmcpL07Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }',
  "'@",
  "[void][EmcpL07Dpi]::SetProcessDPIAware()",
].join("\n");

/** The window list in DPI-aware pixels (the walk and the capture use the same space). */
export const DPI_WINDOWS_SCRIPT = `${DPI_PREFIX}\n${WINDOWS_SCRIPT}`;

export const RECT_PATH_ENV = "EMCP_L07_PATH";
export const RECT_ENV = "EMCP_L07_RECT";

/** PowerShell: copy the screen rectangle `$env:EMCP_L07_RECT` ("l,t,r,b") to the PNG `$env:EMCP_L07_PATH`. */
export const RECT_CAPTURE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  DPI_PREFIX,
  "Add-Type -AssemblyName System.Drawing",
  `$r = $env:${RECT_ENV}.Split(',') | ForEach-Object { [int]$_ }`,
  "$w = $r[2] - $r[0]; $h = $r[3] - $r[1]",
  "if ($w -lt 1 -or $h -lt 1) { throw 'empty rectangle' }",
  "$bmp = New-Object System.Drawing.Bitmap $w, $h",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "try {",
  "  $g.CopyFromScreen($r[0], $r[1], 0, 0, $bmp.Size)",
  `  $bmp.Save($env:${RECT_PATH_ENV}, [System.Drawing.Imaging.ImageFormat]::Png)`,
  "} finally { $g.Dispose(); $bmp.Dispose() }",
  "Write-Output ('{\"width\":' + $w + ',\"height\":' + $h + '}')",
].join("\n");

const WALK_TS = join(REPO_ROOT, "tools", "uia", "walk.ts");

/** The argv of the walk.ts child (after `node`). Pure; a test checks it. */
export function walkChildArgv(
  a: { pid: number; hwnd: number; className: string; titlePattern: string; outPath: string },
  lane: WalkerLane,
): string[] {
  const argv = [
    "--import",
    "tsx",
    WALK_TS,
    "--pid",
    String(a.pid),
    "--class",
    a.className,
    "--title-pattern",
    a.titlePattern,
    "--hwnd",
    String(a.hwnd),
    "--view",
    "raw",
    "--label",
    "l07",
    "--out",
    a.outPath,
  ];
  for (const k of Object.keys(WALK_BOUNDS) as Array<keyof WalkBounds>)
    argv.push(`--${boundFlag(k)}`, String(WALK_BOUNDS[k]));
  if (lane.id) argv.push(...laneArgv(lane));
  argv.push("--really");
  return argv;
}

/** The real kernel: PowerShell for windows and pixels, walk.ts for the tree. Windows only. */
/** The lane is the step's (`ctx.lane`), passed in each walk request. */
export function realKernel(): L07Kernel {
  return {
    windows: async () => {
      const r = await runPowerShell(DPI_WINDOWS_SCRIPT, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`the window list script failed: ${r.error}`);
      return parseWindows(r.stdout);
    },
    walk: (a) =>
      new Promise((resolve, reject) => {
        const timeout = WALK_BOUNDS.budgetMs + 4 * WALK_BOUNDS.callTimeoutMs + 30_000;
        execFile(
          process.execPath,
          walkChildArgv(a, a.lane ?? { id: "" }),
          { cwd: REPO_ROOT, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
          (err, stdout) => {
            const line = lastLine(String(stdout));
            let summary: { refused?: boolean; reason?: string | null } = {};
            try {
              summary = line ? (JSON.parse(line) as typeof summary) : {};
            } catch {
              /* the last line is not the summary */
            }
            if (err || summary.refused || !existsSync(a.outPath)) {
              reject(
                new Error(
                  `the walk did not complete: ${summary.reason ?? (err ? err.message : "no document")}`,
                ),
              );
              return;
            }
            const text = readFileSync(a.outPath);
            const doc = JSON.parse(text.toString("utf-8")) as { tree?: UiaNode };
            if (!doc.tree) {
              reject(new Error("the walk document has no tree"));
              return;
            }
            resolve({
              path: a.outPath,
              sha256: createHash("sha256").update(text).digest("hex"),
              tree: doc.tree,
            });
          },
        );
      }),
    captureRect: async ({ rect, outPath }) => {
      // GDI+ Bitmap.Save cannot create a folder: a missing L07-shots folder failed every capture of
      // sitting P4-2 with "A generic error occurred in GDI+" (P4-FIX-H).
      mkdirSync(dirname(outPath), { recursive: true });
      const r = await runPowerShell(RECT_CAPTURE_SCRIPT, {
        timeoutMs: 30_000,
        env: { [RECT_PATH_ENV]: outPath, [RECT_ENV]: rect.join(",") },
      });
      return r.ok
        ? { ok: true, detail: lastLine(r.stdout) ?? "captured" }
        : { ok: false, detail: powershellErrorText(r.stderr, r.error) };
    },
    exists: existsSync,
    sha256: (path) => createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

/**
 * The PowerShell error a failed run printed, decoded from the CLIXML error stream (`<S S="Error">`
 * records, `_x000D__x000A_` line breaks) and without the "Command failed: ... -EncodedCommand ..."
 * line that node puts first. Falls back to the plain stderr, then to the node error message.
 */
export function powershellErrorText(stderr: string, error: string | null): string {
  const records = [...stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) =>
    m[1]
      .replace(/_x000D_/g, "")
      .replace(/_x000A_/g, "\n")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&"),
  );
  const lines = records
    .join("")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length) return lines.join(" ");
  const plain = stderr.replace(/^#< CLIXML\s*/, "").trim();
  if (plain && !plain.startsWith("<Objs")) return plain;
  const msg = (error ?? "")
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("Command failed:"))
    .join(" ")
    .trim();
  return msg || "PowerShell exited non-zero with no error text";
}

// ── The step ─────────────────────────────────────────────────────────────────

export function shotPath(runDir: string, module: string, state: ObservedState, name: string) {
  return join(runDir, "L07-shots", `L07-${module}-${stateTag(state)}-${name}.png`);
}

/** The module window of the lane's pid, or null. */
export function findModuleWindow(
  wins: readonly WindowInfo[],
  pid: number,
  titlePattern: string,
): WindowInfo | null {
  const re = new RegExp(titlePattern);
  return (
    wins.find(
      (w) =>
        w.pid === pid &&
        w.className === EDITOR_WINDOW_CLASS &&
        w.owner === 0 &&
        w.enabled &&
        re.test(w.title),
    ) ?? null
  );
}

function planFor(module: string): PlanAction[] {
  const mw = MODULE_WINDOWS[module];
  if (!mw) return [];
  const shot = (target: string, note: string): PlanAction =>
    ({ kind: "screenshot", target, note }) as PlanAction;
  return [
    {
      kind: "uia-read",
      target: {
        pid: "lane-recorded",
        window: {
          className: EDITOR_WINDOW_CLASS,
          titlePattern: mw.titlePattern,
          allowOwned: false,
        },
      },
      readOnly: true,
      view: "raw",
      bounds: { ...WALK_BOUNDS },
      note: "tools/uia/walk.ts: region rectangles only; the tree goes to the run folder",
    } as unknown as PlanAction,
    shot(
      "window",
      "one PNG of the module window: a screen-rectangle copy, no message to the window (capture.ts' CopyFromScreen)",
    ),
    ...plannedRoles(module).map((role) =>
      shot(
        `region:${role}`,
        `a PNG of each ${role} region the walk finds, if it lies inside the window and nothing is above it`,
      ),
    ),
  ];
}

async function runScreens(kernel: L07Kernel, ctx: WalkerStepContext): Promise<WalkerStepOutcome> {
  const { module, state, runDir } = ctx.opts;
  const mw = MODULE_WINDOWS[module];
  if (!mw) throw new StopBattery("stopped", `${module} has no module window L07 may read`);
  const shotDir = join(runDir, "L07-shots");
  if (insideGitWorkTree(shotDir))
    throw new StopBattery("stopped", `${shotDir} lies inside a git working tree`);

  // 1. The module window of the lane's pid.
  const wins1 = await ctx.call("windows", kernel.windows);
  const win = findModuleWindow(wins1, ctx.pid, mw.titlePattern);
  if (!win)
    return {
      status: "fail",
      summary: `no ${module} window of pid ${ctx.pid} matches ${mw.titlePattern}${mw.titleUnverified ? " (title [unverified])" : ""}`,
    };

  // 2. One passive walk, for the rectangles.
  const walkPath = join(runDir, `L07-${module}-${stateTag(state)}-walk.json`);
  if (kernel.exists(walkPath))
    throw new StopBattery("stopped", `${walkPath} already exists: a file is never overwritten`);
  const walk = await ctx.call("uia-read", () =>
    kernel.walk({
      pid: ctx.pid,
      hwnd: win.hwnd,
      className: EDITOR_WINDOW_CLASS,
      titlePattern: mw.titlePattern,
      outPath: walkPath,
      lane: ctx.lane,
    }),
  );
  const artifacts: Array<{ path: string; sha256: string }> = [
    { path: walk.path, sha256: walk.sha256 },
  ];

  // 3. The geometry now: the window must not have moved, and the two coordinate spaces must agree.
  const wins2 = await ctx.call("windows", kernel.windows);
  const win2 = wins2.find((w) => w.hwnd === win.hwnd);
  const winVisible = win2 ? visibleWindowRect(win2) : null;
  if (!win2 || !winVisible)
    return {
      status: "fail",
      summary: "the module window is gone, minimised or off the screen after the walk",
      artifacts,
    };
  if (win.rect.join(",") !== win2.rect.join(","))
    return { status: "fail", summary: "the module window moved during the walk", artifacts };
  const rootRect = uiaRect(walk.tree);
  if (!rootRect || !spacesAgree(rootRect, win2.rect as Rect))
    return {
      status: "fail",
      summary: `the walk and the window list disagree on the window rectangle (${rootRect?.join(",") ?? "none"} against ${win2.rect.join(",")}): a DPI scale difference; nothing was captured`,
      artifacts,
    };

  // 4. The window.
  const capture = async (name: string, rect: Rect): Promise<CapturedShot | { skip: string }> => {
    const above = occluders(wins2, win.hwnd, rect);
    if (above.length) return { skip: `covered by ${above.join("; ")}` };
    const outPath = shotPath(runDir, module, state, name);
    if (kernel.exists(outPath))
      throw new StopBattery("stopped", `${outPath} already exists: a file is never overwritten`);
    if (insideGitWorkTree(shotDir))
      throw new StopBattery("stopped", `${shotDir} lies inside a git working tree`);
    const r = await ctx.call(`capture ${name}`, () => kernel.captureRect({ rect, outPath }));
    if (!r.ok) return { skip: `capture failed: ${r.detail}` };
    if (!kernel.exists(outPath)) return { skip: "capture reported success but wrote no file" };
    const shot = { path: outPath, sha256: kernel.sha256(outPath) };
    artifacts.push(shot);
    return shot;
  };
  const windowShot = await capture("window", winVisible);

  // 5. The regions.
  const { hits, skipped } = findRegions(walk.tree);
  const captured: Array<{ hit: RegionHit; shot: CapturedShot }> = [];
  const skips = skipped.map((s) => `${s.id}: ${s.reason}`);
  for (const hit of hits) {
    const name = `region-${hit.role}-${hit.ordinal}`;
    const rr = regionRect(hit.node, winVisible);
    if ("reason" in rr) {
      skips.push(`${hit.role} ${hit.node.className}.${hit.ordinal}: ${rr.reason}`);
      continue;
    }
    const shot = await capture(name, rr.rect);
    if ("skip" in shot)
      skips.push(`${hit.role} ${hit.node.className}.${hit.ordinal}: ${shot.skip}`);
    else captured.push({ hit, shot });
  }
  if ("skip" in windowShot) skips.unshift(`window: ${windowShot.skip}`);
  if (!captured.length && "skip" in windowShot)
    return {
      status: "fail",
      summary: `nothing was captured; ${skips.join(" | ")}`,
      artifacts,
    };
  const absent = mw.expectedRoles.filter((r) => !captured.some((c) => c.hit.role === r));

  ctx.emit(
    buildLines({
      module,
      state,
      walkSha: walk.sha256,
      root: walk.tree,
      window: windowShot,
      regions: captured,
    }),
  );
  const summary = `window ${"skip" in windowShot ? "not captured" : sha8(windowShot.sha256)}; regions ${
    captured.length ? captured.map((c) => `${c.hit.role}.${c.hit.ordinal}`).join(", ") : "none"
  }${skips.length ? `; skipped ${skips.length}: ${skips.join(" | ")}` : ""}${
    absent.length ? `; expected but absent: ${absent.join(", ")}` : ""
  }`;
  return {
    status: skips.length || absent.length ? "observed" : "pass",
    summary,
    artifacts,
  };
}

/** The steps of one module and state; ParticleEditor and unknown modules have none (DEC-042). */
export function buildSteps(kernel: L07Kernel, module: string): WalkerStep[] {
  if (!MODULE_WINDOWS[module]) return [];
  return [
    {
      id: STEP_ID,
      title: `PNGs of the ${module} window and its opaque regions (viewport, graph canvases, timelines, curve editors, minimap), region lines with the file sha`,
      risk: "read-only",
      timeout_ms: 240_000,
      expected:
        "one window PNG and one PNG per region found, each with a sha256; region and window lines pass validateLine; a covered or partly hidden region is skipped and listed, never captured wrongly",
      kill_criterion: WINDOW_KILL,
      side_effects: [],
      rollback: "none (files under the run folder only)",
      plan: () => planFor(module),
      run: (ctx) => runScreens(kernel, ctx),
    },
  ];
}

export function makeDef(kernel: L07Kernel): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    script: "scripts/census/live/L07-screens.ts",
    session: SESSION,
    defaultModule: "WorldEditor",
    steps: ({ module }) => buildSteps(kernel, module),
  };
}

/** The def the CLI runs; the real kernel reads the lane from this process's argv. */
export const def: WalkerDef = makeDef(realKernel());

if (isMainModule(import.meta.url)) {
  runWalker(def, process.argv.slice(2)).then((code) => process.exit(code));
}
