/**
 * Corpus round-trip test against a real Arma Reforger install.
 *
 * Gated on ENFUSION_GAME_PATH: skipped cleanly when the variable is unset, the
 * directory is missing, or no .et/.layer/.conf files can be found (in the paks
 * via the read-only PakVirtualFS, or loose under <game>/addons). Never fails on
 * a missing install.
 *
 * Asserts parse → serialize → parse yields a structurally equal AST (C1 /
 * M22). Byte-identity is NOT required here — bare enums get re-quoted today
 * (M22, out of scope) — but the C1-specific corruption signature (numeric
 * property keys, `0x… "coords"`) is asserted directly on every sampled file.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parse,
  serialize,
  isNumericScalar,
  type EnfusionNode,
} from "../../src/formats/enfusion-text.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";

const TEXT_EXT = /\.(et|layer|conf)$/i;
const PAK_SAMPLE = 30;
const LOOSE_SAMPLE = 20;

interface CorpusFile {
  name: string;
  text: string;
}

function evenSample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

/** Pull ~PAK_SAMPLE real text files from the paks (read-only), preferring hex-flag files. */
function loadPakCorpus(gamePath: string): CorpusFile[] {
  let vfs: PakVirtualFS | null = null;
  try {
    vfs = PakVirtualFS.get(gamePath);
  } catch {
    return [];
  }
  if (!vfs) return [];

  const paths = vfs.allFilePaths().filter((p) => TEXT_EXT.test(p));
  if (paths.length === 0) return [];

  // Read a wider even spread, then bias the final sample toward files that
  // actually contain the C1 trigger (`0x…` flag masks / exponent floats).
  const files: CorpusFile[] = [];
  for (const p of evenSample(paths, PAK_SAMPLE * 6)) {
    try {
      files.push({ name: `pak:${p}`, text: vfs.readTextFile(p) });
    } catch {
      // unreadable entry — skip, this test is about the parser
    }
  }
  const trigger = (t: string) => /\s0[xX][0-9A-Fa-f]+\b|\d[eE][-+]?\d/.test(t);
  const withTrigger = files.filter((f) => trigger(f.text));
  const without = files.filter((f) => !trigger(f.text));
  return [...withTrigger.slice(0, PAK_SAMPLE / 2), ...without].slice(0, PAK_SAMPLE);
}

/** Bounded walk for loose (extracted) text files under <game>/addons. */
function loadLooseCorpus(gamePath: string): CorpusFile[] {
  const root = join(gamePath, "addons");
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || found.length >= LOOSE_SAMPLE * 10) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full, depth + 1);
        else if (TEXT_EXT.test(name)) found.push(full);
      } catch {
        // ignore
      }
    }
  };
  walk(root, 0);
  const out: CorpusFile[] = [];
  for (const p of evenSample(found, LOOSE_SAMPLE)) {
    try {
      out.push({ name: `loose:${p}`, text: readFileSync(p, "utf-8") });
    } catch {
      // ignore
    }
  }
  return out;
}

const gamePath = process.env.ENFUSION_GAME_PATH;
const corpus: CorpusFile[] =
  gamePath && existsSync(gamePath) ? [...loadPakCorpus(gamePath), ...loadLooseCorpus(gamePath)] : [];

/** Strip the root-only eol marker so LF/CRLF sources compare structurally. */
function stripEol(node: EnfusionNode): EnfusionNode {
  const { eol: _eol, ...rest } = node;
  return rest;
}

function assertNoC1Corruption(node: EnfusionNode, file: string): void {
  for (const p of node.properties) {
    if (typeof p.value !== "string") {
      assertNoC1Corruption(p.value, file);
      continue;
    }
    // The C1 signature is a numeric-looking KEY whose value is NOT purely
    // numeric ({"0x3": "coords"}): a following key got swallowed as a value.
    // (A numeric key with an all-numeric value is the pre-existing bare
    // numeric-table case — e.g. AIBallisticTables `"Table data" { 0 0 0 … }`
    // — which is stable but out of scope here.)
    const allNumeric = p.value.split(" ").every(isNumericScalar);
    if (isNumericScalar(p.key) && !allNumeric) {
      expect.fail(`${file}: C1 corruption — numeric key "${p.key}" with value "${p.value.slice(0, 40)}"`);
    }
  }
  for (const c of node.children) assertNoC1Corruption(c, file);
}

describe.skipIf(corpus.length === 0)("real game corpus round-trip (ENFUSION_GAME_PATH)", () => {
  it("found a corpus sample", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const file of corpus) {
    it(`parse → serialize → parse is structurally stable: ${file.name}`, () => {
      const first = parse(file.text);
      assertNoC1Corruption(first, file.name);
      const text = serialize(first);
      expect(text, `${file.name}: serializer emitted the C1 signature`).not.toMatch(/0[xX][0-9A-Fa-f]+ "coords"/);
      const second = parse(text);
      expect(stripEol(second)).toEqual(stripEol(first));
      // Serializer output is a fixed point.
      expect(serialize(second)).toBe(text);
    });
  }
});
