/**
 * scripts/audit/write-safety.ts (plan section 11 criterion 7): the checks on synthetic trees, and
 * the audit on this tree with its gap lists pinned, so a closed gap or a new one shows up here.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  ROWS,
  checkEvidence,
  checkTest,
  criterionMet,
  exitCode,
  formatTable,
  routeOf,
  runAudit,
  scanSource,
  writeWithBackupIsAtomic,
  writingToolFiles,
} from "../../scripts/audit/write-safety.js";

const tmp = mkdtempSync(join(tmpdir(), "write-safety-"));
/** The public export leaves the evidence records out; the checks that read them skip there. */
const HAS_EVIDENCE = existsSync(
  join(fileURLToPath(new URL("../..", import.meta.url)), "data", "census", "evidence"),
);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function put(rel: string, text: string): void {
  const abs = join(tmp, ...rel.split("/"));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
}

describe("source scan", () => {
  it("counts plain, exclusive and atomic writes and ignores calls named in comments", () => {
    put(
      "src/tools/a.ts",
      [
        "// writeFileSync(x) in a comment",
        "/* writeFileAtomic(y) */",
        'writeFileSync(a, b, { flag: "wx" });',
        "writeFileSync(",
        "  c,",
        "  d({ e: 1 }),",
        '  { encoding: "utf-8", flag: "wx" },',
        ");",
        'writeFileSync(f, g, { flag: o ? "w" : "wx" });',
        "writeFileAtomic(h, i);",
        "assertInsideRoot(h, root);",
      ].join("\n"),
    );
    const s = scanSource("src/tools/a.ts", tmp);
    expect(s).toEqual({
      plain: 1,
      exclusive: 2,
      atomic: 1,
      backup: 0,
      guards: ["assertInsideRoot"],
    });
    expect(routeOf(s)).toBe("mixed");
  });

  it("reads writeWithBackup's own body for the atomic route", () => {
    put(
      "src/refactor/byte-edit.ts",
      "export function writeWithBackup(a) {\n  writeFileAtomic(a, b);\n}\nexport function other() { writeFileSync(x); }\n",
    );
    expect(writeWithBackupIsAtomic(tmp)).toBe(true);
    put(
      "src/refactor/byte-edit.ts",
      "export function writeWithBackup(a) {\n  writeFileAtomic(a, b);\n  writeFileSync(a, b);\n}\n",
    );
    expect(writeWithBackupIsAtomic(tmp)).toBe(false);
  });

  it("names the route", () => {
    const base = { plain: 0, exclusive: 0, atomic: 0, backup: 0, guards: [] };
    expect(routeOf({ ...base, atomic: 2, exclusive: 1 })).toBe("atomic");
    expect(routeOf({ ...base, exclusive: 2 })).toBe("exclusive-create");
    expect(routeOf({ ...base, plain: 1 })).toBe("plain");
    expect(routeOf({ ...base, backup: 1, atomic: 1 })).toBe("backup-then-atomic");
    expect(routeOf({ ...base, plain: -1 })).toBe("none");
  });

  it("lists only the tool files that write", () => {
    put("src/tools/b.ts", "readFileSync(x);");
    expect(writingToolFiles(tmp)).toEqual(["src/tools/a.ts"]);
  });
});

describe("evidence and test citations", () => {
  it("reads PASS from an evidence record, and nothing else as a pass", () => {
    put(
      "data/census/evidence/EV-X-1.json",
      JSON.stringify({ result_summary: "s1: PASS - loaded" }),
    );
    put(
      "data/census/evidence/EV-X-2.json",
      JSON.stringify({ result_summary: "s2: NOT-RUN - no locator" }),
    );
    put("data/census/evidence/EV-X-3.json", "{");
    expect(checkEvidence("EV-X-1", tmp)).toMatchObject({ found: true, pass: true });
    expect(checkEvidence("EV-X-2", tmp)).toMatchObject({ found: true, pass: false });
    expect(checkEvidence("EV-X-3", tmp)).toMatchObject({ found: true, pass: false });
    expect(checkEvidence("EV-X-4", tmp)).toMatchObject({ found: false, pass: false });
  });

  it("finds a cited test by its name in its file", () => {
    put("tests/x.test.ts", 'it("gives every file back byte for byte", () => {});');
    expect(checkTest({ file: "tests/x.test.ts", needle: "gives every file back" }, tmp)).toBe(true);
    expect(checkTest({ file: "tests/x.test.ts", needle: "something else" }, tmp)).toBe(false);
    expect(checkTest({ file: "tests/none.test.ts", needle: "x" }, tmp)).toBe(false);
  });
});

