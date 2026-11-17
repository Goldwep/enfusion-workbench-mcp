/**
 * `wb_link`: enfusion:// Workbench links (wave W8, phase5-w8-spec.md section 2.3; DEC-076 OD-7).
 *
 *   parse     read, TS: kind, world, pos, angles, time, entity, path, line of a link
 *   build     read, TS: a link from kind and fields (webPrefix wraps it in the redirect prefix)
 *   fromView  read: the open World Editor view as a link (wb_module list, wb_world state for
 *             WorldEditorAPI.GetWorldPath, wb_view camera); written as the vanilla
 *             SCR_WorldEditorToolHelper.GetCurrentWorldEditorLink writes it
 *   open      mutating: dispatches a link through the owning tools (rule 1.2.4): wb_module open,
 *             then wb_module setResource / wb_view setCamera and select / wb_script_editor open.
 *             A dry run unless `confirm: true`; with confirm it is GATED until probe P-W8-11
 *             passes (switch LINK_GATES.open). A world link naming another world than the open
 *             one refuses WORLD_DIFFERS in the dry run; confirm switches the world.
 *
 * A web link is parsed and answered, and `open` refuses it NOT_ALLOWLISTED: nothing here starts
 * the OS protocol handler or a browser. A link behind the web redirect prefix is dispatched by
 * its inner enfusion:// link. The Particle Editor is never opened (DEC-042, OI-W8-4).
 * Nothing here names a sandbox or a project. Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { DESCRIPTION_MAX } from "../manifest/generate.js";
import {
  ERROR_CODES,
  VocabularyError,
  checkRelativePath,
  normalizeEntityId,
  owningModule,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
  type ModuleId,
} from "../manifest/vocabulary.js";
import {
  LINK_KINDS,
  LINK_MODULES,
  buildLink,
  formatLink,
  numberText,
  parseLink,
  worldFieldOf,
  worldKey,
  type BuildFields,
  type ParsedLink,
} from "../formats/enfusion-link.js";
import { runModule, type ModuleClient, type ModuleResponse } from "./wb-module.js";
import { runScriptEditor } from "./wb-script-editor.js";
import { runView, type ViewResponse } from "./wb-view.js";
import { runWorld, type WorldResponse } from "./wb-world.js";
import { lookOf } from "./wb-world-tools.js";

export const TOOL_NAME = "wb_link";
export const ACTIONS = ["parse", "build", "fromView", "open"] as const;
export type LinkAction = (typeof ACTIONS)[number];
export const READ_ACTIONS: readonly LinkAction[] = ["parse", "build", "fromView"];

/** Spec 1.1 (362 chars). */
export const WB_LINK_DESCRIPTION =
  "enfusion:// links. parse and build: WorldEditor (world;pos;angles;time;entity), ResourceManager (~addon:path), ScriptEditor (path;line), editor-only links, the web redirect prefix. fromView: the open World Editor view as a link. open: dispatch a link through wb_module, wb_view and wb_script_editor (dry run unless confirm). Web links are answered, never opened.";

/** The switch of the gated route. Closed until probe P-W8-11 passes; the integrator opens it. */
export const LINK_GATES = { open: false };
export const LINK_OPEN_PROBE = "P-W8-11";
export const OPEN_GATE_REASON = `open with confirm waits for probe ${LINK_OPEN_PROBE} (each link kind dispatched through the owning tools with no dialog); nothing was sent. Switch: LINK_GATES.open (src/tools/wb-link.ts).`;
export const OPEN_GATE_NEXT =
  "the dry run (without confirm) shows the route; parse, build and fromView are open";

/** WORLD_DIFFERS (spec 1.2 rule 10) is in src/manifest/vocabulary.ts. */
export type LinkCode = ErrorCode;

export type LinkError = Omit<ActionError, "code"> & { code: LinkCode; readback?: unknown };
export type LinkResponse = ActionOk | LinkError;

/** The client surface this tool needs (a fake in tests). */
export type LinkClient = Pick<WorkbenchClient, "call" | "probe">;

export interface LinkDeps {
  /** Overrides LINK_GATES (tests and the probe). */
  gates?: { open: boolean };
}

type Raw = Record<string, unknown>;

