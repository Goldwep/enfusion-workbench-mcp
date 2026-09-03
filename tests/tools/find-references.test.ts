import { describe, it, expect } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  formatPage,
} from "../../src/tools/find-references.js";

describe("find_references cursor encoding", () => {
  it("encodes and decodes a payload, preserving offset/guid/kind", () => {
    const guid = "AAAA0000BBBB1111";
    const encoded = encodeCursor({ o: 40, g: guid, k: "inheritance", v: 1 });
    const decoded = decodeCursor(encoded, guid, "inheritance");
    expect(decoded.o).toBe(40);
    expect(decoded.g).toBe(guid);
    expect(decoded.k).toBe("inheritance");
    expect(decoded.v).toBe(1);
  });

  it("rejects a cursor whose GUID does not match the current query", () => {
    const encoded = encodeCursor({ o: 20, g: "AAAA0000BBBB1111", k: "any", v: 1 });
    expect(() => decodeCursor(encoded, "CCCC2222DDDD3333", "any")).toThrow(
      "cursor does not match",
    );
  });

  it("rejects a cursor whose kind filter does not match the current query", () => {
    const guid = "AAAA0000BBBB1111";
    const encoded = encodeCursor({ o: 20, g: guid, k: "inheritance", v: 1 });
    expect(() => decodeCursor(encoded, guid, "asset_path")).toThrow(
      "cursor does not match",
    );
  });

  it("rejects malformed cursor input", () => {
    expect(() => decodeCursor("not!base64!@#$json", "AAAA0000BBBB1111", "any")).toThrow(
      "Invalid cursor",
    );
  });
});

describe("find_references formatPage", () => {
  const baseRows = [
    {
      source_file: "prefabs/test.et",
      ref_kind: "inheritance" as const,
      context: "GenericEntity",
    },
    {
      source_file: "configs/sample.conf",
      ref_kind: "asset_path" as const,
      context: "m_Prefab",
    },
  ];

  it("shows the pagination hint when next_cursor is present, and omits it otherwise", () => {
    const withNext = formatPage({
      guid: "AAAA0000BBBB1111",
      kind: "any",
      totalCount: 100,
      offset: 0,
      rows: baseRows,
      nextCursor: "OPAQUE_CURSOR_TOKEN",
    });
    expect(withNext).toContain("next_cursor: OPAQUE_CURSOR_TOKEN");
    expect(withNext).toContain("Call `find_references` again with `cursor`");
    expect(withNext).not.toContain("(no more pages)");

    const withoutNext = formatPage({
      guid: "AAAA0000BBBB1111",
      kind: "any",
      totalCount: 2,
      offset: 0,
      rows: baseRows,
      nextCursor: null,
    });
    expect(withoutNext).toContain("(no more pages)");
    expect(withoutNext).not.toContain("next_cursor:");
  });
});
