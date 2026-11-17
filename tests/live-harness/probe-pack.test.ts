/**
 * The two development-only probe packs (plan 5.4 item 7, Appendix A):
 * `mod-dev/probe/` (read-only, `ECEN_Probe`) and `mod-dev/probe-mut/`
 * (mutating, `ECEN_ProbeMut`). Offline only: nothing here talks to Workbench.
 *
 * - The linter over each pack, alone and beside the shipped set, reports no
 *   level-1 failure and no parse error (skipped when the build's source index
 *   is absent); the count of unresolved receivers is printed.
 * - Each NET API function's request and response keys equal its contract.
 * - The generated lists equal the generator's output for the current policy; a
 *   planted policy entry is generated, a planted deny-listed entry is refused.
 * - Nothing under `mod/` carries the ECEN_ prefix and the shipped installers
 *   copy only from `mod/`.
 * - A forbidden-symbol scan over both packs finds nothing.
 * - Every pack file has the ECEN_ prefix (launch.ts refuses others).
 */

import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  handlerKeysOf,
  lintEnforceFiles,
  lintPassed,
  type HandlerContract,
  type LintInput,
} from "../../src/census/enforce-lint.js";
import { lex } from "../../src/census/enforce-source.js";
import {
  SOURCE_INDEX_FILE,
  loadSourceIndex,
  type SourceIndex,
} from "../../src/census/source-index.js";
import {
  ALLOW_LIST_FILE,
  MENU_DENY_WORDS,
  MUT_LISTS_FILE,
  assertNoPersonalData,
  generate,
  labelWords,
  renderAllowList,
  renderMutLists,
  segmentProblem,
  type ProbePolicy,
} from "../../scripts/live/gen-probe-allowlist.js";
import {
  BUNDLED_HANDLER_DIR,
  MOD_DEV_ROOT,
  PROBE_PACK_PREFIX,
  installHandlers,
  installProbePack,
} from "../../scripts/live/launch.js";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import { deniedLabels, loadPolicy } from "../../scripts/live/policy.js";

const PROBE_DIR = join(REPO_ROOT, "mod-dev", "probe");
const MUT_DIR = join(REPO_ROOT, "mod-dev", "probe-mut");
const CONTRACTS_DIR = join(REPO_ROOT, "mod-dev", "contracts");
const SHIPPED_DIR = join(REPO_ROOT, "mod", "Scripts", "WorkbenchGame", "EnfusionMCP");

function cFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".c"))
    .sort();
}

function inputs(dir: string): LintInput[] {
  return cFiles(dir).map((f) => ({
    path: relative(REPO_ROOT, join(dir, f)).split("\\").join("/"),
    text: readFileSync(join(dir, f), "utf-8"),
  }));
}

function contract(name: string): HandlerContract {
  return JSON.parse(readFileSync(join(CONTRACTS_DIR, `${name}.json`), "utf-8")) as HandlerContract;
}

/** The prose rules a contract file states per action (ignored by the linter). */
function contractRules(name: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(join(CONTRACTS_DIR, `${name}.json`), "utf-8")) as {
    rules?: Record<string, string>;
  };
  return raw.rules ?? {};
}

function contracts(): Map<string, HandlerContract> {
  const out = new Map<string, HandlerContract>();
  for (const f of readdirSync(CONTRACTS_DIR).filter((x) => x.endsWith(".json")))
    out.set(f.slice(0, -".json".length), contract(f.slice(0, -".json".length)));
  return out;
}

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Declared class names of a pack (E02 lexer: `class <Name>`). */
function classNames(dir: string): string[] {
  const out: string[] = [];
  for (const f of cFiles(dir)) {
    const toks = lex(readFileSync(join(dir, f), "utf-8")).toks;
    toks.forEach((t, i) => {
      if (t.k === "id" && t.t === "class" && toks[i + 1]?.k === "id") out.push(toks[i + 1].t);
    });
  }
  return out.sort();
}

interface Hit {
  file: string;
  line: number;
  what: string;
}

/**
 * Forbidden-symbol scan over the significant tokens (comments are not
 * scanned). `names`: an identifier anywhere, or that word inside a string
 * literal (a call by name). `calls`: an identifier matching the pattern
 * directly followed by `(`.
 */
function scan(dir: string, names: string[], calls: RegExp[]): Hit[] {
  const hits: Hit[] = [];
  const wordRes = names.map((n) => new RegExp(`\\b${n}\\b`));
  for (const f of cFiles(dir)) {
    const toks = lex(readFileSync(join(dir, f), "utf-8")).toks;
    toks.forEach((t, i) => {
      if (t.k === "id" && names.includes(t.t)) hits.push({ file: f, line: t.line, what: t.t });
      if (t.k === "str") {
        for (const re of wordRes)
          if (re.test(t.t)) hits.push({ file: f, line: t.line, what: `string ${t.t}` });
      }
      if (t.k === "id" && toks[i + 1]?.t === "(" && calls.some((re) => re.test(t.t)))
        hits.push({ file: f, line: t.line, what: `${t.t}(` });
    });
  }
  return hits;
}

/** Call sites `<name>(` in a pack: the tokens after the parenthesis, up to six. */
function callSites(dir: string, name: string): { file: string; args: string[] }[] {
  const out: { file: string; args: string[] }[] = [];
  for (const f of cFiles(dir)) {
    const toks = lex(readFileSync(join(dir, f), "utf-8")).toks;
    toks.forEach((t, i) => {
      if (t.k === "id" && t.t === name && toks[i + 1]?.t === "(")
        out.push({ file: f, args: toks.slice(i + 2, i + 8).map((x) => x.t) });
    });
  }
  return out;
}

// Plan Appendix B and the task's lists.
const BOTH_NAMES = ["GetUserName", "RunCommandline", "RunCmd", "RunProcess"];
const BOTH_CALLS = [/^Exit$/, /^ScriptDialog$/, /^KillProcess$/, /^Configure$/];
const READ_ONLY_CALLS = [
  /^Save/,
  /^Set(Engine)?(Range)?Value$/,
  /^Create/,
  /^Delete/,
  // Stricter than asked: every other write the API offers.
  /^Set$/,
  /^SetObject/,
  /^SetName$/,
  /^SetAncestor$/,
  /^Clear(Variable|Variables)$/,
  /^Write(To|Property)/,
  /^SetOpenedResource$/,
  /^SetActiveSubsceneLayer$/,
  /^SetEntitySubsceneLayer$/,
  /^SetTerrainSurfaceTile$/,
  /^ModifyHeightMap/,
  /^ModifyLayers/,
  /^BeginTerrainAction$/,
  /^BeginEntityAction$/,
  /^Run$/,
  /^Remove/,
  /^Rename/,
];

// ── Files and installer ──────────────────────────────────────────────────────

