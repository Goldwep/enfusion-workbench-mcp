/**
 * Review round 1, W5-02: navmesh overrideConfig answers SAVE_FAILED, not ok, when the file read
 * back differs from what was written (a filter driver or a concurrent writer changing the bytes).
 * node:fs is wrapped so the read-back of the written file can be made to differ.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

const corrupt = vi.hoisted(() => ({ path: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((p: Parameters<typeof real.readFileSync>[0], ...rest: unknown[]) => {
    const out = (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest);
    if (corrupt.path && typeof p === "string" && p.replace(/\\/g, "/") === corrupt.path)
      return Buffer.isBuffer(out) ? Buffer.concat([out, Buffer.from("!")]) : `${String(out)}!`;
    return out;
  }) as typeof real.readFileSync;
  return { ...real, default: { ...real, readFileSync }, readFileSync };
});

const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
const { runNavmesh } = await import("../../src/tools/navmesh.js");
const { makeConfig } = await import("./_tool-harness.js");

const PATH = "Configs/Navmesh/Navmesh_Test.conf";
const GAME_CONF = [
  "BaseNavmeshFilesConfig {",
  ' NavmeshFile "{1111111111111111}worlds/Test/Test.nmn"',
  "}",
].join("\n");

const game = {
  exists: (rel: string) => rel === PATH || PATH.startsWith(`${rel}/`),
  readFile: (rel: string) => {
    if (rel !== PATH) throw new Error(`no ${rel}`);
    return Buffer.from(GAME_CONF, "utf-8");
  },
  listDir: () => [],
};

let proj = "";
let gameDir = "";
beforeAll(() => {
  proj = mkdtempSync(join(tmpdir(), "navmesh-rb-"));
  gameDir = mkdtempSync(join(tmpdir(), "navmesh-rb-game-"));
});
afterAll(() => {
  corrupt.path = "";
  rmSync(proj, { recursive: true, force: true });
  rmSync(gameDir, { recursive: true, force: true });
});

describe("navmesh overrideConfig read-back", () => {
  it("a read-back that differs answers SAVE_FAILED with no 'Written' next", () => {
    corrupt.path = join(proj, PATH).replace(/\\/g, "/");
    const config = makeConfig({ projectPath: proj, gamePath: gameDir });
    const r = runNavmesh({ action: "overrideConfig", path: PATH, confirm: true } as never, config, game);
    corrupt.path = "";
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SAVE_FAILED");
    expect(r.next ?? "").not.toMatch(/^Written/);
    expect(r.next ?? "").toMatch(/do not register it/);
    expect(existsSync(join(proj, PATH))).toBe(true);
  });
});
