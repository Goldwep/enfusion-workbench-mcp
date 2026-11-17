/**
 * `particle`: read and edit `.ptc` particle effects (EffectDef > Emitters > EmitterDef) as files.
 *
 * A .ptc is Enfusion text, so the lossless parser in src/formats/enfusion-cst.ts is the model:
 * every edit splices the text and the bytes outside the edit never change (the vanilla corpus,
 * 442 of 442 files, comes back byte for byte). Reads take a project file or a game path (read from
 * the paks). Writes go inside the project only, on an existing file unless the action is `create`,
 * and are a dry run (a unified diff) unless `confirm` is true; an existing file is copied to
 * `<file>.bak` before it is overwritten. A new file is registered afterwards with
 * `wb_resources register`: this tool writes no `.meta`.
 *
 * Shape of the files, from the 1.9.0.37 corpus (442 files, 2423 emitters, 12523 curves):
 *   EffectDef { [Version n] [effect keys] Emitters { EmitterDef <name> { <scalars> <curves> } } }
 * A curve is a block holding one line of numbers: `time value` pairs, or `time r g b` tuples for
 * the colour curves (Color, ColorMast, LightColorMast). Times are non-decreasing in 0..1.
 *
 * The Particle Editor module is never opened here (DEC-042). Previewing an effect in a world is
 * `wb_particle`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp, backupRel } from "../utils/backup.js";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCstBytes,
  tokenValue,
  type CstEntry,
  type CstObject,
  type CstScalar,
  type EntrySpec,
  type ObjectSpec,
} from "../formats/enfusion-cst.js";
import {
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionOk,
  type ActionResponse,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";
import { unifiedDiff } from "./imageset.js";

// ── Errors ───────────────────────────────────────────────────────────────────

/** A refusal with a vocabulary code. */
export class ParticleError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "ParticleError";
  }
}

const bad = (message: string, next?: string): never => {
  throw new ParticleError("INVALID_ARGUMENT", message, next);
};
const missing = (message: string): never => {
  throw new ParticleError("PATH_NOT_FOUND", message);
};

// ── Catalog (the keys the vanilla corpus uses, with the shape of their values) ─

export type KeyKind = "number" | "bool" | "vec3" | "enum" | "ref" | "guid";

export interface KeySpec {
  kind: KeyKind;
  group: string;
  /** Values seen in vanilla (enum). Others are allowed with a warning. */
  values?: readonly string[];
  /** Extension a `{GUID}path` ref points at (ref). */
  ext?: string;
}

const num = (group: string): KeySpec => ({ kind: "number", group });
const flag = (group: string): KeySpec => ({ kind: "bool", group });
const vec = (group: string): KeySpec => ({ kind: "vec3", group });
const word = (group: string, values: readonly string[]): KeySpec => ({
  kind: "enum",
  group,
  values,
});

/** Effect-level keys (every key the corpus puts directly under EffectDef). */
export const EFFECT_KEYS: Readonly<Record<string, KeySpec>> = Object.freeze({
  Version: word("effect", ["1", "2"]),
  LightRadius: num("light"),
  LightClipEV: num("light"),
  LightOffset: vec("light"),
  MinFPS: num("effect"),
  CastShadow: flag("light"),
  CollisionPreset: { kind: "guid", group: "collision" },
  WorldRelativeY: flag("effect"),
});

/** Emitter-level scalar keys (every key the corpus puts directly under EmitterDef). */
export const EMITTER_KEYS: Readonly<Record<string, KeySpec>> = Object.freeze({
  ShapeType: word("shape", ["Box", "Point", "Sphere", "Ellipse", "0"]),
  ShapeSize: vec("shape"),
  ConeAngle: vec("shape"),
  ConeAngleMinDist: num("shape"),
  ConeAngleRndRange: num("shape"),
  Offset: vec("shape"),
  Angles: vec("shape"),
  LocalTransform: flag("shape"),
  MaxNum: num("rate"),
  BirthRate: num("rate"),
  BirthRateRND: num("rate"),
  BirthRateVel: num("rate"),
  EmittingTime: num("rate"),
  Repeat: flag("rate"),
  Lifetime: num("life"),
  LifetimeRND: num("life"),
  LifetimeByAnim: flag("life"),
  LifetimeShortening: num("life"),
  LifetimeVelFactor: num("life"),
  LifetimeVelSmoothing: flag("life"),
  LodMin: num("lod"),
  LodMax: num("lod"),
  Material: { kind: "ref", group: "look", ext: ".emat" },
  ParticleType: word("look", ["Prefab"]),
  Prefab: { kind: "ref", group: "look", ext: ".et" },
  BillboardingType: word("look", ["Full", "LockedAxis", "None"]),
  CenterX: num("look"),
  CenterY: num("look"),
  CenterZ: num("look"),
  ScaleX: num("look"),
  ScaleY: num("look"),
  StretchMultiplier: num("look"),
  StreakFullUV: flag("look"),
  SizeMultiplier: num("look"),
  SizeRND: num("look"),
  RotMultiplier: num("look"),
  RotRND: num("look"),
  RandomRotDir: flag("look"),
  RotMultiplier_3D: vec("look"),
  RotRND_3D: vec("look"),
  RandomRotationSpace: flag("look"),
  AngularFadeOutStart: num("look"),
  AngularFadeOutEnd: num("look"),
  FlipU: word("look", ["On", "Random"]),
  FlipV: word("look", ["On", "Random"]),
  AnimFPS: num("look"),
  AnimOnce: flag("look"),
  RandomFrame: flag("look"),
  RandomAngle: flag("look"),
  Occlusion: num("look"),
  Velocity: num("motion"),
  VelocityRND: num("motion"),
  VelAngle: flag("motion"),
  VelAngleCatchUp: flag("motion"),
  VelAffect: num("motion"),
  AirResistance: num("motion"),
  AirResistanceRND: num("motion"),
  WindInfluence: num("motion"),
  GravityMultiply: num("motion"),
  GravityMultiplyRND: num("motion"),
  Spring: num("motion"),
  ParentVelRelToAir: num("motion"),
  MaxLV: num("motion"),
  RelativeLV: flag("motion"),
  EnableCollisions: flag("collision"),
  CollisionDistThresh: num("collision"),
  NormalRestitution: num("collision"),
  TagentialRestitution: num("collision"),
  Friction: num("collision"),
  RotDampBySliding: num("collision"),
  EnableLight: flag("light"),
  LightIntensityResponse: num("light"),
});

export interface CurveSpec {
  /** Numbers per point: 2 (`time value`) or 4 (`time r g b`). */
  stride: 2 | 4;
  note: string;
}

const PAIR = "time value pairs";
const COLOUR = "time r g b tuples";

/** Curve blocks of an emitter (every block name the corpus has). */
export const CURVES: Readonly<Record<string, CurveSpec>> = Object.freeze({
  Color: { stride: 4, note: COLOUR },
  Alpha: { stride: 2, note: PAIR },
  Size: { stride: 2, note: PAIR },
  RotationSpeed: { stride: 2, note: PAIR },
  Emissivity: { stride: 2, note: PAIR },
  AlphaMast: { stride: 2, note: PAIR },
  BRateMast: { stride: 2, note: PAIR },
  SizeMast: { stride: 2, note: PAIR },
  ColorMast: { stride: 4, note: COLOUR },
  RotationSpeedMast: { stride: 2, note: PAIR },
  VelocityMast: { stride: 2, note: PAIR },
  AirResistanceMast: { stride: 2, note: PAIR },
  LightColorMast: { stride: 4, note: COLOUR },
  LightIntensityMast: { stride: 2, note: PAIR },
});

/** The file `create` writes: the Particle Editor's own default (system/wbdata/ParticleEditor/default.ptc). */
export function skeleton(emitterName: string): string {
  return `EffectDef {\n Version 2\n Emitters {\n  EmitterDef ${emitterName} {\n  }\n }\n}`;
}

