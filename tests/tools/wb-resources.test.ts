import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  HANDLER_ACTIONS,
  LEGACY_ACTIONS,
  LEGACY_MAP,
  RESOURCES_CONTRACT,
  TS_ACTIONS,
  WORLD_ALIAS_MAP,
  flatInputShape,
  parseAddonRows,
  parseSettingRow,
  prepareRequest,
  registerProjectFile,
  resolveLink,
  routeWorldAlias,
  runResources,
  scrubHome,
  timeoutFor,
  wbResourcesDescription,
} from "../../src/tools/wb-resources.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(
  answer: (p: Record<string, unknown>, n: number, fn: string) => Record<string, unknown> | Error,
): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params, sent.length - 1, fn);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "no", next = "fix it") => ({
  status: "refused",
  code,
  message,
  next,
});
const GUID = "{0123456789ABCDEF}";

describe("wb_resources contract", () => {
  it("loads and names the eleven handler actions", () => {
    expect(RESOURCES_CONTRACT.tool).toBe("wb_resources");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      [
        "addons",
        "create",
        "import",
        "newGuid",
        "prefabFromModel",
        "rebuild",
        "register",
        "resolve",
        "search",
        "selection",
        "wait",
      ].sort(),
    );
    expect([...TS_ACTIONS]).toEqual(["getInfo", "open", "link"]);
  });

  it("its description fits the 400-char budget", () => {
    expect(wbResourcesDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks the five writes mutating and projectOnly", () => {
    const writes = ["register", "rebuild", "import", "create", "prefabFromModel"];
    for (const a of RESOURCES_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(writes.includes(a.name));
      expect(a.projectOnly, a.name).toBe(a.mutating);
    }
  });

  it("gives registerTool a flat shape with every key, the TS actions and browse", () => {
    const shape = flatInputShape();
    for (const k of [
      "action",
      "rootPath",
      "extensions",
      "searchStr",
      "tags",
      "recursive",
      "cursor",
      "limit",
      "path",
      "available",
      "timeoutMs",
      "buildRuntime",
      "confirm",
      "paths",
      "configuration",
      "settings",
      "allPlatforms",
      "className",
      "inherit",
      "xobPath",
      "expandResource",
      "addon",
      "url",
    ])
      expect(shape[k], k).toBeDefined();
    for (const n of [...HANDLER_ACTIONS, ...TS_ACTIONS, "browse"]) {
      expect(shape.action!.safeParse(n).success, n).toBe(true);
    }
    expect(shape.extensions!.safeParse(["conf"]).success).toBe(true);
    expect(shape.extensions!.safeParse("conf").success).toBe(false);
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  const refuses = (input: unknown, code: string, text?: RegExp) => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      if (text) expect(p.error.message).toMatch(text);
    }
  };

  it("refuses an unknown action and lists the names", () => {
    refuses({ action: "nope" }, "INVALID_ARGUMENT", /one of search.*getInfo, open, link, browse/);
  });

  it("refuses a missing required param per action", () => {
    refuses({ action: "resolve" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "wait" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "register" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "import" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "create", path: "Configs/a.conf" }, "INVALID_ARGUMENT", /className/);
    refuses({ action: "prefabFromModel", path: "Prefabs/a.et" }, "INVALID_ARGUMENT", /xobPath/);
    refuses({ action: "getInfo" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "open" }, "INVALID_ARGUMENT", /path/);
    refuses({ action: "link" }, "INVALID_ARGUMENT", /addon and path, or url/);
  });

  it("refuses a key that belongs to another action", () => {
    refuses({ action: "search", confirm: true }, "INVALID_ARGUMENT");
    refuses({ action: "newGuid", path: "a" }, "INVALID_ARGUMENT");
    refuses({ action: "register", path: "a.conf", settings: ["a=b"] }, "INVALID_ARGUMENT");
  });

  it("refuses buildRuntime on rebuild with the action that owns it", () => {
    refuses(
      { action: "rebuild", path: "a.conf", buildRuntime: true },
      "INVALID_ARGUMENT",
      /belongs to register/,
    );
  });

  it("refuses absolute and parent paths with ABSOLUTE_PATH", () => {
    for (const path of ["C:/x/a.conf", "/abs/a.conf", "..\\a.conf", "$Addon:a.conf", "file:///a"]) {
      refuses({ action: "register", path }, "ABSOLUTE_PATH");
      refuses({ action: "wait", path }, "ABSOLUTE_PATH");
      refuses({ action: "resolve", path }, "ABSOLUTE_PATH");
      refuses({ action: "open", path }, "ABSOLUTE_PATH");
      refuses({ action: "getInfo", path }, "ABSOLUTE_PATH");
    }
  });

  it("refuses a .meta where a resource is named", () => {
    refuses({ action: "register", path: "a.conf.meta" }, "INVALID_ARGUMENT", /\.meta/);
    refuses({ action: "rebuild", path: "a.png.META" }, "INVALID_ARGUMENT", /\.meta/);
    refuses({ action: "open", path: "a.conf.meta" }, "INVALID_ARGUMENT", /\.meta/);
  });

  it("checks rootPath: $Addon:Folder/ and a relative folder pass, absolute forms refuse", () => {
    expect(prepareRequest({ action: "search", rootPath: "$MyAddon:Configs/" }).ok).toBe(true);
    expect(prepareRequest({ action: "search", rootPath: "Configs\\Sub" }).ok).toBe(true);
    for (const rootPath of ["C:/x", "/x", "a/../b", "$A:b:c", "a:b"]) {
      refuses({ action: "search", rootPath }, "ABSOLUTE_PATH");
    }
  });

  it("strips the dot from extensions and refuses an empty or pathy entry", () => {
    const p = prepareRequest({ action: "search", extensions: [".conf", "emat"] });
    expect(p.ok && p.kind === "handler" && p.params.extensions).toEqual(["conf", "emat"]);
    refuses({ action: "search", extensions: [""] }, "INVALID_ARGUMENT", /extensions/);
    refuses({ action: "search", extensions: ["a/b"] }, "INVALID_ARGUMENT", /extensions/);
  });

  it("checks paging: limit range and a well-formed cursor", () => {
    refuses({ action: "search", limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "search", limit: 201 }, "INVALID_ARGUMENT", /limit/);
    refuses({ action: "search", cursor: "abc" }, "INVALID_ARGUMENT", /cursor/);
    refuses({ action: "search", cursor: "9:3" }, "INVALID_ARGUMENT", /past its count/);
    expect(prepareRequest({ action: "search", limit: 200, cursor: "50:120" }).ok).toBe(true);
  });

  it("checks resolve forms: a path, {GUID} or {GUID}path; a short GUID refuses", () => {
    for (const path of ["Configs/a.conf", GUID, `${GUID}Configs/a.conf`]) {
      expect(prepareRequest({ action: "resolve", path }).ok, path).toBe(true);
    }
    refuses({ action: "resolve", path: "{12345}a.conf" }, "INVALID_ARGUMENT", /GUID/);
    refuses({ action: "resolve", path: `${GUID}C:/a.conf` }, "ABSOLUTE_PATH");
  });

  it("checks timeoutMs 0..10000 and the configuration names", () => {
    refuses({ action: "wait", path: "a.conf", timeoutMs: -1 }, "INVALID_ARGUMENT", /timeoutMs/);
    refuses({ action: "wait", path: "a.conf", timeoutMs: 10001 }, "INVALID_ARGUMENT", /timeoutMs/);
    expect(prepareRequest({ action: "wait", path: "a.conf", timeoutMs: 10000 }).ok).toBe(true);
    refuses(
      { action: "rebuild", path: "a.conf", configuration: "XBOX" },
      "INVALID_ARGUMENT",
      /configuration/,
    );
    refuses(
      { action: "import", path: "a.png", configuration: "pc" },
      "INVALID_ARGUMENT",
      /configuration/,
    );
    for (const configuration of ["PC", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5", "HEADLESS"]) {
      expect(prepareRequest({ action: "rebuild", path: "a.png", configuration }).ok).toBe(true);
    }
  });

  it("rebuild needs a file, at most 200 across path and paths", () => {
    refuses({ action: "rebuild" }, "INVALID_ARGUMENT", /path or paths/);
    refuses({ action: "rebuild", paths: [] }, "INVALID_ARGUMENT", /path or paths/);
    const many = Array.from({ length: 200 }, (_, i) => `a/${i}.conf`);
    expect(prepareRequest({ action: "rebuild", paths: many }).ok).toBe(true);
    refuses(
      { action: "rebuild", path: "a/x.conf", paths: many },
      "INVALID_ARGUMENT",
      /at most 200/,
    );
    refuses({ action: "rebuild", paths: ["a.conf", "../b.conf"] }, "ABSOLUTE_PATH");
  });

  it("import settings must be name=value with a variable name", () => {
    refuses(
      { action: "import", path: "a.png", settings: ["novalue"] },
      "INVALID_ARGUMENT",
      /name=value/,
    );
    refuses(
      { action: "import", path: "a.png", settings: ["=v"] },
      "INVALID_ARGUMENT",
      /name=value/,
    );
    refuses(
      { action: "import", path: "a.png", settings: ["bad name=v"] },
      "INVALID_ARGUMENT",
      /name=value/,
    );
    expect(
      prepareRequest({ action: "import", path: "a.png", settings: ["ColorSpace=a=b"] }).ok,
    ).toBe(true);
  });

  it("create: new file type, class name and inherit form", () => {
    refuses({ action: "create", path: "a.txt", className: "X" }, "UNSUPPORTED_TYPE", /\.conf/);
    refuses({ action: "create", path: "a.conf", className: "1X" }, "INVALID_ARGUMENT", /className/);
    refuses(
      { action: "create", path: "a.conf", className: "a b" },
      "INVALID_ARGUMENT",
      /className/,
    );
    refuses(
      { action: "create", path: "a.emat", className: "MatPBRBasic", inherit: "Materials/p.emat" },
      "INVALID_ARGUMENT",
      /resource name/,
    );
    for (const path of ["a.conf", "b.EMAT", "c.layout"]) {
      expect(prepareRequest({ action: "create", path, className: "MatPBRBasic" }).ok, path).toBe(
        true,
      );
    }
  });

  it("prefabFromModel: xobPath .xob resource name, new .et path, inherit .et", () => {
    const base = {
      action: "prefabFromModel",
      path: "Prefabs/a.et",
      xobPath: `${GUID}Assets/m.xob`,
    };
    expect(prepareRequest(base).ok).toBe(true);
    refuses({ ...base, xobPath: "Assets/m.xob" }, "INVALID_ARGUMENT", /xobPath/);
    refuses({ ...base, xobPath: `${GUID}Assets/m.fbx` }, "INVALID_ARGUMENT", /\.xob/);
    refuses({ ...base, path: "Prefabs/a.conf" }, "UNSUPPORTED_TYPE", /\.et/);
    refuses({ ...base, inherit: `${GUID}Prefabs/p.conf` }, "INVALID_ARGUMENT", /\.et/);
    expect(prepareRequest({ ...base, inherit: `${GUID}Prefabs/p.et` }).ok).toBe(true);
  });

  it("sends confirm: false for a write that left it out, and nothing for a read", () => {
    const w = prepareRequest({ action: "register", path: "a.conf" });
    expect(w.ok && w.kind === "handler" && w.params.confirm).toBe(false);
    const r = prepareRequest({ action: "search" });
    expect(r.ok && r.kind === "handler" && "confirm" in r.params).toBe(false);
  });

  it("normalises backslashes in a path", () => {
    const p = prepareRequest({ action: "register", path: "Configs\\a.conf" });
    expect(p.ok && p.kind === "handler" && p.params.path).toBe("Configs/a.conf");
  });

  it("checks the TS actions: getInfo accepts a {GUID}path, link needs one form", () => {
    expect(prepareRequest({ action: "getInfo", path: `${GUID}Prefabs/a.et` }).ok).toBe(true);
    expect(
      prepareRequest({ action: "getInfo", path: "Prefabs/a.et", expandResource: true }).ok,
    ).toBe(true);
    refuses({ action: "getInfo", path: "{12}x" }, "INVALID_ARGUMENT", /GUID/);
    refuses({ action: "getInfo", path: "a", extra: 1 }, "INVALID_ARGUMENT");
    refuses(
      { action: "link", addon: "A", path: "b.et", url: "enfusion://ResourceManager/~A:b.et" },
      "INVALID_ARGUMENT",
      /url, or addon and path/,
    );
    refuses({ action: "link", addon: "A" }, "INVALID_ARGUMENT", /addon and path/);
    refuses({ action: "link", addon: "a b", path: "x.et" }, "INVALID_ARGUMENT", /addon/);
    refuses({ action: "link", url: "http://x/y" }, "INVALID_ARGUMENT", /link is/);
  });
});

describe("search", () => {
  it("sends the filter as read and answers a page with its cursor", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        action: "search",
        total: 120,
        nextCursor: "50:120",
        capped: 0,
        items: [`${GUID}Configs/a.conf`],
        message: "120 hits",
      }),
    );
    const r = await runResources(client, {
      action: "search",
      rootPath: "$MyAddon:Configs/",
      extensions: ["conf"],
      searchStr: ["a"],
      tags: ["t"],
      recursive: false,
      limit: 50,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Resources");
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toMatchObject({
      action: "search",
      rootPath: "$MyAddon:Configs/",
      extensions: ["conf"],
      searchStr: ["a"],
      tags: ["t"],
      recursive: false,
      limit: 50,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe("root:$MyAddon:Configs/");
      expect(r.changed).toBeNull();
      expect(r.readback).toEqual({
        total: 120,
        items: [`${GUID}Configs/a.conf`],
        nextCursor: "50:120",
        capped: false,
      });
      expect(r.next).toMatch(/cursor "50:120"/);
    }
  });

  it("the last page has no cursor and no next", async () => {
    const { client } = fakeClient(() =>
      ok({ total: 2, nextCursor: "", capped: 0, items: ["a", "b"] }),
    );
    const r = await runResources(client, { action: "search", cursor: "1:2" });
    expect(r.ok && r.readback).toMatchObject({ nextCursor: null });
    expect(r.ok && r.next).toBeUndefined();
  });

  it("warns when the hits are capped (Enforce 1/0 booleans)", async () => {
    const { client } = fakeClient(() =>
      ok({
        total: 30000,
        capped: 1,
        nextCursor: "50:30000",
        items: [],
        message: "only the first 20000",
      }),
    );
    const r = await runResources(client, { action: "search" });
    expect(r.ok && r.readback).toMatchObject({ capped: true });
    expect(r.ok && r.warnings.join(" ")).toMatch(/20000/);
  });

  it("maps STALE_CURSOR", async () => {
    const { client } = fakeClient(() => refused("STALE_CURSOR", "was 3, now 4", "search again"));
    const r = await runResources(client, { action: "search", cursor: "1:3" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("STALE_CURSOR");
      expect(r.next).toBe("search again");
    }
  });

  it("search with no root names every addon in the target", async () => {
    const { client } = fakeClient(() => ok({ total: 0, items: [] }));
    const r = await runResources(client, { action: "search" });
    expect(r.ok && r.target).toBe("root:(all addons)");
  });
});

describe("selection, resolve, addons, newGuid, wait", () => {
  it("selection answers the items and the cap", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ total: 2500, capped: 1, items: ["a", "b"], message: "the first 2000 answered" }),
    );
    const r = await runResources(client, { action: "selection", recursive: false });
    expect(sent[0].params).toMatchObject({ action: "selection", recursive: false });
    expect(sent[0].options.access).toBe("read");
    expect(r.ok && r.readback).toEqual({ total: 2500, items: ["a", "b"], capped: true });
    expect(r.ok && r.warnings).toHaveLength(1);
  });

  it("resolve answers the names; no meta is a warning, not an error", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        resourceName: `${GUID}Configs/a.conf`,
        guid: "0123456789ABCDEF",
        relPath: "Configs/a.conf",
        absPath: "<home>/proj/Configs/a.conf",
        hasMeta: 0,
      }),
    );
    const r = await runResources(client, { action: "resolve", path: `${GUID}Configs/a.conf` });
    expect(sent[0].params.path).toBe(`${GUID}Configs/a.conf`);
    expect(r.ok && r.target).toBe(`path:${GUID}Configs/a.conf`);
    expect(r.ok && r.readback).toMatchObject({
      guid: "0123456789ABCDEF",
      relPath: "Configs/a.conf",
      hasMeta: false,
    });
    expect(r.ok && r.warnings[0]).toMatch(/no \.meta/);
  });

  it("resolve with a meta answers its source path", async () => {
    const { client } = fakeClient(() =>
      ok({ resourceName: "x", guid: "g", relPath: "a", absPath: "p", hasMeta: 1, sourcePath: "s" }),
    );
    const r = await runResources(client, { action: "resolve", path: "a.conf" });
    expect(r.ok && r.readback).toMatchObject({ hasMeta: true, sourcePath: "s" });
    expect(r.ok && r.warnings).toEqual([]);
  });

  it("resolve of an unknown GUID maps RESOURCE_NOT_FOUND", async () => {
    const { client } = fakeClient(() => refused("RESOURCE_NOT_FOUND", "no path for the GUID"));
    const r = await runResources(client, { action: "resolve", path: GUID });
    expect(r.ok === false && r.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("addons parses the rows, the title last with a pipe in it", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        total: 2,
        items: [
          "AAAA1111AAAA1111|ArmaReforger|true|true|Arma Reforger",
          "BBBB2222BBBB2222|My|false|false|a|b title",
        ],
        projectFile: "<home>/proj/addon.gproj",
      }),
    );
    const r = await runResources(client, { action: "addons", available: true });
    expect(sent[0].params).toMatchObject({ action: "addons", available: true });
    expect(r.ok && r.readback).toEqual({
      total: 2,
      addons: [
        {
          guid: "AAAA1111AAAA1111",
          id: "ArmaReforger",
          vanilla: true,
          loaded: true,
          title: "Arma Reforger",
        },
        { guid: "BBBB2222BBBB2222", id: "My", vanilla: false, loaded: false, title: "a|b title" },
      ],
      projectFile: "<home>/proj/addon.gproj",
    });
  });

  it("newGuid answers the guid", async () => {
    const { client, sent } = fakeClient(() => ok({ guid: "0123456789ABCDEF" }));
    const r = await runResources(client, { action: "newGuid" });
    expect(sent[0].params).toEqual({ action: "newGuid" });
    expect(r.ok && r.readback).toEqual({ guid: "0123456789ABCDEF" });
    expect(r.ok && r.target).toBe("guid");
  });

  it("wait: found, not found as data with a warning", async () => {
    const answers = [ok({ found: 1 }), ok({ found: 0, message: "not acknowledged within 500 ms" })];
    const { client, sent } = fakeClient((_p, n) => answers[n]);
    const a = await runResources(client, { action: "wait", path: "a.conf", timeoutMs: 500 });
    expect(a.ok && a.readback).toEqual({ path: "a.conf", found: true });
    expect(a.ok && a.warnings).toEqual([]);
    const b = await runResources(client, { action: "wait", path: "b.conf", timeoutMs: 500 });
    expect(b.ok).toBe(true);
    expect(b.ok && b.readback).toEqual({ path: "b.conf", found: false });
    expect(b.ok && b.warnings[0]).toMatch(/500 ms/);
    expect(sent[0].options.timeout).toBe(30_500);
  });
});

