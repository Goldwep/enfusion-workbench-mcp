import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { buildLedger } from "../../src/census/build-ledger.js";
import {
  asciiStrings,
  demangleTypeName,
  extractNetBlock,
  findRccBundles,
  lowerAscii,
  parseMainWindowState,
  parseRtti,
  peSections,
  qtHash,
  importSlots,
  searchBytes,
  selectSwitches,
  setObjectNameLiterals,
  stringRunAfter,
  switchCandidates,
  type Section,
} from "../../src/census/exe-tables.js";
import {
  EXE_NAME,
  IDENTIFIER,
  MODULE_NOT_SHOWN,
  buildRows,
  collapseRepeatedLayouts,
  extract,
  objectNameFitsId,
  run as runE05,
} from "../../scripts/census/enumerators/e05-executable-tables.js";
import { makeCensus, runIn, writeObservations } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic byte builders ───────────────────────────────────────────────────

/** A byte image that places pieces at chosen offsets. */
class Image {
  readonly buf: Buffer;
  constructor(size: number) {
    this.buf = Buffer.alloc(size);
  }
  ascii(off: number, s: string): number {
    this.buf.write(s, off, "latin1");
    this.buf[off + s.length] = 0;
    return off;
  }
  bytes(off: number, b: Buffer): number {
    b.copy(this.buf, off);
    return off;
  }
  u32le(off: number, v: number): void {
    this.buf.writeUInt32LE(v >>> 0, off);
  }
}

function u32be(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
}
function u16be(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v);
  return b;
}
function utf16be(s: string): Buffer {
  return Buffer.from(s, "utf16le").swap16();
}
/** QDataStream QString: u32 BE byte length + UTF-16BE. */
function qstring(s: string): Buffer {
  return Buffer.concat([u32be(s.length * 2), utf16be(s)]);
}

