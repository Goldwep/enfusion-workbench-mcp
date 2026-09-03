import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildLaunchArgv,
  checkRunningServer,
  DEFAULT_SERVER_EXE_PATH,
  deletePidFile,
  isProcessAlive,
  isServerProcessAlive,
  parseTasklistImage,
  processImageName,
  pidFilePathFor,
  PID_FILE_NAME,
  prepareLaunchInputs,
  probeServerExe,
  readPidFile,
  validateExtraArgs,
  validateScenarioId,
  writePidFile,
  type PidFileContents,
} from "../../src/server-mgmt/launch.js";

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-launch");

function setupDir(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  return TEST_DIR;
}

afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("server-mgmt/launch — validateExtraArgs", () => {
  it("accepts a clean flag", () => {
    expect(() => validateExtraArgs(["-bindAddress=0.0.0.0"])).not.toThrow();
  });

  it("accepts compound metadata-like flags", () => {
    expect(() =>
      validateExtraArgs([
        "-maxFPS=120",
        "-profile=server.profile",
        "-logVerbose",
        "-config:path,sub.json",
      ]),
    ).not.toThrow();
  });

  it("rejects empty extra_args entries", () => {
    expect(() => validateExtraArgs([""])).toThrow(/non-empty/);
  });

  it("rejects entries that don't start with '-'", () => {
    expect(() => validateExtraArgs(["bindAddress"])).toThrow(/Invalid extra_args/);
  });

  it("rejects entries with whitespace", () => {
    expect(() => validateExtraArgs(["-bind 0.0.0.0"])).toThrow(/Invalid extra_args/);
  });

  it("rejects entries with shell metacharacters", () => {
    for (const bad of [
      "-foo;ls",
      "-foo|cat",
      "-foo&whoami",
      "-foo$VAR",
      "-foo`id`",
      "-foo>/tmp/x",
      "-foo<file",
      "-foo&&echo",
      "-foo'quoted'",
      '-foo"quoted"',
    ]) {
      expect(() => validateExtraArgs([bad])).toThrow(/Invalid extra_args/);
    }
  });

  it("enforces the 10-arg cap", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `-arg${i}`);
    expect(() => validateExtraArgs(eleven)).toThrow(/Too many extra_args/);
  });
});

describe("server-mgmt/launch — validateScenarioId", () => {
  it("accepts the canonical {GUID}path form", () => {
    expect(() =>
      validateScenarioId("{DFAC5FABD11D2507}Missions/23_Campaign_NorthCentral.conf"),
    ).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateScenarioId("")).toThrow();
  });

  it("rejects flag-smuggling attempt", () => {
    expect(() => validateScenarioId("-config=server.json")).toThrow(/CLI flag/);
  });

  it("rejects whitespace", () => {
    expect(() => validateScenarioId("foo bar")).toThrow(/forbidden character/);
  });

  it("rejects shell metacharacters", () => {
    expect(() => validateScenarioId("foo;bar")).toThrow(/forbidden character/);
    expect(() => validateScenarioId("foo|bar")).toThrow(/forbidden character/);
    expect(() => validateScenarioId("foo$bar")).toThrow(/forbidden character/);
    expect(() => validateScenarioId("foo`bar")).toThrow(/forbidden character/);
  });
});

describe("server-mgmt/launch — prepareLaunchInputs", () => {
  it("rejects a server_config_path starting with '-'", () => {
    expect(() =>
      prepareLaunchInputs({
        serverConfigPath: "-config=evil.json",
        scenarioId: "{ABCD}M.conf",
      }),
    ).toThrow(/CLI flag/);
  });

  it("returns an absolute config path and the validated scenarioId", () => {
    const { absoluteConfigPath, scenarioId, extraArgs } = prepareLaunchInputs({
      serverConfigPath: "server.json",
      scenarioId: "{ABCD1234DEAD5678}Missions/M.conf",
      extraArgs: ["-maxFPS=120"],
    });
    expect(absoluteConfigPath).toMatch(/server\.json$/);
    expect(scenarioId).toBe("{ABCD1234DEAD5678}Missions/M.conf");
    expect(extraArgs).toEqual(["-maxFPS=120"]);
  });
});

