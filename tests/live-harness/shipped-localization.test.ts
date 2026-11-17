/**
 * EMCP_WB_Localization.c checked over its Enforce text offline (wave W3, phase5-w3-spec.md section
 * 2.2, KD-009): one action surface (DEC-061: the 1.x names are mapped in TypeScript), the contract
 * matches the structs and the dispatch, the table is walked through GetObjectArray("Items") and not
 * GetNumChildren/GetChild, every action makes the engine calls the spec names (each checked against
 * the 1.9.0.37 index by scripts/enforce-lint.ts), edits sit inside BeginModify/EndModify with the
 * MODAL_HAZARD and DUPLICATE_ID refusals before them, open never replaces a table with unsaved
 * handler edits or one opened by hand, save is project-guarded and a dry run without confirm and
 * says what SCR_LocModifiedPlugin writes (DEC-063 OD-5), and buildRuntime and close send nothing.
 * Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription, DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Localization.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Localization.json"));

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of a method up to the next method separator. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`(?:static |protected )*\\b(?!return\\b)\\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = s.indexOf("//-----", at);
  return code(s.slice(at, end < 0 ? undefined : end));
}

const C = code(src);

const READS: Record<string, string> = {
  status: "TableStatus",
  columns: "ListColumns",
  list: "ListItems",
  get: "GetItem",
  selection: "ReadSelection",
};
const EDITS: Record<string, string> = {
  open: "OpenTable",
  insert: "InsertRow",
  set: "SetFields",
  delete: "DeleteRow",
  filter: "FilterRows",
  save: "SaveTable",
  buildRuntime: "BuildRuntime",
  close: "CloseTable",
};
const FILE_WRITES = ["save", "buildRuntime"];

describe("EMCP_WB_Localization structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_LocalizationRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_LocalizationResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("the tool description stays within its budget", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("dispatches every contract action to its method and nothing else (DEC-061)", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*\n\s*(\w+)\(/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(branches).toHaveLength(13);
    for (const m of branches) expect(m[2]).toBe({ ...READS, ...EDITS }[m[1]]);
    for (const old of ["getTable", "listLanguages", "modify", "itemId", "property"])
      expect(C, old).not.toContain(`"${old}"`);
  });

  it("marks the mutating actions, and projectOnly only the file writes", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(a.name in EDITS);
      expect(a.projectOnly, a.name).toBe(FILE_WRITES.includes(a.name));
    }
  });

  it("no FindFiles, FileIO, RunCmd, RunCommandline, Configure, Dialog, user name or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "FileIO",
      "RunCmd",
      "RunCommandline",
      "Configure(",
      "Workbench.Dialog",
      "ScriptDialog",
      "GetUserName",
      "EMCP2_sandbox",
      "_throwaway",
      "SaveContainer",
      "ExecuteAction",
      ".Close()",
    ]) {
      expect(C, banned).not.toContain(banned);
    }
  });

  it("uses no ternary operator", () => {
    const noStrings = C.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    expect(noStrings).not.toMatch(/\?/);
  });

  it("walks the Items array, not GetNumChildren/GetChild, and invents no columns (KD-009)", () => {
    expect(C).not.toMatch(/GetNumChildren|GetChild\(/);
    expect(C).toContain("GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS)");
    expect(src).toContain('static const string VAR_ITEMS = "Items";');
    for (const gone of ['"en_us"', '"target"', '"comment"', "500"])
      expect(C, gone).not.toContain(gone);
  });
});

describe("guards and documents", () => {
  it("FindDoc: the editor, then GetTable, then the Items array, each refused when missing", () => {
    const body = method(src, "FindDoc");
    const order = [
      "Editor(resp)",
      "locEditor.GetTable()",
      "NO_DOCUMENT",
      "table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS)",
      "doc.m_Items = items;",
    ].map((t) => body.indexOf(t));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(method(src, "Editor")).toContain("Workbench.GetModule(LocalizationEditor)");
    expect(method(src, "Editor")).toContain("MODULE_NOT_OPEN");
  });

  it("every action but status, open, buildRuntime and close starts from FindDoc", () => {
    for (const m of [
      "ListColumns",
      "ListItems",
      "GetItem",
      "ReadSelection",
      "InsertRow",
      "SetFields",
      "DeleteRow",
      "FilterRows",
      "SaveTable",
    ])
      expect(method(src, m), m).toContain("if (!FindDoc(doc, resp))\n\t\t\treturn;");
  });

  it("refusals use the guard's status and message form", () => {
    expect(method(src, "Refuse")).toContain("EMCP_WB_Guard.REFUSED");
    expect(method(src, "Answer")).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });

  it("no engine pointer travels through an out parameter: result objects carry them", () => {
    expect(src).toMatch(
      /class EMCP_WB_LocalizationDoc\s*\{[^}]*LocalizationEditor m_Editor;[^}]*BaseContainer m_Table;[^}]*ref BaseContainerList m_Items;/,
    );
    expect(src).toMatch(/class EMCP_WB_LocalizationItem\s*\{[^}]*BaseContainer m_Item;/);
    expect(C).not.toMatch(
      /out (?:BaseContainer|BaseContainerList|LocalizationEditor|WBModuleDef)\b/,
    );
  });

  it("open: a clean relative .st, never switched over unsaved handler edits or a table opened by hand", () => {
    const body = method(src, "OpenTable");
    const at = (s: string) => body.indexOf(s);
    expect(at("EMCP_WB_Guard.CleanRelative(")).toBeGreaterThan(0);
    expect(at('lower.EndsWith(".st")')).toBeGreaterThan(at("EMCP_WB_Guard.CleanRelative("));
    const set = at("locEditor.SetOpenedResource(guid + clean)");
    expect(set).toBeGreaterThan(0);
    expect(at("Workbench.OpenModule(LocalizationEditor)")).toBeLessThan(set);
    const same = at("nothing was switched");
    const byHand = at("not opened through open");
    const unsaved = at("if (s_iUnsaved > 0)");
    for (const i of [same, byHand, unsaved]) {
      expect(i).toBeGreaterThan(at("locEditor.GetTable()"));
      expect(i).toBeLessThan(set);
    }
    expect(body.slice(byHand - 200, unsaved)).toContain("MODAL_HAZARD");
    expect(body.slice(unsaved, set)).toMatch(/Refuse\(resp, MODAL_HAZARD,[^\n]*\n\s*return;/);
    // The remembered table: path, a fresh fingerprint history holding the opened one, no unsaved edits.
    expect(body.slice(set)).toContain("s_sTablePath = clean;");
    expect(body.slice(set)).toContain("s_aFingerprints = new array<string>();");
    expect(body.slice(set)).toContain(
      "NoteFingerprint(EMCP_WB_LocalizationUtil.Fingerprint(items));",
    );
    expect(body.slice(set)).toContain("s_iUnsaved = 0;");
  });

  it("the known table is the remembered path whose fingerprint is one it had at open or after an own edit", () => {
    // W3 fix-up 2 (run 2, w3-23): an Edit > Undo of an own insert went back to an earlier
    // fingerprint and the table read as opened by hand; the earlier ones are kept.
    const body = method(src, "KnownPath");
    expect(body).toContain("s_aFingerprints.Find(EMCP_WB_LocalizationUtil.Fingerprint(items)) < 0");
    expect(method(src, "Fingerprint")).toContain('count.ToString() + "|" + firstId + "|" + lastId');
    const note = method(src, "NoteEdit");
    expect(note).toContain("s_iUnsaved++;");
    expect(note).toContain("NoteFingerprint(EMCP_WB_LocalizationUtil.Fingerprint(items));");
    const keep = method(src, "NoteFingerprint");
    expect(keep).toContain("s_aFingerprints.Insert(fingerprint);");
    expect(keep).toContain("s_aFingerprints.Count() > FINGERPRINTS_MAX");
    expect(src).not.toContain("s_sFingerprint");
  });
});

describe("engine calls per action (spec section 2.2)", () => {
  const CALLS: Record<string, string[]> = {
    TableStatus: [
      "Editor(resp)",
      "locEditor.GetNumContainers()",
      "locEditor.GetContainer(0)",
      "locEditor.GetTable()",
      "table.GetClassName()",
      "table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS)",
      "items.Count()",
      "firstItem.GetClassName()",
    ],
    ListColumns: [
      "doc.m_Items.Get(0)",
      "sample.GetNumVars()",
      "sample.GetVarName(v)",
      "sample.GetDataVarType(v)",
      "EMCP_WB_LocalizationUtil.EnumPairs(sample, v)",
    ],
    EnumPairs: ["cont.GetEnumValues(varIndex, enumNames, enumNumbers)"],
    ListItems: [
      "doc.m_Items.Get(at)",
      "item.GetVarIndex(shown)",
      "EMCP_WB_LocalizationUtil.ReadAsText(item, shown, item.GetDataVarType(varIndex))",
      "EMCP_WB_LocalizationUtil.PageWindow(req.cursor, req.limit, total, first, stop, code, why)",
    ],
    ReadAsText: ["cont.Get(varName, stringValue)", "cont.Get(varName, intList)"],
    GetItem: [
      "EMCP_WB_LocalizationUtil.Locate(doc.m_Items, req.id, req.index, found)",
      "item.GetNumVars()",
    ],
    Locate: ["items.Get(at)", "CountId(items, itemId)"],
    ReadSelection: [
      "doc.m_Editor.GetSelectedRows(selectedRows)",
      "doc.m_Editor.GetFilteredRows(filteredRows)",
    ],
    OpenTable: [
      "Workbench.OpenModule(LocalizationEditor)",
      "locEditor.SetOpenedResource(guid + clean)",
    ],
    InsertRow: [
      "locEditor.BeginModify(UNDO_INSERT)",
      "locEditor.InsertItem(req.id, true, true)",
      "locEditor.ModifyProperty(item, item.GetVarIndex(req.fields.Get(i)), encoded.Get(i))",
      "locEditor.EndModify()",
    ],
    SetFields: [
      "locEditor.BeginModify(UNDO_SET)",
      "locEditor.ModifyProperty(item, item.GetVarIndex(req.fields.Get(i)), encoded.Get(i))",
      "locEditor.EndModify()",
    ],
    DeleteRow: [
      "locEditor.BeginModify(UNDO_DELETE)",
      "locEditor.DeleteItem(found.m_Id)",
      "locEditor.EndModify()",
    ],
    FilterRows: [
      "doc.m_Editor.AddUserFilter(rowsIdx,",
      "doc.m_Editor.RefreshUI()",
      "doc.m_Editor.GetFilteredRows(filteredRows)",
    ],
    SaveTable: ["doc.m_Editor.Save()"],
  };
  for (const [m, calls] of Object.entries(CALLS)) {
    it(`${m} makes ${calls.length} call(s)`, () => {
      const body = method(src, m);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("buildRuntime and close are GATED and send nothing (DEC-063 OD-2, OD-3)", () => {
    for (const m of ["BuildRuntime", "CloseTable"]) {
      const body = method(src, m);
      expect(body, m).toMatch(
        /^\s*[^{]*\{\s*Refuse\(resp, GATED, "[^"]*nothing was sent", "[^"]*"\);\s*\}\s*$/,
      );
    }
    expect(src).toContain('static const string GATED = "GATED";');
  });
});

describe("edits", () => {
  it("insert: Id checked, DUPLICATE_ID and MODAL_HAZARD refused before BeginModify, re-checked on the new item", () => {
    const body = method(src, "InsertRow");
    const at = (s: string) => body.indexOf(s);
    const begin = at("locEditor.BeginModify(UNDO_INSERT)");
    expect(at("EMCP_WB_LocalizationUtil.IdOk(req.id, why)")).toBeLessThan(begin);
    expect(at("Refuse(resp, DUPLICATE_ID,")).toBeLessThan(begin);
    expect(at("Refuse(resp, MODAL_HAZARD, hazard")).toBeLessThan(begin);
    const insert = at("locEditor.InsertItem(");
    const recheck = at(
      "EMCP_WB_LocalizationUtil.ModalHazard(item, req.fields, encoded, itemHasStatus, statusNow)",
    );
    const modify = at("locEditor.ModifyProperty(");
    const end = body.lastIndexOf("locEditor.EndModify();");
    expect(insert).toBeGreaterThan(begin);
    expect(recheck).toBeGreaterThan(insert);
    expect(modify).toBeGreaterThan(recheck);
    expect(end).toBeGreaterThan(modify);
    // A refused new item is deleted again inside the same modify (RollBackInsert: DeleteItem, then
    // EndModify, the edit counted and the delete read back; review round 1, W3-LOC-3).
    expect(body.slice(recheck, modify)).toMatch(
      /RollBackInsert\(locEditor, doc, known, req\.id\);\s*Refuse\(resp, MODAL_HAZARD/,
    );
    // Read back: count +1, the Id found, the fields as sent.
    expect(body.slice(end)).toContain("resp.total != countBefore + 1");
    expect(body.slice(end)).toContain("Mismatch(readItem, req.fields, encoded)");
    expect(body.slice(end)).toContain("resp.warnings.Insert(OD5_EDIT);");
  });

  it("set: encoded and hazard-checked before BeginModify; before, then after read back", () => {
    const body = method(src, "SetFields");
    const at = (s: string) => body.indexOf(s);
    const begin = at("locEditor.BeginModify(UNDO_SET)");
    expect(at("EncodeAll(item, req.fields, req.values, encoded, code, why)")).toBeLessThan(begin);
    expect(at("Refuse(resp, MODAL_HAZARD, hazard")).toBeLessThan(begin);
    expect(at("Refuse(resp, DUPLICATE_ID,")).toBeLessThan(begin);
    expect(at("EMCP_WB_LocalizationUtil.FieldRows(item, req.fields, resp.before)")).toBeLessThan(
      begin,
    );
    const end = at("locEditor.EndModify()");
    expect(
      at("EMCP_WB_LocalizationUtil.FieldRows(readItem, req.fields, resp.after)"),
    ).toBeGreaterThan(end);
    expect(at("Mismatch(readItem, req.fields, encoded)")).toBeGreaterThan(end);
    expect(body).toContain("resp.warnings.Insert(OD5_EDIT);");
  });

  it("delete: a full snapshot and the shared-Id refusal before BeginModify; count and Id read back", () => {
    const body = method(src, "DeleteRow");
    const at = (s: string) => body.indexOf(s);
    const begin = at("locEditor.BeginModify(UNDO_DELETE)");
    expect(at("Refuse(resp, DUPLICATE_ID,")).toBeLessThan(begin);
    expect(at("EMCP_WB_LocalizationUtil.AllRows(found.m_Item, resp.before)")).toBeLessThan(begin);
    expect(body.slice(at("locEditor.EndModify()"))).toContain(
      "left > 0 || resp.total != countBefore - 1",
    );
  });

  it("the modal hazards are the spec's SCR_LocStatusPlugin rules", () => {
    const body = method(src, "ModalHazard");
    expect(body).toContain('fieldName == editedKey && sent != "" && sent != EDITED_NONE');
    expect(body).toContain("itemStatus != devPending");
    // Field names are compared case folded.
    expect(body).toContain("fieldName.ToLower();");
    expect(body).toContain("fieldName == targetKey && hasStatus");
    expect(body).toContain("if (!devKnown)");
    expect(body).toContain(
      "EnumNumber(sample, sample.GetVarIndex(VAR_STATUS), STATUS_DEV_PENDING, devPending)",
    );
    expect(src).toContain('static const string EDITED_NONE = "@@@";');
    expect(src).toContain('static const string STATUS_DEV_PENDING = "DEVELOPMENT_PENDING";');
  });

  it("values: string as is, integer or enum by number or name, bool as bool.ToString, arrays comma-joined, others UNSUPPORTED_TYPE", () => {
    const body = method(src, "Encode");
    expect(body).toContain("encoded = number.ToString();");
    expect(body).toContain("encoded = byName.ToString();");
    expect(body).toContain("encoded = boolValue.ToString();");
    expect(body).toContain("DataVarType.INTEGER_ARRAY || dataType == DataVarType.BOOLEAN_ARRAY");
    expect(body).toContain("code = UNSUPPORTED_TYPE;");
    // Floats never travel through a JSON number: values are text, ints parsed strictly.
    expect(body).toContain("EMCP_WB_Common.ParseInt(text, number)");
    // Bools read back are compared as bools.
    expect(method(src, "SameValue")).toContain("ParseBool(readBack, a) || !ParseBool(sent, b)");
  });

  it("filter: no match is refused before AddUserFilter", () => {
    const body = method(src, "FilterRows");
    const gate = body.indexOf("if (rowsIdx.IsEmpty())");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(body.indexOf("doc.m_Editor.AddUserFilter("));
    expect(body.slice(gate, body.indexOf("doc.m_Editor.AddUserFilter("))).toMatch(
      /Refuse\(resp, ITEM_NOT_FOUND,/,
    );
  });
});

describe("save (file write)", () => {
  const body = method(src, "SaveTable");
  const at = (s: string) => body.indexOf(s);

  it("project found, the table known, its file inside the project, then a dry run unless confirm", () => {
    const order = [
      "EMCP_WB_Guard.IsProjectFound()",
      "FindDoc(doc, resp)",
      "KnownPath(doc.m_Items)",
      "Refuse(resp, NO_DOCUMENT,",
      "EMCP_WB_Guard.TargetExistsInProject(known, absolute, why)",
      "resp.warnings.Insert(OD5_SAVE);",
      "if (!req.confirm)",
      "resp.dryRun = true;",
      "doc.m_Editor.Save()",
      "s_iUnsaved = 0;",
    ].map(at);
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body.slice(at("if (!req.confirm)"), at("doc.m_Editor.Save()"))).toMatch(
      /resp\.dryRun = true;[\s\S]*return;/,
    );
  });

  it("the dry run says that the engine plugin writes the Workbench user name into Author and LastChanged (OD-5)", () => {
    expect(src).toMatch(
      /OD5_SAVE = "[^"]*Workbench user name[^"]*Author and LastChanged[^"]*\(OD-5\)"/,
    );
    expect(src).toMatch(
      /OD5_EDIT = "[^"]*SCR_LocModifiedPlugin writes the Workbench user name into Author and LastChanged[^"]*"/,
    );
    expect(at("resp.warnings.Insert(OD5_SAVE);")).toBeLessThan(at("if (!req.confirm)"));
  });

  it("a failed save answers SAVE_FAILED", () => {
    expect(body).toMatch(/if \(!saved\)\s*\{\s*Answer\(resp, "error", SAVE_FAILED,/);
  });
});

describe("paging, rows and refusal codes", () => {
  it("cursor is <start>:<count>; a changed count is STALE_CURSOR; limit 50 default, 200 max", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    expect(method(src, "PageWindow")).toMatch(
      /if \(count != total \|\| at > total\)\s*\{\s*code = "STALE_CURSOR";/,
    );
  });

  it("row values escape \\ and | (and line breaks)", () => {
    const body = method(src, "Esc");
    const order = [
      's.Replace("\\\\", "\\\\\\\\");',
      's.Replace("|", "\\\\|");',
      's.Replace("\\n", "\\\\n");',
    ].map((t) => body.indexOf(t));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("answers the W3 codes", () => {
    for (const c of [
      '"NO_DOCUMENT"',
      '"MODAL_HAZARD"',
      '"ITEM_NOT_FOUND"',
      '"DUPLICATE_ID"',
      '"UNSUPPORTED_TYPE"',
      '"GATED"',
      '"ENGINE_FALSE"',
      '"SAVE_FAILED"',
      '"INVALID_ARGUMENT"',
      '"MODULE_NOT_OPEN"',
      "EMCP_WB_Guard.NOT_IN_PROJECT",
    ])
      expect(src, c).toContain(c);
  });
});

// Census rows this file tests (W3 close-out, EV-W3-099).
// census:api:LocalizationEditor.BeginModify/1
// census:api:LocalizationEditor.DeleteItem/1
// census:api:LocalizationEditor.EndModify/0
// census:api:LocalizationEditor.GetTable/0
// census:api:LocalizationEditor.InsertItem/3
// census:api:LocalizationEditor.ModifyProperty/3
// census:mcp:handler-action/EMCP_WB_Localization.columns
// census:mcp:handler-action/EMCP_WB_Localization.filter
// census:mcp:handler-action/EMCP_WB_Localization.get
// census:mcp:handler-action/EMCP_WB_Localization.list
// census:mcp:handler-action/EMCP_WB_Localization.open
// census:mcp:handler-action/EMCP_WB_Localization.save
// census:mcp:handler-action/EMCP_WB_Localization.selection
// census:mcp:handler-action/EMCP_WB_Localization.set
// census:mcp:handler-action/EMCP_WB_Localization.status
