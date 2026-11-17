/**
 * Write-safety audit (plan section 11 criterion 7): the round trip of the two parsers that write
 * world layers offline.
 *
 *   - wb_world (new, duplicate, setWorldEntity) edits `.ent` and `.layer` text through the lossless
 *     CST (src/formats/enfusion-cst.ts).
 *   - scenario_apply_template (edits an existing `.layer`) and scenario_clone_area (writes a new
 *     `.layer` from a source layer) splice the same CST through src/scenario/layer-cst.ts:
 *     a stamp is the original text plus one inserted span; a clone is the source text with the
 *     out-of-area entities cut and the kept entities' GUIDs (and, with a translate, coords)
 *     changed. Before this they went through a lossy parseLayer / serializeLayer on
 *     src/formats/enfusion-text.ts (write-safety audit gaps 1 and 2).
 *
 * The corpus: the game paks hold no `.layer` and every `.ent` in them is binary (measured below),
 * so no vanilla text layer is reachable offline. The only text layers on this machine are the
 * local Workbench addons folder (ENFUSION_PROJECT_PATH, or the default addons folder), read here
 * the way tests/tools/meta-file.test.ts reads its local `.meta` files, and skipped when absent.
 * Nothing from those files is copied into the repository.
 *
 * "Byte-exact" for the two scenario writers means: every byte the write does not insert, cut or
 * change is the original's. The cases were `it.fails` while the writers were lossy; they are
 * plain `it` now.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCst, parseCstBytes } from "../../../src/formats/enfusion-cst.js";
import { applyTemplate } from "../../../src/scenario/apply-template.js";
import { cloneArea, type GuidSwap } from "../../../src/scenario/clone-area.js";
import { loadBaseline, openVanillaCorpus, sniffText } from "../../corpus/_corpus.js";

const LOCAL =
  process.env.ENFUSION_PROJECT_PATH ??
  join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "addons");

function walkLayers(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkLayers(p, out);
    else if (e.isFile() && /\.(layer|ent)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Local text layers and worlds (binary `.ent` files are left out). */
const localFiles = existsSync(LOCAL)
  ? walkLayers(LOCAL).filter((f) => sniffText(readFileSync(f)) === "text")
  : [];

/** The tools' dispatch: `.conf` / `.ent` are single-root, everything else multi-root. */
const singleRootFor = (file: string) => /\.(conf|ent)$/i.test(file);

