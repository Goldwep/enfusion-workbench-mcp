/**
 * Surgical byte-edit primitives for L5+ refactor tools (L4-2).
 *
 * Safety doctrine (per DOMAIN-MAP §2):
 *   1. Surgical byte edits ONLY — never parse + serialize (would lose
 *      whitespace/comment fidelity until the serializer round-trips
 *      perfectly).
 *   2. `.bak` sidecar always (`<path>.bak` next to the original).
 *   3. Refuse to edit when the file has uncommitted git changes, unless
 *      the caller passes `force: true`.
 *   4. Atomic commit across multiple files — either every write lands or
 *      none does (write-then-rename + on-disk journal for crash-recovery).
 *
 * Use cases (downstream):
 *   - `refactor_replace_guid`  — swap one 16-hex token for another
 *   - `refactor_move_resource_path` — rewrite `{GUID}<old>` → `{GUID}<new>`
 *   - `refactor_rename_project_id`  — surgical edit of a single .gproj line
 *   - `refactor_normalize_dependencies` — sort + dedupe a Dependencies block
 */

import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  unlinkSync,
  renameSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { logger } from "../utils/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A byte range inside a file's text content. `end` is exclusive. */
export interface Span {
  start: number;
  end: number;
  /** Optional original text for sanity-check on splice. */
  text?: string;
}

/** One pending edit, ready to be applied. */
export interface PendingEdit {
  filePath: string;
  /** Pre-computed new content for the file. The byte-edit lib doesn't
   *  compose multiple spans into one new file — that's the caller's job
   *  (they own the parser/regex). We just write what they give us. */
  newContent: string;
  /**
   * M15 (TOCTOU): mtime (ms) and size the file had when the plan was built
   * — as returned by {@link readTextStrict}. When set, `atomicCommit`
   * re-stats the file before backing it up AND again right before the
   * rename, and aborts with "file changed since plan" on any mismatch, so a
   * Workbench save that landed between dry-run and commit is never
   * clobbered with a stale rewrite.
   */
  expectedMtimeMs?: number;
  expectedSize?: number;
}

/** What {@link readTextStrict} hands back: decoded text + the stat snapshot to pin a later commit to. */
export interface StrictRead {
  content: string;
  mtimeMs: number;
  size: number;
}

/** Fatal decoder: throws on any byte sequence that isn't valid UTF-8. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Decode `buf` as UTF-8, refusing (with a path-bearing error) when it holds
 * bytes that aren't valid UTF-8. M15 (a): `readFileSync(p, "utf-8")` silently
 * maps such bytes to U+FFFD, and writing that string back would corrupt the
 * file — e.g. a Windows-1252 `é` in a comment, or a stray NUL. We can't
 * splice a decoded string back into a non-UTF-8 file byte-exactly, so the
 * safe behavior is to refuse the edit and tell the user which file.
 */
export function decodeUtf8Strict(buf: Buffer, filePath: string): string {
  try {
    return STRICT_UTF8.decode(buf);
  } catch {
    throw new Error(
      `Refusing to edit ${filePath}: file contains bytes that are not valid UTF-8 ` +
        `(rewriting it would replace them with U+FFFD). Convert the file to UTF-8 first.`,
    );
  }
}

/**
 * Read a text file for editing: strict UTF-8 decode (see
 * {@link decodeUtf8Strict}) plus the mtime/size snapshot that a later
 * `atomicCommit` uses for its TOCTOU check. Plan builders should use this
 * instead of `readFileSync(p, "utf-8")`.
 */
export function readTextStrict(filePath: string): StrictRead {
  const stat = statSync(filePath);
  const buf = readFileSync(filePath);
  return { content: decodeUtf8Strict(buf, filePath), mtimeMs: stat.mtimeMs, size: stat.size };
}

/**
 * M15 (b): compare the on-disk stat against what the plan recorded. Throws
 * with a clear message when they differ; no-op when the edit carries no
 * expectation.
 */
function assertUnchangedSincePlan(edit: PendingEdit, phase: string): void {
  if (edit.expectedMtimeMs === undefined && edit.expectedSize === undefined) return;
  const stat = statSync(edit.filePath);
  const mtimeDrift =
    edit.expectedMtimeMs !== undefined && stat.mtimeMs !== edit.expectedMtimeMs;
  const sizeDrift = edit.expectedSize !== undefined && stat.size !== edit.expectedSize;
  if (mtimeDrift || sizeDrift) {
    throw new Error(
      `Refusing to write ${edit.filePath}: file changed since plan (${phase}; ` +
        `mtime ${edit.expectedMtimeMs ?? "?"} → ${stat.mtimeMs}, size ${edit.expectedSize ?? "?"} → ${stat.size}). ` +
        `Re-run the dry-run and commit again.`,
    );
  }
}