describe("register", () => {
  it("dry run by default: nothing written, next says confirm", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, registered: 0, message: "dry run: would register a.png" }),
    );
    const r = await runResources(client, { action: "register", path: "Textures/a.png" });
    expect(sent[0].params).toMatchObject({
      action: "register",
      path: "Textures/a.png",
      confirm: false,
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && r.readback).toMatchObject({ dryRun: true, registered: false });
    expect(r.ok && r.next).toMatch(/confirm: true/);
  });

  it("confirm registers and reports the new .meta", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        registered: 1,
        resourceName: `${GUID}Textures/a.png`,
        guid: "0123456789ABCDEF",
        dryRun: 0,
      }),
    );
    const r = await runResources(client, {
      action: "register",
      path: "Textures/a.png",
      buildRuntime: true,
      confirm: true,
    });
    expect(sent[0].params).toMatchObject({ confirm: true, buildRuntime: true });
    expect(r.ok && r.changed).toEqual([
      { path: "Textures/a.png.meta", before: null, after: `${GUID}Textures/a.png` },
    ]);
    expect(r.ok && r.readback).toMatchObject({
      registered: true,
      alreadyRegistered: false,
      dryRun: false,
    });
  });

  it("an already registered file is no change, whether or not confirm was sent", async () => {
    const { client } = fakeClient(() =>
      ok({
        registered: 1,
        dryRun: 1,
        resourceName: `${GUID}a.png`,
        message: "already registered; nothing was written",
      }),
    );
    const r = await runResources(client, { action: "register", path: "a.png" });
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && r.readback).toMatchObject({ alreadyRegistered: true, dryRun: false });
    expect(r.ok && r.next).toBeUndefined();
  });

  it("maps the guard and engine refusals", async () => {
    const a = fakeClient(() =>
      refused("NOT_IN_PROJECT", "outside the project", "write it into the project"),
    );
    const ra = await runResources(a.client, { action: "register", path: "a.png", confirm: true });
    expect(ra.ok === false && ra.code).toBe("NOT_IN_PROJECT");
    const b = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "RegisterResourceFile returned false",
      next: "read the log",
      registered: 0,
    }));
    const rb = await runResources(b.client, { action: "register", path: "a.png", confirm: true });
    expect(rb.ok === false && rb.code).toBe("ENGINE_FALSE");
    expect(rb.ok === false && rb.next).toBe("read the log");
  });
});

