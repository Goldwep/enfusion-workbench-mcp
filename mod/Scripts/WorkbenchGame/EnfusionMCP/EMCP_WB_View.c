/**
 * EMCP_WB_View.c - Selection, visibility, camera and viewport of the World Editor (wave W1, wb_view)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_View", dispatching on "action"
 * (docs/v2/design/phase5-w1-spec.md section 2.3):
 *   selection     GetSelectedEntitiesCount / GetSelectedEntity, paged; IsEntitySelectedAsMain names
 *                 the main member
 *   select        set, add, remove or clear the selection (SetEntitySelection, AddToEntitySelection,
 *                 RemoveFromEntitySelection, ClearEntitySelection), then UpdateSelectionGui; the
 *                 previous selection is answered so the caller can restore it (editor state, no undo)
 *   setVisible    SetEntityVisible per entity inside an entity action (undo), IsEntityVisible read back
 *   camera        BaseWorld.GetCurrentCamera of GetWorld, screen size of the viewport
 *   setCamera     SetCamera(pos, lookVec), camera read back; before answered (view state, no undo)
 *   focus         SetCamera to look at the centre of an entity's world bounds along the current view
 *                 direction, from distance metres or framing the bounds (no focus call exists in 1.9,
 *                 spec section 0)
 *   trace         TraceWorldPos from a viewport pixel, EntityToSource of the hit
 *   underCursor   GetEntityUnderCursor, GetMousePosX / GetMousePosY
 *   placeAtPixel  CreateEntityInWindowEx inside an entity action (undo); when it answers null,
 *                 TraceWorldPos + CreateEntity at the hit point
 *
 * Guards (spec section 1): reads none; select, setVisible, setCamera, focus and placeAtPixel need the
 * project found (EMCP_WB_Guard, DEC-058) and the World Editor out of play mode (WRONG_MODE). No file is
 * written here. Entity references: EMCP_WB_EntityRef (id:<hex> | name:<name> | index:<i>).
 * Paging: cursor "<start>:<count>", count = the total at the first read; a changed total answers
 * STALE_CURSOR; limit default 50, max 200. Keys: contracts/EMCP_WB_View.json.
 */

class EMCP_WB_ViewRequest : JsonApiStruct
{
	string action;
	//! selection: nextCursor of the previous page
	string cursor;
	int limit;
	//! select: set, add, remove or clear
	string mode;
	//! select, setVisible: entity references
	ref array<string> entities;
	//! setVisible
	bool visible;
	bool recursive;
	//! setCamera: "x y z" position and look direction
	string coords;
	string look;
	//! focus: one entity reference and the distance in metres as text, "" for the default (a JSON
	//! integer never reaches a float field through RegV: distance 8 read as 0, W1 live run 2026-11-11)
	string entity;
	string distance;
	//! trace, placeAtPixel: a viewport pixel
	int x;
	int y;
	//! trace: TraceFlags names, comma-joined
	string flags;
	//! underCursor: clamp the mouse position to the viewport
	bool clamped;
	//! placeAtPixel
	string prefab;
	string name;
	string layer;
	int window;

	void EMCP_WB_ViewRequest()
	{
		entities = {};

		RegV("action");
		RegV("cursor");
		RegV("limit");
		RegV("mode");
		RegV("entities");
		RegV("visible");
		RegV("recursive");
		RegV("coords");
		RegV("look");
		RegV("entity");
		RegV("distance");
		RegV("x");
		RegV("y");
		RegV("flags");
		RegV("clamped");
		RegV("prefab");
		RegV("name");
		RegV("layer");
		RegV("window");

		// Defaults for keys the request leaves out.
		recursive = true;
		visible = true;
	}
}

class EMCP_WB_ViewResponse : JsonApiStruct
{
	//! ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	ref array<string> rows;
	string mainId;
	int total;
	string nextCursor;
	int selectedCount;
	ref array<string> missing;
	ref array<string> previous;
	ref array<string> changed;
	string coords;
	string angles;
	string direction;
	int screenWidth;
	int screenHeight;
	string before;
	string after;
	string id;
	bool hit;
	string start;
	string end;
	int x;
	int y;
	string undoName;

