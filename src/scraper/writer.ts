import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { logger } from "../utils/logger.js";
import type { ClassInfo, GroupInfo, HierarchyNode, WikiPage } from "../index/types.js";
import type { SourceIndex } from "../census/source-index.js";
import { stripPakEntries, type ApiIndexFile } from "./backfill.js";
import {
  API_FILE_MAX_LF_BYTES,
  API_INDEX_FILES,
  applySourceBackfill,
  type SourceBackfillMeta,
} from "./backfill-io.js";

export interface ScrapeOutput {
  enfusionClasses: ClassInfo[];
  armaClasses: ClassInfo[];
  hierarchy: HierarchyNode[];
  groups: GroupInfo[];
  wikiPages: WikiPage[];
  /** Optional provenance written to data/api/scrape-meta.json so future
   *  staleness is detectable without a full diff. Populated by scrape(). */
  meta?: ScrapeMeta;
}

export interface ScrapeMeta {
  scrapedAt: string;
  workbenchPath: string;
  /** Per-source zip presence + mtime/size, captured at scrape time. */
  sources: Record<string, { present: boolean; mtime?: string; sizeBytes?: number }>;
  /** Jenkins build branch detected from Doxygen internal paths, e.g.
   *  "stable_1_87_80". Empty when undetectable. */
  buildBranch?: string;
  /** Source index the pak layer of the class files was derived from; absent when no backfill ran. */
  sourceBackfill?: SourceBackfillMeta;
}

function writeJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  logger.info(`Wrote ${filePath}`);
}

function readExisting<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T[];
  } catch {
    return [];
  }
}

/**
 * Write a class list, but NEVER blank an existing file. If the freshly
 * scraped list is empty — which happens when that source's Doxygen zip is
 * missing or moved (BI consolidated the standalone `EnfusionScriptAPIPublic.zip`
 * into the combined `ArmaReforgerScriptAPIPublic.zip` in the 1_87_80 build) —
 * preserve the previously-scraped data instead of destroying it.
 */
export function writeClassesPreserving(
  filePath: string,
  classes: ClassInfo[],
  label: string,
): void {
  if (classes.length === 0) {
    const existing = readExisting<ClassInfo>(filePath);
    logger.warn(
      `${label}: scrape returned 0 classes (zip missing/moved). Preserving existing ` +
        `${existing.length} entries — NOT overwriting. If the source was intentionally ` +
        `removed, delete the file by hand.`,
    );
    return;
  }
  writeJson(filePath, classes);
}

/** List fields on merge-able entries (HierarchyNode.children, GroupInfo.classes)
 *  that must be UNIONED on a name collision rather than overwritten. Any field
 *  here that is a string[] on both entries gets deduped-unioned; everything
 *  else is a scalar where the fresh entry wins. */
const MERGE_LIST_FIELDS = ["classes", "children"] as const;

/** Union two string arrays, preserving order (existing first, then new) and
 *  dropping duplicates. */
function unionStringLists(existing: string[], fresh: string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const v of fresh) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Merge a fresh entry onto an existing one sharing the same name: scalar
 *  fields take the fresh value (fresh wins), but string[] list fields named in
 *  MERGE_LIST_FIELDS are unioned so NEITHER source's list is discarded. */
function mergeEntry<T extends { name: string }>(existing: T, fresh: T): T {
  const merged = { ...existing, ...fresh } as T; // fresh wins on scalars
  for (const field of MERGE_LIST_FIELDS) {
    const ev = (existing as Record<string, unknown>)[field];
    const fv = (fresh as Record<string, unknown>)[field];
    if (Array.isArray(ev) && Array.isArray(fv)) {
      (merged as Record<string, unknown>)[field] = unionStringLists(ev as string[], fv as string[]);
    }
  }
  return merged;
}

/**
 * Name-keyed merge: overlay freshly-scraped entries on top of existing ones.
 * Preserves entries from a source that wasn't scraped this run (e.g. the
 * Enfusion hierarchy/group nodes when only the combined Arma zip is present),
 * while letting freshly-scraped entries win on name collision.
 *
 * On a name collision the entries are MERGED, not blind-overwritten: scalar
 * fields take the fresh value, but list fields (`classes`, `children`) are
 * unioned so that two same-named entries carrying different class/child lists
 * (12 such dup-named groups observed live) don't collapse last-writer-wins and
 * silently drop one source's contribution.
 *
 * Trade-off: a class genuinely removed upstream persists as a stale entry
 * rather than vanishing. That is the safer failure mode than silently
 * dropping a whole source's contribution; a deliberate full rebuild can
 * start from an empty file when a clean cut is wanted.
 */
export function mergeByName<T extends { name: string }>(filePath: string, fresh: T[]): T[] {
  const existing = readExisting<T>(filePath);
  if (fresh.length === 0) return existing; // nothing fresh — keep existing verbatim
  const byName = new Map<string, T>();
  for (const e of existing) byName.set(e.name, e);
  for (const f of fresh) {
    const prior = byName.get(f.name);
    byName.set(f.name, prior ? mergeEntry(prior, f) : f); // merge lists on collision
  }
  return [...byName.values()];
}

export interface WriteOptions {
  /** E02 source index: when given, the class lists are backfilled from it before they are written. */
  sourceIndex?: SourceIndex;
  /** Size cap of a class file's LF bytes (plan risk R20); default `API_FILE_MAX_LF_BYTES`. */
  maxLfBytes?: number;
}

/**
 * Backfills the freshly scraped class lists from the source index (in place):
 * method names and params arrays corrected, then every method and class the game's script
 * source declares and Doxygen lost added with `origin: "pak"`. A list that
 * came back empty is not written (its file is preserved), so it is read from
 * disk only to pair against; additions bound for it are reported, not written.
 * A list the layer would push past `maxLfBytes` is written without it (plan
 * risk R20). Returns the provenance to record in `scrape-meta.json`.
 */
