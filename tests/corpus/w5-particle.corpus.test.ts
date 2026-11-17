/**
 * W5 proofs for the `particle` tool on the vanilla .ptc corpus (phase5-w5-spec.md section 4.2):
 *
 *   - round trip: every file comes back byte for byte through the lossless parser, with no
 *     diagnostics, as one EffectDef, and the tool would edit it;
 *   - read never throws: inspect, emitters, emitter, curves, refs and validate answer ok on every
 *     file, the emitter counts agree with an independent count of the EmitterDef openers, and the
 *     catalog covers every key, enum and curve of the corpus (no unknown key, no value of the
 *     wrong shape);
 *   - edit locality: on 20 files picked by a fixed seed, each write action changes only the bytes
 *     of the node it edits, and the inverse edit restores the file exactly.
 *
 * The corpus is the installed game's paks (tests/corpus/_corpus.ts); the suite is skipped, with the
 * reason in its name, when they are not there. The counts are printed, not baselined.
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  CURVES,
  applyEdit,
  runParticle,
  unwritableReason,
  validateView,
  viewParticle,
  type EditContext,
  type PakLike,
  type ParticleRequest,
  type WriteAction,
  type Work,
} from "../../src/tools/particle.js";
import { openVanillaCorpus, seededSample } from "./_corpus.js";

const OPEN = openVanillaCorpus(undefined, { ignoreBaseline: true });
if (OPEN.skip !== undefined) console.warn(`[corpus] w5 particle SKIPPED: ${OPEN.skip}`);

const SEED = "w5-particle-edit-v1";
const PROBE = "emcp_probe";
const SET_KEYS = new Set(["BirthRate", "Lifetime", "MaxNum", "Velocity"]);

/** The span where `a` and `b` differ: `[start, endA)` of `a` became `[start, endB)` of `b`. */
function region(a: string, b: string): { start: number; endA: number; endB: number } {
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { start: p, endA: a.length - s, endB: b.length - s };
}

