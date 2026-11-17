import { describe, it, expect, vi } from "vitest";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import {
  PREFABS_CONTRACT,
  WB_PREFABS_DESCRIPTION,
  flatInputShape,
  prepareRequest,
  registerWbPrefabs,
  runPrefabs,
} from "../../src/tools/wb-prefabs.js";
import { DESCRIPTION_MAX, buildDescription } from "../../src/manifest/generate.js";
import { WorkbenchError, type WorkbenchCallOptions } from "../../src/workbench/client.js";
import { captureTool, textOf } from "./_tool-harness.js";

// Declared fields of Bohemia's prefab handlers, as read from the pak source
// (scripts/WorkbenchGameCommon/EnfusionBlenderTools/AssetLibraryUtils.c).
// Not verified against a live Workbench.
const DECLARED = {
  GetPrefabGUID: {
    request: ["prefabPath"], // GetPrefabGUIDRequest, RegV at line 202
    response: ["status", "message", "guid"], // RegV at lines 218-220
  },
  LocateProject: {
    request: ["path"], // RegV at line 59
    response: ["status", "message", "projectName", "projectPath"], // lines 65-68, RegAll() at line 76
  },
  LocatePrefabsFromPath: {
    request: ["selectedProject", "projectPath", "selectedFolder"], // RegV at lines 120-122
    response: ["status", "message", "prefabsPaths"], // RegV at lines 138-140
  },
} as const;

type Responder = (apiFunc: string, params: Record<string, unknown>) => Record<string, unknown>;

async function run(args: Record<string, unknown>, responder: Responder) {
  const calls: { apiFunc: string; params: Record<string, unknown> }[] = [];
  const client = {
    state: { connected: true, mode: "edit", lastUpdated: 0 },
    call: vi.fn(async (apiFunc: string, params: Record<string, unknown> = {}) => {
      calls.push({ apiFunc, params });
      return responder(apiFunc, params);
    }),
  } as unknown as WorkbenchClient;
  const handler = captureTool((s) => registerWbPrefabs(s, client));
  const result = await handler(args);
  return { calls, result, text: textOf(result) };
}

describe("wb_prefabs getGuid: GetPrefabGUID contract", () => {
  const ok = { status: "OK", message: "GUID found.", guid: "0123456789ABCDEF" };

  it("sends exactly the declared request field (prefabPath), not path", async () => {
    const { calls } = await run(
      { action: "getGuid", templatePath: "C:/Addons/MyMod/Prefabs/A.et" },
      () => ok,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].apiFunc).toBe("GetPrefabGUID");
    expect(Object.keys(calls[0].params).sort()).toEqual([...DECLARED.GetPrefabGUID.request].sort());
    expect(calls[0].params.prefabPath).toBe("C:/Addons/MyMod/Prefabs/A.et");
  });

  it("reads guid from the declared response and flags it unverified", async () => {
    for (const k of Object.keys(ok)) {
      expect(DECLARED.GetPrefabGUID.response as readonly string[]).toContain(k);
    }
    const { text, result } = await run({ action: "getGuid", templatePath: "x.et" }, () => ok);
    expect(text).toContain("**GUID:** 0123456789ABCDEF");
    expect(text).toContain("Not verified live");
    expect(result.isError).not.toBe(true);
  });

  it("does not read the undeclared key GUID", async () => {
    const { text } = await run({ action: "getGuid", templatePath: "x.et" }, () => ({
      status: "OK",
      GUID: "FFFFFFFFFFFFFFFF",
    }));
    expect(text).toContain("(not found)");
    expect(text).not.toContain("FFFFFFFFFFFFFFFF");
  });

  it("treats the handler's upper-case ERROR as an error (the old '(not found)' success)", async () => {
    const { text, result } = await run({ action: "getGuid", templatePath: "x.et" }, () => ({
      status: "ERROR",
      message: "Meta file not found!",
      guid: "",
    }));
    expect(result.isError).toBe(true);
    expect(text).toContain("Meta file not found!");
  });
});