describe("rebuild", () => {
  it("dry run reports the count; one path goes as path", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, count: 1, message: "dry run: would rebuild 1 files" }),
    );
    const r = await runResources(client, { action: "rebuild", path: "a.png" });
    expect(sent[0].params).toMatchObject({ action: "rebuild", path: "a.png", confirm: false });
    expect(r.ok && r.target).toBe("path:a.png");
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && r.readback).toMatchObject({ dryRun: true, count: 1 });
    expect(r.ok && r.next).toMatch(/confirm: true/);
  });

  it("confirm: rebuilt and pending files, pending warns", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        dryRun: 0,
        count: 2,
        rebuilt: ["a.png"],
        pending: ["b.conf"],
        message: "rebuild requested",
      }),
    );
    const r = await runResources(client, {
      action: "rebuild",
      paths: ["a.png", "b.conf"],
      configuration: "PS5",
      timeoutMs: 2000,
      confirm: true,
    });
    expect(sent[0].params).toMatchObject({
      paths: ["a.png", "b.conf"],
      configuration: "PS5",
      confirm: true,
    });
    expect(sent[0].options.timeout).toBe(34_000);
    expect(r.ok && r.target).toBe("paths:2");
    expect(r.ok && r.readback).toMatchObject({ count: 2, rebuilt: ["a.png"], pending: ["b.conf"] });
    expect(r.ok && r.warnings[0]).toMatch(/1 file\(s\) not acknowledged/);
  });

  it("an unregistered file maps META_NOT_FOUND", async () => {
    const { client } = fakeClient(() =>
      refused("META_NOT_FOUND", "a.png is not registered", "wb_resources register first"),
    );
    const r = await runResources(client, { action: "rebuild", path: "a.png", confirm: true });
    expect(r.ok === false && r.code).toBe("META_NOT_FOUND");
    expect(r.ok === false && r.next).toBe("wb_resources register first");
  });

  it("caps the client timeout under the wedge threshold", () => {
    expect(timeoutFor("rebuild", { paths: Array(200).fill("x"), timeoutMs: 10_000 })).toBe(149_000);
    expect(timeoutFor("rebuild", { path: "a" })).toBe(31_000);
    expect(timeoutFor("search", {})).toBe(30_000);
  });
});

