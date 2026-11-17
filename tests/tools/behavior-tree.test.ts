import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { diffBt, type BtDiff, type BtNodeChange } from "../../src/behavior-tree/diff.js";
import { emitBt, isCanonical, parseBt, type BtDocument } from "../../src/behavior-tree/model.js";
import {
  applyOp,
  buildBt,
  findNode,
  formatBt,
  lookupNode,
  lookupTest,
  opOf,
  portVariable,
  treeSpecOf,
  validateBt,
  viewBt,
  type BtCatalog,
  type TreeSpec,
} from "../../src/behavior-tree/tree.js";
import {
  BEHAVIOR_TREE_ACTIONS,
  BEHAVIOR_TREE_DESCRIPTION,
  loadBtCatalog,
  nodesText,
  registerBehaviorTree,
} from "../../src/tools/behavior-tree.js";
import type { Config } from "../../src/config.js";

const DATA = join(__dirname, "..", "..", "data");
const catalog = loadBtCatalog(DATA) as BtCatalog;

// The shape of a vanilla file: one space of indent, LF, no final line ending.
const SAMPLE = [
  'BehaviorTree "{0123456789ABCDEF}AI/BehaviorTrees/T/Sample.bt" {',
  ' Name "AI/BehaviorTrees/T/Sample.bt"',
  " Nodes {",
  "  RootNode Root {",
  '   Name "Root"',
  "   EditorPos 0 80",
  "   Nodes {",
  "    Sequence Sequence {",
  '     Name "Sequence"',
  "     EditorPos 0 260",
  "     Nodes {",
  "      DecoTestVariable DecoTestVariable {",
  '       Name "DecoTestVariable"',
  "       EditorPos -130 440",
  "       Nodes {",
  "        AITaskIdle Idle {",
  '         Name "Idle"',
  "         EditorPos -130 620",
  "         Period 2",
  "        }",
  "       }",
  "       InVariable 0",
  "       TestType EqualsValue",
  '       TestValue "true"',
  "      }",
  "      SCR_AISetStance SCR_AISetStance {",
  '       Name "SCR_AISetStance"',
  "       EditorPos 130 440",
  "       InPorts {",
  "        SingleInputPortContainer SingleInputPortContainer {",
  "         Port -1",
  '         PortName "Stance"',
  "        }",
  "       }",
  "       m_eStance CROUCH",
  "      }",
  "     }",
  "    }",
  "   }",
  "  }",
  " }",
  " Variables {",
  "  BtVariableBool alert {",
  '   Flags "Input"',
  '   Desc ""',
  "  }",
  " }",
  " VariablesRefs {",
  "  VariableReference alert {",
  "   VariableType 0",
  "   EditorPos -330 500",
  "  }",
  " }",
  "}",
].join("\n");

const SPEC: TreeSpec = {
  path: "AI/BehaviorTrees/T/Guard.bt",
  variables: [
    { name: "alert", type: "Bool", flag: "input" },
    { name: "stance", type: "Integer" },
  ],
  root: {
    type: "Selector",
    children: [
      {
        type: "DecoTestVariable",
        props: { TestType: "EqualsValue", TestValue: "true" },
        vars: { InVariable: "alert" },
        children: [
          {
            type: "Sequence",
            children: [
              { type: "SCR_AISetStance", in: { Stance: "stance" }, props: { m_eStance: "CROUCH" } },
              { type: "AITaskIdle", name: "Wait a bit", props: { Period: 2, PeriodRandom: 0.5 } },
            ],
          },
        ],
      },
      { type: "AITaskReturnState", props: { Result: "RUNNING" } },
    ],
  },
};

