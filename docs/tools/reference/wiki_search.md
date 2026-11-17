# wiki_search

```text
Search pre-downloaded Bohemia Interactive Wiki (BIKI) content, tutorials, and guides about Enfusion engine concepts, scripting patterns, and Arma Reforger modding topics. Always use this tool instead of trying to access the wiki via the web — all wiki content is already available here. Results are previews — use wiki_read with the page title to get the full content including code examples.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wiki_search.md](../../../data/kb/census/tools/wiki_search.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes | Topic to search for (e.g., 'replication', 'event system', 'world systems') |
| `limit` | number | no | Maximum results to return Default: `5`. |

## Linked census rows

No ledger row links an action of `wiki_search` through its `mcp` field.