export interface EditOptions {
  /** Skip the git-clean check. Required for files outside any repo too. */
  force?: boolean;
  /** Keep the `.bak` after a successful write. Default true. */
  keepBackup?: boolean;
}

export interface EditResult {
  filePath: string;
  backupPath: string;
  bytesWritten: number;
}

export interface AtomicCommitResult {
  edits: EditResult[];
  /** When non-empty, the commit was rolled back due to a mid-write error. */
  rolledBack: { filePath: string; reason: string }[];
}

/**
 * The result of inspecting a file's git status. Replaces the old
 * `isGitClean` boolean which conflated "no changes" with "no repo" — a
 * footgun that trained downstream tools to always pass `force: true`.
 *
 * Audit fix C-2.
 */
export type GitState =
  | { kind: "clean" }
  | { kind: "dirty"; modified_files: string[] }
  | { kind: "outside-repo" }
  | { kind: "no-git-binary" };

/** Result of a journal-recovery sweep. */
export interface RecoveryResult {
  recovered: number;
  errors: string[];
}

// ── Span helpers ─────────────────────────────────────────────────────────────

/**
 * Find the first byte range matching `pattern` within `content`. When the
 * pattern is a RegExp with the global flag, returns the FIRST match (the
 * caller should iterate themselves if they want all).
 */
export function findSpan(content: string, pattern: RegExp | string): Span | null {
  if (typeof pattern === "string") {
    const idx = content.indexOf(pattern);
    if (idx === -1) return null;
    return { start: idx, end: idx + pattern.length, text: pattern };
  }
  const m = pattern.exec(content);
  if (m === null) return null;
  return { start: m.index, end: m.index + m[0].length, text: m[0] };
}

/**
 * Find every byte range matching `pattern` within `content`. The pattern
 * MUST have the global flag, else this throws (otherwise a non-global
 * regex returns the same match infinitely).
 */
