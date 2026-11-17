import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import type { ActionError, ActionOk } from "../../src/manifest/vocabulary.js";
import {
  registerLayoutEdit,
  runLayoutEdit,
  type LayoutEditArgs,
} from "../../src/tools/layout-edit.js";
import { loadBaseline, openVanillaCorpus } from "../corpus/_corpus.js";

// A layout in the shape of the vanilla ones: one space of indent, LF, no final line ending,
// children in a header-less block after the properties.
const SAMPLE = [
  "FrameWidgetClass {",
  ' Name "Root"',
  " {",
  '  OverlayWidgetClass "{0000000000000001}" {',
  '   Name "Panel"',
  '   Slot FrameWidgetSlot "{0000000000000011}" {',
  "    PositionX 10",
  "    PositionY 20",
  "    SizeX 100",
  "    SizeY 50",
  "   }",
  "   Clipping False",
  "   {",
  '    TextWidgetClass "{0000000000000002}" {',
  '     Name "m_Title"',
  '     Slot OverlayWidgetSlot "{0000000000000012}" {',
  "      HorizontalAlign 3",
  "     }",
  '     Text "Hello"',
  "    }",
  '    ImageWidgetClass "{0000000000000003}" {',
  '     Name "Icon"',
  '     Slot OverlayWidgetSlot "{0000000000000013}" {',
  "     }",
  "    }",
  "   }",
  "  }",
  '  TextWidgetClass "{0000000000000004}" {',
  '   Name "Footer"',
  '   Slot FrameWidgetSlot "{0000000000000014}" {',
  "   }",
  "   components {",
  '    SCR_InputButtonComponent "{0000000000000024}" {',
  '     m_sActionName "Foo"',
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

const dir = mkdtempSync(join(tmpdir(), "layout-edit-"));
const outside = mkdtempSync(join(tmpdir(), "layout-edit-out-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const config = { projectPath: dir, gamePath: "", dataDir: "" } as Config;
const FILE = join(dir, "UI", "t.layout");
const REL = "UI/t.layout";

beforeEach(() => {
  rmSync(join(dir, "UI"), { recursive: true, force: true });
  rmSync(join(dir, "scripts"), { recursive: true, force: true });
  mkdirSync(join(dir, "UI"), { recursive: true });
  writeFileSync(FILE, SAMPLE);
});

type Args = Omit<LayoutEditArgs, "path"> & { path?: string };
const run = (a: Args, cfg: Config = config): ActionOk | ActionError =>
  runLayoutEdit({ path: REL, ...a } as LayoutEditArgs, cfg);
const ok = (a: Args, cfg?: Config): ActionOk => {
  const r = run(a, cfg);
  if (!r.ok) throw new Error(`${a.action}: ${r.code} ${r.message}`);
  return r;
};
const refused = (a: Args, cfg?: Config): ActionError => {
  const r = run(a, cfg);
  if (r.ok) throw new Error(`${a.action} was not refused`);
  return r;
};
const rb = (r: ActionOk): Record<string, unknown> => r.readback as Record<string, unknown>;
const text = (): string => readFileSync(FILE, "utf8");

describe("the layout_edit tool registration", () => {
  it("registers layout_edit with a description of at most 400 characters", () => {
    let name = "";
    let description = "";
    registerLayoutEdit(
      {
        registerTool: (n: string, def: { description: string }) => {
          name = n;
          description = def.description;
        },
      } as never,
      config,
    );
    expect(name).toBe("layout_edit");
    expect(description.length).toBeLessThanOrEqual(400);
  });

  it("answers JSON through the registered handler", async () => {
    let handler: (a: Record<string, unknown>) => Promise<{
      content: { text: string }[];
      isError: boolean;
    }> = async () => ({ content: [], isError: false });
    registerLayoutEdit(
      { registerTool: (_n: string, _d: unknown, h: typeof handler) => (handler = h) } as never,
      config,
    );
    const good = await handler({ action: "read", path: REL });
    expect(good.isError).toBe(false);
    expect(JSON.parse(good.content[0].text).ok).toBe(true);
    const bad = await handler({ action: "read", path: "UI/none.layout" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).code).toBe("PATH_NOT_FOUND");
  });
});

describe("read", () => {
  it("outlines the tree with paths, and details one widget", () => {
    const r = ok({ action: "read" });
    expect(rb(r).outline).toEqual([
      '[root] FrameWidgetClass "Root"',
      '  [0] OverlayWidgetClass "Panel" slot=FrameWidgetSlot',
      '    [0/0] TextWidgetClass "m_Title" slot=OverlayWidgetSlot',
      '    [0/1] ImageWidgetClass "Icon" slot=OverlayWidgetSlot',
      '  [1] TextWidgetClass "Footer" slot=FrameWidgetSlot',
    ]);
    expect(rb(r).widgets).toBe(5);
    const d = rb(ok({ action: "read", widget: "Panel" })).widget as Record<string, unknown>;
    expect(d.guid).toBe("0000000000000001");
    expect(d.slot).toMatchObject({
      class: "FrameWidgetSlot",
      properties: { PositionX: "10", SizeY: "50" },
    });
    expect(d.properties).toEqual({ Name: '"Panel"', Clipping: "False" });
    const f = rb(ok({ action: "read", widget: "{0000000000000004}" })).widget as {
      components: { class: string }[];
    };
    expect(f.components[0].class).toBe("SCR_InputButtonComponent");
  });

  it("pages the outline and refuses a stale cursor", () => {
    const first = ok({ action: "read", limit: 2 });
    expect(rb(first).outline).toHaveLength(2);
    expect(rb(first).nextCursor).toBe("2:5");
    const second = ok({ action: "read", limit: 2, cursor: "2:5" });
    expect(rb(second).outline).toHaveLength(2);
    expect(refused({ action: "read", limit: 2, cursor: "2:9" }).code).toBe("STALE_CURSOR");
  });

  it("reads a file inside the project by absolute path, and refuses one outside", () => {
    expect(ok({ action: "read", path: FILE }).ok).toBe(true);
    writeFileSync(join(outside, "x.layout"), SAMPLE);
    expect(refused({ action: "read", path: join(outside, "x.layout") }).code).toBe("ABSOLUTE_PATH");
  });

  it("says so when a game resource cannot be read", () => {
    const r = refused({ action: "read", path: "UI/layouts/Nope.layout" });
    expect(r.code).toBe("PATH_NOT_FOUND");
    expect(r.message).toContain("ENFUSION_GAME_PATH");
  });

  it("reads a file that does not parse cleanly, and says edits are refused", () => {
    writeFileSync(FILE, 'FrameWidgetClass {\n Name "open\n}');
    const r = ok({ action: "read" });
    expect(r.warnings.join(" ")).toContain("does not parse cleanly");
    expect(refused({ action: "setProperty", property: "Name", value: "x" }).message).toContain(
      "does not parse cleanly",
    );
  });
});

describe("dry run and confirm", () => {
  const cases: Args[] = [
    { action: "addWidget", parent: "Panel", widgetClass: "TextWidgetClass", name: "New", index: 1 },
    { action: "removeWidget", widget: "Icon" },
    { action: "moveWidget", widget: "Footer", parent: "Panel", index: 0 },
    { action: "duplicateWidget", widget: "Footer" },
    { action: "wrap", widget: "Footer", wrapper: "SizeLayoutWidgetClass", name: "Wrap" },
    { action: "convert", widget: "Panel", toClass: "FrameWidgetClass" },
    { action: "setProperty", widget: "Panel", property: "Slot.PositionX", value: 15 },
  ];

  for (const c of cases) {
    it(`${c.action}: the dry run writes nothing and confirm writes exactly the announced change`, () => {
      const dry = ok(c);
      expect(text()).toBe(SAMPLE);
      expect(rb(dry).dryRun).toBe(true);
      expect(String(rb(dry).diff)).toContain("@@");
      expect(dry.next).toContain("confirm: true");
      expect(dry.changed?.length).toBeGreaterThan(0);
      const done = ok({ ...c, confirm: true });
      expect(rb(done).dryRun).toBe(false);
      expect(rb(done).verified).toBe(true);
      expect(rb(done).sha256After).toBe(rb(dry).sha256After);
      expect(sha(readFileSync(FILE))).toBe(rb(dry).sha256After);
      expect(done.changed).toEqual(dry.changed);
      expect(text()).not.toBe(SAMPLE);
    });
  }

  it("saveAsPrefab and genClass: the dry run creates nothing, confirm creates the announced file", () => {
    for (const c of [
      { action: "saveAsPrefab", widget: "Panel", to: "UI/p.layout" },
      { action: "genClass", to: "scripts/Game/UI/G.c" },
    ] as Args[]) {
      const to = c.to as string;
      const dry = ok(c);
      expect(existsSync(join(dir, to))).toBe(false);
      expect(rb(dry).dryRun).toBe(true);
      const done = ok({ ...c, confirm: true });
      expect(rb(done).verified).toBe(true);
      expect(rb(done).sha256).toBe(rb(dry).sha256);
      expect(sha(readFileSync(join(dir, to)))).toBe(rb(dry).sha256);
    }
  });

  it("an edit that changes nothing writes nothing", () => {
    const r = ok({
      action: "setProperty",
      widget: "Panel",
      property: "Slot.PositionX",
      value: 10,
      confirm: true,
    });
    expect(r.changed).toEqual([]);
    expect(rb(r).written).toBe(false);
    expect(text()).toBe(SAMPLE);
  });
});

describe("addWidget", () => {
  it("adds a child in the vanilla style, with the slot class of its parent and fresh GUIDs", () => {
    ok({
      action: "addWidget",
      parent: "Panel",
      widgetClass: "TextWidgetClass",
      name: "New",
      index: 1,
      props: { Text: "x", Clipping: false },
      slot: { props: { HorizontalAlign: 3 } },
      confirm: true,
    });
    const t = text();
    expect(t).toMatch(
      /^ {4}TextWidgetClass "\{[0-9A-F]{16}\}" \{\n {5}Name "New"\n {5}Slot OverlayWidgetSlot "\{[0-9A-F]{16}\}" \{\n {6}HorizontalAlign 3\n {5}\}\n {5}Text "x"\n {5}Clipping 0\n {4}\}\n {4}ImageWidgetClass/m,
    );
    expect(rb(ok({ action: "read" })).widgets).toBe(6);
    expect(t.split("\n").length).toBe(SAMPLE.split("\n").length + 8);
  });

  it("is deterministic for one file and one request", () => {
    const a = ok({ action: "addWidget", widgetClass: "FrameWidgetClass" });
    const b = ok({ action: "addWidget", widgetClass: "FrameWidgetClass" });
    expect(a.changed).toEqual(b.changed);
    const guids = [...String(a.changed?.[0].after).matchAll(/\{([0-9A-F]{16})\}/g)].map(
      (m) => m[1],
    );
    expect(new Set(guids).size).toBe(guids.length);
    for (const g of guids) expect(SAMPLE).not.toContain(g);
  });

  it("creates the children block of a parent that has none, and warns on a leaf parent", () => {
    const r = ok({
      action: "addWidget",
      parent: "Icon",
      widgetClass: "TextWidgetClass",
      confirm: true,
    });
    expect(r.warnings.join(" ")).toContain("carries no children");
    expect(text()).toMatch(
      /Name "Icon"\n {5}Slot OverlayWidgetSlot[^\n]*\n {5}\}\n {5}\{\n {6}TextWidgetClass/,
    );
  });

  it("puts a widget block given as text where asked, and refuses reused GUIDs and names", () => {
    const frag = ['TextWidgetClass "{00000000000000AA}" {', ' Name "Fresh"', "}"].join("\n");
    ok({ action: "addWidget", parent: "root", index: 0, text: frag, confirm: true });
    expect(text()).toContain(
      '  TextWidgetClass "{00000000000000AA}" {\n   Name "Fresh"\n  }\n  OverlayWidgetClass',
    );
    expect(refused({ action: "addWidget", text: frag }).message).toContain("reuses");
    const clash = frag.replace("00000000000000AA", "00000000000000AB").replace("Fresh", "Footer");
    expect(refused({ action: "addWidget", text: clash }).message).toContain("name");
    expect(refused({ action: "addWidget", text: "not a widget" }).code).toBe("INVALID_ARGUMENT");
  });

  it("refuses a duplicate name, a bad class, a bad index, an unknown parent, both text and class", () => {
    expect(
      refused({ action: "addWidget", widgetClass: "TextWidgetClass", name: "Icon" }).message,
    ).toContain("exists");
    expect(refused({ action: "addWidget", widgetClass: "Text" }).message).toContain("WidgetClass");
    expect(refused({ action: "addWidget" }).message).toContain("widgetClass");
    expect(
      refused({ action: "addWidget", widgetClass: "TextWidgetClass", index: 9 }).message,
    ).toContain("out of range");
    expect(
      refused({ action: "addWidget", parent: "Nope", widgetClass: "TextWidgetClass" }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      refused({ action: "addWidget", parent: "5/5", widgetClass: "TextWidgetClass" }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      refused({ action: "addWidget", widgetClass: "TextWidgetClass", text: "x" }).message,
    ).toContain("not both");
  });
});

describe("removeWidget", () => {
  it("removes a subtree and says what went", () => {
    const r = ok({ action: "removeWidget", widget: "Panel", confirm: true });
    expect(r.warnings.join(" ")).toContain("2 child widget(s)");
    expect(String(r.changed?.[0].before)).toContain('Name "Panel"');
    expect(text()).not.toContain("Panel");
    expect(text()).toContain("Footer");
  });

  it("takes the children block with its last child", () => {
    ok({ action: "removeWidget", widget: "Footer", confirm: true });
    ok({ action: "removeWidget", widget: "Panel", confirm: true });
    expect(text()).toBe('FrameWidgetClass {\n Name "Root"\n}');
  });

  it("refuses the root and an unknown widget", () => {
    expect(refused({ action: "removeWidget", widget: "root" }).message).toContain("root");
    expect(refused({ action: "removeWidget", widget: "Ghost" }).code).toBe("PATH_NOT_FOUND");
    expect(refused({ action: "removeWidget" }).message).toContain("root");
  });

  it("is undone by addWidget with the before text", () => {
    const r = ok({ action: "removeWidget", widget: "Icon", confirm: true });
    ok({
      action: "addWidget",
      parent: "Panel",
      index: 1,
      text: String(r.changed?.[0].before),
      confirm: true,
    });
    expect(text()).toBe(SAMPLE);
  });
});

describe("moveWidget", () => {
  it("moves a widget to another parent at an index, with the destination slot class warned about", () => {
    const r = ok({
      action: "moveWidget",
      widget: "Footer",
      parent: "Panel",
      index: 0,
      confirm: true,
    });
    expect(r.warnings.join(" ")).toContain("OverlayWidgetSlot");
    const out = rb(ok({ action: "read" })).outline as string[];
    expect(out[2]).toContain('[0/0] TextWidgetClass "Footer"');
    expect(out[3]).toContain('"m_Title"');
    expect(out).toHaveLength(5);
  });

  it("reorders inside one parent and is undone by the move back", () => {
    ok({ action: "moveWidget", widget: "Icon", parent: "Panel", index: 0, confirm: true });
    expect((rb(ok({ action: "read", widget: "Panel" })).outline as string[])[1]).toContain(
      '"Icon"',
    );
    ok({ action: "moveWidget", widget: "Icon", parent: "Panel", index: 1, confirm: true });
    expect(text()).toBe(SAMPLE);
  });

  it("moves across parents and back byte for byte", () => {
    ok({ action: "moveWidget", widget: "Footer", parent: "Panel", index: 0, confirm: true });
    ok({ action: "moveWidget", widget: "Footer", parent: "root", index: 1, confirm: true });
    expect(text()).toBe(SAMPLE);
  });

  it("refuses the root, a move under itself, a bad index and a no-op as a no-change reply", () => {
    expect(refused({ action: "moveWidget", widget: "root", parent: "Panel" }).message).toContain(
      "root",
    );
    expect(refused({ action: "moveWidget", widget: "Panel", parent: "Icon" }).message).toContain(
      "under itself",
    );
    expect(
      refused({ action: "moveWidget", widget: "Panel", parent: "root", index: 9 }).message,
    ).toContain("out of range");
    const same = ok({
      action: "moveWidget",
      widget: "Panel",
      parent: "root",
      index: 0,
      confirm: true,
    });
    expect(same.changed).toEqual([]);
    expect(text()).toBe(SAMPLE);
  });
});

describe("duplicateWidget", () => {
  it("copies a subtree with new GUIDs and unique names", () => {
    const r = ok({ action: "duplicateWidget", widget: "Panel", name: "Panel2", confirm: true });
    const t = text();
    expect(t.match(/OverlayWidgetClass/g)).toHaveLength(2);
    expect(t).toContain('Name "Panel2"');
    expect(t).toContain('Name "m_Title_copy"');
    expect(t).toContain('Name "Icon_copy"');
    const guids = [...t.matchAll(/"\{([0-9A-F]{16})\}"/g)].map((m) => m[1]);
    expect(new Set(guids).size).toBe(guids.length);
    expect(r.warnings.join(" ")).toContain("names made unique");
    expect((rb(ok({ action: "read" })).outline as string[])[4]).toContain('"Panel2"');
  });

  it("is undone by removing the copy, and refuses the root and a taken name", () => {
    ok({ action: "duplicateWidget", widget: "Footer", confirm: true });
    ok({ action: "removeWidget", widget: "2", confirm: true });
    expect(text()).toBe(SAMPLE);
    expect(refused({ action: "duplicateWidget", widget: "root" }).message).toContain("root");
    expect(
      refused({ action: "duplicateWidget", widget: "Footer", name: "Icon" }).message,
    ).toContain("exists");
  });
});

describe("wrap", () => {
  it("wraps a widget; the wrapper takes the slot, the widget gets a slot of the wrapper's kind", () => {
    const r = ok({
      action: "wrap",
      widget: "Footer",
      wrapper: "SizeLayoutWidgetClass",
      name: "W",
      confirm: true,
    });
    const t = text();
    expect(t).toContain('  SizeLayoutWidgetClass "{');
    expect(t).toContain(
      '   Name "W"\n   Slot FrameWidgetSlot "{0000000000000014}" {\n   }\n   {\n    TextWidgetClass "{0000000000000004}" {',
    );
    expect(t).toMatch(
      /Name "Footer"\n {5}Slot AlignableSlot "\{[0-9A-F]{16}\}" \{\n {5}\}\n {5}components/,
    );
    expect(r.warnings.join(" ")).toContain("AlignableSlot");
    expect((rb(ok({ action: "read" })).outline as string[]).join("\n")).toContain(
      "[1/0] TextWidgetClass",
    );
  });

  it("is undone by unwrap, byte for byte", () => {
    ok({ action: "wrap", widget: "Footer", wrapper: "SizeLayoutWidgetClass", confirm: true });
    ok({ action: "wrap", widget: "1", unwrap: true, confirm: true });
    expect(text()).toBe(SAMPLE);
  });

  it("refuses the root, a leaf wrapper, a taken name, a wrapper with other properties, no wrapper", () => {
    expect(
      refused({ action: "wrap", widget: "root", wrapper: "FrameWidgetClass" }).message,
    ).toContain("root");
    expect(
      refused({ action: "wrap", widget: "Icon", wrapper: "TextWidgetClass" }).message,
    ).toContain("container");
    expect(
      refused({ action: "wrap", widget: "Icon", wrapper: "FrameWidgetClass", name: "Footer" })
        .message,
    ).toContain("exists");
    expect(refused({ action: "wrap", widget: "Icon" }).message).toContain("wrapper");
    expect(refused({ action: "wrap", widget: "Footer", unwrap: true }).message).toContain(
      "exactly one child",
    );
    ok({ action: "removeWidget", widget: "m_Title", confirm: true });
    expect(refused({ action: "wrap", widget: "Panel", unwrap: true }).message).toContain(
      "Clipping",
    );
  });
});

describe("convert", () => {
  it("changes the class, and re-slots the children, dropping slot properties the new slot lacks", () => {
    ok({
      action: "addWidget",
      parent: "Footer",
      widgetClass: "ImageWidgetClass",
      slot: { class: "FrameWidgetSlot", props: { PositionX: 4, Padding: [1, 1, 1, 1] } },
      confirm: true,
    });
    const r = ok({
      action: "convert",
      widget: "Footer",
      toClass: "OverlayWidgetClass",
      confirm: true,
    });
    const t = text();
    expect(t).toContain('OverlayWidgetClass "{0000000000000004}"');
    const paths = (r.changed ?? []).map((c) => c.path);
    expect(paths).toContain("widget 1.class");
    expect(paths).toContain("widget 1/0.Slot.class");
    expect(paths).toContain("widget 1/0.Slot.PositionX");
    expect(t).not.toContain("PositionX 4");
    expect(t).toContain("Padding 1 1 1 1");
    expect(r.warnings.join(" ")).toContain("old class stay");
  });

  it("converts back to the same bytes when no slot property was dropped", () => {
    ok({ action: "convert", widget: "Footer", toClass: "ImageWidgetClass", confirm: true });
    ok({ action: "convert", widget: "Footer", toClass: "TextWidgetClass", confirm: true });
    expect(text()).toBe(SAMPLE);
  });

  it("refuses the same class, a leaf class over children, a bad class and an instance of a base layout", () => {
    expect(
      refused({ action: "convert", widget: "Footer", toClass: "TextWidgetClass" }).message,
    ).toContain("already");
    expect(
      refused({ action: "convert", widget: "Panel", toClass: "ImageWidgetClass" }).message,
    ).toContain("child widget");
    expect(refused({ action: "convert", widget: "Footer", toClass: "Image" }).message).toContain(
      "WidgetClass",
    );
    expect(refused({ action: "convert", widget: "Footer" }).message).toContain("toClass");
    writeFileSync(
      FILE,
      SAMPLE.replace(
        'TextWidgetClass "{0000000000000004}"',
        'ButtonWidgetClass "{0000000000000004}" : "{AAAAAAAAAAAAAAAA}UI/b.layout"',
      ),
    );
    expect(
      refused({ action: "convert", widget: "Footer", toClass: "TextWidgetClass" }).message,
    ).toContain("base layout");
  });
});

describe("setProperty", () => {
  it("changes a value and keeps its quoting", () => {
    const r = ok({
      action: "setProperty",
      widget: "m_Title",
      property: "Text",
      value: "Bye",
      confirm: true,
    });
    expect(r.changed).toEqual([{ path: "widget 0/0.Text", before: '"Hello"', after: '"Bye"' }]);
    expect(text()).toContain('     Text "Bye"');
    ok({
      action: "setProperty",
      widget: "Panel",
      property: "Slot.SizeX",
      value: 150,
      confirm: true,
    });
    expect(text()).toContain("    SizeX 150");
  });

  it("keeps the True/False style of a bool and adds a new property before the children block", () => {
    ok({
      action: "setProperty",
      widget: "Panel",
      property: "Clipping",
      value: true,
      confirm: true,
    });
    expect(text()).toContain("   Clipping True\n");
    ok({ action: "setProperty", widget: "Panel", property: "Hint", value: "tip", confirm: true });
    expect(text()).toContain('   Clipping True\n   Hint "tip"\n   {\n');
  });

  it("sets a component property and a nested slot property, and warns on a slot key the class lacks", () => {
    ok({
      action: "setProperty",
      widget: "Footer",
      property: "components.SCR_InputButtonComponent.m_sActionName",
      value: "Bar",
      confirm: true,
    });
    expect(text()).toContain('m_sActionName "Bar"');
    const r = ok({
      action: "setProperty",
      widget: "Footer",
      property: "Slot.FillWeight",
      value: 2,
    });
    expect(r.warnings.join(" ")).toContain("FillWeight");
  });

  it("writes a value list on one line and removes a property with null", () => {
    ok({
      action: "setProperty",
      widget: "Panel",
      property: "Slot.Alignment",
      value: [0.5, 0.5],
      confirm: true,
    });
    expect(text()).toContain("    Alignment 0.5 0.5");
    ok({
      action: "setProperty",
      widget: "Panel",
      property: "Slot.Alignment",
      value: null,
      confirm: true,
    });
    expect(text()).toBe(SAMPLE);
  });

  it("refuses a name that is taken, an empty name, a missing property to remove, a bad path", () => {
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "Name", value: "Footer" }).message,
    ).toContain("exists");
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "Name", value: "" }).message,
    ).toContain("non-empty");
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "Text", value: null }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "Slot..x", value: 1 }).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "[1].x", value: 1 }).message,
    ).toContain("name");
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "Slot", value: 1 }).message,
    ).toContain("not a scalar");
    expect(refused({ action: "setProperty", widget: "Icon", property: "Text" }).message).toContain(
      "value",
    );
    expect(refused({ action: "setProperty", widget: "Icon" }).message).toContain("property");
    expect(
      refused({ action: "setProperty", widget: "Icon", property: "Nothing.here", value: 1 }).code,
    ).toBe("PATH_NOT_FOUND");
  });

  it("changes the root widget", () => {
    ok({ action: "setProperty", property: "Name", value: "Top", confirm: true });
    expect(text().startsWith('FrameWidgetClass {\n Name "Top"\n {')).toBe(true);
  });
});

