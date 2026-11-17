/**
 * wb_settings: the Workbench settings store (phase5-w8-spec.md section 2.2 and rule 1.2.6;
 * DEC-076, OI-W8-3; plan Appendix C). TypeScript only: no handler, no NET call.
 *
 * Reads
 *   stores     a fresh read-only `reg export` of the Workbench key into the artifacts folder, and
 *              the scratch inis this tool made
 *   list       the keys of a store (registry or a scratch ini), paged (cursor `<start>:<count>`)
 *   get        one key of a store
 *   diff       two stores: added, removed, changed
 *   shortcuts  GATED until P-W8-06 (the shortcut store and its format are unproven)
 *   options    GATED until P-W8-05 (the Options field to key map is unproven)
 * Writes (scratch inis only; a dry run unless `confirm: true`; WB_RUNNING while a Workbench
 * process is listed, because Workbench writes its settings back at exit)
 *   profile    a scrubbed copy of the registry (src/settings/scratch-profile.ts) as a NEW ini
 *   set, unset one key of a scratch ini this tool made, written as a NEW ini (never overwrites);
 *              any other file is NOT_SCRATCH
 *
 * The registry is never written: there is no registry write path (DEC-076 OI-W8-3). A scratch ini
 * reaches Workbench only through `wb_launch forceSettings`.
 *
 * Personal data: a registry value the profile scrub would drop is never shown by a read. When its
 * key path or name is itself personal (recent lists, world paths, file ids, user layouts) the key
 * is hidden and only counted; otherwise the key is listed with its value withheld.
 *
 * Responses follow design section 4: `{ ok, action, target, changed, readback, next?, warnings }`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defaultArtifactsDir } from "../census/source-index.js";
import {
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  nextCursor,
  parseCursor,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import {
  RECORD_KIND,
  RECORD_SUFFIX,
  iniEntries,
  insideGitWorkTree,
  isPathLike,
  newFileRefusal,
  notScratchReason,
  parseIni,
  recordText,
  resolveScratchPath,
  scratchDir,
  scratchFileName,
  setValues,
  sha256,
  unsetValue,
  workbenchRunningRefusal,
  type SetChange,
} from "../settings/ini-edit.js";
import {
  REGISTRY_KEY,
  defaultExec,
  exportRegistry,
  listExports,
  personalContextFromEnv,
  personalReason,
  readExport,
  gateScan,
  type ExecFn,
  type PersonalContext,
} from "../settings/reg-export.js";
import {
  ScrubRefusal,
  classifyValue,
  holdsKnownPath,
  iniEscapedKey,
  iniEscapedString,
  iniKeyOf,
  iniSection,
  scratchIniFromExport,
  scratchInvariantProblem,
  textReason,
} from "../settings/scratch-profile.js";

export const WB_SETTINGS_TOOL = "wb_settings";

export const READ_ACTIONS = ["stores", "list", "get", "diff", "shortcuts", "options"] as const;
export const WRITE_ACTIONS = ["profile", "set", "unset"] as const;
export const ACTIONS = [...READ_ACTIONS, ...WRITE_ACTIONS] as const;
export type SettingsAction = (typeof ACTIONS)[number];

export const WB_SETTINGS_DESCRIPTION =
  "Workbench settings store. Read: stores, list, get, diff, shortcuts, options (the registry key, read-only; scratch ini files). Write only to a scratch ini this tool made: profile (a scrubbed copy of the registry), set, unset (dry run unless confirm; refused while Workbench runs). Launch with it through wb_launch forceSettings. The registry is never written.";

/**
 * The switches behind the actions the rulings gate. Both are closed: the integrator opens one only
 * after the probe it names has passed.
 *   shortcuts  P-W8-06: the shortcut store and its format (U36, U38). Today the export holds the
 *              string `true` per row, not a key sequence.
 *   options    P-W8-05: the Options field to settings key map (U38).
 */
export const SETTINGS_GATES = { shortcuts: false, options: false };

const GATE_PROBES: Readonly<Record<keyof typeof SETTINGS_GATES, string>> = {
  shortcuts: "P-W8-06",
  options: "P-W8-05",
};

