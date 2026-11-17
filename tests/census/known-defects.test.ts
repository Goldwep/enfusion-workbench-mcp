/**
 * The known-defects list (plan 3.3 principle 7, plan Phase 1 item 4; definition of
 * done 6: the list is empty at release).
 *
 * `data/census/known-defects.json` lists every defect that is still present on
 * this branch and that a test asserts. This file does three things:
 *
 *   1. checks the list's shape: unique ids, the documented fields, repository
 *      paths that exist, no machine path, and for every entry an `asserted_by`
 *      that names a test file which exists and holds an `it` or `test` whose
 *      literal title is exactly the name given (plus, for a parametrised test
 *      such as `it.each(CASES)("$id", ...)`, a `case` that the file holds as a
 *      string literal);
 *   2. holds the expected-failure cases for the entries that no other file
 *      asserts (none today: KD-006 to KD-008 were fixed in Phase 6 and their
 *      cases now assert the fix). Each pins the defective state: it passes
 *      while the defect is present and fails the moment it is fixed, so the fix
 *      removes the entry and turns the case into a plain assertion of the fixed
 *      state. The list and the cases are tied both ways: every case here has its
 *      entry, and every entry that names this file has its case. The switch
 *      entries are asserted by `tests/census/cli-flags.test.ts`;
 *   3. names the regression test of every Appendix D defect that already landed
 *      on `main` (DEC-019), so a fixed defect has no entry and still has a guard.
 *
 * Test titles are read with the TypeScript compiler API (calls to `describe`,
 * `it`, `test` and their `.each`, `.fails`, `.skip` forms with a literal title),
 * so a name in a comment does not count.
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { decodeResponse, encodePascalString } from "../../src/workbench/protocol.js";
import { runValidate } from "../../src/tools/wb-validate.js";
import { LEGACY_MAP, registerWbScriptEditor } from "../../src/tools/wb-script-editor.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFECTS_FILE = join(REPO_ROOT, "data", "census", "known-defects.json");
const HANDLER_DIR = "mod/Scripts/WorkbenchGame/EnfusionMCP";
const THIS_TEST = "tests/census/known-defects.test.ts";

interface KnownDefect {
  id: string;
  title: string;
  where: string;
  found_by: string;
  evidence: string;
  asserted_by: { file: string; test: string; case?: string };
  fixed_by: string;
  switch?: string;
  defect_kind?: string;
  files?: string[];
}

const REQUIRED = ["id", "title", "where", "found_by", "evidence", "asserted_by", "fixed_by"];
const OPTIONAL = ["switch", "defect_kind", "files"];

function repoText(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

/**
 * The literal titles of the `describe`, `it` and `test` calls in a test file;
 * with `describes` false only those of `it` and `test`, which are the tests.
 */
