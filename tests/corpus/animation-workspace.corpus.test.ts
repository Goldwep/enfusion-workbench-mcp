/**
 * `animation_workspace` on every vanilla workspace of the installed game (phase5-w4-spec.md section 4,
 * gates 1, 2, 5 and 6). Build-independent, so the corpus is opened whatever its build; skipped when
 * there is no game install.
 *
 *   gate 1  every .aw .agr .agf .ast .asi .ae .aex .asy parses and serialises byte-exactly, and a
 *           link rewrite that changes nothing gives the bytes back
 *   gate 2  files and validate finish on every one of the .aw files
 *   gate 5  files resolves every ast, asi, agr, agf and asy link of each workspace
 *   gate 6  duplicate of 10 seeded workspaces into a temp project leaves no GUID of the source set in
 *           the copies and keeps every outside link (xob, anm, acp)
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { loadConfig } from "../../src/config.js";
import {
  filesOf,
  issuesOf,
  renderWith,
  runAnimationWorkspace,
  scanRefs,
  type Env,
  type WorkspaceOk,
} from "../../src/tools/animation-workspace.js";
import { makeConfig } from "../tools/_tool-harness.js";
import { loadBaseline, openVanillaCorpus, seededSample } from "./_corpus.js";

const open = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });

const EXTS = ["aw", "agr", "agf", "ast", "asi", "ae", "aex", "asy"] as const;
const KNOWN_UNRESOLVED = ["Assets/Vehicles/Helicopters/workspaces/Vehicles_Aircrafts.aw: 1 agf"];
const SET = ["ast", "asi", "agr", "agf", "asy", "aex", "ae"];

describe.skipIf(open.skip !== undefined)("vanilla animation workspaces", () => {
  const corpus = open.corpus!;
  const vfs = open.corpus ? PakVirtualFS.get(loadConfig().gamePath)! : (undefined as never);
  const env: Env = { vfs };
  const aws = open.corpus ? corpus.list("aw") : [];

  it("has workspaces to read", () => {
    expect(aws.length).toBe(131);
  });

  it("gate 1: parses and serialises every file of the set byte for byte", () => {
    const off: string[] = [];
    let n = 0;
    for (const ext of EXTS) {
      for (const f of corpus.list(ext)) {
        const buf = corpus.read(f);
        const doc = parseCstBytes(buf);
        n++;
        if (Buffer.compare(doc.toBytes(), buf) !== 0) off.push(f);
        else if (renderWith(doc, scanRefs(doc), () => undefined) !== doc.serialize()) off.push(f);
      }
    }
    expect(n).toBeGreaterThan(600);
    expect(off).toEqual([]);
  });

  it("gates 2 and 5: files and validate finish on every workspace; no ast, asi, agr, agf or asy link is unresolved beyond the one shipped gap", () => {
    const failures: string[] = [];
    const unresolved: string[] = [];
    let files = 0;
    for (const f of aws) {
      try {
        const r = filesOf({ action: "files", path: f }, env);
        files += r.nodes.length;
        for (const ext of SET) {
          const c = r.counts[ext];
          if (c && c.unresolved > 0) unresolved.push(`${f}: ${c.unresolved} ${ext}`);
        }
        issuesOf({ action: "validate", path: f }, env);
      } catch (e) {
        failures.push(`${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(failures).toEqual([]);
    // One shipped workspace links an .agf that the paks do not hold (measured on 1.9.0.37); any other
    // unresolved ast, asi, agr, agf or asy link is a defect of this tool.
    expect(unresolved).toEqual(KNOWN_UNRESOLVED);
    expect(files).toBeGreaterThan(1000);
  }, 180_000);

  it("validate reports no error on any vanilla workspace", () => {
    const errors: string[] = [];
    for (const f of aws) {
      for (const i of issuesOf({ action: "validate", path: f }, env).issues) {
        if (i.severity === "error") errors.push(`${f} [${i.kind}]: ${i.message}`);
      }
    }
    expect(errors).toEqual([]);
  }, 180_000);

  it("gate 6: duplicate of 10 seeded workspaces leaves no source GUID and keeps the outside links", async () => {
    const root = mkdtempSync(join(tmpdir(), "aw-corpus-"));
    try {
      const config = makeConfig({ projectPath: root });
      let counter = 0;
      const client = {
        call: async (_fn: string, params: Record<string, unknown>) => {
          counter++;
          return {
            status: "ok",
            code: "",
            registered: 1,
            dryRun: 0,
            resourceName: `{F${String(counter).padStart(15, "0")}}${params.path}`,
          };
        },
      } as never;
      const sample = seededSample(aws, 10, "aw-duplicate");
      expect(sample).toHaveLength(10);
      for (const [i, f] of sample.entries()) {
        const set = filesOf({ action: "files", path: f }, env);
        const setGuids = new Set(set.nodes.filter((n) => n.copy).map((n) => n.guid));
        const outside = set.nodes.filter((n) => !n.copy && n.guid !== "");
        const target = `dup${i}/copy.aw`;
        const r = await runAnimationWorkspace(
          { action: "duplicate", path: f, target, confirm: true },
          config,
          { vfs, client },
        );
        if (!r.ok) throw new Error(`${f}: ${r.code}: ${r.message}`);
        const written = (r as WorkspaceOk).readback as { written: { to: string }[] };
        expect(written.written.length).toBe(setGuids.size + 1);
        let outsideCopy = 0;
        let outsideSrc = 0;
        for (const w of written.written) {
          const text = readFileSync(join(root, w.to), "utf-8");
          for (const g of setGuids)
            expect(text.includes(g), `${f} -> ${w.to} holds ${g}`).toBe(false);
          outsideCopy += scanRefs(parseCstBytes(Buffer.from(text))).filter((x) =>
            outside.some((o) => o.guid === x.guid),
          ).length;
        }
        for (const [key, t] of set.closure.text) {
          void key;
          outsideSrc += t.refs.filter((x) => outside.some((o) => o.guid === x.guid)).length;
        }
        expect(outsideCopy).toBe(outsideSrc);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
