/**
 * EMCP_WB_Anim.c (wave W4, phase5-w4-spec.md section 2.1, DEC-067) checked over its Enforce text
 * offline: the contract matches the structs and the per-action reads and writes, every engine call is
 * the one the spec's action table names, the held owner item OI-W4-1 refuses every txa* action before
 * any TxaExporter call, check and the txaEdit write stay gated on their probes, every write sits
 * behind the project guard and a dry run, and no forbidden call is made. Nothing here talks to
 * Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { checkedDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Anim.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const CONTRACT_FILE = join("contracts", "EMCP_WB_Anim.json");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(CONTRACT_FILE);
const rawContract = JSON.parse(readFileSync(CONTRACT_FILE, "utf-8")) as Record<string, unknown>;
const other = (name: string) => readFileSync(join(DIR, `EMCP_WB_${name}.c`), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `<type> <name>(` (static or not) up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`\\b\\w+ ${name}\\([^)]*\\)\\r?\\n\\t\\{`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const classEnd = s.slice(at).search(/\r?\n}\r?\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return code(s.slice(at, ends.length ? Math.min(...ends) : undefined));
}

const C = code(src);
const NO_STRINGS = C.replace(/"[^"\n]*"/g, '""');

/** Action -> the method its dispatch branch calls. */
const METHOD: Record<string, string> = {
  txaProfiles: "TxaProfiles",
  txaChannels: "TxaChannels",
  txaRead: "TxaRead",
  check: "Check",
  txaExport: "TxaExport",
  txaEdit: "TxaEdit",
};
const READS = ["txaProfiles", "txaChannels", "txaRead"];
const WRITES = ["txaExport", "txaEdit"];
const TXA = ["txaProfiles", "txaChannels", "txaRead", "txaExport", "txaEdit"];

/** The 23 TxaExporter methods of the 1.9.0.37 index (TxaExporter.c). */
const TXA_EXPORTER = [
  "ErrCode",
  "ErrMsg",
  "GetNumProfiles",
  "GetProfileChannelCount",
  "GetProfileChannelGenFn",
  "GetProfileChannelName",
  "GetProfileIndex",
  "GetProfileName",
  "LoadProfiles",
  "TrackAddAudioEvent",
  "TrackAddGenericEvent",
  "TrackAddWeightedEvent",
  "TrackClearCustomProperties",
  "TrackEditEvent",
  "TrackEraseEvent",
  "TrackExport",
  "TrackGetCustomProperty",
  "TrackGetEvent",
  "TrackGetEventCount",
  "TrackLoad",
  "TrackReset",
  "TrackSetChannels",
  "TrackSetCustomProperty",
];
/** The TxaExporter calls that change a track or write a file. */
const TRACK_WRITES = [
  "TrackAddGenericEvent",
  "TrackAddAudioEvent",
  "TrackAddWeightedEvent",
  "TrackEditEvent",
  "TrackEraseEvent",
  "TrackSetCustomProperty",
  "TrackClearCustomProperties",
  "TrackReset",
  "TrackSetChannels",
  "TrackExport",
];

describe("EMCP_WB_Anim structs and contract", () => {
  it("is promoted to contracts/ with the local schema path", () => {
    expect(rawContract.$schema).toBe("./_schema/contract.schema.json");
    expect(contract.handler).toBe("EMCP_WB_Anim");
    expect(contract.tool).toBe("wb_anim");
    expect(contract.source).toBe("mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Anim.c");
  });

  it("request and response RegV keys are the contract's, in order", () => {
    expect(regVKeys(src, "EMCP_WB_AnimRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_AnimResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches every contract action, each to its own method, and nothing else", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*(\w+)\(req, resp\)/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2], m[1]).toBe(METHOD[m[1]]);
  });

  it("reads are read-only; check opens a file; the two writes are project-only; txaRead pages", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(!READS.includes(a.name));
      expect(a.projectOnly, a.name).toBe(WRITES.includes(a.name));
      expect(a.paging, a.name).toBe(a.name === "txaRead");
      const keys = a.params.map((p) => p.key);
      expect(keys.includes("confirm"), a.name).toBe(WRITES.includes(a.name));
    }
  });

  it("every action states its by-design refusal", () => {
    for (const a of contract.actions) {
      expect(a.refuses, a.name).toBeTruthy();
      if (TXA.includes(a.name)) expect(a.refuses, a.name).toContain("OI-W4-1");
    }
    const byName = Object.fromEntries(contract.actions.map((a) => [a.name, a]));
    expect(byName.check.refuses).toContain("P-W4-14");
    expect(byName.txaEdit.refuses).toContain("P-W4-06");
  });

  it("no key is a reserved word or named type", () => {
    for (const k of [...contract.request, ...contract.response])
      expect(["type", "Wait", "vanilla", "proto", "class", "out", "ref"], k).not.toContain(k);
  });

  it("keeps the tool description within its 400-char budget", () => {
    expect(checkedDescription(contract).length).toBeLessThanOrEqual(400);
  });
});

