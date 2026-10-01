# Conventions

Style guide for the `Enfusion-Workbench-MCP-Goldwep` fork. Goal: any module we add (project-index, file watcher, paginated query tools, etc.) should be indistinguishable from upstream code by shape alone.

These rules are extracted from `steffenbk/enfusion-mcp-BK@main`. When upstream evolves, this document trails it — re-derive on major drift.

---

## 1. Naming

### File names

- **Always kebab-case.** `search-engine.ts`, `safe-path.ts`, `prefab-ancestry.ts`, `wb-entity-duplicate.ts`.
- Tool files mirror the tool name with `_` → `-`: tool `component_search` lives in `src/tools/component-search.ts`.
- Workbench tools are prefixed `wb-`: `wb-entities.ts`, `wb-clipboard.ts`. They register tools named `wb_*`.
- Test files are siblings of code structure under `tests/`, named `<source-file>.test.ts`. `src/utils/fuzzy.ts` → `tests/utils/fuzzy.test.ts`.
- No `index.ts` barrels inside subdirectories. The only `index.ts` is the binary entry at `src/index.ts`. Re-export indirection is avoided — consumers import the concrete file.

### Tool names (MCP-visible)

- Snake_case, verb after noun: `component_search`, `game_browse`, `wb_entity_duplicate`, `script_create`.
- Domain prefix is part of the name (`wb_`, `game_`, `wiki_`). Don't drop the prefix even if it feels redundant.

### Exports

- **Named exports only.** No `export default` anywhere in `src/`.
- Each module exports its public surface explicitly: types, classes, helpers, and the `registerXxx(server, ...)` registration function.
- Tool modules export exactly one function: `export function registerXxx(server: McpServer, ...deps): void`.

### TypeScript identifiers

- **Types and interfaces: `PascalCase`.** Use `interface` for object shapes that callers consume (`Config`, `ClassInfo`, `WorkbenchState`, `DirEntry`, `IndexData`). Use `type` only for unions, primitives, or aliases (`type WorkbenchMode = "edit" | "play" | "unknown"`, `type ScriptType = ...`). Never mix the two for the same shape.
- **Variables, parameters, functions: `camelCase`.** `searchEngine`, `validateFilename`, `loadConfig`, `componentIndex`.
- **Class members:** plain `camelCase` for public, plain `camelCase` (private keyword) for private. No `_` prefix on private fields except where they shadow a getter — see `WorkbenchClient` where `_state` backs the `state` getter.
- **Constants (module-level, immutable):** `SCREAMING_SNAKE_CASE`. Examples: `DEFAULT_WORKBENCH_PATH`, `DEFAULTS`, `MAX_RESPONSE_SIZE`, `LAUNCH_TIMEOUT_MS`, `MAX_DEPTH`, `DEFAULT_CLIENT_ID`, `FILE_TYPE_MAP`, `HANDLER_FOLDER`.
- **Generated identifiers (Enforce Script side):** any _value_ destined for `.c` / `.et` / `.gproj` files uses the upstream Enfusion conventions (`m_sDisplayName`, `TAG_MyClass`, `SCR_BaseGameMode`). Validate user-supplied identifiers with `validateEnforceIdentifier`.
- **Filename validation** for user-supplied names uses `validateFilename` (path traversal + Windows reserved characters/names).

### Environment variables

All env vars are `SCREAMING_SNAKE_CASE` prefixed with `ENFUSION_`:
`ENFUSION_WORKBENCH_PATH`, `ENFUSION_PROJECT_PATH`, `ENFUSION_GAME_PATH`, `ENFUSION_EXTRACTED_PATH`, `ENFUSION_MCP_DATA_DIR`, `ENFUSION_MCP_DEBUG`, `ENFUSION_DEFAULT_MOD`.

When adding env vars in our fork, keep the `ENFUSION_` prefix.

---

## 2. Imports

### Order

Strict ordering, blank line between groups optional but absent in most upstream files:

1. **`node:` builtins** — always with the `node:` scheme. Never bare (`import { readFileSync } from "node:fs"`, not `from "fs"`).
2. **External packages** — `@modelcontextprotocol/sdk/...`, `zod`, `cheerio`, etc.
3. **Internal relative imports** — `./`, `../`, with **`.js` extension** on every TypeScript import (NodeNext module resolution requires it). `import { logger } from "../utils/logger.js"` resolves to `logger.ts` at compile.
4. **Type-only imports** — `import type { ... }` for things only used in type positions. Mixed value/type imports use a `type` modifier on individual specifiers when needed (`import { z, type ZodSchema } from "zod"` is the style if both are used, but upstream usually splits them into two lines for clarity).

