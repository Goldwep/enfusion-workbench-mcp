import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { containsMachinePath } from "../../src/census/hygiene.js";
import {
  actionRiskHint,
  actionWhat,
  applyCovers,
  auditText,
  buildModel,
  deriveToolModule,
  emitRows,
  firstSentence,
  handlerModule,
  headline,
  inventory,
  maskComments,
  maskStrings,
  observationFileText,
  readRepoSources,
  run as runE11,
  scanHandlers,
  scanTools,
  toolRiskHint,
} from "../../scripts/census/enumerators/e11-mcp-inventory.js";
import {
  REPO_ROOT,
  apiClass,
  apiMethod,
  makeCensus,
  runIn,
  writeObservations,
  writeRepoFile,
  type Fixture,
} from "./helpers.js";

const BUILD = "1.0.0.1";

// ── Synthetic repository ──────────────────────────────────────────────────────

const SERVER = `
import { registerAlpha } from "./tools/alpha.js";
import { registerBeta } from "./tools/beta.js";
import { registerWrapped } from "./tools/wrapped.js";
import { registerCond } from "./tools/cond.js";

export function registerTools(server: McpServer, client: WorkbenchClient, flag: boolean): void {
  registerAlpha(server, client);
  registerBeta(server, client);
  registerWrapped(server, client);
  if (flag) {
    registerCond(server);
  }
}
`;

const ALPHA = `
import { z } from "zod";
const PREFIX = "Alpha ";
const TIMEOUT = computeTimeout();

export function registerAlpha(server: McpServer, client: WorkbenchClient): void {
  // server.registerTool("only_in_a_comment", {}, async () => {}); is not a registration
  server.registerTool(
    "alpha_ping",
    {
      description:
        PREFIX + "pings the bridge. " + \`The timeout is \${TIMEOUT}s.\`,
      inputSchema: { host: z.string() },
    },
    async () => {
      await client.call("EMCP_WB_Echo", {});
    },
  );
}
`;

const BETA = `
import { z } from "zod";
const ACTIONS = ["go", "stop", "bad", "ghostly"] as const;

export function registerBeta(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "beta_ctl",
    {
      description: "Control the thing. A second sentence that is not the what.",
      inputSchema: {
        action: z
          .enum(ACTIONS)
          .describe("Action: go (start it), stop (halt it), bad (use the built-in), ghostly"),
        path: z.string().optional(),
        mode: z.enum(["x", "y"]),
      },
    },
    async ({ action, path }) => {
      if (action === "bad") {
        const r = await client.call("BuiltinThing", { path });
        return r;
      }
      if (action === "ghostly") {
        return await client.call("EMCP_WB_Ctl", { action: "missing", path });
      }
      const params: Record<string, unknown> = { action };
      if (path) params.path = path;
      params.undeclared = 1;
      return await client.call("EMCP_WB_Ctl", params);
    },
  );
}
`;

const WRAPPED = `
import { z } from "zod";

async function wbCall(client: WorkbenchClient, handler: string, params: object) {
  return client.call(handler, params);
}

export function registerWrapped(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wrapped_op",
    {
      description: "Operate through a wrapper.",
      inputSchema: {
        operation: z.enum(["one", "two"]),
        scope: z.enum(["s1"]),
      },
    },
    async ({ operation }) => {
      await wbCall(client, "EMCP_WB_Sw", { action: operation === "one" ? "x" : "y" });
    },
  );
  server.registerTool(
    "cmd_tool",
    {
      description: "Run a command.",
      inputSchema: { command: z.enum(["a", "b"]), mode: z.enum(["m"]) },
    },
    async () => ({}),
  );
}
`;

const COND = `
export function registerCond(server: McpServer): void {
  server.registerTool("cond_tool", { description: "Registered only under a flag.", inputSchema: {} }, async () => ({}));
}
`;

const ORPHAN = `
export function registerOrphan(server: McpServer): void {
  server.registerTool("orphan_tool", { description: "Nothing calls this.", inputSchema: {} }, async () => ({}));
}
`;

const CTL = `/**
 * EMCP_WB_Ctl.c - Control handler for the test
 * Actions: go, stop
 */

class EMCP_WB_CtlRequest : JsonApiStruct
{
	string action;
	string path;

	void EMCP_WB_CtlRequest()
	{
		RegV("action");
		RegV("path");
	}
}

class EMCP_WB_Ctl : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_CtlRequest();
	}

	void Helper(WorldEditorAPI a)
	{
		a.HelperCall(1);
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_CtlRequest req = EMCP_WB_CtlRequest.Cast(request);
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		WorldEditorAPI api = worldEditor.GetApi();
		// if (req.action == "ghost") is only mentioned in a comment
		string note = "has // slashes and a fake \\"req.action == \\"fake\\" inside";

		if (req.action == "go")
		{
			// Starts the thing. It takes two arguments.
			api.StartThing(1, 2);
			EMCP_WB_Common.Fetch(api);
		}
		else if (req.action == "stop" || req.action == "halt")
		{
			api.StopThing();
			Helper(api);
		}
		else if (req.action == "later")
		{
			// SwitchToEditMode() is void - the result cannot be confirmed here.
			resp.message = "not implemented: later";
		}
		return null;
	}
}
`;

const SW = `/**
 * EMCP_WB_Sw.c - Switch handler
 */
class EMCP_WB_SwRequest : JsonApiStruct
{
	string action;

	void EMCP_WB_SwRequest()
	{
		RegV("action");
	}
}

class EMCP_WB_Sw : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_SwRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_SwRequest req = EMCP_WB_SwRequest.Cast(request);
		ScriptEditor se = Workbench.GetModule(ScriptEditor);
		switch (req.action)
		{
			case "x":
				se.DoX();
				break;
			case "y":
				se.DoY(1);
				break;
		}
		return null;
	}
}
`;

const ECHO = `/**
 * EMCP_WB_Echo.c - Echo handler without an action field
 */
class EMCP_WB_EchoRequest : JsonApiStruct
{
	void EMCP_WB_EchoRequest()
	{
	}
}

class EMCP_WB_Echo : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_EchoRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		WorldEditor we = Workbench.GetModule(WorldEditor);
		we.Ping();
		return null;
	}
}
`;

const COMMON = `class EMCP_WB_Common
{
	static void Fetch(WorldEditorAPI api)
	{
		api.CommonCall();
	}
}
`;

function syntheticRepo(fx: Fixture): void {
  writeRepoFile(fx, "src/server.ts", SERVER);
  writeRepoFile(fx, "src/tools/alpha.ts", ALPHA);
  writeRepoFile(fx, "src/tools/beta.ts", BETA);
  writeRepoFile(fx, "src/tools/wrapped.ts", WRAPPED);
  writeRepoFile(fx, "src/tools/cond.ts", COND);
  writeRepoFile(fx, "src/tools/orphan.ts", ORPHAN);
  writeRepoFile(fx, "mod/Scripts/Test/EMCP_WB_Ctl.c", CTL);
  writeRepoFile(fx, "mod/Scripts/Test/EMCP_WB_Sw.c", SW);
  writeRepoFile(fx, "mod/Scripts/Test/EMCP_WB_Echo.c", ECHO);
  writeRepoFile(fx, "mod/Scripts/Test/EMCP_WB_Common.c", COMMON);
}

function fixture(): { fx: Fixture; art: string } {
  const fx = makeCensus(BUILD);
  syntheticRepo(fx);
  return { fx, art: mkdtempSync(join(tmpdir(), "e11-art-")) };
}

