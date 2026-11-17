import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import type { Config } from "../../src/config.js";
import {
  extractParticleSummary,
  formatParticleSummary,
  registerParticleInspect,
} from "../../src/tools/particle-inspect.js";
import { openVanillaCorpus } from "../corpus/_corpus.js";
import { captureTool } from "./_tool-harness.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf-8");

describe("particle-inspect: extractParticleSummary", () => {
  const s = extractParticleSummary(parse(fixture("particle-two-emitters.ptc")));

  it("reads the effect header and each EmitterDef", () => {
    expect(s.rootType).toBe("EffectDef");
    expect(s.version).toBe("2");
    expect(s.effectParams).toEqual({ LightRadius: "5" });
    expect(s.emitters.map((e) => [e.type, e.id])).toEqual([
      ["EmitterDef", "spark_core"],
      ["EmitterDef", "debris"],
    ]);
  });

  it("reads key parameters, material and prefab refs", () => {
    const [a, b] = s.emitters;
    expect(a.params).toMatchObject({
      ShapeType: "Point",
      MaxNum: "20",
      BirthRate: "100",
      LodMax: "2",
    });
    expect(a.textures).toEqual([
      {
        key: "Material",
        raw: "{AAAA000000000001}Particles/_Materials/Spark.emat",
        guid: "AAAA000000000001",
        path: "Particles/_Materials/Spark.emat",
      },
    ]);
    expect(a.prefab).toBeUndefined();
    expect(b.params.ParticleType).toBe("Prefab");
    expect(b.prefab?.path).toBe("Prefabs/Particles/Debris.et");
    expect(b.textures).toHaveLength(1);
  });

  it("counts curve points by stride and splits colour curves out as gradients", () => {
    expect(s.emitters[0].curves).toEqual([
      { type: "Color", keyCount: 2 },
      { type: "Alpha", keyCount: 3 },
    ]);
    expect(s.curves.map((c) => [c.type, c.keyCount])).toEqual([
      ["Alpha", 3],
      ["Size", 2],
    ]);
    expect(s.gradients.map((g) => [g.type, g.stopCount])).toEqual([["Color", 2]]);
  });

  it("handles an effect with no emitters", () => {
    const e = extractParticleSummary(parse(fixture("particle-empty.ptc")));
    expect(e.emitters).toEqual([]);
    expect(e.curves).toEqual([]);
    expect(e.gradients).toEqual([]);
  });
});

describe("particle-inspect: formatParticleSummary", () => {
  const s = extractParticleSummary(parse(fixture("particle-two-emitters.ptc")));

  it("renders emitters with resolved and unresolved refs", () => {
    const out = formatParticleSummary(
      s,
      (g) => (g === "AAAA000000000001" ? "Particles/_Materials/Spark.emat" : null),
      "fx/spark.ptc",
    );
    expect(out).toContain("# Particle: fx/spark.ptc");
    expect(out).toContain("**Emitters:** 2");
    expect(out).toContain("### 1. EmitterDef spark_core");
    expect(out).toContain("- BirthRate: 100");
    expect(out).toContain("→ Particles/_Materials/Spark.emat");
    expect(out).toContain("(unresolved)");
    expect(out).toContain("- curves: Color(2), Alpha(3)");
    expect(out).toContain("**Prefab:**");
  });

  it("flags an emitter with no material ref", () => {
    const out = formatParticleSummary(
      extractParticleSummary(parse("EffectDef { Emitters { EmitterDef x { BirthRate 1 } } }")),
      () => null,
      "fx/x.ptc",
    );
    expect(out).toContain("(no material refs)");
  });
});