/** WB_RUNNING and NOT_SCRATCH (spec rule 1.2.10) are in src/manifest/vocabulary.ts. */
export type SettingsCode = ErrorCode;

export interface SettingsError {
  ok: false;
  action: string;
  target: string;
  code: SettingsCode;
  message: string;
  next: string;
  warnings: string[];
}
export type SettingsResponse = (ActionOk & { dryRun?: boolean }) | SettingsError;

class SettingsFail extends Error {
  constructor(
    readonly code: SettingsCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
  }
}

function nextOf(code: SettingsCode): string {
  return ERROR_CODES[code];
}

function fail(
  action: string,
  target: string,
  code: SettingsCode,
  message: string,
  next: string = nextOf(code),
): SettingsError {
  return { ok: false, action, target, code, message, next, warnings: [] };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface SettingsDeps {
  artifactsDir?: () => string;
  exec?: ExecFn;
  platform?: NodeJS.Platform;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  /** Absolute paths a scratch ini must never name (the configured project, tools, game). */
  knownPaths?: () => string[];
}

interface Ctx {
  root: string;
  exec: ExecFn;
  platform: NodeJS.Platform;
  now: () => Date;
  personal: PersonalContext;
  knownPaths: string[];
}

function contextOf(deps: SettingsDeps): Ctx {
  const env = deps.env ?? process.env;
  const known = [
    env.USERPROFILE,
    env.LOCALAPPDATA,
    env.APPDATA,
    env.HOME,
    ...(deps.knownPaths?.() ?? []),
  ].filter((p): p is string => typeof p === "string" && p.length >= 3);
  return {
    root: (deps.artifactsDir ?? (() => defaultArtifactsDir(env)))(),
    exec: deps.exec ?? defaultExec,
    platform: deps.platform ?? process.platform,
    now: deps.now ?? (() => new Date()),
    personal: personalContextFromEnv(env),
    knownPaths: known,
  };
}

/** A path inside the artifacts folder as `<artifacts>/...` (never a home path). */
function artifactsRel(abs: string, root: string): string {
  return `<artifacts>/${relative(root, abs).split(/[\\/]/).join("/")}`;
}

// ── Stores ───────────────────────────────────────────────────────────────────

interface Entry {
  section: string;
  key: string;
  type: string;
  /** Null when withheld. */
  value: string | null;
  withheld?: string;
  /** sha256 of the stored value (withheld values compare without being shown). */
  hash: string;
}

interface Store {
  target: string;
  label: string;
  entries: Entry[];
  /** Keys hidden because their path or name is personal, by reason. */
  hidden: Record<string, number>;
  warnings: string[];
}

/** Reasons whose key path or name is personal: the whole key is hidden, not only its value. */
function hidesKey(reason: string): boolean {
  return !(
    reason.startsWith("type:") ||
    reason.startsWith("personal-value:") ||
    reason === "personal-name:identity-name"
  );
}

function registryStore(ctx: Ctx, fresh: boolean): Store {
  const warnings: string[] = [];
  let file = fresh ? undefined : listExports(ctx.root)[0];
  if (!file) file = exportRegistry({ artifactsRoot: ctx.root, ...ctx });
  else warnings.push(`read from the newest export ${basename(file)}; stores takes a fresh one`);
  const reg = readExport(file);
  const entries: Entry[] = [];
  const hidden: Record<string, number> = {};
  for (const k of reg.keys) {
    for (const v of k.values) {
      const c = classifyValue(k.segments, v, ctx.personal);
      const raw = v.text ?? v.bytes?.toString("hex") ?? "";
      if (!c.keep && hidesKey(c.reason)) {
        hidden[c.reason] = (hidden[c.reason] ?? 0) + 1;
        continue;
      }
      const e: Entry = {
        section: iniSection(k.segments),
        key: iniKeyOf(k.segments, v.name),
        type: v.type,
        value: c.keep ? c.text : null,
        // A kept value hashes as a scratch ini stores it, so a diff with a profile compares alike.
        hash: c.keep ? sha256(iniEscapedString(c.text)) : sha256(`${v.type}\u0000${raw}`),
      };
      if (!c.keep) e.withheld = c.reason;
      entries.push(e);
    }
  }
  return {
    target: "registry",
    label: artifactsRel(file, ctx.root),
    entries,
    hidden,
    warnings,
  };
}

function scratchStore(arg: string, ctx: Ctx): Store {
  const abs = resolveScratchPath(arg, ctx.root);
  if (abs === null)
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      `store '${arg}' is neither registry nor a scratch ini name in the wb_settings scratch folder`,
    );
  if (!existsSync(abs))
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      `no scratch ini ${basename(abs)}; stores lists them`,
    );
  const entries: Entry[] = [];
  const hidden: Record<string, number> = {};
  for (const e of iniEntries(readFileSync(abs, "utf-8"))) {
    const nameReason = personalReason(`${e.section}\\${e.key}`, ctx.personal);
    if (nameReason) {
      const r = `personal-key:${nameReason}`;
      hidden[r] = (hidden[r] ?? 0) + 1;
      continue;
    }
    const why = textReason(e.value, ctx.personal) ?? (isPathLike(e.value) ? "path-like" : null);
    const entry: Entry = {
      section: e.section,
      key: e.key,
      type: "ini",
      value: why ? null : e.value,
      hash: sha256(e.value),
    };
    if (why) entry.withheld = `personal-value:${why}`;
    entries.push(entry);
  }
  const warnings: string[] = [];
  const nsr = notScratchReason(abs, ctx.root);
  if (nsr) warnings.push(`not editable by set or unset: ${nsr}`);
  return {
    target: `scratch:${basename(abs)}`,
    label: artifactsRel(abs, ctx.root),
    entries,
    hidden,
    warnings,
  };
}

