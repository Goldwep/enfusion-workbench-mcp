/**
 * Write-safety audit for plan section 11 criterion 7: "Every offline write tool goes through the
 * lossless parser with a 100% byte-exact corpus round trip and one engine-accept proof per file
 * type."
 *
 *   npx tsx scripts/audit/write-safety.ts [--json]
 *
 * One row per offline write tool (a tool or action in src/tools that writes a project file without
 * Workbench doing the write). Each row carries three checks:
 *
 *   1. round trip: the corpus round-trip test that reads the vanilla files of the type and writes
 *      them back unchanged through the tool's own parser and serialiser. A cited test is checked
 *      here: the file must exist and hold the cited test name. `lossy` means the test exists and
 *      shows the round trip is not byte-exact; `n/a` means the tool parses nothing it writes back
 *      (a template creator, a verbatim copy, a byte splice).
 *   2. engine accept: per file type the tool writes, one evidence record in data/census/evidence
 *      whose result says PASS for a live step that had Workbench load a file the tool wrote. Each
 *      cited record is opened and its result read here.
 *   3. write route and guard, read from the tool's source: whether its writes go through
 *      src/utils/atomic-write.ts (writeFileAtomic, renameOver) or byte-edit's atomicCommit, or a
 *      plain writeFileSync; and which path guard it calls.
 *
 * The script also scans src/tools for every file that writes, so a new writer with no row fails.
 *
 * Exit status: 1 when a row whose round trip applies has none (missing, lossy, or a cited test that
 * is not there), when a cited evidence record is absent or not a PASS, or when a writing file under
 * src/tools has no row; 0 otherwise. Missing engine-accept proofs and plain writes are reported as
 * gaps but do not change the exit status: they close through a live sitting or an owner item, not
 * through this tree.
 *
 * Nothing here runs a test or touches Workbench; it reads the tree.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Row model ────────────────────────────────────────────────────────────────

export type RoundTripStatus = "present" | "partial" | "lossy" | "missing" | "n/a";

export interface TestCite {
  /** Repo-relative test file. */
  file: string;
  /** A literal substring of the test's name (describe or it) in that file. */
  needle: string;
}

export interface RoundTrip {
  status: RoundTripStatus;
  tests: TestCite[];
  note: string;
}

export interface Accept {
  /** The file type the proof is for (an extension, or a named kind). */
  type: string;
  /** Evidence id (data/census/evidence/<id>.json); absent when there is no proof. */
  evidence?: string;
  note?: string;
}

export interface Row {
  tool: string;
  /** Actions that write (or "all"). */
  actions: string;
  /** Repo-relative sources whose write calls and guards are read. */
  sources: string[];
  /** What kind of write. */
  kind: "edit" | "create" | "copy" | "splice" | "restore";
  /** The parser the write goes through. */
  parser: string;
  roundTrip: RoundTrip;
  accept: Accept[];
  /** Guard facts that a source scan cannot see. */
  guardNote?: string;
  /**
   * Why the lossless parser does not apply, for a row whose parser is not one. "creates-only": the
   * tool only creates new files (from a template or a copy), never rewriting an existing one, which
   * the audit checks: every write in its own source carries flag "wx" (route exclusive-create), so
   * the OS refuses it over an existing file (EEXIST). "whole-replace": it may replace an existing file
   * wholesale on request (force, overwrite, a rerun, the caller's whole text), keeping none of its
   * bytes, so there is nothing to splice; an owner ruling. "splice": a byte splice over formats the
   * CST does not cover. "restore": a byte copy checked by sha256.
   */
  writeClass?: { kind: "creates-only" | "whole-replace" | "splice" | "restore"; note: string };
}

const T = (file: string, needle: string): TestCite => ({ file, needle });

// ── The rows ─────────────────────────────────────────────────────────────────

const CREATES_ONLY = {
  kind: "creates-only",
  note: "refuses an existing file and writes only with flag wx",
} as const;

/** The template creators' write class, from their own sources (read 2026-11-14). */
const CREATOR_CLASS: Record<string, Row["writeClass"]> = {
  script_create: CREATES_ONLY,
  prefab: CREATES_ONLY,
  layout_create: CREATES_ONLY,
  config_create: CREATES_ONLY,
  scenario_create: {
    kind: "creates-only",
    note: "refuses when any of its files exists, then writes each with flag wx (a file that appears in between is never replaced)",
  },
  mod: {
    kind: "creates-only",
    note: "refuses an existing addon folder and writes the .gproj, scripts and configs with flag wx",
  },
  faction_create: {
    kind: "whole-replace",
    note: "force replaces an existing .conf with the template through writeFileAtomic; without force it is a wx create",
  },
  building_setup: {
    kind: "whole-replace",
    note: "a rerun regenerates its own part and building prefabs through writeFileAtomic",
  },
  project: {
    kind: "whole-replace",
    note: "action write puts the caller's whole text at the path through writeFileAtomic; nothing of the old file is meant to stay",
  },
  server_config: {
    kind: "whole-replace",
    note: "overwrite replaces server.json through writeFileAtomic (JSON, not a resource format); without overwrite it is a wx create",
  },
};

