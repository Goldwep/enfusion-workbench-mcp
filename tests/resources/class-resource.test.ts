import { describe, it, expect, afterAll } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SearchEngine } from "../../src/index/search-engine.js";
import { registerClassResource } from "../../src/resources/class-resource.js";
import { writeFixtureDataDir } from "../index/api-fixture.js";

const fixture = writeFixtureDataDir();
afterAll(() => fixture.cleanup());

type ResourceHandler = (
  uri: URL,
  vars: { className: string },
) => Promise<{ contents: { text: string }[] }>;

function captureResource(engine: SearchEngine): ResourceHandler {
  let handler: ResourceHandler | undefined;
  const fake = {
    registerResource: (_n: string, _t: unknown, _m: unknown, h: ResourceHandler) => {
      handler = h;
    },
  } as unknown as McpServer;
  registerClassResource(fake, engine);
  if (!handler) throw new Error("registerClassResource did not call registerResource");
  return handler;
}

describe("class resource: provenance reaches the reader", () => {
  const engine = new SearchEngine(fixture.dataDir);
  const read = async (name: string): Promise<Record<string, unknown>> => {
    const r = await captureResource(engine)(new URL(`enfusion://class/${name}`), {
      className: name,
    });
    return JSON.parse(r.contents[0].text) as Record<string, unknown>;
  };

  it("a pak class carries origin, pakFile, pakLine and guards; its methods pass through whole", async () => {
    const c = await read("PakChild");
    expect(c).toMatchObject({
      name: "PakChild",
      origin: "pak",
      pakFile: "scripts/Game/Test/PakChild.c",
      pakLine: 3,
      guards: ["MODULE_AUTOTEST"],
      children: ["Grand"],
    });
    expect((c.methods as Record<string, unknown>[])[0]).toMatchObject({
      name: "Run",
      origin: "pak",
      pakFile: "scripts/Game/Test/PakChild.c",
      pakLine: 5,
    });
  });

  it("a Doxygen class has no provenance fields; its children include the pak class naming it", async () => {
    const c = await read("Base");
    expect("origin" in c).toBe(false);
    expect("pakFile" in c).toBe(false);
    expect(c.children).toEqual(["Child2", "PakChild"]);
    expect(c.descendants).toEqual(["Child2", "PakChild", "Grand"]);
    const wea = await read("WorldEditorAPI");
    const guarded = (wea.methods as Record<string, unknown>[]).find(
      (m) => m.name === "GetDebugCounter",
    );
    expect(guarded?.guards).toEqual(["ENABLE_DIAG", "!WORKBENCH"]);
  });
});
