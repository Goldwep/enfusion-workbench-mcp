import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { WEB_PREFIX } from "../../src/formats/enfusion-link.js";
import {
  ACTIONS,
  LINK_GATES,
  OPENABLE_MODULES,
  TOOL_NAME,
  WB_LINK_DESCRIPTION,
  WB_LINK_INPUT,
  planRoute,
  prepareRequest,
  registerWbLink,
  runLink,
  wbLinkDescription,
  type LinkResponse,
} from "../../src/tools/wb-link.js";
import { parseLink } from "../../src/formats/enfusion-link.js";
import { captureTool, textOf } from "./_tool-harness.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

type Answer = Record<string, unknown> | Error;

/** A client whose call() answers per handler and action, and records what was sent. */
function fakeClient(answers: Record<string, Answer | ((p: Record<string, unknown>) => Answer)>): {
  client: WorkbenchClient;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const key = `${fn}.${String(params.action)}`;
      const a = answers[key];
      if (a === undefined) throw new Error(`unexpected call ${key}`);
      const v = typeof a === "function" ? a(params) : a;
      if (v instanceof Error) throw v;
      return v;
    },
    probe: async () => ({ ok: true }),
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "refused") => ({ status: "refused", code, message });

const ARLAND = "$ArmaReforger:worlds/Arland/Arland.ent";
const WORLD_LINK =
  "enfusion://WorldEditor/~ArmaReforger:worlds/Arland/Arland.ent;100.5,20,300;-30,45,0";
const OTHER_LINK = "enfusion://WorldEditor/~MyMod:worlds/Test/Test.ent;1,2,3;0,90,0;0.5;0x1F";

const LIST_WE_OPEN = ok({ modules: ["WorldEditor"], openModules: ["WorldEditor"] });
const LIST_NONE_OPEN = ok({ modules: ["WorldEditor"], openModules: [] });

const BASE: Record<string, Answer> = {
  "EMCP_WB_Module.list": LIST_WE_OPEN,
  "EMCP_WB_Module.open": ok({ isOpen: 1, called: 1, result: 1 }),
  "EMCP_WB_Module.setResource": ok({ path: "x", result: 1, openedIn: "WorldEditor" }),
  "EMCP_WB_World.state": ok({ worldPath: ARLAND, worldName: "Arland", mode: "edit" }),
  "EMCP_WB_View.camera": ok({
    coords: "100.5 20 300",
    angles: "45 -30 0",
    direction: "0 0 1",
    screenWidth: 800,
    screenHeight: 600,
  }),
  "EMCP_WB_View.setCamera": ok({ before: "0 0 0", after: "1 2 3" }),
  "EMCP_WB_View.select": ok({ selectedCount: 1, previous: [], missing: [] }),
  "EMCP_WB_ScriptEditor.open": ok({
    result: 1,
    file: "scripts/Game/game.c",
    relPath: "scripts/Game/game.c",
    inProject: 0,
    linesCount: 2000,
  }),
};

const OPEN = { gates: { open: true } };
const okOf = (r: LinkResponse) => {
  if (!r.ok) throw new Error(`${r.action}: ${r.code} ${r.message}`);
  return r;
};
const errOf = (r: LinkResponse) => {
  if (r.ok) throw new Error(`${r.action} was not refused`);
  return r;
};
const rb = (r: LinkResponse) => okOf(r).readback as Record<string, unknown>;
const called = (sent: Sent[]) => sent.map((s) => `${s.fn}.${String(s.params.action)}`);