describe("the .bt model", () => {
  it("writes a vanilla-shaped file back byte for byte", () => {
    expect(emitBt(parseBt(SAMPLE))).toBe(SAMPLE);
    expect(isCanonical(SAMPLE)).toBe(true);
    expect(isCanonical(SAMPLE.replace(" Nodes {", " // note\n Nodes {"))).toBe(false);
  });

  it("refuses text that is not one BehaviorTree block", () => {
    expect(() => parseBt("EffectDef {\n}")).toThrow(/BehaviorTree/);
  });

  it("reads nodes, paths, properties and wiring", () => {
    const view = viewBt(parseBt(SAMPLE));
    expect(view.guid).toBe("0123456789ABCDEF");
    expect(view.nodeCount).toBe(5);
    const deco = findNode(view, "0/0");
    expect(deco.type).toBe("DecoTestVariable");
    expect(deco.props).toEqual({ TestType: "EqualsValue", TestValue: "true" });
    expect(deco.ports).toEqual([{ side: "in", name: "InVariable", inline: true, ref: 0 }]);
    expect(portVariable(view, deco.ports[0])).toBe("alert");
    expect(findNode(view, "Idle").path).toBe("0/0/0");
    expect(findNode(view, "0/1").ports[0]).toMatchObject({
      name: "Stance",
      inline: false,
      ref: -1,
    });
    expect(() => findNode(view, "9")).toThrow(/no node/);
    expect(formatBt(view, "x")).toContain('[0/0/0] AITaskIdle "Idle" {Period=2}');
  });
});

describe("validateBt", () => {
  it("passes the sample", () => {
    expect(
      validateBt(parseBt(SAMPLE), { catalog, expectedPath: "AI/BehaviorTrees/T/Sample.bt" }),
    ).toEqual([]);
  });

  it("reports a port past the references, a decorator without a child, and an unknown class", () => {
    const text = SAMPLE.replace("InVariable 0", "InVariable 4")
      .replace("AITaskIdle Idle {", "MadeUpNode Idle {")
      .replace(
        /      SCR_AISetStance[\s\S]*?m_eStance CROUCH\n      \}\n/,
        '      Repeater Repeater {\n       Name "Repeater"\n       EditorPos 1 1\n      }\n',
      );
    const found = validateBt(parseBt(text), { catalog }).map(
      (f) => `${f.level} ${f.at} ${f.message}`,
    );
    expect(found.some((m) => /^error 0\/0 .*reference 4/.test(m))).toBe(true);
    expect(found.some((m) => /^error 0\/1 Repeater has 0 children/.test(m))).toBe(true);
    expect(
      found.some((m) => /^warning 0\/0\/0 MadeUpNode is not a Node class of build 1\.9/.test(m)),
    ).toBe(true);
  });

  it("reports a reference whose variable is missing and a RunBT target that is not there", () => {
    const text = SAMPLE.replace("VariableType 0", "VariableType 3").replace(
      "AITaskIdle Idle {",
      'RunBT Idle {\n         BehaviorTree "{0000000000000000}AI/Nope.bt"',
    );
    const found = validateBt(parseBt(text), { catalog, treeExists: () => false });
    expect(found.some((f) => f.level === "error" && /VariableType 3/.test(f.message))).toBe(true);
    expect(found.some((f) => /AI\/Nope\.bt.*not found/.test(f.message))).toBe(true);
  });

  it("keeps the 1.x message with a catalog that has no index list", () => {
    const old: BtCatalog = { ...catalog, tests: undefined };
    const text = SAMPLE.replace("AITaskIdle Idle {", "MadeUpNode Idle {");
    const found = validateBt(parseBt(text), { catalog: old }).map((f) => f.message);
    expect(found.some((m) => /MadeUpNode is in no vanilla tree/.test(m))).toBe(true);
  });

  it("checks a class only the index lists for nothing beyond its existence", () => {
    // SCR_AIDebugCounter is a Node class of the build that no vanilla tree uses.
    expect(catalog.nodes.SCR_AIDebugCounter.count).toBe(0);
    const text = SAMPLE.replace("AITaskIdle Idle {", "SCR_AIDebugCounter Idle {");
    const found = validateBt(parseBt(text), { catalog }).filter((f) => f.at === "0/0/0");
    expect(found).toEqual([]);
  });

  it("warns on a TEST class that is not a BaseDecoratorTest class, and not on one that is", () => {
    const withTest = (cls: string): string =>
      SAMPLE.replace(
        "       TestType EqualsValue",
        `       TEST {\n        ${cls} ${cls} {\n        }\n       }\n       TestType EqualsValue`,
      );
    const good = validateBt(parseBt(withTest("DecoratorTestNotNull")), { catalog });
    expect(good.filter((f) => /TEST class/.test(f.message))).toEqual([]);
    const bad = validateBt(parseBt(withTest("NoSuchTest")), { catalog });
    expect(bad.some((f) => f.at === "0/0" && /TEST class NoSuchTest is not/.test(f.message))).toBe(
      true,
    );
  });

  it("finds no catalog entry through an inherited object key", () => {
    expect(lookupNode(catalog, "constructor")).toBeUndefined();
    expect(lookupNode(catalog, "__proto__")).toBeUndefined();
    expect(lookupTest(catalog, "toString")).toBeUndefined();
    const text = SAMPLE.replace("AITaskIdle Idle {", "constructor Idle {");
    const found = validateBt(parseBt(text), { catalog });
    expect(found.some((f) => /constructor is not a Node class/.test(f.message))).toBe(true);
  });
});

