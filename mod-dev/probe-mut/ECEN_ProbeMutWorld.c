/**
 * ECEN_ProbeMutWorld.c - World Editor writes of the mutating probe pack
 *
 * layerCreateThrowaway (U17 write half) and terrainWriteThrowaway (U18). Both act only when the
 * world open in the World Editor is the target, an .ent under the 2.0 sandbox's _throwaway/
 * folder, with exactly one sub-scene (ECEN_ProbeMutGuard.ThrowawayWorld). WorldEditor.Save() is
 * called only when the request sets save, and only after that check and a successful write, so it
 * saves the throwaway world. A terrain write runs only after BeginTerrainAction returned true.
 */

class ECEN_ProbeMutWorld
{
	//! Largest height change terrainWriteThrowaway applies to one sample, in metres.
	static const float MAX_TERRAIN_DELTA = 10.0;
	//! Largest brush terrainWriteThrowaway uses in modify mode, in metres.
	static const float MAX_BRUSH_SIZE = 50.0;
	//! History point name of the terrain write.
	static const string TERRAIN_ACTION = "ECEN probe terrain write";

	//------------------------------------------------------------------------------------------------
	//! Saves the world when the request asks for it. Callers have passed ThrowawayWorld.
	static void SaveIfAsked(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		bool save = req.save;
		resp.Fact("save", save.ToString());
		if (!save)
			return;
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
			return;
		bool saved = worldEditor.Save();
		resp.Fact("saved", saved.ToString());
	}

