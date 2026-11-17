import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { compareCodeUnits, sha256 } from "../../src/census/canon.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { loadConfig } from "../../src/config.js";
import {
  GENERATOR,
  HEAD_BYTES,
  PLAN_GROUPS,
  PROJECT_LIST_FILE,
  REAL_DEPS,
  SNIFF_SAMPLE,
  allExtensions,
  assertNoPii,
  buildModel,
  buildRows,
  censusMeta,
  classifyExtension,
  cleanWikiText,
  extractMetaClasses,
  extractWikiPage,
  groupByExt,
  headline,
  listProfile,
  listingText,
  measureCorpus,
  modelInputs,
  observationFileText,
  moduleForUsedBy,
  parseFileTypesTable,
  profileRoles,
  rawExtension,
  roleName,
  rolesText,
  scanForExceptions,
  run as runE09,
  sanitizeSegment,
  seededSample,
  sniffBytes,
  type Deps,
  type PakSource,
  type TextParser,
} from "../../scripts/census/enumerators/e09-file-types.js";
import { REPO_ROOT, makeCensus, runIn } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic inputs ──────────────────────────────────────────────────────────

const TEXT = Buffer.from('GenericEntity {\n ID "A"\n}\n');
const BIN = Buffer.from([0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x01, 0x02]);

