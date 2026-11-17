/**
 * Scratch-ini edits and guards for `wb_settings` (phase5-w8-spec.md section 2.2 and rule 1.2.6;
 * DEC-076 OI-W8-3).
 *
 * Ported from `scripts/live/ini-edit.ts` (parseIni, setValues, setStructToken, isPathLike,
 * newFileRefusal, workbenchRunningRefusal); the script stays as it is. Added here:
 *   - unsetValues: drop exactly one key line;
 *   - the scratch folder and its records: every ini `wb_settings` writes lies in
 *     `<artifacts>/settings/scratch/` with a record beside it (`<name>.ini.wbsettings.json`) that
 *     holds the file's sha256. A file without a record, outside the folder, or whose bytes no
 *     longer match its record is NOT_SCRATCH: this tool never writes it.
 *
 * Nothing here reads or writes the registry.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecFn } from "./reg-export.js";

/** Keys `set` and `unset` never touch: the tools' own channel to Workbench. */
export const REFUSED_KEY_RE = /^NetAPI_/i;

/** Sub-folder of the artifacts folder that holds the scratch inis. */
export const SCRATCH_SUBDIR = "settings/scratch";

/** Suffix of the record written beside each scratch ini. */
export const RECORD_SUFFIX = ".wbsettings.json";

/** The `kind` of a scratch record. */
export const RECORD_KIND = "wb_settings-scratch";

/** Image name of the Workbench executable (scripts/live/launch.ts WORKBENCH_EXE). */
export const WORKBENCH_IMAGE = "ArmaReforgerWorkbenchSteamDiag.exe";

