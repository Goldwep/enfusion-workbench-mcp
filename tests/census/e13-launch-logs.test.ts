import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { observationSchema } from "../../src/census/schemas.js";
import {
  ScrubError,
  assertScrubbed,
  checkGameLogs,
  defaultLogsDir,
  derive,
  discoverAccounts,
  makeScrubContext,
  mineLogs,
  observationFileText,
  parseCliEcho,
  parseCrashReports,
  parseSession,
  projectNameOfGproj,
  projectToken,
  run as runE13,
  scrubPath,
  scrubText,
  shapeMessage,
  valueKind,
} from "../../scripts/census/enumerators/e13-launch-logs.js";
import { REPO_ROOT, makeCensus, runIn } from "./helpers.js";

// ── Synthetic material ─────────────────────────────────────────────────────────
// The account name and home paths below exist only inside this test and are
// assembled at run time; nothing here is a real account, path or addon name.

const BS = String.fromCharCode(92);
const ACCT = ["Zq9", "Plantedacct"].join("");
const HOME_BACK = ["C:", "Users", ACCT].join(BS);
const HOME_FWD = ["C:", "Users", ACCT].join("/");
// A Steam64-shaped placeholder, assembled here so no id literal is committed.
const STEAM = ["7656", "1198", "0".repeat(9)].join("");
const GAME_FWD = "D:/SteamLibrary/steamapps/common/Arma Reforger";
const GAME_BACK = GAME_FWD.split("/").join(BS);
const ADDONS_FWD = `${HOME_FWD}/Documents/My Games/ArmaReforgerWorkbench/addons`;
const ENCODED_TEMP = `${HOME_FWD}/AppData/Local/Temp/claude/C--Users-${ACCT}-Documents-GitHub-Somerepo/abc/scratchpad`;

function ctx() {
  return makeScrubContext({ homes: [HOME_BACK, HOME_FWD], accounts: [ACCT], ambient: false });
}

/** One log line in the engine's shape. */
function line(t: string, channel: string, msg: string, level?: string): string {
  const head = level ? `${channel.padEnd(9)}(${level})` : channel.padEnd(12);
  return `${t}   ${head}: ${msg}`;
}

interface Synthetic {
  startedAt: string;
  create: string;
  init: string | null;
  echo: string | null;
  cwd: string;
  opened: string | null;
  startup: string | null;
  extra?: string[];
  loaded?: string[];
}

function consoleLog(s: Synthetic): string {
  const out = [
    "---------------------------------------------",
    `Log ${HOME_BACK}${BS}Documents${BS}My Games${BS}ArmaReforgerWorkbench${BS}logs${BS}logs_${s.startedAt}${BS}console.log started at x`,
    "",
    line(
      s.create,
      "ENGINE",
      `FileSystem: Adding relative directory '${HOME_BACK}${BS}profile' to filesystem under name profile`,
    ),
    line(s.create, "ENGINE", `FileSystem: Current working directory: '${s.cwd}'`),
    line(s.create, "PROFILING", "Workbench Create Engine took: 6.7 ms"),
  ];
  if (s.init) out.push(`${s.init} INIT         : INIT         : Workbench Init Engine`);
  if (s.echo) out.push(line(s.init ?? s.create, "ENGINE", `CLI Params: ${s.echo} `));
  if (s.loaded) {
    out.push(line(s.init ?? s.create, "ENGINE", "Loaded addons:"));
    for (const p of s.loaded)
      out.push(line(s.init ?? s.create, "ENGINE", `gproj: '${p}' guid: '6968F5564CA31D9D'`));
  }
  for (const e of s.extra ?? []) out.push(e);
  if (s.opened) {
    out.push(
      line(
        "00:00:09.000",
        "DEFAULT",
        `Using thumbnail cache directory: ${HOME_FWD}/AppData/Local/Temp/Arma Reforger Workbench/Projects/${s.opened}/thumbnails`,
      ),
      line(
        "00:00:09.500",
        "DEFAULT",
        `Using autosave directory: ${HOME_FWD}/AppData/Local/Temp/Arma Reforger Workbench/Projects/${s.opened}/autosaves`,
      ),
    );
  }
  if (s.startup) out.push(`00:00:10.000 PROFILING    : Workbench startup took: ${s.startup} ms`);
  return out.join("\n") + "\n";
}

