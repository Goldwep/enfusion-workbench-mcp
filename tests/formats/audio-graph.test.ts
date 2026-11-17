/**
 * Graph authoring on .acp files (src/formats/audio-graph.ts, W5 spec 4.1/4.2,
 * DEC-068 OD-10): every op, refusal and inverse on synthetic files in both
 * header styles, then graph invariants and edit locality on a seeded sample
 * of the vanilla corpus (skipped when the game paks are absent).
 */
import { describe, expect, it } from "vitest";
import { CstDocument, parseCst, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { ACP_CLASS_CODES, loadAudioModel } from "../../src/formats/audio-model.js";
import {
  ACP_NODE_SECTIONS,
  AUDIO_GRAPH_PROVEN,
  applyGraphOp,
  graphProblems,
  nextNodeId,
  nodeText,
  readGraph,
  type AudioGraphModel,
  type GraphOpOk,
  type GraphOpResult,
} from "../../src/formats/audio-graph.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { loadBaseline, openVanillaCorpus, seededSample } from "../corpus/_corpus.js";

// ── Synthetic files (authored here, in the vanilla shapes; nothing copied from the game) ──

// Named style: ids in headers, `con:<port>` and `<id>:<port>` link headers. LF, no final EOL.
// Ids: sound 1033 (1<<10|9), bank 2052 (2<<10|4), mixer 3083 (3<<10|11), bank 4100, group 5123.
const NAMED = [
  "AudioClass {",
  " sounds {",
  '  SoundClass "1033" {',
  "   id 1033",
  '   name "SOUND_A"',
  "   version 5",
  "   tl 256 528",
  "   ins {",
  '    ConnectionsClass "con:64" {',
  "     id 64",
  "     links {",
  '      ConnectionClass "2052:65" {',
  "       id 2052",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "   outState 3083",
  "   outStatePort 22535",
  "  }",
  " }",
  " mixers {",
  '  MixerClass "3083" {',
  "   id 3083",
  '   name "OutputState"',
  "   version 4",
  "   tl 512 512",
  '   res "{0123456789ABCDEF}Sounds/Test.afm"',
  "   ins {",
  '    ConnectionsClass "con:22535" {',
  "     id 22535",
  "     links {",
  '      ConnectionClass "1033:65" {',
  "       id 1033",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "  }",
  " }",
  " banks_local {",
  '  BankLocalClass "2052" {',
  "   id 2052",
  '   name "All"',
  "   version 7",
  "   tl -256 528",
  "  }",
  '  BankLocalClass "4100" {',
  "   id 4100",
  '   name "Other"',
  "   version 7",
  "   tl -256 700",
  "  }",
  " }",
  " groups {",
  '  GroupClass "5123" {',
  "   id 5123",
  '   name "G"',
  "   children {",
  "    2052 4100",
  "   }",
  "   parent -1",
  "   Color 0.502 0 0.376 0.329",
  "  }",
  " }",
  " version 2",
  "}",
].join("\n");

// Bare style, CRLF, a signal with an input link under `conns`, a stub port with no links.
// Ids: shader 1042 (1<<10|18), sound 2057 (2<<10|9), signal 3085 (3<<10|13), bank 4100.
const BARE = [
  "AudioClass {",
  " signals {",
  "  SignalClass {",
  "   id 3085",
  '   name "Sig"',
  "   tl -256 256",
  "   conns {",
  "    IOPConnectionClass iopConnection {",
  "     port 3",
  "     conn {",
  "      ConnectionsClass connections {",
  "       id 8",
  "       links {",
  "        ConnectionClass connection {",
  "         id 2057",
  "         port 1",
  "        }",
  "       }",
  "      }",
  "     }",
  "    }",
  "   }",
  "  }",
  " }",
  " sounds {",
  "  SoundClass {",
  "   id 2057",
  "   version 5",
  "   tl 512 -256",
  "   ins {",
  "    ConnectionsClass connections {",
  "     id 0",
  "    }",
  "    ConnectionsClass connections {",
  "     id 64",
  "     links {",
  "      ConnectionClass connection {",
  "       id 1042",
  "       port 1",
  "      }",
  "      ConnectionClass connection {",
  "       id 4100",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "  }",
  " }",
  " shaders {",
  "  ShaderClass {",
  "   id 1042",
  '   name "Shader"',
  "   version 5",
  "   tl 0 0",
  "  }",
  " }",
  " banks_local {",
  "  BankLocalClass {",
  "   id 4100",
  '   name "Bank"',
  "   version 7",
  "   tl -256 0",
  "  }",
  " }",
  " version 2",
  "}",
  "",
].join("\r\n");

const m = (text: string): AudioGraphModel => ({ doc: parseCst(text) });

function ok(r: GraphOpResult): GraphOpOk {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function refused(r: GraphOpResult, code: string): string {
  expect(r.ok).toBe(false);
  if (r.ok) return "";
  expect(r.code).toBe(code);
  expect(r.next.length).toBeGreaterThan(0);
  return r.message;
}

/** Applies `op`, then its inverse, and expects the original text back. */
function roundTrip(text: string, op: string, args: Record<string, unknown>): GraphOpOk {
  const model = m(text);
  const r = ok(applyGraphOp(model, op, args));
  expect(model.doc.text).not.toBe(text);
  expect(graphProblems(model)).toEqual([]);
  expect(r.inverse).toBeDefined();
  ok(applyGraphOp(model, r.inverse!.op, r.inverse!.args));
  expect(model.doc.text).toBe(text);
  return r;
}

// ── Reading ──────────────────────────────────────────────────────────────────

describe("readGraph", () => {
  it("reads nodes, links (ins and signal conns), groups and the highest id", () => {
    const g = readGraph(m(NAMED));
    expect(g.nodes.map((n) => [n.id, n.cls, n.section, n.named])).toEqual([
      [1033, "SoundClass", "sounds", true],
      [3083, "MixerClass", "mixers", true],
      [2052, "BankLocalClass", "banks_local", true],
      [4100, "BankLocalClass", "banks_local", true],
      [5123, "GroupClass", "groups", true],
    ]);
    expect(g.nodes[0]).toMatchObject({ name: "SOUND_A", tl: [256, 528], path: "[0][0]" });
    expect(g.links.map((l) => [l.from, l.fromPort, l.to, l.toPort, l.via, l.named])).toEqual([
      [2052, 65, 1033, 64, "ins", true],
      [1033, 65, 3083, 22535, "ins", true],
    ]);
    expect(g.groups).toEqual([{ id: 5123, name: "G", members: [2052, 4100], path: "[3][0]" }]);
    expect(g.maxId).toBe(5123);
    const b = readGraph(parseCst(BARE));
    expect(b.links.map((l) => [l.from, l.to, l.toPort, l.via, l.named])).toEqual([
      [2057, 3085, 3, "conns", false],
      [1042, 2057, 64, "ins", false],
      [4100, 2057, 64, "ins", false],
    ]);
    expect(graphProblems(m(NAMED))).toEqual([]);
    expect(graphProblems(parseCst(BARE))).toEqual([]);
  });

  it("takes new ids above stale group members and link sources", () => {
    const stale = NAMED.replace("    2052 4100", "    2052 4100 40963");
    expect(readGraph(m(stale)).maxId).toBe(40963);
    expect(nextNodeId(40963, 9)).toBe(41 * 1024 + 9);
    expect(nextNodeId(5123, 9)).toBe(6153);
    expect(nextNodeId(0, 4)).toBe(1028);
  });

  it("reports broken invariants", () => {
    const bad = NAMED.replace('"2052:65" {\n       id 2052', '"9999:65" {\n       id 9999').replace(
      "   id 4100",
      "   id 4101",
    );
    const p = graphProblems(m(bad));
    expect(p).toContain("link into 1033:64 names 9999, which is not a node");
    expect(p).toContain("BankLocalClass 4101 has class code 5, not 4");
    // A node in two groups is a problem; a stale id (not a node) in two groups is not (vanilla has it).
    const twoGroups = NAMED.replace(
      " version 2\n}",
      ' groups2 {\n  GroupClass "6147" {\n   id 6147\n   children {\n    2052 0\n   }\n  }\n }\n version 2\n}',
    ).replace("    2052 4100", "    2052 4100 0");
    expect(graphProblems(m(twoGroups))).toEqual(["node 2052 is in groups 5123 and 6147"]);
  });

  it("keeps its class table in step with audio-model's class codes", () => {
    expect(Object.keys(ACP_NODE_SECTIONS).sort()).toEqual(Object.keys(ACP_CLASS_CODES).sort());
  });
});

// ── addNode ──────────────────────────────────────────────────────────────────

describe("addNode", () => {
  it("adds a named node with the next id, its class code and canvas position", () => {
    const model = m(NAMED);
    const r = ok(
      applyGraphOp(model, "addNode", { class: "SoundClass", name: "SOUND_B", x: 10, y: -20.5 }),
    );
    expect(r.readback).toMatchObject({
      id: 6153,
      section: "sounds",
      version: 5,
      style: "named",
      createdSection: false,
    });
    expect(r.dryRun).toBe(true);
    expect(r.changed).toEqual([
      {
        path: "node:6153",
        before: null,
        after: { class: "SoundClass", name: "SOUND_B", tl: [10, -20.5] },
      },
    ]);
    expect(nodeText(model, 6153)).toBe(
      [
        'SoundClass "6153" {',
        "   id 6153",
        '   name "SOUND_B"',
        "   version 5",
        "   tl 10 -20.5",
        "  }",
      ].join("\n"),
    );
    expect(model.doc.text).toContain('  }\n  SoundClass "6153" {\n');
    expect(graphProblems(model)).toEqual([]);
    expect(r.inverse).toEqual({ op: "removeNode", args: { id: 6153 } });
  });

  it("is undone byte for byte by its inverse, also when it made the section", () => {
    roundTrip(NAMED, "addNode", { class: "SoundClass", x: 0, y: 0 });
    const r = roundTrip(NAMED, "addNode", { class: "ShaderClass", name: "S", x: 1, y: 2 });
    expect(r.readback).toMatchObject({ id: 6162, section: "shaders", createdSection: true });
    roundTrip(BARE, "addNode", { class: "GeneratorClass", x: 1, y: 2, version: 5 });
  });

  it("puts a new section after the last section, before the trailing scalars", () => {
    const model = m(NAMED);
    ok(applyGraphOp(model, "addNode", { class: "FilterClass", x: 0, y: 0 }));
    expect(model.doc.text).toContain(' }\n filters {\n  FilterClass "6166" {\n');
    expect(model.doc.text.endsWith("  }\n }\n version 2\n}")).toBe(true);
  });

  it("copies the bare style and the CRLF of a bare file, with no version for a signal", () => {
    const model = m(BARE);
    const r = ok(applyGraphOp(model, "addNode", { class: "SignalClass", name: "New", x: 0, y: 0 }));
    expect(r.readback).toMatchObject({ id: 5133, style: "bare" });
    expect(nodeText(model, 5133)).toBe(
      ["SignalClass {", "   id 5133", '   name "New"', "   tl 0 0", "  }"].join("\r\n"),
    );
    expect(r.warnings[0]).toMatch(/needs `res`/);
    expect(model.doc.text.includes("\n") && !/[^\r]\n/.test(model.doc.text)).toBe(true);
  });

  it("refuses a bad class, a group, a bad position, a bad name and unknown arguments", () => {
    const model = m(NAMED);
    const before = model.doc;
    expect(
      refused(
        applyGraphOp(model, "addNode", { class: "NopeClass", x: 0, y: 0 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/must be one of/);
    expect(
      refused(
        applyGraphOp(model, "addNode", { class: "GroupClass", x: 0, y: 0 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/group op/);
    refused(applyGraphOp(model, "addNode", { class: "SoundClass", x: 0 }), "INVALID_ARGUMENT");
    refused(
      applyGraphOp(model, "addNode", { class: "SoundClass", x: Infinity, y: 0 }),
      "INVALID_ARGUMENT",
    );
    refused(
      applyGraphOp(model, "addNode", { class: "SoundClass", x: 0, y: 0, name: 'a"b' }),
      "INVALID_ARGUMENT",
    );
    refused(
      applyGraphOp(model, "addNode", { class: "SoundClass", x: 0, y: 0, version: 1.5 }),
      "INVALID_ARGUMENT",
    );
    expect(
      refused(
        applyGraphOp(model, "addNode", { class: "SoundClass", x: 0, y: 0, z: 1 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/unknown argument 'z'/);
    refused(applyGraphOp(model, "addNode", { x: 0, y: 0 }), "INVALID_ARGUMENT");
    expect(model.doc).toBe(before);
  });
});

// ── connect ──────────────────────────────────────────────────────────────────

describe("connect", () => {
  it("appends a link to an existing port, in the siblings' style", () => {
    const model = m(NAMED);
    const r = ok(
      applyGraphOp(model, "connect", { from: 4100, fromPort: 65, to: 1033, toPort: 64 }),
    );
    expect(r.readback).toEqual({
      from: 4100,
      fromPort: 65,
      to: 1033,
      toPort: 64,
      index: 1,
      created: "link",
    });
    expect(r.changed).toEqual([{ path: "link:1033:64", before: null, after: "4100:65" }]);
    expect(nodeText(model, 1033)).toContain(
      [
        "      }",
        '      ConnectionClass "4100:65" {',
        "       id 4100",
        "       port 65",
        "      }",
        "     }",
      ].join("\n"),
    );
    expect(
      readGraph(model)
        .links.filter((l) => l.to === 1033)
        .map((l) => l.from),
    ).toEqual([2052, 4100]);
    expect(r.inverse).toEqual({
      op: "disconnect",
      args: { from: 4100, fromPort: 65, to: 1033, toPort: 64, keepEmpty: true },
    });
  });

  it("puts the link at an index, makes a new port, or a new ins after the head keys", () => {
    const at0 = m(NAMED);
    ok(applyGraphOp(at0, "connect", { from: 4100, fromPort: 65, to: 1033, toPort: 64, index: 0 }));
    expect(
      readGraph(at0)
        .links.filter((l) => l.to === 1033)
        .map((l) => l.from),
    ).toEqual([4100, 2052]);

    const port = roundTrip(NAMED, "connect", { from: 4100, fromPort: 65, to: 1033, toPort: 0 });
    expect(port.readback.created).toBe("port");
    expect(port.inverse!.args.keepEmpty).toBe(false);

    const model = m(NAMED);
    const r = ok(applyGraphOp(model, "connect", { from: 1033, fromPort: 1, to: 2052, toPort: 0 }));
    expect(r.readback.created).toBe("ins");
    expect(nodeText(model, 2052)).toBe(
      [
        'BankLocalClass "2052" {',
        "   id 2052",
        '   name "All"',
        "   version 7",
        "   tl -256 528",
        "   ins {",
        '    ConnectionsClass "con:0" {',
        "     id 0",
        "     links {",
        '      ConnectionClass "1033:1" {',
        "       id 1033",
        "       port 1",
        "      }",
        "     }",
        "    }",
        "   }",
        "  }",
      ].join("\n"),
    );
    roundTrip(NAMED, "connect", { from: 1033, fromPort: 1, to: 2052, toPort: 0 });
  });

  it("fills a stub port in bare style and is undone by its inverse", () => {
    const r = roundTrip(BARE, "connect", { from: 4100, fromPort: 65, to: 2057, toPort: 0 });
    expect(r.readback.created).toBe("links");
    const model = m(BARE);
    ok(applyGraphOp(model, "connect", { from: 4100, fromPort: 65, to: 2057, toPort: 0 }));
    expect(model.doc.text).toContain(
      [
        "    ConnectionsClass connections {",
        "     id 0",
        "     links {",
        "      ConnectionClass connection {",
      ].join("\r\n"),
    );
    // A forced style.
    const named = m(BARE);
    ok(
      applyGraphOp(named, "connect", {
        from: 4100,
        fromPort: 65,
        to: 2057,
        toPort: 9,
        style: "named",
      }),
    );
    expect(named.doc.text).toContain('ConnectionsClass "con:9" {');
  });

  it("answers changed null for a link that is already there", () => {
    const model = m(NAMED);
    const before = model.doc;
    const r = ok(
      applyGraphOp(model, "connect", { from: 2052, fromPort: 65, to: 1033, toPort: 64 }),
    );
    expect(r.changed).toBeNull();
    expect(r.edits).toEqual([]);
    expect(model.doc).toBe(before);
  });

  it("refuses missing nodes, self links, signal and group targets, and a bad index", () => {
    const model = m(NAMED);
    refused(
      applyGraphOp(model, "connect", { from: 77, fromPort: 1, to: 1033, toPort: 64 }),
      "NODE_NOT_FOUND",
    );
    refused(
      applyGraphOp(model, "connect", { from: 2052, fromPort: 1, to: 77, toPort: 64 }),
      "NODE_NOT_FOUND",
    );
    refused(
      applyGraphOp(model, "connect", { from: 1033, fromPort: 1, to: 1033, toPort: 64 }),
      "INVALID_ARGUMENT",
    );
    expect(
      refused(
        applyGraphOp(model, "connect", { from: 2052, fromPort: 1, to: 5123, toPort: 0 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/GroupClass takes no ins/);
    expect(
      refused(
        applyGraphOp(model, "connect", { from: 5123, fromPort: 1, to: 1033, toPort: 0 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/not a link source/);
    refused(
      applyGraphOp(model, "connect", { from: 4100, fromPort: 65, to: 1033, toPort: 64, index: 5 }),
      "INVALID_ARGUMENT",
    );
    refused(
      applyGraphOp(model, "connect", { from: 4100, fromPort: -1, to: 1033, toPort: 64 }),
      "INVALID_ARGUMENT",
    );
    refused(
      applyGraphOp(model, "connect", {
        from: 4100,
        fromPort: 1,
        to: 1033,
        toPort: 64,
        style: "loud",
      }),
      "INVALID_ARGUMENT",
    );
    refused(
      applyGraphOp(model, "connect", { from: 4100, to: 1033, toPort: 64 }),
      "INVALID_ARGUMENT",
    );
    const b = m(BARE);
    expect(
      refused(
        applyGraphOp(b, "connect", { from: 1042, fromPort: 1, to: 3085, toPort: 0 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/signal inputs/);
    expect(model.doc.text).toBe(NAMED);
  });
});

// ── disconnect ───────────────────────────────────────────────────────────────

describe("disconnect", () => {
  it("removes a middle link and its inverse puts it back at the same index", () => {
    const model = m(BARE);
    const r = ok(applyGraphOp(model, "disconnect", { from: 1042, to: 2057 }));
    expect(r.readback).toEqual({
      from: 1042,
      fromPort: 1,
      to: 2057,
      toPort: 64,
      via: "ins",
      removed: "link",
    });
    expect(r.inverse).toEqual({
      op: "connect",
      args: { from: 1042, fromPort: 1, to: 2057, toPort: 64, style: "bare", index: 0 },
    });
    ok(applyGraphOp(model, r.inverse!.op, r.inverse!.args));
    expect(model.doc.text).toBe(BARE);
  });

  it("leaves a port stub for the last link by default, and is undone exactly", () => {
    const model = m(NAMED);
    const r = ok(
      applyGraphOp(model, "disconnect", { from: 2052, to: 1033, fromPort: 65, toPort: 64 }),
    );
    expect(r.readback.removed).toBe("links");
    expect(nodeText(model, 1033)).toContain(
      ['    ConnectionsClass "con:64" {', "     id 64", "    }"].join("\n"),
    );
    expect(graphProblems(model)).toEqual([]);
    ok(applyGraphOp(model, r.inverse!.op, r.inverse!.args));
    expect(model.doc.text).toBe(NAMED);
  });

  it("with keepEmpty false drops the port, and ins when it empties", () => {
    const model = m(NAMED);
    const r = ok(applyGraphOp(model, "disconnect", { from: 2052, to: 1033, keepEmpty: false }));
    expect(r.readback.removed).toBe("ins");
    expect(nodeText(model, 1033)).not.toContain("ins {");
    const b = m(BARE);
    ok(applyGraphOp(b, "disconnect", { from: 1042, to: 2057 }));
    expect(
      ok(applyGraphOp(b, "disconnect", { from: 4100, to: 2057, keepEmpty: false })).readback
        .removed,
    ).toBe("port");
    expect(nodeText(b, 2057)).toContain("ins {");
  });

  it("removes a signal input link with its IOPConnectionClass, with no inverse", () => {
    const model = m(BARE);
    const r = ok(applyGraphOp(model, "disconnect", { from: 2057, to: 3085 }));
    expect(r.readback).toMatchObject({ via: "conns", toPort: 3, removed: "port" });
    expect(r.inverse).toBeUndefined();
    expect(r.warnings[0]).toMatch(/signal input/);
    expect(nodeText(model, 3085)).not.toContain("conns");
  });

  it("refuses a missing link, a missing node and an ambiguous match", () => {
    const model = m(NAMED);
    refused(applyGraphOp(model, "disconnect", { from: 4100, to: 1033 }), "LINK_NOT_FOUND");
    refused(
      applyGraphOp(model, "disconnect", { from: 2052, to: 1033, toPort: 1 }),
      "LINK_NOT_FOUND",
    );
    refused(applyGraphOp(model, "disconnect", { from: 2052, to: 99 }), "NODE_NOT_FOUND");
    refused(
      applyGraphOp(model, "disconnect", { from: 2052, to: 1033, keepEmpty: "no" }),
      "INVALID_ARGUMENT",
    );
    ok(applyGraphOp(model, "connect", { from: 2052, fromPort: 66, to: 1033, toPort: 64 }));
    expect(
      refused(applyGraphOp(model, "disconnect", { from: 2052, to: 1033 }), "INVALID_ARGUMENT"),
    ).toMatch(/2 links match/);
    expect(
      ok(applyGraphOp(model, "disconnect", { from: 2052, to: 1033, fromPort: 66 })).readback
        .fromPort,
    ).toBe(66);
  });
});

// ── removeNode ───────────────────────────────────────────────────────────────

describe("removeNode", () => {
  it("drops the node, the links pointing at it and its group membership", () => {
    const model = m(NAMED);
    const r = ok(applyGraphOp(model, "removeNode", { id: 2052 }));
    expect(r.readback).toEqual({
      id: 2052,
      class: "BankLocalClass",
      section: "banks_local",
      droppedLinks: ["2052:65 -> 1033:64"],
      group: 5123,
      droppedGroup: false,
    });
    expect(r.changed).toEqual([
      { path: "node:2052", before: { class: "BankLocalClass", name: "All" }, after: null },
    ]);
    const g = readGraph(model);
    expect(g.nodes.map((n) => n.id)).toEqual([1033, 3083, 4100, 5123]);
    expect(g.links.some((l) => l.from === 2052)).toBe(false);
    expect(g.groups[0].members).toEqual([4100]);
    expect(graphProblems(model)).toEqual([]);
    expect(r.inverse).toBeUndefined();
  });

  it("removes a group left empty and a section left empty", () => {
    const model = m(NAMED);
    ok(applyGraphOp(model, "removeNode", { id: 2052 }));
    const r = ok(applyGraphOp(model, "removeNode", { id: 4100 }));
    expect(r.readback).toMatchObject({ droppedGroup: true, group: 5123 });
    expect(r.warnings[0]).toMatch(/group 5123 held only this node/);
    expect(model.doc.text).not.toContain("banks_local");
    expect(model.doc.text).not.toContain("groups");
    expect(graphProblems(model)).toEqual([]);
  });

  it("refuses a node another node names, unless forced", () => {
    const model = m(NAMED);
    expect(refused(applyGraphOp(model, "removeNode", { id: 3083 }), "NODE_IN_USE")).toMatch(
      /SoundClass 1033 outState/,
    );
    expect(model.doc.text).toBe(NAMED);
    const r = ok(applyGraphOp(model, "removeNode", { id: 3083, force: true }));
    expect(r.warnings[0]).toMatch(/left naming a removed node: SoundClass 1033 outState/);
    expect(model.doc.text).not.toContain("mixers");
  });

  it("removes a signal input link that points at the removed node", () => {
    const model = m(BARE);
    const r = ok(applyGraphOp(model, "removeNode", { id: 2057 }));
    expect(r.readback.droppedLinks).toEqual(["2057:1 -> 3085:3"]);
    expect(graphProblems(model)).toEqual([]);
  });

  it("refuses a missing id and a bad force", () => {
    const model = m(NAMED);
    refused(applyGraphOp(model, "removeNode", { id: 1 }), "NODE_NOT_FOUND");
    refused(applyGraphOp(model, "removeNode", { id: 2052, force: 1 }), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "removeNode", {}), "INVALID_ARGUMENT");
  });
});

// ── group ────────────────────────────────────────────────────────────────────

describe("group", () => {
  it("creates a group of ungrouped nodes, undone byte for byte", () => {
    const model = m(NAMED);
    const r = ok(applyGraphOp(model, "group", { name: "Sounds", members: [1033, 3083] }));
    expect(r.readback).toEqual({
      group: 6147,
      name: "Sounds",
      members: [1033, 3083],
      createdSection: false,
    });
    expect(nodeText(model, 6147)).toBe(
      [
        'GroupClass "6147" {',
        "   id 6147",
        '   name "Sounds"',
        "   children {",
        "    1033 3083",
        "   }",
        "   parent -1",
        "   Color 0.502 0 0.376 0.329",
        "  }",
      ].join("\n"),
    );
    expect(graphProblems(model)).toEqual([]);
    roundTrip(NAMED, "group", { name: "Sounds", members: [1033] });
    const b = roundTrip(BARE, "group", { name: "G", members: [1042, 4100], color: [1, 0, 0, 1] });
    expect(b.readback.createdSection).toBe(true);
  });

  it("edits members by list, add and remove, each undone by its inverse", () => {
    const add = roundTrip(NAMED, "group", { group: 5123, add: [1033] });
    expect(add.readback.members).toEqual([2052, 4100, 1033]);
    const rem = roundTrip(NAMED, "group", { group: 5123, remove: [2052] });
    expect(rem.readback.members).toEqual([4100]);
    expect(rem.inverse).toEqual({ op: "group", args: { group: 5123, members: [2052, 4100] } });
    const set = roundTrip(NAMED, "group", { group: 5123, members: [4100, 2052, 1033] });
    expect(set.changed).toEqual([
      { path: "group:5123", before: [2052, 4100], after: [4100, 2052, 1033] },
    ]);
    const same = ok(applyGraphOp(m(NAMED), "group", { group: 5123, members: [2052, 4100] }));
    expect(same.changed).toBeNull();
  });

  it("refuses members in another group, non-nodes, empty groups and mixed arguments", () => {
    const model = m(NAMED);
    expect(
      refused(applyGraphOp(model, "group", { name: "X", members: [2052] }), "INVALID_ARGUMENT"),
    ).toMatch(/already in group 5123/);
    refused(applyGraphOp(model, "group", { name: "X", members: [5123] }), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "group", { name: "X", members: [42] }), "NODE_NOT_FOUND");
    refused(applyGraphOp(model, "group", { name: "X", members: [] }), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "group", { members: [1033] }), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "group", { name: "X", members: [1033, 1033] }), "INVALID_ARGUMENT");
    refused(
      applyGraphOp(model, "group", { name: "X", members: [1033], color: [2, 0, 0, 0] }),
      "INVALID_ARGUMENT",
    );
    refused(applyGraphOp(model, "group", { name: "X", add: [1033] }), "INVALID_ARGUMENT");
    refused(
      applyGraphOp(model, "group", { group: 5123, remove: [2052, 4100] }),
      "INVALID_ARGUMENT",
    );
    refused(applyGraphOp(model, "group", { group: 5123, add: [2052] }), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "group", { group: 5123, remove: [1033] }), "INVALID_ARGUMENT");
    refused(
      applyGraphOp(model, "group", { group: 5123, members: [1033], add: [3083] }),
      "INVALID_ARGUMENT",
    );
    refused(applyGraphOp(model, "group", { group: 5123 }), "INVALID_ARGUMENT");
    refused(
      applyGraphOp(model, "group", { group: 5123, name: "Y", add: [1033] }),
      "INVALID_ARGUMENT",
    );
    refused(applyGraphOp(model, "group", { group: 1033, add: [3083] }), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "group", { group: 1, add: [3083] }), "NODE_NOT_FOUND");
    expect(model.doc.text).toBe(NAMED);
  });
});

// ── Dispatch ─────────────────────────────────────────────────────────────────

describe("applyGraphOp", () => {
  it("answers GATED for a write while P-W5-05 is open, and changes nothing", () => {
    expect(AUDIO_GRAPH_PROVEN).toBe(false);
    const model = m(NAMED);
    const before = model.doc;
    const r = applyGraphOp(
      model,
      "addNode",
      { class: "SoundClass", x: 0, y: 0 },
      { confirm: true },
    );
    const msg = refused(r, "GATED");
    expect(msg).toMatch(/P-W5-05/);
    expect(msg).toMatch(/AUDIO_GRAPH_PROVEN/);
    expect(model.doc).toBe(before);
  });

  it("refuses an unknown op, a non-object, a non-acp model and a non-AudioClass root", () => {
    const model = m(NAMED);
    refused(applyGraphOp(model, "explode", {}), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "addNode", null), "INVALID_ARGUMENT");
    refused(applyGraphOp(model, "addNode", [1]), "INVALID_ARGUMENT");
    refused(
      applyGraphOp({ doc: parseCst(NAMED), kind: "sig" }, "removeNode", { id: 1033 }),
      "INVALID_ARGUMENT",
    );
    expect(
      refused(applyGraphOp(m("EffectDef {\n}"), "removeNode", { id: 1 }), "INVALID_ARGUMENT"),
    ).toMatch(/not an .acp/);
    expect(
      refused(
        applyGraphOp(m("AudioClass {\n sounds {\n"), "removeNode", { id: 1 }),
        "INVALID_ARGUMENT",
      ),
    ).toMatch(/parse cleanly/);
  });

  it("answers its graph codes from the vocabulary with a next text each", () => {
    for (const c of ["NODE_NOT_FOUND", "LINK_NOT_FOUND", "NODE_IN_USE"] as const)
      expect(ERROR_CODES[c].length).toBeGreaterThan(20);
    const r = applyGraphOp(m(NAMED), "removeNode", { id: 1 });
    expect(r.ok === false && r.next).toBe(ERROR_CODES.NODE_NOT_FOUND);
  });

  it("works on the AudioModel of audio-model.ts and keeps its encoding", () => {
    const model = loadAudioModel(Buffer.from(NAMED, "utf8"), "acp");
    ok(applyGraphOp(model, "addNode", { class: "BankLocalClass", name: "B", x: 0, y: 0 }));
    expect(model.root.key).toBe("AudioClass");
    expect(model.doc.encoding).toBe("utf8");
    const latin = Buffer.from(NAMED.replace('"All"', '"Allé"'), "latin1");
    const lm = { doc: parseCstBytes(latin) };
    expect(lm.doc.encoding).toBe("latin1");
    ok(applyGraphOp(lm, "connect", { from: 4100, fromPort: 65, to: 1033, toPort: 64 }));
    expect(lm.doc.encoding).toBe("latin1");
    expect(lm.doc instanceof CstDocument).toBe(true);
  });

  it("lists every splice it made", () => {
    const model = m(NAMED);
    const r = ok(applyGraphOp(model, "removeNode", { id: 2052 }));
    expect(r.edits.length).toBe(3); // the link block, the group line, the node
    for (const e of r.edits) expect(e.start).toBeLessThanOrEqual(e.end);
  });
});

// ── Vanilla corpus: invariants and edit locality on a seeded sample ──────────

const opened = openVanillaCorpus(loadBaseline());
const corpus = opened.corpus;
const SEED = "w5-audio-graph-v1";

/** The changed region of `b` against `a`: [start, endInA). */
function changedRegion(a: string, b: string): [number, number] | undefined {
  if (a === b) return undefined;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [p, a.length - s];
}

function texts(model: AudioGraphModel): Map<number, string> {
  const out = new Map<number, string>();
  for (const n of readGraph(model).nodes) {
    const e = model.doc.resolve(n.path);
    if (!out.has(n.id)) out.set(n.id, model.doc.text.slice(e.start, e.end));
  }
  return out;
}

/** Every node not in `touched` has the same text after as before. */
function untouchedSame(
  before: Map<number, string>,
  after: Map<number, string>,
  touched: Set<number>,
): string[] {
  const off: string[] = [];
  for (const [id, t] of before) if (!touched.has(id) && after.get(id) !== t) off.push(String(id));
  return off;
}

function span(model: AudioGraphModel, id: number): [number, number] {
  const n = readGraph(model).nodes.find((x) => x.id === id)!;
  const e = model.doc.resolve(n.path);
  return [e.start, e.end];
}

describe.skipIf(!corpus)(`vanilla .acp graph edits (${opened.skip ?? "corpus open"})`, () => {
  const all = corpus ? corpus.list("acp") : [];
  const sample = corpus ? seededSample(all, 20, "acp", SEED) : [];

  it("reads every vanilla .acp as a graph with its invariants holding", () => {
    let nodes = 0;
    let links = 0;
    const bad: string[] = [];
    for (const f of all) {
      const model = { doc: parseCstBytes(corpus!.read(f)) };
      const g = readGraph(model);
      nodes += g.nodes.length;
      links += g.links.length;
      const p = graphProblems(model);
      if (p.length) bad.push(`${f}: ${p[0]}`);
    }
    expect(bad).toEqual([]);
    expect(all.length).toBe(720);
    console.log(
      `acp graph corpus: ${all.length} files, ${nodes} nodes, ${links} links, invariants hold`,
    );
  });

  it("addNode: unique id with its class code, only new text, undone byte for byte", () => {
    for (const f of sample) {
      const buf = corpus!.read(f);
      const model = { doc: parseCstBytes(buf) };
      const before = texts(model);
      const text0 = model.doc.text;
      const r = ok(
        applyGraphOp(model, "addNode", { class: "SoundClass", name: "EMCP_PROBE", x: 0, y: 0 }),
      );
      const id = r.readback.id as number;
      expect(id & 1023, f).toBe(9);
      expect(before.has(id), f).toBe(false);
      expect(graphProblems(model), f).toEqual([]);
      const after = texts(model);
      expect(untouchedSame(before, after, new Set()), f).toEqual([]);
      const region = changedRegion(text0, model.doc.text) as [number, number];
      expect(region[1] - region[0], `${f}: addNode removed old text`).toBe(0);
      ok(applyGraphOp(model, r.inverse!.op, r.inverse!.args));
      expect(Buffer.compare(model.doc.toBytes(), buf), f).toBe(0);
    }
  });

  it("connect and disconnect touch only the destination node and are undone byte for byte", () => {
    let done = 0;
    for (const f of sample) {
      const buf = corpus!.read(f);
      const model = { doc: parseCstBytes(buf) };
      const g = readGraph(model);
      const l = g.links.find((x) => x.via === "ins");
      if (!l) continue;
      const src = g.nodes.find(
        (n) =>
          n.id !== l.to &&
          !["GroupClass", "ACPInOut", "ACPGroup"].includes(n.cls) &&
          !g.links.some(
            (x) =>
              x.to === l.to &&
              x.toPort === l.toPort &&
              x.from === n.id &&
              x.fromPort === l.fromPort,
          ),
      );
      if (!src) continue;
      const before = texts(model);
      const text0 = model.doc.text;
      const [s0, e0] = span(model, l.to);
      const c = ok(
        applyGraphOp(model, "connect", {
          from: src.id,
          fromPort: l.fromPort,
          to: l.to,
          toPort: l.toPort,
        }),
      );
      expect(graphProblems(model), f).toEqual([]);
      const reg = changedRegion(text0, model.doc.text) as [number, number];
      expect(reg[0] >= s0 && reg[1] <= e0, `${f}: connect edited outside node ${l.to}`).toBe(true);
      expect(untouchedSame(before, texts(model), new Set([l.to])), f).toEqual([]);
      ok(applyGraphOp(model, c.inverse!.op, c.inverse!.args));
      expect(Buffer.compare(model.doc.toBytes(), buf), f).toBe(0);

      const d = ok(
        applyGraphOp(model, "disconnect", {
          from: l.from,
          fromPort: l.fromPort,
          to: l.to,
          toPort: l.toPort,
        }),
      );
      expect(graphProblems(model), f).toEqual([]);
      const reg2 = changedRegion(text0, model.doc.text) as [number, number];
      expect(reg2[0] >= s0 && reg2[1] <= e0, `${f}: disconnect edited outside node ${l.to}`).toBe(
        true,
      );
      expect(untouchedSame(before, texts(model), new Set([l.to])), f).toEqual([]);
      ok(applyGraphOp(model, d.inverse!.op, d.inverse!.args));
      expect(Buffer.compare(model.doc.toBytes(), buf), f).toBe(0);
      done++;
    }
    expect(done).toBeGreaterThan(10);
  });

  it("removeNode leaves no link to the node and touches only it, its link holders and its group", () => {
    let done = 0;
    for (const f of sample) {
      const model = { doc: parseCstBytes(corpus!.read(f)) };
      const g = readGraph(model);
      const before = texts(model);
      const sources = [...new Set(g.links.map((l) => l.from))];
      for (const id of sources) {
        const trial = { doc: new CstDocument(model.doc.text, model.doc.encoding) };
        const r = applyGraphOp(trial, "removeNode", { id });
        if (!r.ok) {
          expect(r.code, f).toBe("NODE_IN_USE");
          continue;
        }
        const after = readGraph(trial);
        expect(
          after.nodes.some((n) => n.id === id),
          f,
        ).toBe(false);
        expect(
          after.links.some((l) => l.from === id),
          f,
        ).toBe(false);
        expect(graphProblems(trial), f).toEqual([]);
        const touched = new Set<number>([
          id,
          ...g.links.filter((l) => l.from === id).map((l) => l.to),
        ]);
        for (const gr of g.groups) if (gr.members.includes(id)) touched.add(gr.id);
        const afterTexts = texts(trial);
        const off = [...before.keys()].filter(
          (k) => !touched.has(k) && afterTexts.get(k) !== before.get(k),
        );
        expect(off, f).toEqual([]);
        done++;
        break;
      }
    }
    expect(done).toBeGreaterThan(10);
  });

  it("group: a new group of an ungrouped node is undone byte for byte", () => {
    let done = 0;
    for (const f of sample) {
      const buf = corpus!.read(f);
      const model = { doc: parseCstBytes(buf) };
      const g = readGraph(model);
      const grouped = new Set(g.groups.flatMap((x) => x.members));
      const n = g.nodes.find(
        (x) => !grouped.has(x.id) && !["GroupClass", "ACPInOut", "ACPGroup"].includes(x.cls),
      );
      if (!n) continue;
      const before = texts(model);
      const r = ok(applyGraphOp(model, "group", { name: "EMCP_PROBE", members: [n.id] }));
      expect((r.readback.group as number) & 1023).toBe(3);
      expect(graphProblems(model), f).toEqual([]);
      expect(untouchedSame(before, texts(model), new Set()), f).toEqual([]);
      ok(applyGraphOp(model, r.inverse!.op, r.inverse!.args));
      expect(Buffer.compare(model.doc.toBytes(), buf), f).toBe(0);
      done++;
    }
    expect(done).toBeGreaterThan(10);
  });
});
