/**
 * L17: the Qt Introspection Tool harvest (design `docs/v2/design/phase4-live-census.md` sections
 * 2 to 4, D11, D12, D13, D17; plan Phase 4 L17, unknown U31). Passive, conditional and short:
 *
 *   p4-l17-gate        reads the L02 observation of the same sitting for the EXACT label
 *                      "Qt Introspection Tool" under the "Utilities" menu (kind menu-item, key path
 *                      ["Utilities", "Qt Introspection Tool"], module ResourceManager) and checks
 *                      policy `execute_action.allow_list` for that path. Both true: "present".
 *                      Otherwise the step records "absent" with the reason (sf-13 did not read the
 *                      label on 2026-10-10) and the block ends with exit 0.
 *   p4-l17-open-walk   present only: `wb_module action` (the EMCP_WB_Module handler, whose compiled
 *                      allow list holds this one path) with menuPath ["Utilities", "Qt Introspection
 *                      Tool"], one pause, one `uia-read` of the new window (tools/uia/walk.ts,
 *                      `--allow-owned` always passed: the window is a Qt tool window and may be
 *                      owned), then the walk becomes observation lines of kinds window, panel,
 *                      control and dock (L17's registered kinds; universes.json).
 *   p4-l17-handoff     present only: the window is left open; the step ends with a HANDOFF (exit 5):
 *                      the owner closes it by hand. No script closes it: no scripted close is
 *                      proven for this window (D13 rule 4, D14 covers Options only).
 *
 * Nothing is typed, no key is sent, no menu leaf is invoked through UIA (the open is the handler's
 * allow-listed ExecuteAction), no prompt is answered. The kernel calls sit behind `L17Kernel` so the
 * test drives the whole script on fakes. Each step re-derives "present" from the files on disk, so
 * `--only <step>` after a handoff or a relaunch needs no state from an earlier invocation.
 *
 * Usage (design 2.1):
 *   npx --no tsx scripts/census/live/L17-qt.ts [--out <plan.json>] [--outline <file>]
 *   npx --no tsx scripts/census/live/L17-qt.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module ResourceManager --from p4-l17-gate
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runModule, type ModuleArgs } from "../../../src/tools/wb-module.js";
import { WorkbenchClient } from "../../../src/workbench/client.js";
import { boundFlag, type WalkBounds } from "../../../tools/uia/walk.js";
import type { PlanAction } from "../../live/dry-run.js";
import { DEFAULT_PORT } from "../../live/netcall.js";
import { REPO_ROOT } from "../../live/paths.js";
import { loadPolicy } from "../../live/policy.js";
import {
  StopBattery,
  chooseKey,
  deriveId,
  isMainModule,
  kindOf,
  laneArgv,
  normalizeLabel,
  objectNameOf,
  runWalker,
  type KindNode,
  type LiveKind,
  type LiveObservation,
  type WalkerDef,
  type WalkerLane,
  type WalkerStep,
} from "./common.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const SCRIPT = "scripts/census/live/L17-qt.ts";
export const ENUMERATOR = "L17";
/** The one menu path (policy execute_action.allow_list; EMCP_WB_ActionAllowList.c). */
export const QT_PATH: readonly string[] = ["Utilities", "Qt Introspection Tool"];
export const QT_LABEL = "Qt Introspection Tool";
export const QT_MODULE = "ResourceManager";
/**
 * [unverified] until the first live run: the class of the new window and its title. walker.py
 * full-matches the pattern (re.fullmatch), so it is anchored around the fragment.
 */
export const WINDOW_CLASS = "Qt683QWindowIcon";
export const TITLE_PATTERN = "^.*Introspection.*$";
export const GATE_STEP = "p4-l17-gate";
export const WALK_STEP = "p4-l17-open-walk";
export const HANDOFF_STEP = "p4-l17-handoff";
export const WALK_FILE = "l17-qt-walk.json";
/** Pause between the open and the read (the window needs a moment; no retry follows). */
export const OPEN_SETTLE_MS = 2_000;
/** The census bounds of the one read; the plan and the spawned walker carry the same numbers. */
export const BOUNDS: WalkBounds = {
  maxDepth: 40,
  maxNodes: 5_000,
  budgetMs: 120_000,
  rowSample: 40,
  maxChildren: 1_000,
  countCap: 2_000,
  callTimeoutMs: 5_000,
  slowCallMs: 10_000,
  maxConsecutiveErrors: 5,
};
const WALK_GRACE_MS = 30_000;

