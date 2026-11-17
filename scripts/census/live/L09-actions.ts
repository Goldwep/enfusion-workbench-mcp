/**
 * L09, the ExecuteAction vocabulary battery (design phase4-live-census.md section 4, D11, D13.6).
 *
 *   npx --no tsx scripts/census/live/L09-actions.ts [--out <plan.json>] [--outline <file>] [--module <Id>]
 *   npx --no tsx scripts/census/live/L09-actions.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module WorldEditor [--state mode=edit,selection=none] --from p4-l09-ledger
 *
 * The battery is derived from policy.json `execute_action.allow_list`, never hand-written: each entry
 * is classified once (`classifyAllowList`).
 *   toggle      `Window > <dock>` with a dock oracle: read the dock's node count through `wb_gui find`
 *               (name = the dock), send `wb_module action` once, read again; when the count moved, send
 *               it a second time to toggle back and read a third time (P3-3 g2-05's form, 3 to 0 to 3).
 *               pass = both sends ok and the count back where it was. A send that answered
 *               ENGINE_FALSE (the handler matches labels exactly) or moved nothing is `observed` and is
 *               never sent again. An oracle unreadable before the first send: nothing is sent (fail).
 *   mutating    listed with its owning wave in the ledger step, never sent (`Edit > Undo`: S-E, U19).
 *   opener      opens a window of its own (`Utilities > Qt Introspection Tool`: L17, U31): listed, never
 *               sent; a new window would be a STOP here.
 *   w9          a DEC-092 safe-toggle row of any module: listed, never sent; tests/live/w9.live.ts drives it.
 *   unclassified  any other entry: listed, never sent, named in the ledger for main to classify.
 * Only the toggles of the run's `--module` are steps. Lines are emitted only for a path the engine
 * accepted (`menu-item`, key = the path as sent); a false answer is data in the step record, not a row.
 * Imports the runner, line type and window rule from common.ts; copies none of it.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SNAPSHOT_BOUNDS, snapshotPlanAction } from "../../../src/gui/uia.js";
import type { ModuleArgs } from "../../../src/tools/wb-module.js";
import { LANE_RECORDED_PID, type PlanAction } from "../../live/dry-run.js";
import { REPO_ROOT, toPlaceholders } from "../../live/paths.js";
import {
  splitName,
  type MenuItemDoc as L02MenuItem,
  type MenusDoc as L02MenusDoc,
} from "./L02-menus.js";
import { loadPolicy, type CensusPolicy } from "../../live/policy.js";
import type { WindowInfo } from "../../live/s-c-natives.js";
import {
  EDITOR_WINDOW_CLASS,
  isMainModule,
  normalizeLabel,
  runWalker,
  stateFor,
  type LiveObservation,
  type WalkerDef,
  type WalkerStep,
  type WalkerStepContext,
  type WalkerStepOutcome,
} from "./common.js";

export const SCRIPT = "scripts/census/live/L09-actions.ts";

/** Dock oracles: the normalised Window-menu leaf to the accessible name `wb_gui find` counts. */
export const DOCK_ORACLES: Readonly<Record<string, string>> = {
  hierarchy: "Hierarchy",
  "log console": "Log Console",
};

/** Allow-listed paths that change a document: never sent by L09, run by their owning wave. */
export const MUTATING: Readonly<Record<string, { module: string; wave: string; why: string }>> = {
  "edit>undo": {
    module: "WorldEditor",
    wave: "S-E (U19, DEC-040)",
    why: "undoes the last edit of the sandbox's tiny world",
  },
};

/** Allow-listed paths that open a window of their own: never sent by L09. */
export const OPENERS: Readonly<Record<string, { module: string; owner: string; why: string }>> = {
  "utilities>qt introspection tool": {
    module: "ResourceManager",
    owner: "L17 (U31, S-F)",
    why: "opens the Qt Introspection window; no toggle-back route, a new window is a STOP here",
  },
  // The D14 opener (design 2.2, owner ruling 1 of 2026-10-10): on the allow-list so the Enforce
  // handler runs it for L04; it opens the owned Options dialog, so L09 never sends it.
  "file>options...": {
    module: "WorldEditor",
    owner: "L04 (D14, live_lane.dialog_openers)",
    why: "opens the Options dialog (owned window); L04 owns the walk and the Cancel, a dialog is a HANDOFF here",
  },
};