const SESSIONS: Record<string, Synthetic> = {
  // phantom flag: the preselected project opens, whatever was asked
  "2026-01-02_10-00-00": {
    startedAt: "2026-01-02_10-00-00",
    create: "10:00:00.100",
    init: "10:00:15.350",
    echo: `-wbModule WorldEditor -wbProjectPath ${ADDONS_FWD}/Alpha/addon.gproj`,
    cwd: `${GAME_BACK}${BS}`,
    opened: "Beta",
    startup: "24000.5",
    loaded: [`${ADDONS_FWD}/Beta/addon.gproj`],
  },
  // the real flag, with an addons directory list that carries the account in an encoded temp path
  "2026-01-02_10-05-00": {
    startedAt: "2026-01-02_10-05-00",
    create: "10:05:00.100",
    init: "10:05:01.150",
    echo: `-gproj ${ADDONS_FWD}/Alpha/addon.gproj -addonsDir ${HOME_BACK}${BS}Documents${BS}Imports,${ENCODED_TEMP}`,
    cwd: `${GAME_BACK}${BS}`,
    opened: "Alpha",
    startup: "6000.2",
    loaded: [`${ADDONS_FWD}/Alpha/addon.gproj`],
  },
  // the real flag, missing dependency: the base project opens instead
  "2026-01-02_10-10-00": {
    startedAt: "2026-01-02_10-10-00",
    create: "10:10:00.100",
    init: "10:10:01.200",
    echo: `-gproj ${ADDONS_FWD}/Gamma/addon.gproj`,
    cwd: `${GAME_BACK}${BS}`,
    opened: "ArmaReforger",
    startup: "5800.0",
    loaded: [`${GAME_FWD}/addons/data/ArmaReforger.gproj`],
    extra: [
      line(
        "10:10:01.250",
        "ENGINE",
        "Addon 'Gamma' dependency '481849A4E0D88BEA' can't be added",
        "E",
      ),
      line(
        "10:10:02.000",
        "SCRIPT",
        `Virtual Machine Exception at ${HOME_BACK}${BS}Documents${BS}x.c line 4 for ${ACCT}`,
        "E",
      ),
      line("10:10:02.500", "SCRIPT", "Script authorization is needed for 'WB_Save'", "W"),
      line("10:10:03.000", "ENGINE", "Assertion failed in 'foo' at 12", "E"),
      line(
        "10:10:04.000",
        "RESOURCES",
        'resource not registered: @"$profile:Mine.json". Setting null GUID',
        "W",
      ),
      line(
        "10:10:05.000",
        "SCRIPT",
        "@\"Scripts/Game/Foo.c,785\": 'GetThing' is obsolete: Use Other instead.",
        "W",
      ),
    ],
  },
  // never initialised: the launcher stalled in a working directory that is not the game
  "2026-01-02_10-15-00": {
    startedAt: "2026-01-02_10-15-00",
    create: "10:15:00.100",
    init: null,
    echo: null,
    cwd: `${HOME_BACK}${BS}Documents${BS}GitHub${BS}Somerepo${BS}`,
    opened: null,
    startup: null,
  },
};

const CRASH_LINE =
  "2026-01-03 00:42:09 (UTC) : Version: 1.2.3.4 - Report Result: - SUCCESS - Crash GUID: b5227074-8834-45ed-9457-ef4bf2665ada";

/** A temporary Workbench logs folder holding the synthetic sessions. */
function makeLogs(withCrash = true): string {
  const dir = mkdtempSync(join(tmpdir(), "e13-logs-"));
  for (const [folder, s] of Object.entries(SESSIONS)) {
    const d = join(dir, `logs_${folder}`);
    mkdirSync(d, { recursive: true });
    const text = consoleLog(s);
    writeFileSync(join(d, "console.log"), text);
    if (s.init)
      writeFileSync(
        join(d, "error.log"),
        text
          .split("\n")
          .filter((l) => /\(E\)|\(W\)/.test(l))
          .join("\n") + "\n",
      );
  }
  if (withCrash) writeFileSync(join(dir, "CrashReports.log"), CRASH_LINE + "\n");
  return dir;
}

