/**
 * The `.bt` model on every vanilla behavior tree of the installed game: the
 * writer gives each file back byte for byte, and the checks find no error in
 * any of them. Build-independent, so the corpus is opened whatever its build.
 * The checks against the committed catalog (among them W4 gate 7) skip when
 * the census build is not the catalog's build; the diff checks always run.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { diffBt } from "../../src/behavior-tree/diff.js";
import { emitBt, parseBt } from "../../src/behavior-tree/model.js";
import {
  allNodes,
  lookupNode,
  lookupTest,
  validateBt,
  viewBt,
  type BtCatalog,
} from "../../src/behavior-tree/tree.js";
import { loadBtCatalog } from "../../src/tools/behavior-tree.js";
import { REPO_ROOT, loadBaseline, openVanillaCorpus } from "./_corpus.js";

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
const catalog = loadBtCatalog(join(REPO_ROOT, "data")) as BtCatalog;
/** The catalog checks need the paks of the build the catalog was generated from. */
const sameBuild = open.corpus?.build === catalog.build;

describe.skipIf(open.skip !== undefined)("vanilla .bt files", () => {
  const corpus = open.corpus!;
  const files = open.corpus ? corpus.list("bt") : [];

  it("has trees to read", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("writes every file back byte for byte", () => {
    const off = files.filter((f) => {
      const text = corpus.readText(f);
      return emitBt(parseBt(text)) !== text;
    });
    expect(off).toEqual([]);
  });

  it("finds no error in any vanilla tree, and every node has a path that finds it", () => {
    const errors: string[] = [];
    let nodes = 0;
    for (const f of files) {
      const doc = parseBt(corpus.readText(f));
      for (const x of validateBt(doc)) {
        if (x.level === "error") errors.push(`${f} [${x.at}]: ${x.message}`);
      }
      const view = viewBt(doc);
      const all = allNodes(view);
      nodes += all.length;
      expect(new Set(all.map((n) => n.path)).size).toBe(all.length);
    }
    expect(errors).toEqual([]);
    expect(nodes).toBeGreaterThan(2000);
  });

  it.skipIf(!sameBuild)("finds no error against the catalog either", () => {
    const errors: string[] = [];
    for (const f of files) {
      const doc = parseBt(corpus.readText(f));
      for (const x of validateBt(doc, { catalog })) {
        if (x.level === "error") errors.push(`${f} [${x.at}]: ${x.message}`);
      }
    }
    expect(errors).toEqual([]);
  });

  // Gate 7 (phase5-w4-spec.md section 4): the catalog is the index's list, and it holds every
  // class the vanilla trees use, read here from the paks independently of the generator.
  it.skipIf(!sameBuild)("has every node and TEST class of the vanilla trees in the catalog", () => {
    expect(Object.keys(catalog.nodes)).toHaveLength(401);
    expect(Object.keys(catalog.tests ?? {})).toHaveLength(38);
    expect(catalog.files).toBe(files.length);
    const nodeClasses = new Set<string>();
    const testClasses = new Set<string>();
    for (const f of files) {
      for (const n of allNodes(viewBt(parseBt(corpus.readText(f))))) {
        nodeClasses.add(n.type);
        n.tests.forEach((t) => testClasses.add(t));
      }
    }
    expect([...nodeClasses].filter((c) => !lookupNode(catalog, c))).toEqual([]);
    expect([...testClasses].filter((c) => !lookupTest(catalog, c))).toEqual([]);
    expect(nodeClasses.size).toBe(Object.values(catalog.nodes).filter((n) => n.count > 0).length);
  });

  it("diffs every tree against itself to nothing, and against its neighbour without a throw", () => {
    const docs = files.map((f) => parseBt(corpus.readText(f)));
    docs.forEach((doc, i) => {
      expect(diffBt(doc, doc).changes, files[i]).toEqual([]);
      const next = docs[(i + 1) % docs.length];
      const d = diffBt(doc, next);
      expect(d.summary.nodesA - d.summary.removed).toBe(d.summary.nodesB - d.summary.added);
    });
  });
});
