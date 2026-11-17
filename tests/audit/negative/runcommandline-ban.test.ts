/**
 * Live-safety audit (PLAN section 11 criterion 8), negative tests: the RunCommandline ban.
 *
 * The ban has three layers. The dry-run checker refuses a planned net call to RunCommandline
 * (tests/live-harness/dry-run.test.ts), wb_plugin refuses the entry point by name
 * (tests/tools/wb-plugin.test.ts), and the Enforce lint's deny key fails a handler that calls it
 * (scripts/enforce-lint.ts DENY_KEYS). The per-handler contract tests only show that each clean
 * handler has no deny finding; none planted a call to prove that the deny key fires. These cases
 * do, and then sweep every shipped handler under mod/.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { DENY_KEYS, denyFindings } from "../../../scripts/enforce-lint.js";
import { REPO_ROOT } from "../../../scripts/live/paths.js";
import { validateRegistryKey } from "../../../scripts/live/preflight.js";

const SHIPPED = "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Planted.c";
const DEV = "mod-dev/probe/ECEN_Planted.c";

const planted = (body: string): string =>
  ["class EMCP_WB_Planted", "{", "\tvoid Run(WorkbenchPlugin p)", "\t{", body, "\t}", "}", ""].join(
    "\n",
  );

const runCmd = (path: string, text: string) =>
  denyFindings({ path, text }).filter((f) => f.subject === "RunCommandline");

function cFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cFiles(p));
    else if (name.endsWith(".c")) out.push(p);
  }
  return out;
}

describe("RunCommandline deny key (criterion 8: RunCommandline ban)", () => {
  it("is one of the lint's deny keys", () => {
    expect(DENY_KEYS.map((d) => d.key)).toContain("RunCommandline");
  });

  it("fails a planted call in a shipped handler, at its line", () => {
    const f = runCmd(SHIPPED, planted("\t\tp.RunCommandline();"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "fail", kind: "deny", line: 5 });
  });

  it("fails the call through any receiver and with whitespace before the parenthesis", () => {
    const f = runCmd(
      SHIPPED,
      planted("\t\tWorkbenchPlugin q = p;\n\t\tq.RunCommandline ();\n\t\tRunCommandline();"),
    );
    expect(f.map((x) => x.level)).toEqual(["fail", "fail"]);
  });

  it("only warns in the development-only probe pack (mod-dev), and is not lifted for mod/", () => {
    expect(runCmd(DEV, planted("\t\tp.RunCommandline();")).map((x) => x.level)).toEqual(["warn"]);
  });

  it("ignores a mention in a comment or a string, so a refusal message stays legal", () => {
    const text = planted(
      '\t\t// never p.RunCommandline();\n\t\tstring s = "RunCommandline() is never called";',
    );
    expect(runCmd(SHIPPED, text)).toEqual([]);
  });

  it("finds no deny-key failure in any shipped handler under mod/", () => {
    const files = cFiles(join(REPO_ROOT, "mod"));
    expect(files.length).toBeGreaterThan(40);
    const fails = files.flatMap((p) =>
      denyFindings({
        path: relative(REPO_ROOT, p).replace(/\\/g, "/"),
        text: readFileSync(p, "utf-8"),
      }).filter((f) => f.level === "fail"),
    );
    expect(fails).toEqual([]);
  });
});

// ── Registry: never written ──────────────────────────────────────────────────

/** Every `exec|spawn|execFile*("reg"|"reg.exe", ["<verb>", ...])` call site in a TS file. */
function regVerbs(text: string): string[] {
  const re = /\b(?:exec|spawn|execFile|execFileSync|spawnSync)\s*\(\s*["'`]reg(?:\.exe)?["'`]\s*,\s*\[\s*["'`]([A-Za-z]+)["'`]/g;
  return [...text.matchAll(re)].map((m) => m[1]!.toLowerCase());
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("registry writes are refused (criterion 8 / plan 5.3 post-flight step 3, 5.7)", () => {
  it("the scanner sees a planted import, add or delete as a verb", () => {
    expect(
      regVerbs(
        'deps.exec("reg", ["import", f]); spawn(\'reg.exe\', ["add", k]); execFileSync("reg", ["DELETE", k]);',
      ),
    ).toEqual(["import", "add", "delete"]);
  });

  it("every reg call in src/, scripts/ and tests/live/ is an export (no write path exists)", () => {
    const roots = ["src", "scripts", join("tests", "live")].map((r) => join(REPO_ROOT, r));
    const sites = roots
      .flatMap(tsFiles)
      .flatMap((p) => regVerbs(readFileSync(p, "utf-8")).map((v) => [relative(REPO_ROOT, p), v]));
    // The three known read sites: wb_settings' export, pre-flight step 5, post-flight step 3.
    expect(sites.length).toBeGreaterThanOrEqual(3);
    expect(sites.filter(([, v]) => v !== "export")).toEqual([]);
  });

  it("pre-flight exports only a per-user key: HKLM, a bare hive and a quoted key are refused", () => {
    for (const k of [
      String.raw`HKLM\Software\Bohemia Interactive\Arma Reforger Workbench`,
      String.raw`HKEY_LOCAL_MACHINE\Software\X`,
      "HKCU",
      String.raw`HKCU\Software\X" /f`,
      String.raw`HKU\S-1-5-18\Software`,
    ])
      expect(() => validateRegistryKey(k), k).toThrow(/outside HKCU/);
    const ok = String.raw`HKCU\Software\Bohemia Interactive\Arma Reforger Workbench`;
    expect(validateRegistryKey(ok)).toBe(ok);
  });
});