/** A `QMainWindow::saveState` stream with the given docks and one toolbar. */
function mainWindowState(docks: string[], toolbar: string): Buffer {
  return Buffer.concat([
    u32be(0xff), // version marker
    u32be(0),
    Buffer.from([0xfd]), // dock widget state marker
    u32be(docks.length),
    ...docks.flatMap((d) => [
      Buffer.from([0xfb]), // widget marker
      qstring(d),
      Buffer.from([0x01]),
      u32be(0x10),
    ]),
    qstring("not a toolbar"), // non-identifier QString outside a dock entry: ignored
    Buffer.from([0xfc]), // toolbar state marker
    u32be(1),
    u32be(1),
    u32be(1),
    qstring(toolbar),
    Buffer.from([0x01]),
    u32be(0x20),
    u32be(0x30),
  ]);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/**
 * An rcc bundle (payload table, name table, tree) for
 * `:/Workbench/<module>/edit.gs` and `:/Workbench/<module>/normalIcon.png`.
 * Returns the bundle bytes and the offsets of interest relative to its start.
 */
function rccBundle(
  module: string,
  state: Buffer,
): { bytes: Buffer; moduleName: number; gs: number } {
  const data = Buffer.concat([u32be(state.length), state, u32be(PNG.length), PNG]);
  const pngOff = 4 + state.length;
  const names: Buffer[] = [];
  const nameOffsets: Record<string, number> = {};
  let at = 0;
  for (const n of ["Workbench", module, "edit.gs", "normalIcon.png"]) {
    nameOffsets[n] = at;
    const e = Buffer.concat([u16be(n.length), u32be(qtHash(n)), utf16be(n)]);
    names.push(e);
    at += e.length;
  }
  const nameTable = Buffer.concat(names);
  const lastmod = Buffer.alloc(8);
  const dirEntry = (name: number, count: number, first: number): Buffer =>
    Buffer.concat([u32be(name), u16be(2), u32be(count), u32be(first), lastmod]);
  const fileEntry = (name: number, dataOff: number): Buffer =>
    Buffer.concat([u32be(name), u16be(0), u16be(0), u16be(1), u32be(dataOff), lastmod]);
  const tree = Buffer.concat([
    dirEntry(0, 1, 1),
    dirEntry(nameOffsets.Workbench, 1, 2),
    dirEntry(nameOffsets[module], 2, 3),
    fileEntry(nameOffsets["edit.gs"], 0),
    fileEntry(nameOffsets["normalIcon.png"], pngOff),
  ]);
  const pad = Buffer.alloc((4 - ((data.length + nameTable.length) % 4)) % 4);
  const bytes = Buffer.concat([data, nameTable, pad, tree]);
  return { bytes, moduleName: data.length + nameOffsets[module] + 6, gs: 4 };
}

const RDATA_RAW = 0x200;
const RDATA_VA = 0x1000;
const RDATA_SIZE = 0x3000;
const TEXT_RAW = RDATA_RAW + RDATA_SIZE;
const TEXT_VA = 0x5000;
const TEXT_SIZE = 0x200;
const OPT_SIZE = 0xf0;
const SET_OBJECT_NAME = "?setObjectName@QObject@@QEAAXVQAnyStringView@@@Z";

/**
 * A minimal PE32+ image: `.rdata` holds every table E05 reads (and the import
 * table), `.text` holds two `QObject::setObjectName` call sites.
 */
function syntheticExe(): { buf: Buffer; offsets: Record<string, number> } {
  const img = new Image(TEXT_RAW + TEXT_SIZE);
  const b = img.buf;
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x40, 0x3c);
  b.write("PE\0\0", 0x40, "latin1");
  b.writeUInt16LE(2, 0x46); // two sections
  b.writeUInt16LE(OPT_SIZE, 0x54); // optional header size
  const opt = 0x40 + 24;
  b.writeUInt16LE(0x20b, opt); // PE32+
  b.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes
  const section = (at: number, name: string, va: number, size: number, raw: number): void => {
    b.write(name, at, "latin1");
    b.writeUInt32LE(size, at + 8);
    b.writeUInt32LE(va, at + 12);
    b.writeUInt32LE(size, at + 16);
    b.writeUInt32LE(raw, at + 20);
  };
  section(opt + OPT_SIZE, ".rdata", RDATA_VA, RDATA_SIZE, RDATA_RAW);
  section(opt + OPT_SIZE + 40, ".text", TEXT_VA, TEXT_SIZE, TEXT_RAW);
  const o: Record<string, number> = {};
  const r = (n: number): number => RDATA_RAW + n;
  // CLI switches.
  o.gproj = img.ascii(r(0x10), "-gproj");
  o.exitAfterInit = img.ascii(r(0x18), "-exitAfterInit");
  o.lib = img.ascii(r(0x28), "-lib");
  o.packLiteral = img.ascii(r(0x30), "-packAddon");
  o.packProse = img.ascii(r(0x40), "-packAddon CLI detected");
  o.lsp = img.ascii(r(0x60), "argument -lspPort hasn't contained port number");
  o.template = img.ascii(r(0x90), '"%1" -addonsDir "%2" -gproj "%3" ');
  o.unaligned = img.ascii(r(0xb5), "-unalignedSwitch");
  o.junk = img.ascii(r(0xc8), "-h ");
  o.wbProject = img.ascii(r(0xd0), "Unrelated text");
  // NET dispatcher block, closed by pointer bytes.
  o.anchor = img.ascii(r(0x100), "Parameter %s required");
  o.open = img.ascii(r(0x118), "OpenResource");
  o.running = img.ascii(r(0x128), "IsWorkbenchRunning");
  o.reload = img.ascii(r(0x140), "ReloadScripts");
  o.field = img.ascii(r(0x150), "ResourceName");
  o.isRunning = img.ascii(r(0x160), "IsRunning");
  img.bytes(r(0x170), Buffer.from([0x48, 0x61, 0x50, 0x43, 0x01, 0x00, 0x00, 0x00]));
  // Labels counted as left out.
  img.ascii(r(0x180), "&File");
  img.ascii(r(0x188), "Ctrl+Shift+S");
  img.ascii(r(0x198), "actionOpen");
  // UTF-16LE probe text.
  o.utf16 = img.bytes(r(0x1a8), Buffer.from("EvaluateScript\0", "utf16le"));
  // rcc bundle with a ScriptEditor layout.
  const rcc = rccBundle(
    "ScriptEditor",
    mainWindowState(["projectTreeDock", "Log Console"], "toolBar"),
  );
  const rccAt = r(0x400);
  img.bytes(rccAt, rcc.bytes);
  o.rccModule = rccAt + rcc.moduleName;
  o.rccState = rccAt + rcc.gs;
  // RTTI: type descriptors, base class descriptors and arrays, hierarchy descriptors, locators.
  const rva = (fileOff: number): number => fileOff - RDATA_RAW + RDATA_VA;
  const td = (at: number, name: string): number => {
    img.ascii(r(at) + 16, name);
    return r(at);
  };
  const tdDialog = td(0x1000, ".?AVQDialog@@");
  const tdMain = td(0x1040, ".?AVQMainWindow@@");
  const tdModule = td(0x1080, ".?AVWBModule@@");
  const tdFind = td(0x10c0, ".?AVScriptEditorFindDialog@@");
  const tdAbout = td(0x1100, ".?AVAboutDialog@@");
  const tdMsg = td(0x1140, ".?AVQMessageBox@@");
  const tdConv = td(0x1180, ".?AVConvertWindow@@");
  const tdScript = td(0x11c0, ".?AVScriptEditor@@");
  const tdWbDialog = td(0x1200, ".?AVWBDialog@@");
  const tdNavMain = td(0x1240, ".?AVNavmeshGeneratorMain@nm@@");
  const tdNavArea = td(0x1280, ".?AVAreaDialog@nm@@");
  const tdOptions = td(0x12c0, ".?AVScriptEditorOptionsClass@@");
  let next = r(0x1400);
  const bcd = (t: number): number => {
    const at = next;
    img.u32le(at, rva(t));
    next += 0x20;
    return at;
  };
  const cls = (self: number, bases: number[], colAt: number): void => {
    const all = [self, ...bases].map(bcd);
    const bca = next;
    all.forEach((d, i) => img.u32le(bca + 4 * i, rva(d)));
    next += 0x20;
    const chd = next;
    img.u32le(chd + 8, all.length);
    img.u32le(chd + 12, rva(bca));
    next += 0x20;
    const col = r(colAt);
    img.u32le(col, 1);
    img.u32le(col + 12, rva(self));
    img.u32le(col + 16, rva(chd));
    img.u32le(col + 20, rva(col));
  };
  cls(tdFind, [tdWbDialog, tdDialog], 0x2000);
  cls(tdAbout, [tdDialog], 0x2020);
  cls(tdMsg, [tdDialog], 0x2040);
  cls(tdConv, [tdMain], 0x2060);
  cls(tdScript, [tdModule, tdMain], 0x2080);
  cls(tdWbDialog, [tdDialog], 0x20a0);
  cls(tdNavMain, [tdModule, tdMain], 0x20c0);
  cls(tdNavArea, [tdDialog], 0x20e0);
  cls(tdOptions, [], 0x2100);
  o.tdFind = tdFind + 16;
  o.tdAbout = tdAbout + 16;
  o.tdConv = tdConv + 16;
  o.tdNavArea = tdNavArea + 16;

  // Import table: Qt6Core.dll!QObject::setObjectName.
  const desc = r(0x2400);
  const int = r(0x2440);
  const iat = r(0x2460);
  const dll = img.ascii(r(0x2480), "Qt6Core.dll");
  const hintName = r(0x24a0);
  img.ascii(hintName + 2, SET_OBJECT_NAME);
  img.u32le(int, rva(hintName));
  img.u32le(iat, rva(hintName));
  img.u32le(desc, rva(int));
  img.u32le(desc + 12, rva(dll));
  img.u32le(desc + 16, rva(iat));
  img.u32le(opt + 120, rva(desc));
  img.u32le(opt + 124, 40);
  o.iatRva = rva(iat);

  // `AboutDialog->setObjectName("AboutDialog")`, and a call with no literal.
  o.aboutLiteral = img.ascii(r(0x2600), "AboutDialog");
  const textRva = (fileOff: number): number => fileOff - TEXT_RAW + TEXT_VA;
  const site = TEXT_RAW + 0x10;
  img.bytes(site, Buffer.from([0x48, 0x8d, 0x15])); // lea rdx, [rip+d32]
  b.writeInt32LE(rva(o.aboutLiteral) - textRva(site + 7), site + 3);
  img.bytes(site + 7, Buffer.from([0x48, 0x8b, 0xcb])); // mov rcx, rbx
  o.callAbout = site + 10;
  img.bytes(o.callAbout, Buffer.from([0xff, 0x15])); // call [rip+d32]
  b.writeInt32LE(o.iatRva - textRva(o.callAbout + 6), o.callAbout + 2);
  o.callBare = TEXT_RAW + 0x180;
  img.bytes(o.callBare, Buffer.from([0xff, 0x15]));
  b.writeInt32LE(o.iatRva - textRva(o.callBare + 6), o.callBare + 2);

  // The options class name and the strings beside it, then pointer words.
  const pointer = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x01, 0, 0, 0]);
  o.optionsName = img.ascii(r(0x2700), "ScriptEditorOptionsClass");
  img.ascii(r(0x2720), "ScriptEditorOptions");
  img.bytes(r(0x2738), pointer);
  img.ascii(r(0x2740), "UseSVNIntegration");
  img.ascii(r(0x2758), "Line one\nline two");
  for (let w = 0; w < 5; w++) img.bytes(r(0x2770 + 8 * w), pointer);
  img.ascii(r(0x2798), "NotBeside");
  return { buf: b, offsets: o };
}

