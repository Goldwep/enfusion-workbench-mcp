# Dialogue Editor

## What it is

- The Dialogue Editor is a Workbench module for dialogue graph editing: import FDX, export GraphML, validate the current dialogue, start, stop and step a preview, group and ungroup nodes, and node presets. [row: ui:none/module/Module: Dialogue Editor]
- That feature list comes from one source in build 1.8.0.13 only. [row: ui:none/module/Module: Dialogue Editor]
- A `.dlg` file is a dialogue config edited by the Dialogue Editor. [row: file:.dlg]
- A `.dlg` file is documented as a configuration file for one dialogue scene, with the resource class DialogueResource, and the ledger records zero `.dlg` files in the game paks or the Workbench paks. [row: file:file-type/.dlg Dialogue config]

## Script API

- The Workbench script API declares a DialogueEditor class, seen in builds 1.8.0.13 and 1.9.0.37. [row: api:DialogueEditor]
- It has four methods: GetCurrentDialogue, GetCurrentNode, BeginEditAction and EndEditAction. [row: api:DialogueEditor.GetCurrentDialogue/0] [row: api:DialogueEditor.GetCurrentNode/0] [row: api:DialogueEditor.BeginEditAction/1] [row: api:DialogueEditor.EndEditAction/1]
- The 1.8.0.13 recon import also names the same four methods on a Script Editor row called DialogueEditor module; no Script Editor listing or live walk has confirmed it. [row: ui:ScriptEditor/module/DialogueEditor module]
- Current dialogue returns the container of the dialogue scene in the active tab; that it is null when no tab is open is [unverified]. [row: api:method/Current dialogue]
- Current node returns the container of the selected graph node; its behaviour with several nodes selected is [unverified]. [row: api:method/Current node]
- Begin edit action opens a named undo step before containers change. [row: api:method/Begin edit action]
- End edit action closes the undo step and can refresh the whole graph. [row: api:method/End edit action]
- Open a dialogue loads a `.dlg` into a tab; its row has no alias because seven recon rows name the same engine method. [row: api:method/Open a dialogue]
- Container by index returns module containers, probably one per open tab; that is [unverified]. [row: api:method/Container by index]

## Docks and options

- The executable holds names for six docks: DebugControls, NodePresetsDock, PreviewDock, ValidationErrorsDock, nodePropertiesDock and scenePropertiesDock. [row: ui:DialogueEditor/dock/#DebugControls] [row: ui:DialogueEditor/dock/#NodePresetsDock] [row: ui:DialogueEditor/dock/#PreviewDock] [row: ui:DialogueEditor/dock/#ValidationErrorsDock] [row: ui:DialogueEditor/dock/#nodePropertiesDock] [row: ui:DialogueEditor/dock/#scenePropertiesDock]
- These dock rows come from strings in the executable, not from a live walk, and sit at tier T0. [row: ui:DialogueEditor/dock/#PreviewDock]
- A main toolbar named mainToolbar is recorded the same way. [row: ui:DialogueEditor/toolbar/#mainToolbar]
- The editor options are RestoreTabs, RestoreView, AutoConnectNewNode, NewNodeAnchorPoint, AutoAddDefaultSpeaker, DefaultSpeakerName, ShowPreviewPanelAutomatically, ShowControlsPanelAutomatically, ShowOnlyConnectable, AutoAssignSpeakersOption and AutoSelectTextBox. [row: ui:LocalizationEditor/option/Editor options (DialogueEditorOptions)]
- A Game diag menu named Dialogue has a Demo entry that enables or disables dialogue demo mode. [row: diag:Game/Dialogue/Demo]

## Reachability

- The candidate paths for the module row are net-api-handler and builtin-net-handler, both policy defaults recorded as candidates. [row: ui:DialogueEditor/module/DialogueEditor]
- The decision log records that opening the module by script returned false in the sandbox run, so the module was not reachable in that build. [unverified]
- The decision log (OD-8) rules the Dialogue Editor's 36 rows blocked on probe P-U23, re-checked each build; that ruling is not applied in the ledger. [unverified]
- The ledger carries a P-U23 blocked disposition on the two `.dlg` file-type rows only. [row: file:.dlg] [row: file:file-type/.dlg Dialogue config]

[Module page: DialogueEditor](../modules/DialogueEditor.md)
