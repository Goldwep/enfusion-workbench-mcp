/**
 * `project_settings`: read and edit an addon's `.gproj` as a file.
 *
 * The `.gproj` is the project file the Workbench reads at start: id, GUID,
 * title, the dependency list and one `GameProjectConfig` block per platform.
 * No Workbench call edits it, so the file is the surface. Parsing and writing
 * go through the lossless parser (formats/enfusion-cst.ts): bytes outside an
 * edit never change, and a file whose bytes the parser cannot give back
 * exactly is refused, never rewritten.
 *
 * Reads: a `.gproj` under the project root, else one of the game's own addon
 * project files (read only). Writes: only a `.gproj` that already exists under
 * the project root, and only with confirm: true; without it the call answers
 * the exact change as a before/after list and a unified diff and writes nothing.
 * The tool never creates a `.gproj`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstEditError,
  parseCstBytes,
  tokenValue,
  type CstDocument,
  type CstEntry,
  type CstObject,
  type CstScalar,
} from "../formats/enfusion-cst.js";
import {
  VocabularyError,
  checkRelativePath,
  errorResponse,
  type ActionResponse,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";

export const PROJECT_SETTINGS_ACTIONS = [
  "read",
  "set",
  "addDependency",
  "removeDependency",
  "addPlatform",
  "removePlatform",
] as const;
export type ProjectSettingsAction = (typeof PROJECT_SETTINGS_ACTIONS)[number];

/** Platform names the vanilla project files carry (build 1.9). Others are allowed with a warning. */
export const KNOWN_PLATFORMS = ["PC", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5", "HEADLESS"] as const;

/** Top-level keys that identify the project: `set` refuses them. */
const PROTECTED_KEYS = new Set(["ID", "GUID"]);

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLATFORM = /^[A-Z][A-Z0-9_]*$/;

export interface ProjectSettingsArgs {
  action: ProjectSettingsAction;
  /** `.gproj` path under the project root; omitted: the one `.gproj` in the root. */
  path?: string;
  /** set: scalar key. */
  key?: string;
  /** set: new value. */
  value?: string | number | boolean;
  /** set: force quoting on (true) or off (false); default keeps an existing value's quoting, new strings are quoted. */
  quoted?: boolean;
  /** set: edit inside this platform's block instead of the top level. addPlatform/removePlatform: the name. */
  platform?: string;
  /** addDependency / removeDependency: the dependency's GUID (16 hex digits). */
  guid?: string;
  /** removePlatform: allow dropping a block that holds settings. */
  discard?: boolean;
  /** Write the change. Without it the call is a dry run. */
  confirm?: boolean;
  projectPath?: string;
}

class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const refuse = (code: ErrorCode, message: string): never => {
  throw new Refusal(code, message);
};

// ── Reading the document ─────────────────────────────────────────────────────

interface Summary {
  id?: string;
  guid?: string;
  title?: string;
  dependencies: string[];
  platforms: string[];
  /** Every top-level `Key value` line. */
  settings: Record<string, string>;
  /** Per platform: its own `Key value` lines and the number of nested blocks it holds. */
  platformSettings: Record<string, { settings: Record<string, string>; blocks: number }>;
}

const scalarText = (e: CstScalar): string => e.values.map(tokenValue).join(" ");

function projectBlock(doc: CstDocument): CstObject {
  const b = doc.base;
  if (b.kind !== "object" || b.key !== "GameProject") {
    return refuse("INVALID_ARGUMENT", "not a project file: no single top-level GameProject block");
  }
  return b;
}

const objectsOf = (b: CstObject, key: string): CstObject[] =>
  b.children.filter((c): c is CstObject => c.kind === "object" && c.key === key);

function depValue(e: CstEntry): string | undefined {
  if (e.kind === "value" && e.values.length > 0) return tokenValue(e.values[0]);
  if (e.kind === "scalar") return e.key;
  return undefined;
}

function dependenciesOf(b: CstObject): string[] {
  const block = objectsOf(b, "Dependencies")[0];
  if (!block) return [];
  return block.children.map(depValue).filter((v): v is string => v !== undefined);
}

function platformBlocks(b: CstObject): { name: string; block: CstObject; index: number }[] {
  const cfg = objectsOf(b, "Configurations")[0];
  if (!cfg) return [];
  const out: { name: string; block: CstObject; index: number }[] = [];
  cfg.children.forEach((c, index) => {
    if (c.kind === "object" && c.key === "GameProjectConfig" && c.head.length > 1) {
      out.push({ name: tokenValue(c.head[1]), block: c, index });
    }
  });
  return out;
}

function summarize(doc: CstDocument): Summary {
  const b = projectBlock(doc);
  const settings: Record<string, string> = {};
  for (const c of b.children) if (c.kind === "scalar") settings[c.key] = scalarText(c);
  const platformSettings: Summary["platformSettings"] = {};
  for (const p of platformBlocks(b)) {
    const s: Record<string, string> = {};
    let blocks = 0;
    for (const c of p.block.children) {
      if (c.kind === "scalar") s[c.key] = scalarText(c);
      else if (c.kind === "object") blocks++;
    }
    platformSettings[p.name] = { settings: s, blocks };
  }
  return {
    id: settings.ID,
    guid: settings.GUID,
    title: settings.TITLE,
    dependencies: dependenciesOf(b),
    platforms: platformBlocks(b).map((p) => p.name),
    settings,
    platformSettings,
  };
}

/** Parses bytes; refuses a file this writer could not give back byte for byte. */
function parseStrict(bytes: Buffer, label: string): CstDocument {
  const doc = parseCstBytes(bytes);
  if (!doc.toBytes().equals(bytes)) {
    refuse(
      "INVALID_ARGUMENT",
      `${label}: the parser cannot reproduce this file byte for byte; it is left alone. Edit it in the Workbench or by hand.`,
    );
  }
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    refuse(
      "INVALID_ARGUMENT",
      `${label}: ${doc.diagnostics.length} parse diagnostic(s), first at line ${d.line}: ${d.message}. The file is left alone.`,
    );
  }
  projectBlock(doc);
  return doc;
}

