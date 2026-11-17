import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { deriveId } from "../../src/census/ids.js";
import { loadConfig } from "../../src/config.js";
import {
  GENERATOR,
  WIKI_PAGE_TITLE,
  blankDoxygenBlocks,
  cleanWikitext,
  countExcludedRegistrations,
  countStaticMethods,
  directoryScriptSource,
  enumerateDiag,
  extractWikiPage,
  maskStrings,
  observationFileText,
  parseWikiPage,
  run as runE14,
  scanScriptRegistrations,
  stripComments,
  stripGalleries,
  type E14Result,
} from "../../scripts/census/enumerators/e14-diag-menu.js";
import { REPO_ROOT, makeCensus, runIn, type Fixture } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic inputs ──────────────────────────────────────────────────────────

const span = (title: string, text: string): string => `<span title="${title}">${text}</span>`;
const ARROW = "&nbsp;&rarr;&nbsp;";

/** A small Diag Menu page in the shape of the real one (tool-generated headings with hover spans). */
const WIKITEXT = [
  "= General Use =",
  "<!--",
  "\t- this page is tool-generated",
  "-->",
  "The Diag Menu is a menu.",
  "",
  "== Hotkeys List ==",
  '{| class="wikitable"',
  "| {{Link|#Teleport}} || {{Controls|LCtrl|LAlt|F2}}",
  "|}",
  "",
  "== Modding ==",
  "<enforce>",
  "// a code sample that must not be read as headings",
  "= not a heading =",
  "</enforce>",
  "",
  `= ${span("Cheats", "Cheats")} =`,
  "",
  `== ${span("Cheats", "Teleport")} ==`,
  "",
  "<!-- ID: GAME_DIAG_CHEATS_TELEPORT -->",
  "Teleport player.",
  "[[File:teleport.jpg|600x600px]]",
  "",
  "'''Hotkey''': {{Controls|LCtrl|LAlt|F2}}",
  "",
  "'''Available Options''': false, true",
  "",
  `== ${span("Cheats", "DTime multiplier value")} ==`,
  "",
  "<!-- ID: GAME_DIAG_CHEATS_TIME_DILATATION_VALUE -->",
  "Set delta time multiplier value. See [[Some Page|the page]] and '''bold''' text.",
  "",
  "'''Range Settings''':",
  "",
  "Min: 0.01",
  "",
  "Max: 20",
  "",
  "Current Value: 1.0",
  "",
  "Step: 0.01",
  "",
  `== ${span("Cheats", "Mode")} ==`,
  "",
  "<!-- ID: GAME_DIAG_CHEATS_MODE -->",
  "Pick a mode",
  "* off - nothing",
  "* all - everything",
  "",
  "'''Available Options''': off, all",
  "",
  `= ${span("AI", "AI")} =`,
  "",
  `== ${span("AI", "AIScript")} ==`,
  "",
  `=== ${span(`AI${ARROW}AIScript`, "Set BT Breakpoint")} ===`,
  "",
  "<!-- ID: SCR_DebugMenuID.DEBUGUI_AI_SET_BT_BREAKPOINT -->",
  "Enable/disable BT breakpoint.",
  "",
  "'''Available Options''': false, true",
  "",
  `=== ${span(`AI${ARROW}AIScript`, "Print debug")} ===`,
  "",
  "<!-- ID: SCR_DebugMenuID.DEBUGUI_AI_PRINT_DEBUG -->",
  "Print debug messages.",
  "",
  "'''Available Options''': false, true",
  "",
  `= ${span("Render", "Render")} =`,
  "",
  `== ${span("Render", "PP effects")} ==`,
  "",
  `=== ${span(`Render${ARROW}PP effects`, "Debug")} ===`,
  "",
  "<!-- ID: DM_REND_PP_HBAO_DEBUG -->",
  "HBAO debug.",
  "",
  "'''Available Options''': disabled, enabled",
  "",
  `=== ${span(`Render${ARROW}PP effects`, "Debug")} ===`,
  "",
  "<!-- ID: DM_REND_PP_HDR_DEBUG -->",
  "HDR debug.",
  "",
  "'''Available Options''': none, mask",
  "",
  `=== ${span(`Render${ARROW}PP effects`, "Show GBuffer")} ===`,
  "",
  "<!-- ID: DM_REND_SHOWGBUFFER -->",
  "Show G-Buffer channels.",
  "",
  "'''Available Options''': none, normals",
  "",
  `=== ${span(`Render${ARROW}PP effects`, "Show GBuffer")} ===`,
  "",
  "<!-- ID: DM_REND_SHOWGBUFFER -->",
  "Show G-Buffer channels (second listing).",
  "",
  "'''Available Options''': none, normals, albedo",
  "",
  `=== ${span(`Render${ARROW}PP effects`, "Set state (SP &amp; MP)")} ===`,
  "",
  "<!-- ID: DM_REND_STATE -->",
  "Set the state.",
  "",
  "'''Available Options''':",
  "",
  `== ${span("Render", "CAS")} ==`,
  "",
  `=== ${span(`Render${ARROW}CAS`, "enabled")} ===`,
  "",
  "<!-- ID: DM_REND_CAS_ENABLEDEnable/disable CAS. -->",
  "",
  "'''Available Options''': false, true",
  "",
  `== ${span("Render", "Lens")} ==`,
  "",
  `=== ${span("Wrong title", "Force flare")} ===`,
  "",
  "<!-- ID: DM_REND_LENS_FORCE -->",
  "Set force flare.",
  "Options: -1 100 -1 1",
  "",
  `= ${span("GameCode", "GameCode")} =`,
  "",
  `== ${span("GameCode", "Groups")} ==`,
  "",
  `=== ${span(`GameCode${ARROW}Groups`, "Log groups")} ===`,
  "",
  "<!-- ID: SCR_DebugMenuID.DEBUGUI_GROUP_LOG -->",
  "Log groups.",
  "",
  "'''Available Options''': false, true",
  "",
  "{{Sticky|bottom}}",
  "",
].join("\n");

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A MediaWiki export holding the synthetic page (plus a decoy page) with CR LF line ends, as in the real file. */
function exportXml(text: string = WIKITEXT, title: string = WIKI_PAGE_TITLE): string {
  const body = xmlEscape(text).replace(/\n/g, "\r\n");
  return [
    '<mediawiki xmlns="http://www.mediawiki.org/xmlns/">',
    "  <page>",
    "    <title>Arma Reforger:Other Page</title>",
    '    <revision><text bytes="5" xml:space="preserve">other</text></revision>',
    "  </page>",
    "  <page>",
    `    <title>${xmlEscape(title)}</title>`,
    "    <revision>",
    `      <text bytes="${Buffer.byteLength(text)}" xml:space="preserve">${body}</text>`,
    "    </revision>",
    "  </page>",
    "</mediawiki>",
    "",
  ].join("\r\n");
}

