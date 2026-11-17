/**
 * Bohemia's own NET handlers (plan 8 work package 3.6, DEC-047 row L6).
 *
 * The catalog is E04's census (data/census/observations/E04/1.9.0.37.jsonl): every compiled
 * Bohemia handler with its declared request fields (RegV / RegAll of the request class) and
 * their types. `ExampleCall` is left out: it is declared only under `#ifdef DOXYGEN`
 * (NetApiDocs.c#L228), so it is not compiled. Natives are wrapped in native.ts, not here.
 *
 * Class and live flag (DEC-040 sc-02, DEC-047 L6):
 *   - "read": the 15 handlers whose source shows no write, dialog or window
 *     (scripts/live/s-c-natives.ts BI_INCLUDED). 14 answered live (DEC-047 corrigendum 1:
 *     "14 of 15") and are the only ones `callVerifiedRead` sends. 12 of those 14 ran after
 *     the owner clicked the authorization prompt in the same process (DEC-040; DEC-047 U27),
 *     so they are not proven prompt-free on a fresh launch: the ones that touch files carry
 *     a modal-hazard warning (MODAL_HAZARD). `LocatePrefabsFromPath` raised the "Script
 *     Authorization Required" prompt (FileIO.FindFiles, U27) and stays GATED until the
 *     Bohemia battery.
 *   - "mutating": everything else (writes, modal dialogs, a window, or a read path not yet
 *     safe to call cold; the reason is in `risk`). Every one is GATED.
 *
 * Build 1.9.0.37 (E04 re-run 2026-11-06): 9 handlers are new (ExportSurfaceMasks,
 * GetAnimationExporProfileChannelsInfo, GetAnimationExportProfileInfosInProject,
 * GetMaterialsByClass, GetResourceValidity, GetSelectedEntities, GetSurfaceMaterials,
 * GetTerrainInfo, GetTileHeightmap); none has been called live, so each is GATED with the
 * reason its 1.9 source shows. ExportTXAResource's 9 request fields were replaced by 8 others,
 * ExportFBXResource gained `validationMode`, and BakeInfo and OverrideMeshObjectMaterial moved
 * from BakeMLOD.c to PrefabMlodBaker.c. The live verification of the 14 reads (DEC-040,
 * DEC-047) was taken on 1.8.0.13; their declarations are unchanged on 1.9.
 *
 * Each verified handler has its own call site naming the handler as a string literal, with
 * an object-literal request of exactly the declared keys, so
 * tests/contracts/bi-handlers.contract.test.ts resolves and checks it.
 */

import { z } from "zod";
import type { WorkbenchCallOptions, WorkbenchClient } from "./client.js";

/** E04 field types (build 1.9.0.37). */
export type BiFieldType =
  | "string"
  | "int"
  | "bool"
  | "ResourceName"
  | "array<int>"
  | "array<string>"
  | "array<ResourceName>"
  | "array<float>"
  | "array<MaterialOverride>"
  | "array<MatParam>";

export type BiClass = "read" | "mutating";

export interface BiHandlerRow {
  name: string;
  /** Declared request fields and their E04 types, in E04's (sorted) order. */
  request: ReadonlyArray<readonly [string, BiFieldType]>;
  /** Declared response fields (E04). */
  response: readonly string[];
  /** Source of the declaration (pak path and line, E04). */
  ref: string;
  class: BiClass;
  /** Answered live (DEC-040 sc-02 / sc-08b; most after an authorization click, DEC-047 U27). */
  verifiedLive: boolean;
  /** Why it is classed so (s-c-natives.ts BI_INCLUDED / BI_EXCLUDED, E04 risk_hint). */
  risk: string;
}

const AL = "pak:scripts/WorkbenchGameCommon/EnfusionBlenderTools/";
const RI = "pak:scripts/WorkbenchGameCommon/ResourceInfo.c";

