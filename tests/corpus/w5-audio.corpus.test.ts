/**
 * The audio tool and its model (src/tools/audio.ts, src/formats/audio-model.ts)
 * on the vanilla corpus (W5 spec 4.2, DEC-068; package W5-TA-3A).
 *
 * Reads the installed game's paks through the repo's pak reader and is SKIPPED
 * when the game is absent (the harness's rules, tests/corpus/README.md). It
 * measures whole sets, not samples: every .acp, .sig, .afm and every
 * AudioVariablesClass .conf.
 *
 *   - round trip: parse then toBytes equals the pak bytes, 0 diagnostics;
 *   - read never throws: the model and the tool's read actions answer for every file;
 *   - references: every `{GUID}path` resolves in the pak index or is counted missing;
 *   - edit locality: on 20 seeded .acp files, each write action changes bytes only
 *     inside the edited node, and its inverse restores the original bytes.
 *
 * On the 1.9.0.37 paks the spec counts 720 .acp, 287 .sig, 2 .afm and 4 variables
 * confs; those exact counts are asserted when the paks hold that build's 251,200
 * files, and a different build only has to hold some of each.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../src/config.js";
import {
  audioLinks,
  audioNodes,
  blockOf,
  eventsOf,
  loadAudioModel,
  numberLine,
  refsOf,
  samplesOf,
  scalarOf,
  validateAudio,
  variablesOf,
  type AudioKind,
  type AudioModel,
} from "../../src/formats/audio-model.js";
import { parseCstBytes, tokenValue } from "../../src/formats/enfusion-cst.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { runAudio, type AudioRequest } from "../../src/tools/audio.js";
import { openVanillaCorpus, seededSample, type Corpus } from "./_corpus.js";

const OPEN = openVanillaCorpus(undefined, { ignoreBaseline: true });
if (OPEN.skip !== undefined) console.warn(`[corpus] w5 audio SKIPPED: ${OPEN.skip}`);

/** The build the spec's counts were measured on (E02 1.9.0.37). */
const SPEC_FILES = 251_200;
const SPEC_COUNTS: Record<AudioKind, number> = { acp: 720, sig: 287, afm: 2, vars: 4 };

interface Sets {
  acp: string[];
  sig: string[];
  afm: string[];
  vars: string[];
}

function collect(corpus: Corpus): Sets {
  const vars: string[] = [];
  for (const p of corpus.list("conf")) {
    try {
      const head = corpus.read(p).subarray(0, 96).toString("latin1").replace(/^﻿/, "");
      if (head.trimStart().startsWith("AudioVariablesClass")) vars.push(p);
    } catch {
      // an unreadable entry is not an audio file
    }
  }
  return { acp: corpus.list("acp"), sig: corpus.list("sig"), afm: corpus.list("afm"), vars };
}

const KINDS: AudioKind[] = ["acp", "sig", "afm", "vars"];

let cached: Sets | undefined;
const setsOf = (corpus: Corpus): Sets => (cached ??= collect(corpus));

