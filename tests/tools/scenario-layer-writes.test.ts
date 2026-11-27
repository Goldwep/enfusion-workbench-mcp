/**
 * Phase 7 write-safety gaps 1 and 2: scenario_apply_template and scenario_clone_area write
 * `.layer` text through the lossless CST. Every byte of the target (apply) or of the kept
 * source entities (clone) that the tool does not insert or re-GUID is written back as it was.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";
import { registerScenarioApplyTemplate } from "../../src/tools/scenario-apply-template.js";
import { registerScenarioCloneArea } from "../../src/tools/scenario-clone-area.js";

const LAYER =
  "// hand comment\r\n" +
  'GenericEntity Lamp_1 : "{AAAAAAAAAAAAAAAA}Prefabs/Props/Lamp.et" {\r\n' +
  '\tID "1234567890ABCDEF"\r\n' +
  "\tcoords 100 0 100\r\n" +
  "}\r\n" +
  'GenericEntity : "{BBBBBBBBBBBBBBBB}Prefabs/Props/Crate.et" {\r\n' +
  "\tcomponents {\r\n" +
  '\t\tMeshObject "{CCCCCCCCCCCCCCCC}" {\r\n' +
  "\t\t}\r\n" +
  "\t}\r\n" +
  "\tcoords 5000 0 5000\r\n" +
  "}";

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "p7layer-"));
  root = join(base, "root");
  mkdirSync(join(root, "worlds"), { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("scenario_apply_template", () => {
  it("writes the target back with every existing byte kept and the stamp inserted", async () => {
    const target = join(root, "worlds", "a.layer");
    writeFileSync(target, LAYER);
    const tool = captureTool((s) => registerScenarioApplyTemplate(s, makeConfig({ projectPath: root })));
    const res = await tool({
      target_layer_path: target,
      template_name: "checkpoint",
      position: { x: 0, y: 0, z: 0 },
      rotation_yaw_deg: 0,
      dry_run: false,
      force: true,
    });
    expect(textOf(res)).toContain("WRITTEN");
    const out = readFileSync(target, "utf8");
    expect(out.startsWith(LAYER + "\r\nGenericEntity")).toBe(true);
    expect(out.endsWith("}")).toBe(true);
    expect(out.slice(LAYER.length).replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(out.slice(LAYER.length)).toMatch(/\r\n\tID "[0-9A-F]{16}"\r\n\tcoords /);
  });

  it("dry run writes nothing", async () => {
    const target = join(root, "worlds", "a.layer");
    writeFileSync(target, LAYER);
    const tool = captureTool((s) => registerScenarioApplyTemplate(s, makeConfig({ projectPath: root })));
    const res = await tool({
      target_layer_path: target,
      template_name: "fob_basic",
      position: { x: 0, y: 0, z: 0 },
      rotation_yaw_deg: 0,
      dry_run: true,
      force: false,
    });
    expect(textOf(res)).toContain("DRY-RUN");
    expect(readFileSync(target, "utf8")).toBe(LAYER);
  });

  it("refuses a target that is not a .layer, .conf or .ent, and writes nothing (offline-writers-09)", async () => {
    const tool = captureTool((s) => registerScenarioApplyTemplate(s, makeConfig({ projectPath: root })));
    for (const name of ["X.et", "notes.txt"]) {
      const target = join(root, "worlds", name);
      writeFileSync(target, LAYER);
      const res = await tool({
        target_layer_path: target,
        template_name: "checkpoint",
        position: { x: 0, y: 0, z: 0 },
        rotation_yaw_deg: 0,
        dry_run: false,
        force: true,
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/not a \.layer, \.conf or \.ent file/);
      expect(readFileSync(target, "utf8")).toBe(LAYER);
      expect(existsSync(`${target}.bak`)).toBe(false);
    }
  });
});

describe("scenario_clone_area", () => {
  it("writes a new layer holding the in-area entities as the source wrote them, with fresh GUIDs", async () => {
    const source = join(root, "worlds", "src.layer");
    const dest = join(root, "worlds", "dest.layer");
    writeFileSync(source, LAYER);
    const tool = captureTool((s) => registerScenarioCloneArea(s, makeConfig({ projectPath: root })));
    const res = await tool({
      source_layer_path: source,
      dest_layer_path: dest,
      area: { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 },
      dry_run: false,
      force: true,
    });
    expect(textOf(res)).toContain("Entities cloned: 1");
    expect(readFileSync(source, "utf8")).toBe(LAYER);
    const out = readFileSync(dest, "utf8");
    expect(out).not.toContain("1234567890ABCDEF");
    expect(out).not.toContain("Crate.et");
    const expected = LAYER.slice(0, LAYER.indexOf("}\r\n") + 1);
    expect(out.replace(/ID "[0-9A-F]{16}"/, 'ID "1234567890ABCDEF"')).toBe(expected);
  });

  it("refuses an existing destination without force and leaves it alone", async () => {
    const source = join(root, "worlds", "src.layer");
    const dest = join(root, "worlds", "dest.layer");
    writeFileSync(source, LAYER);
    writeFileSync(dest, "keep");
    const tool = captureTool((s) => registerScenarioCloneArea(s, makeConfig({ projectPath: root })));
    const res = await tool({
      source_layer_path: source,
      dest_layer_path: dest,
      area: { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 },
      dry_run: false,
      force: false,
    });
    expect(textOf(res)).toContain("Destination already exists");
    expect(readFileSync(dest, "utf8")).toBe("keep");
  });

  it("dry run writes no destination", async () => {
    const source = join(root, "worlds", "src.layer");
    const dest = join(root, "worlds", "dest.layer");
    writeFileSync(source, LAYER);
    const tool = captureTool((s) => registerScenarioCloneArea(s, makeConfig({ projectPath: root })));
    const res = await tool({
      source_layer_path: source,
      dest_layer_path: dest,
      area: { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 },
      dry_run: true,
      force: false,
    });
    expect(textOf(res)).toContain("DRY-RUN");
    expect(existsSync(dest)).toBe(false);
  });
});
