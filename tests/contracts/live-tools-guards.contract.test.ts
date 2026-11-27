/**
 * The 1.x world-edit handlers checked over their Enforce text offline (Phase 7 total audit,
 * live-tools-a-03 and live-tools-a-02; live-tools-b-1 for EMCP_WB_Module action): every branch
 * that edits the open world runs the two checks of the W-wave edit handlers (EditApi of
 * EMCP_WB_Entity.c: EMCP_WB_Guard.IsProjectFound, then api.IsGameMode) before its first engine
 * edit call; CreateEntity answers the placed entity's origin, not the request; Module action
 * refuses a dialog label before ExecuteAction. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract } from "../../src/manifest/contract.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const read = (f: string) => readFileSync(join(DIR, f), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Each text is present, in this order, and the guard texts come before `edit`. */
function guardedBefore(body: string, edit: string, label: string): void {
  const project = body.indexOf("EMCP_WB_Guard.IsProjectFound()");
  const mode = body.indexOf("api.IsGameMode()", project);
  const at = body.indexOf(edit);
  expect(project, `${label}: IsProjectFound`).toBeGreaterThanOrEqual(0);
  expect(mode, `${label}: IsGameMode after IsProjectFound`).toBeGreaterThan(project);
  expect(at, `${label}: ${edit}`).toBeGreaterThan(mode);
}

const CASES: Array<{ file: string; edits: string[] }> = [
  { file: "EMCP_WB_Components.c", edits: ["api.CreateComponent(", "api.DeleteComponent("] },
  {
    file: "EMCP_WB_Clipboard.c",
    edits: [
      "api.CutSelectedEntities()",
      "api.PasteEntities()",
      "api.PasteEntitiesAtMouseCursorPos()",
      "api.DuplicateSelectedEntities()",
    ],
  },
  { file: "EMCP_WB_CreateEntity.c", edits: ["api.CreateEntity("] },
  { file: "EMCP_WB_DeleteEntity.c", edits: ["api.DeleteEntity("] },
  { file: "EMCP_WB_EditorControl.c", edits: ['menuPath.Insert("Undo")', 'menuPath.Insert("Redo")'] },
];

describe("1.x world-edit handlers run the W-wave edit guard (live-tools-a-03)", () => {
  for (const c of CASES) {
    it(`${c.file}: project found, then not in play mode, before each edit`, () => {
      const body = code(read(c.file));
      for (const e of c.edits) guardedBefore(body, e, c.file);
      // The refusals keep the 1.x response form (status error) so the 1.x tools flag them, and
      // name the vocabulary codes.
      expect(body).toContain("EMCP_WB_Guard.NOT_IN_PROJECT +");
      expect(body).toContain('"WRONG_MODE: the World Editor is in play mode');
    });
  }

  it("the read actions stay unguarded: Components list, Clipboard copy and hasCopied", () => {
    const comp = code(read("EMCP_WB_Components.c"));
    expect(comp).toMatch(/if \(req\.action == "add" \|\| req\.action == "remove"\)\s*\{\s*if \(!EMCP_WB_Guard/);
    const clip = code(read("EMCP_WB_Clipboard.c"));
    expect(clip).toMatch(
      /req\.action == "cut" \|\| req\.action == "paste" \|\| req\.action == "pasteAtCursor" \|\| req\.action == "duplicate"/,
    );
  });

  it("EditorControl marks undo and redo projectOnly in its contract", () => {
    const c = loadContract(join("contracts", "EMCP_WB_EditorControl.json"));
    const only = Object.fromEntries(c.actions.map((a) => [a.name, a.projectOnly]));
    expect(only).toMatchObject({ undo: true, redo: true, play: false, openResource: false });
  });
});

describe("EMCP_WB_CreateEntity answers the placed entity, not the request (live-tools-a-02)", () => {
  it("position is the runtime entity's origin; the parsed request vector is never echoed", () => {
    const body = code(read("EMCP_WB_CreateEntity.c"));
    expect(body).not.toContain("resp.position = EMCP_WB_Common.VectorToString(pos)");
    expect(body).toMatch(/api\.SourceToEntity\(entSrc\)/);
    expect(body).toMatch(/resp\.position = EMCP_WB_Common\.VectorToString\(placedEnt\.GetOrigin\(\)\)/);
  });
});

describe("EMCP_WB_CreateEntity says the entity stands when the rename fails (live-tools-a-04)", () => {
  it("declares created, sets it after CreateEntity returned a source and before the rename error", () => {
    const body = code(read("EMCP_WB_CreateEntity.c"));
    expect(body).toMatch(/bool created;/);
    expect(body).toMatch(/RegV\("created"\);/);
    const nullCheck = body.indexOf("if (!entSrc)");
    const set = body.indexOf("resp.created = true;");
    const renameErr = body.indexOf("if (renameFailed)");
    expect(nullCheck).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(nullCheck);
    expect(renameErr).toBeGreaterThan(set);
    // Set once, never on the early-return error paths.
    expect(body.split("resp.created = true;").length).toBe(2);
  });
});

describe("EMCP_WB_Module action refuses a dialog label before ExecuteAction (live-tools-b-1)", () => {
  it("MODAL_HAZARD on a trailing ellipsis comes before the allow-list and ExecuteAction", () => {
    const body = code(read("EMCP_WB_Module.c"));
    const run = body.slice(body.indexOf("static void RunAction("));
    const hazard = run.indexOf('lastSegment.EndsWith("...")');
    const refuse = run.indexOf('"MODAL_HAZARD"');
    const exec = run.indexOf("wbModule.ExecuteAction(");
    expect(hazard).toBeGreaterThanOrEqual(0);
    expect(refuse).toBeGreaterThan(hazard);
    expect(exec).toBeGreaterThan(refuse);
  });

  it("the compiled allow-list holds no dialog opener", () => {
    const list = read("EMCP_WB_ActionAllowList.c");
    const paths = [...list.matchAll(/outPaths\.Insert\("([^"]*)"\);/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => /(\.\.\.|…)$/.test(p.trim()))).toEqual([]);
  });
});