export function findAllSpans(content: string, pattern: RegExp): Span[] {
  if (!pattern.global) {
    throw new Error("findAllSpans requires a RegExp with the global flag");
  }
  const out: Span[] = [];
  let m: RegExpExecArray | null;
  // Reset lastIndex so successive calls don't carry state.
  pattern.lastIndex = 0;
  while ((m = pattern.exec(content)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (m.index === pattern.lastIndex) pattern.lastIndex += 1; // empty-match guard
  }
  return out;
}

/**
 * Apply a single splice to a string. `span.text` (if set) is verified
 * against the actual slice — a mismatch throws. This catches the common
 * "content drifted between findSpan and splice" footgun.
 */
export function applySplice(content: string, span: Span, replacement: string): string {
  if (span.start < 0 || span.end > content.length || span.start > span.end) {
    throw new Error(`Span out of bounds: [${span.start}, ${span.end}) in length ${content.length}`);
  }
  if (span.text !== undefined) {
    const actual = content.slice(span.start, span.end);
    if (actual !== span.text) {
      throw new Error(
        `Span sanity-check failed at [${span.start}, ${span.end}): expected ${JSON.stringify(
          span.text.slice(0, 60),
        )}, got ${JSON.stringify(actual.slice(0, 60))}`,
      );
    }
  }
  return content.slice(0, span.start) + replacement + content.slice(span.end);
}

/**
 * Apply many splices to a single content string in one pass. Spans must
 * be non-overlapping; they're sorted by start position and applied
 * right-to-left so earlier positions don't shift.
 */
export function applyMultipleSplices(
  content: string,
  edits: { span: Span; replacement: string }[],
): string {
  // Sort by start desc so we splice from the end first — preserves earlier
  // span positions.
  const sorted = [...edits].sort((a, b) => b.span.start - a.span.start);
  // Validate non-overlap.
  for (let i = 0; i < sorted.length - 1; i++) {
    const later = sorted[i];
    const earlier = sorted[i + 1];
    if (earlier.span.end > later.span.start) {
      throw new Error(
        `Overlapping spans: [${earlier.span.start}, ${earlier.span.end}) and [${later.span.start}, ${later.span.end})`,
      );
    }
  }
  let out = content;
  for (const e of sorted) {
    out = applySplice(out, e.span, e.replacement);
  }
  return out;
}

// ── Git state inspection ─────────────────────────────────────────────────────

/**
 * Inspect a file's git status. Returns one of four kinds — distinguishing
 * "outside any repo" and "no git binary" from "dirty worktree" matters
 * because all three previously collapsed to `clean=false`, which trained
 * downstream tools to always pass `force: true`. Audit fix C-2.
 *
 * Behavior contract:
 *   - `clean`           — file is tracked AND worktree/index both match HEAD.
 *   - `dirty`           — file has uncommitted changes (modified_files lists them).
 *   - `outside-repo`    — file is not inside any git work-tree (proceed-OK).
 *   - `no-git-binary`   — git CLI is missing or unreachable (warn-and-proceed).
 *
 * Audit fix L4 SEC-003 preserved: uses execFileSync with an argv array
 * (no shell, no command-injection surface).
 */
export function checkGitState(filePath: string): GitState {
  const cwd = existsSync(filePath) ? (statSync(filePath).isDirectory() ? filePath : dirname(filePath)) : dirname(filePath);

  let repoTop: string;
  try {
    repoTop = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (e) {
    // ENOENT means the git binary itself isn't on PATH. Other errors
    // (typically exit code 128 — "not a git repository") mean we're
    // simply outside any repo. Distinguish so callers can decide.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "no-git-binary" };
    return { kind: "outside-repo" };
  }

  try {
    const relPath = relative(repoTop, filePath).split("\\").join("/");
    const status = execFileSync(
      "git",
      ["status", "--porcelain", "--", relPath],
      {
        cwd: repoTop,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (status.trim().length === 0) {
      return { kind: "clean" };
    }
    // Porcelain format: "XY filename" per line. Strip the status code.
    const modified = status
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^.{1,3}\s+/, ""));
    return { kind: "dirty", modified_files: modified };
  } catch (e) {
    // Something went sideways in `git status` — treat as outside-repo so
    // we don't block the caller. Better to log and proceed than to wedge.
    logger.warn(
      `[byte-edit] git status failed for ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { kind: "outside-repo" };
  }
}

/**
 * @deprecated Use {@link checkGitState} for fine-grained git state. This
 * wrapper is kept for back-compat with downstream callers and returns
 * `{ clean: true }` for both `clean` AND `outside-repo` kinds (since
 * refusing on no-git is a footgun). `no-git-binary` is also treated as
 * clean — Windows boxes without git CLI shouldn't be blocked.
 *
 * Audit-fix L4 SEC-003 preserved: uses execFileSync with an argv array
 * (no shell). The fix lives in `checkGitState`.
 *
 * The `{ clean, reason }` return signature is preserved verbatim so
 * existing callers (e.g. `src/tools/faction-create.ts`) keep working
 * without modification. The semantics shift: outside-repo now returns
 * `clean: true` instead of `clean: false`, which makes the old workaround
 * in faction-create.ts (`!clean.reason.includes("not inside a git repo")`)
 * redundant but harmless.
 */
export function isGitClean(filePath: string): { clean: boolean; reason: string } {
  if (!existsSync(filePath)) {
    return { clean: false, reason: "file does not exist" };
  }
  const state = checkGitState(filePath);
  switch (state.kind) {
    case "clean":
      return { clean: true, reason: "" };
    case "outside-repo":
      return { clean: true, reason: "not inside a git repo" };
    case "no-git-binary":
      return { clean: true, reason: "git binary not found on PATH" };
    case "dirty":
      return {
        clean: false,
        reason: `uncommitted changes: ${state.modified_files.join(", ").slice(0, 80)}`,
      };
  }
}

/**
 * Internal helper — decides whether the byte-edit operations should refuse
 * a write based on a {@link GitState}. Centralizes the policy so
 * `writeWithBackup` and `atomicCommit` stay aligned.
 */
function shouldRefuseWrite(state: GitState): { refuse: boolean; reason: string } {
  switch (state.kind) {
    case "clean":
    case "outside-repo":
      return { refuse: false, reason: "" };
    case "no-git-binary":
      logger.warn(
        "[byte-edit] git CLI not found — proceeding without git-clean check. Install git for full safety.",
      );
      return { refuse: false, reason: "" };
    case "dirty":
      return {
        refuse: true,
        reason: `uncommitted changes in ${state.modified_files.length} file(s): ${state.modified_files.slice(0, 5).join(", ")}${state.modified_files.length > 5 ? ", ..." : ""}`,
      };
  }
}

// ── Backup helpers ───────────────────────────────────────────────────────────

function backupPath(filePath: string): string {
  return `${filePath}.bak`;
}

/**
 * Create a backup of `filePath`, never clobbering a pre-existing pristine
 * `.bak`. RBE-3 fix.
 *
 * Scheme:
 *   - If no `<path>.bak` exists yet → copy the original to `<path>.bak`.
 *     This is the FIRST backup, and by doctrine it holds the true original.
 *   - If `<path>.bak` already exists → it is the pristine original from a
 *     prior refactor. Leave it untouched. Write THIS run's backup to a
 *     unique-suffixed sidecar `<path>.bak.<uuid>` so we still have a
 *     same-run safety net, without destroying the real original.
 *
 * Returns the path of the backup written for THIS run (used by the caller's
 * own rollback paths) plus the pristine `.bak` path that {@link
 * restoreFromBackup} will prefer. The two are identical on first backup.
 */
function createBackup(filePath: string): { runBak: string; pristineBak: string } {
  const pristineBak = backupPath(filePath);
  if (!existsSync(pristineBak)) {
    copyFileSync(filePath, pristineBak);
    logger.debug(`[byte-edit] backed up ${filePath} → ${pristineBak}`);
    return { runBak: pristineBak, pristineBak };
  }
  // Pristine .bak already exists — preserve it as the true original. Write a
  // unique per-run sidecar instead so we never overwrite the original.
  const runBak = `${pristineBak}.${randomUUID()}`;
  copyFileSync(filePath, runBak);
  logger.debug(
    `[byte-edit] ${pristineBak} already exists (pristine original preserved); this run's backup → ${runBak}`,
  );
  return { runBak, pristineBak };
}

// ── Single-file write ────────────────────────────────────────────────────────

/**
 * Write `newContent` to `filePath`, creating a `.bak` sidecar first.
 * Refuses by default on uncommitted git changes — pass `force: true` to
 * bypass. The `.bak` is removed on success unless `keepBackup: true`.
 *
 * Audit fix C-2: now uses {@link checkGitState} via `shouldRefuseWrite`.
 * Outside-repo and no-git-binary no longer block — only a dirty worktree
 * does. This eliminates the previous "always force=true" footgun.
 */
export function writeWithBackup(
  filePath: string,
  newContent: string,
  options: EditOptions = {},
): EditResult {
  const keepBackup = options.keepBackup ?? true;

  if (!options.force) {
    if (!existsSync(filePath)) {
      throw new Error(`Cannot edit non-existent file: ${filePath}`);
    }
    const state = checkGitState(filePath);
    const decision = shouldRefuseWrite(state);
    if (decision.refuse) {
      throw new Error(
        `Refusing to edit ${filePath}: ${decision.reason}. Pass force: true to override.`,
      );
    }
  }

  if (!existsSync(filePath)) {
    throw new Error(`Cannot edit non-existent file: ${filePath}`);
  }

  // M15 (a): refuse to overwrite a file whose bytes aren't valid UTF-8 —
  // the caller's `newContent` was necessarily derived from a lossy decode.
  decodeUtf8Strict(readFileSync(filePath), filePath);

  // RBE-3: never clobber a pre-existing pristine `.bak`. `runBak` holds the
  // pre-this-write content (for undoing THIS write); `pristineBak` is the
  // true original that restoreFromBackup prefers.
  const { runBak, pristineBak } = createBackup(filePath);

  try {
    writeFileSync(filePath, newContent, "utf-8");
  } catch (e) {
    // Best-effort restore from this run's backup (pre-write content).
    try {
      copyFileSync(runBak, filePath);
    } catch {
      /* if even restore fails, the bak is still there for hand-recovery */
    }
    throw e;
  }

  if (!keepBackup) {
    // Only remove THIS run's sidecar. The pristine `.bak` is removed too
    // when it IS this run's backup (first-ever write); otherwise the
    // pristine original is preserved across runs.
    try {
      unlinkSync(runBak);
    } catch {
      /* best effort */
    }
  }

  return {
    filePath,
    // Report the pristine `.bak` — that's the original a caller restores.
    backupPath: pristineBak,
    bytesWritten: Buffer.byteLength(newContent, "utf-8"),
  };
}

// ── Atomic multi-file commit (journal + write-then-rename) ───────────────────

/**
 * Journal record format. One file per atomic-commit batch. Lives in a
 * deterministic project-level dir (`<root>/.emcp/journals/`, RBE-2) so
 * recovery can find it independently of which target dir came first. The
 * record carries every target's absolute path/bak/tmp, so a single journal
 * restores a multi-directory commit. The journal write itself does not need
 * to be atomic w.r.t. the targets, so we just `writeFileSync` it.
 */
interface JournalRecord {
  id: string;
  /** Per-target metadata. `tmp` is the path of the staged write. `bak`
   *  points at THIS commit's pre-write backup (may be a unique sidecar when
   *  a pristine `.bak` already existed — RBE-3). */
  targets: {
    path: string;
    bak: string;
    tmp: string;
    bytes_before: number;
    bytes_after: number;
  }[];
  status: "in_progress" | "completed";
}

const JOURNAL_PREFIX = ".atomic-commit.";
const JOURNAL_SUFFIX = ".json";

/** Project-level journal home, relative to a resolved project root. */
const JOURNAL_DIR_SEGMENTS = [".emcp", "journals"] as const;

function journalPath(dir: string, id: string): string {
  return join(dir, `${JOURNAL_PREFIX}${id}${JOURNAL_SUFFIX}`);
}

/**
 * Resolve a deterministic, stable journal directory for a commit batch.
 * RBE-2 fix: the journal must live somewhere {@link recoverFromJournal} can
 * find it even when the commit spans multiple directories.
 *
 * Strategy: walk up from the deepest common ancestor of all target dirs
 * looking for a project anchor (`.git`, an existing `.emcp/`, or — M15 (d) —
 * a directory holding a `.gproj`/`.csproj`, i.e. the addon root the crawler
 * indexes and sweeps on startup). Anchor → `<anchor>/.emcp/journals/`. If no anchor is
 * found, fall back to `<common-ancestor>/.emcp/journals/`. Either way the
 * location is a pure function of the target paths, so recovery can
 * recompute it. The journal record itself lists every target's absolute
 * path/bak/tmp, so once found it restores all directories regardless of
 * where they live.
 */
function resolveJournalDir(targetPaths: string[]): string {
  const dirs = targetPaths.map((p) => dirname(p));
  const anchor = findProjectAnchor(dirs);
  return join(anchor, ...JOURNAL_DIR_SEGMENTS);
}

/** Deepest directory that is an ancestor of (or equal to) every input dir. */
function commonAncestorDir(dirs: string[]): string {
  if (dirs.length === 0) return ".";
  const split = dirs.map((d) => d.split(/[\\/]/));
  const first = split[0];
  const out: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i];
    if (split.every((parts) => parts[i] === seg)) {
      out.push(seg);
    } else {
      break;
    }
  }
  // Re-join. On POSIX an absolute path starts with "" → leading "/".
  const joined = out.join("/");
  return joined.length === 0 ? (first[0] === "" ? "/" : ".") : joined;
}

/**
 * Walk up from the common ancestor looking for a project anchor. Returns
 * the anchor dir, or the common ancestor itself if none is found. Pure
 * function of the input dirs (modulo on-disk anchor presence, which is
 * stable across a commit + its recovery).
 */
function findProjectAnchor(dirs: string[]): string {
  let cur = commonAncestorDir(dirs);
  // Guard against infinite loops at filesystem root.
  let prev = "";
  while (cur && cur !== prev) {
    try {
      if (
        existsSync(join(cur, ".git")) ||
        existsSync(join(cur, ...JOURNAL_DIR_SEGMENTS)) ||
        hasProjectFile(cur)
      ) {
        return cur;
      }
    } catch {
      /* ignore stat errors, keep walking */
    }
    prev = cur;
    cur = dirname(cur);
  }
  // No anchor found — use the common ancestor.
  return commonAncestorDir(dirs);
}

/** M15 (d): true when `dir` directly contains a `.gproj` or `.csproj` file. */
function hasProjectFile(dir: string): boolean {
  try {
    return readdirSync(dir).some((n) => {
      const lower = n.toLowerCase();
      return lower.endsWith(".gproj") || lower.endsWith(".csproj");
    });
  } catch {
    return false;
  }
}

/** Ensure the journal directory exists (mkdir -p). */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function writeJournal(path: string, record: JournalRecord): void {
  writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");
}

/**
 * Apply a batch of pending edits with all-or-nothing semantics.
 *
 * Audit fix C-1: Windows atomicity. The new flow is write-then-rename
 * with an on-disk journal:
 *
 *   Phase 1: snapshot each target into `<path>.bak` (unchanged).
 *   Phase 2a: write a journal file `.atomic-commit.<uuid>.json` to a
 *             deterministic project-level dir (`<root>/.emcp/journals/`,
 *             RBE-2). Lists every file the commit will touch and its
 *             planned tmp path, so recovery restores all dirs from one
 *             journal regardless of where the targets live.
 *   Phase 2b: write each target's new content to `<path>.tmp.<uuid>`
 *             in the SAME directory as the target (so the eventual rename
 *             is intra-volume — atomic on POSIX, best-effort on NTFS).
 *   Phase 2c: once ALL tmp files exist, rename each tmp → target. Node's
 *             `fs.renameSync` translates to NT MoveFileEx with
 *             REPLACE_EXISTING on Windows, which is atomic at the
 *             metadata level for same-volume operations.
 *   Phase 3:  mark journal `status: "completed"` then delete it.
 *
 * If the process dies between Phase 2c renames, the on-disk journal lets
 * {@link recoverFromJournal} restore from the `.bak` files. This is the
 * key improvement over the prior two-phase write that could leave
 * partial state on Windows.
 */
export function atomicCommit(
  edits: PendingEdit[],
  options: EditOptions = {},
): AtomicCommitResult {
  const result: AtomicCommitResult = { edits: [], rolledBack: [] };

  if (edits.length === 0) return result;

  if (!options.force) {
    for (const e of edits) {
      const state = checkGitState(e.filePath);
      const decision = shouldRefuseWrite(state);
      if (decision.refuse) {
        throw new Error(
          `Refusing to start atomic commit: ${e.filePath} — ${decision.reason}. Pass force: true to override.`,
        );
      }
    }
  }

  // Phase 1: back up every file. RBE-3: createBackup preserves a pristine
  // `.bak` from a prior refactor and writes this run's backup to a unique
  // sidecar when one already exists. `runBak` is the pre-commit content
  // (used for rollback + journal recovery); `pristineBak` is the true
  // original reported to the caller.
  const backedUp: {
    original: string;
    runBak: string;
    pristineBak: string;
    originalContent: string;
  }[] = [];
  for (const e of edits) {
    if (!existsSync(e.filePath)) {
      throw new Error(`Cannot commit: file does not exist: ${e.filePath}`);
    }
    // M15 (b): the plan was built against a specific mtime/size — bail
    // before touching anything if the file moved on since.
    assertUnchangedSincePlan(e, "before backup");
    // M15 (a): strict decode — a non-UTF-8 file can't be rewritten from a
    // decoded string without corrupting it, so refuse here, before any
    // target is backed up or staged.
    const originalContent = decodeUtf8Strict(readFileSync(e.filePath), e.filePath);
    const { runBak, pristineBak } = createBackup(e.filePath);
    backedUp.push({ original: e.filePath, runBak, pristineBak, originalContent });
  }

  // Phase 2a: write journal to a deterministic project-level location so a
  // multi-directory commit is recoverable. RBE-2: previously the journal
  // landed in the FIRST target's dir only, which a non-recursive recovery
  // sweep over a *different* dir would never find. resolveJournalDir anchors
  // it under `<project-root>/.emcp/journals/` (a pure function of the target
  // paths), and the record lists every target's absolute path so recovery
  // restores all directories once it locates the journal.
  const commitId = randomUUID();
  const journalDir = resolveJournalDir(edits.map((e) => e.filePath));
  const journalFile = journalPath(journalDir, commitId);

  const journal: JournalRecord = {
    id: commitId,
    targets: edits.map((e) => {
      const b = backedUp.find((x) => x.original === e.filePath)!;
      return {
        path: e.filePath,
        // RBE-3: point at THIS commit's pre-write backup (may be a unique
        // sidecar), not blindly `<path>.bak`.
        bak: b.runBak,
        tmp: `${e.filePath}.tmp.${commitId}`,
        bytes_before: Buffer.byteLength(b.originalContent, "utf-8"),
        bytes_after: Buffer.byteLength(e.newContent, "utf-8"),
      };
    }),
    status: "in_progress",
  };

  try {
    ensureDir(journalDir);
    writeJournal(journalFile, journal);
  } catch (err) {
    // Couldn't even write the journal — bail before touching any target.
    // The .bak files are still on disk for hand-recovery.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Atomic commit failed: could not write journal at ${journalFile}: ${reason}`);
  }

  // Phase 2b: stage every target into a sibling tmp file.
  const stagedTmps: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const tmp = journal.targets[i].tmp;
    try {
      writeFileSync(tmp, e.newContent, "utf-8");
      stagedTmps.push(tmp);
    } catch (err) {
      // Stage failed. Clean up everything: drop staged tmps, restore from
      // .bak (no target was renamed yet, so they're untouched — but we
      // still restore defensively), drop journal, re-throw.
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[byte-edit] staging failed at ${e.filePath} — aborting commit, no targets touched`,
      );
      for (const t of stagedTmps) {
        try {
          unlinkSync(t);
        } catch {
          /* best effort */
        }
      }
      for (const b of backedUp) {
        // Targets were not renamed, so on-disk content equals original.
        // Still record as "rolled back" so the caller has audit visibility.
        result.rolledBack.push({ filePath: b.original, reason });
      }
      try {
        unlinkSync(journalFile);
      } catch {
        /* best effort */
      }
      throw new Error(
        `Atomic commit failed at stage: ${reason}. ${stagedTmps.length} tmp file(s) cleaned up.`,
      );
    }
  }

  // Phase 2c: rename each tmp → target. On Windows this is NT MoveFileEx
  // with REPLACE_EXISTING; on POSIX it's a true atomic rename. Either way,
  // intra-volume (same directory) means metadata atomicity.
  let renamedCount = 0;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const tmp = journal.targets[i].tmp;
    try {
      // M15 (b): last look before the swap — the window between Phase 1
      // and here is where a concurrent Workbench save would land.
      assertUnchangedSincePlan(e, "before rename");
      renameSync(tmp, e.filePath);
      renamedCount++;
      result.edits.push({
        filePath: e.filePath,
        // Report the pristine `.bak` (true original) for the caller.
        backupPath: backedUp[i].pristineBak,
        bytesWritten: Buffer.byteLength(e.newContent, "utf-8"),
      });
    } catch (err) {
      // Mid-rename failure. Roll back: restore the already-renamed targets
      // from their .bak files. The journal remains on disk pointing to the
      // tmp + bak files for recovery if something explodes further.
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[byte-edit] rename failed at ${e.filePath} (after ${renamedCount} successes) — rolling back`,
      );

      // Restore already-renamed targets from this run's pre-commit backup.
      for (let j = 0; j < renamedCount; j++) {
        const b = backedUp[j];
        try {
          copyFileSync(b.runBak, b.original);
          result.rolledBack.push({ filePath: b.original, reason });
        } catch (rollbackErr) {
          // Last resort: write the in-memory original content back.
          try {
            writeFileSync(b.original, b.originalContent, "utf-8");
            result.rolledBack.push({ filePath: b.original, reason });
          } catch {
            result.rolledBack.push({
              filePath: b.original,
              reason: `rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}; bak file at ${b.runBak}`,
            });
          }
        }
      }
      // Clean up unrenamed tmp files.
      for (let j = renamedCount; j < stagedTmps.length; j++) {
        try {
          unlinkSync(stagedTmps[j]);
        } catch {
          /* best effort */
        }
      }
      // Drop journal — rollback complete.
      try {
        unlinkSync(journalFile);
      } catch {
        /* best effort */
      }
      throw new Error(
        `Atomic commit failed at rename ${renamedCount + 1}/${edits.length}: ${reason}. Rolled back ${result.rolledBack.length} file(s).`,
      );
    }
  }

  // Phase 3: mark journal completed, then delete it. The intermediate
  // "completed" write means a crash here leaves the journal in a state
  // where {@link recoverFromJournal} knows the writes landed — it just
  // needs to clean up the stale journal file.
  try {
    writeJournal(journalFile, { ...journal, status: "completed" });
    unlinkSync(journalFile);
  } catch {
    // Journal cleanup is best-effort. The recovery sweep will catch it.
  }

  // Optionally clean up .bak sidecars. Drop both this run's sidecar AND the
  // pristine `.bak` (which may be the same file on a first commit).
  if (options.keepBackup === false) {
    for (const b of backedUp) {
      for (const p of new Set([b.runBak, b.pristineBak])) {
        try {
          unlinkSync(p);
        } catch {
          /* best effort */
        }
      }
    }
  }

  return result;
}