/** The 42 compiled Bohemia handlers E04 lists at 1.9.0.37, sorted by name. */
export const BI_HANDLERS: readonly BiHandlerRow[] = [
  {
    name: "AnimExportProfileChannels",
    request: [["ProfileName", "string"]],
    response: ["Channels"],
    ref: `${AL}AnimExportProfiles.c#L90`,
    class: "read",
    verifiedLive: true,
    risk: "a new TxaExporter and GetProfileIndex: reads only",
  },
  {
    name: "AnimExportProfiles",
    request: [["ExportProfileAbsPath", "string"]],
    response: ["ProfileNames"],
    ref: `${AL}AnimExportProfiles.c#L29`,
    class: "read",
    verifiedLive: true,
    risk: "LoadProfiles reads a profile file: reads only",
  },
  {
    name: "AnimExportTrackExport",
    request: [
      ["DiffData", "array<float>"],
      ["Fps", "int"],
      ["KeyData", "array<float>"],
      ["NumChannels", "int"],
      ["NumKeyframes", "int"],
      ["Profile", "string"],
      ["SourceFile", "string"],
      ["TargetFile", "string"],
    ],
    response: ["ErrorMessage", "Result"],
    ref: `${AL}AnimExport.c#L43`,
    class: "mutating",
    verifiedLive: false,
    risk: "writes a .txa (AnimExport.c#L80)",
  },
  {
    name: "BakeInfo",
    request: [["msg", "string"]],
    response: ["Output"],
    ref: `${AL}PrefabMlodBaker.c#L368`,
    class: "mutating",
    verifiedLive: false,
    risk: "opens Workbench.ScriptDialog, a modal (BakeMLOD.c#L388 at 1.8.0.13; the class moved to PrefabMlodBaker.c in 1.9)",
  },
  {
    name: "CheckGUID",
    request: [["matName", "string"]],
    response: ["exists"],
    ref: `${AL}CheckGUID.c#L21`,
    class: "read",
    verifiedLive: true,
    risk: "Workbench.GetResourceName and a compare: reads only",
  },
  {
    name: "EBTInfo",
    request: [
      ["msg", "string"],
      ["title", "string"],
    ],
    response: [],
    ref: `${AL}EBTResponse.c#L35`,
    class: "mutating",
    verifiedLive: false,
    risk: "opens Workbench.ScriptDialog, a modal (EBTResponse.c#L49)",
  },
  {
    name: "ExportFBXResource",
    request: [
      ["exportMorphs", "bool"],
      ["exportSceneHierarchy", "bool"],
      ["exportSkinning", "bool"],
      ["materialOverrides", "array<MaterialOverride>"],
      ["resourcePath", "string"],
      ["validationMode", "string"],
    ],
    response: ["message", "resourcePath", "status"],
    ref: `${RI}#L1260`,
    class: "mutating",
    verifiedLive: false,
    risk: "RegisterResourceFile, MetaFile.Save, RebuildResourceFile",
  },
  {
    name: "ExportMaterialResource",
    request: [
      ["create", "bool"],
      ["data", "array<MatParam>"],
      ["resourceName", "ResourceName"],
      ["resourcePath", "string"],
      ["type", "string"],
    ],
    response: ["message", "resourcePath", "status"],
    ref: `${RI}#L954`,
    class: "mutating",
    verifiedLive: false,
    risk: "SaveContainer and RegisterResourceFile",
  },
  {
    name: "ExportSurfaceMasks",
    request: [
      ["exportDirectory", "string"],
      ["terrainIndex", "int"],
    ],
    response: ["success"],
    ref: `${RI}#L1874`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9: WorldEditorAPI.ExportSurfaceMasks writes mask files to the requested directory; returns null when no World Editor is open",
  },
  {
    name: "ExportTXAResource",
    request: [
      ["diffData", "array<float>"],
      ["fps", "int"],
      ["keyData", "array<float>"],
      ["numberOfChannels", "int"],
      ["numberOfKeyframes", "int"],
      ["profile", "string"],
      ["sourceFile", "string"],
      ["targetFile", "string"],
    ],
    response: ["message", "resourcePath", "status"],
    ref: `${RI}#L1445`,
    class: "mutating",
    verifiedLive: false,
    risk: "writes a .txa, registers and rebuilds it",
  },
  {
    name: "ExportTerrain",
    request: [
      ["area", "int"],
      ["count", "int"],
      ["path", "string"],
      ["worldPath", "string"],
    ],
    response: ["Output"],
    ref: `${AL}ExportTerrain.c#L28`,
    class: "mutating",
    verifiedLive: false,
    risk: "opens a world and writes terrain tiles",
  },
  {
    name: "ExportTextureResource",
    request: [
      ["destinationPath", "string"],
      ["sourcePath", "string"],
    ],
    response: ["message", "resourcePath", "status"],
    ref: `${RI}#L1396`,
    class: "mutating",
    verifiedLive: false,
    risk: "FileIO.CopyFile, register, MetaFile.Save, rebuild",
  },
  {
    name: "FBXReportToolMessage",
    request: [["logFile", "string"]],
    response: ["Output"],
    ref: "pak:scripts/WorkbenchGameCommon/ValidateFBXPlugin.c#L249",
    class: "mutating",
    verifiedLive: false,
    risk: "writes the system clipboard; a wrong path dereferences a null file handle",
  },
  {
    name: "GetAnimationExporProfileChannelsInfo",
    request: [["animationExportProfile", "string"]],
    response: ["channelInfos", "message", "status"],
    ref: `${RI}#L1182`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: TxaExporter.LoadProfiles on the profile's folder and channel reads; source shows no write",
  },
  {
    name: "GetAnimationExportProfileInfosInProject",
    request: [],
    response: ["animationExportProfiles"],
    ref: `${RI}#L1125`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: SearchResources over every .apr (GetRequest returns null); source shows no write",
  },
  {
    name: "GetGameMaterials",
    request: [],
    response: ["data"],
    ref: `${RI}#L813`,
    class: "read",
    verifiedLive: true,
    risk: "SearchResources over every .gamemat: reads only, heavy",
  },
  {
    name: "GetLayerInteraction",
    request: [["layer", "string"]],
    response: ["layerPresets"],
    ref: `${AL}LayerPresets.c#L92`,
    class: "mutating",
    verifiedLive: false,
    risk: "unguarded project-settings walk; not called cold until the settings merge is known",
  },
  {
    name: "GetLoadedProjects",
    request: [],
    response: ["Loaded Projects"],
    ref: `${AL}AssetLibraryUtils.c#L43`,
    class: "read",
    verifiedLive: true,
    risk: "GetLoadedAddons and GetAbsolutePath: reads only",
  },
  {
    name: "GetMaterialsByClass",
    request: [["matClass", "string"]],
    response: ["data", "message", "status"],
    ref: `${RI}#L859`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: SearchResources and Resource.Load on every .emat of every loaded addon in one call (unbounded queue time, as GetPortalMat)",
  },
  {
    name: "GetPathToAssetsFromGuids",
    request: [["guids", "array<string>"]],
    response: ["invalidGuids", "prefabsPaths"],
    ref: `${AL}AssetLibraryUtils.c#L279`,
    class: "read",
    verifiedLive: true,
    risk: "GetAbsolutePath per GUID: reads only",
  },
  {
    name: "GetPortalMat",
    request: [
      ["matHeights", "array<int>"],
      ["matWidths", "array<int>"],
      ["socketNames", "array<string>"],
    ],
    response: ["matNames"],
    ref: `${AL}GetPortalMat.c#L26`,
    class: "mutating",
    verifiedLive: false,
    risk: "Resource.Load on every .emat of the game in one call: unbounded queue time",
  },
  {
    name: "GetPrefabChildInfo",
    request: [
      ["childIdx", "array<int>"],
      ["expandResource", "bool"],
      ["resourceName", "ResourceName"],
    ],
    response: ["absolutePath", "data", "message", "resourceName", "status"],
    ref: `${RI}#L720`,
    class: "read",
    verifiedLive: true,
    risk: "GetMetaFile null-checked, then Resource.Load and container reads: reads only",
  },
  {
    name: "GetPrefabGUID",
    request: [["prefabPath", "string"]],
    response: ["guid", "message", "status"],
    ref: `${AL}AssetLibraryUtils.c#L224`,
    class: "read",
    verifiedLive: true,
    risk: "GetMetaFile null-checked, then GetResourceID: reads only",
  },
  {
    name: "GetRelativePath",
    request: [["absPath", "string"]],
    response: ["errorString", "relPath"],
    ref: `${AL}EBTEmatUtils.c#L56`,
    class: "read",
    verifiedLive: true,
    risk: "GetMetaFile null-checked, then GetResourceID: reads only",
  },
  {
    name: "GetResourceInfo",
    request: [
      ["expandResource", "bool"],
      ["path", "string"],
    ],
    response: ["absolutePath", "data", "message", "resourceName", "status"],
    ref: `${RI}#L640`,
    class: "read",
    verifiedLive: true,
    risk: "GetMetaFileFromString and Resource.Load, each checked: reads only",
  },
  {
    name: "GetResourceValidity",
    request: [["resources", "array<ResourceName>"]],
    response: ["validity"],
    ref: `${RI}#L678`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: BaseContainerTools.LoadContainer per requested resource; source shows no write",
  },
  {
    name: "GetSelectedEntities",
    request: [],
    response: ["entities"],
    ref: `${RI}#L1621`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: reads the World Editor selection; calls GetApi on Workbench.GetModule(WorldEditor) with no null check",
  },
  {
    name: "GetSurfaceMaterials",
    request: [["terrainIndex", "int"]],
    response: ["materials"],
    ref: `${RI}#L1816`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: WorldEditorAPI.GetSurfaceMaterials; returns null when no World Editor is open",
  },
  {
    name: "GetTerrainInfo",
    request: [["terrainIndex", "int"]],
    response: ["resolutionX", "resolutionY", "tilesX", "tilesY", "unitScale"],
    ref: `${RI}#L1701`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: WorldEditorAPI terrain getters, module and API null-checked; source shows no write",
  },
  {
    name: "GetTileHeightmap",
    request: [
      ["terrainIndex", "int"],
      ["tileX", "int"],
      ["tileY", "int"],
    ],
    response: ["heightMap"],
    ref: `${RI}#L1758`,
    class: "mutating",
    verifiedLive: false,
    risk: "new in 1.9, not called live: GetTerrainSurfaceTile inside BeginTerrainAction / EndTerrainAction (opens a terrain undo action)",
  },
  {
    name: "LayerPresets",
    request: [["Input", "string"]],
    response: ["Layer Presets"],
    ref: `${AL}LayerPresets.c#L57`,
    class: "mutating",
    verifiedLive: false,
    risk: "unguarded project-settings walk; not called cold until the settings merge is known",
  },
  {
    name: "LoadedProjects",
    request: [["path", "string"]],
    response: ["resourceInProject"],
    ref: `${AL}LoadedProjects.c#L22`,
    class: "read",
    verifiedLive: true,
    risk: "GetLoadedAddons and a string compare: reads only",
  },
  {
    name: "LocatePrefabsFromPath",
    request: [
      ["projectPath", "string"],
      ["selectedFolder", "string"],
      ["selectedProject", "string"],
    ],
    response: ["message", "prefabsPaths", "status"],
    ref: `${AL}AssetLibraryUtils.c#L144`,
    class: "read",
    verifiedLive: false,
    risk: "FileIO.FindFiles raised the Script Authorization Required prompt (DEC-040 U27)",
  },
  {
    name: "LocateProject",
    request: [["path", "string"]],
    response: ["message", "projectName", "projectPath", "status"],
    ref: `${AL}AssetLibraryUtils.c#L80`,
    class: "read",
    verifiedLive: true,
    risk: "GetLoadedAddons and a string compare: reads only",
  },
  {
    name: "MaterialValidator",
    request: [["mat_index", "int"]],
    response: ["abs_textures", "mat_name", "reports", "severity"],
    ref: "pak:scripts/WorkbenchGameCommon/ValidateMaterialPlugin.c#L330",
    class: "mutating",
    verifiedLive: false,
    risk: "indexes a static list only the FBX validation plugin fills; cold it reads past an empty array",
  },
  {
    name: "OpenXOB",
    request: [["path", "string"]],
    response: ["Output"],
    ref: `${AL}OpenXOB.c#L21`,
    class: "mutating",
    verifiedLive: true,
    risk: "SetOpenedResource: opens a model window (answered live in the reversible block, sc-08b)",
  },
  {
    name: "OverrideMeshObjectMaterial",
    request: [
      ["materialAbsPath", "string"],
      ["prefabAbsPath", "string"],
      ["sourceMaterial", "string"],
      ["textureAbsPath", "string"],
    ],
    response: ["Output"],
    ref: `${AL}PrefabMlodBaker.c#L463`,
    class: "mutating",
    verifiedLive: false,
    risk: "SaveContainer, SetVariableValue and SaveEntityTemplate on prefabs",
  },
  {
    name: "PrefabImporter",
    request: [
      ["absPath", "string"],
      ["start", "int"],
    ],
    response: [
      "angles",
      "coords",
      "ematPath",
      "fbx",
      "ids",
      "message",
      "parents",
      "pivots",
      "scales",
      "size",
      "sourceMat",
      "status",
      "stopped",
    ],
    ref: `${AL}PrefabImporter.c#L336`,
    class: "read",
    verifiedLive: true,
    risk: "GetMetaFile null-checked, then a component walk: reads only",
  },
  {
    name: "PrefabImporterBake",
    request: [["etAbsPath", "string"]],
    response: ["fbx", "msg"],
    ref: `${AL}PrefabImporterBake.c#L161`,
    class: "mutating",
    verifiedLive: false,
    risk: "dereferences GetMetaFile's result with no null check",
  },
  {
    name: "RegisterResource",
    request: [["path", "array<string>"]],
    response: ["Output"],
    ref: `${RI}#L1534`,
    class: "mutating",
    verifiedLive: false,
    risk: "RegisterResourceFile, RebuildResourceFile, MetaFile.Save",
  },
  {
    name: "TextureValidation",
    request: [
      ["fbxPath", "string"],
      ["mats", "array<string>"],
    ],
    response: ["invalidTextures", "xob", "xobMats"],
    ref: `${AL}TextureValidation.c#L93`,
    class: "read",
    verifiedLive: true,
    risk: "GetMaterials null-checks GetMetaFile: verified live only on the null-meta branch; with a found meta the Configurations walk is unguarded and was not run live (P3-bi)",
  },
  {
    name: "TextureValidator",
    request: [["texture_path", "string"]],
    response: ["reports", "severity"],
    ref: "pak:scripts/WorkbenchGameCommon/ValidateMaterialPlugin.c#L385",
    class: "mutating",
    verifiedLive: false,
    risk: "dereferences GetMetaFile's result with no null check (VM exception dialog on a path without a meta)",
  },
];