describe.skipIf(OPEN.skip !== undefined)(
  `w5 particle on the vanilla corpus${OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""}`,
  () => {
    const corpus = OPEN.corpus!;
    const files = corpus.list("ptc");
    const config = loadConfig();
    const pak = PakVirtualFS.get(config.gamePath);
    const vfs: PakLike = {
      exists: (p) => pak?.exists(p) ?? false,
      readFile: (p) => corpus.read(p),
    };

    it("has the corpus to prove it on", () => {
      expect(files.length).toBeGreaterThan(400);
      console.log(`w5 particle corpus: ${files.length} .ptc files (build ${corpus.build})`);
    });

    it("every .ptc comes back byte for byte, parses clean as one EffectDef, and is editable", () => {
      const off: string[] = [];
      const dirty: string[] = [];
      const refused: string[] = [];
      for (const p of files) {
        const buf = corpus.read(p);
        const doc = parseCstBytes(buf);
        if (Buffer.compare(doc.toBytes(), buf) !== 0) off.push(p);
        if (doc.diagnostics.length > 0 || !viewParticle(doc).ok) dirty.push(p);
        const why = unwritableReason(buf, doc);
        if (why) refused.push(`${p}: ${why}`);
      }
      console.log(
        `w5 particle round trip: ${files.length - off.length}/${files.length} byte-exact, ` +
          `${files.length - dirty.length} clean, ${files.length - refused.length} editable`,
      );
      expect(off).toEqual([]);
      expect(dirty).toEqual([]);
      expect(refused).toEqual([]);
    });

    it("read never throws: every read action answers ok on every file, and the catalog covers the corpus", () => {
      let emitters = 0;
      let curves = 0;
      let refs = 0;
      let missingRefs = 0;
      let issueCounts = new Map<string, number>();
      const notOk: string[] = [];
      const counted: string[] = [];
      const uncatalogued = new Set<string>();
      for (const p of files) {
        const text = corpus.readText(p);
        const independent = (text.match(/^[ \t]*EmitterDef\b[^\n]*\{[ \t]*\r?$/gm) ?? []).length;
        const call = (req: ParticleRequest) => {
          let r;
          try {
            r = runParticle({ ...req, path: p, limit: 200 }, config, { vfs });
          } catch (e) {
            notOk.push(`${p} ${req.action}: threw ${String(e)}`);
            return undefined;
          }
          if (!r.ok) {
            notOk.push(`${p} ${req.action}: ${r.code} ${r.message}`);
            return undefined;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return r.readback as any;
        };
        const inspect = call({ action: "inspect" });
        if (inspect) {
          emitters += inspect.emitterCount;
          curves += inspect.curveCount;
          if (inspect.emitterCount !== independent)
            counted.push(`${p}: ${inspect.emitterCount} vs ${independent}`);
        }
        call({ action: "emitters" });
        if (independent > 0) call({ action: "emitter", index: 0 });
        const c = call({ action: "curves" });
        if (c && c.total !== inspect?.curveCount)
          counted.push(`${p}: curves ${c.total} vs ${inspect?.curveCount}`);
        const r = call({ action: "refs" });
        if (r) {
          refs += r.total;
          missingRefs += r.missing;
        }
        const doc = parseCstBytes(corpus.read(p));
        const issues = validateView(doc, viewParticle(doc));
        for (const i of issues) {
          const k = `${i.severity}:${i.code}`;
          issueCounts = issueCounts.set(k, (issueCounts.get(k) ?? 0) + 1);
          if (i.code === "UNKNOWN_KEY" || i.code === "UNKNOWN_CURVE") uncatalogued.add(i.message);
        }
        call({ action: "validate" });
      }
      const summary = [...issueCounts.entries()]
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(
        `w5 particle reads: ${files.length} files, ${emitters} emitters, ${curves} curves, ` +
          `${refs} refs (${missingRefs} not found); validate: ${summary || "no issues"}`,
      );
      expect(notOk).toEqual([]);
      expect(counted).toEqual([]);
      expect([...uncatalogued]).toEqual([]);
      // The corpus is valid as far as the tool can tell: no error issue of any kind.
      expect([...issueCounts.keys()].filter((k) => k.startsWith("error:"))).toEqual([]);
      expect(emitters).toBeGreaterThan(2000);
      expect(curves).toBeGreaterThan(10000);
      expect(Object.keys(CURVES).length).toBeGreaterThan(10);
    }, 120_000);

    it("edit locality: each write changes only its own node, and the inverse restores the bytes", () => {
      const sample = seededSample(files, 20, "particle-edit", SEED);
      expect(sample).toHaveLength(20);
      const bad: string[] = [];
      const done = new Map<string, number>();
      const mark = (k: string) => done.set(k, (done.get(k) ?? 0) + 1);
      const text = (w: Work) => w.doc.serialize();

      const fileOf = (p: string): { buf: Buffer; w: Work; before: string } => {
        const buf = corpus.read(p);
        const w: Work = { doc: parseCstBytes(buf) };
        return { buf, w, before: text(w) };
      };
      const apply = (
        w: Work,
        action: Exclude<WriteAction, "create">,
        req: Partial<ParticleRequest>,
        ctx?: EditContext,
      ) => applyEdit(w, action, { action, ...req }, ctx as EditContext);
      const inside = (who: string, r: { start: number; endA: number }, lo: number, hi: number) => {
        if (r.start < lo || r.endA > hi)
          bad.push(`${who}: changed ${r.start}..${r.endA}, allowed ${lo}..${hi}`);
      };
      const restored = (who: string, w: Work, buf: Buffer) => {
        if (Buffer.compare(w.doc.toBytes(), buf) !== 0)
          bad.push(`${who}: inverse did not restore the bytes`);
      };

      for (const p of sample) {
        const f0 = fileOf(p);
        const view = viewParticle(f0.w.doc);
        const block = view.block!;
        const first = view.emitters[0];
        if (!first) continue;

        // set: one existing scalar, within its value tokens; the inverse writes the old text back.
        {
          const { w, buf, before } = fileOf(p);
          const isKey = (x: { key: string; values: string[] }) =>
            SET_KEYS.has(x.key) && x.values.length === 1 && /^[-\d.]+$/.test(x.values[0]);
          const e = viewParticle(w.doc).emitters.find((x) => x.props.some(isKey));
          const q = e?.props.find(isKey);
          if (e && q) {
            const old = q.values[0];
            const next = String(Number(old) + 1);
            apply(w, "set", { emitter: undefined, index: e.ordinal, props: { [q.key]: next } });
            const r = region(before, text(w));
            inside(`${p} set`, r, q.valueStart, q.valueEnd);
            if (String(Number(old)) === old) {
              apply(w, "set", { index: e.ordinal, props: { [q.key]: old } });
              restored(`${p} set`, w, buf);
            }
            mark("set");
          }
        }

        // setCurve: one curve, within its block; the inverse writes the old numbers back.
        {
          const { w, buf, before } = fileOf(p);
          const e = viewParticle(w.doc).emitters.find((x) => x.curves.some((c) => c.wellFormed));
          const c = e?.curves.find((x) => x.wellFormed);
          if (e && c) {
            const old = c.numbers.map(Number);
            const next = old.map((n, i) => (i % c.stride === 1 ? n + 1 : n));
            apply(w, "setCurve", { index: e.ordinal, curve: c.name, points: next });
            inside(`${p} setCurve`, region(before, text(w)), c.start, c.end);
            if (c.numbers.every((t) => String(Number(t)) === t)) {
              apply(w, "setCurve", { index: e.ordinal, curve: c.name, points: old });
              restored(`${p} setCurve`, w, buf);
            }
            mark("setCurve");
          }
        }

        // addEmitter at the end: a pure insertion inside the Emitters block; removeEmitter undoes it.
        {
          const { w, buf, before } = fileOf(p);
          apply(w, "addEmitter", { name: PROBE, props: { BirthRate: 1 } });
          const r = region(before, text(w));
          inside(`${p} addEmitter`, r, block.open.end, block.close!.start);
          if (r.endA !== r.start) bad.push(`${p} addEmitter: not a pure insertion`);
          apply(w, "removeEmitter", { emitter: PROBE });
          restored(`${p} addEmitter`, w, buf);
          mark("addEmitter");
        }

        // cloneEmitter: a pure insertion that copies the source emitter's props and curves.
        {
          const { w, buf, before } = fileOf(p);
          apply(w, "cloneEmitter", { index: 0, name: PROBE });
          const r = region(before, text(w));
          inside(`${p} cloneEmitter`, r, block.open.end, block.close!.start);
          if (r.endA !== r.start) bad.push(`${p} cloneEmitter: not a pure insertion`);
          const v = viewParticle(w.doc);
          const src = v.emitters[0];
          const clone = v.emitters[1];
          const shape = (e: typeof src) =>
            JSON.stringify([
              e.props.map((x) => [x.key, x.values, x.quoted]),
              e.curves.map((c) => [c.name, c.numbers]),
            ]);
          if (clone.name !== PROBE || shape(clone) !== shape(src))
            bad.push(`${p} cloneEmitter: the clone differs from its source`);
          apply(w, "removeEmitter", { emitter: PROBE });
          restored(`${p} cloneEmitter`, w, buf);
          mark("cloneEmitter");
        }

        // copyEmitter from another file: a pure insertion; removeEmitter undoes it.
        {
          const other = sample[(sample.indexOf(p) + 1) % sample.length];
          const src = fileOf(other);
          const { w, buf, before } = fileOf(p);
          apply(
            w,
            "copyEmitter",
            { index: 0, name: PROBE, at: 0 },
            { source: { doc: src.w.doc, rel: other, game: true } },
          );
          const r = region(before, text(w));
          inside(`${p} copyEmitter`, r, block.open.end, block.close!.start);
          if (r.endA !== r.start) bad.push(`${p} copyEmitter: not a pure insertion`);
          apply(w, "removeEmitter", { emitter: PROBE });
          restored(`${p} copyEmitter`, w, buf);
          mark("copyEmitter");
        }

        // renameEmitter: only the name token; the inverse names it back.
        {
          const { w, buf, before } = fileOf(p);
          const e = viewParticle(w.doc).emitters[0];
          const tok = e.obj.head[1];
          apply(w, "renameEmitter", { index: 0, name: PROBE });
          inside(`${p} renameEmitter`, region(before, text(w)), tok.start, tok.end);
          apply(w, "renameEmitter", { index: 0, name: e.name });
          restored(`${p} renameEmitter`, w, buf);
          mark("renameEmitter");
        }

        // removeEmitter: a pure deletion inside the emitter's lines; copying it back restores the file.
        {
          const { w, buf, before } = fileOf(p);
          const e = viewParticle(w.doc).emitters[0];
          const src = parseCstBytes(buf);
          apply(w, "removeEmitter", { index: 0 });
          // Exactly the emitter's own lines go (a diff of similar neighbours cannot say where).
          const ls = before.lastIndexOf("\n", e.start - 1) + 1;
          const nl = before.indexOf("\n", e.end);
          const le = nl < 0 ? before.length : nl + 1;
          if (text(w) !== before.slice(0, ls) + before.slice(le))
            bad.push(`${p} removeEmitter: more than the emitter's lines changed`);
          apply(
            w,
            "copyEmitter",
            { index: 0, name: e.name, at: 0 },
            { source: { doc: src, rel: p, game: true } },
          );
          restored(`${p} removeEmitter`, w, buf);
          mark("removeEmitter");
        }

        // moveEmitter: inside the Emitters block; moving back restores the file.
        if (view.emitters.length >= 2) {
          const { w, buf, before } = fileOf(p);
          const last = view.emitters.length - 1;
          apply(w, "moveEmitter", { index: 0, at: last });
          inside(`${p} moveEmitter`, region(before, text(w)), block.open.end, block.close!.start);
          apply(w, "moveEmitter", { index: last, at: 0 });
          restored(`${p} moveEmitter`, w, buf);
          mark("moveEmitter");
        }
      }
      console.log(
        `w5 particle edit locality: 20 files; ${[...done.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`,
      );
      expect(bad).toEqual([]);
      for (const a of [
        "set",
        "setCurve",
        "addEmitter",
        "cloneEmitter",
        "copyEmitter",
        "renameEmitter",
        "removeEmitter",
      ]) {
        expect(done.get(a), a).toBe(20);
      }
      expect(done.get("moveEmitter")).toBeGreaterThan(0);
    }, 120_000);

    it("add then remove, and rename then back, restore every one of the files", () => {
      const off: string[] = [];
      let moved = 0;
      for (const p of files) {
        const buf = corpus.read(p);
        const w: Work = { doc: parseCstBytes(buf) };
        applyEdit(w, "addEmitter", { action: "addEmitter", name: PROBE });
        applyEdit(w, "removeEmitter", { action: "removeEmitter", emitter: PROBE });
        if (Buffer.compare(w.doc.toBytes(), buf) !== 0) off.push(`${p}: add/remove`);
        const v = viewParticle(w.doc);
        if (v.emitters.length >= 1) {
          const name = v.emitters[0].name;
          applyEdit(w, "renameEmitter", { action: "renameEmitter", index: 0, name: PROBE });
          applyEdit(w, "renameEmitter", { action: "renameEmitter", index: 0, name });
          if (Buffer.compare(w.doc.toBytes(), buf) !== 0) off.push(`${p}: rename`);
        }
        if (v.emitters.length >= 2) {
          applyEdit(w, "moveEmitter", { action: "moveEmitter", index: 0, at: 1 });
          applyEdit(w, "moveEmitter", { action: "moveEmitter", index: 1, at: 0 });
          if (Buffer.compare(w.doc.toBytes(), buf) !== 0) off.push(`${p}: move`);
          moved++;
        }
      }
      console.log(
        `w5 particle inverse pairs: ${files.length} files, ${moved} with two or more emitters moved`,
      );
      expect(off).toEqual([]);
    }, 120_000);
  },
);