const ACTION_KEYS: Record<LinkAction, readonly string[]> = {
  parse: ["link"],
  build: [
    "kind",
    "module",
    "world",
    "addon",
    "path",
    "pos",
    "angles",
    "time",
    "entity",
    "line",
    "webPrefix",
  ],
  fromView: ["webPrefix"],
  open: ["link", "confirm"],
};

function nextOf(code: LinkCode): string {
  return ERROR_CODES[code];
}

function fail(
  action: string,
  target: string,
  code: LinkCode,
  message: string,
  next?: string,
): LinkError {
  return { ok: false, action, target, code, message, next: next || nextOf(code), warnings: [] };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function rec(v: unknown): Raw {
  return typeof v === "object" && v !== null ? (v as Raw) : {};
}

/** A child tool's error answered as this tool's, under this action and target. */
function childError(
  action: string,
  target: string,
  step: string,
  r: ModuleResponse | ViewResponse | WorldResponse | ActionError | LinkError,
  readback?: unknown,
): LinkError {
  const e = r as ActionError;
  const f = fail(action, target, e.code, `${step}: ${e.message}`, e.next);
  f.warnings.push(...(e.warnings ?? []));
  if (readback !== undefined) f.readback = readback;
  return f;
}

// ── Request checks ────────────────────────────────────────────────────────────

export type Prepared =
  | { ok: true; action: LinkAction; target: string; params: Raw }
  | { ok: false; error: LinkError };

/** The answer's target: the module or path a link names. */
export function targetOfLink(p: ParsedLink): string {
  if (p.kind === "web") return "link:web";
  if (p.kind === "editor") return `module:${p.module}`;
  if (p.kind === "world") return "open:WorldEditor";
  return `path:${p.path ?? ""}`;
}

/** Checks a request; nothing is sent when this refuses. */
export function prepareRequest(input: unknown): Prepared {
  const raw = rec(input);
  const action = str(raw.action);
  const refuse = (code: LinkCode, message: string, target = "link"): Prepared => ({
    ok: false,
    error: fail(action, target, code, message),
  });
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return refuse("INVALID_ARGUMENT", `unknown action '${action}'; one of ${ACTIONS.join(", ")}`);
  }
  const a = action as LinkAction;
  const allowed = ACTION_KEYS[a];
  const extra = Object.keys(raw).filter(
    (k) => k !== "action" && raw[k] !== undefined && !allowed.includes(k),
  );
  if (extra.length > 0) {
    return refuse(
      "INVALID_ARGUMENT",
      `${extra.join(", ")} ${extra.length === 1 ? "does" : "do"} not apply to ${a} (takes ${allowed.join(", ") || "nothing"})`,
    );
  }
  for (const k of ["webPrefix", "confirm"]) {
    if (raw[k] !== undefined && typeof raw[k] !== "boolean") {
      return refuse("INVALID_ARGUMENT", `${k} must be true or false`);
    }
  }
  const params: Raw = { ...raw };
  delete params.action;
  if (a === "parse" || a === "open") {
    if (typeof raw.link !== "string" || raw.link.trim() === "") {
      return refuse("INVALID_ARGUMENT", `${a} needs link (an enfusion:// link or a web link)`);
    }
  }
  if (a === "fromView") return { ok: true, action: a, target: "open:WorldEditor", params };
  if (a === "open") {
    try {
      const parsed = parseLink(str(raw.link));
      params.confirm = raw.confirm === true;
      return { ok: true, action: a, target: targetOfLink(parsed), params };
    } catch (e) {
      if (e instanceof VocabularyError) return refuse(e.code, e.message);
      throw e;
    }
  }
  if (a === "build") {
    if (
      typeof raw.kind !== "string" ||
      raw.kind === "web" ||
      !LINK_KINDS.includes(raw.kind as never)
    ) {
      return refuse(
        "INVALID_ARGUMENT",
        "build needs kind: world, resource, script or editor (a web link is answered by parse, never built)",
      );
    }
    for (const k of ["module", "world", "addon", "path", "entity"]) {
      if (raw[k] !== undefined && typeof raw[k] !== "string") {
        return refuse("INVALID_ARGUMENT", `${k} must be a string`);
      }
    }
    for (const k of ["pos", "angles", "time"]) {
      const v = raw[k];
      if (
        v !== undefined &&
        typeof v !== "string" &&
        !(Array.isArray(v) && v.every((n) => typeof n === "number"))
      ) {
        return refuse("INVALID_ARGUMENT", `${k} must be numbers (an array) or "a,b,c" text`);
      }
    }
    if (raw.line !== undefined && (typeof raw.line !== "number" || !Number.isInteger(raw.line))) {
      return refuse("INVALID_ARGUMENT", "line must be a whole number");
    }
  }
  return { ok: true, action: a, target: "link", params };
}