/** The 14 read-only handlers verified live (DEC-047 L6). */
export const VERIFIED_READ = [
  "AnimExportProfileChannels",
  "AnimExportProfiles",
  "CheckGUID",
  "GetGameMaterials",
  "GetLoadedProjects",
  "GetPathToAssetsFromGuids",
  "GetPrefabChildInfo",
  "GetPrefabGUID",
  "GetRelativePath",
  "GetResourceInfo",
  "LoadedProjects",
  "LocateProject",
  "PrefabImporter",
  "TextureValidation",
] as const;
export type VerifiedReadName = (typeof VERIFIED_READ)[number];

/** The read-only handler that stays gated (DEC-040 U27, DEC-047 L6). */
export const AUTH_GATED = "LocatePrefabsFromPath";
export const AUTH_GATED_NEXT = "the Bohemia battery, after an authorization";
export const MUTATING_GATED_NEXT = "the Phase 3 Bohemia battery (DEC-047 L6)";

export function findHandler(name: string): BiHandlerRow | undefined {
  return BI_HANDLERS.find((h) => h.name === name);
}

export function isVerifiedRead(name: string): name is VerifiedReadName {
  return (VERIFIED_READ as readonly string[]).includes(name);
}

/** Facts DEC-040 sc-02 recorded about a handler's answers, surfaced as warnings. */
export const LIVE_NOTES: Readonly<Record<string, string>> = {
  LocateProject:
    "LocateProject accepts a forward-slash path and rejects the same path with backslashes (DEC-040)",
  CheckGUID: "CheckGUID answered exists 1 for a GUID nothing has (DEC-040): not proof of existence",
  GetPrefabGUID:
    "reads on-disk metas only: packed vanilla resources answer Meta file not found (DEC-040)",
  GetResourceInfo:
    "reads on-disk metas only: packed vanilla resources answer Resource not found (DEC-040)",
  GetPrefabChildInfo:
    "reads on-disk metas only: packed vanilla resources answer Resource not found (DEC-040)",
  PrefabImporter: "reads on-disk metas only: packed vanilla resources answer not found (DEC-040)",
};

