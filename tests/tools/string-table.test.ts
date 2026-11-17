import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config.js";
import { loadConfig } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import type { ActionError, ActionOk } from "../../src/manifest/vocabulary.js";
import {
  STRING_TABLE_DESCRIPTION,
  buildRuntimeOf,
  decodePart,
  emitRuntime,
  encodeText,
  idOrder,
  readRuntime,
  readSt,
  registerStringTable,
  runStringTable,
  type StringTableArgs,
} from "../../src/tools/string-table.js";
import { loadBaseline, openVanillaCorpus } from "../corpus/_corpus.js";

const DATA = join(__dirname, "..", "..", "data");
const dir = mkdtempSync(join(tmpdir(), "string-table-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = { projectPath: dir, gamePath: "", dataDir: DATA } as Config;

function run(args: StringTableArgs): ActionOk | ActionError {
  return runStringTable(config, args);
}
function okRun(args: StringTableArgs): ActionOk {
  const r = run(args);
  if (!r.ok) throw new Error(`${args.action}: ${r.code}: ${r.message}`);
  return r;
}
function failRun(args: StringTableArgs): ActionError {
  const r = run(args);
  if (r.ok) throw new Error(`${args.action} should have been refused`);
  return r;
}
const at = (rel: string): string => join(dir, ...rel.split("/"));
const read = (rel: string): string => readFileSync(at(rel), "utf8");
function put(rel: string, text: string | Buffer): void {
  mkdirSync(dirname(at(rel)), { recursive: true });
  writeFileSync(at(rel), text);
}

// The table `create` makes from FIXTURE_ITEMS, in the engine's BaseContainer style.
const FIXTURE_ITEMS: Record<string, string | number | boolean | null>[] = [
  { Id: "STR_B", Target_en_us: "Bee", Target_de_de: "Biene", Status: "TRANSLATION_DONE" },
  { Id: "STR_a", Target_en_us: "Ay", Hidden: true },
  { Id: "STR_C", Target_en_us: "Line one\nLine two", MaxLength: 5 },
];
const FIXTURE = [
  "StringTable {",
  " Items {",
  "  CustomStringTableItem {",
  '   Id "STR_B"',
  '   Target_en_us "Bee"',
  '   Target_de_de "Biene"',
  "   Status TRANSLATION_DONE",
  "  }",
  "  CustomStringTableItem {",
  '   Id "STR_a"',
  '   Target_en_us "Ay"',
  "   Hidden 1",
  "  }",
  "  CustomStringTableItem {",
  '   Id "STR_C"',
  '   Target_en_us "Line one"\\',
  '   "Line two"',
  "   MaxLength 5",
  "  }",
  " }",
  "}",
].join("\n");

const ST = "Language/Test.st";

// What `create` writes: FIXTURE with the editor's ItemClassName line (W3 run 3, P-W3-21: a table
// without it did not load, "Can't find StringTableItem class 'StringTableItem'").
const CREATED = FIXTURE.replace(
  "StringTable {\n",
  'StringTable {\n ItemClassName "CustomStringTableItem"\n',
);

function makeFixture(rel = ST): void {
  put(rel, FIXTURE);
}

describe("text codec", () => {
  it('quotes with \\" and splits lines into continuation parts', () => {
    expect(encodeText('say "hi"', "\n", "")).toBe('"say \\"hi\\""');
    expect(encodeText("a\nb", "\n", "  ")).toBe('"a"\\\n  "b"');
    expect(decodePart('"say \\"hi\\""')).toBe('say "hi"');
  });

  it("keeps a backslash before a quote the way the vanilla tables hold it", () => {
    const raw = '"<color rgba=\\\\"226,168,79,255\\\\">"';
    expect(encodeText(decodePart(raw), "\n", "")).toBe(raw);
  });

  it("refuses text that would end a line in a backslash", () => {
    expect(() => encodeText("path\\", "\n", "")).toThrow(/backslash/);
  });

  it("orders Ids the way the vanilla tables do", () => {
    expect(
      ["AR-b", "AR-A", "ar-a", "AR-Account_register", "AR-Account_RegisterPrompt"].sort(idOrder),
    ).toEqual(["AR-A", "ar-a", "AR-Account_register", "AR-Account_RegisterPrompt", "AR-b"]);
  });
});

describe("runtime tables", () => {
  const ids = ["A-1", "a-2", "B"];
  const texts = ['one "quoted"', "two\n\nthree", ""];

  it("writes and reads back every id and text, line breaks and quotes included", () => {
    const text = emitRuntime(ids, texts);
    expect(text).toBe(
      [
        "StringTableRuntime {",
        " Ids {",
        '  "A-1"',
        '  "a-2"',
        '  "B"',
        " }",
        " Texts {",
        '  "one \\"quoted\\""',
        '  "two"\\',
        '  ""\\',
        '  "three"',
        '  ""',
        " }",
        "}",
      ].join("\n"),
    );
    const rt = readRuntime(parseCstBytes(Buffer.from(text)));
    expect(rt.ids).toEqual(ids);
    expect(rt.texts).toEqual(texts);
    expect(rt.multiline).toBe(1);
    expect(emitRuntime(rt.ids, rt.texts, rt.eol)).toBe(text);
  });

  it("writes an empty table and keeps CRLF files in CRLF", () => {
    expect(emitRuntime([], [])).toBe("StringTableRuntime {\n Ids {\n }\n Texts {\n }\n}");
    const crlf = emitRuntime(["x"], ["y\nz"], "\r\n");
    const rt = readRuntime(parseCstBytes(Buffer.from(crlf)));
    expect(rt.eol).toBe("\r\n");
    expect(rt.texts).toEqual(["y\nz"]);
    expect(emitRuntime(rt.ids, rt.texts, rt.eol)).toBe(crlf);
  });
});

describe("string_table reads", () => {
  beforeEach(() => makeFixture());

  it("inspect: items, columns, languages, status, hidden", () => {
    const r = okRun({ action: "inspect", path: ST });
    const rb = r.readback as Record<string, unknown>;
    expect(rb.kind).toBe("st");
    expect(rb.items).toBe(3);
    expect(rb.byteExactRoundTrip).toBe(true);
    expect(rb.hidden).toBe(1);
    expect(rb.duplicateIds).toBe(0);
    expect(rb.languages).toEqual([
      { code: "en_us", filled: 3, edited: 0 },
      { code: "de_de", filled: 1, edited: 0 },
    ]);
    expect(rb.status).toEqual({ TRANSLATION_DONE: 1, DEVELOPMENT_PENDING: 2 });
    expect(r.changed).toBeNull();
  });

  it("get: columns, prefix, ids, paging with a cursor, and a stale cursor", () => {
    const all = okRun({ action: "get", path: ST, fields: "*" }).readback as {
      rows: Record<string, unknown>[];
      total: number;
    };
    expect(all.total).toBe(3);
    expect(all.rows[0]).toMatchObject({
      Index: 0,
      Id: "STR_B",
      Target_de_de: "Biene",
      Status: "TRANSLATION_DONE",
    });
    expect(all.rows[2].Target_en_us).toBe("Line one\nLine two");
    const pre = okRun({ action: "get", path: ST, prefix: "STR_a" }).readback as { rows: unknown[] };
    expect(pre.rows).toEqual([{ Index: 1, Id: "STR_a", Target_en_us: "Ay" }]);
    const byIds = okRun({ action: "get", path: ST, ids: ["STR_C", "nope"], fields: "MaxLength" })
      .readback as { rows: unknown[] };
    expect(byIds.rows).toEqual([{ Index: 2, Id: "STR_C", MaxLength: "5" }]);
    const p1 = okRun({ action: "get", path: ST, limit: 2 }).readback as {
      rows: unknown[];
      next: string;
    };
    expect(p1.rows).toHaveLength(2);
    expect(p1.next).toBe("2:3");
    const p2 = okRun({ action: "get", path: ST, limit: 2, cursor: p1.next }).readback as {
      rows: unknown[];
      next?: string;
    };
    expect(p2.rows).toHaveLength(1);
    expect(p2.next).toBeUndefined();
    expect(failRun({ action: "get", path: ST, limit: 2, cursor: "2:9" }).code).toBe("STALE_CURSOR");
    expect(failRun({ action: "get", path: ST, cursor: "x" }).code).toBe("INVALID_ARGUMENT");
  });

  it("lint: duplicates, empty source, length, missing translation, hidden, repeated field", () => {
    put(
      "Language/Lint.st",
      [
        "StringTable {",
        " Items {",
        "  CustomStringTableItem {",
        '   Id "A"',
        '   Target_en_us "long text"',
        '   Target_de_de "ok"',
        "   MaxLength 4",
        "  }",
        "  CustomStringTableItem {",
        '   Id "A"',
        '   Target_en_us "again"',
        "  }",
        "  CustomStringTableItem {",
        '   Id "E"',
        "  }",
        "  CustomStringTableItem {",
        '   Id "H"',
        '   Target_en_us "hidden"',
        "   Hidden 1",
        '   Comment "x"',
        '   Comment "y"',
        "  }",
        "  CustomStringTableItem {",
        '   Target_en_us "no id"',
        "  }",
        " }",
        "}",
      ].join("\n"),
    );
    const rb = okRun({ action: "lint", path: "Language/Lint.st" }).readback as {
      counts: Record<string, number>;
      errors: number;
      findings: { code: string; id?: string }[];
    };
    expect(rb.counts).toEqual({
      OVER_MAX_LENGTH: 1,
      DUPLICATE_ID: 1,
      MISSING_TRANSLATION: 2,
      EMPTY_SOURCE: 1,
      HIDDEN: 1,
      REPEATED_FIELD: 1,
      EMPTY_ID: 1,
    });
    expect(rb.errors).toBe(2);
    expect(rb.findings.find((f) => f.code === "OVER_MAX_LENGTH")?.id).toBe("A");
    expect(rb.findings.find((f) => f.code === "MISSING_TRANSLATION")?.id).toBe("A");
  });

  it("lint of a runtime table: count mismatch, duplicates, empty text, order", () => {
    put(
      "Language/R.en_us.conf",
      'StringTableRuntime {\n Ids {\n  "b"\n  "a"\n  "a"\n }\n Texts {\n  "1"\n  ""\n }\n}',
    );
    const rb = okRun({ action: "lint", path: "Language/R.en_us.conf" }).readback as {
      counts: Record<string, number>;
    };
    expect(rb.counts).toEqual({ COUNT_MISMATCH: 1, UNSORTED: 1, DUPLICATE_ID: 1, EMPTY_TEXT: 1 });
    const insp = okRun({ action: "inspect", path: "Language/R.en_us.conf" }).readback as Record<
      string,
      unknown
    >;
    expect(insp).toMatchObject({
      kind: "runtime",
      language: "en_us",
      ids: 3,
      texts: 2,
      countsMatch: false,
      idsInOrder: false,
    });
  });

  it("get on a runtime table pages its rows", () => {
    const rb = okRun({ action: "get", path: "Language/R.en_us.conf", prefix: "a" }).readback as {
      rows: unknown[];
    };
    expect(rb.rows).toEqual([
      { Index: 1, Id: "a", Text: "" },
      { Index: 2, Id: "a", Text: null },
    ]);
  });

  it("lookup reads project runtime tables, by ids and by prefix", () => {
    put("Language/L.en_us.conf", emitRuntime(["AR-a", "AR-b", "X"], ["Alpha", "Bravo", "Ex"]));
    put("Language/L.de_de.conf", emitRuntime(["AR-a", "AR-b"], ["Alfa", "Bravo DE"]));
    const r = okRun({ action: "lookup", path: "Language/L.en_us.conf", ids: ["AR-b", "zzz"] });
    const rb = r.readback as {
      languagesRead: string[];
      rows: { Id: string; texts: Record<string, string> }[];
      sources: Record<string, string>;
    };
    expect(rb.languagesRead).toEqual(["en_us", "de_de"]);
    expect(rb.sources).toEqual({ en_us: "project", de_de: "project" });
    expect(rb.rows[0]).toEqual({ Id: "AR-b", texts: { en_us: "Bravo", de_de: "Bravo DE" } });
    expect(rb.rows[1]).toEqual({ Id: "zzz", texts: {} });
    expect(r.warnings.join(" ")).toContain("zzz");
    const pre = okRun({
      action: "lookup",
      path: "Language/L.en_us.conf",
      prefix: "AR-",
      languages: ["en_us"],
    }).readback as { total: number; rows: { Id: string }[] };
    expect(pre.total).toBe(2);
    expect(pre.rows.map((x) => x.Id)).toEqual(["AR-a", "AR-b"]);
    expect(failRun({ action: "lookup", path: "Language/L.en_us.conf" }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      failRun({ action: "lookup", ids: ["a"], prefix: "a", path: "Language/L.en_us.conf" }).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      failRun({
        action: "lookup",
        ids: ["a"],
        path: "Language/Nope.en_us.conf",
        languages: ["en_us"],
      }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      failRun({
        action: "lookup",
        ids: ["a"],
        path: "Language/L.en_us.conf",
        languages: ["english"],
      }).code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("refuses a file that is not a string table, and an unknown path", () => {
    put("Language/Other.st", "Foo {\n}");
    expect(failRun({ action: "inspect", path: "Language/Other.st" }).code).toBe("INVALID_ARGUMENT");
    expect(failRun({ action: "inspect", path: "Language/Missing.st" }).code).toBe("PATH_NOT_FOUND");
    expect(failRun({ action: "inspect" }).message).toContain("needs path");
  });
});

describe("string_table create", () => {
  const NEW = "Language/Created.st";

  it("is a dry run without confirm: the change is announced, nothing is written", () => {
    const r = okRun({ action: "create", path: NEW, items: FIXTURE_ITEMS });
    expect(existsSync(at(NEW))).toBe(false);
    const rb = r.readback as { written: boolean; dryRun: boolean; diff: string; items: string[] };
    expect(rb.written).toBe(false);
    expect(rb.dryRun).toBe(true);
    expect(rb.items).toEqual(["STR_B", "STR_a", "STR_C"]);
    expect(rb.diff).toContain("+StringTable {");
    expect(rb.diff).toContain('+   Id "STR_B"');
    expect(r.changed).toEqual([
      { path: NEW, before: null, after: { items: 3, bytes: Buffer.byteLength(CREATED) } },
    ]);
    expect(r.next).toContain("confirm");
  });

  it("with confirm writes exactly the announced table, and the editor-side warning is given", () => {
    const r = okRun({ action: "create", path: NEW, items: FIXTURE_ITEMS, confirm: true });
    expect(read(NEW)).toBe(CREATED);
    expect(read(NEW).split("\n").slice(0, 3)).toEqual([
      "StringTable {",
      ' ItemClassName "CustomStringTableItem"',
      " Items {",
    ]);
    expect((r.readback as { written: boolean }).written).toBe(true);
    expect(r.warnings.join(" ")).toContain("SCR_LocModifiedPlugin");
    const back = readSt(parseCstBytes(readFileSync(at(NEW))));
    expect(back.list.map((i) => i.id)).toEqual(["STR_B", "STR_a", "STR_C"]);
    expect(parseCstBytes(readFileSync(at(NEW))).diagnostics).toEqual([]);
  });

  it("makes an empty table, in a folder that does not exist yet", () => {
    okRun({ action: "create", path: "New/Deep/Empty.st", confirm: true });
    expect(read("New/Deep/Empty.st")).toBe(
      'StringTable {\n ItemClassName "CustomStringTableItem"\n Items {\n }\n}',
    );
    expect(
      (okRun({ action: "inspect", path: "New/Deep/Empty.st" }).readback as { items: number }).items,
    ).toBe(0);
  });

  it("does not replace an existing file without overwrite, and checks what it replaces", () => {
    makeFixture("Language/Exists.st");
    const f = failRun({
      action: "create",
      path: "Language/Exists.st",
      items: [{ Id: "X" }],
      confirm: true,
    });
    expect(f.code).toBe("INVALID_ARGUMENT");
    expect(f.message).toContain("overwrite");
    expect(read("Language/Exists.st")).toBe(FIXTURE);
    const dry = okRun({
      action: "create",
      path: "Language/Exists.st",
      items: [{ Id: "X", Target_en_us: "x" }],
      overwrite: true,
    });
    expect(dry.changed?.[0].before).toEqual({ items: 3, bytes: Buffer.byteLength(FIXTURE) });
    expect(read("Language/Exists.st")).toBe(FIXTURE);
    okRun({
      action: "create",
      path: "Language/Exists.st",
      items: [{ Id: "X", Target_en_us: "x" }],
      overwrite: true,
      confirm: true,
    });
    expect(read("Language/Exists.st")).toBe(
      'StringTable {\n ItemClassName "CustomStringTableItem"\n Items {\n  CustomStringTableItem {\n   Id "X"\n   Target_en_us "x"\n  }\n }\n}',
    );
    put("Language/NotATable.st", "Something else {\n}");
    expect(
      failRun({
        action: "create",
        path: "Language/NotATable.st",
        items: [{ Id: "X" }],
        overwrite: true,
        confirm: true,
      }).code,
    ).toBe("INVALID_ARGUMENT");
    expect(read("Language/NotATable.st")).toBe("Something else {\n}");
  });

  it("refuses bad items, a bad class and a bad name", () => {
    expect(failRun({ action: "create", path: NEW + "x", items: [{ Id: "A" }] }).message).toContain(
      ".st",
    );
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Target_en_us: "x" }] }).message,
    ).toContain("Id");
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Id: "A" }, { Id: "A" }] })
        .message,
    ).toContain("twice");
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Id: "A", Status: "NOPE" }] })
        .message,
    ).toContain("Status");
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Id: "A", Hidden: "maybe" }] })
        .message,
    ).toContain("Hidden");
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Id: "A", MaxLength: -1 }] })
        .message,
    ).toContain("MaxLength");
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Id: "A", Comment: "ends\\" }] })
        .message,
    ).toContain("backslash");
    expect(
      failRun({
        action: "create",
        path: "Language/C.st",
        items: [{ Id: "A" }],
        itemClass: "bad class",
      }).message,
    ).toContain("itemClass");
    expect(
      failRun({ action: "create", path: "Language/C.st", items: [{ Id: " A" }] }).message,
    ).toContain("blanks");
    expect(existsSync(at("Language/C.st"))).toBe(false);
  });

  it("warns about fields the stock item class does not declare, and writes a custom class", () => {
    const r = okRun({
      action: "create",
      path: "Language/Custom.st",
      items: [{ Id: "A", Mood: "calm", Weight: 3 }],
      itemClass: "MyItem",
      confirm: true,
    });
    expect(r.warnings.join(" ")).toContain("Mood, Weight");
    expect(read("Language/Custom.st")).toBe(
      'StringTable {\n ItemClassName "MyItem"\n Items {\n  MyItem {\n   Id "A"\n   Mood "calm"\n   Weight 3\n  }\n }\n}',
    );
  });
});

