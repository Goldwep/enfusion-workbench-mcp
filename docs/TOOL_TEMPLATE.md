# TOOL_TEMPLATE — canonical shape for new MCP tools in Enfusion-Workbench-MCP-Goldwep

Distilled from a deep read of three representative tools in upstream `steffenbk/enfusion-mcp-BK@main`:

- `src/tools/api-search.ts` — read-heavy with scoring + filtering (~510 lines)
- `src/tools/component-search.ts` — narrower query, similar shape (~190 lines)
- `src/tools/wb-state.ts` — Workbench-client-backed (RPC-style, ~55 lines)

Cross-checked against `src/server.ts` (wiring), `src/tools/asset-search.ts` (Config-backed), `tests/tools/api-search-tree.test.ts` (test idiom), `package.json` (SDK `^1.26.0`, zod `^3.25.0`), and `tsconfig.json` (strict, Node16 ESM with mandatory `.js` import extensions).

---

## 1. The canonical pattern (prose)

Every tool file in this codebase follows the same five-part shape. Internalize this and the three new tools (`resolve_guid`, `find_references`, `project_index_status`) drop straight in.

### 1.1 File layout

```
src/tools/<kebab-name>.ts
  ├── imports (SDK McpServer type, zod, injected dep types)
  ├── private interfaces  (input shape, intermediate result shapes)
  ├── pure helpers        (formatters — EXPORT them if they need unit tests)
  ├── module-level cache  (optional — see asset-search for the pattern)
  └── export function register<ToolName>(server, ...deps): void
        └── server.registerTool(toolName, { description, inputSchema }, async handler)
```

### 1.2 Registration call

The codebase uses the modern SDK shape:

```ts
server.registerTool(
  "snake_case_tool_name",         // wire name; matches the function suffix in snake_case
  {
    description: "...",            // long, dense — see §1.4
    inputSchema: { /* zod fields */ },  // PLAIN OBJECT, not wrapped in z.object({})
  },
  async (input) => { /* ... */ return { content: [...] }; }
);
```

Note: it is `server.registerTool`, **not** `server.tool`. The latter is the legacy SDK API; this codebase has standardized on the former throughout.

### 1.3 Registration function signature

Pattern: `export function register<PascalCase>(server: McpServer, ...deps): void`. Always returns `void`. Always takes `server` first. Deps follow, ordered by frequency of use in this codebase:

| Dep               | Type                        | Source                                                             | Used by                                                      |
| ----------------- | --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `SearchEngine`    | `../index/search-engine.js` | Constructed once in `server.ts` from `config.dataDir`              | `api-search`, `component-search`, `wiki-search`, `wiki-read` |
| `WorkbenchClient` | `../workbench/client.js`    | Constructed once in `server.ts` from `config.workbenchHost`/`Port` | All `wb-*` tools (~20 of them)                               |
| `Config`          | `../config.js`              | Passed through from `loadConfig()`                                 | `project`, `prefab`, `mod`, `asset-search`, base-game tools  |
| `PatternLibrary`  | `../patterns/loader.js`     | Constructed once in `server.ts`                                    | `mod`, prompt registrations                                  |

Multiple deps are fine: `registerMod(server, config, searchEngine, patterns)`, `registerScriptCreate(server, config, searchEngine)`. Wire all of these by hand in `src/server.ts` — there is no auto-registration.

### 1.4 The description string

The description is dense and instruction-laden — it doubles as the prompt to the LLM about when to pick this tool. Three observed conventions:

1. **Lead with the verb-noun** ("Search the…", "Get a full snapshot of…", "Search for…")
2. **Mention close-cousin tools** when ambiguity is likely ("For component-specific searches… use the `component_search` tool")
3. **Surface non-obvious flags** ("Use format: 'tree' with class searches to visualize…")

Aim for 1–3 sentences, ~200–400 chars. Plain string concatenation across lines is fine.

### 1.5 The input schema

Schema is a **plain object** whose values are zod schemas — it is NOT wrapped in `z.object({})`. The SDK does the wrapping internally.

