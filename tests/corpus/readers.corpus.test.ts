/**
 * Yield of the shipped offline readers on the vanilla corpus, against a count
 * taken independently from the raw text (plan 2.1 finding 6).
 *
 * Every reader named here was a known defect (plan 3.3 principle 7) and has
 * been fixed, so each case asserts the fixed state: the reader's yield equals
 * the independent count. The input is pinned first, from baseline.json
 * (`files` and `independent`), so a changed corpus reads as a corpus change and
 * not as a reader change.
 *
 * Readers always see every file of their extensions (a few hundred files):
 * the numbers are whole-corpus numbers.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  parseAgfToStruct,
  parseAsiToStruct,
  parseAstToStruct,
  parseAwToStruct,
} from "../../src/animation/parser.js";
import type { ParsedIkBinding, ParsedTransition } from "../../src/animation/types.js";
import { parse } from "../../src/formats/enfusion-text.js";
import { extractParticleSummary, type ParticleSummary } from "../../src/tools/particle-inspect.js";
import { readRuntimeIds } from "../../src/tools/ui-localization-audit.js";
import { loadBaseline, openVanillaCorpus, type Corpus, type ReaderBaseline } from "./_corpus.js";

/** Lines that open a block of `type` (`<indent>Type ...`), counted on the raw text. */
function countBlockOpeners(text: string, type: string): number {
  return text.match(new RegExp(`^[ \\t]*${type}\\b[^\\n]*\\{[ \\t]*\\r?$`, "gm"))?.length ?? 0;
}

/** Quoted entries of the first `Ids { ... }` block of a `StringTableRuntime`, on the raw text. */
function countRuntimeIds(text: string): number {
  const start = /^[ \t]*Ids[ \t]*\{[ \t]*\r?$/m.exec(text);
  if (!start) return 0;
  let n = 0;
  for (const line of text.slice(start.index + start[0].length).split("\n")) {
    if (/^[ \t]*\}[ \t]*\r?$/.test(line)) break;
    if (/^[ \t]*"/.test(line)) n++;
  }
  return n;
}

function isStringTableRuntime(head: string): boolean {
  // `\s` matches U+FEFF, so a byte-order mark needs no case of its own.
  return /^\s*StringTableRuntime\s*\{/.test(head);
}

/** particle_inspect on one file; a parse failure reads as nothing, as the tool reports it. */
function particleSummary(text: string): ParticleSummary | undefined {
  try {
    return extractParticleSummary(parse(text));
  } catch {
    return undefined;
  }
}

/** What one case measures: the files, the independent count, the reader's yield, extras. */
interface Measured {
  files: number;
  independent: number;
  reader_yield: number;
  [extra: string]: number;
}

interface ReaderCase {
  /** Key of the case's numbers under `readers` in baseline.json. */
  key: string;
  tool: string;
  counts: string;
  measure(corpus: Corpus): Measured;
}

const AGF_TRANSITIONS: ReaderCase = {
  key: "reader:animation_graph:agf-transitions",
  tool: "animation_graph inspect (parseAgfToStruct, src/animation/parser.ts)",
  counts: "AnimSrcNodeTransition block openers in every .agf",
  measure(corpus) {
    const files = corpus.list("agf");
    let independent = 0;
    let readerYield = 0;
    let stateMachines = 0;
    let stateMachinesInText = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      independent += countBlockOpeners(text, "AnimSrcNodeTransition");
      stateMachinesInText += countBlockOpeners(text, "AnimSrcNodeStateMachine");
      for (const sheet of parseAgfToStruct(text).sheets) {
        for (const node of sheet.nodes) {
          if (node.type !== "AnimSrcNodeStateMachine") continue;
          stateMachines++;
          readerYield += ((node.properties.transitions as ParsedTransition[] | undefined) ?? [])
            .length;
        }
      }
    }
    return {
      files: files.length,
      independent,
      reader_yield: readerYield,
      state_machines_read: stateMachines,
      state_machines_in_text: stateMachinesInText,
    };
  },
};

const AGF_IK_BINDINGS: ReaderCase = {
  key: "reader:animation_graph:agf-ik-bindings",
  tool: "animation_graph inspect (parseAgfToStruct, src/animation/parser.ts)",
  counts:
    "AnimSrcIkBinding and AnimSrcIkTargetBinding block openers in every .agf (IK2Target nodes hold the latter, DEC-048 wave-1 review F2-1); the yield is the chains the reader lists on its nodes",
  measure(corpus) {
    const files = corpus.list("agf");
    let independent = 0;
    let readerYield = 0;
    let ikNodesRead = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      independent += countBlockOpeners(text, "AnimSrcIkBinding");
      independent += countBlockOpeners(text, "AnimSrcIkTargetBinding");
      for (const sheet of parseAgfToStruct(text).sheets) {
        for (const node of sheet.nodes) {
          if (/IK/.test(node.type)) ikNodesRead++;
          readerYield += ((node.properties.chains as ParsedIkBinding[] | undefined) ?? []).length;
        }
      }
    }
    return {
      files: files.length,
      independent,
      reader_yield: readerYield,
      ik_nodes_read: ikNodesRead,
    };
  },
};