function loadStore(arg: string | undefined, ctx: Ctx): Store {
  return arg === undefined || arg === "registry"
    ? registryStore(ctx, false)
    : scratchStore(arg, ctx);
}

/** True when `given` names `stored`: as stored (escaped) or in its plain form. */
function sectionMatches(stored: string, given: string): boolean {
  return stored === given || stored === iniEscapedKey(given);
}
function keyMatches(stored: string, given: string): boolean {
  return stored === given || stored === given.split(/[\\/]/).map(iniEscapedKey).join("\\");
}

function publicEntry(e: Entry): Record<string, unknown> {
  const o: Record<string, unknown> = {
    section: e.section,
    key: e.key,
    type: e.type,
    value: e.value,
  };
  if (e.withheld) o.withheld = e.withheld;
  return o;
}

// ── Read actions ─────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function need(args: Raw, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || v === "")
    throw new SettingsFail("INVALID_ARGUMENT", `${name} is required`);
  return v;
}

function ok(
  action: string,
  target: string,
  readback: unknown,
  warnings: string[],
  extra: { changed?: Change[] | null; next?: string; dryRun?: boolean } = {},
): ActionOk & { dryRun?: boolean } {
  const r: ActionOk & { dryRun?: boolean } = {
    ok: true,
    action,
    target,
    changed: extra.changed ?? null,
    readback,
    warnings,
  };
  if (extra.next) r.next = extra.next;
  if (extra.dryRun !== undefined) r.dryRun = extra.dryRun;
  return r;
}

function scratchFiles(ctx: Ctx): Array<Record<string, unknown>> {
  const dir = scratchDir(ctx.root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".ini"))
    .sort()
    .map((f) => {
      const abs = join(dir, f);
      const why = notScratchReason(abs, ctx.root);
      let from: unknown = null;
      try {
        from =
          (JSON.parse(readFileSync(abs + RECORD_SUFFIX, "utf-8")) as { from?: unknown }).from ??
          null;
      } catch {
        from = null;
      }
      return { name: f, editable: why === null, ...(why ? { reason: why } : {}), from };
    });
}

function storesAction(ctx: Ctx): SettingsResponse {
  const warnings: string[] = [];
  let exportPath: string | null = null;
  if (ctx.platform === "win32") {
    exportPath = artifactsRel(exportRegistry({ artifactsRoot: ctx.root, ...ctx }), ctx.root);
  } else {
    warnings.push("the Workbench registry key exists only on Windows; no export taken");
  }
  return ok(
    "stores",
    "registry",
    {
      registryKey: REGISTRY_KEY,
      exportPath,
      exports: listExports(ctx.root).length,
      scratchFolder: artifactsRel(scratchDir(ctx.root), ctx.root),
      scratchFiles: scratchFiles(ctx),
    },
    warnings,
    {
      next: "Read with list, get or diff (store: registry or a scratch name); make a scratch ini with profile.",
    },
  );
}

