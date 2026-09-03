import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  countEntitiesByClass,
  totalEntities,
  collectSubScenes,
  computeBounding,
  formatWorldSummary,
} from "../../src/tools/world-compose-summary.js";

describe("world-compose-summary helpers", () => {
  describe("countEntitiesByClass", () => {
    it("tallies labels and sorts by count desc, then label asc", () => {
      const root = parse(`World {
 GenericEntity Tree1 { }
 GenericEntity Tree2 { }
 GenericEntity Tree3 { }
 GenericEntity Building1 { }
 SCR_AIWaypoint WP1 { }
}`);
      const counts = countEntitiesByClass(root);
      // GenericEntity x4 (Tree1/Tree2/Tree3/Building1), World x1, SCR_AIWaypoint x1
      expect(counts[0]).toEqual({ label: "GenericEntity", count: 4 });
      // Ties (count=1) break alphabetically: SCR_AIWaypoint, World
      expect(counts[1].label).toBe("SCR_AIWaypoint");
      expect(counts[2].label).toBe("World");
      expect(totalEntities(counts)).toBe(6);
    });

    it("prefers className over type when present", () => {
      const root = parse(`World {
 components Attributes SCR_WorldAttributes "{AAAA000011112222}" { }
}`);
      const counts = countEntitiesByClass(root);
      const labels = counts.map((c) => c.label);
      expect(labels).toContain("SCR_WorldAttributes");
      expect(labels).toContain("World");
    });
  });

  describe("collectSubScenes", () => {
    it("finds a root-level SubScene Parent ref", () => {
      const root = parse(`SubScene {
 Parent "{853E92315D1D9EFE}worlds/Eden/Eden.ent"
}`);
      const refs = collectSubScenes(root);
      expect(refs).toHaveLength(1);
      expect(refs[0].parent).toBe("{853E92315D1D9EFE}worlds/Eden/Eden.ent");
      expect(refs[0].where).toBe("root");
    });

    it("returns [] when no SubScene nodes are present", () => {
      const root = parse(`World {
 GenericEntity X { }
}`);
      expect(collectSubScenes(root)).toEqual([]);
    });
  });

  describe("computeBounding", () => {
    it("returns undefined when no positions are found", () => {
      const root = parse(`World {
 GenericEntity X { }
}`);
      expect(computeBounding(root)).toBeUndefined();
    });

    it("computes min/max over multiple coords properties", () => {
      const root = parse(`World {
 GenericEntity A { coords "10 0 -5" }
 GenericEntity B { coords "-2 50 100" }
 GenericEntity C { coords "5 25 50" }
}`);
      const b = computeBounding(root);
      expect(b).toBeDefined();
      expect(b!.samples).toBe(3);
      expect(b!.min).toEqual([-2, 0, -5]);
      expect(b!.max).toEqual([10, 50, 100]);
    });
  });

  describe("formatWorldSummary", () => {
    it("renders headers, counts, and a SubScene block when refs are present", () => {
      const out = formatWorldSummary({
        worldPath: "C:/worlds/test.ent",
        totalEntities: 42,
        classCounts: [
          { label: "GenericEntity", count: 30 },
          { label: "SCR_AIWaypoint", count: 12 },
        ],
        subScenes: [
          { where: "root", parent: "{ABC123}worlds/Eden/Eden.ent" },
        ],
        layerCount: 2,
        layerFiles: ["default.layer", "Bases.layer"],
      });
      expect(out).toContain("# World summary: C:/worlds/test.ent");
      expect(out).toContain("Total entities:** 42");
      expect(out).toContain("GenericEntity: 30");
      expect(out).toContain("SCR_AIWaypoint: 12");
      expect(out).toContain("SubScene parent references");
      expect(out).toContain("{ABC123}worlds/Eden/Eden.ent");
      expect(out).toContain("default.layer");
      expect(out).toContain("Bases.layer");
    });

    it("omits the SubScene section when there are no refs", () => {
      const out = formatWorldSummary({
        worldPath: "x.ent",
        totalEntities: 1,
        classCounts: [{ label: "World", count: 1 }],
        subScenes: [],
        layerCount: 0,
      });
      expect(out).not.toContain("SubScene parent references");
      expect(out).not.toContain("Layer files");
    });

    it("collapses overflow classes past the top N into a single line", () => {
      const many = Array.from({ length: 20 }, (_, i) => ({
        label: `Class${String(i).padStart(2, "0")}`,
        count: 20 - i,
      }));
      const out = formatWorldSummary({
        worldPath: "x.ent",
        totalEntities: 210,
        classCounts: many,
        subScenes: [],
        layerCount: 0,
      });
      expect(out).toContain("(plus 5 more classes)");
    });
  });
});
