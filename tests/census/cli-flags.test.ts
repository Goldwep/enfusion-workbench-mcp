/**
 * Flag test (plan Phase 1 item 4; principle 7 of plan 3.3).
 *
 * Every Workbench or game command-line switch this repository's TypeScript can
 * pass to an executable must be a switch that a measured source knows: the E05
 * observation file (switches found in the Workbench executable's bytes) or the
 * E08 observation file (Bohemia's shipped Page_CLI documentation), `cli-switch`
 * rows, compared without regard to letter case (DEC-022). A plugin's own
 * argument, passed beside `-plugin=`, may instead be known to E03's
 * `plugin-cli-arg` rows (the plugin script's `GetCmdLine` call; DEC-029).
 *
 * The switches the code passes are found with the TypeScript compiler API: every
 * string literal (or template head) under `src/` and `scripts/` that is exactly
 * a switch, `-name` or `-name=value` with no whitespace. Allow-lists, argv
 * builders and spawn call sites all show up that way. Comments and prose strings
 * never match. Each file that holds such a literal is classified by the
 * executable it targets; a new file that holds one, or a new file that imports
 * `node:child_process`, fails the test until it is classified.
 *
 * Known defects are expected-failure cases against `data/census/known-defects.json`
 * (principle 3.3.7): the test passes while exactly the entries asserted by this
 * file are defective, fails when a new defect appears, and fails when a listed
 * one disappears, so that fixing it forces the list to be updated. Two kinds of
 * defect are checked:
 *
 *   - a switch no measured source knows (`-wbProjectPath` is the one listed today; `-logCRC`,
 *     `-noPause` and the dedicated server's scenario switch were fixed and stay guarded below);
 *   - a switch both sources know, passed to Workbench with the wrong meaning
 *     (`-config=<platform>`: Bohemia documents `-config PATH`, a server
 *     environment file, and Workbench refuses it together with addons).
 *
 * Exactness is pinned per file as well as per name: each listed entry names the
 * files that hold its defective occurrence (`files`), so a listed switch that
 * spreads to another file fails, and the files classed `other` (powershell,
 * netstat and the scraper's file-name filter) are pinned to the names they hold,
 * so a Workbench switch added there does not slip through.
 *
 * The failure messages of the exactness tests print every switch literal the
 * scan found as (file, line, switch) with the executable it goes to and which
 * measured source knows it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CENSUS_ROOT = join(REPO_ROOT, "data", "census");
const THIS_TEST = "tests/census/cli-flags.test.ts";

// ── The code's switches ───────────────────────────────────────────────────────

export interface SwitchHit {
  /** Repository-relative path, forward slashes. */
  file: string;
  /** 1-based line of the literal. */
  line: number;
  /** The switch as written, with its leading dash and without `=value`. */
  written: string;
  /** Lower-cased, no dash (DEC-022). */
  name: string;
  /** True when the literal is `-name=value` (or a template starting `-name=`). */
  assigned: boolean;
}

/** `-name`, or `-name=value`; value without whitespace; at least two letters or digits. */
const SWITCH_SHAPE = /^-([A-Za-z][A-Za-z0-9]+)(=\S*)?$/;

/**
 * Every switch-shaped string literal in one source text. A template literal
 * counts by its head (`-config=${x}` is `-config=`).
 */