/** A fake pak: path to bytes; an Error value makes that read fail (an entry over the VFS cap). */
function fakePak(files: Record<string, Buffer | Error>, reads: string[] = []): PakSource {
  return {
    allFilePaths: () => Object.keys(files),
    readFile: (p) => {
      reads.push(p);
      const v = files[p];
      if (v === undefined) throw new Error(`File not found in pak: ${p}`);
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

const META_TEXT = [
  "MetaFileClass {",
  ' Name "{AAAA}Some/Path.xob"',
  " Configurations {",
  "  XOBResourceClass PC {",
  '   Mat "{BBBB}x.emat"',
  "  }",
  "  XOBResourceClass XBOX_ONE : PC {",
  "  }",
  " }",
  "}",
  "",
].join("\n");

const META_TEXT_2 = META_TEXT.replace(/XOBResourceClass/g, "PNGResourceClass");

const WIKI_XML = String.raw`<mediawiki>
  <page>
    <title>Arma Reforger:Other Page</title>
    <revision><text xml:space="preserve">{| class="wikitable"
|-
|
==== .nope ====
| Not this table
|}</text></revision>
  </page>
  <page>
    <title>Arma Reforger:File Types</title>
    <revision>
      <text bytes="1" xml:space="preserve">intro
{| class="wikitable sortable"
! Extension
! File Type
! Saved/Used by
! Description
|-
|
==== .zed ====
| Zed document
| {{Link|Arma Reforger:Audio Editor}}
| Zed files &amp; more &lt;!-- hidden --&gt;
Second line
* bullet
|-
|
==== .pre ====
| Preset
| Resource Browser
| A preset (usually saved in {{hl|%userprofile%\Documents\My Games\X\profile\Presets}})
|-
|
==== .wikionly ====
| Wiki only
| nobody
| {{GVI|armaR|1.6.0}} Wrapper for {{Link|#.wav}} and {{Link|https://example.org|Opus}} files
|-
|
==== .conf ====
| Generic config
| Resource Manager's {{Link|Arma Reforger:Resource Manager: Config Editor|Config Editor}}
|
|-
|
==== .meta ====
| Meta Information
| {{Link|Arma Reforger:Resource Manager}}
| Every registered asset has its meta file
|}

{{GameCategory|armaR|Modding}}</text>
    </revision>
  </page>
</mediawiki>`;

// Planted values are assembled here so no id or home-path literal is committed.
const UID = ["7656", "1190", "000000001"].join("");
const HOME = ["C:", "Users", "Someone"].join("\\");

interface World {
  dir: string;
  profile: string;
  wikiFile: string;
  artifacts: string;
  pak: PakSource;
  reads: string[];
  deps: Deps;
  /** The files of the text extension `big` that only a whole-corpus sniff finds not to be text. */
  bigExceptions: { path: string; sniff: string }[];
}

/** A fake install, wiki export, profile directory (with a fake Steam id and a secret) and artifacts folder. */
function makeWorld(): World {
  const dir = mkdtempSync(join(tmpdir(), "e09-"));
  const profile = join(dir, "ArmaReforgerWorkbench", "profile");
  const logs = join(dir, "ArmaReforgerWorkbench", "logs");
  mkdirSync(join(profile, ".save", `app9_user${UID}`, "settings"), { recursive: true });
  mkdirSync(join(profile, "ResourceViewerPresets"), { recursive: true });
  mkdirSync(join(logs, "logs_2026-01-01_00-00-00"), { recursive: true });
  const w = (p: string, text: string): void => writeFileSync(p, text);
  w(join(profile, `.projectList_app9_user${UID}.conf`), `SECRET-CONTENT ${HOME}\\Proj`);
  w(join(profile, `.projectList_app9_user${UID}.conf.bak-2026-01-02`), "SECRET-CONTENT");
  w(
    join(profile, ".save", `app9_user${UID}`, "settings", "ReforgerEngineSettings.conf"),
    "SECRET-CONTENT",
  );
  w(join(profile, "DbgUIState.bin"), "SECRET-CONTENT");
  w(join(profile, "AliceKeybinds.json"), "SECRET-CONTENT");
  w(join(profile, "ResourceViewerPresets", "BobsPreset.pre"), "SECRET-CONTENT");
  w(join(logs, "logs_2026-01-01_00-00-00", "console.log"), "SECRET-CONTENT");
  w(join(logs, "logs_2026-01-01_00-00-00", "error.log"), "SECRET-CONTENT");
  const wikiFile = join(dir, "export.xml");
  w(wikiFile, WIKI_XML);

  const files: Record<string, Buffer | Error> = {
    "z/Upper.ZED": TEXT,
    "z/Mixed.zed": BIN,
    "m/a.zed.meta": Buffer.from(META_TEXT),
    "m/b.zed.meta": Buffer.from(META_TEXT),
    "m/c.png.meta": Buffer.from(META_TEXT_2),
    "m/d.conf.meta": Buffer.from("MetaFileClass {\n}\n"),
    README: TEXT,
    "odd/file.a b": TEXT,
    "c/one.conf": TEXT,
    "c/two.conf": TEXT,
  };
  for (let i = 0; i < 25; i++) files[`z/f${String(i).padStart(2, "0")}.zed`] = TEXT;
  for (let i = 0; i < 30; i++) files[`bin/f${i}.dat`] = BIN;
  for (let i = 0; i < 200; i++) files[`big/f${String(i).padStart(3, "0")}.big`] = TEXT;
  // Three files of the text extension `big` that the 64-file sample misses: only a whole-corpus
  // sniff sees them (a binary one, an empty one, one the VFS cannot read).
  const bigPaths = Object.keys(files).filter((p) => p.endsWith(".big"));
  const bigSample = new Set(seededSample(bigPaths, SNIFF_SAMPLE, "big"));
  const [bigBinary, bigEmpty, bigUnreadable] = bigPaths
    .filter((p) => !bigSample.has(p))
    .sort(compareCodeUnits);
  files[bigBinary] = BIN;
  files[bigEmpty] = Buffer.alloc(0);
  files[bigUnreadable] = new Error("over the cap");
  const bigExceptions = [
    { path: bigBinary, sniff: "binary" },
    { path: bigEmpty, sniff: "empty" },
    { path: bigUnreadable, sniff: "unreadable" },
  ];
  for (let i = 0; i < 4; i++) files[`mix/f${i}.mix`] = i < 2 ? TEXT : BIN;
  files["over/huge.cap"] = new Error("Refusing to read pak entry: over the cap");
  const reads: string[] = [];
  const pak = fakePak(files, reads);
  const deps: Deps = {
    openPaks: () => pak,
    defaultGamePath: () => join(dir, "game"),
    defaultProfileDir: () => profile,
    artifactsRoot: () => join(dir, "artifacts"),
  };
  return {
    dir,
    profile,
    wikiFile,
    artifacts: join(dir, "artifacts"),
    pak,
    reads,
    deps,
    bigExceptions,
  };
}

const worlds: string[] = [];
function world(): World {
  const w = makeWorld();
  worlds.push(w.dir);
  return w;
}
afterAll(() => {
  for (const d of worlds) rmSync(d, { recursive: true, force: true });
});

// ── Pure functions ────────────────────────────────────────────────────────────

describe("e09 extensions and sniffing", () => {
  it("takes the extension after the last dot, lower-cased, and folds date-stamped backups", () => {
    expect(rawExtension("a/b/Thing.ET")).toBe("et");
    expect(rawExtension("x/.projectList_app1_user2.conf.bak-2026-01-02")).toBe("bak");
    expect(rawExtension("x/.gitignore")).toBe("gitignore");
    expect(rawExtension("x/README")).toBeUndefined();
    expect(rawExtension("x/trailing.")).toBeUndefined();
  });

  it("groups by lower-case extension and sets aside paths with no usable extension", () => {
    const g = groupByExt(["a/One.ZED", "b/two.zed", "c/README", "d/x.a b", "e/y.conf"]);
    expect([...g.groups.keys()]).toEqual(["zed", "conf"]);
    expect(g.groups.get("zed")).toEqual(["a/One.ZED", "b/two.zed"]);
    expect(g.noExtension).toEqual(["c/README"]);
    expect(g.oddExtension).toEqual(["d/x.a b"]);
  });

  it("decides text or binary from bytes, not from names", () => {
    expect(sniffBytes(Buffer.from("plain text\r\n\tindented\n"))).toBe("text");
    expect(sniffBytes(Buffer.from([0x41, 0x00, 0x42]))).toBe("binary");
    expect(sniffBytes(Buffer.from([0x41, 0x01, 0x42]))).toBe("binary");
    expect(sniffBytes(Buffer.alloc(0))).toBe("empty");
    expect(sniffBytes(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe("text");
    // Latin-1 comment: not valid UTF-8, still text.
    expect(
      sniffBytes(Buffer.concat([Buffer.from("// caf"), Buffer.from([0xe9]), Buffer.from(" ok\n")])),
    ).toBe("text");
    // Packed bytes with no NUL: mostly high bytes.
    expect(sniffBytes(Buffer.alloc(100, 0xc3))).toBe("binary");
    // Only the first HEAD_BYTES count: a NUL after the window is not seen.
    expect(sniffBytes(Buffer.concat([Buffer.alloc(HEAD_BYTES, 0x61), Buffer.from([0])]))).toBe(
      "text",
    );
  });

  it("samples deterministically: all files when fewer than the size, a fixed subset otherwise", () => {
    const paths = Array.from({ length: 200 }, (_, i) => `p/${i}.x`);
    const a = seededSample(paths, 64, "x");
    expect(a).toHaveLength(64);
    expect(seededSample([...paths].reverse(), 64, "x")).toEqual(a);
    expect(new Set(a).size).toBe(64);
    expect(seededSample(paths, 64, "y")).not.toEqual(a);
    expect(seededSample(["b", "a"], 64, "x")).toEqual(["a", "b"]);
    expect(SNIFF_SAMPLE).toBeGreaterThanOrEqual(20);
  });

  it("classifies an extension by its sampled bytes: text, binary, mixed, unsampled", () => {
    const reads: string[] = [];
    const pak = fakePak(
      {
        ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`t/${i}.t`, TEXT])),
        ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`b/${i}.b`, BIN])),
        "m/0.m": TEXT,
        "m/1.m": BIN,
        "o/0.o": new Error("over the cap"),
        "e/0.e": Buffer.alloc(0),
      },
      reads,
    );
    const g = groupByExt(pak.allFilePaths()).groups;
    const t = classifyExtension("t", g.get("t") ?? [], pak);
    expect(t).toMatchObject({ files: 100, sampled: 64, text: 64, binary: 0, verdict: "text" });
    expect(reads.filter((p) => p.endsWith(".t"))).toHaveLength(64);
    expect(classifyExtension("b", g.get("b") ?? [], pak)).toMatchObject({
      sampled: 30,
      binary: 30,
      verdict: "binary",
    });
    expect(classifyExtension("m", g.get("m") ?? [], pak).verdict).toBe("mixed");
    expect(classifyExtension("o", g.get("o") ?? [], pak)).toMatchObject({
      unreadable: 1,
      verdict: "unsampled",
    });
    expect(classifyExtension("e", g.get("e") ?? [], pak)).toMatchObject({
      empty: 1,
      verdict: "unsampled",
    });
    expect(t.representative).toBe("t/0.t");
    // The sample alone does not scan the rest of the extension.
    expect(t).toMatchObject({ scanned: 0, exceptions: [] });
  });

  it("sniffs a text extension over every file and lists what is not text, keeping the sample's verdict", () => {
    const paths = Array.from({ length: 100 }, (_, i) => `t/${String(i).padStart(3, "0")}.t`);
    const sample = new Set(seededSample(paths, 64, "t"));
    const outside = paths.filter((p) => !sample.has(p));
    // The smallest path (the would-be representative) is an empty file; two more are not text.
    const empty = paths[0];
    const [bin, over] = [outside[1], outside[2]];
    const files: Record<string, Buffer | Error> = Object.fromEntries(paths.map((p) => [p, TEXT]));
    files[empty] = Buffer.alloc(0);
    files[bin] = BIN;
    files[over] = new Error("over the cap");
    const reads: string[] = [];
    const pak = fakePak(files, reads);

    const full = classifyExtension("t", paths, pak, SNIFF_SAMPLE, true);
    expect(full.scanned).toBe(100);
    expect(new Set(reads).size).toBe(100);
    expect(full.exceptions).toEqual(
      [
        { path: empty, sniff: "empty" },
        { path: bin, sniff: "binary" },
        { path: over, sniff: "unreadable" },
      ].sort((a, b) => compareCodeUnits(a.path, b.path)),
    );
    // The per-extension verdict is the sample's; the exceptions are reported beside it.
    expect(full.verdict).toBe("text");
    // A ref never names an exception (here the smallest path is an empty file).
    expect(full.representative).toBe(paths.find((p) => ![empty, bin, over].includes(p)));
    expect(full.representative).not.toBe(empty);
    expect(scanForExceptions(paths, pak)).toEqual(full.exceptions);

    // A binary extension is not scanned in full: nothing to except.
    const binPak = fakePak({ "b/0.b": BIN, "b/1.b": TEXT });
    expect(classifyExtension("b", ["b/0.b", "b/1.b"], binPak, SNIFF_SAMPLE, true)).toMatchObject({
      verdict: "mixed",
      scanned: 0,
      exceptions: [],
    });
  });
});

