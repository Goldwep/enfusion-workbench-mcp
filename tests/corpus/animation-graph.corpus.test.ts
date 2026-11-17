/**
 * `animation_graph` on every vanilla graph of the installed game (wave W4,
 * phase5-w4-spec.md section 4, gates 1 to 4):
 *   1. every .agf and .agr parses and gives its bytes back exactly;
 *   2. inspect (text and json) and validate finish on every file, no throw
 *      (the V11 BlendN crash, KD-W4-1, threw on 21 .agf);
 *   3. validate reports no error on any file (rules that fire on shipping
 *      content are warnings, DEC-067 OD-4);
 *   4. on a seeded sample of 50 files per extension, each edit op followed by
 *      the inverse it answers gives the original bytes back.
 * Skips without a game install; build-independent like the .bt corpus test.
 */
import { describe, expect, it } from "vitest";
import { applyGraphEdit, type GraphEditOp } from "../../src/animation/graph-edit.js";
import { nameOf, nodesOf, sheetsOf } from "../../src/animation/parser.js";
import { loadConfig, type Config } from "../../src/config.js";
import { parseCstBytes, type CstDocument } from "../../src/formats/enfusion-cst.js";
import { VocabularyError } from "../../src/manifest/vocabulary.js";
import { runAnimationGraph } from "../../src/tools/animation-graph.js";
import { loadBaseline, openVanillaCorpus, seededSample } from "./_corpus.js";

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
const IDENTITY_SAMPLE = 50;
const IDENTITY_SEED = "w4-animation-graph-identity";

function strip(ref: string): string {
  return ref.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
}

/** Applies an op and then its inverse; answers the bytes back, or the refusal code. */
function roundTripOp(doc: CstDocument, op: GraphEditOp): Buffer | string {
  let mid;
  try {
    mid = applyGraphEdit(doc, op);
  } catch (e) {
    if (e instanceof VocabularyError) return e.code;
    throw e;
  }
  if (mid.doc.toBytes().equals(doc.toBytes())) return "NO_CHANGE";
  const back = applyGraphEdit(mid.doc, mid.inverse);
  return back.doc.toBytes();
}