describe("wb_prefabs locate: LocateProject + LocatePrefabsFromPath contract", () => {
  const folder = "C:/Addons/MyMod/Prefabs/Weapons";
  const located = {
    status: "OK",
    message: "",
    projectName: "MyMod",
    projectPath: "C:/Addons/MyMod",
  };
  const responder: Responder = (apiFunc) =>
    apiFunc === "LocateProject"
      ? located
      : {
          status: "OK",
          message: "",
          prefabsPaths: [
            "C:/Addons/MyMod/Prefabs/Weapons/A.et",
            "C:/Addons/MyMod/Prefabs/Weapons/B.et",
          ],
        };

  it("is gated: sends nothing to either handler (DEC-040 U27, DEC-056 ruling 14)", async () => {
    const { calls, text, result } = await run({ action: "locate", searchPath: folder }, responder);
    expect(calls).toEqual([]);
    expect(result.isError).toBe(true);
    expect(text).toContain("gated");
    expect(text).toContain("LocatePrefabsFromPath");
    expect(text).toContain("nothing was sent");
  });

  it("still requires searchPath before the gate answers", async () => {
    const { calls, result } = await run({ action: "locate" }, responder);
    expect(calls).toEqual([]);
    expect(result.isError).toBe(true);
  });

  it("names only declared keys in the response it would read", () => {
    for (const k of Object.keys(located)) {
      expect(DECLARED.LocateProject.response as readonly string[]).toContain(k);
    }
    expect(DECLARED.LocatePrefabsFromPath.request).toEqual(
      expect.arrayContaining(["selectedProject", "projectPath", "selectedFolder"]),
    );
  });
});

