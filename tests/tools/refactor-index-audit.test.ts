/**
 * Phase 7 audit, package refactor-index (findings 01-08), end to end:
 * crawl a real on-disk addon whose prefabs share an entity ID (as
 * 29th-reforger-loadouts does), then drive the index-backed tools.
 *
 * Disk facts these fixtures mirror (checked against packed game data and
 * addon files): an `.et` root `ID` is an entity id, prefabs inheriting one
 * base share it, and the resource GUID that `{GUID}path` references use is
 * only in the `.meta` sidecar's Name line.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { crawl } from "../../src/project-index/crawler.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import { registerRefactorMoveResourcePath } from "../../src/tools/refactor-move-resource-path.js";
import { registerRefactorReplaceGuid, buildPlan } from "../../src/tools/refactor-replace-guid.js";
import { registerRefactorRemoveUnused } from "../../src/tools/refactor-remove-unused.js";
import { registerAssetOrphanScan } from "../../src/tools/asset-orphan-scan.js";
import { findDuplicateGuids } from "../../src/tools/refactor-merge-duplicate-guids.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

const SHARED_ENTITY_ID = "520EC961A090B1EE";
const G_PROJECT = "5A5A000000000001";
const G_A = "687483D33CAB3952"; // Prefabs/A.et (.meta)
const G_B = "1234ABCD5678EF90"; // Prefabs/B.et (.meta)
const G_CHILD = "C0C0000000000001"; // Prefabs/Child.et (.meta)
const G_WOOD = "7E7E000000000001"; // Textures/wood.edds (.meta)
const G_LONE = "7E7E000000000002"; // Textures/lonely.edds (.meta)

const meta = (guid: string, path: string): string =>
  `MetaFileClass {\n Name "{${guid}}${path}"\n Configurations {\n }\n}\n`;
const prefab = (parent: string): string =>
  `SCR_ChimeraCharacter : "${parent}" {\n ID "${SHARED_ENTITY_ID}"\n}\n`;

describe("refactor-index audit: GUIDs from .meta, end to end", () => {
  let base: string;
  let mod: string;
  let db: Database.Database;
  let index: ProjectIndex;

  const put = (rel: string, content: string | Buffer): void => {
    const abs = join(mod, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  };
  const reindex = (): void => {
    crawl(db, [{ path: base, kind: "user" }]);
  };

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "ri-audit-"));
    mod = join(base, "Mod");
    put("addon.gproj", `GameProject {\n ID "Mod"\n GUID "${G_PROJECT}"\n TITLE "Mod"\n}\n`);
    put("Prefabs/A.et", prefab("{284E735C6C70DAD2}Prefabs/Base.et"));
    put("Prefabs/A.et.meta", meta(G_A, "Prefabs/A.et"));
    put("Prefabs/B.et", prefab("{284E735C6C70DAD2}Prefabs/Base.et"));
    put("Prefabs/B.et.meta", meta(G_B, "Prefabs/B.et"));
    put("Prefabs/Child.et", prefab(`{${G_A}}Prefabs/A.et`));
    put("Prefabs/Child.et.meta", meta(G_CHILD, "Prefabs/Child.et"));
    // A text format the index does not parse, naming A by GUID + path.
    put("Materials/x.physmat", `PhysicsMaterial {\n Parent "{${G_A}}Prefabs/A.et"\n}\n`);
    put("Textures/wood.edds", Buffer.from([0, 1, 2, 3]));
    put("Textures/wood.edds.meta", meta(G_WOOD, "Textures/wood.edds"));
    put("Textures/lonely.edds", Buffer.from([0, 1, 2, 3]));
    put("Textures/lonely.edds.meta", meta(G_LONE, "Textures/lonely.edds"));
    // A material with no .meta and no own GUID: still a reference source.
    put("Materials/Wood.emat", `MatPBRBasic {\n BCRMap "{${G_WOOD}}Textures/wood.edds"\n}\n`);
    db = openProjectIndex(":memory:");
    index = new ProjectIndex(db);
    reindex();
  });
  afterEach(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

  it("01: every prefab resolves by its .meta GUID; refs to it are not broken", () => {
    expect(index.resolveGuid(G_A)?.file_path).toBe("Prefabs/A.et");
    expect(index.resolveGuid(G_B)?.file_path).toBe("Prefabs/B.et");
    expect(index.resolveGuid(G_CHILD)?.file_path).toBe("Prefabs/Child.et");
    expect(index.resolveGuid(SHARED_ENTITY_ID)).toBeNull();
    const broken = index.findBrokenRefs({ limit: 200, offset: 0 }).rows.map((r) => r.target_guid);
    expect(broken).not.toContain(G_A);
    expect(broken).not.toContain(G_WOOD);
  });

  it("01 + 07: moving a prefab rewrites indexed refs and unindexed text refs", async () => {
    const tool = captureTool((s) =>
      registerRefactorMoveResourcePath(s, db, index, makeConfig({ projectPath: base })),
    );
    const dry = await tool({ project_root: mod, old_path: "Prefabs/A.et", new_path: "Prefabs/Moved/A.et", commit: false, force: true });
    expect(textOf(dry)).toContain(`{${G_A}}`);
    expect(textOf(dry)).toContain("Materials/x.physmat");
    const r = await tool({ project_root: mod, old_path: "Prefabs/A.et", new_path: "Prefabs/Moved/A.et", commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/Updated 2 refs across 2 files/);
    expect(readFileSync(join(mod, "Prefabs/Child.et"), "utf-8")).toContain(`{${G_A}}Prefabs/Moved/A.et`);
    expect(readFileSync(join(mod, "Materials/x.physmat"), "utf-8")).toContain(`{${G_A}}Prefabs/Moved/A.et`);
    expect(readFileSync(join(mod, "Prefabs/Moved/A.et.meta"), "utf-8")).toContain(`{${G_A}}Prefabs/Moved/A.et`);
  });

  it("01: a prefab sharing an entity ID with another is still movable", async () => {
    const tool = captureTool((s) =>
      registerRefactorMoveResourcePath(s, db, index, makeConfig({ projectPath: base })),
    );
    const r = await tool({ project_root: mod, old_path: "Prefabs/B.et", new_path: "Prefabs/B2.et", commit: false, force: true });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain(`GUID: {${G_B}}`);
  });

  it("02: the removal script never deletes the .gproj, a referenced prefab, or a texture", async () => {
    const tool = captureTool((s) => registerRefactorRemoveUnused(s, index));
    const text = textOf(await tool({ source: "user", shell: "powershell", limit: 500 }));
    expect(text).not.toContain("addon.gproj");
    expect(text).not.toMatch(/Prefabs[\\/]A\.et"/);
    expect(text).not.toContain("lonely.edds");
    // Unreferenced prefabs are still listed.
    expect(text).toMatch(/Prefabs[\\/]B\.et"/);
  });

  it("03: after replace_guid commits, the old GUID no longer resolves", async () => {
    const tool = captureTool((s) => registerRefactorReplaceGuid(s, db, index, makeConfig({ projectPath: base })));
    const NEW = "ABAB000000000009";
    const r = await tool({ old_guid: G_A, new_guid: NEW, commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(readFileSync(join(mod, "Prefabs/A.et.meta"), "utf-8")).toContain(`{${NEW}}`);
    reindex();
    expect(index.resolveGuid(G_A)).toBeNull();
    expect(index.resolveGuid(NEW)?.file_path).toBe("Prefabs/A.et");
    expect(db.prepare("SELECT COUNT(*) AS n FROM resources WHERE file_path = 'Prefabs/A.et'").get()).toEqual({ n: 1 });
  });

  it("03: a .gproj GUID change leaves no row under the old GUID", () => {
    put("addon.gproj", `GameProject {\n ID "Mod"\n GUID "5A5A000000000002"\n TITLE "Mod"\n}\n`);
    reindex();
    expect(index.resolveGuid(G_PROJECT)).toBeNull();
    expect(index.resolveGuid("5A5A000000000002")?.file_path).toBe("addon.gproj");
  });

  it("04: a file deleted while no watcher ran leaves no ghost rows", () => {
    rmSync(join(mod, "Prefabs/Child.et"));
    rmSync(join(mod, "Prefabs/Child.et.meta"));
    reindex();
    expect(index.resolveGuid(G_CHILD)).toBeNull();
    expect(index.referencingFiles(G_A)).toEqual([]);
  });

  it("05: a texture referenced only from an .emat without a GUID is not an orphan", async () => {
    const tool = captureTool((s) => registerAssetOrphanScan(s, index));
    const text = textOf(await tool({ source: "user", limit: 200 }));
    expect(text).not.toContain("Textures/wood.edds");
    expect(text).toContain("Textures/lonely.edds");
  });

  it("06: new_guid owned by a .meta is a collision; an entity ID is not", () => {
    expect(buildPlan(db, index, G_CHILD, G_B).collision).toBe(true);
    expect(buildPlan(db, index, G_CHILD, G_WOOD).collision).toBe(true);
    expect(buildPlan(db, index, G_CHILD, SHARED_ENTITY_ID).collision).toBe(false);
  });

  it("06: a sidecar written after the last crawl still counts as a collision", () => {
    put("Textures/late.edds", Buffer.from([1]));
    put("Textures/late.edds.meta", meta("1A7E000000000001", "Textures/late.edds"));
    const plan = buildPlan(db, index, G_CHILD, "1A7E000000000001");
    expect(plan.collision).toBe(true);
    expect(plan.collisionFile).toContain("late.edds.meta");
  });

  it("08: prefabs sharing an entity ID are not reported as GUID duplicates", () => {
    expect(findDuplicateGuids(mod).size).toBe(0);
    // A copied asset with its copied .meta still is.
    put("Prefabs/A_copy.et", prefab("{284E735C6C70DAD2}Prefabs/Base.et"));
    put("Prefabs/A_copy.et.meta", meta(G_A, "Prefabs/A.et"));
    const dup = findDuplicateGuids(mod);
    expect([...dup.keys()]).toEqual([G_A]);
    expect(existsSync(join(mod, "Prefabs/A_copy.et.meta"))).toBe(true);
  });
});