// ── Request schemas generated from the declared fields ────────────────────────

function fieldSchema(t: BiFieldType): z.ZodTypeAny {
  switch (t) {
    case "string":
    case "ResourceName":
      return z.string();
    case "int":
      return z.number().int();
    case "bool":
      return z.boolean();
    case "array<int>":
      return z.array(z.number().int());
    case "array<float>":
      return z.array(z.number());
    case "array<string>":
    case "array<ResourceName>":
      return z.array(z.string());
    case "array<MaterialOverride>":
    case "array<MatParam>":
      return z.array(z.record(z.string(), z.unknown()));
  }
}

/** Strict object of the handler's declared fields, each required: an undeclared key fails. */
export function requestSchema(row: BiHandlerRow): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, t] of row.request) shape[k] = fieldSchema(t);
  return z.object(shape).strict();
}

/** Discriminated union over the 14 verified handlers: `{ handler, request }`. */
export function verifiedCallSchema() {
  const rows = VERIFIED_READ.map((n) => findHandler(n)!);
  const variants = rows.map((r) =>
    z
      .object({
        handler: z.literal(r.name),
        request: requestSchema(r).default({}),
      })
      .strict(),
  );
  return z.discriminatedUnion(
    "handler",
    variants as unknown as [
      z.ZodDiscriminatedUnionOption<"handler">,
      ...z.ZodDiscriminatedUnionOption<"handler">[],
    ],
  );
}

