/**
 * EMCP_WB_Resources.c - Resource database handler of wb_resources (wave W2, phase5-w2-spec.md section 2.1)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Resources", dispatching on "action":
 *   search           ResourceDatabase.SearchResources(filter, CollectHit) (the SCR_WorkbenchHelper
 *                    callback form: an unregistered file answers its exact $Addon:path), sorted and
 *                    paged by "<start>:<count>" (STALE_CURSOR on a changed total); a relative rootPath
 *                    is searched as $<id>:<folder> in each loaded addon
 *   selection        ResourceManager.GetResourceBrowserSelection(array.Insert, recursive), capped at 2000
 *   resolve          Workbench.GetResourceName of a path, {GUID} or {GUID}path; GetAbsolutePath of its
 *                    path (the SCR_PrefabHelper.GetResourceNameAbsolutePath form); GetMetaFile, then
 *                    GetSourceFilePath and Release(false)
 *   addons           GameProject.GetLoadedAddons / GetAvailableAddons, GetAddonID, GetAddonTitle,
 *                    IsVanillaAddon (static), and Workbench.GetCurrentGameProjectFile
 *   newGuid          Workbench.GenerateGloballyUniqueID64
 *   wait             ResourceManager.WaitForFile(abs, timeoutMs) on a path inside the project
 *   register         GetMetaFile, then RegisterResourceFile(abs, buildRuntime) when none exists (the
 *                    wb_world register order); project+target(existing), dry run unless confirm
 *   rebuild          RebuildResourceFile(abs, configuration, false) or RebuildResourceFiles(abs list,
 *                    configuration), then WaitForFile per file; registered project files only
 *   import           register when no .meta exists, then Set of name=value settings on the meta's
 *                    Configurations entry (or all of them), MetaFile.Save, Release(false), then
 *                    RebuildResourceFile + WaitForFile; before/after per setting
 *   create           BaseContainerTools.CreateContainer(className), optional SetAncestor(inherit),
 *                    SaveContainer with the project-relative path (DEC-044), RegisterResourceFile;
 *                    project+new, dry run unless confirm; .conf, .emat and .layout only (P-W2-11)
 *   prefabFromModel  in one entity action: CreateEntity(GenericEntity or inherit), MeshObject from the
 *                    entity or CreateComponent, SetVariableValue(MeshObject.Object = xob),
 *                    CreateEntityTemplate to a NEW project .et, DeleteEntity of the temporary entity
 *                    (SCR_PrefabHelper.CreateEntitySourceFromXOB's calls without its file methods, OD-5)
 *
 * The 1.x actions open and browse are not handler actions: open is wb_module setResource and browse
 * is an alias of search (src/manifest/aliases.ts, main). No file method is called (FileIO prompts
 * without -scriptAuthorizeAll, DEC-053): paths are checked through EMCP_WB_Guard, which resolves them
 * with Workbench.GetAbsolutePath. Every meta read ends with Release(false); no meta is held across
 * calls. Engine pointers never travel through an out parameter. Writes go only to an existing file
 * of the open project (TargetExistsInProject) or a new one whose folder exists (NewTargetInProject),
 * and write nothing without confirm (DEC-058). A refusal answers status refused, code, next and a
 * message "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Resources.json.
 */

class EMCP_WB_ResourcesRequest : JsonApiStruct
{
	string action;
	// search: "$Addon:Folder/" or a relative folder; extensions without the dot; all words; tags
	string rootPath;
	ref array<string> extensions;
	ref array<string> searchStr;
	ref array<string> tags;
	// search: into sub-folders; selection: expand selected folders (default true for both)
	bool recursive;
	// search: "<start>:<count>" and page size
	string cursor;
	int limit;
	// resolve: path, {GUID} or {GUID}path; the other actions: project-relative source file
	string path;
	// addons: also the addons that are not loaded
	bool available;
	// wait, rebuild: milliseconds per file; -1 when not given (1000)
	int timeoutMs;
	// register: build the runtime resource too
	bool buildRuntime;
	// mutating actions: true writes; else a dry run
	bool confirm;
	// rebuild: project-relative files, at most 200
	ref array<string> paths;
	// rebuild, import: the configuration (platform), default PC
	string configuration;
	// import: name=value per setting
	ref array<string> settings;
	// import: write every configuration
	bool allPlatforms;
	// create: the root class of the new container
	string className;
	// create: ancestor resource name; prefabFromModel: parent prefab
	string inherit;
	// prefabFromModel: the model's resource name
	string xobPath;

	void EMCP_WB_ResourcesRequest()
	{
		extensions = {};
		searchStr = {};
		tags = {};
		paths = {};
		settings = {};

		RegV("action");
		RegV("rootPath");
		RegV("extensions");
		RegV("searchStr");
		RegV("tags");
		RegV("recursive");
		RegV("cursor");
		RegV("limit");
		RegV("path");
		RegV("available");
		RegV("timeoutMs");
		RegV("buildRuntime");
		RegV("confirm");
		RegV("paths");
		RegV("configuration");
		RegV("settings");
		RegV("allPlatforms");
		RegV("className");
		RegV("inherit");
		RegV("xobPath");

		// Defaults for keys the request leaves out.
		recursive = true;
		limit = 0;
		available = false;
		timeoutMs = -1;
		buildRuntime = false;
		confirm = false;
		allPlatforms = false;
	}
}

class EMCP_WB_ResourcesResponse : JsonApiStruct
{
	// ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	// search, selection, addons
	int total;
	string nextCursor;
	bool capped;
	ref array<string> items;
	// resolve, register, import, create, prefabFromModel
	string resourceName;
	string guid;
	// resolve
	string relPath;
	string absPath;
	bool hasMeta;
	string sourcePath;
	// addons
	string projectFile;
	// wait
	bool found;
	// register
	bool registered;
	// mutating actions
	bool dryRun;
	// rebuild
	int count;
	ref array<string> rebuilt;
	ref array<string> pending;
	// import: "<configuration>:<name>=<value>" per setting
	ref array<string> before;
	ref array<string> after;
	// create, prefabFromModel
	bool saved;
	string savedPath;

	void EMCP_WB_ResourcesResponse()
	{
		items = {};
		rebuilt = {};
		pending = {};
		before = {};
		after = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("total");
		RegV("nextCursor");
		RegV("capped");
		RegV("items");
		RegV("resourceName");
		RegV("guid");
		RegV("relPath");
		RegV("absPath");
		RegV("hasMeta");
		RegV("sourcePath");
		RegV("projectFile");
		RegV("found");
		RegV("registered");
		RegV("dryRun");
		RegV("count");
		RegV("rebuilt");
		RegV("pending");
		RegV("before");
		RegV("after");
		RegV("saved");
		RegV("savedPath");
	}
}

