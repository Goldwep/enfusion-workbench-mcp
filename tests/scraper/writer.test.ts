import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { writeClassesPreserving, mergeByName, writeOutput } from "../../src/scraper/writer.js";
import type { ClassInfo, GroupInfo, HierarchyNode, WikiPage } from "../../src/index/types.js";

/** Minimal ClassInfo factory — only the fields the writer touches matter. */
function makeClass(name: string, source: "enfusion" | "arma", extra: Partial<ClassInfo> = {}): ClassInfo {
  return {
    name,
    source,
    brief: "",
    description: "",
    parents: [],
    children: [],
    group: "",
    ...extra,
  } as ClassInfo;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

describe("scraper/writer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(resolve(tmpdir(), "writer-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("writeClassesPreserving", () => {
    it("(1) preserves the existing file when given an EMPTY list (does NOT blank it)", () => {
      const filePath = resolve(dir, "classes.json");
      const existing = [makeClass("IEntity", "enfusion"), makeClass("SCR_Foo", "arma")];
      writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");

      writeClassesPreserving(filePath, [], "test-label");

      // File must still hold the original two entries — the near-catastrophe guard.
      const after = readJson<ClassInfo[]>(filePath);
      expect(after).toHaveLength(2);
      expect(after.map((c) => c.name).sort()).toEqual(["IEntity", "SCR_Foo"]);
    });

    it("(1b) empty list + no existing file leaves no file written", () => {
      const filePath = resolve(dir, "missing.json");
      writeClassesPreserving(filePath, [], "test-label");
      expect(existsSync(filePath)).toBe(false);
    });

    it("(2) overwrites with a non-empty list", () => {
      const filePath = resolve(dir, "classes.json");
      writeFileSync(filePath, JSON.stringify([makeClass("OldClass", "enfusion")]), "utf-8");

      const fresh = [makeClass("IEntity", "enfusion"), makeClass("IEntityComponent", "enfusion")];
      writeClassesPreserving(filePath, fresh, "test-label");

      const after = readJson<ClassInfo[]>(filePath);
      expect(after.map((c) => c.name)).toEqual(["IEntity", "IEntityComponent"]);
      // Old data is gone — overwrite, not merge (preserve-on-empty only).
      expect(after.some((c) => c.name === "OldClass")).toBe(false);
    });
  });

  describe("mergeByName", () => {
    it("(3) unions list fields on a name collision (no data loss) — GroupInfo.classes", () => {
      const filePath = resolve(dir, "groups.json");
      const existing: GroupInfo[] = [
        { name: "Entities", description: "old desc", classes: ["IEntity", "Shared"] },
      ];
      writeFileSync(filePath, JSON.stringify(existing), "utf-8");

      const fresh: GroupInfo[] = [
        { name: "Entities", description: "new desc", classes: ["Shared", "SCR_Vehicle"] },
      ];
      const merged = mergeByName(filePath, fresh);

      expect(merged).toHaveLength(1);
      const entities = merged[0];
      // Scalar field: fresh wins.
      expect(entities.description).toBe("new desc");
      // List field unioned + deduped — NEITHER source's classes dropped.
      expect(entities.classes).toEqual(["IEntity", "Shared", "SCR_Vehicle"]);
    });

    it("(3b) unions HierarchyNode.children on a name collision", () => {
      const filePath = resolve(dir, "hierarchy.json");
      const existing: HierarchyNode[] = [{ name: "AlignableSlot", children: ["ButtonSlot", "GridSlot"] }];
      writeFileSync(filePath, JSON.stringify(existing), "utf-8");

      const fresh: HierarchyNode[] = [{ name: "AlignableSlot", children: ["GridSlot", "LayoutSlot"] }];
      const merged = mergeByName(filePath, fresh);

      expect(merged).toHaveLength(1);
      expect(merged[0].children).toEqual(["ButtonSlot", "GridSlot", "LayoutSlot"]);
    });

    it("(3c) preserves entries from a source not in the fresh set", () => {
      const filePath = resolve(dir, "hierarchy.json");
      const existing: HierarchyNode[] = [
        { name: "EnfusionOnly", children: ["A"] },
        { name: "Shared", children: ["B"] },
      ];
      writeFileSync(filePath, JSON.stringify(existing), "utf-8");

      const fresh: HierarchyNode[] = [{ name: "Shared", children: ["C"] }];
      const merged = mergeByName(filePath, fresh);

      const byName = new Map(merged.map((n) => [n.name, n]));
      // The unscraped source's node survives untouched.
      expect(byName.get("EnfusionOnly")?.children).toEqual(["A"]);
      // The collided node is unioned.
      expect(byName.get("Shared")?.children).toEqual(["B", "C"]);
    });

    it("(4) with an empty fresh list returns existing verbatim", () => {
      const filePath = resolve(dir, "groups.json");
      const existing: GroupInfo[] = [
        { name: "Entities", description: "d", classes: ["IEntity"] },
        { name: "Components", description: "d2", classes: ["IComponent"] },
      ];
      writeFileSync(filePath, JSON.stringify(existing), "utf-8");

      const merged = mergeByName<GroupInfo>(filePath, []);
      expect(merged).toEqual(existing);
    });

    it("(4b) with no existing file and empty fresh returns an empty array", () => {
      const merged = mergeByName<GroupInfo>(resolve(dir, "nope.json"), []);
      expect(merged).toEqual([]);
    });
  });

  describe("writeOutput end-to-end", () => {
    it("(5) preserves a source's prior file when that source scrapes empty", () => {
      const apiDir = resolve(dir, "api");
      const wikiDir = resolve(dir, "wiki");
      mkdirSync(apiDir, { recursive: true });
      mkdirSync(wikiDir, { recursive: true });

      // Seed prior enfusion-classes.json — this is the source that will scrape empty.
      const priorEnfusion = [makeClass("IEntity", "enfusion"), makeClass("BaseWorld", "enfusion")];
      writeFileSync(
        resolve(apiDir, "enfusion-classes.json"),
        JSON.stringify(priorEnfusion, null, 2),
        "utf-8",
      );

      // Seed prior wiki pages from a source NOT in this scrape (bistudio-wiki).
      const priorPages: WikiPage[] = [
        { title: "BI Guide", source: "bistudio-wiki", content: "keep me" },
      ];
      writeFileSync(resolve(wikiDir, "pages.json"), JSON.stringify(priorPages), "utf-8");

      // Scrape output: enfusion empty (zip missing/moved), arma populated.
      writeOutput(dir, {
        enfusionClasses: [], // empty source — must be preserved, not blanked
        armaClasses: [makeClass("SCR_GameMode", "arma")],
        hierarchy: [{ name: "SCR_GameMode", children: [] }],
        groups: [{ name: "GameModes", description: "", classes: ["SCR_GameMode"] }],
        wikiPages: [{ title: "Doxygen Page", source: "arma", content: "fresh" }],
      });

      // The empty source's prior file survived intact — the data-loss guard.
      const enfusionAfter = readJson<ClassInfo[]>(resolve(apiDir, "enfusion-classes.json"));
      expect(enfusionAfter.map((c) => c.name).sort()).toEqual(["BaseWorld", "IEntity"]);

      // The populated source was written.
      const armaAfter = readJson<ClassInfo[]>(resolve(apiDir, "arma-classes.json"));
      expect(armaAfter.map((c) => c.name)).toEqual(["SCR_GameMode"]);

      // Wiki pages from the unscraped source are preserved alongside fresh ones.
      const pagesAfter = readJson<WikiPage[]>(resolve(wikiDir, "pages.json"));
      const titles = pagesAfter.map((p) => p.title).sort();
      expect(titles).toEqual(["BI Guide", "Doxygen Page"]);
    });
  });
});
