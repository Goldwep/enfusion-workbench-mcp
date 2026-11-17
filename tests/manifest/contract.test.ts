import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  CONTRACT_SCHEMA,
  checkUniqueTools,
  ContractError,
  loadContract,
  loadContracts,
  parseContract,
  regVKeys,
} from "../../src/manifest/contract.js";
import {
  buildDescription,
  buildRequestSchema,
  checkedDescription,
  DESCRIPTION_MAX,
  emitTypes,
  linterRows,
} from "../../src/manifest/generate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const contractsDir = resolve(root, "contracts");
const ecFile = resolve(contractsDir, "EMCP_WB_EditorControl.json");

describe("contract schema", () => {
  it("keeps the JSON schema and the zod schema on the same top-level and action keys", () => {
    const js = JSON.parse(
      readFileSync(resolve(contractsDir, "_schema/contract.schema.json"), "utf-8"),
    );
    expect(Object.keys(js.properties).sort()).toEqual(Object.keys(CONTRACT_SCHEMA.shape).sort());
    const actionZod = CONTRACT_SCHEMA.shape.actions.element.shape;
    expect(Object.keys(js.$defs.action.properties).sort()).toEqual(Object.keys(actionZod).sort());
    expect(js.$defs.action.properties.summary.maxLength).toBe(80);
    expect(js.$defs.param.properties.note.maxLength).toBe(40);
  });

  it("loads every contract under contracts/", () => {
    expect(loadContracts(contractsDir).map((c) => c.handler)).toContain("EMCP_WB_EditorControl");
  });

  it("mirrors source minLength 1 and the request contains action rule", () => {
    const js = JSON.parse(
      readFileSync(resolve(contractsDir, "_schema/contract.schema.json"), "utf-8"),
    );
    expect(js.properties.source.minLength).toBe(1);
    expect(js.properties.request.contains).toEqual({ const: "action" });
    const raw = JSON.parse(readFileSync(ecFile, "utf-8"));
    expect(() => parseContract({ ...raw, source: "" }, "t")).toThrow(ContractError);
    expect(() => parseContract({ ...raw, request: ["path"] }, "t")).toThrow(/discriminator key/);
  });

  it("refuses two contracts on one tool (one handler = one tool in Phase 3)", () => {
    const c = loadContract(ecFile);
    expect(() => checkUniqueTools([c, { ...c, handler: "EMCP_WB_Other" }])).toThrow(
      /repeated tool wb_editor/,
    );
    expect(checkUniqueTools([c])).toEqual([c]);
  });

  it("rejects a summary over 80 chars", () => {
    const raw = JSON.parse(readFileSync(ecFile, "utf-8"));
    raw.actions[0].summary = "x".repeat(81);
    expect(() => parseContract(raw, "t")).toThrow(ContractError);
  });

  it("rejects a param that is not in the handler request struct", () => {
    const raw = JSON.parse(readFileSync(ecFile, "utf-8"));
    raw.actions[0].params.push({ key: "bogus", type: "string", required: false });
    expect(() => parseContract(raw, "t")).toThrow(/bogus is not in the handler request struct/);
  });

  it("rejects 'action' as a param and duplicate action names", () => {
    const raw = JSON.parse(readFileSync(ecFile, "utf-8"));
    raw.actions[1].params.push({ key: "action", type: "string", required: true });
    raw.actions.push({ ...raw.actions[0] });
    const msg = (() => {
      try {
        parseContract(raw, "t");
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(msg).toMatch(/discriminator/);
    expect(msg).toMatch(/declared twice/);
  });
});

describe("EMCP_WB_EditorControl contract", () => {
  const c = loadContract(ecFile);
  const enforce = readFileSync(resolve(root, c.source), "utf-8");

  it("lists exactly the RegV keys of the handler's request and response structs", () => {
    expect(c.request).toEqual(regVKeys(enforce, "EMCP_WB_EditorControlRequest"));
    expect(c.response).toEqual(regVKeys(enforce, "EMCP_WB_EditorControlResponse"));
  });

  it("names every action the handler's dispatch compares against", () => {
    const handled = [...enforce.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(c.actions.map((a) => a.name).sort()).toEqual([...new Set(handled)].sort());
  });

  it("requires path for openResource, as the handler refuses an empty path", () => {
    expect(enforce).toContain("path parameter required for openResource action");
    const open = c.actions.find((a) => a.name === "openResource");
    expect(open?.params).toEqual([
      { key: "path", type: "string", required: true, note: "resource path" },
    ]);
  });
});

describe("generators on EMCP_WB_EditorControl", () => {
  const c = loadContract(ecFile);
  const schema = buildRequestSchema(c);

  it("accepts each action with its own keys", () => {
    expect(schema.parse({ action: "play", debugMode: true })).toEqual({
      action: "play",
      debugMode: true,
    });
    expect(schema.parse({ action: "openResource", path: "Worlds/a.ent" }).action).toBe(
      "openResource",
    );
    expect(schema.parse({ action: "undo" })).toEqual({ action: "undo" });
  });

  it("rejects a key another action owns, a missing required key, and an unknown action", () => {
    expect(schema.safeParse({ action: "stop", debugMode: true }).success).toBe(false);
    expect(schema.safeParse({ action: "openResource" }).success).toBe(false);
    expect(schema.safeParse({ action: "delete" }).success).toBe(false);
  });

  it("emits TS request and response types", () => {
    const ts = emitTypes(c);
    expect(ts).toContain("export type EMCPWBEditorControlRequest =");
    expect(ts).toContain('| { action: "openResource"; path: string }');
    expect(ts).toContain('| { action: "play"; debugMode?: boolean; fullScreen?: boolean }');
    expect(ts).toContain("  message?: string;");
  });

  it("emits one linter row per action with required and allowed keys", () => {
    const rows = linterRows(c);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.action === "openResource")).toMatchObject({
      required: ["action", "path"],
      allowed: ["action", "path"],
      mutating: true,
    });
    expect(rows.find((r) => r.action === "stop")?.allowed).toEqual(["action"]);
  });

  it("builds a description within 400 chars with read and mutating lines", () => {
    const d = checkedDescription(c);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.split("\n")[0]).toBe(c.purpose);
    // save is retired (review F11, DEC-099): a non-mutating, always-refused row before saveAs.
    expect(d).toContain("Read:\nsave: ");
    expect(d).toContain("\nsaveAs: ");
    expect(d).toContain("Mutating:\nplay: ");
  });

  it("throws when the description is over budget", () => {
    const big = {
      ...c,
      purpose: "p".repeat(160),
      actions: c.actions.map((a) => ({ ...a, summary: "s".repeat(80) })),
    };
    expect(buildDescription(big).length).toBeGreaterThan(DESCRIPTION_MAX);
    expect(() => checkedDescription(big)).toThrow(/budget 400/);
  });
});