describe("e09 wiki File Types table", () => {
  const page = extractWikiPage(WIKI_XML, "Arma Reforger:File Types") ?? "";

  it("finds the page among others and decodes XML entities", () => {
    expect(page).toContain("==== .zed ====");
    expect(page).toContain("Zed files & more <!-- hidden -->");
    expect(extractWikiPage(WIKI_XML, "Arma Reforger:Missing")).toBeUndefined();
  });

  it("parses the rows: extension, cells, first description line, one-line quote", () => {
    const rows = parseFileTypesTable(page);
    expect(rows.map((r) => r.ext)).toEqual(["zed", "pre", "wikionly", "conf", "meta"]);
    const zed = rows[0];
    expect(zed.fileType).toBe("Zed document");
    expect(zed.usedBy).toBe("Audio Editor");
    expect(zed.descriptionLine).toBe("Zed files & more");
    expect(
      zed.quote.startsWith(
        "==== .zed ==== | Zed document | {{Link|Arma Reforger:Audio Editor}} | Zed files & more",
      ),
    ).toBe(true);
    expect(zed.quote).not.toContain("\n");
    expect(zed.quote.length).toBeLessThanOrEqual(200);
    expect(rows[2].descriptionLine).toBe("(1.6.0) Wrapper for .wav and Opus files");
    expect(rows[3].descriptionLine).toBe("");
  });

  it("keeps a documented profile path verbatim in the description and the quote (it is not a machine path)", () => {
    const pre = parseFileTypesTable(page)[1];
    const documented = ["%userprofile%", "Documents", "My Games", "X", "profile", "Presets"].join(
      "\\",
    );
    expect(pre.descriptionLine).toBe(`A preset (usually saved in ${documented})`);
    expect(pre.quote).toBe(
      `==== .pre ==== | Preset | Resource Browser | A preset (usually saved in {{hl|${documented}}})`,
    );
    expect(containsMachinePath(pre.quote)).toBe(false);
    expect(pre.quote).not.toContain("<path>");
  });

  it("gives each row the module of the one editor its Saved/Used by cell names", () => {
    const rows = parseFileTypesTable(page);
    expect(rows.map((r) => [r.ext, r.module])).toEqual([
      ["zed", "AudioEditor"],
      ["pre", "none"],
      ["wikionly", "none"],
      ["conf", "ResourceManager.Config"],
      ["meta", "ResourceManager"],
    ]);
  });

  it("maps editor names by the vocabulary: one editor names a module, anything else is none", () => {
    const table: [string, string][] = [
      ["Animation Editor", "AnimEditor"],
      ["Animation Editor + various plugins", "AnimEditor"],
      ["Procedural Animation Editor", "ProcAnimEditor"],
      ["Audio Editor", "AudioEditor"],
      ["Particle Editor", "ParticleEditor"],
      ["String Editor", "LocalizationEditor"],
      ["Behavior Editor", "BehaviorEditor"],
      ["World Editor", "WorldEditor"],
      ["Script Editor", "ScriptEditor"],
      ["Resource Manager", "ResourceManager"],
      ["Resource Manager's Config Editor", "ResourceManager.Config"],
      ["Config Editor", "ResourceManager.Config"],
      ["Resource Manager's Texture Editor", "ResourceManager.Texture"],
      ["Resource Manager's Font Viewer", "ResourceManager.Font"],
      ["Resource Manager's Imageset Editor", "ResourceManager.Imageset"],
      ["Resource Manager's Layout Editor", "ResourceManager.Layout"],
      ["Resource Manager's Styles Editor", "ResourceManager.Styles"],
      ["Navmesh Generator Tool", "NavmeshGeneratorMain"],
      // Several editors, none, or a name outside the vocabulary: no module.
      ["World Editor + Script Editor", "none"],
      ["Animation Editor and Audio Editor", "none"],
      ["Resource Manager + Animation Editor", "none"],
      ["Workbench", "none"],
      ["Resource Browser", "none"],
      ["Resource Browser + various plugins (see Enfusion Blender Tools)", "none"],
      ["Art Tools", "none"],
      ["3D software", "none"],
      ["Audio software", "none"],
      ["Animation offline debugger", "none"],
      ["Proprietary format", "none"],
      ["", "none"],
    ];
    for (const [cell, module] of table)
      expect([cell, moduleForUsedBy(cell)]).toEqual([cell, module]);
  });

  it("removes wiki markup", () => {
    expect(cleanWikiText("{{Link|A:B|Label}} and [[Page|shown]] and '''bold''' x<br>y")).toBe(
      "Label and shown and bold x y",
    );
    expect(cleanWikiText("{{GameCategory|armaR|Modding|text= Workbench}}")).toBe("Workbench");
    expect(cleanWikiText("{{Feature|informative|Only import.}}")).toBe("Only import.");
  });
});