const config = (): Config => ({ ...loadConfig(), projectPath: "" });

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(OPEN.skip !== undefined)(
  `w5 audio on the vanilla corpus${OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""}`,
  () => {
    it("round trips every .acp, .sig, .afm and audio variables .conf byte for byte", () => {
      const corpus = OPEN.corpus as Corpus;
      const sets = setsOf(corpus);
      const full = corpus.fileCount === SPEC_FILES;
      const lines: string[] = [];
      for (const kind of KINDS) {
        let exact = 0;
        let diags = 0;
        let bytes = 0;
        const misses: string[] = [];
        for (const p of sets[kind]) {
          const buf = corpus.read(p);
          bytes += buf.length;
          const model = loadAudioModel(buf, kind);
          diags += model.doc.diagnostics.length;
          if (model.doc.toBytes().equals(buf)) exact++;
          else misses.push(p);
        }
        lines.push(
          `${kind}: ${exact}/${sets[kind].length} exact, ${diags} diagnostics, ${bytes} bytes`,
        );
        expect(misses.slice(0, 5), `${kind} not byte-exact`).toEqual([]);
        expect(diags, `${kind} diagnostics`).toBe(0);
        if (full) expect(sets[kind].length, `${kind} count`).toBe(SPEC_COUNTS[kind]);
        else expect(sets[kind].length, `${kind} count`).toBeGreaterThan(0);
      }
      console.log(`[corpus] w5 audio round trip\n  ${lines.join("\n  ")}`);
    }, 300_000);

    it("reads never throw: the model answers for every file and the tool's inspect and validate are ok", () => {
      const corpus = OPEN.corpus as Corpus;
      const sets = setsOf(corpus);
      const cfg = config();
      const totals = {
        files: 0,
        nodes: 0,
        links: 0,
        events: 0,
        samples: 0,
        refs: 0,
        variables: 0,
        errors: 0,
      };
      const failures: string[] = [];
      for (const kind of KINDS) {
        for (const p of sets[kind]) {
          totals.files++;
          try {
            const model = loadAudioModel(corpus.read(p), kind);
            const nodes = audioNodes(model);
            totals.nodes += nodes.length;
            totals.links += audioLinks(model, nodes).length;
            totals.events += eventsOf(model, nodes).length;
            totals.samples += samplesOf(model, nodes).length;
            totals.refs += refsOf(model, nodes).length;
            totals.variables += variablesOf(model, nodes).length;
            totals.errors += validateAudio(model).filter((i) => i.severity === "error").length;
          } catch (e) {
            failures.push(`${p}: model threw ${e instanceof Error ? e.message : String(e)}`);
          }
          for (const action of ["inspect", "validate"] as const) {
            const r = runAudio({ action, path: p } as AudioRequest, cfg);
            if (!r.ok) failures.push(`${p}: ${action} ${r.code} ${r.message}`);
          }
        }
      }
      console.log(`[corpus] w5 audio reads: ${JSON.stringify(totals)}`);
      expect(failures.slice(0, 5)).toEqual([]);
      expect(totals.nodes).toBeGreaterThan(0);
      // The vanilla files are the reference: validate must not call any of them an error.
      expect(totals.errors).toBe(0);
    }, 600_000);

    it("every read action answers ok on a seeded sample of each kind, paged to the end", () => {
      const corpus = OPEN.corpus as Corpus;
      const sets = setsOf(corpus);
      const cfg = config();
      const actions: Record<AudioKind, AudioRequest["action"][]> = {
        acp: ["events", "nodes", "graph", "samples", "refs", "variables", "mixer", "signal"],
        sig: ["nodes", "graph", "refs", "variables", "signal"],
        afm: ["nodes", "graph", "mixer"],
        vars: ["nodes", "variables"],
      };
      const failures: string[] = [];
      let calls = 0;
      let pages = 0;
      for (const kind of KINDS) {
        for (const p of seededSample(sets[kind], 25, `w5-audio-read-${kind}`)) {
          for (const action of actions[kind]) {
            let cursor: string | undefined;
            for (let guard = 0; guard < 400; guard++) {
              const r = runAudio({ action, path: p, limit: 200, cursor } as AudioRequest, cfg);
              calls++;
              if (!r.ok) {
                failures.push(`${p}: ${action} ${r.code} ${r.message}`);
                break;
              }
              const next = (r.readback as { nextCursor?: string }).nextCursor;
              if (!next) break;
              pages++;
              cursor = next;
            }
          }
        }
      }
      console.log(`[corpus] w5 audio read actions: ${calls} calls, ${pages} follow-up pages`);
      expect(failures.slice(0, 5)).toEqual([]);
    }, 600_000);

    it("every reference resolves in the pak index or is counted missing, and each wav maps back to its .acp files", () => {
      const corpus = OPEN.corpus as Corpus;
      const sets = setsOf(corpus);
      const vfs = PakVirtualFS.get(config().gamePath) as PakVirtualFS;
      const seen = new Map<string, boolean>();
      const wavHolders = new Map<string, Set<string>>();
      let refs = 0;
      for (const p of sets.acp) {
        for (const r of refsOf(loadAudioModel(corpus.read(p), "acp"))) {
          refs++;
          if (!seen.has(r.path)) seen.set(r.path, vfs.exists(r.path));
          if (r.path.toLowerCase().endsWith(".wav")) {
            const s = wavHolders.get(r.path) ?? new Set<string>();
            s.add(p);
            wavHolders.set(r.path, s);
          }
        }
      }
      const missing = [...seen].filter(([, ok]) => !ok).map(([path]) => path);
      console.log(
        `[corpus] w5 audio refs: ${refs} references, ${seen.size} distinct paths, ${missing.length} missing, ${wavHolders.size} wav files held by an .acp`,
      );
      expect(refs).toBeGreaterThan(0);
      expect(seen.size).toBeGreaterThan(0);
      expect(wavHolders.size).toBeGreaterThan(0);
      // Recorded, not asserted to be 0 (spec 4.2).
      expect(missing.length).toBeLessThan(seen.size);
    }, 300_000);

    it("a .sig is refused READ_ONLY_SOURCE for every write (OD-9) and left untouched", () => {
      const corpus = OPEN.corpus as Corpus;
      const sets = setsOf(corpus);
      const root = mkdtempSync(join(tmpdir(), "w5-audio-sig-"));
      tmpDirs.push(root);
      const p = seededSample(sets.sig, 1, "w5-audio-sig")[0];
      const bytes = corpus.read(p);
      const file = join(root, "Sig/X.sig");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      const model = loadAudioModel(bytes, "sig");
      const node = audioNodes(model)[0];
      for (const req of [
        { action: "set", node: node?.id, key: "name", value: "x", confirm: true },
        { action: "setSimValue", node: node?.id, value: 1, confirm: true },
        { action: "create", overwrite: true, confirm: true },
      ]) {
        const r = runAudio(
          { ...req, path: "Sig/X.sig", projectPath: root } as AudioRequest,
          // The caller projectPath must sit inside a configured root (pinnedProjectRoot).
          { ...config(), projectPath: root },
        );
        if (r.ok) throw new Error(`expected a refusal for ${req.action}`);
        expect(r.code).toBe("READ_ONLY_SOURCE");
      }
      expect(readFileSync(file).equals(bytes)).toBe(true);
    });

    it("edit locality on 20 seeded .acp files: each write changes only the edited node, and its inverse restores the bytes", () => {
      const corpus = OPEN.corpus as Corpus;
      const sets = setsOf(corpus);
      const root = mkdtempSync(join(tmpdir(), "w5-audio-edit-"));
      tmpDirs.push(root);
      // The caller projectPath must sit inside a configured root (pinnedProjectRoot).
      const cfg: Config = { ...config(), projectPath: root };
      const picked = seededSample(sets.acp, 20, "w5-audio-edit");
      expect(picked).toHaveLength(20);
      const ran: Record<string, number> = {
        set: 0,
        renameEvent: 0,
        addRemoveSample: 0,
        setSample: 0,
        setSimValue: 0,
      };
      const skipped: Record<string, number> = { ...ran };
      const problems: string[] = [];

      const rel = (i: number) => `Edit/F${i}.acp`;
      const textOf = (file: string) => parseCstBytes(readFileSync(file)).text;
      const run = (i: number, req: Partial<AudioRequest> & { action: AudioRequest["action"] }) =>
        runAudio({ ...req, path: rel(i), projectPath: root, confirm: true } as AudioRequest, cfg);

      /** `after` differs from `before` only inside [start, end) of `before`. */
      const inside = (label: string, before: string, after: string, start: number, end: number) => {
        const tail = before.length - end;
        if (
          after.slice(0, start) !== before.slice(0, start) ||
          after.slice(after.length - tail) !== before.slice(end)
        ) {
          problems.push(`${label}: bytes changed outside the node [${start}, ${end})`);
        }
        if (after === before) problems.push(`${label}: the edit changed nothing`);
      };

      picked.forEach((p, i) => {
        const orig = corpus.read(p);
        const file = join(root, rel(i));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, orig);
        const origText = parseCstBytes(orig).text;
        const model: AudioModel = loadAudioModel(orig, "acp");
        const nodes = audioNodes(model);
        const label = (op: string) => `${p} ${op}`;
        const restored = (op: string) => {
          if (!readFileSync(file).equals(orig))
            problems.push(`${label(op)}: the inverse did not restore the bytes`);
        };
        const check = (op: string, r: ReturnType<typeof run>) => {
          if (!r.ok) problems.push(`${label(op)}: ${r.code} ${r.message}`);
          return r.ok;
        };

        // set: bump the first node's numeric `version`.
        const withVersion = nodes.find((n) => {
          const v = scalarOf(n.obj, "version");
          return v !== undefined && v.values.length === 1 && /^\d+$/.test(tokenValue(v.values[0]));
        });
        if (withVersion && withVersion.id !== undefined) {
          const v = Number(tokenValue(scalarOf(withVersion.obj, "version")!.values[0]));
          if (
            check(
              "set",
              run(i, { action: "set", node: withVersion.id, key: "version", value: v + 1 }),
            )
          ) {
            inside(
              label("set"),
              origText,
              textOf(file),
              withVersion.obj.start,
              withVersion.obj.end,
            );
            check(
              "set back",
              run(i, { action: "set", node: withVersion.id, key: "version", value: v }),
            );
            restored("set");
            ran.set++;
          }
        } else skipped.set++;

        // renameEvent: the first event with a unique name.
        const events = eventsOf(model, nodes);
        const ev = events.find(
          (e) => events.filter((x) => x.name === e.name).length === 1 && !/[\\"]/.test(e.name),
        );
        if (ev) {
          const renamed = `${ev.name}_W5`;
          if (
            check("renameEvent", run(i, { action: "renameEvent", event: ev.id, name: renamed }))
          ) {
            inside(
              label("renameEvent"),
              origText,
              textOf(file),
              ev.node.obj.start,
              ev.node.obj.end,
            );
            check(
              "renameEvent back",
              run(i, { action: "renameEvent", event: ev.id, name: ev.name }),
            );
            restored("renameEvent");
            ran.renameEvent++;
          }
        } else skipped.renameEvent++;

        // addSample then removeSample: the first bank that already holds samples.
        const samples = samplesOf(model, nodes);
        const bank = samples[0]?.bank;
        if (bank && bank.id !== undefined) {
          const added = run(i, {
            action: "addSample",
            bank: bank.id,
            name: "w5_probe.wav",
            file: "{0123456789ABCDEF}W5/probe.wav",
            probability: 50,
          });
          if (check("addSample", added)) {
            inside(label("addSample"), origText, textOf(file), bank.obj.start, bank.obj.end);
            check(
              "removeSample",
              run(i, { action: "removeSample", bank: bank.id, sample: "w5_probe.wav" }),
            );
            restored("addSample");
            ran.addRemoveSample++;
          }
        } else skipped.addRemoveSample++;

        // setSample: the first sample with an Index.
        const withIndex = samples.find((s) => s.index !== undefined && Number.isInteger(s.index));
        const sameName = withIndex
          ? samples.filter((s) => s.bank.id === withIndex.bank.id && s.name === withIndex.name)
              .length
          : 0;
        if (withIndex && withIndex.bank.id !== undefined && sameName === 1) {
          const idx = withIndex.index as number;
          const bankId = withIndex.bank.id;
          if (
            check(
              "setSample",
              run(i, {
                action: "setSample",
                bank: bankId,
                sample: withIndex.position,
                index: idx + 1,
              }),
            )
          ) {
            inside(
              label("setSample"),
              origText,
              textOf(file),
              withIndex.bank.obj.start,
              withIndex.bank.obj.end,
            );
            check(
              "setSample back",
              run(i, { action: "setSample", bank: bankId, sample: withIndex.position, index: idx }),
            );
            restored("setSample");
            ran.setSample++;
          }
        } else skipped.setSample++;

        // setSimValue: the first signal whose first input value reads back as its own number.
        const sig = nodes.find((n) => {
          if (n.cls !== "SignalClass" || n.id === undefined) return false;
          const vals = blockOf(n.obj, "inputvalues");
          const ports = numberLine(blockOf(n.obj, "inputsport"));
          if (!vals || vals.children.length !== 1 || ports.length === 0) return false;
          const first = vals.children[0];
          const toks = first.kind === "value" ? first.values.map(tokenValue) : [];
          return toks.length === ports.length && String(Number(toks[0])) === toks[0];
        });
        if (sig && sig.id !== undefined) {
          const vals = blockOf(sig.obj, "inputvalues");
          const first = vals?.children[0];
          const original = first?.kind === "value" ? Number(tokenValue(first.values[0])) : 0;
          if (
            check(
              "setSimValue",
              run(i, { action: "setSimValue", node: sig.id, index: 0, value: original + 7.25 }),
            )
          ) {
            inside(label("setSimValue"), origText, textOf(file), sig.obj.start, sig.obj.end);
            check(
              "setSimValue back",
              run(i, { action: "setSimValue", node: sig.id, index: 0, value: original }),
            );
            restored("setSimValue");
            ran.setSimValue++;
          }
        } else skipped.setSimValue++;
      });

      console.log(
        `[corpus] w5 audio edit locality: ran ${JSON.stringify(ran)}, skipped ${JSON.stringify(skipped)}`,
      );
      expect(problems.slice(0, 8)).toEqual([]);
      for (const [op, n] of Object.entries(ran))
        expect(n, `${op} ran on at least one file`).toBeGreaterThan(0);
    }, 600_000);
  },
);
