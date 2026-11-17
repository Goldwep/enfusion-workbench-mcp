import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Config } from "../../src/config.js";
import { CstDocument, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import type { ActionError, ActionOk } from "../../src/manifest/vocabulary.js";
import {
  CURVES,
  EFFECT_KEYS,
  EMITTER_KEYS,
  PARTICLE_DESCRIPTION,
  READ_ACTIONS,
  WRITE_ACTIONS,
  convertValue,
  fmtNum,
  pickEmitter,
  registerParticle,
  runParticle,
  skeleton,
  unwritableReason,
  validateView,
  viewParticle,
  type PakLike,
  type ParticleRequest,
} from "../../src/tools/particle.js";
import { captureTool } from "./_tool-harness.js";

// One effect in the engine's own style: one space of indent, LF, no final line ending.
const SAMPLE = [
  "EffectDef {",
  " Version 2",
  " LightRadius 5",
  " Emitters {",
  "  EmitterDef spark_core {",
  "   ShapeType Point",
  "   MaxNum 20",
  "   BirthRate 100",
  "   LodMin 0",
  "   LodMax 2",
  '   Material "{AAAA000000000001}Particles/_Materials/Spark.emat"',
  "   Lifetime 0.6",
  "   Color {",
  "    0 1 0.5 0.2 1 0.1 0.1 0.1",
  "   }",
  "   Alpha {",
  "    0 0 0.1 1 1 0",
  "   }",
  "   EmittingTime 2",
  "  }",
  "  EmitterDef debris {",
  "   ParticleType Prefab",
  "   BirthRate 4",
  '   Material "{AAAA000000000002}Particles/_Materials/Smoke.emat"',
  '   Prefab "{BBBB000000000001}Prefabs/Particles/Debris.et"',
  "   Size {",
  "    0 1 1 2",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const PAK_EFFECT = [
  "EffectDef {",
  " Emitters {",
  "  EmitterDef smoke {",
  "   BirthRate 9",
  '   Material "{CCCC000000000001}Particles/_Materials/Gas.emat"',
  "   Alpha {",
  "    0 1 1 0",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "particle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const gameFiles = new Map<string, string>([
  ["particles/vanilla/smoke.ptc", PAK_EFFECT],
  ["particles/_materials/spark.emat", "x"],
  ["particles/gameonly/glow.ptc", PAK_EFFECT],
]);
const vfs: PakLike = {
  exists: (p) => gameFiles.has(p.toLowerCase()),
  readFile: (p) => {
    const t = gameFiles.get(p.toLowerCase());
    if (t === undefined) throw new Error(`not in pak: ${p}`);
    return Buffer.from(t, "utf8");
  },
};
const config = { projectPath: dir, gamePath: "", dataDir: "" } as Config;

const at = (rel: string): string => join(dir, ...rel.split("/"));
const text = (rel: string): string => readFileSync(at(rel), "utf8");
function put(rel: string, body: string | Buffer): void {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), body);
}
let n = 0;
const fresh = (body = SAMPLE): string => {
  const rel = `Particles/t${n++}.ptc`;
  put(rel, body);
  return rel;
};

type Ok = ActionOk & { dryRun?: boolean };
type Reply = Ok | ActionError;
const run = (req: ParticleRequest, deps = { vfs }): Reply => runParticle(req, config, deps);
function ok(req: ParticleRequest): Ok {
  const r = run(req);
  if (!r.ok) throw new Error(`${req.action}: ${r.code}: ${r.message}`);
  return r;
}
function fail(req: ParticleRequest): ActionError {
  const r = run(req);
  if (r.ok) throw new Error(`${req.action} should have been refused`);
  return r;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rb = (r: ActionOk): any => r.readback;
const write = (req: ParticleRequest): Ok => ok({ ...req, confirm: true });

describe("registration", () => {
  it("keeps its description at the spec text, within 400 characters", () => {
    let name = "";
    let description = "";
    registerParticle(
      {
        registerTool: (nm: string, d: { description: string }) => {
          name = nm;
          description = d.description;
        },
      } as never,
      {} as Config,
    );
    expect(name).toBe("particle");
    expect(description).toBe(PARTICLE_DESCRIPTION);
    expect(description.length).toBe(353);
    for (const a of [...READ_ACTIONS, ...WRITE_ACTIONS]) expect(description).toContain(a);
  });

  it("answers through the registered handler as JSON, and flags a refusal as an error", async () => {
    const handler = captureTool((s) => registerParticle(s, config));
    const rel = fresh();
    const good = await handler({ action: "emitters", path: rel });
    expect(good.isError).toBe(false);
    expect(JSON.parse(good.content[0].text).readback.total).toBe(2);
    const refused = await handler({ action: "emitters", path: "Particles/nope.ptc" });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text).code).toBe("PATH_NOT_FOUND");
  });
});