describe("the regenerated catalog (DEC-067 OD-10)", () => {
  it("lists the index's 401 Node and 38 BaseDecoratorTest descendants with vanilla usage", () => {
    expect(catalog.build).toBe("1.9.0.37");
    expect(catalog.files).toBe(121);
    expect(Object.keys(catalog.nodes)).toHaveLength(401);
    expect(Object.keys(catalog.tests ?? {})).toHaveLength(38);
    const used = Object.values(catalog.nodes).filter((n) => n.count > 0);
    expect(used).toHaveLength(303);
    const family: Record<string, number> = {};
    for (const n of Object.values(catalog.nodes))
      family[n.family ?? "?"] = (family[n.family ?? "?"] ?? 0) + 1;
    expect(family).toEqual({
      AITaskScripted: 292,
      AITask: 49,
      DecoratorScripted: 34,
      Decorator: 13,
      Node: 13,
    });
    expect(catalog.nodes.RootNode).toMatchObject({ count: 121, children: [1, 1], scripted: false });
  });

  it("lists every TEST class a vanilla node uses among the tests", () => {
    const tests = catalog.tests ?? {};
    const usedIn = new Set(Object.values(catalog.nodes).flatMap((n) => n.tests));
    expect([...usedIn].filter((t) => !tests[t])).toEqual([]);
  });
});

