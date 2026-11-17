# Tool: wb_anim

mcp tool 'wb_anim' in ResourceManager

Row: mcp:tool/wb_anim. Tier T2/T2.

## Actions (6)

| action | risk | what |
| --- | --- | --- |
| check | mutating | mcp action 'wb_anim.check' in ResourceManager under wb_anim |
| txaChannels | safe | mcp action 'wb_anim.txaChannels' in ResourceManager under wb_anim |
| txaEdit | mutating | mcp action 'wb_anim.txaEdit' in ResourceManager under wb_anim |
| txaExport | mutating | mcp action 'wb_anim.txaExport' in ResourceManager under wb_anim |
| txaProfiles | safe | mcp action 'wb_anim.txaProfiles' in ResourceManager under wb_anim |
| txaRead | safe | mcp action 'wb_anim.txaRead' in ResourceManager under wb_anim |

## Rows linked to this tool (35)

- api:TxaExporter.ErrCode/0 (txaExport drive)
- api:TxaExporter.ErrMsg/0 (txaExport drive)
- api:TxaExporter.GetNumProfiles/0 (txaProfiles read)
- api:TxaExporter.GetProfileChannelCount/1 (txaProfiles read)
- api:TxaExporter.GetProfileChannelGenFn/2 (txaChannels read)
- api:TxaExporter.GetProfileChannelName/2 (txaChannels read)
- api:TxaExporter.GetProfileIndex/1 (txaChannels read)
- api:TxaExporter.GetProfileName/1 (txaProfiles read)
- api:TxaExporter.LoadProfiles/1 (txaProfiles read)
- api:TxaExporter.TrackAddAudioEvent/0 (txaEdit drive)
- api:TxaExporter.TrackAddGenericEvent/0 (txaEdit drive)
- api:TxaExporter.TrackAddWeightedEvent/0 (txaEdit drive)
- api:TxaExporter.TrackClearCustomProperties/0 (txaEdit drive)
- api:TxaExporter.TrackEditEvent/1 (txaEdit drive)
- api:TxaExporter.TrackEraseEvent/1 (txaEdit drive)
- api:TxaExporter.TrackExport/0 (txaExport drive)
- api:TxaExporter.TrackGetCustomProperty/1 (txaRead read)
- api:TxaExporter.TrackGetEvent/1 (txaRead read)
- api:TxaExporter.TrackGetEventCount/0 (txaRead read)
- api:TxaExporter.TrackLoad/2 (txaRead read)
- api:TxaExporter.TrackReset/5 (txaExport drive)
- api:TxaExporter.TrackSetChannels/4 (txaExport drive)
- api:TxaExporter.TrackSetCustomProperty/2 (txaEdit drive)
- mcp:action/wb_anim.check (check drive)
- mcp:action/wb_anim.txaChannels (txaChannels drive)
- mcp:action/wb_anim.txaEdit (txaEdit drive)
- mcp:action/wb_anim.txaExport (txaExport drive)
- mcp:action/wb_anim.txaProfiles (txaProfiles drive)
- mcp:action/wb_anim.txaRead (txaRead drive)
- mcp:handler-action/EMCP_WB_Anim.check (check drive)
- mcp:handler-action/EMCP_WB_Anim.txaChannels (txaChannels read)
- mcp:handler-action/EMCP_WB_Anim.txaEdit (txaEdit drive)
- mcp:handler-action/EMCP_WB_Anim.txaExport (txaExport drive)
- mcp:handler-action/EMCP_WB_Anim.txaProfiles (txaProfiles read)
- mcp:handler-action/EMCP_WB_Anim.txaRead (txaRead read)
