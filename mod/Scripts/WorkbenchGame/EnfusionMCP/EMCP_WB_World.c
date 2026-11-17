/**
 * EMCP_WB_World.c - World handler of wb_world (wave W1, phase5-w1-spec.md section 2.6)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_World", dispatching on "action":
 *   state             mode flags, edit state, active tool, world path and sub-scenes (pure read)
 *   browserSelection  WorldEditor.GetResourceBrowserSelection (the call SCR_WorldEditorToolHelper
 *                     .GetSelectedResources makes, an array's Insert as the callback)
 *   register          ResourceManager.GetMetaFile, then RegisterResourceFile(abs, false) when no
 *                     .meta exists (the probe's RegisterWorld order); project+target(existing),
 *                     dry run unless confirm
 *   play / stop       WorldEditor.SwitchToGameMode / SwitchToEditMode, then IsGameMode read once:
 *                     the switch may land after this call returns, so the tool polls state
 *   playEvents        the EMCP_WB_PlayRecorder ring buffer after a seq
 *   comments          GetEditorEntity scan for CommentEntity sources, paged, and GetCommentCategories
 *   addComment        CreateEntity of CommentEntity + SetVariableValue on m_Comment, m_Color, m_Size
 *   annotate          a visible note on an entity: a CommentEntity EMCP_Note_<entity> above it, made,
 *                     moved and deleted as an entity (AddCommentEntity draws nothing: W1.7 run 6)
 *
 * OD-4 (DEC-061): new, duplicate, saveAs and setWorldEntity are TypeScript offline writers; this
 * handler only registers what they write. In-memory edits refuse WRONG_MODE in play mode and run
 * inside BeginEntityAction / EndEntityAction with an undo name. A refusal answers status refused,
 * code, next and a message "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage).
 * Keys: contracts/EMCP_WB_World.json.
 */

class EMCP_WB_WorldRequest : JsonApiStruct
{
	string action;
	// browserSelection: also the files of a selected folder
	bool recursive;
	// register: project-relative file
	string path;
	// register: true writes; else a dry run
	bool confirm;
	// play
	bool debugMode;
	bool fullScreen;
	// playEvents: seq after which events are answered
	int after;
	// comments: "<start>:<count>" and page size
	string cursor;
	int limit;
	// addComment, annotate
	string text;
	string coords;
	string color;
	//! addComment, annotate add: text height in metres, as text (a JSON integer never reaches a
	//! float field through RegV: W1 live run 2026-11-11); "" when not given
	string size;
	string layer;
	// annotate: entity reference and add, move or remove
	string entity;
	string mode;
	string category;

	void EMCP_WB_WorldRequest()
	{
		RegV("action");
		RegV("recursive");
		RegV("path");
		RegV("confirm");
		RegV("debugMode");
		RegV("fullScreen");
		RegV("after");
		RegV("cursor");
		RegV("limit");
		RegV("text");
		RegV("coords");
		RegV("color");
		RegV("size");
		RegV("layer");
		RegV("entity");
		RegV("mode");
		RegV("category");

		recursive = false;
		confirm = false;
		after = 0;
		limit = 0;
	}
}

class EMCP_WB_WorldResponse : JsonApiStruct
{
	// ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	// state
	string worldPath;
	string worldName;
	string mode;
	bool editAction;
	bool restoring;
	bool modifying;
	bool creatingInWindow;
	bool generatorEvents;
	string toolName;
	int subScenes;
	int currentSubScene;
	int entityCount;
	// browserSelection, playEvents, comments
	ref array<string> rows;
	// register
	string resourceName;
	bool dryRun;
	bool alreadyRegistered;
	// play, stop, playEvents
	int eventSeq;
	// comments
	ref array<string> categories;
	int total;
	string nextCursor;
	// addComment, annotate
	string id;
	string undoName;
	// annotate add: what was applied (the text height in metres, where the note is, its colour as
	// "r g b a", and the framing distance the default height was scaled for; 0 when size was given)
	float noteSize;
	string noteCoords;
	string noteColor;
	float noteDistance;

	void EMCP_WB_WorldResponse()
	{
		rows = {};
		categories = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("worldPath");
		RegV("worldName");
		RegV("mode");
		RegV("editAction");
		RegV("restoring");
		RegV("modifying");
		RegV("creatingInWindow");
		RegV("generatorEvents");
		RegV("toolName");
		RegV("subScenes");
		RegV("currentSubScene");
		RegV("entityCount");
		RegV("rows");
		RegV("resourceName");
		RegV("dryRun");
		RegV("alreadyRegistered");
		RegV("eventSeq");
		RegV("categories");
		RegV("total");
		RegV("nextCursor");
		RegV("id");
		RegV("undoName");
		RegV("noteSize");
		RegV("noteCoords");
		RegV("noteColor");
		RegV("noteDistance");
	}
}

