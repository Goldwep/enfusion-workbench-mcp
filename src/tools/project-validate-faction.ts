/**
 * Faction-scope validator — invoked by `project_validate` when
 * `scope=faction`. Per the dispatch convention established in
 * `project-validate.ts`, the per-scope module exports a `validate<Scope>`
 * function that returns `ValidationFinding[]`; the dispatcher reformats
 * them for the consolidated output.
 *
 * Rules:
 *   F1: required fields (`m_sFactionKey`, `m_sFactionName`, `m_FactionColor`)
 *   F2: `m_sFactionKey` matches /^[A-Z][A-Z0-9_]{1,15}$/
 *   F3: color R/G/B values in [0, 255]
 *   F4: no duplicate `m_sFactionKey` across all faction .conf files in the
 *       project — surfaced as warnings on the second-and-later instances
 *   F5: faction key referenced by at least one entity/prefab — surfaced as
 *       a warning ("orphan faction") if not
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import {
  parse,
  type EnfusionNode,
} from "../formats/enfusion-text.js";
import { walkFactionCatalog } from "../faction/catalog-walker.js";
import { logger } from "../utils/logger.js";

// ── Local re-shape (avoids cyclic import on project-validate.ts) ──────────────

export interface FactionValidationFinding {
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
  hint?: string;
}

// ── Shared constants ──────────────────────────────────────────────────────────

/** Must match `faction-create.ts` FACTION_KEY_RE. Kept in sync by lockstep edit. */
const FACTION_KEY_RE = /^[A-Z][A-Z0-9_]{1,15}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read a string property off a node. */
function getStringProp(node: EnfusionNode, key: string): string | null {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop || typeof prop.value !== "string") return null;
  return prop.value;
}

/** Read a child node by type. */
function getChildByType(node: EnfusionNode, type: string): EnfusionNode | null {
  return node.children.find((c) => c.type === type) ?? null;
}

/** Parse an integer color channel, returning null when not a clean integer. */
function parseChannel(raw: string | null): number | null {
  if (raw === null) return null;
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v) || String(v) !== raw.trim()) return null;
  return v;
}

/**
 * Walk a directory for `.conf` files. Used to find sibling faction configs
 * for the duplicate-key check. Skips heavy dirs the same way the catalog
 * walker does. Returns absolute paths.
 */
function* walkConfFiles(root: string): Generator<string> {
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vs", ".cache"]);
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    /* unreadable directory — skip */
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkConfFiles(full);
    } else if (st.isFile() && extname(name).toLowerCase() === ".conf") {
      yield full;
    }
  }
}

/**
 * Extract the `m_sFactionKey` value from a parsed SCR_Faction node, or null
 * if the node isn't a faction or the key is missing.
 */
function extractFactionKeyFromConfRoot(root: EnfusionNode): string | null {
  if (root.type !== "SCR_Faction") return null;
  return getStringProp(root, "m_sFactionKey");
}

// ── Per-file validation (rules F1-F3) ─────────────────────────────────────────

/**
 * Validate a single faction .conf file against rules F1-F3. The
 * project-wide rules (F4 duplicate, F5 orphan) require cross-file context
 * and are layered on top in `validateFaction`.
 */