const AST_GROUPS: ReaderCase = {
  key: "reader:animation_graph:ast-groups",
  tool: "animation_graph inspect (parseAstToStruct, src/animation/parser.ts)",
  counts: "AnimSetTemplateSource_AnimationGroup block openers in every .ast",
  measure(corpus) {
    const files = corpus.list("ast");
    let independent = 0;
    let readerYield = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      independent += countBlockOpeners(text, "AnimSetTemplateSource_AnimationGroup");
      readerYield += parseAstToStruct(text).groups.length;
    }
    return { files: files.length, independent, reader_yield: readerYield };
  },
};

const ASI_LINES: ReaderCase = {
  key: "reader:animation_graph:asi-lines",
  tool: "animation_graph inspect (parseAsiToStruct, src/animation/parser.ts)",
  counts: "AnimSetInstanceSource_Line block openers in every .asi",
  measure(corpus) {
    const files = corpus.list("asi");
    let independent = 0;
    let readerYield = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      independent += countBlockOpeners(text, "AnimSetInstanceSource_Line");
      readerYield += parseAsiToStruct(text).mappings.length;
    }
    return { files: files.length, independent, reader_yield: readerYield };
  },
};

const AW_PREVIEW_MODELS: ReaderCase = {
  key: "reader:animation_graph:aw-preview-models",
  tool: "animation_graph inspect (parseAwToStruct, src/animation/parser.ts)",
  counts:
    "AnimSrcWorkspacePreviewModel and AnimSrcWorkspaceChildPreviewModel block openers in every .aw",
  measure(corpus) {
    const files = corpus.list("aw");
    let models = 0;
    let childModels = 0;
    let modelsRead = 0;
    let childModelsRead = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      models += countBlockOpeners(text, "AnimSrcWorkspacePreviewModel");
      childModels += countBlockOpeners(text, "AnimSrcWorkspaceChildPreviewModel");
      const aw = parseAwToStruct(text);
      modelsRead += aw.previewModels.length;
      childModelsRead += aw.childPreviewModels.length;
    }
    return {
      files: files.length,
      independent: models + childModels,
      reader_yield: modelsRead + childModelsRead,
      preview_models_in_text: models,
      child_preview_models_in_text: childModels,
    };
  },
};

const PTC_EMITTERS: ReaderCase = {
  key: "reader:particle_inspect:emitters",
  tool: "particle_inspect (extractParticleSummary, src/tools/particle-inspect.ts)",
  counts: "EmitterDef block openers in every .ptc",
  measure(corpus) {
    const files = corpus.list("ptc");
    let independent = 0;
    let readerYield = 0;
    let typedEmitterDef = 0;
    let parseFailed = 0;
    let threeEmitterFiles = 0;
    let threeEmitterFilesReadAsThree = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      const n = countBlockOpeners(text, "EmitterDef");
      independent += n;
      const summary = particleSummary(text);
      if (!summary) parseFailed++;
      const emitters = summary?.emitters ?? [];
      readerYield += emitters.length;
      typedEmitterDef += emitters.filter((e) => e.type === "EmitterDef").length;
      if (n === 3) {
        threeEmitterFiles++;
        if (emitters.length === 3) threeEmitterFilesReadAsThree++;
      }
    }
    return {
      files: files.length,
      independent,
      reader_yield: readerYield,
      reported_as_EmitterDef: typedEmitterDef,
      parse_failed: parseFailed,
      three_emitter_files: threeEmitterFiles,
      three_emitter_files_read_as_three: threeEmitterFilesReadAsThree,
    };
  },
};

const PTC_MATERIAL_REFS: ReaderCase = {
  key: "reader:particle_inspect:material-refs",
  tool: "particle_inspect (extractParticleSummary, src/tools/particle-inspect.ts)",
  counts:
    "Material lines holding a {GUID} ref in every .ptc (each emitter's resource ref); the yield is the texture refs the reader lists over all emitters",
  measure(corpus) {
    const files = corpus.list("ptc");
    let independent = 0;
    let readerYield = 0;
    let curvesRead = 0;
    let gradientsRead = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      independent += text.match(/^[ \t]*Material[ \t]+"\{[0-9A-Fa-f]{16}\}/gm)?.length ?? 0;
      const summary = particleSummary(text);
      readerYield += (summary?.emitters ?? []).reduce((n, e) => n + e.textures.length, 0);
      curvesRead += summary?.curves.length ?? 0;
      gradientsRead += summary?.gradients.length ?? 0;
    }
    return {
      files: files.length,
      independent,
      reader_yield: readerYield,
      curves_read: curvesRead,
      gradients_read: gradientsRead,
    };
  },
};

