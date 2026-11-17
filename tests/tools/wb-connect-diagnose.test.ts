import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWbConnect } from "../../src/tools/wb-connect.js";
import { formatNativeSection, registerWbDiagnose } from "../../src/tools/wb-diagnose.js";
import type { NativeReadiness } from "../../src/tools/wb-scripts.js";
import {
  WorkbenchError,
  type BuildStampCheck,
  type WorkbenchClient,
} from "../../src/workbench/client.js";

type Result = { content: { text: string }[]; isError?: boolean };
type Def = { description: string; annotations: Record<string, unknown> };

function capture(register: (s: McpServer) => void) {
  const tools: Record<string, { def: Def; handler: (a: unknown) => Promise<Result> }> = {};
  register({
    registerTool: (name: string, def: Def, handler: never) => {
      tools[name] = { def, handler };
    },
  } as unknown as McpServer);
  return tools;
}

function fakeClient(over: {
  refused?: boolean;
  handlers?: boolean;
  compiled?: boolean | null;
  stamp?: BuildStampCheck;
  standalone?: boolean;
}) {
  const sent: string[] = [];
  const c = {
    sent,
    state: { connected: true, mode: "edit", lastUpdated: 0 },
    lastBuildCheck: null as BuildStampCheck | null,
    holdsLease: () => true,
    queue: { inFlight: () => null, depth: 0 },
    async probe(fn: string) {
      sent.push(`probe:${fn}`);
      if (fn === "EMCP_WB_Ping") return { status: "ok", mode: "edit", message: "ready" };
      if (over.refused) throw new WorkbenchError("refused", "CONNECTION_REFUSED");
      return over.compiled === null ? {} : { ScriptsCompiled: over.compiled ?? true };
    },
    async ping() {
      if (over.handlers === false) return false;
      c.lastBuildCheck = over.stamp ?? { status: "match", stamp: "aaaa", bundle: "aaaa" };
      return true;
    },
    async call(fn: string) {
      sent.push(`call:${fn}`);
      return { status: "ok", mode: "edit", message: "ready" };
    },
    async diagnose() {
      return {
        host: "127.0.0.1",
        port: 5775,
        workbenchExe: null,
        projectPath: null,
        defaultMod: null,
        bundledScripts: { path: "<bundle>", exists: true },
        standaloneAddon: { path: "<addon>", exists: over.standalone ?? false, fileCount: 0 },
        installedMods: over.standalone ? [{ fileCount: 3, handlerDir: "<mod>/Scripts" }] : [],
        netApi: over.refused ? "refused" : "up_with_handlers",
        netApiError: over.refused ? "refused" : undefined,
        lease: null,
        noAutolaunch: null,
      };
    },
  };
  return c;
}

describe("wb_connect reports native readiness", () => {
  it("running, compiled, handlers answering, stamp match", async () => {
    const c = fakeClient({});
    const t = capture((s) => registerWbConnect(s, c as unknown as WorkbenchClient));
    const res = await t.wb_connect.handler({});
    const text = res.content[0].text;
    expect(res.isError).toBeUndefined();
    expect(text).toContain("native IsWorkbenchRunning answered");
    expect(text).toContain("ScriptsCompiled:** true");
    expect(text).toContain("EMCP_WB_Ping answers");
    expect(text).toContain("Build stamp:** match");
    expect(c.sent[0]).toBe("probe:IsWorkbenchRunning");
    // The mode detail is a lease-free probe, never call() (B-5).
    expect(c.sent).toContain("probe:EMCP_WB_Ping");
    expect(c.sent.some((x) => x.startsWith("call:"))).toBe(false);
  });

  it("a stamp mismatch is shown with its warning", async () => {
    const c = fakeClient({
      stamp: {
        status: "mismatch",
        stamp: "bbbb",
        bundle: "aaaa",
        warning: "loaded handlers differ",
      },
    });
    const t = capture((s) => registerWbConnect(s, c as unknown as WorkbenchClient));
    const text = (await t.wb_connect.handler({})).content[0].text;
    expect(text).toContain("Build stamp:** mismatch");
    expect(text).toContain("loaded handlers differ");
  });

  it("natively running but handlers silent: reported, with no handler call made", async () => {
    const c = fakeClient({ handlers: false, compiled: false });
    const t = capture((s) => registerWbConnect(s, c as unknown as WorkbenchClient));
    const res = await t.wb_connect.handler({});
    expect(res.content[0].text).toContain("NOT loaded");
    expect(res.content[0].text).toContain("scripts are not compiled");
    expect(c.sent.some((s) => s.startsWith("call:"))).toBe(false);
  });

  it("not running is a connection failure", async () => {
    const c = fakeClient({ refused: true });
    const t = capture((s) => registerWbConnect(s, c as unknown as WorkbenchClient));
    const res = await t.wb_connect.handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Connection Failed");
  });

  it("is annotated read-only with a Read: line within 400 characters", () => {
    const t = capture((s) => registerWbConnect(s, fakeClient({}) as unknown as WorkbenchClient));
    expect(t.wb_connect.def.annotations.readOnlyHint).toBe(true);
    expect(t.wb_connect.def.description).toContain("Read:");
    expect(t.wb_connect.def.description.length).toBeLessThanOrEqual(400);
  });
});

describe("wb_diagnose standalone-addon hint", () => {
  // Phase-7 audit live-client-01: wb_launch keeps a standalone addon that
  // holds anything beyond the generated 1.x files, so the hint must not
  // promise an automatic cleanup.
  it("says wb_launch removes only an untouched generated addon", async () => {
    const c = fakeClient({ standalone: true });
    const t = capture((s) => registerWbDiagnose(s, c as unknown as WorkbenchClient));
    const text = (await t.wb_diagnose.handler({})).content[0].text;
    expect(text).toContain("only while it holds just the generated 1.x files");
    expect(text).not.toContain("clean up the standalone addon automatically");
  });
});

describe("wb_diagnose reports native readiness", () => {
  it("includes ScriptsCompiled and the stamp in the NET API section", async () => {
    const c = fakeClient({});
    const t = capture((s) => registerWbDiagnose(s, c as unknown as WorkbenchClient));
    const text = (await t.wb_diagnose.handler({})).content[0].text;
    expect(text).toContain("RUNNING — IsWorkbenchRunning answered");
    expect(text).toContain("ScriptsCompiled:** true");
    expect(text).toContain("Build stamp:** match");
  });

  it("is annotated read-only with a Read: line within 400 characters", () => {
    const t = capture((s) => registerWbDiagnose(s, fakeClient({}) as unknown as WorkbenchClient));
    expect(t.wb_diagnose.def.annotations.readOnlyHint).toBe(true);
    expect(t.wb_diagnose.def.description).toContain("Read:");
    expect(t.wb_diagnose.def.description.length).toBeLessThanOrEqual(400);
  });

  it("formatNativeSection covers not running, no handlers and a probe failure", () => {
    const base: NativeReadiness = {
      running: false,
      scriptsCompiled: null,
      handlersAnswer: false,
      buildStamp: null,
    };
    expect(formatNativeSection(base).join("\n")).toContain("NOT RUNNING");
    expect(
      formatNativeSection({ ...base, running: true, scriptsCompiled: true }).join("\n"),
    ).toContain("NOT LOADED");
    expect(
      formatNativeSection({
        ...base,
        running: null,
        error: { code: "WEDGED", message: "no answer" },
      }).join("\n"),
    ).toContain("WEDGED");
  });
});
