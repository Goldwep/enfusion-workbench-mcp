# Census: AudioEditor

975 rows (13 aggregate excluded).

## What it is

Module AudioEditor: api 137, cli 1, file 9, link 2, schema 470, setting 46, ui 310. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class AudioEditor (api:AudioEditor)
- class ACP node (ACPClass) (api:class/ACP node (ACPClass)): Reference to another .acp with exposed ports; removed and inlined by the data build
- class ACos (IOPItemOpACosClass) (api:class/ACos (IOPItemOpACosClass)): Arc cosine
- class ASin (IOPItemOpASinClass) (api:class/ASin (IOPItemOpASinClass)): Arc sine
- class ATan (IOPItemOpATanClass) (api:class/ATan (IOPItemOpATanClass)): Arc tangent
- class Abs (IOPItemOpAbsClass) x29 (api:class/Abs (IOPItemOpAbsClass) x29): Absolute value
- class Amplitude (AmplitudeClass) x1,175 (api:class/Amplitude (AmplitudeClass) x1,175): Distance attenuation. Keys: curve ("1/r", Custom, Linear, Logarithm, SCurve), innerRange, outerRange, slopeFactor, EnableDirectivity, varName, varResource, custom curve points
- class AuxOut (AuxOutClass) x1,932 (api:class/AuxOut (AuxOutClass) x1,932): Routes Sound output(s) to a mixer port. Keys: Volume, MonoMix, OSPort
- class AuxSelector (AuxSelectorClass) x36 (api:class/AuxSelector (AuxSelectorClass) x36): Selector variant for aux routing
- class Average (IOPItemOpAverageClass) x6 (api:class/Average (IOPItemOpAverageClass) x6): Capacity 0-128 frames
- class BankLocal (BankLocalClass) x10,892 (api:class/BankLocal (BankLocalClass) x10,892): Sample player. Keys: Volume, Pitch, Sustain, Offset, Silence, Selection (CustomSignalIndex, Random, FirstRandomAndSequence, SequenceFromFirst), Resampler (FIR_4, FIR_8), "Fade in function" / "Fade out function" (SCurve, Cos, Exp, Quadratic), Metadata, Samples list (max 1024)
- class Base (BaseDSPTypeClass) (api:class/Base (BaseDSPTypeClass)): Abstract parent
- ... 199 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 136 | 0 | 1 | 0 | 0 | 0 | 137 |
| cli | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 5 | 0 | 4 | 0 | 0 | 0 | 9 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| schema | 1 | 0 | 469 | 0 | 0 | 0 | 470 |
| setting | 46 | 0 | 0 | 0 | 0 | 0 | 46 |
| ui | 102 | 70 | 126 | 1 | 0 | 11 | 310 |

## By kind

- canvas-gesture: 12
- class: 100
- cli-switch: 1
- context-item: 4
- context-menu: 1
- control: 52
- dock: 17
- file-type: 9
- link-format: 2
- menu: 33
- menu-item: 44
- method: 37
- module: 4
- panel: 25
- property: 1
- property-group: 8
- region: 25
- schema-class: 53
- schema-key: 416
- setting-key: 46
- shortcut: 56
- status-item: 1
- tab: 8
- tool: 2
- toolbar: 2
- toolbar-button: 13
- window: 3

## By risk

- destructive: 5
- mutating: 252
- safe: 718

## Rows by kind

### canvas-gesture (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/canvas-gesture/Connections/Duplicate Connection | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Connections/Reconnect Connection | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Groups/Add Node | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Groups/Remove Node | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Nodes/End Quick Connection (on port) | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Nodes/Move nodes only horizontally%2Fvertically | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Nodes/Node Dialog | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Nodes/Start Quick Connection (on port) | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Scene/Multiselect Nodes | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Scene/Pan | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Scene/Region Select | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/canvas-gesture/Scene/Zoom In%2FOut | T1/T2 | candidate: gui-automation | none |

