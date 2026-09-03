import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import {
  LAUNCHER_WINDOW_TITLE,
  MISSING_DEPS_WINDOW_TITLE,
  buildNudgeScript,
  inspectProcessWindows,
} from "../../src/workbench/launcher-nudge.js";

describe("launcher-nudge: buildNudgeScript", () => {
  it("embeds the pid, titles, and nudge flag", () => {
    const script = buildNudgeScript(4242, LAUNCHER_WINDOW_TITLE, MISSING_DEPS_WINDOW_TITLE, true);
    expect(script).toContain("[EmcpWindowNudge]::Run(4242, 'Enfusion Workbench Launcher', 'Missing Addon Dependencies', $true)");
    expect(script).toContain("Add-Type -TypeDefinition");
    expect(script).toContain("SC_RESTORE");
    expect(script).toContain("VK_RETURN");
  });

  it("emits $false for a titles-only probe", () => {
    const script = buildNudgeScript(7, LAUNCHER_WINDOW_TITLE, MISSING_DEPS_WINDOW_TITLE, false);
    expect(script).toContain("$false)");
  });

  it("rejects invalid pids", () => {
    expect(() => buildNudgeScript(0, "t", "m", true)).toThrow(/Invalid pid/);
    expect(() => buildNudgeScript(-5, "t", "m", true)).toThrow(/Invalid pid/);
    expect(() => buildNudgeScript(1.5, "t", "m", true)).toThrow(/Invalid pid/);
  });

  it("rejects titles containing single quotes (would break the PS literal)", () => {
    expect(() => buildNudgeScript(1, "bad'title", "m", true)).toThrow(/single quotes/);
  });
});

describe.skipIf(process.platform !== "win32")("launcher-nudge: live PowerShell probe", () => {
  it("probes a windowless child process end-to-end", async () => {
    // A plain node child owns no top-level windows — the probe must come
    // back cleanly negative (this exercises powershell.exe, the
    // -EncodedCommand plumbing, the Add-Type compile, EnumWindows, and
    // the JSON round-trip).
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      const result = await inspectProcessWindows(child.pid!);
      expect(result.error).toBeNull();
      expect(result.windowFound).toBe(false);
      expect(result.modalDetected).toBe(false);
      expect(result.enterPosted).toBe(false);
      expect(result.windowTitles).toEqual([]);
    } finally {
      child.kill("SIGKILL");
    }
  }, 30_000);
});
