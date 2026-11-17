/**
 * The W6 world-tools handler (EMCP_WB_WorldTools.c) checked over its Enforce text offline
 * (phase5-w6-spec.md section 2.2, DEC-069 OD-1): the contract matches the structs and the dispatch,
 * every action sits behind the shared world check and the play-mode check, every mutating action
 * checks the project first and runs as one entity action with an undo name and no confirm
 * (DEC-061 OD-3), the engine calls are the spec's ports of the vanilla plugins, resetFlags never
 * defaults to the whole world (OD-6), and no file, dialog, progress bar, Sleep or debug shape is
 * reached. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_WorldTools.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_WorldTools.json"));

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static \\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const classEnd = s.slice(at).search(/\r?\n}\r?\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return code(s.slice(at, ends.length ? Math.min(...ends) : undefined));
}

/** Index of each text in body; all present and in the given order. */
function inOrder(body: string, texts: string[], label: string): void {
  const at = texts.map((t) => body.indexOf(t));
  texts.forEach((t, i) => expect(at[i], `${label}: ${t}`).toBeGreaterThanOrEqual(0));
  expect(
    [...at].sort((a, b) => a - b),
    label,
  ).toEqual(at);
}

const c = code(src);
const READS = ["exportObjects", "floaters", "stats"];
const HANDLER_MUTATING = ["importObjects", "snapToTerrain", "resetFlags", "replaceEntities"];
const ACTIONS = [...READS, "goToCoords", ...HANDLER_MUTATING];
/** Action name to the method its branch calls. */
const METHOD: Record<string, string> = {
  exportObjects: "ExportObjects",
  floaters: "Floaters",
  stats: "Stats",
  goToCoords: "GoToCoords",
  importObjects: "ImportObjects",
  snapToTerrain: "SnapToTerrain",
  resetFlags: "ResetFlags",
  replaceEntities: "ReplaceEntities",
};
const UNDO: Record<string, string> = {
  importObjects: "UNDO_IMPORT",
  snapToTerrain: "UNDO_SNAP",
  resetFlags: "UNDO_FLAGS",
  replaceEntities: "UNDO_REPLACE",
};

describe("EMCP_WB_WorldTools structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_WorldToolsRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_WorldToolsResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 8 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS)
      expect(c, a).toMatch(new RegExp(`req\\.action == "${a}"\\)\\s*${METHOD[a]}\\(req, resp\\);`));
  });

  it("reads are not project-only; the mutating actions are, and none takes confirm (DEC-061 OD-3)", () => {
    for (const a of contract.actions) {
      const mutating = HANDLER_MUTATING.includes(a.name) || a.name === "goToCoords";
      expect(a.mutating, a.name).toBe(mutating);
      expect(a.projectOnly, a.name).toBe(mutating);
      expect(
        a.params.map((p) => p.key),
        a.name,
      ).not.toContain("confirm");
    }
    expect(contract.request).not.toContain("confirm");
  });

  it("every mutating handler action answers undoName; the reads never write it", () => {
    for (const a of HANDLER_MUTATING)
      expect(
        contract.actions.find((x) => x.name === a)!.response.map((r) => r.key),
        a,
      ).toContain("undoName");
    for (const a of READS)
      expect(
        contract.actions.find((x) => x.name === a)!.response.map((r) => r.key),
        a,
      ).not.toContain("undoName");
  });

  it("the paged reads answer total and nextCursor and take cursor (spec paging column)", () => {
    for (const a of ["exportObjects", "stats"]) {
      const act = contract.actions.find((x) => x.name === a)!;
      expect(act.paging, a).toBe(true);
      expect(
        act.params.map((p) => p.key),
        a,
      ).toEqual(expect.arrayContaining(["cursor", "limit"]));
      expect(
        act.response.map((r) => r.key),
        a,
      ).toEqual(expect.arrayContaining(["total", "nextCursor"]));
    }
    const pageBody = method(src, "PageBounds");
    inOrder(
      pageBody,
      ["countText.ToInt() != total", "code = STALE_CURSOR;", "PAGE_MAX"],
      "PageBounds",
    );
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|IEntity|BaseContainer|BaseWorld|WorldEditorAPI|WorldEditor|IEntityComponentSource)\b/,
    );
    expect(c).not.toMatch(/out\s+[\w<>]+\s+\w+\s*=\s*null/);
  });

  it("float values never travel through a request field (W1 lesson: floats as text)", () => {
    const req = /class EMCP_WB_WorldToolsRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    for (const k of ["radius", "minOffset", "maxOffset"]) {
      expect(req).toMatch(new RegExp(`string ${k};`));
      expect(method(src, "Floaters")).toContain(`FloatOr(req.${k},`);
    }
    expect(method(src, "FloatOr")).toContain("EMCP_WB_Common.ParseFloat(text, parsed)");
  });

  it("no identifier is a name the 1.9.0.37 compiler refused", () => {
    expect(c).not.toMatch(/\bWait\b/);
    expect(c).not.toMatch(/\bvanilla\b/);
  });
});

