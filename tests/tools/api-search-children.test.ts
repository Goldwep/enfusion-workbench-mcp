import { describe, it, expect, afterAll } from "vitest";
import { SearchEngine } from "../../src/index/search-engine.js";
import { formatClassTree, registerApiSearch } from "../../src/tools/api-search.js";
import { captureTool, textOf } from "./_tool-harness.js";
import { cls, method, writeFixtureDataDir } from "../index/api-fixture.js";

// A templated class stored under its raw page title, named by its parent's
// stored children in its template form (the shape of SCR_ScenarioFrameworkParam
// and SCR_ScenarioFrameworkParamBase in the index).
const fixture = writeFixtureDataDir({
  arma: [
    cls("ParamBase", { children: ["Param< Class T >"] }),
    cls("Param< Class T > Interface Template Reference", {
      parents: ["ParamBase"],
      methods: [method("void Set (T value)")],
    }),
  ],
});
afterAll(() => fixture.cleanup());

describe("api_search: a class named by its page title is listed once, by its normalised name", () => {
  const engine = new SearchEngine(fixture.dataDir);
  const apiSearch = captureTool((server) => registerApiSearch(server, engine));

  it("the subclass line names it once", async () => {
    const text = textOf(
      await apiSearch({
        query: "ParamBase",
        type: "class",
        source: "all",
        limit: 1,
        format: "detailed",
      }),
    );
    expect(text.split("\n")).toContain("Direct subclasses: Param");
    expect(text).not.toContain("Template Reference");
    expect(text).not.toContain("Param<");
  });

  it("the tree shows one child node, resolved (with its counts), under the normalised name", () => {
    const tree = formatClassTree(engine.getClass("ParamBase")!, engine);
    const childLines = tree.split("\n").filter((l) => l.includes("── "));
    expect(childLines).toEqual(["└── Param (1m, 0p)"]);
  });
});
