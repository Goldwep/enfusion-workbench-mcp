import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep, resolve } from "node:path";
import type { Config } from "../../src/config.js";
import {
  resolveResourcePath,
  precheckValidatePath,
  formatValidationResult,
  coerceFlag,
} from "../../src/tools/wb-validate.js";

// Build a minimal Config pointing at temp dirs for project/workshop/core.
// Lays out:
//   tmp/project/Materials/proj.emat
//   tmp/workshop/Materials/ws.emat
//   tmp/core/Materials/core.emat
//   tmp/project/Test1/Materials/mod.emat   (defaultMod=Test1 form)
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "wb-validate-test-"));
  const projectPath = join(root, "project");
  const workshopPath = join(root, "workshop");
  const corePath = join(root, "core");

  for (const p of [
    join(projectPath, "Materials"),
    join(projectPath, "Test1", "Materials"),
    join(workshopPath, "Materials"),
    join(corePath, "Materials"),
  ]) {
    mkdirSync(p, { recursive: true });
  }

  writeFileSync(join(projectPath, "Materials", "proj.emat"), "MaterialPBR {}");
  writeFileSync(join(projectPath, "Test1", "Materials", "mod.emat"), "MaterialPBR {}");
  writeFileSync(join(workshopPath, "Materials", "ws.emat"), "MaterialPBR {}");
  writeFileSync(join(corePath, "Materials", "core.emat"), "MaterialPBR {}");

  const config: Config = {
    workbenchPath: root,
    projectPath,
    gamePath: root,
    dataDir: root,
    patternsDir: root,
    workbenchHost: "127.0.0.1",
    workbenchPort: 5775,
    projectIndexPath: join(root, "idx.db"),
    workshopPath,
    corePath,
    logsPath: join(root, "logs"),
  };

  return { root, config };
}

describe("wb-validate: resolveResourcePath", () => {
  let fixture: ReturnType<typeof makeFixture>;
  beforeAll(() => {
    fixture = makeFixture();
  });
  afterAll(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("resolves a root-relative path against projectPath first", () => {
    const hit = resolveResourcePath("Materials/proj.emat", fixture.config);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("project");
    expect(hit!.resolved).toContain(`project${sep}Materials${sep}proj.emat`);
  });

  it("resolves against workshopPath when not in project", () => {
    const hit = resolveResourcePath("Materials/ws.emat", fixture.config);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("workshop");
  });

  it("falls through to corePath last", () => {
    const hit = resolveResourcePath("Materials/core.emat", fixture.config);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("core");
  });

  it("strips a {GUID} prefix before resolving", () => {
    const hit = resolveResourcePath("{ABCDEF1234567890}Materials/proj.emat", fixture.config);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("project");
  });

  it("returns null when the file doesn't exist under any root", () => {
    const hit = resolveResourcePath("Materials/Nonexistent.emat", fixture.config);
    expect(hit).toBeNull();
  });

  it("accepts an absolute existing path", () => {
    const abs = join(fixture.config.projectPath, "Materials", "proj.emat");
    const hit = resolveResourcePath(abs, fixture.config);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("absolute");
  });

  it("rejects an absolute path that doesn't exist", () => {
    const abs = join(fixture.config.projectPath, "Materials", "Bogus.emat");
    const hit = resolveResourcePath(abs, fixture.config);
    expect(hit).toBeNull();
  });

  it("uses defaultMod sub-path when set", () => {
    const cfgWithMod: Config = { ...fixture.config, defaultMod: "Test1" };
    const hit = resolveResourcePath("Materials/mod.emat", cfgWithMod);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("project");
    expect(hit!.resolved).toContain(`Test1${sep}Materials${sep}mod.emat`);
  });

  it("falls back to root-level when defaultMod path doesn't exist", () => {
    const cfgWithMod: Config = { ...fixture.config, defaultMod: "Test1" };
    // proj.emat exists at project root, not under Test1/
    const hit = resolveResourcePath("Materials/proj.emat", cfgWithMod);
    expect(hit).not.toBeNull();
    expect(hit!.resolved).toContain(`project${sep}Materials${sep}proj.emat`);
    expect(hit!.resolved).not.toContain(`Test1${sep}`);
  });

  it("returns null for an empty path", () => {
    const hit = resolveResourcePath("", fixture.config);
    expect(hit).toBeNull();
  });

  it("returns null for a bare GUID prefix with no path", () => {
    const hit = resolveResourcePath("{ABCDEF1234567890}", fixture.config);
    expect(hit).toBeNull();
  });

  it("skips workshopPath when not configured", () => {
    const cfgNoWs: Config = { ...fixture.config, workshopPath: undefined };
    // ws.emat lives under workshopPath — should now be unreachable
    const hit = resolveResourcePath("Materials/ws.emat", cfgNoWs);
    expect(hit).toBeNull();
  });

  // --- SEC-NEW-01 (CWE-22) path-traversal containment ---

  it("refuses a root-relative '..'-escaping path even if the target file exists", () => {
    // Plant a file OUTSIDE every configured root, then try to reach it via
    // a `..`-laden root-relative path. The resolver must refuse it.
    const outsideDir = join(fixture.root, "outside");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "evil.emat"), "MaterialPBR {}");
    // From projectPath (=<root>/project), "../outside/evil.emat" escapes to
    // <root>/outside/evil.emat.
    const hit = resolveResourcePath("../outside/evil.emat", fixture.config);
    expect(hit).toBeNull();
  });

  it("refuses a deeply-nested '..'-escaping path", () => {
    const hit = resolveResourcePath("Materials/../../outside/evil.emat", fixture.config);
    expect(hit).toBeNull();
  });

  it("refuses an absolute path outside all known roots", () => {
    // An absolute path that exists on disk but is outside project/workshop/core.
    const outsideDir = join(fixture.root, "outside");
    mkdirSync(outsideDir, { recursive: true });
    const abs = join(outsideDir, "abs-evil.emat");
    writeFileSync(abs, "MaterialPBR {}");
    const hit = resolveResourcePath(abs, fixture.config);
    expect(hit).toBeNull();
  });

  it("still accepts an absolute path inside a known root", () => {
    const abs = join(fixture.config.projectPath, "Materials", "proj.emat");
    const hit = resolveResourcePath(abs, fixture.config);
    expect(hit).not.toBeNull();
    expect(hit!.root).toBe("absolute");
    expect(hit!.resolved).toBe(resolve(abs));
  });
});