function pageOf<T>(items: T[], args: Raw): { page: T[]; total: number; nextCursor?: string } {
  const limit = Math.min(typeof args.limit === "number" ? args.limit : LIMIT_DEFAULT, LIMIT_MAX);
  const raw = str(args.cursor);
  const cur = raw === undefined ? { start: 0, count: items.length } : parseCursor(raw);
  if (raw !== undefined) checkCursor(cur, items.length);
  return {
    page: items.slice(cur.start, cur.start + limit),
    total: items.length,
    nextCursor: nextCursor(cur.start, limit, items.length),
  };
}

function listAction(args: Raw, ctx: Ctx): SettingsResponse {
  const store = loadStore(str(args.store), ctx);
  const section = str(args.section);
  const pool =
    section === undefined
      ? store.entries
      : store.entries.filter((e) => sectionMatches(e.section, section));
  const p = pageOf(pool, args);
  return ok(
    "list",
    store.target,
    {
      store: store.label,
      section: section ?? null,
      total: p.total,
      keys: p.page.map(publicEntry),
      nextCursor: p.nextCursor ?? null,
      hidden: store.hidden,
    },
    store.warnings,
  );
}

function getAction(args: Raw, ctx: Ctx): SettingsResponse {
  const section = need(args, "section");
  const key = need(args, "key");
  const store = loadStore(str(args.store), ctx);
  const hits = store.entries.filter(
    (e) => sectionMatches(e.section, section) && keyMatches(e.key, key),
  );
  if (hits.length === 0)
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      `no key [${section}] ${key} in ${store.target} (or it is hidden as personal); list the section`,
    );
  if (hits.length > 1)
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      `[${section}] ${key} appears ${hits.length} times in ${store.target}`,
    );
  const e = hits[0];
  return ok("get", store.target, { store: store.label, ...publicEntry(e) }, store.warnings);
}

function diffAction(args: Raw, ctx: Ctx): SettingsResponse {
  const a = loadStore(need(args, "a"), ctx);
  const b = loadStore(need(args, "b"), ctx);
  const id = (e: Entry): string => `${e.section}\u0000${e.key}`;
  const am = new Map(a.entries.map((e) => [id(e), e]));
  const bm = new Map(b.entries.map((e) => [id(e), e]));
  const added = b.entries.filter((e) => !am.has(id(e)));
  const removed = a.entries.filter((e) => !bm.has(id(e)));
  const changed = a.entries
    .filter((e) => bm.has(id(e)) && bm.get(id(e))!.hash !== e.hash)
    .map((e) => {
      const after = bm.get(id(e))!;
      return { section: e.section, key: e.key, before: e.value, after: after.value };
    });
  const limit = Math.min(typeof args.limit === "number" ? args.limit : LIMIT_DEFAULT, LIMIT_MAX);
  const warnings = [...a.warnings, ...b.warnings];
  if (Math.max(added.length, removed.length, changed.length) > limit)
    warnings.push(`each list is cut at ${limit}; the counts are whole`);
  return ok(
    "diff",
    `${a.target}..${b.target}`,
    {
      a: a.label,
      b: b.label,
      counts: { added: added.length, removed: removed.length, changed: changed.length },
      added: added.slice(0, limit).map(publicEntry),
      removed: removed.slice(0, limit).map(publicEntry),
      changed: changed.slice(0, limit),
      hidden: { a: a.hidden, b: b.hidden },
    },
    warnings,
  );
}

function gated(action: keyof typeof SETTINGS_GATES): SettingsError | null {
  if (SETTINGS_GATES[action]) return null;
  const probe = GATE_PROBES[action];
  return fail(
    action,
    "registry",
    "GATED",
    `${action} waits for probe ${probe}; nothing was read`,
    `Run ${probe}; on a pass the integrator opens SETTINGS_GATES.${action} in src/tools/wb-settings.ts.`,
  );
}