describe("no banned call", () => {
  it("no FileIO, dialog, progress bar, Sleep, debug shape, RunCmd, RunCommandline, Configure or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FileIO",
      "FindFiles",
      "ParseHandle",
      "BeginParse",
      "Workbench.Dialog",
      "ScriptDialog",
      "WBProgressDialog",
      "Sleep(",
      "Shape.Create",
      "RunCmd",
      "RunCommandline",
      "RunProcess",
      "Configure(",
      "GetAbsolutePath",
      "SetOpenedResource",
      "OpenResource",
      "ClearEntitySelection",
      "AddToEntitySelection",
      "EMCP2_sandbox",
      "_throwaway",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });

  it("no plugin is run: the ports never call a vanilla plugin or tool class", () => {
    for (const cls of [
      "SCR_ObjectImportPlugin",
      "SCR_FloatersFinderPlugin",
      "SCR_WorldEntitiesStatisticsPlugin",
      "SCR_SnapAndOrientToTerrainPlugin",
      "SCR_EntityFlagsManagerPlugin",
      "SCR_EntityReplacerTool",
      "GetPlugin",
      ".Run(",
    ])
      expect(c, cls).not.toContain(cls);
  });
});

describe("guards", () => {
  it("Api: the module, then its API, then the shared world check, then play mode, in that order", () => {
    const api = method(src, "Api");
    inOrder(
      api,
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "api.IsGameMode()",
        "WRONG_MODE",
      ],
      "Api",
    );
    expect(api).toContain("GetModule opens a closed World Editor");
    inOrder(method(src, "EditApi"), ["EMCP_WB_Guard.IsProjectFound()", "Api(resp)"], "EditApi");
  });

  it("every read goes through Api, never EditApi, before its first World Editor call", () => {
    for (const a of READS) {
      const body = method(src, METHOD[a]);
      const guard = body.indexOf("Api(resp)");
      expect(guard, a).toBeGreaterThanOrEqual(0);
      expect(body, a).not.toContain("EditApi(resp)");
      expect(guard, a).toBeLessThan(body.search(/\bapi\./));
    }
  });

  it("every mutating action checks the project first and opens one entity action with its undo name", () => {
    for (const a of HANDLER_MUTATING) {
      const body = method(src, METHOD[a]);
      const guard = body.indexOf("EditApi(resp)");
      expect(guard, a).toBeGreaterThanOrEqual(0);
      expect(guard, a).toBeLessThan(body.search(/\bapi\./));
      inOrder(
        body,
        [
          `resp.undoName = ${UNDO[a]};`,
          `BeginEdit(api, ${UNDO[a]}, resp)`,
          "api.EndEntityAction();",
        ],
        a,
      );
      expect(body.split("BeginEdit(").length - 1, a).toBe(1);
      expect(body.split("api.EndEntityAction()").length - 1, a).toBe(1);
      expect(body, a).not.toContain("req.confirm");
    }
    expect(method(src, "BeginEdit")).toMatch(
      /if \(api\.BeginEntityAction\(pointName\)\)\s*return true;/,
    );
  });

  it("floaters and snapToTerrain refuse a prefab being edited (they need terrain)", () => {
    for (const m of ["Floaters", "SnapToTerrain"])
      inOrder(method(src, m), ["Api(resp)", "InPrefabEdit()", "WRONG_MODE"], m);
    expect(method(src, "InPrefabEdit")).toContain("worldEditor.IsPrefabEditMode()");
  });

  it("every write sits between BeginEdit and EndEntityAction", () => {
    for (const a of HANDLER_MUTATING) {
      const body = method(src, METHOD[a]);
      const begin = body.indexOf("BeginEdit(");
      const end = body.indexOf("api.EndEntityAction()");
      for (const m of body.matchAll(
        /api\.(?:CreateEntity|SetVariableValue|ClearVariableValue|ParentEntity|DeleteEntities|RenameEntity)\(/g,
      )) {
        expect(m.index!, `${a}: ${m[0]}`).toBeGreaterThan(begin);
        expect(m.index!, `${a}: ${m[0]}`).toBeLessThan(end);
      }
    }
  });
});

