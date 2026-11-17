import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  ROW_FIELD_ORDER,
  observationHeaderSchema,
  observationSchema,
  probeLineSchema,
  rowSchema,
  statePatchSchema,
} from "../../src/census/schemas.js";
import { DISPOSITION_KINDS, KINDS, ORACLES, RISKS, TIERS } from "../../src/census/vocab.js";
import { GENERATOR } from "../../scripts/census/enumerators/e01-recon-import.js";
import { REAL_CENSUS } from "./helpers.js";

type Facts = Map<string, string>;

/** Collects `<path> enum` and `<path> required` facts from a JSON schema. */
function jsonFacts(node: Record<string, unknown>, path: string, out: Facts): Facts {
  if (Array.isArray(node.enum))
    out.set(`${path} enum`, JSON.stringify([...node.enum].map(String).sort()));
  if (node.const !== undefined) out.set(`${path} enum`, JSON.stringify([String(node.const)]));
  if (Array.isArray(node.anyOf)) {
    for (const alt of node.anyOf as Record<string, unknown>[])
      if (alt.type !== "null") jsonFacts(alt, path, out);
  }
  if (node.type === "object" && node.properties) {
    out.set(`${path} required`, JSON.stringify([...((node.required as string[]) ?? [])].sort()));
    for (const [k, v] of Object.entries(
      node.properties as Record<string, Record<string, unknown>>,
    )) {
      jsonFacts(v, `${path}.${k}`, out);
    }
  }
  if (node.type === "array" && node.items)
    jsonFacts(node.items as Record<string, unknown>, `${path}[]`, out);
  return out;
}

/** Collects the same facts from a zod schema, walked independently of the generator. */
function zodFacts(t: z.ZodTypeAny, path: string, out: Facts): Facts {
  const d = t._def as Record<string, unknown> & { typeName: string };
  switch (d.typeName) {
    case "ZodOptional":
    case "ZodNullable":
      return zodFacts(d.innerType as z.ZodTypeAny, path, out);
    case "ZodEnum":
      out.set(`${path} enum`, JSON.stringify([...(d.values as string[])].sort()));
      return out;
    case "ZodLiteral":
      out.set(`${path} enum`, JSON.stringify([String(d.value)]));
      return out;
    case "ZodUnion": {
      const opts = d.options as z.ZodTypeAny[];
      out.set(`${path} enum`, JSON.stringify(opts.map((o) => String(o._def.value)).sort()));
      return out;
    }
    case "ZodArray":
      return zodFacts(d.type as z.ZodTypeAny, `${path}[]`, out);
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, z.ZodTypeAny>)();
      out.set(
        `${path} required`,
        JSON.stringify(
          Object.keys(shape)
            .filter((k) => !shape[k].isOptional())
            .sort(),
        ),
      );
      for (const [k, v] of Object.entries(shape)) zodFacts(v, `${path}.${k}`, out);
      return out;
    }
    default:
      return out;
  }
}

function schemaFile(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REAL_CENSUS, "schema", name), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("schema parity", () => {
  const cases: [string, z.ZodTypeAny, string?][] = [
    ["row.schema.json", rowSchema],
    ["observation.schema.json", observationSchema],
    ["observation.schema.json", observationHeaderSchema, "header"],
    ["state-patch.schema.json", statePatchSchema],
    ["probe.schema.json", probeLineSchema],
  ];
  for (const [file, schema, def] of cases) {
    it(`keeps ${file}${def ? ` $defs.${def}` : ""} enums and required lists equal to the zod schema`, () => {
      const doc = schemaFile(file);
      const node = def
        ? ((doc.$defs as Record<string, Record<string, unknown>>)[def] as Record<string, unknown>)
        : doc;
      const fromJson = jsonFacts(node, "$", new Map());
      const fromZod = zodFacts(schema, "$", new Map());
      expect(Object.fromEntries([...fromJson].sort())).toEqual(
        Object.fromEntries([...fromZod].sort()),
      );
      expect(fromJson.size).toBeGreaterThanOrEqual(3);
    });
  }

  it("forbids additional properties in observations", () => {
    expect(schemaFile("observation.schema.json").additionalProperties).toBe(false);
  });

  it("lists the same row fields as the serialisation order", () => {
    const props = Object.keys(schemaFile("row.schema.json").properties as object).sort();
    expect([...ROW_FIELD_ORDER].sort()).toEqual(props);
    expect(ROW_FIELD_ORDER[0]).toBe("id");
  });
});

describe("policy and universes agree with the vocabularies", () => {
  const policy = JSON.parse(readFileSync(join(REAL_CENSUS, "policy.json"), "utf-8"));
  const universes = JSON.parse(readFileSync(join(REAL_CENSUS, "universes.json"), "utf-8"));

  it("gives every kind a target tier in policy.json", () => {
    expect(Object.keys(policy.target_tier_by_kind).sort()).toEqual([...KINDS].sort());
  });

  it("uses the plan's disposition list, risk classes, tiers and oracles", () => {
    expect([...policy.dispositions.terminal].sort()).toEqual([...DISPOSITION_KINDS].sort());
    expect(policy.risk_classes).toEqual([...RISKS]);
    expect(policy.tiers).toEqual([...TIERS]);
    expect(ORACLES).toContain(policy.weak_oracle);
  });

  it("declares one universe per kind, each counted by a non-provisional enumerator", () => {
    for (const k of KINDS) {
      const u = universes.universes.filter((x: { id: string }) => x.id === `kind:${k}`);
      expect(u, k).toHaveLength(1);
      const real = u[0].enumerators.filter((e: string) => !universes.enumerators[e].provisional);
      expect(real.length, k).toBeGreaterThan(0);
      for (const e of u[0].enumerators)
        expect(universes.enumerators[e].kinds, `${e} ${k}`).toContain(k);
    }
  });

  it("registers the E01 importer as the E01 generator", () => {
    expect(universes.enumerators.E01.generator).toBe(GENERATOR);
    expect(universes.enumerators.E01.provisional).toBe(true);
    expect(universes.enumerators.E01.confidence_max).toBe("low");
  });

  it("declares the knowledge shards of main ruling 3", () => {
    expect(universes.shard_by_kind).toEqual({
      attribute: "attribute",
      "diag-menu": "diag",
      "diag-option": "diag",
      property: "schema",
      "schema-class": "schema",
      "schema-key": "schema",
    });
  });
});