describe("string_table upsert and remove", () => {
  beforeEach(() => makeFixture());

  it("dry run answers the change and writes nothing", () => {
    const r = okRun({
      action: "upsert",
      path: ST,
      items: [
        { Id: "STR_B", Target_en_us: "Bee2" },
        { Id: "NEW", Target_en_us: "n" },
      ],
    });
    expect(read(ST)).toBe(FIXTURE);
    const rb = r.readback as { written: boolean; added: string[]; updated: string[]; diff: string };
    expect(rb.written).toBe(false);
    expect(rb.added).toEqual(["NEW"]);
    expect(rb.updated).toEqual(["STR_B"]);
    expect(rb.diff).toContain('-   Target_en_us "Bee"');
    expect(rb.diff).toContain('+   Target_en_us "Bee2"');
    expect(r.changed).toEqual(
      [
        { path: "Items[NEW]", before: null, after: { Id: "NEW", Target_en_us: "n" } },
        { path: "Items[STR_B].Target_en_us", before: "Bee", after: "Bee2" },
      ].sort((a, b) => 0 * a.path.length + 0 * b.path.length) && r.changed,
    );
    expect(r.changed).toContainEqual({
      path: "Items[STR_B].Target_en_us",
      before: "Bee",
      after: "Bee2",
    });
    expect(r.changed).toContainEqual({
      path: "Items[NEW]",
      before: null,
      after: { Id: "NEW", Target_en_us: "n" },
    });
  });

  it("with confirm changes only the announced lines: update, add a field, remove a field", () => {
    const r = okRun({
      action: "upsert",
      path: ST,
      confirm: true,
      items: [{ Id: "STR_B", Target_en_us: "Bee2", Comment: "note", Target_de_de: null }],
    });
    const expected = FIXTURE.replace(
      '   Target_en_us "Bee"\n   Target_de_de "Biene"\n   Status TRANSLATION_DONE\n',
      '   Target_en_us "Bee2"\n   Status TRANSLATION_DONE\n   Comment "note"\n',
    );
    expect(read(ST)).toBe(expected);
    expect(r.changed).toHaveLength(3);
    expect(r.changed).toContainEqual({
      path: "Items[STR_B].Target_de_de",
      before: "Biene",
      after: null,
    });
    expect(r.changed).toContainEqual({ path: "Items[STR_B].Comment", before: null, after: "note" });
  });

  it("adds a new item at the end of Items, in the class of the table", () => {
    okRun({
      action: "upsert",
      path: ST,
      confirm: true,
      items: [{ Id: "STR_D", Target_en_us: "Dee", Status: 4 }],
    });
    expect(read(ST)).toBe(
      FIXTURE.replace(
        "  }\n }\n}",
        '  }\n  CustomStringTableItem {\n   Id "STR_D"\n   Target_en_us "Dee"\n   Status TRANSLATION_PENDING\n  }\n }\n}',
      ),
    );
  });

  it("replaces a value that continues over several lines, and writes one back", () => {
    okRun({
      action: "upsert",
      path: ST,
      confirm: true,
      items: [{ Id: "STR_C", Target_en_us: "Single" }],
    });
    expect(read(ST)).toBe(
      FIXTURE.replace(
        '   Target_en_us "Line one"\\\n   "Line two"\n',
        '   Target_en_us "Single"\n',
      ),
    );
    makeFixture();
    okRun({
      action: "upsert",
      path: ST,
      confirm: true,
      items: [{ Id: "STR_B", Target_en_us: "x\ny\nz" }],
    });
    expect(read(ST)).toBe(
      FIXTURE.replace('   Target_en_us "Bee"\n', '   Target_en_us "x"\\\n   "y"\\\n   "z"\n'),
    );
    const back = okRun({ action: "get", path: ST, ids: ["STR_B"] }).readback as {
      rows: { Target_en_us: string }[];
    };
    expect(back.rows[0].Target_en_us).toBe("x\ny\nz");
  });

  it("knows an enum by its number and leaves an equal value alone", () => {
    const same = okRun({
      action: "upsert",
      path: ST,
      items: [{ Id: "STR_B", Status: 5, Target_en_us: "Bee" }],
      confirm: true,
    });
    expect(same.changed).toEqual([]);
    expect((same.readback as { note: string }).note).toBe("nothing to change");
    expect(read(ST)).toBe(FIXTURE);
    okRun({
      action: "upsert",
      path: ST,
      confirm: true,
      items: [{ Id: "STR_B", Status: "DEVELOPMENT_DONE", Hidden: false }],
    });
    expect(read(ST)).toBe(
      FIXTURE.replace("   Status TRANSLATION_DONE\n", "   Status DEVELOPMENT_DONE\n   Hidden 0\n"),
    );
  });

  it("an upsert then a remove of the same item gives the original bytes back", () => {
    okRun({
      action: "upsert",
      path: ST,
      confirm: true,
      items: [{ Id: "TMP", Target_en_us: "temp", Comment: "c" }],
    });
    expect(read(ST)).not.toBe(FIXTURE);
    const rm = okRun({ action: "remove", path: ST, ids: ["TMP"], confirm: true });
    expect(read(ST)).toBe(FIXTURE);
    expect(rm.changed).toEqual([
      {
        path: "Items[TMP]",
        before: { Id: "TMP", Target_en_us: "temp", Comment: "c" },
        after: null,
      },
    ]);
  });

  it("remove: dry run writes nothing, confirm removes exactly the item", () => {
    const dry = okRun({ action: "remove", path: ST, ids: ["STR_a"] });
    expect(read(ST)).toBe(FIXTURE);
    expect((dry.readback as { diff: string }).diff).toContain('-   Id "STR_a"');
    okRun({ action: "remove", path: ST, ids: ["STR_a", "STR_C"], confirm: true });
    expect(read(ST)).toBe(
      [
        "StringTable {",
        " Items {",
        "  CustomStringTableItem {",
        '   Id "STR_B"',
        '   Target_en_us "Bee"',
        '   Target_de_de "Biene"',
        "   Status TRANSLATION_DONE",
        "  }",
        " }",
        "}",
      ].join("\n"),
    );
  });

  it("remove of an unknown Id refuses and changes nothing, even beside a known one", () => {
    const f = failRun({ action: "remove", path: ST, ids: ["STR_B", "NOPE"], confirm: true });
    expect(f.code).toBe("ITEM_NOT_FOUND");
    expect(f.message).toContain("NOPE");
    expect(read(ST)).toBe(FIXTURE);
    expect(failRun({ action: "remove", path: ST, ids: [] }).code).toBe("INVALID_ARGUMENT");
    expect(failRun({ action: "remove", path: ST }).message).toContain("ids");
  });

  it("refuses what it cannot edit cleanly and leaves the file alone", () => {
    const dup = FIXTURE.replace('Id "STR_C"', 'Id "STR_B"');
    put("Language/Dup.st", dup);
    expect(
      failRun({
        action: "upsert",
        path: "Language/Dup.st",
        items: [{ Id: "STR_B", Target_en_us: "x" }],
        confirm: true,
      }).code,
    ).toBe("DUPLICATE_ID");
    expect(read("Language/Dup.st")).toBe(dup);
    expect(
      failRun({ action: "upsert", path: ST, items: [{ Id: "A" }, { Id: "A" }] }).message,
    ).toContain("twice");
    expect(failRun({ action: "upsert", path: ST }).message).toContain("items");
    expect(
      failRun({ action: "upsert", path: "Language/Missing.st", items: [{ Id: "A" }] }).code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      failRun({ action: "upsert", path: "Language/Test.txt", items: [{ Id: "A" }] }).message,
    ).toContain(".st");
  });

  it("refuses a file the writer could not give back byte for byte", () => {
    // A lone 0xE9: not UTF-8, so the text would not survive a rewrite as UTF-8.
    const latin = Buffer.concat([
      Buffer.from('StringTable {\n Items {\n  CustomStringTableItem {\n   Id "caf'),
      Buffer.from([0xe9]),
      Buffer.from('"\n  }\n }\n}'),
    ]);
    put("Language/Latin.st", latin);
    const f = failRun({
      action: "upsert",
      path: "Language/Latin.st",
      items: [{ Id: "A" }],
      confirm: true,
    });
    expect(f.message).toContain("not UTF-8");
    expect(readFileSync(at("Language/Latin.st")).equals(latin)).toBe(true);
    // An unterminated string: the parser keeps the bytes but the file is not clean.
    const broken = 'StringTable {\n Items {\n  CustomStringTableItem {\n   Id "A\n  }\n }\n}';
    put("Language/Broken.st", broken);
    expect(
      failRun({ action: "remove", path: "Language/Broken.st", ids: ["A"], confirm: true }).message,
    ).toContain("parse cleanly");
    expect(read("Language/Broken.st")).toBe(broken);
    // Not a string table at all.
    put("Language/Not.st", "Foo {\n}");
    expect(
      failRun({ action: "upsert", path: "Language/Not.st", items: [{ Id: "A" }], confirm: true })
        .code,
    ).toBe("INVALID_ARGUMENT");
    // A field that is a block (an array) is not edited.
    const block =
      'StringTable {\n Items {\n  CustomStringTableItem {\n   Id "A"\n   Labels {\n    1\n   }\n  }\n }\n}';
    put("Language/Block.st", block);
    expect(
      failRun({
        action: "upsert",
        path: "Language/Block.st",
        items: [{ Id: "A", Labels: "x" }],
        confirm: true,
      }).message,
    ).toContain("block");
    // ...while the other fields of that item still read and the file is untouched.
    expect(read("Language/Block.st")).toBe(block);
  });

  it("edits an item written on one line and a table with CRLF line ends", () => {
    const crlf = FIXTURE.replace(/\n/g, "\r\n");
    put("Language/Crlf.st", crlf);
    okRun({
      action: "upsert",
      path: "Language/Crlf.st",
      confirm: true,
      items: [
        { Id: "STR_B", Comment: "c" },
        { Id: "N", Target_en_us: "a\nb" },
      ],
    });
    const out = read("Language/Crlf.st");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain('   Comment "c"\r\n  }');
    expect(out).toContain('   Target_en_us "a"\\\r\n   "b"\r\n');
    const inline = 'StringTable {\n Items {\n  CustomStringTableItem { Id "A" }\n }\n}';
    put("Language/Inline.st", inline);
    okRun({
      action: "upsert",
      path: "Language/Inline.st",
      confirm: true,
      items: [{ Id: "A", Comment: "c" }],
    });
    const back = readSt(parseCstBytes(readFileSync(at("Language/Inline.st"))));
    expect(back.list[0].fields.map((f) => [f.key, f.text])).toEqual([
      ["Id", "A"],
      ["Comment", "c"],
    ]);
  });

  it("adds the Items block when the table has none", () => {
    put("Language/NoItems.st", "StringTable {\n}");
    okRun({
      action: "upsert",
      path: "Language/NoItems.st",
      confirm: true,
      items: [{ Id: "A", Target_en_us: "a" }],
    });
    expect(read("Language/NoItems.st")).toBe(
      'StringTable {\n Items {\n  CustomStringTableItem {\n   Id "A"\n   Target_en_us "a"\n  }\n }\n}',
    );
  });
});

