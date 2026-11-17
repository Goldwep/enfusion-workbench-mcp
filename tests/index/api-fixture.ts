/**
 * A small API index on disk for SearchEngine tests: Doxygen entries, pak
 * entries the source backfill would add (one guarded), overloads, and a pak
 * class that names a Doxygen parent which does not list it as a child.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassInfo, MethodInfo } from "../../src/index/types.js";

export function method(signature: string, extra: Partial<MethodInfo> = {}): MethodInfo {
  const at = signature.indexOf("(");
  const name = /(~?[A-Za-z_]\w*)\s*$/.exec(signature.slice(0, at))?.[1] ?? "";
  const returnType = signature.slice(0, at).trim().slice(0, -name.length).trim();
  return { name, returnType, signature, params: [], description: "", ...extra };
}

export function cls(name: string, extra: Partial<ClassInfo> = {}): ClassInfo {
  return {
    name,
    source: "arma",
    brief: "",
    description: "",
    parents: [],
    children: [],
    group: "",
    sourceFile: "",
    methods: [],
    protectedMethods: [],
    staticMethods: [],
    enums: [],
    properties: [],
    protectedProperties: [],
    docsUrl: "",
    ...extra,
  };
}

export const ENFUSION: ClassInfo[] = [
  cls("Managed", { source: "enfusion", children: ["Base"] }),
  cls("WorldEditorAPI", {
    source: "enfusion",
    group: "Workbench",
    methods: [
      method(
        "proto external bool SetVariableValue (BaseContainer obj, array< ref ContainerIdPathEntry > path, string key, string value)",
        {
          params: [
            { name: "obj", type: "BaseContainer", defaultValue: "" },
            { name: "path", type: "array< ref ContainerIdPathEntry >", defaultValue: "" },
            { name: "key", type: "string", defaultValue: "" },
            { name: "value", type: "string", defaultValue: "" },
          ],
          description: "Sets a variable.",
        },
      ),
      method("proto external bool SetVariableValue (BaseContainer obj, string key, string value)", {
        params: [
          { name: "obj", type: "BaseContainer", defaultValue: "" },
          { name: "key", type: "string", defaultValue: "" },
          { name: "value", type: "string", defaultValue: "" },
        ],
      }),
      method("proto external bool SetVariableValueEx (string key)"),
      method(
        "proto external bool TraceWorldPos(int x, int y, TraceFlags traceFlags, out vector traceStart, out vector traceEnd, out vector traceDir, out IEntity hitEntity)",
        {
          origin: "pak",
          pakFile: "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c",
          pakLine: 200,
        },
      ),
      method("proto external int GetDebugCounter()", {
        origin: "pak",
        pakFile: "scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c",
        pakLine: 300,
        guards: ["ENABLE_DIAG", "!WORKBENCH"],
      }),
    ],
  }),
];

export const ARMA: ClassInfo[] = [
  cls("Base", { parents: ["Managed"], children: ["Child2"] }),
  cls("Child2", { parents: ["BASE"] }),
  cls("PakChild", {
    parents: ["Base"],
    origin: "pak",
    pakFile: "scripts/Game/Test/PakChild.c",
    pakLine: 3,
    guards: ["MODULE_AUTOTEST"],
    methods: [
      method("void Run()", { origin: "pak", pakFile: "scripts/Game/Test/PakChild.c", pakLine: 5 }),
    ],
  }),
  cls("Grand", { parents: ["PakChild"] }),
  cls("SCR_ScenarioFrameworkSystem", {
    methods: [
      method("void SetVariableValue (string name, string value)"),
      method("void RpcDo_SetVariableValue (string name, string value)"),
    ],
  }),
  cls("OverloadBase", {
    methods: [
      method("void Foo (int a)", { params: [{ name: "a", type: "int", defaultValue: "" }] }),
      method("void Foo (float a)", { params: [{ name: "a", type: "float", defaultValue: "" }] }),
    ],
  }),
  cls("OverloadMid", {
    parents: ["OverloadBase"],
    methods: [
      method("override void Foo (int a)", {
        params: [{ name: "a", type: "int", defaultValue: "" }],
      }),
    ],
  }),
  cls("OverloadLeaf", { parents: ["OverloadMid"] }),
  cls("TestThingComponent", {
    methods: [
      method("void EOnInit (IEntity owner)", {
        params: [{ name: "owner", type: "IEntity", defaultValue: "" }],
      }),
      method("void EOnInit ()"),
    ],
  }),
];

/**
 * Writes the fixture to a fresh data dir; returns it and a cleanup. `extra`
 * classes are appended to the fixture's own, so a test file can add the
 * classes it needs without changing what the other files see.
 */
export function writeFixtureDataDir(extra: { enfusion?: ClassInfo[]; arma?: ClassInfo[] } = {}): {
  dataDir: string;
  cleanup: () => void;
} {
  const dataDir = mkdtempSync(join(tmpdir(), "api-fixture-"));
  mkdirSync(join(dataDir, "api"));
  mkdirSync(join(dataDir, "wiki"));
  writeFileSync(
    join(dataDir, "api", "enfusion-classes.json"),
    JSON.stringify([...ENFUSION, ...(extra.enfusion ?? [])], null, 2),
  );
  writeFileSync(
    join(dataDir, "api", "arma-classes.json"),
    JSON.stringify([...ARMA, ...(extra.arma ?? [])], null, 2),
  );
  writeFileSync(
    join(dataDir, "api", "groups.json"),
    JSON.stringify([{ name: "Workbench", description: "", classes: ["WorldEditorAPI"] }]),
  );
  writeFileSync(join(dataDir, "wiki", "pages.json"), "[]");
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
