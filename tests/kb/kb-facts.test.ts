import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The bundled knowledge base is handed to models as fact. These checks pin the
// statements the v2 recon (docs/v2/PLAN.md Appendix D "KB errors") found false,
// so they cannot be reintroduced.
const kbDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/kb");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk(kbDir)
  .filter((p) => p.endsWith(".md") || p.endsWith(".json"))
  .map((p) => ({ name: relative(kbDir, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));

/** Every "file:line: text" in the KB whose line matches the pattern. */
function hits(re: RegExp): string[] {
  return files.flatMap((f) =>
    f.text
      .split(/\r?\n/)
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => re.test(line))
      .map(({ line, n }) => `${f.name}:${n}: ${line.trim()}`),
  );
}

function kb(name: string): string {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`KB file missing: ${name}`);
  return f.text;
}

describe("KB statements the recon found false stay gone", () => {
  it("does not use a ScriptEditorPlugin base class (no such class exists)", () => {
    // A generated census page that cites the ledger row api:ScriptEditorPlugin is recording the
    // class as absent (the recon's own note), not using it as a base class.
    expect(
      hits(/:\s*ScriptEditorPlugin\b/).filter((h) => !h.includes("api:ScriptEditorPlugin")),
    ).toEqual([]);
    expect(hits(/WorldEditorPlugin\/ScriptEditorPlugin/)).toEqual([]);
  });

  it("states the Script Editor plugin base class correctly", () => {
    const text = kb("patterns/Tools_And_Workbench/workbench-plugins.md");
    expect(text).toContain("class TAG_MyScriptPlugin : WorkbenchPlugin");
    expect(text).toMatch(/no `ScriptEditorPlugin` class/);
  });

  it("does not claim the Animation Editor is unreachable through GetModule", () => {
    expect(hits(/Not Accessible via GetModule/i)).toEqual([]);
    expect(hits(/NOT exposed as a `?Workbench\.GetModule\(\)`? module/i)).toEqual([]);
  });

  it("marks the Animation Editor GetModule behaviour as not verified live", () => {
    const text = kb("patterns/Tools_And_Workbench/mcp-net-api.md");
    expect(text).toContain("sealed class AnimEditor: WBModuleDef");
    expect(text).toMatch(/Not verified live:\*\* whether `Workbench\.GetModule\(AnimEditor\)`/);
  });

  it("does not give Tools > Reload Scripts as a menu path", () => {
    expect(hits(/Tools\s*(>|,|\/)\s*Reload Scripts/i)).toEqual([]);
  });

  it("gives reload labels that exist and says the menu location is unverified", () => {
    const text = kb("patterns/Tools_And_Workbench/mcp-net-api.md");
    expect(text).toContain("Plugins > Settings > Reload WB Scripts");
    expect(text).toMatch(/Not verified live:\*\* which menu each label sits under/);
  });

  // Guard only: the File,Save example was in the wb_execute_action tool
  // description (tests/tools/wb-descriptions.test.ts), never in the KB.
  it("never introduces File,Save as an ExecuteAction example", () => {
    expect(hits(/File\s*,\s*Save/i)).toEqual([]);
  });
});

describe("KB carries the command-line facts", () => {
  const plugins = kb("patterns/Tools_And_Workbench/workbench-plugins.md");

  it("says -wbProjectPath is not a Workbench parameter and -gproj is", () => {
    expect(plugins).toMatch(/`-wbProjectPath` is not a Workbench parameter/);
    expect(plugins).toMatch(/`-gproj <path to \.gproj>`/);
  });

  it("mentions -wbProjectPath only to say it does not exist", () => {
    const ok = /not a Workbench parameter|do not pass/i;
    for (const f of files) {
      const lines = f.text.split(/\r?\n/);
      // A generated census page may carry the 1.x tool text; it must warn on a line of its own.
      if (f.name.startsWith("census/") && lines.some((l) => ok.test(l))) continue;
      for (const line of lines) {
        if (/wbProjectPath/.test(line)) expect(`${f.name}: ${line.trim()}`).toMatch(ok);
      }
    }
  });

  it("says RunCommandline bodies end in Workbench.Exit", () => {
    expect(plugins).toMatch(/`RunCommandline` bodies end in `Workbench\.Exit`/);
  });
});

describe("wb_knowledge no-match reply (read-knowledge-12)", () => {
  it("a query that matches nothing says so above the topic index", async () => {
    const { searchKb } = await import("../../src/tools/kb-loader.js");
    const { captureTool, textOf } = await import("../tools/_tool-harness.js");
    const { registerWbKnowledge } = await import("../../src/tools/wb-knowledge.js");
    expect(searchKb(kbDir, "zzzqqq", 2)).toEqual({ files: [], usedIndex: false });
    expect(searchKb(kbDir, "index", 2).usedIndex).toBe(true);
    const tool = captureTool((s) => registerWbKnowledge(s));
    const r = await tool({ query: "zzzqqq", max_files: 2 });
    expect(textOf(r)).toMatch(/^No KB entries matched "zzzqqq"/);
    const idx = await tool({ query: "index", max_files: 2 });
    expect(textOf(idx)).not.toMatch(/No KB entries matched/);
  });
});
