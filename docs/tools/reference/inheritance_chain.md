# inheritance_chain

```text
Walk a resource's `: { ParentRef }` chain up to the root. Returns each step (file, type, class, GUID) plus flags for truncation / cycles / unresolved parents. Use to answer 'what does this prefab/config ultimately inherit from?' across deep hierarchies.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/inheritance_chain.md](../../../data/kb/census/tools/inheritance_chain.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `guid` | string | yes | Starting GUID — 16 hex chars, with or without braces |
| `max_depth` | number | no | Stop after this many steps (default 32, max 256) Default: `32`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/inheritance_chain.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
