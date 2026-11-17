/**
 * E04 — NET surface. Synthetic script sources written inside the test (no
 * vanilla file is copied), determinism, ledger acceptance in a temporary
 * census, and a block against the real game source that is skipped when the
 * E02 source index or the game paks are absent.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  SourceTexts,
  analyzeHandlers,
  contractTable,
  crossCheck,
  parseNetApiDocs,
  parseShapeSignature,
  pythonResponseReads,
  scanStruct,
  shapeSignature,
} from "../../src/census/net-surface.js";
import { buildSourceIndex, loadSourceIndex } from "../../src/census/source-index.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  analyze,
  e05Natives,
  observationRows,
  pakBackend,
  rescanBlender,
  run as runE04,
} from "../../scripts/census/enumerators/e04-net-surface.js";
import { artifactsDir } from "../../scripts/live/paths.js";
import { makeCensus, REAL_CENSUS, REPO_ROOT, runIn, writeObservations } from "./helpers.js";
import { censusPaths } from "../../src/census/ledger-io.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic sources ─────────────────────────────────────────────────────────

const DOCS = [
  "/*!",
  "\\page Page_NetApi Test page",
  "\\subsubsection Page_NetApiDocs_RequestPayload Payload format",
  "Built-in functions:",
  "- **OpenThing**",
  "\t- input:",
  "\t\\code{.json}",
  "\t{",
  '\t\t"APIFunc": "OpenThing",',
  '\t\t"ThingName": "string", // which thing to open',
  "\t}",
  "\t\\endcode",
  "\t- response:",
  "\t\\code{.json}",
  "\t{",
  '\t\t"Opened": "bool", // whether it opened',
  "\t}",
  "\t\\endcode",
  "- **RunCode**",
  "\t- input:",
  "\t\\code{.json}",
  "\t{",
  '\t\t"APIFunc": "RunCode",',
  '\t\t"Code": "string", // source to run',
  "\t}",
  "\t\\endcode",
  "\t- response:",
  "\t\\code{.json}",
  "\t{",
  '\t  "Items": [ { "text": "a", "line": 3 } ],',
  '\t  "Done": false',
  "\t}",
  "\t\\endcode",
  "\\subsection Page_NetApiDocs_Response Response",
  "*/",
  "#ifdef DOXYGEN",
  "class SampleRequest : JsonApiStruct",
  "{",
  "\tstring input;",
  '\tvoid SampleRequest() { RegV("input"); }',
  "}",
  "// A documented example handler",
  "class SampleCall : NetApiHandler",
  "{",
  "\toverride JsonApiStruct GetRequest() { return new SampleRequest(); }",
  "\toverride JsonApiStruct GetResponse(JsonApiStruct request) { return null; }",
  "}",
  "#endif",
  "",
].join("\n");

const BASE = [
  "#ifdef WORKBENCH",
  "class NetApiHandler",
  "{",
  "\tJsonApiStruct GetRequest();",
  "\tJsonApiStruct GetResponse(JsonApiStruct request);",
  "}",
  "#endif",
  "",
].join("\n");

const JSON_STRUCT = [
  "class Managed {}",
  "class JsonApiStruct : Managed",
  "{",
  "\tproto external void RegV(string name);",
  "\tproto external void UnregV(string name);",
  "\tproto external void RegAll();",
  "\tproto external void StartArray(string name);",
  "\tproto external void EndArray();",
  "\tproto external void StartObject(string name);",
  "\tproto external void EndObject();",
  "\tproto external void StoreString(string name, string value);",
  "\tevent void OnPack();",
  "}",
  "",
].join("\n");

const WORKBENCH = [
  "class WBModuleDef",
  "{",
  "\tproto external bool SetOpenedResource(string filename);",
  "}",
  "class ResourceManager : WBModuleDef",
  "{",
  "\tproto external bool RegisterResourceFile(string absFilePath, bool bBuild);",
  "}",
  "class WorldEditor : WBModuleDef {}",
  "sealed class Workbench",
  "{",
  "\tstatic proto WBModuleDef GetModule(typename type);",
  "\tstatic proto int ScriptDialog(string caption, string text, Class data);",
  "}",
  "",
].join("\n");

