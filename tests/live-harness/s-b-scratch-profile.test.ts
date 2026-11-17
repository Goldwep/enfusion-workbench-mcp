import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRegText,
  type PersonalContext,
} from "../../scripts/census/enumerators/e06-settings-store.js";
import { checkPlan } from "../../scripts/live/dry-run.js";
import { Lane } from "../../scripts/live/lane.js";
import { WORKBENCH_EXE, type LaunchPlan } from "../../scripts/live/launch.js";
import type { NetCallResult } from "../../scripts/live/netcall.js";
import { loadPolicy } from "../../scripts/live/policy.js";
import { CLOSE_ALL_SCRIPT, CLOSE_SCRIPT, readForcedKills } from "../../scripts/live/postflight.js";
import { startedMarkerPath, type ProjectListFile } from "../../scripts/live/session-common.js";
import { FILE_VERSION_SCRIPT, validateQueue } from "../../scripts/live/preflight.js";
import {
  COMPARE_FAILED_REASON,
  DEFAULT_QUEUE,
  DEFAULT_TIMEOUTS,
  DONE_LINE,
  invocationWorstCaseMs,
  NATIVE_CALL,
  NOT_CLOSED_REASON,
  PROBES,
  SCRIPT_PATH,
  SILENT_CRASH_FLAG,
  ScrubRefusal,
  TOP_WINDOWS_SCRIPT,
  U12_FAIL_CONSEQUENCE,
  actionPlan,
  buildScratchIni,
  diffRegistryExports,
  identifierReason,
  iniEscapedKey,
  iniEscapedString,
  keyShapeReason,
  main,
  namesSandbox,
  planLaunch,
  powershellTimeoutMs,
  redact,
  runSession,
  forceSettingsEvidence,
  sandboxRefusal,
  scrubFreeText,
  u12Verdict,
  windowsForEvidence,
  type SessionDeps,
  type SessionOptions,
  type TopWindow,
} from "../../scripts/live/s-b-scratch-profile.js";

// ── Synthetic personal data, assembled at test time (DEC-021 rule 3) ─────────

const ACCOUNT = ["pl", "anted", "Acct"].join("");
const HOST = ["TEST", "BOX", "77"].join("-");
const HOME = ["C:", "Users", ACCOUNT].join("\\");
const MAIL = ["someone", "example.org"].join("@");
const STEAM = ["7656119", "8", "123456789"].join("");
/** An owner project name; nothing redacts it since the owner patterns went with the PII gate (DEC-060). */
const PROJECT = ["Zq", "Owner", "Mod"].join("");
const PERSONAL: PersonalContext = { accountNames: [ACCOUNT], hostNames: [HOST] };

const ROOT_KEY = "HKEY_CURRENT_USER\\Software\\Bohemia Interactive\\Arma Reforger Workbench";

/** A `.reg` string literal: backslashes and quotes escaped. */
function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function utf16Hex(s: string): string {
  return [...Buffer.from(s, "utf16le")].map((b) => b.toString(16).padStart(2, "0")).join(",");
}

/** A synthetic export: keys under the Workbench root, values as `.reg` lines. */
function regText(keys: Record<string, string[]>): string {
  const out = ["Windows Registry Editor Version 5.00", ""];
  for (const [path, lines] of Object.entries(keys)) {
    out.push(`[${ROOT_KEY}${path ? `\\${path}` : ""}]`, ...lines, "");
  }
  return out.join("\r\n");
}

function regFile(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
}

function baseExport(extra: Record<string, string[]> = {}): Record<string, string[]> {
  return {
    "": ['"rootFlag"="1"'],
    Workbench: ['"NetAPI_Enabled"="1"', '"AutoRebuildScripts"="0"', '"legacyOptionsLoaded"="true"'],
    "World Editor": [
      '"cameraSpeed"="2.5"',
      `"lastWorld"=${q(`${HOME}\\Documents\\w.ent`)}`,
      '"note"="a;b"',
      `"owner"=${q(MAIL)}`,
      `"steam"=${q(STEAM)}`,
      `"layoutBlob"=hex:${utf16Hex("@ByteArray(abc)")}`,
      '"count"=dword:0000000a',
    ],
    "World Editor\\Tools\\Move": ['"Snap"="true"'],
    "World Editor\\RecentFiles": ['"1"="worlds/a.ent"'],
    "Resource Manager\\ScriptTools": [`"SomePlugin"=hex(7):${utf16Hex("Plugin {\0}\0\0")}`],
    [`Game Project Manager\\${ACCOUNT}`]: ['"x"="1"'],
    "Workbench\\PropertyGrid\\unnamed": ['"Common>Save"="true"'],
    "Game Project Manager\\AddonPresets": [`"lastPreset"=${q(PROJECT)}`],
    ...extra,
  };
}

function parse(keys: Record<string, string[]>) {
  return parseRegText(regText(keys));
}

// ── Pure pieces ──────────────────────────────────────────────────────────────

describe("ini escaping (QSettings IniFormat rules)", () => {
  it("escapes keys", () => {
    expect(iniEscapedKey("World Editor")).toBe("World%20Editor");
    expect(iniEscapedKey("a/b")).toBe("a\\b");
    expect(iniEscapedKey("Common>Save")).toBe("Common%3ESave");
    expect(iniEscapedKey("NetAPI_Enabled")).toBe("NetAPI_Enabled");
  });

  it("escapes and quotes strings", () => {
    expect(iniEscapedString("plain")).toBe("plain");
    expect(iniEscapedString("a;b")).toBe('"a;b"');
    expect(iniEscapedString(" x")).toBe('" x"');
    expect(iniEscapedString('a\\b"c')).toBe('a\\\\b\\"c');
    expect(iniEscapedString("l1\nl2")).toBe("l1\\nl2");
    expect(iniEscapedString("\x01a")).toBe("\\x1\\x61");
  });
});

describe("buildScratchIni", () => {
  it("keeps the NET API keys and scalars, drops paths, personal data, binaries and excluded subtrees", () => {
    const ini = buildScratchIni(parse(baseExport()), PERSONAL, {});
    expect(ini.netApi).toEqual({ NetAPI_Enabled: "1" });
    expect(ini.text).toContain("[Workbench]\r\n");
    expect(ini.text).toContain("NetAPI_Enabled=1\r\n");
    expect(ini.text).toContain("[General]\r\nrootFlag=1");
    expect(ini.text).toContain("[World%20Editor]");
    expect(ini.text).toContain("Tools\\Move\\Snap=true");
    expect(ini.text).toContain('note="a;b"');
    expect(ini.text).toContain("count=10");
    expect(ini.text).toContain("PropertyGrid\\unnamed\\Common%3ESave=true");
    for (const bad of [
      ACCOUNT,
      HOME,
      MAIL,
      STEAM,
      "Users\\",
      "w.ent",
      "a.ent",
      "ByteArray",
      "Plugin",
    ]) {
      expect(ini.text).not.toContain(bad);
    }
    expect(ini.dropped["recent-file-list"]).toBe(1);
    expect(ini.dropped["type:REG_BINARY"]).toBe(1);
    expect(ini.dropped["type:REG_MULTI_SZ"]).toBe(1);
    expect(ini.dropped["personal-key:account-name"]).toBe(1);
    // `lastWorld` holds a path, but its name already marks a last-opened list (DEC-032, m7).
    expect(ini.dropped["recent-list"]).toBe(1);
    expect(ini.dropped["personal-value:e-mail"]).toBe(1);
    expect(ini.dropped["personal-value:steam-id"]).toBe(1);
  });

  it("refuses when the export holds no NetAPI_Enabled", () => {
    const keys = baseExport();
    keys.Workbench = ['"AutoRebuildScripts"="0"'];
    expect(() => buildScratchIni(parse(keys), PERSONAL, {})).toThrow(ScrubRefusal);
  });

  it("refuses when the NET API is disabled in the export (enabling it is a settings write)", () => {
    const keys = baseExport();
    keys.Workbench = ['"NetAPI_Enabled"="0"'];
    expect(() => buildScratchIni(parse(keys), PERSONAL, {})).toThrow(/U22/);
  });

  it("drops a machine path split into key segments (drive segment), and any path in the whole key", () => {
    const keys = baseExport({
      "Resource Manager\\Paths\\D:\\SteamLibrary\\steamapps\\common": ['"x"="1"'],
      "Resource Manager\\Disk D:\\Games": ['"y"="1"'],
    });
    const ini = buildScratchIni(parse(keys), PERSONAL, {});
    expect(ini.text).not.toContain("SteamLibrary");
    expect(ini.text).not.toContain("Games");
    expect(ini.text).not.toContain("%3A");
    expect(ini.dropped["drive-segment"]).toBe(1);
    expect(Object.keys(ini.dropped).some((k) => k.startsWith("personal-key:"))).toBe(true);
  });

  it("drops recent lists under any spelling, UNC paths, GUIDs, long hex ids and base64 blobs", () => {
    const keys = baseExport({
      "World Editor\\Recent Files": ['"1"="worlds_a"'],
      "Game Project Manager\\RecentProjects": ['"0"="SomeMod"'],
      "Script Editor\\MRU": ['"0"="thing"'],
      "Script Editor": [
        '"recentFile0"="bare"',
        `"share"=${q("\\\\NASBOX01\\mods")}`,
        '"clientId"="{0f8fad5b-d9cb-469f-a165-70867728950e}"',
        '"deviceId"="a3f9c2e1b4d6e8f0a1b2c3d4e5f60718"',
        '"blob"="QzpcVXNlcnNcc29tZW9uZVxEb2N1bWVudHM="',
        '"fontSize"="12"',
        '"theme"="DarkTheme"',
      ],
    });
    const ini = buildScratchIni(parse(keys), PERSONAL, {});
    for (const bad of [
      "worlds_a",
      "SomeMod",
      "thing",
      "bare",
      "NASBOX01",
      "0f8fad5b",
      "a3f9c2e1",
      "QzpcVXNlcnNc",
    ]) {
      expect(ini.text).not.toContain(bad);
    }
    expect(ini.text).toContain("fontSize=12");
    expect(ini.text).toContain("theme=DarkTheme");
    // Four here, and the base export's `lastWorld` (a last-opened name, DEC-032 m7).
    expect(ini.dropped["recent-list"]).toBe(5);
    expect(ini.dropped["personal-value:unc-path"]).toBe(1);
    expect(ini.dropped["personal-value:guid"]).toBe(1);
    expect(ini.dropped["personal-value:long-hex-id"]).toBe(1);
    expect(ini.dropped["personal-value:base64-like"]).toBe(1);
  });

  it("shape rules: what they catch and what they let through", () => {
    expect(keyShapeReason(["Paths", "C:"])).toBe("drive-segment");
    expect(keyShapeReason(["Paths", "", "host"])).toBe("unc-segment");
    expect(keyShapeReason(["Workbench", "History"])).toBe("recent-list");
    expect(keyShapeReason(["Workbench", "PropertyGrid"])).toBeNull();
    expect(identifierReason("\\\\host\\share")).toBe("unc-path");
    expect(identifierReason("//host/share")).toBe("unc-path");
    expect(identifierReason("https://example.org/x")).toBeNull();
    expect(identifierReason("true")).toBeNull();
    expect(identifierReason("2.5")).toBeNull();
    expect(identifierReason("AutoRebuildScriptsOnSave")).toBeNull();
    expect(identifierReason("1234567890")).toBeNull();
  });

  it("refuses when the finished text still holds a known absolute path", () => {
    const keys = baseExport();
    keys.Workbench = ['"NetAPI_Enabled"="1"', '"tag"="zz-sandboxdir-zz"'];
    expect(() => buildScratchIni(parse(keys), PERSONAL, { sandbox: "zz-sandboxdir-zz" })).toThrow(
      /known absolute path/,
    );
  });
});

