import { describe, it, expect } from "vitest";
import {
  generatePrefab,
  getPrefabSubdirectory,
  getPrefabFilename,
} from "../../src/templates/prefab.js";
import { parse } from "../../src/formats/enfusion-text.js";

describe("generatePrefab", () => {
  it("generates valid Enfusion text for generic prefab", () => {
    const text = generatePrefab({ name: "Test", prefabType: "generic" });
    const node = parse(text);
    expect(node.type).toBe("GenericEntity");
  });

  it("generates spawnpoint prefab with recipe override components", () => {
    const text = generatePrefab({ name: "MySpawn", prefabType: "spawnpoint" });
    const node = parse(text);
    expect(node.type).toBe("GenericEntity");
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    const spawnComp = comps!.children.find((c) => c.type === "SCR_SpawnPoint");
    expect(spawnComp).toBeDefined();
  });

  it("generates character prefab", () => {
    const text = generatePrefab({ name: "MyChar", prefabType: "character" });
    const node = parse(text);
    expect(node.type).toBe("SCR_ChimeraCharacter");
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    // Recipe components should be present (MeshObject, CharacterAnimationComponent)
    expect(comps!.children.length).toBeGreaterThan(0);
  });

  it("generates prop prefab with mesh", () => {
    const text = generatePrefab({ name: "Door", prefabType: "prop" });
    const node = parse(text);
    expect(node.type).toBe("GenericEntity");
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    expect(comps!.children.find((c) => c.type === "MeshObject")).toBeDefined();
  });

  it("includes parent prefab as inheritance", () => {
    const text = generatePrefab({
      name: "MyFirearm",
      prefabType: "firearm",
      parentPrefab: "{AABB}Prefabs/Weapons/AK47.et",
    });
    const node = parse(text);
    expect(node.inheritance).toBe("{AABB}Prefabs/Weapons/AK47.et");
  });

  it("generates firearm prefab with variant", () => {
    const text = generatePrefab({
      name: "MyPistol",
      prefabType: "firearm",
      variant: "handgun",
    });
    const node = parse(text);
    expect(node.type).toBe("GenericEntity");
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    // Should have recipe override components
    expect(comps!.children.find((c) => c.type === "MeshObject")).toBeDefined();
  });

  it("generates ground_vehicle prefab", () => {
    const text = generatePrefab({ name: "MyCar", prefabType: "ground_vehicle" });
    const node = parse(text);
    expect(node.type).toBe("Vehicle");
  });

  it("adds custom components", () => {
    const text = generatePrefab({
      name: "Custom",
      prefabType: "generic",
      components: [{ type: "RigidBody", properties: { m_fMass: "10" } }],
    });
    const node = parse(text);
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    const rb = comps!.children.find((c) => c.type === "RigidBody");
    expect(rb).toBeDefined();
    const massProp = rb!.properties.find((p) => p.key === "m_fMass");
    expect(massProp).toBeDefined();
    expect(massProp!.value).toBe("10");
  });

  it("adds editable component with description", () => {
    const text = generatePrefab({
      name: "Test",
      prefabType: "generic",
      description: "A test entity",
    });
    const node = parse(text);
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    const editable = comps!.children.find((c) => c.type === "SCR_EditableEntityComponent");
    expect(editable).toBeDefined();
    const nameProp = editable!.properties.find((p) => p.key === "m_sDisplayName");
    expect(nameProp).toBeDefined();
    expect(nameProp!.value).toBe("A test entity");
  });

  it("generates gamemode prefab", () => {
    const text = generatePrefab({ name: "MyMode", prefabType: "gamemode" });
    const node = parse(text);
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    // Recipe override components should be present
    expect(comps!.children.length).toBeGreaterThan(0);
  });

  it("all component nodes have GUIDs", () => {
    const text = generatePrefab({ name: "Test", prefabType: "prop" });
    const node = parse(text);
    const comps = node.children.find((c) => c.type === "components");
    for (const child of comps!.children) {
      expect(child.id).toBeDefined();
      expect(child.id).toMatch(/^\{[0-9A-F]{16}\}$/);
    }
  });

  it("uses ancestorComponents instead of recipe defaults when provided", () => {
    const text = generatePrefab({
      name: "Test",
      prefabType: "character",
      ancestorComponents: [{ type: "CustomComponent", guid: "AAAAAAAAAAAAAAAA", properties: {} }],
    });
    const node = parse(text);
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    // ancestorComponents should be present with preserved GUID
    const custom = comps!.children.find((c) => c.type === "CustomComponent");
    expect(custom).toBeDefined();
    // GUID should be preserved from ancestorComponents
    expect(custom!.id).toBe("{AAAAAAAAAAAAAAAA}");
  });

  it("appends user components after ancestorComponents and recipe overrides", () => {
    const text = generatePrefab({
      name: "Test",
      prefabType: "generic",
      ancestorComponents: [{ type: "MeshObject", guid: "AAAAAAAAAAAAAAAA" }],
      components: [{ type: "RigidBody" }],
    });
    const node = parse(text);
    const comps = node.children.find((c) => c.type === "components");
    expect(comps).toBeDefined();
    expect(comps!.children.find((c) => c.type === "MeshObject")).toBeDefined();
    expect(comps!.children.find((c) => c.type === "RigidBody")).toBeDefined();
  });

  it("generates all new recipe types", () => {
    const types: Array<[string, string]> = [
      ["firearm", "GenericEntity"],
      ["attachment", "GenericEntity"],
      ["ground_vehicle", "Vehicle"],
      ["air_vehicle", "Vehicle"],
      ["character", "SCR_ChimeraCharacter"],
      ["prop", "GenericEntity"],
      ["building", "SCR_DestructibleBuildingEntity"],
      ["item", "GenericEntity"],
      ["group", "SCR_AIGroup"],
      ["spawnpoint", "GenericEntity"],
      ["gamemode", "GenericEntity"],
      ["generic", "GenericEntity"],
    ];

    for (const [type, expectedEntity] of types) {
      const text = generatePrefab({
        name: `Test${type}`,
        prefabType: type as any,
      });
      const node = parse(text);
      expect(node.type).toBe(expectedEntity);
    }
  });
});

describe("getPrefabSubdirectory", () => {
  it("returns correct base subdirectories", () => {
    expect(getPrefabSubdirectory("character")).toBe("Prefabs/Characters");
    expect(getPrefabSubdirectory("ground_vehicle")).toBe("Prefabs/Vehicles");
    expect(getPrefabSubdirectory("firearm")).toBe("Prefabs/Weapons");
    expect(getPrefabSubdirectory("spawnpoint")).toBe("Prefabs/Systems");
    expect(getPrefabSubdirectory("prop")).toBe("Prefabs/Props");
    expect(getPrefabSubdirectory("generic")).toBe("Prefabs");
  });

  it("returns variant-specific subdirectories", () => {
    expect(getPrefabSubdirectory("firearm", "handgun")).toBe("Prefabs/Weapons/Handguns");
    expect(getPrefabSubdirectory("firearm", "rifle")).toBe("Prefabs/Weapons/Rifles");
    expect(getPrefabSubdirectory("ground_vehicle", "car")).toBe("Prefabs/Vehicles/Cars");
    expect(getPrefabSubdirectory("ground_vehicle", "tracked")).toBe("Prefabs/Vehicles/Tracked");
  });
});

describe("getPrefabFilename", () => {
  it("appends .et extension", () => {
    expect(getPrefabFilename("MyPrefab")).toBe("MyPrefab.et");
  });
});
