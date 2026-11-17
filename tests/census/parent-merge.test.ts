import { describe, expect, it } from "vitest";
import { mergeParent } from "../../src/census/parent-merge.js";

const MOD = "ui:WorldEditor/module/WorldEditor";
const WIN = "ui:WorldEditor/window/#main";
const DOCK = "ui:WorldEditor/dock/#entityPropDock";
const PANEL = "ui:WorldEditor/panel/#entityPropDockContents";
const tree: Record<string, string> = { [WIN]: MOD, [DOCK]: WIN, [PANEL]: DOCK };
const parentOf = (id: string): string | undefined => tree[id];

describe("mergeParent (DEC-054)", () => {
  it("rule 1: a live parent beats a static one and keeps the static claim", () => {
    const d = mergeParent(
      [
        { enumerator: "L01", parentId: DOCK },
        { enumerator: "E07", parentId: "ui:WorldEditor/panel/#other" },
      ],
      "panel",
      parentOf,
    );
    expect(d).toEqual({
      parent: DOCK,
      notes: ["static parent: ui:WorldEditor/panel/#other (E07)"],
    });
  });

  it("rule 1: between two live parents the deeper wins", () => {
    const d = mergeParent(
      [
        { enumerator: "L06", parentId: DOCK },
        { enumerator: "L01", parentId: PANEL },
      ],
      "property-group",
      parentOf,
    );
    expect(d.parent).toBe(PANEL);
    expect(d.notes).toEqual([`live parent: ${DOCK} (L06)`]);
    expect(d.conflict).toBeUndefined();
  });

  it("rule 1: two live parents of equal depth still conflict", () => {
    const d = mergeParent(
      [
        { enumerator: "L01", parentId: "ui:X/panel/#a" },
        { enumerator: "L02", parentId: "ui:X/panel/#b" },
      ],
      "menu",
      parentOf,
    );
    expect(d.conflict).toHaveLength(2);
  });

  it("rule 2: a static null is unknown, not a root claim", () => {
    const d = mergeParent(
      [
        { enumerator: "E07", parentId: null },
        { enumerator: "L02", parentId: WIN },
      ],
      "menu",
      parentOf,
    );
    expect(d).toEqual({ parent: WIN, notes: [] });
  });

  it("rule 2: root only when every speaking source says root, or kind module/window", () => {
    expect(mergeParent([{ enumerator: "E07", parentId: null }], "menu", parentOf).parent).toBe(
      null,
    );
    expect(
      mergeParent(
        [
          { enumerator: "E07", parentId: null },
          { enumerator: "E05", parentId: DOCK },
        ],
        "toolbar",
        parentOf,
      ).parent,
    ).toBe(DOCK);
    expect(mergeParent([{ enumerator: "E05" }], "window", parentOf).parent).toBe(null);
  });

  it("rule 3: a static module parent reached by the live chain is no disagreement", () => {
    const d = mergeParent(
      [
        { enumerator: "L01", parentId: WIN },
        { enumerator: "E05", parentId: MOD },
        { enumerator: "E06", parentId: MOD },
      ],
      "dock",
      parentOf,
    );
    expect(d).toEqual({ parent: WIN, notes: [] });
  });

  it("rule 3 applies between static sources too", () => {
    const d = mergeParent(
      [
        { enumerator: "E05", parentId: MOD },
        { enumerator: "E07", parentId: DOCK },
      ],
      "panel",
      parentOf,
    );
    expect(d).toEqual({ parent: DOCK, notes: [] });
  });
});