describe("diffBt", () => {
  const base = (): BtDocument => parseBt(SAMPLE);
  const nodeChanges = (d: BtDiff): BtNodeChange[] =>
    d.changes.filter((c): c is BtNodeChange => c.what === "node");

  it("finds nothing between a tree and itself", () => {
    const d = diffBt(base(), base());
    expect(d.changes).toEqual([]);
    expect(d.summary).toMatchObject({ added: 0, removed: 0, moved: 0, changed: 0, nodesA: 5 });
  });

  it("reports added and removed nodes", () => {
    const after = base();
    applyOp(
      after,
      opOf({ op: "add_node", parent: "0", node: { type: "AITaskReturnState" } }, 0),
      catalog,
    );
    applyOp(after, opOf({ op: "remove_node", node: "Idle" }, 1), catalog);
    const d = diffBt(base(), after);
    expect(nodeChanges(d)).toEqual([
      {
        what: "node",
        change: "added",
        type: "AITaskReturnState",
        name: "AITaskReturnState",
        to: "0/2",
      },
      { what: "node", change: "removed", type: "AITaskIdle", name: "Idle", from: "0/0/0" },
    ]);
    expect(d.summary).toMatchObject({ added: 1, removed: 1, moved: 0 });
  });

  it("reports a move to a new parent and a reorder, not the siblings an insertion shifts", () => {
    const moved = base();
    applyOp(moved, opOf({ op: "move_node", node: "Idle", parent: "0" }, 0), catalog);
    const d = diffBt(base(), moved);
    expect(nodeChanges(d)).toEqual([
      { what: "node", change: "moved", type: "AITaskIdle", name: "Idle", from: "0/0/0", to: "0/2" },
    ]);
    const swapped = base();
    applyOp(swapped, opOf({ op: "move_node", node: "0/1", parent: "0", index: 0 }, 0), catalog);
    const s = diffBt(base(), swapped);
    expect(s.summary.moved).toBe(1);
    const inserted = base();
    applyOp(
      inserted,
      opOf({ op: "add_node", parent: "0", index: 0, node: { type: "AITaskReturnState" } }, 0),
      catalog,
    );
    const i = diffBt(base(), inserted);
    expect(i.summary).toMatchObject({ added: 1, moved: 0 });
  });

  it("reports changed properties, names, port wiring and TEST classes", () => {
    const after = base();
    applyOp(after, opOf({ op: "set_property", node: "Idle", key: "Period", value: 7 }, 0), catalog);
    applyOp(
      after,
      opOf({ op: "set_property", node: "Idle", key: "PeriodRandom", value: 1 }, 1),
      catalog,
    );
    applyOp(after, opOf({ op: "remove_property", node: "0/0", key: "TestValue" }, 2), catalog);
    applyOp(
      after,
      opOf({ op: "connect", node: "0/1", port: "Stance", variable: "alert" }, 3),
      catalog,
    );
    applyOp(after, opOf({ op: "rename_node", node: "0/1", name: "Crouch" }, 4), catalog);
    const d = diffBt(base(), after);
    const byFrom = Object.fromEntries(nodeChanges(d).map((c) => [c.from, c]));
    expect(byFrom["0/0/0"]).toMatchObject({ change: "changed", to: "0/0/0" });
    expect(byFrom["0/0/0"].params).toEqual([
      { key: "Period", before: "2", after: "7" },
      { key: "PeriodRandom", before: null, after: "1" },
    ]);
    expect(byFrom["0/0"].params).toEqual([{ key: "TestValue", before: "true", after: null }]);
    expect(byFrom["0/1"]).toMatchObject({ change: "changed", name: "Crouch" });
    expect(byFrom["0/1"].params).toEqual([
      { key: "Name", before: "SCR_AISetStance", after: "Crouch" },
      { key: "port in:Stance", before: "(not connected)", after: "alert" },
    ]);
    expect(d.summary).toMatchObject({ changed: 3, moved: 0, added: 0, removed: 0 });
    const t = diffBt(
      base(),
      parseBt(
        SAMPLE.replace(
          "       TestType EqualsValue",
          "       TEST {\n        DecoratorTestNotNull DecoratorTestNotNull {\n        }\n       }\n       TestType EqualsValue",
        ),
      ),
    );
    expect(nodeChanges(t)[0].params).toEqual([
      { key: "TEST", before: null, after: "DecoratorTestNotNull" },
    ]);
  });

  it("reports variable and header changes", () => {
    const after = parseBt(
      SAMPLE.replace("{0123456789ABCDEF}", "{FEDCBA9876543210}").replace(
        'Flags "Input"',
        'Flags "Output"',
      ),
    );
    applyOp(
      after,
      opOf({ op: "add_variable", variable: { name: "n", type: "Integer" } }, 0),
      catalog,
    );
    const d = diffBt(base(), after);
    expect(d.changes[0]).toEqual({
      what: "tree",
      change: "changed",
      params: [{ key: "GUID", before: "0123456789ABCDEF", after: "FEDCBA9876543210" }],
    });
    expect(d.changes.filter((c) => c.what === "variable")).toEqual([
      {
        what: "variable",
        change: "changed",
        name: "alert",
        params: [{ key: "flags", before: "Input", after: "Output" }],
      },
      { what: "variable", change: "added", name: "n" },
    ]);
    expect(d.summary.variables).toBe(2);
  });

  it("matches nodes of the same class and name under matched parents in order", () => {
    // Three identical Sequences under the Selector; the middle one loses its child.
    const spec = (n: number): TreeSpec => ({
      path: "A/x.bt",
      root: {
        type: "Selector",
        children: [0, 1, 2].map((i) => ({
          type: "Sequence",
          children: i === 1 && n === 1 ? [] : [{ type: "AITaskIdle", props: { Period: i } }],
        })),
      },
    });
    const d = diffBt(buildBt(spec(0), catalog), buildBt(spec(1), catalog));
    expect(nodeChanges(d)).toEqual([
      { what: "node", change: "removed", type: "AITaskIdle", name: "AITaskIdle", from: "0/1/0" },
    ]);
  });
});

