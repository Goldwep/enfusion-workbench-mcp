import { describe, it, expect } from "vitest";
import {
  generateScript,
  getScriptModuleFolder,
  getScriptFilename,
} from "../../src/templates/script.js";
import { buildSourceIndex } from "../../src/census/source-index.js";
import type { FieldRecord, MethodRecord } from "../../src/census/enforce-source.js";
import { pluginClasses } from "../../src/census/plugin-registry.js";

describe("generateScript", () => {
  it("generates modded class", () => {
    const code = generateScript({
      className: "SCR_BaseGameMode",
      scriptType: "modded",
      parentClass: "SCR_BaseGameMode",
      methods: ["void OnGameStart()"],
    });
    expect(code).toContain("modded class SCR_BaseGameMode");
    expect(code).toContain("override void OnGameStart()");
    expect(code).toContain("super.OnGameStart();");
  });

  it("does not double-prefix override in modded methods", () => {
    const code = generateScript({
      className: "SCR_CharacterDamageManagerComponent",
      scriptType: "modded",
      parentClass: "SCR_CharacterDamageManagerComponent",
      methods: ["override bool OnDamage(BaseDamageContext damageContext)"],
    });
    expect(code).toContain("override bool OnDamage(BaseDamageContext damageContext)");
    expect(code).not.toContain("override override");
    expect(code).toContain("super.OnDamage(damageContext);");
  });

  it("forwards parameters in super calls for modded scripts", () => {
    const code = generateScript({
      className: "SCR_CharacterControllerComponent",
      scriptType: "modded",
      parentClass: "SCR_CharacterControllerComponent",
      methods: ["void OnControlledByPlayer(IEntity owner, bool controlled)"],
    });
    expect(code).toContain("super.OnControlledByPlayer(owner, controlled);");
  });

  it("does not double-prefix override in component custom methods", () => {
    const code = generateScript({
      className: "TAG_MyComp",
      scriptType: "component",
      methods: ["override void EOnInit(IEntity owner)"],
    });
    expect(code).toContain("override void EOnInit(IEntity owner)");
    expect(code).not.toContain("override override");
  });

  it("does not double-prefix override in gamemode custom methods", () => {
    const code = generateScript({
      className: "TAG_GM",
      scriptType: "gamemode",
      methods: ["override void OnGameStart()"],
    });
    expect(code).toContain("override void OnGameStart()");
    expect(code).not.toContain("override override");
    expect(code).toContain("super.OnGameStart();");
  });

  it("forwards params in gamemode super calls", () => {
    const code = generateScript({
      className: "TAG_GM",
      scriptType: "gamemode",
      methods: ["void OnPlayerSpawned(int playerId, IEntity controlledEntity)"],
    });
    expect(code).toContain("super.OnPlayerSpawned(playerId, controlledEntity);");
  });

  it("modded requires parentClass", () => {
    expect(() => generateScript({ className: "Test", scriptType: "modded" })).toThrow(
      "parentClass",
    );
  });

  it("generates component with default methods", () => {
    const code = generateScript({
      className: "TAG_MyComponent",
      scriptType: "component",
    });
    expect(code).toContain("class TAG_MyComponent : ScriptComponent");
    expect(code).toContain("class TAG_MyComponentClass : ScriptComponentClass");
    expect(code).toContain("[ComponentEditorProps(");
    expect(code).toContain("override void EOnInit(IEntity owner)");
    expect(code).toContain("override void OnPostInit(IEntity owner)");
    expect(code).toContain("override void OnDelete(IEntity owner)");
  });

  it("generates component with custom parent", () => {
    const code = generateScript({
      className: "TAG_MyComp",
      scriptType: "component",
      parentClass: "SCR_BaseEditableEntityComponent",
    });
    expect(code).toContain("class TAG_MyComp : SCR_BaseEditableEntityComponent");
    expect(code).toContain("class TAG_MyCompClass : SCR_BaseEditableEntityComponentClass");
  });

  it("generates gamemode with default methods", () => {
    const code = generateScript({
      className: "TAG_GameMode",
      scriptType: "gamemode",
    });
    expect(code).toContain("class TAG_GameMode : SCR_BaseGameMode");
    expect(code).toContain("override void OnGameStart()");
    expect(code).toContain("override void OnPlayerConnected(int playerId)");
    expect(code).toContain("override void OnPlayerSpawned(int playerId, IEntity controlledEntity)");
  });

  it("generates action with default methods", () => {
    const code = generateScript({
      className: "TAG_PickupAction",
      scriptType: "action",
    });
    expect(code).toContain("class TAG_PickupAction : ScriptedUserAction");
    expect(code).toContain("override void PerformAction(");
    expect(code).toContain("override bool CanBePerformedScript(");
    expect(code).toContain("override bool CanBeShownScript(");
  });

  it("generates entity with default methods", () => {
    const code = generateScript({
      className: "TAG_MyEntity",
      scriptType: "entity",
    });
    expect(code).toContain("class TAG_MyEntity : GenericEntity");
    expect(code).toContain("override void EOnInit(IEntity owner)");
    expect(code).toContain("SetEventMask(EntityEvent.FRAME)");
  });

  it("generates manager singleton", () => {
    const code = generateScript({
      className: "TAG_Manager",
      scriptType: "manager",
    });
    expect(code).toContain("class TAG_Manager");
    expect(code).toContain("private static ref TAG_Manager s_Instance");
    expect(code).toContain("static TAG_Manager GetInstance()");
  });

  it("generates basic class", () => {
    const code = generateScript({
      className: "TAG_Helper",
      scriptType: "basic",
    });
    expect(code).toContain("class TAG_Helper");
    expect(code).not.toContain(" : "); // no parent
  });

  it("generates basic class with parent", () => {
    const code = generateScript({
      className: "TAG_Child",
      scriptType: "basic",
      parentClass: "TAG_Parent",
    });
    expect(code).toContain("class TAG_Child : TAG_Parent");
  });

  it("includes description comment", () => {
    const code = generateScript({
      className: "Test",
      scriptType: "basic",
      description: "A test class",
    });
    expect(code).toContain("// A test class");
  });

  it("ends with newline", () => {
    const code = generateScript({
      className: "Test",
      scriptType: "basic",
    });
    expect(code.endsWith("\n")).toBe(true);
  });
});

