import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  HANDLER,
  HANDLER_ACTIONS,
  LEGACY_ACTIONS,
  LEGACY_MAP,
  RANGE_MAX,
  SCRIPT_EDITOR_CONTRACT,
  UNDO_NOT_THE_RESTORE,
  flatInputShape,
  prepareRequest,
  runScriptEditor,
  wbScriptEditorDescription,
} from "../../src/tools/wb-script-editor.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(
  answer: (p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "no", next = "fix it") => ({
  status: "refused",
  code,
  message,
  next,
});

describe("wb_script_editor contract", () => {
  it("loads and names the ten handler actions", () => {
    expect(SCRIPT_EDITOR_CONTRACT.tool).toBe("wb_script_editor");
    expect(HANDLER).toBe("EMCP_WB_ScriptEditor");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      [
        "close",
        "getLines",
        "insertLine",
        "jump",
        "open",
        "removeLine",
        "replaceRange",
        "save",
        "setLine",
        "state",
      ].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbScriptEditorDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks the line edits and save projectOnly, the reads and view changes not", () => {
    const only = SCRIPT_EDITOR_CONTRACT.actions.filter((a) => a.projectOnly).map((a) => a.name);
    expect(only.sort()).toEqual(
      ["insertLine", "removeLine", "replaceRange", "save", "setLine"].sort(),
    );
  });

  it("gives registerTool a flat shape with every key, oneBased and the 1.x names", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "path",
      "symbol",
      "line",
      "text",
      "start",
      "count",
      "lines",
      "expected",
      "cursor",
      "limit",
      "confirm",
      "oneBased",
    ])
      expect(shape[k], k).toBeDefined();
    for (const n of LEGACY_ACTIONS) expect(shape.action!.safeParse(n).success, n).toBe(true);
    expect(LEGACY_ACTIONS.sort()).toEqual(Object.keys(LEGACY_MAP).sort());
    expect(shape.lines!.safeParse(["a", "b"]).success).toBe(true);
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  const refuses = (input: unknown, code: string, text?: RegExp) => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      if (text) expect(p.error.message).toMatch(text);
    }
  };

  it("refuses an unknown action and lists the names, 1.x ones included", () => {
    refuses({ action: "nope" }, "INVALID_ARGUMENT", /one of state, getLines.*openFile/);
  });

  it("refuses a missing required param per action", () => {
    refuses({ action: "open" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "jump" }, "INVALID_ARGUMENT", /symbol/);
    refuses({ action: "setLine", line: 1 }, "INVALID_ARGUMENT", /text/);
    refuses({ action: "setLine", text: "x" }, "INVALID_ARGUMENT", /line/);
    refuses({ action: "insertLine", line: 1 }, "INVALID_ARGUMENT", /text/);
    refuses({ action: "removeLine" }, "INVALID_ARGUMENT", /line/);
    refuses({ action: "replaceRange", start: 0, count: 1 }, "INVALID_ARGUMENT", /lines/);
    refuses({ action: "replaceRange", start: 0, lines: [] }, "INVALID_ARGUMENT", /count/);
  });

  it("refuses a key the action does not take", () => {
    refuses({ action: "state", line: 1 }, "INVALID_ARGUMENT");
    refuses({ action: "getLines", confirm: true }, "INVALID_ARGUMENT");
    refuses({ action: "setLine", line: 1, text: "x", confirm: true }, "INVALID_ARGUMENT");
    refuses({ action: "save", line: 1 }, "INVALID_ARGUMENT");
    refuses({ action: "close", path: "a.c" }, "INVALID_ARGUMENT");
  });

  it("refuses negative lines and starts (lines are 0-based)", () => {
    refuses({ action: "setLine", line: -1, text: "x" }, "INVALID_ARGUMENT", /0 or more/);
    refuses({ action: "removeLine", line: -3 }, "INVALID_ARGUMENT", /0-based/);
    refuses({ action: "getLines", start: -1 }, "INVALID_ARGUMENT", /0-based/);
    refuses({ action: "replaceRange", start: -1, count: 0, lines: ["x"] }, "INVALID_ARGUMENT");
  });

  it("refuses non-integer lines and bad limits", () => {
    refuses({ action: "setLine", line: 1.5, text: "x" }, "INVALID_ARGUMENT");
    refuses({ action: "getLines", limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "getLines", limit: 201 }, "INVALID_ARGUMENT", /limit/);
  });

  it("refuses a text with a line break", () => {
    refuses({ action: "setLine", line: 1, text: "a\nb" }, "INVALID_ARGUMENT", /line break/);
    refuses({ action: "insertLine", line: 1, text: "a\rb" }, "INVALID_ARGUMENT", /line break/);
  });

  it("refuses a malformed cursor before sending", () => {
    refuses({ action: "getLines", cursor: "abc" }, "INVALID_ARGUMENT", /cursor/);
    refuses({ action: "getLines", cursor: "9:3" }, "INVALID_ARGUMENT", /past its count/);
  });

  it("checks replaceRange: counts, line breaks, expected length, empty edit", () => {
    refuses(
      { action: "replaceRange", start: 0, count: 201, lines: [] },
      "INVALID_ARGUMENT",
      /0 to 200/,
    );
    refuses(
      { action: "replaceRange", start: 0, count: 0, lines: new Array(RANGE_MAX + 1).fill("x") },
      "INVALID_ARGUMENT",
      /at most 200/,
    );
    refuses(
      { action: "replaceRange", start: 0, count: 0, lines: ["ok", "a\nb"] },
      "INVALID_ARGUMENT",
      /lines\[1\] holds a line break/,
    );
    refuses(
      { action: "replaceRange", start: 0, count: 1, lines: ["x"], expected: ["a", "b"] },
      "INVALID_ARGUMENT",
      /expected holds 2 lines, count is 1/,
    );
    refuses(
      { action: "replaceRange", start: 0, count: 1, lines: ["x"], expected: ["a\nb"] },
      "INVALID_ARGUMENT",
      /expected\[0\]/,
    );
    refuses(
      { action: "replaceRange", start: 3, count: 0, lines: [] },
      "INVALID_ARGUMENT",
      /nothing to replace/,
    );
  });

  it("checks the open path: relative, clean, .c", () => {
    refuses({ action: "open", path: "C:/x/a.c" }, "ABSOLUTE_PATH");
    refuses({ action: "open", path: "/Scripts/a.c" }, "ABSOLUTE_PATH");
    refuses({ action: "open", path: "Scripts/../a.c" }, "ABSOLUTE_PATH");
    refuses({ action: "open", path: "Scripts//a.c" }, "INVALID_ARGUMENT", /empty or '.' segment/);
    refuses({ action: "open", path: "Scripts/./a.c" }, "INVALID_ARGUMENT", /empty or '.' segment/);
    refuses({ action: "open", path: "Scripts/a.layer" }, "INVALID_ARGUMENT", /not a \.c script/);
    refuses({ action: "open", path: "" }, "INVALID_ARGUMENT");
  });

  it("checks the jump symbol: Class or Class.Member", () => {
    refuses({ action: "jump", symbol: "A.B.C" }, "INVALID_ARGUMENT", /Class or Class\.Member/);
    refuses({ action: "jump", symbol: "1Bad" }, "INVALID_ARGUMENT", /not a script identifier/);
    refuses({ action: "jump", symbol: "A." }, "INVALID_ARGUMENT", /not a script identifier/);
    refuses({ action: "jump", symbol: "x".repeat(257) }, "INVALID_ARGUMENT", /1 to 256/);
  });

  it("normalises a backslash path and passes a valid symbol", () => {
    const p = prepareRequest({ action: "open", path: "Scripts\\Game\\A.c" });
    expect(p.ok && p.params.path).toBe("Scripts/Game/A.c");
    const j = prepareRequest({ action: "jump", symbol: "SCR_Foo.Bar" });
    expect(j.ok).toBe(true);
  });

  it("sends confirm as a boolean on save and close, false by default", () => {
    const a = prepareRequest({ action: "save" });
    const b = prepareRequest({ action: "close", confirm: true });
    expect(a.ok && a.params.confirm).toBe(false);
    expect(b.ok && b.params.confirm).toBe(true);
  });

  it("marks mutating actions as such", () => {
    for (const [req, mutating] of [
      [{ action: "state" }, false],
      [{ action: "getLines" }, false],
      [{ action: "open", path: "a.c" }, true],
      [{ action: "jump", symbol: "A" }, true],
      [{ action: "removeLine", line: 0 }, true],
      [{ action: "save" }, true],
    ] as const) {
      const p = prepareRequest(req);
      expect(p.ok && p.mutating, req.action).toBe(mutating);
    }
  });
});

