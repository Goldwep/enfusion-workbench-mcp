/**
 * Review round 1, W1 to W8 (DEC-099): the handler fixes checked over their Enforce text offline, in
 * the style of the shipped-*.test.ts files. One describe per finding id of
 * docs/v2/inbox/review/waves-round-1.json; each test fails on the code before the fix. Nothing here
 * talks to Workbench: the live compile check of the changed handlers is a separate step.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function handler(name: string): string {
  return readFileSync(join(DIR, `${name}.c`), "utf-8").replace(/\r\n/g, "\n");
}

/** Body of `static <type> <name>(` (or a non-static method) up to the next separator or class end. */
function method(s: string, name: string, prefix = "static \\w+"): string {
  const at = s.search(new RegExp(`${prefix} ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const classEnd = s.slice(at).search(/\n}\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return code(s.slice(at, ends.length ? Math.min(...ends) : undefined));
}

/** Each text present in body, in the given order. */
function inOrder(body: string, texts: string[], label: string): void {
  let from = 0;
  for (const t of texts) {
    const at = body.indexOf(t, from);
    expect(at, `${label}: ${t}`).toBeGreaterThanOrEqual(0);
    from = at + t.length;
  }
}

describe("F1: wb_resources import says what was written when it refuses after registering", () => {
  const src = handler("EMCP_WB_Resources");
  const apply = method(src, "ApplySettings");
  const imp = method(src, "Import");

  it("no ApplySettings refusal claims 'nothing was written' unconditionally", () => {
    const refusals = apply.match(/EMCP_WB_ResourcesUtil\.Refuse\([^;]*;/g) ?? [];
    expect(refusals.length).toBe(6);
    for (const r of refusals) {
      expect(r, r).not.toMatch(/nothing was written/);
      expect(r, r).toMatch(/Unwritten\(registeredNow\)/);
    }
  });

  it("Unwritten names the registration when registeredNow", () => {
    const u = method(src, "Unwritten");
    inOrder(u, ["if (registeredNow)", "the file was registered", "nothing was written"], "Unwritten");
  });

  it("Import marks registered before the settings are checked", () => {
    inOrder(
      imp,
      ["RegisterResourceFile(absolute, false)", "registeredNow = true;", "resp.registered = true;", "ApplySettings("],
      "Import",
    );
  });
});

describe("F2: wb_view setVisible and placeAtPixel refuse when no undo point opens", () => {
  const src = handler("EMCP_WB_View");

  it("BeginEdit refuses ENGINE_FALSE and clears undoName", () => {
    const b = method(src, "BeginEdit", "protected static bool");
    inOrder(b, ["if (api.BeginEntityAction(pointName))", "return true;", 'resp.undoName = "";', "Refuse(resp, ENGINE_FALSE,", "return false;"], "BeginEdit");
  });

  for (const [m, undo, write] of [
    ["SetVisibility", "UNDO_SET_VISIBLE", "api.SetEntityVisible("],
    ["PlaceAtPixel", "UNDO_PLACE", "api.CreateEntityInWindowEx("],
  ]) {
    it(`${m}: no write without its own entity action, no 'no own undo point' carry-on`, () => {
      const body = method(src, m);
      expect(body).not.toMatch(/bool began/);
      expect(body).not.toMatch(/no own undo point/);
      inOrder(body, [`if (!BeginEdit(api, ${undo}, resp))`, "return;", write, `api.EndEntityAction(${undo});`], m);
    });
  }
});

describe("F3: wb_meta assignMaterial checks Set, Insert and the named slot before it saves", () => {
  const src = handler("EMCP_WB_Meta");
  const body = method(src, "AssignMaterial", "protected static void");

  it("keeps the bool of every Set and of the Insert", () => {
    expect(body).toMatch(/wrote = assign\.Set\(ASSIGNED_MATERIAL, material\);/);
    expect(body).toMatch(/bool setSource = created\.Set\(SOURCE_MATERIAL, req\.name\);/);
    expect(body).toMatch(/bool setAssigned = created\.Set\(ASSIGNED_MATERIAL, material\);/);
    expect(body).toMatch(/bool inserted = assigns\.Insert\(created, -1\);/);
    expect(body).not.toMatch(/^\s*(assign|created)\.Set\(/m);
    expect(body).not.toMatch(/^\s*assigns\.Insert\(/m);
  });

  it("a false write or a named slot that does not read back the material is not saved", () => {
    inOrder(
      body,
      [
        "if (!wrote)",
        "t.Close();",
        "the meta was not saved",
        "return;",
        "ListAssigns(config.GetObjectArray(MATERIAL_ASSIGNS), afterSlots);",
        "SameMaterial(",
        "if (!holds)",
        "t.Close();",
        "the meta was not saved",
        "return;",
        "t.m_Meta.Save();",
      ],
      "AssignMaterial",
    );
  });

  it("SameMaterial folds case and compares the GUID when both carry one", () => {
    const s = method(src, "SameMaterial");
    inOrder(s, ['if (readBack == "")', "return false;", "a.ToLower();", "b.ToLower();", "if (a == b)", 'a.StartsWith("{") && b.StartsWith("{")'], "SameMaterial");
  });
});

describe("F4: the list resolver refuses an id that names more than one entity", () => {
  const src = code(handler("EMCP_WB_EntityRefResolver"));
  const scan = handler("EMCP_WB_EntityRef");

  it("counts every carrier of an id while building the map", () => {
    expect(src).toContain("protected ref map<string, int> m_IdMatches;");
    expect(src).not.toMatch(/m_IdIndex\.Contains\(norm\)\)\s*continue;/);
    expect(src).toMatch(/m_IdMatches\.Set\(norm, seen \+ 1\);/);
  });

  it("answers INVALID_ARGUMENT with the scan's wording before it looks up the index", () => {
    const wording = '" names " + matches.ToString() + " editor entities; use name: or index:"';
    expect(scan).toContain(wording);
    inOrder(
      src,
      [
        "if (m_IdMatches.Find(norm, matches) && matches > 1)",
        "res.m_Code = EMCP_WB_EntityRef.INVALID_ARGUMENT;",
        wording,
        "return false;",
        "if (m_IdIndex.Find(norm, at)",
      ],
      "Resolve",
    );
  });
});

describe("F5 (defensive): wb_container setClass range-checks an index before ChangeObjectClass", () => {
  const body = method(handler("EMCP_WB_Container"), "SetClass", "protected static void");

  it("an index must name an element of an object array, before the entity action opens", () => {
    inOrder(
      body,
      [
        "if (leafIndex >= 0)",
        "if (dataType != DataVarType.OBJECT_ARRAY)",
        "is not an object array",
        "setCount = setList.Count();",
        "if (leafIndex >= setCount)",
        '"PATH_NOT_FOUND"',
        "BeginEdit(t.m_Api, undoName, resp)",
        "ChangeObjectClass(",
      ],
      "SetClass",
    );
  });
});

describe("F6: wb_container describe pages carry <offset>:<total> and never reuse a live target's walk", () => {
  const src = handler("EMCP_WB_Container");
  const body = method(src, "Describe", "protected static void");

  it("parses the cursor as <start>:<count> and answers STALE_CURSOR on another total", () => {
    expect(body).toContain("EMCP_WB_Entity.ParseCursor(req.cursor, offset, issuedFor)");
    expect(body).not.toContain("EMCP_WB_Common.ParseInt(req.cursor, offset)");
    inOrder(body, ["resp.total = rowCount;", 'req.cursor != "" && issuedFor != rowCount', "DropWalk();", '"STALE_CURSOR"', "return;"], "Describe");
    expect(body).toContain('resp.nextCursor = last.ToString() + ":" + rowCount.ToString();');
  });

  it("keeps a walk only for path: and class: targets", () => {
    expect(body).toContain("&& KeepsWalk(req.target))");
    const keeps = method(src, "KeepsWalk", "protected static bool");
    expect(keeps).toContain('return target.StartsWith("path:") || target.StartsWith("class:");');
    expect(keeps).not.toMatch(/open:|entity:/);
  });
});

describe("F7: every GetMetaFile read in World register and Prefabs ends with Release(false)", () => {
  it("World Register releases on the already-registered, the failed and the registered return", () => {
    const body = method(handler("EMCP_WB_World"), "Register");
    inOrder(body, ["resp.alreadyRegistered = true;", "resp.resourceName = meta.GetResourceID();", "meta.Release(false);", "return;"], "already");
    inOrder(body, ["if (!registered || !metaFound)", "if (meta)", "meta.Release(false);", "EngineFalse("], "failed");
    inOrder(body, ['resp.message = "dry run', "resp.resourceName = meta.GetResourceID();", "meta.Release(false);", 'resp.message = "registered";'], "registered");
  });

  it("Prefabs MetaResourceName reads the id, releases, then returns it", () => {
    const body = method(handler("EMCP_WB_Prefabs"), "MetaResourceName");
    inOrder(body, ["string id = meta.GetResourceID();", "meta.Release(false);", "return id;"], "MetaResourceName");
    expect(body).not.toContain("return meta.GetResourceID();");
  });
});

describe("F11: the unguarded 1.x save on EMCP_WB_EditorControl is retired", () => {
  const src = code(handler("EMCP_WB_EditorControl"));
  const contract = JSON.parse(readFileSync(join("contracts", "EMCP_WB_EditorControl.json"), "utf-8")) as {
    actions: { name: string; mutating: boolean; refuses?: string }[];
  };

  it("never calls WorldEditor.Save()", () => {
    expect(src).not.toMatch(/\.Save\(\)/);
    const at = src.indexOf('req.action == "save"');
    expect(at).toBeGreaterThan(0);
    const branch = src.slice(at, src.indexOf('req.action == "saveAs"'));
    expect(branch).toContain('resp.status = "error";');
    expect(branch).toContain("EMCP_WB_Module save");
  });

  it("the contract marks save refused and not mutating, as saveAs", () => {
    const save = contract.actions.find((a) => a.name === "save");
    expect(save?.mutating).toBe(false);
    expect(save?.refuses).toMatch(/EMCP_WB_Module save/);
  });

  it("no shipped tool sends save to EMCP_WB_EditorControl", () => {
    for (const f of ["wb-editor.ts", "wb-launch.ts", "wb-projects.ts", "wb-module.ts"]) {
      const ts = readFileSync(join("src", "tools", f), "utf-8");
      expect(ts, f).not.toMatch(/"EMCP_WB_EditorControl",\s*\{\s*action:\s*"save"/);
    }
  });
});

describe("W3-LOC-2: the localization save guard knows a table by every Id, and forgets it on another open", () => {
  const loc = handler("EMCP_WB_Localization");
  const open = handler("EMCP_WB_OpenResource");

  it("the fingerprint keeps count, first and last Id and adds a digest of every Id", () => {
    const f = method(loc, "Fingerprint");
    inOrder(
      f,
      ["for (int i = 0; i < count; i++)", 'every = every + IdOf(items.Get(i)) + "|";', 'count.ToString() + "|" + firstId + "|" + lastId + "|" + EMCP_WB_EntityRef.Digest(every)'],
      "Fingerprint",
    );
  });

  it("OpenIn forgets the known table before the Localization Editor is handed a .st", () => {
    const body = method(open, "OpenIn");
    inOrder(body, ['if (moduleName == "LocalizationEditor")', "EMCP_WB_Localization.Forget();", "owner.SetOpenedResource(path)"], "OpenIn");
    const forget = method(loc, "Forget");
    inOrder(forget, ['s_sTablePath = "";', "s_aFingerprints = null;", "s_iUnsaved = 0;"], "Forget");
  });

  it("save states the same-Ids limit", () => {
    const save = method(loc, "SaveTable");
    inOrder(save, ["resp.warnings.Insert(SAME_IDS_LIMIT);", "if (!req.confirm)"], "SaveTable");
    expect(loc).toMatch(/static const string SAME_IDS_LIMIT = "[^"]*very same Ids[^"]*";/);
  });
});

describe("W3-LOC-1 (defensive): open refuses a {GUID} that names another path", () => {
  const body = method(handler("EMCP_WB_Localization"), "OpenTable");

  it("checks Workbench.GetResourceName(guid) against the cleaned path before SetOpenedResource", () => {
    inOrder(
      body,
      ['if (guid != "")', "Workbench.GetResourceName(guid)", "byGuid.GetPath()", "EMCP_WB_Guard.Fold(guidPath) != EMCP_WB_Guard.Fold(clean)", "Refuse(resp, INVALID_ARGUMENT,", "locEditor.SetOpenedResource(guid + clean)"],
      "OpenTable",
    );
  });
});

describe("W3-LOC-3 (defensive): an insert roll-back counts the edit and reads the delete back", () => {
  const loc = handler("EMCP_WB_Localization");

  it("both roll-back returns go through RollBackInsert", () => {
    const body = method(loc, "InsertRow");
    expect(body.match(/RollBackInsert\(locEditor, doc, known, req\.id\)/g)?.length).toBe(2);
    expect(body).not.toMatch(/locEditor\.DeleteItem\(req\.id\);/);
  });

  it("RollBackInsert deletes, ends the modify, notes the edit, then reads CountId", () => {
    const r = method(loc, "RollBackInsert", "protected static string");
    inOrder(r, ["locEditor.DeleteItem(itemId);", "locEditor.EndModify();", "NoteEdit(known, doc.m_Table);", "CountId(itemsNow, itemId)", "if (left == 0)", "deleted again"], "RollBackInsert");
  });
});

describe("W3-LOC-4 (defensive): the Id and given-twice tests fold case", () => {
  const loc = handler("EMCP_WB_Localization");

  it("insert and set find the Id field through FieldIndex; FieldsOk compares with SameField", () => {
    expect(code(loc)).not.toMatch(/req\.fields\.Find\(EMCP_WB_LocalizationUtil\.VAR_ID\)/);
    expect(code(loc).match(/FieldIndex\(req\.fields, EMCP_WB_LocalizationUtil\.VAR_ID\)/g)?.length).toBe(2);
    expect(method(loc, "FieldsOk")).toContain("if (SameField(fieldNames.Get(j), fieldName))");
    inOrder(method(loc, "SameField"), ["la.ToLower();", "lb.ToLower();", "return la == lb;"], "SameField");
  });
});

describe("W6-01: importObjects names a false scale write as a failed row", () => {
  it("the scale branch inserts an indexed ENGINE_FALSE row into failed", () => {
    const body = method(handler("EMCP_WB_WorldTools"), "ImportObjects");
    inOrder(
      body,
      ['!api.SetVariableValue(created, null, "scale", item.m_Scale.ToString()))', "scaleFailed++;", 'resp.failed.Insert(item.m_Index.ToString() + ";" + ENGINE_FALSE + " SetVariableValue scale returned false'],
      "ImportObjects",
    );
  });
});

describe("W7-GEN-01: generator detach reads the entity reference before any delete", () => {
  it("resp.id is formatted before BeginEntityAction and never after DeleteEntity", () => {
    const body = method(handler("EMCP_WB_Generator"), "DetachGenerator");
    inOrder(body, ["resp.id = EMCP_WB_EntityRef.Format(src);", "api.BeginEntityAction(UNDO_DETACH)", "api.DeleteEntity(gen)", "api.EndEntityAction();"], "DetachGenerator");
    const after = body.slice(body.indexOf("api.DeleteEntity(gen)"));
    expect(after).not.toContain("Format(src)");
  });
});

describe("W8-DIAG-01: wb_diag set compares the read-back with the asked value", () => {
  const src = handler("EMCP_WB_Diag");

  it("answers applied from a numeric compare by kind", () => {
    const set = method(src, "DoSet");
    inOrder(set, ["EMCP_WB_DiagUtil.WriteValue(id, kind, wantedInt, wantedFloat);", "resp.applied = EMCP_WB_DiagUtil.Applied(id, kind, wantedInt, wantedFloat);", "if (!resp.applied)", "the engine clamped or ignored it"], "DoSet");
    const applied = method(src, "Applied");
    for (const t of ["DiagMenu.GetBool(id) == (wantedInt != 0)", "DiagMenu.GetRangeValue(id)", "DiagMenu.GetEngineRangeValue(id)", "DiagMenu.GetEngineValue(id) == wantedInt", "DiagMenu.GetValue(id) == wantedInt", "Math.AbsFloat(gotFloat - wantedFloat) <= tolerance"])
      expect(applied, t).toContain(t);
  });

  it("applied is a registered response key and in the contract", () => {
    expect(src).toContain('RegV("applied");');
    const c = JSON.parse(readFileSync(join("contracts", "EMCP_WB_Diag.json"), "utf-8")) as {
      response: string[];
      actions: { name: string; response: { key: string }[] }[];
    };
    expect(c.response).toContain("applied");
    expect(c.actions.find((a) => a.name === "set")?.response.map((r) => r.key)).toContain("applied");
  });
});

describe("W6-02 (defensive): a stats cursor page skips the layer and grid work", () => {
  it("counts every prefab, then continues before the layer path and the transform on a cursor page", () => {
    const body = method(handler("EMCP_WB_WorldTools"), "Stats");
    inOrder(body, ['bool firstPage = req.cursor == "";', "prefabCounts.Set(prefab, prefabCounts.Get(prefab) + 1);", "if (!firstPage)", "continue;", "api.GetSubsceneLayerPath(sub, layerId)", "ent.GetWorldTransform(mat);"], "Stats");
  });
});
