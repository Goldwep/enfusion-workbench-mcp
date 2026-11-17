# list_resources

```text
Paginated browse of indexed resources. Filter by source (user/core/workshop), root_type (e.g. GenericEntity, GameProject, SCR_Faction), or project_id. Use for discovery — 'show me every GenericEntity in Test1', 'every config in workshop source', etc. Paginate via `cursor`. With no filters, returns everything.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/list_resources.md](../../../data/kb/census/tools/list_resources.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | string | no | Filter by source One of: `user`, `core`, `workshop`. |
| `root_type` | string | no | Filter by root node type (e.g. GenericEntity, GameProject, SCR_Faction) |
| `project_id` | string | no | Filter by owning project's ID (from .gproj). Requires project_id FK from schema v2. |
| `limit` | number | no | Max resources per page (1-200, default 50) Default: `50`. |
| `cursor` | string | no | Opaque pagination token from a previous response's next_cursor |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/list_resources.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
