import { describe, expect, it } from "vitest";
import { scriptCompileFailure } from "../../src/workbench/launch-reports.js";

// Lines taken from a Workbench 1.9.0.42 console.log (launch of 2026-11-26, a dependency's script broke).
const FAILED = [
  '22:56:58.878    SCRIPT       : SCRIPT       : Compiling Game scripts',
  '22:57:00.426    SCRIPT    (E): @"Scripts/Game/Core/PT29_ServerKey.c,62": Broken expression (missing \';\'?)',
  '22:57:00.453    SCRIPT    (E): Can\'t compile "Game" script module!',
  "Scripts/Game/Core/PT29_ServerKey.c(62): Broken expression (missing ';'?)",
  "22:57:00.526   ENGINE    (E): Unable to initialize a game/gamelib. Some workbench features will not work.",
  "22:57:03.376 NETWORK   (E): Failed to call not existing Net API function 'EMCP_WB_Ping'",
].join("\r\n");

describe("scriptCompileFailure", () => {
  it("returns the script errors when a module failed to compile", () => {
    expect(scriptCompileFailure(FAILED)).toEqual([
      '@"Scripts/Game/Core/PT29_ServerKey.c,62": Broken expression (missing \';\'?)',
      'Can\'t compile "Game" script module!',
    ]);
  });

  it("returns null while scripts are still compiling or compiled clean", () => {
    expect(scriptCompileFailure("")).toBeNull();
    expect(
      scriptCompileFailure(
        "22:56:58.878    SCRIPT       : SCRIPT       : Compiling Game scripts\n" +
          "22:57:03.376 NETWORK   (E): Failed to call not existing Net API function 'EMCP_WB_Ping'",
      ),
    ).toBeNull();
  });
});
