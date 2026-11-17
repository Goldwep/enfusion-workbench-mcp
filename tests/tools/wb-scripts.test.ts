import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CONFIGURATIONS,
  WB_SCRIPTS_DESCRIPTION,
  pendingMutatingCall,
  readNativeReadiness,
  registerWbScripts,
  runScripts,
  type ScriptsClient,
  type ScriptsResponse,
} from "../../src/tools/wb-scripts.js";
import { registerWbReload } from "../../src/tools/wb-reload.js";
import {
  WorkbenchError,
  type BuildStampCheck,
  type WorkbenchClient,
} from "../../src/workbench/client.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  access: string | undefined;
  via: "call" | "probe";
}

/** A fake client: scripted native answers, a settable in-flight label, a settable ping stamp. */
class FakeClient {
  sent: Sent[] = [];
  inFlightLabel: string | null = null;
  refused = false;
  scriptsCompiled: boolean | null = true;
  pingAnswers = true;
  stamps: Array<string | null> = ["aaaa"];
  private pingNo = 0;
  lastBuildCheck: BuildStampCheck | null = null;
  answers: Record<string, unknown | Error> = {};
  worldEditor: unknown = { IsRunning: false, ScriptsCompiled: true };

  queue = {
    depth: 0,
    inFlight: () =>
      this.inFlightLabel ? { label: this.inFlightLabel, ageMs: 5, wedged: false } : null,
  };

  private answer(fn: string): unknown {
    const a = this.answers[fn];
    if (a instanceof Error) throw a;
    return a ?? {};
  }

  async probe(fn: string, params: Record<string, unknown> = {}, o: { access?: string } = {}) {
    this.sent.push({ fn, params, access: o.access, via: "probe" });
    if (this.refused) throw new WorkbenchError("refused", "CONNECTION_REFUSED");
    if (fn === "IsWorldEditorRunning") {
      if (this.worldEditor instanceof Error) throw this.worldEditor;
      return this.worldEditor;
    }
    if (fn === "IsWorkbenchRunning") {
      return this.scriptsCompiled === null ? {} : { ScriptsCompiled: this.scriptsCompiled };
    }
    return this.answer(fn);
  }

  async call(fn: string, params: Record<string, unknown> = {}, o: { access?: string } = {}) {
    this.sent.push({ fn, params, access: o.access, via: "call" });
    return this.answer(fn);
  }

  async ping(): Promise<boolean> {
    if (!this.pingAnswers) return false;
    const stamp = this.stamps[Math.min(this.pingNo++, this.stamps.length - 1)];
    this.lastBuildCheck = { status: stamp ? "match" : "absent", stamp, bundle: "aaaa" };
    return true;
  }

  asClient(): ScriptsClient {
    return this as unknown as ScriptsClient;
  }
}

const readbackOf = (r: ScriptsResponse) => (r as { readback: Record<string, unknown> }).readback;

describe("wb_scripts status", () => {
  it("reports running, ScriptsCompiled and the build stamp match, read-only", async () => {
    const c = new FakeClient();
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(r.ok).toBe(true);
    expect(readbackOf(r)).toMatchObject({
      running: true,
      scriptsCompiled: true,
      handlersAnswer: true,
      buildStamp: { status: "match", stamp: "aaaa" },
    });
    expect(c.sent).toEqual([
      { fn: "IsWorkbenchRunning", params: {}, access: "read", via: "probe" },
      { fn: "IsWorldEditorRunning", params: {}, access: "read", via: "probe" },
    ]);
  });

  it("carries worldEditorRunning from IsWorldEditorRunning", async () => {
    const c = new FakeClient();
    c.worldEditor = { IsRunning: true, ScriptsCompiled: true };
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(readbackOf(r)).toMatchObject({ running: true, worldEditorRunning: true });
    c.worldEditor = { IsRunning: false };
    expect(readbackOf(await runScripts(c.asClient(), { action: "status" }))).toMatchObject({
      worldEditorRunning: false,
    });
  });

  it("an older kernel without the native: worldEditorRunning null, status ok, with a warning", async () => {
    const c = new FakeClient();
    c.worldEditor = new WorkbenchError("Undefined API func", "API_ERROR");
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(r.ok).toBe(true);
    expect(readbackOf(r)).toMatchObject({ running: true, worldEditorRunning: null });
    expect(r.warnings.join(" ")).toMatch(/IsWorldEditorRunning is unavailable/);
  });

  it("any other failure of the native also leaves it unknown without failing status", async () => {
    const c = new FakeClient();
    c.worldEditor = new WorkbenchError("lost", "LOST");
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(r.ok).toBe(true);
    expect(readbackOf(r)).toMatchObject({ worldEditorRunning: null });
    expect(r.warnings.join(" ")).toMatch(/IsWorldEditorRunning failed/);
  });

  it("an answer without IsRunning is unknown with a warning", async () => {
    const c = new FakeClient();
    c.worldEditor = {};
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(readbackOf(r)).toMatchObject({ worldEditorRunning: null });
    expect(r.warnings.join(" ")).toMatch(/without an IsRunning/);
  });

  it("is not asked when Workbench is not running", async () => {
    const c = new FakeClient();
    c.refused = true;
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(readbackOf(r)).toMatchObject({ worldEditorRunning: null });
    expect(c.sent.map((s) => s.fn)).toEqual(["IsWorkbenchRunning"]);
  });

  it("a refused connection is running: false with a next, not an error", async () => {
    const c = new FakeClient();
    c.refused = true;
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(r.ok).toBe(true);
    expect(readbackOf(r)).toMatchObject({ running: false, handlersAnswer: false });
    expect((r as { next?: string }).next).toContain("wb_launch");
  });

  it("warns when scripts are not compiled or the handlers do not answer", async () => {
    const c = new FakeClient();
    c.scriptsCompiled = false;
    c.pingAnswers = false;
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/ScriptsCompiled is false/);
    expect(r.warnings.join(" ")).toMatch(/handlers are not loaded/);
  });

  it("a modal on the probe is MODAL_OPEN", async () => {
    const c = new FakeClient();
    c.probe = async () => {
      throw new WorkbenchError("modal", "MODAL_OPEN");
    };
    const r = await runScripts(c.asClient(), { action: "status" });
    expect(r).toMatchObject({ ok: false, code: "MODAL_OPEN" });
  });
});

