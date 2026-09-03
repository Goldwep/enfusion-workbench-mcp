/**
 * `material_diff` — semantic diff between two `.emat` material files.
 *
 * Compares the structural shape extracted from each material:
 *   - Shader class (root node type) and className qualifier.
 *   - Texture refs, keyed by their slot name (`Texture0`, `BaseTex`, etc).
 *   - Tunable parameters (every other root-level scalar property).
 *
 * Output is markdown with added / removed / changed sections — the
 * scenario_diff / world_diff pattern applied to materials. Pure file I/O,
 * no DB, no project-index required.
 *
 * Use this for "what changed when I retextured this material?" or "why
 * does the Beta-Branch version look different?" investigations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Shape ────────────────────────────────────────────────────────────────────

/**
 * Diff-ready shape of a material. Texture slots are keyed by slot name so
 * a slot whose value changed is reported as a "changed texture", not as
 * paired add/remove of different keys.
 */
export interface MaterialShape {
  shaderClass: string;
  className: string | null;
  inheritance: string | null;
  /** Slot name → raw texture ref string (e.g. `{GUID}path/foo.edds`). */
  textures: Record<string, string>;
  /** Parameter key → raw value, for everything that isn't a texture. */
  parameters: Record<string, string>;
}

/** Aggregate diff output. */
export interface MaterialDiffSummary {
  before: { path: string; shape: MaterialShape };
  after: { path: string; shape: MaterialShape };
  shaderClassChanged: boolean;
  classNameChanged: boolean;
  inheritanceChanged: boolean;
  texturesAdded: Array<{ key: string; value: string }>;
  texturesRemoved: Array<{ key: string; value: string }>;
  texturesChanged: Array<{ key: string; before: string; after: string }>;
  parametersAdded: Array<{ key: string; value: string }>;
  parametersRemoved: Array<{ key: string; value: string }>;
  parametersChanged: Array<{ key: string; before: string; after: string }>;
}

/** Recognize a property value as a texture-slot ref (matches material-inspect). */
const GUID_REF_RE = /^\{([0-9A-Fa-f]{16})\}(.*)$/;

function isTextureValue(value: string): boolean {
  const m = GUID_REF_RE.exec(value);
  if (m) {
    const suffix = m[2].toLowerCase();
    if (suffix.endsWith(".edds")) return true;
    return false;
  }
  return value.toLowerCase().endsWith(".edds");
}

// ── Extraction ───────────────────────────────────────────────────────────────

/**
 * Pure extraction. Nested sub-nodes are intentionally skipped — same scope as
 * `material_inspect` — so the diff stays scannable. Inheritance is hoisted to
 * its own field rather than buried in parameters.
 */
export function extractMaterialShape(root: EnfusionNode): MaterialShape {
  const textures: Record<string, string> = {};
  const parameters: Record<string, string> = {};
  for (const prop of root.properties) {
    if (typeof prop.value !== "string") continue;
    if (isTextureValue(prop.value)) {
      textures[prop.key] = prop.value;
    } else {
      parameters[prop.key] = prop.value;
    }
  }
  return {
    shaderClass: root.type,
    className: root.className ?? null,
    inheritance: root.inheritance ?? null,
    textures,
    parameters,
  };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/** Diff two key/value records into added / removed / changed. */
function diffRecords(
  before: Record<string, string>,
  after: Record<string, string>,
): {
  added: Array<{ key: string; value: string }>;
  removed: Array<{ key: string; value: string }>;
  changed: Array<{ key: string; before: string; after: string }>;
} {
  const added: Array<{ key: string; value: string }> = [];
  const removed: Array<{ key: string; value: string }> = [];
  const changed: Array<{ key: string; before: string; after: string }> = [];
  const allKeys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...allKeys].sort()) {
    const b = before[key];
    const a = after[key];
    if (b === undefined && a !== undefined) {
      added.push({ key, value: a });
    } else if (a === undefined && b !== undefined) {
      removed.push({ key, value: b });
    } else if (b !== a) {
      changed.push({ key, before: b, after: a });
    }
  }
  return { added, removed, changed };
}

/** Pure structural diff. No formatting, no I/O. */
export function diffMaterials(
  before: { path: string; shape: MaterialShape },
  after: { path: string; shape: MaterialShape },
): MaterialDiffSummary {
  const tex = diffRecords(before.shape.textures, after.shape.textures);
  const params = diffRecords(before.shape.parameters, after.shape.parameters);
  return {
    before,
    after,
    shaderClassChanged: before.shape.shaderClass !== after.shape.shaderClass,
    classNameChanged: before.shape.className !== after.shape.className,
    inheritanceChanged: before.shape.inheritance !== after.shape.inheritance,
    texturesAdded: tex.added,
    texturesRemoved: tex.removed,
    texturesChanged: tex.changed,
    parametersAdded: params.added,
    parametersRemoved: params.removed,
    parametersChanged: params.changed,
  };
}

// ── Formatter ────────────────────────────────────────────────────────────────

function fmtOr(v: string | null): string {
  return v ?? "(none)";
}