const HANDLERS = [
  "class BaseReq : JsonApiStruct",
  "{",
  "\tstring path;",
  '\tvoid BaseReq() { RegV("path"); }',
  "}",
  "",
  "class DemoReq : BaseReq",
  "{",
  "\t// how many",
  "\tint count;",
  '\tvoid DemoReq() { RegV("count"); }',
  "}",
  "",
  "class DemoResp : JsonApiStruct",
  "{",
  "\tprivate string status;",
  "\tprivate ref JsonApiStruct data;",
  "\tstatic int s_Count;",
  "\tvoid DemoResp(string s)",
  "\t{",
  "\t\tstatus = s;",
  "\t\tRegAll();",
  "\t\tif (data == null)",
  '\t\t\tUnregV("data");',
  "\t}",
  "}",
  "",
  "class Demo : NetApiHandler",
  "{",
  "\toverride JsonApiStruct GetRequest() { return new DemoReq(); }",
  "\toverride JsonApiStruct GetResponse(JsonApiStruct request)",
  "\t{",
  "\t\tDemoReq req = DemoReq.Cast(request);",
  "\t\tSave(req.path);",
  '\t\treturn DemoResp("OK");',
  "\t}",
  "\tvoid Save(string p)",
  "\t{",
  "\t\tResourceManager rm = Workbench.GetModule(ResourceManager);",
  "\t\trm.RegisterResourceFile(p, false);",
  "\t}",
  "}",
  "",
  "class ListResp : JsonApiStruct",
  "{",
  "\tref array<string> items = {};",
  "\toverride void OnPack()",
  "\t{",
  '\t\tStartArray("Item List");',
  "\t\tEndArray();",
  "\t\tWriteTail();",
  "\t}",
  "\tvoid WriteTail()",
  "\t{",
  '\t\tStartObject("tail");',
  '\t\tStoreString("inner", "x");',
  "\t\tEndObject();",
  "\t}",
  "}",
  "",
  "class Lister : NetApiHandler",
  "{",
  "\toverride JsonApiStruct GetResponse(JsonApiStruct request)",
  "\t{",
  "\t\tListResp r = new ListResp();",
  "\t\treturn r;",
  "\t}",
  "}",
  "",
  "class AskReq : JsonApiStruct",
  "{",
  "\tstring msg;",
  '\tvoid AskReq() { RegV("msg"); }',
  "}",
  "",
  "class AskDialog",
  "{",
  '\t[ButtonAttribute("OK")]',
  "\tvoid Ok() {}",
  "}",
  "",
  "class Ask : NetApiHandler",
  "{",
  "\toverride JsonApiStruct GetRequest() { return new AskReq(); }",
  "\toverride JsonApiStruct GetResponse(JsonApiStruct request)",
  "\t{",
  "\t\tAskReq req = AskReq.Cast(request);",
  "\t\tWorkbench.GetModule(WorldEditor);",
  "\t\tWorkbench.GetModule(ResourceManager);",
  '\t\tWorkbench.ScriptDialog("Ask", req.msg, new AskDialog());',
  "\t\treturn null;",
  "\t}",
  "}",
  "",
].join("\n");

const FILES: Record<string, string> = {
  "scripts/WorkbenchGameCommon/NetApiDocs.c": DOCS,
  "scripts/WorkbenchGameCommon/generated/NetApi/NetApiHandler.c": BASE,
  "scripts/GameLib/generated/online/JsonApiStruct.c": JSON_STRUCT,
  "scripts/GameLib/generated/WorkbenchAPI/Workbench.c": WORKBENCH,
  "scripts/WorkbenchGameCommon/Demo/Handlers.c": HANDLERS,
};

function synthetic(): { index: ReturnType<typeof buildSourceIndex>; src: SourceTexts } {
  const index = buildSourceIndex(
    Object.entries(FILES).map(([path, text]) => ({ path, text })),
    { build: "1.0.0.1" },
  );
  return { index, src: new SourceTexts((p) => FILES[p]) };
}

function sourcesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "e04-src-"));
  for (const [p, t] of Object.entries(FILES)) {
    const f = join(dir, ...p.split("/"));
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, t);
  }
  return dir;
}

// ── Natives ───────────────────────────────────────────────────────────────────

describe("e04 NetApiDocs parsing", () => {
  const natives = parseNetApiDocs(DOCS);

  it("reads every documented built-in function with its request and response keys", () => {
    expect(natives.map((n) => n.name)).toEqual(["OpenThing", "RunCode"]);
    expect(shapeSignature(natives[0].name, natives[0].request, natives[0].response)).toBe(
      "OpenThing(ThingName: string) -> {Opened: bool}",
    );
    expect(shapeSignature(natives[1].name, natives[1].request, natives[1].response)).toBe(
      "RunCode(Code: string) -> {Items: array<{text: string, line: int}>, Done: bool}",
    );
    // Key comments are kept for the artifact; none of them describes the function.
    expect(natives[0].comments).toEqual(["which thing to open", "whether it opened"]);
    expect("what" in natives[0]).toBe(false);
    expect(natives[0].line).toBe(5);
    expect(natives[0].quote).toBe("- **OpenThing**");
  });

  it("parses a shape signature back into key names", () => {
    expect(parseShapeSignature("X(a: string, b: int) -> {c: [], d: {e: 1, f: 2}}")).toEqual({
      request: ["a", "b"],
      response: ["c", "d"],
    });
    expect(parseShapeSignature("X() -> {}")).toEqual({ request: [], response: [] });
  });
});

// ── Handlers and fields ───────────────────────────────────────────────────────