describe("diffRegistryExports", () => {
  it("reports nothing for identical exports", () => {
    expect(diffRegistryExports(parse(baseExport()), parse(baseExport()), PERSONAL)).toEqual([]);
  });

  it("reports every added, removed and changed value and key, with personal data redacted", () => {
    const after = baseExport({ "Script Editor": ['"DBG_PORT"="1000"'] });
    after.Workbench = ['"NetAPI_Enabled"="1"', '"AutoRebuildScripts"="1"'];
    after["World Editor"] = [...after["World Editor"]].map((l) =>
      l.startsWith('"lastWorld"') ? `"lastWorld"=${q(`${HOME}\\other.ent`)}` : l,
    );
    delete after["World Editor\\Tools\\Move"];
    const d = diffRegistryExports(parse(baseExport()), parse(after), PERSONAL);
    const kinds = d.map((x) => `${x.change} ${x.key} ${x.value ?? ""}`.trim());
    expect(kinds).toContain("key-added Script Editor");
    expect(kinds).toContain("value-added Script Editor DBG_PORT");
    expect(kinds).toContain("key-removed World Editor\\Tools\\Move");
    expect(kinds).toContain("value-removed World Editor\\Tools\\Move Snap");
    expect(kinds).toContain("value-changed Workbench AutoRebuildScripts");
    expect(kinds).toContain("value-removed Workbench legacyOptionsLoaded");
    expect(kinds).toContain("value-changed World Editor lastWorld");
    const text = JSON.stringify(d);
    expect(text).not.toContain(ACCOUNT);
    expect(text).toContain("<redacted: machine-path>");
    expect(d.find((x) => x.value === "AutoRebuildScripts")).toMatchObject({
      before: "0",
      after: "1",
    });
  });
});

describe("redact and scrubFreeText", () => {
  it("redact replaces a whole personal string and leaves others", () => {
    expect(redact(`${ACCOUNT}`, PERSONAL)).toBe("<redacted: account-name>");
    expect(redact("EMCP2_sandbox - Workbench", PERSONAL)).toBe("EMCP2_sandbox - Workbench");
  });
  it("scrubFreeText replaces matches in place", () => {
    const s = scrubFreeText(`a b ${ACCOUNT.toUpperCase()} c ${HOST}`, PERSONAL);
    expect(s).toBe("a b <account> c <machine>");
  });
});

describe("namesSandbox", () => {
  const gproj = join("x", "addons", "EMCP2_sandbox", "EMCP2_sandbox.gproj");
  it("accepts the sandbox name or its gproj path, nothing else", () => {
    expect(namesSandbox("EMCP2_sandbox", gproj)).toBe(true);
    expect(namesSandbox("emcp2_SANDBOX", gproj)).toBe(true);
    expect(namesSandbox(gproj, gproj)).toBe(true);
    expect(namesSandbox("Test1_sandbox", gproj)).toBe(false);
    expect(namesSandbox("ArmaReforger", gproj)).toBe(false);
  });
  it("never accepts the launched project's own name when it is not the sandbox", () => {
    const owner = join("x", "addons", "OwnerMod", "OwnerMod.gproj");
    expect(namesSandbox("OwnerMod", owner)).toBe(false);
    expect(namesSandbox(owner, owner)).toBe(false);
  });
});

describe("u12Verdict", () => {
  const passing = {
    openedSandbox: true,
    launcherHeld: false,
    windowsAtReady: ["Main window"],
    netAnswered: true,
    graceful: true,
    registryDiff: [],
    iniWrittenBack: true,
  };
  it("passes only when every criterion passes", () => {
    const v = u12Verdict(passing);
    expect(v.verdict).toBe("pass");
    expect(v.launcherTreatsSandboxAsNew).toBe("no");
  });
  it("passes only with evidence that the ini was used: the write-back or a log naming it (DEC-032 M5)", () => {
    const noEvidence = { ...passing, iniWrittenBack: false, forceSettings: null };
    // The switch ignored: four passing criteria on the owner's registry are not a pass.
    expect(u12Verdict(noEvidence).verdict).toBe("incomplete");
    expect(u12Verdict(noEvidence).iniConsumed).toMatch(/cannot pass on this run/);
    const logNames = { echoed: true, namesIni: true, rejection: false };
    expect(u12Verdict({ ...noEvidence, forceSettings: logNames }).verdict).toBe("pass");
    expect(u12Verdict({ ...noEvidence, forceSettings: logNames }).iniConsumed).toMatch(
      /^yes by the session log/,
    );
    const rejected = { echoed: true, namesIni: true, rejection: true };
    expect(u12Verdict({ ...noEvidence, forceSettings: rejected }).verdict).toBe("incomplete");
    expect(u12Verdict({ ...noEvidence, forceSettings: rejected }).iniConsumed).toMatch(/^NO/);
    const echoOnly = { echoed: true, namesIni: false, rejection: false };
    expect(u12Verdict({ ...noEvidence, forceSettings: echoOnly }).verdict).toBe("incomplete");
  });
  it("forceSettingsEvidence reads the echo, a line naming the ini, and a rejection line", () => {
    const ini = join("x", "run", "scratch.ini");
    const echo = `12:00:00.000 ENGINE : CLI Params: -gproj a.gproj -forceSettings ${ini} -noThrow`;
    expect(forceSettingsEvidence(echo, ini)).toEqual({
      echoed: true,
      namesIni: true,
      rejection: false,
    });
    expect(
      forceSettingsEvidence(`${echo}\n12:00:01.000 ENGINE : Unknown parameter forceSettings`, ini),
    ).toMatchObject({ rejection: true });
    expect(forceSettingsEvidence("12:00:00.000 ENGINE : nothing", ini)).toEqual({
      echoed: false,
      namesIni: false,
      rejection: false,
    });
  });
  it("fails on any registry difference and states the plan's branch", () => {
    const v = u12Verdict({
      ...passing,
      registryDiff: [{ change: "value-added", key: "Workbench" }],
    });
    expect(v.verdict).toBe("fail");
    expect(v.consequence).toBe(U12_FAIL_CONSEQUENCE);
    expect(v.consequence).toContain("owner's decision on registry save and restore");
  });
  it("does not trust a registry comparison without a graceful exit", () => {
    const v = u12Verdict({ ...passing, graceful: false, registryDiff: [] });
    expect(v.criteria[3].result).toBe("not-observed");
    expect(v.verdict).toBe("incomplete");
  });
  it("reports the launcher hold as the sandbox treated as new", () => {
    const v = u12Verdict({
      openedSandbox: null,
      launcherHeld: true,
      windowsAtReady: null,
      netAnswered: null,
      graceful: true,
      registryDiff: [],
      registeredBefore: true,
    });
    expect(v.launcherTreatsSandboxAsNew).toBe("yes");
    expect(v.verdict).toBe("incomplete");
    // A hold on a project the lists did not all name answers nothing (DEC-032 M3).
    const unregistered = u12Verdict({
      openedSandbox: null,
      launcherHeld: true,
      windowsAtReady: null,
      netAnswered: null,
      graceful: true,
      registryDiff: [],
      registeredBefore: false,
    });
    expect(unregistered.launcherTreatsSandboxAsNew).toBe(
      "not observed (the launcher held on an unregistered project)",
    );
  });
  it("fails when the NET API does not answer", () => {
    expect(u12Verdict({ ...passing, netAnswered: false }).verdict).toBe("fail");
  });
  it("states the -noThrow confound on the first-run-dialog criterion when the flag rode", () => {
    const on = u12Verdict({ ...passing, launchFlags: ["-disableCrashReport", "-noThrow"] });
    expect(on.criteria[2].detail).toContain("observed with -noThrow on");
    const off = u12Verdict({ ...passing, launchFlags: ["-disableCrashReport"] });
    expect(off.criteria[2].detail).not.toContain("-noThrow");
  });
  it("reports whether the ini was consumed beside the four criteria", () => {
    expect(u12Verdict({ ...passing, iniWrittenBack: true }).iniConsumed).toMatch(/^yes/);
    expect(u12Verdict({ ...passing, iniWrittenBack: false }).iniConsumed).toMatch(
      /only consistent with it being read/,
    );
    expect(u12Verdict({ ...passing, iniWrittenBack: undefined }).iniConsumed).toBe("not observed");
    // Since DEC-032 (M5) a run that shows no use of the ini is not a pass.
    expect(u12Verdict({ ...passing, iniWrittenBack: false }).verdict).toBe("incomplete");
  });
});

