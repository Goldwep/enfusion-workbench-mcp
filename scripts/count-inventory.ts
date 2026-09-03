/**
 * Prints the inventory numbers quoted in README.md so they can be refreshed
 * from source instead of by hand:
 *
 *   npx tsx scripts/count-inventory.ts
 *
 * tools / prompts / resources — counted from register*( calls under src/
 * classes                     — data/api/arma-classes.json + enfusion-classes.json
 * wiki pages                  — data/wiki/pages.json
 * kb patterns                 — data/kb/index.json
 * tests                       — it(/test( calls in *.test.ts under tests/ and src/
 *                               (approximate: it.each / dynamic loops count once)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname ?? ".", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".claude" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function countMatches(files: string[], re: RegExp): number {
  let n = 0;
  for (const f of files) n += (readFileSync(f, "utf-8").match(re) ?? []).length;
  return n;
}

const srcFiles = walk(join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const testFiles = [...walk(join(ROOT, "tests")), ...walk(join(ROOT, "src"))].filter((f) =>
  /\.(test|spec)\.ts$/.test(f),
);

const jsonLen = (rel: string): number => (JSON.parse(readFileSync(join(ROOT, rel), "utf-8")) as unknown[]).length;

const arma = jsonLen("data/api/arma-classes.json");
const enfusion = jsonLen("data/api/enfusion-classes.json");

const rows: Array<[string, number | string]> = [
  ["tools", countMatches(srcFiles, /\.registerTool\(/g)],
  ["prompts", countMatches(srcFiles, /\.registerPrompt\(/g)],
  ["resources", countMatches(srcFiles, /\.registerResource\(/g)],
  ["classes (arma + enfusion)", `${arma + enfusion} (${arma} + ${enfusion})`],
  ["wiki pages", jsonLen("data/wiki/pages.json")],
  ["kb pattern entries", jsonLen("data/kb/index.json")],
  ["test files", testFiles.length],
  ["tests (approx, static it()/test() count)", countMatches(testFiles, /^\s*(it|test)(\.only|\.skip|\.each\([^)]*\))?\(/gm)],
];

for (const [k, v] of rows) console.log(`${k.padEnd(42)} ${v}`);
console.log("\nFor the exact vitest count: npx vitest run --pool=forks --poolOptions.forks.singleFork");
