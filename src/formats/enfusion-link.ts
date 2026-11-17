/**
 * `enfusion://` Workbench links: a lossless parser and a builder (wave W8, phase5-w8-spec.md
 * section 2.3 and section 4 "Links"; DEC-076 OD-7).
 *
 * Forms (wiki "Workbench Links", the recon tables and the vanilla builders
 * SCR_WorldEditorToolHelper.GetCurrentWorldEditorLink, SCR_CoordsTool, ResourceTestTool):
 *
 *   enfusion://WorldEditor/<world>;<x,y,z>;<pitch,yaw,roll>;<daytime,year,month,day>;<entity>
 *       <world> is `~<Addon>:worlds/...ent` (the `$` of GetWorldPath written as `~`) or the
 *       older `worlds/...ent` form; every field after the world is optional, an empty field
 *       is kept as written.
 *   enfusion://ResourceManager/~<Addon>:<relative path>   (`ResourceTestTool` writes the path
 *       without the `~<Addon>:` part, which is accepted too)
 *   enfusion://ScriptEditor/<relative path>;<line>        (`;<line>` optional)
 *   enfusion://<Module>                                   editor-only: opens the editor, no file
 *       (ParticleEditor, AnimEditor, AudioEditor, BehaviorEditor, LocalizationEditor,
 *       ProcAnimEditor; the three file modules answer the same bare form)
 *   https://enfusionengine.com/api/redirect?to=<link>     the web redirect prefix, for platforms
 *       that do not linkify custom schemes; the inner link may be percent-encoded
 *   http(s)://...                                         a web link: answered, never opened
 *
 * The parser keeps every field's text, so `formatLink(parseLink(s)) === s` for every link it
 * accepts (whitespace around the whole link is trimmed). Nothing here opens anything.
 */

import { VocabularyError } from "../manifest/vocabulary.js";

export const SCHEME = "enfusion://";
/** SCR_WorldEditorToolHelper.WEB_PREFIX and SCR_CoordsTool.WEB_PREFIX. */
export const WEB_PREFIX = "https://enfusionengine.com/api/redirect?to=";

/** Modules a link names that take a file or a place. */
export const FILE_MODULES = ["WorldEditor", "ResourceManager", "ScriptEditor"] as const;
/** Modules whose link opens the editor only (no file parameter). */
export const EDITOR_ONLY_MODULES = [
  "ParticleEditor",
  "AnimEditor",
  "AudioEditor",
  "BehaviorEditor",
  "LocalizationEditor",
  "ProcAnimEditor",
] as const;
export const LINK_MODULES = [...FILE_MODULES, ...EDITOR_ONLY_MODULES] as const;
export type LinkModule = (typeof LINK_MODULES)[number];

