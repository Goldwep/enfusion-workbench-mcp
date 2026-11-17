import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { buildLedger } from "../../src/census/build-ledger.js";
import { loadConfig } from "../../src/config.js";
import {
  analyze,
  callSitesDocument,
  importOperators,
  observationFileText,
  readSources,
  readZipEntries,
  run as runE19,
  stringLiteral,
  tokenize,
  type PySource,
} from "../../scripts/census/enumerators/e19-blender-operators.js";
import { makeCensus, runIn } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── A synthetic add-on ────────────────────────────────────────────────────────

const ADDON = "scripts/addons/Demo";

const FILES: Record<string, string> = {
  "__init__.py": [
    "bl_info = {",
    '    "name": "Demo",',
    '    "version": (0, 0, 0),',
    '    "blender": (4, 5, 0),',
    "}",
    "",
  ].join("\n"),
  "extern/enfusion/workbench.py": [
    "import json",
    "import socket",
    "import typing",
    "",
    "",
    "def call_function(connection_info, function_name: str, function_parameters: dict[str, typing.Any]):",
    '    """Sends a call."""',
    "    client_socket = socket.socket()",
    "    return {}",
    "",
    "",
    "def get_status(connection_info):",
    '    response = call_function(connection_info, "IsWorkbenchRunning", {})',
    '    if not response.get("IsRunning", False):',
    "        return False",
    "    return True",
    "",
  ].join("\n"),
  "info.py": ["def get_info():", "    return None", ""].join("\n"),
  "util.py": [
    "from enfusion import workbench",
    "from .info import get_info",
    "",
    "",
    "def register_files(paths):",
    "    params = {}",
    '    params["path"] = paths',
    '    output = workbench.call_function(get_info(), "RegisterResource", params)',
    '    return output.get("Output")',
    "",
    "",
    "class Other:",
    "    def touch(self):",
    '        return workbench.call_function(None, "Ping", {"a": 1})',
    "",
  ].join("\n"),
  "ops.py": [
    "import bpy",
    "from bpy.types import Operator",
    "from enfusion import workbench",
    "from . import util",
    "from .util import register_files",
    "",
    "",
    "class HelperNotOperator:",
    '    """Not an operator."""',
    '    bl_idname = "demo.not_operator"',
    "",
    "",
    "class DemoBase(bpy.types.Operator):",
    "    pass",
    "",
    "",
    "class DEMO_OT_export(DemoBase):",
    '    """Exports and registers"""',
    "",
    '    bl_idname = "demo.export"',
    '    bl_label = "Export " "Thing"',
    "    bl_description = (",
    '        "Export the thing.\\n"',
    '        "Requires Workbench."',
    "    )",
    "",
    "    def execute(self, context):",
    "        response = workbench.call_function(",
    "            self.info,",
    '            "ExportFBXResource",',
    "            {",
    '                "resourcePath": "x",',
    '                "exportMorphs": True,',
    "                **extra,",
    "            },",
    "        )",
    '        if response["status"] != "OK":',
    '            return {"CANCELLED"}',
    '        util.register_files(["a"])',
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_helper(Operator):",
    '    bl_idname = "demo.helper"',
    '    bl_label = "Helper"',
    "",
    "    def execute(self, context):",
    "        register_files([])",
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_status(Operator):",
    '    bl_idname = "demo.status"',
    '    bl_label = "Status"',
    "",
    "    def execute(self, context):",
    "        if not workbench.get_status(None):",
    '            return {"CANCELLED"}',
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_chain(Operator):",
    '    bl_idname = "demo.chain"',
    '    bl_label = "Chain"',
    "",
    "    def execute(self, context):",
    '        bpy.ops.demo.helper("INVOKE_DEFAULT")',
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_plain(Operator):",
    '    """Does nothing with Workbench."""',
    "",
    '    bl_idname = "demo.plain"',
    '    bl_label = "Plain"',
    "",
    "    def execute(self, context):",
    '        text = """',
    "class Fake(Operator):",
    '    bl_idname = "demo.fake"',
    '"""',
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_dup(Operator):",
    '    bl_idname = "demo.plain"',
    "",
    "    def execute(self, context):",
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_nameonly(Operator):",
    '    bl_idname = "demo.nameonly"',
    "",
    "    def execute(self, context):",
    "        thing.touch()",
    '        return {"FINISHED"}',
    "",
    "",
    "class DEMO_OT_nobl(Operator):",
    "    def execute(self, context):",
    '        return {"FINISHED"}',
    "",
    "",
    "def on_done():",
    '    workbench.call_function(None, "OverrideMeshObjectMaterial", {})',
    "",
    "",
    "class DEMO_OT_callback(Operator):",
    '    bl_idname = "demo.callback"',
    '    bl_label = "Callback"',
    "",
    "    def execute(self, context):",
    "        schedule(callback=on_done)",
    '        return {"FINISHED"}',
    "",
  ].join("\n"),
};

function synthetic(): PySource[] {
  return Object.entries(FILES)
    .map(([rel, text]) => ({ rel: `${ADDON}/${rel}`, text, raw: Buffer.from(text) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}

function toolsTree(): string {
  const tools = mkdtempSync(join(tmpdir(), "e19-tools-"));
  writeTree(
    join(tools, "Blender"),
    Object.fromEntries(Object.entries(FILES).map(([rel, t]) => [`${ADDON}/${rel}`, t])),
  );
  return tools;
}

/** A zip with stored and deflated entries (no checksums: the reader does not verify them). */
function makeZip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let i = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const deflate = i++ % 2 === 1;
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

describe("e19 tokenizer", () => {
  it("keeps a class statement inside a triple-quoted string out of the code", () => {
    const { lines, problems } = tokenize('x = """\nclass Fake(Operator):\n    pass\n"""\ny = 1\n');
    expect(problems).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0].toks.map((t) => t.v)).toEqual([
      "x",
      "=",
      "\nclass Fake(Operator):\n    pass\n",
    ]);
    expect(lines[1].line).toBe(5);
  });

  it("joins lines inside brackets and after a backslash, drops comments, reads prefixed strings", () => {
    const { lines } = tokenize(
      [
        "d = {  # comment",
        '    "a": 1,',
        '    "b": rb"x\\y",',
        "}",
        "z = 1 + \\",
        "    2",
        "",
      ].join("\n"),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].line).toBe(1);
    expect(lines[0].endLine).toBe(4);
    expect(lines[1].toks.map((t) => t.v)).toEqual(["z", "=", "1", "+", "2"]);
  });

  it("evaluates string literals joined by + or implicit concatenation, and refuses f-strings", () => {
    const lit = (s: string): string | undefined => stringLiteral(tokenize(s).lines[0].toks);
    expect(lit('("a" "b\\n" + "c")')).toBe("ab\nc");
    expect(lit('f"x{y}"')).toBeUndefined();
    expect(lit("name")).toBeUndefined();
  });
});

