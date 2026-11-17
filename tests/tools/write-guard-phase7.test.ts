/**
 * Phase 7 write-safety gaps 21 and 22: layout_create and script_format refuse a target outside
 * the configured project root and write nothing when they refuse.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";
import { registerLayoutCreate } from "../../src/tools/layout-create.js";
import { registerScriptFormat } from "../../src/tools/script-format.js";

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "p7guard-"));
  root = join(base, "root");
  outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("layout_create", () => {
  it("refuses projectPath outside root, writes nothing; writes inside root", async () => {
    const tool = captureTool((s) => registerLayoutCreate(s, makeConfig({ projectPath: root })));
    const bad = await tool({ name: "Hud", layoutType: "hud", projectPath: outside });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(readdirSync(outside)).toEqual([]);

    const ok = await tool({ name: "Hud", layoutType: "hud" });
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toMatch(/Layout created/);
    expect(existsSync(join(root, "UI", "layouts"))).toBe(true);
  });
});

describe("script_format", () => {
  const messy = "class A\n{\n\tint x;   \n\n\n\n};\n";

  it("refuses a .c outside every project root and leaves it as it was", async () => {
    const file = join(outside, "A.c");
    writeFileSync(file, messy);
    const tool = captureTool((s) => registerScriptFormat(s, makeConfig({ projectPath: root })));
    const r = await tool({ script_path: file, commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/script_path resolves outside every configured root/);
    expect(readFileSync(file, "utf-8")).toBe(messy);
    expect(readdirSync(outside)).toEqual(["A.c"]);
  });

  it("reports an already clean file as clean and does not rewrite it (offline-writers-08)", async () => {
    const clean = "class A\n{\n\tint x;\n};\n";
    const file = join(root, "Clean.c");
    writeFileSync(file, clean);
    const tool = captureTool((s) => registerScriptFormat(s, makeConfig({ projectPath: root })));
    const r = await tool({ script_path: file, commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/Already clean/);
    expect(readdirSync(root)).toEqual(["Clean.c"]);
  });

  it("formats a .c inside the project root", async () => {
    const file = join(root, "A.c");
    writeFileSync(file, messy);
    const tool = captureTool((s) => registerScriptFormat(s, makeConfig({ projectPath: root })));
    const r = await tool({ script_path: file, commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(readFileSync(file, "utf-8")).not.toBe(messy);
  });
});