describe("dynamic parent method resolution", () => {
  it("should accept dynamicMethods option and use them for stubs", () => {
    const code = generateScript({
      className: "TAG_TestComponent",
      scriptType: "component",
      parentClass: "SCR_InventoryStorageManagerComponent",
      dynamicMethods: [
        "override void OnItemAdded(BaseInventoryStorageComponent storageOwner, IEntity item)",
        "override void OnItemRemoved(BaseInventoryStorageComponent storageOwner, IEntity item)",
      ],
    });
    expect(code).toContain("OnItemAdded");
    expect(code).toContain("OnItemRemoved");
    // Should NOT contain default component methods when dynamic methods are provided
    expect(code).not.toContain("EOnInit");
  });

  it("should fall back to hardcoded methods when dynamicMethods is not provided", () => {
    const code = generateScript({
      className: "TAG_TestComponent",
      scriptType: "component",
    });
    expect(code).toContain("EOnInit");
    expect(code).toContain("OnPostInit");
  });
});

describe("extractParamNames with default values", () => {
  it("should generate correct super call when params have defaults", () => {
    const code = generateScript({
      className: "TAG_TestModded",
      scriptType: "modded",
      parentClass: "SCR_BaseGameMode",
      methods: ["override void OnInit(IEntity owner = null)"],
    });
    expect(code).toContain("super.OnInit(owner)");
    // super call should use param name, not default value
    expect(code).not.toContain("super.OnInit(null)");
  });

  it("should handle multiple params with defaults", () => {
    const code = generateScript({
      className: "TAG_TestModded2",
      scriptType: "modded",
      parentClass: "SCR_BaseGameMode",
      methods: ["override void OnDamage(float damage = 0, int type = -1, IEntity source = null)"],
    });
    expect(code).toContain("super.OnDamage(damage, type, source)");
  });
});

describe("getScriptModuleFolder", () => {
  it("returns Scripts/Game for all standard types", () => {
    expect(getScriptModuleFolder("component")).toBe("Scripts/Game");
    expect(getScriptModuleFolder("gamemode")).toBe("Scripts/Game");
    expect(getScriptModuleFolder("modded")).toBe("Scripts/Game");
    expect(getScriptModuleFolder("action")).toBe("Scripts/Game");
  });
});

describe("getScriptFilename", () => {
  it("appends .c extension", () => {
    expect(getScriptFilename("TAG_MyComponent")).toBe("TAG_MyComponent.c");
  });
});

