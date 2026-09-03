import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findSpan,
  findAllSpans,
  applySplice,
  applyMultipleSplices,
  writeWithBackup,
  atomicCommit,
  restoreFromBackup,
  checkGitState,
  isGitClean,
  recoverFromJournal,
  readTextStrict,
  planFileEdit,
} from "../../src/refactor/byte-edit.ts";

// ── Span helpers (pure — no FS) ──────────────────────────────────────────────

describe("findSpan", () => {
  it("finds a string literal", () => {
    const s = findSpan("hello world", "world");
    expect(s).toEqual({ start: 6, end: 11, text: "world" });
  });

  it("finds a regex match", () => {
    const s = findSpan("abc123def", /\d+/);
    expect(s).toEqual({ start: 3, end: 6, text: "123" });
  });

  it("returns null on no match", () => {
    expect(findSpan("abc", "z")).toBeNull();
  });
});

describe("findAllSpans", () => {
  it("returns every match with global flag", () => {
    const spans = findAllSpans("aaa bbb aaa", /aaa/g);
    expect(spans).toHaveLength(2);
    expect(spans[0].start).toBe(0);
    expect(spans[1].start).toBe(8);
  });

  it("throws when called without global flag", () => {
    expect(() => findAllSpans("aaa", /aaa/)).toThrow(/global/);
  });

  it("handles empty-match guard", () => {
    const spans = findAllSpans("abc", /(?:)/g);
    // Should not infinite-loop. Number of matches is implementation-defined but bounded.
    expect(spans.length).toBeLessThan(10);
  });
});

describe("applySplice", () => {
  it("splices in the middle of a string", () => {
    const result = applySplice("hello world", { start: 6, end: 11 }, "moon");
    expect(result).toBe("hello moon");
  });

  it("verifies span.text matches actual content", () => {
    const result = applySplice("hello world", { start: 6, end: 11, text: "world" }, "moon");
    expect(result).toBe("hello moon");
  });

  it("throws on span.text mismatch", () => {
    expect(() =>
      applySplice("hello world", { start: 6, end: 11, text: "earth" }, "moon"),
    ).toThrow(/sanity-check failed/);
  });

  it("throws on out-of-bounds span", () => {
    expect(() => applySplice("abc", { start: 10, end: 20 }, "X")).toThrow(/out of bounds/);
  });
});

describe("applyMultipleSplices", () => {
  it("applies non-overlapping splices in correct order", () => {
    const content = "foo bar baz";
    const result = applyMultipleSplices(content, [
      { span: { start: 0, end: 3 }, replacement: "FOO" },
      { span: { start: 4, end: 7 }, replacement: "BAR" },
      { span: { start: 8, end: 11 }, replacement: "BAZ" },
    ]);
    expect(result).toBe("FOO BAR BAZ");
  });

  it("throws on overlapping spans", () => {
    expect(() =>
      applyMultipleSplices("hello world", [
        { span: { start: 0, end: 5 }, replacement: "X" },
        { span: { start: 3, end: 8 }, replacement: "Y" },
      ]),
    ).toThrow(/overlap/i);
  });
});

// ── FS-backed helpers ────────────────────────────────────────────────────────