describe("e04 handler analysis of synthetic sources", () => {
  const { index, src } = synthetic();
  const hs = analyzeHandlers(index, src);
  const by = (n: string) => hs.find((h) => h.name === n)!;

  it("finds every NetApiHandler subclass, the DOXYGEN-only one flagged", () => {
    expect(hs.map((h) => h.name)).toEqual(["Ask", "Demo", "Lister", "SampleCall"]);
    expect(hs.filter((h) => h.doxygenOnly).map((h) => h.name)).toEqual(["SampleCall"]);
    expect(by("SampleCall").what).toBe("A documented example handler");
  });

  it("resolves inherited RegV fields, RegAll (statics excluded) and UnregV", () => {
    const demo = by("Demo");
    expect(demo.request).toEqual(["DemoReq"]);
    expect(demo.response).toEqual(["DemoResp"]);
    const req = demo.fields.filter((f) => f.dir === "req");
    expect(req.map((f) => [f.name, f.type, f.inherited, f.registered_in])).toEqual([
      ["path", "string", true, "BaseReq"],
      ["count", "int", false, "DemoReq"],
    ]);
    expect(req[1].doc).toBe("how many");
    const resp = demo.fields.filter((f) => f.dir === "resp");
    expect(resp.map((f) => [f.name, f.mechanism, f.type])).toEqual([
      ["status", "RegAll", "string"],
      ["data", "RegAll", "JsonApiStruct"],
    ]);
    expect(resp[1].unregistered_at).toMatch(
      /^pak:scripts\/WorkbenchGameCommon\/Demo\/Handlers\.c#L24$/,
    );
  });

  it("reads top-level OnPack keys through same-class helpers, not nested ones", () => {
    const sc = scanStruct(index, src, "ListResp", "resp");
    expect(sc.fields.map((f) => [f.name, f.type, f.mechanism])).toEqual([
      ["Item List", "array", "OnPack"],
      ["tail", "object", "OnPack"],
    ]);
    expect(by("Lister").requestNote).toMatch(/not overridden/);
  });

  it("classifies the modal call, the file writer and the module driven", () => {
    expect(by("Ask").dialogs.map((d) => d.api)).toEqual(["Workbench.ScriptDialog"]);
    expect(by("Ask").module).toBe("Shared");
    expect(by("Ask").drives).toEqual(["ResourceManager", "WorldEditor"]);
    expect(by("Ask").responseNote).toBe("GetResponse returns null");
    expect(by("Demo").writers.map((w) => w.api)).toEqual(["ResourceManager.RegisterResourceFile"]);
    expect(by("Demo").module).toBe("ResourceManager");
    expect(by("Lister").module).toBe("none");
  });

  it("emits rows with parents, children counts, modal and risk hints; keys with spaces get rows", () => {
    const natives = parseNetApiDocs(DOCS);
    const rows = observationRows(natives, hs, src, new Map([["OpenThing", "exe:0x10"]]));
    const ids = rows.observations.map((o) => o.id);
    expect(ids).toContain("net:native/OpenThing");
    expect(ids).toContain("net:handler/Demo#req:path");
    expect(ids).toContain("net:handler/SampleCall#req:input");
    // A field name with a plain space is a row since the id form escapes it.
    expect(rows.leftOut).toEqual([]);
    expect(ids).toContain("net:handler/Lister#resp:Item%20List");
    const get = (id: string) => rows.observations.find((o) => o.id === id)!.obs;
    // Lister's source shows 2 fields and both have rows, so it claims its children.
    expect(get("net:handler/Lister").children_count).toBe(2);
    expect(get("net:handler/Demo").children_count).toBe(4);
    expect(get("net:handler/Ask").children_count).toBe(1);
    expect(get("net:handler/Demo").risk_hint).toBe("mutating");
    expect(get("net:handler/Ask").modal).toBe("blocks");
    expect(get("net:handler/Ask").risk_hint).toBeUndefined();
    // Candidate paths are the policy default for these kinds: none emitted.
    expect(rows.observations.filter((o) => o.obs.paths_proposed !== undefined)).toEqual([]);
    expect(get("net:native/OpenThing").what).toBeUndefined();
    expect(get("net:handler/Demo#req:path").parent_key).toEqual({
      dim: "net",
      kind: "net-handler",
      module: "ResourceManager",
      key: { handler: "Demo" },
    });
    expect(get("net:native/OpenThing").unverified).toEqual([
      "documented by Bohemia: yes (NetApiDocs.c)",
      "named in the executable: yes (E05 exe:0x10)",
      "answering on this build: not verified live",
    ]);
    expect(get("net:native/RunCode").unverified).toContain(
      "RunCode is documented by Bohemia and absent from the executable",
    );
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it("re-reads response keys at a Python call site, f-strings included", () => {
    const py = [
      "def other():",
      "    result = {}",
      "    return result['nope']",
      "",
      "class Op:",
      "    def execute(self):",
      "        params = {}",
      '        result = workbench.call_function(info, "LocateThing", params)',
      "",
      '        if "ERROR" in result["status"]:',
      "            msg = f\"{result['status']}: {result['message']}\"",
      "            return msg",
      '        code = result.get("ErrorCode", 0)',
      '        paths = result["paths"]',
      "        # result['commented'] is a comment, not a read",
      "        result = {}",
      "        return result['after']",
      "",
      "    def later(self, result):",
      "        return result['elsewhere']",
    ].join("\n");
    expect(pythonResponseReads(py, 8, "result").map((r) => `${r.key}@${r.line}`)).toEqual([
      "status@10",
      "status@11",
      "message@11",
      "ErrorCode@13",
      "paths@14",
    ]);
    const r = rescanBlender(
      [
        { file: "a/op.py", line: 8, net_function: "LocateThing", response_var: "result" },
        { file: "a/op.py", line: 2, net_function: "Other", response_var: null },
        { file: "z.zip!/x.py", line: 1, net_function: "Other", response_var: "r" },
      ],
      [{ name: "LocateThing", request_keys: [], response_keys: ["status", "paths"], sites: [] }],
      (rel) => (rel === "a/op.py" ? py : undefined),
    );
    expect(r.sites_read).toBe(1);
    expect(r.sites_skipped.map((x) => x.why)).toEqual([
      "response not kept in a variable",
      "inside a zip archive",
    ]);
    expect(r.added.get("LocateThing")).toEqual([
      { key: "message", at: "a/op.py#L11" },
      { key: "ErrorCode", at: "a/op.py#L13" },
    ]);
  });

  it("builds the contract table and cross-checks a client's keys against it", () => {
    const table = contractTable(hs, parseNetApiDocs(DOCS));
    expect(table.map((t) => t.name)).toEqual(["Ask", "Demo", "Lister", "OpenThing", "RunCode"]);
    const r = crossCheck(table, [
      {
        name: "Demo",
        request_keys: ["path", "count"],
        response_keys: ["status", "ErrorCode"],
        sites: ["a#L1"],
      },
      { name: "Ask", request_keys: ["msg", "title"], response_keys: [], sites: ["b#L2"] },
    ]);
    const demo = r.entries.find((e) => e.name === "Demo")!;
    expect(demo.consistent).toBe(true);
    expect(demo.exact).toBe(false);
    expect(demo.declared_not_read).toEqual(["data"]);
    expect(demo.protocol_keys_read).toEqual(["ErrorCode"]);
    const ask = r.entries.find((e) => e.name === "Ask")!;
    expect(ask.sent_not_declared).toEqual(["title"]);
    expect(ask.consistent).toBe(false);
    expect(r.not_called).toEqual(["Lister", "OpenThing", "RunCode"]);

    // A key E19 missed, found by the re-read, completes the comparison.
    const r2 = crossCheck(
      table,
      [
        {
          name: "Demo",
          request_keys: ["path", "count"],
          response_keys: ["status"],
          sites: ["a#L1"],
        },
      ],
      new Map([
        [
          "Demo",
          [
            { key: "data", at: "a#L3" },
            { key: "ErrorCode", at: "a#L4" },
          ],
        ],
      ]),
    );
    expect(r2.entries[0].exact).toBe(true);
    expect(r2.entries[0].read).toEqual(["data", "status"]);
    expect(r2.entries[0].protocol_keys_read).toEqual(["ErrorCode"]);
    expect(r2.entries[0].read_added_by_rescan).toEqual([
      { key: "ErrorCode", at: "a#L4" },
      { key: "data", at: "a#L3" },
    ]);
  });
});

// ── CLI, determinism and the ledger ───────────────────────────────────────────

describe("e04 run and the ledger", () => {
  it("writes a deterministic observation file and artifacts, and the ledger accepts it", () => {
    const fx = makeCensus("1.0.0.1");
    writeObservations(fx, "E05", "1.0.0.1", [
      {
        dim: "net",
        kind: "net-function",
        module: "none",
        key: { native: "OpenThing" },
        parent_key: null,
        label: "OpenThing",
        origin: "vanilla",
        ref: "exe:0x10",
        quote: "OpenThing",
        confidence: "medium",
      },
    ]);
    const art = mkdtempSync(join(tmpdir(), "e04-art-"));
    const args = ["--sources", sourcesDir(), "--artifacts", art];
    const r = runIn(fx, runE04, args);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(
      /E04 at build 1\.0\.0\.1: 2 native functions documented \(1 named in the executable\), 4 handler classes \(3 active, 1 DOXYGEN-only\)/,
    );
    const obsFile = join(fx.root, "observations", "E04", "1.0.0.1.jsonl");
    const first = readFileSync(obsFile, "utf-8");
    expect(first).not.toMatch(/[A-Za-z]:[\\/]/);
    const header = JSON.parse(first.split("\n")[0]);
    expect(header.enumerator).toBe("E04");
    expect(header.inputs.every((i: { path: string }) => i.path.startsWith("<"))).toBe(true);
    // The E02 source index the rows depend on is an input.
    expect(header.inputs.map((i: { path: string }) => i.path)).toContain(
      "<sources>/#E02-source-index-built-in-memory",
    );

    const handlersDoc = join(art, "census", "1.0.0.1", "E04", "handlers.json");
    expect(existsSync(handlersDoc)).toBe(true);
    const blender = JSON.parse(
      readFileSync(join(art, "census", "1.0.0.1", "E04", "blender-crosscheck.json"), "utf-8"),
    );
    expect(blender.skipped).toMatch(/E19/);

    // A second run on the same input is byte-identical.
    expect(runIn(fx, runE04, args).code).toBe(0);
    expect(readFileSync(obsFile, "utf-8")).toBe(first);

    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems.filter((p) => p.id?.startsWith("net:"))).toEqual([]);
    const net = built.rows.filter((x) => x.dim === "net");
    expect(
      net.find((x) => x.id === "net:native/OpenThing")?.sources.map((s) => s.enumerator),
    ).toEqual(["E04", "E05"]);
    expect(net.filter((x) => x.kind === "net-handler")).toHaveLength(4);
  });

  it("re-reads the add-on's Python at E19's call sites when <tools>/Blender is present", () => {
    const fx = makeCensus("1.0.0.1");
    const art = mkdtempSync(join(tmpdir(), "e04-art-"));
    const tools = mkdtempSync(join(tmpdir(), "e04-tools-"));
    const rel = "scripts/addons/Demo/op.py";
    mkdirSync(join(tools, "Blender", "scripts", "addons", "Demo"), { recursive: true });
    writeFileSync(
      join(tools, "Blender", ...rel.split("/")),
      [
        "def run():",
        '    result = workbench.call_function(info, "Demo", {"path": "p", "count": 1})',
        "    print(f\"{result['status']}: {result['data']}\")",
      ].join("\n"),
    );
    const e19 = join(art, "census", "1.0.0.1", "E19");
    mkdirSync(e19, { recursive: true });
    writeFileSync(
      join(e19, "net-call-sites.json"),
      JSON.stringify({
        call_sites: [{ file: rel, line: 2, net_function: "Demo", response_var: "result" }],
        net_functions: [
          {
            name: "Demo",
            request_keys: ["count", "path"],
            response_keys: ["status"],
            sites: [`${rel}#L2`],
          },
        ],
      }),
    );
    const r = runIn(fx, runE04, ["--sources", sourcesDir(), "--artifacts", art, "--tools", tools]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(
      readFileSync(join(art, "census", "1.0.0.1", "E04", "blender-crosscheck.json"), "utf-8"),
    );
    expect(doc.rescan.keys_added_to_e19).toEqual([{ name: "Demo", key: "data", at: `${rel}#L3` }]);
    expect(doc.summary.exact).toBe(1);
  });

  it("refuses --artifacts inside a git working tree", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE04, [
      "--sources",
      sourcesDir(),
      "--artifacts",
      join(REPO_ROOT, "tmp-e04-art"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing --artifacts inside a git working tree/);
    expect(existsSync(join(REPO_ROOT, "tmp-e04-art"))).toBe(false);
  });

  it("prints the contract table with --emit-contract", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE04, ["--sources", sourcesDir(), "--emit-contract"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^export const DECLARED: readonly ContractRow\[\] = \[/);
    expect(r.stdout).toMatch(/name: "Demo", kind: "handler", request: \["count", "path"\]/);
    expect(existsSync(join(fx.root, "observations", "E04"))).toBe(false);
  });

  it("is skipped with NO DATA (exit 2) when --sources is absent on disk", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE04, ["--sources", join(tmpdir(), "e04-no-such-dir")]);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/NO DATA/);
  });

  it("refuses an --out outside observations/E04/", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE04, [
      "--sources",
      sourcesDir(),
      "--out",
      join(tmpdir(), "elsewhere.jsonl"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/refusing --out/);
  });
});