// ── Crash-recovery journal sweep ─────────────────────────────────────────────

/**
 * Scan `rootDir` for stale atomic-commit journal files and either revert
 * (when status was `in_progress`) or just clean them up (when status was
 * `completed`).
 *
 * This is the recovery side of audit-fix C-1: after an unclean shutdown
 * mid-`atomicCommit`, downstream tools should call this on startup with
 * the working-directory root to clean up any torn state.
 *
 * Behavior:
 *   - `in_progress` journal → restore each listed target from its `.bak`,
 *     delete any orphaned `.tmp.<uuid>` files, then delete the journal.
 *   - `completed` journal   → just delete the journal (a crash between
 *     setting `completed` and unlinking is benign; the writes landed).
 *
 * RBE-2: `atomicCommit` now writes journals to `<project-root>/.emcp/
 * journals/`, a deterministic location independent of which target dir
 * came first. recoverFromJournal therefore sweeps TWO places per call:
 *   1. `<rootDir>/.emcp/journals/` — the new deterministic home.
 *   2. `<rootDir>` itself — back-compat for legacy journals dropped beside
 *      the first target (and for callers that pass the journal dir directly).
 * Each journal record lists every target's absolute path/bak/tmp, so a
 * single recovered journal restores all directories the commit touched —
 * the sweep dir only needs to FIND the journal, not contain the targets.
 */