describe("writeWithBackup + restoreFromBackup", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "byteedit-test-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("writes new content and creates a .bak", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "original");
    const result = writeWithBackup(f, "modified", { force: true });
    expect(readFileSync(f, "utf-8")).toBe("modified");
    expect(existsSync(`${f}.bak`)).toBe(true);
    expect(readFileSync(`${f}.bak`, "utf-8")).toBe("original");
    expect(result.bytesWritten).toBe(Buffer.byteLength("modified", "utf-8"));
  });

  // Audit fix C-2: outside-repo no longer refuses. Files inside os.tmpdir()
  // are typically outside any git work-tree on CI/dev machines, so the
  // write should proceed without `force: true`.
  it("proceeds on outside-repo file without force (audit fix C-2)", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "original");
    const result = writeWithBackup(f, "modified");
    expect(readFileSync(f, "utf-8")).toBe("modified");
    expect(result.bytesWritten).toBe(Buffer.byteLength("modified", "utf-8"));
  });

  it("restoreFromBackup brings back the original", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "original");
    writeWithBackup(f, "modified", { force: true });
    expect(restoreFromBackup(f)).toBe(true);
    expect(readFileSync(f, "utf-8")).toBe("original");
    // Backup cleared after restore.
    expect(existsSync(`${f}.bak`)).toBe(false);
  });

  it("restoreFromBackup returns false when no backup exists", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "original");
    expect(restoreFromBackup(f)).toBe(false);
  });

  it("keepBackup: false removes the .bak", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "original");
    writeWithBackup(f, "modified", { force: true, keepBackup: false });
    expect(existsSync(`${f}.bak`)).toBe(false);
  });

  // RBE-3: a second writeWithBackup on the same file must NOT clobber the
  // pristine `.bak`. The first backup holds the true original; restore must
  // yield that original, not the once-edited intermediate content.
  it("second writeWithBackup preserves the ORIGINAL in .bak (RBE-3)", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "v0-original");

    // First refactor: v0 → v1. Pristine .bak captures v0.
    writeWithBackup(f, "v1-edited", { force: true });
    expect(readFileSync(f, "utf-8")).toBe("v1-edited");
    expect(readFileSync(`${f}.bak`, "utf-8")).toBe("v0-original");

    // Second refactor: v1 → v2. The .bak must STILL hold v0, not v1.
    writeWithBackup(f, "v2-edited", { force: true });
    expect(readFileSync(f, "utf-8")).toBe("v2-edited");
    expect(readFileSync(`${f}.bak`, "utf-8")).toBe("v0-original");

    // Restore yields the TRUE original (v0), not the once-edited v1.
    expect(restoreFromBackup(f)).toBe(true);
    expect(readFileSync(f, "utf-8")).toBe("v0-original");
  });
});

describe("atomicCommit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "byteedit-atomic-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("commits multiple files when all succeed", () => {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "A1");
    writeFileSync(b, "B1");
    const result = atomicCommit(
      [
        { filePath: a, newContent: "A2" },
        { filePath: b, newContent: "B2" },
      ],
      { force: true },
    );
    expect(result.edits).toHaveLength(2);
    expect(result.rolledBack).toEqual([]);
    expect(readFileSync(a, "utf-8")).toBe("A2");
    expect(readFileSync(b, "utf-8")).toBe("B2");
  });

  it("cleans up the journal on successful commit (audit fix C-1)", () => {
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    writeFileSync(a, "A1");
    writeFileSync(b, "B1");
    atomicCommit(
      [
        { filePath: a, newContent: "A2" },
        { filePath: b, newContent: "B2" },
      ],
      { force: true },
    );
    // After success, no .atomic-commit.*.json should remain.
    const journals = readdirSync(dir).filter((n) => n.startsWith(".atomic-commit."));
    expect(journals).toEqual([]);
    // And no leftover .tmp.* files.
    const tmps = readdirSync(dir).filter((n) => n.includes(".tmp."));
    expect(tmps).toEqual([]);
  });

  it("rolls back all files when one write fails", () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "A1");
    // Trigger via a write to a path with no parent dir.
    const nonExistent = join(dir, "nope-dir", "b.txt");
    expect(() =>
      atomicCommit(
        [
          { filePath: a, newContent: "A2" },
          { filePath: nonExistent, newContent: "B2" },
        ],
        { force: true },
      ),
    ).toThrow();
    // a should be unmodified (no rename even happened — stage failed first).
    expect(readFileSync(a, "utf-8")).toBe("A1");
    // No leftover journal.
    const journals = readdirSync(dir).filter((n) => n.startsWith(".atomic-commit."));
    expect(journals).toEqual([]);
  });

  // Audit fix C-2: outside-repo no longer refuses. The tmp dir is outside
  // any repo on a typical CI/dev box.
  it("proceeds on outside-repo files without force (audit fix C-2)", () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "A1");
    const result = atomicCommit([{ filePath: a, newContent: "A2" }]);
    expect(result.edits).toHaveLength(1);
    expect(readFileSync(a, "utf-8")).toBe("A2");
  });

  // RBE-2: a real multi-directory commit lands all files and leaves NO
  // journal anywhere (deterministic .emcp/journals dir is cleaned up too).
  it("commits across multiple directories and cleans up the journal (RBE-2)", () => {
    const dirA = join(dir, "modA");
    const dirB = join(dir, "modB");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    const a = join(dirA, "a.txt");
    const b = join(dirB, "b.txt");
    writeFileSync(a, "A1");
    writeFileSync(b, "B1");

    const result = atomicCommit(
      [
        { filePath: a, newContent: "A2" },
        { filePath: b, newContent: "B2" },
      ],
      { force: true },
    );
    expect(result.edits).toHaveLength(2);
    expect(readFileSync(a, "utf-8")).toBe("A2");
    expect(readFileSync(b, "utf-8")).toBe("B2");

    // No journal left under the deterministic .emcp/journals dir.
    const journalDir = join(dir, ".emcp", "journals");
    if (existsSync(journalDir)) {
      const left = readdirSync(journalDir).filter((n) => n.startsWith(".atomic-commit."));
      expect(left).toEqual([]);
    }
    // A fresh recovery sweep finds nothing to do.
    const rec = recoverFromJournal(dir);
    expect(rec.recovered).toBe(0);
  });

  // RBE-3: a second atomicCommit on the same file preserves the pristine
  // `.bak` (true original), so restoreFromBackup yields v0, not v1.
  it("second atomicCommit preserves the ORIGINAL in .bak (RBE-3)", () => {
    const a = join(dir, "a.txt");
    writeFileSync(a, "v0");
    atomicCommit([{ filePath: a, newContent: "v1" }], { force: true });
    expect(readFileSync(`${a}.bak`, "utf-8")).toBe("v0");
    atomicCommit([{ filePath: a, newContent: "v2" }], { force: true });
    // Pristine .bak still holds v0.
    expect(readFileSync(`${a}.bak`, "utf-8")).toBe("v0");
    expect(readFileSync(a, "utf-8")).toBe("v2");
    expect(restoreFromBackup(a)).toBe(true);
    expect(readFileSync(a, "utf-8")).toBe("v0");
  });
});

