import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EDITOR_ONLY_MODULES,
  WEB_PREFIX,
  buildLink,
  formatLink,
  innerLink,
  numberText,
  parseLink,
  worldFieldOf,
  worldKey,
  type BuildFields,
  type LinkKind,
  type ParsedLink,
} from "../../src/formats/enfusion-link.js";
import { VocabularyError } from "../../src/manifest/vocabulary.js";
import { REPO_ROOT, loadBaseline, openVanillaCorpus } from "../corpus/_corpus.js";

const WORLD =
  "enfusion://WorldEditor/~ArmaReforger:worlds/Arland/Arland.ent;1000.5,25.25,2000;-30,45,0;0.5,2024,6,1;0x0000123400005678";
const RM = "enfusion://ResourceManager/~ArmaReforger:Configs/Factions/BLUFOR.conf";
const SE = "enfusion://ScriptEditor/scripts/Game/game.c;1175";

function refuses(link: string, why?: RegExp): void {
  let err: unknown;
  try {
    parseLink(link);
  } catch (e) {
    err = e;
  }
  expect(err, `expected '${link}' to be refused`).toBeInstanceOf(VocabularyError);
  expect((err as VocabularyError).code).toBe("INVALID_ARGUMENT");
  if (why) expect((err as VocabularyError).message).toMatch(why);
}

/** The fields buildLink takes to write a parsed link again. */
function fieldsOf(p: ParsedLink): BuildFields {
  const f: BuildFields = { kind: p.kind as Exclude<LinkKind, "web">, webPrefix: p.webPrefix };
  if (p.kind === "editor") f.module = p.module;
  if (p.kind === "world") {
    f.world = p.world;
    if (p.pos) f.pos = p.pos.text;
    if (p.angles) f.angles = p.angles.text;
    if (p.time) f.time = p.time.text;
    if (p.entity) f.entity = p.entity;
  }
  if (p.kind === "resource" || p.kind === "script") {
    f.path = p.path;
    if (p.addon !== undefined) f.addon = p.addon;
    if (p.line !== undefined) f.line = p.line;
  }
  return f;
}

