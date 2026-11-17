import { describe, it, expect, afterAll } from "vitest";
import { SearchEngine } from "../../src/index/search-engine.js";
import { formatClassTree, provenanceNote, registerApiSearch } from "../../src/tools/api-search.js";
import { captureTool, textOf } from "./_tool-harness.js";
import { writeFixtureDataDir } from "../index/api-fixture.js";

const fixture = writeFixtureDataDir();
afterAll(() => fixture.cleanup());

// True of every pak entry: the backfill added it from the source because the
// scraped index lacked it. Not "absent from Bohemia's docs": most protected
// static methods and the lowercase-named classes have Bohemia pages the
// scraper missed.
const PAK = "[added from the game's script source; missing from the scraped API index]";

describe("api_search: provenance of entries the source backfill added", () => {
  const engine = new SearchEngine(fixture.dataDir);
  const apiSearch = captureTool((server) => registerApiSearch(server, engine));
  const search = async (args: Record<string, unknown>): Promise<string> =>
    textOf(await apiSearch({ type: "any", source: "all", limit: 10, format: "detailed", ...args }));

  it("a Doxygen method prints as before, byte for byte", async () => {
    expect(await search({ query: "SetVariableValueEx", type: "method", limit: 1 })).toBe(
      [
        "Found 1 method match:\n",
        "1. WorldEditorAPI.proto external bool SetVariableValueEx (string key)",
        "   Class: WorldEditorAPI (Enfusion Engine > Workbench)",
        "",
      ].join("\n"),
    );
    expect(
      await search({ query: "SetVariableValue", type: "method", source: "enfusion", limit: 1 }),
    ).toBe(
      [
        "Found 1 method match:\n",
        "1. WorldEditorAPI.proto external bool SetVariableValue (BaseContainer obj, array< ref ContainerIdPathEntry > path, string key, string value)",
        "   Sets a variable.",
        "   Class: WorldEditorAPI (Enfusion Engine > Workbench)",
        "",
      ].join("\n"),
    );
  });

  it("a pak method says it comes from the script source", async () => {
    const text = await search({ query: "TraceWorldPos", type: "method", limit: 1 });
    expect(text.split("\n")[2]).toBe(
      `1. WorldEditorAPI.proto external bool TraceWorldPos(int x, int y, TraceFlags traceFlags, out vector traceStart, out vector traceEnd, out vector traceDir, out IEntity hitEntity) ${PAK}`,
    );
  });

  it("a guarded pak method states the condition it exists under", async () => {
    const text = await search({ query: "GetDebugCounter", type: "method", limit: 1 });
    expect(text.split("\n")[2]).toBe(
      "1. WorldEditorAPI.proto external int GetDebugCounter() [added from the game's script source; missing from the scraped API index; only under #ifdef ENABLE_DIAG and #ifndef WORKBENCH]",
    );
    const any = await search({ query: "GetDebugCounter", limit: 1 });
    expect(any.split("\n")[0]).toBe(
      "**Method:** WorldEditorAPI.proto external int GetDebugCounter() [added from the game's script source; missing from the scraped API index; only under #ifdef ENABLE_DIAG and #ifndef WORKBENCH]",
    );
  });

  it("a pak class says so on its source line; its methods carry their note, Doxygen ones none", async () => {
    const text = await search({ query: "PakChild", type: "class", limit: 1 });
    const lines = text.split("\n");
    expect(lines[0]).toBe("## PakChild");
    expect(lines[1]).toBe(
      "Source: Arma Reforger API [added from the game's script source; missing from the scraped API index; only under #ifdef MODULE_AUTOTEST]",
    );
    expect(lines).toContain(`- void Run() ${PAK}`);
    expect(lines).toContain("Direct subclasses: Grand");

    const doxygen = (await search({ query: "WorldEditorAPI", type: "class", limit: 1 })).split(
      "\n",
    );
    expect(doxygen[1]).toBe("Source: Enfusion Engine API");
    expect(doxygen).toContain("- proto external bool SetVariableValueEx (string key)");
    expect(doxygen).toContain(
      "- proto external bool SetVariableValue (BaseContainer obj, array< ref ContainerIdPathEntry > path, string key, string value) -- Sets a variable.",
    );
  });

  it("a Doxygen parent's tree and subclass line list the pak class that names it", async () => {
    const tree = formatClassTree(engine.getClass("Base")!, engine);
    expect(tree).toContain("├── Child2");
    expect(tree).toContain("└── PakChild");
    const text = await search({ query: "Base", type: "class", limit: 1 });
    expect(text).toContain("Direct subclasses: Child2, PakChild");
  });

  it("provenanceNote reads each guard form as the source writes it", () => {
    expect(provenanceNote({})).toBe("");
    expect(provenanceNote({ origin: "pak", guards: [] })).toBe(` ${PAK}`);
    expect(provenanceNote({ origin: "pak", guards: ["!DISABLE_X", "if VERSION > 2"] })).toBe(
      " [added from the game's script source; missing from the scraped API index; only under #ifndef DISABLE_X and #if VERSION > 2]",
    );
  });

  it("no output claims a pak entry is absent from Bohemia's docs", async () => {
    const texts = [
      await search({ query: "TraceWorldPos", type: "method" }),
      await search({ query: "GetDebugCounter" }),
      await search({ query: "PakChild", type: "class", limit: 1 }),
      await search({ query: "PakChild", type: "class", format: "tree", limit: 1 }),
      await search({ query: "Grand", type: "class", limit: 1 }),
    ];
    for (const text of texts) {
      expect(text).toContain("added from the game's script source");
      expect(text).not.toMatch(/Bohemia/);
    }
  });
});
