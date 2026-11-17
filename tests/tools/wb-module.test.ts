import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WorkbenchError } from "../../src/workbench/client.js";
import {
  HANDLER,
  WB_MODULE_INPUT,
  buildWireRequest,
  moduleContract,
  owningModule,
  registerWbModule,
  runModule,
  wbModuleDescription,
  type ModuleArgs,
  type ModuleClient,
} from "../../src/tools/wb-module.js";
import {
  loadAllowListFile,
  opensDialog,
  type AllowListPack,
  type MenuDeps,
  type MenuItem,
} from "../../src/tools/wb-menu.js";

interface Sent {
  api: string;
  params: Record<string, unknown>;
  access?: string;
}

/** A client that records each call and answers from a queue (or throws a queued error). */
function fake(...answers: Array<Record<string, unknown> | Error>) {
  const sent: Sent[] = [];
  const client = {
    async call(api: string, params: Record<string, unknown> = {}, opts: { access?: string } = {}) {
      sent.push({ api, params, access: opts.access });
      const a = answers.shift() ?? { status: "ok" };
      if (a instanceof Error) throw a;
      return a;
    },
    async probe() {
      throw new Error("probe not expected");
    },
  } as unknown as ModuleClient;
  return { client, sent };
}

const run = (client: ModuleClient, args: ModuleArgs) => runModule(client, args);

/** A ledger and allow-list for action (wb_menu's MenuDeps), no files read. */
function menuDeps(): MenuDeps {
  const item = (segments: string[], risk: string): MenuItem => ({
    module: "WorldEditor",
    path: segments.join(","),
    segments,
    risk,
    verified: true,
    opensDialog: opensDialog(segments[segments.length - 1] as string),
  });
  const pack: AllowListPack = {
    paths: [
      ["Edit", "Undo"],
      ["Window", "Hierarchy"],
      ["File", "Options..."],
    ],
    denyLabels: [],
    denyWords: [],
  };
  const items = [
    item(["Edit", "Undo"], "mutating"),
    item(["Window", "Hierarchy"], "safe"),
    item(["File", "Options..."], "safe"),
  ];
  return { items: () => items, allowList: () => pack };
}

describe("wb_module contract and description", () => {
  it("the contract loads and covers the eight actions", () => {
    const { contract } = moduleContract();
    expect(contract.handler).toBe(HANDLER);
    expect(contract.tool).toBe("wb_module");
    expect(contract.actions.map((a) => a.name)).toEqual([
      "list",
      "info",
      "open",
      "front",
      "close",
      "setResource",
      "save",
      "action",
    ]);
    const access = Object.fromEntries(contract.actions.map((a) => [a.name, a.mutating]));
    expect(access).toMatchObject({
      list: false,
      // info: GetModule opens a closed module window (sitting P3-3 gate 1), a reversible side effect.
      info: true,
      open: true,
      save: true,
      action: true,
    });
  });

  it("the description is at most 400 chars with Read: and Mutating: lines", () => {
    const d = wbModuleDescription();
    expect(d.length).toBeLessThanOrEqual(400);
    expect(d).toContain("\nRead:\nlist: ");
    expect(d).toContain("\nMutating:\n");
  });

  it("the module enum is the 9 present modules (NavmeshGeneratorMain gone, W5 OD-5)", () => {
    const mod = (WB_MODULE_INPUT.module as z.ZodOptional<z.ZodEnum<[string, ...string[]]>>).unwrap()
      .options;
    expect(mod).toHaveLength(9);
    expect(mod).not.toContain("NavmeshGeneratorMain");
    expect(mod).toContain("ParticleEditor");
    expect(mod).not.toContain("DialogueEditor");
  });

  it("the wire request is checked against the contract's union", () => {
    expect(buildWireRequest({ action: "info", module: "WorldEditor" })).toEqual({
      action: "info",
      moduleName: "WorldEditor",
    });
    expect(() => buildWireRequest({ action: "info" })).toThrow(/contract/);
    expect(() => buildWireRequest({ action: "action", module: "WorldEditor" })).toThrow(/menuPath/);
  });

  it("registers with annotations and the generated description", () => {
    const seen: Array<{ name: string; cfg: Record<string, unknown> }> = [];
    const server = {
      registerTool(name: string, cfg: Record<string, unknown>) {
        seen.push({ name, cfg });
      },
    };
    registerWbModule(server as never, fake().client as never);
    expect(seen[0].name).toBe("wb_module");
    expect(seen[0].cfg.description).toBe(wbModuleDescription());
    expect(seen[0].cfg.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
  });
});

describe("wb_module read actions", () => {
  it("list is a read call and reports open and unread modules", async () => {
    const { client, sent } = fake({
      status: "ok",
      modules: ["AnimEditor", "WorldEditor"],
      openModules: ["WorldEditor"],
      unreadModules: ["ParticleEditor"],
    });
    const r = await run(client, { action: "list" });
    expect(sent).toEqual([{ api: HANDLER, params: { action: "list" }, access: "read" }]);
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { open: ["WorldEditor"], unread: ["ParticleEditor"] },
    });
  });

  it("info on a closed module answers with next open", async () => {
    const { client } = fake({ status: "ok", isOpen: false });
    const r = await run(client, { action: "info", module: "AudioEditor" });
    expect(r).toMatchObject({ ok: true, next: "wb_module open AudioEditor" });
  });

  it("info and action refuse the Particle Editor before anything is sent", async () => {
    for (const action of ["info", "action"] as const) {
      const { client, sent } = fake();
      const r = await run(client, { action, module: "ParticleEditor", menuPath: ["Edit", "Undo"] });
      expect(r).toMatchObject({ ok: false, code: "MODULE_NOT_SUPPORTED" });
      expect(sent).toEqual([]);
    }
  });
});