// ── parse and build ───────────────────────────────────────────────────────────

/** The parse answer for one link (the spec's keys, null when absent). */
export function describeLink(p: ParsedLink): Raw {
  return {
    kind: p.kind,
    module: p.module ?? null,
    webPrefix: p.webPrefix,
    url: p.url ?? null,
    world: p.world ?? null,
    addon: p.addon ?? null,
    path: p.path ?? null,
    pos: p.pos ? p.pos.values : null,
    angles: p.angles
      ? { pitch: p.angles.values[0], yaw: p.angles.values[1], roll: p.angles.values[2] }
      : null,
    time: p.time
      ? { daytime: p.time.daytime, year: p.time.year, month: p.time.month, day: p.time.day }
      : null,
    entity: p.entity ?? null,
    line: p.line ?? null,
    link: formatLink(p),
  };
}

function runParse(params: Raw): LinkResponse {
  const text = str(params.link).trim();
  let p: ParsedLink;
  try {
    p = parseLink(text);
  } catch (e) {
    if (e instanceof VocabularyError) return fail("parse", "link", e.code, e.message);
    throw e;
  }
  const warnings: string[] = [];
  if (p.kind === "web") {
    warnings.push("a web link: answered here, never opened (wb_link open refuses it)");
  }
  if (p.webPrefix)
    warnings.push("the web redirect prefix was read; the link inside it is answered");
  const ok: ActionOk = {
    ok: true,
    action: "parse",
    target: targetOfLink(p),
    changed: null,
    readback: { ...describeLink(p), roundTrip: formatLink(p) === text },
    warnings,
  };
  if (p.kind !== "web") ok.next = "wb_link open with this link shows the route (dry run)";
  return ok;
}

function runBuild(params: Raw): LinkResponse {
  try {
    const { parsed } = buildLink(params as unknown as BuildFields);
    return {
      ok: true,
      action: "build",
      target: targetOfLink(parsed),
      changed: null,
      readback: describeLink(parsed),
      warnings: [],
      next: "wb_link open with this link shows the route (dry run)",
    };
  } catch (e) {
    if (e instanceof VocabularyError) return fail("build", "link", e.code, e.message);
    throw e;
  }
}

// ── fromView ──────────────────────────────────────────────────────────────────

async function openModules(
  client: LinkClient,
  action: string,
  target: string,
): Promise<{ open: string[] } | { error: LinkError }> {
  const r = await runModule(client as ModuleClient, { action: "list" });
  if (!r.ok) return { error: childError(action, target, "wb_module list", r) };
  const open = rec(r.readback).open;
  return { open: Array.isArray(open) ? open.map(String) : [] };
}

/** "a b c" from a handler (Enforce float ToString), as three texts. */
function triple(text: string): string[] | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(Number(x)))) return null;
  return parts;
}