function readE11(fx: Fixture): {
  header: Record<string, unknown>;
  rows: Record<string, unknown>[];
  text: string;
} {
  const text = readFileSync(join(fx.root, "observations", "E11", `${BUILD}.jsonl`), "utf-8");
  const [header, ...rows] = text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { header, rows, text };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

describe("e11 text helpers", () => {
  it("takes the first sentence, skipping periods inside brackets, ticks and e.g.", () => {
    expect(firstSentence("Do a thing (see a.b). Then more.")).toBe("Do a thing (see a.b).");
    expect(firstSentence("Use `a.b` here, e.g. this. Next.")).toBe("Use `a.b` here, e.g. this.");
    expect(firstSentence("No terminator")).toBe("No terminator");
    expect(firstSentence("No terminator", true)).toBeUndefined();
  });

  it("reads an action's own clause from a parameter description, or nothing", () => {
    const d = "Action: go (start it), stop (halt it), bad: use the built-in";
    expect(actionWhat(d, "go")).toBe("start it");
    expect(actionWhat(d, "stop")).toBe("halt it");
    expect(actionWhat(d, "bad")).toBe("use the built-in");
    expect(actionWhat("`run` (default): build now. `poll`: ask later.", "run")).toBe("build now");
    expect(actionWhat("'build' compiles it, 'create' scaffolds it", "create")).toBe("scaffolds it");
    expect(actionWhat("copy/cut (to clipboard), paste", "cut")).toBeUndefined();
    expect(actionWhat(undefined, "go")).toBeUndefined();
  });

  it("blanks comments and string contents without moving offsets", () => {
    const src = 'a == "x // y"; // c == "z"\n/* b == "w" */ d';
    const c = maskComments(src);
    expect(c.length).toBe(src.length);
    expect(c).toContain('"x // y"');
    expect(c).not.toContain('"z"');
    expect(c).not.toContain('"w"');
    const s = maskStrings(c);
    expect(s.length).toBe(src.length);
    expect(s).not.toContain("x // y");
  });

  it("derives a handler's module from its GetModule calls", () => {
    expect(handlerModule(["ResourceManager"])).toBe("ResourceManager");
    expect(handlerModule(["WorldEditor", "WorldEditor"])).toBe("WorldEditor");
    // none or several modules named: no single module
    expect(handlerModule([])).toBe("none");
    expect(handlerModule(["ScriptEditor", "WorldEditor"])).toBe("none");
  });

  it("derives a tool's module from the handlers it calls: one shared module or none, with the reason", () => {
    const hm = new Map([
      ["EMCP_WB_A", "WorldEditor"],
      ["EMCP_WB_A2", "WorldEditor"],
      ["EMCP_WB_B", "ScriptEditor"],
      ["EMCP_WB_C", "none"],
    ]);
    const call = (handler: string, builtin = false) => ({ handler, builtin });
    const of = (calls: { handler: string; builtin: boolean }[]) => deriveToolModule("t", calls, hm);
    expect(of([call("EMCP_WB_A")])).toMatchObject({
      module: "WorldEditor",
      reason: "single-module",
    });
    // several call sites and several handlers that agree
    expect(of([call("EMCP_WB_A2"), call("EMCP_WB_A"), call("EMCP_WB_A")])).toEqual({
      tool: "t",
      module: "WorldEditor",
      reason: "single-module",
      handlers: ["EMCP_WB_A", "EMCP_WB_A2"],
    });
    expect(of([])).toMatchObject({ module: "none", reason: "no-handler-call" });
    expect(of([call("EMCP_WB_A"), call("EMCP_WB_B")])).toMatchObject({
      module: "none",
      reason: "handlers-span-modules",
    });
    expect(of([call("EMCP_WB_C")])).toMatchObject({
      module: "none",
      reason: "handler-names-no-single-module",
    });
    expect(of([call("EMCP_WB_Gone")])).toMatchObject({
      module: "none",
      reason: "handler-not-in-mod",
    });
    // a built-in handler's source is not in the repository: its module is not stated, even
    // beside a handler of the mod that states one
    expect(of([call("GetResourceInfo", true)])).toMatchObject({
      module: "none",
      reason: "builtin-handler",
    });
    expect(of([call("EMCP_WB_A"), call("GetResourceInfo", true)])).toMatchObject({
      module: "none",
      reason: "builtin-handler",
    });
  });
});

// ── Synthetic repository ──────────────────────────────────────────────────────

describe("e11 on a synthetic repository", () => {
  it("counts what the server registers, not what a text search finds", () => {
    const { fx } = fixture();
    const { audit, tools } = scanTools(readRepoSources(fx.repo));
    expect(tools.map((t) => t.name)).toEqual([
      "alpha_ping",
      "beta_ctl",
      "cmd_tool",
      "cond_tool",
      "wrapped_op",
    ]);
    expect(audit.astCalls).toBe(6); // the unreachable tool is parsed too
    expect(audit.reachable).toBe(5);
    expect(audit.unreachable).toEqual(["orphan_tool (src/tools/orphan.ts:3)"]);
    expect(audit.conditional).toEqual(["cond_tool (src/tools/cond.ts:3)"]);
    // one more `.registerTool(` in a comment: the text count is higher than the AST count
    expect(audit.textMatchesInTools).toBe(7);
    expect(audit.registerFunctionsCalled).toBe(4);
    expect(audit.duplicateNames).toEqual([]);
  });

  it("folds descriptions to a first sentence and picks the dispatch parameter by priority", () => {
    const { fx } = fixture();
    const { tools } = scanTools(readRepoSources(fx.repo));
    const by = (n: string) => tools.find((t) => t.name === n);
    expect(by("alpha_ping")?.what).toBe("Alpha pings the bridge.");
    expect(by("beta_ctl")?.what).toBe("Control the thing.");
    expect(by("beta_ctl")?.param?.name).toBe("action");
    expect(by("beta_ctl")?.param?.values.map((v) => v.value)).toEqual([
      "go",
      "stop",
      "bad",
      "ghostly",
    ]);
    expect(by("wrapped_op")?.param?.name).toBe("operation");
    expect(by("cmd_tool")?.param?.name).toBe("command");
    expect(by("alpha_ping")?.param).toBeUndefined();
  });

  it("reads handler dispatch from if-chains and switches, never from comments or strings", () => {
    const { fx } = fixture();
    const hs = scanHandlers(readRepoSources(fx.repo));
    expect(hs.map((h) => h.cls)).toEqual(["EMCP_WB_Ctl", "EMCP_WB_Echo", "EMCP_WB_Sw"]);
    const ctl = hs[0];
    expect(ctl.actions.map((a) => a.action)).toEqual(["go", "stop", "halt", "later"]);
    expect(ctl.requestFields).toEqual(["action", "path"]);
    const go = ctl.actions[0];
    expect(go.what).toBe("Starts the thing.");
    expect(go.apiCalls.map((c) => `${c.cls}.${c.method}/${c.arity}`)).toEqual([
      "WorldEditorAPI.CommonCall/0", // followed into EMCP_WB_Common.Fetch
      "WorldEditorAPI.StartThing/2",
    ]);
    const stop = ctl.actions[1];
    expect(stop.apiCalls.map((c) => `${c.cls}.${c.method}/${c.arity}`)).toEqual([
      "WorldEditorAPI.HelperCall/1", // followed into the helper method
      "WorldEditorAPI.StopThing/0",
    ]);
    expect(ctl.actions[2].line).toBe(ctl.actions[1].line); // halt shares the stop branch
    expect(ctl.actions[3].placeholder).toBe(true);
    expect(
      hs[2].actions.map((a) => [
        a.action,
        a.apiCalls.map((c) => `${c.cls}.${c.method}/${c.arity}`),
      ]),
    ).toEqual([
      ["x", ["ScriptEditor.DoX/0"]],
      ["y", ["ScriptEditor.DoY/1"]],
    ]);
    const echo = hs[1].actions;
    expect(echo).toHaveLength(1);
    expect(echo[0]).toMatchObject({
      action: "run",
      synthetic: true,
      what: "Echo handler without an action field",
    });
  });

  it("links tool actions to the handler actions their call sites send to", () => {
    const { fx } = fixture();
    const model = buildModel(readRepoSources(fx.repo));
    const at = (t: string, a: string) =>
      model.toolActions.find((x) => x.tool === t && x.value === a);
    expect(at("beta_ctl", "go")?.links).toEqual([{ handler: "EMCP_WB_Ctl", action: "go" }]);
    expect(at("beta_ctl", "stop")?.links).toEqual([{ handler: "EMCP_WB_Ctl", action: "stop" }]);
    // narrowed branches: `bad` goes to a built-in handler, `ghostly` to a missing action
    expect(at("beta_ctl", "bad")?.links).toEqual([]);
    expect(at("beta_ctl", "bad")?.builtin).toMatchObject([
      { handler: "BuiltinThing", requestKeys: ["path"] },
    ]);
    expect(at("beta_ctl", "ghostly")?.mismatches).toMatchObject([
      { handler: "EMCP_WB_Ctl", sent: "missing", kind: "undispatched-action" },
    ]);
    // the early-returning branches are excluded from the pass-through call
    expect(at("beta_ctl", "go")?.mismatches).toEqual([]);
    expect(at("alpha_ping", "run")?.links).toEqual([{ handler: "EMCP_WB_Echo", action: "run" }]);
    // a conditional literal inside a wrapper call sends to both actions (over-approximation)
    expect(at("wrapped_op", "one")?.links.map((l) => l.action)).toEqual(["x", "y"]);
    expect(model.requestKeyMismatches).toMatchObject([
      { tool: "beta_ctl", handler: "EMCP_WB_Ctl", key: "undeclared" },
    ]);
    expect(model.mismatches).toHaveLength(1);
  });

  it("emits tool, action and handler-action rows with resolvable refs and the plan's keys", () => {
    const { fx } = fixture();
    const src = readRepoSources(fx.repo);
    const r = inventory(src, fx.paths, BUILD, { modules: true });
    const kinds: Record<string, number> = {};
    for (const row of r.rows) kinds[row.obs.kind] = (kinds[row.obs.kind] ?? 0) + 1;
    expect(kinds).toEqual({ "mcp-tool": 5, "mcp-action": 10, "handler-action": 7 });
    const ids = r.rows.map((x) => x.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain("mcp:action/alpha_ping.run");
    expect(ids).toContain("mcp:action/beta_ctl.go");
    expect(ids).toContain("mcp:handler-action/EMCP_WB_Ctl.halt");
    expect(ids).toContain("mcp:handler-action/EMCP_WB_Echo.run");
    const tool = r.rows.find((x) => x.id === "mcp:tool/beta_ctl")?.obs;
    expect(tool).toMatchObject({ children_count: 4, parent_key: null, confidence: "high" });
    const act = r.rows.find((x) => x.id === "mcp:action/beta_ctl.go")?.obs;
    expect(act).toMatchObject({
      what: "start it",
      parent_key: { dim: "mcp", kind: "mcp-tool", key: { tool: "beta_ctl" } },
      confidence: "high",
    });
    // implicit "run" and non-"action" dispatch parameters are medium confidence
    expect(r.rows.find((x) => x.id === "mcp:action/alpha_ping.run")?.obs.confidence).toBe("medium");
    expect(r.rows.find((x) => x.id === "mcp:action/cmd_tool.a")?.obs.confidence).toBe("medium");
    const lines = (rel: string): string[] =>
      readFileSync(join(fx.repo, rel), "utf-8").split(/\r?\n/);
    for (const row of r.rows) {
      const m = /^<repo>\/(.+)#L(\d+)$/.exec(row.obs.ref);
      expect(m, row.obs.ref).not.toBeNull();
      const line = lines((m as RegExpExecArray)[1])[Number((m as RegExpExecArray)[2]) - 1];
      expect(line, row.id).toContain(row.obs.quote as string);
      const k = row.obs.key as Record<string, string>;
      // gate: an action row resolves to a line that contains the action literal; the implicit
      // "run" of a tool without a dispatch parameter resolves to the registration line
      if (row.obs.kind === "mcp-action" && k.action !== "run")
        expect(line, row.id).toContain(`"${k.action}"`);
      if (row.obs.kind === "handler-action" && k.action !== "run")
        expect(line, row.id).toContain(`"${k.action}"`);
      if (row.obs.kind === "mcp-tool") expect(line, row.id).toContain(`"${k.tool}"`);
    }
  });

  it("can emit module none everywhere", () => {
    const { fx } = fixture();
    const model = buildModel(readRepoSources(fx.repo));
    expect(emitRows(model, { modules: false }).rows.every((r) => r.obs.module === "none")).toBe(
      true,
    );
  });

  it("derives tool and action modules from the handlers they call by default, and takes handler modules from the source", () => {
    const { fx } = fixture();
    const model = buildModel(readRepoSources(fx.repo));
    const dflt = emitRows(model, { modules: true }).rows;
    const modOf = (id: string): string | undefined => dflt.find((r) => r.id === id)?.obs.module;
    // alpha_ping -> Echo (WorldEditor); wrapped_op -> Sw (ScriptEditor)
    expect(modOf("mcp:tool/alpha_ping")).toBe("WorldEditor");
    expect(modOf("mcp:action/alpha_ping.run")).toBe("WorldEditor");
    expect(modOf("mcp:tool/wrapped_op")).toBe("ScriptEditor");
    expect(modOf("mcp:action/wrapped_op.one")).toBe("ScriptEditor");
    // beta_ctl also calls a built-in handler: no stated module; cmd_tool and cond_tool call none
    expect(modOf("mcp:tool/beta_ctl")).toBe("none");
    expect(modOf("mcp:action/beta_ctl.go")).toBe("none");
    expect(modOf("mcp:tool/cmd_tool")).toBe("none");
    expect(modOf("mcp:tool/cond_tool")).toBe("none");
    // an action row carries its tool's module, and so does the parent it names
    for (const r of dflt.filter((x) => x.obs.kind === "mcp-action")) {
      const tool = (r.obs.key as { tool: string }).tool;
      expect(r.obs.module, r.id).toBe(modOf(`mcp:tool/${tool}`));
      expect(r.obs.parent_key?.module, r.id).toBe(r.obs.module);
    }
    expect(model.toolModules.map((t) => [t.tool, t.module, t.reason])).toEqual([
      ["alpha_ping", "WorldEditor", "single-module"],
      ["beta_ctl", "none", "builtin-handler"],
      ["cmd_tool", "none", "no-handler-call"],
      ["cond_tool", "none", "no-handler-call"],
      ["wrapped_op", "ScriptEditor", "single-module"],
    ]);
    const hm = (h: string): string | undefined =>
      dflt.find(
        (r) =>
          r.id ===
          `mcp:handler-action/${h}.${h === "EMCP_WB_Sw" ? "x" : h === "EMCP_WB_Ctl" ? "go" : "run"}`,
      )?.obs.module;
    expect(hm("EMCP_WB_Ctl")).toBe("WorldEditor");
    expect(hm("EMCP_WB_Sw")).toBe("ScriptEditor");
    expect(hm("EMCP_WB_Echo")).toBe("WorldEditor");
    // the opt-out blanks the derived tool modules too
    const off = emitRows(model, { modules: false }).rows;
    expect(off.every((r) => r.obs.module === "none")).toBe(true);
  });

  it("gives a tool no module when its handlers span modules, name none, or are not in the mod", () => {
    const fx = makeCensus(BUILD);
    const handler = (name: string, body: string): string =>
      `class ${name}Request : JsonApiStruct\n{\n}\n\nclass ${name} : NetApiHandler\n{\n\toverride JsonApiStruct GetRequest()\n\t{\n\t\treturn new ${name}Request();\n\t}\n\n\toverride JsonApiStruct GetResponse(JsonApiStruct request)\n\t{\n${body}\t\treturn null;\n\t}\n}\n`;
    writeRepoFile(
      fx,
      "src/server.ts",
      [
        'import { registerM } from "./tools/m.js";',
        "export function registerTools(server: McpServer, client: WorkbenchClient): void {",
        "  registerM(server, client);",
        "}",
        "",
      ].join("\n"),
    );
    const tool = (name: string, calls: string[]): string =>
      `  server.registerTool("${name}", { description: "Tool ${name}.", inputSchema: {} }, async () => {\n${calls
        .map((h) => `    await client.call("${h}", {});\n`)
        .join("")}  });\n`;
    writeRepoFile(
      fx,
      "src/tools/m.ts",
      `export function registerM(server: McpServer, client: WorkbenchClient): void {\n${[
        tool("m_same", ["EMCP_WB_A", "EMCP_WB_A2"]),
        tool("m_span", ["EMCP_WB_A", "EMCP_WB_B"]),
        tool("m_multi", ["EMCP_WB_C"]),
        tool("m_ghost", ["EMCP_WB_Gone"]),
        tool("m_none", []),
      ].join("")}}\n`,
    );
    writeRepoFile(
      fx,
      "mod/Scripts/T/A.c",
      handler(
        "EMCP_WB_A",
        "\t\tWorldEditor w = Workbench.GetModule(WorldEditor);\n\t\tw.Ping();\n",
      ) +
        handler(
          "EMCP_WB_A2",
          "\t\tWorldEditor w = Workbench.GetModule(WorldEditor);\n\t\tw.Pong();\n",
        ) +
        handler(
          "EMCP_WB_B",
          "\t\tScriptEditor s = Workbench.GetModule(ScriptEditor);\n\t\ts.Ping();\n",
        ) +
        handler(
          "EMCP_WB_C",
          "\t\tWorldEditor w = Workbench.GetModule(WorldEditor);\n\t\tScriptEditor s = Workbench.GetModule(ScriptEditor);\n",
        ),
    );
    const model = buildModel(readRepoSources(fx.repo));
    expect(model.toolModules.map((t) => [t.tool, t.module, t.reason])).toEqual([
      ["m_ghost", "none", "handler-not-in-mod"],
      ["m_multi", "none", "handler-names-no-single-module"],
      ["m_none", "none", "no-handler-call"],
      ["m_same", "WorldEditor", "single-module"],
      ["m_span", "none", "handlers-span-modules"],
    ]);
    const rows = emitRows(model, { modules: true }).rows;
    expect(
      Object.fromEntries(
        rows.filter((r) => r.obs.kind === "mcp-tool").map((r) => [r.id, r.obs.module]),
      ),
    ).toEqual({
      "mcp:tool/m_ghost": "none",
      "mcp:tool/m_multi": "none",
      "mcp:tool/m_none": "none",
      "mcp:tool/m_same": "WorldEditor",
      "mcp:tool/m_span": "none",
    });
  });

  it("leaves out a branch comment that states an implementation caveat instead of what the action does", () => {
    const { fx } = fixture();
    const model = buildModel(readRepoSources(fx.repo));
    const ctl = model.handlers.find((h) => h.cls === "EMCP_WB_Ctl");
    expect(ctl?.actions.find((a) => a.action === "go")?.what).toBe("Starts the thing.");
    expect(ctl?.actions.find((a) => a.action === "later")?.what).toBeUndefined();
  });

  it("proposes covers as a pure function of source and known ids: dropped without E02/E04, kept with them", () => {
    const { fx } = fixture();
    const src = readRepoSources(fx.repo);
    const none = inventory(src, fx.paths, BUILD, { modules: true });
    // Only E11's own handler-action ids survive when no other enumerator has landed.
    // api calls: go 2, stop 2, halt 2, later 0, x 1, y 1, Echo.run 2
    expect(none.covers.byBasis["api-call"]).toEqual([10, 0]);
    expect(none.covers.byBasis["net-handler"][1]).toBe(0);
    // handler-action links: Echo.run, go, stop, and one + two (each to x and y); net-handler: 5 rows
    expect(none.covers.byBasis["handler-action"]).toEqual([7, 7]);
    expect(none.covers.byBasis["net-handler"]).toEqual([5, 0]);
    expect(none.covers.proposed).toBe(22);
    expect(none.covers.surviving).toBe(7);
    const goRow = none.rows.find((x) => x.id === "mcp:action/beta_ctl.go")?.obs;
    expect(goRow?.covers_proposed).toEqual(["mcp:handler-action/EMCP_WB_Ctl.go"]);

    // E02 (api) and E04 (net-handler) land: api ids with one extra default argument still match.
    writeObservations(fx, "E02", BUILD, [
      apiClass("WorldEditorAPI"),
      apiMethod("WorldEditorAPI", "StartThing", 3),
      apiMethod("WorldEditorAPI", "StopThing", 0),
    ]);
    writeObservations(fx, "E04", BUILD, [
      {
        dim: "net",
        kind: "net-handler",
        module: "none",
        key: { handler: "EMCP_WB_Ctl" },
        parent_key: null,
        origin: "vanilla",
        ref: "pak:scripts/NetApiDocs.c#L1",
        confidence: "high",
      },
    ]);
    const some = inventory(readRepoSources(fx.repo), fx.paths, BUILD, { modules: true });
    expect(some.known.ids.size).toBe(4);
    const goApi = some.rows.find((x) => x.id === "mcp:handler-action/EMCP_WB_Ctl.go")?.obs;
    expect(goApi?.covers_proposed).toEqual(["api:WorldEditorAPI.StartThing/3"]);
    const stopApi = some.rows.find((x) => x.id === "mcp:handler-action/EMCP_WB_Ctl.stop")?.obs;
    expect(stopApi?.covers_proposed).toEqual(["api:WorldEditorAPI.StopThing/0"]);
    const goTool = some.rows.find((x) => x.id === "mcp:action/beta_ctl.go")?.obs;
    expect(goTool?.covers_proposed).toEqual([
      "mcp:handler-action/EMCP_WB_Ctl.go",
      "net:handler/EMCP_WB_Ctl",
    ]);
    // 7 handler-action + 2 net-handler (Ctl: go, stop) + 3 api (go, stop, halt)
    expect(some.covers.surviving).toBe(12);
    const resolved = some.covers.table.flatMap((r) => r.proposals).find((p) => p.resolved);
    expect(resolved).toMatchObject({
      target: "api:WorldEditorAPI.StartThing/2",
      resolved: "api:WorldEditorAPI.StartThing/3",
    });
  });

  it("lists the request keys each built-in handler call sends in audit.json, and says whether E04 has landed", () => {
    type Audit = {
      modules_emitted: boolean;
      tool_modules: {
        by_module: Record<string, string[]>;
        tools_by_reason: Record<string, number>;
        called_handlers_but_none: { tool: string; reason: string; handlers: string[] }[];
      };
      builtin_request_key_check: { status: string; e04_observation_present: boolean };
      builtin_handler_calls: {
        action: string;
        calls: { handler: string; request_keys: string[]; ref: string }[];
      }[];
    };
    const readAudit = (art: string): Audit =>
      JSON.parse(readFileSync(join(art, "census", BUILD, "E11", "audit.json"), "utf-8")) as Audit;
    const { fx, art } = fixture();
    expect(runIn(fx, runE11, ["--artifacts", art]).code).toBe(0);
    const before = readAudit(art);
    expect(before.builtin_handler_calls).toEqual([
      {
        action: "beta_ctl.bad",
        calls: [
          {
            handler: "BuiltinThing",
            request_keys: ["path"],
            ref: `src/tools/beta.ts#L${BETA.split("\n").findIndex((l) => l.includes('"BuiltinThing"')) + 1}`,
          },
        ],
      },
    ]);
    expect(before.builtin_request_key_check.e04_observation_present).toBe(false);
    expect(before.builtin_request_key_check.status).toMatch(/^pending: no E04 observation file/);
    expect(before.tool_modules.by_module).toEqual({
      ScriptEditor: ["wrapped_op"],
      WorldEditor: ["alpha_ping"],
    });
    expect(before.tool_modules.tools_by_reason).toEqual({
      "builtin-handler": 1,
      "no-handler-call": 2,
      "single-module": 2,
    });
    expect(before.tool_modules.called_handlers_but_none).toEqual([
      { tool: "beta_ctl", reason: "builtin-handler", handlers: ["BuiltinThing", "EMCP_WB_Ctl"] },
    ]);

    // Once an E04 observation file exists the audit says so (the keys stay listed).
    writeObservations(fx, "E04", BUILD, [
      {
        dim: "net",
        kind: "net-handler",
        module: "none",
        key: { handler: "BuiltinThing" },
        parent_key: null,
        origin: "vanilla",
        ref: "pak:scripts/NetApiDocs.c#L1",
        confidence: "high",
      },
    ]);
    expect(runIn(fx, runE11, ["--artifacts", art]).code).toBe(0);
    const after = readAudit(art);
    expect(after.builtin_request_key_check.e04_observation_present).toBe(true);
    expect(after.builtin_handler_calls).toEqual(before.builtin_handler_calls);
  });

  it("applyCovers is deterministic and keeps the table sorted", () => {
    const { fx } = fixture();
    const src = readRepoSources(fx.repo);
    const a = inventory(src, fx.paths, BUILD, { modules: true });
    const b = inventory(src, fx.paths, BUILD, { modules: true });
    expect(JSON.stringify(a.covers)).toBe(JSON.stringify(b.covers));
    const ids = a.covers.table.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
    const again = applyCovers(a.rows, new Set(["api:WorldEditorAPI.StopThing/0"]));
    expect(again.surviving).toBe(a.covers.surviving + 2); // stop and halt share the call
  });

  it("writes a byte-identical observation file on a second run and the artifacts beside it", () => {
    const { fx, art } = fixture();
    const first = runIn(fx, runE11, ["--artifacts", art]);
    expect(first.code).toBe(0);
    const t1 = readE11(fx).text;
    const second = runIn(fx, runE11, ["--artifacts", art]);
    expect(second.code).toBe(0);
    expect(readE11(fx).text).toBe(t1);
    expect(second.stdout).toContain(
      "22 observations (7 handler-action, 10 mcp-action, 5 mcp-tool)",
    );
    expect(first.stdout).toContain(
      "1 action(s) send to a handler action that does not exist; 1 action(s) call a built-in handler",
    );
    const covers = JSON.parse(
      readFileSync(join(art, "census", BUILD, "E11", "covers-proposed.json"), "utf-8"),
    ) as { proposed: number; surviving: number; rows: unknown[] };
    expect(covers.proposed).toBeGreaterThan(covers.surviving);
    const audit = JSON.parse(
      readFileSync(join(art, "census", BUILD, "E11", "audit.json"), "utf-8"),
    ) as {
      registration: { reachable: number };
      mismatches: unknown[];
    };
    expect(audit.registration.reachable).toBe(5);
    expect(audit.mismatches).toHaveLength(1);
    const { header, rows } = readE11(fx);
    expect(header).toMatchObject({
      $header: 1,
      enumerator: "E11",
      generator: "scripts/census/enumerators/e11-mcp-inventory.ts",
      provisional: false,
      row_count: rows.length,
    });
    expect((header.inputs as { path: string }[]).every((i) => i.path.startsWith("<repo>/"))).toBe(
      true,
    );
    expect(containsMachinePath(t1)).toBe(false);
    expect(t1).not.toContain('"id"');
  });

  it("is accepted by the ledger with and without a fake E02 present, and no cover names an unknown row", () => {
    for (const withE02 of [false, true]) {
      const { fx, art } = fixture();
      if (withE02) {
        writeObservations(fx, "E02", BUILD, [
          apiClass("WorldEditorAPI"),
          apiMethod("WorldEditorAPI", "StartThing", 2),
          apiMethod("WorldEditorAPI", "StopThing", 0),
        ]);
      }
      expect(runIn(fx, runE11, ["--artifacts", art]).code).toBe(0);
      const built = buildLedger(fx.paths);
      expect(built.rejected).toEqual([]);
      expect(built.problems.filter((p) => /E11|mcp:/.test(`${p.id ?? ""} ${p.message}`))).toEqual(
        [],
      );
      expect(
        built.problems.filter((p) => p.message.includes("covers_proposed names unknown row")),
      ).toEqual([]);
      const mine = built.observations.filter((o) => o.enumerator === "E11");
      expect(mine).toHaveLength(22);
      expect(mine.every((o) => o.refCheck === "resolves")).toBe(true);
      expect(built.meta.unverified_refs).toEqual(withE02 ? { E02: 3 } : {});
      const go = built.rows.find((r) => r.id === "api:WorldEditorAPI.StartThing/2");
      expect(go?.mcp_proposed ?? []).toEqual(withE02 ? ["mcp:handler-action/EMCP_WB_Ctl.go"] : []);
    }
  });

  it("refuses an output path outside observations/E11 and answers NO DATA without a server file", () => {
    const { fx, art } = fixture();
    const r = runIn(fx, runE11, [
      "--artifacts",
      art,
      "--out",
      join(fx.root, "observations", "E02", `${BUILD}.jsonl`),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing --out outside observations/E11/");
    const empty = makeCensus(BUILD);
    const n = runIn(empty, runE11, ["--artifacts", art]);
    expect(n.code).toBe(2);
    expect(n.stdout).toContain("NO DATA");
  });

  it("module none flag changes only the module field", () => {
    const { fx, art } = fixture();
    runIn(fx, runE11, ["--artifacts", art]);
    const defaultRows = readE11(fx).rows;
    // by default the file carries derived tool and action modules, no flag needed
    expect(
      defaultRows.find(
        (r) => r.kind === "mcp-tool" && (r.key as { tool: string }).tool === "alpha_ping",
      )?.module,
    ).toBe("WorldEditor");
    expect(
      defaultRows.find(
        (r) => r.kind === "mcp-action" && (r.key as { tool: string }).tool === "wrapped_op",
      )?.module,
    ).toBe("ScriptEditor");
    const withModules = defaultRows.map((r) => ({ ...r, module: "x", parent_key: undefined }));
    runIn(fx, runE11, ["--artifacts", art, "--no-modules"]);
    const without = readE11(fx).rows;
    expect(without.every((r) => r.module === "none")).toBe(true);
    expect(without.map((r) => ({ ...r, module: "x", parent_key: undefined }))).toEqual(withModules);
  });

  it("serialises rows through the shared canonical writer", () => {
    const { fx } = fixture();
    const r = inventory(readRepoSources(fx.repo), fx.paths, BUILD, { modules: true });
    const text = observationFileText(r.rows, r.model.inputs, BUILD);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")[0]).toMatch(/^\{"\$header":1,"build":"1\.0\.0\.1","enumerator":"E11"/);
  });
});

// ── Generated request schemas ─────────────────────────────────────────────────

const GEN_ACTION = (name: string, mutating: boolean): string => `    {
      "name": "${name}",
      "summary": "x",
      "mutating": ${mutating},
      "projectOnly": ${mutating},
      "params": [],
      "response": [],
      "paging": false
    }`;

const GEN_CONTRACT = `{
  "handler": "EMCP_WB_Gen",
  "tool": "wb_gen",
  "purpose": "Fixture.",
  "source": "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Gen.c",
  "request": ["action"],
  "response": ["status"],
  "actions": [
${GEN_ACTION("list", false)},
${GEN_ACTION("setThing", true)}
  ]
}
`;

const GEN_SERVER = `
import { registerGen } from "./tools/gen.js";
export function registerTools(server: McpServer, client: WorkbenchClient): void {
  registerGen(server, client);
}
`;

// The tool builds its request schema from a contract, so the file holds no literal enum.
const GEN_TOOL = `
import { buildRequestSchema } from "../manifest/generate.js";
const HANDLER = "EMCP_WB_Gen";
export function registerGen(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_gen",
    { description: "Generated tool.", inputSchema: flatShape(buildRequestSchema(contract)) },
    async (args) => client.call(HANDLER, args),
  );
}
`;

const GEN_HANDLER = `
class EMCP_WB_Gen : NetApiHandler
{
	override void OnRequest(JsonApiStruct req, JsonApiStruct res)
	{
		if (req.action == "list") {}
		if (req.action == "setThing") {}
	}
}
`;

describe("e11 on the alias route table", () => {
  it("links an alias tool to the routed tool's handler action, and nothing for a handlerless route", () => {
    const fx = makeCensus();
    writeRepoFile(fx, "src/server.ts", GEN_SERVER.replace(/registerGen/g, "registerAl"));
    writeRepoFile(
      fx,
      "src/manifest/aliases.ts",
      `export const ALIAS_ROUTES = Object.freeze({
  wb_old: (args) => ({ tool: "wb_gen", args: { action: "setThing", ...args } }),
  wb_nat: (args) => ({ tool: "wb_natives", args: { ...args, action: "reload" } }),
});
`,
    );
    writeRepoFile(
      fx,
      "src/tools/gen.ts",
      `export function registerAl(server: McpServer, client: WorkbenchClient): void {
  server.registerTool("wb_old", { description: "Old." }, async () => runAliasViaModule(client, "wb_old", {}));
  server.registerTool("wb_nat", { description: "Nat." }, async () => runAliasViaModule(client, "wb_nat", {}));
}
`,
    );
    writeRepoFile(fx, "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Gen.c", GEN_HANDLER);
    writeRepoFile(fx, "contracts/EMCP_WB_Gen.json", GEN_CONTRACT);
    const model = buildModel(readRepoSources(fx.repo));
    const links = (t: string) => model.toolActions.find((a) => a.tool === t)?.links;
    expect(links("wb_old")).toEqual([{ handler: "EMCP_WB_Gen", action: "setThing" }]);
    expect(links("wb_nat")).toEqual([]);
    expect(model.toolModules.find((m) => m.tool === "wb_old")?.handlers).toEqual(["EMCP_WB_Gen"]);
  });
});

describe("e11 on an ACTIONS constant", () => {
  it("reads a top-level ACTIONS array (spreads folded) when the schema is not an object literal", () => {
    const fx = makeCensus();
    writeRepoFile(fx, "src/server.ts", GEN_SERVER);
    writeRepoFile(
      fx,
      "src/tools/gen.ts",
      `import { z } from "zod";
const READ = ["list", "describe"] as const;
export const ACTIONS = [...READ, "call"] as const;
const INPUT = { action: z.enum(ACTIONS) };
export function registerGen(server: McpServer, client: WorkbenchClient): void {
  server.registerTool("wb_gen", { description: "Gen.", inputSchema: INPUT }, async () => ({}));
}
`,
    );
    const t = buildModel(readRepoSources(fx.repo)).tools.find((x) => x.name === "wb_gen");
    expect(t?.param?.values.map((v) => v.value)).toEqual(["list", "describe", "call"]);
  });

  it("reads an inputSchema held in a top-level const whose enum is any const array", () => {
    const fx = makeCensus();
    writeRepoFile(fx, "src/server.ts", GEN_SERVER);
    writeRepoFile(
      fx,
      "src/tools/gen.ts",
      `import { z } from "zod";
export const GEN_ACTIONS = ["status", "tiles"] as const;
export const GEN_INPUT_SCHEMA = { action: z.enum(GEN_ACTIONS), path: z.string().optional() };
export function registerGen(server: McpServer, client: WorkbenchClient): void {
  server.registerTool("wb_gen", { description: "Gen.", inputSchema: GEN_INPUT_SCHEMA }, async () => ({}));
}
`,
    );
    const t = buildModel(readRepoSources(fx.repo)).tools.find((x) => x.name === "wb_gen");
    expect(t?.param?.values.map((v) => v.value)).toEqual(["status", "tiles"]);
  });
});

describe("e11 on a generated request schema", () => {
  const make = (contract: string | null): Fixture => {
    const fx = makeCensus();
    writeRepoFile(fx, "src/server.ts", GEN_SERVER);
    writeRepoFile(fx, "src/tools/gen.ts", GEN_TOOL);
    writeRepoFile(fx, "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Gen.c", GEN_HANDLER);
    if (contract !== null) writeRepoFile(fx, "contracts/EMCP_WB_Gen.json", contract);
    return fx;
  };

  it("reads the action names from the contract and links them to the contract's handler", () => {
    const fx = make(GEN_CONTRACT);
    const model = buildModel(readRepoSources(fx.repo));
    const t = model.tools.find((x) => x.name === "wb_gen");
    expect(t?.param?.name).toBe("action");
    expect(t?.param?.values.map((v) => v.value)).toEqual(["list", "setThing"]);
    const rows = emitRows(model, { modules: true }).rows.filter((r) => r.obs.kind === "mcp-action");
    expect(rows.map((r) => r.id).sort()).toEqual([
      "mcp:action/wb_gen.list",
      "mcp:action/wb_gen.setThing",
    ]);
    for (const r of rows) {
      // ref and quote point at the action's "name" line in the contract JSON
      const m = /^<repo>\/(.+)#L(\d+)$/.exec(r.obs.ref) as RegExpExecArray;
      expect(m[1]).toBe("contracts/EMCP_WB_Gen.json");
      const k = r.obs.key as { action: string };
      expect(r.obs.quote).toContain(`"name": "${k.action}"`);
      expect(r.proposals.map((p) => p.target)).toEqual([
        `mcp:handler-action/EMCP_WB_Gen.${k.action}`,
        "net:handler/EMCP_WB_Gen",
      ]);
    }
  });

  it("falls back to one run action when the repository has no matching contract", () => {
    const fx = make(null);
    const model = buildModel(readRepoSources(fx.repo));
    expect(model.tools.find((x) => x.name === "wb_gen")?.param).toBeUndefined();
    expect(model.toolActions.map((a) => a.value)).toEqual(["run"]);
  });
});

// ── Real repository ───────────────────────────────────────────────────────────

describe.skipIf(!existsSync(join(REPO_ROOT, "src", "server.ts")))(
  "e11 over the real repository source",
  () => {
    const src = readRepoSources(REPO_ROOT);
    const model = buildModel(src);
    const emitted = emitRows(model, { modules: true });

    // 119 = 113 + the four Phase 3 tools registered by f3bc59d (wb_scripts, wb_module, wb_plugin,
    // wb_container) + wb_bi and wb_gui; 120 with behavior_tree (5 actions); 123 with the wave W1
    // nouns wb_entity, wb_view and wb_world (DEC-061); 129 with the six offline tools of waves W2 and
    // W3 registered at tier extended (DEC-065: config_edit, imageset, layout_edit, meta_file,
    // project_settings, string_table); 131 with wb_meta (W2, core) and script_lsp (W3, extended;
    // DEC-063); 144 with the 13 tools of waves W4, W5 and W6 at tier extended (wb_anim,
    // wb_anim_debug, animation_workspace, animation_set, procanim, audio, particle, navmesh,
    // wb_audio, wb_particle, wb_navmesh, wb_world_tools, wb_shape); 150 with the six tools of waves
    // W7 and W8 (DEC-075, DEC-076: wb_terrain_edit, wb_generator, wb_settings, wb_link, wb_diag,
    // wb_menu). Registered means reachable from server.ts. A tool file written
    // but not yet wired in has a registerTool call the AST and the text search see; it is listed as
    // unreachable and is not a registered tool, so the calls are 150 plus those (none today).
    it("reproduces the 150 tools the server registers, three ways", () => {
      const unwired = model.audit.unreachable.length;
      expect(model.audit.reachable).toBe(150);
      expect(model.audit.distinctNames).toBe(150);
      expect(model.audit.astCalls).toBe(150 + unwired);
      expect(model.audit.textMatchesInTools + model.audit.textMatchesElsewhere).toBe(150 + unwired);
      expect(model.audit.conditional).toEqual([]);
      const serverText = readFileSync(join(REPO_ROOT, "src", "server.ts"), "utf-8");
      for (const u of model.audit.unreachable) {
        const m = /^(\w+) \(src\/tools\/([\w-]+)\.ts:\d+\)$/.exec(u);
        expect(m, u).not.toBeNull();
        const [, name, file] = m as RegExpExecArray;
        expect(serverText, `${file}.ts is imported by server.ts`).not.toContain(
          `./tools/${file}.js`,
        );
        expect(model.tools.map((t) => t.name)).not.toContain(name);
      }
      expect(model.audit.unresolvedNames).toEqual([]);
      expect(model.audit.duplicateNames).toEqual([]);
      expect(model.audit.legacyToolCalls).toBe(0);
      expect(model.tools).toHaveLength(150);
      expect(emitted.rows.filter((r) => r.obs.kind === "mcp-tool")).toHaveLength(150);
    });

    // 24 dispatch parameters / 110 actions: wb_scripts (3, literal enum), wb_module (8), wb_plugin
    // (5) and wb_container (9); the last three are read from their contracts because their request
    // schema is generated and the file holds no literal enum. 93 tools without one get "run".
    // Handlers 24 = 20 + EMCP_WB_Module, EMCP_WB_Container, EMCP_WB_Plugin, EMCP_WB_Info;
    // wb_bi (4) and wb_gui (7) add 2 parameters and 11 actions (24/110 -> 26/121) from the
    // file's `const ACTIONS = [...]` passed to z.enum(ACTIONS); the run count stays 93.
    // wb_cli_run's `verb` became an enum of 7 (DEC-056 ruling 12): 27/128, run 92.
    // dispatched 91 = 69 + 22 (Module 8, Plugin 5, Container 9); Info adds one "run" (10 = 9 + 1).
    // Wave W1 (DEC-061): 31 parameters, 181 actions. wb_entity (12), wb_view (9) and wb_world (9)
    // are new contract tools; wb_layers, wb_terrain and wb_prefabs now read their contracts (10, 3
    // and 9 actions) plus the 1.x names they keep (LEGACY_*ACTIONS: 5, 2 and 2). Handlers 27 = 24
    // + EMCP_WB_Entity, EMCP_WB_View, EMCP_WB_World; dispatched 127: EMCP_WB_Terrain keeps the 1.x
    // terrain_* actions (inspect, and the two placeholders navmesh_status and road_export_graph;
    // wb_terrain leaves them out through OTHER_TOOL_ACTIONS).
    // Session 023: the six offline tools add 6 parameters and 45 actions (37/226, run still 92);
    // OD-1 removes the 1.x EMCP_WB_GetEntity and EMCP_WB_ListEntities (no caller left): handlers
    // 25, their two synthetic "run" actions gone (8), dispatched still 127.
    // Waves W2 and W3 (DEC-063): wb_meta (6) and script_lsp (7) add 2 parameters; wb_resources
    // (11 contract + browse, getInfo, open), wb_validate (3), wb_script_editor (10 + 4 1.x names)
    // and wb_localization (13 + 3 1.x names) now read their contracts: 39/268, run still 92.
    // Handlers 27 = 25 + EMCP_WB_Meta, EMCP_WB_Validate; dispatched 154 = 127 + Resources 7
    // (11 - 4 retired 1.x) + Meta 6 + Validate 3 + ScriptEditor 3 (10 - 7) + Localization 8 (13 - 5).
    // Waves W4, W5 and W6: 13 new tools add 13 parameters and 123 actions (wb_anim 6, wb_anim_debug
    // 6, animation_workspace 6, animation_set 8, procanim 5, audio 26, particle 17, navmesh 6 read
    // from its NAVMESH_INPUT_SCHEMA const, wb_audio 17, wb_particle 7, wb_navmesh 6, wb_world_tools
    // 8, wb_shape 5); animation_graph +3 (edit, nodes, validate), behavior_tree +1 (diff) and
    // wb_cli_run +1 (navmeshBake): 52/396, run still 92 (particle_inspect and
    // terrain_navmesh_status stay "run" aliases). Handlers 34 = 27 + Anim, AnimDebug, Audio,
    // Particle, Navmesh, WorldTools, Shape; dispatched 209 = 154 + 6 + 6 + 17 + 7 + 6 + 8 + 5.
    // Waves W7 and W8: 6 new tools add 6 parameters and 35 actions (wb_terrain_edit 8,
    // wb_generator 6, wb_settings 9, wb_link 4, wb_diag 5, wb_menu 3); wb_gui +5 (read, context,
    // toggle, select, dismiss) and wb_shape +1 (edit): 58/437, run still 92 (wb_execute_action is
    // now an alias of wb_menu run, terrain_road_export_graph a composition; both stay "run").
    // Handlers 37 = 34 + TerrainEdit, Generator, Diag; dispatched 229 = 209 + 8 + 6 + 5 + 1.
    it("finds 58 dispatch parameters (437 actions), 92 run actions and 37 handlers with 229 dispatched actions", () => {
      const withParam = model.tools.filter((t) => t.param);
      expect(withParam).toHaveLength(58);
      expect(withParam.reduce((n, t) => n + (t.param?.values.length ?? 0), 0)).toBe(437);
      expect(model.tools.filter((t) => !t.param)).toHaveLength(92);
      expect(
        withParam
          .filter((t) => t.param?.name !== "action")
          .map((t) => `${t.name}.${t.param?.name}`),
      ).toEqual(["project_validate.scope", "wb_cli_run.verb"]);
      expect(model.handlers).toHaveLength(37);
      const acts = model.handlers.flatMap((h) => h.actions);
      expect(acts.filter((a) => !a.synthetic)).toHaveLength(229);
      expect(acts.filter((a) => a.synthetic)).toHaveLength(8);
      expect(acts.filter((a) => a.placeholder)).toHaveLength(2);
      const kinds: Record<string, number> = {};
      for (const r of emitted.rows) kinds[r.obs.kind] = (kinds[r.obs.kind] ?? 0) + 1;
      // handler-action 237 = 229 + 8 run; mcp-action 529 = 437 + 92 run; mcp-tool 150
      expect(kinds).toEqual({ "handler-action": 237, "mcp-action": 529, "mcp-tool": 150 });
      expect(emitted.leftOut).toEqual([]);
    });

    it("finds no action sent to a handler that does not dispatch it, and seven actions on built-in handlers", () => {
      // The W1 EMCP_WB_Terrain dispatches the 1.x terrain_inspect, terrain_navmesh_status and
      // terrain_road_export_graph actions again, with their world_path key.
      expect(model.mismatches).toEqual([]);
      expect(model.requestKeyMismatches).toEqual([]);
      for (const [tool, action] of [
        ["terrain_inspect", "inspect"],
        ["terrain_navmesh_status", "navmesh_status"],
        ["terrain_road_export_graph", "road_export_graph"],
      ]) {
        expect(
          model.handlers
            .find((h) => h.cls === "EMCP_WB_Terrain")
            ?.actions.some((a) => a.action === action),
          `${tool} -> ${action}`,
        ).toBe(true);
      }
      // wb_validate left Bohemia's TextureValidator for EMCP_WB_Validate (W2 OD-7). wb_resources keeps
      // getInfo on GetResourceInfo; E11 reads a 1.x name (LEGACY_ACTIONS: browse, open) the way a
      // plain tool's actions are read, so the one GetResourceInfo call site counts for them too.
      expect([...new Set(model.builtin.map((b) => `${b.tool}.${b.action}`))].sort()).toEqual([
        "wb_prefabs.getGuid",
        "wb_prefabs.locate",
        "wb_projects.list",
        "wb_projects.locate",
        "wb_resources.browse",
        "wb_resources.getInfo",
        "wb_resources.open",
      ]);
    });

    it("lists the request keys each of the seven built-in handler actions sends (for the E04 comparison)", () => {
      const sent = model.builtin
        .map((b) => `${b.tool}.${b.action} -> ${b.handler}(${b.requestKeys.join(",")})`)
        .sort();
      expect(sent).toEqual([
        "wb_prefabs.getGuid -> GetPrefabGUID(prefabPath)",
        "wb_prefabs.locate -> LocatePrefabsFromPath(projectPath,selectedFolder,selectedProject)",
        "wb_prefabs.locate -> LocateProject(path)",
        "wb_projects.list -> GetLoadedProjects()",
        "wb_projects.locate -> LocateProject(path)",
        "wb_resources.browse -> GetResourceInfo(expandResource,path)",
        "wb_resources.getInfo -> GetResourceInfo(expandResource,path)",
        "wb_resources.open -> GetResourceInfo(expandResource,path)",
      ]);
      // the audit file carries the same list, grouped by action, with the call-site ref
      const audit = JSON.parse(
        auditText(model, headline(model), "x", true, { ids: new Set(), files: [] }),
      ) as {
        builtin_handler_calls: {
          action: string;
          calls: { handler: string; request_keys: string[]; ref: string }[];
        }[];
        builtin_request_key_check: { e04_observation_present: boolean };
      };
      expect(audit.builtin_handler_calls.map((c) => c.action)).toEqual([
        "wb_prefabs.getGuid",
        "wb_prefabs.locate",
        "wb_projects.list",
        "wb_projects.locate",
        "wb_resources.browse",
        "wb_resources.getInfo",
        "wb_resources.open",
      ]);
      expect(audit.builtin_request_key_check.e04_observation_present).toBe(false);
      // every ref names the line of a client.call to that handler
      for (const c of audit.builtin_handler_calls.flatMap((a) => a.calls)) {
        const m = /^(.+)#L(\d+)$/.exec(c.ref) as RegExpExecArray;
        const text = readFileSync(join(REPO_ROOT, m[1]), "utf-8").split(/\r?\n/);
        expect(text[Number(m[2]) - 1], c.ref).toContain(`"${c.handler}"`);
      }
    });

    it("gives every row a ref whose line holds the literal, a verbatim quote and no machine path", () => {
      const cache = new Map<string, string[]>();
      const lines = (rel: string): string[] => {
        let l = cache.get(rel);
        if (!l) {
          l = readFileSync(join(REPO_ROOT, rel), "utf-8").split(/\r?\n/);
          cache.set(rel, l);
        }
        return l;
      };
      for (const r of emitted.rows) {
        const m = /^<repo>\/(.+)#L(\d+)$/.exec(r.obs.ref) as RegExpExecArray;
        const line = lines(m[1])[Number(m[2]) - 1];
        expect(line, r.id).toContain(r.obs.quote as string);
        const k = r.obs.key as Record<string, string>;
        if (r.obs.kind !== "mcp-tool" && k.action !== "run")
          expect(line, r.id).toContain(`"${k.action}"`);
        if (r.obs.kind === "mcp-tool") expect(line, r.id).toContain(`"${k.tool}"`);
        expect(containsMachinePath(JSON.stringify(r.obs)), r.id).toBe(false);
      }
    });

    it("keeps wb_projects.open off every handler (it sends nothing) and the early-return tools off built-ins", () => {
      const at = (t: string, a: string) =>
        model.toolActions.find((x) => x.tool === t && x.value === a);
      // live-tools-b-3: open refuses without a call; the NET API cannot
      // switch a running Workbench's project.
      expect(at("wb_projects", "open")?.links).toEqual([]);
      expect(at("wb_resources", "register")?.links).toEqual([
        { handler: "EMCP_WB_Resources", action: "register" },
      ]);
      expect(at("wb_resources", "getInfo")?.links).toEqual([]);
      expect(at("wb_prefabs", "save")?.links).toEqual([
        { handler: "EMCP_WB_Prefabs", action: "save" },
      ]);
      // wb_save and wb_open_resource are 1.x aliases: they call runAliasViaModule(client, "<alias>",
      // ...) and ALIAS_ROUTES (src/manifest/aliases.ts) routes them to wb_module, whose handler is
      // EMCP_WB_Module. E11 resolves that table, so the links are the routed actions.
      expect(at("wb_save", "run")?.links).toEqual([{ handler: "EMCP_WB_Module", action: "save" }]);
      expect(at("wb_open_resource", "run")?.links).toEqual([
        { handler: "EMCP_WB_Module", action: "setResource" },
      ]);
      // The 1.x entity aliases (OD-1): one route each, or several for a mapper that routes per
      // 1.x action (every action of that tool then links to all of them).
      expect(at("wb_entity_delete", "run")?.links).toEqual([
        { handler: "EMCP_WB_Entity", action: "delete" },
      ]);
      expect(at("wb_entity_create", "run")?.links).toEqual([
        { handler: "EMCP_WB_Entity", action: "create" },
      ]);
      expect(
        (at("wb_entity_select", "select")?.links ?? [])
          .map((l) => `${l.handler}.${l.action}`)
          .sort(),
      ).toEqual(["EMCP_WB_View.select", "EMCP_WB_View.selection"]);
      // wb_prefabs keeps two 1.x actions on Bohemia's handlers beside its contract (LEGACY_BI_ACTIONS).
      expect(at("wb_prefabs", "getGuid")?.links).toEqual([]);
      // aliases routed to wb_scripts (natives, no handler) add no link
      expect(at("wb_reload", "run")?.links).toEqual([]);
      expect(at("wb_validate_scripts", "run")?.links).toEqual([]);
    });

    it("derives tool and action modules from the handlers each tool calls", () => {
      const tools = emitted.rows.filter((r) => r.obs.kind === "mcp-tool");
      const byModule: Record<string, number> = {};
      for (const r of tools) byModule[r.obs.module] = (byModule[r.obs.module] ?? 0) + 1;
      // 117 tools: WorldEditor 24 (+1: wb_module), none 90 (+3: wb_scripts, wb_plugin and
      // wb_container reach no module their source states; +2 more: wb_bi and wb_gui, which call no
      // Enforce handler of this mod by a literal name). EMCP_WB_Module's
      // GetModule(moduleType) is a variable, not a module class, so it is not read as a module.
      // wb_save and wb_open_resource reach EMCP_WB_Module through ALIAS_ROUTES, which E11 resolves,
      // so they stay WorldEditor (EMCP_WB_Module names that one class). Session 023: the six
      // offline tools of W2 and W3 call no handler, so none 101 (+6). W2 and W3 (DEC-063): the
      // rewritten EMCP_WB_Resources names ResourceManager and WorldEditor (prefabFromModel), so its
      // callers game_duplicate and wb_resources state none and wb_entity_duplicate (Prefabs and
      // Resources) states WorldEditor; EMCP_WB_Validate names ResourceManager only, so wb_validate
      // states it; wb_meta (Meta names none) and script_lsp (no handler) are none: 102.
      // Waves W4-W6: wb_anim_debug, wb_particle, wb_navmesh, wb_world_tools and wb_shape state
      // WorldEditor (31); wb_anim states ResourceManager (2); the six offline tools and wb_audio
      // (its handler names no single module) are none (109).
      // Waves W7 and W8: wb_generator and wb_menu (EMCP_WB_ExecuteAction) state WorldEditor;
      // wb_execute_action routes to wb_menu, a tool with no contract, and terrain_road_export_graph
      // now composes wb_generator and wb_shape, so both leave WorldEditor (31 = 31 + 2 - 2); the
      // other four new tools are none (wb_terrain_edit's and wb_diag's handlers name no single
      // module): 115 = 109 + 4 + 2.
      // DEC-107 (total audit read-knowledge-06): terrain_inspect now also asks EMCP_WB_World state,
      // so like terrain_road_export_graph it leaves WorldEditor: 30 and 116.
      expect(byModule).toEqual({
        LocalizationEditor: 1,
        ResourceManager: 2,
        ScriptEditor: 1,
        WorldEditor: 30,
        none: 116,
      });
      const mod = (id: string) => emitted.rows.find((r) => r.id === id)?.obs.module;
      expect(mod("mcp:tool/wb_script_editor")).toBe("ScriptEditor");
      expect(mod("mcp:action/wb_script_editor.getLines")).toBe("ScriptEditor");
      expect(mod("mcp:tool/wb_localization")).toBe("LocalizationEditor");
      expect(mod("mcp:tool/wb_terrain")).toBe("WorldEditor");
      // DEC-107: terrain_inspect reaches EMCP_WB_World and EMCP_WB_Terrain, which state different
      // modules or none, so it is none like wb_entity_modify below.
      expect(mod("mcp:tool/terrain_inspect")).toBe("none");
      // The 1.x wb_entity_modify alias (OD-1) reaches EMCP_WB_Entity, EMCP_WB_View and
      // EMCP_WB_Container, which state different modules or none; its sibling aliases reach one.
      expect(mod("mcp:tool/wb_entity_modify")).toBe("none");
      expect(mod("mcp:tool/wb_entity_create")).toBe("WorldEditor");
      expect(mod("mcp:tool/wb_entity")).toBe("WorldEditor");
      expect(mod("mcp:tool/wb_view")).toBe("WorldEditor");
      expect(mod("mcp:tool/wb_layers")).toBe("WorldEditor");
      expect(mod("mcp:tool/game_duplicate")).toBe("none");
      expect(mod("mcp:tool/wb_validate")).toBe("ResourceManager");
      // built-in handler beside an EMCP handler (wb_prefabs, wb_projects, wb_resources): the
      // built-in's module is not stated
      for (const t of ["wb_prefabs", "wb_projects", "wb_resources"])
        expect(mod(`mcp:tool/${t}`), t).toBe("none");
      // Prefabs (WorldEditor) and the W2 Resources handler (no single module) leave WorldEditor
      expect(mod("mcp:tool/wb_entity_duplicate")).toBe("WorldEditor");
      // one handler that names several modules
      expect(mod("mcp:tool/wb_reload")).toBe("none");
      // a tool that calls no handler
      expect(mod("mcp:tool/api_search")).toBe("none");
      // Check the rule against the emitted rows themselves, not against the code that applied it:
      // a tool has a module exactly when every handler it calls is a handler-action row of that module.
      const handlerModules = new Map<string, Set<string>>();
      for (const r of emitted.rows.filter((x) => x.obs.kind === "handler-action")) {
        const h = (r.obs.key as { handler: string }).handler;
        handlerModules.set(h, (handlerModules.get(h) ?? new Set()).add(r.obs.module));
      }
      for (const t of model.tools) {
        // call sites plus the handlers reached through the alias route table
        const calls = [
          ...t.calls,
          ...t.aliasLinks.map((l) => ({ handler: l.handler, builtin: false })),
        ];
        const stated =
          calls.length > 0 &&
          calls.every((c) => !c.builtin && handlerModules.get(c.handler)?.size === 1);
        const reached = new Set(calls.map((c) => [...(handlerModules.get(c.handler) ?? [])][0]));
        const expected = stated && reached.size === 1 ? [...reached][0] : "none";
        expect(mod(`mcp:tool/${t.name}`), t.name).toBe(expected);
      }
      for (const r of emitted.rows.filter((x) => x.obs.kind === "mcp-action"))
        expect(r.obs.module, r.id).toBe(mod(`mcp:tool/${(r.obs.key as { tool: string }).tool}`));
    });

    it("takes handler modules from GetModule calls and keeps caveat comments out of what", () => {
      const row = (id: string) => emitted.rows.find((r) => r.id === id)?.obs;
      expect(row("mcp:handler-action/EMCP_WB_Clipboard.copy")?.module).toBe("WorldEditor");
      expect(row("mcp:handler-action/EMCP_WB_EditorControl.play")?.module).toBe("WorldEditor");
      expect(row("mcp:handler-action/EMCP_WB_ScriptEditor.getLines")?.module).toBe("ScriptEditor");
      expect(row("mcp:handler-action/EMCP_WB_Localization.list")?.module).toBe(
        "LocalizationEditor",
      );
      expect(row("mcp:handler-action/EMCP_WB_Validate.material")?.module).toBe("ResourceManager");
      // the W2 Resources handler names ResourceManager and WorldEditor: no single one
      expect(row("mcp:handler-action/EMCP_WB_Resources.search")?.module).toBe("none");
      // Reload names three modules: no single one
      expect(row("mcp:handler-action/EMCP_WB_Reload.run")?.module).toBe("none");
      for (const id of [
        "EMCP_WB_EditorControl.play",
        "EMCP_WB_EditorControl.stop",
        "EMCP_WB_EditorControl.saveAs",
        "EMCP_WB_Resources.browse",
        "EMCP_WB_Resources.rebuild",
        "EMCP_WB_Clipboard.hasCopied",
        "EMCP_WB_Terrain.navmesh_bake",
      ])
        expect(row(`mcp:handler-action/${id}`)?.what, id).toBeUndefined();
    });

    it("is deterministic over the real source", () => {
      const again = emitRows(buildModel(readRepoSources(REPO_ROOT)), { modules: true });
      expect(observationFileText(again.rows, [], "x")).toBe(
        observationFileText(emitted.rows, [], "x"),
      );
    });
  },
);

describe("E11 risk hints from the registration's annotations", () => {
  it("reads readOnlyHint into safe, contract mutating flags per action, and nothing otherwise", () => {
    expect(toolRiskHint({ annotations: { readOnly: true } })).toBe("safe");
    expect(toolRiskHint({ annotations: { readOnly: false, destructive: true } })).toBe("mutating");
    expect(toolRiskHint({})).toBeUndefined();
    const ro = { annotations: { readOnly: true }, actionMutating: { set: true } };
    expect(actionRiskHint(ro, "set", false)).toBe("safe");
    const c = { annotations: { readOnly: false }, actionMutating: { get: false, set: true } };
    expect(actionRiskHint(c, "get", false)).toBe("safe");
    expect(actionRiskHint(c, "set", false)).toBe("mutating");
    expect(actionRiskHint(c, "legacyName", false)).toBeUndefined();
    expect(actionRiskHint({ annotations: { readOnly: false } }, "run", true)).toBe("mutating");
    expect(actionRiskHint({}, "run", true)).toBeUndefined();
  });

  it.skipIf(!existsSync(join(REPO_ROOT, "src", "tools", "wb-census.ts")))(
    "marks the read-only wb_census tool and its actions safe on the real repository",
    () => {
      const model = scanTools(readRepoSources(REPO_ROOT));
      const t = model.tools.find((x) => x.name === "wb_census");
      expect(t?.annotations).toEqual({ readOnly: true, destructive: false });
      const gui = model.tools.find((x) => x.name === "wb_gui");
      expect(gui?.annotations).toEqual({ readOnly: false, destructive: false });
      const diag = model.tools.find((x) => x.name === "wb_diag");
      expect(diag?.actionMutating?.get).toBe(false);
      expect(diag?.actionMutating?.set).toBe(true);
    },
  );
});