class EMCP_WB_WorldUtil
{
	//! Paging of comments (phase5-w1-spec.md section 1).
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! Resources browserSelection answers at most.
	static const int SELECTION_MAX = 2000;
	static const string COMMENT_CLASS = "CommentEntity";
	static const string UNDO_PREFIX = "EMCP wb_world ";
	static const string NEXT_PROJECT = "install the handlers in the project you have open";
	static const string NEXT_WORLD_EDITOR = "open the World Editor with a world (wb_module setResource)";

	//------------------------------------------------------------------------------------------------
	//! Sets a refusal: status refused, code, next and the message "CODE: text | next: step".
	static void Refuse(EMCP_WB_WorldResponse resp, string code, string text, string nextStep)
	{
		resp.status = EMCP_WB_Guard.REFUSED;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! An engine call that returned false: status error, code ENGINE_FALSE.
	static void EngineFalse(EMCP_WB_WorldResponse resp, string text, string nextStep)
	{
		resp.status = "error";
		resp.code = "ENGINE_FALSE";
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage("ENGINE_FALSE", EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, so EndEntityAction never closes an action this handler did
	//! not begin (review W2).
	static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_WorldResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		resp.undoName = "";
		Refuse(resp, "ENGINE_FALSE", "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused NOT_IN_PROJECT) when the project is not found (DEC-058).
	static bool ProjectRefused(EMCP_WB_WorldResponse resp)
	{
		string addonId = "";
		string projectDir = "";
		string why = "";
		if (EMCP_WB_Guard.Project(addonId, projectDir, why))
			return false;
		Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why, NEXT_PROJECT);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor's API, or null with the response refused (MODULE_NOT_OPEN or NO_WORLD).
	//! GetModule opens a closed World Editor (DEC-053).
	static WorldEditorAPI Api(EMCP_WB_WorldResponse resp)
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
			Refuse(resp, "NO_WORLD", "the World Editor has no API: no world is open", NEXT_WORLD_EDITOR);
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, "NO_WORLD", noWorld, NEXT_WORLD_EDITOR);
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused WRONG_MODE) when the World Editor is in play mode.
	static bool PlayRefused(WorldEditorAPI api, EMCP_WB_WorldResponse resp)
	{
		if (!api.IsGameMode())
			return false;
		Refuse(resp, "WRONG_MODE", "the World Editor is in play mode; in-memory edits run in edit mode only", "wb_world stop");
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! edit, play, prefab or unknown, from the API's mode flags.
	static string ModeOf(WorldEditorAPI api)
	{
		if (!api)
			return "unknown";
		if (api.IsGameMode())
			return "play";
		if (api.IsPrefabEditMode())
			return "prefab";
		if (api.IsEditMode())
			return "edit";
		return "unknown";
	}

	//------------------------------------------------------------------------------------------------
	//! Parses "<start>:<count>". False with a why on any other form.
	static bool ParseCursor(string raw, out int start, out int count, out string why)
	{
		start = 0;
		count = 0;
		why = "";
		array<string> parts = {};
		raw.Split(":", parts, false);
		if (parts.Count() != 2)
		{
			why = "cursor must be <start>:<count>, got '" + raw + "'";
			return false;
		}
		if (!EMCP_WB_Common.ParseInt(parts.Get(0), start) || !EMCP_WB_Common.ParseInt(parts.Get(1), count) || start < 0 || count < 0 || start > count)
		{
			start = 0;
			count = 0;
			why = "cursor must be two non-negative integers <start>:<count> with start <= count, got '" + raw + "'";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Parses "r g b" or "r g b a" (0..1 each); a missing alpha is 1.
	static bool ParseColor(string raw, out float r, out float g, out float b, out float a, out string why)
	{
		r = 1;
		g = 1;
		b = 1;
		a = 1;
		why = "";
		string s = raw;
		s.Replace(",", " ");
		array<string> parts = {};
		s.Split(" ", parts, true);
		int n = parts.Count();
		if (n != 3 && n != 4)
		{
			why = "color takes 'r g b' or 'r g b a', got '" + raw + "'";
			return false;
		}
		array<float> values = {};
		for (int i = 0; i < n; i++)
		{
			float f = 0;
			if (!EMCP_WB_Common.ParseFloat(parts.Get(i), f) || f < 0 || f > 1)
			{
				why = "color component " + i.ToString() + " ('" + parts.Get(i) + "') is not a number in 0..1";
				return false;
			}
			values.Insert(f);
		}
		r = values.Get(0);
		g = values.Get(1);
		b = values.Get(2);
		if (n == 4)
			a = values.Get(3);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! One comments row: id|color|size|text (the text last, so it may hold any character).
	static string CommentRow(IEntitySource src)
	{
		string text = "";
		src.Get("m_Comment", text);
		vector colorValue = vector.Zero;
		src.Get("m_Color", colorValue);
		float sizeValue = 0;
		src.Get("m_Size", sizeValue);
		string row = EMCP_WB_EntityRef.Format(src) + "|" + EMCP_WB_Common.VectorToString(colorValue) + "|" + sizeValue.ToString() + "|" + text;
		return EMCP_WB_Guard.ScrubHome(row);
	}

	//------------------------------------------------------------------------------------------------
	//! annotate. CommentEntity (1.9 scripts/Game/Entities/Editor/CommentEntity.c) draws m_Comment with
	//! DebugTextWorldSpace.CreateInWorld at its origin, m_Size metres high (its default 0.2), each
	//! character about 0.7 x m_Size wide (DrawComment's textWidthScale), and skips the text when
	//! m_Size / distance < 0.005. W1.7 run 7: a fixed 0.5 m over a 0.15 m glass framed from 1.5 m
	//! drew "W1 hand note" so large that only "hand no" fitted across the viewport. So the default
	//! height scales with the distance wb_view focus frames the entity from (FramingDistance of the
	//! bounding radius): NOTE_PER_METRE of it, narrowed so the longest line spans at most
	//! NOTE_WIDTH_PER_METRE of it, and never below NOTE_MIN_PER_METRE (the draw cut-off).
	static const string NOTE_PREFIX = "EMCP_Note_";
	static const float NOTE_PER_METRE = 0.04;
	static const float NOTE_WIDTH_PER_METRE = 0.9;
	static const float NOTE_MIN_PER_METRE = 0.01;
	static const float NOTE_CHAR_WIDTH = 0.7;
	//! annotate: the largest text height a request may ask for, metres.
	static const float NOTE_SIZE_MAX = 100;

	//------------------------------------------------------------------------------------------------
	//! The name of an entity's note: EMCP_Note_ and the entity's name, or its id when it has none.
	static string NoteNameOf(IEntitySource src)
	{
		string stem = src.GetName();
		if (stem == "")
			stem = EMCP_WB_EntityRef.Format(src);
		stem.Replace(":", "_");
		stem.Replace(" ", "_");
		return NOTE_PREFIX + stem;
	}

	//------------------------------------------------------------------------------------------------
	//! Half the diagonal of the entity's world bounds, 0 when it has none (as wb_view focus reads it).
	static float BoundsRadius(IEntity ent)
	{
		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		ent.GetWorldBounds(boundsMin, boundsMax);
		if (boundsMax[0] < boundsMin[0] || boundsMax[1] < boundsMin[1] || boundsMax[2] < boundsMin[2])
			return 0;
		vector extent = boundsMax - boundsMin;
		return extent.Length() * 0.5;
	}

	//------------------------------------------------------------------------------------------------
	//! The length of the longest line of a text, at least 1.
	static int LongestLine(string text)
	{
		array<string> lines = {};
		text.Split("\n", lines, false);
		int longest = 1;
		foreach (string line : lines)
		{
			if (line.Length() > longest)
				longest = line.Length();
		}
		return longest;
	}

	//------------------------------------------------------------------------------------------------
	//! The default text height of a note on an entity framed from distance (see NOTE_PER_METRE).
	static float NoteSize(float distance, string text)
	{
		float size = distance * NOTE_PER_METRE;
		float widest = distance * NOTE_WIDTH_PER_METRE / (NOTE_CHAR_WIDTH * LongestLine(text));
		if (size > widest)
			size = widest;
		float smallest = distance * NOTE_MIN_PER_METRE;
		if (size < smallest)
			size = smallest;
		return size;
	}

	//------------------------------------------------------------------------------------------------
	//! Where a new note goes: one text height above the top of the entity's world bounds (its origin
	//! when it has none), so the text (drawn centred on the note's origin) sits just above it.
	static vector NoteSpot(IEntity ent, float size)
	{
		vector origin = ent.GetOrigin();
		vector boundsMin = vector.Zero;
		vector boundsMax = vector.Zero;
		ent.GetWorldBounds(boundsMin, boundsMax);
		float top = origin[1];
		if (boundsMax[1] >= boundsMin[1] && boundsMax[1] > top)
			top = boundsMax[1];
		return Vector(origin[0], top + size, origin[2]);
	}
}

class EMCP_WB_World : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_WorldRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_WorldRequest req = EMCP_WB_WorldRequest.Cast(request);
		EMCP_WB_WorldResponse resp = new EMCP_WB_WorldResponse();
		if (!req)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "state")
			State(req, resp);
		else if (req.action == "browserSelection")
			BrowserSelection(req, resp);
		else if (req.action == "register")
			Register(req, resp);
		else if (req.action == "play")
			Play(req, resp);
		else if (req.action == "stop")
			Stop(req, resp);
		else if (req.action == "playEvents")
			PlayEvents(req, resp);
		else if (req.action == "comments")
			Comments(req, resp);
		else if (req.action == "addComment")
			AddComment(req, resp);
		else if (req.action == "annotate")
			Annotate(req, resp);
		else
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "unknown action '" + req.action + "'", "one of state, browserSelection, register, play, stop, playEvents, comments, addComment, annotate (new, duplicate, saveAs and setWorldEntity run in the tool)");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! state: the mode flags and edit state of WorldEditorAPI (P-W1-16), the world path and name,
	//! the sub-scenes and the editor entity count. Nothing is changed.
	//! With no world loaded (after a failed load the API exists without one: W1.7 run of 2026-11-11,
	//! GetNumSubScenes crashed Workbench here) it answers NO_WORLD with what it can still read: the
	//! world path, the mode and the edit flags; the sub-scene and entity reads are not made.
	static void State(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "NO_WORLD", "the World Editor has no API: no world is open", EMCP_WB_WorldUtil.NEXT_WORLD_EDITOR);
			return;
		}

		string worldPath = "";
		api.GetWorldPath(worldPath);
		resp.worldPath = EMCP_WB_Guard.ScrubHome(worldPath);
		resp.worldName = FilePath.StripExtension(FilePath.StripPath(worldPath));
		resp.mode = EMCP_WB_WorldUtil.ModeOf(api);
		resp.editAction = api.IsDoingEditAction();
		resp.restoring = api.UndoOrRedoIsRestoring();
		resp.modifying = api.IsModifyingData();
		resp.creatingInWindow = api.IsCreatingEntityInWindow();
		resp.generatorEvents = api.AreGeneratorEventsEnabled();
		resp.toolName = api.GetCurrentToolName();
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			EMCP_WB_WorldUtil.Refuse(resp, "NO_WORLD", noWorld, EMCP_WB_WorldUtil.NEXT_WORLD_EDITOR);
			return;
		}
		resp.subScenes = api.GetNumSubScenes();
		resp.currentSubScene = api.GetCurrentSubScene();
		resp.entityCount = api.GetEditorEntityCount();
		resp.status = "ok";
		resp.message = "mode " + resp.mode + ", " + resp.entityCount.ToString() + " editor entities";
	}

