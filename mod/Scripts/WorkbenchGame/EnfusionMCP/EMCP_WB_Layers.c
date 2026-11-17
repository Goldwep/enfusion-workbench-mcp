/**
 * EMCP_WB_Layers.c - Sub-scene layers and folders of the open world (wave W1, wb_layers)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Layers", dispatching on "action"
 * (docs/v2/design/phase5-w1-spec.md section 2.4). One action surface (OD-6, DEC-061): the 1.x
 * names (getActive, getEntityLayer, isVisible, getInfo, toggleLock) are mapped by the TypeScript
 * tool, not here. Layers and folders are named by path; the engine's lock calls take a layer id,
 * which LayerIdOf resolves from the path (GetSubsceneLayerId checked by GetSubsceneLayerPath: alone
 * it answers 0, the default layer, for a folder or a missing path; W1 live run 2026-11-11).
 *   list          layers of one sub-scene: ids from the editor entities (GetLayerID) and from the
 *                 item paths (GetSubsceneFolders), with path (GetSubsceneLayerPath), visible
 *                 (IsEntityLayerVisible), locked (IsEntityLayerLocked) and entity count
 *   tree          item paths of one or every sub-scene (GetSubsceneFolders), a layer when
 *                 LayerIdOf answers an id, else a folder; visible (IsSubsceneLayerVisible),
 *                 locked (IsEntityLayerLocked, IsEntityLayerLockedHierarchy), entity count; paged
 *   create        CreateSubsceneLayer inside an entity action (undo)
 *   createFolder  CreateSubsceneFolder inside an entity action (undo)
 *   rename        RenameSubsceneFolder inside an entity action [unverified: a layer path, P-W1-08]
 *   delete        DeleteSubsceneFolder inside an entity action; a layer or folder that holds
 *                 entities or child items is refused NOT_EMPTY unless withContents is true, which
 *                 deletes the entities and child items first in the same action (a dry run unless
 *                 confirm is true); read back for a pathless layer (W1.7 run 7)
 *   move          SetSubsceneFolderParent inside an entity action [unverified: a layer path, P-W1-08]
 *   setActive     SetActiveSubsceneLayer, GetActiveSubsceneLayer read back (editor state)
 *   lock, unlock  LockEntityLayer / UnlockEntityLayer, IsEntityLayerLocked read back (editor state)
 *
 * Guards (spec section 1): list and tree none; every other action needs the project found
 * (EMCP_WB_Guard, DEC-058) and the World Editor out of play mode (WRONG_MODE). No file is written
 * here (layer persistence after a world save is P-W1-08). Paging: cursor "<start>:<count>", count =
 * the total at the first read; a changed total answers STALE_CURSOR; limit default 50, max 200.
 * Keys: contracts/EMCP_WB_Layers.json.
 */

class EMCP_WB_LayersRequest : JsonApiStruct
{
	string action;
	//! the sub-scene; -1 (left out) = the current one (tree: every sub-scene)
	int subScene;
	//! tree: nextCursor of the previous page
	string cursor;
	int limit;
	//! create, createFolder: the new item's name; rename: the new name
	string name;
	//! create, createFolder: the folder to create in; move: the new parent folder ("" = root)
	string parentPath;
	//! rename, delete, move, setActive, lock, unlock: a layer or folder path
	string layer;
	//! delete: with withContents, true deletes; else a dry run that names what would go
	bool confirm;
	//! delete: true deletes the entities and child layers or folders first, then the item; without
	//! it a layer or folder that holds anything is refused NOT_EMPTY (W1.7 run 7)
	bool withContents;

	void EMCP_WB_LayersRequest()
	{
		RegV("action");
		RegV("subScene");
		RegV("cursor");
		RegV("limit");
		RegV("name");
		RegV("parentPath");
		RegV("layer");
		RegV("confirm");
		RegV("withContents");

		// Defaults for keys the request leaves out.
		subScene = -1;
		confirm = false;
		withContents = false;
	}
}

class EMCP_WB_LayersResponse : JsonApiStruct
{
	//! ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	int currentSubScene;
	ref array<string> rows;
	int subScenes;
	string activeLayer;
	int total;
	string nextCursor;
	string layer;
	int layerId;
	string undoName;
	string before;
	string after;
	int entityCount;
	//! delete: layers and folders under the item
	int childCount;
	//! delete: editor entities removed (the count before minus the count after)
	int entitiesDeleted;
	bool dryRun;
	bool layerLocked;