const DIAGMENU_C = `/* generated */
sealed class DiagMenu
{
	private void DiagMenu();
	private void ~DiagMenu();
	//! a static helper mentioned in a comment: static proto void Fake();
	static proto void RegisterMenu(int id, string name, string parent);
	static proto void RegisterBool(int id, string shortcut, string name, string parent, bool reverse = false);
	static proto bool GetBool(int id, bool reverse = false);
	proto void NotStatic();
	static const int LIMIT = 3;
}
`;

const DBGUI_C = `sealed class DbgUI
{
	static proto void Text(string label);
	static proto bool Button(string txt, int minWidth = 0);
	//! Draws a static text label.
	static proto void End();
}
`;

const SAMPLE_C = `class SampleDiag
{
	void Init()
	{
		const string aiMenu = "AIScript";
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_AI_SCRIPT, "AIScript", "AI");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_AI_SET_BT_BREAKPOINT, "", "Set BT Breakpoint", aiMenu);
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_AI_PRINT_DEBUG, "", "Print debug from BTs", "AIScript");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_AI_NEW, "", "Show new thing", "AIScript");
		DiagMenu.RegisterRange(SCR_DebugMenuID.DEBUGUI_AI_RANGE, "", "Aim range", "AIScript", "0, 10, 5, 0.5");
		DiagMenu.RegisterItem(SCR_DebugMenuID.DEBUGUI_TOOL_ITEM, "lctrl+lalt+q", "Pick mode", "Tools", "a,b,c");
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_EXTRA, "Extra", "Render");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_EXTRA_A, "", "Extra A", "Extra");
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_GROUPS, "Game Groups", "GameCode");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_GROUP_LOG, "", "Log groups", "Game Groups");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_CHEAT_TELEPORT_SCRIPT, "lctrl+lalt+f2", "Teleport", "Cheats");
		// DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_COMMENTED, "", "Commented out", "AI");
		/* DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_BLOCK, "", "Block commented", "AI"); */
		string note = "// DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_IN_STRING, \\"\\", \\"In string\\", \\"AI\\")";
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_DYNAMIC, "", someName, "AI");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_MULTI
			, ""
			, "Multi line"
			, "AI");
	}

	private void Reg(SCR_DebugMenuID id, string name)
	{
		DiagMenu.RegisterBool(id, "", name, "WrapMenu");
	}

	void Init2()
	{
		Reg(SCR_DebugMenuID.DEBUGUI_WRAP_ONE, "Wrapped one");
		Reg(SCR_DebugMenuID.DEBUGUI_WRAP_TWO, "Wrapped two");
	}
}

#ifdef DOXYGEN
bool Doc()
{
	DiagMenu.RegisterBool(DiagMenus.MY_DOC, "", "Doc only", "Systems");
	return true;
}
#endif
`;

