import { describe, it, expect } from "vitest";
import {
  buildFactionConf,
  renderFactionConf,
  validateFactionKey,
  FACTION_KEY_RE,
} from "../../tools/faction-create.js";
import { parse } from "../../formats/enfusion-text.js";

describe("faction_create — FACTION_KEY_RE", () => {
  it("accepts canonical vanilla keys", () => {
    expect(FACTION_KEY_RE.test("US")).toBe(true);
    expect(FACTION_KEY_RE.test("FIA")).toBe(true);
    expect(FACTION_KEY_RE.test("USSR")).toBe(true);
    expect(FACTION_KEY_RE.test("RUR")).toBe(true);
  });

  it("accepts keys with digits and underscores", () => {
    expect(FACTION_KEY_RE.test("REDFOR_1")).toBe(true);
    expect(FACTION_KEY_RE.test("US_AIRBORNE")).toBe(true);
    expect(FACTION_KEY_RE.test("A1")).toBe(true);
  });

  it("rejects lowercase, leading digit, and too-short/too-long keys", () => {
    expect(FACTION_KEY_RE.test("us")).toBe(false);
    expect(FACTION_KEY_RE.test("1US")).toBe(false);
    expect(FACTION_KEY_RE.test("A")).toBe(false); // too short (min 2)
    expect(FACTION_KEY_RE.test("A".repeat(17))).toBe(false); // too long (max 16)
    expect(FACTION_KEY_RE.test("US-1")).toBe(false); // hyphen not allowed
    expect(FACTION_KEY_RE.test("")).toBe(false);
  });

  it("rejects keys with spaces or special chars", () => {
    expect(FACTION_KEY_RE.test("US 1")).toBe(false);
    expect(FACTION_KEY_RE.test("US.1")).toBe(false);
    expect(FACTION_KEY_RE.test("US/1")).toBe(false);
  });
});

describe("faction_create — validateFactionKey", () => {
  it("throws with a helpful message on a bad key", () => {
    expect(() => validateFactionKey("us")).toThrow(/must match/);
    expect(() => validateFactionKey("us")).toThrow(/us/);
  });

  it("returns without error for valid keys", () => {
    expect(() => validateFactionKey("US")).not.toThrow();
    expect(() => validateFactionKey("REDFOR_1")).not.toThrow();
  });
});

describe("faction_create — buildFactionConf shape", () => {
  it("produces a SCR_Faction root with the required properties and color block", () => {
    const root = buildFactionConf({
      factionKey: "US",
      displayName: "United States Army",
      color: { r: 10, g: 20, b: 30 },
    });
    expect(root.type).toBe("SCR_Faction");
    const key = root.properties.find((p) => p.key === "m_sFactionKey");
    expect(key?.value).toBe("US");
    const name = root.properties.find((p) => p.key === "m_sFactionName");
    expect(name?.value).toBe("United States Army");
    const colorNode = root.children.find((c) => c.type === "m_FactionColor");
    expect(colorNode).toBeDefined();
    const r = colorNode!.properties.find((p) => p.key === "R");
    const g = colorNode!.properties.find((p) => p.key === "G");
    const b = colorNode!.properties.find((p) => p.key === "B");
    const a = colorNode!.properties.find((p) => p.key === "A");
    expect(r?.value).toBe("10");
    expect(g?.value).toBe("20");
    expect(b?.value).toBe("30");
    expect(a?.value).toBe("1");
  });
});

describe("faction_create — renderFactionConf round-trip", () => {
  it("renders text that re-parses to the same shape", () => {
    const opts = {
      factionKey: "FIA",
      displayName: "Forces of Independent Armies",
      color: { r: 200, g: 100, b: 50 },
    };
    const text = renderFactionConf(opts);
    const reparsed = parse(text);
    expect(reparsed.type).toBe("SCR_Faction");
    const key = reparsed.properties.find((p) => p.key === "m_sFactionKey");
    expect(key?.value).toBe("FIA");
    const name = reparsed.properties.find((p) => p.key === "m_sFactionName");
    expect(name?.value).toBe("Forces of Independent Armies");
    const color = reparsed.children.find((c) => c.type === "m_FactionColor");
    expect(color).toBeDefined();
    const r = color!.properties.find((p) => p.key === "R");
    expect(r?.value).toBe("200");
  });

  it("contains the literal property names from the spec", () => {
    const text = renderFactionConf({
      factionKey: "RUR",
      displayName: "Russian Federation",
      color: { r: 0, g: 0, b: 255 },
    });
    expect(text).toContain("SCR_Faction");
    expect(text).toContain("m_sFactionKey");
    expect(text).toContain("m_sFactionName");
    expect(text).toContain("m_FactionColor");
    expect(text).toContain('"RUR"');
    expect(text).toContain('"Russian Federation"');
  });

  it("escapes quotes in the display name", () => {
    const text = renderFactionConf({
      factionKey: "US",
      displayName: 'United "States" Army',
      color: { r: 0, g: 0, b: 0 },
    });
    // Serializer escapes the inner quotes.
    expect(text).toContain('\\"States\\"');
  });
});
