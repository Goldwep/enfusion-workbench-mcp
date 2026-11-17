/**
 * EMCP_WB_Shape.c - Shape handler of wb_shape (wave W6, phase5-w6-spec.md section 2.3; DEC-069 OD-2:
 * the tool starts here and wave W7 grows it by actions: phase5-w7-spec.md section 2.3, DEC-075)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Shape", dispatching on "action":
 *   points    the points of one ShapeEntity in world space ("x y z"), its class and closed flag,
 *             paged (GetPointsPositions, local, through GetWorldTransform); NOT_A_SHAPE otherwise.
 *             W7: tesselated true pages GenerateTesselatedShape's points instead (a local array,
 *             taken as shape-local like GetPointsPositions); a spline's anchor page also answers
 *             tangents, "in|out|explicit" per point (GetTangents, shape-local; HasPointExplicitTangents
 *             as 1 or 0)
 *   edit      (W7) one change to an existing shape in one entity action, in SCR_ShapeAreaTool's
 *             order: set appends the new points (CreateObjectArrayVariableMember "Points",
 *             "ShapePoint" at originalCount + i, SetVariableValue "Position" shape-local), then
 *             removes the old ones from the end (RemoveObjectArrayVariableMember); insert, remove and
 *             move are the same calls at one index; close sets "IsClosed" to "1", open clears it
 *             (ClearVariableValue). snapToGround takes y from TryGetTerrainSurfaceY; world points are
 *             taken into the shape's space with IEntity.CoordToLocal. GATED until probe P-W7-14
 *             passes: the main session opens it by setting EDIT_OPEN true. No confirm (DEC-075 OD-12).
 *   create    a PolylineShapeEntity or SplineShapeEntity from 2 to 2000 world points, in one
 *             entity action: CreateEntity at the points' box centre, then per point
 *             CreateObjectArrayVariableMember ("Points", "ShapePoint") and SetVariableValue of
 *             "Position" through a ContainerIdPathEntry ("Points", i) path, then "IsClosed" and
 *             "LineColor" (the calls and order of SCR_ImportShapefilePlugin.Load_Polylines)
 *   area      served by the TS tool (SCR_ShapeAreaTool's maths, then create); refused here
 *   import    served by the TS tool (shapefile reader, then create per record); refused here
 *   parallel  offset copies of a shape: SCR_ParallelShapeHelper.GetAnchorsAndTesselatedPointsFromShape/5
 *             per offset (the last out is a local array<int> this handler owns, never the null
 *             default), SnapRelativePointsToGround, ReducePointsDensity, then create's calls; as
 *             children of the source (the SCR_ParallelShapeTool form: parent = source, origin 0) or
 *             at the top level from world points. GATED until probe P-W6-16 passes: the main session
 *             opens it by setting PARALLEL_OPEN true.
 *
 * Guards (spec section 1.2): every action goes through the shared world-loaded check
 * (EMCP_WB_Common.NoWorldReason) before any World Editor call; Workbench.GetModule(WorldEditor)
 * opens a closed World Editor. points needs nothing more. create and parallel are in-memory World
 * Editor edits: the project must be found (EMCP_WB_Guard.IsProjectFound, DEC-058, NOT_IN_PROJECT),
 * the editor must not be in play mode (WRONG_MODE), every input is checked before the first
 * engine write, and the edit runs inside one BeginEntityAction / EndEntityAction with an undo
 * name, so wb_undo_redo reverts it. edit takes the same guard. No confirm (DEC-061 OD-3).
 * Nothing here writes a file.
 * Floats and vectors travel as text and are parsed with EMCP_WB_Common (a JSON number does not
 * reach a float field through RegV). Entities are named by the W1 reference (EMCP_WB_EntityRef).
 * Paging: cursor "<start>:<count>", count = the total at the first read; a changed total answers
 * STALE_CURSOR. limit default 50, max 200.
 * A refusal answers status "refused" (or "error") with code and next set and message in the form
 * "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Shape.json.
 */

class EMCP_WB_ShapeRequest : JsonApiStruct
{
	string action;
	//! points, parallel, edit: entity ref of the shape
	string entity;
	//! points: "<start>:<count>" from nextCursor
	string cursor;
	//! points: rows per page (default 50, max 200)
	int limit;
	//! points: the tesselated points instead of the anchors
	bool tesselated;
	//! create: "x y z" world points, 2 to 2000; edit: the points of set, insert and move
	ref array<string> points;
	//! create: close the shape (default false)
	bool closed;
	//! create: SplineShapeEntity instead of PolylineShapeEntity; parallel: spline copies of a spline
	bool spline;
	//! create: layer path (default the active layer)
	string layer;
	//! create: the new entity's name (default generated)
	string name;
	//! create: "r g b a", each 0..1
	string color;
	//! create: entity ref of the new shape's parent
	string parent;
	//! area (TS only): circle, rectangle or star
	string shape;
	//! area (TS only): "x y z"
	string centre;
	//! area (TS only): metres as text
	string width;
	string length;
	//! area (TS only)
	int segments;
	int branches;
	string innerRatio;
	//! parallel, edit: snap the points to the ground
	bool snapToGround;
	//! area (TS only): an existing shape whose points the outline replaces (TS calls edit set)
	string target;
	//! import (TS only): project-relative .shp
	string path;
	//! import (TS only): "x y z"
	string offset;
	//! parallel: offsets in metres as text, at most 16
	ref array<string> offsets;
	//! parallel: point thinning in metres, as text
	string minDistance;
	//! parallel: create the copies as children of the source
	bool asChild;
	//! edit: set, insert, remove, move, open or close
	string op;
	//! edit: the point index of insert, remove and move (-1 when left out)
	int index;