	void EMCP_WB_LayersResponse()
	{
		rows = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("currentSubScene");
		RegV("rows");
		RegV("subScenes");
		RegV("activeLayer");
		RegV("total");
		RegV("nextCursor");
		RegV("layer");
		RegV("layerId");
		RegV("undoName");
		RegV("before");
		RegV("after");
		RegV("entityCount");
		RegV("childCount");
		RegV("entitiesDeleted");
		RegV("dryRun");
		RegV("layerLocked");
	}
}

//! Static helpers of the Layers handler that take neither the request nor the response.
class EMCP_WB_LayersUtil
{
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	static const string SEPARATOR = "/";

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
				why = "the layer tree changed since the cursor was issued (count " + count.ToString() + ", now " + total.ToString() + ")";
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
	//! "true" or "false".
	static string BoolText(bool value)
	{
		if (value)
			return "true";
		return "false";
	}

	//------------------------------------------------------------------------------------------------
	//! A field of a "|"-joined row: a "|" inside it becomes "/".
	static string Field(string value)
	{
		string s = value;
		s.Replace("|", "/");
		return s;
	}

	//------------------------------------------------------------------------------------------------
	//! The item paths of a sub-scene (GetSubsceneFolders).
	static void ItemPaths(WorldEditorAPI api, int sub, notnull array<string> outPaths)
	{
		outPaths.Clear();
		api.GetSubsceneFolders(sub, outPaths);
	}

	//------------------------------------------------------------------------------------------------
	//! The layer id of a layer path in a sub-scene, -1 when the path names no layer.
	//! GetSubsceneLayerId alone is not a test: on 1.9.0.37 it answered 0 (the default layer) for a
	//! folder and for paths that do not exist (W1 live run 2026-11-11: 'W1_F2' "exists already",
	//! lock and unlock acted on the default layer). The id counts only when GetSubsceneLayerPath of
	//! it reads the path back, or its leaf when GetSubsceneFolders lists the path.
	static int LayerIdOf(WorldEditorAPI api, int sub, string path)
	{
		if (!api || path == "")
			return -1;
		int lid = api.GetSubsceneLayerId(sub, path);
		if (lid < 0)
			return -1;
		string back = api.GetSubsceneLayerPath(sub, lid);
		if (back == path)
			return lid;
		string leaf = Leaf(path);
		if (leaf == path || back != leaf)
			return -1;
		array<string> paths = {};
		ItemPaths(api, sub, paths);
		if (paths.Find(path) < 0)
			return -1;
		return lid;
	}

	//------------------------------------------------------------------------------------------------
	//! True when a layer or folder path exists in a sub-scene: GetSubsceneFolders lists it, or it
	//! names a layer (LayerIdOf).
	static bool Exists(WorldEditorAPI api, int sub, string path)
	{
		if (path == "")
			return false;
		array<string> paths = {};
		ItemPaths(api, sub, paths);
		if (paths.Find(path) >= 0)
			return true;
		return LayerIdOf(api, sub, path) >= 0;
	}