// ── Extraction functions ──────────────────────────────────────────────────────

describe("E05 string and switch extraction", () => {
  it("finds NUL-bounded ASCII strings with their offsets", () => {
    const img = new Image(64);
    img.ascii(4, "-gproj");
    img.ascii(16, "hello world");
    img.buf.write("xyz", 40, "latin1"); // not NUL-terminated before the end
    img.buf[43] = 0x01;
    const found = asciiStrings(img.buf, { lo: 0, hi: 64 }, 2);
    expect(found).toEqual([
      { offset: 4, text: "-gproj" },
      { offset: 16, text: "hello world" },
    ]);
  });

  it("takes literal and argument-marked prose switches, excludes other families, skips unaligned", () => {
    const { buf, offsets: o } = syntheticExe();
    const sections = peSections(buf);
    const rd = { lo: sections[0].raw, hi: sections[0].rawEnd };
    const cands = switchCandidates(asciiStrings(buf, rd, 2));
    const lib = cands.find((c) => c.name === "lib");
    expect(lib?.excluded).toBe("COLLADA element id suffix");
    expect(cands.some((c) => c.name === "unalignedSwitch")).toBe(false);
    expect(cands.some((c) => c.name === "h")).toBe(false);
    const sel = selectSwitches(cands);
    expect(sel.map((s) => s.name).sort()).toEqual(
      ["addonsDir", "exitAfterInit", "gproj", "lspPort", "packAddon"].sort(),
    );
    const pack = sel.find((s) => s.name === "packAddon");
    expect(pack).toMatchObject({ method: "literal", offset: o.packLiteral });
    expect(sel.find((s) => s.name === "gproj")).toMatchObject({
      method: "literal",
      offset: o.gproj,
    });
    expect(sel.find((s) => s.name === "lspPort")).toMatchObject({ method: "prose", offset: o.lsp });
    expect(sel.find((s) => s.name === "addonsDir")).toMatchObject({
      method: "prose",
      offset: o.template,
    });
  });

  it("searches ASCII and UTF-16LE, exact and case-insensitive", () => {
    const { buf, offsets: o } = syntheticExe();
    const lowered = lowerAscii(buf);
    expect(searchBytes(buf, "EvaluateScript").utf16le).toEqual([o.utf16]);
    expect(searchBytes(buf, "EvaluateScript").ascii).toEqual([]);
    expect(searchBytes(buf, "evaluatescript").utf16le).toEqual([]);
    expect(searchBytes(buf, "evaluatescript", lowered).utf16le).toEqual([o.utf16]);
    expect(searchBytes(buf, "-GPROJ", lowered).ascii).toEqual([o.gproj, o.template + 21]);
    expect(searchBytes(buf, "-wbProjectPath", lowered)).toEqual({ ascii: [], utf16le: [] });
  });

  it("reads the NET dispatcher block and stops the function run at the first field name", () => {
    const { buf, offsets: o } = syntheticExe();
    const net = extractNetBlock(buf, { lo: RDATA_RAW, hi: RDATA_RAW + RDATA_SIZE });
    expect(net.anchor).toBe(o.anchor);
    expect(net.functions.map((f) => [f.text, f.offset])).toEqual([
      ["OpenResource", o.open],
      ["IsWorkbenchRunning", o.running],
      ["ReloadScripts", o.reload],
    ]);
    expect(net.block.map((s) => s.text)).toContain("IsRunning");
    expect(extractNetBlock(Buffer.alloc(64), { lo: 0, hi: 64 }).anchor).toBe(-1);
  });
});