function writeScripts(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "e14-scripts-"));
  for (const [rel, text] of Object.entries(files)) {
    const f = join(root, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  return root;
}

function standardScripts(): string {
  return writeScripts({
    "scripts/Core/generated/Debug/DiagMenu.c": DIAGMENU_C,
    "scripts/Core/generated/Debug/DbgUI.c": DBGUI_C,
    "scripts/Game/Sample.c": SAMPLE_C,
    "scripts/Game/Unrelated.c": "class Unrelated {}\n",
  });
}

function build(wikitext: string = WIKITEXT): E14Result {
  const root = standardScripts();
  const result = enumerateDiag(
    exportXml(wikitext),
    "<repo>/data/wiki/export.xml",
    directoryScriptSource(root),
  );
  if (!result) throw new Error("page not found");
  return result;
}

const pathOf = (o: { key: { path?: string[] } }): string => (o.key.path ?? []).join(" > ");

function rowsBy(result: E14Result): Map<string, E14Result["observations"][number]> {
  return new Map(result.observations.map((o) => [pathOf(o), o]));
}

// ── Unit helpers ──────────────────────────────────────────────────────────────

describe("e14 wiki extraction and parsing", () => {
  it("pulls the page out of the export, folds CR LF and reports the byte size", () => {
    const page = extractWikiPage(exportXml(), WIKI_PAGE_TITLE);
    expect(page).not.toBeNull();
    expect(page?.text.includes("\r")).toBe(false);
    expect(page?.text.startsWith("= General Use =\n")).toBe(true);
    expect(page?.bytes).toBe(Buffer.byteLength(WIKITEXT));
    expect(page?.declaredBytes).toBe(page?.bytes);
    expect(extractWikiPage(exportXml(), "Arma Reforger:Missing")).toBeNull();
  });

  it("builds the menu tree from span headings and leaves the intro headings out", () => {
    const page = extractWikiPage(exportXml(), WIKI_PAGE_TITLE);
    const wiki = parseWikiPage(WIKI_PAGE_TITLE, page?.text ?? "");
    expect(wiki.nonEntryHeadings).toEqual(["General Use", "Hotkeys List", "Modding"]);
    const tops = wiki.nodes.filter((n) => n.parent === null).map((n) => n.text);
    expect(tops).toEqual(["Cheats", "AI", "Render", "GameCode"]);
    const bt = wiki.nodes.find((n) => n.text === "Set BT Breakpoint");
    expect(bt?.path).toEqual(["AI", "AIScript", "Set BT Breakpoint"]);
    expect(bt?.id).toBe("SCR_DebugMenuID.DEBUGUI_AI_SET_BT_BREAKPOINT");
    expect(wiki.nodes.find((n) => n.text === "AIScript")?.children).toHaveLength(2);
    // The code sample's "= not a heading =" is not an entry; the page has 3 + 29 headings.
    expect(wiki.nodes.some((n) => n.text === "not a heading")).toBe(false);
    expect(wiki.anchors).toContain("Hotkeys_List");
    // Repeated headings get MediaWiki's _2 suffix.
    expect(wiki.anchors.filter((a) => a.startsWith("Debug"))).toEqual(["Debug", "Debug_2"]);
    expect(wiki.anchors.filter((a) => a.startsWith("Show_GBuffer"))).toEqual([
      "Show_GBuffer",
      "Show_GBuffer_2",
    ]);
    // A hover title that disagrees with the nesting is reported, not trusted.
    expect(wiki.titleMismatches.map((m) => m.text)).toEqual(["Force flare"]);
  });

  it("reads hotkey, value list, range, Options line, bullets and a glued ID comment", () => {
    const page = extractWikiPage(exportXml(), WIKI_PAGE_TITLE);
    const wiki = parseWikiPage(WIKI_PAGE_TITLE, page?.text ?? "");
    const by = (t: string) => wiki.nodes.find((n) => n.text === t);
    expect(by("Teleport")).toMatchObject({
      hotkey: "LCtrl+LAlt+F2",
      values: ["false", "true"],
      id: "GAME_DIAG_CHEATS_TELEPORT",
      description: "Teleport player.",
    });
    expect(by("DTime multiplier value")?.range).toEqual({
      min: "0.01",
      max: "20",
      current: "1.0",
      step: "0.01",
    });
    expect(by("DTime multiplier value")?.description).toBe(
      "Set delta time multiplier value. See the page and bold text.",
    );
    expect(by("Force flare")?.range).toEqual({ min: "-1", max: "100", current: "-1", step: "1" });
    expect(by("Mode")?.description).toBe("Pick a mode. Items: off - nothing; all - everything.");
    expect(by("Set state (SP & MP)")?.values).toEqual([]);
    const cas = by("enabled");
    expect(cas).toMatchObject({ id: "DM_REND_CAS_ENABLED", idMalformed: true });
    expect(cas?.description).toBe("Enable/disable CAS.");
  });

  it("cleans wikitext markup", () => {
    expect(cleanWikitext("Press {{Controls|Win|Alt}} then [[A|b]] and [[C]] ''x'' '''y'''")).toBe(
      "Press Win+Alt then b and C x y",
    );
    expect(cleanWikitext("{{Link|#Teleport}} {{Link|u|label}}")).toBe("Teleport label");
  });

  it("strips templates wrapped around templates, and galleries wherever they open", () => {
    // The page footer: a Sticky template around a Feature template.
    expect(cleanWikitext("{{Sticky|{{Feature|informative|Hover over the titles.}}|bottom}}")).toBe(
      "",
    );
    expect(cleanWikitext("Text {{A|{{B|{{C|deep}}}}|x}} more")).toBe("Text more");
    expect(cleanWikitext("Press {{Controls|LCtrl|F2}} {{Sticky|{{Link|#X}}|bottom}}.")).toBe(
      "Press LCtrl+F2 .",
    );
    // Unbalanced braces never survive.
    expect(cleanWikitext("a {{ b }} c }} d")).toBe("a c d");
    // A File link whose caption holds a link of its own goes whole.
    expect(cleanWikitext("see [[File:a.jpg|600px|a [[Page|b]] caption]] here")).toBe("see here");
    expect(cleanWikitext("[[Image:a.png]]x[[:File:b.png|c]]")).toBe("x");
    // Galleries: opening on the description's own line, closed, and never closed.
    expect(
      stripGalleries('Interval.<gallery mode="nolines">\nFile:a.png|x\n</gallery>\nAfter.'),
    ).toBe("Interval.\nAfter.");
    expect(stripGalleries("Text<gallery>\nFile:a.png|x\nFile:b.png|y")).toBe("Text");
    expect(cleanWikitext("A <gallery>File:a.png|x</gallery> B")).toBe("A B");
  });
});

describe("e14 script scanning", () => {
  it("blanks comments and string contents without moving a line", () => {
    const src = 'a // x\nb /* y\nz */ c "q // r" d\n';
    const s = stripComments(src);
    expect(s.split("\n")).toHaveLength(src.split("\n").length);
    expect(s).toContain('"q // r"');
    expect(s).not.toContain("x");
    expect(maskStrings(s)).toContain('"      "');
    expect(blankDoxygenBlocks("a\n#ifdef DOXYGEN\nb\n#if X\nc\n#endif\nd\n#endif\ne\n").text).toBe(
      "a\n\n\n\n\n\n\n\ne\n",
    );
  });

  it("finds the registration calls and skips comments, strings and the Doxygen sample", () => {
    const sites = scanScriptRegistrations("scripts/Game/Sample.c", SAMPLE_C);
    const ids = sites.map((s) => s.idExpr);
    expect(ids).not.toContain("SCR_DebugMenuID.DEBUGUI_COMMENTED");
    expect(ids).not.toContain("SCR_DebugMenuID.DEBUGUI_BLOCK");
    expect(ids).not.toContain("SCR_DebugMenuID.DEBUGUI_IN_STRING");
    expect(ids).not.toContain("DiagMenus.MY_DOC");
    expect(countExcludedRegistrations(SAMPLE_C)).toBe(1);
    // 13 direct calls; the call inside the wrapper Reg() is replaced by its 2 call sites.
    expect(sites.filter((s) => !s.via)).toHaveLength(13);
    expect(sites.filter((s) => s.via === "Reg")).toHaveLength(2);
    const bt = sites.find((s) => s.idExpr.endsWith("DEBUGUI_AI_SET_BT_BREAKPOINT"));
    expect(bt).toMatchObject({
      name: "Set BT Breakpoint",
      parent: "AIScript",
      api: "RegisterBool",
    });
    expect(bt?.line).toBe(7);
    expect(bt?.lineText).toContain("RegisterBool(SCR_DebugMenuID.DEBUGUI_AI_SET_BT_BREAKPOINT");
    const range = sites.find((s) => s.api === "RegisterRange");
    expect(range?.spec).toBe("0, 10, 5, 0.5");
    expect(sites.find((s) => s.idExpr.endsWith("DEBUGUI_TOOL_ITEM"))).toMatchObject({
      shortcut: "lctrl+lalt+q",
      spec: "a,b,c",
    });
    const multi = sites.find((s) => s.idExpr.endsWith("DEBUGUI_MULTI"));
    expect(multi).toMatchObject({ name: "Multi line", parent: "AI" });
    const dynamic = sites.find((s) => s.idExpr.endsWith("DEBUGUI_DYNAMIC"));
    expect(dynamic?.name).toBeNull();
    const wrapped = sites.filter((s) => s.via === "Reg");
    expect(wrapped.map((s) => [s.idExpr, s.name, s.parent])).toEqual([
      ["SCR_DebugMenuID.DEBUGUI_WRAP_ONE", "Wrapped one", "WrapMenu"],
      ["SCR_DebugMenuID.DEBUGUI_WRAP_TWO", "Wrapped two", "WrapMenu"],
    ]);
    // The call line, not the wrapper body, is the reference.
    expect(wrapped[0].lineText).toBe('Reg(SCR_DebugMenuID.DEBUGUI_WRAP_ONE, "Wrapped one");');
  });

  it("counts static methods as declared, ignoring comments, fields and instance methods", () => {
    expect(countStaticMethods(DIAGMENU_C, "DiagMenu")).toBe(3);
    expect(countStaticMethods(DBGUI_C, "DbgUI")).toBe(3);
    expect(countStaticMethods(DBGUI_C, "Missing")).toBe(0);
  });
});

// ── Rows ──────────────────────────────────────────────────────────────────────

describe("e14 rows", () => {
  it("emits wiki rows with label, what, values, range, hotkey, parent_key and children_count", () => {
    const rows = rowsBy(build());
    const tp = rows.get("Cheats > Teleport");
    expect(tp).toMatchObject({
      kind: "diag-option",
      dim: "diag",
      module: "Shared",
      label: "Teleport",
      shortcut_default: "LCtrl+LAlt+F2",
      ref: "wiki:Arma_Reforger:Diag_Menu#Teleport",
      quote: "Teleport player.",
      confidence: "high",
      origin: "vanilla",
      parent_key: { dim: "diag", kind: "diag-menu", module: "Shared", key: { path: ["Cheats"] } },
    });
    expect(tp?.what).toContain("Teleport player. Values: false, true.");
    expect(tp?.what).toContain("Registered in script");
    expect(rows.get("Cheats > DTime multiplier value")?.what).toBe(
      "Set delta time multiplier value. See the page and bold text. Range: min 0.01, max 20, current 1.0, step 0.01. Id GAME_DIAG_CHEATS_TIME_DILATATION_VALUE.",
    );
    expect(rows.get("Render > Lens > Force flare")?.what).toContain(
      "Range: min -1, max 100, current -1, step 1.",
    );
    expect(rows.get("Cheats")).toMatchObject({
      kind: "diag-menu",
      parent_key: null,
      children_count: 3,
    });
    expect(rows.get("AI > AIScript")?.kind).toBe("diag-menu");
    for (const o of build().observations) {
      expect(o).not.toHaveProperty("id");
      expect(o).not.toHaveProperty("tier");
    }
  });

  it("keeps one row per option listed twice with the same ID, and disambiguates same-name entries by ID", () => {
    const rows = rowsBy(build());
    expect(rows.get("Render > PP effects > Show GBuffer")).toBeDefined();
    expect(rows.get("Render > PP effects > Show GBuffer")?.unverified?.[0]).toContain(
      "section Show_GBuffer_2 repeats section Show_GBuffer",
    );
    expect(rows.has("Render > PP effects > Debug")).toBe(false);
    const a = rows.get("Render > PP effects > Debug [DM_REND_PP_HBAO_DEBUG]");
    const b = rows.get("Render > PP effects > Debug [DM_REND_PP_HDR_DEBUG]");
    expect(a).toMatchObject({ label: "Debug" });
    expect(b).toMatchObject({ label: "Debug" });
    expect(a?.ref).toBe("wiki:Arma_Reforger:Diag_Menu#Debug");
    expect(b?.ref).toBe("wiki:Arma_Reforger:Diag_Menu#Debug_2");
    // Debug, Debug, Show GBuffer (listed twice, one row), Set state.
    expect(rows.get("Render > PP effects")?.children_count).toBe(4);
  });

  it("flags the glued ID comment and keeps an empty value list as no list", () => {
    const rows = rowsBy(build());
    expect(rows.get("Render > CAS > enabled")?.unverified?.[0]).toContain("malformed");
    const state = rows.get("Render > PP effects > Set state (SP & MP)");
    expect(state?.what).toBe("Set the state. Id DM_REND_STATE.");
  });

  it("joins script sites to wiki rows by ID, by vote of the children and by name", () => {
    const result = build();
    const rows = rowsBy(result);
    // By ID: the script name differs from the wiki label ("Print debug from BTs").
    expect(rows.get("AI > AIScript > Print debug")?.what).toContain(
      'Registered in script at pak:scripts/Game/Sample.c#L8. Script name: "Print debug from BTs".',
    );
    // By vote: the script menu "Game Groups" is the wiki menu "Groups".
    expect(rows.get("GameCode > Groups")?.what).toContain('Script name: "Game Groups"');
    expect(rows.has("GameCode > Game Groups")).toBe(false);
    // By name: the script menu "AIScript" under "AI" is the wiki heading of the same name.
    expect(rows.get("AI > AIScript")?.what).toContain(
      "Registered in script at pak:scripts/Game/Sample.c#L6.",
    );
    expect(rows.get("AI > AIScript")?.ref).toMatch(/^wiki:/);
    // A script shortcut that equals the wiki hotkey is not repeated.
    expect(rows.get("Cheats > Teleport")?.what).not.toContain("Script shortcut");
  });

  it("adds script-only rows with a pak ref, values or range from the call, and keeps their parents", () => {
    const rows = rowsBy(build());
    const neu = rows.get("AI > AIScript > Show new thing");
    expect(neu).toMatchObject({
      kind: "diag-option",
      ref: "pak:scripts/Game/Sample.c#L9",
      confidence: "high",
      parent_key: { key: { path: ["AI", "AIScript"] } },
    });
    expect(neu?.quote).toContain("DEBUGUI_AI_NEW");
    expect(neu?.what).toContain("Registers a boolean setting (DiagMenu.RegisterBool).");
    expect(rows.get("AI > AIScript > Aim range")?.what).toContain(
      "Range: min 0, max 10, current 5, step 0.5.",
    );
    // A script menu under a wiki menu, with its option.
    expect(rows.get("Render > Extra")).toMatchObject({
      kind: "diag-menu",
      ref: "pak:scripts/Game/Sample.c#L12",
      children_count: 1,
      parent_key: { key: { path: ["Render"] } },
    });
    expect(rows.get("Render > Extra > Extra A")?.kind).toBe("diag-option");
    // A parent menu that neither source defines becomes a medium-confidence top-level menu.
    expect(rows.get("Tools")).toMatchObject({
      kind: "diag-menu",
      confidence: "medium",
      parent_key: null,
    });
    expect(rows.get("Tools > Pick mode")).toMatchObject({
      shortcut_default: "lctrl+lalt+q",
      confidence: "medium",
    });
    expect(rows.get("Tools > Pick mode")?.what).toContain("Values: a, b, c.");
    expect(rows.get("WrapMenu > Wrapped one")?.ref).toBe("pak:scripts/Game/Sample.c#L34");
  });

  it("reports unresolved sites instead of guessing a path", () => {
    const result = build();
    expect(result.unresolvedSites).toHaveLength(1);
    expect(result.unresolvedSites[0].reason).toContain("name is not a literal (someName)");
    expect(rowsBy(result).has("AI > ")).toBe(false);
  });

  it("states the overlap between the two sources and the headline counts", () => {
    const { stats } = build();
    // Wiki fixture: 22 span headings (9 with children), one option listed twice.
    expect(stats.wiki).toMatchObject({
      headings: 25,
      entries: 22,
      topLevelMenus: 4,
      menus: 9,
      options: 12,
      sameIdRepeats: 1,
      disambiguated: 2,
      malformedIds: 1,
      titleMismatches: 1,
      rowsEmitted: 21,
      nonEntryHeadings: ["General Use", "Hotkeys List", "Modding"],
    });
    expect(stats.script).toMatchObject({
      filesScanned: 4,
      sitesDirect: 13,
      sitesFromWrappers: 2,
      sitesTotal: 15,
      excludedDoxygenSites: 1,
      unresolved: 1,
      resolvedSites: 14,
      distinctPaths: 14,
      joinedByWikiId: 3,
      joinedByPath: 3,
      scriptOnlyMenus: 1,
      scriptOnlyOptions: 7,
      implicitParentMenus: 2,
      diagMenuStatics: 3,
      dbgUiStatics: 3,
    });
    expect(stats.script.byApi).toEqual({
      RegisterBool: 10,
      RegisterItem: 1,
      RegisterMenu: 3,
      RegisterRange: 1,
    });
    // Both: AIScript, Set BT Breakpoint, Print debug, Groups, Log groups, Teleport.
    expect(stats.overlap).toEqual({ both: 6, wikiOnly: 15, scriptOnly: 10 });
    expect(stats.totals).toEqual({
      rows: 31,
      topLevelMenus: 6,
      menus: 12,
      options: 19,
      optionsWithValueList: 10,
      optionsWithRange: 3,
      optionsWithHotkey: 2,
    });
  });
});

// ── Markup, link value lists, disambiguation ──────────────────────────────────

/** A page that exercises the cleaner, a link-only value list, a placeholder list and same-name entries. */
const MARKUP_PAGE = [
  "= Intro =",
  "",
  `= ${span("Phys", "Phys")} =`,
  "",
  `== ${span("Phys", "Layers")} ==`,
  "",
  "<!-- ID: DM_X_LAYER -->",
  "Show by layer. Example layers available:",
  "",
  "* '''Filtered''' - default mode, shows the important layers",
  "* '''Fire geometry''' - hit detection",
  "",
  "[[File:fire.jpg|600x600px]]",
  "* '''Mine layer''' - mines and what collides with them",
  "",
  "[[File:mine.jpg|597x597px]]",
  "",
  "'''Available Options''': [[Some Page#Setup|''See that page for all options'']]",
  "",
  `== ${span("Phys", "Plain link")} ==`,
  "",
  "<!-- ID: DM_X_PLAIN -->",
  "Item with a link and no bullets.",
  "",
  "'''Available Options''': {{Link|#Other}}",
  "",
  `== ${span("Phys", "Placeholder")} ==`,
  "",
  "<!-- ID: DM_X_PLACEHOLDER -->",
  "Set a category.",
  "",
  "'''Available Options''': NO CATALOGS FOUND!",
  "",
  `== ${span("Phys", "Bullets without names")} ==`,
  "",
  "<!-- ID: DM_X_UNNAMED -->",
  "Pick one.",
  "* first - one",
  "* second - two",
  "",
  "'''Available Options''': [[Other Page|all of them]]",
  "",
  `== ${span("Phys", "Gallery")} ==`,
  "",
  "<!-- ID: DM_X_GALLERY -->",
  'Interval at which speed is measured.<gallery mode="nolines" widths="250" heights="255">',
  "File:interval-500.png|500m interval",
  "File:interval-50.png|50m interval",
  "</gallery>",
  "",
  "'''Available Options''': 100, 200, 500",
  "",
  `== ${span("Phys", "Gallery after")} ==`,
  "",
  "<!-- ID: DM_X_GALLERY_AFTER -->",
  "Gallery on its own line.",
  "<gallery>",
  "File:one.png|one",
  "</gallery>",
  "",
  "'''Available Options''': a, b",
  "",
  `= ${span("Same", "Same")} =`,
  "",
  `== ${span("Same", "Debug")} ==`,
  "",
  "<!-- ID: DM_S_ONE -->",
  "First.",
  "",
  `== ${span("Same", "Debug")} ==`,
  "",
  "<!-- ID: DM_S_TWO -->",
  "Second.",
  "",
  `== ${span("Same", "Debug")} ==`,
  "",
  "<!-- ID: DM_S_THREE -->",
  "Third.",
  "",
  `== ${span("Same", "Quality")} ==`,
  "",
  "<!-- ID: DM_Q_ONE -->",
  "Quality one.",
  "",
  `== ${span("Same", "Quality")} ==`,
  "",
  "<!-- ID: DM_Q_TWO -->",
  "Quality two.",
  "",
  `== ${span("Same", "Unique")} ==`,
  "",
  "<!-- ID: DM_S_UNIQUE -->",
  "Not shared.",
  "",
  `== ${span("Same", "Last")} ==`,
  "",
  "<!-- ID: DM_S_LAST -->",
  "Enable/disable logging.",
  "",
  "'''Available Options''': false, true",
  "",
  "{{Sticky|{{Feature|informative|It is possible to hover over the titles.}}|bottom}}",
  "",
  "{{GameCategory|armaR|Modding|Official Tools}}",
].join("\n");

const NO_SCRIPTS = { list: () => [] as string[], read: () => "" };

function buildMarkupPage(): E14Result {
  const r = enumerateDiag(exportXml(MARKUP_PAGE), "<repo>/data/wiki/export.xml", NO_SCRIPTS);
  if (!r) throw new Error("page not found");
  return r;
}

/** What the generator must never leave in a row's text. */
const LEFTOVER_MARKUP = [
  "{{",
  "}}",
  "[[",
  "]]",
  "<gallery",
  "</gallery",
  "'''",
  "''",
  "File:",
  "<span",
  "<br",
] as const;

function leftoverMarkup(r: E14Result): string[] {
  const found: string[] = [];
  for (const o of r.observations) {
    for (const [field, text] of [
      ["what", o.what ?? ""],
      ["label", o.label ?? ""],
      ["unverified", (o.unverified ?? []).join(" ")],
    ] as const) {
      for (const m of LEFTOVER_MARKUP) {
        if (text.includes(m)) found.push(`${pathOf(o)} ${field} holds ${m}`);
      }
    }
  }
  return found;
}

describe("e14 what: no wiki markup", () => {
  it("strips the footer template and a gallery that opens on the description line", () => {
    const rows = rowsBy(buildMarkupPage());
    expect(rows.get("Same > Last")?.what).toBe(
      "Enable/disable logging. Values: false, true. Id DM_S_LAST.",
    );
    expect(rows.get("Phys > Gallery")?.what).toBe(
      "Interval at which speed is measured. Values: 100, 200, 500. Id DM_X_GALLERY.",
    );
    // The quote is the description line as written, minus the gallery tag.
    expect(rows.get("Phys > Gallery")?.quote).toBe("Interval at which speed is measured.");
    expect(rows.get("Phys > Gallery after")?.what).toBe(
      "Gallery on its own line. Values: a, b. Id DM_X_GALLERY_AFTER.",
    );
  });

  it("leaves no markup in the what, label or unverified of any row", () => {
    expect(leftoverMarkup(buildMarkupPage())).toEqual([]);
    // The pre-fix leftovers, planted: a footer template and a gallery tag are reported.
    const planted = buildMarkupPage();
    planted.observations[0] = {
      ...planted.observations[0],
      what: 'x {{Sticky||bottom}} <gallery mode="nolines">',
    };
    expect(leftoverMarkup(planted)).toHaveLength(3);
  });
});

describe("e14 Available Options that is a link or prose", () => {
  it("takes the real names from the bullets when the line is a link, and says so", () => {
    const row = rowsBy(buildMarkupPage()).get("Phys > Layers");
    expect(row?.what).toContain("Values: Filtered, Fire geometry, Mine layer.");
    expect(row?.what).not.toContain("Some Page");
    expect(row?.what).not.toContain("See that page");
    expect(row?.unverified?.join(" ")).toContain("Available Options line is a link or prose");
    expect(row?.unverified?.join(" ")).toContain("See that page for all options");
    expect(row?.unverified?.join(" ")).toContain("may be incomplete");
  });

  it("emits no Values for a link with no named bullets, or for a placeholder sentence", () => {
    const rows = rowsBy(buildMarkupPage());
    for (const key of ["Phys > Plain link", "Phys > Placeholder", "Phys > Bullets without names"]) {
      expect(rows.get(key)?.what, key).not.toContain("Values:");
      expect(rows.get(key)?.unverified?.join(" "), key).toContain("no Values emitted");
    }
    expect(rows.get("Phys > Placeholder")?.unverified?.join(" ")).toContain("NO CATALOGS FOUND!");
    // A link line is never read as a value list.
    const page = extractWikiPage(exportXml(MARKUP_PAGE), WIKI_PAGE_TITLE);
    const wiki = parseWikiPage(WIKI_PAGE_TITLE, page?.text ?? "");
    const layers = wiki.nodes.find((n) => n.text === "Layers");
    expect(layers?.values).toBeUndefined();
    expect(layers?.valuesNotList).toBe("See that page for all options");
    expect(layers?.bulletNames).toEqual(["Filtered", "Fire geometry", "Mine layer"]);
    expect(wiki.nodes.find((n) => n.text === "Bullets without names")?.bulletNames).toBeUndefined();
  });

  it("keeps a real list, a one-value list and an empty list as they were", () => {
    const wikitext = [
      `= ${span("T", "T")} =`,
      `== ${span("T", "One")} ==`,
      "<!-- ID: DM_T_ONE -->",
      "'''Available Options''': disabled",
      `== ${span("T", "Words")} ==`,
      "<!-- ID: DM_T_WORDS -->",
      "'''Available Options''': flow noise - LF part, <0..2>lin filmic, >1ms, FSR Quality (67%)",
      `== ${span("T", "Empty")} ==`,
      "<!-- ID: DM_T_EMPTY -->",
      "'''Available Options''':",
    ].join("\n");
    const rows = rowsBy(build(wikitext));
    expect(rows.get("T > One")?.what).toBe("Values: disabled. Id DM_T_ONE.");
    expect(rows.get("T > Words")?.what).toBe(
      "Values: flow noise - LF part, <0..2>lin filmic, >1ms, FSR Quality (67%). Id DM_T_WORDS.",
    );
    expect(rows.get("T > Empty")?.what).toBe("Id DM_T_EMPTY.");
    expect(rows.get("T > Empty")?.unverified).toBeUndefined();
  });
});

describe("e14 disambiguated entries name the sibling", () => {
  it("says which siblings each row was told apart from, by key and by section", () => {
    const rows = rowsBy(buildMarkupPage());
    const one = rows.get("Same > Debug [DM_S_ONE]")?.unverified?.join(" ") ?? "";
    expect(one).toContain('the plain path "Same > Debug" is shared by 3 entries');
    expect(one).toContain('"Debug [DM_S_TWO]" (section Debug_2)');
    expect(one).toContain('"Debug [DM_S_THREE]" (section Debug_3)');
    expect(one).not.toContain('"Debug [DM_S_ONE]"');
    const two = rows.get("Same > Debug [DM_S_TWO]")?.unverified?.join(" ") ?? "";
    expect(two).toContain('"Debug [DM_S_ONE]" (section Debug)');
    expect(two).toContain('"Debug [DM_S_THREE]" (section Debug_3)');
    const q = rows.get("Same > Quality [DM_Q_ONE]")?.unverified?.join(" ") ?? "";
    expect(q).toContain("is shared by 2 entries");
    expect(q).toContain('disambiguated from "Quality [DM_Q_TWO]" (section Quality_2)');
    // An entry with a unique name carries no such note.
    expect(rows.get("Same > Unique")?.unverified).toBeUndefined();
  });

  it("gives every disambiguated row one note that names at least one existing sibling row", () => {
    const r = buildMarkupPage();
    const rows = rowsBy(r);
    const tagged = r.observations.filter((o) => /\[[^\]]+\]$/.test(o.key.path?.at(-1) ?? ""));
    expect(tagged).toHaveLength(5);
    for (const o of tagged) {
      expect(o.unverified, pathOf(o)).toHaveLength(1);
      const note = (o.unverified as string[])[0];
      const named = [...note.matchAll(/"([^"]+ \[[^\]]+\])"/g)].map((m) => m[1]);
      expect(named.length, pathOf(o)).toBeGreaterThan(0);
      for (const n of named) {
        expect(rows.has([...(o.key.path ?? []).slice(0, -1), n].join(" > ")), n).toBe(true);
        expect(n).not.toBe(o.key.path?.at(-1));
      }
    }
  });
});

