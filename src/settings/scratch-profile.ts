/**
 * The scratch settings ini `wb_settings profile` builds from a registry export (phase5-w8-spec.md
 * section 2.2; DEC-038, DEC-041, DEC-076 OI-W8-3).
 *
 * Ported from `scripts/live/s-b-scratch-profile.ts` (buildScratchIni and its helpers) and
 * `scripts/live/scratch-ini.ts` (scratchIniFromExport); the scripts stay as they are.
 *
 *   1 scrub    E06's personal-data rules, the excluded subtrees, recent lists under any
 *              spelling, identity names, identifier-shaped values, the known-path check; the NET
 *              API values kept as exported and required enabled
 *   2 debug    `ScriptDebugMode=false` in `[World%20Editor]` (created when absent): a VM exception
 *              must not raise the VME dialog
 *   3 check    no line names a script authorization (the launch's `-scriptAuthorizeAll` is the
 *              only authorization, DEC-041); the result is refused otherwise
 *
 * Pure: the personal context and the known absolute paths are inputs.
 *
 * [unverified] (as in S-B): the QSettings ini format Workbench reads with -forceSettings is built
 * to Qt's IniFormat rules ([General] for the root, group names and keys escaped, sub-keys joined
 * with a backslash).
 */

import { iniNameFolded, setValues } from "./ini-edit.js";
import {
  gateScan,
  personalReason,
  subtreeReason,
  type PersonalContext,
  type RegExport,
  type RegValue,
} from "./reg-export.js";

export const NET_API_SECTION = "Workbench";
export const NET_API_ENABLED = "NetAPI_Enabled";
export const NET_API_NAME = /^NetAPI_/i;
export const DEBUG_SECTION = "World%20Editor";
export const DEBUG_KEY = "ScriptDebugMode";
/** A line that names a script authorization (DEC-041: only the launch flag authorizes). */
export const AUTHORIZATION_RE = /authori[sz]/i;

/** Why building the scratch ini was refused. Nothing is written. */
export class ScrubRefusal extends Error {}

// ── QSettings IniFormat escaping ─────────────────────────────────────────────

const HEX = "0123456789ABCDEF";

/** A key or group name as QSettings IniFormat escapes it [unverified against Workbench]. */
export function iniEscapedKey(key: string): string {
  let out = "";
  for (const c of key) {
    const ch = c.codePointAt(0)!;
    if (c === "/") out += "\\";
    else if (/[A-Za-z0-9_.-]/.test(c)) out += c;
    else if (ch <= 0xff) out += "%" + HEX[ch >> 4] + HEX[ch & 15];
    else if (ch <= 0xffff) out += "%U" + ch.toString(16).toUpperCase().padStart(4, "0");
    else {
      for (let i = 0; i < c.length; i++) {
        out += "%U" + c.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
      }
    }
  }
  return out;
}

/** A string value as QSettings IniFormat writes it [unverified against Workbench]. */
export function iniEscapedString(s: string): string {
  let out = "";
  let needsQuotes = false;
  let escapeNextIfDigit = false;
  for (const c of s) {
    const ch = c.codePointAt(0)!;
    if (c === ";" || c === "," || c === "=") needsQuotes = true;
    if (escapeNextIfDigit && /[0-9A-Fa-f]/.test(c)) {
      out += "\\x" + ch.toString(16);
      continue;
    }
    escapeNextIfDigit = false;
    switch (c) {
      case "\0":
        out += "\\0";
        escapeNextIfDigit = true;
        break;
      case "\x07":
        out += "\\a";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\v":
        out += "\\v";
        break;
      case '"':
      case "\\":
        out += "\\" + c;
        break;
      default:
        if (ch <= 0x1f || ch === 0x7f) {
          out += "\\x" + ch.toString(16);
          escapeNextIfDigit = true;
        } else {
          out += c;
        }
    }
  }
  if (needsQuotes || out.startsWith(" ") || out.endsWith(" ")) out = `"${out}"`;
  return out;
}

/** Section name of a registry key path: the root's values go to [General]. */
export function iniSection(segments: readonly string[]): string {
  if (segments.length === 0) return "General";
  const head = iniEscapedKey(segments[0]);
  return head === "General" ? "%General" : head;
}

