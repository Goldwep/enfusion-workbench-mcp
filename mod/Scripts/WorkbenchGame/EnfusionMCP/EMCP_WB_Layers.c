/**
 * EMCP_WB_Layers.c - Layer management handler
 *
 * Actions: list, getActive, getEntityLayer, isVisible, getInfo, toggleLock
 * Layer operations in WorldEditorAPI are limited in the public API.
 * Layers are identified by numeric IDs from IEntitySource.GetLayerID(); layerPath must be the
 * layer ID as a decimal string (non-numeric values are rejected rather than coerced to 0).
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Layers"
 */

class EMCP_WB_LayersRequest : JsonApiStruct
{
	string action;
	int subScene;
	string entityName;
	bool visible;
	string layerPath;

	void EMCP_WB_LayersRequest()
	{
		RegV("action");
		RegV("subScene");
		RegV("entityName");
		RegV("visible");
		RegV("layerPath");
		subScene = -1;
	}
}

class EMCP_WB_LayersResponse : JsonApiStruct
{
	string status;
	string message;
	string action;
	int currentSubScene;
	int layerID;
	bool layerVisible;
	bool layerLocked;
	bool layerActive;
	int layerEntityCount;

	// Layer data collected for list
	ref array<int> m_aLayerIDs;
	ref array<int> m_aEntityCounts;

	void EMCP_WB_LayersResponse()
	{
		RegV("status");
		RegV("message");
		RegV("action");
		RegV("currentSubScene");
		RegV("layerID");
		RegV("layerVisible");
		RegV("layerLocked");
		RegV("layerActive");
		RegV("layerEntityCount");

		m_aLayerIDs = {};
		m_aEntityCounts = {};
	}

	override void OnPack()
	{
		if (m_aLayerIDs.Count() > 0)
		{
			StartArray("layers");
			for (int i = 0; i < m_aLayerIDs.Count(); i++)
			{
				StartObject("");
				StoreInteger("layerID", m_aLayerIDs[i]);
				StoreInteger("entityCount", m_aEntityCounts[i]);
				EndObject();
			}
			EndArray();
		}
	}
}

