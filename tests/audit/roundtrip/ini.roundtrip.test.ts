/**
 * Write-safety audit (plan section 11 criterion 7): the round trip of wb_settings' ini editor
 * (src/settings/ini-edit.ts), the parser and writer behind `wb_settings set` and `unset` on a
 * scratch ini.
 *
 * The tool's own input is a scratch ini made from a read-only export of the Workbench registry
 * key; there is no vanilla Workbench ini in the paks or the install. Two corpora are reachable
 * offline and each is skipped when absent:
 *
 *   - the scratch inis earlier wb_settings runs left in `<artifacts>/settings/scratch` (made from
 *     this machine's real registry key; read here, never copied);
 *   - the `.ini` files the game install ships (BattlEye's, under `<game>/battleye`): ini text the
 *     editor did not make, though not Workbench settings.
 *
 * The round trip per file: for every key line whose section and key are unique, `setValues` with
 * the value the line already holds must give the file back unchanged.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultArtifactsDir } from "../../../src/census/source-index.js";
import { parseIni, scratchDir, setValues } from "../../../src/settings/ini-edit.js";

function walkIni(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkIni(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".ini")) out.push(p);
  }
  return out;
}

function scratchFiles(): string[] {
  try {
    const dir = scratchDir(defaultArtifactsDir());
    return existsSync(dir) ? walkIni(dir) : [];
  } catch {
    return []; // ENFUSION_ARTIFACTS_DIR inside a git tree: refused, so no corpus
  }
}

function gameFiles(): string[] {
  const game = process.env.ENFUSION_GAME_PATH;
  if (!game || !existsSync(join(game, "battleye"))) return [];
  return walkIni(join(game, "battleye"));
}

/** Files whose identity sets did not give the text back, with the first key that broke it. */
function identityOff(files: readonly string[]): { off: string[]; keys: number } {
  const off: string[] = [];
  let keys = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lines = parseIni(text).lines;
    const count = new Map<string, number>();
    for (const l of lines) {
      if (l.key === null || l.section === null) continue;
      const k = `${l.section}\u0000${l.key}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
    for (const l of lines) {
      if (l.key === null || l.section === null || !l.section) continue;
      if (count.get(`${l.section}\u0000${l.key}`) !== 1) continue;
      const value = l.text.slice(l.key.length + 1);
      let back: string;
      try {
        back = setValues(text, [{ section: l.section, key: l.key, value }]).text;
      } catch {
        continue; // a key the editor refuses (NetAPI_, a bracket in the section): never written
      }
      keys++;
      if (back !== text) {
        off.push(`${f}: ${l.section}/${l.key}`);
        break;
      }
    }
  }
  return { off, keys };
}

const scratch = scratchFiles();
const game = gameFiles();

describe("wb_settings ini editor round trip", () => {
  it.skipIf(scratch.length === 0)(
    `gives every scratch ini back byte for byte under identity sets${scratch.length ? "" : " (SKIPPED: no scratch inis)"}`,
    () => {
      const r = identityOff(scratch);
      console.log(
        `[write-safety] scratch inis: ${scratch.length - r.off.length}/${scratch.length} files, ${r.keys} identity sets`,
      );
      expect(r.keys).toBeGreaterThan(0);
      expect(r.off).toEqual([]);
    },
    // The corpus grows with every live sitting (one scratch ini each): 41 s on 2026-11-14.
    300_000,
  );

  it.skipIf(game.length === 0)(
    `gives every .ini the game install ships back byte for byte under identity sets${game.length ? "" : " (SKIPPED: ENFUSION_GAME_PATH has no battleye folder)"}`,
    () => {
      const r = identityOff(game);
      console.log(
        `[write-safety] game inis: ${game.length - r.off.length}/${game.length} files, ${r.keys} identity sets`,
      );
      expect(r.off).toEqual([]);
    },
  );

  it("keeps CRLF, LF and a missing final line break as they were (synthetic)", () => {
    for (const text of ["[A]\r\nk=1\r\n", "[A]\nk=1\n", "[A]\nk=1"]) {
      expect(setValues(text, [{ section: "A", key: "k", value: "1" }]).text).toBe(text);
    }
  });
});
