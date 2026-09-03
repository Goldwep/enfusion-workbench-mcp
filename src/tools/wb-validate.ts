/**
 * `wb_validate` — invoke Workbench's built-in material / texture validators.
 *
 * Pre-check added 2026-05-22 (post-v1.0.0 audit): the BI
 * `MaterialValidator.Get` and `TextureValidator.TextureImportSettings`
 * scripts throw VM exceptions ("Index out of bounds" / "NULL pointer to
 * instance. Variable 'meta'") when called with paths that don't resolve to
 * a real on-disk resource. We probe the path against the configured
 * project/workshop/core roots first and refuse the call if nothing
 * matches — this prevents the VM exception and the silent false-positive
 * "Valid" response that follows.
 *
 * See `docs/TEST-RESULTS.md` HIGH wb_validate finding.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { isPathInsideRoot } from "../utils/path-guard.js";

/** Heuristic: strip a leading `{16-hex}` resource-GUID prefix to get the
 *  on-disk path portion. */
function stripGuidPrefix(p: string): string {
  const m = /^\{[A-Fa-f0-9]{16}\}(.*)$/.exec(p);
  return m ? m[1] : p;
}

/** Resolve a resource path (absolute or root-relative) against the
 *  configured project / workshop / core roots. Returns the first
 *  on-disk path that exists, or `null` if nothing matches.
 *  Always returns a normalised absolute path on hit. */
export function resolveResourcePath(
  rawInput: string,
  config: Config,
): { resolved: string; root: "absolute" | "project" | "workshop" | "core" } | null {
  const stripped = stripGuidPrefix(rawInput);
  if (stripped === "") return null;

  // Known resource roots in priority order: user project, workshop, core.
  const roots: Array<{ key: "project" | "workshop" | "core"; path: string | undefined }> = [
    { key: "project", path: config.projectPath },
    { key: "workshop", path: config.workshopPath },
    { key: "core", path: config.corePath },
  ];

  // Absolute path — CWE-22 guard: only accept it if it lands inside one of
  // the configured roots. An absolute path pointing anywhere else on disk
  // is refused so we never hand an out-of-tree path to the BI validator.
  if (isAbsolute(stripped)) {
    const abs = resolve(stripped);
    const insideKnownRoot = roots.some((r) => r.path && isPathInsideRoot(abs, r.path));
    if (insideKnownRoot && existsSync(abs) && statSync(abs).isFile()) {
      return { resolved: abs, root: "absolute" };
    }
    return null;
  }

  // Root-relative path — CWE-22 guard: a `..`-laden input can escape a root
  // via `join`, so after building each candidate we assert it stays
  // contained within that root before trusting it. An escaping candidate is
  // skipped (not returned) — the resolved out-of-tree path must never reach
  // the validator.
  //
  // Project layouts can put resources either at `<root>/<path>` or
  // `<root>/<modName>/<path>`. Try the modName form first when
  // defaultMod is set — that matches what the Workbench API expects.
  for (const r of roots) {
    if (!r.path) continue;
    if (config.defaultMod) {
      const candidate = resolve(join(r.path, config.defaultMod, stripped));
      if (
        isPathInsideRoot(candidate, r.path) &&
        existsSync(candidate) &&
        statSync(candidate).isFile()
      ) {
        return { resolved: candidate, root: r.key };
      }
    }
    const direct = resolve(join(r.path, stripped));
    if (isPathInsideRoot(direct, r.path) && existsSync(direct) && statSync(direct).isFile()) {
      return { resolved: direct, root: r.key };
    }
  }

  return null;
}

/** Outcome of the pre-check: either a refusal (with a ready-to-emit message)
 *  or a resolved hit that the handler can pass to the BI validator. */
export type PrecheckResult =
  | { ok: true; hit: { resolved: string; root: "absolute" | "project" | "workshop" | "core" } }
  | { ok: false; text: string };

