import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHierarchyPage, parseClassPage } from "../../src/scraper/doxygen-parser.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("parseHierarchyPage", () => {
  const html = readFileSync(resolve(fixturesDir, "sample-hierarchy.html"), "utf-8");
  const nodes = parseHierarchyPage(html);
  const nodeMap = new Map(nodes.map((n) => [n.name, n]));

  it("parses nodes from the table-based Doxygen 1.13 format", () => {
    expect(nodes.length).toBeGreaterThan(100);
  });

  it("correctly identifies root nodes (no parent in the tree)", () => {
    // ActionManager is a root entry in the hierarchy (row_0_)
    expect(nodeMap.has("ActionManager")).toBe(true);
    // AlignableSlot is another root (row_1_)
    expect(nodeMap.has("AlignableSlot")).toBe(true);
  });

  it("correctly identifies parent-child relationships", () => {
    // ActionManager → InputManager
    const am = nodeMap.get("ActionManager");
    expect(am).toBeDefined();
    expect(am!.children).toContain("InputManager");

    // AlignableSlot → ButtonSlot, GridSlot, LayoutSlot, etc.
    const as_ = nodeMap.get("AlignableSlot");
    expect(as_).toBeDefined();
    expect(as_!.children).toContain("ButtonSlot");
    expect(as_!.children).toContain("GridSlot");
    expect(as_!.children).toContain("LayoutSlot");
  });

  it("correctly identifies multi-level nesting", () => {
    // AlignableSlot → LayoutSlot → HorizontalLayoutSlot
    const ls = nodeMap.get("LayoutSlot");
    expect(ls).toBeDefined();
    expect(ls!.children).toContain("HorizontalLayoutSlot");
    expect(ls!.children).toContain("VerticalLayoutSlot");
  });

  it("ScriptComponent is a child of GenericComponent", () => {
    const gc = nodeMap.get("GenericComponent");
    expect(gc).toBeDefined();
    expect(gc!.children).toContain("ScriptComponent");
  });

  it("GenericEntity is a child of IEntity", () => {
    const ie = nodeMap.get("IEntity");
    expect(ie).toBeDefined();
    expect(ie!.children).toContain("GenericEntity");
  });

  it("does not produce circular relationships", () => {
    for (const node of nodes) {
      for (const childName of node.children) {
        const child = nodeMap.get(childName);
        if (child) {
          expect(child.children).not.toContain(node.name);
        }
      }
    }
  });
});

