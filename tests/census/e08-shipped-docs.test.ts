import { beforeAll, describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { deriveId } from "../../src/census/ids.js";
import { observationSchema } from "../../src/census/schemas.js";
import { loadConfig } from "../../src/config.js";
import {
  buildSourceIndex,
  saveSourceIndex,
  type SourceIndex,
} from "../../src/census/source-index.js";
import {
  type ImportResult,
  PAGE_CONTENT,
  cutAtMachinePath,
  decodeEntities,
  extractCliTables,
  extractNetExample,
  extractNetFunctions,
  htmlText,
  importDocs,
  inventoryOf,
  loadIndexInput,
  observationFileText,
  pageIds,
  parseJsonish,
  parseTables,
  pluginDisplayName,
  resolveOut,
  resolvePluginClass,
  run,
  type SourceIndexInput,
  sentenceOf,
  tableScope,
} from "../../scripts/census/enumerators/e08-shipped-docs.js";
import { makeCensus, runIn } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic Doxygen fragments ───────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `<div class="line">` lines of a code fragment, as Doxygen writes them. */
function fragment(...lines: string[]): string {
  return `<div class="fragment">${lines.map((l) => `<div class="line">${esc(l)}</div>`).join("\n")}\n</div><!-- fragment -->`;
}

function page(title: string, body: string): string {
  return (
    `<!DOCTYPE html><html><head><title>${title}</title></head><body>` +
    `<div class="PageDoc"><div class="contents">\n<div class="textblock">${body}</div></div><!-- contents -->` +
    "</div></body></html>"
  );
}

function h(level: 1 | 2 | 3, id: string, text: string): string {
  return `<h${level} class="doxsection"><a class="anchor" id="${id}"></a>\n${text}</h${level}>\n`;
}

function cliRow(parity: "Odd" | "Even", param: string, cols: string[]): string {
  return (
    `<tr class="markdownTableRow${parity}">\n<td class="markdownTableBodyNone">${param}  </td>` +
    cols.map((c) => `<td class="markdownTableBodyNone">${c}  </td>`).join("") +
    "</tr>\n"
  );
}

function cliTable(header: string[], rows: string[]): string {
  return (
    '<table class="markdownTable">\n<tr class="markdownTableHead">\n' +
    header.map((x) => `<th class="markdownTableHeadNone">${x}  </th>`).join("") +
    `</tr>\n${rows.join("")}</table>\n`
  );
}

const tt = (s: string): string => `<span class="tt">${s}</span>`;

/** A page shaped like Page_CLI: a four-column table, a three-column table, odd cells. */
const CLI_PAGE = page(
  "Enfusion Script API: Command line interface (CLI)",
  h(1, "Page_CLI_Common", "Common") +
    h(2, "Page_CLI_Common_FilePaths", "File Paths") +
    cliTable(
      ["Parameter", "Visibility", "Possible values / Default", "Description"],
      [
        cliRow("Odd", tt("-gproj FILE_FULL_PATH"), [
          "public",
          "",
          "Full path to the game project file. The path may be relative.",
        ]),
        cliRow("Even", tt("-window"), [
          "public",
          "<em>N/A</em>",
          "Starts GameApp in a windowed mode.",
        ]),
        cliRow("Odd", `${tt("-profile RELATIVE_PATH")} / ${tt("-profile ABSOLUTE_PATH")}`, [
          "public",
          "",
          "Set path to directory under which profile directory is located.",
        ]),
        cliRow("Even", tt("-minidump TYPE"), [
          "ENF_DEVELOPER",
          "<b>Normal</b>, DataSegs",
          "Will set flags for minidump generation. Values are not case sensitive.",
        ]),
        cliRow("Odd", tt("-validate[=CONFIGURATION_NAME]"), ["public", "", "Checks scripts."]),
      ],
    ) +
    h(1, "Page_CLI_Workbench", "Workbench") +
    h(2, "Page_CLI_Workbench_WorkbenchParams", "Workbench parameters") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [
        // Same switch as the first table: the first occurrence is kept.
        cliRow("Odd", tt("-gproj PATH_TO_GPROJ"), ["public", "Specific game project path."]),
        cliRow("Even", tt("-wbModule=MODULE_NAME"), [
          "public",
          "Workbench module specifier: ResourceManager, WorldEditor. Note: use -run too.",
        ]),
        cliRow("Odd", tt("no params needed"), ["public", "Nothing to pass."]),
        cliRow("Even", `${tt("-alpha")} ${tt("-beta VALUE")}`, [
          "public",
          "Two switches in one cell.",
        ]),
        // A page example holding a drive path: the quote is cut before it.
        cliRow("Odd", tt("-build"), [
          "",
          `Build tables. <b>Example:</b> ${tt("-wbmodule=X -build -saveDir c:\\tmp\\")}`,
        ]),
      ],
    ) +
    h(2, "Page_CLI_Workbench_ResourceManager", "Module: ResourceManager") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [cliRow("Odd", tt("-builddata"), ["public", "Builds the data."])],
    ) +
    h(2, "Page_CLI_Workbench_WorldEditor", "Module: World Editor") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [cliRow("Odd", tt("-weflag"), ["public", "A World Editor switch."])],
    ) +
    h(2, "Page_CLI_Workbench_ResavePlugin", "Module: ResourceManager Plugin: ResavePlugin") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [
        cliRow("Odd", tt("-extension=layout"), ["public", "Resaves files with this extension."]),
        // The plugin's own -world: a plugin argument, not the engine switch of the same name.
        cliRow("Even", tt("-world=ENT_FILE_PATH"), ["public", "World the plugin loads."]),
      ],
    ) +
    // The same plugin argument under a second module: the first table's row is kept.
    h(2, "Page_CLI_Workbench_ResavePluginWE", "Module: WorldEditor Plugin: ResavePlugin") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [cliRow("Odd", tt("-world=ENT_FILE_PATH"), ["public", "World the plugin loads in WE."])],
    ) +
    // The page prints the plugin's display name here, not its class.
    h(2, "Page_CLI_Workbench_Shore", "Module: ResourceManager Plugin: Shore") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [cliRow("Odd", tt("-shore=NAME"), ["public", "Names the shore map."])],
    ) +
    // A class that is no plugin, and a name nothing in the source answers to.
    h(2, "Page_CLI_Workbench_NotAPlugin", "Module: ResourceManager Plugin: NotAPlugin") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [cliRow("Odd", tt("-nap"), ["public", "Belongs to a class without the attribute."])],
    ) +
    h(2, "Page_CLI_Workbench_Ghost", "Module: ResourceManager Plugin: Ghost") +
    cliTable(
      ["Parameter", "Visibility", "Description"],
      [cliRow("Odd", tt("-ghost"), ["public", "Belongs to nothing in the source."])],
    ) +
    '<table class="markdownTable">\n<tr class="markdownTableHead"><th>Extension</th><th>Note</th></tr>\n' +
    '<tr class="markdownTableRowOdd"><td>.xyz</td><td>not a switch table</td></tr>\n</table>\n',
);

