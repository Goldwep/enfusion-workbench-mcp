/**
 * `behavior_tree`: read, check, author and edit `.bt` AI behavior trees as files.
 *
 * The Behavior Editor's script API (`BehaviorEditor: WBModuleDef`) opens and
 * saves a resource and nothing else: no call reads or changes a node. So the
 * file is the surface. The
 * format and its rules are in behavior-tree/model.ts and behavior-tree/tree.ts,
 * the node-level diff in behavior-tree/diff.ts; the node classes come from
 * data/behavior-tree/catalog.json (scripts/gen-bt-catalog.ts: the build's
 * source index for the class list, the vanilla trees for their usage).
 *
 * Reads take a file on disk or a game resource path (read from the paks).
 * Writes go under the project root only, and never over a file whose text the
 * writer cannot reproduce (comments, hand layout).
 *
 * inspect, validate, nodes, create and edit answer text, as in 1.x (DEC-061
 * keeps them). diff answers {ok, action, target, changed, readback, next,
 * warnings} (src/manifest/vocabulary.ts) as JSON text. The spec, op and
 * node-path grammar is in data/kb/patterns/AI_And_Behavior/behavior-tree.md.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { diffBt } from "../behavior-tree/diff.js";
import { BtParseError, emitBt, isCanonical, parseBt } from "../behavior-tree/model.js";
import {
  applyOp,
  buildBt,
  formatBt,
  lookupNode,
  lookupTest,
  opOf,
  treeSpecOf,
  validateBt,
  viewBt,
  type BtCatalog,
  type BtFinding,
  type CatalogNode,
  type CatalogTest,
} from "../behavior-tree/tree.js";
import {
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionResponse,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { backUp } from "../utils/backup.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";

export const BEHAVIOR_TREE_ACTIONS = [
  "inspect",
  "validate",
  "nodes",
  "create",
  "edit",
  "diff",
] as const;

export const BEHAVIOR_TREE_DESCRIPTION =
  "Read, check, author, edit and compare AI behavior trees (.bt) as files, offline. " +
  "Actions: inspect, validate, nodes (the build's Node and test classes, with vanilla usage), " +
  "create (spec), edit (ops on a project tree), diff (path against other: nodes added, removed, moved, changed; paged). " +
  'Writes stay in the project. Spec, op and node-path grammar: wb_knowledge "behavior tree".';

let cached: { dir: string; catalog: BtCatalog | undefined } | undefined;

/** The node catalog shipped in the data directory; undefined when the file is missing or unreadable. */
export function loadBtCatalog(dataDir: string): BtCatalog | undefined {
  if (cached?.dir === dataDir) return cached.catalog;
  let catalog: BtCatalog | undefined;
  try {
    catalog = JSON.parse(
      readFileSync(join(dataDir, "behavior-tree", "catalog.json"), "utf-8"),
    ) as BtCatalog;
  } catch {
    catalog = undefined;
  }
  cached = { dir: dataDir, catalog };
  return catalog;
}

interface Source {
  text: string;
  /** Where it was read from, for the reply. */
  label: string;
  /** Absolute file path when the tree is a file on disk. */
  file?: string;
  /** Resource path from the addon root, when known. */
  resourcePath?: string;
}

/** A backup refusal (MAX_BACKUPS reached); the handler answers it as an error. */
const fail = (message: string): never => {
  throw new VocabularyError("INVALID_ARGUMENT", message);
};

const stripGuid = (ref: string): string => ref.replace(/^\{[0-9A-Fa-f]{16}\}/, "");

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