/** The window the open may add: by title fragment as an editor window, or by exact title as a dialog. */
const EXPECTS = [new RegExp(TITLE_PATTERN)];
const DIALOGS = [
  { title: QT_LABEL, owned: true },
  { title: QT_LABEL, owned: false },
];

// ── The L02 gate ─────────────────────────────────────────────────────────────

export interface L02Finding {
  present: boolean;
  /** `<run folder>/<file>` of the line that read the label (names only, no absolute path). */
  source: string | null;
  /** That line's `ref`. */
  ref: string | null;
  /** How many L02 raw files were read. */
  filesRead: number;
}

/**
 * Does one L02 raw line read the exact label under Utilities: kind menu-item, module
 * ResourceManager, `label_raw` exactly "Qt Introspection Tool", and the menu path (the key path, else
 * the locator's) exactly ["Utilities", "Qt Introspection Tool"].
 */
export function readsQtLabel(line: unknown): boolean {
  if (!line || typeof line !== "object") return false;
  const o = line as Record<string, unknown>;
  if (o.kind !== "menu-item" || o.module !== QT_MODULE || o.label_raw !== QT_LABEL) return false;
  const same = (p: unknown): boolean =>
    Array.isArray(p) && p.length === QT_PATH.length && p.every((s, i) => s === QT_PATH[i]);
  const key = o.key as { path?: unknown } | undefined;
  const loc = o.locator as { menuPath?: unknown } | undefined;
  return same(key?.path) || same(loc?.menuPath);
}

/**
 * L02's raw observation files of the same sitting: `L02-ResourceManager-*.obs.jsonl` in the run
 * folder and in its sibling run folders (the date folder of the sitting). Pure over the three
 * readers, so the test needs no disk.
 */
export function findQtLabel(
  runDir: string,
  io: {
    listDir: (dir: string) => string[];
    isDir: (p: string) => boolean;
    read: (p: string) => string | null;
  },
): L02Finding {
  const dirs = [runDir];
  for (const name of io.listDir(dirname(runDir)).sort()) {
    const p = join(dirname(runDir), name);
    if (p !== runDir && io.isDir(p)) dirs.push(p);
  }
  let filesRead = 0;
  let hit: { source: string; ref: string | null } | null = null;
  for (const d of dirs) {
    for (const f of io.listDir(d).sort()) {
      if (!/^L02-ResourceManager-.*\.obs\.jsonl$/.test(f)) continue;
      const text = io.read(join(d, f));
      if (text === null) continue;
      filesRead++;
      for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) continue;
        let o: unknown;
        try {
          o = JSON.parse(raw);
        } catch {
          continue;
        }
        if (!hit && readsQtLabel(o))
          hit = {
            source: `${basename(d)}/${f}`,
            ref:
              typeof (o as { ref?: unknown }).ref === "string" ? (o as { ref: string }).ref : null,
          };
      }
    }
  }
  return { present: hit !== null, source: hit?.source ?? null, ref: hit?.ref ?? null, filesRead };
}

/** Is the path on the policy's ExecuteAction allow list, segment for segment, exactly. */
export function policyListsQt(policy: {
  execute_action?: { allow_list?: Array<string | string[]> };
}): boolean {
  return (policy.execute_action?.allow_list ?? []).some(
    (e) => Array.isArray(e) && e.length === QT_PATH.length && e.every((s, i) => s === QT_PATH[i]),
  );
}

// ── Tree to lines ────────────────────────────────────────────────────────────

/** One node of a walk file (tools/uia/walker.py, schema emcp-uia-walk/1). */
export interface WalkNode {
  controlType: string;
  name?: string;
  automationId?: string;
  className?: string;
  patterns?: string[];
  childCount?: number;
  children?: WalkNode[];
  legacyDescription?: string;
  sampled?: unknown;
}

export interface ConvertInput {
  tree: WalkNode;
  /** sha256 of the walk file bytes (D4). */
  sha256: string;
  module: string;
  windowClass: string;
}

export interface Conversion {
  lines: LiveObservation[];
  /** Why nodes got no line: reason to count. */
  skipped: Record<string, number>;
}

interface Cn {
  node: WalkNode;
  path: string;
  verdict: ReturnType<typeof kindOf> | { kind: "window" };
  children: Cn[];
  parent: Cn | null;
  emitted?: LiveObservation;
  seg?: string;
}

const EDITABLE = new Set(["Edit", "ComboBox", "CheckBox"]);
const DATA_ROW = new Set(["ListItem", "TreeItem"]);