describe("wb_scripts validate", () => {
  it("sends ValidateScripts with the configuration, defaulting to WORKBENCH, access read", async () => {
    const c = new FakeClient();
    c.answers.ValidateScripts = { Success: true, Errors: 0, Warnings: 2 };
    const r = await runScripts(c.asClient(), { action: "validate" });
    expect(r.ok).toBe(true);
    expect(readbackOf(r)).toEqual({
      configuration: "WORKBENCH",
      success: true,
      errors: 0,
      warnings: 2,
    });
    const v = c.sent.find((s) => s.fn === "ValidateScripts");
    expect(v).toMatchObject({ params: { Configuration: "WORKBENCH" }, access: "read" });
    await runScripts(c.asClient(), { action: "validate", configuration: "PC" });
    expect(c.sent.filter((s) => s.fn === "ValidateScripts")[1].params).toEqual({
      Configuration: "PC",
    });
  });

  it("only WORKBENCH and PC are configurations (HEADLESS answers 'unknown configuration')", () => {
    expect([...CONFIGURATIONS]).toEqual(["WORKBENCH", "PC"]);
  });

  it("errors in the answer are VALIDATION_FAILED with the counts", async () => {
    const c = new FakeClient();
    c.answers.ValidateScripts = { Success: false, Errors: 3, Warnings: 0 };
    const r = await runScripts(c.asClient(), { action: "validate", configuration: "PC" });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(readbackOf(r)).toMatchObject({ success: false, errors: 3 });
  });

  it("says a pass is not a handler compile gate", async () => {
    const c = new FakeClient();
    c.answers.ValidateScripts = { Success: true, Errors: 0, Warnings: 0 };
    const r = await runScripts(c.asClient(), { action: "validate" });
    expect(r.warnings.join(" ")).toMatch(/not a handler compile gate/);
  });

  it("sends nothing when Workbench is not running", async () => {
    const c = new FakeClient();
    c.refused = true;
    const r = await runScripts(c.asClient(), { action: "validate" });
    expect(r).toMatchObject({ ok: false, code: "UNREACHABLE" });
    expect(c.sent.some((s) => s.fn === "ValidateScripts")).toBe(false);
  });

  it("a LOST validate reports LOST", async () => {
    const c = new FakeClient();
    c.answers.ValidateScripts = new WorkbenchError("lost", "LOST");
    const r = await runScripts(c.asClient(), { action: "validate" });
    expect(r).toMatchObject({ ok: false, code: "LOST" });
  });
});