export function backfillScraped(
  apiDir: string,
  output: ScrapeOutput,
  index: SourceIndex,
  maxLfBytes: number = API_FILE_MAX_LF_BYTES,
): SourceBackfillMeta {
  logger.info(
    `Source backfill: source index of build ${index.header.build}, Doxygen docs of build branch ${output.meta?.buildBranch || "(unknown)"}. Check the two are the same game build: nothing maps one name to the other.`,
  );
  const lists = [output.enfusionClasses, output.armaClasses];
  const files: ApiIndexFile[] = API_INDEX_FILES.map((f, i) => ({
    file: f.file,
    source: f.source,
    classes: lists[i].length > 0 ? lists[i] : readExisting<ClassInfo>(resolve(apiDir, f.file)),
  }));
  const s = applySourceBackfill(files, index);
  const shortClasses = s.shortfallBefore.length;
  const shortMethods = s.shortfallBefore.reduce((n, c) => n + c.missing.length, 0);
  logger.info(
    `Method-count check against the source index (build ${index.header.build}): ${shortClasses} classes short of ${shortMethods} methods before the backfill`,
  );
  for (const f of files) {
    const p = s.result.perFile[f.file];
    logger.info(
      `Backfill ${f.file}: ${p.methods} methods and ${p.classes} classes added from the pak source (${Object.entries(
        p.byReason,
      )
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")})`,
    );
  }
  logger.info(
    `Method names corrected: ${s.nameCorrections.length}; params arrays corrected: ${s.corrections.length}`,
  );
  API_INDEX_FILES.forEach((f, i) => {
    const p = s.result.perFile[f.file];
    if (lists[i].length === 0 && (p.methods > 0 || p.classes > 0))
      logger.warn(
        `${f.file} was not scraped this run and is preserved as it was: its ${p.methods} backfilled methods and ${p.classes} classes are not written. Run scripts/backfill-api-index.ts.`,
      );
  });
  if (s.shortfallAfter.length > 0)
    logger.warn(
      `Method-count check after the backfill: ${s.shortfallAfter.length} classes still short (first: ${s.shortfallAfter
        .slice(0, 5)
        .map((c) => `${c.class} ${c.indexed}/${c.expected}`)
        .join(", ")})`,
    );
  const carried: string[] = [];
  files.forEach((f, i) => {
    if (lists[i].length === 0) return;
    const lf = Buffer.byteLength(JSON.stringify(lists[i], null, 2), "utf-8");
    if (lf <= maxLfBytes) {
      carried.push(f.file);
      return;
    }
    stripPakEntries([f]);
    logger.warn(
      `${f.file}: the pak layer would take it to ${lf} bytes, past the ${maxLfBytes} cap (plan risk R20); written without the layer. Run scripts/backfill-api-index.ts to write the backfilled file to the artifacts folder.`,
    );
  });
  return {
    build: index.header.build,
    inputsSha256: index.header.inputs_sha256,
    files: carried,
  };
}

export function writeOutput(dataDir: string, output: ScrapeOutput, opts: WriteOptions = {}): void {
  const apiDir = resolve(dataDir, "api");
  const wikiDir = resolve(dataDir, "wiki");

  if (opts.sourceIndex) {
    const provenance = backfillScraped(apiDir, output, opts.sourceIndex, opts.maxLfBytes);
    if (output.meta) output.meta.sourceBackfill = provenance;
  }

  // Class files: preserve-on-empty (never blank a populated file with []).
  writeClassesPreserving(
    resolve(apiDir, "enfusion-classes.json"),
    output.enfusionClasses,
    "enfusion-classes",
  );
  writeClassesPreserving(resolve(apiDir, "arma-classes.json"), output.armaClasses, "arma-classes");

  // Hierarchy + groups are cross-source merged arrays with no source tag, so a
  // name-keyed merge preserves a missing source's contributions while updating
  // freshly-scraped entries.
  writeJson(
    resolve(apiDir, "hierarchy.json"),
    mergeByName(resolve(apiDir, "hierarchy.json"), output.hierarchy),
  );
  writeJson(
    resolve(apiDir, "groups.json"),
    mergeByName(resolve(apiDir, "groups.json"), output.groups),
  );

  // Merge wiki pages: preserve existing BI wiki pages, replace only Doxygen-sourced pages
  const pagesPath = resolve(wikiDir, "pages.json");
  let existingPages: WikiPage[] = [];
  if (existsSync(pagesPath)) {
    try {
      existingPages = JSON.parse(readFileSync(pagesPath, "utf-8")) as WikiPage[];
    } catch {
      // Corrupted file — will be overwritten
    }
  }
  // Keep pages from sources NOT in the current scrape output
  const scrapedSources = new Set(output.wikiPages.map((p) => p.source));
  const preservedPages = existingPages.filter((p) => !scrapedSources.has(p.source));
  const mergedPages = [...preservedPages, ...output.wikiPages];
  writeJson(pagesPath, mergedPages);

  // Provenance marker — lets `project_index_status` / a human detect staleness
  // after a Tools update without diffing the 47 MB class file.
  if (output.meta) {
    writeJson(resolve(apiDir, "scrape-meta.json"), output.meta);
  }

  logger.info(
    `Scrape complete: ${output.enfusionClasses.length} enfusion classes, ${output.armaClasses.length} arma classes, ${output.hierarchy.length} hierarchy nodes (fresh), ${output.groups.length} groups (fresh), ${mergedPages.length} wiki pages (${output.wikiPages.length} from Doxygen + ${preservedPages.length} preserved)`,
  );
}