/** world: WorldEditor with a world; resource; script; editor: a bare module link; web. */
export const LINK_KINDS = ["world", "resource", "script", "editor", "web"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** A number triple as written (`text`) and as read (`values`). */
export interface Vec3 {
  text: string;
  values: [number, number, number];
}

/** The time field: daytime 0..1, then year, month, day (each after daytime optional). */
export interface LinkTime {
  text: string;
  daytime: number;
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface ParsedLink {
  kind: LinkKind;
  /** The module the link names (absent for a web link). */
  module?: LinkModule;
  /** The link sat behind WEB_PREFIX. */
  webPrefix: boolean;
  /** Behind the prefix, the inner link was percent-encoded; its text is kept for the round trip. */
  encodedText?: string;
  /** A web link's URL. */
  url?: string;
  /** World Editor: the world field as written (`~Addon:worlds/x.ent` or `worlds/x.ent`). */
  world?: string;
  /** The `~<Addon>:` part of a world, resource or script path, when present. */
  addon?: string;
  /** The relative path (the world's, the resource's or the script's), without the addon. */
  path?: string;
  pos?: Vec3;
  /** Pitch, yaw, roll in degrees, the order the link writes them. */
  angles?: Vec3;
  time?: LinkTime;
  /** The entity field as written. */
  entity?: string;
  /** Script Editor line. */
  line?: number;
  /** World Editor: how many `;` fields the link has (1 to 5), empty ones included. */
  fieldCount?: number;
}

const ADDON_ID = /^[A-Za-z0-9_.-]+$/;
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INT = /^\d+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[A-Za-z]:/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:/;
/** World Editor fields: world, position, angles, time, entity. */
export const WORLD_FIELDS = 5;

function invalid(message: string): never {
  throw new VocabularyError("INVALID_ARGUMENT", message);
}

function isModule(s: string): s is LinkModule {
  return (LINK_MODULES as readonly string[]).includes(s);
}

/** A relative path inside a link (kept as written). Throws INVALID_ARGUMENT. */
function checkLinkPath(raw: string, label: string): string {
  if (raw === "") invalid(`${label} is empty`);
  if (raw.trim() !== raw) invalid(`${label} has blanks at its ends: '${raw}'`);
  if (raw.includes(";")) invalid(`${label} holds ';', which separates the link's fields`);
  if (DRIVE.test(raw) || raw.startsWith("/") || raw.startsWith("\\") || URL_SCHEME.test(raw)) {
    invalid(`${label} must be relative, got '${raw}'`);
  }
  if (raw.startsWith("$") || raw.startsWith("~")) {
    invalid(`${label} has a malformed addon prefix (~<Addon>:<path>), got '${raw}'`);
  }
  if (
    raw
      .replace(/\\/g, "/")
      .split("/")
      .some((s) => s === "..")
  ) {
    invalid(`'..' refused in ${label}: '${raw}'`);
  }
  return raw;
}

/** `~Addon:path` or `path`. Throws INVALID_ARGUMENT. */
function splitAddon(raw: string, label: string): { addon?: string; path: string } {
  if (raw.startsWith("~")) {
    const colon = raw.indexOf(":");
    if (colon < 0) invalid(`${label} '${raw}' has '~' but no ':' after the addon id`);
    const addon = raw.slice(1, colon);
    if (!ADDON_ID.test(addon)) invalid(`addon must be an addon id, got '${addon}'`);
    return { addon, path: checkLinkPath(raw.slice(colon + 1), label) };
  }
  return { path: checkLinkPath(raw, label) };
}

function numbers(text: string, label: string, min: number, max: number): number[] {
  const parts = text.split(",");
  if (parts.length < min || parts.length > max) {
    invalid(
      `${label} takes ${min === max ? min : `${min} to ${max}`} numbers separated by ',', got '${text}'`,
    );
  }
  return parts.map((p) => {
    const t = p.trim();
    if (!NUM.test(t)) invalid(`${label} must be numbers separated by ',', got '${text}'`);
    const n = Number(t);
    if (!Number.isFinite(n)) invalid(`${label} must be finite, got '${text}'`);
    return n;
  });
}

function vec3(text: string, label: string): Vec3 {
  const v = numbers(text, label, 3, 3);
  return { text, values: [v[0]!, v[1]!, v[2]!] };
}

function timeOf(text: string): LinkTime {
  const v = numbers(text, "time (daytime,year,month,day)", 1, 4);
  const [daytime, year, month, day] = v;
  if (daytime! < 0 || daytime! > 1) invalid(`daytime is 0..1, got ${daytime}`);
  for (const [n, label, lo, hi] of [
    [year, "year", 0, 9999],
    [month, "month", 1, 12],
    [day, "day", 1, 31],
  ] as const) {
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < lo || n > hi)
      invalid(`${label} is an integer ${lo}..${hi}, got ${n}`);
  }
  return { text, daytime: daytime!, year: year ?? null, month: month ?? null, day: day ?? null };
}

function checkEntity(text: string): string {
  if (text.trim() !== text || text.includes(",")) {
    invalid(`entity must be one id with no blanks or ',', got '${text}'`);
  }
  return text;
}

function parseWorldBody(body: string, link: ParsedLink): void {
  const fields = body.split(";");
  if (fields.length > WORLD_FIELDS) {
    invalid(
      `a World Editor link has at most ${WORLD_FIELDS} fields (world;pos;angles;time;entity), got ${fields.length}`,
    );
  }
  const [world, pos, angles, time, entity] = fields;
  const w = splitAddon(world!, "world");
  if (!w.path.toLowerCase().endsWith(".ent")) invalid(`world must name a .ent, got '${world}'`);
  link.world = world;
  if (w.addon !== undefined) link.addon = w.addon;
  link.path = w.path;
  link.fieldCount = fields.length;
  if (pos) link.pos = vec3(pos, "pos (x,y,z)");
  if (angles) link.angles = vec3(angles, "angles (pitch,yaw,roll)");
  if (time) link.time = timeOf(time);
  if (entity) link.entity = checkEntity(entity);
}

function parseEnfusion(text: string, link: ParsedLink): void {
  if (!text.startsWith(SCHEME)) invalid(`a link starts with ${SCHEME} or http(s)://`);
  const rest = text.slice(SCHEME.length);
  const slash = rest.indexOf("/");
  const name = slash < 0 ? rest : rest.slice(0, slash);
  if (name === "") invalid(`the link names no module: ${SCHEME}<Module>`);
  if (!isModule(name)) invalid(`unknown link module '${name}'; one of ${LINK_MODULES.join(", ")}`);
  link.module = name;
  if (slash < 0) {
    link.kind = "editor";
    return;
  }
  const body = rest.slice(slash + 1);
  if ((EDITOR_ONLY_MODULES as readonly string[]).includes(name)) {
    invalid(`${name} links open the editor only and take no file parameter: ${SCHEME}${name}`);
  }
  if (body === "") invalid(`the ${name} link names nothing after '${name}/'`);
  if (name === "WorldEditor") {
    link.kind = "world";
    parseWorldBody(body, link);
    return;
  }
  if (name === "ResourceManager") {
    link.kind = "resource";
    const r = splitAddon(body, "path");
    if (r.addon !== undefined) link.addon = r.addon;
    link.path = r.path;
    return;
  }
  link.kind = "script";
  const semi = body.indexOf(";");
  const pathText = semi < 0 ? body : body.slice(0, semi);
  const s = splitAddon(pathText, "path");
  if (s.addon !== undefined) link.addon = s.addon;
  link.path = s.path;
  if (semi >= 0) {
    const lineText = body.slice(semi + 1);
    if (!INT.test(lineText) || lineText.length > 9)
      invalid(`line must be a whole number, got '${lineText}'`);
    if (String(Number(lineText)) !== lineText)
      invalid(`line must have no leading zeros, got '${lineText}'`);
    link.line = Number(lineText);
  }
}

/** Parses one link. Throws VocabularyError INVALID_ARGUMENT naming what is wrong. */
export function parseLink(raw: string): ParsedLink {
  if (typeof raw !== "string") invalid("link must be a string");
  const text = raw.trim();
  if (text === "") invalid("link is empty");
  if (CONTROL.test(text)) invalid("link holds a control character");
  const link: ParsedLink = { kind: "web", webPrefix: false };
  if (text.startsWith(WEB_PREFIX)) {
    link.webPrefix = true;
    let inner = text.slice(WEB_PREFIX.length);
    if (inner === "")
      invalid(`the redirect prefix needs a link after it: ${WEB_PREFIX}${SCHEME}...`);
    if (/^enfusion%3a/i.test(inner)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(inner);
      } catch {
        invalid("the link's percent-encoding is malformed");
      }
      if (CONTROL.test(decoded)) invalid("link holds a control character");
      link.encodedText = inner;
      inner = decoded;
    }
    parseEnfusion(inner, link);
    return link;
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      new URL(text);
    } catch {
      invalid(`not a valid web address: '${text}'`);
    }
    link.url = text;
    return link;
  }
  parseEnfusion(text, link);
  return link;
}