describe("powershellTimeoutMs", () => {
  it("outlasts the close wait it carries, whatever --close-timeout-ms is", () => {
    for (const ms of [DEFAULT_TIMEOUTS.closeMs, 200_000, 600_000]) {
      expect(powershellTimeoutMs(ms)).toBeGreaterThan(ms);
    }
  });
});

describe("windowsForEvidence and the window-list script", () => {
  it("withholds the titles of other processes", () => {
    const rows: TopWindow[] = [
      { pid: 10, className: "Qt", title: "Workbench" },
      { pid: 99, className: "Chrome", title: `${ACCOUNT} inbox` },
    ];
    const shown = windowsForEvidence(rows, [10]);
    expect(shown[0].title).toBe("Workbench");
    expect(JSON.stringify(shown)).not.toContain(ACCOUNT);
  });
  it("only enumerates: no message is posted or sent, no input synthesised", () => {
    expect(TOP_WINDOWS_SCRIPT).toContain("EnumWindows");
    for (const forbidden of [
      "PostMessage",
      "SendMessage",
      "SendInput",
      "keybd_event",
      "SendKeys",
    ]) {
      expect(TOP_WINDOWS_SCRIPT).not.toContain(forbidden);
    }
  });
});

describe("script source", () => {
  const src = readFileSync(join(__dirname, "..", "..", SCRIPT_PATH), "utf-8");
  it("never kills, never sends keys, never writes the registry itself", () => {
    expect(src).not.toMatch(/exec\(\s*["']taskkill/);
    expect(src).not.toMatch(/\.kill\(/);
    expect(src).not.toMatch(/SendKeys|keybd_event|SendInput/);
    expect(src).not.toMatch(/exec\(\s*["']reg["']/);
    expect(src).not.toMatch(/kind:\s*"(key|invoke|menu-open|execute-action)"/);
  });
});

// ── Dry run and the action-plan checker ──────────────────────────────────────

describe("the dry-run action plan", () => {
  it("passes the checker with the current policy", () => {
    const r = checkPlan(actionPlan() as never, loadPolicy(), { script: SCRIPT_PATH });
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("holds exactly one launch and one NET call and no key, invoke, menu or execute-action", () => {
    const plan = actionPlan();
    expect(plan.map((a) => a.kind)).toEqual(["launch", "net-call", "screenshot"]);
    expect(plan[0]).toMatchObject({ target: { gproj: join("<sandbox>", "EMCP2_sandbox.gproj") } });
    expect(plan[0].args).toEqual([
      "-gproj",
      join("<sandbox>", "EMCP2_sandbox.gproj"),
      "-forceSettings",
      join("<artifacts>", "sessions", "S-B", "<stamp>", "scratch.ini"),
      "-disableCrashReport",
      "-noThrow",
    ]);
    expect(plan[1].target).toEqual({ apiFunc: NATIVE_CALL });
    expect(plan[1].retry).toBe(false);
  });
  it("the launch fails the checker when a flag is deny-listed or the project is not the sandbox", () => {
    const policy = loadPolicy();
    const bad = actionPlan(undefined, {
      gproj: join("<sandbox>", "EMCP2_sandbox.gproj"),
      args: ["-gproj", join("<sandbox>", "EMCP2_sandbox.gproj"), "-clearSettings"],
    });
    expect(checkPlan(bad as never, policy).violations.map((v) => v.rule)).toEqual([
      "deny-listed-switch",
    ]);
    const owner = join("<addons>", "OwnerMod", "OwnerMod.gproj");
    const other = actionPlan(undefined, { gproj: owner, args: ["-gproj", owner] });
    expect(checkPlan(other as never, policy).violations.map((v) => v.rule)).toEqual([
      "launch-not-sandbox",
    ]);
    // The owner's go adds -silentCrashReport, which no deny list holds today.
    expect(checkPlan(actionPlan(undefined, planLaunch(true)) as never, policy).ok).toBe(true);
  });
});

// ── The probe queue ──────────────────────────────────────────────────────────

describe("the S-B probe queue", () => {
  const raw = JSON.parse(readFileSync(DEFAULT_QUEUE, "utf-8"));
  it("validates without an owner yes above mutating, in risk order", () => {
    const q = validateQueue(raw, false);
    const ranks = q.map((p) => ["read-only", "reversible", "mutating"].indexOf(p.risk_class));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks.every((r) => r >= 0)).toBe(true);
  });
  it("covers every probe probes.jsonl schedules to S-B", () => {
    const lines = readFileSync(
      join(__dirname, "..", "..", "data", "census", "probes.jsonl"),
      "utf-8",
    )
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as { id: string; scheduled_session?: string });
    const latest = new Map<string, string>();
    for (const l of lines)
      if (l.scheduled_session !== undefined) latest.set(l.id, l.scheduled_session);
    const sb = [...latest]
      .filter(([, s]) => s.split(/\s*,\s*/).includes("S-B"))
      .map(([id]) => id)
      .sort();
    expect(sb.length).toBeGreaterThanOrEqual(7);
    const ids = new Set(validateQueue(raw, false).map((p) => p.id));
    for (const id of sb) expect(ids.has(id)).toBe(true);
    for (const id of Object.values(PROBES).flat()) expect(ids.has(id)).toBe(true);
  });
});

// ── The session against mocks ────────────────────────────────────────────────

const PID = 4242;
const FOREIGN_PID = 777;
const CRASH_PID = 888;
const PORT = 5775;

interface World {
  t: number;
  running: Set<number>;
  foreignWorkbench: boolean;
  listeners: number[];
  crashReporters: number[];
  listenAfterMs: number | null;
  logAfterMs: number | null;
  logLine: string;
  exitBeforeReady: boolean;
  closeExits: boolean;
  regBefore: string;
  regAfter: string;
  regExports: number;
  closeCalls: number;
  spawnArgs: string[] | null;
  launchedAt: number;
  netResult: NetCallResult;
  netCalls: number;
  captures: string[];
  topWindowCalls: number;
  windowTitles: string[];
  /** The per-pid window probe fails (Add-Type error, probe timeout, bad output). */
  windowProbeFails: boolean;
  /** What happens to the scratch ini when Workbench closes. */
  iniAtClose: "keep" | "rewrite" | "delete";
  /** The post-flight after-export: written, the export throws, or nothing written. */
  regAfterMode: "ok" | "throw" | "missing";
  spawnThrows: boolean;
  netThrows: boolean;
  /** The launcher project lists (null: two lists, both naming the rig's sandbox). */
  lists: ProjectListFile[] | null;
  /** Hidden IME-like windows of the started pid (EnumWindows lists visible ones only). */
  hiddenIme: boolean;
  /** The session log carries the `CLI Params:` echo of the launch (with the scratch ini). */
  echo: boolean;
  /** An extra log line (a rejection, say). */
  extraLogLine: string | null;
  /** A Workbench image the started pid brings up (a stub's engine), created after it. */
  childPid: number | null;
  /** The child, not the started pid, listens on the NET port. */
  childListens: boolean;
  /** The child keeps running after the started pid exits. */
  childOutlives: boolean;
}

/** The rig's gproj, for the default launcher lists of the mock. */
let currentGproj = "";

const OK_CALL: NetCallResult = {
  ok: true,
  response: { IsRunning: true, ScriptsCompiled: true },
  timedOut: false,
  bytesSent: 10,
  bytesReceived: 20,
  durationMs: 5,
};

function newWorld(o: Partial<World> = {}): World {
  return {
    t: Date.parse("2026-10-05T10:00:00Z"),
    running: new Set<number>(),
    foreignWorkbench: false,
    listeners: [],
    crashReporters: [],
    listenAfterMs: 5_000,
    logAfterMs: 3_000,
    logLine: "Using autosave directory: D:/x/Projects/EMCP2_sandbox/autosaves",
    exitBeforeReady: false,
    closeExits: true,
    regBefore: regText(baseExport()),
    regAfter: regText(baseExport()),
    regExports: 0,
    closeCalls: 0,
    spawnArgs: null,
    launchedAt: 0,
    netResult: OK_CALL,
    netCalls: 0,
    captures: [],
    topWindowCalls: 0,
    windowTitles: ["EMCP2_sandbox - Workbench"],
    windowProbeFails: false,
    iniAtClose: "keep",
    regAfterMode: "ok",
    spawnThrows: false,
    netThrows: false,
    lists: null,
    hiddenIme: false,
    echo: true,
    extraLogLine: null,
    childPid: null,
    childListens: false,
    childOutlives: false,
    ...o,
  };
}

const CHILD_PID = 4343;

function csv(image: string, pid: number): string {
  return `"${image}","${pid}","Console","1","10,000 K"`;
}

function mockDeps(w: World): SessionDeps {
  const listenersNow = (): number[] => {
    const out = [...w.listeners];
    if (w.listenAfterMs !== null && w.running.has(PID) && w.t - w.launchedAt >= w.listenAfterMs) {
      out.push(w.childListens && w.childPid !== null ? w.childPid : PID);
    }
    return out;
  };
  return {
    platform: "win32",
    now: () => new Date(w.t),
    sleep: async (ms) => {
      w.t += ms;
      if (w.exitBeforeReady && w.t - w.launchedAt > 4_000) {
        w.running.delete(PID);
        if (w.childPid !== null && !w.childOutlives) w.running.delete(w.childPid);
      }
    },
    projectLists: () =>
      w.lists ?? [
        { app: "1874880", readable: true, entries: [currentGproj], mtimeMs: 0 },
        { app: "1874910", readable: true, entries: [currentGproj], mtimeMs: 0 },
      ],
    processTable: async () =>
      [...w.running].map((p) => ({
        pid: p,
        ppid: p === w.childPid ? PID : 4,
        name: WORKBENCH_EXE,
        created: p === w.childPid ? 2_000 : 1_000,
      })),
    exec: (file, args) => {
      if (file === "tasklist") {
        const filter = args[1];
        const rows: string[] = [];
        if (filter === `IMAGENAME eq ${WORKBENCH_EXE}`) {
          if (w.foreignWorkbench) rows.push(csv(WORKBENCH_EXE, FOREIGN_PID));
          for (const p of w.running) rows.push(csv(WORKBENCH_EXE, p));
        } else if (filter === "IMAGENAME eq CrashReporter.exe") {
          for (const p of w.crashReporters) rows.push(csv("CrashReporter.exe", p));
        } else if (filter.startsWith("PID eq ")) {
          const p = Number(filter.slice(7));
          if (w.running.has(p)) rows.push(csv(WORKBENCH_EXE, p));
          if (w.crashReporters.includes(p)) rows.push(csv("CrashReporter.exe", p));
        }
        return rows.length
          ? rows.join("\r\n")
          : "INFO: No tasks are running which match the specified criteria.";
      }
      if (file === "netstat") {
        return listenersNow()
          .map(
            (p) => `  TCP    127.0.0.1:${PORT}         0.0.0.0:0              LISTENING       ${p}`,
          )
          .join("\r\n");
      }
      if (file === "reg") {
        expect(args[0]).toBe("export");
        w.regExports++;
        if (w.regExports > 1 && w.regAfterMode === "throw") throw new Error("reg export failed");
        if (w.regExports > 1 && w.regAfterMode === "missing") {
          return "The operation completed successfully.";
        }
        writeFileSync(args[2], regFile(w.regExports === 1 ? w.regBefore : w.regAfter));
        return "The operation completed successfully.";
      }
      throw new Error(`unexpected exec of ${file}`);
    },
    powershell: async (script, env) => {
      if (script === FILE_VERSION_SCRIPT) {
        return {
          ok: true,
          stdout: '{"file":"1.8.0.13","product":"1.8.0.13"}',
          stderr: "",
          error: null,
        };
      }
      // closeStep sends CLOSE_ALL_SCRIPT since DEC-064 (every main window in turn).
      if (script === CLOSE_ALL_SCRIPT || script === CLOSE_SCRIPT) {
        w.closeCalls++;
        expect(Number(env?.EMCP_PID)).toBe(PID);
        if (w.closeExits) w.running.delete(PID);
        const ini = w.spawnArgs?.[3];
        if (ini && w.iniAtClose === "rewrite") {
          writeFileSync(
            ini,
            `[General]\r\nx=1\r\n\r\n[Workbench]\r\nNetAPI_Enabled=1\r\n\r\n[${PROJECT}]\r\ny=2\r\n`,
          );
        }
        if (ini && w.iniAtClose === "delete") rmSync(ini);
        return {
          ok: true,
          stdout: JSON.stringify({ closeSent: true, exited: w.closeExits }),
          stderr: "",
          error: null,
        };
      }
      throw new Error("unexpected PowerShell script");
    },
    spawn: (plan: LaunchPlan, lane: Lane, gproj: string) => {
      if (w.spawnThrows) throw new Error("spawn EACCES");
      w.spawnArgs = plan.args;
      w.launchedAt = w.t;
      w.running.add(PID);
      if (w.childPid !== null) w.running.add(w.childPid);
      lane.record(PID, gproj);
      return PID;
    },
    netCall: async (apiFunc, params, opts) => {
      w.netCalls++;
      expect(apiFunc).toBe(NATIVE_CALL);
      expect(params).toEqual({});
      expect(opts.timeoutMs).toBe(DEFAULT_TIMEOUTS.netCallMs);
      if (w.netThrows) throw new Error("socket exploded");
      return w.netResult;
    },
    capture: async (label, dir) => {
      const path = join(dir, `desktop-${label}.png`);
      writeFileSync(path, "png");
      w.captures.push(label);
      return { ok: true, skipped: false, path, detail: "captured" };
    },
    topWindows: async () => {
      w.topWindowCalls++;
      if (w.windowProbeFails) throw new Error("powershell probe failed: Add-Type");
      return [
        ...w.windowTitles.map((title) => ({
          pid: PID,
          className: "QtMain",
          title,
          owner: 0,
          visible: true,
        })),
        // Hidden windows never come from the visible-only script; a row marked hidden must
        // still never count (DEC-032, S-B read M4).
        ...(w.hiddenIme
          ? [
              { pid: PID, className: "IME", title: "Default IME", owner: 0, visible: false },
              {
                pid: PID,
                className: "MSCTFIME UI",
                title: "MSCTFIME UI",
                owner: 0,
                visible: false,
              },
            ]
          : []),
        { pid: 31337, className: "OtherApp", title: `${ACCOUNT} private`, owner: 0, visible: true },
      ];
    },
    // inspectProcessWindows' list: hidden titled windows included (what S-B no longer uses).
    processWindows: async () => {
      if (w.windowProbeFails) throw new Error("powershell probe failed: Add-Type");
      return [...w.windowTitles, ...(w.hiddenIme ? ["Default IME", "MSCTFIME UI"] : [])];
    },
    findSessionLog: (_logs, after) =>
      w.logAfterMs !== null && w.t - after >= w.logAfterMs ? "session/console.log" : null,
    readText: () =>
      [
        ...(w.echo && w.spawnArgs
          ? [`12:00:00.000 ENGINE : CLI Params: ${w.spawnArgs.join(" ")}`]
          : []),
        `12:00:00.000 ENGINE : ${w.logLine}`,
        ...(w.extraLogLine ? [`12:00:00.000 ENGINE : ${w.extraLogLine}`] : []),
        "",
      ].join("\n"),
  };
}

interface Rig {
  root: string;
  lane: Lane;
  opts: (o?: Partial<SessionOptions>) => SessionOptions;
}

const rigs: string[] = [];
afterEach(() => {
  for (const r of rigs.splice(0)) rmSync(r, { recursive: true, force: true });
});

function rig(): Rig {
  const root = mkdtempSync(join(tmpdir(), "emcp-sb-"));
  rigs.push(root);
  const sandbox = join(root, "addons", "EMCP2_sandbox");
  mkdirSync(sandbox, { recursive: true });
  writeFileSync(join(sandbox, "EMCP2_sandbox.gproj"), "GameProject {\n}\n");
  currentGproj = join(sandbox, "EMCP2_sandbox.gproj");
  const lane = new Lane({
    id: "sb-test",
    leasePath: join(root, "lease.json"),
    markerPath: join(root, "marker"),
  });
  const opts = (o: Partial<SessionOptions> = {}): SessionOptions => ({
    really: true,
    lane,
    workbenchPath: join(root, "tools"),
    gamePath: join(root, "game"),
    addonsPath: join(root, "addons"),
    sandboxDir: sandbox,
    gproj: join(sandbox, "EMCP2_sandbox.gproj"),
    logsPath: join(root, "logs"),
    port: PORT,
    registryKey: "HKCU\\Software\\Bohemia Interactive\\Arma Reforger Workbench",
    ledgerMetaPath: join(root, "ledger.meta.json"),
    queuePath: DEFAULT_QUEUE,
    artifactsRoot: join(root, "artifacts"),
    openedProjectPattern:
      "Using autosave directory: .*[\\\\/]Projects[\\\\/]([^\\\\/]+)[\\\\/]autosaves",
    silentCrashReport: false,
    afterForcedKill: false,
    timeouts: { ...DEFAULT_TIMEOUTS, assertMs: 20_000, netReadyMs: 20_000, pollMs: 1_000 },
    personal: PERSONAL,
    placeholders: { localAppData: root },
    policy: loadPolicy(),
    ...o,
  });
  return { root, lane, opts };
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

function evidence(runDir: string): Array<{ ran: string; result_summary: string }> {
  const dir = join(runDir, "evidence");
  return readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
}

/** No written file (other than the raw registry exports, which are the owner's data) leaks the planted account or the run's absolute root. */
function expectClean(root: string, runDir: string): void {
  for (const f of filesUnder(runDir)) {
    if (/registry-(before|after)-.*\.reg$/.test(f) || f.endsWith(".png")) continue;
    const text = readFileSync(f, "utf-8");
    expect(text, f).not.toContain(ACCOUNT);
    expect(text, f).not.toContain(root);
  }
}

describe("runSession gating", () => {
  it("touches nothing without --really", async () => {
    const { opts } = rig();
    const w = newWorld();
    const r = await runSession(opts({ really: false }), mockDeps(w));
    expect(r.outcome).toBe("dry-run");
    expect(w.regExports + w.netCalls + w.closeCalls).toBe(0);
    expect(w.spawnArgs).toBeNull();
  });

  it("refuses without the lease", async () => {
    const { opts } = rig();
    const w = newWorld();
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("refused");
    expect(r.reason).toContain("does not hold the Workbench lease");
    expect(w.regExports + w.netCalls).toBe(0);
  });

  it("refuses off win32 even with the lease", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld();
    const r = await runSession(opts(), { ...mockDeps(w), platform: "linux" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toContain("Windows-only");
    expect(w.spawnArgs).toBeNull();
  });
});

describe("runSession, a full sitting against mocks", () => {
  it("runs once, calls once, closes gracefully and passes U12 on an untouched registry", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const w = newWorld();
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("completed");
    expect(r.verdict?.verdict).toBe("pass");
    expect(r.verdict?.launcherTreatsSandboxAsNew).toBe("no");
    expect(r.spawns).toBe(1);
    expect(r.netCalls).toBe(1);
    expect(w.netCalls).toBe(1);
    expect(w.closeCalls).toBe(1);
    expect(w.regExports).toBe(2);
    expect(w.captures).toEqual([]);
    // Launch form: -gproj <sandbox> -forceSettings <ini> plus the default crash flags.
    expect(w.spawnArgs?.slice(0, 2)).toEqual(["-gproj", opts().gproj]);
    expect(w.spawnArgs?.[2]).toBe("-forceSettings");
    expect(w.spawnArgs?.[3]).toMatch(/scratch\.ini$/);
    expect(w.spawnArgs).toContain("-disableCrashReport");
    expect(w.spawnArgs).toContain("-noThrow");
    expect(w.spawnArgs).not.toContain(SILENT_CRASH_FLAG);
    const ini = readFileSync(w.spawnArgs![3], "utf-8");
    expect(ini).toContain("NetAPI_Enabled=1");
    expect(ini).not.toContain(ACCOUNT);
    // One evidence record per step, each naming its probes.
    const ev = evidence(r.runDir!);
    expect(ev.map((e) => e.ran.split(" ")[2])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    for (const e of ev) expect(e.ran).toMatch(/probes: P-/);
    expect(ev[9].result_summary).toContain("U12 pass");
    // The lease stays held for postflight.ts.
    expect(lane.holdsLease()).toBe(true);
    expect(lane.heartbeating).toBe(false);
    expectClean(root, r.runDir!);
  });

  it("adds -silentCrashReport only with the owner's go", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld();
    await runSession(opts({ silentCrashReport: true }), mockDeps(w));
    expect(w.spawnArgs).toContain(SILENT_CRASH_FLAG);
  });

  it("names U35 in the start-up evidence when the start follows a forced kill", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts({ afterForcedKill: true }), mockDeps(newWorld()));
    const ev = evidence(r.runDir!);
    expect(ev[0].ran).toContain(PROBES.u35);
    expect(ev[3].ran).toContain(PROBES.u35);
  });

  it("fails U12 and states the plan's branch when the registry changed", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const after = baseExport();
    after.Workbench = [...after.Workbench, '"newKey"="1"'];
    const w = newWorld({ regAfter: regText(after) });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("completed");
    expect(r.verdict?.verdict).toBe("fail");
    expect(r.verdict?.consequence).toBe(U12_FAIL_CONSEQUENCE);
    const diff = JSON.parse(readFileSync(join(r.runDir!, "registry-diff.json"), "utf-8"));
    expect(diff.differences).toEqual([
      { change: "value-added", key: "Workbench", value: "newKey", type: "REG_SZ", after: "1" },
    ]);
  });
});

describe("runSession kill criteria and abort paths", () => {
  it("stops at pre-flight when a Workbench it did not start is running: no launch", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ foreignWorkbench: true });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("Never adopt someone else's Workbench");
    expect(r.spawns).toBe(0);
    expect(w.regExports).toBe(0);
  });

  it("stops at pre-flight when CrashReporter holds the port: nothing is killed", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ crashReporters: [CRASH_PID], listeners: [CRASH_PID] });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("do not kill processes");
    expect(r.spawns).toBe(0);
  });

  it("stops before the launch when the export holds no NetAPI_Enabled", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const keys = baseExport();
    keys.Workbench = ['"AutoRebuildScripts"="0"'];
    const w = newWorld({ regBefore: regText(keys) });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("scratch ini refused");
    expect(r.spawns).toBe(0);
  });

  it("aborts and closes gracefully when another project opened; no NET call", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      logLine: "Using autosave directory: D:/x/Projects/Test1_sandbox/autosaves",
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("a project other than the sandbox opened");
    expect(w.netCalls).toBe(0);
    expect(w.closeCalls).toBe(1);
    expect(w.regExports).toBe(2);
    expect(r.verdict?.criteria[0].result).toBe("fail");
  });

  it("takes the timeout path when no log line names a project: capture, windows, no close, no call", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const w = newWorld({ logAfterMs: null });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("timeout at step 4");
    expect(w.captures).toEqual(["s-b-timeout-step4"]);
    // The launcher check (visible windows) and the window list of the timeout path.
    expect(w.topWindowCalls).toBe(2);
    expect(w.closeCalls).toBe(0);
    expect(w.netCalls).toBe(0);
    expect(w.running.has(PID)).toBe(true);
    expect(lane.holdsLease()).toBe(true);
    const windows = readFileSync(join(r.runDir!, "windows-step4.json"), "utf-8");
    expect(windows).not.toContain(ACCOUNT);
    expect(windows).toContain("<other process: withheld>");
    expectClean(root, r.runDir!);
  });

  it("closes the launcher gracefully when it holds at its picker (sandbox new under the scratch profile)", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ logAfterMs: null, windowTitles: ["Enfusion Workbench Launcher"] });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.verdict?.launcherTreatsSandboxAsNew).toBe("yes");
    expect(w.closeCalls).toBe(1);
    expect(w.netCalls).toBe(0);
    expect(w.captures).toEqual(["s-b-launcher-held"]);
  });

  it("takes the timeout path when the NET port never opens", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ listenAfterMs: null });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.reason).toContain("timeout at step 5");
    expect(w.netCalls).toBe(0);
    expect(w.closeCalls).toBe(0);
    expect(w.captures).toEqual(["s-b-timeout-step5"]);
  });

  it("stops when the started Workbench exits by itself before the port opens", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      listenAfterMs: 60_000,
      exitBeforeReady: true,
      crashReporters: [CRASH_PID],
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("exited by itself");
    const ev = evidence(r.runDir!);
    expect(ev[ev.length - 1].result_summary).toContain(`CrashReporter.exe: pid ${CRASH_PID}`);
    expect(ev[ev.length - 1].ran).toContain(PROBES.crashOrphan);
    expect(w.netCalls).toBe(0);
  });

  it("stops without a call when a dependency or launcher window is up at ready", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      windowTitles: ["EMCP2_sandbox - Workbench", "Missing Addon Dependencies"],
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(w.netCalls).toBe(0);
    expect(w.closeCalls).toBe(0);
    expect(w.captures).toEqual(["s-b-dialog-at-ready"]);
  });

  it("never retries a timed-out NET call: capture, windows, stop", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      netResult: { ...OK_CALL, ok: false, response: undefined, timedOut: true, error: "timed out" },
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.reason).toContain("timeout at step 6");
    expect(w.netCalls).toBe(1);
    expect(r.netCalls).toBe(1);
    expect(w.closeCalls).toBe(0);
    expect(w.captures).toEqual(["s-b-timeout-step6"]);
    // The step-5 window check and the window list of the timeout path.
    expect(w.topWindowCalls).toBe(2);
  });

  it("records a refused call as the NET API not answering, then closes and compares", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      netResult: {
        ...OK_CALL,
        ok: false,
        response: undefined,
        error: "connection refused at 127.0.0.1:5775",
      },
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("completed");
    expect(w.netCalls).toBe(1);
    expect(w.closeCalls).toBe(1);
    expect(r.verdict?.verdict).toBe("fail");
  });

  it("counts an error status as an answer (the API is enabled)", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      netResult: {
        ...OK_CALL,
        ok: false,
        response: undefined,
        error: "Workbench error: Undefined API func",
      },
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.verdict?.criteria[1].result).toBe("pass");
  });

  it("reports a hazard and keeps the lease when Workbench does not exit on WM_CLOSE; capture and window list, no registry compare", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const w = newWorld({ closeExits: false, windowTitles: ["EMCP2_sandbox - Workbench"] });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toBe(NOT_CLOSED_REASON);
    expect(w.closeCalls).toBe(1);
    expect(w.regExports).toBe(1);
    expect(w.running.has(PID)).toBe(true);
    expect(lane.holdsLease()).toBe(true);
    expect(r.verdict?.criteria[3].result).toBe("not-observed");
    // Plan 5.3: the close timeout is a timeout like any other.
    expect(w.captures).toEqual(["s-b-timeout-step7"]);
    // Step 5, the hazard titles at the close, and the window list of the timeout path.
    expect(w.topWindowCalls).toBe(3);
    const windows = readFileSync(join(r.runDir!, "windows-step7.json"), "utf-8");
    expect(windows).toContain("<other process: withheld>");
    const step7 = evidence(r.runDir!).find((e) => e.ran.startsWith("S-B step 7"))!;
    expect(step7.result_summary).toContain("hazard dialog(s), not answered");
    expect(step7.result_summary).toContain("not retried");
    expectClean(root, r.runDir!);
  });

  it("reports a failed window probe at the close as a hazard, never as no window", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ closeExits: false });
    const deps = mockDeps(w);
    let calls = 0;
    const listAll = deps.topWindows;
    deps.topWindows = async () => {
      calls++;
      if (calls > 1) throw new Error("probe timed out");
      return listAll();
    };
    const r = await runSession(opts(), deps);
    const step7 = evidence(r.runDir!).find((e) => e.ran.startsWith("S-B step 7"))!;
    expect(step7.result_summary).toContain("<window probe failed: probe timed out>");
  });

  it("launcher held and the close fails: says so, does not claim a graceful close", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      logAfterMs: null,
      closeExits: false,
      windowTitles: ["Enfusion Workbench Launcher"],
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toBe(NOT_CLOSED_REASON);
    expect(r.reason).not.toContain("closed gracefully");
    expect(w.captures).toEqual(["s-b-launcher-held", "s-b-timeout-step7"]);
    expect(w.regExports).toBe(1);
    expect(w.netCalls).toBe(0);
    expect(w.running.has(PID)).toBe(true);
  });

  it("wrong project and the close fails: says so, does not claim it closed", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({
      logLine: "Using autosave directory: D:/x/Projects/Test1_sandbox/autosaves",
      closeExits: false,
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.reason).toBe(NOT_CLOSED_REASON);
    expect(w.captures).toEqual(["s-b-timeout-step7"]);
    expect(w.regExports).toBe(1);
    expect(w.netCalls).toBe(0);
  });

  it("redacts an owner project named by the session log, and never calls it the sandbox", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const w = newWorld({
      logLine: `Using autosave directory: D:/x/Projects/${PROJECT}/autosaves`,
    });
    const r = await runSession(opts(), mockDeps(w));
    // Another project's name is never printed, not even redacted (DEC-032 m3).
    expect(r.reason).toContain("a project other than the sandbox opened");
    const step4 = evidence(r.runDir!).find((e) => e.ran.startsWith("S-B step 4"))!;
    expect(step4.result_summary).toMatch(/name withheld, sha256 [0-9a-f]{12}/);
    expect(r.reason).not.toContain(PROJECT);
    expect(w.netCalls).toBe(0);
    expectClean(root, r.runDir!);
  });

  it("takes the timeout path when the window probe fails at step 4", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ logAfterMs: null, windowProbeFails: true });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.reason).toContain("timeout at step 4");
    expect(r.reason).toContain("window probe failed");
    expect(w.captures).toEqual(["s-b-timeout-step4"]);
    expect(w.closeCalls + w.netCalls).toBe(0);
  });

  it("stops at step 5 when the window probe fails: an empty list is never a pass", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ windowProbeFails: true });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("timeout at step 5");
    expect(r.reason).toContain("a dialog cannot be ruled out");
    expect(w.captures).toEqual(["s-b-timeout-step5"]);
    // The failed step-5 check, then the window list of the timeout path (failed too).
    expect(w.topWindowCalls).toBe(2);
    expect(w.netCalls).toBe(0);
    expect(w.closeCalls).toBe(0);
    expect(r.verdict).toBeUndefined();
  });

  it("records a crash during step 4 as exited by itself, with the CrashReporter evidence", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ logAfterMs: null, exitBeforeReady: true, crashReporters: [CRASH_PID] });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("exited by itself");
    const ev = evidence(r.runDir!);
    const last = ev[ev.length - 1];
    expect(last.ran).toMatch(/^S-B step 4 /);
    expect(last.ran).toContain(PROBES.crashOrphan);
    expect(last.ran).toContain(PROBES.crashFlags);
    expect(last.result_summary).toContain(`CrashReporter.exe: pid ${CRASH_PID}`);
    // Not a timeout: the poll saw the pid gone long before the 20 s deadline.
    expect(w.captures).toEqual([]);
    expect(w.t - w.launchedAt).toBeLessThan(10_000);
  });

  it("records a spawn that throws and stops: nothing to close, no call", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ spawnThrows: true });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("launch failed: spawn EACCES");
    expect(r.spawns).toBe(1);
    expect(r.startedPid).toBeUndefined();
    expect(w.netCalls + w.closeCalls).toBe(0);
    const ev = evidence(r.runDir!);
    expect(ev[ev.length - 1].ran).toMatch(/^S-B step 3 launch/);
    expect(ev[ev.length - 1].result_summary).toMatch(/^STOP: /);
  });

  it("the after-export throwing: the compare fails, the verdict says not observed, the stop says why", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ regAfterMode: "throw" });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toBe(COMPARE_FAILED_REASON);
    expect(r.verdict?.criteria[3].result).toBe("not-observed");
    expect(r.verdict?.verdict).toBe("incomplete");
    const step8 = evidence(r.runDir!).find((e) => e.ran.startsWith("S-B step 8"))!;
    expect(step8.result_summary).toContain("STOP: reg export failed");
    expect(existsSync(join(r.runDir!, "registry-diff.json"))).toBe(false);
  });

  it("the after-export missing: the compare fails the same way", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ regAfterMode: "missing" });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.reason).toBe(COMPARE_FAILED_REASON);
    expect(r.verdict?.criteria[3].result).toBe("not-observed");
  });

  it("an exception after the spawn is recorded as a STOP with its step, and the report keeps the paths", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ netThrows: true });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("stopped");
    expect(r.reason).toContain("exception at step 6 (NET call): socket exploded");
    expect(r.reason).toContain(`Workbench pid ${PID} is left as it is`);
    expect(r.runDir).toBeDefined();
    expect(r.startedPid).toBe(PID);
    expect(r.registryBefore).toBeDefined();
    expect(r.snapshotFile).toBeDefined();
    expect(w.netCalls).toBe(1);
    expect(w.closeCalls).toBe(0);
    const ev = evidence(r.runDir!);
    expect(ev[ev.length - 1].ran).toMatch(/^S-B step 6 NET call/);
    expect(ev[ev.length - 1].result_summary).toContain("STOP: exception: socket exploded");
    expect(lane.heartbeating).toBe(false);
  });

  it("step 9: an ini written back shows the ini was consumed", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const w = newWorld({ iniAtClose: "rewrite" });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("completed");
    expect(r.verdict?.iniConsumed).toMatch(/^yes/);
    const step9 = evidence(r.runDir!).find((e) => e.ran.startsWith("S-B step 9"))!;
    expect(step9.result_summary).toContain("written back");
  });

  it("step 9: an unchanged ini does not show consumption; a deleted one is recorded as gone", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r1 = await runSession(opts(), mockDeps(newWorld({ echo: false })));
    expect(r1.verdict?.iniConsumed).toMatch(/^not shown/);
    const rig2 = rig();
    rig2.lane.start("S-B test");
    const r2 = await runSession(
      rig2.opts(),
      mockDeps(newWorld({ iniAtClose: "delete", echo: false })),
    );
    expect(r2.verdict?.iniConsumed).toBe("not observed");
    const step9 = evidence(r2.runDir!).find((e) => e.ran.startsWith("S-B step 9"))!;
    expect(step9.result_summary).toContain("the scratch ini is gone");
  });

  it("reviews an unexpected window title of the started pid", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const w = newWorld({ windowTitles: ["EMCP2_sandbox - Workbench", `${PROJECT} notice`] });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.verdict?.criteria[2].result).toBe("review");
    expectClean(root, r.runDir!);
  });
});

