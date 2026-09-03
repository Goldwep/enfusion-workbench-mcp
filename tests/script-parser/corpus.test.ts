/**
 * Real-corpus regression for the Enforce parser (audit H12).
 *
 * Reads vanilla scripts straight out of the game paks (read-only) and
 * asserts the parser produces zero diagnostics and zero phantom fields
 * (a field named or typed like a modifier / keyword). Skipped when the
 * game install is absent.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { parseScript } from "../../src/script-parser/parser.ts";

const GAME_PATH = process.env.ENFUSION_GAME_PATH ?? "D:/SteamLibrary/steamapps/common/Arma Reforger";
const HAVE_GAME = existsSync(GAME_PATH);

const CORPUS = [
  "scripts/Game/GameMode/SCR_BaseGameMode.c",
  "scripts/Game/Inventory/SCR_InventoryStorageManagerComponent.c",
  "scripts/Game/Character/SCR_CharacterControllerComponent.c",
  "scripts/Game/Character/SCR_CharacterStaminaComponent.c",
  "scripts/Game/Character/SCR_CharacterCommandHandler.c",
  "scripts/Game/Entities/SCR_AIGroup.c",
  "scripts/Game/Entities/SCR_FuelNozzle.c",
  "scripts/Game/Weapon/SCR_WeaponStatsManagerComponent.c",
  "scripts/Game/Editor/SCR_EditorSettings.c",
  "scripts/Game/Vehicle/SCR_CompartmentAccessComponent.c",
  "scripts/Game/Campaign/SCR_CampaignMilitaryBaseManager.c",
  "scripts/Game/Campaign/SCR_CampaignNetworkComponent.c",
];

const RESERVED = new Set([
  "static", "const", "protected", "private", "override", "proto", "native", "external", "sealed",
  "ref", "autoptr", "out", "inout", "notnull", "event", "owned", "volatile",
  "typedef", "class", "modded", "enum", "endif", "ifdef", "else", "define",
]);

describe.skipIf(!HAVE_GAME)("parser — vanilla script corpus", () => {
  it("parses real vanilla scripts with zero diagnostics and zero phantom fields", async () => {
    const { PakVirtualFS } = await import("../../src/pak/vfs.ts");
    const vfs = PakVirtualFS.get(GAME_PATH);
    expect(vfs, "PakVirtualFS failed to initialize").not.toBeNull();

    const report: string[] = [];
    let filesChecked = 0;
    for (const rel of CORPUS) {
      let src: string;
      try {
        src = vfs!.readTextFile(rel);
      } catch {
        report.push(`${rel}: MISSING from paks`);
        continue;
      }
      filesChecked += 1;
      const ast = parseScript(src, rel);
      expect(ast.classes.length, `${rel}: no classes recovered`).toBeGreaterThan(0);
      for (const d of ast.diagnostics) {
        report.push(`${rel}:${d.range.start.line} ${d.message}`);
      }
      for (const cls of ast.classes) {
        for (const f of cls.fields) {
          if (RESERVED.has(f.name) || RESERVED.has(f.type) || f.name.startsWith("#") || /[<>]/.test(f.name)) {
            report.push(`${rel}: phantom field ${cls.name}.${f.name} : ${f.type}`);
          }
          if (f.type === "auto") report.push(`${rel}: field ${cls.name}.${f.name} lost its type`);
        }
        for (const m of cls.methods) {
          if (RESERVED.has(m.name)) report.push(`${rel}: phantom method ${cls.name}.${m.name}`);
        }
      }
    }
    expect(filesChecked).toBeGreaterThanOrEqual(10);
    expect(report).toEqual([]);
  }, 60_000);
});
