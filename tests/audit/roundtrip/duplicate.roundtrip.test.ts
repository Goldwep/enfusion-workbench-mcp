/**
 * Write-safety audit (plan section 11 criterion 7, gap 3): the round trip of game_duplicate's text
 * transform (`transformDuplicate` in src/tools/game-duplicate.ts), the edits the tool makes to a
 * vanilla `.et` or `.conf` before it writes the copy into the project.
 *
 * The tool reads the source as UTF-8 text (PakVirtualFS.readTextFile or readTextFileBounded) and
 * writes the result as UTF-8, so each check here goes the same way: decode, transform, encode, and
 * compare bytes with the file in the pak.
 *
 *   - identity: no ancestry, the ID the file already holds: the copy is the file byte for byte;
 *   - rename: a new ID: only the 16 ID digits differ;
 *   - injection: an ancestor component the file lacks: the copy is the file with one block
 *     inserted, every original byte kept in order;
 *   - flatten: only the parent reference of the class line goes.
 *
 * The corpus is every vanilla `.et` and `.conf` in the installed game's paks (openVanillaCorpus,
 * as the other round-trip and corpus tests read it); injection and flatten are measured on the
 * `.et` files only, since the tool resolves ancestry for `.et` alone. Skipped when the paks are
 * absent. Nothing from the game is copied into the repository. The fixtures below run without the
 * game.
 */
import { describe, expect, it } from "vitest";
import { transformDuplicate } from "../../../src/tools/game-duplicate.js";
import {
  parseComponents,
  parseParentPath,
  type AncestorLevel,
} from "../../../src/utils/prefab-ancestry.js";
import { loadBaseline, openVanillaCorpus, sniffText } from "../../corpus/_corpus.js";

const ID_RE = /^(\s*ID\s+")([0-9A-Fa-f]{16})(")/m;
const PARENT_RE = /^(\w+)\s*:\s*"[^"]*"\s*\{/m;

/** The ID the text holds, or a placeholder when it has no ID line (the transform then skips it). */
function currentId(text: string): string {
  return ID_RE.exec(text)?.[2] ?? "0000000000000000";
}

/** A 16-digit ID different from `id`. */
function otherId(id: string): string {
  return id.toUpperCase() === "0123456789ABCDEF" ? "FEDCBA9876543210" : "0123456789ABCDEF";
}

function level(path: string, text: string, depth: number): AncestorLevel {
  return {
    path,
    depth,
    entityClass: parseParentPath(text).entityClass,
    components: parseComponents(text),
    rawContent: text,
  };
}

/** An ancestor with one top-level component no vanilla file declares. */
const ANCESTOR_TEXT = [
  "GenericEntity {",
  " components {",
  '  MeshObject "{AAAAAAAAAAAAAAAA}" {',
  '   Object "{BBBBBBBBBBBBBBBB}Assets/Test/Ancestor.xob"',
  "  }",
  " }",
  "}",
  "",
].join("\n");
const INJECTED_TYPE = "MeshObject";
const INJECTED_GUID = "AAAAAAAAAAAAAAAA";

function chainOver(path: string, text: string): AncestorLevel[] {
  return [level("Prefabs/Test/Ancestor.et", ANCESTOR_TEXT, 0), level(path, text, 1)];
}

/** True when `out` is `inp` with one contiguous block inserted (every byte of inp kept in order). */
function isOneInsertion(inp: string, out: string): boolean {
  if (out.length < inp.length) return false;
  let p = 0;
  while (p < inp.length && inp[p] === out[p]) p++;
  return out.slice(p + (out.length - inp.length)) === inp.slice(p);
}

