import { createNode, serialize, type EnfusionNode } from "../formats/enfusion-text.js";
import { generateGuid } from "../formats/guid.js";
import { recipeLoader } from "./recipe-loader.js";

export type PrefabType =
  | "firearm"
  | "attachment"
  | "ground_vehicle"
  | "air_vehicle"
  | "character"
  | "prop"
  | "building"
  | "item"
  | "group"
  | "spawnpoint"
  | "gamemode"
  | "generic";

export interface ComponentDef {
  type: string;
  /** Raw 16-character uppercase hex GUID (without braces). Generated if omitted. */
  guid?: string;
  properties?: Record<string, string>;
}

export interface PrefabOptions {
  /** Prefab name (used for filename and ID) */
  name: string;
  /** Prefab template type */
  prefabType: PrefabType;
  /** Optional recipe variant (e.g., "handgun" for firearm type) */
  variant?: string;
  /** Parent prefab path to inherit from (uses recipe default if omitted) */
  parentPrefab?: string;
  /** Additional components to add */
  components?: ComponentDef[];
  /** Description, written as the editor display name (m_UIInfo Name) */
  description?: string;
  /**
   * Pre-resolved ancestor components (from prefab-ancestry walkChain).
   * When provided, ancestry components take precedence over recipe overrides.
   * GUIDs are preserved so they act as override slots in the Enfusion delta model.
   */
  ancestorComponents?: ComponentDef[];
}

/**
 * Generate an Enfusion .et prefab file.
 * Loads recipe from JSON, merges with ancestry and user components.
 */
export function generatePrefab(opts: PrefabOptions): string {
  const recipe = recipeLoader.getRecipe(opts.prefabType, opts.variant);
  const parentPrefab = opts.parentPrefab || recipe.defaultParent;
  const entityGuid = generateGuid();

  const root = createNode(recipe.entityType, {
    inheritance: parentPrefab || undefined,
    properties: [{ key: "ID", value: entityGuid }],
  });

  // Build components block
  // Ancestry components (if provided) take precedence, then recipe overrides, then user components
  const baseComponents: ComponentDef[] = opts.ancestorComponents ?? [];

  // Convert recipe override components to ComponentDef format
  const recipeComponents: ComponentDef[] = recipe.overrideComponents.map((override) => ({
    type: override.type,
    properties: override.properties ?? {},
  }));

  // Merge: ancestry (with preserved GUIDs) + recipe overrides + user components
  const allComponents: ComponentDef[] = [
    ...baseComponents,
    // Only add recipe components not already in ancestry
    ...recipeComponents.filter((rc) => !baseComponents.some((ac) => ac.type === rc.type)),
    ...(opts.components ?? []),
  ];

  if (allComponents.length > 0 || opts.description) {
    const componentNodes: EnfusionNode[] = [];

    for (const comp of allComponents) {
      // Preserve GUID if provided (ancestor components carry their original GUID)
      const compGuid = comp.guid ?? generateGuid();
      const compNode = createNode(comp.type, {
        id: `{${compGuid}}`,
      });

      if (comp.properties) {
        for (const [key, value] of Object.entries(comp.properties)) {
          compNode.properties.push({ key, value });
        }
      }

      componentNodes.push(compNode);
    }

    // Description becomes the editor display name. SCR_EditableEntityComponent
    // has no m_sDisplayName member; vanilla prefabs carry the name on
    // m_UIInfo SCR_EditableEntityUIInfo { Name } (2312 vanilla .et files).
    if (opts.description) {
      const uiInfo = createNode("m_UIInfo", {
        id: `{${generateGuid()}}`,
        properties: [{ key: "Name", value: opts.description }],
      });
      uiInfo.className = "SCR_EditableEntityUIInfo";
      let editableComp = componentNodes.find((c) => c.type === "SCR_EditableEntityComponent");
      if (!editableComp) {
        editableComp = createNode("SCR_EditableEntityComponent", { id: `{${generateGuid()}}` });
        componentNodes.push(editableComp);
      }
      editableComp.properties.push({ key: "m_UIInfo", value: uiInfo });
    }

    root.children.push(createNode("components", { children: componentNodes }));
  }

  return serialize(root);
}

/**
 * Get the subdirectory for a prefab type.
 */
export function getPrefabSubdirectory(prefabType: PrefabType, variant?: string): string {
  const recipe = recipeLoader.getRecipe(prefabType, variant);
  return recipe.subdirectory;
}

/**
 * Derive a filename from the prefab name.
 */
export function getPrefabFilename(name: string): string {
  return `${name}.et`;
}
