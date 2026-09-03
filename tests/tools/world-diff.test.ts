import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import { diffWorlds, entityKey, formatDiff, parsePosition } from "../../src/tools/world-diff.js";

// A minimal `.ent`-shaped wrapper. Direct children are what gets diffed.
function world(body: string): string {
  return `SubScene {\n${body}\n}`;
}

describe("world-diff helpers", () => {
  it('parsePosition reads a `coords "x y z"` property', () => {
    const node = parse('Entity {\n coords "10 20 30"\n}');
    expect(parsePosition(node)).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("parsePosition returns null when coords is missing or malformed", () => {
    expect(parsePosition(parse("Entity {\n}"))).toBeNull();
    expect(parsePosition(parse('Entity {\n coords "not numbers"\n}'))).toBeNull();
  });

  it("entityKey prefers id over position", () => {
    const n = parse('Entity {\n ID "AAAA0000BBBB1111"\n coords "1 2 3"\n}');
    // `.id` is parsed only from the post-type slot; `ID` here is a property,
    // so this entity has no node.id and falls through to position-keyed.
    // Verify the *real* id-preference path with a node whose post-type id is set:
    const withId = parse('Entity "DEADBEEFDEADBEEF" {\n coords "1 2 3"\n}');
    expect(entityKey(withId, 0)).toBe("id:DEADBEEFDEADBEEF");
    // And the property-`ID`-only node falls through to position-hash:
    expect(entityKey(n, 0)).toMatch(/^pos:Entity::/);
  });

  it("entityKey falls back to position-hash when no id is set", () => {
    const n = parse('Entity {\n coords "100 0 200"\n}');
    expect(entityKey(n, 7)).toBe("pos:Entity::100|0|200");
  });

  it("entityKey falls back to array index when no id and no position", () => {
    const n = parse("Entity {\n}");
    expect(entityKey(n, 3)).toBe("idx:Entity:3");
  });
});

describe("diffWorlds", () => {
  it("detects added and removed entities", () => {
    const before = parse(world(' A "1111111111111111" {\n  coords "0 0 0"\n }'));
    const after = parse(
      world(
        ' A "1111111111111111" {\n  coords "0 0 0"\n }\n B "2222222222222222" {\n  coords "5 5 5"\n }',
      ),
    );
    const result = diffWorlds(before, after, 0.01);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].key).toBe("id:2222222222222222");
    expect(result.added[0].type).toBe("B");
    expect(result.added[0].position).toEqual({ x: 5, y: 5, z: 5 });
    expect(result.removed).toHaveLength(0);
  });

  it("detects moved entities by position delta above epsilon", () => {
    const before = parse(world(' Tank "AAAA0000BBBB1111" {\n  coords "100 0 200"\n }'));
    const after = parse(world(' Tank "AAAA0000BBBB1111" {\n  coords "150 0 200"\n }'));
    const result = diffWorlds(before, after, 0.01);
    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].key).toBe("id:AAAA0000BBBB1111");
    expect(result.moved[0].before).toEqual({ x: 100, y: 0, z: 200 });
    expect(result.moved[0].after).toEqual({ x: 150, y: 0, z: 200 });
    expect(result.modified).toHaveLength(0);
  });

  it("ignores position deltas below epsilon", () => {
    const before = parse(world(' Tank "AAAA0000BBBB1111" {\n  coords "100.000 0 200"\n }'));
    const after = parse(world(' Tank "AAAA0000BBBB1111" {\n  coords "100.005 0 200"\n }'));
    const result = diffWorlds(before, after, 0.01);
    expect(result.moved).toHaveLength(0);
  });

  it("detects modified properties", () => {
    const before = parse(
      world(' Tank "AAAA0000BBBB1111" {\n  coords "0 0 0"\n  m_fHealth "100"\n }'),
    );
    const after = parse(
      world(
        ' Tank "AAAA0000BBBB1111" {\n  coords "0 0 0"\n  m_fHealth "75"\n  m_sName "Alpha"\n }',
      ),
    );
    const result = diffWorlds(before, after, 0.01);
    expect(result.moved).toHaveLength(0);
    expect(result.modified).toHaveLength(1);
    const m = result.modified[0];
    expect(m.key).toBe("id:AAAA0000BBBB1111");
    const healthChange = m.changes.find((c) => c.key === "m_fHealth");
    expect(healthChange).toEqual({ key: "m_fHealth", before: "100", after: "75" });
    const nameChange = m.changes.find((c) => c.key === "m_sName");
    expect(nameChange).toEqual({
      key: "m_sName",
      before: "<unset>",
      after: "Alpha",
    });
  });

  it("treats inheritance change as a property diff", () => {
    const before = parse(
      world(' Tank "AAAA0000BBBB1111" : "{OLDGUID0000DEAD}old.et" {\n  coords "0 0 0"\n }'),
    );
    const after = parse(
      world(' Tank "AAAA0000BBBB1111" : "{NEWGUID0000BEEF}new.et" {\n  coords "0 0 0"\n }'),
    );
    const result = diffWorlds(before, after, 0.01);
    expect(result.modified).toHaveLength(1);
    const inh = result.modified[0].changes.find((c) => c.key === ":inheritance");
    expect(inh).toBeDefined();
    expect(inh!.before).toContain("OLDGUID");
    expect(inh!.after).toContain("NEWGUID");
  });

  it("returns empty buckets for identical worlds", () => {
    const text = world(' Tank "AAAA0000BBBB1111" {\n  coords "10 0 20"\n  m_fHealth "100"\n }');
    const result = diffWorlds(parse(text), parse(text), 0.01);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.moved).toHaveLength(0);
    expect(result.modified).toHaveLength(0);
  });
});

