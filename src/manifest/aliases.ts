import { checkRelativePath, owningModule, VocabularyError } from "./vocabulary.js";

/**
 * Alias router (phase3-tool-surface.md section 2): 1.x tool names routed to a Phase 3 tool action.
 * Aliases are not listed except under ENFUSION_TOOLSET=all (tiers.ts). A 1.x argument with no
 * equivalent is refused with INVALID_ARGUMENT naming the tool and action to use, never dropped.
 */

export interface RoutedCall {
  tool: string;
  args: Record<string, unknown>;
}

type Mapper = (args: Record<string, unknown>) => RoutedCall;

// ── 1.x wb_entity_* helpers (OD-1, DEC-061) ──────────────────────────────────

function refuse(message: string): never {
  throw new VocabularyError("INVALID_ARGUMENT", message);
}

/** A required non-empty string argument. */
function needString(args: Record<string, unknown>, key: string, use: string): string {
  const v = args[key];
  if (typeof v !== "string" || v === "") refuse(`${key} is required (${use})`);
  return v;
}

/** A 1.x entity name as a W1 entity reference. */
function nameRef(name: string): string {
  return `name:${name}`;
}

/** The given keys that hold a value (undefined and null count as absent). */
function present(args: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((k) => args[k] !== undefined && args[k] !== null);
}

/**
 * 1.x wb_entity_modify property path: `[propertyPath.]propertyKey`. A propertyPath that is one
 * bare segment is the component class name 1.x looked up first, so it becomes
 * `components[<Class>]` (wb_container resolves the class to its index, the KD-008 fix); a
 * dotted or bracketed propertyPath is used as it is.
 */
function modifyPath(args: Record<string, unknown>, key?: string): string {
  const raw = typeof args.propertyPath === "string" ? args.propertyPath.trim() : "";
  const owner = /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) ? `components[${raw}]` : raw;
  if (key === undefined) return owner;
  return owner === "" ? key : `${owner}.${key}`;
}

const MODIFY_PROPERTY_ACTIONS = [
  "setProperty",
  "clearProperty",
  "getProperty",
  "listProperties",
  "listArrayItems",
  "addArrayItem",
  "removeArrayItem",
  "setObjectClass",
];

