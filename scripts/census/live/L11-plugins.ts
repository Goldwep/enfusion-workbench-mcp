/**
 * L11: the plugin presence matrix (design section 4, plan 4.5). For each plugin that policy
 * `plugin_read_allow_list` allows, in each module its attribute declares (E03 `wbModules`), one
 * focus-taking step: `wb_plugin describe`, then `getSettings` (read-only; GetPlugin may bring the
 * module window to the front, DEC-042 U10). Emits `plugin` rows: module, class, and the settings
 * container class (`instanceClass`, as `class_name`).
 *
 * Never `run`, never `setSettings`, never RunCommandline or Configure; nothing is typed, no key,
 * no invoke. The modules must already be open (the handler answers MODULE_NOT_OPEN and never opens
 * one): L10 opens them. A pair whose module the attribute does not declare is dropped from the plan.
 *
 *   npx --no tsx scripts/census/live/L11-plugins.ts [--out <plan.json>] [--outline <file>]
 *   npx --no tsx scripts/census/live/L11-plugins.ts --really --id <lane> --sandbox <dir> --run-dir <dir>
 *       --module <ModuleId> (--only <step> | --from <step>)
 * `--module` only names the record; each step writes its own module's obs file.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { WorkbenchClient } from "../../../src/workbench/client.js";
import {
  allowListOf,
  loadAllowList,
  runPlugin,
  type AllowEntry,
} from "../../../src/tools/wb-plugin.js";
import { REPO_ROOT, toPlaceholders } from "../../live/paths.js";
import type { PlanAction } from "../../live/dry-run.js";
import {
  StopBattery,
  isMainModule,
  obsFilePath,
  runWalker,
  type LiveObservation,
  type WalkerDef,
  type WalkerStep,
} from "./common.js";

export const ENUMERATOR = "L11";
export const HANDLER = "EMCP_WB_Plugin";
export const PORT = 5775;
/** getSettings pages read per plugin, at most (limit 100 per page). */
export const MAX_PAGES = 3;
/** Refusal codes after which nothing more is sent. */
const HARD_CODES = new Set(["MODAL_OPEN", "LOST", "UNREACHABLE"]);

export interface E03Row {
  kind: string;
  module?: string;
  class_name?: string;
  key?: { class?: string };
  signature?: string;
}

/** The modules a plugin attribute declares: `wbModules: { "A", "B" }`, else the row's module. */
export function declaredModules(row: E03Row): string[] {
  const m = /wbModules:\s*\{([^}]*)\}/.exec(row.signature ?? "");
  const names = m ? [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]) : [];
  return names.length ? names : row.module ? [row.module] : [];
}

export interface Pair {
  module: string;
  className: string;
}

/** Allow-listed (module, class) pairs whose module the E03 attribute declares; the rest dropped. */
export function matrixPairs(
  allow: readonly AllowEntry[],
  e03: readonly E03Row[],
): { pairs: Pair[]; dropped: Array<Pair & { why: string }> } {
  const pairs: Pair[] = [];
  const dropped: Array<Pair & { why: string }> = [];
  for (const a of allow) {
    const row = e03.find(
      (r) => r.kind === "plugin" && (r.key?.class ?? r.class_name) === a.className,
    );
    if (!row) dropped.push({ ...a, why: "no E03 plugin row" });
    else if (!declaredModules(row).includes(a.module))
      dropped.push({ ...a, why: `E03 declares ${declaredModules(row).join(",") || "none"}` });
    else pairs.push({ module: a.module, className: a.className });
  }
  return { pairs, dropped };
}

export function loadE03(): E03Row[] {
  const tag = (
    JSON.parse(readFileSync(join(REPO_ROOT, "data", "census", "current-build.json"), "utf-8")) as {
      tag: string;
    }
  ).tag;
  const text = readFileSync(
    join(REPO_ROOT, "data", "census", "observations", "E03", `${tag}.jsonl`),
    "utf-8",
  );
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.includes('"$header"'))
    .map((l) => JSON.parse(l) as E03Row);
}

export type PluginTool = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** The run's plugin tool on the handler port of the run (`ctx.port`; PORT when none is given). */
function realTool(port: number = PORT): PluginTool {
  const client = new WorkbenchClient("127.0.0.1", port);
  return async (args) =>
    (await runPlugin(args, {
      client,
      catalog: () => [],
      allowList: () => loadAllowList(),
    })) as unknown as Record<string, unknown>;
}

export const stepId = (p: Pair): string => `p4-l11-${p.module}-${p.className}`;

function net(params: Record<string, unknown>): PlanAction {
  return {
    kind: "net-call",
    target: HANDLER,
    params,
    note: "read-only, through wb_plugin; may bring the module window to the front",
  } as PlanAction;
}