function makeGameLogs(withMarker: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "e13-game-"));
  mkdirSync(join(dir, "logs_2026-01-02_09-00-00"), { recursive: true });
  writeFileSync(
    join(dir, "logs_2026-01-02_09-00-00", "console.log"),
    [
      "01:00:00.000 ENGINE       : CLI Params: -addons 7BFA5A336F6E6388",
      withMarker
        ? "01:00:01.000 INIT         : Workbench startup took: 5 ms"
        : "01:00:01.000 INIT         : Creating game instance",
    ].join("\n") + "\n",
  );
  return dir;
}

function mineSynthetic() {
  const c = ctx();
  const mined = mineLogs(makeLogs(), c);
  const derived = derive(mined, checkGameLogs(makeGameLogs(false)), "1.0.0.1");
  return { c, mined, derived };
}

// ── Scrubbing ──────────────────────────────────────────────────────────────────

describe("e13 scrubbing", () => {
  it("turns every path shape into a placeholder and numbers project names by first appearance", () => {
    const c = ctx();
    expect(scrubPath(`${ADDONS_FWD}/Alpha/addon.gproj`, c)).toBe(
      "<addons>/<project-1>/addon.gproj",
    );
    expect(
      scrubPath(
        `${HOME_BACK}${BS}Documents${BS}My Games${BS}ArmaReforgerWorkbench${BS}addons${BS}Beta${BS}addon.gproj`,
        c,
      ),
    ).toBe("<addons>/<project-2>/addon.gproj");
    expect(scrubPath(`${ADDONS_FWD}/alpha/addon.gproj`, c)).toBe(
      "<addons>/<project-1>/addon.gproj",
    );
    expect(scrubPath(`${GAME_FWD}/addons/data/ArmaReforger.gproj`, c)).toBe(
      "<game>/addons/data/ArmaReforger.gproj",
    );
    expect(scrubPath("./addons/core/core.gproj", c)).toBe("<game>/addons/core/core.gproj");
    expect(scrubPath(`${HOME_FWD}/Documents/GitHub/Gamma`, c)).toBe(
      "%USERPROFILE%/Documents/GitHub/<project-3>",
    );
    expect(
      scrubPath(
        `${HOME_FWD}/AppData/Local/Temp/Arma Reforger Workbench/Projects/Alpha/autosaves`,
        c,
      ),
    ).toBe("%TEMP%/Arma Reforger Workbench/Projects/<project-1>/autosaves");
    expect(scrubPath(`${ENCODED_TEMP}/Probe/addon.gproj`, c)).toBe(
      "%TEMP%/<scratch>/<project-4>/addon.gproj",
    );
    expect(scrubPath(`${ENCODED_TEMP}`, c)).toBe("%TEMP%/<scratch>");
    expect(
      scrubPath(`${HOME_FWD}/Documents/My Games/ArmaReforgerWorkbench/profile/.save/x`, c),
    ).toBe("<profile>");
    expect(scrubPath("E:/Elsewhere/Thing", c)).toBe("<path>");
    expect(scrubPath(`${HOME_FWD.replace("C:", "c:")}/Documents/GitHub/Gamma`, c)).toBe(
      "%USERPROFILE%/Documents/GitHub/<project-3>",
    );
  });

  it("keeps Bohemia's own names and tokenises everything else, case-insensitively", () => {
    const c = ctx();
    expect(projectToken(c, "ArmaReforger")).toBe("ArmaReforger");
    expect(projectToken(c, "core")).toBe("core");
    expect(projectToken(c, "Something")).toBe("<project-1>");
    expect(projectToken(c, "SOMETHING")).toBe("<project-1>");
    expect(projectToken(c, "Other")).toBe("<project-2>");
  });

  it("removes planted accounts and home paths from free text", () => {
    const c = ctx();
    const dirty = `crash at '${HOME_BACK}${BS}x.c', user ${ACCT.toLowerCase()} on '${HOME_FWD}/y' and 'C:${BS}Elsewhere${BS}z' ${STEAM} a@b.example`;
    const clean = scrubText(dirty, c);
    expect(clean.toLowerCase()).not.toContain(ACCT.toLowerCase());
    expect(clean).not.toContain("Users");
    expect(clean).toContain("%USERPROFILE%");
    expect(clean).toContain("<path>");
    expect(clean).toContain("<steam-id>");
    expect(clean).toContain("<email>");
    expect(() => assertScrubbed(clean, c)).not.toThrow();
  });

  it("reduces a message to its shape", () => {
    const c = ctx();
    expect(shapeMessage("Unknown keyword/data 'AUTHOR' at offset 134(0x86)", c)).toBe(
      "Unknown keyword/data '<name>' at offset <n>(<hex>)",
    );
    expect(
      shapeMessage(
        'Wrong GUID/name for resource @"{0AFDD005CD669892}Language/x.st" in property "StringTableSource"',
        c,
      ),
    ).toBe('Wrong GUID/name for resource @"<res>" in property "<name>"');
    expect(shapeMessage("Addon 'Gamma' dependency '481849A4E0D88BEA' can't be added", c)).toBe(
      "Addon '<name>' dependency '<guid>' can't be added",
    );
    expect(shapeMessage("@\"Scripts/A.c,785\": 'GetX' is obsolete: Use Y instead.", c)).toBe(
      "@\"<res>\": '<name>' is obsolete",
    );
  });

  it("refuses an output that still holds a planted account, home path or Steam id, without repeating it", () => {
    const c = ctx();
    for (const bad of [
      `x ${HOME_BACK}${BS}y`,
      `x ${HOME_FWD}/y`,
      `name ${ACCT}`,
      `id ${STEAM}`,
      `${ACCT.toUpperCase()}`,
    ]) {
      let message = "";
      try {
        assertScrubbed(bad, c, "test");
      } catch (e) {
        expect(e).toBeInstanceOf(ScrubError);
        message = (e as Error).message;
      }
      expect(message).not.toBe("");
      expect(message.toLowerCase()).not.toContain(ACCT.toLowerCase());
    }
  });

  it("discovers an account name from the log's own paths", () => {
    expect(
      discoverAccounts(`x '${HOME_BACK}${BS}a' y '${HOME_FWD}/b' C--Users-${ACCT}-Documents`),
    ).toEqual([ACCT]);
  });
});