### class (100)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AudioEditor | T2/T2 | candidate: none-known | none |
| api:class/ACP node (ACPClass) | T0/T2 | candidate: file-format | none |
| api:class/ACos (IOPItemOpACosClass) | T0/T2 | candidate: file-format | none |
| api:class/ASin (IOPItemOpASinClass) | T0/T2 | candidate: file-format | none |
| api:class/ATan (IOPItemOpATanClass) | T0/T2 | candidate: file-format | none |
| api:class/Abs (IOPItemOpAbsClass) x29 | T0/T2 | candidate: file-format | none |
| api:class/Amplitude (AmplitudeClass) x1,175 | T0/T2 | candidate: file-format | none |
| api:class/AuxOut (AuxOutClass) x1,932 | T0/T2 | candidate: file-format | none |
| api:class/AuxSelector (AuxSelectorClass) x36 | T0/T2 | candidate: file-format | none |
| api:class/Average (IOPItemOpAverageClass) x6 | T0/T2 | candidate: file-format | none |
| api:class/BankLocal (BankLocalClass) x10,892 | T0/T2 | candidate: file-format | none |
| api:class/Base (BaseDSPTypeClass) | T0/T2 | candidate: file-format | none |
| api:class/Biquad Filter (BiquadDSPTypeClass) x189 | T0/T2 | candidate: file-format | none |
| api:class/Bitcrusher (BitCrusherDSPTypeClass) x9 | T0/T2 | candidate: file-format | none |
| api:class/Bus (BusClass) x1,475 | T0/T2 | candidate: file-format | none |
| api:class/Ceil (IOPItemOpCeilClass) x1 | T0/T2 | candidate: file-format | none |
| api:class/Clamp (IOPItemOpClampClass) x8 | T0/T2 | candidate: file-format | none |
| api:class/ClampMax (IOPItemOpClampMaxClass) x16 | T0/T2 | candidate: file-format | none |
| api:class/ClampMin (IOPItemOpClampMinClass) x10 | T0/T2 | candidate: file-format | none |
| api:class/Compressor (CompressorDSPTypeClass) x39 | T0/T2 | candidate: file-format | none |
| api:class/Cond (IOPItemOpConditionClass) x121 | T0/T2 | candidate: file-format | none |
| api:class/Constants (ConstantClass) x834 | T0/T2 | candidate: file-format | none |
| api:class/Converter (IOPItemOpConvertorClass) x83 | T0/T2 | candidate: file-format | none |
| api:class/Convolution (ConvolutionDSPTypeClass) | T0/T2 | candidate: none-known | none |
| api:class/Cos (IOPItemOpCosClass) | T0/T2 | candidate: file-format | none |
| api:class/Curve Modulator (IOPInputCurveModulatorClass) x6 | T0/T2 | candidate: file-format | none |
| api:class/Db2Gain (SignalOpDb2GainClass) x147 | T0/T2 | candidate: file-format | none |
| api:class/Delta (IOPItemOpDeltaClass) x8 | T0/T2 | candidate: file-format | none |
| api:class/Distortion (DistortionDSPTypeClass) x23 | T0/T2 | candidate: file-format | none |
| api:class/Div (IOPItemOpDivClass) x71 | T0/T2 | candidate: file-format | none |
| api:class/Ducker (ODuckerClass) x6 | T0/T2 | candidate: file-format | none |
| api:class/Dynamic Equalizer (DynamicEqualizerDSPTypeClass) x3 | T0/T2 | candidate: file-format | none |
| api:class/Env (IOPItemOpEnvClass) x41 | T0/T2 | candidate: file-format | none |
| api:class/Equalizer4 (Equalizer4DSPTypeClass) x183 | T0/T2 | candidate: file-format | none |
| api:class/Exp (IOPItemOpExpClass) x8 | T0/T2 | candidate: file-format | none |
| api:class/Filter (FilterClass) x824 | T0/T2 | candidate: file-format | none |
| api:class/Filter (IOPItemOpFilterClass) x42 | T0/T2 | candidate: file-format | none |
| api:class/FilterChain (FilterChainClass) x186 | T0/T2 | candidate: file-format | none |
| api:class/Flanger (FlangerDSPTypeClass) x4 | T0/T2 | candidate: file-format | none |
| api:class/Floor (IOPItemOpFloorClass) x12 | T0/T2 | candidate: file-format | none |

60 more: wb_census find with module=AudioEditor kind=class.

### cli-switch (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:cli-switch/Start Workbench directly in a module | T0/T5 | candidate: cli | none |

### context-item (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/context-item/Group Options/Color | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/context-item/Group Options/Lock | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/context-item/Group Options/Select All | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/context-item/Group Options/Ungroup | T1/T5 | candidate: execute-action, gui-automation | none |

### context-menu (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/context-menu/Group Options | T1/T3 | candidate: gui-automation | none |

### control (52)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#filterButton | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#navigateBackward | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#navigateForward | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#navigateUp | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#projectTree | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/#qt_toolbar_ext_button | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/analyzersDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/analyzersDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/5 items | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/@ResourceListView.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/@ResourceTreeView.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/Create | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/browserDockWidget/Import | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@QToolButton.1 | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@QToolButton.2 | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@QToolButton.3 | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/consoleDockWidget/logDockContents/Clear Console | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/contentDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/contentDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/detailDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/detailDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/detailDockWidget/dockDetailContents/@QPlainTextEdit.1 | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/emitterSimDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/emitterSimDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/listenerDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:AudioEditor/control/listenerDockWidget/Float | T2/T5 | candidate: gui-automation | none |

12 more: wb_census find with module=AudioEditor kind=control.

### dock (17)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/dock/#analyzersDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#browserDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#browserDockWidget_2 | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#consoleDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#contentDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#detailDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#dockWidget | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#dockWidget_3 | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#emitterSimDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#levelsDockWidget | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#listenerDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#meterDockWidget | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#outputAnalyzerWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#playlistDockWidget | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#signalsDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#variablesDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/dock/#waveDockWidget | T0/T3 | candidate: gui-automation | none |

