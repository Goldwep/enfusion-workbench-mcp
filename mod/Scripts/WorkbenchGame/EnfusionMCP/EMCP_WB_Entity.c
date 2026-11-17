/**
 * EMCP_WB_Entity.c - Entity handler of wb_entity (wave W1, phase5-w1-spec.md section 2.1)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Entity", dispatching on "action":
 *   list       editor entities (GetEditorEntity), paged; filters: parent, layer, subScene,
 *              className (class or ancestor prefab), name, topLevel
 *   get        one entity: id, names, class, ancestor, parent, layer, transform, flags, components
 *   children   direct children of an entity (GetNumChildren, GetChild), paged
 *   query      entities inside a sphere or a box (BaseWorld.QueryEntitiesBySphere/AABB), paged
 *   create     CreateEntity (CreateEntityExt with placement) under a parent, in a layer
 *   clone      CreateClonedEntity
 *   delete     DeleteEntity for one, DeleteEntities for more, in one undo step
 *   parent     ParentEntity for one, ParentEntities for more, in one undo step
 *   unparent   RemoveEntityFromParent per entity, in one undo step
 *   rename     RenameEntity
 *   transform  SetVariableValue on coords, angles, scale, in one undo step (plain writes: the
 *              edit sequence of P-W1-25 is not used until that probe passes)
 *   setLayer   SetEntitySubsceneLayer per entity, read back with GetEntitySubsceneLayer
 *
 * Entities are named by the W1 reference (EMCP_WB_EntityRef: id:<hex> | name:<name> | index:<i>).
 * Guards (spec section 1): reads need none. Every mutating action is an in-memory World Editor
 * edit: the project must be found (EMCP_WB_Guard, DEC-058), the editor must not be in play mode
 * (WRONG_MODE), and the edit runs inside BeginEntityAction / EndEntityAction with an undo name,
 * so wb_undo_redo reverts it. Nothing here writes a file. No confirm (OD-3, DEC-061).
 * Paging: cursor "<start>:<count>", count = the total at the first read; a changed total answers
 * STALE_CURSOR. limit default 50, max 200.
 * A refusal answers status "refused" with code and next set and message in the form
 * "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Entity.json.
 */

class EMCP_WB_EntityRequest : JsonApiStruct
{
	string action;
	//! list: entity ref whose children are listed; create, clone: the new entity's parent;
	//! parent: the entity the others are parented under
	string parent;
	//! list: layer path filter; create: layer path (default the active layer); setLayer: target
	string layer;
	//! list: sub-scene filter (-1: all); setLayer: sub-scene (-1: current)
	int subScene;
	//! list: class or ancestor prefab substring, any case
	string className;
	//! list: name substring, any case; create, clone: the new name; rename: the new name
	string name;
	//! list: top-level entities only
	bool topLevel;
	//! list, children, query: "<start>:<count>" from nextCursor
	string cursor;
	//! list, children, query: rows per page (default 50, max 200)
	int limit;
	//! get, children, clone, rename, transform: entity ref
	string entity;
	//! query: sphere centre "x y z", with radius
	string center;
	//! query: metres, as text (EMCP_WB_Common.ParseFloat). Text, not float: the W1 live run of
	//! 2026-11-11 showed a JSON integer never reaches a float field through RegV (radius 5 read as
	//! not given, scale 2 unchanged, wb_view distance 8 read as 0).
	string radius;
	//! query: box corners "x y z"
	string mins;
	string maxs;
	//! create: class name or {GUID}path
	string prefab;
	//! create, transform: "x y z"
	string coords;
	string angles;
	//! create: CreateEntityExt (Template Library placement) instead of CreateEntity
	bool placement;
	//! clone: children too (default true)
	bool cloneChildren;
	//! delete, parent, unparent, setLayer: entity refs, at most 200
	ref array<string> entities;
	//! parent: passed as transformChildToParentSpace (default true)
	bool keepWorldTransform;
	//! transform: uniform scale (> 0) as text; "" when not given (see radius)
	string scale;

