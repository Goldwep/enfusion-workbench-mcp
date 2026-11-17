/**
 * Test fixtures for the final per-editor pass: for each Workbench editor, one
 * or more small resources of the kinds that editor opens.
 *
 * Two layouts from one plan:
 *   --layout projects  one addon per editor under <out>: `<out>/EMCP2_fx_<Editor>/addon.gproj`
 *                      plus that editor's files. Reads, opens and the 1.x tools work in any
 *                      project; the 2.0 handlers refuse a write outside the 2.0 sandbox.
 *   --layout sandbox   every editor's files inside one project folder (<out> = the 2.0
 *                      sandbox), for the write actions the guard allows only there.
 * Inside a project the paths are the same in both layouts.
 *
 * A fixture is either generated here (world, layer, prefab, script, string table, behavior
 * trees) or copied byte for byte from the installed game's paks under a new path. A copy
 * has no `.meta`: the Workbench registers it under a new GUID. References inside a copy
 * still point at the vanilla resources (an animation workspace copy opens the vanilla
 * graph files), which is enough to open and read; say so in a test that edits.
 *
 * Nothing is deleted and nothing existing is replaced without --overwrite. Default is a
 * dry run that prints the plan.
 *
 *   npx tsx scripts/live/editor-fixtures.ts --out <dir> --layout projects|sandbox [--overwrite] [--really]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emitBt, parseBt, setProp, quoted } from "../../src/behavior-tree/model.js";
import { buildBt, validateBt, type TreeSpec } from "../../src/behavior-tree/tree.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { generateGproj } from "../../src/templates/gproj.js";
import { generateStringTable } from "../../src/templates/localization.js";
import { generatePrefab } from "../../src/templates/prefab.js";
import { generateScript } from "../../src/templates/script.js";
import { assertInsideRoot } from "../../src/utils/path-guard.js";
import { isMainModule } from "./cli.js";

/** The editors of build 1.9.0.37 (the WBModuleDef classes; the navmesh generator class is gone). */
export const EDITORS = [
  "WorldEditor",
  "ResourceManager",
  "ScriptEditor",
  "AnimEditor",
  "AudioEditor",
  "BehaviorEditor",
  "ParticleEditor",
  "ProcAnimEditor",
  "LocalizationEditor",
  "DialogueEditor",
] as const;
export type Editor = (typeof EDITORS)[number];

export interface Fixture {
  editor: Editor;
  /** Path inside the project. */
  path: string;
  /** What the test opens or reads it as. */
  kind: string;
  /** The vanilla resource copied, or "generated". */
  source: string;
  /** The text to write, for a generated fixture. */
  text?: string;
}

const FX = "EMCPFixtures";
const GUARD_TREE = `AI/BehaviorTrees/${FX}/Fixture_Guard.bt`;
const COPIED_TREE = `AI/BehaviorTrees/${FX}/Fixture_Animate.bt`;

export const GUARD_SPEC: TreeSpec = {
  path: GUARD_TREE,
  variables: [
    { name: "alert", type: "Bool", flag: "input" },
    { name: "stance", type: "Integer" },
  ],
  root: {
    type: "Selector",
    children: [
      {
        type: "DecoTestVariable",
        name: "Is alert",
        props: { TestType: "EqualsValue", TestValue: "true" },
        vars: { InVariable: "alert" },
        children: [
          {
            type: "Sequence",
            children: [
              { type: "SCR_AISetStance", in: { Stance: "stance" }, props: { m_eStance: "CROUCH" } },
              { type: "AITaskIdle", name: "Hold", props: { Period: 2, PeriodRandom: 0.5 } },
              {
                type: "RunBT",
                props: {
                  BehaviorTree: "{98F1144DA724F591}AI/BehaviorTrees/Chimera/Soldier/LookAction.bt",
                },
              },
            ],
          },
        ],
      },
      { type: "AITaskReturnState", props: { Result: "RUNNING" } },
    ],
  },
};

const WORLD = ["SubScene {", ' Parent "{A9806AF617972E97}worlds/Arland/Arland.ent"', "}"].join(
  "\n",
);
const LAYER = [
  'GenericEntity EMCP_Fixture_Radio : "{54C68E438DD34265}Prefabs/Items/Equipment/Radios/Radio_R107M.et" {',
  " coords 2056 40.5 2048",
  "}",
].join("\n");

