/**
 * Prefab Recipe System - TypeScript Schema
 *
 * Recipes are thin guidance layers that point to correct base game parent prefabs.
 * The ancestry resolver handles pulling in all inherited components automatically.
 * Recipes only define:
 * - defaultParent: The base game parent prefab path
 * - overrideComponents: Components a modder typically customizes (with placeholder values)
 * - postCreateNotes: What the user still needs to fill in
 */

export interface RecipeOverrideComponent {
  /** Component class name (e.g., "MeshObject", "WeaponSoundComponent") */
  type: string;
  /** Placeholder property values for this component */
  properties?: Record<string, string>;
  /** Guidance comment: what this property should be filled in with */
  comment?: string;
}

export interface RecipeVariant {
  /** Variant name (e.g., "handgun", "rifle") */
  name: string;
  /** Human-readable description of the variant */
  description: string;
  /** Optional override of the base recipe's default parent */
  defaultParent?: string;
  /** Optional override of the base recipe's subdirectory */
  subdirectory?: string;
  /** Optional override of override components */
  overrideComponents?: RecipeOverrideComponent[];
  /** Optional variant-specific post-creation notes */
  postCreateNotes?: string[];
}

export interface PrefabRecipe {
  /** Unique recipe ID matching prefabType enum value */
  id: string;
  /** Display name of the recipe */
  name: string;
  /** Human-readable description */
  description: string;
  /** Root entity class (e.g., "GenericEntity", "SCR_ChimeraCharacter", "Vehicle") */
  entityType: string;
  /** Output subdirectory (e.g., "Prefabs/Weapons/Handguns") */
  subdirectory: string;
  /** Base game parent prefab path (empty string = standalone) */
  defaultParent: string;
  /** Components a modder typically customizes */
  overrideComponents: RecipeOverrideComponent[];
  /** Optional variants that specialize this recipe */
  variants?: RecipeVariant[];
  /** Post-creation checklist for users */
  postCreateNotes: string[];
}