function refusal(p: Pair, what: string, r: Record<string, unknown>) {
  const code = String(r.code ?? "UNKNOWN");
  if (HARD_CODES.has(code))
    throw new StopBattery("stopped", `${what} ${p.className}: ${code}: ${String(r.message ?? "")}`);
  return {
    status: "observed" as const,
    summary: `${p.module} ${p.className}: ${what} refused ${code}; no row`,
  };
}

export function buildSteps(
  pairs: readonly Pair[],
  tool: (port?: number) => PluginTool,
): WalkerStep[] {
  return pairs.map((p) => ({
    id: stepId(p),
    title: `${p.module} ${p.className}: describe and getSettings (focus-taking read)`,
    risk: "reversible",
    timeout_ms: 90_000,
    expected: "describe ok with present and instance; getSettings ok (or a recorded refusal)",
    kill_criterion:
      "any new window other than a benign tool window, any dialog, a timeout (no retry)",
    side_effects: [`the ${p.module} window may come to the front`],
    rollback: "none (reads)",
    plan: () => [
      net({ action: "describe", moduleName: p.module, className: p.className }),
      net({ action: "getSettings", moduleName: p.module, className: p.className }),
    ],
    run: async (ctx) => {
      const call = tool(ctx.port);
      const d = await ctx.call("describe", () =>
        call({ action: "describe", moduleName: p.module, className: p.className }),
      );
      if (d.ok !== true) return refusal(p, "describe", d);
      const rb = (d.readback ?? {}) as Record<string, unknown>;
      const pages: unknown[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < MAX_PAGES; n++) {
        const g = await ctx.call("getSettings", () =>
          call({
            action: "getSettings",
            moduleName: p.module,
            className: p.className,
            ...(cursor ? { cursor } : {}),
          }),
        );
        if (g.ok !== true) {
          if (HARD_CODES.has(String(g.code))) return refusal(p, "getSettings", g);
          pages.push({ refusal: { code: g.code, message: g.message } });
          break;
        }
        const grb = (g.readback ?? {}) as Record<string, unknown>;
        pages.push(grb);
        cursor = typeof grb.nextCursor === "string" ? grb.nextCursor : undefined;
        if (!cursor) break;
      }
      const art = join(ctx.opts.runDir, `${stepId(p)}.readback.json`);
      const text = JSON.stringify({ describe: rb, getSettings: pages }, null, 2) + "\n";
      mkdirSync(dirname(art), { recursive: true });
      writeFileSync(art, toPlaceholders(text, ctx.opts.ph), "utf-8");
      const sha = createHash("sha256").update(readFileSync(art)).digest("hex");
      const artifacts = [{ path: art, sha256: sha }];
      if (Number(rb.present) !== 1)
        return {
          status: "observed" as const,
          summary: `${p.className} not present in ${p.module} (present=${String(rb.present)}); no row`,
          artifacts,
        };
      const hasInstance = Number(rb.instance) === 1;
      const container = typeof rb.instanceClass === "string" ? rb.instanceClass : "";
      const unverified = ["GetPlugin may have brought the module window to the front (U10)"];
      if (!hasInstance) unverified.push("class present, GetPlugin returned no instance");
      const line = {
        dim: "plugin",
        kind: "plugin",
        module: p.module,
        key: { class: p.className },
        parent_key: null,
        origin: "vanilla",
        ...(container ? { class_name: container } : {}),
        observed_state: {},
        modal: "none",
        ref: `artifact:${sha}#plugin/${p.module}/${p.className}`,
        confidence: hasInstance && container ? "high" : "medium",
        unverified,
      } as unknown as LiveObservation;
      // The row goes to its own module's obs file; the run's --module only names the record.
      ctx.emit([line], obsFilePath(ctx.opts.runDir, ENUMERATOR, p.module, {}));
      return {
        status: "pass" as const,
        summary: `${p.module} ${p.className}: present, instance=${String(rb.instance)}, container ${container || "?"}, ${pages.length} settings page(s)`,
        artifacts,
      };
    },
  }));
}

function policyAllow(): AllowEntry[] {
  return allowListOf(
    JSON.parse(readFileSync(join(REPO_ROOT, "data", "census", "policy.json"), "utf-8")),
  );
}

export const def: WalkerDef = {
  enumerator: ENUMERATOR,
  script: "scripts/census/live/L11-plugins.ts",
  session: "P4-1",
  defaultModule: "WorldEditor",
  steps: () => buildSteps(matrixPairs(policyAllow(), loadE03()).pairs, realTool),
};

if (isMainModule(import.meta.url))
  runWalker(def, process.argv.slice(2)).then((c) => process.exit(c));