class EMCP_WB_ResourcesUtil
{
	//! Paging of search (phase5-w2-spec.md section 1).
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	//! Hits search pages over at most; past it capped says so.
	static const int SEARCH_MAX = 20000;
	//! Resources selection answers at most.
	static const int SELECTION_MAX = 2000;
	//! Files one rebuild takes at most.
	static const int PATHS_MAX = 200;
	//! WaitForFile timeout: default and largest (P-W2-10 decides whether 10 s trips the watchdog).
	static const int WAIT_DEFAULT = 1000;
	static const int WAIT_MAX = 10000;
	static const string DEFAULT_CONFIGURATION = "PC";
	static const string CONFIGURATIONS = "Configurations";
	static const string MESH_COMPONENT = "MeshObject";
	static const string MESH_VARIABLE = "Object";
	static const string ROOT_ENTITY_CLASS = "GenericEntity";
	static const string PREFAB_EXT = ".et";
	static const string MODEL_EXT = ".xob";
	static const string UNDO_PREFIX = "EMCP wb_resources ";
	//! The characters a class name may start with (IsIdentifier).
	static const string IDENT_START = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
	static const string NEXT_PROJECT = "install the handlers in the project you have open";
	static const string NEXT_WORLD_EDITOR = "open the World Editor with a world (wb_module setResource)";