// ── Where the file is ────────────────────────────────────────────────────────

interface Located {
  bytes: Buffer;
  /** Absolute file path when it is a file on disk. */
  file?: string;
  /** Project-relative (or game-relative) path, forward slashes. */
  rel: string;
  source: "project" | "game";
}

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

function gprojInRoot(root: string): string {
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.toLowerCase().endsWith(".gproj"));
  } catch {
    return refuse("PATH_NOT_FOUND", `project root not readable: ${root}`);
  }
  if (names.length === 0) {
    return refuse("PATH_NOT_FOUND", `no .gproj in ${root}; pass path (project-relative).`);
  }
  if (names.length > 1) {
    return refuse(
      "INVALID_ARGUMENT",
      `${names.length} .gproj files in ${root} (${names.join(", ")}); pass path.`,
    );
  }
  return names[0];
}

function locate(args: ProjectSettingsArgs, root: string | undefined, config: Config): Located {
  let rel: string;
  if (args.path !== undefined) {
    try {
      rel = checkRelativePath(args.path);
    } catch (e) {
      if (e instanceof VocabularyError) return refuse(e.code, e.message);
      throw e;
    }
    if (!rel.toLowerCase().endsWith(".gproj")) {
      return refuse("INVALID_ARGUMENT", `${rel} is not a .gproj file`);
    }
  } else {
    if (!root) {
      return refuse(
        "NOT_IN_PROJECT",
        "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
      );
    }
    rel = gprojInRoot(root);
  }

  if (root) {
    const file = resolve(root, rel);
    try {
      assertInsideRoot(file, root, "path");
    } catch (e) {
      return refuse("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
    }
    if (existsSync(file) && statSync(file).isFile()) {
      return { bytes: readFileSync(file), file, rel, source: "project" };
    }
  }
  if (args.action !== "read") {
    return refuse(
      "PATH_NOT_FOUND",
      `${rel}: no such file under ${root ?? "the project"}; ${args.action} edits an existing project file and never creates one.`,
    );
  }
  // Read only: a project file of the game's own addons.
  if (config.gamePath) {
    const file = resolve(config.gamePath, "addons", rel);
    try {
      assertInsideRoot(file, join(config.gamePath, "addons"), "path");
      if (existsSync(file) && statSync(file).isFile()) {
        return { bytes: readFileSync(file), file, rel, source: "game" };
      }
    } catch {
      // fall through to the paks
    }
  }
  const vfs = vfsOf(config);
  if (vfs?.exists(rel)) return { bytes: vfs.readFile(rel), rel, source: "game" };
  return refuse(
    "PATH_NOT_FOUND",
    `${rel}: not under ${root ?? "the project"} and not in the game data` +
      (config.gamePath ? "" : " (game path not available: ENFUSION_GAME_PATH)"),
  );
}

// ── GUID to id, from the game's own project files ────────────────────────────

let vanillaCache: { game: string; ids: Map<string, string> } | undefined;

/** GUID -> ID of the game's own addons (`<game>/addons/<x>/<x>.gproj`); empty when the game is not available. */
function vanillaAddons(config: Config): Map<string, string> {
  if (!config.gamePath) return new Map();
  if (vanillaCache?.game === config.gamePath) return vanillaCache.ids;
  const ids = new Map<string, string>();
  try {
    const addons = join(config.gamePath, "addons");
    for (const d of readdirSync(addons, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of readdirSync(join(addons, d.name))) {
        if (!f.toLowerCase().endsWith(".gproj")) continue;
        try {
          const s = summarize(parseCstBytes(readFileSync(join(addons, d.name, f))));
          if (s.guid && s.id) ids.set(s.guid.toUpperCase(), s.id);
        } catch {
          // an unreadable vanilla file only costs the id label
        }
      }
    }
  } catch {
    // no addons folder
  }
  vanillaCache = { game: config.gamePath, ids };
  return ids;
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/** A one-hunk unified diff (2 lines of context) of the changed span; "" when the texts are equal. */
export function unifiedDiff(a: string, b: string, label: string): string {
  if (a === b) return "";
  const x = a.split("\n");
  const y = b.split("\n");
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const ctx = 2;
  const from = Math.max(0, p - ctx);
  const xEnd = Math.min(x.length, x.length - s + ctx);
  const yEnd = Math.min(y.length, y.length - s + ctx);
  const strip = (l: string) => l.replace(/\r$/, "");
  const lines: string[] = [];
  for (let i = from; i < p; i++) lines.push(` ${strip(x[i])}`);
  for (let i = p; i < x.length - s; i++) lines.push(`-${strip(x[i])}`);
  for (let i = p; i < y.length - s; i++) lines.push(`+${strip(y[i])}`);
  for (let i = x.length - s; i < xEnd; i++) lines.push(` ${strip(x[i])}`);
  return [
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -${from + 1},${xEnd - from} +${from + 1},${yEnd - from} @@`,
    ...lines,
  ].join("\n");
}

// ── The edits ────────────────────────────────────────────────────────────────

interface Planned {
  changed: Change[];
  warnings: string[];
  /** Throws when the re-read document does not show the edit. */
  check: (after: Summary) => void;
}

const sameGuid = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

function normGuid(raw: string | undefined, what: string): string {
  const m = raw === undefined ? null : /^\{?([0-9A-Fa-f]{16})\}?$/.exec(raw.trim());
  if (!m)
    return refuse("INVALID_ARGUMENT", `${what} needs guid: 16 hex digits, e.g. 58D0FB3206B6F859`);
  return m[1].toUpperCase();
}

function platformName(raw: string | undefined, what: string): string {
  if (raw === undefined || !PLATFORM.test(raw)) {
    return refuse(
      "INVALID_ARGUMENT",
      `${what} needs platform: upper-case name such as ${KNOWN_PLATFORMS.join(", ")}`,
    );
  }
  return raw;
}

function planSet(doc: CstDocument, args: ProjectSettingsArgs): Planned {
  const { key, value, quoted, platform } = args;
  if (key === undefined || !KEY.test(key)) {
    return refuse("INVALID_ARGUMENT", "set needs key: a plain setting name such as TITLE");
  }
  if (value === undefined) return refuse("INVALID_ARGUMENT", "set needs value");
  if (platform === undefined && PROTECTED_KEYS.has(key)) {
    return refuse(
      "INVALID_ARGUMENT",
      `${key} identifies the project and is not set here; renaming the id goes through refactor_rename_project_id.`,
    );
  }
  const b = projectBlock(doc);
  const warnings: string[] = [];
  let scope: string; // path of the block holding the key ("" = the project block)
  let label: string;
  let block: CstObject;
  if (platform !== undefined) {
    const p = platformBlocks(b).find((x) => x.name === platform);
    if (!p) {
      return refuse(
        "PATH_NOT_FOUND",
        `no platform ${platform} (has: ${platformBlocks(b)
          .map((x) => x.name)
          .join(", ")}); addPlatform first`,
      );
    }
    scope = `Configurations[${p.index}]`;
    label = `Configurations.${platform}.${key}`;
    block = p.block;
  } else {
    scope = "";
    label = key;
    block = b;
  }
  const existing = block.children.find(
    (c) => (c.kind === "scalar" || c.kind === "object") && c.key === key,
  );
  if (existing && existing.kind !== "scalar") {
    return refuse(
      "INVALID_ARGUMENT",
      `${key} is a block, not a setting${key === "Dependencies" ? "; use addDependency / removeDependency" : key === "Configurations" ? "; use addPlatform / removePlatform" : ""}`,
    );
  }
  const before = existing ? scalarText(existing) : null;
  const path = scope === "" ? key : `${scope}.${key}`;
  const wantQuoted = quoted ?? (typeof value === "string" ? true : undefined);
  if (existing) {
    doc.set(path, value, quoted === undefined ? {} : { quoted });
  } else {
    // New line: top-level ones go before Configurations (the vanilla order).
    let at: number | undefined;
    if (scope === "") {
      const i = b.children.findIndex((c) => c.kind === "object" && c.key === "Configurations");
      at = i >= 0 ? i : undefined;
    }
    doc.arrayAdd(scope, { key, value, quoted: wantQuoted }, at);
    warnings.push(`${label} is new: written as a fresh line.`);
  }
  const after = doc.get(path);
  const afterText = after.kind === "scalar" ? after.values.join(" ") : "";
  return {
    changed: [{ path: label, before, after: afterText }],
    warnings,
    check: (s) => {
      const got =
        platform === undefined ? s.settings[key] : s.platformSettings[platform]?.settings[key];
      if (got !== afterText)
        throw new Error(`re-read of ${label} gave ${String(got)}, wanted ${afterText}`);
    },
  };
}

function planAddDependency(doc: CstDocument, args: ProjectSettingsArgs, config: Config): Planned {
  const guid = normGuid(args.guid, "addDependency");
  const b = projectBlock(doc);
  const own = scalarOf(b, "GUID");
  if (own && sameGuid(own, guid)) {
    return refuse("INVALID_ARGUMENT", "a project cannot depend on itself (that is its own GUID)");
  }
  const before = dependenciesOf(b);
  if (before.some((d) => sameGuid(d, guid))) {
    return refuse("INVALID_ARGUMENT", `${guid} is already a dependency`);
  }
  if (objectsOf(b, "Dependencies").length > 0) {
    doc.arrayAdd("Dependencies", { value: guid, quoted: true });
  } else {
    // Vanilla order: after ID, GUID and TITLE.
    let at = 0;
    b.children.forEach((c, i) => {
      if (c.kind === "scalar" && ["ID", "GUID", "TITLE"].includes(c.key)) at = i + 1;
    });
    doc.createObject("", { key: "Dependencies", entries: [{ value: guid, quoted: true }] }, at);
  }
  const warnings: string[] = [];
  const known = vanillaAddons(config);
  if (known.size > 0 && !known.has(guid)) {
    warnings.push(
      `${guid} is not a game addon GUID; fine for a workshop mod, but nothing here checked that it exists.`,
    );
  }
  const id = known.get(guid);
  return {
    changed: [{ path: "Dependencies", before, after: [...before, guid] }],
    warnings: id ? [`${guid} is the game addon ${id}.`, ...warnings] : warnings,
    check: (s) => {
      if (!s.dependencies.some((d) => sameGuid(d, guid)))
        throw new Error("dependency not in the re-read file");
    },
  };
}

function planRemoveDependency(doc: CstDocument, args: ProjectSettingsArgs): Planned {
  const guid = normGuid(args.guid, "removeDependency");
  const b = projectBlock(doc);
  const block = objectsOf(b, "Dependencies")[0];
  const before = dependenciesOf(b);
  const idx = block
    ? block.children.findIndex((c) => {
        const v = depValue(c);
        return v !== undefined && sameGuid(v, guid);
      })
    : -1;
  if (idx < 0) {
    return refuse(
      "PATH_NOT_FOUND",
      `${guid} is not a dependency (has: ${before.length ? before.join(", ") : "none"})`,
    );
  }
  doc.arrayRemove("Dependencies", idx);
  const warnings: string[] = [];
  const left = dependenciesOf(projectBlock(doc));
  if (left.length === 0) {
    doc.delete("Dependencies");
    warnings.push("That was the last dependency: the empty Dependencies block is removed too.");
  }
  return {
    changed: [{ path: "Dependencies", before, after: before.filter((d) => !sameGuid(d, guid)) }],
    warnings,
    check: (s) => {
      if (s.dependencies.some((d) => sameGuid(d, guid)))
        throw new Error("dependency still in the re-read file");
    },
  };
}

function planAddPlatform(doc: CstDocument, args: ProjectSettingsArgs): Planned {
  const name = platformName(args.platform, "addPlatform");
  const b = projectBlock(doc);
  const before = platformBlocks(b).map((p) => p.name);
  if (before.includes(name)) return refuse("INVALID_ARGUMENT", `platform ${name} already exists`);
  const warnings: string[] = [];
  if (!(KNOWN_PLATFORMS as readonly string[]).includes(name)) {
    warnings.push(
      `${name} is not a platform the vanilla project files carry (${KNOWN_PLATFORMS.join(", ")}).`,
    );
  }
  if (objectsOf(b, "Configurations").length > 0) {
    doc.createObject("Configurations", { key: "GameProjectConfig", name });
  } else {
    doc.createObject("", {
      key: "Configurations",
      entries: [{ object: { key: "GameProjectConfig", name } }],
    });
  }
  return {
    changed: [{ path: "Configurations", before, after: [...before, name] }],
    warnings,
    check: (s) => {
      if (!s.platforms.includes(name)) throw new Error("platform not in the re-read file");
    },
  };
}

function planRemovePlatform(doc: CstDocument, args: ProjectSettingsArgs): Planned {
  const name = platformName(args.platform, "removePlatform");
  const b = projectBlock(doc);
  const all = platformBlocks(b);
  const p = all.find((x) => x.name === name);
  if (!p) {
    return refuse(
      "PATH_NOT_FOUND",
      `no platform ${name} (has: ${all.map((x) => x.name).join(", ") || "none"})`,
    );
  }
  const warnings: string[] = [];
  if (p.block.children.length > 0) {
    const text = doc.text.slice(p.block.start, p.block.end);
    if (!args.discard) {
      return refuse(
        "INVALID_ARGUMENT",
        `platform ${name} holds ${p.block.children.length} entr${p.block.children.length === 1 ? "y" : "ies"} (${text.split(/\r?\n/).length} lines); pass discard: true to drop them. The dry run shows the lines.`,
      );
    }
    warnings.push(
      `${name} held settings that are dropped; addPlatform brings back an empty block only, so keep the diff to restore them.`,
    );
  }
  doc.arrayRemove("Configurations", p.index);
  return {
    changed: [
      {
        path: "Configurations",
        before: all.map((x) => x.name),
        after: all.filter((x) => x.name !== name).map((x) => x.name),
      },
    ],
    warnings,
    check: (s) => {
      if (s.platforms.includes(name)) throw new Error("platform still in the re-read file");
    },
  };
}

function scalarOf(b: CstObject, key: string): string | undefined {
  const c = b.children.find((x) => x.kind === "scalar" && x.key === key);
  return c && c.kind === "scalar" ? scalarText(c) : undefined;
}

// ── The action ───────────────────────────────────────────────────────────────

const fail = (action: string, target: string, e: Refusal): ActionResponse =>
  errorResponse(action, target, e.code, e.message);

/** Runs one action. Pure over the files: no Workbench, no network, no child process. */
export function runProjectSettings(args: ProjectSettingsArgs, config: Config): ActionResponse {
  const action = args.action;
  let target = args.path !== undefined ? `path:${args.path}` : "path:";
  try {
    const root = pinnedProjectRoot(args.projectPath, config.projectPath);
    const loc = locate(args, root, config);
    target = `path:${loc.rel}`;
    const doc = parseStrict(loc.bytes, loc.rel);

    if (action === "read") {
      const s = summarize(doc);
      const known = vanillaAddons(config);
      return {
        ok: true,
        action,
        target,
        changed: null,
        readback: {
          source: loc.source,
          file: loc.file ?? loc.rel,
          id: s.id,
          guid: s.guid,
          title: s.title,
          dependencies: s.dependencies.map((g) => ({ guid: g, id: known.get(g.toUpperCase()) })),
          platforms: s.platforms,
          settings: s.settings,
          platformSettings: s.platformSettings,
        },
        next: "set / addDependency / removeDependency / addPlatform / removePlatform edit this file (dry run unless confirm: true).",
        warnings: loc.source === "game" ? ["Game project file: read only."] : [],
      };
    }

    if (!loc.file || loc.source !== "project") {
      return refuse("NOT_IN_PROJECT", "writes go to a project file under the project root only");
    }
    if (!(PROJECT_SETTINGS_ACTIONS as readonly string[]).includes(action)) {
      return refuse("INVALID_ARGUMENT", `unknown action ${String(action)}`);
    }
    let plan: Planned;
    try {
      plan =
        action === "set"
          ? planSet(doc, args)
          : action === "addDependency"
            ? planAddDependency(doc, args, config)
            : action === "removeDependency"
              ? planRemoveDependency(doc, args)
              : action === "addPlatform"
                ? planAddPlatform(doc, args)
                : planRemovePlatform(doc, args);
    } catch (e) {
      if (e instanceof CstEditError) {
        return refuse(
          e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
          e.message,
        );
      }
      throw e;
    }

    const out = doc.toBytes();
    // The edited text must parse clean and show the edit.
    const reread = parseStrict(out, loc.rel);
    try {
      plan.check(summarize(reread));
    } catch (e) {
      return refuse(
        "INVALID_ARGUMENT",
        `edit not applied, nothing written: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const diff = unifiedDiff(loc.bytes.toString("utf8"), out.toString("utf8"), loc.rel);
    const base = { ok: true as const, action, target, changed: plan.changed };

    if (args.confirm !== true) {
      return {
        ...base,
        readback: { dryRun: true, written: false, diff },
        next: "Repeat the same call with confirm: true to write exactly this change.",
        warnings: plan.warnings,
      };
    }
    writeFileAtomic(loc.file, out);
    const back = readFileSync(loc.file);
    if (!back.equals(out)) {
      return refuse(
        "SAVE_FAILED",
        `${loc.rel}: the file on disk differs from what was written; read it back.`,
      );
    }
    return {
      ...base,
      readback: {
        dryRun: false,
        written: true,
        diff,
        summary: summarize(parseStrict(back, loc.rel)),
      },
      next: "A Workbench with this project open keeps its own copy: restart or reload the project there, and do not save the old copy over this file. The inverse is the same action with the before value.",
      warnings: plan.warnings,
    };
  } catch (e) {
    if (e instanceof Refusal) return fail(action, target, e);
    if (e instanceof VocabularyError) return errorResponse(action, target, e.code, e.message);
    return errorResponse(
      action,
      target,
      "HANDLER_ERROR",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerProjectSettings(server: McpServer, config: Config): void {
  server.registerTool(
    "project_settings",
    {
      description:
        "Read and edit the project .gproj as a file. Actions: read; set (key, value, optional platform); addDependency / removeDependency (guid); addPlatform / removePlatform (platform). " +
        "Edits only an existing .gproj under the project; a dry run showing the diff unless confirm: true; ID and GUID are not settable. Reads also take a game addon .gproj.",
      inputSchema: {
        action: z.enum(PROJECT_SETTINGS_ACTIONS),
        path: z
          .string()
          .optional()
          .describe("Project-relative .gproj; omitted: the one in the project root."),
        key: z.string().optional().describe("set: setting name, e.g. TITLE."),
        value: z
          .union([z.string(), z.number(), z.boolean()])
          .optional()
          .describe("set: new value."),
        quoted: z.boolean().optional().describe("set: force quoting on or off."),
        platform: z
          .string()
          .optional()
          .describe(
            "set: edit in this platform's block. addPlatform/removePlatform: the name (PC, XBOX_ONE, ...).",
          ),
        guid: z.string().optional().describe("addDependency/removeDependency: 16-hex GUID."),
        discard: z
          .boolean()
          .optional()
          .describe("removePlatform: drop a block that holds settings."),
        confirm: z
          .boolean()
          .optional()
          .describe("Write the change; without it nothing is written."),
        projectPath: z
          .string()
          .optional()
          .describe("Project root. Uses the configured project when omitted."),
      },
    },
    async (args) => {
      const r = runProjectSettings(args as ProjectSettingsArgs, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