describe("server-mgmt/launch — buildLaunchArgv", () => {
  it("emits -config / -scenarioId / extras in order", () => {
    const argv = buildLaunchArgv({
      serverConfigPath: "C:\\path\\server.json",
      scenarioId: "{ABCD}M.conf",
      extraArgs: ["-maxFPS=120", "-logVerbose"],
    });
    expect(argv).toEqual([
      "-config",
      "C:\\path\\server.json",
      "-scenarioId",
      "{ABCD}M.conf",
      "-maxFPS=120",
      "-logVerbose",
    ]);
  });

  it("emits only the mandatory flags when extras are empty", () => {
    const argv = buildLaunchArgv({
      serverConfigPath: "server.json",
      scenarioId: "{ABCD}M.conf",
      extraArgs: [],
    });
    expect(argv).toEqual([
      "-config",
      "server.json",
      "-scenarioId",
      "{ABCD}M.conf",
    ]);
  });
});

describe("server-mgmt/launch — probeServerExe", () => {
  it("returns exists=false for a path that doesn't exist", () => {
    const r = probeServerExe("Z:\\definitely\\not\\here\\ArmaReforgerServer.exe");
    expect(r.exists).toBe(false);
    expect(r.path).toBe("Z:\\definitely\\not\\here\\ArmaReforgerServer.exe");
  });

  it("uses the canonical default path when no argument supplied", () => {
    const r = probeServerExe();
    expect(r.path).toBe(DEFAULT_SERVER_EXE_PATH);
    // existence depends on local install — we only assert the path is right.
  });
});

describe("server-mgmt/launch — pidFilePathFor", () => {
  it("places the PID file in the same directory as the server.json", () => {
    const out = pidFilePathFor("C:\\Servers\\HostHavoc\\server.json");
    // join() will normalize the separator to the platform default — assert
    // that the basename is the constant and the directory matches.
    expect(out.endsWith(PID_FILE_NAME)).toBe(true);
    expect(out).toContain("HostHavoc");
  });

  it("handles a relative config path", () => {
    const out = pidFilePathFor("server.json");
    expect(out.endsWith(PID_FILE_NAME)).toBe(true);
  });
});

describe("server-mgmt/launch — writePidFile / readPidFile / deletePidFile", () => {
  it("round-trips a PID file via atomic write", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    const sample: PidFileContents = {
      pid: 12345,
      started_at: "2026-05-21T10:00:00.000Z",
      server_config_path: join(dir, "server.json"),
      scenario_id: "{ABCD1234DEAD5678}Missions/M.conf",
      argv: ["-config", "server.json", "-scenarioId", "{ABCD}M.conf"],
    };
    writePidFile(pidFilePath, sample);
    expect(existsSync(pidFilePath)).toBe(true);
    // No leftover .tmp file after a successful rename.
    expect(existsSync(`${pidFilePath}.tmp`)).toBe(false);
    const round = readPidFile(pidFilePath);
    expect(round).toEqual(sample);
  });

  it("readPidFile returns null when the file is missing", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    expect(readPidFile(pidFilePath)).toBeNull();
  });

  it("readPidFile throws on malformed JSON", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writeFileSync(pidFilePath, "{ not json", "utf-8");
    expect(() => readPidFile(pidFilePath)).toThrow(/Failed to parse PID file/);
  });

  it("readPidFile throws when the shape is wrong (missing pid)", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writeFileSync(pidFilePath, JSON.stringify({ foo: "bar" }), "utf-8");
    expect(() => readPidFile(pidFilePath)).toThrow(/unexpected shape/);
  });

  it("deletePidFile removes the file", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writeFileSync(pidFilePath, JSON.stringify({ pid: 1 }), "utf-8");
    expect(existsSync(pidFilePath)).toBe(true);
    deletePidFile(pidFilePath);
    expect(existsSync(pidFilePath)).toBe(false);
  });

  it("deletePidFile is a no-op when the file is already missing", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    expect(() => deletePidFile(pidFilePath)).not.toThrow();
  });
});

describe("server-mgmt/launch — isProcessAlive", () => {
  it("returns true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for an obviously bogus PID", () => {
    // Any negative / zero PID is invalid; the function short-circuits.
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(NaN)).toBe(false);
  });

  it("returns false for a PID that doesn't exist (large unused PID)", () => {
    // PID 2^31-1 is virtually guaranteed not to exist on any sane system.
    expect(isProcessAlive(2147483646)).toBe(false);
  });
});