describe("E05 rcc, layout and RTTI parsing", () => {
  it("verifies rcc names by qt_hash and resolves the tree and payloads", () => {
    expect(qtHash("Workbench")).toBe(qtHash("Workbench"));
    expect(qtHash("a")).toBe(0x61);
    const { buf, offsets: o } = syntheticExe();
    const bundles = findRccBundles(buf, { lo: RDATA_RAW, hi: RDATA_RAW + RDATA_SIZE });
    expect(bundles).toHaveLength(1);
    const paths = bundles[0].entries.map((e) => e.path);
    expect(paths).toEqual([
      ":/Workbench",
      ":/Workbench/ScriptEditor",
      ":/Workbench/ScriptEditor/edit.gs",
      ":/Workbench/ScriptEditor/normalIcon.png",
    ]);
    const dir = bundles[0].entries[1];
    expect(dir.nameOffset).toBe(o.rccModule);
    const gs = bundles[0].entries[2];
    expect(gs.payload).toBe(o.rccState);
    const entries = parseMainWindowState(buf, gs.payload, gs.size);
    // A dock name with a space is read (0xfb marker); a non-identifier QString
    // outside a dock entry is not taken for a toolbar.
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ["projectTreeDock", "dock"],
      ["Log Console", "dock"],
      ["toolBar", "toolbar"],
    ]);
    expect(
      buf
        .subarray(entries[0].offset, entries[0].offset + 30)
        .swap16()
        .toString("utf16le"),
    ).toBe("projectTreeDock");
  });

  it("collapses a layout path the rcc lists twice with identical bytes, refuses one with different bytes", () => {
    // Build 1.9.0.37 lists :/Workbench/DialogueEditor/edit.gs twice (two
    // byte-identical payloads); emitting both keyed every dock twice.
    const state = mainWindowState(["scenePropertiesDock", "PreviewDock"], "mainToolbar");
    const other = mainWindowState(["scenePropertiesDock"], "mainToolbar");
    const buf = Buffer.concat([state, state, other]);
    const table = (path: string, payload: number, size: number) => ({
      module: "DialogueEditor" as const,
      path,
      payload,
      size,
      entries: parseMainWindowState(buf, payload, size),
    });
    const p = ":/Workbench/DialogueEditor/edit.gs";
    const r = collapseRepeatedLayouts(buf, [
      table(p, 0, state.length),
      table(p, state.length, state.length),
      table(":/Workbench/ScriptEditor/edit.gs", 2 * state.length, other.length),
    ]);
    expect(r.layouts.map((l) => [l.path, l.payload])).toEqual([
      [p, 0],
      [":/Workbench/ScriptEditor/edit.gs", 2 * state.length],
    ]);
    expect(r.repeated).toEqual([{ path: p, payload: state.length, keptPayload: 0 }]);
    expect(() =>
      collapseRepeatedLayouts(buf, [
        table(p, 0, state.length),
        table(p, 2 * state.length, other.length),
      ]),
    ).toThrow(/twice with different bytes/);
  });

  it("refuses a payload that is not a QMainWindow state", () => {
    const b = Buffer.concat([u32be(0x10), qstring("dockA")]);
    expect(parseMainWindowState(b, 0, b.length)).toEqual([]);
  });

  it("reads RTTI base-class lists and demangles simple names", () => {
    const { buf, offsets: o } = syntheticExe();
    const sections: Section[] = peSections(buf);
    const classes = parseRtti(
      buf,
      sections,
      { lo: RDATA_RAW, hi: RDATA_RAW + RDATA_SIZE },
      RDATA_VA,
    );
    const find = classes.find((c) => c.mangled === ".?AVScriptEditorFindDialog@@");
    expect(find).toMatchObject({
      offset: o.tdFind,
      bases: [".?AVWBDialog@@", ".?AVQDialog@@"],
    });
    expect(classes.find((c) => c.mangled === ".?AVScriptEditor@@")?.bases).toEqual([
      ".?AVWBModule@@",
      ".?AVQMainWindow@@",
    ]);
    expect(demangleTypeName(".?AVNavmeshGeneratorAreaDialog@nm@@")).toEqual({
      name: "NavmeshGeneratorAreaDialog",
      namespaces: ["nm"],
      qualified: "nm::NavmeshGeneratorAreaDialog",
    });
    expect(demangleTypeName(".?AVMemInfoDialog@?A0x02ba2d84@@")?.qualified).toBe("MemInfoDialog");
    expect(demangleTypeName(".?AV?$Foo@H@@")).toBeNull();
    expect(demangleTypeName(".?AV<lambda_1>@@")).toBeNull();
  });
});