	void EMCP_WB_EntityRequest()
	{
		entities = {};

		RegV("action");
		RegV("parent");
		RegV("layer");
		RegV("subScene");
		RegV("className");
		RegV("name");
		RegV("topLevel");
		RegV("cursor");
		RegV("limit");
		RegV("entity");
		RegV("center");
		RegV("radius");
		RegV("mins");
		RegV("maxs");
		RegV("prefab");
		RegV("coords");
		RegV("angles");
		RegV("placement");
		RegV("cloneChildren");
		RegV("entities");
		RegV("keepWorldTransform");
		RegV("scale");

		// Defaults for keys the request leaves out.
		subScene = -1;
		limit = 0;
		cloneChildren = true;
		keepWorldTransform = true;
	}
}

class EMCP_WB_EntityResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	//! list, children, query: "id|name|class|parent|layer|sub|kids"
	ref array<string> rows;
	int total;
	string nextCursor;
	string id;
	string name;
	string niceName;
	string className;
	string ancestor;
	string parentId;
	//! get, create: the parent's name ("" at the top level), a read-back that needs no id
	string parentName;
	//! get: GetID().ToString() of the source and of its runtime entity, verbatim (P-W1-01 records them)
	string idText;
	string runtimeIdText;
	string layer;
	int subScene;
	string coords;
	string angles;
	bool visible;
	bool selected;
	int childCount;
	//! get: "index|class"
	ref array<string> components;
	string undoName;
	ref array<string> deleted;
	ref array<string> missing;
	ref array<string> parented;
	ref array<string> unparented;
	string before;
	string after;
	ref array<string> moved;

	void EMCP_WB_EntityResponse()
	{
		rows = {};
		components = {};
		deleted = {};
		missing = {};
		parented = {};
		unparented = {};
		moved = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("rows");
		RegV("total");
		RegV("nextCursor");
		RegV("id");
		RegV("name");
		RegV("niceName");
		RegV("className");
		RegV("ancestor");
		RegV("parentId");
		RegV("parentName");
		RegV("idText");
		RegV("runtimeIdText");
		RegV("layer");
		RegV("subScene");
		RegV("coords");
		RegV("angles");
		RegV("visible");
		RegV("selected");
		RegV("childCount");
		RegV("components");
		RegV("undoName");
		RegV("deleted");
		RegV("missing");
		RegV("parented");
		RegV("unparented");
		RegV("before");
		RegV("after");
		RegV("moved");
	}
}

//! Collector of a world query: the callback BaseWorld.QueryEntitiesBySphere/AABB calls per entity.
class EMCP_WB_EntityQuery
{
	ref array<IEntity> m_Found;
	int m_Cap;

