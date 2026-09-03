import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPECTED_TAGS,
  extractGlobalTagsBody,
  formatPoseLintMarkdown,
  lintWeaponPose,
  tokenizeQuotedStrings,
} from "../../src/animation/weapon-pose-lint.js";

const FULL_AGR = `AnimSrcGraph {
 ControlTemplate AnimSrcGCT "{DEF456}" {
  Variables {
   AnimSrcGCTVarFloat Speed {
    MaxValue 30
   }
  }
  GlobalTags {
   "WEAPON"
   "ADS"
   "STANCE"
   "CROUCH"
   "PRONE"
   "RELOAD"
  }
 }
 DefaultRunNode "Master"
}`;

const PARTIAL_AGR = `AnimSrcGraph {
 ControlTemplate AnimSrcGCT "{DEF456}" {
  GlobalTags {
   "WEAPON"
   "STANCE"
  }
 }
}`;

const UNKNOWN_TAG_AGR = `AnimSrcGraph {
 ControlTemplate AnimSrcGCT "{DEF456}" {
  GlobalTags {
   "WEAPON"
   "ADS"
   "STANCE"
   "CROUCH"
   "PRONE"
   "RELOAD"
   "CUSTOM_PROJECT_TAG"
  }
 }
}`;

const NO_GLOBAL_TAGS_AGR = `AnimSrcGraph {
 ControlTemplate AnimSrcGCT "{DEF456}" {
  Variables {
   AnimSrcGCTVarFloat Speed {
    MaxValue 30
   }
  }
 }
}`;

describe("extractGlobalTagsBody", () => {
  it("returns body content for a present block", () => {
    const body = extractGlobalTagsBody(FULL_AGR);
    expect(body).not.toBeNull();
    expect(body!).toContain('"WEAPON"');
    expect(body!).toContain('"RELOAD"');
  });

  it("returns null when GlobalTags is absent", () => {
    expect(extractGlobalTagsBody(NO_GLOBAL_TAGS_AGR)).toBeNull();
  });

  it("returns null on unbalanced braces", () => {
    expect(extractGlobalTagsBody('GlobalTags { "X"')).toBeNull();
  });

  it("tolerates whitespace and newlines between keyword and brace", () => {
    const body = extractGlobalTagsBody(`GlobalTags
    {
       "TAG_A"
    }`);
    expect(body).not.toBeNull();
    expect(body!).toContain('"TAG_A"');
  });

  it("captures only the first GlobalTags block when multiple present", () => {
    const text = `GlobalTags { "ALPHA" }\nGlobalTags { "BETA" }`;
    const body = extractGlobalTagsBody(text);
    expect(body!).toContain("ALPHA");
    expect(body!).not.toContain("BETA");
  });
});

describe("tokenizeQuotedStrings", () => {
  it("extracts each quoted token", () => {
    expect(tokenizeQuotedStrings('"A" "B" "C"')).toEqual(["A", "B", "C"]);
  });

  it("dedupes repeats while preserving first-seen order", () => {
    expect(tokenizeQuotedStrings('"A" "B" "A" "C"')).toEqual(["A", "B", "C"]);
  });

  it("ignores unquoted tokens", () => {
    expect(tokenizeQuotedStrings('FOO "A" BAR "B"')).toEqual(["A", "B"]);
  });

  it("returns empty for empty body", () => {
    expect(tokenizeQuotedStrings("")).toEqual([]);
  });
});

