import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  materializeExport,
  parseScanArgs,
  scanPath,
  scanText,
  scanTree,
  DEFAULT_AUTHORED_ROOTS,
  type Finding,
} from "../../scripts/audit/export-scan.js";

// Every planted value is assembled at run time, so this file itself scans clean when exported.
const BS = "\\";
const HOME = ["C:", "Users", "zq" + "plantedowner", "Documents"].join(BS);
const OWNER = "Zq" + "plantedowner";
const MAIL = "zq.planted" + "@" + "mail-host.net";
const STEAM = "7656" + "1198" + "123456789";
const SID = ["S", "1", "5", "21", "1111111111", "2222222222", "3333333333", "1001"].join("-");
const REG_DUMP =
  "[" + "HKEY_" + "CURRENT_USER" + BS + "Software" + BS + "Vendor]\r\n" + '"Recent"="x"\r\n';
const EXE_QUOTE = '{"enumerator":"E05","quote":"-addonsDir","ref":"' + "exe" + ':0x2c28e30"}';
const RTTI = "." + "?AV" + "QMainWindow@@";
const TOKEN = "gh" + "p_" + "A".repeat(36);
const KEY_HEADER = "-----BEGIN " + "PRIVATE" + " KEY-----";

const rules = (fs: Finding[]): string[] => fs.map((f) => f.rule).sort();

describe("scanText", () => {
  it("reports a home path with a concrete account name, with line and column", () => {
    const fs = scanText("a.md", `first line\nsee ${HOME}\\x.txt here\n`);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ rule: "user-path", file: "a.md", line: 2, column: 5 });
  });

  it("reports a JSON-escaped home path and a forward-slash one", () => {
    const escaped = JSON.stringify({ p: HOME });
    const fwd = HOME.split(BS).join("/");
    expect(rules(scanText("a.json", escaped))).toEqual(["user-path"]);
    expect(rules(scanText("a.ts", `"${fwd}"`))).toEqual(["user-path"]);
  });

  it("leaves placeholder home paths alone", () => {
    const text = [
      ["C:", "Users", "<user>", "x"].join(BS),
      ["C:", "Users", "%USERNAME%", "x"].join(BS),
      ["C:", "Users", "you", "x"].join(BS),
      ["C:", "Users", "Public", "x"].join(BS),
      "%USERPROFILE%" + BS + "Documents",
      "/home/<user>/x",
    ].join("\n");
    expect(scanText("a.md", text)).toEqual([]);
  });

  it("reports a home path under /home and /Users", () => {
    const name = "zq" + "planted";
    expect(rules(scanText("a.sh", `/home/${name}/x\n/Users/${name}/y\n`))).toEqual([
      "user-path",
      "user-path",
    ]);
  });

  it("reports owner identity strings case-insensitively, whole word only", () => {
    const fs = scanText("a.ts", `by ${OWNER.toLowerCase()} and ${OWNER}s and x${OWNER}`, [OWNER]);
    expect(fs.map((f) => f.rule)).toEqual(["owner-identity"]);
  });

  it("reports a real-looking e-mail but not placeholder ones", () => {
    const text = `${MAIL}\nuser@example.com\na@b.example\nx@users.noreply.github.com\nq@host.invalid\n`;
    expect(scanText("a.md", text).map((f) => f.excerpt)).toEqual([MAIL]);
  });

  it("reports a Steam64 id, including one inside a Workbench profile file name", () => {
    const fs = scanText("a.ts", `.projectList_app1874910_user${STEAM}.conf`);
    expect(rules(fs)).toEqual(["steam-id"]);
  });

  it("reports a SID and a user-hive .reg dump, not a bare key name", () => {
    const bare = "HKCU" + BS + "Software" + BS + "Vendor";
    expect(scanText("a.md", bare)).toEqual([]);
    expect(rules(scanText("a.txt", SID))).toEqual(["registry"]);
    expect(rules(scanText("a.reg", REG_DUMP))).toEqual(["registry"]);
    expect(rules(scanText("a.json", JSON.stringify({ d: REG_DUMP })))).toEqual(["registry"]);
  });

  it("reports executable-derived strings", () => {
    expect(rules(scanText("ledger.jsonl", EXE_QUOTE))).toEqual(["exe-strings"]);
    expect(rules(scanText("t.ts", RTTI))).toEqual(["exe-strings"]);
    const pdb = ["D:", "build", "out", "Workbench.pdb"].join(BS);
    expect(rules(scanText("t.txt", pdb))).toEqual(["exe-strings"]);
  });

  it("reports secrets and skips placeholder values", () => {
    expect(rules(scanText("a.ts", TOKEN))).toEqual(["secret"]);
    expect(rules(scanText("k.txt", KEY_HEADER))).toEqual(["secret"]);
    expect(rules(scanText("a.json", `"api_key": "${"Q".repeat(24)}"`))).toEqual(["secret"]);
    expect(scanText("a.json", `"password": "changeme_${"q".repeat(20)}"`)).toEqual([]);
  });

  it("finds nothing in plain source", () => {
    expect(scanText("a.ts", 'export const a = "hello";\n// C:\\Program Files\\x\n')).toEqual([]);
  });
});

