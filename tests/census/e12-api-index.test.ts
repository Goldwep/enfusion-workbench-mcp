/**
 * E12 API-index reconcile: the line-keeping JSON reader, the signature and
 * type helpers, the Doxygen block scan, the comparison of a synthetic API
 * index with synthetic sources, the observation rows and their acceptance by
 * the ledger (merging with E02's rows), determinism, the CLI, and (when the
 * source index and the game exist) the headline counts of build 1.8.0.13. Two
 * rules of the comparison have their own blocks: the pairing of a source class
 * with the index page whose name differs only in case (`typename` and
 * `TypeName`), and the inactive-branch alternatives (a guarded method the index
 * lacks whose same-named sibling in the opposite branch it holds), each with
 * its refusals. Synthetic inputs only; no vanilla file is copied into the
 * repository.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLedger } from "../../src/census/build-ledger.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { deriveId } from "../../src/census/ids.js";
import { sha256 } from "../../src/census/canon.js";
import { observationHeaderSchema, observationSchema } from "../../src/census/schemas.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  saveSourceIndex,
  sourceIndexPath,
  type SourceInput,
} from "../../src/census/source-index.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { WORKBENCH_SCOPE as E02_SCOPE } from "../../scripts/census/enumerators/e02-script-source.js";
import * as E02 from "../../scripts/census/enumerators/e02-script-source.js";
import {
  API_FILES,
  ENUMERATOR_ID,
  GENERATOR,
  INACTIVE_BRANCH_CAUSE,
  WORKBENCH_SCOPE,
  analyze,
  indexClassLookup,
  inWorkbenchScope,
  normalizeClassName,
  normalizeReturn,
  normalizeType,
  observationFileText,
  parseApiIndex,
  parseJsonWithNameLines,
  readE02Rows,
  reportText,
  resolveOut,
  run,
  scanDocBlocks,
  signatureArity,
  sha256Lf,
  signatureName,
  splitInactiveAlternatives,
  splitSignatureParams,
  type DiffReport,
} from "../../scripts/census/enumerators/e12-api-index.js";
import { artifactsDir } from "../../scripts/live/paths.js";
import { censusPaths } from "../../src/census/ledger-io.js";
import { REPO_ROOT, makeCensus, runIn } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic inputs ─────────────────────────────────────────────────────────

const BUILD = "1.0.0.1";

/** A source tree: one scope class with a swallowed block, ancestors, overloads, templates. */
const SOURCES: SourceInput[] = [
  {
    path: "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c",
    text: [
      "sealed class WorldEditorAPI",
      "{",
      "\tprivate void WorldEditorAPI();",
      "\tprivate void ~WorldEditorAPI();",
      "\t/*!",
      "\tBegins an action. More text.",
      "\t\\code",
      "\tapi.Begin();",
      "\t/endcode",
      "\t*/",
      '\tproto external bool BeginEntityAction(string name = "");',
      "\tproto external bool EndEntityAction();",
      "\tproto external int GetCount(int a, int b);",
      "\t/*!",
      "\t\\code",
      "\tx",
      "\t\\endcode",
      "\t*/",
      "\tproto external void Reset();",
      "\tproto external void Tidy();",
      "}",
    ].join("\n"),
  },
  {
    path: "scripts/Game/Base.c",
    text: [
      "class Base",
      "{",
      "\tvoid Hello();",
      "\tvoid Shared(int a);",
      "}",
      "class Derived : Base",
      "{",
      "\tvoid Own();",
      "\tprivate void Hidden();",
      "\tvoid Generic(map<string, int> m);",
      "\tvoid Narrow(int a, int b);",
      "\ttypename Kind();",
      "#ifdef SOME_FLAG",
      "\tvoid Guarded();",
      "#endif",
      "#ifdef OTHER_FLAG",
      "\tvoid ~Derived();",
      "#endif",
      "}",
      "class NotInIndex",
      "{",
      "\tvoid A();",
      "\tvoid B();",
      "}",
      "class Over",
      "{",
      "\tvoid Add(int a);",
      "\tvoid Add(float a);",
      "\tvoid Trunc(int a, Color c = Color.FromInt(1));",
      "\tstatic void S();",
      "\tprotected static void PS();",
      "\tevent void OnX();",
      "}",
      "class Typed",
      "{",
      "\tnotnull Base Get();",
      "\tint Wrong(int a);",
      "\tvoid Typed();",
      "}",
    ].join("\n"),
  },
  { path: "scripts/Game/Mod.c", text: "modded class Derived\n{\n\tvoid Extra();\n}\n" },
  {
    path: "scripts/WorkbenchGame/ResourceManager/MyTool.c",
    text: [
      '[WorkbenchToolAttribute("My", "d", "", "", {"ResourceManager"})]',
      "class MyTool : Base",
      "{",
      "\toverride void Run();",
      "\tvoid Own2(int a);",
      "}",
      "class Unlisted",
      "{",
      "}",
    ].join("\n"),
  },
];

interface M {
  sig: string;
  array?: "methods" | "protectedMethods" | "staticMethods";
  /** Override the params array (to model the scraper splitting a generic's commas). */
  params?: { name: string; type: string; defaultValue: string }[];
  description?: string;
}

/** A method object as the scraper writes it: Doxygen anchor name, signature, params. */
function apiMethod(m: M): Record<string, unknown> {
  const sig = m.sig;
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  const body = sig.slice(open + 1, close).trim();
  const params =
    m.params ??
    (body === ""
      ? []
      : body.split(",").map((p) => {
          const t = p.trim().split("=")[0].trim();
          const bits = t.split(/\s+/);
          const name = bits.pop() ?? "";
          return { name, type: bits.join(" "), defaultValue: "" };
        }));
  const head = sig.slice(0, open).trim().split(/\s+/);
  const name = head.pop() ?? "";
  return {
    name: name + params.map((p) => p.type.replace(/\W/g, "")).join(""),
    returnType: head.join(" "),
    signature: sig,
    params,
    description: m.description ?? "",
  };
}

function apiClass(name: string, methods: M[], extra: Record<string, unknown> = {}): unknown {
  const by = (a: "methods" | "protectedMethods" | "staticMethods") =>
    methods
      .filter(
        (m) =>
          (m.array ?? (/\bstatic\b/.test(m.sig.split("(")[0]) ? "staticMethods" : "methods")) === a,
      )
      .map(apiMethod);
  return {
    name,
    source: "enfusion",
    brief: "",
    description: "",
    parents: [],
    children: [],
    group: "",
    sourceFile: "",
    methods: by("methods"),
    protectedMethods: by("protectedMethods"),
    staticMethods: by("staticMethods"),
    enums: [],
    properties: [],
    protectedProperties: [],
    docsUrl: "",
    ...extra,
  };
}

const ENFUSION_CLASSES = [
  apiClass(
    "WorldEditorAPI",
    [
      {
        sig: 'proto external bool BeginEntityAction (string name="")',
        description: "Begins an action. More.",
      },
      { sig: "proto external void Reset ()" },
      { sig: "proto external void Tidy ()" },
    ],
    { description: "The world editor API." },
  ),
  apiClass("Base", [{ sig: "void Hello ()" }, { sig: "void Shared (int a)" }]),
  apiClass("Derived", [
    { sig: "void Own ()" },
    { sig: "void Hello ()" },
    { sig: "void Shared (int a)" },
    // The scraper split the generic's comma: its params array holds two entries, the signature one.
    {
      sig: "void Generic (map< string, int > m)",
      params: [
        { name: "m", type: "map< string", defaultValue: "" },
        { name: "int > m", type: "int", defaultValue: "" },
      ],
    },
    { sig: "TypeName Kind ()" },
    { sig: "void Invented (int a)" },
    // Declared with two parameters in the source: a real arity difference.
    { sig: "void Narrow (int a)" },
  ]),
  apiClass("Over", [
    { sig: "void Add (int a)" },
    { sig: "void Add (float a)" },
    // The scraper cut the params array short after a default that holds a call.
    {
      sig: "void Trunc (int a, Color c=Color.FromInt(1))",
      params: [{ name: "a", type: "int", defaultValue: "" }],
    },
    { sig: "static void S ()" },
    { sig: "void OnX ()" },
  ]),
  apiClass("Typed", [{ sig: "notnull Base Get ()" }, { sig: "static int Wrong (int a)" }]),
  apiClass("MyTool", [
    { sig: "override void Run ()" },
    { sig: "void Own2 (int a)" },
    { sig: "void Hello ()" },
  ]),
  apiClass("Unlisted", []),
];
const ARMA_CLASSES = [
  apiClass("Tuple1< Class T1 > Interface Template Reference", [{ sig: "void T ()" }]),
  apiClass("Extra", []),
];