describe("wb-validate: precheckValidatePath", () => {
  let fixture: ReturnType<typeof makeFixture>;
  beforeAll(() => {
    fixture = makeFixture();
  });
  afterAll(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("rejects a '-'-prefixed path via the flag-smuggle guard before any resolution", () => {
    const pre = precheckValidatePath("material", "-rf", fixture.config);
    expect(pre.ok).toBe(false);
    if (!pre.ok) {
      expect(pre.text).toContain("flag-smuggle guard");
    }
  });

  it("refuses a traversal-escaping path before any handler call", () => {
    const pre = precheckValidatePath("material", "../outside/evil.emat", fixture.config);
    expect(pre.ok).toBe(false);
    if (!pre.ok) {
      expect(pre.text).toContain("Resource Not Found");
    }
  });

  it("refuses a non-existent path", () => {
    const pre = precheckValidatePath("texture", "Materials/Nope.edds", fixture.config);
    expect(pre.ok).toBe(false);
    if (!pre.ok) {
      expect(pre.text).toContain("Resource Not Found");
    }
  });

  it("returns ok + resolved hit for a valid in-root path", () => {
    const pre = precheckValidatePath("material", "Materials/proj.emat", fixture.config);
    expect(pre.ok).toBe(true);
    if (pre.ok) {
      expect(pre.hit.root).toBe("project");
      expect(pre.hit.resolved).toContain(`project${sep}Materials${sep}proj.emat`);
    }
  });
});

describe("wb-validate: formatValidationResult", () => {
  const hit = { resolved: "C:/x/y.emat", root: "project" as const };

  it("treats an empty {} response as Inconclusive + isError (VM-exception false-positive fix)", () => {
    const { text, isError } = formatValidationResult("material", "y.emat", hit, {});
    expect(isError).toBe(true);
    expect(text).toContain("Inconclusive");
    expect(text).toContain("Virtual Machine Exception");
  });

  it("reports valid:false as Failed + isError", () => {
    const { text, isError } = formatValidationResult("material", "y.emat", hit, {
      valid: false,
    });
    expect(isError).toBe(true);
    expect(text).toContain("Validation Failed");
    expect(text).toContain("Invalid");
  });

  it("reports success:true as Passed + not isError", () => {
    const { text, isError } = formatValidationResult("texture", "y.edds", hit, {
      success: true,
    });
    expect(isError).toBe(false);
    expect(text).toContain("Validation Passed");
    expect(text).toContain("Valid");
  });

  it("reports valid:true with no errors as Passed", () => {
    const { text, isError } = formatValidationResult("material", "y.emat", hit, {
      valid: true,
    });
    expect(isError).toBe(false);
    expect(text).toContain("Validation Passed");
  });

  it("lists errors and flags isError even when valid is not present", () => {
    const { text, isError } = formatValidationResult("material", "y.emat", hit, {
      errors: ["missing texture", { message: "bad shader" }],
    });
    expect(isError).toBe(true);
    expect(text).toContain("Validation Failed");
    expect(text).toContain("missing texture");
    expect(text).toContain("bad shader");
  });
});

describe("wb-validate: coerceFlag (cs17-6)", () => {
  it("passes booleans through and maps numbers", () => {
    expect(coerceFlag(true)).toBe(true);
    expect(coerceFlag(false)).toBe(false);
    expect(coerceFlag(1)).toBe(true);
    expect(coerceFlag(0)).toBe(false);
  });

  it("maps the string forms explicitly — 'false' is NOT truthy", () => {
    expect(coerceFlag("false")).toBe(false);
    expect(coerceFlag("FALSE")).toBe(false);
    expect(coerceFlag("0")).toBe(false);
    expect(coerceFlag("true")).toBe(true);
    expect(coerceFlag("1")).toBe(true);
  });

  it("returns undefined for absent / unrecognised values so the caller falls through", () => {
    expect(coerceFlag(undefined)).toBeUndefined();
    expect(coerceFlag(null)).toBeUndefined();
    expect(coerceFlag("maybe")).toBeUndefined();
    expect(coerceFlag({})).toBeUndefined();
  });

  it("formatValidationResult reports valid:'false' as Failed", () => {
    const hit = { resolved: "x", root: "project" as const };
    const { text, isError } = formatValidationResult("material", "y.emat", hit, {
      valid: "false",
    });
    expect(isError).toBe(true);
    expect(text).toContain("Validation Failed");
  });
});
