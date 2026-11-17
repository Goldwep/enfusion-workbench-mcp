/**
 * Round trip of the repository's Enfusion text parser and serializer
 * (`src/formats/enfusion-text.ts`) over the vanilla corpus, per text
 * extension: how many files parse, and how many come back byte-exact.
 *
 * Default run: the seeded sample (at most 200 files per extension), checked
 * against the sample's own recorded counts. `CORPUS_FULL=1`: every file,
 * checked against the whole-corpus counts. Numbers may only go up; a rise
 * passes and prints how to record it. See tests/corpus/README.md.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_FULL,
  CORPUS_UPDATE,
  Corpus,
  SAMPLE_PER_EXT,
  SAMPLE_SEED,
  UPDATE_INSTRUCTION,
  compareCounts,
  countOutcomes,
  emptyCounts,
  formatRoundTripTable,
  loadBaseline,
  mergeComparisons,
  openVanillaCorpus,
  roundTripFile,
  roundTripFiles,
  seededSample,
  sniffText,
  sumCounts,
  textExtensions,
  writeBaseline,
  type Baseline,
  type Comparison,
  type FileOutcome,
  type PakSource,
  type RoundTripCounts,
} from "./_corpus.js";

// ── The harness itself, on synthetic input (always runs) ─────────────────────

function fakePak(files: Record<string, string | Buffer>): PakSource {
  return {
    allFilePaths: () => Object.keys(files),
    readFile: (p) => {
      const v = files[p];
      if (v === undefined) throw new Error(`File not found in pak: ${p}`);
      return Buffer.isBuffer(v) ? v : Buffer.from(v, "utf-8");
    },
  };
}

describe("corpus harness", () => {
  it("sniffs text and binary by the E09 rule", () => {
    expect(sniffText(Buffer.alloc(0))).toBe("empty");
    expect(sniffText(Buffer.from("Node {\n}\n"))).toBe("text");
    expect(sniffText(Buffer.from([0x41, 0x00, 0x42]))).toBe("binary");
    expect(sniffText(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe("text");
    expect(sniffText(Buffer.from(Array(10).fill(0xc3)))).toBe("binary");
  });

  it("lists by extension and draws the same seeded sample every time", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[`a/f${String(i).padStart(2, "0")}.et`] = "X {\n}";
    files["a/b.conf"] = "Y {\n}";
    files["a/noext"] = "";
    const corpus = new Corpus(fakePak(files), "0.0.0.0");
    expect(corpus.list("et")).toHaveLength(50);
    expect(corpus.list("ET")).toHaveLength(50);
    expect(corpus.extensions()).toEqual(["conf", "et"]);
    const s1 = corpus.sample("et", 10);
    expect(s1).toHaveLength(10);
    expect(corpus.sample("et", 10)).toEqual(s1);
    expect(seededSample(corpus.list("et"), 10, "et", "another-seed")).not.toEqual(s1);
    expect(corpus.sample("conf", 10)).toEqual(["a/b.conf"]);
    expect(corpus.selection("et", true)).toHaveLength(50);
    expect(corpus.selection("et", false)).toHaveLength(Math.min(50, SAMPLE_PER_EXT));
  });

  it("classifies each file's round trip", async () => {
    const exact = 'Node {\n Key "v"\n}';
    const corpus = new Corpus(
      fakePak({
        "x/exact.conf": exact,
        "x/reformatted.conf": 'Node {\n  Key "v"\n}',
        "x/broken.conf": "Node {",
        "x/empty.conf": "",
        "x/binary.conf": Buffer.from([0x00, 0x01]),
      }),
      "0.0.0.0",
    );
    expect(roundTripFile(() => Buffer.from(exact))).toBe("exact");
    expect(
      roundTripFile(() => {
        throw new Error("gone");
      }),
    ).toBe("unreadable");
    const outcomes = await roundTripFiles(corpus, [...corpus.list("conf"), "x/missing.conf"]);
    expect(Object.fromEntries(outcomes)).toEqual({
      "x/binary.conf": "not_text",
      "x/broken.conf": "parse_failed",
      "x/empty.conf": "empty",
      "x/exact.conf": "exact",
      "x/missing.conf": "unreadable",
      "x/reformatted.conf": "parsed",
    });
    expect(countOutcomes(outcomes)).toEqual({
      files: 6,
      unreadable: 1,
      empty: 1,
      not_text: 1,
      text_files: 3,
      parsed: 2,
      round_trip_exact: 1,
    });
    expect(countOutcomes(outcomes, ["x/exact.conf"]).round_trip_exact).toBe(1);
  });

  it("finds the text extensions from the sniff sample", async () => {
    const corpus = new Corpus(
      fakePak({ "a.conf": "A {\n}", "b.edds": Buffer.from([0x44, 0x00]), "c.txt": "" }),
      "0.0.0.0",
    );
    expect(await textExtensions(corpus)).toEqual(["conf"]);
  });

  it("passes a rise, fails a fall, and fails a different input", () => {
    const base: RoundTripCounts = {
      ...emptyCounts(),
      files: 10,
      text_files: 10,
      parsed: 8,
      round_trip_exact: 4,
    };
    expect(compareCounts("et", { ...base }, base)).toEqual({
      regressions: [],
      improvements: [],
      mismatches: [],
    });
    expect(compareCounts("et", { ...base, round_trip_exact: 6 }, base)).toEqual({
      regressions: [],
      improvements: ["et: round_trip_exact rose from 4 to 6"],
      mismatches: [],
    });
    expect(compareCounts("et", { ...base, parsed: 7, round_trip_exact: 5 }, base)).toEqual({
      regressions: ["et: parsed fell from 8 to 7"],
      improvements: ["et: round_trip_exact rose from 4 to 5"],
      mismatches: [],
    });
    expect(compareCounts("et", { ...base, files: 11, text_files: 11 }, base).mismatches).toEqual([
      "et: files 11, baseline 10",
      "et: text_files 11, baseline 10",
    ]);
    expect(sumCounts([base, base]).round_trip_exact).toBe(8);
    expect(formatRoundTripTable(new Map([["et", base]]))).toContain("TOTAL");
  });
});

// ── The vanilla corpus (skipped when the game is absent or another build) ────

const BASELINE = loadBaseline();
const BASELINE_COMMENT =
  "Vanilla corpus scoreboard (tests/corpus/README.md). Counts only; no game content. " +
  "roundtrip is rewritten by a CORPUS_FULL=1 CORPUS_UPDATE_BASELINE=1 run; readers is edited by hand with known-defects.json.";
/** Re-recording: whole corpus plus write. The baseline's build and pak count are not checked. */
const RECORD = CORPUS_FULL && CORPUS_UPDATE;
const OPEN = openVanillaCorpus(BASELINE, { ignoreBaseline: RECORD });
const SCOPE = CORPUS_FULL
  ? "whole corpus"
  : `seeded sample of at most ${SAMPLE_PER_EXT} per extension`;