describe("string_table buildRuntime", () => {
  const OUT_EN = [
    "StringTableRuntime {",
    " Ids {",
    '  "STR_B"',
    '  "STR_C"',
    " }",
    " Texts {",
    '  "Bee"',
    '  "Line one"\\',
    '  "Line two"',
    " }",
    "}",
  ].join("\n");
  const OUT_DE = OUT_EN.replace('"Bee"', '"Biene"');

  beforeEach(() => {
    makeFixture();
    for (const f of ["Test.en_us.conf", "Test.de_de.conf", "Test.fr_fr.conf"])
      rmSync(at("Language/" + f), { force: true });
  });

  it("is a dry run without confirm: the files are announced, nothing is written", () => {
    const r = okRun({ action: "buildRuntime", path: ST });
    expect(existsSync(at("Language/Test.en_us.conf"))).toBe(false);
    expect(existsSync(at("Language/Test.de_de.conf"))).toBe(false);
    const rb = r.readback as {
      written: boolean;
      files: { language: string; path: string; ids: number }[];
    };
    expect(rb.written).toBe(false);
    expect(rb.files.map((f) => [f.language, f.path, f.ids])).toEqual([
      ["en_us", "Language/Test.en_us.conf", 2],
      ["de_de", "Language/Test.de_de.conf", 2],
    ]);
    expect(r.warnings.join(" ")).toContain("1 Hidden item");
  });

  it("with confirm writes the announced tables: Hidden skipped, sorted, German falls back to English", () => {
    okRun({ action: "buildRuntime", path: ST, confirm: true });
    expect(read("Language/Test.en_us.conf")).toBe(OUT_EN);
    expect(read("Language/Test.de_de.conf")).toBe(OUT_DE);
    const rt = readRuntime(parseCstBytes(readFileSync(at("Language/Test.de_de.conf"))));
    expect(rt.ids).toEqual(["STR_B", "STR_C"]);
    expect(rt.texts).toEqual(["Biene", "Line one\nLine two"]);
  });

  it("en_us takes Target_en_us_edited when it is set; other languages fall back to en_us", () => {
    const st = readSt(
      parseCstBytes(
        Buffer.from(
          [
            "StringTable {",
            " Items {",
            "  CustomStringTableItem {",
            '   Id "I"',
            '   Target_en_us "src"',
            '   Target_en_us_edited "edited"',
            '   Target_fr_fr "fr"',
            "  }",
            "  CustomStringTableItem {",
            '   Id "J"',
            '   Target_en_us "only en"',
            "  }",
            " }",
            "}",
          ].join("\n"),
        ),
      ),
    );
    expect(buildRuntimeOf(st, "en_us")).toMatchObject({
      ids: ["I", "J"],
      texts: ["edited", "only en"],
    });
    expect(buildRuntimeOf(st, "fr_fr")).toMatchObject({
      ids: ["I", "J"],
      texts: ["fr", "only en"],
    });
    expect(buildRuntimeOf(st, "ja_jp")).toMatchObject({
      ids: ["I", "J"],
      texts: ["src", "only en"],
    });
  });

  it("takes a language list and an output folder, inside the project only", () => {
    okRun({
      action: "buildRuntime",
      path: ST,
      languages: ["fr_fr"],
      outDir: "Out/Rt",
      confirm: true,
    });
    expect(read("Out/Rt/Test.fr_fr.conf")).toBe(OUT_EN.replace('"Bee"', '"Bee"'));
    expect(existsSync(at("Language/Test.fr_fr.conf"))).toBe(false);
    expect(failRun({ action: "buildRuntime", path: ST, outDir: "../escape" }).code).toBe(
      "ABSOLUTE_PATH",
    );
    expect(failRun({ action: "buildRuntime", path: ST, languages: ["fr"] }).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      failRun({ action: "buildRuntime", path: ST, languages: ["fr_fr", "fr_fr"] }).message,
    ).toContain("twice");
    expect(failRun({ action: "buildRuntime", path: ST, languages: [] }).message).toContain("empty");
  });

  it("does not replace existing tables without overwrite, and writes none of them when one blocks", () => {
    put("Language/Test.de_de.conf", "keep me");
    const f = failRun({ action: "buildRuntime", path: ST, confirm: true });
    expect(f.message).toContain("Language/Test.de_de.conf");
    expect(read("Language/Test.de_de.conf")).toBe("keep me");
    expect(existsSync(at("Language/Test.en_us.conf"))).toBe(false);
    // With overwrite, an existing file that is not a runtime table is still left alone.
    const g = failRun({ action: "buildRuntime", path: ST, overwrite: true, confirm: true });
    expect(g.message).toContain("not a runtime string table");
    expect(read("Language/Test.de_de.conf")).toBe("keep me");
    expect(existsSync(at("Language/Test.en_us.conf"))).toBe(false);
  });

  it("with overwrite answers what changes in an existing runtime table, then replaces it", () => {
    put("Language/Test.en_us.conf", emitRuntime(["STR_B", "OLD"], ["Bee old", "gone"]));
    okRun({
      action: "buildRuntime",
      path: ST,
      languages: ["en_us"],
      confirm: true,
      overwrite: true,
    });
    expect(read("Language/Test.en_us.conf")).toBe(OUT_EN);
    put("Language/Test.en_us.conf", emitRuntime(["STR_B", "OLD"], ["Bee old", "gone"]));
    const dry = okRun({ action: "buildRuntime", path: ST, languages: ["en_us"], overwrite: true });
    const file = (dry.readback as { files: Record<string, unknown>[] }).files[0];
    expect(file).toMatchObject({ replaces: true, added: 1, removed: 1, changed: 1 });
    expect(read("Language/Test.en_us.conf")).toBe(
      emitRuntime(["STR_B", "OLD"], ["Bee old", "gone"]),
    );
    expect(dry.changed?.[0].before).toMatchObject({ ids: 2 });
  });

  it("keeps the first of a repeated Id and says so", () => {
    put("Language/Dup2.st", FIXTURE.replace('Id "STR_C"', 'Id "STR_B"'));
    const r = okRun({ action: "buildRuntime", path: "Language/Dup2.st", languages: ["en_us"] });
    expect(r.warnings.join(" ")).toContain("STR_B");
  });

  it("the tables built are found again by lookup", () => {
    okRun({ action: "buildRuntime", path: ST, confirm: true });
    const rb = okRun({
      action: "lookup",
      path: "Language/Test.en_us.conf",
      ids: ["STR_B"],
      languages: ["en_us", "de_de", "fr_fr"],
    }).readback as {
      rows: { texts: Record<string, string> }[];
      languagesMissing: string[];
    };
    expect(rb.rows[0].texts).toEqual({ en_us: "Bee", de_de: "Biene" });
    expect(rb.languagesMissing).toEqual(["fr_fr"]);
  });
});