describe("forbidden calls and names", () => {
  it("no FindFiles, Dialog, RunCmd, RunCommandline, RunProcess, Configure, FileIO or GetMetaFileFromString", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "FileIO",
      "Workbench.Dialog",
      "RunCmd",
      "RunCommandline",
      "RunProcess",
      "Configure(",
      "GetMetaFileFromString",
      "SetOpenedResource",
      "SaveContainer",
      "OpenResource(",
    ]) {
      expect(NO_STRINGS, banned).not.toContain(banned);
    }
  });

  it("fetches one module only, the Resource Manager, and only in txaExport after the write", () => {
    const modules = [...C.matchAll(/Workbench\.GetModule\((\w+)\)/g)].map((m) => m[1]);
    expect(modules).toEqual(["ResourceManager"]);
    const body = method(src, "TxaExport");
    expect(body.indexOf("Workbench.GetModule(ResourceManager)")).toBeGreaterThan(
      body.indexOf("Outcome(exporter, exporter.TrackExport())"),
    );
  });

  it("names no sandbox and no project", () => {
    expect(src).not.toMatch(/EMCP2_sandbox|_throwaway|sandbox/i);
  });

  it("uses no ternary operator", () => {
    expect(NO_STRINGS).not.toContain("?");
  });

  it("declares no identifier named Wait, vanilla or proto", () => {
    expect(NO_STRINGS).not.toMatch(/\b(?:\w+\s+)(Wait|vanilla|proto)\s*[=;,)]/);
    expect(NO_STRINGS).not.toMatch(/\bstring type\b|\bint type\b/);
  });

  it("carries engine pointers in return values and members, never through an out parameter", () => {
    expect(C).not.toMatch(
      /out\s+(TxaExporter|BaseContainer|MetaFile|ResourceManager|EMCP_WB_AnimProfile)\b/,
    );
    expect(C).toContain("static EMCP_WB_AnimProfile PickProfile(");
  });
});

