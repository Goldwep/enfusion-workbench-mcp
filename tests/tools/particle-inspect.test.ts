import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  extractParticleSummary,
  formatParticleSummary,
} from "../../src/tools/particle-inspect.js";

// Synthetic .ptc — format is presumed (see particle-inspect.ts header).
// Two emitters with texture refs, one color curve, one gradient.
const SYNTHETIC_PTC = `ParticleEffect {
 Emitter "{AAAA000000000001}" {
  Texture "{BBBB000000000010}fx/textures/spark.edds"
  m_iCount 50
 }
 ParticleEmitter "{AAAA000000000002}" {
  m_TextureAlbedo "{BBBB000000000011}fx/textures/smoke.edds"
  EmissiveMask "{BBBB000000000012}fx/textures/glow.edds"
 }
 ColorCurve {
  Keys {
   "0.0"
   "0.5"
   "1.0"
  }
 }
 ColorGradient {
  Stops {
   "white"
   "black"
  }
 }
}`;

describe("particle-inspect: extractParticleSummary", () => {
  it("counts emitters, curves, gradients and collects texture refs", () => {
    const root = parse(SYNTHETIC_PTC);
    const s = extractParticleSummary(root);

    expect(s.rootType).toBe("ParticleEffect");
    expect(s.emitters).toHaveLength(2);
    expect(s.curves).toHaveLength(1);
    expect(s.gradients).toHaveLength(1);

    expect(s.curves[0].type).toBe("ColorCurve");
    expect(s.curves[0].keyCount).toBe(3);
    expect(s.gradients[0].stopCount).toBe(2);

    const e1 = s.emitters[0];
    expect(e1.type).toBe("Emitter");
    expect(e1.id).toBe("{AAAA000000000001}");
    expect(e1.textures).toHaveLength(1);
    expect(e1.textures[0].guid).toBe("BBBB000000000010");
    expect(e1.textures[0].path).toBe("fx/textures/spark.edds");
    expect(e1.textures[0].key).toBe("Texture");

    const e2 = s.emitters[1];
    expect(e2.textures).toHaveLength(2);
    expect(e2.textures.map((t) => t.guid)).toEqual([
      "BBBB000000000011",
      "BBBB000000000012",
    ]);
  });

  it("handles a root with no emitters/curves/gradients gracefully", () => {
    const root = parse(`ParticleEffect { m_iVersion 1 }`);
    const s = extractParticleSummary(root);
    expect(s.emitters).toEqual([]);
    expect(s.curves).toEqual([]);
    expect(s.gradients).toEqual([]);
  });
});

describe("particle-inspect: formatParticleSummary", () => {
  it("renders all sections with resolved + unresolved texture GUIDs", () => {
    const root = parse(SYNTHETIC_PTC);
    const s = extractParticleSummary(root);
    const out = formatParticleSummary(
      s,
      (guid) =>
        guid === "BBBB000000000010" ? "fx/textures/spark.edds" : null,
      "fx/effects/spark.ptc",
    );
    expect(out).toContain("# Particle: fx/effects/spark.ptc");
    expect(out).toContain("**Emitters:** 2");
    expect(out).toContain("**Curves:** 1");
    expect(out).toContain("**Gradients:** 1");
    expect(out).toContain("ColorCurve — 3 keys");
    expect(out).toContain("ColorGradient — 2 stops");
    // Resolved ref shows the resolved path.
    expect(out).toContain("→ fx/textures/spark.edds");
    // Unresolved ref shows the "(unresolved)" marker.
    expect(out).toContain("(unresolved)");
  });

  it("emits the 'no texture refs detected' placeholder for emitters with no textures", () => {
    const root = parse(`PE { Emitter "{AAAA000000000001}" { m_iCount 1 } }`);
    const s = extractParticleSummary(root);
    const out = formatParticleSummary(s, () => null, "fx/empty.ptc");
    expect(out).toContain("(no texture refs detected)");
  });
});