export function testTitles(text: string, describes = true): string[] {
  const sf = ts.createSourceFile("t.ts", text, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  const rootOf = (e: ts.Expression): string | undefined => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return rootOf(e.expression);
    // it.each(table)("title", ...) and it.skipIf(cond)("title", ...)
    if (ts.isCallExpression(e)) return rootOf(e.expression);
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const root = rootOf(node.expression);
      const first = node.arguments[0];
      if (
        root !== undefined &&
        (describes ? ["describe", "it", "test"] : ["it", "test"]).includes(root) &&
        first !== undefined &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      ) {
        titles.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return titles;
}

/** The titles of the tests (`it`, `test`) in a repository file, not of its `describe` blocks. */
function titlesOf(rel: string): string[] {
  return testTitles(repoText(rel), false);
}

/** Every string literal in a source text (a template without substitutions counts). */
export function stringLiterals(text: string): string[] {
  const sf = ts.createSourceFile("t.ts", text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const LIST = JSON.parse(readFileSync(DEFECTS_FILE, "utf-8")) as {
  version: number;
  defects: KnownDefect[];
};

// ── The list ──────────────────────────────────────────────────────────────────

describe("testTitles", () => {
  it("reads literal titles of describe, it, test and their modifiers, and ignores comments", () => {
    const text = [
      '// it("in a comment", () => {});',
      'describe("outer", () => {',
      '  it("plain", () => {});',
      '  it.fails("expected failure", () => {});',
      "  it.each([1])(`each %s`, () => {});",
      '  test.skip("skipped", () => {});',
      "  it(name, () => {});",
      "});",
    ].join("\n");
    expect(testTitles(text)).toEqual(["outer", "plain", "expected failure", "each %s", "skipped"]);
  });

  it("leaves out describe blocks when asked for the tests only", () => {
    const text =
      'describe("outer", () => { it("inner", () => {}); test.each([1])("$id", () => {}); });';
    expect(testTitles(text, false)).toEqual(["inner", "$id"]);
  });
});

describe("stringLiterals", () => {
  it("reads string and plain template literals and ignores comments", () => {
    expect(stringLiterals('// "no"\nconst a = ["x:y", `z`, w];')).toEqual(["x:y", "z"]);
  });
});

describe("data/census/known-defects.json", () => {
  it("has the documented top level", () => {
    expect(LIST.version).toBe(1);
    expect(Array.isArray(LIST.defects)).toBe(true);
  });

  it("holds no machine path", () => {
    expect(containsMachinePath(readFileSync(DEFECTS_FILE, "utf-8"))).toBe(false);
  });

  it("gives every entry exactly the documented fields", () => {
    for (const d of LIST.defects) {
      const keys = Object.keys(d);
      for (const k of REQUIRED) expect(keys, `${d.id} is missing ${k}`).toContain(k);
      for (const k of keys)
        expect([...REQUIRED, ...OPTIONAL], `${d.id} has stray key ${k}`).toContain(k);
      for (const k of ["id", "title", "where", "found_by", "evidence", "fixed_by"] as const) {
        expect(typeof d[k] === "string" && d[k].trim() !== "", `${d.id}.${k}`).toBe(true);
      }
      const assertedKeys = Object.keys(d.asserted_by).filter((k) => k !== "case");
      expect(assertedKeys.sort(), `${d.id}.asserted_by`).toEqual(["file", "test"]);
      if (d.asserted_by.case !== undefined) {
        expect(d.asserted_by.case.trim() !== "", `${d.id}.asserted_by.case`).toBe(true);
      }
      // The switch fields go together, and both are required of the entries the flag test asserts.
      expect(d.switch === undefined, `${d.id} switch and defect_kind go together`).toBe(
        d.defect_kind === undefined,
      );
      if (d.asserted_by.file === "tests/census/cli-flags.test.ts") {
        expect(d.switch, `${d.id} needs a switch`).toMatch(/^-[A-Za-z][A-Za-z0-9]+$/);
        expect(["unknown-switch", "misused-switch"], d.id).toContain(d.defect_kind);
        expect(
          Array.isArray(d.files) && d.files.length > 0,
          `${d.id} needs a non-empty files list`,
        ).toBe(true);
        for (const f of d.files ?? []) {
          expect(existsSync(join(REPO_ROOT, f)), `${d.id}: files entry ${f} does not exist`).toBe(
            true,
          );
        }
      } else {
        expect(d.files, `${d.id}: files belongs to the switch entries`).toBeUndefined();
      }
    }
  });

  it("has unique ids of the form KD-nnn", () => {
    const ids = LIST.defects.map((d) => d.id);
    for (const id of ids) expect(id).toMatch(/^KD-\d{3}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names, for every entry, a test file that exists and holds a test with exactly that title", () => {
    for (const d of LIST.defects) {
      const { file, test } = d.asserted_by;
      expect(file, `${d.id} asserted_by.file`).toMatch(/^tests\/.+\.test\.ts$/);
      expect(existsSync(join(REPO_ROOT, file)), `${d.id}: ${file} does not exist`).toBe(true);
      expect(
        titlesOf(file),
        `${d.id}: no it or test in ${file} has the literal title "${test}"`,
      ).toContain(test);
      // A parametrised title (`$id`, `%s`) stands for many cases: the entry names its case.
      if (/[$%]/.test(test)) {
        expect(
          d.asserted_by.case,
          `${d.id}: "${test}" is parametrised, so asserted_by needs a case`,
        ).toBeDefined();
      }
      if (d.asserted_by.case !== undefined) {
        expect(
          stringLiterals(repoText(file)),
          `${d.id}: ${file} holds no string literal "${d.asserted_by.case}" for the case`,
        ).toContain(d.asserted_by.case);
      }
    }
  });

  it("ties the cases in this file to the list both ways", () => {
    // Every case titled "KD-nnn ..." here has an entry with that id naming exactly this title.
    const cases = titlesOf(THIS_TEST).filter((t) => /^KD-\d{3} /.test(t));
    // The list must be empty at release (definition of done 6): no case here is then right.
    expect(cases.length, "KD-nnn cases here and entries naming this file go together").toBe(
      LIST.defects.filter((e) => e.asserted_by.file === THIS_TEST).length,
    );
    for (const title of cases) {
      const id = title.slice(0, 6);
      const entry = LIST.defects.find((d) => d.id === id);
      expect(
        entry,
        `${title}: ${id} is not in data/census/known-defects.json (an entry was removed while the defect is present, or the case was never listed)`,
      ).toBeDefined();
      expect(entry?.asserted_by, `${id}: asserted_by must name this file and this title`).toEqual({
        file: THIS_TEST,
        test: title,
      });
    }
    // Every entry that names this file has a case: a listed defect nothing asserts is dead weight.
    for (const d of LIST.defects.filter((e) => e.asserted_by.file === THIS_TEST)) {
      expect(
        cases,
        `${d.id}: no case in this file has the title "${d.asserted_by.test}"`,
      ).toContain(d.asserted_by.test);
      expect(
        d.asserted_by.test.startsWith(`${d.id} `),
        `${d.id}: its case title must start with the id`,
      ).toBe(true);
    }
  });

  it("names repository paths in `where` that exist", () => {
    for (const d of LIST.defects) {
      const paths = d.where
        .split(/[,;()]/)
        .map((s) => s.replace(/^\s*[a-z ]+:\s*/, "").trim())
        .filter((s) => /^(src|mod|data|scripts|tests)\//.test(s) && !/\s/.test(s));
      expect(paths.length, `${d.id}: no repository path in "where"`).toBeGreaterThan(0);
      for (const p of paths) expect(existsSync(join(REPO_ROOT, p)), `${d.id}: ${p}`).toBe(true);
    }
  });
});

// ── Expected-failure cases (the defective state, pinned) ──────────────────────

// None today: every entry this file asserted is fixed (below). A new one goes here as
// `it("KD-nnn <title>", ...)` with its entry in data/census/known-defects.json.

// ── Defects fixed on this branch: the entry is gone, the case asserts the fix ──

describe("known defects fixed on v2 keep a plain assertion", () => {
  // Was KD-006 (fixed_by kernel 3.1; Phase 6): decodeResponse threw "Ok status with empty
  // payload" on a complete frame whose payload string is empty, which native functions with no
  // fields send by design. It now decodes as {}; a status-only frame (no payload string at all)
  // still throws unless allowEmptyPayload, since for a handler it may be a truncated frame.
  it("decodeResponse decodes an OK status with an empty payload as an empty result", () => {
    const ok = encodePascalString("Ok");
    expect(decodeResponse(Buffer.concat([ok, encodePascalString("")]))).toEqual({});
    expect(() => decodeResponse(ok)).toThrow(/no payload/i);
    expect(decodeResponse(ok, { allowEmptyPayload: true })).toEqual({});
    expect(() =>
      decodeResponse(Buffer.concat([encodePascalString("Refused"), encodePascalString("")])),
    ).toThrow(/Refused/);
  });

  // Was KD-007 (fixed_by U4; Phase 6): EMCP_WB_Reload tried four guessed menu paths through
  // ExecuteAction. ReloadScripts is native (DEC-040 U4, DEC-044) and the kernel wraps it; the
  // handler now sends no ExecuteAction and names the native route.
  it("EMCP_WB_Reload calls no ExecuteAction and names the native ReloadScripts", () => {
    const text = repoText(`${HANDLER_DIR}/EMCP_WB_Reload.c`);
    expect(text).not.toMatch(/ExecuteAction\s*\(/);
    expect(text).not.toMatch(/menuPath/);
    expect(text).toContain("ReloadScripts");
    expect(/["'`]ReloadScripts["'`]/.test(repoText("src/workbench/native.ts"))).toBe(true);
  });

  // Was KD-008 (fixed_by U13, then W1; Phase 6): setProperty passed a component class name to
  // SetVariableValue as ContainerIdPathEntry(<ClassName>). U13 (DEC-045, EV-S-E-042) wrote and
  // read back components[24] with the index from GetComponent order; the writes now resolve a
  // leading class-name segment to ContainerIdPathEntry("components", index).
  it("the property writer resolves a component class name to an index into components", () => {
    const text = repoText(`${HANDLER_DIR}/EMCP_WB_ModifyEntity.c`);
    expect(text).toMatch(/static int FindComponentIndexByClass\(/);
    expect(text).toMatch(/new ContainerIdPathEntry\("components", compIdx\)/);
    for (const call of ["SetVariableValue", "ClearVariableValue", "ChangeObjectClass"]) {
      expect(text, `${call} goes through BuildEntityPathEntries`).toMatch(
        new RegExp(
          String.raw`BuildEntityPathEntries\(entSrc, (req\.propertyPath|fullPath)\);[\s\S]{0,200}api\.` +
            call +
            String.raw`\(entSrc, pathEntries`,
        ),
      );
    }
    // The plain path builder no longer feeds a write through the entity directly.
    expect(text).not.toMatch(
      /= BuildPathEntries\((req\.propertyPath|fullPath)\);\s*\n\s*api\.BeginEntityAction\("(Set property|Clear property|Set object class)/,
    );
  });

  // Was KD-012: no tool called the native ReloadScripts, ValidateScripts or EvaluateScript
  // NET functions; wb_reload guessed ExecuteAction paths and wb_validate_scripts launched a
  // headless process. Phase 2 proved ValidateScripts and ReloadScripts (DEC-040, U3 and U4) and
  // the kernel wraps them in src/workbench/native.ts (DEC-048 package A). EvaluateScript stays
  // unwrapped: the build answers "Undefined API func" (U2). The tools re-point in package B.
  it("the kernel's native layer names ValidateScripts and ReloadScripts, and wraps no EvaluateScript", () => {
    const native = repoText("src/workbench/native.ts");
    expect(/["'`]ValidateScripts["'`]/.test(native)).toBe(true);
    expect(/["'`]ReloadScripts["'`]/.test(native)).toBe(true);
    // No wrapper for EvaluateScript: the name appears in native.ts only in its header comment.
    expect(/export\s+(async\s+)?function\s+evaluateScript/i.test(native)).toBe(false);
  });

  // Was KD-022 (the W4 spec's KD-W4-1, fixed_by W4): the 1.x validator's V11 BlendN rule read
  // thresholds as an array and threw "thresholds.map is not a function" on 21 vanilla .agf
  // (phase5-w4-spec.md 0.2). The W4 rework takes any shape; corpus gate 2 of
  // tests/corpus/animation-graph.corpus.test.ts runs every vanilla .agf without a throw.
  it("the animation validator's V11 rule takes BlendN thresholds of any shape without throwing", async () => {
    const { validateGraph } = await import("../../src/animation/validator.js");
    for (const thresholds of ["10 5 20", ["10", "5", "20"], [0, 1, 2], undefined]) {
      const node = {
        type: "AnimSrcNodeBlendN",
        name: "BN",
        children: [],
        properties: { thresholds },
        editorPos: { x: 0, y: 0 },
        raw: "",
      };
      const agf = { sheets: [{ name: "Main", nodes: [node] }] };
      expect(() => validateGraph(agf as never)).not.toThrow();
    }
  });

  // Was KD-009 (fixed_by W3): the 1.x handler walked GetNumChildren/GetChild and read columns
  // that do not exist. The W3 rewrite walks the table's "Items" object array.
  it("EMCP_WB_Localization walks the Items array, not GetNumChildren and GetChild", () => {
    const text = repoText(`${HANDLER_DIR}/EMCP_WB_Localization.c`);
    expect(text).not.toMatch(/\.GetNumChildren\(\)/);
    expect(text).not.toMatch(/\.GetChild\(/);
    expect(text).toContain('VAR_ITEMS = "Items"');
    expect(text).toMatch(/table\.GetObjectArray\(EMCP_WB_LocalizationUtil\.VAR_ITEMS\)/);
  });

  // Was KD-010 (fixed_by W3): the 1.x tool called the line 1-based and sent it unchanged to a
  // 0-based handler. The W3 tool states 0-based lines; the 1.x getLine alias converts.
  it("wb_script_editor states 0-based lines, and the 1.x getLine converts its 1-based line", async () => {
    type Handler = (a: Record<string, unknown>) => Promise<unknown>;
    let handler: Handler | undefined;
    const sent: Record<string, unknown>[] = [];
    const client = {
      state: { connected: true, mode: "edit", lastUpdated: 0 },
      call: vi.fn(async (_fn: string, params: Record<string, unknown> = {}) => {
        sent.push(params);
        return { status: "ok", code: "", rows: ["x"], total: 9 };
      }),
    } as unknown as WorkbenchClient;
    registerWbScriptEditor(
      {
        registerTool: (_name: string, _def: unknown, h: Handler) => {
          handler = h;
        },
      } as never,
      client,
    );
    const contract = JSON.parse(repoText("contracts/EMCP_WB_ScriptEditor.json")) as {
      purpose: string;
    };
    expect(contract.purpose).toContain("0-based");
    expect(LEGACY_MAP.getLine).toContain("1-based");
    await handler!({ action: "getLine", line: 5 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ action: "getLines", start: 4, limit: 1 });
    const handlerSource = repoText(`${HANDLER_DIR}/EMCP_WB_ScriptEditor.c`);
    expect(handlerSource).not.toContain("1-based");
  });

  // Was KD-011 (fixed_by W2): wb_validate material answered "No Verdict Available" because BI's
  // MaterialValidator handler reads a static array only the dialog fills. The W2 route sends to
  // EMCP_WB_Validate, which runs BI's five MaterialValidatorUtils checks, and answers a verdict.
  it("wb_validate material runs EMCP_WB_Validate and answers a verdict", async () => {
    const tool = repoText("src/tools/wb-validate.ts");
    expect(tool).not.toMatch(/["'`]MaterialValidator["'`]/);
    expect(tool).not.toContain("No Verdict Available");
    const handler = repoText(`${HANDLER_DIR}/EMCP_WB_Validate.c`);
    expect(handler).toContain("new MaterialValidatorUtils()");
    for (const call of [
      "ValidateUVs(",
      "CheckDefaults(",
      "CheckExtremes(",
      "CheckDependencies(",
      "CheckTextures(",
    ])
      expect(handler).toContain(call);
    const sent: { fn: string; params: Record<string, unknown> }[] = [];
    const client = {
      call: async (fn: string, params: Record<string, unknown>) => {
        sent.push({ fn, params });
        return { status: "ok", code: "", severity: 2, reports: ["2: extreme value"], textures: [] };
      },
    } as unknown as WorkbenchClient;
    const r = await runValidate(client, { action: "material", path: "Materials/Any.emat" });
    expect(sent).toEqual([
      { fn: "EMCP_WB_Validate", params: { action: "material", path: "Materials/Any.emat" } },
    ]);
    expect(r).toMatchObject({
      ok: true,
      readback: { severity: 2, reports: [{ severity: 2, text: "extreme value" }] },
    });
  });

  // Was KD-013: Doxygen swallowed 28 declarations after an /endcode typo in
  // Bohemia's source comment. The index is back-filled from the script source
  // (src/scraper/backfill.ts, DEC-027).
  it("the scraped index lists all 124 WorldEditorAPI methods", () => {
    const classes = JSON.parse(repoText("data/api/enfusion-classes.json")) as {
      name: string;
      methods: unknown[];
    }[];
    const api = classes.find((c) => c.name === "WorldEditorAPI");
    expect(api?.methods.length).toBe(124);
  });
});

// ── Defects the maintenance fixes already closed: no entry, a named guard ─────

describe("Appendix D defects fixed on main keep a regression test", () => {
  const GUARDS: { defect: string; commit: string; tests: { file: string; title: string }[] }[] = [
    {
      defect: "single version source",
      commit: "59b4921",
      tests: [{ file: "tests/version.test.ts", title: "equals the version field of package.json" }],
    },
    {
      // W2 (OD-7, DEC-063) moved wb_validate off BI's TextureValidator and MaterialValidator onto
      // EMCP_WB_Validate; the guards now pin the request it sends and the checks it reads.
      defect: "wb_validate sends texture_path and reads reports",
      commit: "cd185cc",
      tests: [
        {
          file: "tests/tools/wb-validate.test.ts",
          title: "texture with an absolute path under the project root is sent relative",
        },
        {
          file: "tests/tools/wb-validate.test.ts",
          title: "shapes the type, the checks and the fatal flag (1 from Enforce)",
        },
      ],
    },
    {
      defect: "wb_projects locate sends path",
      commit: "cd185cc",
      tests: [
        {
          file: "tests/tools/wb-projects.test.ts",
          title: "sends exactly the declared request field (path), not name",
        },
      ],
    },
    {
      defect: "wb_prefabs getGuid and locate send the declared fields",
      commit: "cd185cc",
      tests: [
        {
          file: "tests/tools/wb-prefabs.test.ts",
          title: "sends exactly the declared request field (prefabPath), not path",
        },
        {
          // locate is gated since DEC-056 ruling 14: it sends nothing, and
          // names only declared keys in what it would read.
          file: "tests/tools/wb-prefabs.test.ts",
          title: "names only declared keys in the response it would read",
        },
      ],
    },
    {
      defect: "no Bohemia call sends an undeclared request key (static contract)",
      commit: "cd185cc",
      tests: [
        {
          file: "tests/contracts/bi-handlers.contract.test.ts",
          title: "no call sends a key the Bohemia function does not declare",
        },
      ],
    },
    {
      defect: "wb_validate material no longer invents a verdict",
      commit: "cd185cc",
      tests: [
        {
          file: "tests/tools/wb-validate.test.ts",
          title: "the answer no longer carries the KD-011 'No Verdict Available' text",
        },
      ],
    },
    {
      defect: "game_read decides text or binary from the bytes",
      commit: "ac6842a",
      tests: [
        {
          file: "tests/tools/game-read.test.ts",
          title: "returns a text file with an extension that was never listed",
        },
        {
          file: "tests/tools/game-read.test.ts",
          title: "refuses a binary file that has a text-looking extension, with the reason",
        },
      ],
    },
    {
      defect: "refactor_move_resource_path moves the .meta sidecar",
      commit: "39a2b97",
      tests: [
        {
          file: "tests/tools/refactor-move-resource-path.test.ts",
          title: "moves the sidecar with the resource and rewrites its Name line",
        },
      ],
    },
    {
      defect: "KB errors (ScriptEditorPlugin, GetModule claim, reload paths, File,Save)",
      commit: "512eaa5",
      tests: [
        {
          file: "tests/kb/kb-facts.test.ts",
          title: "does not use a ScriptEditorPlugin base class (no such class exists)",
        },
        {
          file: "tests/kb/kb-facts.test.ts",
          title: "says -wbProjectPath is not a Workbench parameter and -gproj is",
        },
      ],
    },
    {
      defect: "wb_layers and headless-tool descriptions, wb_execute_action example",
      commit: "2c59ce8",
      tests: [
        {
          file: "tests/tools/wb-descriptions.test.ts",
          title: "%s no longer teaches the phantom project switch and states Read: or Mutating:",
        },
        {
          file: "tests/tools/wb-descriptions.test.ts",
          // W1 (DEC-061) implemented the missing layer operations; the guard now pins that the
          // description comes from the contract and no longer calls them a gap.
          title: "wb_layers description comes from the contract and names the layer actions",
        },
        {
          file: "tests/tools/wb-descriptions.test.ts",
          title: "wb_execute_action no longer teaches File,Save",
        },
      ],
    },
  ];

  it.each(GUARDS.map((g) => [g.defect, g] as const))("%s", (_name, g) => {
    for (const t of g.tests) {
      expect(existsSync(join(REPO_ROOT, t.file)), `${g.commit}: ${t.file}`).toBe(true);
      expect(
        titlesOf(t.file),
        `${g.commit}: no it or test in ${t.file} has the literal title "${t.title}"`,
      ).toContain(t.title);
    }
  });
});
