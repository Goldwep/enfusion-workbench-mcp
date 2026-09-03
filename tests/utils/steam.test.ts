import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findGameAcrossSteamLibraries, steamRootOf } from "../../src/utils/steam.js";

describe("steamRootOf", () => {
  const root = resolve("C:\\Games\\SteamLibrary");
  const tools = join(root, "steamapps", "common", "Arma Reforger Tools");

  it("resolves the library root from the Tools install dir (3 levels)", () => {
    expect(steamRootOf(tools)).toBe(root);
  });

  it("resolves the same root from the Workbench subdirectory (4 levels)", () => {
    expect(steamRootOf(join(tools, "Workbench"))).toBe(root);
  });

  it("matches the steamapps segment case-insensitively", () => {
    const weird = join(root, "SteamApps", "common", "Arma Reforger Tools");
    expect(steamRootOf(weird).toLowerCase()).toBe(root.toLowerCase());
  });

  it("falls back to three levels up when no steamapps segment exists", () => {
    const custom = resolve("D:\\Custom\\Tools\\Arma Reforger Tools");
    expect(steamRootOf(custom)).toBe(resolve(custom, "..", "..", ".."));
  });
});

describe("findGameAcrossSteamLibraries", () => {
  let hintRoot: string;
  let otherLib: string;

  beforeEach(() => {
    hintRoot = mkdtempSync(join(tmpdir(), "emcp-steam-hint-"));
    otherLib = mkdtempSync(join(tmpdir(), "emcp-steam-lib-"));
    mkdirSync(join(hintRoot, "steamapps"), { recursive: true });
    mkdirSync(join(otherLib, "steamapps", "common", "Arma Reforger", "addons"), {
      recursive: true,
    });
    const escaped = otherLib.replace(/\\/g, "\\\\");
    const hintEscaped = hintRoot.replace(/\\/g, "\\\\");
    writeFileSync(
      join(hintRoot, "steamapps", "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${hintEscaped}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${escaped}"\n\t\t"label"\t\t""\n\t}\n}\n`,
    );
  });

  afterEach(() => {
    rmSync(hintRoot, { recursive: true, force: true });
    rmSync(otherLib, { recursive: true, force: true });
  });

  it("parses libraryfolders.vdf (unescaping \\\\) and finds the game in another library", () => {
    const found = findGameAcrossSteamLibraries("Arma Reforger", [hintRoot]);
    expect(found).toBe(join(otherLib, "steamapps", "common", "Arma Reforger"));
  });

  it("returns null when no library contains the game", () => {
    expect(findGameAcrossSteamLibraries("Not A Game", [hintRoot])).toBeNull();
  });

  it("returns null when the hint root has no libraryfolders.vdf and the default is absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "emcp-steam-empty-"));
    try {
      // The default C:\Program Files (x86)\Steam may exist on a dev box and
      // legitimately contain the game; only assert when it does not.
      const result = findGameAcrossSteamLibraries("Definitely Missing Game", [empty]);
      expect(result).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
