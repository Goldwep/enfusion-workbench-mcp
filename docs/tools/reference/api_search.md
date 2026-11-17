# api_search

```text
Search the Enfusion / Arma Reforger script API by class name, method name, or keyword. Results automatically include inherited methods from parent classes, detect enum-like constant classes (use type: 'enum'), and show related sibling classes from the same API group. Use format: 'tree' with class searches to visualize the full inheritance hierarchy as an ASCII tree. For component-specific searches (finding what to attach to entities), use the component_search tool for more targeted filtering by category and event handlers.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/api_search.md](../../../data/kb/census/tools/api_search.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes | Class name, method name, or keyword to search for |
| `type` | string | no | Narrow search to classes, methods, enums, or properties One of: `class`, `method`, `enum`, `property`, `any`. Default: `"any"`. |
| `source` | string | no | Search enfusion engine API, arma reforger API, or both One of: `enfusion`, `arma`, `all`. Default: `"all"`. |
| `limit` | number | no | Maximum results to return Default: `10`. |
| `format` | string | no | Output format: 'detailed' (default markdown) or 'tree' (ASCII inheritance tree, class searches only) One of: `detailed`, `tree`. Default: `"detailed"`. |

## Linked census rows

No ledger row links an action of `api_search` through its `mcp` field.
