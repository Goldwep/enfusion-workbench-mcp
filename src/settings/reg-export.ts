/**
 * Registry export reader for `wb_settings` (phase5-w8-spec.md section 2.2; DEC-076 OI-W8-3).
 *
 * Ported from the E06 enumerator (`scripts/census/enumerators/e06-settings-store.ts`): the `.reg`
 * decoder and parser, the excluded subtrees and the personal-data rules. The scripts stay as they
 * are; src cannot import them.
 *
 * The registry is only ever READ, and only through `reg export` of the one Workbench key into a
 * NEW file inside the artifacts folder (never `/y`, never over an existing file). There is no
 * registry write path in this module or anywhere in `wb_settings` (OI-W8-3).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { containsMachinePath } from "../census/hygiene.js";

/** The Workbench settings key (S-B's DEFAULT_REGISTRY_KEY). */
export const REGISTRY_KEY = "HKCU\\Software\\Bohemia Interactive\\Arma Reforger Workbench";

/** Sub-folder of the artifacts folder that holds the registry exports `wb_settings` takes. */
export const EXPORTS_SUBDIR = "settings/exports";

/** Runs a program with an argv array (no shell); returns its stdout. Injectable for tests. */
export type ExecFn = (file: string, args: string[]) => string;

export const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { encoding: "utf-8", windowsHide: true, timeout: 20_000 });

// ── .reg parsing (E06) ───────────────────────────────────────────────────────

export interface RegValue {
  /** Value name; `""` for the key's default value. */
  name: string;
  /** `REG_SZ`, `REG_EXPAND_SZ`, `REG_DWORD`, `REG_QWORD`, `REG_BINARY`, `REG_MULTI_SZ`, `REG_NONE` or `REG_TYPE_<n>`. */
  type: string;
  /** REG_SZ and REG_EXPAND_SZ text; REG_DWORD hex digits. */
  text?: string;
  /** Raw bytes of every `hex` form (REG_SZ and REG_EXPAND_SZ are decoded into `text`). */
  bytes?: Buffer;
}

export interface RegKey {
  /** Key path below the Workbench root, one entry per level; `[]` for the root itself. */
  segments: string[];
  values: RegValue[];
}

export interface RegExport {
  keys: RegKey[];
  /** Keys whose path is not under the Workbench root. */
  outsideKeys: number;
  /** `[-key]` deletions and `"name"=-` deletions, which carry no data. */
  deletions: number;
}

const ROOT_PATTERN =
  /^HKEY_[A-Z_]+\\Software\\Bohemia Interactive\\Arma Reforger Workbench(?:\\(.*))?$/i;

