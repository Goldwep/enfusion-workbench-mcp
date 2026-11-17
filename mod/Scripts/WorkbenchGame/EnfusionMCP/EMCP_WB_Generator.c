/**
 * EMCP_WB_Generator.c - Generator handler of wb_generator (wave W7, phase5-w7-spec.md section 2.2;
 * DEC-075 OD-2, OD-6, OD-7, OD-12)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Generator", dispatching on "action":
 *   list        the generators (entities whose class inherits GeneratorBaseEntity) of one shape (its
 *               children) or of the whole world (the editor entity list), paged, as rows
 *               "id|className|prefab|shapeId", plus AreGeneratorEventsEnabled
 *   attach      a generator prefab ({GUID}path .et, resolved with Workbench.GetResourceName, never
 *               GetAbsolutePath: base-game generator prefabs are packed) created as a child of a shape:
 *               Resource.Load, GetResource().ToEntitySource(), its class must inherit
 *               GeneratorBaseEntity (NOT_A_GENERATOR), then CreateEntity(prefab, name, the shape's layer,
 *               parent = the shape, vector.Zero, vector.Zero) in one entity action (the call of
 *               SCR_ImportShapefilePlugin). GATED until probe P-W7-10 (ATTACH_OPEN).
 *   detach      DeleteEntity of a generator, or of every generator child of a shape, in one entity
 *               action. GATED until probe P-W7-10 (ATTACH_OPEN).
 *   regenerate  rebuilds the generators of a shape, by the route REGENERATE_ROUTE names (DEC-075 OD-7,
 *               route A preferred; probe P-W7-11 picks one and the other is removed when the gate
 *               opens). Route A: ShapeEntity.GetAllInfluenceBBoxes/3 into two local arrays, then
 *               GeneratorBaseEntity.OnShapeChanged/4 on each child generator. Route B: point 0's
 *               Position set to its current value through a ("Points", 0) path, so the editor raises
 *               the shape-changed event itself. Either inside one entity action. GATED until probe
 *               P-W7-11 (REGENERATE_OPEN).
 *   pointData   adds (CreateObjectArrayVariableMember "Data", dataClass, at the end) or removes
 *               (RemoveObjectArrayVariableMember "Data", dataIndex) a generator data entry on one shape
 *               point, in one entity action; answers the point's data count read back. dataClass must
 *               inherit ShapePointDataScriptBase. GATED until probe P-W7-13 (POINTDATA_OPEN).
 *   events      ToggleGeneratorEvents: editor-wide, not undoable; answers was (the state before) so the
 *               caller can restore it (OD-6). GATED until probe P-W7-12 (EVENTS_OPEN).
 *
 * Guards (spec section 1.2): every action goes through the shared world-loaded check
 * (EMCP_WB_Common.NoWorldReason) before any other World Editor call; Workbench.GetModule(WorldEditor)
 * opens a closed World Editor. list needs nothing more. The mutating actions check their arguments
 * first (no engine call but ToType), then refuse GATED while their gate is false, before any engine
 * call; then the project must be found (EMCP_WB_Guard.IsProjectFound, DEC-058), the editor must not
 * be in play mode (WRONG_MODE) and the open world must lie under the project's "$<id>:" prefix
 * (GetWorldPath, the check of wb_module save and wb_particle spawn; NOT_IN_PROJECT otherwise). Each
 * entity edit is one BeginEntityAction / EndEntityAction with an undo name, so wb_undo_redo reverts
 * it; no confirm (DEC-061 OD-3, DEC-075 OD-12). Nothing here writes a file. Entities are named by the
 * W1 reference (EMCP_WB_EntityRef). Paging: cursor "<start>:<count>", count = the total at the first
 * read; a changed total answers STALE_CURSOR. limit default 50, max 200.
 * A refusal answers status "refused" (or "error") with code and next set and message in the form
 * "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Generator.json.
 */

