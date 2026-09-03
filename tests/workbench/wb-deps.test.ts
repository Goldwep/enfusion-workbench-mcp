import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkWorkbenchVisibleDeps,
  extractGprojDeps,
  formatDepFindings,
  readRegisteredProjectPaths,
  readRootGuid,
  scanAddonRoot,
  scanRegisteredProjects,
} from "../../src/workbench/wb-deps.js";

const BASE_GAME_GUID = "58D0FB3206B6F859";
const WB_DEP_GUID = "AAAAAAAAAAAAAAAA";
const WORKSHOP_GUID = "BBBBBBBBBBBBBBBB";
const MISSING_GUID = "CCCCCCCCCCCCCCCC";
const SIBLING_GUID = "DDDDDDDDDDDDDDDD";
const PROJ_GUID = "EEEEEEEEEEEEEEEE";

function gproj(id: string, guid: string, deps: string[]): string {
  const depBlock =
    deps.length > 0
      ? ` Dependencies {\n${deps.map((d) => `  "${d}"`).join("\n")}\n }\n`
      : "";
  return `GameProject {\n ID "${id}"\n GUID "${guid}"\n TITLE "${id}"\n${depBlock}}\n`;
}

let root: string;
let paths: { projectPath: string; corePath: string; gamePath: string; workshopPath?: string };

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "wb-deps-"));
  const mk = (...p: string[]) => {
    const dir = join(root, ...p);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  // Base game install: <gamePath>/addons/data/ArmaReforger.gproj
  writeFileSync(
    join(mk("game", "addons", "data"), "ArmaReforger.gproj"),
    gproj("ArmaReforger", BASE_GAME_GUID, []),
  );
  // Tools core addons: <corePath>/core/core.gproj
  writeFileSync(join(mk("core-addons", "core"), "core.gproj"), gproj("core", "5614BBCCBB55ED1C", []));
  // Workbench addons dir: one dep addon + the target project
  writeFileSync(join(mk("wbaddons", "DepAddon"), "addon.gproj"), gproj("DepAddon", WB_DEP_GUID, []));
  writeFileSync(
    join(mk("wbaddons", "MyProj"), "addon.gproj"),
    gproj("MyProj", PROJ_GUID, [BASE_GAME_GUID, WB_DEP_GUID, WORKSHOP_GUID, MISSING_GUID]),
  );
  // Game workshop downloads (NOT Workbench-visible)
  writeFileSync(
    join(mk("workshop", `CoolMod_${WORKSHOP_GUID}`), "addon.gproj"),
    gproj("CoolMod", WORKSHOP_GUID, []),
  );
  // A project living OUTSIDE the Workbench addons dir, next to a sibling dep
  writeFileSync(
    join(mk("elsewhere", "SiblingDep"), "addon.gproj"),
    gproj("SiblingDep", SIBLING_GUID, []),
  );
  writeFileSync(
    join(mk("elsewhere", "ProjOutside"), "addon.gproj"),
    gproj("ProjOutside", "FFFFFFFFFFFFFFFF", [BASE_GAME_GUID, SIBLING_GUID]),
  );
  // Noise the scanner must tolerate
  mk("wbaddons", "saves");
  writeFileSync(join(root, "wbaddons", "stray.jpg"), "not a dir");

  paths = {
    projectPath: join(root, "wbaddons"),
    corePath: join(root, "core-addons"),
    gamePath: join(root, "game"),
    workshopPath: join(root, "workshop"),
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("wb-deps: readRootGuid", () => {
  it("reads the root GUID property", () => {
    expect(readRootGuid(gproj("X", "0123456789ABCDEF", []))).toBe("0123456789ABCDEF");
  });

  it("is not confused by nested braced container refs", () => {
    const content =
      'GameProject {\n GUID "AAAAAAAA11111111"\n Foo {\n  Bar "{BBBBBBBB22222222}scripts/x"\n }\n}\n';
    expect(readRootGuid(content)).toBe("AAAAAAAA11111111");
  });

  it("returns null when no root GUID exists", () => {
    expect(readRootGuid('SubScene {\n Parent "{AABBCCDD00112233}worlds/x.ent"\n}\n')).toBeNull();
  });
});

describe("wb-deps: scanAddonRoot", () => {
  it("collects each addon dir's gproj GUID and skips noise", () => {
    const scanned = scanAddonRoot(join(root, "wbaddons"));
    const guids = scanned.map((s) => s.guid).sort();
    expect(guids).toEqual([WB_DEP_GUID, PROJ_GUID].sort());
  });

  it("returns empty for a missing root", () => {
    expect(scanAddonRoot(join(root, "does-not-exist"))).toEqual([]);
  });

  it("accepts non-addon.gproj filenames (core.gproj, ArmaReforger.gproj)", () => {
    const scanned = scanAddonRoot(join(root, "game", "addons"));
    expect(scanned.map((s) => s.guid)).toContain(BASE_GAME_GUID);
  });
});

describe("wb-deps: checkWorkbenchVisibleDeps", () => {
  it("classifies base-game / wb-addons / workshop-only / missing", () => {
    const check = checkWorkbenchVisibleDeps(join(root, "wbaddons", "MyProj", "addon.gproj"), paths);
    const byGuid = new Map(check.findings.map((f) => [f.guid, f]));
    expect(byGuid.get(BASE_GAME_GUID)?.status).toBe("wb-visible");
    expect(byGuid.get(BASE_GAME_GUID)?.locationKind).toBe("base-game");
    expect(byGuid.get(WB_DEP_GUID)?.status).toBe("wb-visible");
    expect(byGuid.get(WB_DEP_GUID)?.locationKind).toBe("wb-addons");
    expect(byGuid.get(WORKSHOP_GUID)?.status).toBe("workshop-only");
    expect(byGuid.get(WORKSHOP_GUID)?.workshopDirPath).toBe(
      join(root, "workshop", `CoolMod_${WORKSHOP_GUID}`),
    );
    expect(byGuid.get(MISSING_GUID)?.status).toBe("missing");
    expect(check.allWbVisible).toBe(false);
  });

  it("resolves deps from folders next to a project outside the addons dir", () => {
    const check = checkWorkbenchVisibleDeps(
      join(root, "elsewhere", "ProjOutside", "addon.gproj"),
      paths,
    );
    const sibling = check.findings.find((f) => f.guid === SIBLING_GUID);
    expect(sibling?.status).toBe("wb-visible");
    expect(sibling?.locationKind).toBe("project-sibling");
    expect(check.allWbVisible).toBe(true);
  });

  it("tolerates missing scan roots and a missing workshop dir", () => {
    const check = checkWorkbenchVisibleDeps(join(root, "wbaddons", "MyProj", "addon.gproj"), {
      projectPath: join(root, "nope-addons"),
      corePath: join(root, "nope-core"),
      gamePath: join(root, "nope-game"),
    });
    // Only sibling scan (wbaddons is MyProj's parent-parent) resolves now.
    const byGuid = new Map(check.findings.map((f) => [f.guid, f]));
    expect(byGuid.get(WB_DEP_GUID)?.status).toBe("wb-visible");
    expect(byGuid.get(WB_DEP_GUID)?.locationKind).toBe("project-sibling");
    expect(byGuid.get(BASE_GAME_GUID)?.status).toBe("missing");
    expect(byGuid.get(WORKSHOP_GUID)?.status).toBe("missing");
    expect(check.workshopDir).toBeNull();
  });

  it("ignores a self-dependency", () => {
    const dir = join(root, "wbaddons", "SelfDep");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "addon.gproj"), gproj("SelfDep", "1234123412341234", ["1234123412341234"]));
    const check = checkWorkbenchVisibleDeps(join(dir, "addon.gproj"), paths);
    expect(check.findings).toHaveLength(0);
  });
});