/** The text of a `.reg` file: UTF-16LE (BOM or not) or, for REGEDIT4 files, 8-bit text. */
export function decodeRegText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe)
    return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] !== 0 && buf[1] === 0) return buf.toString("utf16le");
  const text = buf.toString("utf-8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const unquote = (s: string): string => s.replace(/\\(.)/g, "$1");

const TYPE_NAMES: Readonly<Record<string, string>> = {
  "0": "REG_NONE",
  "1": "REG_SZ",
  "2": "REG_EXPAND_SZ",
  "3": "REG_BINARY",
  "4": "REG_DWORD",
  "7": "REG_MULTI_SZ",
  b: "REG_QWORD",
};

function hexBytes(list: string): Buffer {
  return Buffer.from(
    list
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .map((h) => parseInt(h, 16)),
  );
}

function parseValueLine(l: string): { name: string; data: string } | null {
  if (l.startsWith("@=")) return { name: "", data: l.slice(2) };
  if (!l.startsWith('"')) return null;
  let i = 1;
  while (i < l.length && l[i] !== '"') i += l[i] === "\\" ? 2 : 1;
  if (i >= l.length || l[i + 1] !== "=") return null;
  return { name: unquote(l.slice(1, i)), data: l.slice(i + 2) };
}

function parseData(name: string, data: string): RegValue | "delete" | null {
  if (data === "-") return "delete";
  if (data.startsWith('"')) {
    const end = data.lastIndexOf('"');
    return { name, type: "REG_SZ", text: unquote(data.slice(1, end > 0 ? end : undefined)) };
  }
  const dw = /^dword:([0-9a-fA-F]{1,8})$/.exec(data);
  if (dw) return { name, type: "REG_DWORD", text: dw[1].toLowerCase() };
  const hx = /^hex(?:\(([0-9a-fA-F]+)\))?:(.*)$/s.exec(data);
  if (!hx) return null;
  const code = (hx[1] ?? "3").toLowerCase().replace(/^0+(?=.)/, "");
  const type = TYPE_NAMES[code] ?? `REG_TYPE_${code}`;
  const bytes = hexBytes(hx[2]);
  if (type === "REG_SZ" || type === "REG_EXPAND_SZ")
    return { name, type, text: bytes.toString("utf16le").replace(/\0+$/, "") };
  return { name, type, bytes };
}

/** Parses `.reg` text. Throws when the text is not a registry export. */
export function parseRegText(text: string): RegExport {
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim() !== "");
  if (first === undefined || !/^(Windows Registry Editor|REGEDIT4)/.test(first.trim()))
    throw new Error("not a registry export (no Windows Registry Editor header)");
  const byPath = new Map<string, RegKey>();
  const keys: RegKey[] = [];
  let cur: RegKey | null = null;
  let outsideKeys = 0;
  let deletions = 0;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i].trim();
    // Long hex data wraps with a trailing backslash after a comma.
    while (l.endsWith("\\") && !l.startsWith("[") && i + 1 < lines.length)
      l = l.slice(0, -1) + lines[++i].trim();
    if (l === "" || l.startsWith(";")) continue;
    if (l.startsWith("[")) {
      const body = l.endsWith("]") ? l.slice(1, -1) : l.slice(1);
      if (body.startsWith("-")) {
        deletions++;
        cur = null;
        continue;
      }
      const m = ROOT_PATTERN.exec(body);
      if (!m) {
        outsideKeys++;
        cur = null;
        continue;
      }
      const rel = m[1] ?? "";
      let key = byPath.get(rel);
      if (!key) {
        key = { segments: rel === "" ? [] : rel.split("\\"), values: [] };
        byPath.set(rel, key);
        keys.push(key);
      }
      cur = key;
      continue;
    }
    if (cur === null) continue;
    const v = parseValueLine(l);
    if (!v) continue;
    const parsed = parseData(v.name, v.data);
    if (parsed === "delete") deletions++;
    else if (parsed) cur.values.push(parsed);
  }
  return { keys, outsideKeys, deletions };
}

// ── Excluded subtrees and personal data (E06) ────────────────────────────────

/** Layout names Workbench creates itself; any other name is user-defined and dropped. */
export const STOCK_LAYOUTS: readonly string[] = ["default", "edit"];

const lc = (s: string | undefined): string => (s ?? "").toLowerCase();

/** Why a whole subtree is excluded (and its values dropped), or null. */
export function subtreeReason(segs: readonly string[]): string | null {
  if (segs.some((s) => lc(s) === "recentfiles")) return "recent-file-list";
  if (lc(segs[0]) === "world editor" && lc(segs[1]) === "worlds") return "world-path-keyed";
  if (segs.some((s) => /^[0-9a-f]{16,}$/i.test(s))) return "file-id-keyed";
  if (lc(segs[1]) === "perspectives" && segs[2] !== undefined && !STOCK_LAYOUTS.includes(segs[2]))
    return "layout-name-user-defined";
  return null;
}

export interface PersonalContext {
  accountNames: readonly string[];
  hostNames: readonly string[];
}

/** Account and machine names of this process, from the environment (never printed). */
export function personalContextFromEnv(env: NodeJS.ProcessEnv = process.env): PersonalContext {
  const pick = (...keys: string[]): string[] => [
    ...new Set(
      keys.map((k) => env[k]).filter((v): v is string => typeof v === "string" && v.length >= 3),
    ),
  ];
  return {
    accountNames: pick("USERNAME", "USER", "LOGNAME"),
    hostNames: pick("COMPUTERNAME", "HOSTNAME"),
  };
}

