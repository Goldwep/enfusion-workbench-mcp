import { describe, it, expect } from "vitest";
import {
  ALIAS_TOOLS,
  CORE_TOOLS,
  filterTools,
  parseToolOverrides,
  parseToolset,
  shouldRegister,
  tierOf,
} from "../../src/manifest/tiers.js";
import {
  ACTION_ALIASES,
  ALIAS_ROUTES,
  isAlias,
  routeActionAlias,
  routeAlias,
} from "../../src/manifest/aliases.js";
import { RESOURCES_CONTRACT, routeWorldAlias } from "../../src/tools/wb-resources.js";
import { VocabularyError } from "../../src/manifest/vocabulary.js";

describe("tiers", () => {
  it("has 26 core tools and thirteen aliases, disjoint", () => {
    expect(CORE_TOOLS).toHaveLength(26);
    expect(new Set(CORE_TOOLS).size).toBe(26);
    expect(ALIAS_TOOLS).toHaveLength(13);
    expect(ALIAS_TOOLS.filter((a) => (CORE_TOOLS as readonly string[]).includes(a))).toEqual([]);
  });

  it("puts the W1 nouns in core and the six 1.x entity tools in alias (OD-1)", () => {
    for (const t of ["wb_entity", "wb_view", "wb_world"]) expect(tierOf(t)).toBe("core");
    for (const t of [
      "wb_entity_create",
      "wb_entity_delete",
      "wb_entity_inspect",
      "wb_entity_list",
      "wb_entity_modify",
      "wb_entity_select",
    ])
      expect(tierOf(t)).toBe("alias");
    // A composite with no single W1 action: stays on its 1.x handlers, extended.
    expect(tierOf("wb_entity_duplicate")).toBe("extended");
    expect(tierOf("wb_component")).toBe("extended");
  });

  it("tiers the W2 and W3 tools: wb_meta core, script_lsp extended (DEC-063)", () => {
    expect(tierOf("wb_meta")).toBe("core");
    expect(tierOf("script_lsp")).toBe("extended");
    for (const t of ["wb_resources", "wb_validate", "wb_script_editor", "wb_localization"])
      expect(tierOf(t)).toBe("extended");
  });

  it("treats a name missing from the table as extended", () => {
    expect(tierOf("wb_state")).toBe("core");
    expect(tierOf("wb_save")).toBe("alias");
    expect(tierOf("terrain_inspect")).toBe("extended");
  });

  it("parses ENFUSION_TOOLSET with core as default and refuses junk", () => {
    expect(parseToolset(undefined)).toBe("core");
    expect(parseToolset(" Extended ")).toBe("extended");
    expect(() => parseToolset("most")).toThrow(/core, extended or all/);
  });

  it("parses +name,-name overrides", () => {
    const o = parseToolOverrides("+terrain_inspect, -wiki_read,game_duplicate");
    expect([...o.add].sort()).toEqual(["game_duplicate", "terrain_inspect"]);
    expect([...o.remove]).toEqual(["wiki_read"]);
  });

  it("filters by toolset: core, extended without aliases, all with aliases", () => {
    const tools = ["wb_state", "terrain_inspect", "wb_save"].map((name) => ({ name }));
    const names = (env: NodeJS.ProcessEnv) => filterTools(tools, env).map((t) => t.name);
    expect(names({})).toEqual(["wb_state"]);
    expect(names({ ENFUSION_TOOLSET: "extended" })).toEqual(["wb_state", "terrain_inspect"]);
    expect(names({ ENFUSION_TOOLSET: "all" })).toEqual(["wb_state", "terrain_inspect", "wb_save"]);
  });

  it("applies overrides on top, with -name winning", () => {
    expect(shouldRegister("terrain_inspect", { ENFUSION_TOOLS: "+terrain_inspect" })).toBe(true);
    expect(shouldRegister("wb_state", { ENFUSION_TOOLS: "-wb_state" })).toBe(false);
    expect(shouldRegister("x", { ENFUSION_TOOLS: "+x,-x" })).toBe(false);
  });
});