describe("scanPath", () => {
  it("flags programme internals, census evidence, scratch and local config", () => {
    const roots = DEFAULT_AUTHORED_ROOTS;
    expect(rules(scanPath("docs/v2/PLAN.md", roots))).toEqual(["disallowed-path"]);
    expect(rules(scanPath("data/census/evidence/EV-1.json", roots))).toEqual(["disallowed-path"]);
    expect(rules(scanPath("notes/_scratch/s.md", roots))).toEqual(["disallowed-path"]);
    expect(rules(scanPath("CLAUDE.local.md", roots))).toEqual(["disallowed-path"]);
    expect(scanPath("docs/CONVENTIONS.md", roots)).toEqual([]);
  });

  it("flags an Enfusion resource outside the authored roots only", () => {
    expect(rules(scanPath("data/copied/Prefab.et", DEFAULT_AUTHORED_ROOTS))).toEqual([
      "vanilla-asset",
    ]);
    expect(
      scanPath("tests/fixtures/sample-project/prefabs/test.et", DEFAULT_AUTHORED_ROOTS),
    ).toEqual([]);
    expect(
      scanPath("mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Guard.c", DEFAULT_AUTHORED_ROOTS),
    ).toEqual([]);
  });
});

describe("scanTree over a fixture tree", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "emcp-export-scan-"));
    const files: Record<string, string | Buffer> = {
      "README.md": "# clean\n",
      "src/a.ts": "export const a = 1;\n",
      "docs/notes.md": `line one\nsaved under ${HOME}\n`,
      "docs/v2/PLAN.md": "plan\n",
      "data/census/ledger.jsonl": `{"id":"x"}\n${EXE_QUOTE}\n`,
      "data/copied/Thing.et": "Thing {\n}\n",
      "tests/fixtures/ok.et": "Ok {\n}\n",
      "tools/bin/helper.exe": Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]),
      "data/blob.bin": Buffer.from([0x01, 0x00, 0x02, 0x00]),
      "data/big.json": "x".repeat(2000),
      "data/near.json": "y".repeat(950),
      "cfg/owner.txt": `by ${OWNER}\n`,
    };
    for (const [p, body] of Object.entries(files)) {
      const abs = join(root, ...p.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
  });

  it("reports every planted hit with file and line, and nothing in clean files", () => {
    const r = scanTree(root, { names: [OWNER], maxBytes: 1000 });
    expect(r.files).toBe(12);
    const got = r.findings.map((f) => `${f.rule} ${f.file}:${f.line}`).sort();
    expect(got).toEqual(
      [
        "user-path docs/notes.md:2",
        // the planted home path carries the owner's account name as well
        "owner-identity docs/notes.md:2",
        "disallowed-path docs/v2/PLAN.md:0",
        "exe-strings data/census/ledger.jsonl:2",
        "vanilla-asset data/copied/Thing.et:0",
        "executable tools/bin/helper.exe:0",
        "large-file data/big.json:0",
        "near-limit data/near.json:0",
        "owner-identity cfg/owner.txt:1",
      ].sort(),
    );
  });
});

const HAS_GIT = spawnSync("git", ["--version"]).status === 0;

