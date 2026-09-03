/**
 * EMCP_WB_Terrain.c - Terrain operations handler
 *
 * Actions: getHeight, getBounds, inspect
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Terrain"
 */

class EMCP_WB_TerrainRequest : JsonApiStruct
{
	string action;
	string x;
	string z;
	// L7: world_path for inspect/save_world_as actions.
	string world_path;

	void EMCP_WB_TerrainRequest()
	{
		RegV("action");
		RegV("x");
		RegV("z");
		RegV("world_path");
	}
}

class EMCP_WB_TerrainResponse : JsonApiStruct
{
	string status;
	string message;
	string action;
	float height;
	string boundsMin;
	string boundsMax;
	// L7: opaque JSON payload for inspect/road_export_graph/etc actions
	// that return richer structured data than the flat individual fields
	// above can express. Node-side parses this as JSON.
	string payload;

	void EMCP_WB_TerrainResponse()
	{
		RegV("status");
		RegV("message");
		RegV("action");
		RegV("height");
		RegV("boundsMin");
		RegV("boundsMax");
		RegV("payload");
	}
}

class EMCP_WB_Terrain : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_TerrainRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_TerrainRequest req = EMCP_WB_TerrainRequest.Cast(request);
		EMCP_WB_TerrainResponse resp = new EMCP_WB_TerrainResponse();
		resp.action = req.action;

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return resp;
		}

		if (req.action == "getHeight")
		{
			WorldEditorAPI api = worldEditor.GetApi();
			if (!api)
			{
				resp.status = "error";
				resp.message = "WorldEditorAPI not available";
				return resp;
			}

			float fx, fz;
			if (!EMCP_WB_Common.ParseFloat(req.x, fx) || !EMCP_WB_Common.ParseFloat(req.z, fz))
			{
				resp.status = "error";
				resp.message = "x and z must be numeric (got x='" + req.x + "', z='" + req.z + "')";
				return resp;
			}

			float surfaceY = api.GetTerrainSurfaceY(fx, fz);
			resp.height = surfaceY;
			resp.status = "ok";
			resp.message = "Terrain height at (" + fx.ToString() + ", " + fz.ToString() + "): " + surfaceY.ToString();
		}
		else if (req.action == "getBounds")
		{
			vector boundsMinVec, boundsMaxVec;
			bool result = worldEditor.GetTerrainBounds(boundsMinVec, boundsMaxVec);

			if (result)
			{
				resp.boundsMin = EMCP_WB_Common.VectorToString(boundsMinVec);
				resp.boundsMax = EMCP_WB_Common.VectorToString(boundsMaxVec);
				resp.status = "ok";
				resp.message = "Terrain bounds retrieved";
			}
			else
			{
				resp.status = "error";
				resp.message = "GetTerrainBounds returned false (no terrain loaded?)";
			}
		}
		else if (req.action == "inspect")
		{
			// L7-3: aggregated terrain summary as JSON payload.
			// Returns bounds + any additional fields the Workbench API
			// can surface synchronously. Heavier data (road graph, navmesh
			// coverage, foliage stats) lives in dedicated actions to keep
			// the response shape compact.
			vector boundsMinVec, boundsMaxVec;
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
			// world_path passed by caller; echo back for context. Escaped - it is a filesystem
			// path and routinely contains backslashes.
			if (req.world_path.Length() > 0)
			{
				json += ",\"world_path\":\"" + EMCP_WB_Common.JsonEscape(req.world_path) + "\"";
			}
			json += "}";

			resp.status = "ok";
			resp.message = "Terrain inspect complete";
			resp.payload = json;
		}
		else if (req.action == "navmesh_status" || req.action == "navmesh_bake"
			|| req.action == "export_heightmap" || req.action == "road_export_graph"
			|| req.action == "river_export" || req.action == "water_surface_query"
			|| req.action == "save_world_as")
		{
			// L7 placeholders - these actions are defined in docs/L7-PLAN.md
			// but require Workbench-side API exploration (NavmeshGeneratorMain,
			// RoadNetworkManager, RiverEntity, ChimeraWorldUtils, GameWorldEditor)
			// before they can be implemented properly. Uses the standard "error"
			// status (not a separate vocabulary) so every client treats it as a failure.
			resp.status = "error";
			resp.message = "not implemented: action '" + req.action + "' is planned for L7 but not yet implemented in the Workbench handler. See docs/L7-PLAN.md.";
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: getHeight, getBounds, inspect (L7 actions navmesh_status, navmesh_bake, export_heightmap, road_export_graph, river_export, water_surface_query, save_world_as are not implemented).";
		}

		return resp;
	}
}