// ── checkGitState enum + isGitClean wrapper (audit fix C-2) ──────────────────

describe("checkGitState", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "byteedit-git-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns outside-repo for files under os.tmpdir() (no .git ancestor)", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "x");
    const state = checkGitState(f);
    expect(state.kind).toBe("outside-repo");
  });

  it("returns no-git-binary when execFileSync throws ENOENT", async () => {
    // Mock execFileSync to throw ENOENT for git lookups. Vitest's
    // vi.doMock requires we re-import the module under test.
    vi.resetModules();
    vi.doMock("node:child_process", () => ({
      execFileSync: () => {
        const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      },
    }));
    try {
      const mod = await import("../../src/refactor/byte-edit.ts?nogit");
      const f = join(dir, "test.txt");
      writeFileSync(f, "x");
      const state = mod.checkGitState(f);
      expect(state.kind).toBe("no-git-binary");
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("isGitClean wrapper returns clean=true for outside-repo (back-compat semantics)", () => {
    const f = join(dir, "test.txt");
    writeFileSync(f, "x");
    const result = isGitClean(f);
    expect(result.clean).toBe(true);
  });

  it("isGitClean wrapper returns clean=false with file-does-not-exist reason", () => {
    const f = join(dir, "does-not-exist.txt");
    const result = isGitClean(f);
    expect(result.clean).toBe(false);
    expect(result.reason).toMatch(/does not exist/);
  });
});

// ── Journal recovery (audit fix C-1) ─────────────────────────────────────────

describe("recoverFromJournal", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "byteedit-recover-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("returns recovered=0 when no journals exist", () => {
    const r = recoverFromJournal(dir);
    expect(r.recovered).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it("restores targets from .bak when journal is in_progress", () => {
    // Simulate a torn commit: target file has the "new" content, the .bak
    // has the original, and a journal points at both with status in_progress.
    const a = join(dir, "a.txt");
    const aBak = `${a}.bak`;
    writeFileSync(a, "TORN_NEW"); // mid-rename — target landed with new content
    writeFileSync(aBak, "ORIGINAL");
    const tmp = `${a}.tmp.fakeid`;
    // Tmp may or may not still be on disk; simulate it lingering.
    writeFileSync(tmp, "TORN_NEW");

    const journal = {
      id: "fakeid",
      targets: [
        {
          path: a,
          bak: aBak,
          tmp,
          bytes_before: Buffer.byteLength("ORIGINAL", "utf-8"),
          bytes_after: Buffer.byteLength("TORN_NEW", "utf-8"),
        },
      ],
      status: "in_progress" as const,
    };
    const journalFile = join(dir, ".atomic-commit.fakeid.json");
    writeFileSync(journalFile, JSON.stringify(journal, null, 2));

    const result = recoverFromJournal(dir);
    expect(result.recovered).toBe(1);
    expect(result.errors).toEqual([]);
    // Target restored from .bak.
    expect(readFileSync(a, "utf-8")).toBe("ORIGINAL");
    // Tmp cleaned up.
    expect(existsSync(tmp)).toBe(false);
    // Journal deleted.
    expect(existsSync(journalFile)).toBe(false);
  });

  // RBE-2: a multi-directory commit that crashes mid-rename must be
  // recoverable. The journal lives in the deterministic
  // `<root>/.emcp/journals/` dir (NOT in the first target's dir), and a
  // single recoverFromJournal(root) call must FIND it there and restore
  // targets across BOTH directories from their .bak sidecars.
  it("recovers a torn multi-directory commit from .emcp/journals (RBE-2)", () => {
    const dirA = join(dir, "moduleA");
    const dirB = join(dir, "moduleB");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    const a = join(dirA, "a.txt");
    const b = join(dirB, "b.txt");
    const aBak = `${a}.bak`;
    const bBak = `${b}.bak`;

    // Simulate a torn commit: target A already renamed (new content landed),
    // target B's rename never happened (still original). Both .bak sidecars
    // hold the originals. A lingering tmp for B is left on disk.
    writeFileSync(a, "A_NEW"); // landed
    writeFileSync(aBak, "A_ORIGINAL");
    writeFileSync(b, "B_ORIGINAL"); // never renamed
    writeFileSync(bBak, "B_ORIGINAL");
    const bTmp = `${b}.tmp.tornid`;
    writeFileSync(bTmp, "B_NEW");

    // Journal in the deterministic location — NOT in dirA or dirB.
    const journalDir = join(dir, ".emcp", "journals");
    mkdirSync(journalDir, { recursive: true });
    const journal = {
      id: "tornid",
      targets: [
        {
          path: a,
          bak: aBak,
          tmp: `${a}.tmp.tornid`,
          bytes_before: Buffer.byteLength("A_ORIGINAL", "utf-8"),
          bytes_after: Buffer.byteLength("A_NEW", "utf-8"),
        },
        {
          path: b,
          bak: bBak,
          tmp: bTmp,
          bytes_before: Buffer.byteLength("B_ORIGINAL", "utf-8"),
          bytes_after: Buffer.byteLength("B_NEW", "utf-8"),
        },
      ],
      status: "in_progress" as const,
    };
    const journalFile = join(journalDir, ".atomic-commit.tornid.json");
    writeFileSync(journalFile, JSON.stringify(journal, null, 2));

    // Sweep the ROOT — recovery must locate the journal under .emcp/journals
    // and restore both modules.
    const result = recoverFromJournal(dir);
    expect(result.recovered).toBe(1);
    expect(result.errors).toEqual([]);
    // Both targets restored to their originals.
    expect(readFileSync(a, "utf-8")).toBe("A_ORIGINAL");
    expect(readFileSync(b, "utf-8")).toBe("B_ORIGINAL");
    // Orphan tmp cleaned up.
    expect(existsSync(bTmp)).toBe(false);
    // Journal deleted.
    expect(existsSync(journalFile)).toBe(false);
  });

  it("deletes completed-status journal without touching files", () => {
    const a = join(dir, "a.txt");
    const aBak = `${a}.bak`;
    writeFileSync(a, "LANDED_NEW");
    writeFileSync(aBak, "ORIGINAL");

    const journal = {
      id: "doneid",
      targets: [
        {
          path: a,
          bak: aBak,
          tmp: `${a}.tmp.doneid`,
          bytes_before: 8,
          bytes_after: 10,
        },
      ],
      status: "completed" as const,
    };
    const journalFile = join(dir, ".atomic-commit.doneid.json");
    writeFileSync(journalFile, JSON.stringify(journal, null, 2));

    const result = recoverFromJournal(dir);
    expect(result.recovered).toBe(1);
    // Target NOT restored (writes had landed).
    expect(readFileSync(a, "utf-8")).toBe("LANDED_NEW");
    // Journal deleted.
    expect(existsSync(journalFile)).toBe(false);
  });

  it("records an error for an unparseable journal", () => {
    const journalFile = join(dir, ".atomic-commit.bogus.json");
    writeFileSync(journalFile, "not json {{{");
    const result = recoverFromJournal(dir);
    expect(result.recovered).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Failed to parse/);
  });
});