describe("e09 .meta resource classes", () => {
  it("names the blocks opened directly under Configurations, and nothing else", () => {
    const hits = extractMetaClasses(META_TEXT);
    expect(hits.map((h) => h.name)).toEqual(["XOBResourceClass", "XOBResourceClass"]);
    expect(hits[0].line).toBe("XOBResourceClass PC {");
    // Braces inside quoted strings do not count; a block outside Configurations is not a class.
    const tricky =
      'MetaFileClass {\n Name "}{"\n Other {\n  Inner {\n  }\n }\n Configurations {\n  FooResourceClass PC {\n  }\n }\n}\n';
    expect(extractMetaClasses(tricky).map((h) => h.name)).toEqual(["FooResourceClass"]);
    expect(extractMetaClasses("")).toEqual([]);
  });

  it("reads every .meta file and reports classes with their counts and resource extensions", () => {
    const pak = fakePak({
      "m/a.xob.meta": Buffer.from(META_TEXT),
      "m/b.xob.meta": Buffer.from(META_TEXT),
      "m/c.edds.meta": Buffer.from(META_TEXT_2),
      "m/d.conf.meta": Buffer.from("MetaFileClass {\n}\n"),
      "m/e.et.meta": new Error("over the cap"),
    });
    const m = censusMeta(pak.allFilePaths(), pak);
    expect(m).toMatchObject({ total: 5, read: 4, unreadable: 1, withoutClass: 1 });
    expect(m.classes.map((c) => c.name)).toEqual(["PNGResourceClass", "XOBResourceClass"]);
    expect(m.classes[1]).toMatchObject({ files: 2, exts: ["xob"], firstPath: "m/a.xob.meta" });
    expect(m.classes[0].exts).toEqual(["edds"]);
  });
});

describe("e09 profile listing (names only)", () => {
  it("replaces a Steam id and every name Workbench did not write itself", () => {
    expect(sanitizeSegment(`.projectList_app9_user${UID}.conf`, false)).toBe(
      ".projectList_app9_user<steamid>.conf",
    );
    expect(sanitizeSegment(`app9_user${UID}`, true)).toBe("app9_user<steamid>");
    expect(sanitizeSegment("DbgUIState.bin", false)).toBe("DbgUIState.bin");
    expect(sanitizeSegment("AliceKeybinds.json", false)).toBe("<name>.json");
    expect(sanitizeSegment("BobsPreset.pre", false)).toBe("<name>.pre");
    expect(sanitizeSegment("Bobs Folder", true)).toBe("<dir>");
    expect(PROJECT_LIST_FILE.test(".projectList_app9_user<steamid>.conf")).toBe(true);
  });

  it("lists the profile and the logs sibling without a name, a Steam id, a path or a content byte", () => {
    const w = world();
    const listing = listProfile(w.profile);
    expect(listing.profile).toEqual(
      [
        ".projectList_app9_user<steamid>.conf",
        ".projectList_app9_user<steamid>.conf.bak-2026-01-02",
        ".save/app9_user<steamid>/settings/ReforgerEngineSettings.conf",
        "<name>.json",
        "DbgUIState.bin",
        "ResourceViewerPresets/<name>.pre",
      ].sort(compareCodeUnits),
    );
    expect(listing.logs).toEqual(["console.log", "error.log"]);
    const text = listingText(listing);
    for (const bad of [UID, "Alice", "Bob", "SECRET", "Someone", "2026-01-01", "tmp", "e09-"]) {
      expect(text).not.toContain(bad);
    }
    expect(() => assertNoPii([text])).not.toThrow();
  });

  it("reduces the listing to distinct extensions and file-role names: no count, no date, no directory", () => {
    const w = world();
    const roles = profileRoles(listProfile(w.profile));
    expect(roles.extensions).toEqual(["bak", "bin", "conf", "json", "log", "pre"]);
    expect(roles.roles).toEqual(
      [
        ".projectList_app9_user<steamid>.conf",
        ".projectList_app9_user<steamid>.conf.bak-<date>",
        "ReforgerEngineSettings.conf",
        "<name>.json",
        "<name>.pre",
        "DbgUIState.bin",
        "console.log",
        "error.log",
      ].sort(compareCodeUnits),
    );
    expect(roleName(".projectList_app9_user<steamid>.conf.bak-2026-05-06")).toBe(
      ".projectList_app9_user<steamid>.conf.bak-<date>",
    );
    expect(rawExtension(".projectList_app9_user<steamid>.conf.bak-<date>")).toBe("bak");
    const text = rolesText(roles);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(roles.roles.some((r) => r.includes("/"))).toBe(false);
    for (const bad of [UID, "Alice", "Bob", "SECRET", "Someone"]) expect(text).not.toContain(bad);
  });

  it("gives the same reduced listing, hash and rows when only the volatile files differ", () => {
    const a = world();
    const b = world();
    // Another session: more log folders, repeated log names, an older and a newer backup.
    const logs = join(b.dir, "ArmaReforgerWorkbench", "logs");
    for (const d of ["logs_2026-02-03_04-05-06", "logs_2026-03-04_05-06-07"]) {
      mkdirSync(join(logs, d), { recursive: true });
      for (const f of ["console.log", "error.log"]) writeFileSync(join(logs, d, f), "x");
    }
    for (const day of ["2026-02-09", "2026-03-10", "2026-04-11"]) {
      writeFileSync(join(b.profile, `.projectList_app9_user${UID}.conf.bak-${day}`), "x");
    }
    expect(listingText(listProfile(b.profile))).not.toBe(listingText(listProfile(a.profile)));
    const rolesA = rolesText(profileRoles(listProfile(a.profile)));
    expect(rolesText(profileRoles(listProfile(b.profile)))).toBe(rolesA);
    const text = (w: World): string => {
      const m = buildModel({
        build: "9.9.9.9",
        pak: w.pak,
        wikiXml: WIKI_XML,
        profile: listProfile(w.profile),
      });
      return observationFileText(buildRows(m), "9.9.9.9", modelInputs(m, sha256(WIKI_XML)));
    };
    expect(text(b)).toBe(text(a));
  });
});

