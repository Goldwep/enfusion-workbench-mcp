import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import type { RunResult } from "../../src/workbench/cli-runner.js";

vi.mock("../../src/workbench/cli-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/workbench/cli-runner.js")>();
  // Neutralise the running-Workbench guard so the unit tests don't depend on
  // whether a real Workbench happens to be open on the dev box.
  return { ...actual, runWorkbench: vi.fn(), headlessSpawnBlocker: () => null };
});
vi.mock("../../src/workbench/wb-deps.js", () => ({
  checkWorkbenchVisibleDeps: () => ({
    gprojPath: "",
    wbAddonsDir: "",
    workshopDir: null,
    findings: [],
    allWbVisible: true,
    scannedRoots: [],
  }),
}));

import { runWorkbench } from "../../src/workbench/cli-runner.js";
import {
  DEFAULT_CLI_TIMEOUT_S,
  GATED_PLUGINS,
  NAVMESH_BAKE_TIMEOUT_S,
  assertNoForceSettings,
  checkBakeSaveDir,
  checkPluginPaths,
  isWithin,
  readProjectId,
  navmeshGeneratorPresence,
  PREPARE_ONLY_VERBS,
  RUN_VERBS,
  WB_CLI_RUN_DESCRIPTION,
  loadCliPolicy,
  planFor,
  pluginModuleArg,
  prepareFor,
  registerWbCliRun,
  validateResourceTarget,
  CONFIRM_PLUGINS,
  TERRAIN_VARIANT_PLUGIN,
  W7_PLUGIN_GATES,
  isThrowawayWorld,
  pluginGate,
  type CliPolicy,
} from "../../src/tools/wb-cli-run.js";

const mockedRun = vi.mocked(runWorkbench);

function baseResult(over: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 2500,
    timedOut: false,
    earlySignal: null,
    ...over,
  };
}

