import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { audioNodes, loadAudioModel } from "../../src/formats/audio-model.js";
import { CstDocument } from "../../src/formats/enfusion-cst.js";
import type { ActionOk, ActionResponse } from "../../src/manifest/vocabulary.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  AUDIO_DESCRIPTION,
  AUDIO_GATES,
  GRAPH_ACTIONS,
  READ_ACTIONS,
  WRITE_ACTIONS,
  registerAudio,
  runAudio,
  skeleton,
  unwritableReason,
  type AudioGates,
  type AudioRequest,
  type GraphDispatch,
} from "../../src/tools/audio.js";
import { captureTool, makeConfig } from "./_tool-harness.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Vanilla shape: one space of indent, LF, no final line ending. Ids keep the
// class codes of the corpus (id & 1023: Sound 9, Bank 4, Mixer 11, Signal 13,
// Constant 12, Variable 30).

const ACP = [
  "AudioClass {",
  " sounds {",
  '  SoundClass "69641" {',
  "   id 69641",
  '   name "SOUND_ONE"',
  "   version 5",
  "   tl 256 528",
  "   ins {",
  '    ConnectionsClass "con:64" {',
  "     id 64",
  "     links {",
  '      ConnectionClass "70660:65" {',
  "       id 70660",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "   outState 6155",
  "   outStatePort 22535",
  "   priority 50",
  "  }",
  '  SoundClass "72713" {',
  "   id 72713",
  '   name "SOUND_TWO"',
  "   version 5",
  "   tl 256 336",
  "   ins {",
  '    ConnectionsClass "con:64" {',
  "     id 64",
  "     links {",
  '      ConnectionClass "73732:65" {',
  "       id 73732",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "   outState 6155",
  "   outStatePort 22535",
  '   eventType "OnStart - Start"',
  "  }",
  "  SoundClass {",
  "   id 74761",
  "   version 5",
  "   tl 256 688",
  "   parent 69641",
  "  }",
  " }",
  " mixers {",
  '  MixerClass "6155" {',
  "   id 6155",
  '   name "OutputState"',
  "   version 4",
  "   tl 512 512",
  '   res "{AF08E302CF8BA2E6}Sounds/FinalMix_UI_Music.afm"',
  "   ins {",
  '    ConnectionsClass "con:22535" {',
  "     id 22535",
  "     links {",
  '      ConnectionClass "69641:65" {',
  "       id 69641",
  "       port 65",
  "      }",
  '      ConnectionClass "72713:65" {',
  "       id 72713",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "   inputs {",
  '    "Music" "UI"',
  "   }",
  "  }",
  " }",
  " banks_local {",
  '  BankLocalClass "70660" {',
  "   id 70660",
  '   name "All"',
  "   version 7",
  "   tl -256 528",
  "   Volume 3",
  '   "Disable streaming" 1',
  "   Samples {",
  '    AudioBankSampleClass "a.snd" {',
  '     Filename "{1D233AE2144689DC}Sounds/Samples/a.snd"',
  "    }",
  '    AudioBankSampleClass "b.snd" {',
  '     Filename "{03CA1F966EAAC1B5}Sounds/Samples/b.snd"',
  "     Probability 70",
  "     Index 3",
  "    }",
  "   }",
  "  }",
  '  BankLocalClass "73732" {',
  "   id 73732",
  '   name "Menu"',
  "   version 7",
  "   tl -256 336",
  "  }",
  " }",
  " signals {",
  "  SignalClass {",
  "   id 59405",
  '   name "Blend"',
  "   tl -256 256",
  '   res "{E801AB59ABF0E75D}Sounds/_SharedData/Signals/Blend.sig"',
  "   conns {",
  "    IOPConnectionClass iopConnection {",
  "     port 3",
  "     conn {",
  "      ConnectionsClass connections {",
  "       id 8",
  "       links {",
  "        ConnectionClass connection {",
  "         id 60428",
  "         port 1",
  "        }",
  "       }",
  "      }",
  "     }",
  "    }",
  "   }",
  "   inputsport {",
  "    1 3",
  "   }",
  "   outputsport {",
  "    4",
  "   }",
  "   inputvalues {",
  "    0 0",
  "   }",
  "   inputvaluesmin {",
  "    0 0",
  "   }",
  "   inputvaluesmax {",
  "    1 100",
  "   }",
  "  }",
  " }",
  " constants {",
  "  ConstantClass {",
  "   id 60428",
  '   name "Const"',
  "   version 5",
  "   tl -512 256",
  "  }",
  " }",
  " vars {",
  "  VariableClass {",
  "   id 61470",
  '   name "Room"',
  "   version 5",
  "   tl 0 0",
  '   varName "GRoomSize"',
  '   varResource "{A60F08955792B575}Sounds/_SharedData/Variables/GlobalVariables.conf"',
  "  }",
  " }",
  " version 2",
  "}",
].join("\n");

const CONF = [
  "AudioVariablesClass {",
  " Variables {",
  "  AudioVariableClass Backfire {",
  "   source PlayTime",
  "  }",
  "  AudioVariableClass GRoom {",
  "   source External",
  "   value 0",
  "   value_min 0",
  "   value_max 1",
  "  }",
  " }",
  "}",
].join("\n");

const AFM = [
  "AudioOutputStateResClass {",
  " Mixers {",
  "  OBusClass {",
  "   id 22535",
  '   name "Music"',
  "   tl 0 3840",
  '   channels "2"',
  "   type In",
  "   master Music",
  "   limit 2",
  "  }",
  " }",
  " bus_out {",
  "  OBusOutClass {",
  "   id 220191",
  '   name "Output Music"',
  "   ins {",
  "    ConnectionsClass connections {",
  "     id 64",
  "     links {",
  "      ConnectionClass connection {",
  "       id 22535",
  "       port 65",
  "      }",
  "     }",
  "    }",
  "   }",
  "   type Out",
  "   master Music",
  "  }",
  " }",
  "}",
].join("\n");

const SIG = [
  "AudioSignalResClass {",
  " Inputs {",
  "  IOPInputValueClass {",
  "   id 9",
  '   name "Trigger Time"',
  "   children {",
  "    7",
  "   }",
  "   value 12000",
  "  }",
  " }",
  " Ops {",
  "  IOPItemOpMulClass {",
  "   id 7",
  '   name "Mul 7"',
  "   children {",
  "    2",
  "   }",
  "   inputs {",
  "    ConnectionClass connection {",
  "     id 9",
  "     port 0",
  "    }",
  "   }",
  "  }",
  " }",
  " Outputs {",
  "  IOPItemOutputClass {",
  "   id 2",
  '   name "Time"',
  "   input 7",
  "  }",
  " }",
  " compiled IOPCompiledClass {",
  "  visited {",
  "   5 6",
  "  }",
  "  processed 2",
  "  version 2",
  " }",
  "}",
].join("\n");

// ── Harness ──────────────────────────────────────────────────────────────────

let dir: string;
const cfg = () => makeConfig({ projectPath: dir, gamePath: join(dir, "no-game") });

