/**
 * EMCP_WB_TerrainEdit.c - Terrain writes of wb_terrain_edit (wave W7, phase5-w7-spec.md section 2.1;
 * DEC-075 rules OD-1 to OD-13 and holds OD-5)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_TerrainEdit", dispatching on "action":
 *   tileRead     the heights of one tile as packed rows "r|v v v ..." (GetTerrainSurfaceTile/4 into a
 *                local array), paged by rows (default 16, max 64). Read only, no project guard.
 *   tileWrite    height runs "tx ty row col|v v ..." (at most 64): each touched tile is read, the runs
 *                are applied in memory and the estimate answered (tiles, samples changed, min, max and
 *                mean delta as text). With confirm: one terrain action (BeginTerrainAction/2 with the
 *                undo name only, SetTerrainSurfaceTile/4 per tile, EndTerrainAction/1). GATED until
 *                P-W7-01 (U18) sets TERRAIN_WRITE_OPEN.
 *   flatter      add (AddTerrainFlatterEntity called with 7 arguments: entity, mins, maxs, priority,
 *                falloffStart, falloff, bForceUpdate true; the two optional out arrays are omitted,
 *                never passed null) or remove (RemoveTerrainFlatterEntity/2, update true) a flattener,
 *                inside one terrain action. GATED until P-W7-06 sets FLATTER_OPEN.
 *   maps         shore (BuildShoreMap/0) or flow (RegenerateFlowMaps/4: preview, save true, synchronous,
 *                no warning dialog) maps; they overwrite the world's map files with no undo. GATED until
 *                P-W7-07 sets MAPS_OPEN.
 *   exportMasks  ExportSurfaceMasks/2 into a NEW project folder (EMCP_WB_Guard.NewTargetInProject); the
 *                engine writes the files, this handler writes none. GATED until P-W7-08 sets MASKS_OPEN.
 *   brush, backup, restore  served by the TS tool (the brush maths, then tileWrite; node:fs copies of
 *                the terrain file set); refused here.
 *
 * Tile array order: rows and columns are the array's own index (row * side + col); nothing is claimed
 * about world axes until P-W7-01 records the order. Tile layout (fix-up 1): the resolution allows two
 * layouts, "disjoint" (side = res / tiles, tiles do not overlap) and "sharedEdge" (side =
 * (res - 1) / tiles + 1, neighbours share their edge row; vanilla EmptyArland is 2049 = 16 * 128 + 1,
 * and W1's P-W1-15 read 16641 = 129 * 129 samples from one tile). The side is never taken from the
 * resolution alone: the first GetTerrainSurfaceTile of a call must answer side * side samples for one
 * of the candidates, and tileRead and tileWrite answer the layout. Anything else answers UNPROVEN.
 *
 * Guards (spec section 1.2): every World Editor call goes through the shared world-loaded check
 * (EMCP_WB_Common.NoWorldReason) and the world must have a terrain (NO_TERRAIN);
 * Workbench.GetModule(WorldEditor) opens a closed World Editor. Every mutating action: the project is
 * found (EMCP_WB_Guard, DEC-058), the editor is in edit mode (WRONG_MODE), every argument is checked
 * before the first engine write, and nothing is written without confirm true (the dry run answers the
 * estimate and dryRun true). tileWrite, flatter and maps also need the open world inside the project
 * (NOT_IN_PROJECT). Before a write: the action's gate (GATED), then the world gate of DEC-075 OD-5 (a
 * confirmed tileWrite, flatter or maps on a world that is not under the project's top-level
 * _throwaway/ folder refuses GATED while ANY_WORLD_OPEN is false), then ENGINE_BUSY when the editor is
 * inside another edit action or an undo. A gated action still validates and answers the dry run.
 * NO_BACKUP is the TS tool's (its per-session backup record); this handler never reads a file.
 * Floats travel as text and are parsed with EMCP_WB_Common.ParseFloat. No FileIO, no out parameter of
 * an engine pointer type. A refusal answers status "refused" (or "error") with code and next set and
 * message in the form "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage).
 * Keys: contracts/EMCP_WB_TerrainEdit.json.
 */

class EMCP_WB_TerrainEditRequest : JsonApiStruct
{
	string action;
	//! tileRead: the tile
	int tileX;
	int tileY;
	//! tileRead, tileWrite, brush, exportMasks: the terrain, default 0
	int terrainIndex;
	//! tileRead: "<start>:<count>" from nextCursor
	string cursor;
	//! tileRead: rows per page (default 16, max 64)
	int limit;
	//! tileWrite: "tx ty row col|v v ...", at most 64
	ref array<string> patches;
	//! tileWrite: suffix of the undo name
	string undoLabel;
	//! tileWrite, brush, flatter, maps, exportMasks, restore: false is a dry run
	bool confirm;
	//! brush (TS only)
	string centre;
	string radius;
	string strength;
	//! brush (TS only), flatter: metres as text
	string falloff;
	//! brush (TS only)
	string mode;
	string delta;
	string height;
	int passes;
	string scale;
	int seed;
	//! flatter: add or remove
	string op;
	//! flatter: entity ref
	string entity;
	//! flatter add: "x y z" local
	string mins;
	string maxs;
	int priority;
	//! flatter add: metres as text
	string falloffStart;
	//! maps: shore or flow
	string kind;
	//! maps flow: preview
	bool preview;
	//! exportMasks: project-relative, a new folder
	string directory;
	//! backup (TS only)
	string label;
	//! restore (TS only)
	string backupId;