describe("oneBased (1.x callers)", () => {
  it("converts line and start before sending, with a warning", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ file: "a.c", line: 4, before: "o", after: "n" }),
    );
    const r = await runScriptEditor(client, {
      action: "setLine",
      line: 5,
      text: "n",
      oneBased: true,
    });
    expect(sent[0]!.params).toEqual({ action: "setLine", line: 4, text: "n" });
    expect(r.ok && r.warnings.join(" ")).toMatch(/line 5 was sent as 4/);
  });

  it("converts start for getLines and replaceRange, and line for insertLine and removeLine", async () => {
    const { client, sent } = fakeClient(() => ok());
    await runScriptEditor(client, { action: "getLines", start: 1, oneBased: true });
    await runScriptEditor(client, {
      action: "replaceRange",
      start: 10,
      count: 1,
      lines: ["x"],
      oneBased: true,
    });
    await runScriptEditor(client, { action: "insertLine", line: 1, text: "x", oneBased: true });
    await runScriptEditor(client, { action: "removeLine", line: 2, oneBased: true });
    expect(sent.map((s) => s.params.start ?? s.params.line)).toEqual([0, 9, 0, 1]);
    for (const s of sent) expect("oneBased" in s.params).toBe(false);
  });

  it("refuses 0 or less when counting from 1, and a flag on an action without lines", async () => {
    const { client, sent } = fakeClient(() => ok());
    const a = await runScriptEditor(client, {
      action: "setLine",
      line: 0,
      text: "x",
      oneBased: true,
    });
    const b = await runScriptEditor(client, { action: "state", oneBased: true });
    const c = await runScriptEditor(client, {
      action: "setLine",
      line: 1,
      text: "x",
      oneBased: "yes",
    });
    expect(!a.ok && a.code).toBe("INVALID_ARGUMENT");
    expect(!b.ok && b.message).toMatch(/does not apply/);
    expect(!c.ok && c.message).toMatch(/true or false/);
    expect(sent).toHaveLength(0);
  });

  it("oneBased: false is the default 0-based call", async () => {
    const { client, sent } = fakeClient(() => ok());
    await runScriptEditor(client, { action: "removeLine", line: 0, oneBased: false });
    expect(sent[0]!.params).toEqual({ action: "removeLine", line: 0 });
  });
});

