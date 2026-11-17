/**
 * The 2.0 sandbox generator (plan 5.1 "The sandbox", Phase 0 item 7).
 *
 * Creates `<addons>/EMCP2_sandbox` (`--dir` overrides the full directory;
 * the default addons directory is `loadConfig().projectPath`) holding:
 *   - `EMCP2_sandbox.gproj` from the repository's project template
 *     (`generateGproj`), with the base game as its only dependency;
 *   - `.gitignore` ignoring the handler folders, `resourceDatabase.rdb`,
 *     `Backup/` and `*.bak`;
 *   - its own git repository with one initial commit.
 *
 * "Clean" (plan 5.1) means `git status --short` is empty there and no handler
 * file is tracked. Refuses when the directory exists and is not empty. Does
 * not create the worlds: the owner makes them in the GUI (OA-3), or the S-E
 * probe does.
 *
 * Usage: npx tsx scripts/live/create-sandbox.ts [--dir <sandbox dir>]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config.js";
import { generateGproj } from "../../src/templates/gproj.js";
import { isMainModule, parseArgs } from "./cli.js";
import { SANDBOX_NAME } from "./paths.js";

/** Title written into the sandbox `.gproj`. */
export const SANDBOX_TITLE = "EMCP2 sandbox (2.0 live lane)";

/** `.gitignore` content (plan 5.1: handler folders and resourceDatabase.rdb ignored). */
export const SANDBOX_GITIGNORE = [
  "# Handler sets are installed by the harness and never tracked (plan 5.1).",
  "Scripts/WorkbenchGame/EnfusionMCP/",
  "Scripts/WorkbenchGame/EnfusionCensus/",
  "resourceDatabase.rdb",
  "Backup/",
  "*.bak",
  "",
].join("\n");

/**
 * Identity used for the initial commit only when git has none configured.
 * Passed through the environment for that one command; git config is never
 * written.
 */
const FALLBACK_IDENTITY = { name: "EMCP2 sandbox", email: "emcp2-sandbox@localhost" };

export interface SandboxResult {
  dir: string;
  gprojPath: string;
  commit: string;
}

/** The owner's next step after creation (plan 15, OA-3). */
export function nextStepText(gprojPath: string): string {
  return [
    `Sandbox project: ${gprojPath}`,
    "Next step (owner, OA-3): open this .gproj once from the Enfusion Workbench launcher so the",
    "launcher knows the project (required before session S-A), then create the tiny standalone",
    "world and the small terrain world in it in the GUI (before session S-C). If the worlds are",
    "not made, the S-E probe creates them.",
  ].join("\n");
}

function git(dir: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: env ?? process.env,
  }).trim();
}

function hasConfiguredIdentity(dir: string): boolean {
  try {
    return (
      git(dir, ["config", "user.email"]).length > 0 && git(dir, ["config", "user.name"]).length > 0
    );
  } catch {
    return false;
  }
}

/** Create the sandbox in `dir`. Throws when `dir` exists and is not an empty directory. */
export function createSandbox(dir: string): SandboxResult {
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new Error(`${dir} exists and is not a directory`);
    if (readdirSync(dir).length > 0) {
      throw new Error(`Refusing to create the sandbox: ${dir} exists and is not empty`);
    }
  }
  mkdirSync(dir, { recursive: true });

  const gprojPath = join(dir, `${SANDBOX_NAME}.gproj`);
  writeFileSync(gprojPath, generateGproj({ name: SANDBOX_NAME, title: SANDBOX_TITLE }), "utf-8");
  writeFileSync(join(dir, ".gitignore"), SANDBOX_GITIGNORE, "utf-8");

  git(dir, ["init", "-q"]);
  git(dir, ["add", "--", ".gitignore", `${SANDBOX_NAME}.gproj`]);
  const env = hasConfiguredIdentity(dir)
    ? process.env
    : {
        ...process.env,
        GIT_AUTHOR_NAME: FALLBACK_IDENTITY.name,
        GIT_AUTHOR_EMAIL: FALLBACK_IDENTITY.email,
        GIT_COMMITTER_NAME: FALLBACK_IDENTITY.name,
        GIT_COMMITTER_EMAIL: FALLBACK_IDENTITY.email,
      };
  // `-c commit.gpgsign=false` applies to this one command only, so a signing
  // setup cannot block on a passphrase prompt; no config file is written.
  git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "EMCP2 sandbox baseline"], env);
  const commit = git(dir, ["rev-parse", "HEAD"]);
  return { dir, gprojPath, commit };
}

export function main(argv: string[]): number {
  try {
    const args = parseArgs(argv, ["dir"]);
    const dir = args.options.dir ?? join(loadConfig().projectPath, SANDBOX_NAME);
    const r = createSandbox(dir);
    console.log(`created ${r.dir} (initial commit ${r.commit.slice(0, 12)})`);
    console.log(nextStepText(r.gprojPath));
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
