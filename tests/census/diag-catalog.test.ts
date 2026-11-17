import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DIAG_CATALOG_VERSION,
  buildDiagCatalog,
  catalogRow,
  diagCatalogText,
  filterByMenu,
  findDiagEntry,
  findRegistrations,
  loadDiagCatalog,
  maskSource,
  parseDiagCatalog,
  type DiagCatalog,
} from "../../src/census/diag-catalog.js";
import { CensusDataError } from "../../src/census/ledger-io.js";
import {
  loadSourceIndex,
  parseSourceIndexText,
  sourceIndexPath,
  type SourceInput,
} from "../../src/census/source-index.js";
import { run } from "../../scripts/census/gen-diag-catalog.js";
import { memoryIo } from "../../scripts/census/cli-common.js";

const FIXTURES = resolve(import.meta.dirname, "..", "fixtures", "diag");
const INDEX_FILE = join(FIXTURES, "source-index.jsonl");
const SCRIPTS_DIR = join(FIXTURES, "scripts");

/** The fixture mirrors the 1.9.0.37 index: every SCR_DebugMenuID and EDiagMenu record of it. */
const index = parseSourceIndexText(readFileSync(INDEX_FILE, "utf-8"));

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const excerpts: SourceInput[] = listFiles(SCRIPTS_DIR).map((f) => ({
  path: relative(SCRIPTS_DIR, f).replace(/\\/g, "/"),
  text: readFileSync(f, "utf-8"),
}));

const catalog = buildDiagCatalog({ index, sources: excerpts });
const entry = (name: string) => {
  const e = findDiagEntry(catalog, name);
  if (!e) throw new Error(`no entry ${name}`);
  return e;
};

const tmp = mkdtempSync(join(tmpdir(), "diag-catalog-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("diag catalog counts (fixture mirroring the E02 index)", () => {
  it("holds 268 unguarded SCR_DebugMenuID names and 7 EDiagMenu names", () => {
    const script = catalog.entries.filter((e) => e.enum === "SCR_DebugMenuID");
    const engine = catalog.entries.filter((e) => e.enum === "EDiagMenu");
    expect(script.filter((e) => e.guard === "")).toHaveLength(268);
    expect(engine).toHaveLength(7);
    expect(catalog.counts.engine).toBe(7);
    expect(catalog.counts.script).toBe(269);
  });

  it("flags the one ENABLE_DIAG value (the modded Autotest id), and only it", () => {
    const guarded = catalog.entries.filter((e) => e.guard !== "");
    expect(guarded.map((e) => e.enumName)).toEqual(["DEBUGUI_AUTOTEST_PROGRESS"]);
    expect(guarded[0].guard).toBe("ENABLE_DIAG");
    expect(catalog.counts.script_guarded).toBe(1);
  });

  it("lists the base enum first, in source order, the modded value after it", () => {
    const script = catalog.entries.filter((e) => e.enum === "SCR_DebugMenuID");
    expect(script[0].enumName).toBe("DEBUGUI_DRAW_CAMERA_COLLISION_SOLVER");
    expect(script[0].declared).toBe("scripts/Game/Utilities/DebugMenuID.c:6");
    expect(script[267].enumName).toBe("DEBUGUI_DAMAGE_AREA_MARKERS");
    expect(script[268].enumName).toBe("DEBUGUI_AUTOTEST_PROGRESS");
  });

  it("numbers the base ids from the explicit 0, and leaves the modded id unknown", () => {
    expect(entry("DEBUGUI_DRAW_CAMERA_COLLISION_SOLVER").id).toBe(0);
    expect(entry("DEBUGUI_DAMAGE_AREA_MARKERS").id).toBe(267);
    expect(entry("DEBUGUI_AUTOTEST_PROGRESS").id).toBeNull();
    expect(entry("DM_REND_SHOWVOLUMETRICRAYS").id).toBe(0);
    expect(entry("DM_REND_VSYNC_OVERRIDE").id).toBe(6);
  });

  it("gives every engine id kind engine and every unregistered script id kind unknown", () => {
    for (const e of catalog.entries.filter((x) => x.enum === "EDiagMenu")) {
      expect(e.kind).toBe("engine");
    }
    const unregistered = catalog.entries.filter(
      (e) => e.enum === "SCR_DebugMenuID" && e.registrations === 0,
    );
    expect(unregistered.length).toBeGreaterThan(250);
    for (const e of unregistered) {
      expect(e.kind).toBe("unknown");
      expect(e.path).toBe("");
      expect(e.registered).toBe("");
    }
  });
});

