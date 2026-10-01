/**
 * Evidence writer (plan 4.2 `evidence/EV-<session>-<seq>.json`, 5.2 "The
 * harness rewrites absolute paths to placeholders before writing evidence").
 *
 * A record says what ran, on which build, the result summary, and the sha256
 * of every artifact it cites:
 *
 *   { id, kind, ran, build, result_summary, artifacts: [{ path, sha256 }], written_at }
 *
 * Every string in the record (keys included) goes through `toPlaceholders`
 * before it is written. Artifact hashes are computed from the real file
 * before its path is rewritten. The sequence number is one more than the
 * highest existing `EV-<session>-<seq>.json` in the evidence directory, and
 * the file is created exclusively, so an existing record is never overwritten.
 *
 * Usage:
 *   npx tsx scripts/live/evidence.ts --session <id> --ran <text> --build <build>
 *       --summary <text> [--artifact <path>] [--dir <evidence dir>]
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMainModule, parseArgs } from "./cli.js";
import {
  REPO_ROOT,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { sha256File } from "./snapshot.js";

/** Default evidence directory (plan 4.2). */
export const DEFAULT_EVIDENCE_DIR = join(REPO_ROOT, "data", "census", "evidence");

export interface EvidenceArtifact {
  path: string;
  sha256: string;
}

export interface EvidenceRecord {
  id: string;
  /** Record kind: "live-session" (default) or "owner-signoff" (plan 5.1, 6.1). */
  kind: string;
  ran: string;
  build: string;
  result_summary: string;
  artifacts: EvidenceArtifact[];
  written_at: string;
}

export interface EvidenceInput {
  /** Defaults to "live-session"; the census dispose --signoff-batch needs "owner-signoff". */
  kind?: string;
  ran: string;
  build: string;
  result_summary: string;
  /** Artifact files: a path (hashed now) or a path with a known hash. */
  artifacts?: Array<string | EvidenceArtifact>;
}

/** Validate a session id for use in an evidence file name. */
export function validateSessionId(session: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.]*(?:-[A-Za-z0-9_.]+)*$/.test(session) || session.length > 64) {
    throw new Error(`Invalid evidence session id "${session}"`);
  }
  return session;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Next sequence number for `session` in `dir` (1 when none exist yet). */
export function nextSequence(dir: string, session: string): number {
  validateSessionId(session);
  if (!existsSync(dir)) return 1;
  const re = new RegExp(`^EV-${escapeRegExp(session)}-(\\d+)\\.json$`);
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = re.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Evidence id for a session and sequence: `EV-<session>-<seq>` with at least 3 digits. */
export function evidenceId(session: string, seq: number): string {
  return `EV-${session}-${String(seq).padStart(3, "0")}`;
}

/** Apply placeholder rewriting to every string in a JSON-shaped value, keys included. */
export function rewriteStrings<T>(value: T, ctx: PlaceholderContext): T {
  if (typeof value === "string") return toPlaceholders(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => rewriteStrings(v, ctx)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[toPlaceholders(k, ctx)] = rewriteStrings(v, ctx);
    }
    return out as T;
  }
  return value;
}

/**
 * Write the next evidence record for `session` into `dir`. Returns the file
 * path and the record as written (after placeholder rewriting).
 */
export function writeEvidence(
  dir: string,
  session: string,
  input: EvidenceInput,
  ctx: PlaceholderContext = defaultPlaceholderContext(),
  now: Date = new Date(),
): { path: string; record: EvidenceRecord } {
  validateSessionId(session);
  const artifacts: EvidenceArtifact[] = (input.artifacts ?? []).map((a) =>
    typeof a === "string" ? { path: a, sha256: sha256File(a) } : a,
  );
  mkdirSync(dir, { recursive: true });
  // Two attempts: a concurrent writer may take the same sequence number.
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = evidenceId(session, nextSequence(dir, session));
    const record = rewriteStrings<EvidenceRecord>(
      {
        id,
        ran: input.ran,
        build: input.build,
        result_summary: input.result_summary,
        artifacts,
        kind: input.kind ?? "live-session",
        written_at: now.toISOString(),
      },
      ctx,
    );
    const path = join(dir, `${id}.json`);
    try {
      writeFileSync(path, JSON.stringify(record, null, 2) + "\n", {
        encoding: "utf-8",
        flag: "wx",
      });
      return { path, record };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error(`Could not allocate an evidence sequence number for ${session} in ${dir}`);
}

export function main(argv: string[]): number {
  try {
    const args = parseArgs(argv, ["session", "ran", "build", "summary", "artifact", "dir"]);
    const { session, ran, build, summary } = args.options;
    if (!session || !ran || !build || !summary) {
      console.error(
        "Usage: evidence.ts --session <id> --ran <text> --build <build> --summary <text> " +
          "[--artifact <path>] [--dir <dir>]",
      );
      return 2;
    }
    const { path, record } = writeEvidence(args.options.dir ?? DEFAULT_EVIDENCE_DIR, session, {
      ran,
      build,
      result_summary: summary,
      artifacts: args.options.artifact ? [args.options.artifact] : [],
    });
    console.log(`${record.id} -> ${toPlaceholders(path, defaultPlaceholderContext())}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
