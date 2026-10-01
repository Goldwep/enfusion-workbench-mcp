import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  GENERIC_PATTERNS,
  applyAllowList,
  formatFinding,
  loadPatterns,
  maskMatch,
  parseOwnerPatterns,
  resolvePatternsPath,
  scanText,
} from "../../scripts/pii-gate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(ROOT, "scripts", "pii-gate.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

// Planted values are assembled at run time so this source file never holds one.
const PLANTED_NAME = "zq" + "plantedowner";
const PLANTED_PATH = ["C:", "Users", PLANTED_NAME, "Documents"].join("\\");
const PLANTED_EMAIL = PLANTED_NAME + "@" + "mailhost.co";
const PLANTED_STEAM = "7656" + "1198123456789";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "emcp-pii-"));
}

/** Writes a fixture file at test time (never committed) and returns its path. */
function fixture(dir: string, name: string, text: string | Buffer): string {
  const p = join(dir, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

function runGate(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, ["--import", TSX, SCRIPT, ...args], {
    cwd,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf-8",
  });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scanText", () => {
  it("finds a planted home path in a generated fixture, with line and column", () => {
    const text = ["first line", `see ${PLANTED_PATH}\\file.txt`, "last"].join("\n");
    const f = scanText(text, GENERIC_PATTERNS);
    expect(f).toHaveLength(1);
    expect(f[0].pattern).toBe("windows-home-path");
    expect(f[0].line).toBe(2);
    expect(f[0].column).toBe(5);
    expect(f[0].match).toBe(["C:", "Users", PLANTED_NAME].join("\\"));
  });

  it("finds the forward-slash, doubled-backslash and Git Bash forms", () => {
    const forms = [
      ["C:", "Users", PLANTED_NAME].join("/"),
      ["D:", "", "users", "", PLANTED_NAME].join("\\"),
      ["", "c", "Users", PLANTED_NAME].join("/"),
    ];
    for (const form of forms) {
      const f = scanText(`"${form}/x"`, GENERIC_PATTERNS);
      expect(f.map((x) => x.pattern)).toEqual(["windows-home-path"]);
    }
  });

  it("ignores placeholder profile names", () => {
    const names = [
      "<you>",
      "<user>",
      "<owner>",
      "<name>",
      "%USERPROFILE%",
      "$env:USERPROFILE",
      "~",
      "&lt;username&gt;",
      "...",
      "Public",
    ];
    for (const n of names) {
      expect(scanText(["C:", "Users", n, "AppData"].join("\\"), GENERIC_PATTERNS)).toEqual([]);
      expect(scanText(["C:", "Users", n, "AppData"].join("/"), GENERIC_PATTERNS)).toEqual([]);
    }
  });

  it("finds Steam64 ids and e-mail addresses", () => {
    const f = scanText(`id ${PLANTED_STEAM} mail ${PLANTED_EMAIL}`, GENERIC_PATTERNS);
    expect(f.map((x) => x.pattern)).toEqual(["steam64-id", "email"]);
  });

  it("ignores longer digit runs and documentation-domain addresses", () => {
    const text = `1${PLANTED_STEAM} ${PLANTED_NAME}@example.com x@y.invalid`;
    expect(scanText(text, GENERIC_PATTERNS)).toEqual([]);
  });

  it("matches owner literals case-insensitively", () => {
    const owner = parseOwnerPatterns(`# comment\n\n${PLANTED_NAME}\n`);
    const f = scanText(`Path: ${PLANTED_NAME.toUpperCase()}/x`, owner);
    expect(f).toHaveLength(1);
    expect(f[0].pattern).toBe("owner-pattern#3");
  });
});

describe("maskMatch", () => {
  it("keeps only the first and last character", () => {
    expect(maskMatch(PLANTED_PATH)).toBe("C***s");
    expect(maskMatch("ab")).toBe("**");
  });

  it("formats a finding without the full matched text", () => {
    const [f] = scanText(PLANTED_PATH, GENERIC_PATTERNS);
    const line = formatFinding("docs/x.md", f);
    expect(line).toBe(`docs/x.md:1: windows-home-path: C***${PLANTED_NAME.slice(-1)}`);
    expect(line).not.toContain(PLANTED_NAME);
  });
});