describe("Register* calls (excerpts)", () => {
  it("reads each call kind with its label, parent, values and shortcut", () => {
    expect(entry("DEBUGUI_AI_PRINT_DEBUG")).toMatchObject({
      kind: "bool",
      path: "AI/AIScript/Print debug",
      label: "Print debug",
    });
    expect(entry("DEBUGUI_CHARACTER_ADS_CAMERA")).toMatchObject({
      kind: "range",
      path: "Character/ADS Camera",
      values: "0, 3, 0, 1",
    });
    expect(entry("DEBUGUI_VEHICLES_COLLISIONS")).toMatchObject({
      kind: "value",
      values: "disabled,base,all",
    });
    expect(entry("DEBUGUI_MANUAL_CAMERA_DEBUG")).toMatchObject({
      kind: "bool",
      shortcut: "lshift+lalt+d",
      path: "Manual Camera/Show debug; menu",
    });
  });

  it("builds menu paths from RegisterMenu parents; an unregistered parent is the root", () => {
    expect(entry("DEBUGUI_AI_SCRIPT")).toMatchObject({ kind: "menu", path: "AI/AIScript" });
    expect(entry("DEBUGUI_MANUAL_CAMERA")).toMatchObject({ kind: "menu", path: "Manual Camera" });
  });

  it("reads a call that spans lines; a non-literal values argument leaves values empty", () => {
    const e = entry("DEBUGUI_AI_DEBUG_CATEGORY");
    expect(e.kind).toBe("value");
    expect(e.values).toBe("");
    expect(e.registered).toBe("scripts/Game/AI/DiagExcerptAI.c:8");
  });

  it("skips calls in line comments, block comments and strings", () => {
    expect(entry("DEBUGUI_SINGLEPLAYER").registrations).toBe(0);
    expect(entry("DEBUGUI_SINGLEPLAYER").kind).toBe("unknown");
  });

  it("counts a call with another id expression as other, not as a catalog entry", () => {
    expect(catalog.sources.register_calls_other).toBe(1);
    expect(catalog.sources.register_calls).toBe(12);
  });

  it("keeps an id registered twice with one kind, and answers unknown for two kinds", () => {
    expect(entry("DEBUGUI_SCRIPTS_MENU")).toMatchObject({
      kind: "menu",
      registrations: 2,
      path: "Physics/Scripts",
    });
    expect(entry("DEBUGUI_CHARACTER_MENU")).toMatchObject({ kind: "unknown", registrations: 2 });
  });

  it("registers the guarded id from its #ifdef block", () => {
    expect(entry("DEBUGUI_AUTOTEST_PROGRESS")).toMatchObject({
      kind: "bool",
      path: "GameCode/Autotest status",
    });
  });

  it("maskSource blanks comments and, on request, string contents, keeping offsets", () => {
    const text = 'a // x\nb /* y\n z */ "s // t"';
    const m = maskSource(text);
    expect(m).toHaveLength(text.length);
    expect(m).toContain('"s // t"');
    expect(m.split("\n")).toHaveLength(3);
    expect(maskSource(text, true)).not.toContain("s // t");
  });

  it("findRegistrations reports the line of the call", () => {
    const { registrations } = findRegistrations(
      "x.c",
      '\n\nDiagMenu.RegisterBool(SCR_DebugMenuID.A, "", "L", "P");',
    );
    expect(registrations).toEqual([
      expect.objectContaining({ enumName: "A", kind: "bool", line: 3, parent: "P" }),
    ]);
  });
});