describe("e09 rows", () => {
  function model(w: World, withProfile = true) {
    return buildModel({
      build: "9.9.9.9",
      pak: w.pak,
      wikiXml: WIKI_XML,
      profile: withProfile ? listProfile(w.profile) : undefined,
    });
  }

  it("counts, sniffs and cross-checks the three sources", () => {
    const w = world();
    const m = model(w);
    const h = headline(m);
    expect(h.files).toBe(270);
    expect(h.noExtension).toBe(1);
    expect(h.oddExtension).toBe(1);
    expect(m.pak.get("zed")).toMatchObject({ files: 27, verdict: "mixed" });
    expect(m.pak.get("dat")).toMatchObject({ files: 30, verdict: "binary" });
    // The sample says text; the whole-corpus sniff finds three files that are not (and says so).
    expect(m.pak.get("big")).toMatchObject({
      files: 200,
      sampled: 64,
      verdict: "text",
      scanned: 200,
      exceptions: w.bigExceptions,
    });
    expect(m.pak.get("big")?.representative).toBe("big/f000.big");
    expect(h.sniffExceptions).toEqual(w.bigExceptions.map((e) => ({ ext: "big", ...e })));
    // Extensions that are not text-verdict are not scanned in full.
    expect(m.pak.get("zed")).toMatchObject({ scanned: 0, exceptions: [] });
    expect(m.pak.get("dat")).toMatchObject({ scanned: 0, exceptions: [] });
    expect(m.pak.get("conf")).toMatchObject({ scanned: 2, exceptions: [] });
    expect(m.pak.get("mix")?.verdict).toBe("mixed");
    expect(m.pak.get("cap")?.verdict).toBe("unsampled");
    expect(h.wikiRows).toBe(5);
    expect(h.wikiNotInPaks).toEqual(["pre", "wikionly"]);
    expect(h.paksNotInWiki).toEqual(["big", "cap", "dat", "mix"]);
    expect(h.profileOnly).toEqual(["bak", "bin", "json", "log"]);
    expect(h.metaFiles).toBe(4);
    expect(h.metaClasses).toBe(2);
  });

  it("writes one row per extension: what, ref, quote, module, confidence", () => {
    const w = world();
    const m = model(w);
    const rows = buildRows(m);
    const by = (ext: string) => rows.find((r) => r.id === `file:.${ext}`)?.obs;
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort(compareCodeUnits));
    expect(allExtensions(m)).toEqual([
      "bak",
      "big",
      "bin",
      "cap",
      "conf",
      "dat",
      "json",
      "log",
      "meta",
      "mix",
      "pre",
      "wikionly",
      "zed",
    ]);

    // Pak extension with a wiki row: pak ref, wiki quote, wiki description, counts from the listing.
    const zed = by("zed");
    expect(zed).toMatchObject({
      dim: "file",
      kind: "file-type",
      module: "AudioEditor",
      key: { ext: "zed" },
      parent_key: null,
      label: ".zed",
      origin: "vanilla",
      confidence: "high",
      ref: "pak:z/Mixed.zed",
    });
    expect(zed?.what).toBe("27 files in the 9.9.9.9 paks; mixed; Zed files & more");
    expect(zed?.quote?.startsWith("==== .zed ====")).toBe(true);

    // Pak-only: no quote, module none, "unsampled" is never a measurement the sample did not make.
    expect(by("dat")).toMatchObject({
      module: "none",
      ref: "pak:bin/f0.dat",
      what: "30 files in the 9.9.9.9 paks; binary",
    });
    expect(by("dat")?.quote).toBeUndefined();
    expect(by("cap")?.what).toBe("1 file in the 9.9.9.9 paks; unsampled");

    // Module: the editor the wiki's Saved/Used by cell names; none when the wiki lists no such cell.
    expect(rows.map((r) => [r.id, r.obs.module])).toEqual(
      [
        ["file:.bak", "none"],
        ["file:.big", "none"],
        ["file:.bin", "none"],
        ["file:.cap", "none"],
        ["file:.conf", "ResourceManager.Config"],
        ["file:.dat", "none"],
        ["file:.json", "none"],
        ["file:.log", "none"],
        ["file:.meta", "ResourceManager"],
        ["file:.mix", "none"],
        ["file:.pre", "none"],
        ["file:.wikionly", "none"],
        ["file:.zed", "AudioEditor"],
        ["file:resource-class/PNGResourceClass", "ResourceManager"],
        ["file:resource-class/XOBResourceClass", "ResourceManager"],
      ].sort((a, b) => compareCodeUnits(a[0], b[0])),
    );

    // A text extension with whole-corpus exceptions says so in `unverified`; the paths stay in the artifacts table.
    expect(by("big")?.unverified).toEqual([
      "whole-corpus sniff: 3 of 200 files are not text (1 binary, 1 empty, 1 unreadable); the text verdict is the seeded sample's of 64; paths are in the E09 artifacts table pak-extensions.json",
    ]);
    expect(JSON.stringify(by("big"))).not.toContain(w.bigExceptions[0].path);
    expect(by("big")?.ref).toBe("pak:big/f000.big");
    expect(rows.filter((r) => r.obs.unverified).map((r) => r.id)).toEqual(["file:.big"]);

    // Wiki-only: wiki ref with the anchor, zero files in the paks, and the profile count when the profile has any.
    expect(by("wikionly")).toMatchObject({
      ref: "wiki:Arma_Reforger:File_Types#.wikionly",
      what: "0 files in the 9.9.9.9 paks; unsampled; (1.6.0) Wrapper for .wav and Opus files",
      confidence: "high",
    });
    // The .pre quote is the wiki row verbatim: the documented profile path is not a machine path.
    const documented = ["%userprofile%", "Documents", "My Games", "X", "profile", "Presets"].join(
      "\\",
    );
    expect(by("pre")?.what).toBe(
      `0 files in the 9.9.9.9 paks; unsampled; A preset (usually saved in ${documented}); in the Workbench profile listing as <name>.pre`,
    );
    expect(by("pre")?.quote).toBe(
      `==== .pre ==== | Preset | Resource Browser | A preset (usually saved in {{hl|${documented}}})`,
    );

    // Profile-only: an artifact ref (sha256 of the reduced listing) with a role name, medium confidence,
    // and a description that names the roles and counts nothing.
    const sha = sha256(rolesText(profileRoles(listProfile(w.profile))));
    expect(by("bin")).toMatchObject({
      ref: `artifact:${sha}#DbgUIState.bin`,
      confidence: "medium",
      what: "0 files in the 9.9.9.9 paks; unsampled; in the Workbench profile listing as DbgUIState.bin",
    });
    expect(by("bak")?.ref).toBe(`artifact:${sha}#.projectList_app9_user<steamid>.conf.bak-<date>`);
    expect(by("log")?.ref).toBe(`artifact:${sha}#console.log`);
    expect(by("log")?.what).toBe(
      "0 files in the 9.9.9.9 paks; unsampled; in the Workbench profile listing as console.log, error.log",
    );
    for (const ext of ["bak", "bin", "json", "log", "conf", "pre"]) {
      expect(by(ext)?.what, ext).not.toMatch(/\d+ files? in the Workbench profile/);
    }
    // A pak extension also seen in the profile gets the roles, not a count.
    expect(by("json")?.what).toBe(
      "0 files in the 9.9.9.9 paks; unsampled; in the Workbench profile listing as <name>.json",
    );
    expect(by("conf")?.what).toBe(
      "2 files in the 9.9.9.9 paks; text; in the Workbench profile listing as .projectList_app9_user<steamid>.conf, ReforgerEngineSettings.conf",
    );

    // The project-list file gets the file-format path; no other row does.
    expect(by("conf")?.paths_proposed).toEqual([
      { path: "file-format", reason: "register a project with the launcher" },
    ]);
    expect(rows.filter((r) => r.obs.paths_proposed).map((r) => r.id)).toEqual(["file:.conf"]);
    expect(
      buildRows(model(w, false)).find((r) => r.id === "file:.conf")?.obs.paths_proposed,
    ).toBeUndefined();
  });

  it("writes one resource-class row per distinct class, under the .meta file-type row", () => {
    const w = world();
    const m = model(w);
    const rows = buildRows(m);
    const classes = rows.filter((r) => r.obs.kind === "resource-class");
    expect(classes.map((r) => r.id)).toEqual([
      "file:resource-class/PNGResourceClass",
      "file:resource-class/XOBResourceClass",
    ]);
    expect(classes[1].obs).toMatchObject({
      key: { name: "XOBResourceClass" },
      label: "XOBResourceClass",
      module: "ResourceManager",
      parent_key: {
        dim: "file",
        kind: "file-type",
        module: "ResourceManager",
        key: { ext: "meta" },
      },
      ref: "pak:m/a.zed.meta",
      quote: "XOBResourceClass PC {",
      what: "2 .meta files in the 9.9.9.9 paks name this class; resource extensions: zed",
    });
    expect(rows.find((r) => r.id === "file:.meta")?.obs.children_count).toBe(2);
    expect(m.meta).toMatchObject({ total: 4, read: 4, withoutClass: 1 });
  });

  it("is deterministic: a second build of the same inputs is byte-identical", () => {
    const w = world();
    const text = (): string => {
      const m = model(w);
      return observationFileText(buildRows(m), "9.9.9.9", modelInputs(m, sha256(WIKI_XML)));
    };
    expect(text()).toBe(text());
    const lines = text().trim().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      $header: 1,
      enumerator: "E09",
      generator: GENERATOR,
      provisional: false,
      row_count: lines.length - 1,
    });
    expect(JSON.parse(lines[0]).inputs.map((i: { path: string }) => i.path)).toEqual([
      "<game>/addons/**/*.pak (virtual file listing, sorted)",
      "<repo>/data/wiki/export.xml",
      "%USERPROFILE%/Documents/My Games/ArmaReforgerWorkbench (distinct extensions and file roles, sanitised)",
    ]);
  });

  it("refuses output that holds a machine path or a Steam id", () => {
    expect(() => assertNoPii([{ ref: `pak:${HOME}\\x` }])).toThrow(/machine path/);
    expect(() => assertNoPii([{ ref: `artifact:ab#x/${UID}/y` }])).toThrow(/Steam id/);
    expect(() =>
      assertNoPii([{ ref: "artifact:ab#.projectList_app9_user<steamid>.conf" }]),
    ).not.toThrow();
  });
});

