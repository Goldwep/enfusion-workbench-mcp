# find_references

```text
Find every file that references a resource by its GUID. Returns paginated results — each ref shows the source file, ref kind (inheritance/asset_path/dep/value), and context (property name or parent type). Use this for refactor impact analysis, finding broken refs, or tracing inheritance chains. Paginate via the `cursor` field when total > limit.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/find_references.md](../../../data/kb/census/tools/find_references.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `guid` | string | yes | Target GUID — 16 hex chars, with or without braces |
| `limit` | number | no | Max refs per page (1-200, default 20) Default: `20`. |
| `cursor` | string | no | Opaque pagination token from a previous response's next_cursor |
| `kind` | string | no | Filter by ref kind, or 'any' for all kinds One of: `inheritance`, `asset_path`, `dep`, `value`, `any`. Default: `"any"`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/find_references.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
