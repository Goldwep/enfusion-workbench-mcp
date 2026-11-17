/**
 * Byte-exact round trip of the lossless CST (src/formats/enfusion-cst.ts) on
 * the vanilla corpus: the seeded sample of tests/corpus/_corpus.ts (at most
 * SAMPLE_PER_EXT files per text extension; every file under CORPUS_FULL=1),
 * the text extensions being the baseline's. Skips by the harness's rules
 * (tests/corpus/README.md). Plan 3.4 gate: 100% of the text files exact.
 */
import { describe, expect, it } from "vitest";
import { parseCstBytes, type CstEntry } from "../../src/formats/enfusion-cst.js";
import {
  CORPUS_FULL,
  emptyCounts,
  formatRoundTripTable,
  loadBaseline,
  openVanillaCorpus,
  sniffText,
  type RoundTripCounts,
} from "../corpus/_corpus.js";

const BASELINE = loadBaseline();
const OPEN = openVanillaCorpus(BASELINE);
if (OPEN.skip !== undefined) console.warn(`[corpus] cst round trip SKIPPED: ${OPEN.skip}`);
const EXTS = Object.keys(BASELINE?.roundtrip.extensions ?? {});
/** Not Enfusion text: their tree is not checked, only their bytes. */
const NOT_ENFUSION_TEXT = new Set(["c", "json", "txt"]);

function countOpaque(entries: readonly CstEntry[]): number {
  let n = 0;
  for (const e of entries) {
    if (e.kind === "opaque") n++;
    else if (e.kind === "object") n += countOpaque(e.children);
  }
  return n;
}

describe.skipIf(OPEN.skip !== undefined)(
  `cst round trip on the vanilla corpus, ${CORPUS_FULL ? "every file" : "seeded sample"}${
    OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""
  }`,
  () => {
    it(
      "every text file of every text extension serializes byte-exact",
      async () => {
        const corpus = OPEN.corpus!;
        const rows = new Map<string, RoundTripCounts>();
        const misses: string[] = [];
        const tree = new Map<string, { diagnostics: number; opaque: number; files: number }>();
        const treeMisses: string[] = [];
        for (const ext of EXTS) {
          const c = emptyCounts();
          const t = { diagnostics: 0, opaque: 0, files: 0 };
          for (const p of corpus.selection(ext)) {
            c.files++;
            let buf: Buffer;
            try {
              buf = corpus.read(p);
            } catch {
              c.unreadable++;
              continue;
            }
            const s = sniffText(buf);
            if (s === "empty") c.empty++;
            if (s !== "text") {
              if (s === "binary") c.not_text++;
              continue;
            }
            c.text_files++;
            const doc = parseCstBytes(buf); // never throws
            c.parsed++;
            if (doc.toBytes().equals(buf)) c.round_trip_exact++;
            else misses.push(`${ext}: ${p}`);
            const nd = doc.diagnostics.length;
            const no = countOpaque(doc.root.children);
            t.diagnostics += nd;
            t.opaque += no;
            if (nd + no > 0) {
              t.files++;
              if (!NOT_ENFUSION_TEXT.has(ext)) {
                treeMisses.push(
                  `${ext}: ${p}: ${doc.diagnostics.map((d) => `${d.line} ${d.message}`).join("; ")}`,
                );
              }
            }
          }
          rows.set(ext, c);
          tree.set(ext, t);
          await new Promise((r) => setImmediate(r));
        }
        console.log(`[corpus] cst round trip\n${formatRoundTripTable(rows)}`);
        expect(EXTS.length).toBeGreaterThan(0);
        console.log(
          `[corpus] cst tree (ext diagnostics opaque files-with-either)\n${[...tree]
            .map(([e, x]) => `${e} ${x.diagnostics} ${x.opaque} ${x.files}`)
            .join("\n")}`,
        );
        expect(misses).toEqual([]);
        expect(treeMisses).toEqual([]);
      },
      CORPUS_FULL ? 1_800_000 : 30_000,
    );
  },
);