describe("import", () => {
  const rows = {
    before: ["PC:ColorSpace=Linear", "PC:Quality=1"],
    after: ["PC:ColorSpace=sRGB", "PC:Quality=2"],
  };

  it("dry run: wouldChange pairs before and after, nothing changed", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, resourceName: `${GUID}a.png`, guid: "g", ...rows, message: "dry run" }),
    );
    const r = await runResources(client, {
      action: "import",
      path: "a.png",
      settings: ["ColorSpace=sRGB", "Quality=2"],
      allPlatforms: true,
    });
    expect(sent[0].params).toMatchObject({
      action: "import",
      settings: ["ColorSpace=sRGB", "Quality=2"],
      allPlatforms: true,
      confirm: false,
    });
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && (r.readback as { wouldChange: unknown }).wouldChange).toEqual([
      { path: "PC.ColorSpace", before: "Linear", after: "sRGB" },
      { path: "PC.Quality", before: "1", after: "2" },
    ]);
    expect(r.ok && r.next).toMatch(/confirm: true/);
  });

  it("dry run on an unregistered file has no before: null, not a guess", async () => {
    const { client } = fakeClient(() => ok({ dryRun: 1, after: ["PC:ColorSpace=sRGB"] }));
    const r = await runResources(client, {
      action: "import",
      path: "a.png",
      settings: ["ColorSpace=sRGB"],
    });
    expect(r.ok && (r.readback as { wouldChange: unknown }).wouldChange).toEqual([
      { path: "PC.ColorSpace", before: null, after: "sRGB" },
    ]);
  });

  it("confirm: changed rows, the inverse named, a missing rebuild ack warns", async () => {
    const { client } = fakeClient(() =>
      ok({
        dryRun: 0,
        resourceName: `${GUID}a.png`,
        guid: "g",
        ...rows,
        rebuilt: [],
        message: "imported",
      }),
    );
    const r = await runResources(client, {
      action: "import",
      path: "a.png",
      settings: ["ColorSpace=sRGB", "Quality=2"],
      confirm: true,
    });
    expect(r.ok && r.changed).toEqual([
      { path: "PC.ColorSpace", before: "Linear", after: "sRGB" },
      { path: "PC.Quality", before: "1", after: "2" },
    ]);
    expect(r.ok && r.next).toMatch(/wb_meta set/);
    expect(r.ok && r.warnings[0]).toMatch(/rebuild was not acknowledged/);
  });

  it("a failed Set keeps what the handler read as the partial readback", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "Set returned false for PC:Quality",
      next: "read before and after",
      ...rows,
    }));
    const r = await runResources(client, {
      action: "import",
      path: "a.png",
      settings: ["Quality=2"],
      confirm: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("ENGINE_FALSE");
      expect(r.readback).toMatchObject({ before: rows.before, after: rows.after });
    }
  });

  it("a refusal after the file was registered keeps that write in the readback (review F1)", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "INVALID_ARGUMENT",
      message:
        "configuration PC has no variable Typo; no setting was written, but the file was registered (its .meta now exists)",
      next: "read the names with wb_meta vars",
      registered: 1,
      resourceName: `${GUID}a.png`,
      guid: "g",
    }));
    const r = await runResources(client, {
      action: "import",
      path: "a.png",
      settings: ["Typo=1"],
      confirm: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INVALID_ARGUMENT");
      expect(r.message).toMatch(/the file was registered/);
      expect(r.message).not.toMatch(/nothing was written/);
      expect(r.readback).toMatchObject({ registered: true, resourceName: `${GUID}a.png` });
    }
  });

  it("a plain refusal (nothing registered) carries no readback", async () => {
    const { client } = fakeClient(() =>
      refused("INVALID_ARGUMENT", "configuration PC has no variable Typo; nothing was written", "x"),
    );
    const r = await runResources(client, {
      action: "import",
      path: "a.png",
      settings: ["Typo=1"],
      confirm: true,
    });
    expect(r.ok === false && r.readback).toBeUndefined();
  });

  it("parseSettingRow keeps colons and equals in the value", () => {
    expect(parseSettingRow("PC:Path=a:b=c")).toEqual({
      configuration: "PC",
      name: "Path",
      value: "a:b=c",
    });
    expect(parseSettingRow("garbage")).toEqual({ configuration: "", name: "garbage", value: "" });
  });
});