/**
 * Pre-check a `wb_validate` request before any handler call:
 *   1. Flag-smuggle guard — reject CLI-flag-shaped paths.
 *   2. Path-traversal / existence guard — resolve against known roots with
 *      containment enforced; refuse anything that escapes or doesn't exist.
 *
 * Pure (modulo fs existence checks) so it can be unit-tested directly. The
 * returned `text` is the body only — the caller appends connection status.
 */
export function precheckValidatePath(
  action: "material" | "texture",
  path: string,
  config: Config,
): PrecheckResult {
  // Flag-smuggle guard — reject CLI-flag-shaped paths BEFORE any path
  // resolution, matching the rest of the wb_* surface.
  if (path.startsWith("-")) {
    return { ok: false, text: "Invalid path: must not start with '-' (flag-smuggle guard)." };
  }

  // Pre-check: resolve against known resource roots with containment
  // enforced. Refuse if nothing matches (non-existent OR traversal-escaping)
  // — this is the v1.0.0 audit-fix plus the SEC-NEW-01 CWE-22 guard. Without
  // it, the BI MaterialValidator script throws an Index-out-of-bounds VM
  // exception (false-positive "Valid"), or an out-of-tree path reaches the
  // validator.
  const hit = resolveResourcePath(path, config);
  if (!hit) {
    const tried: string[] = [];
    if (config.projectPath) tried.push(`project: ${config.projectPath}`);
    if (config.workshopPath) tried.push(`workshop: ${config.workshopPath}`);
    if (config.corePath) tried.push(`core: ${config.corePath}`);
    return {
      ok: false,
      text:
        `**${action === "material" ? "Material" : "Texture"} Validation: Resource Not Found**\n\n` +
        `- **Path:** ${path}\n` +
        `- **Status:** Not found — refused before calling validator\n\n` +
        `Searched roots:\n${tried.map((t) => `  - ${t}`).join("\n")}\n\n` +
        `Pass an absolute path or a root-relative path that resolves to an existing file ` +
        `inside a known root (traversal-escaping paths are refused).`,
    };
  }

  return { ok: true, hit };
}

/**
 * Format the BI validator's response into a user-facing message + isError.
 *
 * Pure — no fs / network. Encodes the response-side defense:
 *   - empty / fieldless response  → "Inconclusive" + isError (the VM-exception
 *     false-positive fix);
 *   - `valid:false`               → "Failed";
 *   - `valid:true` / `success:true` with no errors → "Passed".
 *
 * The returned `text` is the body only — the caller appends connection status.
 */
/**
 * Coerce a JSON-ish truth flag. Booleans pass through; "true"/"false"
 * (any case), "1"/"0" and numbers map explicitly; anything else — absent,
 * null, or an unrecognised string — is `undefined` so the caller falls
 * through to the next field.
 */
export function coerceFlag(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1") return true;
    if (t === "false" || t === "0") return false;
  }
  return undefined;
}