describe("runSession refuses anything but the sandbox (plan 5.1)", () => {
  it("refuses a crafted --gproj of an owner project: no export, no spawn", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const owner = join(root, "addons", "OwnerMod");
    mkdirSync(owner, { recursive: true });
    const w = newWorld();
    const r = await runSession(
      opts({ sandboxDir: owner, gproj: join(owner, "OwnerMod.gproj") }),
      mockDeps(w),
    );
    expect(r.outcome).toBe("refused");
    expect(r.reason).toContain("not named EMCP2_sandbox");
    expect(w.regExports).toBe(0);
    expect(w.spawnArgs).toBeNull();
  });

  it("refuses a sandbox-named folder outside the addons folder, and a gproj outside the sandbox", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const elsewhere = join(root, "elsewhere", "EMCP2_sandbox");
    const w = newWorld();
    const r1 = await runSession(
      opts({ sandboxDir: elsewhere, gproj: join(elsewhere, "EMCP2_sandbox.gproj") }),
      mockDeps(w),
    );
    expect(r1.outcome).toBe("refused");
    expect(r1.reason).toContain("not directly in the configured addons folder");
    const r2 = await runSession(
      opts({ gproj: join(root, "addons", "OwnerMod", "OwnerMod.gproj") }),
      mockDeps(w),
    );
    expect(r2.outcome).toBe("refused");
    expect(r2.reason).toContain("the project is not <sandbox>");
    expect(w.regExports).toBe(0);
    expect(w.spawnArgs).toBeNull();
  });

  it("sandboxRefusal accepts the canonical layout only", () => {
    const addons = join("r", "addons");
    const sb = join(addons, "EMCP2_sandbox");
    expect(sandboxRefusal(sb, join(sb, "EMCP2_sandbox.gproj"), addons)).toBeNull();
    expect(sandboxRefusal(sb, join(sb, "Other.gproj"), addons)).not.toBeNull();
    expect(
      sandboxRefusal(join(addons, "OwnerMod"), join(addons, "OwnerMod", "OwnerMod.gproj"), addons),
    ).not.toBeNull();
  });
});

