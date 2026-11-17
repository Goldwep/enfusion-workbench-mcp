import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  AUTHOR_WARNING,
  GATED_ACTIONS,
  HANDLER,
  HANDLER_ACTIONS,
  LEGACY_ACTIONS,
  LOCALIZATION_CONTRACT,
  checkTablePath,
  flatInputShape,
  languagesOf,
  normalizeLegacy,
  parseColumns,
  prepareRequest,
  runLocalization,
  splitRow,
  wbLocalizationDescription,
  type LocalizationClient,
} from "../../src/tools/wb-localization.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(
  answer: (p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
): { client: LocalizationClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as LocalizationClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "no", next = "do this") => ({
  status: "refused",
  code,
  message,
  next,
});

describe("wb_localization contract", () => {
  it("loads, and its description fits the 400-char budget", () => {
    expect(LOCALIZATION_CONTRACT.tool).toBe("wb_localization");
    expect(HANDLER).toBe("EMCP_WB_Localization");
    expect(wbLocalizationDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("declares the 13 actions", () => {
    expect([...HANDLER_ACTIONS]).toEqual([
      "status",
      "columns",
      "list",
      "get",
      "selection",
      "open",
      "insert",
      "set",
      "delete",
      "filter",
      "save",
      "buildRuntime",
      "close",
    ]);
  });

  it("takes buildRuntime and close as GATED from the contract", () => {
    expect([...GATED_ACTIONS]).toEqual(["buildRuntime", "close"]);
  });

  it("gives registerTool a flat shape with every param key, arrays, and the 1.x names", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "path",
      "id",
      "index",
      "fields",
      "values",
      "prefix",
      "column",
      "filter",
      "cursor",
      "limit",
      "confirm",
      "itemId",
      "property",
      "value",
    ])
      expect(shape[k], k).toBeDefined();
    const action = shape.action as unknown as { options: string[] };
    for (const a of LEGACY_ACTIONS) expect(action.options).toContain(a);
    expect(shape.fields!.safeParse(["Id", "Target_en_us"]).success).toBe(true);
  });
});

describe("rows", () => {
  it("splits on an unescaped pipe and unescapes the cells", () => {
    expect(splitRow("3|a\\|b|c\\\\d|x\\ny\\rz")).toEqual(["3", "a|b", "c\\d", "x\ny\rz"]);
    expect(splitRow("")).toEqual([""]);
    expect(splitRow("a|")).toEqual(["a", ""]);
  });

  it("parses column rows with enum pairs and derives the language names", () => {
    const cols = parseColumns([
      "Id|STRING|",
      "Status|INTEGER|DEVELOPMENT_PENDING=0,TRANSLATION_PENDING=1",
      "Target_en_us|STRING|",
      "Target_en_us_edited|STRING|",
      "Target_fr_fr|STRING|",
    ]);
    expect(cols[1]).toEqual({
      name: "Status",
      type: "INTEGER",
      enums: ["DEVELOPMENT_PENDING=0", "TRANSLATION_PENDING=1"],
    });
    expect(languagesOf(cols)).toEqual(["en_us", "fr_fr"]);
  });
});

