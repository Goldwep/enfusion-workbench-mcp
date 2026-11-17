/**
 * Scratch-ini edits for session S-F (blocker B6; U36 and U22), on an ini the scratch builder made
 * (the scrub of a pre-flight registry export, DEC-038) or on a launch's written-back copy of it.
 * The registry is never read or written here; only files inside the artifacts folder are.
 *
 *   drop-section --prefix <p>   drop every key line whose key starts with <p>, in any section
 *                               (sf-p1: `PropertyGrid\unnamed\`, the shortcut rows, so U36 can see
 *                               whether Workbench writes them back on its own)
 *   set --section <s> --key <k> --value <v> [--create]   (repeatable as a group, in order)
 *                               replace exactly one existing key line; a key or section that is not
 *                               there is an error unless --create (sf-p4: LSP_Enabled and LSP_Port,
 *                               which may be absent). NetAPI_* keys are refused: the harness talks
 *                               to Workbench through them
 *   set ... --token <name> --old <v>   (in a set group, instead of --create) rewrite ONE token of a
 *                               struct-valued line: `K=Class {, " name 512", " other 1", }` holds the
 *                               element `" name 512"`; --value replaces its value. The section and
 *                               key must name exactly one line, that line must be struct-valued,
 *                               the token name must appear exactly once in it, and its value must
 *                               be exactly --old; anything else is an error (sf-p4: the U22
 *                               preset, ScriptTools\SCR_ImageSetGenerator's m_iImageWidth 512 to 384)
 *   read-keys                   print section and key names; values only when they are not
 *                               path-like (a backslash, `/`, `$`, a <placeholder> or %VAR%); never the whole ini
 *
 * Flags: --in <ini> --out <ini> --artifacts <dir> --record <json> [--really].
 * --in, --out and --record must lie inside the artifacts folder (forceSettingsFileRefusal of
 * preflight.ts; --out and --record need not exist yet, their folder must), --out must differ
 * from --in, and --out and --record are created, never overwritten. The edit tools refuse while
 * any Workbench process runs (it holds the ini and writes it back at exit). Without --really an
 * edit prints what it would change and writes nothing. The record (like scratch-ini-scrub.json
 * of s-b-scratch-profile.ts) holds the sha256 of the input and output files; per set the line
 * number, the line before and after; per drop the count and the sha256 of each dropped line, not
 * its text. Every printed path is in placeholder form.
 *
 * Usage:
 *   npx tsx scripts/live/ini-edit.ts drop-section --prefix "PropertyGrid\unnamed\"
 *       --in <ini> --out <ini> --artifacts <dir> --record <json> [--really]
 *   npx tsx scripts/live/ini-edit.ts set --section Workbench --key LSP_Enabled --value 1 --create
 *       [--section ... --key ... --value ... [--create]] --in ... --out ... --artifacts ...
 *       --record ... [--really]
 *   npx tsx scripts/live/ini-edit.ts read-keys --in <ini> --artifacts <dir>
 *
 * Exit code: 0 done (or dry run), 1 refused or failed, 2 usage error.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isMainModule } from "./cli.js";
import { WORKBENCH_EXE } from "./launch.js";
import {
  defaultPlaceholderContext,
  insideGitWorkTree,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";
import { forceSettingsFileRefusal } from "./preflight.js";
import { defaultExec, processesByImage, type ExecFn } from "./win.js";

export const RECORD_KIND = "scratch-ini-edit";

/** Keys `set` never touches: the harness's own channel to Workbench. */
export const REFUSED_KEY_RE = /^NetAPI_/i;

