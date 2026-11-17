import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findLooseFile } from "../../src/utils/game-paths.js";

// Phase-7 audit (offline-writers-03 follow-up): findLooseFile must never
// resolve a caller-supplied relative path outside the game data folder.
describe("findLooseFile containment", () => {
  let base: string;
  let data: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "emcp-gamepaths-"));
    data = join(base, "data");
    mkdirSync(join(data, "Prefabs"), { recursive: true });
    mkdirSync(join(data, "Data006", "Prefabs"), { recursive: true });
    writeFileSync(join(data, "Prefabs", "a.et"), "GenericEntity {}\n");
    writeFileSync(join(data, "Data006", "Prefabs", "b.et"), "GenericEntity {}\n");
    writeFileSync(join(data, "Data006", "inner.et"), "GenericEntity {}\n");
    writeFileSync(join(base, "outside.et"), "secret\n");
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("finds a direct and a DataXXX-prefixed file", () => {
    expect(findLooseFile(data, "Prefabs/a.et")).toBe(join(data, "Prefabs", "a.et"));
    expect(findLooseFile(data, "Prefabs/b.et")).toBe(join(data, "Data006", "Prefabs", "b.et"));
  });

  it("refuses a '..' path that leaves the game data folder", () => {
    expect(findLooseFile(data, "../outside.et")).toBeNull();
    expect(findLooseFile(data, "Prefabs/../../outside.et")).toBeNull();
  });

  it("refuses an absolute path", () => {
    expect(findLooseFile(data, join(base, "outside.et"))).toBeNull();
  });

  it("refuses a '..' path even when the Data-folder retry would find it", () => {
    // data/Data006/../../data/Data006/inner.et exists, but the path climbs.
    expect(findLooseFile(data, "../../data/Data006/inner.et")).toBeNull();
  });
});