// ── The handler actions (EMCP_WB_Prefabs, contracts/EMCP_WB_Prefabs.json) ───────────────────────

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(answer: (p: Record<string, unknown>) => Record<string, unknown> | Error): {
  client: WorkbenchClient;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const ID = "id:0x00000000000000ab";
const PREFAB = "{0123456789ABCDEF}Prefabs/Props/Crate.et";

describe("wb_prefabs contract", () => {
  it("loads, and the description the tool registers fits the 400-char budget", () => {
    expect(PREFABS_CONTRACT.tool).toBe("wb_prefabs");
    expect(WB_PREFABS_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("the contract's own description fits the budget and is the one registered", () => {
    expect(buildDescription(PREFABS_CONTRACT).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(WB_PREFABS_DESCRIPTION).toBe(buildDescription(PREFABS_CONTRACT));
  });

  it("has the nine W1 actions, with confirm on exactly the four file writes", () => {
    expect(PREFABS_CONTRACT.actions.map((a) => a.name)).toEqual([
      "getAncestor",
      "createTemplate",
      "save",
      "editState",
      "addMembers",
      "removeMembers",
      "moveToPrefab",
      "clone",
      "createChild",
    ]);
    const withConfirm = PREFABS_CONTRACT.actions
      .filter((a) => a.params.some((p) => p.key === "confirm"))
      .map((a) => a.name);
    expect(withConfirm).toEqual(["createTemplate", "save", "clone", "createChild"]);
  });

  it("gives registerTool a flat shape with every contract key, the 1.x keys and the two BI actions", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "entity",
      "path",
      "confirm",
      "member",
      "entities",
      "parent",
      "convertTransform",
      "prefab",
      "entityName",
      "templatePath",
      "addonName",
      "searchPath",
    ])
      expect(shape[k], k).toBeDefined();
    const action = shape.action as unknown as { options: string[] };
    expect(action.options).toEqual(expect.arrayContaining(["getGuid", "locate", "clone"]));
  });
});

describe("prepareRequest: request mapping (what is sent)", () => {
  it("getAncestor sends the canonical entity reference", () => {
    const p = prepareRequest({ action: "getAncestor", entity: "id:AB" });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.mutating).toBe(false);
      expect(p.params).toEqual({ action: "getAncestor", entity: ID });
    }
  });

  it("createTemplate sends confirm false by default and the cleaned path", () => {
    const p = prepareRequest({
      action: "createTemplate",
      entity: "name:Crate",
      path: "Prefabs\\My\\Crate.ET",
    });
    expect(p.ok && p.params).toEqual({
      action: "createTemplate",
      entity: "name:Crate",
      path: "Prefabs/My/Crate.ET",
      confirm: false,
    });
    const c = prepareRequest({
      action: "createTemplate",
      entity: "index:3",
      path: "Prefabs/A.et",
      confirm: true,
    });
    expect(c.ok && c.params).toMatchObject({ confirm: true });
  });

  it("save takes no entity (the prefab edit root) or one reference", () => {
    const a = prepareRequest({ action: "save" });
    expect(a.ok && a.params).toEqual({ action: "save", confirm: false });
    if (a.ok) expect(a.target).toBe("prefab edit root");
    const b = prepareRequest({ action: "save", entity: "name:Root", confirm: true });
    expect(b.ok && b.params).toEqual({
      action: "save",
      entity: "name:Root",
      confirm: true,
    });
  });

  it("editState sends only the action", () => {
    const p = prepareRequest({ action: "editState" });
    expect(p.ok && p.params).toEqual({ action: "editState" });
  });

  it("addMembers, removeMembers and moveToPrefab send no confirm and canonical references", () => {
    const add = prepareRequest({ action: "addMembers", member: "id:1", prefab: PREFAB });
    expect(add.ok && add.params).toEqual({
      action: "addMembers",
      member: "id:0x0000000000000001",
      prefab: PREFAB,
    });
    // Fix-up 2: addMembers takes a prefab, not world entities (AddPrefabMembers wants unused sources).
    expect(
      prepareRequest({ action: "addMembers", member: "name:Root", entities: ["name:A"] }).ok,
    ).toBe(false);
    const rem = prepareRequest({ action: "removeMembers", entities: ["name:A"] });
    expect(rem.ok && rem.params).toEqual({ action: "removeMembers", entities: ["name:A"] });
    const mv = prepareRequest({ action: "moveToPrefab", parent: "name:P", entities: ["name:A"] });
    expect(mv.ok && mv.params).toEqual({
      action: "moveToPrefab",
      parent: "name:P",
      entities: ["name:A"],
      convertTransform: true,
    });
    const mv2 = prepareRequest({
      action: "moveToPrefab",
      parent: "name:P",
      entities: ["name:A"],
      convertTransform: false,
    });
    expect(mv2.ok && mv2.params).toMatchObject({ convertTransform: false });
  });

  it("clone and createChild send the prefab, the new path and confirm", () => {
    for (const action of ["clone", "createChild"]) {
      const p = prepareRequest({ action, prefab: PREFAB, path: "Prefabs/New.et" });
      expect(p.ok && p.params).toEqual({
        action,
        prefab: PREFAB,
        path: "Prefabs/New.et",
        confirm: false,
      });
      if (p.ok) expect(p.target).toBe(PREFAB);
    }
  });

  it("marks reads and writes: only getAncestor and editState are reads", () => {
    for (const a of PREFABS_CONTRACT.actions) {
      const input: Record<string, unknown> = { action: a.name };
      for (const p of a.params.filter((x) => x.required)) {
        input[p.key] =
          p.key === "entities"
            ? ["name:A"]
            : p.key === "path"
              ? "A/B.et"
              : p.key === "prefab"
                ? PREFAB
                : "name:X";
      }
      const prepared = prepareRequest(input);
      expect(prepared.ok, a.name).toBe(true);
      if (prepared.ok)
        expect(prepared.mutating, a.name).toBe(!["getAncestor", "editState"].includes(a.name));
    }
  });
});