describe("the model", () => {
  const view = viewParticle(new CstDocument(SAMPLE));

  it("reads the effect, its emitters and their curves", () => {
    expect(view.ok).toBe(true);
    expect(view.effect.map((p) => p.key)).toEqual(["Version", "LightRadius"]);
    expect(view.emitters.map((e) => [e.ordinal, e.childIndex, e.name])).toEqual([
      [0, 0, "spark_core"],
      [1, 1, "debris"],
    ]);
    const spark = view.emitters[0];
    expect(spark.curves.map((c) => [c.name, c.stride, c.points, c.wellFormed])).toEqual([
      ["Color", 4, 2, true],
      ["Alpha", 2, 3, true],
    ]);
    expect(spark.props.find((p) => p.key === "Material")?.quoted).toBe(true);
    expect(spark.line).toBe(5);
  });

  it("never throws and reports what is not an effect", () => {
    for (const t of [
      "",
      "}",
      "Foo {\n}",
      "A {\n}\nB {\n}",
      "EffectDef {\n Emitters {",
      "\u0000\u0001",
    ]) {
      expect(() => viewParticle(new CstDocument(t))).not.toThrow();
    }
    expect(viewParticle(new CstDocument("Foo {\n}")).ok).toBe(false);
    expect(viewParticle(new CstDocument("")).ok).toBe(false);
  });

  it("has a catalog entry for every key the fixtures use, and a stride for every curve", () => {
    for (const p of view.effect) expect(EFFECT_KEYS[p.key], p.key).toBeDefined();
    for (const e of view.emitters) {
      for (const p of e.props) expect(EMITTER_KEYS[p.key], p.key).toBeDefined();
      for (const c of e.curves) expect(CURVES[c.name], c.name).toBeDefined();
    }
  });

  it("picks an emitter by name or index and refuses the unclear", () => {
    expect(pickEmitter(view, { emitter: "debris" }).ordinal).toBe(1);
    expect(pickEmitter(view, { index: 0 }).name).toBe("spark_core");
    expect(() => pickEmitter(view, { emitter: "zzz" })).toThrow(
      /no emitter named "zzz".*spark_core/,
    );
    expect(() => pickEmitter(view, { index: 9 })).toThrow(/no emitter at index 9/);
    expect(() => pickEmitter(view, {})).toThrow(/emitter \(a name\) or index/);
    expect(() => pickEmitter(view, { emitter: "debris", index: 1 })).toThrow(/not both/);
    const dup = viewParticle(
      new CstDocument(
        "EffectDef {\n Emitters {\n  EmitterDef a {\n  }\n  EmitterDef a {\n  }\n }\n}",
      ),
    );
    expect(() => pickEmitter(dup, { emitter: "a" })).toThrow(
      /2 emitters are named "a".*pass index/,
    );
  });

  it("formats numbers without an exponent and converts values by kind", () => {
    expect(fmtNum(0.0000001)).toBe("0.0000001");
    expect(fmtNum(1e21)).toBe("1000000000000000000000");
    expect(fmtNum(-0)).toBe("0");
    expect(fmtNum(0.6)).toBe("0.6");
    expect(convertValue(EMITTER_KEYS.BirthRate, "BirthRate", "12.50").items).toEqual(["12.5"]);
    expect(convertValue(EMITTER_KEYS.ShapeSize, "ShapeSize", "1 2 3").items).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(convertValue(EMITTER_KEYS.ShapeSize, "ShapeSize", [1, 2, 3]).items).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(convertValue(EMITTER_KEYS.Repeat, "Repeat", true).items).toEqual(["1"]);
    expect(convertValue(EMITTER_KEYS.Repeat, "Repeat", "false").items).toEqual(["0"]);
    const mat = convertValue(EMITTER_KEYS.Material, "Material", "{aaaa000000000001}x/y.emat");
    expect(mat).toMatchObject({ items: ["{AAAA000000000001}x/y.emat"], quoted: true });
    expect(convertValue(EMITTER_KEYS.ShapeType, "ShapeType", "Cube").warnings[0]).toMatch(
      /not a value/,
    );
    expect(() => convertValue(EMITTER_KEYS.BirthRate, "BirthRate", "fast")).toThrow(/not a number/);
    expect(() => convertValue(EMITTER_KEYS.ShapeSize, "ShapeSize", [1, 2])).toThrow(/3 number/);
    expect(() => convertValue(EMITTER_KEYS.Repeat, "Repeat", 2)).toThrow(/flag/);
    expect(() => convertValue(EMITTER_KEYS.Material, "Material", "x.emat")).toThrow(/{GUID}path/);
    expect(() => convertValue(EMITTER_KEYS.Material, "Material", "{AAAA000000000001}x.et")).toThrow(
      /\.emat/,
    );
    expect(() => convertValue(undefined, "Foo", 'a b"c')).toThrow(/bare/);
    expect(() => convertValue(EMITTER_KEYS.BirthRate, "BirthRate", [])).toThrow(/empty/);
  });

  it("explains why it would not edit a file", () => {
    const good = parseCstBytes(Buffer.from(SAMPLE));
    expect(unwritableReason(Buffer.from(SAMPLE), good)).toBeUndefined();
    const open = Buffer.from("EffectDef {\n Emitters {\n");
    expect(unwritableReason(open, parseCstBytes(open))).toMatch(/does not parse cleanly/);
    const other = Buffer.from("Foo {\n}");
    expect(unwritableReason(other, parseCstBytes(other))).toMatch(/not a single EffectDef/);
    const two = Buffer.from("EffectDef {\n Emitters {\n }\n Emitters {\n }\n}");
    expect(unwritableReason(two, parseCstBytes(two))).toMatch(/more than one Emitters/);
  });
});

describe("catalog", () => {
  it("lists every key and curve, with the shape of each value", () => {
    const r = ok({ action: "catalog", limit: 200 });
    const rows = rb(r).rows as { scope: string; key: string; kind?: string; stride?: number }[];
    expect(rows.filter((x) => x.scope === "effect")).toHaveLength(Object.keys(EFFECT_KEYS).length);
    expect(rows.filter((x) => x.scope === "emitter")).toHaveLength(
      Object.keys(EMITTER_KEYS).length,
    );
    expect(rows.filter((x) => x.scope === "curve")).toHaveLength(Object.keys(CURVES).length);
    expect(rows.find((x) => x.key === "ShapeSize")).toMatchObject({ kind: "vec3", count: 3 });
    expect(rows.find((x) => x.key === "Material")).toMatchObject({ kind: "ref", ext: ".emat" });
    expect(rows.find((x) => x.key === "ColorMast")).toMatchObject({ scope: "curve", stride: 4 });
  });

  it("filters by key text and pages", () => {
    const f = ok({ action: "catalog", key: "mast" });
    expect(
      rb(f)
        .rows.map((x: { key: string }) => x.key)
        .sort(),
    ).toEqual([
      "AirResistanceMast",
      "AlphaMast",
      "BRateMast",
      "ColorMast",
      "LightColorMast",
      "LightIntensityMast",
      "RotationSpeedMast",
      "SizeMast",
      "VelocityMast",
    ]);
    const p1 = ok({ action: "catalog", limit: 10 });
    expect(rb(p1).rows).toHaveLength(10);
    const p2 = ok({ action: "catalog", limit: 10, cursor: rb(p1).nextCursor });
    expect(rb(p2).rows[0].key).not.toBe(rb(p1).rows[0].key);
    expect(rb(p2).total).toBe(rb(p1).total);
  });

  it("needs no path and does not touch one", () => {
    expect(ok({ action: "catalog", path: "nope.txt" }).target).toBe("catalog");
  });
});