export const ROWS: Row[] = [
  {
    tool: "config_edit",
    actions: "set clear arrayAdd arrayRemove setAncestor createInherited override",
    sources: ["src/tools/config-edit.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/tools/config-edit.test.ts",
          "gives every file back byte for byte, and a no-op set leaves the bytes alone",
        ),
      ],
      note: "every vanilla .conf .emat .gamemat .physmat .vhcsurf .styles (corpus.list)",
    },
    accept: [
      { type: ".conf", evidence: "EV-W2-166" },
      { type: ".emat", evidence: "EV-W11-043" },
      { type: ".gamemat", evidence: "EV-W11-044" },
      { type: ".physmat", evidence: "EV-W11-045" },
      { type: ".vhcsurf", evidence: "EV-W11-046" },
      {
        type: ".styles",
        evidence: "EV-W11-205",
        note: "w11-14 run 8: a nested WSItem Image set and read back (runs 3 to 6 PARTIAL on the root Name)",
      },
    ],
  },
  {
    tool: "layout_edit",
    actions: "all edits",
    sources: ["src/tools/layout-edit.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [T("tests/tools/layout-edit.test.ts", "writes every file back byte for byte")],
      note: "every vanilla .layout",
    },
    accept: [{ type: ".layout", evidence: "EV-W2-165" }],
  },
  {
    tool: "imageset",
    actions: "create texture group quads",
    sources: ["src/tools/imageset.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/tools/imageset.test.ts",
          "gives every file back byte for byte, and the writer would keep every one",
        ),
      ],
      note: "every vanilla .imageset",
    },
    accept: [{ type: ".imageset", evidence: "EV-W2-164", note: "probe P-W2-21 PARTIAL" }],
  },
  {
    tool: "string_table",
    actions: "create upsert remove buildRuntime",
    sources: ["src/tools/string-table.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "partial",
      tests: [
        T("tests/tools/string-table.test.ts", "the parser gives every file back byte for byte"),
        T(
          "tests/tools/string-table.test.ts",
          "reading then writing gives every file back byte for byte",
        ),
      ],
      note: "runtime .conf: every vanilla StringTableRuntime; .st: no .st in the paks or the install, fixtures only",
    },
    accept: [
      { type: ".st", evidence: "EV-W3-126" },
      { type: "runtime .conf", evidence: "EV-W3-126" },
    ],
  },
  {
    tool: "meta_file",
    actions: "set clear setAncestor",
    sources: ["src/tools/meta-file.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "partial",
      tests: [
        T(
          "tests/tools/meta-file.test.ts",
          "round-trips every vanilla .meta in the paks byte for byte",
        ),
        T(
          "tests/tools/meta-file.test.ts",
          "round-trips every .meta of the local Workbench addons folder",
        ),
      ],
      note: "the paks hold 0 .meta, so the pak case passes on zero files; the real corpus is the local addons folder (not vanilla)",
    },
    accept: [
      { type: ".meta", evidence: "EV-W2-163", note: "probe P-W2-20 PARTIAL: ColorSpace read back" },
    ],
  },
  {
    tool: "project_settings",
    actions: "set and the other edits",
    sources: ["src/tools/project-settings.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/tools/project-settings.test.ts",
          "parse then emit reproduces every vanilla .gproj byte for byte",
        ),
      ],
      note: "the 3 loose vanilla .gproj and any in the paks",
    },
    accept: [{ type: ".gproj", evidence: "EV-W2-167" }],
  },
  {
    tool: "animation_workspace",
    actions: "create set duplicate (link rewrites)",
    sources: ["src/tools/animation-workspace.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/animation-workspace.corpus.test.ts",
          "gate 1: parses and serialises every file of the set byte for byte",
        ),
      ],
      note: "every vanilla .aw .agr .agf .ast .asi .ae .aex .asy",
    },
    accept: [
      { type: ".aw", evidence: "EV-W4-047", note: "probe P-W4-16 PARTIAL" },
      { type: ".aex (duplicate link rewrite)", evidence: "EV-W11-050" },
      { type: ".asy (duplicate link rewrite)", evidence: "EV-W11-051" },
      {
        type: ".ae",
        note: "w11-30 NOT-JUDGED in every run to run 8 (EV-W11-207): describe refuses ours and the vanilla .ae controls too; no read-only handler loads an event table",
      },
    ],
  },
  {
    tool: "animation_set",
    actions: "create addGroup addColumn addAnimation map unmap",
    sources: ["src/tools/animation-set.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/animation-set.corpus.test.ts",
          "gate 1: gives every file back byte for byte, and the writer would keep every one",
        ),
      ],
      note: "every vanilla .ast and .asi",
    },
    accept: [{ type: ".ast .asi", evidence: "EV-W4-044", note: "probe P-W4-25 PARTIAL" }],
  },
  {
    tool: "animation_graph",
    actions: "edit author",
    sources: ["src/tools/animation-graph.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/animation-graph.corpus.test.ts",
          "gate 1: parses every .agf and .agr and gives the bytes back exactly",
        ),
      ],
      note: "every vanilla .agr and .agf",
    },
    accept: [{ type: ".agr .agf", evidence: "EV-W4-043", note: "probe P-W4-24 PARTIAL" }],
  },
  {
    tool: "procanim",
    actions: "create edit",
    sources: ["src/tools/procanim.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/procanim.corpus.test.ts",
          "reads every file and writes it back byte for byte",
        ),
      ],
      note: "every vanilla .pap and .siga",
    },
    accept: [
      {
        type: ".pap",
        evidence: "EV-W4-046",
        note: "probe P-W4-28 PARTIAL: loads with stale compiled blocks",
      },
      {
        type: ".siga",
        evidence: "EV-W11-206",
        note: "w11-20 run 8: valueMax 357.25 and the VECTOR2 position 31.5 -4.25 read back (the vector read since the ReadValueText handler change)",
      },
    ],
  },
  {
    tool: "behavior_tree",
    actions: "create edit",
    sources: ["src/tools/behavior-tree.ts"],
    kind: "edit",
    parser: "bt model (src/behavior-tree/model.ts)",
    roundTrip: {
      status: "present",
      tests: [
        T("tests/corpus/behavior-tree.corpus.test.ts", "writes every file back byte for byte"),
      ],
      note: "every vanilla .bt",
    },
    accept: [{ type: ".bt", evidence: "EV-W4-045" }],
  },
  {
    tool: "audio",
    actions: "set create graph edits addVariable",
    sources: ["src/tools/audio.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/w5-audio.corpus.test.ts",
          "round trips every .acp, .sig, .afm and audio variables .conf byte for byte",
        ),
      ],
      note: "every vanilla .acp .sig .afm and AudioVariablesClass .conf",
    },
    accept: [
      { type: ".acp", evidence: "EV-W5-096" },
      { type: ".sig", evidence: "EV-W5-100" },
      { type: ".afm", evidence: "EV-W5-099" },
      { type: "variables .conf", evidence: "EV-W5-098" },
    ],
  },
  {
    tool: "particle",
    actions: "set create add remove rename",
    sources: ["src/tools/particle.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/w5-particle.corpus.test.ts",
          "every .ptc comes back byte for byte, parses clean as one EffectDef, and is editable",
        ),
      ],
      note: "every vanilla .ptc",
    },
    accept: [{ type: ".ptc", evidence: "EV-W5-097" }],
  },
  {
    tool: "navmesh",
    actions: "overrideConfig",
    sources: ["src/tools/navmesh.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/corpus/w5-navmesh.corpus.test.ts",
          "round trips the 16 Navmesh_*.conf byte for byte",
        ),
      ],
      note: "the vanilla Navmesh_*.conf; .nmn is read only",
    },
    accept: [{ type: "navmesh .conf", evidence: "EV-W5-102" }],
  },
  {
    tool: "wb_world",
    actions: "new duplicate setWorldEntity (offline file writes)",
    sources: ["src/tools/wb-world.ts"],
    kind: "edit",
    parser: "CST",
    roundTrip: {
      status: "partial",
      tests: [
        T(
          "tests/audit/roundtrip/layer.roundtrip.test.ts",
          "gives every local text .layer and .ent back byte for byte",
        ),
        T(
          "tests/audit/roundtrip/layer.roundtrip.test.ts",
          "hold no .layer, and no .ent that is text",
        ),
      ],
      note: "no vanilla text layer is reachable (0 .layer in the paks, every .ent binary); measured on the local addons layers instead",
    },
    accept: [
      {
        type: ".ent .layer",
        evidence: "EV-W1-171",
        note: "probe P-W1-26: duplicate and setWorldEntity, the copy opens",
      },
    ],
  },
  {
    tool: "wb_settings",
    actions: "set unset profile (scratch ini)",
    sources: ["src/tools/wb-settings.ts", "src/settings/ini-edit.ts"],
    kind: "edit",
    parser: "ini-edit (line based)",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/audit/roundtrip/ini.roundtrip.test.ts",
          "gives every scratch ini back byte for byte under identity sets",
        ),
        T(
          "tests/audit/roundtrip/ini.roundtrip.test.ts",
          "gives every .ini the game install ships back byte for byte under identity sets",
        ),
      ],
      note: "no vanilla Workbench ini exists; the scratch inis earlier runs made from the registry export, and the install's BattlEye inis",
    },
    accept: [
      { type: "scratch .ini", note: "w8-31 NOT-RUN (EV-W8-293): no GUI locator on this build" },
    ],
    guardNote: "writes only new files inside <artifacts>/settings/scratch (newFileRefusal)",
  },
  {
    tool: "scenario_apply_template",
    actions: "apply",
    sources: [
      "src/tools/scenario-apply-template.ts",
      "src/scenario/apply-template.ts",
      "src/scenario/layer-cst.ts",
    ],
    kind: "edit",
    parser: "CST (src/formats/enfusion-cst.ts) via src/scenario/layer-cst.ts splices",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/audit/roundtrip/layer.roundtrip.test.ts",
          "is byte-exact on every local text .layer and .ent",
        ),
        T("tests/audit/roundtrip/layer.roundtrip.test.ts", "is byte-exact on ${name}"),
        T(
          "tests/tools/scenario-layer-writes.test.ts",
          "writes the target back with every existing byte kept and the stamp inserted",
        ),
      ],
      note: "11 of 11 local layers: a stamp is one inserted span and every other byte is kept",
    },
    accept: [{ type: ".layer", evidence: "EV-W11-057" }],
    guardNote:
      "writeWithBackup: a .bak, then write-then-rename (writeFileAtomic); refuses a dirty git tree unless force",
  },
  {
    tool: "scenario_clone_area",
    actions: "clone",
    sources: [
      "src/tools/scenario-clone-area.ts",
      "src/scenario/clone-area.ts",
      "src/scenario/layer-cst.ts",
    ],
    kind: "create",
    parser: "CST (src/formats/enfusion-cst.ts) via src/scenario/layer-cst.ts splices",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/audit/roundtrip/layer.roundtrip.test.ts",
          "is byte-exact on every local text .layer and .ent",
        ),
        T("tests/audit/roundtrip/layer.roundtrip.test.ts", "is byte-exact on ${name}"),
      ],
      note: "a clone of every entity equals the source once the fresh GUIDs are swapped back; out-of-area entities are cut as whole lines; a new file goes through writeFileAtomic, an overwrite through writeWithBackup",
    },
    accept: [{ type: ".layer", evidence: "EV-W11-057" }],
  },
  {
    tool: "game_duplicate",
    actions: "duplicate (flatten, ancestry injection)",
    sources: ["src/tools/game-duplicate.ts"],
    kind: "copy",
    parser: "none: regex edits on the text (ID line, parent reference, injected components)",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/audit/roundtrip/duplicate.roundtrip.test.ts",
          "identity: every file comes back byte for byte",
        ),
        T(
          "tests/audit/roundtrip/duplicate.roundtrip.test.ts",
          "rename: a new ID changes only the 16 ID digits",
        ),
        T(
          "tests/audit/roundtrip/duplicate.roundtrip.test.ts",
          "injection: an inherited component is one inserted block",
        ),
        T(
          "tests/audit/roundtrip/duplicate.roundtrip.test.ts",
          "flatten: only the parent reference of the class line goes",
        ),
      ],
      note: "transformDuplicate (pure) on every vanilla .et and .conf: identity byte-exact, edits confined to the ID digits, the inserted block and the parent span",
    },
    accept: [
      { type: ".et copy", evidence: "EV-W11-063" },
      { type: ".conf copy", evidence: "EV-W11-226", note: "w11-69 run 8: the Navmesh .conf copy ACCEPTED" },
    ],
    writeClass: {
      kind: "creates-only",
      note: "refuses an existing destination and writes with flag wx; its edits are confined (duplicate.roundtrip.test.ts)",
    },
  },
  {
    tool: "refactor_replace_guid",
    actions: "commit",
    sources: ["src/tools/refactor-replace-guid.ts", "src/refactor/byte-edit.ts"],
    kind: "splice",
    parser: "none: byte splice of the GUID spans",
    roundTrip: {
      status: "n/a",
      tests: [T("tests/refactor/byte-edit.test.ts", "finds a string literal")],
      note: "bytes outside the spans are kept by construction (byte-edit)",
    },
    accept: [
      {
        type: "owner .meta and an unindexed child .physmat",
        evidence: "EV-W11-113",
        note: "w11-40 run 5: the child loads (ACCEPTED) and the parent registers under the new GUID",
      },
      {
        type: "a .conf reference",
        evidence: "EV-W11-211",
        note: "w11-42 run 8: the SCR_EntityCatalogEntry W11_ref.conf names the new GUID and is ACCEPTED",
      },
    ],
    guardNote:
      "files come from the project index roots; core files are refused, workshop files need include_workshop",
    writeClass: {
      kind: "splice",
      note: "the GUID spans are found by a 16-hex regex over any indexed text file, .c scripts among them, which the CST does not parse; bytes outside the spans are kept. A CST span search would cover the resource formats only and would stop rewriting a GUID in a comment: a behaviour change, design note in the audit md",
    },
  },
  {
    tool: "refactor_rename_project_id",
    actions: "commit",
    sources: ["src/tools/refactor-rename-project-id.ts", "src/refactor/byte-edit.ts"],
    kind: "splice",
    parser: "CST (the ID value tokens, spliced in place)",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/audit/roundtrip/gproj-splice.roundtrip.test.ts",
          "rename then rename back gives every vanilla .gproj byte for byte, only the ID token changed",
        ),
        T(
          "tests/audit/roundtrip/gproj-splice.roundtrip.test.ts",
          "renames every ID property and nothing in a comment or a string",
        ),
      ],
      note: "every vanilla .gproj: only the ID token changes and renaming back gives the bytes; the tool writes the .gproj alone (atomicCommit of one file), so no other file holds a reference it rewrites",
    },
    accept: [{ type: ".gproj", evidence: "EV-W11-067" }],
  },
  {
    tool: "refactor_normalize_dependencies",
    actions: "commit",
    sources: ["src/tools/refactor-normalize-dependencies.ts", "src/refactor/byte-edit.ts"],
    kind: "splice",
    parser: "CST (the Dependencies block located as a CST object, its body spliced)",
    roundTrip: {
      status: "present",
      tests: [
        T(
          "tests/audit/roundtrip/gproj-splice.roundtrip.test.ts",
          "the located Dependencies block re-emitted with its own body gives every file back",
        ),
        T(
          "tests/audit/roundtrip/gproj-splice.roundtrip.test.ts",
          "skips a Dependencies in a comment or a string and takes the real block",
        ),
      ],
      note: "every vanilla .gproj with a Dependencies block; bytes outside the block are kept",
    },
    accept: [
      {
        type: ".gproj",
        evidence: "EV-W11-229",
        note: "w11-71 run 8: the Dependencies array read back (since the ReadValueText handler change; runs 3 to 6 PARTIAL)",
      },
    ],
  },
  {
    tool: "refactor_move_resource_path",
    actions: "commit",
    sources: ["src/tools/refactor-move-resource-path.ts", "src/refactor/byte-edit.ts"],
    kind: "splice",
    parser: "none: byte splice of references, file rename, .meta rewrite",
    roundTrip: {
      status: "n/a",
      tests: [],
      note: "byte splice; the moved .meta is rewritten through writeFileAtomic",
    },
    accept: [{ type: "moved resource and its .meta", evidence: "EV-W11-053" }],
    writeClass: {
      kind: "splice",
      note: "the reference spans are found by regex over any indexed text file (.c among them), as replace_guid; the moved .meta is rewritten whole through writeFileAtomic; design note in the audit md",
    },
  },
  {
    tool: "script_format",
    actions: "commit",
    sources: ["src/tools/script-format.ts", "src/refactor/byte-edit.ts"],
    kind: "splice",
    parser: "none: whitespace rewrite of a .c",
    roundTrip: { status: "n/a", tests: [], note: "a formatter changes bytes on purpose" },
    accept: [
      {
        type: ".c",
        evidence: "EV-W11-069",
        note: "opened in the Script Editor, line count read back, not compiled",
      },
    ],
    guardNote: "script_path must resolve inside the project or workshop root (assertInsideAnyRoot)",
    writeClass: {
      kind: "splice",
      note: "an Enforce Script formatter: the CST parses the resource text format, not .c, and a formatter changes whitespace on purpose",
    },
  },
  {
    tool: "wb_terrain_edit",
    actions: "backup restore (and the export files)",
    sources: ["src/tools/wb-terrain-edit.ts"],
    kind: "restore",
    parser: "none: byte copy with a sha256 manifest",
    roundTrip: {
      status: "n/a",
      tests: [
        T(
          "tests/tools/wb-terrain-edit.test.ts",
          "restore: the dry run detects a changed file; confirm restores byte-exact, world closed",
        ),
      ],
      note: "a copy, verified by sha256 on a temp folder",
    },
    accept: [
      {
        type: "terrain file set",
        note: "w7-70-restore BLOCKED (EV-W7-135): OI-W7-1, the owner makes the throwaway terrain world",
      },
    ],
    guardNote: "backups go to <artifacts>; restore targets checked with isPathInsideRoot",
    writeClass: {
      kind: "restore",
      note: "restore writes back the backed-up bytes (binary terrain files among them), each checked against its sha256; backups are exclusive creates in a fresh folder",
    },
  },
  {
    tool: "wb_entity_duplicate",
    actions: "duplicate",
    sources: ["src/tools/wb-entity-duplicate.ts"],
    kind: "copy",
    parser: "none: verbatim byte copy",
    roundTrip: {
      status: "n/a",
      tests: [],
      note: "a byte copy of the ancestor prefab (a Buffer, no UTF-8 round trip)",
    },
    accept: [
      {
        type: ".et copy",
        note: "the source is read through the pak VFS as game_duplicate reads it (DEC-105, tests/tools/wb-contract.test.ts); W11 step w11-54-entity-duplicate (replaceInScene false, a named vanilla entity of the open scenario B) is written, hand-free, and has not run live yet",
      },
    ],
    writeClass: {
      kind: "creates-only",
      note: "refuses an existing destination and writes with flag wx",
    },
  },
  // Template creators: they parse nothing they write back, so the round trip does not apply, but
  // criterion 7 says every offline writer goes through the lossless parser and these do not.
  ...(
    [
      [
        "script_create",
        "src/tools/script-create.ts",
        ".c",
        "EV-W6-130",
        "plugin template opened in the Script Editor, not compiled (P-W6-05 PARTIAL)",
      ],
      ["prefab", "src/tools/prefab.ts", ".et", "EV-W11-058", undefined],
      ["layout_create", "src/tools/layout-create.ts", ".layout", "EV-W11-059", undefined],
      ["config_create", "src/tools/config-create.ts", ".conf", "EV-W11-060", undefined],
      [
        "faction_create",
        "src/tools/faction-create.ts",
        ".conf",
        "EV-W11-220",
        "w11-63 run 8: FactionKey read back once the creator wrote the engine's names (runs 3 to 7 PARTIAL: m_sFactionKey is not an SCR_Faction variable)",
      ],
      [
        "scenario_create",
        "src/tools/scenario-create.ts",
        ".ent .layer .conf",
        "EV-W11-054",
        "scenario_create_conflict: the mission .conf, the world .ent and three layers",
      ],
      ["building_setup", "src/tools/building-setup.ts", ".et", "EV-W11-062", undefined],
      ["mod", "src/tools/mod.ts", ".gproj", "EV-W11-066", undefined],
      [
        "project",
        "src/tools/project.ts",
        "any (action write)",
        "EV-W11-064",
        "a .physmat written by action write",
      ],
      [
        "server_config",
        "src/tools/server-config.ts",
        "server.json (server, not Workbench)",
        undefined,
        "not a Workbench file: the dedicated server reads it; no Workbench read-only handler can load it, so W11 cannot judge it (an owner ruling or an exclusion)",
      ],
    ] as const
  ).map(
    ([tool, src, type, ev, note]): Row => ({
      tool,
      actions: "create",
      sources: [src],
      kind: "create",
      parser:
        tool === "project" ? "none: the caller's text (action write)" : "template text (no parse)",
      roundTrip: { status: "n/a", tests: [], note: "creates new files from a template" },
      accept: [
        { type, evidence: ev, note },
        // W11 run 3 judged the .gproj mod create writes (EV-W11-066); run 8 the game-mode pattern files.
        ...(tool === "mod"
          ? [
              {
                type: ".c .conf",
                evidence: "EV-W11-227",
                note: "w11-6a run 8 (pattern game-mode): the MissionHeader .conf and two .c ACCEPTED",
              },
            ]
          : []),
      ],
      writeClass: CREATOR_CLASS[tool],
    }),
  ),
];