// ── M15: non-UTF-8 refusal, TOCTOU, .gproj journal anchor ───────────────────

describe("M15 byte-edit hardening", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "byte-edit-m15-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("(a) readTextStrict / atomicCommit / writeWithBackup refuse a file with invalid UTF-8 bytes", () => {
    const p = join(dir, "latin1.et");
    // "caf\xe9" — a lone 0xE9 is invalid UTF-8; lossy decode would yield U+FFFD.
    writeFileSync(p, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    expect(() => readTextStrict(p)).toThrow(/not valid UTF-8/);
    expect(() => atomicCommit([{ filePath: p, newContent: "cafe\n" }], { force: true })).toThrow(
      /not valid UTF-8/,
    );
    expect(() => writeWithBackup(p, "cafe\n", { force: true })).toThrow(/not valid UTF-8/);
    // Untouched: original bytes still there, no .bak created.
    expect([...readFileSync(p)]).toEqual([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    expect(existsSync(`${p}.bak`)).toBe(false);
  });

  it("(a) round-trips a BOM + multibyte UTF-8 file byte-exactly", () => {
    const p = join(dir, "utf8.et");
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("ID \"é→😀\"\n", "utf-8")]);
    writeFileSync(p, bytes);
    const { content } = readTextStrict(p);
    atomicCommit([{ filePath: p, newContent: content }], { force: true, keepBackup: false });
    expect(Buffer.compare(readFileSync(p), bytes)).toBe(0);
  });

  it("(b) atomicCommit aborts with 'file changed since plan' when mtime/size drifted", () => {
    const p = join(dir, "a.et");
    writeFileSync(p, "one\n");
    const edit = planFileEdit(p, /one/g, () => "two")!;
    expect(edit.expectedMtimeMs).toBeGreaterThan(0);
    expect(edit.expectedSize).toBe(4);
    // Someone (Workbench) saves in between plan and commit.
    writeFileSync(p, "one more\n");
    expect(() => atomicCommit([edit], { force: true })).toThrow(/file changed since plan/);
    // Nothing was written or backed up.
    expect(readFileSync(p, "utf-8")).toBe("one more\n");
    expect(existsSync(`${p}.bak`)).toBe(false);
  });

  it("(b) atomicCommit proceeds when the file is unchanged since plan", () => {
    const p = join(dir, "b.et");
    writeFileSync(p, "one\n");
    const edit = planFileEdit(p, /one/g, () => "two")!;
    const r = atomicCommit([edit], { force: true });
    expect(r.edits).toHaveLength(1);
    expect(readFileSync(p, "utf-8")).toBe("two\n");
  });

  it("(d) journal anchors at the .gproj dir when no .git/.emcp ancestor exists", () => {
    const addon = join(dir, "Addon");
    mkdirSync(join(addon, "Prefabs", "Deep"), { recursive: true });
    writeFileSync(join(addon, "addon.gproj"), "GameProject {\n}\n");
    const p = join(addon, "Prefabs", "Deep", "x.et");
    writeFileSync(p, "one\n");

    // Hold the journal in place by making the rename fail? Simpler: verify
    // the journal dir location by observing what a successful commit leaves
    // behind — `.emcp/journals/` is created under the anchor.
    atomicCommit([{ filePath: p, newContent: "two\n" }], { force: true, keepBackup: false });
    expect(existsSync(join(addon, ".emcp", "journals"))).toBe(true);
    // And NOT under the deeper common-ancestor dir.
    expect(existsSync(join(addon, "Prefabs", "Deep", ".emcp"))).toBe(false);
    expect(readdirSync(join(addon, ".emcp", "journals"))).toEqual([]);
  });
});