describe("the audit on this tree", () => {
  const audit = runAudit();

  it("has a row for every file under src/tools that writes", () => {
    expect(audit.unlisted).toEqual([]);
  });

  it("has one row per tool", () => {
    const tools = ROWS.map((r) => r.tool);
    expect(new Set(tools).size).toBe(tools.length);
  });

  it.skipIf(!HAS_EVIDENCE)("finds every cited test and every cited evidence record, each a PASS", () => {
    expect(audit.rows.flatMap((r) => r.missingTests)).toEqual([]);
    expect(audit.evidenceFailures).toEqual([]);
  });

  it.skipIf(!HAS_EVIDENCE)("finds no round-trip gap (gaps 1, 2 and 3 closed)", () => {
    expect(audit.roundTripFailures).toEqual([]);
    expect(exitCode(audit)).toBe(0);
  });

  // W11 run 3 (EV-W11-043..069) closed the ACCEPTED file types; its PARTIAL, NOT-JUDGED and FAIL
  // steps stay open with their reason, and so do the types no step judged. W11 run 5 (EV-W11-113)
  // closed replace_guid on the owner .meta and an unindexed child. W11 run 8 (EV-W11-200..232,
  // summary EV-W11-233) closed .styles, .siga, the .conf copy and reference, the .gproj
  // Dependencies, faction_create and mod's .c .conf; none of the four left is judgeable hand-free
  // (wb_entity_duplicate left the table: Workbench writes its .et, open-findings lta-08).
  it("pins the engine-accept gaps left after W11 run 8", () => {
    expect(audit.acceptGaps.map((g) => g.replace(/ \(.*$/, ""))).toEqual([
      "animation_workspace: .ae",
      "wb_settings: scratch .ini",
      "wb_terrain_edit: terrain file set",
      "server_config: server.json",
    ]);
  });

  it("does not meet criterion 7 yet: engine-accept proof and the lossless-parser gaps stay open", () => {
    expect(audit.acceptGaps.length).toBeGreaterThan(0);
    expect(audit.parserGaps.length).toBeGreaterThan(0);
    expect(criterionMet(audit)).toBe(false);
  });

  // 2026-11-14 write-safety pass: every replacing write goes through writeFileAtomic (wb_world's
  // snapshot, wb_terrain_edit's exports; its backups and scenario_create's
  // files are wx creates), and writeWithBackup is a .bak then writeFileAtomic.
  it("finds every write route atomic or exclusive-create", () => {
    expect(writeWithBackupIsAtomic()).toBe(true);
    expect(audit.routeGaps).toEqual([]);
  });

  // Creates only: the lossless parser does not apply. The proof is the source scan: every write
  // in the tool's own file carries flag "wx", which the OS refuses over an existing file (EEXIST).
  it("pins the creates-only rows, each writing with flag wx alone", () => {
    expect(audit.createsOnly).toEqual([
      "game_duplicate",
      "script_create",
      "prefab",
      "layout_create",
      "config_create",
      "scenario_create",
      "mod",
    ]);
    for (const tool of audit.createsOnly) {
      const row = ROWS.find((r) => r.tool === tool)!;
      const s = scanSource(row.sources[0]!);
      expect({ tool, plain: s.plain, atomic: s.atomic, backup: s.backup }).toEqual({ tool, plain: 0, atomic: 0, backup: 0 });
      expect(s.exclusive, tool).toBeGreaterThan(0);
    }
  });

  // rename_project_id and normalize_dependencies splice CST tokens now (gproj-splice.roundtrip).
  it("pins the writers left off the lossless parser, each with its write class", () => {
    expect(audit.parserGaps.map((g) => g.replace(/: .*\[/, " ["))).toEqual([
      "refactor_replace_guid [splice]",
      "refactor_move_resource_path [splice]",
      "script_format [splice]",
      "wb_terrain_edit [restore]",
      "faction_create [whole-replace]",
      "building_setup [whole-replace]",
      "project [whole-replace]",
      "server_config [whole-replace]",
    ]);
  });

  it("finds no writer without a project-path guard (gaps 21 and 22 closed)", () => {
    expect(audit.guardGaps).toEqual([]);
  });

  // Total audit offline-writers-01: these took a caller projectPath as their root unchecked.
  it("pins a caller projectPath to the configured root in every tool that takes one", () => {
    const pinned = [
      "config_edit",
      "layout_edit",
      "imageset",
      "string_table",
      "meta_file",
      "project_settings",
      "animation_workspace",
      "animation_set",
      "animation_graph",
      "procanim",
      "behavior_tree",
      "audio",
      "particle",
      "navmesh",
    ];
    for (const tool of pinned) {
      const row = ROWS.find((r) => r.tool === tool);
      expect(row, tool).toBeDefined();
      expect(scanSource(row!.sources[0]!).guards, tool).toContain("pinnedProjectRoot");
    }
  });

  it("prints a table with a line per row", () => {
    const table = formatTable(audit);
    for (const r of ROWS) expect(table).toContain(`| ${r.tool} |`);
  });
});