describe("handler actions", () => {
  it("state: reads, answers the open file and warns outside the project", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        action: "state",
        opened: 1,
        file: "C:/x/Scripts/A.c",
        relPath: "Scripts/A.c",
        inProject: 0,
        line: 7,
        linesCount: 30,
        link: "enfusion://ScriptEditor/Scripts/A.c;7",
        mayHaveOpened: 1,
      }),
    );
    const r = await runScriptEditor(client, { action: "state" });
    expect(sent[0]!.fn).toBe("EMCP_WB_ScriptEditor");
    expect(sent[0]!.params).toEqual({ action: "state" });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBeNull();
    expect(r.readback).toMatchObject({
      opened: true,
      file: "C:/x/Scripts/A.c",
      relPath: "Scripts/A.c",
      inProject: false,
      line: 7,
      linesCount: 30,
      mayHaveOpened: true,
    });
    expect(r.warnings.join(" ")).toMatch(/outside the project/);
    expect(r.warnings.join(" ")).toMatch(/link is not yet proven/);
  });

  it("state: no file open is an ok answer that points at open", async () => {
    const { client } = fakeClient(() => ok({ opened: 0, file: "" }));
    const r = await runScriptEditor(client, { action: "state" });
    expect(r.ok && r.readback).toMatchObject({ opened: false, line: null });
    expect(r.ok && r.next).toMatch(/open/);
  });

  it("state: MODULE_NOT_OPEN refusal from the handler", async () => {
    const { client } = fakeClient(() =>
      refused("MODULE_NOT_OPEN", "the Script Editor is not open"),
    );
    const r = await runScriptEditor(client, { action: "state" });
    expect(!r.ok && r.code).toBe("MODULE_NOT_OPEN");
    expect(!r.ok && r.message).toMatch(/not open/);
  });

  it("getLines: sends start and limit, answers rows, total and the next cursor", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ start: 5, total: 40, rows: ["a", "b"], nextCursor: "7:40" }),
    );
    const r = await runScriptEditor(client, { action: "getLines", start: 5, limit: 2 });
    expect(sent[0]!.params).toEqual({ action: "getLines", start: 5, limit: 2 });
    expect(sent[0]!.options.access).toBe("read");
    expect(r.ok && r.readback).toMatchObject({
      start: 5,
      total: 40,
      rows: ["a", "b"],
      nextCursor: "7:40",
    });
    expect(r.ok && r.next).toMatch(/cursor "7:40"/);
  });

  it("getLines: the last page has no next cursor and no next hint", async () => {
    const { client } = fakeClient(() =>
      ok({ start: 38, total: 40, rows: ["y", "z"], nextCursor: "" }),
    );
    const r = await runScriptEditor(client, { action: "getLines", cursor: "38:40" });
    expect(r.ok && (r.readback as { nextCursor: unknown }).nextCursor).toBeNull();
    expect(r.ok && r.next).toBeUndefined();
  });

  it("getLines: a cursor rides to the handler and STALE_CURSOR maps through", async () => {
    const { client, sent } = fakeClient(() => refused("STALE_CURSOR", "the line count changed"));
    const r = await runScriptEditor(client, { action: "getLines", cursor: "100:250", limit: 50 });
    expect(sent[0]!.params).toEqual({ action: "getLines", cursor: "100:250", limit: 50 });
    expect(!r.ok && r.code).toBe("STALE_CURSOR");
  });

  it("getLines: NO_DOCUMENT maps through with the vocabulary next text", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NO_DOCUMENT",
      message: "no file is open in the Script Editor",
    }));
    const r = await runScriptEditor(client, { action: "getLines" });
    expect(!r.ok && r.code).toBe("NO_DOCUMENT");
    expect(!r.ok && r.next).toMatch(/open one first/);
  });

  it("open: sends the clean path as a mutating call and reads the answer", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ result: 1, file: "C:/x/A.c", relPath: "Scripts/A.c", inProject: 1, linesCount: 12 }),
    );
    const r = await runScriptEditor(client, { action: "open", path: "Scripts\\A.c" });
    expect(sent[0]!.params).toEqual({ action: "open", path: "Scripts/A.c" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok && r.target).toBe("path:Scripts/A.c");
    expect(r.ok && r.readback).toMatchObject({ result: true, inProject: true, linesCount: 12 });
  });

  it("open: PATH_NOT_FOUND and ENGINE_FALSE map through", async () => {
    const a = fakeClient(() => refused("PATH_NOT_FOUND", "no loaded addon holds it"));
    const r1 = await runScriptEditor(a.client, { action: "open", path: "Scripts/B.c" });
    expect(!r1.ok && r1.code).toBe("PATH_NOT_FOUND");
    const b = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "SetOpenedResource returned false",
      file: "C:/x/A.c",
      linesCount: 3,
    }));
    const r2 = await runScriptEditor(b.client, { action: "open", path: "Scripts/B.c" });
    expect(!r2.ok && r2.code).toBe("ENGINE_FALSE");
    expect(!r2.ok && r2.readback).toMatchObject({ file: "C:/x/A.c", linesCount: 3 });
  });

  it("jump: sends the symbol, answers file and caret line", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ result: 1, file: "C:/x/A.c", relPath: "Scripts/A.c", line: 41 }),
    );
    const r = await runScriptEditor(client, { action: "jump", symbol: "SCR_Foo.Bar" });
    expect(sent[0]!.params).toEqual({ action: "jump", symbol: "SCR_Foo.Bar" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok && r.target).toBe("symbol:SCR_Foo.Bar");
    expect(r.ok && r.readback).toMatchObject({ result: true, line: 41, relPath: "Scripts/A.c" });
  });

  it("jump: an unloaded class is ITEM_NOT_FOUND from the handler", async () => {
    const { client } = fakeClient(() => refused("ITEM_NOT_FOUND", "no script class Foo is loaded"));
    const r = await runScriptEditor(client, { action: "jump", symbol: "Foo" });
    expect(!r.ok && r.code).toBe("ITEM_NOT_FOUND");
  });

  it("setLine: sends 0-based line and text, answers the change with the old text", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        file: "C:/x/A.c",
        relPath: "Scripts/A.c",
        line: 0,
        before: "old",
        after: "new",
        linesCount: 9,
      }),
    );
    const r = await runScriptEditor(client, { action: "setLine", line: 0, text: "new" });
    expect(sent[0]!.params).toEqual({ action: "setLine", line: 0, text: "new" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok && r.changed).toEqual([{ path: "Scripts/A.c:0", before: "old", after: "new" }]);
    expect(r.ok && r.readback).toMatchObject({ line: 0, before: "old", after: "new" });
    expect(r.ok && r.next).toMatch(/restores it/);
    expect(r.ok && r.next).toMatch(/nothing is saved/);
    // P-W3-06 (W3 run 2): one Edit > Undo left the line empty; undo is not offered as the restore.
    expect(r.ok && r.warnings).toContain(UNDO_NOT_THE_RESTORE);
  });

  it("replaceRange: warns that Edit > Undo is not the restore (P-W3-06)", async () => {
    const { client } = fakeClient(() =>
      ok({ relPath: "Scripts/A.c", start: 0, removed: ["a"], rows: ["b"], linesCount: 9 }),
    );
    const r = await runScriptEditor(client, {
      action: "replaceRange",
      start: 0,
      count: 1,
      lines: ["b"],
      expected: ["a"],
    });
    expect(r.ok && r.warnings).toContain(UNDO_NOT_THE_RESTORE);
  });

  it("setLine: NOT_IN_PROJECT and out-of-range refusals map through", async () => {
    const a = fakeClient(() =>
      refused("NOT_IN_PROJECT", "the open file is not a file of the open project"),
    );
    const r1 = await runScriptEditor(a.client, { action: "setLine", line: 0, text: "x" });
    expect(!r1.ok && r1.code).toBe("NOT_IN_PROJECT");
    const b = fakeClient(() => refused("INVALID_ARGUMENT", "line 99 is out of range"));
    const r2 = await runScriptEditor(b.client, { action: "setLine", line: 99, text: "x" });
    expect(!r2.ok && r2.code).toBe("INVALID_ARGUMENT");
  });

  it("setLine: a readback that differs is ENGINE_FALSE and keeps before", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "did not read back",
      line: 3,
      before: "old",
      after: "odd",
    }));
    const r = await runScriptEditor(client, { action: "setLine", line: 3, text: "new" });
    expect(!r.ok && r.code).toBe("ENGINE_FALSE");
    expect(!r.ok && r.readback).toMatchObject({ line: 3, before: "old", after: "odd" });
  });

  it("insertLine: 0..linesCount, answers the read-back line", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ file: "a.c", relPath: "Scripts/A.c", line: 9, after: "// end", linesCount: 10 }),
    );
    const r = await runScriptEditor(client, { action: "insertLine", line: 9, text: "// end" });
    expect(sent[0]!.params).toEqual({ action: "insertLine", line: 9, text: "// end" });
    expect(r.ok && r.changed).toEqual([{ path: "Scripts/A.c:9", before: null, after: "// end" }]);
    expect(r.ok && r.next).toMatch(/removeLine/);
  });

  it("removeLine: answers the removed text to restore", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ file: "a.c", relPath: "Scripts/A.c", line: 2, before: "gone", linesCount: 8 }),
    );
    const r = await runScriptEditor(client, { action: "removeLine", line: 2 });
    expect(sent[0]!.params).toEqual({ action: "removeLine", line: 2 });
    expect(r.ok && r.changed).toEqual([{ path: "Scripts/A.c:2", before: "gone", after: null }]);
    expect(r.ok && r.next).toMatch(/insertLine with the before text/);
  });

  it("replaceRange: sends lines and expected, answers removed and rows", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        file: "a.c",
        relPath: "Scripts/A.c",
        start: 4,
        removed: ["a", "b"],
        rows: ["x"],
        linesCount: 7,
      }),
    );
    const r = await runScriptEditor(client, {
      action: "replaceRange",
      start: 4,
      count: 2,
      lines: ["x"],
      expected: ["a", "b"],
    });
    expect(sent[0]!.params).toEqual({
      action: "replaceRange",
      start: 4,
      count: 2,
      lines: ["x"],
      expected: ["a", "b"],
    });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok && r.changed).toEqual([
      { path: "Scripts/A.c:4", before: ["a", "b"], after: ["x"] },
    ]);
    expect(r.ok && r.readback).toMatchObject({
      start: 4,
      removed: ["a", "b"],
      rows: ["x"],
      linesCount: 7,
    });
  });

  it("replaceRange: count 0 inserts; empty lines deletes", async () => {
    const { client, sent } = fakeClient(() => ok({ start: 1, removed: [], rows: ["n1", "n2"] }));
    const a = await runScriptEditor(client, {
      action: "replaceRange",
      start: 1,
      count: 0,
      lines: ["n1", "n2"],
    });
    expect(a.ok).toBe(true);
    expect(sent[0]!.params.count).toBe(0);
    const d = fakeClient(() => ok({ start: 1, removed: ["z"], rows: [] }));
    const b = await runScriptEditor(d.client, {
      action: "replaceRange",
      start: 1,
      count: 1,
      lines: [],
    });
    expect(b.ok && b.changed).toEqual([{ path: "script:1", before: ["z"], after: [] }]);
  });

  it("replaceRange: TEXT_CHANGED maps through and nothing changed", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "TEXT_CHANGED",
      message: "line 5 is not the expected text; nothing was changed",
      next: "read the lines again (wb_script_editor getLines)",
    }));
    const r = await runScriptEditor(client, {
      action: "replaceRange",
      start: 5,
      count: 1,
      lines: ["x"],
      expected: ["stale"],
    });
    expect(!r.ok && r.code).toBe("TEXT_CHANGED");
    expect(!r.ok && r.next).toMatch(/getLines/);
  });

  it("replaceRange: a failed read-back keeps removed so the caller can restore", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "the replacement did not read back",
      start: 4,
      removed: ["a"],
      rows: ["odd"],
      linesCount: 6,
    }));
    const r = await runScriptEditor(client, {
      action: "replaceRange",
      start: 4,
      count: 1,
      lines: ["x"],
    });
    expect(!r.ok && r.readback).toMatchObject({
      start: 4,
      removed: ["a"],
      rows: ["odd"],
      linesCount: 6,
    });
  });

  it("save: without confirm is a dry run and says how to save", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        dryRun: 1,
        relPath: "Scripts/A.c",
        saved: 0,
        warnings: ["Save may also write other open tabs"],
      }),
    );
    const r = await runScriptEditor(client, { action: "save" });
    expect(sent[0]!.params).toEqual({ action: "save", confirm: false });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && r.readback).toMatchObject({
      dryRun: true,
      saved: false,
      relPath: "Scripts/A.c",
    });
    expect(r.ok && r.next).toMatch(/confirm: true/);
    expect(r.ok && r.warnings).toContain("Save may also write other open tabs");
  });

  it("save: confirm writes, answers saved and the change", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 0, relPath: "Scripts/A.c", saved: 1, warnings: ["other tabs"] }),
    );
    const r = await runScriptEditor(client, { action: "save", confirm: true });
    expect(sent[0]!.params).toEqual({ action: "save", confirm: true });
    expect(r.ok && r.changed).toEqual([
      { path: "Scripts/A.c", before: "unsaved edits", after: "saved" },
    ]);
    expect(r.ok && r.readback).toMatchObject({ dryRun: false, saved: true });
    expect(r.ok && r.next).toBeUndefined();
  });

  it("save: Save returning false is ENGINE_FALSE", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "Save returned false for Scripts/A.c",
      next: "read the Workbench log (logs_tail)",
    }));
    const r = await runScriptEditor(client, { action: "save", confirm: true });
    expect(!r.ok && r.code).toBe("ENGINE_FALSE");
    expect(!r.ok && r.next).toMatch(/logs_tail/);
  });

  it("close: the handler's GATED refusal maps through, sent as a mutating call", async () => {
    const { client, sent } = fakeClient(() =>
      refused(
        "GATED",
        "close waits for probe P-W3-04",
        "the owner closes the Script Editor by hand",
      ),
    );
    const r = await runScriptEditor(client, { action: "close", confirm: true });
    expect(sent[0]!.params).toEqual({ action: "close", confirm: true });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(!r.ok && r.code).toBe("GATED");
    expect(!r.ok && r.next).toMatch(/by hand/);
  });

  it("close: once the gate lifts, a dry run and a close are shaped", async () => {
    const dry = fakeClient(() => ok({ dryRun: 1, closed: 0 }));
    const r1 = await runScriptEditor(dry.client, { action: "close" });
    expect(r1.ok && r1.readback).toEqual({ dryRun: true, closed: false });
    expect(r1.ok && r1.next).toMatch(/confirm: true/);
    const real = fakeClient(() => ok({ dryRun: 0, closed: 1 }));
    const r2 = await runScriptEditor(real.client, { action: "close", confirm: true });
    expect(r2.ok && r2.readback).toEqual({ dryRun: false, closed: true });
  });
});