describe("checkTablePath", () => {
  it("accepts a plain or {GUID} .st path and normalises slashes", () => {
    expect(checkTablePath("Configs/Loc/Table.st")).toBe("Configs/Loc/Table.st");
    expect(checkTablePath("Configs\\Loc\\Table.ST")).toBe("Configs/Loc/Table.ST");
    expect(checkTablePath("{0123456789ABCDEF}Configs/Table.st")).toBe(
      "{0123456789ABCDEF}Configs/Table.st",
    );
  });

  it("refuses absolute forms and other file types", () => {
    for (const p of ["C:/x/Table.st", "/Table.st", "a/../Table.st", "$profile:Table.st"]) {
      expect(() => checkTablePath(p), p).toThrow(/absolute|\.\./);
    }
    expect(() => checkTablePath("Configs/Table.conf")).toThrow(/\.st/);
    expect(() => checkTablePath("")).toThrow();
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["unknown action", { action: "nope" }],
    ["stray key", { action: "status", id: "x" }],
    ["open without path", { action: "open" }],
    ["open a .conf", { action: "open", path: "a/b.conf" }],
    ["limit 0", { action: "list", limit: 0 }],
    ["limit over max", { action: "list", limit: 201 }],
    ["bad cursor", { action: "list", cursor: "abc" }],
    ["cursor start past count", { action: "list", cursor: "9:3" }],
    ["list field twice", { action: "list", fields: ["Id", "Id"] }],
    ["list empty field name", { action: "list", fields: ["Id", " "] }],
    ["get with neither id nor index", { action: "get" }],
    ["get empty id", { action: "get", id: "" }],
    ["get negative index", { action: "get", index: -1 }],
    ["set missing fields", { action: "set", id: "A", values: ["x"] }],
    ["set missing target", { action: "set", fields: ["Target_en_us"], values: ["x"] }],
    ["set length mismatch", { action: "set", id: "A", fields: ["A", "B"], values: ["x"] }],
    ["set no fields", { action: "set", id: "A", fields: [], values: [] }],
    ["set field twice", { action: "set", id: "A", fields: ["A", "A"], values: ["x", "y"] }],
    ["set new Id empty", { action: "set", id: "A", fields: ["Id"], values: [""] }],
    ["delete with neither", { action: "delete" }],
    ["insert without id", { action: "insert" }],
    ["insert blank id", { action: "insert", id: "  " }],
    ["insert id with line break", { action: "insert", id: "A\nB" }],
    ["insert Id as a field", { action: "insert", id: "A", fields: ["Id"], values: ["B"] }],
    ["insert length mismatch", { action: "insert", id: "A", fields: ["X"], values: [] }],
    ["filter without text", { action: "filter", column: "Id" }],
    ["filter empty text", { action: "filter", column: "Id", filter: "" }],
    ["filter blank column", { action: "filter", column: " ", filter: "a" }],
    ["confirm not a bool", { action: "save", confirm: "yes" }],
    ["buildRuntime (gated)", { action: "buildRuntime", confirm: true }],
    ["close (gated)", { action: "close" }],
  ];

  for (const [name, input] of bad) {
    it(`refuses: ${name}`, () => {
      const p = prepareRequest(input);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.error.ok).toBe(false);
    });
  }

  it("codes: INVALID_ARGUMENT for a bad value, ABSOLUTE_PATH for an absolute path, GATED for a gated action", () => {
    const code = (i: Record<string, unknown>) => {
      const p = prepareRequest(i);
      return p.ok ? "ok" : p.error.code;
    };
    expect(code({ action: "get" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "open", path: "C:/x/a.st" })).toBe("ABSOLUTE_PATH");
    expect(code({ action: "open", path: "a/../b.st" })).toBe("ABSOLUTE_PATH");
    expect(code({ action: "list", cursor: "abc" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "buildRuntime" })).toBe("GATED");
    expect(code({ action: "close", confirm: true })).toBe("GATED");
  });

  it("a gated refusal names the contract's reason and the offline route", () => {
    const p = prepareRequest({ action: "buildRuntime" });
    expect(!p.ok && p.error.message).toContain("P-W3-18");
    expect(!p.ok && p.error.next).toContain("string_table buildRuntime");
    const c = prepareRequest({ action: "close" });
    expect(!c.ok && c.error.message).toContain("P-W3-19");
  });

  it("marks reads and writes, and sends confirm as a bool for save", () => {
    const read = prepareRequest({ action: "list" });
    expect(read.ok && read.mutating).toBe(false);
    const dry = prepareRequest({ action: "save" });
    expect(dry.ok && dry.mutating).toBe(true);
    expect(dry.ok && dry.params).toMatchObject({ confirm: false });
    const yes = prepareRequest({ action: "save", confirm: true });
    expect(yes.ok && yes.params).toMatchObject({ confirm: true });
  });

  it("sends open's path with its {GUID} kept and slashes normalised", () => {
    const p = prepareRequest({ action: "open", path: "{0123456789ABCDEF}Configs\\T.st" });
    expect(p.ok && p.params.path).toBe("{0123456789ABCDEF}Configs/T.st");
    expect(p.ok && p.target).toBe("path:{0123456789ABCDEF}Configs/T.st");
  });

  it("accepts an index alone, an id alone, or both for get, set and delete", () => {
    expect(prepareRequest({ action: "get", index: 0 }).ok).toBe(true);
    expect(prepareRequest({ action: "get", id: "A" }).ok).toBe(true);
    expect(prepareRequest({ action: "delete", id: "A", index: 2 }).ok).toBe(true);
    expect(prepareRequest({ action: "set", index: 1, fields: ["X"], values: [""] }).ok).toBe(true);
  });

  it("accepts a set that renames through the Id field", () => {
    expect(prepareRequest({ action: "set", id: "A", fields: ["Id"], values: ["B"] }).ok).toBe(true);
  });

  it("the Id and given-twice tests fold case (review W3-LOC-4)", () => {
    const why = (i: Record<string, unknown>) => {
      const p = prepareRequest(i);
      return p.ok ? "ok" : p.error.message;
    };
    expect(why({ action: "insert", id: "N", fields: ["id"], values: ["X"] })).toMatch(
      /the Id is given by id/,
    );
    expect(why({ action: "set", id: "A", fields: ["ID"], values: [""] })).toMatch(
      /new Id is empty/,
    );
    expect(why({ action: "set", id: "A", fields: ["Comment", "comment"], values: ["a", "b"] })).toMatch(
      /given twice/,
    );
  });
});

