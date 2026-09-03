/**
 * `weapon_pose_lint` — pure logic.
 *
 * String-level lint of a character `.agr` (Animation Graph Runtime) file
 * against the `GlobalTags { "WEAPON" "ADS" "STANCE" ... }` block.
 * Intentionally regex-only per `docs/L8-PLAN.md:69` — no Enforce parser.
 * The check is conservative on purpose: AGR files are author-edited text
 * and we'd rather flag a missing tag than dive into the full graph parser
 * and miss the case where the block is syntactically off but the tag set
 * is still readable.
 *
 * Severity:
 *   - missing tag → error
 *   - unknown tag (in AGR but not in expected set) → warning
 */

/** Default expected tag set for a character AGR. */
export const DEFAULT_EXPECTED_TAGS: readonly string[] = [
  "WEAPON",
  "ADS",
  "STANCE",
  "CROUCH",
  "PRONE",
  "RELOAD",
];

export type Severity = "error" | "warning";

export interface PoseLintFinding {
  severity: Severity;
  /** The tag name the finding pertains to. */
  tag: string;
  /** Human-readable explanation. */
  message: string;
}

export interface PoseLintResult {
  /** Tags found in the AGR's `GlobalTags { ... }` block, in source order. */
  foundTags: string[];
  /** Expected tags that were not found. */
  missingTags: string[];
  /** Found tags not in the expected list (warnings, not errors). */
  unknownTags: string[];
  /** Whether a `GlobalTags { ... }` block was located at all. */
  globalTagsBlockFound: boolean;
  /** Flat findings list with severities for direct rendering. */
  findings: PoseLintFinding[];
  /** Quick pass/fail summary: true iff zero errors. */
  ok: boolean;
}

/**
 * Locate the body of the FIRST `GlobalTags { ... }` block via brace-matching.
 * Returns null when no block is present. Tolerant of arbitrary whitespace and
 * newlines between the keyword and the opening brace.
 *
 * We brace-match (rather than regex-capture-content) so the block can contain
 * nested braces without aborting — defensive even though AGR `GlobalTags`
 * blocks normally hold only quoted strings.
 */
export function extractGlobalTagsBody(content: string): string | null {
  const re = /\bGlobalTags\b[ \t\r\n]*\{/g;
  const m = re.exec(content);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1; // index of the `{`
  let depth = 1;
  let i = openIdx + 1;
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  if (depth !== 0) return null; // unbalanced — treat as malformed
  return content.slice(openIdx + 1, i - 1);
}

/**
 * Extract every quoted string token from `body`. Order-preserving and
 * de-duplicated; comparison against expected tags is case-sensitive (matches
 * the engine's behavior — tags like `WEAPON` and `Weapon` are distinct).
 */
export function tokenizeQuotedStrings(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /"([^"\n\r]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tok = m[1];
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/**
 * Run the lint pass over raw AGR text. Caller is responsible for I/O — pass
 * `content` directly. `expectedTags` defaults to the character-AGR set; pass
 * a custom list to lint against a different profile (e.g. weapon prefab AGR
 * has its own canonical tag set).
 */
export function lintWeaponPose(content: string, expectedTags: readonly string[] = DEFAULT_EXPECTED_TAGS): PoseLintResult {
  const body = extractGlobalTagsBody(content);
  const findings: PoseLintFinding[] = [];

  if (body === null) {
    // No GlobalTags block at all — every expected tag is "missing".
    const missing = [...expectedTags];
    for (const t of missing) {
      findings.push({
        severity: "error",
        tag: t,
        message: `Missing tag "${t}" — no GlobalTags { ... } block found in AGR`,
      });
    }
    return {
      foundTags: [],
      missingTags: missing,
      unknownTags: [],
      globalTagsBlockFound: false,
      findings,
      ok: missing.length === 0,
    };
  }

  const found = tokenizeQuotedStrings(body);
  const foundSet = new Set(found);
  const expectedSet = new Set(expectedTags);

  const missingTags = expectedTags.filter((t) => !foundSet.has(t));
  const unknownTags = found.filter((t) => !expectedSet.has(t));

  for (const t of missingTags) {
    findings.push({
      severity: "error",
      tag: t,
      message: `Missing tag "${t}" — expected in GlobalTags block`,
    });
  }
  for (const t of unknownTags) {
    findings.push({
      severity: "warning",
      tag: t,
      message: `Unknown tag "${t}" — not in expected set; may be project-specific`,
    });
  }

  return {
    foundTags: found,
    missingTags,
    unknownTags,
    globalTagsBlockFound: true,
    findings,
    ok: missingTags.length === 0,
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatPoseLintMarkdown(input: {
  filePath: string;
  result: PoseLintResult;
}): string {
  const { filePath, result } = input;
  const lines: string[] = [];
  lines.push(`## weapon_pose_lint: ${filePath}`);
  lines.push("");

  if (!result.globalTagsBlockFound) {
    lines.push(
      `Status: FAILED — no GlobalTags { ... } block found in AGR (${result.missingTags.length} expected tag(s) effectively missing)`,
    );
    lines.push("");
    lines.push("### Missing tags (error)");
    for (const t of result.missingTags) lines.push(`- ${t}`);
    return lines.join("\n");
  }

  if (result.ok && result.unknownTags.length === 0) {
    lines.push("Status: OK (all expected tags present, no unknown tags)");
  } else if (result.ok) {
    lines.push(`Status: OK (all expected tags present; ${result.unknownTags.length} unknown tag warning(s))`);
  } else {
    lines.push(`Status: FAILED (${result.missingTags.length} missing tag(s))`);
  }
  lines.push("");

  if (result.missingTags.length > 0) {
    lines.push("### Missing tags (error)");
    for (const t of result.missingTags) lines.push(`- ${t}`);
    lines.push("");
  }

  lines.push("### Found tags");
  lines.push(result.foundTags.length > 0 ? result.foundTags.join(", ") : "(none)");
  lines.push("");

  if (result.unknownTags.length > 0) {
    lines.push("### Unknown tags (warning)");
    for (const t of result.unknownTags) {
      lines.push(`- ${t} (not in expected set; may be project-specific)`);
    }
  }

  return lines.join("\n");
}