/**
 * Files under src/tools that write but are not offline project writers: they write only to the
 * artifacts folder, or Workbench does the write. Each with its reason.
 */
export const NOT_PROJECT_WRITERS: Record<string, string> = {
  "src/tools/wb-container.ts": "writes a JSON dump to <artifacts>/container",
  "src/tools/wb-gui.ts": "writes a tree dump to <artifacts>/gui",
};

// ── Checks ───────────────────────────────────────────────────────────────────

const WRITE_CALL = /\b(writeFileSync|writeFileAtomic|atomicCommit|writeWithBackup|renameOver)\(/g;
const GUARDS = [
  "assertInsideRoot",
  "assertInsideAnyRoot",
  "isPathInsideRoot",
  "validateProjectPath",
  "newFileRefusal",
  // A caller projectPath kept inside the configured root (total audit offline-writers-01).
  "pinnedProjectRoot",
] as const;

export interface SourceScan {
  /** writeFileSync calls that may replace a file. */
  plain: number;
  /** writeFileSync calls with flag "wx": they only ever create a new file. */
  exclusive: number;
  atomic: number;
  backup: number;
  guards: string[];
}

function read(rel: string, root: string): string | undefined {
  const abs = join(root, ...rel.split("/"));
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

/** Strip line and block comments so a call named in a comment is not counted. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function scanSource(rel: string, root = REPO_ROOT): SourceScan {
  const text = read(rel, root);
  if (text === undefined) return { plain: -1, exclusive: 0, atomic: 0, backup: 0, guards: [] };
  const c = code(text);
  const s: SourceScan = { plain: 0, exclusive: 0, atomic: 0, backup: 0, guards: [] };
  for (const m of c.matchAll(WRITE_CALL)) {
    if (m[1] === "writeFileSync") {
      // The call's own text, up to its closing ");" (a flag may sit on a later line).
      const start = m.index ?? 0;
      const end = c.indexOf(");", start);
      const call = c.slice(start, end < 0 ? start + 400 : end);
      // `flag: "wx"` alone is exclusive; `flag: x ? "w" : "wx"` may replace.
      if (/flag:\s*"wx"/.test(call)) s.exclusive++;
      else s.plain++;
    } else if (m[1] === "writeWithBackup") s.backup++;
    else s.atomic++;
  }
  for (const g of GUARDS) if (new RegExp(`\\b${g}\\(`).test(c)) s.guards.push(g);
  return s;
}

/**
 * atomic: every replacing write goes through atomic-write or atomicCommit (exclusive creates
 * allowed); exclusive-create: only `wx` creates, nothing is ever replaced; mixed: atomic and plain
 * replacing writes; plain: plain replacing writes only; backup-then-atomic: byte-edit's
 * writeWithBackup (a .bak, then write-then-rename through writeFileAtomic).
 */
export type Route =
  | "atomic"
  | "exclusive-create"
  | "mixed"
  | "plain"
  | "backup-then-atomic"
  | "none";

export function routeOf(s: SourceScan): Route {
  if (s.plain < 0) return "none";
  if (s.backup > 0) return "backup-then-atomic";
  if (s.atomic > 0 && s.plain === 0) return "atomic";
  if (s.atomic > 0) return "mixed";
  if (s.plain > 0) return "plain";
  if (s.exclusive > 0) return "exclusive-create";
  return "none";
}

export interface EvidenceCheck {
  id: string;
  found: boolean;
  pass: boolean;
  summary: string;
}

export function checkEvidence(id: string, root = REPO_ROOT): EvidenceCheck {
  const text = read(`data/census/evidence/${id}.json`, root);
  if (text === undefined) return { id, found: false, pass: false, summary: "" };
  let summary = "";
  try {
    summary = String((JSON.parse(text) as { result_summary?: unknown }).result_summary ?? "");
  } catch {
    return { id, found: true, pass: false, summary: "unparsable" };
  }
  return { id, found: true, pass: /:\s*(PASS|pass)\b/.test(summary), summary };
}

export function checkTest(t: TestCite, root = REPO_ROOT): boolean {
  const text = read(t.file, root);
  return text !== undefined && text.includes(t.needle);
}

/** Every file under src/tools that makes a write call. */
export function writingToolFiles(root = REPO_ROOT): string[] {
  const dir = join(root, "src", "tools");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/tools/${f}`)
    .filter((rel) => {
      const c = code(read(rel, root) ?? "");
      return new RegExp(WRITE_CALL.source).test(c);
    })
    .sort();
}

// ── The audit ────────────────────────────────────────────────────────────────

export interface RowResult {
  row: Row;
  /** The round trip as checked: a cited test that is not there makes it missing. */
  roundTrip: RoundTripStatus;
  missingTests: TestCite[];
  accept: Array<Accept & { check?: EvidenceCheck }>;
  route: Route;
  guards: string[];
}

export interface Audit {
  rows: RowResult[];
  /** src/tools files that write and have no row and no NOT_PROJECT_WRITERS entry. */
  unlisted: string[];
  /** Rows where the round trip applies and is not present (missing, lossy, a cited test absent). */
  roundTripFailures: string[];
  /** Cited evidence that is absent or not a PASS. */
  evidenceFailures: string[];
  /** File types with no engine-accept proof on record, as "tool: type". */
  acceptGaps: string[];
  /** Rows whose writes are not all atomic. */
  routeGaps: string[];
  /** Rows with no path guard in their sources and no guard note. */
  guardGaps: string[];
  /**
   * Rows that do not write through the lossless parser (CST or a lossless model) and are not
   * creates-only, each with its write class in brackets.
   */
  parserGaps: string[];
  /**
   * Rows the lossless parser does not apply to because they only create new files: a creates-only
   * write class whose own source writes with flag "wx" alone (route exclusive-create).
   */
  createsOnly: string[];
}

const LOSSLESS = /^(CST|bt model|ini-edit)/;

/**
 * True when byte-edit's writeWithBackup replaces its file through writeFileAtomic and makes no
 * plain writeFileSync of its own (the .bak is a copy): then the route backup-then-atomic is atomic.
 */
export function writeWithBackupIsAtomic(root = REPO_ROOT): boolean {
  const text = read("src/refactor/byte-edit.ts", root);
  if (text === undefined) return false;
  const c = code(text);
  const start = c.indexOf("export function writeWithBackup(");
  if (start < 0) return false;
  const next = c.indexOf("\nexport ", start + 1);
  const body = c.slice(start, next < 0 ? undefined : next);
  return /\bwriteFileAtomic\(/.test(body) && !/\bwriteFileSync\(/.test(body);
}

export function runAudit(root = REPO_ROOT): Audit {
  const rows: RowResult[] = ROWS.map((row) => {
    const missingTests = row.roundTrip.tests.filter((t) => !checkTest(t, root));
    let roundTrip = row.roundTrip.status;
    if (roundTrip !== "n/a" && missingTests.length > 0) roundTrip = "missing";
    if ((roundTrip === "present" || roundTrip === "partial") && row.roundTrip.tests.length === 0)
      roundTrip = "missing";
    const scans = row.sources.map((s) => scanSource(s, root));
    // The tool's own file (the first source) decides the route; a shared helper (byte-edit,
    // clone-area, ini-edit) is read for guards only.
    return {
      row,
      roundTrip,
      missingTests,
      accept: row.accept.map((a) =>
        a.evidence ? { ...a, check: checkEvidence(a.evidence, root) } : a,
      ),
      route: routeOf(scans[0]),
      guards: [...new Set(scans.flatMap((s) => s.guards))],
    };
  });
  const listed = new Set([...ROWS.flatMap((r) => r.sources), ...Object.keys(NOT_PROJECT_WRITERS)]);
  const unlisted = writingToolFiles(root).filter((f) => !listed.has(f));
  const roundTripFailures = rows
    .filter((r) => r.roundTrip === "missing" || r.roundTrip === "lossy")
    .map(
      (r) =>
        `${r.row.tool}: ${r.roundTrip}${r.missingTests.length ? ` (cited test not found: ${r.missingTests.map((t) => t.needle).join("; ")})` : ""}`,
    );
  const evidenceFailures = rows.flatMap((r) =>
    r.accept
      .filter((a) => a.check && !(a.check.found && a.check.pass))
      .map(
        (a) =>
          `${r.row.tool} ${a.type}: ${a.evidence} ${a.check!.found ? "is not a PASS" : "not found"}`,
      ),
  );
  const acceptGaps = rows.flatMap((r) =>
    r.accept
      .filter((a) => !a.evidence)
      .map((a) => `${r.row.tool}: ${a.type}${a.note ? ` (${a.note})` : ""}`),
  );
  const backupAtomic = writeWithBackupIsAtomic(root);
  const routeGaps = rows
    .filter(
      (r) =>
        r.route !== "atomic" &&
        r.route !== "exclusive-create" &&
        !(r.route === "backup-then-atomic" && backupAtomic),
    )
    .map((r) => `${r.row.tool}: ${r.route}`);
  const guardGaps = rows
    .filter((r) => r.guards.length === 0 && !r.row.guardNote)
    .map((r) => r.row.tool)
    .concat(
      rows
        .filter((r) => /no project-root check/.test(r.row.guardNote ?? ""))
        .map((r) => r.row.tool),
    );
  const createsOnly = rows
    .filter((r) => r.row.writeClass?.kind === "creates-only" && r.route === "exclusive-create")
    .map((r) => r.row.tool);
  const parserGaps = rows
    .filter((r) => !LOSSLESS.test(r.row.parser) && !createsOnly.includes(r.row.tool))
    .map((r) => {
      const w = r.row.writeClass;
      const claim =
        w?.kind === "creates-only"
          ? ` [creates-only claimed, but the route is ${r.route}]`
          : w
            ? ` [${w.kind}]`
            : "";
      return `${r.row.tool}: ${r.row.parser}${claim}`;
    });
  return {
    rows,
    unlisted,
    roundTripFailures,
    evidenceFailures,
    acceptGaps,
    routeGaps,
    guardGaps,
    parserGaps,
    createsOnly,
  };
}

/** 1 when the round trip, the cited evidence or the enumeration fails; 0 otherwise. */
export function exitCode(a: Audit): number {
  return a.roundTripFailures.length + a.evidenceFailures.length + a.unlisted.length > 0 ? 1 : 0;
}

/** Criterion 7 as the plan words it: every list empty, the enumeration complete. */
export function criterionMet(a: Audit): boolean {
  return (
    exitCode(a) === 0 &&
    a.acceptGaps.length === 0 &&
    a.routeGaps.length === 0 &&
    a.guardGaps.length === 0 &&
    a.parserGaps.length === 0
  );
}

// ── Output ───────────────────────────────────────────────────────────────────

function acceptCell(r: RowResult): string {
  return r.accept
    .map((a) => {
      if (!a.evidence) return `${a.type}: MISSING`;
      const c = a.check!;
      return `${a.type}: ${a.evidence}${c.found ? (c.pass ? "" : " (not PASS)") : " (not found)"}`;
    })
    .join("; ");
}

export function formatTable(a: Audit): string {
  const head = ["tool", "kind", "parser", "round trip", "engine accept", "write route", "guard"];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of a.rows) {
    const guard = r.guards.length ? r.guards.join(", ") : "none";
    lines.push(
      `| ${r.row.tool} | ${r.row.kind} | ${r.row.parser} | ${r.roundTrip} | ${acceptCell(r)} | ${r.route} | ${guard}${r.row.guardNote ? `; ${r.row.guardNote}` : ""} |`,
    );
  }
  const section = (title: string, items: string[]) =>
    `\n${title} (${items.length})${items.length ? `\n${items.map((i) => `- ${i}`).join("\n")}` : ""}`;
  return [
    lines.join("\n"),
    section("Unlisted writers", a.unlisted),
    section("Round trip missing or lossy (exit 1)", a.roundTripFailures),
    section("Cited evidence absent or not PASS (exit 1)", a.evidenceFailures),
    section("Engine-accept proof missing", a.acceptGaps),
    section("Writes not all atomic", a.routeGaps),
    section("No project-path guard", a.guardGaps),
    section("Not through the lossless parser", a.parserGaps),
    section("Creates only (the lossless parser does not apply; every write wx)", a.createsOnly),
  ].join("\n");
}

const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const audit = runAudit();
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { ...audit, rows: audit.rows.map((r) => ({ ...r, row: r.row.tool })) },
        null,
        2,
      ),
    );
  } else {
    console.log(formatTable(audit));
  }
  const code = exitCode(audit);
  console.log(`\nexit ${code}: criterion 7 ${criterionMet(audit) ? "met" : "not met"}`);
  process.exit(code);
}