describe("prepareRequest: 1.x names are mapped", () => {
  it("createTemplate: entityName becomes entity name:<n>, templatePath becomes path", () => {
    const p = prepareRequest({
      action: "createTemplate",
      entityName: "Alpha",
      templatePath: "Prefabs/A.et",
    });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.params).toEqual({
        action: "createTemplate",
        entity: "name:Alpha",
        path: "Prefabs/A.et",
        confirm: false,
      });
      expect(p.warnings).toHaveLength(2);
    }
  });

  it("save and getAncestor map entityName", () => {
    const s = prepareRequest({ action: "save", entityName: "Root" });
    expect(s.ok && s.params).toMatchObject({ action: "save", entity: "name:Root" });
    const g = prepareRequest({ action: "getAncestor", entityName: "Root" });
    expect(g.ok && g.params).toEqual({ action: "getAncestor", entity: "name:Root" });
  });

  it("refuses addonName (no equivalent) and a 1.x name beside its replacement", () => {
    const cases = [
      { action: "createTemplate", entityName: "A", templatePath: "A.et", addonName: "MyMod" },
      { action: "createTemplate", entity: "name:A", entityName: "A", path: "A.et" },
      { action: "createTemplate", entity: "name:A", path: "A.et", templatePath: "B.et" },
    ];
    for (const c of cases) {
      const p = prepareRequest(c);
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("does not map 1.x names on the new actions: they are unknown keys there", () => {
    const p = prepareRequest({
      action: "addMembers",
      member: "name:A",
      prefab: PREFAB,
      entityName: "x",
    });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe("INVALID_ARGUMENT");
  });
});

describe("prepareRequest: refusals (nothing sent)", () => {
  const refused = (input: Record<string, unknown>, code: string) => {
    const p = prepareRequest(input);
    expect(p.ok, JSON.stringify(input)).toBe(false);
    if (!p.ok) expect(p.error.code, JSON.stringify(input)).toBe(code);
  };

  it("refuses a missing required key, an unknown key and an unknown action", () => {
    refused({ action: "createTemplate", entity: "name:A" }, "INVALID_ARGUMENT");
    refused({ action: "clone", prefab: PREFAB }, "INVALID_ARGUMENT");
    refused({ action: "editState", entity: "name:A" }, "INVALID_ARGUMENT");
    refused({ action: "removeMembers", entities: ["name:A"], confirm: true }, "INVALID_ARGUMENT");
    refused({ action: "addMembers", prefab: PREFAB }, "INVALID_ARGUMENT");
    refused({ action: "addMembers", member: "name:M" }, "INVALID_ARGUMENT");
    refused({ action: "frobnicate" }, "INVALID_ARGUMENT");
  });

  it("refuses a malformed entity reference in every reference slot", () => {
    refused({ action: "getAncestor", entity: "Crate" }, "INVALID_ARGUMENT");
    refused({ action: "getAncestor", entity: "id:zz" }, "INVALID_ARGUMENT");
    refused({ action: "getAncestor", entity: "index:-1" }, "INVALID_ARGUMENT");
    refused({ action: "getAncestor", entity: "name:" }, "INVALID_ARGUMENT");
    refused({ action: "addMembers", member: "bad", prefab: PREFAB }, "INVALID_ARGUMENT");
    refused({ action: "addMembers", member: "name:M", prefab: "nope" }, "INVALID_ARGUMENT");
    refused({ action: "moveToPrefab", parent: "bad", entities: ["name:A"] }, "INVALID_ARGUMENT");
    refused({ action: "removeMembers", entities: ["index:1x"] }, "INVALID_ARGUMENT");
  });

  it("refuses an empty entities list and one over 200", () => {
    refused({ action: "removeMembers", entities: [] }, "INVALID_ARGUMENT");
    const many = Array.from({ length: 201 }, (_, i) => `index:${i}`);
    refused({ action: "removeMembers", entities: many }, "INVALID_ARGUMENT");
    const edge = Array.from({ length: 200 }, (_, i) => `index:${i}`);
    expect(prepareRequest({ action: "removeMembers", entities: edge }).ok).toBe(true);
  });

  it("refuses an absolute or escaping new path with ABSOLUTE_PATH", () => {
    for (const path of [
      "C:/x/A.et",
      "/A.et",
      "\\\\srv\\share\\A.et",
      "$profile:A.et",
      "a/../b.et",
      "file:///A.et",
    ]) {
      refused({ action: "createTemplate", entity: "name:A", path }, "ABSOLUTE_PATH");
      refused({ action: "clone", prefab: PREFAB, path }, "ABSOLUTE_PATH");
    }
  });

  it("refuses a new path that is empty or not a .et file", () => {
    refused(
      { action: "createTemplate", entity: "name:A", path: "Prefabs/A.xob" },
      "INVALID_ARGUMENT",
    );
    refused({ action: "createChild", prefab: PREFAB, path: "Prefabs/" }, "INVALID_ARGUMENT");
    refused({ action: "createChild", prefab: PREFAB, path: "   " }, "INVALID_ARGUMENT");
  });

  it("refuses a source prefab that is not {GUID}path.et", () => {
    for (const prefab of [
      "Prefabs/Crate.et",
      "{123}Prefabs/Crate.et",
      "{0123456789ABCDEF}Prefabs/Crate.xob",
      "{0123456789ABCDEF}",
    ])
      refused({ action: "clone", prefab, path: "A.et" }, "INVALID_ARGUMENT");
    refused(
      { action: "clone", prefab: "{0123456789ABCDEF}../Crate.et", path: "A.et" },
      "ABSOLUTE_PATH",
    );
  });

  it("sends nothing to Workbench on a refusal", async () => {
    const { client, sent } = fakeClient(() => ok());
    const res = await runPrefabs(client, { action: "clone", prefab: "nope", path: "A.et" });
    expect(res.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("names no sandbox and no project anywhere in the request it builds", () => {
    const p = prepareRequest({ action: "createTemplate", entity: "name:A", path: "A.et" });
    expect(JSON.stringify(p)).not.toMatch(/sandbox|EMCP2/i);
  });
});

describe("runPrefabs: response mapping", () => {
  it("getAncestor reads with access read and answers the ancestor", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "getAncestor", ancestorPath: PREFAB, message: "ancestor prefab found" }),
    );
    const res = await runPrefabs(client, { action: "getAncestor", entity: "name:Crate" });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Prefabs");
    expect(sent[0].options.access).toBe("read");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toBeNull();
      expect(res.target).toBe("name:Crate");
      expect(res.readback).toMatchObject({ ancestor: PREFAB, isInstance: true });
    }
  });

  it("getAncestor of a non-instance answers an empty ancestor", async () => {
    const { client } = fakeClient(() =>
      ok({ ancestorPath: "", message: "the entity has no ancestor (not a prefab instance)" }),
    );
    const res = await runPrefabs(client, { action: "getAncestor", entity: "name:Crate" });
    expect(res.ok && res.readback).toMatchObject({ ancestor: "", isInstance: false });
  });

  it("editState answers the root, its prefab and the count; bools arrive as 1/0", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        prefabEdit: 1,
        rootId: ID,
        resourceName: PREFAB,
        memberCount: 3,
        message: "prefab edit mode",
      }),
    );
    const res = await runPrefabs(client, { action: "editState" });
    expect(sent[0].options.access).toBe("read");
    expect(res.ok && res.readback).toMatchObject({
      prefabEdit: true,
      rootId: ID,
      prefab: PREFAB,
      memberCount: 3,
    });
    const off = fakeClient(() => ok({ prefabEdit: 0, memberCount: 0 }));
    const r2 = await runPrefabs(off.client, { action: "editState" });
    expect(r2.ok && r2.readback).toMatchObject({ prefabEdit: false, rootId: "", memberCount: 0 });
  });

  it("a file write without confirm is a dry run: sent as mutate, changed null, a next that says confirm", async () => {
    for (const input of [
      { action: "createTemplate", entity: "name:A", path: "Prefabs/A.et" },
      { action: "clone", prefab: PREFAB, path: "Prefabs/A.et" },
      { action: "createChild", prefab: PREFAB, path: "Prefabs/A.et" },
      { action: "save" },
    ]) {
      const { client, sent } = fakeClient(() =>
        ok({ dryRun: 1, savedPath: "Prefabs/A.et", message: "dry run: nothing was written" }),
      );
      const res = await runPrefabs(client, input);
      expect(sent[0].options.access, input.action).toBe("mutate");
      expect(sent[0].params.confirm, input.action).toBe(false);
      expect(res.ok, input.action).toBe(true);
      if (res.ok) {
        expect(res.changed).toBeNull();
        expect(res.readback).toMatchObject({ dryRun: true, file: "Prefabs/A.et" });
        expect(res.next).toMatch(/confirm: true/);
      }
    }
  });

  it("a confirmed createTemplate, clone or createChild answers changed and the resource name", async () => {
    for (const action of ["createTemplate", "clone", "createChild"]) {
      const input =
        action === "createTemplate"
          ? { action, entity: "name:A", path: "Prefabs/A.et", confirm: true }
          : { action, prefab: PREFAB, path: "Prefabs/A.et", confirm: true };
      const { client, sent } = fakeClient(() =>
        ok({
          dryRun: 0,
          savedPath: "Prefabs/A.et",
          resourceName: "{AAAAAAAAAAAAAAAA}Prefabs/A.et",
        }),
      );
      const res = await runPrefabs(client, input);
      expect(sent[0].params.confirm).toBe(true);
      expect(res.ok, action).toBe(true);
      if (res.ok) {
        expect(res.changed).toEqual([{ path: "Prefabs/A.et", before: null, after: "written" }]);
        expect(res.readback).toMatchObject({
          file: "Prefabs/A.et",
          resourceName: "{AAAAAAAAAAAAAAAA}Prefabs/A.et",
        });
        expect(res.warnings).toEqual([]);
      }
    }
  });

  it("warns when the written file has no resource name yet", async () => {
    const { client } = fakeClient(() => ok({ dryRun: 0, savedPath: "Prefabs/A.et" }));
    const res = await runPrefabs(client, {
      action: "clone",
      prefab: PREFAB,
      path: "Prefabs/A.et",
      confirm: true,
    });
    expect(res.ok && res.warnings.join(" ")).toMatch(/resource name/);
  });

  it("a confirmed save answers changed saved, with the 1.x mapping noted in warnings", async () => {
    const { client, sent } = fakeClient(() => ok({ dryRun: 0, savedPath: "Prefabs/Root.et" }));
    const res = await runPrefabs(client, { action: "save", entityName: "Root", confirm: true });
    expect(sent[0].params).toMatchObject({ entity: "name:Root", confirm: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: "Prefabs/Root.et", before: null, after: "saved" }]);
      expect(res.readback).not.toHaveProperty("resourceName");
      expect(res.warnings.join(" ")).toMatch(/entityName/);
    }
  });

  it("addMembers lists the prefab added and the undo step", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ added: [PREFAB], undoName: "EMCP wb_prefabs addMembers" }),
    );
    const res = await runPrefabs(client, {
      action: "addMembers",
      member: "name:Root",
      prefab: PREFAB,
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).not.toHaveProperty("confirm");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.target).toBe("name:Root");
      expect(res.changed).toEqual([{ path: PREFAB, before: null, after: "child of name:Root" }]);
      expect(res.readback).toMatchObject({ count: 1, undoName: "EMCP wb_prefabs addMembers" });
      expect(res.next).toMatch(/wb_prefabs save/);
    }
  });

  it("removeMembers and moveToPrefab map removed and moved", async () => {
    const rem = fakeClient(() => ok({ removed: [ID], undoName: "u" }));
    const r1 = await runPrefabs(rem.client, { action: "removeMembers", entities: [ID] });
    expect(r1.ok && r1.changed).toEqual([{ path: ID, before: "member", after: null }]);
    const mv = fakeClient(() => ok({ moved: [ID], undoName: "u" }));
    const r2 = await runPrefabs(mv.client, {
      action: "moveToPrefab",
      parent: "name:P",
      entities: [ID],
    });
    expect(mv.sent[0].params).toMatchObject({ parent: "name:P", convertTransform: true });
    expect(r2.ok && r2.changed).toEqual([
      { path: ID, before: "world", after: "in prefab of name:P" },
    ]);
  });
});

