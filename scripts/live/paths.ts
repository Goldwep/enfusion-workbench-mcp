/**
 * Harness paths and placeholder rewriting (plan 4.2 and 5.2).
 *
 * Raw material (registry exports, screenshots, raw probe output) lives in an
 * artifacts folder OUTSIDE every git working tree:
 *
 *   win32:     %LOCALAPPDATA%\enfusion-mcp\artifacts\
 *   elsewhere: ~/.local/share/enfusion-mcp/artifacts
 *   override:  ENFUSION_ARTIFACTS_DIR
 *
 * Anything the harness writes into the repository (evidence records, session
 * logs) has its absolute paths rewritten to placeholders first, so no account
 * name or machine-specific path reaches a commit.
 *
 * Usage: npx tsx scripts/live/paths.ts [artifacts | rewrite <text>]
 */

import { homedir } from "node:os";
import { dirname, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./cli.js";

// ── Names ────────────────────────────────────────────────────────────────────

/** The 2.0 sandbox addon (plan 5.1 "The sandbox"; working name). */
export const SANDBOX_NAME = "EMCP2_sandbox";

// ── Artifacts folder ─────────────────────────────────────────────────────────

/** Environment variable that overrides the artifacts folder. */
export const ARTIFACTS_ENV = "ENFUSION_ARTIFACTS_DIR";

/** Repository root, derived from this file's location (`<repo>/scripts/live/paths.ts`). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The artifacts folder for this host. Pure: every input is injectable so the
 * win32 form can be tested on any platform.
 */
export function artifactsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env[ARTIFACTS_ENV];
  if (override) return override;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return win32.join(localAppData, "enfusion-mcp", "artifacts");
  }
  return posix.join(home, ".local", "share", "enfusion-mcp", "artifacts");
}

// ── Placeholders ─────────────────────────────────────────────────────────────

/** Absolute paths to replace with their placeholder. Unset entries are ignored. */
export interface PlaceholderContext {
  /** Replaced with `%USERPROFILE%`. */
  userProfile?: string;
  /** Replaced with `%LOCALAPPDATA%`. */
  localAppData?: string;
  /** Main repository checkout, replaced with `<repo>`. */
  repo?: string;
  /** The 2.0 working tree, replaced with `<v2>`. */
  v2?: string;
  /** Arma Reforger Tools install, replaced with `<tools>`. */
  tools?: string;
  /** Arma Reforger game install, replaced with `<game>`. */
  game?: string;
  /** The 2.0 sandbox addon directory, replaced with `<sandbox>`. */
  sandbox?: string;
}

/** Most specific first: when two entries name the same path, the earlier one wins. */
const PLACEHOLDERS: ReadonlyArray<[keyof PlaceholderContext, string]> = [
  ["sandbox", "<sandbox>"],
  ["game", "<game>"],
  ["tools", "<tools>"],
  ["v2", "<v2>"],
  ["repo", "<repo>"],
  ["localAppData", "%LOCALAPPDATA%"],
  ["userProfile", "%USERPROFILE%"],
];

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

/**
 * Rewrite every known absolute path in `text` to its placeholder. The longest
 * match wins (so a sandbox under the user profile becomes `<sandbox>`, not
 * `%USERPROFILE%\...`), both slash styles and the JSON-escaped backslash form
 * are recognised, and matching ignores case because Windows paths do. A match
 * must end at a path boundary, so `<repo>` never eats the start of `repo2`.
 */
export function toPlaceholders(text: string, ctx: PlaceholderContext): string {
  const table = new Map<string, string>();
  for (const [key, placeholder] of PLACEHOLDERS) {
    const value = ctx[key];
    if (!value) continue;
    for (const s of spellings(value)) {
      const k = s.toLowerCase();
      if (!table.has(k)) table.set(k, placeholder);
    }
  }
  if (table.size === 0) return text;
  const alternatives = [...table.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = new RegExp(`(?:${alternatives.join("|")})(?![\\w-])`, "gi");
  return text.replace(re, (m) => table.get(m.toLowerCase()) ?? m);
}

/** Placeholder context from the environment and this repository's location. */
export function defaultPlaceholderContext(
  extra: PlaceholderContext = {},
  env: NodeJS.ProcessEnv = process.env,
): PlaceholderContext {
  return {
    userProfile: env.USERPROFILE || homedir(),
    localAppData: env.LOCALAPPDATA,
    repo: REPO_ROOT,
    ...extra,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "artifacts") {
    console.log(artifactsDir());
    return 0;
  }
  if (cmd === "rewrite") {
    console.log(toPlaceholders(rest.join(" "), defaultPlaceholderContext()));
    return 0;
  }
  console.error("Usage: paths.ts [artifacts | rewrite <text>]");
  return 2;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
