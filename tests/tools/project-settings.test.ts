import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  registerProjectSettings,
  runProjectSettings,
  unifiedDiff,
  type ProjectSettingsArgs,
} from "../../src/tools/project-settings.js";

const SAMPLE = [
  "GameProject {",
  ' ID "SampleProject"',
  ' GUID "11AA22BB33CC44DD"',
  ' TITLE "Sample Project"',
  " Dependencies {",
  '  "58D0FB3206B6F859"',
  " }",
  ' EngineSettingsPath "Engine.conf"',
  " Configurations {",
  "  GameProjectConfig PC {",
  '   WorldFile "{077CF7C916637442}worlds/Main.ent"',
  "  }",
  "  GameProjectConfig HEADLESS {",
  "  }",
  " }",
  "}",
].join("\n");

const BARE = ["GameProject {", ' ID "Bare"', ' GUID "0123456789ABCDEF"', ' TITLE "Bare"', "}"].join(
  "\n",
);

const dir = mkdtempSync(join(tmpdir(), "proj-settings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });
});

const cfg = (extra: Partial<Config> = {}): Config =>
  ({ projectPath: dir, gamePath: "", dataDir: "", ...extra }) as Config;

const run = (a: Partial<ProjectSettingsArgs> & { action: ProjectSettingsArgs["action"] }) =>
  runProjectSettings({ path: "Sample.gproj", ...a } as ProjectSettingsArgs, cfg());
const text = (rel: string) => readFileSync(join(dir, rel), "utf-8");
const put = (rel: string, body: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), body, "utf-8");
};

function err(r: ReturnType<typeof run>): string {
  if (r.ok) throw new Error("expected a refusal");
  return r.code;
}