describe("create and prefabFromModel", () => {
  it("create dry run answers the planned path", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, savedPath: "Configs/n.conf", message: "dry run" }),
    );
    const r = await runResources(client, {
      action: "create",
      path: "Configs/n.conf",
      className: "SCR_X",
      inherit: `${GUID}Configs/p.conf`,
    });
    expect(sent[0].params).toMatchObject({
      action: "create",
      path: "Configs/n.conf",
      className: "SCR_X",
      inherit: `${GUID}Configs/p.conf`,
      confirm: false,
    });
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && r.readback).toMatchObject({
      dryRun: true,
      savedPath: "Configs/n.conf",
      saved: false,
    });
    expect(r.ok && r.next).toMatch(/create the file/);
  });

  it("create confirm answers the file and its resource name", async () => {
    const { client } = fakeClient(() =>
      ok({
        dryRun: 0,
        saved: 1,
        savedPath: "Configs/n.conf",
        resourceName: `${GUID}Configs/n.conf`,
        guid: "g",
      }),
    );
    const r = await runResources(client, {
      action: "create",
      path: "Configs/n.conf",
      className: "SCR_X",
      confirm: true,
    });
    expect(r.ok && r.changed).toEqual([
      { path: "Configs/n.conf", before: null, after: `${GUID}Configs/n.conf` },
    ]);
    expect(r.ok && r.readback).toMatchObject({
      saved: true,
      resourceName: `${GUID}Configs/n.conf`,
      guid: "g",
    });
  });

  it("create: SAVE_FAILED and a written-but-unregistered file are errors with the partial state", async () => {
    const a = fakeClient(() => ({
      status: "error",
      code: "SAVE_FAILED",
      message: "SaveContainer returned false",
      next: "check the folder",
      saved: 0,
    }));
    const ra = await runResources(a.client, {
      action: "create",
      path: "n.conf",
      className: "X",
      confirm: true,
    });
    expect(ra.ok === false && ra.code).toBe("SAVE_FAILED");
    expect(ra.ok === false && ra.readback).toEqual({ saved: false });
    const b = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "written but not registered",
      next: "wb_resources register n.conf",
      saved: 1,
      savedPath: "n.conf",
    }));
    const rb = await runResources(b.client, {
      action: "create",
      path: "n.conf",
      className: "X",
      confirm: true,
    });
    expect(rb.ok === false && rb.readback).toEqual({ saved: true, savedPath: "n.conf" });
  });

  it("create: an existing file or a missing folder refuses before a write", async () => {
    const { client } = fakeClient(() =>
      refused("INVALID_ARGUMENT", "the file exists already: n.conf", "pick a new name"),
    );
    const r = await runResources(client, {
      action: "create",
      path: "n.conf",
      className: "X",
      confirm: true,
    });
    expect(r.ok === false && r.code).toBe("INVALID_ARGUMENT");
    expect(r.ok === false && r.readback).toBeUndefined();
  });

  it("prefabFromModel: dry run, then confirm", async () => {
    const answers = [
      ok({ dryRun: 1, savedPath: "Prefabs/p.et", message: "dry run" }),
      ok({
        dryRun: 0,
        saved: 1,
        savedPath: "Prefabs/p.et",
        resourceName: `${GUID}Prefabs/p.et`,
        guid: "g",
      }),
    ];
    const { client, sent } = fakeClient((_p, n) => answers[n]);
    const input = {
      action: "prefabFromModel",
      path: "Prefabs/p.et",
      xobPath: `${GUID}Assets/m.xob`,
    };
    const a = await runResources(client, input);
    expect(a.ok && a.changed).toBeNull();
    expect(a.ok && a.next).toMatch(/write the prefab/);
    const b = await runResources(client, { ...input, confirm: true });
    expect(sent[1].params).toMatchObject({ ...input, confirm: true });
    expect(sent[1].options.access).toBe("mutate");
    expect(b.ok && b.changed).toEqual([
      { path: "Prefabs/p.et", before: null, after: `${GUID}Prefabs/p.et` },
    ]);
  });

  it("prefabFromModel maps NO_WORLD and WRONG_MODE", async () => {
    for (const code of ["NO_WORLD", "WRONG_MODE"]) {
      const { client } = fakeClient(() => refused(code, `${code} text`, "open a world"));
      const r = await runResources(client, {
        action: "prefabFromModel",
        path: "Prefabs/p.et",
        xobPath: `${GUID}Assets/m.xob`,
        confirm: true,
      });
      expect(r.ok === false && r.code).toBe(code);
    }
  });
});