### Examples (from upstream)

```ts
// src/index/loader.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../utils/logger.js";
import type { ClassInfo, GroupInfo, WikiPage } from "./types.js";
```

```ts
// src/tools/game-browse.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { relative, extname } from "node:path";
import type { Config } from "../config.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { resolveGameDataPath } from "../utils/game-paths.js";
import { listDirectory, getFileType, formatSize } from "../utils/dir-listing.js";
import { logger } from "../utils/logger.js";
```

Note: tool files in upstream actually put the `McpServer` type-import _first_, before `node:` imports — this is the one exception to "node first". The `McpServer` type is universal for every tool module, so it acts as a marker import. Follow that pattern in our tool modules.

### Style rules

- **Double-quoted strings.** No single quotes anywhere in source.
- Semicolons everywhere.
- **No `import * as X`** unless required by an external library. All imports name what they pull.
- Destructure on import — never `import path from "node:path"; path.resolve(...)`. Always `import { resolve } from "node:path"`.

---

## 3. Error handling

The project uses a deliberate hybrid: **throw for invariant violations, return error responses for user-facing tool failures, custom Error subclass for protocol-level failures**.

### Throwing

- Internal validation helpers throw `Error` with a human-readable message. `validateFilename`, `validateEnforceIdentifier`, `safePath`, `validateProjectPath` all throw on bad input. The thrown message is what the user eventually sees, so it must be self-explanatory.
- Throw at the boundary where invariant is established. Don't validate twice.

### Catching

Tool handlers wrap their body in `try { ... } catch (e) { ... }` and convert to MCP error responses:

```ts
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text", text: `Error <verb>: ${msg}` }],
    isError: true,
  };
}
```

Three load-bearing details:

1. **`e instanceof Error ? e.message : String(e)`** — upstream never assumes `e` is an Error. Use exactly this idiom.
2. **`isError: true`** is set on the response object, not thrown out of the handler. The MCP SDK distinguishes "tool returned an error" from "tool crashed."
3. The text starts with `"Error <verb>: ..."` (e.g., `"Error browsing game files: ..."`, `"Error creating script: ..."`). Lowercase verb, colon, message.

### Loader / index code

Functions that load resources at startup (`loadJsonFile`, `loadJson`, pattern loader) **catch and log, return a fallback**. They never throw, because the server must still start even if one index file is missing or corrupt:

```ts
function loadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    logger.warn(`Index file not found: ${filePath}`);
    return fallback;
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (e) {
    logger.error(`Failed to parse index file ${filePath}: ${e}`);
    return fallback;
  }
}
```

Distinguish `SyntaxError` from other read errors when the message will help the user (see `loadJsonFile` in `config.ts`).

### Custom error subclass — only when callers need to discriminate

`WorkbenchClient` defines `WorkbenchError extends Error` with a typed `code` field (`"CONNECTION_REFUSED" | "TIMEOUT" | "PROTOCOL_ERROR" | "API_ERROR" | "LAUNCH_FAILED"`). This is the only custom error in the codebase, justified because callers branch on `.code` to decide whether to auto-relaunch or surface to the user.

**Do not invent new Error subclasses** unless the same justification applies. For validation, plain `throw new Error("...")` is correct.

### No `Result<T, E>` or `neverthrow`

The codebase does not use Result types. Don't introduce them in our fork.

### Silent swallow is allowed, narrowly

When iterating directory entries for opportunistic discovery, upstream uses `try { ... } catch { /* ignore */ }` or `try { ... } catch { /* skip */ }`. The empty catch is fine when the loop's purpose is "find what you can, ignore what you can't" — e.g., `findGproj`, `listDirectory` size lookups, `prefab-ancestry` fallback chains. Always include the comment (`/* ignore */` or `/* skip */`) so it's visibly intentional.

For everything else, `logger.debug(...)` the error inside the catch.

---

## 4. Async patterns

### `await` and registration

- Tool handlers passed to `server.registerTool(..., async ({ args }) => { ... })` are `async`. The handler body may not use `await` at all — that's fine, the `async` is still required by the MCP type signature.
- The top-level `await server.connect(transport)` lives in `src/index.ts`. The repo relies on top-level await (ES2022 + `"type": "module"`).

