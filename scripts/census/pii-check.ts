/**
 * G10 (plan 4.6): the PII gate of `scripts/pii-gate.ts` run in-process over
 * every file under the census root, plus the census's own machine-path
 * check. The result names the pattern mode so a generic-only pass is never
 * read as a full pass:
 *
 *   PASS (owner patterns)                   owner pattern file present
 *   PASS (generic patterns only; CI set)    CI set, no owner file; FAIL at --phase release
 *   SOFT (generic patterns only; no owner pattern file)   FAIL at --phase release
 *
 * Any finding is FAIL in every mode.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { GateResult, Phase } from "../../src/census/gates.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import type { CensusPaths } from "../../src/census/ledger-io.js";
import {
  DEFAULT_ALLOW_PATH,
  GENERIC_PATTERNS,
  formatFinding,
  loadAllowList,
  loadPatterns,
  scanTargets,
  type PiiPattern,
  type ScanTarget,
} from "../pii-gate.js";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Builds the G10 runner for a census root. */
export function g10Runner(
  paths: CensusPaths,
  env: NodeJS.ProcessEnv = process.env,
): (phase: Phase) => GateResult {
  return (phase) => {
    let patterns: PiiPattern[];
    let mode: "owner" | "ci" | "none";
    try {
      const loaded = loadPatterns({ env });
      patterns = loaded.patterns;
      mode = loaded.ownerCount > 0 ? "owner" : "ci";
    } catch {
      patterns = [...GENERIC_PATTERNS];
      mode = "none";
    }
    const files = walk(paths.root);
    const targets: ScanTarget[] = files.map((f) => ({
      path: relative(paths.repo, f).split("\\").join("/"),
      read: () => readFileSync(f),
    }));
    const reports = scanTargets(targets, patterns, loadAllowList(DEFAULT_ALLOW_PATH));
    const offenders = reports.flatMap((r) =>
      r.findings.map((f) => ({ message: formatFinding(r.path, f) })),
    );
    for (const f of files) {
      const lines = readFileSync(f, "utf-8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (containsMachinePath(line)) {
          offenders.push({
            message: `${relative(paths.repo, f).split("\\").join("/")}:${i + 1}: machine path`,
          });
        }
      });
    }
    const scanned = `${files.length} census file${files.length !== 1 ? "s" : ""}`;
    if (offenders.length > 0) {
      return {
        gate: "G10",
        status: "FAIL",
        summary: `${offenders.length} finding(s) in ${scanned}`,
        offenders,
      };
    }
    if (mode === "owner")
      return {
        gate: "G10",
        status: "PASS",
        summary: `${scanned} clean (owner patterns)`,
        offenders,
      };
    const release = phase === "release";
    if (mode === "ci") {
      return {
        gate: "G10",
        status: release ? "FAIL" : "PASS",
        summary: `${scanned} clean (generic patterns only; CI set)`,
        offenders,
      };
    }
    return {
      gate: "G10",
      status: release ? "FAIL" : "SOFT",
      summary: `${scanned} clean (generic patterns only; no owner pattern file)`,
      offenders,
    };
  };
}