describe("runPrefabs: failures", () => {
  it("surfaces a handler refusal with its code and next", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "WRONG_MODE",
      next: "open the prefab with Edit Prefab in the Resource Browser",
      message: "WRONG_MODE: the World Editor is not in prefab edit mode | next: open the prefab",
    }));
    const res = await runPrefabs(client, {
      action: "removeMembers",
      entities: ["name:A"],
    });
    expect(res).toMatchObject({
      ok: false,
      code: "WRONG_MODE",
      next: "open the prefab with Edit Prefab in the Resource Browser",
    });
  });

  it("keeps ENTITY_NOT_FOUND, NOT_IN_PROJECT and ENGINE_FALSE codes; a bare error is HANDLER_ERROR", async () => {
    for (const code of ["ENTITY_NOT_FOUND", "NOT_IN_PROJECT", "ENGINE_FALSE"]) {
      const { client } = fakeClient(() => ({
        status: code === "ENGINE_FALSE" ? "error" : "refused",
        code,
        message: "m",
        next: "",
      }));
      const res = await runPrefabs(client, { action: "getAncestor", entity: "name:A" });
      expect(res).toMatchObject({ ok: false, code, message: "m" });
      if (!res.ok) expect(res.next.length).toBeGreaterThan(0);
    }
    const { client } = fakeClient(() => ({ status: "error" }));
    const res = await runPrefabs(client, { action: "editState" });
    expect(res).toMatchObject({ ok: false, code: "HANDLER_ERROR" });
  });

  it("maps WorkbenchError LOST, MODAL_OPEN and WEDGED to errors with a next", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"]) {
      const { client } = fakeClient(() => new WorkbenchError(`down: ${code}`, code as never));
      const res = await runPrefabs(client, { action: "editState" });
      expect(res).toMatchObject({ ok: false, code });
      if (!res.ok) expect(res.next.length).toBeGreaterThan(0);
    }
  });
});