export function validateFactionFile(
  filePath: string,
  content: string,
): FactionValidationFinding[] {
  const findings: FactionValidationFinding[] = [];
  let root: EnfusionNode;
  try {
    root = parse(content);
  } catch (e) {
    findings.push({
      severity: "error",
      path: filePath,
      message: `Cannot parse: ${e instanceof Error ? e.message : String(e)}`,
    });
    return findings;
  }

  if (root.type !== "SCR_Faction") {
    findings.push({
      severity: "error",
      path: "(root)",
      message: `Root type '${root.type}' is not 'SCR_Faction' — this file may not be a faction config`,
      hint: "If this is the legacy m_sKey/m_sName/m_Color shape, validate it with scope=scenario or by hand.",
    });
    return findings;
  }

  // F1: required fields present
  const key = getStringProp(root, "m_sFactionKey");
  if (key === null || key.length === 0) {
    findings.push({
      severity: "error",
      path: "m_sFactionKey",
      message: "Required field missing or empty",
    });
  }
  const name = getStringProp(root, "m_sFactionName");
  if (name === null || name.length === 0) {
    findings.push({
      severity: "error",
      path: "m_sFactionName",
      message: "Required field missing or empty",
    });
  }
  const colorNode = getChildByType(root, "m_FactionColor");
  if (colorNode === null) {
    findings.push({
      severity: "error",
      path: "m_FactionColor",
      message: "Required block missing",
    });
  }

  // F2: key shape
  if (key !== null && key.length > 0 && !FACTION_KEY_RE.test(key)) {
    findings.push({
      severity: "error",
      path: "m_sFactionKey",
      message: `Key "${key}" must match /^[A-Z][A-Z0-9_]{1,15}$/`,
      hint: "Keys are case-sensitive and used in scripts and component refs — uppercase + digits + underscore only.",
    });
  }

  // F3: color channel ranges. Each channel is a key on the m_FactionColor
  // child node — values are strings emitted as bare numbers, but the parser
  // gives them back as strings; we re-parse here.
  if (colorNode !== null) {
    for (const channel of ["R", "G", "B"]) {
      const raw = getStringProp(colorNode, channel);
      if (raw === null) {
        findings.push({
          severity: "warning",
          path: `m_FactionColor.${channel}`,
          message: "Channel missing",
          hint: "Defaults to 0 in the engine, but explicit is better.",
        });
        continue;
      }
      const v = parseChannel(raw);
      if (v === null) {
        findings.push({
          severity: "error",
          path: `m_FactionColor.${channel}`,
          message: `Channel value "${raw}" is not an integer`,
        });
        continue;
      }
      if (v < 0 || v > 255) {
        findings.push({
          severity: "error",
          path: `m_FactionColor.${channel}`,
          message: `Channel value ${v} out of range [0, 255]`,
        });
      }
    }
  }

  return findings;
}

// ── Project-wide validation (rules F4, F5) ────────────────────────────────────

/**
 * Validate `targetPath` (a .conf or its containing project root) against
 * the full F1-F5 ruleset. When `targetPath` points at a .conf, that file
 * is validated F1-F3 and the project root (parent of `Configs/Factions/`)
 * is walked for F4/F5. When `targetPath` is a directory, every faction
 * .conf under it is validated.
 *
 * The project root for F4/F5 derivation: we look for the nearest ancestor
 * that contains a `Configs` subdir or that ends in `addons/<name>`. As a
 * fallback we treat the file's grandparent (typical `Configs/Factions/X.conf`
 * → grandparent = project root) as the root.
 */