describe("saveAsPrefab", () => {
  it("writes the widget as the root of a new layout, without its instance GUID, and leaves the source alone", () => {
    const r = ok({ action: "saveAsPrefab", widget: "Panel", to: "UI/Sub/p.layout", confirm: true });
    const made = readFileSync(join(dir, "UI", "Sub", "p.layout"), "utf8");
    expect(
      made.startsWith(
        'OverlayWidgetClass {\n Name "Panel"\n Slot FrameWidgetSlot "{0000000000000011}" {',
      ),
    ).toBe(true);
    expect(made.endsWith("}")).toBe(true);
    expect(made).toContain('  TextWidgetClass "{0000000000000002}" {');
    expect(text()).toBe(SAMPLE);
    expect(r.next).toContain("wb_resources register");
    expect(r.warnings.join(" ")).toContain("creates the folder");
    // the new file is itself a layout the tool reads and edits
    expect(ok({ action: "read", path: "UI/Sub/p.layout" }).ok).toBe(true);
  });

  it("keeps a base layout reference in the header", () => {
    writeFileSync(
      FILE,
      SAMPLE.replace(
        'TextWidgetClass "{0000000000000004}" {',
        'TextWidgetClass "{0000000000000004}" : "{AAAAAAAAAAAAAAAA}UI/b.layout" {',
      ),
    );
    ok({ action: "saveAsPrefab", widget: "Footer", to: "UI/f.layout", confirm: true });
    expect(readFileSync(join(dir, "UI", "f.layout"), "utf8").split("\n")[0]).toBe(
      'TextWidgetClass : "{AAAAAAAAAAAAAAAA}UI/b.layout" {',
    );
  });

  it("never replaces an existing file without overwrite, and never the source", () => {
    writeFileSync(join(dir, "UI", "p.layout"), "keep");
    const r = refused({
      action: "saveAsPrefab",
      widget: "Panel",
      to: "UI/p.layout",
      confirm: true,
    });
    expect(r.message).toContain("overwrite");
    expect(readFileSync(join(dir, "UI", "p.layout"), "utf8")).toBe("keep");
    ok({
      action: "saveAsPrefab",
      widget: "Panel",
      to: "UI/p.layout",
      overwrite: true,
      confirm: true,
    });
    expect(readFileSync(join(dir, "UI", "p.layout"), "utf8")).toContain("OverlayWidgetClass");
    expect(
      refused({ action: "saveAsPrefab", widget: "Panel", to: REL, overwrite: true, confirm: true })
        .message,
    ).toContain("being read");
    expect(text()).toBe(SAMPLE);
  });

  it("refuses a missing to, a wrong extension and a path outside the project", () => {
    expect(refused({ action: "saveAsPrefab", widget: "Panel" }).message).toContain("to");
    expect(refused({ action: "saveAsPrefab", widget: "Panel", to: "UI/p.txt" }).message).toContain(
      ".layout",
    );
    expect(refused({ action: "saveAsPrefab", widget: "Panel", to: "../p.layout" }).code).toBe(
      "ABSOLUTE_PATH",
    );
    expect(
      refused({ action: "saveAsPrefab", widget: "Panel", to: join(outside, "p.layout") }).code,
    ).toBe("ABSOLUTE_PATH");
  });
});