describe("reads", () => {
  it("status answers table, class and count, and sends read access", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        table: "Loc/T.st",
        inProject: 1,
        itemClass: "CustomStringTableItem",
        total: 12,
        message: "table StringTable with 12 items",
      }),
    );
    const r = await runLocalization(client, { action: "status" });
    expect(r).toMatchObject({
      ok: true,
      action: "status",
      changed: null,
      readback: {
        table: "Loc/T.st",
        inProject: true,
        itemClass: "CustomStringTableItem",
        total: 12,
      },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.fn).toBe("EMCP_WB_Localization");
    expect(sent[0]!.options.access).toBe("read");
    expect(sent[0]!.params).toEqual({ action: "status" });
  });

  it("status with no table known answers null and not in project", async () => {
    const { client } = fakeClient(() => ok({ table: "", inProject: 0, total: 0 }));
    const r = await runLocalization(client, { action: "status" });
    expect(r.ok && r.readback).toMatchObject({ table: null, inProject: false, itemClass: null });
  });

  it("columns parses name|type|enums", async () => {
    const { client } = fakeClient(() =>
      ok({
        itemClass: "CustomStringTableItem",
        columns: ["Id|STRING|", "Status|INTEGER|DEVELOPMENT_PENDING=0,TRANSLATION_PENDING=1"],
      }),
    );
    const r = await runLocalization(client, { action: "columns" });
    expect(r.ok && r.readback).toEqual({
      itemClass: "CustomStringTableItem",
      columns: [
        { name: "Id", type: "STRING", enums: [] },
        {
          name: "Status",
          type: "INTEGER",
          enums: ["DEVELOPMENT_PENDING=0", "TRANSLATION_PENDING=1"],
        },
      ],
    });
  });

  it("list sends its paging keys and turns rows into objects keyed by column", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        columns: ["index", "Id", "Target_en_us"],
        rows: ["0|A.B|Hello", "1|A.C|a\\|b\\nline"],
        total: 130,
        nextCursor: "2:130",
      }),
    );
    const r = await runLocalization(client, {
      action: "list",
      fields: ["Id", "Target_en_us"],
      prefix: "A.",
      cursor: "0:130",
      limit: 2,
    });
    expect(sent[0]!.params).toEqual({
      action: "list",
      fields: ["Id", "Target_en_us"],
      prefix: "A.",
      cursor: "0:130",
      limit: 2,
    });
    expect(r.ok && r.readback).toEqual({
      columns: ["index", "Id", "Target_en_us"],
      total: 130,
      rows: [
        { index: 0, Id: "A.B", Target_en_us: "Hello" },
        { index: 1, Id: "A.C", Target_en_us: "a|b\nline" },
      ],
      nextCursor: "2:130",
    });
    expect(r.ok && r.next).toContain('cursor "2:130"');
  });

  it("list on the last page has no nextCursor and no next", async () => {
    const { client } = fakeClient(() =>
      ok({ columns: ["index", "Id"], rows: ["0|A"], total: 1, nextCursor: "" }),
    );
    const r = await runLocalization(client, { action: "list" });
    expect(r.ok && r.readback).toMatchObject({ nextCursor: null });
    expect(r.ok && r.next).toBeUndefined();
  });

  it("list walks pages by the cursor the handler answered", async () => {
    const { client, sent } = fakeClient((p) =>
      p.cursor === undefined
        ? ok({ columns: ["index", "Id"], rows: ["0|A", "1|B"], total: 3, nextCursor: "2:3" })
        : ok({ columns: ["index", "Id"], rows: ["2|C"], total: 3, nextCursor: "" }),
    );
    const first = await runLocalization(client, { action: "list", limit: 2 });
    const cursor = first.ok ? (first.readback as { nextCursor: string }).nextCursor : "";
    const second = await runLocalization(client, { action: "list", limit: 2, cursor });
    expect(sent[1]!.params.cursor).toBe("2:3");
    expect(second.ok && (second.readback as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("list maps a STALE_CURSOR refusal", async () => {
    const { client } = fakeClient(() =>
      refused("STALE_CURSOR", "the table changed", "read again without a cursor"),
    );
    const r = await runLocalization(client, { action: "list", cursor: "2:3" });
    expect(r).toMatchObject({
      ok: false,
      code: "STALE_CURSOR",
      next: "read again without a cursor",
    });
  });

  it("get answers the item's fields by id or by index", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: "A.B",
        index: 4,
        rows: ["Id|STRING|A.B", "Target_en_us|STRING|x\\|y", "Status|INTEGER|0"],
      }),
    );
    const r = await runLocalization(client, { action: "get", id: "A.B" });
    expect(sent[0]!.params).toEqual({ action: "get", id: "A.B" });
    expect(r.ok && r.readback).toEqual({
      id: "A.B",
      index: 4,
      fields: [
        { name: "Id", type: "STRING", value: "A.B" },
        { name: "Target_en_us", type: "STRING", value: "x|y" },
        { name: "Status", type: "INTEGER", value: "0" },
      ],
    });
    const byIndex = fakeClient(() => ok({ id: "Z", index: 0, rows: [] }));
    await runLocalization(byIndex.client, { action: "get", index: 0 });
    expect(byIndex.sent[0]!.params).toEqual({ action: "get", index: 0 });
  });

  it("get maps ITEM_NOT_FOUND and DUPLICATE_ID", async () => {
    for (const code of ["ITEM_NOT_FOUND", "DUPLICATE_ID"]) {
      const { client } = fakeClient(() => refused(code));
      expect(await runLocalization(client, { action: "get", id: "A" })).toMatchObject({
        ok: false,
        code,
        next: "do this",
      });
    }
  });

  it("selection answers the selected and filtered rows", async () => {
    const { client } = fakeClient(() => ok({ selected: [1, 2], filtered: [0, 1, 2, 3] }));
    const r = await runLocalization(client, { action: "selection" });
    expect(r.ok && r.readback).toEqual({ selected: [1, 2], filtered: [0, 1, 2, 3] });
  });

  it("a read with no table open maps NO_DOCUMENT (a code vocabulary.ts does not carry yet)", async () => {
    const { client } = fakeClient(() =>
      refused("NO_DOCUMENT", "no string table is open", "wb_localization open <path>.st"),
    );
    const r = await runLocalization(client, { action: "list" });
    expect(r).toMatchObject({
      ok: false,
      code: "NO_DOCUMENT",
      next: "wb_localization open <path>.st",
    });
  });
});