// ── CLI ──────────────────────────────────────────────────────────────────────

/** The registry key a real run must name (DEC-032 m1: never from the environment). */
const REGKEY = ["--registry-key", "HKCU\\Software\\Bohemia Interactive\\Arma Reforger Workbench"];

/** Dependencies that fail the test if anything is touched. */
function untouchable(platform: NodeJS.Platform = "win32"): SessionDeps {
  const no = (what: string) => () => {
    throw new Error(`unexpected ${what}`);
  };
  return {
    platform,
    now: () => new Date("2026-10-05T10:00:00Z"),
    sleep: no("sleep") as never,
    exec: no("exec") as never,
    powershell: no("powershell") as never,
    spawn: no("spawn") as never,
    netCall: no("netCall") as never,
    capture: no("capture") as never,
    topWindows: no("topWindows") as never,
    processWindows: no("processWindows") as never,
    findSessionLog: no("findSessionLog") as never,
    readText: no("readText") as never,
    projectLists: no("projectLists") as never,
    processTable: no("processTable") as never,
  };
}

describe("main", () => {
  it("dry run by default: writes the action plan to --out, which passes the checker", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sb-cli-"));
    rigs.push(root);
    const out = join(root, "plan.json");
    const lines: string[] = [];
    const code = await main(
      [
        "--out",
        out,
        "--workbench-path",
        join(root, "tools"),
        "--game-path",
        join(root, "game"),
        "--sandbox",
        join(root, "addons", "EMCP2_sandbox"),
        "--addons-path",
        join(root, "addons"),
      ],
      untouchable(),
      (l) => lines.push(l),
    );
    expect(code).toBe(0);
    const plan = JSON.parse(readFileSync(out, "utf-8"));
    expect(plan).toEqual(JSON.parse(JSON.stringify(actionPlan())));
    expect(checkPlan(plan, loadPolicy(), { script: SCRIPT_PATH }).ok).toBe(true);
    expect(lines.join("\n")).toContain("dry run");
    expect(lines.join("\n")).toContain(`${SILENT_CRASH_FLAG} withheld`);
  });

  it("previews the scrub offline from an export file without writing anything", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sb-cli-"));
    rigs.push(root);
    const reg = join(root, "export.reg");
    writeFileSync(reg, regFile(regText(baseExport())));
    const lines: string[] = [];
    const code = await main(
      [
        "--preview-from",
        reg,
        "--workbench-path",
        "t",
        "--game-path",
        "g",
        "--sandbox",
        join(root, "addons", "EMCP2_sandbox"),
        "--addons-path",
        join(root, "addons"),
      ],
      untouchable(),
      (l) => lines.push(l),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/scratch ini preview: \d+ values/);
    expect(readdirSync(root).sort()).toEqual(["export.reg"]);
  });

  it("refuses a real run without --id, without the lease, and off win32", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sb-cli-"));
    rigs.push(root);
    expect(await main(["--really"], untouchable(), () => {})).toBe(2);
    const leaseArgs = [
      "--lease-path",
      join(root, "lease.json"),
      "--marker-path",
      join(root, "marker"),
      ...REGKEY,
    ];
    expect(await main(["--really", "--id", "sbx", ...leaseArgs], untouchable(), () => {})).toBe(1);
    new Lane({
      id: "sbx",
      leasePath: join(root, "lease.json"),
      markerPath: join(root, "marker"),
    }).start("S-B test");
    expect(
      await main(["--really", "--id", "sbx", ...leaseArgs], untouchable("linux"), () => {}),
    ).toBe(1);
  });

  it("refuses a real run on a crafted --gproj or --sandbox before anything is touched", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sb-cli-"));
    rigs.push(root);
    const leaseArgs = [
      "--lease-path",
      join(root, "lease.json"),
      "--marker-path",
      join(root, "marker"),
      ...REGKEY,
    ];
    new Lane({
      id: "sbx",
      leasePath: join(root, "lease.json"),
      markerPath: join(root, "marker"),
    }).start("S-B test");
    const paths = [
      "--workbench-path",
      join(root, "tools"),
      "--game-path",
      join(root, "game"),
      "--logs-path",
      join(root, "logs"),
      "--addons-path",
      join(root, "addons"),
    ];
    const errors: string[] = [];
    const saved = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      const owner = join(root, "addons", "OwnerMod", "OwnerMod.gproj");
      expect(
        await main(
          ["--really", "--id", "sbx", ...leaseArgs, ...paths, "--gproj", owner],
          untouchable(),
          () => {},
        ),
      ).toBe(1);
      const elsewhere = join(root, "other", "EMCP2_sandbox");
      expect(
        await main(
          ["--really", "--id", "sbx", ...leaseArgs, ...paths, "--sandbox", elsewhere],
          untouchable(),
          () => {},
        ),
      ).toBe(1);
      // The dry run says the real run would refuse, too.
      expect(await main(["--gproj", owner, ...paths], untouchable(), () => {})).toBe(1);
    } finally {
      console.error = saved;
    }
    expect(errors.filter((e) => e.includes("plan 5.1"))).toHaveLength(3);
  });
});

