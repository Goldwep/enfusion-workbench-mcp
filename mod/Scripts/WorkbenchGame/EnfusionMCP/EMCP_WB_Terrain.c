/**
 * EMCP_WB_Terrain.c - Terrain of the open world, read only (wave W1, wb_terrain)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Terrain", dispatching on "action"
 * (docs/v2/design/phase5-w1-spec.md section 2.5). One action surface (OD-6, DEC-061): the 1.x
 * wb_terrain names (getHeight, getBounds) are mapped by the TypeScript tool, not here.
 *   info     WorldEditor.GetTerrainBounds, then GetTerrainResolutionX/Y, GetTerrainTilesX/Y,
 *            GetTerrainUnitScale and GetSurfaceMaterials of one terrain; minY/maxY by
 *            SCR_WorldEditorToolHelper.GetTerrainMinMaxY only when asked (minMax: it samples the
 *            terrain); landArea by SCR_WorldEditorToolHelper.GetTerrainLandArea only when asked
 *   heights  TryGetTerrainSurfaceY per point, at most 200 points
 *   tile     GetTerrainSurfaceTile of one tile, the samples paged
 *
 * The 1.x extended tools keep their own actions, request and response keys exactly as 1.x
 * answered them (status ok or error, message, payload):
 *   inspect            terrain_inspect: the bounds (or null) and world_path as a JSON payload
 *   navmesh_status     terrain_navmesh_status: status error, message "not implemented: ..."
 *   road_export_graph  terrain_road_export_graph: status error, message "not implemented: ..."
 *
 * Every W1 action answers NO_TERRAIN when the bounds are empty (GetTerrainBounds false, or min equal
 * to max). Guard: none (pure reads; nothing is written). Every action stays below T5 until probe
 * P-W1-15 runs on a terrain world (OD-5). Paging: cursor "<start>:<count>", count = the total at the
 * first read; a changed total answers STALE_CURSOR; limit default 50, max 200.
 * Keys: contracts/EMCP_WB_Terrain.json.
 */

class EMCP_WB_TerrainRequest : JsonApiStruct
{
	string action;
	//! info, tile: the terrain, default 0
	int terrainIndex;
	//! info: also compute the land area (slow)
	bool landArea;
	//! info: also compute minY/maxY (GetTerrainMinMaxY samples the terrain)
	bool minMax;
	//! inspect, navmesh_status, road_export_graph (1.x tools): the world, echoed by inspect
	string world_path;
	//! heights: "x z" each, at most 200
	ref array<string> points;
	//! tile: the tile
	int tileX;
	int tileY;
	//! tile: nextCursor of the previous page
	string cursor;
	int limit;

	void EMCP_WB_TerrainRequest()
	{
		points = {};

		RegV("action");
		RegV("terrainIndex");
		RegV("landArea");
		RegV("minMax");
		RegV("world_path");
		RegV("points");
		RegV("tileX");
		RegV("tileY");
		RegV("cursor");
		RegV("limit");

		// Defaults for keys the request leaves out.
		tileX = -1;
		tileY = -1;
	}
}

class EMCP_WB_TerrainResponse : JsonApiStruct
{
	//! ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	bool hasTerrain;
	int resolutionX;
	int resolutionY;
	int tilesX;
	int tilesY;
	float unitScale;
	string boundsMin;
	string boundsMax;
	float minY;
	float maxY;
	float landArea;
	ref array<string> surfaces;
	ref array<string> rows;
	int sampleCount;
	int total;
	string nextCursor;
	//! inspect (1.x terrain_inspect): the JSON summary the tool parses
	string payload;

	void EMCP_WB_TerrainResponse()
	{
		surfaces = {};
		rows = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("hasTerrain");
		RegV("resolutionX");
		RegV("resolutionY");
		RegV("tilesX");
		RegV("tilesY");
		RegV("unitScale");
		RegV("boundsMin");
		RegV("boundsMax");
		RegV("minY");
		RegV("maxY");
		RegV("landArea");
		RegV("surfaces");
		RegV("rows");
		RegV("sampleCount");
		RegV("total");
		RegV("nextCursor");
		RegV("payload");
	}
}

//! Static helpers of the Terrain handler that take neither the request nor the response.
class EMCP_WB_TerrainUtil
{
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! heights: points one call takes at most.
	static const int MAX_POINTS = 200;

