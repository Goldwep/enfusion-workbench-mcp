/**
 * Small shared helpers for the live-harness scripts (plan 5.3, Phase 0 item 11):
 * argument parsing, the "run as a script" guard, and the single live gate every
 * operation that would touch Workbench, the registry, the desktop or a process
 * must pass.
 *
 * The live gate is deliberately one function so the rule cannot drift between
 * scripts: a real operation needs `--really`, a win32 host, and a Workbench
 * lease held by this harness lane. Anything else is a dry run.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── Arguments ────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  /** Positional arguments in order (sub-commands first). */
  positional: string[];
  /** `--name value` pairs. A flag given twice keeps the last value. */
  options: Record<string, string>;
  /** Bare `--name` switches. */
  flags: Set<string>;
}

/**
 * Parse `argv`. `valued` lists the options that take a value; every other
 * `--name` is a switch. An option given without a value is an error, so a
 * missing path never silently turns into a switch.
 */
export function parseArgs(argv: string[], valued: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], options: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out.positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (valued.includes(name)) {
      const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith("--"))) {
        throw new Error(`Option --${name} needs a value`);
      }
      out.options[name] = value;
    } else {
      if (eq !== -1) throw new Error(`Switch --${name} does not take a value`);
      out.flags.add(name);
    }
  }
  return out;
}

/** True when the module whose `import.meta.url` is given is the process entry point. */
export function isMainModule(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return importMetaUrl === pathToFileURL(resolve(entry)).href;
}

// ── Live gate ────────────────────────────────────────────────────────────────

export interface LiveGateInput {
  /** The caller passed `--really`. */
  really: boolean;
  /** Host platform (injectable for tests). */
  platform: NodeJS.Platform;
  /** True when this lane currently holds the Workbench lease. */
  leaseHeld: boolean;
}

/**
 * Decide whether a real live operation may run. Returns null when it may,
 * otherwise the reason it is a dry run (or refused). The order of the checks
 * is the order the reasons are most useful to read.
 */
export function liveGateReason(input: LiveGateInput): string | null {
  if (!input.really) return "dry run (pass --really to perform the real operation)";
  if (input.platform !== "win32") {
    return `skipped: real operation is Windows-only (platform ${input.platform})`;
  }
  if (!input.leaseHeld) {
    return "refused: this lane does not hold the Workbench lease (run lane.ts start first)";
  }
  return null;
}