function shortcutsAction(args: Raw, ctx: Ctx): SettingsResponse {
  const g = gated("shortcuts");
  if (g) return g;
  // Behind the switch: the shortcut table of the export (E06), one row per stored name.
  const store = registryStore(ctx, false);
  const rows = store.entries
    .filter((e) => e.section === "Workbench" && /^PropertyGrid\\unnamed\\/.test(e.key))
    .map((e) => ({ action: e.key.slice("PropertyGrid\\unnamed\\".length), chord: e.value }));
  const p = pageOf(rows, args);
  return ok(
    "shortcuts",
    "registry",
    { store: store.label, total: p.total, rows: p.page, nextCursor: p.nextCursor ?? null },
    store.warnings,
  );
}

function optionsAction(): SettingsResponse {
  const g = gated("options");
  if (g) return g;
  return fail(
    "options",
    "registry",
    "UNPROVEN",
    "no Options field map is recorded on this build (P-W8-05)",
    "The integrator records P-W8-05's field map before options answers.",
  );
}

// ── Write actions ────────────────────────────────────────────────────────────

function runningRefusal(action: string, target: string, ctx: Ctx): SettingsError | null {
  const why = workbenchRunningRefusal(ctx.platform, ctx.exec);
  return why ? fail(action, target, "WB_RUNNING", why) : null;
}

/** Write a new scratch ini and its record (both created, never overwritten), then read back. */
function writeScratch(abs: string, text: string, from: string, ctx: Ctx): void {
  mkdirSync(dirname(abs), { recursive: true });
  const refusal = newFileRefusal(abs, ctx.root);
  if (refusal) throw new SettingsFail("INVALID_ARGUMENT", refusal);
  writeFileSync(abs, text, { encoding: "utf-8", flag: "wx" });
  writeFileSync(
    abs + RECORD_SUFFIX,
    recordText({
      kind: RECORD_KIND,
      file: basename(abs),
      sha256: sha256(text),
      created: ctx.now().toISOString(),
      from,
    }),
    { encoding: "utf-8", flag: "wx" },
  );
  if (sha256(readFileSync(abs)) !== sha256(text))
    throw new SettingsFail(
      "SAVE_FAILED",
      `${basename(abs)} read back differs from what was written`,
    );
}

function profileAction(args: Raw, ctx: Ctx): SettingsResponse {
  const name = need(args, "name");
  const file = scratchFileName(name);
  if (file === null)
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      `name '${name}' must be 1 to 64 letters, digits, '_', '-' or '.', not starting with '.'`,
    );
  const target = `scratch:${file}`;
  if (insideGitWorkTree(ctx.root))
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      "the artifacts folder lies inside a git working tree",
    );
  const abs = join(scratchDir(ctx.root), file);
  const refusal = newFileRefusal(abs, ctx.root);
  if (refusal) throw new SettingsFail("INVALID_ARGUMENT", refusal);
  const running = runningRefusal("profile", target, ctx);
  if (running) return running;
  const exportFile = exportRegistry({ artifactsRoot: ctx.root, ...ctx });
  let built: ReturnType<typeof scratchIniFromExport>;
  try {
    built = scratchIniFromExport(readExport(exportFile), ctx.personal, ctx.knownPaths);
  } catch (e) {
    if (e instanceof ScrubRefusal)
      throw new SettingsFail(
        "PRECONDITION_UNMET",
        e.message,
        "Nothing was written; the registry is the owner's to change.",
      );
    throw e;
  }
  const summary = {
    path: artifactsRel(abs, ctx.root),
    scrubbed: { kept: built.kept, dropped: built.dropped, sections: built.sections.length },
    netApi: Object.keys(built.netApi).sort(),
    debugLine: built.debugLine,
    sha256: sha256(built.text),
    from: artifactsRel(exportFile, ctx.root),
  };
  const changed: Change[] = [{ path: summary.path, before: null, after: `${built.kept} values` }];
  if (args.confirm !== true)
    return ok("profile", target, summary, [], {
      changed,
      dryRun: true,
      next: "Run again with confirm: true to write exactly this file.",
    });
  writeScratch(abs, built.text, "profile", ctx);
  return ok("profile", target, { ...summary, forceSettings: abs }, [], {
    changed,
    dryRun: false,
    next: "Launch with it: wb_launch forceSettings set to forceSettings.",
  });
}