export function recoverFromJournal(rootDir: string): RecoveryResult {
  const result: RecoveryResult = { recovered: 0, errors: [] };

  const seen = new Set<string>();
  // Deterministic journal home first, then the rootDir itself (legacy).
  const candidateDirs = [join(rootDir, ...JOURNAL_DIR_SEGMENTS), rootDir];

  for (const dir of candidateDirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // Missing/unreadable candidate dir is not an error — the deterministic
      // `.emcp/journals/` simply may not exist. Only a fully unreadable
      // rootDir is worth surfacing.
      if (dir === rootDir) {
        result.errors.push(`Could not read ${rootDir}`);
      }
      continue;
    }

    for (const name of entries) {
      if (!name.startsWith(JOURNAL_PREFIX) || !name.endsWith(JOURNAL_SUFFIX)) continue;
      const journalFile = join(dir, name);
      // Skip if we already processed this exact journal via another candidate.
      if (seen.has(journalFile)) continue;
      seen.add(journalFile);
      processJournalFile(journalFile, result);
    }
  }

  return result;
}

/** Recover a single journal file in place, mutating `result`. */
function processJournalFile(journalFile: string, result: RecoveryResult): void {
  let record: JournalRecord;
  try {
    record = JSON.parse(readFileSync(journalFile, "utf-8")) as JournalRecord;
  } catch (e) {
    result.errors.push(
      `Failed to parse journal ${journalFile}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  if (record.status === "completed") {
    // Writes landed before the crash — just clean up the orphan journal.
    try {
      unlinkSync(journalFile);
      result.recovered += 1;
    } catch (e) {
      result.errors.push(
        `Failed to delete completed journal ${journalFile}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return;
  }

  // status === "in_progress": revert each target from its .bak.
  let recoveryFailures = 0;
  for (const t of record.targets) {
    try {
      if (existsSync(t.bak)) {
        copyFileSync(t.bak, t.path);
      }
      // Drop any orphan tmp file.
      if (existsSync(t.tmp)) {
        try {
          unlinkSync(t.tmp);
        } catch {
          /* best effort */
        }
      }
    } catch (e) {
      recoveryFailures += 1;
      result.errors.push(
        `Failed to restore ${t.path} from ${t.bak}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  try {
    unlinkSync(journalFile);
  } catch (e) {
    result.errors.push(
      `Failed to delete journal ${journalFile}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (recoveryFailures === 0) {
    result.recovered += 1;
  }
}

// ── Restore helper ───────────────────────────────────────────────────────────

/**
 * Build a `PendingEdit` for a single file by reading it, applying a
 * regex+replacer, and returning the result. Returns null when the regex
 * makes no matches (no edit needed).
 *
 * Saves L5+ refactor tools from hand-rolling the read/replace/PendingEdit
 * dance — they just build a pattern + replacer and pass the result list
 * to `atomicCommit`.
 *
 * The regex MUST have the `g` flag if multiple replacements per file are
 * intended; non-global regex stops after the first match. Validation
 * matches `findAllSpans`.
 */
export function planFileEdit(
  filePath: string,
  pattern: RegExp,
  replacer: (match: string, ...captures: string[]) => string,
): PendingEdit | null {
  // M15: strict decode + stat snapshot so the resulting edit is pinned to
  // the file state it was planned against.
  const { content, mtimeMs, size } = readTextStrict(filePath);
  let replaced = 0;
  // `replace` calls `replacer` with (match, ...captures, offset, fullString).
  // We unwrap the trailing offset+fullString from the replacer's tail args.
  const newContent = content.replace(pattern, (match: string, ...rest: unknown[]) => {
    // rest = [...captures, offset, fullString]. Strip the last two.
    const captures = rest.slice(0, Math.max(0, rest.length - 2)).map((v) =>
      typeof v === "string" ? v : "",
    );
    replaced += 1;
    return replacer(match, ...captures);
  });
  if (replaced === 0) return null;
  return { filePath, newContent, expectedMtimeMs: mtimeMs, expectedSize: size };
}

/**
 * Restore a file from its pristine `.bak` sidecar. Returns true if restored,
 * false if no `.bak` exists. Removes the `.bak` after a successful restore.
 *
 * RBE-3: `writeWithBackup`/`atomicCommit` never clobber the `<path>.bak`
 * written by the FIRST refactor, so this always restores the TRUE original
 * even after multiple successive edits to the same file. Per-run sidecars
 * (`<path>.bak.<uuid>`) are intentionally NOT consulted here — they are the
 * lib's internal rollback breadcrumbs, not the user-facing original.
 */
export function restoreFromBackup(filePath: string): boolean {
  const bak = backupPath(filePath);
  if (!existsSync(bak)) return false;
  copyFileSync(bak, filePath);
  try {
    unlinkSync(bak);
  } catch {
    /* best effort */
  }
  return true;
}