```ts
inputSchema: {
  query: z.string().describe("Class name, method name, or keyword to search for"),
  type: z.enum(["class", "method", "enum", "property", "any"]).default("any").describe("..."),
  limit: z.number().min(1).max(50).default(10).describe("Maximum results to return"),
}
```

Conventions:

- **Every field carries `.describe(...)`** — these surface to the LLM.
- **Defaults are aggressive** — `type` defaults to `"any"`, `source` to `"all"`, `format` to `"detailed"`. The tool should be callable with just `{ query: "X" }`.
- **`limit` is always `.min(1).max(50 or 100).default(10–20)`**. Bounded both ways.
- **Optional vs default**: use `.optional()` only when "not provided" has a meaningful semantic difference from a default value (e.g., `event` filter in `component-search` — absent means "no event filter", which is different from any specific event value).
- **No custom error messages** observed — zod's defaults are accepted as-is. The SDK surfaces validation errors to the caller in standard MCP form.
- **No `wb-state` is the empty-schema case**: `inputSchema: {}` is valid and idiomatic for zero-arg tools.

### 1.6 The handler

Async function. Destructures the input. Returns one of two shapes:

**Success / soft-fail (empty result):**

```ts
return { content: [{ type: "text", text: "..." }] };
```

**Hard error (RPC/IO failure):**

```ts
return {
  content: [{ type: "text" as const, text: `Error doing X: ${msg}` }],
  isError: true,
};
```

Observed conventions:

- **Text content only.** No structured/JSON content found anywhere in the three reference files or in `asset-search`. The response `text` is markdown-ish (headers, bullets, `---` separators).
- **JSON-stringified output is not used.** When the result is structured, it gets formatted to readable markdown by a dedicated helper (`formatClassResult`, `formatComponentResult`).
- **Errors are never thrown** out of the handler. They're caught and returned as `isError: true` payloads.
- **Empty results are NOT errors.** A "no matches found" response uses the success shape with helpful guidance ("Try broadening your search — use a shorter query…").
- **`wb-*` tools append `formatConnectionStatus(client)`** to every response (including error responses). This is a Workbench-tool convention; SearchEngine/Config tools don't.

### 1.7 Error paths summary

| Failure mode                     | What happens                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------- |
| zod validation fails             | SDK auto-rejects before handler runs; standard MCP error to caller           |
| Empty result set                 | `{ content: [{ text: "No X found" }] }`, no `isError`                        |
| Config missing (e.g., game path) | `{ content: [...], isError: true }`, helpful message                         |
| RPC/network failure              | `try/catch` → `{ content: [...], isError: true, ...formatConnectionStatus }` |
| Unexpected throw                 | Currently propagates; only `wb-state` and `asset-search` use try/catch       |

### 1.8 Test idiom

`tests/tools/api-search-tree.test.ts` is the only relevant test of the three. It does NOT register the tool or invoke the handler. It tests **exported pure-formatter helpers** (`formatTreeNode`, `formatClassTree`, `MAX_TREE_CHILDREN`) against a real `SearchEngine` built from the bundled `data/` dir. Vitest, ESM, `import.meta.url` for path resolution.

Implication: if you want unit-testable rendering logic, **export the formatter from the tool file**. Don't bother trying to spin up `McpServer` in tests — that's not the established idiom here.

---

## 2. SKELETON — copy / paste / rename

This skeleton compiles under the upstream repo's `tsconfig.json` (strict, Node16, ESM with `.js` extensions). Replace every `MyTool` / `MyDep` / `MyInput` / `my_tool_name` placeholder.

```ts
// src/tools/my-tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Pick the dep(s) your tool needs. Delete the unused imports.
import type { SearchEngine } from "../index/search-engine.js";
import type { WorkbenchClient } from "../workbench/client.js";
import type { Config } from "../config.js";
import { formatConnectionStatus } from "../workbench/status.js"; // only for wb-* tools
import { logger } from "../utils/logger.js";

// -------- Private types --------
interface MyToolResult {
  // The shape of one rendered item, if helpful for readability.
  id: string;
  label: string;
}

// -------- Pure helpers (EXPORT if you want to unit-test them) --------
export function formatMyToolResult(r: MyToolResult, verbose: boolean): string {
  const lines: string[] = [];
  lines.push(`## ${r.label}`);
  if (verbose) {
    lines.push("");
    lines.push(`ID: ${r.id}`);
  }
  return lines.join("\n");
}