/** The next free derived name: `<stem>-<n>.ini` with n from 2. */
function derivedName(source: string, ctx: Ctx): string {
  const stem = source.replace(/\.ini$/i, "").replace(/-\d+$/, "");
  const dir = scratchDir(ctx.root);
  for (let n = 2; ; n++) {
    const f = `${stem}-${n}.ini`;
    if (scratchFileName(f) !== f)
      throw new SettingsFail("INVALID_ARGUMENT", `no free name after ${source}; pass name`);
    if (!existsSync(join(dir, f)) && !existsSync(join(dir, f + RECORD_SUFFIX))) return f;
  }
}

/** The section and key as the file holds them, or (absent) the escaped form a new line takes. */
function locate(text: string, section: string, key: string): { section: string; key: string } {
  const lines = parseIni(text).lines;
  const sec =
    lines.find((l) => l.key === null && l.section === section)?.section ??
    lines.find((l) => l.key === null && l.section !== null && sectionMatches(l.section, section))
      ?.section ??
    (/^[A-Za-z0-9_.%-]+$/.test(section) ? section : iniEscapedKey(section));
  const k =
    lines.find((l) => l.section === sec && l.key === key)?.key ??
    lines.find((l) => l.section === sec && l.key !== null && keyMatches(l.key, key))?.key ??
    (/^[A-Za-z0-9_.%\\-]+$/.test(key) ? key : key.split(/[\\/]/).map(iniEscapedKey).join("\\"));
  return { section: sec, key: k };
}

function shownValue(line: string | null, ctx: Ctx): string | null {
  if (line === null) return null;
  const v = line.slice(line.indexOf("=") + 1);
  return textReason(v, ctx.personal) || isPathLike(v) ? "(withheld)" : v;
}

function editAction(action: "set" | "unset", args: Raw, ctx: Ctx): SettingsResponse {
  const pathArg = need(args, "path");
  const section = need(args, "section");
  const key = need(args, "key");
  const src = resolveScratchPath(pathArg, ctx.root);
  if (src === null)
    return fail(
      action,
      `path:${pathArg}`,
      "NOT_SCRATCH",
      "the path is not in the wb_settings scratch folder",
    );
  const target = `scratch:${basename(src)}`;
  const nsr = notScratchReason(src, ctx.root);
  if (nsr) return fail(action, target, "NOT_SCRATCH", nsr);
  const running = runningRefusal(action, target, ctx);
  if (running) return running;

  const input = readFileSync(src, "utf-8");
  const loc = locate(input, section, key);
  let text: string;
  let change: SetChange;
  try {
    if (action === "set") {
      const value = args.value;
      if (typeof value !== "string")
        throw new SettingsFail("INVALID_ARGUMENT", "value is required (a string)");
      const personal =
        gateScan(value, ctx.personal).length > 0 || personalReason(value, ctx.personal) !== null;
      if (personal || holdsKnownPath(value, ctx.knownPaths))
        throw new SettingsFail(
          "INVALID_ARGUMENT",
          "the value holds a path or personal data; a scratch ini stays scrubbed",
        );
      const r = setValues(input, [{ ...loc, value: iniEscapedString(value), create: true }]);
      text = r.text;
      change = r.changes[0];
    } else {
      const r = unsetValue(input, loc);
      text = r.text;
      change = r.change;
    }
  } catch (e) {
    if (e instanceof SettingsFail) throw e;
    throw new SettingsFail("INVALID_ARGUMENT", e instanceof Error ? e.message : String(e));
  }
  const problem = scratchInvariantProblem(text);
  if (problem) throw new SettingsFail("INVALID_ARGUMENT", `the edit is refused: ${problem}`);

  const outName =
    str(args.name) === undefined
      ? derivedName(basename(src), ctx)
      : scratchFileName(str(args.name)!);
  if (outName === null)
    throw new SettingsFail(
      "INVALID_ARGUMENT",
      `name '${String(args.name)}' is not an acceptable scratch name`,
    );
  const out = join(scratchDir(ctx.root), outName);
  const refusal = newFileRefusal(out, ctx.root);
  if (refusal) throw new SettingsFail("INVALID_ARGUMENT", refusal);

  const previous = shownValue(change.before, ctx);
  const after = shownValue(change.after, ctx);
  const changed: Change[] = [{ path: `[${loc.section}] ${loc.key}`, before: previous, after }];
  const base = {
    from: artifactsRel(src, ctx.root),
    path: artifactsRel(out, ctx.root),
    section: loc.section,
    key: loc.key,
    previous,
    created: change.created,
  };
  const warnings = [
    "a scratch ini is never overwritten: the edit goes to a new file, the source stays as it was",
  ];
  if (args.confirm !== true)
    return ok(action, target, { ...base, after }, warnings, {
      changed,
      dryRun: true,
      next: "Run again with confirm: true to write exactly this change.",
    });
  writeScratch(out, text, basename(src), ctx);
  const back = iniEntries(readFileSync(out, "utf-8")).filter(
    (e) => e.section === loc.section && e.key === loc.key,
  );
  const readback = back.length === 0 ? null : shownValue(`${loc.key}=${back[0].value}`, ctx);
  return ok(action, `scratch:${outName}`, { ...base, readback, forceSettings: out }, warnings, {
    changed,
    dryRun: false,
    next: "Launch with it: wb_launch forceSettings set to forceSettings.",
  });
}