	void EMCP_WB_ViewResponse()
	{
		rows = {};
		missing = {};
		previous = {};
		changed = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("rows");
		RegV("mainId");
		RegV("total");
		RegV("nextCursor");
		RegV("selectedCount");
		RegV("missing");
		RegV("previous");
		RegV("changed");
		RegV("coords");
		RegV("angles");
		RegV("direction");
		RegV("screenWidth");
		RegV("screenHeight");
		RegV("before");
		RegV("after");
		RegV("id");
		RegV("hit");
		RegV("start");
		RegV("end");
		RegV("x");
		RegV("y");
		RegV("undoName");
	}
}

//! Static helpers of the View handler that take neither the request nor the response.
class EMCP_WB_ViewUtil
{
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! References one select or setVisible call takes at most.
	static const int MAX_REFS = 200;
	//! Previous-selection ids select answers at most.
	static const int MAX_PREVIOUS = 200;
	//! focus: the distance when the entity has no bounds, metres.
	static const float FOCUS_DISTANCE = 10.0;
	//! focus: the framing distance is this many bounding radii, clamped to FOCUS_MIN..FOCUS_MAX.
	static const float FOCUS_RADII = 3.0;
	static const float FOCUS_MIN = 1.5;
	static const float FOCUS_MAX = 200.0;

