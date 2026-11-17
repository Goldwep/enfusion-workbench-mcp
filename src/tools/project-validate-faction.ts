/**
 * Faction-scope validator — invoked by `project_validate` when
 * `scope=faction`. Per the dispatch convention established in
 * `project-validate.ts`, the per-scope module exports a `validate<Scope>`
 * function that returns `ValidationFinding[]`; the dispatcher reformats
 * them for the consolidated output.
 *
 * Rules:
 *   F1: `FactionKey` present; `FactionColor` and `UIInfo` present unless the
 *       file inherits (`SCR_Faction : "<parent>.conf"`, as vanilla US.conf does);
 *       the member-style names `m_sFactionKey` / `m_sFactionName` /
 *       `m_FactionColor` that older faction_create output used are flagged,
 *       because the engine loads the file and ignores them (W11 run 6)
 *   F2: `FactionKey` matches /^[A-Z][A-Z0-9_]{1,15}$/
 *   F3: `FactionColor` is four floats in [0, 1] (vanilla: `0.016 0.552 0.905 1`)
 *   F4: no duplicate `FactionKey` across all faction .conf files in the
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

/** Member-style names the engine ignores on SCR_Faction, mapped to the attribute it holds. */
const IGNORED_FACTION_NAMES: Record<string, string> = {
  m_sFactionKey: "FactionKey",
  m_sFactionName: "UIInfo SCR_FactionUIInfo { Name }",
  m_FactionColor: "FactionColor",
  m_sKey: "FactionKey",
  m_sName: "UIInfo SCR_FactionUIInfo { Name }",
  m_Color: "FactionColor",
  m_sFlagPath: "m_sFactionFlag",
};

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
 * Extract the `FactionKey` value from a parsed SCR_Faction node, or null
 * if the node isn't a faction or the key is missing.
 */
function extractFactionKeyFromConfRoot(root: EnfusionNode): string | null {
  if (root.type !== "SCR_Faction") return null;
  return getStringProp(root, "FactionKey");
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

  // F1: ignored member-style names (written by older faction_create/config_create)
  const present = new Set([
    ...root.properties.map((p) => p.key),
    ...root.children.map((c) => c.type),
  ]);
  for (const [bad, good] of Object.entries(IGNORED_FACTION_NAMES)) {
    if (!present.has(bad)) continue;
    findings.push({
      severity: "error",
      path: bad,
      message: `'${bad}' is not an SCR_Faction attribute; the engine ignores it`,
      hint: `Use ${good}, as vanilla Configs/Factions/*.conf do.`,
    });
  }

  // F1: required attributes. An inheriting file takes the parent's values.
  const inherits = root.inheritance !== undefined;
  const key = getStringProp(root, "FactionKey");
  if (key === null || key.length === 0) {
    findings.push({
      severity: inherits ? "warning" : "error",
      path: "FactionKey",
      message: "Required field missing or empty",
    });
  }
  const color = getStringProp(root, "FactionColor");
  if (color === null && !inherits) {
    findings.push({
      severity: "warning",
      path: "FactionColor",
      message: "FactionColor missing",
      hint: "Four 0-1 floats R G B A, e.g. FactionColor 0.016 0.552 0.905 1",
    });
  }
  const ui = getChildByType(root, "UIInfo");
  if (ui === null && !inherits) {
    findings.push({
      severity: "warning",
      path: "UIInfo",
      message: "UIInfo missing: the faction has no display name",
      hint: 'Add UIInfo SCR_FactionUIInfo { Name "<display name>" }',
    });
  }

  // F2: key shape
  if (key !== null && key.length > 0 && !FACTION_KEY_RE.test(key)) {
    findings.push({
      severity: "error",
      path: "FactionKey",
      message: `Key "${key}" must match /^[A-Z][A-Z0-9_]{1,15}$/`,
      hint: "Keys are case-sensitive and used in scripts and component refs — uppercase + digits + underscore only.",
    });
  }

  // F3: FactionColor is an inline vector of four 0-1 floats.
  if (color !== null) {
    const parts = color.trim().split(/\s+/);
    const nums = parts.map(Number);
    if (parts.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
      findings.push({
        severity: "error",
        path: "FactionColor",
        message: `FactionColor "${color}" is not four numbers (R G B A)`,
      });
    } else if (nums.some((n) => n < 0 || n > 1)) {
      findings.push({
        severity: "error",
        path: "FactionColor",
        message: `FactionColor "${color}" has a channel outside [0, 1]`,
        hint: "Channels are floats 0-1, not 0-255.",
      });
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
        path: `${relDup}:FactionKey`,
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
          path: `${rel}:FactionKey`,
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