describe("genClass", () => {
  const GEN = [
    "FrameWidgetClass {",
    ' Name "Root"',
    " components {",
    '  SCR_WidgetExportRuleRoot "{0000000000000090}" {',
    '   DestinationPath "{0123456789ABCDEF}scripts/Game/UI/"',
    '   ScriptClassNamePrefix "T_"',
    '   ScriptClassNameSuffix "Gen"',
    "   GenerateFullWidgetPath 0",
    "  }",
    " }",
    " {",
    '  TextWidgetClass "{0000000000000091}" {',
    '   Name "m_Title"',
    "   components {",
    '    SCR_InputButtonComponent "{0000000000000092}" {',
    "    }",
    "   }",
    "  }",
    '  OverlayWidgetClass "{0000000000000093}" {',
    '   Name "m_Group"',
    "   {",
    '    ImageWidgetClass "{0000000000000094}" {',
    '     Name "m_Nested"',
    "    }",
    '    ImageWidgetClass "{0000000000000095}" {',
    '     Name "Plain"',
    "    }",
    '    ImageWidgetClass "{0000000000000096}" {',
    '     Name "m_has space"',
    "    }",
    "   }",
    "  }",
    '  FrameWidgetClass "{0000000000000097}" {',
    '   Name "m_Off"',
    "   components {",
    '    SCR_WidgetExportRule "{0000000000000098}" {',
    "     ExportChildWidgets 0",
    "    }",
    "   }",
    "   {",
    '    ImageWidgetClass "{0000000000000099}" {',
    '     Name "m_Hidden"',
    "    }",
    "   }",
    "  }",
    " }",
    "}",
  ].join("\n");
  const SEP = "\t//" + "-".repeat(96);

  it("writes the class the plugin would: variables, binding by name, components, defaults from the root rule", () => {
    writeFileSync(join(dir, "UI", "gen.layout"), GEN);
    writeFileSync(
      join(dir, "UI", "gen.layout.meta"),
      'MetaFileClass {\n Name "{FEDCBA9876543210}UI/gen.layout"\n}',
    );
    const r = ok({ action: "genClass", path: "UI/gen.layout", confirm: true });
    const made = readFileSync(join(dir, "scripts", "Game", "UI", "T_genGen.c"), "utf8");
    expect(made).toBe(
      "// Autogenerated by the Generate Class from Layout plugin v0.5.1\n" +
        "// Layout file: UI/gen.layout\n" +
        "class T_genGen\n{\n" +
        '\tprotected static const ResourceName LAYOUT = "{FEDCBA9876543210}UI/gen.layout";\n\n' +
        "\tTextWidget m_wTitle;\n" +
        "\tSCR_InputButtonComponent m_TitleComponent;\n\n" +
        "\tOverlayWidget m_wGroup;\n" +
        "\tImageWidget m_wNested;\n" +
        "\n" +
        `${SEP}\n` +
        "\tbool Init(notnull Widget root)\n\t{\n" +
        '\t\tm_wTitle = TextWidget.Cast(root.FindAnyWidget("m_Title"));\n' +
        "\t\tm_TitleComponent = SCR_InputButtonComponent.Cast(m_wTitle.FindHandler(SCR_InputButtonComponent));\n\n" +
        '\t\tm_wGroup = OverlayWidget.Cast(root.FindAnyWidget("m_Group"));\n' +
        '\t\tm_wNested = ImageWidget.Cast(root.FindAnyWidget("m_Nested"));\n' +
        "\n" +
        "\t\treturn true;\n\t}\n\n" +
        `${SEP}\n` +
        "\tResourceName GetLayout()\n\t{\n\t\treturn LAYOUT;\n\t}\n" +
        "}\n",
    );
    expect(r.warnings.join(" ")).toContain("contains a space");
    expect(r.next).toContain("T_genGen");
    expect((rb(r).content as string[])[2]).toBe("class T_genGen");
  });

  it("binds by full path when the root rule asks for it, and warns when the layout has no rule or meta", () => {
    const r = ok({
      action: "genClass",
      to: "scripts/Game/UI/S.c",
      className: "SCR_SampleWidgets",
      confirm: true,
    });
    const made = readFileSync(join(dir, "scripts", "Game", "UI", "S.c"), "utf8");
    expect(made).toContain("class SCR_SampleWidgets\n{");
    expect(made).toContain('LAYOUT = "UI/t.layout";');
    expect(made).toContain('m_wTitle = TextWidget.Cast(root.FindWidget("Panel.m_Title"));');
    expect(r.warnings.join(" ")).toContain("no SCR_WidgetExportRuleRoot");
    expect(r.warnings.join(" ")).toContain("no .meta");
  });

  it("refuses a missing destination, a wrong extension, a bad class name and an existing file", () => {
    expect(refused({ action: "genClass" }).message).toContain("DestinationPath");
    expect(refused({ action: "genClass", to: "scripts/x.txt" }).message).toContain(".c");
    expect(refused({ action: "genClass", to: "scripts/x.c", className: "1bad" }).message).toContain(
      "class name",
    );
    ok({ action: "genClass", to: "scripts/x.c", confirm: true });
    expect(refused({ action: "genClass", to: "scripts/x.c", confirm: true }).message).toContain(
      "overwrite",
    );
    expect(ok({ action: "genClass", to: "scripts/x.c", overwrite: true, confirm: true }).ok).toBe(
      true,
    );
    expect(refused({ action: "genClass", to: "../x.c" }).code).toBe("ABSOLUTE_PATH");
  });
});