describe("parseClassPage member names (the row's own link, not every link in the cell)", () => {
  // Member rows in the shape Doxygen writes them: the member's own link points
  // at the row's anchor; parameter types and constants in default values are
  // links too. The detailed docs follow their heading directly, the shape
  // enrichMethodDescriptions reads (Doxygen's own pages nest div.memdoc in a
  // div.memitem, which it does not read).
  const html = `<html><body>
<div class="headertitle"><div class="title">WorldEditorAPI Interface Reference</div></div>
<div class="contents">
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pub-methods" name="pub-methods"></a>Public Member Functions</h2></td></tr>
<tr class="memitem:a1" id="r_a1"><td class="memItemLeft" align="right" valign="top">proto external bool&#160;</td><td class="memItemRight" valign="bottom"><a class="el" href="#a1">SetVariableValue</a> (<a class="el" href="interfaceBaseContainer.html">BaseContainer</a> obj, array&lt; ref <a class="el" href="interfaceContainerIdPathEntry.html">ContainerIdPathEntry</a> &gt; path, <a class="el" href="interfacestring.html">string</a> key, <a class="el" href="interfacestring.html">string</a> value)</td></tr>
<tr class="memdesc:a1"><td class="mdescLeft">&#160;</td><td class="mdescRight">Sets a variable.</td></tr>
<tr class="memitem:a2" id="r_a2"><td class="memItemLeft" align="right" valign="top">proto external bool&#160;</td><td class="memItemRight" valign="bottom"><a class="el" href="#a2">BeginEntityAction</a> (<a class="el" href="interfacestring.html">string</a> historyPointName=<a class="el" href="interfacestring.html#a9">string.Empty</a>)</td></tr>
<tr class="memitem:a3" id="r_a3"><td class="memItemLeft" align="right" valign="top">void&#160;</td><td class="memItemRight" valign="bottom"><a class="el" href="interfaceWorldEditorAPI.html#a3">SetDebug</a> (int level)</td></tr>
<tr class="memitem:a4" id="r_a4"><td class="memItemLeft" align="right" valign="top">void&#160;</td><td class="memItemRight" valign="bottom"><a class="el" href="#a4">SetDebug</a> (<a class="el" href="interfacebool.html">bool</a> enable)</td></tr>
<tr class="memitem:a5" id="r_a5"><td class="memItemLeft" align="right" valign="top">&#160;</td><td class="memItemRight" valign="bottom"><a class="el" href="#a5">~WorldEditorAPI</a> ()</td></tr>
</table>
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pub-attribs" name="pub-attribs"></a>Public Attributes</h2></td></tr>
<tr class="memitem:a6" id="r_a6"><td class="memItemLeft" align="right" valign="top">float&#160;</td><td class="memItemRight" valign="bottom"><a class="el" href="#a6">m_fAnimationRate</a> = <a class="el" href="interfaceUIConstants.html#a7">UIConstants.FADE_RATE_FAST</a></td></tr>
<tr class="memitem:a8" id="r_a8"><td class="memItemLeft" align="right" valign="top">int&#160;</td><td class="memItemRight" valign="bottom">m_iPlain = 3</td></tr>
</table>
<a id="a3" name="a3"></a>
<h2 class="memtitle"><span class="permalink"><a href="#a3">&#9670;&#160;</a></span>SetDebug() <span class="overload">[1/2]</span></h2>
<div class="memdoc"><p>Sets the debug level of the editor API, from zero (off) upwards.</p></div>
<a id="a4" name="a4"></a>
<h2 class="memtitle"><span class="permalink"><a href="#a4">&#9670;&#160;</a></span>SetDebug() <span class="overload">[2/2]</span></h2>
<div class="memdoc"><p>Turns the debug output of the editor API on or off.</p></div>
</div></body></html>`;
  const cls = parseClassPage(html, "enfusion", "interfaceWorldEditorAPI.html");

  it("a method whose parameter types are linked keeps only its own name", () => {
    expect(cls.methods[0].name).toBe("SetVariableValue");
    expect(cls.methods[0].params.map((p) => p.name)).toEqual(["obj", "path", "key", "value"]);
    expect(cls.methods[0].description).toBe("Sets a variable.");
  });

  it("a linked constant in a default value is not glued on", () => {
    expect(cls.methods[1].name).toBe("BeginEntityAction");
    expect(cls.methods[1].signature).toBe(
      "proto external bool BeginEntityAction (string historyPointName=string.Empty)",
    );
    expect(cls.methods[1].params).toEqual([
      { name: "historyPointName", type: "string", defaultValue: "string.Empty" },
    ]);
  });

  it("overloads share their name and each gets its own detailed docs; a destructor keeps its tilde", () => {
    expect(cls.methods.map((m) => m.name)).toEqual([
      "SetVariableValue",
      "BeginEntityAction",
      "SetDebug",
      "SetDebug",
      "~WorldEditorAPI",
    ]);
    expect(cls.methods[2].description).toContain("debug level");
    expect(cls.methods[3].description).toContain("on or off");
  });

  it("every name is the identifier its own signature declares", () => {
    for (const m of cls.methods) {
      const before = m.signature.slice(0, m.signature.indexOf("("));
      expect(before.trimEnd().endsWith(m.name)).toBe(true);
    }
  });

  it("a property keeps its own name, not the linked constant of its default", () => {
    expect(cls.properties.map((p) => p.name)).toEqual(["m_fAnimationRate", "m_iPlain"]);
  });
});

