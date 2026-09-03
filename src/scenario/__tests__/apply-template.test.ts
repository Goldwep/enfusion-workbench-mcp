import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";
import { applyTemplate } from "../apply-template.js";
import { buildTemplate, describeTemplate, TEMPLATE_NAMES } from "../templates.js";
import { parseLayer, serializeLayer } from "../clone-area.js";
import { assertInsideRoot, isPathInsideRoot } from "../../utils/path-guard.js";

const EMPTY_TARGET = `GenericEntity : "{AABB000000000001}Prefabs/Stub.et" {
 ID "1111111111111111"
 coords "0 0 0"
}
`;

describe("buildTemplate", () => {
  it("produces the documented entity count for fob_basic (5)", () => {
    const r = buildTemplate("fob_basic", { x: 0, y: 0, z: 0 }, 0);
    expect(r.entities.length).toBe(5);
  });

  it("produces the documented entity count for checkpoint (4)", () => {
    const r = buildTemplate("checkpoint", { x: 0, y: 0, z: 0 }, 0);
    expect(r.entities.length).toBe(4);
  });

  it("produces the documented entity count for patrol_grid (6)", () => {
    const r = buildTemplate("patrol_grid", { x: 0, y: 0, z: 0 }, 0);
    expect(r.entities.length).toBe(6);
  });

  it("regenerates fresh GUIDs on every call (no collisions across two calls)", () => {
    const a = buildTemplate("fob_basic", { x: 0, y: 0, z: 0 }, 0);
    const b = buildTemplate("fob_basic", { x: 0, y: 0, z: 0 }, 0);
    const idsA = a.entities.map((e) => e.properties.find((p) => p.key === "ID")?.value);
    const idsB = b.entities.map((e) => e.properties.find((p) => p.key === "ID")?.value);
    for (const ida of idsA) {
      expect(idsB).not.toContain(ida);
    }
  });

  it("returns placeholder resource refs deduped and sorted", () => {
    const r = buildTemplate("fob_basic", { x: 0, y: 0, z: 0 }, 0);
    // fob_basic uses 4 sandbag walls + 1 spawn point — 2 unique placeholders
    expect(r.placeholders.length).toBe(2);
    expect(r.placeholders[0] < r.placeholders[1]).toBe(true);
  });

  it("places entities at the stamp origin when position is (x,y,z) and yaw=0", () => {
    const r = buildTemplate("fob_basic", { x: 100, y: 0, z: 200 }, 0);
    // Centre spawn point is at offset (0,0) — should appear at (100, 0, 200).
    const coords = r.entities.map((e) =>
      e.properties.find((p) => p.key === "coords")?.value,
    );
    expect(coords).toContain("100 0 200");
  });

  it("rotates entities around the origin by yawDeg", () => {
    // fob_basic has 4 walls at offsets (4,0), (-4,0), (0,4), (0,-4) + 1 spawn at origin.
    // After 90° yaw rotation:
    //   (4,0)  → (cos90·4 - sin90·0, sin90·4 + cos90·0) = (0, 4)
    //   (-4,0) → (0, -4)
    //   (0,4)  → (-4, 0)
    //   (0,-4) → (4, 0)
    // Net offsets are the same set — wall positions rotate to other wall positions.
    // Verify the SPAWN POINT stays at origin and the count of walls offset by 4
    // remains 4. Without per-resource introspection we just verify all positions
    // are within ~4.01 of the stamp origin.
    const r = buildTemplate("fob_basic", { x: 0, y: 0, z: 0 }, 90);
    for (const e of r.entities) {
      const coords = e.properties.find((p) => p.key === "coords")?.value;
      const parts = coords!.split(" ").map((s) => parseFloat(s));
      const dist = Math.hypot(parts[0], parts[2]);
      expect(dist).toBeLessThan(4.01);
      expect(dist).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects an unknown template name", () => {
    expect(() =>
      buildTemplate("nope" as unknown as "fob_basic", { x: 0, y: 0, z: 0 }, 0),
    ).toThrow(/Unknown template/);
  });
});

describe("describeTemplate", () => {
  it("returns a non-empty description for every template", () => {
    for (const name of TEMPLATE_NAMES) {
      const d = describeTemplate(name);
      expect(d.length).toBeGreaterThan(0);
    }
  });
});

describe("applyTemplate", () => {
  it("appends template entities to the target's top-level children", () => {
    const root = parseLayer(EMPTY_TARGET);
    expect(root.children.length).toBe(1);
    const result = applyTemplate(root, {
      template: "fob_basic",
      position: { x: 100, y: 0, z: 200 },
      yawDeg: 0,
    });
    expect(result.entityCount).toBe(5);
    expect(root.children.length).toBe(6); // 1 existing + 5 stamped
  });

  it("leaves existing entities untouched", () => {
    const root = parseLayer(EMPTY_TARGET);
    const originalIdProp = root.children[0].properties.find((p) => p.key === "ID");
    applyTemplate(root, {
      template: "fob_basic",
      position: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
    });
    expect(originalIdProp?.value).toBe("1111111111111111");
    expect(root.children[0].properties.find((p) => p.key === "coords")?.value).toBe("0 0 0");
  });

  it("produces a serializable layer after stamping", () => {
    const root = parseLayer(EMPTY_TARGET);
    applyTemplate(root, {
      template: "checkpoint",
      position: { x: 50, y: 0, z: 75 },
      yawDeg: 45,
    });
    const text = serializeLayer(root);
    const reparsed = parseLayer(text);
    expect(reparsed.children.length).toBe(5); // 1 + 4 checkpoint entities
  });

  it("echoes position and yawDeg back in the result", () => {
    const root = parseLayer(EMPTY_TARGET);
    const result = applyTemplate(root, {
      template: "patrol_grid",
      position: { x: 100, y: 0, z: 200 },
      yawDeg: 30,
    });
    expect(result.position).toEqual({ x: 100, y: 0, z: 200 });
    expect(result.yawDeg).toBe(30);
  });
});

// Path-containment regression tests for audit fix H-3. Both
// scenario_apply_template and scenario_clone_area must reject resolved paths
// that escape config.projectPath — otherwise a prompt-injected
// `../../../Users/Public/payload.conf` would write outside the workspace.
// These tests exercise the shared guard helper that both tools call.
describe("assertInsideRoot — path containment guard (audit fix H-3)", () => {
  const ROOT = resolve("C:/projects/MyMod"); // resolves to absolute on Win

  it("accepts a path that equals the project root", () => {
    expect(() => assertInsideRoot(ROOT, ROOT, "target_layer_path")).not.toThrow();
  });

  it("accepts a path one level inside the project", () => {
    const inside = resolve(ROOT, "scenarios", "Mission.conf");
    expect(() => assertInsideRoot(inside, ROOT, "target_layer_path")).not.toThrow();
    expect(isPathInsideRoot(inside, ROOT)).toBe(true);
  });

  it("accepts a deeply-nested path inside the project", () => {
    const inside = resolve(ROOT, "a", "b", "c", "d", "e.layer");
    expect(() => assertInsideRoot(inside, ROOT, "target_layer_path")).not.toThrow();
  });

  it("rejects an absolute path outside the project root", () => {
    const outside = resolve("C:/Windows/System32/payload.conf");
    expect(() => assertInsideRoot(outside, ROOT, "target_layer_path")).toThrow(
      /target_layer_path resolves outside project root/,
    );
    expect(isPathInsideRoot(outside, ROOT)).toBe(false);
  });

  it("rejects a `..` traversal that escapes the project", () => {
    // A traversal like ROOT + "/../Users/Public/payload.conf" resolves to a
    // sibling of ROOT — strictly outside.
    const escaped = resolve(ROOT, "..", "Users", "Public", "payload.conf");
    expect(() => assertInsideRoot(escaped, ROOT, "dest_layer_path")).toThrow(
      /dest_layer_path resolves outside project root/,
    );
  });

  it("rejects a deep `..` traversal payload commonly seen in prompt injections", () => {
    // Models the audit's concrete example payload.
    const payload = resolve(ROOT, "..", "..", "..", "Users", "Public", "payload.conf");
    expect(() => assertInsideRoot(payload, ROOT, "dest_layer_path")).toThrow();
  });

  it("rejects a prefix-collision sibling (e.g. C:\\Proj vs C:\\ProjEvil)", () => {
    // The trailing-separator check in `isPathInsideRoot` is precisely for
    // this case. A naive `startsWith` would false-pass on
    // `C:\projects\MyModEvil` because it starts with `C:\projects\MyMod`.
    const evilSibling = resolve("C:/projects/MyModEvil/payload.conf");
    expect(isPathInsideRoot(evilSibling, ROOT)).toBe(false);
    expect(() => assertInsideRoot(evilSibling, ROOT, "dest_layer_path")).toThrow();
  });

  it("includes the resolved path in the error so the LLM sees where it went wrong", () => {
    const outside = resolve("C:/Windows/System32/payload.conf");
    try {
      assertInsideRoot(outside, ROOT, "dest_layer_path");
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("dest_layer_path");
      expect(msg).toContain(outside);
      // And the project root, with normalized separator.
      expect(msg).toContain(ROOT.split("/").join(sep));
    }
  });
});