const root = mkdtempSync(join(tmpdir(), "wb-cli-run-test-"));
const gproj = join(root, "addon.gproj");
writeFileSync(gproj, 'GameProject {\n ID "MyMod"\n GUID "0123456789ABCDEF"\n}\n');
const artifacts = join(root, "artifacts");
mkdirSync(join(artifacts, "out"), { recursive: true });
mkdirSync(join(root, "worlds"), { recursive: true });
writeFileSync(join(root, "worlds", "w.ent"), "");
mkdirSync(join(root, "_throwaway", "W7"), { recursive: true });
writeFileSync(join(root, "_throwaway", "W7", "t.ent"), "");
mkdirSync(join(root, "logs"), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const config = {
  workbenchPath: root,
  projectPath: root,
  gamePath: root,
  dataDir: root,
  patternsDir: root,
  workbenchHost: "127.0.0.1",
  workbenchPort: 5775,
  projectIndexPath: join(root, "idx.db"),
  corePath: root,
  logsPath: join(root, "logs"),
} as unknown as Config;

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

/** The plugin_args the integrator is expected to list for the W6 candidates (spec 2.5). */
const W6_ARGS: Record<string, string[]> = {
  SCR_PrefabValidatorPlugin: ["validatePaths"],
  SearchXOBPlugin: [],
  ResourceTestPlugin: ["resources", "autotest-output-dir"],
  WorldTestPlugin: ["world", "wait"],
  WorldDataExport: ["world", "type", "saveDir", "excludehills"],
  ResourceProcessorPlugin: ["FileTypes", "PathContains", "PathEndsWith", "PathStartsWith"],
  ResavePlugin: ["addonPath", "extension"],
  ResaveMetaPlugin: ["addonPath", "extension"],
};

function policyOf(entries: string[]): CliPolicy {
  return {
    verbs: new Set(entries.filter((e) => e.startsWith("verb:")).map((e) => e.slice(5))),
    plugins: new Set(entries.filter((e) => e.startsWith("plugin:")).map((e) => e.slice(7))),
    pluginArgs: new Map<string, ReadonlySet<string>>([
      ["AddonBuildInfoTool", new Set(["addonPath", "ciInfoDst"])],
      ...Object.entries(W6_ARGS).map(([k, v]) => [k, new Set(v)] as [string, Set<string>]),
    ]),
    source: "policy.json:cli_run.allow_list",
  };
}

const ALL_VERBS = RUN_VERBS.map((v) => `verb:${v}`);

function captureTool(policy: CliPolicy = policyOf([...ALL_VERBS, "plugin:AddonBuildInfoTool"])): {
  schema: z.ZodObject<z.ZodRawShape>;
  call: Handler;
} {
  let captured: { def: { inputSchema: z.ZodRawShape }; handler: Handler } | null = null;
  const server = {
    registerTool: (_name: string, def: { inputSchema: z.ZodRawShape }, handler: Handler) => {
      captured = { def, handler };
    },
  } as unknown as McpServer;
  registerWbCliRun(server, config, { policy: () => policy, artifactsDir: () => artifacts });
  if (!captured) throw new Error("tool not registered");
  const { def, handler } = captured as { def: { inputSchema: z.ZodRawShape }; handler: Handler };
  const schema = z.object(def.inputSchema);
  return { schema, call: (args) => handler(schema.parse(args)) };
}

beforeEach(() => {
  mockedRun.mockReset();
});

function bodyOf(res: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

describe("wb_cli_run: target validation (L3)", () => {
  it("rejects flag-shaped, NUL, quoted, empty and dot-dot targets", () => {
    expect(validateResourceTarget("-wbModule=x")).toMatch(/'-'/);
    expect(validateResourceTarget("a\0b")).toMatch(/NULL/);
    expect(validateResourceTarget('a"b')).toMatch(/double quotes/);
    expect(validateResourceTarget("")).toMatch(/empty/);
    expect(validateResourceTarget("../secret/world.ent")).toMatch(/\.\./);
  });

  it("accepts engine-relative resource paths and absolute paths", () => {
    expect(validateResourceTarget("worlds/MyWorld/MyWorld.ent")).toBeNull();
    expect(validateResourceTarget("worlds/x..y.ent")).toBeNull();
  });
});

describe("wb_cli_run: argv", () => {
  it("every verb leads with -gproj, the path as its own entry, then -scriptAuthorizeAll (owner ruling 2026-11-06)", () => {
    for (const verb of RUN_VERBS) {
      const args = planFor(verb, { gproj, target: "worlds/w.ent", saveDir: artifacts });
      expect(args.slice(0, 3), verb).toEqual(["-gproj", gproj, "-scriptAuthorizeAll"]);
    }
  });

  it("never carries the phantom project switch, -config=, -noPause or -clearSettings, and always carries -scriptAuthorizeAll", () => {
    const bads = ["wbprojectpath", "-config", "nopause", "clearsettings"];
    for (const verb of RUN_VERBS) {
      const joined = planFor(verb, { gproj, target: "worlds/w.ent", saveDir: artifacts })
        .join(" ")
        .toLowerCase();
      for (const bad of bads) expect(joined, `${verb} ${bad}`).not.toContain(bad);
      expect(joined, `${verb} scriptauthorizeall`).toContain("-scriptauthorizeall");
    }
  });

  it("buildScripts is -wbModule=ScriptEditor -validate=<CFG>; openProject exits after init", () => {
    // Without the module switch 1.9.0.37 never validates and idles to the timeout (2026-11-14).
    expect(planFor("buildScripts", { gproj, configuration: "PC" })).toEqual([
      "-gproj",
      gproj,
      "-scriptAuthorizeAll",
      "-wbModule=ScriptEditor",
      "-validate=PC",
    ]);
    expect(planFor("openProject", { gproj })).toContain("-exitAfterInit");
  });

  it("navmeshGenerate and forceSaveAll keep the resource target as its own entry", () => {
    expect(planFor("navmeshGenerate", { gproj, target: "worlds/MyWorld.ent" })).toEqual([
      "-gproj",
      gproj,
      "-scriptAuthorizeAll",
      "-wbModule=NavmeshGeneratorMain",
      "-run",
      "-autogenerate",
      "worlds/MyWorld.ent",
    ]);
    expect(planFor("forceSaveAll", { gproj, target: "w.ent" })).toContain("-forceSaveAll");
  });

  it("a plugin verb passes -wbModule=ResourceManager, -plugin=<name> and each argument as one token", () => {
    expect(
      planFor("plugin", {
        gproj,
        plugin: { name: "AddonBuildInfoTool", args: { addonPath: "x" } },
      }),
    ).toEqual([
      "-gproj",
      gproj,
      "-scriptAuthorizeAll",
      "-wbModule=ResourceManager",
      "-plugin=AddonBuildInfoTool",
      "-addonPath=x",
    ]);
  });

  it("every plugin run names exactly one module, right before -plugin=", () => {
    for (const name of ["AddonBuildInfoTool", ...GATED_PLUGINS, TERRAIN_VARIANT_PLUGIN]) {
      const argv = planFor("plugin", { gproj, plugin: { name } });
      expect(argv.filter((a) => a.startsWith("-wbModule=")), name).toHaveLength(1);
      expect(argv.indexOf(pluginModuleArg(name)), name).toBe(argv.indexOf(`-plugin=${name}`) - 1);
    }
    expect(pluginModuleArg(TERRAIN_VARIANT_PLUGIN)).toBe("-wbModule=WorldEditor");
  });

  it("prepareFor shows the pack and publish command lines without any refused switch", () => {
    for (const v of PREPARE_ONLY_VERBS) {
      const argv = prepareFor(v, gproj);
      expect(argv.slice(0, 3)).toEqual(["-gproj", gproj, "-scriptAuthorizeAll"]);
      expect(argv.join(" ").toLowerCase()).not.toMatch(/clearsettings|wbprojectpath/);
    }
  });
});

describe("wb_cli_run: the allow-list (policy.json cli_run.allow_list)", () => {
  it("loadCliPolicy reads verbs and plugins; a missing key is an empty list", () => {
    const file = join(root, "policy-a.json");
    writeFileSync(
      file,
      JSON.stringify({ cli_run: { allow_list: ["verb:buildScripts", "plugin:Tool", 7] } }),
    );
    const p = loadCliPolicy(file);
    expect([...p.verbs]).toEqual(["buildScripts"]);
    expect([...p.plugins]).toEqual(["Tool"]);
    const none = join(root, "policy-b.json");
    writeFileSync(none, JSON.stringify({ execute_action: {} }));
    const empty = loadCliPolicy(none);
    expect(empty.verbs.size + empty.plugins.size).toBe(0);
    expect(empty.source).toBe("policy key absent");
    expect(loadCliPolicy(join(root, "absent.json")).source).toBe("policy file unreadable");
  });

  it("with an empty list every verb is refused NOT_ALLOWLISTED and nothing is spawned", async () => {
    const { call } = captureTool(policyOf([]));
    for (const verb of [...RUN_VERBS, "plugin"]) {
      const res = await call({
        verb,
        gproj,
        target: "worlds/w.ent",
        plugin: { name: "AddonBuildInfoTool" },
      });
      expect(res.isError, verb).toBe(true);
      expect(bodyOf(res).code, verb).toBe(verb === "navmeshBake" ? "GATED" : "NOT_ALLOWLISTED");
    }
    // A string outside the verb enum never reaches the handler (DEC-056 ruling 12).
    for (const verb of ["rm -rf", "launchAnything"]) {
      let refused = false;
      try {
        await call({ verb, gproj, target: "worlds/w.ent", plugin: { name: "AddonBuildInfoTool" } });
      } catch {
        refused = true;
      }
      expect(refused, verb).toBe(true);
    }
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("a verb the list does not hold is refused while a listed one runs", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool(policyOf(["verb:openProject"]));
    expect(bodyOf(await call({ verb: "navmeshGenerate", gproj, target: "w.ent" })).code).toBe(
      "NOT_ALLOWLISTED",
    );
    const ok = await call({ verb: "openProject", gproj });
    expect(ok.isError).toBeUndefined();
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("a plugin not on the list is refused", async () => {
    const { call } = captureTool(policyOf(["plugin:AddonBuildInfoTool"]));
    const res = await call({ verb: "plugin", gproj, plugin: { name: "Other" } });
    expect(bodyOf(res).code).toBe("NOT_ALLOWLISTED");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("publish and pack verbs are prepared and never executed, even with every entry listed", async () => {
    const { call } = captureTool(policyOf([...ALL_VERBS, "verb:publishAddon", "verb:packAddon"]));
    for (const verb of PREPARE_ONLY_VERBS) {
      const res = await call({ verb, gproj });
      const body = bodyOf(res);
      expect(res.isError).toBeUndefined();
      expect(body.readback).toMatchObject({ prepared: true, executed: false });
    }
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("wb_cli_run: handler", () => {
  it("navmeshGenerate accepts an engine-relative path that does not exist on disk", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool();
    const res = await call({
      verb: "navmeshGenerate",
      gproj,
      target: "worlds/MyWorld/MyWorld.ent",
    });
    expect(res.isError).toBeUndefined();
    const opts = mockedRun.mock.calls[0][0];
    expect(opts.args).toContain("worlds/MyWorld/MyWorld.ent");
    expect(opts.args.slice(0, 2)).toEqual(["-gproj", gproj]);
  });

  it("forceSaveAll with an absolute path still requires it on disk", async () => {
    const { call } = captureTool();
    const res = await call({ verb: "forceSaveAll", gproj, target: join(root, "missing.ent") });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).code).toBe("PATH_NOT_FOUND");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("the .gproj must exist and end in .gproj", async () => {
    const { call } = captureTool();
    expect(bodyOf(await call({ verb: "openProject", gproj: join(root, "nope.gproj") })).code).toBe(
      "PATH_NOT_FOUND",
    );
    expect(bodyOf(await call({ verb: "openProject", gproj: join(root, "logs") })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("rejects '..' and flag-shaped targets before spawning", async () => {
    const { call } = captureTool();
    expect((await call({ verb: "navmeshGenerate", gproj, target: "../x.ent" })).isError).toBe(true);
    expect((await call({ verb: "openProject", gproj: "-wbModule=x" })).isError).toBe(true);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("buildScripts verdict 'failed' is isError (H10)", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ earlySignal: "failed", exitCode: null, signal: "SIGKILL" }),
    );
    const { call } = captureTool();
    const res = await call({ verb: "buildScripts", gproj });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).code).toBe("RUN_FAILED");
  });

  it("buildScripts verdict 'successful' is not an error despite the kill", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ earlySignal: "successful", exitCode: null, signal: "SIGKILL" }),
    );
    const { call } = captureTool();
    const res = await call({ verb: "buildScripts", gproj });
    expect(res.isError).toBeUndefined();
    expect(bodyOf(res).readback).toMatchObject({ verdict: "successful" });
  });

  it("timeout is isError and says the tree was killed (H11)", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ timedOut: true, exitCode: null, signal: "SIGKILL", durationMs: 100_000 }),
    );
    const { call } = captureTool();
    const res = await call({ verb: "openProject", gproj });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).message).toContain("process tree killed");
  });

  it("non-zero exit is isError with the stderr tail", async () => {
    mockedRun.mockResolvedValue(baseResult({ exitCode: 5, stderr: "navmesh: OOM\n" }));
    const { call } = captureTool();
    const res = await call({ verb: "navmeshGenerate", gproj, target: "worlds/w.ent" });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).message).toContain("exit code 5");
    expect(JSON.stringify(bodyOf(res).readback)).toContain("navmesh: OOM");
  });

  it("navmeshGenerate refuses, and launches nothing, when the install's CLI page has no navmesh generator", async () => {
    const html = join(root, "Workbench", "docs", "EnfusionScriptAPI", "html");
    mkdirSync(html, { recursive: true });
    const page = join(html, "Page_CLI.html");
    try {
      writeFileSync(page, "<h2>WorldEditor</h2>");
      expect(navmeshGeneratorPresence(root)).toBe("absent");
      mockedRun.mockClear();
      const { call } = captureTool();
      const res = await call({ verb: "navmeshGenerate", gproj, target: "worlds/w.ent" });
      expect(res.isError).toBe(true);
      expect(bodyOf(res).code).toBe("MODULE_NOT_SUPPORTED");
      expect(bodyOf(res).message).toContain("not available on this Workbench");
      expect(mockedRun).not.toHaveBeenCalled();

      writeFileSync(page, "<h2>NavmeshGeneratorMain</h2> -autogenerate");
      expect(navmeshGeneratorPresence(root)).toBe("present");
    } finally {
      rmSync(join(root, "Workbench"), { recursive: true, force: true });
    }
    expect(navmeshGeneratorPresence(root)).toBe("unknown");
  });

  it("default timeout fits an MCP client window and is overridable", async () => {
    expect(DEFAULT_CLI_TIMEOUT_S).toBeLessThanOrEqual(110);
    mockedRun.mockResolvedValue(baseResult());
    const { schema, call } = captureTool();
    expect(schema.parse({ verb: "openProject", gproj: "x" }).timeout_seconds).toBe(
      DEFAULT_CLI_TIMEOUT_S,
    );
    await call({ verb: "navmeshGenerate", gproj, target: "worlds/w.ent", timeout_seconds: 900 });
    expect(mockedRun.mock.calls[0][0].timeoutMs).toBe(900_000);
  });

  it("the description is at most 400 characters and carries a Mutating: line", () => {
    expect(WB_CLI_RUN_DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(WB_CLI_RUN_DESCRIPTION).toContain("Mutating:");
  });
});