// ── Echo parsing ───────────────────────────────────────────────────────────────

describe("e13 CLI echo", () => {
  it("splits switches from values that contain spaces and commas", () => {
    const t = parseCliEcho(
      `-wbModule WorldEditor -wbProjectPath ${ADDONS_FWD}/Alpha/addon.gproj -addonsDir C:/a b,C:/c -noThrow -x=y `,
    );
    expect(t.map((x) => x.switch)).toEqual([
      "wbModule",
      "wbProjectPath",
      "addonsDir",
      "noThrow",
      "x",
    ]);
    expect(t[1].value).toBe(`${ADDONS_FWD}/Alpha/addon.gproj`);
    expect(t[2].value).toBe("C:/a b,C:/c");
    expect(t[3].value).toBeNull();
    expect(t[4].value).toBe("y");
  });

  it("classifies values and names the project a .gproj path asks for", () => {
    expect(valueKind(null)).toBe("flag");
    expect(valueKind("WorldEditor")).toBe("module-name");
    expect(valueKind("C:/x/addon.gproj")).toBe("project-file");
    expect(valueKind("C:/a,C:/b")).toBe("path-list");
    expect(valueKind("C:/a")).toBe("path");
    expect(valueKind("0123456789ABCDEF,0123456789ABCDEE")).toBe("guid-list");
    expect(projectNameOfGproj("C:/x/Alpha/addon.gproj")).toBe("Alpha");
    expect(projectNameOfGproj("D:/g/addons/data/ArmaReforger.gproj")).toBe("ArmaReforger");
    expect(projectNameOfGproj("C:/x/notaproject")).toBeNull();
  });
});

// ── One session ────────────────────────────────────────────────────────────────