	//------------------------------------------------------------------------------------------------
	//! True when list holds item.
	static bool Holds(array<string> list, string item)
	{
		for (int i = 0; i < list.Count(); i++)
		{
			if (list.Get(i) == item)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! layerCreateThrowaway: CreateSubsceneLayer(subScene, name, parentPath) in the throwaway world,
	//! optionally SetActiveSubsceneLayer on the new layer, then the items GetSubsceneFolders returns.
	//! The layer name must start with "ECEN_". ThrowawayWorld has checked that the world has exactly
	//! one sub-scene; subScene must be that one (-1 or GetCurrentSubScene()), parentPath must be
	//! empty or an item GetSubsceneFolders returns, and the save runs only when the returned layer
	//! path is a new item of that sub-scene (an item path of the layer tree, not a file path [the
	//! form is unverified]: no ':' and no "..").
	static void LayerCreateThrowaway(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		string absolute = "";
		string why = "";
		WorldEditorAPI api = ECEN_ProbeMutGuard.ThrowawayWorld(req.target, absolute, why);
		if (!api)
		{
			resp.Refuse(why);
			return;
		}

		string name = req.name;
		if (!name.StartsWith("ECEN_") || !ECEN_ProbeMutGuard.IsIdentifier(name))
		{
			resp.Fail("name must be an identifier starting with ECEN_");
			return;
		}

		int current = api.GetCurrentSubScene();
		int subScene = req.subScene;
		if (subScene < 0)
			subScene = current;
		if (subScene != current)
		{
			resp.Refuse("subScene must be the throwaway world's own sub-scene " + current.ToString());
			return;
		}

		array<string> before = {};
		api.GetSubsceneFolders(subScene, before);
		int beforeCount = before.Count();
		string parentPath = req.parentPath;
		if (parentPath != "" && !Holds(before, parentPath))
		{
			resp.Refuse("parentPath must be empty or an item GetSubsceneFolders returns for the throwaway world");
			return;
		}

		resp.Fact("target", req.target);
		resp.Fact("subScene", subScene.ToString());
		resp.Fact("itemsBefore", beforeCount.ToString());
		string created = api.CreateSubsceneLayer(subScene, name, parentPath);
		resp.Fact("created", ECEN_ProbeMutGuard.ShowPath(created));

		array<string> after = {};
		api.GetSubsceneFolders(subScene, after);
		bool createdIsNewItem = created != "" && Holds(after, created) && !Holds(before, created) && !created.Contains(":") && !created.Contains("..");
		resp.Fact("createdIsNewItem", createdIsNewItem.ToString());

		bool setActive = req.setActive;
		if (setActive && createdIsNewItem)
		{
			api.SetActiveSubsceneLayer(subScene, created);
			resp.Fact("activeLayer", ECEN_ProbeMutGuard.ShowPath(api.GetActiveSubsceneLayer(subScene)));
		}

		resp.SetColumns("path,layerId,visible");
		for (int i = 0; i < after.Count(); i++)
		{
			string itemPath = after.Get(i);
			int layerId = api.GetSubsceneLayerId(subScene, itemPath);
			bool visible = api.IsSubsceneLayerVisible(subScene, itemPath);
			resp.Cell(ECEN_ProbeMutGuard.ShowPath(itemPath));
			resp.Cell(layerId.ToString());
			resp.Cell(visible.ToString());
		}

		if (!createdIsNewItem)
		{
			resp.Fail("CreateSubsceneLayer did not return a new item of the throwaway world's sub-scene; nothing saved");
			return;
		}
		SaveIfAsked(req, resp);
		resp.Ok("layer created");
	}

	//------------------------------------------------------------------------------------------------
	//! terrainWriteThrowaway in mode "tile": GetTerrainSurfaceTile, one sample changed by delta,
	//! SetTerrainSurfaceTile inside BeginTerrainAction(name) / EndTerrainAction, read back.
	//! Mode "modify" (ModifyHeightMap with a brush) fails by name: build 1.9.0.37 removed the call
	//! and its brush types; the arguments are still range-checked.
	static void TerrainWriteThrowaway(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		string absolute = "";
		string why = "";
		WorldEditorAPI api = ECEN_ProbeMutGuard.ThrowawayWorld(req.target, absolute, why);
		if (!api)
		{
			resp.Refuse(why);
			return;
		}

		resp.Fact("target", req.target);
		resp.Fact("mode", req.mode);
		if (req.mode == "tile")
			WriteTile(req, resp, api);
		else if (req.mode == "modify")
			ModifyAt(req, resp, api);
		else
			resp.Fail("mode must be tile or modify");
	}

	//------------------------------------------------------------------------------------------------
	static void WriteTile(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp, WorldEditorAPI api)
	{
		float delta = req.delta;
		if (delta > MAX_TERRAIN_DELTA || delta < -MAX_TERRAIN_DELTA)
		{
			resp.Fail("delta must lie within +/- " + MAX_TERRAIN_DELTA.ToString());
			return;
		}

		int terrainIndex = req.terrainIndex;
		int tileX = req.tileX;
		int tileY = req.tileY;
		int sample = req.sample;
		array<float> heights = {};
		bool got = api.GetTerrainSurfaceTile(terrainIndex, tileX, tileY, heights);
		int count = heights.Count();
		resp.Fact("read", got.ToString());
		resp.Fact("samples", count.ToString());
		if (!got || sample < 0 || sample >= count)
		{
			resp.Fail("tile not read, or sample out of range");
			return;
		}

		// The first four samples show the array order.
		resp.SetColumns("sample,height");
		for (int i = 0; i < count && i < 4; i++)
		{
			float shown = heights.Get(i);
			resp.Cell(i.ToString());
			resp.Cell(shown.ToString());
		}

		float before = heights.Get(sample);
		heights.Set(sample, before + delta);
		bool began = api.BeginTerrainAction(TERRAIN_ACTION);
		resp.Fact("began", began.ToString());
		if (!began)
		{
			// No write outside an undo history point, and no EndTerrainAction without its Begin.
			resp.Fail("BeginTerrainAction returned false; nothing written");
			return;
		}
		bool wrote = api.SetTerrainSurfaceTile(terrainIndex, tileX, tileY, heights);
		api.EndTerrainAction(TERRAIN_ACTION);

		array<float> again = {};
		bool reread = api.GetTerrainSurfaceTile(terrainIndex, tileX, tileY, again);
		resp.Fact("wrote", wrote.ToString());
		resp.Fact("before", before.ToString());
		if (reread && sample < again.Count())
		{
			float after = again.Get(sample);
			resp.Fact("after", after.ToString());
		}

		SaveIfAsked(req, resp);
		resp.Ok("tile write done");
	}

	//------------------------------------------------------------------------------------------------
	static void ModifyAt(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp, WorldEditorAPI api)
	{
		float size = req.size;
		if (size <= 0 || size > MAX_BRUSH_SIZE)
		{
			resp.Fail("size must lie in (0, " + MAX_BRUSH_SIZE.ToString() + "]");
			return;
		}

		float inner = req.inner;
		if (inner < 0 || inner > 100)
		{
			resp.Fail("inner must lie in [0, 100] (a percentage of size)");
			return;
		}

		// Build 1.9.0.37 removed WorldEditorAPI.ModifyHeightMap with TerrainToolDesc, TerrainToolType and
		// the FilterMorph enums; BeginTerrainAction now takes the history point name only. Mode "tile"
		// (SetTerrainSurfaceTile) is the terrain write that is left.
		resp.Fact("x", req.x.ToString());
		resp.Fact("z", req.z.ToString());
		resp.Fail("mode modify: WorldEditorAPI.ModifyHeightMap is absent from build 1.9.0.37 on; use mode tile");
	}
}