// ── The call sites (one per verified handler) ─────────────────────────────────

/**
 * Timeouts (ms). DEC-040 measured every Bohemia read in milliseconds ("every NET call answered
 * in milliseconds"; GetGameMaterials 27 and 16 ms warm, U30), so latency does not size them:
 * the modal reset does. A read that hits the client's own timer is TIMEOUT (client.ts
 * classifyTimeout), never MODAL_OPEN; MODAL_OPEN needs the engine's about-120 s reset to arrive
 * first (MODAL_RESET_MIN_MS 100 s). So every call waits 140 s (as native.ts compile does),
 * under WEDGE_AFTER_MS (150 s); GetGameMaterials, cold-unknown, waits 300 s (past the wedge
 * threshold: the reset still comes first if a modal blocks it).
 */
export const BI_TIMEOUTS = { read: 140_000, heavy: 300_000 } as const;

/** Handlers that call file or resource-loading methods (DEC-047 U27: a modal hazard). */
export const MODAL_HAZARD: ReadonlySet<string> = new Set([
  "AnimExportProfiles",
  "GetGameMaterials",
  "GetPrefabChildInfo",
  "GetPrefabGUID",
  "GetRelativePath",
  "GetResourceInfo",
  "PrefabImporter",
  "TextureValidation",
]);
export const MODAL_HAZARD_WARNING =
  "file or resource method: may raise a Script Authorization prompt on a fresh launch (DEC-047 U27; verified only after an owner click); a blocked call reports MODAL_OPEN after about 120 s";