const RUNTIME_KEYS: ReaderCase = {
  key: "reader:ui_localization_audit:runtime-keys",
  tool: "ui_localization_audit (readRuntimeIds, src/tools/ui-localization-audit.ts)",
  counts: "quoted entries of the Ids block of every StringTableRuntime .conf",
  measure(corpus) {
    // runLocalizationAudit treats a parse failure as an empty table; so does this.
    const files = corpus
      .list("conf")
      .filter((p) => isStringTableRuntime(corpus.read(p).subarray(0, 256).toString("utf-8")));
    let independent = 0;
    let readerYield = 0;
    let parseFailed = 0;
    for (const p of files) {
      const text = corpus.readText(p);
      independent += countRuntimeIds(text);
      try {
        readerYield += readRuntimeIds(text).length;
      } catch {
        parseFailed++;
      }
    }
    return {
      files: files.length,
      independent,
      reader_yield: readerYield,
      parse_failed: parseFailed,
    };
  },
};

/** Every case, in the order the tests below run them. */
const CASES = [
  AGF_TRANSITIONS,
  AGF_IK_BINDINGS,
  AST_GROUPS,
  ASI_LINES,
  AW_PREVIEW_MODELS,
  PTC_EMITTERS,
  PTC_MATERIAL_REFS,
  RUNTIME_KEYS,
];

// ── The cases ────────────────────────────────────────────────────────────────

const BASELINE = loadBaseline();
const OPEN = openVanillaCorpus(BASELINE);
if (OPEN.skip !== undefined) console.warn(`[corpus] reader yields SKIPPED: ${OPEN.skip}`);
const TIMEOUT = 120_000;

describe.skipIf(OPEN.skip !== undefined)(
  `reader yields on the vanilla corpus (fixed readers)${OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""}`,
  () => {
    const corpus = OPEN.corpus as Corpus;
    const report: string[] = [];

    /** One case: the reader's yield equals the independent count; `title` is the case's own test title. */
    function check(c: ReaderCase, title: string): void {
      const t0 = Date.now();
      const m = c.measure(corpus);
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      report.push(
        `  ${title}: ${m.reader_yield} of ${m.independent} (${m.files} files, ${seconds} s)`,
      );

      const recorded = BASELINE?.readers[c.key];
      expect(
        recorded,
        `no baseline for ${c.key}; record this under readers in tests/corpus/baseline.json: ` +
          JSON.stringify({ counts: c.counts, ...m }),
      ).toBeDefined();
      const expected: Partial<ReaderBaseline> = { ...recorded };

      // The input first: a different independent count is a different corpus, not a reader change.
      expect(
        { files: m.files, independent: m.independent },
        `${title}: the vanilla files changed (${c.counts}); re-measure the case`,
      ).toEqual({ files: expected.files, independent: expected.independent });

      // The fixed state: the reader finds everything the raw text holds.
      expect(
        m.reader_yield,
        `${title}: ${c.tool} yields ${m.reader_yield} of ${m.independent}`,
      ).toBe(m.independent);
    }

    // One literal title per case.
    it(
      "animation_graph reads every transition from the .agf state machines",
      (ctx) => {
        check(AGF_TRANSITIONS, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "animation_graph reads every IK chain binding from the .agf IK nodes",
      (ctx) => {
        check(AGF_IK_BINDINGS, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "animation_graph reads every animation group from the .ast files",
      (ctx) => {
        check(AST_GROUPS, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "animation_graph reads every line from the .asi files",
      (ctx) => {
        check(ASI_LINES, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "animation_graph reads every preview model from the .aw files",
      (ctx) => {
        check(AW_PREVIEW_MODELS, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "particle_inspect reports every emitter of each .ptc file",
      (ctx) => {
        check(PTC_EMITTERS, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "particle_inspect reports the material and texture refs on the emitters",
      (ctx) => {
        check(PTC_MATERIAL_REFS, ctx.task.name);
      },
      TIMEOUT,
    );
    it(
      "ui_localization_audit finds every key in the runtime string tables",
      (ctx) => {
        check(RUNTIME_KEYS, ctx.task.name);
      },
      TIMEOUT,
    );

    afterAll(() => {
      if (report.length === 0) return;
      const lines = [
        `[corpus] reader yields at build ${corpus.build} (reader of independent):`,
        ...report,
      ];
      console.log(lines.join("\n"));
    });
  },
);
