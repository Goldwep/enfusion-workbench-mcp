/**
 * EMCP_WB_Navmesh.c - Navmesh handler of wb_navmesh (wave W5, phase5-w5-spec.md section 2.3)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Navmesh", dispatching on "action":
 *   status         the AIWorld of the open world, its navmesh projects (the NavmeshProject of each
 *                  NavmeshWorldComponent on the AIWorld's entity source), the terrain bounds and a
 *                  paged tile-state grid (IsTileLoaded, IsTileValid, IsTileRequested per point; at
 *                  most 40,000 points)
 *   tile           the tile state at one position
 *   load           LoadTileIn at one position (in memory), then IsTileLoaded
 *   reachable      GetReachablePoint/3 (probe P-W5-14: the vector has no out marker, so the point
 *                  is answered only when the engine wrote it back; found is answered either way)
 *   rebuild        AIWorld.RequestNavmeshRebuild/2 of a box of at most 512 m per side (probe
 *                  P-W5-15: the call returns void, so requested only says the call was made)
 *   rebuildEntity  SCR_AIWorld.GetNavmeshRebuildAreas/3, then RequestNavmeshRebuildEntity/1
 *
 * The AIWorld: GetGame().GetAIWorld() when it is an entity of the edited world (EntityToSource
 * answers its source), else the first editor entity whose class inherits AIWorld and whose runtime
 * entity casts to AIWorld. A navmesh project name reaches GetNavmeshWorldComponent only when it is
 * one the AIWorld's entity source declares: a name the engine is not shown to know is refused
 * before the call (NO_NAVMESH_COMPONENT).
 *
 * Guards (spec section 1.3): every action needs an open World Editor world (the shared
 * EMCP_WB_Common.NoWorldReason check), not prefab edit mode and not play mode (WRONG_MODE).
 * rebuild and rebuildEntity also need the project (DEC-058) and a world of that project
 * (NOT_IN_PROJECT), and are a dry run unless confirm is true. A rebuild request changes the
 * navmesh in memory only: it is not an entity edit, so it opens no undo step, and nothing here
 * saves a navmesh (saving stays the World Editor Navmesh Tool, W8). No folder listing, no FileIO.
 * Floats travel as text (EMCP_WB_Common.ParseFloat, ParseVectorString).
 * Paging: cursor "<start>:<count>", count = the grid's points at the first read; a changed count
 * answers STALE_CURSOR. limit default 100, max 200.
 * A refusal answers status "refused" with code and next set and message in the form
 * "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Navmesh.json.
 */

class EMCP_WB_NavmeshRequest : JsonApiStruct
{
	string action;
	//! status, tile, load, reachable: navmesh project name (default the AIWorld's first)
	string project;
	//! status: grid step in metres, as text (default 24, raised until the grid fits the cap)
	string step;
	//! status: "<start>:<count>" from nextCursor
	string cursor;
	//! status: grid points per page (default 100, max 200)
	int limit;
	//! tile, load, reachable: "x y z"
	string position;
	//! reachable: metres, as text
	string distance;
	//! rebuild: box corners "x y z"
	string min;
	string max;
	//! rebuild, rebuildEntity: false (default) is a dry run
	bool confirm;
	//! rebuildEntity: id:/name:/index: reference (EMCP_WB_EntityRef)
	string entity;

	void EMCP_WB_NavmeshRequest()
	{
		RegV("action");
		RegV("project");
		RegV("step");
		RegV("cursor");
		RegV("limit");
		RegV("position");
		RegV("distance");
		RegV("min");
		RegV("max");
		RegV("confirm");
		RegV("entity");

		limit = 0;
		confirm = false;
	}
}

class EMCP_WB_NavmeshResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	//! status: entity ref of the AIWorld ("" when its source has no id)
	string aiWorld;
	string aiWorldClass;
	//! status: "game" (GetGame().GetAIWorld()) or "editor" (the editor entity scan)
	string aiWorldFrom;
	//! the navmesh project used
	string project;
	//! status: the navmesh projects the AIWorld declares
	ref array<string> projects;
	//! status: a NavmeshWorldComponent was reached
	bool component;
	string boundsMin;
	string boundsMax;
	//! status: the grid step used, metres as text
	string step;
	//! status: "x|z|loaded|valid|requested", flags 1 or 0
	ref array<string> rows;
	int total;
	int count;
	string nextCursor;
	string position;
	bool loaded;
	bool valid;
	bool requested;
	bool found;
	string point;
	string min;
	string max;
	bool dryRun;
	string entity;
	int areas;

	void EMCP_WB_NavmeshResponse()
	{
		projects = {};
		rows = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("aiWorld");
		RegV("aiWorldClass");
		RegV("aiWorldFrom");
		RegV("project");
		RegV("projects");
		RegV("component");
		RegV("boundsMin");
		RegV("boundsMax");
		RegV("step");
		RegV("rows");
		RegV("total");
		RegV("count");
		RegV("nextCursor");
		RegV("position");
		RegV("loaded");
		RegV("valid");
		RegV("requested");
		RegV("found");
		RegV("point");
		RegV("min");
		RegV("max");
		RegV("dryRun");
		RegV("entity");
		RegV("areas");
	}
}