describe("handler answers and client failures", () => {
  it("an unknown handler code is kept as INVALID_ARGUMENT (refused) or ENGINE_FALSE (error) with a warning", async () => {
    const a = fakeClient(() => ({ status: "refused", code: "WHATEVER", message: "m" }));
    const r1 = await runScriptEditor(a.client, { action: "state" });
    expect(!r1.ok && r1.code).toBe("INVALID_ARGUMENT");
    expect(!r1.ok && r1.warnings.join(" ")).toMatch(/unknown code 'WHATEVER'/);
    const b = fakeClient(() => ({ status: "error", code: "", message: "m" }));
    const r2 = await runScriptEditor(b.client, { action: "state" });
    expect(!r2.ok && r2.code).toBe("ENGINE_FALSE");
  });

  it("an unreadable status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "weird" }));
    const r = await runScriptEditor(client, { action: "state" });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });

  it("maps WorkbenchError LOST, MODAL_OPEN and WEDGED, and plain failures", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client } = fakeClient(() => new WorkbenchError(`x ${code}`, code));
      const r = await runScriptEditor(client, { action: "setLine", line: 0, text: "x" });
      expect(!r.ok && r.code, code).toBe(code);
    }
    const lost = fakeClient(() => new WorkbenchError("gone", "LOST"));
    const rl = await runScriptEditor(lost.client, { action: "removeLine", line: 0 });
    expect(!rl.ok && rl.next).toMatch(/never retried; read back with wb_script_editor getLines/);
    const plain = fakeClient(() => new Error("ECONNREFUSED"));
    const rp = await runScriptEditor(plain.client, { action: "state" });
    expect(!rp.ok && rp.code).toBe("UNREACHABLE");
  });

  it("sends nothing when the request is refused", async () => {
    const { client, sent } = fakeClient(() => ok());
    await runScriptEditor(client, { action: "setLine", line: -1, text: "x" });
    await runScriptEditor(client, { action: "open", path: "C:/a.c" });
    await runScriptEditor(client, { action: "bogus" });
    expect(sent).toHaveLength(0);
  });
});

