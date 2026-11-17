# imageset

```text
Read and edit .imageset files (UI icon atlases) offline, byte-exact. Actions: read (paged), create, addTexture, removeTexture, addGroup, addQuad, setQuad, remove (a quad, or a whole group). Writes stay inside the project, are a dry run (diff) unless confirm: true, and refuse files the writer cannot reproduce. New files then need wb_resources register.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/imageset.md](../../../data/kb/census/tools/imageset.md) |

## Actions (8)

`read`, `create`, `addTexture`, `removeTexture`, `addGroup`, `addQuad`, `setQuad`, `remove`

## Input parameters (20)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `create`, `addTexture`, `removeTexture`, `addGroup`, `addQuad`, `setQuad`, `remove`. |
| `path` | string | yes | The .imageset: project-relative, absolute inside the project, or (read) a game path. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |
| `confirm` | boolean | no | Write the change. Without it the call is a dry run. |
| `overwrite` | boolean | no | create: replace an existing file. |
| `refSize` | array<number> | no | create: RefSize [w, h]. |
| `texture` | string | no | create/addTexture/removeTexture: texture resource path, {GUID} prefix optional. |
| `resourceGuid` | string | no | addTexture: 16-hex GUID of the texture resource. |
| `objectGuid` | string | no | addTexture: GUID for the texture entry's header. |
| `mpix` | number | no | addTexture: mpix (default 1) for a plain texture. |
| `screenSize` | string | no | addTexture: FHD, 2K ...; needs textureSize. |
| `textureSize` | array<number> | no | addTexture: [w, h] with screenSize. |
| `index` | integer | no | removeTexture: texture index. |
| `group` | string | no | addGroup/addQuad/setQuad/remove/read: group name. |
| `name` | string | no | addQuad/setQuad/remove: quad name. |
| `pos` | array<number> | no | addQuad/setQuad: [x, y]. |
| `size` | array<number> | no | addQuad/setQuad: [w, h]. |
| `flags` | string | no | addQuad/setQuad: Flags, e.g. "0" or "0 0". |
| `cursor` | string | no | read: cursor from the last page. |
| `limit` | integer | no | read: quads per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/imageset.<action>`. A row that links several actions is counted under each (16 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addGroup` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.addGroup` |
| `addQuad` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.addQuad` |
| `addTexture` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.addTexture` |
| `create` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.create` |
| `read` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.read` |
| `remove` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.remove` |
| `removeTexture` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.removeTexture` |
| `setQuad` | 2 | T2 1, T5 1 | `file:.imageset`, `mcp:action/imageset.setQuad` |