describe("formatDiff", () => {
  it("renders all four sections when populated", () => {
    const result = {
      added: [{ key: "id:A", type: "Foo", position: { x: 1, y: 2, z: 3 } }],
      removed: [{ key: "id:B", type: "Bar", position: null }],
      moved: [
        {
          key: "id:C",
          type: "Tank",
          before: { x: 0, y: 0, z: 0 },
          after: { x: 5, y: 0, z: 0 },
        },
      ],
      modified: [
        {
          key: "id:D",
          type: "Baz",
          changes: [{ key: "m_fHealth", before: "100", after: "75" }],
        },
      ],
    };
    const text = formatDiff(result, "v1.ent", "v2.ent", 100);
    expect(text).toContain("## World diff: v1.ent → v2.ent");
    expect(text).toContain("Added:    1 entities");
    expect(text).toContain("Removed:  1 entities");
    expect(text).toContain("Moved:    1 entities");
    expect(text).toContain("Modified: 1 entities");
    expect(text).toContain("### Added entities (showing 1 of 1)");
    expect(text).toContain("Foo id:A at (1, 2, 3)");
    expect(text).toContain("### Moved entities (showing 1 of 1)");
    expect(text).toContain("Tank id:C: (0, 0, 0) → (5, 0, 0)");
    expect(text).toContain('m_fHealth: "100" → "75"');
  });

  it("reports a no-diff message when all buckets are empty", () => {
    const text = formatDiff({ added: [], removed: [], moved: [], modified: [] }, "a", "b", 100);
    expect(text).toContain("No semantic differences detected.");
  });

  it("caps shown rows at max_diffs but reports full count", () => {
    const added = Array.from({ length: 5 }, (_, i) => ({
      key: `id:${i}`,
      type: "Foo",
      position: null,
    }));
    const text = formatDiff({ added, removed: [], moved: [], modified: [] }, "a", "b", 2);
    expect(text).toContain("Added:    5 entities");
    expect(text).toContain("### Added entities (showing 2 of 5)");
    expect(text).toContain("id:0");
    expect(text).toContain("id:1");
    expect(text).not.toContain("id:2");
  });
});