// ── Numbers and values ───────────────────────────────────────────────────────

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const REF = /^\{[0-9A-Fa-f]{16}\}.+$/;
const GUID_ONLY = /^\{[0-9A-Fa-f]{16}\}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BARE = /^[^\s"{}:]+$/;

function parseNum(x: unknown): number | undefined {
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  if (typeof x === "string" && NUMBER.test(x.trim())) {
    const n = Number(x.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A number as plain decimal text (no exponent), the way the engine writes it. */
export function fmtNum(n: number): string {
  if (Object.is(n, -0)) return "0";
  let s = String(n);
  if (/e/i.test(s)) {
    if (Math.abs(n) >= 1e21) return BigInt(n).toString();
    s = n.toFixed(Math.abs(n) < 1 ? 12 : 0);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

/** A scalar value as JSON: a number, a list of numbers, or the text. */
function jsonValue(values: string[]): unknown {
  const nums = values.map((v) => (NUMBER.test(v) ? Number(v) : undefined));
  if (values.length > 0 && nums.every((n) => n !== undefined)) {
    return values.length === 1 ? nums[0] : nums;
  }
  return values.length === 1 ? values[0] : values;
}

export type PropValue = string | number | boolean | (string | number)[];

interface Converted {
  items: string[];
  quoted: boolean;
  warnings: string[];
}

function normalizeRef(key: string, raw: string, kind: "ref" | "guid", ext?: string): string {
  const v = raw.trim();
  if (kind === "guid") {
    if (!GUID_ONLY.test(v)) bad(`${key} takes a {GUID} (16 hex digits in braces), got ${raw}`);
  } else if (!REF.test(v)) {
    bad(`${key} takes a {GUID}path resource name, got ${raw}`);
  }
  const norm = `{${v.slice(1, 17).toUpperCase()}}${v.slice(18)}`;
  if (ext && !norm.toLowerCase().endsWith(ext))
    bad(`${key} points at a ${ext} resource, got ${raw}`);
  return norm;
}

/** A value for `key`, validated against its catalog entry (or accepted as given when unknown). */
export function convertValue(spec: KeySpec | undefined, key: string, v: PropValue): Converted {
  const warnings: string[] = [];
  if (spec && (spec.kind === "ref" || spec.kind === "guid")) {
    if (typeof v !== "string") return bad(`${key} takes one {GUID}path text`);
    return { items: [normalizeRef(key, v, spec.kind, spec.ext)], quoted: true, warnings };
  }
  const list: (string | number | boolean)[] = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.trim() === ""
        ? []
        : v.trim().split(/\s+/)
      : [v];
  if (list.length === 0) bad(`${key}: empty value`);
  if (!spec) {
    if (list.length === 1 && typeof list[0] === "string" && REF.test(list[0].trim())) {
      return { items: [normalizeRef(key, list[0], "ref")], quoted: true, warnings };
    }
    const items = list.map((x) => {
      if (typeof x === "boolean") return x ? "1" : "0";
      const n = parseNum(x);
      if (n !== undefined) return fmtNum(n);
      if (typeof x === "string" && BARE.test(x) && !x.includes("//")) return x;
      return bad(`${key}: ${JSON.stringify(x)} cannot be written as a bare value`);
    });
    return { items, quoted: false, warnings };
  }
  const many = (count: number): string[] => {
    if (list.length !== count) bad(`${key} takes ${count} number(s), got ${list.length}`);
    return list.map((x) => {
      const n = parseNum(x);
      return n === undefined ? bad(`${key}: ${JSON.stringify(x)} is not a number`) : fmtNum(n);
    });
  };
  switch (spec.kind) {
    case "number":
      return { items: many(1), quoted: false, warnings };
    case "vec3":
      return { items: many(3), quoted: false, warnings };
    case "bool": {
      if (list.length !== 1) bad(`${key} takes one flag (0 or 1)`);
      const x = list[0];
      const on = x === true || x === 1 || x === "1" || x === "true";
      const off = x === false || x === 0 || x === "0" || x === "false";
      if (!on && !off)
        bad(`${key} is a flag: use 0 or 1 (or true/false), got ${JSON.stringify(x)}`);
      return { items: [on ? "1" : "0"], quoted: false, warnings };
    }
    default: {
      if (list.length !== 1 || typeof list[0] !== "string" || !BARE.test(list[0])) {
        return bad(`${key} takes one word, got ${JSON.stringify(v)}`);
      }
      const w = list[0];
      if (spec.values && !spec.values.includes(w)) {
        warnings.push(
          `${key} ${w}: not a value the vanilla corpus uses (${spec.values.join(", ")})`,
        );
      }
      return { items: [w], quoted: false, warnings };
    }
  }
}

/** Why a value read from a file does not fit its catalog entry; undefined when it fits. */
function kindProblem(spec: KeySpec, values: string[], quoted: boolean): string | undefined {
  const isNums = (n: number) => values.length === n && values.every((v) => NUMBER.test(v));
  switch (spec.kind) {
    case "number":
      return isNums(1) ? undefined : "expects one number";
    case "vec3":
      return isNums(3) ? undefined : "expects three numbers";
    case "bool":
      return values.length === 1 && /^[01]$/.test(values[0]) ? undefined : "expects 0 or 1";
    case "enum":
      return values.length === 1 ? undefined : "expects one word";
    case "guid":
      return values.length === 1 && quoted && GUID_ONLY.test(values[0])
        ? undefined
        : "expects a quoted {GUID}";
    default:
      return values.length === 1 && quoted && REF.test(values[0])
        ? undefined
        : "expects a quoted {GUID}path";
  }
}

// ── Model ────────────────────────────────────────────────────────────────────

export interface PropView {
  key: string;
  values: string[];
  quoted: boolean;
  /** Offsets of the whole entry and of its value tokens (the value span is empty without values). */
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  line: number;
}

export interface CurveView {
  name: string;
  known: boolean;
  stride: number;
  /** The number tokens of the block, in order. */
  numbers: string[];
  /** Points: numbers / stride, rounded down. */
  points: number;
  wellFormed: boolean;
  /** Position among the emitter's children. */
  childIndex: number;
  start: number;
  end: number;
  line: number;
}

export interface EmitterView {
  /** Position among the EmitterDef blocks. */
  ordinal: number;
  /** Position among all children of the Emitters block (differs when foreign entries sit there). */
  childIndex: number;
  name: string;
  named: boolean;
  start: number;
  end: number;
  line: number;
  props: PropView[];
  curves: CurveView[];
  /** Children that are neither scalars nor curve blocks. */
  others: number;
  obj: CstObject;
}

export interface ParticleView {
  /** True when the document is one EffectDef. */
  ok: boolean;
  rootKey: string;
  root?: CstObject;
  effect: PropView[];
  /** Every `Emitters` block of the EffectDef (a valid file has one). */
  blocks: CstObject[];
  block?: CstObject;
  emitters: EmitterView[];
  /** Entries of the Emitters block that are not EmitterDef blocks. */
  foreign: number;
}

function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) starts.push(i + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Reads the structure of a document. Never throws, whatever the document holds. */
export function viewParticle(doc: CstDocument): ParticleView {
  const base = doc.base;
  if (base.kind !== "object" || base.key !== "EffectDef") {
    return {
      ok: false,
      rootKey: base.kind === "object" ? base.key : "",
      effect: [],
      blocks: [],
      emitters: [],
      foreign: 0,
    };
  }
  const lineOf = lineIndex(doc.text);
  const propOf = (s: CstScalar): PropView => {
    const first = s.values[0];
    const last = s.values[s.values.length - 1];
    return {
      key: s.key,
      values: s.values.map(tokenValue),
      quoted: s.values.length > 0 && s.values.every((t) => t.kind === "string"),
      start: s.start,
      end: s.end,
      valueStart: first ? first.start : s.end,
      valueEnd: last ? last.end : s.end,
      line: lineOf(s.start),
    };
  };
  const effect = base.children.filter((c): c is CstScalar => c.kind === "scalar").map(propOf);
  const blocks = base.children.filter(
    (c): c is CstObject => c.kind === "object" && c.key === "Emitters",
  );
  const block = blocks[0];
  const emitters: EmitterView[] = [];
  let foreign = 0;
  block?.children.forEach((c, childIndex) => {
    if (c.kind !== "object" || c.key !== "EmitterDef") {
      foreign++;
      return;
    }
    const props: PropView[] = [];
    const curves: CurveView[] = [];
    let others = 0;
    c.children.forEach((k, ci) => {
      if (k.kind === "scalar") props.push(propOf(k));
      else if (k.kind === "object") curves.push(curveOf(k, ci, lineOf(k.start)));
      else others++;
    });
    const nameTok = c.head[1];
    emitters.push({
      ordinal: emitters.length,
      childIndex,
      name: nameTok ? tokenValue(nameTok) : "",
      named: c.head.length === 2 && nameTok !== undefined,
      start: c.start,
      end: c.end,
      line: lineOf(c.start),
      props,
      curves,
      others,
      obj: c,
    });
  });
  return { ok: true, rootKey: base.key, root: base, effect, blocks, block, emitters, foreign };
}

function curveOf(o: CstObject, childIndex: number, line: number): CurveView {
  const spec = CURVES[o.key];
  const stride = spec ? spec.stride : 2;
  const numbers: string[] = [];
  let wellFormed = o.head.length === 1;
  for (const c of o.children) {
    if (c.kind === "value") numbers.push(...c.values.map(tokenValue));
    else if (c.kind === "scalar") numbers.push(c.keyToken.text, ...c.values.map(tokenValue));
    else wellFormed = false;
  }
  if (numbers.some((t) => !NUMBER.test(t)) || numbers.length % stride !== 0) wellFormed = false;
  return {
    name: o.key,
    known: spec !== undefined,
    stride,
    numbers,
    points: Math.floor(numbers.length / stride),
    wellFormed,
    childIndex,
    start: o.start,
    end: o.end,
    line,
  };
}

const prop = (props: PropView[], key: string): PropView | undefined =>
  props.find((p) => p.key === key);

/** Why this tool would not edit the file; undefined when it would. */
export function unwritableReason(buf: Uint8Array, doc: CstDocument): string | undefined {
  if (Buffer.compare(doc.toBytes(), Buffer.from(buf)) !== 0)
    return "the parser does not give the file back byte for byte";
  const view = viewParticle(doc);
  if (!view.ok) return `the root is not a single EffectDef (${view.rootKey || "none"})`;
  if (view.blocks.length > 1) return "the effect has more than one Emitters block";
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    return `the file does not parse cleanly (line ${d.line}: ${d.message})`;
  }
  return undefined;
}

// ── Request ──────────────────────────────────────────────────────────────────

export const READ_ACTIONS = [
  "inspect",
  "emitters",
  "emitter",
  "curves",
  "refs",
  "validate",
  "diff",
  "catalog",
] as const;
export const WRITE_ACTIONS = [
  "set",
  "setCurve",
  "addEmitter",
  "cloneEmitter",
  "copyEmitter",
  "renameEmitter",
  "removeEmitter",
  "moveEmitter",
  "create",
] as const;
export type ReadAction = (typeof READ_ACTIONS)[number];
export type WriteAction = (typeof WRITE_ACTIONS)[number];
export type ParticleAction = ReadAction | WriteAction;

export interface ParticleRequest {
  action: ParticleAction;
  path?: string;
  projectPath?: string;
  emitter?: string;
  index?: number;
  props?: Record<string, PropValue>;
  unset?: string[];
  curve?: string;
  points?: number[];
  name?: string;
  at?: number;
  from?: string;
  against?: string;
  key?: string;
  confirm?: boolean;
  overwrite?: boolean;
  allowUnknown?: boolean;
  cursor?: string;
  limit?: number;
}

/** The two pak calls this tool needs; tests pass a fake. */
export interface PakLike {
  exists(virtualPath: string): boolean;
  readFile(virtualPath: string): Buffer;
}

export interface ParticleDeps {
  /** Game paks; undefined opens them from the configured game path, null means none. */
  vfs?: PakLike | null;
  /** Reads may name any absolute .ptc on disk (the 1.x `particle_inspect` alias). Never for writes. */
  allowDisk?: boolean;
}

// ── Files ────────────────────────────────────────────────────────────────────

interface Located {
  /** Resource path, forward slashes (the absolute path for a disk file). */
  rel: string;
  /** Absolute path of the file on disk, when it is a project or disk file. */
  file?: string;
  root?: string;
  disk?: boolean;
}

function locate(rawPath: string, projectRoot: string | undefined, allowDisk: boolean): Located {
  const root = projectRoot ? resolve(projectRoot) : undefined;
  let p = rawPath.trim().replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (p.startsWith("-")) bad("paths starting with '-' are rejected");
  const isPtc = (s: string) => s.toLowerCase().endsWith(".ptc");
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) {
    let inside = false;
    if (root) {
      const rel = relative(root, resolve(p));
      inside = rel !== "" && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..";
      if (inside) p = rel.replace(/\\/g, "/");
    }
    if (!inside) {
      if (!allowDisk) {
        throw new ParticleError(
          "NOT_IN_PROJECT",
          root
            ? `${rawPath} is outside the project ${root}`
            : "no project root is configured for an absolute path",
        );
      }
      if (!isPtc(p)) bad(`"${p}" is not a .ptc file`);
      const file = resolve(p);
      return { rel: file.replace(/\\/g, "/"), file, disk: true };
    }
  }
  const rel = checkRelativePath(p);
  if (!isPtc(rel)) bad(`"${rel}" is not a .ptc file`);
  if (!root) return { rel };
  const file = resolve(root, rel);
  try {
    assertInsideRoot(file, root, "path");
  } catch (e) {
    throw new ParticleError("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, file, root };
}

function vfsOf(config: Config, deps: ParticleDeps): PakLike | null {
  if (deps.vfs !== undefined) return deps.vfs;
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

type Source = "project" | "game" | "disk";

interface Loaded {
  loc: Located;
  buf: Buffer;
  source: Source;
  doc: CstDocument;
}

function load(rawPath: string, req: ParticleRequest, config: Config, deps: ParticleDeps): Loaded {
  const loc = locate(
    rawPath,
    pinnedProjectRoot(req.projectPath, config.projectPath),
    !!deps.allowDisk,
  );
  if (loc.file && existsSync(loc.file)) {
    if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
    const buf = readFileSync(loc.file);
    return { loc, buf, source: loc.disk ? "disk" : "project", doc: parseCstBytes(buf) };
  }
  const vfs = loc.disk ? null : vfsOf(config, deps);
  if (vfs?.exists(loc.rel)) {
    const buf = vfs.readFile(loc.rel);
    return { loc, buf, source: "game", doc: parseCstBytes(buf) };
  }
  return missing(
    `no particle effect at "${loc.rel}": not a file${loc.root ? ` under ${loc.root}` : ""}` +
      (loc.disk ? "" : " and not in the game data") +
      (vfs || loc.disk ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
  );
}

// ── Responses ────────────────────────────────────────────────────────────────

function okResponse(
  action: string,
  target: string,
  changed: Change[] | null,
  readback: unknown,
  warnings: string[],
  next?: string,
  dryRun?: boolean,
): ActionOk & { dryRun?: boolean } {
  const r: ActionOk & { dryRun?: boolean } = {
    ok: true,
    action,
    target,
    changed,
    readback,
    warnings,
  };
  if (next) r.next = next;
  if (dryRun !== undefined) r.dryRun = dryRun;
  return r;
}

const dropUndefined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

interface Page<T> {
  items: T[];
  total: number;
  cursor?: string;
  nextCursor?: string;
}

function pageOf<T>(rows: T[], req: ParticleRequest): Page<T> {
  const limit = req.limit ?? LIMIT_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
    bad(`limit must be an integer from 1 to ${LIMIT_MAX}`);
  const cur = req.cursor === undefined ? { start: 0, count: rows.length } : parseCursor(req.cursor);
  if (req.cursor !== undefined) checkCursor(cur, rows.length);
  return {
    items: rows.slice(cur.start, cur.start + limit),
    total: rows.length,
    cursor: req.cursor,
    nextCursor: nextCursor(cur.start, limit, rows.length),
  };
}

const first = (props: PropView[], key: string): unknown => {
  const p = prop(props, key);
  return p ? jsonValue(p.values) : undefined;
};

function emitterRow(e: EmitterView): Record<string, unknown> {
  return dropUndefined({
    index: e.ordinal,
    name: e.name,
    particleType: first(e.props, "ParticleType"),
    shapeType: first(e.props, "ShapeType"),
    maxNum: first(e.props, "MaxNum"),
    birthRate: first(e.props, "BirthRate"),
    lifetime: first(e.props, "Lifetime"),
    emittingTime: first(e.props, "EmittingTime"),
    lod:
      prop(e.props, "LodMin") || prop(e.props, "LodMax")
        ? [first(e.props, "LodMin"), first(e.props, "LodMax")]
        : undefined,
    material: first(e.props, "Material"),
    prefab: first(e.props, "Prefab"),
    curves: e.curves.map((c) => c.name),
    line: e.line,
  });
}

function effectMap(props: PropView[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of props) if (!(p.key in out)) out[p.key] = jsonValue(p.values);
  return out;
}

function curveRow(e: EmitterView, c: CurveView): Record<string, unknown> {
  const pts: unknown[][] = [];
  for (let i = 0; i + c.stride <= c.numbers.length; i += c.stride) {
    pts.push(c.numbers.slice(i, i + c.stride).map((t) => (NUMBER.test(t) ? Number(t) : t)));
  }
  return {
    emitter: e.name,
    emitterIndex: e.ordinal,
    curve: c.name,
    stride: c.stride,
    count: c.points,
    points: pts,
    ...(c.wellFormed ? {} : { wellFormed: false }),
    ...(c.known ? {} : { known: false }),
    line: c.line,
  };
}

interface RefRow {
  emitter?: string;
  emitterIndex?: number;
  key: string;
  resource: string;
  guid: string;
  path: string;
  found?: "project" | "game" | "missing";
  line: number;
}

function refRows(
  view: ParticleView,
  has: (path: string) => "project" | "game" | "missing",
): RefRow[] {
  const rows: RefRow[] = [];
  const add = (p: PropView, e?: EmitterView) => {
    const raw = p.values[0] ?? "";
    const m = /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(raw);
    if (!m) return;
    rows.push(
      dropUndefined({
        emitter: e?.name,
        emitterIndex: e?.ordinal,
        key: p.key,
        resource: raw,
        guid: m[1].toUpperCase(),
        path: m[2],
        found: m[2] ? has(m[2]) : undefined,
        line: p.line,
      }) as RefRow,
    );
  };
  for (const p of view.effect) if (EFFECT_KEYS[p.key]?.kind === "guid") add(p);
  for (const e of view.emitters)
    for (const p of e.props) if (EMITTER_KEYS[p.key]?.kind === "ref") add(p, e);
  return rows;
}

// ── Emitter references ───────────────────────────────────────────────────────

function hasEmitterRef(a: ParticleRequest): boolean {
  return a.emitter !== undefined || a.index !== undefined;
}

function names(view: ParticleView): string {
  const n = view.emitters.map((e) => e.name || "(unnamed)");
  return n.length === 0
    ? "no emitters"
    : `emitters: ${n.slice(0, 20).join(", ")}${n.length > 20 ? ", ..." : ""}`;
}

/** The emitter a request names: by `emitter` (the name) or by `index` (its position). */
export function pickEmitter(
  view: ParticleView,
  a: { emitter?: string; index?: number },
): EmitterView {
  if (a.emitter !== undefined && a.index !== undefined)
    bad("name the emitter by emitter or by index, not both");
  if (a.index !== undefined) {
    if (!Number.isInteger(a.index) || a.index < 0)
      return bad("index must be a non-negative integer");
    const e = view.emitters[a.index];
    return e ?? missing(`no emitter at index ${a.index} (${names(view)})`);
  }
  if (a.emitter === undefined || a.emitter === "")
    return bad("emitter (a name) or index is required");
  const hits = view.emitters.filter((e) => e.name === a.emitter);
  if (hits.length === 0) return missing(`no emitter named "${a.emitter}" (${names(view)})`);
  if (hits.length > 1)
    bad(
      `${hits.length} emitters are named "${a.emitter}" (indexes ${hits.map((h) => h.ordinal).join(", ")}): pass index`,
    );
  return hits[0];
}

function cleanName(raw: string | undefined, what: string): string {
  const n = (raw ?? "").trim();
  if (n === "") return bad(`${what} is required`);
  if (!IDENT.test(n))
    bad(`${what} must be letters, digits and underscores, not starting with a digit: ${raw}`);
  return n;
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

// ── Edits ────────────────────────────────────────────────────────────────────

export interface Work {
  doc: CstDocument;
}

export interface OpResult {
  changes: Change[];
  warnings: string[];
}

export interface EditContext {
  /** copyEmitter: the document the emitter comes from. */
  source?: { doc: CstDocument; rel: string; game: boolean };
}

function reload(w: Work, text: string): void {
  w.doc = new CstDocument(text, w.doc.encoding);
}

function effectOf(w: Work): ParticleView {
  const v = viewParticle(w.doc);
  if (!v.ok) bad(`the file is not one EffectDef (${v.rootKey || "no root"})`);
  return v;
}

const emitterPath = (e: EmitterView): string => `Emitters[${e.childIndex}]`;
const label = (e: EmitterView, key?: string): string =>
  `Emitters[${e.name || e.ordinal}]${key ? `.${key}` : ""}`;

/** Where a new scalar goes: before the block's first nested block, else at its end. */
function scalarSlot(block: CstObject): number | undefined {
  const i = block.children.findIndex((c) => c.kind === "object");
  return i < 0 ? undefined : i;
}

function checkKey(key: string): void {
  if (!IDENT.test(key)) bad(`not a key: ${key}`);
  if (CURVES[key]) bad(`${key} is a curve block: use setCurve`);
  if (key === "Emitters" || key === "EmitterDef")
    bad(`${key} is structure: use the emitter actions`);
}

export function setProps(w: Work, a: ParticleRequest): OpResult {
  const props = a.props ?? {};
  const unset = a.unset ?? [];
  if (Object.keys(props).length === 0 && unset.length === 0)
    bad("set needs props (key to value) or unset (keys to remove)");
  const changes: Change[] = [];
  const warnings: string[] = [];
  const emitterChild = hasEmitterRef(a) ? pickEmitter(effectOf(w), a).childIndex : undefined;
  const specs = emitterChild === undefined ? EFFECT_KEYS : EMITTER_KEYS;
  const here = () => {
    const v = effectOf(w);
    const e =
      emitterChild === undefined
        ? undefined
        : v.emitters.find((x) => x.childIndex === emitterChild);
    return { v, e, props: e ? e.props : v.effect, block: e ? e.obj : v.root! };
  };
  const where = (key: string) => {
    const { e } = here();
    return e ? label(e, key) : `EffectDef.${key}`;
  };
  for (const [key, val] of Object.entries(props)) {
    checkKey(key);
    const spec = specs[key];
    const cur = here();
    const existing = prop(cur.props, key);
    if (!spec && !existing && !a.allowUnknown)
      bad(
        `${key} is not a known ${emitterChild === undefined ? "effect" : "emitter"} key (particle catalog lists them); allowUnknown: true writes it anyway`,
      );
    if (!spec) warnings.push(`${key}: not in the catalog, written as given`);
    const conv = convertValue(spec, key, val);
    warnings.push(...conv.warnings);
    if (cur.props.filter((p) => p.key === key).length > 1)
      warnings.push(`${key} appears more than once; the first one is changed`);
    const before = existing ? existing.values.join(" ") : null;
    const after = conv.items.join(" ");
    if (existing) {
      const path = cur.e ? `${emitterPath(cur.e)}.${key}` : key;
      w.doc.set(path, conv.items, { quoted: conv.quoted });
    } else {
      const at = cur.e
        ? scalarSlot(cur.e.obj)
        : cur.v.block
          ? cur.v.root!.children.indexOf(cur.v.block)
          : undefined;
      w.doc.arrayAdd(
        cur.e ? emitterPath(cur.e) : "",
        { key, value: conv.items, quoted: conv.quoted },
        at === undefined || at < 0 ? undefined : at,
      );
    }
    changes.push({ path: where(key), before, after });
  }
  for (const key of unset) {
    if (!IDENT.test(key)) bad(`not a key: ${key}`);
    const cur = here();
    const existing = prop(cur.props, key);
    if (!existing) {
      warnings.push(`${key} is not set here; nothing to remove`);
      continue;
    }
    w.doc.delete(cur.e ? `${emitterPath(cur.e)}.${key}` : key);
    changes.push({ path: where(key), before: existing.values.join(" "), after: null });
  }
  return { changes, warnings };
}

function parsePoints(curve: string, stride: number, raw: number[]): string[] {
  if (raw.length % stride !== 0)
    bad(
      `${curve} takes ${stride} numbers per point (${stride === 4 ? "time r g b" : "time value"}), got ${raw.length}`,
    );
  let prev = -Infinity;
  return raw.map((x, i) => {
    const n = parseNum(x);
    if (n === undefined) return bad(`points[${i}] is not a finite number`);
    if (i % stride === 0) {
      if (n < 0 || n > 1) bad(`points[${i}]: a time must be within 0 to 1, got ${n}`);
      if (n < prev) bad(`points[${i}]: times must not decrease (${n} after ${prev})`);
      prev = n;
    }
    return fmtNum(n);
  });
}

export function setCurve(w: Work, a: ParticleRequest): OpResult {
  const name = a.curve ?? "";
  if (!IDENT.test(name)) bad("curve (a curve block name, see the catalog) is required");
  const spec = CURVES[name];
  if (!spec && !a.allowUnknown)
    bad(
      `${name} is not a known curve (particle catalog lists them); allowUnknown: true writes it anyway`,
    );
  const pts = a.points;
  if (pts === undefined) return bad("points is required (an empty list removes the curve)");
  const warnings: string[] = spec
    ? []
    : [`${name}: not in the catalog, written as numbers in pairs`];
  const view = effectOf(w);
  const e = pickEmitter(view, a);
  const existing = e.curves.find((c) => c.name === name);
  const path = `${emitterPath(e)}.${name}`;
  const before = existing ? existing.numbers.join(" ") : null;
  if (pts.length === 0) {
    if (!existing)
      return missing(
        `${label(e)} has no ${name} curve (${e.curves.map((c) => c.name).join(", ") || "no curves"})`,
      );
    w.doc.delete(path);
    return { changes: [{ path: label(e, name), before, after: null }], warnings };
  }
  const items = parsePoints(name, spec ? spec.stride : 2, pts);
  if (existing) {
    const obj = e.obj.children[existing.childIndex] as CstObject;
    const single = obj.children.length === 1 && obj.children[0].kind === "value";
    if (single) w.doc.set(`${path}[0]`, items, { quoted: false });
    else {
      w.doc.delete(path);
      w.doc.createObject(
        emitterPath(e),
        { key: name, entries: [{ value: items, quoted: false }] },
        existing.childIndex,
      );
    }
  } else {
    w.doc.createObject(emitterPath(e), { key: name, entries: [{ value: items, quoted: false }] });
  }
  return { changes: [{ path: label(e, name), before, after: items.join(" ") }], warnings };
}

/** An ObjectSpec for an existing emitter block, under `name`. Comments inside it are not carried. */
function specOf(doc: CstDocument, e: CstObject, name: string, warnings: string[]): ObjectSpec {
  const entries = (list: CstEntry[], depth: number): EntrySpec[] =>
    list.map((c): EntrySpec => {
      if (c.kind === "scalar" || c.kind === "value") {
        const toks = c.values;
        const vals = toks.map(tokenValue);
        const q = toks.filter((t) => t.kind === "string").length;
        if (vals.length === 0 || (q !== 0 && q !== toks.length))
          return bad(
            `line ${lineIndex(doc.text)(c.start)}: an entry with no value or mixed quoting cannot be copied`,
          );
        return c.kind === "scalar"
          ? { key: c.key, value: vals, quoted: q > 0 }
          : { value: vals, quoted: q > 0 };
      }
      if (c.kind === "object" && depth === 0 && c.head.length === 1) {
        return { object: { key: c.key, entries: entries(c.children, 1) } };
      }
      return bad(
        `line ${lineIndex(doc.text)(c.start)}: this emitter holds a construct the tool cannot copy (${c.kind})`,
      );
    });
  if (doc.tokens.some((t) => t.kind === "comment" && t.start >= e.start && t.end <= e.end))
    warnings.push("comments inside the emitter are not copied");
  return { key: "EmitterDef", name, entries: entries(e.children, 0) };
}

function insertEmitter(w: Work, spec: ObjectSpec, at: number | undefined): number {
  const view = effectOf(w);
  const n = view.emitters.length;
  const pos = at === undefined ? n : at;
  if (!Number.isInteger(pos) || pos < 0 || pos > n) bad(`at must be an integer from 0 to ${n}`);
  if (!view.block) {
    w.doc.createObject("", { key: "Emitters", entries: [{ object: spec }] });
    return 0;
  }
  if (view.foreign > 0 && pos < n)
    bad("the Emitters block holds entries that are not emitters; add at the end");
  w.doc.createObject("Emitters", spec, pos < n ? view.emitters[pos].childIndex : undefined);
  return pos;
}

function summary(e: EmitterView): Record<string, unknown> {
  return { name: e.name, props: e.props.length, curves: e.curves.map((c) => c.name) };
}

function entriesFor(a: ParticleRequest): { entries: EntrySpec[]; warnings: string[] } {
  const entries: EntrySpec[] = [];
  const warnings: string[] = [];
  for (const [key, val] of Object.entries(a.props ?? {})) {
    checkKey(key);
    const spec = EMITTER_KEYS[key];
    if (!spec && !a.allowUnknown)
      bad(
        `${key} is not a known emitter key (particle catalog lists them); allowUnknown: true writes it anyway`,
      );
    if (!spec) warnings.push(`${key}: not in the catalog, written as given`);
    const c = convertValue(spec, key, val);
    warnings.push(...c.warnings);
    entries.push({ key, value: c.items, quoted: c.quoted });
  }
  return { entries, warnings };
}

export function addEmitter(w: Work, a: ParticleRequest): OpResult {
  const name = cleanName(a.name, "name");
  const view = effectOf(w);
  if (view.emitters.some((e) => e.name === name))
    throw new ParticleError("DUPLICATE_ID", `an emitter named "${name}" already exists`);
  const { entries, warnings } = entriesFor(a);
  const pos = insertEmitter(w, { key: "EmitterDef", name, entries }, a.at);
  return {
    changes: [
      {
        path: `Emitters[${name}]`,
        before: null,
        after: { name, index: pos, props: entries.length },
      },
    ],
    warnings,
  };
}

export function cloneEmitter(w: Work, a: ParticleRequest): OpResult {
  const view = effectOf(w);
  const src = pickEmitter(view, a);
  const taken = new Set(view.emitters.map((e) => e.name));
  const name =
    a.name === undefined ? uniqueName(`${src.name}_copy`, taken) : cleanName(a.name, "name");
  if (taken.has(name))
    throw new ParticleError("DUPLICATE_ID", `an emitter named "${name}" already exists`);
  const warnings: string[] = [];
  const spec = specOf(w.doc, src.obj, name, warnings);
  const pos = insertEmitter(w, spec, a.at === undefined ? src.ordinal + 1 : a.at);
  return {
    changes: [
      {
        path: `Emitters[${name}]`,
        before: null,
        after: { name, index: pos, clonedFrom: src.name },
      },
    ],
    warnings,
  };
}

export function copyEmitter(w: Work, a: ParticleRequest, ctx: EditContext): OpResult {
  const source = ctx.source;
  if (!source) return bad("copyEmitter needs from (the .ptc to copy the emitter out of)");
  const sv = viewParticle(source.doc);
  if (!sv.ok) bad(`${source.rel} is not one EffectDef`);
  const src = pickEmitter(sv, a);
  const view = effectOf(w);
  const taken = new Set(view.emitters.map((e) => e.name));
  const name = a.name === undefined ? uniqueName(src.name, taken) : cleanName(a.name, "name");
  if (taken.has(name))
    throw new ParticleError("DUPLICATE_ID", `an emitter named "${name}" already exists`);
  const warnings: string[] = [];
  const spec = specOf(source.doc, src.obj, name, warnings);
  if (source.doc.encoding !== w.doc.encoding && w.doc.encoding === "latin1")
    bad("the target file is latin-1 and the source is not: nothing copied");
  const pos = insertEmitter(w, spec, a.at);
  const refs = src.props.filter((p) => EMITTER_KEYS[p.key]?.kind === "ref").length;
  if (source.game && refs > 0)
    warnings.push(
      `${refs} Material/Prefab ref(s) point at game resources: they resolve only while the project depends on the game addon`,
    );
  return {
    changes: [
      {
        path: `Emitters[${name}]`,
        before: null,
        after: { name, index: pos, copiedFrom: `${source.rel}#${src.name}` },
      },
    ],
    warnings,
  };
}

export function renameEmitter(w: Work, a: ParticleRequest): OpResult {
  const view = effectOf(w);
  const e = pickEmitter(view, a);
  const name = cleanName(a.name, "name");
  if (name === e.name) return { changes: [], warnings: [`the emitter is already named "${name}"`] };
  if (view.emitters.some((x) => x !== e && x.name === name))
    throw new ParticleError("DUPLICATE_ID", `an emitter named "${name}" already exists`);
  const tok = e.obj.head[1];
  if (!tok || e.obj.head.length !== 2)
    return bad(`line ${e.line}: the emitter header has no single name to replace`);
  reload(w, w.doc.text.slice(0, tok.start) + name + w.doc.text.slice(tok.end));
  return {
    changes: [{ path: `Emitters[${e.ordinal}].name`, before: e.name, after: name }],
    warnings: [],
  };
}

export function removeEmitter(w: Work, a: ParticleRequest): OpResult {
  const view = effectOf(w);
  const e = pickEmitter(view, a);
  w.doc.arrayRemove("Emitters", e.childIndex);
  return {
    changes: [{ path: label(e), before: summary(e), after: null }],
    warnings: view.emitters.length === 1 ? ["the effect has no emitters now"] : [],
  };
}

export function moveEmitter(w: Work, a: ParticleRequest): OpResult {
  const view = effectOf(w);
  const e = pickEmitter(view, a);
  const n = view.emitters.length;
  if (a.at === undefined || !Number.isInteger(a.at) || a.at < 0 || a.at >= n)
    return bad(`at (the new position) must be an integer from 0 to ${n - 1}`);
  if (view.foreign > 0)
    bad("the Emitters block holds entries that are not emitters; nothing moved");
  if (a.at === e.ordinal)
    return { changes: [], warnings: [`"${e.name}" is already at position ${a.at}`] };
  w.doc.arrayMove("Emitters", e.childIndex, a.at);
  return {
    changes: [{ path: label(e), before: { index: e.ordinal }, after: { index: a.at } }],
    warnings: [],
  };
}

/** Applies one edit action (not `create`) to `w`; throws ParticleError, CstEditError or VocabularyError. */
export function applyEdit(
  w: Work,
  action: Exclude<WriteAction, "create">,
  a: ParticleRequest,
  ctx: EditContext = {},
): OpResult {
  switch (action) {
    case "set":
      return setProps(w, a);
    case "setCurve":
      return setCurve(w, a);
    case "addEmitter":
      return addEmitter(w, a);
    case "cloneEmitter":
      return cloneEmitter(w, a);
    case "copyEmitter":
      return copyEmitter(w, a, ctx);
    case "renameEmitter":
      return renameEmitter(w, a);
    case "removeEmitter":
      return removeEmitter(w, a);
    default:
      return moveEmitter(w, a);
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface Issue {
  severity: "error" | "warning";
  code: string;
  message: string;
  emitter?: string;
  line?: number;
}

export function validateView(doc: CstDocument, view: ParticleView): Issue[] {
  const out: Issue[] = [];
  const err = (code: string, message: string, extra: Partial<Issue> = {}) =>
    out.push({ severity: "error", code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<Issue> = {}) =>
    out.push({ severity: "warning", code, message, ...extra });
  for (const d of doc.diagnostics) err("PARSE", d.message, { line: d.line });
  if (!view.ok) {
    err("ROOT", `the root is not a single EffectDef (${view.rootKey || "none"})`);
    return out;
  }
  if (view.blocks.length === 0) warn("NO_EMITTERS_BLOCK", "the effect has no Emitters block");
  if (view.blocks.length > 1)
    err("EMITTERS_BLOCKS", `the effect has ${view.blocks.length} Emitters blocks`);
  if (view.foreign > 0)
    err("FOREIGN", `${view.foreign} entry(ies) in Emitters are not EmitterDef blocks`);
  const dupKeys = (props: PropView[], where: Partial<Issue>) => {
    const seen = new Set<string>();
    for (const p of props) {
      if (seen.has(p.key))
        warn("DUPLICATE_KEY", `${p.key} appears more than once`, { ...where, line: p.line });
      seen.add(p.key);
    }
  };
  const checkProps = (
    props: PropView[],
    specs: Readonly<Record<string, KeySpec>>,
    where: Partial<Issue>,
  ) => {
    for (const p of props) {
      const spec = specs[p.key];
      if (!spec) {
        warn("UNKNOWN_KEY", `${p.key} is not a key the vanilla corpus uses`, {
          ...where,
          line: p.line,
        });
        continue;
      }
      const why = kindProblem(spec, p.values, p.quoted);
      if (why)
        err("BAD_VALUE", `${p.key} ${why}, got ${p.values.join(" ") || "nothing"}`, {
          ...where,
          line: p.line,
        });
      else if (spec.kind === "enum" && spec.values && !spec.values.includes(p.values[0]))
        warn("UNSEEN_VALUE", `${p.key} ${p.values[0]} is not a value the vanilla corpus uses`, {
          ...where,
          line: p.line,
        });
    }
    dupKeys(props, where);
  };
  checkProps(view.effect, EFFECT_KEYS, {});
  const seen = new Map<string, number>();
  for (const e of view.emitters) {
    const where = { emitter: e.name || `#${e.ordinal}` };
    if (!e.named) err("NO_NAME", "the emitter has no single name", { ...where, line: e.line });
    else if (!IDENT.test(e.name))
      err("BAD_NAME", `"${e.name}" is not an identifier`, { ...where, line: e.line });
    if (e.named && seen.has(e.name))
      warn("DUPLICATE_NAME", `the name is also emitter ${seen.get(e.name)}`, {
        ...where,
        line: e.line,
      });
    else seen.set(e.name, e.ordinal);
    if (e.others > 0)
      err("OTHER_ENTRY", `${e.others} entry(ies) are neither scalars nor curve blocks`, {
        ...where,
        line: e.line,
      });
    checkProps(e.props, EMITTER_KEYS, where);
    const type = first(e.props, "ParticleType");
    if (type === "Prefab" && !prop(e.props, "Prefab"))
      warn("NO_PREFAB", "ParticleType is Prefab and there is no Prefab ref", {
        ...where,
        line: e.line,
      });
    if (type !== "Prefab" && !prop(e.props, "Material"))
      warn("NO_MATERIAL", "no Material ref", { ...where, line: e.line });
    const lo = Number(first(e.props, "LodMin"));
    const hi = Number(first(e.props, "LodMax"));
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > hi)
      warn("LOD_RANGE", `LodMin ${lo} is above LodMax ${hi}`, { ...where, line: e.line });
    const seenCurves = new Set<string>();
    for (const c of e.curves) {
      const at = { ...where, line: c.line };
      if (!c.known)
        warn("UNKNOWN_CURVE", `${c.name} is not a curve block the vanilla corpus uses`, at);
      if (seenCurves.has(c.name)) warn("DUPLICATE_CURVE", `${c.name} appears more than once`, at);
      seenCurves.add(c.name);
      if (!c.wellFormed) {
        err(
          "BAD_CURVE",
          `${c.name} is not ${c.stride === 4 ? "time r g b tuples" : "time value pairs"} of numbers (${c.numbers.length} numbers)`,
          at,
        );
        continue;
      }
      let prev = -Infinity;
      for (let i = 0; i < c.numbers.length; i += c.stride) {
        const t = Number(c.numbers[i]);
        if (t < prev) {
          err("CURVE_ORDER", `${c.name}: time ${t} comes after ${prev}`, at);
          break;
        }
        prev = t;
      }
      for (let i = 0; i < c.numbers.length; i += c.stride) {
        const t = Number(c.numbers[i]);
        if (t < 0 || t > 1) {
          warn("CURVE_RANGE", `${c.name}: time ${t} is outside 0 to 1`, at);
          break;
        }
      }
    }
  }
  return out;
}

// ── Catalog rows ─────────────────────────────────────────────────────────────

function catalogRows(filter?: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const keyRow = (scope: string, key: string, s: KeySpec) =>
    dropUndefined({
      scope,
      key,
      kind: s.kind,
      group: s.group,
      count: s.kind === "vec3" ? 3 : undefined,
      values: s.values,
      ext: s.ext,
    });
  for (const [k, s] of Object.entries(EFFECT_KEYS)) rows.push(keyRow("effect", k, s));
  for (const [k, s] of Object.entries(EMITTER_KEYS)) rows.push(keyRow("emitter", k, s));
  for (const [k, s] of Object.entries(CURVES))
    rows.push({ scope: "curve", key: k, stride: s.stride, note: s.note });
  const f = filter?.trim().toLowerCase();
  return f ? rows.filter((r) => String(r.key).toLowerCase().includes(f)) : rows;
}

// ── Diff ─────────────────────────────────────────────────────────────────────

interface DiffRow {
  scope: "effect" | "emitters" | "emitter" | "curve" | "order";
  emitter?: string;
  key?: string;
  change: "changed" | "added" | "removed";
  before?: unknown;
  after?: unknown;
}

function diffViews(a: ParticleView, b: ParticleView): DiffRow[] {
  const rows: DiffRow[] = [];
  const cmpProps = (
    scope: "effect" | "emitter",
    pa: PropView[],
    pb: PropView[],
    emitter?: string,
  ) => {
    const ma = new Map<string, string>();
    for (const p of pa) if (!ma.has(p.key)) ma.set(p.key, p.values.join(" "));
    const mb = new Map<string, string>();
    for (const p of pb) if (!mb.has(p.key)) mb.set(p.key, p.values.join(" "));
    for (const [k, v] of ma) {
      if (!mb.has(k)) rows.push({ scope, emitter, key: k, change: "removed", before: v });
      else if (mb.get(k) !== v)
        rows.push({ scope, emitter, key: k, change: "changed", before: v, after: mb.get(k) });
    }
    for (const [k, v] of mb)
      if (!ma.has(k)) rows.push({ scope, emitter, key: k, change: "added", after: v });
  };
  cmpProps("effect", a.effect, b.effect);
  const key = (v: ParticleView) => {
    const count = new Map<string, number>();
    return v.emitters.map((e) => {
      const n = count.get(e.name) ?? 0;
      count.set(e.name, n + 1);
      return { id: n === 0 ? e.name : `${e.name}#${n + 1}`, e };
    });
  };
  const ka = key(a);
  const kb = key(b);
  const mb = new Map(kb.map((x) => [x.id, x.e]));
  const ma = new Map(ka.map((x) => [x.id, x.e]));
  for (const { id, e } of ka) {
    const o = mb.get(id);
    if (!o) {
      rows.push({ scope: "emitters", key: id, change: "removed", before: summary(e) });
      continue;
    }
    cmpProps("emitter", e.props, o.props, id);
    const ca = new Map(e.curves.map((c) => [c.name, c.numbers.join(" ")]));
    const cb = new Map(o.curves.map((c) => [c.name, c.numbers.join(" ")]));
    for (const [k, v] of ca) {
      if (!cb.has(k))
        rows.push({ scope: "curve", emitter: id, key: k, change: "removed", before: v });
      else if (cb.get(k) !== v)
        rows.push({
          scope: "curve",
          emitter: id,
          key: k,
          change: "changed",
          before: v,
          after: cb.get(k),
        });
    }
    for (const [k, v] of cb)
      if (!ca.has(k)) rows.push({ scope: "curve", emitter: id, key: k, change: "added", after: v });
  }
  for (const { id, e } of kb)
    if (!ma.has(id)) rows.push({ scope: "emitters", key: id, change: "added", after: summary(e) });
  const common = (xs: typeof ka, ys: Map<string, EmitterView>) =>
    xs.filter((x) => ys.has(x.id)).map((x) => x.id);
  const oa = common(ka, mb);
  const ob = common(kb, ma);
  if (oa.join("\n") !== ob.join("\n"))
    rows.push({ scope: "order", change: "changed", before: oa, after: ob });
  return rows;
}

// ── Read actions ─────────────────────────────────────────────────────────────

function sourceWarnings(l: Loaded): string[] {
  const out: string[] = [];
  const why = unwritableReason(l.buf, l.doc);
  if (why) out.push(`this tool would refuse to edit the file: ${why}`);
  if (l.source === "game")
    out.push("game resource (read only): game_duplicate copies it into the project");
  return out;
}

function targetOf(rel: string): string {
  return `path:${rel}`;
}

function readAction(req: ParticleRequest, config: Config, deps: ParticleDeps): ActionResponse {
  const action = req.action as ReadAction;
  if (action === "catalog") {
    const p = pageOf(catalogRows(req.key), req);
    return okResponse(
      action,
      "catalog",
      null,
      {
        total: p.total,
        rows: p.items,
        cursor: p.cursor,
        nextCursor: p.nextCursor,
      },
      [],
    );
  }
  if (!req.path) return bad("path is required");
  const l = load(req.path, req, config, deps);
  const view = viewParticle(l.doc);
  const target = targetOf(l.loc.rel);
  const warnings = sourceWarnings(l);
  if (!view.ok)
    return bad(
      `${l.loc.rel} is not a particle effect: its root is ${view.rootKey || "not an EffectDef"}`,
    );
  switch (action) {
    case "inspect": {
      const p = pageOf(view.emitters.map(emitterRow), req);
      const curveCount = view.emitters.reduce((n, e) => n + e.curves.length, 0);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          bytes: l.buf.length,
          version: first(view.effect, "Version"),
          effect: effectMap(view.effect),
          emitterCount: view.emitters.length,
          curveCount,
          emitters: p.items,
          cursor: p.cursor,
          nextCursor: p.nextCursor,
        },
        warnings,
      );
    }
    case "emitters": {
      const p = pageOf(view.emitters.map(emitterRow), req);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          total: p.total,
          emitters: p.items,
          cursor: p.cursor,
          nextCursor: p.nextCursor,
        },
        warnings,
      );
    }
    case "emitter": {
      const e = pickEmitter(view, req);
      const unknownKeys = e.props.filter((x) => !EMITTER_KEYS[x.key]).map((x) => x.key);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          index: e.ordinal,
          name: e.name,
          line: e.line,
          props: e.props.map((x) =>
            dropUndefined({
              key: x.key,
              value: jsonValue(x.values),
              known: EMITTER_KEYS[x.key] ? undefined : false,
              line: x.line,
            }),
          ),
          curves: e.curves.map((c) => ({
            name: c.name,
            stride: c.stride,
            points: c.points,
            line: c.line,
          })),
          unknownKeys,
        },
        warnings,
      );
    }
    case "curves": {
      const picked = hasEmitterRef(req) ? [pickEmitter(view, req)] : view.emitters;
      const rows = picked.flatMap((e) =>
        e.curves
          .filter((c) => req.curve === undefined || c.name === req.curve)
          .map((c) => curveRow(e, c)),
      );
      const p = pageOf(rows, req);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          total: p.total,
          curves: p.items,
          cursor: p.cursor,
          nextCursor: p.nextCursor,
        },
        warnings,
      );
    }
    case "refs": {
      const root = l.loc.root ?? pinnedProjectRoot(req.projectPath, config.projectPath);
      const vfs = vfsOf(config, deps);
      const has = (path: string): "project" | "game" | "missing" => {
        try {
          if (root && existsSync(join(resolve(root), checkRelativePath(path)))) return "project";
        } catch {
          /* a path that is not a clean relative path is not a project file */
        }
        try {
          return vfs?.exists(path) ? "game" : "missing";
        } catch {
          return "missing";
        }
      };
      const rows = refRows(view, has);
      const p = pageOf(rows, req);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          total: p.total,
          missing: rows.filter((r) => r.found === "missing").length,
          refs: p.items,
          cursor: p.cursor,
          nextCursor: p.nextCursor,
        },
        warnings,
      );
    }
    case "validate": {
      const issues = validateView(l.doc, view);
      const errors = issues.filter((i) => i.severity === "error");
      const p = pageOf(issues, req);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          valid: errors.length === 0,
          errors: errors.length,
          warnings: issues.length - errors.length,
          issues: p.items,
          cursor: p.cursor,
          nextCursor: p.nextCursor,
        },
        warnings,
      );
    }
    default: {
      if (!req.against) return bad("against (the .ptc to compare with) is required");
      const o = load(req.against, req, config, deps);
      const ov = viewParticle(o.doc);
      if (!ov.ok)
        bad(
          `${o.loc.rel} is not a particle effect: its root is ${ov.rootKey || "not an EffectDef"}`,
        );
      const rows = diffViews(view, ov);
      const p = pageOf(rows, req);
      return okResponse(
        action,
        target,
        null,
        {
          source: l.source,
          against: o.loc.rel,
          againstSource: o.source,
          identical: Buffer.compare(l.buf, o.buf) === 0,
          total: p.total,
          differences: p.items,
          cursor: p.cursor,
          nextCursor: p.nextCursor,
        },
        warnings,
      );
    }
  }
}