/** Why a string is personal (the reason word only, never the match), or null. */
export function personalReason(text: string, ctx: PersonalContext): string | null {
  if (containsMachinePath(text)) return "machine-path";
  if (/(^|[\s"'=(])\$[A-Za-z0-9_.-]+:[^\s]/.test(text)) return "resource-path";
  if (
    /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z][A-Za-z0-9]{0,4}(?![A-Za-z0-9])/.test(
      text,
    )
  )
    return "file-path";
  const lower = text.toLowerCase();
  if (ctx.accountNames.some((n) => lower.includes(n.toLowerCase()))) return "account-name";
  if (ctx.hostNames.some((n) => lower.includes(n.toLowerCase()))) return "machine-name";
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(text)) return "e-mail";
  if (/7656119\d{10}/.test(text)) return "steam-id";
  if (/^[^\s"'\\/]+\.[A-Za-z][A-Za-z0-9]{1,4}$/.test(text)) return "file-name";
  if (/[\\/][^\\/\s"']+\.[A-Za-z][A-Za-z0-9]{1,4}$/.test(text)) return "file-name";
  return null;
}

/** Hits of the output gate on a text: reason words only. */
export function gateScan(text: string, ctx: PersonalContext): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  if (ctx.accountNames.some((n) => lower.includes(n.toLowerCase()))) hits.push("account name");
  if (ctx.hostNames.some((n) => lower.includes(n.toLowerCase()))) hits.push("machine name");
  if (/\bUsers[\\/]/.test(text)) hits.push("Users followed by a slash");
  if (/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(text)) hits.push("drive-letter path");
  return hits;
}

// ── The read-only export ─────────────────────────────────────────────────────

/** A sortable, file-name-safe stamp (UTC, milliseconds). */
export function stamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d{3})Z$/, "$1Z");
}

/** `<artifacts>/settings/exports`. */
export function exportsDir(artifactsRoot: string): string {
  return join(artifactsRoot, ...EXPORTS_SUBDIR.split("/"));
}

const EXPORT_NAME = /^registry-([0-9TZ]+)(?:-(\d+))?\.reg$/;

/** The registry exports `wb_settings` took, newest first (by stamp, then by `-<n>` suffix). */
export function listExports(artifactsRoot: string): string[] {
  const dir = exportsDir(artifactsRoot);
  if (!existsSync(dir)) return [];
  const rows: Array<{ f: string; stamp: string; n: number }> = [];
  for (const f of readdirSync(dir)) {
    const m = EXPORT_NAME.exec(f);
    if (m && statSync(join(dir, f)).isFile())
      rows.push({ f, stamp: m[1], n: m[2] === undefined ? 1 : Number(m[2]) });
  }
  return rows
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : b.n - a.n))
    .map((r) => join(dir, r.f));
}

export interface ExportDeps {
  artifactsRoot: string;
  exec: ExecFn;
  platform: NodeJS.Platform;
  now: () => Date;
}

/**
 * `reg export` of the Workbench key into a NEW file under `<artifacts>/settings/exports/`. Read-only
 * on the registry; `/y` is never passed and the target never exists, so nothing is overwritten
 * (and `reg` never stops to ask). Throws when not on Windows or when `reg` fails.
 */
export function exportRegistry(deps: ExportDeps): string {
  if (deps.platform !== "win32")
    throw new Error("the Workbench registry key exists only on Windows");
  const dir = exportsDir(deps.artifactsRoot);
  mkdirSync(dir, { recursive: true });
  const base = `registry-${stamp(deps.now())}`;
  let target = join(dir, `${base}.reg`);
  for (let n = 2; existsSync(target); n++) target = join(dir, `${base}-${n}.reg`);
  deps.exec("reg", ["export", REGISTRY_KEY, target]);
  if (!existsSync(target)) throw new Error("reg export wrote no file");
  return target;
}

/** Reads and parses one export file. */
export function readExport(file: string): RegExport {
  return parseRegText(decodeRegText(readFileSync(file)));
}