describe("particle-inspect: vanilla corpus sample", () => {
  const open = openVanillaCorpus(undefined, { ignoreBaseline: true });
  if (open.skip !== undefined)
    console.warn(`[corpus] particle-inspect sample SKIPPED: ${open.skip}`);
  it.skipIf(!open.corpus)(
    `emitter and material counts match the raw text on a sample${open.skip ? ` (SKIPPED: ${open.skip})` : ""}`,
    () => {
      const corpus = open.corpus!;
      const files = corpus.sample("ptc", 25);
      expect(files.length).toBeGreaterThan(0);
      for (const p of files) {
        const text = corpus.readText(p);
        const s = extractParticleSummary(parse(text));
        const raw = text.match(/^[ \t]*EmitterDef\b[^\n]*\{[ \t]*\r?$/gm)?.length ?? 0;
        const mats = text.match(/^[ \t]*Material[ \t]+"\{[0-9A-Fa-f]{16}\}/gm)?.length ?? 0;
        expect(s.emitters.length, p).toBe(raw);
        expect(
          s.emitters.reduce((n, e) => n + e.textures.length, 0),
          p,
        ).toBe(mats);
      }
    },
    60_000,
  );
});

describe("particle-inspect: the registered tool is an alias of particle inspect", () => {
  const FIXTURE = join(FIXTURES, "particle-two-emitters.ptc");
  const config = { projectPath: "", gamePath: "", dataDir: "" } as Config;
  const handler = captureTool((s) => registerParticleInspect(s, undefined, config));
  const reply = async (args: Record<string, unknown>) => {
    const r = await handler(args);
    return { isError: r.isError, body: JSON.parse(r.content[0].text) };
  };

  it("keeps its name and the 1.x parameter, and says it is an alias", () => {
    let name = "";
    let def: { description: string; inputSchema: Record<string, unknown> } | undefined;
    registerParticleInspect(
      {
        registerTool: (
          n: string,
          d: { description: string; inputSchema: Record<string, unknown> },
        ) => {
          name = n;
          def = d;
        },
      } as never,
      undefined,
      config,
    );
    expect(name).toBe("particle_inspect");
    expect(def?.description).toMatch(/^Alias of particle inspect/);
    expect(def?.description.length).toBeLessThanOrEqual(400);
    expect(Object.keys(def?.inputSchema ?? {})).toEqual(["particle_path", "cursor", "limit"]);
  });

  it("reads any absolute .ptc on disk, as the 1.x tool did, with the particle inspect answer", async () => {
    const { isError, body } = await reply({ particle_path: FIXTURE });
    expect(isError).toBe(false);
    expect(body).toMatchObject({
      ok: true,
      action: "inspect",
      readback: { source: "disk", emitterCount: 2, curveCount: 3, version: 2 },
    });
    expect(body.readback.emitters.map((e: { name: string }) => e.name)).toEqual([
      "spark_core",
      "debris",
    ]);
  });

  it("pages emitters with cursor and limit", async () => {
    const { body } = await reply({ particle_path: FIXTURE, limit: 1 });
    expect(body.readback.emitters).toHaveLength(1);
    expect(body.readback.nextCursor).toBe("1:2");
    const next = await reply({
      particle_path: FIXTURE,
      limit: 1,
      cursor: body.readback.nextCursor,
    });
    expect(next.body.readback.emitters[0].name).toBe("debris");
  });

  it("refuses a flag-looking path, a file that is not a .ptc and a missing file", async () => {
    const dash = await reply({ particle_path: "-rf.ptc" });
    expect(dash.isError).toBe(true);
    expect(dash.body.message).toMatch(/'-'/);
    const txt = await reply({ particle_path: join(FIXTURES, "particle-two-emitters.txt") });
    expect(txt.body).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    const gone = await reply({ particle_path: join(FIXTURES, "nope-not-here.ptc") });
    expect(gone.body).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
  });

  it("reports an effect-less file as an error, not a crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "particle-inspect-"));
    try {
      const f = join(dir, "x.ptc");
      writeFileSync(f, "Foo {\n}");
      const { isError, body } = await reply({ particle_path: f });
      expect(isError).toBe(true);
      expect(body.message).toMatch(/not a particle effect/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