function classify(
  node: WalkNode,
  path: string,
  parent: Cn | null,
  siblings: WalkNode[],
  flags: { toolBar: boolean; dataRow: boolean },
): Cn {
  const name = node.name ?? "";
  const cn: Cn = { node, path, verdict: { deferred: "" }, children: [], parent };
  if (!parent) {
    if (node.controlType !== "Window")
      throw new StopBattery("stopped", `the walked root is a ${node.controlType}, not a Window`);
    cn.verdict = { kind: "window" };
  } else if (flags.dataRow || DATA_ROW.has(node.controlType)) {
    cn.verdict = { deferred: "data row of the tool's lists (the inspected app's widgets)" };
  } else {
    const kn: KindNode = {
      controlType: node.controlType,
      className: node.className,
      name,
      underToolBar: flags.toolBar,
      expandable: (node.patterns ?? []).includes("ExpandCollapse"),
      underStatusBar: parent.node.controlType === "StatusBar",
      labelsEditable:
        node.controlType === "Text" &&
        name.trim() !== "" &&
        siblings.some((s) => EDITABLE.has(s.controlType)),
      dockContents: (node.className ?? "").endsWith("Contents"),
      inPropertyGrid: false,
      childCount: node.children?.length ?? 0,
    };
    cn.verdict = kindOf(kn, ENUMERATOR);
  }
  const kids = node.children ?? [];
  const next = {
    toolBar: flags.toolBar || node.controlType === "ToolBar",
    dataRow: flags.dataRow || DATA_ROW.has(node.controlType),
  };
  cn.children = kids.map((k, i) => classify(k, `${path}/${i}`, cn, kids, next));
  return cn;
}

const reasonOf = (v: Cn["verdict"]): string =>
  "kind" in v
    ? ""
    : "dismissed" in v
      ? `dismissed ${v.dismissed}`
      : "foldLabel" in v
        ? "label text folded into the control beside it"
        : "deferred" in v
          ? v.deferred
          : `kind ${v.outOfScope} is not registered for ${ENUMERATOR}`;

/**
 * The walk as observation lines (design 1.2 to 1.3): kinds by `kindOf(node, "L17")`, identity by
 * `chooseKey` (object name when unique per kind, else the label path; an unnamed or duplicate-named
 * node an ordinal), `parent_key` the nearest emitted ancestor, `children_count` only when every child
 * node became a line and the read was not truncated or sampled, `observed_state` `{}` (no axis is
 * declared for the Resource Manager's tool windows). Rows the table gives no L17 kind to are
 * counted in `skipped`, never invented; the widget lists' data rows are not rows.
 */