class EMCP_WB_GeneratorRequest : JsonApiStruct
{
	string action;
	//! list (optional), attach, regenerate, pointData: entity ref of the shape
	string shape;
	//! list: "<start>:<count>" from nextCursor
	string cursor;
	//! list: rows per page (default 50, max 200)
	int limit;
	//! attach: the generator prefab, {GUID}path (or a project-relative path) ending in .et
	string prefab;
	//! attach: the new entity's name (default generated)
	string name;
	//! detach: entity ref of a generator, or of a shape (all its generators)
	string entity;
	//! pointData: add or remove
	string op;
	//! pointData: the point's index
	int index;
	//! pointData add: the data class (inherits ShapePointDataScriptBase)
	string dataClass;
	//! pointData remove: the data entry's index (default 0)
	int dataIndex;
	//! events: the state to set (TS sends a JSON boolean, the proven confirm form)
	bool enabled;

	void EMCP_WB_GeneratorRequest()
	{
		RegV("action");
		RegV("shape");
		RegV("cursor");
		RegV("limit");
		RegV("prefab");
		RegV("name");
		RegV("entity");
		RegV("op");
		RegV("index");
		RegV("dataClass");
		RegV("dataIndex");
		RegV("enabled");

		// Defaults for keys the request leaves out: a missing index is refused, not read as point 0.
		limit = 0;
		index = -1;
		dataIndex = 0;
	}
}

class EMCP_WB_GeneratorResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string action;
	string code;
	string message;
	string next;
	//! list: "id|className|prefab|shapeId"
	ref array<string> rows;
	//! list: AreGeneratorEventsEnabled; events: the state after the call
	bool eventsEnabled;
	//! list: generators found
	int total;
	string nextCursor;
	//! attach: the new generator; detach: the deleted generator, or the shape whose generators went
	string id;
	//! attach: the new generator's class
	string className;
	string undoName;
	//! regenerate: generators the call reached
	int generators;
	//! pointData: data entries on the point, read back
	int count;
	//! events: the state before the call
	bool was;

	void EMCP_WB_GeneratorResponse()
	{
		rows = {};

		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("next");
		RegV("rows");
		RegV("eventsEnabled");
		RegV("total");
		RegV("nextCursor");
		RegV("id");
		RegV("className");
		RegV("undoName");
		RegV("generators");
		RegV("count");
		RegV("was");
	}
}