describe("parse", () => {
  it("reads a full World Editor link", () => {
    const p = parseLink(WORLD);
    expect(p.kind).toBe("world");
    expect(p.module).toBe("WorldEditor");
    expect(p.world).toBe("~ArmaReforger:worlds/Arland/Arland.ent");
    expect(p.addon).toBe("ArmaReforger");
    expect(p.path).toBe("worlds/Arland/Arland.ent");
    expect(p.pos?.values).toEqual([1000.5, 25.25, 2000]);
    expect(p.angles?.values).toEqual([-30, 45, 0]);
    expect(p.time).toEqual({ text: "0.5,2024,6,1", daytime: 0.5, year: 2024, month: 6, day: 1 });
    expect(p.entity).toBe("0x0000123400005678");
    expect(p.fieldCount).toBe(5);
    expect(formatLink(p)).toBe(WORLD);
  });

  it("reads the world-only and the older worlds/ forms", () => {
    const a = parseLink("enfusion://WorldEditor/~MyMod:worlds/Test/Test.ent");
    expect(a.pos).toBeUndefined();
    expect(a.fieldCount).toBe(1);
    const b = parseLink("enfusion://WorldEditor/worlds/Test/Test.ent;1,2,3");
    expect(b.addon).toBeUndefined();
    expect(b.path).toBe("worlds/Test/Test.ent");
    expect(b.pos?.values).toEqual([1, 2, 3]);
  });

  it("keeps empty fields and number texts as written", () => {
    for (const s of [
      "enfusion://WorldEditor/worlds/a.ent;;;;deadbeef",
      "enfusion://WorldEditor/worlds/a.ent;1.000,2.50,-0;;0.25",
      "enfusion://WorldEditor/worlds/a.ent;1e3,2,3;10,20,30;",
      "enfusion://WorldEditor/worlds/a.ent;1,2,3;-70.12,315,0",
    ]) {
      expect(formatLink(parseLink(s))).toBe(s);
    }
    const p = parseLink("enfusion://WorldEditor/worlds/a.ent;;;;deadbeef");
    expect(p.pos).toBeUndefined();
    expect(p.entity).toBe("deadbeef");
  });

  it("reads Resource Manager links with and without the addon", () => {
    const p = parseLink(RM);
    expect(p).toMatchObject({
      kind: "resource",
      addon: "ArmaReforger",
      path: "Configs/Factions/BLUFOR.conf",
    });
    const q = parseLink("enfusion://ResourceManager/Prefabs/Props/Box.et");
    expect(q.addon).toBeUndefined();
    expect(q.path).toBe("Prefabs/Props/Box.et");
  });

  it("reads Script Editor links with and without a line", () => {
    expect(parseLink(SE)).toMatchObject({
      kind: "script",
      path: "scripts/Game/game.c",
      line: 1175,
    });
    const p = parseLink("enfusion://ScriptEditor/scripts/Game/game.c");
    expect(p.line).toBeUndefined();
    expect(parseLink("enfusion://ScriptEditor/scripts/Game/game.c;0").line).toBe(0);
  });

  it("reads editor-only links and the bare file modules", () => {
    for (const m of EDITOR_ONLY_MODULES) {
      expect(parseLink(`enfusion://${m}`)).toMatchObject({ kind: "editor", module: m });
    }
    expect(parseLink("enfusion://WorldEditor")).toMatchObject({
      kind: "editor",
      module: "WorldEditor",
    });
  });

  it("reads the web redirect prefix, plain and percent-encoded", () => {
    const plain = WEB_PREFIX + WORLD;
    const p = parseLink(plain);
    expect(p.webPrefix).toBe(true);
    expect(p.kind).toBe("world");
    expect(formatLink(p)).toBe(plain);
    expect(innerLink(p)).toBe(WORLD);
    const enc = WEB_PREFIX + encodeURIComponent(SE);
    const q = parseLink(enc);
    expect(q.kind).toBe("script");
    expect(q.line).toBe(1175);
    expect(formatLink(q)).toBe(enc);
    // Lower-case hex is kept as written.
    const lower = WEB_PREFIX + "enfusion%3a%2f%2fAudioEditor";
    expect(formatLink(parseLink(lower))).toBe(lower);
  });

  it("answers web links as web, never as enfusion links", () => {
    const p = parseLink("https://community.bistudio.com/wiki/Arma_Reforger:World_Editor");
    expect(p).toMatchObject({ kind: "web", webPrefix: false });
    expect(p.module).toBeUndefined();
    expect(() => innerLink(p)).toThrow(VocabularyError);
  });

  it("trims blanks around the whole link", () => {
    expect(formatLink(parseLink(`  ${RM}\n`))).toBe(RM);
  });

  it.each<[string, RegExp]>([
    ["", /empty/],
    ["enfusion://", /no module/],
    ["enfusion://Nope/x", /unknown link module/],
    ["enfusion://worldeditor/worlds/a.ent", /unknown link module/],
    ["ENFUSION://WorldEditor/worlds/a.ent", /starts with/],
    ["file:///C:/x.ent", /starts with/],
    ["enfusion://ParticleEditor/x.ptc", /editor only/],
    ["enfusion://AudioEditor/", /editor only/],
    ["enfusion://WorldEditor/", /names nothing/],
    ["enfusion://WorldEditor/worlds/a.conf", /\.ent/],
    ["enfusion://WorldEditor/C:/worlds/a.ent", /relative/],
    ["enfusion://WorldEditor/../worlds/a.ent", /'\.\.'/],
    ["enfusion://WorldEditor/$ArmaReforger:worlds/a.ent", /addon prefix/],
    ["enfusion://WorldEditor/~Bad Id:worlds/a.ent", /addon id/],
    ["enfusion://WorldEditor/~ArmaReforger", /no ':'/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2", /3 numbers/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2,x", /numbers/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2,3;1,2,3;2", /daytime is 0..1/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2,3;1,2,3;0.5,2024,13", /month/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2,3;1,2,3;0.5,2024,6,1,9", /1 to 4/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2,3;1,2,3;0.5;a,b", /entity/],
    ["enfusion://WorldEditor/worlds/a.ent;1,2,3;1,2,3;0.5;e;extra", /at most 5/],
    ["enfusion://ResourceManager/", /names nothing/],
    ["enfusion://ResourceManager//abs.conf", /relative/],
    ["enfusion://ResourceManager/a;b.conf", /holds ';'/],
    ["enfusion://ScriptEditor/a.c;x", /whole number/],
    ["enfusion://ScriptEditor/a.c;007", /leading zeros/],
    ["enfusion://ScriptEditor/a.c;-1", /whole number/],
    ["enfusion://ScriptEditor/a.c\u0000", /control/],
    [WEB_PREFIX, /needs a link/],
    [WEB_PREFIX + "enfusion%3A%zz", /percent-encoding/],
    [WEB_PREFIX + "https://example.com/", /starts with/],
    ["https://exa mple.com/", /valid web address/],
  ])("refuses %j", (link, why) => {
    refuses(link, why);
  });
});