describe("open", () => {
  it("opens a .st through the handler as a mutating call and reads the answer", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ result: 1, table: "Loc/T.st", inProject: 1, total: 7 }),
    );
    const r = await runLocalization(client, { action: "open", path: "Loc\\T.st" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(sent[0]!.params).toEqual({ action: "open", path: "Loc/T.st" });
    expect(r).toMatchObject({
      ok: true,
      target: "path:Loc/T.st",
      changed: null,
      readback: { opened: true, table: "Loc/T.st", inProject: true, total: 7 },
    });
  });

  it("maps the handler's MODAL_HAZARD refusal over an unsaved table", async () => {
    const { client } = fakeClient(() =>
      refused("MODAL_HAZARD", "2 handler edit(s) are not saved", "save, then open again"),
    );
    expect(await runLocalization(client, { action: "open", path: "Loc/T.st" })).toMatchObject({
      ok: false,
      code: "MODAL_HAZARD",
      next: "save, then open again",
    });
  });

  it("maps ENGINE_FALSE (status error) when SetOpenedResource is false", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "SetOpenedResource returned false",
      next: "check the path",
      result: 0,
    }));
    expect(await runLocalization(client, { action: "open", path: "Loc/T.st" })).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
    });
  });
});

describe("insert", () => {
  const inserted = () =>
    ok({
      id: "A.NEW",
      index: 12,
      total: 13,
      after: ["Id|A.NEW", "Target_en_us|Hello\\|there"],
      warnings: ["the engine's SCR_LocModifiedPlugin writes the Workbench user name into Author"],
    });

  it("sends id, fields and values as mutate and reads the item back", async () => {
    const { client, sent } = fakeClient(inserted);
    const r = await runLocalization(client, {
      action: "insert",
      id: "A.NEW",
      fields: ["Target_en_us"],
      values: ["Hello|there"],
    });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(sent[0]!.params).toEqual({
      action: "insert",
      id: "A.NEW",
      fields: ["Target_en_us"],
      values: ["Hello|there"],
    });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "Items[12]", before: null, after: "A.NEW" }],
      readback: {
        id: "A.NEW",
        index: 12,
        total: 13,
        after: [
          { name: "Id", value: "A.NEW" },
          { name: "Target_en_us", value: "Hello|there" },
        ],
      },
    });
    // The handler's own Author warning is kept once, not doubled.
    expect(r.warnings.filter((w) => /Author/.test(w))).toHaveLength(1);
  });

  it("adds the Author warning when the handler left it out", async () => {
    const { client } = fakeClient(() => ok({ id: "A", index: 0, total: 1, after: ["Id|A"] }));
    const r = await runLocalization(client, { action: "insert", id: "A" });
    expect(r.warnings).toContain(AUTHOR_WARNING);
  });

  it("an id-only insert sends no fields", async () => {
    const { client, sent } = fakeClient(() => ok({ id: "A", index: 0, total: 1, after: ["Id|A"] }));
    await runLocalization(client, { action: "insert", id: "A" });
    expect(sent[0]!.params).toEqual({ action: "insert", id: "A" });
  });

  it("maps DUPLICATE_ID and MODAL_HAZARD refusals", async () => {
    for (const code of ["DUPLICATE_ID", "MODAL_HAZARD"]) {
      const { client } = fakeClient(() => refused(code, `${code} text`, "step"));
      const r = await runLocalization(client, {
        action: "insert",
        id: "A",
        fields: ["Target_en_us"],
        values: ["x"],
      });
      expect(r).toMatchObject({ ok: false, code, message: `${code} text`, next: "step" });
    }
  });

  it("a read-back mismatch (status error) keeps what the handler saw", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "inserted 'A' but Target_en_us reads back ''",
      next: "wb_localization get, then set",
      id: "A",
      index: 3,
      after: ["Id|A", "Target_en_us|"],
    }));
    const r = await runLocalization(client, {
      action: "insert",
      id: "A",
      fields: ["Target_en_us"],
      values: ["x"],
    });
    expect(r).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
      readback: { id: "A", index: 3, after: ["Id|A", "Target_en_us|"] },
    });
  });

  it("sends nothing when the fields are refused in TypeScript", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runLocalization(client, {
      action: "insert",
      id: "A",
      fields: ["Id"],
      values: ["B"],
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });
});