// ── Files, determinism, ledger ────────────────────────────────────────────────

function writeInputs(): { wiki: string; scripts: string } {
  const dir = mkdtempSync(join(tmpdir(), "e14-wiki-"));
  const wiki = join(dir, "export.xml");
  writeFileSync(wiki, exportXml());
  return { wiki, scripts: standardScripts() };
}

function obsFile(fx: Fixture): string {
  return join(fx.root, "observations", "E14", "1.0.0.1.jsonl");
}

describe("e14 file, determinism and ledger", () => {
  it("writes a header and sorted rows with no id, and a second run is byte-identical", () => {
    const fx = makeCensus("1.0.0.1");
    const { wiki, scripts } = writeInputs();
    const r1 = runIn(fx, runE14, ["--wiki", wiki, "--scripts", scripts]);
    expect(r1.code).toBe(0);
    const text1 = readFileSync(obsFile(fx), "utf-8");
    const lines = text1.trim().split("\n");
    const header = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(header).toMatchObject({
      $header: 1,
      build: "1.0.0.1",
      enumerator: "E14",
      generator: GENERATOR,
      provisional: false,
      row_count: lines.length - 1,
    });
    const inputs = header.inputs as { path: string; sha256: string }[];
    expect(inputs[0].path).toBe("<game>/pak:scripts/Core/generated/Debug/DbgUI.c");
    expect(inputs.some((i) => i.path === "<repo>/data/wiki/export.xml")).toBe(true);
    expect(inputs.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(true);
    expect(text1).not.toMatch(/[A-Za-z]:[\\/]/);
    const ids = lines
      .slice(1)
      .map(
        (l) =>
          JSON.parse(l) as {
            dim: "diag";
            kind: "diag-menu";
            module: "Shared";
            key: { path: string[] };
          },
      )
      .map((o) => deriveId(o));
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(ids).size).toBe(ids.length);
    const r2 = runIn(fx, runE14, ["--wiki", wiki, "--scripts", scripts]);
    expect(r2.code).toBe(0);
    expect(readFileSync(obsFile(fx), "utf-8")).toBe(text1);
    expect(r1.stdout).toContain("E14 at build 1.0.0.1:");
  });

  it("is accepted by the ledger: no rejected line, parents resolve, children_count agrees", () => {
    const fx = makeCensus("1.0.0.1");
    const { wiki, scripts } = writeInputs();
    runIn(fx, runE14, ["--wiki", wiki, "--scripts", scripts]);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(
      built.problems.filter((p) => (p.id ?? "").startsWith("diag:") || p.message.includes("E14")),
    ).toEqual([]);
    const diag = built.rows.filter((r) => r.dim === "diag");
    const obsCount = readFileSync(obsFile(fx), "utf-8").trim().split("\n").length - 1;
    expect(diag).toHaveLength(obsCount);
    expect(diag.every((r) => r.module === "Shared")).toBe(true);
    const cheats = diag.find((r) => r.id === "diag:Cheats");
    expect(cheats).toMatchObject({
      kind: "diag-menu",
      children_enumerated: true,
      children_count: 3,
    });
    const tp = diag.find((r) => r.id === "diag:Cheats/Teleport");
    expect(tp).toMatchObject({
      kind: "diag-option",
      parent: "diag:Cheats",
      shortcut_default: "LCtrl+LAlt+F2",
    });
    expect(tp?.sources[0]).toMatchObject({ enumerator: "E14", confidence: "high" });
    // Every row has its parent in the shard.
    const idsSet = new Set(diag.map((r) => r.id));
    expect(
      diag.every((r) => r.parent === null || r.parent === undefined || idsSet.has(r.parent)),
    ).toBe(true);
  });

  it("answers NO DATA without a wiki export or a script source, and refuses a foreign --out", () => {
    const fx = makeCensus("1.0.0.1");
    const { wiki, scripts } = writeInputs();
    const noWiki = runIn(fx, runE14, [
      "--wiki",
      join(tmpdir(), "no-such-export.xml"),
      "--scripts",
      scripts,
    ]);
    expect(noWiki.code).toBe(2);
    expect(noWiki.stdout).toContain("NO DATA");
    const noScripts = runIn(fx, runE14, [
      "--wiki",
      wiki,
      "--scripts",
      join(tmpdir(), "no-such-dir"),
    ]);
    expect(noScripts.code).toBe(2);
    expect(noScripts.stdout).toContain("NO DATA");
    const noGame = runIn(fx, runE14, ["--wiki", wiki, "--game", join(tmpdir(), "no-such-game")]);
    expect(noGame.code).toBe(2);
    const noPage = runIn(fx, runE14, [
      "--wiki",
      wiki,
      "--scripts",
      scripts,
      "--page",
      "Arma Reforger:Nope",
    ]);
    expect(noPage.code).toBe(2);
    expect(noPage.stdout).toContain("is not in the export");
    const foreign = runIn(fx, runE14, [
      "--wiki",
      wiki,
      "--scripts",
      scripts,
      "--out",
      join(fx.root, "observations", "E02", "1.0.0.1.jsonl"),
    ]);
    expect(foreign.code).toBe(1);
    expect(foreign.stderr).toContain("refusing --out outside observations/E14/");
    expect(existsSync(join(fx.root, "observations", "E02"))).toBe(false);
    expect(existsSync(obsFile(fx))).toBe(false);
  });

  it("gates: every wiki ref names a heading on the page and option paths are unique", () => {
    const result = build();
    const page = extractWikiPage(exportXml(), WIKI_PAGE_TITLE);
    const seen = new Map<string, number>();
    const anchors = new Set<string>();
    for (const l of (page?.text ?? "").split("\n")) {
      const h = /^(={1,6})\s*(.*?)\s*\1\s*$/.exec(l);
      if (!h) continue;
      const inner = /^<span [^>]*>(.*)<\/span>$/.exec(h[2]);
      const base = (inner ? inner[1] : h[2]).replace(/&amp;/g, "&").replace(/\s+/g, "_");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      anchors.add(n === 1 ? base : `${base}_${n}`);
    }
    for (const o of result.observations.filter((x) => x.ref.startsWith("wiki:"))) {
      const section = o.ref.slice(o.ref.indexOf("#") + 1);
      expect(anchors.has(section), `${o.ref} is not a heading`).toBe(true);
    }
    const ids = result.observations.map((o) => deriveId(o));
    expect(new Set(ids).size).toBe(ids.length);
    const text = observationFileText(result, "1.0.0.1");
    expect(text.split("\n")[0]).toContain('"row_count":' + result.observations.length);
  });
});

