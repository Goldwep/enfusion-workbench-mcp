import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionError, ActionOk } from "../../src/manifest/vocabulary.js";
import {
  ANIMATION_GRAPH_DESCRIPTION,
  registerAnimationGraph,
  runAnimationGraph,
  type AnimationGraphArgs,
} from "../../src/tools/animation-graph.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const AGF = [
  "AnimSrcGraphFile {",
  " Sheets {",
  "  AnimSrcGraphSheet Master {",
  "   Nodes {",
  "    AnimSrcNodeQueue MasterControl {",
  "     EditorPos 0 0",
  '     Child "Blend N 1"',
  "    }",
  '    AnimSrcNodeBlendN "Blend N 1" {',
  "     EditorPos 1 0",
  '     BlendWeight "GetLOD()"',
  "     Thresholds {",
  "      0 1 2",
  "     }",
  "     Children {",
  '      "Idle" "Walk" "Idle"',
  "     }",
  "    }",
  "    AnimSrcNodeSource Idle {",
  "     EditorPos 2 0",
  '     Source "Loco.Idle"',
  "    }",
  "    AnimSrcNodeSource Walk {",
  "     EditorPos 2 1",
  '     Source "Loco.Erc.Walk"',
  "    }",
  "   }",
  "  }",
  "  AnimSrcGraphSheet Second {",
  "   Nodes {",
  "    AnimSrcNodeBindPose Pose {",
  "     EditorPos 0 0",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
  "",
].join("\n");

const AGR = [
  "AnimSrcGraph {",
  ' AnimSetTemplate "{1111111111111111}Anims/test.ast"',
  ' ControlTemplate AnimSrcGCT "{2222222222222222}" {',
  "  Variables {",
  "   AnimSrcGCTVarFloat Speed {",
  "    MinValue 0",
  "    MaxValue 10",
  "   }",
  "  }",
  "  Commands {",
  "   AnimSrcGCTCmd CMD_Test {",
  "   }",
  "  }",
  "  GlobalTags {",
  '   "ITEM"',
  "  }",
  " }",
  " GraphFilesResourceNames {",
  '  "{3333333333333333}Anims/test.agf"',
  '  "{4444444444444444}Anims/missing.agf"',
  " }",
  ' DefaultRunNode "MasterControl"',
  "}",
  "",
].join("\n");

const BAD_AGF = [
  "AnimSrcGraphFile {",
  " Sheets {",
  "  AnimSrcGraphSheet Master {",
  "   Nodes {",
  "    AnimSrcNodeBindPose Twin {",
  "    }",
  "    AnimSrcNodeBindPose Twin {",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
  "",
].join("\n");

const AST = [
  "AnimSetTemplateSource {",
  " Groups {",
  '  AnimSetTemplateSource_AnimationGroup "{5555555555555555}" {',
  '   Name "Loco"',
  "   Animations {",
  '    "Idle"',
  "   }",
  "   Columns {",
  '    "Erc"',
  "   }",
  "  }",
  " }",
  "}",
  "",
].join("\n");

const ASI = [
  'AnimSetInstanceSource "{6666666666666666}" {',
  " Lines {",
  '  AnimSetInstanceSource_Line "Loco.Erc.Walk" {',
  '   Resource "{7777777777777777}Anims/walk.anm"',
  "  }",
  " }",
  "}",
  "",
].join("\n");

const AW = [
  "BaseSource {",
  ' AnimGraph "{8888888888888888}Anims/test.agr"',
  ' AnimSetTemplate "{1111111111111111}Anims/test.ast"',
  " AnimSetInstances {",
  '  "{6666666666666666}Anims/test.asi"',
  " }",
  "}",
  "",
].join("\n");

const tmp = mkdtempSync(join(tmpdir(), "anim-graph-tool-"));
const project = join(tmp, "project");
const game = join(tmp, "game");
const config = makeConfig({ projectPath: project, gamePath: game, dataDir: join(tmp, "data") });