describe("set", () => {
  const setAnswer = () =>
    ok({
      id: "A.B",
      index: 3,
      before: ["Target_en_us|old", "Comment|"],
      after: ["Target_en_us|new\\nline", "Comment|c"],
    });

  it("sends by id and answers one change per field with before and after", async () => {
    const { client, sent } = fakeClient(setAnswer);
    const r = await runLocalization(client, {
      action: "set",
      id: "A.B",
      fields: ["Target_en_us", "Comment"],
      values: ["new\nline", "c"],
    });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(sent[0]!.params).toEqual({
      action: "set",
      id: "A.B",
      fields: ["Target_en_us", "Comment"],
      values: ["new\nline", "c"],
    });
    expect(r).toMatchObject({
      ok: true,
      changed: [
        { path: "A.B.Target_en_us", before: "old", after: "new\nline" },
        { path: "A.B.Comment", before: "", after: "c" },
      ],
      readback: { id: "A.B", index: 3 },
    });
    expect(r.warnings).toContain(AUTHOR_WARNING);
    expect(r.ok && r.next).toContain("save");
  });

  it("sends by index", async () => {
    const { client, sent } = fakeClient(setAnswer);
    await runLocalization(client, { action: "set", index: 3, fields: ["X"], values: ["y"] });
    expect(sent[0]!.params).toEqual({ action: "set", index: 3, fields: ["X"], values: ["y"] });
  });

  it("maps a MODAL_HAZARD refusal and sends the call only once", async () => {
    const { client, sent } = fakeClient(() =>
      refused("MODAL_HAZARD", "SCR_LocStatusPlugin would open a dialog; nothing was changed"),
    );
    const r = await runLocalization(client, {
      action: "set",
      id: "A",
      fields: ["Target_en_us"],
      values: ["x"],
    });
    expect(r).toMatchObject({ ok: false, code: "MODAL_HAZARD" });
    expect(sent).toHaveLength(1);
  });

  it("maps UNSUPPORTED_TYPE, ITEM_NOT_FOUND and DUPLICATE_ID", async () => {
    for (const code of ["UNSUPPORTED_TYPE", "ITEM_NOT_FOUND", "DUPLICATE_ID"]) {
      const { client } = fakeClient(() => refused(code, `${code} text`, "handler next"));
      const r = await runLocalization(client, {
        action: "set",
        id: "A",
        fields: ["X"],
        values: ["y"],
      });
      expect(r).toMatchObject({ ok: false, code, next: "handler next" });
    }
  });

  it("an unknown handler code falls back and says so", async () => {
    const { client } = fakeClient(() => refused("SOMETHING_NEW"));
    const r = await runLocalization(client, { action: "get", index: 0 });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(r.warnings.join(" ")).toContain("SOMETHING_NEW");
  });
});

