/**
 * The ProcAnim model on every vanilla `.pap` and `.siga` of the installed game (W4 spec
 * section 4, gates 1 to 4): the parser gives each file back byte for byte, the views and the
 * checks finish on all of them, `validate` finds no error in any, and an edit followed by its
 * inverse puts a seeded sample back byte for byte. Skipped, like the other corpus tests, when
 * the game paks are not installed.
 */
import { describe, expect, it } from "vitest";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import {
  applyOp,
  parseProcAnim,
  validateProcAnim,
  viewProcAnim,
  type Parsed,
  type ProcAnimKind,
  type ProcAnimOp,
} from "../../src/procanim/model.js";
import { loadBaseline, openVanillaCorpus, seededSample } from "./_corpus.js";

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });

describe.skipIf(open.skip !== undefined)("vanilla .pap and .siga files", () => {
  const corpus = open.corpus!;
  const files: Record<ProcAnimKind, string[]> = open.corpus
    ? { pap: corpus.list("pap"), siga: corpus.list("siga") }
    : { pap: [], siga: [] };
  const all = [...files.pap, ...files.siga];

  const resolveSiga = (res: string): Buffer | undefined => {
    try {
      return corpus.read(res.replace(/^\{[0-9A-Fa-f]{16}\}/, ""));
    } catch {
      return undefined;
    }
  };

  // Gate 1.
  it("has the files of the 1.9.0.37 corpus", () => {
    if (corpus.build === "1.9.0.37") {
      expect(files.pap.length).toBe(47);
      expect(files.siga.length).toBe(46);
    } else {
      expect(files.pap.length).toBeGreaterThan(20);
      expect(files.siga.length).toBeGreaterThan(20);
    }
  });

  it("reads every file and writes it back byte for byte", () => {
    const off: string[] = [];
    for (const f of all) {
      const buf = corpus.read(f);
      if (Buffer.compare(parseCstBytes(buf).toBytes(), buf) !== 0) off.push(`${f}: cst`);
      const kind = f.endsWith(".pap") ? "pap" : "siga";
      const p = parseProcAnim(buf, kind);
      if (Buffer.compare(p.doc.toBytes(), buf) !== 0) off.push(`${f}: model`);
    }
    expect(off).toEqual([]);
  });

  // Gate 2.
  it("finishes the view and the checks on every file, and every node has an id", () => {
    let nodes = 0;
    for (const f of all) {
      const p = parseProcAnim(corpus.read(f), f.endsWith(".pap") ? "pap" : "siga");
      const v = viewProcAnim(p);
      nodes += v.nodes.length;
      expect(
        v.nodes.every((n) => n.id !== undefined),
        f,
      ).toBe(true);
      validateProcAnim(p, { resolveSiga });
    }
    expect(nodes).toBeGreaterThan(1000);
  });

  // Gate 3.
  it("finds no error in any vanilla file", () => {
    const errors: string[] = [];
    for (const f of all) {
      const p = parseProcAnim(corpus.read(f), f.endsWith(".pap") ? "pap" : "siga");
      for (const x of validateProcAnim(p, { resolveSiga }))
        if (x.level === "error") errors.push(`${f} [${x.at ?? "file"}] ${x.code}: ${x.message}`);
    }
    expect(errors).toEqual([]);
  });

  it("resolves the .siga of every signal in the paks", () => {
    const gone: string[] = [];
    for (const f of files.pap) {
      const v = viewProcAnim(parseProcAnim(corpus.read(f), "pap"));
      for (const n of v.nodes.filter((x) => x.section === "signals"))
        if (!n.props.res || !resolveSiga(n.props.res))
          gone.push(`${f}: ${n.props.res ?? "no res"}`);
    }
    expect(gone).toEqual([]);
  });

  // Gate 4.
  for (const kind of ["pap", "siga"] as const) {
    it(`puts a seeded sample of 50 .${kind} files back byte for byte after each edit and its inverse`, () => {
      const sample = seededSample(files[kind], 50, `procanim-${kind}`);
      const off: string[] = [];
      let pairs = 0;
      for (const f of sample) {
        const buf = corpus.read(f);
        const orig = buf.toString("utf8");
        const p: Parsed = parseProcAnim(buf, kind);
        const back = (label: string) => {
          pairs++;
          if (p.doc.serialize() !== orig) off.push(`${f}: ${label}`);
        };
        const step = (...ops: ProcAnimOp[]) => {
          for (const op of ops) applyOp(p, op);
        };
        const view = viewProcAnim(p);
        const node = view.nodes.find((n) => n.id !== undefined && n.props.tl !== undefined);
        if (!node) {
          off.push(`${f}: no node with a position`);
          continue;
        }

        // set_property to its own value, then rename and rename back.
        step({ op: "set_property", node: node.id!, key: "tl", value: node.props.tl.split(" ") });
        back("set_property tl to itself");
        step({ op: "rename_node", node: node.id!, name: "emcp probe" });
        if (p.doc.serialize() === orig) off.push(`${f}: rename changed nothing`);
        step({ op: "rename_node", node: node.id!, name: node.name });
        back("rename_node");

        // move_node and back.
        const [x, y] = node.props.tl.split(" ");
        step({ op: "move_node", node: node.id!, x: 1, y: 2 });
        step({ op: "move_node", node: node.id!, x, y });
        back("move_node");

        // A property the node lacks, added then removed.
        const key = "emcp_probe";
        step({ op: "set_property", node: node.id!, key, value: "1" });
        if (p.doc.serialize() === orig) off.push(`${f}: set_property added nothing`);
        step({ op: "remove_property", node: node.id!, key });
        back("remove_property");

        // A new node, then gone.
        // The new node goes into a section the file already has: remove_node leaves an empty
        // section behind, and a file with no `Ops` block gets one.
        const hasOps = view.nodes.some((n) => n.section === "Ops");
        const cls =
          kind === "pap"
            ? "BoneClass"
            : hasOps
              ? "IOPItemOpMulClass"
              : view.nodes.some((n) => n.section === "Inputs")
                ? "IOPItemInputClass"
                : "IOPItemOutputClass";
        const added = applyOp(p, { op: "add_node", class: cls });
        if (p.doc.serialize() === orig) off.push(`${f}: add_node added nothing`);
        step({ op: "remove_node", node: added.id! });
        back("add_node and remove_node");

        // Wire a new op to the first input, unwire it, drop it (.siga only).
        if (kind === "siga") {
          const input = view.nodes.find((n) => n.section === "Inputs");
          if (input && hasOps) {
            const op = applyOp(p, { op: "add_node", class: "IOPItemOpMulClass" });
            step({ op: "connect", from: input.id!, to: op.id! });
            if (p.doc.serialize() === orig) off.push(`${f}: connect changed nothing`);
            expect(
              validateProcAnim(parseProcAnim(p.doc.toBytes(), "siga")).filter(
                (x) => x.level === "error",
              ),
              f,
            ).toEqual([]);
            step(
              { op: "disconnect", from: input.id!, to: op.id! },
              { op: "remove_node", node: op.id! },
            );
            back("connect and disconnect");
          }
        }
      }
      expect(off).toEqual([]);
      expect(pairs).toBeGreaterThan(sample.length * 4);
    });
  }
});
