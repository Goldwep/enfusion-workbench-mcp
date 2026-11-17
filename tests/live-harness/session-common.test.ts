import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../scripts/live/paths.js";
import * as sa from "../../scripts/live/s-a-headless.js";
import * as common from "../../scripts/live/session-common.js";
import { buildQueue } from "../../scripts/live/s-c-natives.js";

// DEC-032: the patterns S-A got in DEC-030 and DEC-031 live once, in session-common.ts, and all
// three session scripts use them. Everything here is synthetic.

const QUEUES = join(REPO_ROOT, "docs", "v2", "sessions", "queues");

describe("session-common: one shared copy (DEC-032)", () => {
  it("S-A re-exports the shared functions themselves, not copies", () => {
    expect(sa.killOwnWorkbench).toBe(common.killOwnWorkbench);
    expect(sa.descendantPlan).toBe(common.descendantPlan);
    expect(sa.readProjectLists).toBe(common.readProjectLists);
    expect(sa.registration).toBe(common.registration);
    expect(sa.runStartedPids).toBe(common.runStartedPids);
    expect(sa.recoverRecords).toBe(common.recoverRecords);
    expect(sa.outsideArtifacts).toBe(common.outsideArtifacts);
    expect(sa.spawnWithExit).toBe(common.spawnWithExit);
    expect(sa.MAX_RECOVERIES).toBe(common.MAX_RECOVERIES);
  });

  it("no session script defines its own kill, recover or launcher-list reader any more", () => {
    for (const f of ["s-a-headless.ts", "s-b-scratch-profile.ts", "s-c-natives.ts"]) {
      const src = readFileSync(join(REPO_ROOT, "scripts", "live", f), "utf-8");
      expect(src, f).not.toMatch(/export (async )?function killOwnWorkbench/);
      expect(src, f).not.toMatch(/export function readProjectLists/);
      expect(src, f).not.toMatch(/export function runStartedPids/);
      expect(src, f).not.toMatch(/PROCESS_TREE_SCRIPT = \[/);
    }
  });

  it("the process table reads CPU time too, read only, and a missing figure is null (DEC-034)", () => {
    expect(common.PROCESS_TREE_SCRIPT).toContain("KernelModeTime");
    expect(common.PROCESS_TREE_SCRIPT).toContain("UserModeTime");
    expect(common.PROCESS_TREE_SCRIPT).toContain("cpu_ms = $u");
    // One read-only source, nothing interpolated, nothing that writes or ends.
    expect(common.PROCESS_TREE_SCRIPT.match(/Get-CimInstance/g)).toHaveLength(1);
    expect(common.PROCESS_TREE_SCRIPT).not.toMatch(
      /Stop-Process|Invoke-CimMethod|Terminate|\$env:/,
    );
    expect(
      common.parseProcessTable(
        '[{"pid":4,"ppid":0,"name":"System","created":null,"cpu_ms":12345},{"pid":8,"ppid":4,"name":"x.exe","created":5}]',
      ),
    ).toEqual([
      { pid: 4, ppid: 0, name: "System", created: null, cpu_ms: 12345 },
      { pid: 8, ppid: 4, name: "x.exe", created: 5, cpu_ms: null },
    ]);
  });

  it("started markers of any session name their pids (S-A, S-B and S-C steps)", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-common-"));
    try {
      const m = (step: string, pid: number) =>
        JSON.stringify({ step, started_at: "x", pid, created: pid * 10 });
      writeFileSync(join(dir, "S-A-3.started"), m("S-A-3", 3));
      writeFileSync(join(dir, "S-B.started"), m("S-B", 2));
      writeFileSync(join(dir, "sc-09-u29-cold.started.acknowledged"), m("sc-09-u29-cold", 9));
      writeFileSync(join(dir, "S-B.json"), "{}");
      expect(common.runStartedPids(dir)).toEqual([
        { step: "S-A-3", pid: 3, created: 30 },
        { step: "S-B", pid: 2, created: 20 },
        { step: "sc-09-u29-cold", pid: 9, created: 90 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts a session's started markers across the run folders of the sitting", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-common-"));
    try {
      const a = join(root, "run-a");
      const b = join(root, "run-b");
      mkdirSync(a);
      mkdirSync(b);
      writeFileSync(join(b, "S-B.started"), "{}");
      writeFileSync(join(b, "S-A-1.started"), "{}");
      const since = Date.now() - 60_000;
      expect(common.sittingStartedMarkers(a, since, /^S-B$/)).toEqual([
        { folder: b, file: "S-B.started" },
      ]);
      // With no lease start, the run folder alone.
      expect(common.sittingStartedMarkers(a, null, /^S-B$/)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("childWorkbenchRows finds a stub's engine created after it, never an older or other image", () => {
    const WB = "ArmaReforgerWorkbenchSteamDiag.exe";
    const rows = [
      { pid: 10, ppid: 1, name: WB, created: 100 },
      { pid: 11, ppid: 10, name: WB, created: 200 },
      { pid: 12, ppid: 10, name: "steam.exe", created: 300 },
      { pid: 13, ppid: 10, name: WB, created: 50 },
    ];
    expect(common.childWorkbenchRows(rows, 10).map((r) => r.pid)).toEqual([11]);
  });

  it("profileDirOf is wb-deps.ts's rule: the profile folder beside the addons folder", () => {
    expect(common.profileDirOf(join("x", "y", "addons"))).toBe(
      join(process.cwd(), "x", "y", "profile"),
    );
  });
});

describe("no tree flag anywhere (DEC-031, extended to S-B and S-C by DEC-032)", () => {
  it("no script of the live lane and no session document passes a tree flag to taskkill", () => {
    const files = [
      ...readdirSync(join(REPO_ROOT, "scripts", "live"))
        .filter((n) => n.endsWith(".ts"))
        .map((n) => join(REPO_ROOT, "scripts", "live", n)),
      ...readdirSync(QUEUES).map((n) => join(QUEUES, n)),
    ];
    expect(files.some((f) => f.endsWith("S-B.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("S-C-queue.json"))).toBe(true);
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      expect(text, file).not.toMatch(/\/T \/F|"\/T"|\/T\/F/);
    }
  });

  it("the S-B and S-C runbooks point at their recover subcommand and print no bare taskkill", () => {
    for (const [doc, cmd] of [
      ["S-B.md", "s-b-scratch-profile.ts recover --run"],
      ["S-C.md", "s-c-natives.ts recover --run-dir"],
    ] as const) {
      const text = readFileSync(join(QUEUES, doc), "utf-8");
      expect(text, doc).toContain(cmd);
      for (const line of text.split("\n")) {
        if (/taskkill/.test(line)) expect(line, doc).toMatch(/recover|\/PID <p> \/F|at a time/);
      }
    }
    const queue = readFileSync(join(QUEUES, "S-B-queue.json"), "utf-8");
    expect(queue).toContain("s-b-scratch-profile.ts recover");
  });

  it("the S-C runbook's block table is the queue's, and every invocation runs in the background", () => {
    const text = readFileSync(join(QUEUES, "S-C.md"), "utf-8");
    const q = buildQueue() as {
      invocation_blocks: Array<{ from: string; until: string; worst_case_ms: number }>;
    };
    for (const b of q.invocation_blocks) {
      const sel = b.from === b.until ? `--only ${b.from}` : `--from ${b.from} --until ${b.until}`;
      const secs = Math.ceil(b.worst_case_ms / 1000).toLocaleString("en-US");
      // Prettier pads the table's columns: compare the cells, not the spacing.
      const row = text
        .split("\n")
        .map((l) => l.split("|").map((c) => c.trim()))
        .find((cells) => cells[1] === `\`${sel}\``);
      expect(row?.[2], sel).toBe(`${secs} s`);
    }
    expect(text).toContain("background command");
    expect(text).toContain("--walker-cmd '<walker argv, below>'");
    expect(text).toContain("S-C block done");
  });

  it("the S-B runbook states the invocation's worst case, the background run and the last line", () => {
    const text = readFileSync(join(QUEUES, "S-B.md"), "utf-8");
    expect(text).toContain("about 830 s");
    expect(text).toContain("background command with an explicit timeout of 1,000,000 ms");
    expect(text).toContain("`S-B done: outcome completed, …`");
    expect(text).toContain(
      '--registry-key "HKCU\\Software\\Bohemia Interactive\\Arma Reforger Workbench"',
    );
  });
});