### file-type (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.acp | T2/T3 | candidate: file-format | [asset_orphan_scan.run](../tools/asset_orphan_scan.md) read, [audio.addNode](../tools/audio.md) drive, [audio.addSample](../tools/audio.md) drive, [audio.addVariable](../tools/audio.md) drive, [audio.catalog](../tools/audio.md) read, [audio.connect](../tools/audio.md) drive, [audio.create](../tools/audio.md) drive, [audio.disconnect](../tools/audio.md) drive, [audio.events](../tools/audio.md) read, [audio.graph](../tools/audio.md) read, [audio.group](../tools/audio.md) drive, [audio.inspect](../tools/audio.md) read, [audio.mixer](../tools/audio.md) read, [audio.node](../tools/audio.md) read, [audio.nodes](../tools/audio.md) read, [audio.refs](../tools/audio.md) read, [audio.removeNode](../tools/audio.md) drive, [audio.removeSample](../tools/audio.md) drive, [audio.removeVariable](../tools/audio.md) drive, [audio.renameEvent](../tools/audio.md) drive, [audio.samples](../tools/audio.md) read, [audio.set](../tools/audio.md) drive, [audio.setSample](../tools/audio.md) drive, [audio.validate](../tools/audio.md) read, [audio.variables](../tools/audio.md) read |
| file:.afm | T2/T3 | candidate: file-format | none |
| file:.sig | T2/T3 | candidate: file-format | [audio.setSimValue](../tools/audio.md) drive, [audio.signal](../tools/audio.md) read, [audio.validate](../tools/audio.md) read |
| file:.snd | T2/T3 | candidate: file-format | none |
| file:file-type/.siga PA signal | T0/T3 | candidate: file-format | none |
| file:file-type/.wav resource type config | T0/T3 | candidate: file-format | none |
| file:file-type/.wav source sample | T0/T3 | candidate: file-format | none |
| file:file-type/Audio variables .conf | T0/T3 | candidate: file-format | none |
| file:file-type/Persisted window%2Fpanel settings | T0/T3 | candidate: cli, file-format | none |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://AudioEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Audio_Editor | T2/T5 | candidate: file-format | none |

### menu (33)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/menu/Close | T0/T3 | candidate: execute-action | none |
| ui:AudioEditor/menu/Close All Projects | T0/T3 | candidate: execute-action | none |
| ui:AudioEditor/menu/Create Group | T0/T3 | candidate: execute-action, file-format | none |
| ui:AudioEditor/menu/Debug | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Debug/In-Game Debug | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Debug/Log to Console | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Debug/Start Debugging (F5) | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Exit | T0/T2 | candidate: net-api-handler | none |
| ui:AudioEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/File Profiler | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/File/New | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/File/New/Project ("Project...") | T0/T3 | candidate: execute-action, file-format | none |
| ui:AudioEditor/menu/File/New/Signal ("Signal...") | T0/T3 | candidate: execute-action, file-format | none |
| ui:AudioEditor/menu/File/New/Variable | T0/T3 | candidate: file-format | none |
| ui:AudioEditor/menu/Filter Sounds | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Find No References | T0/T3 | candidate: file-format | none |
| ui:AudioEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/New DSP | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/New Final Mix | T0/T3 | candidate: file-format | none |
| ui:AudioEditor/menu/Open | T0/T3 | candidate: builtin-net-handler | none |
| ui:AudioEditor/menu/Panel toggle actions (12) | T0/T3 | candidate: execute-action | none |
| ui:AudioEditor/menu/Panel visibility context menu | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Save | T0/T3 | candidate: net-api-handler | none |
| ui:AudioEditor/menu/Save All | T0/T3 | candidate: execute-action | none |
| ui:AudioEditor/menu/Save As | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Toggle Wav Debug | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Tools | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Tools/File Converter | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Validate Project | T0/T3 | candidate: execute-action | none |
| ui:AudioEditor/menu/Validate Resources | T0/T3 | candidate: execute-action | none |
| ui:AudioEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |

### menu-item (44)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/menu-item/Debug/In-Game Debug/Sounds %2F Signals | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Debug/Log to Console/Wav Files | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Debug/Start Debugging | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Edit/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Edit/Create Group | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Edit/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Edit/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/File/Close | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Close All | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Exit | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/New/Final mix... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/New/Project... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/New/Signal... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/New/Variable... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Open | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Options... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Save All | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/File/Save As | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Help/View Help | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Tools/File Converter | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Tools/File Profiler | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Tools/Find resources with no references | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Tools/Memory info | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Tools/Validate Project | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Tools/Validate resources | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Window/Analyzers | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Emitter Simulation | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Item Detail | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Item Explorer | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Layout/Create New Layout | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Window/Layout/edit | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Window/Listener Setup | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Log Console | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Manage Layouts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Window/Output Analyzer | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:AudioEditor/menu-item/Window/Output Tracker | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/menu-item/Window/Playlist | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |

4 more: wb_census find with module=AudioEditor kind=menu-item.

