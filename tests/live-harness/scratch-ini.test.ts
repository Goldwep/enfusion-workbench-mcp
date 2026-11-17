import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PersonalContext } from "../../scripts/census/enumerators/e06-settings-store.js";
import { iniScriptDebugMode } from "../../scripts/live/s-c-natives.js";
import { main, scratchIniFromExport } from "../../scripts/live/scratch-ini.js";

// Synthetic personal data, assembled at test time (DEC-021 rule 3).
const ACCOUNT = ["pl", "anted", "Acct"].join("");
const HOST = ["TEST", "BOX", "77"].join("-");
const HOME = ["C:", "Users", ACCOUNT].join("\\");
const PERSONAL: PersonalContext = { accountNames: [ACCOUNT], hostNames: [HOST] };

const ROOT_KEY = "HKEY_CURRENT_USER\\Software\\Bohemia Interactive\\Arma Reforger Workbench";

function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function regFile(keys: Record<string, string[]>): Buffer {
  const out = ["Windows Registry Editor Version 5.00", ""];
  for (const [path, lines] of Object.entries(keys)) {
    out.push(`[${ROOT_KEY}${path ? `\\${path}` : ""}]`, ...lines, "");
  }
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(out.join("\r\n"), "utf16le")]);
}

function baseExport(extra: Record<string, string[]> = {}): Record<string, string[]> {
  return {
    Workbench: ['"NetAPI_Enabled"="1"', '"AutoRebuildScripts"="0"'],
    "World Editor": ['"cameraSpeed"="2.5"', `"lastWorld"=${q(`${HOME}\\Documents\\w.ent`)}`],
    ...extra,
  };
}

const NOT_RUNNING = (): string => "";

let dirs: string[] = [];
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "emcp-scratch-ini-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("scratchIniFromExport", () => {
  it("scrubs the export and turns Script Debug Mode off", () => {
    const r = scratchIniFromExport(regFile(baseExport()), PERSONAL, {});
    expect(iniScriptDebugMode(r.text).state).toBe("off");
    expect(r.text).toContain("[World%20Editor]");
    expect(r.text).toContain("NetAPI_Enabled");
    expect(r.text).not.toContain(ACCOUNT);
    expect(r.sections).toContain("Workbench");
  });

  it("overwrites an exported ScriptDebugMode=true", () => {
    const keys = baseExport({});
    keys["World Editor"] = [...keys["World Editor"], '"ScriptDebugMode"="true"'];
    const r = scratchIniFromExport(regFile(keys), PERSONAL, {});
    expect(iniScriptDebugMode(r.text).state).toBe("off");
    expect(r.text.match(/ScriptDebugMode/g)).toHaveLength(1);
  });

  it("refuses an export that names a script authorization", () => {
    const keys = baseExport({ "Script Editor": ['"scriptAuthorizedPaths"="x"'] });
    expect(() => scratchIniFromExport(regFile(keys), PERSONAL, {})).toThrow(/authorization/);
  });

  it("refuses an export without an enabled NET API", () => {
    const keys = baseExport();
    keys.Workbench = ['"NetAPI_Enabled"="0"'];
    expect(() => scratchIniFromExport(regFile(keys), PERSONAL, {})).toThrow();
  });
});

describe("scratch-ini command", () => {
  function setup(): { root: string; reg: string; out: string; log: string[] } {
    const root = tempRoot();
    const reg = join(root, "pass1.reg");
    writeFileSync(reg, regFile(baseExport()));
    return { root, reg, out: join(root, "w1-scratch.ini"), log: [] };
  }

  it("dry run writes nothing", () => {
    const s = setup();
    const code = main(["--from", s.reg, "--out", s.out], {
      artifactsRoot: s.root,
      personal: PERSONAL,
      placeholders: {},
      platform: "win32",
      exec: NOT_RUNNING,
      log: (l) => s.log.push(l),
    });
    expect(code).toBe(0);
    expect(existsSync(s.out)).toBe(false);
    expect(s.log.join("\n")).toMatch(/dry run/);
  });

  it("--really writes the ini, which reads Script Debug Mode off", () => {
    const s = setup();
    const code = main(["--from", s.reg, "--out", s.out, "--really"], {
      artifactsRoot: s.root,
      personal: PERSONAL,
      placeholders: {},
      platform: "win32",
      exec: NOT_RUNNING,
      log: (l) => s.log.push(l),
    });
    expect(code).toBe(0);
    expect(iniScriptDebugMode(readFileSync(s.out, "utf-8")).state).toBe("off");
  });

  it("refuses an existing ini and one outside the artifacts folder", () => {
    const s = setup();
    writeFileSync(s.out, "x");
    const deps = {
      artifactsRoot: s.root,
      personal: PERSONAL,
      placeholders: {},
      platform: "win32" as const,
      exec: NOT_RUNNING,
      log: (l: string) => s.log.push(l),
    };
    expect(main(["--from", s.reg, "--out", s.out, "--really"], deps)).toBe(1);
    expect(readFileSync(s.out, "utf-8")).toBe("x");
    const elsewhere = join(tempRoot(), "x.ini");
    expect(main(["--from", s.reg, "--out", elsewhere, "--really"], deps)).toBe(1);
    expect(existsSync(elsewhere)).toBe(false);
  });

  it("refuses while a Workbench process runs", () => {
    const s = setup();
    const code = main(["--from", s.reg, "--out", s.out, "--really"], {
      artifactsRoot: s.root,
      personal: PERSONAL,
      placeholders: {},
      platform: "win32",
      exec: () => '"ArmaReforgerWorkbenchSteamDiag.exe","1234","Console","1","100 K"\r\n',
      log: (l) => s.log.push(l),
    });
    expect(code).toBe(1);
    expect(existsSync(s.out)).toBe(false);
  });

  it("usage error without --from", () => {
    expect(main(["--out", "x.ini"], { log: () => undefined })).toBe(2);
  });
});