/** A file on disk (absolute, or under the project), else the game's paks. */
function readSource(path: string, projectRoot: string | undefined, config: Config): Source {
  if (path.startsWith("-"))
    throw new VocabularyError("INVALID_ARGUMENT", "paths starting with '-' are rejected");
  const clean = stripGuid(path);
  if (isAbsolute(clean)) {
    // Only tree files are read from outside the project and the game data.
    if (!clean.toLowerCase().endsWith(".bt"))
      throw new VocabularyError("INVALID_ARGUMENT", `"${path}" is not a .bt file`);
    // relative() answers an absolute path across drives, so test for that too.
    const rel = projectRoot ? relative(projectRoot, clean) : "";
    const inside = rel !== "" && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..";
    const resourcePath = inside ? rel.replace(/\\/g, "/") : undefined;
    return { text: readFileSync(clean, "utf-8"), label: clean, file: clean, resourcePath };
  }
  const res = clean.replace(/\\/g, "/");
  if (projectRoot) {
    const file = resolve(projectRoot, res);
    assertInsideRoot(file, projectRoot, "path");
    if (existsSync(file))
      return { text: readFileSync(file, "utf-8"), label: file, file, resourcePath: res };
  }
  const vfs = vfsOf(config);
  if (vfs?.exists(res))
    return { text: vfs.readTextFile(res), label: `${res} (game data)`, resourcePath: res };
  throw new VocabularyError(
    "PATH_NOT_FOUND",
    `no behavior tree at "${path}": not a file${projectRoot ? ` under ${projectRoot}` : ""} and not in the game data` +
      (vfs ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
  );
}

function existsCheck(
  projectRoot: string | undefined,
  config: Config,
): (ref: string) => boolean | undefined {
  const vfs = vfsOf(config);
  return (ref) => {
    const res = stripGuid(ref);
    if (projectRoot && existsSync(resolve(projectRoot, res))) return true;
    if (!vfs) return undefined;
    return vfs.exists(res);
  };
}

function findingLines(findings: BtFinding[]): string[] {
  if (findings.length === 0) return ["No findings: the tree has the shape of the vanilla ones."];
  const errors = findings.filter((f) => f.level === "error").length;
  return [
    `${errors} error(s), ${findings.length - errors} warning(s):`,
    ...findings.map((f) => `- ${f.level.toUpperCase()}${f.at ? ` [${f.at}]` : ""}: ${f.message}`),
  ];
}

function factLines(n: CatalogNode | CatalogTest): string[] {
  const lines: string[] = [];
  if (n.parent) lines.push(`- class: ${n.parent} > ... (family ${n.family ?? "?"})`);
  if (n.source) lines.push(`- declared in ${n.source}${n.scripted ? "" : " (engine class)"}`);
  if (n.attributes?.length) lines.push(`- [Attribute] fields: ${n.attributes.join(", ")}`);
  return lines;
}

function nodeDetail(type: string, n: CatalogNode): string {
  const used = n.count > 0;
  const lines = [
    used
      ? `### ${type} (${n.count} in vanilla trees; children ${n.children[0]}..${n.children[1]})`
      : `### ${type} (in no vanilla tree: properties and ports below come from its script only)`,
    ...factLines(n),
  ];
  for (const [k, p] of Object.entries(n.props)) {
    lines.push(
      `- ${k}${p.quoted ? " (quoted)" : ""}: e.g. ${p.samples.join(" | ")}  [on ${p.n}/${n.count}]`,
    );
  }
  if (n.vars.length) lines.push(`- variable properties: ${n.vars.join(", ")}`);
  if (n.in.length) lines.push(`- in ports: ${n.in.join(", ")}`);
  if (n.out.length) lines.push(`- out ports: ${n.out.join(", ")}`);
  if (n.tests.length) lines.push(`- TEST classes: ${n.tests.join(", ")}`);
  if (n.blocks.length) lines.push(`- other blocks: ${n.blocks.join(", ")}`);
  return lines.join("\n");
}

function testDetail(type: string, t: CatalogTest): string {
  const lines = [
    `### ${type} (TEST class; ${t.count} use(s) in vanilla TEST blocks)`,
    ...factLines(t),
  ];
  for (const [k, p] of Object.entries(t.props)) {
    lines.push(
      `- ${k}${p.quoted ? " (quoted)" : ""}: e.g. ${p.samples.join(" | ")}  [on ${p.n}/${t.count}]`,
    );
  }
  return lines.join("\n");
}

/** The `nodes` action: one class in full, a few matches in full, or the list. */
export function nodesText(catalog: BtCatalog, type?: string, query?: string): string {
  if (type) {
    const n = lookupNode(catalog, type);
    if (n) return nodeDetail(type, n);
    const t = lookupTest(catalog, type);
    if (t) return testDetail(type, t);
    return `${type} is not a Node or BaseDecoratorTest class of build ${catalog.build}: check the name (query lists matches, api_search finds other classes).`;
  }
  const q = query?.toLowerCase();
  const match = (k: string): boolean => !q || k.toLowerCase().includes(q);
  const names = Object.keys(catalog.nodes).filter(match);
  const tests = Object.keys(catalog.tests ?? {}).filter(match);
  if (q && names.length + tests.length > 0 && names.length + tests.length <= 8) {
    return [
      ...names.map((k) => nodeDetail(k, catalog.nodes[k])),
      ...tests.map((k) => testDetail(k, catalog.tests![k])),
    ].join("\n\n");
  }
  const used = names.filter((k) => catalog.nodes[k].count > 0).length;
  const lines = [
    `${names.length} node class(es) of build ${catalog.build}, ${used} used in its ${catalog.files} vanilla trees; name x uses. Give type for one in full.`,
    `Variable types: ${catalog.variableTypes.join(", ")}`,
    "",
    names.map((k) => `${k} x${catalog.nodes[k].count}`).join(", "),
  ];
  if (catalog.tests) {
    lines.push(
      "",
      `${tests.length} TEST class(es) (BaseDecoratorTest):`,
      tests.map((k) => `${k} x${catalog.tests![k].count}`).join(", "),
    );
  }
  return lines.join("\n");
}

// ── diff ─────────────────────────────────────────────────────────────────────

const MESSAGE_CAP = 600;

function failure(action: string, target: string, e: unknown): ActionResponse {
  if (e instanceof VocabularyError) return errorResponse(action, target, e.code, e.message);
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof BtParseError)
    return errorResponse(
      action,
      target,
      "INVALID_ARGUMENT",
      `not a readable .bt: ${msg}`.slice(0, MESSAGE_CAP),
    );
  if ((e as NodeJS.ErrnoException)?.code === "ENOENT")
    return errorResponse(action, target, "PATH_NOT_FOUND", msg.slice(0, MESSAGE_CAP));
  return errorResponse(action, target, "INVALID_ARGUMENT", msg.slice(0, MESSAGE_CAP));
}