// ── Corpus baseline ───────────────────────────────────────────────────────────

describe("e09 corpus baseline", () => {
  /** Parses only text that starts with a name and a brace; serialises back with one trailing space dropped or not. */
  const parser: TextParser = {
    parse: (t) => {
      if (!/^\w+ \{/.test(t)) throw new Error("Expected OpenBrace at pos 5");
      return t;
    },
    serialize: (n) => (n as string).replace(/\n\n$/, "\n"),
  };

  it("counts what parses and what round-trips byte-exact, per text extension", () => {
    const exact = Buffer.from("Node {\n}\n");
    const loose = Buffer.from("Node {\n}\n\n");
    const pak = fakePak({
      "a/1.agf": exact,
      "a/2.agf": loose,
      "a/3.agf": Buffer.from("not a node"),
      "a/4.agf": Buffer.alloc(0),
      "a/5.agf": new Error("over the cap"),
      "b/1.acp": exact,
      "c/1.bin": BIN,
    });
    const census = new Map(
      [...groupByExt(pak.allFilePaths()).groups].map(([ext, files]) => [
        ext,
        classifyExtension(ext, files, pak),
      ]),
    );
    const b = measureCorpus("9.9.9.9", pak, census, { parser });
    expect(b.scope).toBe("whole-corpus");
    expect(b.extensions.map((e) => e.ext)).toEqual(["acp", "agf"]);
    expect(b.extensions[1]).toMatchObject({
      files_total: 5,
      files_measured: 5,
      unreadable: 1,
      empty: 1,
      text_files: 3,
      parsed: 2,
      parse_failed: 1,
      round_trip_exact: 1,
    });
    expect(b.extensions[1].top_errors).toEqual([
      { message: "Expected OpenBrace at pos #", count: 1 },
    ]);
    expect(b.totals).toEqual({ text_files: 4, parsed: 3, parse_failed: 1, round_trip_exact: 2 });
    expect(b.groups.map((g) => g.name)).toEqual(PLAN_GROUPS.map((g) => g.name));
    expect(b.groups[0]).toMatchObject({ text_files: 3, parsed: 2, round_trip_exact: 1 });
    expect(b.groups[1]).toMatchObject({ text_files: 1, parsed: 1, round_trip_exact: 1 });
    expect(JSON.stringify(measureCorpus("9.9.9.9", pak, census, { parser }))).toBe(
      JSON.stringify(b),
    );
  });

  it("measures a seeded sample when asked, the same files every time", () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 400; i++) files[`t/${i}.agf`] = Buffer.from("Node {\n}\n");
    const pak = fakePak(files);
    const census = new Map([["agf", classifyExtension("agf", pak.allFilePaths(), pak)]]);
    const a = measureCorpus("9.9.9.9", pak, census, { parser, samplePerExt: 300 });
    expect(a).toMatchObject({ scope: "seeded-sample", sample_per_ext: 300 });
    expect(a.extensions[0]).toMatchObject({
      files_total: 400,
      files_measured: 300,
      round_trip_exact: 300,
    });
    expect(measureCorpus("9.9.9.9", pak, census, { parser, samplePerExt: 300 })).toEqual(a);
  });
});

