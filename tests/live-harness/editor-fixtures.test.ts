import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  EDITORS,
  planFixtures,
  projectGuid,
  writeProject,
} from "../../scripts/live/editor-fixtures.js";
import { isCanonical, parseBt } from "../../src/behavior-tree/model.js";
import { validateBt, viewBt } from "../../src/behavior-tree/tree.js";

// A vanilla-shaped tree standing in for the one the plan re-paths.
const VANILLA = [
  'BehaviorTree "{0123456789ABCDEF}AI/BehaviorTrees/Waypoints/WP_Animate.bt" {',
  ' Name "AI/BehaviorTrees/Waypoints/WP_Animate.bt"',
  " Nodes {",
  "  RootNode Root {",
  '   Name "Root"',
  "   EditorPos 0 80",
  "   Nodes {",
  "    AITaskIdle Idle {",
  '     Name "Idle"',
  "     EditorPos 0 260",
  "     Period 2",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

describe("editor fixtures", () => {
  const fixtures = planFixtures(() => VANILLA);

  it("gives every editor but the Dialogue Editor at least one fixture, each at its own path", () => {
    for (const editor of EDITORS) {
      const n = fixtures.filter((f) => f.editor === editor).length;
      if (editor === "DialogueEditor") expect(n).toBe(0);
      else expect(n, editor).toBeGreaterThan(0);
    }
    expect(new Set(fixtures.map((f) => f.path)).size).toBe(fixtures.length);
    for (const f of fixtures) {
      expect(f.path).not.toMatch(/^[\\/]|\.\.|\\/);
      expect(f.text !== undefined || f.source !== "generated", f.path).toBe(true);
    }
  });

  it("writes behavior trees the model reads back, named after their new path", () => {
    const trees = fixtures.filter((f) => f.path.endsWith(".bt"));
    expect(trees).toHaveLength(2);
    for (const t of trees) {
      expect(isCanonical(t.text!)).toBe(true);
      const doc = parseBt(t.text!);
      expect(viewBt(doc).name).toBe(t.path);
      expect(viewBt(doc).guid).toBeUndefined();
      expect(validateBt(doc, { expectedPath: t.path }).filter((x) => x.level === "error")).toEqual(
        [],
      );
    }
  });

  it("derives a stable 16-digit project GUID from the name", () => {
    expect(projectGuid("EMCP2_fx_WorldEditor")).toMatch(/^[0-9A-F]{16}$/);
    expect(projectGuid("EMCP2_fx_WorldEditor")).toBe(projectGuid("EMCP2_fx_WorldEditor"));
    expect(projectGuid("EMCP2_fx_WorldEditor")).not.toBe(projectGuid("EMCP2_fx_AnimEditor"));
  });
});

describe("writeProject", () => {
  const dir = mkdtempSync(join(tmpdir(), "emcp-fx-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps an existing file unless told to overwrite, and refuses a path outside the project", () => {
    writeFileSync(join(dir, "a.txt"), "mine");
    const first = writeProject(
      dir,
      [
        { path: "a.txt", data: "new" },
        { path: "sub/b.txt", data: "b" },
      ],
      false,
    );
    expect(first).toEqual({ written: ["sub/b.txt"], kept: ["a.txt"] });
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("mine");
    writeProject(dir, [{ path: "a.txt", data: "new" }], true);
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("new");
    expect(() => writeProject(dir, [{ path: "../escape.txt", data: "x" }], true)).toThrow(
      /outside/,
    );
  });
});