describe("e13 session facts", () => {
  it("reads the gap, the opened project, the cwd and whether the request was honoured", () => {
    const c = ctx();
    const phantom = parseSession(
      "logs_2026-01-02_10-00-00",
      { "console.log": consoleLog(SESSIONS["2026-01-02_10-00-00"]) },
      c,
    );
    expect(phantom.form).toBe("wbModule+wbProjectPath");
    expect(phantom.create_to_init_ms).toBe(15250);
    expect(phantom.startup_ms).toBe(24001);
    expect(phantom.cwd).toBe("game");
    expect(phantom.asked_project).toBe("<project-1>");
    expect(phantom.opened_project).toBe("<project-2>");
    expect(phantom.opened_matches_asked).toBe(false);
    expect(phantom.thumbnail_matches_autosave).toBe(true);
    expect(phantom.last_loaded_addon_matches_autosave).toBe(true);
    expect(phantom.echo).toBe(
      "CLI Params: -wbModule WorldEditor -wbProjectPath <addons>/<project-1>/addon.gproj",
    );

    const real = parseSession(
      "logs_2026-01-02_10-05-00",
      { "console.log": consoleLog(SESSIONS["2026-01-02_10-05-00"]) },
      c,
    );
    expect(real.form).toBe("gproj+addonsDir");
    expect(real.create_to_init_ms).toBe(1050);
    expect(real.opened_matches_asked).toBe(true);
    expect(real.echo).toBe(
      "CLI Params: -gproj <addons>/<project-1>/addon.gproj -addonsDir %USERPROFILE%/Documents/<project-3>,%TEMP%/<scratch>",
    );
    assertScrubbed(real.echo ?? "", c);

    const fallback = parseSession(
      "logs_2026-01-02_10-10-00",
      { "console.log": consoleLog(SESSIONS["2026-01-02_10-10-00"]) },
      c,
    );
    expect(fallback.opened_project).toBe("ArmaReforger");
    expect(fallback.opened_matches_asked).toBe(false);

    const stalled = parseSession(
      "logs_2026-01-02_10-15-00",
      { "console.log": consoleLog(SESSIONS["2026-01-02_10-15-00"]) },
      c,
    );
    expect(stalled.form).toBe("none");
    expect(stalled.reached_init).toBe(false);
    expect(stalled.create_to_init_ms).toBeNull();
    expect(stalled.opened_project).toBeNull();
    expect(stalled.cwd).toBe("other");
  });

  it("wraps the gap across midnight", () => {
    const c = ctx();
    const s = parseSession(
      "logs_2026-01-02_23-59-50",
      {
        "console.log": [
          line("23:59:50.000", "PROFILING", "Workbench Create Engine took: 1 ms"),
          "00:00:03.000 INIT         : INIT         : Workbench Init Engine",
        ].join("\n"),
      },
      c,
    );
    expect(s.create_to_init_ms).toBe(13000);
  });

  it("matches the hazard vocabulary and counts it per file, skipping the defines line", () => {
    const c = ctx();
    const text =
      consoleLog(SESSIONS["2026-01-02_10-10-00"]) +
      line("10:10:06.000", "SCRIPT", 'Module: Game; defines: "DEBUG_ASSERT,X"') +
      "\n";
    const s = parseSession(
      "logs_2026-01-02_10-10-00",
      { "console.log": text, "error.log": text },
      c,
    );
    const hit = (k: string) =>
      [...(s.hazards.get(k)?.lines.values() ?? [])].reduce((a, b) => a + b, 0);
    expect(hit("missing-addon-dependency")).toBe(2);
    expect(hit("vm-exception")).toBe(2);
    expect(hit("script-authorization")).toBe(2);
    expect(hit("assert-prompt")).toBe(2);
    expect(s.hazards.get("vm-exception")?.quote).toBe(
      "SCRIPT (E): Virtual Machine Exception at %USERPROFILE%/<path>",
    );
    expect(
      s.vocab.get("ENGINE (E): Addon '<name>' dependency '<guid>' can't be added")?.lines,
    ).toBe(1);
    expect(
      s.vocab.get('RESOURCES (W): resource not registered: @"<res>". Setting null GUID')?.lines,
    ).toBe(1);
  });

  it("reads the crash-reports list as one crash-reporter line per report", () => {
    const hits = parseCrashReports(CRASH_LINE + "\nnot a report\n", ctx());
    const crash = hits.get("crash-reporter");
    expect([...(crash?.lines.values() ?? [])]).toEqual([1]);
    expect(crash?.quote).toBe(
      "<date> <time> (UTC) : Version: <version> - Report Result: - SUCCESS - Crash GUID: <guid>",
    );
  });
});