### TCP / network

`WorkbenchClient.rawCall` uses `node:net` directly with a `Socket` + `setTimeout` + manual promise wiring. No `AbortController` is used in the upstream code — timeouts are set on the socket via `socket.setTimeout(timeout)`, errors on `socket.on("error", ...)`, completion on `socket.on("end", ...)`.

When we add async I/O (e.g., the file watcher), use the same pattern: native Node primitives, promise-wrap with explicit handlers. **Do not introduce `AbortController` or third-party async utilities** unless there's a concrete reason the native API can't express it.

### Auto-launch / retry

`WorkbenchClient.call` wraps `rawCall` with launch-and-retry logic, gated by a `private launchPromise: Promise<void> | null` so concurrent calls share a single launch attempt. This is the canonical idiom for "guard a one-time async setup with a memoized promise."

```ts
private launchPromise: Promise<void> | null = null;

private launch(): Promise<void> {
  if (this.launchPromise) return this.launchPromise;
  this.launchPromise = doLaunchActually().finally(() => {
    this.launchPromise = null;  // reset after completion so a future call can retry
  });
  return this.launchPromise;
}
```

Use this pattern for the project-index loader if it ever becomes async (lazy reload, file watcher reindex).

### Polling

`waitForWorkbench` uses an explicit loop with `await new Promise((r) => setTimeout(r, interval))`. No external polling library, no `setInterval`. This is the only sleep idiom in the codebase.

### No generators, no streams, no observables

Code stays synchronous where it can. The search-engine builds its indexes eagerly in `load()` (called from constructor) and exposes synchronous query methods. Don't make the file watcher emit via an `EventEmitter` or AsyncIterator — wire it directly to a `SearchEngine.reload()` call.

### Numeric literals

Constants representing milliseconds use `_` separators for readability: `10_000`, `90_000`, `3_000`. Bytes: `10 * 1024 * 1024` (computed inline, not hex). Follow that.

---

## 5. Config injection

### Shape

```ts
// src/config.ts
export interface Config {
  workbenchPath: string;
  projectPath: string;
  gamePath: string;
  extractedPath?: string; // optional fields use `?:`
  dataDir: string;
  patternsDir: string;
  workbenchHost: string;
  workbenchPort: number;
  defaultMod?: string;
}
```

Every field has a one-line JSDoc comment above it (`/** ... */`), even when self-explanatory. **Do this for every Config field we add.**

### 4-tier merge (top wins)

`loadConfig()` builds Config in strict order:

1. **`DEFAULTS`** — module-level `const DEFAULTS: Config = { ... }`.
2. **Package-local file** — `<package-root>/enfusion-mcp.config.json`.
3. **User home file** — `~/.enfusion-mcp/config.json`.
4. **Environment variables** — `ENFUSION_*`.

Each tier uses `Object.assign(config, partial)` on the running object. JSON files load via `loadJsonFile` which returns `{}` on missing/bad files (logged as warn).

**Env vars use explicit `if (process.env.X) ...` per field** — no shortcut spread. This is so partial overrides don't unintentionally clobber other fields with `undefined`, and so type-narrowing (`parseInt` validation for ports) can live inline.

### Auto-derivation

If a value can be inferred from another, derive it **after** the explicit overrides — see `gamePath` deriving from `workbenchPath` only when env didn't set it and workbench differs from default. Comment the derivation.

### How Config flows into modules

**Constructor injection for stateful objects.** Long-lived classes take `Config` in the constructor and store it on a `private readonly` field:

```ts
constructor(
  private readonly host: string,
  private readonly port: number,
  private readonly config?: Config,
) {}
```

`SearchEngine` is the exception — it takes only the `dataDir: string` it needs, not the whole Config. Pass narrow primitives when the class only uses one field.

**Function argument for one-shot helpers / tool registration.** Tool registration functions take `Config` as a positional argument after `server`:

```ts
export function registerGameBrowse(server: McpServer, config: Config): void { ... }
export function registerScriptCreate(server: McpServer, config: Config, searchEngine?: SearchEngine): void { ... }
export function registerGameDuplicate(server: McpServer, config: Config, wbClient: WorkbenchClient): void { ... }
```

Order: `server` first, `config` second, other deps after. Optional deps last with `?`.