function put(root: string, rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

function reset(): void {
  rmSync(project, { recursive: true, force: true });
  rmSync(game, { recursive: true, force: true });
  put(project, "Anims/test.agf", AGF);
  put(project, "Anims/test.agr", AGR);
  put(project, "Anims/bad.agf", BAD_AGF);
  put(project, "Anims/test.ast", AST);
  put(project, "Anims/test.asi", ASI);
  put(project, "Anims/test.aw", AW);
  put(project, "Anims/broken.agf", "AnimSrcGraphFile {\n Sheets {\n");
  put(join(game, "addons", "data"), "Game/vanilla.agf", AGF);
}

beforeEach(reset);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(args: Partial<AnimationGraphArgs> & { action: AnimationGraphArgs["action"] }) {
  return runAnimationGraph(args as AnimationGraphArgs, config);
}

function ok(
  args: Partial<AnimationGraphArgs> & { action: AnimationGraphArgs["action"] },
): ActionOk {
  const r = run(args);
  const res = JSON.parse(r.text) as ActionOk | ActionError;
  if (!res.ok) throw new Error(`refused ${res.code}: ${res.message}`);
  expect(r.isError).toBe(false);
  return res;
}

function refused(
  args: Partial<AnimationGraphArgs> & { action: AnimationGraphArgs["action"] },
): ActionError {
  const r = run(args);
  const res = JSON.parse(r.text) as ActionOk | ActionError;
  if (res.ok) throw new Error(`expected a refusal, got ${r.text.slice(0, 300)}`);
  expect(r.isError).toBe(true);
  return res;
}

const rb = (r: ActionOk) => r.readback as Record<string, unknown>;
const agfText = () => readFileSync(join(project, "Anims/test.agf"), "utf-8");
const agrText = () => readFileSync(join(project, "Anims/test.agr"), "utf-8");

// ── Registration and description ─────────────────────────────────────────────

describe("registration", () => {
  it("keeps the description within 400 characters and names every action", () => {
    expect(ANIMATION_GRAPH_DESCRIPTION.length).toBeLessThanOrEqual(400);
    for (const w of [
      "inspect",
      "validate",
      "nodes",
      "edit",
      "author",
      "setup",
      "addNode",
      "addVariable",
    ]) {
      expect(ANIMATION_GRAPH_DESCRIPTION).toContain(w);
    }
  });

  it("registers animation_graph and answers through the handler", async () => {
    let name = "";
    const handler = captureTool((s) => {
      const orig = s.registerTool.bind(s);
      (s as unknown as { registerTool: typeof orig }).registerTool = ((
        n: string,
        d: unknown,
        h: unknown,
      ) => {
        name = n;
        return (orig as unknown as (a: string, b: unknown, c: unknown) => unknown)(n, d, h);
      }) as typeof orig;
      registerAnimationGraph(s, config);
    });
    expect(name).toBe("animation_graph");
    const r = await handler({ action: "nodes", query: "BlendN" });
    expect(r.isError).toBe(false);
    expect(textOf(r)).toContain("AnimSrcNodeBlendN");
    const bad = await handler({ action: "edit", path: "Anims/test.agf" });
    expect(bad.isError).toBe(true);
  });
});

// ── inspect ──────────────────────────────────────────────────────────────────

describe("inspect", () => {
  it("summarises each file type as text (1.x)", () => {
    expect(run({ action: "inspect", path: "Anims/test.agf" }).text).toContain("MasterControl");
    expect(run({ action: "inspect", path: "Anims/test.agr" }).text).toContain(
      "DefaultRunNode: MasterControl",
    );
    expect(run({ action: "inspect", path: "Anims/test.ast" }).text).toContain("Loco");
    expect(run({ action: "inspect", path: "Anims/test.asi" }).text).toContain(
      "Erc.Walk -> Anims/walk.anm",
    );
    expect(run({ action: "inspect", path: "Anims/test.aw" }).text).toContain("AnimGraph:");
  });

  it("reads a game file with source game", () => {
    expect(run({ action: "inspect", path: "Game/vanilla.agf", source: "game" }).text).toContain(
      "MasterControl",
    );
  });

  it("refuses an unknown type, a missing path and a missing file", () => {
    expect(run({ action: "inspect", path: "a.conf" }).isError).toBe(true);
    expect(run({ action: "inspect" }).isError).toBe(true);
    const r = run({ action: "inspect", path: "Anims/none.agf" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no file");
  });

  it("pages nodes as json with a cursor, and refuses a stale cursor", () => {
    const p1 = ok({ action: "inspect", path: "Anims/test.agf", format: "json", limit: 2 });
    expect(rb(p1).total).toBe(5);
    expect((rb(p1).items as { name: string }[]).map((i) => i.name)).toEqual([
      "MasterControl",
      "Blend N 1",
    ]);
    expect(rb(p1).nextCursor).toBe("2:5");
    const blend = (rb(p1).items as { children: string[]; props: { thresholds: number[] } }[])[1];
    expect(blend.children).toEqual(["Idle", "Walk", "Idle"]);
    expect(blend.props.thresholds).toEqual([0, 1, 2]);
    const p2 = ok({
      action: "inspect",
      path: "Anims/test.agf",
      format: "json",
      limit: 2,
      cursor: "4:5",
    });
    expect((rb(p2).items as { name: string }[]).map((i) => i.name)).toEqual(["Pose"]);
    expect(rb(p2).nextCursor).toBeUndefined();
    expect(
      refused({ action: "inspect", path: "Anims/test.agf", format: "json", cursor: "0:9" }).code,
    ).toBe("STALE_CURSOR");
    expect(
      refused({ action: "inspect", path: "Anims/test.agf", format: "json", cursor: "x" }).code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("lists agr items as json", () => {
    const r = ok({ action: "inspect", path: "Anims/test.agr", format: "json" });
    expect(rb(r).defaultRunNode).toBe("MasterControl");
    const kinds = (rb(r).items as { kind: string }[]).map((i) => i.kind);
    expect(kinds).toEqual(["variable", "command", "tag", "file", "file"]);
  });

  it("runs the validate alias as the 1.x text report, without the KD-W4-1 throw", () => {
    const r = run({
      action: "inspect",
      path: "Anims/test.agf",
      inspectAction: "validate",
      agrPath: "Anims/test.agr",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/ISSUES: 0 error\(s\)/);
    expect(r.text).toContain("Demoted to warnings");
  });
});

// ── validate ─────────────────────────────────────────────────────────────────

describe("validate", () => {
  it("validates an .agf with its .agr: demoted rules are warnings", () => {
    const r = ok({ action: "validate", path: "Anims/test.agf", agrPath: "Anims/test.agr" });
    expect(rb(r).errorCount).toBe(0);
    const issues = rb(r).issues as { id: string; severity: string; demoted?: string }[];
    expect(issues.some((i) => i.id === "V08" && i.severity === "warning" && i.demoted)).toBe(true);
    expect(issues.some((i) => i.id === "V15" && i.severity === "warning")).toBe(true);
  });

  it("validates every .agf an .agr lists and names the missing ones", () => {
    const r = ok({ action: "validate", path: "Anims/test.agr" });
    expect((rb(r).files as { path: string }[]).map((f) => f.path)).toEqual(["Anims/test.agf"]);
    expect(r.warnings.join(" ")).toContain("Anims/missing.agf");
  });

  it("reports a rule that does not fire on vanilla as an error, and pages the issues", () => {
    const r = ok({ action: "validate", path: "Anims/bad.agf", limit: 1 });
    expect(rb(r).errorCount).toBe(1);
    expect((rb(r).issues as { id: string }[])[0].id).toBe("V04");
    expect(rb(r).total).toBeGreaterThan(1);
    expect(rb(r).nextCursor).toBe("1:" + String(rb(r).total));
  });

  it("refuses a wrong type, an absolute path, a missing file and no project", () => {
    expect(refused({ action: "validate", path: "Anims/test.ast" }).code).toBe("INVALID_ARGUMENT");
    expect(refused({ action: "validate" }).code).toBe("INVALID_ARGUMENT");
    expect(refused({ action: "validate", path: "C:/x/test.agf" }).code).toBe("ABSOLUTE_PATH");
    expect(refused({ action: "validate", path: "Anims/none.agf" }).code).toBe("PATH_NOT_FOUND");
    const noProject = runAnimationGraph(
      { action: "validate", path: "Anims/test.agf" },
      makeConfig({ projectPath: "", gamePath: game }),
    );
    expect(JSON.parse(noProject.text).code).toBe("NOT_IN_PROJECT");
  });
});

// ── nodes ────────────────────────────────────────────────────────────────────

describe("nodes", () => {
  it("lists node classes of the catalog, filtered and paged", () => {
    const r = ok({ action: "nodes", kind: "node", limit: 5 });
    expect(rb(r).build).toBe("1.9.0.37");
    expect((rb(r).items as unknown[]).length).toBe(5);
    expect(rb(r).total as number).toBeGreaterThan(30);
    expect(rb(r).nextCursor).toBe(`5:${rb(r).total}`);
    const q = ok({ action: "nodes", query: "statemachine" });
    expect((q.readback as { items: { name: string }[] }).items.map((i) => i.name)).toEqual([
      "AnimSrcNodeStateMachine",
    ]);
  });

  it("gives one class with key signatures, and the enum keys", () => {
    const r = ok({ action: "nodes", nodeClass: "AnimSrcNodeBlendN" });
    const cls = rb(r).class as { kind: string; keys: { name: string; signature: string }[] };
    expect(cls.kind).toBe("node");
    expect(cls.keys.find((k) => k.name === "Thresholds")?.signature).toBe("array of numbers");
    const e = ok({ action: "nodes", kind: "enum", query: "ProcTrBoneItem" });
    const items = rb(e).items as { key: string; values: string[] }[];
    expect(items.find((i) => i.key === "Axis")?.values).toEqual(["X", "Y", "Z"]);
  });

  it("refuses an unknown class with close names", () => {
    const r = refused({ action: "nodes", nodeClass: "AnimSrcNodeBlendX" });
    expect(r.code).toBe("ITEM_NOT_FOUND");
  });
});

// ── edit ─────────────────────────────────────────────────────────────────────

describe("edit: dry run, write, backup, inverse", () => {
  it("plans addNode without writing, then writes it with a backup, and the inverse restores the file", () => {
    const dry = ok({
      action: "edit",
      path: "Anims/test.agf",
      op: "addNode",
      sheet: "Master",
      nodeClass: "AnimSrcNodeSleep",
      name: "Nap",
      editorPos: [3, 4],
      props: { AwakeExpr: "1", Child: "Idle" },
    });
    expect(rb(dry).dryRun).toBe(true);
    expect(rb(dry).diff).toContain("+    AnimSrcNodeSleep Nap {");
    expect(agfText()).toBe(AGF);
    expect(dry.warnings).toEqual([]);

    const wrote = ok({
      action: "edit",
      path: "Anims/test.agf",
      op: "addNode",
      sheet: "Master",
      nodeClass: "AnimSrcNodeSleep",
      name: "Nap",
      editorPos: [3, 4],
      props: { AwakeExpr: "1", Child: "Idle" },
      confirm: true,
    });
    expect(rb(wrote).written).toBe(true);
    expect(rb(wrote).verified).toBe(true);
    expect(readFileSync(join(project, "Anims/test.agf.bak"), "utf-8")).toBe(AGF);
    expect(agfText()).toContain(
      [
        "    AnimSrcNodeSleep Nap {",
        "     EditorPos 3 4",
        '     AwakeExpr "1"',
        '     Child "Idle"',
        "    }",
      ].join("\n"),
    );
    const inverse = rb(wrote).inverse as AnimationGraphArgs;
    expect(inverse).toEqual({ op: "removeNode", sheet: "Master", name: "Nap" });
    ok({ ...inverse, action: "edit", path: "Anims/test.agf", confirm: true });
    expect(agfText()).toBe(AGF);
  });

  it("answers no write when the content is unchanged", () => {
    const r = ok({
      action: "edit",
      path: "Anims/test.agf",
      op: "setProp",
      node: "Idle",
      prop: "Source",
      value: "Loco.Idle",
      confirm: true,
    });
    expect(rb(r).written).toBe(false);
    expect(existsSync(join(project, "Anims/test.agf.bak"))).toBe(false);
  });
});

/** Runs an op with confirm, then its inverse, and checks the file is back to `orig`. */
function roundTrip(path: string, orig: () => string, args: Partial<AnimationGraphArgs>): ActionOk {
  const before = orig();
  const r = ok({ action: "edit", path, ...args, confirm: true });
  expect(rb(r).written).toBe(true);
  expect(orig()).not.toBe(before);
  ok({ action: "edit", path, ...(rb(r).inverse as object), confirm: true });
  expect(orig()).toBe(before);
  return r;
}

describe("edit: agf ops and their inverses", () => {
  it("removeNode warns about dangling connections and restores with raw+index", () => {
    const r = roundTrip("Anims/test.agf", agfText, { op: "removeNode", name: "Idle" });
    expect(r.warnings.join(" ")).toContain("Blend N 1");
    expect((rb(r).inverse as { raw: string; index: number }).index).toBe(2);
  });

  it("setProp changes, adds and removes a property", () => {
    const a = roundTrip("Anims/test.agf", agfText, {
      op: "setProp",
      node: "Walk",
      prop: "EditorPos",
      value: [9, 9],
    });
    expect(a.changed![0]).toMatchObject({ before: "EditorPos 2 1", after: "EditorPos 9 9" });
    const b = roundTrip("Anims/test.agf", agfText, {
      op: "setProp",
      node: "Walk",
      prop: "Looptype",
      value: "Loop",
      quoted: false,
    });
    expect(b.changed![0].after).toBe("Looptype Loop");
    roundTrip("Anims/test.agf", agfText, {
      op: "setProp",
      node: "Walk",
      prop: "Source",
      value: null,
    });
    roundTrip("Anims/test.agf", agfText, {
      op: "setProp",
      node: "Blend N 1",
      prop: "Children[0]",
      value: ["Walk", "Walk", "Idle"],
    });
    const w = ok({
      action: "edit",
      path: "Anims/test.agf",
      op: "setProp",
      node: "Walk",
      prop: "Bogus",
      value: 1,
    });
    expect(w.warnings.join(" ")).toContain("no key 'Bogus'");
  });

  it("connect sets a Child slot, and disconnect removes one", () => {
    const c = roundTrip("Anims/test.agf", agfText, {
      op: "connect",
      node: "MasterControl",
      to: "Walk",
    });
    expect(c.changed![0].after).toBe('Child "Walk"');
    expect(rb(c).inverse).toMatchObject({ op: "connect", to: "Blend N 1" });
    const n = roundTrip("Anims/test.agf", agfText, { op: "connect", node: "Walk", to: "Idle" });
    expect(rb(n).inverse).toMatchObject({ op: "disconnect", slot: "Child" });
    const d = roundTrip("Anims/test.agf", agfText, { op: "disconnect", node: "MasterControl" });
    expect(rb(d).inverse).toMatchObject({ op: "connect", slot: "Child" });
    const x = ok({
      action: "edit",
      path: "Anims/test.agf",
      op: "connect",
      node: "Walk",
      to: "Pose",
    });
    expect(x.warnings.join(" ")).toContain("another sheet");
  });

  it("addSheet and removeSheet", () => {
    const a = roundTrip("Anims/test.agf", agfText, { op: "addSheet", name: "Third" });
    expect(a.changed![0].after).toContain("AnimSrcGraphSheet Third {");
    const r = roundTrip("Anims/test.agf", agfText, { op: "removeSheet", name: "Second" });
    expect(r.warnings.join(" ")).toContain("1 node");
  });

  it("refuses bad agf ops before anything is written", () => {
    const e = (args: Partial<AnimationGraphArgs>) =>
      refused({ action: "edit", path: "Anims/test.agf", ...args }).code;
    expect(e({})).toBe("INVALID_ARGUMENT");
    expect(
      e({ op: "addNode", sheet: "Master", nodeClass: "AnimSrcNodeSource", name: "Idle" }),
    ).toBe("DUPLICATE_ID");
    expect(e({ op: "addNode", sheet: "Master", nodeClass: "Nope", name: "X" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(e({ op: "addNode", nodeClass: "AnimSrcNodeSource", name: "X" })).toBe(
      "INVALID_ARGUMENT",
    ); // two sheets
    expect(e({ op: "addNode", sheet: "Nope", nodeClass: "AnimSrcNodeSource", name: "X" })).toBe(
      "ITEM_NOT_FOUND",
    );
    expect(e({ op: "removeNode", name: "Ghost" })).toBe("ITEM_NOT_FOUND");
    expect(e({ op: "connect", node: "Walk", to: "Ghost" })).toBe("ITEM_NOT_FOUND");
    expect(e({ op: "connect", node: "Walk", to: "Walk" })).toBe("INVALID_ARGUMENT");
    expect(e({ op: "disconnect", node: "Walk" })).toBe("PATH_NOT_FOUND");
    expect(e({ op: "setProp", node: "Walk", prop: "Source" })).toBe("INVALID_ARGUMENT");
    expect(e({ op: "setProp", node: "Blend N 1", prop: "Thresholds", value: 1 })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(e({ op: "addSheet", name: "Master" })).toBe("DUPLICATE_ID");
    expect(e({ op: "addFile", file: "x.agf" })).toBe("INVALID_ARGUMENT"); // an .agr op
    expect(agfText()).toBe(AGF);
  });

  it("warns about a class outside the catalog", () => {
    const r = ok({
      action: "edit",
      path: "Anims/test.agf",
      op: "addNode",
      sheet: "Second",
      nodeClass: "AnimSrcNodeFuture",
      name: "F",
    });
    expect(r.warnings.join(" ")).toContain("not a node class of the 1.9.0.37 catalog");
  });
});

describe("edit: agr ops and their inverses", () => {
  it("addFile and removeFile", () => {
    const a = roundTrip("Anims/test.agr", agrText, {
      op: "addFile",
      file: "{abcdefabcdefabcd}Anims/more.agf",
    });
    expect(a.changed![0].after).toBe("{ABCDEFABCDEFABCD}Anims/more.agf");
    expect(a.warnings.join(" ")).toContain("not in the project");
    roundTrip("Anims/test.agr", agrText, { op: "removeFile", file: "Anims/missing.agf" });
    expect(
      refused({ action: "edit", path: "Anims/test.agr", op: "addFile", file: "Anims/test.agf" })
        .code,
    ).toBe("DUPLICATE_ID");
    expect(
      refused({ action: "edit", path: "Anims/test.agr", op: "removeFile", file: "Anims/zzz.agf" })
        .code,
    ).toBe("ITEM_NOT_FOUND");
  });

  it("setDefaultRunNode sets, checks the graph's nodes, and removes", () => {
    const a = roundTrip("Anims/test.agr", agrText, { op: "setDefaultRunNode", name: "Walk" });
    expect(a.warnings).toEqual([]);
    const b = ok({
      action: "edit",
      path: "Anims/test.agr",
      op: "setDefaultRunNode",
      name: "Ghost",
    });
    expect(b.warnings.join(" ")).toContain("no node 'Ghost'");
    roundTrip("Anims/test.agr", agrText, { op: "setDefaultRunNode", name: null });
  });

  it("addVariable and removeVariable", () => {
    const a = roundTrip("Anims/test.agr", agrText, {
      op: "addVariable",
      name: "Gear",
      varType: "Int",
      min: 0,
      max: 6,
    });
    expect(a.changed![0].after).toBe(
      ["AnimSrcGCTVarInt Gear {", "    MinValue 0", "    MaxValue 6", "   }"].join("\n"),
    );
    roundTrip("Anims/test.agr", agrText, {
      op: "addVariable",
      name: "Flag",
      varType: "Bool",
      defaultValue: 1,
    });
    roundTrip("Anims/test.agr", agrText, { op: "removeVariable", name: "Speed" });
    const e = (args: Partial<AnimationGraphArgs>) =>
      refused({ action: "edit", path: "Anims/test.agr", ...args }).code;
    expect(e({ op: "addVariable", name: "Speed" })).toBe("DUPLICATE_ID");
    expect(e({ op: "addVariable", name: "bad name" })).toBe("INVALID_ARGUMENT");
    expect(e({ op: "addVariable", name: "B", varType: "Bool", min: 0 })).toBe("INVALID_ARGUMENT");
    expect(e({ op: "addVariable", name: "I", varType: "Int", max: 1.5 })).toBe("INVALID_ARGUMENT");
    expect(e({ op: "removeVariable", name: "Ghost" })).toBe("ITEM_NOT_FOUND");
    expect(e({ op: "addNode", sheet: "Master", nodeClass: "AnimSrcNodeSource", name: "X" })).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("edit: project guard", () => {
  it("refuses a game resource, a path outside the project, a missing file and no project root", () => {
    const e = (path: string) => refused({ action: "edit", path, op: "removeNode", name: "Idle" });
    const g = e("Game/vanilla.agf");
    expect(g.code).toBe("NOT_IN_PROJECT");
    expect(g.next).toContain("game_duplicate");
    expect(e("../outside.agf").code).toBe("ABSOLUTE_PATH");
    expect(e("Anims/none.agf").code).toBe("PATH_NOT_FOUND");
    const noRoot = runAnimationGraph(
      { action: "edit", path: "Anims/test.agf", op: "removeNode", name: "Idle" },
      makeConfig({ projectPath: "", gamePath: game }),
    );
    expect(JSON.parse(noRoot.text).code).toBe("NOT_IN_PROJECT");
  });

  it("refuses a file the parser cannot reproduce cleanly", () => {
    const r = refused({ action: "edit", path: "Anims/broken.agf", op: "addSheet", name: "S" });
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toContain("diagnostic");
  });
});

// ── 1.x author and setup ─────────────────────────────────────────────────────

describe("author and setup (1.x)", () => {
  it("author writes the .agr and .ast scaffold", () => {
    const r = run({ action: "author", vehicleName: "Truck", outputPath: "Vehicles/Truck" });
    expect(r.isError).toBe(false);
    expect(readFileSync(join(project, "Vehicles/Truck/Truck.agr"), "utf-8")).toContain(
      'DefaultRunNode "MasterControl"',
    );
    expect(run({ action: "author" }).isError).toBe(true);
  });

  it("setup returns the guide, suggestions and the scaffold steps", () => {
    expect(
      run({ action: "setup", setupSubAction: "guide", preset: "weapon" }).text.length,
    ).toBeGreaterThan(100);
    expect(
      run({ action: "setup", setupSubAction: "suggest", agfPath: "Anims/test.agf" }).isError,
    ).toBe(false);
    expect(run({ action: "setup", setupSubAction: "suggest" }).isError).toBe(true);
    const s = run({
      action: "setup",
      vehicleName: "Truck",
      outputPath: "Vehicles/Truck",
      step: "checklist",
    });
    expect(s.text).toContain("Verification Checklist");
  });
});

// Census rows this file tests (W4 close-out, EV-W4-053).
// census:mcp:action/animation_graph.nodes
// census:mcp:action/animation_graph.validate