describe("server-mgmt/launch — checkRunningServer", () => {
  const SAMPLE: PidFileContents = {
    pid: 9999,
    started_at: "2026-05-21T10:00:00.000Z",
    server_config_path: "C:\\fake\\server.json",
    scenario_id: "{ABCD}M.conf",
    argv: ["-config", "server.json"],
  };

  it("returns state='none' when no PID file exists", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    const out = checkRunningServer({ pidFilePath });
    expect(out).toEqual({ state: "none" });
  });

  it("returns state='alive' when the PID file exists and the PID is alive", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const out = checkRunningServer({
      pidFilePath,
      isAlive: () => true,
    });
    expect(out.state).toBe("alive");
    if (out.state === "alive") {
      expect(out.contents.pid).toBe(9999);
    }
  });

  it("returns state='stale' when the PID file exists but the PID is dead", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const out = checkRunningServer({
      pidFilePath,
      isAlive: () => false,
    });
    expect(out.state).toBe("stale");
    if (out.state === "stale") {
      expect(out.contents.pid).toBe(9999);
    }
  });

  it("passes the PID from the file into the isAlive probe", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    let observedPid: number | null = null;
    checkRunningServer({
      pidFilePath,
      isAlive: (pid) => {
        observedPid = pid;
        return false;
      },
    });
    expect(observedPid).toBe(9999);
  });
});

describe("server-mgmt/launch — PID file shape on disk", () => {
  it("writes pretty-printed JSON with the documented fields", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    const sample: PidFileContents = {
      pid: 7777,
      started_at: "2026-05-21T10:00:00.000Z",
      server_config_path: join(dir, "server.json"),
      scenario_id: "{ABCD1234DEAD5678}Missions/M.conf",
      argv: ["-config", "server.json", "-scenarioId", "{ABCD}M.conf"],
    };
    writePidFile(pidFilePath, sample);
    const text = readFileSync(pidFilePath, "utf-8");
    // Parse round-trips cleanly.
    const parsed = JSON.parse(text);
    expect(parsed).toEqual(sample);
    // Multi-line JSON (indentation) for human readability.
    expect(text).toContain("\n");
  });
});

describe("server-mgmt/launch — process identity (M20)", () => {
  const SAMPLE: PidFileContents = {
    pid: 4242,
    started_at: "2026-05-21T10:00:00.000Z",
    server_config_path: "C:\\fake\\server.json",
    scenario_id: "{ABCD}M.conf",
    argv: ["-config", "server.json"],
  };

  it("parseTasklistImage extracts the image from CSV /NH output", () => {
    const out = '"ArmaReforgerServer.exe","4242","Console","1","1,234,567 K"\r\n';
    expect(parseTasklistImage(out)).toBe("ArmaReforgerServer.exe");
  });

  it("parseTasklistImage returns null on the no-match INFO line", () => {
    expect(
      parseTasklistImage("INFO: No tasks are running which match the specified criteria.\r\n"),
    ).toBeNull();
    expect(parseTasklistImage("")).toBeNull();
  });

  it("isServerProcessAlive is false for a live PID with a foreign image", () => {
    expect(
      isServerProcessAlive(4242, { isAlive: () => true, imageName: () => "chrome.exe" }),
    ).toBe(false);
  });

  it("isServerProcessAlive is true for a live PID with our image (case-insensitive)", () => {
    expect(
      isServerProcessAlive(4242, {
        isAlive: () => true,
        imageName: () => "ARMAREFORGERSERVER.exe",
      }),
    ).toBe(true);
  });

  it("isServerProcessAlive is false when the process is dead regardless of image", () => {
    let imageCalls = 0;
    expect(
      isServerProcessAlive(4242, {
        isAlive: () => false,
        imageName: () => {
          imageCalls++;
          return "ArmaReforgerServer.exe";
        },
      }),
    ).toBe(false);
    expect(imageCalls).toBe(0);
  });

  it("processImageName rejects non-integer / non-positive PIDs without spawning tasklist", () => {
    expect(processImageName(0)).toBeNull();
    expect(processImageName(-1)).toBeNull();
    expect(processImageName(1.5)).toBeNull();
  });

  it("checkRunningServer reports stale/foreign when the PID is alive but the image differs", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const out = checkRunningServer({
      pidFilePath,
      isAlive: () => true,
      imageName: () => "explorer.exe",
    });
    expect(out.state).toBe("stale");
    if (out.state === "stale") expect(out.reason).toBe("foreign");
  });

  it("checkRunningServer reports alive when the PID is alive and the image matches", () => {
    const dir = setupDir();
    const pidFilePath = join(dir, PID_FILE_NAME);
    writePidFile(pidFilePath, SAMPLE);
    const out = checkRunningServer({
      pidFilePath,
      isAlive: () => true,
      imageName: () => "ArmaReforgerServer.exe",
    });
    expect(out.state).toBe("alive");
  });
});
