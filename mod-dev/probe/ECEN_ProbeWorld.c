/**
 * ECEN_ProbeWorld.c - World Editor reads of the read-only probe pack
 *
 * layerRead (U17 read half): the sub-scene folders and layers through GetSubsceneFolders,
 * GetActiveSubsceneLayer and GetSubsceneLayerPath. terrainFacts (W1 input): terrain resolution,
 * tile counts, unit scale and bounds. Nothing here changes the world. Paths go through
 * ECEN_ProbeUtil.ShowPath.
 */

class ECEN_ProbeWorld
{
	//------------------------------------------------------------------------------------------------
	//! layerRead: sub-scene counts, the active layer, the current entity layer and its path, and one
	//! row per item GetSubsceneFolders returns with its layer id and visibility. A sub-scene index
	//! outside [0, GetNumSubScenes() - 1] (after -1 becomes the current one) is an error.
	static void LayerRead(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.Fail("WorldEditor module is not open; layerRead never opens a module");
			return;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			resp.Fail("WorldEditorAPI not available (game mode, or no world loaded)");
			return;
		}

		int current = api.GetCurrentSubScene();
		int subSceneCount = api.GetNumSubScenes();
		int subScene = req.subScene;
		if (subScene < 0)
			subScene = current;

		string worldPath = "";
		api.GetWorldPath(worldPath);
		resp.Fact("worldPath", ECEN_ProbeUtil.ShowPath(worldPath));
		resp.Fact("currentSubScene", current.ToString());
		resp.Fact("subScenes", subSceneCount.ToString());
		resp.Fact("subScene", subScene.ToString());

		// After the -1 substitution the index must name a sub-scene: the current one is -1 when no
		// world is loaded, and no getter below is called with an index the world does not hold.
		if (subScene < 0 || subScene >= subSceneCount)
		{
			resp.Fact("error", "subScene out of range");
			resp.Fail("subScene " + subScene.ToString() + " is out of range: the world holds " + subSceneCount.ToString() + " sub-scenes (none when no world is loaded)");
			return;
		}

		string active = api.GetActiveSubsceneLayer(subScene);
		int currentLayer = api.GetCurrentEntityLayerId();
		string currentLayerPath = "";
		if (currentLayer >= 0)
			currentLayerPath = api.GetSubsceneLayerPath(subScene, currentLayer);

		resp.Fact("activeLayer", ECEN_ProbeUtil.ShowPath(active));
		resp.Fact("currentEntityLayerId", currentLayer.ToString());
		resp.Fact("currentEntityLayerPath", ECEN_ProbeUtil.ShowPath(currentLayerPath));

		array<string> items = {};
		api.GetSubsceneFolders(subScene, items);
		resp.SetColumns("path,layerId,visible");
		array<string> all = {};
		for (int i = 0; i < items.Count(); i++)
		{
			string itemPath = items.Get(i);
			int layerId = api.GetSubsceneLayerId(subScene, itemPath);
			bool visible = api.IsSubsceneLayerVisible(subScene, itemPath);
			all.Insert(ECEN_ProbeUtil.ShowPath(itemPath));
			all.Insert(layerId.ToString());
			all.Insert(visible.ToString());
		}

		ECEN_ProbeUtil.PageInto(resp, all, 3, req.page);
		resp.Ok("layers read");
	}

	//------------------------------------------------------------------------------------------------
	//! terrainFacts: the terrain bounds, then resolution, tiles and unit scale of terrain 0. Without a
	//! terrain (GetTerrainBounds false) it answers "no terrain"; a terrainIndex other than 0 is an error.
	static void TerrainFacts(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.Fail("WorldEditor module is not open; terrainFacts never opens a module");
			return;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			resp.Fail("WorldEditorAPI not available (game mode, or no world loaded)");
			return;
		}

		int terrainIndex = req.terrainIndex;
		resp.Fact("terrainIndex", terrainIndex.ToString());
		// Only terrain 0 is read: no getter reports how many terrains a world holds, so no other
		// index is known to be in range.
		if (terrainIndex != 0)
		{
			resp.Fact("error", "terrainIndex out of range");
			resp.Fail("terrainIndex must be 0; got " + terrainIndex.ToString());
			return;
		}

		string worldPath = "";
		api.GetWorldPath(worldPath);
		resp.Fact("worldPath", ECEN_ProbeUtil.ShowPath(worldPath));

		// GetTerrainBounds first: without a terrain no terrain getter is called.
		vector boundsMin;
		vector boundsMax;
		bool hasBounds = worldEditor.GetTerrainBounds(boundsMin, boundsMax);
		resp.Fact("hasBounds", hasBounds.ToString());
		if (!hasBounds)
		{
			resp.Fact("terrain", "none");
			resp.Ok("no terrain: GetTerrainBounds returned false");
			return;
		}
		resp.Fact("boundsMin", boundsMin.ToString(false));
		resp.Fact("boundsMax", boundsMax.ToString(false));

		int resolutionX = api.GetTerrainResolutionX(terrainIndex);
		int resolutionY = api.GetTerrainResolutionY(terrainIndex);
		int tilesX = api.GetTerrainTilesX(terrainIndex);
		int tilesY = api.GetTerrainTilesY(terrainIndex);
		float unitScale = api.GetTerrainUnitScale(terrainIndex);
		resp.Fact("resolutionX", resolutionX.ToString());
		resp.Fact("resolutionY", resolutionY.ToString());
		resp.Fact("tilesX", tilesX.ToString());
		resp.Fact("tilesY", tilesY.ToString());
		resp.Fact("unitScale", unitScale.ToString());
		resp.Ok("terrain facts read");
	}
}