// ── Write actions ────────────────────────────────────────────────────────────

function commit(
  req: ParticleRequest,
  loc: Located,
  before: string,
  w: Work,
  op: OpResult,
  creating: boolean,
  existed: boolean,
): ActionResponse {
  const bytes = w.doc.toBytes();
  const after = w.doc.serialize();
  const check = viewParticle(w.doc);
  if (!check.ok || check.blocks.length > 1 || w.doc.diagnostics.length > 0)
    throw new ParticleError(
      "INVALID_ARGUMENT",
      "the edit would produce a file that does not parse as one EffectDef; nothing written",
    );
  const diff = unifiedDiff(before, after, loc.rel);
  const confirmed = req.confirm === true;
  const target = targetOf(loc.rel);
  if (!confirmed || (!creating && before === after)) {
    return okResponse(
      req.action,
      target,
      op.changes,
      { diff, bytesBefore: Buffer.byteLength(before), bytesAfter: bytes.length },
      op.warnings,
      confirmed ? undefined : "Run again with confirm: true to write exactly this change.",
      !confirmed,
    );
  }
  const file = loc.file!;
  let backup: string | undefined;
  if (creating) {
    mkdirSync(dirname(file), { recursive: true });
    if (existed) {
      // A numbered backup: an earlier .bak is kept (review round 1, W4-AS-1).
      backup = backUp(file, (m) => {
        throw new ParticleError("INVALID_ARGUMENT", m);
      });
    }
    try {
      if (req.overwrite) writeFileAtomic(file, bytes);
      else writeFileSync(file, bytes, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new ParticleError(
          "INVALID_ARGUMENT",
          `${loc.rel} already exists; pass overwrite: true to replace it`,
        );
      throw e;
    }
  } else {
    if (Buffer.compare(readFileSync(file), Buffer.from(before, w.doc.encoding)) !== 0)
      throw new ParticleError(
        "INVALID_ARGUMENT",
        `${loc.rel} changed on disk since it was read; nothing written, read it again`,
      );
    backup = backUp(file, (m) => {
      throw new ParticleError("INVALID_ARGUMENT", m);
    });
    writeFileAtomic(file, bytes);
  }
  const back = readFileSync(file);
  if (Buffer.compare(back, bytes) !== 0)
    return errorResponse(
      req.action,
      target,
      "SAVE_FAILED",
      "the file read back differs from what was written",
    );
  const v = viewParticle(parseCstBytes(back));
  return okResponse(
    req.action,
    target,
    op.changes,
    {
      diff,
      bytes: back.length,
      emitters: v.emitters.length,
      curves: v.emitters.reduce((n, e) => n + e.curves.length, 0),
      ...(backup ? { backup: backupRel(loc.rel, file, backup) } : {}),
    },
    op.warnings,
    creating && !existed
      ? "A new file is not yet known to the engine: register it with wb_resources register."
      : "An open Particle Editor tab keeps its own copy: reopen the effect there, and do not save the old tab over this file.",
    false,
  );
}

function writeAction(req: ParticleRequest, config: Config, deps: ParticleDeps): ActionResponse {
  if (!req.path) return bad("path is required");
  const loc = locate(req.path, pinnedProjectRoot(req.projectPath, config.projectPath), false);
  if (!loc.file || !loc.root)
    throw new ParticleError(
      "NOT_IN_PROJECT",
      "writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  if (req.action === "create") {
    const exists = existsSync(loc.file);
    if (exists && !req.overwrite)
      throw new ParticleError(
        "INVALID_ARGUMENT",
        `${loc.rel} already exists; pass overwrite: true to replace it`,
      );
    const before = exists ? readFileSync(loc.file, "utf-8") : "";
    const firstName = cleanName(req.name ?? "Emitter_01", "name");
    const w: Work = { doc: new CstDocument(skeleton(firstName)) };
    const op: OpResult = {
      changes: [
        { path: "file", before: exists ? "existing file" : null, after: { emitters: [firstName] } },
      ],
      warnings: exists
        ? ["overwrite: the existing file is replaced whole (a .bak copy is kept)"]
        : [],
    };
    if (req.props && Object.keys(req.props).length > 0) {
      const s = setProps(w, {
        ...req,
        emitter: undefined,
        index: 0,
        props: req.props,
        unset: undefined,
      });
      op.changes.push(...s.changes);
      op.warnings.push(...s.warnings);
    }
    return commit(req, loc, before, w, op, true, exists);
  }
  if (!existsSync(loc.file)) {
    if (vfsOf(config, deps)?.exists(loc.rel))
      throw new ParticleError(
        "READ_ONLY_SOURCE",
        `${loc.rel} is game data (read only): copy it into the project with game_duplicate, then edit the copy`,
        "Copy the file into the project (game_duplicate), then run the edit on the copy.",
      );
    return missing(`no particle effect at ${loc.rel} under ${loc.root}; create makes a new one`);
  }
  if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
  const buf = readFileSync(loc.file);
  const w: Work = { doc: parseCstBytes(buf) };
  const why = unwritableReason(buf, w.doc);
  if (why)
    throw new ParticleError(
      "INVALID_ARGUMENT",
      `${loc.rel} is left alone: ${why}. Edit it in the Particle Editor.`,
    );
  const before = w.doc.serialize();
  const ctx: EditContext = {};
  if (req.action === "copyEmitter") {
    if (!req.from) return bad("copyEmitter needs from (the .ptc to copy the emitter out of)");
    const s = load(req.from, req, config, deps);
    ctx.source = { doc: s.doc, rel: s.loc.rel, game: s.source === "game" };
  }
  const op = applyEdit(w, req.action as Exclude<WriteAction, "create">, req, ctx);
  return commit(req, loc, before, w, op, false, true);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Runs one request; every refusal is an `ActionError`, never a throw. */
export function runParticle(
  req: ParticleRequest,
  config: Config,
  deps: ParticleDeps = {},
): ActionResponse {
  const target = req.action === "catalog" ? "catalog" : `path:${String(req.path ?? "")}`;
  try {
    if ((READ_ACTIONS as readonly string[]).includes(req.action))
      return readAction(req, config, deps);
    if ((WRITE_ACTIONS as readonly string[]).includes(req.action))
      return writeAction(req, config, deps);
    return errorResponse(
      String(req.action),
      target,
      "INVALID_ARGUMENT",
      `unknown action ${String(req.action)}`,
    );
  } catch (e) {
    if (e instanceof ParticleError)
      return errorResponse(req.action, target, e.code, e.message, e.next);
    if (e instanceof VocabularyError) return errorResponse(req.action, target, e.code, e.message);
    if (e instanceof CstEditError)
      return errorResponse(
        req.action,
        target,
        e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
        e.message,
      );
    return errorResponse(
      req.action,
      target,
      "HANDLER_ERROR",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export const PARTICLE_DESCRIPTION =
  "Offline .ptc particle effects (EffectDef and its emitters); vanilla pak paths readable. Read: inspect, emitters, emitter, curves, refs, validate, diff, catalog. " +
  "Write, project files only, dry run unless confirm: set, setCurve, addEmitter, cloneEmitter, copyEmitter, renameEmitter, removeEmitter, moveEmitter, create. Preview in a world with wb_particle.";

const propValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

export function registerParticle(server: McpServer, config: Config): void {
  server.registerTool(
    "particle",
    {
      description: PARTICLE_DESCRIPTION,
      inputSchema: {
        action: z.enum([...READ_ACTIONS, ...WRITE_ACTIONS]),
        path: z
          .string()
          .optional()
          .describe(
            "The .ptc: project-relative, absolute inside the project, or (reads) a game path. Not for catalog.",
          ),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
        emitter: z
          .string()
          .optional()
          .describe("Emitter name (the source for cloneEmitter/copyEmitter)."),
        index: z.number().int().min(0).optional().describe("Emitter position, instead of emitter."),
        props: z
          .record(z.string(), propValue)
          .optional()
          .describe(
            "set/addEmitter/create: Key to value ({GUID}path text for Material/Prefab, 3 numbers for vectors, 0/1 flags). No emitter on set means the effect itself.",
          ),
        unset: z.array(z.string()).optional().describe("set: keys to remove."),
        curve: z
          .string()
          .optional()
          .describe("setCurve/curves: curve block name (Alpha, Size, Color ...)."),
        points: z
          .array(z.number())
          .optional()
          .describe(
            "setCurve: flat numbers, time value pairs (time r g b for colour curves), times 0..1 rising. Empty removes the curve.",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "addEmitter/cloneEmitter/copyEmitter/renameEmitter: emitter name; create: first emitter.",
          ),
        at: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("addEmitter/cloneEmitter/copyEmitter/moveEmitter: position."),
        from: z
          .string()
          .optional()
          .describe("copyEmitter: the .ptc to copy the emitter from (project or game)."),
        against: z.string().optional().describe("diff: the .ptc to compare with."),
        key: z.string().optional().describe("catalog: filter by key text."),
        confirm: z
          .boolean()
          .optional()
          .describe("Write the change. Without it the call is a dry run."),
        overwrite: z.boolean().optional().describe("create: replace an existing file."),
        allowUnknown: z
          .boolean()
          .optional()
          .describe("Write a key or curve that is not in the catalog."),
        cursor: z.string().optional().describe("Reads: cursor from the last page."),
        limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("Reads: rows per page."),
      },
    },
    async (args) => {
      const r = runParticle(args as ParticleRequest, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
