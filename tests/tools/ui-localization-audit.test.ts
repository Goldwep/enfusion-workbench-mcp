import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../../src/formats/enfusion-text.js";
import { loadBaseline, openVanillaCorpus } from "../corpus/_corpus.js";
import {
  extractStringTableDecls,
  extractStKeys,
  readStIds,
  extractRuntimeKeys,
  runLocalizationAudit,
  formatAuditReport,
  readRuntimeIds,
  extractLayoutRefs,
} from "../../src/tools/ui-localization-audit.js";

const GPROJ = `GameProject {
 ID "TestMod"
 GUID "11AA22BB33CC44DD"
 StringTables {
  StringTableDefinition {
   StringTableSource "ui/language/default.st"
   Languages {
    LanguageDefinition {
     Code "en_us"
     StringTableRuntime "ui/language/default.en_us.conf"
    }
    LanguageDefinition {
     Code "fr_fr"
     StringTableRuntime "ui/language/default.fr_fr.conf"
    }
   }
  }
 }
}`;

/** The engine's .st grammar: a BaseContainer StringTable with Items (W3 spec 2.5). */
const ST_FILE = `StringTable {
 Items {
  CustomStringTableItem {
   Id "STR_TestMod_Welcome"
   Target_en_us "Welcome"
  }
  CustomStringTableItem {
   Id "STR_TestMod_Quit"
   Target_en_us "Quit"
  }
  CustomStringTableItem {
   Id "STR_TestMod_OnlyDeclared"
   Target_en_us "Only declared"
   Key "NotAnId"
  }
 }
}`;

/** The older hand-made shape (flat Key entries), still read as a fallback. */
const ST_LEGACY = `StringTable {
 Key "STR_TestMod_Welcome"
 Key "STR_TestMod_Quit"
 Key "STR_TestMod_OnlyDeclared"
}`;

const EN_CONF = `Runtime {
 Key "STR_TestMod_Welcome"
 Key "STR_TestMod_Quit"
 Key "STR_TestMod_OrphanInEN"
}`;

const FR_CONF = `Runtime {
 Key "STR_TestMod_Welcome"
}`;

describe("ui-localization-audit: extractStringTableDecls", () => {
  it("pulls source path + each LanguageDefinition entry from a .gproj", () => {
    const root = parse(GPROJ);
    const decls = extractStringTableDecls(root);
    expect(decls).toHaveLength(1);
    expect(decls[0].sourcePath).toBe("ui/language/default.st");
    expect(decls[0].languages).toEqual([
      { code: "en_us", runtimePath: "ui/language/default.en_us.conf" },
      { code: "fr_fr", runtimePath: "ui/language/default.fr_fr.conf" },
    ]);
  });

  it("returns empty when no StringTables container is present", () => {
    const root = parse('GameProject { ID "X" GUID "0000000000000000" }');
    expect(extractStringTableDecls(root)).toEqual([]);
  });
});

describe("ui-localization-audit: key extractors", () => {
  it("reads Items[].Id of a .st through the string_table parser", () => {
    expect(readStIds(Buffer.from(ST_FILE, "utf-8"))).toEqual([
      "STR_TestMod_Welcome",
      "STR_TestMod_Quit",
      "STR_TestMod_OnlyDeclared",
    ]);
  });

  it("the 1.x Key extractor found nothing in a real .st (the defect W3 fixes)", () => {
    // A Key field inside an item is not an Id; the old extractor read only Key entries.
    expect([...extractStKeys(parse(ST_FILE))]).toEqual(["NotAnId"]);
  });

  it("reads a UTF-16LE .st with a byte-order mark", () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ST_FILE, "utf16le")]);
    expect(readStIds(bytes)).toHaveLength(3);
  });

  it("skips empty and repeated Ids", () => {
    const st = `StringTable {
 Items {
  CustomStringTableItem {
   Id "A"
  }
  CustomStringTableItem {
   Id ""
  }
  CustomStringTableItem {
   Target_en_us "no id"
  }
  CustomStringTableItem {
   Id "A"
  }
 }
}`;
    expect(readStIds(Buffer.from(st, "utf-8"))).toEqual(["A"]);
  });

  it("falls back to the legacy Key shape, and reads nothing from other text", () => {
    expect(readStIds(Buffer.from(ST_LEGACY, "utf-8")).sort()).toEqual([
      "STR_TestMod_OnlyDeclared",
      "STR_TestMod_Quit",
      "STR_TestMod_Welcome",
    ]);
    expect(extractStKeys(parse(ST_LEGACY)).size).toBe(3);
    expect(readStIds(Buffer.from('<StringTable><Key Id="X"/></StringTable>', "utf-8"))).toEqual([]);
  });

  it("pulls translated keys from a runtime .conf", () => {
    const keys = extractRuntimeKeys(parse(EN_CONF));
    expect(keys.size).toBe(3);
    expect(keys.has("STR_TestMod_OrphanInEN")).toBe(true);
  });
});