describe("build", () => {
  it("writes each kind and parses back to the same link", () => {
    const cases: [BuildFields, string][] = [
      [{ kind: "editor", module: "AnimEditor" }, "enfusion://AnimEditor"],
      [{ kind: "resource", addon: "ArmaReforger", path: "Configs/Factions/BLUFOR.conf" }, RM],
      [{ kind: "script", path: "scripts/Game/game.c", line: 1175 }, SE],
      [
        {
          kind: "world",
          world: "~ArmaReforger:worlds/Arland/Arland.ent",
          pos: [1000.5, 25.25, 2000],
          angles: [-30, 45, 0],
          time: [0.5, 2024, 6, 1],
          entity: "0x0000123400005678",
        },
        WORLD,
      ],
      [
        { kind: "world", addon: "MyMod", path: "worlds/T.ent", entity: "abc" },
        "enfusion://WorldEditor/~MyMod:worlds/T.ent;;;;abc",
      ],
      [
        { kind: "world", world: "worlds/T.ent", pos: "1,2,3", webPrefix: true },
        `${WEB_PREFIX}enfusion://WorldEditor/worlds/T.ent;1,2,3`,
      ],
    ];
    for (const [fields, want] of cases) {
      const { link, parsed } = buildLink(fields);
      expect(link).toBe(want);
      expect(formatLink(parsed)).toBe(want);
    }
  });

  it("writes numbers as plain text with no -0 and at most 6 decimals", () => {
    expect(numberText(-0)).toBe("0");
    expect(numberText(1 / 3)).toBe("0.333333");
    expect(numberText(1e6)).toBe("1000000");
    expect(() => numberText(Number.NaN)).toThrow(VocabularyError);
  });

  it.each<[BuildFields, RegExp]>([
    [{ kind: "web" } as unknown as BuildFields, /kind must be/],
    [{ kind: "editor" }, /needs module/],
    [{ kind: "editor", module: "Nope" }, /unknown link module/],
    [{ kind: "editor", module: "ParticleEditor", path: "x" }, /does not apply/],
    [{ kind: "world" }, /needs world/],
    [{ kind: "world", world: "worlds/a.ent", path: "worlds/b.ent" }, /pass world, or addon/],
    [{ kind: "world", world: "worlds/a.ent", pos: [1, 2] }, /3 numbers/],
    [{ kind: "world", world: "worlds/a.ent", time: [2] }, /daytime/],
    [{ kind: "world", world: "worlds/a.ent", line: 3 }, /does not apply/],
    [{ kind: "resource" }, /needs path/],
    [{ kind: "resource", path: "a.conf", addon: "bad id" }, /addon id/],
    [{ kind: "script", path: "a.c", line: -1 }, /whole number/],
    [{ kind: "script", path: "a.c", line: 1.5 }, /whole number/],
  ])("refuses %j", (fields, why) => {
    expect(() => buildLink(fields)).toThrow(why);
  });
});

describe("world paths", () => {
  it("writes GetWorldPath answers as the vanilla link does", () => {
    expect(worldFieldOf("$ArmaReforger:worlds/Arland/Arland.ent")).toBe(
      "~ArmaReforger:worlds/Arland/Arland.ent",
    );
    expect(worldFieldOf("~MyMod:worlds/T.ent")).toBe("~MyMod:worlds/T.ent");
    expect(worldFieldOf("%USERPROFILE%\\Documents\\Mod\\Worlds\\T\\T.ent")).toBe("Worlds/T/T.ent");
    expect(worldFieldOf("")).toBeNull();
    expect(worldFieldOf("C:/x/y.ent")).toBeNull();
  });

  it("compares worlds without addon, case or slash direction", () => {
    expect(worldKey("~ArmaReforger:worlds/Arland/Arland.ent")).toBe(
      worldKey("$ArmaReforger:Worlds\\Arland\\Arland.ent"),
    );
    expect(worldKey("worlds/A.ent")).not.toBe(worldKey("worlds/B.ent"));
  });
});

// ── The ledger's link rows ───────────────────────────────────────────────────

/**
 * A concrete link for every link row of data/census/ledger.jsonl. A row whose id is a whole link
 * is its own sample; the format rows get the example their own text gives.
 */