/**
 * The DEC-092 safe-toggle paths (keys as segKey joins them): the plan file's safe-toggle rows, read
 * once. L09 never sends them; the W9 battery owns them.
 */
function planPaths(cls: string): ReadonlySet<string> {
  const file = join(REPO_ROOT, "docs", "v2", "inbox", "phase6", "bk3", "bk3-menu-plan.jsonl");
  // The plan is in the 2.0 programme record, which the public export leaves out: no rows there.
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { path: string; cls: string })
      .filter((l) => l.cls === cls)
      .map((l) =>
        l.path
          .split(" > ")
          .map((s) => normalizeLabel(s.replace(/&/g, "")).toLowerCase())
          .join(">"),
      ),
  );
}

export const W9_TOGGLES: ReadonlySet<string> = planPaths("safe-toggle");

/**
 * The plan file's safe-state rows (DEC-095 put 19 of them on the allow-list). L09 never sends
 * them; the W9 battery's view and selection block (W9.2) owns them.
 */
export const W9_VIEW: ReadonlySet<string> = planPaths("safe-state");

/** The module window each toggle's oracle reads (exact class, whole-title pattern). */
export const MODULE_WINDOW: Readonly<Record<string, { className: string; title: RegExp }>> = {
  WorldEditor: { className: EDITOR_WINDOW_CLASS, title: /^World Editor - / },
};

export type L09Item =
  | { kind: "toggle"; index: number; module: string; path: string[]; dock: string }
  | { kind: "mutating"; index: number; module: string; path: string[]; wave: string; why: string }
  | { kind: "opener"; index: number; module: string; path: string[]; owner: string; why: string }
  | { kind: "w9"; index: number; module: null; path: string[]; why: string }
  | { kind: "unclassified"; index: number; module: null; path: string[]; why: string };

const segKey = (s: string): string => normalizeLabel(s.replace(/&/g, "")).toLowerCase();

/** Every allow-list entry, classified (D13.6: only allow-listed paths exist for L09). */
export function classifyAllowList(policy: CensusPolicy): L09Item[] {
  const list = (policy.execute_action?.allow_list ?? []) as Array<string | string[]>;
  return list.map((raw, index) => {
    const path = Array.isArray(raw)
      ? raw.map(String)
      : String(raw)
          .split(">")
          .map((s) => s.trim());
    const key = path.map(segKey).join(">");
    if (MUTATING[key]) return { kind: "mutating", index, path, ...MUTATING[key] };
    if (OPENERS[key]) return { kind: "opener", index, path, ...OPENERS[key] };
    if (path.length === 2 && segKey(path[0]) === "window" && DOCK_ORACLES[segKey(path[1])])
      return {
        kind: "toggle",
        index,
        module: "WorldEditor",
        path,
        dock: DOCK_ORACLES[segKey(path[1])],
      };
    if (W9_TOGGLES.has(key))
      return {
        kind: "w9",
        index,
        module: null,
        path,
        why: "a DEC-092 safe-toggle row: the W9 battery (tests/live/w9.live.ts) reads and drives it",
      };
    if (W9_VIEW.has(key))
      return {
        kind: "w9",
        index,
        module: null,
        path,
        why: "a DEC-095 safe-state row: the W9 view and selection block (tests/live/w9.live.ts) owns it",
      };
    return {
      kind: "unclassified",
      index,
      module: null,
      path,
      why: "no rule names it; main classifies it",
    };
  });
}

/** A tool answer as the shipped tools return it. */
export interface ToolAnswer {
  ok: boolean;
  code?: string;
  message?: string;
  readback?: unknown;
}

/** What L09 calls: the window list, `wb_module`, `wb_gui` (fakes in tests). */
export interface L09Kernel {
  windows: () => Promise<WindowInfo[]>;
  module: (args: ModuleArgs) => Promise<ToolAnswer>;
  gui: (args: Record<string, unknown>) => Promise<ToolAnswer>;
}

/**
 * The live kernel: the step's own window list and the run's tool client (common.ts `ctx.windows`,
 * `ctx.tool`, built once from `--port`).
 */
export function ctxKernel(ctx: WalkerStepContext): L09Kernel {
  return {
    windows: () => ctx.windows(),
    module: async (args) =>
      (await ctx.tool("wb_module", args as unknown as Record<string, unknown>)) as ToolAnswer,
    gui: async (args) => (await ctx.tool("wb_gui", args)) as ToolAnswer,
  };
}