	//------------------------------------------------------------------------------------------------
	//! focus without a distance: FOCUS_RADII bounding radii, at least FOCUS_MIN and at most FOCUS_MAX
	//! metres; FOCUS_DISTANCE for an entity without bounds (radius 0).
	static float FramingDistance(float radius)
	{
		if (radius <= 0)
			return FOCUS_DISTANCE;
		float d = radius * FOCUS_RADII;
		if (d < FOCUS_MIN)
			d = FOCUS_MIN;
		if (d > FOCUS_MAX)
			d = FOCUS_MAX;
		return d;
	}

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
				why = "the list changed since the cursor was issued (count " + count.ToString() + ", now " + total.ToString() + ")";
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
	//! A field of a "|"-joined row: a "|" inside it becomes "/".
	static string Field(string value)
	{
		string s = value;
		s.Replace("|", "/");
		return s;
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
	//! One entity row: id|name|class|parent|layer|sub|kids.
	static string EntityRow(IEntitySource src)
	{
		if (!src)
			return "||||||";
		string row = EMCP_WB_EntityRef.Format(src);
		row += "|" + Field(src.GetName());
		row += "|" + Field(src.GetClassName());
		row += "|" + EMCP_WB_EntityRef.Format(ParentOf(src));
		row += "|" + src.GetLayerID().ToString();
		row += "|" + src.GetSubScene().ToString();
		row += "|" + src.GetNumChildren().ToString();
		return row;
	}

	//------------------------------------------------------------------------------------------------
	//! The camera matrix of a world: position mat[3], forward mat[2].
	static void CameraOf(BaseWorld world, out vector pos, out vector dir, out vector angles)
	{
		pos = vector.Zero;
		dir = vector.Zero;
		angles = vector.Zero;
		if (!world)
			return;
		vector camMat[4];
		world.GetCurrentCamera(camMat);
		vector rot[3];
		rot[0] = camMat[0];
		rot[1] = camMat[1];
		rot[2] = camMat[2];
		pos = camMat[3];
		dir = camMat[2];
		angles = Math3D.MatrixToAngles(rot);
	}

	//------------------------------------------------------------------------------------------------
	//! TraceFlags from comma-joined names; "" is ENTS and WORLD. False with why on an unknown name.
	static bool ParseTraceFlags(string names, out TraceFlags flags, out string why)
	{
		flags = TraceFlags.ENTS | TraceFlags.WORLD;
		why = "";
		if (names == "")
			return true;
		string s = names;
		s.Replace(" ", "");
		array<string> parts = {};
		s.Split(",", parts, true);
		bool any = false;
		foreach (string part : parts)
		{
			TraceFlags one = TraceFlags.ENTS;
			if (part == "ENTS")
				one = TraceFlags.ENTS;
			else if (part == "WORLD")
				one = TraceFlags.WORLD;
			else if (part == "OCEAN")
				one = TraceFlags.OCEAN;
			else if (part == "VISIBILITY")
				one = TraceFlags.VISIBILITY;
			else if (part == "ANY_CONTACT")
				one = TraceFlags.ANY_CONTACT;
			else if (part == "DEFAULT")
				one = TraceFlags.DEFAULT;
			else
			{
				flags = TraceFlags.ENTS | TraceFlags.WORLD;
				why = "unknown TraceFlags name '" + part + "' (ENTS, WORLD, OCEAN, VISIBILITY, ANY_CONTACT, DEFAULT)";
				return false;
			}
			if (any)
				flags = flags | one;
			else
				flags = one;
			any = true;
		}
		return true;
	}
}

class EMCP_WB_View : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string NO_WORLD = "NO_WORLD";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	//! Undo history point names (BeginEntityAction).
	static const string UNDO_SET_VISIBLE = "EMCP wb_view setVisible";
	static const string UNDO_PLACE = "EMCP wb_view placeAtPixel";
	static const string REF_NEXT = "list the entities (wb_entity list) and pass the id: it answers";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ViewRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ViewRequest req = EMCP_WB_ViewRequest.Cast(request);
		EMCP_WB_ViewResponse resp = new EMCP_WB_ViewResponse();
		if (!req)
		{
			Refuse(resp, INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "selection")
			ReadSelection(req, resp);
		else if (req.action == "select")
			ChangeSelection(req, resp);
		else if (req.action == "setVisible")
			SetVisibility(req, resp);
		else if (req.action == "camera")
			ReadCamera(req, resp);
		else if (req.action == "setCamera")
			MoveCamera(req, resp);
		else if (req.action == "focus")
			FocusEntity(req, resp);
		else if (req.action == "trace")
			TracePixel(req, resp);
		else if (req.action == "underCursor")
			ReadUnderCursor(req, resp);
		else if (req.action == "placeAtPixel")
			PlaceAtPixel(req, resp);
		else
			Refuse(resp, INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of selection, select, setVisible, camera, setCamera, focus, trace, underCursor, placeAtPixel");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_ViewResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_ViewResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, as EMCP_WB_Entity.BeginEdit does: a write with no own undo
	//! point would leave wb_undo_redo undoing the user's previous step (review round 1, F2).
	protected static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_ViewResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		resp.undoName = "";
		Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API, or null with the refusal written. GetModule opens a closed World Editor
	//! (DEC-053), as every 1.x World Editor handler does.
	protected static WorldEditorAPI EditorApi(EMCP_WB_ViewResponse resp)
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
	protected static WorldEditorAPI EditApi(EMCP_WB_ViewResponse resp)
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
	//! Resolves a list of references into found (no duplicates); a reference that names no entity
	//! goes to missingRefs. False with code and why when the list is too long or a reference is
	//! malformed (nothing is done then).
	protected static bool ResolveMany(WorldEditorAPI api, array<string> refs, notnull array<IEntitySource> found, notnull array<string> missingRefs, out string code, out string why)
	{
		code = "";
		why = "";
		if (!refs)
			return true;
		if (refs.Count() > EMCP_WB_ViewUtil.MAX_REFS)
		{
			code = INVALID_ARGUMENT;
			why = "at most " + EMCP_WB_ViewUtil.MAX_REFS.ToString() + " entity references per call, got " + refs.Count().ToString();
			return false;
		}
		// One resolver for the whole list: the id: map is built once (review R1).
		EMCP_WB_EntityRefResolver resolver = new EMCP_WB_EntityRefResolver(api);
		foreach (string entityRef : refs)
		{
			EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
			if (!resolver.Resolve(entityRef, resolved))
			{
				if (resolved.m_Code == INVALID_ARGUMENT)
				{
					code = resolved.m_Code;
					why = resolved.m_Why;
					return false;
				}
				missingRefs.Insert(entityRef);
				continue;
			}
			IEntitySource src = resolved.m_Src;
			if (found.Find(src) < 0)
				found.Insert(src);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! selection: the selected entities, paged; mainId names the main member (any page).
	static void ReadSelection(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;

		int count = api.GetSelectedEntitiesCount();
		int first = 0;
		int stop = 0;
		string code = "";
		string why = "";
		if (!EMCP_WB_ViewUtil.PageWindow(req.cursor, req.limit, count, first, stop, code, why))
		{
			Refuse(resp, code, why, "read again without a cursor");
			return;
		}

		for (int i = 0; i < count; i++)
		{
			IEntitySource src = api.GetSelectedEntity(i);
			if (!src)
				continue;
			if (resp.mainId == "" && api.IsEntitySelectedAsMain(src))
				resp.mainId = EMCP_WB_EntityRef.Format(src);
			if (i >= first && i < stop)
				resp.rows.Insert(EMCP_WB_ViewUtil.EntityRow(src));
		}
		resp.total = count;
		resp.nextCursor = EMCP_WB_ViewUtil.NextCursor(stop, count);
		Answer(resp, "ok", "", count.ToString() + " selected; rows " + first.ToString() + " to " + stop.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! select: set, add, remove or clear the selection, then UpdateSelectionGui. The previous
	//! selection (ids) is answered first so the caller can restore it; selectedCount is read back.
	static void ChangeSelection(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;

		string mode = req.mode;
		if (mode != "set" && mode != "add" && mode != "remove" && mode != "clear")
		{
			Refuse(resp, INVALID_ARGUMENT, "mode must be set, add, remove or clear, got '" + mode + "'", "pass mode set, add, remove or clear");
			return;
		}

		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (mode != "clear")
		{
			if (!req.entities || req.entities.Count() == 0)
			{
				Refuse(resp, INVALID_ARGUMENT, "mode " + mode + " needs at least one entity reference", "pass entities");
				return;
			}
			if (!ResolveMany(api, req.entities, found, resp.missing, code, why))
			{
				Refuse(resp, code, why + "; nothing was changed", REF_NEXT);
				return;
			}
			if (found.Count() == 0)
			{
				Refuse(resp, EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an editor entity; nothing was changed", REF_NEXT);
				return;
			}
		}

		int before = api.GetSelectedEntitiesCount();
		for (int p = 0; p < before && p < EMCP_WB_ViewUtil.MAX_PREVIOUS; p++)
		{
			IEntitySource prev = api.GetSelectedEntity(p);
			if (prev)
				resp.previous.Insert(EMCP_WB_EntityRef.Format(prev));
		}

		if (mode == "clear")
			api.ClearEntitySelection();
		else if (mode == "set")
		{
			api.SetEntitySelection(found.Get(0));
			for (int s = 1; s < found.Count(); s++)
				api.AddToEntitySelection(found.Get(s));
		}
		else if (mode == "add")
		{
			foreach (IEntitySource addSrc : found)
				api.AddToEntitySelection(addSrc);
		}
		else
		{
			foreach (IEntitySource removeSrc : found)
				api.RemoveFromEntitySelection(removeSrc);
		}
		api.UpdateSelectionGui();

		resp.selectedCount = api.GetSelectedEntitiesCount();
		Answer(resp, "ok", "", "select " + mode + ": " + resp.selectedCount.ToString() + " selected now (was " + before.ToString() + "); " + resp.missing.Count().ToString() + " reference(s) missing", "");
	}

	//------------------------------------------------------------------------------------------------
	//! setVisible: SetEntityVisible on each entity inside one entity action (undo), IsEntityVisible
	//! read back per entity into changed ("id|visibleAfter").
	static void SetVisibility(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;

		if (!req.entities || req.entities.Count() == 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "setVisible needs at least one entity reference", "pass entities");
			return;
		}
		array<IEntitySource> found = {};
		string code = "";
		string why = "";
		if (!ResolveMany(api, req.entities, found, resp.missing, code, why))
		{
			Refuse(resp, code, why + "; nothing was changed", REF_NEXT);
			return;
		}
		if (found.Count() == 0)
		{
			Refuse(resp, EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "no reference names an editor entity; nothing was changed", REF_NEXT);
			return;
		}

		bool visible = req.visible;
		bool recursive = req.recursive;
		resp.undoName = UNDO_SET_VISIBLE;
		if (!BeginEdit(api, UNDO_SET_VISIBLE, resp))
			return;
		foreach (IEntitySource src : found)
			api.SetEntityVisible(src, visible, recursive);
		api.EndEntityAction(UNDO_SET_VISIBLE);

		int wrong = 0;
		foreach (IEntitySource readSrc : found)
		{
			bool after = api.IsEntityVisible(readSrc);
			if (after != visible)
				wrong++;
			resp.changed.Insert(EMCP_WB_EntityRef.Format(readSrc) + "|" + EMCP_WB_ViewUtil.BoolText(after));
		}
		if (wrong > 0)
		{
			Answer(resp, "error", ENGINE_FALSE, wrong.ToString() + " of " + found.Count().ToString() + " entities do not read back visible " + EMCP_WB_ViewUtil.BoolText(visible), "read changed; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", found.Count().ToString() + " entities set visible " + EMCP_WB_ViewUtil.BoolText(visible), "");
	}

	//------------------------------------------------------------------------------------------------
	//! camera: the current camera of the edited world, its look direction and angles, and the
	//! viewport size.
	static void ReadCamera(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Refuse(resp, NO_WORLD, "GetWorld returned null: no world is open", "open a world (wb_module setResource)");
			return;
		}
		vector pos = vector.Zero;
		vector dir = vector.Zero;
		vector angles = vector.Zero;
		EMCP_WB_ViewUtil.CameraOf(world, pos, dir, angles);
		resp.coords = EMCP_WB_Common.VectorToString(pos);
		resp.direction = EMCP_WB_Common.VectorToString(dir);
		resp.angles = EMCP_WB_Common.VectorToString(angles);
		resp.screenWidth = api.GetScreenWidth();
		resp.screenHeight = api.GetScreenHeight();
		Answer(resp, "ok", "", "camera at " + resp.coords, "");
	}

	//------------------------------------------------------------------------------------------------
	//! setCamera: SetCamera(pos, lookVec); before and after are the camera position read before and
	//! after (view state: restore with setCamera to before).
	static void MoveCamera(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;

		vector pos = vector.Zero;
		vector look = vector.Zero;
		string why = "";
		if (!EMCP_WB_Common.ParseVectorString(req.coords, pos, why))
		{
			Refuse(resp, INVALID_ARGUMENT, "coords: " + why, "pass coords as \"x y z\"");
			return;
		}
		if (!EMCP_WB_Common.ParseVectorString(req.look, look, why))
		{
			Refuse(resp, INVALID_ARGUMENT, "look: " + why, "pass look as \"x y z\"");
			return;
		}
		if (look.Length() <= 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "look must not be the zero vector", "pass a look direction");
			return;
		}
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Refuse(resp, NO_WORLD, "GetWorld returned null: no world is open", "open a world (wb_module setResource)");
			return;
		}

		vector beforePos = vector.Zero;
		vector beforeDir = vector.Zero;
		vector beforeAngles = vector.Zero;
		EMCP_WB_ViewUtil.CameraOf(world, beforePos, beforeDir, beforeAngles);
		resp.before = EMCP_WB_Common.VectorToString(beforePos);

		api.SetCamera(pos, look.Normalized());

		vector afterPos = vector.Zero;
		vector afterDir = vector.Zero;
		vector afterAngles = vector.Zero;
		EMCP_WB_ViewUtil.CameraOf(world, afterPos, afterDir, afterAngles);
		resp.after = EMCP_WB_Common.VectorToString(afterPos);
		Answer(resp, "ok", "", "camera moved from " + resp.before + " to " + resp.after, "");
	}

	//------------------------------------------------------------------------------------------------
	//! focus: the camera keeps its view direction and moves to distance metres before the centre of
	//! the entity's world bounds (IEntity.GetWorldBounds of SourceToEntity), looking at it; without a
	//! distance it frames the bounds (FramingDistance). before and after are the camera read back.
	static void FocusEntity(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;

		float distance = 0;
		if (req.distance != "" && (!EMCP_WB_Common.ParseFloat(req.distance, distance) || distance < 0))
		{
			Refuse(resp, INVALID_ARGUMENT, "distance must be a number not below 0, got '" + req.distance + "'", "pass distance in metres");
			return;
		}
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.entity, resolved))
		{
			Refuse(resp, resolved.m_Code, resolved.m_Why, REF_NEXT);
			return;
		}
		IEntitySource src = resolved.m_Src;
		resp.id = EMCP_WB_EntityRef.Format(src);
		IEntity ent = api.SourceToEntity(src);
		if (!ent)
		{
			Refuse(resp, EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "the entity has no runtime entity (SourceToEntity returned null)", REF_NEXT);
			return;
		}
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Refuse(resp, NO_WORLD, "GetWorld returned null: no world is open", "open a world (wb_module setResource)");
			return;
		}

		// Aim at the centre of the entity's world bounds and, without a distance, frame it from them:
		// W1.7 run 6 focused a beer glass from the fixed 10 m and the hand saw an empty viewport.
		vector origin = ent.GetOrigin();
		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		ent.GetWorldBounds(boundsMin, boundsMax);
		vector centre = origin;
		float radius = 0;
		if (boundsMax[0] >= boundsMin[0] && boundsMax[1] >= boundsMin[1] && boundsMax[2] >= boundsMin[2])
		{
			vector extent = boundsMax - boundsMin;
			radius = extent.Length() * 0.5;
			if (radius > 0)
				centre = (boundsMin + boundsMax) * 0.5;
		}
		if (distance == 0)
			distance = EMCP_WB_ViewUtil.FramingDistance(radius);

		vector camPos = vector.Zero;
		vector camDir = vector.Zero;
		vector camAngles = vector.Zero;
		EMCP_WB_ViewUtil.CameraOf(world, camPos, camDir, camAngles);
		resp.before = EMCP_WB_Common.VectorToString(camPos);
		if (camDir.Length() <= 0)
			camDir = Vector(0, -0.5, 1);
		vector look = camDir.Normalized();
		vector target = centre - look * distance;

		api.SetCamera(target, look);

		vector afterPos = vector.Zero;
		vector afterDir = vector.Zero;
		vector afterAngles = vector.Zero;
		EMCP_WB_ViewUtil.CameraOf(world, afterPos, afterDir, afterAngles);
		resp.after = EMCP_WB_Common.VectorToString(afterPos);
		Answer(resp, "ok", "", "camera at " + resp.after + " looking at " + resp.id + " (" + EMCP_WB_Common.VectorToString(centre) + ", radius " + radius.ToString() + " m) from distance " + distance.ToString() + " m", "");
	}

	//------------------------------------------------------------------------------------------------
	//! trace: TraceWorldPos from a viewport pixel; the hit entity's id through EntityToSource.
	static void TracePixel(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;

		int px = req.x;
		int py = req.y;
		int width = api.GetScreenWidth();
		int height = api.GetScreenHeight();
		if (px < 0 || py < 0 || px >= width || py >= height)
		{
			Refuse(resp, INVALID_ARGUMENT, "pixel " + px.ToString() + "," + py.ToString() + " is outside the viewport (" + width.ToString() + "x" + height.ToString() + ")", "read the size with wb_view camera");
			return;
		}
		TraceFlags flags = TraceFlags.ENTS | TraceFlags.WORLD;
		string why = "";
		if (!EMCP_WB_ViewUtil.ParseTraceFlags(req.flags, flags, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass TraceFlags names, comma-joined");
			return;
		}

		vector traceStart = vector.Zero;
		vector traceEnd = vector.Zero;
		vector traceDir = vector.Zero;
		IEntity hitEntity = null;
		bool hit = api.TraceWorldPos(px, py, flags, traceStart, traceEnd, traceDir, hitEntity);
		resp.hit = hit;
		resp.start = EMCP_WB_Common.VectorToString(traceStart);
		resp.end = EMCP_WB_Common.VectorToString(traceEnd);
		resp.direction = EMCP_WB_Common.VectorToString(traceDir);
		if (hitEntity)
			resp.id = EMCP_WB_EntityRef.Format(api.EntityToSource(hitEntity));
		Answer(resp, "ok", "", "trace hit " + EMCP_WB_ViewUtil.BoolText(hit) + " at " + resp.end, "");
	}

	//------------------------------------------------------------------------------------------------
	//! underCursor: the mouse position in the viewport and the editor entity under it.
	static void ReadUnderCursor(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		bool clamped = req.clamped;
		resp.x = api.GetMousePosX(clamped);
		resp.y = api.GetMousePosY(clamped);
		IEntitySource src = api.GetEntityUnderCursor();
		resp.id = EMCP_WB_EntityRef.Format(src);
		Answer(resp, "ok", "", "mouse at " + resp.x.ToString() + "," + resp.y.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! placeAtPixel: CreateEntityInWindowEx inside one entity action (undo); when it answers null,
	//! TraceWorldPos + CreateEntity at the hit point in the same action. The layer is a layer path of
	//! the current sub-scene (GetSubsceneLayerId), default the current entity layer.
	static void PlaceAtPixel(EMCP_WB_ViewRequest req, EMCP_WB_ViewResponse resp)
	{
		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;

		string prefab = req.prefab;
		if (prefab == "")
		{
			Refuse(resp, INVALID_ARGUMENT, "prefab is empty", "pass a class name or a {GUID}path prefab");
			return;
		}
		int px = req.x;
		int py = req.y;
		int width = api.GetScreenWidth();
		int height = api.GetScreenHeight();
		if (px < 0 || py < 0 || px >= width || py >= height)
		{
			Refuse(resp, INVALID_ARGUMENT, "pixel " + px.ToString() + "," + py.ToString() + " is outside the viewport (" + width.ToString() + "x" + height.ToString() + ")", "read the size with wb_view camera");
			return;
		}
		int windowType = req.window;
		if (windowType < 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "window must not be negative", "omit window for the default 0");
			return;
		}

		int layerId = api.GetCurrentEntityLayerId();
		string layerPath = req.layer;
		if (layerPath != "")
		{
			layerId = EMCP_WB_LayersUtil.LayerIdOf(api, api.GetCurrentSubScene(), layerPath);
			if (layerId < 0)
			{
				Refuse(resp, PATH_NOT_FOUND, "no layer '" + layerPath + "' in the current sub-scene", "list the layers (wb_layers tree)");
				return;
			}
		}

		string entityName = req.name;
		resp.undoName = UNDO_PLACE;
		if (!BeginEdit(api, UNDO_PLACE, resp))
			return;
		IEntitySource created = api.CreateEntityInWindowEx(windowType, px, py, prefab, entityName, layerId);
		bool fallback = false;
		if (!created)
		{
			vector traceStart = vector.Zero;
			vector traceEnd = vector.Zero;
			vector traceDir = vector.Zero;
			IEntity hitEntity = null;
			if (api.TraceWorldPos(px, py, TraceFlags.ENTS | TraceFlags.WORLD, traceStart, traceEnd, traceDir, hitEntity))
			{
				fallback = true;
				created = api.CreateEntity(prefab, entityName, layerId, null, traceEnd, vector.Zero);
			}
		}
		api.EndEntityAction(UNDO_PLACE);

		if (!created)
		{
			Answer(resp, "error", ENGINE_FALSE, "CreateEntityInWindowEx returned null and the trace fallback made nothing", "check the prefab and that the pixel shows the world");
			return;
		}
		resp.id = EMCP_WB_EntityRef.Format(created);
		IEntity ent = api.SourceToEntity(created);
		if (ent)
			resp.coords = EMCP_WB_Common.VectorToString(ent.GetOrigin());
		string how = "CreateEntityInWindowEx";
		if (fallback)
			how = "TraceWorldPos + CreateEntity";
		Answer(resp, "ok", "", "created " + resp.id + " by " + how + " at " + resp.coords, "");
	}
}