describe("applyAllowList", () => {
  const findings = scanText(PLANTED_PATH, GENERIC_PATTERNS);
  const exact = ["C:", "Users", PLANTED_NAME].join("\\");

  it("allows a finding listed with its path and exact string", () => {
    const r = applyAllowList("docs/a.md", findings, [{ path: "docs/a.md", string: exact }]);
    expect(r.kept).toEqual([]);
    expect(r.allowed).toHaveLength(1);
  });

  it("keeps a finding listed for another path or another string", () => {
    expect(
      applyAllowList("docs/a.md", findings, [{ path: "docs/b.md", string: exact }]).kept,
    ).toHaveLength(1);
    expect(
      applyAllowList("docs/a.md", findings, [{ path: "docs/a.md", string: exact + "x" }]).kept,
    ).toHaveLength(1);
  });

  it("allows every listed string inside the allow-list file itself", () => {
    const r = applyAllowList(
      "scripts/pii-allow.json",
      findings,
      [{ path: "docs/elsewhere.md", string: exact }],
      "scripts/pii-allow.json",
    );
    expect(r.kept).toEqual([]);
  });

  it("allows the JSON-escaped form of a listed string inside the allow-list file", () => {
    const escaped = JSON.stringify(exact).slice(1, -1);
    const inFile = scanText(`"string": "${escaped}"`, GENERIC_PATTERNS);
    expect(inFile).toHaveLength(1);
    const r = applyAllowList(
      "scripts/pii-allow.json",
      inFile,
      [{ path: "docs/elsewhere.md", string: exact }],
      "scripts/pii-allow.json",
    );
    expect(r.kept).toEqual([]);
  });
});

describe("loadPatterns", () => {
  it("is a configuration error when the owner file is missing and CI is unset", () => {
    const missing = join(scratch(), "absent", "pii-patterns.txt");
    expect(() => loadPatterns({ env: { ENFUSION_PII_PATTERNS: missing } })).toThrow(missing);
  });

  it("treats CI=false as unset", () => {
    const missing = join(scratch(), "pii-patterns.txt");
    expect(() => loadPatterns({ env: { ENFUSION_PII_PATTERNS: missing, CI: "false" } })).toThrow(
      "not found",
    );
  });

  it("runs generic-only under CI when the owner file is missing, and says so", () => {
    const missing = join(scratch(), "pii-patterns.txt");
    const r = loadPatterns({ env: { ENFUSION_PII_PATTERNS: missing, CI: "1" } });
    expect(r.ownerCount).toBe(0);
    expect(r.patterns.map((p) => p.name)).toEqual(GENERIC_PATTERNS.map((p) => p.name));
    expect(r.notice).toContain("generic patterns only");
  });

  it("refuses an owner file that holds no pattern unless CI is set", () => {
    const f = fixture(scratch(), "pii-patterns.txt", "# only a comment\n\n");
    expect(() => loadPatterns({ env: { ENFUSION_PII_PATTERNS: f } })).toThrow("no pattern");
    expect(loadPatterns({ env: { ENFUSION_PII_PATTERNS: f, CI: "true" } }).ownerCount).toBe(0);
  });

  it("loads literals and re: expressions after the generic patterns", () => {
    const f = fixture(scratch(), "pii-patterns.txt", `${PLANTED_NAME}\nre:secret-\\d+\n`);
    const r = loadPatterns({ env: { ENFUSION_PII_PATTERNS: f } });
    expect(r.ownerCount).toBe(2);
    expect(scanText("x SECRET-42 y", r.patterns).map((x) => x.pattern)).toEqual([
      "owner-pattern#2",
    ]);
  });

  it("rejects an invalid expression without echoing it", () => {
    const f = fixture(scratch(), "pii-patterns.txt", `re:${PLANTED_NAME}(\n`);
    try {
      loadPatterns({ env: { ENFUSION_PII_PATTERNS: f } });
      expect.unreachable();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toContain("line 1");
      expect(msg).not.toContain(PLANTED_NAME);
    }
  });
});

