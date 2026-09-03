/**
 * `inheritance_chain` — walk a resource's parent chain up to the root.
 *
 * Useful for debugging "what does this class actually inherit?" questions
 * — particularly across multiple files in a deep prefab hierarchy.
 *
 * Not paginated: a chain is at most ~32 deep in practice. The walker stops
 * naturally at: a root, an unresolvable parent, maxDepth, or a cycle.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectIndex, type InheritanceChain } from "../project-index/project-index.js";

// ── Normalizer (shared shape with resolve-guid) ──────────────────────────────

export function normalizeGuid(raw: string): string {
  const stripped = raw.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!/^[0-9A-Fa-f]{16}$/.test(stripped)) {
    throw new Error(
      `Invalid GUID "${raw}": expected 16 hex characters, with or without braces`,
    );
  }
  return stripped.toUpperCase();
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatChain(input: {
  startGuid: string;
  chain: InheritanceChain;
}): string {
  const { startGuid, chain } = input;
  const lines: string[] = [];
  lines.push(`## Inheritance chain from {${startGuid}}`);
  lines.push("");
  if (chain.steps.length === 0) {
    lines.push(`(empty — start GUID is not indexed)`);
    if (chain.unresolvedParent) {
      lines.push(`Unresolved: {${chain.unresolvedParent}}`);
    }
    return lines.join("\n");
  }

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    const indent = "  ".repeat(i);
    const arrow = i === 0 ? "" : "↑ ";
    const cls = step.class_name ? ` [${step.class_name}]` : "";
    lines.push(
      `${indent}${arrow}${step.file_path} — ${step.root_type}${cls} {${step.guid}}`,
    );
  }

  lines.push("");
  lines.push(`depth: ${chain.steps.length}`);
  if (chain.truncated) {
    lines.push(
      "TRUNCATED: walker stopped at max_depth. Increase max_depth to see more.",
    );
  }
  if (chain.cycleDetected) {
    lines.push(
      "CYCLE DETECTED: this is broken data — a resource ultimately inherits from itself.",
    );
  }
  if (chain.unresolvedParent) {
    lines.push(
      `UNRESOLVED: chain ended at {${chain.unresolvedParent}} (not in project-index — likely an unindexed dependency).`,
    );
  }
  if (
    !chain.truncated &&
    !chain.cycleDetected &&
    !chain.unresolvedParent &&
    chain.steps.length > 0
  ) {
    lines.push("(reached root)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerInheritanceChain(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "inheritance_chain",
    {
      description:
        "Walk a resource's `: { ParentRef }` chain up to the root. " +
        "Returns each step (file, type, class, GUID) plus flags for truncation / cycles / unresolved parents. " +
        "Use to answer 'what does this prefab/config ultimately inherit from?' across deep hierarchies.",
      inputSchema: {
        guid: z
          .string()
          .describe("Starting GUID — 16 hex chars, with or without braces"),
        max_depth: z
          .number()
          .min(1)
          .max(256)
          .default(32)
          .describe("Stop after this many steps (default 32, max 256)"),
      },
    },
    async ({ guid, max_depth }) => {
      try {
        const normalized = normalizeGuid(guid);
        const chain = index.inheritanceChain(normalized, max_depth);
        const text = formatChain({ startGuid: normalized, chain });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error walking inheritance chain: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
