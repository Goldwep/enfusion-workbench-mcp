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

// Shape and names from vanilla Configs/Factions/CIV.conf and Dummy.conf (game paks):
// FactionKey "<key>" / FactionColor <R G B A as 0-1 floats> / UIInfo SCR_FactionUIInfo { Name }.
// W11 run 6: the engine loaded a file written with m_sFactionKey and ignored the property.
const IGNORED_NAMES = ["m_sFactionKey", "m_sFactionName", "m_FactionColor"];

describe("faction_create — buildFactionConf shape", () => {
  it("produces the vanilla SCR_Faction attribute names", () => {
    const root = buildFactionConf({
      factionKey: "US",
      displayName: "United States Army",
      color: { r: 4, g: 141, b: 231 },
    });
    expect(root.type).toBe("SCR_Faction");
    expect(root.id).toBeUndefined();
    expect(root.properties.find((p) => p.key === "FactionKey")?.value).toBe("US");
    expect(root.properties.find((p) => p.key === "FactionColor")?.value).toBe(
      "0.016 0.553 0.906 1",
    );
    const ui = root.children.find((c) => c.type === "UIInfo");
    expect(ui?.className).toBe("SCR_FactionUIInfo");
    expect(ui?.id).toMatch(/^\{[0-9A-F]{16}\}$/);
    expect(ui?.properties.find((p) => p.key === "Name")?.value).toBe("United States Army");
    const keys = [...root.properties.map((p) => p.key), ...root.children.map((c) => c.type)];
    for (const bad of IGNORED_NAMES) expect(keys).not.toContain(bad);
  });
});

describe("faction_create — renderFactionConf round-trip", () => {
  it("renders the vanilla shape and re-parses to it", () => {
    const text = renderFactionConf({
      factionKey: "FIA",
      displayName: "Forces of Independent Armies",
      color: { r: 255, g: 0, b: 51 },
      uiInfoGuid: "56B49118D8D0A9C5",
    });
    expect(text).toBe(
      [
        "SCR_Faction {",
        ' FactionKey "FIA"',
        " FactionColor 1 0 0.2 1",
        ' UIInfo SCR_FactionUIInfo "{56B49118D8D0A9C5}" {',
        '  Name "Forces of Independent Armies"',
        " }",
        "}",
      ].join("\n"),
    );
    const reparsed = parse(text);
    expect(reparsed.type).toBe("SCR_Faction");
    expect(reparsed.properties.find((p) => p.key === "FactionKey")?.value).toBe("FIA");
    const ui = reparsed.children.find((c) => c.type === "UIInfo");
    expect(ui?.className).toBe("SCR_FactionUIInfo");
    expect(ui?.properties.find((p) => p.key === "Name")?.value).toBe(
      "Forces of Independent Armies",
    );
  });

  it("never writes the member-style names the engine ignores", () => {
    const text = renderFactionConf({
      factionKey: "RUR",
      displayName: "Russian Federation",
      color: { r: 0, g: 0, b: 255 },
    });
    for (const bad of IGNORED_NAMES) expect(text).not.toContain(bad);
    expect(text).toContain('FactionKey "RUR"');
  });

  it("escapes quotes in the display name", () => {
    const text = renderFactionConf({
      factionKey: "US",
      displayName: 'United "States" Army',
      color: { r: 0, g: 0, b: 0 },
    });
    expect(text).toContain('\\"States\\"');
  });
});
