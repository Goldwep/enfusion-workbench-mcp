/**
 * EMCP_WB_WorldTools.c - Handler of wb_world_tools (wave W6, phase5-w6-spec.md section 2.2, DEC-069 OD-1)
 *
 * Dialog-free ports of vanilla World Editor plugins and tools. Called via NET API TCP protocol:
 * APIFunc = "EMCP_WB_WorldTools", dispatching on "action":
 *   exportObjects    entities as Object Import rows "prefab;x y z;qx qy qz qw;scale", paged
 *                    (the SCR_ObjectImportPlugin convention, inverted)
 *   floaters         entities whose bottom sits off the terrain (SCR_FloatersFinderPlugin without
 *                    Sleep, the debug sphere, the selection change or the output file), read only
 *   stats            counts per prefab, per layer and on a grid (SCR_WorldEntitiesStatisticsPlugin
 *                    without its dialog, files, image or notepad), paged
 *   goToCoords       served by the TS tool (parse, wb_terrain heights, wb_view setCamera); the
 *                    handler answers that it does not serve it
 *   importObjects    CreateEntity per import row, at most 200 (SCR_ObjectImportPlugin.ImportData:
 *                    z flipped, quaternion z and w negated, yaw and pitch swapped), no FileIO
 *   snapToTerrain    SCR_TerrainHelper.SnapAndOrientToTerrain per entity (SCR_SnapAndOrientToTerrainPlugin)
 *   resetFlags       Flags back to the prefab's (SCR_EntityFlagsManagerPlugin without its dialog or
 *                    progress bar): ClearVariableValue when equal to the prefab, else SetVariableValue
 *   replaceEntities  each named entity swapped for a prefab, children kept (SCR_EntityReplacerTool;
 *                    the caller computes the pairs, OD-10), at most 200 pairs
 *
 * Every action needs a World Editor with a loaded world, not in play mode (NO_WORLD, WRONG_MODE;
 * EMCP_WB_Common.NoWorldReason before any other World Editor call). Workbench.GetModule opens a
 * closed World Editor: the answer says so when the module had to be asked for.
 * Mutating actions need the project found (EMCP_WB_Guard.IsProjectFound, DEC-058), and run as one
 * BeginEntityAction / EndEntityAction with an undo name (no confirm, DEC-061 OD-3), so wb_undo_redo
 * reverts the whole call. Nothing here opens a file, a dialog or a progress bar, or writes a file.
 * Entities are named by the W1 reference (EMCP_WB_EntityRef: id:<hex> | name:<name> | index:<i>);
 * references that name no entity land in missing. Prefabs are {GUID}path resource names checked
 * by their GUID (Workbench.GetResourceName("{GUID}")), never by GetAbsolutePath (packed files).
 * Floats travel as text and are parsed with EMCP_WB_Common.ParseFloat (W1 live lesson).
 * Paging: cursor "<start>:<count>", count = the total at the first read; a changed total answers
 * STALE_CURSOR. limit default 50, max 200.
 * Keys: contracts/EMCP_WB_WorldTools.json.
 */

class EMCP_WB_WorldToolsRequest : JsonApiStruct
{
	string action;
	//! exportObjects, floaters, snapToTerrain, resetFlags: entity refs (default: the selection)
	ref array<string> entities;
	//! exportObjects: layer path whose entities are exported; importObjects: target layer
	string layer;
	//! exportObjects, stats: "<start>:<count>" from nextCursor
	string cursor;
	//! exportObjects, stats: rows per page; floaters: most hits answered
	int limit;
	//! floaters: metres around the camera when no refs and no selection, as text
	string radius;
	//! floaters, stats: only the active layer
	bool activeLayerOnly;
	//! floaters: trees and bushes too
	bool vegetation;
	//! floaters: also report entities sunk under the terrain
	bool belowTerrain;
	//! floaters: the gap band that counts as floating, metres as text
	string minOffset;
	string maxOffset;
	//! stats: grid cells per side (0 = no grid)
	int gridSize;
	//! importObjects: "prefab;x y z;qx qy qz qw;scale"
	ref array<string> rows;
	//! importObjects: y is above the terrain
	bool relativeY;
	//! resetFlags: every editor entity (OD-6: never the silent default)
	bool allWorld;
	//! resetFlags: EntityFlags names
	ref array<string> flags;
	//! resetFlags: rocks, trees, bushes, buildings, or any
	ref array<string> categories;
	//! resetFlags: child entities too
	bool includeChildren;
	//! replaceEntities: "ref=prefab"
	ref array<string> pairs;
	//! replaceEntities: re-parent the children to the replacement (default true)
	bool keepChildren;
	//! goToCoords: the link or coordinates (served by the TS tool)
	string text;
	//! floaters: also report entities under the ocean level
	bool belowWater;
	//! importObjects: a project CSV the TS tool reads into rows (the handler never reads a file)
	string path;

	void EMCP_WB_WorldToolsRequest()
	{
		entities = {};
		rows = {};
		flags = {};
		categories = {};
		pairs = {};

		RegV("action");
		RegV("entities");
		RegV("layer");
		RegV("cursor");
		RegV("limit");
		RegV("radius");
		RegV("activeLayerOnly");
		RegV("vegetation");
		RegV("belowTerrain");
		RegV("minOffset");
		RegV("maxOffset");
		RegV("gridSize");
		RegV("rows");
		RegV("relativeY");
		RegV("allWorld");
		RegV("flags");
		RegV("categories");
		RegV("includeChildren");
		RegV("pairs");
		RegV("keepChildren");
		RegV("text");
		RegV("belowWater");
		RegV("path");

		// Defaults for keys the request leaves out.
		limit = 0;
		gridSize = 0;
		keepChildren = true;
	}
}

class EMCP_WB_WorldToolsResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string action;
	string code;
	string message;
	string next;
	int total;
	string nextCursor;
	//! exportObjects: import rows; floaters: "id;gap;reason"; stats: "prefab;count"
	ref array<string> rows;
	//! stats: "layer;count"
	ref array<string> layers;
	//! stats: one line of counts per grid row, north first, west to east
	ref array<string> grid;
	//! stats: grid cell size in metres, as text
	string cellSize;
	int scanned;
	int created;
	int moved;
	int changed;
	int cleared;
	int replaced;
	ref array<string> ids;
	ref array<string> missing;
	//! "index;reason" (importObjects) or "ref;reason"
	ref array<string> failed;
	string undoName;

	void EMCP_WB_WorldToolsResponse()
	{
		rows = {};
		layers = {};
		grid = {};
		ids = {};
		missing = {};
		failed = {};

		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("next");
		RegV("total");
		RegV("nextCursor");
		RegV("rows");
		RegV("layers");
		RegV("grid");
		RegV("cellSize");
		RegV("scanned");
		RegV("created");
		RegV("moved");
		RegV("changed");
		RegV("cleared");
		RegV("replaced");
		RegV("ids");
		RegV("missing");
		RegV("failed");
		RegV("undoName");
	}
}

//! The world query callback floaters owns (BaseWorld.QueryEntitiesBySphere calls AddEntity per entity).
class EMCP_WB_WorldToolsQuery
{
	ref array<IEntity> m_Found;
	int m_Cap;

	void EMCP_WB_WorldToolsQuery(int cap)
	{
		m_Found = {};
		m_Cap = cap;
	}

	//! QueryEntitiesCallback: keeps the entity; false stops the query once the cap is reached.
	bool AddEntity(IEntity e)
	{
		if (m_Found.Count() >= m_Cap)
			return false;
		if (e)
			m_Found.Insert(e);
		return true;
	}
}

//! One parsed import row (importObjects): validated before the entity action opens.
class EMCP_WB_WorldToolsImportRow
{
	int m_Index;
	string m_Prefab;
	vector m_Pos;
	float m_Qx;
	float m_Qy;
	float m_Qz;
	float m_Qw;
	float m_Scale;
}

//! One planned replacement (replaceEntities). The engine pointer members carry no ref, as
//! EMCP_WB_EntityRefResult.m_Src.
class EMCP_WB_WorldToolsSwap
{
	string m_Ref;
	string m_Prefab;
	IEntitySource m_Old;
	IEntitySource m_New;
	string m_Name;
}

//! One planned Flags change (resetFlags).
class EMCP_WB_WorldToolsFlagEdit
{
	IEntitySource m_Src;
	int m_NewFlags;
	bool m_Clear;
	bool m_Set;
	bool m_Changed;
	bool m_MoveY;
	vector m_Coords;
}