	//------------------------------------------------------------------------------------------------
	//! The page window of a paged read: cursor "<start>:<count>" ("" = the first page), count must be
	//! the current total (else STALE_CURSOR). limit <= 0 is PAGE_DEFAULT, above PAGE_MAX is PAGE_MAX.
	//! False with code and why when the cursor is malformed or stale.
	static bool PageWindow(string cursor, int limit, int total, out int first, out int stop, out string code, out string why)
	{
		first = 0;
		stop = 0;
		code = "";
		why = "";
		int size = limit;
		if (size <= 0)
			size = PAGE_DEFAULT;
		if (size > PAGE_MAX)
			size = PAGE_MAX;

		if (cursor != "")
		{
			array<string> parts = {};
			cursor.Split(":", parts, false);
			int at = 0;
			int count = 0;
			if (parts.Count() != 2 || !EMCP_WB_Common.ParseInt(parts.Get(0), at) || !EMCP_WB_Common.ParseInt(parts.Get(1), count) || at < 0 || count < 0)
			{
				code = "INVALID_ARGUMENT";
				why = "cursor is not one this handler answered ('<start>:<count>'): " + cursor;
				return false;
			}
			if (count != total || at > total)
			{
				code = "STALE_CURSOR";
				why = "the tile changed since the cursor was issued (count " + count.ToString() + ", now " + total.ToString() + ")";
				return false;
			}
			first = at;
		}

		stop = first + size;
		if (stop > total)
			stop = total;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The nextCursor of a page that ends at stop: "" on the last page.
	static string NextCursor(int stop, int total)
	{
		if (stop >= total)
			return "";
		return stop.ToString() + ":" + total.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! Parses "x z" or "x, z" into two floats; false with why otherwise.
	static bool ParsePoint(string text, out float px, out float pz, out string why)
	{
		px = 0;
		pz = 0;
		why = "";
		string s = text;
		s.Replace(",", " ");
		array<string> parts = {};
		s.Split(" ", parts, true);
		if (parts.Count() != 2)
		{
			why = "a point is \"x z\", got '" + text + "'";
			return false;
		}
		if (!EMCP_WB_Common.ParseFloat(parts.Get(0), px) || !EMCP_WB_Common.ParseFloat(parts.Get(1), pz))
		{
			px = 0;
			pz = 0;
			why = "a point is two numbers \"x z\", got '" + text + "'";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! "true" or "false".
	static string BoolText(bool value)
	{
		if (value)
			return "true";
		return "false";
	}
}

class EMCP_WB_Terrain : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string NO_WORLD = "NO_WORLD";
	static const string NO_TERRAIN = "NO_TERRAIN";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string TERRAIN_NEXT = "open a world that has a terrain";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_TerrainRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_TerrainRequest req = EMCP_WB_TerrainRequest.Cast(request);
		EMCP_WB_TerrainResponse resp = new EMCP_WB_TerrainResponse();
		if (!req)
		{
			Refuse(resp, INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "info")
			ReadInfo(req, resp);
		else if (req.action == "heights")
			ReadHeights(req, resp);
		else if (req.action == "tile")
			ReadTile(req, resp);
		else if (req.action == "inspect")
			Inspect(req, resp);
		else if (req.action == "navmesh_status" || req.action == "road_export_graph")
		{
			// 1.x placeholders: not implemented (status error), as 1.x answered them.
			NotImplemented(req, resp);
		}
		else
			Refuse(resp, INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of info, heights, tile, inspect, navmesh_status, road_export_graph");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! inspect (1.x terrain_inspect, kept as 1.x answered it): status ok with a JSON payload holding
	//! "bounds" ({"min":[x,y,z],"max":[x,y,z]}, or null when GetTerrainBounds is false) and, when
	//! world_path was sent, "world_path" echoed (escaped), plus "open_world" (the open world's path,
	//! home scrubbed) when a world is open. Status error when the module is missing.
	static void Inspect(EMCP_WB_TerrainRequest req, EMCP_WB_TerrainResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return;
		}
		vector boundsMinVec = vector.Zero;
		vector boundsMaxVec = vector.Zero;
		bool hasBounds = worldEditor.GetTerrainBounds(boundsMinVec, boundsMaxVec);

		string json = "{";
		if (hasBounds)
		{
			json += "\"bounds\":{";
			json += "\"min\":[" + boundsMinVec[0].ToString() + "," + boundsMinVec[1].ToString() + "," + boundsMinVec[2].ToString() + "],";
			json += "\"max\":[" + boundsMaxVec[0].ToString() + "," + boundsMaxVec[1].ToString() + "," + boundsMaxVec[2].ToString() + "]";
			json += "}";
		}
		else
		{
			json += "\"bounds\":null";
		}
		if (req.world_path.Length() > 0)
			json += ",\"world_path\":\"" + EMCP_WB_Common.JsonEscape(req.world_path) + "\"";
		// The world the bounds were read from (phase-7 audit read-knowledge-06), so the payload
		// describes itself: world_path above is only the request echo.
		// NoWorldReason first: an API with no world crashed GetNumSubScenes on 2026-11-11.
		WorldEditorAPI api = worldEditor.GetApi();
		string noWorld = "no API";
		if (api)
			noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld == "")
		{
			string openWorld = "";
			api.GetWorldPath(openWorld);
			if (openWorld.Length() > 0)
				json += ",\"open_world\":\"" + EMCP_WB_Common.JsonEscape(EMCP_WB_Guard.ScrubHome(openWorld)) + "\"";
		}
		json += "}";

		resp.status = "ok";
		resp.message = "Terrain inspect complete";
		resp.payload = json;
	}

	//------------------------------------------------------------------------------------------------
	//! navmesh_status, road_export_graph (1.x placeholders, kept as 1.x answered them): status error
	//! and a message starting "not implemented", which the 1.x tools report as a plain notice.
	static void NotImplemented(EMCP_WB_TerrainRequest req, EMCP_WB_TerrainResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return;
		}
		resp.status = "error";
		resp.message = "not implemented: action '" + req.action + "' is planned for L7 but not yet implemented in the Workbench handler. See docs/L7-PLAN.md.";
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_TerrainResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_TerrainResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor module, or null with the refusal written. GetModule opens a closed World
	//! Editor (DEC-053), as every 1.x World Editor handler does.
	protected static WorldEditor EditorModule(EMCP_WB_TerrainResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
		return worldEditor;
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API, or null with the refusal written.
	protected static WorldEditorAPI EditorApi(WorldEditor worldEditor, EMCP_WB_TerrainResponse resp)
	{
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			Refuse(resp, NO_WORLD, "the World Editor has no API: no world is open", "open a world (wb_module setResource)");
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, NO_WORLD, noWorld, "open a world (wb_module setResource)");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! True when the open world has a terrain: GetTerrainBounds answers true and min differs from max.
	protected static bool TerrainBounds(WorldEditor worldEditor, out vector boundsMin, out vector boundsMax)
	{
		boundsMin = vector.Zero;
		boundsMax = vector.Zero;
		bool found = worldEditor.GetTerrainBounds(boundsMin, boundsMax);
		if (!found)
			return false;
		return vector.Distance(boundsMin, boundsMax) > 0;
	}

	//------------------------------------------------------------------------------------------------
	//! info: the terrain facts of one terrain index. NO_TERRAIN (hasTerrain false) when the bounds are
	//! empty. minY/maxY: GetTerrainMinMaxY takes no terrain index (the helper's own terrain).
	static void ReadInfo(EMCP_WB_TerrainRequest req, EMCP_WB_TerrainResponse resp)
	{
		WorldEditor worldEditor = EditorModule(resp);
		if (!worldEditor)
			return;
		WorldEditorAPI api = EditorApi(worldEditor, resp);
		if (!api)
			return;
		int terrainIndex = req.terrainIndex;
		if (terrainIndex < 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "terrainIndex must not be negative", "omit terrainIndex for 0");
			return;
		}

		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		bool has = TerrainBounds(worldEditor, boundsMin, boundsMax);
		resp.hasTerrain = has;
		if (!has)
		{
			Refuse(resp, NO_TERRAIN, "the open world has no terrain (GetTerrainBounds is empty)", TERRAIN_NEXT);
			return;
		}
		resp.boundsMin = EMCP_WB_Common.VectorToString(boundsMin);
		resp.boundsMax = EMCP_WB_Common.VectorToString(boundsMax);
		resp.resolutionX = api.GetTerrainResolutionX(terrainIndex);
		resp.resolutionY = api.GetTerrainResolutionY(terrainIndex);
		resp.tilesX = api.GetTerrainTilesX(terrainIndex);
		resp.tilesY = api.GetTerrainTilesY(terrainIndex);
		resp.unitScale = api.GetTerrainUnitScale(terrainIndex);

		array<ResourceName> materials = {};
		api.GetSurfaceMaterials(terrainIndex, materials);
		foreach (ResourceName material : materials)
		{
			string materialText = material;
			resp.surfaces.Insert(materialText);
		}

		// GetTerrainMinMaxY samples the whole terrain: only on request (review T1).
		string note = "";
		if (req.minMax)
		{
			float lowest = 0;
			float highest = 0;
			SCR_WorldEditorToolHelper.GetTerrainMinMaxY(lowest, highest);
			resp.minY = lowest;
			resp.maxY = highest;
			note = "; height " + lowest.ToString() + " to " + highest.ToString();
		}
		if (req.landArea)
		{
			resp.landArea = SCR_WorldEditorToolHelper.GetTerrainLandArea(terrainIndex);
			note += "; land area " + resp.landArea.ToString() + " m2";
		}
		Answer(resp, "ok", "", "terrain " + terrainIndex.ToString() + ": " + resp.tilesX.ToString() + "x" + resp.tilesY.ToString() + " tiles, " + resp.surfaces.Count().ToString() + " surface materials" + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! heights: TryGetTerrainSurfaceY per point; rows "x|z|onTerrain|y".
	static void ReadHeights(EMCP_WB_TerrainRequest req, EMCP_WB_TerrainResponse resp)
	{
		WorldEditor worldEditor = EditorModule(resp);
		if (!worldEditor)
			return;
		WorldEditorAPI api = EditorApi(worldEditor, resp);
		if (!api)
			return;
		array<string> points = req.points;
		if (!points || points.Count() == 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "points must hold at least one \"x z\"", "pass points");
			return;
		}
		if (points.Count() > EMCP_WB_TerrainUtil.MAX_POINTS)
		{
			Refuse(resp, INVALID_ARGUMENT, "at most " + EMCP_WB_TerrainUtil.MAX_POINTS.ToString() + " points per call, got " + points.Count().ToString(), "split the points");
			return;
		}

		array<float> xs = {};
		array<float> zs = {};
		foreach (string point : points)
		{
			float px = 0;
			float pz = 0;
			string why = "";
			if (!EMCP_WB_TerrainUtil.ParsePoint(point, px, pz, why))
			{
				Refuse(resp, INVALID_ARGUMENT, why, "pass each point as \"x z\"");
				return;
			}
			xs.Insert(px);
			zs.Insert(pz);
		}

		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		if (!TerrainBounds(worldEditor, boundsMin, boundsMax))
		{
			Refuse(resp, NO_TERRAIN, "the open world has no terrain (GetTerrainBounds is empty)", TERRAIN_NEXT);
			return;
		}

		int onCount = 0;
		for (int i = 0; i < xs.Count(); i++)
		{
			float sx = xs.Get(i);
			float sz = zs.Get(i);
			float sy = 0;
			bool on = api.TryGetTerrainSurfaceY(sx, sz, sy);
			if (on)
				onCount++;
			else
				sy = 0;
			resp.rows.Insert(sx.ToString() + "|" + sz.ToString() + "|" + EMCP_WB_TerrainUtil.BoolText(on) + "|" + sy.ToString());
		}
		Answer(resp, "ok", "", onCount.ToString() + " of " + xs.Count().ToString() + " points on the terrain", "");
	}

	//------------------------------------------------------------------------------------------------
	//! tile: GetTerrainSurfaceTile of one tile; the height samples row-major, paged.
	static void ReadTile(EMCP_WB_TerrainRequest req, EMCP_WB_TerrainResponse resp)
	{
		WorldEditor worldEditor = EditorModule(resp);
		if (!worldEditor)
			return;
		WorldEditorAPI api = EditorApi(worldEditor, resp);
		if (!api)
			return;
		int terrainIndex = req.terrainIndex;
		if (terrainIndex < 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "terrainIndex must not be negative", "omit terrainIndex for 0");
			return;
		}

		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		if (!TerrainBounds(worldEditor, boundsMin, boundsMax))
		{
			Refuse(resp, NO_TERRAIN, "the open world has no terrain (GetTerrainBounds is empty)", TERRAIN_NEXT);
			return;
		}

		int tileX = req.tileX;
		int tileY = req.tileY;
		int countX = api.GetTerrainTilesX(terrainIndex);
		int countY = api.GetTerrainTilesY(terrainIndex);
		if (tileX < 0 || tileY < 0 || tileX >= countX || tileY >= countY)
		{
			Refuse(resp, INVALID_ARGUMENT, "tile " + tileX.ToString() + "," + tileY.ToString() + " is outside the " + countX.ToString() + "x" + countY.ToString() + " tiles", "read the tile counts with wb_terrain info");
			return;
		}

		array<float> samples = {};
		bool read = api.GetTerrainSurfaceTile(terrainIndex, tileX, tileY, samples);
		if (!read)
		{
			Answer(resp, "error", ENGINE_FALSE, "GetTerrainSurfaceTile returned false for tile " + tileX.ToString() + "," + tileY.ToString(), "read the tile counts with wb_terrain info");
			return;
		}

		int total = samples.Count();
		int first = 0;
		int stop = 0;
		string code = "";
		string why = "";
		if (!EMCP_WB_TerrainUtil.PageWindow(req.cursor, req.limit, total, first, stop, code, why))
		{
			Refuse(resp, code, why, "read again without a cursor");
			return;
		}
		for (int i = first; i < stop; i++)
		{
			float height = samples.Get(i);
			resp.rows.Insert(height.ToString());
		}
		resp.sampleCount = total;
		resp.total = total;
		resp.nextCursor = EMCP_WB_TerrainUtil.NextCursor(stop, total);
		Answer(resp, "ok", "", total.ToString() + " samples in tile " + tileX.ToString() + "," + tileY.ToString() + "; rows " + first.ToString() + " to " + stop.ToString(), "");
	}
}
