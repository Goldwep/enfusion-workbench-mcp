import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  SchemaCollector,
  SchemaReadError,
  arrayShape,
  lineShape,
  literalSet,
  memberShape,
  parseDocument,
  tokenize,
  type BlockNode,
} from "../../src/census/data-schema.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { loadConfig } from "../../src/config.js";
import {
  buildRows,
  classModule,
  fileTypeModule,
  headline,
  keyNameBlocked,
  observationFileText,
  readCorpus,
  sniffText,
  sniffTextFile,
  run as runE10,
  type Deps,
  type PakSource,
} from "../../scripts/census/enumerators/e10-data-schema.js";
import { makeCensus, runIn, writeObservations } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic documents ───────────────────────────────────────────────────────

const BT = [
  "// a behaviour tree, comment line",
  'BehaviorTree "{EF68AC2A3CCAA800}AI/Test.bt" {',
  ' Name "AI/Test.bt"',
  " Nodes {",
  "  RootNode Root {",
  "   EditorPos -432 80",
  "   Nodes {",
  '    Selector "My Selector" {',
  '     Condition "Low && x == 0 { not a block }"',
  "     Flags SOLID VISIBLE",
  "     Mode Fast",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
  "",
].join("\n");

const CT = [
  'SCR_Comp : "{996046FE206C699A}Prefabs/Base.ct" {',
  " Mode Fast /* trailing block comment */",
  " Tags {",
  '  "a" "b"',
  " }",
  ' Expression "first"\\',
  '  "second"',
  ' "static" 1',
  ' "Loop count" 4',
  " m_aList + {",
  "  1 2 3",
  " }",
  ' Info SCR_Info "{5298E609432D192D}" {',
  "  Mode Slow",
  " }",
  "}",
].join("\n");

const LEGACY = ["$AnimGraph 8 {", " $Node AnimNodeSource {", '  "a" "b" "noloop"', " }", "}"].join(
  "\n",
);

const LAYOUT = [
  "FrameWidgetClass {",
  ' Name "Root"',
  " {",
  '  TextWidgetClass "{6262BE3C34070E38}" {',
  '   Text "Hello \\"there\\""',
  "  }",
  " }",
  "}",
].join("\n");