/** The script sources the plugin names of the CLI page resolve against. */
const PLUGIN_SOURCES = [
  {
    path: "scripts/WorkbenchCommon/ResaveTool.c",
    text:
      '[WorkbenchPluginAttribute("Re-Save Tool", "Saves all files", "", "", {"ResourceManager"}, "", 0xf0c7)]\n' +
      "class ResavePlugin: WorkbenchPlugin\n{\n}\n",
  },
  {
    // Named arguments in a different order; the page prints "Shore", the display name.
    path: "scripts/WorkbenchCommon/ShoreTool.c",
    text:
      '[WorkbenchPluginAttribute(description: "Builds a shore map, then exits", name: "Shore")]\n' +
      "class ShoreTool: WorkbenchPlugin\n{\n}\n",
  },
  {
    path: "scripts/WorkbenchCommon/NotAPlugin.c",
    text: "class NotAPlugin: WorkbenchPlugin\n{\n}\n",
  },
];

function pluginIndex(): SourceIndex {
  return buildSourceIndex(PLUGIN_SOURCES, { build: "1.0.0.1" });
}

const FUNCTIONS_LIST =
  `<p>Following list contains all the built-in function you can use in the ${tt("APIFunc")}.</p>\n<ul>\n` +
  `<li><b>OpenResource</b><ul>\n<li>required parameters for input: ${fragment(
    "{",
    '    "APIFunc": "OpenResource",',
    '    "ResourceName": "string", // name of a resource file to open in Workbench',
    "}",
  )}</li>\n<li>response: ${fragment("{", '    "Opened": "bool", // result of the operation', "}")}</li>\n</ul>\n</li>\n` +
  `<li><b>IsWorkbenchRunning</b><ul>\n<li>required parameters for input: ${fragment(
    "{",
    '    "APIFunc": "IsWorkbenchRunning",',
    "}",
  )}</li>\n<li>response: ${fragment(
    "{",
    '    "IsRunning": "bool", // is workbench running',
    '    "ScriptsCompiled": "bool", // are scripts compiled successfully',
    "}",
  )}</li>\n</ul>\n</li>\n` +
  `<li><b>ValidateScripts</b><ul>\n<li>required parameters for input: ${fragment(
    "{",
    '    "APIFunc": "ValidateScripts",',
    '    "Configuration": "string", // script configuration to validate',
    "}",
  )}</li>\n<li>response: ${fragment(
    "{",
    "  // array of errors",
    '  "Errors": [',
    "    {",
    '      "error": "Incompatible parameter \'b\'", // text of error',
    '      "fileAbs": "F:\\\\DATA\\\\scripts\\\\Game\\\\game.c", // optional',
    '      "line": 147 // position in file where error occurs',
    "    }",
    "  ],",
    '  "Success": false',
    "}",
  )}</li>\n</ul>\n</li>\n` +
  `<li><b>ReloadScripts</b><ul>\n<li>required parameters for input: ${fragment(
    "{",
    '    "APIFunc": "ReloadScripts",',
    "}",
  )}</li>\n<li>response: ${fragment("{", '    // none, error code indicates the result ("Ok" on success)', "}")}</li>\n</ul>\n</li>\n` +
  `<li><b>EvaluateScript</b><ul>\n<li>required parameters for input: ${fragment(
    "{",
    '    "APIFunc": "EvaluateScript",',
    '    "Script": "string", // Enforce Script source code to evaluate, argument-less function declaration is expected as entry point',
    "}",
  )}</li>\n<li>response: ${fragment("{", '    "ReturnValue": "string", // return value of the entry point', "}")}</li>\n</ul>\n</li>\n</ul>\n`;

const EXAMPLE_SCRIPT = fragment(
  "class ExampleRequest : JsonApiStruct",
  "{",
  "    string input; // text of the call",
  " ",
  "    void ExampleRequest()",
  "    {",
  '        RegV("input");',
  "    }",
  "}",
  " ",
  "class ExampleResponse : JsonApiStruct",
  "{",
  "    string output;",
  "    int unregistered;",
  "    ",
  "    void ExampleResponse()",
  "    {",
  '        RegV("output");',
  "    }",
  "}",
  " ",
  "// Class that is being called",
  "class ExampleCall : NetApiHandler",
  "{",
  "    override JsonApiStruct GetRequest()",
  "    {",
  "        return new ExampleRequest();",
  "    }",
  " ",
  "    override JsonApiStruct GetResponse(JsonApiStruct request)",
  "    {",
  "        ExampleRequest req = ExampleRequest.Cast(request);",
  "        ExampleResponse response = new ExampleResponse();",
  "        return response;",
  "    }",
  "}",
);

const NET_PAGE = page(
  "Enfusion Script API: Workbench NET API",
  h(1, "Page_NetApiDocs_About", "About") +
    "<p>Protocol text.</p>" +
    h(3, "Page_NetApiDocs_RequestPayload", "Payload format") +
    FUNCTIONS_LIST +
    h(2, "Page_NetApiDocs_Response", "Response") +
    h(1, "Page_NetApiDocs_CustomEndpoint", "Custom endpoint") +
    h(2, "Page_NetApiDocs_ExampleScript", "Example script") +
    EXAMPLE_SCRIPT,
);

const MENU_PAGE = page(
  "Enfusion Script API: Menu System",
  h(1, "MenuSystem_Description", "Description") +
    "<p>MenuManager handles creation, opening, closing and updating of game menus.</p>",
);

const INPUT_PAGE = page(
  "Enfusion Script API: Input System",
  h(1, "InputSystem_Description", "Description") +
    cliTable(
      ["Name", "Description", "Priority", "Flags"],
      [cliRow("Odd", "CharacterLookContext", ["mouse look", "1", ""])],
    ),
);

