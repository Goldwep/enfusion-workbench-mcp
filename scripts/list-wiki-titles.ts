/**
 * Prints the wiki page titles currently cached in data/wiki/pages.json,
 * in the exact form MediaWiki's Special:Export expects (one title per line).
 *
 * Usage: npx tsx scripts/list-wiki-titles.ts
 *
 * Paste the output into https://community.bistudio.com/wiki/Special:Export
 * to re-export the current page set. See docs/UPDATE-PLAYBOOK.md § "Refresh
 * the wiki knowledge base" for the full manual-refresh procedure (Cloudflare
 * blocks automated scraping as of 2026-08-12, so the export is a browser step).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGES_PATH = join(import.meta.dirname, "..", "data", "wiki", "pages.json");
const URL_PREFIX = "https://community.bistudio.com/wiki/";

interface WikiPage {
  title: string;
  source: string;
  content: string;
  url: string;
}

const pages: WikiPage[] = JSON.parse(readFileSync(PAGES_PATH, "utf-8"));

const titles = pages
  .filter((p) => p.source === "bistudio-wiki" && p.url.startsWith(URL_PREFIX))
  .map((p) => decodeURIComponent(p.url.slice(URL_PREFIX.length)))
  .sort();

for (const title of titles) {
  console.log(title);
}

console.error(`\n${titles.length} titles (stderr note — stdout above is paste-ready)`);