async function runFromView(client: LinkClient, params: Raw): Promise<LinkResponse> {
  const action = "fromView";
  const target = "open:WorldEditor";
  const mods = await openModules(client, action, target);
  if ("error" in mods) return mods.error;
  if (!mods.open.includes("WorldEditor")) {
    return fail(
      action,
      target,
      "MODULE_NOT_OPEN",
      "the World Editor is not open, so there is no view to link",
      "wb_module open WorldEditor, then open a world",
    );
  }
  const w = await runWorld(client, { action: "state" });
  if (!w.ok) return childError(action, target, "wb_world state", w);
  const worldPath = str(rec(w.readback).worldPath);
  const world = worldFieldOf(worldPath);
  if (!world) {
    return fail(
      action,
      target,
      "NO_WORLD",
      worldPath === ""
        ? "GetWorldPath answered no path: no world is open, or it is not saved to a file"
        : `GetWorldPath answered '${worldPath}', which has no worlds/ part a link can carry`,
    );
  }
  const v = await runView(client, { action: "camera" });
  if (!v.ok) return childError(action, target, "wb_view camera", v);
  const cam = rec(v.readback);
  const pos = triple(str(cam.coords));
  const ang = triple(str(cam.angles));
  const warnings: string[] = [];
  let fields: BuildFields;
  if (!pos || !ang) {
    warnings.push(
      `the camera read gave no usable position or angles ('${str(cam.coords)}', '${str(cam.angles)}'): the link names the world only`,
    );
    fields = { kind: "world", world };
  } else if ([...pos, ...ang].every((x) => Number(x) === 0)) {
    // Vanilla writes the world only when both are 0 0 0.
    fields = { kind: "world", world };
  } else {
    // MatrixToAngles answers yaw, pitch, roll; the link writes pitch, yaw, roll (vanilla order).
    fields = {
      kind: "world",
      world,
      pos: pos.join(","),
      angles: [ang[1], ang[0], ang[2]].join(","),
    };
  }
  fields.webPrefix = params.webPrefix === true;
  let built: { link: string; parsed: ParsedLink };
  try {
    built = buildLink(fields);
  } catch (e) {
    if (e instanceof VocabularyError) {
      return fail(action, target, e.code, `the view does not make a valid link: ${e.message}`);
    }
    throw e;
  }
  warnings.push("time of day and the selected entity are not part of a link read from the view");
  return {
    ok: true,
    action,
    target,
    changed: null,
    readback: { ...describeLink(built.parsed), worldPath },
    warnings,
  };
}

// ── open ──────────────────────────────────────────────────────────────────────

export interface RouteStep {
  tool: "wb_module" | "wb_view" | "wb_script_editor";
  args: Raw;
  /** The step as one line ("wb_module open WorldEditor"). */
  text: string;
}

function step(tool: RouteStep["tool"], args: Raw): RouteStep {
  const a = str(args.action);
  let text = `${tool} ${a}`;
  if (tool === "wb_module") {
    text += ` ${str(args.module)}`;
    if (args.target) text += ` ${str(args.target)}`;
  } else if (tool === "wb_script_editor") text += ` ${str(args.path)}`;
  else if (a === "setCamera") text += ` coords ${str(args.coords)} look ${str(args.look)}`;
  else if (a === "select") text += ` ${(args.entities as string[]).join(" ")}`;
  return { tool, args, text };
}

/** A link path as wb_module and wb_script_editor take it; throws VocabularyError. */
function routePath(p: ParsedLink): string {
  return checkRelativePath(p.path ?? "");
}

/**
 * The route of a link (rule 1.2.4: the owning module first). `switchWorld` adds the world load.
 * Throws VocabularyError for a path no tool takes. Warnings name what no route applies.
 */
export function planRoute(
  p: ParsedLink,
  switchWorld: boolean,
): { steps: RouteStep[]; warnings: string[] } {
  const steps: RouteStep[] = [];
  const warnings: string[] = [];
  if (p.kind === "editor") {
    steps.push(step("wb_module", { action: "open", module: p.module }));
    return { steps, warnings };
  }
  if (p.kind === "world") {
    const path = routePath(p);
    steps.push(step("wb_module", { action: "open", module: "WorldEditor" }));
    if (switchWorld) {
      steps.push(
        step("wb_module", { action: "setResource", module: "WorldEditor", target: `path:${path}` }),
      );
    }
    if (p.pos) {
      const rot = (p.angles?.values ?? [0, 0, 0]) as [number, number, number];
      steps.push(
        step("wb_view", {
          action: "setCamera",
          coords: p.pos.values.map(numberText).join(" "),
          look: lookOf(rot).map(numberText).join(" "),
        }),
      );
    } else if (p.angles) {
      warnings.push("the link has angles but no position: the camera is not moved");
    }
    if (p.time) {
      warnings.push(
        "the time of day is not applied: no route sets it (wb_view has no time action)",
      );
    }
    if (p.entity) {
      const id = normalizeEntityId(p.entity);
      if (id)
        steps.push(step("wb_view", { action: "select", mode: "set", entities: [`id:${id}`] }));
      else warnings.push(`the entity '${p.entity}' is not a hex EntityID: it is not selected`);
    }
    if (p.addon) {
      warnings.push(
        `the addon '${p.addon}' is not passed: the world opens by its relative path, resolved across the loaded addons`,
      );
    }
    return { steps, warnings };
  }
  const path = routePath(p);
  const owner = owningModule(path);
  if (p.kind === "script") {
    if (owner !== "ScriptEditor") {
      throw new VocabularyError(
        "INVALID_ARGUMENT",
        `a Script Editor link names a script (.c), got ${path}; nothing was opened`,
      );
    }
    steps.push(step("wb_module", { action: "open", module: "ScriptEditor" }));
    steps.push(step("wb_script_editor", { action: "open", path }));
    if (p.line !== undefined) {
      warnings.push(
        `line ${p.line} is not applied: no route moves the Script Editor caret to a line (wb_script_editor jump takes a symbol)`,
      );
    }
  } else {
    // A Resource Manager link opens in the module that owns the file type (wb_module setResource
    // takes no other): a .conf in the Resource Manager, a .ent or .et in the World Editor.
    if (owner !== "ResourceManager") {
      warnings.push(
        `${path} is opened by ${owner}, the module that owns its file type (wb_module setResource takes no other)`,
      );
    }
    steps.push(step("wb_module", { action: "open", module: owner }));
    steps.push(step("wb_module", { action: "setResource", module: owner, target: `path:${path}` }));
  }
  if (p.addon) {
    warnings.push(
      `the addon '${p.addon}' is not passed: the file opens by its relative path, resolved across the loaded addons`,
    );
  }
  return { steps, warnings };
}