describe("delete", () => {
  it("answers the removed item and a ready insert to put it back", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        id: "A.B",
        index: 2,
        total: 9,
        before: ["Id|A.B", "Target_en_us|x\\|y", "Status|0"],
      }),
    );
    const r = await runLocalization(client, { action: "delete", id: "A.B" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(sent[0]!.params).toEqual({ action: "delete", id: "A.B" });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "Items[2]", before: "A.B", after: null }],
      readback: {
        id: "A.B",
        index: 2,
        total: 9,
        removed: [
          { name: "Id", value: "A.B" },
          { name: "Target_en_us", value: "x|y" },
          { name: "Status", value: "0" },
        ],
        restore: {
          action: "insert",
          id: "A.B",
          fields: ["Target_en_us", "Status"],
          values: ["x|y", "0"],
        },
      },
    });
  });

  it("maps DUPLICATE_ID when two items share the Id", async () => {
    const { client } = fakeClient(() => refused("DUPLICATE_ID", "2 items share Id 'A'"));
    expect(await runLocalization(client, { action: "delete", id: "A" })).toMatchObject({
      ok: false,
      code: "DUPLICATE_ID",
    });
  });

  it("a delete the table did not take is an ENGINE_FALSE error", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "after DeleteItem the table holds 9 items",
      next: "wb_localization list",
    }));
    expect(await runLocalization(client, { action: "delete", id: "A" })).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
    });
  });
});

describe("filter", () => {
  it("sends column and filter as mutate and answers the filtered rows", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ filtered: [2, 5], message: "2 item(s) matched" }),
    );
    const r = await runLocalization(client, { action: "filter", column: "Id", filter: "HUD" });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(sent[0]!.params).toEqual({ action: "filter", column: "Id", filter: "HUD" });
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { filtered: [2, 5], message: "2 item(s) matched" },
    });
  });

  it("maps ITEM_NOT_FOUND when nothing matches", async () => {
    const { client } = fakeClient(() => refused("ITEM_NOT_FOUND", "no item's Id contains 'x'"));
    expect(
      await runLocalization(client, { action: "filter", column: "Id", filter: "x" }),
    ).toMatchObject({ ok: false, code: "ITEM_NOT_FOUND" });
  });
});

describe("save", () => {
  it("a dry run carries the Author/LastChanged warning even when the handler left it out", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, table: "Loc/T.st", message: "dry run: would save Loc/T.st", warnings: [] }),
    );
    const r = await runLocalization(client, { action: "save" });
    expect(sent[0]!.params).toEqual({ action: "save", confirm: false });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { dryRun: true, table: "Loc/T.st" },
    });
    expect(r.warnings).toContain(AUTHOR_WARNING);
    expect(AUTHOR_WARNING).toMatch(/Author and LastChanged/);
    expect(r.ok && r.next).toContain("confirm: true");
  });

  it("a dry run keeps the handler's own warnings and does not double the Author one", async () => {
    const { client } = fakeClient(() =>
      ok({
        dryRun: true,
        table: "Loc/T.st",
        warnings: [
          "the saved file keeps the Workbench user name SCR_LocModifiedPlugin wrote into Author and LastChanged",
          "the Localization Editor plugins' OnSave runs on save",
        ],
      }),
    );
    const r = await runLocalization(client, { action: "save" });
    expect(r.warnings.filter((w) => /Author/.test(w))).toHaveLength(1);
    expect(r.warnings.some((w) => /OnSave/.test(w))).toBe(true);
  });

  it("a confirmed save answers saved and the path, with the Author warning", async () => {
    const { client, sent } = fakeClient(() => ok({ dryRun: 0, saved: 1, table: "Loc/T.st" }));
    const r = await runLocalization(client, { action: "save", confirm: true });
    expect(sent[0]!.params).toEqual({ action: "save", confirm: true });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "Loc/T.st", before: null, after: "saved" }],
      readback: { saved: true, table: "Loc/T.st" },
    });
    expect(r.warnings).toContain(AUTHOR_WARNING);
  });

  it("maps NO_DOCUMENT, NOT_IN_PROJECT and SAVE_FAILED", async () => {
    for (const code of ["NO_DOCUMENT", "NOT_IN_PROJECT", "SAVE_FAILED"]) {
      const status = code === "SAVE_FAILED" ? "error" : "refused";
      const { client } = fakeClient(() => ({ status, code, message: `${code} text`, next: "n" }));
      expect(await runLocalization(client, { action: "save", confirm: true })).toMatchObject({
        ok: false,
        code,
        message: `${code} text`,
      });
    }
  });
});