`server.ts` is the wiring layer. It builds `SearchEngine`, `PatternLibrary`, `WorkbenchClient` once, then passes the right subset to each tool's `registerXxx`. Don't have tools fetch their own deps from a global.

### No DI container, no service locator

`server.ts` is plain procedural wiring. We will not introduce a DI library.

---

## 6. Tool registration

### Shape (canonical)

```ts
export function registerXxx(server: McpServer /* deps */): void {
  server.registerTool(
    "xxx_yyy",
    {
      description: "One sentence saying what it does, then guidance on when to use it.",
      inputSchema: {
        param: z.string().describe("What this param means and how the model should fill it"),
        // ...
      },
    },
    async ({ param }) => {
      try {
        // logic
        return {
          content: [{ type: "text", text: formattedOutput }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Error doing thing: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
```

### Zod schema conventions

- **Always `.describe(...)`** on every field. The description is the model's only signal for how to fill it.
- Enums for closed sets: `z.enum(["enfusion", "arma", "all"]).default("all")`.
- Numeric ranges: `z.number().min(1).max(50).default(20)`.
- Optionals: `z.string().optional()` for "may be omitted entirely", `.default("...")` for "has a sensible default".
- The descriptor includes guidance for the _model_, not the developer. Mention modding terms ("addon root", "prefab", "ScriptComponent descendants") rather than implementation terms.

### Description string

Tool `description` is one or two sentences:

- What it does (verb-led).
- When to reach for it vs. alternatives.
- Critical "do not" warnings if applicable (e.g., `game_browse`: "Do NOT try to use filesystem tools on the game install directory").

Concatenate long descriptions with `+ " "` rather than template literals, matching upstream.

### Response format

- `content: [{ type: "text", text: ... }]` — always.
- Text is **human-readable markdown-ish prose**, not JSON. The model is the consumer.
- Format helpers are file-local functions named `formatXxx(...)` returning `string`. Build with `const lines: string[] = []; lines.push(...); return lines.join("\n")` — never with template-literal concatenation that hides whitespace.
- Headers: `## Title`, `### Subsection`. Padding: `entry.name.padEnd(40)` for tabular alignment.
- Singular/plural: `Found ${n} component${n !== 1 ? "s" : ""}` — explicit ternary, no Intl.PluralRules.

### Empty-result responses

Don't silently return "[]" — return a helpful text message:

```ts
if (results.length === 0) {
  return {
    content: [
      {
        type: "text",
        text: `No components found${filterDesc}. Try broadening your search — use a shorter query, remove the category filter, or search without an event filter.`,
      },
    ],
  };
}
```

The hint mentions which filters could be relaxed. Always include actionable next-step language.

---

## 7. Test structure (vitest)

### Layout

- Tests under `tests/<mirror of src>/<file>.test.ts`.
- Fixtures under `tests/fixtures/`. Real-shape sample files (e.g., `sample-class.html`, `sample-hierarchy.html`) — no synthetic minimalist fixtures unless testing the parser in isolation.
- No `beforeEach`/`afterEach` setup boilerplate unless the test requires it. Shared state is set up at the `describe` scope with `const engine = new SearchEngine(dataDir);`.

### Imports

```ts
import { describe, it, expect } from "vitest";
import { Thing } from "../../src/path/thing.js"; // .js extension required
```

For tests that load real index data:

```ts
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../data");
```

This is the canonical "where is my data" pattern in tests — use it verbatim.

### Nesting

- Top-level `describe` per exported function or class.
- Inner `describe` per method on a class: `describe("SearchEngine", () => { describe("getClass", () => { ... }) })`.
- `it("verbs the noun", ...)` — third person, present tense. Examples: `"finds IEntity"`, `"is case-insensitive"`, `"returns undefined for unknown class"`, `"rejects path separators"`.
- One assertion concept per `it`, but multiple `expect` calls in a single `it` are fine when they verify the same concept.

### Census row markers (2.0)

A test that proves a census row's tier (`tests[]` in `data/census/ledger.jsonl`, plan 1.4) must
contain the literal `census:<row id>` in its `it(...)` title or in a comment on the line above,
so `scripts/census/validate.ts` can confirm the test names the row it claims to cover.

### Assertions

