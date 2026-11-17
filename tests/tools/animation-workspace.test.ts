import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config.js";
import { parseCst, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { WorkbenchError } from "../../src/workbench/client.js";
import {
  ANIMATION_WORKSPACE_DESCRIPTION,
  MAX_DUPLICATE_FILES,
  REWRITE_INCOMPLETE,
  registerAnimationWorkspace,
  renderWith,
  runAnimationWorkspace,
  scanRefs,
  workspaceSkeleton,
  type PakLike,
  type WorkspaceError,
  type WorkspaceOk,
  type WorkspaceRequest,
  type WorkspaceResponse,
} from "../../src/tools/animation-workspace.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const G = {
  ast: "AAAAAAAA00000001",
  asi: "AAAAAAAA00000002",
  asiB: "AAAAAAAA00000003",
  agr: "AAAAAAAA00000004",
  asy: "AAAAAAAA00000005",
  agf: "AAAAAAAA00000006",
  xob: "CCCCCCCC00000001",
  acp: "CCCCCCCC00000002",
  anm: "CCCCCCCC00000003",
};

const AW = [
  "BaseSource {",
  ` AnimSetTemplate "{${G.ast}}ws/foo.ast"`,
  " AnimSetInstances {",
  `  "{${G.asi}}ws/foo.asi"`,
  `  "{${G.asiB}}ws/foo_b.asi"`,
  " }",
  ` AnimGraph "{${G.agr}}ws/foo.agr"`,
  " PreviewModels {",
  '  AnimSrcWorkspacePreviewModel "{5555555555555551}" {',
  `   Model "{${G.xob}}Assets/m.xob"`,
  "  }",
  " }",
  ' AudioTesting AnimSrcWorkspaceAudioTesting "{5555555555555552}" {',
  "  AudioProjects {",
  '   AnimSrcWorkspaceAudioProject "{5555555555555553}" {',
  `    ProjectFile "{${G.acp}}Sounds/a.acp"`,
  "   }",
  "  }",
  " }",
  ` SyncTable "{${G.asy}}ws/Sync.asy"`,
  ' IkTesting AnimSrcWorkspaceIkTesting "{5555555555555554}" {',
  " }",
  "}",
].join("\n");

const AGR = [
  "AnimSrcGraph {",
  ` AnimSetTemplate "{${G.ast}}ws/foo.ast"`,
  ` AnimSyncTable "{${G.asy}}ws/Sync.asy"`,
  " Includes {",
  `  "{${G.agf}}ws/foo.agf"`,
  " }",
  "}",
].join("\n");

const ASI = [
  'AnimSetInstanceSource "{5555555555555555}" {',
  ` Template "{${G.ast}}ws/foo.ast"`,
  " ParentTemplates {",
  `  "{${G.asiB}}ws/foo_b.asi"`,
  " }",
  " Lines {",
  '  AnimSetInstanceSource_Line "A.B.C" {',
  `   Resource "{${G.anm}}anm/x.anm"`,
  "  }",
  " }",
  "}",
].join("\n");

const ASI_B = [
  'AnimSetInstanceSource "{5555555555555556}" {',
  ` Template "{${G.ast}}ws/foo.ast"`,
  "}",
].join("\n");

const FILES: Record<string, string> = {
  "ws/foo.aw": AW,
  "ws/foo.agr": AGR,
  "ws/foo.agf": "AnimSrcGraphFile {\n}",
  "ws/foo.ast": "AnimSetTemplateSource {\n Groups {\n }\n}",
  "ws/foo.asi": ASI,
  "ws/foo_b.asi": ASI_B,
  "ws/Sync.asy": "AnimSrcSyncTable {\n}",
  "Assets/m.xob": "xob",
  "Sounds/a.acp": "acp",
  "anm/x.anm": "anm",
};

const SET_GUIDS = [G.ast, G.asi, G.asiB, G.agr, G.asy, G.agf];

function fakeVfs(files: Record<string, string> = FILES): PakLike {
  return {
    exists: (p) => p in files,
    readFile: (p) => {
      if (!(p in files)) throw new Error(`no ${p}`);
      return Buffer.from(files[p], "utf-8");
    },
  };
}

interface Sent {
  fn: string;
  params: Record<string, unknown>;
}

/** A client that registers every file under a new GUID BBBBBBBB000000NN (or answers `answer`). */
function fakeClient(
  answer?: (p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
) {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>) => {
      sent.push({ fn, params });
      const n = sent.length;
      if (answer) {
        const a = answer(params, n);
        if (a instanceof Error) throw a;
        return a;
      }
      return {
        status: "ok",
        code: "",
        registered: 1,
        dryRun: 0,
        resourceName: `{BBBBBBBB${String(n).padStart(8, "0")}}${params.path}`,
      };
    },
  };
  return { client: client as never, sent };
}

let root: string;
let config: Config;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aw-test-"));
  config = makeConfig({ projectPath: root });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const run = (req: WorkspaceRequest, deps: Parameters<typeof runAnimationWorkspace>[2] = {}) =>
  runAnimationWorkspace(req, config, { vfs: fakeVfs(), ...deps });

