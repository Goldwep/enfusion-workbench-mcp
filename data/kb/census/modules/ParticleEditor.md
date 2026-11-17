# Census: ParticleEditor

242 rows (6 aggregate excluded).

## What it is

Module ParticleEditor: api 11, diag 1, file 3, link 2, schema 98, setting 16, ui 111. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class ParticleEditor (api:ParticleEditor)
- file-type .ptc (file:.ptc): Particle effects definition
- file-type .ptc Particle System Definition (file:file-type/.ptc Particle System Definition): Text, root EffectDef > Emitters > EmitterDef NAME. 436 in vanilla (2.1 MB), LF, no BOM
- file-type ParticleEffect resource type config (file:file-type/ParticleEffect resource type config): configs/ResourceTypes/<PLATFORM>/ParticleEffect.conf = empty PTCResourceClass
- schema-class EffectDef (schema:EffectDef): 442 instances in 442 .ptc files of the 1.9.0.37 paks; root
- schema-class EmitterDef (schema:EmitterDef): 2423 instances in 442 .ptc files of the 1.9.0.37 paks; nested
- dock consoleDock (ui:ParticleEditor/dock/#consoleDock)
- dock dockWidget (ui:ParticleEditor/dock/#dockWidget)
- dock dockWidget_2 (ui:ParticleEditor/dock/#dockWidget_2)
- dock particleTimeGraphDock (ui:ParticleEditor/dock/#particleTimeGraphDock)
- dock timeLineDock (ui:ParticleEditor/dock/#timeLineDock)
- module ParticleEditor (ui:ParticleEditor/module/ParticleEditor)
- ... 10 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 10 | 0 | 1 | 0 | 0 | 0 | 11 |
| diag | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 2 | 0 | 1 | 0 | 0 | 0 | 3 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| schema | 1 | 0 | 97 | 0 | 0 | 0 | 98 |
| setting | 16 | 0 | 0 | 0 | 0 | 0 | 16 |
| ui | 63 | 36 | 12 | 0 | 0 | 0 | 111 |

## By kind

- class: 1
- control: 5
- diag-option: 1
- dock: 5
- enum: 1
- file-type: 3
- link-format: 2
- menu: 5
- menu-item: 6
- method: 9
- module: 1
- option: 2
- panel: 10
- property: 1
- property-group: 20
- schema-class: 2
- schema-key: 95
- setting-key: 16
- shortcut: 12
- tab: 2
- tool: 18
- toolbar: 4
- toolbar-button: 21

## By risk

- destructive: 2
- mutating: 89
- safe: 151

## Rows by kind

### class (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:ParticleEditor | T2/T2 | candidate: none-known | none |

### control (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/control/Effect Panel/Emitters | T1/T5 | candidate: gui-automation | [particle.emitters](../tools/particle.md) drive |
| ui:ParticleEditor/control/Effect Panel/Pause | T1/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/control/Effect Panel/Restart | T1/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/control/Effect Panel/Step | T1/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/control/Effect Panel/drop-down menu | T1/T5 | candidate: gui-automation | none |

### diag-option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| diag:diag-option/Diag menu: particles | T0/T2 | candidate: gui-automation, net-api-handler | none |

### dock (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/dock/#consoleDock | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/dock/#dockWidget | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/dock/#dockWidget_2 | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/dock/#particleTimeGraphDock | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/dock/#timeLineDock | T0/T3 | candidate: gui-automation | none |

### enum (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:enum/EmitterParam enum | T0/T2 | candidate: net-api-handler | none |

### file-type (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.ptc | T2/T3 | candidate: file-format | [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [particle.addEmitter](../tools/particle.md) drive, [particle.catalog](../tools/particle.md) read, [particle.cloneEmitter](../tools/particle.md) drive, [particle.copyEmitter](../tools/particle.md) drive, [particle.create](../tools/particle.md) drive, [particle.curves](../tools/particle.md) read, [particle.diff](../tools/particle.md) read, [particle.emitter](../tools/particle.md) read, [particle.emitters](../tools/particle.md) read, [particle.inspect](../tools/particle.md) read, [particle.moveEmitter](../tools/particle.md) drive, [particle.refs](../tools/particle.md) read, [particle.removeEmitter](../tools/particle.md) drive, [particle.renameEmitter](../tools/particle.md) drive, [particle.set](../tools/particle.md) drive, [particle.setCurve](../tools/particle.md) drive, [particle.validate](../tools/particle.md) read, [particle_inspect.run](../tools/particle_inspect.md) read, [project_index_status.run](../tools/project_index_status.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [resolve_guid.run](../tools/resolve_guid.md) read |
| file:file-type/.ptc Particle System Definition | T0/T3 | candidate: file-format | none |
| file:file-type/ParticleEffect resource type config | T0/T3 | candidate: file-format | none |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://ParticleEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Particle_Editor | T2/T5 | candidate: file-format | none |

### menu (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/menu/Emitter List Options | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/menu/Exit | T0/T2 | candidate: net-api-handler | none |
| ui:ParticleEditor/menu/Load Effect | T0/T3 | candidate: builtin-net-handler | none |
| ui:ParticleEditor/menu/New Effect | T0/T3 | candidate: execute-action, file-format | none |
| ui:ParticleEditor/menu/Save Effect | T0/T3 | candidate: net-api-handler | none |

### menu-item (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/menu-item/Pause Effect | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/menu-item/Rename Emitter | T0/T5 | candidate: file-format | none |
| ui:ParticleEditor/menu-item/Repeat Effect | T0/T5 | candidate: execute-action | none |
| ui:ParticleEditor/menu-item/Restart Effect | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/menu-item/Step Effect | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/menu-item/Toggle Fullscreen Mode | T0/T5 | candidate: execute-action | none |

### method (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Clone Emitter | T0/T5 | candidate: file-format | none |
| api:method/Delete Emitter | T0/T5 | candidate: file-format | none |
| api:method/Emitter enable checkbox | T0/T5 | candidate: gui-automation | none |
| api:method/Force LOD dropdown, Hide inactive, Restart on change | T0/T5 | candidate: gui-automation | none |
| api:method/Game Master particle camera effects | T0/T5 | candidate: none-known | none |
| api:method/Place effect in a world | T0/T5 | candidate: net-api-handler | none |
| api:method/Runtime particle control | T0/T5 | candidate: net-api-handler | none |
| api:method/Runtime particle entity | T0/T5 | candidate: net-api-handler | none |
| api:method/Solo emitter | T0/T5 | candidate: gui-automation | none |

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/module/ParticleEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | none |

### option (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/option/Effect Panel/Hide inactive | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ParticleEditor/option/Effect Panel/Restart on change | T1/T5 | candidate: file-format, gui-automation | none |

### panel (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/panel/Animation Panel | T1/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/panel/Animation window (curve editor) | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/panel/Effect Panel | T1/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/panel/Effect window (Emitters list) | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/panel/Emitter Panel | T1/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/panel/Emitter window (property grid) | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/panel/Log panel | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/panel/Material Editor | T1/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/panel/Preview Panel | T1/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/panel/Preview window | T0/T3 | candidate: gui-automation | none |

### property (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/Per-emitter LOD range slider | T0/T2 | candidate: file-format | none |

### property-group (20)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/property-group/Effect root properties | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: appearance | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: collisions | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: emission shape | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ParticleEditor/property-group/Emitter props: emitting time | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: lifetime | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: light and occlusion | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: physics | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: prefab ("3D") particles | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: rates | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter props: texture sheet animation | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Emitter-time master curves | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle collision presets in .gproj | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle material: basics | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle material: emissivity | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle material: general | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle material: lighting | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle material: maps and modifiers | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle material: soft depth | T0/T3 | candidate: file-format | none |
| ui:ParticleEditor/property-group/Particle-lifetime curves | T0/T3 | candidate: file-format | none |

### schema-class (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:EffectDef | T2/T2 | candidate: file-format | none |
| schema:EmitterDef | T2/T2 | candidate: file-format | none |

### schema-key (95)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:EffectDef.CastShadow | T2/T2 | candidate: file-format | none |
| schema:EffectDef.CollisionPreset | T2/T2 | candidate: file-format | none |
| schema:EffectDef.Emitters | T2/T2 | candidate: file-format | none |
| schema:EffectDef.LightClipEV | T2/T2 | candidate: file-format | none |
| schema:EffectDef.LightOffset | T2/T2 | candidate: file-format | none |
| schema:EffectDef.LightRadius | T2/T2 | candidate: file-format | none |
| schema:EffectDef.MinFPS | T2/T2 | candidate: file-format | none |
| schema:EffectDef.Version | T2/T2 | candidate: file-format | none |
| schema:EffectDef.WorldRelativeY | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AirResistance | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AirResistanceMast | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AirResistanceRND | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.Alpha | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AlphaMast | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.Angles | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AngularFadeOutEnd | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AngularFadeOutStart | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AnimFPS | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.AnimOnce | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.BRateMast | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.BillboardingType | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.BirthRate | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.BirthRateRND | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.BirthRateVel | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.CenterX | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.CenterY | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.CenterZ | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.CollisionDistThresh | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.Color | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.ColorMast | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.ConeAngle | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.ConeAngleMinDist | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.ConeAngleRndRange | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.Emissivity | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.EmittingTime | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.EnableCollisions | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.EnableLight | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.FlipU | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.FlipV | T2/T2 | candidate: file-format | none |
| schema:EmitterDef.Friction | T2/T2 | candidate: file-format | none |

55 more: wb_census find with module=ParticleEditor kind=schema-key.

### setting-key (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Particle Editor%2FLogWidget%2FLogView/ContextMask | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_1 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_16 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_2 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_32 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_4 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_64 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_8 | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget/errorsOnly | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget/fontSize | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget/infosOnly | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FLogWidget/warningsOnly | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FPerspectives%2Fdefault/Geometry | T0/T3 | candidate: file-format | none |
| setting:Particle Editor%2FPerspectives%2Fdefault/State | T0/T3 | candidate: file-format | none |
| setting:Particle Editor/currentPerspective | T0/T3 | candidate: file-format | none |
| setting:Particle Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |

### shortcut (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/shortcut/Particle Editor/Exit | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Load Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/New Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Pause Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Rename Emitter | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Repeat Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Restart Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Save Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Select Next Emitter | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Select Previous Emitter | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Step Effect | T2/T2 | candidate: gui-automation | none |
| ui:ParticleEditor/shortcut/Particle Editor/Toggle Fullscreen Mode | T2/T2 | candidate: gui-automation | none |

### tab (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/tab/Animation Panel/Emitter-Time Graphs | T1/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/tab/Animation Panel/Particle-Lifetime Graphs | T1/T3 | candidate: gui-automation | none |

### tool (18)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/tool/Curve editor: Snap to Grid, Lock Horizontal Axis, See Through Layers, Point Editor | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Change FOV | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Cone Angle Volume | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Emit Source Volume | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Helper Model | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Move Tool | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Movement simulation | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Reset Entity Rotations | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Rotate Tool | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Setup Global Wind | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Show%2FHide Grid | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Show%2FHide Ground (and Ground Material) | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Show%2FHide Stats | T0/T5 | candidate: gui-automation, net-api-handler | none |
| ui:ParticleEditor/tool/Toolbar: Simulate Low FPS | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Snap Position to Ground | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Stress Test | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Switch World%2FLocal coordinates | T0/T5 | candidate: gui-automation | none |
| ui:ParticleEditor/tool/Toolbar: Turn camera to POI on Mouse Wheel | T0/T5 | candidate: gui-automation | none |

### toolbar (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/toolbar/#toolbarCommon | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/toolbar/#toolbarFileOperations | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/toolbar/#toolbarParticleTools | T0/T3 | candidate: gui-automation | none |
| ui:ParticleEditor/toolbar/#toolbarTransport | T0/T3 | candidate: gui-automation | none |

### toolbar-button (21)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ParticleEditor/toolbar-button/Animation Panel/Lock Horizontal Axis | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Animation Panel/Point Editor | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Animation Panel/See Through Layers | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Animation Panel/Snap to Grid | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Change FOV | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Cone Angle Volume | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Emit Source Volume | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Helper Model | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Move Tool | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Movement simulation | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Reset Entity Rotations | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Rotate Tool | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Setup Global Wind | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Show%2FHide Grid | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Show%2FHide Ground | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Show%2FHide Stats | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Simulate Low FPS | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Snap Position to Ground | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Stress Test | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Switch World%2Flocal coordinate system | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ParticleEditor/toolbar-button/Preview Panel/Turn camera to POI on Mouse Wheel | T1/T5 | candidate: execute-action, gui-automation | none |

## Below target (132)

- T0 to T2: 4
- T0 to T3: 56
- T0 to T5: 33
- T1 to T3: 7
- T1 to T5: 30
- T2 to T3: 1
- T2 to T5: 1

| id | tier | path |
| --- | --- | --- |
| api:enum/EmitterParam enum | T0/T2 | candidate: net-api-handler |
| api:method/Clone Emitter | T0/T5 | candidate: file-format |
| api:method/Delete Emitter | T0/T5 | candidate: file-format |
| api:method/Emitter enable checkbox | T0/T5 | candidate: gui-automation |
| api:method/Force LOD dropdown, Hide inactive, Restart on change | T0/T5 | candidate: gui-automation |
| api:method/Game Master particle camera effects | T0/T5 | candidate: none-known |
| api:method/Place effect in a world | T0/T5 | candidate: net-api-handler |
| api:method/Runtime particle control | T0/T5 | candidate: net-api-handler |
| api:method/Runtime particle entity | T0/T5 | candidate: net-api-handler |
| api:method/Solo emitter | T0/T5 | candidate: gui-automation |
| diag:diag-option/Diag menu: particles | T0/T2 | candidate: gui-automation, net-api-handler |
| file:.ptc | T2/T3 | candidate: file-format |
| file:file-type/.ptc Particle System Definition | T0/T3 | candidate: file-format |
| file:file-type/ParticleEffect resource type config | T0/T3 | candidate: file-format |
| link:enfusion://ParticleEditor | T1/T5 | candidate: cli |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Particle_Editor | T2/T5 | candidate: file-format |
| schema:property/Per-emitter LOD range slider | T0/T2 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/ContextMask | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_1 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_16 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_2 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_32 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_4 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_64 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget%2FLogView/LogLevel_8 | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget/errorsOnly | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget/fontSize | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget/infosOnly | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FLogWidget/warningsOnly | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FPerspectives%2Fdefault/Geometry | T0/T3 | candidate: file-format |
| setting:Particle Editor%2FPerspectives%2Fdefault/State | T0/T3 | candidate: file-format |
| setting:Particle Editor/currentPerspective | T0/T3 | candidate: file-format |
| setting:Particle Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format |
| ui:ParticleEditor/control/Effect Panel/Emitters | T1/T5 | candidate: gui-automation |
| ui:ParticleEditor/control/Effect Panel/Pause | T1/T5 | candidate: gui-automation |
| ui:ParticleEditor/control/Effect Panel/Restart | T1/T5 | candidate: gui-automation |
| ui:ParticleEditor/control/Effect Panel/Step | T1/T5 | candidate: gui-automation |
| ui:ParticleEditor/control/Effect Panel/drop-down menu | T1/T5 | candidate: gui-automation |
| ui:ParticleEditor/dock/#consoleDock | T0/T3 | candidate: gui-automation |
| ui:ParticleEditor/dock/#dockWidget | T0/T3 | candidate: gui-automation |
| ui:ParticleEditor/dock/#dockWidget_2 | T0/T3 | candidate: gui-automation |
| ui:ParticleEditor/dock/#particleTimeGraphDock | T0/T3 | candidate: gui-automation |
| ui:ParticleEditor/dock/#timeLineDock | T0/T3 | candidate: gui-automation |
| ui:ParticleEditor/menu-item/Pause Effect | T0/T5 | candidate: execute-action, gui-automation |
| ui:ParticleEditor/menu-item/Rename Emitter | T0/T5 | candidate: file-format |
| ui:ParticleEditor/menu-item/Repeat Effect | T0/T5 | candidate: execute-action |
| ui:ParticleEditor/menu-item/Restart Effect | T0/T5 | candidate: execute-action, gui-automation |
| ui:ParticleEditor/menu-item/Step Effect | T0/T5 | candidate: execute-action, gui-automation |
| ui:ParticleEditor/menu-item/Toggle Fullscreen Mode | T0/T5 | candidate: execute-action |
| ui:ParticleEditor/menu/Emitter List Options | T0/T3 | candidate: gui-automation |
| ui:ParticleEditor/menu/Exit | T0/T2 | candidate: net-api-handler |
| ui:ParticleEditor/menu/Load Effect | T0/T3 | candidate: builtin-net-handler |
| ui:ParticleEditor/menu/New Effect | T0/T3 | candidate: execute-action, file-format |
| ui:ParticleEditor/menu/Save Effect | T0/T3 | candidate: net-api-handler |
| ui:ParticleEditor/module/ParticleEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler |
| ui:ParticleEditor/option/Effect Panel/Hide inactive | T1/T5 | candidate: file-format, gui-automation |
| ui:ParticleEditor/option/Effect Panel/Restart on change | T1/T5 | candidate: file-format, gui-automation |
| ui:ParticleEditor/panel/Animation Panel | T1/T3 | candidate: gui-automation |
| ui:ParticleEditor/panel/Animation window (curve editor) | T0/T3 | candidate: file-format |
| ui:ParticleEditor/panel/Effect Panel | T1/T3 | candidate: gui-automation |

72 more: wb_census find with module=ParticleEditor.

## Dispositions (1)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| ui:ParticleEditor/shortcut/Particle Editor/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
