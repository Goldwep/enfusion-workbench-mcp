# Enforce Script tools (L6)

Seven tools built on top of the L6 Enforce Script mini-parser (`src/script-parser/`). All read `.c` source files directly from disk — no Workbench connection, no project-index dependency for the parse itself. Three of the tools (`script_class_hierarchy`, `script_overrides`, `script_find_rpc_handlers`) walk a project root to assemble cross-file pictures; the other four operate on a single `.c` file.

Common conventions:

- **Flag-smuggle guard** on every path input — rejects values starting with `-`.
- **Repo-relative or absolute paths** are both accepted. The tool calls `resolve()` before reading.
- **Body content is NOT parsed.** The parser captures the structural surface: class declarations, inheritance, method signatures with attributes, fields. Method bodies are skipped.
- **Failures soft-fail** with `isError: true` for IO/parse errors, but missing classes or empty results render as friendly markdown.

## script_analyze

Parse a single `.c` file and emit a structured summary: classes (including `modded class`), inheritance links, method signatures with their attributes (`[RPC]`, `[RplProp]`, etc.), and fields.

**Input:**

```json
{ "script_path": "Scripts/Game/MyComponent.c" }
```

**Sample output (excerpt):**

```
## MyComponent.c

### class SCR_MyComponent : ScriptComponent
methods:
  - protected void EOnInit(IEntity owner)
  - [RPC(RplChannel.Reliable, RplRcver.Server)] void AskServerDoStuff(int value)
fields:
  - protected ref array<string> m_aLog
```

**Known limits:**