const okOf = (r: WorkspaceResponse): WorkspaceOk => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};
const errOf = (r: WorkspaceResponse): WorkspaceError => {
  if (r.ok) throw new Error("expected an error, got ok");
  return r;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rb = (r: WorkspaceResponse): any => okOf(r).readback;

function put(rel: string, text: string): string {
  const f = join(root, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
  return f;
}
function putAll(files: Record<string, string> = FILES) {
  for (const [k, v] of Object.entries(files)) put(k, v);
}

// ── Description and registration ─────────────────────────────────────────────

describe("animation_workspace registration", () => {
  it("has a description within the 400-character budget", () => {
    expect(ANIMATION_WORKSPACE_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(ANIMATION_WORKSPACE_DESCRIPTION).not.toMatch(/sandbox/i);
  });

  it("registers the tool and answers through the handler", async () => {
    const handler = captureTool((s) => registerAnimationWorkspace(s, config));
    const bad = await handler({ action: "read", path: "ws/missing.aw" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(textOf(bad)).ok).toBe(false);
  });
});

// ── Parsing links ────────────────────────────────────────────────────────────

describe("scanRefs and renderWith", () => {
  it("finds every path link with its role and skips object ids", () => {
    const refs = scanRefs(parseCst(AW));
    expect(refs.map((r) => `${r.role}:${r.ext}`)).toEqual([
      "AnimSetTemplate:ast",
      "AnimSetInstances:asi",
      "AnimSetInstances:asi",
      "AnimGraph:agr",
      "Model:xob",
      "ProjectFile:acp",
      "SyncTable:asy",
    ]);
    expect(refs[0].guid).toBe(G.ast);
    expect(refs[0].path).toBe("ws/foo.ast");
  });

  it("changes only the chosen links and nothing else", () => {
    const doc = parseCst(AW);
    const refs = scanRefs(doc);
    expect(renderWith(doc, refs, () => undefined)).toBe(AW);
    const out = renderWith(doc, refs, (r) =>
      r.ext === "agr" ? "{FFFFFFFFFFFFFFFF}x/y.agr" : undefined,
    );
    expect(out).toBe(AW.replace(`{${G.agr}}ws/foo.agr`, "{FFFFFFFFFFFFFFFF}x/y.agr"));
  });
});

// ── read ─────────────────────────────────────────────────────────────────────

describe("read", () => {
  it("resolves the workspace's links from the game data", async () => {
    const r = await run({ action: "read", path: "ws/foo.aw" });
    const b = rb(r);
    expect(b.source).toBe("game");
    expect(b.animSetTemplate.ref).toBe(`{${G.ast}}ws/foo.ast`);
    expect(b.animSetTemplate.status).toBe("game");
    expect(b.animGraph.path).toBe("ws/foo.agr");
    expect(b.animSetInstances).toHaveLength(2);
    expect(b.syncTable.ext).toBe("asy");
    expect(b.models[0].path).toBe("Assets/m.xob");
    expect(b.audioProjects[0].path).toBe("Sounds/a.acp");
    expect(b.graph.template).toBe(`{${G.ast}}ws/foo.ast`);
    expect(b.graph.sheets).toEqual([`{${G.agf}}ws/foo.agf`]);
    expect(okOf(r).warnings.join("\n")).toContain("game resource");
  });

  it("reads a project file in preference and accepts the {GUID}path form", async () => {
    put("ws/foo.aw", AW.replace("Assets/m.xob", "Assets/other.xob"));
    putAll({ "ws/foo.agr": AGR });
    const r = await run({ action: "read", path: "{AAAAAAAA0000FFFF}ws/foo.aw" });
    const b = rb(r);
    expect(b.source).toBe("project");
    expect(b.guid).toBe("AAAAAAAA0000FFFF");
    expect(b.models[0].status).toBe("unresolved");
    expect(okOf(r).warnings.join("\n")).toContain("neither the project nor the game data");
  });

  it("flags a link whose project .meta carries another GUID", async () => {
    putAll();
    put("ws/foo.ast.meta", 'MetaFileClass {\n Name "{DDDDDDDD00000001}ws/foo.ast"\n}');
    const r = await run({ action: "read", path: "ws/foo.aw" });
    expect(rb(r).animSetTemplate.status).toBe("guid-mismatch");
    expect(okOf(r).warnings.join("\n")).toContain("does not carry");
  });

  it("refuses a missing file, a wrong extension, an absolute outside path and a non-workspace", async () => {
    expect(errOf(await run({ action: "read", path: "ws/none.aw" })).code).toBe("PATH_NOT_FOUND");
    expect(errOf(await run({ action: "read", path: "ws/foo.ast" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(await run({ action: "read", path: "../x.aw" })).code).toBe("ABSOLUTE_PATH");
    expect(errOf(await run({ action: "read", path: join(tmpdir(), "elsewhere.aw") })).code).toBe(
      "NOT_IN_PROJECT",
    );
    const vfs = fakeVfs({ "ws/odd.aw": "SomethingElse {\n}" });
    const r = await run({ action: "read", path: "ws/odd.aw" }, { vfs });
    expect(errOf(r).code).toBe("INVALID_ARGUMENT");
    expect(errOf(r).message).toContain("BaseSource");
  });

  it("says so when the paks are not available", async () => {
    const r = await run({ action: "read", path: "ws/foo.aw" }, { vfs: null });
    expect(errOf(r).code).toBe("PATH_NOT_FOUND");
    expect(errOf(r).message).toContain("ENFUSION_GAME_PATH");
  });
});

// ── files ────────────────────────────────────────────────────────────────────

describe("files", () => {
  it("lists the whole set once each, graph and parents included, with the outside links", async () => {
    const b = rb(await run({ action: "files", path: "ws/foo.aw" }));
    expect(b.total).toBe(10);
    const byPath = Object.fromEntries(b.files.map((f: { path: string }) => [f.path, f]));
    expect(Object.keys(byPath)).toContain("ws/foo.agf");
    expect(byPath["ws/foo_b.asi"].guid).toBe(G.asiB);
    expect(b.counts.asi).toEqual({ total: 2, unresolved: 0 });
    expect(b.counts.anm).toEqual({ total: 1, unresolved: 0 });
    expect(b.unresolved).toBe(0);
  });

  it("counts a link the data lacks and still finishes", async () => {
    const files = { ...FILES };
    delete files["ws/foo.ast"];
    const r = await run({ action: "files", path: "ws/foo.aw" }, { vfs: fakeVfs(files) });
    expect(rb(r).counts.ast).toEqual({ total: 1, unresolved: 1 });
    expect(okOf(r).warnings[0]).toContain(`{${G.ast}}ws/foo.ast`);
  });

  it("pages with a cursor and refuses a stale or malformed one", async () => {
    const p1 = rb(await run({ action: "files", path: "ws/foo.aw", limit: 4 }));
    expect(p1.files).toHaveLength(4);
    expect(p1.nextCursor).toBe("4:10");
    const p2 = rb(
      await run({ action: "files", path: "ws/foo.aw", limit: 4, cursor: p1.nextCursor }),
    );
    expect(p2.files).toHaveLength(4);
    const p3 = rb(
      await run({ action: "files", path: "ws/foo.aw", limit: 4, cursor: p2.nextCursor }),
    );
    expect(p3.files).toHaveLength(2);
    expect(p3.nextCursor).toBeUndefined();
    const paths = [...p1.files, ...p2.files, ...p3.files].map((f: { path: string }) => f.path);
    expect(new Set(paths).size).toBe(10);
    expect(errOf(await run({ action: "files", path: "ws/foo.aw", cursor: "2:99" })).code).toBe(
      "STALE_CURSOR",
    );
    expect(errOf(await run({ action: "files", path: "ws/foo.aw", cursor: "x" })).code).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

// ── validate ─────────────────────────────────────────────────────────────────

describe("validate", () => {
  it("is clean on a consistent workspace", async () => {
    const b = rb(await run({ action: "validate", path: "ws/foo.aw" }));
    expect(b.errors).toBe(0);
    expect(b.issues).toEqual([]);
    expect(b.files).toBe(10);
  });

  it("reports a missing set file as an error and a missing outside file as a warning", async () => {
    const files = { ...FILES };
    delete files["ws/foo.agf"];
    delete files["Assets/m.xob"];
    putAll(files);
    const b = rb(await run({ action: "validate", path: "ws/foo.aw" }, { vfs: fakeVfs(files) }));
    const kinds = b.issues.map(
      (i: { severity: string; kind: string }) => `${i.severity}:${i.kind}`,
    );
    expect(kinds).toContain("error:missing-file");
    expect(kinds).toContain("warning:missing-file");
    expect(b.errors).toBe(1);
  });

  it("demotes a gap in shipped content to a warning but keeps it an error in a project", async () => {
    const files = { ...FILES };
    delete files["ws/foo.agf"];
    const game = rb(await run({ action: "validate", path: "ws/foo.aw" }, { vfs: fakeVfs(files) }));
    expect(game.errors).toBe(0);
    expect(game.issues[0].severity).toBe("warning");
    putAll(files);
    const proj = rb(await run({ action: "validate", path: "ws/foo.aw" }, { vfs: fakeVfs(files) }));
    expect(proj.errors).toBe(1);
  });

  it("reports a GUID the project's .meta disagrees with as a dangling GUID", async () => {
    putAll();
    put("ws/foo.agr.meta", 'MetaFileClass {\n Name "{DDDDDDDD00000009}ws/foo.agr"\n}');
    const b = rb(await run({ action: "validate", path: "ws/foo.aw" }));
    expect(b.issues.some((i: { kind: string }) => i.kind === "dangling-guid")).toBe(true);
    expect(b.errors).toBeGreaterThan(0);
  });

  it("reports an instance whose template is not the workspace's ast", async () => {
    const files = {
      ...FILES,
      "ws/foo.asi": ASI.replace(`{${G.ast}}ws/foo.ast`, "{AAAAAAAA000000EE}ws/foo.ast"),
    };
    const b = rb(await run({ action: "validate", path: "ws/foo.aw" }, { vfs: fakeVfs(files) }));
    const m = b.issues.filter((i: { kind: string }) => i.kind === "template-mismatch");
    expect(m).toHaveLength(1);
    expect(m[0].file).toBe("ws/foo.asi");
  });

  it("reports a graph whose template differs, and parse diagnostics", async () => {
    const files = {
      ...FILES,
      "ws/foo.agr": AGR.replace(`{${G.ast}}ws/foo.ast`, "{AAAAAAAA000000EF}ws/foo.ast"),
      "ws/foo.agf": "AnimSrcGraphFile {\n",
    };
    const b = rb(await run({ action: "validate", path: "ws/foo.aw" }, { vfs: fakeVfs(files) }));
    const kinds = b.issues.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain("template-mismatch");
    expect(kinds).toContain("not-parsed");
  });

  it("pages the issues", async () => {
    const files = { ...FILES };
    for (const k of ["ws/foo.agf", "ws/Sync.asy", "ws/foo_b.asi", "ws/foo.ast"]) delete files[k];
    const p1 = rb(
      await run({ action: "validate", path: "ws/foo.aw", limit: 2 }, { vfs: fakeVfs(files) }),
    );
    expect(p1.issues).toHaveLength(2);
    expect(p1.nextCursor).toBeDefined();
  });
});

// ── duplicate ────────────────────────────────────────────────────────────────

describe("duplicate", () => {
  it("is a dry run by default: lists the map and the kept links, writes and sends nothing", async () => {
    const { client, sent } = fakeClient();
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw" },
      { client },
    );
    const b = rb(r);
    expect(okOf(r).dryRun).toBe(true);
    expect(b.complete).toBe(true);
    expect(b.files).toBe(7);
    const to = b.map.map((m: { to: string }) => m.to).sort();
    expect(to).toEqual(
      [
        "new/Sync.asy",
        "new/bar.agf",
        "new/bar.agr",
        "new/bar.asi",
        "new/bar.aw",
        "new/bar.ast",
        "new/foo_b.asi",
      ].sort(),
    );
    expect(b.keptCount).toBe(3);
    expect(b.kept.map((k: { ext: string }) => k.ext).sort()).toEqual(["acp", "anm", "xob"]);
    expect(existsSync(join(root, "new"))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("copies, registers each copy, rewrites every internal GUID and keeps the outside links", async () => {
    const { client, sent } = fakeClient();
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw", confirm: true },
      { client },
    );
    const b = rb(r);
    expect(okOf(r).dryRun).toBe(false);
    expect(b.registered).toBe(7);
    expect(sent).toHaveLength(7);
    for (const s of sent) {
      expect(s.fn).toBe("EMCP_WB_Resources");
      expect(s.params).toMatchObject({ action: "register", buildRuntime: false, confirm: true });
    }
    const newGuids = new Map<string, string>(
      b.written.map((w: { to: string; guid: string }) => [w.to, w.guid]),
    );
    let all = "";
    for (const w of b.written as { to: string }[])
      all += readFileSync(join(root, w.to), "utf-8") + "\n";
    for (const g of SET_GUIDS) expect(all).not.toContain(g);
    for (const g of [G.xob, G.acp, G.anm]) expect(all).toContain(g);
    const aw = readFileSync(join(root, "new/bar.aw"), "utf-8");
    expect(aw).toContain(`"{${newGuids.get("new/bar.ast")}}new/bar.ast"`);
    expect(aw).toContain(`"{${newGuids.get("new/foo_b.asi")}}new/foo_b.asi"`);
    expect(aw).toContain(`"{${newGuids.get("new/Sync.asy")}}new/Sync.asy"`);
    expect(aw).toContain(`"{${G.xob}}Assets/m.xob"`);
    // The copy of the workspace links only to the copies: it validates clean offline once they exist.
    const asi = readFileSync(join(root, "new/bar.asi"), "utf-8");
    expect(asi).toContain(`Template "{${newGuids.get("new/bar.ast")}}new/bar.ast"`);
    expect(asi).toContain(`"{${newGuids.get("new/foo_b.asi")}}new/foo_b.asi"`);
    // Object ids and every byte outside a link are untouched.
    expect(asi).toContain('AnimSetInstanceSource "{5555555555555555}"');
    expect(aw).toContain("5555555555555551");
    // The source stays as it was.
    expect(existsSync(join(root, "ws/foo.aw"))).toBe(false);
  });

  it("copies a project workspace and gives the files named like it the new name", async () => {
    putAll();
    const { client } = fakeClient();
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "ws2/baz.aw", confirm: true },
      { client },
    );
    expect(okOf(r).ok).toBe(true);
    expect(existsSync(join(root, "ws2/baz.agr"))).toBe(true);
    expect(existsSync(join(root, "ws2/baz.asi"))).toBe(true);
    expect(readFileSync(join(root, "ws/foo.aw"), "utf-8")).toBe(AW);
  });

  it("a link with backslash '..' parts never names a destination outside the folder (review W4-AW-1)", async () => {
    const hostile = "ws/d1/..\\..\\x.agr";
    const files = {
      ...FILES,
      "ws/foo.aw": AW.replace(`{${G.agr}}ws/foo.agr`, `{${G.agr}}${hostile}`),
      [hostile]: AGR,
    };
    const { client } = fakeClient();
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw" },
      { client, vfs: fakeVfs(files) },
    );
    const to: string[] = rb(r).map.map((m: { to: string }) => m.to);
    expect(to).toContain("new/x.agr");
    for (const t of to) {
      expect(t, t).not.toMatch(/\.\./);
      expect(t, t).not.toContain("\\");
      expect(t.startsWith("new/"), t).toBe(true);
    }
  });

  it("numbers a destination name that two sources would share", async () => {
    const files = {
      ...FILES,
      "ws/foo.aw": AW.replace("ws/foo_b.asi", "other/foo.asi"),
      "other/foo.asi": ASI_B,
    };
    const { client } = fakeClient();
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "n/bar.aw" },
      { client, vfs: fakeVfs(files) },
    );
    const to = rb(r).map.map((m: { to: string }) => m.to);
    expect(new Set(to.map((t: string) => t.toLowerCase())).size).toBe(to.length);
  });

  it("refuses to write when an internal link has no file to copy: the map is incomplete", async () => {
    const files = { ...FILES };
    delete files["ws/foo.agf"];
    const { client, sent } = fakeClient();
    const dry = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw" },
      { client, vfs: fakeVfs(files) },
    );
    expect(rb(dry).complete).toBe(false);
    expect(rb(dry).unresolved).toEqual([`{${G.agf}}ws/foo.agf`]);
    expect(okOf(dry).next).toContain("confirm would refuse");
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw", confirm: true },
      { client, vfs: fakeVfs(files) },
    );
    const e = errOf(r);
    expect(e.code).toBe(REWRITE_INCOMPLETE);
    expect(e.message).toContain("incomplete");
    expect(existsSync(join(root, "new"))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("removes its files again when the engine refuses a registration", async () => {
    const { client } = fakeClient((p, n) =>
      n === 3
        ? { status: "error", code: "NOT_IN_PROJECT", message: "outside the project" }
        : {
            status: "ok",
            registered: 1,
            dryRun: 0,
            resourceName: `{BBBBBBBB${String(n).padStart(8, "0")}}${p.path}`,
          },
    );
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw", confirm: true },
      { client },
    );
    const e = errOf(r);
    expect(e.code).toBe(REWRITE_INCOMPLETE);
    expect(e.message).toContain("NOT_IN_PROJECT");
    expect(existsSync(join(root, "new/bar.aw"))).toBe(false);
    expect(existsSync(join(root, "new/bar.agr"))).toBe(false);
  });

  it("refuses when the engine registers a different path or answers no name", async () => {
    const a = fakeClient(() => ({
      status: "ok",
      registered: 1,
      dryRun: 0,
      resourceName: "{BBBBBBBB00000001}elsewhere/x.aw",
    }));
    expect(
      errOf(
        await run(
          { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw", confirm: true },
          { client: a.client },
        ),
      ).code,
    ).toBe(REWRITE_INCOMPLETE);
    const b = fakeClient(() => ({ status: "ok", registered: 1, dryRun: 0 }));
    expect(
      errOf(
        await run(
          { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw", confirm: true },
          { client: b.client },
        ),
      ).code,
    ).toBe(REWRITE_INCOMPLETE);
    expect(existsSync(join(root, "new/bar.aw"))).toBe(false);
  });

  it.each([
    ["LOST", "LOST"],
    ["MODAL_OPEN", "MODAL_OPEN"],
    ["WEDGED", "WEDGED"],
  ])("maps a client %s and leaves the copies for a read-back", async (name, code) => {
    const e = new WorkbenchError("gone", name as never);
    const { client } = fakeClient(() => e);
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "new/bar.aw", confirm: true },
      { client },
    );
    expect(errOf(r).code).toBe(code);
    expect(errOf(r).message).toContain("left in place");
    expect(existsSync(join(root, "new/bar.aw"))).toBe(true);
  });

  it("refuses without a project, outside it, onto an existing file, without a target or a client", async () => {
    const { client } = fakeClient();
    const noRoot = await runAnimationWorkspace(
      { action: "duplicate", path: "ws/foo.aw", target: "n/b.aw" },
      makeConfig({ projectPath: "" }),
      { vfs: fakeVfs(), client },
    );
    expect(errOf(noRoot).code).toBe("NOT_IN_PROJECT");
    expect(
      errOf(await run({ action: "duplicate", path: "ws/foo.aw", target: "../b.aw" }, { client }))
        .code,
    ).toBe("ABSOLUTE_PATH");
    expect(errOf(await run({ action: "duplicate", path: "ws/foo.aw" }, { client })).code).toBe(
      "INVALID_ARGUMENT",
    );
    put("n/b.aw", "x");
    const clash = errOf(
      await run({ action: "duplicate", path: "ws/foo.aw", target: "n/b.aw" }, { client }),
    );
    expect(clash.code).toBe("INVALID_ARGUMENT");
    expect(clash.message).toContain("already exist");
    const noClient = await run({
      action: "duplicate",
      path: "ws/foo.aw",
      target: "m/b.aw",
      confirm: true,
    });
    expect(errOf(noClient).code).toBe("UNREACHABLE");
    expect(existsSync(join(root, "m"))).toBe(false);
  });

  it("refuses a set larger than the cap", async () => {
    const files: Record<string, string> = { ...FILES };
    const many = Array.from({ length: MAX_DUPLICATE_FILES + 5 }, (_, i) => {
      const g = (0x1000 + i).toString(16).toUpperCase().padStart(16, "0");
      files[`ws/m${i}.asi`] = ASI_B;
      return `  "{${g}}ws/m${i}.asi"`;
    }).join("\n");
    files["ws/foo.aw"] = AW.replace(`  "{${G.asi}}ws/foo.asi"`, many);
    const r = await run(
      { action: "duplicate", path: "ws/foo.aw", target: "n/b.aw" },
      { vfs: fakeVfs(files) },
    );
    expect(errOf(r).code).toBe("INVALID_ARGUMENT");
    expect(errOf(r).message).toContain("duplicate a smaller workspace");
  });
});

// ── set ──────────────────────────────────────────────────────────────────────

describe("set", () => {
  beforeEach(() => putAll());

  it("is a dry run by default and shows the diff", async () => {
    const r = await run(
      {
        action: "set",
        path: "ws/foo.aw",
        field: "AnimGraph",
        value: "{AAAAAAAA000000AA}ws/other.agr",
      },
      { vfs: fakeVfs({ ...FILES, "ws/other.agr": AGR }) },
    );
    expect(okOf(r).dryRun).toBe(true);
    expect(rb(r).diff).toContain('+ AnimGraph "{AAAAAAAA000000AA}ws/other.agr"');
    expect(readFileSync(join(root, "ws/foo.aw"), "utf-8")).toBe(AW);
  });

  it("writes only the targeted bytes, leaves a .bak, and reads back", async () => {
    const r = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimGraph",
      value: "{AAAAAAAA000000AA}ws/foo.agr",
      confirm: true,
    });
    expect(okOf(r).dryRun).toBe(false);
    expect(readFileSync(join(root, "ws/foo.aw"), "utf-8")).toBe(
      AW.replace(`{${G.agr}}ws/foo.agr`, "{AAAAAAAA000000AA}ws/foo.agr"),
    );
    expect(readFileSync(join(root, "ws/foo.aw.bak"), "utf-8")).toBe(AW);
    expect(rb(r).backup).toBe("ws/foo.aw.bak");
  });

  it("takes a project path through its .meta GUID", async () => {
    put("ws/foo.ast.meta", 'MetaFileClass {\n Name "{AAAAAAAA00000001}ws/foo.ast"\n}');
    const r = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimSetTemplate",
      value: "ws/foo.ast",
      confirm: true,
    });
    expect(okOf(r).changed?.[0].after).toBe(`{${G.ast}}ws/foo.ast`);
    const noMeta = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimGraph",
      value: "ws/foo.agr",
    });
    expect(errOf(noMeta).code).toBe("RESOURCE_NOT_FOUND");
    const gameOnly = await run(
      { action: "set", path: "ws/foo.aw", field: "Model", value: "Assets/g.xob" },
      { vfs: fakeVfs({ ...FILES, "Assets/g.xob": "xob" }) },
    );
    expect(errOf(gameOnly).message).toContain("give it as {GUID}path");
  });

  it("sets a preview model and an audio project by index and adds a missing table", async () => {
    let r = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "Model",
      value: `{${G.xob}}Assets/m.xob`,
      index: 0,
    });
    expect(okOf(r).changed?.[0].path).toBe("PreviewModels[0].Model");
    r = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "ProjectFile",
      value: `{${G.acp}}Sounds/a.acp`,
      index: 0,
      confirm: true,
    });
    expect(okOf(r).ok).toBe(true);
    r = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "Model",
      value: `{${G.xob}}Assets/m.xob`,
      index: 3,
    });
    expect(errOf(r).code).toBe("PATH_NOT_FOUND");
    const vfs = fakeVfs({ ...FILES, "ws/E.aex": "AnimSrcExpressionTable {\n}" });
    r = await run(
      {
        action: "set",
        path: "ws/foo.aw",
        field: "ExpressionTable",
        value: "{AAAAAAAA000000AB}ws/E.aex",
        confirm: true,
      },
      { vfs },
    );
    expect(readFileSync(join(root, "ws/foo.aw"), "utf-8")).toContain(
      'ExpressionTable "{AAAAAAAA000000AB}ws/E.aex"',
    );
    expect(parseCstBytes(readFileSync(join(root, "ws/foo.aw"))).diagnostics).toEqual([]);
  });

  it("adds the first preview model to a created workspace's empty list (W4 fix-up 1, w4-54)", async () => {
    put("ws/new.aw", workspaceSkeleton({}));
    const r = await run({
      action: "set",
      path: "ws/new.aw",
      field: "Model",
      value: `{${G.xob}}Assets/m.xob`,
      confirm: true,
    });
    expect(okOf(r).changed?.[0]).toMatchObject({ path: "PreviewModels[0].Model", before: null });
    const doc = parseCstBytes(readFileSync(join(root, "ws/new.aw")));
    expect(doc.diagnostics).toEqual([]);
    const got = doc.get("PreviewModels[0].Model");
    expect(got.kind === "scalar" ? got.values[0] : null).toBe(`{${G.xob}}Assets/m.xob`);
    expect(readFileSync(join(root, "ws/new.aw"), "utf-8")).toMatch(
      /AnimSrcWorkspacePreviewModel "\{[0-9A-F]{16}\}" \{/,
    );
    // An index past the next free one is still refused.
    const far = await run({
      action: "set",
      path: "ws/new.aw",
      field: "Model",
      value: `{${G.xob}}Assets/m.xob`,
      index: 5,
    });
    expect(errOf(far).code).toBe("PATH_NOT_FOUND");
  });

  it("replaces the whole instance list, and empties it", async () => {
    const vfs = fakeVfs({ ...FILES, "ws/z.asi": ASI_B });
    let r = await run(
      {
        action: "set",
        path: "ws/foo.aw",
        field: "AnimSetInstances",
        values: ["{AAAAAAAA000000C1}ws/z.asi"],
        confirm: true,
      },
      { vfs },
    );
    expect(okOf(r).changed?.[0].before).toHaveLength(2);
    const text = readFileSync(join(root, "ws/foo.aw"), "utf-8");
    expect(text).toContain(' AnimSetInstances {\n  "{AAAAAAAA000000C1}ws/z.asi"\n }');
    expect(text).not.toContain("foo_b.asi");
    r = await run(
      { action: "set", path: "ws/foo.aw", field: "AnimSetInstances", values: [], confirm: true },
      { vfs },
    );
    expect(okOf(r).ok).toBe(true);
    expect(readFileSync(join(root, "ws/foo.aw"), "utf-8")).toContain(" AnimSetInstances {\n }");
    const idx = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimSetInstances",
      values: [],
      index: 1,
    });
    expect(errOf(idx).code).toBe("INVALID_ARGUMENT");
  });

  it("refuses a wrong extension, a missing resource, missing arguments and game data", async () => {
    const wrongExt = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimGraph",
      value: `{${G.ast}}ws/foo.ast`,
    });
    expect(errOf(wrongExt).code).toBe("INVALID_ARGUMENT");
    const none = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimGraph",
      value: "{AAAAAAAA000000AA}ws/none.agr",
    });
    expect(errOf(none).code).toBe("RESOURCE_NOT_FOUND");
    expect(errOf(await run({ action: "set", path: "ws/foo.aw", value: "x" })).message).toContain(
      "field",
    );
    expect(errOf(await run({ action: "set", path: "ws/foo.aw", field: "AnimGraph" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    rmSync(join(root, "ws/foo.aw"));
    const game = await run({
      action: "set",
      path: "ws/foo.aw",
      field: "AnimGraph",
      value: `{${G.agr}}ws/foo.agr`,
    });
    expect(errOf(game).code).toBe("NOT_IN_PROJECT");
    expect(errOf(game).message).toContain("duplicate");
    const nowhere = await run({
      action: "set",
      path: "ws/none.aw",
      field: "AnimGraph",
      value: `{${G.agr}}ws/foo.agr`,
    });
    expect(errOf(nowhere).code).toBe("PATH_NOT_FOUND");
  });

  it("leaves a file it cannot keep byte for byte alone", async () => {
    put("ws/odd.aw", "SomethingElse {\n}");
    const r = await run({
      action: "set",
      path: "ws/odd.aw",
      field: "AnimGraph",
      value: `{${G.agr}}ws/foo.agr`,
    });
    expect(errOf(r).code).toBe("INVALID_ARGUMENT");
  });

  it("refuses without a project", async () => {
    const r = await runAnimationWorkspace(
      { action: "set", path: "ws/foo.aw", field: "AnimGraph", value: `{${G.agr}}ws/foo.agr` },
      makeConfig({ projectPath: "" }),
      { vfs: fakeVfs() },
    );
    expect(errOf(r).code).toBe("NOT_IN_PROJECT");
  });
});