describe("handler failures and client errors", () => {
  it("an unknown handler code falls back with a warning", async () => {
    const { client } = fakeClient(() => refused("SOMETHING_NEW", "odd"));
    const r = await runResources(client, { action: "search" });
    expect(r.ok === false && r.code).toBe("INVALID_ARGUMENT");
    expect(r.ok === false && r.warnings[0]).toMatch(/SOMETHING_NEW/);
  });

  it("an error status without a code is ENGINE_FALSE; no message gets a default", async () => {
    const { client } = fakeClient(() => ({ status: "error" }));
    const r = await runResources(client, { action: "newGuid" });
    expect(r.ok === false && r.code).toBe("ENGINE_FALSE");
    expect(r.ok === false && r.message).toMatch(/error/);
  });

  it("a strange status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "weird" }));
    const r = await runResources(client, { action: "newGuid" });
    expect(r.ok === false && r.code).toBe("UNREACHABLE");
  });

  it("maps LOST, MODAL_OPEN and WEDGED, never retrying; a lost write says to read back", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`x ${code}`, code));
      const r = await runResources(client, { action: "register", path: "a.png", confirm: true });
      expect(r.ok === false && r.code, code).toBe(code);
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(r.ok === false && r.next).toMatch(/never retried/);
    }
    const read = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runResources(read.client, { action: "search" });
    expect(r.ok === false && r.code).toBe("LOST");
    expect(r.ok === false && r.next).not.toMatch(/never retried/);
  });

  it("another client error is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new Error("socket closed"));
    const r = await runResources(client, { action: "search" });
    expect(r.ok === false && r.code).toBe("UNREACHABLE");
  });

  it("sends nothing when the request is refused", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runResources(client, { action: "register", path: "C:/x/a.png", confirm: true });
    expect(r.ok === false && r.code).toBe("ABSOLUTE_PATH");
    expect(sent).toHaveLength(0);
  });
});