export interface IniLine {
  /** 1-based line number in the input. */
  line: number;
  section: string | null;
  key: string | null;
  text: string;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** The line break the file uses (CRLF when any line ends with it). */
export function lineBreak(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function parseIni(text: string): {
  lines: IniLine[];
  eol: "\r\n" | "\n";
  finalEol: boolean;
} {
  const eol = lineBreak(text);
  const finalEol = text.endsWith("\n");
  const raw = text.split(/\r?\n/);
  if (finalEol) raw.pop();
  let section: string | null = null;
  const lines = raw.map((t, i) => {
    const h = /^\[(.*)\]\s*$/.exec(t);
    if (h) {
      section = h[1];
      return { line: i + 1, section, key: null, text: t };
    }
    const eq = t.indexOf("=");
    const key = eq > 0 && !t.startsWith(";") && !t.startsWith("#") ? t.slice(0, eq) : null;
    return { line: i + 1, section, key, text: t };
  });
  return { lines, eol, finalEol };
}

function joinIni(lines: string[], eol: string, finalEol: boolean): string {
  return lines.join(eol) + (finalEol ? eol : "");
}

// ── drop-section ─────────────────────────────────────────────────────────────

export interface DropResult {
  text: string;
  prefix: string;
  count: number;
  bySection: Record<string, number>;
  dropped: Array<{ line: number; sha256: string }>;
}

/** Drop every key line whose key starts with `prefix` (case-sensitive), in any section. */
export function dropSectionPrefix(text: string, prefix: string): DropResult {
  if (!prefix) throw new Error("drop-section needs a non-empty --prefix");
  const ini = parseIni(text);
  const kept: string[] = [];
  const dropped: Array<{ line: number; sha256: string }> = [];
  const bySection: Record<string, number> = {};
  for (const l of ini.lines) {
    if (l.key !== null && l.key.startsWith(prefix)) {
      dropped.push({ line: l.line, sha256: sha256(l.text) });
      const s = l.section ?? "";
      bySection[s] = (bySection[s] ?? 0) + 1;
    } else {
      kept.push(l.text);
    }
  }
  return {
    text: joinIni(kept, ini.eol, ini.finalEol),
    prefix,
    count: dropped.length,
    bySection,
    dropped,
  };
}

// ── set ──────────────────────────────────────────────────────────────────────

export interface SetSpec {
  section: string;
  key: string;
  value: string;
  create?: boolean;
  /** A struct-token edit: the token name inside the struct value, and its exact old value. */
  token?: string;
  old?: string;
}

/** The quoted elements of a struct value: `" name value"`. */
const STRUCT_ELEMENT_RE = /"(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s+)([^"]*)"/g;

/**
 * Rewrite one token of a struct-valued ini value (`Class {, " name v", ... }`): the token must
 * appear exactly once and hold exactly `old`. Returns the new value.
 */
export function setStructToken(value: string, token: string, old: string, next: string): string {
  if (!/^[^{]*\{.*\}\s*$/.test(value))
    throw new Error("set: the line is not struct-valued (no `{ ... }`)");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) throw new Error(`set: bad --token ${token}`);
  if (!old || !next || /["\s]/.test(old) || /["\s]/.test(next))
    throw new Error("set: --old and --value of a token edit are one non-empty word each");
  const hits = [...value.matchAll(STRUCT_ELEMENT_RE)].filter((m) => m[2] === token);
  if (hits.length !== 1)
    throw new Error(
      `set: token ${token} appears ${hits.length} times in the struct (exactly 1 needed)`,
    );
  const h = hits[0];
  if (h[4] !== old) throw new Error(`set: token ${token} holds ${h[4]}, not --old ${old}`);
  const at = h.index!;
  return value.slice(0, at) + `"${h[1]}${token}${h[3]}${next}"` + value.slice(at + h[0].length);
}

export interface SetChange {
  section: string;
  key: string;
  /** Line number in the input; for a created line, the line it was inserted after (0: none). */
  line: number;
  before: string | null;
  after: string;
  created: boolean;
}

export function setValues(text: string, specs: SetSpec[]): { text: string; changes: SetChange[] } {
  if (specs.length === 0) throw new Error("set needs at least one --section/--key/--value group");
  for (const s of specs) {
    if (!s.section || !s.key) throw new Error("set: --section and --key must be non-empty");
    if (REFUSED_KEY_RE.test(s.key)) {
      throw new Error(
        `set refuses ${s.key}: the NET API keys are the harness's channel to Workbench`,
      );
    }
    if ((s.token === undefined) !== (s.old === undefined))
      throw new Error("set: --token and --old go together");
    if (s.token !== undefined && s.create)
      throw new Error("set: a token edit never creates (--create with --token)");
    if (
      /[\r\n]/.test(s.key + s.value + s.section + (s.token ?? "") + (s.old ?? "")) ||
      s.key.includes("=")
    ) {
      throw new Error(`set: ${s.key} has a line break or '=' in its section, key or value`);
    }
  }
  const ini = parseIni(text);
  const lines: Array<{ text: string; line: number; section: string | null; key: string | null }> =
    ini.lines.map((l) => ({ ...l }));
  const changes: SetChange[] = [];
  for (const s of specs) {
    const hits = lines.filter((l) => l.section === s.section && l.key === s.key);
    if (hits.length > 1) throw new Error(`set: ${s.section}/${s.key} appears ${hits.length} times`);
    if (s.token !== undefined) {
      if (hits.length !== 1)
        throw new Error(
          `set: ${s.section}/${s.key} is not in the ini (a token edit needs the line)`,
        );
      const h = hits[0];
      const cur = h.text.slice(h.text.indexOf("=") + 1);
      const tokenAfter = `${s.key}=${setStructToken(cur, s.token, s.old!, s.value)}`;
      changes.push({
        section: s.section,
        key: s.key,
        line: h.line,
        before: h.text,
        after: tokenAfter,
        created: false,
      });
      h.text = tokenAfter;
      continue;
    }
    const after = `${s.key}=${s.value}`;
    if (hits.length === 1) {
      const h = hits[0];
      changes.push({
        section: s.section,
        key: s.key,
        line: h.line,
        before: h.text,
        after,
        created: false,
      });
      h.text = after;
      continue;
    }
    if (!s.create) {
      throw new Error(`set: ${s.section}/${s.key} is not in the ini (pass --create to add it)`);
    }
    // Insert after the last line of the section; a missing section is appended at the end.
    let at = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].section === s.section) at = i;
    if (at === -1) {
      lines.push({ text: `[${s.section}]`, line: 0, section: s.section, key: null });
      at = lines.length - 1;
    } else {
      while (at > 0 && lines[at].text.trim() === "" && lines[at - 1].section === s.section) at--;
    }
    lines.splice(at + 1, 0, { text: after, line: 0, section: s.section, key: s.key });
    changes.push({
      section: s.section,
      key: s.key,
      line: lines[at].line,
      before: null,
      after,
      created: true,
    });
  }
  return {
    text: joinIni(
      lines.map((l) => l.text),
      ini.eol,
      ini.finalEol,
    ),
    changes,
  };
}

