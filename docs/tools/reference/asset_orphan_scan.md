# asset_orphan_scan

```text
Find binary asset files on disk (.edds / .acp / .fbx / .ogg / .wav by default) that no indexed Enfusion text resource references. Use this to identify dead textures, audio, and meshes before publishing a mod. Read-only — reports paths, never deletes. Configurable extension list and source filter; paginate via `cursor`.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/asset_orphan_scan.md](../../../data/kb/census/tools/asset_orphan_scan.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | string | no | Optional source filter — usually `user` to skip vanilla content One of: `user`, `core`, `workshop`. |
| `asset_extensions` | array<string> | no | Asset file extensions to scan (without leading dot). Default: edds, acp, fbx, ogg, wav |
| `limit` | number | no | Max orphans per page (1-200, default 50) Default: `50`. |
| `cursor` | string | no | Opaque pagination token from a previous response's next_cursor |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/asset_orphan_scan.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 4 | T2 4 | `file:.acp`, `file:.edds`, `file:.fbx` |
