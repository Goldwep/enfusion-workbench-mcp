import { describe, it, expect } from "vitest";
import { artifactsDir, toPlaceholders } from "../../scripts/live/paths.js";

/** Synthetic paths; no real account or machine path appears in this test. */
const CTX = {
  userProfile: "C:\\Profiles\\p1",
  localAppData: "C:\\Profiles\\p1\\AppData\\Local",
  repo: "D:\\work\\emcp",
  v2: "D:\\work\\emcp-v2",
  tools: "D:\\Steam\\steamapps\\common\\Arma Reforger Tools",
  game: "D:\\Steam\\steamapps\\common\\Arma Reforger",
  sandbox: "C:\\Profiles\\p1\\Documents\\My Games\\ArmaReforgerWorkbench\\addons\\EMCP2_sandbox",
};

describe("toPlaceholders", () => {
  it("prefers the longest match", () => {
    expect(toPlaceholders(`${CTX.sandbox}\\EMCP2_sandbox.gproj`, CTX)).toBe(
      "<sandbox>\\EMCP2_sandbox.gproj",
    );
    expect(toPlaceholders(`${CTX.localAppData}\\enfusion-mcp\\artifacts`, CTX)).toBe(
      "%LOCALAPPDATA%\\enfusion-mcp\\artifacts",
    );
    expect(toPlaceholders(`${CTX.userProfile}\\.enfusion-mcp`, CTX)).toBe(
      "%USERPROFILE%\\.enfusion-mcp",
    );
  });

  it("matches both slash styles and the JSON-escaped form", () => {
    expect(toPlaceholders("D:/Steam/steamapps/common/Arma Reforger/addons", CTX)).toBe(
      "<game>/addons",
    );
    expect(toPlaceholders(JSON.stringify({ p: `${CTX.tools}\\Workbench` }), CTX)).toBe(
      '{"p":"<tools>\\\\Workbench"}',
    );
  });

  it("distinguishes the game from the Tools install that extends its name", () => {
    expect(toPlaceholders(`${CTX.tools}\\x and ${CTX.game}\\y`, CTX)).toBe(
      "<tools>\\x and <game>\\y",
    );
  });

  it("does not eat a longer sibling name", () => {
    expect(toPlaceholders("D:\\work\\emcp-v2\\src and D:\\work\\emcp2", CTX)).toBe(
      "<v2>\\src and D:\\work\\emcp2",
    );
  });

  it("ignores case", () => {
    expect(toPlaceholders("c:\\profiles\\P1\\file.txt", CTX)).toBe("%USERPROFILE%\\file.txt");
  });
});

describe("artifactsDir", () => {
  it("uses the override variable first", () => {
    expect(artifactsDir({ ENFUSION_ARTIFACTS_DIR: "/x/y" }, "win32", "/h")).toBe("/x/y");
  });

  it("uses LOCALAPPDATA on win32", () => {
    expect(artifactsDir({ LOCALAPPDATA: "C:\\L" }, "win32", "C:\\H")).toBe(
      "C:\\L\\enfusion-mcp\\artifacts",
    );
  });

  it("uses ~/.local/share elsewhere", () => {
    expect(artifactsDir({}, "linux", "/home/h")).toBe(
      "/home/h/.local/share/enfusion-mcp/artifacts",
    );
  });
});