describe("e13 finished-starting rule", () => {
  it("does not expect a project from a launcher-only session that printed the startup line but never initialised", () => {
    const c = ctx();
    const launcherOnly = parseSession(
      "logs_2026-01-03_10-00-00",
      {
        "console.log": consoleLog({
          startedAt: "2026-01-03_10-00-00",
          create: "10:00:00.100",
          init: null,
          echo: null,
          cwd: "c:\program files (x86)\steam\steamapps\common\arma reforger tools\workbench\\",
          opened: null,
          startup: "54572.78",
        }),
      },
      c,
    );
    expect(launcherOnly.startup_ms).toBe(54573);
    expect(launcherOnly.reached_init).toBe(false);
    expect(launcherOnly.opened_project).toBeNull();
    const mined = mineSynthetic().mined;
    const withLauncher = { ...mined, sessions: [...mined.sessions, launcherOnly] };
    const h = derive(withLauncher, checkGameLogs(makeGameLogs(false)), "1.0.0.1").headline;
    expect(h.opened_project_expected).toBe(3);
    expect(h.opened_project_matches).toBe(3);
  });
});

// ── Whole run on synthetic logs ────────────────────────────────────────────────

describe("e13 mining and rows", () => {
  it("counts sessions per launch form, switches and phantom outcomes", () => {
    const { derived } = mineSynthetic();
    const h = derived.headline;
    expect(h.session_folders).toBe(4);
    expect(h.sessions_with_console_log).toBe(4);
    expect(h.log_files_read).toEqual({ "CrashReports.log": 1, "console.log": 4, "error.log": 3 });
    expect(h.date_first).toBe("2026-01-02");
    expect(h.date_last).toBe("2026-01-02");
    expect(h.sessions_with_echo).toBe(3);
    expect(h.sessions_per_form).toEqual({
      gproj: 1,
      "gproj+addonsDir": 1,
      none: 1,
      "wbModule+wbProjectPath": 1,
    });
    expect(h.distinct_switches).toEqual(["addonsDir", "gproj", "wbModule", "wbProjectPath"]);
    expect(h.phantom_sessions).toBe(1);
    expect(h.phantom_opened_differs).toBe(1);
    expect(h.opened_project_matches).toBe(3);
    expect(h.opened_project_expected).toBe(3);
    const outcomes = Object.fromEntries(h.project_switch_outcomes.map((o) => [o.switch, o]));
    expect(outcomes.wbProjectPath.phantom).toBe(true);
    expect(outcomes.wbProjectPath.opened_differs_from_asked).toBe(1);
    expect(outcomes.gproj.phantom).toBe(false);
    expect(outcomes.gproj.sessions).toBe(2);
    expect(h.hazard_lines_by_type["missing-addon-dependency"]).toBe(2);
    expect(h.hazard_lines_by_type["crash-reporter"]).toBe(1);
    expect(h.hazard_lines_by_type["vm-exception"]).toBe(2);
  });

  it("emits cli-switch rows without a computed `what`, leaves the phantom switch out, and keeps it in the table", () => {
    const { derived } = mineSynthetic();
    const cli = derived.rows.filter((r) => r.kind === "cli-switch");
    expect(cli.map((r) => r.key.switch)).toEqual(["addonsDir", "gproj", "wbModule"]);
    expect(cli.every((r) => r.what === undefined)).toBe(true);
    expect(
      cli.every((r) => r.confidence === "high" && r.module === "none" && r.parent_key === null),
    ).toBe(true);
    const table = JSON.parse(
      derived.tables.find((t) => t.name === "cli-switches.json")?.text ?? "{}",
    ) as { rows: { key: string; phantom: boolean; sessions: number; of: number }[] };
    const phantom = table.rows.find((r) => r.key === "wbProjectPath");
    expect(phantom?.phantom).toBe(true);
    expect(phantom?.sessions).toBe(1);
    expect(table.rows.find((r) => r.key === "gproj")?.sessions).toBe(2);
    expect(table.rows.find((r) => r.key === "gproj")?.of).toBe(4);
    const hazards = derived.rows.filter((r) => r.kind === "hazard-dialog");
    const titles = hazards.map((r) => r.key.path?.[0]);
    expect(titles).toContain("Addon dependency can't be added");
    expect(titles).toContain("Crash report result");
    const crash = hazards.find((r) => r.key.path?.[0] === "Crash report result");
    expect(crash?.unverified?.some((u) => u.includes("build other than"))).toBe(true);
    expect(titles).toContain("Virtual Machine Exception");
    expect(hazards.every((r) => r.module === "Shared" && r.dim === "ui")).toBe(true);
    for (const r of derived.rows) {
      expect(observationSchema.safeParse(r).success).toBe(true);
      expect(r.ref).toMatch(/^artifact:[0-9a-f]{64}#.+$/);
      expect((r.quote ?? "").length).toBeLessThanOrEqual(200);
    }
  });

  it("cites table rows by the sha256 of the written table file", () => {
    const { derived } = mineSynthetic();
    const switches = derived.tables.find((t) => t.name === "cli-switches.json");
    expect(switches).toBeDefined();
    const row = derived.rows.find((r) => r.key.switch === "gproj");
    expect(row?.ref).toBe(`artifact:${switches?.sha256}#gproj`);
    const parsed = JSON.parse(switches?.text ?? "{}") as {
      rows: { key: string; example_echo: string }[];
    };
    expect(parsed.rows.find((r) => r.key === "gproj")?.example_echo).toBe(row?.quote);
  });

  it("writes no planted account, home path or Users segment anywhere", () => {
    const { c, mined, derived } = mineSynthetic();
    const everything = [
      ...derived.tables.map((t) => t.text),
      observationFileText(derived.rows, mined.inputs, "1.0.0.1"),
      JSON.stringify(derived.headline),
    ].join("\n");
    expect(everything.toLowerCase()).not.toContain(ACCT.toLowerCase());
    expect(everything).not.toContain("Users");
    expect(everything).not.toContain(HOME_FWD);
    expect(everything).not.toContain("Alpha");
    expect(everything).not.toContain("Gamma");
    expect(everything).not.toContain("Somerepo");
    expect(() => assertScrubbed(everything, c)).not.toThrow();
  });

  it("is deterministic: a second mining gives byte-identical tables and observations", () => {
    const logs = makeLogs();
    const a = derive(mineLogs(logs, ctx()), checkGameLogs(makeGameLogs(false)), "1.0.0.1");
    const b = derive(mineLogs(logs, ctx()), checkGameLogs(makeGameLogs(false)), "1.0.0.1");
    expect(b.tables.map((t) => t.text)).toEqual(a.tables.map((t) => t.text));
    expect(b.rows).toEqual(a.rows);
  });

  it("says whether game logs carry Workbench sessions", () => {
    expect(checkGameLogs(makeGameLogs(false)).folders_with_workbench_session_markers).toBe(0);
    const yes = checkGameLogs(makeGameLogs(true));
    expect(yes.folders_with_workbench_session_markers).toBe(1);
    expect(yes.folders_with_cli_echo).toBe(1);
    expect(checkGameLogs(join(tmpdir(), "e13-no-such-folder")).present).toBe(false);
  });
});

// ── The CLI ────────────────────────────────────────────────────────────────────

describe("e13 CLI", () => {
  it("writes the observation file and the artifact tables, and the ledger accepts them", () => {
    const fx = makeCensus("1.0.0.1");
    const art = mkdtempSync(join(tmpdir(), "e13-art-"));
    const args = ["--logs", makeLogs(), "--game-logs", makeGameLogs(false), "--artifacts", art];
    const r = runIn(fx, runE13, args);
    expect(r.code).toBe(0);
    const obs = join(fx.root, "observations", "E13", "1.0.0.1.jsonl");
    expect(existsSync(obs)).toBe(true);
    for (const f of [
      "sessions",
      "cli-switches",
      "launch-forms",
      "opened-project-line",
      "hazard-lines",
      "error-vocabulary",
      "game-logs-check",
      "summary",
    ]) {
      expect(existsSync(join(art, `${f}.json`))).toBe(true);
    }
    const text = readFileSync(obs, "utf-8");
    const header = JSON.parse(text.split("\n")[0]) as {
      row_count: number;
      provisional: boolean;
      inputs: { path: string }[];
    };
    expect(header.provisional).toBe(false);
    expect(header.row_count).toBe(text.trim().split("\n").length - 1);
    expect(header.inputs.every((i) => i.path.startsWith("<workbench-logs>/"))).toBe(true);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    const ids = built.rows.map((x) => x.id);
    expect(ids).toContain("cli:-gproj");
    expect(ids).not.toContain("cli:-wbProjectPath");
    expect(ids).toContain("ui:Shared/hazard-dialog/Addon dependency can't be added");
  });

  it("is byte-identical on a second run", () => {
    const fx = makeCensus("1.0.0.1");
    const logs = makeLogs();
    const game = makeGameLogs(false);
    const a1 = mkdtempSync(join(tmpdir(), "e13-art-"));
    const a2 = mkdtempSync(join(tmpdir(), "e13-art-"));
    runIn(fx, runE13, ["--logs", logs, "--game-logs", game, "--artifacts", a1]);
    const obs = join(fx.root, "observations", "E13", "1.0.0.1.jsonl");
    const first = readFileSync(obs, "utf-8");
    runIn(fx, runE13, ["--logs", logs, "--game-logs", game, "--artifacts", a2]);
    expect(readFileSync(obs, "utf-8")).toBe(first);
    expect(readFileSync(join(a2, "cli-switches.json"), "utf-8")).toBe(
      readFileSync(join(a1, "cli-switches.json"), "utf-8"),
    );
  });

  it("answers NO DATA when the logs folder is absent", () => {
    const fx = makeCensus("1.0.0.1");
    const r = runIn(fx, runE13, [
      "--logs",
      join(tmpdir(), "e13-no-such-logs"),
      "--artifacts",
      mkdtempSync(join(tmpdir(), "e13-art-")),
    ]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
    expect(existsSync(join(fx.root, "observations", "E13"))).toBe(false);
  });

  it("refuses an output path outside observations/E13 and an artifacts folder inside a git tree", () => {
    const fx = makeCensus("1.0.0.1");
    const logs = makeLogs();
    const out = runIn(fx, runE13, [
      "--logs",
      logs,
      "--out",
      join(fx.root, "observations", "E01", "x.jsonl"),
    ]);
    expect(out.code).toBe(1);
    const inTree = runIn(fx, runE13, [
      "--logs",
      logs,
      "--artifacts",
      join(REPO_ROOT, "e13-test-artifacts"),
    ]);
    expect(inTree.code).toBe(1);
    expect(existsSync(join(REPO_ROOT, "e13-test-artifacts"))).toBe(false);
  });
});

// ── The real install ───────────────────────────────────────────────────────────

describe.skipIf(!existsSync(defaultLogsDir()))("e13 against the retained Workbench logs", () => {
  it("names the opened project in every session that finished starting, and leaks nothing", () => {
    const c = makeScrubContext();
    const mined = mineLogs(defaultLogsDir(), c);
    const derived = derive(
      mined,
      checkGameLogs(join(defaultLogsDir(), "..", "..", "ArmaReforger", "logs")),
      "real",
    );
    const h = derived.headline;
    expect(h.sessions_with_console_log).toBeGreaterThan(0);
    expect(h.opened_project_matches).toBe(h.opened_project_expected);
    expect(Object.values(h.sessions_per_form).reduce((a, b) => a + b, 0)).toBe(
      h.sessions_with_console_log,
    );
    const everything = [
      ...derived.tables.map((t) => t.text),
      observationFileText(derived.rows, mined.inputs, "real"),
    ].join("\n");
    expect(() => assertScrubbed(everything, c)).not.toThrow();
    expect(everything).not.toMatch(/Users[\\/]/);
  });
});