// ── create ───────────────────────────────────────────────────────────────────

describe("create", () => {
  it("builds a skeleton the parser reads back, with every link given", () => {
    const text = workspaceSkeleton({
      template: `{${G.ast}}ws/foo.ast`,
      graph: `{${G.agr}}ws/foo.agr`,
      instances: [`{${G.asi}}ws/foo.asi`],
      model: `{${G.xob}}Assets/m.xob`,
    });
    const doc = parseCst(text);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.serialize()).toBe(text);
    expect(scanRefs(doc).map((r) => r.role)).toEqual([
      "AnimSetTemplate",
      "AnimSetInstances",
      "AnimGraph",
      "Model",
    ]);
    expect(text.endsWith("}")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("is a dry run by default", async () => {
    const r = await run({ action: "create", target: "n/new.aw" });
    expect(okOf(r).dryRun).toBe(true);
    expect(rb(r).files).toEqual(["n/new.aw", "n/new_EventTable.ae"]);
    expect(okOf(r).warnings.join(" ")).toContain("no animSetTemplate");
    expect(existsSync(join(root, "n"))).toBe(false);
  });

  it("writes the workspace and an empty event table and registers both", async () => {
    const { client, sent } = fakeClient();
    const r = await run(
      {
        action: "create",
        target: "n/new.aw",
        animSetTemplate: `{${G.ast}}ws/foo.ast`,
        animGraph: `{${G.agr}}ws/foo.agr`,
        animSetInstances: [`{${G.asi}}ws/foo.asi`],
        model: `{${G.xob}}Assets/m.xob`,
        confirm: true,
      },
      { client },
    );
    expect(okOf(r).dryRun).toBe(false);
    expect(rb(r).registered).toHaveLength(2);
    expect(sent.map((s) => s.params.path)).toEqual(["n/new.aw", "n/new_EventTable.ae"]);
    const aw = readFileSync(join(root, "n/new.aw"), "utf-8");
    expect(aw).toContain(`AnimSetTemplate "{${G.ast}}ws/foo.ast"`);
    expect(readFileSync(join(root, "n/new_EventTable.ae"), "utf-8")).toBe("$eventtable {\n \n}\n");
    const read = await run({ action: "read", path: "n/new.aw" });
    expect(rb(read).animGraph.guid).toBe(G.agr);
  });

  it("honours an event table path and skipEventTable", async () => {
    const { client } = fakeClient();
    let r = await run(
      { action: "create", target: "n/a.aw", eventTable: "n/ev/Ev.ae", confirm: true },
      { client },
    );
    expect(existsSync(join(root, "n/ev/Ev.ae"))).toBe(true);
    expect(okOf(r).ok).toBe(true);
    r = await run(
      { action: "create", target: "n/b.aw", skipEventTable: true, confirm: true },
      { client },
    );
    expect(existsSync(join(root, "n/b_EventTable.ae"))).toBe(false);
  });

  it("keeps the files and warns when registration fails or no client is available", async () => {
    const refused = fakeClient(() => ({
      status: "error",
      code: "NOT_IN_PROJECT",
      message: "outside",
    }));
    let r = await run(
      { action: "create", target: "n/a.aw", confirm: true },
      { client: refused.client },
    );
    expect(existsSync(join(root, "n/a.aw"))).toBe(true);
    expect(okOf(r).warnings.join(" ")).toContain("not registered");
    expect(okOf(r).next).toContain("Register");
    const lost = fakeClient(() => new WorkbenchError("lost", "LOST" as never));
    r = await run({ action: "create", target: "n/b.aw", confirm: true }, { client: lost.client });
    expect(okOf(r).warnings.join(" ")).toContain("LOST");
    r = await run({ action: "create", target: "n/c.aw", confirm: true });
    expect(okOf(r).warnings.join(" ")).toContain("no client");
  });

  it("refuses an existing file, a wrong extension, no target, no project and a bad link", async () => {
    put("n/x.aw", "x");
    expect(errOf(await run({ action: "create", target: "n/x.aw" })).message).toContain(
      "already exists",
    );
    expect(errOf(await run({ action: "create", target: "n/x.ast" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(await run({ action: "create" })).code).toBe("INVALID_ARGUMENT");
    expect(
      errOf(await run({ action: "create", target: "n/y.aw", animGraph: `{${G.ast}}ws/foo.ast` }))
        .code,
    ).toBe("INVALID_ARGUMENT");
    const r = await runAnimationWorkspace(
      { action: "create", target: "n/y.aw" },
      makeConfig({ projectPath: "" }),
      {
        vfs: fakeVfs(),
      },
    );
    expect(errOf(r).code).toBe("NOT_IN_PROJECT");
  });
});

describe("unknown action", () => {
  it("is refused with a code, not thrown", async () => {
    const r = await run({ action: "nope" as never, path: "ws/foo.aw" });
    expect(errOf(r).code).toBe("INVALID_ARGUMENT");
  });
});

// Census rows this file tests (W4 close-out, EV-W4-053).
// census:mcp:action/animation_workspace.create
// census:mcp:action/animation_workspace.files
// census:mcp:action/animation_workspace.read
// census:mcp:action/animation_workspace.set
// census:mcp:action/animation_workspace.validate