describe("project_settings read", () => {
  it("summarises the project file", () => {
    put("Sample.gproj", SAMPLE);
    const r = run({ action: "read" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe("path:Sample.gproj");
    expect(r.changed).toBeNull();
    const rb = r.readback as Record<string, unknown>;
    expect(rb.id).toBe("SampleProject");
    expect(rb.guid).toBe("11AA22BB33CC44DD");
    expect(rb.platforms).toEqual(["PC", "HEADLESS"]);
    expect(rb.dependencies).toEqual([{ guid: "58D0FB3206B6F859", id: undefined }]);
    expect((rb.settings as Record<string, string>).EngineSettingsPath).toBe("Engine.conf");
    expect(
      (rb.platformSettings as Record<string, { settings: Record<string, string> }>).PC.settings
        .WorldFile,
    ).toBe("{077CF7C916637442}worlds/Main.ent");
  });

  it("needs a path when the root holds two project files, or none", () => {
    const two = mkdtempSync(join(tmpdir(), "proj-two-"));
    try {
      writeFileSync(join(two, "A.gproj"), BARE);
      writeFileSync(join(two, "B.gproj"), BARE);
      expect(err(runProjectSettings({ action: "read" }, cfg({ projectPath: two })))).toBe(
        "INVALID_ARGUMENT",
      );
      expect(
        runProjectSettings(
          { action: "read", path: "B.gproj", projectPath: two },
          cfg({ projectPath: two }),
        ).ok,
      ).toBe(true);
      expect(
        err(
          runProjectSettings(
            { action: "read", projectPath: join(two, "nope") },
            cfg({ projectPath: two }),
          ),
        ),
      ).toBe("PATH_NOT_FOUND");
    } finally {
      rmSync(two, { recursive: true, force: true });
    }
  });

  it("refuses a file that is not a project file or has parse trouble", () => {
    put("odd.gproj", "SomethingElse {\n}\n");
    expect(err(run({ action: "read", path: "odd.gproj" }))).toBe("INVALID_ARGUMENT");
    put("broken.gproj", 'GameProject {\n ID "X"\n');
    expect(err(run({ action: "read", path: "broken.gproj" }))).toBe("INVALID_ARGUMENT");
  });
});

describe("project_settings refusals", () => {
  it("refuses a path that escapes the project, an absolute path and a non-gproj", () => {
    put("Sample.gproj", SAMPLE);
    for (const action of ["read", "set", "addPlatform"] as const) {
      expect(err(run({ action, path: "../escape.gproj", key: "TITLE", value: "x" }))).toBe(
        "ABSOLUTE_PATH",
      );
      expect(err(run({ action, path: join(dir, "Sample.gproj") }))).toBe("ABSOLUTE_PATH");
    }
    expect(err(run({ action: "read", path: "Sample.conf" }))).toBe("INVALID_ARGUMENT");
  });

  it("refuses a link that points outside the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "proj-out-"));
    try {
      writeFileSync(join(outside, "Out.gproj"), BARE);
      try {
        symlinkSync(outside, join(dir, "link"), "junction");
      } catch {
        return; // no link rights here
      }
      expect(err(run({ action: "set", path: "link/Out.gproj", key: "TITLE", value: "x" }))).toBe(
        "NOT_IN_PROJECT",
      );
      expect(readFileSync(join(outside, "Out.gproj"), "utf-8")).toBe(BARE);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("never creates a file", () => {
    expect(
      err(run({ action: "set", path: "New.gproj", key: "TITLE", value: "x", confirm: true })),
    ).toBe("PATH_NOT_FOUND");
    expect(existsSync(join(dir, "New.gproj"))).toBe(false);
  });

  it("refuses a file whose bytes the parser cannot reproduce", () => {
    put("Opaque.gproj", `${SAMPLE}\n}\n`); // a stray closing brace
    expect(
      err(run({ action: "set", path: "Opaque.gproj", key: "TITLE", value: "x", confirm: true })),
    ).toBe("INVALID_ARGUMENT");
    expect(text("Opaque.gproj")).toBe(`${SAMPLE}\n}\n`);
  });

  it("refuses bad arguments", () => {
    put("Sample.gproj", SAMPLE);
    expect(err(run({ action: "set", value: "x" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "set", key: "TITLE" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "set", key: "bad key", value: "x" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "set", key: "GUID", value: "AAAAAAAAAAAAAAAA", confirm: true }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(err(run({ action: "set", key: "ID", value: "Other", confirm: true }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(err(run({ action: "set", key: "Dependencies", value: "x" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "set", key: "TITLE", value: 'a"b' }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "set", key: "TITLE", value: "x", platform: "XBOX_ONE" }))).toBe(
      "PATH_NOT_FOUND",
    );
    expect(err(run({ action: "addDependency", guid: "nothex" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "addDependency" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "addDependency", guid: "58d0fb3206b6f859" }))).toBe(
      "INVALID_ARGUMENT",
    ); // duplicate, case-insensitive
    expect(err(run({ action: "addDependency", guid: "{11aa22bb33cc44dd}" }))).toBe(
      "INVALID_ARGUMENT",
    ); // itself
    expect(err(run({ action: "removeDependency", guid: "AAAAAAAAAAAAAAAA" }))).toBe(
      "PATH_NOT_FOUND",
    );
    expect(err(run({ action: "addPlatform", platform: "pc" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "addPlatform", platform: "PC" }))).toBe("INVALID_ARGUMENT");
    expect(err(run({ action: "removePlatform", platform: "PS5" }))).toBe("PATH_NOT_FOUND");
    expect(err(run({ action: "removePlatform", platform: "PC" }))).toBe("INVALID_ARGUMENT"); // holds settings
    expect(text("Sample.gproj")).toBe(SAMPLE);
  });
});

describe("project_settings dry run and confirm", () => {
  it("a dry run answers the change and writes nothing; confirm writes exactly that", () => {
    put("Sample.gproj", SAMPLE);
    const args = { action: "set", key: "TITLE", value: "Renamed" } as const;
    const dry = run(args);
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.changed).toEqual([{ path: "TITLE", before: "Sample Project", after: "Renamed" }]);
    expect((dry.readback as { dryRun: boolean; written: boolean }).dryRun).toBe(true);
    expect((dry.readback as { diff: string }).diff).toContain('- TITLE "Sample Project"');
    expect(text("Sample.gproj")).toBe(SAMPLE);

    const done = run({ ...args, confirm: true });
    expect(done.ok).toBe(true);
    expect(text("Sample.gproj")).toBe(SAMPLE.replace('TITLE "Sample Project"', 'TITLE "Renamed"'));
    if (done.ok) expect((done.readback as { written: boolean }).written).toBe(true);
  });

  it("every edit shows the same diff on the dry run as it writes", () => {
    const cases: (Partial<ProjectSettingsArgs> & { action: ProjectSettingsArgs["action"] })[] = [
      { action: "set", key: "EngineSettingsPath", value: "Other.conf" },
      { action: "set", key: "WorldFile", value: "w.ent", platform: "PC" },
      { action: "set", key: "SplashScreenClass", value: "Splash", platform: "HEADLESS" },
      { action: "set", key: "WBDocumentationConfig", value: "docs.conf" },
      { action: "addDependency", guid: "AAAAAAAAAAAAAAAA" },
      { action: "removeDependency", guid: "58D0FB3206B6F859" },
      { action: "addPlatform", platform: "PS5" },
      { action: "removePlatform", platform: "HEADLESS" },
    ];
    for (const c of cases) {
      put("Sample.gproj", SAMPLE);
      const dry = run(c);
      expect(dry.ok, JSON.stringify(c) + JSON.stringify(dry)).toBe(true);
      expect(text("Sample.gproj")).toBe(SAMPLE);
      const wrote = run({ ...c, confirm: true });
      expect(wrote.ok).toBe(true);
      if (!dry.ok || !wrote.ok) continue;
      expect((wrote.readback as { diff: string }).diff).toBe(
        (dry.readback as { diff: string }).diff,
      );
      expect(wrote.changed).toEqual(dry.changed);
      // The written file is exactly the diff applied: nothing else moved.
      const diff = (wrote.readback as { diff: string }).diff;
      expect(diff).toBe(unifiedDiff(SAMPLE, text("Sample.gproj"), "Sample.gproj"));
    }
  });
});

describe("project_settings actions", () => {
  it("set keeps quoting, adds new keys before Configurations, edits a platform block", () => {
    put("Sample.gproj", SAMPLE);
    run({ action: "set", key: "WBDocumentationConfig", value: "docs.conf", confirm: true });
    expect(text("Sample.gproj")).toContain(' WBDocumentationConfig "docs.conf"\n Configurations {');
    run({
      action: "set",
      key: "WorldFile",
      value: "{AAAAAAAAAAAAAAAA}w.ent",
      platform: "PC",
      confirm: true,
    });
    expect(text("Sample.gproj")).toContain('   WorldFile "{AAAAAAAAAAAAAAAA}w.ent"');
    run({ action: "set", key: "Verbose", value: 1, platform: "HEADLESS", confirm: true });
    expect(text("Sample.gproj")).toContain("  GameProjectConfig HEADLESS {\n   Verbose 1\n  }");
    const r = run({ action: "read" });
    expect(
      r.ok &&
        (r.readback as { platformSettings: Record<string, { settings: Record<string, string> }> })
          .platformSettings.HEADLESS.settings.Verbose,
    ).toBe("1");
  });

  it("set then set back restores the bytes", () => {
    put("Sample.gproj", SAMPLE);
    run({ action: "set", key: "TITLE", value: "Other", confirm: true });
    run({ action: "set", key: "TITLE", value: "Sample Project", confirm: true });
    expect(text("Sample.gproj")).toBe(SAMPLE);
  });

  it("addDependency and removeDependency, and their inverses", () => {
    put("Sample.gproj", SAMPLE);
    run({ action: "addDependency", guid: "{6566a2d70498da6b}", confirm: true });
    expect(text("Sample.gproj")).toContain(
      ' Dependencies {\n  "58D0FB3206B6F859"\n  "6566A2D70498DA6B"\n }',
    );
    run({ action: "removeDependency", guid: "6566A2D70498DA6B", confirm: true });
    expect(text("Sample.gproj")).toBe(SAMPLE);
  });

  it("creates the Dependencies block after TITLE and removes it with the last entry", () => {
    put("Bare.gproj", BARE);
    run({ action: "addDependency", path: "Bare.gproj", guid: "58D0FB3206B6F859", confirm: true });
    expect(text("Bare.gproj")).toBe(
      [
        "GameProject {",
        ' ID "Bare"',
        ' GUID "0123456789ABCDEF"',
        ' TITLE "Bare"',
        " Dependencies {",
        '  "58D0FB3206B6F859"',
        " }",
        "}",
      ].join("\n"),
    );
    const gone = run({
      action: "removeDependency",
      path: "Bare.gproj",
      guid: "58D0FB3206B6F859",
      confirm: true,
    });
    expect(gone.ok && gone.warnings.join(" ")).toContain("empty Dependencies block");
    expect(text("Bare.gproj")).toBe(BARE);
  });

  it("addPlatform and removePlatform, creating Configurations when missing", () => {
    put("Sample.gproj", SAMPLE);
    run({ action: "addPlatform", platform: "PS5", confirm: true });
    expect(text("Sample.gproj")).toContain("  GameProjectConfig PS5 {\n  }\n }\n}");
    run({ action: "removePlatform", platform: "PS5", confirm: true });
    expect(text("Sample.gproj")).toBe(SAMPLE);

    put("Bare.gproj", BARE);
    const added = run({ action: "addPlatform", path: "Bare.gproj", platform: "PC", confirm: true });
    expect(added.ok).toBe(true);
    expect(text("Bare.gproj")).toContain(" Configurations {\n  GameProjectConfig PC {\n  }\n }\n}");
    run({ action: "removePlatform", path: "Bare.gproj", platform: "PC", confirm: true });
    expect(run({ action: "read", path: "Bare.gproj" }).ok).toBe(true);
  });

  it("removePlatform drops settings only with discard, and says so", () => {
    put("Sample.gproj", SAMPLE);
    const r = run({ action: "removePlatform", platform: "PC", discard: true, confirm: true });
    expect(r.ok && r.warnings.join(" ")).toContain("dropped");
    expect(text("Sample.gproj")).not.toContain("WorldFile");
    expect(text("Sample.gproj")).toContain("GameProjectConfig HEADLESS");
  });

  it("warns on a platform name the vanilla files do not carry", () => {
    put("Sample.gproj", SAMPLE);
    const r = run({ action: "addPlatform", platform: "SWITCH" });
    expect(r.ok && r.warnings.join(" ")).toContain("not a platform");
  });

  it("keeps CRLF line endings and every byte it does not touch", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    put("Crlf.gproj", crlf);
    run({ action: "addPlatform", path: "Crlf.gproj", platform: "PS4", confirm: true });
    const out = text("Crlf.gproj");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("GameProjectConfig PS4 {\r\n  }");
    run({ action: "removePlatform", path: "Crlf.gproj", platform: "PS4", confirm: true });
    expect(text("Crlf.gproj")).toBe(crlf);
  });
});

describe("project_settings tool registration", () => {
  it("registers project_settings with a short description and answers JSON", async () => {
    put("Sample.gproj", SAMPLE);
    let def: { description: string } | undefined;
    let handler: (a: Record<string, unknown>) => Promise<{
      content: { text: string }[];
      isError: boolean;
    }> = async () => ({ content: [], isError: false });
    registerProjectSettings(
      {
        registerTool: (name: string, d: { description: string }, h: typeof handler) => {
          expect(name).toBe("project_settings");
          def = d;
          handler = h;
        },
      } as never,
      cfg(),
    );
    expect(def!.description.length).toBeLessThanOrEqual(400);
    const ok = await handler({ action: "read" });
    expect(ok.isError).toBe(false);
    expect(JSON.parse(ok.content[0].text).ok).toBe(true);
    const bad = await handler({ action: "set", path: "../x.gproj", key: "TITLE", value: "x" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text).code).toBe("ABSOLUTE_PATH");
  });
});

// ── Corpus: every .gproj the game ships, byte-exact ─────────────────────────

const gamePath = loadConfig().gamePath;
const haveGame = !!gamePath && existsSync(join(gamePath, "addons"));

function gameGprojs(): { rel: string; file?: string; bytes: Buffer }[] {
  const out: { rel: string; file?: string; bytes: Buffer }[] = [];
  const seen = new Set<string>();
  // The vanilla project files sit beside the paks (addons/<x>/<x>.gproj).
  const addons = join(gamePath, "addons");
  for (const d of readdirSync(addons, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(addons, d.name))) {
      if (!f.toLowerCase().endsWith(".gproj")) continue;
      const file = join(addons, d.name, f);
      out.push({ rel: `${d.name}/${f}`, file, bytes: readFileSync(file) });
      seen.add(`${d.name}/${f}`.toLowerCase());
    }
  }
  // Any that a pak carries.
  const vfs = PakVirtualFS.get(gamePath);
  for (const p of vfs?.allFilePaths() ?? []) {
    if (p.toLowerCase().endsWith(".gproj") && !seen.has(p.toLowerCase())) {
      out.push({ rel: p, bytes: vfs!.readFile(p) });
    }
  }
  return out;
}

describe.skipIf(!haveGame)(
  haveGame ? "gproj corpus" : "gproj corpus (skipped: ENFUSION_GAME_PATH not available)",
  () => {
    it("parse then emit reproduces every vanilla .gproj byte for byte", () => {
      const files = gameGprojs();
      expect(files.length).toBeGreaterThan(0);
      let exact = 0;
      const bad: string[] = [];
      for (const f of files) {
        const doc = parseCstBytes(f.bytes);
        if (doc.toBytes().equals(f.bytes) && doc.diagnostics.length === 0) exact++;
        else bad.push(f.rel);
      }
      console.log(`gproj corpus round trip: ${exact}/${files.length} byte-exact`);
      expect(bad).toEqual([]);
      expect(exact).toBe(files.length);
    });

    it("read answers each vanilla project and an edit then its inverse restores it", () => {
      const files = gameGprojs();
      const work = mkdtempSync(join(tmpdir(), "proj-corpus-"));
      try {
        let n = 0;
        for (const f of files) {
          const name = `p${n++}.gproj`;
          writeFileSync(join(work, name), f.bytes);
          const at = { path: name, projectPath: work };
          const read = runProjectSettings({ action: "read", ...at }, cfg({ projectPath: work }));
          expect(read.ok, f.rel).toBe(true);
          const before = readFileSync(join(work, name));
          const steps: Partial<ProjectSettingsArgs>[][] = [
            [
              { action: "addPlatform", platform: "SWITCH" },
              { action: "removePlatform", platform: "SWITCH" },
            ],
            [
              { action: "addDependency", guid: "AAAAAAAAAAAAAAAA" },
              { action: "removeDependency", guid: "AAAAAAAAAAAAAAAA" },
            ],
          ];
          for (const pair of steps) {
            for (const s of pair) {
              const r = runProjectSettings(
                { ...s, ...at, confirm: true } as ProjectSettingsArgs,
                cfg({ projectPath: work }),
              );
              expect(r.ok, `${f.rel} ${JSON.stringify(s)} ${JSON.stringify(r)}`).toBe(true);
            }
            expect(readFileSync(join(work, name)).equals(before), `${f.rel} restored`).toBe(true);
          }
        }
        console.log(`gproj corpus edit+inverse: ${n}/${files.length} restored byte-exact`);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });

    it("reads a game addon's project file by its addons-relative path", () => {
      const first = gameGprojs().find((f) => f.file);
      if (!first) return;
      const r = runProjectSettings({ action: "read", path: first.rel }, {
        projectPath: dir,
        gamePath,
        dataDir: "",
      } as Config);
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.readback as { source: string }).source).toBe("game");
      // and it never writes there
      const w = runProjectSettings(
        { action: "set", path: first.rel, key: "TITLE", value: "x", confirm: true },
        { projectPath: dir, gamePath, dataDir: "" } as Config,
      );
      expect(w.ok).toBe(false);
    });
  },
);

// The installed addons beside the user's projects: more real files, when present.
const addonsDir = loadConfig().projectPath;
const siblings: string[] = [];
try {
  for (const d of readdirSync(addonsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(addonsDir, d.name))) {
      if (f.toLowerCase().endsWith(".gproj")) siblings.push(join(addonsDir, d.name, f));
    }
  }
} catch {
  // no addons folder on this machine
}

describe.skipIf(siblings.length === 0)(
  siblings.length
    ? "installed addons .gproj corpus"
    : "installed addons corpus (skipped: none found)",
  () => {
    it("round trips every installed addon .gproj byte for byte", () => {
      let exact = 0;
      const bad: string[] = [];
      for (const f of siblings) {
        const bytes = readFileSync(f);
        const doc = parseCstBytes(bytes);
        if (doc.toBytes().equals(bytes) && doc.diagnostics.length === 0) exact++;
        else bad.push(f);
      }
      console.log(`installed addons round trip: ${exact}/${siblings.length} byte-exact`);
      expect(bad).toEqual([]);
    });
  },
);

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/project_settings.addDependency
// census:mcp:action/project_settings.addPlatform
// census:mcp:action/project_settings.read
// census:mcp:action/project_settings.removeDependency
// census:mcp:action/project_settings.removePlatform
// census:mcp:action/project_settings.set