export function scanSwitches(text: string, file: string): SwitchHit[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: SwitchHit[] = [];
  const visit = (node: ts.Node): void => {
    let literal: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literal = node.text;
    else if (ts.isTemplateHead(node)) literal = node.text;
    if (literal !== undefined) {
      // A template head ends where the substitution starts, so `-config=` alone is a match.
      const found = SWITCH_SHAPE.exec(literal);
      if (found) {
        hits.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          written: `-${found[1]}`,
          name: found[1].toLowerCase(),
          assigned: found[2] !== undefined,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Which executable a file's switches go to. */
type Role = "workbench" | "server" | "other";

interface FileClass {
  role: Role;
  /** What the argv is for; for `other`, why it is not a Workbench or game switch. */
  note: string;
  /** `other` files only: every switch name the file holds (lower case, no dash). */
  names?: string[];
}

/**
 * Every file under `src/` and `scripts/` (census code excluded) that holds a
 * switch-shaped literal, by the executable the literal is passed to. A file not
 * listed here fails `every file with a switch literal is classified`.
 */
const FILE_CLASS: Record<string, FileClass> = {
  "src/tools/wb-cli-run.ts": {
    role: "workbench",
    note: "wb_cli_run argv builder (planFor) and the prepare-only pack and publish forms (prepareFor)",
  },
  "src/tools/wb-build-data.ts": { role: "workbench", note: "wb_build_data argv builder" },
  "src/tools/wb-validate-scripts.ts": {
    role: "workbench",
    note: "headless -validate allow-list (ALLOWED_FLAGS) and argv builder (buildValidateArgs), used by wb_cli_run buildScripts",
  },
  "src/tools/mod.ts": { role: "workbench", note: "mod build argv (-buildData)" },
  "src/workbench/client.ts": { role: "workbench", note: "launchWorkbench argv (-gproj)" },
  "scripts/live/launch.ts": { role: "workbench", note: "live harness launch plan" },
  "scripts/live/s-a-headless.ts": {
    role: "workbench",
    note: "S-A launch argv: the old and new project arguments of U1, the module verbs, AddonBuildInfoTool's plugin arguments",
  },
  "scripts/live/s-b-scratch-profile.ts": {
    role: "workbench",
    note: "S-B launch argv: -gproj, -forceSettings and the crash-report flags",
  },
  "scripts/live/s-c-natives.ts": {
    role: "workbench",
    note: "S-C relaunch and second-process argv: -gproj and -uri=",
  },
  "scripts/live/dry-run.ts": {
    role: "workbench",
    note: "the deny-listed -scriptAuthorizeAll, named so the dry run can refuse it without an owner go",
  },
  "scripts/live/preflight.ts": {
    role: "workbench",
    note: "-scriptAuthorizeAll, the one development switch an owner's go may put on a launch",
  },
  "scripts/live/s-f-gui.ts": {
    role: "workbench",
    note: "S-F launch plan: -gproj, and -scriptAuthorizeAll as the flag S-F never launches with",
  },
  "scripts/live/p3-1.ts": {
    role: "workbench",
    note: "P3-1 launch sheet printed for the owner: -gproj and -forceSettings (DEC-048 sitting P3-1)",
  },
  "scripts/live/p4-1.ts": {
    role: "workbench",
    note: "P4-1 launch sheet printed for the owner: -gproj, -forceSettings and -scriptAuthorizeAll on the owner's go of 2026-10-10 (DEC-053; design phase4-live-census D16b)",
  },
  "scripts/live/p4-2.ts": {
    role: "workbench",
    note: "P4-2 launch sheet printed for the owner: -gproj, -forceSettings and -scriptAuthorizeAll on the owner's standing go (DEC-053)",
  },
  "scripts/live/p4-3.ts": {
    role: "workbench",
    note: "P4-3 launch sheet printed for the owner: -gproj, -forceSettings and -scriptAuthorizeAll on the owner's standing go (DEC-053)",
  },
  "scripts/live/p4-5.ts": {
    role: "workbench",
    note: "P4-5 launch sheet printed for the owner: -gproj, -forceSettings and -scriptAuthorizeAll on the owner's standing go (DEC-053)",
  },
  "scripts/live/p4-8.ts": {
    role: "workbench",
    note: "P4-8 launch sheet printed for the owner: -gproj, -forceSettings and -scriptAuthorizeAll on the owner's standing go (DEC-053)",
  },
  "scripts/live/final-editors.ts": {
    role: "workbench",
    note: "final per-editor pass launch sheet: -gproj, -forceSettings and -scriptAuthorizeAll (the launch default, owner ruling 2026-11-06)",
  },
  "scripts/live/p4-9.ts": {
    role: "workbench",
    note: "P4-9 launch sheet printed for the owner: -gproj, -forceSettings and -scriptAuthorizeAll on the owner's standing go (DEC-053)",
  },
  "scripts/live/s-d-train1.ts": {
    role: "other",
    note: "netstat.exe flags (listenersInNetstat probe)",
    names: ["ano"],
  },
  "src/server-mgmt/launch.ts": {
    role: "server",
    note: "ArmaReforgerServer.exe argv (buildLaunchArgv)",
  },
  "src/workbench/launcher-nudge.ts": {
    role: "other",
    note: "powershell.exe flags",
    names: ["encodedcommand", "noninteractive", "noprofile"],
  },
  "src/gui/uia.ts": {
    role: "other",
    note: "powershell.exe flags (the GUI layer's UI Automation reads, DEC-048 3.5)",
    names: ["encodedcommand", "noninteractive", "noprofile"],
  },
  "scripts/live/powershell.ts": {
    role: "other",
    note: "powershell.exe flags",
    names: ["encodedcommand", "noninteractive", "noprofile"],
  },
  "scripts/verify-launcher-nudge.ts": {
    role: "other",
    note: "powershell.exe flags",
    names: ["command", "noninteractive", "noprofile", "sta"],
  },
  "scripts/live/win.ts": { role: "other", note: "netstat.exe flags", names: ["ano"] },
  "src/scraper/index.ts": {
    role: "other",
    note: "'-members' is a documentation file-name filter, not an argv entry",
    names: ["members"],
  },
};

/**
 * Files that import `node:child_process`, by what they spawn. Census code and
 * tests are out of scope (they spawn git and node). A file that spawns anything
 * and is not listed fails `every spawn site is accounted for`.
 */
const SPAWN_SITES: Record<string, string> = {
  "src/refactor/byte-edit.ts": "git",
  "src/server-mgmt/launch.ts": "tasklist or similar process probe",
  "src/server-mgmt/stop.ts": "taskkill",
  "src/tools/mod.ts": "Workbench (-buildData)",
  "src/tools/server-launch.ts": "ArmaReforgerServer.exe (argv from src/server-mgmt/launch.ts)",
  "src/workbench/cli-runner.ts": "Workbench (argv from the wb-* tool builders), taskkill, tasklist",
  "src/workbench/client.ts": "Workbench (-gproj)",
  "src/workbench/launcher-nudge.ts": "powershell.exe",
  "src/gui/uia.ts": "powershell.exe (UI Automation reads, execFile)",
  "src/settings/reg-export.ts":
    "reg export of the Workbench settings key (read-only, execFile); tasklist for WB_RUNNING (W8 wb_settings)",
  "scripts/export-public.ts": "git",
  "scripts/audit/export-scan.ts":
    "git (ls-tree, cat-file --batch: reads the tree of a revision, read-only)",
  "scripts/guards-check.ts": "this server under node",
  "src/manifest/budget.ts": "this server under node (the tools/list byte measurement over stdio)",
  "scripts/live/create-sandbox.ts": "git",
  "scripts/live/launch.ts": "Workbench (live harness)",
  "scripts/live/s-a-headless.ts": "Workbench (S-A launches), cmd for the 8.3 short path (execFile)",
  "scripts/live/s-d-train1.ts": "node (the detached call child, the walker command line)",
  "scripts/live/s-e-train1b.ts": "node (the detached call child)",
  "scripts/live/s-f-gui.ts": "node (the detached call child, the tool scripts)",
  "scripts/live/p3-1.ts": "node (the S-F and S-E sitting scripts as sub-processes)",
  "scripts/live/p4-1.ts": "node (the Phase 4 walker scripts as sub-processes)",
  "scripts/live/p4-2.ts": "node (the Phase 4 walker scripts as sub-processes)",
  "scripts/live/p4-3.ts": "node (the Phase 4 walker scripts as sub-processes)",
  "scripts/live/p4-4.ts": "node (the L14 walker script as a sub-process)",
  "scripts/live/p4-5.ts": "node (the Phase 4 walker scripts and netcall.ts as sub-processes)",
  "scripts/live/p4-8.ts": "node (the blind-exploration walkers and netcall.ts as sub-processes)",
  "scripts/live/final-editors.ts":
    "node (preflight, launch, the walker scripts and postflight as sub-processes)",
  "scripts/live/p4-9.ts": "node (the Phase 4 walker scripts and netcall.ts as sub-processes)",
  "scripts/live/session-common.ts":
    "Workbench (S-A launches, spawnWithExit); taskkill per process after image and creation-time checks (DEC-032)",
  "scripts/live/s-c-natives.ts":
    "Workbench (U29 relaunch and second process); node (the detached NET call child, the walker command line)",
  "scripts/live/powershell.ts": "powershell.exe",
  "scripts/live/win.ts": "tasklist, netstat",
  "scripts/verify-launcher-nudge.ts": "powershell.exe",
};

function listTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "census" || e.name === "__tests__" || e.name === "node_modules") continue;
      listTs(rel, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCE_FILES = [...listTs("src"), ...listTs("scripts")].sort();

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

const ALL_HITS: SwitchHit[] = SOURCE_FILES.flatMap((f) => scanSwitches(readRepo(f), f));

// ── The measured sources ──────────────────────────────────────────────────────

interface SwitchRow {
  key: { switch: string };
  quote?: string;
}

function currentBuild(): string {
  return (
    JSON.parse(readFileSync(join(CENSUS_ROOT, "current-build.json"), "utf-8")) as { tag: string }
  ).tag;
}

/** The `cli-switch` rows of one enumerator's observation file for the current build. */
function switchRows(enumerator: "E05" | "E08"): Map<string, SwitchRow> {
  const file = join(CENSUS_ROOT, "observations", enumerator, `${currentBuild()}.jsonl`);
  const rows = new Map<string, SwitchRow>();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as { $header?: number; kind?: string } & SwitchRow;
    if (row.$header !== undefined || row.kind !== "cli-switch") continue;
    rows.set(row.key.switch.toLowerCase(), row);
  }
  return rows;
}

const E05 = switchRows("E05");
/**
 * The public export leaves the E05 observations out (decision D2), so there the tests that need
 * E05's switch knowledge skip.
 */
const HAS_E05 = E05.size > 0;
const E08 = switchRows("E08");

/**
 * A plugin's own command-line arguments, which the plugin script reads with
 * `GetCmdLine` (E03's `plugin-cli-arg` rows, for example AddonBuildInfoTool's
 * `-addonPath` and `-ciInfoDst`): a measured source for an argument passed
 * beside `-plugin=` (DEC-029). Lower case, without the dash.
 */
function pluginArgs(): Set<string> {
  const file = join(CENSUS_ROOT, "observations", "E03", `${currentBuild()}.jsonl`);
  const out = new Set<string>();
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as { $header?: number; kind?: string; key?: { cli?: string } };
    if (row.$header !== undefined || row.kind !== "plugin-cli-arg" || !row.key?.cli) continue;
    out.add(row.key.cli.replace(/^-+/, "").toLowerCase());
  }
  return out;
}

const E03_PLUGIN_ARGS = pluginArgs();

type Knowledge = "both" | "E05" | "E08" | "E03 plugin argument" | "neither";

function knownTo(name: string): Knowledge {
  const a = E05.has(name);
  const b = E08.has(name);
  if (!a && !b && E03_PLUGIN_ARGS.has(name)) return "E03 plugin argument";
  return a && b ? "both" : a ? "E05" : b ? "E08" : "neither";
}

/**
 * Known names passed with a meaning the measured sources contradict. Only
 * Workbench-role files are checked: the dedicated server takes `-config <path>`.
 */
const MISUSED_ON_WORKBENCH: Record<string, { documented: RegExp; why: string }> = {
  config: {
    documented: /^-config PATH\b/,
    why: "Bohemia documents -config PATH (a server environment file) and Workbench refuses it with addons; the code passes -config=<platform name>",
  },
};

function isMisused(h: SwitchHit): boolean {
  return FILE_CLASS[h.file]?.role === "workbench" && h.name in MISUSED_ON_WORKBENCH;
}

// ── The known-defects list ────────────────────────────────────────────────────

interface KnownDefect {
  id: string;
  title: string;
  where: string;
  found_by: string;
  evidence: string;
  asserted_by: { file: string; test: string };
  fixed_by: string;
  /** Present on the entries this file asserts: the switch, with its leading dash. */
  switch?: string;
  /** Present on the entries this file asserts: the files that hold the defective occurrence. */
  files?: string[];
  /** Present on the entries this file asserts. */
  defect_kind?: "unknown-switch" | "misused-switch";
}

function loadKnownDefects(): KnownDefect[] {
  return (
    JSON.parse(readFileSync(join(CENSUS_ROOT, "known-defects.json"), "utf-8")) as {
      defects: KnownDefect[];
    }
  ).defects;
}

/** The switches the list says are defective, lower-cased and without the dash. */
function listedSwitches(): string[] {
  return loadKnownDefects()
    .filter((d) => d.asserted_by.file === THIS_TEST)
    .map((d) => (d.switch ?? "").replace(/^-/, "").toLowerCase())
    .sort();
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function describeHits(hits: readonly SwitchHit[]): string {
  return hits
    .map(
      (h) =>
        `  ${h.file}:${h.line}  ${h.written}${h.assigned ? "=" : ""}  [${FILE_CLASS[h.file]?.role ?? "unclassified"}; known to ${knownTo(h.name)}]`,
    )
    .join("\n");
}

/** Every switch literal the scan found, for the failure messages of the exactness tests. */
function fullTable(): string {
  return `(file, line, switch) of every switch literal under src/ and scripts/:
${describeHits(ALL_HITS)}`;
}

/** The defective hits found in the code: unknown to both sources, or misused on Workbench. */
function defectiveHits(): SwitchHit[] {
  return ALL_HITS.filter(
    (h) => FILE_CLASS[h.file]?.role !== "other" && (knownTo(h.name) === "neither" || isMisused(h)),
  );
}

/** The defective switch names found in the code: unknown to both sources, or misused. */
function defectiveNames(): { unknown: string[]; misused: string[] } {
  const checked = ALL_HITS.filter((h) => FILE_CLASS[h.file]?.role !== "other");
  return {
    unknown: [
      ...new Set(checked.filter((h) => knownTo(h.name) === "neither").map((h) => h.name)),
    ].sort(),
    misused: [...new Set(checked.filter(isMisused).map((h) => h.name))].sort(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("scanSwitches", () => {
  it("finds string literals that are exactly a switch, with their line", () => {
    const hits = scanSwitches(
      ['const a = ["-gproj", p,', '  "-wbModule=ResourceManager", "-run"];'].join("\n"),
      "x.ts",
    );
    expect(hits.map((h) => [h.written, h.name, h.assigned, h.line])).toEqual([
      ["-gproj", "gproj", false, 1],
      ["-wbModule", "wbmodule", true, 2],
      ["-run", "run", false, 2],
    ]);
  });

  it("counts a template head, and a template with no substitution", () => {
    const hits = scanSwitches("const a = [`-config=${c}`, `-noPause`, `-${x}`];", "x.ts");
    expect(hits.map((h) => [h.written, h.assigned])).toEqual([
      ["-config", true],
      ["-noPause", false],
    ]);
  });

  it("ignores comments, prose, descriptions, negative numbers and one-letter flags", () => {
    const text = [
      "// -wbProjectPath in a comment",
      "/* -config=PC */",
      'const a = "-wbModule=Nav -run -autogenerate <world> - long-running";',
      "const b = \"Target may not start with '-'\";",
      'const c = ["-1", "-c", "--full-tree", "-", "-5x"];',
    ].join("\n");
    expect(scanSwitches(text, "x.ts")).toEqual([]);
  });
});

describe("measured sources", () => {
  it.skipIf(!HAS_E05)("E05 and E08 hold cli-switch rows for the current build", () => {
    expect(E05.size).toBeGreaterThan(30);
    expect(E08.size).toBeGreaterThan(100);
  });

  it.skipIf(!HAS_E05)("both sources know the switches the code relies on most", () => {
    for (const name of ["gproj", "wbmodule", "validate", "builddata", "run", "load"]) {
      expect(knownTo(name), name).toBe("both");
    }
  });

  it("E08 still documents -config as a path, which is what makes -config=<platform> a misuse", () => {
    expect(E08.get("config")?.quote ?? "").toMatch(MISUSED_ON_WORKBENCH.config.documented);
  });
});

describe("the code's switches", () => {
  it("every spawn site is accounted for", () => {
    const importing = SOURCE_FILES.filter((f) => /["']node:child_process["']/.test(readRepo(f)));
    const unlisted = importing.filter((f) => !(f in SPAWN_SITES));
    const stale = Object.keys(SPAWN_SITES).filter((f) => !importing.includes(f));
    expect({ unlisted, stale }).toEqual({ unlisted: [], stale: [] });
    for (const f of Object.keys(SPAWN_SITES)) expect(existsSync(join(REPO_ROOT, f)), f).toBe(true);
  });

  it("every file with a switch literal is classified", () => {
    const withHits = [...new Set(ALL_HITS.map((h) => h.file))];
    const unclassified = withHits.filter((f) => !(f in FILE_CLASS));
    const stale = Object.keys(FILE_CLASS).filter((f) => !withHits.includes(f));
    expect(
      { unclassified, stale },
      `Classify each new file in FILE_CLASS by the executable its switches go to.\n${describeHits(
        ALL_HITS.filter((h) => unclassified.includes(h.file)),
      )}
${fullTable()}`,
    ).toEqual({ unclassified: [], stale: [] });
  });

  it("finds the switches of every Workbench argv builder", () => {
    const by = (f: string) => new Set(ALL_HITS.filter((h) => h.file === f).map((h) => h.name));
    expect(by("src/workbench/client.ts")).toContain("gproj");
    expect(by("src/tools/wb-validate-scripts.ts")).toContain("validate");
    expect(by("src/tools/wb-cli-run.ts")).toContain("wbmodule");
    expect(by("src/tools/wb-build-data.ts")).toContain("builddata");
    expect(by("src/tools/mod.ts")).toContain("filterpath");
    expect(by("scripts/live/launch.ts")).toContain("forcesettings");
    expect(by("src/server-mgmt/launch.ts")).toContain("config");
  });

  it.skipIf(!HAS_E05)("passes only switches a measured source knows, apart from the listed defects", () => {
    const { unknown, misused } = defectiveNames();
    const found = [...new Set([...unknown, ...misused])].sort();
    const listed = listedSwitches();
    const involved = ALL_HITS.filter(
      (h) => FILE_CLASS[h.file]?.role !== "other" && (unknown.includes(h.name) || isMisused(h)),
    );
    const message =
      `Defective switches found in the code: ${JSON.stringify(found)}\n` +
      `Listed in data/census/known-defects.json for ${THIS_TEST}: ${JSON.stringify(listed)}\n` +
      `(file, line, switch) of every defective occurrence:\n${describeHits(involved)}\n` +
      "A switch in the first list and not the second is a new defect: fix it or list it (main session). " +
      "A switch in the second list and not the first was fixed: remove its entry.\n" +
      fullTable();
    expect(found, message).toEqual(listed);
  });

  it("the three headless tools pass none of the switches KD-001 to KD-004 recorded", () => {
    // Fixed state (DEC-048 package B): the argv builders name the project with -gproj; the
    // phantom project switch, -config=<platform>, -logCRC and -noPause are gone from them.
    const gone = ["wbprojectpath", "config", "logcrc", "nopause"];
    for (const f of [
      "src/tools/wb-validate-scripts.ts",
      "src/tools/wb-cli-run.ts",
      "src/tools/wb-build-data.ts",
    ]) {
      const names = new Set(ALL_HITS.filter((h) => h.file === f).map((h) => h.name));
      expect(
        gone.filter((n) => names.has(n)),
        `${f} still passes a recorded phantom switch
${fullTable()}`,
      ).toEqual([]);
      // wb-cli-run builds -gproj through buildWorkbenchArgs (client.ts), so it holds no literal.
      if (f !== "src/tools/wb-cli-run.ts") {
        expect(names.has("gproj"), `${f} names the project with -gproj`).toBe(true);
      }
    }
    // The one remaining occurrence of the project switch is the S-A script, on purpose (S-A-1).
    const holders = [
      ...new Set(ALL_HITS.filter((h) => h.name === "wbprojectpath").map((h) => h.file)),
    ];
    expect(holders).toEqual(["scripts/live/s-a-headless.ts"]);
  });

  it("each listed switch is defective for the reason the list gives", () => {
    const { unknown, misused } = defectiveNames();
    for (const d of loadKnownDefects().filter((e) => e.asserted_by.file === THIS_TEST)) {
      const name = (d.switch ?? "").replace(/^-/, "").toLowerCase();
      expect(name, `${d.id} needs a "switch"`).not.toBe("");
      expect(["unknown-switch", "misused-switch"], d.id).toContain(d.defect_kind);
      const found = d.defect_kind === "unknown-switch" ? unknown : misused;
      expect(found, `${d.id} ${d.switch} is ${d.defect_kind}`).toContain(name);
      if (d.defect_kind === "unknown-switch") expect(knownTo(name), d.id).toBe("neither");
      else expect(knownTo(name), d.id).not.toBe("neither");
    }
  });

  it("the dedicated server's switches are checked against the same sources", () => {
    const server = ALL_HITS.filter((h) => FILE_CLASS[h.file]?.role === "server");
    expect([...new Set(server.map((h) => h.name))].sort()).toEqual(["config"]);
  });

  // Was KD-004 (S-A-8 retired after its one run, DEC-037) and KD-005 (server_launch takes the
  // scenario from server.json's game.scenarioId, the field Bohemia's Server Config page documents).
  it("no file passes -noPause or the dedicated server's -scenarioId any more", () => {
    const holders = ALL_HITS.filter((h) => h.name === "nopause" || h.name === "scenarioid");
    expect(
      holders,
      `${describeHits(holders)}
${fullTable()}`,
    ).toEqual([]);
  });

  it.skipIf(!HAS_E05)("a switch that neither source knows is a listed defect, one that a source knows needs no entry", () => {
    const listed = new Set(listedSwitches());
    const checked = ALL_HITS.filter((h) => FILE_CLASS[h.file]?.role !== "other");
    const table: Record<string, Knowledge> = {};
    for (const h of checked) table[h.name] = knownTo(h.name);
    for (const [name, k] of Object.entries(table)) {
      if (k === "neither")
        expect(listed.has(name), `${name} is known to neither source`).toBe(true);
    }
    expect(
      Object.keys(table).length,
      `${JSON.stringify(table)}
${fullTable()}`,
    ).toBeGreaterThan(8);
  });

  it("each listed switch is defective in exactly the files the list names", () => {
    const hits = defectiveHits();
    for (const d of loadKnownDefects().filter((e) => e.asserted_by.file === THIS_TEST)) {
      const name = (d.switch ?? "").replace(/^-/, "").toLowerCase();
      const mine = hits.filter((h) => h.name === name);
      expect(
        [...new Set(mine.map((h) => h.file))].sort(),
        `${d.id} ${d.switch}: the files that hold the defective occurrence differ from "files" in the list. ` +
          `A new file is a new occurrence of a known defect: fix it or add the file (main session); a file that ` +
          `dropped out was fixed: remove it from the entry.
${describeHits(mine)}
${fullTable()}`,
      ).toEqual([...(d.files ?? [])].sort());
    }
  });

  it("the files classed other hold exactly the switch names the classification lists", () => {
    const others = Object.entries(FILE_CLASS).filter(([, c]) => c.role === "other");
    for (const [file, c] of others) {
      const found = [...new Set(ALL_HITS.filter((h) => h.file === file).map((h) => h.name))].sort();
      expect(
        found,
        `${file} (${c.note}) holds a switch that is not listed: a Workbench or game switch here must move the ` +
          `file to a Workbench or server role.
${fullTable()}`,
      ).toEqual([...(c.names ?? [])].sort());
    }
  });
});