describe("string_table guards", () => {
  it("refuses a path that leaves the project, for reads and for writes", () => {
    expect(
      failRun({ action: "create", path: "../outside.st", items: [{ Id: "A" }], confirm: true })
        .code,
    ).toBe("ABSOLUTE_PATH");
    expect(
      failRun({
        action: "create",
        path: "Language/../../outside.st",
        items: [{ Id: "A" }],
        confirm: true,
      }).code,
    ).toBe("ABSOLUTE_PATH");
    expect(failRun({ action: "upsert", path: "..\\outside.st", items: [{ Id: "A" }] }).code).toBe(
      "ABSOLUTE_PATH",
    );
    expect(failRun({ action: "inspect", path: "../outside.st" }).code).toBe("ABSOLUTE_PATH");
    const other = mkdtempSync(join(tmpdir(), "string-table-other-"));
    try {
      const outside = join(other, "x.st");
      writeFileSync(outside, FIXTURE);
      expect(failRun({ action: "inspect", path: outside }).code).toBe("ABSOLUTE_PATH");
      expect(
        failRun({
          action: "create",
          path: join(other, "y.st"),
          items: [{ Id: "A" }],
          confirm: true,
        }).code,
      ).toBe("ABSOLUTE_PATH");
      expect(existsSync(join(other, "y.st"))).toBe(false);
      expect(
        failRun({ action: "upsert", path: outside, items: [{ Id: "A" }], confirm: true }).code,
      ).toBe("ABSOLUTE_PATH");
      expect(readFileSync(outside, "utf8")).toBe(FIXTURE);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    expect(failRun({ action: "inspect", path: "-rf" }).code).toBe("INVALID_ARGUMENT");
  });

  it("an absolute path inside the project is fine", () => {
    makeFixture("Language/Abs.st");
    expect(
      (okRun({ action: "inspect", path: at("Language/Abs.st") }).readback as { items: number })
        .items,
    ).toBe(3);
  });

  it("writes need a project", () => {
    const bare = { projectPath: "", gamePath: "", dataDir: DATA } as Config;
    for (const action of ["create", "upsert", "remove", "buildRuntime"] as const) {
      const r = runStringTable(bare, { action, path: "A.st", items: [{ Id: "A" }], ids: ["A"] });
      expect(r.ok).toBe(false);
      expect((r as ActionError).code).toBe("NOT_IN_PROJECT");
    }
  });

  it("a projectPath outside the configured root is refused", () => {
    const other = mkdtempSync(join(tmpdir(), "string-table-out-"));
    try {
      const r = runStringTable(config, {
        action: "create",
        path: "A.st",
        items: [{ Id: "A" }],
        confirm: true,
        projectPath: other,
      });
      expect((r as ActionError).code).toBe("NOT_IN_PROJECT");
      expect(existsSync(join(other, "A.st"))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("a projectPath argument takes the place of the configured one", () => {
    // Under the configured root: any project there is allowed (DEC-058).
    const other = mkdtempSync(join(dir, "string-table-arg-"));
    try {
      const r = runStringTable(config, {
        action: "create",
        path: "A.st",
        items: [{ Id: "A" }],
        confirm: true,
        projectPath: other,
      });
      expect(r.ok).toBe(true);
      expect(readFileSync(join(other, "A.st"), "utf8")).toContain('Id "A"');
      expect(existsSync(at("A.st"))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("registration", () => {
  it("registers string_table with a description within 400 characters and answers as JSON", async () => {
    type Handler = (
      a: Record<string, unknown>,
    ) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    let name = "";
    let desc = "";
    let handler: Handler = async () => ({ content: [] });
    registerStringTable(
      {
        registerTool: (n: string, def: { description: string }, h: Handler) => {
          name = n;
          desc = def.description;
          handler = h;
        },
      } as never,
      config,
    );
    expect(name).toBe("string_table");
    expect(desc).toBe(STRING_TABLE_DESCRIPTION);
    expect(desc.length).toBeLessThanOrEqual(400);
    makeFixture("Language/Reg.st");
    const ok = await handler({ action: "inspect", path: "Language/Reg.st", prefix: undefined });
    expect(JSON.parse(ok.content[0].text).ok).toBe(true);
    expect(ok.isError).toBeUndefined();
    const bad = await handler({ action: "inspect", path: "Language/None.st" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).code).toBe("PATH_NOT_FOUND");
  });
});

// ── The vanilla corpus ───────────────────────────────────────────────────────
// No `.st` ships in the paks. The grammar both file types share (BaseContainer
// text) is measured on the vanilla runtime tables, the one string-table type
// the game ships; the `.st` side is covered by the fixtures above.

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
if (open.skip !== undefined) console.warn(`[string_table] corpus SKIPPED: ${open.skip}`);

describe.skipIf(open.skip !== undefined)(
  `vanilla runtime string tables${open.skip ? ` (SKIPPED: ${open.skip})` : ""}`,
  () => {
    const corpus = open.corpus!;
    const files = open.corpus
      ? corpus
          .list("conf")
          .filter((p) => /(^|\/)language\//i.test(p))
          .filter((p) => corpus.read(p).subarray(0, 18).toString("utf8") === "StringTableRuntime")
      : [];

    it("finds the base game's runtime tables", () => {
      expect(files.length).toBeGreaterThanOrEqual(14);
    });

    it("the parser gives every file back byte for byte", () => {
      const off = files.filter(
        (p) => !parseCstBytes(corpus.read(p)).toBytes().equals(corpus.read(p)),
      );
      console.log(`[string_table] parser byte-exact: ${files.length - off.length}/${files.length}`);
      expect(off).toEqual([]);
    });

    it("reading then writing gives every file back byte for byte (parse -> model -> emit)", () => {
      const off: string[] = [];
      let entries = 0;
      for (const p of files) {
        const buf = corpus.read(p);
        const rt = readRuntime(parseCstBytes(buf));
        entries += rt.ids.length;
        if (rt.ids.length !== rt.texts.length)
          off.push(`${p}: ${rt.ids.length} ids, ${rt.texts.length} texts`);
        else if (emitRuntime(rt.ids, rt.texts, rt.eol) !== buf.toString("utf8")) off.push(p);
      }
      console.log(
        `[string_table] model round trip byte-exact: ${files.length - off.length}/${files.length} files, ${entries} entries`,
      );
      expect(off).toEqual([]);
    });

    it("the Ids of every file are in the order buildRuntime writes", () => {
      for (const p of files) {
        const rt = readRuntime(parseCstBytes(corpus.read(p)));
        const sorted = [...rt.ids].sort(idOrder);
        expect(rt.ids, p).toEqual(sorted);
      }
    });

    it("lookup answers base-game keys in every language from the paks", () => {
      const real = { ...loadConfig(), projectPath: "" } as Config;
      const r = runStringTable(real, { action: "lookup", prefix: "AR-Account_Email", limit: 5 });
      expect(r.ok).toBe(true);
      const rb = (r as ActionOk).readback as {
        languagesRead: string[];
        rows: { Id: string; texts: Record<string, string> }[];
        sources: Record<string, string>;
      };
      expect(rb.languagesRead).toHaveLength(13);
      expect(new Set(Object.values(rb.sources))).toEqual(new Set(["game"]));
      expect(rb.rows.length).toBeGreaterThan(0);
      expect(rb.rows[0].texts.en_us).toBeTruthy();
      const one = runStringTable(real, {
        action: "lookup",
        ids: [rb.rows[0].Id],
        languages: ["de_de", "ja_jp"],
      });
      expect(
        ((one as ActionOk).readback as { rows: { texts: Record<string, string> }[] }).rows[0].texts
          .de_de,
      ).toBeTruthy();
    });

    it("inspect, get and lint read a base-game table from the paks without a project", () => {
      const real = { ...loadConfig(), projectPath: "" } as Config;
      const path = "ui/language/default.en_us.conf";
      const insp = runStringTable(real, { action: "inspect", path });
      expect(insp.ok).toBe(true);
      expect(((insp as ActionOk).readback as { ids: number }).ids).toBe(6);
      const got = runStringTable(real, { action: "get", path, prefix: "ENF-Hold" });
      expect(
        ((got as ActionOk).readback as { rows: { Id: string }[] }).rows.map((r) => r.Id),
      ).toEqual(["ENF-HoldModifier", "ENF-HoldOnceModifier"]);
      expect(runStringTable(real, { action: "lint", path }).ok).toBe(true);
    });

    it("a game table is read only: the writes refuse it", () => {
      const real = { ...loadConfig(), projectPath: dir } as Config;
      const r = runStringTable(real, {
        action: "upsert",
        path: "Language/localization.en_us.conf",
        items: [{ Id: "A" }],
        confirm: true,
      });
      expect(r.ok).toBe(false);
      expect((r as ActionError).message).toContain(".st");
      const c = runStringTable(real, {
        action: "create",
        path: "Language/localization.en_us.conf",
        items: [{ Id: "A" }],
        confirm: true,
      });
      expect(c.ok).toBe(false);
      expect(existsSync(at("Language/localization.en_us.conf"))).toBe(false);
    });
  },
);

// Census rows this file tests (W3 close-out, EV-W3-099).
// census:mcp:action/string_table.buildRuntime
// census:mcp:action/string_table.create
// census:mcp:action/string_table.get
// census:mcp:action/string_table.inspect
// census:mcp:action/string_table.lint
// census:mcp:action/string_table.lookup
// census:mcp:action/string_table.remove
// census:mcp:action/string_table.upsert