// ── The CLI and the ledger ────────────────────────────────────────────────────

describe("e09 run", () => {
  function args(w: World, extra: string[] = []): string[] {
    return [
      "--build",
      "9.9.9.9",
      "--wiki",
      w.wikiFile,
      "--profile",
      w.profile,
      "--artifacts",
      w.artifacts,
      ...extra,
    ];
  }
  const go = (fx: ReturnType<typeof makeCensus>, w: World, extra: string[] = []) =>
    runIn(fx, (argv, io) => runE09(argv, io, w.deps), args(w, extra));

  it("writes only observations/E09 and the artifacts folder, and the ledger accepts the file", () => {
    const fx = makeCensus("9.9.9.9");
    const w = world();
    const r = go(fx, w, ["--baseline"]);
    expect(r.code, r.stderr).toBe(0);
    const file = join(fx.paths.observations, "E09", "9.9.9.9.jsonl");
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(join(fx.paths.observations))).toEqual(["E09"]);
    const art = join(w.artifacts, "census", "9.9.9.9", "E09");
    expect(readdirSync(art).sort()).toEqual([
      "corpus-baseline.json",
      "meta-classes.json",
      "pak-extensions.json",
      "profile-listing.json",
      "profile-roles.json",
    ]);
    // The sha256 an artifact ref names is the sha256 of the saved reduced listing (roles), not the raw one.
    const sha = sha256(readFileSync(join(art, "profile-roles.json")));
    expect(sha).not.toBe(sha256(readFileSync(join(art, "profile-listing.json"))));
    // The artifacts table names every whole-corpus exception by path.
    const table = JSON.parse(readFileSync(join(art, "pak-extensions.json"), "utf-8"));
    expect(table.sniff_exceptions).toEqual(w.bigExceptions.map((e) => ({ ext: "big", ...e })));
    expect(table.extensions.find((e: { ext: string }) => e.ext === "big").exceptions).toEqual(
      w.bigExceptions,
    );
    expect(readFileSync(file, "utf-8")).toContain(`artifact:${sha}#DbgUIState.bin`);
    for (const f of [file, ...readdirSync(art).map((n) => join(art, n))]) {
      const text = readFileSync(f, "utf-8");
      for (const bad of [UID, "Alice", "Bob", "SECRET", "Someone", "C:\\"])
        expect(text, `${f} holds ${bad}`).not.toContain(bad);
    }
    const built = buildLedger(fx.paths, { build: "9.9.9.9" });
    expect(built.rejected).toEqual([]);
    expect(built.problems.filter((p) => p.message.includes("file:"))).toEqual([]);
    expect(built.rows.filter((row) => row.id.startsWith("file:")).length).toBe(13 + 2);
    expect(built.rows.find((row) => row.id === "file:.zed")?.sources[0]).toMatchObject({
      enumerator: "E09",
      confidence: "high",
    });
    expect(
      built.rows.find((row) => row.id === "file:resource-class/XOBResourceClass")?.parent,
    ).toBe("file:.meta");
  });

  it("is byte-identical on a second run", () => {
    const fx = makeCensus("9.9.9.9");
    const w = world();
    go(fx, w);
    const file = join(fx.paths.observations, "E09", "9.9.9.9.jsonl");
    const first = readFileSync(file, "utf-8");
    const listing = readFileSync(
      join(w.artifacts, "census", "9.9.9.9", "E09", "profile-listing.json"),
      "utf-8",
    );
    go(fx, w);
    expect(readFileSync(file, "utf-8")).toBe(first);
    expect(
      readFileSync(join(w.artifacts, "census", "9.9.9.9", "E09", "profile-listing.json"), "utf-8"),
    ).toBe(listing);
  });

  it("answers NO DATA when there is no pak or no wiki export, and still writes nothing", () => {
    const fx = makeCensus("9.9.9.9");
    const w = world();
    const noPak = runIn(
      fx,
      (argv, io) => runE09(argv, io, { ...w.deps, openPaks: () => null }),
      args(w),
    );
    expect(noPak.code).toBe(2);
    expect(noPak.stdout).toContain("NO DATA");
    const noWiki = go(fx, w, ["--wiki", join(w.dir, "absent.xml")]);
    expect(noWiki.code).toBe(2);
    expect(existsSync(join(fx.paths.observations, "E09"))).toBe(false);
    // The real opener reports an install without paks as absent, not as an empty listing.
    expect(REAL_DEPS.openPaks(join(w.dir, "no-such-game"))).toBeNull();
    const absent = runIn(
      fx,
      (argv, io) =>
        runE09(argv, io, { ...REAL_DEPS, defaultGamePath: () => join(w.dir, "no-game") }),
      ["--wiki", w.wikiFile, "--profile", w.profile, "--artifacts", w.artifacts],
    );
    expect(absent.code).toBe(2);
    expect(absent.stdout).toContain("NO DATA");
  });

  it("refuses an output outside observations/E09, an artifacts folder inside a git tree, and a bad sample size", () => {
    const fx = makeCensus("9.9.9.9");
    const w = world();
    expect(go(fx, w, ["--out", join(fx.root, "ledger.jsonl")]).code).toBe(1);
    const inside = go(fx, w, ["--artifacts", join(REPO_ROOT, "e09-should-not-exist")]);
    expect(inside.code).toBe(1);
    expect(inside.stderr).toContain("git working tree");
    expect(existsSync(join(REPO_ROOT, "e09-should-not-exist"))).toBe(false);
    expect(go(fx, w, ["--sample", "5"]).code).toBe(2);
  });

  it("works without a profile directory (the machine-local source is optional)", () => {
    const fx = makeCensus("9.9.9.9");
    const w = world();
    const r = go(fx, w, ["--profile", join(w.dir, "no-such-profile")]);
    expect(r.code, r.stderr).toBe(0);
    const text = readFileSync(join(fx.paths.observations, "E09", "9.9.9.9.jsonl"), "utf-8");
    expect(text).not.toContain("artifact:");
    expect(text).not.toContain("names-only listing");
    expect(buildLedger(fx.paths, { build: "9.9.9.9" }).rejected).toEqual([]);
  });

  it("refuses to write when a pak path would put a Steam id into a ref", () => {
    const fx = makeCensus("9.9.9.9");
    const w = world();
    const pak = fakePak({ [`dump/${UID}/a.zzz`]: TEXT });
    const r = runIn(
      fx,
      (argv, io) => runE09(argv, io, { ...w.deps, openPaks: () => pak }),
      args(w),
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Steam id");
    expect(existsSync(join(fx.paths.observations, "E09"))).toBe(false);
  });
});

