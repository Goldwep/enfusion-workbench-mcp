import AdmZip from "adm-zip";
import { join, resolve, relative, dirname } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { logger } from "../utils/logger.js";

export interface HtmlEntry {
  filename: string;
  html: string;
}

const ZIP_FILES = {
  enfusion: "EnfusionScriptAPIPublic.zip",
  arma: "ArmaReforgerScriptAPIPublic.zip",
} as const;

const ZIP_ROOTS = {
  enfusion: "EnfusionScriptAPIPublic/",
  arma: "ArmaReforgerScriptAPIPublic/",
} as const;

// Unpacked-directory names per source. The 1.8 Tools build stopped shipping
// zips and ships these directories instead — and renamed the Enfusion one
// (no "Public" suffix). Probe both spellings for resilience.
const DIR_NAMES = {
  enfusion: ["EnfusionScriptAPI", "EnfusionScriptAPIPublic"],
  arma: ["ArmaReforgerScriptAPIPublic", "ArmaReforgerScriptAPI"],
} as const;

/** A located Doxygen docs source: a zip archive (≤1.7) or a directory (1.8+). */
export interface DocsSource {
  kind: "zip" | "dir";
  path: string;
}

/**
 * Locate the Doxygen docs for a source under `<workbenchPath>/Workbench/docs`.
 * Zips are probed first (pre-1.8 layout), then unpacked directories (1.8+).
 * Returns null when neither exists.
 */
export function resolveDocsSource(
  workbenchPath: string,
  source: "enfusion" | "arma",
): DocsSource | null {
  const docsDir = resolve(workbenchPath, "Workbench", "docs");
  const zipPath = join(docsDir, ZIP_FILES[source]);
  if (existsSync(zipPath)) return { kind: "zip", path: zipPath };
  for (const name of DIR_NAMES[source]) {
    const dirPath = join(docsDir, name);
    if (existsSync(join(dirPath, "html", "annotated.html"))) return { kind: "dir", path: dirPath };
    if (existsSync(join(dirPath, "annotated.html"))) return { kind: "dir", path: dirPath };
  }
  return null;
}

/** Kept for compatibility: the pre-1.8 zip location for a source. */
export function getZipPath(workbenchPath: string, source: "enfusion" | "arma"): string {
  return resolve(workbenchPath, "Workbench", "docs", ZIP_FILES[source]);
}

/**
 * Resolve the in-zip prefix that the Doxygen HTML lives under. Older builds
 * emitted files directly at "<Root>/annotated.html"; the 1_87_80 build nests
 * them under "<Root>/html/annotated.html". Probe for annotated.html to pick
 * the right layout so the scraper survives the restructure (and any future
 * one). Falls back to scanning for annotated.html anywhere in the zip.
 */
function resolveZipPrefix(zip: AdmZip, source: "enfusion" | "arma"): string {
  const root = ZIP_ROOTS[source];
  if (zip.getEntry(root + "html/annotated.html")) return root + "html/";
  if (zip.getEntry(root + "annotated.html")) return root;
  for (const e of zip.getEntries()) {
    if (e.entryName.endsWith("/annotated.html")) {
      return e.entryName.slice(0, e.entryName.length - "annotated.html".length);
    }
  }
  return root; // give up — preserve historical behavior
}

/** The directory containing annotated.html inside an unpacked docs dir. */
function resolveDirPrefix(dirPath: string): string {
  if (existsSync(join(dirPath, "html", "annotated.html"))) return join(dirPath, "html");
  if (existsSync(join(dirPath, "annotated.html"))) return dirPath;
  const found = findFileRecursive(dirPath, "annotated.html", 3);
  return found ? dirname(found) : dirPath;
}

function findFileRecursive(dir: string, name: string, maxDepth: number): string | null {
  if (maxDepth < 0) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name === name) return join(dir, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findFileRecursive(join(dir, e.name), name, maxDepth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

function* walkFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

/**
 * Best-effort detection of the BI Jenkins build branch (e.g. "stable_1_87_80")
 * by scanning entry/file names — Doxygen embeds the source-tree path
 * (".../branches/stable_1_87_80/A4Data/...") in its mangled source-page
 * filenames. Returns undefined when the source is missing or no branch marker
 * is found. Used only for the scrape provenance marker, never for behavior.
 */
export function detectBuildBranch(
  workbenchPath: string,
  source: "enfusion" | "arma",
): string | undefined {
  const docs = resolveDocsSource(workbenchPath, source);
  if (!docs) return undefined;
  // Match exactly 3 numeric parts (major_minor_patch). Doxygen encodes the
  // following path "/" as "_2", so a looser [0-9_]+ would capture a trailing
  // "_2" artifact (e.g. "stable_1_87_80_2A4Data" → "stable_1_87_80_2").
  const re = /branches_(stable_\d+_\d+_\d+)(?:[^0-9]|$)/;
  try {
    if (docs.kind === "zip") {
      const zip = new AdmZip(docs.path);
      for (const entry of zip.getEntries()) {
        const m = re.exec(entry.entryName);
        if (m) return m[1];
      }
    } else {
      for (const file of walkFiles(docs.path)) {
        const m = re.exec(file.replace(/\\/g, "/"));
        if (m) return m[1];
      }
    }
  } catch {
    /* ignore — provenance is best-effort */
  }
  return undefined;
}

/**
 * Iterate HTML files from a local Workbench docs source (zip or unpacked
 * directory). Yields {filename, html} for each HTML file matching the pattern,
 * with filenames relative to the Doxygen root (where annotated.html lives).
 */
export function* readHtmlFromZip(
  workbenchPath: string,
  source: "enfusion" | "arma",
  pattern?: RegExp,
): Generator<HtmlEntry> {
  const docs = resolveDocsSource(workbenchPath, source);
  if (!docs) {
    logger.error(`Docs source not found for ${source} (no zip or directory under Workbench/docs)`);
    return;
  }

  logger.info(`Reading from ${docs.path} (${docs.kind})`);
  let count = 0;

  if (docs.kind === "zip") {
    const zip = new AdmZip(docs.path);
    const prefix = resolveZipPrefix(zip, source);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.endsWith(".html")) continue;
      const filename = entry.entryName.startsWith(prefix)
        ? entry.entryName.slice(prefix.length)
        : entry.entryName;
      if (pattern && !pattern.test(filename)) continue;
      count++;
      yield { filename, html: entry.getData().toString("utf-8") };
    }
  } else {
    const prefix = resolveDirPrefix(docs.path);
    for (const file of walkFiles(prefix)) {
      if (!file.endsWith(".html")) continue;
      const filename = relative(prefix, file).replace(/\\/g, "/");
      if (pattern && !pattern.test(filename)) continue;
      count++;
      yield { filename, html: readFileSync(file, "utf-8") };
    }
  }

  logger.info(`Read ${count} HTML files from ${source} (${docs.kind})`);
}

/**
 * Read a specific file (relative to the Doxygen root) from the docs source.
 */
export function readFileFromZip(
  workbenchPath: string,
  source: "enfusion" | "arma",
  filename: string,
): string | null {
  const docs = resolveDocsSource(workbenchPath, source);
  if (!docs) return null;

  if (docs.kind === "zip") {
    const zip = new AdmZip(docs.path);
    const entry = zip.getEntry(resolveZipPrefix(zip, source) + filename);
    if (!entry) return null;
    return entry.getData().toString("utf-8");
  }

  const full = join(resolveDirPrefix(docs.path), filename);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}