describe("wb_link surface", () => {
  it("names the four actions and keeps the spec's description within the budget", () => {
    expect(TOOL_NAME).toBe("wb_link");
    expect([...ACTIONS]).toEqual(["parse", "build", "fromView", "open"]);
    expect(WB_LINK_DESCRIPTION.length).toBe(362);
    expect(WB_LINK_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(wbLinkDescription()).toBe(WB_LINK_DESCRIPTION);
    expect(Object.keys(WB_LINK_INPUT)).toContain("confirm");
    expect(OPENABLE_MODULES).not.toContain("ParticleEditor");
  });

  it("names nothing project- or sandbox-specific", () => {
    expect(WB_LINK_DESCRIPTION).not.toMatch(/sandbox|EMCP2|29th/i);
  });

  it("keeps the open route closed until P-W8-11; WORLD_DIFFERS is in the vocabulary", () => {
    expect(LINK_GATES.open).toBe(false);
    expect(ERROR_CODES.WORLD_DIFFERS).toMatch(/another world/);
  });

  it("registers and answers through the tool handler", async () => {
    const { client, sent } = fakeClient({});
    const h = captureTool((s) => registerWbLink(s, client));
    const res = await h({ action: "parse", link: WORLD_LINK, confirm: undefined });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res)).readback.kind).toBe("world");
    const bad = await h({ action: "open", link: "https://example.com/" });
    expect(bad.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("refusals before anything is sent", () => {
  it.each<[Record<string, unknown>, string, RegExp]>([
    [{ action: "nope" }, "INVALID_ARGUMENT", /unknown action/],
    [{}, "INVALID_ARGUMENT", /unknown action/],
    [{ action: "parse" }, "INVALID_ARGUMENT", /needs link/],
    [{ action: "parse", link: "  " }, "INVALID_ARGUMENT", /needs link/],
    [{ action: "parse", link: "x", confirm: true }, "INVALID_ARGUMENT", /confirm does not apply/],
    [{ action: "parse", link: "enfusion://Nope" }, "INVALID_ARGUMENT", /unknown link module/],
    [{ action: "fromView", link: "x" }, "INVALID_ARGUMENT", /link does not apply/],
    [{ action: "fromView", webPrefix: "yes" }, "INVALID_ARGUMENT", /webPrefix must be/],
    [{ action: "open" }, "INVALID_ARGUMENT", /needs link/],
    [{ action: "open", link: "enfusion://" }, "INVALID_ARGUMENT", /no module/],
    [{ action: "open", link: WORLD_LINK, confirm: "yes" }, "INVALID_ARGUMENT", /confirm must be/],
    [{ action: "open", link: WORLD_LINK, kind: "world" }, "INVALID_ARGUMENT", /kind does not/],
    [{ action: "build" }, "INVALID_ARGUMENT", /needs kind/],
    [{ action: "build", kind: "web" }, "INVALID_ARGUMENT", /never built/],
    [{ action: "build", kind: "world", world: 3 }, "INVALID_ARGUMENT", /world must be a string/],
    [{ action: "build", kind: "world", pos: [1, "2", 3] }, "INVALID_ARGUMENT", /pos must be/],
    [{ action: "build", kind: "script", path: "a.c", line: 1.5 }, "INVALID_ARGUMENT", /whole/],
    [
      { action: "build", kind: "editor", module: "Nope" },
      "INVALID_ARGUMENT",
      /unknown link module/,
    ],
    [{ action: "build", kind: "world" }, "INVALID_ARGUMENT", /needs world/],
  ])("%j answers %s", async (input, code, why) => {
    const { client, sent } = fakeClient(BASE);
    const r = errOf(await runLink(client, input, OPEN));
    expect(r.code).toBe(code);
    expect(r.message).toMatch(why);
    expect(r.next).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("prepareRequest names the target of an open", () => {
    const p = prepareRequest({ action: "open", link: "enfusion://ScriptEditor/scripts/a.c;3" });
    expect(p.ok && p.target).toBe("path:scripts/a.c");
    const q = prepareRequest({ action: "open", link: "enfusion://AnimEditor" });
    expect(q.ok && q.target).toBe("module:AnimEditor");
  });
});

describe("parse", () => {
  it("answers the spec's keys for a world link", async () => {
    const { client, sent } = fakeClient({});
    const r = await runLink(client, { action: "parse", link: `  ${WORLD_LINK} ` });
    expect(okOf(r).target).toBe("open:WorldEditor");
    expect(okOf(r).changed).toBeNull();
    expect(rb(r)).toMatchObject({
      kind: "world",
      module: "WorldEditor",
      world: "~ArmaReforger:worlds/Arland/Arland.ent",
      addon: "ArmaReforger",
      path: "worlds/Arland/Arland.ent",
      pos: [100.5, 20, 300],
      angles: { pitch: -30, yaw: 45, roll: 0 },
      time: null,
      entity: null,
      line: null,
      link: WORLD_LINK,
      roundTrip: true,
    });
    expect(sent).toHaveLength(0);
  });

  it("answers time, entity and line", async () => {
    const { client } = fakeClient({});
    const w = rb(await runLink(client, { action: "parse", link: OTHER_LINK }));
    expect(w.time).toEqual({ daytime: 0.5, year: null, month: null, day: null });
    expect(w.entity).toBe("0x1F");
    const s = rb(
      await runLink(client, { action: "parse", link: "enfusion://ScriptEditor/scripts/a.c;7" }),
    );
    expect(s).toMatchObject({ kind: "script", path: "scripts/a.c", line: 7 });
  });

  it("answers a web link and warns that it is never opened", async () => {
    const { client } = fakeClient({});
    const r = okOf(
      await runLink(client, { action: "parse", link: "https://discord.com/invite/arma" }),
    );
    expect(r.target).toBe("link:web");
    expect((r.readback as Record<string, unknown>).kind).toBe("web");
    expect((r.readback as Record<string, unknown>).url).toBe("https://discord.com/invite/arma");
    expect(r.warnings.join(" ")).toMatch(/never opened/);
    expect(r.next).toBeUndefined();
  });

  it("reads the redirect prefix", async () => {
    const { client } = fakeClient({});
    const r = okOf(await runLink(client, { action: "parse", link: WEB_PREFIX + WORLD_LINK }));
    expect((r.readback as Record<string, unknown>).webPrefix).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/redirect prefix/);
  });
});

describe("build", () => {
  it("writes a link from fields", async () => {
    const { client, sent } = fakeClient({});
    const r = await runLink(client, {
      action: "build",
      kind: "world",
      world: "~ArmaReforger:worlds/Arland/Arland.ent",
      pos: [100.5, 20, 300],
      angles: "-30,45,0",
    });
    expect(rb(r).link).toBe(WORLD_LINK);
    expect(okOf(r).next).toMatch(/dry run/);
    const p = await runLink(client, {
      action: "build",
      kind: "resource",
      addon: "ArmaReforger",
      path: "Configs/Factions/BLUFOR.conf",
      webPrefix: true,
    });
    expect(rb(p).link).toBe(
      `${WEB_PREFIX}enfusion://ResourceManager/~ArmaReforger:Configs/Factions/BLUFOR.conf`,
    );
    expect(sent).toHaveLength(0);
  });
});

describe("fromView", () => {
  it("links the open view as the vanilla helper does (pitch, yaw, roll)", async () => {
    const { client, sent } = fakeClient(BASE);
    const r = okOf(await runLink(client, { action: "fromView" }));
    expect((r.readback as Record<string, unknown>).link).toBe(WORLD_LINK);
    expect((r.readback as Record<string, unknown>).worldPath).toBe(ARLAND);
    expect(called(sent)).toEqual([
      "EMCP_WB_Module.list",
      "EMCP_WB_World.state",
      "EMCP_WB_View.camera",
    ]);
    expect(sent.every((s) => s.options.access === "read")).toBe(true);
  });

  it("adds the web prefix on request", async () => {
    const { client } = fakeClient(BASE);
    const r = await runLink(client, { action: "fromView", webPrefix: true });
    expect(rb(r).link).toBe(WEB_PREFIX + WORLD_LINK);
  });

  it("writes the world only when the camera is at 0 0 0 with angles 0 0 0", async () => {
    const { client } = fakeClient({
      ...BASE,
      "EMCP_WB_View.camera": ok({ coords: "0 0 0", angles: "0 0 0" }),
    });
    const r = await runLink(client, { action: "fromView" });
    expect(rb(r).link).toBe("enfusion://WorldEditor/~ArmaReforger:worlds/Arland/Arland.ent");
  });

  it("keeps only the worlds/ part of a path with no addon", async () => {
    const { client } = fakeClient({
      ...BASE,
      "EMCP_WB_World.state": ok({ worldPath: "%USERPROFILE%/Mod/worlds/T/T.ent" }),
    });
    const r = await runLink(client, { action: "fromView" });
    expect(rb(r).link).toBe("enfusion://WorldEditor/worlds/T/T.ent;100.5,20,300;-30,45,0");
  });

  it("refuses MODULE_NOT_OPEN when the World Editor is closed, without opening it", async () => {
    const { client, sent } = fakeClient({ ...BASE, "EMCP_WB_Module.list": LIST_NONE_OPEN });
    const r = errOf(await runLink(client, { action: "fromView" }));
    expect(r.code).toBe("MODULE_NOT_OPEN");
    expect(called(sent)).toEqual(["EMCP_WB_Module.list"]);
  });

  it.each<[Answer, RegExp]>([
    [refused("NO_WORLD", "no world is open"), /no world is open/],
    [ok({ worldPath: "" }), /no path/],
    [ok({ worldPath: "C:/elsewhere/x.ent" }), /no worlds\/ part/],
  ])("refuses NO_WORLD (%j)", async (state, why) => {
    const { client, sent } = fakeClient({ ...BASE, "EMCP_WB_World.state": state });
    const r = errOf(await runLink(client, { action: "fromView" }));
    expect(r.code).toBe("NO_WORLD");
    expect(r.message).toMatch(why);
    expect(called(sent)).not.toContain("EMCP_WB_View.camera");
  });

  it("names the world only when the camera read is unusable", async () => {
    const { client } = fakeClient({
      ...BASE,
      "EMCP_WB_View.camera": ok({ coords: "", angles: "" }),
    });
    const r = okOf(await runLink(client, { action: "fromView" }));
    expect((r.readback as Record<string, unknown>).link).toBe(
      "enfusion://WorldEditor/~ArmaReforger:worlds/Arland/Arland.ent",
    );
    expect(r.warnings.join(" ")).toMatch(/no usable position/);
  });

  it("maps a camera refusal", async () => {
    const { client } = fakeClient({ ...BASE, "EMCP_WB_View.camera": refused("NO_WORLD") });
    expect(errOf(await runLink(client, { action: "fromView" })).code).toBe("NO_WORLD");
  });

  it.each(["MODAL_OPEN", "LOST", "WEDGED"] as const)(
    "maps a client %s on the first read",
    async (code) => {
      const { client } = fakeClient({
        ...BASE,
        "EMCP_WB_Module.list": new WorkbenchError(`client ${code}`, code),
      });
      const r = errOf(await runLink(client, { action: "fromView" }));
      expect(r.code).toBe(code);
      expect(r.message).toMatch(/wb_module list/);
    },
  );

  it("maps a refused connection to UNREACHABLE", async () => {
    const { client } = fakeClient({
      ...BASE,
      "EMCP_WB_View.camera": new WorkbenchError("refused", "CONNECTION_REFUSED"),
    });
    expect(errOf(await runLink(client, { action: "fromView" })).code).toBe("UNREACHABLE");
  });
});

describe("open: refusals", () => {
  it("refuses a web link NOT_ALLOWLISTED and sends nothing", async () => {
    const { client, sent } = fakeClient(BASE);
    for (const confirm of [false, true]) {
      const r = errOf(
        await runLink(
          client,
          { action: "open", link: "https://community.bistudio.com/wiki/", confirm },
          OPEN,
        ),
      );
      expect(r.code).toBe("NOT_ALLOWLISTED");
      expect(r.message).toMatch(/never opened/);
    }
    expect(sent).toHaveLength(0);
  });

  it.each(["enfusion://ParticleEditor", "enfusion://ResourceManager/Particles/Fire.ptc"])(
    "never opens the Particle Editor (%s)",
    async (link) => {
      const { client, sent } = fakeClient(BASE);
      const r = errOf(await runLink(client, { action: "open", link, confirm: true }, OPEN));
      expect(r.code).toBe("MODULE_NOT_SUPPORTED");
      expect(r.message).toMatch(/DEC-042/);
      expect(sent).toHaveLength(0);
    },
  );

  it("answers GATED with confirm while the switch is closed, before any read", async () => {
    const { client, sent } = fakeClient(BASE);
    for (const link of [WORLD_LINK, "enfusion://AnimEditor", "enfusion://ScriptEditor/a/b.c;1"]) {
      const r = errOf(await runLink(client, { action: "open", link, confirm: true }));
      expect(r.code).toBe("GATED");
      expect(r.message).toMatch(/P-W8-11/);
      expect(r.message).toMatch(/LINK_GATES\.open/);
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses a Script Editor link that names no script", async () => {
    const { client, sent } = fakeClient(BASE);
    const r = errOf(
      await runLink(client, { action: "open", link: "enfusion://ScriptEditor/Configs/a.conf" }),
    );
    expect(r.code).toBe("INVALID_ARGUMENT");
    expect(sent).toHaveLength(0);
  });
});

describe("open: dry run", () => {
  it("shows an editor link's route and sends nothing", async () => {
    const { client, sent } = fakeClient(BASE);
    const r = okOf(await runLink(client, { action: "open", link: "enfusion://AnimEditor" }));
    expect(r.target).toBe("module:AnimEditor");
    expect(r.readback).toMatchObject({
      dryRun: true,
      dispatched: false,
      via: ["wb_module open AnimEditor"],
    });
    expect(r.next).toMatch(/P-W8-11/);
    expect(sent).toHaveLength(0);
  });

  it("says resend with confirm once the switch is open", async () => {
    const { client } = fakeClient(BASE);
    const r = okOf(await runLink(client, { action: "open", link: "enfusion://AnimEditor" }, OPEN));
    expect(r.next).toMatch(/confirm: true/);
  });

  it("plans the world load when the World Editor is closed, reading only the module list", async () => {
    const { client, sent } = fakeClient({ ...BASE, "EMCP_WB_Module.list": LIST_NONE_OPEN });
    const r = okOf(await runLink(client, { action: "open", link: WORLD_LINK }));
    expect((r.readback as { via: string[] }).via).toEqual([
      "wb_module open WorldEditor",
      "wb_module setResource WorldEditor path:worlds/Arland/Arland.ent",
      expect.stringMatching(/^wb_view setCamera coords 100\.5 20 300 look /),
    ]);
    expect(called(sent)).toEqual(["EMCP_WB_Module.list"]);
    expect(sent[0]!.options.access).toBe("read");
  });

  it("skips the world load when the link names the open world", async () => {
    const { client, sent } = fakeClient(BASE);
    const r = okOf(await runLink(client, { action: "open", link: WORLD_LINK }));
    const via = (r.readback as { via: string[] }).via;
    expect(via[0]).toBe("wb_module open WorldEditor");
    expect(via.some((v) => v.includes("setResource"))).toBe(false);
    expect((r.readback as Record<string, unknown>).openWorld).toBe(ARLAND);
    expect(called(sent)).toEqual(["EMCP_WB_Module.list", "EMCP_WB_World.state"]);
    expect(sent.every((s) => s.options.access === "read")).toBe(true);
  });

  it("refuses WORLD_DIFFERS when the link names another world", async () => {
    const { client } = fakeClient(BASE);
    const r = errOf(await runLink(client, { action: "open", link: OTHER_LINK }));
    expect(r.code).toBe("WORLD_DIFFERS");
    expect(r.message).toMatch(/Test\.ent/);
    expect(r.next).toMatch(/confirm: true/);
  });

  it("plans the world load when the World Editor holds no world", async () => {
    const { client } = fakeClient({ ...BASE, "EMCP_WB_World.state": refused("NO_WORLD") });
    const r = okOf(await runLink(client, { action: "open", link: OTHER_LINK }));
    const via = (r.readback as { via: string[] }).via;
    expect(via).toContain("wb_module setResource WorldEditor path:worlds/Test/Test.ent");
    expect(via).toContain("wb_view select id:000000000000001f");
    expect(r.warnings.join(" ")).toMatch(/time of day is not applied/);
  });

  it("maps a state read failure other than NO_WORLD", async () => {
    const { client } = fakeClient({
      ...BASE,
      "EMCP_WB_World.state": new WorkbenchError("modal", "MODAL_OPEN"),
    });
    expect(errOf(await runLink(client, { action: "open", link: WORLD_LINK })).code).toBe(
      "MODAL_OPEN",
    );
  });

  it("routes a Resource Manager link by the file's owning module", async () => {
    const { client, sent } = fakeClient(BASE);
    const conf = okOf(
      await runLink(client, {
        action: "open",
        link: "enfusion://ResourceManager/~ArmaReforger:Configs/Factions/BLUFOR.conf",
      }),
    );
    expect(conf.target).toBe("path:Configs/Factions/BLUFOR.conf");
    expect((conf.readback as { via: string[] }).via).toEqual([
      "wb_module open ResourceManager",
      "wb_module setResource ResourceManager path:Configs/Factions/BLUFOR.conf",
    ]);
    expect(conf.warnings.join(" ")).toMatch(/addon 'ArmaReforger' is not passed/);
    const et = okOf(
      await runLink(client, { action: "open", link: "enfusion://ResourceManager/Prefabs/A.et" }),
    );
    expect((et.readback as { via: string[] }).via[0]).toBe("wb_module open WorldEditor");
    expect(et.warnings.join(" ")).toMatch(/owns its file type/);
    expect(sent).toHaveLength(0);
  });

  it("dispatches a prefixed link by the link inside it", async () => {
    const { client } = fakeClient(BASE);
    const r = okOf(
      await runLink(client, { action: "open", link: `${WEB_PREFIX}enfusion://LocalizationEditor` }),
    );
    expect((r.readback as { via: string[] }).via).toEqual(["wb_module open LocalizationEditor"]);
    expect(r.warnings.join(" ")).toMatch(/redirect prefix was removed/);
  });
});

describe("open: dispatch (switch open)", () => {
  it("loads another world, moves the camera and selects the entity, in order", async () => {
    const { client, sent } = fakeClient(BASE);
    const r = okOf(
      await runLink(client, { action: "open", link: OTHER_LINK, confirm: true }, OPEN),
    );
    expect(called(sent)).toEqual([
      "EMCP_WB_Module.list",
      "EMCP_WB_World.state",
      "EMCP_WB_Module.open",
      "EMCP_WB_Module.setResource",
      "EMCP_WB_View.setCamera",
      "EMCP_WB_View.select",
    ]);
    expect(sent.slice(2).every((s) => s.options.access === "mutate")).toBe(true);
    expect(sent[3]!.params).toMatchObject({
      moduleName: "WorldEditor",
      path: "worlds/Test/Test.ent",
    });
    // pitch 0, yaw 90: the look direction is +x.
    expect(sent[4]!.params).toEqual({ action: "setCamera", coords: "1 2 3", look: "1 0 0" });
    // wb_view writes the id in the handler's wire form.
    expect(sent[5]!.params).toMatchObject({ mode: "set", entities: ["id:0x000000000000001f"] });
    expect(r.readback).toMatchObject({ dryRun: false, dispatched: true });
    expect(r.changed?.length).toBeGreaterThan(0);
    expect(r.warnings.join(" ")).toMatch(/is replaced by/);
    expect(r.next).toMatch(/fromView/);
  });

  it("opens a script in the Script Editor and says the line is not applied", async () => {
    const { client, sent } = fakeClient(BASE);
    const r = okOf(
      await runLink(
        client,
        { action: "open", link: "enfusion://ScriptEditor/scripts/Game/game.c;1175", confirm: true },
        OPEN,
      ),
    );
    expect(called(sent)).toEqual(["EMCP_WB_Module.open", "EMCP_WB_ScriptEditor.open"]);
    expect(sent[0]!.params).toMatchObject({ moduleName: "ScriptEditor" });
    expect(sent[1]!.params).toMatchObject({ path: "scripts/Game/game.c" });
    expect(r.warnings.join(" ")).toMatch(/line 1175 is not applied/);
  });

  it("opens a resource through its owning module", async () => {
    const { client, sent } = fakeClient(BASE);
    okOf(
      await runLink(
        client,
        { action: "open", link: "enfusion://ResourceManager/Configs/a.conf", confirm: true },
        OPEN,
      ),
    );
    expect(called(sent)).toEqual(["EMCP_WB_Module.open", "EMCP_WB_Module.setResource"]);
    expect(sent[1]!.params).toMatchObject({
      moduleName: "ResourceManager",
      path: "Configs/a.conf",
    });
  });

  it("answers a failing step with what was dispatched before it", async () => {
    const { client, sent } = fakeClient({
      ...BASE,
      "EMCP_WB_Module.list": LIST_NONE_OPEN,
      "EMCP_WB_Module.setResource": refused("PATH_NOT_FOUND", "no such world"),
    });
    const r = errOf(
      await runLink(client, { action: "open", link: WORLD_LINK, confirm: true }, OPEN),
    );
    expect(r.code).toBe("PATH_NOT_FOUND");
    expect(r.message).toMatch(/^wb_module setResource WorldEditor/);
    expect(r.readback).toMatchObject({ dispatched: ["wb_module open WorldEditor"] });
    expect(r.warnings.join(" ")).toMatch(/partly dispatched/);
    expect(called(sent)).not.toContain("EMCP_WB_View.setCamera");
  });

  it.each(["MODAL_OPEN", "LOST", "WEDGED"] as const)(
    "maps a client %s during a step and stops",
    async (code) => {
      const { client, sent } = fakeClient({
        ...BASE,
        "EMCP_WB_Module.open": new WorkbenchError(`client ${code}`, code),
      });
      const r = errOf(
        await runLink(
          client,
          { action: "open", link: "enfusion://AudioEditor", confirm: true },
          OPEN,
        ),
      );
      expect(r.code).toBe(code);
      expect(sent).toHaveLength(1);
    },
  );
});

describe("planRoute", () => {
  it("warns for an entity that is not a hex EntityID and for angles with no position", () => {
    const p = parseLink("enfusion://WorldEditor/worlds/a.ent;;1,2,3;;Bob");
    const plan = planRoute(p, false);
    expect(plan.steps.map((s) => s.text)).toEqual(["wb_module open WorldEditor"]);
    expect(plan.warnings.join(" ")).toMatch(/no position/);
    expect(plan.warnings.join(" ")).toMatch(/not a hex EntityID/);
  });
});