// -------- Registration --------
export function registerMyTool(
  server: McpServer,
  // Replace `dep` with the actual injected dependency. Examples below.
  // - SearchEngine:    searchEngine: SearchEngine
  // - WorkbenchClient: client: WorkbenchClient
  // - Config:          config: Config
  dep: SearchEngine,
): void {
  server.registerTool(
    "my_tool_name",
    {
      description:
        "One dense paragraph. Lead with verb-noun. Mention close-cousin tools to disambiguate. " +
        "Surface non-obvious flags so the LLM picks them up.",
      inputSchema: {
        query: z.string().describe("What the caller is looking for"),
        scope: z.enum(["a", "b", "all"]).default("all").describe("Narrow the search"),
        limit: z.number().min(1).max(50).default(20).describe("Maximum results to return"),
        verbose: z.boolean().default(false).describe("Include extended metadata in each result"),
      },
    },
    async ({ query, scope, limit, verbose }) => {
      try {
        // 1. Do the work using `dep`.
        const results: MyToolResult[] = []; // ← replace with real call
        // e.g. const results = dep.searchSomething(query, scope, limit);

        // 2. Handle empty result — NOT an error, just a soft fail with guidance.
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No matches for "${query}". Try broadening — drop the scope filter or shorten the query.`,
              },
            ],
          };
        }

        // 3. Render. Use verbose=true when there's only one result.
        const effectiveVerbose = verbose || results.length === 1;
        const header = `Found ${results.length} match${results.length !== 1 ? "es" : ""}:\n`;
        const body = results
          .map((r) => formatMyToolResult(r, effectiveVerbose))
          .join("\n\n---\n\n");

        return { content: [{ type: "text", text: header + body }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`my_tool_name failed: ${msg}`);
        return {
          content: [{ type: "text" as const, text: `Error running my_tool_name: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
```

**For Workbench-client tools (RPC-backed)**, change the body to mirror `wb-state.ts`:

```ts
async (_input) => {
  try {
    const result = await client.call<Record<string, unknown>>("EMCP_MY_HANDLER", {
      /* args */
    });
    const text = renderResult(result); // your formatter
    return { content: [{ type: "text" as const, text: text + formatConnectionStatus(client) }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text" as const, text: `Error: ${msg}${formatConnectionStatus(client)}` }],
      isError: true,
    };
  }
};
```

### Wiring in `src/server.ts`

Add one line in the relevant phase block:

```ts
import { registerMyTool } from "./tools/my-tool.js";
// ...
registerMyTool(server, searchEngine); // or config, or wbClient
```

---

## 3. Which existing tool each new one most closely resembles

| New tool               | Closest analog                   | Why                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve_guid`         | **`asset-search`**               | Both consume the same GUID-indexed asset table (`buildGuidIndex` already exists in `asset-search.ts`), both take Config, both are read-only lookups returning a small structured list. `resolve_guid` is essentially `asset-search` with a different scorer (exact GUID match → unique result, no fuzzy filename ranking). Same `(server, config)` signature; same try/catch + `isError` for missing game path.            |
| `find_references`      | **`api-search`** with pagination | Same shape: bounded-query → ranked-list → markdown render. Difference: result set can be unbounded (a popular GUID might be referenced in 10k+ files), so this is the one tool where we **must** introduce pagination. SearchEngine dep, optionally a new `ReferenceIndex` dep if we build a dedicated SQLite-backed index. See §4.                                                                                        |
| `project_index_status` | **`wb-state`**                   | Pure status reporter with `inputSchema: {}` (no args). Returns a snapshot of internal state — index age, file count, last-rebuild timestamp, on-disk size. No external RPC, so no try/catch needed unless the index file is missing. If we build an `IndexManager` class, the signature is `registerProjectIndexStatus(server, indexManager)`. If we read straight off the filesystem via Config, it's `(server, config)`. |

---

## 4. Pagination guidance (for `find_references`)

No existing tool in the upstream repo paginates — they all use `limit` + `slice` + `"... and N more"`. For `find_references` we need a real cursor because the result set is genuinely unbounded and callers may need every match (e.g., a refactor sweep).

### 4.1 Schema additions

```ts
inputSchema: {
  guid: z
    .string()
    .regex(/^[0-9A-Fa-f]{16}$/, "GUID must be a 16-char hex string")
    .describe("Resource GUID to find references to (no braces)"),
  limit: z
    .number()
    .min(1)
    .max(200)
    .default(20)
    .describe("Maximum references to return per page (1–200, default 20)"),
  cursor: z
    .string()
    .optional()
    .describe("Opaque pagination token from a previous response's next_cursor"),
}
```

### 4.2 Response shape

For paginated tools, the markdown text MUST surface the cursor and totals; the LLM can't see structured fields the way a programmatic client could. Render:

```
Found 2,431 references to {657590C1EC9E27D3} (showing 1–20):

  1. Prefabs/Vehicles/Wheeled/UAZ/UAZ_469.et:42 — m_Prefab
  2. ...
  ...
  20. ...

next_cursor: eyJvIjoyMCwiZyI6IjY1NzU5MEMxRUM5RTI3RDMifQ==
total_count: 2431

Call find_references again with cursor: <next_cursor> to get the next page.
```

Surface `next_cursor` and `total_count` in plain text inside the response. Don't bother with a structured-content channel — this codebase doesn't use one and it'd be a one-off.

### 4.3 Opaque cursor encoding

Cursors should be opaque to the caller. Base64-encode a tiny JSON struct so we can later add fields without breaking the wire format.

```ts
interface CursorPayload {
  o: number; // offset
  g: string; // GUID — sanity-check on decode so cursors aren't reusable across queries
  v: 1; // schema version, for forward compatibility
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

function decodeCursor(s: string, expectedGuid: string): CursorPayload {
  let parsed: CursorPayload;
  try {
    parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf-8"));
  } catch {
    throw new Error("Invalid cursor: not base64url-encoded JSON");
  }
  if (parsed.v !== 1) throw new Error(`Invalid cursor: unsupported version ${parsed.v}`);
  if (parsed.g !== expectedGuid) {
    throw new Error("Cursor does not match the current GUID query (cursors are per-query)");
  }
  if (!Number.isInteger(parsed.o) || parsed.o < 0) {
    throw new Error("Invalid cursor: bad offset");
  }
  return parsed;
}
```

Why bind the cursor to the GUID: prevents the LLM from accidentally reusing a cursor from one query as input to another, which would silently return garbage. Decode throws → tool catches → `isError: true` with a clear message.

### 4.4 Concrete SQLite pagination sketch

Assuming the index is SQLite-backed with a table like:

```sql
CREATE TABLE references (
  id          INTEGER PRIMARY KEY,
  guid        TEXT NOT NULL,            -- 16-char hex, uppercase
  file_path   TEXT NOT NULL,            -- relative to project root
  line        INTEGER NOT NULL,         -- 1-based
  context     TEXT,                     -- field name, or surrounding code snippet
  indexed_at  INTEGER NOT NULL          -- unix epoch
);
CREATE INDEX idx_references_guid ON references(guid);
```

The handler body — drop into the skeleton's try block:

```ts
async ({ guid, limit, cursor }) => {
  try {
    const normalizedGuid = guid.toUpperCase();

    // 1. Decode cursor (or start at offset 0).
    const offset = cursor ? decodeCursor(cursor, normalizedGuid).o : 0;

    // 2. Get total count ONCE — cache it under a query key so subsequent pages
    //    don't re-COUNT(*) the same table. Skip the cache for the first page.
    const totalCount = db
      .prepare("SELECT COUNT(*) AS n FROM references WHERE guid = ?")
      .get(normalizedGuid) as { n: number };

    if (totalCount.n === 0) {
      return {
        content: [{ type: "text", text: `No references found for {${normalizedGuid}}.` }],
      };
    }

    // 3. Fetch one page. Stable ORDER BY id so pagination is deterministic.
    const rows = db
      .prepare(
        `SELECT file_path, line, context
         FROM references
         WHERE guid = ?
         ORDER BY id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(normalizedGuid, limit, offset) as Array<{
      file_path: string;
      line: number;
      context: string | null;
    }>;

    // 4. Compute next-cursor only if there's more.
    const nextOffset = offset + rows.length;
    const hasMore = nextOffset < totalCount.n;
    const nextCursor = hasMore ? encodeCursor({ o: nextOffset, g: normalizedGuid, v: 1 }) : null;

    // 5. Render.
    const start = offset + 1;
    const end = offset + rows.length;
    const lines: string[] = [];
    lines.push(
      `Found ${totalCount.n} reference${totalCount.n !== 1 ? "s" : ""} to {${normalizedGuid}} ` +
        `(showing ${start}–${end}):\n`,
    );
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ctx = r.context ? ` — ${r.context}` : "";
      lines.push(`  ${start + i}. ${r.file_path}:${r.line}${ctx}`);
    }
    lines.push("");
    lines.push(`total_count: ${totalCount.n}`);
    if (nextCursor) {
      lines.push(`next_cursor: ${nextCursor}`);
      lines.push("");
      lines.push(
        "Call `find_references` again with `cursor` set to the value above to get the next page.",
      );
    } else {
      lines.push("(no more pages)");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text" as const, text: `Error finding references: ${msg}` }],
      isError: true,
    };
  }
};
```

### 4.5 Pagination caveats

- **`COUNT(*)` is O(n) without a covering index.** With `idx_references_guid` it's fast for any single GUID. If you allow filtering on additional columns (e.g., file extension), make sure the index covers them or accept slower first-page latency.
- **Stable sort is mandatory.** `ORDER BY id ASC` works because IDs are monotonic. If you re-index between page calls, IDs may shift and pages will skip or duplicate rows. If the index can mutate mid-pagination, encode `indexed_at` into the cursor and filter `WHERE indexed_at <= ?` so each pagination sees a consistent snapshot.
- **`LIMIT ... OFFSET ...` degrades on huge offsets.** For result sets >100k, switch to keyset pagination (`WHERE id > ?` instead of `OFFSET ?`) and encode the last seen ID in the cursor instead of an offset.
- **Bind the cursor to the query.** Done above via the `g` field. Without this, the LLM will mix cursors across queries and you'll get confused-looking results that pass type-checks.

---

## Patterns observed

A few non-obvious things surfaced during the deep read that aren't elsewhere in the file:

- **`inputSchema` is a raw object, not `z.object(...)`.** Easy to get wrong if you've used older MCP SDKs — `z.object({...})` will type-check but the SDK won't see the field shapes. Pass the bare `{ field: z.string() }` form.
- **`type: "text" as const`** appears in `wb-state` but not `api-search`. Both work; TypeScript with strict mode sometimes needs the `as const` widening when the object is constructed inside a conditional. Use it defensively if the compiler complains.
- **`server.tool` vs `server.registerTool`**: only the latter is used. The `tool()` helper is the older terser SDK API; the codebase has standardized on `registerTool()` for the explicit shape. Match the convention.
- **`asset-search.ts` already has a GUID→prefab index** (`buildGuidIndex` at lines 42–80, with cache at module scope). For `resolve_guid`, you can almost certainly reuse this rather than building a parallel index. Worth checking whether to refactor it into a shared `src/index/guid-index.ts` before duplicating.
- **No tool throws out of its handler.** Even `api-search` and `component-search`, which don't use try/catch, only fail soft — `SearchEngine` itself never throws on bad input. If your new tool's dep can throw (file IO, SQLite, RPC), wrap the handler body in try/catch and return `isError: true`. Don't let it propagate.
- **No structured-content responses anywhere.** Every response is `{ content: [{ type: "text", text }] }`. Don't introduce structured content for the new tools — it'd be the only place using it, and the LLM consumes the text channel either way.
- **Tests target exported pure formatters, not handlers.** If you want unit coverage for `resolve_guid` / `find_references` / `project_index_status`, factor the rendering into an exported helper and test that with a real (or fixtured) dep. Don't try to instantiate `McpServer` in a unit test — no example to follow.
- **Cursor binding is not just paranoia.** Tested mentally against the LLM's typical call pattern: it WILL reuse a cursor from a different query if the schema lets it. The GUID check in `decodeCursor` is cheap insurance.

---

## 5. Patterns added during L4-L8

The patterns above (§1-§4) cover the upstream shape and the first L1 paginated tool. L4-L8 added five recurring patterns that every new tool in this codebase now respects. Internalize these before writing a new tool — most v1.0.0 tools use 2-4 of them simultaneously.

### 5.1 Cursor-helper pattern (paginated tools)

§4 specs cursor encoding for a paginated tool. **L2+ tools that touch the project-index** use the same pattern, with the per-query binding adapted to whatever discriminator the query has (GUID, source kind, project_id). The shape:

```ts
interface CursorPayload {
  o: number;      // offset
  v: 1;           // schema version
  // ... query-specific binding fields (g, p, k, etc) — whatever discriminates
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf-8").toString("base64url");
}

function decodeCursor(s: string, expected: { /* binding */ }): CursorPayload {
  // 1. base64url-decode + JSON.parse, throw on malformed
  // 2. Check version
  // 3. Check binding fields match expected — throw if mismatch
  // 4. Validate offset is non-negative integer
}
```

Pattern checklist for any new paginated tool:

- `limit: z.number().min(1).max(200).default(20)` in inputSchema.
- `cursor: z.string().optional()` in inputSchema.
- `decodeCursor` throws → tool catches → returns `isError: true` with a clear message about the bad cursor.
- Render `total_count`, `next_cursor`, and "(no more pages)" in plain markdown text. Do not introduce structured content.
- Bind the cursor to whatever discriminator the query has (per-query, NOT just per-tool). Mixing cursors across queries should fail loudly.

Reference impl: `src/tools/find-references.ts`.

### 5.2 EMCP-handler pattern (Node-side wrapper + Enforce-side handler split)

L7 introduced the architecture for live-Workbench tools that need behavior the upstream `wb_*` handlers don't cover. The pattern splits cleanly:

**Node-side (`src/tools/<feature>.ts`):**

```ts
const resp = (await (client.call as (
  m: string,
  a: Record<string, unknown>,
) => Promise<HandlerResponse>)("EMCP_WB_<Domain>", {
  action: "<verb>",
  ...args,
})) ?? {};

if (resp.status === "not_implemented") {
  return { content: [{ type: "text", text:
    `<Feature> is not yet implemented in the Workbench-side handler. ` +
    `Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_<Domain> <verb>). ` +
    `Underlying message: ${resp.message ?? "(none)"}`,
  }] };
}
if (resp.status !== "ok") {
  return { content: [{ type: "text", text: `Handler error: ${resp.message ?? "(no message)"}` }],
    isError: true };
}
// resp.payload is a JSON-encoded action-specific blob
const data = JSON.parse(resp.payload ?? "{}");
// ... render to markdown
```

**Enforce-side (`mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_<Domain>.c`):**

```enforce
class EMCP_WB_<Domain>Request : JsonApiStruct {
  string action;
  // ... per-action fields
}
class EMCP_WB_<Domain>Response : JsonApiStruct {
  string status;     // "ok" | "error" | "not_implemented"
  string message;
  string payload;    // JSON-encoded action-specific data
}
class EMCP_WB_<Domain> : NetApiHandler {
  override JsonApiStruct GetResponse(JsonApiStruct request) {
    // switch on req.action; dispatch to per-action methods
  }
}
```

Pattern checklist:

- One Enforce-side handler per domain (terrain, character, job, …), **not** one per action. Hard cap ≤15 handler files at v1.0.0 (per `docs/L7-PLAN.md`).
- `action` field discriminates inside the handler. Node-side tools call into the dispatcher with `{ action, ...args }`.
- Use `payload: string` for any structured response richer than a flat field list. Node side parses as JSON.
- Reserve `status: "not_implemented"` for placeholder actions — every L7 placeholder tool checks for this and surfaces a structured "not yet wired" message rather than an opaque error.
- Always handle the "handler not deployed" case explicitly (the `client.call` rejects with "unknown" or "not found") with a message pointing at `docs/L7-PLAN.md` so the user can deploy the missing `.c` file.

Reference impls: `src/tools/terrain-inspect.ts`, `src/tools/terrain-navmesh-status.ts`, `src/tools/terrain-road-export-graph.ts`.

### 5.3 planFileEdit pattern (byte-edit + .bak sidecar)

L5 introduced the refactor cluster. Every commit-shaped tool (refactor_*, script_format, scenario_clone_area, scenario_apply_template, faction_create) uses the same byte-edit core:

```ts
import { planFileEdit, atomicCommit, type PendingEdit } from "../refactor/byte-edit.js";

// 1. Build the edit (returns null if no matches → tool reports no-op).
const edit = planFileEdit(filePath, /<pattern>/g, (match, ...captures) => {
  return /* replacement */;
});
if (!edit) {
  return { content: [{ type: "text", text: "(no-op — no matches)" }] };
}

// 2. Commit. atomicCommit handles .bak sidecars + journal + rollback.
//    Throws on git-clean refuse unless options.force === true.
try {
  atomicCommit([edit], { force, keepBackup: true });
} catch (e) {
  return { content: [{ type: "text", text: `Refused: ${(e as Error).message}` }],
    isError: true };
}
```

Pattern checklist:

- **Dry-run by default.** Inputs include `commit: z.boolean().default(false)` (or `dry_run: z.boolean().default(true)`). The tool returns the plan (or a count + sample) in dry-run mode; only flips to writing when explicit.
- **`.bak` sidecars** are always created (`keepBackup: true`) — they persist after a successful commit so the human has a manual revert path.
- **Git-clean refuse** is on by default — `atomicCommit` checks `checkGitState` per file and throws if any file has uncommitted changes. `force: z.boolean().default(false)` overrides.
- **`planFileEdit` returns `null`** when the pattern matches nothing. Tools must handle this case — render an informational "no-op" rather than `isError`.
- **Multi-file edits** pass an array of `PendingEdit`. `atomicCommit` is all-or-nothing: a mid-commit failure rolls every file back from its `.bak`.
- **Refuse non-target file types even with `force: true`.** E.g., `script_format` refuses anything not ending in `.c` even when `force: true` is set — defense in depth against an LLM passing the wrong path argument.

Reference impls: `src/refactor/byte-edit.ts` (`atomicCommit` line 438, `planFileEdit` line 741), `src/tools/refactor-replace-guid.ts`, `src/tools/script-format.ts`.

### 5.4 Flag-smuggle guard (rejectFlagShape before resolve())

Every tool that takes a path as input **must** reject values starting with `-` BEFORE calling `resolve()`. Otherwise `resolve()` masks the leading dash by prepending CWD, and downstream code (especially CLI-wrapping tools like `wb_validate_scripts`, `wb_build_data`, `wb_cli_run`) can be tricked into treating a path as a flag.

Two equivalent shapes in the codebase:

**Inline check (most tools):**

```ts
if (script_path.startsWith("-")) {
  return {
    content: [{ type: "text" as const, text: "Invalid script_path: must not start with '-'" }],
    isError: true,
  };
}
const fullPath = resolve(script_path);
```

**Helper function (L8 tools — `animation-find-unused-clips`, `weapon-pose-lint`, `scenario-clone-area`, `scenario-apply-template`):**

```ts
function rejectFlagShape(label: string, raw: string): void {
  if (raw.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-' (flag-smuggle guard)`);
  }
}
// in handler:
rejectFlagShape("agr_path", agr_path);
```

Pattern checklist:

- Run the check on the **raw user input**, BEFORE `resolve()`. After `resolve()`, the leading dash is gone.
- Run the check on **every** path-shaped input independently. A single guard at the top of the handler is fine; one missing check is a vulnerability.
- For arrays of paths, loop and check each element.
- The `.describe()` text on the schema field should mention the guard so the LLM doesn't try to "fix" a leading dash.

Reference impls: `src/tools/script-analyze.ts:118-126` (inline), `src/tools/weapon-pose-lint.ts:24-28` (helper).

### 5.5 Path-containment guard (assertInsideRoot from src/utils/path-guard.ts)

When a tool writes files or runs operations against a user-supplied path that should stay inside the user's project, use `assertInsideRoot` from `src/utils/path-guard.ts`. Complements the flag-smuggle guard — that one prevents flag injection, this one prevents directory traversal.

```ts
import { assertInsideRoot } from "../utils/path-guard.js";

const dest = resolve(dest_layer_path);
assertInsideRoot(dest, config.projectPath, "dest_layer_path");
// dest is now confirmed to be inside (or equal to) config.projectPath
```

Implementation uses a trailing-separator check so prefix collisions (`C:\Proj` vs `C:\ProjEvil`) don't false-pass.

Pattern checklist:

- Use for **write paths**, not read paths. (`safe-read.ts` covers reads.)
- The `label` argument is the user-facing input name — when the throw fires, the error message names the bad argument.
- The `root` argument is usually `config.projectPath` for L8 scenario/faction tools. Pass through `config` to your `register*` function if it's not already there.
- The `resolved` argument must already be `resolve()`-ed. Don't pass raw user input.

Reference impls: `src/utils/path-guard.ts:33` (`assertInsideRoot`), `src/utils/path-guard.ts:23` (`isPathInsideRoot` for boolean-shape).

### 5.6 File-size cap (readTextFileBounded from src/utils/safe-read.ts)

Tools that walk user / workshop project trees use `readTextFileBounded` instead of `readFileSync(path, "utf-8")` to cap how much data goes into memory. CWE-770 fix — prevents a malicious or corrupt asset from OOMing the Node process.

```ts
import { readTextFileBounded, MAX_TEXT_FILE_BYTES } from "../utils/safe-read.ts";

// Default cap (8 MiB):
const text = readTextFileBounded(absPath);

// Custom cap if you legitimately need more:
const text = readTextFileBounded(absPath, 32 * 1024 * 1024);
```

The cap is checked via `statSync` BEFORE the read, so an oversize file never gets buffered.

Pattern checklist:

- Use for **every** read of user-supplied content during a project walk. The single-file `script_*` tools that read one explicit path are less risky but should still use it.
- Use the default (`MAX_TEXT_FILE_BYTES = 8 MiB`) unless you have a real reason to bump it. The largest legitimate `.agf` / `.asi` / `.agr` / `.conf` / `.et` we've seen is well under 8 MiB.
- Write paths don't use this — they have their own containment guards (the L5 byte-edit core). This is read-side only.
- Surfaces a clear error on the cap trip: `"File too large: <path> (<actual> bytes > <cap> byte cap)"`. Catch and surface as a regular tool error.

Reference impl: `src/utils/safe-read.ts:33`.

---

## 6. Pattern checklist for a new v1.0.0+ tool

Skim this list before opening a new `src/tools/<name>.ts`:

- [ ] `inputSchema` is a raw object (not `z.object({})`).
- [ ] Every field has `.describe(...)`.
- [ ] `limit` (if present) is `.min(1).max(50-200).default(10-20)`.
- [ ] Every path input has a flag-smuggle guard (`.startsWith("-")` check or `rejectFlagShape`) BEFORE `resolve()`.
- [ ] Write paths go through `assertInsideRoot` if the tool writes outside its own data dir.
- [ ] Read paths go through `readTextFileBounded` if they touch user-supplied content.
- [ ] Handler is `async (input) => { ... }`, returning `{ content: [{ type: "text", text }] }` or `{ content: [...], isError: true }`.
- [ ] `try/catch` around any IO / RPC / SQLite call. Never let an exception propagate.
- [ ] If commit-shaped: defaults `commit: false` / `dry_run: true`, uses `planFileEdit` + `atomicCommit`, keeps `.bak` sidecars.
- [ ] If paginated: cursor is base64url-encoded JSON with a per-query binding field.
- [ ] If EMCP-handler-backed: dispatches via `client.call("EMCP_WB_<Domain>", { action, ... })`, handles `"not_implemented"` and "handler not deployed" cases explicitly.
- [ ] Wired into `src/server.ts` via a `register<Name>(server, ...deps)` call.
- [ ] Pure formatters exported for unit testing.
- [ ] Description string mentions close-cousin tools and surfaces non-obvious flags.