class EMCP_WB_Generator : NetApiHandler
{
	//! Rows per page: default and most.
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! Generator children one detach or regenerate takes.
	static const int MAX_GENERATORS = 256;
	//! The gates (spec section 1.2 rule 9): each stays false until its probe passes; the main session
	//! sets it true for the probe and after it, and recompiles.
	//! attach and detach: P-W7-10 (a generator prefab created as a child of a shape, then deleted).
	static const bool ATTACH_OPEN = false;
	//! regenerate: P-W7-11 (which route rebuilds the generators, and with one undo point).
	static const bool REGENERATE_OPEN = false;
	//! events: P-W7-12 (ToggleGeneratorEvents from a handler, and restoring it).
	static const bool EVENTS_OPEN = false;
	//! pointData: P-W7-13 (a data entry added to and removed from a shape point).
	static const bool POINTDATA_OPEN = false;
	//! The regenerate routes (DEC-075 OD-7). Route A is preferred; P-W7-11 picks one.
	static const int ROUTE_A = 1;
	static const int ROUTE_B = 2;
	static const int REGENERATE_ROUTE = 1;
	//! Refusal codes, spelled as in src/manifest/vocabulary.ts (NOT_A_GENERATOR lands with W7).
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string NO_WORLD = "NO_WORLD";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string NOT_A_SHAPE = "NOT_A_SHAPE";
	static const string NOT_A_GENERATOR = "NOT_A_GENERATOR";
	static const string RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND";
	static const string GATED = "GATED";
	//! Undo history point names (BeginEntityAction).
	static const string UNDO_ATTACH = "EMCP wb_generator attach";
	static const string UNDO_DETACH = "EMCP wb_generator detach";
	static const string UNDO_REGENERATE = "EMCP wb_generator regenerate";
	static const string UNDO_POINTDATA = "EMCP wb_generator pointData";
	//! The shape's point array and a point's data array (SCR_ImportShapefilePlugin).
	static const string POINTS_KEY = "Points";
	static const string DATA_KEY = "Data";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_GeneratorRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_GeneratorRequest req = EMCP_WB_GeneratorRequest.Cast(request);
		EMCP_WB_GeneratorResponse resp = new EMCP_WB_GeneratorResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "list")
			ListGenerators(req, resp);
		else if (req.action == "attach")
			AttachGenerator(req, resp);
		else if (req.action == "detach")
			DetachGenerator(req, resp);
		else if (req.action == "regenerate")
			RegenerateShape(req, resp);
		else if (req.action == "pointData")
			EditPointData(req, resp);
		else if (req.action == "events")
			SetEvents(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of list, attach, detach, regenerate, pointData, events");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_GeneratorResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_GeneratorResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API with a loaded world, or null with the error written. GetModule opens a
	//! closed World Editor (DEC-053), as every entity handler does.
	protected static WorldEditorAPI EditorApi(EMCP_WB_GeneratorResponse resp)
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
	//! The guard of a mutating action, in order: the project is found (DEC-058), the World Editor has
	//! a loaded world, the editor is not in play mode, and the open world lies under the project's
	//! "$<id>:" prefix. The API, or null with the refusal written.
	protected static WorldEditorAPI EditApi(EMCP_WB_GeneratorResponse resp)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "mutating actions need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return null;
		}
		string projectId = EMCP_WB_Guard.ProjectId();
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return null;
		if (api.IsGameMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in play mode; nothing was changed", "stop play first (wb_world stop)");
			return null;
		}
		string worldPath = "";
		api.GetWorldPath(worldPath);
		if (projectId == "" || !worldPath.StartsWith("$" + projectId + ":"))
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "the open world is not a world of the open project; nothing was changed", "open a world of the project you have open");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! Resolves one entity reference (EMCP_WB_EntityRef.Resolve); null with the error written.
	protected static IEntitySource ResolveOne(WorldEditorAPI api, string entityRef, EMCP_WB_GeneratorResponse resp)
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
	//! The runtime ShapeEntity of an entity source, or null with NOT_A_SHAPE (or ENTITY_NOT_FOUND
	//! when the source has no runtime entity) written.
	protected static ShapeEntity ShapeOf(WorldEditorAPI api, IEntitySource src, EMCP_WB_GeneratorResponse resp)
	{
		IEntity ent = api.SourceToEntity(src);
		if (!ent)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "the entity has no runtime entity (SourceToEntity returned null)", "read the entity with wb_entity get");
			return null;
		}
		ShapeEntity shapeEnt = ShapeEntity.Cast(ent);
		if (!shapeEnt)
		{
			Refuse(resp, NOT_A_SHAPE, "the entity is a " + src.GetClassName() + ", not a ShapeEntity", "pass a polyline or spline (wb_entity list className Shape)");
			return null;
		}
		return shapeEnt;
	}

	//------------------------------------------------------------------------------------------------
	//! True when a class name names a script class that inherits baseType (string.ToType,
	//! typename.IsInherited). False for an empty or unknown name.
	static bool ClassInherits(string className, typename baseType)
	{
		if (className == "")
			return false;
		typename classType = className.ToType();
		if (!classType)
			return false;
		return classType.IsInherited(baseType);
	}

	//------------------------------------------------------------------------------------------------
	//! True when the entity source's class inherits GeneratorBaseEntity.
	static bool IsGenerator(IEntitySource src)
	{
		if (!src)
			return false;
		return ClassInherits(src.GetClassName(), GeneratorBaseEntity);
	}

	//------------------------------------------------------------------------------------------------
	//! The parent entity source of an entity, null for a top-level one (BaseContainer.GetParent,
	//! BaseResourceObject.ToEntitySource), as EMCP_WB_Entity reads it.
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
	//! The generator children of a shape source (GetNumChildren, GetChild, ToEntitySource), into found.
	static void GeneratorChildren(IEntitySource shapeSrc, notnull array<IEntitySource> found)
	{
		if (!shapeSrc)
			return;
		int childCount = shapeSrc.GetNumChildren();
		for (int i = 0; i < childCount; i++)
		{
			BaseContainer childCont = shapeSrc.GetChild(i);
			if (!childCont)
				continue;
			IEntitySource child = childCont.ToEntitySource();
			if (child && IsGenerator(child))
				found.Insert(child);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! One row: "id|className|prefab|shapeId" (shapeId: the parent's reference, "" at the top level).
	static string Row(IEntitySource src)
	{
		return EMCP_WB_EntityRef.Format(src) + "|" + src.GetClassName() + "|" + AncestorOf(src) + "|" + EMCP_WB_EntityRef.Format(ParentOf(src));
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
	static bool ParseCursor(string cursorText, out int start, out int total)
	{
		start = 0;
		total = 0;
		int colon = cursorText.IndexOf(":");
		if (colon <= 0 || colon >= cursorText.Length() - 1)
			return false;
		string startText = cursorText.Substring(0, colon);
		string totalText = cursorText.Substring(colon + 1, cursorText.Length() - colon - 1);
		if (!IsDigits(startText) || !IsDigits(totalText))
			return false;
		int startValue = startText.ToInt();
		int totalValue = totalText.ToInt();
		if (startValue > totalValue)
			return false;
		start = startValue;
		total = totalValue;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A generator prefab's resource name "{GUID}path" from a {GUID}path or a project-relative path,
	//! ending in .et; "" with the response refused (INVALID_ARGUMENT, RESOURCE_NOT_FOUND). A {GUID}path is
	//! looked up by its GUID alone (Workbench.GetResourceName("{GUID}") answers the GUID unchanged for an
	//! unknown one and resolves a packed file, which GetAbsolutePath does not: W2 run 2, the
	//! EMCP_WB_Audio form); the path the database names must be the path given, case aside. No file
	//! method.
	static string PrefabOf(string input, EMCP_WB_GeneratorResponse resp)
	{
		string resolved = "";
		string checkedPath = "";
		if (input.StartsWith("{"))
		{
			if (input.IndexOf("}") != 17)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "a GUID is 16 characters in braces, got '" + input + "'", "pass the prefab as {GUID}path");
				return "";
			}
			string braced = input.Substring(0, 18);
			string givenPath = input.Substring(18, input.Length() - 18);
			ResourceName known = Workbench.GetResourceName(braced);
			string knownText = known;
			if (knownText == "" || knownText == braced)
			{
				Refuse(resp, RESOURCE_NOT_FOUND, "the resource database knows no resource " + braced + "; nothing was created", "check the GUID with wb_resources resolve");
				return "";
			}
			string knownPath = known.GetPath();
			if (givenPath != "" && knownPath != "")
			{
				string wanted = givenPath;
				wanted.ToLower();
				string knownLower = knownPath;
				knownLower.ToLower();
				if (wanted != knownLower)
				{
					Refuse(resp, RESOURCE_NOT_FOUND, braced + " names " + knownPath + ", not " + givenPath + "; nothing was created", "pass the {GUID}path wb_resources resolve answers");
					return "";
				}
			}
			resolved = knownText;
			checkedPath = knownPath;
			if (checkedPath == "")
				checkedPath = givenPath;
		}
		else
		{
			string clean = "";
			string why = "";
			if (!EMCP_WB_Guard.CleanRelative(input, clean, why))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "prefab: " + why, "pass the prefab as {GUID}path");
				return "";
			}
			ResourceName named = Workbench.GetResourceName(clean);
			string namedText = named;
			string namedPath = "";
			if (namedText.StartsWith("{") && namedText.IndexOf("}") == 17)
				namedPath = named.GetPath();
			if (namedPath == "")
			{
				Refuse(resp, RESOURCE_NOT_FOUND, "Workbench.GetResourceName gave no {GUID}path for '" + clean + "' (got '" + namedText + "'); nothing was created", "check the path with wb_resources search");
				return "";
			}
			resolved = namedText;
			checkedPath = namedPath;
		}
		string lower = checkedPath;
		lower.ToLower();
		if (!lower.EndsWith(".et"))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the prefab must be an .et, got '" + checkedPath + "'; nothing was created", "pass a generator prefab (.et)");
			return "";
		}
		return resolved;
	}

	//------------------------------------------------------------------------------------------------
	//! list: the generator children of one shape, or every generator in the editor entity list, then
	//! one page; eventsEnabled from AreGeneratorEventsEnabled.
	protected static void ListGenerators(EMCP_WB_GeneratorRequest req, EMCP_WB_GeneratorResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;

		array<IEntitySource> items = {};
		if (req.shape != "")
		{
			IEntitySource shapeSrc = ResolveOne(api, req.shape, resp);
			if (!shapeSrc)
				return;
			ShapeEntity shapeEnt = ShapeOf(api, shapeSrc, resp);
			if (!shapeEnt)
				return;
			GeneratorChildren(shapeSrc, items);
		}
		else
		{
			// One ToType per class name, not per entity: a large world holds many entities of few
			// classes, and the walk runs on the NET thread.
			array<string> generatorClasses = {};
			array<string> otherClasses = {};
			int entityCount = api.GetEditorEntityCount();
			for (int e = 0; e < entityCount; e++)
			{
				IEntitySource src = api.GetEditorEntity(e);
				if (!src)
					continue;
				string srcClass = src.GetClassName();
				if (generatorClasses.Find(srcClass) >= 0)
				{
					items.Insert(src);
					continue;
				}
				if (otherClasses.Find(srcClass) >= 0)
					continue;
				if (ClassInherits(srcClass, GeneratorBaseEntity))
				{
					generatorClasses.Insert(srcClass);
					items.Insert(src);
				}
				else
				{
					otherClasses.Insert(srcClass);
				}
			}
		}

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
				Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " generators, the list now has " + total.ToString(), "read again without a cursor");
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

		resp.eventsEnabled = api.AreGeneratorEventsEnabled();
		resp.total = total;
		for (int i = start; i < end; i++)
			resp.rows.Insert(Row(items.Get(i)));
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();
		int shown = end - start;
		Answer(resp, "ok", "", "generators: " + shown.ToString() + " of " + total.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! attach: a generator prefab as a child of a shape, in one entity action. GATED until P-W7-10.
	protected static void AttachGenerator(EMCP_WB_GeneratorRequest req, EMCP_WB_GeneratorResponse resp)
	{
		if (req.shape == "" || req.prefab == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "shape and prefab are required; nothing was created", "a shape reference (wb_entity list) and a generator prefab {GUID}path");
			return;
		}
		if (!ATTACH_OPEN)
		{
			Refuse(resp, GATED, "attach waits for probe P-W7-10 (a generator created as a child of a shape from a handler is unproven); nothing was sent", "the main session opens it after P-W7-10 passes");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource shapeSrc = ResolveOne(api, req.shape, resp);
		if (!shapeSrc)
			return;
		ShapeEntity shapeEnt = ShapeOf(api, shapeSrc, resp);
		if (!shapeEnt)
			return;
		string prefabName = PrefabOf(req.prefab, resp);
		if (prefabName == "")
			return;
		Resource loaded = Resource.Load(prefabName);
		if (!loaded || !loaded.IsValid())
		{
			Refuse(resp, RESOURCE_NOT_FOUND, "Resource.Load gave no valid resource for " + prefabName + "; nothing was created", "check the prefab with wb_resources resolve");
			return;
		}
		BaseResourceObject prefabObject = loaded.GetResource();
		IEntitySource prefabSrc = null;
		if (prefabObject)
			prefabSrc = prefabObject.ToEntitySource();
		if (!prefabSrc)
		{
			Refuse(resp, NOT_A_GENERATOR, prefabName + " holds no entity source; nothing was created", "pass a generator prefab (.et)");
			return;
		}
		string prefabClass = prefabSrc.GetClassName();
		if (!ClassInherits(prefabClass, GeneratorBaseEntity))
		{
			Refuse(resp, NOT_A_GENERATOR, prefabName + " is a " + prefabClass + ", which does not inherit GeneratorBaseEntity; nothing was created", "pass a generator prefab (wb_generator list shows the ones in use)");
			return;
		}

		resp.undoName = UNDO_ATTACH;
		if (!api.BeginEntityAction(UNDO_ATTACH))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		IEntitySource made = api.CreateEntity(prefabName, req.name, shapeSrc.GetLayerID(), shapeSrc, vector.Zero, vector.Zero);
		api.EndEntityAction();
		if (!made)
		{
			resp.undoName = "";
			Answer(resp, "error", ENGINE_FALSE, "CreateEntity returned null for " + prefabName + " under the shape; nothing was created", "read the World Editor log");
			return;
		}
		resp.id = EMCP_WB_EntityRef.Format(made);
		resp.className = made.GetClassName();
		string note = "";
		if (req.name != "" && made.GetName() != req.name)
			note = " (the editor named it '" + made.GetName() + "', not '" + req.name + "')";
		Answer(resp, "ok", "", "attached " + resp.className + " to the shape" + note + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! detach: deletes a generator, or every generator child of a shape, in one entity action. GATED
	//! until P-W7-10.
	protected static void DetachGenerator(EMCP_WB_GeneratorRequest req, EMCP_WB_GeneratorResponse resp)
	{
		if (req.entity == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "entity required; nothing was deleted", "a generator or shape reference (wb_generator list)");
			return;
		}
		if (!ATTACH_OPEN)
		{
			Refuse(resp, GATED, "detach waits for probe P-W7-10 (generator attach and detach from a handler are unproven); nothing was sent", "the main session opens it after P-W7-10 passes");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;
		array<IEntitySource> doomed = {};
		if (IsGenerator(src))
		{
			doomed.Insert(src);
		}
		else
		{
			IEntity ent = api.SourceToEntity(src);
			if (!ShapeEntity.Cast(ent))
			{
				Refuse(resp, NOT_A_GENERATOR, "the entity is a " + src.GetClassName() + ", neither a GeneratorBaseEntity nor a shape; nothing was deleted", "pass a generator or its shape (wb_generator list)");
				return;
			}
			GeneratorChildren(src, doomed);
			if (doomed.Count() == 0)
			{
				Refuse(resp, NOT_A_GENERATOR, "the shape has no generator children; nothing was deleted", "list them with wb_generator list shape");
				return;
			}
		}
		if (doomed.Count() > MAX_GENERATORS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the shape has " + doomed.Count().ToString() + " generators, one call deletes at most " + MAX_GENERATORS.ToString() + "; nothing was deleted", "detach them one by one");
			return;
		}

		// The reference is read before anything is deleted: src may be one of doomed (review round 1,
		// W7-GEN-01), and a deleted source is never read again.
		resp.id = EMCP_WB_EntityRef.Format(src);
		resp.undoName = UNDO_DETACH;
		if (!api.BeginEntityAction(UNDO_DETACH))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		int deleted = 0;
		string failure = "";
		for (int i = 0; i < doomed.Count(); i++)
		{
			IEntitySource gen = doomed.Get(i);
			string genRef = EMCP_WB_EntityRef.Format(gen);
			if (!api.DeleteEntity(gen))
			{
				failure = "DeleteEntity returned false for " + genRef;
				break;
			}
			deleted++;
		}
		api.EndEntityAction();
		if (failure != "")
		{
			Answer(resp, "error", ENGINE_FALSE, failure + "; " + deleted.ToString() + " deleted before it", "undo with wb_undo_redo to restore them");
			return;
		}
		Answer(resp, "ok", "", "deleted " + deleted.ToString() + " generator(s); undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! regenerate: rebuilds the generator children of a shape by REGENERATE_ROUTE, in one entity
	//! action. GATED until P-W7-11.
	protected static void RegenerateShape(EMCP_WB_GeneratorRequest req, EMCP_WB_GeneratorResponse resp)
	{
		if (req.shape == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "shape required; nothing was changed", "a shape reference (wb_entity list)");
			return;
		}
		if (!REGENERATE_OPEN)
		{
			Refuse(resp, GATED, "regenerate waits for probe P-W7-11 (OnShapeChanged from a handler, or a shape re-set in one entity action, is unproven); nothing was sent", "the main session opens it after P-W7-11 picks the route");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource shapeSrc = ResolveOne(api, req.shape, resp);
		if (!shapeSrc)
			return;
		ShapeEntity shapeEnt = ShapeOf(api, shapeSrc, resp);
		if (!shapeEnt)
			return;
		array<IEntitySource> gens = {};
		GeneratorChildren(shapeSrc, gens);
		if (gens.Count() == 0)
		{
			resp.generators = 0;
			Answer(resp, "ok", "", "the shape has no generator children; nothing was changed", "attach one with wb_generator attach");
			return;
		}
		if (gens.Count() > MAX_GENERATORS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the shape has " + gens.Count().ToString() + " generators, one call takes at most " + MAX_GENERATORS.ToString() + "; nothing was changed", "split the shape");
			return;
		}

		// Route B's input, read before the action: point 0 in the shape's own space.
		array<vector> localPoints = {};
		if (REGENERATE_ROUTE == ROUTE_B)
		{
			shapeEnt.GetPointsPositions(localPoints);
			if (localPoints.Count() == 0)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "the shape has no points; nothing was changed", "check it with wb_shape points");
				return;
			}
		}

		resp.undoName = UNDO_REGENERATE;
		if (!api.BeginEntityAction(UNDO_REGENERATE))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		int reached = 0;
		string failure = "";
		if (REGENERATE_ROUTE == ROUTE_B)
		{
			// Route B: re-set point 0's Position; the editor raises the shape-changed event itself.
			array<ref ContainerIdPathEntry> pointPath = {};
			pointPath.Insert(new ContainerIdPathEntry(POINTS_KEY, 0));
			if (api.SetVariableValue(shapeSrc, pointPath, "Position", EMCP_WB_Common.VectorToString(localPoints.Get(0))))
				reached = gens.Count();
			else
				failure = "SetVariableValue Position of point 0 returned false";
		}
		else
		{
			// Route A: the shape's influence boxes into local arrays (never null), then OnShapeChanged.
			array<vector> mins = {};
			array<vector> maxes = {};
			shapeEnt.GetAllInfluenceBBoxes(shapeSrc, mins, maxes);
			for (int g = 0; g < gens.Count(); g++)
			{
				IEntity genEnt = api.SourceToEntity(gens.Get(g));
				GeneratorBaseEntity generator = GeneratorBaseEntity.Cast(genEnt);
				if (!generator)
					continue;
				generator.OnShapeChanged(shapeSrc, shapeEnt, mins, maxes);
				reached++;
			}
			if (reached == 0)
				failure = "no generator child has a runtime GeneratorBaseEntity (SourceToEntity)";
		}
		api.EndEntityAction();
		resp.generators = reached;
		if (failure != "")
		{
			Answer(resp, "error", ENGINE_FALSE, failure, "read the World Editor log; undo with wb_undo_redo if anything changed");
			return;
		}
		string routeText = "A (OnShapeChanged)";
		if (REGENERATE_ROUTE == ROUTE_B)
			routeText = "B (point 0 re-set)";
		string eventsNote = "";
		if (REGENERATE_ROUTE == ROUTE_B && !api.AreGeneratorEventsEnabled())
			eventsNote = "; generator events are off, so route B may not have rebuilt anything (wb_generator events)";
		Answer(resp, "ok", "", "regenerated " + reached.ToString() + " of " + gens.Count().ToString() + " generator(s) by route " + routeText + eventsNote + "; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! The data entries of one shape point (GetObjectArray "Points", Get(index), GetObjectArray
	//! "Data"); -1 when the point is not there, 0 when it has no data array.
	static int PointDataCount(IEntitySource shapeSrc, int pointIndex)
	{
		if (!shapeSrc)
			return -1;
		BaseContainerList points = shapeSrc.GetObjectArray(POINTS_KEY);
		if (!points || pointIndex < 0 || pointIndex >= points.Count())
			return -1;
		BaseContainer point = points.Get(pointIndex);
		if (!point)
			return -1;
		BaseContainerList data = point.GetObjectArray(DATA_KEY);
		if (!data)
			return 0;
		return data.Count();
	}

	//------------------------------------------------------------------------------------------------
	//! pointData: adds a data entry at the end of a point's "Data" array, or removes one, in one
	//! entity action; answers the count read back. GATED until P-W7-13.
	protected static void EditPointData(EMCP_WB_GeneratorRequest req, EMCP_WB_GeneratorResponse resp)
	{
		bool adding = req.op == "add";
		if (req.shape == "" || (!adding && req.op != "remove"))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "shape and op (add or remove) are required, got op '" + req.op + "'; nothing was changed", "op add with dataClass, or op remove with dataIndex");
			return;
		}
		if (req.index < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "index (the point's index, 0 or more) is required; nothing was changed", "read the points with wb_shape points");
			return;
		}
		if (adding && !ClassInherits(req.dataClass, ShapePointDataScriptBase))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "dataClass '" + req.dataClass + "' is not a class that inherits ShapePointDataScriptBase; nothing was changed", "e.g. ForestGeneratorPointData");
			return;
		}
		if (!adding && req.dataIndex < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "dataIndex must be 0 or more, got " + req.dataIndex.ToString() + "; nothing was changed", "the entry's index on the point");
			return;
		}
		if (!POINTDATA_OPEN)
		{
			Refuse(resp, GATED, "pointData waits for probe P-W7-13 (point data added and removed from a handler is unproven); nothing was sent", "the main session opens it after P-W7-13 passes");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource shapeSrc = ResolveOne(api, req.shape, resp);
		if (!shapeSrc)
			return;
		ShapeEntity shapeEnt = ShapeOf(api, shapeSrc, resp);
		if (!shapeEnt)
			return;
		int before = PointDataCount(shapeSrc, req.index);
		if (before < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the shape has no point " + req.index.ToString() + "; nothing was changed", "read the points with wb_shape points");
			return;
		}
		if (!adding && req.dataIndex >= before)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "point " + req.index.ToString() + " has " + before.ToString() + " data entries, no entry " + req.dataIndex.ToString() + "; nothing was changed", "pass a dataIndex below the count");
			return;
		}

		array<ref ContainerIdPathEntry> pointPath = {};
		pointPath.Insert(new ContainerIdPathEntry(POINTS_KEY, req.index));
		resp.undoName = UNDO_POINTDATA;
		if (!api.BeginEntityAction(UNDO_POINTDATA))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		bool done = false;
		if (adding)
			done = api.CreateObjectArrayVariableMember(shapeSrc, pointPath, DATA_KEY, req.dataClass, before);
		else
			done = api.RemoveObjectArrayVariableMember(shapeSrc, pointPath, DATA_KEY, req.dataIndex);
		api.EndEntityAction();
		resp.count = PointDataCount(shapeSrc, req.index);
		if (!done)
		{
			resp.undoName = "";
			Answer(resp, "error", ENGINE_FALSE, "the " + req.op + " of point " + req.index.ToString() + "'s data returned false; nothing was changed", "read the World Editor log");
			return;
		}
		Answer(resp, "ok", "", req.op + ": point " + req.index.ToString() + " has " + resp.count.ToString() + " data entries (was " + before.ToString() + "); undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! events: ToggleGeneratorEvents; answers was (before) and eventsEnabled (read back after). Not
	//! undoable: the caller restores was. GATED until P-W7-12.
	protected static void SetEvents(EMCP_WB_GeneratorRequest req, EMCP_WB_GeneratorResponse resp)
	{
		bool wanted = req.enabled;
		if (!EVENTS_OPEN)
		{
			Refuse(resp, GATED, "events waits for probe P-W7-12 (ToggleGeneratorEvents from a handler is unproven); nothing was sent", "the main session opens it after P-W7-12 passes");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		resp.was = api.AreGeneratorEventsEnabled();
		api.ToggleGeneratorEvents(wanted);
		resp.eventsEnabled = api.AreGeneratorEventsEnabled();
		if (resp.eventsEnabled != wanted)
		{
			Answer(resp, "error", ENGINE_FALSE, "ToggleGeneratorEvents did not take: the events read back " + resp.eventsEnabled.ToString(), "read the World Editor log");
			return;
		}
		Answer(resp, "ok", "", "generator events " + resp.was.ToString() + " -> " + resp.eventsEnabled.ToString() + "; editor-wide and not undoable: set was back to restore", "");
	}
}
