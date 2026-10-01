/**
 * One-shot Windows PowerShell runner for the harness, in the same shape as
 * `src/workbench/launcher-nudge.ts`: the script travels as -EncodedCommand
 * (base64 UTF-16LE) so no command-line quoting is involved, and values the
 * caller supplies travel as environment variables, never interpolated into
 * the script text.
 *
 * Callers decide whether a real run is allowed (the live gate in cli.ts);
 * this module refuses outright on any platform other than win32.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface PowerShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Non-null when PowerShell could not run or exited non-zero. */
  error: string | null;
}

/** Full path of Windows PowerShell 5.1 when present, else the bare name. */
export function powershellExe(env: NodeJS.ProcessEnv = process.env): string {
  const sysRoot = env.SystemRoot ?? "C:\\Windows";
  const full = join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(full) ? full : "powershell.exe";
}

/** The argv PowerShell is started with for `script`. Exported for tests and dry runs. */
export function powershellArgs(script: string): string[] {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
}

/** Run `script` once. `env` entries are added to the child's environment. */
export function runPowerShell(
  script: string,
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<PowerShellResult> {
  if (process.platform !== "win32") {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: "",
      error: "PowerShell steps are Windows-only",
    });
  }
  return new Promise((resolvePromise) => {
    execFile(
      powershellExe(),
      powershellArgs(script),
      {
        timeout: opts.timeoutMs ?? 30_000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ...(opts.env ?? {}) },
      },
      (err, stdout, stderr) => {
        resolvePromise({
          ok: !err,
          stdout: String(stdout),
          stderr: String(stderr),
          error: err ? err.message : null,
        });
      },
    );
  });
}

/** Last non-empty line of PowerShell output (where the scripts print their JSON). */
export function lastLine(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 ? lines[lines.length - 1] : null;
}
