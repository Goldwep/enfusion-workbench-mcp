import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { registerWbBuildData } from "../../src/tools/wb-build-data.js";
import { registerWbCliRun } from "../../src/tools/wb-cli-run.js";
import { registerWbExecuteAction } from "../../src/tools/wb-execute-action.js";
import { registerWbLayers } from "../../src/tools/wb-layers.js";
import { registerWbValidateScripts } from "../../src/tools/wb-validate-scripts.js";

// Registration only stores the metadata, so empty fakes are enough here.
const descriptions = new Map<string, string>();
const server = {
  registerTool(name: string, def: { description?: string }) {
    descriptions.set(name, def.description ?? "");
  },
} as unknown as McpServer;
const config = {} as unknown as Config;
const client = {} as unknown as WorkbenchClient;

registerWbBuildData(server, config);
registerWbCliRun(server, config);
registerWbValidateScripts(server, config);
registerWbLayers(server, client);
registerWbExecuteAction(server, client);

describe("tool descriptions that must not mislead", () => {
  // The phantom project switch is gone (DEC-048 package B): the headless tools name the
  // project with -gproj, so the wrong-project caveat is retired and descriptions must not
  // teach the old switch.
  it.each(["wb_validate_scripts", "wb_cli_run", "wb_build_data"])(
    "%s no longer teaches the phantom project switch and states Read: or Mutating:",
    (name) => {
      const d = descriptions.get(name) ?? "";
      expect(d).not.toContain("-wbProjectPath");
      expect(d).not.toContain("wrong project");
      expect(d.length).toBeLessThanOrEqual(400);
      expect(d).toMatch(/Read:|Mutating:/);
    },
  );

  it("wb_layers description comes from the contract and names the layer actions", () => {
    const d = descriptions.get("wb_layers") ?? "";
    expect(d.length).toBeLessThanOrEqual(400);
    expect(d).toMatch(/Read:/);
    expect(d).toMatch(/Mutating:/);
    for (const a of ["tree", "create", "rename", "delete", "move", "setActive", "lock"]) {
      expect(d, a).toContain(a);
    }
    // The old caveat (create/delete/rename/setActive "not implemented") is gone.
    expect(d).not.toContain("not implemented by this tool yet");
  });

  it("wb_execute_action no longer teaches File,Save", () => {
    const d = descriptions.get("wb_execute_action") ?? "";
    expect(d).not.toContain("File,Save");
    expect(d).not.toContain("Reload Scripts");
    expect(d).toContain("verified source");
  });
});
