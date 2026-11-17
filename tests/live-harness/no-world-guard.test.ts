import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../scripts/live/paths.js";

/**
 * The W1.7 run of 2026-11-11 crashed Workbench: after "can't load world" the World Editor API
 * existed with no world, and `wb_world state` called GetNumSubScenes on it (access violation in
 * EMCP_WB_World.State). Every W1 handler now passes one shared check, EMCP_WB_Common.NoWorldReason,
 * after GetApi and before any further engine call. These tests hold that at text level.
 */
const DIR = join(REPO_ROOT, "mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const read = (f: string): string => readFileSync(join(DIR, f), "utf-8").replace(/\r\n/g, "\n");

/** Body of the function enclosing `at` (from its `static` line to the next separator comment). */
function enclosing(text: string, at: number): string {
  const start = text.lastIndexOf("\n\t//---", at);
  const end = text.indexOf("\n\t//---", at);
  return text.slice(start < 0 ? 0 : start, end < 0 ? undefined : end);
}

const HANDLERS = [
  "EMCP_WB_Entity.c",
  "EMCP_WB_View.c",
  "EMCP_WB_World.c",
  "EMCP_WB_Layers.c",
  "EMCP_WB_Terrain.c",
  "EMCP_WB_Prefabs.c",
  "EMCP_WB_Container.c",
  "EMCP_WB_Module.c",
];

/** GetApi sites that may skip the check, with the reason. */
const EXEMPT: Record<string, string> = {
  "EMCP_WB_World.c Stop":
    "stop calls only IsGameMode and SwitchToEditMode, and must work whatever the world state",
};

describe("no-world guard (the 2026-11-11 crash in EMCP_WB_World.State)", () => {
  const common = read("EMCP_WB_Common.c");

  it("NoWorldReason needs a world path (or prefab edit mode) and a non-null GetWorld", () => {
    const at = common.indexOf(
      "static string NoWorldReason(WorldEditor worldEditor, WorldEditorAPI api)",
    );
    expect(at).toBeGreaterThan(-1);
    const body = enclosing(common, at);
    expect(body).toContain("api.GetWorldPath(worldPath);");
    expect(body).toMatch(/worldPath == "" && !worldEditor\.IsPrefabEditMode\(\)/);
    expect(body).toContain("if (!api.GetWorld())");
    // Only the three calls that are safe without a world.
    const calls = [...body.matchAll(/\b(?:api|worldEditor)\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect([...new Set(calls)]).toEqual(["GetWorld", "GetWorldPath", "IsPrefabEditMode"]);
  });

  for (const f of HANDLERS) {
    it(`${f}: every GetApi() is followed by NoWorldReason in the same function`, () => {
      const text = read(f);
      const sites = [...text.matchAll(/=\s*worldEditor\.GetApi\(\);/g)].map((m) => m.index ?? 0);
      expect(sites.length, f).toBeGreaterThan(0);
      for (const at of sites) {
        const body = enclosing(text, at);
        const name =
          /static \w+ (\w+)\(/.exec(body)?.[1] ?? /protected bool (\w+)\(/.exec(body)?.[1] ?? "?";
        if (EXEMPT[`${f} ${name}`]) continue;
        const after = body.slice(body.indexOf("GetApi()"));
        expect(after, `${f} ${name}`).toContain("EMCP_WB_Common.NoWorldReason(worldEditor, ");
      }
    });
  }

  it("wb_world state answers NO_WORLD before GetNumSubScenes and the entity count", () => {
    const w = read("EMCP_WB_World.c");
    const body = enclosing(w, w.indexOf("static void State("));
    const check = body.indexOf("EMCP_WB_Common.NoWorldReason(worldEditor, api)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.indexOf("api.GetNumSubScenes()"));
    expect(check).toBeLessThan(body.indexOf("api.GetEditorEntityCount()"));
    expect(check).toBeLessThan(body.indexOf("api.GetCurrentSubScene()"));
  });

  it("wb_module save refuses NO_WORLD before WorldEditor.Save", () => {
    const m = read("EMCP_WB_Module.c");
    const at = m.indexOf("worldEditor.Save()");
    const body = enclosing(m, at);
    expect(body.indexOf("NoWorldReason")).toBeGreaterThan(-1);
    expect(body.indexOf("NoWorldReason")).toBeLessThan(body.indexOf("worldEditor.Save()"));
  });
});
