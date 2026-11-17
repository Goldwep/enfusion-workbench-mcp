import { describe, it, expect, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
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
  registerRefactorReplaceGuid,
} from "../../src/tools/refactor-replace-guid.js";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

// Failure injection for renameSync: the hook sees (from, to) and may throw.
const fsHook = vi.hoisted(() => ({ onRename: undefined as undefined | ((from: string, to: string) => void) }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      fsHook.onRename?.(from, to);
      return actual.renameSync(from, to);
    },
  };
});

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

// W11 run 3 (EV-W11-052): a resource whose GUID lives only in its `.meta`
// sidecar (.physmat is never scanned, so the index has no row) had its
// references rewritten and the .meta left on the old GUID.
describe("refactor_replace_guid: .meta-owned resources", () => {
  const OLD = "F90E31BF7B1F3FAB";
  const NEW = "3073AED9ACC1FBDC";
  const MAT = "Materials/W11_parent.physmat";
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    fsHook.onRename = undefined;
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  const metaText = (guid: string): string =>
    `MetaFileClass {\n Name "{${guid}}${MAT}"\n Configurations {\n  PhysMatResourceClass PC {\n  }\n }\n}\n`;
  const confText = (guid: string): string => `W11_RefProbe {\n Material "{${guid}}${MAT}"\n}\n`;
  const etText = (guid: string): string =>
    `GenericEntity {\n ID "AAAA000000000099"\n components {\n  RigidBody "{BBBB000000000001}" {\n   Material "{${guid}}${MAT}"\n  }\n }\n}\n`;

  function seed(o: { meta: boolean }) {
    const base = mkdtempSync(join(tmpdir(), "rg-meta-"));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    const root = join(base, "Addon");
    mkdirSync(join(root, "Materials"), { recursive: true });
    mkdirSync(join(root, "Configs"), { recursive: true });
    mkdirSync(join(root, "Prefabs"), { recursive: true });
    writeFileSync(join(root, MAT), "PhysicsMaterial {\n Friction 0.5\n}\n", "utf-8");
    if (o.meta) writeFileSync(join(root, `${MAT}.meta`), metaText(OLD), "utf-8");
    writeFileSync(join(root, "Configs", "ref.conf"), confText(OLD), "utf-8");
    writeFileSync(join(root, "Prefabs", "ref.et"), etText(OLD), "utf-8");
    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("Addon", "1111111111111111", "Addon", root, "user", now);
    const insRef = db.prepare(
      "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?,?,?,?,?)",
    );
    insRef.run("Addon", "Configs/ref.conf", OLD, "asset_path", "Material");
    insRef.run("Addon", "Prefabs/ref.et", OLD, "asset_path", "Material");
    const index = new ProjectIndex(db);
    const tool = captureTool((s) => registerRefactorReplaceGuid(s, db, index, makeConfig({ projectPath: root })));
    const read = (rel: string): string => readFileSync(join(root, rel), "utf-8");
    return { root, base, db, index, tool, read };
  }

  it("plans the owner's .meta beside the .conf and .et references (index has no row)", () => {
    const { db, index, root } = seed({ meta: true });
    const plan = buildPlan(db, index, OLD, NEW);
    expect(plan.files.map((f) => f.relPath).sort()).toEqual(
      ["Configs/ref.conf", `${MAT}.meta`, "Prefabs/ref.et"].sort(),
    );
    expect(plan.ownerFiles).toEqual([`${MAT}.meta`]);
    expect(plan.files.find((f) => f.relPath.endsWith(".meta"))!.absPath).toBe(join(root, `${MAT}.meta`));
    const text = formatPlan(plan, "dry-run");
    expect(text).toContain(`Owner (the resource's own GUID): ${MAT}.meta`);
    expect(text).not.toContain("OWNER NOT FOUND");
  });

  it("finds the .meta by walking the root when no reference names its path", () => {
    const { db, index, root } = seed({ meta: true });
    // Bare-GUID references only: no `{GUID}path` to derive the sidecar from.
    writeFileSync(join(root, "Configs", "ref.conf"), `W11_RefProbe {\n Ref "${OLD}"\n}\n`, "utf-8");
    writeFileSync(join(root, "Prefabs", "ref.et"), `GenericEntity {\n Ref "${OLD}"\n}\n`, "utf-8");
    const plan = buildPlan(db, index, OLD, NEW);
    expect(plan.ownerFiles).toEqual([`${MAT}.meta`]);
  });

  it("commit rewrites the .conf, the .et and the .meta, with .bak sidecars", async () => {
    const { tool, read, root } = seed({ meta: true });
    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true });
    expect(r.isError).toBeFalsy();
    expect(read("Configs/ref.conf")).toBe(confText(NEW));
    expect(read("Prefabs/ref.et")).toBe(etText(NEW));
    expect(read(`${MAT}.meta`)).toBe(metaText(NEW));
    expect(existsSync(join(root, `${MAT}.meta.bak`))).toBe(true);
    expect(readFileSync(join(root, `${MAT}.meta.bak`), "utf-8")).toBe(metaText(OLD));
  });

  it("a commit that cannot run (old == new) answers isError and writes nothing (refactor-index-09)", async () => {
    const { tool, read } = seed({ meta: true });
    const r = await tool({ old_guid: OLD, new_guid: OLD, commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/REFUSED: nothing was rewritten/);
    expect(read("Configs/ref.conf")).toBe(confText(OLD));
    const dry = await tool({ old_guid: OLD, new_guid: OLD });
    expect(dry.isError).toBeFalsy();
  });

  it("a failed .meta write rolls the .conf and .et back", async () => {
    const { tool, read } = seed({ meta: true });
    fsHook.onRename = (from) => {
      if (from.includes(".meta.tmp.")) throw new Error("EPERM: simulated meta lock");
    };
    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true });
    fsHook.onRename = undefined;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/simulated meta lock/);
    expect(read("Configs/ref.conf")).toBe(confText(OLD));
    expect(read("Prefabs/ref.et")).toBe(etText(OLD));
    expect(read(`${MAT}.meta`)).toBe(metaText(OLD));
  });

  it("no owner anywhere: the dry run says so, a commit refuses with isError and writes nothing", async () => {
    const { tool, read } = seed({ meta: false });
    const dry = await tool({ old_guid: OLD, new_guid: NEW });
    expect(dry.isError).toBeFalsy();
    expect(textOf(dry)).toContain("OWNER NOT FOUND");
    expect(textOf(dry)).toContain("references_only");
    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/refusing to commit\. No resource owning \{F90E31BF7B1F3FAB\} was found/);
    expect(read("Configs/ref.conf")).toBe(confText(OLD));
    expect(read("Prefabs/ref.et")).toBe(etText(OLD));
  });

  it("references_only: true rewrites the references without an owner", async () => {
    const { tool, read } = seed({ meta: false });
    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true, references_only: true });
    expect(r.isError).toBeFalsy();
    expect(read("Configs/ref.conf")).toBe(confText(NEW));
    expect(read("Prefabs/ref.et")).toBe(etText(NEW));
  });

  it("an owner in a workshop project without include_workshop is reported and refused", async () => {
    // References in the user addon; the owner (resource + .meta) in a workshop addon.
    const { db, index, tool, read, base } = seed({ meta: false });
    const shop = join(base, "Shop");
    mkdirSync(join(shop, "Materials"), { recursive: true });
    writeFileSync(join(shop, MAT), "PhysicsMaterial {\n}\n", "utf-8");
    writeFileSync(join(shop, `${MAT}.meta`), metaText(OLD), "utf-8");
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("Shop", "2222222222222222", "Shop", shop, "workshop", Date.now());
    const plan = buildPlan(db, index, OLD, NEW);
    expect(plan.ownerFiles).toEqual([]);
    expect(plan.ownerSkipped.map((s) => `${s.projectId}:${s.relPath}`)).toEqual([`Shop:${MAT}.meta`]);
    expect(formatPlan(plan, "dry-run")).toMatch(/was found but cannot be edited/);
    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(read("Configs/ref.conf")).toBe(confText(OLD));
    // include_workshop admits the owner: the commit goes through.
    const ok = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true, include_workshop: true });
    expect(ok.isError).toBeFalsy();
    expect(readFileSync(join(shop, `${MAT}.meta`), "utf-8")).toBe(metaText(NEW));
    expect(read("Configs/ref.conf")).toBe(confText(NEW));
  });

  // W11 run 4: the .physmat child that inherits from the parent is never
  // scanned by the index, so it kept the old GUID.
  const childText = (guid: string): string =>
    `PhysicsMaterial : "{${guid}}${MAT}" {\n Friction 0.9\n Note "${OLD.slice(0, 4)}"\n}\n`;

  it("plans and rewrites an unindexed .physmat child; binaries and .bak sidecars are left alone", async () => {
    const { root, db, index, tool, read } = seed({ meta: true });
    writeFileSync(join(root, "Materials", "W11_child.physmat"), childText(OLD), "utf-8");
    // A binary holding the braced hex, and a .bak sidecar naming it: never touched.
    const bin = Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(`{${OLD}}`, "utf-8"), Buffer.from([0])]);
    writeFileSync(join(root, "Materials", "blob.dat"), bin);
    writeFileSync(join(root, "Materials", "tex.edds"), Buffer.from(`{${OLD}}`, "utf-8"));
    writeFileSync(join(root, "Configs", "old.conf.bak"), confText(OLD), "utf-8");

    const plan = buildPlan(db, index, OLD, NEW);
    const child = plan.files.find((f) => f.relPath === "Materials/W11_child.physmat");
    expect(child).toBeDefined();
    expect(child!.unindexed).toBe(true);
    expect(plan.files.map((f) => f.relPath)).not.toContain("Materials/blob.dat");
    expect(plan.files.map((f) => f.relPath)).not.toContain("Materials/tex.edds");
    expect(plan.files.map((f) => f.relPath)).not.toContain("Configs/old.conf.bak");
    expect(formatPlan(plan, "dry-run")).toContain("Materials/W11_child.physmat [Addon] (1 match) (unindexed reference)");

    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true });
    expect(r.isError).toBeFalsy();
    expect(read("Materials/W11_child.physmat")).toBe(childText(NEW));
    expect(read(`${MAT}.meta`)).toBe(metaText(NEW));
    expect(readFileSync(join(root, "Materials", "blob.dat")).equals(bin)).toBe(true);
    expect(read("Materials/tex.edds")).toBe(`{${OLD}}`);
    expect(read("Configs/old.conf.bak")).toBe(confText(OLD));
  });

  it("an unindexed file is rewritten only at braced spans, never at a bare hex run", () => {
    const { root, db, index } = seed({ meta: true });
    writeFileSync(
      join(root, "Materials", "mixed.physmat"),
      `PhysicsMaterial : "{${OLD}}${MAT}" {\n Comment "${OLD}"\n}\n`,
      "utf-8",
    );
    const plan = buildPlan(db, index, OLD, NEW);
    const f = plan.files.find((x) => x.relPath === "Materials/mixed.physmat")!;
    expect(f.matches).toBe(1);
    expect(f.newContent).toBe(`PhysicsMaterial : "{${NEW}}${MAT}" {\n Comment "${OLD}"\n}\n`);
  });

  it("unindexed files in a workshop project are not touched without include_workshop", () => {
    const { root, db, index } = seed({ meta: true });
    writeFileSync(join(root, "Materials", "W11_child.physmat"), childText(OLD), "utf-8");
    db.prepare("UPDATE projects SET source = 'workshop'").run();
    const plan = buildPlan(db, index, OLD, NEW);
    expect(plan.files).toEqual([]);
  });

  it("a failed child write rolls the .meta and the references back", async () => {
    const { root, tool, read } = seed({ meta: true });
    writeFileSync(join(root, "Materials", "W11_child.physmat"), childText(OLD), "utf-8");
    fsHook.onRename = (from) => {
      if (from.includes("W11_child.physmat.tmp.")) throw new Error("EPERM: simulated child lock");
    };
    const r = await tool({ old_guid: OLD, new_guid: NEW, commit: true, force: true });
    fsHook.onRename = undefined;
    expect(r.isError).toBe(true);
    expect(read("Materials/W11_child.physmat")).toBe(childText(OLD));
    expect(read(`${MAT}.meta`)).toBe(metaText(OLD));
    expect(read("Configs/ref.conf")).toBe(confText(OLD));
  });
});