	//------------------------------------------------------------------------------------------------
	//! Entities per layer id of one sub-scene (IEntitySource.GetSubScene and GetLayerID).
	static void EntityCounts(WorldEditorAPI api, int sub, notnull map<int, int> counts)
	{
		counts.Clear();
		int entityTotal = api.GetEditorEntityCount();
		for (int i = 0; i < entityTotal; i++)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (!src || src.GetSubScene() != sub)
				continue;
			int lid = src.GetLayerID();
			int have = 0;
			if (counts.Contains(lid))
				have = counts.Get(lid);
			counts.Set(lid, have + 1);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! What a layer or folder holds: outIds the layer ids of the item itself (when it is a layer) and of
	//! every layer under it; outItems the item paths under it (layers and folders), deepest first.
	static void Contents(WorldEditorAPI api, int sub, string path, notnull array<int> outIds, notnull array<string> outItems)
	{
		outIds.Clear();
		outItems.Clear();
		int ownId = LayerIdOf(api, sub, path);
		if (ownId >= 0)
			outIds.Insert(ownId);

		array<string> paths = {};
		ItemPaths(api, sub, paths);
		string prefix = path + SEPARATOR;
		array<string> under = {};
		foreach (string item : paths)
		{
			if (!item.StartsWith(prefix) || under.Find(item) >= 0)
				continue;
			under.Insert(item);
			int itemId = LayerIdOf(api, sub, item);
			if (itemId >= 0 && outIds.Find(itemId) < 0)
				outIds.Insert(itemId);
		}

		// Deepest first: a child item is deleted before the folder that holds it.
		int deepest = 0;
		foreach (string u : under)
		{
			int d = Depth(u);
			if (d > deepest)
				deepest = d;
		}
		for (int level = deepest; level >= 0; level--)
		{
			foreach (string v : under)
			{
				if (Depth(v) == level)
					outItems.Insert(v);
			}
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The number of separators in a path.
	static int Depth(string path)
	{
		int n = 0;
		for (int i = 0; i < path.Length(); i++)
		{
			if (path.Get(i) == SEPARATOR)
				n++;
		}
		return n;
	}

	//------------------------------------------------------------------------------------------------
	//! The parent entity source of an entity source, null at the top.
	static IEntitySource ParentSource(IEntitySource src)
	{
		if (!src)
			return null;
		BaseContainer parentCont = src.GetParent();
		if (!parentCont)
			return null;
		return parentCont.ToEntitySource();
	}

	//------------------------------------------------------------------------------------------------
	//! The editor entities of a sub-scene whose layer id is in layerIds.
	static void EntitiesOn(WorldEditorAPI api, int sub, notnull array<int> layerIds, notnull array<IEntitySource> outHeld)
	{
		outHeld.Clear();
		int entityTotal = api.GetEditorEntityCount();
		for (int i = 0; i < entityTotal; i++)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (!src || src.GetSubScene() != sub)
				continue;
			if (layerIds.Find(src.GetLayerID()) >= 0)
				outHeld.Insert(src);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The held entities whose parent is not held: deleting them deletes the rest with them.
	static void TopOf(notnull array<IEntitySource> held, notnull array<IEntitySource> outTop)
	{
		outTop.Clear();
		foreach (IEntitySource src : held)
		{
			IEntitySource parentSrc = ParentSource(src);
			if (!parentSrc || held.Find(parentSrc) < 0)
				outTop.Insert(src);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The name (or "#<index>") of the first editor entity that is NOT held but lies under a held one:
	//! deleting the held entities would delete it too. "" when there is none.
	static string ForeignDescendant(WorldEditorAPI api, notnull array<IEntitySource> held)
	{
		if (held.IsEmpty())
			return "";
		int entityTotal = api.GetEditorEntityCount();
		for (int i = 0; i < entityTotal; i++)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (!src || held.Find(src) >= 0)
				continue;
			IEntitySource walk = ParentSource(src);
			for (int depth = 0; depth < 64; depth++)
			{
				if (!walk)
					break;
				if (held.Find(walk) >= 0)
				{
					string label = src.GetName();
					if (label == "")
						label = "#" + i.ToString();
					return label;
				}
				walk = ParentSource(walk);
			}
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! Entities of a sub-scene left on any of layerIds (EntityCounts): a pathless layer that still
	//! holds entities after a delete shows here.
	static int LeftOn(WorldEditorAPI api, int sub, notnull array<int> layerIds)
	{
		map<int, int> counts = new map<int, int>();
		EntityCounts(api, sub, counts);
		int left = 0;
		foreach (int lid : layerIds)
		{
			if (counts.Contains(lid))
				left += counts.Get(lid);
		}
		return left;
	}

	//------------------------------------------------------------------------------------------------
	//! The last segment of a path.
	static string Leaf(string path)
	{
		int slash = path.LastIndexOf(SEPARATOR);
		if (slash < 0)
			return path;
		return path.Substring(slash + 1, path.Length() - slash - 1);
	}

	//------------------------------------------------------------------------------------------------
	//! The parent folder of a path, "" at the root.
	static string ParentOf(string path)
	{
		int slash = path.LastIndexOf(SEPARATOR);
		if (slash <= 0)
			return "";
		return path.Substring(0, slash);
	}

	//------------------------------------------------------------------------------------------------
	//! parent + "/" + leaf, or leaf at the root.
	static string Join(string parent, string leaf)
	{
		if (parent == "")
			return leaf;
		return parent + SEPARATOR + leaf;
	}

	//------------------------------------------------------------------------------------------------
	//! A new item name: not empty, no path separator or "|". why says what is wrong.
	static bool NameOk(string itemName, out string why)
	{
		why = "";
		if (itemName == "")
		{
			why = "name is empty";
			return false;
		}
		if (itemName.Contains("/") || itemName.Contains("\\") || itemName.Contains("|"))
		{
			why = "name must not hold '/', '\\' or '|': " + itemName;
			return false;
		}
		return true;
	}
}

class EMCP_WB_Layers : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string NO_WORLD = "NO_WORLD";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string NOT_EMPTY = "NOT_EMPTY";
	static const string NEXT_NOT_EMPTY = "move the entities out (wb_entity setLayer) and the child items out (wb_layers move), or resend with withContents true and confirm true to delete them with it";
	static const string TREE_NEXT = "list the layers and folders (wb_layers tree)";
	//! Undo history point names (BeginEntityAction).
	static const string UNDO_CREATE = "EMCP wb_layers create";
	static const string UNDO_CREATE_FOLDER = "EMCP wb_layers createFolder";
	static const string UNDO_RENAME = "EMCP wb_layers rename";
	static const string UNDO_DELETE = "EMCP wb_layers delete";
	static const string UNDO_MOVE = "EMCP wb_layers move";
	static const string NO_OWN_UNDO = "; BeginEntityAction returned false (an edit action was already open), so no own undo point";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_LayersRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_LayersRequest req = EMCP_WB_LayersRequest.Cast(request);
		EMCP_WB_LayersResponse resp = new EMCP_WB_LayersResponse();
		if (!req)
		{
			Refuse(resp, INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "list")
			ListLayers(req, resp);
		else if (req.action == "tree")
			ReadTree(req, resp);
		else if (req.action == "create")
			CreateLayer(req, resp);
		else if (req.action == "createFolder")
			CreateFolder(req, resp);
		else if (req.action == "rename")
			RenameItem(req, resp);
		else if (req.action == "delete")
			DeleteItem(req, resp);
		else if (req.action == "move")
			MoveItem(req, resp);
		else if (req.action == "setActive")
			SetActive(req, resp);
		else if (req.action == "lock")
			SetLocked(req.subScene, req.layer, true, resp);
		else if (req.action == "unlock")
			SetLocked(req.subScene, req.layer, false, resp);
		else
			Refuse(resp, INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of list, tree, create, createFolder, rename, delete, move, setActive, lock, unlock");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_LayersResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_LayersResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API, or null with the refusal written. GetModule opens a closed World Editor
	//! (DEC-053), as every 1.x World Editor handler does.
	protected static WorldEditorAPI EditorApi(EMCP_WB_LayersResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
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
	//! The guard of an in-memory edit (spec section 1, class "project"), in order: the project is
	//! found (DEC-058), the World Editor answers an API, the editor is not in play mode. Answers the
	//! API, or null with the refusal written.
	protected static WorldEditorAPI EditApi(EMCP_WB_LayersResponse resp)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "mutating actions need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return null;
		}
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return null;
		if (api.IsGameMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in play mode; nothing was changed", "stop play first (wb_world stop)");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The sub-scene a request names: -1 is the current one, else 0 <= requested < GetNumSubScenes.
	//! -2 with the refusal written when it is out of range.
	protected static int SubSceneOf(WorldEditorAPI api, int requested, EMCP_WB_LayersResponse resp)
	{
		if (requested == -1)
		{
			int current = api.GetCurrentSubScene();
			if (current < 0)
			{
				Refuse(resp, NO_WORLD, "GetCurrentSubScene answered " + current.ToString() + ": no world is open", "open a world (wb_module setResource)");
				return -2;
			}
			return current;
		}
		int subCount = api.GetNumSubScenes();
		if (requested < 0 || requested >= subCount)
		{
			Refuse(resp, INVALID_ARGUMENT, "subScene " + requested.ToString() + " is out of range (" + subCount.ToString() + " sub-scenes)", "omit subScene for the current one");
			return -2;
		}
		return requested;
	}

	//------------------------------------------------------------------------------------------------
	//! A layer or folder path that exists in the sub-scene; false with the refusal written.
	protected static bool ExistingItem(WorldEditorAPI api, int sub, string path, EMCP_WB_LayersResponse resp)
	{
		if (path == "")
		{
			Refuse(resp, INVALID_ARGUMENT, "layer is empty", "pass a layer or folder path");
			return false;
		}
		if (!EMCP_WB_LayersUtil.Exists(api, sub, path))
		{
			Refuse(resp, PATH_NOT_FOUND, "no layer or folder '" + path + "' in sub-scene " + sub.ToString(), TREE_NEXT);
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! list: the layers of one sub-scene by id; rows "id|path|visible|locked|count", ids ascending.
	static void ListLayers(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		resp.currentSubScene = api.GetCurrentSubScene();
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;

		map<int, int> counts = new map<int, int>();
		EMCP_WB_LayersUtil.EntityCounts(api, sub, counts);
		array<int> ids = {};
		for (int k = 0; k < counts.Count(); k++)
			ids.Insert(counts.GetKey(k));
		array<string> paths = {};
		EMCP_WB_LayersUtil.ItemPaths(api, sub, paths);
		foreach (string item : paths)
		{
			int itemId = EMCP_WB_LayersUtil.LayerIdOf(api, sub, item);
			if (itemId >= 0 && ids.Find(itemId) < 0)
				ids.Insert(itemId);
		}
		ids.Sort();

		foreach (int lid : ids)
		{
			int held = 0;
			if (counts.Contains(lid))
				held = counts.Get(lid);
			string row = lid.ToString();
			row += "|" + EMCP_WB_LayersUtil.Field(api.GetSubsceneLayerPath(sub, lid));
			row += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerVisible(sub, lid));
			row += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerLocked(sub, lid));
			row += "|" + held.ToString();
			resp.rows.Insert(row);
		}
		Answer(resp, "ok", "", ids.Count().ToString() + " layers in sub-scene " + sub.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! tree: the item paths of one sub-scene, or of every sub-scene when subScene is left out, then the
	//! layers that hold entities but no item path lists; rows "sub|path|id|kind|vis|lock|lockH|count",
	//! paged. kind is layer when LayerIdOf answers an id, else folder (P-W1-08 checks it).
	static void ReadTree(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		int subCount = api.GetNumSubScenes();
		int current = api.GetCurrentSubScene();
		int firstSub = 0;
		int lastSub = subCount - 1;
		int requested = req.subScene;
		if (requested != -1)
		{
			int sub = SubSceneOf(api, requested, resp);
			if (sub < 0)
				return;
			firstSub = sub;
			lastSub = sub;
		}

		array<string> all = {};
		for (int s = firstSub; s <= lastSub; s++)
		{
			map<int, int> counts = new map<int, int>();
			EMCP_WB_LayersUtil.EntityCounts(api, s, counts);
			array<int> listed = {};
			array<string> paths = {};
			EMCP_WB_LayersUtil.ItemPaths(api, s, paths);
			foreach (string item : paths)
			{
				int itemId = EMCP_WB_LayersUtil.LayerIdOf(api, s, item);
				string row = s.ToString() + "|" + EMCP_WB_LayersUtil.Field(item) + "|" + itemId.ToString();
				if (itemId >= 0)
				{
					listed.Insert(itemId);
					int held = 0;
					if (counts.Contains(itemId))
						held = counts.Get(itemId);
					row += "|layer";
					row += "|" + EMCP_WB_LayersUtil.BoolText(api.IsSubsceneLayerVisible(s, item));
					row += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerLocked(s, itemId));
					row += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerLockedHierarchy(s, itemId));
					row += "|" + held.ToString();
				}
				else
				{
					row += "|folder";
					row += "|" + EMCP_WB_LayersUtil.BoolText(api.IsSubsceneLayerVisible(s, item));
					row += "|||";
				}
				all.Insert(row);
			}

			array<int> unlisted = {};
			for (int k = 0; k < counts.Count(); k++)
			{
				int lid = counts.GetKey(k);
				if (listed.Find(lid) < 0)
					unlisted.Insert(lid);
			}
			unlisted.Sort();
			foreach (int extraId : unlisted)
			{
				string layerPath = api.GetSubsceneLayerPath(s, extraId);
				string extra = s.ToString() + "|" + EMCP_WB_LayersUtil.Field(layerPath) + "|" + extraId.ToString() + "|layer";
				extra += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerVisible(s, extraId));
				extra += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerLocked(s, extraId));
				extra += "|" + EMCP_WB_LayersUtil.BoolText(api.IsEntityLayerLockedHierarchy(s, extraId));
				int extraHeld = counts.Get(extraId);
				extra += "|" + extraHeld.ToString();
				all.Insert(extra);
			}
		}

		int total = all.Count();
		int first = 0;
		int stop = 0;
		string code = "";
		string why = "";
		if (!EMCP_WB_LayersUtil.PageWindow(req.cursor, req.limit, total, first, stop, code, why))
		{
			Refuse(resp, code, why, "read again without a cursor");
			return;
		}
		for (int r = first; r < stop; r++)
			resp.rows.Insert(all.Get(r));
		resp.subScenes = subCount;
		resp.activeLayer = api.GetActiveSubsceneLayer(current);
		resp.total = total;
		resp.nextCursor = EMCP_WB_LayersUtil.NextCursor(stop, total);
		int read = lastSub - firstSub + 1;
		Answer(resp, "ok", "", total.ToString() + " items in " + read.ToString() + " sub-scene(s); rows " + first.ToString() + " to " + stop.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! create: CreateSubsceneLayer inside an entity action; the path it answers and its layer id.
	static void CreateLayer(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;
		string itemName = req.name;
		string why = "";
		if (!EMCP_WB_LayersUtil.NameOk(itemName, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass a plain name");
			return;
		}
		string parentPath = req.parentPath;
		if (parentPath != "" && !EMCP_WB_LayersUtil.Exists(api, sub, parentPath))
		{
			Refuse(resp, PATH_NOT_FOUND, "no folder '" + parentPath + "' in sub-scene " + sub.ToString(), TREE_NEXT);
			return;
		}

		resp.undoName = UNDO_CREATE;
		bool began = api.BeginEntityAction(UNDO_CREATE);
		string created = api.CreateSubsceneLayer(sub, itemName, parentPath);
		if (began)
			api.EndEntityAction(UNDO_CREATE);

		if (created == "")
		{
			Answer(resp, "error", ENGINE_FALSE, "CreateSubsceneLayer answered an empty path", TREE_NEXT);
			return;
		}
		resp.layer = created;
		resp.layerId = EMCP_WB_LayersUtil.LayerIdOf(api, sub, created);
		string note = "";
		if (!began)
			note = NO_OWN_UNDO;
		Answer(resp, "ok", "", "created layer " + created + " (id " + resp.layerId.ToString() + ")" + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! createFolder: CreateSubsceneFolder inside an entity action; the path it answers.
	static void CreateFolder(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;
		string itemName = req.name;
		string why = "";
		if (!EMCP_WB_LayersUtil.NameOk(itemName, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass a plain name");
			return;
		}
		string parentPath = req.parentPath;
		if (parentPath != "" && !EMCP_WB_LayersUtil.Exists(api, sub, parentPath))
		{
			Refuse(resp, PATH_NOT_FOUND, "no folder '" + parentPath + "' in sub-scene " + sub.ToString(), TREE_NEXT);
			return;
		}

		resp.undoName = UNDO_CREATE_FOLDER;
		bool began = api.BeginEntityAction(UNDO_CREATE_FOLDER);
		string created = api.CreateSubsceneFolder(sub, itemName, parentPath);
		if (began)
			api.EndEntityAction(UNDO_CREATE_FOLDER);

		if (created == "")
		{
			Answer(resp, "error", ENGINE_FALSE, "CreateSubsceneFolder answered an empty path", TREE_NEXT);
			return;
		}
		resp.layer = created;
		string note = "";
		if (!began)
			note = NO_OWN_UNDO;
		Answer(resp, "ok", "", "created folder " + created + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! rename: RenameSubsceneFolder inside an entity action; after is the parent joined with the new
	//! name, checked by the read back. [unverified] whether it takes a layer path (P-W1-08).
	static void RenameItem(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;
		string path = req.layer;
		if (!ExistingItem(api, sub, path, resp))
			return;
		string itemName = req.name;
		string why = "";
		if (!EMCP_WB_LayersUtil.NameOk(itemName, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass a plain name");
			return;
		}
		string target = EMCP_WB_LayersUtil.Join(EMCP_WB_LayersUtil.ParentOf(path), itemName);
		if (target != path && EMCP_WB_LayersUtil.Exists(api, sub, target))
		{
			Refuse(resp, INVALID_ARGUMENT, "'" + target + "' exists already; nothing was changed", "pick another name");
			return;
		}

		resp.before = path;
		resp.undoName = UNDO_RENAME;
		bool began = api.BeginEntityAction(UNDO_RENAME);
		bool renamed = api.RenameSubsceneFolder(sub, path, itemName);
		if (began)
			api.EndEntityAction(UNDO_RENAME);

		resp.after = target;
		if (!renamed)
		{
			Answer(resp, "error", ENGINE_FALSE, "RenameSubsceneFolder returned false for '" + path + "'", TREE_NEXT);
			return;
		}
		string note = "";
		if (!EMCP_WB_LayersUtil.Exists(api, sub, target))
			note = "; '" + target + "' is not found in the read back (path form unverified, P-W1-08)";
		if (!began)
			note += NO_OWN_UNDO;
		Answer(resp, "ok", "", "renamed " + path + " to " + target + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! delete: DeleteSubsceneFolder inside one entity action (one undo point).
	//! W1.7 run 7 (1.9.0.37): DeleteSubsceneFolder on a layer that held an entity answered true but left
	//! a pathless layer still holding the entity (layer path ""), and the save then dropped the entity.
	//! So an item that holds entities or child layers or folders is refused NOT_EMPTY, unless
	//! withContents is true: then (with confirm; without it a dry run) the held entities are deleted
	//! first (DeleteEntity / DeleteEntities, the wb_entity delete path, on the top-most held entities),
	//! then the child items deepest first, then the item, all inside the one action; the read back
	//! must find no item left, no entity on the removed layer ids and no pathless layer.
	static void DeleteItem(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;
		string path = req.layer;
		if (!ExistingItem(api, sub, path, resp))
			return;

		array<int> layerIds = {};
		array<string> childItems = {};
		EMCP_WB_LayersUtil.Contents(api, sub, path, layerIds, childItems);
		array<IEntitySource> held = {};
		EMCP_WB_LayersUtil.EntitiesOn(api, sub, layerIds, held);
		int heldCount = held.Count();
		int childTotal = childItems.Count();
		resp.entityCount = heldCount;
		resp.childCount = childTotal;
		string holds = "'" + path + "' holds " + heldCount.ToString() + " entities and " + childTotal.ToString() + " child layers or folders";

		if ((heldCount > 0 || childTotal > 0) && !req.withContents)
		{
			Refuse(resp, NOT_EMPTY, holds + "; nothing was deleted (DeleteSubsceneFolder on a non-empty layer leaves a pathless layer and its entities)", NEXT_NOT_EMPTY);
			return;
		}
		string foreign = EMCP_WB_LayersUtil.ForeignDescendant(api, held);
		if (foreign != "")
		{
			Refuse(resp, INVALID_ARGUMENT, "entity " + foreign + " lies on another layer under an entity in '" + path + "' and would be deleted with it; nothing was deleted", "unparent it or move it to this layer first (wb_entity unparent, wb_entity setLayer)");
			return;
		}
		if (heldCount > 0 && !req.confirm)
		{
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: " + holds + ", which would be deleted with it; nothing was changed; pass confirm true to delete", "");
			return;
		}

		array<IEntitySource> top = {};
		EMCP_WB_LayersUtil.TopOf(held, top);
		int countBefore = api.GetEditorEntityCount();
		resp.dryRun = false;
		resp.undoName = UNDO_DELETE;
		if (!api.BeginEntityAction(UNDO_DELETE))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was deleted, since one undo must restore it all", "finish the open edit in the World Editor, then retry");
			return;
		}
		bool entitiesOk = true;
		if (top.Count() == 1)
			entitiesOk = api.DeleteEntity(top.Get(0));
		else if (top.Count() > 1)
			entitiesOk = api.DeleteEntities(top);
		// The held sources are deleted now: none is read again below.
		held.Clear();
		top.Clear();
		string failedItems = "";
		if (entitiesOk)
		{
			foreach (string child : childItems)
			{
				if (!EMCP_WB_LayersUtil.Exists(api, sub, child))
					continue;
				if (api.DeleteSubsceneFolder(sub, child))
					resp.rows.Insert(child);
				else
					failedItems += " " + child;
			}
		}
		bool deleted = false;
		if (entitiesOk && failedItems == "")
			deleted = api.DeleteSubsceneFolder(sub, path);
		api.EndEntityAction(UNDO_DELETE);
		resp.entitiesDeleted = countBefore - api.GetEditorEntityCount();

		if (!entitiesOk)
		{
			Answer(resp, "error", ENGINE_FALSE, "the entity delete returned false for the " + heldCount.ToString() + " entities in '" + path + "'; the layer was not deleted", "wb_undo_redo undo, then read wb_layers tree");
			return;
		}
		if (failedItems != "")
		{
			Answer(resp, "error", ENGINE_FALSE, "DeleteSubsceneFolder returned false for" + failedItems + "; '" + path + "' was not deleted", "wb_undo_redo undo, then read wb_layers tree");
			return;
		}
		if (!deleted)
		{
			Answer(resp, "error", ENGINE_FALSE, "DeleteSubsceneFolder returned false for '" + path + "'", "wb_undo_redo undo, then read wb_layers tree");
			return;
		}
		resp.rows.Insert(path);

		string left = "";
		if (EMCP_WB_LayersUtil.Exists(api, sub, path))
			left += "; '" + path + "' is still found";
		foreach (string gone : childItems)
		{
			if (EMCP_WB_LayersUtil.Exists(api, sub, gone))
				left += "; '" + gone + "' is still found";
		}
		int orphans = EMCP_WB_LayersUtil.LeftOn(api, sub, layerIds);
		if (orphans > 0)
			left += "; " + orphans.ToString() + " entities are left on a removed layer id (a pathless layer)";
		if (resp.entitiesDeleted != heldCount)
			left += "; the editor entity count fell by " + resp.entitiesDeleted.ToString() + ", not " + heldCount.ToString();
		if (left != "")
		{
			Answer(resp, "error", ENGINE_FALSE, "deleted " + path + " but the read back differs" + left, "wb_undo_redo undo restores it");
			return;
		}
		Answer(resp, "ok", "", "deleted " + path + " with " + heldCount.ToString() + " entities and " + childTotal.ToString() + " child items; read back: no item, no entity on its layers", "");
	}

	//------------------------------------------------------------------------------------------------
	//! move: SetSubsceneFolderParent inside an entity action; parentPath "" is the root.
	//! [unverified] whether it takes a layer path (P-W1-08).
	static void MoveItem(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;
		string path = req.layer;
		if (!ExistingItem(api, sub, path, resp))
			return;
		string parentPath = req.parentPath;
		if (parentPath == path || parentPath.StartsWith(path + EMCP_WB_LayersUtil.SEPARATOR))
		{
			Refuse(resp, INVALID_ARGUMENT, "'" + path + "' cannot move under itself", "pass another parentPath");
			return;
		}
		if (parentPath != "" && !EMCP_WB_LayersUtil.Exists(api, sub, parentPath))
		{
			Refuse(resp, PATH_NOT_FOUND, "no folder '" + parentPath + "' in sub-scene " + sub.ToString(), TREE_NEXT);
			return;
		}
		string target = EMCP_WB_LayersUtil.Join(parentPath, EMCP_WB_LayersUtil.Leaf(path));

		resp.before = path;
		resp.undoName = UNDO_MOVE;
		bool began = api.BeginEntityAction(UNDO_MOVE);
		bool moved = api.SetSubsceneFolderParent(sub, path, parentPath);
		if (began)
			api.EndEntityAction(UNDO_MOVE);

		resp.after = target;
		if (!moved)
		{
			Answer(resp, "error", ENGINE_FALSE, "SetSubsceneFolderParent returned false for '" + path + "'", TREE_NEXT);
			return;
		}
		string note = "";
		if (!EMCP_WB_LayersUtil.Exists(api, sub, target))
			note = "; '" + target + "' is not found in the read back (path form unverified, P-W1-08)";
		if (!began)
			note += NO_OWN_UNDO;
		Answer(resp, "ok", "", "moved " + path + " to " + target + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! setActive: SetActiveSubsceneLayer on a layer path; before and after are GetActiveSubsceneLayer
	//! (editor state: restore with setActive before).
	static void SetActive(EMCP_WB_LayersRequest req, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, req.subScene, resp);
		if (sub < 0)
			return;
		string path = req.layer;
		if (path == "" || EMCP_WB_LayersUtil.LayerIdOf(api, sub, path) < 0)
		{
			Refuse(resp, PATH_NOT_FOUND, "no layer '" + path + "' in sub-scene " + sub.ToString() + " (a folder cannot be active)", TREE_NEXT);
			return;
		}

		resp.before = api.GetActiveSubsceneLayer(sub);
		api.SetActiveSubsceneLayer(sub, path);
		resp.after = api.GetActiveSubsceneLayer(sub);
		if (resp.after != path)
		{
			Answer(resp, "error", ENGINE_FALSE, "the active layer reads back '" + resp.after + "', not '" + path + "'", TREE_NEXT);
			return;
		}
		Answer(resp, "ok", "", "active layer " + resp.after + " (was " + resp.before + ")", "");
	}

	//------------------------------------------------------------------------------------------------
	//! lock, unlock: LockEntityLayer / UnlockEntityLayer on the layer id of a path, read back with
	//! IsEntityLayerLocked (editor state: undo with the other action).
	static void SetLocked(int requested, string path, bool locked, EMCP_WB_LayersResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		int sub = SubSceneOf(api, requested, resp);
		if (sub < 0)
			return;
		int lid = -1;
		if (path != "")
			lid = EMCP_WB_LayersUtil.LayerIdOf(api, sub, path);
		if (lid < 0)
		{
			Refuse(resp, PATH_NOT_FOUND, "no layer '" + path + "' in sub-scene " + sub.ToString() + " (a folder has no lock)", TREE_NEXT);
			return;
		}

		if (locked)
			api.LockEntityLayer(sub, lid);
		else
			api.UnlockEntityLayer(sub, lid);
		bool now = api.IsEntityLayerLocked(sub, lid);
		resp.layerLocked = now;
		if (now != locked)
		{
			Answer(resp, "error", ENGINE_FALSE, "layer '" + path + "' reads back locked " + EMCP_WB_LayersUtil.BoolText(now), TREE_NEXT);
			return;
		}
		Answer(resp, "ok", "", "layer " + path + " locked " + EMCP_WB_LayersUtil.BoolText(now), "");
	}
}
