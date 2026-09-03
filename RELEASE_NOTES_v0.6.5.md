# v0.6.5 — Bug Fixes + Config Validation, Fuzzy Search, Auto-Fetch Parent Methods

## Bug Fixes

### Parser / Serializer

- **enfusion-text escape sequences** — The tokenizer now correctly decodes `\n`, `\t`, `\r`, `\\`, and `\"` escape sequences in string values instead of passing them through as literal two-character sequences. The serializer now escapes these characters on write, enabling correct round-trips.
- **extractParamNames default values** — `super()` calls in modded scripts no longer emit default values (e.g. `super.OnInit(null)`) when method parameters have defaults like `= null` or `= 0`. The param name is now correctly extracted (`super.OnInit(owner)`).

### PAK Reader

- **Bounds checks** — Malformed PAK files with chunk size fields exceeding the remaining file size now throw immediately with a clear error instead of reading garbage or hanging. Entry name length is also validated against the buffer size.

### Asset Search

- **GUID index error surfacing** — When the GUID index fails to load (permissions issue, missing game installation, etc.), a warning is now appended to the `asset_search` response explaining the problem. Previously results silently had no GUID prefixes.

### Workbench Tools

- **scenario_create_objective cleanup** — On partial failure, the tool now automatically deletes any entities it already placed before the error. Previously it listed them for manual cleanup.
- **mod_create collision detection** — Pattern expansion is now validated for filename collisions before any files are written. If two pattern scripts resolve to the same filename after prefix substitution, the tool returns an error immediately instead of silently overwriting.

## Features

### Config Semantic Validation

`mod_validate` now performs semantic checks on `.conf` files in addition to parse validation. Class names referenced as root nodes or child nodes are checked against the API index, and a warning is issued for any unknown class name (which may indicate a typo or a missing dependency).

### Fuzzy Search

All search tools (`api_search`, `component_search`, etc.) now fall back to fuzzy matching when strict prefix/substring matching returns fewer than 3 results. Uses Levenshtein edit distance (distance ≤ 1 scores 40, ≤ 2 scores 20) and trigram similarity (Jaccard index > 0.3 scores 15). Common typos like `ScriptCompnent` → `ScriptComponent` or `GetPositon` → `GetPosition` now return results.

### Auto-Fetch Parent Methods in script_create

When `script_create` is called with a `parentClass` and no explicit `methods` list, it now looks up the parent class in the API index and generates stubs for its overridable methods (matching `On*`, `EOn*`, `Get*`, `Set*`, `Can*`, `Handle*`, `Do*` patterns). Previously all scripts got generic hardcoded stubs regardless of the parent class.

## Internal

- Added `src/utils/fuzzy.ts` — standalone `levenshtein()` and `trigramSimilarity()` utilities with full test coverage.
- `generateScript` now accepts a `dynamicMethods` option that overrides hardcoded method defaults when provided.