export function formatValidationResult(
  action: "material" | "texture",
  path: string,
  hit: { resolved: string; root: "absolute" | "project" | "workshop" | "core" },
  result: Record<string, unknown>,
): { text: string; isError: boolean } {
  // Tightened response parsing — the previous default-to-true logic masked
  // VM exceptions as "Valid". Now: if the response carries no recognisable
  // fields, treat that as "validator returned nothing usable".
  const hasValid = Object.prototype.hasOwnProperty.call(result, "valid");
  const hasSuccess = Object.prototype.hasOwnProperty.call(result, "success");
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const hasInfo = Object.prototype.hasOwnProperty.call(result, "info");
  const anyMeaningfulField =
    hasValid || hasSuccess || errors.length > 0 || warnings.length > 0 || hasInfo;

  const label = action === "material" ? "Material" : "Texture";
  const lines: string[] = [];

  if (!anyMeaningfulField) {
    lines.push(`**${label} Validation: Inconclusive**\n`);
    lines.push(`- **Path:** ${path}`);
    lines.push(`- **Resolved:** ${hit.resolved} (root=${hit.root})`);
    lines.push("- **Status:** Validator returned no usable response.");
    lines.push(
      "  This is often a sign the BI script threw a Virtual Machine Exception " +
        "internally — check Workbench's script.log for `MaterialValidator.Get` / " +
        "`TextureValidator.TextureImportSettings` errors.",
    );
    return { text: lines.join("\n"), isError: true };
  }

  // cs17-6 (June review): the handler's JSON may carry `valid` as a
  // string ("false") or number (0) — a bare `as boolean` cast left the
  // string "false" truthy and reported "Passed". Coerce explicitly.
  const valid = coerceFlag(result.valid) ?? coerceFlag(result.success) ?? errors.length === 0;

  if (valid && errors.length === 0) {
    lines.push(`**${label} Validation Passed**\n`);
    lines.push(`- **Path:** ${path}`);
    lines.push(`- **Resolved:** ${hit.resolved} (root=${hit.root})`);
    lines.push("- **Status:** Valid");
  } else {
    lines.push(`**${label} Validation Failed**\n`);
    lines.push(`- **Path:** ${path}`);
    lines.push(`- **Resolved:** ${hit.resolved} (root=${hit.root})`);
    lines.push("- **Status:** Invalid");
  }

  if (errors.length > 0) {
    lines.push(`\n### Errors (${errors.length})`);
    for (const err of errors) {
      if (typeof err === "string") {
        lines.push(`- ${err}`);
      } else {
        const e = err as Record<string, unknown>;
        lines.push(`- ${e.message || JSON.stringify(e)}`);
      }
    }
  }

  if (warnings.length > 0) {
    lines.push(`\n### Warnings (${warnings.length})`);
    for (const warn of warnings) {
      if (typeof warn === "string") {
        lines.push(`- ${warn}`);
      } else {
        const w = warn as Record<string, unknown>;
        lines.push(`- ${w.message || JSON.stringify(w)}`);
      }
    }
  }

  if (hasInfo && result.info) {
    lines.push("\n### Info");
    lines.push(
      typeof result.info === "string" ? result.info : JSON.stringify(result.info, null, 2),
    );
  }

  return { text: lines.join("\n"), isError: !valid || errors.length > 0 };
}

export function registerWbValidate(
  server: McpServer,
  client: WorkbenchClient,
  config: Config,
): void {
  server.registerTool(
    "wb_validate",
    {
      description:
        "Validate a material or texture resource using the Workbench's built-in validators. " +
        "Pre-checks that the file exists under your project, workshop, or core roots before " +
        "calling the handler — non-existent paths return a structured 'resource not found' " +
        "error instead of silently triggering a script VM exception in `MaterialValidator.Get`. " +
        "Accepts absolute paths, root-relative paths (e.g. 'Materials/MyMat.emat'), or " +
        "`{GUID}path` resource refs (GUID prefix is stripped for the disk check).",
      inputSchema: {
        action: z.enum(["material", "texture"]).describe("Validator to run: material or texture"),
        path: z
          .string()
          .min(1)
          .describe(
            "Resource path to validate. Examples: 'Materials/MyMat.emat', " +
              "'{ABCDEF1234567890}Textures/MyTex.edds', or an absolute path. " +
              "Must not start with '-' (flag-smuggle guard).",
          ),
      },
    },
    async ({ action, path }) => {
      // Pre-check: flag-smuggle guard + traversal/existence resolution.
      // Refuses CLI-flag-shaped, non-existent, and traversal-escaping paths
      // BEFORE any handler call.
      const pre = precheckValidatePath(action, path, config);
      if (!pre.ok) {
        return {
          content: [
            { type: "text" as const, text: pre.text + formatConnectionStatus(client) },
          ],
          isError: true,
        };
      }
      const hit = pre.hit;

      try {
        const handlerName = action === "material" ? "MaterialValidator" : "TextureValidator";
        // Pass the resolved absolute path — the BI validator script
        // accepts both forms but absolute is unambiguous.
        const result = await client.call<Record<string, unknown>>(handlerName, {
          path: hit.resolved,
        });

        const { text, isError } = formatValidationResult(action, path, hit, result);
        return {
          content: [
            { type: "text" as const, text: text + formatConnectionStatus(client) },
          ],
          isError,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error validating ${action} "${path}": ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