- Doesn't follow `#include` directives — only the file you pass is parsed.
- No semantic checks (parser doesn't validate that referenced parent classes exist).
- Foundation tool — other L6 tools call its parser internally.

## script_overrides

Find every `modded class <Name>` declaration in a project's `.c` files. With no filter, groups every override by base class. With a filter, lists only overrides of that one class.

**Input:**

```json
{ "project_root": "C:/Users/<you>/.../addons/MyMod", "class_name": "SCR_GameModeMP" }
```

**Sample output (excerpt):**

```
Scanned 247 .c files.

### modded class SCR_GameModeMP  (3 overrides)
  - Scripts/Game/GameMode/MyMod_GameModeMP.c:14 — 5 methods, 2 fields
  - Scripts/Game/Mission/MyMod_MissionPatch.c:8 — 1 method, 0 fields
  - Scripts/Game/Debug/Debug_GMOverride.c:22 — 2 methods, 0 fields
```

**Known limits:**

- Walks the project root directly via `findCFiles` — does NOT consult the project-index (which doesn't track `.c` files in v1).
- Doesn't resolve the chain across mods. If `ModA` modds a class and `ModB` modds the modded version, both show up but the chain order is filename-sorted, not declared-order.

## script_lint

Static analysis with 5 rules ported from BI's Basic Code Formatter Plugin + modding-specific extras: `trailing_whitespace`, `indent_mixed`, `if_paren_spacing`, `missing_super_modded`, `rpc_missing_channel`. Defaults to all rules; pass `rules: [...]` to opt into a subset.

**Input:**

```json
{ "script_path": "Scripts/Game/MyComponent.c", "rules": ["missing_super_modded", "rpc_missing_channel"] }
```

**Sample output (excerpt):**

```
MyComponent.c — 2 findings

[W] L34 (missing_super_modded): modded class override of EOnInit does not call super.EOnInit(owner)
[E] L88 (rpc_missing_channel): [RPC] attribute missing channel/recipient arguments
```

**Known limits:**

- Regex-based — won't catch logical errors, only structural smells.
- `missing_super_modded` is a heuristic: it flags overrides that don't textually mention `super.<methodName>`. False positives possible if the override genuinely doesn't need to chain.
- Doesn't fix anything. Pair with `script_format` for the safe-subset auto-fix.

## script_format

Apply the SAFE subset of formatting fixes: strip trailing whitespace, collapse blank-line runs, ensure single trailing newline. **Refuses non-`.c` files even with `force: true`.** Atomic byte-edit with `.bak` sidecar; git-clean check unless `force: true`.

**Input:**

```json
{ "script_path": "Scripts/Game/MyComponent.c", "commit": true }
```

**Sample output (commit-mode):**

```
MyComponent.c — Committed (3 changes)

  trailing whitespace lines: 2
  blank-line runs collapsed:  1
  trailing newline:           added

.bak sidecar created.
```

**Known limits:**

- Doesn't touch indentation, brace style, or `if(` spacing — those are riskier reformats. `script_lint` surfaces them for human decision.
- DRY-RUN by default. Pass `commit: true` to actually write.
- One-file-at-a-time. Run from a shell loop for batch reformat.

## script_class_hierarchy

Walk a class's inheritance chain AND its `modded class` chain, rendered as an ASCII tree. Stops at the topmost ancestor not defined in the project (typically an engine class). Max-depth bounded (default 32, cap 64) so a cycle in broken project data can't run forever.

**Input:**

```json
{ "project_root": "C:/Users/<you>/.../addons/MyMod", "class_name": "MyMod_PlayerCharacter" }
```

**Sample output (excerpt):**

```
MyMod_PlayerCharacter : SCR_ChimeraCharacter
└─ Scripts/Game/Character/MyMod_PlayerCharacter.c:6
   └─ modded by:
      └─ Debug/Debug_PlayerCharacter.c:4 (modded class MyMod_PlayerCharacter)
   parent ↓
SCR_ChimeraCharacter : ChimeraCharacter
   ⚠ parent ChimeraCharacter not found in project (engine class)
```

**Known limits:**

- Project-scoped — won't traverse into vanilla engine classes.
- Cycle detection emits `⚠ CYCLE DETECTED` rather than crashing.
- `modded` chain ordering is filename-sorted, not the engine's mod-load order.

## script_extract_interface

Emit the public-facing surface of a class as markdown: signatures of every non-`protected` / non-`private` method, plus public fields. Optional class filter.

**Input:**

```json
{ "script_path": "Scripts/Game/MyAPI.c", "class_name": "SCR_MyAPI" }
```

**Sample output (excerpt):**

````
## SCR_MyAPI — public interface

```enforce
void RegisterListener(SCR_MyListener listener)
SCR_MyListener GetListener(string id)
event_func void OnReady()
```

fields:
  - static ref SCR_MyAPI s_Instance
````

**Known limits:**

- "Public" = absence of `protected`/`private` modifier. Doesn't try to detect `internal`-by-convention.
- Doesn't include inherited methods — only what the file itself declares.
- Foundation for handoff docs / LLM context-compaction.

## script_find_rpc_handlers

Locate every method decorated with `[RPC(...)]` (or another custom attribute name) across a project's `.c` files. Surfaces class context, method signature, and the attribute arguments. Default attribute is `RPC`; use `attribute_name: "RplProp"` to find replicated fields, `"Attribute"` to find editor attributes, etc.

**Input:**

```json
{ "project_root": "C:/Users/<you>/.../addons/MyMod", "attribute_name": "RPC" }
```

**Sample output (excerpt):**

```
Found 12 methods with [RPC] across 6 .c files.

### Scripts/Game/Network/SCR_NetSync.c
  L42: SCR_NetSync
    [RPC(RplChannel.Reliable, RplRcver.Server)]
    void AskServerSync()

  L78: SCR_NetSync
    [RPC(RplChannel.Reliable, RplRcver.Broadcast, "OnSyncBroadcast")]
    void RpcDo_Broadcast(string payload)
```

**Known limits:**

- Regex-driven — won't pick up `[RPC]` attributes split across multiple lines in unusual formatting.
- Doesn't resolve the channel/recipient arguments — just surfaces them verbatim for human review.
- Use with `script_lint` rule `rpc_missing_channel` to gate that every RPC has a recipient.