describe("scriptType plugin", () => {
  const index = (code: string) =>
    buildSourceIndex([{ path: "scripts/WorkbenchGame/Test.c", text: code }], { build: "1.0.0.1" });
  const plugin = (code: string) => {
    const found = pluginClasses(index(code));
    expect(found).toHaveLength(1);
    return found[0];
  };

  it("defaults to WorkbenchPlugin with Run, a setting field and a button, inside #ifdef WORKBENCH", () => {
    const code = generateScript({ className: "TAG_MyPlugin", scriptType: "plugin" });
    expect(code.startsWith("#ifdef WORKBENCH\n")).toBe(true);
    expect(code.trimEnd().endsWith("#endif")).toBe(true);
    expect(code).toContain("class TAG_MyPlugin : WorkbenchPlugin");
    expect(code).toContain("override void Run()");
    expect(code).toContain("Workbench.ScriptDialog(");
    expect(code).toContain("[Attribute(");
    expect(code).toContain('[ButtonAttribute("Run")]');
    expect(code).not.toContain("wbModules");
  });

  it("the E03 attribute parser reads the generated attributes back", () => {
    const code = generateScript({
      className: "TAG_MyPlugin",
      scriptType: "plugin",
      parentClass: "WorkbenchPlugin",
      module: "ScriptEditor",
      description: 'Does a "thing"',
      shortcut: "Ctrl+Shift+X",
      awesomeFontCode: "0xf0c5",
    });
    const p = plugin(code);
    expect(p.kind).toBe("plugin");
    expect(p.name).toBe("TAG_MyPlugin");
    expect(p.label).toBe("TAG_MyPlugin");
    expect(p.description).toBe('Does a "thing"');
    expect(p.shortcut).toBe("Ctrl+Shift+X");
    expect(p.wbModules).toEqual(["ScriptEditor"]);
    expect(p.module).toBe("ScriptEditor");
    expect(p.unreadable).toEqual([]);
    expect(p.args.awesomeFontCode).toBe("0xF0C5");
    const ix = index(code);
    const sample = ix.records.find(
      (r): r is FieldRecord => r.kind === "field" && r.name === "m_bSample",
    );
    expect(sample?.attributes.map((a) => a.name)).toEqual(["Attribute"]);
    const button = ix.records.find(
      (r): r is MethodRecord => r.kind === "method" && r.name === "RunButton",
    );
    expect(button?.attributes.map((a) => a.name)).toEqual(["ButtonAttribute"]);
    expect(ix.records.some((r) => r.kind === "method" && r.name === "Run")).toBe(true);
  });

  it.each([
    ["WorldEditorPlugin", "WorldEditor"],
    ["ResourceManagerPlugin", "ResourceManager"],
    ["LocalizationEditorPlugin", "LocalizationEditor"],
  ])("%s implies the %s module", (parentClass, mod) => {
    const code = generateScript({ className: "TAG_P", scriptType: "plugin", parentClass });
    expect(code).toContain(`class TAG_P : ${parentClass}`);
    const p = plugin(code);
    expect(p.kind).toBe("plugin");
    expect(p.wbModules).toEqual([mod]);
  });

  it("WorldEditorTool uses WorkbenchToolAttribute and OnActivate", () => {
    const code = generateScript({
      className: "TAG_MyTool",
      scriptType: "plugin",
      parentClass: "WorldEditorTool",
    });
    expect(code).toContain("override void OnActivate()");
    expect(code).not.toContain("override void Run()");
    const p = plugin(code);
    expect(p.kind).toBe("tool");
    expect(p.wbModules).toEqual(["WorldEditor"]);
  });

  it("accepts a numeric awesomeFontCode", () => {
    const code = generateScript({
      className: "TAG_P",
      scriptType: "plugin",
      awesomeFontCode: 0xf188,
    });
    expect(code).toContain("awesomeFontCode: 0xF188");
  });

  it.each([
    [{ parentClass: "ScriptComponent" }, "Invalid parentClass"],
    [{ module: "Nope" }, "Invalid module"],
    [{ parentClass: "WorldEditorPlugin", module: "ScriptEditor" }, "does not fit"],
    [{ shortcut: 'a"b' }, "Invalid shortcut"],
    [{ awesomeFontCode: "zz" }, "Invalid awesomeFontCode"],
    [{ awesomeFontCode: 0 }, "Invalid awesomeFontCode"],
  ])("refuses %j", (extra, msg) => {
    expect(() => generateScript({ className: "TAG_P", scriptType: "plugin", ...extra })).toThrow(
      msg,
    );
  });

  it("returns Scripts/WorkbenchGame for plugin only", () => {
    expect(getScriptModuleFolder("plugin")).toBe("Scripts/WorkbenchGame");
    expect(getScriptModuleFolder("basic")).toBe("Scripts/Game");
  });
});