	//------------------------------------------------------------------------------------------------
	//! Sets a refusal: status refused, code, next and the message "CODE: text | next: step".
	static void Refuse(EMCP_WB_ResourcesResponse resp, string code, string text, string nextStep)
	{
		resp.status = EMCP_WB_Guard.REFUSED;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! An engine call that returned false or null: status error, code ENGINE_FALSE.
	static void EngineFalse(EMCP_WB_ResourcesResponse resp, string text, string nextStep)
	{
		resp.status = "error";
		resp.code = "ENGINE_FALSE";
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage("ENGINE_FALSE", EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused NOT_IN_PROJECT) when the project is not found (DEC-058).
	static bool ProjectRefused(EMCP_WB_ResourcesResponse resp)
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
	//! The Resource Manager module, or null with the response refused MODULE_NOT_OPEN. The Resource
	//! Manager is the Workbench main window, so GetModule finds it open.
	static ResourceManager Rm(EMCP_WB_ResourcesResponse resp)
	{
		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
			Refuse(resp, "MODULE_NOT_OPEN", "the Resource Manager is not open: GetModule returned null", "wb_module open ResourceManager");
		return resourceManager;
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor's API with a loaded world, or null with the response refused (MODULE_NOT_OPEN
	//! or NO_WORLD). GetModule opens a closed World Editor (DEC-053): the refusal says so.
	static WorldEditorAPI Api(EMCP_WB_ResourcesResponse resp)
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
			Refuse(resp, "NO_WORLD", "the World Editor has no API: no world is open (GetModule may have opened the World Editor)", NEXT_WORLD_EDITOR);
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, "NO_WORLD", noWorld + " (GetModule may have opened the World Editor)", NEXT_WORLD_EDITOR);
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused WRONG_MODE) when the World Editor is in play mode or in prefab
	//! edit mode (CreateEntity would add the temporary entity to the edited prefab, review R2).
	static bool PlayRefused(WorldEditorAPI api, EMCP_WB_ResourcesResponse resp)
	{
		if (api.IsGameMode())
		{
			Refuse(resp, "WRONG_MODE", "the World Editor is in play mode; prefabFromModel runs in edit mode only", "wb_world stop");
			return true;
		}
		if (api.IsPrefabEditMode())
		{
			Refuse(resp, "WRONG_MODE", "the World Editor is in prefab edit mode; prefabFromModel runs in edit mode on a world only", "leave prefab edit mode (open a world with wb_module setResource)");
			return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, so EndEntityAction never closes an action this handler did not
	//! begin (the W1 review W2 rule).
	static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_ResourcesResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		Refuse(resp, "ENGINE_FALSE", "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
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
	//! "true" or "false".
	static string BoolText(bool value)
	{
		if (value)
			return "true";
		return "false";
	}

	//------------------------------------------------------------------------------------------------
	//! The GUID of a resource name "{GUID}path": the 16 characters inside the braces, "" otherwise.
	static string GuidOf(string resourceName)
	{
		if (!resourceName.StartsWith("{"))
			return "";
		int close = resourceName.IndexOf("}");
		if (close != 17)
			return "";
		return resourceName.Substring(1, 16);
	}

	//------------------------------------------------------------------------------------------------
	//! True for a resource name "{GUID}path" whose path ends in ext (lower case), e.g. ".et".
	static bool IsResourceNameOf(string value, string ext)
	{
		if (GuidOf(value) == "")
			return false;
		string lower = value;
		lower.ToLower();
		return lower.EndsWith(ext) && value.Length() > 18 + ext.Length();
	}

	//------------------------------------------------------------------------------------------------
	//! True when a resource name "{GUID}path" names a resource the engine can resolve: a loose file
	//! (Workbench.GetAbsolutePath of its path with mustExist, the SCR_PrefabHelper
	//! .GetResourceNameAbsolutePath form), or a packed one. GetAbsolutePath answers false for a file
	//! inside a .pak (W2 run 2: w2-40's vanilla ancestor {6B819A076E1A5674}Configs/Hints/Editor.conf,
	//! and w2-10's wb_meta get of Configs/Hints/GeneralHints.conf), so a packed resource is looked up
	//! by its GUID in the resource database: Workbench.GetResourceName("{GUID}") answers the GUID
	//! unchanged for an unknown one (BI's MaterialValidatorUtils.CheckTextures test, which passed for
	//! packed vanilla textures in w2-15 on 1.9.0.37). When the database names a path for the GUID it
	//! must be the path given (case aside). No file method.
	static bool ResourceExists(string value)
	{
		ResourceName named = value;
		string rel = named.GetPath();
		if (rel == "")
			return false;
		string abs = "";
		if (Workbench.GetAbsolutePath(rel, abs, true))
			return true;
		string guid = GuidOf(value);
		if (guid == "")
			return false;
		string braced = "{" + guid + "}";
		ResourceName known = Workbench.GetResourceName(braced);
		string knownText = known;
		if (knownText == "" || knownText == braced)
			return false;
		string knownPath = known.GetPath();
		if (knownPath == "")
			return true;
		string wanted = rel;
		wanted.ToLower();
		knownPath.ToLower();
		return knownPath == wanted;
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name of a registered file (GetMetaFile, GetResourceID, Release(false)), "" when
	//! no .meta exists.
	static string MetaIdOf(ResourceManager resourceManager, string absolute)
	{
		MetaFile meta = resourceManager.GetMetaFile(absolute);
		if (!meta)
			return "";
		string id = meta.GetResourceID();
		meta.Release(false);
		return id;
	}

	//------------------------------------------------------------------------------------------------
	//! True for the platform configuration names of the 1.9 TextureTypes base configs.
	static bool IsConfiguration(string name)
	{
		return name == "PC" || name == "XBOX_ONE" || name == "XBOX_SERIES" || name == "PS4" || name == "PS5" || name == "HEADLESS";
	}

	//------------------------------------------------------------------------------------------------
	//! The configuration a request names ("" means PC); "" with the response refused when it is not
	//! one of the six platform names.
	static string ConfigurationOf(string requested, EMCP_WB_ResourcesResponse resp)
	{
		string name = requested;
		if (name == "")
			name = DEFAULT_CONFIGURATION;
		if (IsConfiguration(name))
			return name;
		Refuse(resp, "INVALID_ARGUMENT", "configuration must be PC, XBOX_ONE, XBOX_SERIES, PS4, PS5 or HEADLESS, got '" + requested + "'", "leave configuration out for PC");
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! The timeout a request names (-1 means the default); -1 with the response refused when it is
	//! below 0 or above WAIT_MAX.
	static int TimeoutOf(int requested, EMCP_WB_ResourcesResponse resp)
	{
		if (requested == -1)
			return WAIT_DEFAULT;
		if (requested >= 0 && requested <= WAIT_MAX)
			return requested;
		Refuse(resp, "INVALID_ARGUMENT", "timeoutMs must be 0 to " + WAIT_MAX.ToString() + ", got " + requested.ToString(), "leave timeoutMs out for 1000");
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! An existing source file of the project (TargetExistsInProject), never a .meta: its absolute
	//! path and clean relative path, or false with the response refused.
	static bool ExistingTarget(string rel, EMCP_WB_ResourcesResponse resp, out string absolute, out string clean)
	{
		absolute = "";
		clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(rel, clean, why))
		{
			clean = "";
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "CleanRelative: " + why, "pass a project-relative path");
			return false;
		}
		string lower = clean;
		lower.ToLower();
		if (lower.EndsWith(".meta"))
		{
			clean = "";
			Refuse(resp, "INVALID_ARGUMENT", "a .meta file is not a resource; name the file it belongs to", "pass the resource's path, not its .meta");
			return false;
		}
		if (!EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why))
		{
			absolute = "";
			clean = "";
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why, "write the file into the project first");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A new file of the project (NewTargetInProject) that does not exist yet and ends in one of the
	//! given extensions (comma-separated, lower case): its absolute and clean relative path, or false
	//! with the response refused (UNSUPPORTED_TYPE for another extension).
	static bool NewTarget(string rel, string allowedExts, EMCP_WB_ResourcesResponse resp, out string absolute, out string clean)
	{
		absolute = "";
		clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(rel, clean, why))
		{
			clean = "";
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "CleanRelative: " + why, "pass a project-relative path");
			return false;
		}
		string lower = clean;
		lower.ToLower();
		array<string> exts = {};
		allowedExts.Split(",", exts, true);
		bool known = false;
		foreach (string ext : exts)
		{
			if (lower.EndsWith(ext))
				known = true;
		}
		if (!known)
		{
			clean = "";
			Refuse(resp, "UNSUPPORTED_TYPE", "the new file must end in one of " + allowedExts + ": " + rel, "pass a path with one of those extensions");
			return false;
		}
		if (!EMCP_WB_Guard.NewTargetInProject(clean, absolute, why))
		{
			absolute = "";
			clean = "";
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "NewTargetInProject: " + why, "pass a path inside the project whose folder exists");
			return false;
		}
		string existing = "";
		if (Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true))
		{
			Refuse(resp, "INVALID_ARGUMENT", "the file exists already: " + clean, "pick a new name");
			absolute = "";
			clean = "";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True for a class name: a letter or underscore, then letters, digits or underscores.
	static bool IsIdentifier(string name)
	{
		int len = name.Length();
		if (len == 0)
			return false;
		for (int i = 0; i < len; i++)
		{
			string ch = name.Get(i);
			if (IDENT_START.Contains(ch))
				continue;
			if (i > 0 && name.IsDigitAt(i))
				continue;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The MeshObject component of an entity source: the one it has (from its prefab), else a new
	//! one (CreateComponent), the SCR_PrefabHelper.CreateEntitySourceComponentIfNeeded rule. Null
	//! when CreateComponent gave none.
	static IEntityComponentSource MeshComponent(WorldEditorAPI api, IEntitySource src)
	{
		int componentCount = src.GetComponentCount();
		for (int i = 0; i < componentCount; i++)
		{
			IEntityComponentSource component = src.GetComponent(i);
			if (component && component.GetClassName() == MESH_COMPONENT)
				return component;
		}
		return api.CreateComponent(src, MESH_COMPONENT);
	}
}

class EMCP_WB_Resources : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ResourcesRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ResourcesRequest req = EMCP_WB_ResourcesRequest.Cast(request);
		EMCP_WB_ResourcesResponse resp = new EMCP_WB_ResourcesResponse();
		if (!req)
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "search")
			Search(req, resp);
		else if (req.action == "selection")
			Selection(req, resp);
		else if (req.action == "resolve")
			Resolve(req, resp);
		else if (req.action == "addons")
			Addons(req, resp);
		else if (req.action == "newGuid")
			NewGuid(req, resp);
		else if (req.action == "wait")
			WaitForResource(req, resp);
		else if (req.action == "register")
			Register(req, resp);
		else if (req.action == "rebuild")
			Rebuild(req, resp);
		else if (req.action == "import")
			Import(req, resp);
		else if (req.action == "create")
			Create(req, resp);
		else if (req.action == "prefabFromModel")
			PrefabFromModel(req, resp);
		else
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "unknown action '" + req.action + "'", "one of search, selection, resolve, addons, newGuid, wait, register, rebuild, import, create, prefabFromModel (open is wb_module setResource; browse is search)");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! search: ResourceDatabase.SearchResources with an array's Insert as the callback (the form of
	//! SCR_PrefabHelper.GetPrefabs and BatchTextureProcessorPlugin), the hits sorted and paged by
	//! "<start>:<count>" (STALE_CURSOR when the total changed). rootPath is "" (every loaded addon),
	//! "$Addon:Folder/" (the GetPrefabs form) or a relative folder; an absolute path is refused.
	//! Empty filter arrays are left unset, as the vanilla callers leave them (P-W2-02 to P-W2-04).
	//! An unregistered file is answered as ResourceName.Empty (BI SCR_WorkbenchHelper removes those
	//! entries); its exact path ($Addon:path) comes as the second argument (BI SearchWorkbenchFiles).
	//! A relative rootPath answered false on 1.9.0.37 (W2 run 1, P-W2-03): rootPath is "$addon:Folder"
	//! in BI's callers, so a relative folder is searched as "$<id>:<folder>" in each loaded addon.
	static ref array<string> s_aHits;
	static int s_iUnregistered;

	//------------------------------------------------------------------------------------------------
	//! The SearchResourcesCallback (BI SCR_WorkbenchHelper.SearchResourcesCallbackMethod's form):
	//! the resource name, or the exact path of an unregistered file.
	protected static bool CollectHit(ResourceName resourceName, string exactPath = "")
	{
		string hitText = resourceName;
		if (hitText == "")
		{
			s_iUnregistered++;
			hitText = exactPath;
		}
		if (s_aHits)
			s_aHits.Insert(hitText);
		return true;
	}

	static void Search(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		SearchResourcesFilter filter = new SearchResourcesFilter();
		string root = req.rootPath;
		bool relativeRoot = false;
		string rootFolder = "";
		if (root != "")
		{
			string rootCheck = root;
			rootCheck.Replace("\\", "/");
			bool prefixed = rootCheck.StartsWith("$") && rootCheck.IndexOf(":") > 1;
			int colons = 0;
			array<string> rootParts = {};
			rootCheck.Split(":", rootParts, false);
			colons = rootParts.Count() - 1;
			if ((!prefixed && colons > 0) || colons > 1 || rootCheck.Contains("..") || rootCheck.StartsWith("/"))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "ABSOLUTE_PATH", "rootPath must be $Addon:Folder/ or a relative folder, got '" + root + "'", "pass rootPath as $<addon id>:<folder>/");
				return;
			}
			filter.rootPath = rootCheck;
			relativeRoot = !prefixed;
			rootFolder = rootCheck;
		}

		array<string> exts = {};
		foreach (string ext : req.extensions)
		{
			string bare = ext;
			if (bare.StartsWith("."))
				bare = bare.Substring(1, bare.Length() - 1);
			if (bare == "" || bare.Contains("/") || bare.Contains("\\"))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "extensions holds an empty or invalid entry '" + ext + "'", "pass extensions without the dot, e.g. conf");
				return;
			}
			exts.Insert(bare);
		}
		if (exts.Count() > 0)
			filter.fileExtensions = exts;

		array<string> words = {};
		foreach (string word : req.searchStr)
		{
			if (word != "")
				words.Insert(word);
		}
		if (words.Count() > 0)
			filter.searchStr = words;

		array<string> tagNames = {};
		foreach (string tagName : req.tags)
		{
			if (tagName != "")
				tagNames.Insert(tagName);
		}
		if (tagNames.Count() > 0)
			filter.tags = tagNames;

		filter.recursive = req.recursive;

		int pageSize = req.limit;
		if (pageSize <= 0)
			pageSize = EMCP_WB_ResourcesUtil.PAGE_DEFAULT;
		if (pageSize > EMCP_WB_ResourcesUtil.PAGE_MAX)
			pageSize = EMCP_WB_ResourcesUtil.PAGE_MAX;

		int start = 0;
		int cursorCount = -1;
		string cursorText = req.cursor;
		if (cursorText != "")
		{
			string why = "";
			if (!EMCP_WB_ResourcesUtil.ParseCursor(cursorText, start, cursorCount, why))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", why, "pass the nextCursor of the previous page");
				return;
			}
		}

		s_aHits = {};
		s_iUnregistered = 0;
		bool searched = false;
		int rootsSearched = 0;
		if (relativeRoot)
		{
			array<string> loadedAddons = {};
			GameProject.GetLoadedAddons(loadedAddons);
			foreach (string addonGuid : loadedAddons)
			{
				string addonId = GameProject.GetAddonID(addonGuid);
				if (addonId == "")
					continue;
				filter.rootPath = "$" + addonId + ":" + rootFolder;
				if (ResourceDatabase.SearchResources(filter, CollectHit))
				{
					searched = true;
					rootsSearched++;
				}
			}
		}
		else
		{
			searched = ResourceDatabase.SearchResources(filter, CollectHit);
		}
		array<string> collected = {};
		collected.Copy(s_aHits);
		s_aHits.Clear();
		int unregistered = s_iUnregistered;
		if (!searched)
		{
			string falseText = "ResourceDatabase.SearchResources returned false";
			if (relativeRoot)
				falseText = falseText + " for '" + rootFolder + "' under every loaded addon";
			EMCP_WB_ResourcesUtil.EngineFalse(resp, falseText, "check rootPath and extensions; pass rootPath as $<addon id>:<folder>/");
			return;
		}

		collected.Sort();
		array<string> names = {};
		foreach (string hitName : collected)
		{
			if (names.Count() > 0 && names.Get(names.Count() - 1) == hitName && hitName != "")
				continue;
			names.Insert(hitName);
		}
		int total = names.Count();
		int pageable = total;
		if (pageable > EMCP_WB_ResourcesUtil.SEARCH_MAX)
		{
			pageable = EMCP_WB_ResourcesUtil.SEARCH_MAX;
			resp.capped = true;
		}

		if (cursorText != "" && cursorCount != total)
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "STALE_CURSOR", "the cursor was issued for " + cursorCount.ToString() + " hits, there are " + total.ToString() + " now", "search again without a cursor");
			return;
		}

		int last = start + pageSize;
		if (last > pageable)
			last = pageable;
		for (int k = start; k < last; k++)
			resp.items.Insert(names.Get(k));
		if (last < pageable)
			resp.nextCursor = last.ToString() + ":" + total.ToString();

		resp.total = total;
		resp.status = "ok";
		resp.message = total.ToString() + " hits; items " + start.ToString() + ".." + last.ToString();
		if (unregistered > 0)
			resp.message = resp.message + "; " + unregistered.ToString() + " unregistered (answered as their $Addon:path)";
		if (relativeRoot)
			resp.message = resp.message + "; the relative folder searched in " + rootsSearched.ToString() + " loaded addons";
		if (resp.capped)
			resp.message = resp.message + "; only the first " + EMCP_WB_ResourcesUtil.SEARCH_MAX.ToString() + " (sorted) are paged: narrow the filter";
	}

	//------------------------------------------------------------------------------------------------
	//! selection: the resources selected in the Resource Manager's Resource Browser panel
	//! (ResourceManager.GetResourceBrowserSelection, an array's Insert as the callback, as wb_world
	//! browserSelection does for the World Editor's panel), at most SELECTION_MAX.
	static void Selection(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		array<ResourceName> picked = {};
		bool expand = req.recursive;
		resourceManager.GetResourceBrowserSelection(picked.Insert, expand);
		int pickedCount = picked.Count();
		for (int i = 0; i < pickedCount && i < EMCP_WB_ResourcesUtil.SELECTION_MAX; i++)
		{
			string shown = picked.Get(i);
			resp.items.Insert(EMCP_WB_Guard.ScrubHome(shown));
		}
		resp.total = pickedCount;
		resp.capped = pickedCount > EMCP_WB_ResourcesUtil.SELECTION_MAX;
		resp.status = "ok";
		resp.message = pickedCount.ToString() + " resources selected";
		if (resp.capped)
			resp.message = resp.message + "; the first " + EMCP_WB_ResourcesUtil.SELECTION_MAX.ToString() + " answered";
	}

	//------------------------------------------------------------------------------------------------
	//! resolve: the resource name of a path, {GUID} or {GUID}path (Workbench.GetResourceName); its
	//! relative path (ResourceName.GetPath); its file (Workbench.GetAbsolutePath with mustExist, the
	//! SCR_PrefabHelper.GetResourceNameAbsolutePath form); and its .meta (GetMetaFile, GetSourceFilePath,
	//! Release(false)). A name with no GUID or no path (an unknown GUID, P-W2-22) answers RESOURCE_NOT_FOUND.
	//! A packed resource has no .meta on disk (DEC-040): hasMeta false. A source file registered as
	//! another resource (a .png as .edds) resolves through its own .meta's GetResourceID; absPath is
	//! then the source file's. Pure read: no project guard.
	static void Resolve(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		string input = req.path;
		if (input == "")
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "path is required", "pass a relative path, {GUID} or {GUID}path");
			return;
		}
		string pathPart = input;
		if (input.StartsWith("{"))
		{
			if (EMCP_WB_ResourcesUtil.GuidOf(input) == "")
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "a GUID is 16 characters in braces, got '" + input + "'", "pass {GUID} or {GUID}path");
				return;
			}
			pathPart = input.Substring(18, input.Length() - 18);
		}
		if (pathPart != "")
		{
			string clean = "";
			string why = "";
			if (!EMCP_WB_Guard.CleanRelative(pathPart, clean, why))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "ABSOLUTE_PATH", why, "pass a relative path, {GUID} or {GUID}path");
				return;
			}
		}

		ResourceName named = Workbench.GetResourceName(input);
		string namedText = named;
		string namedGuid = EMCP_WB_ResourcesUtil.GuidOf(namedText);
		string rel = "";
		if (namedGuid != "")
			rel = named.GetPath();

		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		// A source file whose resource is another file (a .png registers as .edds, W2 run 1):
		// GetResourceName of the source path answers "", but its .meta names the resource.
		string sourceAbs = "";
		bool viaSource = false;
		if ((namedGuid == "" || rel == "") && !input.StartsWith("{") && Workbench.GetAbsolutePath(input, sourceAbs, true))
		{
			string sourceId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, sourceAbs);
			ResourceName sourceNamed = sourceId;
			if (EMCP_WB_ResourcesUtil.GuidOf(sourceId) != "" && sourceNamed.GetPath() != "")
			{
				namedText = sourceId;
				namedGuid = EMCP_WB_ResourcesUtil.GuidOf(sourceId);
				rel = sourceNamed.GetPath();
				viaSource = true;
			}
		}
		if (namedGuid == "" || rel == "")
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "RESOURCE_NOT_FOUND", "Workbench.GetResourceName gave no {GUID}path for '" + input + "' (got '" + namedText + "') and no .meta names one", "check the GUID or path with wb_resources search");
			return;
		}
		resp.resourceName = namedText;
		resp.guid = namedGuid;
		resp.relPath = rel;

		string abs = "";
		bool onDisk = false;
		if (viaSource)
		{
			abs = sourceAbs;
			onDisk = true;
		}
		else
		{
			onDisk = Workbench.GetAbsolutePath(rel, abs, true);
		}
		if (onDisk)
		{
			resp.absPath = EMCP_WB_Guard.ScrubHome(abs);
			MetaFile meta = resourceManager.GetMetaFile(abs);
			if (meta)
			{
				resp.hasMeta = true;
				resp.sourcePath = EMCP_WB_Guard.ScrubHome(meta.GetSourceFilePath());
				meta.Release(false);
			}
		}
		resp.status = "ok";
		resp.message = "resolved " + namedText;
		if (viaSource)
			resp.message = resp.message + " through the .meta of the source file " + input;
		if (!resp.hasMeta)
			resp.message = resp.message + "; no .meta on disk (a packed resource, or not registered)";
	}

	//------------------------------------------------------------------------------------------------
	//! addons: the loaded addons (and the available ones with available true), one row
	//! guid|id|vanilla|loaded|title each (the title last: it may hold any character), and the game
	//! project file (Workbench.GetCurrentGameProjectFile, the GAME project, DEC-042). GameProject's
	//! calls are static (E02).
	static void Addons(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		array<string> loaded = {};
		GameProject.GetLoadedAddons(loaded);
		array<string> listed = {};
		foreach (string loadedGuid : loaded)
			listed.Insert(loadedGuid);
		if (req.available)
		{
			array<string> availableGuids = {};
			GameProject.GetAvailableAddons(availableGuids);
			foreach (string availableGuid : availableGuids)
			{
				if (listed.Find(availableGuid) < 0)
					listed.Insert(availableGuid);
			}
		}

		foreach (string addonGuid : listed)
		{
			string addonId = GameProject.GetAddonID(addonGuid);
			string addonTitle = GameProject.GetAddonTitle(addonGuid);
			bool isVanillaAddon = GameProject.IsVanillaAddon(addonGuid);
			bool isLoaded = loaded.Find(addonGuid) >= 0;
			string row = addonGuid + "|" + addonId + "|" + EMCP_WB_ResourcesUtil.BoolText(isVanillaAddon) + "|" + EMCP_WB_ResourcesUtil.BoolText(isLoaded) + "|" + addonTitle;
			resp.items.Insert(EMCP_WB_Guard.ScrubHome(row));
		}
		resp.total = listed.Count();
		resp.projectFile = EMCP_WB_Guard.ScrubHome(Workbench.GetCurrentGameProjectFile());
		resp.status = "ok";
		resp.message = loaded.Count().ToString() + " loaded addons; " + listed.Count().ToString() + " listed";
	}

	//------------------------------------------------------------------------------------------------
	//! newGuid: Workbench.GenerateGloballyUniqueID64 (P-W2-22 checks the format). Nothing is written.
	static void NewGuid(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		string generated = Workbench.GenerateGloballyUniqueID64();
		if (generated == "")
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "GenerateGloballyUniqueID64 returned an empty string", "read the Workbench log");
			return;
		}
		resp.guid = generated;
		resp.status = "ok";
		resp.message = "generated " + generated;
	}

	//------------------------------------------------------------------------------------------------
	//! wait: ResourceManager.WaitForFile(abs, timeoutMs) for a path inside the project
	//! (TargetInsideProject: the file may not exist yet). found false is data, not an error (P-W2-08,
	//! P-W2-10). Nothing is written.
	static void WaitForResource(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		string absolute = "";
		string why = "";
		if (!EMCP_WB_Guard.TargetInsideProject(req.path, absolute, why))
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetInsideProject: " + why, "pass a project-relative path");
			return;
		}
		int timeout = EMCP_WB_ResourcesUtil.TimeoutOf(req.timeoutMs, resp);
		if (timeout < 0)
			return;
		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		resp.found = resourceManager.WaitForFile(absolute, timeout);
		resp.status = "ok";
		if (resp.found)
			resp.message = "the resource database has the file";
		else
			resp.message = "not acknowledged within " + timeout.ToString() + " ms";
	}

	//------------------------------------------------------------------------------------------------
	//! register: a file of the project gets its .meta. GetMetaFile first; RegisterResourceFile(abs,
	//! buildRuntime) only when none exists, then GetMetaFile again (the wb_world register order, DEC-045).
	//! The target must be an existing file inside the project; dry run unless confirm.
	static void Register(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		if (EMCP_WB_ResourcesUtil.ProjectRefused(resp))
			return;
		string absolute = "";
		string clean = "";
		if (!EMCP_WB_ResourcesUtil.ExistingTarget(req.path, resp, absolute, clean))
			return;
		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		string existingId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute);
		if (existingId != "")
		{
			resp.registered = true;
			resp.resourceName = existingId;
			resp.guid = EMCP_WB_ResourcesUtil.GuidOf(existingId);
			resp.dryRun = !req.confirm;
			resp.status = "ok";
			resp.message = "already registered; nothing was written";
			return;
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would register " + clean + " (no .meta yet); nothing was written; pass confirm true to register";
			return;
		}

		bool buildRuntime = req.buildRuntime;
		bool done = resourceManager.RegisterResourceFile(absolute, buildRuntime);
		string newId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute);
		resp.dryRun = false;
		if (!done || newId == "")
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "RegisterResourceFile returned " + done.ToString() + "; .meta found " + EMCP_WB_ResourcesUtil.BoolText(newId != ""),"read the Workbench log; check the file's format");
			return;
		}
		resp.registered = true;
		resp.resourceName = newId;
		resp.guid = EMCP_WB_ResourcesUtil.GuidOf(newId);
		resp.status = "ok";
		resp.message = "registered " + clean;
	}

	//------------------------------------------------------------------------------------------------
	//! rebuild: RebuildResourceFile(abs, configuration, false) for one file, RebuildResourceFiles(abs
	//! list, configuration) for more (the BatchTextureProcessorPlugin call), then WaitForFile per file:
	//! acknowledged files in rebuilt, timed-out ones in pending. Every file must be an existing,
	//! registered file of the project (META_NOT_FOUND otherwise). The 1.x FileIO.FileExists check and
	//! its empty configuration are gone. Dry run unless confirm.
	static void Rebuild(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		if (EMCP_WB_ResourcesUtil.ProjectRefused(resp))
			return;
		string config = EMCP_WB_ResourcesUtil.ConfigurationOf(req.configuration, resp);
		if (config == "")
			return;
		int timeout = EMCP_WB_ResourcesUtil.TimeoutOf(req.timeoutMs, resp);
		if (timeout < 0)
			return;

		array<string> asked = {};
		if (req.path != "")
			asked.Insert(req.path);
		foreach (string listedPath : req.paths)
			asked.Insert(listedPath);
		if (asked.Count() == 0)
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "path or paths is required", "pass the project-relative file(s) to rebuild");
			return;
		}
		if (asked.Count() > EMCP_WB_ResourcesUtil.PATHS_MAX)
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", asked.Count().ToString() + " files; at most " + EMCP_WB_ResourcesUtil.PATHS_MAX.ToString(), "split the call");
			return;
		}

		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		array<string> absList = {};
		array<string> cleanList = {};
		foreach (string rel : asked)
		{
			string absolute = "";
			string clean = "";
			if (!EMCP_WB_ResourcesUtil.ExistingTarget(rel, resp, absolute, clean))
				return;
			if (EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute) == "")
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "META_NOT_FOUND", clean + " is not registered (no .meta); nothing was rebuilt", "wb_resources register first");
				return;
			}
			if (absList.Find(absolute) < 0)
			{
				absList.Insert(absolute);
				cleanList.Insert(clean);
			}
		}
		resp.count = absList.Count();

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would rebuild " + resp.count.ToString() + " files for " + config + "; nothing was rebuilt; pass confirm true to rebuild";
			return;
		}

		resp.dryRun = false;
		if (absList.Count() == 1)
			resourceManager.RebuildResourceFile(absList.Get(0), config, false);
		else
			resourceManager.RebuildResourceFiles(absList, config);
		// One budget of WAIT_MAX ms for the whole list, so 200 files cannot hold the NET thread for
		// 200 timeouts (review R1); a file past the budget is checked with a zero wait.
		int waitStart = System.GetTickCount();
		for (int i = 0; i < absList.Count(); i++)
		{
			int waitLeft = EMCP_WB_ResourcesUtil.WAIT_MAX - (System.GetTickCount() - waitStart);
			if (waitLeft < 0)
				waitLeft = 0;
			int waitMs = timeout;
			if (waitMs > waitLeft)
				waitMs = waitLeft;
			if (resourceManager.WaitForFile(absList.Get(i), waitMs))
				resp.rebuilt.Insert(cleanList.Get(i));
			else
				resp.pending.Insert(cleanList.Get(i));
		}
		resp.status = "ok";
		resp.message = "rebuild requested for " + resp.count.ToString() + " files (" + config + "); " + resp.rebuilt.Count().ToString() + " acknowledged, " + resp.pending.Count().ToString() + " pending (the rebuild calls are void: read the Workbench log for the result)";
	}

	//------------------------------------------------------------------------------------------------
	//! import: register (when no .meta exists), then each name=value setting written on the meta's
	//! configuration (default PC; every configuration with allPlatforms, the "Apply changes to all
	//! platforms" checkbox), MetaFile.Save, Release(false), then RebuildResourceFile + WaitForFile.
	//! Values go through EMCP_WB_Container.CheckText / WriteFromText (scalar types only); before and
	//! after answer "<configuration>:<name>=<value>". Every setting is checked before the first Set.
	//! Dry run unless confirm; the inverse is wb_meta set with before.
	static void Import(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		if (EMCP_WB_ResourcesUtil.ProjectRefused(resp))
			return;
		string absolute = "";
		string clean = "";
		if (!EMCP_WB_ResourcesUtil.ExistingTarget(req.path, resp, absolute, clean))
			return;
		string config = EMCP_WB_ResourcesUtil.ConfigurationOf(req.configuration, resp);
		if (config == "")
			return;

		array<string> varNames = {};
		array<string> varValues = {};
		foreach (string setting : req.settings)
		{
			int eq = setting.IndexOf("=");
			if (eq < 1)
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "a setting must be name=value, got '" + setting + "'", "pass settings as name=value");
				return;
			}
			varNames.Insert(setting.Substring(0, eq));
			varValues.Insert(setting.Substring(eq + 1, setting.Length() - eq - 1));
		}

		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		MetaFile meta = resourceManager.GetMetaFile(absolute);
		bool registeredNow = false;
		if (!meta)
		{
			if (!req.confirm)
			{
				for (int p = 0; p < varNames.Count(); p++)
					resp.after.Insert(config + ":" + varNames.Get(p) + "=" + varValues.Get(p));
				resp.dryRun = true;
				resp.status = "ok";
				resp.message = "dry run: would register " + clean + " (no .meta yet), then set " + varNames.Count().ToString() + " settings and rebuild; the names are checked once the .meta exists; nothing was written";
				return;
			}
			bool done = resourceManager.RegisterResourceFile(absolute, false);
			meta = resourceManager.GetMetaFile(absolute);
			if (!done || !meta)
			{
				EMCP_WB_ResourcesUtil.EngineFalse(resp, "RegisterResourceFile returned " + done.ToString() + " for " + clean + " and no .meta was found", "read the Workbench log; check the file's format");
				if (meta)
					meta.Release(false);
				return;
			}
			registeredNow = true;
			resp.registered = true;
		}

		string metaId = meta.GetResourceID();
		resp.resourceName = metaId;
		resp.guid = EMCP_WB_ResourcesUtil.GuidOf(metaId);
		bool applied = ApplySettings(req, resp, meta, config, varNames, varValues, registeredNow);
		bool doWrite = applied && req.confirm;
		if (doWrite)
			meta.Save();
		meta.Release(false);
		if (!doWrite)
			return;

		resp.dryRun = false;
		string rebuildConfig = config;
		if (req.allPlatforms)
			rebuildConfig = EMCP_WB_ResourcesUtil.DEFAULT_CONFIGURATION;
		resourceManager.RebuildResourceFile(absolute, rebuildConfig, false);
		int timeout = EMCP_WB_ResourcesUtil.WAIT_DEFAULT;
		if (resourceManager.WaitForFile(absolute, timeout))
			resp.rebuilt.Insert(clean);
		resp.status = "ok";
		resp.message = "imported " + clean + ": " + varNames.Count().ToString() + " settings saved, rebuild requested (" + rebuildConfig + ")";
		if (registeredNow)
			resp.message = "registered and " + resp.message;
		if (resp.rebuilt.Count() == 0)
			resp.message = resp.message + "; the rebuild was not acknowledged within " + timeout.ToString() + " ms";
	}

	//------------------------------------------------------------------------------------------------
	//! The tail of an import refusal: what was written before the settings were checked. A file with no
	//! .meta is registered before its setting names can be read (review round 1, F1), so a refusal
	//! after that must not say nothing was written.
	static string Unwritten(bool registeredNow)
	{
		if (registeredNow)
			return "; no setting was written, but the file was registered (its .meta now exists)";
		return "; nothing was written";
	}

	//------------------------------------------------------------------------------------------------
	//! import's write on a meta the caller holds (and releases): the configurations, the check of
	//! every setting, before, the dry-run answer, or the Sets and after. True when the caller saves
	//! (confirm) or the dry run answered; false with the response refused or failed.
	static bool ApplySettings(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp, MetaFile meta, string config, array<string> varNames, array<string> varValues, bool registeredNow)
	{
		BaseContainerList configs = meta.GetObjectArray(EMCP_WB_ResourcesUtil.CONFIGURATIONS);
		if (!configs || configs.Count() == 0)
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "UNSUPPORTED_TYPE", "the .meta has no Configurations entry" + Unwritten(registeredNow), "import resources whose .meta has platform configurations");
			return false;
		}
		bool everyConfig = req.allPlatforms;
		array<BaseContainer> chosen = {};
		string configNames = "";
		for (int i = 0; i < configs.Count(); i++)
		{
			BaseContainer conf = configs.Get(i);
			if (!conf)
				continue;
			if (configNames != "")
				configNames += ",";
			configNames += conf.GetName();
			if (everyConfig || conf.GetName() == config)
				chosen.Insert(conf);
		}
		if (chosen.Count() == 0)
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "the .meta has no configuration " + config + " (it has " + configNames + ")" + Unwritten(registeredNow), "pass one of its configurations, or allPlatforms true");
			return false;
		}

		array<BaseContainer> writeConfs = {};
		array<string> writeNames = {};
		array<string> writeValues = {};
		foreach (BaseContainer target : chosen)
		{
			string confName = target.GetName();
			for (int s = 0; s < varNames.Count(); s++)
			{
				string varName = varNames.Get(s);
				string text = varValues.Get(s);
				int varIndex = target.GetVarIndex(varName);
				if (varIndex < 0)
				{
					EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "configuration " + confName + " has no variable " + varName + Unwritten(registeredNow), "read the names with wb_meta vars");
					return false;
				}
				DataVarType varType = target.GetDataVarType(varIndex);
				if (!EMCP_WB_Container.IsScalar(varType))
				{
					EMCP_WB_ResourcesUtil.Refuse(resp, "UNSUPPORTED_TYPE", varName + " is not a scalar, integer, boolean, string or resource-name variable" + Unwritten(registeredNow), "set it with wb_meta");
					return false;
				}
				// An enum variable takes its entry's name as wb_meta set does (W2 run 1: "ColorSpace=ToLinear").
				if (varType == DataVarType.INTEGER)
				{
					string number = "";
					if (!EMCP_WB_Meta.IntegerText(target, varIndex, text, number))
					{
						EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", varName + ": value is not an integer nor one of the variable's enum names: " + text + Unwritten(registeredNow), "wb_meta vars shows the enum column");
						return false;
					}
					text = number;
				}
				string why = "";
				if (!EMCP_WB_Container.CheckText(varType, text, why))
				{
					EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", varName + ": " + why + Unwritten(registeredNow), "pass a value of the variable's type");
					return false;
				}
				resp.before.Insert(confName + ":" + varName + "=" + EMCP_WB_Container.ReadAsText(target, varName, varType));
				writeConfs.Insert(target);
				writeNames.Insert(varName);
				writeValues.Insert(text);
			}
		}

		if (!req.confirm)
		{
			for (int d = 0; d < writeConfs.Count(); d++)
				resp.after.Insert(writeConfs.Get(d).GetName() + ":" + writeNames.Get(d) + "=" + writeValues.Get(d));
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would set " + writeConfs.Count().ToString() + " values and rebuild; nothing was written; pass confirm true to import";
			return true;
		}

		string failed = "";
		for (int w = 0; w < writeConfs.Count(); w++)
		{
			BaseContainer writeConf = writeConfs.Get(w);
			string writeName = writeNames.Get(w);
			DataVarType writeType = writeConf.GetDataVarType(writeConf.GetVarIndex(writeName));
			string writeWhy = "";
			if (!EMCP_WB_Container.WriteFromText(writeConf, writeName, writeType, writeValues.Get(w), writeWhy))
				failed += " " + writeConf.GetName() + ":" + writeName;
			resp.after.Insert(writeConf.GetName() + ":" + writeName + "=" + EMCP_WB_Container.ReadAsText(writeConf, writeName, writeType));
		}
		if (failed != "")
		{
			string registeredNote = "";
			if (registeredNow)
				registeredNote = " (the file was registered)";
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "Set returned false for" + failed + "; the .meta was not saved" + registeredNote, "read before and after; check the values");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! create: a new container file of the project. CreateContainer(className), GetResource,
	//! ToBaseContainer, optional SetAncestor(inherit) (P-W2-12), SaveContainer with the project-relative
	//! path (the form that wrote new files in S-E, DEC-044), then RegisterResourceFile and GetMetaFile
	//! for the resource name. .conf, .emat and .layout only (P-W2-11 decides .layout). The path must be
	//! new and its folder must exist (NewTargetInProject); dry run unless confirm.
	static void Create(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		if (EMCP_WB_ResourcesUtil.ProjectRefused(resp))
			return;
		string absolute = "";
		string clean = "";
		if (!EMCP_WB_ResourcesUtil.NewTarget(req.path, ".conf,.emat,.layout", resp, absolute, clean))
			return;
		string rootClass = req.className;
		if (!EMCP_WB_ResourcesUtil.IsIdentifier(rootClass))
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "className must be a class name, got '" + rootClass + "'", "pass the root class, e.g. MatPBRBasic");
			return;
		}
		string ancestor = req.inherit;
		if (ancestor != "")
		{
			if (EMCP_WB_ResourcesUtil.GuidOf(ancestor) == "")
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "inherit must be a resource name {GUID}path, got '" + ancestor + "'", "pass the ancestor's resource name (wb_resources resolve)");
				return;
			}
			if (!EMCP_WB_ResourcesUtil.ResourceExists(ancestor))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "PATH_NOT_FOUND", "the ancestor does not resolve (no loose file, and the resource database does not know its GUID with that path): " + ancestor, "pass the ancestor's resource name (wb_resources resolve)");
				return;
			}
		}
		resp.savedPath = clean;
		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would write a new " + rootClass + " at " + clean + " and register it; nothing was written; pass confirm true to create";
			return;
		}

		resp.dryRun = false;
		Resource created = BaseContainerTools.CreateContainer(rootClass);
		BaseContainer cont = null;
		if (created && created.IsValid())
		{
			BaseResourceObject createdObject = created.GetResource();
			if (createdObject)
				cont = createdObject.ToBaseContainer();
		}
		if (!cont)
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "CreateContainer gave no container of class " + rootClass + "; nothing was written", "check the class name");
			return;
		}
		if (ancestor != "")
		{
			ResourceName ancestorName = ancestor;
			cont.SetAncestor(ancestorName);
		}
		ResourceName noResourceName = "";
		resp.saved = BaseContainerTools.SaveContainer(cont, noResourceName, clean);
		if (!resp.saved)
		{
			resp.status = "error";
			resp.code = "SAVE_FAILED";
			resp.next = "check that the file's folder exists";
			resp.message = EMCP_WB_Guard.RefusalMessage("SAVE_FAILED", "SaveContainer returned false; nothing was written", resp.next);
			return;
		}

		bool done = resourceManager.RegisterResourceFile(absolute, false);
		string newId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute);
		if (!done || newId == "")
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "the file was written but RegisterResourceFile returned " + done.ToString() + " and no .meta was found", "wb_resources register " + clean);
			return;
		}
		resp.resourceName = newId;
		resp.guid = EMCP_WB_ResourcesUtil.GuidOf(newId);
		resp.status = "ok";
		resp.message = "created and registered " + clean;
	}

	//------------------------------------------------------------------------------------------------
	//! prefabFromModel: a new project .et with a MeshObject showing the model. In one entity action:
	//! CreateEntity(GenericEntity, or the inherit prefab) in the current layer, its MeshObject
	//! (EMCP_WB_ResourcesUtil.MeshComponent), SetVariableValue(MeshObject.Object = xobPath),
	//! CreateEntityTemplate of the entity to the new file, DeleteEntity of the entity. The calls of
	//! SCR_PrefabHelper.CreateEntitySourceFromXOB + SaveEntitySourceAsPrefab without their file methods
	//! (OD-5); the order is wb_prefabs createChild's (template, then delete), which ran live in W1. Needs
	//! a loaded world in edit mode (NO_WORLD, WRONG_MODE); dry run unless confirm.
	static void PrefabFromModel(EMCP_WB_ResourcesRequest req, EMCP_WB_ResourcesResponse resp)
	{
		if (EMCP_WB_ResourcesUtil.ProjectRefused(resp))
			return;
		string model = req.xobPath;
		if (!EMCP_WB_ResourcesUtil.IsResourceNameOf(model, EMCP_WB_ResourcesUtil.MODEL_EXT))
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "xobPath must be a resource name {GUID}path.xob, got '" + model + "'", "pass the model's resource name (wb_resources search extensions=[xob])");
			return;
		}
		if (!EMCP_WB_ResourcesUtil.ResourceExists(model))
		{
			EMCP_WB_ResourcesUtil.Refuse(resp, "PATH_NOT_FOUND", "the model's file does not resolve: " + model, "pass the model's resource name (wb_resources resolve)");
			return;
		}
		string parentPrefab = req.inherit;
		if (parentPrefab != "")
		{
			if (!EMCP_WB_ResourcesUtil.IsResourceNameOf(parentPrefab, EMCP_WB_ResourcesUtil.PREFAB_EXT))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "INVALID_ARGUMENT", "inherit must be a prefab resource name {GUID}path.et, got '" + parentPrefab + "'", "pass the parent prefab's resource name");
				return;
			}
			if (!EMCP_WB_ResourcesUtil.ResourceExists(parentPrefab))
			{
				EMCP_WB_ResourcesUtil.Refuse(resp, "PATH_NOT_FOUND", "the parent prefab's file does not resolve: " + parentPrefab, "pass the parent prefab's resource name (wb_resources resolve)");
				return;
			}
		}
		string absolute = "";
		string clean = "";
		if (!EMCP_WB_ResourcesUtil.NewTarget(req.path, EMCP_WB_ResourcesUtil.PREFAB_EXT, resp, absolute, clean))
			return;
		resp.savedPath = clean;

		WorldEditorAPI api = EMCP_WB_ResourcesUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_ResourcesUtil.PlayRefused(api, resp))
			return;

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would write a new prefab at " + clean + " showing " + model + "; nothing was written; pass confirm true to write";
			return;
		}

		resp.dryRun = false;
		string entityClass = EMCP_WB_ResourcesUtil.ROOT_ENTITY_CLASS;
		if (parentPrefab != "")
			entityClass = parentPrefab;
		string undo = EMCP_WB_ResourcesUtil.UNDO_PREFIX + "prefabFromModel";
		if (!EMCP_WB_ResourcesUtil.BeginEdit(api, undo, resp))
			return;
		IEntitySource instance = api.CreateEntity(entityClass, "", api.GetCurrentEntityLayerId(), null, vector.Zero, vector.Zero);
		if (!instance)
		{
			api.EndEntityAction();
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "CreateEntity returned null for " + entityClass, "check that the current layer is not locked");
			return;
		}
		string failure = "";
		IEntityComponentSource mesh = EMCP_WB_ResourcesUtil.MeshComponent(api, instance);
		if (!mesh)
			failure = "CreateComponent returned null for " + EMCP_WB_ResourcesUtil.MESH_COMPONENT;
		if (failure == "")
		{
			array<ref ContainerIdPathEntry> meshPath = {};
			meshPath.Insert(new ContainerIdPathEntry(EMCP_WB_ResourcesUtil.MESH_COMPONENT));
			if (!api.SetVariableValue(instance, meshPath, EMCP_WB_ResourcesUtil.MESH_VARIABLE, model))
				failure = "SetVariableValue returned false for MeshObject.Object";
		}
		bool written = false;
		if (failure == "")
		{
			written = api.CreateEntityTemplate(instance, absolute);
			if (!written)
				failure = "CreateEntityTemplate returned false";
		}
		bool deleted = api.DeleteEntity(instance);
		api.EndEntityAction();

		resp.saved = written;
		if (failure != "")
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, failure + " (temporary entity deleted " + deleted.ToString() + ")", "read the Workbench log; check the model and the layer");
			return;
		}
		ResourceManager resourceManager = EMCP_WB_ResourcesUtil.Rm(resp);
		if (!resourceManager)
			return;
		string newId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute);
		resp.resourceName = newId;
		resp.guid = EMCP_WB_ResourcesUtil.GuidOf(newId);
		if (!deleted)
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "the prefab was written but DeleteEntity of the temporary entity returned false; it stays at 0 0 0", "wb_undo_redo undo, or delete the entity");
			return;
		}
		if (newId == "")
		{
			EMCP_WB_ResourcesUtil.EngineFalse(resp, "the prefab was written but no .meta was found", "wb_resources register " + clean);
			return;
		}
		resp.status = "ok";
		resp.message = "prefab written at " + clean;
	}
}
