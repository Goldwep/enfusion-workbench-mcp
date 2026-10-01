/**
 * Full-desktop screenshot to the artifacts folder (plan 5.3 "During": on any
 * timeout, capture the full desktop before deciding anything).
 *
 * win32 only: Windows PowerShell with System.Windows.Forms and System.Drawing
 * copies the virtual screen (all monitors) into a PNG. The output path reaches
 * the script through an environment variable, never through the script text.
 * Elsewhere the step reports `skipped`. Screenshots are raw material and stay
 * in the artifacts folder, outside every git working tree (plan 4.2).
 *
 * Usage: npx tsx scripts/live/capture.ts [--label <name>] [--id <lane id>] [--really]
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import { artifactsDir } from "./paths.js";
import { lastLine, runPowerShell } from "./powershell.js";

/** Environment variable carrying the output path into the PowerShell script. */
export const CAPTURE_PATH_ENV = "EMCP_CAPTURE_PATH";

/** The PowerShell script: virtual-screen capture to $env:EMCP_CAPTURE_PATH as PNG. */
export const CAPTURE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
  "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "try {",
  "  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)",
  `  $bmp.Save($env:${CAPTURE_PATH_ENV}, [System.Drawing.Imaging.ImageFormat]::Png)`,
  "} finally { $g.Dispose(); $bmp.Dispose() }",
  "Write-Output ('{\"width\":' + $b.Width + ',\"height\":' + $b.Height + '}')",
].join("\n");

export interface CaptureResult {
  ok: boolean;
  skipped: boolean;
  path: string;
  detail: string;
}

/** Artifact file name for a capture: `desktop-<label>-<timestamp>.png`. */
export function captureFileName(label: string, now: Date = new Date()): string {
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 48) || "capture";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `desktop-${safe}-${stamp}.png`;
}

/**
 * Capture the desktop. `gateReason` comes from the live gate: when non-null
 * the capture is not taken and the result says why.
 */
export async function captureDesktop(opts: {
  label?: string;
  dir?: string;
  gateReason: string | null;
  now?: Date;
}): Promise<CaptureResult> {
  const dir = opts.dir ?? artifactsDir();
  const path = join(dir, captureFileName(opts.label ?? "capture", opts.now));
  if (opts.gateReason !== null) {
    return { ok: true, skipped: true, path, detail: `${opts.gateReason}; would write ${path}` };
  }
  mkdirSync(dir, { recursive: true });
  const r = await runPowerShell(CAPTURE_SCRIPT, { env: { [CAPTURE_PATH_ENV]: path } });
  if (!r.ok) return { ok: false, skipped: false, path, detail: r.error ?? r.stderr };
  return { ok: true, skipped: false, path, detail: lastLine(r.stdout) ?? "captured" };
}

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv, ["label", "id", "lease-path", "marker-path", "dir"]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const lane = args.options.id
    ? new Lane({
        id: args.options.id,
        leasePath: args.options["lease-path"],
        markerPath: args.options["marker-path"],
      })
    : null;
  const gateReason = liveGateReason({
    really: args.flags.has("really"),
    platform: process.platform,
    leaseHeld: lane ? lane.holdsLease() : false,
  });
  const r = await captureDesktop({ label: args.options.label, dir: args.options.dir, gateReason });
  console.log(`${r.skipped ? "skipped" : r.ok ? "captured" : "FAILED"}: ${r.detail}`);
  return r.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