describe("OI-W4-1: no profile, no TXA call (DEC-067)", () => {
  it("NoProfile refuses RESOURCE_NOT_FOUND with the owner step in next", () => {
    expect(method(src, "NoProfile")).toContain(
      "Answer(resp, EMCP_WB_Guard.REFUSED, RESOURCE_NOT_FOUND,",
    );
    expect(method(src, "NoProfile")).toContain("OWNER_STEP);");
    expect(src).toMatch(/static const string OWNER_STEP = "owner step OI-W4-1: [^"]*\.apr[^"]*";/);
  });

  for (const a of TXA) {
    it(`${a}: finds profiles and refuses on none before any TxaExporter`, () => {
      const body = method(src, METHOD[a]);
      const find = body.search(/FindProfiles\(/);
      const none = body.search(/if \(found\.Count\(\) == 0\)\s*\{[^}]*NoProfile\(resp,/);
      const first = body.indexOf("new TxaExporter()");
      expect(find, a).toBeGreaterThanOrEqual(0);
      expect(none, a).toBeGreaterThan(find);
      expect(first, a).toBeGreaterThan(none);
    });
  }

  it("profiles are found with SearchResources under a $<addon>: root and the apr extension", () => {
    const body = method(src, "FindProfiles");
    expect(body).toContain("GameProject.GetLoadedAddons(loaded)");
    expect(body).toContain("GameProject.GetAddonID(addonGuid)");
    expect(body).toContain('filter.rootPath = "$" + addonId + ":";');
    expect(body).toContain("array<string> extensions = {APR_EXTENSION};");
    expect(body).toContain("ResourceDatabase.SearchResources(filter, CollectApr)");
    expect(src).toContain('static const string APR_EXTENSION = "apr";');
  });

  it("nothing writes a profile: no .apr target and no container save", () => {
    expect(NO_STRINGS).not.toMatch(/Save\(|CreateContainer/);
    expect(C).not.toMatch(/TrackReset\([^)]*\.apr/);
  });

  it("a profile resolves to its absolute folder and stem; the response shows $<addon>:<path>", () => {
    const body = method(src, "AddProfile");
    expect(body).toContain('Workbench.GetAbsolutePath("$" + addonId + ":" + rel, absolute, true)');
    expect(body).toContain("Workbench.GetAbsolutePath(hit, absolute, false)");
    expect(body).toContain("p.m_Folder = FilePath.StripFileName(absolute);");
    expect(body).toContain("p.m_Name = FilePath.StripExtension(FilePath.StripPath(absolute));");
    expect(body).toContain('p.m_Shown = "$" + addonId + ":" + rel;');
    expect(body).toContain("p.m_Shown = EMCP_WB_Guard.ScrubHome(absolute);");
  });
});

describe("engine calls are the spec's (section 2.1)", () => {
  it("uses every TxaExporter method of the index, and no other", () => {
    for (const m of TXA_EXPORTER) expect(C, m).toMatch(new RegExp(`\\.${m}\\(`));
    const called = new Set([...C.matchAll(/\b(?:exporter|reread)\.(\w+)\(/g)].map((m) => m[1]));
    expect([...called].sort()).toEqual([...TXA_EXPORTER].sort());
  });

  it("every TxaExporter answer goes through Outcome, which also reads ErrCode", () => {
    const outcome = method(src, "Outcome");
    expect(outcome).toContain("TxaErrCode recorded = exporter.ErrCode();");
    const answering = [
      "LoadProfiles",
      "TrackLoad",
      "TrackReset",
      "TrackSetChannels",
      "TrackExport",
      "TrackAddGenericEvent",
      "TrackAddAudioEvent",
      "TrackAddWeightedEvent",
      "TrackEraseEvent",
      "TrackSetCustomProperty",
      "TrackClearCustomProperties",
    ];
    for (const m of answering) {
      const calls = [...C.matchAll(new RegExp(`\\.${m}\\(`, "g"))].length;
      const wrapped = [...C.matchAll(new RegExp(`Outcome\\((exporter|reread), \\1\\.${m}\\(`, "g"))]
        .length;
      expect(calls, m).toBeGreaterThan(0);
      expect(wrapped, m).toBe(calls);
    }
    expect(src).toMatch(/if \(err == TxaErrCode\.TXAERR_ERROR\)/);
    expect(src).toContain('static const string TXA_ERROR = "TXA_ERROR";');
  });

  const CALLS: Record<string, string[]> = {
    txaProfiles: [
      "FindProfiles(req.addon, found, resp.warnings, why)",
      "exporter.LoadProfiles(folderAbs)",
      "exporter.GetNumProfiles()",
      "exporter.GetProfileName(i)",
      "exporter.GetProfileChannelCount(i)",
    ],
    txaChannels: [
      "PickProfile(req.profile, found, matches)",
      "exporter.LoadProfiles(p.m_Folder)",
      "exporter.GetProfileIndex(p.m_Name)",
      "exporter.GetProfileChannelCount(profileIndex)",
      "exporter.GetProfileChannelName(profileIndex, c)",
      "exporter.GetProfileChannelGenFn(profileIndex, c)",
    ],
    txaRead: [
      "Workbench.GetAbsolutePath(clean, absolute, true)",
      "exporter.TrackLoad(absolute, req.hint)",
      "exporter.TrackGetEventCount()",
      "EventText(i, exporter.TrackGetEvent(i))",
      "exporter.TrackGetCustomProperty(propKey)",
    ],
    check: ["EMCP_WB_OpenResource.OwnerOf(clean)"],
    txaExport: [
      "EMCP_WB_Guard.NewTargetInProject(clean, absolute, why)",
      "exporter.LoadProfiles(p.m_Folder)",
      "exporter.GetProfileIndex(p.m_Name)",
      "exporter.GetProfileChannelCount(profileIndex)",
      "exporter.TrackReset(profileIndex, req.frames, req.fps, req.source, absolute)",
      "exporter.TrackSetChannels(req.channelCount, req.frames, keys, diffs)",
      "exporter.TrackExport()",
      "resourceManager.RegisterResourceFile(absolute, false)",
      "EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute)",
      "resourceManager.RebuildResourceFile(absolute, REBUILD_CONFIGURATION, false)",
    ],
    txaEdit: [
      "EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why)",
      'exporter.TrackLoad(absolute, "")',
      "exporter.TrackGetEventCount()",
      "exporter.TrackGetEvent(req.index)",
      "current.GetVarIndex(fieldName)",
      "EMCP_WB_Container.CheckText(dataType, req.values.Get(f), why)",
      "exporter.TrackGetCustomProperty(req.propName)",
    ],
  };
  for (const [a, calls] of Object.entries(CALLS)) {
    it(a, () => {
      const body = method(src, METHOD[a]);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("an event is read through GetClassName, GetNumVars, GetVarName and the shipped ReadAsText", () => {
    const body = method(src, "EventText");
    for (const call of [
      "ev.GetNumVars()",
      "ev.GetVarName(v)",
      "ev.GetDataVarType(v)",
      "EMCP_WB_Container.ReadAsText(ev, varName, dataType)",
      "ev.GetClassName()",
    ])
      expect(body, call).toContain(call);
    const container = code(other("Container"));
    for (const helper of ["ReadAsText", "WriteFromText", "CheckText"])
      expect(container, helper).toMatch(new RegExp(`static \\w+ ${helper}\\(`));
    expect(code(other("Resources"))).toMatch(/static string MetaIdOf\(ResourceManager/);
  });

  it("floats arrive as text and are parsed with EMCP_WB_Common.ParseFloat", () => {
    expect(src).toMatch(/ref array<string> keyData;/);
    expect(src).toMatch(/ref array<string> diffData;/);
    expect(method(src, "ParseFloats")).toContain("EMCP_WB_Common.ParseFloat(texts.Get(i), number)");
    const keyData = contract.actions
      .find((a) => a.name === "txaExport")
      ?.params.find((p) => p.key === "keyData");
    expect(keyData?.type).toBe("array<string>");
  });
});

describe("check stays gated on P-W4-14", () => {
  it("refuses MODAL_HAZARD after the owner check and calls nothing that opens or fetches", () => {
    const body = method(src, "Check");
    expect(body).toMatch(
      /Answer\(resp, EMCP_WB_Guard\.REFUSED, MODAL_HAZARD, "check waits for probe P-W4-14/,
    );
    expect(body).toMatch(/Answer\(resp, EMCP_WB_Guard\.REFUSED, MODULE_NOT_SUPPORTED,/);
    expect(body).toContain(
      'owner != "AnimEditor" && owner != "BehaviorEditor" && owner != "ProcAnimEditor"',
    );
    for (const call of [
      "GetModule",
      "SetOpenedResource",
      "OpenIn",
      "Print(",
      "GetContainer",
      "TxaExporter",
    ])
      expect(body, call).not.toContain(call);
  });
});

describe("guards, dry runs and gates of the writes", () => {
  for (const a of WRITES) {
    it(`${a}: the project guard comes first`, () => {
      const body = method(src, METHOD[a]);
      const first = body.indexOf("{") + 1;
      expect(body.slice(first).trim().startsWith("if (ProjectRefused(resp))"), a).toBe(true);
    });
  }

  it("ProjectRefused refuses with the guard's code", () => {
    expect(method(src, "ProjectRefused")).toContain(
      "EMCP_WB_Guard.Project(addonId, projectDir, why)",
    );
    expect(method(src, "ProjectRefused")).toContain(
      "Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT,",
    );
    const answer = method(src, "Answer");
    expect(answer).toContain("resp.next = nextStep;");
    expect(answer).toContain(
      "EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep)",
    );
  });

  it("txaExport: a new target inside the project, every input checked, then the dry run, then the write", () => {
    const body = method(src, "TxaExport");
    const guard = body.indexOf("EMCP_WB_Guard.NewTargetInProject(clean, absolute, why)");
    const exists = body.indexOf(
      'Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true)',
    );
    const floats = body.indexOf('ParseFloats(req.keyData, "keyData", keys, why)');
    const multiple = body.indexOf("keys.Count() % perFrameBlock != 0");
    const count = body.indexOf("if (profileChannels != req.channelCount)");
    const dry = body.indexOf("if (!req.confirm)");
    const dryReturn = body.indexOf("return;", body.indexOf("resp.dryRun = true;", dry));
    const reset = body.indexOf("exporter.TrackReset(");
    expect(guard).toBeGreaterThan(0);
    expect(exists).toBeGreaterThan(guard);
    expect(floats).toBeGreaterThan(exists);
    expect(multiple).toBeGreaterThan(floats);
    expect(count).toBeGreaterThan(multiple);
    expect(dry).toBeGreaterThan(count);
    expect(reset).toBeGreaterThan(dryReturn);
    for (const w of TRACK_WRITES)
      if (body.includes(`exporter.${w}(`))
        expect(body.indexOf(`exporter.${w}(`), w).toBeGreaterThan(dryReturn);
    const order = [
      "TrackReset(",
      "TrackSetChannels(",
      "TrackExport()",
      "RegisterResourceFile(",
      "RebuildResourceFile(",
    ].map((c) => body.indexOf(c));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(src).toContain('static const string REBUILD_CONFIGURATION = "PC";');
  });

  it("txaExport: the file is checked on disk after TrackExport, and registration is read back", () => {
    const body = method(src, "TxaExport");
    expect(body).toMatch(/resp\.written = Workbench\.GetAbsolutePath\(/);
    expect(body).toMatch(/if \(!resp\.written\)\s*\{\s*Answer\(resp, "error", SAVE_FAILED,/);
    expect(body).toMatch(/resp\.registered = resourceId != "";/);
  });

  it("txaEdit: an existing file of the project; the dry run reads only; confirm refuses UNPROVEN", () => {
    const body = method(src, "TxaEdit");
    expect(src).toContain("static const bool TXA_EDIT_PROVEN = false;");
    const dry = body.indexOf("if (!req.confirm)");
    const gate = body.indexOf("if (!TXA_EDIT_PROVEN)");
    const apply = body.indexOf("ApplyEdit(req, resp, exporter, clean, absolute)");
    expect(dry).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(dry);
    expect(apply).toBeGreaterThan(gate);
    expect(body.slice(gate, apply)).toMatch(
      /Answer\(resp, EMCP_WB_Guard\.REFUSED, UNPROVEN, "txaEdit writes wait for probe P-W4-06/,
    );
    for (const w of TRACK_WRITES) expect(body, w).not.toContain(`.${w}(`);
    expect([...C.matchAll(/ApplyEdit\(req, resp,/g)].length).toBe(1);
  });

  it("txaEdit: edit and erase take an index the track has (ITEM_NOT_FOUND)", () => {
    const body = method(src, "TxaEdit");
    expect(body).toMatch(
      /if \(req\.index < 0 \|\| req\.index >= total\)\s*\{\s*Answer\(resp, "error", ITEM_NOT_FOUND,/,
    );
    expect(body).toContain(
      'op != "add" && op != "edit" && op != "erase" && op != "setProp" && op != "clearProps"',
    );
  });

  it("ApplyEdit writes with TrackExport, then reloads into a fresh exporter for after", () => {
    const body = method(src, "ApplyEdit");
    const exp = body.indexOf("exporter.TrackExport()");
    const reload = body.indexOf('reread.TrackLoad(absolute, "")');
    expect(exp).toBeGreaterThan(0);
    expect(reload).toBeGreaterThan(exp);
    expect(body).toContain(
      "EMCP_WB_Container.WriteFromText(ev, fieldName, dataType, req.values.Get(f), why)",
    );
  });
});

describe("paging (txaRead)", () => {
  it("limit default 50, max 200", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 50;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    const limit = contract.actions
      .find((x) => x.name === "txaRead")
      ?.params.find((p) => p.key === "limit");
    expect(limit?.note).toBe("events per page, default 50, max 200");
  });

  it("the cursor is <start>:<count> and a changed total answers STALE_CURSOR", () => {
    const body = method(src, "TxaRead");
    expect(body).toContain("ParseCursor(req.cursor, start, issuedFor)");
    expect(body).toMatch(
      /if \(req\.cursor != "" && issuedFor != total\)\s*\{\s*Answer\(resp, "error", STALE_CURSOR,/,
    );
    expect(body).toContain('resp.nextCursor = end.ToString() + ":" + total.ToString();');
    const parse = method(src, "ParseCursor");
    expect(parse).toContain("EMCP_WB_Common.ParseInt(startText, startValue)");
    expect(parse).toContain("startValue > countValue");
  });
});

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Anim.check
// census:mcp:handler-action/EMCP_WB_Anim.txaChannels
// census:mcp:handler-action/EMCP_WB_Anim.txaEdit
// census:mcp:handler-action/EMCP_WB_Anim.txaExport
// census:mcp:handler-action/EMCP_WB_Anim.txaProfiles
// census:mcp:handler-action/EMCP_WB_Anim.txaRead