	void EMCP_WB_EntityQuery(int cap)
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

class EMCP_WB_Entity : NetApiHandler
{
	//! Rows per page: default and most (spec section 1).
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! Entity refs one delete, parent, unparent or setLayer takes at most.
	static const int MAX_REFS = 200;
	//! Entities a world query collects at most before it stops.
	static const int MAX_QUERY = 20000;
	//! Components get lists at most.
	static const int MAX_COMPONENTS = 256;
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string NO_WORLD = "NO_WORLD";
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	//! Undo history point names (BeginEntityAction).
	static const string UNDO_CREATE = "EMCP wb_entity create";
	static const string UNDO_CLONE = "EMCP wb_entity clone";
	static const string UNDO_DELETE = "EMCP wb_entity delete";
	static const string UNDO_PARENT = "EMCP wb_entity parent";
	static const string UNDO_UNPARENT = "EMCP wb_entity unparent";
	static const string UNDO_RENAME = "EMCP wb_entity rename";
	static const string UNDO_TRANSFORM = "EMCP wb_entity transform";
	static const string UNDO_SET_LAYER = "EMCP wb_entity setLayer";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_EntityRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_EntityRequest req = EMCP_WB_EntityRequest.Cast(request);
		EMCP_WB_EntityResponse resp = new EMCP_WB_EntityResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "list")
			ListEntities(req, resp);
		else if (req.action == "get")
			GetOne(req, resp);
		else if (req.action == "children")
			ListChildren(req, resp);
		else if (req.action == "query")
			QueryWorld(req, resp);
		else if (req.action == "create")
			CreateOne(req, resp);
		else if (req.action == "clone")
			CloneOne(req, resp);
		else if (req.action == "delete")
			DeleteMany(req, resp);
		else if (req.action == "parent")
			ParentMany(req, resp);
		else if (req.action == "unparent")
			UnparentMany(req, resp);
		else if (req.action == "rename")
			RenameOne(req, resp);
		else if (req.action == "transform")
			TransformOne(req, resp);
		else if (req.action == "setLayer")
			SetLayerMany(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of list, get, children, query, create, clone, delete, parent, unparent, rename, transform, setLayer");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_EntityResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_EntityResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, so EndEntityAction never closes an action this handler did
	//! not begin (review E2).
	protected static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_EntityResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		resp.undoName = "";
		Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API, or null with the error written. GetModule opens a closed World Editor
	//! (DEC-053), as every 1.x entity handler does.
	protected static WorldEditorAPI EditorApi(EMCP_WB_EntityResponse resp)
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
			Answer(resp, "error", NO_WORLD, "the World Editor has no API: no world is open", "open a world (wb_module setResource)");
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Answer(resp, "error", NO_WORLD, noWorld, "open a world (wb_module setResource)");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of an in-memory edit (spec section 1, class "project"), in order: the project is
	//! found (DEC-058), the World Editor answers an API, the editor is not in play mode. Answers the
	//! API, or null with the refusal written.
	protected static WorldEditorAPI EditApi(EMCP_WB_EntityResponse resp)
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
	//! Resolves one entity reference (EMCP_WB_EntityRef.Resolve); null with the error written.
	protected static IEntitySource ResolveOne(WorldEditorAPI api, string entityRef, EMCP_WB_EntityResponse resp)
	{
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, entityRef, resolved))
		{
			Answer(resp, "error", resolved.m_Code, resolved.m_Why, "list the entities (wb_entity list) and pass the id: it answers");
			return null;
		}
		return resolved.m_Src;
	}

	//------------------------------------------------------------------------------------------------
	//! Resolves a list of references into found (no duplicates); a reference that names no entity goes
	//! to missing. False with code and why when the list is empty, too long, or a reference is
	//! malformed (nothing is done then).
	protected static bool ResolveMany(WorldEditorAPI api, array<string> refs, notnull array<IEntitySource> found, notnull array<string> missingRefs, out string code, out string why)
	{
		code = "";
		why = "";
		if (!refs || refs.Count() == 0)
		{
			code = INVALID_ARGUMENT;
			why = "entities must hold at least one entity reference";
			return false;
		}
		if (refs.Count() > MAX_REFS)
		{
			code = INVALID_ARGUMENT;
			why = "entities holds " + refs.Count().ToString() + " references, at most " + MAX_REFS.ToString();
			return false;
		}
		// One resolver for the whole list: the id: map is built once (review R1).
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
			string refCode = resolved.m_Code;
			if (refCode == EMCP_WB_EntityRef.ENTITY_NOT_FOUND)
			{
				missingRefs.Insert(entityRef);
				continue;
			}
			code = refCode;
			why = "entities[" + i.ToString() + "]: " + resolved.m_Why;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The parent entity source of an entity, null for a top-level one (BaseContainer.GetParent,
	//! BaseResourceObject.ToEntitySource).
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
	//! The resource name of an entity's ancestor (its prefab), "" when it has none.
	static string AncestorOf(IEntitySource src)
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
	//! The layer path of an entity (GetSubsceneLayerPath of its sub-scene and layer id).
	static string LayerOf(WorldEditorAPI api, IEntitySource src)
	{
		if (!api || !src)
			return "";
		return api.GetSubsceneLayerPath(src.GetSubScene(), src.GetLayerID());
	}

	//------------------------------------------------------------------------------------------------
	//! One row: "id|name|class|parent|layer|sub|kids".
	static string Row(WorldEditorAPI api, IEntitySource src)
	{
		string parentRef = EMCP_WB_EntityRef.Format(ParentOf(src));
		string row = EMCP_WB_EntityRef.Format(src) + "|" + src.GetName() + "|" + src.GetClassName() + "|" + parentRef;
		row = row + "|" + LayerOf(api, src) + "|" + src.GetSubScene().ToString() + "|" + src.GetNumChildren().ToString();
		return row;
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
	//! Parses "<start>:<count>" (both decimal, start <= count). False on anything else.
	static bool ParseCursor(string cursorText, out int start, out int count)
	{
		start = 0;
		count = 0;
		int colon = cursorText.IndexOf(":");
		if (colon <= 0 || colon >= cursorText.Length() - 1)
			return false;
		string startText = cursorText.Substring(0, colon);
		string countText = cursorText.Substring(colon + 1, cursorText.Length() - colon - 1);
		if (!IsDigits(startText) || !IsDigits(countText))
			return false;
		int startValue = startText.ToInt();
		int countValue = countText.ToInt();
		if (startValue > countValue)
			return false;
		start = startValue;
		count = countValue;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! One page of items as rows: total, rows and nextCursor ("<start>:<count>", empty on the last
	//! page). A cursor whose count is not the current total answers STALE_CURSOR.
	protected static void Page(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp, WorldEditorAPI api, array<IEntitySource> items, string what)
	{
		int total = items.Count();
		int start = 0;
		if (req.cursor != "")
		{
			int issuedFor = 0;
			if (!ParseCursor(req.cursor, start, issuedFor))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "cursor must be <start>:<count> as nextCursor answered, got '" + req.cursor + "'", "omit cursor for the first page");
				return;
			}
			if (issuedFor != total)
			{
				Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " items, the list now has " + total.ToString(), "read again without a cursor");
				return;
			}
		}
		int pageSize = req.limit;
		if (pageSize <= 0)
			pageSize = PAGE_DEFAULT;
		if (pageSize > PAGE_MAX)
			pageSize = PAGE_MAX;

		int end = start + pageSize;
		if (end > total)
			end = total;
		resp.total = total;
		for (int i = start; i < end; i++)
			resp.rows.Insert(Row(api, items.Get(i)));
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();
		int shown = end - start;
		Answer(resp, "ok", "", what + ": " + shown.ToString() + " of " + total.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! list: GetEditorEntity over the editor list with the filters, then one page.
	protected static void ListEntities(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;

		IEntitySource parentSrc = null;
		if (req.parent != "")
		{
			parentSrc = ResolveOne(api, req.parent, resp);
			if (!parentSrc)
				return;
		}
		int layerSubScene = req.subScene;
		if (layerSubScene < 0)
			layerSubScene = api.GetCurrentSubScene();
		int layerId = -1;
		if (req.layer != "")
		{
			layerId = EMCP_WB_LayersUtil.LayerIdOf(api, layerSubScene, req.layer);
			if (layerId < 0)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", "no layer '" + req.layer + "' in sub-scene " + layerSubScene.ToString(), "list the layers (wb_layers list)");
				return;
			}
		}
		string classFilter = req.className;
		classFilter.ToLower();
		string nameFilter = req.name;
		nameFilter.ToLower();

		array<IEntitySource> items = {};
		int count = api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			IEntitySource src = api.GetEditorEntity(i);
			if (!src)
				continue;
			if (req.subScene >= 0 && src.GetSubScene() != req.subScene)
				continue;
			if (layerId >= 0 && (src.GetSubScene() != layerSubScene || src.GetLayerID() != layerId))
				continue;
			if (req.topLevel && ParentOf(src))
				continue;
			if (parentSrc && ParentOf(src) != parentSrc)
				continue;
			if (nameFilter != "")
			{
				string lowerName = src.GetName();
				lowerName.ToLower();
				if (!lowerName.Contains(nameFilter))
					continue;
			}
			if (classFilter != "")
			{
				string lowerClass = src.GetClassName();
				lowerClass.ToLower();
				if (!lowerClass.Contains(classFilter))
				{
					string lowerAncestor = AncestorOf(src);
					lowerAncestor.ToLower();
					if (!lowerAncestor.Contains(classFilter))
						continue;
				}
			}
			items.Insert(src);
		}
		Page(req, resp, api, items, "entities");
	}

	//------------------------------------------------------------------------------------------------
	//! get: one entity in detail.
	protected static void GetOne(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;

		resp.id = EMCP_WB_EntityRef.Format(src);
		resp.name = src.GetName();
		resp.niceName = api.GetEntityNiceName(src);
		resp.className = src.GetClassName();
		resp.ancestor = AncestorOf(src);
		IEntitySource parentSrc = ParentOf(src);
		resp.parentId = EMCP_WB_EntityRef.Format(parentSrc);
		if (parentSrc)
			resp.parentName = parentSrc.GetName();
		resp.idText = EMCP_WB_EntityRef.RawIdText(src);
		resp.runtimeIdText = EMCP_WB_EntityRef.RuntimeIdText(api, src);
		resp.layer = LayerOf(api, src);
		resp.subScene = src.GetSubScene();
		IEntity ent = api.SourceToEntity(src);
		if (ent)
		{
			resp.coords = EMCP_WB_Common.VectorToString(ent.GetOrigin());
			resp.angles = EMCP_WB_Common.VectorToString(ent.GetAngles());
		}
		resp.visible = api.IsEntityVisible(src);
		resp.selected = api.IsEntitySelected(src);
		resp.childCount = src.GetNumChildren();
		int componentCount = src.GetComponentCount();
		for (int c = 0; c < componentCount && c < MAX_COMPONENTS; c++)
		{
			IEntityComponentSource comp = src.GetComponent(c);
			string compClass = "null";
			if (comp)
				compClass = comp.GetClassName();
			resp.components.Insert(c.ToString() + "|" + compClass);
		}
		Answer(resp, "ok", "", "entity read", "");
	}

	//------------------------------------------------------------------------------------------------
	//! children: GetNumChildren and GetChild of the entity source, then one page.
	protected static void ListChildren(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;

		array<IEntitySource> items = {};
		int count = src.GetNumChildren();
		for (int i = 0; i < count; i++)
		{
			BaseContainer childCont = src.GetChild(i);
			if (!childCont)
				continue;
			IEntitySource child = childCont.ToEntitySource();
			if (child)
				items.Insert(child);
		}
		Page(req, resp, api, items, "children");
	}

	//------------------------------------------------------------------------------------------------
	//! query: QueryEntitiesBySphere (center, radius) or QueryEntitiesByAABB (mins, maxs) on the
	//! World Editor's world, each entity mapped back with EntityToSource, then one page.
	protected static void QueryWorld(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		bool sphere = req.center != "";
		bool box = req.mins != "" || req.maxs != "";
		if (sphere == box)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "give either center with radius, or mins with maxs", "one shape per query");
			return;
		}
		vector first = vector.Zero;
		vector second = vector.Zero;
		float radiusValue = 0;
		string parseErr = "";
		if (sphere)
		{
			if (!EMCP_WB_Common.ParseVectorString(req.center, first, parseErr))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "center: " + parseErr, "center as \"x y z\"");
				return;
			}
			if (!EMCP_WB_Common.ParseFloat(req.radius, radiusValue) || radiusValue <= 0)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "radius must be a number above 0, got '" + req.radius + "'", "pass radius with center");
				return;
			}
		}
		else
		{
			if (!EMCP_WB_Common.ParseVectorString(req.mins, first, parseErr) || !EMCP_WB_Common.ParseVectorString(req.maxs, second, parseErr))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "mins and maxs: " + parseErr, "both corners as \"x y z\"");
				return;
			}
		}

		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Answer(resp, "error", NO_WORLD, "GetWorld returned null", "open a world (wb_module setResource)");
			return;
		}

		EMCP_WB_EntityQuery collector = new EMCP_WB_EntityQuery(MAX_QUERY);
		if (sphere)
			world.QueryEntitiesBySphere(first, radiusValue, collector.AddEntity, null, EQueryEntitiesFlags.ALL);
		else
			world.QueryEntitiesByAABB(first, second, collector.AddEntity, null, EQueryEntitiesFlags.ALL);

		// Dedupe through a set (O(log n) per entity), not a linear Find per entity (review E1).
		array<IEntitySource> items = {};
		set<IEntitySource> seen = new set<IEntitySource>();
		for (int i = 0; i < collector.m_Found.Count(); i++)
		{
			IEntitySource src = api.EntityToSource(collector.m_Found.Get(i));
			if (src && seen.Insert(src))
				items.Insert(src);
		}
		Page(req, resp, api, items, "entities in the shape");
	}

	//------------------------------------------------------------------------------------------------
	//! create: CreateEntity (CreateEntityExt with placement) under the parent, in the layer.
	protected static void CreateOne(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (req.prefab == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "prefab required", "a class name or {GUID}path");
			return;
		}
		vector pos = vector.Zero;
		vector rot = vector.Zero;
		string parseErr = "";
		if (req.coords != "" && !EMCP_WB_Common.ParseVectorString(req.coords, pos, parseErr))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "coords: " + parseErr, "coords as \"x y z\"");
			return;
		}
		if (req.angles != "" && !EMCP_WB_Common.ParseVectorString(req.angles, rot, parseErr))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "angles: " + parseErr, "angles as \"x y z\"");
			return;
		}
		IEntitySource parentSrc = null;
		if (req.parent != "")
		{
			parentSrc = ResolveOne(api, req.parent, resp);
			if (!parentSrc)
				return;
		}
		int layerId = api.GetCurrentEntityLayerId();
		if (req.layer != "")
		{
			int currentSubScene = api.GetCurrentSubScene();
			layerId = EMCP_WB_LayersUtil.LayerIdOf(api, currentSubScene, req.layer);
			if (layerId < 0)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", "no layer '" + req.layer + "' in sub-scene " + currentSubScene.ToString() + "; nothing was created", "list the layers (wb_layers list)");
				return;
			}
		}

		resp.undoName = UNDO_CREATE;
		if (!BeginEdit(api, UNDO_CREATE, resp))
			return;
		IEntitySource created = null;
		if (req.placement)
		{
			// [unverified] the trace flags CreateEntityExt expects (P-W1-03): the world and entities.
			int traceFlags = TraceFlags.WORLD | TraceFlags.ENTS;
			created = api.CreateEntityExt(req.prefab, req.name, layerId, parentSrc, pos, rot, traceFlags);
		}
		else
			created = api.CreateEntity(req.prefab, req.name, layerId, parentSrc, pos, rot);
		if (!created)
		{
			api.EndEntityAction();
			Answer(resp, "error", ENGINE_FALSE, "the create call returned null for '" + req.prefab + "'; nothing was created", "check the class name or {GUID}path");
			return;
		}
		bool renameFailed = false;
		if (req.name != "" && created.GetName() != req.name)
			renameFailed = !api.RenameEntity(created, req.name);
		api.EndEntityAction();

		resp.id = EMCP_WB_EntityRef.Format(created);
		resp.name = created.GetName();
		resp.className = created.GetClassName();
		IEntitySource createdParent = ParentOf(created);
		resp.parentId = EMCP_WB_EntityRef.Format(createdParent);
		if (createdParent)
			resp.parentName = createdParent.GetName();
		resp.layer = LayerOf(api, created);
		if (renameFailed)
		{
			Answer(resp, "error", ENGINE_FALSE, "created, but RenameEntity to '" + req.name + "' returned false (name in use?)", "rename it, or undo the create (wb_undo_redo)");
			return;
		}
		Answer(resp, "ok", "", "created; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! clone: CreateClonedEntity of the entity, optionally under a parent, with or without children.
	protected static void CloneOne(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;
		IEntitySource parentSrc = null;
		if (req.parent != "")
		{
			parentSrc = ResolveOne(api, req.parent, resp);
			if (!parentSrc)
				return;
		}

		resp.undoName = UNDO_CLONE;
		if (!BeginEdit(api, UNDO_CLONE, resp))
			return;
		IEntitySource cloned = api.CreateClonedEntity(src, req.name, parentSrc, req.cloneChildren);
		api.EndEntityAction();
		if (!cloned)
		{
			Answer(resp, "error", ENGINE_FALSE, "CreateClonedEntity returned null; nothing was cloned", "read the entity back with get");
			return;
		}
		resp.id = EMCP_WB_EntityRef.Format(cloned);
		resp.name = cloned.GetName();
		resp.childCount = cloned.GetNumChildren();
		Answer(resp, "ok", "", "cloned; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! delete: DeleteEntity for one entity, DeleteEntities for more, in one entity action.
	protected static void DeleteMany(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (!ResolveMany(api, req.entities, found, resp.missing, code, why))
		{
			Answer(resp, "error", code, why + "; nothing was deleted", "pass entity references as wb_entity list answers them");
			return;
		}
		if (found.Count() == 0)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an entity; nothing was deleted", "list the entities (wb_entity list)");
			return;
		}
		array<string> ids = {};
		for (int i = 0; i < found.Count(); i++)
			ids.Insert(EMCP_WB_EntityRef.Format(found.Get(i)));

		resp.undoName = UNDO_DELETE;
		if (!BeginEdit(api, UNDO_DELETE, resp))
			return;
		bool deletedOk = false;
		if (found.Count() == 1)
			deletedOk = api.DeleteEntity(found.Get(0));
		else
			deletedOk = api.DeleteEntities(found);
		api.EndEntityAction();
		if (!deletedOk)
		{
			Answer(resp, "error", ENGINE_FALSE, "the delete call returned false", "list the entities to see what is left; undo with wb_undo_redo");
			return;
		}
		for (int d = 0; d < ids.Count(); d++)
			resp.deleted.Insert(ids.Get(d));
		Answer(resp, "ok", "", "deleted " + ids.Count().ToString() + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! parent: ParentEntity for one entity, ParentEntities for more, under one parent.
	protected static void ParentMany(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (req.parent == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "parent required", "the entity the others go under");
			return;
		}
		IEntitySource parentSrc = ResolveOne(api, req.parent, resp);
		if (!parentSrc)
			return;
		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (!ResolveMany(api, req.entities, found, resp.missing, code, why))
		{
			Answer(resp, "error", code, why + "; nothing was parented", "pass entity references as wb_entity list answers them");
			return;
		}
		if (found.Find(parentSrc) >= 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "an entity cannot be its own parent; nothing was parented", "leave the parent out of entities");
			return;
		}
		if (found.Count() == 0)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an entity; nothing was parented", "list the entities (wb_entity list)");
			return;
		}

		// [unverified] keepWorldTransform is passed as transformChildToParentSpace (P-W1-06).
		bool toParentSpace = req.keepWorldTransform;
		resp.undoName = UNDO_PARENT;
		if (!BeginEdit(api, UNDO_PARENT, resp))
			return;
		bool parentedOk = false;
		if (found.Count() == 1)
			parentedOk = api.ParentEntity(parentSrc, found.Get(0), toParentSpace);
		else
			parentedOk = api.ParentEntities(parentSrc, found, toParentSpace);
		api.EndEntityAction();
		if (!parentedOk)
		{
			Answer(resp, "error", ENGINE_FALSE, "the parent call returned false", "read the entities back with get; undo with wb_undo_redo");
			return;
		}
		for (int i = 0; i < found.Count(); i++)
			resp.parented.Insert(EMCP_WB_EntityRef.Format(found.Get(i)));
		Answer(resp, "ok", "", "parented " + found.Count().ToString() + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! unparent: RemoveEntityFromParent per entity that has a parent, in one entity action.
	protected static void UnparentMany(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (!ResolveMany(api, req.entities, found, resp.missing, code, why))
		{
			Answer(resp, "error", code, why + "; nothing was unparented", "pass entity references as wb_entity list answers them");
			return;
		}
		array<IEntitySource> childSources = {};
		for (int i = 0; i < found.Count(); i++)
		{
			if (ParentOf(found.Get(i)))
				childSources.Insert(found.Get(i));
		}
		int skipped = found.Count() - childSources.Count();
		if (childSources.Count() == 0)
		{
			Answer(resp, "ok", "", "nothing to do: no named entity has a parent", "");
			return;
		}

		resp.undoName = UNDO_UNPARENT;
		int failed = 0;
		if (!BeginEdit(api, UNDO_UNPARENT, resp))
			return;
		for (int c = 0; c < childSources.Count(); c++)
		{
			IEntitySource child = childSources.Get(c);
			if (api.RemoveEntityFromParent(child))
				resp.unparented.Insert(EMCP_WB_EntityRef.Format(child));
			else
				failed++;
		}
		api.EndEntityAction();
		if (failed > 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "RemoveEntityFromParent returned false for " + failed.ToString() + " of " + childSources.Count().ToString(), "read the entities back with get; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", "unparented " + childSources.Count().ToString() + " (" + skipped.ToString() + " already top-level); undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! rename: RenameEntity, read back with GetName.
	protected static void RenameOne(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (req.name == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "name required", "the new name");
			return;
		}
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;

		resp.id = EMCP_WB_EntityRef.Format(src);
		resp.before = src.GetName();
		resp.undoName = UNDO_RENAME;
		if (!BeginEdit(api, UNDO_RENAME, resp))
			return;
		bool renamed = api.RenameEntity(src, req.name);
		api.EndEntityAction();
		resp.after = src.GetName();
		if (!renamed)
		{
			Answer(resp, "error", ENGINE_FALSE, "RenameEntity returned false (name in use?)", "pick another name");
			return;
		}
		Answer(resp, "ok", "", "renamed; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! The source values of coords, angles and scale as "coords|angles|scale".
	static string TransformText(IEntitySource src)
	{
		vector pos = vector.Zero;
		vector rot = vector.Zero;
		float uniform = 1;
		src.Get("coords", pos);
		src.Get("angles", rot);
		src.Get("scale", uniform);
		return EMCP_WB_Common.VectorToString(pos) + "|" + EMCP_WB_Common.VectorToString(rot) + "|" + uniform.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! transform: SetVariableValue on coords, angles and scale (those given), in one entity action.
	protected static void TransformOne(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		bool hasScale = req.scale != "";
		if (req.coords == "" && req.angles == "" && !hasScale)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "give coords, angles or scale", "at least one of the three");
			return;
		}
		vector pos = vector.Zero;
		vector rot = vector.Zero;
		string parseErr = "";
		if (req.coords != "" && !EMCP_WB_Common.ParseVectorString(req.coords, pos, parseErr))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "coords: " + parseErr, "coords as \"x y z\"");
			return;
		}
		if (req.angles != "" && !EMCP_WB_Common.ParseVectorString(req.angles, rot, parseErr))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "angles: " + parseErr, "angles as \"x y z\"");
			return;
		}
		float scaleValue = 1;
		if (hasScale && (!EMCP_WB_Common.ParseFloat(req.scale, scaleValue) || scaleValue <= 0))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "scale must be a number above 0, got '" + req.scale + "'", "a positive scale");
			return;
		}
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;

		resp.id = EMCP_WB_EntityRef.Format(src);
		resp.before = TransformText(src);
		resp.undoName = UNDO_TRANSFORM;
		string failedKeys = "";
		if (!BeginEdit(api, UNDO_TRANSFORM, resp))
			return;
		if (req.coords != "" && !api.SetVariableValue(src, null, "coords", EMCP_WB_Common.VectorToString(pos)))
			failedKeys += " coords";
		if (req.angles != "" && !api.SetVariableValue(src, null, "angles", EMCP_WB_Common.VectorToString(rot)))
			failedKeys += " angles";
		if (hasScale && !api.SetVariableValue(src, null, "scale", scaleValue.ToString()))
			failedKeys += " scale";
		api.EndEntityAction();
		resp.after = TransformText(src);
		if (failedKeys != "")
		{
			Answer(resp, "error", ENGINE_FALSE, "SetVariableValue returned false for" + failedKeys, "read the entity back with get; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", "transformed; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! setLayer: SetEntitySubsceneLayer per entity, read back with GetEntitySubsceneLayer.
	protected static void SetLayerMany(EMCP_WB_EntityRequest req, EMCP_WB_EntityResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		if (req.layer == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "layer required", "a layer path (wb_layers list)");
			return;
		}
		int targetSubScene = req.subScene;
		if (targetSubScene < 0)
			targetSubScene = api.GetCurrentSubScene();
		if (EMCP_WB_LayersUtil.LayerIdOf(api, targetSubScene, req.layer) < 0)
		{
			Answer(resp, "error", "PATH_NOT_FOUND", "no layer '" + req.layer + "' in sub-scene " + targetSubScene.ToString() + "; nothing was moved", "list the layers (wb_layers list)");
			return;
		}
		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (!ResolveMany(api, req.entities, found, resp.missing, code, why))
		{
			Answer(resp, "error", code, why + "; nothing was moved", "pass entity references as wb_entity list answers them");
			return;
		}
		if (found.Count() == 0)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an entity; nothing was moved", "list the entities (wb_entity list)");
			return;
		}

		resp.undoName = UNDO_SET_LAYER;
		int failed = 0;
		IEntitySource firstMoved = null;
		if (!BeginEdit(api, UNDO_SET_LAYER, resp))
			return;
		for (int i = 0; i < found.Count(); i++)
		{
			IEntitySource src = found.Get(i);
			if (api.SetEntitySubsceneLayer(targetSubScene, src, req.layer))
			{
				resp.moved.Insert(EMCP_WB_EntityRef.Format(src));
				if (!firstMoved)
					firstMoved = src;
			}
			else
				failed++;
		}
		api.EndEntityAction();
		// The layer the engine reports for the first moved entity (P-W1-07 checks it sticks).
		if (firstMoved)
			resp.layer = api.GetEntitySubsceneLayer(targetSubScene, firstMoved);
		if (failed > 0)
		{
			Answer(resp, "error", ENGINE_FALSE, "SetEntitySubsceneLayer returned false for " + failed.ToString() + " of " + found.Count().ToString(), "read the entities back with get; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", "moved " + found.Count().ToString() + "; undo with wb_undo_redo", "");
	}
}