export function treeToLines(inp: ConvertInput): Conversion {
  const root = classify(inp.tree, "0", null, [], { toolBar: false, dataRow: false });
  const skipped: Record<string, number> = {};
  // Uniqueness of object names per kind, over the nodes that get a line.
  const counts = new Map<string, number>();
  const all: Cn[] = [];
  (function collect(c: Cn): void {
    all.push(c);
    c.children.forEach(collect);
  })(root);
  for (const c of all) {
    if (!("kind" in c.verdict)) {
      const r = reasonOf(c.verdict);
      skipped[r] = (skipped[r] ?? 0) + 1;
      continue;
    }
    const cand = objectNameOf(c.node.automationId, c.node.className);
    if (cand)
      counts.set(`${c.verdict.kind}|${cand}`, (counts.get(`${c.verdict.kind}|${cand}`) ?? 0) + 1);
  }
  const lines: LiveObservation[] = [];
  const seen = new Set<string>();
  const ordinals = new Map<string, number>();
  const emit = (c: Cn, parentLine: Cn | null, ancestors: string[]): void => {
    let nextParent = parentLine;
    let nextAncestors = ancestors;
    if ("kind" in c.verdict) {
      const kind: LiveKind = c.verdict.kind;
      const n = c.node;
      let name = n.name ?? "";
      const sibs = c.parent?.node.children ?? [];
      if (!name.trim() && EDITABLE.has(n.controlType)) {
        const at = sibs.indexOf(n);
        for (let i = at - 1; i >= 0; i--) {
          if (sibs[i].controlType === "Text" && (sibs[i].name ?? "").trim()) {
            name = sibs[i].name ?? "";
            break;
          }
          if (sibs[i].controlType !== "Text") break;
        }
      }
      const unnamedOrdinal =
        sibs
          .filter((s) => (s.className ?? "") === (n.className ?? "") && !(s.name ?? "").trim())
          .indexOf(n) + 1 || 1;
      const id0 = chooseKey(
        {
          automationId: n.automationId,
          className: n.className,
          ancestorLabels: ancestors,
          name,
          unnamedOrdinal,
        },
        (o) => counts.get(`${kind}|${o}`) === 1,
      );
      let { key, confidence, unverified } = id0;
      const probe = (k: typeof key): string =>
        deriveId({ dim: "ui", kind, module: inp.module, key: k });
      if (seen.has(probe(key))) {
        const gk = `${ancestors.join("/")}|${n.className ?? "unknown"}`;
        let o = ordinals.get(gk) ?? 0;
        do {
          o += 1;
          key = { path: [...ancestors, `@${n.className ?? "unknown"}.${o}`] };
        } while (seen.has(probe(key)));
        ordinals.set(gk, o);
        confidence = "low";
        unverified = ["duplicate accessible name among siblings; ordinal identity"];
      }
      seen.add(probe(key));
      const seg = "path" in key ? key.path[key.path.length - 1] : name || key.object_name;
      const line: LiveObservation = {
        dim: "ui",
        kind,
        module: inp.module,
        key,
        parent_key: parentLine?.emitted
          ? {
              dim: parentLine.emitted.dim,
              kind: parentLine.emitted.kind,
              module: parentLine.emitted.module,
              key: parentLine.emitted.key,
            }
          : null,
        origin: "vanilla",
        ...(name.trim() ? { label: normalizeLabel(name), label_raw: name } : {}),
        locator: {
          ...(n.automationId ? { automationId: n.automationId } : {}),
          controlType: n.controlType,
          windowClass: inp.windowClass,
        },
        observed_state: {},
        ...(n.legacyDescription?.trim() ? { quote: n.legacyDescription } : {}),
        ref: `artifact:${inp.sha256}#n/${c.path}`,
        confidence: confidence ?? "high",
        ...(unverified ? { unverified } : {}),
      };
      c.emitted = line;
      c.seg = seg;
      lines.push(line);
      nextParent = c;
      nextAncestors = [...ancestors, seg];
    }
    c.children.forEach((k) => emit(k, nextParent, nextAncestors));
    if (c.emitted) {
      const all = c.children.every((k) => k.emitted);
      const whole =
        c.node.sampled === undefined &&
        (c.node.childCount ?? c.children.length) === c.children.length;
      if (all && whole) c.emitted.children_count = c.children.length;
    }
  };
  emit(root, null, []);
  const first = lines[0];
  const notes = Object.entries(skipped)
    .map(([r, n]) => `${n} x ${r}`)
    .sort();
  if (notes.length)
    first.unverified = [...(first.unverified ?? []), `no row for: ${notes.join("; ")}`];
  return { lines, skipped };
}

// ── The kernel ───────────────────────────────────────────────────────────────

export interface OpenOutcome {
  /** The handler answered and ExecuteAction returned true. */
  executed: boolean;
  detail: string;
}

export interface WalkOutcome {
  ok: boolean;
  tree: WalkNode | null;
  sha256: string | null;
  windowClass: string;
  completed: boolean | null;
  nodes: number | null;
  detail: string;
}

/** Everything that touches a file, the NET API or a child process (a fake in the test). */
export interface L17Kernel {
  findLabel: (runDir: string) => L02Finding;
  policyLists: () => boolean;
  openTool: () => Promise<OpenOutcome>;
  /** walk.ts on the tool window; `lane` is the step's (`ctx.lane`). */
  walk: (runDir: string, pid: number, lane?: WalkerLane) => Promise<WalkOutcome>;
  /** The text of a file, or null when absent. */
  readText: (path: string) => string | null;
}