/** [editor, path in the project, kind, vanilla source]. */
const COPIES: readonly (readonly [Editor, string, string, string])[] = [
  [
    "ResourceManager",
    `${FX}/ResourceManager/Fixture.conf`,
    "config",
    "Configs/Core/AIDebugCore.conf",
  ],
  [
    "ResourceManager",
    `${FX}/ResourceManager/Fixture.layout`,
    "layout",
    "UI/layouts/Camera/ManualCameraCrosshair.layout",
  ],
  [
    "ResourceManager",
    `${FX}/ResourceManager/Fixture.imageset`,
    "imageset",
    "UI/Imagesets/ScrollbarRectangles.imageset",
  ],
  [
    "ResourceManager",
    `${FX}/ResourceManager/Fixture.emat`,
    "material",
    "system/materials/lightSourceDefault.emat",
  ],
  ["ResourceManager", `${FX}/ResourceManager/Fixture.styles`, "styles", "UI/Styles/editor.styles"],
  [
    "AnimEditor",
    `${FX}/AnimEditor/tripods.aw`,
    "animation workspace",
    "anims/workspaces/generic/tripods/tripods.aw",
  ],
  [
    "AnimEditor",
    `${FX}/AnimEditor/tripods.agr`,
    "animation graph",
    "anims/workspaces/generic/tripods/tripods.agr",
  ],
  [
    "AnimEditor",
    `${FX}/AnimEditor/tripods.agf`,
    "animation graph file",
    "anims/workspaces/generic/tripods/tripods.agf",
  ],
  [
    "AnimEditor",
    `${FX}/AnimEditor/tripods.ast`,
    "animation set template",
    "anims/workspaces/generic/tripods/tripods.ast",
  ],
  [
    "AnimEditor",
    `${FX}/AnimEditor/tripods.asi`,
    "animation set instance",
    "anims/workspaces/generic/tripods/tripods.asi",
  ],
  ["AudioEditor", `${FX}/AudioEditor/Fixture.acp`, "audio project", "Sounds/UI/UI_Rally.acp"],
  [
    "AudioEditor",
    `${FX}/AudioEditor/Fixture.sig`,
    "signal file",
    "Sounds/Structures/Military/Sirens/Structures_Siren.sig",
  ],
  [
    "ParticleEditor",
    `${FX}/ParticleEditor/Fixture.ptc`,
    "particle effect",
    "Particles/Enviroment/Flies.ptc",
  ],
  [
    "ProcAnimEditor",
    `${FX}/ProcAnimEditor/Fixture.pap`,
    "procedural animation",
    "anims/proc/clock_pendulum.pap",
  ],
  [
    "ProcAnimEditor",
    `${FX}/ProcAnimEditor/Fixture.siga`,
    "procedural animation signal",
    "anims/proc/wheel_rot.siga",
  ],
];

/** The generated fixtures and the list of copies; `readVanilla` supplies the tree that is re-pathed. */
export function planFixtures(readVanilla: (path: string) => string): Fixture[] {
  const guard = buildBt(GUARD_SPEC);
  const copied = parseBt(readVanilla("AI/BehaviorTrees/Waypoints/WP_Animate.bt"));
  // The copy sits at a new path: the header loses its `{GUID}path` word and Name follows the file.
  copied.root.head = [copied.root.head[0]];
  setProp(copied.root, "Name", [quoted(COPIED_TREE)]);
  for (const [doc, path] of [
    [guard, GUARD_TREE],
    [copied, COPIED_TREE],
  ] as const) {
    const errors = validateBt(doc, { expectedPath: path }).filter((f) => f.level === "error");
    if (errors.length) throw new Error(`${path}: ${errors.map((e) => e.message).join("; ")}`);
  }
  const generated: Fixture[] = [
    {
      editor: "WorldEditor",
      path: `worlds/${FX}/FixtureWorld.ent`,
      kind: "world (sub-scene of Arland)",
      source: "generated",
      text: WORLD,
    },
    {
      editor: "WorldEditor",
      path: `worlds/${FX}/FixtureWorld_Layers/default.layer`,
      kind: "world layer, one entity",
      source: "generated",
      text: LAYER,
    },
    {
      editor: "ResourceManager",
      path: `${FX}/ResourceManager/Fixture.et`,
      kind: "prefab",
      source: "generated",
      text: generatePrefab({ name: "Fixture", prefabType: "prop" }),
    },
    {
      editor: "ScriptEditor",
      path: `Scripts/Game/${FX}/EMCP_FixtureScript.c`,
      kind: "script",
      source: "generated",
      text: generateScript({
        className: "EMCP_FixtureScript",
        scriptType: "basic",
        description: "Fixture for the Script Editor tests. Not referenced by anything.",
      }),
    },
    {
      editor: "BehaviorEditor",
      path: GUARD_TREE,
      kind: "behavior tree (authored by behavior_tree)",
      source: "generated",
      text: emitBt(guard),
    },
    {
      editor: "BehaviorEditor",
      path: COPIED_TREE,
      kind: "behavior tree (vanilla, re-pathed)",
      source: "AI/BehaviorTrees/Waypoints/WP_Animate.bt",
      text: emitBt(copied),
    },
    {
      editor: "LocalizationEditor",
      path: `${FX}/LocalizationEditor/Fixture.st`,
      kind: "string table",
      source: "generated",
      text: generateStringTable({
        modName: "EMCPFixtures",
        entries: [
          { key: "STR_EMCPFixtures_One", original: "Fixture string one" },
          { key: "STR_EMCPFixtures_Two", original: "Fixture string two" },
        ],
      }),
    },
  ];
  const copies: Fixture[] = COPIES.map(([editor, path, kind, source]) => ({
    editor,
    path,
    kind,
    source,
  }));
  return [...generated, ...copies];
}