// ── read-keys ────────────────────────────────────────────────────────────────

/** A value that names a path or a variable: never printed. */
export function isPathLike(value: string): boolean {
  // The task's rule (`:\`, `\\`, `/`, `$`) widened to any backslash and to the placeholder forms
  // a scrubbed ini carries (`<v2>\x`, `%LOCALAPPDATA%`), which the narrow rule let through.
  return (
    value.includes("\\") ||
    value.includes("/") ||
    value.includes("$") ||
    /<[^<>]+>/.test(value) ||
    /%[A-Za-z_]+%/.test(value)
  );
}

export interface KeyName {
  section: string;
  key: string;
  /** The value, or null when it is path-like (never printed). */
  value: string | null;
}

export function readKeyNames(text: string): KeyName[] {
  return parseIni(text)
    .lines.filter((l) => l.key !== null)
    .map((l) => {
      const value = l.text.slice(l.key!.length + 1);
      return { section: l.section ?? "", key: l.key!, value: isPathLike(value) ? null : value };
    });
}

// ── Paths and guards ─────────────────────────────────────────────────────────

/** Why a file that may not exist yet (--out, --record) is refused, or null. */
export function newFileRefusal(path: string, artifactsRoot: string): string | null {
  const abs = resolve(path);
  const rel = relative(resolve(artifactsRoot), abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return `${abs} is not inside the artifacts folder ${artifactsRoot}`;
  }
  if (insideGitWorkTree(dirname(abs))) return `${abs} lies inside a git working tree`;
  if (!existsSync(dirname(abs))) return `the folder of ${abs} does not exist`;
  if (existsSync(abs)) return `${abs} exists; it is created, never overwritten`;
  return null;
}