describe("E05 setObjectName literals, string runs, object-name ids", () => {
  it("reads the import slot and the literal each setObjectName call site passes", () => {
    const { buf, offsets: o } = syntheticExe();
    const sections = peSections(buf);
    expect(importSlots(buf, sections)).toEqual([
      { dll: "Qt6Core.dll", name: SET_OBJECT_NAME, rva: o.iatRva },
    ]);
    const scan = setObjectNameLiterals(buf, sections);
    expect(scan).toEqual({
      calls: 2,
      unresolved: 1,
      literals: [{ offset: o.aboutLiteral, text: "AboutDialog", sites: [o.callAbout] }],
    });
    expect(extract(buf).objectNames).toEqual(scan);
  });

  it("returns no import slots for an image without a PE32+ optional header", () => {
    const img = new Image(0x200);
    img.buf.write("MZ", 0, "latin1");
    img.buf.writeUInt32LE(0x40, 0x3c);
    img.buf.write("PE\0\0", 0x40, "latin1");
    const sections = peSections(img.buf);
    expect(importSlots(img.buf, sections)).toEqual([]);
    expect(setObjectNameLiterals(img.buf, sections)).toEqual({
      calls: 0,
      unresolved: 0,
      literals: [],
    });
  });

  it("collects the strings beside a name up to more than four pointer words", () => {
    const { buf, offsets: o } = syntheticExe();
    const run = stringRunAfter(buf, o.optionsName, { lo: RDATA_RAW, hi: RDATA_RAW + RDATA_SIZE });
    expect(run.map((s) => s.text)).toEqual([
      "ScriptEditorOptions",
      "UseSVNIntegration",
      "Line one\nline two",
    ]);
    expect(run.map((s) => s.text).filter((t) => IDENTIFIER.test(t))).toEqual([
      "ScriptEditorOptions",
      "UseSVNIntegration",
    ]);
    expect(extract(buf).optionRuns).toEqual([
      {
        className: "ScriptEditorOptionsClass",
        rttiOffset: buf.indexOf(".?AVScriptEditorOptionsClass@@"),
        offset: o.optionsName,
        strings: run,
      },
    ]);
  });

  it("accepts plain spaces in an object name and refuses other whitespace", () => {
    expect(objectNameFitsId("Animation Sets")).toBe(true);
    expect(objectNameFitsId("Animation\tSets")).toBe(false);
  });
});

// ── Rows, determinism, ledger acceptance ──────────────────────────────────────

