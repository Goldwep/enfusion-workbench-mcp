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
  installProbePacks,
  quoteWindowsArg,
  spawnWorkbench,
} from "../../scripts/live/launch.js";
import type { Lane } from "../../scripts/live/lane.js";

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
    const root = mkdtempSync(join(tmpdir(), "emcp-inst-"));
    const sandbox = join(root, "EMCP2_sandbox");
    mkdirSync(sandbox);
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
      rmSync(root, { recursive: true, force: true });
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

  it("refuses, dry run or not, while S-A's U14 throwaway copy is in the sandbox", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-inst-"));
    const sandbox = join(root, "EMCP2_sandbox");
    mkdirSync(sandbox);
    try {
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
      mkdirSync(join(sandbox, "Scripts", "WorkbenchGame", "EMCP2_U14_Throwaway"), {
        recursive: true,
      });
      expect(() => installHandlers(sandbox, { really: false })).toThrow("U14 throwaway");
      expect(() => installHandlers(sandbox, { really: true })).toThrow("U14 throwaway");
      expect(existsSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses an addon that is not the 2.0 sandbox, and S-C's U3 plant folder (DEC-032)", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-inst-"));
    try {
      const owner = join(root, "OwnerMod");
      mkdirSync(owner);
      writeFileSync(join(owner, "OwnerMod.gproj"), "GameProject {\n}\n");
      expect(() => installHandlers(owner, { really: false })).toThrow(/only the 2.0 sandbox/);
      const sandbox = join(root, "EMCP2_sandbox");
      mkdirSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensusU3"), { recursive: true });
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
      expect(() => installHandlers(sandbox, { really: true })).toThrow(/U3 plant/);
      expect(existsSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("spawnWorkbench (DEC-032, S-B read m5)", () => {
  it("a spawn that fails ends as the thrown refusal, never as an unhandled error event", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-spawn-"));
    try {
      const plan = buildLaunch({
        workbenchPath: join(dir, "tools"),
        gamePath: dir,
        gproj: join(dir, "EMCP2_sandbox", "EMCP2_sandbox.gproj"),
      });
      const lane = { record: () => ({}) } as unknown as Lane;
      expect(() => spawnWorkbench({ ...plan, exe: join(dir, "missing.exe") }, lane, null)).toThrow(
        /did not start/,
      );
      // Node emits `error` on the next tick; a listener must already be there.
      await new Promise((r) => setTimeout(r, 100));
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

describe("installProbePacks", () => {
  /** A mod-dev root with two packs, a bundled set of one file, and a 2.0 sandbox that has it installed. */
  function packWorld(sandboxName = "EMCP2_sandbox") {
    const dir = mkdtempSync(join(tmpdir(), "emcp-packs-"));
    const modDev = join(dir, "mod-dev");
    const probe = join(modDev, "probe");
    const mut = join(modDev, "probe-mut");
    mkdirSync(probe, { recursive: true });
    mkdirSync(mut, { recursive: true });
    writeFileSync(join(probe, "ECEN_Probe.c"), "// probe");
    writeFileSync(join(probe, "ECEN_ProbeUtil.c"), "// probe util");
    writeFileSync(join(mut, "ECEN_ProbeMut.c"), "// mut");
    const bundled = join(dir, "bundled");
    mkdirSync(bundled);
    writeFileSync(join(bundled, "EMCP_WB_Ping.c"), "// ping");
    const sandbox = join(dir, sandboxName);
    mkdirSync(join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP"), { recursive: true });
    writeFileSync(join(sandbox, `${sandboxName}.gproj`), "GameProject {\n}\n");
    writeFileSync(
      join(sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_Ping.c"),
      "// ping",
    );
    const target = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensus");
    return { dir, modDev, probe, mut, bundled, sandbox, target };
  }

  it("leaves the folder holding exactly the packs named: other ECEN_*.c files are deleted, nothing else", () => {
    const w = packWorld();
    try {
      mkdirSync(w.target, { recursive: true });
      writeFileSync(join(w.target, "ECEN_ProbeMut.c"), "// left over from S-E");
      writeFileSync(join(w.target, "ECEN_ProbeOld.c"), "// removed from the pack since");
      writeFileSync(join(w.target, "readme.txt"), "not a pack script");
      const opts = { modDevRoot: w.modDev, bundledDir: w.bundled };
      const dry = installProbePacks(w.sandbox, [w.probe], { ...opts, really: false });
      expect(dry[0].removed).toEqual(["ECEN_ProbeMut.c", "ECEN_ProbeOld.c"]);
      expect(readdirSync(w.target)).toContain("ECEN_ProbeMut.c");

      const real = installProbePacks(w.sandbox, [w.probe], { ...opts, really: true });
      expect(real[0].copied).toBe(true);
      expect(readdirSync(w.target).sort()).toEqual([
        "ECEN_Probe.c",
        "ECEN_ProbeUtil.c",
        "readme.txt",
      ]);

      // S-E: both packs at once.
      installProbePacks(w.sandbox, [w.probe, w.mut], { ...opts, really: true });
      expect(readdirSync(w.target).sort()).toEqual([
        "ECEN_Probe.c",
        "ECEN_ProbeMut.c",
        "ECEN_ProbeUtil.c",
        "readme.txt",
      ]);
      // The next session installs the read-only pack alone: the mutating pack goes.
      const next = installProbePacks(w.sandbox, [w.probe], { ...opts, really: true });
      expect(next[0].removed).toEqual(["ECEN_ProbeMut.c"]);
      expect(readdirSync(w.target)).not.toContain("ECEN_ProbeMut.c");
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("refuses any sandbox but the 2.0 sandbox, deleting nothing", () => {
    const w = packWorld("Test1_sandbox");
    try {
      mkdirSync(w.target, { recursive: true });
      writeFileSync(join(w.target, "ECEN_Other.c"), "// not ours to delete");
      expect(() =>
        installProbePacks(w.sandbox, [w.probe], {
          modDevRoot: w.modDev,
          bundledDir: w.bundled,
          really: true,
        }),
      ).toThrow("only the 2.0 sandbox");
      expect(readdirSync(w.target)).toEqual(["ECEN_Other.c"]);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("refuses two packs that hold a file of the same name, and a pack without the shipped set", () => {
    const w = packWorld();
    try {
      writeFileSync(join(w.mut, "ECEN_Probe.c"), "// clash");
      expect(() =>
        installProbePacks(w.sandbox, [w.probe, w.mut], {
          modDevRoot: w.modDev,
          bundledDir: w.bundled,
          really: false,
        }),
      ).toThrow("both hold ECEN_Probe.c");
      rmSync(join(w.mut, "ECEN_Probe.c"));
      rmSync(join(w.sandbox, "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_Ping.c"));
      expect(() =>
        installProbePacks(w.sandbox, [w.probe], {
          modDevRoot: w.modDev,
          bundledDir: w.bundled,
          really: true,
        }),
      ).toThrow("alone");
      expect(existsSync(w.target)).toBe(false);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it("the CLI takes --probe-pack more than once and prints what it would delete", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-cli-"));
    try {
      const sandbox = join(dir, "EMCP2_sandbox");
      const target = join(sandbox, "Scripts", "WorkbenchGame", "EnfusionCensus");
      mkdirSync(target, { recursive: true });
      writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
      writeFileSync(join(target, "ECEN_Stale.c"), "// stale");
      const r = spawnSync(
        process.execPath,
        [
          ...TSX_ARGS,
          join(repoRoot, "scripts", "live", "launch.ts"),
          "--install-handlers",
          sandbox,
          "--probe-pack",
          join(repoRoot, "mod-dev", "probe"),
          "--probe-pack",
          join(repoRoot, "mod-dev", "probe-mut"),
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
        "probe pack probe: would delete 1 ECEN_*.c file(s) not in the packs named: ECEN_Stale.c",
      );
      expect(r.stdout).toContain("probe pack probe: would copy");
      expect(r.stdout).toContain("probe pack probe-mut: would copy");
      expect(r.stdout).toContain("dry run");
      expect(readdirSync(target)).toEqual(["ECEN_Stale.c"]);
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
      // Every printed path in placeholder form (DEC-032, S-C read m6).
      expect(r.stdout).toContain(
        `args: ${JSON.stringify(["-gproj", join("<sandbox>", "EMCP2_sandbox.gproj")])}`,
      );
      expect(r.stdout).toContain("cwd:  <game>");
      expect(r.stdout).not.toContain(dir);
      expect(r.stdout).toContain("command line: ");
      expect(r.stdout).toContain("dry run");
      expect(existsSync(join(dir, "lease.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
