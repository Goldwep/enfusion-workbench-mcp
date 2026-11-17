import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import { CstDocument, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import {
  DESCRIPTION,
  TOOL_NAME,
  addAnimation,
  addColumn,
  addGroup,
  asiSkeleton,
  astSkeleton,
  cleanPart,
  mapSlot,
  parseRef,
  registerAnimationSet,
  removeFromGroup,
  removeGroup,
  runAnimationSet,
  slotOf,
  slotsOf,
  unmapSlot,
  unwritableReason,
  validateAst,
  viewAsi,
  viewAst,
  type AnimationSetRequest,
  type GameFiles,
} from "../../src/tools/animation-set.js";

const AST = [
  "AnimSetTemplateSource {",
  " Groups {",
  '  AnimSetTemplateSource_AnimationGroup "{54967D07EAF68C5D}" {',
  '   Name "Gadget"',
  "   Animations {",
  '    "Idle"',
  '    "Focused"',
  "   }",
  "   Columns {",
  '    "CroLow"',
  '    "ErcRas"',
  "   }",
  "  }",
  '  AnimSetTemplateSource_AnimationGroup "{0123456789ABCDEF}" {',
  '   Name "Move"',
  "   Animations {",
  '    "Run"',
  "   }",
  "   Columns {",
  '    "ErcRas"',
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const ANM_A = "{AAAAAAAAAAAAAAAA}anims/a.anm";
const ANM_B = "{BBBBBBBBBBBBBBBB}anims/b.anm";
const TPL = "{CCCCCCCCCCCCCCCC}sets/gadget.ast";

const ASI = [
  'AnimSetInstanceSource "{5D8AE7A659E7718B}" {',
  ` Template "${TPL}"`,
  " Lines {",
  '  AnimSetInstanceSource_Line "Gadget.CroLow.Idle" {',
  `   Resource "${ANM_A}"`,
  "  }",
  '  AnimSetInstanceSource_Line "Move.ErcRas.Run" {',
  `   Resource "${ANM_B}"`,
  "  }",
  " }",
  ' RBF AnimSetInstanceSourceRBFArray "{59A8C1A9135415C0}" {',
  " }",
  "}",
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "animset-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function put(rel: string, text: string): string {
  const f = join(dir, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
  return f;
}
const read = (rel: string) => readFileSync(join(dir, rel), "utf-8");

/** Game data held in a map, matched by exact path as the pak reader does. */
function fakeGame(files: Record<string, string | Buffer>): GameFiles {
  const m = new Map(Object.entries(files));
  return {
    exists: (p) => m.has(p),
    readFile: (p) => {
      const v = m.get(p);
      if (v === undefined) throw new Error(`no ${p}`);
      return Buffer.isBuffer(v) ? v : Buffer.from(v);
    },
  };
}

const config = { projectPath: dir, gamePath: "", dataDir: "" } as Config;
const NO_GAME = null;
const GAME = fakeGame({
  "anims/a.anm": "x",
  "anims/b.anm": "x",
  "anims/c.anm": "x",
  "sets/gadget.ast": AST,
  "sets/gadget.asi": ASI,
  "game/only.ast": AST,
});

function run(req: AnimationSetRequest, game: GameFiles | null = GAME) {
  return runAnimationSet(req, config, { game });
}

function ok(r: ReturnType<typeof run>) {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}
function refused(r: ReturnType<typeof run>) {
  if (r.ok) throw new Error("expected a refusal");
  return r;
}
const rb = (r: ReturnType<typeof run>) => ok(r).readback as Record<string, any>;

beforeEach(() => {
  put("sets/gadget.ast", AST);
  put("sets/inst.asi", ASI);
  for (const f of ["sets/inst.asi.bak", "sets/gadget.ast.bak"])
    rmSync(join(dir, f), { force: true });
});

describe("views and helpers", () => {
  it("views a template", () => {
    const v = viewAst(new CstDocument(AST));
    expect(v.groups.map((g) => g.name)).toEqual(["Gadget", "Move"]);
    expect(v.groups[0]).toMatchObject({
      index: 0,
      guid: "54967D07EAF68C5D",
      columns: ["CroLow", "ErcRas"],
      animations: ["Idle", "Focused"],
    });
    expect([...slotsOf(v)].sort()).toEqual([
      "Gadget.CroLow.Focused",
      "Gadget.CroLow.Idle",
      "Gadget.ErcRas.Focused",
      "Gadget.ErcRas.Idle",
      "Move.ErcRas.Run",
    ]);
  });

  it("views an instance", () => {
    const v = viewAsi(new CstDocument(ASI));
    expect(v.objectGuid).toBe("5D8AE7A659E7718B");
    expect(v.template).toMatchObject({ guid: "CCCCCCCCCCCCCCCC", path: "sets/gadget.ast" });
    expect(v.lines.map((l) => l.slot)).toEqual(["Gadget.CroLow.Idle", "Move.ErcRas.Run"]);
    expect(v.rbf).toEqual({
      className: "AnimSetInstanceSourceRBFArray",
      guid: "59A8C1A9135415C0",
      entries: 0,
    });
  });

  it("refuses a view of the wrong root", () => {
    expect(() => viewAst(new CstDocument(ASI))).toThrow(/not an animation set template/);
    expect(() => viewAsi(new CstDocument(AST))).toThrow(/not an animation set instance/);
  });

  it("parses a reference with and without a GUID", () => {
    expect(parseRef("{aaaaaaaaaaaaaaaa}x/y.anm")).toEqual({
      raw: "{aaaaaaaaaaaaaaaa}x/y.anm",
      guid: "AAAAAAAAAAAAAAAA",
      path: "x/y.anm",
    });
    expect(parseRef("x/y.anm").guid).toBeUndefined();
  });

  it("checks names and slots", () => {
    expect(cleanPart("Idle", "x")).toBe("Idle");
    expect(() => cleanPart("a.b", "x")).toThrow(/no dot/);
    expect(() => cleanPart(" a", "x")).toThrow(/edge blank/);
    expect(() => cleanPart("", "x")).toThrow(/required/);
    expect(() => cleanPart("a".repeat(65), "x")).toThrow(/1 to 64/);
    expect(slotOf({ slot: "A.B.C" })).toMatchObject({ group: "A", column: "B", animation: "C" });
    expect(slotOf({ group: "A", column: "B", animation: "C" }).slot).toBe("A.B.C");
    expect(() => slotOf({ slot: "A.B" })).toThrow(/three names/);
    expect(() => slotOf({ group: "A" })).toThrow(/column is required/);
  });

  it("keeps and refuses the right bytes", () => {
    expect(unwritableReason(Buffer.from(AST), "ast")).toBeUndefined();
    expect(unwritableReason(Buffer.from(ASI), "asi")).toBeUndefined();
    expect(unwritableReason(Buffer.from(AST), "asi")).toMatch(/not AnimSetInstanceSource/);
    expect(unwritableReason(Buffer.from("Other {\n}"))).toMatch(/not one AnimSetTemplateSource/);
    expect(
      unwritableReason(Buffer.from("AnimSetTemplateSource {\n Groups {\n"), "ast"),
    ).toBeDefined();
  });
});

describe("read", () => {
  it("reads a template", () => {
    const b = rb(run({ action: "read", path: "sets/gadget.ast" }));
    expect(b).toMatchObject({
      kind: "ast",
      source: "project",
      groupCount: 2,
      columnCount: 3,
      animationCount: 3,
      slotCount: 5,
    });
    expect(b.groups[0]).toMatchObject({ name: "Gadget", slots: 4 });
  });

  it("pages the groups", () => {
    const first = rb(run({ action: "read", path: "sets/gadget.ast", limit: 1 }));
    expect(first.groups).toHaveLength(1);
    expect(first.nextCursor).toBe("1:2");
    const second = rb(run({ action: "read", path: "sets/gadget.ast", limit: 1, cursor: "1:2" }));
    expect(second.groups[0].name).toBe("Move");
    expect(second.nextCursor).toBeUndefined();
  });

  it("reads an instance, filters and pages its mappings", () => {
    const b = rb(run({ action: "read", path: "sets/inst.asi" }));
    expect(b).toMatchObject({ kind: "asi", mappingCount: 2, matching: 2 });
    expect(b.template).toMatchObject({ guid: "CCCCCCCCCCCCCCCC", path: "sets/gadget.ast" });
    expect(b.mappings[0]).toMatchObject({ slot: "Gadget.CroLow.Idle", path: "anims/a.anm" });
    const f = rb(run({ action: "read", path: "sets/inst.asi", filter: "move" }));
    expect(f.matching).toBe(1);
    expect(f.mappings[0].slot).toBe("Move.ErcRas.Run");
    const p = rb(run({ action: "read", path: "sets/inst.asi", limit: 1 }));
    expect(p.nextCursor).toBe("1:2");
  });

  it("shows parent templates and the IK pose", () => {
    put(
      "sets/p.asi",
      [
        "AnimSetInstanceSource {",
        ` Template "${TPL}"`,
        " ParentTemplates {",
        '  "{DDDDDDDDDDDDDDDD}sets/inst.asi"',
        " }",
        ` IkPose "${ANM_A}"`,
        "}",
      ].join("\n"),
    );
    const b = rb(run({ action: "read", path: "sets/p.asi" }));
    expect(b.parentTemplates).toEqual([
      {
        resource: "{DDDDDDDDDDDDDDDD}sets/inst.asi",
        guid: "DDDDDDDDDDDDDDDD",
        path: "sets/inst.asi",
      },
    ]);
    expect(b.ikPose.path).toBe("anims/a.anm");
    expect(b.mappingCount).toBe(0);
  });

  it("refuses a stale cursor, a bad cursor and a missing file", () => {
    expect(refused(run({ action: "read", path: "sets/gadget.ast", cursor: "0:9" })).code).toBe(
      "STALE_CURSOR",
    );
    expect(refused(run({ action: "read", path: "sets/gadget.ast", cursor: "nope" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(refused(run({ action: "read", path: "sets/none.ast" })).code).toBe("PATH_NOT_FOUND");
    expect(refused(run({ action: "read", path: "sets/x.txt" })).code).toBe("INVALID_ARGUMENT");
  });

  it("reads a game resource and says it is read only", () => {
    const r = ok(run({ action: "read", path: "game/only.ast" }));
    expect((r.readback as any).source).toBe("game");
    expect(r.warnings.join(" ")).toMatch(/read only/);
  });

  it("reports a file of the wrong kind and an absolute path outside the project", () => {
    put("sets/wrong.asi", AST);
    expect(refused(run({ action: "read", path: "sets/wrong.asi" })).message).toMatch(/not an asi/);
    expect(refused(run({ action: "read", path: "C:/elsewhere/x.ast" })).code).toBe(
      "NOT_IN_PROJECT",
    );
    expect(refused(run({ action: "read", path: "../x.ast" })).code).toBe("ABSOLUTE_PATH");
  });

  it("warns when the writer would refuse the file", () => {
    put("sets/odd.ast", "AnimSetTemplateSource {\n Groups {\n }\n");
    const r = ok(run({ action: "read", path: "sets/odd.ast" }));
    expect(r.warnings.join(" ")).toMatch(/refuse to edit/);
  });
});

describe("validate", () => {
  it("passes a consistent set", () => {
    const b = rb(run({ action: "validate", path: "sets/inst.asi" }));
    expect(b).toMatchObject({ valid: true, errors: 0, slotsChecked: true });
    expect(b.unverifiedGuids).toBeGreaterThan(0);
  });

  it("finds a mapping to a slot the template lacks", () => {
    put(
      "sets/bad.asi",
      ASI.replace('"Move.ErcRas.Run"', '"Move.CroLow.Run"').replace(
        'Template "{CCCCCCCCCCCCCCCC}sets/gadget.ast"',
        'Template "{CCCCCCCCCCCCCCCC}sets/gadget.ast"',
      ),
    );
    const b = rb(run({ action: "validate", path: "sets/bad.asi" }));
    expect(b.valid).toBe(false);
    expect(b.issues).toEqual([
      expect.objectContaining({ level: "error", at: "slot:Move.CroLow.Run" }),
    ]);
  });

  it("finds an .anm that does not resolve and a missing template", () => {
    put("sets/gone.asi", ASI.replace(ANM_B, "{EEEEEEEEEEEEEEEE}anims/gone.anm"));
    const a = rb(run({ action: "validate", path: "sets/gone.asi" }));
    expect(a.issues.map((i: any) => i.message).join(" ")).toMatch(
      /anims\/gone\.anm.*does not resolve/,
    );
    put("sets/notpl.asi", ASI.replace("sets/gadget.ast", "sets/lost.ast"));
    const b = rb(run({ action: "validate", path: "sets/notpl.asi" }));
    expect(b.valid).toBe(false);
    expect(b.slotsChecked).toBe(false);
    put("sets/empty.asi", "AnimSetInstanceSource {\n}");
    expect(rb(run({ action: "validate", path: "sets/empty.asi" })).issues[0].message).toMatch(
      /no Template/,
    );
  });

  it("flags a GUID that differs from the project .meta, and a wrong extension", () => {
    put("anims/m.anm", "x");
    put("anims/m.anm.meta", 'MetaFileClass {\n Name "{1111111111111111}anims/m.anm"\n}');
    put(
      "sets/meta.asi",
      ASI.replace(ANM_B, "{2222222222222222}anims/m.anm").replace("anims/a.anm", "anims/a.txt"),
    );
    const b = rb(run({ action: "validate", path: "sets/meta.asi" }));
    const text = b.issues.map((i: any) => i.message).join(" | ");
    expect(text).toMatch(/differs from the GUID \{1111111111111111\}/);
    expect(text).toMatch(/should be a \.anm file/);
  });

  it("warns, not errors, for a duplicate slot and a path without a GUID", () => {
    put(
      "sets/dup.asi",
      ASI.replace(
        " }\n RBF",
        '  AnimSetInstanceSource_Line "Move.ErcRas.Run" {\n   Resource "anims/b.anm"\n  }\n }\n RBF',
      ),
    );
    const b = rb(run({ action: "validate", path: "sets/dup.asi" }));
    expect(b.valid).toBe(true);
    expect(b.issues.map((i: any) => i.message).join(" ")).toMatch(/more than once/);
    expect(b.issues.map((i: any) => i.message).join(" ")).toMatch(/no GUID/);
  });

  it("does not check slots it cannot resolve, and warns when no game data exists", () => {
    put("sets/gameonly.asi", ASI.replace("sets/gadget.ast", "game/only.ast"));
    const b = rb(run({ action: "validate", path: "sets/gameonly.asi" }, NO_GAME));
    expect(b.slotsChecked).toBe(false);
    expect(b.issues.every((i: any) => i.level === "warning")).toBe(true);
  });

  it("validates a template and pages the issues", () => {
    put(
      "sets/w.ast",
      [
        "AnimSetTemplateSource {",
        " Groups {",
        '  AnimSetTemplateSource_AnimationGroup "{54967D07EAF68C5D}" {',
        '   Name "A"',
        "   Animations {",
        '    "x"',
        '    "x"',
        "   }",
        "   Columns {",
        "   }",
        "  }",
        '  AnimSetTemplateSource_AnimationGroup "{54967D07EAF68C5E}" {',
        '   Name "A"',
        "   Animations {",
        "   }",
        "   Columns {",
        '    "c"',
        "   }",
        "  }",
        " }",
        "}",
      ].join("\n"),
    );
    const b = rb(run({ action: "validate", path: "sets/w.ast", limit: 2 }));
    expect(b).toMatchObject({ valid: true, errors: 0, warnings: 4 });
    expect(b.issues).toHaveLength(2);
    expect(b.nextCursor).toBe("2:4");
    const n = rb(run({ action: "validate", path: "sets/w.ast", limit: 2, cursor: "2:4" }));
    expect(n.issues).toHaveLength(2);
    expect(n.nextCursor).toBeUndefined();
    expect(validateAst(viewAst(new CstDocument(AST)))).toEqual([]);
  });

  it("errors on a dotted name", () => {
    const v = viewAst(new CstDocument(AST.replace('"Idle"', '"I.dle"')));
    expect(validateAst(v)).toEqual([expect.objectContaining({ level: "error" })]);
  });
});

describe("template edits", () => {
  it("is a dry run without confirm", () => {
    const r = ok(
      run({ action: "addGroup", path: "sets/gadget.ast", group: "New", columns: ["C"] }),
    );
    expect((r as any).dryRun).toBe(true);
    expect(r.next).toMatch(/confirm: true/);
    expect((r.readback as any).diff).toContain('+   Name "New"');
    expect(read("sets/gadget.ast")).toBe(AST);
  });

  it("adds a group, a column and an animation when confirmed, with a backup", () => {
    const g = ok(
      run({
        action: "addGroup",
        path: "sets/gadget.ast",
        group: "New",
        columns: ["C1", "C2"],
        animations: ["A1"],
        confirm: true,
      }),
    );
    expect((g as any).dryRun).toBe(false);
    expect((g.readback as any).backup).toBe("sets/gadget.ast.bak");
    expect(read("sets/gadget.ast.bak")).toBe(AST);
    expect(g.readback as any).toMatchObject({ groups: 3, slots: 7 });
    ok(
      run({
        action: "addColumn",
        path: "sets/gadget.ast",
        group: "New",
        column: "C3",
        confirm: true,
      }),
    );
    const third = ok(
      run({
        action: "addAnimation",
        path: "sets/gadget.ast",
        group: "Move",
        animation: "Walk",
        confirm: true,
      }),
    );
    // Later edits number their backups; the first .bak keeps the original bytes (review W4-AS-1).
    expect((third.readback as any).backup).toBe("sets/gadget.ast.bak3");
    expect(read("sets/gadget.ast.bak")).toBe(AST);
    const v = viewAst(new CstDocument(read("sets/gadget.ast")));
    expect(v.groups.find((x) => x.name === "New")).toMatchObject({
      columns: ["C1", "C2", "C3"],
      animations: ["A1"],
    });
    expect(v.groups.find((x) => x.name === "New")!.guid).toMatch(/^[0-9A-F]{16}$/);
    expect(v.groups.find((x) => x.name === "Move")!.animations).toEqual(["Run", "Walk"]);
    expect(unwritableReason(Buffer.from(read("sets/gadget.ast")), "ast")).toBeUndefined();
  });

  it("refuses a duplicate, a missing group and a bad name", () => {
    expect(refused(run({ action: "addGroup", path: "sets/gadget.ast", group: "Move" })).code).toBe(
      "DUPLICATE_ID",
    );
    expect(
      refused(
        run({ action: "addColumn", path: "sets/gadget.ast", group: "Move", column: "ErcRas" }),
      ).code,
    ).toBe("DUPLICATE_ID");
    expect(
      refused(
        run({ action: "addAnimation", path: "sets/gadget.ast", group: "Move", animation: "Run" }),
      ).code,
    ).toBe("DUPLICATE_ID");
    const m = refused(
      run({ action: "addColumn", path: "sets/gadget.ast", group: "Nope", column: "C" }),
    );
    expect(m.code).toBe("PATH_NOT_FOUND");
    expect(m.message).toMatch(/Gadget, Move/);
    expect(refused(run({ action: "addGroup", path: "sets/gadget.ast", group: "a.b" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(refused(run({ action: "addGroup", path: "sets/gadget.ast" })).message).toMatch(
      /group is required/,
    );
  });

  it("creates the Groups block of a template that has none", () => {
    put("sets/nog.ast", "AnimSetTemplateSource {\n}");
    ok(run({ action: "addGroup", path: "sets/nog.ast", group: "G", confirm: true }));
    expect(viewAst(new CstDocument(read("sets/nog.ast"))).groups.map((g) => g.name)).toEqual(["G"]);
  });

  it("warns when a new column makes no slot", () => {
    put("sets/nog.ast", "AnimSetTemplateSource {\n}");
    ok(run({ action: "addGroup", path: "sets/nog.ast", group: "G", confirm: true }));
    const r = ok(run({ action: "addColumn", path: "sets/nog.ast", group: "G", column: "C" }));
    expect(r.warnings.join(" ")).toMatch(/no animations yet/);
  });

  it("refuses an .asi action on a template and the reverse", () => {
    expect(refused(run({ action: "map", path: "sets/gadget.ast", slot: "A.B.C" })).message).toMatch(
      /edits an \.asi/,
    );
    expect(refused(run({ action: "addGroup", path: "sets/inst.asi", group: "G" })).message).toMatch(
      /edits an \.ast/,
    );
  });

  it("refuses game data, a missing file, a file it cannot keep and a write without a project", () => {
    expect(refused(run({ action: "addGroup", path: "game/only.ast", group: "G" })).code).toBe(
      "NOT_IN_PROJECT",
    );
    expect(refused(run({ action: "addGroup", path: "sets/none.ast", group: "G" })).code).toBe(
      "PATH_NOT_FOUND",
    );
    put("sets/odd.ast", "AnimSetTemplateSource {\n Groups {\n }\n");
    expect(refused(run({ action: "addGroup", path: "sets/odd.ast", group: "G" })).message).toMatch(
      /left alone/,
    );
    const r = runAnimationSet(
      { action: "addGroup", path: "sets/gadget.ast", group: "G" },
      { projectPath: "", gamePath: "", dataDir: "" } as Config,
      { game: GAME },
    );
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe("NOT_IN_PROJECT");
  });

  it("refuses to write over a file that changed since it was read", () => {
    // a dry run then a change on disk cannot race inside one call: the guard is the equality check
    const before = read("sets/gadget.ast");
    ok(run({ action: "addGroup", path: "sets/gadget.ast", group: "G", confirm: true }));
    expect(read("sets/gadget.ast.bak")).toBe(before);
  });

  it("inverse edits restore the bytes", () => {
    const w = { doc: new CstDocument(AST) };
    addGroup(w, { group: "Z", columns: ["c"], animations: ["a"] });
    expect(w.doc.serialize()).not.toBe(AST);
    removeGroup(w, "Z");
    expect(w.doc.serialize()).toBe(AST);
    addColumn(w, { group: "Move", column: "X" });
    removeFromGroup(w, "Move", "Columns", "X");
    addAnimation(w, { group: "Gadget", animation: "Y" });
    removeFromGroup(w, "Gadget", "Animations", "Y");
    expect(w.doc.serialize()).toBe(AST);
    expect(() => removeFromGroup(w, "Move", "Columns", "Nope")).toThrow(/has no Nope/);
    const e = { doc: new CstDocument("AnimSetTemplateSource {\n}") };
    addGroup(e, { group: "Only" });
    removeGroup(e, "Only");
    expect(e.doc.serialize()).toBe("AnimSetTemplateSource {\n}");
  });
});

describe("map and unmap", () => {
  it("maps a new slot with a GUID in the resource, dry run first", () => {
    const d = ok(
      run({
        action: "map",
        path: "sets/inst.asi",
        slot: "Gadget.ErcRas.Focused",
        resource: "{CCCCCCCCCCCCCC01}anims/c.anm",
      }),
    );
    expect((d as any).dryRun).toBe(true);
    expect(read("sets/inst.asi")).toBe(ASI);
    const r = ok(
      run({
        action: "map",
        path: "sets/inst.asi",
        group: "Gadget",
        column: "ErcRas",
        animation: "Focused",
        resource: "{CCCCCCCCCCCCCC01}anims/c.anm",
        confirm: true,
      }),
    );
    expect((r.readback as any).mappings).toBe(3);
    const v = viewAsi(new CstDocument(read("sets/inst.asi")));
    expect(v.lines[2]).toMatchObject({ slot: "Gadget.ErcRas.Focused" });
    expect(v.lines[2].resource).toMatchObject({ guid: "CCCCCCCCCCCCCC01", path: "anims/c.anm" });
    expect(read("sets/inst.asi.bak")).toBe(ASI);
  });

  it("changes the resource of a slot that is mapped, and says when nothing changes", () => {
    ok(
      run({
        action: "map",
        path: "sets/inst.asi",
        slot: "Move.ErcRas.Run",
        resource: "{CCCCCCCCCCCCCC01}anims/c.anm",
        confirm: true,
      }),
    );
    const v = viewAsi(new CstDocument(read("sets/inst.asi")));
    expect(v.lines).toHaveLength(2);
    expect(v.lines[1].resource!.path).toBe("anims/c.anm");
    rmSync(join(dir, "sets/inst.asi.bak"), { force: true });
    const same = ok(
      run({
        action: "map",
        path: "sets/inst.asi",
        slot: "Gadget.CroLow.Idle",
        resource: ANM_A,
        confirm: true,
      }),
    );
    expect(same.changed).toEqual([]);
    expect(same.warnings.join(" ")).toMatch(/nothing to change/);
    expect(existsSync(join(dir, "sets/inst.asi.bak"))).toBe(false);
  });

  it("refuses a slot the template lacks, naming what it holds", () => {
    const g = refused(
      run({ action: "map", path: "sets/inst.asi", slot: "Nope.ErcRas.Run", resource: ANM_A }),
    );
    expect(g.code).toBe("INVALID_ARGUMENT");
    expect(g.message).toMatch(/no group "Nope" \(groups: Gadget, Move\)/);
    expect(
      refused(
        run({ action: "map", path: "sets/inst.asi", slot: "Move.CroLow.Run", resource: ANM_A }),
      ).message,
    ).toMatch(/no column "CroLow" \(columns: ErcRas\)/);
    expect(
      refused(
        run({ action: "map", path: "sets/inst.asi", slot: "Move.ErcRas.Walk", resource: ANM_A }),
      ).message,
    ).toMatch(/no animation "Walk"/);
  });

  it("takes the GUID from resourceGuid or the project .meta, and refuses one it cannot find", () => {
    const a = ok(
      run({
        action: "map",
        path: "sets/inst.asi",
        slot: "Gadget.ErcRas.Idle",
        resource: "anims/c.anm",
        resourceGuid: "{9999999999999999}",
      }),
    );
    expect((a.changed as any)[0].after).toBe("{9999999999999999}anims/c.anm");
    put("anims/m.anm", "x");
    put("anims/m.anm.meta", 'MetaFileClass {\n Name "{1111111111111111}anims/m.anm"\n}');
    const m = ok(
      run({
        action: "map",
        path: "sets/inst.asi",
        slot: "Gadget.ErcRas.Idle",
        resource: "anims/m.anm",
      }),
    );
    expect((m.changed as any)[0].after).toBe("{1111111111111111}anims/m.anm");
    expect(
      refused(
        run({
          action: "map",
          path: "sets/inst.asi",
          slot: "Gadget.ErcRas.Idle",
          resource: "anims/m.anm",
          resourceGuid: "2222222222222222",
        }),
      ).message,
    ).toMatch(/differs from the GUID/);
    const n = refused(
      run({
        action: "map",
        path: "sets/inst.asi",
        slot: "Gadget.ErcRas.Idle",
        resource: "anims/c.anm",
      }),
    );
    expect(n.message).toMatch(/has no GUID/);
    expect(
      refused(
        run({
          action: "map",
          path: "sets/inst.asi",
          slot: "Gadget.ErcRas.Idle",
          resource: "anims/c.anm",
          resourceGuid: "xyz",
        }),
      ).message,
    ).toMatch(/16 hex/);
  });

  it("refuses an .anm that exists nowhere, a wrong extension and a missing resource", () => {
    expect(
      refused(
        run({
          action: "map",
          path: "sets/inst.asi",
          slot: "Gadget.ErcRas.Idle",
          resource: "{1111111111111111}anims/none.anm",
        }),
      ).code,
    ).toBe("RESOURCE_NOT_FOUND");
    expect(
      refused(
        run({
          action: "map",
          path: "sets/inst.asi",
          slot: "Gadget.ErcRas.Idle",
          resource: "{1111111111111111}anims/c.txt",
        }),
      ).message,
    ).toMatch(/must be a \.anm/);
    expect(
      refused(run({ action: "map", path: "sets/inst.asi", slot: "Gadget.ErcRas.Idle" })).message,
    ).toMatch(/resource is required/);
  });

  it("maps without game data, with a warning", () => {
    const r = ok(
      run(
        {
          action: "map",
          path: "sets/inst.asi",
          slot: "Gadget.ErcRas.Idle",
          resource: "{1111111111111111}anims/c.anm",
        },
        NO_GAME,
      ),
    );
    expect(r.warnings.join(" ")).toMatch(/not checked/);
  });

  it("creates the Lines block before RBF when the file has none, and unmap removes it again", () => {
    const bare = [
      "AnimSetInstanceSource {",
      ` Template "${TPL}"`,
      ' RBF AnimSetInstanceSourceRBFArray "{59A8C1A9135415C0}" {',
      " }",
      "}",
    ].join("\n");
    put("sets/bare.asi", bare);
    ok(
      run({
        action: "map",
        path: "sets/bare.asi",
        slot: "Move.ErcRas.Run",
        resource: ANM_B,
        confirm: true,
      }),
    );
    const text = read("sets/bare.asi");
    expect(text.indexOf("Lines")).toBeLessThan(text.indexOf("RBF"));
    expect(text.indexOf("Lines")).toBeGreaterThan(text.indexOf("Template"));
    ok(run({ action: "unmap", path: "sets/bare.asi", slot: "Move.ErcRas.Run", confirm: true }));
    expect(read("sets/bare.asi")).toBe(bare);
  });

  it("unmaps a slot, and refuses one that is not mapped", () => {
    const d = ok(run({ action: "unmap", path: "sets/inst.asi", slot: "Move.ErcRas.Run" }));
    expect((d as any).dryRun).toBe(true);
    ok(
      run({
        action: "unmap",
        path: "sets/inst.asi",
        group: "Move",
        column: "ErcRas",
        animation: "Run",
        confirm: true,
      }),
    );
    expect(viewAsi(new CstDocument(read("sets/inst.asi"))).lines.map((l) => l.slot)).toEqual([
      "Gadget.CroLow.Idle",
    ]);
    const r = refused(run({ action: "unmap", path: "sets/inst.asi", slot: "Move.ErcRas.Run" }));
    expect(r.code).toBe("ITEM_NOT_FOUND");
  });

  it("map then unmap puts the bytes back", () => {
    const w = { doc: new CstDocument(ASI) };
    mapSlot(w, "Gadget.ErcRas.Focused", "{CCCCCCCCCCCCCC01}anims/c.anm");
    expect(w.doc.serialize()).not.toBe(ASI);
    unmapSlot(w, "Gadget.ErcRas.Focused");
    expect(w.doc.serialize()).toBe(ASI);
    const old = viewAsi(w.doc).lines[0].resource!.raw;
    mapSlot(w, "Gadget.CroLow.Idle", "{CCCCCCCCCCCCCC01}anims/c.anm");
    mapSlot(w, "Gadget.CroLow.Idle", old);
    expect(w.doc.serialize()).toBe(ASI);
  });

  it("removes the first of a slot mapped twice and warns", () => {
    const w = {
      doc: new CstDocument(
        ASI.replace(
          " }\n RBF",
          '  AnimSetInstanceSource_Line "Move.ErcRas.Run" {\n   Resource "x"\n  }\n }\n RBF',
        ),
      ),
    };
    const r = unmapSlot(w, "Move.ErcRas.Run");
    expect(r.warnings[0]).toMatch(/mapped 2 times/);
  });
});

describe("create", () => {
  it("creates a template with a group, dry run first", () => {
    const d = ok(
      run({ action: "create", path: "new/set.ast", group: "G", columns: ["C"], animations: ["A"] }),
    );
    expect((d as any).dryRun).toBe(true);
    expect(existsSync(join(dir, "new/set.ast"))).toBe(false);
    const r = ok(
      run({
        action: "create",
        path: "new/set.ast",
        group: "G",
        columns: ["C"],
        animations: ["A"],
        confirm: true,
      }),
    );
    expect(r.next).toMatch(/wb_resources register/);
    const text = read("new/set.ast");
    expect(text.startsWith("AnimSetTemplateSource {")).toBe(true);
    expect(viewAst(new CstDocument(text)).groups[0]).toMatchObject({
      name: "G",
      columns: ["C"],
      animations: ["A"],
    });
    expect(unwritableReason(Buffer.from(text), "ast")).toBeUndefined();
  });

  it("creates an empty template and refuses columns without a group", () => {
    ok(run({ action: "create", path: "new/empty.ast", confirm: true }));
    expect(read("new/empty.ast")).toBe(astSkeleton());
    expect(refused(run({ action: "create", path: "new/x.ast", columns: ["C"] })).message).toMatch(
      /need a group/,
    );
  });

  it("creates an instance with template, parents and IK pose", () => {
    const r = ok(
      run({
        action: "create",
        path: "new/inst.asi",
        template: "sets/gadget.ast",
        resourceGuid: "CCCCCCCCCCCCCCCC",
        parentTemplates: ["{DDDDDDDDDDDDDDDD}sets/gadget.asi"],
        ikPose: "{AAAAAAAAAAAAAAAA}anims/a.anm",
        confirm: true,
      }),
    );
    expect((r.readback as any).template).toBe("{CCCCCCCCCCCCCCCC}sets/gadget.ast");
    const v = viewAsi(new CstDocument(read("new/inst.asi")));
    expect(v.template!.path).toBe("sets/gadget.ast");
    expect(v.parentTemplates.map((p) => p.path)).toEqual(["sets/gadget.asi"]);
    expect(v.ikPose!.path).toBe("anims/a.anm");
    expect(v.rbf).toMatchObject({ className: "AnimSetInstanceSourceRBFArray", entries: 0 });
    expect(v.objectGuid).toMatch(/^[0-9A-F]{16}$/);
    const order = read("new/inst.asi")
      .match(/^ (\w+)/gm)!
      .map((s) => s.trim());
    expect(order).toEqual(["Template", "ParentTemplates", "IkPose", "RBF"]);
    expect(unwritableReason(Buffer.from(read("new/inst.asi")), "asi")).toBeUndefined();
    ok(
      run({
        action: "map",
        path: "new/inst.asi",
        slot: "Gadget.CroLow.Idle",
        resource: ANM_A,
        confirm: true,
      }),
    );
    expect(rb(run({ action: "validate", path: "new/inst.asi" })).valid).toBe(true);
  });

  it("refuses an existing target, a missing template, a template of the wrong kind, and a path outside the project", () => {
    expect(refused(run({ action: "create", path: "sets/gadget.ast" })).message).toMatch(
      /already exists/,
    );
    expect(refused(run({ action: "create", path: "new/a.asi" })).message).toMatch(
      /template is required/,
    );
    expect(
      refused(
        run({ action: "create", path: "new/a.asi", template: "{CCCCCCCCCCCCCCCC}sets/gadget.asi" }),
      ).message,
    ).toMatch(/must be a \.ast/);
    expect(
      refused(
        run({ action: "create", path: "new/a.asi", template: "{CCCCCCCCCCCCCCCC}sets/none.ast" }),
      ).code,
    ).toBe("RESOURCE_NOT_FOUND");
    expect(refused(run({ action: "create", path: "../out.ast" })).code).toBe("ABSOLUTE_PATH");
    expect(refused(run({ action: "create", path: "C:/elsewhere/x.ast" })).code).toBe(
      "NOT_IN_PROJECT",
    );
  });

  it("builds skeletons the parser keeps", () => {
    expect(unwritableReason(Buffer.from(astSkeleton()), "ast")).toBeUndefined();
    expect(
      unwritableReason(Buffer.from(asiSkeleton("AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBB")), "asi"),
    ).toBeUndefined();
    expect(parseCstBytes(Buffer.from(asiSkeleton())).diagnostics).toEqual([]);
  });
});

describe("registration", () => {
  function def() {
    let d: { description: string; inputSchema: Record<string, unknown> } | undefined;
    let name = "";
    let handler:
      | ((
          a: Record<string, unknown>,
        ) => Promise<{ content: { text: string }[]; isError?: boolean }>)
      | undefined;
    const fake = {
      registerTool: (n: string, definition: typeof d, h: typeof handler) => {
        name = n;
        d = definition;
        handler = h;
      },
    } as unknown as McpServer;
    registerAnimationSet(fake, config, { game: GAME });
    return { name, d: d!, handler: handler! };
  }

  it("registers animation_set with a description of at most 400 characters", () => {
    const r = def();
    expect(r.name).toBe(TOOL_NAME);
    expect(r.name).toBe("animation_set");
    expect(DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(r.d.description).toBe(DESCRIPTION);
    expect(Object.keys(r.d.inputSchema)).toEqual(
      expect.arrayContaining(["action", "path", "confirm", "slot", "resource"]),
    );
  });

  it("answers as JSON text and marks a refusal as an error", async () => {
    const r = def();
    const good = await r.handler({ action: "read", path: "sets/gadget.ast" });
    expect(good.isError).toBe(false);
    expect(JSON.parse(good.content[0].text).ok).toBe(true);
    const bad = await r.handler({ action: "read", path: "sets/none.ast" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).code).toBe("PATH_NOT_FOUND");
  });

  it("names no sandbox or project in the description", () => {
    expect(DESCRIPTION.toLowerCase()).not.toMatch(/sandbox/);
  });
});

// Census rows this file tests (W4 close-out, EV-W4-053).
// census:mcp:action/animation_set.create
// census:mcp:action/animation_set.map
// census:mcp:action/animation_set.read
// census:mcp:action/animation_set.validate
