/**
 * Regenerates data/behavior-tree/catalog.json from the build's source index and
 * the installed game's `.bt` files.
 *
 *   npx tsx scripts/gen-bt-catalog.ts [--build 1.9.0.37] [--index <source-index.jsonl>]
 *
 * The class list is the index's own (DEC-067 OD-10): every descendant of `Node`
 * and every descendant of `BaseDecoratorTest` the build's scripts declare. Each
 * class carries its parent, family (the first of AITaskScripted, AITask,
 * DecoratorScripted, Decorator on its chain, else Node), its declaring file and
 * the `[Attribute]` fields of its script chain (the properties a scripted node
 * shows in the editor).
 *
 * On top of that list, what the vanilla trees do per class: which properties a
 * node carries and whether the value is quoted, its variable properties and
 * named ports, how many children it has, the TEST classes under it. A class no
 * vanilla tree uses has `count` 0 and no usage data.
 *
 * The run fails when a class a vanilla tree uses is not in the index's list
 * (corpus gate 7 of phase5-w4-spec.md section 4).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { PakVirtualFS } from "../src/pak/vfs.js";
import {
  classChain,
  loadSourceIndex,
  subclassesOf,
  type SourceIndex,
} from "../src/census/source-index.js";
import { blocks, child, parseBt, propText, type BtBlock } from "../src/behavior-tree/model.js";
import type {
  BtCatalog,
  CatalogNode,
  CatalogProp,
  CatalogTest,
} from "../src/behavior-tree/tree.js";

const INLINE_VAR = /^(In|Out)[A-Z]/;
const SKIP = new Set(["Name", "EditorPos", "Group"]);
const OWN_BLOCKS = new Set(["Nodes", "InPorts", "OutPorts"]);
const FAMILIES = ["AITaskScripted", "AITask", "DecoratorScripted", "Decorator"];

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

const build =
  arg("--build") ??
  (JSON.parse(readFileSync(join(process.cwd(), "data", "census", "current-build.json"), "utf-8"))
    .tag as string);
const indexFile = arg("--index");
const index = loadSourceIndex(build, indexFile ? { file: indexFile } : {});
if (!index) throw new Error(`no source index for build ${build} (census E02, or --index <file>)`);

const cfg = loadConfig();
const vfs = PakVirtualFS.get(cfg.gamePath);
if (!vfs) throw new Error(`no game paks under ${cfg.gamePath}`);
const files = vfs
  .allFilePaths()
  .filter((p) => p.toLowerCase().endsWith(".bt"))
  .sort();

// ── The index's class lists ──────────────────────────────────────────────────

function descendants(idx: SourceIndex, root: string): string[] {
  const out = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const c = queue.shift()!;
    for (const s of subclassesOf(idx, c)) {
      if (out.has(s.name)) continue;
      out.add(s.name);
      queue.push(s.name);
    }
  }
  return [...out].sort();
}

interface IndexFacts {
  parent: string;
  family: string;
  source: string;
  scripted: boolean;
  attributes: string[];
}

function factsOf(name: string): IndexFacts {
  const chain = classChain(index!, name);
  const own = chain[0];
  const decl = own.declarations.find((d) => !d.modded) ?? own.declarations[0];
  const attributes = new Set<string>();
  for (const c of chain) {
    for (const f of c.fields) {
      if (f.attributes.some((a) => a.name === "Attribute")) attributes.add(f.name);
    }
  }
  const family = chain.slice(1).find((c) => FAMILIES.includes(c.name))?.name ?? "Node";
  return {
    parent: own.parent_name ?? "",
    family: FAMILIES.includes(name) ? name : family,
    source: `${decl.file}:${decl.line}`,
    scripted: !decl.file.includes("/generated/"),
    attributes: [...attributes].sort(),
  };
}

const nodeClasses = descendants(index, "Node");
const testClasses = descendants(index, "BaseDecoratorTest");

// ── What the vanilla trees do ────────────────────────────────────────────────

interface PropAcc {
  n: number;
  quoted: number;
  samples: Set<string>;
}

interface Acc {
  count: number;
  props: Map<string, PropAcc>;
  vars: Set<string>;
  in: Set<string>;
  out: Set<string>;
  min: number;
  max: number;
  blocks: Set<string>;
  tests: Set<string>;
}

const acc = new Map<string, Acc>();
const testAcc = new Map<string, { count: number; props: Map<string, PropAcc> }>();
const variableTypes = new Set<string>();

function addProp(map: Map<string, PropAcc>, key: string, text: string, isQuoted: boolean): void {
  let p = map.get(key);
  if (!p) map.set(key, (p = { n: 0, quoted: 0, samples: new Set() }));
  p.n++;
  if (isQuoted) p.quoted++;
  if (p.samples.size < 4) p.samples.add(text);
}

function propsOut(map: Map<string, PropAcc>): Record<string, CatalogProp> {
  const props: Record<string, CatalogProp> = {};
  for (const key of [...map.keys()].sort()) {
    const p = map.get(key)!;
    props[key] = { n: p.n, quoted: p.quoted * 2 > p.n, samples: [...p.samples] };
  }
  return props;
}

function visit(node: BtBlock): void {
  const type = node.head[0]?.text ?? "";
  let a = acc.get(type);
  if (!a) {
    a = {
      count: 0,
      props: new Map(),
      vars: new Set(),
      in: new Set(),
      out: new Set(),
      min: Infinity,
      max: 0,
      blocks: new Set(),
      tests: new Set(),
    };
    acc.set(type, a);
  }
  a.count++;
  for (const e of node.entries) {
    if (e.kind === "prop") {
      const text = e.values.map((v) => v.text).join(" ");
      if (SKIP.has(e.key)) continue;
      if (INLINE_VAR.test(e.key) && /^-?\d+$/.test(text)) {
        a.vars.add(e.key);
        continue;
      }
      addProp(a.props, e.key, text, e.values[0]?.quoted === true);
    } else if (e.kind === "block") {
      const key = e.head[0]?.text ?? "";
      if (!OWN_BLOCKS.has(key)) a.blocks.add(key);
    }
  }
  for (const p of blocks(child(node, "InPorts"))) a.in.add(propText(p, "PortName") ?? "");
  for (const p of blocks(child(node, "OutPorts"))) a.out.add(propText(p, "PortName") ?? "");
  for (const t of blocks(child(node, "TEST"))) {
    const cls = t.head[0]?.text ?? "";
    a.tests.add(cls);
    let ta = testAcc.get(cls);
    if (!ta) testAcc.set(cls, (ta = { count: 0, props: new Map() }));
    ta.count++;
    for (const e of t.entries) {
      if (e.kind === "prop")
        addProp(
          ta.props,
          e.key,
          e.values.map((v) => v.text).join(" "),
          e.values[0]?.quoted === true,
        );
    }
  }
  const kids = blocks(child(node, "Nodes"));
  a.min = Math.min(a.min, kids.length);
  a.max = Math.max(a.max, kids.length);
  kids.forEach(visit);
}

for (const f of files) {
  const doc = parseBt(vfs.readFile(f).toString("utf-8"));
  blocks(child(doc.root, "Nodes")).forEach(visit);
  for (const v of blocks(child(doc.root, "Variables"))) {
    variableTypes.add((v.head[0]?.text ?? "").replace(/^BtVariable/, ""));
  }
}

// ── Gate 7: every class a vanilla tree uses is in the index's list ───────────

const nodeSet = new Set(nodeClasses);
const testSet = new Set(testClasses);
const missingNodes = [...acc.keys()].filter((k) => !nodeSet.has(k)).sort();
const missingTests = [...testAcc.keys()].filter((k) => !testSet.has(k)).sort();
if (missingNodes.length || missingTests.length) {
  throw new Error(
    `classes the vanilla trees use that the index does not list: nodes ${missingNodes.join(", ") || "-"}; tests ${missingTests.join(", ") || "-"}`,
  );
}

// ── Output ───────────────────────────────────────────────────────────────────

const nodes: Record<string, CatalogNode> = {};
for (const type of nodeClasses) {
  const a = acc.get(type);
  nodes[type] = {
    count: a?.count ?? 0,
    props: a ? propsOut(a.props) : {},
    vars: a ? [...a.vars].sort() : [],
    in: a ? [...a.in].filter(Boolean).sort() : [],
    out: a ? [...a.out].filter(Boolean).sort() : [],
    children: a ? [a.min, a.max] : [0, 0],
    blocks: a ? [...a.blocks].sort() : [],
    tests: a ? [...a.tests].sort() : [],
    ...factsOf(type),
  };
}

const tests: Record<string, CatalogTest> = {};
for (const type of testClasses) {
  const t = testAcc.get(type);
  tests[type] = { count: t?.count ?? 0, props: t ? propsOut(t.props) : {}, ...factsOf(type) };
}

const catalog: BtCatalog = {
  build,
  files: files.length,
  nodes,
  tests,
  variableTypes: [...variableTypes].sort(),
};
const dir = join(process.cwd(), "data", "behavior-tree");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog, null, 1) + "\n", "utf-8");
console.log(
  `${files.length} trees; ${nodeClasses.length} node classes (${acc.size} used), ` +
    `${testClasses.length} test classes (${testAcc.size} used) -> data/behavior-tree/catalog.json`,
);