describe.skipIf(open.skip !== undefined)("animation_graph on vanilla graphs", () => {
  const corpus = open.corpus!;
  const agfs = open.corpus ? corpus.list("agf") : [];
  const agrs = open.corpus ? corpus.list("agr") : [];
  let config: Config;
  try {
    config = loadConfig();
  } catch {
    config = undefined as unknown as Config;
  }

  /** The .agr that lists each .agf (lower-case path). */
  const agrOf = new Map<string, string>();
  for (const r of agrs) {
    const doc = parseCstBytes(corpus.read(r));
    for (const m of doc.text.matchAll(/"(\{[0-9A-Fa-f]{16}\}[^"\r\n]+\.agf)"/gi)) {
      agrOf.set(strip(m[1]).toLowerCase(), r);
    }
  }

  it("has graphs to read", () => {
    expect(agfs.length).toBeGreaterThan(100);
    expect(agrs.length).toBeGreaterThan(100);
  });

  it("gate 1: parses every .agf and .agr and gives the bytes back exactly", () => {
    const off: string[] = [];
    for (const f of [...agfs, ...agrs]) {
      const bytes = corpus.read(f);
      const doc = parseCstBytes(bytes);
      if (!doc.toBytes().equals(bytes) || doc.diagnostics.length > 0) off.push(f);
    }
    expect(off).toEqual([]);
  });

  it("gates 2 and 3: inspect and validate finish on every file, and validate finds no error", () => {
    const thrown: string[] = [];
    const failed: string[] = [];
    const errors: string[] = [];
    let issues = 0;
    let paired = 0;
    const run = (args: Parameters<typeof runAnimationGraph>[0], f: string) => {
      try {
        return runAnimationGraph({ source: "game", ...args }, config);
      } catch (e) {
        thrown.push(`${f}: ${(e as Error).message}`);
        return undefined;
      }
    };
    for (const f of [...agfs, ...agrs]) {
      for (const format of ["text", "json"] as const) {
        const r = run({ action: "inspect", path: f, format }, f);
        if (r?.isError) failed.push(`${f} inspect ${format}: ${r.text.slice(0, 200)}`);
      }
      const agr = f.toLowerCase().endsWith(".agf") ? agrOf.get(f.toLowerCase()) : undefined;
      if (agr) paired++;
      const r = run({ action: "validate", path: f, agrPath: agr, limit: 200 }, f);
      if (!r) continue;
      const res = JSON.parse(r.text) as {
        ok: boolean;
        readback?: {
          errorCount: number;
          warningCount: number;
          issues: { id: string; severity: string; message: string }[];
        };
        message?: string;
      };
      if (!res.ok || !res.readback) {
        failed.push(`${f} validate: ${res.message}`);
        continue;
      }
      issues += res.readback.errorCount + res.readback.warningCount;
      if (res.readback.errorCount > 0) {
        const first = res.readback.issues.find((i) => i.severity === "error");
        errors.push(
          `${f}: ${res.readback.errorCount} error(s), first ${first?.id} ${first?.message}`,
        );
      }
    }
    expect(thrown).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
    expect(paired).toBeGreaterThan(140);
    expect(issues).toBeGreaterThan(0); // the demoted rules still report
  }, 600_000);

  it("gate 4: each edit op and its inverse give the original bytes back (seeded 50 per extension)", () => {
    const off: string[] = [];
    const ran: Record<string, number> = {};
    const check = (f: string, doc: CstDocument, op: GraphEditOp, skipCodes: string[] = []) => {
      const out = roundTripOp(doc, op);
      if (typeof out === "string") {
        if (!skipCodes.includes(out)) off.push(`${f} ${op.op}: refused ${out}`);
        return;
      }
      ran[op.op] = (ran[op.op] ?? 0) + 1;
      if (!out.equals(doc.toBytes())) off.push(`${f} ${op.op}: bytes differ after the inverse`);
    };

    for (const f of seededSample(agfs, IDENTITY_SAMPLE, "agf", IDENTITY_SEED)) {
      const doc = parseCstBytes(corpus.read(f));
      const sheets = sheetsOf(doc);
      if (sheets.length === 0) continue;
      const sheet = sheets.find((s) => nodesOf(s).length > 0) ?? sheets[0];
      const sh = nameOf(sheet);
      const nodes = nodesOf(sheet);
      check(f, doc, {
        op: "addNode",
        sheet: sh,
        nodeClass: "AnimSrcNodeBindPose",
        name: "EMCP_Identity",
        editorPos: [1, 2],
      });
      check(f, doc, { op: "addSheet", name: "EMCP_IdentitySheet" });
      check(f, doc, { op: "removeSheet", name: sh }, ["ITEM_NOT_FOUND"]);
      if (nodes.length === 0) continue;
      const first = nodes[0];
      const n = nameOf(first);
      check(f, doc, { op: "removeNode", sheet: sh, name: n });
      check(f, doc, { op: "setProp", sheet: sh, node: n, prop: "EMCP_Probe", value: "1" });
      if (first.children.some((c) => c.kind === "scalar" && c.key === "EditorPos")) {
        check(f, doc, { op: "setProp", sheet: sh, node: n, prop: "EditorPos", value: [1, 2] });
        check(f, doc, { op: "setProp", sheet: sh, node: n, prop: "EditorPos", value: null });
      }
      const withChild = nodes.find((x) =>
        x.children.some((c) => c.kind === "scalar" && c.key === "Child"),
      );
      if (withChild) {
        const wn = nameOf(withChild);
        const cur = withChild.children.find((c) => c.kind === "scalar" && c.key === "Child");
        const curText = cur ? doc.text.slice(cur.start, cur.end) : "";
        const other = nodes.map(nameOf).find((x) => x !== wn && !curText.includes(`"${x}"`));
        if (other) check(f, doc, { op: "connect", sheet: sh, node: wn, to: other });
        check(f, doc, { op: "disconnect", sheet: sh, node: wn });
      }
      const without = nodes.find(
        (x) => !x.children.some((c) => c.kind === "scalar" && c.key === "Child"),
      );
      if (without && nodes.length > 1) {
        const wn = nameOf(without);
        const other = nodes.map(nameOf).find((x) => x !== wn)!;
        check(f, doc, { op: "connect", sheet: sh, node: wn, to: other });
      }
    }

    for (const f of seededSample(agrs, IDENTITY_SAMPLE, "agr", IDENTITY_SEED)) {
      const doc = parseCstBytes(corpus.read(f));
      if (doc.base.kind !== "object" || doc.base.key !== "AnimSrcGraph") continue; // the legacy $AnimGraph file
      const text = doc.text;
      if (/^\s*GraphFilesResourceNames\s*\{/m.test(text)) {
        check(f, doc, { op: "addFile", file: "{0123456789ABCDEF}EMCP/identity.agf" });
        const ref = /GraphFilesResourceNames\s*\{\s*"([^"]+)"/.exec(text)?.[1];
        if (ref) check(f, doc, { op: "removeFile", file: ref });
      }
      check(f, doc, { op: "setDefaultRunNode", name: "EMCP_Identity" });
      if (/^\s*DefaultRunNode\s/m.test(text))
        check(f, doc, { op: "setDefaultRunNode", name: null });
      if (/^\s*Variables\s*\{/m.test(text)) {
        check(f, doc, {
          op: "addVariable",
          name: "EMCP_IdentityVar",
          varType: "Float",
          min: -1,
          max: 1,
        });
        const v = /AnimSrcGCTVar\w+ ("[^"]+"|\w+) \{/.exec(text)?.[1];
        if (v) check(f, doc, { op: "removeVariable", name: v.replace(/"/g, "") });
      }
    }

    expect(off).toEqual([]);
    for (const op of [
      "addNode",
      "removeNode",
      "setProp",
      "connect",
      "disconnect",
      "addSheet",
      "removeSheet",
      "addFile",
      "removeFile",
      "setDefaultRunNode",
      "addVariable",
      "removeVariable",
    ]) {
      expect(ran[op] ?? 0, op).toBeGreaterThan(5);
    }
  }, 600_000);
});