function docsTree(extra: Record<string, string> = {}): { tools: string; docs: string } {
  const tools = mkdtempSync(join(tmpdir(), "e08-tools-"));
  const docs = join(tools, "Workbench", "docs");
  const files: Record<string, string> = {
    "EnfusionScriptAPI/html/Page_CLI.html": CLI_PAGE,
    "EnfusionScriptAPI/html/Page_NetApi.html": NET_PAGE,
    "EnfusionScriptAPI/html/Page_Menu.html": MENU_PAGE,
    "EnfusionScriptAPI/html/Page_Input.html": INPUT_PAGE,
    "EnfusionScriptAPI/html/Page_Brand_New.html": page("New", "<p>nothing</p>"),
    "EnfusionScriptAPI/html/interfaceFoo.html": page("Foo", "<p>class page</p>"),
    "EnfusionScriptAPI/html/EnfusionTheme/header.html": "<div>header</div>",
    "ArmaReforgerScriptAPIPublic/html/interfaceBar.html": page("Bar", "<p>class page</p>"),
    "ArmaReforgerScriptAPIPublic/html/classBaz.html": page("Baz", "<p>class page</p>"),
    "ArmaReforgerScriptAPIPublic/html/style.css": "body {}",
    ...extra,
  };
  for (const [rel, text] of Object.entries(files)) {
    const file = join(docs, rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return { tools, docs };
}

// ── Text helpers ──────────────────────────────────────────────────────────────

describe("e08 html text helpers", () => {
  it("decodes entities, strips tags and collapses whitespace", () => {
    expect(decodeEntities("a&lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &#x41;")).toBe(
      "a<b> & \"c\" 'd' A",
    );
    expect(htmlText('<span class="tt">-a</span>  <em>N/A</em>\n<!-- x -->b')).toBe("-a N/A b");
    expect(htmlText("x&nbsp;y &ndash; z")).toBe("x y \u2013 z");
  });

  it("reads page ids, tables with the anchor above them, and the title", () => {
    expect(pageIds(CLI_PAGE).has("Page_CLI_Workbench_WorkbenchParams")).toBe(true);
    const tables = parseTables(CLI_PAGE);
    expect(tables).toHaveLength(10);
    expect(tables[0].anchor).toBe("Page_CLI_Common_FilePaths");
    expect(tables[0].heading).toBe("File Paths");
    expect(tables[0].header).toEqual([
      "Parameter",
      "Visibility",
      "Possible values / Default",
      "Description",
    ]);
    expect(tables[0].rows).toHaveLength(5);
    expect(tables[1].anchor).toBe("Page_CLI_Workbench_WorkbenchParams");
    expect(tables[2].heading).toBe("Module: ResourceManager");
    expect(tables[3].heading).toBe("Module: World Editor");
    expect(tables[4].heading).toBe("Module: ResourceManager Plugin: ResavePlugin");
    expect(tables[9].header).toEqual(["Extension", "Note"]);
  });

  it("clips a sentence at a word with a marker and cuts text before a machine path", () => {
    expect(sentenceOf("Starts it. Then more text.")).toBe("Starts it.");
    expect(sentenceOf("")).toBeUndefined();
    const long = `${"word ".repeat(60)}end.`;
    const s = sentenceOf(long) ?? "";
    expect(s.endsWith("...")).toBe(true);
    expect(Array.from(s).length).toBeLessThanOrEqual(200);
    expect(cutAtMachinePath("run -saveDir c:\\tmp\\")).toBe("run -saveDir");
    expect(cutAtMachinePath("plain text")).toBe("plain text");
    // Assembled here so no home-path literal is committed.
    const home = ["C:", "Users", "someone"].join("/");
    expect(containsMachinePath(cutAtMachinePath(`x ${home}/y`))).toBe(false);
  });
});

// ── CLI tables ────────────────────────────────────────────────────────────────

describe("e08 table scope from the heading", () => {
  it("reads the module and the plugin a heading names, and none for anything else", () => {
    expect(tableScope("Module: World Editor")).toEqual({
      module: "WorldEditor",
      plugin: undefined,
    });
    expect(tableScope("Module: ResourceManager")).toEqual({
      module: "ResourceManager",
      plugin: undefined,
    });
    expect(tableScope("Module: ResourceManager Plugin: AddonBuildInfoTool")).toEqual({
      module: "ResourceManager",
      plugin: "AddonBuildInfoTool",
    });
    expect(tableScope("Module: WorldEditor Plugin: GenerateFlowMaps")).toEqual({
      module: "WorldEditor",
      plugin: "GenerateFlowMaps",
    });
    expect(tableScope("Workbench parameters")).toEqual({ module: "none", plugin: undefined });
    expect(tableScope("Module: NoSuchModule").module).toBe("none");
    expect(tableScope("").module).toBe("none");
  });
});

describe("e08 cli-switch extraction", () => {
  it("reads four- and three-column parameter tables, forms of one switch, and skips non-switches", () => {
    const r = extractCliTables(CLI_PAGE);
    expect(r.tablesUsed).toBe(9);
    const names = r.switches.map((s) => s.name);
    expect(names).toEqual([
      "gproj",
      "window",
      "profile",
      "minidump",
      "validate",
      "gproj",
      "wbModule",
      "alpha",
      "beta",
      "build",
      "builddata",
      "weflag",
    ]);
    // The plugin tables' switches are plugin arguments, kept apart from the switches.
    expect(r.pluginArgs.map((s) => `${s.plugin}:${s.name}:${s.module}`)).toEqual([
      "ResavePlugin:extension:ResourceManager",
      "ResavePlugin:world:ResourceManager",
      "ResavePlugin:world:WorldEditor",
      "Shore:shore:ResourceManager",
      "NotAPlugin:nap:ResourceManager",
      "Ghost:ghost:ResourceManager",
    ]);
    // A switch under a "Module: X" heading carries that module (a heading with a space too).
    expect(r.switches.find((s) => s.name === "builddata")?.module).toBe("ResourceManager");
    expect(r.switches.find((s) => s.name === "weflag")?.module).toBe("WorldEditor");
    expect(r.switches.find((s) => s.name === "builddata")?.plugin).toBeUndefined();
    expect(r.switches.find((s) => s.name === "gproj")?.module).toBe("none");
    const profile = r.switches.find((s) => s.name === "profile");
    expect(profile?.usage).toBe("-profile RELATIVE_PATH / -profile ABSOLUTE_PATH");
    expect(profile?.visibility).toBe("public");
    expect(r.switches.find((s) => s.name === "minidump")?.visibility).toBe("ENF_DEVELOPER");
    expect(r.switches.find((s) => s.name === "validate")?.usage).toBe(
      "-validate[=CONFIGURATION_NAME]",
    );
    expect(r.switches.find((s) => s.name === "wbModule")?.description).toContain("ResourceManager");
    expect(r.switches.find((s) => s.name === "wbModule")?.anchor).toBe(
      "Page_CLI_Workbench_WorkbenchParams",
    );
    expect(r.skipped).toEqual([
      { reason: "parameter cell is not a switch", text: "no params needed" },
    ]);
  });
});

// ── Plugin class resolution ───────────────────────────────────────────────────

describe("e08 plugin name to script class", () => {
  it("reads the name argument, named or leading positional, not other strings", () => {
    expect(pluginDisplayName('"Re-Save Tool", "Saves all files", "", ""')).toBe("Re-Save Tool");
    expect(pluginDisplayName('description: "x, y", name: "Shore", wbModules: { "A", "B" }')).toBe(
      "Shore",
    );
    expect(pluginDisplayName('name: "Say \\"hi\\"", description: "d"')).toBe('Say \\"hi\\"');
    // A positional string that is not first is not the name.
    expect(pluginDisplayName('0xF188, "late"')).toBeUndefined();
    expect(pluginDisplayName(undefined)).toBeUndefined();
    expect(pluginDisplayName("")).toBeUndefined();
  });

  it("resolves by class name first, then by display name, and says why not otherwise", () => {
    const ix = pluginIndex();
    expect(resolvePluginClass(ix, "ResavePlugin")).toEqual({
      class: "ResavePlugin",
      how: "class-name",
    });
    expect(resolvePluginClass(ix, "Re-Save Tool")).toEqual({
      class: "ResavePlugin",
      how: "display-name",
    });
    expect(resolvePluginClass(ix, "Shore")).toEqual({ class: "ShoreTool", how: "display-name" });
    expect(resolvePluginClass(ix, "NotAPlugin")).toEqual({
      reason: "class NotAPlugin exists but carries no WorkbenchPluginAttribute",
    });
    expect(resolvePluginClass(ix, "Ghost")).toEqual({
      reason: "no class named Ghost and no WorkbenchPluginAttribute with that name",
    });
  });

  it("does not guess between two plugins that share a display name", () => {
    const ix = buildSourceIndex(
      [
        {
          path: "scripts/WorkbenchCommon/Twins.c",
          text:
            '[WorkbenchPluginAttribute("Twin")]\nclass TwinB: WorkbenchPlugin\n{\n}\n' +
            '[WorkbenchPluginAttribute(name: "Twin")]\nclass TwinA: WorkbenchPlugin\n{\n}\n',
        },
      ],
      { build: "1.0.0.1" },
    );
    expect(resolvePluginClass(ix, "Twin")).toEqual({
      reason: 'ambiguous: 2 plugin classes carry the name "Twin" (TwinA, TwinB)',
    });
  });
});

// ── NET API page ──────────────────────────────────────────────────────────────

describe("e08 net extraction", () => {
  it("reads nested fields of a JSON-with-comments example", () => {
    const fields = parseJsonish([
      "{",
      '  "APIFunc": "X",',
      '  "Errors": [',
      "    {",
      '      "error": "text", // text of error',
      '      "line": 147',
      "    }",
      "  ],",
      '  "Success": false',
      "}",
    ]);
    expect(fields.map((f) => `${f.parent ?? ""}/${f.name}`)).toEqual([
      "/APIFunc",
      "/Errors",
      "Errors/error",
      "Errors/line",
      "/Success",
    ]);
    expect(fields[0].type).toBe("X");
    expect(fields[1].type).toBe("[]");
    expect(fields[2].comment).toBe("text of error");
    expect(fields[4].type).toBeUndefined();
    // A bare value is kept as the page wrote it, not turned into a type.
    expect(fields[4].example).toBe("false");
    expect(fields[3].example).toBe("147");
  });

  it("reads the built-in functions with their request and response fields and a contiguous quote", () => {
    const fns = extractNetFunctions(NET_PAGE);
    expect(fns.map((f) => f.name)).toEqual([
      "OpenResource",
      "IsWorkbenchRunning",
      "ValidateScripts",
      "ReloadScripts",
      "EvaluateScript",
    ]);
    expect(fns.every((f) => f.anchor === "Page_NetApiDocs_RequestPayload")).toBe(true);
    const open = fns[0];
    expect(open.request.map((f) => f.name)).toEqual(["ResourceName"]);
    expect(open.response.map((f) => f.name)).toEqual(["Opened"]);
    expect(open.quoteLine).toBe(
      '"APIFunc": "OpenResource", "ResourceName": "string", // name of a resource file to open in Workbench',
    );
    // No comment in the request: the quote runs from the name through the response's first comment.
    expect(fns[1].quoteLine).toBe(
      'IsWorkbenchRunning required parameters for input: { "APIFunc": "IsWorkbenchRunning", } response: { "IsRunning": "bool", // is workbench running',
    );
    expect(fns[2].response.filter((f) => !f.parent).map((f) => f.name)).toEqual([
      "Errors",
      "Success",
    ]);
    expect(fns[2].response.filter((f) => f.parent === "Errors").map((f) => f.name)).toEqual([
      "error",
      "fileAbs",
      "line",
    ]);
    const evaluate = fns[4];
    expect(evaluate.quoteLine).toContain(
      "argument-less function declaration is expected as entry point",
    );
    // The quote is a stretch of the page's own text.
    for (const f of fns) expect(htmlText(NET_PAGE)).toContain(f.quoteLine);
  });

  it("reads the example handler, its request and response structs and their registered fields", () => {
    const ex = extractNetExample(NET_PAGE);
    expect(ex).toBeDefined();
    expect(ex?.handler).toBe("ExampleCall");
    expect(ex?.handlerBase).toBe("NetApiHandler");
    expect(ex?.comment).toBe("Class that is being called");
    expect(ex?.requestClass).toBe("ExampleRequest");
    expect(ex?.responseClass).toBe("ExampleResponse");
    expect(ex?.requestFields).toEqual([{ name: "input", type: "string" }]);
    // `unregistered` is declared but never passed to RegV: it is not a JSON field.
    expect(ex?.responseFields).toEqual([{ name: "output", type: "string" }]);
    expect(ex?.anchor).toBe("Page_NetApiDocs_ExampleScript");
  });

  it("leaves the handler's comment out when no comment line sits directly above the class", () => {
    const bare = NET_PAGE.replace(/<div class="line">\/\/ Class that is being called<\/div>\n/, "");
    expect(bare).not.toBe(NET_PAGE);
    expect(extractNetExample(bare)?.comment).toBeUndefined();
    expect(extractNetExample(bare)?.handler).toBe("ExampleCall");
  });

  it("finds nothing on a page without the function list or the example", () => {
    expect(extractNetFunctions(CLI_PAGE)).toEqual([]);
    expect(extractNetExample(CLI_PAGE)).toBeUndefined();
  });
});

// ── Import ────────────────────────────────────────────────────────────────────

describe("e08 import of a synthetic docs tree", () => {
  const { docs } = docsTree();
  const INDEX_INPUT = {
    path: "<artifacts>/census/1.0.0.1/E02/source-index.jsonl",
    sha256: "0".repeat(64),
  };
  const result = importDocs(docs, { index: pluginIndex(), input: INDEX_INPUT });

  it("counts every .html by directory and the Page_ files among them", () => {
    expect(result.inventory).toEqual([
      { dir: "ArmaReforgerScriptAPIPublic/html", html: 2, pages: 0 },
      { dir: "EnfusionScriptAPI/html", html: 6, pages: 5 },
      { dir: "EnfusionScriptAPI/html/EnfusionTheme", html: 1, pages: 0 },
    ]);
    expect(result.pages.map((p) => p.file.split("/").pop())).toEqual([
      "Page_Brand_New.html",
      "Page_CLI.html",
      "Page_Input.html",
      "Page_Menu.html",
      "Page_NetApi.html",
    ]);
    // Five pages, then the source index the plugin names were resolved against.
    expect(result.inputs).toHaveLength(6);
    expect(
      result.inputs
        .slice(0, 5)
        .every(
          (i) =>
            /^<tools>\/Workbench\/docs\/.+\.html$/.test(i.path) && /^[0-9a-f]{64}$/.test(i.sha256),
        ),
    ).toBe(true);
    expect(result.inputs[5]).toEqual(INDEX_INPUT);
  });

  it("emits cli-switch rows, one per distinct switch, with the first occurrence kept", () => {
    const cli = result.observations.filter((o) => o.obs.kind === "cli-switch");
    // Ids fold case (DEC-022); the label keeps the spelling the page uses.
    expect(cli.map((o) => o.id)).toEqual([
      "cli:-alpha",
      "cli:-beta",
      "cli:-build",
      "cli:-builddata",
      "cli:-gproj",
      "cli:-minidump",
      "cli:-profile",
      "cli:-validate",
      "cli:-wbmodule",
      "cli:-weflag",
      "cli:-window",
    ]);
    expect(cli.find((o) => o.id === "cli:-wbmodule")?.obs.label).toBe("-wbModule");
    const gproj = cli.find((o) => o.id === "cli:-gproj")?.obs;
    expect(gproj?.ref).toBe(
      "<tools>/Workbench/docs/EnfusionScriptAPI/html/Page_CLI.html#Page_CLI_Common_FilePaths",
    );
    expect(gproj?.signature).toBe("-gproj FILE_FULL_PATH");
    expect(gproj?.what).toBe("Full path to the game project file.");
    expect(gproj?.parent_key).toBeNull();
    expect(gproj?.module).toBe("none");
    expect(gproj?.confidence).toBe("high");
    expect(gproj?.paths_proposed).toEqual([{ path: "cli" }]);
    expect(gproj?.quote).toBe(
      "-gproj FILE_FULL_PATH public Full path to the game project file. The path may be relative.",
    );
    expect(
      result.dropped.some(
        (d) => /cli:-gproj/.test(d.reason) && /first occurrence is kept/.test(d.reason),
      ),
    ).toBe(true);
    expect(result.dropped.some((d) => d.reason === "parameter cell is not a switch")).toBe(true);
  });

  it("carries the module a Module: X heading names, and none under any other heading", () => {
    const cli = result.observations.filter((o) => o.obs.kind === "cli-switch");
    const moduleOf = (id: string) => cli.find((o) => o.id === id)?.obs.module;
    expect(moduleOf("cli:-builddata")).toBe("ResourceManager");
    expect(moduleOf("cli:-weflag")).toBe("WorldEditor");
    expect(moduleOf("cli:-gproj")).toBe("none");
    expect(moduleOf("cli:-wbmodule")).toBe("none");
    expect(moduleOf("cli:-build")).toBe("none");
    expect(cli.filter((o) => o.obs.module !== "none").map((o) => o.id)).toEqual([
      "cli:-builddata",
      "cli:-weflag",
    ]);
  });

  it("emits plugin-cli-arg rows keyed by the script class, once per class and argument", () => {
    const rows = result.observations.filter((o) => o.obs.kind === "plugin-cli-arg");
    // Ids carry one leading dash and the name in lower case; the key keeps the name as the page prints it.
    expect(rows.map((o) => o.id)).toEqual([
      "plugin:ResavePlugin#cli:-extension",
      "plugin:ResavePlugin#cli:-world",
      // The page prints the display name "Shore"; the row is keyed by the class.
      "plugin:ShoreTool#cli:-shore",
    ]);
    const get = (id: string) => rows.find((o) => o.id === id)?.obs;
    const extension = get("plugin:ResavePlugin#cli:-extension");
    // Module `none`, on the row and on its parent: the "Module: ResourceManager" heading above
    // the table is the module a launch names with -wbModule, not the plugin's own module (E03's).
    expect(extension).toMatchObject({
      dim: "plugin",
      kind: "plugin-cli-arg",
      module: "none",
      key: { class: "ResavePlugin", cli: "extension" },
      parent_key: {
        dim: "plugin",
        kind: "plugin",
        module: "none",
        key: { class: "ResavePlugin" },
      },
      label: "-extension",
      signature: "-extension=layout",
      origin: "vanilla",
      confidence: "high",
      ref: "<tools>/Workbench/docs/EnfusionScriptAPI/html/Page_CLI.html#Page_CLI_Workbench_ResavePlugin",
      what: "Resaves files with this extension.",
    });
    expect(extension?.unverified).toBeUndefined();
    expect(extension?.risk_hint).toBeUndefined();
    expect(extension?.paths_proposed).toBeUndefined();
    // The plugin's -world is its own row, not the engine switch of the same name.
    const all = result.observations.map((o) => o.id);
    expect(all).toContain("cli:-gproj");
    expect(all).not.toContain("cli:-world");
    expect(all).not.toContain("cli:-extension");
    expect(get("plugin:ShoreTool#cli:-shore")?.key).toEqual({ class: "ShoreTool", cli: "shore" });
    expect(get("plugin:ShoreTool#cli:-shore")?.parent_key?.key).toEqual({ class: "ShoreTool" });
    for (const o of rows) {
      expect(o.obs.module).toBe("none");
      expect(o.obs.parent_key?.module).toBe("none");
    }
    expect(result.pages.find((p) => p.file.endsWith("Page_CLI.html"))?.pluginArgs).toBe(6);
  });

  it("keeps the first table's row of an argument documented under two modules and says so", () => {
    const world = result.observations.find((o) => o.id === "plugin:ResavePlugin#cli:-world")?.obs;
    // The module of the heading no longer shows on the row; the kept table shows in the ref.
    expect(world?.module).toBe("none");
    expect(world?.ref).toMatch(/#Page_CLI_Workbench_ResavePlugin$/);
    expect(world?.unverified).toEqual([
      "the page documents this argument of ResavePlugin under module WorldEditor as well; the first table is kept",
    ]);
    expect(
      result.dropped.some(
        (d) =>
          d.reason.includes("(plugin:ResavePlugin#cli:-world)") &&
          /first occurrence is kept/.test(d.reason),
      ),
    ).toBe(true);
  });

  it("leaves out the arguments of a plugin that does not resolve, and lists them with the plugin", () => {
    const ids = result.observations.map((o) => o.id);
    expect(ids.filter((i) => /nap|ghost/.test(i))).toEqual([]);
    const left = result.dropped.filter((d) => /^plugin argument of .* left out/.test(d.reason));
    expect(left.map((d) => d.reason)).toEqual([
      "plugin argument of NotAPlugin left out, plugin does not resolve to a script class (class NotAPlugin exists but carries no WorkbenchPluginAttribute): -nap",
      "plugin argument of Ghost left out, plugin does not resolve to a script class (no class named Ghost and no WorkbenchPluginAttribute with that name): -ghost",
    ]);
    expect(result.plugins).toEqual([
      { plugin: "ResavePlugin", args: 3, class: "ResavePlugin", how: "class-name" },
      { plugin: "Shore", args: 1, class: "ShoreTool", how: "display-name" },
      {
        plugin: "NotAPlugin",
        args: 1,
        reason: "class NotAPlugin exists but carries no WorkbenchPluginAttribute",
      },
      {
        plugin: "Ghost",
        args: 1,
        reason: "no class named Ghost and no WorkbenchPluginAttribute with that name",
      },
    ]);
  });

  it("emits no plugin-cli-arg row and no index input when there is no source index", () => {
    const bare = importDocs(docs);
    expect(bare.observations.filter((o) => o.obs.kind === "plugin-cli-arg")).toEqual([]);
    expect(bare.inputs).toHaveLength(5);
    expect(bare.plugins.every((p) => !p.class && /no source index/.test(p.reason ?? ""))).toBe(
      true,
    );
    expect(bare.dropped.filter((d) => /left out/.test(d.reason))).toHaveLength(6);
    // The switch rows do not depend on the index.
    expect(bare.observations.filter((o) => o.obs.kind === "cli-switch")).toEqual(
      result.observations.filter((o) => o.obs.kind === "cli-switch"),
    );
  });

  it("cuts a quote before a machine path instead of dropping the row", () => {
    const build = result.observations.find((o) => o.id === "cli:-build")?.obs;
    expect(build?.quote).toBe("-build Build tables. Example: -wbmodule=X -build -saveDir");
    expect(containsMachinePath(JSON.stringify(build))).toBe(false);
  });

  it("emits native functions with the fields in the signature, and the example handler with its two fields", () => {
    const net = result.observations.filter((o) => o.obs.dim === "net").map((o) => o.id);
    expect(net).toEqual([
      "net:handler/ExampleCall",
      "net:handler/ExampleCall#req:input",
      "net:handler/ExampleCall#resp:output",
      "net:native/EvaluateScript",
      "net:native/IsWorkbenchRunning",
      "net:native/OpenResource",
      "net:native/ReloadScripts",
      "net:native/ValidateScripts",
    ]);
    const get = (id: string) => result.observations.find((o) => o.id === id)?.obs;
    expect(get("net:native/OpenResource")?.signature).toBe(
      "OpenResource(ResourceName: string) -> {Opened: bool}",
    );
    expect(get("net:native/IsWorkbenchRunning")?.signature).toBe(
      "IsWorkbenchRunning() -> {IsRunning: bool, ScriptsCompiled: bool}",
    );
    expect(get("net:native/ValidateScripts")?.signature).toBe(
      "ValidateScripts(Configuration: string) -> {Errors: [], Success: false}",
    );
    expect(get("net:native/EvaluateScript")?.quote).toContain("argument-less function declaration");
    expect(get("net:native/EvaluateScript")?.ref).toBe(
      "<tools>/Workbench/docs/EnfusionScriptAPI/html/Page_NetApi.html#Page_NetApiDocs_RequestPayload",
    );
    const handler = get("net:handler/ExampleCall");
    expect(handler?.children_count).toBe(2);
    expect(handler?.confidence).toBe("medium");
    expect(handler?.what).toBe("Class that is being called");
    expect(handler?.unverified).toHaveLength(1);
    expect(get("net:handler/ExampleCall#req:input")?.parent_key).toEqual({
      dim: "net",
      kind: "net-handler",
      module: "none",
      key: { handler: "ExampleCall" },
    });
  });

  it("reports pages that yield nothing with the reason, and unread tables", () => {
    const by = (name: string) => result.pages.find((p) => p.file.endsWith(name));
    expect(by("Page_Menu.html")?.rows).toBe(0);
    expect(by("Page_Menu.html")?.reason).toContain("not Workbench menus");
    expect(by("Page_Input.html")?.rows).toBe(0);
    expect(by("Page_Input.html")?.reason).toContain("not Workbench shortcuts");
    expect(by("Page_Input.html")?.unreadTables).toEqual(["Name | Description | Priority | Flags"]);
    expect(by("Page_Brand_New.html")?.content).toBe("unclassified");
    expect(by("Page_Brand_New.html")?.reason).toContain("unclassified");
    expect(by("Page_CLI.html")?.tablesUsed).toBe(9);
    expect(by("Page_CLI.html")?.unreadTables).toEqual(["Extension | Note"]);
    expect(by("Page_CLI.html")?.unreadRows).toEqual([1]);
    expect(by("Page_Input.html")?.unreadRows).toEqual([1]);
    expect(by("Page_CLI.html")?.rows).toBe(14);
    expect(by("Page_NetApi.html")?.rows).toBe(8);
  });

  it("holds every row to the schema, an id of its own, a ref anchor in the page and the 200 character cap", () => {
    for (const { id, obs } of result.observations) {
      expect(observationSchema.safeParse(obs).success).toBe(true);
      expect(deriveId(obs)).toBe(id);
      expect(obs.origin).toBe("vanilla");
      const m = /^<tools>\/Workbench\/docs\/([^#]+)#(.+)$/.exec(obs.ref);
      expect(m).not.toBeNull();
      const html = readFileSync(join(docs, m![1]), "utf-8");
      expect(pageIds(html).has(m![2])).toBe(true);
      expect(Array.from(obs.quote ?? "").length).toBeLessThanOrEqual(200);
      expect(Array.from(obs.what ?? "").length).toBeLessThanOrEqual(200);
    }
    expect(result.observations.map((o) => o.id)).toEqual(
      [...result.observations.map((o) => o.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });

  it("writes a header whose row_count matches, and is byte-identical on a second read", () => {
    const text = observationFileText(result, "1.0.0.1");
    const lines = text.trimEnd().split("\n");
    const header = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(header).toMatchObject({
      $header: 1,
      build: "1.0.0.1",
      enumerator: "E08",
      generator: "scripts/census/enumerators/e08-shipped-docs.ts",
      provisional: false,
      row_count: result.observations.length,
    });
    expect(lines).toHaveLength(result.observations.length + 1);
    expect(text.endsWith("\n")).toBe(true);
    expect(
      observationFileText(
        importDocs(docs, { index: pluginIndex(), input: INDEX_INPUT }),
        "1.0.0.1",
      ),
    ).toBe(text);
  });

  it("reads inventory counts from a bare list of paths", () => {
    expect(inventoryOf(["a/Page_X.html", "a/b.html", "c.html"])).toEqual([
      { dir: ".", html: 1, pages: 0 },
      { dir: "a", html: 2, pages: 1 },
    ]);
  });
});

// ── CLI run and ledger acceptance ─────────────────────────────────────────────

/** The synthetic plugin index saved as a file, for `--source-index`. */
function writeIndexFile(): string {
  const file = join(mkdtempSync(join(tmpdir(), "e08-index-")), "source-index.jsonl");
  saveSourceIndex(pluginIndex(), { file });
  return file;
}

describe("e08 run and the ledger", () => {
  it("answers NO DATA when the Tools docs directory is absent", () => {
    const fx = makeCensus("1.0.0.1");
    const empty = mkdtempSync(join(tmpdir(), "e08-empty-"));
    const r = runIn(fx, run, ["--tools", empty]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
    expect(existsSync(join(fx.root, "observations", "E08"))).toBe(false);
  });

  it("refuses an output path outside observations/E08", () => {
    const fx = makeCensus("1.0.0.1");
    const { tools } = docsTree();
    const r = runIn(fx, run, [
      "--tools",
      tools,
      "--out",
      join(fx.root, "observations", "E01", "x.jsonl"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing --out");
    expect(() => resolveOut(fx.paths, undefined, "1.0.0.1")).not.toThrow();
  });

  it("writes only observations/E08 and builds into a ledger with no rejected line", () => {
    const fx = makeCensus("1.0.0.1");
    const { tools } = docsTree();
    const index = writeIndexFile();
    const r = runIn(fx, run, ["--tools", tools, "--source-index", index]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("E08 at build 1.0.0.1: 22 observations from 5 Page_*.html");
    expect(r.stdout).toContain("plugin Shore: class ShoreTool (by display-name), 1 argument");
    expect(r.stdout).toContain("plugin Ghost: not resolved (no class named Ghost");
    const file = join(fx.root, "observations", "E08", "1.0.0.1.jsonl");
    expect(existsSync(file)).toBe(true);
    const header = JSON.parse(readFileSync(file, "utf-8").split("\n")[0]) as {
      inputs: { path: string; sha256: string }[];
      row_count: number;
    };
    expect(header.row_count).toBe(22);
    expect(header.inputs.at(-1)).toEqual({
      path: "<artifacts>/census/1.0.0.1/E02/source-index.jsonl",
      sha256: loadIndexInput("1.0.0.1", index)?.input?.sha256,
    });
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.rows).toHaveLength(22);
    expect(built.problems.filter((p) => (p.id ?? "").match(/^(cli|net):/))).toEqual([]);
    // The plugin rows' parents are E03's: the only problem about them is the missing parent row.
    const pluginProblems = built.problems.filter((p) => (p.id ?? "").startsWith("plugin:"));
    expect(pluginProblems.length).toBeGreaterThan(0);
    expect(pluginProblems.every((p) => /parent/.test(p.message))).toBe(true);
    expect(built.rows.every((row) => row.sources.every((s) => s.enumerator === "E08"))).toBe(true);
    const handler = built.rows.find((row) => row.id === "net:handler/ExampleCall");
    expect(handler?.children_count).toBe(2);
    expect(built.rows.find((row) => row.id === "net:handler/ExampleCall#req:input")?.parent).toBe(
      "net:handler/ExampleCall",
    );
    expect(built.rows.find((row) => row.id === "plugin:ShoreTool#cli:-shore")?.parent).toBe(
      "plugin:ShoreTool",
    );
    expect(built.rows.find((row) => row.id === "plugin:ShoreTool#cli:-shore")?.module).toBe("none");
    expect(built.rows.find((row) => row.id === "cli:-builddata")?.module).toBe("ResourceManager");
    // A second run is byte-identical.
    const first = readFileSync(file, "utf-8");
    runIn(fx, run, ["--tools", tools, "--source-index", index]);
    expect(readFileSync(file, "utf-8")).toBe(first);
  });

  it("writes the rows that need no index and says so when there is none", () => {
    // A build tag no artifacts folder holds an index for.
    const fx = makeCensus("0.0.0.7");
    const { tools } = docsTree();
    const r = runIn(fx, run, ["--tools", tools]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("no source index for build 0.0.0.7");
    expect(r.stdout).toContain("E08 at build 0.0.0.7: 19 observations");
    const text = readFileSync(join(fx.root, "observations", "E08", "0.0.0.7.jsonl"), "utf-8");
    expect(text).not.toContain('"plugin-cli-arg"');
    expect(text).not.toContain("source-index.jsonl");
  });

  it("prints json with the page report and the plugin resolutions when asked", () => {
    const fx = makeCensus("1.0.0.1");
    const { tools } = docsTree();
    const r = runIn(fx, run, ["--tools", tools, "--source-index", writeIndexFile(), "--json"]);
    const out = JSON.parse(r.stdout) as {
      page_files: number;
      emitted: number;
      by_kind: Record<string, number>;
      plugins: { plugin: string; class?: string }[];
    };
    expect(out.page_files).toBe(5);
    expect(out.emitted).toBe(22);
    expect(out.by_kind).toEqual({
      "cli-switch": 11,
      "net-field": 2,
      "net-function": 5,
      "net-handler": 1,
      "plugin-cli-arg": 3,
    });
    expect(out.plugins.map((p) => `${p.plugin}=${p.class ?? "-"}`)).toEqual([
      "ResavePlugin=ResavePlugin",
      "Shore=ShoreTool",
      "NotAPlugin=-",
      "Ghost=-",
    ]);
  });
});

// ── The real install ──────────────────────────────────────────────────────────

const REAL_DOCS = join(loadConfig().workbenchPath, "Workbench", "docs");

/** Whitespace-free, tag-free page text by a second, simpler route than `htmlText`. */
function crudeText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
}

/** The E02 source index of the real build, when the artifacts folder holds it. */
function realIndexInput(): SourceIndexInput | undefined {
  try {
    return loadIndexInput("1.8.0.13");
  } catch {
    return undefined;
  }
}
const REAL_INDEX = existsSync(REAL_DOCS) ? realIndexInput() : undefined;

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !existsSync(REAL_DOCS) || REAL_INDEX === undefined)(
  "e08 against the installed Tools docs and the E02 source index (build 1.8.0.13)",
  () => {
    let real!: ImportResult;
    beforeAll(() => {
      real = importDocs(REAL_DOCS, REAL_INDEX);
    });
    const count = (kind: string) => real.observations.filter((o) => o.obs.kind === kind).length;

    it("finds the 23 Page_*.html files and the other html by directory", () => {
      expect(real.pages).toHaveLength(23);
      expect(real.inventory).toEqual([
        { dir: "ArmaReforgerScriptAPIPublic/html", html: 15688, pages: 0 },
        { dir: "ArmaReforgerScriptAPIPublic/html/EnfusionTheme", html: 2, pages: 0 },
        { dir: "EnfusionScriptAPI/html", html: 2050, pages: 23 },
        { dir: "EnfusionScriptAPI/html/EnfusionTheme", html: 2, pages: 0 },
      ]);
      // 23 pages, then the source index the plugin names resolved against.
      expect(real.inputs).toHaveLength(24);
      expect(real.inputs.at(-1)?.path).toBe("<artifacts>/census/1.8.0.13/E02/source-index.jsonl");
      // Every page is one this enumerator has classified; a new page in a later build shows as unclassified.
      expect(real.pages.filter((p) => p.content === "unclassified")).toEqual([]);
      expect(real.pages.map((p) => p.file.split("/").pop()).sort()).toEqual(
        Object.keys(PAGE_CONTENT).sort(),
      );
    });

    it("yields rows from two pages only: the CLI page and the NET API page", () => {
      const withRows = real.pages
        .filter((p) => p.rows > 0)
        .map((p) => `${p.file.split("/").pop()}=${p.rows}`);
      expect(withRows).toEqual(["Page_CLI.html=142", "Page_NetApi.html=10"]);
      expect(real.pages.filter((p) => p.rows === 0)).toHaveLength(21);
      expect(real.pages.filter((p) => p.rows === 0).every((p) => (p.reason ?? "").length > 0)).toBe(
        true,
      );
      for (const name of ["Page_Menu.html", "Page_Input.html"]) {
        const p = real.pages.find((x) => x.file.endsWith(name));
        expect(p?.rows).toBe(0);
        expect(p?.tablesUsed).toBe(0);
      }
    });

    it("counts the rows by kind", () => {
      expect(real.observations).toHaveLength(152);
      expect(count("cli-switch")).toBe(129);
      expect(count("plugin-cli-arg")).toBe(13);
      expect(count("net-function")).toBe(7);
      expect(count("net-handler")).toBe(1);
      expect(count("net-field")).toBe(2);
      expect(count("menu") + count("menu-item") + count("shortcut")).toBe(0);
      // 146 table rows on the CLI page, 145 switch occurrences: 131 switch and 14 plugin
      // argument occurrences. 129 switches kept (gproj and saveDir repeat an earlier one) and
      // 13 plugin arguments kept (GenerateFlowMaps -world is documented under two modules).
      expect(real.dropped.filter((d) => /first occurrence is kept/.test(d.reason))).toHaveLength(3);
      expect(real.dropped.filter((d) => /^plugin argument of/.test(d.reason))).toHaveLength(0);
      expect(
        real.dropped.filter((d) => d.reason === "parameter cell is not a switch"),
      ).toHaveLength(1);
      expect(real.dropped).toHaveLength(4);
      expect(real.pages.find((p) => p.file.endsWith("Page_CLI.html"))?.pluginArgs).toBe(14);
    });

    it("carries the module of a Module: X heading on 29 cli-switch rows and none on the rest", () => {
      const byModule = new Map<string, number>();
      for (const o of real.observations.filter((x) => x.obs.kind === "cli-switch")) {
        byModule.set(o.obs.module, (byModule.get(o.obs.module) ?? 0) + 1);
      }
      expect(Object.fromEntries([...byModule].sort(([a], [b]) => (a < b ? -1 : 1)))).toEqual({
        LocalizationEditor: 1,
        NavmeshGeneratorMain: 4,
        ResourceManager: 22,
        ScriptEditor: 1,
        WorldEditor: 1,
        none: 100,
      });
      const byId = (id: string) => real.observations.find((o) => o.id === id)?.obs;
      expect(byId("cli:-builddata")?.module).toBe("ResourceManager");
      expect(byId("cli:-validate")?.module).toBe("ScriptEditor");
      expect(byId("cli:-gproj")?.module).toBe("none");
    });

    it("emits the 13 plugin arguments keyed by script class, each resolved by class name, module none", () => {
      const rows = real.observations
        .filter((o) => o.obs.kind === "plugin-cli-arg")
        .map((o) => `${o.id}=${o.obs.module}`);
      // Ids: one leading dash, name in lower case. Module none on every row: the page's
      // "Module: X" heading is the module a launch names with -wbModule, not the plugin's own.
      expect(rows).toEqual([
        "plugin:AddonBuildInfoTool#cli:-addonpath=none",
        "plugin:AddonBuildInfoTool#cli:-ciinfodst=none",
        "plugin:BuildShoreMap#cli:-world=none",
        "plugin:GenerateFlowMaps#cli:-exitafter=none",
        "plugin:GenerateFlowMaps#cli:-forcesaveall=none",
        "plugin:GenerateFlowMaps#cli:-world=none",
        "plugin:ResavePlugin#cli:-extension=none",
        "plugin:ResourceProcessorPlugin#cli:-filetypes=none",
        "plugin:ResourceProcessorPlugin#cli:-pathcontains=none",
        "plugin:ResourceProcessorPlugin#cli:-pathendswith=none",
        "plugin:ResourceProcessorPlugin#cli:-pathstartswith=none",
        "plugin:WorldDataExport#cli:-savedir=none",
        "plugin:WorldDataExport#cli:-type=none",
      ]);
      // The key keeps the name as the page prints it; only the id folds case.
      const keyOf = (id: string) => real.observations.find((o) => o.id === id)?.obs.key.cli;
      expect(keyOf("plugin:AddonBuildInfoTool#cli:-addonpath")).toBe("addonPath");
      expect(keyOf("plugin:ResourceProcessorPlugin#cli:-pathstartswith")).toBe("PathStartsWith");
      expect(keyOf("plugin:WorldDataExport#cli:-savedir")).toBe("saveDir");
      expect(real.plugins.map((p) => `${p.plugin}=${p.class}:${p.how}`)).toEqual([
        "GenerateFlowMaps=GenerateFlowMaps:class-name",
        "ResavePlugin=ResavePlugin:class-name",
        "ResourceProcessorPlugin=ResourceProcessorPlugin:class-name",
        "WorldDataExport=WorldDataExport:class-name",
        "BuildShoreMap=BuildShoreMap:class-name",
        "AddonBuildInfoTool=AddonBuildInfoTool:class-name",
      ]);
      const gfm = real.observations.find((o) => o.id === "plugin:GenerateFlowMaps#cli:-world")?.obs;
      expect(gfm?.unverified?.[0]).toContain("under module ResourceManager as well");
      for (const o of real.observations.filter((x) => x.obs.kind === "plugin-cli-arg")) {
        expect(o.obs.parent_key).toMatchObject({
          dim: "plugin",
          kind: "plugin",
          module: "none",
          key: { class: o.obs.key.class },
        });
        // The key's class is a class in the source index, never a name the page prints.
        expect(REAL_INDEX?.index.classes.has(o.obs.key.class ?? "")).toBe(true);
      }
    });

    it("keeps plugin-only arguments out of the cli-switch rows", () => {
      const ids = new Set(real.observations.map((o) => o.id));
      for (const name of [
        "FileTypes",
        "PathStartsWith",
        "PathContains",
        "PathEndsWith",
        "extension",
        "type",
        "addonPath",
        "ciInfoDst",
        "exitAfter",
      ]) {
        expect(ids.has(`cli:-${name}`), name).toBe(false);
      }
      // saveDir is a module switch too: its row cites the NavmeshGeneratorMain table, not the plugin's.
      const saveDir = real.observations.find((o) => o.id === "cli:-savedir")?.obs;
      expect(saveDir?.ref).toMatch(/#Page_CLI_Workbench_NavmeshGeneratorMain$/);
      expect(saveDir?.module).toBe("NavmeshGeneratorMain");
      // The engine's -world row cites the common table.
      expect(real.observations.find((o) => o.id === "cli:-world")?.obs.ref).toMatch(
        /#Page_CLI_Common_FilePaths$/,
      );
      const validate = real.observations.find((o) => o.id === "net:native/ValidateScripts")?.obs;
      expect(validate?.signature).toBe(
        "ValidateScripts(Configuration: string) -> {Errors: [], Warnings: [], Success: false}",
      );
    });

    it("documents the seven native NET functions, EvaluateScript among them", () => {
      const natives = real.observations
        .filter((o) => o.obs.kind === "net-function")
        .map((o) => o.obs.key.native);
      expect(natives).toEqual([
        "BringModuleWindowToFront",
        "EvaluateScript",
        "IsWorkbenchRunning",
        "IsWorldEditorRunning",
        "OpenResource",
        "ReloadScripts",
        "ValidateScripts",
      ]);
      const evaluate = real.observations.find((o) => o.id === "net:native/EvaluateScript")?.obs;
      expect(evaluate?.quote).toContain(
        "argument-less function declaration is expected as entry point",
      );
      expect(evaluate?.signature).toBe("EvaluateScript(Script: string) -> {ReturnValue: string}");
    });

    it("gives every row a ref whose file and anchor exist and a quote that is the page's own text", () => {
      const pages = new Map<string, { html: string; crude: string }>();
      for (const { obs } of real.observations) {
        const m = /^<tools>\/Workbench\/docs\/([^#]+)#(.+)$/.exec(obs.ref);
        expect(m, obs.ref).not.toBeNull();
        const file = join(REAL_DOCS, m![1]);
        expect(existsSync(file), obs.ref).toBe(true);
        let page = pages.get(file);
        if (!page) {
          const html = readFileSync(file, "utf-8");
          page = { html, crude: crudeText(html) };
          pages.set(file, page);
        }
        expect(pageIds(page.html).has(m![2]), obs.ref).toBe(true);
        expect(Array.from(obs.quote ?? "").length).toBeLessThanOrEqual(200);
        expect(page.crude, obs.quote).toContain((obs.quote ?? "").replace(/\s+/g, ""));
        expect(containsMachinePath(JSON.stringify(obs))).toBe(false);
      }
    });

    it("is deterministic and the ledger accepts the file", () => {
      const text = observationFileText(real, "1.8.0.13");
      expect(observationFileText(importDocs(REAL_DOCS, REAL_INDEX), "1.8.0.13")).toBe(text);
      const fx = makeCensus("1.8.0.13");
      const dir = join(fx.root, "observations", "E08");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "1.8.0.13.jsonl"), text);
      const built = buildLedger(fx.paths);
      expect(built.rejected).toEqual([]);
      expect(built.rows).toHaveLength(152);
      expect(built.problems.filter((p) => (p.id ?? "").match(/^(cli|net):/))).toEqual([]);
      // The plugin rows' parents are E03's, absent from this E08-only ledger.
      const pluginProblems = built.problems.filter((p) => (p.id ?? "").startsWith("plugin:"));
      expect(pluginProblems.every((p) => /parent/.test(p.message))).toBe(true);
    });
  },
);