describe("refusals", () => {
  it("refuses a path that escapes the project", () => {
    for (const p of ["../x.layout", "UI/../../x.layout", "UI/..\\..\\x.layout"]) {
      expect(
        refused({ action: "setProperty", path: p, property: "Name", value: "x", confirm: true })
          .code,
      ).toBe("ABSOLUTE_PATH");
    }
    writeFileSync(join(outside, "x.layout"), SAMPLE);
    const r = refused({
      action: "setProperty",
      path: join(outside, "x.layout"),
      property: "Name",
      value: "x",
      confirm: true,
    });
    expect(r.code).toBe("ABSOLUTE_PATH");
    expect(readFileSync(join(outside, "x.layout"), "utf8")).toBe(SAMPLE);
    expect(refused({ action: "read", path: "-rf.layout" }).code).toBe("INVALID_ARGUMENT");
    expect(refused({ action: "read", path: "file:///x.layout" }).code).toBe("ABSOLUTE_PATH");
  });

  it("refuses a link that points out of the project", () => {
    writeFileSync(join(outside, "linked.layout"), SAMPLE);
    try {
      symlinkSync(outside, join(dir, "UI", "link"), "junction");
    } catch {
      return; // no permission to link here: nothing to test
    }
    const r = refused({
      action: "setProperty",
      path: "UI/link/linked.layout",
      property: "Name",
      value: "x",
      confirm: true,
    });
    expect(r.code).toBe("ABSOLUTE_PATH");
    expect(readFileSync(join(outside, "linked.layout"), "utf8")).toBe(SAMPLE);
  });

  it("refuses a file that is not a .layout, a file that does not exist, and a write with no project", () => {
    expect(refused({ action: "read", path: "UI/t.txt" }).message).toContain(".layout");
    const missing = refused({
      action: "addWidget",
      path: "UI/none.layout",
      widgetClass: "FrameWidgetClass",
      confirm: true,
    });
    expect(missing.code).toBe("PATH_NOT_FOUND");
    expect(existsSync(join(dir, "UI", "none.layout"))).toBe(false);
    const none = refused({ action: "addWidget", widgetClass: "FrameWidgetClass", confirm: true }, {
      ...config,
      projectPath: "",
    } as Config);
    expect(none.code).toBe("NOT_IN_PROJECT");
  });

  it("refuses to write a game resource, and says to copy it first", () => {
    const r = refused({
      action: "setProperty",
      path: "UI/layouts/Vanilla.layout",
      property: "Name",
      value: "x",
      confirm: true,
    });
    expect(r.code).toBe("PATH_NOT_FOUND");
    expect(r.next).toContain("game_duplicate");
  });

  it("refuses a file with more than one root, or text that is not a widget block", () => {
    writeFileSync(FILE, `${SAMPLE}\nFrameWidgetClass {\n}`);
    expect(refused({ action: "removeWidget", widget: "0" }).message).toContain("one root widget");
    writeFileSync(FILE, "just text");
    expect(refused({ action: "addWidget", widgetClass: "FrameWidgetClass" }).message).toContain(
      "one root widget",
    );
  });

  it("refuses a children block that holds something that is not a widget", () => {
    writeFileSync(
      FILE,
      SAMPLE.replace(
        '  TextWidgetClass "{0000000000000004}" {',
        '  Stray 1\n  TextWidgetClass "{0000000000000004}" {',
      ),
    );
    expect(refused({ action: "addWidget", widgetClass: "FrameWidgetClass" }).message).toContain(
      "not widgets",
    );
  });

  it("refuses a widget that shares a line with other text", () => {
    writeFileSync(
      FILE,
      SAMPLE.replace(
        '    }\n    ImageWidgetClass "{0000000000000003}" {',
        '    } ImageWidgetClass "{0000000000000003}" {',
      ),
    );
    const r = refused({ action: "removeWidget", widget: "Icon", confirm: true });
    expect(r.message).toContain("shares a line");
  });

  it("an unknown widget reference is refused with the names that exist", () => {
    const r = refused({ action: "removeWidget", widget: "Ghost" });
    expect(r.code).toBe("PATH_NOT_FOUND");
    expect(r.message).toContain("Footer");
  });
});