export interface DiffArgs {
  path?: string;
  other?: string;
  cursor?: string;
  limit?: number;
}

/** The `diff` action: tree `path` (before) against tree `other` (after), one page of changes. */
export function diffAction(
  args: DiffArgs,
  projectRoot: string | undefined,
  config: Config,
): ActionResponse {
  const target = `${args.path ?? "?"} -> ${args.other ?? "?"}`;
  try {
    if (!args.path || !args.other)
      throw new VocabularyError("INVALID_ARGUMENT", "diff needs path (before) and other (after)");
    const limit = args.limit ?? LIMIT_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
      throw new VocabularyError("INVALID_ARGUMENT", `limit must be 1..${LIMIT_MAX}, got ${limit}`);
    const cursor = args.cursor === undefined ? undefined : parseCursor(args.cursor);
    const a = readSource(args.path, projectRoot, config);
    const b = readSource(args.other, projectRoot, config);
    const diff = diffBt(parseBt(a.text), parseBt(b.text));
    const total = diff.changes.length;
    if (cursor) checkCursor(cursor, total);
    const start = cursor?.start ?? 0;
    const more = nextCursor(start, limit, total);
    return {
      ok: true,
      action: "diff",
      target,
      changed: null,
      readback: {
        a: a.label,
        b: b.label,
        identical: total === 0,
        summary: diff.summary,
        total,
        changes: diff.changes.slice(start, start + limit),
        ...(more ? { nextCursor: more } : {}),
      },
      ...(more ? { next: `more changes: call diff again with cursor "${more}"` } : {}),
      warnings: ["canvas positions (EditorPos) and groups are not compared"],
    };
  } catch (e) {
    return failure("diff", target, e);
  }
}

/** Headline suffix of a write whose tree has error-level findings: written, but say so first. */
function errorNote(findings: BtFinding[]): string {
  const n = findings.filter((f) => f.level === "error").length;
  return n ? ` WITH ${n} ERROR(S), listed below: fix them before using the tree` : "";
}

const NOTE =
  "Checked offline against the shape of the vanilla trees, not by the engine: open the tree in the Behavior Editor (or run it) to confirm it loads.";