if (OPEN.skip !== undefined) console.warn(`[corpus] round trip SKIPPED: ${OPEN.skip}`);
if (CORPUS_UPDATE && !CORPUS_FULL) {
  console.warn("[corpus] CORPUS_UPDATE_BASELINE=1 is ignored without CORPUS_FULL=1");
}

describe.skipIf(OPEN.skip !== undefined)(
  `round trip on the vanilla corpus, ${SCOPE}${OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""}`,
  () => {
    const corpus = OPEN.corpus as Corpus;
    const measured = new Map<string, { full?: RoundTripCounts; sample: RoundTripCounts }>();
    const comparisons: Comparison[] = [];
    let started = 0;
    /** Set when a re-record measured every extension; a partial run never writes. */
    let recordComplete = false;

    it("uses the baseline's sample size and seed", () => {
      started = Date.now();
      if (RECORD) return;
      const b = BASELINE as Baseline;
      expect(
        { per_ext: b.roundtrip.sample_per_ext, seed: b.roundtrip.sample_seed },
        "the sample changed: every sample number in baseline.json is stale; re-record it (README)",
      ).toEqual({ per_ext: SAMPLE_PER_EXT, seed: SAMPLE_SEED });
    });

    // One case per extension, so a failure names it. A re-record finds the
    // set itself; a checked run takes it from the baseline.
    const exts = RECORD
      ? ["(all text extensions)"]
      : Object.keys(BASELINE?.roundtrip.extensions ?? {});

    it.each(exts)(
      "%s",
      async (ext) => {
        const list = RECORD ? await textExtensions(corpus) : [ext];
        for (const e of list) {
          const sample = corpus.sample(e);
          let full: RoundTripCounts | undefined;
          let sampleCounts: RoundTripCounts;
          if (CORPUS_FULL) {
            const outcomes: Map<string, FileOutcome> = await roundTripFiles(corpus, corpus.list(e));
            full = countOutcomes(outcomes);
            sampleCounts = countOutcomes(outcomes, sample);
          } else {
            sampleCounts = countOutcomes(await roundTripFiles(corpus, sample));
          }
          measured.set(e, { full, sample: sampleCounts });
          if (RECORD) continue;

          const b = (BASELINE as Baseline).roundtrip.extensions[e];
          const c = full
            ? compareCounts(`${e} full`, full, b.full)
            : compareCounts(`${e} sample`, sampleCounts, b.sample);
          comparisons.push(c);
          // The numbers go in the message: vitest merges failures with one message into one block.
          expect(
            c.mismatches,
            `the input differs from the baseline's build ${corpus.build}: ${c.mismatches.join("; ")}`,
          ).toEqual([]);
          expect(
            c.regressions,
            `round-trip numbers fell below the baseline: ${c.regressions.join("; ")}`,
          ).toEqual([]);
        }
        if (RECORD) recordComplete = true;
      },
      // A whole-corpus extension (et: 19,448 files) takes minutes on a busy machine.
      RECORD ? 3_600_000 : CORPUS_FULL ? 1_800_000 : 120_000,
    );

    afterAll(() => {
      if (measured.size === 0) return;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const pick = (k: "full" | "sample") =>
        new Map(
          [...measured].map(([e, m]) => [e, (k === "full" ? m.full : m.sample) as RoundTripCounts]),
        );
      const lines = [`[corpus] round trip at build ${corpus.build}, ${SCOPE}, ${seconds} s`];
      lines.push(formatRoundTripTable(pick(CORPUS_FULL ? "full" : "sample")));

      if (RECORD && !recordComplete) {
        lines.push("[corpus] the re-record did not finish; baseline.json left as it was.");
      } else if (RECORD) {
        const extensions: Baseline["roundtrip"]["extensions"] = {};
        for (const [e, m] of measured) {
          extensions[e] = {
            files_total: corpus.list(e).length,
            full: m.full as RoundTripCounts,
            sample: m.sample,
          };
        }
        writeBaseline({
          $comment: BASELINE?.$comment ?? BASELINE_COMMENT,
          build: corpus.build,
          pak_files: corpus.fileCount,
          roundtrip: {
            parser:
              "src/formats/enfusion-text.ts parse then serialize; byte-exact against the file bytes",
            sample_per_ext: SAMPLE_PER_EXT,
            sample_seed: SAMPLE_SEED,
            extensions,
          },
          readers: BASELINE?.readers ?? {},
        });
        lines.push(
          "[corpus] baseline.json rewritten from this run (round trip only; readers unchanged).",
        );
      } else {
        const all = mergeComparisons(comparisons);
        if (all.mismatches.length > 0 || all.regressions.length > 0) {
          lines.push(
            "[corpus] below the baseline or a different input:",
            ...[...all.mismatches, ...all.regressions].map((s) => `  ${s}`),
          );
        }
        if (all.improvements.length > 0) {
          lines.push(
            "[corpus] above the baseline:",
            ...all.improvements.map((s) => `  ${s}`),
            UPDATE_INSTRUCTION,
          );
        }
      }
      console.log(lines.join("\n"));
    });
  },
);
