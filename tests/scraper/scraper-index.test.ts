import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLASS_PAGE_PATTERN, isClassPageFile, scrape } from "../../src/scraper/index.js";
import type { ClassInfo } from "../../src/index/types.js";

describe("class page file names", () => {
  it("takes the lowercase-named class pages Doxygen writes, and still skips the -members lists", () => {
    for (const f of [
      "interfaceSCR__BaseGameMode.html",
      "interfacestring.html",
      "interfaceglobal__pointer.html",
      "interfacehandle64.html",
      "interfacearray-1-g.html",
    ]) {
      expect(isClassPageFile(f), f).toBe(true);
    }
    for (const f of [
      "interfaceSCR__BaseGameMode-members.html",
      "interfacestring-members.html",
      "interfacearray-1-g-members.html",
      "interfacestring.js",
      "interfacestring.png",
      "group__Entities.html",
      "Page_Intro.html",
      "annotated.html",
    ]) {
      expect(isClassPageFile(f), f).toBe(false);
    }
    expect(CLASS_PAGE_PATTERN.test("interfacestring.html")).toBe(true);
  });
});

// A Workbench install with one unpacked docs folder of synthetic pages in
// Doxygen's shape: a capitalised class, a lowercase-named class, and the
// -members list of each.
const page = (title: string, method: string): string => `<html><body>
<div class="headertitle"><div class="title">${title}</div></div>
<div class="contents">
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pub-methods" name="pub-methods"></a>Public Member Functions</h2></td></tr>
<tr class="memitem:a1" id="r_a1"><td class="memItemLeft">int&#160;</td><td class="memItemRight"><a class="el" href="#a1">${method}</a> ()</td></tr>
</table>
</div></body></html>`;

const root = mkdtempSync(join(tmpdir(), "scrape-pages-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scrape (local docs folder)", () => {
  it("parses lowercase-named class pages and no -members page", async () => {
    const wb = join(root, "tools");
    const html = join(wb, "Workbench", "docs", "EnfusionScriptAPI", "html");
    mkdirSync(html, { recursive: true });
    writeFileSync(join(html, "annotated.html"), "<html><body></body></html>");
    writeFileSync(
      join(html, "interfaceFooThing.html"),
      page("FooThing Interface Reference", "Get"),
    );
    writeFileSync(
      join(html, "interfaceFooThing-members.html"),
      page("FooThing Member List", "Get"),
    );
    writeFileSync(join(html, "interfacestring.html"), page("string Interface Reference", "Length"));
    writeFileSync(join(html, "interfacestring-members.html"), page("string Member List", "Length"));

    const dataDir = join(root, "data");
    await scrape({ source: "local", workbenchPath: wb, dataDir, backfill: false });

    const classes = JSON.parse(
      readFileSync(join(dataDir, "api", "enfusion-classes.json"), "utf-8"),
    ) as ClassInfo[];
    expect(classes.map((c) => c.name).sort()).toEqual(["FooThing", "string"]);
    expect(classes.find((c) => c.name === "string")?.methods.map((m) => m.name)).toEqual([
      "Length",
    ]);
  });
});