describe("1.x names", () => {
  it("getCurrentFile maps to state and answers currentFile", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ opened: 1, file: "C:/x/A.c", relPath: "A.c", inProject: 1, line: 0, linesCount: 5 }),
    );
    const r = await runScriptEditor(client, { action: "getCurrentFile" });
    expect(sent[0]!.params).toEqual({ action: "state" });
    expect(r.ok && r.action).toBe("getCurrentFile");
    expect(r.ok && r.readback).toMatchObject({ currentFile: "C:/x/A.c", linesCount: 5 });
    expect(r.ok && r.warnings[0]).toMatch(/1\.x action name 'getCurrentFile': sent as state/);
  });

  it("getCurrentFile with no file open says so", async () => {
    const { client } = fakeClient(() => ok({ opened: 0, file: "" }));
    const r = await runScriptEditor(client, { action: "getCurrentFile" });
    expect(r.ok && r.readback).toMatchObject({ currentFile: "(no file open)", opened: false });
  });

  it("getLinesCount maps to state and answers only the count; no file is NO_DOCUMENT", async () => {
    const a = fakeClient(() => ok({ opened: 1, file: "A.c", linesCount: 42 }));
    const r1 = await runScriptEditor(a.client, { action: "getLinesCount" });
    expect(a.sent[0]!.params).toEqual({ action: "state" });
    expect(r1.ok && r1.readback).toEqual({ linesCount: 42 });
    const b = fakeClient(() => ok({ opened: 0 }));
    const r2 = await runScriptEditor(b.client, { action: "getLinesCount" });
    expect(!r2.ok && r2.code).toBe("NO_DOCUMENT");
  });

  it("getLine is 1-based: line 1 reads handler line 0, one row", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ start: 0, total: 3, rows: ["first"], nextCursor: "1:3" }),
    );
    const r = await runScriptEditor(client, { action: "getLine", line: 1 });
    expect(sent[0]!.params).toEqual({ action: "getLines", start: 0, limit: 1 });
    expect(r.ok && r.readback).toEqual({ line: 1, lineText: "first", total: 3 });
    expect(r.ok && r.warnings.join(" ")).toMatch(/1-based/);
  });

  it("getLine past the end is refused, not an empty line", async () => {
    const { client } = fakeClient(() => ok({ start: 3, total: 3, rows: [], nextCursor: "" }));
    const r = await runScriptEditor(client, { action: "getLine", line: 4 });
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
    expect(!r.ok && r.message).toMatch(/past the end.*3 lines/);
  });

  it("getLine refuses line 0 and a missing line before sending", async () => {
    const { client, sent } = fakeClient(() => ok());
    const a = await runScriptEditor(client, { action: "getLine", line: 0 });
    const b = await runScriptEditor(client, { action: "getLine" });
    expect(!a.ok && a.code).toBe("INVALID_ARGUMENT");
    expect(!b.ok && b.code).toBe("INVALID_ARGUMENT");
    expect(sent).toHaveLength(0);
  });

  it("getLine carries a handler refusal under the 1.x name", async () => {
    const { client } = fakeClient(() => refused("NO_DOCUMENT", "no file is open"));
    const r = await runScriptEditor(client, { action: "getLine", line: 2 });
    expect(!r.ok && r.code).toBe("NO_DOCUMENT");
    expect(!r.ok && r.action).toBe("getLine");
    expect(!r.ok && r.warnings[0]).toMatch(/1\.x action name 'getLine'/);
  });

  it("openFile maps to open", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ result: 1, file: "C:/x/A.c", relPath: "Scripts/A.c", inProject: 1, linesCount: 5 }),
    );
    const r = await runScriptEditor(client, { action: "openFile", path: "Scripts/A.c" });
    expect(sent[0]!.params).toEqual({ action: "open", path: "Scripts/A.c" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r.ok && r.action).toBe("openFile");
    expect(r.ok && r.warnings[0]).toMatch(/sent as open/);
  });

  it("openFile applies the open path checks and keeps the 1.x name on the refusal", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runScriptEditor(client, { action: "openFile", path: "C:/x/A.c" });
    expect(!r.ok && r.code).toBe("ABSOLUTE_PATH");
    expect(!r.ok && r.action).toBe("openFile");
    const r2 = await runScriptEditor(client, { action: "openFile" });
    expect(!r2.ok && r2.code).toBe("INVALID_ARGUMENT");
    expect(sent).toHaveLength(0);
  });

  it("the 1.x names refuse keys they never took", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runScriptEditor(client, { action: "getCurrentFile", line: 1 });
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
    expect(sent).toHaveLength(0);
  });
});

// Census rows this file tests (W3 close-out, EV-W3-099).
// census:mcp:action/wb_script_editor.getCurrentFile
// census:mcp:action/wb_script_editor.getLine
// census:mcp:action/wb_script_editor.getLines
// census:mcp:action/wb_script_editor.getLinesCount
// census:mcp:action/wb_script_editor.insertLine
// census:mcp:action/wb_script_editor.jump
// census:mcp:action/wb_script_editor.open
// census:mcp:action/wb_script_editor.openFile
// census:mcp:action/wb_script_editor.removeLine
// census:mcp:action/wb_script_editor.replaceRange
// census:mcp:action/wb_script_editor.setLine
// census:mcp:action/wb_script_editor.state