	void EMCP_WB_ShapeRequest()
	{
		points = {};
		offsets = {};

		RegV("action");
		RegV("entity");
		RegV("cursor");
		RegV("limit");
		RegV("tesselated");
		RegV("points");
		RegV("closed");
		RegV("spline");
		RegV("layer");
		RegV("name");
		RegV("color");
		RegV("parent");
		RegV("shape");
		RegV("centre");
		RegV("width");
		RegV("length");
		RegV("segments");
		RegV("branches");
		RegV("innerRatio");
		RegV("snapToGround");
		RegV("target");
		RegV("path");
		RegV("offset");
		RegV("offsets");
		RegV("minDistance");
		RegV("asChild");
		RegV("op");
		RegV("index");

		// Defaults for keys the request leaves out.
		limit = 0;
		index = -1;
	}
}

class EMCP_WB_ShapeResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string action;
	string code;
	string message;
	string next;
	//! points, create, edit: the shape's id: reference
	string id;
	string className;
	//! points: the shape is closed; edit: closed after the edit
	bool closed;
	//! points: points in the shape; create: points written (read back); edit: points after it
	int total;
	string nextCursor;
	//! points: "x y z" world space
	ref array<string> points;
	//! points (spline anchors): "in|out|explicit" per point of the page, shape-local
	ref array<string> tangents;
	string undoName;
	//! parallel: copies created
	int created;
	//! parallel: id: references of the copies
	ref array<string> ids;

	void EMCP_WB_ShapeResponse()
	{
		points = {};
		tangents = {};
		ids = {};

		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("next");
		RegV("id");
		RegV("className");
		RegV("closed");
		RegV("total");
		RegV("nextCursor");
		RegV("points");
		RegV("tangents");
		RegV("undoName");
		RegV("created");
		RegV("ids");
	}
}

//! What one shape build made: a holder, not out parameters (an out IEntitySource does not
//! compile on 1.9.0.37, the EMCP_WB_EntityRefResult lesson). m_Src is assigned from a local only.
class EMCP_WB_ShapeBuild
{
	IEntitySource m_Src;
	int m_Written;
	string m_Why;
}

