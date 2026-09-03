import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  extractStyles,
  formatStylesInspection,
} from "../../src/tools/ui-styles-inspect.js";

// A .styles file with two top-level widget-style entries — one with an
// explicit Name property, one without (so the fallback to `id` is exercised).
const SAMPLE_STYLES = `Styles {
 WidgetStyle {
  Name "PrimaryButton"
  Color "0.2 0.6 1 1"
  Padding "10 5 10 5"
 }
 TextWidgetStyle "TitleHeader" {
  ExactFontSize 24
  Color "1 1 1 1"
 }
}`;

describe("ui-styles-inspect: extractStyles", () => {
  it("pulls every direct child as a style entry and surfaces its properties", () => {
    const root = parse(SAMPLE_STYLES);
    const entries = extractStyles(root);
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const primary = entries.find((e) => e.name === "PrimaryButton");
    expect(primary).toBeDefined();
    expect(primary!.type).toBe("WidgetStyle");
    expect(primary!.properties).toContainEqual({ key: "Color", value: "0.2 0.6 1 1" });
    expect(primary!.properties).toContainEqual({ key: "Padding", value: "10 5 10 5" });

    const title = entries.find((e) => e.name === "TitleHeader");
    expect(title).toBeDefined();
    expect(title!.type).toBe("TextWidgetStyle");
    expect(title!.properties).toContainEqual({ key: "ExactFontSize", value: "24" });
  });

  it("returns [] for a file with no style entries", () => {
    const root = parse(`Styles {\n}`);
    expect(extractStyles(root)).toEqual([]);
  });
});

describe("ui-styles-inspect: formatStylesInspection", () => {
  it("renders heading, total, and each entry's property list", () => {
    const root = parse(SAMPLE_STYLES);
    const entries = extractStyles(root);
    const out = formatStylesInspection("C:/ui/Sample.styles", entries);
    expect(out).toContain("# Styles: C:/ui/Sample.styles");
    expect(out).toContain("Total styles:** ");
    expect(out).toContain("PrimaryButton");
    expect(out).toContain("`Color` = 0.2 0.6 1 1");
    expect(out).toContain("TitleHeader");
    expect(out).toContain("`ExactFontSize` = 24");
  });
});