// ── The pre-sitting read of S-B (DEC-032) ────────────────────────────────────

describe("DEC-032: one launch per sitting, the started marker and the shared recover (B1, M2)", () => {
  it("writes S-B.started with the pid and its creation time, and S-B.json when the run ends", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts(), mockDeps(newWorld()));
    expect(r.outcome).toBe("completed");
    const marker = JSON.parse(readFileSync(startedMarkerPath(r.runDir!, "S-B"), "utf-8"));
    expect(marker).toMatchObject({ step: "S-B", pid: PID, created: 1_000 });
    const result = JSON.parse(readFileSync(join(r.runDir!, "S-B.json"), "utf-8"));
    expect(result).toMatchObject({ session: "S-B", outcome: "completed", started_pid: PID });
    // After the graceful exit the lease no longer records the pid (i1).
    expect(lane.recordedPid()).toBeNull();
  });

  it("a stop with Workbench running keeps the pid in the lease and still writes S-B.json", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts(), mockDeps(newWorld({ closeExits: false })));
    expect(r.reason).toBe(NOT_CLOSED_REASON);
    expect(NOT_CLOSED_REASON).toContain("s-b-scratch-profile.ts recover --run");
    expect(NOT_CLOSED_REASON).not.toMatch(/\/T/);
    expect(lane.recordedPid()).toBe(PID);
    expect(existsSync(join(r.runDir!, "S-B.json"))).toBe(true);
  });

  it("a spawn that fails removes its marker, so it is not counted as the sitting's launch", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts(), mockDeps(newWorld({ spawnThrows: true })));
    expect(existsSync(startedMarkerPath(r.runDir!, "S-B"))).toBe(false);
    expect(existsSync(join(r.runDir!, "S-B.json"))).toBe(false);
  });

  it("refuses while the lease records a Workbench pid: nothing exported or launched", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    lane.record(PID, opts().gproj);
    const w = newWorld();
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("refused");
    expect(r.reason).toContain("the lease still records Workbench pid");
    expect(r.reason).toContain("recover");
    expect(w.regExports + w.netCalls).toBe(0);
    expect(w.spawnArgs).toBeNull();
    expect(r.runDir).toBeUndefined();
  });

  it("refuses a second launch in the sitting without the owner's acknowledged repeat", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const first = await runSession(opts(), mockDeps(newWorld()));
    expect(first.outcome).toBe("completed");
    // Run folders are named by the clock: the next run starts an hour later.
    const w = newWorld({ t: Date.parse("2026-10-05T11:00:00Z") });
    const again = await runSession(opts(), mockDeps(w));
    expect(again.outcome).toBe("refused");
    expect(again.reason).toContain("already started in this sitting");
    expect(w.regExports).toBe(0);
    const w2 = newWorld({ t: Date.parse("2026-10-05T12:00:00Z") });
    const repeat = await runSession(opts({ ownerAckRepeat: true }), mockDeps(w2));
    expect(repeat.outcome).toBe("completed");
    expect(w2.spawnArgs).not.toBeNull();
  });

  it("recover through main: image and creation-time checks, one process at a time, never /T", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const o = opts();
    const runDir = join(o.artifactsRoot, "sessions", "S-B", "run-1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      startedMarkerPath(runDir, "S-B"),
      JSON.stringify({ step: "S-B", started_at: "x", pid: PID, created: 1_000 }),
    );
    lane.record(PID, o.gproj);
    const images = new Map<number, string>([[PID, WORKBENCH_EXE]]);
    let created = 1_000;
    const kills: Array<{ pid: number; descendants: boolean }> = [];
    let t = 0;
    const recoverDeps = {
      platform: "win32" as NodeJS.Platform,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      imageOfPid: (p: number) => images.get(p) ?? null,
      processTable: async () => [...images].map(([pid, name]) => ({ pid, ppid: 4, name, created })),
      kill: async (p: number, k?: { descendants?: boolean }) => {
        kills.push({ pid: p, descendants: k?.descendants !== false });
        images.delete(p);
        return {
          ended: true,
          ended_pids: [p],
          left: [],
          descendants_unknown: false,
          detail: `taskkill /PID ${p} /F (test)`,
        };
      },
      workbenchPids: () => [...images.keys()],
    };
    const args = [
      "recover",
      "--run",
      runDir,
      "--id",
      "sb-test",
      "--lease-path",
      join(root, "lease.json"),
      "--marker-path",
      join(root, "marker"),
    ];
    const lines: string[] = [];
    // Without --really: a dry run that says what it would check.
    expect(
      await main(args, undefined, (l) => lines.push(l), {
        artifactsRoot: o.artifactsRoot,
        recoverDeps,
      }),
    ).toBe(0);
    expect(kills).toEqual([]);
    expect(lines.join("\n")).toContain("a started marker of S-B names it");
    // A reused pid (another creation time) is refused.
    created = 9_999;
    expect(
      await main([...args, "--really"], undefined, (l) => lines.push(l), {
        artifactsRoot: o.artifactsRoot,
        recoverDeps,
      }),
    ).toBe(1);
    expect(kills).toEqual([]);
    expect(lines.join("\n")).toContain("created at another time");
    created = 1_000;
    expect(
      await main([...args, "--really"], undefined, (l) => lines.push(l), {
        artifactsRoot: o.artifactsRoot,
        recoverDeps,
      }),
    ).toBe(0);
    expect(kills).toEqual([{ pid: PID, descendants: true }]);
    expect(readForcedKills(runDir)).toMatchObject([{ pid: PID, by: "recover" }]);
    expect(lane.recordedPid()).toBeNull();
    expect(lines.join("\n")).not.toMatch(/\/T\b/);
    expect(lines.join("\n")).not.toContain(root);
  });
});

