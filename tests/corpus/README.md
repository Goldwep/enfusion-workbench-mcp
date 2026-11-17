# Vanilla corpus harness

The scoreboard for plan Phase 1 item 5: how well the repository reads and writes the files the
game ships. The lossless parser of Phase 3 and the reader rewrites are judged by these numbers.

- `_corpus.ts`: the corpus (the installed game paks through `PakVirtualFS`, game path from
  `loadConfig()`), listing by extension, reading, the seeded sample, the round-trip measurement
  and the baseline comparator.
- `roundtrip.corpus.test.ts`: per text extension, how many files `src/formats/enfusion-text.ts`
  parses without throwing and how many come back byte-exact after parse then serialize.
- `readers.corpus.test.ts`: what the shipped offline readers return on the vanilla files, against
  a count taken from the raw text. Every case there is a known defect (see below).
- `baseline.json`: the committed numbers for one build. Counts only.

Nothing from the game is ever copied into the repository. The tests read the paks at run time.

## When it runs and when it skips

Both files run in the ordinary suite. They skip, with the reason in the suite name and on stderr
(`[corpus] ... SKIPPED: ...`), when:

- there is no game install (`ENFUSION_GAME_PATH`, or what `loadConfig()` resolves);
- the census build tag in `data/census/current-build.json` is not the baseline's `build`;
- the paks hold a different number of files than the baseline's `pak_files` (the game updated
  before the census build tag did).

The synthetic tests of the harness itself (`corpus harness` in `roundtrip.corpus.test.ts`) always
run.

## Running

Default run, a seeded sample of at most 200 files per extension (about 3,000 files), compared with
the counts recorded for that same sample:

```sh
npx --no vitest run tests/corpus/roundtrip.corpus.test.ts tests/corpus/readers.corpus.test.ts
```

Whole corpus (about 43,000 text files), compared with the whole-corpus counts:

```sh
CORPUS_FULL=1 npx --no vitest run tests/corpus/roundtrip.corpus.test.ts
```

In PowerShell: `$env:CORPUS_FULL = "1"; npx --no vitest run tests/corpus/roundtrip.corpus.test.ts`.

On this machine at build 1.8.0.13 the default run takes under 20 seconds and the whole-corpus run
between 1.5 and 3 minutes, depending on load. The readers test always reads every file of its
extensions (a few hundred files); `CORPUS_FULL` does not change it.

The sample is not scaled from the whole corpus: it is the same files every time (the smallest
`sha256("corpus-roundtrip-v1|<ext>|<path>")` per extension), so its counts are exact and recorded
under `sample` beside `full`.

## What the numbers mean and how they are checked

Per extension and scope (`full`, `sample`): `files` measured, `unreadable`, `empty`, `not_text`
(the file's own bytes sniff as binary, by the E09 rule), `text_files` handed to the parser,
`parsed` (no throw), `round_trip_exact` (serialize output equals the file's bytes).

- `parsed` and `round_trip_exact` may only go up. A fall fails the extension's case. A rise passes
  and prints the new numbers with the instruction to record them.
- `files` and `text_files` must equal the baseline's: a difference means a different input, not a
  better parser, and fails.

The set of text extensions is the baseline's keys (29 at build 1.8.0.13). A re-record finds the set
again the way E09 does: an extension is text when any file in E09's seeded sniff sample of 64 is
text.

## Updating the baseline

After a parser improvement, or for a new build once `data/census/current-build.json` names it:

```sh
CORPUS_FULL=1 CORPUS_UPDATE_BASELINE=1 npx --no vitest run tests/corpus/roundtrip.corpus.test.ts
```

This measures the whole corpus, takes the sample counts from the same run, and rewrites
`build`, `pak_files` and `roundtrip` in `baseline.json`. It does not check the old baseline's build
or file count, and it leaves `readers` alone. Review the diff (one line per extension and scope)
and commit it. `CORPUS_UPDATE_BASELINE` without `CORPUS_FULL` is ignored.

## Reader cases are expected failures

Plan 3.3 principle 7: known defects are asserted as expected failures against an exact list, so the
suite stays green and a fix flips it. Each case in `readers.corpus.test.ts` is an `it` with a
literal title; its entry in `data/census/known-defects.json` names it by that title
(`asserted_by: { file: "tests/corpus/readers.corpus.test.ts", test: "<the title>" }`), and its
numbers sit under `readers` in `baseline.json` by the case's key: `files` and `independent` (the
corpus count), `reader_yield` (what the reader returns now) and any extra numbers the case pins.
The case passes while the reader returns exactly the recorded wrong numbers. When the yield
changes, it fails and says so; when it reaches the independent count it says the reader is fixed
and names the list entry to remove. A run prints the cases no list entry names yet, and, when every
case ran, the entries that name a title this file no longer has.

Whoever fixes a reader, in the same change: removes its entry from `data/census/known-defects.json`,
turns the case into a plain assertion that `reader_yield` equals `independent` (renaming it to say
what it now asserts), and updates or removes its `readers` entry. `readers` is edited by hand; no
run rewrites it. A case with no `readers` entry fails and prints the numbers to record.