describe("E05 rows and observation file", () => {
  it("builds rows with containment only where the binary shows it", () => {
    const { buf, offsets: o } = syntheticExe();
    const built = buildRows(extract(buf));
    const ids = built.observations.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual(
      expect.arrayContaining([
        "cli:-gproj",
        "cli:-lspport", // switch ids fold case (DEC-022)
        "net:native/OpenResource",
        "ui:ScriptEditor/module/ScriptEditor",
        "ui:ScriptEditor/dock/#projectTreeDock",
        "ui:ScriptEditor/toolbar/#toolBar",
        "ui:ScriptEditor/dialog/ScriptEditorFindDialog",
        "ui:NavmeshGeneratorMain/dialog/nm::AreaDialog",
        // Item 1: a dock object name with a plain space is emitted, the space escaped.
        "ui:ScriptEditor/dock/#Log%20Console",
        // Item 2: no module shown -> module none; keyed by object name only when
        // the binary passes the class name to setObjectName, else by path.
        "ui:none/dialog/#AboutDialog",
        "ui:none/window/ConvertWindow",
      ]),
    );
    expect(ids.some((i) => i.includes("QMessageBox"))).toBe(false);
    // No Shared fallback: a class with no module shown carries module none.
    expect(ids.some((i) => i.startsWith("ui:Shared/"))).toBe(false);
    expect(ids.filter((i) => i.includes("AboutDialog") || i.includes("ConvertWindow"))).toEqual([
      "ui:none/dialog/#AboutDialog",
      "ui:none/window/ConvertWindow",
    ]);
    // Intermediate base classes stay out.
    expect(ids.some((i) => i.includes("WBDialog"))).toBe(false);
    // Item 3: option classes and the strings beside them are never rows.
    expect(ids.some((i) => /Options|UseSVNIntegration|NotBeside/.test(i))).toBe(false);
    const byId = new Map(built.observations.map((r) => [r.id, r.obs]));
    expect(byId.get("ui:ScriptEditor/dock/#Log%20Console")).toMatchObject({
      key: { object_name: "Log Console" },
      object_name: "Log Console",
      module: "ScriptEditor",
      confidence: "high",
    });
    expect(byId.get("ui:none/dialog/#AboutDialog")).toMatchObject({
      kind: "dialog",
      module: "none",
      key: { object_name: "AboutDialog" },
      object_name: "AboutDialog",
      class_name: "AboutDialog",
      confidence: "medium",
      unverified: [MODULE_NOT_SHOWN],
      ref: `exe:0x${o.tdAbout.toString(16)}`,
    });
    expect(byId.get("ui:none/window/ConvertWindow")).toMatchObject({
      kind: "window",
      module: "none",
      key: { path: ["ConvertWindow"] },
      class_name: "ConvertWindow",
      confidence: "medium",
      unverified: [MODULE_NOT_SHOWN],
    });
    expect(byId.get("ui:none/window/ConvertWindow")?.object_name).toBeUndefined();
    expect(MODULE_NOT_SHOWN).toBe("owning module not shown by the executable");
    // A row whose module the binary shows carries no unverified statement.
    expect(byId.get("ui:ScriptEditor/dialog/ScriptEditorFindDialog")?.unverified).toBeUndefined();
    expect(byId.get("ui:ScriptEditor/dialog/ScriptEditorFindDialog")?.confidence).toBe("medium");
    expect(byId.get("ui:NavmeshGeneratorMain/dialog/nm::AreaDialog")).toMatchObject({
      confidence: "medium",
      ref: `exe:0x${o.tdNavArea.toString(16)}`,
    });
    expect(byId.get("cli:-gproj")?.confidence).toBe("medium");
    expect(byId.get("cli:-lspport")?.confidence).toBe("high");
    expect(byId.get("ui:ScriptEditor/dock/#projectTreeDock")?.parent_key).toEqual({
      dim: "ui",
      kind: "module",
      module: "ScriptEditor",
      key: { path: ["ScriptEditor"] },
    });
    expect(byId.get("ui:ScriptEditor/module/ScriptEditor")).toMatchObject({
      parent_key: null,
      ref: `exe:0x${o.rccModule.toString(16)}`,
    });
    expect(byId.get("ui:ScriptEditor/module/ScriptEditor")?.children_count).toBeUndefined();
    expect(byId.get("ui:ScriptEditor/dialog/ScriptEditorFindDialog")?.parent_key).toBeUndefined();
    expect(byId.get("net:native/OpenResource")).toMatchObject({
      confidence: "medium",
      module: "none",
      ref: `exe:0x${o.open.toString(16)}`,
    });
    expect(byId.get("cli:-gproj")).toMatchObject({ module: "none", quote: "-gproj" });
    // Candidate labels are counted, never emitted.
    const lo = (w: string): number => built.leftOut.find((l) => l.what.startsWith(w))?.count ?? -1;
    expect(lo("labels with a mnemonic")).toBe(1);
    expect(lo("default-shortcut literals")).toBe(1);
    expect(lo("Qt object names")).toBe(1);
    expect(ids.some((i) => i.includes("File"))).toBe(false);
    const items = (w: string): string[] =>
      built.leftOut.find((l) => l.what.startsWith(w))?.items.map((i) => i.text) ?? [];
    expect(lo("dialog and window classes whose owning module")).toBe(-1);
    expect(lo("dock object names containing whitespace")).toBe(-1);
    expect(items("intermediate dialog and window base")).toEqual(["dialog\tWBDialog"]);
    expect(items("option classes")).toEqual(["ScriptEditorOptionsClass"]);
    expect(items("strings beside the option class names")).toEqual([
      "ScriptEditorOptionsClass\tScriptEditorOptions",
      "ScriptEditorOptionsClass\tUseSVNIntegration",
      "ScriptEditorOptionsClass\tLine one\nline two",
    ]);
    // Every row's quote sits at its offset (ASCII NUL-bounded or UTF-16BE).
    for (const { obs } of built.observations) {
      const off = parseInt(obs.ref.slice(6), 16);
      const q = obs.quote ?? "";
      const ascii = buf.toString("latin1", off, off + q.length);
      const be = Buffer.from(buf.subarray(off, off + q.length * 2))
        .swap16()
        .toString("utf16le");
      expect(ascii === q || be === q).toBe(true);
    }
  });

  it("writes a deterministic file that the ledger accepts without a rejected line", () => {
    const { buf } = syntheticExe();
    const dir = mkdtempSync(join(tmpdir(), "e05-exe-"));
    const exe = join(dir, EXE_NAME);
    writeFileSync(exe, buf);
    const fx = makeCensus("1.0.0.1");
    const artifacts = join(dir, "artifacts");
    const first = runIn(fx, runE05, ["--exe", exe, "--artifacts", artifacts]);
    expect(first.code).toBe(0);
    const file = join(fx.root, "observations", "E05", "1.0.0.1.jsonl");
    const text1 = readFileSync(file, "utf-8");
    const second = runIn(fx, runE05, ["--exe", exe, "--no-artifacts"]);
    expect(second.code).toBe(0);
    expect(readFileSync(file, "utf-8")).toBe(text1);
    expect(text1.split("\n")[0]).toContain(
      '"path":"<tools>/Workbench/ArmaReforgerWorkbenchSteamDiag.exe"',
    );
    expect(text1).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(existsSync(join(artifacts, "cli-candidates.tsv"))).toBe(true);
    const result = buildLedger(fx.paths);
    expect(result.rejected).toEqual([]);
    const e05Problems = result.problems.filter((p) => p.message.includes("E05"));
    expect(e05Problems).toEqual([]);
  });

  it("caps an executable-adjacency pairing at medium confidence in the ledger", () => {
    const fx = makeCensus("1.0.0.1");
    writeObservations(fx, "E05", "1.0.0.1", [
      {
        dim: "ui",
        kind: "dock",
        module: "ScriptEditor",
        key: { object_name: "projectTreeDock" },
        label: "Projects",
        origin: "vanilla",
        ref: "exe:adjacency:0x2b9f9a8+0x2b9fea8",
        quote: "projectTreeDock",
        confidence: "high",
      },
    ]);
    const result = buildLedger(fx.paths);
    expect(result.rejected).toEqual([]);
    const row = result.rows.find((r) => r.id === "ui:ScriptEditor/dock/#projectTreeDock");
    expect(row?.sources[0].confidence).toBe("medium");
  });

  it("reports NO DATA when the executable is absent", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE05, ["--exe", join(fx.repo, "missing.exe"), "--no-artifacts"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
  });

  it("refuses an output outside observations/E05/", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE05, ["--out", join(fx.root, "ledger.jsonl"), "--no-artifacts"]);
    expect(r.code).toBe(1);
  });

  it("refuses --artifacts inside a git working tree", () => {
    const { buf } = syntheticExe();
    const dir = mkdtempSync(join(tmpdir(), "e05-git-"));
    mkdirSync(join(dir, ".git"));
    const exe = join(dir, EXE_NAME);
    writeFileSync(exe, buf);
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE05, ["--exe", exe, "--artifacts", join(dir, "raw")]);
    expect(r.code).toBe(1);
    expect(existsSync(join(dir, "raw"))).toBe(false);
    expect(existsSync(join(fx.root, "observations", "E05", "1.0.0.1.jsonl"))).toBe(false);
  });
});