### method (37)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/ACP groups | T0/T5 | candidate: file-format | none |
| api:method/ACP node Playback selection | T0/T5 | candidate: gui-automation | none |
| api:method/Add node | T0/T5 | candidate: file-format | none |
| api:method/Audibility test | T0/T5 | candidate: net-api-handler | none |
| api:method/Audio variables get%2Fset | T0/T5 | candidate: net-api-handler | none |
| api:method/Bounding volume | T0/T5 | candidate: net-api-handler | none |
| api:method/Bring module window to front | T0/T5 | candidate: builtin-net-handler | none |
| api:method/Canvas navigation (pan, zoom, region select, multiselect, axis-locked move, node dialog) | T0/T5 | candidate: gui-automation | none |
| api:method/Close module document | T0/T5 | candidate: net-api-handler | none |
| api:method/Close module window | T0/T5 | candidate: net-api-handler | none |
| api:method/Connect ports | T0/T5 | candidate: file-format | none |
| api:method/Double-click Signal node | T0/T5 | candidate: builtin-net-handler | none |
| api:method/Drag .sig onto Constants node | T0/T5 | candidate: net-api-handler | none |
| api:method/Entity and global signals | T0/T5 | candidate: net-api-handler | none |
| api:method/Entity sound events | T0/T5 | candidate: net-api-handler | none |
| api:method/Enumerate module containers | T0/T5 | candidate: net-api-handler | none |
| api:method/Execute menu action on a module | T0/T5 | candidate: execute-action | none |
| api:method/Expose port (ACP in ACP) | T0/T5 | candidate: file-format | none |
| api:method/Get plugin from module | T0/T5 | candidate: plugin-run | none |
| api:method/Group create | T0/T5 | candidate: file-format | none |
| api:method/Group options: Ungroup, Select All, Lock, Color | T0/T5 | candidate: file-format | none |
| api:method/Master and output volume | T0/T5 | candidate: net-api-handler | none |
| api:method/Music manager | T0/T5 | candidate: net-api-handler | none |
| api:method/Music project API | T0/T5 | candidate: net-api-handler | none |
| api:method/Name Sound node = sound event name | T0/T5 | candidate: file-format | none |
| api:method/Node comment | T0/T5 | candidate: file-format | none |
| api:method/Open a resource in its editor | T0/T5 | candidate: builtin-net-handler, net-api-handler | none |
| api:method/Open module window | T0/T5 | candidate: net-api-handler | none |
| api:method/Output state (mixer) instances | T0/T5 | candidate: net-api-handler | none |
| api:method/Play a sample | T0/T5 | candidate: net-api-handler | none |
| api:method/Preload and play an event | T0/T5 | candidate: net-api-handler | none |
| api:method/Read module CLI parameter | T0/T5 | candidate: net-api-handler | none |
| api:method/Save module document | T0/T5 | candidate: net-api-handler | none |
| api:method/SetOpenedResource on a module | T0/T5 | candidate: net-api-handler | none |
| api:method/Sound manager module | T0/T5 | candidate: net-api-handler | none |
| api:method/Sound world queries | T0/T5 | candidate: net-api-handler | none |
| api:method/Workbench links | T0/T5 | candidate: cli | none |

### module (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/module/AudioEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_module.open](../tools/wb_module.md) drive |
| ui:AudioEditor/module/AudioEditor module class | T1/T5 | candidate: net-api-handler | none |
| ui:AudioEditor/module/NavmeshGeneratorMain module class | T1/T5 | candidate: net-api-handler | none |
| ui:AudioEditor/module/ParticleEditor module class | T1/T5 | candidate: net-api-handler | none |

### panel (25)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/panel/#contentContents | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/#detailContents | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/#dockDetailContents | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/#dockWidgetContents | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/#logDockContents | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/#qt_tabwidget_tabbar | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/#statusBar | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/@QMainWindowTabBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/@QMainWindowTabBar.2 | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/@QMainWindowTabBar.3 | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Audio preview widget | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Curve Editor | T0/T3 | candidate: file-format | none |
| ui:AudioEditor/panel/Design canvas | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Emitter Simulation window | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Item detail | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Item explorer | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Listener setup | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Log console | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Master level monitor | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Nodes palette | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Output tracker | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Playlist | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Resource browser | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Signal Simulation window | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/panel/Variable Simulation window | T0/T3 | candidate: gui-automation | none |

### property (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/Node canvas position | T0/T2 | candidate: file-format | none |

### property-group (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/property-group/#ObstructionSimPropGrid | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/property-group/#SignalSimPropGrid | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/property-group/#VariablesSimPropGrid | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/property-group/AudioGlobalConfig in .gproj | T0/T3 | candidate: file-format | none |
| ui:AudioEditor/property-group/Options: Particle Editor options object | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/property-group/Options: Shortcuts categories | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/property-group/Project-level properties | T0/T3 | candidate: file-format | none |
| ui:AudioEditor/property-group/Sound component Filenames list | T0/T3 | candidate: file-format, net-api-handler | none |

### region (25)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#analyzers | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#centralwidget | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#dockWidgetContents_2 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#dockWidgetContents_5 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#dockWidgetContents_6 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#dockWidgetContents_7 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#emitterSimWidget | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#menubar | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#qt_scrollarea_hcontainer | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#qt_scrollarea_vcontainer | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#qt_scrollarea_viewport | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#qt_splithandle_gridPanel | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/#signalsDockContent | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/browserDockWidget/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/consoleDockWidget/logDockContents/@QScrollBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/consoleDockWidget/logDockContents/@QScrollBar.2 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/consoleDockWidget/logDockContents/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/listenerDockWidget/dockWidgetContents/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/listenerDockWidget/dockWidgetContents/@QToolBar.1/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/listenerDockWidget/dockWidgetContents/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/statusBar/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:AudioEditor/region/statusBar/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |

### schema-class (53)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ACPGroup | T2/T2 | candidate: file-format | none |
| schema:ACPInOut | T2/T2 | candidate: file-format | none |
| schema:AudioBankSampleClass | T2/T2 | candidate: file-format | none |
| schema:AudioClass | T2/T2 | candidate: file-format | none |
| schema:AudioOutputStateResClass | T2/T2 | candidate: file-format | none |
| schema:AudioSignalResClass | T2/T2 | candidate: file-format | none |
| schema:AuxOutClass | T2/T2 | candidate: file-format | none |
| schema:BankLocalClass | T2/T2 | candidate: file-format | none |
| schema:BusClass | T2/T2 | candidate: file-format | none |
| schema:ConstantClass | T2/T2 | candidate: file-format | none |
| schema:DynamicEqualizerDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:FilterChainClass | T2/T2 | candidate: file-format | none |
| schema:FlangerDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:GeneratorClass | T2/T2 | candidate: file-format | none |
| schema:IOPConstantsValueClass | T2/T2 | candidate: file-format | none |
| schema:IOPCurveModulatorPoint | T2/T2 | candidate: file-format | none |
| schema:IOPInputCurveModulatorClass | T2/T2 | candidate: file-format | none |
| schema:IOPInputLFOClass | T2/T2 | candidate: file-format | none |
| schema:IOPInputTimeClass | T2/T2 | candidate: file-format | none |
| schema:IOPInputVariableClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpAbsClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpAverageClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpCeilClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpDeltaClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpEnvClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpExpClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpModuloClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpPowClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpRoundClass | T2/T2 | candidate: file-format | none |
| schema:ItemDetailListItemClass | T2/T2 | candidate: file-format | none |
| schema:MixerClass | T2/T2 | candidate: file-format | none |
| schema:MonoToStereoDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:NoiseGateDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:OBusClass | T2/T2 | candidate: file-format | none |
| schema:OBusInOutClass | T2/T2 | candidate: file-format | none |
| schema:OBusOutClass | T2/T2 | candidate: file-format | none |
| schema:ODuckerClass | T2/T2 | candidate: file-format | none |
| schema:OnePoleFilterDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:PeakLimiterDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:PlaylistClass | T2/T2 | candidate: file-format | none |

13 more: wb_census find with module=AudioEditor kind=schema-class.

### schema-key (416)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ACPGroup.id | T2/T2 | candidate: file-format | none |
| schema:ACPGroup.name | T2/T2 | candidate: file-format | none |
| schema:ACPInOut.flags | T2/T2 | candidate: file-format | none |
| schema:ACPInOut.group | T2/T2 | candidate: file-format | none |
| schema:ACPInOut.id | T2/T2 | candidate: file-format | none |
| schema:ACPInOut.name | T2/T2 | candidate: file-format | none |
| schema:ACPInOut.piid | T2/T2 | candidate: file-format | none |
| schema:ACPInOut.port | T2/T2 | candidate: file-format | none |
| schema:AudioBankSampleClass.Filename | T2/T2 | candidate: file-format | none |
| schema:AudioBankSampleClass.Index | T2/T2 | candidate: file-format | none |
| schema:AudioBankSampleClass.Probability | T2/T2 | candidate: file-format | none |
| schema:AudioBankSampleClass.SampleMetadata | T2/T2 | candidate: file-format | none |
| schema:AudioClass.acp_groups | T2/T2 | candidate: file-format | none |
| schema:AudioClass.acp_ins | T2/T2 | candidate: file-format | none |
| schema:AudioClass.acp_outs | T2/T2 | candidate: file-format | none |
| schema:AudioClass.amplitudes | T2/T2 | candidate: file-format | none |
| schema:AudioClass.auxOuts | T2/T2 | candidate: file-format | none |
| schema:AudioClass.auxSelectors | T2/T2 | candidate: file-format | none |
| schema:AudioClass.banks_local | T2/T2 | candidate: file-format | none |
| schema:AudioClass.buses | T2/T2 | candidate: file-format | none |
| schema:AudioClass.constants | T2/T2 | candidate: file-format | none |
| schema:AudioClass.filter_chain | T2/T2 | candidate: file-format | none |
| schema:AudioClass.filters | T2/T2 | candidate: file-format | none |
| schema:AudioClass.frequency | T2/T2 | candidate: file-format | none |
| schema:AudioClass.generators | T2/T2 | candidate: file-format | none |
| schema:AudioClass.groups | T2/T2 | candidate: file-format | none |
| schema:AudioClass.listenerWindowModel | T2/T2 | candidate: file-format | none |
| schema:AudioClass.mixers | T2/T2 | candidate: file-format | none |
| schema:AudioClass.playlist | T2/T2 | candidate: file-format | none |
| schema:AudioClass.replacer | T2/T2 | candidate: file-format | none |
| schema:AudioClass.selectors | T2/T2 | candidate: file-format | none |
| schema:AudioClass.shaders | T2/T2 | candidate: file-format | none |
| schema:AudioClass.signals | T2/T2 | candidate: file-format | none |
| schema:AudioClass.sounds | T2/T2 | candidate: file-format | none |
| schema:AudioClass.sourcesLimit | T2/T2 | candidate: file-format | none |
| schema:AudioClass.spatialities | T2/T2 | candidate: file-format | none |
| schema:AudioClass.streams | T2/T2 | candidate: file-format | none |
| schema:AudioClass.switches | T2/T2 | candidate: file-format | none |
| schema:AudioClass.vars | T2/T2 | candidate: file-format | none |
| schema:AudioClass.version | T2/T2 | candidate: file-format | none |

