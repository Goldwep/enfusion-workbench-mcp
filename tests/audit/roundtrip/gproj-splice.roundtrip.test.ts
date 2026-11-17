/**
 * Write-safety audit (plan section 11 criterion 7, the lossless-parser list): the two .gproj byte
 * splices, refactor_rename_project_id and refactor_normalize_dependencies, find their spans through
 * the lossless CST (src/formats/enfusion-cst.ts) and change no byte outside them.
 *
 *   - rename: the new text equals the old with only the ID value token replaced, and renaming back
 *     gives the file byte for byte; an `ID "..."` inside a comment or a string is never touched;
 *   - normalize: the located block is a CST object (a `Dependencies {` in a comment or a string is
 *     skipped), and re-emitting the block with its own body gives the file byte for byte.
 *
 * The corpus is every vanilla .gproj beside the paks (addons/<x>/<x>.gproj) and any a pak carries;
 * skipped when the game is absent. The fixtures run without the game.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import {
  buildRenamedContent,
  findIdSpans,
} from "../../../src/tools/refactor-rename-project-id.js";
import { findDepsBlock } from "../../../src/tools/refactor-normalize-dependencies.js";

/** The bytes of `a` and `b` outside one span of `a` ([start, end)) and its replacement in `b`. */
function outsideEqual(a: string, b: string, start: number, end: number, inserted: string): boolean {
  return b === a.slice(0, start) + inserted + a.slice(end);
}

const TRAPS = [
  "// ID \"Old\" in a comment",
  "GameProject {",
  ' ID "Old"',
  ' TITLE "ID \\"Old\\" in a string"',
  " /* Dependencies { \"AAAA000000000001\" } */",
  ' DESC "Dependencies { in a string"',
  " Dependencies {",
  '  "BBBB000000000002"',
  " }",
  " Configurations {",
  "  GameProjectConfig PC {",
  '   ID "Old"',
  "  }",
  " }",
  "}",
  "",
].join("\r\n");

describe("rename_project_id splices through the CST", () => {
  it("renames every ID property and nothing in a comment or a string", () => {
    const { newContent, replaced } = buildRenamedContent(TRAPS, "Old", "New");
    expect(replaced).toBe(2);
    expect(newContent).toBe(
      TRAPS.replace(' ID "Old"\r\n TITLE', ' ID "New"\r\n TITLE').replace('   ID "Old"', '   ID "New"'),
    );
    expect(newContent).toContain('// ID "Old" in a comment');
    expect(newContent).toContain('TITLE "ID \\"Old\\" in a string"');
    expect(buildRenamedContent(newContent, "New", "Old").newContent).toBe(TRAPS);
  });

  it("keeps a bare (unquoted) ID unquoted, and answers 0 when the ID differs", () => {
    expect(buildRenamedContent("GameProject {\n ID Old\n}\n", "Old", "New").newContent).toBe(
      "GameProject {\n ID New\n}\n",
    );
    const r = buildRenamedContent(TRAPS, "Other", "New");
    expect(r).toEqual({ newContent: TRAPS, replaced: 0 });
  });
});

describe("normalize_dependencies locates the block through the CST", () => {
  it("skips a Dependencies in a comment or a string and takes the real block", () => {
    const b = findDepsBlock(TRAPS)!;
    expect(TRAPS.slice(b.start, b.end)).toBe(' Dependencies {\r\n  "BBBB000000000002"\r\n }'.slice(1));
    expect(`Dependencies${b.ws}{${b.body}}`).toBe(TRAPS.slice(b.start, b.end));
  });
});

// ── Corpus ───────────────────────────────────────────────────────────────────

const gamePath = loadConfig().gamePath;
const haveGame = !!gamePath && existsSync(join(gamePath, "addons"));

function vanillaGprojs(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  const seen = new Set<string>();
  const addons = join(gamePath, "addons");
  for (const d of readdirSync(addons, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(addons, d.name))) {
      if (!f.toLowerCase().endsWith(".gproj")) continue;
      out.push({ rel: `${d.name}/${f}`, text: readFileSync(join(addons, d.name, f), "utf-8") });
      seen.add(`${d.name}/${f}`.toLowerCase());
    }
  }
  const vfs = PakVirtualFS.get(gamePath);
  for (const p of vfs?.allFilePaths() ?? []) {
    if (p.toLowerCase().endsWith(".gproj") && !seen.has(p.toLowerCase()))
      out.push({ rel: p, text: vfs!.readFile(p).toString("utf-8") });
  }
  return out;
}

describe.skipIf(!haveGame)(
  haveGame ? "vanilla .gproj splices" : "vanilla .gproj splices (skipped: no game)",
  () => {
    it("rename then rename back gives every vanilla .gproj byte for byte, only the ID token changed", () => {
      const files = vanillaGprojs();
      expect(files.length).toBeGreaterThan(0);
      const bad: string[] = [];
      let renamed = 0;
      for (const f of files) {
        const id = /^\s*ID\s+"([^"]+)"/m.exec(f.text)?.[1];
        if (!id) continue;
        const spans = findIdSpans(f.text, id).spans;
        const { newContent, replaced } = buildRenamedContent(f.text, id, "EMCP_SPLICE_PROBE");
        let ok = replaced === spans.length && replaced > 0;
        // Each span is one token; with one span the rest of the file is the same bytes.
        if (ok && spans.length === 1)
          ok = outsideEqual(f.text, newContent, spans[0]!.start, spans[0]!.end, '"EMCP_SPLICE_PROBE"');
        if (ok) ok = buildRenamedContent(newContent, "EMCP_SPLICE_PROBE", id).newContent === f.text;
        if (ok) renamed++;
        else bad.push(f.rel);
      }
      console.log(`gproj rename splice: ${renamed}/${files.length} byte-exact`);
      expect(bad).toEqual([]);
      expect(renamed).toBeGreaterThan(0);
    });

    it("the located Dependencies block re-emitted with its own body gives every file back", () => {
      const bad: string[] = [];
      let blocks = 0;
      for (const f of vanillaGprojs()) {
        const b = findDepsBlock(f.text);
        if (!b) continue;
        blocks++;
        const again = f.text.slice(0, b.start) + `Dependencies${b.ws}{${b.body}}` + f.text.slice(b.end);
        if (again !== f.text) bad.push(f.rel);
      }
      console.log(`gproj Dependencies blocks: ${blocks}, all re-emitted byte-exact: ${bad.length === 0}`);
      expect(bad).toEqual([]);
    });
  },
);