/** The index files as stored: indented JSON with CRLF line ends, like the scraper's output. */
const fileText = (v: unknown): string => JSON.stringify(v, null, 2).replace(/\n/g, "\r\n");
const API_TEXT = [fileText(ENFUSION_CLASSES), fileText(ARMA_CLASSES)];
const apiFiles = () => API_FILES.map((f, i) => parseApiIndex(f, API_TEXT[i]));

const sourceIndex = () => buildSourceIndex(SOURCES, { build: BUILD });
const linesOf = (p: string): string[] | undefined =>
  SOURCES.find((s) => s.path === p)?.text.split("\n");

function e02Text(): string {
  const ix = sourceIndex();
  return E02.observationFileText(E02.observationRows(ix, linesOf), ix, BUILD);
}

function analysis(withDocs = true, withE02 = true) {
  const index = sourceIndex();
  const docs = withDocs
    ? scanDocBlocks(SOURCES.map((s) => ({ file: s.path, text: s.text })))
    : undefined;
  return analyze({
    build: BUILD,
    index,
    api: apiFiles(),
    inputs: [{ path: "<repo>/data/api/enfusion-classes.json", sha256: "0".repeat(64) }],
    docs,
    e02: withE02 ? readE02Rows(e02Text()) : undefined,
  });
}

// ── The line-keeping JSON reader ─────────────────────────────────────────────