class EMCP_WB_Shape : NetApiHandler
{
	//! Rows per page: default and most.
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! Points one shape takes (spec section 2.3).
	static const int MIN_POINTS = 2;
	static const int MAX_POINTS = 2000;
	//! Offsets one parallel call takes.
	static const int MAX_OFFSETS = 16;
	//! Two points closer than this are the same point (closing point of a closed shape).
	static const float SAME_POINT = 0.001;
	//! parallel is GATED until probe P-W6-16 shows a handler calls SCR_ParallelShapeHelper and the
	//! copies land where they should. The main session sets this true for the probe and after it.
	static const bool PARALLEL_OPEN = false;
	//! edit is GATED until probe P-W7-14 shows each op writes the points asked with one undo each
	//! (insert at an index inside the array is unproven). The main session sets this true.
	static const bool EDIT_OPEN = false;
	static const string POLYLINE_CLASS = "PolylineShapeEntity";
	static const string SPLINE_CLASS = "SplineShapeEntity";
	//! Refusal codes, spelled as in src/manifest/vocabulary.ts (NOT_A_SHAPE lands with W6).
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string NO_WORLD = "NO_WORLD";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string NOT_A_SHAPE = "NOT_A_SHAPE";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string GATED = "GATED";
	//! Undo history point names (BeginEntityAction).
	static const string UNDO_CREATE = "EMCP wb_shape create";
	static const string UNDO_PARALLEL = "EMCP wb_shape parallel";
	//! edit's undo name is this plus " <op>".
	static const string UNDO_EDIT = "EMCP wb_shape edit";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ShapeRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ShapeRequest req = EMCP_WB_ShapeRequest.Cast(request);
		EMCP_WB_ShapeResponse resp = new EMCP_WB_ShapeResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "points")
			ReadPoints(req, resp);
		else if (req.action == "create")
			CreateShape(req, resp);
		else if (req.action == "area")
			RefuseArea(req, resp);
		else if (req.action == "import")
			RefuseImport(req, resp);
		else if (req.action == "parallel")
			ParallelShapes(req, resp);
		else if (req.action == "edit")
			EditShape(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of points, create, edit, area, import, parallel");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_ShapeResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_ShapeResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor API with a loaded world, or null with the error written. GetModule opens a
	//! closed World Editor (DEC-053), as every entity handler does.
	protected static WorldEditorAPI EditorApi(EMCP_WB_ShapeResponse resp)
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
	//! The guard of an in-memory edit, in order: the project is found (DEC-058), the World Editor
	//! has a loaded world, the editor is not in play mode. The API, or null with the refusal written.
	protected static WorldEditorAPI EditApi(EMCP_WB_ShapeResponse resp)
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
	protected static IEntitySource ResolveOne(WorldEditorAPI api, string entityRef, EMCP_WB_ShapeResponse resp)
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
	protected static ShapeEntity ShapeOf(WorldEditorAPI api, IEntitySource src, EMCP_WB_ShapeResponse resp)
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
	//! "r g b a" (spaces or commas), four numbers each 0..1, as the text LineColor takes. False with
	//! a why otherwise.
	static bool ParseColor(string text, out string colorText, out string why)
	{
		colorText = "";
		why = "";
		string s = text;
		s.Replace(",", " ");
		array<string> parts = {};
		s.Split(" ", parts, true);
		if (parts.Count() != 4)
		{
			why = "color is \"r g b a\" (four numbers 0..1), got '" + text + "'";
			return false;
		}
		string joined = "";
		for (int i = 0; i < 4; i++)
		{
			float channel = 0;
			if (!EMCP_WB_Common.ParseFloat(parts.Get(i), channel) || channel < 0 || channel > 1)
			{
				why = "color component " + i.ToString() + " ('" + parts.Get(i) + "') is not a number in 0..1";
				return false;
			}
			if (i > 0)
				joined += " ";
			joined += channel.ToString();
		}
		colorText = joined;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The centre of the box around the points (the import plugin's shape origin). Not empty.
	static vector BoxCentre(array<vector> worldPoints)
	{
		vector lo = worldPoints.Get(0);
		vector hi = worldPoints.Get(0);
		for (int i = 1; i < worldPoints.Count(); i++)
		{
			vector p = worldPoints.Get(i);
			for (int k = 0; k < 3; k++)
			{
				if (p[k] < lo[k])
					lo[k] = p[k];
				if (p[k] > hi[k])
					hi[k] = p[k];
			}
		}
		return lo + (hi - lo) * 0.5;
	}

	//------------------------------------------------------------------------------------------------
	//! Builds one shape inside an open entity action: CreateEntity at origin (angles 0) under
	//! parentSrc (null: top level), then per local point CreateObjectArrayVariableMember ("Points",
	//! "ShapePoint", i) and SetVariableValue "Position" through the ("Points", i) path, then
	//! "IsClosed" and "LineColor" when asked. A failed step deletes the half-built shape inside the
	//! same action and answers false with build.m_Why. On success build.m_Src is the new source and
	//! build.m_Written the point count read back (GetObjectArray "Points").
	protected static bool BuildShape(WorldEditorAPI api, string shapeClass, string entityName, int layerId, IEntitySource parentSrc, vector origin, array<vector> localPoints, bool isClosed, string colorText, notnull EMCP_WB_ShapeBuild build)
	{
		build.m_Written = 0;
		build.m_Why = "";
		IEntitySource made = api.CreateEntity(shapeClass, entityName, layerId, parentSrc, origin, vector.Zero);
		if (!made)
		{
			build.m_Why = "CreateEntity returned null for " + shapeClass;
			return false;
		}

		string failedStep = "";
		for (int i = 0; i < localPoints.Count(); i++)
		{
			if (!api.CreateObjectArrayVariableMember(made, null, "Points", "ShapePoint", i))
			{
				failedStep = "CreateObjectArrayVariableMember for point " + i.ToString();
				break;
			}
			array<ref ContainerIdPathEntry> pointPath = {};
			pointPath.Insert(new ContainerIdPathEntry("Points", i));
			if (!api.SetVariableValue(made, pointPath, "Position", EMCP_WB_Common.VectorToString(localPoints.Get(i))))
			{
				failedStep = "SetVariableValue Position of point " + i.ToString();
				break;
			}
		}
		if (failedStep == "" && isClosed && !api.SetVariableValue(made, null, "IsClosed", "1"))
			failedStep = "SetVariableValue IsClosed";
		if (failedStep == "" && colorText != "" && !api.SetVariableValue(made, null, "LineColor", colorText))
			failedStep = "SetVariableValue LineColor";

		if (failedStep != "")
		{
			bool removed = api.DeleteEntity(made);
			if (removed)
				build.m_Why = failedStep + " returned false; the half-built shape was deleted";
			else
				build.m_Why = failedStep + " returned false and DeleteEntity of the half-built shape returned false too";
			return false;
		}

		BaseContainerList written = made.GetObjectArray("Points");
		if (written)
			build.m_Written = written.Count();
		build.m_Src = made;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! points: GetPointsPositions (local to the shape) through the shape's world transform, paged.
	//! tesselated: GenerateTesselatedShape into a local array instead (taken as shape-local too).
	//! A spline's anchor page also answers tangents: GetTangents (two out vectors, shape-local) and
	//! HasPointExplicitTangents per point of the page, as "in|out|explicit".
	protected static void ReadPoints(EMCP_WB_ShapeRequest req, EMCP_WB_ShapeResponse resp)
	{
		if (req.entity == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "entity required", "an entity reference (wb_entity list)");
			return;
		}
		WorldEditorAPI api = EditorApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;
		ShapeEntity shapeEnt = ShapeOf(api, src, resp);
		if (!shapeEnt)
			return;

		array<vector> localPoints = {};
		if (req.tesselated)
			shapeEnt.GenerateTesselatedShape(localPoints);
		else
			shapeEnt.GetPointsPositions(localPoints);
		int total = localPoints.Count();
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
				Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " points, the shape now has " + total.ToString(), "read again without a cursor");
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

		vector mat[4];
		shapeEnt.GetWorldTransform(mat);
		resp.id = EMCP_WB_EntityRef.Format(src);
		resp.className = src.GetClassName();
		resp.closed = shapeEnt.IsClosed();
		resp.total = total;
		for (int i = start; i < end; i++)
		{
			vector localPos = localPoints.Get(i);
			resp.points.Insert(EMCP_WB_Common.VectorToString(localPos.Multiply4(mat)));
		}
		SplineShapeEntity splineEnt = SplineShapeEntity.Cast(shapeEnt);
		if (splineEnt && !req.tesselated)
		{
			for (int t = start; t < end; t++)
			{
				vector inTangent = vector.Zero;
				vector outTangent = vector.Zero;
				splineEnt.GetTangents(t, inTangent, outTangent);
				string explicitFlag = "0";
				if (splineEnt.HasPointExplicitTangents(t))
					explicitFlag = "1";
				resp.tangents.Insert(EMCP_WB_Common.VectorToString(inTangent) + "|" + EMCP_WB_Common.VectorToString(outTangent) + "|" + explicitFlag);
			}
		}
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();
		int shown = end - start;
		string kind = "points";
		if (req.tesselated)
			kind = "tesselated points";
		Answer(resp, "ok", "", kind + ": " + shown.ToString() + " of " + total.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! create: a polyline or spline from world points, under a parent, in a layer, one entity action.
	//! Top level: the shape sits at the points' box centre and each point is written relative to it
	//! (the import plugin's form). Under a parent: the centre and the points are taken into the
	//! parent's space (CoordToLocal), the shape's angles 0 relative to the parent; CreateEntity's
	//! coords are parent-relative there, as SCR_ParallelShapeTool relies on [unverified until P-W6-16].
	protected static void CreateShape(EMCP_WB_ShapeRequest req, EMCP_WB_ShapeResponse resp)
	{
		int pointCount = 0;
		if (req.points)
			pointCount = req.points.Count();
		if (pointCount < MIN_POINTS || pointCount > MAX_POINTS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "points must hold " + MIN_POINTS.ToString() + " to " + MAX_POINTS.ToString() + " entries, got " + pointCount.ToString() + "; nothing was created", "points as \"x y z\" world positions");
			return;
		}
		if (req.closed && pointCount < 3)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "a closed shape needs at least 3 points; nothing was created", "add a point or leave closed false");
			return;
		}
		array<vector> worldPoints = {};
		for (int i = 0; i < pointCount; i++)
		{
			vector parsed = vector.Zero;
			string parseErr = "";
			if (!EMCP_WB_Common.ParseVectorString(req.points.Get(i), parsed, parseErr))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "points[" + i.ToString() + "]: " + parseErr + "; nothing was created", "points as \"x y z\" world positions");
				return;
			}
			worldPoints.Insert(parsed);
		}
		string colorText = "";
		if (req.color != "")
		{
			string colorWhy = "";
			if (!ParseColor(req.color, colorText, colorWhy))
			{
				Answer(resp, "error", INVALID_ARGUMENT, colorWhy + "; nothing was created", "color as \"r g b a\" in 0..1");
				return;
			}
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource parentSrc = null;
		IEntity parentEnt = null;
		if (req.parent != "")
		{
			parentSrc = ResolveOne(api, req.parent, resp);
			if (!parentSrc)
				return;
			parentEnt = api.SourceToEntity(parentSrc);
			if (!parentEnt)
			{
				Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "the parent has no runtime entity (SourceToEntity returned null); nothing was created", "pick another parent (wb_entity list)");
				return;
			}
		}
		int layerId = api.GetCurrentEntityLayerId();
		if (req.layer != "")
		{
			int currentSubScene = api.GetCurrentSubScene();
			layerId = EMCP_WB_LayersUtil.LayerIdOf(api, currentSubScene, req.layer);
			if (layerId < 0)
			{
				Answer(resp, "error", PATH_NOT_FOUND, "no layer '" + req.layer + "' in sub-scene " + currentSubScene.ToString() + "; nothing was created", "list the layers (wb_layers list)");
				return;
			}
		}

		vector worldOrigin = BoxCentre(worldPoints);
		vector origin = worldOrigin;
		if (parentEnt)
			origin = parentEnt.CoordToLocal(worldOrigin);
		array<vector> localPoints = {};
		for (int p = 0; p < pointCount; p++)
		{
			vector worldPoint = worldPoints.Get(p);
			if (parentEnt)
				localPoints.Insert(parentEnt.CoordToLocal(worldPoint) - origin);
			else
				localPoints.Insert(worldPoint - origin);
		}
		string shapeClass = POLYLINE_CLASS;
		if (req.spline)
			shapeClass = SPLINE_CLASS;

		resp.undoName = UNDO_CREATE;
		if (!api.BeginEntityAction(UNDO_CREATE))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		EMCP_WB_ShapeBuild build = new EMCP_WB_ShapeBuild();
		bool built = BuildShape(api, shapeClass, req.name, layerId, parentSrc, origin, localPoints, req.closed, colorText, build);
		bool renameFailed = false;
		if (built && req.name != "" && build.m_Src.GetName() != req.name)
			renameFailed = !api.RenameEntity(build.m_Src, req.name);
		api.EndEntityAction();
		if (!built)
		{
			Answer(resp, "error", ENGINE_FALSE, build.m_Why, "read the World Editor log; undo with wb_undo_redo if anything is left");
			return;
		}

		resp.id = EMCP_WB_EntityRef.Format(build.m_Src);
		resp.className = build.m_Src.GetClassName();
		resp.total = build.m_Written;
		if (build.m_Written != pointCount)
		{
			Answer(resp, "error", ENGINE_FALSE, "created, but " + build.m_Written.ToString() + " of " + pointCount.ToString() + " points read back", "read it with wb_shape points; undo with wb_undo_redo");
			return;
		}
		if (renameFailed)
		{
			Answer(resp, "error", ENGINE_FALSE, "created, but RenameEntity to '" + req.name + "' returned false (name in use?)", "rename it, or undo the create (wb_undo_redo)");
			return;
		}
		Answer(resp, "ok", "", "created " + shapeClass + " with " + pointCount.ToString() + " points; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! area: served by the TS tool (it computes the outline and calls create); nothing is done here.
	protected static void RefuseArea(EMCP_WB_ShapeRequest req, EMCP_WB_ShapeResponse resp)
	{
		Answer(resp, "error", INVALID_ARGUMENT, "area (" + req.shape + ", width " + req.width + ") is served by the wb_shape tool, which computes the outline and calls create; the handler does nothing for it", "call wb_shape area through the MCP tool");
	}

	//------------------------------------------------------------------------------------------------
	//! import: served by the TS tool (it reads the shapefile and calls create); nothing is done here.
	protected static void RefuseImport(EMCP_WB_ShapeRequest req, EMCP_WB_ShapeResponse resp)
	{
		Answer(resp, "error", INVALID_ARGUMENT, "import of '" + req.path + "' is served by the wb_shape tool, which reads the shapefile and calls create per record; the handler reads no file", "call wb_shape import through the MCP tool");
	}

	//------------------------------------------------------------------------------------------------
	//! parallel: per offset, SCR_ParallelShapeHelper.GetAnchorsAndTesselatedPointsFromShape/5 on the
	//! source (points relative to it; the last out is a local array<int>), SnapRelativePointsToGround
	//! when asked, ReducePointsDensity when minDistance > 0; a closed source's repeated closing point
	//! is dropped and the copy is closed. Spline copies (spline and a spline source) take the offset
	//! anchors, polyline copies the offset tesselated points. Every copy is computed and checked
	//! before the first write; then one entity action creates them all: as children of the source
	//! (origin 0, points as computed: SCR_ParallelShapeTool's form) or at the top level from world
	//! points (GetWorldTransform). GATED until P-W6-16 (PARALLEL_OPEN).
	protected static void ParallelShapes(EMCP_WB_ShapeRequest req, EMCP_WB_ShapeResponse resp)
	{
		if (!PARALLEL_OPEN)
		{
			Refuse(resp, GATED, "parallel waits for probe P-W6-16 (a handler calling SCR_ParallelShapeHelper is unproven); nothing was sent", "the main session opens it after P-W6-16 passes");
			return;
		}
		if (req.entity == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "entity required", "the source shape's reference (wb_entity list)");
			return;
		}
		int offsetCount = 0;
		if (req.offsets)
			offsetCount = req.offsets.Count();
		if (offsetCount < 1 || offsetCount > MAX_OFFSETS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "offsets must hold 1 to " + MAX_OFFSETS.ToString() + " entries, got " + offsetCount.ToString() + "; nothing was created", "offsets in metres as text, e.g. [\"5\", \"-5\"]");
			return;
		}
		array<float> offsetValues = {};
		for (int o = 0; o < offsetCount; o++)
		{
			float offsetValue = 0;
			if (!EMCP_WB_Common.ParseFloat(req.offsets.Get(o), offsetValue))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "offsets[" + o.ToString() + "] is not a number: '" + req.offsets.Get(o) + "'; nothing was created", "offsets in metres as text");
				return;
			}
			offsetValues.Insert(offsetValue);
		}
		float thinning = 0;
		if (req.minDistance != "" && (!EMCP_WB_Common.ParseFloat(req.minDistance, thinning) || thinning < 0))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "minDistance must be a number of 0 or more, got '" + req.minDistance + "'; nothing was created", "minDistance in metres as text");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;
		ShapeEntity shapeEnt = ShapeOf(api, src, resp);
		if (!shapeEnt)
			return;
		if (shapeEnt.GetPointCount() < MIN_POINTS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the source shape has " + shapeEnt.GetPointCount().ToString() + " points, at least 2 are needed; nothing was created", "pick another shape");
			return;
		}
		bool sourceIsSpline = SplineShapeEntity.Cast(shapeEnt) != null;
		bool splineOut = req.spline && sourceIsSpline;
		bool isClosed = shapeEnt.IsClosed();
		string shapeClass = POLYLINE_CLASS;
		if (splineOut)
			shapeClass = SPLINE_CLASS;

		// Every copy's points, before any write.
		array<ref array<vector>> copies = {};
		for (int c = 0; c < offsetCount; c++)
		{
			array<vector> anchors = {};
			array<vector> tesselated = {};
			array<int> anchorIndices = {};
			if (!SCR_ParallelShapeHelper.GetAnchorsAndTesselatedPointsFromShape(shapeEnt, offsetValues.Get(c), anchors, tesselated, anchorIndices))
			{
				Answer(resp, "error", ENGINE_FALSE, "SCR_ParallelShapeHelper.GetAnchorsAndTesselatedPointsFromShape returned false for offset " + req.offsets.Get(c) + "; nothing was created", "check the source shape with wb_shape points");
				return;
			}
			array<vector> relPoints = {};
			if (splineOut)
				relPoints.Copy(anchors);
			else
				relPoints.Copy(tesselated);
			int last = relPoints.Count() - 1;
			if (isClosed && last >= 1 && vector.Distance(relPoints.Get(last), relPoints.Get(0)) < SAME_POINT)
				relPoints.Remove(last);
			if (req.snapToGround)
				SCR_ParallelShapeHelper.SnapRelativePointsToGround(shapeEnt, relPoints);
			if (thinning > 0 && relPoints.Count() >= 3)
				SCR_ParallelShapeHelper.ReducePointsDensity(thinning, relPoints);
			int copyCount = relPoints.Count();
			if (copyCount < MIN_POINTS || copyCount > MAX_POINTS || (isClosed && copyCount < 3))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "offset " + req.offsets.Get(c) + " gives " + copyCount.ToString() + " points, a shape takes " + MIN_POINTS.ToString() + " to " + MAX_POINTS.ToString() + "; nothing was created", "change the offset or minDistance");
				return;
			}
			copies.Insert(relPoints);
		}

		vector mat[4];
		shapeEnt.GetWorldTransform(mat);
		int currentLayerId = api.GetCurrentEntityLayerId();
		int sourceLayerId = src.GetLayerID();

		resp.undoName = UNDO_PARALLEL;
		if (!api.BeginEntityAction(UNDO_PARALLEL))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		string failure = "";
		for (int n = 0; n < copies.Count(); n++)
		{
			array<vector> relCopy = copies.Get(n);
			EMCP_WB_ShapeBuild build = new EMCP_WB_ShapeBuild();
			bool built = false;
			if (req.asChild)
			{
				built = BuildShape(api, shapeClass, "", sourceLayerId, src, vector.Zero, relCopy, isClosed, "", build);
			}
			else
			{
				array<vector> worldCopy = {};
				for (int w = 0; w < relCopy.Count(); w++)
				{
					vector rel = relCopy.Get(w);
					worldCopy.Insert(rel.Multiply4(mat));
				}
				vector worldOrigin = BoxCentre(worldCopy);
				array<vector> localCopy = {};
				for (int k = 0; k < worldCopy.Count(); k++)
					localCopy.Insert(worldCopy.Get(k) - worldOrigin);
				IEntitySource noParent = null;
				built = BuildShape(api, shapeClass, "", currentLayerId, noParent, worldOrigin, localCopy, isClosed, "", build);
			}
			if (!built)
			{
				failure = "offset " + req.offsets.Get(n) + ": " + build.m_Why;
				break;
			}
			resp.ids.Insert(EMCP_WB_EntityRef.Format(build.m_Src));
			resp.created = resp.created + 1;
		}
		api.EndEntityAction();
		if (failure != "")
		{
			Answer(resp, "error", ENGINE_FALSE, failure + "; " + resp.created.ToString() + " copies were made before it", "undo with wb_undo_redo to remove them");
			return;
		}
		Answer(resp, "ok", "", "created " + resp.created.ToString() + " " + shapeClass + " copies; undo with wb_undo_redo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! Points in the shape source's "Points" array (0 when it has none).
	protected static int SourcePointCount(IEntitySource src)
	{
		BaseContainerList pointList = src.GetObjectArray("Points");
		if (!pointList)
			return 0;
		return pointList.Count();
	}

	//------------------------------------------------------------------------------------------------
	//! SetVariableValue "Position" of point slot through the ("Points", slot) path. The failed step
	//! as text, or "" when it worked.
	protected static string SetPointPosition(WorldEditorAPI api, IEntitySource src, int slot, vector localPos)
	{
		array<ref ContainerIdPathEntry> slotPath = {};
		slotPath.Insert(new ContainerIdPathEntry("Points", slot));
		if (!api.SetVariableValue(src, slotPath, "Position", EMCP_WB_Common.VectorToString(localPos)))
			return "SetVariableValue Position of point " + slot.ToString();
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! The engine calls of one edit op inside the open entity action, in SCR_ShapeAreaTool's order:
	//! set appends the new points at before + i, then removes the old ones from the end; insert
	//! creates and positions the new points from index at; remove removes the point at; move
	//! re-sets the position of the point at; close sets "IsClosed" "1"; open clears it. The failed
	//! step as text, or "" when every call answered true.
	protected static string ApplyEdit(WorldEditorAPI api, IEntitySource src, string editOp, int at, int before, array<vector> localPoints)
	{
		if (editOp == "close")
		{
			if (!api.SetVariableValue(src, null, "IsClosed", "1"))
				return "SetVariableValue IsClosed";
			return "";
		}
		if (editOp == "open")
		{
			if (!api.ClearVariableValue(src, null, "IsClosed"))
				return "ClearVariableValue IsClosed";
			return "";
		}
		if (editOp == "remove")
		{
			if (!api.RemoveObjectArrayVariableMember(src, null, "Points", at))
				return "RemoveObjectArrayVariableMember of point " + at.ToString();
			return "";
		}
		if (editOp == "move")
			return SetPointPosition(api, src, at, localPoints.Get(0));

		// set and insert: append (set) or insert (insert) the new points, each created then positioned.
		int first = at;
		if (editOp == "set")
			first = before;
		for (int i = 0; i < localPoints.Count(); i++)
		{
			int slot = first + i;
			if (!api.CreateObjectArrayVariableMember(src, null, "Points", "ShapePoint", slot))
				return "CreateObjectArrayVariableMember for point " + slot.ToString();
			string positionStep = SetPointPosition(api, src, slot, localPoints.Get(i));
			if (positionStep != "")
				return positionStep;
		}
		if (editOp == "set")
		{
			// The old points, from the end: the new ones move down to 0 .. count - 1.
			for (int oldSlot = before - 1; oldSlot >= 0; oldSlot--)
			{
				if (!api.RemoveObjectArrayVariableMember(src, null, "Points", oldSlot))
					return "RemoveObjectArrayVariableMember of old point " + oldSlot.ToString();
			}
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! edit: one change to an existing shape (set, insert, remove, move, open, close) in one entity
	//! action. Every argument is checked before the gate, the gate before any engine call, and the
	//! index and counts against the shape before the action opens. World points (snapToGround: y
	//! from TryGetTerrainSurfaceY) are taken into the shape's space with CoordToLocal. GATED until
	//! P-W7-14 (EDIT_OPEN).
	protected static void EditShape(EMCP_WB_ShapeRequest req, EMCP_WB_ShapeResponse resp)
	{
		if (req.entity == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "entity required", "the shape's reference (wb_entity list)");
			return;
		}
		string editOp = req.op;
		bool takesPoints = editOp == "set" || editOp == "insert" || editOp == "move";
		bool takesIndex = editOp == "insert" || editOp == "remove" || editOp == "move";
		if (!takesPoints && editOp != "remove" && editOp != "open" && editOp != "close")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "op must be set, insert, remove, move, open or close, got '" + editOp + "'; nothing was changed", "pass op");
			return;
		}
		int pointCount = 0;
		if (req.points)
			pointCount = req.points.Count();
		if (!takesPoints && pointCount > 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "op " + editOp + " takes no points, got " + pointCount.ToString() + "; nothing was changed", "leave points out");
			return;
		}
		if (editOp == "set" && (pointCount < MIN_POINTS || pointCount > MAX_POINTS))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "set takes " + MIN_POINTS.ToString() + " to " + MAX_POINTS.ToString() + " points, got " + pointCount.ToString() + "; nothing was changed", "points as \"x y z\" world positions");
			return;
		}
		if (editOp == "insert" && (pointCount < 1 || pointCount > MAX_POINTS))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "insert takes 1 to " + MAX_POINTS.ToString() + " points, got " + pointCount.ToString() + "; nothing was changed", "points as \"x y z\" world positions");
			return;
		}
		if (editOp == "move" && pointCount != 1)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "move takes exactly 1 point, got " + pointCount.ToString() + "; nothing was changed", "points: [\"x y z\"], the new world position");
			return;
		}
		if (takesIndex && req.index < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "op " + editOp + " needs index (0 or more), got " + req.index.ToString() + "; nothing was changed", "pass index");
			return;
		}
		array<vector> worldPoints = {};
		for (int i = 0; i < pointCount; i++)
		{
			vector parsed = vector.Zero;
			string parseErr = "";
			if (!EMCP_WB_Common.ParseVectorString(req.points.Get(i), parsed, parseErr))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "points[" + i.ToString() + "]: " + parseErr + "; nothing was changed", "points as \"x y z\" world positions");
				return;
			}
			worldPoints.Insert(parsed);
		}
		if (!EDIT_OPEN)
		{
			Refuse(resp, GATED, "edit waits for probe P-W7-14 (the shape edit ops are unproven from a handler); the arguments are valid, nothing was sent", "the main session opens it after P-W7-14 passes");
			return;
		}

		WorldEditorAPI api = EditApi(resp);
		if (!api)
			return;
		IEntitySource src = ResolveOne(api, req.entity, resp);
		if (!src)
			return;
		ShapeEntity shapeEnt = ShapeOf(api, src, resp);
		if (!shapeEnt)
			return;
		int before = SourcePointCount(src);
		bool wasClosed = shapeEnt.IsClosed();
		resp.id = EMCP_WB_EntityRef.Format(src);

		// The index, the counts and the closed flag against the shape, before any write.
		int expected = before;
		bool closedAfter = wasClosed;
		string rangeWhy = "";
		if (editOp == "set")
		{
			expected = pointCount;
			if (wasClosed && pointCount < 3)
				rangeWhy = "the shape is closed and set gives " + pointCount.ToString() + " points, at least 3 are needed";
		}
		else if (editOp == "insert")
		{
			expected = before + pointCount;
			if (req.index > before)
				rangeWhy = "insert index " + req.index.ToString() + " is past the end (the shape has " + before.ToString() + " points; " + before.ToString() + " appends)";
			else if (expected > MAX_POINTS)
				rangeWhy = "insert gives " + expected.ToString() + " points, a shape takes at most " + MAX_POINTS.ToString();
		}
		else if (editOp == "remove")
		{
			expected = before - 1;
			if (req.index >= before)
				rangeWhy = "remove index " + req.index.ToString() + " is out of range (the shape has " + before.ToString() + " points)";
			else if (expected < MIN_POINTS || (wasClosed && expected < 3))
				rangeWhy = "remove leaves " + expected.ToString() + " points, too few for this shape";
		}
		else if (editOp == "move")
		{
			if (req.index >= before)
				rangeWhy = "move index " + req.index.ToString() + " is out of range (the shape has " + before.ToString() + " points)";
		}
		else if (editOp == "close")
		{
			closedAfter = true;
			if (before < 3)
				rangeWhy = "a closed shape needs at least 3 points, this one has " + before.ToString();
		}
		else
		{
			closedAfter = false;
		}
		if (rangeWhy != "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, rangeWhy + "; nothing was changed", "read the shape with wb_shape points");
			return;
		}
		if ((editOp == "close" && wasClosed) || (editOp == "open" && !wasClosed))
		{
			resp.total = before;
			resp.closed = wasClosed;
			string stateText = "open";
			if (wasClosed)
				stateText = "closed";
			Answer(resp, "ok", "", "the shape is already " + stateText + "; nothing was changed", "");
			return;
		}

		array<vector> localPoints = {};
		for (int p = 0; p < worldPoints.Count(); p++)
		{
			vector worldPoint = worldPoints.Get(p);
			if (req.snapToGround)
			{
				float groundY = 0;
				if (!api.TryGetTerrainSurfaceY(worldPoint[0], worldPoint[2], groundY))
				{
					Answer(resp, "error", INVALID_ARGUMENT, "points[" + p.ToString() + "] is not over terrain (TryGetTerrainSurfaceY answered false); nothing was changed", "move the point over terrain or leave snapToGround false");
					return;
				}
				worldPoint[1] = groundY;
			}
			localPoints.Insert(shapeEnt.CoordToLocal(worldPoint));
		}

		string undoText = UNDO_EDIT + " " + editOp;
		resp.undoName = undoText;
		if (!api.BeginEntityAction(undoText))
		{
			resp.undoName = "";
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
			return;
		}
		string failedStep = ApplyEdit(api, src, editOp, req.index, before, localPoints);
		int after = SourcePointCount(src);
		api.EndEntityAction();

		resp.total = after;
		resp.closed = closedAfter;
		if (failedStep != "")
		{
			resp.closed = wasClosed;
			Answer(resp, "error", ENGINE_FALSE, failedStep + " returned false; the calls before it are in the one undo point '" + undoText + "'", "undo with wb_undo_redo, then read the shape with wb_shape points");
			return;
		}
		if (after != expected)
		{
			Answer(resp, "error", ENGINE_FALSE, editOp + " ran, but the shape has " + after.ToString() + " points where " + expected.ToString() + " were expected", "read it with wb_shape points; undo with wb_undo_redo");
			return;
		}
		Answer(resp, "ok", "", editOp + ": the shape has " + after.ToString() + " points; undo with wb_undo_redo", "");
	}
}
