# Enfusion Workbench MCP

MCP server for Arma Reforger / Enfusion Workbench modding. Derived from steffenbk/enfusion-mcp-BK (MIT).

## Commands
- `npm install` — install dependencies
- `npm run build` — compile TypeScript to `dist/`
- `npx vitest run --pool=forks --poolOptions.forks.singleFork` — run the test suite
- `npm run scrape` — regenerate the scraped API index in `data/`

## Architecture
- `src/server.ts` — tool registration (start here to find any tool)
- `src/tools/` — the MCP tool implementations
- `mod/Scripts/.../EnfusionMCP` — Workbench-side Enforce script handlers the server talks to
- `data/` — scraped Enfusion API index + knowledge base
- `docs/CONVENTIONS.md` — code style guide

## Gotcha
The server runs from `dist/`, not `src/`. After editing source, rebuild (`npm run build`) and restart the MCP client — a stale `dist/` silently serves old code.