describe("reads", () => {
  it("inspect: the effect, counts and one row per emitter", () => {
    const r = ok({ action: "inspect", path: fresh() });
    expect(r.target).toMatch(/^path:Particles\/t\d+\.ptc$/);
    expect(rb(r)).toMatchObject({
      source: "project",
      version: 2,
      effect: { Version: 2, LightRadius: 5 },
      emitterCount: 2,
      curveCount: 3,
    });
    expect(rb(r).emitters[0]).toEqual({
      index: 0,
      name: "spark_core",
      shapeType: "Point",
      maxNum: 20,
      birthRate: 100,
      lifetime: 0.6,
      emittingTime: 2,
      lod: [0, 2],
      material: "{AAAA000000000001}Particles/_Materials/Spark.emat",
      curves: ["Color", "Alpha"],
      line: 5,
    });
    expect(rb(r).emitters[1]).toMatchObject({
      particleType: "Prefab",
      prefab: "{BBBB000000000001}Prefabs/Particles/Debris.et",
    });
  });

  it("reads a game path from the paks, flags it read only, and prefers a project file of that path", () => {
    const g = ok({ action: "inspect", path: "Particles/Vanilla/Smoke.ptc" });
    expect(rb(g).source).toBe("game");
    expect(g.warnings.join(" ")).toMatch(/game resource \(read only\)/);
    put("Particles/Vanilla/Smoke.ptc", SAMPLE);
    expect(rb(ok({ action: "inspect", path: "Particles/Vanilla/Smoke.ptc" })).source).toBe(
      "project",
    );
    expect(
      rb(ok({ action: "inspect", path: "{0123456789ABCDEF}Particles/Vanilla/Smoke.ptc" }))
        .emitterCount,
    ).toBe(2);
  });

  it("refuses a bad path before reading anything", () => {
    expect(fail({ action: "inspect" }).code).toBe("INVALID_ARGUMENT");
    expect(fail({ action: "inspect", path: "-x.ptc" }).message).toMatch(/'-'/);
    expect(fail({ action: "inspect", path: "Particles/a.txt" }).message).toMatch(/not a \.ptc/);
    expect(fail({ action: "inspect", path: "../up.ptc" }).code).toBe("ABSOLUTE_PATH");
    expect(fail({ action: "inspect", path: "Particles/missing.ptc" }).code).toBe("PATH_NOT_FOUND");
    expect(fail({ action: "inspect", path: "Particles/missing.ptc" }).message).toMatch(
      /not in the game data/,
    );
    expect(
      runParticle({ action: "inspect", path: "Particles/missing.ptc" }, config, { vfs: null }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("game paks not available"),
    });
    expect(fail({ action: "nope" as never, path: "a.ptc" }).message).toMatch(/unknown action/);
    expect(fail({ action: "inspect", path: fresh("Foo {\n}") }).message).toMatch(
      /not a particle effect/,
    );
  });

  it("refuses an absolute path outside the project, unless the alias asks for disk reads", () => {
    const outside = mkdtempSync(join(tmpdir(), "particle-out-"));
    try {
      const file = join(outside, "x.ptc");
      writeFileSync(file, SAMPLE);
      expect(fail({ action: "inspect", path: file }).code).toBe("NOT_IN_PROJECT");
      const r = runParticle({ action: "inspect", path: file }, config, { vfs, allowDisk: true });
      expect(r.ok && rb(r).source).toBe("disk");
      expect(
        runParticle({ action: "inspect", path: join(outside, "gone.ptc") }, config, {
          allowDisk: true,
        }),
      ).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
      expect(
        runParticle({ action: "inspect", path: join(outside, "x.txt") }, config, {
          allowDisk: true,
        }),
      ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      // Disk reads never become disk writes.
      expect(
        runParticle(
          { action: "set", path: file, props: { LightRadius: 1 }, confirm: true },
          config,
          { vfs, allowDisk: true },
        ),
      ).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
      expect(readFileSync(file, "utf8")).toBe(SAMPLE);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    expect(fail({ action: "inspect", path: join(dir, "..", "elsewhere", "x.ptc") }).code).toBe(
      "NOT_IN_PROJECT",
    );
  });

  it("accepts an absolute path inside the project", () => {
    const rel = fresh();
    expect(rb(ok({ action: "inspect", path: at(rel) })).emitterCount).toBe(2);
  });

  it("emitters: pages with a cursor and refuses a stale or malformed one", () => {
    const body = skeletonWith(5);
    const rel = fresh(body);
    const p1 = ok({ action: "emitters", path: rel, limit: 2 });
    expect(rb(p1).total).toBe(5);
    expect(rb(p1).emitters.map((e: { name: string }) => e.name)).toEqual(["e0", "e1"]);
    const p2 = ok({ action: "emitters", path: rel, limit: 2, cursor: rb(p1).nextCursor });
    expect(rb(p2).emitters.map((e: { name: string }) => e.name)).toEqual(["e2", "e3"]);
    const p3 = ok({ action: "emitters", path: rel, limit: 2, cursor: rb(p2).nextCursor });
    expect(rb(p3).emitters.map((e: { name: string }) => e.name)).toEqual(["e4"]);
    expect(rb(p3).nextCursor).toBeUndefined();
    const other = fresh(skeletonWith(3));
    expect(fail({ action: "emitters", path: other, cursor: rb(p1).nextCursor }).code).toBe(
      "STALE_CURSOR",
    );
    expect(fail({ action: "emitters", path: rel, cursor: "nonsense" }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(fail({ action: "emitters", path: rel, limit: 0 }).code).toBe("INVALID_ARGUMENT");
    expect(fail({ action: "emitters", path: rel, limit: 201 }).code).toBe("INVALID_ARGUMENT");
    expect(rb(ok({ action: "inspect", path: rel, limit: 2 })).nextCursor).toBe("2:5");
  });

  it("emitter: every property, the curves, and the keys the catalog does not know", () => {
    const rel = fresh(SAMPLE.replace("   MaxNum 20", "   MaxNum 20\n   Wobble 3"));
    const r = ok({ action: "emitter", path: rel, emitter: "spark_core" });
    expect(rb(r).props[0]).toMatchObject({ key: "ShapeType", value: "Point" });
    expect(rb(r).props.find((p: { key: string }) => p.key === "Wobble")).toMatchObject({
      value: 3,
      known: false,
    });
    expect(rb(r).unknownKeys).toEqual(["Wobble"]);
    expect(rb(r).curves).toEqual([
      { name: "Color", stride: 4, points: 2, line: 14 },
      { name: "Alpha", stride: 2, points: 3, line: 17 },
    ]);
    expect(rb(ok({ action: "emitter", path: rel, index: 1 })).name).toBe("debris");
    expect(fail({ action: "emitter", path: rel, emitter: "zzz" }).code).toBe("PATH_NOT_FOUND");
    expect(fail({ action: "emitter", path: rel }).code).toBe("INVALID_ARGUMENT");
  });

  it("curves: all of them, one emitter, or one curve name, with the points as tuples", () => {
    const rel = fresh();
    const all = ok({ action: "curves", path: rel });
    expect(rb(all).total).toBe(3);
    expect(rb(all).curves[0]).toMatchObject({
      emitter: "spark_core",
      curve: "Color",
      stride: 4,
      count: 2,
      points: [
        [0, 1, 0.5, 0.2],
        [1, 0.1, 0.1, 0.1],
      ],
    });
    expect(
      rb(ok({ action: "curves", path: rel, emitter: "debris" })).curves.map(
        (c: { curve: string }) => c.curve,
      ),
    ).toEqual(["Size"]);
    expect(rb(ok({ action: "curves", path: rel, curve: "Alpha" })).total).toBe(1);
    expect(rb(ok({ action: "curves", path: rel, limit: 1 })).nextCursor).toBe("1:3");
  });

  it("refs: material and prefab refs, found in the project, the game or nowhere", () => {
    put("Particles/_Materials/Smoke.emat", "x");
    const rel = fresh(
      SAMPLE.replace("LightRadius 5", 'LightRadius 5\n CollisionPreset "{DDDD000000000001}"'),
    );
    const r = ok({ action: "refs", path: rel });
    const rows = rb(r).refs as { emitter?: string; key: string; found?: string; guid: string }[];
    expect(rows.map((x) => [x.emitter, x.key, x.found])).toEqual([
      [undefined, "CollisionPreset", undefined],
      ["spark_core", "Material", "game"],
      ["debris", "Material", "project"],
      ["debris", "Prefab", "missing"],
    ]);
    expect(rows[1].guid).toBe("AAAA000000000001");
    expect(rb(r).missing).toBe(1);
  });

  it("validate: a clean file is valid, a broken one lists its issues with lines", () => {
    expect(rb(ok({ action: "validate", path: fresh() }))).toMatchObject({ valid: true, errors: 0 });
    const broken = [
      "EffectDef {",
      " Version 3",
      " Emitters {",
      "  EmitterDef a {",
      "   BirthRate fast",
      "   Wobble 1",
      "   LodMin 2",
      "   LodMax 1",
      "   ParticleType Prefab",
      "   Alpha {",
      "    0.5 1 0.2 0",
      "   }",
      "   Size {",
      "    0 1 2",
      "   }",
      "   Size {",
      "    0 1 2 3",
      "   }",
      "   Color {",
      "    0 1 2 3 4",
      "   }",
      "  }",
      "  EmitterDef a {",
      "   BirthRate 1",
      "   BirthRate 2",
      '   Material "x"',
      "  }",
      " }",
      "}",
    ].join("\n");
    const r = ok({ action: "validate", path: fresh(broken) });
    expect(rb(r).valid).toBe(false);
    const issues = rb(r).issues as {
      severity: string;
      code: string;
      line?: number;
      emitter?: string;
    }[];
    const codes = issues.map((i) => i.code);
    for (const c of [
      "UNSEEN_VALUE",
      "BAD_VALUE",
      "UNKNOWN_KEY",
      "LOD_RANGE",
      "NO_PREFAB",
      "CURVE_ORDER",
      "BAD_CURVE",
      "DUPLICATE_CURVE",
      "DUPLICATE_NAME",
      "DUPLICATE_KEY",
    ]) {
      expect(codes, c).toContain(c);
    }
    expect(issues.find((i) => i.code === "BAD_VALUE" && i.line === 5)).toBeDefined();
    expect(
      issues
        .filter((i) => i.severity === "error")
        .map((i) => i.code)
        .sort(),
    ).toEqual(["BAD_CURVE", "BAD_CURVE", "BAD_VALUE", "BAD_VALUE", "CURVE_ORDER"].sort());
    // Parse problems and a wrong root are errors too.
    const open = viewParticle(new CstDocument("EffectDef {\n Emitters {"));
    expect(
      validateView(new CstDocument("EffectDef {\n Emitters {"), open).some(
        (i) => i.code === "PARSE",
      ),
    ).toBe(true);
    const foo = new CstDocument("Foo {\n}");
    expect(validateView(foo, viewParticle(foo))[0].code).toBe("ROOT");
    const twice = fresh(SAMPLE.replace("   MaxNum 20", "   Wobble 1\n   Wobble 2"));
    expect(rb(ok({ action: "validate", path: twice, limit: 1 })).issues).toHaveLength(1);
  });

  it("diff: structural differences by name, identical files, and a changed order", () => {
    const a = fresh();
    const same = fresh();
    expect(rb(ok({ action: "diff", path: a, against: same })).identical).toBe(true);
    expect(rb(ok({ action: "diff", path: a, against: same })).total).toBe(0);
    const edited = SAMPLE.replace("LightRadius 5", "LightRadius 6")
      .replace("   BirthRate 100", "   BirthRate 90")
      .replace("   0 0 0.1 1 1 0", "   0 0 0.2 1 1 0")
      .replace("   EmittingTime 2\n", "")
      .replace("   Size {\n    0 1 1 2\n   }\n", "");
    const b = fresh(edited);
    const d = ok({ action: "diff", path: a, against: b });
    expect(rb(d).identical).toBe(false);
    const rows = rb(d).differences as {
      scope: string;
      emitter?: string;
      key?: string;
      change: string;
      before?: unknown;
      after?: unknown;
    }[];
    expect(rows).toContainEqual({
      scope: "effect",
      key: "LightRadius",
      change: "changed",
      before: "5",
      after: "6",
    });
    expect(rows).toContainEqual({
      scope: "emitter",
      emitter: "spark_core",
      key: "BirthRate",
      change: "changed",
      before: "100",
      after: "90",
    });
    expect(rows).toContainEqual({
      scope: "emitter",
      emitter: "spark_core",
      key: "EmittingTime",
      change: "removed",
      before: "2",
    });
    expect(rows).toContainEqual({
      scope: "curve",
      emitter: "spark_core",
      key: "Alpha",
      change: "changed",
      before: "0 0 0.1 1 1 0",
      after: "0 0 0.2 1 1 0",
    });
    expect(rows).toContainEqual({
      scope: "curve",
      emitter: "debris",
      key: "Size",
      change: "removed",
      before: "0 1 1 2",
    });
    // Added and removed emitters, and an order change.
    const e = ok({
      action: "diff",
      path: a,
      against: fresh(SAMPLE.replace("EmitterDef debris", "EmitterDef other")),
    });
    const keys = (rb(e).differences as { scope: string; key?: string; change: string }[]).filter(
      (r) => r.scope === "emitters",
    );
    expect(keys.map((r) => `${r.change}:${r.key}`).sort()).toEqual([
      "added:other",
      "removed:debris",
    ]);
    const swapped = fresh(swapEmitters(SAMPLE));
    const o = rb(ok({ action: "diff", path: a, against: swapped })).differences;
    expect(o).toEqual([
      {
        scope: "order",
        change: "changed",
        before: ["spark_core", "debris"],
        after: ["debris", "spark_core"],
      },
    ]);
    expect(fail({ action: "diff", path: a }).code).toBe("INVALID_ARGUMENT");
    expect(fail({ action: "diff", path: a, against: "Particles/none.ptc" }).code).toBe(
      "PATH_NOT_FOUND",
    );
    // A pak file is a valid side of a diff.
    expect(
      rb(ok({ action: "diff", path: a, against: "Particles/Vanilla/Smoke.ptc" })).againstSource,
    ).toBe("project");
  });
});

function skeletonWith(count: number): string {
  const em = Array.from(
    { length: count },
    (_, i) => `  EmitterDef e${i} {\n   BirthRate ${i}\n  }`,
  );
  return `EffectDef {\n Version 2\n Emitters {\n${em.join("\n")}\n }\n}`;
}

function swapEmitters(s: string): string {
  const lines = s.split("\n");
  const a = lines.slice(4, 20);
  const b = lines.slice(20, 29);
  return [...lines.slice(0, 4), ...b, ...a, ...lines.slice(29)].join("\n");
}

describe("set", () => {
  it("is a dry run by default: a diff, no file change, no backup", () => {
    const rel = fresh();
    const r = ok({ action: "set", path: rel, emitter: "spark_core", props: { BirthRate: 150 } });
    expect(r.dryRun).toBe(true);
    expect(r.next).toMatch(/confirm: true/);
    expect(r.changed).toEqual([
      { path: "Emitters[spark_core].BirthRate", before: "100", after: "150" },
    ]);
    expect(rb(r).diff).toContain("-   BirthRate 100\n+   BirthRate 150");
    expect(text(rel)).toBe(SAMPLE);
    expect(existsSync(at(`${rel}.bak`))).toBe(false);
  });

  it("with confirm changes only that value, keeps a .bak of the old file and reads back", () => {
    const rel = fresh();
    const r = write({
      action: "set",
      path: rel,
      emitter: "spark_core",
      props: { BirthRate: 150, Lifetime: "0.75" },
    });
    expect(r.dryRun).toBe(false);
    expect(text(rel)).toBe(
      SAMPLE.replace("BirthRate 100", "BirthRate 150").replace("Lifetime 0.6", "Lifetime 0.75"),
    );
    expect(text(`${rel}.bak`)).toBe(SAMPLE);
    expect(rb(r)).toMatchObject({ emitters: 2, curves: 3, backup: `${rel}.bak` });
    expect(r.next).toMatch(/Particle Editor tab/);
  });

  it("sets an effect key, adding a new one before the Emitters block", () => {
    const rel = fresh();
    const r = write({
      action: "set",
      path: rel,
      props: { LightRadius: 8, CastShadow: true, LightOffset: [0, 2, 0] },
    });
    expect(r.changed).toEqual([
      { path: "EffectDef.LightRadius", before: "5", after: "8" },
      { path: "EffectDef.CastShadow", before: null, after: "1" },
      { path: "EffectDef.LightOffset", before: null, after: "0 2 0" },
    ]);
    expect(text(rel).split("\n").slice(0, 6)).toEqual([
      "EffectDef {",
      " Version 2",
      " LightRadius 8",
      " CastShadow 1",
      " LightOffset 0 2 0",
      " Emitters {",
    ]);
  });

  it("adds a new emitter key before the emitter's first curve and quotes refs", () => {
    const rel = fresh();
    write({
      action: "set",
      path: rel,
      index: 0,
      props: { Velocity: 4, Prefab: "{bbbb000000000009}Prefabs/X.et" },
    });
    const lines = text(rel).split("\n");
    const i = lines.indexOf("   Velocity 4");
    expect(lines.slice(i, i + 3)).toEqual([
      "   Velocity 4",
      '   Prefab "{BBBB000000000009}Prefabs/X.et"',
      "   Color {",
    ]);
  });

  it("keeps the quoting of an existing value when a ref is replaced", () => {
    const rel = fresh();
    write({
      action: "set",
      path: rel,
      emitter: "debris",
      props: { Material: "{AAAA000000000003}Particles/_Materials/New.emat" },
    });
    expect(text(rel)).toContain('   Material "{AAAA000000000003}Particles/_Materials/New.emat"');
  });

  it("removes keys with unset, and says so when a key is not set", () => {
    const rel = fresh();
    const r = write({
      action: "set",
      path: rel,
      emitter: "spark_core",
      unset: ["EmittingTime", "Nope"],
    });
    expect(r.changed).toEqual([
      { path: "Emitters[spark_core].EmittingTime", before: "2", after: null },
    ]);
    expect(r.warnings.join(" ")).toMatch(/Nope is not set/);
    expect(text(rel)).toBe(SAMPLE.replace("   EmittingTime 2\n", ""));
  });

  it("refuses what it should: nothing to do, unknown keys, curves, structure, bad values", () => {
    const rel = fresh();
    expect(fail({ action: "set", path: rel }).message).toMatch(/needs props/);
    expect(
      fail({ action: "set", path: rel, emitter: "debris", props: { Wobble: 1 } }).message,
    ).toMatch(/not a known emitter key/);
    expect(fail({ action: "set", path: rel, props: { Wobble: 1 } }).message).toMatch(
      /not a known effect key/,
    );
    expect(
      fail({ action: "set", path: rel, emitter: "debris", props: { Alpha: 1 } }).message,
    ).toMatch(/use setCurve/);
    expect(fail({ action: "set", path: rel, props: { Emitters: 1 } }).message).toMatch(/structure/);
    expect(fail({ action: "set", path: rel, props: { "bad key": 1 } }).message).toMatch(
      /not a key/,
    );
    expect(
      fail({ action: "set", path: rel, emitter: "debris", props: { BirthRate: "fast" } }).message,
    ).toMatch(/not a number/);
    expect(fail({ action: "set", path: rel, emitter: "zzz", props: { BirthRate: 1 } }).code).toBe(
      "PATH_NOT_FOUND",
    );
    expect(fail({ action: "set", path: rel, emitter: "debris", unset: ["not a key"] }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(text(rel)).toBe(SAMPLE);
  });

  it("writes an unknown key only with allowUnknown, and edits an unknown key that is already there", () => {
    const rel = fresh();
    const r = write({
      action: "set",
      path: rel,
      emitter: "debris",
      props: { Wobble: [1, 2] },
      allowUnknown: true,
    });
    expect(r.warnings.join(" ")).toMatch(/not in the catalog/);
    expect(text(rel)).toContain("   Wobble 1 2");
    const again = write({ action: "set", path: rel, emitter: "debris", props: { Wobble: "text" } });
    expect(again.changed).toEqual([
      { path: "Emitters[debris].Wobble", before: "1 2", after: "text" },
    ]);
    const quoted = write({
      action: "set",
      path: rel,
      emitter: "debris",
      props: { Wobble: "{AAAA000000000001}x/y" },
    });
    expect(quoted.ok).toBe(true);
    expect(text(rel)).toContain('   Wobble "{AAAA000000000001}x/y"');
  });

  it("warns when a key repeats and a value the vanilla files never use", () => {
    const rel = fresh(SAMPLE.replace("   MaxNum 20", "   MaxNum 20\n   MaxNum 30"));
    const r = write({
      action: "set",
      path: rel,
      emitter: "spark_core",
      props: { MaxNum: 5, ShapeType: "Cube" },
    });
    expect(r.warnings.join(" ")).toMatch(/MaxNum appears more than once/);
    expect(r.warnings.join(" ")).toMatch(/ShapeType Cube/);
    expect(text(rel)).toContain("   MaxNum 5\n   MaxNum 30");
  });

  it("a set that changes nothing writes nothing and keeps no backup", () => {
    const rel = fresh();
    const r = write({ action: "set", path: rel, emitter: "spark_core", props: { BirthRate: 100 } });
    expect(r.changed).toEqual([
      { path: "Emitters[spark_core].BirthRate", before: "100", after: "100" },
    ]);
    expect(rb(r).diff).toBe("");
    expect(existsSync(at(`${rel}.bak`))).toBe(false);
  });

  it("keeps CRLF line endings and a tab indent", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const rel = fresh(crlf);
    write({ action: "set", path: rel, props: { MinFPS: 24 } });
    expect(text(rel)).toBe(crlf.replace(" Emitters {", " MinFPS 24\r\n Emitters {"));
    const tabs = SAMPLE.replace(/^ +/gm, (m) => "\t".repeat(m.length));
    const rel2 = fresh(tabs);
    write({ action: "set", path: rel2, emitter: "debris", props: { Velocity: 3 } });
    expect(text(rel2)).toContain("\t\t\tVelocity 3\n\t\t\tSize {");
  });
});

describe("setCurve", () => {
  it("replaces the numbers of an existing curve in place", () => {
    const rel = fresh();
    const r = write({
      action: "setCurve",
      path: rel,
      emitter: "spark_core",
      curve: "Alpha",
      points: [0, 0, 0.5, 1, 1, 0.25],
    });
    expect(r.changed).toEqual([
      { path: "Emitters[spark_core].Alpha", before: "0 0 0.1 1 1 0", after: "0 0 0.5 1 1 0.25" },
    ]);
    expect(text(rel)).toBe(SAMPLE.replace("0 0 0.1 1 1 0", "0 0 0.5 1 1 0.25"));
  });

  it("adds a curve at the end of the emitter, in the file's own style", () => {
    const rel = fresh();
    write({
      action: "setCurve",
      path: rel,
      emitter: "debris",
      curve: "Color",
      points: [0, 1, 1, 1, 1, 0, 0, 0],
    });
    const lines = text(rel).split("\n");
    const i = lines.indexOf("   Color {", 24);
    expect(lines.slice(i - 1, i + 4)).toEqual([
      "   }",
      "   Color {",
      "    0 1 1 1 1 0 0 0",
      "   }",
      "  }",
    ]);
  });

  it("removes a curve with an empty point list", () => {
    const rel = fresh();
    const r = write({
      action: "setCurve",
      path: rel,
      emitter: "spark_core",
      curve: "Color",
      points: [],
    });
    expect(r.changed).toEqual([
      { path: "Emitters[spark_core].Color", before: "0 1 0.5 0.2 1 0.1 0.1 0.1", after: null },
    ]);
    expect(text(rel)).toBe(SAMPLE.replace("   Color {\n    0 1 0.5 0.2 1 0.1 0.1 0.1\n   }\n", ""));
    expect(
      fail({ action: "setCurve", path: rel, emitter: "spark_core", curve: "Color", points: [] })
        .message,
    ).toMatch(/has no Color curve/);
  });

  it("replaces a curve whose numbers run over several lines", () => {
    const rel = fresh(SAMPLE.replace("    0 0 0.1 1 1 0", "    0 0 0.1\n    1 1 0"));
    write({
      action: "setCurve",
      path: rel,
      emitter: "spark_core",
      curve: "Alpha",
      points: [0, 1, 1, 0],
    });
    expect(text(rel)).toBe(SAMPLE.replace("0 0 0.1 1 1 0", "0 1 1 0"));
  });

  it("refuses wrong strides, bad times and unknown curves", () => {
    const rel = fresh();
    const base = { action: "setCurve" as const, path: rel, emitter: "spark_core" };
    expect(fail({ ...base, curve: "Alpha", points: [0, 1, 1] }).message).toMatch(
      /2 numbers per point/,
    );
    expect(fail({ ...base, curve: "Color", points: [0, 1, 1, 1, 1, 0] }).message).toMatch(
      /4 numbers per point/,
    );
    expect(fail({ ...base, curve: "Alpha", points: [0.5, 1, 0.2, 0] }).message).toMatch(
      /must not decrease/,
    );
    expect(fail({ ...base, curve: "Alpha", points: [0, 1, 1.5, 0] }).message).toMatch(
      /within 0 to 1/,
    );
    expect(fail({ ...base, curve: "Alpha", points: [0, Number.NaN] }).message).toMatch(/finite/);
    expect(fail({ ...base, curve: "Wobble", points: [0, 1] }).message).toMatch(/not a known curve/);
    expect(fail({ ...base, points: [0, 1] }).message).toMatch(/curve/);
    expect(fail({ ...base, curve: "Alpha" }).message).toMatch(/points is required/);
    expect(fail({ ...base, emitter: undefined, curve: "Alpha", points: [0, 1] }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(text(rel)).toBe(SAMPLE);
  });

  it("writes an unknown curve as pairs with allowUnknown", () => {
    const rel = fresh();
    const r = write({
      action: "setCurve",
      path: rel,
      emitter: "debris",
      curve: "Wobble",
      points: [0, 1],
      allowUnknown: true,
    });
    expect(r.warnings.join(" ")).toMatch(/not in the catalog/);
    expect(text(rel)).toContain("   Wobble {\n    0 1\n   }");
  });
});

describe("emitter actions", () => {
  it("addEmitter: at the end, with props, and at a position", () => {
    const rel = fresh();
    const r = write({
      action: "addEmitter",
      path: rel,
      name: "glow",
      props: { BirthRate: 5, Material: "{AAAA000000000001}Particles/_Materials/Spark.emat" },
    });
    expect(r.changed).toEqual([
      { path: "Emitters[glow]", before: null, after: { name: "glow", index: 2, props: 2 } },
    ]);
    expect(text(rel)).toBe(
      SAMPLE.replace(
        "\n }\n}",
        '\n  EmitterDef glow {\n   BirthRate 5\n   Material "{AAAA000000000001}Particles/_Materials/Spark.emat"\n  }\n }\n}',
      ),
    );
    const rel2 = fresh();
    write({ action: "addEmitter", path: rel2, name: "first", at: 0 });
    expect(viewParticle(new CstDocument(text(rel2))).emitters.map((e) => e.name)).toEqual([
      "first",
      "spark_core",
      "debris",
    ]);
    expect(text(rel2)).toContain(
      " Emitters {\n  EmitterDef first {\n  }\n  EmitterDef spark_core {",
    );
  });

  it("addEmitter: refuses a taken name, a bad name, a bad position and unknown keys", () => {
    const rel = fresh();
    expect(fail({ action: "addEmitter", path: rel, name: "debris" }).code).toBe("DUPLICATE_ID");
    expect(fail({ action: "addEmitter", path: rel, name: "9x" }).message).toMatch(
      /letters, digits/,
    );
    expect(fail({ action: "addEmitter", path: rel }).message).toMatch(/name is required/);
    expect(fail({ action: "addEmitter", path: rel, name: "x", at: 3 }).message).toMatch(/0 to 2/);
    expect(fail({ action: "addEmitter", path: rel, name: "x", props: { Wobble: 1 } }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(text(rel)).toBe(SAMPLE);
  });

  it("addEmitter: makes the Emitters block when the effect has none", () => {
    const rel = fresh("EffectDef {\n Version 2\n}");
    write({ action: "addEmitter", path: rel, name: "a" });
    expect(text(rel)).toBe("EffectDef {\n Version 2\n Emitters {\n  EmitterDef a {\n  }\n }\n}");
  });

  it("cloneEmitter: copies the whole emitter after the source with a fresh name", () => {
    const rel = fresh();
    const r = write({ action: "cloneEmitter", path: rel, emitter: "spark_core" });
    expect(r.changed).toEqual([
      {
        path: "Emitters[spark_core_copy]",
        before: null,
        after: { name: "spark_core_copy", index: 1, clonedFrom: "spark_core" },
      },
    ]);
    const lines = SAMPLE.split("\n");
    const emitter = lines.slice(4, 20);
    const expected = [
      ...lines.slice(0, 20),
      ...emitter.map((l, i) => (i === 0 ? l.replace("spark_core", "spark_core_copy") : l)),
      ...lines.slice(20),
    ].join("\n");
    expect(text(rel)).toBe(expected);
    // A second clone does not collide.
    write({ action: "cloneEmitter", path: rel, emitter: "spark_core" });
    expect(viewParticle(new CstDocument(text(rel))).emitters.map((e) => e.name)).toEqual([
      "spark_core",
      "spark_core_copy_2",
      "spark_core_copy",
      "debris",
    ]);
  });

  it("cloneEmitter: a given name and position, and the refusals", () => {
    const rel = fresh();
    write({ action: "cloneEmitter", path: rel, index: 1, name: "debris_b", at: 0 });
    expect(viewParticle(new CstDocument(text(rel))).emitters.map((e) => e.name)).toEqual([
      "debris_b",
      "spark_core",
      "debris",
    ]);
    expect(
      fail({ action: "cloneEmitter", path: rel, emitter: "debris", name: "debris" }).code,
    ).toBe("DUPLICATE_ID");
    expect(fail({ action: "cloneEmitter", path: rel, emitter: "zzz" }).code).toBe("PATH_NOT_FOUND");
  });

  it("cloneEmitter: warns that comments are not carried", () => {
    const rel = fresh(SAMPLE.replace("   MaxNum 20", "   MaxNum 20 // cap"));
    const r = write({ action: "cloneEmitter", path: rel, emitter: "spark_core" });
    expect(r.warnings.join(" ")).toMatch(/comments inside the emitter are not copied/);
    expect(text(rel)).toContain("   MaxNum 20 // cap");
  });

  it("copyEmitter: from a project file, and from the game with a ref warning", () => {
    const rel = fresh();
    const other = fresh();
    const r = write({
      action: "copyEmitter",
      path: rel,
      from: other,
      emitter: "debris",
      name: "debris_two",
    });
    expect(r.changed).toEqual([
      {
        path: "Emitters[debris_two]",
        before: null,
        after: { name: "debris_two", index: 2, copiedFrom: `${other}#debris` },
      },
    ]);
    const v = viewParticle(new CstDocument(text(rel)));
    expect(v.emitters.map((e) => e.name)).toEqual(["spark_core", "debris", "debris_two"]);
    expect(v.emitters[2].props.map((p) => p.key)).toEqual(v.emitters[1].props.map((p) => p.key));
    expect(r.warnings).toEqual([]);
  });

  it("copyEmitter: a game source, a name that is taken, an empty target, and the refusals", () => {
    gameFiles.set("particles/vanillax/smoke.ptc", PAK_EFFECT);
    const rel = fresh();
    const r = write({
      action: "copyEmitter",
      path: rel,
      from: "Particles/VanillaX/Smoke.ptc",
      emitter: "smoke",
      at: 0,
    });
    expect(r.warnings.join(" ")).toMatch(/1 Material\/Prefab ref\(s\) point at game resources/);
    expect(viewParticle(new CstDocument(text(rel))).emitters[0].name).toBe("smoke");
    // The same emitter again: the name is taken, so it is numbered.
    const again = write({
      action: "copyEmitter",
      path: rel,
      from: "Particles/VanillaX/Smoke.ptc",
      index: 0,
    });
    expect(again.changed?.[0].path).toBe("Emitters[smoke_2]");
    // Into an effect with no emitters: the block is made.
    const empty = fresh("EffectDef {\n Version 2\n}");
    write({ action: "copyEmitter", path: empty, from: "Particles/VanillaX/Smoke.ptc", index: 0 });
    expect(text(empty)).toBe(
      'EffectDef {\n Version 2\n Emitters {\n  EmitterDef smoke {\n   BirthRate 9\n   Material "{CCCC000000000001}Particles/_Materials/Gas.emat"\n   Alpha {\n    0 1 1 0\n   }\n  }\n }\n}',
    );
    expect(fail({ action: "copyEmitter", path: rel, index: 0 }).message).toMatch(/needs from/);
    expect(
      fail({ action: "copyEmitter", path: rel, from: "Particles/none.ptc", index: 0 }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      fail({
        action: "copyEmitter",
        path: rel,
        from: "Particles/VanillaX/Smoke.ptc",
        emitter: "nope",
      }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      fail({ action: "copyEmitter", path: rel, from: fresh("Foo {\n}"), index: 0 }).message,
    ).toMatch(/not one EffectDef/);
  });

  it("copyEmitter: refuses an emitter it cannot copy faithfully", () => {
    const odd = SAMPLE.replace("   MaxNum 20", '   MaxNum 20 "a"');
    const rel = fresh();
    expect(
      fail({ action: "copyEmitter", path: rel, from: fresh(odd), emitter: "spark_core" }).message,
    ).toMatch(/mixed quoting/);
    const nested = SAMPLE.replace("    0 1 1 2\n", "    0 1 1 2\n    Deep {\n    }\n");
    expect(
      fail({ action: "copyEmitter", path: rel, from: fresh(nested), emitter: "debris" }).message,
    ).toMatch(/cannot copy/);
  });

  it("renameEmitter: changes only the name", () => {
    const rel = fresh();
    const r = write({ action: "renameEmitter", path: rel, emitter: "debris", name: "chunks" });
    expect(r.changed).toEqual([{ path: "Emitters[1].name", before: "debris", after: "chunks" }]);
    expect(text(rel)).toBe(SAMPLE.replace("EmitterDef debris", "EmitterDef chunks"));
    expect(
      fail({ action: "renameEmitter", path: rel, emitter: "chunks", name: "spark_core" }).code,
    ).toBe("DUPLICATE_ID");
    expect(
      fail({ action: "renameEmitter", path: rel, emitter: "chunks", name: "not ok" }).code,
    ).toBe("INVALID_ARGUMENT");
    const same = write({ action: "renameEmitter", path: rel, emitter: "chunks", name: "chunks" });
    expect(same.changed).toEqual([]);
    expect(same.warnings.join(" ")).toMatch(/already named/);
  });

  it("removeEmitter: takes the whole block and warns when none is left", () => {
    const rel = fresh();
    const r = write({ action: "removeEmitter", path: rel, emitter: "spark_core" });
    expect(r.changed).toEqual([
      {
        path: "Emitters[spark_core]",
        before: { name: "spark_core", props: 8, curves: ["Color", "Alpha"] },
        after: null,
      },
    ]);
    expect(text(rel)).toBe(
      SAMPLE.split("\n")
        .filter((_, i) => i < 4 || i >= 20)
        .join("\n"),
    );
    const last = write({ action: "removeEmitter", path: rel, index: 0 });
    expect(last.warnings.join(" ")).toMatch(/no emitters now/);
    expect(text(rel)).toBe("EffectDef {\n Version 2\n LightRadius 5\n Emitters {\n }\n}");
  });

  it("moveEmitter: moves to a position, and back again byte for byte", () => {
    const rel = fresh();
    const r = write({ action: "moveEmitter", path: rel, emitter: "debris", at: 0 });
    expect(r.changed).toEqual([
      { path: "Emitters[debris]", before: { index: 1 }, after: { index: 0 } },
    ]);
    expect(text(rel)).toBe(swapEmitters(SAMPLE));
    write({ action: "moveEmitter", path: rel, emitter: "debris", at: 1 });
    expect(text(rel)).toBe(SAMPLE);
    const same = write({ action: "moveEmitter", path: rel, emitter: "debris", at: 1 });
    expect(same.warnings.join(" ")).toMatch(/already at position 1/);
    expect(fail({ action: "moveEmitter", path: rel, emitter: "debris", at: 2 }).message).toMatch(
      /0 to 1/,
    );
    expect(fail({ action: "moveEmitter", path: rel, emitter: "debris" }).message).toMatch(
      /at \(the new position\)/,
    );
  });
});

describe("create", () => {
  it("is a dry run by default and writes the Particle Editor's default effect with confirm", () => {
    const rel = "Particles/new/Fresh.ptc";
    const r = ok({ action: "create", path: rel });
    expect(r.dryRun).toBe(true);
    expect(existsSync(at(rel))).toBe(false);
    const w = write({ action: "create", path: rel });
    expect(text(rel)).toBe(skeleton("Emitter_01"));
    expect(text(rel)).toBe(
      "EffectDef {\n Version 2\n Emitters {\n  EmitterDef Emitter_01 {\n  }\n }\n}",
    );
    expect(w.next).toMatch(/wb_resources register/);
    expect(rb(w)).toMatchObject({ emitters: 1, curves: 0 });
    expect(rb(w).backup).toBeUndefined();
    expect(
      unwritableReason(readFileSync(at(rel)), parseCstBytes(readFileSync(at(rel)))),
    ).toBeUndefined();
  });

  it("names the first emitter, sets its props, and refuses an existing file without overwrite", () => {
    const rel = "Particles/new/Named.ptc";
    write({ action: "create", path: rel, name: "flash", props: { BirthRate: 30, Lifetime: 0.4 } });
    expect(text(rel)).toBe(
      "EffectDef {\n Version 2\n Emitters {\n  EmitterDef flash {\n   BirthRate 30\n   Lifetime 0.4\n  }\n }\n}",
    );
    expect(fail({ action: "create", path: rel }).message).toMatch(/already exists/);
    expect(fail({ action: "create", path: rel, confirm: true }).message).toMatch(/already exists/);
    const o = write({ action: "create", path: rel, overwrite: true, name: "second" });
    expect(o.warnings.join(" ")).toMatch(/\.bak copy is kept/);
    expect(text(`${rel}.bak`)).toContain("EmitterDef flash");
    expect(text(rel)).toContain("EmitterDef second");
    expect(fail({ action: "create", path: "Particles/new/Bad.ptc", name: "1x" }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      fail({ action: "create", path: "Particles/new/Bad2.ptc", props: { Nope: 1 } }).code,
    ).toBe("INVALID_ARGUMENT");
    expect(existsSync(at("Particles/new/Bad2.ptc"))).toBe(false);
  });

  it("needs a path inside the project", () => {
    expect(fail({ action: "create" }).code).toBe("INVALID_ARGUMENT");
    expect(
      fail({ action: "create", path: join(dir, "..", "out", "x.ptc"), confirm: true }).code,
    ).toBe("NOT_IN_PROJECT");
    expect(
      runParticle(
        { action: "create", path: "Particles/a.ptc" },
        { ...config, projectPath: "" },
        { vfs },
      ),
    ).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
    });
  });
});

describe("the project guard", () => {
  it("never writes game data: it says to copy the file into the project", () => {
    const g = fail({
      action: "set",
      path: "Particles/GameOnly/Glow.ptc",
      props: { MinFPS: 1 },
      confirm: true,
    });
    expect(g.code).toBe("READ_ONLY_SOURCE");
    expect(g.message).toMatch(/game_duplicate/);
    expect(g.next).toMatch(/game_duplicate/);
    expect(existsSync(at("Particles/GameOnly/Glow.ptc"))).toBe(false);
    for (const action of ["addEmitter", "removeEmitter", "setCurve"] as const) {
      expect(
        fail({ action, path: "Particles/GameOnly/Glow.ptc", name: "x", index: 0, confirm: true })
          .code,
      ).toBe("READ_ONLY_SOURCE");
    }
  });

  it("answers PATH_NOT_FOUND for a file that is nowhere, and refuses a directory", () => {
    expect(fail({ action: "set", path: "Particles/ghost.ptc", props: { MinFPS: 1 } }).code).toBe(
      "PATH_NOT_FOUND",
    );
    mkdirSync(at("Particles/dir.ptc"), { recursive: true });
    expect(
      fail({ action: "set", path: "Particles/dir.ptc", props: { MinFPS: 1 } }).message,
    ).toMatch(/not a file/);
  });

  it("leaves a file it cannot reproduce alone", () => {
    const rel = fresh("EffectDef {\n Emitters {\n  EmitterDef a {\n }\n}");
    const r = fail({ action: "set", path: rel, props: { MinFPS: 1 }, confirm: true });
    expect(r.message).toMatch(/is left alone/);
    expect(r.message).toMatch(/does not parse cleanly/);
    const other = fresh("Foo {\n}");
    expect(fail({ action: "addEmitter", path: other, name: "a", confirm: true }).message).toMatch(
      /not a single EffectDef/,
    );
  });

  it("does not write when an edit would break the file", () => {
    const rel = fresh();
    const before = text(rel);
    // A value that cannot stand bare is refused by the writer, not written.
    const r = fail({
      action: "set",
      path: rel,
      emitter: "debris",
      props: { Wobble: "a{b" },
      allowUnknown: true,
      confirm: true,
    });
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(text(rel)).toBe(before);
  });

  it("answers an unexpected failure as HANDLER_ERROR, never a throw", () => {
    const broken: PakLike = {
      exists: () => true,
      readFile: () => {
        throw new Error("pak blew up");
      },
    };
    const r = runParticle({ action: "inspect", path: "Particles/X.ptc" }, config, { vfs: broken });
    expect(r).toMatchObject({ ok: false, code: "HANDLER_ERROR", message: "pak blew up" });
  });
});

describe("byte-level properties on the fixtures", () => {
  const edits: [string, ParticleRequest][] = [
    ["set", { action: "set", emitter: "spark_core", props: { BirthRate: 7 } }],
    [
      "setCurve",
      { action: "setCurve", emitter: "spark_core", curve: "Alpha", points: [0, 0, 1, 1] },
    ],
    ["addEmitter", { action: "addEmitter", name: "extra" }],
    ["cloneEmitter", { action: "cloneEmitter", emitter: "debris", name: "extra" }],
    ["renameEmitter", { action: "renameEmitter", emitter: "debris", name: "extra" }],
    ["removeEmitter", { action: "removeEmitter", emitter: "debris" }],
    ["moveEmitter", { action: "moveEmitter", emitter: "debris", at: 0 }],
  ];
  for (const [name, req] of edits) {
    it(`${name}: the file still parses clean, and only the edited block changes`, () => {
      const rel = fresh();
      write({ ...req, path: rel });
      const after = text(rel);
      const doc = new CstDocument(after);
      expect(doc.diagnostics).toEqual([]);
      expect(viewParticle(doc).ok).toBe(true);
      // The effect header is untouched by every emitter edit.
      expect(after.startsWith("EffectDef {\n Version 2\n LightRadius 5\n Emitters {\n")).toBe(true);
      expect(after.endsWith("\n }\n}")).toBe(true);
    });
  }
});

describe("manifest shape", () => {
  it("has the 17 actions of the spec", () => {
    expect(READ_ACTIONS).toHaveLength(8);
    expect(WRITE_ACTIONS).toHaveLength(9);
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/particle.catalog
// census:mcp:action/particle.create
// census:mcp:action/particle.curves
// census:mcp:action/particle.diff
// census:mcp:action/particle.emitter
// census:mcp:action/particle.emitters
// census:mcp:action/particle.inspect
// census:mcp:action/particle.refs
// census:mcp:action/particle.set
// census:mcp:action/particle.validate