describe("gated actions", () => {
  it("buildRuntime and close are refused GATED and nothing is sent", async () => {
    for (const input of [
      { action: "buildRuntime" },
      { action: "buildRuntime", confirm: true },
      { action: "close" },
      { action: "close", confirm: true },
    ]) {
      const { client, sent } = fakeClient(() => ok());
      const r = await runLocalization(client, input);
      expect(r, JSON.stringify(input)).toMatchObject({ ok: false, code: "GATED" });
      expect(sent).toHaveLength(0);
    }
  });
});

describe("client failures", () => {
  it("keeps LOST, MODAL_OPEN and WEDGED, and never retries a lost mutation", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      const r = await runLocalization(client, {
        action: "set",
        id: "A",
        fields: ["X"],
        values: ["y"],
      });
      expect(r).toMatchObject({ ok: false, code });
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(r.ok === false && r.next).toContain("never retried");
    }
  });

  it("a lost read points at the usual next step, not at a mutation warning", async () => {
    const { client } = fakeClient(() => new WorkbenchError("boom", "LOST"));
    const r = await runLocalization(client, { action: "list" });
    expect(r).toMatchObject({ ok: false, code: "LOST" });
    expect(r.ok === false && r.next).not.toContain("never retried");
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    expect(await runLocalization(client, { action: "status" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("an answer with no status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({}));
    expect(await runLocalization(client, { action: "status" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });
});

describe("1.x names", () => {
  it("getTable is sent as list and warned about", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ columns: ["index", "Id"], rows: ["0|A"], total: 1, nextCursor: "" }),
    );
    const r = await runLocalization(client, { action: "getTable" });
    expect(sent[0]!.params).toEqual({ action: "list" });
    expect(sent[0]!.options.access).toBe("read");
    expect(r).toMatchObject({ ok: true, action: "list" });
    expect(r.warnings.join(" ")).toContain("getTable");
  });

  it("getTable keeps the paging keys of the new surface", async () => {
    const { client, sent } = fakeClient(() => ok({ columns: ["index"], rows: [], total: 0 }));
    await runLocalization(client, { action: "getTable", limit: 10, prefix: "A" });
    expect(sent[0]!.params).toEqual({ action: "list", limit: 10, prefix: "A" });
  });

  it("listLanguages is sent as columns and adds the language names", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        itemClass: "CustomStringTableItem",
        columns: [
          "Id|STRING|",
          "Target_en_us|STRING|",
          "Target_en_us_edited|STRING|",
          "Target_fr_fr|STRING|",
        ],
      }),
    );
    const r = await runLocalization(client, { action: "listLanguages" });
    expect(sent[0]!.params).toEqual({ action: "columns" });
    expect(r.ok && r.readback).toMatchObject({ languages: ["en_us", "fr_fr"] });
    expect(r.warnings.join(" ")).toContain("listLanguages");
  });

  it("columns itself does not add languages", async () => {
    const { client } = fakeClient(() => ok({ itemClass: "X", columns: ["Id|STRING|"] }));
    const r = await runLocalization(client, { action: "columns" });
    expect(r.ok && "languages" in (r.readback as object)).toBe(false);
  });

  it("modify becomes set from itemId, property and value", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ id: "A.B", index: 1, before: ["Comment|a"], after: ["Comment|b"] }),
    );
    const r = await runLocalization(client, {
      action: "modify",
      itemId: "A.B",
      property: "Comment",
      value: "b",
    });
    expect(sent[0]!.params).toEqual({
      action: "set",
      id: "A.B",
      fields: ["Comment"],
      values: ["b"],
    });
    expect(sent[0]!.options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      action: "set",
      changed: [{ path: "A.B.Comment", before: "a", after: "b" }],
    });
    expect(r.warnings.join(" ")).toContain("modify");
  });

  it("modify maps the old property names en_us and target to Target_en_us", async () => {
    for (const property of ["en_us", "target"]) {
      const { client, sent } = fakeClient(() =>
        ok({ id: "A", index: 0, before: ["Target_en_us|a"], after: ["Target_en_us|b"] }),
      );
      const r = await runLocalization(client, {
        action: "modify",
        itemId: "A",
        property,
        value: "b",
      });
      expect(sent[0]!.params.fields).toEqual(["Target_en_us"]);
      expect(r.warnings.join(" ")).toContain(`'${property}'`);
    }
  });

  it("modify with the new keys goes through as a plain set", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ id: "A", index: 0, before: ["X|a"], after: ["X|b"] }),
    );
    await runLocalization(client, { action: "modify", id: "A", fields: ["X"], values: ["b"] });
    expect(sent[0]!.params).toEqual({ action: "set", id: "A", fields: ["X"], values: ["b"] });
  });

  it("modify without itemId, property or value is refused before sending", async () => {
    for (const input of [
      { action: "modify", property: "X", value: "y" },
      { action: "modify", itemId: "A", value: "y" },
      { action: "modify", itemId: "A", property: "X" },
      { action: "modify", itemId: "A" },
    ]) {
      const { client, sent } = fakeClient(() => ok());
      const r = await runLocalization(client, input);
      expect(r, JSON.stringify(input)).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(sent).toHaveLength(0);
    }
  });

  it("modify with both the 1.x and the new keys is refused", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runLocalization(client, {
      action: "modify",
      itemId: "A",
      property: "X",
      value: "y",
      fields: ["X"],
      values: ["y"],
    });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });

  it("insert and delete take the 1.x itemId (and insert its value) as before", async () => {
    const ins = fakeClient(() => ok({ id: "K", index: 0, total: 1, after: ["Id|K"] }));
    await runLocalization(ins.client, { action: "insert", itemId: "K", value: "text" });
    expect(ins.sent[0]!.params).toEqual({
      action: "insert",
      id: "K",
      fields: ["Target_en_us"],
      values: ["text"],
    });
    const plain = fakeClient(() => ok({ id: "K", index: 0, total: 1, after: ["Id|K"] }));
    await runLocalization(plain.client, { action: "insert", itemId: "K" });
    expect(plain.sent[0]!.params).toEqual({ action: "insert", id: "K" });
    const del = fakeClient(() => ok({ id: "K", index: 0, total: 0, before: ["Id|K"] }));
    await runLocalization(del.client, { action: "delete", itemId: "K" });
    expect(del.sent[0]!.params).toEqual({ action: "delete", id: "K" });
  });

  it("a different id and itemId are refused", () => {
    const n = normalizeLegacy({ action: "delete", id: "A", itemId: "B" });
    expect(n.error).toBeDefined();
    const p = prepareRequest({ action: "delete", id: "A", itemId: "B" });
    expect(p.ok).toBe(false);
  });

  it("a 1.x key on an action that does not take it is refused by the schema", () => {
    for (const input of [
      { action: "get", itemId: "A" },
      { action: "list", property: "X" },
      { action: "status", value: "x" },
      { action: "delete", id: "A", value: "x" },
    ]) {
      expect(prepareRequest(input).ok, JSON.stringify(input)).toBe(false);
    }
  });

  it("the 1.x names are the three the contract-less handler used to carry", () => {
    expect([...LEGACY_ACTIONS]).toEqual(["getTable", "listLanguages", "modify"]);
  });
});

// Census rows this file tests (W3 close-out, EV-W3-099).
// census:mcp:action/wb_localization.columns
// census:mcp:action/wb_localization.delete
// census:mcp:action/wb_localization.filter
// census:mcp:action/wb_localization.get
// census:mcp:action/wb_localization.getTable
// census:mcp:action/wb_localization.insert
// census:mcp:action/wb_localization.list
// census:mcp:action/wb_localization.listLanguages
// census:mcp:action/wb_localization.modify
// census:mcp:action/wb_localization.open
// census:mcp:action/wb_localization.save
// census:mcp:action/wb_localization.selection
// census:mcp:action/wb_localization.set
// census:mcp:action/wb_localization.status