describe("ui-localization-audit: runLocalizationAudit (in-memory fixture)", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("synthesizes a gproj+st+conf set and reports missing / orphan keys per language", () => {
    tmp = mkdtempSync(join(tmpdir(), "uiloc-audit-"));
    const uiDir = join(tmp, "ui", "language");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(tmp, "addon.gproj"), GPROJ, "utf-8");
    writeFileSync(join(uiDir, "default.st"), ST_FILE, "utf-8");
    writeFileSync(join(uiDir, "default.en_us.conf"), EN_CONF, "utf-8");
    writeFileSync(join(uiDir, "default.fr_fr.conf"), FR_CONF, "utf-8");

    const report = runLocalizationAudit(join(tmp, "addon.gproj"));
    expect(report.tables).toHaveLength(1);
    const table = report.tables[0];
    expect(table.sourceFound).toBe(true);
    expect(table.declaredCount).toBe(3);

    const en = table.languages.find((l) => l.code === "en_us")!;
    expect(en.runtimeFound).toBe(true);
    expect(en.translatedCount).toBe(3);
    // Welcome+Quit declared & translated, OnlyDeclared missing, OrphanInEN orphan
    expect(en.missingKeys).toEqual(["STR_TestMod_OnlyDeclared"]);
    expect(en.orphanKeys).toEqual(["STR_TestMod_OrphanInEN"]);

    const fr = table.languages.find((l) => l.code === "fr_fr")!;
    expect(fr.translatedCount).toBe(1);
    expect(fr.missingKeys.length).toBe(2); // Quit + OnlyDeclared

    const md = formatAuditReport(report);
    expect(md).toContain("StringTable: ui/language/default.st");
    expect(md).toContain("| en_us | 3 | 1 | 1 | yes |");
    expect(md).toContain("STR_TestMod_OnlyDeclared");
  });
});

// ── Real shape: Ids block, #KEY layout references ────────────────────────────

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): string => readFileSync(join(FIX, name), "utf-8");

describe("ui-localization-audit: runtime Ids block", () => {
  it("reads the Ids entries of a StringTableRuntime", () => {
    expect(readRuntimeIds(fixture("ui-locaudit-runtime.en_us.conf"))).toEqual([
      "MOD-Title",
      "MOD-Play",
      "MOD-Unused",
    ]);
    expect(extractRuntimeKeys(parse(fixture("ui-locaudit-runtime.en_us.conf"))).size).toBe(3);
  });

  it("keeps the Ids when the Texts block holds backslash-quote runs (as vanilla does)", () => {
    const text = fixture("ui-locaudit-unparsable.en_us.conf");
    expect(() => parse(text)).toThrow();
    expect(readRuntimeIds(text)).toEqual(["MOD-A", "MOD-B"]);
  });

  it("reads nothing from text with no Ids block and no parse", () => {
    expect(readRuntimeIds("not a table {{{")).toEqual([]);
  });
});

describe("ui-localization-audit: layout references", () => {
  it("collects #KEY references, ignores colour codes, counts repeats", () => {
    const { refs, fallback } = extractLayoutRefs(fixture("ui-locaudit-menu.layout"));
    expect(fallback).toBe(false);
    expect([...refs.keys()].sort()).toEqual(["MOD-Gone", "MOD-Play", "MOD-Title", "mod-title"]);
    expect(refs.get("MOD-Play")).toBe(1);
  });

  it("falls back to a literal scan when the parser rejects the layout", () => {
    const { refs, fallback } = extractLayoutRefs('Broken { Text "#A-B" Text "x" "#A-B" ');
    expect(fallback).toBe(true);
    expect(refs.get("A-B")).toBe(2);
  });
});