/** A stable project GUID from the project name. */
export function projectGuid(name: string): string {
  return createHash("sha1").update(`emcp-fixture:${name}`).digest("hex").slice(0, 16).toUpperCase();
}

export interface WriteResult {
  written: string[];
  kept: string[];
}

/** Writes one project's files under `root`; an existing file is kept unless `overwrite`. */
export function writeProject(
  root: string,
  files: readonly { path: string; data: string | Buffer }[],
  overwrite: boolean,
): WriteResult {
  const out: WriteResult = { written: [], kept: [] };
  for (const f of files) {
    const target = resolve(root, f.path);
    assertInsideRoot(target, root, f.path);
    if (existsSync(target) && !overwrite) {
      out.kept.push(f.path);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.data);
    out.written.push(f.path);
  }
  return out;
}

function manifest(project: string, fixtures: readonly Fixture[], build: string): string {
  return (
    JSON.stringify(
      {
        project,
        build,
        note: "Generated by scripts/live/editor-fixtures.ts. Copies have no .meta: the Workbench gives them new GUIDs. DialogueEditor has no fixture: no dialogue resource ships with the game.",
        fixtures: fixtures.map(({ editor, path, kind, source }) => ({
          editor,
          path,
          kind,
          source,
        })),
      },
      null,
      1,
    ) + "\n"
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const out = value("--out");
  const layout = value("--layout");
  if (!out || (layout !== "projects" && layout !== "sandbox")) {
    console.error(
      "usage: editor-fixtures.ts --out <dir> --layout projects|sandbox [--overwrite] [--really]",
    );
    process.exit(2);
  }
  const really = args.includes("--really");
  const overwrite = args.includes("--overwrite");
  const vfs = PakVirtualFS.get(loadConfig().gamePath);
  if (!vfs) throw new Error("no game paks (ENFUSION_GAME_PATH)");
  const fixtures = planFixtures((p) => vfs.readTextFile(p));
  const missing = fixtures.filter((f) => f.text === undefined && !vfs.exists(f.source));
  if (missing.length)
    throw new Error(`not in the game paks: ${missing.map((f) => f.source).join(", ")}`);
  const data = (f: Fixture): string | Buffer => f.text ?? vfs.readFile(f.source);
  const build = value("--build") ?? "unknown";

  const projects: { root: string; name: string; fixtures: Fixture[]; gproj: boolean }[] =
    layout === "sandbox"
      ? [{ root: resolve(out), name: "sandbox", fixtures, gproj: false }]
      : EDITORS.map((editor) => ({
          root: resolve(out, `EMCP2_fx_${editor}`),
          name: `EMCP2_fx_${editor}`,
          fixtures: fixtures.filter((f) => f.editor === editor),
          gproj: true,
        }));

  for (const p of projects) {
    const files: { path: string; data: string | Buffer }[] = p.fixtures.map((f) => ({
      path: f.path,
      data: data(f),
    }));
    files.push({ path: "emcp-fixtures.json", data: manifest(p.name, p.fixtures, build) });
    if (p.gproj) {
      files.push({
        path: "addon.gproj",
        data: generateGproj({
          name: p.name,
          title: `EMCP fixtures: ${p.name.slice(9)}`,
          guid: projectGuid(p.name),
        }),
      });
    }
    if (!really) {
      console.log(`${p.root}\n${files.map((f) => `  ${f.path}`).join("\n")}`);
      continue;
    }
    const r = writeProject(p.root, files, overwrite);
    console.log(`${p.root}: ${r.written.length} written, ${r.kept.length} kept (already there)`);
  }
  if (!really) console.log("dry run: nothing written (--really writes)");
}

if (isMainModule(import.meta.url)) main();