export function registerBehaviorTree(server: McpServer, config: Config): void {
  server.registerTool(
    "behavior_tree",
    {
      description: BEHAVIOR_TREE_DESCRIPTION,
      inputSchema: {
        action: z.enum(BEHAVIOR_TREE_ACTIONS),
        path: z
          .string()
          .optional()
          .describe(
            "inspect/validate/edit/diff: absolute path, path under the project, or game resource path (read only).",
          ),
        other: z.string().optional().describe("diff: the second tree (after), as path."),
        type: z.string().optional().describe("nodes: one class, in full."),
        query: z.string().optional().describe("nodes: substring of the class name."),
        spec: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("create: {path, guid?, variables?, root: node}."),
        ops: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("edit: operations, applied in order; all or nothing."),
        overwrite: z
          .boolean()
          .optional()
          .describe("create: replace an existing file (default false)."),
        dry_run: z.boolean().optional().describe("create/edit: return the text without writing."),
        cursor: z.string().optional().describe("diff: nextCursor of the previous page."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe(`diff: changes per page (default ${LIMIT_DEFAULT}).`),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
      },
    },
    async ({
      action,
      path,
      other,
      type,
      query,
      spec,
      ops,
      overwrite,
      dry_run,
      cursor,
      limit,
      projectPath,
    }) => {
      const text = (t: string, isError = false) => ({
        content: [{ type: "text" as const, text: t }],
        isError,
      });
      let root: string | undefined;
      try {
        root = pinnedProjectRoot(projectPath, config.projectPath);
      } catch (e) {
        if (action === "diff") {
          const res = failure("diff", `${path ?? "?"} -> ${other ?? "?"}`, e);
          return text(JSON.stringify(res, null, 2), true);
        }
        return text(`behavior_tree ${action}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
      if (action === "diff") {
        const res = diffAction({ path, other, cursor, limit }, root, config);
        return text(JSON.stringify(res, null, 2), !res.ok);
      }
      try {
        const catalog = loadBtCatalog(config.dataDir);

        if (action === "nodes") {
          if (!catalog)
            return text("No node catalog (data/behavior-tree/catalog.json is missing).", true);
          return text(nodesText(catalog, type, query));
        }

        if (action === "inspect" || action === "validate") {
          if (!path) return text(`${action} needs path`, true);
          const src = readSource(path, root, config);
          const doc = parseBt(src.text);
          if (action === "inspect") return text(formatBt(viewBt(doc), src.label));
          const findings = validateBt(doc, {
            catalog,
            expectedPath: src.resourcePath,
            treeExists: existsCheck(root, config),
          });
          const errors = findings.some((f) => f.level === "error");
          return text(
            [`# Check: ${src.label}`, "", ...findingLines(findings), "", NOTE].join("\n"),
            errors,
          );
        }

        if (action === "create") {
          if (!spec) return text("create needs spec", true);
          const tree = treeSpecOf(spec);
          const doc = buildBt(tree, catalog);
          const out = emitBt(doc);
          const res = tree.path.replace(/\\/g, "/");
          const findings = validateBt(doc, {
            catalog,
            expectedPath: res,
            treeExists: existsCheck(root, config),
          });
          const report = [...findingLines(findings), "", NOTE];
          if (dry_run || !root) {
            return text(
              [
                `Not written${root ? " (dry run)" : " (no project path configured)"}: ${res}`,
                "",
                ...report,
                "",
                "```",
                out,
                "```",
              ].join("\n"),
            );
          }
          const file = resolve(root, res);
          assertInsideRoot(file, root, "spec.path");
          const existed = existsSync(file);
          if (existed && !overwrite)
            return text(`${res} already exists; pass overwrite: true to replace it.`, true);
          mkdirSync(dirname(file), { recursive: true });
          const backup = existed ? backUp(file, fail) : undefined;
          writeFileAtomic(file, out);
          return text(
            [
              `Created ${file}${errorNote(findings)}`,
              ...(backup ? [`The file it replaced is kept as ${backup}.`] : []),
              "",
              formatBt(viewBt(doc), res),
              "",
              ...report,
              "",
              "The Workbench registers the file (and writes its .meta) when it next scans the project.",
            ].join("\n"),
          );
        }

        // edit
        if (!path) return text("edit needs path", true);
        if (!ops?.length) return text("edit needs ops", true);
        const src = readSource(path, root, config);
        if (!src.file)
          return text(
            `${src.label} is game data: copy it into the project first (game_duplicate), then edit the copy.`,
            true,
          );
        if (!root)
          return text("edit needs a project path (ENFUSION_PROJECT_PATH or projectPath)", true);
        assertInsideRoot(src.file, root, "path");
        if (!isCanonical(src.text)) {
          return text(
            `${src.label} has comments or a hand layout this writer would not keep; it is left alone. Edit it in the Behavior Editor.`,
            true,
          );
        }
        const doc = parseBt(src.text);
        const done: string[] = [];
        ops.forEach((raw, i) => {
          try {
            done.push(`${i + 1}. ${applyOp(doc, opOf(raw, i), catalog)}`);
          } catch (e) {
            throw new Error(
              `op ${i + 1} of ${ops.length} failed, nothing written: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        });
        const out = emitBt(doc);
        const findings = validateBt(doc, {
          catalog,
          expectedPath: src.resourcePath,
          treeExists: existsCheck(root, config),
        });
        const body = [...done, "", ...findingLines(findings), "", NOTE];
        if (dry_run)
          return text(
            [`Dry run, ${src.label} not written:`, ...body, "", "```", out, "```"].join("\n"),
          );
        const backup = backUp(src.file, fail);
        writeFileAtomic(src.file, out);
        return text(
          [
            `Edited ${src.label}${errorNote(findings)}:`,
            ...body,
            "",
            `The file before the edit is kept as ${backup}.`,
            "",
            "An open Behavior Editor tab keeps its own copy: reopen the tree there, and do not save the old tab over this file.",
          ].join("\n"),
        );
      } catch (e) {
        return text(`behavior_tree ${action}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );
}
