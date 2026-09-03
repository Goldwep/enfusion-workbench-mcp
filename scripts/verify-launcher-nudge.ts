/**
 * Live verification of the Win32 launcher-nudge plumbing WITHOUT
 * touching Workbench: spawns a minimized WinForms window in a
 * PowerShell child, then drives the real nudgeWindowByTitle path
 * against it — find-by-pid+title, IsIconic evidence, posted
 * SC_RESTORE, posted VK_RETURN — and proves the restore actually
 * processed by re-probing the minimized state.
 *
 * Usage: npx tsx scripts/verify-launcher-nudge.ts
 */

import { spawn } from "node:child_process";
import { nudgeWindowByTitle } from "../src/workbench/launcher-nudge.js";

const TITLE = "EMCP Nudge Verify Window";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

if (process.platform !== "win32") {
  console.error("SKIP: Windows-only verification");
  process.exit(1);
}

// -STA because WinForms requires a single-threaded apartment;
// Application::Run pumps messages so our posted WM_* get processed.
const host = spawn(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-STA",
    "-Command",
    `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = '${TITLE}'; $f.WindowState = 'Minimized'; [System.Windows.Forms.Application]::Run($f)`,
  ],
  { stdio: "ignore" },
);

let failed = false;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

try {
  await sleep(2500); // window creation
  const pid = host.pid!;

  const probe1 = await nudgeWindowByTitle(pid, { targetTitle: TITLE, doNudge: false });
  console.log(`probe1: ${JSON.stringify(probe1)}`);
  check("window found by pid+title", probe1.windowFound && probe1.error === null);
  check("window reported minimized before nudge", probe1.wasMinimized);
  check("dry run posts nothing", !probe1.restored && !probe1.enterPosted);

  const nudge = await nudgeWindowByTitle(pid, { targetTitle: TITLE, doNudge: true });
  console.log(`nudge:  ${JSON.stringify(nudge)}`);
  check("SC_RESTORE + VK_RETURN posted", nudge.restored && nudge.enterPosted);

  await sleep(1500); // let the window process the posted messages
  const probe2 = await nudgeWindowByTitle(pid, { targetTitle: TITLE, doNudge: false });
  console.log(`probe2: ${JSON.stringify(probe2)}`);
  check("window still present after nudge", probe2.windowFound);
  check("window NO LONGER minimized (SC_RESTORE processed)", !probe2.wasMinimized);
} finally {
  host.kill("SIGKILL");
}

process.exit(failed ? 1 : 0);
