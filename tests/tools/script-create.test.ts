import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchEngine } from "../../src/index/search-engine.js";
import { registerScriptCreate } from "../../src/tools/script-create.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";
import { cls, method, writeFixtureDataDir } from "../index/api-fixture.js";

const pak = (pakLine: number, guards?: string[]) => ({
  origin: "pak" as const,
  pakFile: "scripts/Game/Test/StubParent.c",
  pakLine,
  ...(guards ? { guards } : {}),
});

const fixture = writeFixtureDataDir({
  arma: [
    cls("StubParent", {
      methods: [
        method("void OnDiagOnly ()", pak(10, ["ENABLE_DIAG"])),
        method("void OnPakPlain ()", pak(20)),
        method("void OnDoxygen ()"),
      ],
      protectedMethods: [method("protected void OnNotWorkbench ()", pak(30, ["!WORKBENCH"]))],
    }),
  ],
});
afterAll(() => fixture.cleanup());

describe("script_create: override stubs from the API index", () => {
  const engine = new SearchEngine(fixture.dataDir);
  // No project path: the tool returns the code and writes nothing.
  const tool = captureTool((s) => registerScriptCreate(s, makeConfig({ projectPath: "" }), engine));

  it("skips methods that exist only under a preprocessor guard; keeps unguarded pak and Doxygen ones", async () => {
    const r = await tool({ className: "TAG_Stub", scriptType: "basic", parentClass: "StubParent" });
    expect(r.isError).toBeUndefined();
    const text = textOf(r);
    expect(text).toContain("not written to disk");
    expect(text).toContain("  override void OnPakPlain ()");
    expect(text).toContain("  override void OnDoxygen ()");
    expect(text).not.toContain("OnDiagOnly");
    expect(text).not.toContain("OnNotWorkbench");
  });
});

describe("script_create: plugin scriptType", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "script-create-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const make = () => captureTool((s) => registerScriptCreate(s, makeConfig({ projectPath: root })));

  it("writes a plugin to Scripts/WorkbenchGame and never overwrites it", async () => {
    const tool = make();
    const args = {
      className: "TAG_MyPlugin",
      scriptType: "plugin",
      module: "WorldEditor",
      shortcut: "Ctrl+Shift+X",
      awesomeFontCode: "0xF0C5",
    };
    const r = await tool(args);
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain("Script created: Scripts/WorkbenchGame/TAG_MyPlugin.c");
    const path = join(root, "Scripts", "WorkbenchGame", "TAG_MyPlugin.c");
    const written = readFileSync(path, "utf-8");
    expect(written).toContain("[WorkbenchPluginAttribute(");
    expect(written).toContain('wbModules: {"WorldEditor"}');
    expect(existsSync(join(root, "Scripts", "Game", "TAG_MyPlugin.c"))).toBe(false);

    const again = await tool({ ...args, shortcut: "Ctrl+Alt+Z" });
    expect(textOf(again)).toContain("File already exists");
    expect(readFileSync(path, "utf-8")).toBe(written);
  });

  it("writes a WorldEditorTool", async () => {
    const r = await make()({
      className: "TAG_MyTool",
      scriptType: "plugin",
      parentClass: "WorldEditorTool",
    });
    expect(r.isError).toBeUndefined();
    const written = readFileSync(join(root, "Scripts", "WorkbenchGame", "TAG_MyTool.c"), "utf-8");
    expect(written).toContain("[WorkbenchToolAttribute(");
    expect(written).toContain("class TAG_MyTool : WorldEditorTool");
  });

  it("refuses a bad parentClass, module, filename or identifier and writes nothing", async () => {
    const tool = make();
    for (const [extra, msg] of [
      [{ parentClass: "ScriptComponent" }, "Invalid parentClass"],
      [{ module: "Nope" }, "Invalid module"],
      [{ className: "../Evil" }, "Error creating script"],
      [{ className: "1bad" }, "Error creating script"],
    ] as const) {
      const r = await tool({ className: "TAG_P", scriptType: "plugin", ...extra });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain(msg);
    }
    expect(existsSync(join(root, "Scripts"))).toBe(false);
  });

  it("other script types still go to Scripts/Game", async () => {
    const r = await make()({ className: "TAG_Plain", scriptType: "basic" });
    expect(textOf(r)).toContain("Scripts/Game/TAG_Plain.c");
  });
});
