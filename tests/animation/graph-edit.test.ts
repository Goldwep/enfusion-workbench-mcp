import { describe, expect, it } from "vitest";
import {
  AGF_OPS,
  AGR_OPS,
  GRAPH_OPS,
  applyGraphEdit,
  opExtension,
} from "../../src/animation/graph-edit.js";
import {
  catalog,
  catalogClass,
  catalogEnums,
  isNodeClass,
  kindOf,
} from "../../src/animation/node-catalog.js";
import { CstDocument, parseCst } from "../../src/formats/enfusion-cst.js";
import { VocabularyError } from "../../src/manifest/vocabulary.js";

const AGF_CRLF = [
  "AnimSrcGraphFile {",
  " Sheets {",
  "  AnimSrcGraphSheet Main {",
  "   Nodes {",
  "    AnimSrcNodeQueue Q {",
  '     Child "S"',
  "     QueueItems {",
  '      AnimSrcNodeQueueItem "{6106BE788947B4F0}" {',
  '       Child "S"',
  "      }",
  "     }",
  "    }",
  "    AnimSrcNodeSource S {",
  '     Source "A.B.C"',
  "    }",
  "   }",
  "  }",
  " }",
  "}",
  "",
].join("\r\n");

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof VocabularyError) return e.code;
    throw e;
  }
  return "none";
}

describe("op table", () => {
  it("splits the ops between .agf and .agr", () => {
    expect(GRAPH_OPS.length).toBe(AGF_OPS.length + AGR_OPS.length);
    for (const op of AGF_OPS) expect(opExtension(op)).toBe(".agf");
    for (const op of AGR_OPS) expect(opExtension(op)).toBe(".agr");
  });
});

describe("applyGraphEdit", () => {
  it("writes a fresh node with the file's own CRLF line endings, at an index", () => {
    const doc = parseCst(AGF_CRLF);
    const r = applyGraphEdit(doc, {
      op: "addNode",
      sheet: "Main",
      nodeClass: "AnimSrcNodeBindPose",
      name: "Bind Me",
      index: 0,
    });
    expect(r.doc.text).toContain(
      '   Nodes {\r\n    AnimSrcNodeBindPose "Bind Me" {\r\n    }\r\n    AnimSrcNodeQueue Q {',
    );
    expect(r.doc.text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(applyGraphEdit(r.doc, r.inverse).doc.text).toBe(AGF_CRLF);
  });

  it("edits a nested slot by path and restores it", () => {
    const doc = parseCst(AGF_CRLF);
    const r = applyGraphEdit(doc, {
      op: "connect",
      node: "Q",
      slot: "QueueItems[0].Child",
      to: "S",
    });
    expect(r.doc.text).toBe(AGF_CRLF); // already S: the plan changes nothing
    const d = applyGraphEdit(doc, { op: "disconnect", node: "Q", slot: "QueueItems[0].Child" });
    expect(d.doc.text).not.toContain('       Child "S"');
    expect(applyGraphEdit(d.doc, d.inverse).doc.text).toBe(AGF_CRLF);
  });

  it("keeps the quoting of a slot in the inverse", () => {
    const doc = parseCst(AGF_CRLF);
    const r = applyGraphEdit(doc, {
      op: "setProp",
      node: "S",
      prop: "Source",
      value: "X.Y.Z",
      quoted: false,
    });
    expect(r.doc.text).toContain("Source X.Y.Z");
    expect(r.inverse).toMatchObject({ value: "A.B.C", quoted: true });
    expect(applyGraphEdit(r.doc, r.inverse).doc.text).toBe(AGF_CRLF);
  });

  it("refuses raw that is not one node block, and an index out of range", () => {
    const doc = parseCst(AGF_CRLF);
    expect(
      codeOf(() => applyGraphEdit(doc, { op: "addNode", sheet: "Main", raw: "Foo {\n}\n" })),
    ).toBe("INVALID_ARGUMENT");
    expect(
      codeOf(() =>
        applyGraphEdit(doc, { op: "addNode", sheet: "Main", raw: "AnimSrcNodeX A {\n" }),
      ),
    ).toBe("INVALID_ARGUMENT");
    expect(
      codeOf(() =>
        applyGraphEdit(doc, {
          op: "addNode",
          sheet: "Main",
          nodeClass: "AnimSrcNodeBindPose",
          name: "N",
          index: 9,
        }),
      ),
    ).toBe("PATH_NOT_FOUND");
    expect(
      codeOf(() =>
        applyGraphEdit(doc, {
          op: "addNode",
          sheet: "Main",
          nodeClass: "AnimSrcNodeBindPose",
          name: 'a"b',
        }),
      ),
    ).toBe("INVALID_ARGUMENT");
  });

  it("refuses an .agr op on a file that is not an AnimSrcGraph, and a legacy root", () => {
    const doc = parseCst(AGF_CRLF);
    expect(codeOf(() => applyGraphEdit(doc, { op: "setDefaultRunNode", name: "Q" }))).toBe(
      "INVALID_ARGUMENT",
    );
    const legacy = parseCst("$AnimGraph {\n}\n");
    expect(codeOf(() => applyGraphEdit(legacy, { op: "addVariable", name: "V" }))).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("refuses an op that would leave a parse diagnostic", () => {
    const doc = new CstDocument(AGF_CRLF);
    expect(
      codeOf(() => applyGraphEdit(doc, { op: "setProp", node: "S", prop: "Source", value: "a\\" })),
    ).toBe("INVALID_ARGUMENT");
  });

  it("creates GraphFilesResourceNames when an .agr lacks it, with a warning", () => {
    const doc = parseCst('AnimSrcGraph {\n DefaultRunNode "Q"\n}\n');
    const r = applyGraphEdit(doc, { op: "addFile", file: "{0123456789ABCDEF}A/b.agf" });
    expect(r.doc.text).toContain(' GraphFilesResourceNames {\n  "{0123456789ABCDEF}A/b.agf"\n }');
    expect(r.warnings.join(" ")).toContain("created");
  });
});

describe("node catalog", () => {
  it("holds the 106 AnimEditor classes of the 1.9.0.37 index with their keys", () => {
    expect(catalog().size).toBe(106);
    let keys = 0;
    for (const c of catalog().values()) keys += c.keys.length;
    expect(keys).toBe(421);
    expect(isNodeClass("AnimSrcNodeStateMachine")).toBe(true);
    expect(isNodeClass("AnimSrcNodeState")).toBe(false);
    expect(kindOf("AnimSrcNodeQueueItem")).toBe("item");
    expect(kindOf("AnimSrcEventGeneric")).toBe("event");
    expect(kindOf("AnimSrcGCTVarFloat")).toBe("graph");
    expect(kindOf("$Node")).toBe("legacy");
    expect(
      catalogClass("AnimSrcNodeQueueItem")!.keys.find((k) => k.name === "EnqueueMethod")!.values!
        .length,
    ).toBeGreaterThan(1);
    expect(catalogEnums().length).toBeGreaterThan(5);
  });
});