export const ALIAS_ROUTES: Readonly<Record<string, Mapper>> = Object.freeze({
  wb_open_resource: (args) => {
    if (typeof args.path !== "string")
      throw new VocabularyError("INVALID_ARGUMENT", "path is required");
    const path = checkRelativePath(args.path);
    // The module that owns the file type, never the World Editor for a non-world file (W2 run 2).
    return {
      tool: "wb_module",
      args: { action: "setResource", module: owningModule(path), target: `path:${path}` },
    };
  },
  wb_save: (args) => {
    if (args.path !== undefined) {
      throw new VocabularyError("INVALID_ARGUMENT", "Save As is not supported; omit path");
    }
    // Phase 3 saves are dry runs unless the caller passes confirm: true (design section 6);
    // the 1.x alias follows the same rule, so a bare wb_save reports what it would save.
    return {
      tool: "wb_module",
      args: {
        action: "save",
        module: "WorldEditor",
        target: "open:WorldEditor",
        ...(args.confirm === true ? { confirm: true } : {}),
      },
    };
  },
  wb_validate_scripts: (args) => ({ tool: "wb_scripts", args: { ...args, action: "validate" } }),
  // 1.x `target` (scripts|plugins|both) is not the Phase 3 `target`; it moves to `scope`.
  wb_reload: (args) => {
    const { target, ...rest } = args;
    const routed: Record<string, unknown> = { ...rest, action: "reload" };
    if (target !== undefined) routed.scope = target;
    return { tool: "wb_scripts", args: routed };
  },
  // OD-1 (DEC-061): the 1.x entity tools fold into wb_entity, wb_view and wb_container.
  wb_entity_create: (args) => {
    if (present(args, ["layerID"]).length > 0) {
      refuse(
        "layerID has no equivalent: wb_entity create takes layer, a layer path (wb_layers list); omit it for the active layer",
      );
    }
    const routed: Record<string, unknown> = {
      action: "create",
      prefab: needString(args, "prefab", "a class name or {GUID}path"),
    };
    if (typeof args.position === "string" && args.position !== "") routed.coords = args.position;
    if (typeof args.rotation === "string" && args.rotation !== "") routed.angles = args.rotation;
    if (typeof args.name === "string" && args.name !== "") routed.name = args.name;
    return { tool: "wb_entity", args: routed };
  },
  wb_entity_delete: (args) => ({
    tool: "wb_entity",
    args: { action: "delete", entities: [nameRef(needString(args, "name", "the entity name"))] },
  }),
  wb_entity_list: (args) => {
    if (typeof args.offset === "number" && args.offset !== 0) {
      refuse(
        "offset has no equivalent: page with wb_entity list cursor (the nextCursor it answers)",
      );
    }
    const routed: Record<string, unknown> = { action: "list" };
    if (args.limit !== undefined) routed.limit = args.limit;
    if (typeof args.nameFilter === "string" && args.nameFilter !== "")
      routed.name = args.nameFilter;
    return { tool: "wb_entity", args: routed };
  },
  wb_entity_inspect: (args) => {
    const given = present(args, ["name", "index"]).filter((k) => args[k] !== "");
    if (given.length !== 1) refuse("give exactly one of name or index (wb_entity get entity)");
    const entity =
      given[0] === "name"
        ? nameRef(String(args.name))
        : typeof args.index === "number" && Number.isInteger(args.index) && args.index >= 0
          ? `index:${args.index}`
          : refuse("index must be an integer 0 or more");
    return { tool: "wb_entity", args: { action: "get", entity } };
  },
  // Routes per 1.x action; written inline so the census reads every route (E11 readAliasRoutes).
  wb_entity_modify: (args): RoutedCall => {
    const name = needString(args, "name", "the 1.x entity name");
    const action = typeof args.action === "string" ? args.action : "";
    const ref = nameRef(name);
    const value = typeof args.value === "string" ? args.value : undefined;
    const needValue = (what: string): string => {
      if (value === undefined || value.trim() === "")
        refuse(`value is required for ${action} (${what})`);
      return value;
    };
    // Keys the routed action has no use for are refused, never dropped.
    const onlyKeys = (allowed: readonly string[], use: string): void => {
      const extra = present(args, ["value", "propertyPath", "propertyKey"]).filter(
        (k) => !allowed.includes(k),
      );
      const idx = args.memberIndex;
      if (!allowed.includes("memberIndex") && idx !== undefined && idx !== -1)
        extra.push("memberIndex");
      if (extra.length > 0)
        refuse(`${extra.join(", ")} has no equivalent for ${action}: use ${use}`);
    };
    switch (action) {
      case "move":
        onlyKeys(["value"], "wb_entity transform");
        return {
          tool: "wb_entity",
          args: { action: "transform", entity: ref, coords: needValue("'x y z'") },
        };
      case "rotate":
        onlyKeys(["value"], "wb_entity transform");
        return {
          tool: "wb_entity",
          args: { action: "transform", entity: ref, angles: needValue("'pitch yaw roll'") },
        };
      case "rename":
        onlyKeys(["value"], "wb_entity rename");
        return {
          tool: "wb_entity",
          args: { action: "rename", entity: ref, name: needValue("new name") },
        };
      case "reparent":
        onlyKeys(["value"], "wb_entity parent");
        // 1.x called ParentEntity(parent, entity, false): keepWorldTransform false is that call.
        return {
          tool: "wb_entity",
          args: {
            action: "parent",
            parent: nameRef(needValue("parent name")),
            entities: [ref],
            keepWorldTransform: false,
          },
        };
      case "getWorldTransform":
        onlyKeys([], "wb_entity get (coords and angles)");
        return { tool: "wb_entity", args: { action: "get", entity: ref } };
      case "makeVisible":
        onlyKeys([], "wb_view select");
        return { tool: "wb_view", args: { action: "select", mode: "set", entities: [ref] } };
      default:
        break;
    }
    if (!MODIFY_PROPERTY_ACTIONS.includes(action))
      refuse(`unknown wb_entity_modify action '${action}'`);
    const target = `entity:${ref}`;
    const key = (): string => needString(args, "propertyKey", `${action} names the property`);
    switch (action) {
      case "setProperty": {
        onlyKeys(["value", "propertyPath", "propertyKey"], "wb_container set");
        if (value === undefined) refuse("value is required for setProperty");
        return {
          tool: "wb_container",
          args: {
            action: "set",
            target,
            path: modifyPath(args, key()),
            value,
            ...(value === "" ? { emptyValue: true } : {}),
          },
        };
      }
      case "clearProperty":
        onlyKeys(["propertyPath", "propertyKey"], "wb_container clear");
        return {
          tool: "wb_container",
          args: { action: "clear", target, path: modifyPath(args, key()) },
        };
      case "getProperty":
        onlyKeys(["propertyPath", "propertyKey"], "wb_container get");
        return {
          tool: "wb_container",
          args: { action: "get", target, path: modifyPath(args, key()) },
        };
      case "listProperties":
        // describe lists the whole entity; it has no per-path filter.
        onlyKeys([], `wb_container describe with target ${target} (rows carry their paths)`);
        return { tool: "wb_container", args: { action: "describe", target } };
      case "listArrayItems":
        // Not routed: wb_entity_modify answers it on its 1.x handler (wb-entities.ts
        // runListArrayItems), since no wb_container action lists array elements.
        return refuse(
          `listArrayItems has no wb_container action: wb_entity_modify answers it on its 1.x handler; else use wb_container describe with target ${target} and read the rows under the array path`,
        );
      case "addArrayItem": {
        onlyKeys(["value", "propertyPath", "propertyKey", "memberIndex"], "wb_container arrayAdd");
        const index = typeof args.memberIndex === "number" ? args.memberIndex : -1;
        return {
          tool: "wb_container",
          args: {
            action: "arrayAdd",
            target,
            path: modifyPath(args, key()),
            className: needValue("item class"),
            index,
          },
        };
      }
      case "removeArrayItem": {
        onlyKeys(["propertyPath", "propertyKey", "memberIndex"], "wb_container arrayRemove");
        const index = args.memberIndex;
        if (typeof index !== "number" || index < 0) {
          refuse("removeArrayItem needs memberIndex 0 or more (wb_container arrayRemove index)");
        }
        return {
          tool: "wb_container",
          args: { action: "arrayRemove", target, path: modifyPath(args, key()), index },
        };
      }
      default: // setObjectClass
        onlyKeys(["value", "propertyPath", "propertyKey"], "wb_container setClass");
        return {
          tool: "wb_container",
          args: {
            action: "setClass",
            target,
            path: modifyPath(args, key()),
            className: needValue("new class"),
          },
        };
    }
  },
  wb_entity_select: (args) => {
    const action = typeof args.action === "string" ? args.action : "";
    if (action === "getSelected" || action === "clear") {
      if (present(args, ["name"]).length > 0 && args.name !== "") {
        refuse(
          `name has no use for ${action}: wb_view ${action === "clear" ? "select" : "selection"} takes none`,
        );
      }
      return action === "clear"
        ? { tool: "wb_view", args: { action: "select", mode: "clear" } }
        : { tool: "wb_view", args: { action: "selection" } };
    }
    if (action !== "select" && action !== "deselect")
      refuse(`unknown wb_entity_select action '${action}'`);
    const ref = nameRef(needString(args, "name", `${action} names the entity`));
    return {
      tool: "wb_view",
      args: { action: "select", mode: action === "select" ? "set" : "remove", entities: [ref] },
    };
  },
  // W5 OD-1 (DEC-068): the 1.x .ptc reader is particle inspect; particle_path becomes path. The
  // shim (particle-inspect.ts) still lets this alias read an absolute .ptc on disk.
  particle_inspect: (args) => {
    const extra = present(args, Object.keys(args)).filter(
      (k) => !["particle_path", "cursor", "limit"].includes(k),
    );
    if (extra.length > 0)
      refuse(`${extra.join(", ")} has no equivalent: use the particle tool (action inspect)`);
    const routed: Record<string, unknown> = {
      action: "inspect",
      path: needString(args, "particle_path", "the .ptc to read"),
    };
    if (args.cursor !== undefined) routed.cursor = args.cursor;
    if (args.limit !== undefined) routed.limit = args.limit;
    return { tool: "particle", args: routed };
  },
  // W5 OD-1 (DEC-068): the 1.x placeholder is wb_navmesh status, which reads the open world.
  terrain_navmesh_status: (args) => {
    if (present(args, ["world_path"]).length > 0 && args.world_path !== "") {
      refuse(
        "world_path has no equivalent: wb_navmesh status reads the world open in the World Editor; open it (wb_module setResource) and omit world_path",
      );
    }
    const extra = present(args, Object.keys(args)).filter(
      (k) => !["world_path", "project", "step", "cursor", "limit"].includes(k),
    );
    if (extra.length > 0) refuse(`${extra.join(", ")} has no equivalent: use wb_navmesh status`);
    const routed: Record<string, unknown> = { action: "status" };
    for (const k of ["project", "step", "cursor", "limit"]) {
      if (args[k] !== undefined && args[k] !== null) routed[k] = args[k];
    }
    return { tool: "wb_navmesh", args: routed };
  },
  // W8 OD-1 (DEC-076): the 1.x menu runner is wb_menu run on the World Editor (the only module
  // EMCP_WB_ExecuteAction drives). menuPath becomes path; confirm passes through, so a mutating
  // or unknown item is a dry run unless confirm: true, as on wb_menu run.
  wb_execute_action: (args) => {
    const extra = present(args, Object.keys(args)).filter(
      (k) => !["menuPath", "confirm"].includes(k),
    );
    if (extra.length > 0) refuse(`${extra.join(", ")} has no equivalent: use wb_menu run`);
    return {
      tool: "wb_menu",
      args: {
        action: "run",
        module: "WorldEditor",
        path: needString(args, "menuPath", "the comma-separated menu path"),
        ...(args.confirm === true ? { confirm: true } : {}),
      },
    };
  },
});