/** Why an edit may not run now: any Workbench process holds the ini and writes it back. */
export function workbenchRunningRefusal(
  platform: NodeJS.Platform = process.platform,
  exec: ExecFn = defaultExec,
): string | null {
  if (platform !== "win32") return null;
  let running: number[];
  try {
    running = processesByImage(exec, WORKBENCH_EXE).map((p) => p.pid);
  } catch (e) {
    return `could not list ${WORKBENCH_EXE} processes (${e instanceof Error ? e.message : String(e)})`;
  }
  return running.length
    ? `${WORKBENCH_EXE} is running (pid ${running.join(", ")}): it holds the ini and writes it back at exit`
    : null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

interface Cli {
  command: string;
  options: Record<string, string>;
  sets: SetSpec[];
  really: boolean;
}

const VALUED = new Set([
  "prefix",
  "section",
  "key",
  "value",
  "token",
  "old",
  "in",
  "out",
  "artifacts",
  "record",
]);
type GroupField = "section" | "key" | "value" | "token" | "old";
const GROUP: ReadonlySet<string> = new Set<GroupField>(["section", "key", "value", "token", "old"]);

export function parseCli(argv: string[]): Cli {
  const [command, ...rest] = argv;
  if (!command || !["drop-section", "set", "read-keys"].includes(command)) {
    throw new Error("usage: ini-edit.ts drop-section | set | read-keys (see the file header)");
  }
  const options: Record<string, string> = {};
  const sets: SetSpec[] = [];
  let cur: Partial<SetSpec> | null = null;
  let really = false;
  const flush = () => {
    if (!cur) return;
    if (cur.section === undefined || cur.key === undefined || cur.value === undefined) {
      throw new Error("set: each group needs --section, --key and --value");
    }
    sets.push(cur as SetSpec);
    cur = null;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (name === "really") {
      really = true;
      continue;
    }
    if (name === "create") {
      if (command !== "set" || !cur)
        throw new Error("--create follows a --section/--key/--value group");
      cur.create = true;
      continue;
    }
    if (!VALUED.has(name)) throw new Error(`unknown option --${name}`);
    const v = rest[++i];
    if (v === undefined) throw new Error(`--${name} needs a value`);
    if (command === "set" && GROUP.has(name)) {
      if (name === "section") {
        flush();
        cur = { section: v };
      } else {
        if (!cur) throw new Error(`--${name} must follow --section`);
        if (cur[name as Exclude<GroupField, "section">] !== undefined)
          throw new Error(`--${name} given twice in one group`);
        cur[name as Exclude<GroupField, "section">] = v;
      }
      continue;
    }
    if (options[name] !== undefined) throw new Error(`--${name} given twice`);
    options[name] = v;
  }
  if (command === "set") flush();
  return { command, options, sets, really };
}

export function main(
  argv: string[],
  deps: {
    platform?: NodeJS.Platform;
    exec?: ExecFn;
    ph?: PlaceholderContext;
    log?: (s: string) => void;
    err?: (s: string) => void;
  } = {},
): number {
  const ph = deps.ph ?? defaultPlaceholderContext();
  const log = deps.log ?? ((s: string) => console.log(toPlaceholders(s, ph)));
  const err = deps.err ?? ((s: string) => console.error(toPlaceholders(s, ph)));
  let cli: Cli;
  try {
    cli = parseCli(argv);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const o = cli.options;
  if (!o.in || !o.artifacts) {
    err("--in and --artifacts are required");
    return 2;
  }
  const inRefusal = forceSettingsFileRefusal(o.in, o.artifacts);
  if (inRefusal) {
    err(`refused: ${inRefusal.replace("--force-settings ", "--in ")}`);
    return 1;
  }
  const input = readFileSync(o.in, "utf-8");
  if (cli.command === "read-keys") {
    for (const k of readKeyNames(input)) {
      log(
        `[${k.section}] ${k.key}${k.value === null ? " (path-like value not shown)" : `=${k.value}`}`,
      );
    }
    return 0;
  }
  if (!o.out || !o.record) {
    err(`${cli.command} needs --out and --record`);
    return 2;
  }
  if (resolve(o.out) === resolve(o.in)) {
    err("refused: --out must not be --in");
    return 1;
  }
  for (const [flag, p] of [
    ["--out", o.out],
    ["--record", o.record],
  ] as const) {
    const r = newFileRefusal(p, o.artifacts);
    if (r) {
      err(`refused: ${flag} ${r}`);
      return 1;
    }
  }
  const running = workbenchRunningRefusal(deps.platform, deps.exec);
  if (running) {
    err(`refused: ${running}`);
    return 1;
  }
  let output: string;
  let detail: Record<string, unknown>;
  try {
    if (cli.command === "drop-section") {
      if (!o.prefix) {
        err("drop-section needs --prefix");
        return 2;
      }
      const d = dropSectionPrefix(input, o.prefix);
      output = d.text;
      detail = {
        drop: { prefix: d.prefix, count: d.count, by_section: d.bySection, lines: d.dropped },
      };
      log(`drop-section ${d.prefix}: ${d.count} lines (${JSON.stringify(d.bySection)})`);
    } else {
      const s = setValues(input, cli.sets);
      output = s.text;
      detail = {
        sets: s.changes.map((c) => ({
          ...c,
          before: c.before === null ? null : toPlaceholders(c.before, ph),
          after: toPlaceholders(c.after, ph),
        })),
      };
      for (const c of s.changes) {
        log(
          `set [${c.section}] ${c.key}: ${c.created ? `created after line ${c.line}` : `line ${c.line}`}: ` +
            `${c.before ?? "(absent)"} -> ${c.after}`,
        );
      }
    }
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const record = {
    kind: RECORD_KIND,
    command: cli.command,
    in: { path: toPlaceholders(resolve(o.in), ph), sha256: sha256(input) },
    out: { path: toPlaceholders(resolve(o.out), ph), sha256: sha256(output) },
    ...detail,
  };
  if (!cli.really) {
    log(
      `dry run (pass --really to write): would write ${o.out} (sha256 ${record.out.sha256}) and ${o.record}`,
    );
    return 0;
  }
  writeFileSync(o.out, output, { encoding: "utf-8", flag: "wx" });
  writeFileSync(o.record, JSON.stringify(record, null, 2) + "\n", {
    encoding: "utf-8",
    flag: "wx",
  });
  log(`wrote ${o.out} (sha256 ${record.out.sha256}); record ${o.record}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