376 more: wb_census find with module=AudioEditor kind=schema-key.

### setting-key (46)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Audio Editor%2FEditorManager%2FTabs/size | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FEditorManager/activeTab | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FEditorManager/tbShow | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FEditorManager/version | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLevelMeter/freezePeaks | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLevelMeter/meterType | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLevelMeter/modeType | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/ContextMask | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_1 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_16 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_2 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_32 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_4 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_64 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget%2FLogView/LogLevel_8 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget/errorsOnly | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget/fontSize | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget/infosOnly | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FLogWidget/warningsOnly | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/ascendingOrder | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/currentItem | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/expandAll | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/favorites | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/gridZoom | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/listModeEnabled | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/orientation | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/recursiveMode | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/root | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/runtimeFilterOn | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/showFavorites | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/showFavoritesFullPath | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/sortFavorites | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/sortingMethod | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/splitterState | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/splitterState2 | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/tagsMatchAll | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FResourceBrowser/textElideMode | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FVarSimWidget%2Ffiles/size | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FWaveWidget/showClipping | T0/T3 | candidate: file-format | none |
| setting:Audio Editor%2FPanels%2FWaveWidget/showDB | T0/T3 | candidate: file-format | none |

6 more: wb_census find with module=AudioEditor kind=setting-key.

### shortcut (56)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/shortcut/Audio Editor/Analyzers | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Close | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Copy | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Create Group | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Cut | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Emitter Simulation | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Exit | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Item Detail | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Item Explorer | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Listener Setup | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Log Console | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Open | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Output Analyzer | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Output Tracker | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Paste | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Playlist | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Project... | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Redo | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Resource Browser | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Save | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Save All | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Save As | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Signal Simulation | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Signal... | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Start Debugging | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Undo | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Audio Editor/Variable Simulation | T2/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Debug/Toggle Debug | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Edit/Copy | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Edit/Cut | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Edit/Paste | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Edit/Redo | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/Edit/Undo | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/Close | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/Exit | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/New Project | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/New Signal | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/Open | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/Save | T1/T2 | candidate: gui-automation | none |
| ui:AudioEditor/shortcut/File/Save All | T1/T2 | candidate: gui-automation | none |

16 more: wb_census find with module=AudioEditor kind=shortcut.

### status-item (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/status-item/statusBar/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |

### tab (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/tab/@QMainWindowTabBar/Item detail | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/@QMainWindowTabBar/Item explorer | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/@QMainWindowTabBar/Resource browser | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/@QMainWindowTabBar/Signal Simulation | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/Item detail/Item detail | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/Resource browser/Item explorer | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/Resource browser/Resource browser | T1/T3 | candidate: gui-automation | none |
| ui:AudioEditor/tab/Resource browser/Signal Simulation | T1/T3 | candidate: gui-automation | none |

### tool (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/tool/File Converter window | T0/T5 | candidate: gui-automation | none |
| ui:AudioEditor/tool/File Profiler window | T0/T5 | candidate: gui-automation | none |

### toolbar (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/toolbar/#toolBar | T0/T3 | candidate: gui-automation | none |
| ui:AudioEditor/toolbar/listenerDockWidget/dockWidgetContents/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |

### toolbar-button (13)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/BSP | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Background color | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Camera distance | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Check occlusion | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Move | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Reset model bones transformations to init state | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Rotate Y | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Show bones | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Show grid | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Show volumetric info | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AudioEditor/toolbar-button/listenerDockWidget/dockWidgetContents/@QToolBar.1/Turn camera to POI on mouse wheel | T2/T5 | candidate: execute-action, gui-automation | none |

### window (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AudioEditor/window/#AudioEditorMainWindow | T2/T3 | candidate: gui-automation | none |
| ui:AudioEditor/window/Mixer editing UI | T1/T3 | candidate: file-format, gui-automation | none |
| ui:AudioEditor/window/Signal Editor | T1/T3 | candidate: file-format, gui-automation | none |

## Below target (464)

- T0 to T2: 126
- T0 to T3: 103
- T0 to T5: 62
- T1 to T2: 41
- T1 to T3: 21
- T1 to T5: 9
- T2 to T3: 27
- T2 to T5: 74
- T3 to T5: 1

