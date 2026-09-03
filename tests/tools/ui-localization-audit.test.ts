import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  extractStringTableDecls,
  extractStKeys,
  extractRuntimeKeys,
  runLocalizationAudit,
  formatAuditReport,
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

const ST_FILE = `StringTable {
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
    const root = parse(`GameProject { ID "X" GUID "0000000000000000" }`);
    expect(extractStringTableDecls(root)).toEqual([]);
  });
});

describe("ui-localization-audit: key extractors", () => {
  it("pulls every Key entry from a .st", () => {
    const keys = extractStKeys(parse(ST_FILE));
    expect(keys.has("STR_TestMod_Welcome")).toBe(true);
    expect(keys.has("STR_TestMod_Quit")).toBe(true);
    expect(keys.size).toBe(3);
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
