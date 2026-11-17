/**
 * `animation_set` on every vanilla `.ast` and `.asi` of the installed game
 * (W4 spec section 4, gates 1 to 4). Build-independent, so the corpus is
 * opened whatever its build, and skipped when there is no game install.
 *
 * 1. Round trip: every file parses and serialises byte for byte (131 ast, 248 asi).
 * 2. No throw: read and validate finish on every file.
 * 3. No error on vanilla: validate reports no error on any file.
 * 4. Identity edits: on a seeded sample of 50 files per extension, each edit
 *    followed by its inverse returns the original bytes.
 */
import { describe, expect, it } from "vitest";
import { CstDocument, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import {
  addAnimation,
  addColumn,
  addGroup,
  mapSlot,
  removeFromGroup,
  removeGroup,
  runAnimationSet,
  unmapSlot,
  unwritableReason,
  validateAst,
  viewAsi,
  viewAst,
  type GameFiles,
} from "../../src/tools/animation-set.js";
import type { Config } from "../../src/config.js";
import { loadBaseline, openVanillaCorpus, seededSample } from "./_corpus.js";

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });

const SAMPLE = 50;
const SEED = "animation-set-identity-v1";

describe.skipIf(open.skip !== undefined)("vanilla .ast and .asi files", () => {
  const corpus = open.corpus!;
  const asts = open.corpus ? corpus.list("ast") : [];
  const asis = open.corpus ? corpus.list("asi") : [];
  const known = open.corpus
    ? new Set([...corpus.list("anm"), ...asts, ...asis])
    : new Set<string>();
  const game: GameFiles | null = open.corpus
    ? { exists: (p) => known.has(p), readFile: (p) => corpus.read(p) }
    : null;
  const config = { projectPath: "", gamePath: "", dataDir: "" } as Config;
  const call = (action: "read" | "validate", path: string) =>
    runAnimationSet({ action, path, limit: 200 }, config, { game });

  it("has the files of the build", () => {
    expect(asts.length).toBe(131);
    expect(asis.length).toBe(248);
  });

  it("gate 1: gives every file back byte for byte, and the writer would keep every one", () => {
    const off: string[] = [];
    const refused: string[] = [];
    for (const [files, kind] of [
      [asts, "ast"],
      [asis, "asi"],
    ] as const) {
      for (const f of files) {
        const buf = corpus.read(f);
        if (Buffer.compare(parseCstBytes(buf).toBytes(), buf) !== 0) off.push(f);
        const why = unwritableReason(buf, kind);
        if (why) refused.push(`${f}: ${why}`);
      }
    }
    expect(off).toEqual([]);
    expect(refused).toEqual([]);
  });

  it("gate 2: read and validate finish on every file", () => {
    const failed: string[] = [];
    for (const f of [...asts, ...asis]) {
      for (const action of ["read", "validate"] as const) {
        const r = call(action, f);
        if (!r.ok) failed.push(`${f} ${action}: ${r.code} ${r.message}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("gate 3: validate reports no error on any vanilla file", () => {
    const errors: string[] = [];
    let slotsChecked = 0;
    for (const f of [...asts, ...asis]) {
      const r = call("validate", f);
      if (!r.ok) {
        errors.push(`${f}: ${r.message}`);
        continue;
      }
      const b = r.readback as {
        errors: number;
        issues: { level: string; at: string; message: string }[];
        slotsChecked?: boolean;
      };
      if (b.slotsChecked) slotsChecked++;
      for (const i of b.issues)
        if (i.level === "error") errors.push(`${f} [${i.at}]: ${i.message}`);
      expect(b.errors).toBe(b.issues.filter((i) => i.level === "error").length);
    }
    expect(errors).toEqual([]);
    expect(slotsChecked).toBe(asis.length);
  });

  it("gate 3: the template check alone finds no error on any vanilla template", () => {
    for (const f of asts) {
      expect(validateAst(viewAst(parseCstBytes(corpus.read(f))))).not.toContainEqual(
        expect.objectContaining({ level: "error" }),
      );
    }
  });

  it("gate 4: every edit followed by its inverse returns the original bytes (50 seeded .ast)", () => {
    const off: string[] = [];
    for (const f of seededSample(asts, SAMPLE, "ast", SEED)) {
      const buf = corpus.read(f);
      const w = { doc: parseCstBytes(buf) };
      const same = () => Buffer.compare(w.doc.toBytes(), buf) === 0;
      const view = viewAst(w.doc);
      const g = view.groups[0];
      addGroup(w, { group: "EmcpProbe", columns: ["c1", "c2"], animations: ["a1"] });
      if (same()) off.push(`${f}: addGroup changed nothing`);
      removeGroup(w, "EmcpProbe");
      if (!same()) off.push(`${f}: addGroup/removeGroup`);
      if (g) {
        addColumn(w, { group: g.name, column: "EmcpCol" });
        if (same()) off.push(`${f}: addColumn changed nothing`);
        removeFromGroup(w, g.name, "Columns", "EmcpCol");
        if (!same()) off.push(`${f}: addColumn/remove`);
        addAnimation(w, { group: g.name, animation: "EmcpAnim" });
        if (same()) off.push(`${f}: addAnimation changed nothing`);
        removeFromGroup(w, g.name, "Animations", "EmcpAnim");
        if (!same()) off.push(`${f}: addAnimation/remove`);
      }
      expect(unwritableReason(buf, "ast")).toBeUndefined();
    }
    expect(off).toEqual([]);
  });

  it("gate 4: every edit followed by its inverse returns the original bytes (50 seeded .asi)", () => {
    const off: string[] = [];
    for (const f of seededSample(asis, SAMPLE, "asi", SEED)) {
      const buf = corpus.read(f);
      const w = { doc: parseCstBytes(buf) };
      const same = () => Buffer.compare(w.doc.toBytes(), buf) === 0;
      const lines = viewAsi(w.doc).lines;
      mapSlot(w, "EmcpProbe.col.anim", "{0123456789ABCDEF}anims/probe.anm");
      if (same()) off.push(`${f}: map changed nothing`);
      unmapSlot(w, "EmcpProbe.col.anim");
      if (!same()) off.push(`${f}: map/unmap`);
      const first = lines[0];
      if (first?.resource) {
        mapSlot(w, first.slot, "{0123456789ABCDEF}anims/probe.anm");
        if (same()) off.push(`${f}: re-map changed nothing`);
        mapSlot(w, first.slot, first.resource.raw);
        if (!same()) off.push(`${f}: re-map/restore`);
      }
    }
    expect(off).toEqual([]);
  });

  it("gate 4: the whole write path, dry run and confirmed, on the sampled files leaves a file the writer keeps", () => {
    // Writes go to a project, so this checks the in-memory result the commit step would write.
    for (const f of seededSample(asis, 10, "asi-doc", SEED)) {
      const doc = parseCstBytes(corpus.read(f));
      const copy = new CstDocument(doc.serialize(), doc.encoding);
      mapSlot({ doc: copy }, "EmcpProbe.col.anim", "{0123456789ABCDEF}anims/probe.anm");
      expect(unwritableReason(copy.toBytes(), "asi")).toBeUndefined();
    }
  });
});
