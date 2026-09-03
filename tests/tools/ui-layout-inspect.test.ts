import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  toWidgetNode,
  countWidgets,
  formatWidgetTree,
} from "../../src/tools/ui-layout-inspect.js";

// A small but representative layout: an OverlayWidget root with a Slot and a
// Children { ... } container holding two leaf widgets — including one with
// m_iWidth / m_iHeight to exercise the size projection.
const SAMPLE_LAYOUT = `OverlayWidget "{AAAA000000000001}" {
 Name "RootOverlay"
 Slot "OverlayWidgetSlot {BBBB000000000002}" {
  Anchor "0 0 1 1"
  Offset "0 0 0 0"
 }
 Children {
  TextWidgetClass "{CCCC000000000003}" {
   Name "TitleText"
   Text "Hello"
   m_iWidth 240
   m_iHeight 32
   Slot "FrameWidgetSlot {DDDD000000000004}" {
    Anchor "0 0 1 0"
    Offset "10 5 -10 25"
   }
  }
  ImageWidgetClass "{EEEE000000000005}" {
   Name "BackgroundImage"
   Slot "FrameWidgetSlot {FFFF000000000006}" {
    Anchor "0 0 1 1"
    Offset "0 0 0 0"
   }
  }
 }
}`;

describe("ui-layout-inspect: toWidgetNode", () => {
  it("flattens Children { ... } wrappers and pulls Slot anchor/offset onto the widget", () => {
    const root = toWidgetNode(parse(SAMPLE_LAYOUT));
    expect(root.type).toBe("OverlayWidget");
    expect(root.name).toBe("RootOverlay");
    expect(root.anchor).toBe("0 0 1 1");
    expect(root.offset).toBe("0 0 0 0");
    // Two children, in source order — Children wrapper was flattened.
    expect(root.children).toHaveLength(2);
    expect(root.children[0].name).toBe("TitleText");
    expect(root.children[0].type).toBe("TextWidgetClass");
    expect(root.children[0].width).toBe("240");
    expect(root.children[0].height).toBe("32");
    expect(root.children[1].name).toBe("BackgroundImage");
  });

  it("counts widgets including the root", () => {
    const root = toWidgetNode(parse(SAMPLE_LAYOUT));
    expect(countWidgets(root)).toBe(3);
  });
});

describe("ui-layout-inspect: formatWidgetTree", () => {
  it("renders heading, totals, and each widget with key fields", () => {
    const widget = toWidgetNode(parse(SAMPLE_LAYOUT));
    const out = formatWidgetTree(widget, "C:/ui/Sample.layout");
    expect(out).toContain("# Layout: C:/ui/Sample.layout");
    expect(out).toContain("Total widgets:** 3");
    expect(out).toContain("- OverlayWidget [RootOverlay]");
    expect(out).toContain("TextWidgetClass [TitleText]");
    expect(out).toContain("ImageWidgetClass [BackgroundImage]");
    expect(out).toContain("anchor=0 0 1 0");
    expect(out).toContain("w=240");
  });
});
