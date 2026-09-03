import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeGuid,
  replaceGuidInContent,
  buildPlan,
  formatPlan,
  findCandidateFiles,
} from "../../src/tools/refactor-replace-guid.ts";
import { openProjectIndex } from "../../src/project-index/migrate.ts";
import { ProjectIndex } from "../../src/project-index/project-index.ts";

describe("normalizeGuid", () => {
  it("strips braces", () => {
    expect(normalizeGuid("{aabb1122ccdd3344}")).toBe("AABB1122CCDD3344");
  });
  it("uppercases", () => {
    expect(normalizeGuid("aabb1122ccdd3344")).toBe("AABB1122CCDD3344");
  });
  it("rejects too-short", () => {
    expect(() => normalizeGuid("AABB1122")).toThrow(/16 hex/);
  });
  it("rejects non-hex", () => {
    expect(() => normalizeGuid("Z1234567890ABCDE")).toThrow(/16 hex/);
  });
});

describe("replaceGuidInContent", () => {
  it("replaces braced references", () => {
    const content = `Parent "{ABCD000000000001}prefabs/base.et"`;
    const { newContent, matches } = replaceGuidInContent(
      content,
      "ABCD000000000001",
      "EFEF000000000001",
    );
    expect(matches).toBe(1);
    expect(newContent).toBe(`Parent "{EFEF000000000001}prefabs/base.et"`);
  });

  it("replaces bare references (Dependencies block style)", () => {
    const content = `Dependencies {\n "ABCD000000000001"\n}`;
    const { matches } = replaceGuidInContent(
      content,
      "ABCD000000000001",
      "EFEF000000000001",
    );
    expect(matches).toBe(1);
  });

  it("matches case-insensitively but emits uppercase", () => {
    const content = `GUID "abcd000000000001"`;
    const { newContent, matches } = replaceGuidInContent(
      content,
      "ABCD000000000001",
      "EFEF000000000001",
    );
    expect(matches).toBe(1);
    expect(newContent).toContain("EFEF000000000001");
  });

  it("does not match a longer hex token that contains the GUID as a prefix", () => {
    // 17-hex string starting with our GUID
    const content = `value "ABCD000000000001A"`;
    const { matches } = replaceGuidInContent(content, "ABCD000000000001", "X");
    expect(matches).toBe(0);
  });

  it("returns 0 matches when GUID is absent", () => {
    const { matches } = replaceGuidInContent(
      "no guids here",
      "ABCD000000000001",
      "EFEF000000000001",
    );
    expect(matches).toBe(0);
  });
});

describe("buildPlan + formatPlan", () => {
  it("flags collision when new_guid already exists", () => {
    const db = openProjectIndex(":memory:");
    try {
      const now = Date.now();
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
      ).run("P", "1111111111111111", "P", "/x", "user", now);
      db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
      ).run("AAAA000000000001", "a.et", "GenericEntity", null, null, "user", "P", now);
      db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
      ).run("BBBB000000000001", "b.et", "GenericEntity", null, null, "user", "P", now);
      const idx = new ProjectIndex(db);
      const plan = buildPlan(db, idx, "AAAA000000000001", "BBBB000000000001");
      expect(plan.collision).toBe(true);
      expect(plan.collisionFile).toBe("b.et");
      const text = formatPlan(plan, "dry-run");
      expect(text).toContain("COLLISION");
    } finally {
      db.close();
    }
  });

  it("treats old == new as no-op", () => {
    const db = openProjectIndex(":memory:");
    try {
      const idx = new ProjectIndex(db);
      const plan = buildPlan(db, idx, "AAAA000000000001", "AAAA000000000001");
      expect(plan.files).toEqual([]);
      const text = formatPlan(plan, "dry-run");
      expect(text).toContain("no-op");
    } finally {
      db.close();
    }
  });

  it("reports empty plan when GUID has no indexed references", () => {
    const db = openProjectIndex(":memory:");
    try {
      const idx = new ProjectIndex(db);
      const plan = buildPlan(db, idx, "AAAA000000000001", "BBBB000000000001");
      expect(plan.files).toEqual([]);
      expect(plan.collision).toBe(false);
      const text = formatPlan(plan, "dry-run");
      expect(text).toContain("no matches");
    } finally {
      db.close();
    }
  });
});