describe("lintWeaponPose", () => {
  it("passes when every expected tag is present", () => {
    const r = lintWeaponPose(FULL_AGR);
    expect(r.ok).toBe(true);
    expect(r.missingTags).toEqual([]);
    expect(r.unknownTags).toEqual([]);
    expect(r.foundTags.sort()).toEqual([...DEFAULT_EXPECTED_TAGS].sort());
    expect(r.findings).toEqual([]);
    expect(r.globalTagsBlockFound).toBe(true);
  });

  it("reports missing tags as errors", () => {
    const r = lintWeaponPose(PARTIAL_AGR);
    expect(r.ok).toBe(false);
    expect(r.missingTags.sort()).toEqual(["ADS", "CROUCH", "PRONE", "RELOAD"]);
    const errors = r.findings.filter((f) => f.severity === "error");
    expect(errors).toHaveLength(4);
    expect(errors.every((f) => f.message.includes("Missing tag"))).toBe(true);
  });

  it("reports unknown tags as warnings (does not fail the lint)", () => {
    const r = lintWeaponPose(UNKNOWN_TAG_AGR);
    expect(r.ok).toBe(true);
    expect(r.unknownTags).toEqual(["CUSTOM_PROJECT_TAG"]);
    const warnings = r.findings.filter((f) => f.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tag).toBe("CUSTOM_PROJECT_TAG");
  });

  it("flags every expected tag as missing when block absent", () => {
    const r = lintWeaponPose(NO_GLOBAL_TAGS_AGR);
    expect(r.ok).toBe(false);
    expect(r.globalTagsBlockFound).toBe(false);
    expect(r.foundTags).toEqual([]);
    expect(r.missingTags).toEqual([...DEFAULT_EXPECTED_TAGS]);
    expect(r.findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("respects a custom expected_tags override", () => {
    const r = lintWeaponPose(PARTIAL_AGR, ["WEAPON", "STANCE"]);
    expect(r.ok).toBe(true);
    expect(r.missingTags).toEqual([]);
    expect(r.unknownTags).toEqual([]);
  });

  it("is case-sensitive — `weapon` does not satisfy `WEAPON`", () => {
    const r = lintWeaponPose('GlobalTags { "weapon" "ads" "stance" "crouch" "prone" "reload" }');
    expect(r.ok).toBe(false);
    expect(r.missingTags).toEqual([...DEFAULT_EXPECTED_TAGS]);
    // All present tags are unknown relative to the default set.
    expect(r.unknownTags.sort()).toEqual([
      "ads",
      "crouch",
      "prone",
      "reload",
      "stance",
      "weapon",
    ]);
  });

  it("dedupes repeated tags in the block", () => {
    const r = lintWeaponPose(
      'GlobalTags { "WEAPON" "WEAPON" "ADS" "STANCE" "CROUCH" "PRONE" "RELOAD" }',
    );
    expect(r.foundTags.filter((t) => t === "WEAPON")).toHaveLength(1);
    expect(r.ok).toBe(true);
  });

  it("returns block-found=true even when no tags are inside", () => {
    const r = lintWeaponPose("GlobalTags { }");
    expect(r.globalTagsBlockFound).toBe(true);
    expect(r.foundTags).toEqual([]);
    expect(r.missingTags).toEqual([...DEFAULT_EXPECTED_TAGS]);
    expect(r.ok).toBe(false);
  });
});

describe("formatPoseLintMarkdown", () => {
  it("renders OK status when result is clean", () => {
    const md = formatPoseLintMarkdown({
      filePath: "/tmp/char.agr",
      result: lintWeaponPose(FULL_AGR),
    });
    expect(md).toContain("## weapon_pose_lint: /tmp/char.agr");
    expect(md).toMatch(/Status: OK/);
    expect(md).toContain("### Found tags");
    expect(md).toContain("WEAPON");
    expect(md).not.toContain("### Missing tags");
  });

  it("renders FAILED with missing tags listed", () => {
    const md = formatPoseLintMarkdown({
      filePath: "/tmp/char.agr",
      result: lintWeaponPose(PARTIAL_AGR),
    });
    expect(md).toContain("Status: FAILED");
    expect(md).toContain("### Missing tags (error)");
    expect(md).toContain("- ADS");
    expect(md).toContain("- RELOAD");
  });

  it("renders unknown-tag warnings section", () => {
    const md = formatPoseLintMarkdown({
      filePath: "/tmp/char.agr",
      result: lintWeaponPose(UNKNOWN_TAG_AGR),
    });
    expect(md).toContain("### Unknown tags (warning)");
    expect(md).toContain("CUSTOM_PROJECT_TAG");
    expect(md).toContain("may be project-specific");
  });

  it("renders missing-block FAILED with all defaults missing", () => {
    const md = formatPoseLintMarkdown({
      filePath: "/tmp/char.agr",
      result: lintWeaponPose(NO_GLOBAL_TAGS_AGR),
    });
    expect(md).toContain("no GlobalTags { ... } block found");
    expect(md).toContain("### Missing tags (error)");
    for (const t of DEFAULT_EXPECTED_TAGS) {
      expect(md).toContain(`- ${t}`);
    }
  });
});