// ── Analysis of the synthetic add-on ──────────────────────────────────────────

describe("e19 analysis of a synthetic add-on", () => {
  const a = analyze(synthetic());
  const byId = (id: string) => a.operators.find((o) => o.bl_idname === id);

  it("finds operator classes through bases, and nothing that only looks like one", () => {
    expect(a.operators.map((o) => o.class_name).sort()).toEqual([
      "DEMO_OT_callback",
      "DEMO_OT_chain",
      "DEMO_OT_dup",
      "DEMO_OT_export",
      "DEMO_OT_helper",
      "DEMO_OT_nameonly",
      "DEMO_OT_nobl",
      "DEMO_OT_plain",
      "DEMO_OT_status",
      "DemoBase",
    ]);
    expect(a.withoutBlIdname.map((o) => o.class_name).sort()).toEqual(["DEMO_OT_nobl", "DemoBase"]);
    expect(a.duplicates.map((o) => o.class_name)).toEqual(["DEMO_OT_dup"]);
    expect(a.tokenProblems).toEqual([]);
  });

  it("reads label, description, docstring and the class line", () => {
    const e = byId("demo.export");
    expect(e?.bl_label).toBe("Export Thing");
    expect(e?.bl_description).toBe("Export the thing.\nRequires Workbench.");
    expect(e?.docstring).toBe("Exports and registers");
    expect(e?.bl_idname_text).toBe('bl_idname = "demo.export"');
    expect(e?.file).toBe(`${ADDON}/ops.py`);
    expect(a.project.byRel.get(`${ADDON}/ops.py`)?.textLines[(e?.line ?? 0) - 1]).toMatch(
      /^class DEMO_OT_export\(/,
    );
    expect(byId("demo.plain")?.docstring).toBe("Does nothing with Workbench.");
  });

  it("classifies reach: direct, through a helper, through an operator invocation, a callback, none", () => {
    expect(byId("demo.export")?.reach).toBe("direct"); // the call site is in its own execute
    expect(byId("demo.helper")?.reach).toBe("call"); // imported name, helper module
    expect(byId("demo.status")?.reach).toBe("call"); // the client's get_status
    expect(byId("demo.chain")?.reach).toBe("call"); // bpy.ops.demo.helper(...)
    expect(byId("demo.callback")?.reach).toBe("ref");
    expect(byId("demo.plain")?.reach).toBe("none");
    expect(byId("demo.nameonly")?.reach).toBe("name"); // thing.touch() on an unknown receiver
  });

  it("finds every call site with its NET name, request keys, response keys and line", () => {
    const sites = a.callSites.map(
      (s) => `${s.file.replace(`${ADDON}/`, "")}:${s.line} ${s.net_function}`,
    );
    expect(sites).toEqual([
      `extern/enfusion/workbench.py:${lineOf("extern/enfusion/workbench.py", "IsWorkbenchRunning")} IsWorkbenchRunning`,
      `ops.py:${lineOf("ops.py", "response = workbench.call_function(")} ExportFBXResource`,
      `ops.py:${lineOf("ops.py", "OverrideMeshObjectMaterial")} OverrideMeshObjectMaterial`,
      `util.py:${lineOf("util.py", '"RegisterResource"')} RegisterResource`,
      `util.py:${lineOf("util.py", '"Ping"')} Ping`,
    ]);
    const exp = a.callSites.find((s) => s.net_function === "ExportFBXResource");
    expect(exp?.params).toEqual({
      keys: ["exportMorphs", "resourcePath"],
      source: "literal",
      other: ["**extra"],
    });
    expect(exp?.response_keys.map((r) => r.key)).toEqual(["status"]);
    expect(exp?.enclosing).toBe("DEMO_OT_export.execute");
    expect(exp?.client).toBe("module-function");
    const reg = a.callSites.find((s) => s.net_function === "RegisterResource");
    expect(reg?.params).toMatchObject({ keys: ["path"], source: "variable", variable: "params" });
    expect(reg?.response_keys.map((r) => r.key)).toEqual(["Output"]);
    const st = a.callSites.find((s) => s.net_function === "IsWorkbenchRunning");
    expect(st?.response_keys.map((r) => r.key)).toEqual(["IsRunning"]);
    expect(st?.params.source).toBe("literal");
    expect(st?.operators).toEqual(["demo.status"]);
    const reg2 = a.callSites.find((s) => s.net_function === "RegisterResource");
    expect(reg2?.operators).toEqual(["demo.chain", "demo.export", "demo.helper"]);
    const cb = a.callSites.find((s) => s.net_function === "OverrideMeshObjectMaterial");
    expect(cb?.operators).toEqual([]);
    expect(cb?.operators_via_refs).toEqual(["demo.callback"]);
    expect(a.clientFiles.map((c) => c.file)).toEqual([`${ADDON}/extern/enfusion/workbench.py`]);
  });

  it("reads the version from bl_info", () => {
    expect(a.version.bl_info_version).toBe("(0, 0, 0)");
    expect(a.version.bl_info_blender).toBe("(4, 5, 0)");
    const b = analyze(synthetic(), { build_ver: '{"build_number":"13","core_version":"2026-06"}' });
    expect(b.version.build_number).toBe("13");
    expect(b.version.core_version).toBe("2026-06");
  });
});

function lineOf(rel: string, needle: string): number {
  return FILES[rel].split("\n").findIndex((l) => l.includes(needle)) + 1;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

describe("e19 rows", () => {
  it("emits one row per operator that reaches Workbench, none for name-only or no reach", () => {
    const r = importOperators(synthetic());
    expect(r.rows.map((x) => x.id)).toEqual([
      "ui:BlenderTools/blender-operator/demo.callback",
      "ui:BlenderTools/blender-operator/demo.chain",
      "ui:BlenderTools/blender-operator/demo.export",
      "ui:BlenderTools/blender-operator/demo.helper",
      "ui:BlenderTools/blender-operator/demo.status",
    ]);
    const left = Object.fromEntries(r.leftOut.map((l) => [l.what, l.names]));
    expect(left["operators that never reach Workbench"]).toEqual(["demo.plain"]);
    expect(left["operators reaching Workbench only through name-matched calls"]).toEqual([
      "demo.nameonly",
    ]);
    const exp = r.rows.find((x) => x.id.endsWith("demo.export"))?.obs;
    expect(exp).toMatchObject({
      dim: "ui",
      kind: "blender-operator",
      module: "BlenderTools",
      key: { path: ["demo.export"] },
      parent_key: null,
      label: "Export Thing",
      class_name: "DEMO_OT_export",
      what: "Export the thing. Requires Workbench.",
      origin: "vanilla",
      quote: "class DEMO_OT_export(DemoBase):",
      signature: 'bl_idname = "demo.export"',
      confidence: "high",
    });
    expect(exp?.unverified).toBeUndefined();
    expect(exp?.ref).toBe(
      `<tools>/Blender/${ADDON}/ops.py#L${lineOf("ops.py", "class DEMO_OT_export")}`,
    );
  });

  it("uses the class docstring when there is no bl_description, and omits an absent label", () => {
    const r = importOperators(synthetic());
    const chain = r.rows.find((x) => x.id.endsWith("demo.chain"))?.obs;
    expect(chain?.what).toBeUndefined();
    const sources = synthetic();
    const t = sources.find((s) => s.rel.endsWith("ops.py"));
    if (!t) throw new Error("fixture");
    const text = t.text.replace('    bl_label = "Helper"\n', '    """Registers files."""\n');
    const r2 = importOperators([
      ...sources.filter((s) => s !== t),
      { rel: t.rel, text, raw: Buffer.from(text) },
    ]);
    const helper = r2.rows.find((x) => x.id.endsWith("demo.helper"))?.obs;
    expect(helper?.label).toBeUndefined();
  });

  it("is deterministic: the file text is identical on a second run", () => {
    const a = observationFileText(importOperators(synthetic()), "1.0.0.1");
    const b = observationFileText(importOperators(synthetic()), "1.0.0.1");
    expect(a).toBe(b);
    const lines = a.trimEnd().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      $header: 1,
      enumerator: "E19",
      generator: "scripts/census/enumerators/e19-blender-operators.ts",
      provisional: false,
      row_count: 5,
    });
    expect(lines).toHaveLength(6);
    expect(lines[0]).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

// ── Receiver types and stated conditions (a second synthetic add-on) ──────────

const ADDON2 = "scripts/addons/Demo2";

const FILES2: Record<string, string> = {
  "__init__.py": FILES["__init__.py"].replace('"Demo"', '"Demo2"'),
  "extern/enfusion/workbench.py": FILES["extern/enfusion/workbench.py"],
  "core.py": [
    "import bpy",
    "import typing",
    "from enfusion import workbench",
    "",
    "",
    "class Reporter:",
    "    def send(self):",
    '        return workbench.call_function(None, "Ping", {})',
    "",
    "",
    "class Cache:",
    "    def send(self):",
    "        return 1",
    "",
    "    @classmethod",
    "    def create(cls) -> typing.Self:",
    "        return cls()",
    "",
    "",
    "def make_reporter():",
    "    return Reporter()",
    "",
    "",
    "class Holder:",
    "    def __init__(self):",
    "        self.reporter = Reporter()",
    "",
    "    def current(self):",
    "        r = self.reporter",
    "        r.send()",
    "",
    "",
    "def always():",
    '    workbench.call_function(None, "Always", {})',
    "",
    "",
    "def notify(msg):",
    "    if bpy.app.background:",
    '        workbench.call_function(None, "BakeInfo", {"msg": msg})',
    "    else:",
    "        print(msg)",
    "",
  ].join("\n"),
  "ops.py": [
    "import sqlite3",
    "import bpy",
    "from bpy.types import Operator",
    "from .core import Cache, Holder, always, make_reporter, notify",
    "",
    "",
    "def poke_mesh(mesh: bpy.types.Mesh):",
    "    mesh.send()",
    "",
    "",
    "def poke_op(op: bpy.types.Operator):",
    "    op.send()",
    "",
    "",
    "def read_db(path):",
    "    conn = sqlite3.connect(path)",
    "    cur = conn.cursor()",
    "    cur.send()",
    "",
    "",
    "class D2_OT_typed_cache(Operator):",
    '    bl_idname = "demo2.typed_cache"',
    "",
    "    def execute(self, context):",
    "        c = Cache.create()",
    "        c.send()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_typed_return(Operator):",
    '    bl_idname = "demo2.typed_return"',
    "",
    "    def execute(self, context):",
    "        r = make_reporter()",
    "        r.send()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_typed_attribute(Operator):",
    '    bl_idname = "demo2.typed_attribute"',
    "",
    "    def execute(self, context):",
    "        h = Holder()",
    "        h.current()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_chained_expression(Operator):",
    '    bl_idname = "demo2.chained_expression"',
    "",
    "    def execute(self, context):",
    "        Holder().current()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_library_annotation(Operator):",
    '    bl_idname = "demo2.library_annotation"',
    "",
    "    def execute(self, context):",
    "        poke_mesh(context.object.data)",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_library_call(Operator):",
    '    bl_idname = "demo2.library_call"',
    "",
    "    def execute(self, context):",
    '        read_db("x")',
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_operator_annotation(Operator):",
    '    bl_idname = "demo2.operator_annotation"',
    "",
    "    def execute(self, context):",
    "        poke_op(self)",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_conflicting(Operator):",
    '    bl_idname = "demo2.conflicting"',
    "",
    "    def execute(self, context):",
    "        x = Cache()",
    "        x = unknown_thing()",
    "        x.send()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_only_conditional(Operator):",
    '    bl_idname = "demo2.only_conditional"',
    "",
    "    def execute(self, context):",
    '        notify("x")',
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_mixed(Operator):",
    '    bl_idname = "demo2.mixed"',
    "",
    "    def execute(self, context):",
    '        notify("x")',
    "        always()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_guarded_edge(Operator):",
    '    bl_idname = "demo2.guarded_edge"',
    "",
    "    def execute(self, context):",
    "        if self.enabled:",
    "            always()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_one_line_if(Operator):",
    '    bl_idname = "demo2.one_line_if"',
    "",
    "    def execute(self, context):",
    "        if self.enabled: always()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_else_branch(Operator):",
    '    bl_idname = "demo2.else_branch"',
    "",
    "    def execute(self, context):",
    "        if self.enabled:",
    "            pass",
    "        else:",
    "            always()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D2_OT_loop(Operator):",
    '    bl_idname = "demo2.loop"',
    "",
    "    def execute(self, context):",
    "        for item in self.items:",
    "            always()",
    '        return {"FINISHED"}',
    "",
  ].join("\n"),
};

function synthetic2(): PySource[] {
  return Object.entries(FILES2)
    .map(([rel, text]) => ({ rel: `${ADDON2}/${rel}`, text, raw: Buffer.from(text) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function lineOf2(rel: string, needle: string): number {
  return FILES2[rel].split("\n").findIndex((l) => l.includes(needle)) + 1;
}

describe("e19 receiver types", () => {
  const a = analyze(synthetic2());
  const reach = (id: string) => a.operators.find((o) => o.bl_idname === id)?.reach;

  it("follows a factory's return annotation, its return statements and an attribute set in the class", () => {
    expect(reach("demo2.typed_return")).toBe("call"); // make_reporter() returns Reporter()
    expect(reach("demo2.typed_attribute")).toBe("call"); // self.reporter = Reporter() in __init__
    expect(reach("demo2.chained_expression")).toBe("call"); // Holder().current(): the receiver is an expression
    // Cache.create() is annotated `-> typing.Self`: c is a Cache, whose send() never reaches Workbench,
    // although Reporter.send() has the same name.
    expect(reach("demo2.typed_cache")).toBe("none");
  });

  it("proves a library or Blender class receiver is no project code", () => {
    expect(reach("demo2.library_annotation")).toBe("none"); // mesh: bpy.types.Mesh
    expect(reach("demo2.library_call")).toBe("none"); // sqlite3.connect(...).cursor()
    const calls = Object.fromEntries(a.typedCalls.map((t) => [t.callee, t.receiver]));
    expect(calls["mesh.send"]).toBe("external");
    expect(calls["cur.send"]).toBe("external");
    expect(calls["c.send"]).toBe("Cache");
    expect(calls["r.send"]).toBe("Reporter");
  });

  it("leaves a receiver whose type the source does not give name-matched", () => {
    // `op: bpy.types.Operator` can hold any project operator; two assignments of x disagree.
    expect(reach("demo2.operator_annotation")).toBe("name");
    expect(reach("demo2.conflicting")).toBe("name");
    const names = a.nameCalls.map((n) => n.callee);
    expect(names).toContain("op.send");
    expect(names).toContain("x.send");
    expect(names).not.toContain("mesh.send");
  });

  it("emits rows only for the operators it can prove reach Workbench", () => {
    const r = importOperators(synthetic2());
    const ids = r.rows.map((x) => x.id.replace("ui:BlenderTools/blender-operator/", ""));
    expect(ids).toEqual(
      expect.arrayContaining([
        "demo2.typed_return",
        "demo2.typed_attribute",
        "demo2.chained_expression",
      ]),
    );
    for (const gone of [
      "demo2.typed_cache",
      "demo2.library_annotation",
      "demo2.library_call",
      "demo2.operator_annotation",
      "demo2.conflicting",
    ]) {
      expect(ids).not.toContain(gone);
    }
    const left = Object.fromEntries(r.leftOut.map((l) => [l.what, l.names]));
    expect(left["operators reaching Workbench only through name-matched calls"]).toEqual([
      "demo2.conflicting",
      "demo2.operator_annotation",
    ]);
  });
});

describe("e19 stated conditions", () => {
  const r = importOperators(synthetic2());
  const row = (id: string) => r.rows.find((x) => x.id.endsWith(`/${id}`))?.obs;

  it("keeps an operator whose only Workbench call sits behind an if, at medium confidence with the condition stated", () => {
    const o = row("demo2.only_conditional");
    expect(o?.confidence).toBe("medium");
    expect(o?.unverified).toHaveLength(1);
    const claim = (o?.unverified ?? [""])[0];
    expect(claim).toContain("if bpy.app.background:");
    expect(claim).toContain(
      `<tools>/Blender/${ADDON2}/core.py#L${lineOf2("core.py", "if bpy.app.background:")}`,
    );
    expect(claim).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("states a condition on a call edge, on a one-line if and on an else branch", () => {
    expect((row("demo2.guarded_edge")?.unverified ?? [""])[0]).toContain("if self.enabled:");
    expect(row("demo2.guarded_edge")?.confidence).toBe("medium");
    expect((row("demo2.one_line_if")?.unverified ?? [""])[0]).toContain(
      "if self.enabled: always()",
    );
    expect((row("demo2.else_branch")?.unverified ?? [""])[0]).toContain(
      "else (none of: if self.enabled:)",
    );
  });

  it("stays high when some path to Workbench is not behind a condition (mixed, loop)", () => {
    expect(row("demo2.mixed")?.confidence).toBe("high");
    expect(row("demo2.mixed")?.unverified).toBeUndefined();
    expect(row("demo2.loop")?.confidence).toBe("high"); // a for loop is not a stated condition
  });

  it("records the conditions in the call-site table", () => {
    const op = r.analysis.operators.find((o) => o.bl_idname === "demo2.only_conditional");
    expect(op?.conditions.map((g) => g.text)).toEqual(["if bpy.app.background:"]);
    const notify = r.analysis.callSites.find((s) => s.net_function === "BakeInfo");
    expect(notify?.guards.map((g) => g.text)).toEqual(["if bpy.app.background:"]);
    const always = r.analysis.callSites.find((s) => s.net_function === "Always");
    expect(always?.guards).toEqual([]);
  });
});

// ── The chain an `else` closes (a third synthetic add-on) ─────────────────────

/** An operator class whose `execute` holds `body` (indented by the caller relative to the method). */
function operatorClass(name: string, idname: string, body: string[]): string[] {
  return [
    `class ${name}(Operator):`,
    `    bl_idname = "${idname}"`,
    "",
    "    def execute(self, context):",
    ...body.map((l) => `        ${l}`),
    '        return {"FINISHED"}',
    "",
    "",
  ];
}

const ADDON3 = "scripts/addons/Demo3";

const FILES3: Record<string, string> = {
  "__init__.py": FILES["__init__.py"].replace('"Demo"', '"Demo3"'),
  "extern/enfusion/workbench.py": FILES["extern/enfusion/workbench.py"],
  "core.py": [
    "from enfusion import workbench",
    "",
    "",
    "def always():",
    '    workbench.call_function(None, "Always", {})',
    "",
  ].join("\n"),
  "ops.py": [
    "from bpy.types import Operator",
    "from .core import always",
    "",
    "",
    // an `else` that closes a loop, a `try` or a `while` is not the `else` of the `if` before it
    ...operatorClass("D3_OT_for_else", "demo3.for_else", [
      "if self.enabled:",
      "    pass",
      "for item in self.items:",
      "    pass",
      "else:",
      "    always()",
    ]),
    ...operatorClass("D3_OT_try_else", "demo3.try_else", [
      "if self.enabled:",
      "    pass",
      "try:",
      "    pass",
      "except ValueError:",
      "    pass",
      "else:",
      "    always()",
    ]),
    ...operatorClass("D3_OT_while_else", "demo3.while_else", [
      "if self.enabled:",
      "    pass",
      "while self.running:",
      "    pass",
      "else:",
      "    always()",
    ]),
    // an `if` in an earlier block, at the indent of a later block's `for`
    ...operatorClass("D3_OT_stale_block", "demo3.stale_block", [
      "if self.a:",
      "    if self.b:",
      "        pass",
      "if self.c:",
      "    for item in self.items:",
      "        pass",
      "    else:",
      "        always()",
    ]),
    // controls: an `else` that does close an `if` chain still names every branch of it
    ...operatorClass("D3_OT_if_chain", "demo3.if_chain", [
      "if self.a:",
      "    pass",
      "elif self.b:",
      "    pass",
      "else:",
      "    always()",
    ]),
    ...operatorClass("D3_OT_outer_else", "demo3.outer_else", [
      "if self.a:",
      "    if self.b:",
      "        pass",
      "    else:",
      "        pass",
      "else:",
      "    always()",
    ]),
  ].join("\n"),
};

function synthetic3(): PySource[] {
  return Object.entries(FILES3)
    .map(([rel, text]) => ({ rel: `${ADDON3}/${rel}`, text, raw: Buffer.from(text) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

describe("e19 the chain an else closes", () => {
  const a = analyze(synthetic3());
  const stated = (id: string): string[] | undefined =>
    a.operators.find((o) => o.bl_idname === id)?.conditions.map((g) => g.text);

  it("gives an else that closes a for, try or while its own header, not the earlier if at that indent", () => {
    expect(stated("demo3.for_else")).toEqual(["else:"]);
    expect(stated("demo3.try_else")).toEqual(["else:"]);
    expect(stated("demo3.while_else")).toEqual(["else:"]);
  });

  it("does not carry an if of an earlier block into a later block at the same indent", () => {
    expect(stated("demo3.stale_block")).toEqual(["if self.c:", "else:"]);
  });

  it("still names every branch of the chain an else does close", () => {
    expect(stated("demo3.if_chain")).toEqual(["else (none of: if self.a: / elif self.b:)"]);
    expect(stated("demo3.outer_else")).toEqual(["else (none of: if self.a:)"]);
  });
});

// ── Conditions an operator switches off itself (a fourth synthetic add-on) ────

const ADDON4 = "scripts/addons/Demo4";

/** A module variable, its setter, and a function that calls Workbench only while the variable is true. */
function flagBlock(tag: string): string[] {
  const v = `FLAG_${tag.toUpperCase()}`;
  return [
    `${v} = True`,
    "",
    "",
    `def set_${tag}(active):`,
    `    global ${v}`,
    `    ${v} = active`,
    "",
    "",
    `def report_${tag}():`,
    `    if ${v}:`,
    `        workbench.call_function(None, "Report${tag.toUpperCase()}", {})`,
    "",
    "",
  ];
}

const FILES4: Record<string, string> = {
  "__init__.py": FILES["__init__.py"].replace('"Demo"', '"Demo4"'),
  "extern/enfusion/workbench.py": FILES["extern/enfusion/workbench.py"],
  "core.py": [
    "from enfusion import workbench",
    "",
    "",
    ...["a", "k", "b", "c", "d", "e", "h", "i", "s", "x", "z"].flatMap(flagBlock),
    "MUTE = False",
    "",
    "",
    "def set_mute(value):",
    "    global MUTE",
    "    MUTE = value",
    "",
    "",
    "def report_mute():",
    "    if not MUTE:",
    '        workbench.call_function(None, "ReportMute", {})',
    "",
    "",
    "FLAG_G = True",
    "",
    "",
    "def report_g():",
    "    if FLAG_G:",
    '        workbench.call_function(None, "ReportG", {})',
    "",
    "",
    "def report_open():",
    '    workbench.call_function(None, "ReportOpen", {})',
    "",
  ].join("\n"),
  "ops.py": [
    "from bpy.types import Operator",
    "from enfusion import workbench",
    "from . import core",
    "from .core import report_a, set_a",
    "",
    "FLAG_LOCAL = True",
    "",
    "",
    "def report_local():",
    "    if FLAG_LOCAL:",
    '        workbench.call_function(None, "ReportLocal", {})',
    "",
    "",
    // left out: the entry point fixes the tested variable before the call that leads to Workbench
    ...operatorClass("D4_OT_silenced", "demo4.silenced", ["set_a(False)", "report_a()"]),
    ...operatorClass("D4_OT_keyword", "demo4.keyword", [
      "core.set_k(active=False)",
      "core.report_k()",
    ]),
    ...operatorClass("D4_OT_negated", "demo4.negated", [
      "core.set_mute(True)",
      "core.report_mute()",
    ]),
    ...operatorClass("D4_OT_direct_global", "demo4.direct_global", [
      "global FLAG_LOCAL",
      "FLAG_LOCAL = False",
      "report_local()",
    ]),
    ...operatorClass("D4_OT_attribute_form", "demo4.attribute_form", [
      "core.FLAG_G = False",
      "core.report_g()",
    ]),
    // kept: set after the call, to the wrong value, not a constant elsewhere, conditionally, as a callback
    ...operatorClass("D4_OT_late", "demo4.late", ["core.report_b()", "core.set_b(False)"]),
    ...operatorClass("D4_OT_unset", "demo4.unset", ["core.report_c()"]),
    ...operatorClass("D4_OT_wrong_value", "demo4.wrong_value", [
      "core.set_d(True)",
      "core.report_d()",
    ]),
    ...operatorClass("D4_OT_shared_one", "demo4.shared_one", [
      "core.set_e(False)",
      "core.report_e()",
    ]),
    ...operatorClass("D4_OT_shared_two", "demo4.shared_two", ["core.set_e(self.flag)"]),
    ...operatorClass("D4_OT_conditional_setter", "demo4.conditional_setter", [
      "if self.quiet:",
      "    core.set_h(False)",
      "core.report_h()",
    ]),
    ...operatorClass("D4_OT_other_path", "demo4.other_path", [
      "core.set_i(False)",
      "core.report_i()",
      "core.report_open()",
    ]),
    "class D4_OT_second_entry(Operator):",
    '    bl_idname = "demo4.second_entry"',
    "",
    "    def execute(self, context):",
    "        core.set_s(False)",
    "        core.report_s()",
    '        return {"FINISHED"}',
    "",
    "    def invoke(self, context, event):",
    "        core.report_s()",
    '        return {"FINISHED"}',
    "",
    "",
    ...operatorClass("D4_OT_callback_setter", "demo4.callback_setter", [
      "core.set_z(False)",
      "core.report_z()",
    ]),
    ...operatorClass("D4_OT_callback_user", "demo4.callback_user", ["schedule(core.set_z)"]),
    // an inherited entry point is not the operator's own
    "class D4_Base(Operator):",
    "    def execute(self, context):",
    "        core.set_x(False)",
    "        core.report_x()",
    '        return {"FINISHED"}',
    "",
    "",
    "class D4_OT_inherits_only(D4_Base):",
    '    bl_idname = "demo4.inherits_only"',
    "",
    "",
    ...operatorClass("D4_OT_inherits_call", "demo4.inherits_call", ["core.report_x()"]).map(
      (l, i) => (i === 0 ? "class D4_OT_inherits_call(D4_Base):" : l),
    ),
  ].join("\n"),
};

function synthetic4(): PySource[] {
  return Object.entries(FILES4)
    .map(([rel, text]) => ({ rel: `${ADDON4}/${rel}`, text, raw: Buffer.from(text) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

function lineOf4(rel: string, needle: string): number {
  return FILES4[rel].split("\n").findIndex((l) => l.includes(needle)) + 1;
}

describe("e19 conditions an operator switches off itself", () => {
  const r = importOperators(synthetic4());
  const ids = r.rows.map((x) => x.id.replace("ui:BlenderTools/blender-operator/", ""));
  const row = (id: string) => r.rows.find((x) => x.id.endsWith(`/${id}`))?.obs;
  const op = (id: string) => r.analysis.operators.find((o) => o.bl_idname === id);
  const switchedOff = [
    "demo4.attribute_form",
    "demo4.direct_global",
    "demo4.keyword",
    "demo4.negated",
    "demo4.silenced",
  ];

  it("leaves out an operator whose own entry point makes the tested variable false before the call", () => {
    for (const id of switchedOff) {
      expect(ids).not.toContain(id);
      expect(op(id)?.switchedOff).toHaveLength(1);
      expect(op(id)?.reach).not.toBe("none"); // the call graph reaches Workbench; the condition is what stops it
    }
    const left = r.leftOut.find(
      (l) =>
        l.what === "operators that switch off the condition guarding their only path to Workbench",
    );
    expect(left?.names).toEqual(switchedOff);
    const at = (rel: string, needle: string): string =>
      `<tools>/Blender/${ADDON4}/${rel}#L${lineOf4(rel, needle)}`;
    expect(left?.evidence).toEqual([
      `demo4.attribute_form: ${at("ops.py", "core.FLAG_G = False")} core.FLAG_G = False makes false ${at("core.py", "if FLAG_G:")} if FLAG_G:`,
      `demo4.direct_global: ${at("ops.py", "FLAG_LOCAL = False")} FLAG_LOCAL = False makes false ${at("ops.py", "if FLAG_LOCAL:")} if FLAG_LOCAL:`,
      `demo4.keyword: ${at("ops.py", "core.set_k(active=False)")} core.set_k(active=False) makes false ${at("core.py", "if FLAG_K:")} if FLAG_K:`,
      `demo4.negated: ${at("ops.py", "core.set_mute(True)")} core.set_mute(True) makes false ${at("core.py", "if not MUTE:")} if not MUTE:`,
      `demo4.silenced: ${at("ops.py", "set_a(False)")} set_a(False) makes false ${at("core.py", "if FLAG_A:")} if FLAG_A:`,
    ]);
  });

  it("keeps an operator that sets the variable after the call, to the other value, or not to a constant", () => {
    const stays = [
      "demo4.late",
      "demo4.unset",
      "demo4.wrong_value",
      "demo4.shared_one", // another operator passes a value that is not a constant
      "demo4.conditional_setter", // the setter call is inside an if
      "demo4.second_entry", // invoke reaches the call without the setter
      "demo4.callback_setter", // the setter is also handed around as a callback
      "demo4.inherits_only", // the setter is in an inherited entry point
      "demo4.inherits_call",
    ];
    for (const id of stays) {
      expect(ids).toContain(id);
      expect(row(id)?.confidence).toBe("medium");
      expect(op(id)?.switchedOff).toEqual([]);
    }
    expect((row("demo4.late")?.unverified ?? [""])[0]).toContain("if FLAG_B:");
  });

  it("does not touch an operator with an unconditioned path to Workbench", () => {
    expect(row("demo4.other_path")?.confidence).toBe("high");
    expect(row("demo4.other_path")?.unverified).toBeUndefined();
  });

  it("emits every other row and records the decision in the call-site table", () => {
    expect(ids).toEqual([
      "demo4.callback_setter",
      "demo4.conditional_setter",
      "demo4.inherits_call",
      "demo4.inherits_only",
      "demo4.late",
      "demo4.other_path",
      "demo4.second_entry",
      "demo4.shared_one",
      "demo4.unset",
      "demo4.wrong_value",
    ]);
    const doc = callSitesDocument(r, "1.0.0.1") as {
      operators: { bl_idname: string | null; emitted: boolean; switched_off_by: string[] }[];
    };
    const silenced = doc.operators.find((o) => o.bl_idname === "demo4.silenced");
    expect(silenced?.emitted).toBe(false);
    expect(silenced?.switched_off_by).toHaveLength(1);
    expect(silenced?.switched_off_by[0]).toContain("set_a(False) ->");
    expect(doc.operators.find((o) => o.bl_idname === "demo4.late")?.switched_off_by).toEqual([]);
    expect(JSON.stringify(doc)).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("is deterministic", () => {
    const first = observationFileText(importOperators(synthetic4()), "1.0.0.1");
    expect(observationFileText(importOperators(synthetic4()), "1.0.0.1")).toBe(first);
  });
});

// ── Sources: folders and zip archives ─────────────────────────────────────────

describe("e19 sources", () => {
  it("reads .py entries of a zip archive in memory (stored and deflated)", () => {
    const entries = readZipEntries(makeZip({ "a/x.py": "x = 1\n", "a/y.py": "y = 2\n" }));
    expect(entries.map((e) => [e.name, e.data.toString()])).toEqual([
      ["a/x.py", "x = 1\n"],
      ["a/y.py", "y = 2\n"],
    ]);
  });

  it("analyses an add-on shipped as a zip, citing entries as <zip>!/<entry>", () => {
    const tools = mkdtempSync(join(tmpdir(), "e19-zip-"));
    const files: Record<string, string> = {};
    for (const [rel, t] of Object.entries(FILES)) files[`Demo/${rel}`] = t;
    mkdirSync(join(tools, "Blender"), { recursive: true });
    writeFileSync(join(tools, "Blender", "addon.zip"), makeZip(files));
    writeFileSync(join(tools, "Blender", "data.txt"), "not python");
    const sources = readSources(join(tools, "Blender"));
    expect(sources.every((s) => s.rel.startsWith("addon.zip!/Demo/"))).toBe(true);
    const r = importOperators(sources);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0].obs.ref).toMatch(/^<tools>\/Blender\/addon\.zip!\/Demo\/ops\.py#L\d+$/);
  });
});

// ── CLI, ledger acceptance and the absent-Tools block ─────────────────────────

describe("e19 run and the ledger", () => {
  it("writes the observation file and the call-site table, and the ledger accepts it", () => {
    const fx = makeCensus("1.0.0.1");
    const tools = toolsTree();
    const art = mkdtempSync(join(tmpdir(), "e19-art-"));
    const args = ["--tools", tools, "--artifacts", art];
    const r = runIn(fx, runE19, args);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /E19 at build 1\.0\.0\.1: 5 \.py files .* 5 rows, 5 distinct NET functions, 5 call sites/,
    );
    const obsFile = join(fx.root, "observations", "E19", "1.0.0.1.jsonl");
    const first = readFileSync(obsFile, "utf-8");

    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    const rows = built.rows.filter((x) => x.kind === "blender-operator");
    expect(rows).toHaveLength(5);
    expect(rows.every((x) => x.sources[0].enumerator === "E19" && !x.provisional)).toBe(true);
    expect(rows.find((x) => x.id.endsWith("demo.export"))?.target_tier).toBe("T2");

    const sitesFile = join(art, "census", "1.0.0.1", "E19", "net-call-sites.json");
    const doc = JSON.parse(readFileSync(sitesFile, "utf-8"));
    expect(doc.call_sites).toHaveLength(5);
    expect(doc.net_functions.map((n: { name: string }) => n.name)).toEqual([
      "ExportFBXResource",
      "IsWorkbenchRunning",
      "OverrideMeshObjectMaterial",
      "Ping",
      "RegisterResource",
    ]);
    const siteText = readFileSync(sitesFile, "utf-8");

    // A second run on the same input is byte-identical.
    expect(runIn(fx, runE19, args).code).toBe(0);
    expect(readFileSync(obsFile, "utf-8")).toBe(first);
    expect(readFileSync(sitesFile, "utf-8")).toBe(siteText);
    expect(siteText).not.toMatch(/[A-Za-z]:[\\/]/);
  });

  it("every row's quote is the verbatim text of the line its ref cites; the bl_idname line is the signature", () => {
    const sources = synthetic();
    const r = importOperators(sources);
    for (const row of r.rows) {
      const m = /^<tools>\/Blender\/(.+)#L(\d+)$/.exec(row.obs.ref);
      expect(m).not.toBeNull();
      const src = sources.find((s) => s.rel === (m as RegExpExecArray)[1]);
      const lines = (src?.text ?? "").split("\n");
      const at = Number((m as RegExpExecArray)[2]);
      expect(lines[at - 1]).toMatch(new RegExp(`^class ${row.obs.class_name}\\(`));
      expect(row.obs.quote).toBe(lines[at - 1].trim());
      expect(row.obs.signature).toMatch(/^bl_idname = "/);
      expect(lines.some((l) => l.trim() === row.obs.signature)).toBe(true);
    }
  });

  it("is skipped with NO DATA (exit 2) when the Tools path is absent, and writes nothing", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE19, ["--tools", join(tmpdir(), "e19-no-such-tools-dir")]);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/NO DATA/);
    expect(existsSync(join(fx.root, "observations", "E19"))).toBe(false);
  });

  it("is skipped with NO DATA when <tools>/Blender holds no Python", () => {
    const fx = makeCensus("1.0.0.1");
    const tools = mkdtempSync(join(tmpdir(), "e19-empty-"));
    mkdirSync(join(tools, "Blender"));
    const r = runIn(fx, runE19, ["--tools", tools]);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/NO DATA/);
  });

  it("refuses an --out outside observations/E19/", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE19, [
      "--tools",
      toolsTree(),
      "--out",
      join(tmpdir(), "elsewhere.jsonl"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing --out/);
  });
});

// ── The real add-on (skipped when the Tools path is absent) ───────────────────

function realBlenderDir(): string | null {
  try {
    const dir = join(loadConfig().workbenchPath, "Blender");
    return existsSync(join(dir, "scripts")) ? dir : null;
  } catch {
    return null;
  }
}
const REAL = realBlenderDir();

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || REAL === null)("e19 against the installed Enfusion Blender Tools", () => {
  const sources = readSources(REAL as string);
  const buildVer = (() => {
    const p = join(REAL as string, "scripts", "addons", "EnfusionBlenderTools", "build_ver.json");
    return existsSync(p) ? readFileSync(p, "utf-8") : undefined;
  })();
  const r = importOperators(sources, buildVer);
  const a = r.analysis;

  it("reproduces the headline counts of build 1.8.0.13", () => {
    expect(a.sources).toBe(213);
    expect(a.bytes).toBe(1590653);
    expect(a.tokenProblems).toEqual([]);
    expect(a.operatorClasses).toBe(200);
    // 15 operators once reached Workbench only through name-matched calls; reading the receivers'
    // types proves none of them does (the remaining 139 never did).
    expect(a.operators.filter((o) => o.reach === "none").length).toBe(154);
    expect(a.operators.filter((o) => o.reach === "name").length).toBe(0);
    // 46 operators reach Workbench through the call graph; one of them switches off its own condition.
    expect(
      a.operators.filter(
        (o) => o.bl_idname !== null && ["direct", "call", "ref"].includes(o.reach),
      ),
    ).toHaveLength(46);
    expect(r.rows).toHaveLength(45);
    expect(a.callSites).toHaveLength(39);
    expect(new Set(a.callSites.map((s) => s.net_function)).size).toBe(31);
    expect(a.version.bl_info_version).toBe("(0, 0, 0)");
    expect(a.version.core_version).toBe("2026-06");
    expect(a.version.build_number).toBe("13");
  });

  it("finds as many call sites as the source has call_function( call expressions", () => {
    let n = 0;
    for (const s of sources) {
      for (const line of s.text.split("\n")) {
        if (/^\s*(def |#|""")/.test(line) || />>>/.test(line)) continue;
        if (/\bcall_function\(/.test(line)) n++;
      }
    }
    expect(a.callSites).toHaveLength(n);
  });

  it("every row's quote is the text of the line its ref cites and its signature is the bl_idname line", () => {
    for (const row of r.rows) {
      const m = /^<tools>\/Blender\/(.+)#L(\d+)$/.exec(row.obs.ref) as RegExpExecArray;
      const src = sources.find((s) => s.rel === m[1]);
      const lines = (src?.text ?? "").split("\n");
      const at = lines[Number(m[2]) - 1];
      expect(at).toMatch(new RegExp(`^class ${row.obs.class_name}\\b`));
      expect(row.obs.quote).toBe(at.trim());
      expect(lines.some((l) => l.trim() === row.obs.signature)).toBe(true);
    }
  });

  it("resolves the 15 operators that once reached Workbench only through name-matched calls", () => {
    // Their only paths ran through `mesh.validate()` (a bpy.types.Mesh parameter), `accessor.set_value(...)`
    // (a factory annotated `-> typing.Self`) and `cur.execute(...)` (sqlite3): none reaches Workbench.
    const resolved = [
      "ebt.adjust_bend_angle",
      "ebt.adjust_jitter_factor",
      "ebt.adjust_noise_scale",
      "ebt.adjust_noise_strength",
      "ebt.adjust_plane_density",
      "ebt.adjust_slice_width",
      "ebt.mesh_slicer_modal_base",
      "ebt.mesh_slicer_toggle_base",
      "ebt.remove_subsurface_profile",
      "ebt.reset_plane",
      "ebt.scale_cutting_plane",
      "ebt.spawn_asset_on_socket_with_reference",
      "ebt.spawn_plane",
      "ebt.toggle_grid_type",
      "ebt.toggle_noise_coords",
    ];
    for (const id of resolved) {
      expect(a.operators.find((o) => o.bl_idname === id)?.reach).toBe("none");
      expect(r.rows.some((x) => x.id.endsWith(`/${id}`))).toBe(false);
    }
    const typed = a.typedCalls.map((t) => `${t.callee}:${t.receiver}`);
    expect(typed).toContain("mesh.validate:external");
    expect(typed).toContain("accessor.set_value:EBTMaterial");
    expect(typed).toContain("cur.execute:external");
  });

  it("states the condition of the eight operators whose every path to Workbench is behind one", () => {
    const medium = r.rows
      .filter((x) => x.obs.confidence === "medium")
      .map((x) => x.id.replace("ui:BlenderTools/blender-operator/", ""));
    expect(medium).toEqual([
      "ebt.bake_blender_foreground_xob_mlod",
      "ebt.bake_blender_start_background_task_xob_mlod",
      "ebt.boxvol",
      "ebt.bsp",
      "ebt.mqa_report_conventions",
      "ebt.occluder",
      "ebt.prtvol",
      "ebt.txa_select_folder",
    ]);
    for (const x of r.rows)
      expect(x.obs.unverified !== undefined).toBe(x.obs.confidence === "medium");
    const fg = r.rows.find((x) => x.id.endsWith("ebt.bake_blender_foreground_xob_mlod"))?.obs;
    expect((fg?.unverified ?? [""])[0]).toContain("if bpy.app.background:");
    expect((fg?.unverified ?? [""])[0]).toContain("if NOTIFY_WORKBENCH:");
  });

  it("leaves out the one operator that switches off the condition guarding its only path, citing the line", () => {
    // bake/operators.py: execute of ebt.bake_blender_background_xob_mlod starts with set_notify_active(False);
    // bake/utils.py: show_error_box calls Workbench only inside `if bpy.app.background:` / `if NOTIFY_WORKBENCH:`.
    const off = a.operators.filter((o) => o.switchedOff.length > 0).map((o) => o.bl_idname);
    expect(off).toEqual(["ebt.bake_blender_background_xob_mlod"]);
    expect(r.rows.some((x) => x.id.endsWith("/ebt.bake_blender_background_xob_mlod"))).toBe(false);
    const left = r.leftOut.find(
      (l) =>
        l.what === "operators that switch off the condition guarding their only path to Workbench",
    );
    expect(left?.names).toEqual(["ebt.bake_blender_background_xob_mlod"]);
    const base = "<tools>/Blender/scripts/addons/EnfusionBlenderTools/bake";
    expect(left?.evidence).toEqual([
      `ebt.bake_blender_background_xob_mlod: ${base}/operators.py#L303 set_notify_active(False) makes false ${base}/utils.py#L163 if NOTIFY_WORKBENCH:`,
    ]);
    // the two operators that share the guard but never set the variable keep their rows
    for (const id of [
      "ebt.bake_blender_foreground_xob_mlod",
      "ebt.bake_blender_start_background_task_xob_mlod",
    ]) {
      expect(a.operators.find((o) => o.bl_idname === id)?.switchedOff).toEqual([]);
    }
  });

  it("is accepted by the ledger in a temporary copy of data/census", () => {
    const fx = makeCensus("1.8.0.13");
    const tools = join(REAL as string, "..");
    const art = mkdtempSync(join(tmpdir(), "e19-real-art-"));
    const res = runIn(fx, runE19, ["--tools", tools, "--artifacts", art]);
    expect(res.code).toBe(0);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.rows.filter((x) => x.kind === "blender-operator")).toHaveLength(45);
  });
});
