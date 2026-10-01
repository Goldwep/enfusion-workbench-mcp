import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  BUNDLED_HANDLER_DIR,
  buildLaunch,
  formatCommandLine,
  installHandlers,
  installProbePack,
  quoteWindowsArg,
} from "../../scripts/live/launch.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// `node --import tsx <script>`: node_modules/.bin/tsx is a shell script that
// spawnSync cannot start on Windows (status null, ENOENT).
const TSX_ARGS = ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href];

describe("buildLaunch", () => {
  it("passes -gproj and the project as separate arguments with the game as cwd", () => {
    const plan = buildLaunch({
      workbenchPath: "T:/Tools",
      gamePath: "T:/Game",
      gproj: "T:/My Games/addons/EMCP2_sandbox/EMCP2_sandbox.gproj",
      exists: () => false,
    });
    expect(plan.args).toEqual(["-gproj", "T:/My Games/addons/EMCP2_sandbox/EMCP2_sandbox.gproj"]);
    expect(plan.cwd).toBe("T:/Game");
    expect(plan.exe).toBe(join("T:/Tools", "Workbench", "ArmaReforgerWorkbenchSteamDiag.exe"));
    expect(plan.commandLine).toContain(
      '-gproj "T:/My Games/addons/EMCP2_sandbox/EMCP2_sandbox.gproj"',
    );
  });

  it("adds -forceSettings as a separate pair and omits the project for the launcher walk", () => {
    const plan = buildLaunch({
      workbenchPath: "T",
      gamePath: "G",
      gproj: null,
      forceSettings: "s.ini",
    });
    expect(plan.args).toEqual(["-forceSettings", "s.ini"]);
  });

  it("refuses flag-shaped and non-.gproj project paths", () => {
    expect(() => buildLaunch({ workbenchPath: "T", gamePath: "G", gproj: "-x.gproj" })).toThrow(
      "flag-shaped",
    );
    expect(() => buildLaunch({ workbenchPath: "T", gamePath: "G", gproj: "a.txt" })).toThrow(
      ".gproj",
    );
  });
});

describe("quoteWindowsArg", () => {
  it("quotes spaces and escapes quotes and trailing backslashes", () => {
    expect(quoteWindowsArg("plain")).toBe("plain");
    expect(quoteWindowsArg("a b")).toBe('"a b"');
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArg("C:\\a b\\")).toBe('"C:\\a b\\\\"');
    expect(formatCommandLine("x.exe", [""])).toBe('x.exe ""');
  });
});

describe("installHandlers", () => {
  it("lists the bundled set without copying on a dry run, and copies with really", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "emcp-inst-"));
    try {
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
      const dry = installHandlers(sandbox, { really: false });
      expect(dry.copied).toBe(false);
      expect(dry.files).toContain("EMCP_WB_Ping.c");
      expect(existsSync(dry.target)).toBe(false);

      const target = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "Keep_Me.c"), "// not ours");
      const real = installHandlers(sandbox, { really: true });
      expect(real.copied).toBe(true);
      const present = readdirSync(target);
      expect(present).toEqual(
        expect.arrayContaining(readdirSync(BUNDLED_HANDLER_DIR).filter((f) => f.endsWith(".c"))),
      );
      expect(present).toContain("Keep_Me.c");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("refuses a directory without a .gproj", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-inst-"));
    try {
      expect(() => installHandlers(dir, { really: true })).toThrow("holds no .gproj");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("installProbePack", () => {
  it("refuses while the mod-dev source is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-pack-"));
    try {
      const modDev = join(dir, "mod-dev");
      expect(() =>
        installProbePack(dir, join(modDev, "Scripts", "WorkbenchGame", "EnfusionCensus"), {
          really: false,
          modDevRoot: modDev,
        }),
      ).toThrow("does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a source outside mod-dev and files without the ECEN_ prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-pack-"));
    try {
      const modDev = join(dir, "mod-dev");
      const pack = join(modDev, "pack");
      mkdirSync(pack, { recursive: true });
      writeFileSync(join(pack, "Other.c"), "");
      expect(() => installProbePack(dir, dir, { really: false, modDevRoot: modDev })).toThrow(
        "outside",
      );
      expect(() => installProbePack(dir, pack, { really: false, modDevRoot: modDev })).toThrow(
        "ECEN_",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("launch.ts CLI", () => {
  it("prints the exact command line on a dry run and spawns nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-cli-"));
    try {
      const r = spawnSync(
        process.execPath,
        [
          ...TSX_ARGS,
          join(repoRoot, "scripts", "live", "launch.ts"),
          "--workbench-path",
          join(dir, "tools"),
          "--game-path",
          join(dir, "game"),
          "--gproj",
          join(dir, "EMCP2_sandbox", "EMCP2_sandbox.gproj"),
        ],
        {
          encoding: "utf-8",
          env: {
            ...process.env,
            ENFUSION_LEASE_PATH: join(dir, "lease.json"),
            ENFUSION_NO_AUTOLAUNCH_PATH: join(dir, "marker"),
          },
        },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(
        `args: ${JSON.stringify(["-gproj", join(dir, "EMCP2_sandbox", "EMCP2_sandbox.gproj")])}`,
      );
      expect(r.stdout).toContain(`cwd:  ${join(dir, "game")}`);
      expect(r.stdout).toContain("command line: ");
      expect(r.stdout).toContain("dry run");
      expect(existsSync(join(dir, "lease.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