function put(rel: string, text: string): void {
  const f = join(dir, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
}
const disk = (rel: string) => readFileSync(join(dir, rel), "utf8");

function run(req: Partial<AudioRequest> & { action: AudioRequest["action"] }, gates?: AudioGates) {
  return runAudio({ projectPath: dir, ...req } as AudioRequest, cfg(), gates);
}

const runHere = run;

const extraDirs: string[] = [];
afterAll(() => {
  for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
});
/**
 * A second, separate project folder holding exactly `files`. It sits under the configured root:
 * a caller projectPath outside it is refused (total audit offline-writers-01).
 */
function freshProject(files: Record<string, string>): string {
  const d = mkdtempSync(join(dir, "fresh-"));
  extraDirs.push(d);
  for (const [rel, text] of Object.entries(files)) {
    const f = join(d, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  return d;
}

/** An ok answer; write actions add dryRun beside the shared ActionOk keys. */
function ok(r: ActionResponse): ActionOk & { dryRun?: boolean } {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
}
function rb(r: ActionResponse): Record<string, any> {
  return ok(r).readback as Record<string, any>;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "audio-tool-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

function reset(): void {
  put("Sounds/T.acp", ACP);
  put("Sounds/T.sig", SIG);
  put("Sounds/T.afm", AFM);
  put("Sounds/Vars.conf", CONF);
}

// ── Registration ─────────────────────────────────────────────────────────────

describe("registration", () => {
  it("registers `audio` with a description inside the 400 character limit and no graph action in it", () => {
    let name = "";
    let def: any;
    const fake = {
      registerTool: (n: string, d: unknown) => {
        name = n;
        def = d;
      },
    } as unknown as McpServer;
    registerAudio(fake, cfg());
    expect(name).toBe("audio");
    expect(def.description).toBe(AUDIO_DESCRIPTION);
    expect(AUDIO_DESCRIPTION.length).toBeLessThanOrEqual(400);
    for (const a of GRAPH_ACTIONS) expect(AUDIO_DESCRIPTION).not.toContain(a);
    for (const a of [...READ_ACTIONS, ...WRITE_ACTIONS]) expect(AUDIO_DESCRIPTION).toContain(a);
    expect(AUDIO_DESCRIPTION).not.toMatch(/sandbox/i);
    const parsed = def.inputSchema.action.parse("inspect");
    expect(parsed).toBe("inspect");
    expect(() => def.inputSchema.action.parse("bogus")).toThrow();
    expect(def.inputSchema.action.parse("connect")).toBe("connect");
  });

  it("answers through the registered handler as JSON text", async () => {
    reset();
    const h = captureTool((s) => registerAudio(s, cfg()));
    const res = await h({ action: "inspect", path: "Sounds/T.acp" });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0].text).readback.kind).toBe("acp");
    const bad = await h({ action: "inspect", path: "Sounds/Nope.acp" });
    expect(bad.isError).toBe(true);
  });

  it("keeps both gates off by default", () => {
    expect(AUDIO_GATES).toEqual({ sigWrites: false, graphActions: false });
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────

describe("reads on an .acp", () => {
  it("inspect counts sections, events, samples and links", () => {
    reset();
    const b = rb(run({ action: "inspect", path: "Sounds/T.acp" }));
    expect(b.kind).toBe("acp");
    expect(b.rootClass).toBe("AudioClass");
    expect(b.nodes).toBe(9);
    expect(b.events).toBe(2);
    expect(b.unnamedSounds).toBe(1);
    expect(b.samples).toBe(2);
    expect(b.links).toBe(5);
    expect(b.diagnostics).toBe(0);
    expect(b.sections.sounds).toBe(3);
    expect(b.version).toBe(2);
    expect(b.source).toBe("project");
  });

  it("events lists names with banks and samples reached upstream, and pages", () => {
    reset();
    const b = rb(run({ action: "events", path: "Sounds/T.acp" }));
    expect(b.total).toBe(2);
    expect(b.events[0]).toMatchObject({
      id: 69641,
      name: "SOUND_ONE",
      priority: 50,
      mixer: 6155,
      banks: 1,
      samples: 2,
    });
    expect(b.events[1]).toMatchObject({
      name: "SOUND_TWO",
      eventType: "OnStart - Start",
      banks: 1,
      samples: 0,
    });
    const p1 = rb(run({ action: "events", path: "Sounds/T.acp", limit: 1 }));
    expect(p1.count).toBe(1);
    expect(p1.nextCursor).toBe("1:2");
    const p2 = rb(run({ action: "events", path: "Sounds/T.acp", limit: 1, cursor: p1.nextCursor }));
    expect(p2.events[0].name).toBe("SOUND_TWO");
    expect(p2.nextCursor).toBeUndefined();
    const f = rb(run({ action: "events", path: "Sounds/T.acp", name: "two" }));
    expect(f.total).toBe(1);
  });

  it("answers STALE_CURSOR when the list changed and INVALID_ARGUMENT for a bad cursor", () => {
    reset();
    const r = run({ action: "events", path: "Sounds/T.acp", limit: 1, cursor: "1:9" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STALE_CURSOR");
    const b = run({ action: "events", path: "Sounds/T.acp", cursor: "nope" });
    if (b.ok) throw new Error("expected a refusal");
    expect(b.code).toBe("INVALID_ARGUMENT");
  });

  it("nodes filters by section, class and name; node reads by id and by name", () => {
    reset();
    expect(rb(run({ action: "nodes", path: "Sounds/T.acp", section: "banks_local" })).total).toBe(
      2,
    );
    expect(rb(run({ action: "nodes", path: "Sounds/T.acp", nodeClass: "SoundClass" })).total).toBe(
      3,
    );
    expect(rb(run({ action: "nodes", path: "Sounds/T.acp", name: "sound" })).total).toBe(2);
    const n = rb(run({ action: "node", path: "Sounds/T.acp", node: 69641 }));
    expect(n).toMatchObject({
      id: 69641,
      class: "SoundClass",
      name: "SOUND_ONE",
      section: "sounds",
      path: "sounds[0]",
    });
    expect(n.scalars.priority).toBe("50");
    expect(n.in).toEqual([
      { from: 70660, fromPort: 65, fromName: "All", to: 69641, toPort: 64, toName: "SOUND_ONE" },
    ]);
    expect(n.out[0]).toMatchObject({ to: 6155, toPort: 22535 });
    expect(n.raw).toContain('name "SOUND_ONE"');
    const byName = rb(run({ action: "node", path: "Sounds/T.acp", node: "All" }));
    expect(byName.id).toBe(70660);
    expect(byName.samples).toHaveLength(2);
    expect(byName.samples[1]).toMatchObject({ name: "b.snd", index: 3, probability: 70 });
    const viaEvent = rb(run({ action: "node", path: "Sounds/T.acp", event: "SOUND_TWO" }));
    expect(viaEvent.id).toBe(72713);
  });

  it("node refuses a missing node with ITEM_NOT_FOUND and a missing argument with INVALID_ARGUMENT", () => {
    reset();
    const r = run({ action: "node", path: "Sounds/T.acp", node: "nothing" });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("ITEM_NOT_FOUND");
    const m = run({ action: "node", path: "Sounds/T.acp" });
    if (m.ok) throw new Error("expected a refusal");
    expect(m.code).toBe("INVALID_ARGUMENT");
  });

  it("node refuses an ambiguous name and lists the ids", () => {
    put("Sounds/D.acp", ACP.replace('name "Menu"', 'name "All"'));
    const r = run({ action: "node", path: "Sounds/D.acp", node: "All" });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toContain("70660");
    expect(r.message).toContain("73732");
  });

  it("graph reads the whole graph or the cone of a node", () => {
    reset();
    const all = rb(run({ action: "graph", path: "Sounds/T.acp" }));
    expect(all.total).toBe(5);
    expect(all.nodeCount).toBe(9);
    const up = rb(run({ action: "graph", path: "Sounds/T.acp", event: "SOUND_ONE" }));
    expect(up.root).toMatchObject({ id: 69641, direction: "up" });
    expect(up.edges).toHaveLength(1);
    expect(up.edges[0]).toMatchObject({ from: 70660, to: 69641 });
    const down = rb(run({ action: "graph", path: "Sounds/T.acp", node: 70660, direction: "down" }));
    expect(down.edges.map((e: any) => `${e.from}>${e.to}`).sort()).toEqual([
      "69641>6155",
      "70660>69641",
    ]);
    const both = rb(
      run({ action: "graph", path: "Sounds/T.acp", node: 69641, direction: "both", depth: 1 }),
    );
    expect(both.total).toBe(2);
    const paged = rb(run({ action: "graph", path: "Sounds/T.acp", limit: 3 }));
    expect(paged.count).toBe(3);
    expect(paged.nextCursor).toBe("3:5");
  });

  it("the signal's own links are read from conns", () => {
    reset();
    const n = rb(run({ action: "node", path: "Sounds/T.acp", node: "Blend" }));
    expect(n.in).toEqual([
      { from: 60428, fromPort: 1, fromName: "Const", to: 59405, toPort: 3, toName: "Blend" },
    ]);
  });

  it("samples, with a bank filter and a resolved flag from the project", () => {
    reset();
    put("Sounds/Samples/a.snd", "x");
    const b = rb(run({ action: "samples", path: "Sounds/T.acp" }));
    expect(b.total).toBe(2);
    expect(b.samples[0]).toMatchObject({
      bank: 70660,
      bankName: "All",
      name: "a.snd",
      guid: "1D233AE2144689DC",
      path: "Sounds/Samples/a.snd",
      resolved: true,
    });
    expect(b.samples[1]).toMatchObject({ index: 3, probability: 70 });
    expect(b.samples[1].resolved).toBeUndefined();
    expect(rb(run({ action: "samples", path: "Sounds/T.acp", bank: "Menu" })).total).toBe(0);
    expect(rb(run({ action: "samples", path: "Sounds/T.acp", bank: 70660 })).total).toBe(2);
    const r = run({ action: "samples", path: "Sounds/T.acp", bank: 69641 });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("ITEM_NOT_FOUND");
  });

  it("refs lists every resource reference with its kind, node and key", () => {
    reset();
    const b = rb(run({ action: "refs", path: "Sounds/T.acp" }));
    expect(b.total).toBe(5);
    expect(b.byKind).toEqual({ sample: 2, mixer: 1, signal: 1, variables: 1 });
    expect(b.refs.find((r: any) => r.kind === "mixer")).toMatchObject({
      guid: "AF08E302CF8BA2E6",
      path: "Sounds/FinalMix_UI_Music.afm",
      key: "res",
      node: 6155,
      nodeName: "OutputState",
    });
    const only = rb(run({ action: "refs", path: "Sounds/T.acp", kind: "signal" }));
    expect(only.total).toBe(1);
    expect(only.refs[0].key).toBe("res");
  });

  it("variables lists the variable rows of an .acp", () => {
    reset();
    const b = rb(run({ action: "variables", path: "Sounds/T.acp" }));
    expect(b.total).toBe(1);
    expect(b.variables[0]).toMatchObject({
      name: "GRoomSize",
      local: false,
      node: 61470,
      cls: "VariableClass",
    });
    expect(b.variables[0].resource).toContain("GlobalVariables.conf");
    expect(rb(run({ action: "variables", path: "Sounds/T.acp", name: "zzz" })).total).toBe(0);
  });

  it("mixer lists the mixer nodes, their resource, inputs, connections and events", () => {
    reset();
    const b = rb(run({ action: "mixer", path: "Sounds/T.acp" }));
    expect(b.mixers).toHaveLength(1);
    expect(b.mixers[0]).toMatchObject({
      id: 6155,
      name: "OutputState",
      path: "Sounds/FinalMix_UI_Music.afm",
      inputs: ["Music", "UI"],
      events: 2,
      connections: [{ port: 22535, from: [69641, 72713] }],
    });
  });

  it("signal lists inputs with their simulated values, min and max", () => {
    reset();
    const b = rb(run({ action: "signal", path: "Sounds/T.acp" }));
    expect(b.signals).toHaveLength(1);
    expect(b.signals[0].inputs).toEqual([
      { index: 0, port: 1, value: 0, min: 0, max: 1 },
      { index: 1, port: 3, value: 0, min: 0, max: 100 },
    ]);
    expect(b.signals[0].outputs).toEqual([4]);
    expect(b.signals[0].path).toBe("Sounds/_SharedData/Signals/Blend.sig");
  });

  it("validate passes a clean file and reports the faults of a broken one", () => {
    reset();
    const good = rb(run({ action: "validate", path: "Sounds/T.acp" }));
    expect(good.valid).toBe(true);
    expect(good.errors).toBe(0);
    const broken = ACP.replace("outState 6155", "outState 999999")
      .replace(
        'ConnectionClass "73732:65" {\n       id 73732',
        'ConnectionClass "73732:65" {\n       id 555',
      )
      .replace("id 60428\n   name", "id 69641\n   name");
    put("Sounds/B.acp", broken);
    const bad = rb(run({ action: "validate", path: "Sounds/B.acp" }));
    expect(bad.valid).toBe(false);
    const rules = bad.issues.map((i: any) => i.rule);
    expect(rules).toContain("OUT_STATE");
    expect(rules).toContain("LINK_SOURCE");
    expect(rules).toContain("DUPLICATE_ID");
  });

  it("validate reports unresolved resources only when something can be checked", () => {
    reset();
    const b = rb(run({ action: "validate", path: "Sounds/T.acp" }));
    expect(b.issues.some((i: any) => i.rule === "MISSING_RESOURCE")).toBe(false);
    put("Sounds/FinalMix_UI_Music.afm", AFM);
    rmSync(join(dir, "Sounds/Samples"), { recursive: true, force: true });
    const fake = {
      exists: (p: string) => p === "Sounds/FinalMix_UI_Music.afm",
      readFile: () => Buffer.alloc(0),
      allFilePaths: () => [],
      fileSize: () => 0,
    };
    vi.spyOn(PakVirtualFS, "get").mockReturnValue(fake as unknown as PakVirtualFS);
    const v = rb(run({ action: "validate", path: "Sounds/T.acp" }));
    expect(v.issues.filter((i: any) => i.rule === "MISSING_RESOURCE").length).toBe(4);
  });
});

describe("reads on .sig, .afm and variables .conf", () => {
  it("inspect and signal read a .sig with its compiled block", () => {
    reset();
    const i = rb(run({ action: "inspect", path: "Sounds/T.sig" }));
    expect(i).toMatchObject({
      kind: "sig",
      inputs: 1,
      ops: 1,
      outputs: 1,
      compiled: { present: true, processed: 2 },
    });
    const s = rb(run({ action: "signal", path: "Sounds/T.sig" }));
    expect(s.inputs[0]).toMatchObject({
      id: 9,
      class: "IOPInputValueClass",
      name: "Trigger Time",
      value: "12000",
      children: [7],
    });
    expect(s.ops[0].inputs).toEqual([{ from: 9, port: 0, to: 0 }]);
    expect(s.outputs[0]).toMatchObject({ id: 2, input: 7 });
    expect(s.compiled).toEqual({ present: true, processed: 2, version: 2 });
    const v = rb(run({ action: "validate", path: "Sounds/T.sig" }));
    expect(v.valid).toBe(true);
    expect(v.issues[0].rule).toBe("COMPILED");
    const g = rb(run({ action: "graph", path: "Sounds/T.sig" }));
    expect(g.edges.map((e: any) => `${e.from}>${e.to}`).sort()).toEqual(["7>2", "9>7"]);
  });

  it("mixer reads the buses of an .afm", () => {
    reset();
    const b = rb(run({ action: "mixer", path: "Sounds/T.afm" }));
    expect(b.buses).toHaveLength(1);
    expect(b.buses[0]).toMatchObject({
      id: 22535,
      name: "Music",
      master: "Music",
      type: "In",
      limit: "2",
    });
    expect(b.outputs[0]).toMatchObject({ id: 220191, name: "Output Music", from: [22535] });
    const bad = run({ action: "mixer", path: "Sounds/Vars.conf" });
    if (bad.ok) throw new Error("expected a refusal");
    expect(bad.code).toBe("INVALID_ARGUMENT");
  });

  it("variables reads a variables .conf", () => {
    reset();
    const b = rb(run({ action: "variables", path: "Sounds/Vars.conf" }));
    expect(b.variables).toEqual([
      { name: "Backfire", source: "PlayTime", cls: "AudioVariableClass", section: "Variables" },
      {
        name: "GRoom",
        source: "External",
        value: "0",
        min: "0",
        max: "1",
        cls: "AudioVariableClass",
        section: "Variables",
      },
    ]);
    expect(rb(run({ action: "inspect", path: "Sounds/Vars.conf" })).variables).toBe(2);
  });

  it("refuses a .conf that is not an audio variables file, and an unknown extension", () => {
    put("Sounds/Other.conf", "SCR_Config {\n}");
    const r = run({ action: "inspect", path: "Sounds/Other.conf" });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toContain("AudioVariablesClass");
    const t = run({ action: "inspect", path: "Sounds/x.txt" });
    if (t.ok) throw new Error("expected a refusal");
    expect(t.code).toBe("INVALID_ARGUMENT");
  });

  it("refuses an action it does not know and a missing path", () => {
    const r = run({ action: "explode" as never, path: "Sounds/T.acp" });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("INVALID_ARGUMENT");
    const m = run({ action: "inspect" });
    if (m.ok) throw new Error("expected a refusal");
    expect(m.code).toBe("INVALID_ARGUMENT");
  });
});

// ── Pak paths and catalog ────────────────────────────────────────────────────

function fakeVfs(files: Record<string, string>): PakVirtualFS {
  return {
    exists: (p: string) => p in files,
    readFile: (p: string) => {
      if (!(p in files)) throw new Error("File not found in pak");
      return Buffer.from(files[p]);
    },
    allFilePaths: () => Object.keys(files),
    fileSize: (p: string) => files[p].length,
  } as unknown as PakVirtualFS;
}

describe("game paths and catalog", () => {
  it("reads a vanilla path from the paks and marks it read only", () => {
    vi.spyOn(PakVirtualFS, "get").mockReturnValue(fakeVfs({ "Sounds/Vanilla.acp": ACP }));
    const r = ok(run({ action: "events", path: "{0123456789ABCDEF}Sounds/Vanilla.acp" }));
    expect((r.readback as any).total).toBe(2);
    expect(r.warnings.join(" ")).toContain("game resource (read only)");
    expect(r.target).toBe("path:Sounds/Vanilla.acp");
  });

  it("refuses to write a game file and names game_duplicate", () => {
    vi.spyOn(PakVirtualFS, "get").mockReturnValue(fakeVfs({ "Sounds/Vanilla.acp": ACP }));
    const r = run({
      action: "set",
      path: "Sounds/Vanilla.acp",
      node: 69641,
      key: "priority",
      value: 1,
    });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("NOT_IN_PROJECT");
    expect(r.message).toContain("game_duplicate");
  });

  it("catalog merges game and project files, sniffs variables confs and filters by kind", () => {
    const cat = freshProject({
      "Sounds/T.acp": ACP,
      "Sounds/T.sig": SIG,
      "Sounds/T.afm": AFM,
      "Sounds/Vars.conf": CONF,
      "Other/NotAudio.conf": "SCR_Config {\n}",
    });
    const run = (req: Parameters<typeof runHere>[0]) => runHere({ ...req, projectPath: cat });
    vi.spyOn(PakVirtualFS, "get").mockReturnValue(
      fakeVfs({
        "Sounds/G1.acp": ACP,
        "Sounds/G2.sig": SIG,
        "Sounds/Vars/Global.conf": CONF,
        "Sounds/Vars/Other.conf": "SCR_Config {\n}",
        "Scripts/x.c": "",
      }),
    );
    const all = rb(run({ action: "catalog" }));
    expect(all.byKind).toEqual({ acp: 2, sig: 2, afm: 1, vars: 2 });
    expect(all.bySource).toEqual({ game: 3, project: 4 });
    expect(all.files.map((f: any) => f.path)).toContain("Sounds/Vars/Global.conf");
    expect(all.files.map((f: any) => f.path)).not.toContain("Other/NotAudio.conf");
    const acp = rb(run({ action: "catalog", kind: "acp" }));
    expect(acp.total).toBe(2);
    const pre = rb(run({ action: "catalog", path: "Sounds/G" }));
    expect(pre.files.map((f: any) => f.path)).toEqual(["Sounds/G1.acp", "Sounds/G2.sig"]);
    const paged = rb(run({ action: "catalog", limit: 2 }));
    expect(paged.nextCursor).toBe("2:7");
    const bad = run({ action: "catalog", kind: "zzz" });
    if (bad.ok) throw new Error("expected a refusal");
    expect(bad.code).toBe("INVALID_ARGUMENT");
  });

  it("a project file shadows the same path in the paks", () => {
    const cat = freshProject({ "Sounds/T.acp": ACP });
    vi.spyOn(PakVirtualFS, "get").mockReturnValue(fakeVfs({ "Sounds/T.acp": ACP }));
    const b = rb(runHere({ action: "catalog", kind: "acp", projectPath: cat }));
    expect(b.total).toBe(1);
    expect(b.files[0].source).toBe("project");
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

/** `edited` differs from `orig` only inside [start, end) of `orig`. */
function onlyInside(orig: string, edited: string, start: number, end: number): void {
  expect(edited.slice(0, start)).toBe(orig.slice(0, start));
  expect(edited.slice(edited.length - (orig.length - end))).toBe(orig.slice(end));
}

function spanOf(text: string, id: number): [number, number] {
  const hit = audioNodes(loadAudioModel(Buffer.from(text))).find((x) => x.id === id);
  if (!hit) throw new Error(`no node ${id}`);
  return [hit.obj.start, hit.obj.end];
}

describe("writes: guard and dry run", () => {
  it("is a dry run without confirm: a diff, no write", () => {
    reset();
    const r = ok(
      run({ action: "set", path: "Sounds/T.acp", node: 69641, key: "priority", value: 60 }),
    );
    expect(r.dryRun).toBe(true);
    expect((r.readback as any).diff).toContain("-   priority 50");
    expect((r.readback as any).diff).toContain("+   priority 60");
    expect(r.next).toContain("confirm: true");
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });

  it("writes with confirm, keeping every byte outside the edit", () => {
    reset();
    const r = ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "priority",
        value: 60,
        confirm: true,
      }),
    );
    expect(r.dryRun).toBe(false);
    expect(r.changed).toEqual([{ path: "node:69641.priority", before: "50", after: "60" }]);
    const now = disk("Sounds/T.acp");
    expect(now).toBe(ACP.replace("priority 50", "priority 60"));
    const [s, e] = spanOf(ACP, 69641);
    onlyInside(ACP, now, s, e);
  });

  it("refuses without a project, and a path outside it", () => {
    const r = runAudio(
      { action: "set", path: "Sounds/T.acp", node: 1, key: "a", value: 1 },
      makeConfig({ projectPath: "", gamePath: join(dir, "no-game") }),
    );
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("NOT_IN_PROJECT");
    const out = run({ action: "inspect", path: join(tmpdir(), "elsewhere.acp") });
    if (out.ok) throw new Error("expected a refusal");
    expect(out.code).toBe("NOT_IN_PROJECT");
    const dots = run({ action: "inspect", path: "../x.acp" });
    if (dots.ok) throw new Error("expected a refusal");
    expect(dots.code).toBe("ABSOLUTE_PATH");
  });

  it("refuses a file the writer could not keep byte for byte", () => {
    put("Sounds/U.acp", ACP.slice(0, -2));
    const r = run({ action: "set", path: "Sounds/U.acp", node: 69641, key: "priority", value: 1 });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(r.message).toContain("left alone");
    const read = ok(run({ action: "inspect", path: "Sounds/U.acp" }));
    expect(read.warnings.join(" ")).toContain("would refuse to edit");
    expect(unwritableReason(Buffer.from(ACP), "acp")).toBeUndefined();
    expect(unwritableReason(Buffer.from(ACP), "sig")).toContain("not one AudioSignalResClass");
  });

  it("refuses when the file changed between read and write is covered by the dry run, not a stale overwrite", () => {
    reset();
    const dry = ok(
      run({ action: "set", path: "Sounds/T.acp", node: 69641, key: "priority", value: 7 }),
    );
    expect(dry.dryRun).toBe(true);
    put("Sounds/T.acp", ACP.replace("priority 50", "priority 51"));
    const r = ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "priority",
        value: 7,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toContain("priority 7");
    expect(r.changed?.[0].before).toBe("51");
  });

  it("a write that changes nothing writes nothing", () => {
    reset();
    const r = ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "priority",
        value: 50,
        confirm: true,
      }),
    );
    expect(r.dryRun).toBe(true);
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });
});

describe("set", () => {
  it("sets an existing scalar, keeping its quoting, and inserts a missing key", () => {
    reset();
    ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: "SOUND_TWO",
        key: "eventType",
        value: "OnStart - Stop",
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toContain('eventType "OnStart - Stop"');
    ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "volume_dB",
        value: -3,
        confirm: true,
      }),
    );
    const now = disk("Sounds/T.acp");
    expect(now).toContain("   volume_dB -3\n  }\n");
    ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 70660,
        key: "Samples[1].Index",
        value: 4,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toContain("Index 4");
    ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "tl",
        value: [1, 2],
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toContain("   tl 1 2\n");
  });

  it("the inverse set restores the original bytes", () => {
    reset();
    ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "priority",
        value: 99,
        confirm: true,
      }),
    );
    ok(
      run({
        action: "set",
        path: "Sounds/T.acp",
        node: 69641,
        key: "priority",
        value: 50,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });

  it("refuses the id, a missing key argument, a missing value and a block", () => {
    reset();
    for (const req of [
      { node: 69641, key: "id", value: 5 },
      { node: 69641, value: 5 },
      { node: 69641, key: "priority" },
      { node: 69641, key: "bad key", value: 1 },
    ]) {
      const r = run({ action: "set", path: "Sounds/T.acp", ...req } as never);
      if (r.ok) throw new Error(`expected a refusal for ${JSON.stringify(req)}`);
      expect(r.code).toBe("INVALID_ARGUMENT");
    }
    const blk = run({ action: "set", path: "Sounds/T.acp", node: 69641, key: "ins", value: 1 });
    if (blk.ok) throw new Error("expected a refusal");
    expect(blk.code).toBe("INVALID_ARGUMENT");
    const nf = run({ action: "set", path: "Sounds/T.acp", node: 7, key: "a", value: 1 });
    if (nf.ok) throw new Error("expected a refusal");
    expect(nf.code).toBe("ITEM_NOT_FOUND");
  });

  it("edits an .afm bus and a variable of a .conf", () => {
    reset();
    ok(
      run({
        action: "set",
        path: "Sounds/T.afm",
        node: "Music",
        key: "limit",
        value: 3,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.afm")).toContain("limit 3");
    ok(
      run({
        action: "set",
        path: "Sounds/Vars.conf",
        node: "GRoom",
        key: "value_max",
        value: 5,
        confirm: true,
      }),
    );
    expect(disk("Sounds/Vars.conf")).toContain("value_max 5");
  });
});

describe("renameEvent", () => {
  it("renames by name or id and the inverse restores the bytes", () => {
    reset();
    const r = ok(
      run({
        action: "renameEvent",
        path: "Sounds/T.acp",
        event: "SOUND_ONE",
        name: "SOUND_UNO",
        confirm: true,
      }),
    );
    expect(r.changed).toEqual([
      { path: "event:69641.name", before: "SOUND_ONE", after: "SOUND_UNO" },
    ]);
    expect(r.warnings.join(" ")).toContain("scripts");
    const now = disk("Sounds/T.acp");
    expect(now).toBe(ACP.replace('"SOUND_ONE"', '"SOUND_UNO"'));
    const [s, e] = spanOf(ACP, 69641);
    onlyInside(ACP, now, s, e + 0);
    ok(
      run({
        action: "renameEvent",
        path: "Sounds/T.acp",
        event: 69641,
        name: "SOUND_ONE",
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });

  it("refuses an unknown event (EVENT_NOT_FOUND), a clash and a bad name", () => {
    reset();
    const nf = run({ action: "renameEvent", path: "Sounds/T.acp", event: "NOPE", name: "X" });
    if (nf.ok) throw new Error("expected a refusal");
    expect(nf.code).toBe("EVENT_NOT_FOUND");
    expect(nf.next).toContain("audio events");
    const clash = run({
      action: "renameEvent",
      path: "Sounds/T.acp",
      event: "SOUND_ONE",
      name: "SOUND_TWO",
    });
    if (clash.ok) throw new Error("expected a refusal");
    expect(clash.code).toBe("DUPLICATE_ID");
    const q = run({ action: "renameEvent", path: "Sounds/T.acp", event: "SOUND_ONE", name: 'a"b' });
    if (q.ok) throw new Error("expected a refusal");
    expect(q.code).toBe("INVALID_ARGUMENT");
    const none = run({ action: "renameEvent", path: "Sounds/T.acp", name: "X" });
    if (none.ok) throw new Error("expected a refusal");
    expect(none.code).toBe("INVALID_ARGUMENT");
    const sig = run({ action: "renameEvent", path: "Sounds/T.afm", event: "x", name: "y" });
    if (sig.ok) throw new Error("expected a refusal");
    expect(sig.code).toBe("INVALID_ARGUMENT");
  });
});

describe("addSample, removeSample, setSample", () => {
  it("adds a sample with an explicit GUID, then removes it, restoring the bytes", () => {
    reset();
    const r = ok(
      run({
        action: "addSample",
        path: "Sounds/T.acp",
        bank: "Menu",
        file: "{0123456789ABCDEF}Sounds/Samples/c.wav",
        probability: 50,
        index: 2,
        confirm: true,
      }),
    );
    expect(r.changed?.[0].path).toBe("bank:73732.Samples");
    const now = disk("Sounds/T.acp");
    expect(now).toContain('AudioBankSampleClass "c.wav" {');
    expect(now).toContain('Filename "{0123456789ABCDEF}Sounds/Samples/c.wav"');
    expect(now).toContain("Probability 50");
    const [s, e] = spanOf(ACP, 73732);
    onlyInside(ACP, now, s, e);
    expect(
      rb(run({ action: "samples", path: "Sounds/T.acp", bank: "Menu" })).samples[0],
    ).toMatchObject({ name: "c.wav", index: 2, probability: 50, guid: "0123456789ABCDEF" });
    const rm = ok(
      run({
        action: "removeSample",
        path: "Sounds/T.acp",
        bank: "Menu",
        sample: "c.wav",
        confirm: true,
      }),
    );
    expect(rm.warnings.join(" ")).toContain("plays nothing");
    // An empty Samples block stays where the add created it; the original had none.
    expect(rb(run({ action: "samples", path: "Sounds/T.acp", bank: "Menu" })).total).toBe(0);
    expect(disk("Sounds/T.acp")).toContain("Samples {\n   }");
  });

  it("adding to a bank that has samples and removing it restores the bytes exactly", () => {
    reset();
    ok(
      run({
        action: "addSample",
        path: "Sounds/T.acp",
        bank: 70660,
        file: "{0123456789ABCDEF}Sounds/Samples/c.wav",
        confirm: true,
      }),
    );
    const [s, e] = spanOf(ACP, 70660);
    onlyInside(ACP, disk("Sounds/T.acp"), s, e);
    ok(
      run({
        action: "removeSample",
        path: "Sounds/T.acp",
        bank: 70660,
        sample: "c.wav",
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });

  it("takes the GUID from the project's .meta of a registered file", () => {
    reset();
    put(
      "Sounds/Samples/d.wav.meta",
      'MetaFileClass {\n Name "{FEDCBA9876543210}Sounds/Samples/d.wav"\n}',
    );
    ok(
      run({
        action: "addSample",
        path: "Sounds/T.acp",
        bank: 70660,
        file: "Sounds/Samples/d.wav",
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toContain('Filename "{FEDCBA9876543210}Sounds/Samples/d.wav"');
  });

  it("refuses a file without a GUID, a duplicate name, a non-bank and a bad index", () => {
    reset();
    const noGuid = run({
      action: "addSample",
      path: "Sounds/T.acp",
      bank: 70660,
      file: "Sounds/Samples/zz.wav",
    });
    if (noGuid.ok) throw new Error("expected a refusal");
    expect(noGuid.code).toBe("INVALID_ARGUMENT");
    expect(noGuid.message).toContain("wb_resources register");
    const dup = run({
      action: "addSample",
      path: "Sounds/T.acp",
      bank: 70660,
      file: "{0123456789ABCDEF}Sounds/Samples/a.snd",
    });
    if (dup.ok) throw new Error("expected a refusal");
    expect(dup.code).toBe("DUPLICATE_ID");
    const nb = run({
      action: "addSample",
      path: "Sounds/T.acp",
      bank: 69641,
      file: "{0123456789ABCDEF}x/y.wav",
    });
    if (nb.ok) throw new Error("expected a refusal");
    expect(nb.code).toBe("ITEM_NOT_FOUND");
    const idx = run({
      action: "addSample",
      path: "Sounds/T.acp",
      bank: 70660,
      file: "{0123456789ABCDEF}x/y.wav",
      index: -1,
    });
    if (idx.ok) throw new Error("expected a refusal");
    expect(idx.code).toBe("INVALID_ARGUMENT");
    const gu = run({
      action: "addSample",
      path: "Sounds/T.acp",
      bank: 70660,
      file: "x/y.wav",
      guid: "xyz",
    });
    if (gu.ok) throw new Error("expected a refusal");
    expect(gu.code).toBe("INVALID_ARGUMENT");
    const odd = ok(
      run({
        action: "addSample",
        path: "Sounds/T.acp",
        bank: 70660,
        file: "{0123456789ABCDEF}x/y.mp3",
      }),
    );
    expect(odd.warnings.join(" ")).toContain("not a .wav or .snd");
  });

  it("removeSample by position, and refuses an unknown sample", () => {
    reset();
    ok(
      run({ action: "removeSample", path: "Sounds/T.acp", bank: 70660, sample: 0, confirm: true }),
    );
    expect(
      rb(run({ action: "samples", path: "Sounds/T.acp", bank: 70660 })).samples.map(
        (s: any) => s.name,
      ),
    ).toEqual(["b.snd"]);
    const r = run({
      action: "removeSample",
      path: "Sounds/T.acp",
      bank: 70660,
      sample: "nope.snd",
    });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("ITEM_NOT_FOUND");
    const m = run({ action: "removeSample", path: "Sounds/T.acp", bank: 70660 });
    if (m.ok) throw new Error("expected a refusal");
    expect(m.code).toBe("INVALID_ARGUMENT");
  });

  it("setSample changes Filename, Index and Probability, and the inverse restores the bytes", () => {
    reset();
    const r = ok(
      run({
        action: "setSample",
        path: "Sounds/T.acp",
        bank: 70660,
        sample: "b.snd",
        file: "{0123456789ABCDEF}Sounds/Samples/z.snd",
        index: 9,
        probability: 10,
        confirm: true,
      }),
    );
    expect(r.changed).toHaveLength(3);
    const now = disk("Sounds/T.acp");
    expect(now).toContain('Filename "{0123456789ABCDEF}Sounds/Samples/z.snd"');
    expect(now).toContain("Index 9");
    expect(now).toContain("Probability 10");
    const [s, e] = spanOf(ACP, 70660);
    onlyInside(ACP, now, s, e);
    ok(
      run({
        action: "setSample",
        path: "Sounds/T.acp",
        bank: 70660,
        sample: "b.snd",
        file: "{03CA1F966EAAC1B5}Sounds/Samples/b.snd",
        index: 3,
        probability: 70,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toBe(ACP);
    const none = run({ action: "setSample", path: "Sounds/T.acp", bank: 70660, sample: "b.snd" });
    if (none.ok) throw new Error("expected a refusal");
    expect(none.code).toBe("INVALID_ARGUMENT");
    // A new key (Probability on a sample without one) is appended.
    ok(
      run({
        action: "setSample",
        path: "Sounds/T.acp",
        bank: 70660,
        sample: "a.snd",
        probability: 25,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toContain("Probability 25");
  });
});

describe("setSimValue", () => {
  it("sets the value, min and max of an input port of a signal, touching only that number", () => {
    reset();
    const r = ok(
      run({
        action: "setSimValue",
        path: "Sounds/T.acp",
        node: "Blend",
        port: 3,
        value: 42,
        min: -1,
        max: 200,
        confirm: true,
      }),
    );
    expect(r.changed).toEqual([
      { path: "signal:59405.inputvalues[1]", before: "0", after: "42" },
      { path: "signal:59405.inputvaluesmin[1]", before: "0", after: "-1" },
      { path: "signal:59405.inputvaluesmax[1]", before: "100", after: "200" },
    ]);
    const now = disk("Sounds/T.acp");
    expect(now).toContain("    0 42\n");
    expect(now).toContain("    0 -1\n");
    expect(now).toContain("    1 200\n");
    const [s, e] = spanOf(ACP, 59405);
    onlyInside(ACP, now, s, e);
    ok(
      run({
        action: "setSimValue",
        path: "Sounds/T.acp",
        node: 59405,
        index: 1,
        value: 0,
        min: 0,
        max: 100,
        confirm: true,
      }),
    );
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });

  it("refuses an unknown port, a missing port and index, no field, a non-signal and a bad number", () => {
    reset();
    for (const req of [
      { node: "Blend", port: 9, value: 1 },
      { node: "Blend", value: 1 },
      { node: "Blend", port: 1 },
      { node: "Blend", index: 5, value: 1 },
      { node: 69641, port: 1, value: 1 },
      { node: "Blend", port: 1, value: Number.NaN },
    ]) {
      const r = run({ action: "setSimValue", path: "Sounds/T.acp", ...req } as never);
      if (r.ok) throw new Error(`expected a refusal for ${JSON.stringify(req)}`);
      expect(r.code).toBe("INVALID_ARGUMENT");
    }
  });
});

describe("addVariable and removeVariable", () => {
  it("adds a variable in the vanilla shape and removes it again", () => {
    reset();
    const r = ok(
      run({
        action: "addVariable",
        path: "Sounds/Vars.conf",
        name: "Wind",
        source: "External",
        value: 0.5,
        min: 0,
        max: 2,
        confirm: true,
      }),
    );
    expect(r.changed?.[0].path).toBe("variable:Wind");
    const now = disk("Sounds/Vars.conf");
    expect(now).toContain(
      "  AudioVariableClass Wind {\n   source External\n   value 0.5\n   value_min 0\n   value_max 2\n  }\n",
    );
    const [s] = [CONF.indexOf(" Variables {")];
    expect(now.slice(0, s)).toBe(CONF.slice(0, s));
    expect(
      rb(run({ action: "variables", path: "Sounds/Vars.conf", name: "wind" })).variables[0],
    ).toMatchObject({ name: "Wind", source: "External", value: "0.5" });
    ok(run({ action: "removeVariable", path: "Sounds/Vars.conf", name: "Wind", confirm: true }));
    expect(disk("Sounds/Vars.conf")).toBe(CONF);
  });

  it("adds an op and a bare variable, and warns about an unusual source", () => {
    reset();
    const r = ok(
      run({
        action: "addVariable",
        path: "Sounds/Vars.conf",
        name: "Loud",
        source: "Amplitude",
        varOp: "Max",
        confirm: true,
      }),
    );
    expect(disk("Sounds/Vars.conf")).toContain("   source Amplitude\n   op Max\n");
    expect(r.warnings).toEqual([]);
    const w = ok(
      run({ action: "addVariable", path: "Sounds/Vars.conf", name: "Odd", source: "Weird" }),
    );
    expect(w.warnings.join(" ")).toContain("not one the vanilla files use");
    ok(run({ action: "addVariable", path: "Sounds/Vars.conf", name: "Plain", confirm: true }));
    expect(disk("Sounds/Vars.conf")).toContain("  AudioVariableClass Plain {\n  }");
  });

  it("creates the Variables block when a conf has none", () => {
    put("Sounds/Empty.conf", "AudioVariablesClass {\n}");
    ok(
      run({
        action: "addVariable",
        path: "Sounds/Empty.conf",
        name: "A",
        source: "PlayTime",
        confirm: true,
      }),
    );
    expect(disk("Sounds/Empty.conf")).toContain(
      " Variables {\n  AudioVariableClass A {\n   source PlayTime\n  }\n }",
    );
  });

  it("refuses a duplicate, a bad name, a missing variable (VARIABLE_NOT_FOUND) and an .acp", () => {
    reset();
    const dup = run({ action: "addVariable", path: "Sounds/Vars.conf", name: "Backfire" });
    if (dup.ok) throw new Error("expected a refusal");
    expect(dup.code).toBe("DUPLICATE_ID");
    const name = run({ action: "addVariable", path: "Sounds/Vars.conf", name: "1x" });
    if (name.ok) throw new Error("expected a refusal");
    expect(name.code).toBe("INVALID_ARGUMENT");
    const nf = run({ action: "removeVariable", path: "Sounds/Vars.conf", name: "Zip" });
    if (nf.ok) throw new Error("expected a refusal");
    expect(nf.code).toBe("VARIABLE_NOT_FOUND");
    expect(nf.next).toContain("audio variables");
    const acp = run({ action: "addVariable", path: "Sounds/T.acp", name: "A" });
    if (acp.ok) throw new Error("expected a refusal");
    expect(acp.code).toBe("INVALID_ARGUMENT");
    const src = run({
      action: "addVariable",
      path: "Sounds/Vars.conf",
      name: "B",
      source: "two words",
    });
    if (src.ok) throw new Error("expected a refusal");
    expect(src.code).toBe("INVALID_ARGUMENT");
  });
});

describe("create", () => {
  it("is a dry run, then writes a skeleton of each kind that reads back clean", () => {
    for (const [rel, kind] of [
      ["New/A.acp", "acp"],
      ["New/B.afm", "afm"],
      ["New/C.conf", "vars"],
    ] as const) {
      const dry = ok(run({ action: "create", path: rel }));
      expect(dry.dryRun).toBe(true);
      expect(existsSync(join(dir, rel))).toBe(false);
      const w = ok(run({ action: "create", path: rel, confirm: true }));
      expect(w.next).toContain("wb_resources register");
      expect(disk(rel)).toBe(skeleton(kind));
      expect(unwritableReason(readFileSync(join(dir, rel)), kind)).toBeUndefined();
      expect(rb(run({ action: "validate", path: rel })).valid).toBe(true);
    }
  });

  it("refuses an existing file unless overwrite, and creates the parent folders", () => {
    reset();
    const r = run({ action: "create", path: "Sounds/T.acp", confirm: true });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("INVALID_ARGUMENT");
    ok(run({ action: "create", path: "Sounds/T.acp", overwrite: true, confirm: true }));
    expect(disk("Sounds/T.acp")).toBe(skeleton("acp"));
    ok(run({ action: "create", path: "Deep/er/folder/X.acp", confirm: true }));
    expect(existsSync(join(dir, "Deep/er/folder/X.acp"))).toBe(true);
  });

  it("overwrite replaces only an audio file of that kind, and keeps a backup (review W5-01)", () => {
    reset();
    const faction = 'SCR_Faction {\n FactionKey "MY"\n}\n';
    mkdirSync(join(dir, "Configs/Factions"), { recursive: true });
    writeFileSync(join(dir, "Configs/Factions/MyFaction.conf"), faction);
    const r = run({
      action: "create",
      path: "Configs/Factions/MyFaction.conf",
      overwrite: true,
      confirm: true,
    });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(disk("Configs/Factions/MyFaction.conf")).toBe(faction);
    expect(existsSync(join(dir, "Configs/Factions/MyFaction.conf.bak"))).toBe(false);
    // An audio file of the kind is replaced, its old bytes kept as a numbered backup.
    for (const b of ["", "2", "3"]) rmSync(join(dir, `Sounds/T.acp.bak${b}`), { force: true });
    const old = disk("Sounds/T.acp");
    const w = ok(run({ action: "create", path: "Sounds/T.acp", overwrite: true, confirm: true }));
    expect(rb(w).backup).toBe("Sounds/T.acp.bak");
    expect(readFileSync(join(dir, "Sounds/T.acp.bak"), "utf-8")).toBe(old);
    const w2 = ok(run({ action: "create", path: "Sounds/T.acp", overwrite: true, confirm: true }));
    expect(rb(w2).backup).toBe("Sounds/T.acp.bak2");
    expect(readFileSync(join(dir, "Sounds/T.acp.bak"), "utf-8")).toBe(old);
  });

  it("a created file takes the edits the tool offers", () => {
    ok(run({ action: "create", path: "New/V.conf", confirm: true }));
    ok(
      run({
        action: "addVariable",
        path: "New/V.conf",
        name: "Z",
        source: "Constant",
        value: 1,
        confirm: true,
      }),
    );
    expect(rb(run({ action: "variables", path: "New/V.conf" })).total).toBe(1);
  });
});

describe("missing files", () => {
  it("answers PATH_NOT_FOUND for a read and a write on a file that is nowhere", () => {
    const r = run({ action: "inspect", path: "Sounds/Gone.acp" });
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("PATH_NOT_FOUND");
    const w = run({ action: "set", path: "Sounds/Gone.acp", node: 1, key: "a", value: 1 });
    if (w.ok) throw new Error("expected a refusal");
    expect(w.code).toBe("PATH_NOT_FOUND");
    expect(w.message).toContain("create makes a new one");
  });
});

// ── Gates ────────────────────────────────────────────────────────────────────

describe(".sig writes (DEC-068 OD-9)", () => {
  it("refuses every write on a .sig with READ_ONLY_SOURCE, even a dry run and create", () => {
    reset();
    for (const req of [
      { action: "set", node: 9, key: "value", value: 1 },
      { action: "setSimValue", node: 9, value: 1 },
      { action: "set", node: 9, key: "value", value: 1, confirm: true },
      { action: "create", confirm: true, overwrite: true },
      { action: "addVariable", name: "A" },
    ]) {
      const r = run({ path: "Sounds/T.sig", ...req } as never);
      if (r.ok) throw new Error(`expected a refusal for ${JSON.stringify(req)}`);
      expect(r.code).toBe("READ_ONLY_SOURCE");
      expect(r.message).toContain("P-W5-04");
    }
    expect(disk("Sounds/T.sig")).toBe(SIG);
    // Reads stay open.
    expect(ok(run({ action: "signal", path: "Sounds/T.sig" })).ok).toBe(true);
  });

  it("with the switch on, a .sig with a compiled block refuses SIG_COMPILED_STALE unless acceptStale", () => {
    reset();
    const gates: AudioGates = { sigWrites: true, graphActions: false };
    const r = run(
      { action: "setSimValue", path: "Sounds/T.sig", node: 9, value: 5, confirm: true },
      gates,
    );
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("SIG_COMPILED_STALE");
    expect(r.next).toContain("acceptStale");
    expect(disk("Sounds/T.sig")).toBe(SIG);
    const w = ok(
      run(
        {
          action: "setSimValue",
          path: "Sounds/T.sig",
          node: 9,
          value: 5,
          min: 1,
          max: 9,
          acceptStale: true,
          confirm: true,
        },
        gates,
      ),
    );
    expect(w.warnings.join(" ")).toContain("compiled block was not regenerated");
    const now = disk("Sounds/T.sig");
    expect(now).toContain("value 5\n");
    expect(now).toContain("valueMin 1");
    expect(now).toContain("valueMax 9");
    const [s, e] = spanOf(SIG, 9);
    onlyInside(SIG, now, s, e);
    // A .sig without a compiled block is written without the flag.
    put("Sounds/N.sig", SIG.replace(/ compiled IOPCompiledClass \{[\s\S]*?\n \}\n/, ""));
    ok(
      run(
        { action: "set", path: "Sounds/N.sig", node: 9, key: "value", value: 1, confirm: true },
        gates,
      ),
    );
  });
});

describe("graph actions (DEC-068 OD-10)", () => {
  it("refuse UNPROVEN while the switch is off, before they look at the path", () => {
    reset();
    for (const a of GRAPH_ACTIONS) {
      const r = run({ action: a, path: "Sounds/Nowhere.acp", args: {}, confirm: true });
      if (r.ok) throw new Error(`${a} should be refused`);
      expect(r.code).toBe("UNPROVEN");
      expect(r.message).toContain("P-W5-05");
    }
    expect(disk("Sounds/T.acp")).toBe(ACP);
  });

  it("with the switch on, go through the one dispatch with the file's model and the confirm flag", () => {
    reset();
    const calls: { op: string; args: unknown; confirm: unknown; kind: string }[] = [];
    const dispatch: GraphDispatch = (model, op, args, options) => {
      calls.push({ op, args, confirm: options.confirm, kind: model.kind });
      model.doc = new CstDocument(model.doc.text.replace("priority 50", "priority 51"), "utf8");
      return {
        ok: true,
        changed: [{ path: "node:69641", before: 50, after: 51 }],
        warnings: ["w1"],
      };
    };
    const gates: AudioGates = { sigWrites: false, graphActions: true };
    const dry = runAudio(
      { action: "addNode", path: "Sounds/T.acp", projectPath: dir, args: { class: "SoundClass" } },
      cfg(),
      gates,
      dispatch,
    );
    expect(ok(dry).dryRun).toBe(true);
    expect(disk("Sounds/T.acp")).toBe(ACP);
    const w = runAudio(
      {
        action: "connect",
        path: "Sounds/T.acp",
        projectPath: dir,
        args: { from: 1 },
        confirm: true,
      },
      cfg(),
      gates,
      dispatch,
    );
    expect(ok(w).changed).toEqual([{ path: "node:69641", before: 50, after: 51 }]);
    expect(ok(w).warnings).toEqual(["w1"]);
    expect(disk("Sounds/T.acp")).toContain("priority 51");
    expect(calls).toEqual([
      { op: "addNode", args: { class: "SoundClass" }, confirm: false, kind: "acp" },
      { op: "connect", args: { from: 1 }, confirm: true, kind: "acp" },
    ]);
  });

  it("a refusal of the dispatch comes back with its own code and next step", () => {
    reset();
    const dispatch: GraphDispatch = () => ({
      ok: false,
      code: "GATED",
      message: "not yet",
      next: "see P-W5-05",
    });
    const r = runAudio(
      { action: "group", path: "Sounds/T.acp", projectPath: dir, args: {} },
      cfg(),
      { sigWrites: false, graphActions: true },
      dispatch,
    );
    if (r.ok) throw new Error("expected a refusal");
    expect(r.code).toBe("GATED");
    expect(r.next).toBe("see P-W5-05");
    const thrown: GraphDispatch = () => {
      throw new Error("boom");
    };
    const t = runAudio(
      { action: "group", path: "Sounds/T.acp", projectPath: dir, args: {} },
      cfg(),
      { sigWrites: false, graphActions: true },
      thrown,
    );
    if (t.ok) throw new Error("expected a refusal");
    expect(t.code).toBe("INVALID_ARGUMENT");
    expect(t.message).toBe("boom");
    const sig = runAudio(
      { action: "connect", path: "Sounds/T.sig", projectPath: dir, args: {} },
      cfg(),
      { sigWrites: false, graphActions: true },
      dispatch,
    );
    if (sig.ok) throw new Error("expected a refusal");
    expect(sig.code).toBe("READ_ONLY_SOURCE");
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/audio.catalog
// census:mcp:action/audio.create
// census:mcp:action/audio.events
// census:mcp:action/audio.graph
// census:mcp:action/audio.inspect
// census:mcp:action/audio.mixer
// census:mcp:action/audio.node
// census:mcp:action/audio.nodes
// census:mcp:action/audio.refs
// census:mcp:action/audio.samples
// census:mcp:action/audio.signal
// census:mcp:action/audio.validate
// census:mcp:action/audio.variables