function bytes(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

// ── Fixtures (no game needed) ────────────────────────────────────────────────

const LEAF = [
  'GenericEntity : "{1111111111111111}Prefabs/Test/Base.et" {',
  ' ID "56B2B4793051E7C9"',
  " components {",
  '  RigidBody "{2222222222222222}" {',
  "   Mass 5",
  "  }",
  " }",
  "}",
  "",
].join("\r\n");

describe("transformDuplicate on fixtures", () => {
  it("gives the text back unchanged with no ancestry and the same ID", () => {
    const r = transformDuplicate(LEAF, { flatten: false, newEntityId: "56B2B4793051E7C9" });
    expect(r.content).toBe(LEAF);
    expect(r.ancestryApplied).toBe(false);
    expect(r.injected).toEqual([]);
  });

  it("ignores flatten when the chain has one level", () => {
    const r = transformDuplicate(LEAF, {
      levels: [level("Prefabs/Test/Leaf.et", LEAF, 0)],
      flatten: true,
      newEntityId: "56B2B4793051E7C9",
    });
    expect(r.content).toBe(LEAF);
  });

  it("changes only the 16 ID digits on a rename", () => {
    const r = transformDuplicate(LEAF, { flatten: false, newEntityId: "0123456789ABCDEF" });
    expect(r.content).toBe(LEAF.replace("56B2B4793051E7C9", "0123456789ABCDEF"));
    expect(r.content.length).toBe(LEAF.length);
  });

  it("inserts an inherited component after `components {` and keeps every other byte", () => {
    const r = transformDuplicate(LEAF, {
      levels: chainOver("Prefabs/Test/Leaf.et", LEAF),
      flatten: false,
      newEntityId: "56B2B4793051E7C9",
    });
    expect(r.injected).toEqual(["MeshObject (from [0] Prefabs/Test/Ancestor.et)"]);
    expect(isOneInsertion(LEAF, r.content)).toBe(true);
    expect(r.content).toContain(`${INJECTED_TYPE} "{${INJECTED_GUID}}"`);
    const at = LEAF.indexOf(" components {") + " components {".length;
    expect(r.content.slice(0, at)).toBe(LEAF.slice(0, at));
  });

  it("adds a components block before the last `}` when the file has none", () => {
    const bare =
      'GenericEntity : "{1111111111111111}Prefabs/Test/Base.et" {\n ID "56B2B4793051E7C9"\n}\n';
    const r = transformDuplicate(bare, {
      levels: chainOver("Prefabs/Test/Leaf.et", bare),
      flatten: false,
      newEntityId: "56B2B4793051E7C9",
    });
    expect(isOneInsertion(bare, r.content)).toBe(true);
    expect(r.content).toContain(" components {\n");
  });

  it("does not inject a component the file already declares", () => {
    const leaf = LEAF.replace("RigidBody", INJECTED_TYPE).replace(
      "2222222222222222",
      INJECTED_GUID,
    );
    const r = transformDuplicate(leaf, {
      levels: chainOver("Prefabs/Test/Leaf.et", leaf),
      flatten: false,
      newEntityId: "56B2B4793051E7C9",
    });
    expect(r.injected).toEqual([]);
    expect(r.content).toBe(leaf);
  });

  it("with flatten, removes only the parent reference of the class line", () => {
    const leaf = LEAF.replace("RigidBody", INJECTED_TYPE).replace(
      "2222222222222222",
      INJECTED_GUID,
    );
    const r = transformDuplicate(leaf, {
      levels: chainOver("Prefabs/Test/Leaf.et", leaf),
      flatten: true,
      newEntityId: "56B2B4793051E7C9",
    });
    expect(r.content).toBe(
      leaf.replace('GenericEntity : "{1111111111111111}Prefabs/Test/Base.et" {', "GenericEntity {"),
    );
  });
});

// ── The vanilla corpus ───────────────────────────────────────────────────────

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
if (open.skip !== undefined) console.warn(`[write-safety] duplicate corpus SKIPPED: ${open.skip}`);

interface CorpusFile {
  path: string;
  buf: Buffer;
  text: string;
}

/** Every readable text .et and .conf, with the count of each kind left out and why. */
function loadCorpus(): {
  files: CorpusFile[];
  listed: number;
  unreadable: number;
  binary: number;
  notUtf8: string[];
} {
  const corpus = open.corpus!;
  const files: CorpusFile[] = [];
  let listed = 0;
  let unreadable = 0;
  let binary = 0;
  const notUtf8: string[] = [];
  for (const ext of ["et", "conf"]) {
    for (const path of corpus.list(ext)) {
      listed++;
      let buf: Buffer;
      try {
        buf = corpus.read(path);
      } catch {
        unreadable++; // over the VFS size cap: not read, not counted
        continue;
      }
      if (sniffText(buf) !== "text") {
        binary++;
        continue;
      }
      const text = buf.toString("utf8");
      // A file that is not valid UTF-8 does not survive the tool's decode; listed, not hidden.
      if (!bytes(text).equals(buf)) notUtf8.push(path);
      files.push({ path, buf, text });
    }
  }
  return { files, listed, unreadable, binary, notUtf8 };
}

describe.skipIf(open.skip !== undefined)(
  `game_duplicate's transform on the vanilla .et and .conf files${open.skip ? ` (SKIPPED: ${open.skip})` : ""}`,
  () => {
    const c = open.corpus
      ? loadCorpus()
      : { files: [], listed: 0, unreadable: 0, binary: 0, notUtf8: [] };
    const utf8 = c.files.filter((f) => !c.notUtf8.includes(f.path));
    // The tool resolves ancestry for .et only, so injection and flatten are measured on .et.
    const prefabs = utf8.filter((f) => f.path.toLowerCase().endsWith(".et"));

    it("reads the corpus, and every text file decodes as UTF-8", () => {
      console.log(
        `[write-safety] duplicate corpus: ${c.listed} .et/.conf listed, ${c.files.length} text read, ` +
          `${c.unreadable} unreadable, ${c.binary} binary, ${c.notUtf8.length} not UTF-8`,
      );
      expect(c.files.length).toBeGreaterThan(1000);
      expect(c.notUtf8).toEqual([]);
    });

    it("identity: every file comes back byte for byte (no ancestry, the same ID, flatten on or off)", () => {
      const off: string[] = [];
      for (const f of utf8) {
        for (const flatten of [false, true]) {
          const r = transformDuplicate(f.text, { flatten, newEntityId: currentId(f.text) });
          if (!bytes(r.content).equals(f.buf)) off.push(`${f.path} (flatten ${flatten})`);
        }
      }
      expect(off).toEqual([]);
    });

    it("rename: a new ID changes only the 16 ID digits of each file", () => {
      const off: string[] = [];
      let withId = 0;
      for (const f of utf8) {
        const m = ID_RE.exec(f.text);
        const id = otherId(currentId(f.text));
        const r = transformDuplicate(f.text, { flatten: false, newEntityId: id });
        let expected = f.text;
        if (m) {
          withId++;
          const at = m.index + m[1].length;
          expected = f.text.slice(0, at) + id + f.text.slice(at + 16);
        }
        if (!bytes(r.content).equals(bytes(expected))) off.push(f.path);
      }
      console.log(
        `[write-safety] duplicate rename: ${withId} files with an ID line, ${off.length} off`,
      );
      expect(withId).toBeGreaterThan(0);
      expect(off).toEqual([]);
    });

    it("injection: an inherited component is one inserted block, every original byte kept in order", () => {
      const off: string[] = [];
      let injected = 0;
      for (const f of prefabs) {
        const r = transformDuplicate(f.text, {
          levels: chainOver(f.path, f.text),
          flatten: false,
          newEntityId: currentId(f.text),
        });
        if (r.injected.length === 0) {
          // The file already declares the component (no vanilla file should), so nothing moves.
          if (r.content !== f.text) off.push(`${f.path} (changed with nothing injected)`);
          continue;
        }
        injected++;
        if (!isOneInsertion(f.text, r.content)) off.push(f.path);
        else if (!r.content.includes(`${INJECTED_TYPE} "{${INJECTED_GUID}}"`))
          off.push(`${f.path} (no block)`);
      }
      console.log(
        `[write-safety] duplicate injection: ${injected}/${prefabs.length} .et injected, ${off.length} off`,
      );
      expect(injected).toBe(prefabs.length);
      expect(off).toEqual([]);
    });

    it("flatten: only the parent reference of the class line goes, with the injection and a new ID", () => {
      const off: string[] = [];
      let parented = 0;
      for (const f of prefabs) {
        const id = otherId(currentId(f.text));
        const levels = chainOver(f.path, f.text);
        const injectedOnly = transformDuplicate(f.text, {
          levels,
          flatten: false,
          newEntityId: currentId(f.text),
        }).content;
        const r = transformDuplicate(f.text, { levels, flatten: true, newEntityId: id });
        // Expected: the injected text, with the parent span of the first class line cut and the
        // ID digits replaced; nothing else may differ.
        let expected = injectedOnly;
        const p = PARENT_RE.exec(expected);
        if (p) {
          parented++;
          expected =
            expected.slice(0, p.index) + `${p[1]} {` + expected.slice(p.index + p[0].length);
        }
        const m = ID_RE.exec(expected);
        if (m) {
          const at = m.index + m[1].length;
          expected = expected.slice(0, at) + id + expected.slice(at + 16);
        }
        if (r.content !== expected) off.push(f.path);
      }
      console.log(
        `[write-safety] duplicate flatten: ${parented} files with a parent reference, ${off.length} off`,
      );
      expect(parented).toBeGreaterThan(0);
      expect(off).toEqual([]);
    });
  },
);