const ET = [
  "GenericEntity {",
  ' ID "8404654BEC073AC2"',
  " components {",
  '  MeshObject "{5CAE9B8B9983D35F}" {',
  '   Object "{63B3998D00C748E9}Assets/x.xob"',
  "  }",
  " }",
  " {",
  '  $grp GenericEntity : "{6095B175AA9804DC}Prefabs/Tire.et" {',
  "   {",
  '    ID "5DB6D40AF411E5AC"',
  "   }",
  "   Spare {",
  "    coords 0 0 0",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

describe("e10 tolerant reader", () => {
  it("reads nested blocks, a named block with a parent ref, arrays and a comment", () => {
    const roots = parseDocument(BT);
    expect(roots).toHaveLength(1);
    const bt = roots[0];
    expect(bt.cls).toBe("BehaviorTree");
    expect(bt.name).toBe("{EF68AC2A3CCAA800}AI/Test.bt");
    expect(bt.line).toBe(2);
    const nodes = bt.members.find((m) => m.key === "Nodes");
    expect(nodes && memberShape(nodes)).toBe("array of blocks");
    const root = (nodes?.value as { kind: "array"; array: { items: { block: BlockNode }[] } }).array
      .items[0].block;
    expect(root.cls).toBe("RootNode");
    expect(root.name).toBe("Root");
    const sel = (
      root.members.find((m) => m.key === "Nodes")?.value as {
        kind: "array";
        array: { items: { block: BlockNode }[] };
      }
    ).array.items[0].block;
    expect(sel.cls).toBe("Selector");
    expect(sel.name).toBe("My Selector");
    // A quoted string holding braces is one value, not a block.
    expect(sel.members.map((m) => [m.key, memberShape(m)])).toEqual([
      ["Condition", "quoted string"],
      ["Flags", "bare words[2]"],
      ["Mode", "bare word"],
    ]);
    expect(root.members.map((m) => [m.key, memberShape(m)])).toEqual([
      ["EditorPos", "numbers[2]"],
      ["Nodes", "array of blocks"],
    ]);
  });

  it("reads parents, quoted keys, continued strings, append arrays and inline objects", () => {
    const [c] = parseDocument(CT);
    expect(c.cls).toBe("SCR_Comp");
    expect(c.name).toBeUndefined();
    expect(c.parentRef).toBe("{996046FE206C699A}Prefabs/Base.ct");
    const shapes = Object.fromEntries(c.members.map((m) => [m.key, memberShape(m)]));
    expect(shapes).toEqual({
      Mode: "bare word",
      Tags: "array of quoted strings",
      Expression: "quoted string",
      static: "number",
      "Loop count": "number",
      m_aList: "array of numbers",
      Info: "block",
    });
    expect(c.members.find((m) => m.key === "static")?.quoted).toBe(true);
    expect(c.members.find((m) => m.key === "m_aList")?.append).toBe(true);
    const expr = c.members.find((m) => m.key === "Expression");
    expect((expr?.value as { kind: "scalar"; tokens: { v: string }[] }).tokens[0].v).toBe(
      "firstsecond",
    );
    // The line after the continued string is read on its own line.
    expect(c.members.find((m) => m.key === "static")?.line).toBe(8);
  });

  it("reads $-prefixed legacy nodes as positional lists and $grp as unkeyed instances", () => {
    const [g] = parseDocument(LEGACY);
    expect(g.cls).toBe("$AnimGraph");
    expect(g.name).toBe("8");
    expect(g.members).toEqual([]);
    expect(g.lists).toHaveLength(1);
    const node = g.lists[0].items[0] as { kind: "block"; block: BlockNode };
    expect(node.block.cls).toBe("$Node");
    expect(arrayShape(node.block.lists[0])).toBe("array of quoted strings");

    const [e] = parseDocument(ET);
    const grp = (e.lists[0].items[0] as { block: BlockNode }).block;
    expect(grp.cls).toBe("$grp");
    expect(grp.name).toBe("GenericEntity");
    const inst = grp.lists[0].items.map((i) => (i as { block: BlockNode }).block);
    expect(inst.map((b) => [b.cls, b.name, b.parentRef])).toEqual([
      ["GenericEntity", undefined, "{6095B175AA9804DC}Prefabs/Tire.et"],
      ["GenericEntity", "Spare", "{6095B175AA9804DC}Prefabs/Tire.et"],
    ]);
  });

  it("reads an unkeyed child list and an escaped quote", () => {
    const [f] = parseDocument(LAYOUT);
    expect(f.lists).toHaveLength(1);
    const t = (f.lists[0].items[0] as { block: BlockNode }).block;
    expect(t.cls).toBe("TextWidgetClass");
    expect(t.members[0].key).toBe("Text");
    expect(memberShape(t.members[0])).toBe("quoted string");
  });

  it("names value shapes from a small closed set", () => {
    const toks = tokenize('"{63B3998D00C748E9}a.xob" clampv clampu 1');
    expect(lineShape(toks)).toBe("resource ref + bare words[2] + number");
    expect(lineShape(tokenize("1 -2.5 3e-05 0x33"))).toBe("numbers[4]");
    expect(lineShape([])).toBe("no value");
  });

  it("reports the first structural error with its line instead of throwing anything else", () => {
    const cases: [string, number][] = [
      ["A {\n x 1\n", 1],
      ['A {\n x "open\n}', 2],
      ['A {\n "lone"\n}', 2],
      ["}", 1],
      ['A {\n B "x" "y" {\n }\n}', 2],
      // A string closed early by an unescaped quote: its quotes pair up on the
      // line, but the `\"` escapes left outside it are not a bare word.
      ['A {\n Text "<image set=\\"{F7FD1672FECA05E8}x.imageset" name=\\"y\\"/>"\n}', 2],
      ['A {\n x 1 \\"y"\n}', 2],
      // The earliest error wins: a structural one before a stray backslash.
      ['A {\n "lone"\n x a=\\"b"\n}', 2],
      // ...and a stray backslash before an unterminated string.
      ['A {\n x a=\\"b"\n y "open\n}', 2],
    ];
    for (const [doc, line] of cases) {
      let err: unknown;
      try {
        parseDocument(doc);
      } catch (e) {
        err = e;
      }
      expect(err, doc).toBeInstanceOf(SchemaReadError);
      expect((err as SchemaReadError).line, doc).toBe(line);
    }
    // A backslash that ends its line outside a string is a stray continuation.
    expect(parseDocument("A {\n x 1 \\\n y 2\n}")[0].members.map((m) => m.key)).toEqual(["x", "y"]);
  });

  it("collects literal sets only for small sets seen at least twice each", () => {
    const col = new SchemaCollector();
    const doc = (v: string) => `A {\n Mode ${v}\n Other ${v}\n}`;
    for (const v of ["Fast", "Fast", "Slow", "Slow"])
      col.add("conf", "x.conf", parseDocument(doc(v)), doc(v));
    col.add("conf", "y.conf", parseDocument("A {\n Other Rare\n}"), "A {\n Other Rare\n}");
    const a = col.classes.get("A");
    expect(literalSet(a!.keys.get("Mode")!)).toEqual(["Fast", "Slow"]);
    expect(literalSet(a!.keys.get("Other")!)).toBeUndefined();
  });
});

// ── In-memory corpus ──────────────────────────────────────────────────────────

const BUILD = "9.9.9.9";

function memPak(files: Record<string, string | Buffer>): PakSource {
  return {
    allFilePaths: () => Object.keys(files),
    readFile: (p) => {
      const v = files[p];
      if (v === undefined) throw new Error("missing");
      return typeof v === "string" ? Buffer.from(v, "utf-8") : v;
    },
  };
}

function world(): Record<string, string | Buffer> {
  // A planted e-mail address and drive path, assembled at test time.
  const mail = ["someone", "example.com"].join("@");
  const drive = ["C", ":\\", "Users", "\\", "x"].join("");
  return {
    "AI/Test.bt": BT,
    "Prefabs/Comp.ct": CT,
    "Prefabs/Ent.et": ET,
    "Prefabs/Ent2.et": "SCR_Comp {\n Mode Slow\n}\n",
    // Control bytes inside a quoted value: still a text document.
    "Prefabs/Ctl.et": Buffer.from('GenericEntity {\n ID "a\x1ab\x7f"\n}\n', "latin1"),
    "anims/g.agr": LEGACY,
    "UI/a.layout": LAYOUT,
    "UI/broken.layout": 'FrameWidgetClass {\n Name "x"\n',
    "Configs/mail.conf": `Contact {\n Author "${mail}"\n Path "${drive}"\n}\n`,
    "Configs/b.conf": "SCR_Comp {\n Mode Fast\n Info SCR_Info {\n  Mode Fast\n }\n}\n",
    "scripts/Game/x.c": "class X {}\n",
    "Assets/a.xob": Buffer.from([0, 1, 2, 3]),
  };
}

describe("e10 rows", () => {
  const corpus = readCorpus(memPak(world()), BUILD);
  const rows = buildRows(corpus);
  const byId = new Map(rows.observations.map((o) => [o.id, o.obs]));

  it("reads every text file, lists the unreadable ones and sets aside excluded and binary extensions", () => {
    expect(corpus.unreadable.map((u) => [u.path, u.line])).toEqual([["UI/broken.layout", 1]]);
    expect(corpus.excluded.map((x) => x.ext)).toEqual(["c"]);
    expect(corpus.binary_extensions).toEqual(["xob"]);
    expect(corpus.meta_files).toBe(0);
    const h = headline(corpus, rows);
    expect(h.files.in_scope_text).toBe(10);
    expect(h.files.read).toBe(9);
    expect(h.files.unreadable).toBe(1);
    expect(corpus.not_text).toEqual([]);
    expect(sniffText(Buffer.from('A {\n x "\x1a"\n}', "latin1"))).toBe("binary");
    expect(sniffTextFile(Buffer.from('A {\n x "\x1a\x7f"\n}', "latin1"))).toBe("text");
    expect(sniffTextFile(Buffer.from([0x41, 0, 0x42]))).toBe("binary");
  });

  it("writes one class row per class across formats, with the module of its formats", () => {
    const comp = byId.get("schema:SCR_Comp");
    expect(comp?.kind).toBe("schema-class");
    // .conf (ResourceManager.Config), .ct and .et (WorldEditor): several modules.
    expect(comp?.module).toBe("Shared");
    expect(comp?.what).toBe(
      `3 instances in 3 files of the ${BUILD} paks (.conf 1, .ct 1, .et 1); root; keys of its .et instances are not emitted (entity formats: E15's [Attribute] rows)`,
    );
    // Dominant format by files, ties in code-unit order: .conf, whose E09
    // file-type row carries the format's own editor module.
    expect(comp?.parent_key).toEqual({
      dim: "file",
      kind: "file-type",
      module: "ResourceManager.Config",
      key: { ext: "conf" },
    });
    expect(byId.get("schema:Selector")?.parent_key?.module).toBe("BehaviorEditor");
    expect(fileTypeModule("aex")).toBe("none");
    expect(fileTypeModule("acp")).toBe("AudioEditor");
    expect(comp?.ref).toBe("pak:Configs/b.conf#L1");
    expect(byId.get("schema:Selector")).toMatchObject({
      module: "BehaviorEditor",
      ref: "pak:AI/Test.bt#L8",
      quote: 'Selector "My Selector" {',
      what: `1 instances in 1 .bt files of the ${BUILD} paks; nested`,
      children_count: 3,
    });
    expect(classModule(["aex"])).toBe("none");
    expect(classModule(["aex", "agf"])).toBe("AnimEditor");
  });

  it("gives entity-format classes no key rows and no children_count", () => {
    const me = byId.get("schema:MeshObject");
    expect(me?.module).toBe("WorldEditor");
    expect(me?.children_count).toBeUndefined();
    expect([...byId.keys()].filter((id) => id.startsWith("schema:MeshObject."))).toEqual([]);
    expect(byId.get("schema:$grp")?.what).toContain("legacy group node");
    expect(byId.get("schema:GenericEntity")?.what).toContain("root and nested");
  });

  it("writes key rows with value shapes, literal sets and the class as parent", () => {
    const mode = byId.get("schema:SCR_Comp.Mode");
    expect(mode).toMatchObject({
      kind: "schema-key",
      module: "Shared",
      label: "Mode",
      signature: "bare word",
      parent_key: {
        dim: "schema",
        kind: "schema-class",
        module: "Shared",
        key: { class: "SCR_Comp" },
      },
      quote: "Mode Fast",
    });
    expect(mode?.what).toBe(
      `2 instances in 2 files (.conf, .ct) of the ${BUILD} paks; literal set (1): Fast`,
    );
    expect(byId.get("schema:SCR_Comp.static")?.what).toContain("written as a quoted key");
    expect(byId.get("schema:SCR_Comp.m_aList")?.signature).toBe("array of numbers");
    expect(byId.get("schema:SCR_Info.Mode")?.signature).toBe("bare word");
    expect(byId.get("schema:Selector.Flags")?.signature).toBe("bare words[2]");
    expect(byId.get("schema:RootNode.EditorPos")?.signature).toBe("numbers[2]");
    // A key name with plain spaces is a row: the id escapes the spaces, the key keeps the name.
    const loop = byId.get("schema:SCR_Comp.Loop%20count");
    expect(loop).toMatchObject({
      kind: "schema-key",
      key: { class: "SCR_Comp", key: "Loop count" },
      label: "Loop count",
      signature: "number",
      parent_key: { kind: "schema-class", key: { class: "SCR_Comp" } },
    });
    expect([...byId.keys()].some((id) => id.includes("Loop count"))).toBe(false);
    expect(rows.leftOutKeys).toEqual([]);
    // children_count is the keys the source shows; every key of SCR_Comp has a
    // row, spaced one included, so the class states the count.
    const kids = (cls: string) =>
      [...byId.values()].filter((o) => o.kind === "schema-key" && o.parent_key?.key.class === cls)
        .length;
    expect(kids("SCR_Comp")).toBe(7);
    expect(byId.get("schema:SCR_Comp")?.children_count).toBe(7);
    expect(byId.get("schema:SCR_Info")?.children_count).toBe(kids("SCR_Info"));
  });

  it("drops a quote that holds a machine path or an e-mail address, and keeps the row", () => {
    const author = byId.get("schema:Contact.Author");
    const path = byId.get("schema:Contact.Path");
    expect(author?.quote).toBeUndefined();
    expect(path?.quote).toBeUndefined();
    expect(author?.ref).toBe("pak:Configs/mail.conf#L2");
    const text = observationFileText(rows, corpus);
    expect(text).not.toContain(["someone", "example.com"].join("@"));
    for (const line of text.split("\n")) expect(containsMachinePath(line)).toBe(false);
  });

  it("emits no enum, enum-value or resource-class rows", () => {
    expect(new Set(rows.observations.map((o) => o.obs.kind))).toEqual(
      new Set(["schema-class", "schema-key"]),
    );
  });
});

// ── Key names ─────────────────────────────────────────────────────────────────

describe("e10 key names", () => {
  // Names with other whitespace are assembled here, not typed into the source.
  const tabbed = ["tab", "name"].join("\t");
  const nbsp = ["no", "break"].join(" ");
  const conf = [
    "Spaced {",
    ' "Loop count" 4',
    ' "Two  spaces" 1',
    ' "100% done" 2',
    ' "a%20b" 3',
    ' "a b" 4',
    " Plain 1",
    "}",
    "Refused {",
    ' "has.dot" 1',
    ' "has#hash" 2',
    ` "${tabbed}" 3`,
    ` "${nbsp}" 4`,
    " Plain 5",
    "}",
    "",
  ].join("\n");
  const corpus = readCorpus(memPak({ "Configs/keys.conf": conf }), BUILD);
  const rows = buildRows(corpus);
  const byId = new Map(rows.observations.map((o) => [o.id, o.obs]));

  it("decides by the name: a plain space is allowed, other whitespace, a dot or a hash is not", () => {
    expect(keyNameBlocked("Loop count")).toBeUndefined();
    expect(keyNameBlocked("Two  spaces")).toBeUndefined();
    expect(keyNameBlocked("Plain_1")).toBeUndefined();
    expect(keyNameBlocked(tabbed)).toBe("whitespace other than a plain space");
    expect(keyNameBlocked(nbsp)).toBe("whitespace other than a plain space");
    expect(keyNameBlocked("line\nbreak")).toBe("whitespace other than a plain space");
    expect(keyNameBlocked("has.dot")).toBe("a dot or hash");
    expect(keyNameBlocked("has#hash")).toBe("a dot or hash");
    // A name with a space and a dot is refused for the dot.
    expect(keyNameBlocked("a b.c")).toBe("a dot or hash");
  });

  it("emits a row for every spaced name, escaping spaces and percent signs in the id only", () => {
    const spaced = [...byId.entries()]
      .filter(([, o]) => o.kind === "schema-key" && o.key.class === "Spaced")
      .map(([id, o]) => [id, o.key.key]);
    expect(spaced).toEqual([
      ["schema:Spaced.100%25%20done", "100% done"],
      ["schema:Spaced.Loop%20count", "Loop count"],
      ["schema:Spaced.Plain", "Plain"],
      ["schema:Spaced.Two%20%20spaces", "Two  spaces"],
      // A name that already reads like an escape stays distinct from the spaced one.
      ["schema:Spaced.a%20b", "a b"],
      ["schema:Spaced.a%2520b", "a%20b"],
    ]);
    expect(byId.get("schema:Spaced.Loop%20count")).toMatchObject({
      label: "Loop count",
      signature: "number",
    });
    // Every key of the class has a row, so the class states the count.
    expect(byId.get("schema:Spaced")?.children_count).toBe(6);
    expect(byId.get("schema:Spaced")?.what).not.toContain("not emitted");
  });

  it("still leaves out other whitespace, a dot and a hash, and withholds the count of that class", () => {
    expect(rows.leftOutKeys.map((k) => [k.class, k.key, k.why])).toEqual([
      ["Refused", "has#hash", "key name holds a dot or hash"],
      ["Refused", "has.dot", "key name holds a dot or hash"],
      ["Refused", nbsp, "key name holds whitespace other than a plain space"],
      ["Refused", tabbed, "key name holds whitespace other than a plain space"],
    ]);
    const kept = [...byId.values()].filter(
      (o) => o.kind === "schema-key" && o.key.class === "Refused",
    );
    expect(kept.map((o) => o.key.key)).toEqual(["Plain"]);
    const cls = byId.get("schema:Refused");
    expect(cls?.children_count).toBeUndefined();
    expect(cls?.what).toContain("4 of its 5 keys are not emitted");
    const h = headline(corpus, rows);
    expect(h.keys).toMatchObject({ total_seen: 11, rows: 7, left_out: 4, with_literal_set: 0 });
  });

  it("writes spaced keys into the observation text with the name as written", () => {
    const text = observationFileText(rows, corpus);
    const line = text
      .split("\n")
      .map((l) => (l.startsWith("{") ? (JSON.parse(l) as Record<string, unknown>) : undefined))
      .find(
        (o) => JSON.stringify(o?.key) === JSON.stringify({ class: "Spaced", key: "Loop count" }),
      );
    expect(line).toBeDefined();
    expect(line?.label).toBe("Loop count");
    // The file carries the key, never an id.
    expect(line?.id).toBeUndefined();
  });
});

// ── CLI, determinism and ledger acceptance ────────────────────────────────────

function deps(files: Record<string, string | Buffer>): Deps {
  return { openPak: () => memPak(files), gamePath: () => "<game>", sourceIndex: () => undefined };
}

describe("e10 run", () => {
  it("is byte-identical on a second run", () => {
    const fx = makeCensus(BUILD);
    const art = mkdtempSync(join(tmpdir(), "e10-art-"));
    const go = () => runIn(fx, (argv, io) => runE10(argv, io, deps(world())), ["--artifacts", art]);
    expect(go().code).toBe(1); // 8 of 9 files read: under the 99% gate
    const file = join(fx.paths.observations, "E10", `${BUILD}.jsonl`);
    const first = readFileSync(file, "utf-8");
    const firstArt = readFileSync(join(art, "census", BUILD, "E10", "data-schema.json"), "utf-8");
    go();
    expect(readFileSync(file, "utf-8")).toBe(first);
    expect(readFileSync(join(art, "census", BUILD, "E10", "data-schema.json"), "utf-8")).toBe(
      firstArt,
    );
  });

  it("writes only observations/E10, and the ledger accepts the file with no problem on its rows", () => {
    const fx = makeCensus(BUILD);
    const art = mkdtempSync(join(tmpdir(), "e10-art-"));
    const files = world();
    delete files["UI/broken.layout"];
    const r = runIn(fx, (argv, io) => runE10(argv, io, deps(files)), ["--artifacts", art]);
    expect(r.code, r.stderr).toBe(0);
    // The parents are E09's file-type rows.
    writeObservations(
      fx,
      "E09",
      BUILD,
      ["agr", "bt", "conf", "ct", "et", "layout"].map((ext) => ({
        dim: "file",
        kind: "file-type",
        module: fileTypeModule(ext),
        key: { ext },
        parent_key: null,
        origin: "vanilla",
        ref: `pak:x.${ext}`,
        confidence: "high",
      })),
    );
    expect(readdirSync(fx.paths.observations).sort()).toEqual(["E09", "E10"]);
    const built = buildLedger(fx.paths, { build: BUILD });
    expect(built.rejected).toEqual([]);
    expect(built.problems.filter((p) => JSON.stringify(p).includes("schema:"))).toEqual([]);
    const cls = built.rows.find((row) => row.id === "schema:Selector");
    expect(cls?.parent).toBe("file:.bt");
    expect(cls?.children_enumerated).toBe(true);
    // A key whose name has a plain space is a row under its class, and the class is enumerated.
    expect(built.rows.find((row) => row.id === "schema:SCR_Comp.Loop%20count")?.parent).toBe(
      "schema:SCR_Comp",
    );
    expect(built.rows.find((row) => row.id === "schema:SCR_Comp")?.children_enumerated).toBe(true);
  });

  it("answers NO DATA when there is no pak, and writes nothing", () => {
    const fx = makeCensus(BUILD);
    const r = runIn(
      fx,
      (argv, io) =>
        runE10(argv, io, {
          openPak: () => null,
          gamePath: () => "<game>",
          sourceIndex: () => undefined,
        }),
      [],
    );
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
    expect(existsSync(join(fx.paths.observations, "E10"))).toBe(false);
  });

  it("refuses an output outside observations/E10", () => {
    const fx = makeCensus(BUILD);
    const r = runIn(fx, (argv, io) => runE10(argv, io, deps(world())), [
      "--out",
      join(fx.root, "elsewhere.jsonl"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing --out");
  });
});

// ── Real install ──────────────────────────────────────────────────────────────

const GAME = loadConfig().gamePath;
const REAL = !!GAME && existsSync(join(GAME, "addons"));

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !REAL)("e10 real install at build 1.8.0.13", () => {
  it("reproduces the headline counts", () => {
    const fx = makeCensus("1.8.0.13");
    const art = mkdtempSync(join(tmpdir(), "e10-art-"));
    const r = runIn(fx, (argv, io) => runE10(argv, io), [
      "--build",
      "1.8.0.13",
      "--artifacts",
      art,
      "--json",
    ]);
    expect(r.code, r.stderr).toBe(0);
    const j = JSON.parse(r.stdout) as {
      rows_by_kind: Record<string, number>;
      headline: ReturnType<typeof headline>;
      unreadable: { path: string; line: number }[];
    };
    const h = j.headline;
    expect(h.files.in_scope_text).toBe(36467);
    expect(h.files.read).toBe(36458);
    // Four truncated materials, and five layouts whose rich-text strings are
    // closed early by an unescaped quote (a `\"` escape left outside a string).
    expect(j.unreadable.map((u) => `${u.path}#L${u.line}`)).toEqual([
      "Assets/Characters/Basebody/Data/Eyes.emat#L1",
      "Assets/Characters/HeadGear/Hat_Knitted_01/Data/Hat_Knitted_01_blue.emat#L1",
      "Assets/Characters/HeadGear/Hat_Knitted_01/Data/Hat_Knitted_01_brown.emat#L1",
      "Assets/Characters/HeadGear/Hat_Knitted_01/Data/Hat_Knitted_01_red.emat#L1",
      "UI/layouts/HUD/QuickMenu/QuickMenu.layout#L60",
      "UI/layouts/Map/ToolMenu.layout#L80",
      "UI/layouts/Menus/DeployMenu/WarningWidgetDeploy.layout#L99",
      "UI/layouts/Test/PreviewRichText-Backup.layout#L140",
      "UI/layouts/Test/PreviewRichText_AsianFontTesting.layout#L121",
    ]);
    // The prefab with control bytes inside a quoted value is read.
    expect(h.files.per_extension.et).toMatchObject({ text: 19448, read: 19448, not_text: 0 });
    expect(h.files.excluded).toEqual({ c: 6568, json: 1, txt: 1 });
    expect(Object.keys(h.files.per_extension)).toHaveLength(26);
    expect(h.classes.total).toBe(4101);
    expect(h.classes.shared_by_formats).toBe(470);
    // Every key seen has a row: the 376 quoted names with plain spaces are rows now (their ids
    // escape the spaces), and none holds other whitespace, a dot or a hash.
    expect(h.keys.total_seen).toBe(11265);
    expect(h.keys.rows).toBe(11265);
    expect(h.keys.left_out).toBe(0);
    expect(h.keys.with_literal_set).toBe(307);
    expect(h.behaviour_tree.node_classes).toBe(288);
    expect(h.behaviour_tree.all_bt_classes).toBe(327);
    // The recon's 387 is the number of script classes deriving from Node (E02 source index).
    if (h.behaviour_tree.script_node_subclasses !== null) {
      expect(h.behaviour_tree.script_node_subclasses).toBe(387);
      expect(h.behaviour_tree.script_node_subclasses_unused).toBe(99);
    }
    expect(h.animation_graph.agf_node_classes).toBe(37);
    expect(h.audio.dsp_classes).toBe(15);
    expect(h.audio.signal_classes).toBe(49);
    expect(h.particles.emitter_keys).toBe(86);
    expect(h.meta_files).toBe(0);
    expect(j.rows_by_kind).toEqual({ "schema-class": 4101, "schema-key": 11265 });
    const obs = readFileSync(join(fx.paths.observations, "E10", "1.8.0.13.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const one = (k: object) => obs.find((o) => JSON.stringify(o.key) === JSON.stringify(k));
    expect(one({ class: "RichTextWidgetClass", key: "Text" })?.signature).toBe("quoted string");
    expect(one({ class: "BankLocalClass" })).toMatchObject({
      parent_key: { module: "AudioEditor", key: { ext: "acp" } },
    });
    // Spaced key names are rows, keyed by the name as written.
    const keyRows = obs.filter((o) => o.kind === "schema-key") as {
      key: { class: string; key: string };
    }[];
    const spaced = keyRows.filter((o) => o.key.key.includes(" "));
    expect(spaced).toHaveLength(376);
    expect(new Set(spaced.map((o) => o.key.class)).size).toBe(93);
    expect(keyRows.filter((o) => /[^\S ]|[.#]/.test(o.key.key))).toEqual([]);
    expect(one({ class: "AITaskCharacterStop", key: "Stop flags" })).toMatchObject({
      kind: "schema-key",
      label: "Stop flags",
    });
    // Classes whose keys all have a row state children_count, and it equals those rows: the 93
    // classes with spaced keys got theirs back (BankLocalClass among them).
    const kidRows = new Map<string, number>();
    for (const o of keyRows) kidRows.set(o.key.class, (kidRows.get(o.key.class) ?? 0) + 1);
    for (const o of obs.filter((x) => x.kind === "schema-class")) {
      const cls = (o.key as { class: string }).class;
      if (o.children_count !== undefined) expect(o.children_count, cls).toBe(kidRows.get(cls) ?? 0);
      expect(String(o.what), cls).not.toContain("keys are not emitted");
    }
    expect(one({ class: "BankLocalClass" })?.children_count).toBe(32);
    expect(kidRows.get("BankLocalClass")).toBe(32);
    expect(one({ class: "AITaskCharacterStop" })?.children_count).toBe(4);
    // No class row's parent module differs from E09's module for that format.
    for (const o of obs) {
      const p = o.parent_key as { dim: string; module: string; key: { ext?: string } };
      if (p.dim === "file") expect(p.module, String(p.key.ext)).toBe(fileTypeModule(p.key.ext!));
    }
  }, 600_000);
});