describe("getInfo (GetResourceInfo)", () => {
  it("calls the BI handler with path and expandResource, scrubs the home folder, warns of the prompt hazard", async () => {
    const { client, sent } = fakeClient(() => ({
      status: "ok",
      resourceName: `${GUID}Prefabs/a.et`,
      absolutePath: "C:\\Users\\Someone\\proj\\Prefabs\\a.et",
      data: { note: "C:/Users/Someone/x" },
      message: "",
    }));
    const r = await runResources(client, {
      action: "getInfo",
      path: "Prefabs/a.et",
      expandResource: true,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("GetResourceInfo");
    expect(sent[0].params).toEqual({ path: "Prefabs/a.et", expandResource: true });
    expect(sent[0].options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe("path:Prefabs/a.et");
      expect(r.readback).toEqual({
        resourceName: `${GUID}Prefabs/a.et`,
        absolutePath: "<home>\\proj\\Prefabs\\a.et",
        data: { note: "<home>/x" },
        message: "",
      });
      expect(r.warnings.join(" ")).toMatch(/Script Authorization/);
      expect(r.warnings.join(" ")).toMatch(/on-disk metas only/);
    }
  });

  it("expandResource defaults to false", async () => {
    const { client, sent } = fakeClient(() => ({ status: "ok" }));
    await runResources(client, { action: "getInfo", path: "a.et" });
    expect(sent[0].params).toEqual({ path: "a.et", expandResource: false });
  });

  it("a not-found answer is PATH_NOT_FOUND, another error is HANDLER_ERROR", async () => {
    const a = fakeClient(() => ({ status: "error", message: "Resource not found" }));
    const ra = await runResources(a.client, { action: "getInfo", path: "a.et" });
    expect(ra.ok === false && ra.code).toBe("PATH_NOT_FOUND");
    expect(ra.ok === false && ra.warnings.length).toBeGreaterThan(0);
    const b = fakeClient(() => ({ status: "error", message: "bad" }));
    const rb = await runResources(b.client, { action: "getInfo", path: "a.et" });
    expect(rb.ok === false && rb.code).toBe("HANDLER_ERROR");
  });

  it("maps a client error and keeps the warnings", async () => {
    const { client } = fakeClient(() => new WorkbenchError("modal", "MODAL_OPEN"));
    const r = await runResources(client, { action: "getInfo", path: "a.et" });
    expect(r.ok === false && r.code).toBe("MODAL_OPEN");
    expect(r.ok === false && r.warnings.length).toBe(2);
  });
});

describe("open (wb_module setResource)", () => {
  it("routes to EMCP_WB_Module setResource on the World Editor and answers as open", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ module: "WorldEditor", resource: "Worlds/a.ent", message: "opened in WorldEditor" }),
    );
    const r = await runResources(client, { action: "open", path: "Worlds/a.ent" });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Module");
    expect(sent[0].params).toMatchObject({ action: "setResource", path: "Worlds/a.ent" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("open");
      expect(r.target).toBe("path:Worlds/a.ent");
      expect(r.warnings.join(" ")).toMatch(/routed to wb_module setResource/);
      expect((r.readback as { routedTo: string }).routedTo).toBe("wb_module setResource");
    }
  });

  it("answers a module refusal under the action open", async () => {
    const { client } = fakeClient(() => refused("MODULE_NOT_OPEN", "the module is not open"));
    const r = await runResources(client, { action: "open", path: "Worlds/a.ent" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.action).toBe("open");
      expect(r.target).toBe("path:Worlds/a.ent");
      expect(r.code).toBe("MODULE_NOT_OPEN");
    }
  });

  it("a client error is mapped, not thrown", async () => {
    const { client } = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runResources(client, { action: "open", path: "Worlds/a.ent" });
    expect(r.ok === false && r.code).toBe("LOST");
    expect(r.action).toBe("open");
  });
});

describe("link", () => {
  it("builds enfusion://ResourceManager/~<Addon>:<path>", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runResources(client, {
      action: "link",
      addon: "ArmaReforger",
      path: "Prefabs\\Props\\a.et",
    });
    expect(sent).toHaveLength(0);
    expect(r.ok && r.readback).toEqual({
      url: "enfusion://ResourceManager/~ArmaReforger:Prefabs/Props/a.et",
      addon: "ArmaReforger",
      path: "Prefabs/Props/a.et",
    });
    expect(r.ok && r.changed).toBeNull();
  });

  it("parses a link and round-trips", async () => {
    const { client } = fakeClient(() => ok());
    const url = "enfusion://ResourceManager/~My_Addon-2:Configs/a b.conf";
    const parsed = await runResources(client, { action: "link", url });
    expect(parsed.ok && parsed.readback).toEqual({
      url,
      addon: "My_Addon-2",
      path: "Configs/a b.conf",
    });
    const rebuilt = resolveLink({ mode: "build", addon: "My_Addon-2", path: "Configs/a b.conf" });
    expect(rebuilt.url).toBe(url);
  });

  it("a parsed link with a parent path or absolute path is refused", async () => {
    const { client } = fakeClient(() => ok());
    const r = await runResources(client, {
      action: "link",
      url: "enfusion://ResourceManager/~A:../x.et",
    });
    expect(r.ok === false && r.code).toBe("ABSOLUTE_PATH");
  });
});

describe("1.x names (a test per mapped name)", () => {
  it("every 1.x name is listed and mapped", () => {
    expect([...LEGACY_ACTIONS].sort()).toEqual(Object.keys(LEGACY_MAP).sort());
  });

  it("browse is search, with a warning naming the mapping", async () => {
    const { client, sent } = fakeClient(() => ok({ total: 1, items: ["a"], nextCursor: "" }));
    const r = await runResources(client, {
      action: "browse",
      rootPath: "$A:Configs/",
      extensions: ["conf"],
      limit: 10,
    });
    expect(sent[0].params).toMatchObject({
      action: "search",
      rootPath: "$A:Configs/",
      extensions: ["conf"],
      limit: 10,
    });
    expect(sent[0].options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("browse");
      expect(r.warnings[0]).toMatch(/1\.x action name 'browse': sent as search/);
      expect(r.readback).toMatchObject({ total: 1, items: ["a"] });
    }
  });

  it("browse refuses what search refuses", () => {
    const p = prepareRequest({ action: "browse", rootPath: "C:/x" });
    expect(p.ok === false && p.error.code).toBe("ABSOLUTE_PATH");
  });

  it("1.x register (path, buildRuntime) is register: a dry run until confirm", async () => {
    const { client, sent } = fakeClient(() => ok({ dryRun: 1, registered: 0, message: "dry run" }));
    const r = await runResources(client, {
      action: "register",
      path: "Textures/a.png",
      buildRuntime: true,
    });
    expect(sent[0].params).toMatchObject({
      action: "register",
      buildRuntime: true,
      confirm: false,
    });
    expect(r.ok && r.next).toMatch(/confirm: true/);
  });

  it("1.x rebuild (path) is rebuild; its buildRuntime is refused, not dropped", async () => {
    const { client, sent } = fakeClient(() => ok({ dryRun: 1, count: 1 }));
    const a = await runResources(client, { action: "rebuild", path: "a.png" });
    expect(sent[0].params).toMatchObject({ action: "rebuild", path: "a.png", confirm: false });
    expect(a.ok).toBe(true);
    const b = await runResources(client, { action: "rebuild", path: "a.png", buildRuntime: true });
    expect(b.ok === false && b.code).toBe("INVALID_ARGUMENT");
    expect(sent).toHaveLength(1);
  });

  it("1.x getInfo (path) is getInfo", async () => {
    const { client, sent } = fakeClient(() => ({ status: "ok", resourceName: "x" }));
    const r = await runResources(client, { action: "getInfo", path: "Prefabs/a.et" });
    expect(sent[0].fn).toBe("GetResourceInfo");
    expect(r.ok).toBe(true);
  });

  it("1.x open (path) is open: wb_module setResource", async () => {
    const { client, sent } = fakeClient(() => ok({ module: "WorldEditor" }));
    const r = await runResources(client, { action: "open", path: "Worlds/a.ent" });
    expect(sent[0].fn).toBe("EMCP_WB_Module");
    expect(r.ok && r.action).toBe("open");
  });
});