	void EMCP_WB_TerrainEditRequest()
	{
		patches = {};

		RegV("action");
		RegV("tileX");
		RegV("tileY");
		RegV("terrainIndex");
		RegV("cursor");
		RegV("limit");
		RegV("patches");
		RegV("undoLabel");
		RegV("confirm");
		RegV("centre");
		RegV("radius");
		RegV("strength");
		RegV("falloff");
		RegV("mode");
		RegV("delta");
		RegV("height");
		RegV("passes");
		RegV("scale");
		RegV("seed");
		RegV("op");
		RegV("entity");
		RegV("mins");
		RegV("maxs");
		RegV("priority");
		RegV("falloffStart");
		RegV("kind");
		RegV("preview");
		RegV("directory");
		RegV("label");
		RegV("backupId");

		// Defaults for keys the request leaves out.
		tileX = -1;
		tileY = -1;
	}
}

class EMCP_WB_TerrainEditResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string action;
	string code;
	string message;
	string next;
	//! tileRead: samples per tile row
	int side;
	//! tileRead, tileWrite: disjoint, sharedEdge or single (one tile per axis), from the sample count
	string layout;
	//! tileRead: "r|v v v ..."
	ref array<string> rows;
	//! tileRead: rows in the tile
	int total;
	string nextCursor;
	//! tileWrite: tiles touched, samples changed, deltas in metres as text
	int tiles;
	int samples;
	string minDelta;
	string maxDelta;
	string meanDelta;
	//! tileWrite, flatter, maps, exportMasks: true when nothing was written
	bool dryRun;
	//! tileWrite, flatter: the terrain action's name
	string undoName;
	//! flatter: the entity's id: reference
	string id;
	//! maps: the build ran
	bool built;
	//! exportMasks: ExportSurfaceMasks answered true
	bool exported;
	//! backup (TS only)
	string backupId;
	//! backup, restore (TS only)
	int files;

	void EMCP_WB_TerrainEditResponse()
	{
		rows = {};

		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("next");
		RegV("side");
		RegV("layout");
		RegV("rows");
		RegV("total");
		RegV("nextCursor");
		RegV("tiles");
		RegV("samples");
		RegV("minDelta");
		RegV("maxDelta");
		RegV("meanDelta");
		RegV("dryRun");
		RegV("undoName");
		RegV("id");
		RegV("built");
		RegV("exported");
		RegV("backupId");
		RegV("files");
	}
}

//! One parsed height run: tile, start sample (row, col) and the values along the row.
class EMCP_WB_TerrainEditPatch
{
	int m_TileX;
	int m_TileY;
	int m_Row;
	int m_Col;
	ref array<float> m_Values;

	void EMCP_WB_TerrainEditPatch()
	{
		m_Values = {};
	}
}

//! One touched tile of a tileWrite: the heights read, the heights after the runs, the samples a run
//! touched (a set for the lookup, a list for the walk: map.GetKey is O(n), so the walk never uses it).
class EMCP_WB_TerrainEditTile
{
	int m_TileX;
	int m_TileY;
	ref array<float> m_Orig;
	ref array<float> m_Heights;
	ref map<int, bool> m_Touched;
	ref array<int> m_TouchedList;

	void EMCP_WB_TerrainEditTile()
	{
		m_Orig = {};
		m_Heights = {};
		m_Touched = new map<int, bool>();
		m_TouchedList = {};
	}
}

//! The tile grid of one terrain: a holder, not out parameters.
class EMCP_WB_TerrainEditGrid
{
	int m_TilesX;
	int m_TilesY;
	//! The candidate sides the resolution allows (0 = that layout does not fit): res / tiles and
	//! (res - 1) / tiles + 1, square on both axes.
	int m_DisjointSide;
	int m_SharedSide;
	//! samples per tile row (and rows per tile: tiles are square); 0 until a tile read confirms it
	int m_Side;
	//! disjoint, sharedEdge or single; "" until a tile read confirms it
	string m_Layout;
}