const field = (o: unknown, k: string): unknown =>
  o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stepId(item: L09Item): string {
  const slug = item.path
    .map((s) =>
      s
        .replace(/&/g, "amp")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    )
    .join("-")
    .replace(/^-+|-+$/g, "");
  return `p4-l09-t${String(item.index).padStart(2, "0")}-${slug}`;
}

function findPlan(item: Extract<L09Item, { kind: "toggle" }>): PlanAction {
  const w = MODULE_WINDOW[item.module];
  const a = snapshotPlanAction(
    {
      pid: LANE_RECORDED_PID as unknown as number,
      className: w.className,
      titlePattern: w.title.source.replace(/^\^/, "") + ".*",
    },
    DEFAULT_SNAPSHOT_BOUNDS,
  );
  return {
    ...a,
    note: `wb_gui find name="${item.dock}" (the dock oracle)`,
  } as unknown as PlanAction;
}

function sendPlan(item: Extract<L09Item, { kind: "toggle" }>): PlanAction[] {
  return [
    { kind: "execute-action", target: { path: [...item.path], module: item.module } } as PlanAction,
    {
      kind: "net-call",
      target: "EMCP_WB_Module",
      params: {
        action: "action",
        moduleName: item.module,
        menuPath: [...item.path],
        keepFocus: true,
      },
      note: "through the shipped wb_module tool",
    } as PlanAction,
  ];
}

function describeItem(i: L09Item): string {
  const p = i.path.join(" > ");
  switch (i.kind) {
    case "toggle":
      return `${p}: toggle, oracle dock "${i.dock}"`;
    case "mutating":
      return `${p}: mutating, not run; owner ${i.wave}`;
    case "opener":
      return `${p}: opener, not run; owner ${i.owner}`;
    case "w9":
      return `${p}: ${i.why.startsWith("a DEC-095") ? "W9 view item" : "W9 toggle"}, not run here`;
    default:
      return `${p}: unclassified, not run`;
  }
}

/** Write one redacted evidence file into the run folder (never twice); its path and sha256. */
function writeArtifact(
  ctx: WalkerStepContext,
  name: string,
  body: unknown,
): { path: string; sha256: string } {
  const path = join(ctx.opts.runDir, name);
  const text = toPlaceholders(JSON.stringify(body, null, 2) + "\n", ctx.opts.ph);
  writeFileSync(path, text, { encoding: "utf-8", flag: "wx" });
  return { path, sha256: createHash("sha256").update(text, "utf-8").digest("hex") };
}

/** The read-only ledger step: every allow-list entry and what L09 does with it in this module. */
function ledgerStep(module: string, items: L09Item[]): WalkerStep {
  const mine = items.filter((i) => i.module === module || i.module === null);
  return {
    id: "p4-l09-ledger",
    title: `allow-list ledger for ${module}: ${mine.map(describeItem).join("; ") || "nothing"}`,
    risk: "read-only",
    timeout_ms: 10_000,
    expected: "the ledger file written; nothing sent",
    kill_criterion: "any new window: STOP",
    side_effects: [],
    rollback: "none",
    plan: () => [],
    run: async (ctx) => {
      const a = writeArtifact(ctx, "p4-l09-ledger.items.json", {
        module,
        items: items.map((i) => ({ ...i, runHere: i.kind === "toggle" && i.module === module })),
      });
      const notRun = mine.filter((i) => i.kind !== "toggle");
      return {
        status: "observed",
        summary: `${mine.filter((i) => i.kind === "toggle").length} toggle(s) to run; not run: ${
          notRun.map(describeItem).join("; ") || "none"
        }`,
        artifacts: [a],
      };
    },
  };
}