describe("parseClassPage member groups (sections titled by the group, not by protection)", () => {
  // Synthetic markup in the shape of Doxygen's member-group tables: each group
  // is a table of its own headed by `a#member-group` and the group's title; the
  // summary does not state protection, the detailed docs' labels do. An inline
  // group header row inside a named section (`tr.groupHeader`) is not a section.
  const labelled = (hash: string, name: string, labels: string[]): string => `
<a id="${hash}" name="${hash}"></a>
<h2 class="memtitle"><span class="permalink"><a href="#${hash}">&#9670;&#160;</a></span>${name}()</h2>
<div class="memitem"><div class="memproto"><table class="mlabels"><tr><td class="mlabels-left"><table class="memname"><tr><td class="memname">${name}</td></tr></table></td><td class="mlabels-right"><span class="mlabels">${labels.map((l) => `<span class="mlabel ${l}">${l}</span>`).join("")}</span></td></tr></table></div><div class="memdoc"><p>Docs of ${name}.</p></div></div>`;
  const html = `<html><body>
<div class="headertitle"><div class="title">EntityFilter Interface Reference</div></div>
<div class="contents">
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pub-methods" name="pub-methods"></a>Public Member Functions</h2></td></tr>
<tr class="memitem:b1" id="r_b1"><td class="memItemLeft">int&#160;</td><td class="memItemRight"><a class="el" href="#b1">GetCount</a> ()</td></tr>
<tr id="pub-methods-0" class="groupHeader"><td colspan="2"><div class="groupHeader">Array Functions</div></td></tr>
<tr><td colspan="2" class="ititle"><div class="groupText"><p>Functions on the array.</p></div></td></tr>
<tr class="memitem:b2" id="r_b2"><td class="memItemLeft">bool&#160;</td><td class="memItemRight"><a class="el" href="#b2">Add</a> (<a class="el" href="interfaceThing.html">Thing</a> thing)</td></tr>
</table>
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 id="header-member-group" class="groupheader"><a id="member-group" name="member-group"></a>
Override Functions</h2></td></tr>
<tr><td class="ititle" colspan="2"><p>Functions to be overridden by child classes.</p></td></tr>
<tr class="memitem:c1" id="r_c1"><td class="memItemLeft">bool&#160;</td><td class="memItemRight"><a class="el" href="#c1">CanAdd</a> (<a class="el" href="interfaceThing.html">Thing</a> thing)</td></tr>
<tr class="memdesc:c1"><td class="mdescLeft">&#160;</td><td class="mdescRight">Check the condition.  <br /></td></tr>
<tr class="memitem:c2" id="r_c2"><td class="memItemLeft">void&#160;</td><td class="memItemRight"><a class="el" href="#c2">EOnEditorActivate</a> ()</td></tr>
<tr class="memitem:c3" id="r_c3"><td class="memItemLeft">static int&#160;</td><td class="memItemRight"><a class="el" href="#c3">CountAll</a> ()</td></tr>
<tr class="memitem:c4" id="r_c4"><td class="memItemLeft">void&#160;</td><td class="memItemRight"><a class="el" href="#c4">Secret</a> ()</td></tr>
<tr class="memitem:c5" id="r_c5"><td class="memItemLeft">int&#160;</td><td class="memItemRight"><a class="el" href="#c5">m_iLimit</a> = 3</td></tr>
<tr class="memitem:c6" id="r_c6"><td class="memItemLeft">float&#160;</td><td class="memItemRight"><a class="el" href="#c6">m_fRate</a></td></tr>
</table>
<table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 id="header-member-group" class="groupheader"><a id="member-group" name="member-group"></a>
Second Group</h2></td></tr>
<tr class="memitem:d1" id="r_d1"><td class="memItemLeft">void&#160;</td><td class="memItemRight"><a class="el" href="#d1">OnSecond</a> (int a, int b=0)</td></tr>
</table>
<a name="details" id="details"></a><h2 class="groupheader">Detailed Description</h2>
<div class="textblock"><p>A filter.</p></div>
${labelled("c1", "CanAdd", [])}
${labelled("c2", "EOnEditorActivate", ["protected"])}
${labelled("c3", "CountAll", ["static"])}
${labelled("c4", "Secret", ["private"])}
${labelled("c6", "m_fRate", ["protected"])}
</div></body></html>`;
  const cls = parseClassPage(html, "arma", "interfaceEntityFilter.html");

  it("reads every member group, after the named sections' members", () => {
    expect(cls.methods.map((m) => m.name)).toEqual(["GetCount", "Add", "CanAdd", "OnSecond"]);
  });

  it("sorts a group's members by the protection and static-ness their detailed docs state", () => {
    expect(cls.protectedMethods.map((m) => m.name)).toEqual(["EOnEditorActivate"]);
    expect(cls.staticMethods.map((m) => m.name)).toEqual(["CountAll"]);
    expect(cls.properties.map((p) => p.name)).toEqual(["m_iLimit"]);
    expect(cls.protectedProperties.map((p) => p.name)).toEqual(["m_fRate"]);
    const all = [...cls.methods, ...cls.protectedMethods, ...cls.staticMethods];
    expect(all.map((m) => m.name)).not.toContain("Secret");
  });

  it("a group's method row reads as a named section's does", () => {
    const canAdd = cls.methods.find((m) => m.name === "CanAdd");
    expect(canAdd).toEqual({
      name: "CanAdd",
      returnType: "bool",
      signature: "bool CanAdd (Thing thing)",
      params: [{ name: "thing", type: "Thing", defaultValue: "" }],
      description: "Check the condition.",
    });
    expect(cls.methods.find((m) => m.name === "OnSecond")?.params).toEqual([
      { name: "a", type: "int", defaultValue: "" },
      { name: "b", type: "int", defaultValue: "0" },
    ]);
    expect(cls.staticMethods[0].returnType).toBe("static int");
  });
});

describe("parseClassPage inheritance (map-area heuristic)", () => {
  const html = readFileSync(resolve(fixturesDir, "sample-class.html"), "utf-8");
  const cls = parseClassPage(html, "enfusion", "interfaceIEntity.html");

  it("parses the class name", () => {
    expect(cls.name).toBe("IEntity");
  });

  it("identifies Managed as a parent (above subject in diagram)", () => {
    expect(cls.parents).toContain("Managed");
  });

  it("identifies GenericEntity as a direct child", () => {
    expect(cls.children).toContain("GenericEntity");
  });

  it("does not include grandchildren (indented x) in children", () => {
    // AutotestGrid etc. are at x=179 (indented) — should be excluded
    expect(cls.children).not.toContain("AutotestGrid");
    expect(cls.children).not.toContain("CinematicEntity");
  });

  it("does not classify children as parents", () => {
    // GenericEntity should NOT appear in parents
    expect(cls.parents).not.toContain("GenericEntity");
    // No grandchildren in parents either
    expect(cls.parents).not.toContain("AutotestGrid");
  });
});