// ── Real executable (skipped when the Tools install is absent) ────────────────

const REAL_EXE = join(loadConfig().workbenchPath, "Workbench", EXE_NAME);

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !existsSync(REAL_EXE))("E05 headline counts on the installed executable", () => {
  it("reproduces the 1.8.0.13 tables", { timeout: 300_000 }, () => {
    const buf = readFileSync(REAL_EXE);
    const x = extract(buf);
    expect(x.size).toBe(67_576_376);
    expect(x.sha256).toBe("7dd36ca1f662b0c13669a4f2f7f10e3c461c2906b021e742272d64b3ab7e9798");
    expect(x.switches).toHaveLength(57);
    expect(x.switches.filter((s) => s.method === "literal")).toHaveLength(48);
    expect(x.net.functions.map((f) => f.text)).toEqual([
      "OpenResource",
      "BringModuleWindowToFront",
      "IsWorkbenchRunning",
      "IsWorldEditorRunning",
      "ValidateScripts",
      "ReloadScripts",
    ]);
    const ci = (s: string): number =>
      x.probes[s].caseInsensitive.ascii.length + x.probes[s].caseInsensitive.utf16le.length;
    expect(ci("-wbProjectPath")).toBe(0);
    expect(ci("wbProjectPath")).toBe(0);
    expect(ci("EvaluateScript")).toBe(0);
    expect(ci("ReturnValue")).toBe(0);
    expect(x.probes["-gproj"].exact.ascii).toEqual([0x2b98bf8, 0x2b9e215, 0x2da27e4]);
    expect(x.probes["-gproj"].caseInsensitive.utf16le).toEqual([]);
    const layoutDocks = x.layouts.flatMap((l) => l.entries.filter((e) => e.kind === "dock"));
    expect(layoutDocks).toHaveLength(80);
    expect(
      x.layouts.find((l) => l.module === "AnimEditor")?.entries.filter((e) => e.kind === "dock"),
    ).toHaveLength(14);
    const built = buildRows(x);
    const kinds = Object.fromEntries(Object.entries(built.kinds).map(([k, v]) => [k, v.rows]));
    expect(kinds).toEqual({
      "cli-switch": 57,
      "net-function": 6,
      module: 11,
      dock: 80,
      toolbar: 8,
      dialog: 74,
      window: 5,
    });
    expect(built.observations).toHaveLength(241);
    const obs = built.observations.map((r) => r.obs);
    // Item 1: the eight AnimEditor docks with spaces are rows.
    expect(obs.filter((r) => r.kind === "dock" && / /.test(r.object_name ?? ""))).toHaveLength(8);
    // Item 2: 69 module-less classes (64 QDialog, 5 QMainWindow), 11 of them
    // keyed by an object name the binary passes to setObjectName.
    const residue = obs.filter((r) => r.unverified?.includes(MODULE_NOT_SHOWN));
    expect(residue).toHaveLength(69);
    expect(residue.every((r) => r.module === "none" && r.confidence === "medium")).toBe(true);
    expect(residue.filter((r) => r.kind === "dialog")).toHaveLength(64);
    expect(residue.filter((r) => r.kind === "window")).toHaveLength(5);
    expect(
      residue
        .filter((r) => r.key.object_name !== undefined)
        .map((r) => r.key.object_name)
        .sort(),
    ).toEqual([
      "AnchorDialog",
      "ColorDialog",
      "DataBuildDialog",
      "GenerateGUIDDialog",
      "ItemListDialog",
      "NewTerrainDialog",
      "PosFixDialog",
      "ProgressDialog",
      "SaveChangesDialog",
      "SizeFixDialog",
      "TransferToAddonDialog",
    ]);
    expect(x.objectNames.calls).toBe(1397);
    expect(x.objectNames.literals).toHaveLength(898);
    expect(x.objectNames.unresolved).toBe(10);
    // Item 3: nine option classes, no row; 80 strings beside them, 50 identifier-shaped.
    expect(new Set(x.optionRuns.map((r) => r.className)).size).toBe(9);
    const runStrings = x.optionRuns.flatMap((r) => r.strings);
    expect(runStrings).toHaveLength(80);
    expect(runStrings.filter((s) => IDENTIFIER.test(s.text))).toHaveLength(50);
    expect(obs.some((r) => JSON.stringify(r.key).includes("OptionsClass"))).toBe(false);
    const lo = (w: string): number => built.leftOut.find((l) => l.what.startsWith(w))?.count ?? -1;
    expect(lo("dock object names containing whitespace")).toBe(-1);
    expect(lo("dialog and window classes whose owning module")).toBe(-1);
    expect(lo("intermediate dialog and window base")).toBe(4);
    expect(lo("option classes")).toBe(9);
    expect(lo("strings beside the option class names")).toBe(80);
    expect(lo("labels with a mnemonic")).toBe(183);
    expect(lo("default-shortcut literals")).toBe(96);
    expect(lo("Qt object names")).toBe(46);
    const conf = (kind: string, c: string): number =>
      built.observations.filter((r) => r.obs.kind === kind && r.obs.confidence === c).length;
    expect(conf("cli-switch", "medium")).toBe(48);
    expect(conf("cli-switch", "high")).toBe(9);
  });
});