describe("the ports (engine calls of the spec's action table)", () => {
  it("exportObjects inverts the import convention: z, quaternion z and w negated", () => {
    const body = method(src, "ExportRow");
    inOrder(
      body,
      [
        "ent.GetWorldTransform(mat)",
        "mat[0].Length()",
        "mat[0].Normalized()",
        "Math3D.MatrixToQuat(rot, quat)",
        "float csvZ = -pos[2];",
        "float csvQz = -quat[2];",
        "float csvQw = -quat[3];",
      ],
      "ExportRow",
    );
    expect(method(src, "PrefabOf")).toContain("src.GetAncestor()");
    expect(method(src, "ExportObjects")).toContain(
      "EMCP_WB_LayersUtil.LayerIdOf(api, subScene, req.layer)",
    );
  });

  it("importObjects follows SCR_ObjectImportPlugin.ImportData, caps rows and reads no file", () => {
    const body = method(src, "ImportObjects");
    inOrder(
      body,
      [
        "EditApi(resp)",
        "req.rows.Count() > MAX_ROWS",
        "ParseImportRow(",
        "KnownPrefab(parsed.m_Prefab, prefabWhy)",
        "BeginEdit(api, UNDO_IMPORT, resp)",
        "pos[2] = -pos[2];",
        "api.GetTerrainSurfaceY(pos[0], pos[2])",
        "quat[2] = -item.m_Qz;",
        "quat[3] = -item.m_Qw;",
        "Math3D.QuatNormalize(quat)",
        "Math3D.QuatToAngles(quat)",
        "angles[0] = angles[1];",
        "angles[1] = yaw;",
        'api.CreateEntity(item.m_Prefab, "", layerId, null, pos, angles)',
        'api.SetVariableValue(created, null, "scale", item.m_Scale.ToString())',
        "api.EndEntityAction();",
      ],
      "ImportObjects",
    );
    expect(body).toContain("the handler reads no file");
    expect(c).toMatch(/static const int MAX_ROWS = 200;/);
  });

  it("prefabs resolve by GUID through Workbench.GetResourceName, never GetAbsolutePath", () => {
    inOrder(
      method(src, "KnownPrefab"),
      [
        'given.Get(17) != "}"',
        "HEX_DIGITS.IndexOf(given.Get(i))",
        "Workbench.GetResourceName(braced)",
        "knownText == braced",
        "known.GetPath()",
        "!IsPrefabPath(typedPath)",
        'is not a prefab (.et)"',
      ],
      "KnownPrefab",
    );
    expect(method(src, "IsPrefabPath")).toContain('lower.EndsWith(".et")');
  });

  it("floaters owns its query callback and stays read only", () => {
    const body = method(src, "Floaters");
    inOrder(
      body,
      [
        "Targets(api, req.entities, candidates, resp.missing, code, why)",
        "world.GetCurrentCamera(cameraMat)",
        "new EMCP_WB_WorldToolsQuery(MAX_QUERY)",
        "world.QueryEntitiesBySphere(cameraMat[3], radiusValue, collector.AddEntity, null, EQueryEntitiesFlags.ALL)",
        "api.EntityToSource(",
        "world.IsOcean()",
        "world.GetOceanBaseHeight()",
        "api.TryGetTerrainSurfaceY(origin[0], origin[2], terrainY)",
        "ent.GetWorldBounds(mins, maxs)",
      ],
      "Floaters",
    );
    expect(body).not.toMatch(/api\.(?:SetVariableValue|CreateEntity|BeginEntityAction)/);
    expect(src).toMatch(/class EMCP_WB_WorldToolsQuery\s*\{[\s\S]*?bool AddEntity\(IEntity e\)/);
  });

  it("stats writes no file: counts, layers and a grid come back as data", () => {
    const body = method(src, "Stats");
    inOrder(
      body,
      [
        "req.gridSize > MAX_GRID",
        "Api(resp)",
        "worldEditor.GetTerrainBounds(terrainMin, terrainMax)",
        "api.GetEditorEntityCount()",
        "api.GetEditorEntity(i)",
        "PrefabOf(src)",
        "api.GetSubsceneLayerPath(sub, layerId)",
        "ent.GetWorldTransform(mat)",
        "keys.Sort()",
        "PageBounds(req.cursor, req.limit, total",
        "resp.grid.Insert(line)",
      ],
      "Stats",
    );
    expect(c).toMatch(/static const int MAX_GRID = 64;/);
  });

  it("snapToTerrain is the plugin's body: SnapAndOrientToTerrain, parent space, swapped angles, RELATIVE_Y y 0", () => {
    inOrder(
      method(src, "SnapToTerrain"),
      [
        "EditApi(resp)",
        "BeginEdit(api, UNDO_SNAP, resp)",
        "ent.GetWorldTransform(mat)",
        "SCR_TerrainHelper.SnapAndOrientToTerrain(mat, world)",
        "Math3D.MatrixInvMultiply4(parentMat, mat, localMat)",
        "Math3D.MatrixToAngles(rot)",
        'angles[1].ToString() + " " + angles[0].ToString() + " " + angles[2].ToString()',
        "pos[1] = 0;",
        'api.SetVariableValue(src, null, "angles", anglesText)',
        'api.SetVariableValue(src, null, "coords", EMCP_WB_Common.VectorToString(pos))',
        "api.EndEntityAction();",
      ],
      "SnapToTerrain",
    );
  });

  it("resetFlags: never the whole world by default (OD-6); clear when equal to the prefab, else set", () => {
    const body = method(src, "ResetFlags");
    inOrder(
      body,
      [
        "hasRefs && req.allWorld",
        "anyCategory && req.allWorld",
        "EditApi(resp)",
        "if (req.allWorld)",
        "api.GetEditorEntityCount()",
        "Targets(api, req.entities, named, resp.missing, code, why)",
        "the whole world is never the default",
        "SCR_BaseContainerTools.GetTopMostAncestor(src)",
        "FlagsOf(ancestorCont)",
        "edit.m_Clear = newFlags == prefabFlags;",
        "api.TryGetTerrainSurfaceY(coords[0], coords[2], terrainY)",
        "BeginEdit(api, UNDO_FLAGS, resp)",
        "api.ClearVariableValue(item.m_Src, null, FLAGS_KEY)",
        "api.SetVariableValue(item.m_Src, null, FLAGS_KEY, item.m_NewFlags.ToString())",
        "api.EndEntityAction();",
      ],
      "ResetFlags",
    );
    // The four category bases of the vanilla plugin, by GUID.
    for (const guid of [
      "{B94DDC61F0B7F9D7}",
      "{388AE316D09D0680}",
      "{D7163D1B571F4C0C}",
      "{A43A100E3C377DB2}",
    ])
      expect(c).toContain(guid);
    inOrder(
      method(src, "AddDescendants"),
      ["src.GetNumChildren()", "src.GetChild(i)", "ToEntitySource()"],
      "AddDescendants",
    );
  });

  it("resetFlags names every EntityFlags value of the spec and defaults to the plugin's ten", () => {
    const masks = method(src, "FlagMask");
    for (const f of [
      "VISIBLE",
      "TRACEABLE",
      "NO_LINK",
      "FEATURE",
      "SET_RENDERED",
      "STREAMABLE",
      "ACTIVE",
      "STATIC",
      "USER1",
      "USER2",
      "USER3",
      "USER4",
      "USER5",
      "NO_TREE",
      "RELATIVE_Y",
      "EDITOR_ONLY",
      "DISABLED",
      "PROXY",
      "UPDATE_LINK",
    ])
      expect(masks, f).toContain(`return EntityFlags.${f};`);
    expect(method(src, "DefaultFlagMask").match(/EntityFlags\.\w+/g)).toHaveLength(10);
  });

  it("replaceEntities checks every pair first, re-parents children to the new entity, deletes once", () => {
    const body = method(src, "ReplaceEntities");
    inOrder(
      body,
      [
        "EditApi(resp)",
        "req.pairs.Count() > MAX_ROWS",
        'pairText.LastIndexOf("=")',
        "KnownPrefab(prefabText, prefabWhy)",
        "resolver.Resolve(entityRef, resolved)",
        "IsAncestorOf(olds.Get(a), olds.Get(b))",
        "BeginEdit(api, UNDO_REPLACE, resp)",
        "ent.GetWorldTransform(mat)",
        "Math3D.MatrixInvMultiply4(parentMat, mat, localMat)",
        'api.CreateEntity(item.m_Prefab, "", src.GetLayerID(), parentSrc, coords, angles)',
        "createdEnt.GetFlags() & relMask",
        "if (req.keepChildren)",
        "src.GetNumChildren()",
        "src.GetChild(k)",
        "api.ParentEntity(created, kids.Get(r), true)",
        "api.DeleteEntities(toDelete)",
        "api.RenameEntity(done.m_New, done.m_Name)",
        "api.EndEntityAction();",
      ],
      "ReplaceEntities",
    );
    expect(body.split("api.DeleteEntities(").length - 1).toBe(1);
    expect(body).not.toContain("api.ParentEntity(src,");
  });

  it("goToCoords is the TS tool's: the handler changes nothing", () => {
    const body = method(src, "GoToCoords");
    expect(body).toContain("served by the wb_world_tools TS tool");
    expect(body).not.toMatch(/api\.|Workbench\./);
    expect(contract.actions.find((a) => a.name === "goToCoords")!.refuses).toMatch(/TS tool/);
  });
});

describe("refusal codes", () => {
  it("every code the handler answers is in the vocabulary", () => {
    const literal = [...c.matchAll(/(?:Answer\(resp, "\w+", |Refuse\(resp, )"([A-Z_]+)"/g)].map(
      (m) => m[1],
    );
    const constants = [...c.matchAll(/static const string ([A-Z_]+) = "([A-Z_]+)";/g)]
      .filter((m) => m[1] === m[2])
      .map((m) => m[2]);
    const codes = [...new Set([...literal, ...constants])];
    expect(codes.length).toBeGreaterThan(8);
    for (const k of codes) expect(Object.keys(ERROR_CODES), k).toContain(k);
    for (const k of [
      "INVALID_ARGUMENT",
      "MODULE_NOT_OPEN",
      "NO_WORLD",
      "WRONG_MODE",
      "NO_TERRAIN",
      "ENGINE_FALSE",
      "STALE_CURSOR",
      "PATH_NOT_FOUND",
      "RESOURCE_NOT_FOUND",
    ])
      expect(codes, k).toContain(k);
    expect(c).toContain("EMCP_WB_Guard.NOT_IN_PROJECT");
    expect(c).toContain("EMCP_WB_EntityRef.ENTITY_NOT_FOUND");
  });
});

// Census rows this file tests (W6 close-out, EV-W6-113).
// census:mcp:handler-action/EMCP_WB_WorldTools.exportObjects
// census:mcp:handler-action/EMCP_WB_WorldTools.floaters
// census:mcp:handler-action/EMCP_WB_WorldTools.goToCoords
// census:mcp:handler-action/EMCP_WB_WorldTools.importObjects
// census:mcp:handler-action/EMCP_WB_WorldTools.replaceEntities
// census:mcp:handler-action/EMCP_WB_WorldTools.stats

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_WorldTools.resetFlags
// census:mcp:handler-action/EMCP_WB_WorldTools.snapToTerrain