// ── Action aliases: one action of a listed tool that has a home in another tool ──

/**
 * Ruling W2 OD-6 (DEC-063): `wb_world register` and `wb_world browserSelection` stay as aliases
 * of the wb_resources actions `register` and `selection`, their home since wave W2. wb_world keeps
 * answering both on EMCP_WB_World, the route the W1 battery proved live (39 of 39 steps on
 * 1.9.0.37); routeActionAlias gives the wb_resources call each one stands for. The answers differ
 * in shape (wb_world: alreadyRegistered and resources; wb_resources: registered and items).
 */
export const ACTION_ALIASES: Readonly<Record<string, Mapper>> = Object.freeze({
  "wb_world.register": (args) => {
    const extra = present(args, Object.keys(args)).filter(
      (k) => !["action", "path", "confirm"].includes(k),
    );
    if (extra.length > 0)
      refuse(`wb_world register ${extra.join(", ")} has no wb_resources register equivalent`);
    const path = checkRelativePath(needString(args, "path", "register"));
    return {
      tool: "wb_resources",
      args: {
        action: "register",
        path,
        ...(args.confirm === undefined ? {} : { confirm: args.confirm }),
      },
    };
  },
  "wb_world.browserSelection": (args) => {
    const extra = present(args, Object.keys(args)).filter((k) => k !== "action");
    if (extra.length > 0)
      refuse(
        `wb_world browserSelection ${extra.join(", ")} has no wb_resources selection equivalent`,
      );
    return { tool: "wb_resources", args: { action: "selection" } };
  },
});

/** The wb_resources call `<tool>.<action>` stands for; undefined when it is not an action alias. */
export function routeActionAlias(
  tool: string,
  action: string,
  args: Record<string, unknown>,
): RoutedCall | undefined {
  const key = `${tool}.${action}`;
  return Object.hasOwn(ACTION_ALIASES, key) ? ACTION_ALIASES[key]({ ...args, action }) : undefined;
}

export function isAlias(name: string): boolean {
  return Object.hasOwn(ALIAS_ROUTES, name);
}

/** Routes an alias call; returns undefined for a name that is not an alias. */
export function routeAlias(name: string, args: Record<string, unknown>): RoutedCall | undefined {
  return isAlias(name) ? ALIAS_ROUTES[name](args) : undefined;
}