// ── The real install (skipped when the game is absent) ────────────────────────

const GAME = ((): string | undefined => {
  try {
    return loadConfig().gamePath;
  } catch {
    return undefined;
  }
})();
const REAL = GAME !== undefined && existsSync(join(GAME, "addons"));
const WIKI_FILE = join(REPO_ROOT, "data", "wiki", "export.xml");

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !REAL || !existsSync(WIKI_FILE))("e09 real install at build 1.8.0.13", () => {
  let pak: PakSource;
  let model: ReturnType<typeof buildModel>;
  beforeAll(() => {
    const opened = REAL_DEPS.openPaks(GAME as string);
    if (!opened) throw new Error("no paks");
    pak = opened;
    // The sample only: the whole-corpus sniff runs in its own (chunked) test below, so that this
    // synchronous setup does not block the worker for minutes.
    model = buildModel({
      build: "1.8.0.13",
      pak,
      wikiXml: readFileSync(WIKI_FILE, "utf-8"),
      fullSniff: false,
    });
  }, 300_000);

  it("finds the four files of text extensions that the whole-corpus sniff says are not text", async () => {
    const found: { ext: string; path: string; sniff: string }[] = [];
    const files = groupByExt(pak.allFilePaths()).groups;
    for (const [ext, c] of model.pak) {
      if (c.verdict !== "text") continue;
      const all = [...(files.get(ext) ?? [])].sort(compareCodeUnits);
      for (let i = 0; i < all.length; i += 1_000) {
        for (const e of scanForExceptions(all.slice(i, i + 1_000), pak)) found.push({ ext, ...e });
        await new Promise((r) => setImmediate(r));
      }
    }
    expect(found).toEqual([
      {
        ext: "c",
        path: "scripts/Game/AI/ScriptedNodes/Generated/SendOrderMortar.c",
        sniff: "empty",
      },
      {
        ext: "c",
        path: "scripts/Game/GameMode/Tutorial/Stages/Conflict/SCR_Tutorial_Seizing_OpenRadioMenu.c",
        sniff: "empty",
      },
      {
        ext: "c",
        path: "scripts/Game/GameMode/Tutorial/Stages/Conflict/SCR_Tutorial_Seizing_TAKE_RADIO.c",
        sniff: "empty",
      },
      {
        ext: "et",
        path: "PrefabsEditable/Auto/Compositions/Misc/SubCompositions/E_BarbedCoil_Cluttered_USSR_01.et",
        sniff: "binary",
      },
    ]);
  }, 600_000);

  it("gives each file type the module of the editor the wiki names for it", () => {
    const module = new Map(buildRows(model).map((r) => [r.id, r.obs.module]));
    const expected: Record<string, string> = {
      c: "ScriptEditor",
      et: "WorldEditor",
      ent: "WorldEditor",
      agf: "AnimEditor",
      anm: "AnimEditor",
      acp: "AudioEditor",
      ptc: "ParticleEditor",
      st: "LocalizationEditor",
      bt: "BehaviorEditor",
      pap: "ProcAnimEditor",
      conf: "ResourceManager.Config",
      physmat: "ResourceManager.Config",
      edds: "ResourceManager.Texture",
      fnt: "ResourceManager.Font",
      imageset: "ResourceManager.Imageset",
      layout: "ResourceManager.Layout",
      styles: "ResourceManager.Styles",
      emat: "ResourceManager",
      meta: "ResourceManager",
      nmn: "NavmeshGeneratorMain",
      pre: "none",
      xob: "none",
      pak: "none",
      rdb: "none",
      adeb: "none",
      cso: "none",
      json: "none",
    };
    for (const [ext, mod] of Object.entries(expected))
      expect([ext, module.get(`file:.${ext}`)]).toEqual([ext, mod]);
  });

  it("keeps the .pre quote as the wiki row, with its documented profile path", () => {
    const pre = buildRows(model).find((r) => r.id === "file:.pre")?.obs;
    expect(
      pre?.quote?.startsWith(
        "==== .pre ==== | ResourceViewer Preset | Resource Browser | A preset",
      ),
    ).toBe(true);
    expect(pre?.quote).toContain("%userprofile%");
    expect(pre?.quote).not.toContain("<path>");
    expect(pre?.quote?.length).toBeLessThanOrEqual(200);
  });

  it("reproduces the headline counts", () => {
    const h = headline(model);
    expect(h.files).toBe(222_572);
    expect(h.noExtension).toBe(0);
    expect(h.oddExtension).toBe(0);
    expect(h.pakExtensions).toBe(47);
    expect({ text: h.text, binary: h.binary, mixed: h.mixed, unsampled: h.unsampled }).toEqual({
      text: 29,
      binary: 18,
      mixed: 0,
      unsampled: 0,
    });
    expect(h.wikiRows).toBe(56);
    expect(h.wikiNotInPaks).toEqual([
      "adeb",
      "asc",
      "bterr",
      "bttile",
      "dds",
      "desc",
      "fbx",
      "gproj",
      "layer",
      "meta",
      "pak",
      "pre",
      "rdb",
      "st",
      "ttf",
      "txa",
      "txo",
    ]);
    expect(h.paksNotInWiki).toEqual(["aex", "cso", "json", "ntile", "pso", "smd", "txt", "vso"]);
    // Without a profile: the paks' 47 plus the 17 the wiki alone names.
    expect(h.allExtensions).toBe(64);
    expect(h.metaFiles).toBe(0);
    expect(h.metaClasses).toBe(0);
    expect(model.pak.get("ntile")).toMatchObject({ files: 93_337, verdict: "binary" });
    expect(model.pak.get("c")).toMatchObject({ files: 6_568, verdict: "text" });
    expect(model.pak.get("et")).toMatchObject({ files: 19_448, verdict: "text" });
    expect(model.pak.get("ent")?.verdict).toBe("binary");
    expect(buildRows(model)).toHaveLength(64);
  }, 300_000);

  it("reproduces the round-trip scoreboard of plan 2.1 finding 5 over the whole of those corpora", () => {
    const wanted = new Set(PLAN_GROUPS.flatMap((g) => g.exts));
    const census = new Map([...model.pak].filter(([ext]) => wanted.has(ext)));
    const b = measureCorpus("1.8.0.13", pak, census);
    expect(b.groups[0]).toMatchObject({ text_files: 963, parsed: 963, round_trip_exact: 371 });
    expect(b.groups[1]).toMatchObject({ text_files: 1_406, parsed: 1_406, round_trip_exact: 4 });
  }, 300_000);
});