function worldBody(p: ParsedLink): string {
  const world = p.world ?? (p.addon !== undefined ? `~${p.addon}:${p.path ?? ""}` : (p.path ?? ""));
  const fields = [
    world,
    p.pos?.text ?? "",
    p.angles?.text ?? "",
    p.time?.text ?? "",
    p.entity ?? "",
  ];
  let count = p.fieldCount ?? 1;
  for (let i = fields.length - 1; i >= count; i--) if (fields[i] !== "") count = i + 1;
  return fields.slice(0, count).join(";");
}

function pathText(p: ParsedLink): string {
  return p.addon !== undefined ? `~${p.addon}:${p.path ?? ""}` : (p.path ?? "");
}

/** The link's enfusion:// text, without the web prefix. Throws INVALID_ARGUMENT for a web link. */
export function innerLink(p: ParsedLink): string {
  if (p.kind === "web" || !p.module) invalid("a web link has no enfusion:// form");
  if (p.kind === "editor") return `${SCHEME}${p.module}`;
  if (p.kind === "world") return `${SCHEME}WorldEditor/${worldBody(p)}`;
  if (p.kind === "resource") return `${SCHEME}ResourceManager/${pathText(p)}`;
  return `${SCHEME}ScriptEditor/${pathText(p)}${p.line !== undefined ? `;${p.line}` : ""}`;
}

