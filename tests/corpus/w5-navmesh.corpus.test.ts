/**
 * W5 navmesh proofs on the installed game's paks (W5 spec 4.1, 4.2):
 *   - every vanilla .nmn header reads without a throw, and the known fields
 *     hold (`EV` 02 00, version, tile size at 0x14/0x18, FORM/NAVM/TFHE at 40);
 *   - .ntile headers read (`FORM....NAVDTIHE`): a seeded sample, every file
 *     under CORPUS_FULL=1;
 *   - the 16 `Configs/Navmesh/Navmesh_*.conf` round trip byte for byte, and
 *     `navmesh status` resolves every listed {GUID}.nmn and counts its tiles;
 *   - `navmesh overrideConfig` (dry run) gives the vanilla bytes back, and a
 *     NavmeshFile edit changes only the value's bytes.
 * Skipped when the game is not installed. The counts are this build's
 * (1.9.0.37); on another census build only the build-independent checks run.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import {
  navDataFolderOf,
  readNmnHeader,
  readNtileHeader,
} from "../../src/formats/navmesh-binary.js";
import type { ActionOk } from "../../src/manifest/vocabulary.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { runNavmesh } from "../../src/tools/navmesh.js";
import { CORPUS_FULL, loadBaseline, openVanillaCorpus } from "./_corpus.js";

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
const MEASURED_BUILD = "1.9.0.37";

describe.skipIf(open.skip !== undefined)("vanilla navmesh files (W5)", () => {
  const corpus = open.corpus!;
  const exactBuild = open.corpus?.build === MEASURED_BUILD;
  const nmnFiles = open.corpus ? corpus.list("nmn") : [];
  const confs = open.corpus
    ? corpus.list("conf").filter((p) => /^Configs\/Navmesh\/Navmesh_[^/]*\.conf$/i.test(p))
    : [];
  const empty = mkdtempSync(join(tmpdir(), "w5-navmesh-corpus-"));
  afterAll(() => rmSync(empty, { recursive: true, force: true }));
  const config = (): Config => ({ ...loadConfig(), projectPath: empty });
  const vfs = () => PakVirtualFS.get(loadConfig().gamePath)!;

  it("reads every .nmn header (P-W5-17 input) with the known fields holding", () => {
    if (exactBuild) expect(nmnFiles.length).toBe(53);
    const versions = new Map<number, number>();
    const tiles = new Map<number, number>();
    const bad: string[] = [];
    for (const f of nmnFiles) {
      const h = readNmnHeader(corpus.read(f));
      if (!h.ok) bad.push(`${f}: ${h.problems.join("; ")}`);
      expect(h.magic).toBe("EV");
      expect(h.magicVersion).toBe(2);
      expect(h.form?.offset).toBe(40);
      expect(h.form?.type).toBe("NAVM");
      expect(h.form?.chunks[0]?.id).toBe("TFHE");
      expect(h.form?.chunksCover).toBe(true);
      expect(h.tileSize?.[0]).toBe(h.tileSize?.[1]);
      expect(h.observed?.agrees).toBe(true);
      versions.set(h.version!, (versions.get(h.version!) ?? 0) + 1);
      tiles.set(h.tileSize![0], (tiles.get(h.tileSize![0]) ?? 0) + 1);
    }
    expect(bad).toEqual([]);
    if (exactBuild) {
      expect(Object.fromEntries(tiles)).toEqual({ 24: 47, 51: 2, 204: 4 });
      // The spec reads "u32 3"; six bakes of two worlds carry 2.
      expect(Object.fromEntries(versions)).toEqual({ 3: 47, 2: 6 });
    }
  });

  it("every .nmn has its .NavData tile folder", () => {
    const g = vfs();
    const missing = nmnFiles.filter((f) => g.listDir(navDataFolderOf(f)).length === 0);
    expect(missing).toEqual([]);
  });

  it("reads .ntile headers (FORM/NAVD/TIHE)", () => {
    const all = corpus.list("ntile");
    if (exactBuild) expect(all.length).toBe(117799);
    const pick = CORPUS_FULL ? all : corpus.sample("ntile", 300);
    const bad: string[] = [];
    for (const f of pick) {
      const t = readNtileHeader(corpus.read(f));
      if (!t.ok || !t.form?.sizeMatches) bad.push(`${f}: ${t.problems.join("; ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("round trips the 16 Navmesh_*.conf byte for byte", () => {
    if (exactBuild) expect(confs.length).toBe(16);
    for (const f of confs) {
      const bytes = corpus.read(f);
      const doc = parseCstBytes(bytes);
      expect(doc.toBytes().equals(bytes)).toBe(true);
      expect(doc.diagnostics).toEqual([]);
      expect(doc.base.kind === "object" && doc.base.key).toBe("BaseNavmeshFilesConfig");
    }
  });

  it("navmesh status: every listed {GUID}.nmn resolves and its tiles are counted", () => {
    expect(confs.length).toBeGreaterThan(0);
    const tileCounts: Record<string, number> = {};
    for (const f of confs) {
      const r = runNavmesh({ action: "status", path: f }, config());
      expect(r.ok).toBe(true);
      const rb = (r as ActionOk).readback as {
        config: { navmeshFile?: string };
        navmeshes: { ref: string; resolves: boolean; guid?: string; tiles?: { count: number } }[];
      };
      expect(rb.config.navmeshFile).toMatch(/^\{[0-9A-F]{16}\}.*\.nmn$/);
      expect(rb.navmeshes).toHaveLength(1);
      const n = rb.navmeshes[0];
      expect(n.resolves).toBe(true);
      expect(n.guid).toMatch(/^[0-9A-F]{16}$/);
      expect(n.tiles!.count).toBeGreaterThan(0);
      tileCounts[f] = n.tiles!.count;
    }
    expect(Object.keys(tileCounts)).toHaveLength(confs.length);
  });

  it("navmesh status reads the vanilla AIWorld prefabs without a refusal", () => {
    const prefabs = corpus.list("et").filter((p) => /^Prefabs\/AI\/SCR_AIWorld[^/]*\.et$/.test(p));
    expect(prefabs.length).toBeGreaterThan(0);
    for (const p of prefabs) {
      const r = runNavmesh({ action: "status", path: p }, config());
      expect(r.ok).toBe(true);
      const w = ((r as ActionOk).readback as { aiWorlds: { components: unknown[] }[] }).aiWorlds;
      expect(w).toHaveLength(1);
      expect(w[0].components.length).toBeGreaterThan(0);
    }
  });

  it("overrideConfig (dry run): the copy is the vanilla bytes; a NavmeshFile edit is local", () => {
    for (const f of confs) {
      const bytes = corpus.read(f);
      const same = runNavmesh({ action: "overrideConfig", path: f }, config());
      expect(same.ok).toBe(true);
      const rb = (same as ActionOk).readback as { text: string; dryRun: boolean };
      expect(rb.dryRun).toBe(true);
      expect(Buffer.from(rb.text, "utf8").equals(bytes)).toBe(true);

      const ref = "{0123456789ABCDEF}worlds/Mod/Mod.nmn";
      const edit = runNavmesh({ action: "overrideConfig", path: f, navmeshFile: ref }, config());
      expect(edit.ok).toBe(true);
      const text = ((edit as ActionOk).readback as { text: string }).text;
      const before = parseCstBytes(bytes).get("NavmeshFile");
      expect(before.kind).toBe("scalar");
      const old = before.kind === "scalar" ? before.values[0] : "";
      expect(text).toBe(bytes.toString("utf8").replace(old, ref));
    }
  });
});