/** True when `after` is `before` with one span inserted (and nothing else changed). */
function isOneInsertion(before: string, after: string): boolean {
  if (after.length < before.length) return false;
  let p = 0;
  while (p < before.length && before[p] === after[p]) p++;
  let s = 0;
  while (
    s < before.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++;
  return p + s === before.length;
}

/** Puts the source GUIDs back, so the rest of a clone can be compared byte for byte. */
function unswap(text: string, swaps: GuidSwap[]): string {
  let out = text;
  for (const s of swaps) out = out.split(s.new).join(s.old);
  return out;
}

/** True when the lines of `sub` are lines of `full` in order (whole lines cut, none changed). */
function isLineSubsequence(full: string, sub: string): boolean {
  const a = full.split(/(?<=\n)/);
  const b = sub.split(/(?<=\n)/);
  let i = 0;
  for (const line of b) {
    while (i < a.length && a[i] !== line && a[i].replace(/\r?\n$/, "") !== line) i++;
    if (i === a.length) return false;
    i++;
  }
  return true;
}

const EVERYWHERE = { minX: -1e12, minZ: -1e12, maxX: 1e12, maxZ: 1e12 };

/** Why the two scenario writers are not byte-exact on `text`, or undefined when they are. */
function scenarioWriteOff(text: string, singleRoot: boolean): string | undefined {
  try {
    const stamped = applyTemplate(text, {
      template: "checkpoint",
      position: { x: 10, y: 0, z: 20 },
      yawDeg: 30,
      singleRoot,
    }).text;
    if (!isOneInsertion(text, stamped)) return "stamp changed bytes outside its insertion";
    if (parseCst(stamped).diagnostics.length > 0) return "stamp does not parse cleanly";
    const clone = cloneArea(text, EVERYWHERE, undefined, { singleRoot });
    const back = unswap(clone.text, clone.guidSwaps);
    if (!isLineSubsequence(text, back)) return "clone changed bytes it did not cut or re-GUID";
    const doc = parseCst(text);
    const block = singleRoot && doc.base.kind === "object" ? doc.base : doc.root;
    const all = block.children
      .filter((c) => c.kind === "object")
      .every((c) => c.kind === "object" && c.children.some((d) => d.kind === "scalar" && d.key === "coords"));
    if (all && back !== text) return "clone of every entity is not the source";
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ── The vanilla corpus has no text layer ─────────────────────────────────────

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
if (open.skip !== undefined) console.warn(`[write-safety] layer corpus SKIPPED: ${open.skip}`);

describe.skipIf(open.skip !== undefined)(
  `vanilla layers in the paks${open.skip ? ` (SKIPPED: ${open.skip})` : ""}`,
  () => {
    it("hold no .layer, and no .ent that is text (so no vanilla layer corpus is reachable)", () => {
      const corpus = open.corpus!;
      expect(corpus.list("layer")).toEqual([]);
      const ents = corpus.list("ent");
      expect(ents.length).toBeGreaterThan(0);
      let read = 0;
      const text: string[] = [];
      for (const p of ents) {
        let buf: Buffer;
        try {
          buf = corpus.read(p);
        } catch {
          continue; // over the VFS size cap: not read, not counted
        }
        read++;
        if (sniffText(buf) === "text") text.push(p);
      }
      console.log(`[write-safety] vanilla .ent: ${ents.length} in the paks, ${read} read, ${text.length} text`);
      expect(read).toBeGreaterThan(0);
      expect(text).toEqual([]);
    });
  },
);

// ── wb_world: the CST on the local layers ────────────────────────────────────

describe.skipIf(localFiles.length === 0)(
  `wb_world's parser (CST) on the local addons layers${localFiles.length ? "" : " (SKIPPED: no local text .layer or .ent)"}`,
  () => {
    it("gives every local text .layer and .ent back byte for byte", () => {
      const off = localFiles.filter((f) => {
        const buf = readFileSync(f);
        return !parseCstBytes(buf).toBytes().equals(buf);
      });
      console.log(
        `[write-safety] CST local layers: ${localFiles.length - off.length}/${localFiles.length} byte-exact`,
      );
      expect(off.length).toBe(0);
    });
  },
);

// ── scenario_apply_template and scenario_clone_area: the CST layer writers ────

/** Vanilla-shaped layer text, written here (no game content). */
const FIXTURES: Record<string, string> = {
  "an entity with a name": [
    'GenericEntity Lamp_1 : "{AAAAAAAAAAAAAAAA}Prefabs/Props/Lamp.et" {',
    ' ID "1234567890ABCDEF"',
    " coords 100 0 100",
    "}",
    "",
  ].join("\n"),
  "a components block before the coords": [
    'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/Props/Crate.et" {',
    " components {",
    '  MeshObject "{BBBBBBBBBBBBBBBB}" {',
    '   Object "{CCCCCCCCCCCCCCCC}Assets/Props/Crate.xob"',
    "  }",
    " }",
    " coords 1.5 0 2",
    " angleY 90",
    "}",
    "",
  ].join("\n"),
  "CRLF line ends": 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\r\n coords 100 0 100\r\n}\r\n',
  "a tab indent": 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n\tcoords 100 0 100\n}\n',
  "no final line end": 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 100 0 100\n}',
};

describe("the scenario layer writers (applyTemplate / cloneArea on the CST)", () => {
  it("round-trips the one shape the old parser kept: LF, one-space indent, properties only", () => {
    const t = 'GenericEntity : "{AAAAAAAAAAAAAAAA}Prefabs/X.et" {\n coords 100 0 100\n}\n';
    expect(scenarioWriteOff(t, false)).toBeUndefined();
  });

  for (const [name, text] of Object.entries(FIXTURES)) {
    it(`is byte-exact on ${name}`, () => {
      expect(scenarioWriteOff(text, false)).toBeUndefined();
      // The clone of every entity is the source with fresh GUIDs and nothing else.
      const clone = cloneArea(text, EVERYWHERE);
      expect(unswap(clone.text, clone.guidSwaps)).toBe(text);
    });
  }

  it("the CST gives each of those fixtures back byte for byte", () => {
    for (const text of Object.values(FIXTURES)) {
      const buf = Buffer.from(text, "utf8");
      expect(parseCstBytes(buf).toBytes().equals(buf)).toBe(true);
    }
  });

  (localFiles.length > 0 ? it : it.skip)(
    `is byte-exact on every local text .layer and .ent${localFiles.length ? "" : " (SKIPPED: none)"}`,
    () => {
      const off = localFiles
        .map((f) => ({ f, why: scenarioWriteOff(readFileSync(f, "utf8"), singleRootFor(f)) }))
        .filter((r) => r.why !== undefined);
      console.log(
        `[write-safety] scenario layer writers, local layers: ${localFiles.length - off.length}/${localFiles.length} byte-exact`,
      );
      // Report the reason only, never the path or the content (local files stay local).
      expect(off.map((r) => r.why)).toEqual([]);
    },
  );
});
