/**
 * L06, property grids (design `docs/v2/design/phase4-live-census.md` sections 1, 2, 3.1 step 5,
 * 4 row L06, D16c). Three steps, all read-only, none opens anything:
 *
 *   p4-l06-grids-walk         one passive `uia-read` of the World Editor window (row sample 40);
 *                             every PropertyGrid tree in it becomes a `property-group` line, each
 *                             expandable row a `property-group`, each leaf row a `property`. A grid
 *                             the walker sampled (or whose gridRowCount is above the row sample) gets
 *                             no `children_count` and an `unverified` "deferred: sampled" note. Each
 *                             row label is checked against the E15 attribute names (offline).
 *   p4-l06-container-check    one `net-call` of EMCP_WB_Container `describe` on `open:WorldEditor`
 *                             (mode page); its row names are compared with the property lines of
 *                             the walk step. Writes a cross-check file; emits no line.
 *   p4-l06-editors-deferred   no Workbench call: every E16 UIWidgets editor that has a popup
 *                             becomes a `property-editor` line (module Shared) with no
 *                             `children_count` and `unverified` "deferred: popup needs an Invoke;
 *                             W1". No popup is opened: no plan kind opens one without an Invoke.
 *
 * Kernels are injected (`makeDef(kernels)`): the real ones spawn tools/uia/walk.ts with the lane id
 * of `--id` and call EMCP_WB_Container through runContainer; the test passes fakes built from
 * tests/census/fixtures/live/L06-*.json.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MODULE_TITLES,
  chooseKey,
  isMainModule,
  isPropertyGrid,
  laneArgv,
  normalizeLabel,
  runWalker,
  stateFor,
  stateTag,
  type LiveKey,
  type LiveObservation,
  type ObservedState,
  type WalkerDef,
  type WalkerStepContext,
} from "./common.js";
import type { PlanAction } from "../../live/dry-run.js";
import { REPO_ROOT } from "../../live/paths.js";
import { locatorOrdinals } from "../../../src/gui/locators.js";

export const ENUMERATOR = "L06";
export const SCRIPT = "scripts/census/live/L06-grids.ts";
export const WINDOW_CLASS = "Qt683QWindowIcon";
export const TITLE_PATTERN = MODULE_TITLES.WorldEditor.pattern;
export const ROW_SAMPLE = 40;
export const CONTAINER_HANDLER = "EMCP_WB_Container";
export const DEFERRED_POPUP = "deferred: popup needs an Invoke; W1";
export const DEFERRED_SAMPLED = "deferred: sampled";
export const NO_E15_MATCH = "no E15 attribute name matches this row label";
export const COLLAPSED_NOTE = "collapsed category; its rows were not read (L06 sends no Expand)";

/** The passive read's bounds (all within live_lane.uia_read). */
export const BOUNDS = {
  maxDepth: 60,
  maxNodes: 5000,
  budgetMs: 60_000,
  rowSample: ROW_SAMPLE,
  maxChildren: 1000,
  countCap: 2000,
  callTimeoutMs: 2000,
  slowCallMs: 250,
  maxConsecutiveErrors: 3,
} as const;

// ── Walk document shape (tools/uia/walker.py output, the fields L06 reads) ───

export interface UiaNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  patterns?: string[];
  gridRowCount?: number;
  childCount?: number;
  children?: UiaNode[];
}
export interface WalkDoc {
  target?: { className?: string; title?: string };
  sampling?: { applied?: Array<{ path: string; kept?: number; childCount?: number }> };
  tree: UiaNode;
}
export interface DescribeRow {
  name?: string;
  path?: string;
  type?: string;
}
export interface Artifact {
  path: string;
  sha256: string;
}

export interface L06Kernels {
  /** The passive walk of the World Editor window; the redacted document and where it lies. */
  walk: (ctx: WalkerStepContext) => Promise<Artifact & { doc: WalkDoc }>;
  /** wb_container describe open:WorldEditor, mode page; the response written to the run folder. */
  describe: (
    ctx: WalkerStepContext,
  ) => Promise<Artifact & { ok: boolean; rows: DescribeRow[]; message?: string }>;
  /** A raw obs file of this run, or null (the cross-check step reads the walk step's lines). */
  readText: (path: string) => string | null;
  /** Write a run-folder file; returns its sha256. */
  writeArtifact: (path: string, text: string) => string;
  /** The E15 attribute names (`key.attr`). */
  e15Attrs: () => string[];
  /** The E16 lines and the file's sha256. */
  e16: () => { lines: Array<Record<string, unknown>>; sha256: string };
}

