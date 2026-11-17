import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("server version", () => {
  it("equals the version field of package.json", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    expect(typeof pkg.version).toBe("string");
    expect(VERSION).toBe(pkg.version);
  });

  it("is not hard-coded as 0.7.1 anywhere in src/", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|json)$/.test(name) && readFileSync(p, "utf-8").includes("0.7.1")) hits.push(p);
      }
    };
    walk(join(root, "src"));
    expect(hits).toEqual([]);
  });
});