describe("wb_world aliases (OD-6)", () => {
  it("names the two wb_world actions and the wb_resources actions they stand for", () => {
    expect(WORLD_ALIAS_MAP).toEqual({ register: "register", browserSelection: "selection" });
    for (const to of Object.values(WORLD_ALIAS_MAP)) expect(HANDLER_ACTIONS).toContain(to);
  });

  it("wb_world register routes to wb_resources register with path and confirm", () => {
    expect(
      routeWorldAlias("register", { action: "register", path: "Worlds\\a.ent", confirm: true }),
    ).toEqual({
      tool: "wb_resources",
      args: { action: "register", path: "Worlds/a.ent", confirm: true },
    });
    expect(routeWorldAlias("register", { path: "Worlds/a.ent" }).args).toEqual({
      action: "register",
      path: "Worlds/a.ent",
    });
  });

  it("wb_world browserSelection routes to wb_resources selection", () => {
    expect(routeWorldAlias("browserSelection", { action: "browserSelection" })).toEqual({
      tool: "wb_resources",
      args: { action: "selection" },
    });
  });

  it("the routed args pass this tool's own checks and reach the handler", async () => {
    const { client, sent } = fakeClient(() => ok({ total: 0, items: [], capped: 0 }));
    const route = routeWorldAlias("browserSelection", {});
    const r = await runResources(client, route.args);
    expect(r.ok).toBe(true);
    expect(sent[0].params.action).toBe("selection");
  });

  it("refuses another wb_world action, a missing path and an argument with no equivalent", () => {
    expect(() => routeWorldAlias("state", {})).toThrow(/not a wb_resources alias/);
    expect(() => routeWorldAlias("register", {})).toThrow(/path is required/);
    expect(() => routeWorldAlias("register", { path: "a.ent", overwrite: true })).toThrow(
      /overwrite/,
    );
    expect(() => routeWorldAlias("browserSelection", { recursive: false })).toThrow(/recursive/);
    expect(() => routeWorldAlias("register", { path: "C:/a.ent" })).toThrow(/absolute/);
  });
});

describe("helpers", () => {
  it("parseAddonRows pads missing cells", () => {
    expect(parseAddonRows(["g|id"])).toEqual([
      { guid: "g", id: "id", vanilla: false, loaded: false, title: "" },
    ]);
  });

  it("scrubHome removes a home folder in the three forms", () => {
    expect(scrubHome("C:\\Users\\Bob\\p and C:/Users/Bob/q")).toBe("<home>\\p and <home>/q");
    expect(scrubHome("/home/bob/x and /Users/bob/y")).toBe("<home>/x and <home>/y");
    expect(scrubHome("Configs/a.conf")).toBe("Configs/a.conf");
  });
});

describe("registerProjectFile (the 1.x callers game_duplicate and wb_entity_duplicate)", () => {
  const addon = resolve("proj", "MyAddon");
  const file = join(addon, "Prefabs", "x.et");

  it("sends the project-relative path with confirm true and buildRuntime false", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ registered: 1, dryRun: 0, resourceName: `${GUID}Prefabs/x.et` }),
    );
    const r = await registerProjectFile(client, addon, file);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.fn).toBe("EMCP_WB_Resources");
    expect(sent[0]!.params).toEqual({
      action: "register",
      path: "Prefabs/x.et",
      buildRuntime: false,
      confirm: true,
    });
    // Every key sent is a declared request key of the register action.
    const keys = RESOURCES_CONTRACT.actions
      .find((a) => a.name === "register")!
      .params.map((p) => p.key);
    for (const k of Object.keys(sent[0]!.params)) if (k !== "action") expect(keys).toContain(k);
    expect(r.resourceName).toBe(`${GUID}Prefabs/x.et`);
    expect(r.ok).toBe(true);
  });

  it("is not ok on a dry run, a refusal or an answer without registered", async () => {
    for (const answer of [
      ok({ registered: 1, dryRun: 1 }),
      ok({ registered: 0 }),
      refused("NOT_IN_PROJECT", "outside the project"),
    ]) {
      const { client } = fakeClient(() => answer);
      const r = await registerProjectFile(client, addon, file);
      expect(r.ok).toBe(false);
    }
    const { client } = fakeClient(() => refused("NOT_IN_PROJECT", "outside the project"));
    expect((await registerProjectFile(client, addon, file)).message).toBe(
      "NOT_IN_PROJECT: outside the project",
    );
  });

  it("sends nothing for a file outside the addon folder", async () => {
    const { client, sent } = fakeClient(() => ok({ registered: 1 }));
    const outside = resolve("other", "x.et");
    const r = await registerProjectFile(client, addon, outside);
    expect(r.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/wb_resources.addons
// census:mcp:action/wb_resources.create
// census:mcp:action/wb_resources.getInfo
// census:mcp:action/wb_resources.import
// census:mcp:action/wb_resources.newGuid
// census:mcp:action/wb_resources.prefabFromModel
// census:mcp:action/wb_resources.rebuild
// census:mcp:action/wb_resources.register
// census:mcp:action/wb_resources.resolve
// census:mcp:action/wb_resources.wait