async function runStep(client: LinkClient, s: RouteStep): Promise<ActionOk | ActionError> {
  if (s.tool === "wb_module") {
    return runModule(client as ModuleClient, s.args as unknown as Parameters<typeof runModule>[1]);
  }
  if (s.tool === "wb_view") return runView(client, s.args);
  return (await runScriptEditor(client, s.args)) as ActionOk | ActionError;
}

async function runOpen(client: LinkClient, params: Raw, deps: LinkDeps): Promise<LinkResponse> {
  const action = "open";
  const p = parseLink(str(params.link));
  const target = targetOfLink(p);
  const confirm = params.confirm === true;
  const gates = deps.gates ?? LINK_GATES;
  if (p.kind === "web") {
    return fail(
      action,
      target,
      "NOT_ALLOWLISTED",
      `a web link is answered, never opened: no browser or OS protocol launch (${p.url})`,
      "wb_link parse reads it",
    );
  }
  const module: string | undefined =
    p.kind === "editor"
      ? p.module
      : p.kind === "resource" || p.kind === "script"
        ? owningModule(p.path ?? "")
        : "WorldEditor";
  if (module === "ParticleEditor") {
    return fail(
      action,
      target,
      "MODULE_NOT_SUPPORTED",
      "the Particle Editor is never opened from here: reading its module crashed the Workbench (DEC-042; OI-W8-4)",
      "the owner opens it by hand",
    );
  }
  // The gate answers before anything is sent, reads included.
  if (confirm && !gates.open)
    return fail(action, target, "GATED", OPEN_GATE_REASON, OPEN_GATE_NEXT);

  // The open world, read only when the World Editor is already open (GetModule would open it).
  let switchWorld = false;
  let openWorld: string | null = null;
  const warnings: string[] = [];
  if (p.kind === "world") {
    const mods = await openModules(client, action, target);
    if ("error" in mods) return mods.error;
    if (mods.open.includes("WorldEditor")) {
      const w = await runWorld(client, { action: "state" });
      if (w.ok) openWorld = str(rec(w.readback).worldPath) || null;
      else if (w.code !== "NO_WORLD") return childError(action, target, "wb_world state", w);
    }
    switchWorld = openWorld === null || worldKey(openWorld) !== worldKey(p.world ?? "");
    if (openWorld !== null && switchWorld && !confirm) {
      return fail(
        action,
        target,
        "WORLD_DIFFERS",
        `the link names ${p.world}, the open world is ${openWorld}; nothing was changed`,
        `confirm: true loads ${p.world} (wb_module setResource), then moves the camera; save the open world first if it holds edits`,
      );
    }
    if (openWorld !== null && switchWorld) {
      warnings.push(
        `the open world ${openWorld} is replaced by ${p.world}; unsaved edits in it are the editor's to handle`,
      );
    }
  }

  let plan: { steps: RouteStep[]; warnings: string[] };
  try {
    plan = planRoute(p, switchWorld);
  } catch (e) {
    if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
    throw e;
  }
  warnings.push(...plan.warnings);
  if (p.webPrefix) warnings.push("the web redirect prefix was removed; the link inside it is used");
  const via = plan.steps.map((s) => s.text);

  if (!confirm) {
    const ok: ActionOk = {
      ok: true,
      action,
      target,
      changed: null,
      readback: { dryRun: true, dispatched: false, via, kind: p.kind, openWorld },
      warnings: [...warnings, "dry run: nothing was sent past the reads"],
      next: gates.open
        ? "Resend with confirm: true to dispatch the link."
        : `Dispatching waits for probe ${LINK_OPEN_PROBE}; confirm answers GATED until then.`,
    };
    return ok;
  }

  const done: string[] = [];
  const changed: Change[] = [];
  for (const s of plan.steps) {
    const r = await runStep(client, s);
    if (!r.ok) {
      const e = childError(action, target, s.text, r, { dryRun: false, dispatched: done, via });
      if (done.length > 0) {
        e.warnings.push(`partly dispatched: ${done.join("; ")} ran before this step failed`);
      }
      return e;
    }
    done.push(s.text);
    if (r.changed) changed.push(...r.changed);
    warnings.push(...r.warnings.map((w) => `${s.text}: ${w}`));
  }
  return {
    ok: true,
    action,
    target,
    changed: changed.length > 0 ? changed : null,
    readback: { dryRun: false, dispatched: true, via: done, kind: p.kind, openWorld },
    warnings,
    ...(p.kind === "world" && p.pos
      ? { next: "wb_view camera reads the view back; wb_link fromView links it" }
      : {}),
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_link request end to end; never throws for a Workbench-side failure. */
export async function runLink(
  client: LinkClient,
  input: unknown,
  deps: LinkDeps = {},
): Promise<LinkResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, params } = prepared;
  switch (action) {
    case "parse":
      return runParse(params);
    case "build":
      return runBuild(params);
    case "fromView":
      return runFromView(client, params);
    case "open":
      return runOpen(client, params, deps);
  }
}