	//------------------------------------------------------------------------------------------------
	//! browserSelection: the resources selected in the World Editor's Resource Browser panel
	//! (P-W1-24), an array's Insert as the callback as SCR_WorldEditorToolHelper does.
	static void BrowserSelection(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return;
		}

		array<ResourceName> picked = {};
		bool recursive = req.recursive;
		worldEditor.GetResourceBrowserSelection(picked.Insert, recursive);
		int count = picked.Count();
		for (int i = 0; i < count && i < EMCP_WB_WorldUtil.SELECTION_MAX; i++)
		{
			string shown = picked.Get(i);
			resp.rows.Insert(EMCP_WB_Guard.ScrubHome(shown));
		}
		resp.status = "ok";
		resp.message = count.ToString() + " resources selected";
		if (count > EMCP_WB_WorldUtil.SELECTION_MAX)
			resp.message = resp.message + "; the first " + EMCP_WB_WorldUtil.SELECTION_MAX.ToString() + " answered";
	}

	//------------------------------------------------------------------------------------------------
	//! register: a file of the project written offline (OD-4) gets its .meta. GetMetaFile first;
	//! RegisterResourceFile(abs, false) only when none exists, then GetMetaFile again (the probe's
	//! RegisterWorld). The target must be an existing file inside the project; dry run unless confirm.
	static void Register(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		if (EMCP_WB_WorldUtil.ProjectRefused(resp))
			return;

		string absolute = "";
		string why = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(req.path, absolute, why))
		{
			EMCP_WB_WorldUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why, "write the file into the project first, then register it");
			return;
		}
		string lowerPath = req.path;
		lowerPath.ToLower();
		if (lowerPath.EndsWith(".meta"))
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "a .meta file is not registered; name the resource it belongs to", "pass the resource's path, not its .meta");
			return;
		}

		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "MODULE_NOT_OPEN", "the Resource Manager is not open: GetModule returned null", "wb_module open ResourceManager");
			return;
		}

		// Every meta read ends with Release(false); none is held across calls (W2 spec section 1,
		// review round 1, F7).
		MetaFile meta = resourceManager.GetMetaFile(absolute);
		if (meta)
		{
			resp.alreadyRegistered = true;
			resp.resourceName = meta.GetResourceID();
			meta.Release(false);
			resp.dryRun = !req.confirm;
			resp.status = "ok";
			resp.message = "already registered; nothing was written";
			return;
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would register the file (no .meta yet); nothing was written; pass confirm true to register";
			return;
		}

		bool registered = resourceManager.RegisterResourceFile(absolute, false);
		meta = resourceManager.GetMetaFile(absolute);
		resp.dryRun = false;
		bool metaFound = meta != null;
		if (!registered || !metaFound)
		{
			if (meta)
				meta.Release(false);
			EMCP_WB_WorldUtil.EngineFalse(resp, "RegisterResourceFile returned " + registered.ToString() + "; .meta found " + metaFound.ToString(), "read the Workbench log; check the file's format");
			return;
		}
		resp.resourceName = meta.GetResourceID();
		meta.Release(false);
		resp.status = "ok";
		resp.message = "registered";
	}

	//------------------------------------------------------------------------------------------------
	//! play: SwitchToGameMode(debugMode, fullScreen) (EMCP_WB_EditorControl's call), then the mode read
	//! once. The switch may land after this call returns: the tool polls state (P-W1-17).
	static void Play(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		if (EMCP_WB_WorldUtil.ProjectRefused(resp))
			return;
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "NO_WORLD", "the World Editor has no API: no world is open", EMCP_WB_WorldUtil.NEXT_WORLD_EDITOR);
			return;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			EMCP_WB_WorldUtil.Refuse(resp, "NO_WORLD", noWorld, EMCP_WB_WorldUtil.NEXT_WORLD_EDITOR);
			return;
		}
		if (api.IsGameMode())
		{
			EMCP_WB_WorldUtil.Refuse(resp, "WRONG_MODE", "the World Editor is already in play mode", "wb_world stop");
			return;
		}

		bool debugMode = req.debugMode;
		bool fullScreen = req.fullScreen;
		worldEditor.SwitchToGameMode(debugMode, fullScreen);
		resp.mode = EMCP_WB_WorldUtil.ModeOf(api);
		resp.eventSeq = EMCP_WB_PlayRecorder.LastSeq();
		resp.status = "ok";
		resp.message = "SwitchToGameMode called; mode read back " + resp.mode + " (the switch may land later: poll state)";
	}

	//------------------------------------------------------------------------------------------------
	//! stop: SwitchToEditMode (EMCP_WB_EditorControl's call), then the mode read once.
	static void Stop(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		if (EMCP_WB_WorldUtil.ProjectRefused(resp))
			return;
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "NO_WORLD", "the World Editor has no API: no world is open", EMCP_WB_WorldUtil.NEXT_WORLD_EDITOR);
			return;
		}
		if (!api.IsGameMode())
		{
			EMCP_WB_WorldUtil.Refuse(resp, "WRONG_MODE", "the World Editor is not in play mode", "wb_world state");
			return;
		}

		worldEditor.SwitchToEditMode();
		resp.mode = EMCP_WB_WorldUtil.ModeOf(api);
		resp.eventSeq = EMCP_WB_PlayRecorder.LastSeq();
		resp.status = "ok";
		resp.message = "SwitchToEditMode called; mode read back " + resp.mode + " (the switch may land later: poll state)";
	}

	//------------------------------------------------------------------------------------------------
	//! playEvents: the recorder's events with a seq above after (EMCP_WB_PlayRecorder, OD-7).
	static void PlayEvents(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		int afterSeq = req.after;
		if (afterSeq < 0)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "after must be 0 or more", "pass the eventSeq of the previous answer");
			return;
		}
		int answered = EMCP_WB_PlayRecorder.After(afterSeq, resp.rows);
		resp.eventSeq = EMCP_WB_PlayRecorder.LastSeq();
		resp.status = "ok";
		resp.message = answered.ToString() + " events after seq " + afterSeq.ToString() + "; the buffer holds the last " + EMCP_WB_PlayRecorder.CAPACITY.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! comments: the CommentEntity sources of the editor entity list, paged by "<start>:<count>"
	//! (STALE_CURSOR when the count changed), and the comment categories.
	static void Comments(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		WorldEditorAPI api = EMCP_WB_WorldUtil.Api(resp);
		if (!api)
			return;

		int pageSize = req.limit;
		if (pageSize <= 0)
			pageSize = EMCP_WB_WorldUtil.PAGE_DEFAULT;
		if (pageSize > EMCP_WB_WorldUtil.PAGE_MAX)
			pageSize = EMCP_WB_WorldUtil.PAGE_MAX;

		array<IEntitySource> found = {};
		int editorCount = api.GetEditorEntityCount();
		for (int i = 0; i < editorCount; i++)
		{
			IEntitySource candidate = api.GetEditorEntity(i);
			if (candidate && candidate.GetClassName() == EMCP_WB_WorldUtil.COMMENT_CLASS)
				found.Insert(candidate);
		}
		int count = found.Count();

		int start = 0;
		string cursorText = req.cursor;
		if (cursorText != "")
		{
			int cursorCount = 0;
			string why = "";
			if (!EMCP_WB_WorldUtil.ParseCursor(cursorText, start, cursorCount, why))
			{
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", why, "pass the nextCursor of the previous page");
				return;
			}
			if (cursorCount != count)
			{
				EMCP_WB_WorldUtil.Refuse(resp, "STALE_CURSOR", "the cursor was issued for " + cursorCount.ToString() + " comments, there are " + count.ToString() + " now", "read again without a cursor");
				return;
			}
		}

		int last = start + pageSize;
		if (last > count)
			last = count;
		for (int k = start; k < last; k++)
			resp.rows.Insert(EMCP_WB_WorldUtil.CommentRow(found.Get(k)));
		if (last < count)
			resp.nextCursor = last.ToString() + ":" + count.ToString();

		array<string> categoryNames = {};
		api.GetCommentCategories(categoryNames);
		for (int c = 0; c < categoryNames.Count(); c++)
			resp.categories.Insert(categoryNames.Get(c));

		resp.total = count;
		resp.status = "ok";
		resp.message = count.ToString() + " comment entities; rows " + start.ToString() + ".." + last.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! addComment: CreateEntity of CommentEntity at coords in the given layer (default the current
	//! one), then SetVariableValue on m_Comment, m_Color and m_Size, inside one undo step (P-W1-20).
	static void AddComment(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		if (EMCP_WB_WorldUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_WorldUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_WorldUtil.PlayRefused(api, resp))
			return;

		string commentText = req.text;
		if (commentText == "")
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "text is required", "pass the comment text");
			return;
		}
		vector position = vector.Zero;
		string parseWhy = "";
		if (!EMCP_WB_Common.ParseVectorString(req.coords, position, parseWhy))
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "coords: " + parseWhy, "pass coords as \"x y z\"");
			return;
		}
		string colorText = "";
		string colorRaw = req.color;
		if (colorRaw != "")
		{
			vector colorValue = vector.Zero;
			if (!EMCP_WB_Common.ParseVectorString(colorRaw, colorValue, parseWhy))
			{
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "color: " + parseWhy, "pass color as \"r g b\" in 0..1");
				return;
			}
			colorText = EMCP_WB_Common.VectorToString(colorValue);
		}
		float sizeValue = 0;
		if (req.size != "" && (!EMCP_WB_Common.ParseFloat(req.size, sizeValue) || sizeValue <= 0))
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "size must be a number above 0, got '" + req.size + "'", "pass size in metres");
			return;
		}
		int layerId = api.GetCurrentEntityLayerId();
		string layerPath = req.layer;
		if (layerPath != "")
		{
			layerId = EMCP_WB_LayersUtil.LayerIdOf(api, api.GetCurrentSubScene(), layerPath);
			if (layerId < 0)
			{
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "no layer '" + layerPath + "' in the current sub-scene", "pass a layer path from wb_layers list");
				return;
			}
		}

		string undo = EMCP_WB_WorldUtil.UNDO_PREFIX + "addComment";
		resp.undoName = undo;
		if (!EMCP_WB_WorldUtil.BeginEdit(api, undo, resp))
			return;
		IEntitySource created = api.CreateEntity(EMCP_WB_WorldUtil.COMMENT_CLASS, "", layerId, null, position, vector.Zero);
		if (!created)
		{
			api.EndEntityAction();
			EMCP_WB_WorldUtil.EngineFalse(resp, "CreateEntity returned null for " + EMCP_WB_WorldUtil.COMMENT_CLASS, "check the layer is not locked");
			return;
		}
		string failed = "";
		if (!api.SetVariableValue(created, null, "m_Comment", commentText))
			failed += " m_Comment";
		if (colorText != "" && !api.SetVariableValue(created, null, "m_Color", colorText))
			failed += " m_Color";
		if (sizeValue > 0 && !api.SetVariableValue(created, null, "m_Size", sizeValue.ToString()))
			failed += " m_Size";
		api.EndEntityAction();

		resp.id = EMCP_WB_EntityRef.Format(created);
		if (failed != "")
		{
			EMCP_WB_WorldUtil.EngineFalse(resp, "the comment entity was created but SetVariableValue returned false for" + failed, "wb_undo_redo undo, or set the field with wb_container");
			return;
		}
		resp.status = "ok";
		resp.message = "comment entity created";
	}

	//------------------------------------------------------------------------------------------------
	//! annotate: a visible note on an entity (P-W1-20). W1.7 run 6 showed that AddCommentEntity draws
	//! nothing: it registers a comment entity that draws ITSELF (the 1.9 EditorCommentEntity calls it
	//! on itself in EOnInit, MoveCommentEntity in _WB_SetTransform and RemoveCommentEntity in its
	//! destructor; CommentEntity.DrawComment draws the text from _WB_AfterWorldUpdate). So the note is
	//! a CommentEntity named EMCP_Note_<entity>, in the entity's layer, just above its bounds, with the
	//! text facing the camera, drawn over everything on a background, its height the request's size or
	//! scaled from the entity's framing distance (NoteSize; W1.7 run 7: a fixed 0.5 m was too large):
	//! add = CreateEntity + SetVariableValue, move = its coords, remove = DeleteEntity of the note.
	//! Each inside one entity action (undo).
	static void Annotate(EMCP_WB_WorldRequest req, EMCP_WB_WorldResponse resp)
	{
		if (EMCP_WB_WorldUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_WorldUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_WorldUtil.PlayRefused(api, resp))
			return;

		string annotateMode = req.mode;
		if (annotateMode != "add" && annotateMode != "move" && annotateMode != "remove")
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "mode must be add, move or remove; got '" + annotateMode + "'", "pass mode add, move or remove");
			return;
		}

		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.entity, resolved))
		{
			EMCP_WB_WorldUtil.Refuse(resp, resolved.m_Code, resolved.m_Why, "wb_entity list, then pass the id: it answers");
			return;
		}
		IEntitySource src = resolved.m_Src;
		// The parse errors below (ParseColor, ParseVectorString) answer into why.
		string why = "";
		IEntity ent = api.SourceToEntity(src);
		if (!ent)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "ENTITY_NOT_FOUND", "the entity source has no runtime entity (SourceToEntity returned null)", "pick an entity placed in the world");
			return;
		}
		string anchorId = EMCP_WB_EntityRef.Format(src);
		string noteName = EMCP_WB_WorldUtil.NoteNameOf(src);
		IEntitySource note = EMCP_WB_Common.FindEntityByName(api, noteName);
		if (note && note.GetClassName() != EMCP_WB_WorldUtil.COMMENT_CLASS)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "an entity named " + noteName + " exists and is not a " + EMCP_WB_WorldUtil.COMMENT_CLASS, "rename that entity, then retry");
			return;
		}

		string undo = EMCP_WB_WorldUtil.UNDO_PREFIX + "annotate " + annotateMode;
		if (annotateMode == "add")
		{
			string noteText = req.text;
			if (noteText == "")
			{
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "text is required for add", "pass the comment text");
				return;
			}
			if (note)
			{
				resp.id = EMCP_WB_EntityRef.Format(note);
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", anchorId + " has a note already (" + noteName + ")", "annotate remove first, or move it");
				return;
			}
			float r = 1;
			float g = 1;
			float b = 1;
			float a = 1;
			string colorRaw = req.color;
			if (colorRaw != "" && !EMCP_WB_WorldUtil.ParseColor(colorRaw, r, g, b, a, why))
			{
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", why, "pass color as \"r g b a\" in 0..1");
				return;
			}
			float noteSize = 0;
			float framedFrom = 0;
			if (req.size != "")
			{
				if (!EMCP_WB_Common.ParseFloat(req.size, noteSize) || noteSize <= 0 || noteSize > EMCP_WB_WorldUtil.NOTE_SIZE_MAX)
				{
					EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "size must be a number above 0 and at most 100 (metres), got '" + req.size + "'", "pass size in metres, or leave it out for a height scaled from the entity's bounds");
					return;
				}
			}
			else
			{
				framedFrom = EMCP_WB_ViewUtil.FramingDistance(EMCP_WB_WorldUtil.BoundsRadius(ent));
				noteSize = EMCP_WB_WorldUtil.NoteSize(framedFrom, noteText);
			}
			vector position = EMCP_WB_WorldUtil.NoteSpot(ent, noteSize);
			resp.undoName = undo;
			if (!EMCP_WB_WorldUtil.BeginEdit(api, undo, resp))
				return;
			IEntitySource created = api.CreateEntity(EMCP_WB_WorldUtil.COMMENT_CLASS, noteName, src.GetLayerID(), null, position, vector.Zero);
			if (!created)
			{
				api.EndEntityAction();
				EMCP_WB_WorldUtil.EngineFalse(resp, "CreateEntity returned null for the note " + noteName, "check the entity's layer is not locked");
				return;
			}
			string failed = "";
			if (!api.SetVariableValue(created, null, "m_Comment", noteText))
				failed += " m_Comment";
			if (!api.SetVariableValue(created, null, "m_Size", noteSize.ToString()))
				failed += " m_Size";
			if (!api.SetVariableValue(created, null, "m_FaceCamera", "1"))
				failed += " m_FaceCamera";
			if (!api.SetVariableValue(created, null, "m_VisibleOverall", "1"))
				failed += " m_VisibleOverall";
			if (!api.SetVariableValue(created, null, "m_TextBackground", "1"))
				failed += " m_TextBackground";
			if (colorRaw != "")
			{
				if (!api.SetVariableValue(created, null, "m_Color", EMCP_WB_Common.VectorToString(Vector(r, g, b))))
					failed += " m_Color";
				float transparency = 1 - a;
				if (!api.SetVariableValue(created, null, "m_Transparency", transparency.ToString()))
					failed += " m_Transparency";
			}
			api.EndEntityAction();
			resp.id = EMCP_WB_EntityRef.Format(created);
			resp.noteSize = noteSize;
			resp.noteCoords = EMCP_WB_Common.VectorToString(position);
			resp.noteColor = r.ToString() + " " + g.ToString() + " " + b.ToString() + " " + a.ToString();
			resp.noteDistance = framedFrom;
			if (failed != "")
			{
				EMCP_WB_WorldUtil.EngineFalse(resp, "the note " + noteName + " was created but SetVariableValue returned false for" + failed, "wb_undo_redo undo, or set the field with wb_container");
				return;
			}
			resp.status = "ok";
			resp.message = "note " + noteName + " added on " + anchorId + ", " + noteSize.ToString() + " m high, at " + EMCP_WB_Common.VectorToString(position);
			return;
		}

		if (!note)
		{
			EMCP_WB_WorldUtil.Refuse(resp, "ENTITY_NOT_FOUND", anchorId + " has no note (" + noteName + ")", "annotate add first");
			return;
		}
		resp.id = EMCP_WB_EntityRef.Format(note);
		if (annotateMode == "move")
		{
			vector moveTo = vector.Zero;
			if (!EMCP_WB_Common.ParseVectorString(req.coords, moveTo, why))
			{
				EMCP_WB_WorldUtil.Refuse(resp, "INVALID_ARGUMENT", "coords: " + why, "pass coords as \"x y z\"");
				return;
			}
			resp.undoName = undo;
			if (!EMCP_WB_WorldUtil.BeginEdit(api, undo, resp))
				return;
			bool moved = api.SetVariableValue(note, null, "coords", EMCP_WB_Common.VectorToString(moveTo));
			api.EndEntityAction();
			if (!moved)
			{
				EMCP_WB_WorldUtil.EngineFalse(resp, "SetVariableValue returned false for the note's coords", "wb_layers tree: check the layer is not locked");
				return;
			}
			resp.status = "ok";
			resp.message = "note " + noteName + " moved to " + EMCP_WB_Common.VectorToString(moveTo);
			return;
		}

		resp.undoName = undo;
		if (!EMCP_WB_WorldUtil.BeginEdit(api, undo, resp))
			return;
		bool deleted = api.DeleteEntity(note);
		api.EndEntityAction();
		if (!deleted)
		{
			EMCP_WB_WorldUtil.EngineFalse(resp, "DeleteEntity returned false for the note " + noteName, "wb_layers tree: check the layer is not locked");
			return;
		}
		resp.status = "ok";
		resp.message = "note " + noteName + " removed from " + anchorId;
	}
}