describe("wb_module mutating actions", () => {
  it("open sends a mutating call and reports the change", async () => {
    const { client, sent } = fake({ status: "ok", called: true, isOpen: true, result: true });
    const r = await run(client, { action: "open", module: "AudioEditor" });
    expect(sent[0]).toEqual({
      api: HANDLER,
      params: { action: "open", moduleName: "AudioEditor" },
      access: "mutate",
    });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "AudioEditor.open", before: false, after: true }],
    });
  });

  it("open of the Particle Editor is sent and warned as not read back", async () => {
    const { client, sent } = fake({ status: "ok", called: true, isOpen: true, result: true });
    const r = await run(client, { action: "open", module: "ParticleEditor" });
    expect(sent).toHaveLength(1);
    expect(r.ok && r.warnings.join(" ")).toMatch(/never read back/);
    expect(r).toMatchObject({ ok: true, changed: null });
  });

  it("front calls the native, then reads the module back through info", async () => {
    const { client, sent } = fake({}, { status: "ok", isOpen: true });
    const r = await run(client, { action: "front", module: "ScriptEditor" });
    expect(sent.map((s) => s.api)).toEqual(["BringModuleWindowToFront", HANDLER]);
    expect(sent[0].params).toEqual({ ModuleName: "ScriptEditor" });
    expect(sent[1]).toMatchObject({ params: { action: "info" }, access: "read" });
    expect(r).toMatchObject({ ok: true, readback: { isOpen: true } });
  });

  it("front never sends action front to the handler", async () => {
    const { client, sent } = fake({});
    await run(client, { action: "front", module: "ParticleEditor" });
    expect(sent.map((s) => s.api)).toEqual(["BringModuleWindowToFront"]);
  });

  it("close is refused and nothing is sent", async () => {
    const { client, sent } = fake();
    const r = await run(client, { action: "close", module: "WorldEditor" });
    expect(r).toMatchObject({ ok: false, next: "the owner closes by hand" });
    expect(sent).toEqual([]);
  });

  it("save refuses other modules with 'waits for sitting P3-1'", async () => {
    const { client, sent } = fake();
    const r = await run(client, { action: "save", module: "AudioEditor" });
    expect(r).toMatchObject({
      ok: false,
      code: "MODULE_NOT_SUPPORTED",
      next: "waits for sitting P3-1",
    });
    expect(sent).toEqual([]);
  });

  // W2 run 2 (w2-50, 1.9.0.37): a .conf sent to the World Editor raised the modal "Cannot open
  // prefabs at this time (not implemented)". The module must own the file type.
  it("owningModule: World Editor .ent and .et only, Resource Manager for the rest", () => {
    expect(owningModule("Worlds/A.ent")).toBe("WorldEditor");
    expect(owningModule("Prefabs/A.ET")).toBe("WorldEditor");
    for (const p of ["a/b.conf", "a/b.emat", "a/b.layout", "a/b.imageset", "a/b.edds", "a/b.xob"])
      expect(owningModule(p), p).toBe("ResourceManager");
    expect(owningModule("a/b.bt")).toBe("BehaviorEditor");
    expect(owningModule("a/b.c")).toBe("ScriptEditor");
    expect(owningModule("a/b.st")).toBe("LocalizationEditor");
    expect(owningModule("a/b.acp")).toBe("AudioEditor");
    expect(owningModule("a/b.ptc")).toBe("ParticleEditor");
  });

  it("setResource refuses a file type the module cannot open, naming the owner, before anything is sent", async () => {
    for (const [module, path, owner] of [
      ["WorldEditor", "_throwaway/W2/W2_cfg.conf", "ResourceManager"],
      ["WorldEditor", "a/b.emat", "ResourceManager"],
      ["WorldEditor", "a/b.bt", "BehaviorEditor"],
      ["ResourceManager", "Worlds/A.ent", "WorldEditor"],
      ["ResourceManager", "Prefabs/A.et", "WorldEditor"],
    ] as const) {
      const { client, sent } = fake();
      const r = await run(client, { action: "setResource", module, target: `path:${path}` });
      expect(r, `${module} ${path}`).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect((r as { next?: string }).next).toContain(`module ${owner}`);
      expect(sent).toEqual([]);
    }
    const { client, sent } = fake();
    const r = await run(client, {
      action: "setResource",
      module: "ParticleEditor",
      target: "path:a/b.ptc",
    });
    expect(r).toMatchObject({ ok: false, code: "MODULE_NOT_SUPPORTED" });
    expect(sent).toEqual([]);
  });

  it("setResource sends a file type to the module that owns it", async () => {
    for (const [module, path] of [
      ["ResourceManager", "a/b.conf"],
      ["WorldEditor", "Prefabs/A.et"],
      ["AudioEditor", "a/b.acp"],
    ] as const) {
      const { client, sent } = fake({ status: "ok", called: true, result: true, path });
      const r = await run(client, { action: "setResource", module, target: `path:${path}` });
      expect(r.ok, `${module} ${path}`).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].params).toMatchObject({ moduleName: module, path });
    }
  });

  it("setResource refuses an absolute path before anything is sent", async () => {
    const { client, sent } = fake();
    const r = await run(client, {
      action: "setResource",
      module: "WorldEditor",
      target: "path:C:/x/world.ent",
    });
    expect(r).toMatchObject({ ok: false, code: "ABSOLUTE_PATH" });
    expect(sent).toEqual([]);
  });

  it("setResource sends the project-relative path", async () => {
    const { client, sent } = fake({ status: "ok", called: true, result: true, path: "W/t.ent" });
    const r = await run(client, {
      action: "setResource",
      module: "WorldEditor",
      target: "path:W\\t.ent",
    });
    expect(sent[0].params).toEqual({
      action: "setResource",
      moduleName: "WorldEditor",
      path: "W/t.ent",
    });
    expect(r).toMatchObject({ ok: true, target: "path:W/t.ent" });
  });

  it("a handler refusal keeps its code and its nextStep", async () => {
    const { client } = fake({
      status: "refused",
      code: "NOT_IN_PROJECT",
      message:
        "NOT_IN_PROJECT: save needs the handlers installed in the open project | next: install the handlers in the project you have open",
      nextStep: "install the handlers in the project you have open",
    });
    const r = await run(client, { action: "save", module: "WorldEditor" });
    expect(r).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
      target: "open:WorldEditor",
      next: "install the handlers in the project you have open",
    });
  });

  it("an engine false is ENGINE_FALSE with an unknown-change next", async () => {
    const { client } = fake({ status: "error", called: true, result: false });
    const r = await run(client, { action: "save", module: "WorldEditor", confirm: true });
    expect(r).toMatchObject({ ok: false, code: "ENGINE_FALSE", readback: { result: false } });
    expect(!r.ok && r.next).toMatch(/unknown/);
  });

  it("save without confirm is a dry run that names the world and changes nothing", async () => {
    const { client, sent } = fake({
      status: "ok",
      dryRun: true,
      worldPath: "$MyMod:worlds/t.ent",
      worldPathForm: "project",
    });
    const r = await run(client, { action: "save", module: "WorldEditor" });
    expect(sent[0].params).toEqual({ action: "save", moduleName: "WorldEditor" });
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { dryRun: true, worldPath: "$MyMod:worlds/t.ent", result: null },
    });
  });

  it("save with confirm sends confirm and reports before as unknown", async () => {
    const { client, sent } = fake({
      status: "ok",
      dryRun: false,
      called: true,
      result: true,
      worldPath: "$MyMod:worlds/t.ent",
      worldPathForm: "project",
    });
    const r = await run(client, { action: "save", module: "WorldEditor", confirm: true });
    expect(sent[0].params).toEqual({ action: "save", moduleName: "WorldEditor", confirm: true });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "$MyMod:worlds/t.ent", before: null, after: "saved" }],
    });
  });

  it("action sends the menu path and maps the handler's NOT_ALLOWLISTED", async () => {
    const { client, sent } = fake({
      status: "refused",
      code: "NOT_ALLOWLISTED",
      message: "NOT_ALLOWLISTED: ...",
      nextStep: "nothing was sent; a human runs this menu item",
    });
    const r = await runModule(
      client,
      {
        action: "action",
        module: "WorldEditor",
        menuPath: ["Window", "Hierarchy"],
        keepFocus: false,
      },
      menuDeps(),
    );
    expect(sent[0].params).toEqual({
      action: "action",
      moduleName: "WorldEditor",
      menuPath: ["Window", "Hierarchy"],
      keepFocus: false,
    });
    expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWLISTED" });
  });

  // live-tools-b-1: action ran any allow-listed path with no dialog, mode or confirm check.
  describe("action runs wb_menu run's checks before anything is sent", () => {
    const action = (menuPath: string[], extra: Partial<ModuleArgs> = {}): ModuleArgs => ({
      action: "action",
      module: "WorldEditor",
      menuPath,
      ...extra,
    });

    it("refuses a dialog opener MODAL_HAZARD, even when it is on the allow-list", async () => {
      const { client, sent } = fake();
      const r = await runModule(client, action(["File", "Options..."]), menuDeps());
      expect(r).toMatchObject({ ok: false, code: "MODAL_HAZARD" });
      expect(sent).toEqual([]);
    });

    it("refuses a path off the allow-list in TypeScript too", async () => {
      const { client, sent } = fake();
      const r = await runModule(client, action(["File", "Save World"]), menuDeps());
      expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWLISTED" });
      expect(sent).toEqual([]);
    });

    it("refuses WRONG_MODE in play mode and while the mode is unknown", async () => {
      for (const mode of ["play", "unknown"]) {
        const { client, sent } = fake();
        (client as { state?: { mode?: string } }).state = { mode };
        const r = await runModule(client, action(["Window", "Hierarchy"]), menuDeps());
        expect(r).toMatchObject({ ok: false, code: "WRONG_MODE" });
        expect(sent).toEqual([]);
      }
    });

    // W3 a1: the mode check refused the Script Editor's and String Editor's Edit > Undo with no
    // world open; the mode is the World Editor's, so only a WorldEditor item checks it.
    it("checks the mode for a WorldEditor item only", async () => {
      for (const module of ["ScriptEditor", "LocalizationEditor"] as const) {
        for (const mode of ["play", "unknown"]) {
          const { client, sent } = fake({ status: "ok", result: true, executedPath: "Edit > Undo" });
          (client as { state?: { mode?: string } }).state = { mode };
          const r = await runModule(
            client,
            action(["Edit", "Undo"], { module, confirm: true }),
            menuDeps(),
          );
          expect(r).toMatchObject({ ok: true, readback: { result: true } });
          expect(sent).toHaveLength(1);
        }
      }
    });

    it("dry-runs a mutating item unless confirm, then sends it", async () => {
      const dry = fake();
      const r = await runModule(dry.client, action(["Edit", "Undo"]), menuDeps());
      expect(r).toMatchObject({
        ok: true,
        changed: null,
        readback: { dryRun: true, ran: false, risk: "mutating" },
      });
      expect(dry.sent).toEqual([]);
      const go = fake({ status: "ok", result: true, executedPath: "Edit > Undo" });
      const r2 = await runModule(go.client, action(["Edit", "Undo"], { confirm: true }), menuDeps());
      expect(r2).toMatchObject({ ok: true, readback: { result: true } });
      expect(go.sent[0].params).toEqual({
        action: "action",
        moduleName: "WorldEditor",
        menuPath: ["Edit", "Undo"],
      });
    });

    it("sends a safe item at once", async () => {
      const { client, sent } = fake({ status: "ok", result: true, executedPath: "x" });
      const r = await runModule(client, action(["Window", "Hierarchy"]), menuDeps());
      expect(r.ok).toBe(true);
      expect(sent).toHaveLength(1);
    });

    it("the shipped allow-list compiles no dialog opener (DEC-100)", () => {
      const pack = loadAllowListFile();
      expect(pack.paths.length).toBeGreaterThan(0);
      expect(pack.paths.filter((p) => opensDialog(p[p.length - 1] as string))).toEqual([]);
    });
  });

  it("action without a menu path is refused before anything is sent", async () => {
    const { client, sent } = fake();
    const r = await run(client, { action: "action", module: "WorldEditor", menuPath: [] });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toEqual([]);
  });

  it("a LOST mutating call is reported once and never retried", async () => {
    const { client, sent } = fake(new WorkbenchError("reset", "LOST"));
    const r = await run(client, { action: "open", module: "AudioEditor" });
    expect(sent).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, code: "LOST" });
    expect(!r.ok && r.next).toMatch(/never retried/);
  });

  it("a modal on a read is MODAL_OPEN", async () => {
    const { client } = fake(new WorkbenchError("modal", "MODAL_OPEN"));
    const r = await run(client, { action: "list" });
    expect(r).toMatchObject({ ok: false, code: "MODAL_OPEN" });
  });
});