type Req = Record<string, unknown>;
type Caller = Pick<WorkbenchClient, "call">;
type Send = (c: Caller, r: Req, o: WorkbenchCallOptions) => Promise<Record<string, unknown>>;

const SENDERS: Record<VerifiedReadName, Send> = {
  AnimExportProfileChannels: (c, r, o) =>
    c.call("AnimExportProfileChannels", { ProfileName: r.ProfileName }, o),
  AnimExportProfiles: (c, r, o) =>
    c.call("AnimExportProfiles", { ExportProfileAbsPath: r.ExportProfileAbsPath }, o),
  CheckGUID: (c, r, o) => c.call("CheckGUID", { matName: r.matName }, o),
  GetGameMaterials: (c, _r, o) => c.call("GetGameMaterials", {}, o),
  GetLoadedProjects: (c, _r, o) => c.call("GetLoadedProjects", {}, o),
  GetPathToAssetsFromGuids: (c, r, o) => c.call("GetPathToAssetsFromGuids", { guids: r.guids }, o),
  GetPrefabChildInfo: (c, r, o) =>
    c.call(
      "GetPrefabChildInfo",
      { resourceName: r.resourceName, childIdx: r.childIdx, expandResource: r.expandResource },
      o,
    ),
  GetPrefabGUID: (c, r, o) => c.call("GetPrefabGUID", { prefabPath: r.prefabPath }, o),
  GetRelativePath: (c, r, o) => c.call("GetRelativePath", { absPath: r.absPath }, o),
  GetResourceInfo: (c, r, o) =>
    c.call("GetResourceInfo", { path: r.path, expandResource: r.expandResource }, o),
  LoadedProjects: (c, r, o) => c.call("LoadedProjects", { path: r.path }, o),
  LocateProject: (c, r, o) => c.call("LocateProject", { path: r.path }, o),
  PrefabImporter: (c, r, o) => c.call("PrefabImporter", { absPath: r.absPath, start: r.start }, o),
  TextureValidation: (c, r, o) =>
    c.call("TextureValidation", { mats: r.mats, fbxPath: r.fbxPath }, o),
};

export function timeoutFor(name: VerifiedReadName, request: Req): number {
  if (name === "GetGameMaterials") return BI_TIMEOUTS.heavy;
  void request;
  return BI_TIMEOUTS.read;
}

/**
 * Sends one verified read-only handler with access "read". The request must already have
 * passed `requestSchema` (the tool layer validates before calling this).
 */
export async function callVerifiedRead(
  client: Caller,
  name: VerifiedReadName,
  request: Req,
): Promise<Record<string, unknown>> {
  return SENDERS[name](client, request, { access: "read", timeout: timeoutFor(name, request) });
}
