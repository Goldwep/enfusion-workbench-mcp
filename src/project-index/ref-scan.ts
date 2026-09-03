/**
 * Reference scanner for the project-index.
 *
 * Walks a pre-parsed Enfusion text tree and emits rows into the
 * `resource_refs` table. The caller supplies the parsed root so that the
 * resource scanner and ref scanner can share a single parse pass per file.
 *
 * Ref kinds:
 *   - `inheritance` — `node.inheritance` on any node (context = node.type).
 *   - `asset_path` — property value matching the GUID regex (context = property key).
 *   - `dep` — standalone value inside a `Dependencies` block under a
 *     `GameProject` root (context = "").
 *   - `value` — standalone value matching the GUID regex anywhere else
 *     (context = node.type).
 */

import Database from "better-sqlite3";
import type { EnfusionNode } from "../formats/enfusion-text.js";
import type { RefKind } from "./types.js";
import { logger } from "../utils/logger.js";

/** GUID reference shape: `{<16-hex>}<optional path suffix>`. */
const GUID_REF_RE = /^\{([0-9A-Fa-f]{16})\}(.*)$/;

/** Tally returned from a scan. */
export interface RefScanResult {
  /** Total rows emitted before dedup — includes ON CONFLICT-IGNORE'd inserts. */
  refsExtracted: number;
  /** Distinct rows for this source_file after the scan. */
  uniqueRefs: number;
}

interface PendingRef {
  targetGuid: string;
  refKind: RefKind;
  context: string;
}

/**
 * Scan a parsed Enfusion node tree for resource references and write them
 * into the `resource_refs` table.
 *
 * Existing rows for `(projectId, filePath)` are cleared first so re-scans
 * replace stale state. All inserts run inside a single transaction.
 *
 * Schema v3 (C2): `filePath` is relative to the OWNING project's root, so
 * every row — and the delete that precedes the re-insert — is scoped by
 * `projectId`. Two addons that both ship `Prefabs/Foo.et` no longer wipe
 * each other's refs.
 */
export function scanRefs(
  db: Database.Database,
  projectId: string,
  filePath: string,
  rootNode: EnfusionNode,
): RefScanResult {
  const refs: PendingRef[] = [];
  walk(rootNode, [], refs, filePath);

  const deleteStmt = db.prepare(
    "DELETE FROM resource_refs WHERE project_id = ? AND source_file = ?",
  );
  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?, ?)",
  );

  const writeTx = db.transaction((rows: PendingRef[]) => {
    deleteStmt.run(projectId, filePath);
    for (const ref of rows) {
      insertStmt.run(projectId, filePath, ref.targetGuid, ref.refKind, ref.context);
    }
  });
  writeTx(refs);

  const countRow = db
    .prepare(
      "SELECT COUNT(*) AS c FROM resource_refs WHERE project_id = ? AND source_file = ?",
    )
    .get(projectId, filePath) as { c: number };

  return {
    refsExtracted: refs.length,
    uniqueRefs: countRow.c,
  };
}

/**
 * Depth-first walk over the node tree. `ancestorTypes` is the stack of
 * node.type values from the root down to (but not including) `node`.
 */
function walk(
  node: EnfusionNode,
  ancestorTypes: string[],
  refs: PendingRef[],
  filePath: string,
): void {
  // Inheritance ref: emit one entry for the parent GUID.
  if (node.inheritance !== undefined) {
    const match = parseGuidRef(node.inheritance, filePath);
    if (match !== null) {
      refs.push({
        targetGuid: match,
        refKind: "inheritance",
        context: node.type,
      });
    }
  }

  // Properties — only string values can be asset-path refs.
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") continue;
    const match = parseGuidRef(prop.value, filePath);
    if (match !== null) {
      refs.push({
        targetGuid: match,
        refKind: "asset_path",
        context: prop.key,
      });
    }
  }

  // Standalone values — `dep` when inside a Dependencies block under a
  // GameProject root, otherwise `value` if the string matches the GUID regex.
  // The Dependencies node itself counts: its `values` are the dep list.
  const rootType = ancestorTypes.length > 0 ? ancestorTypes[0] : node.type;
  const inDependenciesBlock =
    rootType === "GameProject" &&
    (node.type === "Dependencies" || ancestorTypes.includes("Dependencies"));

  for (const val of node.values) {
    if (inDependenciesBlock) {
      // Dep entries are bare GUIDs (no braces) in the canonical .gproj form,
      // but tolerate the {GUID}path/ form too.
      const guidMatch = parseGuidRef(val, filePath);
      if (guidMatch !== null) {
        refs.push({ targetGuid: guidMatch, refKind: "dep", context: "" });
        continue;
      }
      if (/^[0-9A-Fa-f]{16}$/.test(val)) {
        refs.push({
          targetGuid: val.toUpperCase(),
          refKind: "dep",
          context: "",
        });
      }
      continue;
    }

    const match = parseGuidRef(val, filePath);
    if (match !== null) {
      refs.push({
        targetGuid: match,
        refKind: "value",
        context: node.type,
      });
    }
  }

  // Recurse into property nodes and children.
  const childAncestors = [...ancestorTypes, node.type];
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") {
      walk(prop.value, childAncestors, refs, filePath);
    }
  }
  for (const child of node.children) {
    walk(child, childAncestors, refs, filePath);
  }
}

/**
 * Parse a string as a GUID ref. Returns the uppercased 16-hex GUID on match,
 * `null` when the string is plainly not a ref. Logs a debug line when the
 * string looks like a ref attempt (`{...}`) but fails to match.
 */
function parseGuidRef(value: string, filePath: string): string | null {
  if (!value.startsWith("{")) return null;
  const m = GUID_REF_RE.exec(value);
  if (m === null) {
    logger.debug(`[ref-scan] bad GUID in ${filePath}: ${value}`);
    return null;
  }
  return m[1].toUpperCase();
}