describe("wb_prefabs registered tool", () => {
  it("answers a handler action as JSON and marks an error as isError", async () => {
    const good = await run({ action: "editState" }, () => ({
      status: "ok",
      code: "",
      prefabEdit: 0,
    }));
    expect(good.result.isError).toBe(false);
    expect(JSON.parse(good.text)).toMatchObject({ ok: true, action: "editState" });
    const bad = await run({ action: "clone", prefab: "x", path: "A.et" }, () => ({}));
    expect(bad.calls).toEqual([]);
    expect(bad.result.isError).toBe(true);
    expect(JSON.parse(bad.text)).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("maps 1.x createTemplate (entityName, templatePath) onto the handler keys", async () => {
    const { calls } = await run(
      { action: "createTemplate", entityName: "Alpha", templatePath: "Prefabs/A.et" },
      () => ({ status: "ok", dryRun: 1, savedPath: "Prefabs/A.et" }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].apiFunc).toBe("EMCP_WB_Prefabs");
    expect(calls[0].params).toEqual({
      action: "createTemplate",
      entity: "name:Alpha",
      path: "Prefabs/A.et",
      confirm: false,
    });
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_prefabs.addMembers
// census:mcp:action/wb_prefabs.clone
// census:mcp:action/wb_prefabs.createChild
// census:mcp:action/wb_prefabs.createTemplate
// census:mcp:action/wb_prefabs.editState
// census:mcp:action/wb_prefabs.getAncestor
// census:mcp:action/wb_prefabs.moveToPrefab
// census:mcp:action/wb_prefabs.removeMembers
// census:mcp:action/wb_prefabs.save
