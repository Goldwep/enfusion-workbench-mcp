/**
 * The W1 World handler (EMCP_WB_World.c) checked over its Enforce text offline (phase5-w1-spec.md
 * section 2.6, DEC-061): the contract matches the structs and the dispatch, the guards come in the
 * order the spec's guard column asks, the engine calls are the spec's, the refusal codes are the
 * vocabulary's, and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_World.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_World.json"));
const editorControl = readFileSync(join(DIR, "EMCP_WB_EditorControl.c"), "utf-8");
const probeMut = readFileSync(join("mod-dev", "probe-mut", "ECEN_ProbeMutActions.c"), "utf-8");

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

describe("EMCP_WB_World structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_WorldRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_WorldResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
  });

  it("OD-4: new, duplicate, saveAs and setWorldEntity are not handler actions", () => {
    const names = contract.actions.map((a) => a.name);
    for (const ts of ["new", "duplicate", "saveAs", "setWorldEntity"]) {
      expect(names).not.toContain(ts);
      expect(c).not.toContain(`req.action == "${ts}"`);
    }
    expect(c).not.toMatch(/CreateWorld|DuplicateWorld|ReplaceWorldEntity|SCR_WorldFilesHelper/);
  });

  it("mutating actions are project-only, reads are not (spec guard column)", () => {
    const mutating = ["register", "play", "stop", "addComment", "annotate"];
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(mutating.includes(a.name));
      expect(a.projectOnly, a.name).toBe(mutating.includes(a.name));
    }
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, Configure or FileIO", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "RunCmd",
      "Configure(",
      "FileIO",
      "EMCP2_sandbox",
      "_throwaway",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });
});

describe("guards", () => {
  it("every mutating action checks the project first", () => {
    for (const m of ["Register", "Play", "Stop", "AddComment", "Annotate"]) {
      const body = method(src, m);
      expect(body.indexOf("EMCP_WB_WorldUtil.ProjectRefused(resp)"), m).toBeGreaterThanOrEqual(0);
      const engine = body.search(/api\.|worldEditor\.|resourceManager\./);
      expect(body.indexOf("ProjectRefused(resp)"), m).toBeLessThan(engine);
    }
    for (const m of ["State", "BrowserSelection", "PlayEvents", "Comments"])
      expect(method(src, m), m).not.toContain("ProjectRefused");
  });

  it("in-memory edits refuse WRONG_MODE in play mode and run inside one entity action", () => {
    expect(method(src, "PlayRefused")).toMatch(
      /if \(!api\.IsGameMode\(\)\)\s*return false;\s*Refuse\(resp, "WRONG_MODE",/,
    );
    for (const m of ["AddComment", "Annotate"]) {
      const body = method(src, m);
      const guard = body.indexOf("EMCP_WB_WorldUtil.PlayRefused(api, resp)");
      expect(guard, m).toBeGreaterThanOrEqual(0);
      expect(guard, m).toBeLessThan(body.indexOf("EMCP_WB_WorldUtil.BeginEdit(api, undo, resp)"));
      expect(body, m).not.toContain("api.BeginEntityAction(");
      expect((body.match(/BeginEdit\(api, undo, resp\)/g) ?? []).length, m).toBe(
        // AddComment and Annotate add also end the action on the failed-create path.
        (body.match(/api\.EndEntityAction\(\)/g) ?? []).length - 1,
      );
      expect(body, m).toContain("resp.undoName = undo;");
    }
  });

  it("a begin that opened no action is refused ENGINE_FALSE and never ended (review W2)", () => {
    const body = method(src, "BeginEdit");
    expect(body).toContain("if (api.BeginEntityAction(pointName))");
    expect(body).toContain('Refuse(resp, "ENGINE_FALSE",');
    expect(body).not.toContain("EndEntityAction");
  });

  it("a missing request is refused before it is read (review W1)", () => {
    expect(src).toMatch(
      /if \(!req\)\s*\{\s*EMCP_WB_WorldUtil\.Refuse\(resp, "INVALID_ARGUMENT", "no request", "send action"\);\s*return resp;\s*\}\s*resp\.action = req\.action;/,
    );
  });

  it("addComment ends the entity action on the failed-create path too", () => {
    const body = method(src, "AddComment");
    inOrder(
      body,
      [
        "if (!EMCP_WB_WorldUtil.BeginEdit(api, undo, resp))",
        "api.CreateEntity(EMCP_WB_WorldUtil.COMMENT_CLASS",
        "if (!created)",
        "api.EndEntityAction();",
        'api.SetVariableValue(created, null, "m_Comment", commentText)',
        'api.SetVariableValue(created, null, "m_Color", colorText)',
        'api.SetVariableValue(created, null, "m_Size", sizeValue.ToString())',
      ],
      "AddComment",
    );
  });

  it("register: existing file inside the project, dry run unless confirm, GetMetaFile before RegisterResourceFile", () => {
    const body = method(src, "Register");
    inOrder(
      body,
      [
        "EMCP_WB_WorldUtil.ProjectRefused(resp)",
        "EMCP_WB_Guard.TargetExistsInProject(req.path, absolute, why)",
        "resourceManager.GetMetaFile(absolute)",
        "if (!req.confirm)",
        "resourceManager.RegisterResourceFile(absolute, false)",
      ],
      "Register",
    );
    expect(body).toContain("resp.dryRun = true;");
    // The probe's RegisterWorld: GetMetaFile first, RegisterResourceFile(abs, false) when none.
    expect(code(probeMut)).toContain("rm.RegisterResourceFile(worldAbsolute, false)");
    expect(code(probeMut)).toContain("rm.GetMetaFile(worldAbsolute)");
  });

  it("play and stop: project, open editor, mode check, then the 1.x switch call", () => {
    inOrder(
      method(src, "Play"),
      [
        "ProjectRefused(resp)",
        "Workbench.GetModule(WorldEditor)",
        "if (api.IsGameMode())",
        "worldEditor.SwitchToGameMode(debugMode, fullScreen)",
        "resp.mode = EMCP_WB_WorldUtil.ModeOf(api)",
      ],
      "Play",
    );
    inOrder(
      method(src, "Stop"),
      [
        "ProjectRefused(resp)",
        "Workbench.GetModule(WorldEditor)",
        "if (!api.IsGameMode())",
        "worldEditor.SwitchToEditMode()",
        "resp.mode = EMCP_WB_WorldUtil.ModeOf(api)",
      ],
      "Stop",
    );
    expect(code(editorControl)).toContain(
      "worldEditor.SwitchToGameMode(req.debugMode, req.fullScreen)",
    );
    expect(code(editorControl)).toContain("worldEditor.SwitchToEditMode()");
  });
});

describe("engine calls are the spec's", () => {
  it("state reads the P-W1-16 flags", () => {
    const body = method(src, "State") + method(src, "ModeOf");
    for (const call of [
      "api.IsGameMode()",
      "api.IsEditMode()",
      "api.IsPrefabEditMode()",
      "api.IsDoingEditAction()",
      "api.UndoOrRedoIsRestoring()",
      "api.IsModifyingData()",
      "api.IsCreatingEntityInWindow()",
      "api.AreGeneratorEventsEnabled()",
      "api.GetCurrentToolName()",
      "api.GetWorldPath(worldPath)",
      "api.GetNumSubScenes()",
      "api.GetCurrentSubScene()",
      "api.GetEditorEntityCount()",
    ])
      expect(body, call).toContain(call);
  });

  it("browserSelection uses the helper's array-Insert callback", () => {
    expect(method(src, "BrowserSelection")).toContain(
      "worldEditor.GetResourceBrowserSelection(picked.Insert, recursive)",
    );
  });

  it("comments scans for CommentEntity and reads the categories", () => {
    const body = method(src, "Comments");
    expect(body).toContain("api.GetEditorEntity(i)");
    expect(body).toContain("candidate.GetClassName() == EMCP_WB_WorldUtil.COMMENT_CLASS");
    expect(body).toContain("api.GetCommentCategories(categoryNames)");
    expect(src).toContain('static const string COMMENT_CLASS = "CommentEntity";');
  });

  it("annotate: a CommentEntity note made, moved and deleted as an entity (W1.7 run 6)", () => {
    // AddCommentEntity drew nothing on a plain entity: it registers a comment entity that draws
    // itself (1.9 EditorCommentEntity). The note is now a CommentEntity of its own.
    const body = method(src, "Annotate");
    inOrder(
      body,
      [
        "EMCP_WB_EntityRef.Resolve(api, req.entity, resolved)",
        "IEntitySource src = resolved.m_Src;",
        "api.SourceToEntity(src)",
        "EMCP_WB_WorldUtil.NoteNameOf(src)",
        "EMCP_WB_Common.FindEntityByName(api, noteName)",
        "EMCP_WB_WorldUtil.NoteSpot(ent, noteSize)",
        "api.CreateEntity(EMCP_WB_WorldUtil.COMMENT_CLASS, noteName, src.GetLayerID(), null, position, vector.Zero)",
        'api.SetVariableValue(created, null, "m_Comment", noteText)',
        'api.SetVariableValue(created, null, "m_Size", noteSize.ToString())',
        'api.SetVariableValue(created, null, "m_FaceCamera", "1")',
        'api.SetVariableValue(created, null, "m_VisibleOverall", "1")',
        'api.SetVariableValue(note, null, "coords", EMCP_WB_Common.VectorToString(moveTo))',
        "api.DeleteEntity(note)",
      ],
      "Annotate",
    );
    expect(body).not.toMatch(/api\.(Add|Move|Remove)CommentEntity\(/);
    expect(method(src, "NoteSpot")).toContain("ent.GetWorldBounds(boundsMin, boundsMax);");
  });

  it("annotate add: the text height is the request's size or scaled from the framing distance (W1.7 run 7)", () => {
    // A fixed 0.5 m over a 0.15 m glass framed from 1.5 m: only "hand no" fitted across the viewport.
    const body = method(src, "Annotate");
    expect(src).not.toContain("NOTE_SIZE =");
    inOrder(
      body,
      [
        'if (req.size != "")',
        "EMCP_WB_Common.ParseFloat(req.size, noteSize)",
        "noteSize > EMCP_WB_WorldUtil.NOTE_SIZE_MAX",
        "framedFrom = EMCP_WB_ViewUtil.FramingDistance(EMCP_WB_WorldUtil.BoundsRadius(ent));",
        "noteSize = EMCP_WB_WorldUtil.NoteSize(framedFrom, noteText);",
        "EMCP_WB_WorldUtil.NoteSpot(ent, noteSize)",
        "resp.noteSize = noteSize;",
        "resp.noteCoords = EMCP_WB_Common.VectorToString(position);",
        "resp.noteColor =",
        "resp.noteDistance = framedFrom;",
      ],
      "Annotate",
    );
    const size = method(src, "NoteSize");
    expect(size).toContain("float size = distance * NOTE_PER_METRE;");
    expect(size).toContain(
      "float widest = distance * NOTE_WIDTH_PER_METRE / (NOTE_CHAR_WIDTH * LongestLine(text));",
    );
    expect(size).toContain("float smallest = distance * NOTE_MIN_PER_METRE;");
    expect(method(src, "NoteSpot")).toContain("return Vector(origin[0], top + size, origin[2]);");
    for (const k of ["noteSize", "noteCoords", "noteColor", "noteDistance"])
      expect(src).toContain(`RegV("${k}");`);
  });

  it("annotate add: the default height reads at the framing distance and fits the frame (model)", () => {
    // The handler's constants, applied to run 7's case: a 0.15 m glass framed from 1.5 m.
    const per = Number(/NOTE_PER_METRE = ([0-9.]+);/.exec(src)![1]);
    const wide = Number(/NOTE_WIDTH_PER_METRE = ([0-9.]+);/.exec(src)![1]);
    const min = Number(/NOTE_MIN_PER_METRE = ([0-9.]+);/.exec(src)![1]);
    const ch = Number(/NOTE_CHAR_WIDTH = ([0-9.]+);/.exec(src)![1]);
    const noteSize = (d: number, len: number) =>
      Math.max(Math.min(d * per, (d * wide) / (ch * len)), d * min);
    const d = 1.5;
    const s = noteSize(d, "W1 hand note".length);
    // CommentEntity.DrawComment skips text below 0.005 of the distance.
    expect(s / d).toBeGreaterThan(0.005);
    // The whole line spans under the 0.9 d cap (a ~75 degree view is ~1.5 d wide at d).
    expect("W1 hand note".length * ch * s).toBeLessThanOrEqual(0.9 * d);
    expect(s).toBeLessThan(0.5 / 4);
    // A longer line is narrowed to fit; a very long one stops at the floor above the draw cut-off.
    const forty = noteSize(d, 40);
    expect(forty).toBeLessThan(s);
    expect(40 * ch * forty).toBeLessThanOrEqual(0.9 * d + 1e-9);
    expect(noteSize(d, 500)).toBeCloseTo(d * min, 9);
    expect(min).toBeGreaterThan(0.005);
  });

  it("playEvents reads the recorder only", () => {
    const body = method(src, "PlayEvents");
    expect(body).toContain("EMCP_WB_PlayRecorder.After(afterSeq, resp.rows)");
    expect(body).not.toMatch(/api\.|worldEditor\./);
  });
});

describe("refusals and paging", () => {
  it("Refuse uses the guard's status and message form with next set", () => {
    const body = method(src, "Refuse");
    expect(body).toContain("resp.status = EMCP_WB_Guard.REFUSED;");
    expect(body).toContain("resp.next = nextStep;");
    expect(body).toContain("EMCP_WB_Guard.RefusalMessage(code,");
  });

  it("every literal refusal code is in the vocabulary", () => {
    const codes = [
      ...c.matchAll(/(?:Refuse\(resp, |resp\.code = |RefusalMessage\()"([A-Z_]+)"/g),
    ].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    for (const k of codes) expect(Object.keys(ERROR_CODES), k).toContain(k);
    for (const k of ["WRONG_MODE", "NO_WORLD", "STALE_CURSOR", "MODULE_NOT_OPEN", "ENGINE_FALSE"])
      expect(codes, k).toContain(k);
  });

  it("comments pages by <start>:<count>, default 50, max 200, STALE_CURSOR on a changed count", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    const body = method(src, "Comments");
    expect(body).toMatch(
      /if \(cursorCount != count\)\s*\{\s*EMCP_WB_WorldUtil\.Refuse\(resp, "STALE_CURSOR",/,
    );
    expect(body).toContain('resp.nextCursor = last.ToString() + ":" + count.ToString();');
    expect(method(src, "ParseCursor")).toContain('raw.Split(":", parts, false)');
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:api:WorldEditor.GetApi/0
// census:api:WorldEditor.GetResourceBrowserSelection/2
// census:api:WorldEditor.SwitchToEditMode/0
// census:api:WorldEditor.SwitchToGameMode/2
// census:api:WorldEditorAPI.AddCommentEntity/4
// census:api:WorldEditorAPI.AreGeneratorEventsEnabled/0
// census:api:WorldEditorAPI.GetCommentCategories/1
// census:api:WorldEditorAPI.GetCurrentToolName/0
// census:api:WorldEditorAPI.GetWorldPath/1
// census:api:WorldEditorAPI.IsCreatingEntityInWindow/0
// census:api:WorldEditorAPI.IsDoingEditAction/0
// census:api:WorldEditorAPI.IsEditMode/0
// census:api:WorldEditorAPI.IsGameMode/0
// census:api:WorldEditorAPI.IsModifyingData/0
// census:api:WorldEditorAPI.IsPrefabEditMode/0
// census:api:WorldEditorAPI.MoveCommentEntity/2
// census:api:WorldEditorAPI.RemoveCommentEntity/1
// census:api:WorldEditorAPI.UndoOrRedoIsRestoring/0
// census:api:WorldEditorPlugin.OnGameModeEnded/0
// census:api:WorldEditorPlugin.OnGameModeStarted/5
// census:mcp:handler-action/EMCP_WB_World.addComment
// census:mcp:handler-action/EMCP_WB_World.annotate
// census:mcp:handler-action/EMCP_WB_World.browserSelection
// census:mcp:handler-action/EMCP_WB_World.comments
// census:mcp:handler-action/EMCP_WB_World.play
// census:mcp:handler-action/EMCP_WB_World.playEvents
// census:mcp:handler-action/EMCP_WB_World.register
// census:mcp:handler-action/EMCP_WB_World.state
// census:mcp:handler-action/EMCP_WB_World.stop
// census:ui:WorldEditor/menu-item/Game/Play Game
