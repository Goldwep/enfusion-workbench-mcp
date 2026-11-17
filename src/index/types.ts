/** A single parameter on a method */
export interface ParamInfo {
  name: string;
  type: string;
  defaultValue: string;
}

/**
 * Provenance of an entry the source backfill added (`src/scraper/backfill.ts`):
 * real API the game's script source declares that is missing from the scraped
 * index. All absent on a Doxygen entry.
 */
export interface SourceProvenance {
  origin?: "pak";
  /** Virtual pak path of the declaration. */
  pakFile?: string;
  /** 1-based line of the declared name. */
  pakLine?: number;
  /** Enclosing preprocessor guards, outermost first (`ENABLE_DIAG`, `!WORKBENCH`, `if <expr>`). */
  guards?: string[];
}

/** A single method/function on a class */
export interface MethodInfo extends SourceProvenance {
  /** The identifier the signature declares (`SetVariableValue`, `~Foo` for a destructor). */
  name: string;
  returnType: string;
  signature: string;
  params: ParamInfo[];
  description: string;
}

/** A single enum member value */
export interface EnumValue {
  name: string;
  /** Numeric or expression value, may be empty if not specified */
  value: string;
  description: string;
}

/** An enum type defined within a class or standalone */
export interface EnumInfo {
  name: string;
  description: string;
  values: EnumValue[];
}

/** A member variable / property on a class */
export interface PropertyInfo {
  name: string;
  type: string;
  description: string;
}

/** A single Enfusion script API class/interface */
export interface ClassInfo extends SourceProvenance {
  /** Class name exactly as in the API (e.g., "IEntity", "SCR_BaseGameMode") */
  name: string;
  /** Source: "enfusion" (engine) or "arma" (game-level) */
  source: "enfusion" | "arma";
  /** Brief one-line description */
  brief: string;
  /** Full description (from detailed docs section) */
  description: string;
  /** Parent class names (direct inheritance only) */
  parents: string[];
  /** Known child class names (direct descendants only) */
  children: string[];
  /** Group/module (e.g., "Entities", "Components") */
  group: string;
  /** Source file path if available */
  sourceFile: string;
  /** Public member functions */
  methods: MethodInfo[];
  /** Protected member functions */
  protectedMethods: MethodInfo[];
  /** Static member functions */
  staticMethods: MethodInfo[];
  /** Enum types defined in this class */
  enums: EnumInfo[];
  /** Public member variables */
  properties: PropertyInfo[];
  /** Protected member variables */
  protectedProperties: PropertyInfo[];
  /** URL to original documentation page */
  docsUrl: string;
}

/** A group/module (e.g., "Entities", "Components", "Replication") */
export interface GroupInfo {
  name: string;
  description: string;
  classes: string[];
}

/** Inheritance hierarchy node */
export interface HierarchyNode {
  name: string;
  children: string[];
}

/** A tutorial/guide page from Doxygen or BI Community Wiki */
export interface WikiPage {
  title: string;
  source: "enfusion" | "arma" | "bistudio-wiki";
  content: string;
  filename?: string;
  url?: string;
}