const ROW_SAMPLES: Record<string, string[]> = {
  "link:Editor-only-links": EDITOR_ONLY_MODULES.map((m) => `enfusion://${m}`),
  "link:Resource-Manager-link": [RM],
  "link:Script-Editor-link": [SE],
  "link:Workbench-link": [
    "enfusion://ScriptEditor/scripts/WorkbenchGame/WorldEditor/SCR_CoordsTool.c;57",
  ],
  "link:World-Editor-link": [
    WORLD,
    "enfusion://WorldEditor/~ArmaReforger:worlds/Arland/Arland.ent",
  ],
  "link:enfusion://": [WORLD, RM, SE, "enfusion://LocalizationEditor"],
  "link:enfusion://WorldEditor": ["enfusion://WorldEditor", WORLD],
  "link:enfusion://ResourceManager": ["enfusion://ResourceManager", RM],
  "link:enfusion://ScriptEditor": ["enfusion://ScriptEditor", SE],
  "link:https://enfusionengine.com/api/redirect?to=": [
    WEB_PREFIX + WORLD,
    WEB_PREFIX + encodeURIComponent(WORLD),
    WEB_PREFIX + RM,
  ],
};

interface LedgerRow {
  id: string;
  dim: string;
}

function ledgerLinkRows(): LedgerRow[] {
  const text = readFileSync(join(REPO_ROOT, "data", "census", "ledger.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as LedgerRow)
    .filter((r) => r.dim === "link");
}

describe("the ledger's link rows", () => {
  const rows = ledgerLinkRows();

  it("holds the 33 link rows the spec names", () => {
    expect(rows).toHaveLength(33);
  });

  it("round-trips every link form among them, parse and build", () => {
    let count = 0;
    const kinds = new Set<string>();
    for (const row of rows) {
      const own = row.id.slice("link:".length);
      const samples = ROW_SAMPLES[row.id] ?? [own];
      expect(samples.length, row.id).toBeGreaterThan(0);
      for (const s of samples) {
        const p = parseLink(s);
        expect(formatLink(p), `${row.id}: ${s}`).toBe(s);
        kinds.add(p.kind + (p.webPrefix ? "+prefix" : ""));
        if (p.kind !== "web") {
          const built = buildLink(fieldsOf(p));
          // The builder writes the prefix plain; a percent-encoded inner link parses to the same.
          if (p.encodedText === undefined) expect(built.link, `${row.id}: build`).toBe(s);
          else expect(innerLink(built.parsed)).toBe(innerLink(p));
        }
        count++;
      }
    }
    expect(kinds).toEqual(
      new Set(["world", "resource", "script", "editor", "web", "world+prefix", "resource+prefix"]),
    );
    expect(count).toBeGreaterThanOrEqual(33);
  });

  it("answers the web rows as web links", () => {
    const web = rows.filter((r) => r.id.startsWith("link:https://") && !r.id.includes("redirect"));
    expect(web.length).toBeGreaterThan(10);
    for (const r of web) expect(parseLink(r.id.slice(5)).kind).toBe("web");
  });
});

// ── The vanilla link builders ────────────────────────────────────────────────

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
const skipNote = open.skip === undefined ? "" : ` (skipped: ${open.skip})`;

describe.skipIf(open.skip !== undefined)(`vanilla link templates${skipNote}`, () => {
  const corpus = open.corpus!;

  /** string.Format with sample values for %1..%7. */
  function fill(template: string, values: string[]): string {
    return template.replace(/%(\d)/g, (_, d: string) => values[Number(d) - 1] ?? "");
  }

  it("parses and writes back every enfusion:// template the game scripts format", () => {
    const templates = new Map<string, string>();
    for (const f of corpus.list("c")) {
      let t: string;
      try {
        t = corpus.read(f).toString("utf8");
      } catch {
        continue;
      }
      for (const m of t.matchAll(/"(enfusion:\/\/[A-Za-z]+\/[^"]*%1[^"]*)"/g)) {
        // A markup link carries its label after '|' ("<link>|Enfusion link"): the link is before it.
        templates.set(m[1]!.split("|")[0]!, f);
      }
    }
    expect(templates.size).toBeGreaterThan(0);
    const values = ["~ArmaReforger:worlds/Arland/Arland.ent", "1.5", "2", "-3.25", "10", "20", "0"];
    const rmValues = ["Configs/Factions/BLUFOR.conf"];
    for (const [tpl, file] of templates) {
      const link = fill(tpl, tpl.includes("ResourceManager") ? rmValues : values);
      const p = parseLink(link);
      expect(formatLink(p), `${file}: ${tpl}`).toBe(link);
    }
  });
});