describe("resolvePatternsPath", () => {
  it("prefers ENFUSION_PII_PATTERNS", () => {
    expect(resolvePatternsPath({ env: { ENFUSION_PII_PATTERNS: "/x/p.txt" } })).toBe("/x/p.txt");
  });

  it("uses LOCALAPPDATA on win32", () => {
    const p = resolvePatternsPath({
      env: { LOCALAPPDATA: "Z:\\Local" },
      platform: "win32",
      home: "Z:\\home",
    });
    expect(p).toBe("Z:\\Local\\enfusion-mcp\\pii-patterns.txt");
  });

  it("uses XDG_CONFIG_HOME, then ~/.config, elsewhere", () => {
    expect(
      resolvePatternsPath({ env: { XDG_CONFIG_HOME: "/cfg" }, platform: "linux", home: "/h" }),
    ).toBe(join("/cfg", "enfusion-mcp", "pii-patterns.txt"));
    expect(resolvePatternsPath({ env: {}, platform: "linux", home: "/h" })).toBe(
      join("/h", ".config", "enfusion-mcp", "pii-patterns.txt"),
    );
  });
});

describe("pii-gate CLI", () => {
  it("exits 2 and names the looked-for path when the owner file is missing without CI", () => {
    const dir = scratch();
    fixture(dir, "a.md", "clean\n");
    const missing = join(dir, "nowhere", "pii-patterns.txt");
    const r = runGate(["--files", "a.md"], dir, { ENFUSION_PII_PATTERNS: missing });
    expect(r.code).toBe(2);
    expect(r.out).toContain(missing);
  });

  it("exits 1 on a planted path and prints it masked", () => {
    const dir = scratch();
    fixture(dir, "notes/a.md", `ok\nhome is ${PLANTED_PATH}\n`);
    const r = runGate(["--files", "notes/a.md"], dir, {
      CI: "1",
      ENFUSION_PII_PATTERNS: join(dir, "missing.txt"),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("notes/a.md:2: windows-home-path: C***");
    expect(r.out).toContain("generic patterns only");
    expect(r.out).not.toContain(PLANTED_NAME);
  });

  it("finds owner patterns and never prints their text", () => {
    const dir = scratch();
    const owner = fixture(dir, "cfg/pii-patterns.txt", `${PLANTED_NAME}\n`);
    fixture(dir, "a.md", `project ${PLANTED_NAME} here\n`);
    const r = runGate(["--files", "a.md"], dir, { ENFUSION_PII_PATTERNS: owner });
    expect(r.code).toBe(1);
    expect(r.out).toContain("a.md:1: owner-pattern#1:");
    expect(r.out).not.toContain(PLANTED_NAME);
  });

  it("exits 0 when the planted match is allow-listed", () => {
    const dir = scratch();
    fixture(dir, "notes/a.md", `${PLANTED_PATH}\n`);
    const allow = fixture(
      dir,
      "allow.json",
      JSON.stringify({
        entries: [{ path: "notes/a.md", string: ["C:", "Users", PLANTED_NAME].join("\\") }],
      }),
    );
    const r = runGate(["--files", "notes/a.md", "--allow", allow], dir, {
      CI: "1",
      ENFUSION_PII_PATTERNS: join(dir, "missing.txt"),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 findings, 1 allow-listed");
  });

  it("walks a non-git tree, skipping node_modules, binaries and oversize files", () => {
    const dir = scratch();
    fixture(dir, "node_modules/pkg/a.md", PLANTED_PATH);
    fixture(dir, "dist/a.md", PLANTED_PATH);
    fixture(dir, "bin.dat", Buffer.concat([Buffer.from([0]), Buffer.from(PLANTED_PATH)]));
    fixture(dir, "big.txt", "x".repeat(5 * 1024 * 1024 + 1) + PLANTED_PATH);
    fixture(dir, "src/ok.ts", "export const a = 1;\n");
    const r = runGate(["--tree", "."], dir, {
      CI: "1",
      ENFUSION_PII_PATTERNS: join(dir, "missing.txt"),
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("bin.dat: skipped (binary)");
    expect(r.out).toContain("big.txt: skipped (over 5242880 bytes)");
    expect(r.out).not.toContain("node_modules");
    expect(r.out).toContain("1 file scanned, 0 findings");
  });

  it("exits 2 on bad usage", () => {
    const r = runGate(["--bogus"], scratch(), { CI: "1" });
    expect(r.code).toBe(2);
  });
});