describe("DEC-032: launcher lists (M3), visible windows (M4), the ini's use (M5)", () => {
  it("refuses unless every launcher list names the sandbox: nothing exported or launched", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const g = opts().gproj;
    const w = newWorld({
      lists: [
        { app: "1874880", readable: true, entries: [g], mtimeMs: 0 },
        { app: "1874910", readable: true, entries: ["C:/a/Other/Other.gproj"], mtimeMs: 0 },
      ],
    });
    const r = await runSession(opts(), mockDeps(w));
    expect(r.outcome).toBe("refused");
    expect(r.reason).toContain("OA-3 is not done in both ways");
    expect(r.reason).toContain("app 1874910: does NOT name it");
    expect(w.regExports + w.netCalls).toBe(0);
    const unknown = await runSession(
      opts(),
      mockDeps(newWorld({ lists: [{ app: "1874880", readable: false, entries: [], mtimeMs: 0 }] })),
    );
    expect(unknown.outcome).toBe("refused");
    expect(unknown.reason).toContain("unknown");
    const none = await runSession(opts(), mockDeps(newWorld({ lists: [] })));
    expect(none.outcome).toBe("refused");
  });

  it("records the lists before the launch by app number, counts and flags only", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts(), mockDeps(newWorld()));
    const lists = JSON.parse(readFileSync(join(r.runDir!, "launcher-lists-before.json"), "utf-8"));
    expect(lists).toEqual([
      expect.objectContaining({ app: "1874880", entries: 1, sandbox: true, first: "sandbox" }),
      expect.objectContaining({ app: "1874910", entries: 1, sandbox: true, first: "sandbox" }),
    ]);
    expect(JSON.stringify(lists)).not.toContain("EMCP2_sandbox.gproj");
  });

  it("hidden IME-like windows never count as a first-run dialog", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts(), mockDeps(newWorld({ hiddenIme: true })));
    expect(r.verdict?.criteria[2].result).toBe("pass");
    expect(r.verdict?.verdict).toBe("pass");
    const wins = readFileSync(join(r.runDir!, "windows-at-ready.json"), "utf-8");
    expect(wins).not.toContain("Default IME");
  });

  it("no evidence that the ini was used: U12 is incomplete, never a pass", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(opts(), mockDeps(newWorld({ echo: false })));
    expect(r.outcome).toBe("completed");
    expect(r.verdict?.criteria.every((c) => c.result === "pass")).toBe(true);
    expect(r.verdict?.verdict).toBe("incomplete");
    const rejected = await runSession(
      opts({ ownerAckRepeat: true }),
      mockDeps(
        newWorld({
          t: Date.parse("2026-10-05T11:00:00Z"),
          extraLogLine: "Unknown parameter forceSettings, ignored",
        }),
      ),
    );
    expect(rejected.verdict?.verdict).toBe("incomplete");
    expect(rejected.verdict?.iniConsumed).toMatch(/^NO/);
  });
});

