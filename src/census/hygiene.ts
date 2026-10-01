/**
 * Text hygiene shared by every census writer and reader: machine-path
 * detection (defence in depth before the PII gate, plan 5.2), safe
 * resolution of repo references, and build-tag ordering.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const MACHINE_PATH_PATTERNS: readonly RegExp[] = [
  // Drive-letter paths: C:\..., C:/...
  /(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/,
  // POSIX home and root directories.
  /(^|[^A-Za-z0-9_.<>%-])\/(home|Users|root)\/[^/\s]/,
  // Windows profile directories written with backslashes.
  /\\Users\\[^\\\s]/i,
];

/** True when a string looks like an absolute machine path (placeholders such as `<repo>/` pass). */
export function containsMachinePath(s: string): boolean {
  return MACHINE_PATH_PATTERNS.some((re) => re.test(s));
}

/** Every string inside a JSON-shaped value, keys included. */
export function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allStrings(v, out);
    }
  }
  return out;
}

// ── Repo references ───────────────────────────────────────────────────────────

/** `<repo>/<path>#L<n>`: a reference into a tracked repository file. */
export const REPO_REF_PATTERN = /^<repo>\/([^#]+)#L(\d+)$/;

export type RefCheck = "resolves" | "unverified" | "mismatch" | "escapes";

/**
 * Checks a source reference. Repo references are resolved under `repoRoot`
 * only (a `..` segment is refused): when the file is present, the quote must
 * be a substring of the cited line. Any other reference form, or a repo file
 * that is not present on this machine, is `unverified`.
 */
export function checkRef(
  repoRoot: string,
  ref: string,
  quote: string | undefined,
  readCache: Map<string, string[] | null>,
): RefCheck {
  const m = REPO_REF_PATTERN.exec(ref);
  if (!m) return "unverified";
  const rel = m[1];
  if (rel.split("/").some((s) => s === ".." || s === "") || rel.includes("\\")) return "escapes";
  const file = normalize(join(repoRoot, rel));
  if (!file.startsWith(normalize(repoRoot) + sep)) return "escapes";
  let lines = readCache.get(file);
  if (lines === undefined) {
    lines = existsSync(file) ? readFileSync(file, "utf-8").split(/\r?\n/) : null;
    readCache.set(file, lines);
  }
  if (lines === null) return "unverified";
  if (quote === undefined) return "mismatch";
  const line = lines[Number(m[2]) - 1];
  return line !== undefined && line.includes(quote) ? "resolves" : "mismatch";
}

/** Whether a repo-relative file exists under `repoRoot` and contains `census:<id>`. */
export function fileNamesRow(
  repoRoot: string,
  rel: string,
  id: string,
  readCache: Map<string, string | null>,
): boolean {
  if (rel.split(/[\\/]/).some((s) => s === "..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
    return false;
  }
  const file = normalize(join(repoRoot, rel));
  let text = readCache.get(file);
  if (text === undefined) {
    text = existsSync(file) ? readFileSync(file, "utf-8") : null;
    readCache.set(file, text);
  }
  return text !== null && text.includes(`census:${id}`);
}

// ── Build tags ────────────────────────────────────────────────────────────────

/**
 * Orders build tags: `unknown` first, then dotted numeric comparison
 * (`1.8.0.13` < `1.10.0.1`); non-numeric parts compare by code unit.
 */
export function compareBuilds(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "unknown") return -1;
  if (b === "unknown") return 1;
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
