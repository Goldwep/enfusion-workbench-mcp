import { describe, it, expect } from "vitest";
import { generateGuide } from "../../src/animation/guides.js";

describe("character preset", () => {
  it("includes locomotion variables", () => {
    const guide = generateGuide("character");
    expect(guide).toContain("Speed");
    expect(guide).toContain("MoveDir");
    expect(guide).toContain("Stance");
  });

  it("includes IK chain guidance", () => {
    const guide = generateGuide("character");
    expect(guide).toContain("IK");
    expect(guide).toContain("foot");
  });

  it("includes prefab wiring", () => {
    const guide = generateGuide("character");
    expect(guide).toContain("AnimationControllerComponent");
  });
});

describe("weapon preset", () => {
  it("includes weapon commands", () => {
    const guide = generateGuide("weapon");
    expect(guide).toContain("Fire");
    expect(guide).toContain("Reload");
  });

  it("includes Queue pattern", () => {
    const guide = generateGuide("weapon");
    expect(guide).toContain("Queue");
  });
});

describe("prop preset", () => {
  it("includes ProcTransform patterns", () => {
    const guide = generateGuide("prop");
    expect(guide).toContain("ProcTransform");
    expect(guide).toContain("GetUpperRTime()");
  });

  it("includes BaseItemAnimationComponent", () => {
    const guide = generateGuide("prop");
    expect(guide).toContain("BaseItemAnimationComponent");
  });
});

describe("custom preset", () => {
  it("returns questionnaire", () => {
    const guide = generateGuide("custom");
    expect(guide).toContain("?");
    expect(guide).toContain("bones");
    expect(guide).toContain("states");
  });
});