class EMCP_WB_Layers : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_LayersRequest();
	}

	//------------------------------------------------------------------------------------------------
	//! Parses layerPath as a numeric layer ID. On failure fills resp with an error and returns false.
	static bool ResolveLayerID(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp, out int layerID)
	{
		layerID = 0;
		if (req.layerPath == "")
		{
			resp.status = "error";
			resp.message = "layerPath parameter required for " + req.action + " (use the layer ID as a decimal string, e.g. '0')";
			return false;
		}

		if (!EMCP_WB_Common.ParseInt(req.layerPath, layerID))
		{
			resp.status = "error";
			resp.message = "layerPath must be a numeric layer ID (got '" + req.layerPath + "'); named layer paths are not supported by the public WorldEditorAPI - use the list action to find IDs";
			return false;
		}
		return true;
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_LayersRequest req = EMCP_WB_LayersRequest.Cast(request);
		EMCP_WB_LayersResponse resp = new EMCP_WB_LayersResponse();
		resp.action = req.action;

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return resp;
		}

		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			resp.status = "error";
			resp.message = "WorldEditorAPI not available";
			return resp;
		}

		resp.currentSubScene = api.GetCurrentSubScene();

		if (req.action == "list")
		{
			// Enumerate layers by scanning all entities and collecting unique layer IDs
			int entityCount = api.GetEditorEntityCount();
			map<int, int> layerCounts = new map<int, int>();

			for (int i = 0; i < entityCount; i++)
			{
				IEntitySource entSrc = api.GetEditorEntity(i);
				if (!entSrc)
					continue;

				int lid = entSrc.GetLayerID();
				if (layerCounts.Contains(lid))
				{
					int current = layerCounts.Get(lid);
					layerCounts.Set(lid, current + 1);
				}
				else
				{
					layerCounts.Set(lid, 1);
				}
			}

			// Output collected layers
			for (int k = 0; k < layerCounts.Count(); k++)
			{
				int layerKey = layerCounts.GetKey(k);
				int layerCount = layerCounts.GetElement(k);
				resp.m_aLayerIDs.Insert(layerKey);
				resp.m_aEntityCounts.Insert(layerCount);
			}

			resp.status = "ok";
			resp.message = "Found " + layerCounts.Count().ToString() + " layers across " + entityCount.ToString() + " entities";
		}
		else if (req.action == "getActive")
		{
			resp.currentSubScene = api.GetCurrentSubScene();
			resp.status = "ok";
			resp.message = "Current sub-scene: " + resp.currentSubScene.ToString();
		}
		else if (req.action == "getEntityLayer")
		{
			if (req.entityName == "")
			{
				resp.status = "error";
				resp.message = "entityName parameter required for getEntityLayer";
				return resp;
			}

			IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.entityName);
			if (entSrc)
			{
				resp.layerID = entSrc.GetLayerID();
				resp.status = "ok";
				resp.message = "Entity '" + req.entityName + "' is on layer " + resp.layerID.ToString();
			}
			else
			{
				resp.status = "error";
				resp.message = "Entity not found: " + req.entityName;
			}
		}
		else if (req.action == "isVisible")
		{
			int targetLayerID;
			if (!ResolveLayerID(req, resp, targetLayerID))
				return resp;

			int subScene = resp.currentSubScene;
			resp.layerVisible = api.IsEntityLayerVisible(subScene, targetLayerID);
			resp.layerLocked = api.IsEntityLayerLocked(subScene, targetLayerID);
			resp.layerID = targetLayerID;
			resp.status = "ok";
			resp.message = "Layer " + req.layerPath + ": visible=" + resp.layerVisible.ToString() + " locked=" + resp.layerLocked.ToString();
		}
		else if (req.action == "getInfo")
		{
			int targetLayerID;
			if (!ResolveLayerID(req, resp, targetLayerID))
				return resp;

			// Count entities on this layer
			int totalEntities = api.GetEditorEntityCount();
			int layerEntCount = 0;
			for (int i = 0; i < totalEntities; i++)
			{
				IEntitySource es = api.GetEditorEntity(i);
				if (es && es.GetLayerID() == targetLayerID)
					layerEntCount++;
			}

			int subScene2 = resp.currentSubScene;
			resp.layerID = targetLayerID;
			resp.layerEntityCount = layerEntCount;
			resp.layerVisible = api.IsEntityLayerVisible(subScene2, targetLayerID);
			resp.layerLocked = api.IsEntityLayerLocked(subScene2, targetLayerID);
			resp.layerActive = (api.GetCurrentEntityLayerId() == targetLayerID);
			resp.status = "ok";
			resp.message = "Layer " + req.layerPath + ": " + layerEntCount.ToString() + " entities";
		}
		else if (req.action == "toggleLock")
		{
			int targetLayerID;
			if (!ResolveLayerID(req, resp, targetLayerID))
				return resp;

			int subScene3 = resp.currentSubScene;
			bool wasLocked = api.IsEntityLayerLocked(subScene3, targetLayerID);
			if (wasLocked)
				api.UnlockEntityLayer(subScene3, targetLayerID);
			else
				api.LockEntityLayer(subScene3, targetLayerID);

			// Lock/UnlockEntityLayer are void - verify by reading the lock state back.
			bool nowLocked = api.IsEntityLayerLocked(subScene3, targetLayerID);
			resp.layerLocked = nowLocked;
			resp.layerID = targetLayerID;

			if (nowLocked == wasLocked)
			{
				resp.status = "error";
				resp.message = "Layer " + req.layerPath + " lock state did not change (still locked=" + nowLocked.ToString() + "); layer may not exist in sub-scene " + subScene3.ToString();
			}
			else
			{
				resp.status = "ok";
				if (nowLocked)
					resp.message = "Layer " + req.layerPath + " locked";
				else
					resp.message = "Layer " + req.layerPath + " unlocked";
			}
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: list, getActive, getEntityLayer, isVisible, getInfo, toggleLock";
		}

		return resp;
	}
}
