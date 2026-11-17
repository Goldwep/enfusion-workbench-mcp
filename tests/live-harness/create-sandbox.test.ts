import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProperty, parse } from "../../src/formats/enfusion-text.js";
import { SANDBOX_GITIGNORE, createSandbox } from "../../scripts/live/create-sandbox.js";

describe("createSandbox", () => {
  it("writes a parsable .gproj, the .gitignore and one clean initial commit", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sbx-"));
    try {
      const dir = join(root, "EMCP2_sandbox");
      const r = createSandbox(dir);
      expect(r.gprojPath).toBe(join(dir, "EMCP2_sandbox.gproj"));
      expect(r.commit).toMatch(/^[0-9a-f]{40}$/);

      const node = parse(readFileSync(r.gprojPath, "utf-8"));
      expect(node.type).toBe("GameProject");
      expect(getProperty(node, "ID")).toBe("EMCP2_sandbox");
      expect(getProperty(node, "TITLE")).toBe("EMCP2 sandbox (2.0 live lane)");
      const deps = node.children.find((c) => c.type === "Dependencies");
      expect(deps?.values).toEqual(["58D0FB3206B6F859"]);

      const ignore = readFileSync(join(dir, ".gitignore"), "utf-8");
      expect(ignore).toBe(SANDBOX_GITIGNORE);
      for (const line of [
        "Scripts/WorkbenchGame/EnfusionMCP/",
        "Scripts/WorkbenchGame/EnfusionCensus/",
        "resourceDatabase.rdb",
        "Backup/",
        "*.bak",
      ]) {
        expect(ignore.split("\n")).toContain(line);
      }

      const git = (...args: string[]): string =>
        execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
      expect(git("status", "--short")).toBe("");
      expect(git("rev-list", "--count", "HEAD").trim()).toBe("1");
      expect(git("ls-files").trim().split("\n").sort()).toEqual([
        ".gitignore",
        "EMCP2_sandbox.gproj",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a directory that exists and is not empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-sbx-"));
    try {
      writeFileSync(join(dir, "something.txt"), "x");
      expect(() => createSandbox(dir)).toThrow("not empty");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an existing empty directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-sbx-"));
    try {
      expect(createSandbox(dir).gprojPath).toBe(join(dir, "EMCP2_sandbox.gproj"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
