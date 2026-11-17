# wiki_read

```text
Read the full content of a specific wiki page by title. Use wiki_search first to find page titles, then use this tool to retrieve the complete text including code examples and tutorials. Returns the full page without truncation (up to 100,000 characters).
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wiki_read.md](../../../data/kb/census/tools/wiki_read.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes | Exact title of the wiki page to read (from wiki_search results) |

## Linked census rows

No ledger row links an action of `wiki_read` through its `mcp` field.