/** One toggle with its dock oracle (P3-3 g2-05's form). */
function toggleStep(
  item: Extract<L09Item, { kind: "toggle" }>,
  kernel: (ctx: WalkerStepContext) => L09Kernel,
): WalkerStep {
  const id = stepId(item);
  const label = item.path.join(" > ");
  return {
    id,
    title: `wb_module action ${item.module} ${label} with the "${item.dock}" dock count before and after; toggled back only when the count moved`,
    risk: "reversible",
    timeout_ms: 2 * 30_000 + 3 * 30_000,
    expected: `pass: count c, then not c, then c; or ENGINE_FALSE recorded once (a label the handler does not match is data)`,
    kill_criterion:
      "oracle unreadable before the first send: nothing sent; a new window: STOP; a dialog-like window: HANDOFF; any timeout: no retry",
    side_effects: [`the ${item.dock} dock toggles at most twice`],
    rollback: "the second send, only when the first moved the count",
    plan: () => [
      findPlan(item),
      ...sendPlan(item),
      findPlan(item),
      ...sendPlan(item),
      findPlan(item),
    ],
    run: async (ctx): Promise<WalkerStepOutcome> => {
      const k = kernel(ctx);
      const w = MODULE_WINDOW[item.module];
      const win = (await ctx.call("windows", () => k.windows())).find(
        (x) => x.pid === ctx.pid && x.className === w.className && w.title.test(x.title),
      );
      const args: ModuleArgs = {
        action: "action",
        module: item.module as ModuleArgs["module"],
        menuPath: [...item.path],
        keepFocus: true,
      };
      const count = async (): Promise<number | null> => {
        if (!win) return null;
        const r = await ctx.call("wb_gui find", () =>
          k.gui({
            action: "find",
            pid: ctx.pid,
            className: win.className,
            windowTitle: `^${escapeRe(win.title)}$`,
            name: item.dock,
          }),
        );
        const total = Number(field(r.readback, "total"));
        return r.ok && Number.isInteger(total) ? total : null;
      };
      const send = (): Promise<ToolAnswer> => ctx.call("wb_module action", () => k.module(args));
      const brief = (r: ToolAnswer) => ({
        ok: r.ok,
        code: r.code ?? null,
        readback: r.readback ?? null,
      });

      const before = await count();
      if (before === null) {
        const a = writeArtifact(ctx, `${id}.oracle.json`, { path: item.path, before, sent: 0 });
        return {
          status: "fail",
          summary: `${label}: the "${item.dock}" oracle is unreadable${win ? "" : " (module window not found)"}; nothing sent`,
          artifacts: [a],
        };
      }
      const first = await send();
      const mid = await count();
      let second: ToolAnswer | null = null;
      let after: number | null = mid;
      if (first.ok && mid !== null && mid !== before) {
        second = await send();
        after = await count();
      }
      const evidence = {
        path: item.path,
        module: item.module,
        dock: item.dock,
        first: brief(first),
        second: second ? brief(second) : null,
        counts: { before, afterFirst: mid, after },
        sent: second ? 2 : 1,
      };
      const art = writeArtifact(ctx, `${id}.oracle.json`, evidence);
      let out: WalkerStepOutcome;
      if (!first.ok) {
        out =
          first.code === "ENGINE_FALSE" && mid === before
            ? {
                status: "observed",
                summary: `${label}: ENGINE_FALSE, count ${before} unchanged; sent once`,
              }
            : {
                status: "fail",
                summary: `${label}: ${first.code ?? "error"} with count ${before} to ${mid}; sent once`,
              };
      } else if (mid === null) {
        out = {
          status: "observed",
          summary: `${label}: ok but the oracle went unreadable after the send; not sent again (owner: check the ${item.dock} dock)`,
        };
      } else if (mid === before) {
        out = {
          status: "observed",
          summary: `${label}: ok but count ${before} unchanged; not sent again`,
        };
      } else if (second?.ok && after === before) {
        out = { status: "pass", summary: `${label}: count ${before} to ${mid} to ${after}` };
      } else {
        out = {
          status: "fail",
          summary: `${label}: not restored (count ${before} to ${mid} to ${after}; second ${second?.ok ? "ok" : (second?.code ?? "error")}); owner: check the ${item.dock} dock`,
        };
      }
      if (first.ok) {
        const read = resolveMenuPath(item.path, readMenuDocs(ctx.opts.runDir, item.module));
        if (read) ctx.emit([lineFor(item, ctx, art.sha256, out.status === "pass", read)]);
        else out = { ...out, summary: `${out.summary}; ${UNREAD_NOTE}` };
      }
      return { ...out, artifacts: [art] };
    },
  };
}