| id | tier | path |
| --- | --- | --- |
| api:class/ACP node (ACPClass) | T0/T2 | candidate: file-format |
| api:class/ACos (IOPItemOpACosClass) | T0/T2 | candidate: file-format |
| api:class/ASin (IOPItemOpASinClass) | T0/T2 | candidate: file-format |
| api:class/ATan (IOPItemOpATanClass) | T0/T2 | candidate: file-format |
| api:class/Abs (IOPItemOpAbsClass) x29 | T0/T2 | candidate: file-format |
| api:class/Amplitude (AmplitudeClass) x1,175 | T0/T2 | candidate: file-format |
| api:class/AuxOut (AuxOutClass) x1,932 | T0/T2 | candidate: file-format |
| api:class/AuxSelector (AuxSelectorClass) x36 | T0/T2 | candidate: file-format |
| api:class/Average (IOPItemOpAverageClass) x6 | T0/T2 | candidate: file-format |
| api:class/BankLocal (BankLocalClass) x10,892 | T0/T2 | candidate: file-format |
| api:class/Base (BaseDSPTypeClass) | T0/T2 | candidate: file-format |
| api:class/Biquad Filter (BiquadDSPTypeClass) x189 | T0/T2 | candidate: file-format |
| api:class/Bitcrusher (BitCrusherDSPTypeClass) x9 | T0/T2 | candidate: file-format |
| api:class/Bus (BusClass) x1,475 | T0/T2 | candidate: file-format |
| api:class/Ceil (IOPItemOpCeilClass) x1 | T0/T2 | candidate: file-format |
| api:class/Clamp (IOPItemOpClampClass) x8 | T0/T2 | candidate: file-format |
| api:class/ClampMax (IOPItemOpClampMaxClass) x16 | T0/T2 | candidate: file-format |
| api:class/ClampMin (IOPItemOpClampMinClass) x10 | T0/T2 | candidate: file-format |
| api:class/Compressor (CompressorDSPTypeClass) x39 | T0/T2 | candidate: file-format |
| api:class/Cond (IOPItemOpConditionClass) x121 | T0/T2 | candidate: file-format |
| api:class/Constants (ConstantClass) x834 | T0/T2 | candidate: file-format |
| api:class/Converter (IOPItemOpConvertorClass) x83 | T0/T2 | candidate: file-format |
| api:class/Convolution (ConvolutionDSPTypeClass) | T0/T2 | candidate: none-known |
| api:class/Cos (IOPItemOpCosClass) | T0/T2 | candidate: file-format |
| api:class/Curve Modulator (IOPInputCurveModulatorClass) x6 | T0/T2 | candidate: file-format |
| api:class/Db2Gain (SignalOpDb2GainClass) x147 | T0/T2 | candidate: file-format |
| api:class/Delta (IOPItemOpDeltaClass) x8 | T0/T2 | candidate: file-format |
| api:class/Distortion (DistortionDSPTypeClass) x23 | T0/T2 | candidate: file-format |
| api:class/Div (IOPItemOpDivClass) x71 | T0/T2 | candidate: file-format |
| api:class/Ducker (ODuckerClass) x6 | T0/T2 | candidate: file-format |
| api:class/Dynamic Equalizer (DynamicEqualizerDSPTypeClass) x3 | T0/T2 | candidate: file-format |
| api:class/Env (IOPItemOpEnvClass) x41 | T0/T2 | candidate: file-format |
| api:class/Equalizer4 (Equalizer4DSPTypeClass) x183 | T0/T2 | candidate: file-format |
| api:class/Exp (IOPItemOpExpClass) x8 | T0/T2 | candidate: file-format |
| api:class/Filter (FilterClass) x824 | T0/T2 | candidate: file-format |
| api:class/Filter (IOPItemOpFilterClass) x42 | T0/T2 | candidate: file-format |
| api:class/FilterChain (FilterChainClass) x186 | T0/T2 | candidate: file-format |
| api:class/Flanger (FlangerDSPTypeClass) x4 | T0/T2 | candidate: file-format |
| api:class/Floor (IOPItemOpFloorClass) x12 | T0/T2 | candidate: file-format |
| api:class/Freq2Mel (SignalOpFreq2MelClass) | T0/T2 | candidate: file-format |
| api:class/Freq2Oc (SignalOpFreq2OcClass) | T0/T2 | candidate: file-format |
| api:class/Frequency (FrequencyClass) x788 | T0/T2 | candidate: file-format |
| api:class/Gain2Db (SignalOpGain2DbClass) x4 | T0/T2 | candidate: file-format |
| api:class/Gain2St (SignalOpGain2StClass) | T0/T2 | candidate: file-format |
| api:class/Generator (GeneratorClass) x155 | T0/T2 | candidate: file-format |
| api:class/Generator (IOPInputGeneratorClass) | T0/T2 | candidate: file-format |
| api:class/Group (GroupClass) x1,620 | T0/T2 | candidate: file-format |
| api:class/Input (IOPItemInputClass) x952 | T0/T2 | candidate: file-format |
| api:class/Interpolate (IOPItemOpInterpolateClass) x579 | T0/T2 | candidate: file-format |
| api:class/LFO (IOPInputLFOClass) | T0/T2 | candidate: file-format |
| api:class/Ln (IOPItemOpLnClass) | T0/T2 | candidate: file-format |
| api:class/Log10 (IOPItemOpLog10Class) | T0/T2 | candidate: file-format |
| api:class/Log2 (IOPItemOpLog2Class) | T0/T2 | candidate: file-format |
| api:class/LoudnessNormalization (LoudnessNormalizationDSPTypeClass) | T0/T2 | candidate: file-format |
| api:class/Max (IOPItemOpMaxClass) x109 | T0/T2 | candidate: file-format |
| api:class/Mel2Freq (SignalOpMel2FreqClass) | T0/T2 | candidate: file-format |
| api:class/Min (IOPItemOpMinClass) x3 | T0/T2 | candidate: file-format |
| api:class/Mixer in%2Fout bus (OBusInOutClass) x32 | T0/T2 | candidate: file-format |
| api:class/Mixer input bus (OBusClass) x39 | T0/T2 | candidate: file-format |
| api:class/Mixer output bus (OBusOutClass) x7 | T0/T2 | candidate: file-format |

