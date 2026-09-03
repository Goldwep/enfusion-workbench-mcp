import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRefactorRenameProjectId } from "../../src/tools/refactor-rename-project-id.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

describe("refactor_rename_project_id containment (H7)", () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "renameid-"));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function tool() {
    return captureTool((s) => registerRefactorRenameProjectId(s, makeConfig({ projectPath: root })));
  }

  it("refuses a gproj_path outside every configured root and writes nothing", async () => {
    const gproj = join(outside, "Evil.gproj");
    const original = `GameProject {\n ID "Old"\n}\n`;
    writeFileSync(gproj, original, "utf-8");
    const r = await tool()({ gproj_path: gproj, old_id: "Old", new_id: "New", commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/outside every configured root/);
    expect(readFileSync(gproj, "utf-8")).toBe(original);
  });

  it("refuses a non-.gproj path", async () => {
    const p = join(root, "x.conf");
    writeFileSync(p, `ID "Old"\n`, "utf-8");
    const r = await tool()({ gproj_path: p, old_id: "Old", new_id: "New", commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/must end in \.gproj/);
  });

  it("renames the ID inside the root", async () => {
    const gproj = join(root, "Mod.gproj");
    writeFileSync(gproj, `GameProject {\n ID "Old"\n TITLE "t"\n}\n`, "utf-8");
    const r = await tool()({ gproj_path: gproj, old_id: "Old", new_id: "New", commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(readFileSync(gproj, "utf-8")).toBe(`GameProject {\n ID "New"\n TITLE "t"\n}\n`);
  });
});