- `expect(x).toBe(y)` for primitives and identity.
- `expect(x).toEqual([...])` for structural array/object equality.
- `expect(x).toBeDefined()` then `expect(x!.field)` — the non-null assertion is fine after a `toBeDefined`.
- `expect(x).toBeGreaterThan(n)` for size/count assertions where exact numbers would be flaky against real data.
- `expect(() => fn()).toThrow("substring")` — match by substring of error message, not full text.
- `expect(x).toMatch(/regex/)` for shape matching (GUID format, etc.).

### No mocks

The codebase **does not use vitest mocks** (`vi.mock`, `vi.spyOn`) in any tested file. Tests run against:

- Real loaded index data (`SearchEngine` tests use the actual `data/` directory).
- Hand-constructed inputs for parsers (`enfusion-text.test.ts`, `prefab-ancestry.test.ts`).
- Helper builders for structured data (see `makeLevel` in `prefab-ancestry.test.ts` — local function that builds an `AncestorLevel` from a simple object).

When tests need shaped data, write a tiny local helper in the test file. Don't pull in `sinon`, `proxyquire`, or test factories.

### Tolerance for real data

Where assertions touch scraped data that could shift, upstream uses inequality bounds (`toBeGreaterThan(8000)` for class count) and existence checks rather than exact equality. Follow that — exact-count assertions on the index break when the scrape refreshes.

### Test ordering

Tests inside a `describe` are independent. There's no shared mutable state. If you must mutate, scope a new object inside the `it`.

---

## 8. Logging

The logger lives at `src/utils/logger.ts`. It is a plain object literal, not a class, with four methods: `info`, `warn`, `error`, `debug`. All four write to **stderr only** via `console.error`. The header comment is load-bearing:

> Logger that writes exclusively to stderr — safe for stdio MCP transport. `console.log` is FORBIDDEN in stdio servers as it corrupts JSON-RPC messages.

### Never use `console.log`

Anywhere. In any module. In any branch. The stdio transport reads JSON-RPC from stdout; anything written there will corrupt the protocol stream. This rule has no exceptions — even temporary debugging during development should use `logger.debug`.

### Levels

- **`info`** — startup events, one-time milestones. Examples: `"Loaded index: N enfusion + M arma classes ..."`, `"enfusion-mcp server started"`. Use sparingly; one info line per significant lifecycle event.
- **`warn`** — recoverable problems where a fallback was used. Examples: `"Index file not found: ..."` (loader fell back to empty), `"Failed to load config from ...: invalid JSON: ..."` (config defaults retained), `"Failed to load pattern X: ..."`. The signature is `WARN: <what failed> + <what was done instead, implicit>`.
- **`error`** — unrecoverable failures that the loader handled by returning a fallback but where the user should investigate. `"Failed to parse index file ...: ..."` (file existed but JSON parse failed — louder than missing-file warn).
- **`debug`** — gated by `ENFUSION_MCP_DEBUG` env var. Use freely for trace-level info: config-loaded dump, pak VFS failures, individual file-read failures inside a fallback chain. **A debug line should not be needed for the server to function.** Examples from upstream: `"Failed to read ${path}: ${e}"`, `"Cannot read addon dir ${base}: ${e}"`, `"PAK VFS unavailable for game_browse: ${e}"`.

### Format

- `console.error` prefixes are baked into the logger: `[enfusion-mcp]` for info, `[enfusion-mcp] WARN:` for warn, etc. Don't add your own prefix.
- Messages are plain prose, not JSON. If you need structured data, pass it as the second argument: `logger.debug("Config loaded", config)` — `console.error` will format it.
- Don't log the user's full file paths to `info` unless they're already public knowledge (config dump on startup is fine because that's the whole point).

### What gets logged

- **Loaded counts**: every loader emits one `info` line with totals. The loader log includes both per-source counts and the grand total.
- **Fallback paths**: when a search falls back to fuzzy, when a file isn't found in mod project but is in pak — `debug`, not `info`. The user should not see these.
- **Per-call protocol traffic**: not logged. `WorkbenchClient.rawCall` is silent on success. Failures throw `WorkbenchError` and the caller decides whether to log.
- **Tool calls**: not logged. Adding tool-call logging would spam stderr; let the MCP host handle that.

### Adding new loggers

Don't. There's one `logger` and everyone imports it. Even if a subsystem (e.g., file watcher) feels like it deserves its own namespace, prefix the message instead: `logger.info("[watcher] reindexed 47 classes")`.

---

## 9. TypeScript compiler settings

From `tsconfig.json` — these are the load-bearing flags:

- `"target": "ES2022"` — supports top-level await, `Object.hasOwn`, error cause.
- `"module": "Node16"`, `"moduleResolution": "Node16"` — this is why every TS import ends in `.js`.
- `"strict": true` — strict null checks, no implicit any. Don't disable.
- `"esModuleInterop": true` — but prefer named imports anyway.
- `"declaration": true`, `"declarationMap": true`, `"sourceMap": true` — published artifacts include all three.
- `"resolveJsonModule": true` — JSON can be imported directly.

`tsconfig.build.json` narrows the source to `src/**/*` and excludes `tests/**` and `scripts/**`. Build artifacts go to `dist/`.

### `package.json` scripts

```
"clean":       "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\""
"build":       "npm run clean && tsc -p tsconfig.build.json"
"dev":         "tsx src/index.ts"
"scrape":      "tsx scripts/scrape.ts"
"test":        "vitest run"
"test:watch":  "vitest"
"prepare":     "npm run build"
```

- `tsx` for dev / scripts, never `ts-node`.
- `prepare` runs `build` so `npm install` from a git URL works.
- `vitest run` (one-shot) is the CI command. `vitest` (watch) is dev.
- No linter (no ESLint, no Prettier configs). The codebase relies on TypeScript strict mode + reviewer eyes. **Do not add a linter unilaterally** — that's a project-wide decision.

### `package.json` keys to preserve when we extend

- `"type": "module"` — required for the import style.
- `"engines": { "node": ">=20.0.0" }`.
- `"bin": { "enfusion-mcp": "./dist/index.js" }` — single binary. If our fork adds a CLI, name the bin field accordingly.
- `"files"`: ship `dist`, `data`, `mod`, `README.md`, `LICENSE`. Don't include `src` or `tests`.

---

## 10. Comments and docstrings

- **JSDoc block comment** (`/** ... */`) above every exported function, interface field, and class method that has non-obvious behavior. Examples are everywhere in `prefab-ancestry.ts`, `safe-path.ts`, `search-engine.ts`.
- Single-line internal notes use `//`.
- Section dividers in larger files use the box-drawing style:
  ```ts
  // ── Types ─────────────────────────────────────────────────────────────────────
  ```
  See `prefab-ancestry.ts`. Use these to delineate Types / Helpers / Public API / etc. in any file over ~150 lines.
- TODO comments: rare in upstream. When used, format is `// TODO: short description`. Don't tag with names.
- "Why" comments earn their place; "what" comments do not (the code is the what).

---

## Adoption notes

### Adopt verbatim

- File naming (kebab-case, no barrels).
- Import order, `.js` extension on TS imports, named exports only.
- Tool registration shape: `registerXxx(server, ...deps)`, single `server.registerTool` call per file, `try/catch` with `isError: true`.
- Logger conventions and the `console.log` ban — non-negotiable for stdio MCP.
- Config 4-tier merge with explicit per-field env vars.
- Test imports and the `dataDir` derivation pattern.
- Plain-prose error messages (`"Error <verb>: ..."`).
- Constructor-injected deps for stateful classes, function-arg deps for tool registration.
- `WorkbenchError`-style custom error subclass when (and only when) callers branch on `.code`.

### Diverge thoughtfully, with stated reason

The three modules we're adding need shape adjustments:

#### Project-index (new SearchEngine sibling)

- **Shape it like `SearchEngine`**: class with private `Map<>` indexes, eager `load()` in constructor, synchronous query methods.
- **Where to put it**: `src/project-index/` (sibling to `src/index/`). Keep the upstream API index separate; ours is a different data source.
- **Naming**: `ProjectIndex` class, `loader.ts` for fs scan, `types.ts` for interfaces — mirror `src/index/`.
- **Divergence**: project index must support **reload** (because the project changes during a session). Upstream `SearchEngine` is load-once. Add a public `reload()` method, and gate it behind a single `private reloading: Promise<void> | null` to coalesce concurrent reload requests (same pattern as `WorkbenchClient.launchPromise`).
- **Tests**: build a synthetic fixture project under `tests/fixtures/sample-project/` rather than relying on the user's real project dir.

#### File watcher