// ── The real game source (skipped when the source index or the paks are absent) ─

function realInputs(): {
  index: NonNullable<ReturnType<typeof loadSourceIndex>>;
  vfs: PakVirtualFS;
} | null {
  try {
    const index = loadSourceIndex("1.8.0.13", { dir: artifactsDir() });
    const gamePath = loadConfig().gamePath;
    if (!index || !gamePath || !existsSync(join(gamePath, "addons"))) return null;
    const vfs = PakVirtualFS.get(gamePath);
    return vfs ? { index, vfs } : null;
  } catch {
    return null;
  }
}
const REAL = realInputs();

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || REAL === null)("e04 against the game's script source at build 1.8.0.13", () => {
  const a = analyze(REAL!.index, pakBackend(REAL!.vfs));
  const e05 = e05Natives(censusPaths(REAL_CENSUS), "1.8.0.13");
  const rows = observationRows(a.natives, a.handlers, a.src, e05);

  it("reproduces the headline counts", () => {
    expect(a.natives.map((n) => n.name)).toEqual([
      "OpenResource",
      "BringModuleWindowToFront",
      "IsWorkbenchRunning",
      "IsWorldEditorRunning",
      "ValidateScripts",
      "ReloadScripts",
      "EvaluateScript",
    ]);
    if (e05)
      expect(a.natives.filter((n) => !e05.has(n.name)).map((n) => n.name)).toEqual([
        "EvaluateScript",
      ]);
    expect(a.handlers).toHaveLength(34);
    expect(a.handlers.filter((h) => h.doxygenOnly).map((h) => h.name)).toEqual(["ExampleCall"]);
    const fields = a.handlers.flatMap((h) => h.fields);
    expect(fields.filter((f) => f.dir === "req")).toHaveLength(72);
    expect(fields.filter((f) => f.dir === "resp")).toHaveLength(78);
    expect(a.handlers.filter((h) => h.dialogs.length).map((h) => h.name)).toEqual([
      "BakeInfo",
      "EBTInfo",
    ]);
    expect(a.handlers.filter((h) => h.writers.length).map((h) => h.name)).toEqual([
      "AnimExportTrackExport",
      "ExportFBXResource",
      "ExportMaterialResource",
      "ExportTXAResource",
      "ExportTerrain",
      "ExportTextureResource",
      "OverrideMeshObjectMaterial",
      "RegisterResource",
    ]);
    expect(rows.observations).toHaveLength(191);
    // "Loaded Projects" and "Layer Presets" are rows now; nothing is left out.
    expect(rows.leftOut).toEqual([]);
    const ids = rows.observations.map((o) => o.id);
    expect(ids).toContain("net:handler/GetLoadedProjects#resp:Loaded%20Projects");
    expect(ids).toContain("net:handler/LayerPresets#resp:Layer%20Presets");
    // Every handler claims its children.
    const handlerRows = rows.observations.filter((o) => o.obs.kind === "net-handler");
    expect(handlerRows.filter((o) => o.obs.children_count === undefined)).toEqual([]);
    expect(rows.observations.filter((o) => o.obs.paths_proposed !== undefined)).toHaveLength(0);
    expect(
      rows.observations.filter((o) => o.obs.kind === "net-function" && o.obs.what),
    ).toHaveLength(0);
  });

  it("every handler row's ref line holds its class statement", () => {
    for (const o of rows.observations.filter((x) => x.obs.kind === "net-handler")) {
      const m = /^pak:(.+)#L(\d+)$/.exec(o.obs.ref)!;
      const line = REAL!.vfs.readTextFile(m[1]).split(/\r?\n/)[Number(m[2]) - 1];
      expect(line).toMatch(new RegExp(`^class ${o.obs.key.handler}\\s*:\\s*NetApiHandler`));
    }
  });

  it("is accepted by the ledger in a temporary copy of data/census", () => {
    const fx = makeCensus("1.8.0.13");
    const e05File = join(REAL_CENSUS, "observations", "E05", "1.8.0.13.jsonl");
    if (existsSync(e05File)) {
      mkdirSync(join(fx.root, "observations", "E05"), { recursive: true });
      writeFileSync(join(fx.root, "observations", "E05", "1.8.0.13.jsonl"), readFileSync(e05File));
    }
    const art = mkdtempSync(join(tmpdir(), "e04-real-art-"));
    const r = runIn(fx, runE04, ["--artifacts", art, "--index", artifactsDir()]);
    expect(r.code).toBe(0);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems.filter((p) => p.id?.startsWith("net:"))).toEqual([]);
    expect(built.rows.filter((x) => x.dim === "net")).toHaveLength(191);
  });
});
