import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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

import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import { registerRefactorMoveResourcePath } from "../../src/tools/refactor-move-resource-path.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

describe("refactor_move_resource_path", () => {
  let base: string;
  let root: string;
  let outside: string;
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "moveres-"));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(join(root, "prefabs"), { recursive: true });
    mkdirSync(outside, { recursive: true });
  });
  afterEach(() => {
    fsHook.onRename = undefined;
    while (cleanups.length > 0) cleanups.pop()?.();
    rmSync(base, { recursive: true, force: true });
  });

  function makeTool() {
    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());
    const index = new ProjectIndex(db);
    const tool = captureTool((s) =>
      registerRefactorMoveResourcePath(s, db, index, makeConfig({ projectPath: root })),
    );
    return { db, tool };
  }

  it("refuses a project_root outside every configured root (H7)", async () => {
    const { tool } = makeTool();
    writeFileSync(join(outside, "a.et"), "GenericEntity {\n}\n", "utf-8");
    const r = await tool({ project_root: outside, old_path: "a.et", new_path: "b.et", commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/project_root resolves outside every configured root/);
    expect(existsSync(join(outside, "a.et"))).toBe(true);
    expect(existsSync(join(outside, "b.et"))).toBe(false);
  });

  it("refuses a new_path that escapes project_root (H7)", async () => {
    const { tool } = makeTool();
    writeFileSync(join(root, "prefabs", "a.et"), "GenericEntity {\n}\n", "utf-8");
    const r = await tool({
      project_root: root,
      old_path: "prefabs/a.et",
      new_path: "../outside/a.et",
      commit: true,
      force: true,
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/new_path resolves outside project root/);
    expect(existsSync(join(root, "prefabs", "a.et"))).toBe(true);
    expect(existsSync(join(outside, "a.et"))).toBe(false);
  });

  it("renames first, then commits refs; a failed ref commit undoes the rename (M11 / RBE-5)", async () => {
    const { db, tool } = makeTool();
    const guid = "ABCD000000000001";
    const oldRel = "prefabs/a.et";
    const newRel = "prefabs/sub/b.et";
    const oldAbs = join(root, "prefabs", "a.et");
    const refAbs = join(root, "prefabs", "consumer.et");
    writeFileSync(oldAbs, `GenericEntity {\n ID "${guid}"\n}\n`, "utf-8");
    const refOriginal = `GenericEntity : "{${guid}}${oldRel}" {\n}\n`;
    writeFileSync(refAbs, refOriginal, "utf-8");

    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("Root", "AAAA111111111111", "Root", root, "user", now);
    db.prepare(
      "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
    ).run(guid, oldRel, "GenericEntity", null, null, "user", "Root", now);
    const refCols = (db.prepare("PRAGMA table_info(resource_refs)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (refCols.includes("project_id")) {
      db.prepare(
        "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?,?,?,?,?)",
      ).run("Root", "prefabs/consumer.et", guid, "inheritance", "");
    } else {
      db.prepare(
        "INSERT INTO resource_refs (source_file, target_guid, ref_kind, context) VALUES (?,?,?,?)",
      ).run("prefabs/consumer.et", guid, "inheritance", "");
    }

    // Dry-run: nothing moves.
    const dry = await tool({ project_root: root, old_path: oldRel, new_path: newRel, commit: false, force: true });
    expect(dry.isError).toBeUndefined();
    expect(existsSync(oldAbs)).toBe(true);

    // Make the ref file unwritable so the ref commit fails AFTER the rename.
    chmodSync(refAbs, 0o444);
    let failed: ReturnType<typeof tool> extends Promise<infer R> ? R : never;
    try {
      failed = await tool({ project_root: root, old_path: oldRel, new_path: newRel, commit: true, force: true });
    } finally {
      chmodSync(refAbs, 0o644);
    }
    if (failed.isError) {
      // Ref commit threw → rename must have been undone, refs untouched.
      expect(existsSync(oldAbs)).toBe(true);
      expect(existsSync(join(root, "prefabs", "sub", "b.et"))).toBe(false);
      expect(readFileSync(refAbs, "utf-8")).toBe(refOriginal);
    }
    // (If chmod didn't make the file unwritable on this platform, the
    // commit simply succeeded — verified by the happy path below.)

    // Happy path.
    if (!failed.isError) {
      expect(existsSync(join(root, "prefabs", "sub", "b.et"))).toBe(true);
      expect(readFileSync(refAbs, "utf-8")).toContain(`{${guid}}${newRel}`);
      return;
    }
    const ok = await tool({ project_root: root, old_path: oldRel, new_path: newRel, commit: true, force: true });
    expect(ok.isError).toBeUndefined();
    expect(existsSync(oldAbs)).toBe(false);
    expect(existsSync(join(root, "prefabs", "sub", "b.et"))).toBe(true);
    expect(readFileSync(refAbs, "utf-8")).toContain(`{${guid}}${newRel}`);
  });

  // ── .meta sidecar ──────────────────────────────────────────────────────────

  const GUID = "ABCD000000000002";
  const OLD_REL = "prefabs/a.et";
  const NEW_REL = "prefabs/sub/b.et";
  // Shape of a real sidecar (top-level Name line, per-platform Configurations).
  const metaFor = (rel: string): string =>
    `MetaFileClass {\n Name "{${GUID}}${rel}"\n Configurations {\n  EntityTemplateResourceClass PC {\n  }\n  EntityTemplateResourceClass XBOX_ONE : PC {\n  }\n }\n}`;

  /** Seed project A: one indexed resource, one referencing file, optional sidecar. */
  function seed(opts: { sidecar: boolean }) {
    const ctx = makeTool();
    const oldAbs = join(root, "prefabs", "a.et");
    const refAbs = join(root, "prefabs", "consumer.et");
    writeFileSync(oldAbs, `GenericEntity {\n ID "${GUID}"\n}\n`, "utf-8");
    if (opts.sidecar) writeFileSync(`${oldAbs}.meta`, metaFor(OLD_REL), "utf-8");
    const refOriginal = `GenericEntity : "{${GUID}}${OLD_REL}" {\n}\n`;
    writeFileSync(refAbs, refOriginal, "utf-8");
    const now = Date.now();
    ctx.db
      .prepare("INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)")
      .run("Root", "AAAA111111111111", "Root", root, "user", now);
    ctx.db
      .prepare(
        "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(GUID, OLD_REL, "GenericEntity", null, null, "user", "Root", now);
    ctx.db
      .prepare(
        "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?,?,?,?,?)",
      )
      .run("Root", "prefabs/consumer.et", GUID, "inheritance", "");
    return {
      ...ctx,
      oldAbs,
      refAbs,
      refOriginal,
      newAbs: join(root, "prefabs", "sub", "b.et"),
      move: (commit: boolean) =>
        ctx.tool({ project_root: root, old_path: OLD_REL, new_path: NEW_REL, commit, force: true }),
    };
  }

  it("moves the sidecar with the resource and rewrites its Name line", async () => {
    const s = seed({ sidecar: true });
    const r = await s.move(true);
    expect(r.isError).toBeUndefined();
    expect(existsSync(s.oldAbs)).toBe(false);
    expect(existsSync(`${s.oldAbs}.meta`)).toBe(false);
    expect(existsSync(s.newAbs)).toBe(true);
    // GUID and every other line survive; only the path in Name changes.
    expect(readFileSync(`${s.newAbs}.meta`, "utf-8")).toBe(metaFor(NEW_REL));
    expect(readFileSync(s.refAbs, "utf-8")).toContain(`{${GUID}}${NEW_REL}`);
    expect(textOf(r)).toContain(`${NEW_REL}.meta`);
  });

  it("rewrites a text file the index never parsed that names {GUID}<oldPath> (audit refactor-index-07)", async () => {
    const s = seed({ sidecar: true });
    mkdirSync(join(root, "Materials"), { recursive: true });
    const physmat = join(root, "Materials", "x.physmat");
    writeFileSync(physmat, `PhysicsMaterial {\n Parent "{${GUID}}${OLD_REL}"\n}\n`, "utf-8");
    const dry = await s.move(false);
    expect(textOf(dry)).toContain("Materials/x.physmat");
    const r = await s.move(true);
    expect(r.isError).toBeUndefined();
    expect(readFileSync(physmat, "utf-8")).toContain(`{${GUID}}${NEW_REL}`);
    expect(readFileSync(s.refAbs, "utf-8")).toContain(`{${GUID}}${NEW_REL}`);
  });

  it("moves a resource that has no sidecar and creates none", async () => {
    const s = seed({ sidecar: false });
    const r = await s.move(true);
    expect(r.isError).toBeUndefined();
    expect(existsSync(s.newAbs)).toBe(true);
    expect(existsSync(`${s.newAbs}.meta`)).toBe(false);
    expect(textOf(r)).toMatch(/no \.meta sidecar/);
  });

  it("moves a sidecar whose Name line does not match the old path unchanged", async () => {
    const s = seed({ sidecar: true });
    const odd = metaFor("somewhere/else.et");
    writeFileSync(`${s.oldAbs}.meta`, odd, "utf-8");
    const r = await s.move(true);
    expect(r.isError).toBeUndefined();
    expect(readFileSync(`${s.newAbs}.meta`, "utf-8")).toBe(odd);
    expect(textOf(r)).toMatch(/moves unchanged/);
  });

  it("moves a sidecar that is not valid UTF-8 byte for byte, without a Name rewrite", async () => {
    const s = seed({ sidecar: true });
    // A Windows-1252 byte (0xE9) after an otherwise matching Name line.
    const raw = Buffer.concat([Buffer.from(metaFor(OLD_REL), "utf-8"), Buffer.from([0x0a, 0xe9])]);
    writeFileSync(`${s.oldAbs}.meta`, raw);
    const r = await s.move(true);
    expect(r.isError).toBeUndefined();
    expect(readFileSync(`${s.newAbs}.meta`).equals(raw)).toBe(true);
  });

  it("refuses when the destination sidecar already exists, touching nothing", async () => {
    const s = seed({ sidecar: true });
    mkdirSync(join(root, "prefabs", "sub"), { recursive: true });
    writeFileSync(`${s.newAbs}.meta`, "stale", "utf-8");
    const r = await s.move(true);
    expect(textOf(r)).toMatch(/Destination sidecar already exists/);
    expect(existsSync(s.oldAbs)).toBe(true);
    expect(readFileSync(`${s.oldAbs}.meta`, "utf-8")).toBe(metaFor(OLD_REL));
    expect(existsSync(s.newAbs)).toBe(false);
    expect(readFileSync(`${s.newAbs}.meta`, "utf-8")).toBe("stale");
    expect(readFileSync(s.refAbs, "utf-8")).toBe(s.refOriginal);
  });

  it("dry run lists both files and writes nothing", async () => {
    const s = seed({ sidecar: true });
    const r = await s.move(false);
    const text = textOf(r);
    expect(text).toContain(`${OLD_REL} -> ${NEW_REL}`);
    expect(text).toContain(`${OLD_REL}.meta -> ${NEW_REL}.meta`);
    expect(text).toMatch(/DRY-RUN/);
    expect(existsSync(s.oldAbs)).toBe(true);
    expect(readFileSync(`${s.oldAbs}.meta`, "utf-8")).toBe(metaFor(OLD_REL));
    expect(existsSync(s.newAbs)).toBe(false);
    expect(existsSync(`${s.newAbs}.meta`)).toBe(false);
    expect(readFileSync(s.refAbs, "utf-8")).toBe(s.refOriginal);
  });

  it("a failed sidecar rename after the file rename leaves no half-moved pair", async () => {
    const s = seed({ sidecar: true });
    fsHook.onRename = (from) => {
      if (from.endsWith("a.et.meta")) throw new Error("EPERM: simulated sidecar lock");
    };
    const r = await s.move(true);
    fsHook.onRename = undefined;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/simulated sidecar lock/);
    expect(existsSync(s.oldAbs)).toBe(true);
    expect(readFileSync(`${s.oldAbs}.meta`, "utf-8")).toBe(metaFor(OLD_REL));
    expect(existsSync(s.newAbs)).toBe(false);
    expect(existsSync(`${s.newAbs}.meta`)).toBe(false);
    expect(readFileSync(s.refAbs, "utf-8")).toBe(s.refOriginal);
  });

  it("a failed ref commit after both renames puts file, sidecar and Name line back", async () => {
    const s = seed({ sidecar: true });
    // atomicCommit swaps staged `<ref>.tmp.<uuid>` files in with renameSync.
    // By then the sidecar must already be moved and renamed, or the rollback
    // below has nothing to prove.
    let metaAtFailure: string | undefined;
    fsHook.onRename = (from) => {
      if (from.includes(".tmp.")) {
        metaAtFailure = readFileSync(`${s.newAbs}.meta`, "utf-8");
        throw new Error("EPERM: simulated ref swap failure");
      }
    };
    const r = await s.move(true);
    fsHook.onRename = undefined;
    expect(metaAtFailure).toBe(metaFor(NEW_REL));
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/simulated ref swap failure/);
    expect(existsSync(s.oldAbs)).toBe(true);
    expect(readFileSync(`${s.oldAbs}.meta`, "utf-8")).toBe(metaFor(OLD_REL));
    expect(existsSync(s.newAbs)).toBe(false);
    expect(existsSync(`${s.newAbs}.meta`)).toBe(false);
    expect(readFileSync(s.refAbs, "utf-8")).toBe(s.refOriginal);
  });

  // ── refactor-index-10 ──────────────────────────────────────────────────────

  it("keeps the sidecar's original bytes as a backup beside it when the Name line is rewritten", async () => {
    const s = seed({ sidecar: true });
    const r = await s.move(true);
    expect(r.isError).toBeUndefined();
    expect(readFileSync(`${s.newAbs}.meta.bak`, "utf-8")).toBe(metaFor(OLD_REL));
    expect(textOf(r)).toMatch(/Sidecar backup \(before the Name rewrite\): .*b\.et\.meta\.bak/);
  });

  it("a failed ref commit also removes the sidecar backup it made", async () => {
    const s = seed({ sidecar: true });
    fsHook.onRename = (from) => {
      if (from.includes(".tmp.")) throw new Error("EPERM: simulated ref swap failure");
    };
    const r = await s.move(true);
    fsHook.onRename = undefined;
    expect(r.isError).toBe(true);
    expect(existsSync(`${s.newAbs}.meta.bak`)).toBe(false);
  });

  it("refuses a ref file that changed between the plan and the commit (M15 stamps)", async () => {
    const s = seed({ sidecar: true });
    // The file rename is the first commit step; a write to the ref file lands after the plan.
    fsHook.onRename = (from) => {
      if (from === s.oldAbs) writeFileSync(s.refAbs, `${s.refOriginal}// edited meanwhile\n`, "utf-8");
    };
    const r = await s.move(true);
    fsHook.onRename = undefined;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/file changed since plan/);
    expect(existsSync(s.oldAbs)).toBe(true);
    expect(existsSync(s.newAbs)).toBe(false);
    expect(readFileSync(s.refAbs, "utf-8")).toBe(`${s.refOriginal}// edited meanwhile\n`);
  });

  it("refuses a resource with uncommitted git changes and no referrers unless force (git-clean covers the moved files)", async () => {
    const { tool } = makeTool();
    try {
      execFileSync("git", ["init", "-q", root], { stdio: "ignore" });
    } catch {
      return; // no git binary: the check proceeds by design (byte-edit no-git-binary)
    }
    const oldAbs = join(root, "prefabs", "lonely.et");
    writeFileSync(oldAbs, "GenericEntity {\n}\n", "utf-8");
    writeFileSync(`${oldAbs}.meta`, `MetaFileClass {\n Name "{${GUID}}prefabs/lonely.et"\n}`, "utf-8");
    const args = { project_root: root, old_path: "prefabs/lonely.et", new_path: "prefabs/moved.et", commit: true };
    const refused = await tool({ ...args, force: false });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/REFUSED: nothing was moved.*Uncommitted git changes/s);
    expect(existsSync(oldAbs)).toBe(true);
    expect(existsSync(join(root, "prefabs", "moved.et"))).toBe(false);
    const forced = await tool({ ...args, force: true });
    expect(forced.isError).toBeUndefined();
    expect(existsSync(join(root, "prefabs", "moved.et"))).toBe(true);
  });
});