describe("wb_module W4 (phase5-w4-spec.md 2.3) and W5 OD-5", () => {
  const EDITORS = ["AnimEditor", "BehaviorEditor", "ProcAnimEditor"] as const;

  it("the contract: docPath on info and save, save reaches the three editors, purpose names no count", () => {
    const { contract } = moduleContract();
    expect(contract.response).toContain("docPath");
    const keys = (name: string) =>
      contract.actions.find((a) => a.name === name)?.response.map((f) => f.key) ?? [];
    expect(keys("info")).toContain("docPath");
    expect(keys("save")).toContain("docPath");
    expect(contract.actions.find((a) => a.name === "save")?.summary).toMatch(/anim editors: NO_DOCUMENT/);
    expect(contract.purpose).not.toMatch(/\b10\b/);
  });

  it("info answers docPath, or null when the handler gave none", async () => {
    const a = fake({ status: "ok", isOpen: true, containerCount: 1, docPath: "Configs/a.conf" });
    const r = await run(a.client, { action: "info", module: "ResourceManager" });
    expect(r).toMatchObject({ ok: true, readback: { docPath: "Configs/a.conf" } });
    const b = fake({ status: "ok", isOpen: true, containerCount: 0 });
    const s = await run(b.client, { action: "info", module: "AnimEditor" });
    expect(s).toMatchObject({ ok: true, readback: { docPath: null } });
  });

  it("save in each editor is sent to the handler, which refuses NO_DOCUMENT (P-W4-10 killed)", async () => {
    for (const module of EDITORS) {
      const { client, sent } = fake({
        status: "refused",
        code: "NO_DOCUMENT",
        message: `NO_DOCUMENT: save in ${module} exposes no container for its open document (GetNumContainers answered 0 with a file open, probe P-W4-10 killed on 1.9.0.37), so the open document's path is not known; nothing was sent to the editor | next: save in the editor by hand`,
        nextStep: "save in the editor by hand",
      });
      const r = await run(client, { action: "save", module });
      expect(sent[0]).toEqual({
        api: HANDLER,
        params: { action: "save", moduleName: module },
        access: "mutate",
      });
      expect(r).toMatchObject({ ok: false, code: "NO_DOCUMENT", target: `open:${module}` });
    }
  });

  it("save in an editor: a dry run names the document, a confirmed save carries the OD-6 warning", async () => {
    const { client, sent } = fake(
      { status: "ok", dryRun: true, docPath: "Anims/W4Dup/t.aw" },
      { status: "ok", dryRun: false, called: true, result: true, docPath: "Anims/W4Dup/t.aw" },
    );
    const dry = await run(client, { action: "save", module: "AnimEditor" });
    expect(dry).toMatchObject({
      ok: true,
      target: "open:AnimEditor",
      changed: null,
      readback: { dryRun: true, docPath: "Anims/W4Dup/t.aw", result: null },
    });
    expect(dry.ok && dry.next).toMatch(/confirm: true/);
    const wet = await run(client, {
      action: "save",
      module: "AnimEditor",
      target: "open:AnimEditor",
      confirm: true,
    });
    expect(sent[1].params).toEqual({ action: "save", moduleName: "AnimEditor", confirm: true });
    expect(wet).toMatchObject({
      ok: true,
      changed: [{ path: "Anims/W4Dup/t.aw", before: null, after: "saved" }],
      readback: { dryRun: false, result: true },
    });
    expect(wet.ok && wet.warnings.join(" ")).toMatch(/OD-6/);
  });

  it("a false editor save is SAVE_FAILED; a save target naming another module is refused unsent", async () => {
    const a = fake({ status: "error", code: "SAVE_FAILED", called: true, result: false });
    const r = await run(a.client, { action: "save", module: "ProcAnimEditor", confirm: true });
    expect(r).toMatchObject({ ok: false, code: "SAVE_FAILED" });
    const b = fake();
    const s = await run(b.client, {
      action: "save",
      module: "BehaviorEditor",
      target: "open:WorldEditor",
    });
    expect(s).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(b.sent).toEqual([]);
  });

  it("setResource in AnimEditor sends the path; the OpenResource route is warned", async () => {
    const { client, sent } = fake({
      status: "ok",
      called: true,
      result: true,
      path: "Anims/t.aw",
      openedIn: "AnimEditor",
      message:
        "Workbench.OpenResource returned true: opened in the default editor of the type (AnimEditor), not read back",
    });
    const r = await run(client, {
      action: "setResource",
      module: "AnimEditor",
      target: "path:Anims/t.aw",
    });
    expect(sent[0].params).toEqual({
      action: "setResource",
      moduleName: "AnimEditor",
      path: "Anims/t.aw",
    });
    expect(r.ok && r.warnings.join(" ")).toMatch(/Workbench\.OpenResource/);
  });

  it("list passes through the handler's names (NavmeshGeneratorMain absent on 1.9.0.37)", async () => {
    const names = [
      "AnimEditor",
      "AudioEditor",
      "BehaviorEditor",
      "LocalizationEditor",
      "ProcAnimEditor",
      "ResourceManager",
      "ScriptEditor",
      "WorldEditor",
    ];
    const { client } = fake({ status: "ok", modules: names, unreadModules: ["ParticleEditor"] });
    const r = await run(client, { action: "list" });
    expect(r).toMatchObject({ ok: true, readback: { modules: names } });
  });
});