//! What one action reached: the World Editor, the AIWorld and a navmesh component. A holder, not
//! out parameters: an out parameter of an engine pointer type does not compile (W1 fix-up 1).
class EMCP_WB_NavmeshContext
{
	WorldEditor m_Editor;
	WorldEditorAPI m_Api;
	AIWorld m_AIWorld;
	IEntitySource m_AISource;
	NavmeshWorldComponent m_Component;
	string m_From;
	string m_Project;
	ref array<string> m_Projects;
	bool m_HasBounds;
	vector m_BoundsMin;
	vector m_BoundsMax;

	void EMCP_WB_NavmeshContext()
	{
		m_Projects = {};
		m_From = "";
		m_Project = "";
		m_HasBounds = false;
		m_BoundsMin = vector.Zero;
		m_BoundsMax = vector.Zero;
	}
}

class EMCP_WB_Navmesh : NetApiHandler
{
	static const int PAGE_DEFAULT = 100;
	static const int PAGE_MAX = 200;
	//! Grid points status answers at most (spec 2.3).
	static const int GRID_MAX = 40000;
	//! Grid step in metres: the default (the Soldiers tile size) and the least accepted.
	static const float STEP_DEFAULT = 24;
	static const float STEP_MIN = 1;
	//! Factor the default step grows by until the grid fits GRID_MAX.
	static const float STEP_GROWTH = 1.5;
	//! A rebuild box or area side in metres at most (spec 2.3, BOX_TOO_LARGE).
	static const float BOX_MAX = 512;
	//! reachable: search distance in metres at most.
	static const float REACH_MAX = 500;
	//! reachable: what the point is offset by before the call, so a point the engine did not write
	//! back is told apart from one it did (P-W5-14).
	static const float UNWRITTEN_OFFSET = -100000;
	//! The NavmeshWorldComponent's settings object and its project variable (SCR_AIWorld.et).
	static const string SETTINGS_OBJECT = "NavmeshSettings";
	static const string PROJECT_VARIABLE = "NavmeshProject";
	//! Refusal codes, spelled as in src/manifest/vocabulary.ts.
	static const string NO_WORLD = "NO_WORLD";
	static const string MODULE_NOT_OPEN = "MODULE_NOT_OPEN";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string NO_AI_WORLD = "NO_AI_WORLD";
	static const string NO_NAVMESH_COMPONENT = "NO_NAVMESH_COMPONENT";
	static const string NOT_SCR_AI_WORLD = "NOT_SCR_AI_WORLD";
	static const string BOX_TOO_LARGE = "BOX_TOO_LARGE";
	static const string ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND";
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string NEXT_WORLD = "open a world (wb_module setResource)";
	static const string NEXT_AI_WORLD = "place an AIWorld (the SCR_AIWorld prefab) in the world";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_NavmeshRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_NavmeshRequest req = EMCP_WB_NavmeshRequest.Cast(request);
		EMCP_WB_NavmeshResponse resp = new EMCP_WB_NavmeshResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "status")
			Status(req, resp);
		else if (req.action == "tile")
			Tile(req, resp);
		else if (req.action == "load")
			Load(req, resp);
		else if (req.action == "reachable")
			Reachable(req, resp);
		else if (req.action == "rebuild")
			Rebuild(req, resp);
		else if (req.action == "rebuildEntity")
			RebuildEntity(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of status, tile, load, reachable, rebuild, rebuildEntity");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_NavmeshResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_NavmeshResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! "1" or "0".
	static string Flag(bool value)
	{
		if (value)
			return "1";
		return "0";
	}

	//------------------------------------------------------------------------------------------------
	//! True when the two vectors are equal in every component.
	static bool SameVector(vector a, vector b)
	{
		return a[0] == b[0] && a[1] == b[1] && a[2] == b[2];
	}

	//------------------------------------------------------------------------------------------------
	//! Guard "world": the World Editor with a loaded world, not in prefab edit mode, not in play
	//! mode. Fills the editor, the API and the terrain bounds into ctx; false with the refusal
	//! written. Workbench.GetModule opens a closed World Editor (DEC-053): GetModule may have opened
	//! the World Editor, as every entity handler's call does.
	protected static bool OpenWorld(EMCP_WB_NavmeshContext ctx, EMCP_WB_NavmeshResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Answer(resp, "error", MODULE_NOT_OPEN, "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return false;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			Refuse(resp, NO_WORLD, "the World Editor has no API: no world is open", NEXT_WORLD);
			return false;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, NO_WORLD, noWorld, NEXT_WORLD);
			return false;
		}
		if (worldEditor.IsPrefabEditMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in prefab edit mode; nothing was read", "leave prefab edit mode and open a world");
			return false;
		}
		if (api.IsGameMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in play mode; nothing was read", "stop play first (wb_world stop)");
			return false;
		}

		ctx.m_Editor = worldEditor;
		ctx.m_Api = api;
		vector boundsLow = vector.Zero;
		vector boundsHigh = vector.Zero;
		bool hasBounds = worldEditor.GetTerrainBounds(boundsLow, boundsHigh);
		if (hasBounds && boundsHigh[0] > boundsLow[0] && boundsHigh[2] > boundsLow[2])
		{
			ctx.m_HasBounds = true;
			ctx.m_BoundsMin = boundsLow;
			ctx.m_BoundsMax = boundsHigh;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Guard "project+world": the project is found (DEC-058), the world guard passes, and the open
	//! world is a world of the project: its path is under the project's file-system prefix
	//! ("$" + addon id + ":", as EMCP_WB_Module's save reads it) or, when absolute, under the
	//! project's folder. False with the refusal written.
	protected static bool ProjectWorld(EMCP_WB_NavmeshContext ctx, EMCP_WB_NavmeshResponse resp)
	{
		string addonId = "";
		string projectDir = "";
		string why = "";
		if (!EMCP_WB_Guard.Project(addonId, projectDir, why))
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was requested", "install the handlers in the project you have open");
			return false;
		}
		if (!OpenWorld(ctx, resp))
			return false;

		string worldPath = "";
		ctx.m_Api.GetWorldPath(worldPath);
		bool inside = false;
		if (worldPath != "")
		{
			if (worldPath.StartsWith("$" + addonId + ":"))
				inside = true;
			else if (EMCP_WB_Guard.IsUnder(worldPath, projectDir))
				inside = true;
		}
		if (!inside)
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "the open world is not a world of the open project; a navmesh rebuild runs only there", "open a world of the project you have open");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The AIWorld of the edited world into ctx (m_AIWorld, m_AISource, m_From, m_Projects); false
	//! with NO_AI_WORLD written. GetGame().GetAIWorld() counts only when it is an entity of the
	//! edited world (EntityToSource answers a source); else the editor entities are scanned for the
	//! first whose class inherits AIWorld and whose runtime entity casts to AIWorld.
	protected static bool FindAIWorld(EMCP_WB_NavmeshContext ctx, EMCP_WB_NavmeshResponse resp)
	{
		WorldEditorAPI api = ctx.m_Api;
		AIWorld aiFound = null;
		IEntitySource aiSource = null;
		string foundFrom = "";

		ArmaReforgerScripted game = GetGame();
		if (game)
		{
			AIWorld gameWorld = game.GetAIWorld();
			if (gameWorld)
			{
				IEntitySource gameSource = api.EntityToSource(gameWorld);
				if (gameSource)
				{
					aiFound = gameWorld;
					aiSource = gameSource;
					foundFrom = "game";
				}
			}
		}

		if (!aiFound)
		{
			int entityCount = api.GetEditorEntityCount();
			for (int e = 0; e < entityCount; e++)
			{
				IEntitySource candidate = api.GetEditorEntity(e);
				if (!candidate)
					continue;
				string candidateClass = candidate.GetClassName();
				typename candidateType = candidateClass.ToType();
				if (!candidateType)
					continue;
				if (!candidateType.IsInherited(AIWorld))
					continue;
				IEntity live = api.SourceToEntity(candidate);
				if (!live)
					continue;
				AIWorld asAIWorld = AIWorld.Cast(live);
				if (!asAIWorld)
					continue;
				aiFound = asAIWorld;
				aiSource = candidate;
				foundFrom = "editor";
				break;
			}
		}

		if (!aiFound)
		{
			Refuse(resp, NO_AI_WORLD, "the open world has no AIWorld (GetGame().GetAIWorld() gave none of this world and no editor entity is one)", NEXT_AI_WORLD);
			return false;
		}
		ctx.m_AIWorld = aiFound;
		ctx.m_AISource = aiSource;
		ctx.m_From = foundFrom;
		ReadProjects(ctx);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The navmesh project names the AIWorld's entity source declares: the NavmeshProject of the
	//! NavmeshSettings object of each component whose class inherits NavmeshWorldComponent.
	protected static void ReadProjects(EMCP_WB_NavmeshContext ctx)
	{
		ctx.m_Projects.Clear();
		IEntitySource src = ctx.m_AISource;
		if (!src)
			return;
		int componentCount = src.GetComponentCount();
		for (int c = 0; c < componentCount; c++)
		{
			IEntityComponentSource comp = src.GetComponent(c);
			if (!comp)
				continue;
			string compClass = comp.GetClassName();
			typename compType = compClass.ToType();
			if (!compType)
				continue;
			if (!compType.IsInherited(NavmeshWorldComponent))
				continue;
			BaseContainer settings = comp.GetObject(SETTINGS_OBJECT);
			if (!settings)
				continue;
			string projectName = "";
			if (!settings.Get(PROJECT_VARIABLE, projectName))
				continue;
			if (projectName != "" && ctx.m_Projects.Find(projectName) < 0)
				ctx.m_Projects.Insert(projectName);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The declared project names, comma separated.
	static string ProjectList(EMCP_WB_NavmeshContext ctx)
	{
		string list = "";
		for (int p = 0; p < ctx.m_Projects.Count(); p++)
		{
			if (p > 0)
				list = list + ", ";
			list = list + ctx.m_Projects.Get(p);
		}
		if (list == "")
			list = "none declared";
		return list;
	}

	//------------------------------------------------------------------------------------------------
	//! The navmesh component of a project into ctx (m_Component, m_Project): the wanted name, or the
	//! first declared one when wanted is empty. A name the AIWorld does not declare is refused
	//! before GetNavmeshWorldComponent is called. False with NO_NAVMESH_COMPONENT written.
	protected static bool ChooseComponent(EMCP_WB_NavmeshContext ctx, string wanted, EMCP_WB_NavmeshResponse resp)
	{
		string chosen = wanted;
		if (chosen == "")
		{
			if (ctx.m_Projects.Count() == 0)
			{
				Refuse(resp, NO_NAVMESH_COMPONENT, "the AIWorld declares no NavmeshWorldComponent with a NavmeshProject", "add a NavmeshWorldComponent to the AIWorld, or use the SCR_AIWorld prefab");
				return false;
			}
			chosen = ctx.m_Projects.Get(0);
		}
		else if (ctx.m_Projects.Find(chosen) < 0)
		{
			Refuse(resp, NO_NAVMESH_COMPONENT, "the AIWorld declares no navmesh project '" + chosen + "' (projects: " + ProjectList(ctx) + ")", "pass one of the projects status answers");
			return false;
		}

		NavmeshWorldComponent navmesh = ctx.m_AIWorld.GetNavmeshWorldComponent(chosen);
		if (!navmesh)
		{
			Refuse(resp, NO_NAVMESH_COMPONENT, "GetNavmeshWorldComponent('" + chosen + "') returned null", "check the AIWorld's navmesh settings (wb_component)");
			return false;
		}
		ctx.m_Component = navmesh;
		ctx.m_Project = chosen;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A position "x y z" into at; inside the terrain bounds (x and z) when the world has them.
	//! False with INVALID_ARGUMENT written.
	protected static bool ReadPosition(EMCP_WB_NavmeshContext ctx, string text, string what, out vector at, EMCP_WB_NavmeshResponse resp)
	{
		at = vector.Zero;
		vector parsed = vector.Zero;
		string error = "";
		if (!EMCP_WB_Common.ParseVectorString(text, parsed, error))
		{
			Answer(resp, "error", INVALID_ARGUMENT, what + ": " + error, "pass " + what + " as \"x y z\"");
			return false;
		}
		if (ctx.m_HasBounds)
		{
			if (parsed[0] < ctx.m_BoundsMin[0] || parsed[0] > ctx.m_BoundsMax[0] || parsed[2] < ctx.m_BoundsMin[2] || parsed[2] > ctx.m_BoundsMax[2])
			{
				Answer(resp, "error", INVALID_ARGUMENT, what + " " + EMCP_WB_Common.VectorToString(parsed) + " is outside the terrain bounds " + EMCP_WB_Common.VectorToString(ctx.m_BoundsMin) + " to " + EMCP_WB_Common.VectorToString(ctx.m_BoundsMax), "pass a position inside the terrain (status answers the bounds)");
				return false;
			}
		}
		at = parsed;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A box side check: every side of lo..hi at most BOX_MAX. False with BOX_TOO_LARGE written.
	protected static bool BoxFits(vector lo, vector hi, string what, EMCP_WB_NavmeshResponse resp)
	{
		for (int k = 0; k < 3; k++)
		{
			float side = hi[k] - lo[k];
			if (side > BOX_MAX)
			{
				Refuse(resp, BOX_TOO_LARGE, what + " is " + side.ToString() + " m on axis " + k.ToString() + ", above " + BOX_MAX.ToString() + " m per side; nothing was requested", "rebuild a smaller box, or several");
				return false;
			}
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Grid points from lo to hi in steps of gridStep (lo included), at most GRID_MAX + 1.
	static int AxisPoints(float lo, float hi, float gridStep)
	{
		int points = 0;
		float at = lo;
		while (at <= hi && points <= GRID_MAX)
		{
			points++;
			at = at + gridStep;
		}
		return points;
	}

	//------------------------------------------------------------------------------------------------
	//! The grid step: the given text, or STEP_DEFAULT grown by STEP_GROWTH until the grid fits
	//! GRID_MAX. A given step whose grid is above GRID_MAX is refused. False with INVALID_ARGUMENT.
	protected static bool ChooseGridStep(EMCP_WB_NavmeshContext ctx, string text, out float gridStep, EMCP_WB_NavmeshResponse resp)
	{
		gridStep = STEP_DEFAULT;
		float spanX = ctx.m_BoundsMax[0] - ctx.m_BoundsMin[0];
		float spanZ = ctx.m_BoundsMax[2] - ctx.m_BoundsMin[2];
		if (text != "")
		{
			float given = 0;
			if (!EMCP_WB_Common.ParseFloat(text, given) || given < STEP_MIN)
			{
				Answer(resp, "error", INVALID_ARGUMENT, "step must be a number of metres of at least " + STEP_MIN.ToString() + ", got '" + text + "'", "omit step for the default");
				return false;
			}
			int givenX = AxisPoints(0, spanX, given);
			int givenZ = AxisPoints(0, spanZ, given);
			if (givenX > GRID_MAX || givenZ > GRID_MAX || givenX * givenZ > GRID_MAX)
			{
				float span = spanX;
				if (spanZ > span)
					span = spanZ;
				float least = Math.Ceil(span / 199);
				Answer(resp, "error", INVALID_ARGUMENT, "step " + given.ToString() + " gives a grid above " + GRID_MAX.ToString() + " points", "pass a step of at least " + least.ToString() + " m, or omit step");
				return false;
			}
			gridStep = given;
			return true;
		}

		float grown = STEP_DEFAULT;
		for (int tries = 0; tries < 64; tries++)
		{
			int grownX = AxisPoints(0, spanX, grown);
			int grownZ = AxisPoints(0, spanZ, grown);
			if (grownX <= GRID_MAX && grownZ <= GRID_MAX && grownX * grownZ <= GRID_MAX)
				break;
			grown = grown * STEP_GROWTH;
		}
		gridStep = grown;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Parses "<start>:<count>" (both decimal, start <= count). False on anything else.
	static bool ParseCursor(string cursorText, out int start, out int issued)
	{
		start = 0;
		issued = 0;
		int colon = cursorText.IndexOf(":");
		if (colon <= 0 || colon >= cursorText.Length() - 1)
			return false;
		string startText = cursorText.Substring(0, colon);
		string countText = cursorText.Substring(colon + 1, cursorText.Length() - colon - 1);
		int startValue = 0;
		int countValue = 0;
		if (!IsDigits(startText) || !IsDigits(countText))
			return false;
		startValue = startText.ToInt();
		countValue = countText.ToInt();
		if (startValue > countValue)
			return false;
		start = startValue;
		issued = countValue;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! 1 to 9 decimal digits.
	static bool IsDigits(string text)
	{
		int len = text.Length();
		if (len < 1 || len > 9)
			return false;
		for (int d = 0; d < len; d++)
		{
			if (!text.IsDigitAt(d))
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! status: the AIWorld, its projects, the terrain bounds and one page of the tile-state grid.
	//! Without a declared project, or without terrain bounds, it answers ok with no grid.
	protected static void Status(EMCP_WB_NavmeshRequest req, EMCP_WB_NavmeshResponse resp)
	{
		EMCP_WB_NavmeshContext ctx = new EMCP_WB_NavmeshContext();
		if (!OpenWorld(ctx, resp))
			return;
		if (!FindAIWorld(ctx, resp))
			return;

		resp.aiWorld = EMCP_WB_EntityRef.Format(ctx.m_AISource);
		resp.aiWorldClass = ctx.m_AIWorld.ClassName();
		resp.aiWorldFrom = ctx.m_From;
		for (int p = 0; p < ctx.m_Projects.Count(); p++)
			resp.projects.Insert(ctx.m_Projects.Get(p));
		if (ctx.m_HasBounds)
		{
			resp.boundsMin = EMCP_WB_Common.VectorToString(ctx.m_BoundsMin);
			resp.boundsMax = EMCP_WB_Common.VectorToString(ctx.m_BoundsMax);
		}

		if (req.project == "" && ctx.m_Projects.Count() == 0)
		{
			resp.component = false;
			Answer(resp, "ok", "", "AIWorld " + resp.aiWorldClass + " (" + ctx.m_From + ") declares no navmesh project; no tile grid", "");
			return;
		}
		if (!ChooseComponent(ctx, req.project, resp))
			return;
		resp.project = ctx.m_Project;
		resp.component = true;

		if (!ctx.m_HasBounds)
		{
			Answer(resp, "ok", "", "AIWorld " + resp.aiWorldClass + ", project " + ctx.m_Project + "; GetTerrainBounds gave no bounds, so no tile grid (use tile at a position)", "");
			return;
		}

		float gridStep = STEP_DEFAULT;
		if (!ChooseGridStep(ctx, req.step, gridStep, resp))
			return;
		resp.step = gridStep.ToString();
		float lowX = ctx.m_BoundsMin[0];
		float lowZ = ctx.m_BoundsMin[2];
		float midY = (ctx.m_BoundsMin[1] + ctx.m_BoundsMax[1]) * 0.5;
		int columns = AxisPoints(lowX, ctx.m_BoundsMax[0], gridStep);
		int lines = AxisPoints(lowZ, ctx.m_BoundsMax[2], gridStep);
		int totalPoints = columns * lines;

		int start = 0;
		if (req.cursor != "")
		{
			int issuedFor = 0;
			if (!ParseCursor(req.cursor, start, issuedFor))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "cursor must be <start>:<count> as nextCursor answered, got '" + req.cursor + "'", "omit cursor for the first page");
				return;
			}
			if (issuedFor != totalPoints)
			{
				Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " grid points, the grid now has " + totalPoints.ToString(), "read again without a cursor");
				return;
			}
		}
		int pageSize = req.limit;
		if (pageSize <= 0)
			pageSize = PAGE_DEFAULT;
		if (pageSize > PAGE_MAX)
			pageSize = PAGE_MAX;
		int end = start + pageSize;
		if (end > totalPoints)
			end = totalPoints;

		NavmeshWorldComponent navmesh = ctx.m_Component;
		for (int i = start; i < end; i++)
		{
			int ix = i % columns;
			int iz = i / columns;
			vector point = vector.Zero;
			point[0] = lowX + ix * gridStep;
			point[1] = midY;
			point[2] = lowZ + iz * gridStep;
			string row = point[0].ToString() + "|" + point[2].ToString();
			row = row + "|" + Flag(navmesh.IsTileLoaded(point)) + "|" + Flag(navmesh.IsTileValid(point)) + "|" + Flag(navmesh.IsTileRequested(point));
			resp.rows.Insert(row);
		}
		resp.total = totalPoints;
		resp.count = end - start;
		if (end < totalPoints)
			resp.nextCursor = end.ToString() + ":" + totalPoints.ToString();
		Answer(resp, "ok", "", "project " + ctx.m_Project + ", step " + resp.step + " m: " + resp.count.ToString() + " of " + totalPoints.ToString() + " grid points", "");
	}

	//------------------------------------------------------------------------------------------------
	//! tile: IsTileLoaded, IsTileValid, IsTileRequested at one position.
	protected static void Tile(EMCP_WB_NavmeshRequest req, EMCP_WB_NavmeshResponse resp)
	{
		EMCP_WB_NavmeshContext ctx = new EMCP_WB_NavmeshContext();
		if (!OpenWorld(ctx, resp))
			return;
		vector at = vector.Zero;
		if (!ReadPosition(ctx, req.position, "position", at, resp))
			return;
		if (!FindAIWorld(ctx, resp))
			return;
		if (!ChooseComponent(ctx, req.project, resp))
			return;

		resp.position = EMCP_WB_Common.VectorToString(at);
		resp.loaded = ctx.m_Component.IsTileLoaded(at);
		resp.valid = ctx.m_Component.IsTileValid(at);
		resp.requested = ctx.m_Component.IsTileRequested(at);
		Answer(resp, "ok", "", "project " + ctx.m_Project + " at " + resp.position + ": loaded " + Flag(resp.loaded) + ", valid " + Flag(resp.valid) + ", requested " + Flag(resp.requested), "");
	}

	//------------------------------------------------------------------------------------------------
	//! load: LoadTileIn at one position (in memory; the engine may take many frames), then
	//! IsTileLoaded. requested is what LoadTileIn answered.
	protected static void Load(EMCP_WB_NavmeshRequest req, EMCP_WB_NavmeshResponse resp)
	{
		EMCP_WB_NavmeshContext ctx = new EMCP_WB_NavmeshContext();
		if (!OpenWorld(ctx, resp))
			return;
		vector at = vector.Zero;
		if (!ReadPosition(ctx, req.position, "position", at, resp))
			return;
		if (!FindAIWorld(ctx, resp))
			return;
		if (!ChooseComponent(ctx, req.project, resp))
			return;

		resp.position = EMCP_WB_Common.VectorToString(at);
		resp.requested = ctx.m_Component.LoadTileIn(at);
		resp.loaded = ctx.m_Component.IsTileLoaded(at);
		string text = "LoadTileIn answered " + Flag(resp.requested) + "; loaded now " + Flag(resp.loaded);
		if (!resp.requested)
			text = text + " (false: the tile cannot be loaded, or the navmesh does not stream)";
		else if (!resp.loaded)
			text = text + " (a load can take many frames: read tile again)";
		Answer(resp, "ok", "", text, "");
	}

	//------------------------------------------------------------------------------------------------
	//! reachable: GetReachablePoint/3. Its vector parameter has no out marker (P-W5-14), so the
	//! point starts offset from the origin and is answered only when the engine changed it.
	protected static void Reachable(EMCP_WB_NavmeshRequest req, EMCP_WB_NavmeshResponse resp)
	{
		EMCP_WB_NavmeshContext ctx = new EMCP_WB_NavmeshContext();
		if (!OpenWorld(ctx, resp))
			return;
		vector origin = vector.Zero;
		if (!ReadPosition(ctx, req.position, "position", origin, resp))
			return;
		float reach = 0;
		if (!EMCP_WB_Common.ParseFloat(req.distance, reach) || reach <= 0 || reach > REACH_MAX)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "distance must be a number of metres above 0 and at most " + REACH_MAX.ToString() + ", got '" + req.distance + "'", "pass distance as text, for example \"50\"");
			return;
		}
		if (!FindAIWorld(ctx, resp))
			return;
		if (!ChooseComponent(ctx, req.project, resp))
			return;

		resp.position = EMCP_WB_Common.VectorToString(origin);
		vector unwritten = origin;
		unwritten[1] = origin[1] + UNWRITTEN_OFFSET;
		vector reached = unwritten;
		resp.found = ctx.m_Component.GetReachablePoint(origin, reach, reached);
		bool written = !SameVector(reached, unwritten);
		if (resp.found && written)
			resp.point = EMCP_WB_Common.VectorToString(reached);
		string text = "GetReachablePoint answered " + Flag(resp.found);
		if (resp.found && written)
			text = text + "; point " + resp.point;
		else if (resp.found)
			text = text + "; the point was not written back (no out marker on the vector, P-W5-14), so only found is answered";
		else
			text = text + ": the origin is not close enough to the navmesh";
		Answer(resp, "ok", "", text, "");
	}

	//------------------------------------------------------------------------------------------------
	//! rebuild: AIWorld.RequestNavmeshRebuild/2 of a box, in memory. Guard project+world, a box of
	//! at most BOX_MAX per side, a dry run unless confirm. The call returns void (P-W5-15): requested
	//! says it was made, not that the navmesh changed; nothing is saved.
	protected static void Rebuild(EMCP_WB_NavmeshRequest req, EMCP_WB_NavmeshResponse resp)
	{
		EMCP_WB_NavmeshContext ctx = new EMCP_WB_NavmeshContext();
		if (!ProjectWorld(ctx, resp))
			return;

		vector lo = vector.Zero;
		vector hi = vector.Zero;
		string error = "";
		if (!EMCP_WB_Common.ParseVectorString(req.min, lo, error))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "min: " + error, "pass min as \"x y z\"");
			return;
		}
		if (!EMCP_WB_Common.ParseVectorString(req.max, hi, error))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "max: " + error, "pass max as \"x y z\"");
			return;
		}
		if (hi[0] <= lo[0] || hi[1] < lo[1] || hi[2] <= lo[2])
		{
			Answer(resp, "error", INVALID_ARGUMENT, "max must be above min on x and z and not below it on y", "pass the box's low corner as min and its high corner as max");
			return;
		}
		resp.min = EMCP_WB_Common.VectorToString(lo);
		resp.max = EMCP_WB_Common.VectorToString(hi);
		if (!BoxFits(lo, hi, "the box", resp))
			return;
		if (!FindAIWorld(ctx, resp))
			return;

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.requested = false;
			Answer(resp, "ok", "", "dry run: would request a navmesh rebuild of " + resp.min + " to " + resp.max + " from the AIWorld (in memory, nothing saved); pass confirm true to request it", "");
			return;
		}

		ctx.m_AIWorld.RequestNavmeshRebuild(lo, hi);
		resp.dryRun = false;
		resp.requested = true;
		Answer(resp, "ok", "", "requested a navmesh rebuild of " + resp.min + " to " + resp.max + "; the call returns nothing, so the change is not confirmed (P-W5-15); in memory only, nothing saved (save with the World Editor Navmesh Tool)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! rebuildEntity: the SCR_AIWorld's rebuild areas of an entity and its children
	//! (GetNavmeshRebuildAreas/3), each at most BOX_MAX per side, then RequestNavmeshRebuildEntity/1
	//! when confirm is true. Guard project+world. In memory only, nothing saved.
	protected static void RebuildEntity(EMCP_WB_NavmeshRequest req, EMCP_WB_NavmeshResponse resp)
	{
		EMCP_WB_NavmeshContext ctx = new EMCP_WB_NavmeshContext();
		if (!ProjectWorld(ctx, resp))
			return;

		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(ctx.m_Api, req.entity, resolved))
		{
			Answer(resp, "error", resolved.m_Code, resolved.m_Why, "list the entities (wb_entity list) and pass the id: it answers");
			return;
		}
		IEntitySource target = resolved.m_Src;
		if (!target)
		{
			Refuse(resp, ENTITY_NOT_FOUND, "the entity reference resolved to no entity source", "list the entities (wb_entity list)");
			return;
		}
		resp.entity = EMCP_WB_EntityRef.Format(target);
		if (resp.entity == "")
			resp.entity = req.entity;
		IEntity live = ctx.m_Api.SourceToEntity(target);
		if (!live)
		{
			Refuse(resp, ENTITY_NOT_FOUND, "the entity has no runtime entity in the edited world (SourceToEntity returned null)", "pick an entity placed in the world");
			return;
		}

		if (!FindAIWorld(ctx, resp))
			return;
		SCR_AIWorld scriptedWorld = SCR_AIWorld.Cast(ctx.m_AIWorld);
		if (!scriptedWorld)
		{
			Refuse(resp, NOT_SCR_AI_WORLD, "the AIWorld is a " + ctx.m_AIWorld.ClassName() + ", not an SCR_AIWorld; its rebuild areas cannot be read", "use rebuild with a box around the entity");
			return;
		}

		array<ref Tuple2<vector, vector>> boxes = {};
		array<bool> redoRoads = {};
		scriptedWorld.GetNavmeshRebuildAreas(live, boxes, redoRoads);
		resp.areas = boxes.Count();
		for (int b = 0; b < boxes.Count(); b++)
		{
			Tuple2<vector, vector> box = boxes.Get(b);
			if (!box)
				continue;
			if (!BoxFits(box.param1, box.param2, "rebuild area " + b.ToString(), resp))
				return;
		}
		if (resp.areas == 0)
		{
			resp.dryRun = !req.confirm;
			resp.requested = false;
			Answer(resp, "ok", "", "the entity gives no navmesh rebuild areas; nothing to request", "");
			return;
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.requested = false;
			Answer(resp, "ok", "", "dry run: would request a navmesh rebuild of " + resp.areas.ToString() + " area(s) around " + resp.entity + " (in memory, nothing saved); pass confirm true to request it", "");
			return;
		}

		scriptedWorld.RequestNavmeshRebuildEntity(live);
		resp.dryRun = false;
		resp.requested = true;
		Answer(resp, "ok", "", "requested a navmesh rebuild of " + resp.areas.ToString() + " area(s) around " + resp.entity + "; the call returns nothing, so the change is not confirmed (P-W5-15); in memory only, nothing saved", "");
	}
}