describe("wb-deps: extractGprojDeps (moved from workshop-check-deps)", () => {
  it("extracts bare GUID deps", () => {
    expect(extractGprojDeps(gproj("X", PROJ_GUID, [BASE_GAME_GUID, WB_DEP_GUID]))).toEqual([
      BASE_GAME_GUID,
      WB_DEP_GUID,
    ]);
  });

  it("returns empty without a Dependencies block", () => {
    expect(extractGprojDeps(gproj("X", PROJ_GUID, []))).toEqual([]);
  });
});

describe("wb-deps: launcher-registered projects (.projectList conf)", () => {
  const REGISTERED_GUID = "AB12AB12AB12AB12";
  let profileDir: string;

  beforeAll(() => {
    // A project living at an arbitrary path (like a GitHub clone),
    // reachable only through the launcher's registered-projects list.
    const outsideDir = join(root, "somewhere-else", "RegisteredMod");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, "addon.gproj"), gproj("RegisteredMod", REGISTERED_GUID, []));

    profileDir = join(root, "profile");
    mkdirSync(profileDir, { recursive: true });
    const fwd = join(outsideDir, "addon.gproj").replace(/\\/g, "/");
    writeFileSync(
      join(profileDir, ".projectList_app1874910_user76561198000000000.conf"),
      `WBProjectList {\n Projects {\n  WBProjectListItem {\n   FilePath "${fwd}"\n  }\n  WBProjectListItem {\n   FilePath "C:/does/not/exist/addon.gproj"\n  }\n }\n}`,
    );
    // Noise the filename filter must ignore.
    writeFileSync(join(profileDir, "wbSettingsDump.ini"), "not a project list");

    const projDir = join(root, "wbaddons", "RegDepProj");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "addon.gproj"),
      gproj("RegDepProj", "7777777777777777", [REGISTERED_GUID]),
    );
  });

  it("reads FilePath entries from projectList confs only", () => {
    const paths = readRegisteredProjectPaths(profileDir);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain("RegisteredMod");
  });

  it("scanRegisteredProjects resolves GUIDs and skips dead entries", () => {
    const scanned = scanRegisteredProjects(profileDir);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].guid).toBe(REGISTERED_GUID);
  });

  it("returns empty for a missing profile dir", () => {
    expect(readRegisteredProjectPaths(join(root, "no-profile"))).toEqual([]);
    expect(scanRegisteredProjects(join(root, "no-profile"))).toEqual([]);
  });

  it("a dep reachable only via the registered list classifies as wb-visible", () => {
    const check = checkWorkbenchVisibleDeps(join(root, "wbaddons", "RegDepProj", "addon.gproj"), {
      ...paths,
      profileDir,
    });
    const dep = check.findings.find((f) => f.guid === REGISTERED_GUID);
    expect(dep?.status).toBe("wb-visible");
    expect(dep?.locationKind).toBe("launcher-registered");
    expect(check.allWbVisible).toBe(true);
    const text = formatDepFindings(check).join("\n");
    expect(text).toContain("launcher-registered project");
  });

  it("without the conf the same dep would be missing (the closed blind spot)", () => {
    const check = checkWorkbenchVisibleDeps(join(root, "wbaddons", "RegDepProj", "addon.gproj"), {
      ...paths,
      profileDir: join(root, "no-profile"),
    });
    expect(check.findings.find((f) => f.guid === REGISTERED_GUID)?.status).toBe("missing");
  });
});

describe("wb-deps: formatDepFindings", () => {
  it("names the copy remedy for workshop-only deps and flags missing ones", () => {
    const check = checkWorkbenchVisibleDeps(join(root, "wbaddons", "MyProj", "addon.gproj"), paths);
    const text = formatDepFindings(check).join("\n");
    expect(text).toContain(`{${WORKSHOP_GUID}}`);
    expect(text).toContain("NOT visible to Workbench");
    expect(text).toContain(join(root, "workshop", `CoolMod_${WORKSHOP_GUID}`));
    expect(text).toContain(`Copy each folder above into "${paths.projectPath}"`);
    expect(text).toContain(`{${MISSING_GUID}}`);
    expect(text).toContain("Missing everywhere");
    expect(text).toContain("always available");
  });

  it("reports a dependency-free project as such", () => {
    const dir = join(root, "wbaddons", "NoDeps");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "addon.gproj"), gproj("NoDeps", "9999999999999999", []));
    const check = checkWorkbenchVisibleDeps(join(dir, "addon.gproj"), paths);
    expect(formatDepFindings(check).join("\n")).toContain("no external dependencies");
  });
});
