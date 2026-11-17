import { describe, it, expect, afterAll } from "vitest";
import { SearchEngine } from "../../src/index/search-engine.js";
import { registerComponentSearch } from "../../src/tools/component-search.js";
import { captureTool, textOf } from "./_tool-harness.js";
import { cls, method, writeFixtureDataDir } from "../index/api-fixture.js";

const PAK_FILE = "scripts/Game/Test/PakThingComponent.c";
const pak = (pakLine: number, guards?: string[]) => ({
  origin: "pak" as const,
  pakFile: PAK_FILE,
  pakLine,
  ...(guards ? { guards } : {}),
});

// A Doxygen component holding pak methods (one guarded), and a pak component
// that names it as its parent while the parent's stored children do not list it.
const fixture = writeFixtureDataDir({
  arma: [
    cls("PakThingComponent", {
      methods: [
        method("void EOnDiag (IEntity owner)", pak(10, ["ENABLE_DIAG"])),
        method("void DoPak ()", pak(20)),
        method("void DoDoxygen ()", { description: "Plain API." }),
      ],
      protectedMethods: [method("protected void Hidden ()", pak(30, ["!WORKBENCH"]))],
    }),
    cls("PakThingChildComponent", { parents: ["PakThingComponent"], ...pak(40) }),
  ],
});
afterAll(() => fixture.cleanup());

const NOTE = "[added from the game's script source; missing from the scraped API index";

describe("component_search", () => {
  const engine = new SearchEngine(fixture.dataDir);
  const tool = captureTool((server) => registerComponentSearch(server, engine));
  const search = async (query: string): Promise<string[]> =>
    textOf(await tool({ query, category: "any", source: "all", limit: 20 })).split("\n");

  it("prints every overload of an event handler; a Doxygen component's lines carry no note", async () => {
    expect(await search("TestThingComponent")).toEqual([
      "Found 1 component:",
      "## TestThingComponent",
      "Source: Arma Reforger API",
      "Category: general",
      "",
      "### Event Handlers (1)",
      "- void EOnInit (IEntity owner)",
      "- void EOnInit ()",
    ]);
  });

  it("every printed pak method carries the api_search provenance note, guards included", async () => {
    const lines = await search("PakThingComponent");
    expect(lines).toContain(
      `- void EOnDiag (IEntity owner) ${NOTE}; only under #ifdef ENABLE_DIAG]`,
    );
    expect(lines).toContain(`- void DoPak () ${NOTE}]`);
    expect(lines).toContain("- void DoDoxygen () -- Plain API.");
    expect(lines).toContain(`- protected void Hidden () ${NOTE}; only under #ifndef WORKBENCH]`);
    expect(lines).toContain("Source: Arma Reforger API");
  });

  it("a pak component says so on its source line", async () => {
    const lines = await search("PakThingChildComponent");
    expect(lines).toContain(`Source: Arma Reforger API ${NOTE}]`);
  });

  it("direct subclasses are the engine's derived children, as api_search lists them", async () => {
    const lines = await search("PakThingComponent");
    expect(engine.getChildren("PakThingComponent")).toEqual(["PakThingChildComponent"]);
    expect(lines).toContain("Direct subclasses: PakThingChildComponent");
  });
});