export function validateFaction(targetPath: string): FactionValidationFinding[] {
  const findings: FactionValidationFinding[] = [];

  if (!existsSync(targetPath)) {
    return [
      { severity: "error", path: targetPath, message: "Path not found" },
    ];
  }

  const stat = statSync(targetPath);
  let projectRoot: string;
  let primaryConfPath: string | null;

  if (stat.isFile()) {
    if (extname(targetPath).toLowerCase() !== ".conf") {
      return [
        {
          severity: "error",
          path: targetPath,
          message: "scope=faction expects a .conf file or a project root directory",
        },
      ];
    }
    primaryConfPath = targetPath;
    // Derive project root: <root>/Configs/Factions/X.conf → root is the
    // grandparent of grandparent. Walk up two dirs when the file is in
    // Configs/Factions/.
    const parts = targetPath.split(/[\\/]/);
    const factionsIdx = parts.lastIndexOf("Factions");
    if (factionsIdx >= 2 && parts[factionsIdx - 1] === "Configs") {
      projectRoot = parts.slice(0, factionsIdx - 1).join("/");
    } else {
      // Fall back: just use the parent dir; the F4/F5 scan will be narrow.
      projectRoot = targetPath.split(/[\\/]/).slice(0, -1).join("/");
    }
  } else if (stat.isDirectory()) {
    projectRoot = targetPath;
    primaryConfPath = null;
  } else {
    return [
      {
        severity: "error",
        path: targetPath,
        message: "Path is neither a regular file nor a directory",
      },
    ];
  }

  // ── F1-F3: per-file validation ─────────────────────────────────────────────
  const factionsDir = join(projectRoot, "Configs", "Factions");
  const factionFiles: { path: string; key: string | null }[] = [];

  // Always validate the primary file if one was supplied directly.
  const seen = new Set<string>();
  const collectAndValidate = (filePath: string): void => {
    const norm = filePath.split("\\").join("/");
    if (seen.has(norm)) return;
    seen.add(norm);
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch (e) {
      findings.push({
        severity: "warning",
        path: relative(projectRoot, filePath).split("\\").join("/"),
        message: `Cannot read file: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }
    const fileFindings = validateFactionFile(filePath, content);
    const relPath = relative(projectRoot, filePath).split("\\").join("/");
    // Prefix per-file findings with the relative path so dispatcher output
    // is unambiguous when multiple files are validated in one call.
    for (const f of fileFindings) {
      findings.push({
        severity: f.severity,
        path: `${relPath}:${f.path}`,
        message: f.message,
        hint: f.hint,
      });
    }
    // Capture the key (or null) for F4 duplicate check.
    try {
      const root = parse(content);
      factionFiles.push({
        path: filePath,
        key: extractFactionKeyFromConfRoot(root),
      });
    } catch {
      /* per-file parse error already surfaced above */
    }
  };

  if (primaryConfPath !== null) {
    collectAndValidate(primaryConfPath);
  }
  if (existsSync(factionsDir)) {
    for (const fp of walkConfFiles(factionsDir)) {
      collectAndValidate(fp);
    }
  }

  // ── F4: duplicate keys across project ──────────────────────────────────────
  const keyToFiles = new Map<string, string[]>();
  for (const f of factionFiles) {
    if (f.key === null || f.key.length === 0) continue;
    const list = keyToFiles.get(f.key);
    if (list) list.push(f.path);
    else keyToFiles.set(f.key, [f.path]);
  }
  for (const [key, files] of keyToFiles) {
    if (files.length < 2) continue;
    // Emit one warning per duplicate-additional file, pointed at the dup.
    for (let i = 1; i < files.length; i++) {
      const relDup = relative(projectRoot, files[i]).split("\\").join("/");
      const relFirst = relative(projectRoot, files[0]).split("\\").join("/");
      findings.push({
        severity: "error",
        path: `${relDup}:m_sFactionKey`,
        message: `Duplicate faction key "${key}" — first seen in ${relFirst}`,
        hint: "Faction keys must be unique within a project.",
      });
    }
  }

  // ── F5: orphan-faction check ───────────────────────────────────────────────
  // Walk the project for SCR_FactionAffiliationComponent references. A
  // faction is "orphan" if its key never appears in the entity walk. We
  // only emit one warning per faction (not per file) to keep the report
  // readable.
  try {
    const walk = walkFactionCatalog(projectRoot);
    const referencedKeys = new Set(walk.units.map((u) => u.factionKey));
    for (const f of factionFiles) {
      if (f.key === null || f.key.length === 0) continue;
      if (!referencedKeys.has(f.key)) {
        const rel = relative(projectRoot, f.path).split("\\").join("/");
        findings.push({
          severity: "warning",
          path: `${rel}:m_sFactionKey`,
          message: `Orphan faction "${f.key}": no entity in the project references this key via "faction affiliation"`,
          hint:
            "Either no entity is bound to this faction yet, or affiliations are inherited from prefabs " +
            "(the walker does not chase inheritance — so this can be a false positive).",
        });
      }
    }
  } catch (e) {
    // Catalog walk failures shouldn't fail the whole validation — log only.
    logger.debug(
      `[faction-validate] catalog walk failed (skipping F5): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return findings;
}
