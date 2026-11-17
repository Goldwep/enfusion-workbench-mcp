# Tool: wb_resources

register, rebuild, getInfo, open

Row: mcp:tool/wb_resources. Tier T2/T2.

## Actions (14)

| action | risk | what |
| --- | --- | --- |
| addons | mutating | mcp action 'wb_resources.addons' in none under wb_resources |
| browse | mutating | mcp action 'wb_resources.browse' in none under wb_resources |
| create | mutating | mcp action 'wb_resources.create' in none under wb_resources |
| getInfo | safe | mcp action 'wb_resources.getInfo' in none under wb_resources |
| import | mutating | mcp action 'wb_resources.import' in none under wb_resources |
| newGuid | mutating | mcp action 'wb_resources.newGuid' in none under wb_resources |
| open | mutating | mcp action 'wb_resources.open' in none under wb_resources |
| prefabFromModel | mutating | mcp action 'wb_resources.prefabFromModel' in none under wb_resources |
| rebuild | mutating | mcp action 'wb_resources.rebuild' in none under wb_resources |
| register | mutating | mcp action 'wb_resources.register' in none under wb_resources |
| resolve | mutating | mcp action 'wb_resources.resolve' in none under wb_resources |
| search | safe | mcp action 'wb_resources.search' in none under wb_resources |
| selection | safe | mcp action 'wb_resources.selection' in none under wb_resources |
| wait | mutating | mcp action 'wb_resources.wait' in none under wb_resources |

## Rows linked to this tool (37)

- api:MetaFile.GetResourceID/0 (resolve read)
- api:ResourceManager.GetResourceBrowserSelection/2 (selection read)
- api:ResourceManager.RebuildResourceFile/3 (rebuild drive)
- api:ResourceManager.RebuildResourceFiles/2 (rebuild drive)
- api:ResourceManager.RegisterResourceFile/2 (register drive)
- api:ResourceManager.WaitForFile/2 (wait drive)
- api:Workbench.GenerateGloballyUniqueID64/0 (newGuid read)
- api:Workbench.GetAbsolutePath/3 (resolve read)
- api:Workbench.GetCurrentGameProjectFile/0 (addons read)
- api:Workbench.GetResourceName/1 (resolve read)
- mcp:action/wb_resources.addons (addons drive)
- mcp:action/wb_resources.browse (browse drive)
- mcp:action/wb_resources.create (create drive)
- mcp:action/wb_resources.getInfo (getInfo drive)
- mcp:action/wb_resources.import (import drive)
- mcp:action/wb_resources.newGuid (newGuid drive)
- mcp:action/wb_resources.open (open drive)
- mcp:action/wb_resources.prefabFromModel (prefabFromModel drive)
- mcp:action/wb_resources.rebuild (rebuild drive)
- mcp:action/wb_resources.register (register drive)
- mcp:action/wb_resources.resolve (resolve drive)
- mcp:action/wb_resources.search (search drive)
- mcp:action/wb_resources.selection (selection drive)
- mcp:action/wb_resources.wait (wait drive)
- mcp:handler-action/EMCP_WB_Resources.addons (addons drive, addons read)
- mcp:handler-action/EMCP_WB_Resources.create (create drive, create read)
- mcp:handler-action/EMCP_WB_Resources.import (import drive, import read)
- mcp:handler-action/EMCP_WB_Resources.newGuid (newGuid drive, newGuid read)
- mcp:handler-action/EMCP_WB_Resources.open (open read)
- mcp:handler-action/EMCP_WB_Resources.prefabFromModel (prefabFromModel drive, prefabFromModel read)
- mcp:handler-action/EMCP_WB_Resources.rebuild (rebuild drive, rebuild read)
- mcp:handler-action/EMCP_WB_Resources.register (register drive, register read)
- mcp:handler-action/EMCP_WB_Resources.resolve (resolve drive, resolve read)
- mcp:handler-action/EMCP_WB_Resources.search (browse read, search read)
- mcp:handler-action/EMCP_WB_Resources.selection (selection read)
- mcp:handler-action/EMCP_WB_Resources.wait (wait drive, wait read)
- net:handler/GetResourceInfo (getInfo read)