describe("probe pack files", () => {
  it("every pack file has the ECEN_ prefix, and launch.ts accepts each pack", () => {
    const tmp = mkdtempSync(join(tmpdir(), "emcp-probe-pack-"));
    // The installer takes a pack only into a folder named like the 2.0 sandbox.
    const sandbox = join(tmp, "EMCP2_sandbox");
    mkdirSync(sandbox);
    try {
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "");
      for (const dir of [PROBE_DIR, MUT_DIR]) {
        const files = cFiles(dir);
        expect(files.length).toBeGreaterThan(0);
        expect(readdirSync(dir).filter((f) => !f.startsWith(PROBE_PACK_PREFIX))).toEqual([]);
        const plan = installProbePack(sandbox, dir, { really: false });
        expect(plan.files).toEqual(files);
        expect(plan.copied).toBe(false);
      }
      expect(cFiles(PROBE_DIR).every((f) => f.startsWith("ECEN_Probe"))).toBe(true);
      expect(cFiles(PROBE_DIR).some((f) => f.startsWith("ECEN_ProbeMut"))).toBe(false);
      expect(cFiles(MUT_DIR).every((f) => f.startsWith("ECEN_ProbeMut"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the two packs share no file and no class, and keep their class prefixes", () => {
    const probeFiles = cFiles(PROBE_DIR);
    expect(cFiles(MUT_DIR).filter((f) => probeFiles.includes(f))).toEqual([]);
    const ro = classNames(PROBE_DIR);
    const mut = classNames(MUT_DIR);
    expect(ro.filter((c) => mut.includes(c))).toEqual([]);
    expect(ro.every((c) => c.startsWith("ECEN_Probe") && !c.startsWith("ECEN_ProbeMut"))).toBe(
      true,
    );
    expect(mut.every((c) => c.startsWith("ECEN_ProbeMut"))).toBe(true);
    // No pack class collides with a shipped one.
    const shipped = classNames(SHIPPED_DIR);
    expect([...ro, ...mut].filter((c) => shipped.includes(c))).toEqual([]);
  });

  it("no file under mod/ carries the ECEN_ prefix or declares an ECEN_ class", () => {
    const files = walk(join(REPO_ROOT, "mod"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /[\\/]ECEN_[^\\/]*$/.test(f))).toEqual([]);
    expect(
      files.filter((f) => f.endsWith(".c") && /\bclass\s+ECEN_/.test(readFileSync(f, "utf-8"))),
    ).toEqual([]);
  });

  it("the shipped installers copy only from mod/, never from mod-dev/", () => {
    // launch.ts: the shipped set lives under mod/ and outside mod-dev/.
    expect(BUNDLED_HANDLER_DIR).toBe(SHIPPED_DIR);
    expect(relative(MOD_DEV_ROOT, BUNDLED_HANDLER_DIR).startsWith("..")).toBe(true);
    const packRoot = mkdtempSync(join(tmpdir(), "emcp-probe-pack-"));
    const sandbox = join(packRoot, "EMCP2_sandbox");
    mkdirSync(sandbox);
    try {
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "");
      const plan = installHandlers(sandbox, { really: false });
      expect(plan.source).toBe(SHIPPED_DIR);
      expect(plan.files.filter((f) => f.startsWith(PROBE_PACK_PREFIX))).toEqual([]);
    } finally {
      rmSync(packRoot, { recursive: true, force: true });
    }
    // src/workbench/client.ts: the registered server installs from <package>/mod/... only.
    const client = readFileSync(join(REPO_ROOT, "src", "workbench", "client.ts"), "utf-8");
    expect(client).not.toMatch(/mod-dev/);
    const sources = [...client.matchAll(/join\(\s*packageRoot\s*,([^)]*)\)/g)].map((m) => m[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources)
      expect(s).toMatch(/^\s*"mod",\s*"Scripts",\s*"WorkbenchGame",\s*HANDLER_FOLDER\s*$/);
    expect(client).toMatch(/const HANDLER_FOLDER = "EnfusionMCP";/);
    // The npm package ships mod/, not mod-dev/.
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
      files: string[];
    };
    expect(pkg.files).toContain("mod");
    expect(pkg.files.filter((f) => f.startsWith("mod-dev") || /[*?]/.test(f))).toEqual([]);
  });
});

// ── Forbidden symbols ────────────────────────────────────────────────────────

describe("forbidden-symbol scan", () => {
  it("catches a planted symbol, call and call by name, and ignores comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-probe-scan-"));
    try {
      writeFileSync(
        join(dir, "ECEN_ProbePlanted.c"),
        [
          "// RunProcess in a comment is not code",
          "class ECEN_ProbePlanted",
          "{",
          "\tstatic void F(ScriptModule m)",
          "\t{",
          "\t\tstring u; Workbench.GetUserName(u);",
          '\t\tstring r; m.Call(null, "RunCmd", false, r);',
          '\t\tBaseContainerTools.SaveContainer(null, "x");',
          "\t\tWorkbench.Exit(0);",
          "\t}",
          "}",
        ].join("\n"),
      );
      const hits = scan(dir, BOTH_NAMES, [...BOTH_CALLS, ...READ_ONLY_CALLS]).map((h) => h.what);
      expect(hits).toEqual(["GetUserName", 'string "RunCmd"', "SaveContainer(", "Exit("]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing of Appendix B's lists in either pack", () => {
    expect(scan(PROBE_DIR, BOTH_NAMES, BOTH_CALLS)).toEqual([]);
    expect(scan(MUT_DIR, BOTH_NAMES, BOTH_CALLS)).toEqual([]);
  });

  it("finds no save, set-value, create, delete or other write call in the read-only pack", () => {
    expect(scan(PROBE_DIR, [], READ_ONLY_CALLS)).toEqual([]);
  });

  it("the read-only pack opens one dialog, with its fixed caption, and calls one function by name", () => {
    // No input reaches the U6 dialog (DEC-030/031): the owner closes it by hand, so the policy
    // holds no dry-run exception that would let a script post a key to it (the Phase 4 D14
    // exception lifts only the scripted Cancel of the Options dialog).
    const policy = loadPolicy();
    expect((policy.dry_run?.exceptions ?? []).filter((e) => e.allows.startsWith("key-"))).toEqual(
      [],
    );
    const caption = "ECEN probe modal";
    const dialogs = callSites(PROBE_DIR, "Dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].args[0]).toBe(`"${caption}"`);
    expect(callSites(MUT_DIR, "Dialog")).toEqual([]);
    // The only dynamic call: compiled.Call(null, ECEN_ProbeEval.EVAL_FUNCTION, false, result).
    const calls = callSites(PROBE_DIR, "Call");
    expect(calls).toHaveLength(1);
    expect(calls[0].args.slice(0, 5)).toEqual([
      "null",
      ",",
      "ECEN_ProbeEval",
      ".",
      "EVAL_FUNCTION",
    ]);
    expect(callSites(MUT_DIR, "Call")).toEqual([]);
    // Run() exists only in the mutating pack, once.
    expect(callSites(MUT_DIR, "Run")).toHaveLength(1);
  });
});

// ── Generated lists ──────────────────────────────────────────────────────────

describe("generated lists", () => {
  const policy = loadPolicy() as ProbePolicy;

  it("the generated files equal the generator's output for the current policy", () => {
    expect(readFileSync(ALLOW_LIST_FILE, "utf-8")).toBe(renderAllowList(policy));
    expect(readFileSync(MUT_LISTS_FILE, "utf-8")).toBe(renderMutLists(policy));
    for (const o of generate()) expect(readFileSync(o.file, "utf-8")).toBe(o.text);
    // Edit > Undo (U19, DEC-029, S-E since DEC-040) and S-D's U9 Window toggles with their
    // mnemonic and lower-case forms, each listed (exact match, no derived variant), and S-F's U31
    // Qt Introspection Tool entry (B3); every plugin and option is refused. DEC-092 appends the 80
    // new paths of the 113 safe-toggle menu rows after them (tests/scripts/gen-action-allowlist).
    // DEC-107 (total audit live-tools-b-1): File > Options... opens a dialog and left the list.
    expect((policy.execute_action?.allow_list ?? []).slice(0, 8)).toEqual([
      ["Edit", "Undo"],
      ["Window", "Hierarchy"],
      ["Window", "Log Console"],
      ["&Window", "Hierarchy"],
      ["&Window", "Log Console"],
      ["window", "hierarchy"],
      ["window", "log console"],
      ["Utilities", "Qt Introspection Tool"],
    ]);
    expect(policy.execute_action?.allow_list ?? []).not.toContainEqual(["File", "Options..."]);
    // DEC-100: the allow-list keeps only the paths with a passing live result (59, then 58 once
    // File > Options... left it, DEC-107); the 48 others compile into Candidates, which only the
    // probe's candidate override reads.
    expect(policy.execute_action?.allow_list ?? []).toHaveLength(58);
    expect(renderAllowList(policy)).toMatch(/static int Count\(\)\n\t\{\n\t\treturn 58;/);
    expect(policy.execute_action?.candidates ?? []).toHaveLength(48);
    expect(renderAllowList(policy)).toMatch(/static int CandidateCount\(\)\n\t\{\n\t\treturn 48;/);
    expect(renderAllowList(policy)).toContain('outPaths.Insert("Edit\\nUndo");');
    expect(renderAllowList(policy)).toContain('outPaths.Insert("&Window\\nLog Console");');
    // One entry each for S-E on the owner's ruling of 2026-10-08 (Q8): set back in the same step.
    expect(renderMutLists(policy)).toMatch(/static int PluginCount\(\)\n\t\{\n\t\treturn 1;/);
    expect(renderMutLists(policy)).toContain(
      'outKeys.Insert("WorldEditor\\nSCR_SnapAndOrientToTerrainPlugin");',
    );
    expect(renderMutLists(policy)).toMatch(/static int DiagCount\(\)\n\t\{\n\t\treturn 1;/);
    expect(renderMutLists(policy)).toContain('outKeys.Insert("script:DEBUGUI_AI_PRINT_DEBUG");');
    expect(readFileSync(ALLOW_LIST_FILE, "utf-8")).toMatch(/GENERATED FILE, do not edit by hand/);
  });

  it("is deterministic", () => {
    expect(renderAllowList(policy)).toBe(renderAllowList(policy));
    expect(renderMutLists(policy)).toBe(renderMutLists(policy));
  });

  it("generates a planted allow-list entry and refuses a planted deny-listed one", () => {
    const planted = structuredClone(policy);
    planted.execute_action = {
      ...planted.execute_action,
      allow_list: [["Window", "Resource Browser"]],
    };
    const text = renderAllowList(planted);
    expect(text).toContain('outPaths.Insert("Window\\nResource Browser");');
    expect(text).toMatch(/static int Count\(\)\n\t\{\n\t\treturn 1;/);

    for (const bad of [
      ["File", "Exit"],
      ["File", "E&xit"],
      "Plugins > Publish to Workshop...",
      ["Edit", "Delete"],
      // A deny label inside a longer segment, as a run of words (review finding).
      ["Resource Browser", "Delete Selected"],
      ["File", "Exit Workbench"],
      ["File", "Save World As (Prefab)"],
      ["File", "Force  Save All"],
      ["File", "Save World As…"],
    ]) {
      const denied = structuredClone(policy);
      denied.execute_action = { ...denied.execute_action, allow_list: [bad] };
      expect(() => renderAllowList(denied)).toThrow(/deny-list label/);
    }
    // A refused word in any segment: save, close, rename, open, publish, ...
    for (const bad of [
      ["File", "Save"],
      ["File", "Save All"],
      ["File", "Rename"],
      ["Window", "Close Tab"],
      ["File", "Open Resource..."],
      ["File", "Publish..."],
      ["Plugins", "Workshop Upload"],
    ]) {
      const denied = structuredClone(policy);
      denied.execute_action = { ...denied.execute_action, allow_list: [bad] };
      expect(() => renderAllowList(denied)).toThrow(/refused word/);
    }
    // The policy's credential and external risk-name rules for menu items apply too.
    const credential = structuredClone(policy);
    credential.execute_action = {
      ...credential.execute_action,
      allow_list: [["Window", "Credentials"]],
    };
    expect(() => renderAllowList(credential)).toThrow(/risk-name rule/);

    const spaced = structuredClone(policy);
    spaced.execute_action = { ...spaced.execute_action, allow_list: [["Window ", "Log Console"]] };
    expect(() => renderAllowList(spaced)).toThrow(/white space/);
  });

  it("matches labels as the dry-run checker normalises them, word by word", () => {
    expect(labelWords("Force  Save All")).toEqual(["force", "save", "all"]);
    expect(labelWords("Save World As…")).toEqual(["save", "world", "as"]);
    expect(labelWords("E&xit\tAlt+F4")).toEqual(["exit"]);
    expect(labelWords("Publish:confirm")).toEqual(["publish", "confirm"]);
    const deny = deniedLabels(policy);
    expect(segmentProblem("Resource Browser", deny, [])).toBeNull();
    expect(segmentProblem("Log Console", deny, [])).toBeNull();
    expect(segmentProblem("Deleted Items", deny, [])).toBeNull(); // whole words only
  });

  it("compiles the refused words and the engine diag list into the handler", () => {
    const text = renderAllowList(policy);
    const words = [...text.matchAll(/outWords\.Insert\("([^"]*)"\);/g)].map((m) => m[1]);
    expect(words).toEqual([...MENU_DENY_WORDS]);
    expect(text).toMatch(/static int EngineDiagCount\(\)\n\t\{\n\t\treturn 0;/);

    const planted = structuredClone(policy);
    planted.probe = { diag_read_engine_ids: [{ id: 12, ledger_row: "diag:engine-12" }] };
    const withId = renderAllowList(planted);
    expect(withId).toContain("outIds.Insert(12);");
    expect(withId).toMatch(/static int EngineDiagCount\(\)\n\t\{\n\t\treturn 1;/);
    for (const id of [-1, 1.5, 2_000_000]) {
      const bad = structuredClone(policy);
      bad.probe = { diag_read_engine_ids: [{ id, ledger_row: "diag:x" }] };
      expect(() => renderAllowList(bad)).toThrow(/integer/);
    }
  });

  it("refuses to generate compiled code that holds a home path, instead of rewriting it", () => {
    // Assembled at test time so the PII gate does not read a home path in this file.
    const home = ["C:", "Users", "planted-user"].join("/");
    const planted = structuredClone(policy);
    planted.execute_action = {
      ...planted.execute_action,
      allow_list: [["Window", `${home}/Recent`]],
    };
    const text = renderAllowList(planted);
    const ctx = { userProfile: home };
    expect(() => assertNoPersonalData("ECEN_ProbeAllowList.c", text, ctx)).toThrow(/home path/);
    // The current policy holds nothing to rewrite: generate() returns the plain rendering.
    expect(generate()[0].text).toBe(renderAllowList(policy));
  });

  it("generates a planted plugin and diag entry and refuses a risky or unsupported one", () => {
    const planted = structuredClone(policy);
    planted.probe_mut = {
      plugin_run_allow_list: [
        {
          module: "WorldEditor",
          class: "SCR_SomePlugin",
          ledger_row: "plugin:SCR_SomePlugin",
          evidence: "test",
        },
      ],
      diag_set_allow_list: [{ key: "script:DEBUGUI_CHARACTER_MENU", ledger_row: "diag:x" }],
    };
    const text = renderMutLists(planted);
    expect(text).toContain('outKeys.Insert("WorldEditor\\nSCR_SomePlugin");');
    expect(text).toContain('outKeys.Insert("script:DEBUGUI_CHARACTER_MENU");');

    const risky = structuredClone(planted);
    risky.probe_mut!.plugin_run_allow_list![0].class = "SCR_PublishToWorkshopPlugin";
    expect(() => renderMutLists(risky)).toThrow(/risk-name rule/);
    const noEvidence = structuredClone(planted);
    noEvidence.probe_mut!.plugin_run_allow_list![0].evidence = "";
    expect(() => renderMutLists(noEvidence)).toThrow(/evidence/);
    const badKey = structuredClone(planted);
    badKey.probe_mut!.diag_set_allow_list![0].key = "AI/AI Navigator/Enabled";
    expect(() => renderMutLists(badKey)).toThrow(/key must be/);
  });
});

// ── evalCompile allow screen ─────────────────────────────────────────────────

const EVAL_FILE = join(PROBE_DIR, "ECEN_ProbeEval.c");

/** The string literals a static list method of a pack file inserts, in order. */
function listOf(file: string, method: string): string[] {
  const toks = lex(readFileSync(file, "utf-8")).toks;
  const at = toks.findIndex(
    (t, i) => t.k === "id" && t.t === method && toks[i + 1]?.t === "(" && toks[i - 1]?.t === "void",
  );
  if (at < 0) throw new Error(`${method} not found in ${file}`);
  let i = toks.findIndex((t, j) => j > at && t.t === "{");
  let depth = 0;
  const out: string[] = [];
  for (; i < toks.length; i++) {
    if (toks[i].t === "{") depth++;
    if (toks[i].t === "}" && --depth === 0) break;
    if (toks[i].k === "str" && toks[i - 2]?.t === "Insert") out.push(JSON.parse(toks[i].t));
  }
  return out;
}

/** A static const of a pack file, as written. */
function constOf(file: string, name: string): string {
  const m = new RegExp(`static const \\w+ ${name} = (.+);\\s*$`, "m").exec(
    readFileSync(file, "utf-8"),
  );
  if (!m) throw new Error(`${name} not found in ${file}`);
  return m[1];
}

/**
 * A TypeScript model of ECEN_ProbeEval.Screen, rule for rule, over the lists
 * read from the .c file. It runs here; the Enforce code runs only in the
 * Workbench (train #1), so this checks the rules, not their compiled form.
 */
function screenModel(text: string): string | null {
  const keywords = listOf(EVAL_FILE, "Keywords");
  const refused = listOf(EVAL_FILE, "RefusedKeywords");
  const classes = listOf(EVAL_FILE, "Classes");
  const methods = listOf(EVAL_FILE, "Methods");
  const prefixes = listOf(EVAL_FILE, "GetterPrefixes");
  const banned = listOf(EVAL_FILE, "Banned");
  const punctuation = JSON.parse(constOf(EVAL_FILE, "PUNCTUATION")) as string;
  const maxText = Number(constOf(EVAL_FILE, "MAX_TEXT"));
  const isStart = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  const isPart = (c: number) => isStart(c) || (c >= 48 && c <= 57);
  const isConst = (s: string) => /^[A-Z][A-Z0-9_]*$/.test(s);
  const methodOk = (s: string) =>
    methods.includes(s) ||
    prefixes.some(
      (p) => s.startsWith(p) && (s.length === p.length || /[A-Z0-9_]/.test(s[p.length])),
    );

  if (text.length === 0) return "text required";
  if (text.length > maxText) return "too long";
  const toks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i++;
      continue;
    }
    if (isStart(c)) {
      const s = i++;
      while (i < text.length && isPart(text.charCodeAt(i))) i++;
      toks.push(text.slice(s, i));
      continue;
    }
    if (c >= 48 && c <= 57) {
      i++;
      while (i < text.length && (isPart(text.charCodeAt(i)) || text.charCodeAt(i) === 46)) i++;
      toks.push("0");
      continue;
    }
    if (c === 34) {
      i++;
      let closed = false;
      while (i < text.length) {
        const l = text.charCodeAt(i);
        if (l === 10 || l === 13) break;
        if (l === 92) {
          i += 2;
          continue;
        }
        i++;
        if (l === 34) {
          closed = true;
          break;
        }
      }
      if (!closed) return "unterminated string literal";
      toks.push('""');
      continue;
    }
    if (c === 47 && (text.charCodeAt(i + 1) === 47 || text.charCodeAt(i + 1) === 42))
      return "comments are refused";
    if (!punctuation.includes(text[i])) return `character ${c} refused`;
    toks.push(text[i++]);
  }
  const n = toks.length;
  if (
    n < 6 ||
    toks[0] !== "string" ||
    toks[1] !== "ECEN_Eval" ||
    toks[2] !== "(" ||
    toks[3] !== ")" ||
    toks[4] !== "{" ||
    toks[n - 1] !== "}"
  )
    return "not one function string ECEN_Eval()";
  for (let k = 0; k < n; k++) {
    const t = toks[k];
    if (!isStart(t.charCodeAt(0))) continue;
    const member = toks[k - 1] === ".";
    const called = toks[k + 1] === "(";
    const b = banned.find((x) => t.includes(x));
    if (b) return `'${t}' holds '${b}'`;
    if (t === "ECEN_Eval") {
      if (k !== 1) return "ECEN_Eval used";
      continue;
    }
    if (member) {
      if (called ? !methodOk(t) : !isConst(t)) return `member '${t}'`;
      continue;
    }
    if (refused.includes(t)) return `'${t}' is refused`;
    if (keywords.includes(t)) {
      if (called && t !== "if" && t !== "return") return `'${t}('`;
      continue;
    }
    if (classes.includes(t)) {
      if (called) return `'${t}('`;
      continue;
    }
    if (isConst(t)) {
      if (called || toks[k + 1] === ".") return `constant '${t}'`;
      continue;
    }
    if (/^[a-z]/.test(t)) {
      if (called) return `'${t}(' calls a function`;
      continue;
    }
    return `'${t}' not listed`;
  }
  return null;
}

describe("evalCompile allow screen (ECEN_ProbeEval.c)", () => {
  it("evalCompile compiles only what ECEN_ProbeEval.Screen passes, and the old deny screen is gone", () => {
    const system = readFileSync(join(PROBE_DIR, "ECEN_ProbeSystem.c"), "utf-8");
    expect(system).not.toMatch(/BannedToken/);
    const screen = system.indexOf("ECEN_ProbeEval.Screen(text, why)");
    const compile = system.indexOf("ScriptModule.CompileScript(parent, text");
    expect(screen).toBeGreaterThan(0);
    expect(compile).toBeGreaterThan(screen);
  });

  it("refuses the review's attack texts: a loop, a dialog opener, a world copy, a write, recursion", () => {
    for (const bad of [
      'string ECEN_Eval() { while (true) {} return ""; }',
      'string ECEN_Eval() { for (int i = 0; i < 1; i--) {} return ""; }',
      'string ECEN_Eval() { WBModuleDef m = Workbench.GetModule(ResourceManager); m.GetPlugin(BakeMLODPlugin).Configure(); return ""; }',
      'string ECEN_Eval() { SCR_WorldFilesHelper.DuplicateWorld("a", "b"); return ""; }',
      'string ECEN_Eval() { ResourceManager rm = Workbench.GetModule(ResourceManager); rm.RegisterResourceFile("x", true); return ""; }',
      'string ECEN_Eval() { ScriptEditor se = Workbench.GetModule(ScriptEditor); se.InsertLine("x"); return ""; }',
      "string ECEN_Eval() { return ECEN_Eval(); }",
      'string ECEN_Eval() { return helper(); } string helper() { return ""; }',
      'string ECEN_Eval() { Foo f = new Foo(); return ""; }',
      'string ECEN_Eval() { WorkbenchPlugin p; p.m_sPath = "x"; return ""; }',
      'string ECEN_Eval() { thread Workbench.GetModule(WorldEditor); return ""; }',
      'string ECEN_Eval() { Workbench.Dialog("a", "b"); return ""; }',
      "string ECEN_Eval() { string s; Workbench.GetUserName(s); return s; }",
      'string ECEN_Eval() { return ""; } // comment',
      'string ECEN_Eval() { return ""; } class X {}',
      '#ifdef X\nstring ECEN_Eval() { return ""; }',
      `string ECEN_Eval() { return "${"x".repeat(2100)}"; }`,
      "int ECEN_Eval() { return 0; }",
    ]) {
      expect(screenModel(bad), bad.slice(0, 80)).not.toBeNull();
    }
  });

  it("passes the read-only texts U5 and later read-only questions need", () => {
    for (const good of [
      'string ECEN_Eval() { return "ok"; }',
      "string ECEN_Eval() { return Workbench.GetCurrentGameProjectFile(); }",
      'string ECEN_Eval() { WorldEditor we = Workbench.GetModule(WorldEditor); if (!we) return "none"; WorldEditorAPI api = we.GetApi(); int n = api.GetNumSubScenes(); return n.ToString(); }',
      "string ECEN_Eval() { array<string> addons = {}; GameProject.GetLoadedAddons(addons); int c = addons.Count(); return c.ToString(); }",
      "string ECEN_Eval() { string t = typename.EnumToString(DataVarType, DataVarType.STRING); return t; }",
    ]) {
      expect(screenModel(good), good).toBeNull();
    }
  });

  it("keeps the lists tight: no loop keyword, allocator or write-capable class is allowed", () => {
    const keywords = listOf(EVAL_FILE, "Keywords");
    const refused = listOf(EVAL_FILE, "RefusedKeywords");
    const classes = listOf(EVAL_FILE, "Classes");
    const methods = listOf(EVAL_FILE, "Methods");
    const banned = listOf(EVAL_FILE, "Banned");
    for (const k of ["while", "for", "foreach", "new", "delete", "thread", "class", "modded"]) {
      expect(refused).toContain(k);
      expect(keywords).not.toContain(k);
    }
    for (const c of [
      "ScriptModule",
      "System",
      "FileIO",
      "FileHandle",
      "SCR_WorldFilesHelper",
      "BaseContainerTools",
      "DiagMenu",
      "Resource",
    ])
      expect(classes).not.toContain(c);
    for (const m of ["Run", "Configure", "Insert", "Set", "Call", "Spawn", "Save"]) {
      expect(methods).not.toContain(m);
      expect(banned.some((b) => m.includes(b))).toBe(true);
    }
    expect(Number(constOf(EVAL_FILE, "MAX_TEXT"))).toBeLessThanOrEqual(4000);
  });
});

// ── Compiled-in guards (source structure; behaviour is settled live) ─────────

/** The body of a static method of a pack file, from its name to its closing brace. */
function bodyOf(file: string, method: string): string {
  const text = readFileSync(file, "utf-8");
  const m = new RegExp(`(?:static|override) [\\w<>]+ ${method}\\(`).exec(text);
  if (!m) throw new Error(`${method} not found in ${file}`);
  let i = text.indexOf("{", m.index);
  let depth = 0;
  const start = i;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) break;
  }
  return text.slice(start, i + 1);
}

/** Asserts that every needle occurs in body, in the given order. */
function inOrder(body: string, needles: string[]): void {
  let at = -1;
  for (const n of needles) {
    const next = body.indexOf(n, at + 1);
    expect(next, `"${n}" after position ${at}`).toBeGreaterThan(at);
    at = next;
  }
}

describe("compiled-in guards of the read-only pack", () => {
  const probe = (f: string) => join(PROBE_DIR, f);

  it("every action except info refuses outside the 2.0 sandbox", () => {
    inOrder(bodyOf(probe("ECEN_Probe.c"), "GetResponse"), [
      'if (req.action != "info")',
      "ECEN_ProbeUtil.SandboxDir(projectDir, why)",
      "return resp;",
      'if (req.action == "info")',
    ]);
  });

  it("screenshot writes a new file under _throwaway/ only", () => {
    inOrder(bodyOf(probe("ECEN_ProbeSystem.c"), "Screenshot"), [
      "ECEN_ProbeUtil.SandboxDir(",
      "ECEN_ProbeUtil.IsThrowawayFolder(folder)",
      "if (!ECEN_ProbeUtil.HasRunNonce(fileName))",
      "return;",
      "FileIO.FileExists(target)",
      "System.MakeScreenshot(target)",
    ]);
    expect(bodyOf(probe("ECEN_ProbeUtil.c"), "IsThrowawayFolder")).toContain(
      'clean.StartsWith(THROWAWAY + "/")',
    );
  });

  it("screenshot refuses a file name without a -<6+ hex> run nonce (the guard does not rest on FileExists)", () => {
    expect(constOf(probe("ECEN_ProbeUtil.c"), "RUN_NONCE_MIN_HEX")).toBe("6");
    inOrder(bodyOf(probe("ECEN_ProbeUtil.c"), "HasRunNonce"), [
      'if (!fileName.EndsWith(".bmp"))',
      'int dash = stem.LastIndexOf("-");',
      "if (dash < 1)",
      "if (nonceLength < RUN_NONCE_MIN_HEX)",
      "if (!digit && !lowerHex && !upperHex)",
      "return true;",
    ]);
    // A model of HasRunNonce: the rule the contract states, on names the harness may send.
    const model = (name: string) => /^.+-[0-9a-fA-F]{6,}\.bmp$/.test(name);
    for (const ok of ["u28-viewport-a1b2c3.bmp", "x-0123456789abcdef.bmp", "a-b-ABCDEF.bmp"])
      expect(model(ok), ok).toBe(true);
    for (const bad of [
      "u28.bmp",
      "u28-a1b2c.bmp",
      "u28-a1b2cg.bmp",
      "-a1b2c3.bmp",
      "u28-a1b2c3.png",
      "u28-a1b2c3-x.bmp",
    ])
      expect(model(bad), bad).toBe(false);
    expect(contractRules("ECEN_Probe").screenshot).toMatch(/<label>-<nonce>\.bmp/);
  });

  it("layerRead refuses a sub-scene out of range and reads a layer path only for a layer id >= 0", () => {
    inOrder(bodyOf(probe("ECEN_ProbeWorld.c"), "LayerRead"), [
      "subScene = current;",
      "if (subScene < 0 || subScene >= subSceneCount)",
      "resp.Fail(",
      "return;",
      "api.GetActiveSubsceneLayer(subScene)",
      "if (currentLayer >= 0)",
      "api.GetSubsceneLayerPath(subScene, currentLayer)",
      "api.GetSubsceneFolders(subScene, items)",
    ]);
    expect(contractRules("ECEN_Probe").layerRead).toMatch(/GetNumSubScenes/);
  });

  it("terrainFacts accepts terrain 0 only and calls no terrain getter without terrain bounds", () => {
    const body = bodyOf(probe("ECEN_ProbeWorld.c"), "TerrainFacts");
    inOrder(body, [
      "if (terrainIndex != 0)",
      "resp.Fail(",
      "return;",
      "worldEditor.GetTerrainBounds(boundsMin, boundsMax)",
      "if (!hasBounds)",
      "return;",
      "api.GetTerrainResolutionX(terrainIndex)",
    ]);
    expect(body.indexOf("GetTerrainResolutionX")).toBe(body.lastIndexOf("GetTerrainResolutionX"));
    expect(contractRules("ECEN_Probe").terrainFacts).toMatch(/must be 0/);
  });

  it("loadContainer refuses a world file (.ent) before it loads anything", () => {
    inOrder(bodyOf(probe("ECEN_ProbeContainers.c"), "LoadContainer"), [
      'resp.Fact("path", ECEN_ProbeUtil.ShowPath(req.path))',
      "lowerPath.ToLower();",
      'if (lowerPath.EndsWith(".ent"))',
      "resp.Fail(",
      "return;",
      "BaseContainerTools.LoadContainer(resourceName)",
    ]);
    expect(contractRules("ECEN_Probe").loadContainer).toMatch(/\.ent/);
  });

  it("a page index is clamped to the last page before it is multiplied", () => {
    inOrder(bodyOf(probe("ECEN_ProbeUtil.c"), "PageInto"), [
      "if (wanted > pages - 1)",
      "wanted = pages - 1;",
      "int first = wanted * PAGE_ROWS;",
    ]);
  });

  it("moduleMatrix opens only the one module moduleName names", () => {
    const body = bodyOf(probe("ECEN_ProbeModules.c"), "ModuleMatrix");
    expect(body).toContain("if (!wbModule && req.openModules && moduleName == req.moduleName)");
    expect(body.match(/Workbench\.OpenModule\(/g)).toHaveLength(1);
  });

  it("diagRead reads an engine option only from the compiled-in list, a script option only by name", () => {
    const body = bodyOf(probe("ECEN_ProbeSystem.c"), "DiagRead");
    inOrder(body, ["if (!EngineDiagListed(id))", "DiagMenu.GetEngineValue(id)"]);
    expect(body).toContain("never by a raw diagId");
  });

  it("executeAction refuses a segment holding a deny label or a refused word", () => {
    const body = bodyOf(probe("ECEN_ProbeUtil.c"), "DeniedSegment");
    expect(body).toContain("ECEN_ProbeAllowList.DenyLabels(denied)");
    expect(body).toContain("ECEN_ProbeAllowList.DenyWords(refusedWords)");
    expect(body).toContain("padded.Contains(run)");
  });

  it("paths leave the read-only pack through ShowPath", () => {
    for (const [file, keys] of [
      ["ECEN_ProbeSystem.c", ["projectFile", "executable", "cwd", "errorText", "result"]],
      ["ECEN_ProbeWorld.c", ["worldPath", "activeLayer", "currentEntityLayerPath"]],
      ["ECEN_ProbeContainers.c", ["path", "name"]],
    ] as const) {
      const text = readFileSync(probe(file), "utf-8");
      for (const k of keys)
        expect(text, `${file} ${k}`).toMatch(
          new RegExp(`resp\\.Fact\\("${k}", ECEN_ProbeUtil\\.ShowPath\\(`),
        );
    }
    // The home markers are found case-insensitively: lower-case markers in a lower-cased copy.
    const scrub = bodyOf(probe("ECEN_ProbeUtil.c"), "ScrubHome");
    expect(scrub).toContain('{":/users/", ":\\\\users\\\\"}');
    expect(scrub).not.toContain(":/Users/");
    inOrder(scrub, [
      "lower.ToLower();",
      "lower.IndexOf(marker)",
      "lower.ToLower();",
      "lower.IndexOf(marker)",
    ]);
  });
});

describe("authProbe (ECEN_ProbeAuth.c, S-F B2) and the Particle Editor refusal (B1)", () => {
  const auth = join(PROBE_DIR, "ECEN_ProbeAuth.c");
  const quoted = (body: string) => [...body.matchAll(/Insert\("([^"]*)"\)/g)].map((m) => m[1]);

  it("ParticleEditor is in no ModuleNames entry and no ModuleType branch", () => {
    const util = join(PROBE_DIR, "ECEN_ProbeUtil.c");
    expect(bodyOf(util, "ModuleNames")).not.toContain("ParticleEditor");
    expect(quoted(bodyOf(util, "ModuleNames"))).toHaveLength(10);
    expect(bodyOf(util, "ModuleType")).not.toContain("ParticleEditor");
  });

  it("is dispatched after the sandbox check, and its request keys are in the contract", () => {
    inOrder(bodyOf(join(PROBE_DIR, "ECEN_Probe.c"), "GetResponse"), [
      "ECEN_ProbeUtil.SandboxDir(projectDir, why)",
      'if (req.action == "authProbe")',
      "ECEN_ProbeAuth.AuthProbe(req, resp);",
    ]);
    expect(contract("ECEN_Probe").request).toEqual(
      expect.arrayContaining(["authMethod", "authRoot", "authVariant"]),
    );
    expect(contractRules("ECEN_Probe").authProbe).toMatch(/exactly five/);
  });

  it("the method and root lists are exactly the closed lists, checked before any API call", () => {
    expect(quoted(bodyOf(auth, "Methods"))).toEqual([
      "FileExists",
      "OpenFile",
      "FindFiles",
      "SearchResources",
    ]);
    expect(bodyOf(auth, "Roots")).toMatch(/outRoots\.Insert\(AUTH_ROOT_SANDBOX\);\s*\}$/);
    expect(constOf(auth, "AUTH_ROOT_SANDBOX")).toBe('"$EMCP2_sandbox:"');
    const body = bodyOf(auth, "AuthProbe");
    const firstCall = body.search(/FileIO\.|Workbench\./);
    for (const guard of [
      "if (!methods.Contains(method))",
      "if (!roots.Contains(root))",
      'if (variant != "a" && variant != "b")',
      'if (variant == "b" && method != "FindFiles")',
    ])
      expect(body.indexOf(guard), guard).toBeLessThan(firstCall);
    expect(body.match(/FileIO\.FindFiles\(/g)).toHaveLength(2);
  });

  it("calls only the four calls plus Close; OpenFile reads an existing file and closes it", () => {
    const toks = lex(readFileSync(auth, "utf-8")).toks;
    const called = new Set(
      toks
        .filter((t, i) => t.k === "id" && toks[i + 1]?.t === "(" && toks[i - 1]?.t === ".")
        .map((t) => t.t),
    );
    expect([...called].sort()).toEqual(
      // the four calls, Close, and list, response and string helpers
      [
        "Clear",
        "Insert",
        "Close",
        "Contains",
        "FileExists",
        "FindFiles",
        "Fail",
        "Fact",
        "Ok",
        "OpenFile",
        "SearchResources",
        "ToString",
      ].sort(),
    );
    const ids = toks.filter((t) => t.k === "id").map((t) => t.t);
    for (const bad of [
      "MakeDirectory",
      "DeleteFile",
      "CopyFile",
      "RunCmd",
      "RunProcess",
      "GetUserName",
      "MakeScreenshot",
    ])
      expect(ids, bad).not.toContain(bad);
    expect(ids.filter((t) => /clipboard/i.test(t) || /^(Write|Read)/.test(t))).toEqual([]);
    inOrder(bodyOf(auth, "AuthProbe"), [
      // F-P2: FileExists tests the sandbox's .gproj, never the bare root (a directory).
      "returned = FileIO.FileExists(root + AUTH_OPEN_FILE);",
      "if (FileIO.FileExists(openTarget))",
      "FileIO.OpenFile(openTarget, FileMode.READ)",
      "handle.Close();",
    ]);
    expect(bodyOf(auth, "CountFile").trim()).toMatch(/^\{\s*s_iCalls\+\+;\s*\}$/);
    expect(bodyOf(auth, "CountResource").trim()).toMatch(/^\{\s*s_iCalls\+\+;\s*\}$/);
  });

  it("the response facts are exactly the five", () => {
    const facts = [...readFileSync(auth, "utf-8").matchAll(/resp\.Fact\("(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(facts).toEqual(["method", "root", "variant", "returned", "count"]);
  });

  it("live_lane.uia_menu holds the eight menu-bar titles, never System, and depth at most 1", () => {
    const lane = (loadPolicy() as unknown as { live_lane: Record<string, unknown> }).live_lane;
    const menu = lane.uia_menu as Record<string, unknown>;
    expect(
      Object.keys(menu)
        .filter((k) => !k.startsWith("$comment"))
        .sort(),
    ).toEqual(
      [
        "calls",
        "maxDepth",
        "maxMenus",
        "perMenuMs",
        "titles",
        "titles_by_module",
        "totalMs",
      ].sort(),
    );
    // Phase 4 (D11): the World Editor holds its nine titles, the Resource Manager today's eight.
    const byModule = menu.titles_by_module as Record<string, string[]>;
    expect(byModule.WorldEditor).toEqual([
      "File",
      "Edit",
      "View",
      "Game",
      "Tools",
      "Window",
      "Plugins",
      "Entities",
      "Help",
    ]);
    expect(byModule.ResourceManager).toEqual(menu.titles);
    for (const list of Object.values(byModule)) expect(list).not.toContain("System");
    expect(menu.titles).toEqual([
      "File",
      "Editors",
      "View",
      "Edit",
      "Window",
      "Utilities",
      "Plugins",
      "Help",
    ]);
    expect(menu.titles).not.toContain("System");
    expect(menu.calls).toEqual(["Expand", "Collapse"]);
    expect(menu.maxDepth as number).toBeLessThanOrEqual(1);
    expect(menu.maxMenus).toBe((menu.titles as string[]).length);
    for (const k of ["perMenuMs", "totalMs"]) expect(menu[k] as number, k).toBeGreaterThan(0);
    expect(menu.totalMs as number).toBeGreaterThanOrEqual(
      (menu.perMenuMs as number) * (menu.maxMenus as number),
    );
  });

  it("the policy lists the U31 entry and the generated list carries it", () => {
    const policy = loadPolicy() as unknown as { execute_action: { allow_list: string[][] } };
    expect(policy.execute_action.allow_list).toContainEqual(["Utilities", "Qt Introspection Tool"]);
    expect(readFileSync(join(PROBE_DIR, "ECEN_ProbeAllowList.c"), "utf-8")).toContain(
      'outPaths.Insert("Utilities\\nQt Introspection Tool");',
    );
  });
});

describe("compiled-in guards of the mutating pack", () => {
  const mut = (f: string) => join(MUT_DIR, f);

  it("containerWriteTest never saves, never switches the World Editor, and writes only a sandbox container", () => {
    const body = bodyOf(mut("ECEN_ProbeMutActions.c"), "ContainerWriteTest");
    // No Save() call in code (the refusal message names WBModuleDef.Save() in a string).
    const code = lex(body).toks.filter((t) => t.k !== "str");
    expect(code.some((t, i) => t.t === "Save" && code[i + 1]?.t === "(")).toBe(false);
    inOrder(body, [
      "if (req.moduleSave)",
      'if (req.moduleName == "WorldEditor")',
      "wbModule.SetOpenedResource(relative)",
      "wbModule.SetOpenedResource(absolute)",
      'resp.Fact("pathForm", pathForm)',
      "cont.GetSourceAddons(sourceAddons)",
      "sourceAddons.Get(0) != ECEN_ProbeMutGuard.SANDBOX_FOLDER",
      "WriteFromText(",
    ]);
  });

  it("saveContainer passes an empty resource name and the absolute target, the vanilla form", () => {
    const body = bodyOf(mut("ECEN_ProbeMutActions.c"), "SaveContainerCopy");
    inOrder(body, [
      'ResourceName noResourceName = "";',
      "BaseContainerTools.SaveContainer(cont, noResourceName, absolute)",
    ]);
  });

  it("the world guard refuses a world with more than one sub-scene", () => {
    inOrder(bodyOf(mut("ECEN_ProbeMutGuard.c"), "ThrowawayWorld"), [
      "OpenWorldIs(api, absolute, why)",
      "api.GetNumSubScenes()",
      "if (subScenes != 1)",
    ]);
  });

  it("layerCreateThrowaway stays in the world's own sub-scene and saves only a new item", () => {
    const body = bodyOf(mut("ECEN_ProbeMutWorld.c"), "LayerCreateThrowaway");
    inOrder(body, [
      "if (subScene != current)",
      'if (parentPath != "" && !Holds(before, parentPath))',
      "api.CreateSubsceneLayer(subScene, name, parentPath)",
      "if (!createdIsNewItem)",
      "SaveIfAsked(req, resp)",
    ]);
    expect(body).not.toContain("req.parentPath)");
  });

  it("a terrain write runs only after BeginTerrainAction returned true; the brush mode fails by name", () => {
    inOrder(bodyOf(mut("ECEN_ProbeMutWorld.c"), "WriteTile"), [
      "api.BeginTerrainAction(",
      "if (!began)",
      "return;",
      "api.SetTerrainSurfaceTile(",
      "api.EndTerrainAction(",
    ]);
    // Build 1.9.0.37 removed ModifyHeightMap and its brush types: the mode checks its ranges and fails.
    const modify = bodyOf(mut("ECEN_ProbeMutWorld.c"), "ModifyAt");
    inOrder(modify, ["if (inner < 0 || inner > 100)", 'resp.Fail("mode modify:']);
    expect(modify).not.toMatch(/api\.\w+\(/);
    expect(mut("ECEN_ProbeMutWorld.c")).not.toMatch(/TerrainToolType|TerrainToolDesc|FilterMorph/);
  });

  it("createSandboxWorlds writes only well-formed prefab names and tolerates a missing list", () => {
    inOrder(bodyOf(mut("ECEN_ProbeMutActions.c"), "CreateSandboxWorlds"), [
      "array<string> requested = req.terrainEntities;",
      "if (requested)",
      "ECEN_ProbeMutGuard.IsPrefabName(entry)",
      "SCR_WorldFilesHelper.CreateWorld(",
    ]);
    const isPrefab = bodyOf(mut("ECEN_ProbeMutGuard.c"), "IsPrefabName");
    expect(isPrefab).toContain('s.Get(0) != "{"');
    expect(isPrefab).toContain('s.Get(17) != "}"');
    // Quote (34), backslash (92) and control characters are not in the accepted set.
    expect(isPrefab).not.toMatch(/code == (34|92)\b/);
  });
});

// ── Linter and contracts (skipped without the build's source index) ──────────

const BUILD = (
  JSON.parse(readFileSync(join(REPO_ROOT, "data", "census", "current-build.json"), "utf-8")) as {
    tag: string;
  }
).tag;
let index: SourceIndex | undefined;
try {
  index = loadSourceIndex(BUILD);
} catch {
  index = undefined;
}
if (!index) {
  console.log(
    `probe-pack: linter and contract checks SKIPPED: no E02 source index for build ${BUILD} ` +
      `(expected at <artifacts>/census/${BUILD}/E02/${SOURCE_INDEX_FILE}; the E02 enumerator builds it from the game paks)`,
  );
}

describe.skipIf(!index)(`enforce-lint over the probe packs (source index ${BUILD})`, () => {
  for (const [label, dir, fn] of [
    ["read-only pack", PROBE_DIR, "ECEN_Probe"],
    ["mutating pack", MUT_DIR, "ECEN_ProbeMut"],
  ] as const) {
    it(`${label}: no level-1 failure, no parse error, contract keys match`, () => {
      const report = lintEnforceFiles(index!, inputs(dir), {
        contracts: contracts(),
        contractsLabel: "mod-dev/contracts",
      });
      const unresolved = report.files.flatMap((f) =>
        f.unresolved.map((u) => `${f.file}:${u.line} ${u.method}`),
      );
      console.log(
        `probe-pack ${label}: files ${report.totals.files}, calls ${report.totals.calls}, resolved ${report.totals.resolved}, ` +
          `unresolved receivers ${report.totals.unresolved}${unresolved.length ? ` (${unresolved.join("; ")})` : ""}`,
      );
      expect(report.files.flatMap((f) => f.failures)).toEqual([]);
      expect(report.totals.parse_errors).toBe(0);
      expect(lintPassed(report)).toBe(true);

      const keys = handlerKeysOf(index!, inputs(dir));
      expect(keys.map((k) => k.handler)).toEqual([fn]);
      const c = contract(fn);
      expect([...keys[0].request_keys].sort()).toEqual([...(c.request ?? [])].sort());
      expect([...keys[0].response_keys].sort()).toEqual([...(c.response ?? [])].sort());
    }, 120_000);

    it(`${label}: compiles beside the shipped set alone (no class collision, no failure)`, () => {
      const report = lintEnforceFiles(index!, [...inputs(SHIPPED_DIR), ...inputs(dir)]);
      expect(report.files.flatMap((f) => f.failures)).toEqual([]);
      expect(lintPassed(report)).toBe(true);
    }, 120_000);
  }

  it("the linter would catch a class declared twice (the collision check above can fail)", () => {
    const planted: LintInput = {
      path: "planted/ECEN_ProbeDup.c",
      text: "class ECEN_ProbeUtil\n{\n}\n",
    };
    const report = lintEnforceFiles(index!, [...inputs(PROBE_DIR), planted]);
    expect(lintPassed(report)).toBe(false);
  }, 120_000);
});

describe("contracts and README", () => {
  it("one contract file per NET API function of the packs, and the README exists", () => {
    expect(readdirSync(CONTRACTS_DIR).sort()).toEqual(["ECEN_Probe.json", "ECEN_ProbeMut.json"]);
    for (const name of ["ECEN_Probe", "ECEN_ProbeMut"]) {
      const c = contract(name);
      expect(Array.isArray(c.request) && Array.isArray(c.response)).toBe(true);
    }
    expect(existsSync(join(REPO_ROOT, "mod-dev", "README.md"))).toBe(true);
  });
});