describe("parseJsonWithNameLines", () => {
  it("reads what JSON.parse reads and records the stored line of every name key (CRLF and LF)", () => {
    const value = [
      { name: 'A\u00e9"q\\', list: [1, -2.5e3, true, false, null, {}], nested: { name: "inner" } },
      { other: "x", name: "B" },
    ];
    for (const eol of ["\n", "\r\n"]) {
      const text = JSON.stringify(value, null, 2).replace(/\n/g, eol);
      const r = parseJsonWithNameLines(text);
      expect(r.value).toEqual(value);
      const lines = text.split(/\r?\n/);
      const arr = r.value as Record<string, unknown>[];
      const a = r.nameLines.get(arr[0]);
      expect(a && lines[a.line - 1].trim()).toBe(a?.text);
      expect(a?.text.startsWith('"name": "A')).toBe(true);
      const inner = r.nameLines.get(arr[0].nested as object);
      expect(inner && lines[inner.line - 1].trim()).toBe('"name": "inner"');
      const b = r.nameLines.get(arr[1]);
      expect(b?.text).toBe('"name": "B"');
      expect(b && lines[b.line - 1].includes(b.text)).toBe(true);
    }
  });

  it("throws on malformed text and ignores a BOM", () => {
    expect(() => parseJsonWithNameLines("[1, 2")).toThrow(/line 1/);
    expect(() => parseJsonWithNameLines('{"a" 1}')).toThrow(/':'/);
    expect(() => parseJsonWithNameLines("[1] x")).toThrow(/trailing/);
    expect(parseJsonWithNameLines("\ufeff[1]").value).toEqual([1]);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

describe("signature and type helpers", () => {
  it("reads names, arities and page titles", () => {
    expect(signatureName("proto external void SetDebug (int debugMode)")).toBe("SetDebug");
    expect(signatureName("void ~Thing ()")).toBe("~Thing");
    expect(signatureName("no parens")).toBeUndefined();
    expect(signatureArity("void F ()")).toBe(0);
    expect(signatureArity("void F (int a, int b=2)")).toBe(2);
    expect(signatureArity("void F (map< string, int > m, int x)")).toBe(2);
    expect(splitSignatureParams("void F (notnull map< string, ref Foo > m=null, int x)")).toEqual([
      "notnull map< string, ref Foo > m=null",
      "int x",
    ]);
    expect(signatureArity('void F (string a="x,y", vector v=Vector(1, 2, 3),)')).toBe(2);
    expect(normalizeClassName("Tuple2< Class T1, Class T2 > Interface Template Reference")).toBe(
      "Tuple2",
    );
    expect(normalizeClassName("WorldEditorAPI")).toBe("WorldEditorAPI");
    expect(normalizeClassName("Foo Interface Reference")).toBe("Foo");
  });

  it("hashes text with CRLF read as LF", () => {
    expect(sha256Lf(Buffer.from("a\r\nb\r\n"))).toBe(sha256(Buffer.from("a\nb\n")));
    expect(sha256Lf(Buffer.from("a\nb\n"))).toBe(sha256(Buffer.from("a\nb\n")));
    expect(sha256Lf(Buffer.from("a\rb"))).toBe(sha256(Buffer.from("a\rb")));
  });

  it("compares types without whitespace, case of typename, ref and return notnull", () => {
    expect(normalizeType("array< ref Foo >")).toBe(normalizeType("array<ref Foo>"));
    expect(normalizeType("TypeName")).toBe(normalizeType("typename"));
    expect(normalizeType("out notnull Foo")).toBe(normalizeType("notnull out Foo"));
    expect(normalizeType("ref Foo")).toBe(normalizeType("Foo"));
    expect(normalizeType("out int")).not.toBe(normalizeType("int"));
    expect(normalizeReturn("notnull Foo")).toBe(normalizeReturn("Foo"));
  });

  it("keeps the scope equal to E02's", () => {
    expect([...WORKBENCH_SCOPE]).toEqual([...E02_SCOPE]);
    expect(inWorkbenchScope("scripts/WorkbenchGame/X.c")).toBe(true);
    expect(inWorkbenchScope("scripts/Game/X.c")).toBe(false);
  });
});

// ── The Doxygen block scan ───────────────────────────────────────────────────

describe("scanDocBlocks", () => {
  it("finds a /endcode typo, the block it leaves open and where the next closer is", () => {
    const { scan, byFile } = scanDocBlocks([
      {
        file: "scripts/A.c",
        text: [
          "/*!",
          "\\code",
          "x",
          "/endcode",
          "*/",
          "void F();",
          "//! \\code",
          "//! \\endcode",
          "void G();",
        ].join("\n"),
      },
    ]);
    expect(scan.typos).toEqual([
      { file: "scripts/A.c", line: 4, token: "/endcode", kind: "slash", region_open_line: 2 },
    ]);
    expect(scan.regions).toEqual([
      {
        file: "scripts/A.c",
        open_line: 2,
        command: "code",
        typo_lines: [4],
        reopened_lines: [7],
        close_line: 8,
      },
    ]);
    expect(byFile.get("scripts/A.c")).toHaveLength(1);
    expect(scan.files_with_typo).toBe(1);
    expect(scan.files_with_unterminated_block).toBe(1);
  });

  it("flags an unterminated block and a bare endcode, and ignores balanced blocks and text outside comments", () => {
    const { scan } = scanDocBlocks([
      { file: "scripts/B.c", text: "/*!\n\\code\nx\n\\endcode\n*/\nvoid F();\n" },
      { file: "scripts/C.c", text: "//! @code\nvoid F();\nvoid G();\n" },
      { file: "scripts/D.c", text: "//! text\n//! endcode\nvoid F();\n" },
      { file: "scripts/E.c", text: 'string s = "/endcode and \\\\code";\nvoid F();\n' },
      { file: "scripts/F.c", text: "//! \\endcode\nvoid F();\n" },
    ]);
    expect(scan.files_scanned).toBe(5);
    expect(scan.regions.map((r) => [r.file, r.open_line, r.close_line])).toEqual([
      ["scripts/C.c", 1, null],
    ]);
    expect(scan.typos.map((t) => [t.file, t.line, t.kind])).toEqual([["scripts/D.c", 2, "bare"]]);
    expect(scan.stray_closers).toEqual([{ file: "scripts/F.c", line: 1, token: "\\endcode" }]);
  });
});

// ── Comparison and rows ──────────────────────────────────────────────────────

describe("synthetic index versus synthetic sources", () => {
  it("reads the index: titles, anchors, arity, static, protected and stored lines", () => {
    const [enf, arma] = apiFiles();
    expect(enf.classes.map((c) => c.name)).toContain("WorldEditorAPI");
    const tuple = arma.classes[0];
    expect(tuple.raw_name).toBe("Tuple1< Class T1 > Interface Template Reference");
    expect(tuple.name).toBe("Tuple1");
    expect(tuple.mangled).toBe(true);
    const wea = enf.classes[0];
    const begin = wea.methods[0];
    expect(begin).toMatchObject({
      name: "BeginEntityAction",
      arity: 1,
      static: false,
      raw_name: "BeginEntityActionstring",
    });
    const lines = API_TEXT[0].split(/\r?\n/);
    expect(lines[wea.line - 1].trim()).toBe(wea.quote);
    expect(lines[begin.line - 1].trim()).toBe(begin.quote);
    // The arity is the signature's, not the length of the split params array.
    const generic = enf.classes
      .find((c) => c.name === "Derived")
      ?.methods.find((m) => m.name === "Generic");
    expect(generic).toMatchObject({ arity: 1, params_length: 2 });
    expect(generic?.param_types).toEqual(["map< string, int >"]);
    expect(begin.params_length).toBe(1);
    const over = enf.classes.find((c) => c.name === "Over");
    expect(over?.methods.find((m) => m.name === "S")?.static).toBe(true);
    expect(over?.counts).toEqual({ public: 4, protected: 0, static: 1 });
  });

  it("finds what the source has and the index lost, and explains the WorldEditorAPI loss by the typo", () => {
    const { report, comparisons } = analysis();
    const h = report.headline as Record<string, Record<string, unknown>>;
    // WorldEditorAPI: 5 declared + 2 private; the index holds 3 of the 5. Begin sits in the
    // swallowed block too but the index has it: only absence counts.
    const wea = report.worldeditorapi;
    expect(wea).toMatchObject({
      methods_in_source: 7,
      private_constructor_destructor: 2,
      methods_declared_public_or_protected: 5,
      methods_in_index: 3,
      lost: 2,
      lost_names: ["EndEntityAction/0", "GetCount/2"],
      methods_inside_typo_regions: ["BeginEntityAction/1", "EndEntityAction/0", "GetCount/2"],
      lost_equals_inside_typo_regions: false,
    });
    expect(wea.typo_regions).toEqual([{ open_line: 7, typo_lines: [9], close_line: 17 }]);
    expect(
      comparisons
        .get("WorldEditorAPI")
        ?.lost.map((m) => m.name)
        .sort(),
    ).toEqual(["EndEntityAction", "GetCount", "WorldEditorAPI", "~WorldEditorAPI"]);
    expect(h.classes).toMatchObject({
      in_source: 8,
      in_both: 7,
      missing_from_index: 1,
      in_index_not_in_source: 2,
    });
  });

  it("counts classes missing from the index, index-only classes, inheritance, arity and causes", () => {
    const { report } = analysis();
    const missing = report.classes_missing_from_index.map((c) => c.class);
    expect(missing).toEqual(["NotInIndex"]);
    expect(report.classes_in_index_not_in_source.map((c) => c.raw_name)).toEqual([
      "Extra",
      "Tuple1< Class T1 > Interface Template Reference",
    ]);
    expect(report.classes_in_index_not_in_source[1]).toMatchObject({
      class: "Tuple1",
      page_title_not_class_name: true,
    });
    const derived = report.classes.find((c) => c.class === "Derived") as Record<string, unknown>;
    // Hello and Shared come from Base: listed, not own, not index-only.
    expect(derived.inherited_entries).toBe(2);
    const notInSource = (derived.not_in_source as { name: string; arity: number }[]).map(
      (e) => `${e.name}/${e.arity}`,
    );
    // Generic is paired at arity 1 (the signature's count), so it is neither index-only nor lost.
    expect(notInSource.sort()).toEqual(["Invented/1", "Narrow/1"]);
    expect(report.arity_differences).toEqual([
      expect.objectContaining({
        class: "Derived",
        method: "Narrow",
        source_arity: 2,
        index_arity: 1,
        index_params_length: 1,
      }),
    ]);
    // The scraper's params arrays: one split inside a generic (Generic), one cut short (Trunc).
    expect(report.headline.methods).toMatchObject({
      index_entries_params_array_longer_than_signature: 1,
      index_entries_params_array_shorter_than_signature: 1,
      arity_differences: 1,
    });
    const lost = (derived.lost as { name: string; cause: string }[]).map(
      (l) => `${l.name}:${l.cause}`,
    );
    // A destructor missing under an #ifdef is lost to the guard, not to being a destructor.
    expect(lost.sort()).toEqual([
      "Guarded:preprocessor-guard",
      "Narrow:arity-differs-in-index",
      "~Derived:preprocessor-guard",
    ]);
    expect(derived.unpaired_not_expected).toEqual([
      expect.objectContaining({ name: "Hidden", reason: "private" }),
      expect.objectContaining({ name: "Extra", reason: "modded class" }),
    ]);
    // Over: a protected static method has no index entry.
    const over = report.classes.find((c) => c.class === "Over") as Record<string, unknown>;
    expect(
      (over.lost as { name: string; cause: string }[]).map((l) => `${l.name}:${l.cause}`),
    ).toEqual(["PS:protected-static-method"]);
    expect(report.loss_causes).toMatchObject({
      "arity-differs-in-index": 1,
      "class-missing-from-index": 2,
      "constructor-or-destructor": 1,
      "doxygen-block-typo": 2,
      "preprocessor-guard": 2,
      "protected-static-method": 1,
    });
  });

  it("reports signature differences and treats typename, notnull and event as the same thing", () => {
    const { report } = analysis();
    // Typed.Wrong: the index says static, the source does not; Kind and Get compare equal.
    expect(report.signature_differences.counts).toMatchObject({ static: 1, event: 1 });
    expect(
      report.signature_differences.examples.map((e) => `${e.class}.${e.method}:${e.field}`),
    ).toEqual(["Typed.Wrong:static"]);
  });

  it("emits class and method rows with E02's keys, kinds and modules, and leaves inherited entries out", () => {
    const { rows, report } = analysis();
    const byId = new Map(rows.observations.map((o) => [o.id, o.obs]));
    // Scope classes: WorldEditorAPI, MyTool, Unlisted (the index holds all three).
    expect([...byId.keys()].filter((id) => !id.includes(".")).sort()).toEqual([
      "api:MyTool",
      "api:Unlisted",
      "api:WorldEditorAPI",
    ]);
    expect(byId.get("api:WorldEditorAPI")).toMatchObject({
      kind: "class",
      module: "WorldEditor",
      parent_key: null,
      children_count: 3,
      what: "The world editor API.",
    });
    expect(byId.get("api:WorldEditorAPI.BeginEntityAction/1")).toMatchObject({
      kind: "method",
      module: "WorldEditor",
      what: "Begins an action.",
      signature: 'proto external bool BeginEntityAction (string name="")',
      confidence: "high",
      parent_key: {
        dim: "api",
        kind: "class",
        module: "WorldEditor",
        key: { class: "WorldEditorAPI" },
      },
    });
    // The arity E02 does not say: the index entry is emitted under its own key (E02 has /1 too here).
    expect(byId.get("api:MyTool.Run/0")).toMatchObject({
      kind: "method",
      module: "ResourceManager",
    });
    // Hello on MyTool is inherited from Base: not a row.
    expect(byId.has("api:MyTool.Hello/0")).toBe(false);
    expect(rows.inheritedLeftOut).toBe(1);
    expect(rows.scopeClasses).toBe(3);
    expect(rows.scopeClassesNotInIndex).toEqual([]);
    expect(rows.sharedWithE02).toBeGreaterThan(0);
    expect(rows.kindDisagreements).toEqual([]);
    expect(report.headline).toMatchObject({ rows: { total: rows.observations.length } });
    // Every row's ref cites the stored line and the quote is that line.
    const files: Record<string, string[]> = {
      "enfusion-classes.json": API_TEXT[0].split(/\r?\n/),
      "arma-classes.json": API_TEXT[1].split(/\r?\n/),
    };
    for (const { obs } of rows.observations) {
      const m = /^<repo>\/data\/api\/([^#]+)#L(\d+)$/.exec(obs.ref);
      expect(m).not.toBeNull();
      const line = files[m?.[1] ?? ""][Number(m?.[2]) - 1];
      expect(line.includes(obs.quote ?? "\u0000")).toBe(true);
      expect(containsMachinePath(JSON.stringify(obs))).toBe(false);
    }
  });

  it("emits an entry the source does not confirm as the index says it, and module none without an E02 row", () => {
    // A scope class whose index entry has an arity the source does not have.
    const sources: SourceInput[] = [
      {
        path: "scripts/Workbench/T.c",
        text: "class T\n{\n\tvoid Real(int a);\n\tstatic void Stat();\n}\n",
      },
    ];
    const index = buildSourceIndex(sources, { build: BUILD });
    const api = [
      parseApiIndex(
        "enfusion-classes.json",
        fileText([
          apiClass("T", [
            { sig: "void Real (int a, int b)" },
            { sig: "void Stat ()" },
            { sig: "void Real (int a)" },
          ]),
        ]),
      ),
      parseApiIndex("arma-classes.json", fileText([])),
    ];
    const a = analyze({ build: BUILD, index, api, inputs: [] });
    const ids = a.rows.observations.map((o) => o.id);
    expect(ids).toEqual(["api:T", "api:T.Real/1", "api:T.Real/2", "api:T.Stat/0"]);
    const byId = new Map(a.rows.observations.map((o) => [o.id, o.obs]));
    // Stat is static in the source but the index lists it in the public list: kind from the index.
    expect(byId.get("api:T.Stat/0")?.kind).toBe("method");
    expect(byId.get("api:T.Real/2")?.module).toBe("none");
    expect(a.rows.sharedWithE02).toBe(0);
    expect(a.report.signature_differences.counts).toMatchObject({ static: 1 });
  });

  it("merges entries that share a key and says why", () => {
    const sources: SourceInput[] = [
      {
        path: "scripts/Workbench/T.c",
        text: "class T\n{\n\tvoid Add(int a);\n\tvoid Add(float a);\n}\n",
      },
    ];
    const index = buildSourceIndex(sources, { build: BUILD });
    const api = [
      parseApiIndex(
        "enfusion-classes.json",
        fileText([apiClass("T", [{ sig: "void Add (int a)" }, { sig: "void Add (float a)" }])]),
      ),
      parseApiIndex("arma-classes.json", fileText([])),
    ];
    const a = analyze({ build: BUILD, index, api, inputs: [] });
    expect(a.rows.merges).toHaveLength(1);
    expect(a.rows.merges[0]).toMatchObject({ id: "api:T.Add/1", count: 2 });
    expect(a.rows.merges[0].reason).toContain("overloads");
    expect(a.rows.observations.map((o) => o.id)).toEqual(["api:T", "api:T.Add/1"]);
    expect(a.rows.observations[0].obs.children_count).toBe(1);
  });

  it("reads a class that the index holds in both files as one class", () => {
    const sources: SourceInput[] = [
      { path: "scripts/Workbench/T.c", text: "class T\n{\n\tvoid One();\n\tvoid Two();\n}\n" },
    ];
    const index = buildSourceIndex(sources, { build: BUILD });
    const api = [
      parseApiIndex("enfusion-classes.json", fileText([apiClass("T", [{ sig: "void One ()" }])])),
      parseApiIndex("arma-classes.json", fileText([apiClass("T", [{ sig: "void Two ()" }])])),
    ];
    const a = analyze({ build: BUILD, index, api, inputs: [] });
    expect(a.report.headline.api_index_duplicate_class_names).toEqual([
      { class: "T", files: ["enfusion-classes.json", "arma-classes.json"] },
    ]);
    expect(a.report.loss_causes).toEqual({});
    const refs = a.rows.observations.map((o) => o.obs.ref.split("#")[0].split("/").pop());
    expect(refs).toEqual(["enfusion-classes.json", "enfusion-classes.json", "arma-classes.json"]);
  });
});

// ── Class pairing by case ────────────────────────────────────────────────────

function analyzeSynthetic(sources: SourceInput[], classes: unknown[]) {
  const index = buildSourceIndex(sources, { build: BUILD });
  const api = [
    parseApiIndex("enfusion-classes.json", fileText(classes)),
    parseApiIndex("arma-classes.json", fileText([])),
  ];
  return analyze({ build: BUILD, index, api, inputs: [] });
}

describe("indexClassLookup", () => {
  const lookup = (names: string[], sources: string[], name: string) =>
    indexClassLookup(names, (n) => sources.includes(n))(name);

  it("takes the exact name, else the one page that differs only in case", () => {
    expect(lookup(["TypeName", "Other"], ["typename", "Other"], "Other")).toBe("Other");
    expect(lookup(["TypeName"], ["typename"], "typename")).toBe("TypeName");
    // The exact page wins over a case twin that is also in the index.
    expect(lookup(["Foo", "foo"], ["foo"], "foo")).toBe("foo");
    expect(lookup(["Foo"], ["bar"], "bar")).toBeUndefined();
  });

  it("refuses two pages that differ only in case, and a twin that is a source class", () => {
    expect(lookup(["TypeName", "TYPENAME"], ["typename"], "typename")).toBeUndefined();
    // TypeName is a source class itself: it is not a stand-in for typename.
    expect(lookup(["TypeName"], ["typename", "TypeName"], "typename")).toBeUndefined();
    // A twin that is a source class does not count towards the ambiguity: one page left.
    expect(lookup(["TypeName", "TYPENAME"], ["typename", "TypeName"], "typename")).toBe("TYPENAME");
  });
});

describe("a source class read against its case twin in the index", () => {
  const TYPENAME_SRC: SourceInput = {
    path: "scripts/Workbench/typename.c",
    text: [
      "class typename",
      "{",
      "\tproto native string ToString();",
      "\tproto native int Hash();",
      "\tprivate void Hidden();",
      "}",
    ].join("\n"),
  };
  const OTHER_SRC: SourceInput = {
    path: "scripts/Workbench/Other.c",
    text: "class Other\n{\n\tvoid A();\n}\n",
  };
  const typeNameClass = (name: string) =>
    apiClass(name, [
      { sig: "proto native string ToString ()" },
      { sig: "proto native int Hash ()" },
    ]);

  it("compares typename with TypeName: matched, not missing, not an index-only class, rows under the source name", () => {
    const a = analyzeSynthetic(
      [TYPENAME_SRC, OTHER_SRC],
      [typeNameClass("TypeName"), apiClass("Other", [{ sig: "void A ()" }])],
    );
    expect(a.report.headline.classes).toEqual({
      in_source: 2,
      in_both: 2,
      missing_from_index: 0,
      in_index_not_in_source: 0,
      paired_by_case: 1,
    });
    expect(a.report.classes_missing_from_index).toEqual([]);
    expect(a.report.classes_in_index_not_in_source).toEqual([]);
    expect(a.report.class_name_pairs).toEqual([
      { source: "typename", index: "TypeName", paired: true },
    ]);
    expect(a.report.headline.methods).toMatchObject({
      matched: 3,
      lost_in_indexed_classes: 0,
      in_classes_missing_from_index: 0,
      lost_total: 0,
      private_not_in_index: 1,
      index_entries_not_in_source: 0,
    });
    expect(a.report.per_script_module).not.toHaveProperty("(index only)");
    expect(a.comparisons.get("typename")?.pairs).toHaveLength(2);
    // The rows carry the source's class name and cite the index page that was read.
    const ids = a.rows.observations.map((o) => o.id);
    expect(ids).toEqual([
      "api:Other",
      "api:Other.A/0",
      "api:typename",
      "api:typename.Hash/0",
      "api:typename.ToString/0",
    ]);
    expect(a.rows.observations.find((o) => o.id === "api:typename")?.obs).toMatchObject({
      label: "typename",
      children_count: 2,
    });
    expect(a.rows.scopeClassesNotInIndex).toEqual([]);
    expect(a.report.headline.plugin_classes).toMatchObject({ missing_from_index: 0 });
  });

  it("compares the twin's methods: one the page lacks is lost, one the source lacks is index-only", () => {
    const a = analyzeSynthetic(
      [TYPENAME_SRC],
      [
        apiClass("TypeName", [
          { sig: "proto native string ToString ()" },
          { sig: "proto native int Invented ()" },
        ]),
      ],
    );
    expect(a.report.headline.methods).toMatchObject({
      matched: 1,
      lost_total: 1,
      index_entries_not_in_source: 1,
    });
    expect(a.report.loss_causes).toEqual({ unexplained: 1 });
  });

  it("refuses two index pages that differ only in case: the class stays missing", () => {
    const a = analyzeSynthetic(
      [TYPENAME_SRC],
      [typeNameClass("TypeName"), typeNameClass("TYPENAME")],
    );
    expect(a.report.headline.classes).toMatchObject({
      in_source: 1,
      in_both: 0,
      missing_from_index: 1,
      in_index_not_in_source: 2,
      paired_by_case: 0,
    });
    expect(a.report.classes_missing_from_index.map((c) => c.class)).toEqual(["typename"]);
    expect(a.report.class_name_pairs.map((p) => [p.source, p.index, p.paired]).sort()).toEqual([
      ["typename", "TYPENAME", false],
      ["typename", "TypeName", false],
    ]);
    expect(a.report.headline.methods).toMatchObject({
      matched: 0,
      in_classes_missing_from_index: 2,
      lost_total: 2,
    });
    expect(a.rows.scopeClassesNotInIndex).toEqual(["typename"]);
  });

  it("refuses a case twin that is itself a source class: typename stays missing, TypeName keeps its page", () => {
    const twin: SourceInput = {
      path: "scripts/Workbench/TypeName.c",
      text: "class TypeName\n{\n\tproto native string ToString();\n\tproto native int Hash();\n}\n",
    };
    const a = analyzeSynthetic([TYPENAME_SRC, twin], [typeNameClass("TypeName")]);
    expect(a.report.headline.classes).toMatchObject({
      in_source: 2,
      in_both: 1,
      missing_from_index: 1,
      in_index_not_in_source: 0,
      paired_by_case: 0,
    });
    expect(a.report.classes_missing_from_index.map((c) => c.class)).toEqual(["typename"]);
    expect(a.comparisons.get("TypeName")?.pairs).toHaveLength(2);
    expect(a.comparisons.has("typename")).toBe(false);
    expect(a.report.class_name_pairs).toEqual([]);
  });

  it("leaves a class that has no index page at all missing", () => {
    const a = analyzeSynthetic(
      [TYPENAME_SRC, OTHER_SRC],
      [apiClass("Other", [{ sig: "void A ()" }])],
    );
    expect(a.report.headline.classes).toMatchObject({ missing_from_index: 1, paired_by_case: 0 });
    expect(a.report.class_name_pairs).toEqual([]);
  });
});

// ── Inactive-branch alternatives ─────────────────────────────────────────────

describe("inactive-branch alternatives", () => {
  const ALT_SRC: SourceInput = {
    path: "scripts/Game/Inv.c",
    text: [
      "class Inv",
      "{",
      // Opposite branches of one conditional (#ifndef against its #else): the index holds the first.
      "#ifndef DISABLE_X",
      "\tvoid Open(int a);",
      "#else",
      "\tvoid Open(int a);",
      "#endif",
      // Opposite branches in two conditionals (#ifdef against #ifndef).
      "#ifdef WORKBENCH",
      "\tvoid Init();",
      "#endif",
      "#ifndef WORKBENCH",
      "\tvoid Init();",
      "#endif",
      // Name only: the other branch's body may have another arity.
      "#ifndef Y",
      "\tvoid Draw();",
      "#else",
      "\tvoid Draw(int a);",
      "#endif",
      // Refusal: the sibling is in the SAME branch.
      "#ifdef A",
      "\tvoid Close();",
      "\tvoid Close(int a);",
      "#endif",
      // Refusal: the sibling is under a different guard.
      "#ifdef A",
      "\tvoid Move();",
      "#endif",
      "#ifdef B",
      "\tvoid Move(int a);",
      "#endif",
      // Refusal: the sibling is not guarded.
      "\tvoid Plain();",
      "#ifdef A",
      "\tvoid Plain(int a);",
      "#endif",
      // Refusal: the opposite branch is itself missing from the index.
      "#ifdef C",
      "\tvoid Both();",
      "#else",
      "\tvoid Both(int a);",
      "#endif",
      // Refusal: nothing is guarded.
      "\tvoid Twice(int a);",
      "\tvoid Twice(int a);",
      "}",
    ].join("\n"),
  };
  const ALT_API = [
    apiClass("Inv", [
      { sig: "void Open (int a)" },
      { sig: "void Init ()" },
      { sig: "void Draw ()" },
      { sig: "void Close ()" },
      { sig: "void Move ()" },
      { sig: "void Plain ()" },
      { sig: "void Twice (int a)" },
    ]),
  ];

  it("keeps the other body of a method the index holds out of the loss count and lists it with its guard", () => {
    const a = analyzeSynthetic([ALT_SRC], ALT_API);
    const alt = a.report.inactive_branch_alternatives;
    expect(alt.count).toBe(3);
    expect(alt.methods.map((m) => `${m.name}/${m.arity}`)).toEqual(["Open/1", "Init/0", "Draw/1"]);
    expect(alt.methods.map((m) => m.guards)).toEqual([["DISABLE_X"], ["!WORKBENCH"], ["Y"]]);
    expect(alt.methods[0]).toMatchObject({
      class: "Inv",
      file: "scripts/Game/Inv.c",
      signature: "void Open(int a)",
      cause: INACTIVE_BRANCH_CAUSE,
      alternative_of: { file: "scripts/Game/Inv.c", guards: ["!DISABLE_X"] },
    });
    expect(alt.methods[1].alternative_of.guards).toEqual(["WORKBENCH"]);
    expect(alt.by_guard).toEqual({ "!WORKBENCH": 1, DISABLE_X: 1, Y: 1 });
    expect(alt.by_class).toEqual({ Inv: 3 });
    expect(a.report.headline.methods).toMatchObject({
      inactive_branch_alternatives: 3,
      lost_in_indexed_classes: 6,
      lost_total: 6,
    });
    expect(a.report.per_script_module.Game).toMatchObject({
      methods_inactive_branch_alternatives: 3,
      methods_lost: 6,
    });
    expect(a.report.headline.classes_with_loss).toBe(1);
    expect(INACTIVE_BRANCH_CAUSE).toBe("inactive-branch-alternative");
  });

  it("counts the refusals as losses: same branch, another guard, no guard, an opposite branch the index lacks too", () => {
    const a = analyzeSynthetic([ALT_SRC], ALT_API);
    const inv = a.report.classes.find((c) => c.class === "Inv") as {
      lost: { name: string; arity: number; cause: string }[];
    };
    expect(inv.lost.map((l) => `${l.name}/${l.arity}:${l.cause}`)).toEqual([
      "Close/1:preprocessor-guard",
      "Move/1:preprocessor-guard",
      "Plain/1:preprocessor-guard",
      "Both/0:preprocessor-guard",
      "Both/1:preprocessor-guard",
      "Twice/1:unexplained",
    ]);
    // No alternative is also a loss, and the causes sum to lost_total.
    expect(a.report.loss_causes).toEqual({ "preprocessor-guard": 5, unexplained: 1 });
    expect(a.report.inactive_branch_alternatives.methods.map((m) => m.name)).not.toContain("Both");
    // Twice is held once and declared twice, unguarded: matched once, the second is lost, not an alternative.
    expect(a.comparisons.get("Inv")?.pairs.filter((p) => p.src.name === "Twice")).toHaveLength(1);
  });

  it("splitInactiveAlternatives reads the comparison the same way", () => {
    const a = analyzeSynthetic([ALT_SRC], ALT_API);
    const cmp = a.comparisons.get("Inv");
    if (!cmp) throw new Error("no comparison for Inv");
    const s = splitInactiveAlternatives(cmp);
    expect(
      s.alternatives.map((x) => `${x.s.name}/${x.s.arity} of ${x.of.name}/${x.of.arity}`),
    ).toEqual(["Open/1 of Open/1", "Init/0 of Init/0", "Draw/1 of Draw/0"]);
    expect(s.lost.map((x) => `${x.name}/${x.arity}`)).toEqual([
      "Close/1",
      "Move/1",
      "Plain/1",
      "Both/0",
      "Both/1",
      "Twice/1",
    ]);
  });

  it("makes no alternative of a private branch: it is not expected in the index, so it is neither a loss nor an alternative", () => {
    const sources: SourceInput[] = [
      {
        path: "scripts/Game/P.c",
        text: [
          "class P",
          "{",
          "#ifndef Z",
          "\tvoid Go();",
          "#else",
          "\tprivate void Go();",
          "#endif",
          "}",
        ].join("\n"),
      },
    ];
    const a = analyzeSynthetic(sources, [apiClass("P", [{ sig: "void Go ()" }])]);
    expect(a.report.inactive_branch_alternatives.count).toBe(0);
    expect(a.report.headline.methods).toMatchObject({
      lost_total: 0,
      inactive_branch_alternatives: 0,
      private_not_in_index: 1,
    });
  });

  it("reads a class held by the index through its case twin the same way", () => {
    const sources: SourceInput[] = [
      {
        path: "scripts/Game/typename.c",
        text: [
          "class typename",
          "{",
          "#ifndef Z",
          "\tproto native int Hash();",
          "#else",
          "\tproto native int Hash();",
          "#endif",
          "}",
        ].join("\n"),
      },
    ];
    const a = analyzeSynthetic(sources, [
      apiClass("TypeName", [{ sig: "proto native int Hash ()" }]),
    ]);
    expect(a.report.headline.classes).toMatchObject({ missing_from_index: 0, paired_by_case: 1 });
    expect(a.report.headline.methods).toMatchObject({
      lost_total: 0,
      inactive_branch_alternatives: 1,
    });
    expect(a.report.inactive_branch_alternatives.by_class).toEqual({ typename: 1 });
  });
});

describe("inactive-branch alternatives under nested and compound guards", () => {
  const NEST_SRC: SourceInput = {
    path: "scripts/Game/Nest.c",
    text: [
      "class Nest",
      "{",
      // Two deep: the inner #else flips only the inner guard; the arity may differ.
      "#ifdef A",
      "#ifdef B",
      "\tvoid F(int a);",
      "#else",
      "\tvoid F(int a, int b);",
      "#endif",
      "#endif",
      // The outer #else flips the outer guard, the method inside it is under one guard.
      "#ifdef D",
      "#ifdef E",
      "\tvoid H();",
      "#endif",
      "#else",
      "\tvoid H();",
      "#endif",
      // #if defined(X) against its #else.
      "#if defined(X)",
      "\tvoid J(int a);",
      "#else",
      "\tvoid J(int a);",
      "#endif",
      // Refusal: #ifdef Q and #if !defined(Q) are different guard texts, not recognised as opposites.
      "#ifdef Q",
      "\tvoid K();",
      "#endif",
      "#if !defined(Q)",
      "\tvoid K();",
      "#endif",
      // Refusal: nested, but both bodies under the same inner branch.
      "#ifdef M",
      "#ifdef N",
      "\tvoid L();",
      "\tvoid L(int a);",
      "#endif",
      "#endif",
      "}",
    ].join("\n"),
  };
  const NEST_API = [
    apiClass("Nest", [
      { sig: "void F (int a)" },
      { sig: "void H ()" },
      { sig: "void J (int a)" },
      { sig: "void K ()" },
      { sig: "void L ()" },
    ]),
  ];

  it("recognises the opposite branch of a nested guard, of an #if defined() guard, and of an outer #else", () => {
    const a = analyzeSynthetic([NEST_SRC], NEST_API);
    const alt = a.report.inactive_branch_alternatives;
    expect(alt.methods.map((m) => `${m.name}/${m.arity}`)).toEqual(["F/2", "H/0", "J/1"]);
    expect(alt.methods.map((m) => m.guards)).toEqual([["A", "!B"], ["!D"], ["!if defined(X)"]]);
    expect(alt.methods.map((m) => m.alternative_of.guards)).toEqual([
      ["A", "B"],
      ["D", "E"],
      ["if defined(X)"],
    ]);
    expect(alt.by_guard).toEqual({ "A && !B": 1, "!D": 1, "!if defined(X)": 1 });
  });

  it("refuses guards that only mean the same thing in other words, and a sibling in the same nested branch", () => {
    const a = analyzeSynthetic([NEST_SRC], NEST_API);
    const nest = a.report.classes.find((c) => c.class === "Nest") as {
      lost: { name: string; arity: number; cause: string }[];
    };
    expect(nest.lost.map((l) => `${l.name}/${l.arity}:${l.cause}`)).toEqual([
      "K/0:preprocessor-guard",
      "L/1:preprocessor-guard",
    ]);
    expect(a.report.headline.methods).toMatchObject({
      lost_total: 2,
      inactive_branch_alternatives: 3,
    });
  });

  it("with two bodies of one signature, file order decides which is reported as the alternative", () => {
    const body = (first: string): SourceInput => ({
      path: "scripts/Game/Order.c",
      text: [
        "class Order",
        "{",
        `#ifdef ${first}`,
        "\tvoid Init();",
        "#endif",
        `#ifndef ${first}`,
        "\tvoid Init();",
        "#endif",
        "}",
      ].join("\n"),
    });
    const api = [apiClass("Order", [{ sig: "void Init ()" }])];
    const one = analyzeSynthetic([body("W")], api).report.inactive_branch_alternatives;
    expect(one.methods.map((m) => m.guards)).toEqual([["!W"]]);
    expect(one.methods[0].alternative_of.guards).toEqual(["W"]);
    const flipped: SourceInput = {
      path: "scripts/Game/Order.c",
      text: [
        "class Order",
        "{",
        "#ifndef W",
        "\tvoid Init();",
        "#endif",
        "#ifdef W",
        "\tvoid Init();",
        "#endif",
        "}",
      ].join("\n"),
    };
    const two = analyzeSynthetic([flipped], api).report.inactive_branch_alternatives;
    expect(two.methods.map((m) => m.guards)).toEqual([["W"]]);
    expect(two.methods[0].alternative_of.guards).toEqual(["!W"]);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe("determinism and file form", () => {
  it("gives byte-identical observation and report files, with a valid header and sorted rows", () => {
    const a = analysis();
    const b = analysis();
    const inputs = [{ path: "<repo>/data/api/enfusion-classes.json", sha256: "1".repeat(64) }];
    const ta = observationFileText(a.rows, BUILD, inputs);
    expect(ta).toBe(observationFileText(b.rows, BUILD, inputs));
    expect(reportText(a.report)).toBe(reportText(b.report));
    const lines = ta.trimEnd().split("\n");
    const header = observationHeaderSchema.parse(JSON.parse(lines[0]));
    expect(header).toMatchObject({
      enumerator: ENUMERATOR_ID,
      generator: GENERATOR,
      provisional: false,
      row_count: lines.length - 1,
    });
    const ids = lines.slice(1).map((l) => deriveId(observationSchema.parse(JSON.parse(l))));
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(containsMachinePath(ta)).toBe(false);
    expect(containsMachinePath(reportText(a.report))).toBe(false);
    expect(GENERATOR).toBe(
      (
        JSON.parse(readFileSync(join(REPO_ROOT, "data", "census", "universes.json"), "utf-8")) as {
          enumerators: Record<string, { generator: string }>;
        }
      ).enumerators.E12.generator,
    );
  });
});

// ── Ledger acceptance ────────────────────────────────────────────────────────

describe("ledger acceptance (temporary census root)", () => {
  it("builds with no rejected line and no problem, and the rows merge with E02's", () => {
    const fx = makeCensus(BUILD);
    const a = analysis();
    // E02's own file, then E12's through the writer's exact text.
    const dir02 = join(fx.root, "observations", "E02");
    mkdirSync(dir02, { recursive: true });
    writeFileSync(join(dir02, `${BUILD}.jsonl`), e02Text());
    const dir12 = join(fx.root, "observations", "E12");
    mkdirSync(dir12, { recursive: true });
    writeFileSync(
      join(dir12, `${BUILD}.jsonl`),
      observationFileText(a.rows, BUILD, [
        { path: "<repo>/data/api/enfusion-classes.json", sha256: "2".repeat(64) },
      ]),
    );
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    const row = built.rows.find((r) => r.id === "api:WorldEditorAPI.BeginEntityAction/1");
    expect(row).toMatchObject({
      kind: "method",
      module: "WorldEditor",
      parent: "api:WorldEditorAPI",
    });
    expect(row?.sources.map((s) => s.enumerator).sort()).toEqual(["E02", "E12"]);
    const cls = built.rows.find((r) => r.id === "api:WorldEditorAPI");
    expect(cls?.sources.map((s) => s.enumerator).sort()).toEqual(["E02", "E12"]);
    expect(cls?.children_enumerated).toBe(true);
  });

  it("merges an event row without a kind problem", () => {
    const sources: SourceInput[] = [
      { path: "scripts/Workbench/T.c", text: "class T\n{\n\tevent void OnX();\n\tvoid Y();\n}\n" },
    ];
    const index = buildSourceIndex(sources, { build: BUILD });
    const e02 = E02.observationFileText(E02.observationRows(index), index, BUILD);
    const api = [
      parseApiIndex(
        "enfusion-classes.json",
        fileText([apiClass("T", [{ sig: "void OnX ()" }, { sig: "void Y ()" }])]),
      ),
      parseApiIndex("arma-classes.json", fileText([])),
    ];
    const a = analyze({ build: BUILD, index, api, inputs: [], e02: readE02Rows(e02) });
    expect(a.rows.perKind).toEqual({ class: 1, event: 1, method: 1 });
    const fx = makeCensus(BUILD);
    mkdirSync(join(fx.root, "observations", "E02"), { recursive: true });
    mkdirSync(join(fx.root, "observations", "E12"), { recursive: true });
    writeFileSync(join(fx.root, "observations", "E02", `${BUILD}.jsonl`), e02);
    writeFileSync(
      join(fx.root, "observations", "E12", `${BUILD}.jsonl`),
      observationFileText(a.rows, BUILD, []),
    );
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems).toEqual([]);
    expect(built.rows.find((r) => r.id === "api:T.OnX/0")).toMatchObject({ kind: "event" });
  });
});

// ── CLI ──────────────────────────────────────────────────────────────────────

describe("run", () => {
  function setup() {
    const fx = makeCensus(BUILD);
    const tmp = mkdtempSync(join(tmpdir(), "e12-"));
    const apiDir = join(tmp, "api");
    mkdirSync(apiDir, { recursive: true });
    API_FILES.forEach((f, i) => writeFileSync(join(apiDir, f), API_TEXT[i]));
    const sourceIndexFile = join(tmp, "source-index.jsonl");
    saveSourceIndex(sourceIndex(), { file: sourceIndexFile });
    mkdirSync(join(fx.root, "observations", "E02"), { recursive: true });
    writeFileSync(join(fx.root, "observations", "E02", `${BUILD}.jsonl`), e02Text());
    const artifacts = join(tmp, "artifacts");
    const noGame = join(tmp, "no-game");
    const args = [
      "--api-dir",
      apiDir,
      "--source-index",
      sourceIndexFile,
      "--artifacts",
      artifacts,
      "--game",
      noGame,
    ];
    return { fx, tmp, apiDir, artifacts, args };
  }

  it("writes the observation file and the report, refuses --out elsewhere, and says NO DATA", () => {
    const { fx, args, artifacts, tmp } = setup();
    const r = runIn(fx, run, args);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("E12 at build 1.0.0.1:");
    expect(r.stderr).toContain("comment scan is skipped");
    const file = join(fx.root, "observations", "E12", `${BUILD}.jsonl`);
    const lines = readFileSync(file, "utf-8").trimEnd().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({ enumerator: "E12", row_count: lines.length - 1 });
    const header = JSON.parse(lines[0]) as { inputs: { path: string }[] };
    expect(header.inputs.map((i) => i.path)).toEqual([
      "<repo>/data/api/enfusion-classes.json",
      "<repo>/data/api/arma-classes.json",
      `<repo>/data/census/observations/E02/${BUILD}.jsonl`,
      "<source-index>/source-index.jsonl",
    ]);
    // The api hashes are those of the LF text, whatever the line ends of the file read (the
    // synthetic files are written with CRLF; the committed blob is LF).
    const hashes = (JSON.parse(lines[0]) as { inputs: { sha256: string }[] }).inputs;
    expect(hashes[0].sha256).toBe(sha256(Buffer.from(API_TEXT[0].replace(/\r\n/g, "\n"))));
    expect(hashes[0].sha256).not.toBe(sha256(Buffer.from(API_TEXT[0])));
    const report = JSON.parse(
      readFileSync(join(artifacts, "census", BUILD, "E12", "api-index-diff.json"), "utf-8"),
    ) as DiffReport;
    expect(report.doc_comment_scan).toBeNull();
    expect(report.headline).toBeDefined();
    // A second run is byte-identical.
    const again = runIn(fx, run, args);
    expect(again.code).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(lines.join("\n") + "\n");

    const refused = runIn(fx, run, [...args, "--out", join(tmp, "elsewhere.jsonl")]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("refusing --out");
    const noApi = runIn(fx, run, ["--api-dir", join(tmp, "missing"), "--game", join(tmp, "x")]);
    expect(noApi.code).toBe(2);
    expect(noApi.stdout).toContain("NO DATA");
    const noIndex = runIn(fx, run, [
      "--api-dir",
      join(tmp, "api"),
      "--source-index",
      join(tmp, "absent.jsonl"),
      "--game",
      join(tmp, "x"),
    ]);
    expect(noIndex.code).toBe(2);
    expect(noIndex.stdout).toContain("NO DATA");
    expect(runIn(fx, run, ["--help"]).stdout).toContain("usage: e12-api-index.ts");
    expect(resolveOut(censusPaths(fx.root), undefined, BUILD)).toBe(
      join(fx.root, "observations", "E12", `${BUILD}.jsonl`),
    );
  });

  it("names the default source-index path in the header only when that is the file read", () => {
    const { fx, apiDir, artifacts, tmp } = setup();
    saveSourceIndex(sourceIndex(), { file: sourceIndexPath(BUILD, artifacts) });
    const r = runIn(fx, run, [
      "--api-dir",
      apiDir,
      "--artifacts",
      artifacts,
      "--game",
      join(tmp, "no-game"),
    ]);
    expect(r.code).toBe(0);
    const header = JSON.parse(
      readFileSync(join(fx.root, "observations", "E12", `${BUILD}.jsonl`), "utf-8").split("\n")[0],
    ) as { inputs: { path: string }[] };
    expect(header.inputs.at(-1)?.path).toBe(`<artifacts>/census/${BUILD}/E02/source-index.jsonl`);
  });

  it("writes every module as none, and says so, when E02 has no observation file", () => {
    const { args } = setup();
    const fresh = makeCensus(BUILD); // a census with no E02 observation file
    const r = runIn(fresh, run, args);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("every module is written as none");
    const rows = readFileSync(join(fresh.root, "observations", "E12", `${BUILD}.jsonl`), "utf-8")
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l) as { module: string });
    expect(new Set(rows.map((x) => x.module))).toEqual(new Set(["none"]));
  });
});

// ── Real data (skipped when the source index is absent) ──────────────────────

const REAL_BUILD = "1.8.0.13";
const realIndexFile = ((): string | undefined => {
  try {
    const f = sourceIndexPath(REAL_BUILD, artifactsDir());
    return existsSync(f) ? f : undefined;
  } catch {
    return undefined;
  }
})();
const repoRoot = REPO_ROOT;
const hasApi = API_FILES.every((f) => existsSync(join(repoRoot, "data", "api", f)));
const gamePath = loadConfig().gamePath;
const hasGame = !!gamePath && existsSync(join(gamePath, "addons"));

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !realIndexFile || !hasApi)("E12 headline counts on build 1.8.0.13", () => {
  it("measures the backfilled index: nothing lost, 67 inactive-branch alternatives, WorldEditorAPI 124 against 124", () => {
    const realIndex = loadSourceIndex(REAL_BUILD, { file: realIndexFile });
    if (!realIndex) throw new Error("source index vanished");
    const api = API_FILES.map((f) =>
      parseApiIndex(f, readFileSync(join(repoRoot, "data", "api", f))),
    );
    const e02File = join(repoRoot, "data", "census", "observations", "E02", `${REAL_BUILD}.jsonl`);
    const e02 = existsSync(e02File) ? readE02Rows(readFileSync(e02File, "utf-8")) : undefined;
    const docs = hasGame
      ? (() => {
          const vfs = PakVirtualFS.get(gamePath);
          if (!vfs) return undefined;
          return scanDocBlocks(
            (function* () {
              for (const f of realIndex.files)
                yield { file: f.file, text: vfs.readTextFile(f.file) };
            })(),
          );
        })()
      : undefined;
    const a = analyze({ build: REAL_BUILD, index: realIndex, api, inputs: [], docs, e02 });
    const h = a.report.headline as Record<string, Record<string, unknown>>;
    const files = h.api_index_files as Record<string, Record<string, number>>;
    // The index as committed: Doxygen's pages plus the pak layer (1,113 methods, 40 classes).
    expect(files["enfusion-classes.json"]).toMatchObject({
      classes: 901,
      methods_public: 14063,
      methods_static: 1012,
      methods_protected: 572,
      methods_public_plus_static: 15075,
    });
    expect(files["arma-classes.json"]).toMatchObject({
      classes: 8111,
      methods_public: 85897,
      methods_static: 3113,
      methods_protected: 24627,
      methods_public_plus_static: 89010,
    });
    expect(h.source.classes).toBe(9007);
    // typename is read against TypeName (the one page that differs only in case): no class is
    // missing from the index and none is in the index without the source.
    expect(h.classes).toEqual({
      in_source: 9007,
      in_both: 9007,
      missing_from_index: 0,
      in_index_not_in_source: 0,
      paired_by_case: 1,
    });
    expect(a.report.class_name_pairs).toEqual([
      { source: "typename", index: "TypeName", paired: true },
    ]);
    expect(a.report.worldeditorapi).toMatchObject({
      methods_declared_public_or_protected: 124,
      methods_in_index: 124,
      lost: 0,
    });
    expect(h.methods).toMatchObject({
      matched: 45667,
      lost_in_indexed_classes: 0,
      in_classes_missing_from_index: 0,
      lost_total: 0,
      // Guarded methods whose same-named sibling in the opposite branch the index holds: the
      // other body of a method it has (57 under DISABLE_INVENTORY, 9 under DISABLE_FUEL, one
      // under !WORKBENCH), not lost.
      inactive_branch_alternatives: 67,
      index_entries_params_array_longer_than_signature: 0,
      index_entries_params_array_shorter_than_signature: 0,
      arity_differences: 0,
    });
    expect(h.classes_with_loss).toBe(0);
    expect(a.report.loss_causes).toEqual({});
    const alt = a.report.inactive_branch_alternatives;
    expect(alt.count).toBe(67);
    expect(alt.methods).toHaveLength(67);
    expect(alt.by_guard).toEqual({ "!WORKBENCH": 1, DISABLE_FUEL: 9, DISABLE_INVENTORY: 57 });
    expect(alt.by_class).toEqual({
      CrossroadEntity: 1,
      SCR_CharacterInventoryStorageComponent: 9,
      SCR_FuelNode: 9,
      SCR_InventoryAction: 1,
      SCR_InventoryMenuUI: 24,
      SCR_InventoryStorageManagerComponent: 17,
      SCR_UniversalInventoryStorageComponent: 6,
    });
    expect(alt.methods.every((m) => m.cause === INACTIVE_BRANCH_CAUSE)).toBe(true);
    expect(alt.methods.find((m) => m.class === "CrossroadEntity")).toMatchObject({
      name: "Init",
      guards: ["!WORKBENCH"],
      alternative_of: { guards: ["WORKBENCH"] },
    });
    // SCR_MapHelperT is only generic commas (every method is in the index); SetTexture's last
    // parameter follows a default that holds a call, which cut the index's params array short:
    // the signature states four parameters, as the source does.
    expect(a.report.classes.some((c) => c.class === "SCR_MapHelperT")).toBe(false);
    expect(a.comparisons.get("SCR_InputButtonComponent")?.lost.map((m) => m.name)).not.toContain(
      "SetTexture",
    );
    expect(h.plugin_classes).toMatchObject({ distinct_classes: 142, missing_from_index: 0 });
    expect(Object.keys(a.report.per_script_module).sort()).toEqual([
      "Autotest",
      "Core",
      "Game",
      "GameCode",
      "GameLib",
      "Workbench",
      "WorkbenchCommon",
      "WorkbenchGame",
      "WorkbenchGameCommon",
    ]);
    expect(a.rows.perKind).toEqual({ class: 498, event: 43, method: 1586, "static-method": 287 });
    expect(a.rows.observations.length).toBe(2414);
    // Every method row's key arity is the arity its own signature states.
    for (const { obs } of a.rows.observations) {
      if (obs.kind === "class" || !obs.signature) continue;
      expect((obs.key as { arity: number }).arity).toBe(signatureArity(obs.signature));
    }
    expect(a.rows.kindDisagreements).toEqual([]);
    if (e02) expect(a.rows.sharedWithE02).toBe(2414);
    // The generic-comma entries that had no E02 twin before the arity came from the signature.
    expect(a.rows.observations.some((o) => o.id === "api:EBTEmatUtils.GetMaterials/2")).toBe(true);
    expect(a.rows.observations.some((o) => o.id === "api:EBTEmatUtils.GetMaterials/3")).toBe(false);
    expect(
      a.rows.observations.some(
        (o) => o.id === "api:SCR_SocketSpawnerPluginWE.RefreshBoneMatrixMap/4",
      ),
    ).toBe(false);
    if (docs) {
      expect(docs.scan.files_scanned).toBe(6568);
      expect(docs.scan.typos.map((t) => `${t.file}#L${t.line}`)).toEqual([
        "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c#L161",
        "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c#L182",
      ]);
      // The 28 methods the block typo swallows are all in the index now (the pak layer): nothing
      // of WorldEditorAPI is lost, so the loss no longer equals what sits inside the typo region.
      expect(a.report.worldeditorapi).toMatchObject({
        lost: 0,
        lost_equals_inside_typo_regions: false,
      });
      expect((a.report.worldeditorapi.methods_inside_typo_regions as string[]).length).toBe(28);
    }
  }, 600_000);
});