export function realKernel(port: number = DEFAULT_PORT): L17Kernel {
  let client: WorkbenchClient | undefined;
  return {
    findLabel: (runDir) =>
      findQtLabel(runDir, {
        listDir: (d) => (existsSync(d) ? readdirSync(d) : []),
        isDir: (p) => existsSync(p) && statSync(p).isDirectory(),
        read: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
      }),
    policyLists: () => policyListsQt(loadPolicy()),
    readText: (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
    openTool: async () => {
      client ??= new WorkbenchClient("127.0.0.1", port);
      const args: ModuleArgs = { action: "action", module: QT_MODULE, menuPath: [...QT_PATH] };
      const r = (await runModule(client, args)) as unknown as {
        ok: boolean;
        message?: string;
        code?: string;
        readback?: { result?: boolean };
      };
      if (!r.ok)
        return { executed: false, detail: `wb_module action refused: ${r.code} ${r.message}` };
      return {
        executed: r.readback?.result === true,
        detail: `wb_module action answered ok, ExecuteAction result ${String(r.readback?.result)}`,
      };
    },
    walk: (runDir, pid, lane) =>
      new Promise((done) => {
        const out = join(runDir, WALK_FILE);
        const fail = (detail: string): void =>
          done({
            ok: false,
            tree: null,
            sha256: null,
            windowClass: WINDOW_CLASS,
            completed: null,
            nodes: null,
            detail,
          });
        if (!lane?.id) return fail("the run has no lane id (--id): walk.ts needs it");
        const flags = (Object.keys(BOUNDS) as Array<keyof WalkBounds>).flatMap((k) => [
          `--${boundFlag(k)}`,
          String(BOUNDS[k]),
        ]);
        const argv = [
          "--import",
          "tsx",
          join(REPO_ROOT, "tools", "uia", "walk.ts"),
          "--pid",
          String(pid),
          "--class",
          WINDOW_CLASS,
          "--title-pattern",
          TITLE_PATTERN,
          "--view",
          "raw",
          "--allow-owned",
          "--label",
          "l17-qt",
          "--out",
          out,
          ...flags,
          ...laneArgv(lane),
          "--really",
        ];
        const child = spawn(process.execPath, argv, { cwd: REPO_ROOT, windowsHide: true });
        let stdout = "";
        child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
        const timer = setTimeout(() => child.kill(), BOUNDS.budgetMs + WALK_GRACE_MS);
        child.on("close", (code) => {
          clearTimeout(timer);
          let summary: Record<string, unknown> | null = null;
          try {
            summary = JSON.parse(stdout.trim().split(/\r?\n/).pop() ?? "") as Record<
              string,
              unknown
            >;
          } catch {
            summary = null;
          }
          if (code !== 0 || !existsSync(out))
            return fail(
              `walk.ts exit ${code}${summary?.reason ? `: ${String(summary.reason)}` : ""}`,
            );
          try {
            const bytes = readFileSync(out);
            const doc = JSON.parse(bytes.toString("utf-8")) as {
              tree?: WalkNode;
              target?: { className?: string };
            };
            done({
              ok: doc.tree !== undefined,
              tree: doc.tree ?? null,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              windowClass: doc.target?.className ?? WINDOW_CLASS,
              completed: typeof summary?.completed === "boolean" ? summary.completed : null,
              nodes: typeof summary?.nodes === "number" ? summary.nodes : null,
              detail: `walk.ts exit ${code}`,
            });
          } catch (e) {
            fail(`the walk file is not readable: ${e instanceof Error ? e.message : String(e)}`);
          }
        });
        child.on("error", (e) => fail(String(e)));
      }),
  };
}

// ── The steps ────────────────────────────────────────────────────────────────

const walkAction = (): PlanAction =>
  ({
    kind: "uia-read",
    target: {
      pid: "lane-recorded",
      window: { className: WINDOW_CLASS, titlePattern: TITLE_PATTERN, allowOwned: true },
    },
    readOnly: true,
    view: "raw",
    bounds: { ...BOUNDS },
  }) as unknown as PlanAction;

const openAction = (): PlanAction =>
  ({
    kind: "execute-action",
    target: { path: [...QT_PATH], module: QT_MODULE },
  }) as unknown as PlanAction;

/** Why the harvest does not run on this module or policy, or null. */
function notRunnable(module: string, k: L17Kernel): string | null {
  if (module !== QT_MODULE)
    return `absent: L17 runs on ${QT_MODULE} only (the Utilities menu is its own); --module ${module}`;
  if (!k.policyLists())
    return `absent: ["${QT_PATH.join('", "')}"] is not on policy execute_action.allow_list`;
  return null;
}

export function buildL17Steps(k: L17Kernel, module: string): WalkerStep[] {
  const why = notRunnable(module, k);
  const absent = (f: L02Finding): string =>
    `absent: no L02 line reads the exact label "${QT_LABEL}" under "Utilities" (${f.filesRead} L02 file(s) of the sitting read)`;
  return [
    {
      id: GATE_STEP,
      title: `gate: the exact label "${QT_LABEL}" under Utilities in the L02 observation of this sitting, and the policy allow list`,
      risk: "read-only",
      timeout_ms: 30_000,
      expected: `present (an L02 line and the policy entry) or absent, with the reason; nothing is sent`,
      kill_criterion: "any new window",
      side_effects: [],
      rollback: "none",
      plan: () => [],
      run: async (ctx) => {
        if (why) return { status: "observed", summary: why };
        const f = k.findLabel(ctx.opts.runDir);
        return {
          status: "observed",
          summary: f.present
            ? `present: ${f.source} reads "${QT_LABEL}" under Utilities (ref ${f.ref}); the policy lists ${QT_PATH.join(" > ")}`
            : absent(f),
        };
      },
    },
    {
      id: WALK_STEP,
      title: `open ${QT_MODULE} > ${QT_PATH.join(" > ")} by wb_module action, then one passive read of its window (present only)`,
      risk: "reversible",
      timeout_ms: 30_000 + OPEN_SETTLE_MS + BOUNDS.budgetMs + WALK_GRACE_MS,
      expected: `the tool window opens; the walk file yields window, panel and control lines; or absent: nothing opened`,
      kill_criterion:
        "a window other than the Qt Introspection Tool (stop and record); a dialog-like window (handoff)",
      side_effects: ["the Qt Introspection Tool window open until the owner closes it"],
      rollback: "the owner closes the Qt Introspection Tool window by hand",
      expectsWindows: EXPECTS,
      expectsDialogs: DIALOGS,
      plan: () => (why ? [] : [openAction(), walkAction()]),
      run: async (ctx) => {
        if (why) return { status: "observed", summary: why };
        const f = k.findLabel(ctx.opts.runDir);
        if (!f.present) return { status: "observed", summary: absent(f) };
        const o = await ctx.call("wb_module action", () => k.openTool());
        if (!o.executed)
          return {
            status: "fail",
            summary: `not opened: ${o.detail}; nothing walked, nothing retried`,
          };
        await ctx.sleep(OPEN_SETTLE_MS);
        const w = await ctx.call("uia-read", () => k.walk(ctx.opts.runDir, ctx.pid, ctx.lane));
        if (!w.ok || !w.tree || !w.sha256)
          return {
            status: "fail",
            summary: `opened: the tool window is up; the read failed (${w.detail}); the owner closes the window`,
          };
        const conv = treeToLines({
          tree: w.tree,
          sha256: w.sha256,
          module: ctx.opts.module,
          windowClass: w.windowClass,
        });
        ctx.emit(conv.lines);
        const kinds: Record<string, number> = {};
        for (const l of conv.lines) kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
        const skipped = Object.values(conv.skipped).reduce((a, b) => a + b, 0);
        return {
          status: w.completed === false ? "observed" : "pass",
          summary: `opened: ${conv.lines.length} line(s) (${Object.entries(kinds)
            .map(([a, b]) => `${a} ${b}`)
            .join(
              ", ",
            )}), ${skipped} node(s) without a row${w.completed === false ? "; the walk did not complete" : ""}`,
          artifacts: [{ path: join(ctx.opts.runDir, WALK_FILE), sha256: w.sha256 }],
        };
      },
    },
    {
      id: HANDOFF_STEP,
      title: "hand off: the owner closes the Qt Introspection Tool window by hand (present only)",
      risk: "reversible",
      timeout_ms: 30_000,
      expected: "exit 5 with the owner's close; or exit 0 when nothing was opened",
      kill_criterion: "any new window",
      side_effects: [],
      rollback: "none",
      plan: () => [],
      run: async (ctx) => {
        const rec = k.readText(join(ctx.opts.runDir, `${WALK_STEP}.json`));
        let summary = "";
        try {
          summary = (JSON.parse(rec ?? "{}") as { summary?: string }).summary ?? "";
        } catch {
          summary = "";
        }
        if (!summary.startsWith("opened:"))
          return { status: "observed", summary: "nothing was opened: no handoff" };
        throw new StopBattery(
          "handoff",
          `the ${QT_LABEL} window is open: the owner closes it by hand (no script closes it), then the block is done`,
        );
      },
    },
  ];
}

/** The walker definition over a kernel (the test passes a fake). */
export function makeL17Def(kernel: () => L17Kernel): WalkerDef {
  return {
    enumerator: ENUMERATOR,
    script: SCRIPT,
    session: "P4-8",
    defaultModule: QT_MODULE,
    steps: ({ module }) => buildL17Steps(kernel(), module),
  };
}

let real: L17Kernel | undefined;
export const def: WalkerDef = makeL17Def(() => (real ??= realKernel()));

if (isMainModule(import.meta.url)) {
  runWalker(def, process.argv.slice(2)).then((c) => process.exit(c));
}