class EMCP_WB_TerrainEdit : NetApiHandler
{
	//! Gates (spec section 1.2 rule 9): false until the probe passes; the main session flips each one
	//! on its probe's evidence and recompiles.
	//! tileWrite: P-W7-01 (U18: effect, undo, order, persistence).
	static const bool TERRAIN_WRITE_OPEN = false;
	//! flatter: P-W7-06.
	static const bool FLATTER_OPEN = false;
	//! maps: P-W7-07.
	static const bool MAPS_OPEN = false;
	//! exportMasks: P-W7-08.
	static const bool MASKS_OPEN = false;
	//! DEC-075 OD-5 (held, OI-W7-6): a confirmed tileWrite, flatter or maps on a world that is not
	//! under the project's top-level _throwaway/ folder refuses GATED while this is false.
	static const bool ANY_WORLD_OPEN = false;
	//! The folder the world gate lets through (project-relative, lower case).
	static const string THROWAWAY_FOLDER = "_throwaway/";
	//! tileRead: rows per page.
	static const int PAGE_DEFAULT = 16;
	static const int PAGE_MAX = 64;
	//! tileWrite: runs per call, values per run, undo label length.
	static const int MAX_PATCHES = 64;
	static const int MAX_RUN = 4097;
	static const int MAX_LABEL = 64;
	//! tileWrite: a height outside +-this (metres) is refused before any engine call.
	static const float MAX_ABS_HEIGHT = 10000.0;
	//! Undo names: this prefix, then the action (tileWrite: then " <undoLabel>").
	static const string UNDO_PREFIX = "EMCP wb_terrain_edit ";
	//! Refusal codes, spelled as in src/manifest/vocabulary.ts (ENGINE_BUSY and TERRAIN_ACTION_REFUSED
	//! land with W7, spec section 1.2 rule 13).
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string NO_WORLD = "NO_WORLD";
	static const string NO_TERRAIN = "NO_TERRAIN";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string UNPROVEN = "UNPROVEN";
	static const string GATED = "GATED";
	static const string ENGINE_BUSY = "ENGINE_BUSY";
	static const string TERRAIN_ACTION_REFUSED = "TERRAIN_ACTION_REFUSED";
	static const string TERRAIN_NEXT = "open a world that has a terrain";
	static const string WORLD_NEXT = "open a world (wb_module setResource)";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_TerrainEditRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_TerrainEditRequest req = EMCP_WB_TerrainEditRequest.Cast(request);
		EMCP_WB_TerrainEditResponse resp = new EMCP_WB_TerrainEditResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "tileRead")
			TileRead(req, resp);
		else if (req.action == "tileWrite")
			TileWrite(req, resp);
		else if (req.action == "brush")
			RefuseBrush(req, resp);
		else if (req.action == "flatter")
			Flatter(req, resp);
		else if (req.action == "maps")
			BuildMaps(req, resp);
		else if (req.action == "exportMasks")
			ExportMasks(req, resp);
		else if (req.action == "backup")
			RefuseBackup(req, resp);
		else if (req.action == "restore")
			RefuseRestore(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of tileRead, tileWrite, brush, flatter, maps, exportMasks, backup, restore");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_TerrainEditResponse resp, string status, string code, string text, string nextStep)
	{
		resp.status = status;
		resp.code = code;
		resp.next = nextStep;
		if (code == "")
			resp.message = text;
		else
			resp.message = EMCP_WB_Guard.RefusalMessage(code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! A refusal: status refused (EMCP_WB_Guard.REFUSED).
	protected static void Refuse(EMCP_WB_TerrainEditResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API of a loaded world that has a terrain, or null with the refusal written.
	//! GetModule opens a closed World Editor (DEC-053), as every World Editor handler does.
	protected static WorldEditorAPI TerrainApi(EMCP_WB_TerrainEditResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Answer(resp, "error", "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			Refuse(resp, NO_WORLD, "the World Editor has no API: no world is open", WORLD_NEXT);
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, NO_WORLD, noWorld, WORLD_NEXT);
			return null;
		}
		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		bool hasBounds = worldEditor.GetTerrainBounds(boundsMin, boundsMax);
		if (!hasBounds || vector.Distance(boundsMin, boundsMax) <= 0)
		{
			Refuse(resp, NO_TERRAIN, "the open world has no terrain (GetTerrainBounds is empty)", TERRAIN_NEXT);
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of a mutating action, in order: the project is found (DEC-058), the World Editor has
	//! a loaded world with a terrain, the editor is in edit mode. The API, or null with the refusal
	//! written.
	protected static WorldEditorAPI EditApi(EMCP_WB_TerrainEditResponse resp)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "terrain writes need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return null;
		}
		WorldEditorAPI api = TerrainApi(resp);
		if (!api)
			return null;
		if (api.IsGameMode() || !api.IsEditMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is not in edit mode; nothing was changed", "stop play first (wb_world stop)");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The open world's path relative to the project folder (forward slashes): from the project's
	//! "$<id>:" prefix, or from an absolute path under the project's folder. False with why when the
	//! world is not a world of the project.
	static bool WorldRelative(WorldEditorAPI api, out string rel, out string why)
	{
		rel = "";
		why = "";
		string addonId = "";
		string projectDir = "";
		if (!EMCP_WB_Guard.Project(addonId, projectDir, why))
			return false;

		string worldPath = "";
		api.GetWorldPath(worldPath);
		string prefix = "$" + addonId + ":";
		string tail = "";
		if (worldPath != "" && worldPath.StartsWith(prefix))
		{
			tail = worldPath.Substring(prefix.Length(), worldPath.Length() - prefix.Length());
		}
		else if (worldPath != "" && EMCP_WB_Guard.IsUnder(worldPath, projectDir))
		{
			string foldedWorld = EMCP_WB_Guard.Fold(worldPath);
			string foldedDir = EMCP_WB_Guard.Fold(projectDir);
			if (foldedDir.EndsWith("/"))
				foldedDir = foldedDir.Substring(0, foldedDir.Length() - 1);
			tail = foldedWorld.Substring(foldedDir.Length() + 1, foldedWorld.Length() - foldedDir.Length() - 1);
		}
		else
		{
			why = "the open world is not a world of the open project";
			return false;
		}

		tail.Replace("\\", "/");
		while (tail.StartsWith("/"))
			tail = tail.Substring(1, tail.Length() - 1);
		string clean = "";
		string cleanWhy = "";
		if (!EMCP_WB_Guard.CleanRelative(tail, clean, cleanWhy))
		{
			why = "the open world's path is not a clean path inside the project: " + cleanWhy;
			return false;
		}
		rel = clean;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True when a project-relative path lies under the project's top-level _throwaway/ folder.
	static bool IsThrowaway(string rel)
	{
		string folded = EMCP_WB_Guard.Fold(rel);
		return folded.StartsWith(THROWAWAY_FOLDER);
	}

	//------------------------------------------------------------------------------------------------
	//! The open world is a world of the project; throwaway answers whether it is under _throwaway/.
	//! False with NOT_IN_PROJECT written.
	protected static bool ProjectWorld(WorldEditorAPI api, EMCP_WB_TerrainEditResponse resp, out bool throwaway)
	{
		throwaway = false;
		string rel = "";
		string why = "";
		if (!WorldRelative(api, rel, why))
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was changed", "open a world of the project you have open");
			return false;
		}
		throwaway = IsThrowaway(rel);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The gates in front of a confirmed write, in order: the action's own gate (its probe), then the
	//! world gate of DEC-075 OD-5 when worldGate is true. False with GATED written.
	protected static bool WriteGate(bool open, string probe, bool worldGate, bool throwaway, EMCP_WB_TerrainEditResponse resp)
	{
		if (!open)
		{
			Refuse(resp, GATED, "this write waits for probe " + probe + "; the dry run above is all that ran, nothing was written", "the main session opens it after " + probe + " passes");
			return false;
		}
		if (worldGate && !ANY_WORLD_OPEN && !throwaway)
		{
			Refuse(resp, GATED, "terrain writes outside the project's _throwaway/ folder wait for the owner (DEC-075 OD-5); nothing was written", "write on a world under _throwaway/, or ask the owner to open writes on any world");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! False with ENGINE_BUSY written when the editor is inside another edit action or an undo, so a
	//! nested action is never opened.
	protected static bool NotBusy(WorldEditorAPI api, EMCP_WB_TerrainEditResponse resp)
	{
		if (api.IsDoingEditAction() || api.UndoOrRedoIsRestoring())
		{
			Refuse(resp, ENGINE_BUSY, "the editor is inside another edit action or an undo; nothing was written", "retry when it ends");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The tile grid of one terrain into grid: the tile counts and the candidate sides of both layouts.
	//! The side itself is confirmed by the first tile read (ConfirmSide). False with the refusal
	//! written: INVALID_ARGUMENT for a terrain index with no tiles, UNPROVEN when neither layout fits
	//! the resolution with square tiles.
	protected static bool Grid(WorldEditorAPI api, int terrainIndex, EMCP_WB_TerrainEditResponse resp, notnull EMCP_WB_TerrainEditGrid grid)
	{
		grid.m_TilesX = 0;
		grid.m_TilesY = 0;
		grid.m_DisjointSide = 0;
		grid.m_SharedSide = 0;
		grid.m_Side = 0;
		grid.m_Layout = "";
		if (terrainIndex < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "terrainIndex must not be negative", "omit terrainIndex for 0");
			return false;
		}
		int countX = api.GetTerrainTilesX(terrainIndex);
		int countY = api.GetTerrainTilesY(terrainIndex);
		if (countX <= 0 || countY <= 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "terrain " + terrainIndex.ToString() + " has no tiles", "read the terrain with wb_terrain info");
			return false;
		}
		int resX = api.GetTerrainResolutionX(terrainIndex);
		int resY = api.GetTerrainResolutionY(terrainIndex);

		// disjoint: res = tiles * side
		int evenX = resX / countX;
		int evenY = resY / countY;
		if (evenX >= 2 && evenX == evenY && evenX * countX == resX && evenY * countY == resY)
			grid.m_DisjointSide = evenX;

		// sharedEdge: res = tiles * (side - 1) + 1
		int strideX = (resX - 1) / countX;
		int strideY = (resY - 1) / countY;
		if (strideX >= 1 && strideX == strideY && strideX * countX + 1 == resX && strideY * countY + 1 == resY)
			grid.m_SharedSide = strideX + 1;

		if (grid.m_DisjointSide == 0 && grid.m_SharedSide == 0)
		{
			Refuse(resp, UNPROVEN, "terrain " + terrainIndex.ToString() + " has " + resX.ToString() + "x" + resY.ToString() + " samples in " + countX.ToString() + "x" + countY.ToString() + " tiles: neither res = tiles * side nor res = tiles * (side - 1) + 1 gives square tiles", "read the terrain with wb_terrain info");
			return false;
		}
		grid.m_TilesX = countX;
		grid.m_TilesY = countY;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets grid.m_Side and grid.m_Layout from the sample count of one tile read: it must be side * side
	//! for one of the candidate sides. Once set, every later tile must answer the same count. False with
	//! UNPROVEN written otherwise.
	protected static bool ConfirmSide(notnull EMCP_WB_TerrainEditGrid grid, int sampleCount, int tileX, int tileY, EMCP_WB_TerrainEditResponse resp)
	{
		string where = "tile " + tileX.ToString() + "," + tileY.ToString() + " answered " + sampleCount.ToString() + " samples";
		if (grid.m_Side > 0)
		{
			int known = grid.m_Side * grid.m_Side;
			if (sampleCount == known)
				return true;
			Refuse(resp, UNPROVEN, where + ", " + known.ToString() + " expected as the first tile read (" + grid.m_Layout + ", side " + grid.m_Side.ToString() + "); nothing was written", "report it: the tiles differ in size");
			return false;
		}
		int shared = grid.m_SharedSide;
		int disjoint = grid.m_DisjointSide;
		bool isShared = shared > 0 && sampleCount == shared * shared;
		bool isDisjoint = disjoint > 0 && sampleCount == disjoint * disjoint;
		if (isShared && isDisjoint)
		{
			grid.m_Side = shared;
			grid.m_Layout = "single";
			return true;
		}
		if (isShared)
		{
			grid.m_Side = shared;
			grid.m_Layout = "sharedEdge";
			return true;
		}
		if (isDisjoint)
		{
			grid.m_Side = disjoint;
			grid.m_Layout = "disjoint";
			return true;
		}
		Refuse(resp, UNPROVEN, where + ": not side * side for side " + disjoint.ToString() + " (disjoint) or " + shared.ToString() + " (sharedEdge; 0 = the layout does not fit the resolution); nothing was written", "report it: the tile layout differs from both known layouts");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! Reads one tile into heights (a local array the caller owns). The first read of a call confirms
	//! the grid's side and layout (ConfirmSide). False with the error written when
	//! GetTerrainSurfaceTile answers false or a sample count that fits no layout.
	protected static bool ReadTileInto(WorldEditorAPI api, int terrainIndex, int tileX, int tileY, notnull EMCP_WB_TerrainEditGrid grid, notnull array<float> heights, EMCP_WB_TerrainEditResponse resp)
	{
		array<float> got = {};
		if (!api.GetTerrainSurfaceTile(terrainIndex, tileX, tileY, got))
		{
			Answer(resp, "error", ENGINE_FALSE, "GetTerrainSurfaceTile returned false for tile " + tileX.ToString() + "," + tileY.ToString() + "; nothing was written", "read the tile counts with wb_terrain info");
			return false;
		}
		if (!ConfirmSide(grid, got.Count(), tileX, tileY, resp))
			return false;
		heights.Copy(got);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Parses "<start>:<count>" (both non-negative decimals, start <= count). False on anything else.
	static bool ParseCursor(string cursorText, out int start, out int count)
	{
		start = 0;
		count = 0;
		int colon = cursorText.IndexOf(":");
		if (colon <= 0 || colon >= cursorText.Length() - 1)
			return false;
		int startValue = 0;
		int countValue = 0;
		if (!EMCP_WB_Common.ParseInt(cursorText.Substring(0, colon), startValue))
			return false;
		if (!EMCP_WB_Common.ParseInt(cursorText.Substring(colon + 1, cursorText.Length() - colon - 1), countValue))
			return false;
		if (startValue < 0 || countValue < 0 || startValue > countValue)
			return false;
		start = startValue;
		count = countValue;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Parses one run "tx ty row col|v v ..." (four non-negative integers, then 1 to MAX_RUN heights as
	//! text within +-MAX_ABS_HEIGHT) and appends it to into. False with why otherwise. The ranges
	//! against the terrain are checked later, once the grid is read.
	static bool ParsePatch(string text, notnull array<ref EMCP_WB_TerrainEditPatch> into, out string why)
	{
		why = "";
		int bar = text.IndexOf("|");
		if (bar <= 0 || bar >= text.Length() - 1)
		{
			why = "a patch is \"tx ty row col|v v ...\", got '" + text + "'";
			return false;
		}
		string head = text.Substring(0, bar);
		string body = text.Substring(bar + 1, text.Length() - bar - 1);

		array<string> heads = {};
		head.Split(" ", heads, true);
		if (heads.Count() != 4)
		{
			why = "a patch starts with four integers \"tx ty row col\", got '" + head + "'";
			return false;
		}
		array<int> numbers = {};
		for (int h = 0; h < 4; h++)
		{
			int number = 0;
			if (!EMCP_WB_Common.ParseInt(heads.Get(h), number) || number < 0)
			{
				why = "'" + heads.Get(h) + "' in '" + head + "' is not a non-negative integer";
				return false;
			}
			numbers.Insert(number);
		}

		array<string> texts = {};
		body.Split(" ", texts, true);
		if (texts.Count() < 1 || texts.Count() > MAX_RUN)
		{
			why = "a patch holds 1 to " + MAX_RUN.ToString() + " heights, got " + texts.Count().ToString();
			return false;
		}
		EMCP_WB_TerrainEditPatch patch = new EMCP_WB_TerrainEditPatch();
		patch.m_TileX = numbers.Get(0);
		patch.m_TileY = numbers.Get(1);
		patch.m_Row = numbers.Get(2);
		patch.m_Col = numbers.Get(3);
		for (int v = 0; v < texts.Count(); v++)
		{
			float value = 0;
			if (!EMCP_WB_Common.ParseFloat(texts.Get(v), value) || value > MAX_ABS_HEIGHT || value < -MAX_ABS_HEIGHT)
			{
				why = "height " + v.ToString() + " ('" + texts.Get(v) + "') is not a number within +-" + MAX_ABS_HEIGHT.ToString() + " m";
				return false;
			}
			patch.m_Values.Insert(value);
		}
		into.Insert(patch);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The index in tiles of the tile (tileX, tileY), or -1.
	static int FindTile(array<ref EMCP_WB_TerrainEditTile> tiles, int tileX, int tileY)
	{
		for (int i = 0; i < tiles.Count(); i++)
		{
			EMCP_WB_TerrainEditTile candidate = tiles.Get(i);
			if (candidate.m_TileX == tileX && candidate.m_TileY == tileY)
				return i;
		}
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! tileRead: GetTerrainSurfaceTile of one tile into a local array, as rows "r|v v v ..." of side
	//! samples each (index row * side + col), paged by rows.
	protected static void TileRead(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		int terrainIndex = req.terrainIndex;
		int tileX = req.tileX;
		int tileY = req.tileY;
		if (tileX < 0 || tileY < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "tileX and tileY are required and must not be negative", "read the tile counts with wb_terrain info");
			return;
		}
		WorldEditorAPI api = TerrainApi(resp);
		if (!api)
			return;
		EMCP_WB_TerrainEditGrid grid = new EMCP_WB_TerrainEditGrid();
		if (!Grid(api, terrainIndex, resp, grid))
			return;
		if (tileX >= grid.m_TilesX || tileY >= grid.m_TilesY)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "tile " + tileX.ToString() + "," + tileY.ToString() + " is outside the " + grid.m_TilesX.ToString() + "x" + grid.m_TilesY.ToString() + " tiles", "read the tile counts with wb_terrain info");
			return;
		}
		array<float> heights = {};
		if (!ReadTileInto(api, terrainIndex, tileX, tileY, grid, heights, resp))
			return;
		resp.layout = grid.m_Layout;

		int side = grid.m_Side;
		int total = side;
		int first = 0;
		if (req.cursor != "")
		{
			int issuedFor = 0;
			if (!ParseCursor(req.cursor, first, issuedFor))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "cursor must be <start>:<count> as nextCursor answered, got '" + req.cursor + "'", "omit cursor for the first page");
				return;
			}
			if (issuedFor != total)
			{
				Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " rows, the tile now has " + total.ToString(), "read again without a cursor");
				return;
			}
		}
		int pageSize = req.limit;
		if (pageSize <= 0)
			pageSize = PAGE_DEFAULT;
		if (pageSize > PAGE_MAX)
			pageSize = PAGE_MAX;
		int stop = first + pageSize;
		if (stop > total)
			stop = total;

		for (int r = first; r < stop; r++)
		{
			string line = r.ToString() + "|";
			int rowStart = r * side;
			for (int col = 0; col < side; col++)
			{
				if (col > 0)
					line += " ";
				float sample = heights.Get(rowStart + col);
				line += sample.ToString();
			}
			resp.rows.Insert(line);
		}
		resp.side = side;
		resp.total = total;
		if (stop < total)
			resp.nextCursor = stop.ToString() + ":" + total.ToString();
		Answer(resp, "ok", "", "tile " + tileX.ToString() + "," + tileY.ToString() + ": rows " + first.ToString() + " to " + stop.ToString() + " of " + total.ToString() + ", " + side.ToString() + " samples each, layout " + grid.m_Layout + " (array order, axes unproven until P-W7-01)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! tileWrite: parse every run, guard, read each touched tile, apply the runs in memory and answer
	//! the estimate; without confirm that is all (dry run). With confirm: the gates, ENGINE_BUSY, then
	//! one terrain action writing every touched tile.
	protected static void TileWrite(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		int patchCount = 0;
		if (req.patches)
			patchCount = req.patches.Count();
		if (patchCount < 1 || patchCount > MAX_PATCHES)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "patches must hold 1 to " + MAX_PATCHES.ToString() + " runs, got " + patchCount.ToString() + "; nothing was written", "split the runs over several calls");
			return;
		}
		string undoLabel = req.undoLabel;
		if (undoLabel.Length() > MAX_LABEL)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "undoLabel is at most " + MAX_LABEL.ToString() + " characters; nothing was written", "shorten undoLabel");
			return;
		}
		int terrainIndex = req.terrainIndex;
		if (terrainIndex < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "terrainIndex must not be negative; nothing was written", "omit terrainIndex for 0");
			return;
		}
		array<ref EMCP_WB_TerrainEditPatch> parsed = {};
		for (int p = 0; p < patchCount; p++)
		{
			string patchWhy = "";
			if (!ParsePatch(req.patches.Get(p), parsed, patchWhy))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "patches[" + p.ToString() + "]: " + patchWhy + "; nothing was written", "patches as \"tx ty row col|v v ...\"");
				return;
			}
		}
		bool wantWrite = req.confirm;

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		bool throwaway = false;
		if (!ProjectWorld(api, resp, throwaway))
			return;
		EMCP_WB_TerrainEditGrid grid = new EMCP_WB_TerrainEditGrid();
		if (!Grid(api, terrainIndex, resp, grid))
			return;

		// Tile range of every run against the grid, before any tile is read.
		for (int q = 0; q < parsed.Count(); q++)
		{
			EMCP_WB_TerrainEditPatch tileCheck = parsed.Get(q);
			if (tileCheck.m_TileX >= grid.m_TilesX || tileCheck.m_TileY >= grid.m_TilesY)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "patches[" + q.ToString() + "]: tile " + tileCheck.m_TileX.ToString() + "," + tileCheck.m_TileY.ToString() + " is outside the " + grid.m_TilesX.ToString() + "x" + grid.m_TilesY.ToString() + " tiles; nothing was written", "read the tile counts with wb_terrain info");
				return;
			}
		}

		// The side: confirmed by the first run's tile, which is read here and kept.
		array<ref EMCP_WB_TerrainEditTile> touched = {};
		EMCP_WB_TerrainEditPatch firstRun = parsed.Get(0);
		EMCP_WB_TerrainEditTile firstTile = new EMCP_WB_TerrainEditTile();
		firstTile.m_TileX = firstRun.m_TileX;
		firstTile.m_TileY = firstRun.m_TileY;
		if (!ReadTileInto(api, terrainIndex, firstRun.m_TileX, firstRun.m_TileY, grid, firstTile.m_Orig, resp))
			return;
		firstTile.m_Heights.Copy(firstTile.m_Orig);
		touched.Insert(firstTile);
		int side = grid.m_Side;
		resp.layout = grid.m_Layout;

		// Row and column range of every run against the confirmed side.
		for (int c = 0; c < parsed.Count(); c++)
		{
			EMCP_WB_TerrainEditPatch check = parsed.Get(c);
			if (check.m_Row >= side || check.m_Col + check.m_Values.Count() > side)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "patches[" + c.ToString() + "]: row " + check.m_Row.ToString() + ", col " + check.m_Col.ToString() + " and " + check.m_Values.Count().ToString() + " heights do not fit a tile row of " + side.ToString() + " samples; nothing was written", "split runs at tile and row edges");
				return;
			}
		}

		// Read each touched tile once (the first is read above), then apply the runs in order (a later
		// run wins).
		for (int n = 0; n < parsed.Count(); n++)
		{
			EMCP_WB_TerrainEditPatch run = parsed.Get(n);
			int found = FindTile(touched, run.m_TileX, run.m_TileY);
			if (found < 0)
			{
				EMCP_WB_TerrainEditTile fresh = new EMCP_WB_TerrainEditTile();
				fresh.m_TileX = run.m_TileX;
				fresh.m_TileY = run.m_TileY;
				if (!ReadTileInto(api, terrainIndex, run.m_TileX, run.m_TileY, grid, fresh.m_Orig, resp))
					return;
				fresh.m_Heights.Copy(fresh.m_Orig);
				touched.Insert(fresh);
				found = touched.Count() - 1;
			}
			EMCP_WB_TerrainEditTile target = touched.Get(found);
			int runStart = run.m_Row * side + run.m_Col;
			for (int k = 0; k < run.m_Values.Count(); k++)
			{
				int sampleAt = runStart + k;
				target.m_Heights.Set(sampleAt, run.m_Values.Get(k));
				if (!target.m_Touched.Contains(sampleAt))
				{
					target.m_Touched.Insert(sampleAt, true);
					target.m_TouchedList.Insert(sampleAt);
				}
			}
		}

		// The estimate: samples whose height changes, and their deltas.
		int changed = 0;
		float lowDelta = 0;
		float highDelta = 0;
		float sumDelta = 0;
		for (int t = 0; t < touched.Count(); t++)
		{
			EMCP_WB_TerrainEditTile tile = touched.Get(t);
			for (int m = 0; m < tile.m_TouchedList.Count(); m++)
			{
				int at = tile.m_TouchedList.Get(m);
				float d = tile.m_Heights.Get(at) - tile.m_Orig.Get(at);
				if (d == 0)
					continue;
				if (changed == 0 || d < lowDelta)
					lowDelta = d;
				if (changed == 0 || d > highDelta)
					highDelta = d;
				sumDelta += d;
				changed++;
			}
		}
		float meanValue = 0;
		if (changed > 0)
			meanValue = sumDelta / changed;
		resp.tiles = touched.Count();
		resp.samples = changed;
		resp.minDelta = lowDelta.ToString();
		resp.maxDelta = highDelta.ToString();
		resp.meanDelta = meanValue.ToString();
		resp.dryRun = true;
		string estimate = touched.Count().ToString() + " tiles, " + changed.ToString() + " samples changed, delta " + resp.minDelta + " to " + resp.maxDelta + " m (mean " + resp.meanDelta + ")";

		if (!wantWrite)
		{
			Answer(resp, "ok", "", "dry run: " + estimate + "; nothing was written", "call again with confirm true to write (after wb_terrain_edit backup)");
			return;
		}
		if (!WriteGate(TERRAIN_WRITE_OPEN, "P-W7-01 (U18)", true, throwaway, resp))
			return;
		if (!NotBusy(api, resp))
			return;

		string undoName = UNDO_PREFIX + "tileWrite";
		if (undoLabel != "")
			undoName += " " + undoLabel;
		if (!api.BeginTerrainAction(undoName))
		{
			Refuse(resp, TERRAIN_ACTION_REFUSED, "BeginTerrainAction answered false; nothing was written", "retry when the editor is idle");
			return;
		}
		int written = 0;
		string failure = "";
		for (int w = 0; w < touched.Count(); w++)
		{
			EMCP_WB_TerrainEditTile writeTile = touched.Get(w);
			if (!api.SetTerrainSurfaceTile(terrainIndex, writeTile.m_TileX, writeTile.m_TileY, writeTile.m_Heights))
			{
				failure = "SetTerrainSurfaceTile returned false for tile " + writeTile.m_TileX.ToString() + "," + writeTile.m_TileY.ToString();
				break;
			}
			written++;
		}
		api.EndTerrainAction(undoName);
		resp.undoName = undoName;
		if (written > 0)
			resp.dryRun = false;
		if (failure != "")
		{
			Answer(resp, "error", ENGINE_FALSE, failure + "; " + written.ToString() + " of " + touched.Count().ToString() + " tiles were written before it", "undo with wb_undo_redo, or restore from the backup");
			return;
		}
		Answer(resp, "ok", "", "wrote " + estimate + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! flatter: add or remove the entity as a terrain flattener, in one terrain action. Every argument
	//! and the entity are checked first; without confirm that is all (dry run).
	protected static void Flatter(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		string op = req.op;
		if (op != "add" && op != "remove")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "op must be add or remove, got '" + op + "'; nothing was written", "op add or remove");
			return;
		}
		if (req.entity == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "entity required; nothing was written", "an entity reference (wb_entity list)");
			return;
		}
		bool adding = op == "add";
		vector boxMin = vector.Zero;
		vector boxMax = vector.Zero;
		int priority = 0;
		float falloffStart = 0;
		float falloffEnd = 0;
		if (adding)
		{
			string minWhy = "";
			string maxWhy = "";
			if (!EMCP_WB_Common.ParseVectorString(req.mins, boxMin, minWhy))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "mins: " + minWhy + "; nothing was written", "mins as \"x y z\" local to the entity");
				return;
			}
			if (!EMCP_WB_Common.ParseVectorString(req.maxs, boxMax, maxWhy))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "maxs: " + maxWhy + "; nothing was written", "maxs as \"x y z\" local to the entity");
				return;
			}
			for (int axis = 0; axis < 3; axis++)
			{
				if (boxMin[axis] > boxMax[axis])
				{
					Answer(resp, "error", INVALID_ARGUMENT, "mins must not exceed maxs on any axis (axis " + axis.ToString() + "); nothing was written", "swap or fix mins and maxs");
					return;
				}
			}
			priority = req.priority;
			if (req.falloffStart != "" && (!EMCP_WB_Common.ParseFloat(req.falloffStart, falloffStart) || falloffStart < 0))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "falloffStart must be a number of 0 or more, got '" + req.falloffStart + "'; nothing was written", "falloffStart in metres as text");
				return;
			}
			if (req.falloff != "" && (!EMCP_WB_Common.ParseFloat(req.falloff, falloffEnd) || falloffEnd < 0))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "falloff must be a number of 0 or more, got '" + req.falloff + "'; nothing was written", "falloff in metres as text");
				return;
			}
		}
		bool wantWrite = req.confirm;

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		bool throwaway = false;
		if (!ProjectWorld(api, resp, throwaway))
			return;
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.entity, resolved))
		{
			Answer(resp, "error", resolved.m_Code, resolved.m_Why, "list the entities (wb_entity list) and pass the id: it answers");
			return;
		}
		IEntitySource src = resolved.m_Src;
		if (!src)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "the reference resolved to no entity source", "list the entities (wb_entity list) and pass the id: it answers");
			return;
		}
		IEntity ent = api.SourceToEntity(src);
		if (!ent)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "the entity has no runtime entity (SourceToEntity returned null); nothing was written", "read the entity with wb_entity get");
			return;
		}
		resp.id = EMCP_WB_EntityRef.Format(src);
		resp.dryRun = true;

		if (!wantWrite)
		{
			Answer(resp, "ok", "", "dry run: would " + op + " " + resp.id + " as a terrain flattener; nothing was written", "call again with confirm true to write (after wb_terrain_edit backup)");
			return;
		}
		if (!WriteGate(FLATTER_OPEN, "P-W7-06", true, throwaway, resp))
			return;
		if (!NotBusy(api, resp))
			return;

		string undoName = UNDO_PREFIX + "flatter";
		if (!api.BeginTerrainAction(undoName))
		{
			Refuse(resp, TERRAIN_ACTION_REFUSED, "BeginTerrainAction answered false; nothing was written", "retry when the editor is idle");
			return;
		}
		if (adding)
			api.AddTerrainFlatterEntity(ent, boxMin, boxMax, priority, falloffStart, falloffEnd, true);
		else
			api.RemoveTerrainFlatterEntity(ent, true);
		api.EndTerrainAction(undoName);
		resp.undoName = undoName;
		resp.dryRun = false;
		Answer(resp, "ok", "", op + " " + resp.id + " as a terrain flattener; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! maps: shore (BuildShoreMap) or flow (RegenerateFlowMaps(preview, save true, synchronous, no
	//! warning dialog)) maps of the open world. They overwrite the map files and leave no undo point.
	protected static void BuildMaps(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		string kind = req.kind;
		if (kind != "shore" && kind != "flow")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "kind must be shore or flow, got '" + kind + "'; nothing was written", "kind shore or flow");
			return;
		}
		bool preview = req.preview;
		bool wantWrite = req.confirm;

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		bool throwaway = false;
		if (!ProjectWorld(api, resp, throwaway))
			return;
		resp.dryRun = true;
		resp.built = false;

		string engineCall = "BuildShoreMap";
		if (kind == "flow")
			engineCall = "RegenerateFlowMaps";
		if (!wantWrite)
		{
			Answer(resp, "ok", "", "dry run: would run " + engineCall + " and overwrite the world's " + kind + " map files (no undo); nothing was written", "call again with confirm true (after wb_terrain_edit backup)");
			return;
		}
		if (!WriteGate(MAPS_OPEN, "P-W7-07", true, throwaway, resp))
			return;
		if (!NotBusy(api, resp))
			return;

		if (kind == "shore")
			api.BuildShoreMap();
		else
			api.RegenerateFlowMaps(preview, true, false, true);
		resp.built = true;
		resp.dryRun = false;
		Answer(resp, "ok", "", engineCall + " ran; the " + kind + " map files were overwritten (no undo: restore from the backup to go back)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! exportMasks: ExportSurfaceMasks of one terrain into a new project folder. The folder must not
	//! exist yet: without a file read the handler cannot see whether an existing folder is empty.
	protected static void ExportMasks(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		string directory = req.directory;
		if (directory == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "directory required; nothing was written", "a new project-relative folder");
			return;
		}
		int terrainIndex = req.terrainIndex;
		if (terrainIndex < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "terrainIndex must not be negative; nothing was written", "omit terrainIndex for 0");
			return;
		}
		bool wantWrite = req.confirm;

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		string absDir = "";
		string why = "";
		if (!EMCP_WB_Guard.NewTargetInProject(directory, absDir, why))
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was written", "a project-relative folder whose parent exists");
			return;
		}
		string clean = "";
		string cleanWhy = "";
		EMCP_WB_Guard.CleanRelative(directory, clean, cleanWhy);
		string existing = "";
		if (Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the folder " + clean + " exists already; masks go to a new folder only (the handler reads no file, so it cannot see whether the folder is empty); nothing was written", "pass a folder that does not exist yet");
			return;
		}
		if (api.GetTerrainTilesX(terrainIndex) <= 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "terrain " + terrainIndex.ToString() + " has no tiles; nothing was written", "read the terrain with wb_terrain info");
			return;
		}
		resp.dryRun = true;
		resp.exported = false;

		if (!wantWrite)
		{
			Answer(resp, "ok", "", "dry run: would export the surface masks of terrain " + terrainIndex.ToString() + " to " + clean + "; nothing was written", "call again with confirm true");
			return;
		}
		if (!WriteGate(MASKS_OPEN, "P-W7-08", false, false, resp))
			return;
		if (!NotBusy(api, resp))
			return;

		bool done = api.ExportSurfaceMasks(terrainIndex, absDir);
		resp.exported = done;
		resp.dryRun = false;
		if (!done)
		{
			Answer(resp, "error", ENGINE_FALSE, "ExportSurfaceMasks returned false for terrain " + terrainIndex.ToString() + " into " + clean, "read the World Editor log");
			return;
		}
		Answer(resp, "ok", "", "exported the surface masks of terrain " + terrainIndex.ToString() + " to " + clean, "");
	}

	//------------------------------------------------------------------------------------------------
	//! brush: served by the TS tool (tileRead, the brush maths, then tileWrite); nothing is done here.
	protected static void RefuseBrush(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		Answer(resp, "error", INVALID_ARGUMENT, "brush (" + req.mode + " at " + req.centre + ", radius " + req.radius + ") is served by the wb_terrain_edit tool, which reads tiles, computes the heights and calls tileWrite; the handler does nothing for it", "call wb_terrain_edit brush through the MCP tool");
	}

	//------------------------------------------------------------------------------------------------
	//! backup: served by the TS tool (it copies the terrain file set); the handler reads no file.
	protected static void RefuseBackup(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		Answer(resp, "error", INVALID_ARGUMENT, "backup ('" + req.label + "') is served by the wb_terrain_edit tool, which copies the terrain files; the handler reads no file", "call wb_terrain_edit backup through the MCP tool");
	}

	//------------------------------------------------------------------------------------------------
	//! restore: served by the TS tool (it copies a backup back); the handler writes no file.
	protected static void RefuseRestore(EMCP_WB_TerrainEditRequest req, EMCP_WB_TerrainEditResponse resp)
	{
		Answer(resp, "error", INVALID_ARGUMENT, "restore of backup '" + req.backupId + "' is served by the wb_terrain_edit tool, which copies the backup back; the handler writes no file", "call wb_terrain_edit restore through the MCP tool");
	}
}