describe.skipIf(!HAS_GIT)("materializeExport", () => {
  const isolation = mkdtempSync(join(tmpdir(), "emcp-export-scan-cfg-"));
  writeFileSync(join(isolation, "empty.gitconfig"), "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(isolation, "empty.gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Scan Test",
    GIT_AUTHOR_EMAIL: "scan-test@example.invalid",
    GIT_COMMITTER_NAME: "Scan Test",
    GIT_COMMITTER_EMAIL: "scan-test@example.invalid",
  };
  const git = (cwd: string, args: string[]): string =>
    execFileSync("git", args, { cwd, env, encoding: "utf-8" });

  let repo: string;
  let allow: string;
  beforeAll(() => {
    Object.assign(process.env, {
      GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: "1",
    });
    repo = mkdtempSync(join(tmpdir(), "emcp-export-scan-repo-"));
    git(repo, ["init", "-q"]);
    const files: Record<string, string> = {
      "README.md": "# r\r\nwith a CRLF line\n",
      "src/a.ts": "export const a = 1;\n",
      "docs/v2/STATE.md": "state\n",
      "docs/v2/PLAN.md": "plan\n",
    };
    for (const [p, body] of Object.entries(files)) {
      const abs = join(repo, ...p.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    git(repo, ["-c", "core.autocrlf=false", "add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    allow = join(isolation, "allow.json");
    writeFileSync(allow, JSON.stringify({ include: ["**"], exclude: ["docs/v2/STATE.md"] }));
  });

  it("writes the allow-listed blobs byte for byte and drops the excluded ones", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "emcp-export-scan-out-")), "tree");
    const written = await materializeExport(repo, "HEAD", out, allow);
    expect(written.map((e) => e.path).sort()).toEqual(["README.md", "docs/v2/PLAN.md", "src/a.ts"]);
    expect(readFileSync(join(out, "README.md"), "utf-8")).toBe("# r\r\nwith a CRLF line\n");
    const r = scanTree(out);
    expect(r.findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      "disallowed-path docs/v2/PLAN.md",
    ]);
  });

  it("writes the ledger through the export transform, so E05 strings do not reach the scan", async () => {
    const ledgerRepo = mkdtempSync(join(tmpdir(), "emcp-export-scan-ledger-"));
    git(ledgerRepo, ["init", "-q"]);
    const line = (id: string, enumerator: string): string =>
      JSON.stringify({
        id,
        sources: [
          { build: "1", confidence: "high", enumerator, quote: RTTI, ref: "exe" + ":0x10" },
        ],
        tier_evidence: [{ ref: "exe" + ":0x10", tier: "T1" }],
      });
    const keep = JSON.stringify({ id: "cli:-b", sources: [{ enumerator: "E07", ref: "wiki:x" }] });
    mkdirSync(join(ledgerRepo, "data", "census"), { recursive: true });
    writeFileSync(
      join(ledgerRepo, "data", "census", "ledger.jsonl"),
      [line("cli:-a", "E05"), keep, ""].join("\n"),
    );
    git(ledgerRepo, ["-c", "core.autocrlf=false", "add", "-A"]);
    git(ledgerRepo, ["commit", "-q", "-m", "ledger"]);
    const out = join(mkdtempSync(join(tmpdir(), "emcp-export-scan-out-")), "tree");
    const seen: string[] = [];
    await materializeExport(ledgerRepo, "HEAD", out, allow, (t) =>
      seen.push(`${t.transform} ${t.path} ${t.changed}`),
    );
    expect(seen).toEqual(["redact-e05 data/census/ledger.jsonl 1"]);
    const text = readFileSync(join(out, "data", "census", "ledger.jsonl"), "utf-8");
    expect(text.split("\n")[1]).toBe(keep);
    expect(scanTree(out).findings).toEqual([]);
  });

  it("refuses an output folder inside the repository or one that is not empty", async () => {
    await expect(materializeExport(repo, "HEAD", join(repo, "out"), allow)).rejects.toThrow(
      /outside the repository/,
    );
    const full = mkdtempSync(join(tmpdir(), "emcp-export-scan-full-"));
    writeFileSync(join(full, "x"), "x");
    await expect(materializeExport(repo, "HEAD", full, allow)).rejects.toThrow(/new or empty/);
  });
});

describe("parseScanArgs", () => {
  it("takes --dir alone, or --repo --rev --out together", () => {
    expect(parseScanArgs(["--dir", "x"]).dir).toBe("x");
    const o = parseScanArgs(["--repo", ".", "--rev", "HEAD", "--out", "o", "--no-auto-names"]);
    expect(o).toMatchObject({ repo: ".", rev: "HEAD", out: "o", auto: false });
  });

  it("refuses mixed or missing sources and bad values", () => {
    expect(() => parseScanArgs([])).toThrow(/required/);
    expect(() => parseScanArgs(["--dir", "x", "--repo", "."])).toThrow(/not both/);
    expect(() => parseScanArgs(["--repo", ".", "--rev", "HEAD"])).toThrow(/required/);
    expect(() => parseScanArgs(["--dir", "x", "--max-mb", "0"])).toThrow(/positive/);
    expect(() => parseScanArgs(["--bogus"])).toThrow(/unknown/);
  });
});