/** Writes a parsed link back; byte for byte the text parseLink read (trimmed). */
export function formatLink(p: ParsedLink): string {
  if (p.kind === "web") return p.url ?? "";
  const inner = innerLink(p);
  if (!p.webPrefix) return inner;
  if (p.encodedText !== undefined) {
    let same = false;
    try {
      same = decodeURIComponent(p.encodedText) === inner;
    } catch {
      same = false;
    }
    return WEB_PREFIX + (same ? p.encodedText : encodeURIComponent(inner));
  }
  return WEB_PREFIX + inner;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/** A float as link text: up to 6 decimals, no exponent for ordinary values, no "-0". */
export function numberText(n: number): string {
  if (!Number.isFinite(n)) invalid(`a link number must be finite, got ${n}`);
  const r = Number(n.toFixed(6));
  return Object.is(r, -0) ? "0" : String(r);
}

export type NumbersIn = number[] | string;

export interface BuildFields {
  kind: Exclude<LinkKind, "web">;
  /** editor: the module to open. */
  module?: string;
  /** world: `~Addon:worlds/x.ent` or `worlds/x.ent` (or give addon and path). */
  world?: string;
  addon?: string;
  path?: string;
  pos?: NumbersIn;
  angles?: NumbersIn;
  time?: NumbersIn;
  entity?: string;
  line?: number;
  webPrefix?: boolean;
}

function numbersText(v: NumbersIn, label: string, min: number, max: number): string {
  if (typeof v === "string") {
    numbers(v, label, min, max);
    return v;
  }
  if (!Array.isArray(v) || v.length < min || v.length > max) {
    invalid(`${label} takes ${min === max ? min : `${min} to ${max}`} numbers`);
  }
  return v.map((n) => numberText(Number(n))).join(",");
}

/** Builds a link from fields; parses the result back so it is always a valid link. */
export function buildLink(f: BuildFields): { link: string; parsed: ParsedLink } {
  const kind = f.kind;
  const allowed: Record<string, readonly string[]> = {
    world: ["world", "addon", "path", "pos", "angles", "time", "entity"],
    resource: ["addon", "path"],
    script: ["addon", "path", "line"],
    editor: ["module"],
  };
  const keys = allowed[kind];
  if (!keys) invalid(`kind must be one of world, resource, script, editor, got '${String(kind)}'`);
  for (const k of ["module", "world", "addon", "path", "pos", "angles", "time", "entity", "line"]) {
    if ((f as unknown as Record<string, unknown>)[k] !== undefined && !keys.includes(k)) {
      invalid(`${k} does not apply to a ${kind} link (takes ${keys.join(", ")})`);
    }
  }
  if (f.addon !== undefined && !ADDON_ID.test(f.addon)) {
    invalid(`addon must be an addon id, got '${f.addon}'`);
  }
  let inner: string;
  if (kind === "editor") {
    if (!f.module) invalid("an editor link needs module");
    if (!isModule(f.module)) {
      invalid(`unknown link module '${f.module}'; one of ${LINK_MODULES.join(", ")}`);
    }
    inner = `${SCHEME}${f.module}`;
  } else if (kind === "world") {
    let world: string;
    if (f.world !== undefined) {
      if (f.addon !== undefined || f.path !== undefined) invalid("pass world, or addon and path");
      world = f.world;
    } else {
      if (f.path === undefined) invalid("a world link needs world (or path and addon)");
      world = f.addon !== undefined ? `~${f.addon}:${f.path}` : f.path;
    }
    const fields = [
      world,
      f.pos !== undefined ? numbersText(f.pos, "pos (x,y,z)", 3, 3) : "",
      f.angles !== undefined ? numbersText(f.angles, "angles (pitch,yaw,roll)", 3, 3) : "",
      f.time !== undefined ? numbersText(f.time, "time (daytime,year,month,day)", 1, 4) : "",
      f.entity ?? "",
    ];
    let count = 1;
    fields.forEach((x, i) => {
      if (x !== "") count = i + 1;
    });
    inner = `${SCHEME}WorldEditor/${fields.slice(0, count).join(";")}`;
  } else {
    if (f.path === undefined) invalid(`a ${kind} link needs path`);
    const p = f.addon !== undefined ? `~${f.addon}:${f.path}` : f.path;
    if (kind === "resource") inner = `${SCHEME}ResourceManager/${p}`;
    else {
      if (f.line !== undefined && (!Number.isInteger(f.line) || f.line < 0)) {
        invalid(`line must be a whole number, got ${f.line}`);
      }
      inner = `${SCHEME}ScriptEditor/${p}${f.line !== undefined ? `;${f.line}` : ""}`;
    }
  }
  const link = f.webPrefix ? WEB_PREFIX + inner : inner;
  return { link, parsed: parseLink(link) };
}

// ── The world path GetWorldPath answers, as a link writes it ─────────────────

/**
 * The world field SCR_WorldEditorToolHelper.GetCurrentWorldEditorLink writes for a
 * WorldEditorAPI.GetWorldPath answer: `$Addon:` becomes `~Addon:`, a `~` form stays, anything
 * else is cut to its `worlds/` part (so no local folder leaks); backslashes become `/`. Null when
 * the path is empty or has no `worlds/` part.
 */
export function worldFieldOf(worldPath: string): string | null {
  const full = worldPath.trim();
  if (full === "") return null;
  let world: string;
  if (full.startsWith("$")) world = `~${full.slice(1)}`;
  else if (full.startsWith("~")) world = full;
  else {
    const lower = full.toLowerCase();
    let begin = lower.indexOf("worlds\\");
    if (begin < 0) begin = lower.indexOf("worlds/");
    if (begin < 0) return null;
    world = full.slice(begin);
  }
  return world.replace(/\\/g, "/");
}

/** A world path or field compared without its addon, case and slash direction. */
export function worldKey(worldOrPath: string): string {
  let s = worldOrPath.trim().replace(/\\/g, "/");
  const m = /^[~$][A-Za-z0-9_.-]+:/.exec(s);
  if (m) s = s.slice(m[0].length);
  else {
    const at = s.toLowerCase().indexOf("worlds/");
    if (at > 0) s = s.slice(at);
  }
  return s.replace(/^\/+/, "").toLowerCase();
}
