import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, describe, expect, it } from "vitest";
import type { Config } from "../../src/config.js";
import { PROCANIM_CLASSES } from "../../src/procanim/catalog.js";
import {
  PROCANIM_RECOMPILE_SCRIPTED,
  applyOp,
  opOf,
  parseProcAnim,
  skeleton,
  validateProcAnim,
  viewProcAnim,
  type ProcAnimOp,
} from "../../src/procanim/model.js";
import {
  PROCANIM_DESCRIPTION,
  registerProcAnim,
  runProcAnim,
  unifiedDiff,
  type ProcAnimRequest,
} from "../../src/tools/procanim.js";
import { captureTool } from "./_tool-harness.js";

// Vanilla shape (one space of indent, LF, no final line ending); the content is made up.
const PAP = [
  "ProcAnimProjectClass {",
  " signals {",
  "  SignalClass {",
  "   id 10",
  '   name "Signal 10"',
  "   tl 0 0",
  '   res "{0123456789ABCDEF}anims/proc/test.siga"',
  "   inputsport {",
  "    1",
  "   }",
  "   outputsport {",
  "    2",
  "   }",
  "   inputvalues {",
  "    0.5",
  "   }",
  "   inputvaluesmin {",
  "    0",
  "   }",
  "   inputvaluesmax {",
  "    1",
  "   }",
  "  }",
  " }",
  " funcs {",
  "  BoneClass {",
  "   id 20",
  '   name "Bone 20"',
  "   version 0",
  "   tl 100 0",
  "   outs {",
  "    30",
  "   }",
  '   bone "Pendulum"',
  "  }",
  "  RotationSetClass {",
  "   id 30",
  '   name "RotationSet 30"',
  "   tl 200 0",
  "   funcs {",
  "    IOPConnectionClass iopConnection {",
  "     port 0",
  "     conn {",
  "      ConnectionsClass connections {",
  "       id 2",
  "       links {",
  "        ConnectionClass connection {",
  "         id 20",
  "         port 0",
  "        }",
  "       }",
  "      }",
  "     }",
  "    }",
  "    IOPConnectionClass iopConnection {",
  "     port 1",
  "     conn {",
  "      ConnectionsClass connections {",
  "       id 2",
  "       links {",
  "        ConnectionClass connection {",
  "         id 10",
  "         port 2",
  "        }",
  "       }",
  "      }",
  "     }",
  "    }",
  "   }",
  "  }",
  " }",
  ' model "{C36C88941BB7949F}Assets/test.xob"',
  " version 1",
  " compiled ProcAnimCompiledClass {",
  "  version 2",
  "  ops {",
  "   ProcAnimCompiledOp {",
  "    data {",
  "     1 0 0",
  "    }",
  "   }",
  "   ProcAnimCompiledOp {",
  "    data {",
  "     1 0 0",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const SIGA = [
  "ProcAnimSignalResClass {",
  " Inputs {",
  "  IOPItemInputClass {",
  "   id 1",
  '   name "Needle"',
  "   tl 0 0",
  "   children {",
  "    3",
  "   }",
  "   valueMin -180",
  "   valueMax 180",
  "  }",
  " }",
  " Ops {",
  "  IOPItemOpMulClass {",
  "   id 3",
  '   name "Mul 3"',
  "   tl 50 0",
  "   children {",
  "    2",
  "   }",
  "   inputs {",
  "    ConnectionClass connection {",
  "     id 1",
  "     port 0",
  "    }",
  "   }",
  "  }",
  " }",
  " Outputs {",
  "  IOPItemOutputClass {",
  "   id 2",
  '   name "Out"',
  "   tl 100 0",
  "   input 3",
  "  }",
  " }",
  " compiled IOPCompiledClass {",
  "  ins {",
  "   IOPCompiledIn {",
  "    data {",
  "     1 3",
  "    }",
  "   }",
  "  }",
  "  ops {",
  "   IOPCompiledOp {",
  "    data {",
  "     1 0",
  "    }",
  "   }",
  "  }",
  "  outs {",
  "   IOPCompiledOut {",
  "    data {",
  "     0",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const resolveSiga = (res: string) => (res.endsWith("anims/proc/test.siga") ? SIGA : undefined);

const dir = mkdtempSync(join(tmpdir(), "procanim-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const config = { projectPath: dir, gamePath: "", dataDir: "" } as Config;

function put(rel: string, text: string): string {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const run = (req: ProcAnimRequest, cfg: Config = config) => runProcAnim(req, cfg);
type Bag = Record<string, unknown>;
const rb = (r: ReturnType<typeof run>): Bag => (r as unknown as { readback: Bag }).readback;
const err = (r: ReturnType<typeof run>) =>
  r as unknown as { ok: false; code: string; message: string; next: string };

/** Applies ops to the text in memory. */
function apply(text: string, ...ops: ProcAnimOp[]): string {
  const p = parseProcAnim(text);
  for (const op of ops) applyOp(p, op);
  return p.doc.serialize();
}

describe("the model", () => {
  it("reads a .pap and a .siga byte for byte and says which it is", () => {
    expect(parseProcAnim(PAP).doc.serialize()).toBe(PAP);
    expect(parseProcAnim(Buffer.from(SIGA)).kind).toBe("siga");
    expect(parseProcAnim(PAP).kind).toBe("pap");
  });

  it("refuses text that is not a ProcAnim file, and a kind that does not match", () => {
    expect(() => parseProcAnim("ImageSetClass {\n}")).toThrow(/not a ProcAnim file/);
    expect(() => parseProcAnim("ProcAnimProjectClass {\n signals {")).toThrow(/line/);
    expect(() => parseProcAnim(PAP, "siga")).toThrow(/not a \.siga/);
  });

  it("views the nodes, the links and the compiled blocks of a .pap", () => {
    const v = viewProcAnim(parseProcAnim(PAP));
    expect(v.nodes.map((n) => [n.section, n.cls, n.id])).toEqual([
      ["signals", "SignalClass", 10],
      ["funcs", "BoneClass", 20],
      ["funcs", "RotationSetClass", 30],
    ]);
    const set = v.nodes[2];
    expect(set.links).toEqual([
      { port: 0, conn: 2, from: 20, fromPort: 0 },
      { port: 1, conn: 2, from: 10, fromPort: 2 },
    ]);
    expect(v.nodes[1].outs).toEqual([30]);
    expect(v.nodes[0].inputsPort).toEqual([1]);
    expect(v.nodes[0].props.res).toBe("{0123456789ABCDEF}anims/proc/test.siga");
    expect(v.model).toBe("{C36C88941BB7949F}Assets/test.xob");
    expect(v.papCompiled).toMatchObject({ version: "2", ops: 2 });
  });

  it("views a .siga", () => {
    const v = viewProcAnim(parseProcAnim(SIGA));
    expect(v.nodes.map((n) => [n.section, n.id])).toEqual([
      ["Inputs", 1],
      ["Ops", 3],
      ["Outputs", 2],
    ]);
    expect(v.nodes[1].links).toEqual([{ from: 1, fromPort: 0 }]);
    expect(v.nodes[2].input).toBe(3);
    expect(v.sigaCompiled).toMatchObject({ ins: 1, ops: 1, outs: 1 });
  });
});

describe("validate", () => {
  const rules = (text: string, resolve = resolveSiga) =>
    validateProcAnim(parseProcAnim(text), { resolveSiga: resolve }).map(
      (f) => `${f.level}:${f.code}`,
    );

  it("finds nothing in the two fixtures", () => {
    expect(rules(PAP)).toEqual([]);
    expect(rules(SIGA)).toEqual([]);
  });

  it("flags a link to a node the file lacks", () => {
    expect(rules(PAP.replace("id 20\n         port 0", "id 99\n         port 0"))).toContain(
      "error:dangling-link",
    );
  });

  it("flags an outs entry that names no node", () => {
    expect(rules(PAP.replace("    30\n   }\n   bone", "    31\n   }\n   bone"))).toContain(
      "error:dangling-out",
    );
  });

  it("flags duplicate ids and a node with no id", () => {
    expect(rules(PAP.replace("id 30", "id 20"))).toContain("error:duplicate-id");
    expect(rules(PAP.replace("   id 30\n", ""))).toContain("error:no-id");
  });

  it("flags signal ports the .siga lacks, and warns when the .siga is missing", () => {
    expect(rules(PAP.replace("inputsport {\n    1", "inputsport {\n    7"))).toContain(
      "error:signal-input-missing",
    );
    expect(rules(PAP.replace("outputsport {\n    2", "outputsport {\n    8"))).toContain(
      "error:signal-output-missing",
    );
    expect(rules(PAP, () => undefined)).toEqual(["warning:siga-not-found"]);
    expect(rules(PAP, () => "not a siga")).toEqual(["warning:siga-unreadable"]);
    // No resolver: the cross-file rules are skipped.
    expect(validateProcAnim(parseProcAnim(PAP))).toEqual([]);
  });

  it("warns, never errors, on a link to an output the signal does not list and on a value count mismatch", () => {
    expect(rules(PAP.replace("id 10\n         port 2", "id 10\n         port 5"))).toEqual([
      "warning:link-port-not-exported",
    ]);
    expect(rules(PAP.replace("inputvalues {\n    0.5", "inputvalues {\n    0.5 0.7"))).toEqual([
      "warning:signal-value-count",
    ]);
  });

  it("warns about stale compiled blocks in both formats", () => {
    expect(
      rules(
        PAP.replace(
          "  ops {\n   ProcAnimCompiledOp {\n    data {\n     1 0 0\n    }\n   }\n",
          "  ops {\n",
        ),
      ),
    ).toEqual(["warning:compiled-stale"]);
    const noBlock = PAP.slice(0, PAP.indexOf(" compiled")) + "}";
    expect(rules(noBlock)).toEqual(["warning:compiled-missing"]);
    expect(
      rules(SIGA.replace("   IOPCompiledOut {\n    data {\n     0\n    }\n   }\n", "")),
    ).toEqual(["warning:compiled-stale"]);
  });

  it("flags siga references to nodes the file lacks and an unwired output", () => {
    expect(rules(SIGA.replace("    2\n   }\n   inputs", "    9\n   }\n   inputs"))).toContain(
      "error:dangling-child",
    );
    expect(rules(SIGA.replace("id 1\n     port 0", "id 8\n     port 0"))).toContain(
      "error:dangling-input",
    );
    expect(rules(SIGA.replace("   input 3\n", ""))).toEqual(["warning:output-unwired"]);
    expect(rules(SIGA.replace("input 3", "input 9"))).toContain("error:dangling-input");
  });
});

describe("edit ops, in memory", () => {
  it("set_property keeps the quoting, adds a missing key in the vanilla style, and refuses structure", () => {
    expect(apply(PAP, { op: "set_property", node: 20, key: "bone", value: "Needle" })).toContain(
      '   bone "Needle"',
    );
    expect(apply(PAP, { op: "set_property", node: 20, key: "version", value: 3 })).toContain(
      "   version 3\n",
    );
    expect(apply(PAP, { op: "set_property", node: 20, key: "comment", value: "hi" })).toContain(
      '   comment "hi"',
    );
    expect(apply(SIGA, { op: "set_property", node: 1, key: "valueMin", value: -90 })).toContain(
      "   valueMin -90\n",
    );
    for (const key of ["id", "children", "outs", "input", "compiled"]) {
      expect(() => apply(PAP, { op: "set_property", node: 20, key, value: 1 })).toThrow(/own ops/);
    }
    expect(() => apply(PAP, { op: "set_property", node: 20, key: "not a key", value: 1 })).toThrow(
      /not a key/,
    );
  });

  it("addresses a node by id, by numeric text, and by a unique name", () => {
    const want = apply(PAP, { op: "set_property", node: 20, key: "version", value: 4 });
    expect(apply(PAP, { op: "set_property", node: "20", key: "version", value: 4 })).toBe(want);
    expect(apply(PAP, { op: "set_property", node: "Bone 20", key: "version", value: 4 })).toBe(
      want,
    );
    expect(() => apply(PAP, { op: "set_property", node: 77, key: "version", value: 4 })).toThrow(
      /no node with id 77/,
    );
    expect(() =>
      apply(PAP, { op: "set_property", node: "Nobody", key: "version", value: 4 }),
    ).toThrow(/named "Nobody"/);
    const twin = SIGA.replace('name "Out"', 'name "Needle"');
    expect(() =>
      apply(twin, { op: "set_property", node: "Needle", key: "tl", value: "1" }),
    ).toThrow(/2 nodes match/);
  });

  it("remove_property removes a key and refuses a missing one", () => {
    const text = apply(PAP, { op: "set_property", node: 20, key: "comment", value: "x" });
    expect(apply(text, { op: "remove_property", node: 20, key: "comment" })).toBe(PAP);
    expect(() => apply(PAP, { op: "remove_property", node: 20, key: "comment" })).toThrow(
      /no "comment"/,
    );
    expect(() => apply(PAP, { op: "remove_property", node: 20, key: "name" })).toThrow(
      /rename_node/,
    );
  });

  it("rename_node and move_node edit only their line", () => {
    const renamed = apply(PAP, { op: "rename_node", node: 30, name: "Hinge" });
    expect(renamed.replace('name "Hinge"', 'name "RotationSet 30"')).toBe(PAP);
    const moved = apply(PAP, { op: "move_node", node: 20, x: 5.5, y: "-3" });
    expect(moved.replace("tl 5.5 -3", "tl 100 0")).toBe(PAP);
    expect(() => apply(PAP, { op: "rename_node", node: 30, name: 'a"b' })).toThrow(/quote/);
  });

  it("set_model replaces or adds the model and refuses a .siga", () => {
    expect(apply(PAP, { op: "set_model", model: "{AAAAAAAAAAAAAAAA}x.xob" })).toContain(
      ' model "{AAAAAAAAAAAAAAAA}x.xob"',
    );
    const none = PAP.replace(' model "{C36C88941BB7949F}Assets/test.xob"\n', "");
    expect(apply(none, { op: "set_model", model: "y.xob" })).toContain(' model "y.xob"');
    expect(() => apply(SIGA, { op: "set_model", model: "y.xob" })).toThrow(/applies to a \.pap/);
  });

  it("add_node picks the next id, the section and the vanilla style, and remove_node undoes it", () => {
    const added = apply(PAP, {
      op: "add_node",
      class: "BoneClass",
      name: "Hand",
      props: { bone: "Hand" },
      x: 7,
      y: 8,
    });
    expect(added).toContain(
      '  BoneClass {\n   id 31\n   name "Hand"\n   tl 7 8\n   bone "Hand"\n  }\n }\n model',
    );
    expect(apply(added, { op: "remove_node", node: 31 })).toBe(PAP);
    expect(apply(SIGA, { op: "add_node", class: "IOPItemOpMulClass" })).toContain(
      '   name "Mul 4"',
    );
    expect(() => apply(PAP, { op: "add_node", class: "NoSuchClass" })).toThrow(
      /not a ProcAnim node class/,
    );
    expect(() => apply(PAP, { op: "add_node", class: "IOPItemOpMulClass" })).toThrow(
      /a \.siga node/,
    );
    expect(() => apply(PAP, { op: "add_node", class: "BoneClass", props: { outs: 1 } })).toThrow(
      /own ops/,
    );
  });

  it("add_node creates a missing section", () => {
    const bare = "ProcAnimSignalResClass {\n}";
    const out = apply(bare, { op: "add_node", class: "IOPItemInputClass", name: "A" });
    expect(out).toBe(
      'ProcAnimSignalResClass {\n Inputs {\n  IOPItemInputClass {\n   id 1\n   name "A"\n   tl 0 0\n  }\n }\n}',
    );
  });

  it("remove_node refuses a node that is still referenced and says by whom", () => {
    expect(() => apply(PAP, { op: "remove_node", node: 20 })).toThrow(
      /still referenced by .*RotationSetClass/,
    );
    expect(() => apply(SIGA, { op: "remove_node", node: 3 })).toThrow(/still referenced/);
  });

  it("connect and disconnect wire a .siga and put it back byte for byte", () => {
    const withOp = apply(SIGA, { op: "add_node", class: "IOPItemOpSinClass", name: "S" });
    const wired = apply(withOp, { op: "connect", from: 1, to: 4, port: 1 });
    expect(wired).toContain("   children {\n    3 4\n   }");
    expect(wired).toContain(
      "   inputs {\n    ConnectionClass connection {\n     id 1\n     port 1\n    }\n   }",
    );
    const v = viewProcAnim(parseProcAnim(wired));
    expect(v.nodes[0].children).toEqual([3, 4]);
    expect(v.nodes.find((n) => n.id === 4)!.links).toEqual([{ from: 1, fromPort: 1 }]);
    expect(validateProcAnim(parseProcAnim(wired)).filter((f) => f.level === "error")).toEqual([]);
    expect(apply(wired, { op: "disconnect", from: 1, to: 4 })).toBe(withOp);
    // An output takes its feed in `input`.
    const out2 = apply(withOp, { op: "add_node", class: "IOPItemOutputClass", name: "O2" });
    const fed = apply(out2, { op: "connect", from: 4, to: 5 });
    expect(fed).toContain("   input 4");
    expect(apply(fed, { op: "disconnect", from: 4, to: 5 })).toBe(out2);
  });

  it("connect and disconnect refuse what is not wired as asked", () => {
    expect(() => apply(SIGA, { op: "connect", from: 1, to: 3 })).toThrow(/already feeds/);
    expect(() => apply(SIGA, { op: "connect", from: 2, to: 3 })).toThrow(/an output feeds nothing/);
    expect(() => apply(SIGA, { op: "connect", from: 3, to: 1 })).toThrow(/takes no feed/);
    expect(() => apply(SIGA, { op: "disconnect", from: 1, to: 2 })).toThrow(/does not feed/);
    expect(() => apply(PAP, { op: "connect", from: 20, to: 30 })).toThrow(/wires a \.siga/);
    const out2 = apply(SIGA, { op: "add_node", class: "IOPItemOpSinClass" });
    expect(() => apply(out2, { op: "connect", from: 4, to: 2 })).toThrow(/already fed by node 3/);
  });

  it("every op is read from a record, and a bad record names the op", () => {
    expect(opOf({ op: "move_node", node: 1, x: 1, y: 2 }, 0)).toMatchObject({ op: "move_node" });
    expect(() => opOf({ op: "teleport" }, 2)).toThrow(/op 3: unknown op "teleport"/);
    expect(() => opOf({ op: "set_property", node: 1, key: "a" }, 0)).toThrow(/value must be/);
    expect(() => opOf({ op: "set_property", node: 1.5, key: "a", value: 1 }, 0)).toThrow(
      /node id or name/,
    );
    expect(() => opOf({ op: "move_node", node: 1, x: "a", y: 2 }, 0)).toThrow(
      /"x" must be a number/,
    );
    expect(() => opOf({ op: "connect", from: 1, to: 2, port: -1 }, 0)).toThrow(/port/);
    expect(() => opOf({ op: "add_node", class: "BoneClass", props: [] }, 0)).toThrow(
      /props must be an object/,
    );
  });

  it("skeleton gives files the parser reads", () => {
    expect(parseProcAnim(skeleton("pap", "{AAAAAAAAAAAAAAAA}m.xob")).kind).toBe("pap");
    expect(parseProcAnim(skeleton("siga")).kind).toBe("siga");
    expect(skeleton("pap")).not.toContain("model");
    expect(() => skeleton("pap", 'a"b')).toThrow(/quote/);
  });
});

describe("the tool: inspect, validate and nodes", () => {
  put("anims/proc/test.pap", PAP);
  put("anims/proc/test.siga", SIGA);

  it("inspects a .pap with a section summary, the compiled block and the nodes", () => {
    const r = run({ action: "inspect", path: "anims/proc/test.pap" });
    expect(r.ok).toBe(true);
    expect(rb(r)).toMatchObject({
      kind: "pap",
      model: "{C36C88941BB7949F}Assets/test.xob",
      sections: { signals: 1, funcs: 2 },
      compiled: { ops: 2 },
      matched: 3,
    });
    const nodes = rb(r).nodes as Bag[];
    expect(nodes[2]).toMatchObject({ at: "funcs[1]", class: "RotationSetClass", id: 30 });
    expect((nodes[2].links as unknown[]).length).toBe(2);
    expect(nodes[1].props).toEqual({ version: "0", tl: "100 0", bone: "Pendulum" });
  });

  it("inspects a .siga, filters by query and pages with a cursor", () => {
    const all = rb(run({ action: "inspect", path: "anims/proc/test.siga" }));
    expect(all.sections).toEqual({ Inputs: 1, Ops: 1, Outputs: 1 });
    const one = run({ action: "inspect", path: "anims/proc/test.siga", limit: 1 });
    expect(rb(one).nextCursor).toBe("1:3");
    const two = run({ action: "inspect", path: "anims/proc/test.siga", limit: 1, cursor: "1:3" });
    expect((rb(two).nodes as Bag[])[0]).toMatchObject({ class: "IOPItemOpMulClass" });
    const q = run({ action: "inspect", path: "anims/proc/test.siga", query: "output" });
    expect((rb(q).nodes as Bag[]).map((n) => n.id)).toEqual([2]);
  });

  it("refuses a stale or malformed cursor, and a path that is not a ProcAnim file", () => {
    expect(err(run({ action: "inspect", path: "anims/proc/test.siga", cursor: "1:9" })).code).toBe(
      "STALE_CURSOR",
    );
    expect(err(run({ action: "inspect", path: "anims/proc/test.siga", cursor: "x" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(err(run({ action: "inspect", path: "anims/proc/test.txt" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(err(run({ action: "inspect" })).message).toMatch(/needs path/);
    expect(err(run({ action: "inspect", path: "anims/proc/nope.pap" })).code).toBe(
      "PATH_NOT_FOUND",
    );
    expect(err(run({ action: "inspect", path: "../x.pap" })).ok).toBe(false);
    expect(err(run({ action: "inspect", path: "/etc/x.pap" })).code).toBe("NOT_IN_PROJECT");
  });

  it("refuses a file that is not what its extension says", () => {
    put("anims/proc/odd.pap", SIGA);
    put("anims/proc/broken.siga", "ProcAnimSignalResClass {\n Inputs {");
    expect(err(run({ action: "inspect", path: "anims/proc/odd.pap" })).message).toMatch(
      /not a \.pap/,
    );
    expect(err(run({ action: "validate", path: "anims/proc/broken.siga" })).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("validates a .pap against the .siga in the project and pages the findings", () => {
    const ok = run({ action: "validate", path: "anims/proc/test.pap" });
    expect(rb(ok)).toMatchObject({ errors: 0, warnings: 0, findings: [] });
    put("anims/proc/dangling.pap", PAP.replace("id 20\n         port 0", "id 99\n         port 0"));
    const r = run({ action: "validate", path: "anims/proc/dangling.pap" });
    expect(r.ok).toBe(true);
    expect(rb(r)).toMatchObject({ errors: 1 });
    expect((rb(r).findings as Bag[])[0]).toMatchObject({ code: "dangling-link" });
    put("anims/proc/missing-siga.pap", PAP.replace("test.siga", "gone.siga"));
    expect(
      (rb(run({ action: "validate", path: "anims/proc/missing-siga.pap" })).findings as Bag[])[0],
    ).toMatchObject({
      code: "siga-not-found",
    });
  });

  it("validate on a stale file says how to recompile", () => {
    put(
      "anims/proc/stale.siga",
      SIGA.replace("   IOPCompiledOut {\n    data {\n     0\n    }\n   }\n", ""),
    );
    const r = run({ action: "validate", path: "anims/proc/stale.siga" }) as unknown as {
      next: string;
    };
    expect(r.next).toMatch(/open and save in the ProcAnim Editor to recompile/);
    expect(
      (run({ action: "validate", path: "anims/proc/test.siga" }) as unknown as { next?: string })
        .next,
    ).toBeUndefined();
  });

  it("nodes lists the classes, filters, pages and reads the API index for ProcAnim classes", () => {
    const all = run({ action: "nodes", limit: 5 });
    expect(rb(all).total).toBe(PROCANIM_CLASSES.length);
    expect((rb(all).classes as Bag[]).length).toBe(5);
    expect(rb(all).nextCursor).toBe(`5:${PROCANIM_CLASSES.length}`);
    const bone = rb(run({ action: "nodes", query: "bone" }));
    expect((bone.classes as Bag[]).map((c) => c.class)).toEqual(["BoneClass"]);
    expect((bone.classes as Bag[])[0]).toMatchObject({
      file: "pap",
      section: "funcs",
      role: "func",
    });
    const siga = rb(run({ action: "nodes", query: "siga" }));
    expect(siga.total).toBeGreaterThan(15);
    const withApi = mkdtempSync(join(tmpdir(), "procanim-api-"));
    try {
      mkdirSync(join(withApi, "api"));
      writeFileSync(
        join(withApi, "api", "enfusion-classes.json"),
        JSON.stringify([
          { name: "ProcAnimEditor", source: "enfusion", group: "Workbench" },
          { name: "Other" },
        ]),
      );
      const r = run({ action: "nodes", query: "bone" }, { ...config, dataDir: withApi });
      expect(rb(r).apiClasses).toEqual([]);
      const r2 = run({ action: "nodes", query: "procanim" }, { ...config, dataDir: withApi });
      expect(rb(r2).apiClasses).toEqual([
        { name: "ProcAnimEditor", source: "enfusion", group: "Workbench" },
      ]);
    } finally {
      rmSync(withApi, { recursive: true, force: true });
    }
  });
});

describe("the tool: edit", () => {
  it("is a dry run by default: it returns the diff and writes nothing", () => {
    const file = put("edit/dry.pap", PAP);
    const r = run({
      action: "edit",
      path: "edit/dry.pap",
      ops: [{ op: "set_property", node: 20, key: "bone", value: "Needle" }],
    }) as unknown as { dryRun: boolean; next: string; readback: Bag; changed: unknown[] };
    expect(r.dryRun).toBe(true);
    expect(r.readback.diff).toContain('-   bone "Pendulum"');
    expect(r.readback.diff).toContain('+   bone "Needle"');
    expect(r.changed).toHaveLength(1);
    expect(r.next).toMatch(/confirm: true/);
    expect(r.next).toMatch(/open and save in the ProcAnim Editor to recompile/);
    expect(readFileSync(file, "utf8")).toBe(PAP);
  });

  it("writes with confirm, keeps a backup, names the stale compiled blocks, and numbers further backups", () => {
    const file = put("edit/live.pap", PAP);
    const req: ProcAnimRequest = {
      action: "edit",
      path: "edit/live.pap",
      confirm: true,
      ops: [{ op: "set_property", node: 20, key: "bone", value: "Needle" }],
    };
    const r = run(req) as unknown as {
      dryRun: boolean;
      next: string;
      warnings: string[];
      readback: Bag;
    };
    expect(r.dryRun).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(PAP.replace('bone "Pendulum"', 'bone "Needle"'));
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(PAP);
    expect(r.readback.backup).toBe("edit/live.pap.bak");
    expect(r.warnings).toContain("the compiled blocks no longer match the nodes");
    expect(r.next).toMatch(/open and save in the ProcAnim Editor to recompile/);
    expect(PROCANIM_RECOMPILE_SCRIPTED).toBe(false);
    run({ ...req, ops: [{ op: "set_property", node: 20, key: "bone", value: "Hand" }] });
    expect(readFileSync(`${file}.bak2`, "utf8")).toContain('bone "Needle"');
  });

  it("a move or a rename does not claim stale compiled blocks", () => {
    put("edit/cosmetic.pap", PAP);
    const r = run({
      action: "edit",
      path: "edit/cosmetic.pap",
      confirm: true,
      ops: [
        { op: "move_node", node: 20, x: 1, y: 2 },
        { op: "rename_node", node: 20, name: "Renamed" },
      ],
    }) as unknown as { next: string; warnings: string[] };
    expect(r.warnings).toEqual([]);
    expect(r.next).not.toMatch(/recompile/);
  });

  it("is all or nothing: a failing op names itself and nothing is written", () => {
    const file = put("edit/atomic.pap", PAP);
    const r = err(
      run({
        action: "edit",
        path: "edit/atomic.pap",
        confirm: true,
        ops: [
          { op: "set_property", node: 20, key: "bone", value: "Needle" },
          { op: "set_property", node: 77, key: "bone", value: "X" },
        ],
      }),
    );
    expect(r.code).toBe("PATH_NOT_FOUND");
    expect(r.message).toMatch(/op 2 of 2 failed, nothing written/);
    expect(readFileSync(file, "utf8")).toBe(PAP);
    expect(existsSync(`${file}.bak`)).toBe(false);
    const bad = err(run({ action: "edit", path: "edit/atomic.pap", ops: [{ op: "x" }] }));
    expect(bad.code).toBe("INVALID_ARGUMENT");
    expect(bad.message).toMatch(/op 1 of 1 failed/);
  });

  it("reports validation errors an edit leaves in the file and still writes it", () => {
    put("edit/err.siga", SIGA);
    const r = run({
      action: "edit",
      path: "edit/err.siga",
      confirm: true,
      ops: [{ op: "add_node", class: "IOPItemOpSinClass" }],
    }) as unknown as { warnings: string[]; readback: Bag };
    expect(r.readback.errors).toBe(0);
    expect(r.warnings).toContain("the compiled blocks no longer match the nodes");
  });

  it("refuses without ops, without a project, on a missing file and on a game file", () => {
    expect(err(run({ action: "edit", path: "edit/dry.pap", ops: [] })).message).toMatch(
      /needs ops/,
    );
    const noProject = { ...config, projectPath: "" } as Config;
    expect(
      err(
        run(
          { action: "edit", path: "edit/dry.pap", ops: [{ op: "set_model", model: "x" }] },
          noProject,
        ),
      ).code,
    ).toBe("NOT_IN_PROJECT");
    expect(
      err(run({ action: "edit", path: "edit/none.pap", ops: [{ op: "set_model", model: "x" }] }))
        .code,
    ).toBe("PATH_NOT_FOUND");
    expect(
      err(run({ action: "edit", path: "/elsewhere/a.pap", ops: [{ op: "set_model", model: "x" }] }))
        .code,
    ).toBe("NOT_IN_PROJECT");
    expect(
      err(run({ action: "edit", path: "edit/dry.txt", ops: [{ op: "set_model", model: "x" }] }))
        .code,
    ).toBe("INVALID_ARGUMENT");
  });

  it("an edit that changes nothing writes nothing and makes no backup", () => {
    const file = put("edit/noop.pap", PAP);
    const r = run({
      action: "edit",
      path: "edit/noop.pap",
      confirm: true,
      ops: [{ op: "set_property", node: 20, key: "bone", value: "Pendulum" }],
    }) as unknown as { next: string };
    expect(r.next).toBe("Nothing changed.");
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it("edits a file from an absolute path inside the project", () => {
    const file = put("edit/abs.siga", SIGA);
    const r = run({
      action: "edit",
      path: file,
      confirm: true,
      ops: [{ op: "move_node", node: 1, x: 9, y: 9 }],
    });
    expect(r.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("tl 9 9");
  });
});

describe("the tool: create", () => {
  it("is a dry run by default and shows the empty file", () => {
    const r = run({ action: "create", path: "new/a.siga" }) as unknown as {
      dryRun: boolean;
      readback: Bag;
    };
    expect(r.dryRun).toBe(true);
    expect(r.readback.text).toBe(skeleton("siga"));
    expect(existsSync(join(dir, "new/a.siga"))).toBe(false);
  });

  it("writes an empty .pap with a model, says to register it and to recompile", () => {
    const r = run({
      action: "create",
      path: "new/b.pap",
      model: "{C36C88941BB7949F}Assets/test.xob",
      confirm: true,
    }) as unknown as {
      next: string;
    };
    expect(readFileSync(join(dir, "new/b.pap"), "utf8")).toBe(
      skeleton("pap", "{C36C88941BB7949F}Assets/test.xob"),
    );
    expect(r.next).toMatch(/wb_resources register/);
    expect(r.next).toMatch(/open and save in the ProcAnim Editor to recompile/);
    expect(run({ action: "inspect", path: "new/b.pap" }).ok).toBe(true);
  });

  it("copies a project file byte for byte, with no stale claim", () => {
    put("anims/proc/test.pap", PAP);
    const r = run({
      action: "create",
      path: "new/copy.pap",
      source: "anims/proc/test.pap",
      confirm: true,
    }) as unknown as { next: string; readback: Bag };
    expect(readFileSync(join(dir, "new/copy.pap"), "utf8")).toBe(PAP);
    expect(r.readback.from).toBe("copy of anims/proc/test.pap");
    expect(r.next).toMatch(/wb_resources register/);
    expect(r.next).not.toMatch(/recompile/);
  });

  it("refuses an existing target unless overwrite, then keeps a backup", () => {
    put("new/exists.siga", SIGA);
    expect(err(run({ action: "create", path: "new/exists.siga", confirm: true })).message).toMatch(
      /already exists/,
    );
    expect(
      run({ action: "create", path: "new/exists.siga", overwrite: true, confirm: true }).ok,
    ).toBe(true);
    expect(readFileSync(join(dir, "new/exists.siga.bak"), "utf8")).toBe(SIGA);
    expect(readFileSync(join(dir, "new/exists.siga"), "utf8")).toBe(skeleton("siga"));
  });

  it("refuses a source of the other kind, itself, a non-ProcAnim source, a missing source and no project", () => {
    expect(
      err(run({ action: "create", path: "new/x.pap", source: "anims/proc/test.siga" })).message,
    ).toMatch(/source is a \.siga/);
    expect(err(run({ action: "create", path: "new/x.pap", source: "new/x.pap" })).message).toMatch(
      /same file/,
    );
    put("new/odd.pap", SIGA);
    expect(
      err(run({ action: "create", path: "new/y.pap", source: "new/odd.pap" })).message,
    ).toMatch(/not a \.pap/);
    expect(err(run({ action: "create", path: "new/z.pap", source: "nope/none.pap" })).code).toBe(
      "PATH_NOT_FOUND",
    );
    expect(
      err(run({ action: "create", path: "new/q.pap" }, { ...config, projectPath: "" } as Config))
        .code,
    ).toBe("NOT_IN_PROJECT");
    expect(err(run({ action: "create", path: "../escape.pap", confirm: true })).ok).toBe(false);
    expect(existsSync(join(dir, "..", "escape.pap"))).toBe(false);
  });
});

describe("registration", () => {
  it("keeps the description within 400 characters and answers JSON", async () => {
    expect(PROCANIM_DESCRIPTION.length).toBeLessThanOrEqual(400);
    let def: { description: string } | undefined;
    const fake = {
      registerTool: (name: string, d: { description: string }) => {
        expect(name).toBe("procanim");
        def = d;
      },
    } as unknown as McpServer;
    registerProcAnim(fake, config);
    expect(def?.description).toBe(PROCANIM_DESCRIPTION);
    const handler = captureTool((s) => registerProcAnim(s, config));
    const res = await handler({ action: "validate", path: "anims/proc/test.siga" });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0].text).action).toBe("validate");
    const bad = await handler({ action: "inspect" });
    expect(bad.isError).toBe(true);
  });

  it("diffs a one-line change", () => {
    expect(unifiedDiff("a\nb\nc", "a\nB\nc", "f")).toBe(
      "--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c",
    );
  });
});

// Census rows this file tests (W4 close-out, EV-W4-053).
// census:mcp:action/procanim.create
// census:mcp:action/procanim.inspect
// census:mcp:action/procanim.nodes
// census:mcp:action/procanim.validate
