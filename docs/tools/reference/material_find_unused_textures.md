# material_find_unused_textures

```text
Find `.edds` texture files that no `.emat` material references. Walks the project filesystem for `.edds` files, parses every indexed `.emat` for texture refs, and returns the disk paths that no material uses. Use this before publishing a mod to prune dead texture assets. Read-only; pair with manual deletion when ready. Paginate via `cursor`.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/material_find_unused_textures.md](../../../data/kb/census/tools/material_find_unused_textures.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | string | no | Optional source filter scoping which `.emat` files to consider (usually `user`) One of: `user`, `core`, `workshop`. |
| `limit` | number | no | Max unused textures per page (1-200, default 50) Default: `50`. |
| `cursor` | string | no | Opaque pagination token from a previous response's next_cursor |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/material_find_unused_textures.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 3 | T0 1, T2 2 | `api:method/Unused textures`, `file:.edds`, `file:.emat` |