- **Shape**: plain class `ProjectWatcher` in `src/watcher/watcher.ts`. Constructor takes `(projectPath: string, onChange: (path: string) => void)`. Method `start(): void`, `stop(): void`.
- **Wiring**: instantiate once in `server.ts`, pass `() => projectIndex.reload()` as the callback.
- **Divergence**: upstream has no event-emitting code. The watcher is the first piece that's inherently async/event-driven. **Do not adopt EventEmitter** — use the callback in the constructor. That keeps consumers static and grep-able, matching upstream's avoidance of indirection.
- **Implementation**: `node:fs.watch` with `recursive: true` on Windows. Debounce 250ms because Workbench writes touch many files per save. Debounce inline (a `setTimeout` + clear) — don't import a debounce library.
- **Logging**: `logger.debug("[watcher] reindexed N files after change to X")`. Never `info`.
- **Stop on server shutdown**: register the unwatcher with `process.on("SIGINT", ...)`. Upstream doesn't have shutdown hooks, but for `fs.watch` we need them to release Windows file handles.

#### Paginated query tools

- **Shape**: `registerXxxList`, `registerXxxPage` — pair of tools (or one with a `page` arg). Lean toward one tool with `page?: number` and `pageSize?: number`, both `z.number().default(...)`, both `.describe(...)` for the model.
- **Divergence**: upstream tool responses are unbounded (e.g., `searchClasses` caps at `limit=10` by default, max 50). For paginated tools, **explicitly include the page info in the response text** — don't rely on the model to track it.
- **Response shape**:
  ```
  Page 2 of 7 — showing results 11–20 of 64
  ---
  <formatted entries>
  ---
  Next: call again with page=3.
  ```
  This trails the existing "Found N components:" header style.
- **Adoption**: do **not** introduce a separate response type or content-array streaming. Keep the single-text-block convention.

### Things to leave alone in upstream

- **Single global `logger`.** Tempting to namespace, don't.
- **No barrel exports.** Don't add `src/index/index.ts` even when it would shorten imports — upstream's flat imports are deliberate.
- **No linter config.** If we want one, propose it back to upstream first.
- **`McpServer` type import comes first in tool files.** Looks weird vs. node-builtins-first rule, but it's the upstream tell that "this file is a tool registration." Preserve it.

---

## Patterns observed

A few non-obvious things worth flagging:

1. **`.js` extension on TS imports is required, not stylistic.** `tsconfig.json` uses `"module": "Node16"` which means TypeScript resolves imports using Node's ESM rules — and Node ESM requires the file extension. Drop the `.js` and TS will still compile but Node will crash at runtime trying to find `./logger` instead of `./logger.js`. The compiler does not rewrite the path.

2. **The empty `catch {}` in `findGproj` / `listDirectory` / `prefab-ancestry` fallback chain is intentional, but easy to over-apply.** Upstream only swallows in _opportunistic discovery_ loops (looking for something across multiple candidate paths). Don't generalize the pattern to "wrap anything that might throw" — for first-class operations, log at `debug`.

3. **`Object.assign(config, partial)` in `loadConfig` mutates in place.** This is fine because each tier is a partial override, but if you call `loadJsonFile` twice on the same path you'll merge twice. Not a bug, just a sharp edge if we add a tier.

4. **`SearchEngine.load()` is called from the constructor synchronously.** A 28KB search engine that reads multiple JSON files at construction time blocks server start by ~100ms-ish. Acceptable here because it happens once before `server.connect`. If our project-index grows large, we should consider lazy-loading or async-load-then-connect — but match the upstream shape until that's measurably a problem.

5. **`process.env.ENFUSION_MCP_DEBUG` is checked at every `logger.debug` call**, not cached. Cheap (single env lookup), and lets you toggle debug from inside a long-running session by editing the parent's env — but the lookup is per-call, so don't put `logger.debug` in tight loops on hot paths.

6. **Tool error responses set `isError: true` AND return text content.** Don't `throw` from a tool handler — the MCP SDK will treat that as a server crash, not a tool-level error, and the user gets a much worse experience. The convention is "tools never throw past the handler boundary." This is enforced by the universal `try/catch` wrapper, not by types.

7. **`WorkbenchClient` constructor takes `config?: Config` as optional**, but most code paths require it. The optional is there because some test paths or future split-out usage might want a bare client. **Treat it as effectively required** in our extensions — don't add new code paths that depend on `config` being absent.

8. **The `[Enum-like class]` heuristic in `SearchEngine`** (classes with 0 methods + 4+ properties get a synthetic EnumInfo) is fragile and entirely upstream-internal. If we touch SearchEngine, do not perturb this — it's relied on by `searchEnums`.
