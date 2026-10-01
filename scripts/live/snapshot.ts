/**
 * Sandbox hash-manifest snapshots (plan 5.1 "The sandbox", 5.3 pre-flight
 * step 6 and post-flight step 1).
 *
 * A snapshot covers only the paths a battery declared it would touch: each
 * declared path (relative to the root) is a file or a directory walked
 * recursively. The manifest maps every file found to its sha256. Symbolic
 * links are recorded by their link text, never followed.
 *
 * `diff(before, after, expectedNoise)` returns what was added, removed and
 * changed, minus the expected-noise list (Workbench rewrites some files on
 * open; the list is built in the first live session). Noise entries are
 * relative paths or globs (`*` within one segment, `**` across segments).
 *
 * Nothing here restores anything: the plan forbids `git clean` and
 * `git checkout -- .` in a sandbox, and a restore is a separate, explicit step.
 *
 * Usage:
 *   npx tsx scripts/live/snapshot.ts take --root <dir> --paths <a,b,...> [--out <manifest.json>]
 *   npx tsx scripts/live/snapshot.ts diff --before <a.json> --after <b.json> [--noise <list.json>]
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { isMainModule, parseArgs } from "./cli.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Manifest {
  /** Root the paths are relative to. */
  root: string;
  /** The declared path list the snapshot covers, as given. */
  declared: string[];
  /** ISO time the snapshot was taken. */
  taken_at: string;
  /** Relative path (forward slashes) → sha256 hex. */
  files: Record<string, string>;
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
  /** Differences dropped because they matched the expected-noise list. */
  noise: string[];
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/** sha256 hex of a file's bytes. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

function checkDeclared(p: string): string {
  if (isAbsolute(p)) throw new Error(`Declared path must be relative to the root: ${p}`);
  const n = normalize(p);
  if (n === ".." || n.startsWith(`..${sep}`)) {
    throw new Error(`Declared path escapes the root: ${p}`);
  }
  return n;
}

function walk(root: string, abs: string, out: Record<string, string>): void {
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return; // absent: nothing to record
  }
  if (st.isSymbolicLink()) {
    out[toRel(root, abs)] = createHash("sha256")
      .update(`symlink:${readlinkSync(abs)}`)
      .digest("hex");
    return;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(abs).sort()) walk(root, join(abs, name), out);
    return;
  }
  if (st.isFile()) out[toRel(root, abs)] = sha256File(abs);
}

/** Hash every file under the declared paths of `root`. Absent paths are simply empty. */
export function takeSnapshot(root: string, declared: string[], now: Date = new Date()): Manifest {
  const absRoot = resolve(root);
  const files: Record<string, string> = {};
  for (const p of declared) walk(absRoot, join(absRoot, checkDeclared(p)), files);
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(files).sort()) sorted[k] = files[k];
  return { root: absRoot, declared: [...declared], taken_at: now.toISOString(), files: sorted };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/** Compile a noise entry (relative path or glob) to an anchored regular expression. */
export function noisePattern(entry: string): RegExp {
  const norm = entry.replace(/\\/g, "/").replace(/^\.\//, "");
  let re = "";
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === "*" && norm[i + 1] === "*") {
      i++;
      if (norm[i + 1] === "/") {
        re += "(?:.*/)?"; // "**/" matches zero or more whole segments
        i++;
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // A plain directory entry ("Backup/") covers everything below it.
  if (norm.endsWith("/")) re += ".*";
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

/** Added, removed and changed files between two manifests, minus expected noise. */
export function diff(
  before: Manifest,
  after: Manifest,
  expectedNoise: string[] = [],
): SnapshotDiff {
  const patterns = expectedNoise.map(noisePattern);
  const isNoise = (p: string): boolean => patterns.some((re) => re.test(p));
  const out: SnapshotDiff = { added: [], removed: [], changed: [], noise: [] };
  const keys = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  for (const k of [...keys].sort()) {
    const a = before.files[k];
    const b = after.files[k];
    let bucket: "added" | "removed" | "changed" | null = null;
    if (a === undefined) bucket = "added";
    else if (b === undefined) bucket = "removed";
    else if (a !== b) bucket = "changed";
    if (!bucket) continue;
    if (isNoise(k)) out.noise.push(k);
    else out[bucket].push(k);
  }
  return out;
}

/** True when the diff has no difference outside the expected noise. */
export function isNetZero(d: SnapshotDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

/** One-paragraph human summary of a diff. */
export function formatDiff(d: SnapshotDiff): string {
  const lines: string[] = [];
  lines.push(isNetZero(d) ? "net-zero: yes" : "net-zero: NO");
  for (const [label, list] of [
    ["added", d.added],
    ["removed", d.removed],
    ["changed", d.changed],
    ["expected noise", d.noise],
  ] as const) {
    lines.push(`${label}: ${list.length}`);
    for (const p of list) lines.push(`  ${p}`);
  }
  return lines.join("\n");
}

/** Read a manifest written by `take`. */
export function readManifest(path: string): Manifest {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  if (!raw || typeof raw.files !== "object" || raw.files === null) {
    throw new Error(`${path} is not a snapshot manifest`);
  }
  return raw;
}

/** Read a noise list: a JSON array of strings, or an object with an `expected_noise` array. */
export function readNoiseList(path: string): string[] {
  if (!existsSync(path)) throw new Error(`Noise list not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { expected_noise?: unknown }).expected_noise;
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) {
    throw new Error(`${path}: expected a JSON array of strings or { "expected_noise": [...] }`);
  }
  return list;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  try {
    const args = parseArgs(argv, ["root", "paths", "out", "before", "after", "noise"]);
    const cmd = args.positional[0];
    if (cmd === "take") {
      const root = args.options.root;
      const paths = args.options.paths;
      if (!root || !paths) {
        console.error("snapshot take needs --root <dir> and --paths <a,b,...>");
        return 2;
      }
      const m = takeSnapshot(
        root,
        paths
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      );
      const json = JSON.stringify(m, null, 2) + "\n";
      if (args.options.out) {
        writeFileSync(args.options.out, json, { encoding: "utf-8", flag: "wx" });
        console.log(`snapshot: ${Object.keys(m.files).length} files -> ${args.options.out}`);
      } else {
        process.stdout.write(json);
      }
      return 0;
    }
    if (cmd === "diff") {
      if (!args.options.before || !args.options.after) {
        console.error("snapshot diff needs --before <a.json> and --after <b.json>");
        return 2;
      }
      const noise = args.options.noise ? readNoiseList(args.options.noise) : [];
      const d = diff(readManifest(args.options.before), readManifest(args.options.after), noise);
      console.log(formatDiff(d));
      return isNetZero(d) ? 0 : 1;
    }
    console.error("Usage: snapshot.ts take --root <dir> --paths <a,b> | diff --before --after");
    return 2;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