// ── Pure line building ───────────────────────────────────────────────────────

/** True for a property-grid tree: common.ts `isPropertyGrid` (a Tree or Table named *PropertyGrid*). */
export const isGrid = (n: UiaNode): boolean => isPropertyGrid(n);

/** A name for matching: no `m_`/`m` prefix, lower case, letters and digits only. */
export function matchName(s: string): string {
  return s
    .replace(/^m_?(?=[A-Z_])/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function lastSeg(id: string | undefined): string {
  return (id ?? "").split(".").pop() ?? "";
}

function isExpandable(n: UiaNode): boolean {
  return (n.patterns ?? []).includes("ExpandCollapse") || (n.children?.length ?? 0) > 0;
}

/**
 * The property-group and property lines of every grid in one walk. `sha` is the walk file's
 * sha256 (the ref), `attrs` the matchName set of E15 attribute names.
 */
export function gridLines(
  doc: WalkDoc,
  sha: string,
  module: string,
  state: ObservedState,
  attrs: ReadonlySet<string>,
  rowSample: number = ROW_SAMPLE,
): LiveObservation[] {
  const out: LiveObservation[] = [];
  const windowClass = doc.target?.className;
  const sampled = new Set((doc.sampling?.applied ?? []).map((a) => a.path));
  const grids: Array<{ n: UiaNode; path: string; dock: UiaNode | null }> = [];
  const docks: UiaNode[] = [];
  (function visit(n: UiaNode, path: string, dock: UiaNode | null): void {
    const isDock = n.controlType === "Window" && n.className === "QDockWidget";
    if (isDock) docks.push(n);
    const d = isDock ? n : dock;
    if (isGrid(n)) grids.push({ n, path, dock: d });
    (n.children ?? []).forEach((c, i) => visit(c, `${path}/${i}`, d));
  })(doc.tree, "0", null);
  const count = (xs: UiaNode[], name: string): number =>
    xs.filter((x) => lastSeg(x.automationId) === name).length;
  const gridNodes = grids.map((g) => g.n);
  const ref = (p: string): string => `artifact:${sha}#n/${p}`;
  // DEC-078: an id and type more than one element of the walk carries gets its ordinal (document
  // order, from this walk); a grid item is named by the grid's id and its labels below the grid.
  const ordinals = locatorOrdinals(doc.tree);
  const loc = (n: UiaNode, path: string) => {
    const o = n.automationId ? ordinals.get(path) : undefined;
    return {
      ...(n.automationId ? { automationId: n.automationId } : {}),
      ...(o ? { ordinal: o.ordinal } : {}),
      controlType: n.controlType,
      ...(windowClass ? { windowClass } : {}),
    };
  };
  const itemLoc = (grid: UiaNode, item: UiaNode, labels: string[]) => ({
    automationId: grid.automationId!,
    itemPath: labels,
    controlType: item.controlType,
    ...(windowClass ? { windowClass } : {}),
  });
  grids.forEach((g, gi) => {
    const dockKey: LiveKey | null = g.dock
      ? chooseKey(
          {
            automationId: g.dock.automationId,
            className: g.dock.className,
            ancestorLabels: [],
            name: g.dock.name ?? "",
          },
          (o) => count(docks, o) === 1,
        ).key
      : null;
    const dockLabel = g.dock?.name?.trim() ? [g.dock.name] : [];
    const unnamedGrids = gridNodes.slice(0, gi + 1).filter((x) => !x.name?.trim()).length;
    const gid = chooseKey(
      {
        automationId: g.n.automationId,
        className: g.n.className,
        ancestorLabels: dockLabel as string[],
        name: g.n.name ?? "",
        unnamedOrdinal: unnamedGrids,
      },
      (o) => count(gridNodes, o) === 1,
    );
    const gridSeg = "object_name" in gid.key ? gid.key.object_name : gid.key.path.at(-1)!;
    const rows = g.n.children ?? [];
    const isSampled =
      sampled.has(g.path) ||
      (g.n.gridRowCount ?? 0) > rowSample ||
      (g.n.childCount ?? rows.length) > rows.length;
    const gridKey = { dim: "ui", kind: "property-group" as const, module, key: gid.key };
    const gridNotes = [...(gid.unverified ?? [])];
    if (isSampled)
      gridNotes.push(
        `${DEFERRED_SAMPLED} (kept ${rows.length} of ${g.n.childCount ?? "?"} rows; gridRowCount ${g.n.gridRowCount ?? "?"})`,
      );
    const gridLine: LiveObservation = {
      dim: "ui",
      kind: "property-group",
      module,
      key: gid.key,
      parent_key: dockKey ? { dim: "ui", kind: "dock", module, key: dockKey } : null,
      origin: "vanilla",
      ...(g.n.name?.trim() ? { label: normalizeLabel(g.n.name), label_raw: g.n.name } : {}),
      locator: loc(g.n, g.path),
      observed_state: stateFor(module, "property-group", state),
      ...(isSampled ? {} : { children_count: rows.length }),
      ref: ref(g.path),
      confidence: gid.confidence ?? "high",
      ...(gridNotes.length ? { unverified: gridNotes } : {}),
    };
    out.push(gridLine);
    const rowsOf = (
      items: UiaNode[],
      basePath: string,
      prefix: string[],
      parent: LiveObservation["parent_key"],
      /** The labels from the grid to this level; null below an unnamed item (no label path). */
      labels: string[] | null,
    ): void => {
      let unnamed = 0;
      items.forEach((r, i) => {
        if (r.controlType !== "TreeItem" && r.controlType !== "DataItem") return;
        const p = `${basePath}/${i}`;
        const name = (r.name ?? "").trim();
        const seg = name ? r.name! : `@${r.className || "TreeItem"}.${++unnamed}`;
        const key: LiveKey = { path: [...prefix, seg] };
        const itemLabels = labels && name ? [...labels, r.name!] : null;
        const expandable = isExpandable(r);
        const kids = r.children ?? [];
        const notes: string[] = [];
        if (!name) notes.push("no accessible name; ordinal identity");
        if (expandable && kids.length === 0) notes.push(COLLAPSED_NOTE);
        if (!expandable && name && !attrs.has(matchName(name))) notes.push(NO_E15_MATCH);
        const line: LiveObservation = {
          dim: "ui",
          kind: expandable ? "property-group" : "property",
          module,
          key,
          parent_key: parent,
          origin: "vanilla",
          ...(name ? { label: normalizeLabel(r.name!), label_raw: r.name! } : {}),
          locator: itemLabels && g.n.automationId ? itemLoc(g.n, r, itemLabels) : loc(r, p),
          observed_state: stateFor(module, expandable ? "property-group" : "property", state),
          ...(expandable && kids.length > 0 && !isSampled ? { children_count: kids.length } : {}),
          ...(!expandable ? { children_count: 0 } : {}),
          ref: ref(p),
          confidence: name ? "high" : "low",
          ...(notes.length ? { unverified: notes } : {}),
        };
        out.push(line);
        if (kids.length)
          rowsOf(
            kids,
            p,
            key.path,
            {
              dim: "ui",
              kind: line.kind,
              module,
              key,
            },
            itemLabels,
          );
      });
    };
    rowsOf(rows, g.path, [...(dockLabel as string[]), gridSeg], gridKey, []);
  });
  return out;
}

/** The property-editor lines of every E16 editor that has a popup (D16c). */
export function editorLines(
  e16: ReadonlyArray<Record<string, unknown>>,
  sha: string,
): LiveObservation[] {
  const popups = e16.filter((l) => l.kind === "dialog");
  const out: LiveObservation[] = [];
  for (const p of popups) {
    const parent = p.parent_key as { kind?: string; key?: { path?: string[] } } | null;
    const path = parent?.key?.path;
    if (parent?.kind !== "property-editor" || !path) continue;
    const label = path[path.length - 1];
    out.push({
      dim: "ui",
      kind: "property-editor",
      module: "Shared",
      key: { path: [...path] },
      parent_key: null,
      origin: "vanilla",
      label: normalizeLabel(label),
      label_raw: label,
      observed_state: {},
      modal: "opens",
      ref: `artifact:${sha}#e16/${path.join("/")}`,
      confidence: "medium",
      unverified: [DEFERRED_POPUP],
    });
  }
  return out;
}

/** Row names of the walk's property lines against the describe rows. */
export function crossCheck(
  props: readonly LiveObservation[],
  rows: readonly DescribeRow[],
): { gridOnly: string[]; describeOnly: string[]; both: string[] } {
  const g = new Map<string, string>();
  for (const l of props)
    if (l.kind === "property" && l.label_raw) g.set(matchName(l.label_raw), l.label_raw);
  const d = new Map<string, string>();
  for (const r of rows) {
    const n = r.name ?? r.path ?? "";
    if (n) d.set(matchName(n), n);
  }
  return {
    both: [...g.keys()]
      .filter((k) => d.has(k))
      .map((k) => g.get(k)!)
      .sort(),
    gridOnly: [...g.keys()]
      .filter((k) => !d.has(k))
      .map((k) => g.get(k)!)
      .sort(),
    describeOnly: [...d.keys()]
      .filter((k) => !g.has(k))
      .map((k) => d.get(k)!)
      .sort(),
  };
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export function readAction(): PlanAction {
  return {
    kind: "uia-read",
    target: {
      pid: "lane-recorded",
      window: { className: WINDOW_CLASS, titlePattern: TITLE_PATTERN, allowOwned: false },
    } as unknown as PlanAction["target"],
    readOnly: true,
    view: "control",
    bounds: { ...BOUNDS },
  };
}

export function describeAction(): PlanAction {
  return {
    kind: "net-call",
    target: { apiFunc: CONTAINER_HANDLER },
    params: {
      action: "describe",
      target: "open:WorldEditor",
      mode: "page",
      fields: "path,name,type",
    },
  };
}

// ── Steps ────────────────────────────────────────────────────────────────────

function runFile(ctx: WalkerStepContext, suffix: string): string {
  return join(
    ctx.opts.runDir,
    `${ENUMERATOR}-${ctx.opts.module}-${stateTag(ctx.opts.state)}-${suffix}`,
  );
}

export function makeDef(k: L06Kernels): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    script: SCRIPT,
    session: "P4-1",
    defaultModule: "WorldEditor",
    // The walk targets the World Editor window only: another --module plans no step (as L17 does)
    // rather than labelling World Editor grids with that module.
    steps: ({ module }) =>
      module !== "WorldEditor"
        ? []
        : [
            {
              id: "p4-l06-grids-walk",
              title:
                "passive read of the World Editor window; grid rows to property-group and property lines",
              risk: "read-only",
              timeout_ms: BOUNDS.budgetMs + 30_000,
              expected:
                "edit/none: the grids with 0 rows; edit/entity: the Object Properties rows [unverified: row shape]",
              kill_criterion:
                "any new window (STOP), a dialog-like window (HANDOFF), the walker timing out",
              side_effects: [],
              rollback: "none needed (passive read)",
              plan: () => [readAction()],
              run: async (ctx) => {
                const w = await ctx.call("uia-read", () => k.walk(ctx));
                const attrs = new Set(k.e15Attrs().map(matchName));
                const lines = gridLines(w.doc, w.sha256, ctx.opts.module, ctx.opts.state, attrs);
                ctx.emit(lines);
                const grids = lines.filter(
                  (l) => l.parent_key?.kind === "dock" || l.parent_key === null,
                );
                const sampled = lines.filter((l) =>
                  l.unverified?.some((u) => u.startsWith(DEFERRED_SAMPLED)),
                );
                return {
                  status: "observed",
                  summary: `${grids.length} grid(s), ${lines.length} line(s), ${sampled.length} sampled`,
                  artifacts: [{ path: w.path, sha256: w.sha256 }],
                };
              },
            },
            {
              id: "p4-l06-container-check",
              title:
                "wb_container describe open:WorldEditor; compare its row names with the grid rows",
              risk: "read-only",
              timeout_ms: 60_000,
              expected:
                "[unverified] which container open:WorldEditor describes while an entity is selected",
              kill_criterion: "any new window (STOP); the NET call unanswered in 30 s (no retry)",
              side_effects: ["the handler's full dump written under <artifacts>/container/"],
              rollback: "none needed (read; the dump lies in the artifacts folder)",
              plan: () => [describeAction()],
              run: async (ctx) => {
                const d = await ctx.call("net-call EMCP_WB_Container describe", () =>
                  k.describe(ctx),
                );
                const text = k.readText(ctx.obsPath) ?? "";
                const props = text
                  .split("\n")
                  .filter(Boolean)
                  .map((l) => JSON.parse(l) as LiveObservation);
                const cc = d.ok ? crossCheck(props, d.rows) : null;
                const out = runFile(ctx, "crosscheck.json");
                const sha = k.writeArtifact(
                  out,
                  JSON.stringify(
                    {
                      describe: {
                        path: d.path,
                        sha256: d.sha256,
                        ok: d.ok,
                        message: d.message ?? null,
                      },
                      crossCheck: cc,
                    },
                    null,
                    1,
                  ) + "\n",
                );
                return {
                  status: d.ok ? "observed" : "fail",
                  summary: cc
                    ? `both ${cc.both.length}, grid only ${cc.gridOnly.length}, describe only ${cc.describeOnly.length}`
                    : `describe failed: ${d.message ?? "no message"}`,
                  artifacts: [
                    { path: d.path, sha256: d.sha256 },
                    { path: out, sha256: sha },
                  ],
                };
              },
            },
            ...[
              {
                id: "p4-l06-editors-deferred",
                title: "E16 UIWidgets popups as deferred property-editor rows (no popup opened)",
                risk: "read-only" as const,
                timeout_ms: 10_000,
                expected: "one property-editor line per E16 popup (6 in 1.8.0.13)",
                kill_criterion: "any new window (STOP)",
                side_effects: [],
                rollback: "none needed (no Workbench call)",
                plan: () => [],
                run: async (ctx: WalkerStepContext) => {
                  const e = k.e16();
                  const lines = editorLines(e.lines, e.sha256);
                  ctx.emit(lines);
                  return {
                    status: "observed" as const,
                    summary: `${lines.length} property-editor line(s) deferred (${DEFERRED_POPUP})`,
                  };
                },
              },
            ],
          ],
  };
}

// ── Real kernels ─────────────────────────────────────────────────────────────

const E15_FILE = join(REPO_ROOT, "data", "census", "observations", "E15", "1.8.0.13.jsonl");
const E16_FILE = join(REPO_ROOT, "data", "census", "observations", "E16", "1.8.0.13.jsonl");
const sha256 = (t: string | Buffer): string => createHash("sha256").update(t).digest("hex");

function jsonl(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l.$header === undefined);
}