describe("wb_scripts reload", () => {
  it("reloads, re-pings, and reports the build stamp that changed", async () => {
    const c = new FakeClient();
    c.stamps = ["aaaa", "bbbb"];
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r.ok).toBe(true);
    expect((r as { changed: unknown }).changed).toEqual([
      { path: "buildStamp", before: "aaaa", after: "bbbb" },
    ]);
    const order = c.sent.map((s) => s.fn);
    expect(order).toContain("ReloadScripts");
    const reload = c.sent.find((s) => s.fn === "ReloadScripts");
    expect(reload).toMatchObject({ params: {}, access: "mutate", via: "call" });
    // The re-ping comes after the reload: the readback carries the second stamp.
    expect(readbackOf(r)).toMatchObject({ handlersAnswer: true, buildStamp: { stamp: "bbbb" } });
  });

  it("is refused while a mutating call is pending and sends nothing", async () => {
    const c = new FakeClient();
    c.inFlightLabel = "EMCP_WB_ModifyEntity";
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r).toMatchObject({ ok: false, code: "BUSY" });
    expect(c.sent).toEqual([]);
  });

  it("a read-only call in flight does not block it", async () => {
    const c = new FakeClient();
    c.inFlightLabel = "IsWorkbenchRunning";
    expect(pendingMutatingCall(c as unknown as Pick<WorkbenchClient, "queue">)).toBeNull();
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r.ok).toBe(true);
  });

  it("a call waiting behind a read-only one counts as pending (queue depth)", async () => {
    const c = new FakeClient();
    c.inFlightLabel = "IsWorkbenchRunning";
    c.queue.depth = 1;
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r).toMatchObject({ ok: false, code: "BUSY" });
    expect(c.sent).toEqual([]);
  });

  it("an unclassified call in flight counts as mutating", () => {
    const c = new FakeClient();
    c.inFlightLabel = "SomethingNew";
    expect(pendingMutatingCall(c as unknown as Pick<WorkbenchClient, "queue">)).toBe(
      "SomethingNew",
    );
  });

  it("a failed reload (Compilation failed) keeps the old handlers and says so", async () => {
    const c = new FakeClient();
    c.answers.ReloadScripts = new WorkbenchError("Compilation failed", "API_ERROR");
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r).toMatchObject({ ok: false, code: "RELOAD_FAILED" });
    expect(r.warnings.join(" ")).toMatch(/old handlers still answer Ping/);
    expect(readbackOf(r)).toMatchObject({ handlersAnswer: true });
  });

  it("a LOST reload is reported as LOST, never retried, and re-pinged", async () => {
    const c = new FakeClient();
    c.answers.ReloadScripts = new WorkbenchError("lost", "LOST");
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r).toMatchObject({ ok: false, code: "LOST" });
    expect(c.sent.filter((s) => s.fn === "ReloadScripts")).toHaveLength(1);
    expect(readbackOf(r)).toBeDefined();
  });

  it("plugin and both scopes have no native and are refused", async () => {
    const c = new FakeClient();
    for (const scope of ["plugins", "both"]) {
      const r = await runScripts(c.asClient(), { action: "reload", scope });
      expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    }
    expect(c.sent).toEqual([]);
  });

  it("not running: nothing is sent", async () => {
    const c = new FakeClient();
    c.refused = true;
    const r = await runScripts(c.asClient(), { action: "reload" });
    expect(r).toMatchObject({ ok: false, code: "UNREACHABLE" });
    expect(c.sent.some((s) => s.fn === "ReloadScripts")).toBe(false);
  });
});

describe("readNativeReadiness", () => {
  it("is lease-free: only probe and ping, never call", async () => {
    const c = new FakeClient();
    await readNativeReadiness(c.asClient());
    expect(c.sent.every((s) => s.via === "probe")).toBe(true);
  });
});

describe("registration", () => {
  type Def = {
    description: string;
    annotations: Record<string, unknown>;
    inputSchema: Record<string, unknown>;
  };
  function capture(register: (s: McpServer) => void) {
    const tools: Record<
      string,
      {
        def: Def;
        handler: (a: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
      }
    > = {};
    register({
      registerTool: (name: string, def: Def, handler: never) => {
        tools[name] = { def, handler };
      },
    } as unknown as McpServer);
    return tools;
  }

  it("wb_scripts: description within 400 characters with Read: and Mutating: lines", () => {
    const t = capture((s) => registerWbScripts(s, new FakeClient() as unknown as WorkbenchClient));
    const d = t.wb_scripts.def.description;
    expect(d).toBe(WB_SCRIPTS_DESCRIPTION);
    expect(d.length).toBeLessThanOrEqual(400);
    expect(d).toContain("Read:");
    expect(d).toContain("Mutating:");
    expect(t.wb_scripts.def.annotations.readOnlyHint).toBe(false);
  });

  it("wb_reload forwards to wb_scripts reload; plugins is refused", async () => {
    const c = new FakeClient();
    const t = capture((s) => registerWbReload(s, c as unknown as WorkbenchClient));
    const ok = JSON.parse((await t.wb_reload.handler({ target: "scripts" })).content[0].text);
    expect(ok).toMatchObject({ ok: true, action: "reload" });
    const refused = await t.wb_reload.handler({ target: "plugins" });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text).code).toBe("INVALID_ARGUMENT");
    const d = t.wb_reload.def.description;
    expect(d.length).toBeLessThanOrEqual(400);
    expect(d).toContain("Mutating:");
  });
});