describe("ui-localization-audit: layouts against tables (synthetic project)", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("reports missing, case-only and unused keys with counts and files", () => {
    tmp = mkdtempSync(join(tmpdir(), "uiloc-audit-"));
    mkdirSync(join(tmp, "ui", "language"), { recursive: true });
    mkdirSync(join(tmp, "Screens"), { recursive: true });
    writeFileSync(join(tmp, "addon.gproj"), GPROJ, "utf-8");
    copyFileSync(join(FIX, "ui-locaudit-default.st"), join(tmp, "ui", "language", "default.st"));
    copyFileSync(
      join(FIX, "ui-locaudit-runtime.en_us.conf"),
      join(tmp, "ui", "language", "default.en_us.conf"),
    );
    copyFileSync(join(FIX, "ui-locaudit-menu.layout"), join(tmp, "Screens", "Menu.layout"));

    const report = runLocalizationAudit(join(tmp, "addon.gproj"));
    const l = report.layouts!;
    expect(l.layoutFiles).toBe(1);
    expect(l.totalRefs).toBe(4);
    expect(l.distinctRefs).toBe(4);
    expect(l.missing).toEqual([{ key: "MOD-Gone", count: 1, files: ["Screens/Menu.layout"] }]);
    expect(l.caseMismatches).toEqual([
      { key: "mod-title", count: 1, files: ["Screens/Menu.layout"], definedAs: "MOD-Title" },
    ]);
    // Defined: .st (Title, Play, OnlyInSource) + en_us Ids (Title, Play, Unused); fr_fr conf absent.
    expect(l.unused).toEqual(["MOD-OnlyInSource", "MOD-Unused"]);
    expect(l.definedKeys).toBe(4);

    const md = formatAuditReport(report);
    expect(md).toContain("**Missing (1):**");
    expect(md).toContain("`MOD-Gone` x1: Screens/Menu.layout");
    expect(md).toContain("`mod-title` x1 vs `MOD-Title`");
  });

  it("extra_tables keys count as defined and are never unused", () => {
    tmp = mkdtempSync(join(tmpdir(), "uiloc-audit-"));
    writeFileSync(join(tmp, "addon.gproj"), 'GameProject { ID "X" }', "utf-8");
    copyFileSync(join(FIX, "ui-locaudit-menu.layout"), join(tmp, "Menu.layout"));
    copyFileSync(join(FIX, "ui-locaudit-runtime.en_us.conf"), join(tmp, "vanilla.conf"));
    const l = runLocalizationAudit(join(tmp, "addon.gproj"), {
      extraTables: ["vanilla.conf"],
    }).layouts!;
    expect(l.missing.map((m) => m.key)).toEqual(["MOD-Gone"]);
    expect(l.unused).toEqual([]);
  });

  it("omits the layout section when the project holds no layout", () => {
    tmp = mkdtempSync(join(tmpdir(), "uiloc-audit-"));
    writeFileSync(join(tmp, "addon.gproj"), GPROJ, "utf-8");
    expect(runLocalizationAudit(join(tmp, "addon.gproj")).layouts).toBeUndefined();
  });
});

// ── Vanilla corpus sample (skips without the game) ───────────────────────────

const OPEN = openVanillaCorpus(loadBaseline());

describe.skipIf(OPEN.skip !== undefined)(
  `ui-localization-audit on the vanilla corpus${OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""}`,
  () => {
    it("reads the Ids of every runtime string table (count from the raw text)", () => {
      const corpus = OPEN.corpus!;
      const files = corpus
        .list("conf")
        .filter((p) =>
          /^\s*StringTableRuntime\s*\{/.test(corpus.read(p).subarray(0, 256).toString("utf-8")),
        );
      expect(files.length).toBeGreaterThan(0);
      let independent = 0;
      let yielded = 0;
      for (const p of files) {
        const text = corpus.readText(p);
        const a = text.indexOf("Ids {");
        const b = text.indexOf("\n }", a);
        independent += text
          .slice(a, b)
          .split("\n")
          .filter((l) => /^\s*"/.test(l)).length;
        yielded += readRuntimeIds(text).length;
      }
      expect(independent).toBeGreaterThan(0);
      expect(yielded).toBe(independent);
    }, 120_000);

    it("finds #AR- references in vanilla layouts and resolves nearly all against the runtime tables", () => {
      const corpus = OPEN.corpus!;
      const defined = new Set<string>();
      for (const p of ["Language/localization.en_us.conf", "ui/language/default.en_us.conf"]) {
        for (const k of readRuntimeIds(corpus.readText(p))) defined.add(k);
      }
      expect(defined.size).toBeGreaterThan(1000);
      let refs = 0;
      let unresolved = 0;
      for (const p of corpus.sample("layout", 120)) {
        for (const [k, n] of extractLayoutRefs(corpus.readText(p)).refs) {
          if (!k.startsWith("AR-") && !k.startsWith("ar-")) continue;
          refs += n;
          if (!defined.has(k)) unresolved += n;
        }
      }
      expect(refs).toBeGreaterThan(0);
      expect(unresolved / refs).toBeLessThan(0.1);
    }, 120_000);
  },
);