// RBE-1 regression: on a multi-project install, resolveAbsPath must resolve a
// resource's relative file_path against ITS OWN project's root_path (via the
// project_id FK) — not the first project's root. The pre-fix code returned the
// first project unconditionally, so on two projects sharing a file_path the
// GUID was read/edited from the WRONG project (silent no-op or worse).
describe("buildPlan multi-project path resolution (RBE-1)", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("resolves each candidate against its own project root", () => {
    // Two real on-disk project roots, each with a same-named relative file but
    // different content. Only project B's file contains the target GUID.
    const baseDir = mkdtempSync(join(tmpdir(), "rbe1-"));
    cleanups.push(() => rmSync(baseDir, { recursive: true, force: true }));
    const rootA = join(baseDir, "ProjA");
    const rootB = join(baseDir, "ProjB");
    mkdirSync(join(rootA, "prefabs"), { recursive: true });
    mkdirSync(join(rootB, "prefabs"), { recursive: true });

    const targetGuid = "DEAD000000000001";
    const newGuid = "BEEF000000000001";
    // Project A's same-path file does NOT contain the GUID.
    writeFileSync(
      join(rootA, "prefabs", "thing.et"),
      `GenericEntity {\n ID "AAAA000000000099"\n}\n`,
      "utf-8",
    );
    // Project B's file DOES contain the GUID (as its own ID).
    writeFileSync(
      join(rootB, "prefabs", "thing.et"),
      `GenericEntity {\n ID "${targetGuid}"\n}\n`,
      "utf-8",
    );

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());
    const now = Date.now();
    // Insert ProjA FIRST so the buggy "first project" path would pick rootA.
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("ProjA", "1111111111111111", "ProjA", rootA, "user", now);
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("ProjB", "2222222222222222", "ProjB", rootB, "user", now);
    // The target resource is owned by ProjB.
    db.prepare(
      "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
    ).run(targetGuid, "prefabs/thing.et", "GenericEntity", null, null, "user", "ProjB", now);

    const idx = new ProjectIndex(db);
    const plan = buildPlan(db, idx, targetGuid, newGuid);

    // The plan must touch exactly one file — and it must be ProjB's copy,
    // where the GUID actually lives. The pre-fix code resolved to rootA
    // (first project) → readFileSync of ProjA's file → 0 matches → empty plan.
    expect(plan.files.length).toBe(1);
    expect(plan.files[0].absPath).toBe(join(rootB, "prefabs", "thing.et"));
    expect(plan.totalMatches).toBe(1);
  });
});

// C2 (schema v3) + M14: candidates carry their owning project, so the same
// relative path referenced from two addons is edited in BOTH (against each
// addon's own root); workshop/core-owned candidates are skipped unless
// explicitly allowed (workshop) or always (core).
describe("buildPlan cross-project candidates + M14 source gating", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  function setup(): { db: ReturnType<typeof openProjectIndex>; roots: Record<string, string> } {
    const baseDir = mkdtempSync(join(tmpdir(), "rg-v3-"));
    cleanups.push(() => rmSync(baseDir, { recursive: true, force: true }));
    const roots = {
      UserA: join(baseDir, "UserA"),
      UserB: join(baseDir, "UserB"),
      Shop: join(baseDir, "Shop"),
      Core: join(baseDir, "Core"),
    };
    const target = "DEAD000000000001";
    for (const r of Object.values(roots)) {
      mkdirSync(join(r, "Prefabs"), { recursive: true });
      writeFileSync(
        join(r, "Prefabs", "Foo.et"),
        `GenericEntity : "{${target}}Prefabs/Base.et" {\n ID "AAAA000000000099"\n}\n`,
        "utf-8",
      );
    }
    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());
    const now = Date.now();
    const ins = db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    );
    ins.run("UserA", "1111111111111111", "UserA", roots.UserA, "user", now);
    ins.run("UserB", "2222222222222222", "UserB", roots.UserB, "user", now);
    ins.run("Shop", "3333333333333333", "Shop", roots.Shop, "workshop", now);
    ins.run("Core", "4444444444444444", "Core", roots.Core, "core", now);
    const insRef = db.prepare(
      "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?,?,?,?,?)",
    );
    for (const id of ["UserA", "UserB", "Shop", "Core"]) {
      insRef.run(id, "Prefabs/Foo.et", target, "inheritance", "GenericEntity");
    }
    return { db, roots };
  }

  it("findCandidateFiles returns one candidate per owning project for the same relPath", () => {
    const { db } = setup();
    const cands = findCandidateFiles(db, "DEAD000000000001");
    expect(cands.map((c) => c.projectId)).toEqual(["Core", "Shop", "UserA", "UserB"]);
    expect(new Set(cands.map((c) => c.relPath))).toEqual(new Set(["Prefabs/Foo.et"]));
  });

  it("edits both user copies, skips workshop + core by default", () => {
    const { db, roots } = setup();
    const plan = buildPlan(db, new ProjectIndex(db), "DEAD000000000001", "BEEF000000000001");
    expect(plan.files.map((f) => f.projectId).sort()).toEqual(["UserA", "UserB"]);
    expect(plan.files.map((f) => f.absPath).sort()).toEqual(
      [join(roots.UserA, "Prefabs", "Foo.et"), join(roots.UserB, "Prefabs", "Foo.et")].sort(),
    );
    expect(plan.totalMatches).toBe(2);
    expect(plan.skipped.map((s) => s.projectId).sort()).toEqual(["Core", "Shop"]);
    // Plan pins each file to its stat snapshot (M15 TOCTOU).
    for (const f of plan.files) {
      expect(f.mtimeMs).toBeGreaterThan(0);
      expect(f.size).toBeGreaterThan(0);
    }
    const text = formatPlan(plan, "dry-run");
    expect(text).toContain("[UserA]");
    expect(text).toContain("Skipped 2 candidate files");
    expect(text).toContain("include_workshop");
  });

  it("include_workshop admits workshop files but never core", () => {
    const { db } = setup();
    const plan = buildPlan(db, new ProjectIndex(db), "DEAD000000000001", "BEEF000000000001", {
      includeWorkshop: true,
    });
    expect(plan.files.map((f) => f.projectId).sort()).toEqual(["Shop", "UserA", "UserB"]);
    expect(plan.skipped.map((s) => s.projectId)).toEqual(["Core"]);
    expect(plan.skipped[0].reason).toMatch(/core/);
  });
});