/** The L02 menus documents (`p4-l02-<module>-*-menus.json`) of a run folder; unreadable ones skipped. */
export function readMenuDocs(runDir: string, module: string): L02MenusDoc[] {
  const prefix = `p4-l02-${module.toLowerCase()}-`;
  let names: string[];
  try {
    names = readdirSync(runDir);
  } catch {
    return [];
  }
  const out: L02MenusDoc[] = [];
  for (const n of names.filter((f) => f.startsWith(prefix) && f.endsWith("-menus.json")).sort())
    try {
      out.push(JSON.parse(readFileSync(join(runDir, n), "utf-8")) as L02MenusDoc);
    } catch {
      /* not a menus document */
    }
  return out;
}

export const UNREAD_NOTE =
  "no row: the path as sent matches no label L02 read in this run folder, so its id and parent are unknown";

/**
 * The menu path as L02 read it (the labels with their case, the shortcut tail dropped) for a path
 * as sent through ExecuteAction, matched segment by segment without `&` and case (the engine's own
 * match). Null when no L02 document of the run folder holds it: L09 then claims no row, since an
 * id from the sent spelling would not be L02's id and its parent menu would have no row.
 */
export function resolveMenuPath(
  sent: readonly string[],
  docs: readonly L02MenusDoc[],
): string[] | null {
  const want = sent.map(segKey);
  for (const d of docs)
    for (const e of d.menus ?? []) {
      if (e.skipped || segKey(e.title) !== want[0]) continue;
      const out = [e.title];
      let items: readonly L02MenuItem[] | undefined = e.items;
      for (let i = 1; i < want.length && items; i++) {
        const hit: L02MenuItem | undefined = items.find(
          (it) =>
            it.controlType === "MenuItem" && segKey(splitName(it.name ?? "").label) === want[i],
        );
        if (!hit) break;
        out.push(splitName(hit.name ?? "").label);
        items = i === want.length - 1 ? undefined : hit.children;
      }
      if (out.length === want.length) return out;
    }
  return null;
}

/**
 * The row of a path the engine accepted (kind `menu-item`). The key, label and parent are the path
 * as L02 read it (`read`, from resolveMenuPath), so the id is L02's id for the same item.
 */
export function lineFor(
  item: Extract<L09Item, { kind: "toggle" }>,
  ctx: Pick<WalkerStepContext, "opts">,
  sha256: string,
  proven: boolean,
  read: readonly string[],
): LiveObservation {
  const leaf = read[read.length - 1];
  return {
    dim: "ui",
    kind: "menu-item",
    module: item.module,
    key: { path: [...read] },
    parent_key: {
      dim: "ui",
      kind: "menu",
      module: item.module,
      key: { path: read.slice(0, -1) },
    },
    origin: "vanilla",
    label: normalizeLabel(leaf),
    label_raw: leaf,
    locator: { menuPath: [...read] },
    // Mirrors L02 (L02-menus.ts projects menu-item rows with the `menu` kind) so both enumerators
    // write the same state key for the same id.
    observed_state: stateFor(item.module, "menu", ctx.opts.state),
    risk_hint: "safe",
    modal: "none",
    ref: `artifact:${sha256}#a/${item.path.join("/")}`,
    confidence: proven ? "high" : "medium",
    unverified: proven
      ? [`sent through ExecuteAction as ${item.path.join(" > ")}; label as L02 read it`]
      : [
          `sent through ExecuteAction as ${item.path.join(" > ")}; label as L02 read it`,
          "the engine answered ok but the dock oracle did not show the toggle",
        ],
  };
}

/** The walker definition; `kernel` is the live one unless a test passes a fake. */
export function l09Def(
  kernel: (ctx: WalkerStepContext) => L09Kernel = ctxKernel,
  policy: () => CensusPolicy = loadPolicy,
): WalkerDef {
  return {
    enumerator: "L09",
    script: SCRIPT,
    session: "P4-1",
    defaultModule: "WorldEditor",
    steps: ({ module }) => {
      const items = classifyAllowList(policy());
      const toggles = items.filter(
        (i): i is Extract<L09Item, { kind: "toggle" }> =>
          i.kind === "toggle" && i.module === module,
      );
      return [ledgerStep(module, items), ...toggles.map((t) => toggleStep(t, kernel))];
    },
  };
}

if (isMainModule(import.meta.url))
  runWalker(l09Def(), process.argv.slice(2)).then((c) => process.exit(c));