describe("rows, filter and file", () => {
  it("prints the contract row path;enumName;kind;values with ';' in a field made ','", () => {
    expect(catalogRow(entry("DEBUGUI_CHARACTER_ADS_CAMERA"))).toBe(
      "Character/ADS Camera;DEBUGUI_CHARACTER_ADS_CAMERA;range;0, 3, 0, 1",
    );
    expect(catalogRow(entry("DEBUGUI_MANUAL_CAMERA_DEBUG"))).toBe(
      "Manual Camera/Show debug, menu;DEBUGUI_MANUAL_CAMERA_DEBUG;bool;",
    );
  });

  it("filters by a menu path prefix segment-wise, case-insensitively", () => {
    const ai = filterByMenu(catalog.entries, "ai/AIScript/").map((e) => e.enumName);
    expect(ai).toEqual([
      "DEBUGUI_AI_SCRIPT",
      "DEBUGUI_AI_PRINT_DEBUG",
      "DEBUGUI_AI_DEBUG_CATEGORY",
    ]);
    expect(filterByMenu(catalog.entries, "AI/AIScr")).toEqual([]);
    expect(filterByMenu(catalog.entries, "")).toHaveLength(catalog.entries.length);
  });

  it("writes deterministic text that loads back and checks", () => {
    const text = diagCatalogText(catalog);
    expect(text).toBe(
      diagCatalogText(buildDiagCatalog({ index, sources: [...excerpts].reverse() })),
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    const parsed = parseDiagCatalog(JSON.parse(text));
    expect(parsed.entries).toHaveLength(276);
    expect(parsed.$diag_catalog).toBe(DIAG_CATALOG_VERSION);
  });

  it("refuses a malformed or duplicated catalog with CensusDataError", () => {
    expect(() => parseDiagCatalog({ $diag_catalog: 2 })).toThrow(CensusDataError);
    const twice: DiagCatalog = { ...catalog, entries: [catalog.entries[0], catalog.entries[0]] };
    expect(() => parseDiagCatalog(JSON.parse(JSON.stringify(twice)))).toThrow(/listed twice/);
  });

  it("loadDiagCatalog answers undefined for an absent file", () => {
    expect(loadDiagCatalog(join(tmp, "absent.json"))).toBeUndefined();
  });
});

describe("gen-diag-catalog CLI", () => {
  it("writes the catalog from an index and a scripts folder, then --check matches", () => {
    const out = join(tmp, "diag-catalog.json");
    const io = memoryIo();
    const args = [
      "--build",
      "1.9.0.37",
      "--index",
      INDEX_FILE,
      "--scripts",
      SCRIPTS_DIR,
      "--out",
      out,
    ];
    expect(run(args, io)).toBe(0);
    expect(io.stdout()).toContain("269 script ids (1 guarded");
    expect(io.stdout()).toContain("7 engine ids");
    const loaded = loadDiagCatalog(out);
    expect(loaded?.entries).toHaveLength(276);
    expect(readFileSync(out, "utf-8")).toBe(diagCatalogText(catalog));
    const check = memoryIo();
    expect(run([...args, "--check"], check)).toBe(0);
  });

  it("--check fails on a missing file; a missing index is a usage error", () => {
    const io = memoryIo();
    const base = ["--build", "1.9.0.37", "--scripts", SCRIPTS_DIR];
    expect(
      run([...base, "--index", INDEX_FILE, "--out", join(tmp, "none.json"), "--check"], io),
    ).toBe(1);
    const io2 = memoryIo();
    expect(
      run([...base, "--index", join(tmp, "no-index.jsonl"), "--out", join(tmp, "x.json")], io2),
    ).toBe(2);
    expect(io2.stderr()).toContain("no E02 source index");
  });
});

/** The real E02 index of the census build, when this machine has it. */
const REAL_INDEX = sourceIndexPath("1.9.0.37");

describe.skipIf(!existsSync(REAL_INDEX))("the real 1.9.0.37 E02 index", () => {
  it("gives the same 268 + 7 names and the one ENABLE_DIAG value as the fixture", () => {
    const real = loadSourceIndex("1.9.0.37", { file: REAL_INDEX });
    expect(real).toBeDefined();
    const c = buildDiagCatalog({ index: real!, sources: [] });
    const fixture = buildDiagCatalog({ index, sources: [] });
    expect(c.entries.map((e) => [e.enumName, e.id, e.guard])).toEqual(
      fixture.entries.map((e) => [e.enumName, e.id, e.guard]),
    );
  }, 120_000);
});