class EMCP_WB_WorldTools : NetApiHandler
{
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! Entity refs one call takes at most.
	static const int MAX_REFS = 200;
	//! Import rows and replace pairs one call takes at most (spec section 2.2).
	static const int MAX_ROWS = 200;
	//! Entities the floaters sphere collects at most before it stops.
	static const int MAX_QUERY = 20000;
	//! stats grid cells per side at most.
	static const int MAX_GRID = 64;
	//! resetFlags: child levels walked at most, and child entities added at most.
	static const int MAX_DEPTH = 16;
	static const int MAX_CHILDREN = 20000;
	static const float RADIUS_DEFAULT = 1000;
	static const float RADIUS_MAX = 5000;
	static const float MIN_OFFSET_DEFAULT = 0.05;
	static const float MAX_OFFSET_DEFAULT = 100;
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string NO_WORLD = "NO_WORLD";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string NO_TERRAIN = "NO_TERRAIN";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string FLAGS_KEY = "Flags";
	static const string HEX_DIGITS = "0123456789abcdefABCDEF";
	//! The four category bases of SCR_EntityFlagsManagerPlugin (its ROCK_BASE, TREE_BASE, BUSH_BASE, BUILDING_BASE).
	static const string ROCK_BASE = "{B94DDC61F0B7F9D7}Prefabs/Rocks/Rock_Base.et";
	static const string TREE_BASE = "{388AE316D09D0680}Prefabs/Vegetation/Core/Tree_Base.et";
	static const string BUSH_BASE = "{D7163D1B571F4C0C}Prefabs/Vegetation/Core/Bush_Base.et";
	static const string BUILDING_BASE = "{A43A100E3C377DB2}Prefabs/Structures/Core/Building_Base.et";
	//! Undo history point names (BeginEntityAction).
	static const string UNDO_IMPORT = "EMCP wb_world_tools importObjects";
	static const string UNDO_SNAP = "EMCP wb_world_tools snapToTerrain";
	static const string UNDO_FLAGS = "EMCP wb_world_tools resetFlags";
	static const string UNDO_REPLACE = "EMCP wb_world_tools replaceEntities";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_WorldToolsRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_WorldToolsRequest req = EMCP_WB_WorldToolsRequest.Cast(request);
		EMCP_WB_WorldToolsResponse resp = new EMCP_WB_WorldToolsResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "exportObjects")
			ExportObjects(req, resp);
		else if (req.action == "floaters")
			Floaters(req, resp);
		else if (req.action == "stats")
			Stats(req, resp);
		else if (req.action == "goToCoords")
			GoToCoords(req, resp);
		else if (req.action == "importObjects")
			ImportObjects(req, resp);
		else if (req.action == "snapToTerrain")
			SnapToTerrain(req, resp);
		else if (req.action == "resetFlags")
			ResetFlags(req, resp);
		else if (req.action == "replaceEntities")
			ReplaceEntities(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of exportObjects, floaters, stats, goToCoords, importObjects, snapToTerrain, resetFlags, replaceEntities");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_WorldToolsResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_WorldToolsResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API of a loaded world not in play mode, or null with the error written.
	//! Workbench.GetModule opens a closed World Editor (DEC-053): a null module answers
	//! MODULE_NOT_OPEN; the shared world check runs before any other World Editor call.
	protected static WorldEditorAPI Api(EMCP_WB_WorldToolsResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Answer(resp, "error", "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null (GetModule opens a closed World Editor; this one did not open)", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			Answer(resp, "error", NO_WORLD, "the World Editor has no API: no world is open (GetModule may have opened the World Editor)", "open a world (wb_module setResource)");
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Answer(resp, "error", NO_WORLD, noWorld, "open a world (wb_module setResource)");
			return null;
		}
		if (api.IsGameMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in play mode; nothing was read or changed", "stop play first (wb_world stop)");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of an in-memory edit, in order: the project is found (DEC-058), then Api.
	protected static WorldEditorAPI EditApi(EMCP_WB_WorldToolsResponse resp)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "mutating actions need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return null;
		}
		return Api(resp);
	}

	//------------------------------------------------------------------------------------------------
	//! True when the World Editor is editing a prefab, not a world (floaters and snapToTerrain need
	//! terrain). Called only after Api answered a loaded world.
	protected static bool InPrefabEdit()
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
			return false;
		return worldEditor.IsPrefabEditMode();
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, so EndEntityAction never closes an action this handler did
	//! not begin.
	protected static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_WorldToolsResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		resp.undoName = "";
		Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The entities a call works on: the refs when given (resolved, no duplicates; refs naming no
	//! entity go to missingRefs), else the World Editor selection. False with code and why when the
	//! list is too long or a ref is malformed (nothing is done then).
	protected static bool Targets(WorldEditorAPI api, array<string> refs, notnull array<IEntitySource> found, notnull array<string> missingRefs, out string code, out string why)
	{
		code = "";
		why = "";
		if (refs && refs.Count() > 0)
		{
			if (refs.Count() > MAX_REFS)
			{
				code = INVALID_ARGUMENT;
				why = "entities holds " + refs.Count().ToString() + " references, at most " + MAX_REFS.ToString();
				return false;
			}
			EMCP_WB_EntityRefResolver resolver = new EMCP_WB_EntityRefResolver(api);
			for (int i = 0; i < refs.Count(); i++)
			{
				string entityRef = refs.Get(i);
				EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
				if (resolver.Resolve(entityRef, resolved))
				{
					IEntitySource src = resolved.m_Src;
					if (found.Find(src) < 0)
						found.Insert(src);
					continue;
				}
				if (resolved.m_Code == EMCP_WB_EntityRef.ENTITY_NOT_FOUND)
				{
					missingRefs.Insert(entityRef);
					continue;
				}
				code = resolved.m_Code;
				why = "entities[" + i.ToString() + "]: " + resolved.m_Why;
				return false;
			}
			return true;
		}
		int selected = api.GetSelectedEntitiesCount();
		for (int s = 0; s < selected; s++)
		{
			IEntitySource selSrc = api.GetSelectedEntity(s);
			if (selSrc && found.Find(selSrc) < 0)
				found.Insert(selSrc);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The parent entity source of an entity, null for a top-level one.
	static IEntitySource ParentOf(IEntitySource src)
	{
		if (!src)
			return null;
		BaseContainer parentCont = src.GetParent();
		if (!parentCont)
			return null;
		return parentCont.ToEntitySource();
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name of an entity's prefab (its ancestor), "" when it has none.
	static string PrefabOf(IEntitySource src)
	{
		if (!src)
			return "";
		BaseContainer ancestorCont = src.GetAncestor();
		if (!ancestorCont)
			return "";
		ResourceName resourceName = ancestorCont.GetResourceName();
		string text = resourceName;
		return text;
	}

	//------------------------------------------------------------------------------------------------
	//! The Flags of an entity source as an int, 0 when it has none.
	static int FlagsOf(BaseContainer cont)
	{
		int flagsValue = 0;
		if (cont)
			cont.Get(FLAGS_KEY, flagsValue);
		return flagsValue;
	}

	//------------------------------------------------------------------------------------------------
	//! True for 1 to 9 decimal digits.
	static bool IsDigits(string text)
	{
		int len = text.Length();
		if (len < 1 || len > 9)
			return false;
		for (int i = 0; i < len; i++)
		{
			if (!text.IsDigitAt(i))
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! One page of total items: start and end of the page, or false with code and why. A cursor
	//! whose count is not the current total answers STALE_CURSOR.
	static bool PageBounds(string cursorText, int pageLimit, int total, out int start, out int end, out string code, out string why)
	{
		start = 0;
		end = 0;
		code = "";
		why = "";
		if (cursorText != "")
		{
			int colon = cursorText.IndexOf(":");
			if (colon <= 0 || colon >= cursorText.Length() - 1)
			{
				code = INVALID_ARGUMENT;
				why = "cursor must be <start>:<count> as nextCursor answered, got '" + cursorText + "'";
				return false;
			}
			string startText = cursorText.Substring(0, colon);
			string countText = cursorText.Substring(colon + 1, cursorText.Length() - colon - 1);
			if (!IsDigits(startText) || !IsDigits(countText) || startText.ToInt() > countText.ToInt())
			{
				code = INVALID_ARGUMENT;
				why = "cursor must be <start>:<count> as nextCursor answered, got '" + cursorText + "'";
				return false;
			}
			if (countText.ToInt() != total)
			{
				code = STALE_CURSOR;
				why = "the cursor was issued for " + countText + " items, the list now has " + total.ToString();
				return false;
			}
			start = startText.ToInt();
		}
		int pageSize = pageLimit;
		if (pageSize <= 0)
			pageSize = PAGE_DEFAULT;
		if (pageSize > PAGE_MAX)
			pageSize = PAGE_MAX;
		end = start + pageSize;
		if (end > total)
			end = total;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A float given as text, or fallback when the text is empty. False with why on anything else.
	static bool FloatOr(string text, float fallback, string label, out float result, out string why)
	{
		result = fallback;
		why = "";
		if (text == "")
			return true;
		float parsed = 0;
		if (!EMCP_WB_Common.ParseFloat(text, parsed))
		{
			why = label + " must be a number as text, got '" + text + "'";
			return false;
		}
		result = parsed;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name a "{GUID}path" (or "{GUID}") prefab names, looked up by its GUID in the
	//! resource database (packed vanilla prefabs do not resolve through GetAbsolutePath).
	//! Workbench.GetResourceName answers the GUID unchanged for an unknown one. "" with why when the
	//! text is not a GUID form, the GUID is unknown, the resource is not a prefab (.et), or the
	//! database names another path for it.
	static string KnownPrefab(string text, out string why)
	{
		why = "";
		string given = text.Trim();
		if (given.Length() < 18 || given.Get(0) != "{" || given.Get(17) != "}")
		{
			why = "a prefab is {GUID}path (16 hex digits in braces), got '" + text + "'";
			return "";
		}
		for (int i = 1; i < 17; i++)
		{
			if (HEX_DIGITS.IndexOf(given.Get(i)) < 0)
			{
				why = "a prefab GUID is 16 hex digits, got '" + given.Substring(0, 18) + "'";
				return "";
			}
		}
		string braced = given.Substring(0, 18);
		ResourceName known = Workbench.GetResourceName(braced);
		string knownText = known;
		if (knownText == "" || knownText == braced)
		{
			why = "no resource has the GUID " + braced;
			return "";
		}
		string givenPath = given.Substring(18, given.Length() - 18);
		string knownPath = known.GetPath();
		// The path that decides the type: the database's, else the one given, else the whole name.
		string typedPath = knownPath;
		if (typedPath == "")
			typedPath = givenPath;
		if (typedPath == "")
			typedPath = knownText;
		if (!IsPrefabPath(typedPath))
		{
			why = typedPath + " is not a prefab (.et)";
			return "";
		}
		if (givenPath == "")
			return knownText;
		if (knownPath == "")
			return given;
		string wantedLower = givenPath;
		wantedLower.ToLower();
		string knownLower = knownPath;
		knownLower.ToLower();
		if (wantedLower != knownLower)
		{
			why = "the GUID " + braced + " names " + knownText + ", not " + givenPath;
			return "";
		}
		return given;
	}

	//------------------------------------------------------------------------------------------------
	//! True when the path ends in ".et", case folded: only a prefab is imported or replaced with.
	static bool IsPrefabPath(string path)
	{
		string lower = path.Trim();
		lower.ToLower();
		return lower.EndsWith(".et");
	}

	//------------------------------------------------------------------------------------------------
	//! The Object Import row of an entity: "prefab;x y z;qx qy qz qw;scale", the inverse of
	//! SCR_ObjectImportPlugin.ImportData (world z negated, quaternion z and w negated). "" when the
	//! entity has no prefab or no runtime entity. [unverified] the round trip is probe P-W6-07.
	static string ExportRow(WorldEditorAPI api, IEntitySource src)
	{
		string prefab = PrefabOf(src);
		if (prefab == "")
			return "";
		IEntity ent = api.SourceToEntity(src);
		if (!ent)
			return "";
		vector mat[4];
		ent.GetWorldTransform(mat);
		float scaleValue = mat[0].Length();
		if (scaleValue <= 0)
			scaleValue = 1;
		vector rot[3];
		rot[0] = mat[0].Normalized();
		rot[1] = mat[1].Normalized();
		rot[2] = mat[2].Normalized();
		float quat[4];
		Math3D.MatrixToQuat(rot, quat);
		vector pos = mat[3];
		float csvZ = -pos[2];
		float csvQz = -quat[2];
		float csvQw = -quat[3];
		string row = prefab + ";" + pos[0].ToString() + " " + pos[1].ToString() + " " + csvZ.ToString();
		row = row + ";" + quat[0].ToString() + " " + quat[1].ToString() + " " + csvQz.ToString() + " " + csvQw.ToString();
		row = row + ";" + scaleValue.ToString();
		return row;
	}

	//------------------------------------------------------------------------------------------------
	//! exportObjects: the refs, a layer's entities or the selection as import rows, paged.
	protected static void ExportObjects(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		WorldEditorAPI api = Api(resp);
		if (!api)
			return;
		bool hasRefs = req.entities && req.entities.Count() > 0;
		if (hasRefs && req.layer != "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "give entities or layer, not both", "one source of entities per call");
			return;
		}

		array<IEntitySource> candidates = {};
		if (req.layer != "")
		{
			int subScene = api.GetCurrentSubScene();
			int layerId = EMCP_WB_LayersUtil.LayerIdOf(api, subScene, req.layer);
			if (layerId < 0)
			{
				Answer(resp, "error", PATH_NOT_FOUND, "no layer '" + req.layer + "' in sub-scene " + subScene.ToString(), "list the layers (wb_layers list)");
				return;
			}
			int count = api.GetEditorEntityCount();
			for (int i = 0; i < count; i++)
			{
				IEntitySource layerSrc = api.GetEditorEntity(i);
				if (layerSrc && layerSrc.GetSubScene() == subScene && layerSrc.GetLayerID() == layerId)
					candidates.Insert(layerSrc);
			}
		}
		else
		{
			string code = "";
			string why = "";
			if (!Targets(api, req.entities, candidates, resp.missing, code, why))
			{
				Answer(resp, "error", code, why, "pass entity references as wb_entity list answers them");
				return;
			}
			if (candidates.Count() == 0 && resp.missing.Count() == 0)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "no entities given, no layer given and nothing is selected", "pass entities, a layer, or select entities first");
				return;
			}
		}

		// Only entities with a prefab and a runtime entity make an import row.
		array<IEntitySource> items = {};
		int skipped = 0;
		for (int c = 0; c < candidates.Count(); c++)
		{
			IEntitySource candidate = candidates.Get(c);
			if (PrefabOf(candidate) != "" && api.SourceToEntity(candidate))
				items.Insert(candidate);
			else
				skipped++;
		}

		int total = items.Count();
		int start = 0;
		int end = 0;
		string pageCode = "";
		string pageWhy = "";
		if (!PageBounds(req.cursor, req.limit, total, start, end, pageCode, pageWhy))
		{
			Answer(resp, "error", pageCode, pageWhy, "read again without a cursor");
			return;
		}
		resp.total = total;
		for (int r = start; r < end; r++)
			resp.rows.Insert(ExportRow(api, items.Get(r)));
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();
		int shown = end - start;
		Answer(resp, "ok", "", "export rows: " + shown.ToString() + " of " + total.ToString() + " (" + skipped.ToString() + " without a prefab skipped)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! floaters: entities whose bounding box bottom sits between minOffset and maxOffset above the
	//! terrain (and, when asked, sunk or under water). The refs, else the selection, else a sphere of
	//! radius around the camera (child entities skipped there). Read only: nothing is selected.
	protected static void Floaters(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		float radiusValue = RADIUS_DEFAULT;
		float minValue = MIN_OFFSET_DEFAULT;
		float maxValue = MAX_OFFSET_DEFAULT;
		string parseWhy = "";
		if (!FloatOr(req.radius, RADIUS_DEFAULT, "radius", radiusValue, parseWhy) || !FloatOr(req.minOffset, MIN_OFFSET_DEFAULT, "minOffset", minValue, parseWhy) || !FloatOr(req.maxOffset, MAX_OFFSET_DEFAULT, "maxOffset", maxValue, parseWhy))
		{
			Answer(resp, "error", INVALID_ARGUMENT, parseWhy, "numbers as text");
			return;
		}
		if (radiusValue <= 0 || radiusValue > RADIUS_MAX)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "radius must be above 0 and at most " + RADIUS_MAX.ToString() + ", got " + radiusValue.ToString(), "a radius in metres");
			return;
		}
		if (minValue >= maxValue)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "minOffset must be below maxOffset", "minOffset < maxOffset");
			return;
		}
		int hitCap = req.limit;
		if (hitCap <= 0)
			hitCap = PAGE_DEFAULT;
		if (hitCap > PAGE_MAX)
			hitCap = PAGE_MAX;

		WorldEditorAPI api = Api(resp);
		if (!api)
			return;
		if (InPrefabEdit())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is editing a prefab, not a world", "open a world (wb_module setResource)");
			return;
		}
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Answer(resp, "error", NO_WORLD, "GetWorld returned null", "open a world (wb_module setResource)");
			return;
		}

		array<IEntitySource> candidates = {};
		string code = "";
		string why = "";
		if (!Targets(api, req.entities, candidates, resp.missing, code, why))
		{
			Answer(resp, "error", code, why, "pass entity references as wb_entity list answers them");
			return;
		}
		bool bySphere = candidates.Count() == 0 && resp.missing.Count() == 0;
		if (bySphere)
		{
			vector cameraMat[4];
			world.GetCurrentCamera(cameraMat);
			EMCP_WB_WorldToolsQuery collector = new EMCP_WB_WorldToolsQuery(MAX_QUERY);
			world.QueryEntitiesBySphere(cameraMat[3], radiusValue, collector.AddEntity, null, EQueryEntitiesFlags.ALL);
			set<IEntitySource> seen = new set<IEntitySource>();
			for (int q = 0; q < collector.m_Found.Count(); q++)
			{
				IEntitySource hitSrc = api.EntityToSource(collector.m_Found.Get(q));
				if (!hitSrc || ParentOf(hitSrc))
					continue;
				if (seen.Insert(hitSrc))
					candidates.Insert(hitSrc);
			}
		}

		int currentSub = api.GetCurrentSubScene();
		int currentLayer = api.GetCurrentEntityLayerId();
		bool ocean = world.IsOcean();
		float oceanHeight = world.GetOceanBaseHeight();
		int noTerrain = 0;
		int scannedCount = 0;
		int hits = 0;
		for (int i = 0; i < candidates.Count(); i++)
		{
			IEntitySource src = candidates.Get(i);
			if (req.activeLayerOnly && (src.GetSubScene() != currentSub || src.GetLayerID() != currentLayer))
				continue;
			IEntity ent = api.SourceToEntity(src);
			if (!ent)
				continue;
			if (ShapeEntity.Cast(ent) || LakeGeneratorEntity.Cast(ent) || GenericTerrainEntity.Cast(ent))
				continue;
			bool isVegetation = Tree.Cast(ent) != null;
			if (isVegetation && !req.vegetation)
				continue;
			vector origin = ent.GetOrigin();
			float terrainY = 0;
			if (!api.TryGetTerrainSurfaceY(origin[0], origin[2], terrainY))
			{
				noTerrain++;
				continue;
			}
			scannedCount++;
			vector mins = vector.Zero;
			vector maxs = vector.Zero;
			ent.GetWorldBounds(mins, maxs);
			bool hasBounds = mins != maxs;

			string reason = "";
			float gap = 0;
			if (req.belowWater && ocean && oceanHeight > origin[1])
			{
				reason = "underwater";
				gap = origin[1] - oceanHeight;
			}
			else if (req.belowTerrain && hasBounds && maxs[1] < terrainY)
			{
				reason = "sunk";
				gap = maxs[1] - terrainY;
			}
			else
			{
				// Vegetation by its origin's altitude (as the plugin), anything else by its bounds' bottom.
				gap = origin[1] - terrainY;
				if (hasBounds && !isVegetation)
					gap = mins[1] - terrainY;
				if (gap >= minValue && gap <= maxValue)
					reason = "floating";
			}
			if (reason == "")
				continue;
			hits++;
			if (resp.rows.Count() < hitCap)
				resp.rows.Insert(EMCP_WB_EntityRef.Format(src) + ";" + gap.ToString() + ";" + reason);
		}
		resp.scanned = scannedCount;
		resp.total = hits;
		if (scannedCount == 0 && noTerrain > 0)
		{
			Answer(resp, "error", NO_TERRAIN, "no terrain under any of the " + noTerrain.ToString() + " entities", "open a world with a terrain");
			return;
		}
		string source = "the given entities";
		if (bySphere)
			source = "a " + radiusValue.ToString() + " m sphere around the camera";
		else if (!req.entities || req.entities.Count() == 0)
			source = "the selection";
		Answer(resp, "ok", "", "floaters: " + hits.ToString() + " of " + scannedCount.ToString() + " scanned in " + source + " (" + resp.rows.Count().ToString() + " answered)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! The sort key of a prefab count: larger counts first, then the name.
	static string CountKey(int count, string label)
	{
		int inverse = 999999999 - count;
		string digits = inverse.ToString();
		while (digits.Length() < 9)
			digits = "0" + digits;
		return digits + "|" + label;
	}

	//------------------------------------------------------------------------------------------------
	//! stats: counts per prefab (paged, largest first), per layer and on a gridSize x gridSize grid of
	//! the terrain bounds. layers and grid come with the first page. No file, no dialog.
	protected static void Stats(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		if (req.gridSize < 0 || req.gridSize > MAX_GRID)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "gridSize must be 0 to " + MAX_GRID.ToString() + ", got " + req.gridSize.ToString(), "0 for no grid");
			return;
		}
		WorldEditorAPI api = Api(resp);
		if (!api)
			return;

		int cells = req.gridSize;
		vector terrainMin = vector.Zero;
		vector terrainMax = vector.Zero;
		float cellX = 0;
		float cellZ = 0;
		array<int> gridCounts = {};
		if (cells > 0)
		{
			WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
			if (!worldEditor || !worldEditor.GetTerrainBounds(terrainMin, terrainMax) || terrainMax[0] <= terrainMin[0] || terrainMax[2] <= terrainMin[2])
			{
				Answer(resp, "error", NO_TERRAIN, "GetTerrainBounds gave no terrain extent; no grid can be made", "gridSize 0, or open a world with a terrain");
				return;
			}
			cellX = (terrainMax[0] - terrainMin[0]) / cells;
			cellZ = (terrainMax[2] - terrainMin[2]) / cells;
			gridCounts.Resize(cells * cells);
			for (int g = 0; g < cells * cells; g++)
				gridCounts.Set(g, 0);
		}

		int currentSub = api.GetCurrentSubScene();
		int currentLayer = api.GetCurrentEntityLayerId();
		map<string, int> prefabCounts = new map<string, int>();
		map<string, int> layerCounts = new map<string, int>();
		int scannedCount = 0;
		// layers and grid are answered with the first page only, so a cursor page skips their
		// per-entity work; the prefab counts (the pages' oracle) are still walked whole (review
		// round 1, W6-02).
		bool firstPage = req.cursor == "";
		int count = api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (!src)
				continue;
			int sub = src.GetSubScene();
			int layerId = src.GetLayerID();
			if (req.activeLayerOnly && (sub != currentSub || layerId != currentLayer))
				continue;
			scannedCount++;
			string prefab = PrefabOf(src);
			if (prefab == "")
				prefab = "class:" + src.GetClassName();
			prefabCounts.Set(prefab, prefabCounts.Get(prefab) + 1);
			if (!firstPage)
				continue;
			string layerPath = api.GetSubsceneLayerPath(sub, layerId);
			if (sub != 0)
				layerPath = sub.ToString() + ":" + layerPath;
			layerCounts.Set(layerPath, layerCounts.Get(layerPath) + 1);
			if (cells > 0)
			{
				IEntity ent = api.SourceToEntity(src);
				if (ent)
				{
					vector mat[4];
					ent.GetWorldTransform(mat);
					vector pos = mat[3];
					int cx = (pos[0] - terrainMin[0]) / cellX;
					int cz = (terrainMax[2] - pos[2]) / cellZ;
					if (cx >= 0 && cx < cells && cz >= 0 && cz < cells)
						gridCounts.Set(cx + cells * cz, gridCounts.Get(cx + cells * cz) + 1);
				}
			}
		}

		array<string> keys = {};
		foreach (string prefabKey, int prefabCount : prefabCounts)
			keys.Insert(CountKey(prefabCount, prefabKey));
		keys.Sort();

		int total = keys.Count();
		int start = 0;
		int end = 0;
		string pageCode = "";
		string pageWhy = "";
		if (!PageBounds(req.cursor, req.limit, total, start, end, pageCode, pageWhy))
		{
			Answer(resp, "error", pageCode, pageWhy, "read again without a cursor");
			return;
		}
		resp.scanned = scannedCount;
		resp.total = total;
		for (int r = start; r < end; r++)
		{
			string sortKey = keys.Get(r);
			string label = sortKey.Substring(10, sortKey.Length() - 10);
			resp.rows.Insert(label + ";" + prefabCounts.Get(label).ToString());
		}
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();

		if (req.cursor == "")
		{
			array<string> layerKeys = {};
			foreach (string layerKey, int layerCount : layerCounts)
				layerKeys.Insert(CountKey(layerCount, layerKey));
			layerKeys.Sort();
			for (int k = 0; k < layerKeys.Count(); k++)
			{
				string layerSort = layerKeys.Get(k);
				string layerLabel = layerSort.Substring(10, layerSort.Length() - 10);
				resp.layers.Insert(layerLabel + ";" + layerCounts.Get(layerLabel).ToString());
			}
			if (cells > 0)
			{
				resp.cellSize = cellX.ToString();
				for (int gz = 0; gz < cells; gz++)
				{
					string line = "";
					for (int gx = 0; gx < cells; gx++)
					{
						if (gx > 0)
							line += " ";
						line += gridCounts.Get(gx + cells * gz).ToString();
					}
					resp.grid.Insert(line);
				}
			}
		}
		int shown = end - start;
		string gridNote = "";
		if (cells > 0)
			gridNote = "; grid " + cells.ToString() + "x" + cells.ToString() + ", cells " + cellX.ToString() + " x " + cellZ.ToString() + " m, north row first";
		Answer(resp, "ok", "", "stats: " + scannedCount.ToString() + " entities, " + shown.ToString() + " of " + total.ToString() + " prefabs" + gridNote, "");
	}

	//------------------------------------------------------------------------------------------------
	//! goToCoords: served by the TS tool (parse, wb_terrain heights, wb_view setCamera). The handler
	//! answers that it does not serve it and changes nothing.
	protected static void GoToCoords(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		Answer(resp, "error", INVALID_ARGUMENT, "goToCoords is served by the wb_world_tools TS tool, not the handler; nothing was done for '" + req.text + "'", "call wb_world_tools goToCoords through the MCP server");
	}

	//------------------------------------------------------------------------------------------------
	//! Parses one import row "prefab;x y z;qx qy qz qw;scale" (no engine call). False with why.
	static bool ParseImportRow(string rowText, notnull EMCP_WB_WorldToolsImportRow parsed, out string why)
	{
		why = "";
		array<string> parts = {};
		rowText.Split(";", parts, false);
		if (parts.Count() != 4)
		{
			why = "expected prefab;x y z;qx qy qz qw;scale, got " + parts.Count().ToString() + " fields";
			return false;
		}
		parsed.m_Prefab = parts.Get(0).Trim();
		vector pos = vector.Zero;
		string vecWhy = "";
		if (!EMCP_WB_Common.ParseVectorString(parts.Get(1), pos, vecWhy))
		{
			why = "position: " + vecWhy;
			return false;
		}
		parsed.m_Pos = pos;
		string quatText = parts.Get(2);
		quatText.Replace(",", " ");
		array<string> quatParts = {};
		quatText.Split(" ", quatParts, true);
		if (quatParts.Count() != 4)
		{
			why = "quaternion: expected 4 numbers, got " + quatParts.Count().ToString();
			return false;
		}
		float qx = 0;
		float qy = 0;
		float qz = 0;
		float qw = 0;
		if (!EMCP_WB_Common.ParseFloat(quatParts.Get(0), qx) || !EMCP_WB_Common.ParseFloat(quatParts.Get(1), qy) || !EMCP_WB_Common.ParseFloat(quatParts.Get(2), qz) || !EMCP_WB_Common.ParseFloat(quatParts.Get(3), qw))
		{
			why = "quaternion: a component is not a number in '" + parts.Get(2) + "'";
			return false;
		}
		if (qx * qx + qy * qy + qz * qz + qw * qw <= 0)
		{
			why = "quaternion: zero length";
			return false;
		}
		parsed.m_Qx = qx;
		parsed.m_Qy = qy;
		parsed.m_Qz = qz;
		parsed.m_Qw = qw;
		float scaleValue = 0;
		if (!EMCP_WB_Common.ParseFloat(parts.Get(3).Trim(), scaleValue) || scaleValue <= 0)
		{
			why = "scale must be a number above 0, got '" + parts.Get(3) + "'";
			return false;
		}
		parsed.m_Scale = scaleValue;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! importObjects: CreateEntity per row in the layer (default the active one), the plugin's
	//! convention (SCR_ObjectImportPlugin.ImportData): z flipped, y above the terrain with relativeY,
	//! quaternion z and w negated, normalised, QuatToAngles with yaw and pitch swapped; scale set
	//! when not 1. Rows are checked before the entity action opens; a bad row lands in failed.
	protected static void ImportObjects(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (!req.rows || req.rows.Count() == 0)
		{
			if (req.path != "")
				Answer(resp, "error", INVALID_ARGUMENT, "path '" + req.path + "' is read by the TS tool into rows; the handler reads no file; nothing was created", "call wb_world_tools importObjects through the MCP server, or send rows");
			else
				Answer(resp, "error", INVALID_ARGUMENT, "rows required; nothing was created", "rows as prefab;x y z;qx qy qz qw;scale");
			return;
		}
		if (req.rows.Count() > MAX_ROWS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "rows holds " + req.rows.Count().ToString() + " rows, at most " + MAX_ROWS.ToString() + "; nothing was created", "send the rows in calls of " + MAX_ROWS.ToString());
			return;
		}
		int layerId = api.GetCurrentEntityLayerId();
		if (req.layer != "")
		{
			int subScene = api.GetCurrentSubScene();
			layerId = EMCP_WB_LayersUtil.LayerIdOf(api, subScene, req.layer);
			if (layerId < 0)
			{
				Answer(resp, "error", PATH_NOT_FOUND, "no layer '" + req.layer + "' in sub-scene " + subScene.ToString() + "; nothing was created", "list the layers (wb_layers list)");
				return;
			}
		}

		array<ref EMCP_WB_WorldToolsImportRow> plan = {};
		int unknownPrefabs = 0;
		for (int i = 0; i < req.rows.Count(); i++)
		{
			EMCP_WB_WorldToolsImportRow parsed = new EMCP_WB_WorldToolsImportRow();
			parsed.m_Index = i;
			string why = "";
			if (!ParseImportRow(req.rows.Get(i), parsed, why))
			{
				resp.failed.Insert(i.ToString() + ";" + why);
				continue;
			}
			string prefabWhy = "";
			string known = KnownPrefab(parsed.m_Prefab, prefabWhy);
			if (known == "")
			{
				unknownPrefabs++;
				resp.failed.Insert(i.ToString() + ";" + RESOURCE_NOT_FOUND + " " + prefabWhy);
				continue;
			}
			parsed.m_Prefab = known;
			plan.Insert(parsed);
		}
		if (plan.Count() == 0)
		{
			string noneCode = INVALID_ARGUMENT;
			if (unknownPrefabs == req.rows.Count())
				noneCode = RESOURCE_NOT_FOUND;
			Answer(resp, "error", noneCode, "no row is valid (see failed); nothing was created", "fix the rows");
			return;
		}

		resp.undoName = UNDO_IMPORT;
		if (!BeginEdit(api, UNDO_IMPORT, resp))
			return;
		int scaleFailed = 0;
		for (int p = 0; p < plan.Count(); p++)
		{
			EMCP_WB_WorldToolsImportRow item = plan.Get(p);
			vector pos = item.m_Pos;
			pos[2] = -pos[2];
			if (req.relativeY)
				pos[1] = pos[1] + api.GetTerrainSurfaceY(pos[0], pos[2]);
			float quat[4];
			quat[0] = item.m_Qx;
			quat[1] = item.m_Qy;
			quat[2] = -item.m_Qz;
			quat[3] = -item.m_Qw;
			Math3D.QuatNormalize(quat);
			vector angles = Math3D.QuatToAngles(quat);
			float yaw = angles[0];
			angles[0] = angles[1];
			angles[1] = yaw;
			IEntitySource created = api.CreateEntity(item.m_Prefab, "", layerId, null, pos, angles);
			if (!created)
			{
				resp.failed.Insert(item.m_Index.ToString() + ";" + ENGINE_FALSE + " CreateEntity returned null");
				continue;
			}
			// A false scale write is a failed row too, so the tool's row(s) failed warning names it
			// (review round 1, W6-01); the entity stays, at scale 1.
			if (item.m_Scale != 1 && !api.SetVariableValue(created, null, "scale", item.m_Scale.ToString()))
			{
				scaleFailed++;
				resp.failed.Insert(item.m_Index.ToString() + ";" + ENGINE_FALSE + " SetVariableValue scale returned false (entity kept at scale 1)");
			}
			resp.ids.Insert(EMCP_WB_EntityRef.Format(created));
			resp.created = resp.created + 1;
		}
		api.EndEntityAction();
		if (resp.created == 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "CreateEntity created nothing (see failed)", "check the prefabs; undo with wb_undo_redo");
			return;
		}
		string scaleNote = "";
		if (scaleFailed > 0)
			scaleNote = "; SetVariableValue scale returned false for " + scaleFailed.ToString();
		Answer(resp, "ok", "", "created " + resp.created.ToString() + " of " + req.rows.Count().ToString() + scaleNote + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! snapToTerrain: SCR_SnapAndOrientToTerrainPlugin.Run per entity (the refs, else the selection):
	//! SnapAndOrientToTerrain of the world transform, into the parent's space, then angles (pitch,
	//! yaw, roll from MatrixToAngles' yaw, pitch, roll) and coords (y 0 when RELATIVE_Y).
	protected static void SnapToTerrain(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (InPrefabEdit())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is editing a prefab, not a world; nothing was changed", "open a world (wb_module setResource)");
			return;
		}
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Answer(resp, "error", NO_WORLD, "GetWorld returned null", "open a world (wb_module setResource)");
			return;
		}
		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (!Targets(api, req.entities, found, resp.missing, code, why))
		{
			Answer(resp, "error", code, why + "; nothing was changed", "pass entity references as wb_entity list answers them");
			return;
		}
		if (found.Count() == 0)
		{
			if (resp.missing.Count() > 0)
				Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an entity; nothing was changed", "list the entities (wb_entity list)");
			else
				Answer(resp, "error", INVALID_ARGUMENT, "no entities given and nothing is selected; nothing was changed", "pass entities or select entities first");
			return;
		}

		int relMask = EntityFlags.RELATIVE_Y;
		int setFailed = 0;
		resp.undoName = UNDO_SNAP;
		if (!BeginEdit(api, UNDO_SNAP, resp))
			return;
		for (int i = 0; i < found.Count(); i++)
		{
			IEntitySource src = found.Get(i);
			IEntity ent = api.SourceToEntity(src);
			if (!ent)
			{
				resp.failed.Insert(EMCP_WB_EntityRef.Format(src) + ";no runtime entity");
				continue;
			}
			vector mat[4];
			ent.GetWorldTransform(mat);
			if (!SCR_TerrainHelper.SnapAndOrientToTerrain(mat, world))
			{
				resp.failed.Insert(EMCP_WB_EntityRef.Format(src) + ";" + NO_TERRAIN + " no terrain under the entity");
				continue;
			}
			vector localMat[4];
			for (int m = 0; m < 4; m++)
				localMat[m] = mat[m];
			IEntitySource parentSrc = ParentOf(src);
			if (parentSrc)
			{
				IEntity parentEnt = api.SourceToEntity(parentSrc);
				if (parentEnt)
				{
					vector parentMat[4];
					parentEnt.GetWorldTransform(parentMat);
					Math3D.MatrixInvMultiply4(parentMat, mat, localMat);
				}
			}
			vector rot[3];
			rot[0] = localMat[0];
			rot[1] = localMat[1];
			rot[2] = localMat[2];
			vector angles = Math3D.MatrixToAngles(rot);
			string anglesText = angles[1].ToString() + " " + angles[0].ToString() + " " + angles[2].ToString();
			vector pos = localMat[3];
			if ((FlagsOf(src) & relMask) != 0)
				pos[1] = 0;
			bool anglesOk = api.SetVariableValue(src, null, "angles", anglesText);
			bool coordsOk = api.SetVariableValue(src, null, "coords", EMCP_WB_Common.VectorToString(pos));
			if (!anglesOk || !coordsOk)
				setFailed++;
			resp.moved = resp.moved + 1;
		}
		api.EndEntityAction();
		if (resp.moved == 0)
		{
			Answer(resp, "error", NO_TERRAIN, "no entity could be snapped (see failed)", "move the entities over the terrain");
			return;
		}
		if (setFailed > 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "SetVariableValue returned false for " + setFailed.ToString() + " of " + resp.moved.ToString(), "read the entities back with wb_entity get; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", "snapped " + resp.moved.ToString() + " of " + found.Count().ToString() + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! The EntityFlags mask of a flag name (the enum's names, any case), 0 when unknown.
	static int FlagMask(string flagName)
	{
		string upper = flagName.Trim();
		upper.ToUpper();
		if (upper == "VISIBLE")
			return EntityFlags.VISIBLE;
		if (upper == "TRACEABLE")
			return EntityFlags.TRACEABLE;
		if (upper == "NO_LINK")
			return EntityFlags.NO_LINK;
		if (upper == "FEATURE")
			return EntityFlags.FEATURE;
		if (upper == "SET_RENDERED")
			return EntityFlags.SET_RENDERED;
		if (upper == "STREAMABLE")
			return EntityFlags.STREAMABLE;
		if (upper == "ACTIVE")
			return EntityFlags.ACTIVE;
		if (upper == "STATIC")
			return EntityFlags.STATIC;
		if (upper == "USER1")
			return EntityFlags.USER1;
		if (upper == "USER2")
			return EntityFlags.USER2;
		if (upper == "USER3")
			return EntityFlags.USER3;
		if (upper == "USER4")
			return EntityFlags.USER4;
		if (upper == "USER5")
			return EntityFlags.USER5;
		if (upper == "NO_TREE")
			return EntityFlags.NO_TREE;
		if (upper == "RELATIVE_Y")
			return EntityFlags.RELATIVE_Y;
		if (upper == "EDITOR_ONLY")
			return EntityFlags.EDITOR_ONLY;
		if (upper == "DISABLED")
			return EntityFlags.DISABLED;
		if (upper == "PROXY")
			return EntityFlags.PROXY;
		if (upper == "UPDATE_LINK")
			return EntityFlags.UPDATE_LINK;
		return 0;
	}

	//------------------------------------------------------------------------------------------------
	//! The default flags of resetFlags: the ten the plugin offers (TRACEABLE, VISIBLE, STATIC,
	//! FEATURE, NO_LINK, PROXY, EDITOR_ONLY, DISABLED, RELATIVE_Y, and USER4, which the plugin's
	//! OnFilteredNavmesh option resets).
	static int DefaultFlagMask()
	{
		int mask = EntityFlags.TRACEABLE;
		mask = mask | EntityFlags.VISIBLE;
		mask = mask | EntityFlags.STATIC;
		mask = mask | EntityFlags.FEATURE;
		mask = mask | EntityFlags.NO_LINK;
		mask = mask | EntityFlags.PROXY;
		mask = mask | EntityFlags.EDITOR_ONLY;
		mask = mask | EntityFlags.DISABLED;
		mask = mask | EntityFlags.RELATIVE_Y;
		mask = mask | EntityFlags.USER4;
		return mask;
	}

	//------------------------------------------------------------------------------------------------
	//! The base prefab of a category name, "" when unknown ("any" is handled by the caller).
	static string CategoryBase(string category)
	{
		string lower = category.Trim();
		lower.ToLower();
		if (lower == "rocks")
			return ROCK_BASE;
		if (lower == "trees")
			return TREE_BASE;
		if (lower == "bushes")
			return BUSH_BASE;
		if (lower == "buildings")
			return BUILDING_BASE;
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! Adds the descendants of src (GetNumChildren, GetChild) to found, at most MAX_DEPTH levels and
	//! MAX_CHILDREN entities in all.
	static void AddDescendants(IEntitySource src, notnull array<IEntitySource> found, notnull set<IEntitySource> seen, int depth)
	{
		if (!src || depth >= MAX_DEPTH)
			return;
		int childCount = src.GetNumChildren();
		for (int i = 0; i < childCount; i++)
		{
			if (found.Count() >= MAX_CHILDREN)
				return;
			BaseContainer childCont = src.GetChild(i);
			if (!childCont)
				continue;
			IEntitySource child = childCont.ToEntitySource();
			if (!child)
				continue;
			if (seen.Insert(child))
				found.Insert(child);
			AddDescendants(child, found, seen, depth + 1);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! resetFlags: the named flags of each entity back to its prefab's (SCR_EntityFlagsManagerPlugin
	//! .ProcessEntitySources): ClearVariableValue when the result equals the prefab's, else
	//! SetVariableValue; a RELATIVE_Y change converts coords y between terrain and world. Entities:
	//! the refs, else the selection, else every editor entity only with allWorld true (OD-6). The
	//! categories filter by top-most ancestor; "any" processes every entity named or selected.
	protected static void ResetFlags(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		bool hasRefs = req.entities && req.entities.Count() > 0;
		if (hasRefs && req.allWorld)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "give entities or allWorld, not both; nothing was changed", "one source of entities per call");
			return;
		}
		int mask = 0;
		if (!req.flags || req.flags.Count() == 0)
			mask = DefaultFlagMask();
		else
		{
			for (int f = 0; f < req.flags.Count(); f++)
			{
				int one = FlagMask(req.flags.Get(f));
				if (one == 0)
				{
					Answer(resp, "error", INVALID_ARGUMENT, "flags[" + f.ToString() + "] '" + req.flags.Get(f) + "' is not an EntityFlags name; nothing was changed", "VISIBLE, TRACEABLE, STATIC, RELATIVE_Y, ... as the enum names them");
					return;
				}
				mask = mask | one;
			}
		}
		bool anyCategory = false;
		array<string> bases = {};
		if (!req.categories || req.categories.Count() == 0)
		{
			bases.Insert(ROCK_BASE);
			bases.Insert(TREE_BASE);
			bases.Insert(BUSH_BASE);
			bases.Insert(BUILDING_BASE);
		}
		else
		{
			for (int c = 0; c < req.categories.Count(); c++)
			{
				string category = req.categories.Get(c);
				string categoryLower = category.Trim();
				categoryLower.ToLower();
				if (categoryLower == "any")
				{
					anyCategory = true;
					continue;
				}
				string baseName = CategoryBase(category);
				if (baseName == "")
				{
					Answer(resp, "error", INVALID_ARGUMENT, "categories[" + c.ToString() + "] '" + category + "' is not rocks, trees, bushes, buildings or any; nothing was changed", "pick categories");
					return;
				}
				bases.Insert(baseName);
			}
		}
		if (anyCategory && req.allWorld)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "categories any needs entities or a selection, not allWorld (the plugin never processes the whole world unfiltered); nothing was changed", "name categories for allWorld");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;

		array<IEntitySource> candidates = {};
		set<IEntitySource> seen = new set<IEntitySource>();
		string source = "";
		if (req.allWorld)
		{
			source = "every editor entity";
			int count = api.GetEditorEntityCount();
			for (int i = 0; i < count; i++)
			{
				IEntitySource worldSrc = api.GetEditorEntity(i);
				if (!worldSrc)
					continue;
				if (!req.includeChildren && ParentOf(worldSrc))
					continue;
				if (seen.Insert(worldSrc))
					candidates.Insert(worldSrc);
			}
		}
		else
		{
			array<IEntitySource> named = {};
			string code = "";
			string why = "";
			if (!Targets(api, req.entities, named, resp.missing, code, why))
			{
				Answer(resp, "error", code, why + "; nothing was changed", "pass entity references as wb_entity list answers them");
				return;
			}
			if (named.Count() == 0)
			{
				if (resp.missing.Count() > 0)
					Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an entity; nothing was changed", "list the entities (wb_entity list)");
				else
					Answer(resp, "error", INVALID_ARGUMENT, "no entities, no selection and no allWorld: true; the whole world is never the default; nothing was changed", "pass entities, select entities, or pass allWorld true");
				return;
			}
			source = "the given entities";
			if (!hasRefs)
				source = "the selection";
			for (int n = 0; n < named.Count(); n++)
			{
				IEntitySource namedSrc = named.Get(n);
				// The selection skips child entities unless asked, as the plugin; named refs are kept.
				if (!hasRefs && !req.includeChildren && ParentOf(namedSrc))
					continue;
				if (seen.Insert(namedSrc))
					candidates.Insert(namedSrc);
				if (req.includeChildren)
					AddDescendants(namedSrc, candidates, seen, 0);
			}
		}

		// Plan first, so an entity action opens only when something changes.
		int relMask = EntityFlags.RELATIVE_Y;
		array<ref EMCP_WB_WorldToolsFlagEdit> plan = {};
		int scannedCount = 0;
		int noTerrain = 0;
		for (int e = 0; e < candidates.Count(); e++)
		{
			IEntitySource src = candidates.Get(e);
			BaseContainer ancestorCont = src.GetAncestor();
			if (!ancestorCont)
				continue;
			if (!anyCategory)
			{
				BaseContainer top = SCR_BaseContainerTools.GetTopMostAncestor(src);
				if (!top)
					continue;
				ResourceName topName = top.GetResourceName();
				string topText = topName;
				if (bases.Find(topText) < 0)
					continue;
			}
			scannedCount++;
			int oldFlags = FlagsOf(src);
			int prefabFlags = FlagsOf(ancestorCont);
			int newFlags = (oldFlags & ~mask) | (prefabFlags & mask);
			if (oldFlags == newFlags && newFlags == prefabFlags)
				continue;
			EMCP_WB_WorldToolsFlagEdit edit = new EMCP_WB_WorldToolsFlagEdit();
			edit.m_Src = src;
			edit.m_NewFlags = newFlags;
			edit.m_Clear = newFlags == prefabFlags;
			edit.m_Set = !edit.m_Clear && newFlags != oldFlags;
			edit.m_Changed = newFlags != oldFlags;
			bool wasRelative = (oldFlags & relMask) != 0;
			bool isRelative = (newFlags & relMask) != 0;
			if (wasRelative != isRelative)
			{
				vector coords = vector.Zero;
				src.Get("coords", coords);
				float terrainY = 0;
				if (api.TryGetTerrainSurfaceY(coords[0], coords[2], terrainY))
				{
					if (wasRelative)
						coords[1] = coords[1] + terrainY;
					else
						coords[1] = coords[1] - terrainY;
					edit.m_MoveY = true;
					edit.m_Coords = coords;
				}
				else
					noTerrain++;
			}
			// Flags equal to the old ones but not the prefab's (outside the mask): nothing to write.
			if (!edit.m_Clear && !edit.m_Set && !edit.m_MoveY)
				continue;
			plan.Insert(edit);
		}
		// total: the entities walked; scanned: those with a prefab that passed the categories filter
		// (fix-up 1: W6 run 1 scanned 0 of a world of a prop and a GenericWorldEntity, which no
		// category base names, and the answer could not tell that from an empty walk).
		resp.total = candidates.Count();
		resp.scanned = scannedCount;
		if (plan.Count() == 0)
		{
			Answer(resp, "ok", "", "nothing to do: " + scannedCount.ToString() + " of " + candidates.Count().ToString() + " entities of " + source + " passed the filter (a prefab, and a category base unless any) and already carry their prefab's flags", "");
			return;
		}

		int writeFailed = 0;
		resp.undoName = UNDO_FLAGS;
		if (!BeginEdit(api, UNDO_FLAGS, resp))
			return;
		for (int w = 0; w < plan.Count(); w++)
		{
			EMCP_WB_WorldToolsFlagEdit item = plan.Get(w);
			if (item.m_Clear)
			{
				if (api.ClearVariableValue(item.m_Src, null, FLAGS_KEY))
					resp.cleared = resp.cleared + 1;
				else
					writeFailed++;
			}
			else if (item.m_Set)
			{
				if (!api.SetVariableValue(item.m_Src, null, FLAGS_KEY, item.m_NewFlags.ToString()))
					writeFailed++;
			}
			if (item.m_MoveY && !api.SetVariableValue(item.m_Src, null, "coords", EMCP_WB_Common.VectorToString(item.m_Coords)))
				writeFailed++;
			if (item.m_Changed)
				resp.changed = resp.changed + 1;
		}
		api.EndEntityAction();
		string terrainNote = "";
		if (noTerrain > 0)
			terrainNote = "; " + noTerrain.ToString() + " RELATIVE_Y changes kept coords (no terrain under them)";
		if (writeFailed > 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "a Flags or coords write returned false " + writeFailed.ToString() + " times" + terrainNote, "read the entities back with wb_entity get; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", "reset flags on " + resp.changed.ToString() + " of " + scannedCount.ToString() + " entities of " + source + " (" + resp.cleared.ToString() + " cleared to inherit)" + terrainNote + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! True when ancestorSrc is a parent, grandparent, ... of src (at most MAX_DEPTH levels up).
	static bool IsAncestorOf(IEntitySource ancestorSrc, IEntitySource src)
	{
		IEntitySource walk = ParentOf(src);
		int depth = 0;
		while (walk && depth < MAX_DEPTH)
		{
			if (walk == ancestorSrc)
				return true;
			walk = ParentOf(walk);
			depth++;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! replaceEntities: per pair "ref=prefab", CreateEntity of the prefab with the entity's name,
	//! layer, parent and transform (parent space; y less the terrain when the new entity is
	//! RELATIVE_Y, as SCR_EntityReplacerTool), its scale, its children re-parented to the new entity
	//! when keepChildren (to the new one, not the old: the tool's own loop re-parents to the old),
	//! then DeleteEntities of the old ones and RenameEntity of the new ones, in one entity action.
	//! Without keepChildren the children go with the deleted entity [unverified: P-W6-17].
	//! Every pair is checked before the action opens; a bad prefab or a malformed ref changes nothing.
	protected static void ReplaceEntities(EMCP_WB_WorldToolsRequest req, EMCP_WB_WorldToolsResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (!req.pairs || req.pairs.Count() == 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "pairs required; nothing was replaced", "pairs as ref=prefab");
			return;
		}
		if (req.pairs.Count() > MAX_ROWS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "pairs holds " + req.pairs.Count().ToString() + ", at most " + MAX_ROWS.ToString() + "; nothing was replaced", "send the pairs in calls of " + MAX_ROWS.ToString());
			return;
		}

		EMCP_WB_EntityRefResolver resolver = new EMCP_WB_EntityRefResolver(api);
		array<ref EMCP_WB_WorldToolsSwap> plan = {};
		array<IEntitySource> olds = {};
		for (int i = 0; i < req.pairs.Count(); i++)
		{
			string pairText = req.pairs.Get(i);
			int eq = pairText.LastIndexOf("=");
			if (eq <= 0 || eq >= pairText.Length() - 1)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "pairs[" + i.ToString() + "] must be ref=prefab, got '" + pairText + "'; nothing was replaced", "pairs as ref=prefab");
				return;
			}
			string entityRef = pairText.Substring(0, eq).Trim();
			string prefabText = pairText.Substring(eq + 1, pairText.Length() - eq - 1);
			string prefabWhy = "";
			string known = KnownPrefab(prefabText, prefabWhy);
			if (known == "")
			{
				Answer(resp, "error", RESOURCE_NOT_FOUND, "pairs[" + i.ToString() + "]: " + prefabWhy + "; nothing was replaced", "check the prefab with wb_resources resolve");
				return;
			}
			EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
			if (!resolver.Resolve(entityRef, resolved))
			{
				if (resolved.m_Code == EMCP_WB_EntityRef.ENTITY_NOT_FOUND)
				{
					resp.missing.Insert(entityRef);
					continue;
				}
				Answer(resp, "error", resolved.m_Code, "pairs[" + i.ToString() + "]: " + resolved.m_Why + "; nothing was replaced", "pass entity references as wb_entity list answers them");
				return;
			}
			IEntitySource oldSrc = resolved.m_Src;
			if (olds.Find(oldSrc) >= 0)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "pairs[" + i.ToString() + "] names an entity twice; nothing was replaced", "one pair per entity");
				return;
			}
			olds.Insert(oldSrc);
			EMCP_WB_WorldToolsSwap swap = new EMCP_WB_WorldToolsSwap();
			swap.m_Ref = entityRef;
			swap.m_Prefab = known;
			swap.m_Old = oldSrc;
			swap.m_Name = oldSrc.GetName();
			plan.Insert(swap);
		}
		if (plan.Count() == 0)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no pair names an entity; nothing was replaced", "list the entities (wb_entity list)");
			return;
		}
		// A replaced entity under another replaced one would follow its old parent into the delete.
		for (int a = 0; a < olds.Count(); a++)
		{
			for (int b = 0; b < olds.Count(); b++)
			{
				if (a != b && IsAncestorOf(olds.Get(a), olds.Get(b)))
				{
					Answer(resp, "error", INVALID_ARGUMENT, "pairs name an entity and one of its descendants; nothing was replaced", "replace the parent and the child in separate calls");
					return;
				}
			}
		}

		int relMask = EntityFlags.RELATIVE_Y;
		int partial = 0;
		array<IEntitySource> toDelete = {};
		resp.undoName = UNDO_REPLACE;
		if (!BeginEdit(api, UNDO_REPLACE, resp))
			return;
		for (int p = 0; p < plan.Count(); p++)
		{
			EMCP_WB_WorldToolsSwap item = plan.Get(p);
			IEntitySource src = item.m_Old;
			IEntity ent = api.SourceToEntity(src);
			if (!ent)
			{
				resp.failed.Insert(item.m_Ref + ";no runtime entity");
				continue;
			}
			vector mat[4];
			ent.GetWorldTransform(mat);
			vector worldPos = mat[3];
			vector coords = worldPos;
			IEntitySource parentSrc = ParentOf(src);
			if (parentSrc)
			{
				IEntity parentEnt = api.SourceToEntity(parentSrc);
				if (parentEnt)
				{
					vector parentMat[4];
					parentEnt.GetWorldTransform(parentMat);
					vector localMat[4];
					Math3D.MatrixInvMultiply4(parentMat, mat, localMat);
					coords = localMat[3];
				}
			}
			vector angles = ent.GetAngles();
			src.Get("angles", angles);
			IEntitySource created = api.CreateEntity(item.m_Prefab, "", src.GetLayerID(), parentSrc, coords, angles);
			if (!created)
			{
				resp.failed.Insert(item.m_Ref + ";" + ENGINE_FALSE + " CreateEntity returned null");
				continue;
			}
			item.m_New = created;
			IEntity createdEnt = api.SourceToEntity(created);
			if (createdEnt && (createdEnt.GetFlags() & relMask) != 0)
			{
				vector finalCoords = coords;
				finalCoords[1] = finalCoords[1] - api.GetTerrainSurfaceY(worldPos[0], worldPos[2]);
				if (!api.SetVariableValue(created, null, "coords", EMCP_WB_Common.VectorToString(finalCoords)))
					partial++;
			}
			float oldScale = 1;
			if (src.Get("scale", oldScale) && oldScale > 0 && oldScale != 1)
			{
				if (!api.SetVariableValue(created, null, "scale", oldScale.ToString()))
					partial++;
			}
			if (req.keepChildren)
			{
				array<IEntitySource> kids = {};
				int kidCount = src.GetNumChildren();
				for (int k = 0; k < kidCount; k++)
				{
					BaseContainer kidCont = src.GetChild(k);
					if (!kidCont)
						continue;
					IEntitySource kid = kidCont.ToEntitySource();
					if (kid)
						kids.Insert(kid);
				}
				for (int r = 0; r < kids.Count(); r++)
				{
					if (!api.ParentEntity(created, kids.Get(r), true))
						partial++;
				}
			}
			toDelete.Insert(src);
		}
		if (toDelete.Count() > 0 && !api.DeleteEntities(toDelete))
			partial++;
		for (int n = 0; n < plan.Count(); n++)
		{
			EMCP_WB_WorldToolsSwap done = plan.Get(n);
			if (!done.m_New)
				continue;
			if (done.m_Name != "" && !api.RenameEntity(done.m_New, done.m_Name))
				partial++;
			resp.ids.Insert(EMCP_WB_EntityRef.Format(done.m_New));
			resp.replaced = resp.replaced + 1;
		}
		api.EndEntityAction();
		if (resp.replaced == 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "nothing was replaced (see failed)", "check the prefabs; undo with wb_undo_redo");
			return;
		}
		if (partial > 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "replaced " + resp.replaced.ToString() + ", but " + partial.ToString() + " engine calls (coords, scale, ParentEntity, DeleteEntities or RenameEntity) returned false", "read the entities back with wb_entity get; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", "replaced " + resp.replaced.ToString() + " of " + req.pairs.Count().ToString() + "; undo with wb_undo_redo", "");
	}
}