404 more: wb_census find with module=AudioEditor.

## Dispositions (103)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:class/ACP node (ACPClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/ACos (IOPItemOpACosClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/ASin (IOPItemOpASinClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/ATan (IOPItemOpATanClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Abs (IOPItemOpAbsClass) x29 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Amplitude (AmplitudeClass) x1,175 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AuxOut (AuxOutClass) x1,932 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AuxSelector (AuxSelectorClass) x36 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Average (IOPItemOpAverageClass) x6 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/BankLocal (BankLocalClass) x10,892 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Base (BaseDSPTypeClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Biquad Filter (BiquadDSPTypeClass) x189 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Bitcrusher (BitCrusherDSPTypeClass) x9 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Bus (BusClass) x1,475 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Ceil (IOPItemOpCeilClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Clamp (IOPItemOpClampClass) x8 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/ClampMax (IOPItemOpClampMaxClass) x16 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/ClampMin (IOPItemOpClampMinClass) x10 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Compressor (CompressorDSPTypeClass) x39 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Cond (IOPItemOpConditionClass) x121 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Constants (ConstantClass) x834 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Converter (IOPItemOpConvertorClass) x83 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Convolution (ConvolutionDSPTypeClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Cos (IOPItemOpCosClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Curve Modulator (IOPInputCurveModulatorClass) x6 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Db2Gain (SignalOpDb2GainClass) x147 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Delta (IOPItemOpDeltaClass) x8 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Distortion (DistortionDSPTypeClass) x23 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Div (IOPItemOpDivClass) x71 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Ducker (ODuckerClass) x6 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Dynamic Equalizer (DynamicEqualizerDSPTypeClass) x3 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Env (IOPItemOpEnvClass) x41 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Equalizer4 (Equalizer4DSPTypeClass) x183 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Exp (IOPItemOpExpClass) x8 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Filter (FilterClass) x824 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Filter (IOPItemOpFilterClass) x42 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/FilterChain (FilterChainClass) x186 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Flanger (FlangerDSPTypeClass) x4 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Floor (IOPItemOpFloorClass) x12 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Freq2Mel (SignalOpFreq2MelClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Freq2Oc (SignalOpFreq2OcClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Frequency (FrequencyClass) x788 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Gain2Db (SignalOpGain2DbClass) x4 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Gain2St (SignalOpGain2StClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Generator (GeneratorClass) x155 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Generator (IOPInputGeneratorClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Group (GroupClass) x1,620 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Input (IOPItemInputClass) x952 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Interpolate (IOPItemOpInterpolateClass) x579 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/LFO (IOPInputLFOClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Ln (IOPItemOpLnClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Log10 (IOPItemOpLog10Class) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Log2 (IOPItemOpLog2Class) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/LoudnessNormalization (LoudnessNormalizationDSPTypeClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Max (IOPItemOpMaxClass) x109 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Mel2Freq (SignalOpMel2FreqClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Min (IOPItemOpMinClass) x3 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Mixer in%2Fout bus (OBusInOutClass) x32 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Mixer input bus (OBusClass) x39 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Mixer output bus (OBusOutClass) x7 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Mod (IOPItemOpModuloClass) x5 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/MonoToStereo (MonoToStereoDSPTypeClass) x6 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Mul (IOPItemOpMulClass) x763 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/NoiseGate (NoiseGateDSPTypeClass) x3 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/OnePoleFilter (OnePoleFilterDSPTypeClass) x11 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Output (IOPItemOutputClass) x1,035 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PeakLimiter (PeakLimiterDSPTypeClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Phaser (PhaserDSPTypeClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Playlist (PlaylistClass) x602 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Pow (IOPItemOpPowClass) x246 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/QuadDelay (QuadDelayDSPTypeClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Random (IOPInputRandomClass) x24 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Remainder (IOPItemOpRemainderClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Replacer (ReplacerClass) x32 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Reverb (ReverbDSPTypeClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Reverb2 (Reverb2DSPTypeClass) x3 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Round (IOPItemOpRoundClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Selector (SelectorClass) x958 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Sequence (SequenceClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Shader (ShaderClass) x4,349 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Signal (SignalClass) x2,971 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Sin (IOPItemOpSinClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SmallRoomReverb (SmallRoomReverbDSPTypeClass) x2 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Smoother (IOPItemOpSmootherClass) x4 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Sound (SoundClass) x4,078 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Spatiality (SpatialityClass) x1,105 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Square Modulator (IOPInputSquareModulatorClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/St2Gain (SignalOpSt2GainClass) x24 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Stream (StreamClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Sub (IOPItemOpSubClass) x235 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Sum (IOPItemOpSumClass) x152 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Switch (SwitchClass) x105 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Tan (IOPItemOpTanClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/Time (IOPInputTimeClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Tremolo (TremoloDSPTypeClass) x1 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Value (IOPInputValueClass) x561 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Variable (IOPInputVariableClass) x106 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Variable (VariableClass) x168 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/VariableRolloffLPF (VariableRolloffLPFDSPTypeClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| ui:AudioEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:AudioEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:AudioEditor/shortcut/Audio Editor/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:AudioEditor/shortcut/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