describe("alias router", () => {
  it("routes every alias tier entry and nothing else", () => {
    expect(Object.keys(ALIAS_ROUTES).sort()).toEqual([...ALIAS_TOOLS].sort());
    expect(isAlias("wb_state")).toBe(false);
    expect(routeAlias("wb_state", {})).toBeUndefined();
  });

  it("maps wb_open_resource to wb_module setResource with a path target", () => {
    expect(routeAlias("wb_open_resource", { path: "Worlds\\a.ent" })).toEqual({
      tool: "wb_module",
      args: { action: "setResource", module: "WorldEditor", target: "path:Worlds/a.ent" },
    });
  });

  it("refuses an absolute path through the alias with ABSOLUTE_PATH", () => {
    try {
      routeAlias("wb_open_resource", { path: "C:/x/a.ent" });
      expect.unreachable();
    } catch (e) {
      expect((e as VocabularyError).code).toBe("ABSOLUTE_PATH");
    }
  });

  it("maps wb_save to wb_module save and refuses a Save As path", () => {
    expect(routeAlias("wb_save", {})).toEqual({
      tool: "wb_module",
      args: { action: "save", module: "WorldEditor", target: "open:WorldEditor" },
    });
    expect(() => routeAlias("wb_save", { path: "a.ent" })).toThrow(/Save As/);
    // A bare wb_save is a dry run; confirm: true passes through and nothing else does.
    expect(routeAlias("wb_save", { confirm: true })?.args).toMatchObject({ confirm: true });
    expect(routeAlias("wb_save", { confirm: "yes" })?.args).not.toHaveProperty("confirm");
  });

  it("puts the W4, W5 and W6 tools in extended and the two W5 1.x readers in alias", () => {
    for (const t of [
      "wb_anim",
      "wb_anim_debug",
      "animation_workspace",
      "animation_set",
      "procanim",
      "audio",
      "particle",
      "navmesh",
      "wb_audio",
      "wb_particle",
      "wb_navmesh",
      "wb_world_tools",
      "wb_shape",
    ])
      expect(tierOf(t)).toBe("extended");
    for (const t of ["particle_inspect", "terrain_navmesh_status"]) expect(tierOf(t)).toBe("alias");
  });

  it("maps particle_inspect to particle inspect, particle_path to path (W5 OD-1)", () => {
    expect(routeAlias("particle_inspect", { particle_path: "Particles/a.ptc" })).toEqual({
      tool: "particle",
      args: { action: "inspect", path: "Particles/a.ptc" },
    });
    expect(
      routeAlias("particle_inspect", { particle_path: "a.ptc", cursor: "2:9", limit: 5 })?.args,
    ).toEqual({ action: "inspect", path: "a.ptc", cursor: "2:9", limit: 5 });
    expect(() => routeAlias("particle_inspect", {})).toThrow(/particle_path is required/);
    expect(() => routeAlias("particle_inspect", { particle_path: "a.ptc", emitter: "x" })).toThrow(
      /emitter has no equivalent/,
    );
  });

  it("puts the W7 and W8 tools in extended and wb_execute_action in alias (DEC-075, DEC-076)", () => {
    for (const t of [
      "wb_terrain_edit",
      "wb_generator",
      "wb_settings",
      "wb_link",
      "wb_diag",
      "wb_menu",
      "terrain_road_export_graph",
    ])
      expect(tierOf(t)).toBe("extended");
    expect(tierOf("wb_execute_action")).toBe("alias");
  });

  it("maps wb_execute_action to wb_menu run on the World Editor (W8 OD-1)", () => {
    expect(routeAlias("wb_execute_action", { menuPath: "Window,Hierarchy" })).toEqual({
      tool: "wb_menu",
      args: { action: "run", module: "WorldEditor", path: "Window,Hierarchy" },
    });
    expect(
      routeAlias("wb_execute_action", { menuPath: "Edit,Undo", confirm: true })?.args,
    ).toMatchObject({ confirm: true });
    expect(
      routeAlias("wb_execute_action", { menuPath: "Edit,Undo", confirm: "yes" })?.args,
    ).not.toHaveProperty("confirm");
    expect(() => routeAlias("wb_execute_action", {})).toThrow(/menuPath is required/);
    expect(() => routeAlias("wb_execute_action", { menuPath: "Edit,Undo", module: "X" })).toThrow(
      /module has no equivalent/,
    );
  });

  it("maps terrain_navmesh_status to wb_navmesh status and refuses world_path (W5 OD-1)", () => {
    expect(routeAlias("terrain_navmesh_status", {})).toEqual({
      tool: "wb_navmesh",
      args: { action: "status" },
    });
    expect(
      routeAlias("terrain_navmesh_status", { project: "Soldiers", step: "64", limit: 10 })?.args,
    ).toEqual({ action: "status", project: "Soldiers", step: "64", limit: 10 });
    expect(() => routeAlias("terrain_navmesh_status", { world_path: "Worlds/a.ent" })).toThrow(
      /world_path has no equivalent/,
    );
    expect(() => routeAlias("terrain_navmesh_status", { tile: 1 })).toThrow(
      /tile has no equivalent/,
    );
  });

  it("maps the script aliases to wb_scripts actions", () => {
    expect(routeAlias("wb_validate_scripts", {})).toEqual({
      tool: "wb_scripts",
      args: { action: "validate" },
    });
    expect(routeAlias("wb_reload", { action: "x" })).toEqual({
      tool: "wb_scripts",
      args: { action: "reload" },
    });
  });

  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      return (e as VocabularyError).code;
    }
  };

  it("maps wb_entity_create to wb_entity create and refuses layerID", () => {
    expect(
      routeAlias("wb_entity_create", {
        prefab: "P",
        position: "1 2 3",
        rotation: "0 90 0",
        name: "A",
      }),
    ).toEqual({
      tool: "wb_entity",
      args: { action: "create", prefab: "P", coords: "1 2 3", angles: "0 90 0", name: "A" },
    });
    expect(code(() => routeAlias("wb_entity_create", { prefab: "P", layerID: 0 }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(() => routeAlias("wb_entity_create", { prefab: "P", layerID: 2 })).toThrow(
      /wb_entity create takes layer/,
    );
  });

  it("maps wb_entity_delete, _list and _inspect to wb_entity", () => {
    expect(routeAlias("wb_entity_delete", { name: "A" })).toEqual({
      tool: "wb_entity",
      args: { action: "delete", entities: ["name:A"] },
    });
    expect(routeAlias("wb_entity_list", { offset: 0, limit: 50, nameFilter: "x" })).toEqual({
      tool: "wb_entity",
      args: { action: "list", limit: 50, name: "x" },
    });
    expect(() => routeAlias("wb_entity_list", { offset: 10, limit: 50 })).toThrow(/cursor/);
    expect(routeAlias("wb_entity_inspect", { name: "A" })?.args).toEqual({
      action: "get",
      entity: "name:A",
    });
    expect(routeAlias("wb_entity_inspect", { index: 3 })?.args).toEqual({
      action: "get",
      entity: "index:3",
    });
    expect(code(() => routeAlias("wb_entity_inspect", {}))).toBe("INVALID_ARGUMENT");
    expect(code(() => routeAlias("wb_entity_inspect", { name: "A", index: 1 }))).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("maps wb_entity_modify per action and refuses what has no equivalent", () => {
    const m = (a: Record<string, unknown>) => routeAlias("wb_entity_modify", { name: "A", ...a });
    expect(m({ action: "move", value: "1 2 3", memberIndex: -1 })).toEqual({
      tool: "wb_entity",
      args: { action: "transform", entity: "name:A", coords: "1 2 3" },
    });
    expect(m({ action: "rotate", value: "0 90 0" })?.args).toMatchObject({ angles: "0 90 0" });
    expect(m({ action: "rename", value: "B" })?.args).toEqual({
      action: "rename",
      entity: "name:A",
      name: "B",
    });
    expect(m({ action: "reparent", value: "P" })?.args).toEqual({
      action: "parent",
      parent: "name:P",
      entities: ["name:A"],
      keepWorldTransform: false,
    });
    expect(m({ action: "getWorldTransform" })?.args).toEqual({ action: "get", entity: "name:A" });
    expect(m({ action: "makeVisible" })).toEqual({
      tool: "wb_view",
      args: { action: "select", mode: "set", entities: ["name:A"] },
    });
    expect(
      m({ action: "setProperty", propertyPath: "MeshObject", propertyKey: "Object", value: "" }),
    ).toEqual({
      tool: "wb_container",
      args: {
        action: "set",
        target: "entity:name:A",
        path: "components[MeshObject].Object",
        value: "",
        emptyValue: true,
      },
    });
    expect(m({ action: "getProperty", propertyPath: "a.b[2]", propertyKey: "k" })?.args).toEqual({
      action: "get",
      target: "entity:name:A",
      path: "a.b[2].k",
    });
    expect(m({ action: "clearProperty", propertyKey: "k" })?.args).toMatchObject({
      action: "clear",
      path: "k",
    });
    expect(m({ action: "listProperties" })?.args).toEqual({
      action: "describe",
      target: "entity:name:A",
    });
    expect(
      m({ action: "addArrayItem", propertyKey: "arr", value: "C", memberIndex: -1 })?.args,
    ).toEqual({
      action: "arrayAdd",
      target: "entity:name:A",
      path: "arr",
      className: "C",
      index: -1,
    });
    expect(
      m({ action: "removeArrayItem", propertyKey: "arr", memberIndex: 2 })?.args,
    ).toMatchObject({ action: "arrayRemove", index: 2 });
    expect(m({ action: "setObjectClass", propertyKey: "o", value: "C" })?.args).toMatchObject({
      action: "setClass",
      className: "C",
    });
    // Refused, naming the tool and action to use.
    expect(() => m({ action: "listArrayItems", propertyKey: "arr" })).toThrow(
      /wb_container describe/,
    );
    expect(() => m({ action: "listProperties", propertyPath: "X" })).toThrow(
      /wb_container describe/,
    );
    expect(() => m({ action: "removeArrayItem", propertyKey: "arr", memberIndex: -1 })).toThrow(
      /arrayRemove/,
    );
    expect(() => m({ action: "move", value: "1 2 3", propertyKey: "k" })).toThrow(
      /wb_entity transform/,
    );
    expect(code(() => m({ action: "move" }))).toBe("INVALID_ARGUMENT");
  });

  it("maps wb_entity_select to wb_view", () => {
    expect(routeAlias("wb_entity_select", { action: "select", name: "A" })).toEqual({
      tool: "wb_view",
      args: { action: "select", mode: "set", entities: ["name:A"] },
    });
    expect(routeAlias("wb_entity_select", { action: "deselect", name: "A" })?.args).toMatchObject({
      mode: "remove",
    });
    expect(routeAlias("wb_entity_select", { action: "clear" })?.args).toEqual({
      action: "select",
      mode: "clear",
    });
    expect(routeAlias("wb_entity_select", { action: "getSelected" })?.args).toEqual({
      action: "selection",
    });
    expect(code(() => routeAlias("wb_entity_select", { action: "select" }))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code(() => routeAlias("wb_entity_select", { action: "clear", name: "A" }))).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("moves the 1.x wb_reload target enum to scope, never the reserved target", () => {
    expect(routeAlias("wb_reload", { target: "plugins" })).toEqual({
      tool: "wb_scripts",
      args: { action: "reload", scope: "plugins" },
    });
    expect(routeAlias("wb_reload", {})?.args).not.toHaveProperty("scope");
  });
});

describe("action aliases (W2 OD-6, DEC-063)", () => {
  it("routes wb_world register and browserSelection to wb_resources register and selection", () => {
    expect(Object.keys(ACTION_ALIASES).sort()).toEqual([
      "wb_world.browserSelection",
      "wb_world.register",
    ]);
    expect(
      routeActionAlias("wb_world", "register", { path: "Worlds/a.ent", confirm: true }),
    ).toEqual({
      tool: "wb_resources",
      args: { action: "register", path: "Worlds/a.ent", confirm: true },
    });
    expect(routeActionAlias("wb_world", "register", { path: "Worlds\\a.ent" })).toEqual({
      tool: "wb_resources",
      args: { action: "register", path: "Worlds/a.ent" },
    });
    expect(routeActionAlias("wb_world", "browserSelection", {})).toEqual({
      tool: "wb_resources",
      args: { action: "selection" },
    });
    expect(routeActionAlias("wb_world", "state", {})).toBeUndefined();
    expect(routeActionAlias("wb_entity", "register", { path: "a.et" })).toBeUndefined();
  });

  it("every routed action is a wb_resources contract action", () => {
    const actions = RESOURCES_CONTRACT.actions.map((a) => a.name);
    for (const [key, map] of Object.entries(ACTION_ALIASES)) {
      const r = map(key.endsWith("register") ? { path: "a.et" } : {});
      expect(r.tool).toBe("wb_resources");
      expect(actions).toContain(r.args.action);
    }
  });

  it("refuses an argument with no equivalent and an absolute path", () => {
    expect(() => routeActionAlias("wb_world", "register", { path: "a.et", force: true })).toThrow(
      /force has no wb_resources register equivalent/,
    );
    expect(() => routeActionAlias("wb_world", "register", {})).toThrow(/path is required/);
    try {
      routeActionAlias("wb_world", "register", { path: "C:/x/a.et" });
      expect.unreachable();
    } catch (e) {
      expect((e as VocabularyError).code).toBe("ABSOLUTE_PATH");
    }
    expect(() => routeActionAlias("wb_world", "browserSelection", { recursive: true })).toThrow(
      /recursive has no wb_resources selection equivalent/,
    );
  });

  it("wb_resources routeWorldAlias reads the same table", () => {
    expect(routeWorldAlias("register", { action: "register", path: "a.et" })).toEqual(
      routeActionAlias("wb_world", "register", { path: "a.et" }),
    );
    expect(routeWorldAlias("browserSelection", { action: "browserSelection" })).toEqual(
      routeActionAlias("wb_world", "browserSelection", {}),
    );
    expect(() => routeWorldAlias("state", {})).toThrow(/not a wb_resources alias/);
  });
});
