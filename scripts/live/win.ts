/**
 * Read-only Windows queries the pre-flight and post-flight use: process list
 * (`tasklist`), TCP listeners (`netstat`), and their parsers. Pure parsers are
 * exported for tests; the commands themselves run only through an injected
 * `exec`, and callers run them only after the live gate has passed.
 *
 * Nothing in this module terminates, signals or writes to any process.
 */

import { execFileSync } from "node:child_process";

/** Synchronous command runner (argv array, no shell). */
export type ExecFn = (file: string, args: string[]) => string;

/** Default runner: execFileSync with a hidden window and a timeout. */
export const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { encoding: "utf-8", windowsHide: true, timeout: 20_000 });

/** Image name of the crash reporter that has held port 5775 as an orphan (plan 5.3 step 4). */
export const CRASH_REPORTER_IMAGE = "CrashReporter.exe";

export interface TasklistRow {
  image: string;
  pid: number;
}

/** Parse `tasklist /FO CSV /NH` output into rows. "INFO: No tasks..." yields none. */
export function parseTasklist(output: string): TasklistRow[] {
  const rows: TasklistRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m) rows.push({ image: m[1], pid: Number(m[2]) });
  }
  return rows;
}

/** Processes with the given image name. */
export function processesByImage(exec: ExecFn, image: string): TasklistRow[] {
  return parseTasklist(exec("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]));
}

/** The process with `pid`, or null. */
export function processByPid(exec: ExecFn, pid: number): TasklistRow | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return parseTasklist(exec("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]))[0] ?? null;
}

/**
 * Pids listening on TCP `port`, from `netstat -ano -p TCP` output. Matches
 * local addresses ending in `:<port>` in the LISTENING state (IPv4 and IPv6).
 */
export function parseNetstatListeners(output: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    if (!cols[1].endsWith(`:${port}`)) continue;
    if (cols[3].toUpperCase() !== "LISTENING") continue;
    const pid = Number(cols[4]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Pids listening on TCP `port`. */
export function portListeners(exec: ExecFn, port: number): number[] {
  return parseNetstatListeners(exec("netstat", ["-ano", "-p", "TCP"]), port);
}