// ── Real data ─────────────────────────────────────────────────────────────────

const REAL_WIKI = join(REPO_ROOT, "data", "wiki", "export.xml");
const GAME_PATH = loadConfig().gamePath;
const HAVE_WIKI = existsSync(REAL_WIKI);
const HAVE_GAME = existsSync(join(GAME_PATH, "addons"));

describe.skipIf(!HAVE_WIKI)("e14 real wiki export (build 1.8.0.13)", () => {
  const xml = HAVE_WIKI ? readFileSync(REAL_WIKI, "utf-8") : "";
  const empty = { list: () => [] as string[], read: () => "" };

  it("reproduces the page size, tree and per-feature counts", () => {
    const r = enumerateDiag(xml, "<repo>/data/wiki/export.xml", empty);
    expect(r).not.toBeNull();
    const s = (r as E14Result).stats;
    expect(s.wiki.bytes).toBe(322215);
    expect(s.wiki.declaredBytes).toBe(322215);
    expect(s.wiki.headings).toBe(1551);
    expect(s.wiki.entries).toBe(1548);
    expect(s.wiki.topLevelMenus).toBe(29);
    expect(s.wiki.menus).toBe(147);
    expect(s.wiki.options).toBe(1399);
    expect(s.wiki.sameIdRepeats).toBe(2);
    expect(s.wiki.disambiguated).toBe(9);
    expect(s.wiki.titleMismatches).toBe(9);
    expect(s.wiki.nonEntryHeadings).toEqual(["General Use", "Hotkeys List", "Modding"]);
    expect(s.totals).toMatchObject({
      rows: 1546,
      topLevelMenus: 29,
      menus: 147,
      options: 1399,
      optionsWithValueList: 1203,
      optionsWithRange: 192,
      optionsWithHotkey: 38,
    });
  });

  it("emits unique option paths, existing sections and parents with matching children_count", () => {
    const r = enumerateDiag(xml, "<repo>/data/wiki/export.xml", empty) as E14Result;
    const ids = r.observations.map((o) => deriveId(o));
    expect(new Set(ids).size).toBe(ids.length);
    const page = extractWikiPage(xml, WIKI_PAGE_TITLE);
    const wiki = parseWikiPage(WIKI_PAGE_TITLE, page?.text ?? "");
    const anchors = new Set(wiki.anchors);
    for (const o of r.observations) {
      expect(anchors.has(o.ref.slice(o.ref.indexOf("#") + 1))).toBe(true);
    }
    const byPath = new Map(r.observations.map((o) => [pathOf(o), o]));
    for (const o of r.observations) {
      if (o.parent_key === null || o.parent_key === undefined) continue;
      expect(byPath.get((o.parent_key.key.path ?? []).join(" > "))?.kind).toBe("diag-menu");
    }
    for (const m of r.observations.filter((o) => o.kind === "diag-menu")) {
      const kids = r.observations.filter(
        (o) => (o.parent_key?.key.path ?? []).join(" > ") === pathOf(m),
      ).length;
      expect(m.children_count).toBe(kids);
    }
    expect(byPath.get("Cheats > Disable player damage")).toMatchObject({
      shortcut_default: "LCtrl+LAlt+F1",
      ref: "wiki:Arma_Reforger:Diag_Menu#Disable_player_damage",
    });
  });

  it("leaves no wiki markup in any what, label or unverified", () => {
    const r = enumerateDiag(xml, "<repo>/data/wiki/export.xml", empty) as E14Result;
    expect(leftoverMarkup(r)).toEqual([]);
    const byPath = new Map(r.observations.map((o) => [pathOf(o), o]));
    // The page footer on the last entry, and the gallery on "Info segment length".
    expect(byPath.get("Radial Menu > Enable logging")?.what).toBe(
      "Enable/disable radial menu logging. Values: false, true. Id SCR_DebugMenuID.DEBUGUI_RADIALMENU_LOGGING.",
    );
    expect(byPath.get("GameCode > Projectiles > Info segment length")?.what).toBe(
      "Interval at which speed data in infobox is measured and persisted. Values: 100, 200, 500, 25, 50. Id DM_PROJ_SHELL_INFO_SEGMENT_LENGTH.",
    );
  });

  it("takes the layer names from the bullets, not from the Collision Layer link", () => {
    const r = enumerateDiag(xml, "<repo>/data/wiki/export.xml", empty) as E14Result;
    const byPath = new Map(r.observations.map((o) => [pathOf(o), o]));
    const layer = byPath.get("Physics > Show layer");
    expect(layer?.what).toContain(
      "Values: Filtered, Fire geometry, View geometry, Foliage, Interaction layer, Mine layer, Char collider, Vehicle simple.",
    );
    expect(layer?.what).not.toContain("Collision Layer");
    expect(layer?.unverified?.join(" ")).toContain("See Collision Layer page for all options");
    // Placeholder shown by the menu when its catalogs are missing: no value list.
    const cat = byPath.get("AI > AIScript > AI Debug Category");
    expect(cat?.what).not.toContain("Values:");
    expect(cat?.unverified?.join(" ")).toContain("MISSING CATALOGS!");
    // No other row's list is a link or a sentence.
    const notLists = r.observations.filter((o) =>
      (o.unverified ?? []).some((u) => u.includes("Available Options line is a link or prose")),
    );
    expect(notLists.map(pathOf).sort()).toEqual([
      "AI > AIScript > AI Debug Category",
      "Physics > Show layer",
    ]);
  });

  it("names the sibling in each of the nine disambiguated rows", () => {
    const r = enumerateDiag(xml, "<repo>/data/wiki/export.xml", empty) as E14Result;
    const byPath = new Map(r.observations.map((o) => [pathOf(o), o]));
    const tagged = r.observations.filter((o) =>
      (o.unverified ?? []).some((u) => u.includes("was disambiguated from")),
    );
    expect(tagged).toHaveLength(9);
    for (const o of tagged) {
      const note = (o.unverified ?? []).find((u) => u.includes("was disambiguated from")) as string;
      const named = [...note.matchAll(/"([^"]+ \[[^\]]+\])"/g)].map((m) => m[1]);
      expect(named.length, pathOf(o)).toBeGreaterThan(0);
      for (const n of named) {
        expect(byPath.has([...(o.key.path ?? []).slice(0, -1), n].join(" > ")), n).toBe(true);
      }
    }
  });
});

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !HAVE_WIKI || !HAVE_GAME)("e14 against the game paks (build 1.8.0.13)", () => {
  it(
    "reproduces the script counts, the overlap and the combined totals",
    { timeout: 120000 },
    async () => {
      const { PakVirtualFS } = await import("../../src/pak/vfs.js");
      const vfs = PakVirtualFS.get(GAME_PATH);
      expect(vfs).not.toBeNull();
      const files = (vfs?.allFilePaths() ?? []).filter((p) => p.endsWith(".c"));
      const r = enumerateDiag(readFileSync(REAL_WIKI, "utf-8"), "<repo>/data/wiki/export.xml", {
        list: () => files,
        read: (p) => (vfs as NonNullable<typeof vfs>).readTextFile(p),
      }) as E14Result;
      const s = r.stats;
      expect(s.script.filesScanned).toBe(files.length);
      expect(s.script.diagMenuStatics).toBe(16);
      expect(s.script.dbgUiStatics).toBe(27);
      expect(s.script).toMatchObject({
        sitesDirect: 215,
        sitesFromWrappers: 8,
        sitesTotal: 223,
        excludedDoxygenSites: 1,
        unresolved: 0,
        distinctPaths: 222,
        joinedByWikiId: 143,
      });
      expect(s.overlap).toEqual({ both: 160, wikiOnly: 1386, scriptOnly: 62 });
      expect(s.totals).toMatchObject({
        rows: 1608,
        topLevelMenus: 29,
        menus: 154,
        options: 1454,
        optionsWithValueList: 1205,
        optionsWithRange: 195,
        optionsWithHotkey: 38,
      });
    },
  );
});