export function sha256(text: string | Buffer): string {
  return createHash("sha256")
    .update(typeof text === "string" ? Buffer.from(text, "utf-8") : text)
    .digest("hex");
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export interface IniLine {
  /** 1-based line number in the input. */
  line: number;
  section: string | null;
  key: string | null;
  text: string;
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

/** Every key line of an ini as `{section, key, value}` (the text after the first `=`). */
export function iniEntries(text: string): Array<{ section: string; key: string; value: string }> {
  return parseIni(text)
    .lines.filter((l) => l.key !== null)
    .map((l) => ({
      section: l.section ?? "",
      key: l.key!,
      value: l.text.slice(l.key!.length + 1),
    }));
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
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) throw new Error(`set: bad token ${token}`);
  if (!old || !next || /["\s]/.test(old) || /["\s]/.test(next))
    throw new Error("set: the old and new value of a token edit are one non-empty word each");
  const hits = [...value.matchAll(STRUCT_ELEMENT_RE)].filter((m) => m[2] === token);
  if (hits.length !== 1)
    throw new Error(
      `set: token ${token} appears ${hits.length} times in the struct (exactly 1 needed)`,
    );
  const h = hits[0];
  if (h[4] !== old) throw new Error(`set: token ${token} holds ${h[4]}, not ${old}`);
  const at = h.index!;
  return value.slice(0, at) + `"${h[1]}${token}${h[3]}${next}"` + value.slice(at + h[0].length);
}

export interface SetChange {
  section: string;
  key: string;
  /** Line number in the input; for a created line, the line it was inserted after (0: none). */
  line: number;
  before: string | null;
  after: string | null;
  created: boolean;
}

/**
 * A section or key name as QSettings IniFormat reads it, case folded (review round 1, W8-SET-01):
 * `%XX` and `%UXXXX` decoded and a backslash read as `/`, so a guard that compares names cannot be
 * passed by an escaped spelling (`NetAPI%5FEnabled`, `World%20Edito%72`). Fails closed: a name is
 * folded even where Workbench may compare it case-sensitively.
 */
export function iniNameFolded(name: string): string {
  return name
    .replace(
      /%U([0-9A-Fa-f]{4})|%([0-9A-Fa-f]{2})/g,
      (_m, u: string | undefined, x: string | undefined) =>
        String.fromCharCode(parseInt((u ?? x)!, 16)),
    )
    .replace(/\\/g, "/")
    .trim()
    .toLowerCase();
}

function checkSpecShape(s: { section: string; key: string }, extra: string): void {
  if (!s.section || !s.key) throw new Error("the section and the key must be non-empty");
  if (REFUSED_KEY_RE.test(s.key) || REFUSED_KEY_RE.test(iniNameFolded(s.key)))
    throw new Error(`${s.key} is refused: the NET API keys are the tools' channel to Workbench`);
  if (/[\r\n]/.test(s.key + s.section + extra) || s.key.includes("="))
    throw new Error(`${s.key}: a line break or '=' in the section, key or value`);
  if (/[[\]]/.test(s.section)) throw new Error(`the section ${s.section} holds a bracket`);
}

export function setValues(text: string, specs: SetSpec[]): { text: string; changes: SetChange[] } {
  if (specs.length === 0) throw new Error("set needs at least one section/key/value");
  for (const s of specs) {
    checkSpecShape(s, s.value + (s.token ?? "") + (s.old ?? ""));
    if ((s.token === undefined) !== (s.old === undefined))
      throw new Error("set: token and old go together");
    if (s.token !== undefined && s.create)
      throw new Error("set: a token edit never creates a line");
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
    if (!s.create) throw new Error(`set: ${s.section}/${s.key} is not in the ini`);
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

// ── unset ────────────────────────────────────────────────────────────────────

/** Drop exactly one key line. The key must be present once; the section header stays. */
export function unsetValue(
  text: string,
  spec: { section: string; key: string },
): { text: string; change: SetChange } {
  checkSpecShape(spec, "");
  const ini = parseIni(text);
  const hits = ini.lines.filter((l) => l.section === spec.section && l.key === spec.key);
  if (hits.length === 0) throw new Error(`unset: ${spec.section}/${spec.key} is not in the ini`);
  if (hits.length > 1)
    throw new Error(`unset: ${spec.section}/${spec.key} appears ${hits.length} times`);
  const h = hits[0];
  return {
    text: joinIni(
      ini.lines.filter((l) => l !== h).map((l) => l.text),
      ini.eol,
      ini.finalEol,
    ),
    change: {
      section: spec.section,
      key: spec.key,
      line: h.line,
      before: h.text,
      after: null,
      created: false,
    },
  };
}

// ── Values that are never shown ──────────────────────────────────────────────

/** A value that names a path or a variable. */
export function isPathLike(value: string): boolean {
  return (
    value.includes("\\") ||
    value.includes("/") ||
    value.includes("$") ||
    /<[^<>]+>/.test(value) ||
    /%[A-Za-z_]+%/.test(value)
  );
}

// ── Paths and guards ─────────────────────────────────────────────────────────

/** True when `dir` or any parent holds a `.git` entry (a working tree or a worktree link). */
export function insideGitWorkTree(dir: string): boolean {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, ".git"))) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/** `<artifacts>/settings/scratch`. */
export function scratchDir(artifactsRoot: string): string {
  return join(artifactsRoot, ...SCRATCH_SUBDIR.split("/"));
}

/** True when `abs` lies strictly inside `dir`. */
export function isInside(abs: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(abs));
  return !(rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** A scratch-ini name: letters, digits, `_`, `-`, `.`; no leading dot; `.ini` added when absent. */
export const SCRATCH_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/** The `.ini` file name of a scratch name, or null when the name is not acceptable. */
export function scratchFileName(name: string): string | null {
  const n = name.toLowerCase().endsWith(".ini") ? name.slice(0, -4) : name;
  if (!SCRATCH_NAME_RE.test(n) || n.includes("..") || n.endsWith(".")) return null;
  return `${n}.ini`;
}

/**
 * The absolute path a `path`/`store` argument names in the scratch folder: a bare scratch name
 * (`dev`, `dev.ini`) or an absolute path. Null when it names nothing inside the folder.
 */
export function resolveScratchPath(arg: string, artifactsRoot: string): string | null {
  const dir = scratchDir(artifactsRoot);
  if (isAbsolute(arg)) {
    const abs = resolve(arg);
    if (!isInside(abs, dir) || dirname(abs) !== resolve(dir)) return null;
    return scratchFileName(basename(abs)) === basename(abs) ? abs : null;
  }
  const file = scratchFileName(arg);
  return file === null ? null : join(dir, file);
}

/** Why a NEW scratch file may not be created at `abs`, or null. Never overwrites. */
export function newFileRefusal(abs: string, artifactsRoot: string): string | null {
  if (!isInside(abs, scratchDir(artifactsRoot)))
    return `${basename(abs)} is not inside the scratch folder of the artifacts folder`;
  if (insideGitWorkTree(dirname(abs))) return "the scratch folder lies inside a git working tree";
  if (existsSync(abs))
    return `${basename(abs)} exists; a scratch ini is created, never overwritten`;
  if (existsSync(abs + RECORD_SUFFIX))
    return `${basename(abs)}${RECORD_SUFFIX} exists; a scratch ini is created, never overwritten`;
  return null;
}

export interface ScratchRecord {
  kind: typeof RECORD_KIND;
  file: string;
  sha256: string;
  created: string;
  /** `profile` or the scratch file this one was derived from by set or unset. */
  from: string;
}

/** The record text written beside a new scratch ini. */
export function recordText(r: ScratchRecord): string {
  return JSON.stringify(r, null, 2) + "\n";
}

/**
 * Why `abs` is not a scratch ini this tool made and may not be edited from, or null: outside the
 * scratch folder, inside a git working tree, missing, no record, a record of another file, or
 * bytes that no longer match the record (Workbench writes its settings back at exit).
 */
export function notScratchReason(abs: string, artifactsRoot: string): string | null {
  const name = basename(abs);
  if (!isInside(abs, scratchDir(artifactsRoot)))
    return `${name} is not in the scratch folder of wb_settings`;
  if (insideGitWorkTree(dirname(abs))) return "the scratch folder lies inside a git working tree";
  if (!existsSync(abs) || !statSync(abs).isFile()) return `${name} does not exist`;
  const recFile = abs + RECORD_SUFFIX;
  if (!existsSync(recFile)) return `${name} has no wb_settings record: this tool did not make it`;
  let rec: Partial<ScratchRecord>;
  try {
    rec = JSON.parse(readFileSync(recFile, "utf-8")) as Partial<ScratchRecord>;
  } catch {
    return `the record of ${name} does not parse`;
  }
  if (rec.kind !== RECORD_KIND || rec.file !== name)
    return `the record of ${name} is not a wb_settings record of this file`;
  if (rec.sha256 !== sha256(readFileSync(abs)))
    return `${name} changed since wb_settings wrote it (Workbench writes its settings back at exit); make a new profile`;
  return null;
}

/** Why a settings write may not run now: a Workbench process is listed (it writes settings at exit). */
export function workbenchRunningRefusal(
  platform: NodeJS.Platform,
  exec: ExecFn,
  image: string = WORKBENCH_IMAGE,
): string | null {
  if (platform !== "win32") return null;
  let out: string;
  try {
    out = exec("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]);
  } catch (e) {
    // Fail closed: an unknown process table is not "not running".
    return `could not list ${image} processes (${e instanceof Error ? e.message : String(e)})`;
  }
  const pids: number[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m && m[1].toLowerCase() === image.toLowerCase()) pids.push(Number(m[2]));
  }
  return pids.length
    ? `${image} is running (pid ${pids.join(", ")}): it writes its settings back at exit`
    : null;
}