/** Render a `MaterialDiffSummary` as the markdown contract the tool documents. */
export function formatMaterialDiff(d: MaterialDiffSummary): string {
  const lines: string[] = [];
  const beforeName = basename(d.before.path);
  const afterName = basename(d.after.path);
  lines.push(`## Material diff: ${beforeName} -> ${afterName}`);
  lines.push("");

  lines.push(
    `- Shader class: ${d.before.shape.shaderClass} -> ${d.after.shape.shaderClass}  [${d.shaderClassChanged ? "CHANGED" : "unchanged"}]`,
  );
  lines.push(
    `- className: ${fmtOr(d.before.shape.className)} -> ${fmtOr(d.after.shape.className)}  [${d.classNameChanged ? "CHANGED" : "unchanged"}]`,
  );
  lines.push(
    `- Inheritance: ${fmtOr(d.before.shape.inheritance)} -> ${fmtOr(d.after.shape.inheritance)}  [${d.inheritanceChanged ? "CHANGED" : "unchanged"}]`,
  );

  const renderSection = (
    title: string,
    added: Array<{ key: string; value: string }>,
    removed: Array<{ key: string; value: string }>,
    changed: Array<{ key: string; before: string; after: string }>,
  ): void => {
    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      lines.push("");
      lines.push(`### ${title}`);
      lines.push("  (no changes)");
      return;
    }
    lines.push("");
    lines.push(`### ${title}`);
    if (added.length > 0) {
      lines.push(`  **Added (${added.length}):**`);
      for (const a of added) lines.push(`    + ${a.key} = "${a.value}"`);
    }
    if (removed.length > 0) {
      lines.push(`  **Removed (${removed.length}):**`);
      for (const r of removed) lines.push(`    - ${r.key} = "${r.value}"`);
    }
    if (changed.length > 0) {
      lines.push(`  **Changed (${changed.length}):**`);
      for (const c of changed) lines.push(`    ~ ${c.key}: "${c.before}" -> "${c.after}"`);
    }
  };

  renderSection(
    "Textures",
    d.texturesAdded,
    d.texturesRemoved,
    d.texturesChanged,
  );
  renderSection(
    "Parameters",
    d.parametersAdded,
    d.parametersRemoved,
    d.parametersChanged,
  );

  const anyChange =
    d.shaderClassChanged ||
    d.classNameChanged ||
    d.inheritanceChanged ||
    d.texturesAdded.length > 0 ||
    d.texturesRemoved.length > 0 ||
    d.texturesChanged.length > 0 ||
    d.parametersAdded.length > 0 ||
    d.parametersRemoved.length > 0 ||
    d.parametersChanged.length > 0;
  if (!anyChange) {
    lines.push("");
    lines.push("No semantic differences detected.");
  }
  return lines.join("\n");
}

// ── Error helper ─────────────────────────────────────────────────────────────

function errorResponse(msg: string) {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMaterialDiff(server: McpServer): void {
  server.registerTool(
    "material_diff",
    {
      description:
        "Compute a semantic diff between two Enfusion `.emat` material files. " +
        "Compares shader class, className, inheritance, texture slots (keyed by slot name), and tunable parameters, " +
        "reporting added / removed / changed entries in each bucket. " +
        "Use for reviewing material edits before merging from a beta branch, or for spotting unintended texture swaps. " +
        "Pure filesystem read - no project-index required.",
      inputSchema: {
        before_path: z
          .string()
          .describe("Absolute path to the BEFORE `.emat` file (e.g., main-branch version)."),
        after_path: z
          .string()
          .describe("Absolute path to the AFTER `.emat` file (e.g., Beta-Branch version)."),
      },
    },
    async ({ before_path, after_path }) => {
      try {
        // Audit-fix L4 SEC-001: flag-smuggle guard. Both paths interpolate
        // into error messages (and may flow into future shell-out paths).
        for (const [name, p] of [
          ["before_path", before_path] as const,
          ["after_path", after_path] as const,
        ]) {
          if (p.startsWith("-")) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error computing material diff: ${name} cannot start with '-': ${p}`,
                },
              ],
              isError: true,
            };
          }
        }
        let beforeContent: string;
        let afterContent: string;
        try {
          beforeContent = readFileSync(before_path, "utf-8");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error reading before_path "${before_path}": ${msg}`);
        }
        try {
          afterContent = readFileSync(after_path, "utf-8");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error reading after_path "${after_path}": ${msg}`);
        }

        let beforeRoot: EnfusionNode;
        let afterRoot: EnfusionNode;
        try {
          beforeRoot = parse(beforeContent);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error parsing before_path "${before_path}": ${msg}`);
        }
        try {
          afterRoot = parse(afterContent);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error parsing after_path "${after_path}": ${msg}`);
        }

        const summary = diffMaterials(
          { path: before_path, shape: extractMaterialShape(beforeRoot) },
          { path: after_path, shape: extractMaterialShape(afterRoot) },
        );

        return {
          content: [{ type: "text" as const, text: formatMaterialDiff(summary) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResponse(`Error computing material diff: ${msg}`);
      }
    },
  );
}
