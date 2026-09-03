/**
 * `server_mod_list` core — resolve the `game.mods[]` block of a server.json
 * against the project-index so the user can see which mods are present in
 * their crawled sources (user / core / workshop) versus which are unknown.
 *
 * Workflow:
 *   1. Read+redact the server.json (raw values never escape redact-io.ts).
 *   2. Walk the mod entries — each is `{modId, name, version?, required?}`.
 *   3. For each `modId` (the workshop GUID), look it up in the project-index
 *      via `ProjectIndex.resolveGuid`.
 *   4. Render a markdown table with resolution status.
 *
 * Pagination isn't strictly necessary — typical server.json has < 50 mods —
 * but we cap the displayed list at a sane number to avoid runaway markdown.
 */

import type { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceRow, ResourceSource } from "../project-index/types.js";
import {
  readRedactedServerConfig,
} from "./redact-io.js";

/** A single resolved row for the output table. */
export interface ResolvedModEntry {
  /** The modId from server.json (workshop GUID, usually 16-hex with braces). */
  modId: string;
  /** Human-readable name from server.json. */
  name: string;
  /** Optional version from server.json. */
  version?: string;
  /** True when the modId was found in the project-index. */
  resolved: boolean;
  /** When resolved, the file path of the indexed resource. */
  filePath: string | null;
  /** When resolved, the source bucket (user / core / workshop). */
  source: ResourceSource | null;
}

/**
 * Strip braces from a workshop modId so it matches the normalized GUID
 * stored in the project-index. modIds in server.json are typically bare hex
 * (no braces) but some hand-edited configs include them. Defensive both
 * ways.
 */
function normalizeGuid(modId: string): string {
  return modId.replace(/^\{|\}$/g, "").toUpperCase();
}

/**
 * Look each mod up in the index, preserving the original order from
 * server.json. Pure — no I/O. Designed to be unit-testable with a stub
 * ProjectIndex.
 */
export function resolveMods(
  mods: readonly { modId: string; name: string; version?: string }[],
  resolver: (guid: string) => ResourceRow | null,
): ResolvedModEntry[] {
  const out: ResolvedModEntry[] = [];
  for (const mod of mods) {
    const normalized = normalizeGuid(mod.modId);
    const row = resolver(normalized);
    out.push({
      modId: mod.modId,
      name: mod.name,
      version: mod.version,
      resolved: row !== null,
      filePath: row?.file_path ?? null,
      source: row?.source ?? null,
    });
  }
  return out;
}

/**
 * Render the resolved mod list as a markdown table.
 */
export function formatModList(input: {
  configPath: string;
  mods: ResolvedModEntry[];
}): string {
  const { configPath, mods } = input;
  const lines: string[] = [];
  lines.push("## Mods in server.json");
  lines.push("");
  lines.push(`File: \`${configPath}\``);
  lines.push("");

  if (mods.length === 0) {
    lines.push("_(server.json has no `game.mods[]` entries)_");
    return lines.join("\n");
  }

  lines.push(`Total: ${mods.length} mod${mods.length === 1 ? "" : "s"}.`);
  lines.push("");
  lines.push("| GUID | Name | Resolved | Source | Path |");
  lines.push("|---|---|---|---|---|");
  for (const m of mods) {
    const sym = m.resolved ? "yes" : "no";
    const source = m.source ?? "(not indexed)";
    const path = m.filePath ?? "(unknown)";
    const namePart = m.version ? `${m.name} (${m.version})` : m.name;
    lines.push(
      `| \`${m.modId}\` | ${escapeMd(namePart)} | ${sym} | ${source} | ${escapeMd(path)} |`,
    );
  }
  return lines.join("\n");
}

/** Escape `|` and backticks in markdown table cell content. */
function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

/**
 * End-to-end: read the redacted server config, resolve mods, return the
 * formatted report. The boundary keeps the raw config (passwords) entirely
 * inside redact-io.ts.
 */
export function buildModListReport(
  serverConfigPath: string,
  index: ProjectIndex,
): string {
  const { config, absolutePath } = readRedactedServerConfig(serverConfigPath);
  const mods = config.game.mods ?? [];
  const resolved = resolveMods(mods, (guid) => index.resolveGuid(guid));
  return formatModList({ configPath: absolutePath, mods: resolved });
}