describe("wb_cli_run: plugin argument keys (review B-1)", () => {
  it("an allowed key passes; any other key is INVALID_ARGUMENT and nothing is spawned", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool();
    const plugin = (args: Record<string, string>) => ({ name: "AddonBuildInfoTool", args });
    expect(
      (
        await call({
          verb: "plugin",
          gproj,
          plugin: plugin({ addonPath: root, ciInfoDst: join(artifacts, "ci.json") }),
        })
      ).isError,
    ).toBeUndefined();
    mockedRun.mockClear();
    for (const key of ["publishAddon", "packAddon", "gproj", "wbModule", "validate", "other"]) {
      const res = await call({ verb: "plugin", gproj, plugin: plugin({ [key]: "1" }) });
      expect(bodyOf(res).code, key).toBe("INVALID_ARGUMENT");
    }
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("a value with white space is refused: the engine would read the rest as switches", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool();
    mockedRun.mockClear();
    for (const value of ["x -clearSettings", "a\tb", "a\nb"]) {
      const res = await call({
        verb: "plugin",
        gproj,
        plugin: { name: "AddonBuildInfoTool", args: { addonPath: value } },
      });
      expect(bodyOf(res).code, JSON.stringify(value)).toBe("INVALID_ARGUMENT");
    }
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("a policy that lists a switch name as a plugin key is still refused", async () => {
    const policy = policyOf(["plugin:P"]);
    (policy.pluginArgs as Map<string, Set<string>>).set("P", new Set(["publishAddon"]));
    const { call } = captureTool(policy);
    const res = await call({
      verb: "plugin",
      gproj,
      plugin: { name: "P", args: { publishAddon: "1" } },
    });
    expect(bodyOf(res).code).toBe("INVALID_ARGUMENT");
  });

  it("loadCliPolicy reads plugin_args", () => {
    const file = join(root, "policy-c.json");
    writeFileSync(file, JSON.stringify({ cli_run: { allow_list: [], plugin_args: { T: ["a"] } } }));
    expect([...(loadCliPolicy(file).pluginArgs.get("T") ?? [])]).toEqual(["a"]);
  });
});

describe("wb_cli_run: review B-2 and B-3", () => {
  it("a passing buildScripts carries the U14 warning", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ earlySignal: "successful", exitCode: null, signal: "SIGKILL" }),
    );
    const { call } = captureTool();
    const body = bodyOf(await call({ verb: "buildScripts", gproj }));
    expect(JSON.stringify(body.warnings)).toMatch(/not a handler compile gate/);
  });

  it("prepare-only verbs answer prepared even with an empty list (they bypass it by design)", async () => {
    const { call } = captureTool(policyOf([]));
    for (const verb of PREPARE_ONLY_VERBS) {
      const res = await call({ verb, gproj });
      expect(res.isError).toBeUndefined();
      expect(bodyOf(res).readback).toMatchObject({ prepared: true, executed: false });
    }
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

// ── W5: navmeshBake (DEC-068 OD-2) ─────────────────────────────────────────────

describe("wb_cli_run: navmeshBake (W5 OD-2, probe-only)", () => {
  const bake = {
    verb: "navmeshBake",
    gproj,
    target: "worlds/w.ent",
    save_dir: join(artifacts, "out"),
  };

  it("answers GATED naming P-W5-01 and its policy entry while verb:navmeshBake is not listed", async () => {
    const { call } = captureTool(policyOf(["verb:openProject", "plugin:AddonBuildInfoTool"]));
    const res = await call(bake);
    const body = bodyOf(res);
    expect(res.isError).toBe(true);
    expect(body.code).toBe("GATED");
    expect(body.message).toContain("P-W5-01");
    expect(body.message).toContain("verb:navmeshBake");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("with the entry listed: -wbModule=WorldEditor -autogenerate <world> -saveDir <dir>, under the fixed 600 s watchdog", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool();
    const res = await call({ ...bake, timeout_seconds: 30 });
    expect(res.isError).toBeUndefined();
    const opts = mockedRun.mock.calls[0][0];
    expect(opts.args).toEqual([
      "-gproj",
      gproj,
      "-scriptAuthorizeAll",
      "-wbModule=WorldEditor",
      "-autogenerate",
      "worlds/w.ent",
      "-saveDir",
      resolve(artifacts, "out"),
    ]);
    expect(NAVMESH_BAKE_TIMEOUT_S).toBe(600);
    expect(opts.timeoutMs).toBe(600_000);
    expect(opts.args.join(" ").toLowerCase()).not.toContain("forcesettings");
  });

  it("a bake that runs into the watchdog is RUN_FAILED with the kill named", async () => {
    mockedRun.mockResolvedValue(
      baseResult({ timedOut: true, exitCode: null, signal: "SIGKILL", durationMs: 600_000 }),
    );
    const { call } = captureTool();
    const body = bodyOf(await call(bake));
    expect(body.code).toBe("RUN_FAILED");
    expect(body.message).toContain("process tree killed");
  });

  it("is not stopped by the missing NavmeshGeneratorMain page, while navmeshGenerate still refuses MODULE_NOT_SUPPORTED", async () => {
    const html = join(root, "Workbench", "docs", "EnfusionScriptAPI", "html");
    mkdirSync(html, { recursive: true });
    try {
      writeFileSync(join(html, "Page_CLI.html"), "<h2>WorldEditor</h2>");
      mockedRun.mockResolvedValue(baseResult());
      const { call } = captureTool();
      const gen = await call({ verb: "navmeshGenerate", gproj, target: "worlds/w.ent" });
      expect(bodyOf(gen).code).toBe("MODULE_NOT_SUPPORTED");
      expect(mockedRun).not.toHaveBeenCalled();
      expect((await call(bake)).isError).toBeUndefined();
      expect(mockedRun).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(join(root, "Workbench"), { recursive: true, force: true });
    }
  });

  it("save_dir is required, absolute and inside the project or under the artifacts folder", async () => {
    const { call } = captureTool();
    const codeOf = async (save_dir?: string) =>
      bodyOf(await call({ ...bake, save_dir })).code as string;
    expect(await codeOf(undefined)).toBe("INVALID_ARGUMENT");
    expect(await codeOf("out/navmesh")).toBe("INVALID_ARGUMENT");
    // A raw '..' segment is refused (join() would normalise it away).
    expect(await codeOf(`${artifacts}/../elsewhere`)).toBe("INVALID_ARGUMENT");
    expect(await codeOf(join(tmpdir(), "not-the-project-or-artifacts"))).toBe("NOT_IN_PROJECT");
    expect(await codeOf("-forceSettings")).toBe("INVALID_ARGUMENT");
    expect(mockedRun).not.toHaveBeenCalled();
    mockedRun.mockResolvedValue(baseResult());
    expect(await call({ ...bake, save_dir: join(root, "navmesh") }).then((r) => r.isError)).toBe(
      undefined,
    );
  });

  it("checkBakeSaveDir is pure over its context", () => {
    const ctx = { projectDir: root, projectId: "MyMod", artifactsDir: artifacts };
    expect(checkBakeSaveDir(join(artifacts, "x"), ctx)).toBeNull();
    expect(checkBakeSaveDir(join(root, "x"), ctx)).toBeNull();
    expect(checkBakeSaveDir("a b", ctx)?.code).toBe("INVALID_ARGUMENT");
  });
});

// ── W6: CLI plugin candidates and their path rules (spec 2.5, DEC-069 OD-13) ───

describe("wb_cli_run: W6 plugin candidates are GATED until listed (P-W6-08)", () => {
  it("every candidate answers GATED naming P-W6-08 and its plugin entry; nothing is spawned", async () => {
    const { call } = captureTool(policyOf(["plugin:AddonBuildInfoTool"]));
    expect(GATED_PLUGINS).toHaveLength(8);
    expect(GATED_PLUGINS).not.toContain("AddonBuildInfoTool");
    for (const name of GATED_PLUGINS) {
      const body = bodyOf(await call({ verb: "plugin", gproj, plugin: { name } }));
      expect(body.code, name).toBe("GATED");
      expect(body.message, name).toContain("P-W6-08");
      expect(body.message, name).toContain(`plugin:${name}`);
    }
    // A plugin that is no candidate keeps NOT_ALLOWLISTED.
    expect(
      bodyOf(await call({ verb: "plugin", gproj, plugin: { name: "BuildShoreMap" } })).code,
    ).toBe("NOT_ALLOWLISTED");
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe("wb_cli_run: W6 per-plugin path rules", () => {
  const listed = () => captureTool(policyOf(GATED_PLUGINS.map((n) => `plugin:${n}`)));
  const run = async (name: string, args: Record<string, string>, extra = {}) => {
    const { call } = listed();
    return call({ verb: "plugin", gproj, plugin: { name, args }, ...extra });
  };
  const codeOf = async (name: string, args: Record<string, string>) =>
    bodyOf(await run(name, args)).code as string | undefined;

  beforeEach(() => mockedRun.mockResolvedValue(baseResult()));

  it("SCR_PrefabValidatorPlugin: every validatePaths entry is a $<project ID>: path", async () => {
    expect(
      (await run("SCR_PrefabValidatorPlugin", { validatePaths: "$MyMod:Prefabs,$mymod:AI" }))
        .isError,
    ).toBeUndefined();
    expect(mockedRun.mock.calls[0][0].args).toContain("-validatePaths=$MyMod:Prefabs,$mymod:AI");
    expect(await codeOf("SCR_PrefabValidatorPlugin", { validatePaths: "$ArmaReforger:AI" })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(
      await codeOf("SCR_PrefabValidatorPlugin", {
        validatePaths: "$MyMod:Prefabs,$ArmaReforger:AI",
      }),
    ).toBe("NOT_IN_PROJECT");
    expect(await codeOf("SCR_PrefabValidatorPlugin", { validatePaths: "$MyMod:../x" })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOf("SCR_PrefabValidatorPlugin", { validatePaths: "Prefabs" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(await codeOf("SCR_PrefabValidatorPlugin", { validatePaths: "$MyMod:A,," })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(await codeOf("SCR_PrefabValidatorPlugin", {})).toBe("INVALID_ARGUMENT");
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("ResourceTestPlugin: -autotest-output-dir is required and under the artifacts folder; the hyphenated key reaches the argv", async () => {
    const out = join(artifacts, "out");
    expect(
      (
        await run("ResourceTestPlugin", {
          resources: "{0123456789ABCDEF}",
          "autotest-output-dir": out,
        })
      ).isError,
    ).toBeUndefined();
    expect(mockedRun.mock.calls[0][0].args).toContain(`-autotest-output-dir=${out}`);
    expect(await codeOf("ResourceTestPlugin", { resources: "{0123456789ABCDEF}" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(await codeOf("ResourceTestPlugin", { "autotest-output-dir": join(root, "logs") })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      await codeOf("ResourceTestPlugin", { "autotest-output-dir": "$logs:ResourceTestTool" }),
    ).toBe("INVALID_ARGUMENT");
  });

  it("WorldTestPlugin: the world is inside the project", async () => {
    for (const world of [
      "worlds/w.ent",
      "{0123456789ABCDEF}worlds/w.ent",
      "$MyMod:worlds/w.ent",
      join(root, "worlds", "w.ent"),
    ]) {
      expect(await codeOf("WorldTestPlugin", { world, wait: "5" }), world).toBeUndefined();
    }
    expect(await codeOf("WorldTestPlugin", { world: "worlds/absent.ent" })).toBe("NOT_IN_PROJECT");
    expect(await codeOf("WorldTestPlugin", { world: "$ArmaReforger:worlds/Eden.ent" })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOf("WorldTestPlugin", { world: join(tmpdir(), "x.ent") })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOf("WorldTestPlugin", { wait: "5" })).toBe("INVALID_ARGUMENT");
  });

  it("WorldDataExport: saveDir is required and under the artifacts folder", async () => {
    expect(
      await codeOf("WorldDataExport", { world: "worlds/w.ent", saveDir: join(artifacts, "out") }),
    ).toBeUndefined();
    expect(await codeOf("WorldDataExport", { world: "worlds/w.ent" })).toBe("INVALID_ARGUMENT");
    expect(await codeOf("WorldDataExport", { world: "worlds/w.ent", saveDir: root })).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("ResourceProcessorPlugin: PathStartsWith is required and a $<project ID>: path", async () => {
    expect(
      await codeOf("ResourceProcessorPlugin", {
        FileTypes: "xob",
        PathStartsWith: "$MyMod:Assets",
      }),
    ).toBeUndefined();
    expect(await codeOf("ResourceProcessorPlugin", { FileTypes: "xob" })).toBe("INVALID_ARGUMENT");
    expect(
      await codeOf("ResourceProcessorPlugin", { PathStartsWith: "$ArmaReforger:Assets" }),
    ).toBe("NOT_IN_PROJECT");
  });

  it("ResavePlugin and ResaveMetaPlugin: addonPath is the project itself, an extension is named, and only confirm:true runs", async () => {
    for (const name of ["ResavePlugin", "ResaveMetaPlugin"]) {
      mockedRun.mockClear();
      const args = { addonPath: root, extension: "et" };
      const dry = await run(name, args);
      const dryBody = bodyOf(dry);
      expect(dry.isError, name).toBeUndefined();
      expect(dryBody.readback, name).toMatchObject({ dryRun: true, executed: false });
      expect(JSON.stringify(dryBody.readback), name).toContain(`-plugin=${name}`);
      expect(mockedRun, name).not.toHaveBeenCalled();

      const ran = await run(name, args, { confirm: true });
      expect(ran.isError, name).toBeUndefined();
      expect(mockedRun, name).toHaveBeenCalledTimes(1);
      expect(mockedRun.mock.calls[0][0].args, name).toContain(`-addonPath=${root}`);

      expect(await codeOf(name, { addonPath: join(root, "worlds"), extension: "et" }), name).toBe(
        "NOT_IN_PROJECT",
      );
      expect(await codeOf(name, { addonPath: "MyMod", extension: "et" }), name).toBe(
        "NOT_IN_PROJECT",
      );
      expect(await codeOf(name, { addonPath: root }), name).toBe("INVALID_ARGUMENT");
      expect(await codeOf(name, { addonPath: root, extension: "et,conf" }), name).toBe(
        "INVALID_ARGUMENT",
      );
    }
  });

  it("refusals come before the confirm dry run: a bad Resave path is refused, not prepared", async () => {
    const body = bodyOf(await run("ResavePlugin", { addonPath: tmpdir(), extension: "et" }));
    expect(body.code).toBe("NOT_IN_PROJECT");
  });

  it("SearchXOBPlugin has no path rule", async () => {
    expect(await codeOf("SearchXOBPlugin", {})).toBeUndefined();
  });

  it("live-client-03: AddonBuildInfoTool reads only the project and writes only a .json under the artifacts folder", async () => {
    mockedRun.mockResolvedValue(baseResult());
    const { call } = captureTool();
    const abi = async (args: Record<string, string>) =>
      call({ verb: "plugin", gproj, plugin: { name: "AddonBuildInfoTool", args } });
    const dst = join(artifacts, "run", "addon.ci-info.json");
    const codeOfAbi = async (args: Record<string, string>) =>
      (bodyOf(await abi(args)).code as string | undefined) ?? "OK";
    // The audit trigger: ciInfoDst names a file outside the artifacts folder.
    expect(await codeOfAbi({ addonPath: root, ciInfoDst: join(tmpdir(), "important.json") })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOfAbi({ addonPath: join(tmpdir(), "anywhere"), ciInfoDst: dst })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOfAbi({ addonPath: root, ciInfoDst: `${artifacts}/../x.json` })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOfAbi({ addonPath: root, ciInfoDst: join(artifacts, "notes.txt") })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(await codeOfAbi({ addonPath: root, ciInfoDst: "ci.json" })).toBe("NOT_IN_PROJECT");
    expect(await codeOfAbi({ addonPath: root })).toBe("INVALID_ARGUMENT");
    expect(await codeOfAbi({ ciInfoDst: dst })).toBe("INVALID_ARGUMENT");
    expect(mockedRun).not.toHaveBeenCalled();
    // The measured live form (DEC-037): the project itself and a run file under artifacts.
    expect((await abi({ addonPath: root, ciInfoDst: dst })).isError).toBeUndefined();
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("checkPluginPaths matches keys case-insensitively and is null for a plugin without rules", () => {
    const ctx = { projectDir: root, projectId: "MyMod", artifactsDir: artifacts };
    expect(checkPluginPaths("WorldDataExport", { savedir: join(artifacts, "x") }, ctx)).toBeNull();
    expect(checkPluginPaths("SearchXOBPlugin", {}, ctx)).toBeNull();
    expect(
      checkPluginPaths(
        "AddonBuildInfoTool",
        { addonpath: root, cIInfoDst: join(artifacts, "a.json") },
        ctx,
      ),
    ).toBeNull();
    expect(
      checkPluginPaths(
        "SCR_PrefabValidatorPlugin",
        { validatePaths: "$X:a" },
        {
          ...ctx,
          projectId: null,
        },
      )?.message,
    ).toMatch(/no ID/);
  });
});

describe("wb_cli_run: helpers and -forceSettings (DEC-053 L7)", () => {
  it("readProjectId reads the .gproj ID; isWithin holds for the folder and below only", () => {
    expect(readProjectId('GameProject {\n ID "MyMod"\n GUID "0123456789ABCDEF"\n}')).toBe("MyMod");
    expect(readProjectId("GameProject {}")).toBeNull();
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(join(root, "a", "b"), root)).toBe(true);
    expect(isWithin(join(root, "..", "x"), root)).toBe(false);
  });

  it("no planned argv carries -forceSettings, and a plugin key named so is refused", async () => {
    expect(() => assertNoForceSettings(["-gproj", "x", "-forceSettings", "s"])).toThrow(
      /forceSettings/,
    );
    expect(() => assertNoForceSettings(["-forcesettings=x"])).toThrow();
    for (const verb of RUN_VERBS) {
      const argv = planFor(verb, { gproj, target: "worlds/w.ent", saveDir: artifacts });
      expect(() => assertNoForceSettings(argv), verb).not.toThrow();
    }
    const policy = policyOf(["plugin:P"]);
    (policy.pluginArgs as Map<string, Set<string>>).set("P", new Set(["forceSettings"]));
    const { call } = captureTool(policy);
    const res = await call({
      verb: "plugin",
      gproj,
      plugin: { name: "P", args: { forceSettings: "x" } },
    });
    expect(bodyOf(res).code).toBe("INVALID_ARGUMENT");
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

// ── W7: the terrain-variant plugin (DEC-075 OD-9) and OD-5's world gate ─────────

describe("wb_cli_run: W7 terrain-variant plugin (P-W7-15, DEC-075 OD-9, OD-5)", () => {
  const V = TERRAIN_VARIANT_PLUGIN;
  const throwawayWorld = join(root, "_throwaway", "W7", "t.ent");
  const userWorld = join(root, "worlds", "w.ent");
  const conf = "{E10A32BEF1F9E157}Configs/Workbench/WorldEditor/Autumn.conf";
  const argsFor = (world: string, over: Record<string, string> = {}) => ({
    tevrWorld: world,
    tevrVariant: "autumn",
    tevrConfig: conf,
    ...over,
  });
  /** The policy with the plugin listed and its three keys allowed. */
  const listedPolicy = (anyWorld?: boolean): CliPolicy => {
    const p = policyOf([`plugin:${V}`]);
    (p.pluginArgs as Map<string, Set<string>>).set(
      V,
      new Set(["tevrWorld", "tevrVariant", "tevrConfig"]),
    );
    return anyWorld === undefined ? p : { ...p, terrainAnyWorld: anyWorld };
  };
  const run = async (args: Record<string, string>, extra = {}, policy = listedPolicy()) =>
    captureTool(policy).call({ verb: "plugin", gproj, plugin: { name: V, args }, ...extra });

  beforeEach(() => mockedRun.mockResolvedValue(baseResult()));

  it("answers GATED naming P-W7-15 and its plugin entry until listed; nothing is spawned", async () => {
    const { call } = captureTool(policyOf(["plugin:AddonBuildInfoTool"]));
    const body = bodyOf(
      await call({ verb: "plugin", gproj, plugin: { name: V, args: argsFor(throwawayWorld) } }),
    );
    expect(body.code).toBe("GATED");
    expect(body.message).toContain("P-W7-15");
    expect(body.message).toContain(
      "policy.json cli_run.allow_list entry plugin:SCR_TerrainEntityVariantReplacementPlugin",
    );
    expect(String(body.next)).toContain("P-W7-15");
    expect(mockedRun).not.toHaveBeenCalled();
    expect(pluginGate(V)).toEqual(W7_PLUGIN_GATES[V]);
  });

  it("keeps the W5 and W6 gates as they were", async () => {
    expect(pluginGate("ResavePlugin")).toEqual({
      probe: "P-W6-08",
      switch: "policy.json cli_run.allow_list entry plugin:ResavePlugin",
    });
    expect(GATED_PLUGINS).toHaveLength(8);
    expect(GATED_PLUGINS).not.toContain(V);
    expect(pluginGate("toString")).toBeUndefined();
    expect(pluginGate("constructor")).toBeUndefined();
    const { call } = captureTool(policyOf([]));
    const bake = bodyOf(await call({ verb: "navmeshBake", gproj, target: "worlds/w.ent" }));
    expect(bake.code).toBe("GATED");
    expect(bake.message).toContain("P-W5-01");
    expect(CONFIRM_PLUGINS.has("ResavePlugin") && CONFIRM_PLUGINS.has("ResaveMetaPlugin")).toBe(
      true,
    );
  });

  it("shore and flow maps have no CLI route (OD-8): NOT_ALLOWLISTED, never GATED", async () => {
    const { call } = captureTool(listedPolicy());
    for (const name of ["BuildShoreMapWEPlugin", "GenerateFlowMapsWEPlugin", "BuildShoreMap"]) {
      expect(pluginGate(name), name).toBeUndefined();
      expect(bodyOf(await call({ verb: "plugin", gproj, plugin: { name } })).code, name).toBe(
        "NOT_ALLOWLISTED",
      );
    }
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("is a dry run without confirm: the argv carries -wbModule=WorldEditor and -exitAfterInit", async () => {
    const res = await run(argsFor(throwawayWorld));
    const body = bodyOf(res);
    expect(res.isError).toBeUndefined();
    expect(body.readback).toMatchObject({ dryRun: true, executed: false, plugin: V });
    expect(body.warnings).toEqual([]);
    const argv = (body.readback as { argv: string[] }).argv;
    expect(argv.slice(0, 3)).toEqual(["-gproj", gproj, "-scriptAuthorizeAll"]);
    expect(argv).toContain("-exitAfterInit");
    expect(argv.indexOf("-wbModule=WorldEditor")).toBe(argv.indexOf(`-plugin=${V}`) - 1);
    expect(argv).toContain(`-tevrWorld=${throwawayWorld}`);
    expect(argv).toContain("-tevrVariant=autumn");
    expect(argv).toContain(`-tevrConfig=${conf}`);
    expect(argv.join(" ").toLowerCase()).not.toContain("forcesettings");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("confirm:true on a world under _throwaway/ runs exactly the dry-run command line", async () => {
    const dry = bodyOf(await run(argsFor(throwawayWorld)));
    const ran = await run(argsFor(throwawayWorld), { confirm: true });
    expect(ran.isError).toBeUndefined();
    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(mockedRun.mock.calls[0][0].args).toEqual((dry.readback as { argv: string[] }).argv);
  });

  it("OD-5: confirm:true on a world outside _throwaway/ refuses GATED naming terrain_edit.any_world", async () => {
    const res = await run(argsFor(userWorld), { confirm: true });
    const body = bodyOf(res);
    expect(res.isError).toBe(true);
    expect(body.code).toBe("GATED");
    expect(body.message).toContain("policy.json terrain_edit.any_world true");
    expect(body.message).toContain("DEC-075 OD-5");
    expect(String(body.next)).toContain("_throwaway/");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("OD-5: the dry run on such a world still answers, with the gate as a warning", async () => {
    const body = bodyOf(await run(argsFor(userWorld)));
    expect(body.ok).toBe(true);
    expect(body.readback).toMatchObject({ dryRun: true, executed: false });
    expect(JSON.stringify(body.warnings)).toContain("terrain_edit.any_world");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("OD-5: terrain_edit.any_world true opens the gate; false or absent keeps it shut", async () => {
    expect((await run(argsFor(userWorld), { confirm: true }, listedPolicy(true))).isError).toBe(
      undefined,
    );
    expect(mockedRun).toHaveBeenCalledTimes(1);
    mockedRun.mockClear();
    expect(bodyOf(await run(argsFor(userWorld), { confirm: true }, listedPolicy(false))).code).toBe(
      "GATED",
    );
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("loadCliPolicy reads terrain_edit.any_world, true only when literally true", () => {
    const yes = join(root, "policy-tw-yes.json");
    writeFileSync(
      yes,
      JSON.stringify({ cli_run: { allow_list: [] }, terrain_edit: { any_world: true } }),
    );
    expect(loadCliPolicy(yes).terrainAnyWorld).toBe(true);
    const text = join(root, "policy-tw-text.json");
    writeFileSync(
      text,
      JSON.stringify({ cli_run: { allow_list: [] }, terrain_edit: { any_world: "true" } }),
    );
    expect(loadCliPolicy(text).terrainAnyWorld).toBe(false);
    const absent = join(root, "policy-tw-absent.json");
    writeFileSync(absent, JSON.stringify({ terrain_edit: { any_world: true } }));
    expect(loadCliPolicy(absent).terrainAnyWorld).toBe(true);
    expect(loadCliPolicy(join(root, "absent.json")).terrainAnyWorld).toBeFalsy();
  });

  it("the world is an absolute .ent inside the project that exists", async () => {
    const codeOf = async (args: Record<string, string>) =>
      bodyOf(await run(args)).code as string | undefined;
    expect(await codeOf(argsFor("worlds/w.ent"))).toBe("INVALID_ARGUMENT");
    expect(await codeOf(argsFor("$MyMod:worlds/w.ent"))).toBe("INVALID_ARGUMENT");
    expect(await codeOf(argsFor(join(root, "worlds", "w.txt")))).toBe("INVALID_ARGUMENT");
    expect(await codeOf(argsFor(join(tmpdir(), "x.ent")))).toBe("NOT_IN_PROJECT");
    expect(await codeOf(argsFor(join(root, "worlds", "absent.ent")))).toBe("NOT_IN_PROJECT");
    const { tevrVariant, tevrConfig } = argsFor(userWorld);
    expect(await codeOf({ tevrVariant, tevrConfig })).toBe("INVALID_ARGUMENT");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("the variant is one name and the config a .conf resource name or a project $ path", async () => {
    const codeOf = async (over: Record<string, string>) =>
      bodyOf(await run(argsFor(throwawayWorld, over))).code as string | undefined;
    expect(await codeOf({ tevrVariant: "autumn,winter" })).toBe("INVALID_ARGUMENT");
    expect(await codeOf({ tevrVariant: "" })).toBe("INVALID_ARGUMENT");
    expect(await codeOf({ tevrConfig: "$MyMod:Configs/A.conf" })).toBeUndefined();
    expect(await codeOf({ tevrConfig: "$ArmaReforger:Configs/A.conf" })).toBe("NOT_IN_PROJECT");
    expect(await codeOf({ tevrConfig: "{E10A32BEF1F9E157}Configs/A.et" })).toBe("INVALID_ARGUMENT");
    expect(await codeOf({ tevrConfig: "{E10A32BEF1F9E157}../A.conf" })).toBe("INVALID_ARGUMENT");
    expect(await codeOf({ tevrConfig: join(root, "A.conf") })).toBe("INVALID_ARGUMENT");
    const noConf = argsFor(throwawayWorld) as Record<string, string>;
    delete noConf.tevrConfig;
    expect(bodyOf(await run(noConf)).code).toBe("INVALID_ARGUMENT");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("an argument key outside policy plugin_args is refused before any path rule", async () => {
    const body = bodyOf(await run(argsFor(throwawayWorld, { addonPath: root })));
    expect(body.code).toBe("INVALID_ARGUMENT");
    expect(body.message).toContain("plugin_args");
  });

  it("isThrowawayWorld holds only under the project's top-level _throwaway/ folder", () => {
    expect(isThrowawayWorld(throwawayWorld, root)).toBe(true);
    expect(isThrowawayWorld(join(root, "_THROWAWAY", "x.ent"), root)).toBe(true);
    expect(isThrowawayWorld(join(root, "worlds", "_throwaway", "x.ent"), root)).toBe(false);
    expect(isThrowawayWorld(join(root, "_throwaway"), root)).toBe(false);
    expect(isThrowawayWorld(join(root, "_throwawayX", "x.ent"), root)).toBe(false);
    expect(isThrowawayWorld(join(tmpdir(), "_throwaway", "x.ent"), root)).toBe(false);
    expect(isThrowawayWorld("", root)).toBe(false);
  });
});