describe("references", () => {
  it("resolves root, index paths, a Name and a GUID, and refuses an ambiguous Name", () => {
    expect(
      String((rb(ok({ action: "read", widget: "0/1" })).widget as { name: string }).name),
    ).toBe("Icon");
    expect(
      (rb(ok({ action: "read", widget: "{0000000000000003}" })).widget as { name: string }).name,
    ).toBe("Icon");
    expect(
      (rb(ok({ action: "read", widget: "0000000000000003" })).widget as { name: string }).name,
    ).toBe("Icon");
    expect((rb(ok({ action: "read", widget: "root" })).widget as { path: string }).path).toBe(
      "root",
    );
    writeFileSync(FILE, SAMPLE.replace('Name "Icon"', 'Name "Footer"'));
    const r = refused({ action: "read", widget: "Footer" });
    expect(r.message).toContain("matches 2 widgets");
    expect(r.message).toContain("0/1");
  });
});

describe("file shapes", () => {
  it("keeps CRLF line endings", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    writeFileSync(FILE, crlf);
    ok({ action: "addWidget", parent: "Icon", widgetClass: "FrameWidgetClass", confirm: true });
    const t = text();
    expect(t.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    ok({ action: "removeWidget", widget: "0/1/0", confirm: true });
    expect(text()).toBe(crlf);
    ok({ action: "wrap", widget: "Footer", wrapper: "SizeLayoutWidgetClass", confirm: true });
    ok({ action: "wrap", widget: "1", unwrap: true, confirm: true });
    expect(text()).toBe(crlf);
  });

  it("keeps tab indentation", () => {
    const tabs = SAMPLE.split("\n")
      .map((l) => l.replace(/^ +/, (m) => "\t".repeat(m.length)))
      .join("\n");
    writeFileSync(FILE, tabs);
    ok({
      action: "addWidget",
      parent: "Panel",
      widgetClass: "FrameWidgetClass",
      name: "Tab",
      confirm: true,
    });
    expect(text()).toMatch(
      /\n\t{4}FrameWidgetClass "\{[0-9A-F]{16}\}" \{\n\t{5}Name "Tab"\n\t{5}Slot OverlayWidgetSlot/,
    );
    ok({ action: "removeWidget", widget: "Tab", confirm: true });
    expect(text()).toBe(tabs);
  });

  it("keeps a final line ending and a byte order mark", () => {
    writeFileSync(FILE, `${String.fromCharCode(0xfeff)}${SAMPLE}\n`);
    ok({ action: "setProperty", widget: "Icon", property: "Text", value: "t", confirm: true });
    const t = readFileSync(FILE);
    expect(t[0]).toBe(0xef);
    expect(t.toString("utf8").endsWith("}\n")).toBe(true);
  });

  it("keeps a comment and a blank line where they are", () => {
    const withNotes = SAMPLE.replace('   Name "Panel"', '   // note\n   Name "Panel"').replace(
      "    PositionX 10",
      "\n    PositionX 10",
    );
    writeFileSync(FILE, withNotes);
    ok({
      action: "setProperty",
      widget: "Panel",
      property: "Slot.PositionY",
      value: 21,
      confirm: true,
    });
    expect(text()).toBe(withNotes.replace("PositionY 20", "PositionY 21"));
  });
});

// ── The vanilla corpus ───────────────────────────────────────────────────────

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
const skipNote = open.skip === undefined ? "" : ` (skipped: ${open.skip})`;

describe.skipIf(open.skip !== undefined)(`vanilla .layout files${skipNote}`, () => {
  const corpus = open.corpus!;
  const files = open.corpus ? corpus.list("layout") : [];

  it("has layouts to read", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("writes every file back byte for byte", () => {
    const off = files.filter((f) => {
      const buf = corpus.read(f);
      return !parseCstBytes(buf).toBytes().equals(buf);
    });
    console.log(`layout round trip: ${files.length - off.length} of ${files.length} byte-exact`);
    expect(off).toEqual([]);
  });

  it("edits and undoes every file it accepts back to the same bytes, and refuses the rest", () => {
    const work = mkdtempSync(join(tmpdir(), "layout-corpus-"));
    try {
      const cfg = { projectPath: work, gamePath: "", dataDir: "" } as Config;
      const target = join(work, "t.layout");
      const stats = { accepted: 0, refused: 0, emptyBlock: 0, dup: 0, wrap: 0, set: 0 };
      const off: string[] = [];
      for (const f of files) {
        const buf = corpus.read(f);
        writeFileSync(target, buf);
        const go = (a: Record<string, unknown>): ActionOk | ActionError =>
          runLayoutEdit({ path: "t.layout", confirm: true, ...a } as LayoutEditArgs, cfg);
        const add = go({ action: "addWidget", widgetClass: "FrameWidgetClass", name: "ZZ_probe" });
        if (!add.ok) {
          stats.refused++;
          if (!readFileSync(target).equals(buf)) off.push(`${f}: refused but changed`);
          continue;
        }
        stats.accepted++;
        const gone = go({ action: "removeWidget", widget: "ZZ_probe" });
        // A root that already had an empty children block gets its child inside it; taking the
        // only child out takes the block too, so that one shape is not byte-exact (documented).
        const top = parseCstBytes(buf).root.children[0];
        const hadEmptyBlock =
          top?.kind === "object" &&
          top.children.some((c) => c.kind === "object" && c.key === "" && c.children.length === 0);
        if (hadEmptyBlock) {
          stats.emptyBlock++;
          if (!gone.ok) off.push(`${f}: add/remove`);
          writeFileSync(target, buf);
        } else if (!gone.ok || !readFileSync(target).equals(buf)) off.push(`${f}: add/remove`);
        const model = ok2(
          runLayoutEdit({ path: "t.layout", action: "read", limit: 200 } as LayoutEditArgs, cfg),
        );
        const first = (model.readback as { outline: string[] }).outline[1];
        if (first) {
          const kid = /\[([0-9/]+)\]/.exec(first)![1];
          const dup = go({ action: "duplicateWidget", widget: kid });
          if (dup.ok) {
            stats.dup++;
            const idx = Number(kid.split("/").pop()) + 1;
            const parent = kid.includes("/") ? kid.slice(0, kid.lastIndexOf("/")) : "";
            const rm = go({
              action: "removeWidget",
              widget: parent ? `${parent}/${idx}` : String(idx),
            });
            if (!rm.ok || !readFileSync(target).equals(buf)) off.push(`${f}: duplicate/remove`);
          }
          const wrapped = go({ action: "wrap", widget: kid, wrapper: "FrameWidgetClass" });
          if (wrapped.ok) {
            stats.wrap++;
            const un = go({ action: "wrap", widget: kid, unwrap: true });
            if (!un.ok || !readFileSync(target).equals(buf)) off.push(`${f}: wrap/unwrap`);
          }
        }
        const named = runLayoutEdit({ path: "t.layout", action: "read" } as LayoutEditArgs, cfg);
        if (
          named.ok &&
          (named.readback as { widget: { name: string | null } }).widget.name !== null
        ) {
          const same = go({
            action: "setProperty",
            property: "Name",
            value: (named.readback as { widget: { name: string } }).widget.name,
          });
          if (!same.ok || !readFileSync(target).equals(buf))
            off.push(`${f}: setProperty to the same value`);
          else stats.set++;
        }
        writeFileSync(target, buf);
      }
      console.log(`layout edit round trip: ${JSON.stringify(stats)} of ${files.length}`);
      expect(off).toEqual([]);
      expect(stats.accepted).toBeGreaterThan(files.length * 0.9);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 300_000);
});

function ok2(r: ActionOk | ActionError): ActionOk {
  if (!r.ok) throw new Error(r.message);
  return r;
}

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/layout_edit.addWidget
// census:mcp:action/layout_edit.convert
// census:mcp:action/layout_edit.duplicateWidget
// census:mcp:action/layout_edit.moveWidget
// census:mcp:action/layout_edit.read
// census:mcp:action/layout_edit.removeWidget
// census:mcp:action/layout_edit.setProperty
// census:mcp:action/layout_edit.wrap