describe("buildBt", () => {
  const doc = buildBt(SPEC, catalog);
  const text = emitBt(doc);

  it("makes a tree the reader and the checks accept", () => {
    expect(isCanonical(text)).toBe(true);
    expect(validateBt(parseBt(text), { catalog, expectedPath: SPEC.path })).toEqual([]);
    const view = viewBt(parseBt(text));
    expect(view.nodeCount).toBe(7);
    expect(view.name).toBe(SPEC.path);
    expect(view.variables.map((v) => `${v.name}:${v.type}:${v.flags}`)).toEqual([
      "alert:Bool:Input",
      "stance:Integer:0",
    ]);
  });

  it("wires each use to its own canvas reference and quotes as vanilla does", () => {
    const view = viewBt(parseBt(text));
    const deco = findNode(view, "0/0");
    const stance = findNode(view, "0/0/0/0");
    expect(portVariable(view, deco.ports[0])).toBe("alert");
    expect(portVariable(view, stance.ports[0])).toBe("stance");
    expect(deco.ports[0].ref).not.toBe(stance.ports[0].ref);
    expect(text).toContain('TestValue "true"');
    expect(text).toContain("TestType EqualsValue");
    expect(text).toContain('AITaskIdle "Wait a bit" {');
    expect(text).toContain("Period 2");
  });

  it("puts a parent over its children and leaves on separate columns", () => {
    const view = viewBt(parseBt(text));
    const xy = (p: string): number[] => {
      const e = findNode(view, p).block.entries.find(
        (x) => x.kind === "prop" && x.key === "EditorPos",
      );
      return e && e.kind === "prop" ? e.values.map((v) => Number(v.text)) : [];
    };
    const [ax, ay] = xy("0/0/0/0");
    const [bx, by] = xy("0/0/0/1");
    const [sx, sy] = xy("0/0/0");
    expect(bx).toBeGreaterThan(ax);
    expect(by).toBe(ay);
    expect(sx).toBe((ax + bx) / 2);
    expect(sy).toBeLessThan(ay);
  });

  it("refuses an undeclared variable, a bad path and a RootNode in the spec", () => {
    expect(() => buildBt({ ...SPEC, variables: [] }, catalog)).toThrow(
      /is not declared \(declared: none\)/,
    );
    expect(() => buildBt({ ...SPEC, path: "../x.bt" }, catalog)).toThrow(/resource path/);
    expect(() => buildBt({ path: "A/x.bt", root: { type: "RootNode" } }, catalog)).toThrow(
      /RootNode/,
    );
  });

  it("reads an untyped spec and names what is wrong with one", () => {
    expect(treeSpecOf(JSON.parse(JSON.stringify(SPEC)))).toEqual(JSON.parse(JSON.stringify(SPEC)));
    expect(() => treeSpecOf({ path: "A/x.bt", root: { type: "Sequence", kids: [] } })).toThrow(
      /unknown key "kids"/,
    );
    expect(() =>
      treeSpecOf({ path: "A/x.bt", root: { type: "Sequence", children: [{ name: "x" }] } }),
    ).toThrow(/spec\.root\.children\[0\]\.type/);
  });
});

describe("applyOp", () => {
  const fresh = () => parseBt(SAMPLE);
  const run = (doc: ReturnType<typeof fresh>, ...ops: unknown[]): void => {
    ops.forEach((o, i) => applyOp(doc, opOf(o, i), catalog));
  };

  it("sets, removes and renames", () => {
    const doc = fresh();
    run(
      doc,
      { op: "set_property", node: "Idle", key: "Period", value: 5 },
      { op: "set_property", node: "0/0", key: "TestValue", value: "false" },
      { op: "remove_property", node: "0/1", key: "m_eStance" },
      { op: "rename_node", node: "Idle", name: "Hold position" },
    );
    const text = emitBt(doc);
    expect(text).toContain("Period 5");
    expect(text).toContain('TestValue "false"');
    expect(text).not.toContain("m_eStance");
    expect(text).toContain('AITaskIdle "Hold position" {');
    expect(isCanonical(text)).toBe(true);
  });

  it("adds, moves and removes nodes", () => {
    const doc = fresh();
    run(doc, {
      op: "add_node",
      parent: "0",
      node: { type: "AITaskReturnState", props: { Result: "SUCCESS" } },
    });
    expect(findNode(viewBt(doc), "0/2").type).toBe("AITaskReturnState");
    run(doc, { op: "move_node", node: "0/2", parent: "0", index: 0 });
    expect(findNode(viewBt(doc), "0/0").type).toBe("AITaskReturnState");
    run(doc, { op: "remove_node", node: "0/1" });
    const view = viewBt(doc);
    expect(view.nodeCount).toBe(4);
    expect(validateBt(doc, { catalog }).filter((f) => f.level === "error")).toEqual([]);
    expect(() => run(doc, { op: "remove_node", node: "root" })).toThrow(/RootNode/);
    expect(() => run(fresh(), { op: "move_node", node: "0", parent: "0/0" })).toThrow(
      /under itself/,
    );
    expect(() =>
      run(fresh(), { op: "add_node", parent: "root", node: { type: "Sequence" } }),
    ).toThrow(/one child/);
  });

  it("declares a variable and wires ports to it", () => {
    const doc = fresh();
    run(
      doc,
      { op: "add_variable", variable: { name: "stance", type: "Integer" } },
      { op: "connect", node: "0/1", port: "Stance", variable: "stance" },
      { op: "connect", node: "0/0", port: "InVariable", variable: null },
    );
    const view = viewBt(doc);
    expect(portVariable(view, findNode(view, "0/1").ports[0])).toBe("stance");
    expect(findNode(view, "0/0").ports[0].ref).toBe(-1);
    expect(view.refs).toHaveLength(2);
    expect(() =>
      run(doc, { op: "connect", node: "0/1", port: "Nope", variable: "stance" }),
    ).toThrow(/no port/);
    expect(() =>
      run(doc, { op: "connect", node: "0/1", port: "Stance", variable: "ghost" }),
    ).toThrow(/not declared/);
    expect(() =>
      run(doc, { op: "add_variable", variable: { name: "stance", type: "Integer" } }),
    ).toThrow(/already/);
  });
});