describe("DEC-032: a stub's engine (m6)", () => {
  it("a listener that is a Workbench the started pid brought up counts as ready", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(
      opts(),
      mockDeps(newWorld({ childPid: CHILD_PID, childListens: true })),
    );
    expect(r.outcome).toBe("completed");
    const step5 = evidence(r.runDir!).find((e) => e.ran.startsWith("S-B step 5"))!;
    expect(step5.result_summary).toContain(`pid ${CHILD_PID} listens`);
    expect(step5.result_summary).toContain("brought up");
  });

  it("exited by itself while its engine still runs: the stop names the running Workbench", async () => {
    const { opts, lane } = rig();
    lane.start("S-B test");
    const r = await runSession(
      opts(),
      mockDeps(
        newWorld({
          childPid: CHILD_PID,
          childOutlives: true,
          listenAfterMs: 60_000,
          exitBeforeReady: true,
        }),
      ),
    );
    expect(r.reason).toContain("exited by itself");
    expect(r.reason).toContain(`pid ${CHILD_PID} still runs`);
    const ev = evidence(r.runDir!);
    expect(ev[ev.length - 1].result_summary).toContain("STILL RUNS");
  });
});

describe("DEC-032: the scrub's new shapes (m7)", () => {
  it("drops SteamID3, SIDs, IPv4, short base64, percent-encoded paths, last-opened lists and identity names", () => {
    const encoded = encodeURIComponent(["C:", "Users", "someoneElse", "Docs", "x"].join("\\"));
    const keys = baseExport({
      Network: [
        '"friend"="[U:1:39734273]"',
        '"owner"="S-1-5-21-1004336348-1177238915-682003330-512"',
        '"lastHost"="192.168.1.20"',
        '"token"="aGVsbG8xMjM0NTY3OA"',
        `"saved"="${encoded}"`,
        '"LastOpenedProjects"="ProjA;ProjB"',
        '"steamAccount"="39734273"',
        '"version"="v2"',
      ],
    });
    const ini = buildScratchIni(parse(keys), PERSONAL, {});
    for (const bad of ["39734273", "S-1-5-21", "192.168", "aGVsbG8", "someoneElse", "ProjA"]) {
      expect(ini.text).not.toContain(bad);
    }
    expect(ini.text).toContain("version=v2");
    expect(ini.dropped["personal-value:steamid3"]).toBe(1);
    expect(ini.dropped["personal-value:windows-sid"]).toBe(1);
    expect(ini.dropped["personal-value:ipv4"]).toBe(1);
    expect(ini.dropped["personal-value:short-base64-like"]).toBe(1);
    expect(ini.dropped["personal-value:machine-path"]).toBe(1);
    expect(ini.dropped["personal-name:identity-name"]).toBe(1);
  });
});

describe("DEC-032: printed paths and the real run's last line (M1, m1, m2)", () => {
  it("the dry run states the invocation's worst case, above the 600 s foreground cap", async () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-sb-cli-"));
    rigs.push(root);
    const lines: string[] = [];
    await main(
      [
        "--workbench-path",
        join(root, "tools"),
        "--game-path",
        join(root, "game"),
        "--sandbox",
        join(root, "addons", "EMCP2_sandbox"),
        "--addons-path",
        join(root, "addons"),
      ],
      untouchable(),
      (l) => lines.push(l),
    );
    expect(invocationWorstCaseMs()).toBe(830_000);
    expect(lines.join("\n")).toContain("invocation worst case (an estimate): 830000 ms");
  });

  it("an error naming a home path is printed in placeholder form", async () => {
    const missing = join(homedir(), "emcp-sb-no-such-folder", "export.reg");
    const errors: string[] = [];
    const saved = console.error;
    console.error = (m: string) => errors.push(String(m));
    try {
      expect(
        await main(
          [
            "--preview-from",
            missing,
            "--sandbox",
            join("x", "addons", "EMCP2_sandbox"),
            "--addons-path",
            join("x", "addons"),
          ],
          untouchable(),
          () => {},
        ),
      ).toBe(1);
    } finally {
      console.error = saved;
    }
    expect(errors.join("\n")).toContain("emcp-sb-no-such-folder");
    expect(errors.join("\n")).not.toContain(homedir());
  });

  it("a real run needs --registry-key (never the environment) and ends with S-B done or STOPPED", async () => {
    const { opts, lane, root } = rig();
    lane.start("S-B test");
    const o = opts();
    const base = [
      "--really",
      "--id",
      "sb-test",
      "--lease-path",
      join(root, "lease.json"),
      "--marker-path",
      join(root, "marker"),
      "--workbench-path",
      o.workbenchPath,
      "--game-path",
      o.gamePath,
      "--logs-path",
      o.logsPath,
      "--addons-path",
      o.addonsPath,
      "--ledger-meta",
      o.ledgerMetaPath,
      "--assert-timeout-ms",
      "20000",
      "--net-ready-timeout-ms",
      "20000",
      "--poll-ms",
      "1000",
    ];
    {
      const out1: string[] = [];
      expect(await main(base, mockDeps(newWorld()), (l) => out1.push(l))).toBe(2);
      expect(out1[out1.length - 1]).toMatch(/^STOPPED: usage: no --registry-key/);
      const out2: string[] = [];
      expect(
        await main([...base, ...REGKEY], mockDeps(newWorld()), (l) => out2.push(l), {
          artifactsRoot: o.artifactsRoot,
        }),
      ).toBe(0);
      expect(out2[out2.length - 1]).toMatch(new RegExp(`^${DONE_LINE}: outcome completed`));
      // A second launch in the sitting is refused, and the last line says STOPPED.
      const out3: string[] = [];
      expect(
        await main([...base, ...REGKEY], mockDeps(newWorld()), (l) => out3.push(l), {
          artifactsRoot: o.artifactsRoot,
        }),
      ).toBe(1);
      expect(out3[out3.length - 1]).toMatch(/^STOPPED: outcome refused/);
      expect(out2.concat(out3).join("\n")).not.toContain(root);
    }
  });
});