/** The ini key of a value: the sub-key path below the section and the value name, escaped. */
export function iniKeyOf(segments: readonly string[], name: string): string {
  return [...segments.slice(1), name].map(iniEscapedKey).join("\\");
}

/** The scalar text of a value the ini carries, or null for a type it does not carry. */
export function scalarText(v: RegValue): string | null {
  switch (v.type) {
    case "REG_SZ":
      return v.text ?? "";
    case "REG_DWORD":
      return String(parseInt(v.text ?? "0", 16) >>> 0);
    case "REG_QWORD":
      return v.bytes && v.bytes.length === 8 ? v.bytes.readBigUInt64LE(0).toString() : null;
    default:
      return null;
  }
}

// ── Scrub rules (S-B) ────────────────────────────────────────────────────────

/** A recent-items list or history, under any spelling (key segment or value name). */
export const RECENT_LIST = /recent|mru|history|last.*(project|opened|world)|opened/i;

/** A value name that holds an identity rather than a setting (a Steam account, a user id). */
export const IDENTITY_NAME = /steam|account|userid|user_id|\bsid\b/i;

/** Why a key path is dropped as a whole on its shape (recent list, drive or UNC segment), or null. */
export function keyShapeReason(segs: readonly string[]): string | null {
  if (segs.some((s) => RECENT_LIST.test(s))) return "recent-list";
  if (segs.some((s) => /^[A-Za-z]:$/.test(s))) return "drive-segment";
  if (segs.some((s) => s === "")) return "unc-segment";
  return null;
}