describe("the behavior_tree tool", () => {
  const dir = mkdtempSync(join(tmpdir(), "bt-tool-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };
  let handler: (args: Record<string, unknown>) => Promise<Reply> = async () => ({ content: [] });
  const server = {
    registerTool: (_name: string, _def: unknown, h: typeof handler) => {
      handler = h;
    },
  };
  registerBehaviorTree(
    server as never,
    { projectPath: dir, gamePath: "", dataDir: DATA } as Config,
  );
  const call = async (
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> => {
    const r = await handler(args);
    return { text: r.content[0].text, isError: r.isError === true };
  };

  it("creates under the project, and not over an existing file", async () => {
    const made = await call({ action: "create", spec: SPEC });
    expect(made.isError).toBe(false);
    expect(made.text).toContain("No findings");
    const file = join(dir, "AI", "BehaviorTrees", "T", "Guard.bt");
    expect(isCanonical(readFileSync(file, "utf-8"))).toBe(true);
    const again = await call({ action: "create", spec: SPEC });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already exists");
  });

  it("inspects, validates and edits the file it made", async () => {
    const path = "AI/BehaviorTrees/T/Guard.bt";
    expect((await call({ action: "inspect", path })).text).toContain("[0/0/0/1] AITaskIdle");
    expect((await call({ action: "validate", path })).isError).toBe(false);
    const edited = await call({
      action: "edit",
      path,
      ops: [{ op: "set_property", node: "0/0/0/1", key: "Period", value: 9 }],
    });
    expect(edited.isError).toBe(false);
    expect(readFileSync(join(dir, "AI", "BehaviorTrees", "T", "Guard.bt"), "utf-8")).toContain(
      "Period 9",
    );
  });

  it("writes nothing when an op fails, on a dry run, or over a file with comments", async () => {
    const path = "AI/BehaviorTrees/T/Guard.bt";
    const file = join(dir, "AI", "BehaviorTrees", "T", "Guard.bt");
    const before = readFileSync(file, "utf-8");
    const failed = await call({
      action: "edit",
      path,
      ops: [
        { op: "set_property", node: "0/0/0/1", key: "Period", value: 1 },
        { op: "remove_node", node: "7/7" },
      ],
    });
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain("op 2 of 2 failed, nothing written");
    await call({ action: "edit", path, dry_run: true, ops: [{ op: "remove_node", node: "1" }] });
    expect(readFileSync(file, "utf-8")).toBe(before);
    writeFileSync(file, before.replace(" Nodes {", " // mine\n Nodes {"), "utf-8");
    const refused = await call({ action: "edit", path, ops: [{ op: "remove_node", node: "1" }] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("left alone");
  });

  it("refuses a path outside the project and describes node classes", async () => {
    const out = await call({ action: "create", spec: { ...SPEC, path: "AI/../../Escape.bt" } });
    expect(out.isError).toBe(true);
    // An absolute path is read only when it names a tree file.
    const notTree = await call({ action: "inspect", path: join(dir, "notes.txt") });
    expect(notTree.isError).toBe(true);
    expect(notTree.text).toContain("is not a .bt file");
    const one = await call({ action: "nodes", type: "DecoTestVariable" });
    expect(one.text).toContain("variable properties: InVariable");
    expect((await call({ action: "nodes" })).text).toMatch(/Sequence x\d+/);
  });

  // Total audit offline-writers-04 and -01. The .bt part of -04 does not hold: buildBt already
  // refuses a spec.path that is not a .bt resource path, and edit refuses a file that is not one
  // BehaviorTree block. This case pins that.
  it("create refuses a target that is not a .bt and leaves the file alone", async () => {
    const gproj = join(dir, "MyMod.gproj");
    writeFileSync(gproj, "GameProject {\n}\n", "utf-8");
    const res = await call({
      action: "create",
      spec: { ...SPEC, path: "MyMod.gproj" },
      overwrite: true,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("must be a resource path ending in .bt");
    expect(readFileSync(gproj, "utf-8")).toBe("GameProject {\n}\n");
    const edit = await call({
      action: "edit",
      path: "MyMod.gproj",
      ops: [{ op: "remove_node", node: "1" }],
    });
    expect(edit.isError).toBe(true);
    expect(readFileSync(gproj, "utf-8")).toBe("GameProject {\n}\n");
  });

  it("create with overwrite and edit keep a backup of the file they replace", async () => {
    const spec = { ...SPEC, path: "AI/BehaviorTrees/T/Backed.bt" };
    const file = join(dir, "AI", "BehaviorTrees", "T", "Backed.bt");
    expect((await call({ action: "create", spec })).isError).toBe(false);
    const first = readFileSync(file, "utf-8");
    const again = await call({ action: "create", spec, overwrite: true });
    expect(again.isError).toBe(false);
    expect(again.text).toContain(`${file}.bak`);
    expect(readFileSync(`${file}.bak`, "utf-8")).toBe(first);
    const edited = await call({
      action: "edit",
      path: "AI/BehaviorTrees/T/Backed.bt",
      ops: [{ op: "set_property", node: "0/0/0/1", key: "Period", value: 7 }],
    });
    expect(edited.isError).toBe(false);
    expect(edited.text).toContain(`${file}.bak2`);
    expect(readFileSync(`${file}.bak2`, "utf-8")).toBe(first);
    expect(readFileSync(file, "utf-8")).toContain("Period 7");
  });

  it("refuses a projectPath outside the configured project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "bt-outside-"));
    try {
      const res = await call({ action: "create", spec: SPEC, projectPath: outside });
      expect(res.isError).toBe(true);
      expect(res.text).toContain("outside the configured project root");
      expect(existsSync(join(outside, "AI"))).toBe(false);
      const diff = await call({
        action: "diff",
        path: "a.bt",
        other: "b.bt",
        projectPath: outside,
      });
      expect(diff.isError).toBe(true);
      expect(JSON.parse(diff.text).code).toBe("NOT_IN_PROJECT");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps the five 1.x actions, adds diff, and keeps the description within 400 characters", () => {
    expect([...BEHAVIOR_TREE_ACTIONS]).toEqual([
      "inspect",
      "validate",
      "nodes",
      "create",
      "edit",
      "diff",
    ]);
    expect(BEHAVIOR_TREE_DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(BEHAVIOR_TREE_DESCRIPTION).not.toMatch(/sandbox|EMCPFixtures/i);
  });

  type DiffReply = {
    ok: boolean;
    code?: string;
    next?: string;
    readback?: {
      identical: boolean;
      total: number;
      summary: BtDiff["summary"];
      changes: BtDiff["changes"];
      nextCursor?: string;
    };
  };
  const diff = async (args: Record<string, unknown>): Promise<DiffReply & { isError: boolean }> => {
    const r = await call({ action: "diff", ...args });
    return { ...(JSON.parse(r.text) as DiffReply), isError: r.isError };
  };

  it("diffs two project trees", async () => {
    const a = "AI/BehaviorTrees/T/DiffA.bt";
    const b = "AI/BehaviorTrees/T/DiffB.bt";
    await call({ action: "create", spec: { ...SPEC, path: a } });
    await call({ action: "create", spec: { ...SPEC, path: b } });
    const same = await diff({ path: a, other: b });
    expect(same.ok).toBe(true);
    // Only the Name header differs between the two copies.
    expect(same.readback?.summary).toMatchObject({ added: 0, removed: 0, moved: 0, changed: 0 });
    await call({
      action: "edit",
      path: b,
      ops: [
        { op: "remove_node", node: "0/1" },
        { op: "set_property", node: "Wait a bit", key: "Period", value: 4 },
      ],
    });
    const d = await diff({ path: a, other: b });
    expect(d.isError).toBe(false);
    expect(d.readback?.summary).toMatchObject({ removed: 1, changed: 1 });
    expect(d.readback?.changes).toContainEqual({
      what: "node",
      change: "removed",
      type: "AITaskReturnState",
      name: "AITaskReturnState",
      from: "0/1",
    });
  });

  it("pages the changes with a cursor and refuses a stale one", async () => {
    const a = "AI/BehaviorTrees/T/PageA.bt";
    const b = "AI/BehaviorTrees/T/PageB.bt";
    await call({ action: "create", spec: { path: a, root: { type: "Sequence" } } });
    await call({
      action: "create",
      spec: {
        path: b,
        root: {
          type: "Sequence",
          children: [1, 2, 3, 4, 5].map((i) => ({ type: "AITaskIdle", name: `w${i}` })),
        },
      },
    });
    const p1 = await diff({ path: a, other: b, limit: 2 });
    expect(p1.readback?.changes).toHaveLength(2);
    const total = p1.readback!.total;
    expect(p1.readback?.nextCursor).toBe(`2:${total}`);
    expect(p1.next).toContain("2:");
    const p2 = await diff({ path: a, other: b, limit: 2, cursor: p1.readback!.nextCursor });
    const full = await diff({ path: a, other: b, limit: 200 });
    expect(full.readback?.nextCursor).toBeUndefined();
    expect(p2.readback?.changes).toEqual(full.readback!.changes.slice(2, 4));
    const last = await diff({ path: a, other: b, limit: 200, cursor: `${total - 1}:${total}` });
    expect(last.readback?.changes).toHaveLength(1);
    expect(last.readback?.nextCursor).toBeUndefined();
    const stale = await diff({ path: a, other: b, cursor: `0:${total + 3}` });
    expect(stale).toMatchObject({ ok: false, code: "STALE_CURSOR", isError: true });
    const bad = await diff({ path: a, other: b, cursor: "nope" });
    expect(bad).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("refuses a diff without both trees, a missing tree and an unreadable one", async () => {
    expect(await diff({ path: "AI/BehaviorTrees/T/DiffA.bt" })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
      isError: true,
    });
    expect(
      await diff({ path: "AI/BehaviorTrees/T/DiffA.bt", other: "AI/BehaviorTrees/T/Nope.bt" }),
    ).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
    expect(
      await diff({ path: join(dir, "Missing.bt"), other: "AI/BehaviorTrees/T/DiffA.bt" }),
    ).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
    writeFileSync(join(dir, "Broken.bt"), "EffectDef {\n}", "utf-8");
    expect(
      await diff({ path: join(dir, "Broken.bt"), other: "AI/BehaviorTrees/T/DiffA.bt" }),
    ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(await diff({ path: "-x.bt", other: "AI/BehaviorTrees/T/DiffA.bt" })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });

  it("describes classes only the index lists, TEST classes and unknown names", async () => {
    const unused = (await call({ action: "nodes", type: "SCR_AIDebugCounter" })).text;
    expect(unused).toContain("in no vanilla tree");
    expect(unused).toContain("[Attribute] fields: m_bFailAfter");
    expect(unused).toContain("family AITaskScripted");
    const test = (await call({ action: "nodes", type: "DecoratorTestNotNull" })).text;
    expect(test).toMatch(/TEST class; \d+ use/);
    const none = (await call({ action: "nodes", type: "constructor" })).text;
    expect(none).toContain("is not a Node or BaseDecoratorTest class of build 1.9.0.37");
    const list = (await call({ action: "nodes" })).text;
    expect(list).toContain(
      "401 node class(es) of build 1.9.0.37, 303 used in its 121 vanilla trees",
    );
    expect(list).toContain("38 TEST class(es)");
    const few = nodesText(catalog, undefined, "DecoratorTestNotNull");
    expect(few).toContain("### DecoratorTestNotNull");
  });
});
