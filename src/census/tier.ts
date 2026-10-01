/**
 * Tier computation (plan 1.4): the highest rung whose mechanical test a row
 * passes, every lower rung included. Pure: every file-system fact arrives
 * through `TierContext`, so `build.ts` and `validate.ts` share one rule.
 *
 *  T0  at least one source.
 *  T1  what, module and parent (null for a declared root) filled in; one
 *      source whose ref resolves; a risk class; at least one path, and every
 *      `none-known` path carries a reason.
 *  T2  a source from an enumerator that observes the installed build, on the
 *      current build, and children enumerated (`true` or `n/a`).
 *  T3  an MCP link that resolves to an `mcp-action` row, and a `contract`
 *      test whose file names `census:<id>`.
 *  T4  T3 plus a `drive` link, a confirmed risk, a `chosen_path` whose path
 *      status is `verified`, a `negative-safety` test when risk is not
 *      `safe`, and a locator captured on the current build when the chosen
 *      path is `gui-automation`.
 *  T5  T4 plus a passing live result on the current build that names the
 *      row, from a `live` test listed on the row, whose oracle is not the
 *      weak one. A row whose only passes are weak stays T4 with `weak_only`.
 */
import type { LiveResult, Row } from "./schemas.js";
import { TIERS, type Tier } from "./vocab.js";

export interface TierContext {
  /** Current build tag (`current-build.json` or `--build`). */
  build: string;
  /** Enumerators declared `observes_build: true` in universes.json. */
  buildObservers: ReadonlySet<string>;
  /** Index into `row.sources` -> whether that source's ref resolves. */
  sourceResolves: (index: number) => boolean;
  /** Whether `file` (repo-relative) exists and contains `census:<id>`. */
  testNamesRow: (file: string, id: string) => boolean;
  /** Whether an `mcp:action/...` id is a row of kind `mcp-action`. */
  mcpActionExists: (actionId: string) => boolean;
  /** Live results of the current build. */
  liveResults: readonly LiveResult[];
  /** `policy.json` `weak_oracle`. */
  weakOracle: string;
}

export type TierInput = Pick<
  Row,
  | "id"
  | "module"
  | "parent"
  | "what"
  | "risk"
  | "risk_confirmed"
  | "sources"
  | "paths"
  | "children_enumerated"
  | "mcp"
  | "tests"
  | "chosen_path"
  | "locator"
>;

export interface TierResult {
  tier: Tier;
  tier_evidence: { tier: Tier; ref: string }[];
  weak_only: boolean;
}

/** Computes a row's tier, the evidence for each rung reached, and the weak-only flag. */
export function computeTier(row: TierInput, ctx: TierContext): TierResult {
  const evidence: { tier: Tier; ref: string }[] = [];
  const done = (i: number, weak = false): TierResult => ({
    tier: TIERS[i],
    tier_evidence: evidence,
    weak_only: weak,
  });

  // T0
  if (row.sources.length === 0) return { tier: "T0", tier_evidence: [], weak_only: false };
  evidence.push({ tier: "T0", ref: `${row.sources[0].enumerator}@${row.sources[0].build}` });

  // T1
  const resolving = row.sources.findIndex((_s, i) => ctx.sourceResolves(i));
  const pathsOk =
    row.paths.length > 0 &&
    row.paths.every((p) => p.path !== "none-known" || p.reason !== undefined);
  if (
    row.what === undefined ||
    row.parent === undefined ||
    resolving === -1 ||
    row.risk === undefined ||
    !pathsOk
  ) {
    return done(0);
  }
  evidence.push({ tier: "T1", ref: row.sources[resolving].ref });

  // T2
  const observed = row.sources.find(
    (s) => ctx.buildObservers.has(s.enumerator) && s.build === ctx.build,
  );
  if (!observed || row.children_enumerated === false) return done(1);
  evidence.push({ tier: "T2", ref: `${observed.enumerator}@${observed.build}` });

  // T3
  const links = row.mcp.filter((m) => ctx.mcpActionExists(m.action));
  const contract = row.tests.find((t) => t.kind === "contract" && ctx.testNamesRow(t.file, row.id));
  if (links.length === 0 || !contract) return done(2);
  evidence.push({ tier: "T3", ref: `${links[0].action} ${contract.id}` });

  // T4
  const drive = links.find((m) => m.role === "drive");
  const chosen = row.paths.find((p) => p.path === row.chosen_path && p.status === "verified");
  const negativeOk =
    row.risk === "safe" ||
    row.tests.some((t) => t.kind === "negative-safety" && ctx.testNamesRow(t.file, row.id));
  const locatorOk =
    row.chosen_path !== "gui-automation" ||
    (row.locator !== undefined && row.locator.build === ctx.build);
  if (!drive || !row.risk_confirmed || !chosen || !negativeOk || !locatorOk) return done(3);
  evidence.push({
    tier: "T4",
    ref: `${drive.action} ${chosen.path}${chosen.evidence ? " " + chosen.evidence : ""}`,
  });

  // T5
  const liveTests = new Set(
    row.tests.filter((t) => t.kind === "live" && ctx.testNamesRow(t.file, row.id)).map((t) => t.id),
  );
  const passes = ctx.liveResults.filter(
    (r) => r.verdict === "pass" && r.rows.includes(row.id) && liveTests.has(r.test),
  );
  const strong = passes.find((r) => r.oracle !== ctx.weakOracle);
  if (!strong) return done(4, passes.length > 0);
  evidence.push({ tier: "T5", ref: `${strong.test} ${strong.oracle}@${ctx.build}` });
  return done(5);
}