// ── Entry ────────────────────────────────────────────────────────────────────

/** Runs one request; every refusal is a response, never a throw. */
export function runSettings(args: Raw, deps: SettingsDeps = {}): SettingsResponse {
  const action = str(args.action) ?? "";
  if (!(ACTIONS as readonly string[]).includes(action))
    return fail(action, "settings", "INVALID_ARGUMENT", `unknown action '${action}'`);
  try {
    const ctx = contextOf(deps);
    switch (action as SettingsAction) {
      case "stores":
        return storesAction(ctx);
      case "list":
        return listAction(args, ctx);
      case "get":
        return getAction(args, ctx);
      case "diff":
        return diffAction(args, ctx);
      case "shortcuts":
        return shortcutsAction(args, ctx);
      case "options":
        return optionsAction();
      case "profile":
        return profileAction(args, ctx);
      case "set":
      case "unset":
        return editAction(action as "set" | "unset", args, ctx);
    }
  } catch (e) {
    const target = str(args.store) ?? str(args.path) ?? str(args.name) ?? "settings";
    if (e instanceof SettingsFail)
      return fail(action, target, e.code, e.message, e.next ?? nextOf(e.code));
    if (e instanceof VocabularyError) return fail(action, target, e.code, e.message);
    return fail(
      action,
      target,
      "HANDLER_ERROR",
      e instanceof Error ? e.message : String(e),
      "Nothing was written; read the message (a failed reg export or file read).",
    );
  }
  return fail(action, "settings", "INVALID_ARGUMENT", `unknown action '${action}'`);
}

// ── Registration ─────────────────────────────────────────────────────────────

export const WB_SETTINGS_INPUT = {
  action: z.enum(ACTIONS),
  store: z.string().optional().describe("list/get: registry (default) or a scratch ini"),
  a: z.string().optional().describe("diff"),
  b: z.string().optional().describe("diff"),
  section: z.string().optional().describe("ini section, e.g. World%20Editor"),
  key: z.string().optional().describe("ini key"),
  value: z.string().optional().describe("set"),
  path: z.string().optional().describe("set/unset: the scratch ini"),
  name: z.string().optional().describe("new scratch ini name (set/unset: default <name>-<n>)"),
  page: z.string().optional().describe("options"),
  cursor: z.string().optional().describe("nextCursor"),
  limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("Items per page."),
  confirm: z.boolean().optional().describe("write; else a dry run"),
};

export const WB_SETTINGS_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

export function registerWbSettings(server: McpServer, deps: SettingsDeps = {}): void {
  server.registerTool(
    "wb_settings",
    {
      description: WB_SETTINGS_DESCRIPTION,
      inputSchema: WB_SETTINGS_INPUT,
      annotations: WB_SETTINGS_ANNOTATIONS,
    },
    async (args: Raw) => {
      const res = runSettings(args, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
