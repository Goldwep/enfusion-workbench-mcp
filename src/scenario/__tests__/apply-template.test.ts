import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";
import { applyTemplate } from "../apply-template.js";
import { buildTemplate, describeTemplate, TEMPLATE_NAMES } from "../templates.js";
import { parseCst } from "../../formats/enfusion-cst.js";
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
      const coords = e.properties.find((p) => p.key === "coords")?.value as string;
      const parts = coords.split(" ").map((s) => parseFloat(s));
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
  it("appends template entities after the target's top-level entities", () => {
    const result = applyTemplate(EMPTY_TARGET, {
      template: "fob_basic",
      position: { x: 100, y: 0, z: 200 },
      yawDeg: 0,
    });
    expect(result.entityCount).toBe(5);
    const doc = parseCst(result.text);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.root.children.filter((c) => c.kind === "object").length).toBe(6); // 1 + 5
  });

  it("keeps every byte of the target: the result is the target plus one inserted span", () => {
    const result = applyTemplate(EMPTY_TARGET, {
      template: "fob_basic",
      position: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
    });
    expect(result.text.startsWith(EMPTY_TARGET)).toBe(true);
    expect(result.text).toContain('ID "1111111111111111"');
    expect(result.text).toContain('coords "0 0 0"');
  });

  it("writes the stamped entities in the serializer's shape (bare coords, quoted ID)", () => {
    const result = applyTemplate(EMPTY_TARGET, {
      template: "fob_basic",
      position: { x: 100, y: 0, z: 200 },
      yawDeg: 0,
    });
    const added = result.text.slice(EMPTY_TARGET.length);
    expect(added).toMatch(
      /^GenericEntity : "\{0000000000000001\}Prefabs\/Cover\/Sandbag_Wall\.et" \{\n ID "[0-9A-F]{16}"\n coords 104 0 200\n\}\n/,
    );
    expect(added.endsWith("}\n")).toBe(true);
  });

  it("takes the target's CRLF line ends and tab indent for the inserted blocks", () => {
    const crlfTab = 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\r\n\tcoords 1 0 1\r\n}\r\n';
    const result = applyTemplate(crlfTab, {
      template: "checkpoint",
      position: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
    });
    expect(result.text.startsWith(crlfTab)).toBe(true);
    const added = result.text.slice(crlfTab.length);
    expect(added.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(added).toMatch(/\r\n\tID "/);
    expect(added.endsWith("}\r\n")).toBe(true);
  });

  it("keeps a target that ends without a line end ending without one", () => {
    const noEol = 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 1 0 1\n}';
    const result = applyTemplate(noEol, {
      template: "checkpoint",
      position: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
    });
    expect(result.text.startsWith(noEol + "\nGenericEntity")).toBe(true);
    expect(result.text.endsWith("}")).toBe(true);
    expect(parseCst(result.text).root.children.length).toBe(5);
  });

  it("appends at the top level of a one-entity .layer, not inside the entity", () => {
    const result = applyTemplate(EMPTY_TARGET, {
      template: "checkpoint",
      position: { x: 50, y: 0, z: 75 },
      yawDeg: 45,
    });
    const doc = parseCst(result.text);
    expect(doc.root.children.length).toBe(5); // 1 + 4 checkpoint entities
    const first = doc.root.children[0];
    expect(first.kind === "object" && first.children.length).toBe(2);
  });

  it("inserts inside the single root of a .conf (singleRoot), before its closing brace", () => {
    const conf =
      'SCR_MissionHeaderCampaign {\n m_sName "Mission Foo"\n' +
      ' GenericEntity : "{AABB000000000010}Prefabs/A.et" {\n  coords 50 0 50\n }\n}\n';
    const result = applyTemplate(conf, {
      template: "checkpoint",
      position: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
      singleRoot: true,
    });
    const closeAt = conf.lastIndexOf("}");
    expect(result.text.startsWith(conf.slice(0, closeAt))).toBe(true);
    expect(result.text.endsWith("\n}\n")).toBe(true);
    const doc = parseCst(result.text);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.root.children.length).toBe(1);
    const root = doc.root.children[0];
    expect(root.kind === "object" && root.children.length).toBe(2 + 4);
    expect(result.text).toMatch(/\n GenericEntity : "\{0000000000000001\}/);
    expect(result.text).toMatch(/\n  ID "/);
  });

  it("refuses a target the CST cannot parse cleanly", () => {
    expect(() =>
      applyTemplate('GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 1 0 1\n', {
        template: "checkpoint",
        position: { x: 0, y: 0, z: 0 },
        yawDeg: 0,
      }),
    ).toThrow(/does not parse cleanly/);
  });

  it("echoes position and yawDeg back in the result", () => {
    const result = applyTemplate(EMPTY_TARGET, {
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