export function toToolResult(r: LinkResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

const NUMBERS = z.union([z.array(z.number()), z.string()]);

/** The flat input shape (the per-action keys are checked in prepareRequest). */
export const WB_LINK_INPUT: z.ZodRawShape = {
  action: z.enum(ACTIONS),
  link: z.string().optional().describe("parse, open: an enfusion:// link or a web link"),
  kind: z.enum(["world", "resource", "script", "editor"]).optional().describe("build"),
  module: z.enum(LINK_MODULES).optional().describe("build editor: the module to open"),
  world: z.string().optional().describe("build world: ~Addon:worlds/x.ent"),
  addon: z.string().optional().describe("build: addon id (with path)"),
  path: z.string().optional().describe("build: relative path"),
  pos: NUMBERS.optional().describe("build world: x,y,z"),
  angles: NUMBERS.optional().describe("build world: pitch,yaw,roll"),
  time: NUMBERS.optional().describe("build world: daytime 0..1,year,month,day"),
  entity: z.string().optional().describe("build world: EntityID"),
  line: z.number().int().optional().describe("build script"),
  webPrefix: z.boolean().optional().describe("build, fromView: add the redirect prefix"),
  confirm: z.boolean().optional().describe("open: dispatch (else dry run)"),
};

export function wbLinkDescription(): string {
  if (WB_LINK_DESCRIPTION.length > DESCRIPTION_MAX) {
    throw new Error(`wb_link description is ${WB_LINK_DESCRIPTION.length} chars`);
  }
  return WB_LINK_DESCRIPTION;
}

export function registerWbLink(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_link", // TOOL_NAME, written out for the E11 census ref
    {
      description: wbLinkDescription(),
      inputSchema: WB_LINK_INPUT,
      annotations: {
        title: "Workbench links",
        readOnlyHint: false,
        // open (with confirm) opens modules and files and may switch the open world.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runLink(client, input));
    },
  );
}

/** Module ids a link may open (for the census and tests). */
export const OPENABLE_MODULES: readonly ModuleId[] = LINK_MODULES.filter(
  (m) => m !== "ParticleEditor",
) as ModuleId[];