/** The live kernels; walk.ts takes the step's lane (`ctx.lane`). */
export function realKernels(): L06Kernels {
  const writeArtifact = (p: string, t: string): string => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, t, { encoding: "utf-8", flag: "wx" });
    return sha256(t);
  };
  return {
    walk: async (ctx) => {
      if (!ctx.lane.id) throw new Error("the walk needs the lane id (--id)");
      const out = runFile(ctx, "walk.json");
      const tsx = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
      const flags = Object.entries(BOUNDS).flatMap(([key, v]) => [
        `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
        String(v),
      ]);
      const args = [
        "--import",
        tsx,
        join(REPO_ROOT, "tools", "uia", "walk.ts"),
        "--pid",
        String(ctx.pid),
        "--class",
        WINDOW_CLASS,
        "--title-pattern",
        TITLE_PATTERN,
        "--view",
        "control",
        "--label",
        "l06-grids",
        "--out",
        out,
        ...laneArgv(ctx.lane),
        ...flags,
        "--really",
      ];
      const stdout = await new Promise<string>((res, rej) => {
        const c = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true });
        let buf = "";
        c.stdout.on("data", (b) => (buf += String(b)));
        const kill = () => c.kill();
        ctx.signal.addEventListener("abort", kill);
        c.on("error", rej);
        c.on("close", (code) => {
          ctx.signal.removeEventListener("abort", kill);
          if (code === 0) res(buf);
          else rej(new Error(`walk.ts exited ${code}`));
        });
      });
      const last = stdout.trim().split(/\r?\n/).pop() ?? "";
      const s = JSON.parse(last) as { sha256: string | null };
      if (!existsSync(out) || !s.sha256) throw new Error("walk.ts wrote no document");
      return {
        path: out,
        sha256: s.sha256,
        doc: JSON.parse(readFileSync(out, "utf-8")) as WalkDoc,
      };
    },
    describe: async (ctx) => {
      const [{ loadConfig }, { WorkbenchClient }, { runContainer }] = await Promise.all([
        import("../../../src/config.js"),
        import("../../../src/workbench/client.js"),
        import("../../../src/tools/wb-container.js"),
      ]);
      const client = new WorkbenchClient("127.0.0.1", loadConfig().workbenchPort);
      const r = await runContainer(client, {
        action: "describe",
        target: "open:WorldEditor",
        mode: "page",
        fields: "path,name,type",
      });
      const out = runFile(ctx, "describe.json");
      const sha = writeArtifact(out, JSON.stringify(r, null, 1) + "\n");
      const rows = r.ok
        ? (((r.readback as { rows?: DescribeRow[] }).rows ?? []) as DescribeRow[])
        : [];
      return { path: out, sha256: sha, ok: r.ok, rows, ...(r.ok ? {} : { message: r.message }) };
    },
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
    writeArtifact,
    e15Attrs: () =>
      jsonl(E15_FILE)
        .map((l) => (l.key as { attr?: string } | undefined)?.attr)
        .filter((a): a is string => typeof a === "string"),
    e16: () => ({ lines: jsonl(E16_FILE), sha256: sha256(readFileSync(E16_FILE)) }),
  };
}

if (isMainModule(import.meta.url)) {
  runWalker(makeDef(realKernels()), process.argv.slice(2)).then((c) => process.exit(c));
}