/** Why a value text is dropped on its shape (UNC path, GUID, long hex id, base64-like), or null. */
export function identifierReason(text: string): string | null {
  const t = text.trim();
  if (
    /^\\\\/.test(t) ||
    /(^|[\s"'=])\/\/[A-Za-z0-9_.-]+\//.test(t) ||
    /\\\\[A-Za-z0-9_.-]+\\/.test(t)
  )
    return "unc-path";
  if (/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(t))
    return "guid";
  if (/^(0x)?[0-9a-f]{16,}$/i.test(t)) return "long-hex-id";
  if (/\[U:\d+:\d+\]/i.test(t)) return "steamid3";
  if (/\bS-1-5-21(-\d+){1,}/i.test(t)) return "windows-sid";
  if (/\b(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/.test(t)) return "ipv4";
  if (
    t.length >= 16 &&
    t.length < 24 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(t) &&
    /[0-9]/.test(t) &&
    /[A-Z]/.test(t) &&
    /[a-z]/.test(t)
  )
    return "short-base64-like";
  if (
    t.length >= 24 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(t) &&
    (/[0-9+/]/.test(t) || t.endsWith("=")) &&
    /[A-Z]/.test(t) &&
    /[a-z]/.test(t)
  )
    return "base64-like";
  return null;
}

/** A percent-encoded value decoded, or null when it holds no escape or does not decode. */
export function percentDecoded(text: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return null;
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Why a value text is withheld (personal or identifier-shaped), or null when it may be shown. */
export function textReason(text: string, personal: PersonalContext): string | null {
  return (
    personalReason(text, personal) ??
    identifierReason(text) ??
    personalReason(percentDecoded(text) ?? "", personal)
  );
}

/** One registry value, classified: kept with its scalar text, or dropped with a reason. */
export type Classified = { keep: true; text: string } | { keep: false; reason: string };

/**
 * The scrub decision for one value of a key (S-B buildScratchIni's rules, in its order). Values
 * dropped here never reach a scratch ini and are never shown by a read.
 */
export function classifyValue(
  segs: readonly string[],
  v: RegValue,
  personal: PersonalContext,
): Classified {
  const reasonOf = (t: string): string | null => personalReason(t, personal);
  const subtree = subtreeReason(segs) ?? keyShapeReason(segs);
  if (subtree) return { keep: false, reason: subtree };
  const segReason =
    segs.map(reasonOf).find((r) => r !== null) ?? (segs.length ? reasonOf(segs.join("\\")) : null);
  if (segReason) return { keep: false, reason: `personal-key:${segReason}` };
  if (v.name === "") return { keep: false, reason: "default-value" };
  if (RECENT_LIST.test(v.name)) return { keep: false, reason: "recent-list" };
  const nameReason = reasonOf(v.name) ?? reasonOf([...segs, v.name].join("\\"));
  if (nameReason) return { keep: false, reason: `personal-name:${nameReason}` };
  const text = scalarText(v);
  if (text === null) return { keep: false, reason: `type:${v.type}` };
  const tr = textReason(text, personal);
  if (tr) return { keep: false, reason: `personal-value:${tr}` };
  if (IDENTITY_NAME.test(v.name)) return { keep: false, reason: "personal-name:identity-name" };
  return { keep: true, text };
}

// ── Known absolute paths ─────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The spellings one path can take in text: as given, both slash styles, JSON-escaped. */
function spellings(path: string): string[] {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed.length < 2) return [];
  const back = trimmed.replace(/\//g, "\\");
  const fwd = trimmed.replace(/\\/g, "/");
  const jsonBack = back.replace(/\\/g, "\\\\");
  return [...new Set([trimmed, back, fwd, jsonBack])];
}

/** True when `text` names one of the known absolute paths (any slash style, any case). */
export function holdsKnownPath(text: string, knownPaths: readonly string[]): boolean {
  const alts = knownPaths.flatMap(spellings).map((s) => escapeRegExp(s.toLowerCase()));
  if (alts.length === 0) return false;
  return new RegExp(`(?:${alts.join("|")})(?![\\w-])`, "i").test(text);
}

// ── The scratch ini ──────────────────────────────────────────────────────────

export interface ScratchIni {
  /** The ini text (UTF-8, CRLF line ends). */
  text: string;
  /** Section names in the order written (escaped). */
  sections: string[];
  /** NET API values carried, by name. */
  netApi: Record<string, string>;
  kept: number;
  /** Dropped values by reason. */
  dropped: Record<string, number>;
}

/**
 * Build the scrubbed ini from a parsed registry export. Throws ScrubRefusal when the export holds
 * no enabled `Workbench\NetAPI_Enabled` (enabling it would be a settings write), or when the
 * finished text fails the personal-data gate or still names a known absolute path.
 */
export function buildScratchIni(
  reg: RegExport,
  personal: PersonalContext,
  knownPaths: readonly string[],
): ScratchIni {
  const dropped: Record<string, number> = {};
  const bySection = new Map<string, Array<[string, string]>>();
  const rawLines: string[] = [];
  const netApi: Record<string, string> = {};
  let kept = 0;
  for (const key of reg.keys) {
    const segs = key.segments;
    for (const v of key.values) {
      const c = classifyValue(segs, v, personal);
      if (!c.keep) {
        dropped[c.reason] = (dropped[c.reason] ?? 0) + 1;
        continue;
      }
      const section = iniSection(segs);
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section)!.push([iniKeyOf(segs, v.name), iniEscapedString(c.text)]);
      rawLines.push(`${[...segs, v.name].join("\\")}=${c.text}`);
      if (
        segs.length === 1 &&
        segs[0].toLowerCase() === NET_API_SECTION.toLowerCase() &&
        NET_API_NAME.test(v.name)
      ) {
        netApi[v.name] = c.text;
      }
      kept++;
    }
  }
  const enabled = netApi[NET_API_ENABLED];
  if (enabled === undefined) {
    throw new ScrubRefusal(
      `the export holds no ${NET_API_SECTION}\\${NET_API_ENABLED}: a scratch profile without the NET API ` +
        "would leave the tools without Workbench. Enabling it is a registry write, which is the owner's.",
    );
  }
  if (!/^(1|true)$/i.test(enabled.trim())) {
    throw new ScrubRefusal(
      `${NET_API_SECTION}\\${NET_API_ENABLED} is "${enabled}" in the export: the NET API is not enabled ` +
        "in the Workbench settings. Enabling it is a registry write, which is the owner's.",
    );
  }
  const lines: string[] = [];
  const sections = [...bySection.keys()];
  for (const section of sections) {
    if (lines.length > 0) lines.push("");
    lines.push(`[${section}]`);
    const entries = bySection
      .get(section)!
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [k, val] of entries) lines.push(`${k}=${val}`);
  }
  const text = lines.join("\r\n") + "\r\n";
  // The same gate on the escaped text and on the unescaped entries.
  for (const [what, gated] of [
    ["the scratch ini", text],
    ["the scratch ini (unescaped)", rawLines.join("\n")],
  ] as const) {
    const hits = gateScan(gated, personal);
    if (hits.length > 0) {
      throw new ScrubRefusal(`${what} failed the personal-data gate: ${hits.join(", ")}`);
    }
    if (holdsKnownPath(gated, knownPaths)) {
      throw new ScrubRefusal(`${what} still holds a known absolute path`);
    }
  }
  return { text, sections, netApi, kept, dropped };
}

/** The state of `ScriptDebugMode` in `[World%20Editor]` (S-C iniScriptDebugMode). */
export function iniScriptDebugMode(text: string): {
  state: "off" | "on" | "absent";
  line: string | null;
} {
  // Names are compared decoded and folded (review round 1, W8-SET-01).
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    const header = /^\[(.*)\]$/.exec(l);
    if (header) {
      inSection = iniNameFolded(header[1]) === iniNameFolded(DEBUG_SECTION);
      continue;
    }
    const eq = l.indexOf("=");
    if (!inSection || eq <= 0 || iniNameFolded(l.slice(0, eq)) !== DEBUG_KEY.toLowerCase())
      continue;
    const v = l
      .replace(/^[^=]*=\s*/, "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .toLowerCase();
    return { state: v === "false" || v === "0" ? "off" : "on", line: l };
  }
  return { state: "absent", line: null };
}

/**
 * Why a scratch ini text may not be written, or null: Script Debug Mode does not read off, or a
 * line names a script authorization. Every file `wb_settings` writes passes this check.
 */
export function scratchInvariantProblem(text: string): string | null {
  const debug = iniScriptDebugMode(text);
  if (debug.state !== "off")
    return `${DEBUG_KEY} does not read off in [${DEBUG_SECTION}] (${debug.line ?? "absent"})`;
  const auth = text
    .split(/\r?\n/)
    .filter((l) => AUTHORIZATION_RE.test(l) || AUTHORIZATION_RE.test(iniNameFolded(l)));
  if (auth.length)
    return `the ini names a script authorization on ${auth.length} line(s); only the launch's -scriptAuthorizeAll may authorize (DEC-041)`;
  // A (section, key) pair that reads the same once decoded and folded may appear only once, so
  // an escaped second spelling cannot carry a second value past the checks above (W8-SET-01).
  const seen = new Set<string>();
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    const header = /^\[(.*)\]$/.exec(l);
    if (header) {
      section = iniNameFolded(header[1]);
      continue;
    }
    const eq = l.indexOf("=");
    if (eq <= 0 || l.startsWith(";") || l.startsWith("#")) continue;
    const id = `${section}\u0000${iniNameFolded(l.slice(0, eq))}`;
    if (seen.has(id))
      return `the ini holds ${l.slice(0, eq)} twice in one section once escapes are decoded and case folded`;
    seen.add(id);
  }
  return null;
}

export interface ScratchIniResult extends ScratchIni {
  debugLine: string | null;
}

/**
 * The scratch ini from a parsed registry export: scrubbed, `ScriptDebugMode=false`, checked for
 * authorization lines. Throws ScrubRefusal on any refusal.
 */
export function scratchIniFromExport(
  reg: RegExport,
  personal: PersonalContext,
  knownPaths: readonly string[],
): ScratchIniResult {
  const scrubbed = buildScratchIni(reg, personal, knownPaths);
  const { text } = setValues(scrubbed.text, [
    { section: DEBUG_SECTION, key: DEBUG_KEY, value: "false", create: true },
  ]);
  const problem = scratchInvariantProblem(text);
  if (problem) throw new ScrubRefusal(problem);
  return { ...scrubbed, text, debugLine: iniScriptDebugMode(text).line };
}
