/**
 * EMCP_WB_Container.c - BaseContainer reads and writes of one resource (DEC-048 package 3.3, Container unit)
 *
 * Targets (phase3-tool-surface.md section 3):
 *   path:<project-relative resource>  BaseContainerTools.LoadContainer of that path, the call of the
 *                                     read-only pack's loadContainer (ECEN_ProbeContainers.c); U16:
 *                                     .conf .emat .layout .agr .bt .ptc .acp load (DEC-042) and the
 *                                     project-relative path loads a loose project file (U11, DEC-044).
 *                                     A world file (.ent) is never loaded by path.
 *   open:WorldEditor                  GetContainer(0) of the World Editor module, the containerDump call;
 *                                     the only module container that is usable (U8 read, DEC-042).
 *   entity:<ref>                      the IEntitySource of one World Editor entity (EMCP_WB_EntityRef:
 *                                     id:<hex>, name:<name>, index:<i>); wave W1, phase5-w1-spec.md 2.2.
 *   open:ResourceManager              GetContainer(0) of the Resource Manager module: the resource open in
 *                                     one of its tabs (wave W2, phase5-w2-spec.md 2.4; probe P-W2-14 says
 *                                     whether index 0 is the active tab). describe, get, set and save;
 *                                     set and save write through WBModuleDef.Save, guarded by the opened
 *                                     resource's own path (GetResourceName().GetPath(), then
 *                                     TargetExistsInProject; probe P-W2-15). The other writes refuse
 *                                     UNPROVEN. GetModule opens a closed module (DEC-053).
 *   open:AnimEditor, open:BehaviorEditor, open:ProcAnimEditor
 *                                     GetContainer(0) of that editor, by the open:ResourceManager rule
 *                                     (wave W4, phase5-w4-spec.md 2.3, DEC-067): a write needs exactly
 *                                     one open document and its guard path is that document's own
 *                                     (GetResourceName). Each target refuses GATED, before any engine
 *                                     call, until probes P-W4-10 and P-W4-29 pass for that editor
 *                                     (EMCP_WB_ContainerTarget.EditorGate): a module container read
 *                                     crashed the Workbench in the Particle Editor (DEC-042); the
 *                                     ProcAnimEditor read is the crash hazard the spec names.
 *   class:<Name>                     a fresh container of that class (BaseContainerTools.CreateContainer),
 *                                     read only and never saved: every write refuses WRONG_MODE (W2 2.4,
 *                                     OD-10, the L08 schema walk).
 * describe with fields naming "schema" adds three columns, widget, limits and enumValues
 * (GetUIWidget, GetLimits, GetEnumValues); get answers the same three for a variable (W2 2.4).
 * A path segment "name[i]" takes an index, "name[Class]" the first element of that class
 * (components[SCR_Foo] is the U13 fix: the class resolves to its index in the array).
 * Actions: describe (the probe's schema walk, summary or one page), get (one dotted path, with the
 * set flags and the default), set (a scalar, through the mutating pack's WriteFromText), save
 * (SaveContainer with the project-relative path, the form that wrote 10 of 10 in S-E, U16 write,
 * DEC-044), and the W1 writes clear, arrayAdd, arrayRemove, arrayMove, setClass.
 * Guards (spec 2.2, DEC-058): every mutating action refuses unless the handlers are found installed
 * in the open project (NOT_IN_PROJECT). A path: write goes only to an existing file inside that
 * project's folder (TargetExistsInProject) and writes nothing without confirm (a dry run answers the
 * change it would make), then SaveContainer. An entity: write is an in-memory World Editor edit:
 * refused in play mode (WRONG_MODE), wrapped in BeginEntityAction/EndEntityAction under an undo name,
 * no confirm (DEC-061 OD-3: undo is the safety). The open:WorldEditor target is refused for every
 * write (no write into that container was ever made). arrayMove on an entity: target refuses with
 * UNPROVEN: the spec's call, SetObjectVariableMember/4, sets an object property and its doc gives no
 * way to name an array slot (probe P-W1-22 decides). Path writes other than set and save wait on
 * probe P-W1-21 (does the save keep unrelated keys) on the live train.
 * A world made by CreateWorld is unregistered until RegisterResourceFile (DEC-045); this handler
 * neither creates nor registers a resource.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Container"
 */

class EMCP_WB_ContainerRequest : JsonApiStruct
{
	string action;
	//! path:<project-relative resource>, open:WorldEditor, open:ResourceManager, open:AnimEditor,
	//! open:BehaviorEditor, open:ProcAnimEditor, entity:<ref> or class:<Name>
	string target;
	//! dotted path with one index or class per segment: components[2].MeshObject.Object
	string path;
	//! set: the new value as text
	string value;
	//! set: true when the empty value is meant (a key left out also reads as "")
	bool emptyValue;
	//! describe: summary (default) or page
	string mode;
	//! describe page: the row offset the previous page answered in nextCursor
	string cursor;
	int limit;
	//! describe: the column filter, applied by the client; a comma-separated token "schema" makes the
	//! handler add the widget, limits and enumValues columns (W2 2.4)
	string fields;
	//! path: writes: true writes, anything else is a dry run; entity: writes do not read it (undo)
	bool confirm;
	//! arrayAdd: insert position (-1, the default, appends); arrayRemove, arrayMove: the element
	int index;
	//! arrayMove: the element's position after the move
	int toIndex;
	//! arrayAdd, setClass: the class of the new object; "class" is a keyword in Enforce
	string className;

	void EMCP_WB_ContainerRequest()
	{
		RegV("action");
		RegV("target");
		RegV("path");
		RegV("value");
		RegV("emptyValue");
		RegV("mode");
		RegV("cursor");
		RegV("limit");
		// fields: the client filters the columns (review C2); the handler reads only its "schema" token (W2 2.4).
		RegV("fields");
		RegV("confirm");
		RegV("index");
		RegV("toIndex");
		RegV("className");

		// Defaults for keys the request leaves out.
		index = -1;
		toIndex = -1;
	}
}

class EMCP_WB_ContainerResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	string target;
	string rootClass;
	int total;
	bool capped;
	string nextCursor;
	string columns;
	ref array<string> rows;
	ref array<string> typeCounts;
	int setCount;
	int defaultCount;
	ref array<string> children;
	ref array<string> topSet;
	ref array<string> siblings;
	string varType;
	string objectClass;
	string value;
	string before;
	string after;
	bool written;
	bool saved;
	string savedPath;
	bool dryRun;
	//! GetSourceAddons of a by-path write target, comma-joined (set and save, refused or not)
	string sourceAddons;
	//! get: IsVariableSet, IsVariableSetDirectly and GetDefaultAsString of the variable; clear: isSet after
	bool isSet;
	bool isSetDirectly;
	string defaultValue;
	//! entity: writes: the BeginEntityAction history point name (wb_undo_redo reverts it)
	string undoName;
	//! array writes: the element count after (proposed after, for a dry run)
	int count;
	//! get: GetUIWidget of the variable; "" when none
	string widget;
	//! get: GetLimits of a scalar or integer variable as "min,max,step" (the values the engine read)
	string limits;
	//! get: GetEnumValues of an integer variable, one "name=value" per entry
	ref array<string> enumValues;

	void EMCP_WB_ContainerResponse()
	{
		rows = {};
		typeCounts = {};
		children = {};
		topSet = {};
		siblings = {};
		enumValues = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("target");
		RegV("rootClass");
		RegV("total");
		RegV("capped");
		RegV("nextCursor");
		RegV("columns");
		RegV("rows");
		RegV("typeCounts");
		RegV("setCount");
		RegV("defaultCount");
		RegV("children");
		RegV("topSet");
		RegV("siblings");
		RegV("varType");
		RegV("objectClass");
		RegV("value");
		RegV("before");
		RegV("after");
		RegV("written");
		RegV("saved");
		RegV("savedPath");
		RegV("dryRun");
		RegV("sourceAddons");
		RegV("isSet");
		RegV("isSetDirectly");
		RegV("defaultValue");
		RegV("undoName");
		RegV("count");
		RegV("widget");
		RegV("limits");
		RegV("enumValues");
	}
}

//! The container a target names, with the Resource that keeps a loaded one alive.
class EMCP_WB_ContainerTarget
{
	ref Resource m_Holder;
	BaseContainer m_Root;
	//! The clean project-relative path of a path: target, or of the resource open:ResourceManager
	//! holds ("" when its name gives none); "" for open:WorldEditor, entity:<ref> and class:<Name>.
	string m_Rel;
	bool m_IsWorld;
	//! entity:<ref>: m_Root is the entity source and m_Api the World Editor API that holds it.
	bool m_IsEntity;
	WorldEditorAPI m_Api;
	//! open:ResourceManager and the open:<editor> targets: m_Root is GetContainer(0) of m_Module.
	bool m_IsModule;
	WBModuleDef m_Module;
	//! The module of a module target (ResourceManager, AnimEditor, BehaviorEditor, ProcAnimEditor).
	string m_ModuleName;
	//! A module target: GetNumContainers when the target was opened.
	int m_ModuleCount;
	//! class:<Name>: m_Root is a fresh container that m_Holder keeps alive; never written.
	bool m_IsClass;
	string m_Code;
	string m_Why;

	//! Live gates of the W4 editor targets (phase5-w4-spec.md 2.3, DEC-067): each stays false until
	//! probes P-W4-10 (GetContainer(0) and GetResourceName in that editor) and P-W4-29 (reads and a
	//! set with Edit > Undo) pass on the live train; the main session sets it.
	static const bool EDITOR_OPEN_ANIM = false;
	static const bool EDITOR_OPEN_BEHAVIOR = false;
	static const bool EDITOR_OPEN_PROCANIM = false;
	static const string GATED = "GATED";
	static const string GATED_NEXT = "waits for the W4 live train; the main session opens it when the probe passes";

	//------------------------------------------------------------------------------------------------
	//! True for open:AnimEditor, open:BehaviorEditor and open:ProcAnimEditor.
	static bool IsEditorTarget(string target)
	{
		return target == "open:AnimEditor" || target == "open:BehaviorEditor" || target == "open:ProcAnimEditor";
	}

	//------------------------------------------------------------------------------------------------
	//! True for a module document target: open:ResourceManager or one of the three editor targets.
	static bool IsModuleTarget(string target)
	{
		return target == "open:ResourceManager" || IsEditorTarget(target);
	}

	//------------------------------------------------------------------------------------------------
	//! "" when an editor target may be read; the GATED reason otherwise (also "" for any other target).
	static string EditorGate(string target)
	{
		if (!IsEditorTarget(target))
			return "";
		if (target == "open:AnimEditor" && EDITOR_OPEN_ANIM)
			return "";
		if (target == "open:BehaviorEditor" && EDITOR_OPEN_BEHAVIOR)
			return "";
		if (target == "open:ProcAnimEditor" && EDITOR_OPEN_PROCANIM)
			return "";
		return target + " waits for probes P-W4-10 and P-W4-29 (a module container read crashed the Workbench in the Particle Editor, DEC-042); nothing was read or written";
	}

	//------------------------------------------------------------------------------------------------
	//! Resolves the target; false with m_Code and m_Why set otherwise. open:WorldEditor, the module
	//! targets and entity:<ref> call GetModule, which opens a closed module (DEC-053).
	bool Open(string target)
	{
		if (target == "open:WorldEditor")
			return OpenWorld();
		if (target == "open:ResourceManager")
			return OpenDocumentIn("ResourceManager");
		if (IsEditorTarget(target))
		{
			string gateWhy = EditorGate(target);
			if (gateWhy != "")
			{
				m_Code = GATED;
				m_Why = gateWhy;
				return false;
			}
			return OpenDocumentIn(target.Substring(5, target.Length() - 5));
		}
		if (target.StartsWith("entity:"))
			return OpenEntity(target.Substring(7, target.Length() - 7));
		if (target.StartsWith("class:"))
			return OpenClass(target.Substring(6, target.Length() - 6));
		if (!target.StartsWith("path:"))
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "target must be path:<project-relative resource>, open:WorldEditor, open:ResourceManager, open:AnimEditor, open:BehaviorEditor, open:ProcAnimEditor, entity:<ref> or class:<Name>, got '" + target + "'";
			return false;
		}

		string rel = target.Substring(5, target.Length() - 5);
		string clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(rel, clean, why))
		{
			m_Code = "ABSOLUTE_PATH";
			m_Why = why;
			return false;
		}
		// A world file is never loaded: its load is unbounded and would run on the NET thread
		// (the read-only pack's refusal, ECEN_ProbeContainers.c).
		string lowerPath = clean;
		lowerPath.ToLower();
		if (lowerPath.EndsWith(".ent"))
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "a world file (.ent) is never loaded by path; load it in the World Editor and use open:WorldEditor";
			return false;
		}

		ResourceName resourceName = clean;
		m_Holder = BaseContainerTools.LoadContainer(resourceName);
		if (!m_Holder || !m_Holder.IsValid())
		{
			m_Code = "PATH_NOT_FOUND";
			m_Why = "LoadContainer found no valid resource at " + clean;
			return false;
		}
		BaseResourceObject resourceObject = m_Holder.GetResource();
		if (!resourceObject)
		{
			m_Code = "PATH_NOT_FOUND";
			m_Why = "GetResource returned null for " + clean;
			return false;
		}
		m_Root = resourceObject.ToBaseContainer();
		if (!m_Root)
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "the resource is not a BaseContainer: " + clean;
			return false;
		}
		m_Rel = clean;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! GetContainer(0) of the World Editor module (the probe's containerDump call).
	protected bool OpenWorld()
	{
		m_IsWorld = true;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead("WorldEditor");
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			m_Code = "MODULE_NOT_OPEN";
			m_Why = "the World Editor module is not open: GetModule returned null";
			return false;
		}
		int count = wbModule.GetNumContainers();
		if (count < 1)
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "the World Editor holds no container (no world loaded)";
			return false;
		}
		m_Root = wbModule.GetContainer(0);
		if (!m_Root)
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "GetContainer(0) of the World Editor returned null";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The entity source an entity reference names (EMCP_WB_EntityRef.Resolve), through the World
	//! Editor API the 1.x entity handlers use (Workbench.GetModule(WorldEditor).GetApi()).
	protected bool OpenEntity(string entityRef)
	{
		m_IsEntity = true;
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			m_Code = "MODULE_NOT_OPEN";
			m_Why = "the World Editor module is not open: GetModule returned null";
			return false;
		}
		m_Api = worldEditor.GetApi();
		if (!m_Api)
		{
			m_Code = "NO_WORLD";
			m_Why = "the World Editor has no API (no world loaded)";
			return false;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, m_Api);
		if (noWorld != "")
		{
			m_Code = "NO_WORLD";
			m_Why = noWorld;
			return false;
		}
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(m_Api, entityRef, resolved))
		{
			m_Code = resolved.m_Code;
			m_Why = resolved.m_Why;
			return false;
		}
		IEntitySource entSrc = resolved.m_Src;
		m_Root = entSrc;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! GetContainer(0) of a module that holds an opened document: the Resource Manager (W2 2.4,
	//! probe P-W2-14) or, once their gate is open, AnimEditor, BehaviorEditor and ProcAnimEditor (W4
	//! spec 2.3), after GetNumContainers says it holds one; m_Rel is the opened resource's own path
	//! when its name gives a clean relative one (the write guard's input, probe P-W2-15), "" otherwise.
	protected bool OpenDocumentIn(string moduleName)
	{
		m_IsModule = true;
		m_ModuleName = moduleName;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(moduleName);
		if (!moduleType)
		{
			m_Code = "MODULE_NOT_SUPPORTED";
			m_Why = moduleName + " is not a module whose document this handler reads";
			return false;
		}
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			m_Code = "MODULE_NOT_OPEN";
			m_Why = "the " + moduleName + " module is not open: GetModule returned null";
			return false;
		}
		int count = wbModule.GetNumContainers();
		m_ModuleCount = count;
		if (count < 1)
		{
			m_Code = "NO_OPEN_RESOURCE";
			m_Why = "the " + moduleName + " module holds no opened resource (GetNumContainers is 0)";
			return false;
		}
		m_Root = wbModule.GetContainer(0);
		if (!m_Root)
		{
			// W2 run 3: with no resource open GetNumContainers was not 0 and GetContainer(0) null; it
			// stayed refused after a .conf open and held a container once a .emat was open (P-W2-14).
			m_Code = "NO_OPEN_RESOURCE";
			m_Why = "GetContainer(0) of the " + moduleName + " module returned null (GetNumContainers " + count.ToString() + "; P-W2-14: only an editor that holds a container, such as the Material Editor for a .emat, exposes one)";
			return false;
		}
		m_Module = wbModule;
		ResourceName opened = m_Root.GetResourceName();
		string openedPath = opened.GetPath();
		string clean = "";
		string why = "";
		if (openedPath != "" && EMCP_WB_Guard.CleanRelative(openedPath, clean, why))
			m_Rel = clean;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True for a script class name: a letter or an underscore, then letters, digits and underscores.
	//! Anything else is refused before CreateContainer sees it.
	static bool IsClassName(string name)
	{
		int n = name.Length();
		if (n == 0 || n > 128)
			return false;
		for (int i = 0; i < n; i++)
		{
			int ascii = name.ToAscii(i);
			bool letter = (ascii >= 65 && ascii <= 90) || (ascii >= 97 && ascii <= 122) || ascii == 95;
			bool digit = ascii >= 48 && ascii <= 57;
			if (!letter && !digit)
				return false;
			if (i == 0 && digit)
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A fresh container of class className: CreateContainer, GetResource, ToBaseContainer (the calls
	//! arrayAdd and setClass make by path). Read only; m_Holder keeps it alive for the request.
	protected bool OpenClass(string className)
	{
		m_IsClass = true;
		if (!IsClassName(className))
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "class:<Name> takes a script class name (letters, digits, underscores), got '" + className + "'";
			return false;
		}
		m_Holder = BaseContainerTools.CreateContainer(className);
		if (!m_Holder || !m_Holder.IsValid())
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "CreateContainer gave no container of class " + className;
			return false;
		}
		BaseResourceObject createdObject = m_Holder.GetResource();
		if (!createdObject)
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "GetResource returned null for a container of class " + className;
			return false;
		}
		m_Root = createdObject.ToBaseContainer();
		if (!m_Root)
		{
			m_Code = "INVALID_ARGUMENT";
			m_Why = "the created resource is not a BaseContainer: " + className;
			return false;
		}
		return true;
	}
}

class EMCP_WB_Container : NetApiHandler
{
	//! Rows per page at most, and the default page (phase3-tool-surface.md section 3).
	static const int PAGE_ROWS = 200;
	static const int PAGE_DEFAULT = 100;
	//! Rows a walk collects before it stops; past it "capped" says so (ECEN_ProbeUtil.MAX_ROWS).
	static const int MAX_ROWS = 20000;
	//! Deepest object nesting the walk follows (ECEN_ProbeUtil.MAX_DEPTH).
	static const int MAX_DEPTH = 4;
	//! Columns of a row: the probe's dump columns with the current value in place of uiWidget.
	static const int COLUMNS = 8;
	static const string COLUMN_NAMES = "path,name,type,default,set,setDirectly,objectClass,value";
	//! Columns of a row when fields names "schema": the eight above, then widget, limits, enumValues.
	static const int SCHEMA_COLUMNS = 11;
	static const string SCHEMA_COLUMN_NAMES = "path,name,type,default,set,setDirectly,objectClass,value,widget,limits,enumValues";
	//! Enum entries a get or a schema cell lists at most.
	static const int MAX_ENUM = 64;
	//! Top-level set variable names a summary lists at most.
	static const int MAX_TOP_SET = 60;
	//! Child nodes (GetChild: a layout's widgets) a summary lists at most.
	static const int MAX_CHILD_NODES = 50;
	//! Sibling names a PATH_NOT_FOUND answer carries at most.
	static const int MAX_SIBLINGS = 5;
	static const string UNPROVEN_NEXT = "waits for train #2 gate 2";
	static const string WORLD_WRITE_UNPROVEN = "no write into the World Editor's container was ever made (U8 write, DEC-044); use wb_module save for the world";
	static const string ENTITY_MOVE_UNPROVEN = "arrayMove on an entity: SetObjectVariableMember/4 sets an object property and names no array slot; no proven call moves an entity's array element (probe P-W1-22)";
	static const string RM_WRITE_UNPROVEN = "on open:ResourceManager and the open:<editor> targets only set and save are specified (W2 2.4, W4 2.3); no clear, array or class write into a module's container was ever made";
	static const string CLASS_READ_ONLY = "class:<Name> is a read-only schema target: a fresh container that is never saved";
	//! The history point name of an entity: write is this prefix plus the action.
	static const string UNDO_PREFIX = "EMCP wb_container ";
	//! Element classes a before/after list names at most.
	static const int MAX_LISTED = 50;
	//! The rows of the last paged describe that has pages left, with its target and root class: a
	//! page asked with a cursor reads them instead of loading and walking the container again.
	//! Dropped at the last page and by set and save; a first page always walks.
	protected static ref array<string> s_WalkRows;
	protected static string s_WalkTarget;
	protected static string s_WalkRootClass;
	//! The kept walk carries the schema columns (a page reuses it only with the same fields).
	protected static bool s_WalkSchema;

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ContainerRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ContainerRequest req = EMCP_WB_ContainerRequest.Cast(request);
		EMCP_WB_ContainerResponse resp = new EMCP_WB_ContainerResponse();
		resp.columns = COLUMN_NAMES;
		if (!req)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "no request", "send action and target");
			return resp;
		}
		resp.action = req.action;
		resp.target = req.target;

		// W4 editor targets: GATED for every action, before any engine call, until their probes pass.
		string gateWhy = EMCP_WB_ContainerTarget.EditorGate(req.target);
		if (gateWhy != "")
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_ContainerTarget.GATED, gateWhy, EMCP_WB_ContainerTarget.GATED_NEXT);
			return resp;
		}

		if (req.action == "describe")
			Describe(req, resp);
		else if (req.action == "get")
			GetPath(req, resp);
		else if (req.action == "set")
			SetPath(req, resp);
		else if (req.action == "save")
			SaveTarget(req, resp);
		else if (req.action == "clear")
			ClearVar(req, resp);
		else if (req.action == "arrayAdd")
			ArrayAdd(req, resp);
		else if (req.action == "arrayRemove")
			ArrayRemove(req, resp);
		else if (req.action == "arrayMove")
			ArrayMove(req, resp);
		else if (req.action == "setClass")
			SetClass(req, resp);
		else
			Answer(resp, "error", "INVALID_ARGUMENT", "unknown action: " + req.action, "one of describe, get, set, clear, arrayAdd, arrayRemove, arrayMove, setClass, save");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message (the message in EMCP_WB_Guard.RefusalMessage form).
	protected static void Answer(EMCP_WB_ContainerResponse resp, string status, string code, string text, string nextStep)
	{
		resp.status = status;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, so EndEntityAction never closes an action this handler did
	//! not begin (review C1).
	protected static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_ContainerResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		resp.undoName = "";
		Answer(resp, EMCP_WB_Guard.REFUSED, "ENGINE_FALSE", "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	protected static void Unproven(EMCP_WB_ContainerResponse resp, string why)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, "UNPROVEN", why + "; nothing was changed", UNPROVEN_NEXT);
	}

	//------------------------------------------------------------------------------------------------
	//! A write to a class:<Name> target: refused WRONG_MODE (W2 2.4), nothing created or saved.
	protected static void ClassRefused(EMCP_WB_ContainerResponse resp)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, "WRONG_MODE", CLASS_READ_ONLY + "; nothing was changed", "write a file with target path:<rel>");
	}

	//------------------------------------------------------------------------------------------------
	//! WBModuleDef.Save of the module a module target (open:ResourceManager, open:<editor>) holds,
	//! after a confirmed set or save (W2 2.4, probe P-W2-15). False with SAVE_FAILED written.
	protected static bool ModuleSave(EMCP_WB_ContainerTarget t, EMCP_WB_ContainerResponse resp)
	{
		resp.savedPath = t.m_Rel;
		resp.saved = t.m_Module.Save();
		if (!resp.saved)
		{
			Answer(resp, "error", "SAVE_FAILED", "the " + t.m_ModuleName + " module's Save returned false; the opened resource may hold the change unsaved", "read the file back before any retry");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True (with the refusal written) when the project is not found: no loaded addon, or more than
	//! one, carries the handler set as loose files (DEC-058).
	protected static bool ProjectRefused(EMCP_WB_ContainerResponse resp)
	{
		if (EMCP_WB_Guard.IsProjectFound())
			return false;
		Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "ProjectRefused: mutating actions need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The guards of a write by path, in order: the project is found, the target is not the World
	//! Editor's container (UNPROVEN), the target is an existing file inside the project's folder
	//! (TargetExistsInProject, DEC-058). Each refusal's message starts with the deciding guard's name;
	//! resp.sourceAddons carries the GetSourceAddons list for information. True when the write may go ahead.
	protected static bool WriteAllowed(EMCP_WB_ContainerTarget t, EMCP_WB_ContainerResponse resp)
	{
		if (ProjectRefused(resp))
			return false;
		if (t.m_IsWorld)
		{
			Unproven(resp, WORLD_WRITE_UNPROVEN);
			return false;
		}
		if (t.m_IsClass)
		{
			ClassRefused(resp);
			return false;
		}
		// A module target (open:ResourceManager, open:<editor>): the guard's path is the opened
		// resource's own (probe P-W2-15).
		if (t.m_IsModule && t.m_Rel == "")
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "WriteAllowed: the opened resource's name (GetResourceName) gives no project-relative path; nothing was changed", "edit the file with target path:<rel>");
			return false;
		}
		// WBModuleDef.Save saves the module's document, and whether that is GetContainer(0) is
		// unproven (P-W2-14, P-W2-15): with more than one resource open the guarded path and the saved
		// file could differ, so a write needs exactly one (review C1).
		if (t.m_IsModule && t.m_ModuleCount != 1)
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, "UNPROVEN", "WriteAllowed: the " + t.m_ModuleName + " module holds " + t.m_ModuleCount.ToString() + " opened resources; which one Save writes is unproven (P-W2-14), so only a single opened resource is written; nothing was changed", "close the other resources' tabs, or edit the file with target path:<rel>");
			return false;
		}
		string absolute = "";
		string why = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(t.m_Rel, absolute, why))
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why + "; nothing was changed", "target a file of the open project");
			return false;
		}
		// Reported, not deciding: the list names the game beside the project for a mod's own config.
		string sourceAddons = "";
		EMCP_WB_Guard.SourceAddonsAreOnly(t.m_Root, EMCP_WB_Guard.ProjectId(), sourceAddons);
		resp.sourceAddons = sourceAddons;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A home folder replaced with %USERPROFILE%: EMCP_WB_Guard.ScrubHome, the one copy.
	static string ScrubHome(string value)
	{
		return EMCP_WB_Guard.ScrubHome(value);
	}

	//------------------------------------------------------------------------------------------------
	//! A container variable's current value as text for the scalar data types; "<type>" otherwise.
	//! ECEN_ProbeMutActions.ReadAsText, verbatim.
	static string ReadAsText(BaseContainer cont, string varName, DataVarType dataType)
	{
		if (dataType == DataVarType.SCALAR)
		{
			float floatValue;
			if (cont.Get(varName, floatValue))
				return floatValue.ToString();
			return "<unread>";
		}
		if (dataType == DataVarType.INTEGER)
		{
			int intValue;
			if (cont.Get(varName, intValue))
				return intValue.ToString();
			return "<unread>";
		}
		if (dataType == DataVarType.BOOLEAN)
		{
			bool boolValue;
			if (cont.Get(varName, boolValue))
				return boolValue.ToString();
			return "<unread>";
		}
		if (dataType == DataVarType.STRING)
		{
			string stringValue;
			if (cont.Get(varName, stringValue))
				return stringValue;
			return "<unread>";
		}
		if (dataType == DataVarType.RESOURCE_NAME)
		{
			ResourceName resourceValue;
			if (cont.Get(varName, resourceValue))
				return resourceValue;
			return "<unread>";
		}
		return "<" + typename.EnumToString(DataVarType, dataType) + ">";
	}

	//------------------------------------------------------------------------------------------------
	//! True for the data types ReadAsText and WriteFromText handle.
	static bool IsScalar(DataVarType dataType)
	{
		return dataType == DataVarType.SCALAR || dataType == DataVarType.INTEGER || dataType == DataVarType.BOOLEAN || dataType == DataVarType.STRING || dataType == DataVarType.RESOURCE_NAME;
	}

	//------------------------------------------------------------------------------------------------
	//! The read path's value text (describe's value cell, get's value): ReadAsText for the scalar
	//! types; "x y" / "x y z" for VECTOR2 / VECTOR3; the elements joined with "," for the scalar
	//! arrays (EMCP_WB_Localization's ReadText join); "" for any other type. The vector and the
	//! float / resource arrays are matched by type name, so no enum member is named that this mod
	//! has not compiled against. Read only: the set paths keep ReadAsText.
	static string ReadValueText(BaseContainer cont, string varName, DataVarType dataType)
	{
		if (IsScalar(dataType))
			return ReadAsText(cont, varName, dataType);
		string typeName = typename.EnumToString(DataVarType, dataType);
		if (typeName == "VECTOR2" || typeName == "VECTOR3")
		{
			vector vectorValue;
			if (!cont.Get(varName, vectorValue))
				return "<unread>";
			string vectorText = vectorValue[0].ToString() + " " + vectorValue[1].ToString();
			if (typeName == "VECTOR3")
				vectorText = vectorText + " " + vectorValue[2].ToString();
			return vectorText;
		}
		if (dataType == DataVarType.STRING_ARRAY)
		{
			array<string> stringList = {};
			if (!cont.Get(varName, stringList))
				return "<unread>";
			string joinedStrings = "";
			if (!stringList)
				return joinedStrings;
			for (int k = 0; k < stringList.Count(); k++)
			{
				if (k > 0)
					joinedStrings += ",";
				joinedStrings += stringList.Get(k);
			}
			return joinedStrings;
		}
		if (typeName == "RESOURCE_NAME_ARRAY")
		{
			array<ResourceName> resourceList = {};
			if (!cont.Get(varName, resourceList))
				return "<unread>";
			string joinedResources = "";
			if (!resourceList)
				return joinedResources;
			for (int r = 0; r < resourceList.Count(); r++)
			{
				if (r > 0)
					joinedResources += ",";
				joinedResources += resourceList.Get(r);
			}
			return joinedResources;
		}
		if (dataType == DataVarType.INTEGER_ARRAY)
		{
			array<int> intList = {};
			if (!cont.Get(varName, intList))
				return "<unread>";
			string joinedInts = "";
			if (!intList)
				return joinedInts;
			for (int i = 0; i < intList.Count(); i++)
			{
				if (i > 0)
					joinedInts += ",";
				joinedInts += intList.Get(i).ToString();
			}
			return joinedInts;
		}
		if (typeName == "SCALAR_ARRAY")
		{
			array<float> floatList = {};
			if (!cont.Get(varName, floatList))
				return "<unread>";
			string joinedFloats = "";
			if (!floatList)
				return joinedFloats;
			for (int f = 0; f < floatList.Count(); f++)
			{
				if (f > 0)
					joinedFloats += ",";
				joinedFloats += floatList.Get(f).ToString();
			}
			return joinedFloats;
		}
		if (dataType == DataVarType.BOOLEAN_ARRAY)
		{
			array<bool> boolList = {};
			if (!cont.Get(varName, boolList))
				return "<unread>";
			string joinedBools = "";
			if (!boolList)
				return joinedBools;
			for (int j = 0; j < boolList.Count(); j++)
			{
				if (j > 0)
					joinedBools += ",";
				joinedBools += boolList.Get(j).ToString();
			}
			return joinedBools;
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! GetLimits of a scalar or integer variable as "min,max,step", only the values the engine says
	//! it read (its return value); "" for any other type or when it read none (W2 2.4).
	static string LimitsText(BaseContainer cont, int varIndex, DataVarType dataType)
	{
		if (dataType != DataVarType.SCALAR && dataType != DataVarType.INTEGER)
			return "";
		float minValue = 0;
		float maxValue = 0;
		float stepValue = 0;
		int readCount = cont.GetLimits(varIndex, minValue, maxValue, stepValue);
		if (readCount <= 0)
			return "";
		string text = minValue.ToString();
		if (readCount >= 2)
			text = text + "," + maxValue.ToString();
		if (readCount >= 3)
			text = text + "," + stepValue.ToString();
		return text;
	}

	//------------------------------------------------------------------------------------------------
	//! GetEnumValues of an integer variable, one "name=value" per entry (at most MAX_ENUM), into
	//! pairs; nothing for any other type (W2 2.4).
	static void EnumPairs(BaseContainer cont, int varIndex, DataVarType dataType, array<string> pairs)
	{
		if (dataType != DataVarType.INTEGER)
			return;
		array<string> enumNames = {};
		array<int> enumNumbers = {};
		cont.GetEnumValues(varIndex, enumNames, enumNumbers);
		if (!enumNames || !enumNumbers)
			return;
		int n = enumNames.Count();
		for (int k = 0; k < n && k < MAX_ENUM; k++)
		{
			string numberText = "";
			if (k < enumNumbers.Count())
			{
				int number = enumNumbers.Get(k);
				numberText = number.ToString();
			}
			pairs.Insert(enumNames.Get(k) + "=" + numberText);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! Entries joined with "|" for one schema cell.
	static string JoinPairs(array<string> pairs)
	{
		string text = "";
		for (int k = 0; k < pairs.Count(); k++)
		{
			if (k > 0)
				text = text + "|";
			text = text + pairs.Get(k);
		}
		return text;
	}

	//------------------------------------------------------------------------------------------------
	//! True when fields holds the comma-separated token "schema" (describe's schema columns).
	static bool WantsSchema(string fields)
	{
		if (fields == "")
			return false;
		array<string> tokens = {};
		fields.Split(",", tokens, true);
		for (int k = 0; k < tokens.Count(); k++)
		{
			string token = tokens.Get(k);
			token = token.Trim();
			if (token == "schema")
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The text check of WriteFromText without the Set: what a dry run answers.
	static bool CheckText(DataVarType dataType, string text, out string why)
	{
		why = "";
		if (dataType == DataVarType.SCALAR)
		{
			float floatValue;
			if (EMCP_WB_Common.ParseFloat(text, floatValue))
				return true;
			why = "value is not a number: " + text;
			return false;
		}
		if (dataType == DataVarType.INTEGER)
		{
			int intValue;
			if (EMCP_WB_Common.ParseInt(text, intValue))
				return true;
			why = "value is not an integer: " + text;
			return false;
		}
		if (dataType == DataVarType.BOOLEAN)
		{
			if (text == "true" || text == "false")
				return true;
			why = "value must be true or false: " + text;
			return false;
		}
		if (dataType == DataVarType.STRING || dataType == DataVarType.RESOURCE_NAME)
			return true;
		why = "set writes scalar, integer, boolean, string and resource-name variables only";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets a scalar container variable from text, parsed strictly for its data type.
	//! ECEN_ProbeMutActions.WriteFromText, with the shipped EMCP_WB_Common parsers.
	static bool WriteFromText(BaseContainer cont, string varName, DataVarType dataType, string text, out string why)
	{
		why = "";
		if (dataType == DataVarType.SCALAR)
		{
			float floatValue;
			if (!EMCP_WB_Common.ParseFloat(text, floatValue))
			{
				why = "value is not a number: " + text;
				return false;
			}
			return cont.Set(varName, floatValue);
		}
		if (dataType == DataVarType.INTEGER)
		{
			int intValue;
			if (!EMCP_WB_Common.ParseInt(text, intValue))
			{
				why = "value is not an integer: " + text;
				return false;
			}
			return cont.Set(varName, intValue);
		}
		if (dataType == DataVarType.BOOLEAN)
		{
			if (text != "true" && text != "false")
			{
				why = "value must be true or false: " + text;
				return false;
			}
			bool boolValue = text == "true";
			return cont.Set(varName, boolValue);
		}
		if (dataType == DataVarType.STRING)
			return cont.Set(varName, text);
		if (dataType == DataVarType.RESOURCE_NAME)
		{
			ResourceName resourceValue = text;
			return cont.Set(varName, resourceValue);
		}
		why = "set writes scalar, integer, boolean, string and resource-name variables only";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! One path segment: "name", "name[index]" (one index) or "name[Class]" (className set, index -1:
	//! Resolve finds the element). False with the reason otherwise.
	static bool SplitSegment(string segment, out string name, out int index, out string className, out string why)
	{
		name = segment;
		index = -1;
		className = "";
		why = "";
		int open = segment.IndexOf("[");
		if (open < 0)
		{
			if (segment == "")
			{
				why = "empty path segment";
				return false;
			}
			return true;
		}
		if (open == 0 || !segment.EndsWith("]"))
		{
			why = "bad path segment: " + segment;
			return false;
		}
		name = segment.Substring(0, open);
		string digits = segment.Substring(open + 1, segment.Length() - open - 2);
		if (digits.Contains("[") || digits.Contains("]"))
		{
			why = "one index per segment: " + segment;
			return false;
		}
		// A class name starts with a letter or an underscore; anything else is read as an index.
		if (digits != "" && !digits.IsDigitAt(0) && !digits.StartsWith("-") && !digits.StartsWith("+") && !digits.Contains(" "))
		{
			className = digits;
			return true;
		}
		if (!EMCP_WB_Common.ParseInt(digits, index) || index < 0)
		{
			why = "the index is not a non-negative integer: " + segment;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Up to MAX_SIBLINGS variable names of cont, for a PATH_NOT_FOUND answer.
	protected static void Siblings(BaseContainer cont, EMCP_WB_ContainerResponse resp)
	{
		int varCount = cont.GetNumVars();
		for (int i = 0; i < varCount && i < MAX_SIBLINGS; i++)
			resp.siblings.Insert(cont.GetVarName(i));
	}

	//------------------------------------------------------------------------------------------------
	//! The index of the first element of class className in list; -1 when none (or no list).
	static int ClassIndex(BaseContainerList list, string className)
	{
		if (!list)
			return -1;
		int itemCount = list.Count();
		for (int k = 0; k < itemCount; k++)
		{
			BaseContainer item = list.Get(k);
			if (item && item.GetClassName() == className)
				return k;
		}
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! Walks every segment but the last (GetObject, or GetObjectArray(name).Get(index)) and returns
	//! the container that holds the last one, with its name and index; null with the answer written.
	//! A "name[Class]" segment resolves to the index of the first element of that class. When idPath
	//! is given it receives one ContainerIdPathEntry per walked segment (name, or name and index: the
	//! containerIdPath of the WorldEditorAPI writes); steps receives the container each one reached.
	protected static BaseContainer Resolve(BaseContainer root, string path, out string leafName, out int leafIndex, array<ref ContainerIdPathEntry> idPath, array<BaseContainer> steps, EMCP_WB_ContainerResponse resp)
	{
		leafName = "";
		leafIndex = -1;
		if (path == "")
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "path required", "a dotted path as describe lists it");
			return null;
		}
		array<string> parts = {};
		path.Split(".", parts, false);
		BaseContainer cur = root;
		for (int i = 0; i < parts.Count(); i++)
		{
			string name = "";
			int index = -1;
			string className = "";
			string why = "";
			if (!SplitSegment(parts.Get(i), name, index, className, why))
			{
				Answer(resp, "error", "INVALID_ARGUMENT", why, "a dotted path as describe lists it");
				return null;
			}
			int varIndex = cur.GetVarIndex(name);
			if (varIndex < 0)
			{
				Siblings(cur, resp);
				Answer(resp, "error", "PATH_NOT_FOUND", "no variable '" + name + "' in " + cur.GetClassName(), "check the path against the sibling names listed");
				return null;
			}
			DataVarType dataType = cur.GetDataVarType(varIndex);
			if (className != "")
			{
				if (dataType != DataVarType.OBJECT_ARRAY)
				{
					Answer(resp, "error", "INVALID_ARGUMENT", "'" + name + "' is not an object array", "drop the [" + className + "]");
					return null;
				}
				index = ClassIndex(cur.GetObjectArray(name), className);
				if (index < 0)
				{
					Answer(resp, "error", "PATH_NOT_FOUND", "no element of class " + className + " in '" + name + "'", "describe the container to list the element classes");
					return null;
				}
			}
			if (i == parts.Count() - 1)
			{
				leafName = name;
				leafIndex = index;
				return cur;
			}

			BaseContainer step = null;
			if (index >= 0)
			{
				if (dataType != DataVarType.OBJECT_ARRAY)
				{
					Answer(resp, "error", "INVALID_ARGUMENT", "'" + name + "' is not an object array", "drop the index");
					return null;
				}
				BaseContainerList list = cur.GetObjectArray(name);
				int itemCount = 0;
				if (list)
					itemCount = list.Count();
				if (index >= itemCount)
				{
					Answer(resp, "error", "PATH_NOT_FOUND", "'" + name + "' holds " + itemCount.ToString() + " elements", "an index below the element count");
					return null;
				}
				step = list.Get(index);
			}
			else
			{
				if (dataType != DataVarType.OBJECT)
				{
					Answer(resp, "error", "INVALID_ARGUMENT", "'" + name + "' is not an object", "stop the path at this variable");
					return null;
				}
				step = cur.GetObject(name);
			}
			if (!step)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", "'" + parts.Get(i) + "' holds no object", "stop the path at this variable");
				return null;
			}
			if (idPath)
			{
				if (index >= 0)
					idPath.Insert(new ContainerIdPathEntry(name, index));
				else
					idPath.Insert(new ContainerIdPathEntry(name));
			}
			if (steps)
				steps.Insert(step);
			cur = step;
		}
		return null;
	}

	//------------------------------------------------------------------------------------------------
	//! Appends one row per variable of cont (COLUMNS cells, SCHEMA_COLUMNS with schema), then follows
	//! objects and object arrays while depthLeft is above zero. Stops at MAX_ROWS rows.
	//! ECEN_ProbeContainers.Walk with the current value (ReadAsText) in place of the UI widget; with
	//! schema the widget (the probe's GetUIWidget), limits and enum entries follow (W2 2.4).
	static void Walk(BaseContainer cont, string prefix, int depthLeft, array<string> all, bool schema)
	{
		int stride = COLUMNS;
		if (schema)
			stride = SCHEMA_COLUMNS;
		int varCount = cont.GetNumVars();
		for (int i = 0; i < varCount; i++)
		{
			if (all.Count() >= MAX_ROWS * stride)
				return;

			string varName = cont.GetVarName(i);
			DataVarType dataType = cont.GetDataVarType(i);
			string typeName = typename.EnumToString(DataVarType, dataType);
			string defaultText = "";
			bool hasDefault = cont.GetDefaultAsString(varName, defaultText);
			if (!hasDefault)
				defaultText = "";
			bool isSet = cont.IsVariableSet(varName);
			bool isSetDirectly = cont.IsVariableSetDirectly(varName);
			string path = prefix + varName;
			string current = ReadValueText(cont, varName, dataType);

			string objectClass = "";
			BaseContainer child = null;
			BaseContainerList list = null;
			if (dataType == DataVarType.OBJECT)
			{
				objectClass = cont.GetObjectBaseClass(i);
				child = cont.GetObject(varName);
				if (child)
					objectClass = child.GetClassName();
			}
			else if (dataType == DataVarType.OBJECT_ARRAY)
			{
				objectClass = cont.GetObjectBaseClass(i);
				list = cont.GetObjectArray(varName);
			}

			all.Insert(path);
			all.Insert(varName);
			all.Insert(typeName);
			all.Insert(ScrubHome(defaultText));
			all.Insert(isSet.ToString());
			all.Insert(isSetDirectly.ToString());
			all.Insert(objectClass);
			all.Insert(ScrubHome(current));
			if (schema)
			{
				all.Insert(cont.GetUIWidget(i));
				all.Insert(LimitsText(cont, i, dataType));
				array<string> pairs = {};
				EnumPairs(cont, i, dataType, pairs);
				all.Insert(JoinPairs(pairs));
			}

			if (depthLeft <= 0)
				continue;

			if (child)
				Walk(child, path + ".", depthLeft - 1, all, schema);

			if (list)
			{
				int itemCount = list.Count();
				for (int k = 0; k < itemCount; k++)
				{
					if (all.Count() >= MAX_ROWS * stride)
						return;
					BaseContainer item = list.Get(k);
					if (!item)
						continue;
					string itemPath = path + "[" + k.ToString() + "]";
					all.Insert(itemPath);
					all.Insert("");
					all.Insert("element");
					all.Insert("");
					all.Insert("");
					all.Insert("");
					all.Insert(item.GetClassName());
					all.Insert("");
					if (schema)
					{
						all.Insert("");
						all.Insert("");
						all.Insert("");
					}
					Walk(item, itemPath + ".", depthLeft - 1, all, schema);
				}
			}
		}
	}

	//------------------------------------------------------------------------------------------------
	//! Counts per type, set and default totals over the walked rows; the root's object children with
	//! their row counts; the root's set variable names. stride is the cells per row of the walk.
	protected static void Summarize(BaseContainer root, array<string> all, int stride, EMCP_WB_ContainerResponse resp)
	{
		bool yes = true;
		bool no = false;
		string trueText = yes.ToString();
		string falseText = no.ToString();
		array<string> typeNames = {};
		int rowCount = all.Count() / stride;
		for (int r = 0; r < rowCount; r++)
		{
			string typeName = all.Get(r * stride + 2);
			if (typeName == "element")
				continue;
			bool known = false;
			for (int t = 0; t < typeNames.Count(); t++)
			{
				if (typeNames.Get(t) == typeName)
					known = true;
			}
			if (!known)
				typeNames.Insert(typeName);

			string setText = all.Get(r * stride + 4);
			if (setText == trueText)
				resp.setCount++;
			else if (setText == falseText)
				resp.defaultCount++;
		}
		for (int n = 0; n < typeNames.Count(); n++)
		{
			string countedType = typeNames.Get(n);
			int typeTotal = 0;
			for (int q = 0; q < rowCount; q++)
			{
				if (all.Get(q * stride + 2) == countedType)
					typeTotal++;
			}
			resp.typeCounts.Insert(countedType + "=" + typeTotal.ToString());
		}

		int varCount = root.GetNumVars();
		for (int i = 0; i < varCount; i++)
		{
			string varName = root.GetVarName(i);
			DataVarType dataType = root.GetDataVarType(i);
			if (root.IsVariableSet(varName) && resp.topSet.Count() < MAX_TOP_SET)
				resp.topSet.Insert(varName);

			if (dataType == DataVarType.OBJECT)
			{
				BaseContainer child = root.GetObject(varName);
				int childRows = RowsUnder(all, stride, varName + ".");
				if (child)
					resp.children.Insert(varName + "=" + child.GetClassName() + " (" + childRows.ToString() + " rows)");
			}
			else if (dataType == DataVarType.OBJECT_ARRAY)
			{
				BaseContainerList list = root.GetObjectArray(varName);
				int itemCount = 0;
				if (list)
					itemCount = list.Count();
				int itemRows = RowsUnder(all, stride, varName + "[");
				resp.children.Insert(varName + "=" + root.GetObjectBaseClass(i) + "[" + itemCount.ToString() + "] (" + itemRows.ToString() + " rows)");
			}
		}

		// The container's child nodes (GetNumChildren/GetChild): a layout's widgets, which are no
		// variable of their parent, so the walk above never reaches them (W2 run 3, w2-72; BI's
		// SCR_GenerateLayoutClassPlugin.BuildWidgetArray walks a layout the same way). get reads one
		// with a leading "#<index>" step.
		int nodeCount = root.GetNumChildren();
		for (int nodeIdx = 0; nodeIdx < nodeCount && nodeIdx < MAX_CHILD_NODES; nodeIdx++)
		{
			BaseContainer node = root.GetChild(nodeIdx);
			if (!node)
				continue;
			resp.children.Insert("#" + nodeIdx.ToString() + "=" + node.GetClassName() + " \"" + NodeName(node) + "\" (" + node.GetNumChildren().ToString() + " nodes)");
		}
		if (nodeCount > MAX_CHILD_NODES)
			resp.children.Insert("#=" + nodeCount.ToString() + " nodes, the first " + MAX_CHILD_NODES.ToString() + " listed");
	}

	//------------------------------------------------------------------------------------------------
	//! The text a child node is listed by: its Name string variable when it has one (a widget), else
	//! GetName.
	protected static string NodeName(BaseContainer node)
	{
		int nameIndex = node.GetVarIndex("Name");
		if (nameIndex >= 0 && node.GetDataVarType(nameIndex) == DataVarType.STRING)
		{
			string nameText = "";
			if (node.Get("Name", nameText))
				return nameText;
		}
		return node.GetName();
	}

	//------------------------------------------------------------------------------------------------
	//! get: walks the leading "#<index>" steps of a path through GetChild (a layout's widget tree) and
	//! answers the node the rest of the path starts from, with that rest in rest; null with the
	//! answer written. A path with no leading step answers root and the whole path. Read only: no
	//! write action takes a "#" step (the TS precheck refuses it).
	protected static BaseContainer ChildSteps(BaseContainer root, string path, out string rest, EMCP_WB_ContainerResponse resp)
	{
		rest = path;
		BaseContainer cur = root;
		while (rest.StartsWith("#"))
		{
			int dot = rest.IndexOf(".");
			if (dot < 0)
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "'" + rest + "' names a child node, not a variable", "follow the step with a variable: #<index>.<name>");
				return null;
			}
			string digits = rest.Substring(1, dot - 1);
			int childIndex = -1;
			if (digits == "" || !EMCP_WB_Common.ParseInt(digits, childIndex) || childIndex < 0)
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "bad child step '#" + digits + "'", "#<index> as describe's summary lists the children");
				return null;
			}
			int childCount = cur.GetNumChildren();
			if (childIndex >= childCount)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", cur.GetClassName() + " holds " + childCount.ToString() + " child nodes", "an index below the child count (describe's summary lists them)");
				return null;
			}
			BaseContainer stepNode = cur.GetChild(childIndex);
			if (!stepNode)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", "GetChild(" + childIndex.ToString() + ") returned null", "describe the container again");
				return null;
			}
			cur = stepNode;
			rest = rest.Substring(dot + 1, rest.Length() - dot - 1);
		}
		return cur;
	}

	//------------------------------------------------------------------------------------------------
	protected static int RowsUnder(array<string> all, int stride, string prefix)
	{
		int count = 0;
		int rowCount = all.Count() / stride;
		for (int r = 0; r < rowCount; r++)
		{
			string rowPath = all.Get(r * stride);
			if (rowPath.StartsWith(prefix))
				count++;
		}
		return count;
	}

	//------------------------------------------------------------------------------------------------
	//! Forgets the kept walk: the container may no longer hold what it lists.
	protected static void DropWalk()
	{
		s_WalkRows = null;
		s_WalkTarget = "";
		s_WalkRootClass = "";
		s_WalkSchema = false;
	}

	//------------------------------------------------------------------------------------------------
	//! True for a target whose describe walk may be kept between pages: a project file or a class
	//! schema. Never an open: module document or an entity: of the edited world.
	protected static bool KeepsWalk(string target)
	{
		return target.StartsWith("path:") || target.StartsWith("class:");
	}

	//------------------------------------------------------------------------------------------------
	//! describe: the schema walk (MAX_DEPTH), then the summary (mode summary, the default) or one
	//! page of at most PAGE_ROWS rows from cursor (mode page).
	protected static void Describe(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		string mode = req.mode;
		if (mode == "")
			mode = "summary";
		if (mode != "summary" && mode != "page")
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "mode must be summary or page, got '" + mode + "'", "mode summary or page");
			return;
		}
		// The cursor is "<offset>:<total>" like every other pager (review round 1, F6): a page whose
		// walk no longer has that total answers STALE_CURSOR.
		int offset = 0;
		int issuedFor = 0;
		if (req.cursor != "" && !EMCP_WB_Entity.ParseCursor(req.cursor, offset, issuedFor))
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "cursor is not one this handler answered: " + req.cursor, "omit cursor for the first page");
			return;
		}
		int limit = req.limit;
		if (limit <= 0)
			limit = PAGE_DEFAULT;
		if (limit > PAGE_ROWS)
			limit = PAGE_ROWS;
		bool schema = WantsSchema(req.fields);
		int stride = COLUMNS;
		if (schema)
		{
			stride = SCHEMA_COLUMNS;
			resp.columns = SCHEMA_COLUMN_NAMES;
		}

		// A later page of the walk the page before it kept: no load, no walk. Only a path: or class:
		// target keeps its walk; an open: or entity: target can change under the caller (another
		// world opened, an edit by another tool), so its every page walks again (review round 1, F6).
		array<string> all = null;
		EMCP_WB_ContainerTarget t = null;
		if (mode == "page" && req.cursor != "" && s_WalkRows && s_WalkTarget == req.target && s_WalkSchema == schema && KeepsWalk(req.target))
		{
			all = s_WalkRows;
			resp.rootClass = s_WalkRootClass;
		}
		else
		{
			t = new EMCP_WB_ContainerTarget();
			if (!t.Open(req.target))
			{
				Answer(resp, "error", t.m_Code, t.m_Why, "");
				return;
			}
			all = {};
			Walk(t.m_Root, "", MAX_DEPTH, all, schema);
			resp.rootClass = t.m_Root.GetClassName();
		}
		int rowCount = all.Count() / stride;
		resp.total = rowCount;
		resp.capped = rowCount >= MAX_ROWS;
		if (mode == "page" && req.cursor != "" && issuedFor != rowCount)
		{
			DropWalk();
			Answer(resp, "error", "STALE_CURSOR", "the cursor was issued for " + issuedFor.ToString() + " rows, the container now has " + rowCount.ToString(), "read again without a cursor");
			return;
		}

		if (mode == "summary")
		{
			Summarize(t.m_Root, all, stride, resp);
			Answer(resp, "ok", "", "container summary", "");
			return;
		}

		int last = offset + limit;
		if (last > rowCount)
			last = rowCount;
		for (int r = offset; r < last; r++)
		{
			for (int c = 0; c < stride; c++)
				resp.rows.Insert(all.Get(r * stride + c));
		}
		if (last < rowCount)
		{
			resp.nextCursor = last.ToString() + ":" + rowCount.ToString();
			s_WalkRows = all;
			s_WalkTarget = req.target;
			s_WalkRootClass = resp.rootClass;
			s_WalkSchema = schema;
		}
		else
			DropWalk();
		Answer(resp, "ok", "", "container page", "");
	}

	//------------------------------------------------------------------------------------------------
	//! get: one dotted path; a variable answers its type, object class and value (scalars), an
	//! element path ("name[i]") its class.
	protected static void GetPath(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		EMCP_WB_ContainerTarget t = new EMCP_WB_ContainerTarget();
		if (!t.Open(req.target))
		{
			Answer(resp, "error", t.m_Code, t.m_Why, "");
			return;
		}
		resp.rootClass = t.m_Root.GetClassName();

		string varPath = "";
		BaseContainer start = ChildSteps(t.m_Root, req.path, varPath, resp);
		if (!start)
			return;
		string leafName = "";
		int leafIndex = -1;
		BaseContainer holder = Resolve(start, varPath, leafName, leafIndex, null, null, resp);
		if (!holder)
			return;

		int varIndex = holder.GetVarIndex(leafName);
		DataVarType dataType = holder.GetDataVarType(varIndex);
		if (leafIndex >= 0)
		{
			if (dataType != DataVarType.OBJECT_ARRAY)
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "'" + leafName + "' is not an object array", "drop the index");
				return;
			}
			BaseContainerList list = holder.GetObjectArray(leafName);
			int itemCount = 0;
			if (list)
				itemCount = list.Count();
			if (leafIndex >= itemCount)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", "'" + leafName + "' holds " + itemCount.ToString() + " elements", "an index below the element count");
				return;
			}
			BaseContainer item = list.Get(leafIndex);
			resp.varType = "element";
			if (item)
				resp.objectClass = item.GetClassName();
			resp.value = resp.objectClass;
			Answer(resp, "ok", "", "element read", "");
			return;
		}

		resp.varType = typename.EnumToString(DataVarType, dataType);
		if (dataType == DataVarType.OBJECT)
		{
			resp.objectClass = holder.GetObjectBaseClass(varIndex);
			BaseContainer child = holder.GetObject(leafName);
			if (child)
				resp.objectClass = child.GetClassName();
		}
		else if (dataType == DataVarType.OBJECT_ARRAY)
		{
			resp.objectClass = holder.GetObjectBaseClass(varIndex);
			BaseContainerList items = holder.GetObjectArray(leafName);
			int count = 0;
			if (items)
				count = items.Count();
			resp.value = count.ToString();
		}
		if (dataType != DataVarType.OBJECT_ARRAY)
			resp.value = ScrubHome(ReadValueText(holder, leafName, dataType));
		// Instance against default (spec 2.2 get): the probe dump's three calls on the one variable.
		resp.isSet = holder.IsVariableSet(leafName);
		resp.isSetDirectly = holder.IsVariableSetDirectly(leafName);
		string defaultText = "";
		if (holder.GetDefaultAsString(leafName, defaultText))
			resp.defaultValue = ScrubHome(defaultText);
		// The schema of the variable (W2 2.4): UI widget, limits, enum entries.
		resp.widget = holder.GetUIWidget(varIndex);
		resp.limits = LimitsText(holder, varIndex, dataType);
		EnumPairs(holder, varIndex, dataType, resp.enumValues);
		Answer(resp, "ok", "", "variable read", "");
	}

	//------------------------------------------------------------------------------------------------
	//! set: a scalar variable of a path: target. Without confirm a dry run: the value is checked and
	//! before and the proposed after are answered, nothing is set. With confirm: Set, read back, then
	//! SaveContainer of the whole container to its own project-relative path.
	protected static void SetPath(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		if (req.value == "" && !req.emptyValue)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "value required", "the new value as text; emptyValue true for an empty string");
			return;
		}
		if (req.target == "open:WorldEditor")
		{
			Unproven(resp, WORLD_WRITE_UNPROVEN);
			return;
		}
		if (req.target.StartsWith("class:"))
		{
			ClassRefused(resp);
			return;
		}
		if (req.target.StartsWith("entity:"))
		{
			SetEntity(req, resp);
			return;
		}
		EMCP_WB_ContainerTarget t = new EMCP_WB_ContainerTarget();
		if (!t.Open(req.target))
		{
			Answer(resp, "error", t.m_Code, t.m_Why, "");
			return;
		}
		if (!WriteAllowed(t, resp))
			return;
		resp.rootClass = t.m_Root.GetClassName();

		string leafName = "";
		int leafIndex = -1;
		BaseContainer holder = Resolve(t.m_Root, req.path, leafName, leafIndex, null, null, resp);
		if (!holder)
			return;
		if (leafIndex >= 0)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "set writes a variable, not an array element", "a path that ends at a scalar variable");
			return;
		}
		int varIndex = holder.GetVarIndex(leafName);
		DataVarType dataType = holder.GetDataVarType(varIndex);
		resp.varType = typename.EnumToString(DataVarType, dataType);
		string why = "";
		if (!CheckText(dataType, req.value, why))
		{
			Answer(resp, "error", "INVALID_ARGUMENT", why, "a value of the variable's type");
			return;
		}
		resp.before = ScrubHome(ReadAsText(holder, leafName, dataType));

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.after = ScrubHome(req.value);
			Answer(resp, "ok", "", "dry run: nothing was set or written", "send confirm true to set and save");
			return;
		}

		resp.written = WriteFromText(holder, leafName, dataType, req.value, why);
		resp.after = ScrubHome(ReadAsText(holder, leafName, dataType));
		if (!resp.written)
		{
			if (why == "")
				Answer(resp, "error", "ENGINE_FALSE", "BaseContainer.Set returned false; nothing was saved", "read the variable back with get");
			else
				Answer(resp, "error", "INVALID_ARGUMENT", why + "; nothing was saved", "read the variable back with get");
			return;
		}
		// open:ResourceManager: the module saves its opened resource (W2 2.4, probe P-W2-15).
		if (t.m_IsModule)
		{
			if (!ModuleSave(t, resp))
				return;
			Answer(resp, "ok", "", "set and saved through the " + t.m_ModuleName + " module", "");
			return;
		}
		ResourceName noResourceName = "";
		resp.saved = BaseContainerTools.SaveContainer(t.m_Root, noResourceName, t.m_Rel);
		resp.savedPath = t.m_Rel;
		if (!resp.saved)
		{
			Answer(resp, "error", "SAVE_FAILED", "SaveContainer returned false; the loaded container holds the new value but the file is unchanged", "read the file back before any retry");
			return;
		}
		Answer(resp, "ok", "", "set and saved", "");
	}

	//------------------------------------------------------------------------------------------------
	//! save: SaveContainer of a path: target to its own project-relative path (the engine re-writes
	//! the text in its canonical form, U11); open:ResourceManager: WBModuleDef.Save of the module
	//! (W2 2.4). Without confirm a dry run that names the file.
	protected static void SaveTarget(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		if (req.target == "open:WorldEditor")
		{
			Unproven(resp, WORLD_WRITE_UNPROVEN);
			return;
		}
		if (req.target.StartsWith("class:"))
		{
			ClassRefused(resp);
			return;
		}
		EMCP_WB_ContainerTarget t = new EMCP_WB_ContainerTarget();
		if (!t.Open(req.target))
		{
			Answer(resp, "error", t.m_Code, t.m_Why, "");
			return;
		}
		if (!WriteAllowed(t, resp))
			return;
		resp.rootClass = t.m_Root.GetClassName();
		resp.savedPath = t.m_Rel;

		if (t.m_IsModule)
		{
			if (!req.confirm)
			{
				resp.dryRun = true;
				Answer(resp, "ok", "", "dry run: would save " + t.m_Rel + " through the " + t.m_ModuleName + " module", "send confirm true to write");
				return;
			}
			if (!ModuleSave(t, resp))
				return;
			Answer(resp, "ok", "", "saved through the " + t.m_ModuleName + " module", "");
			return;
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: would re-save " + t.m_Rel + " (the engine canonicalises the text and does not regenerate compiled blocks, U11)", "send confirm true to write");
			return;
		}

		ResourceName noResourceName = "";
		resp.saved = BaseContainerTools.SaveContainer(t.m_Root, noResourceName, t.m_Rel);
		if (!resp.saved)
		{
			Answer(resp, "error", "SAVE_FAILED", "SaveContainer returned false; nothing was written", "check that the file's folder exists");
			return;
		}
		Answer(resp, "ok", "", "saved", "");
	}

	//------------------------------------------------------------------------------------------------
	// Wave W1 writes (phase5-w1-spec.md 2.2): clear, arrayAdd, arrayRemove, arrayMove, setClass, and
	// set on an entity: target.
	//------------------------------------------------------------------------------------------------

	//------------------------------------------------------------------------------------------------
	//! The guard of a write once the target is open: a path: target takes WriteAllowed (project, an
	//! existing file inside the project's folder); an entity: target is refused in play mode.
	protected static bool MayWrite(EMCP_WB_ContainerTarget t, EMCP_WB_ContainerResponse resp)
	{
		if (!t.m_IsEntity)
			return WriteAllowed(t, resp);
		if (t.m_Api.IsGameMode())
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, "WRONG_MODE", "MayWrite: the World Editor is in play mode; nothing was changed", "stop play (wb_world stop) and retry");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Opens the target of a W1 write, after the caller's project check: the World Editor's container
	//! is refused (UNPROVEN), the target opens, then MayWrite. Null with the answer written.
	protected static EMCP_WB_ContainerTarget OpenForWrite(string target, EMCP_WB_ContainerResponse resp)
	{
		if (target == "open:WorldEditor")
		{
			Unproven(resp, WORLD_WRITE_UNPROVEN);
			return null;
		}
		if (EMCP_WB_ContainerTarget.IsModuleTarget(target))
		{
			Unproven(resp, RM_WRITE_UNPROVEN);
			return null;
		}
		if (target.StartsWith("class:"))
		{
			ClassRefused(resp);
			return null;
		}
		EMCP_WB_ContainerTarget t = new EMCP_WB_ContainerTarget();
		if (!t.Open(target))
		{
			Answer(resp, "error", t.m_Code, t.m_Why, "");
			return null;
		}
		if (!MayWrite(t, resp))
			return null;
		resp.rootClass = t.m_Root.GetClassName();
		return t;
	}

	//------------------------------------------------------------------------------------------------
	//! SaveContainer of a path: target to its own project-relative path after a confirmed write.
	//! False with SAVE_FAILED written.
	protected static bool SaveWrite(EMCP_WB_ContainerTarget t, EMCP_WB_ContainerResponse resp)
	{
		ResourceName noResourceName = "";
		resp.saved = BaseContainerTools.SaveContainer(t.m_Root, noResourceName, t.m_Rel);
		resp.savedPath = t.m_Rel;
		if (!resp.saved)
		{
			Answer(resp, "error", "SAVE_FAILED", "SaveContainer returned false; the loaded container holds the change but the file is unchanged", "read the file back before any retry");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The containerIdPath of a WorldEditorAPI write: null at the top level (the form the 1.x entity
	//! handler ran live), the entries otherwise.
	static array<ref ContainerIdPathEntry> PathOrNull(array<ref ContainerIdPathEntry> idPath)
	{
		if (!idPath || idPath.Count() == 0)
			return null;
		return idPath;
	}

	//------------------------------------------------------------------------------------------------
	//! The top level of an entity array write. A path that starts in components[...] gives the
	//! component itself and the rest of the path: the form the 1.x addArrayItem and removeArrayItem
	//! ran live (the entity with a component entry answered false there). Otherwise the entity and
	//! the whole path. callPath receives the entries the call takes.
	protected static BaseContainer ArrayTop(EMCP_WB_ContainerTarget t, string path, array<ref ContainerIdPathEntry> idPath, array<BaseContainer> steps, array<ref ContainerIdPathEntry> callPath)
	{
		BaseContainer top = t.m_Root;
		int first = 0;
		if (path.StartsWith("components[") && steps.Count() > 0)
		{
			top = steps.Get(0);
			first = 1;
		}
		for (int i = first; i < idPath.Count(); i++)
			callPath.Insert(idPath.Get(i));
		return top;
	}

	//------------------------------------------------------------------------------------------------
	//! The holder of path again, for the read back after a write; null when it no longer resolves.
	protected static BaseContainer Again(BaseContainer root, string path, out string leafName, out int leafIndex)
	{
		leafName = "";
		leafIndex = -1;
		EMCP_WB_ContainerResponse scratch = new EMCP_WB_ContainerResponse();
		return Resolve(root, path, leafName, leafIndex, null, null, scratch);
	}

	//------------------------------------------------------------------------------------------------
	//! The class of each element of list, in order ("" for a null element).
	static void ListClasses(BaseContainerList list, array<string> classes)
	{
		if (!list)
			return;
		int itemCount = list.Count();
		for (int k = 0; k < itemCount; k++)
		{
			BaseContainer item = list.Get(k);
			if (item)
				classes.Insert(item.GetClassName());
			else
				classes.Insert("");
		}
	}

	//------------------------------------------------------------------------------------------------
	//! Classes comma-joined, at most MAX_LISTED, then ",...".
	static string JoinClasses(array<string> classes)
	{
		string text = "";
		int n = classes.Count();
		for (int k = 0; k < n && k < MAX_LISTED; k++)
		{
			if (k > 0)
				text = text + ",";
			text = text + classes.Get(k);
		}
		if (n > MAX_LISTED)
			text = text + ",...";
		return text;
	}

	//------------------------------------------------------------------------------------------------
	//! A dry run's proposed element list: classes without the element at removeAt (-1: none), then
	//! added inserted at insertAt (-1: nothing inserted). proposedCount is its length.
	static string Proposed(array<string> classes, int removeAt, string added, int insertAt, out int proposedCount)
	{
		array<string> kept = {};
		for (int k = 0; k < classes.Count(); k++)
		{
			if (k != removeAt)
				kept.Insert(classes.Get(k));
		}
		array<string> result = {};
		for (int m = 0; m <= kept.Count(); m++)
		{
			if (m == insertAt)
				result.Insert(added);
			if (m < kept.Count())
				result.Insert(kept.Get(m));
		}
		proposedCount = result.Count();
		return JoinClasses(result);
	}

	//------------------------------------------------------------------------------------------------
	//! The class of the object at varName (itemIndex -1) or of element itemIndex; "" when none.
	static string ObjectClassAt(BaseContainer holder, string varName, int itemIndex)
	{
		BaseContainer obj = null;
		if (itemIndex >= 0)
		{
			BaseContainerList list = holder.GetObjectArray(varName);
			if (list && itemIndex < list.Count())
				obj = list.Get(itemIndex);
		}
		else
			obj = holder.GetObject(varName);
		if (!obj)
			return "";
		return obj.GetClassName();
	}

	//------------------------------------------------------------------------------------------------
	//! True when every element of the array is inherited (not set directly, as many elements as the
	//! ancestor's): RemoveObjectArrayVariableMember on such an array crashed the Workbench in 1.x
	//! (EMCP_WB_ModifyEntity removeArrayItem guard, kept).
	static bool InheritedOnly(BaseContainer holder, string varName, int itemCount)
	{
		if (holder.IsVariableSetDirectly(varName))
			return false;
		int ancestorCount = 0;
		BaseContainer ancestor = holder.GetAncestor();
		if (ancestor)
		{
			BaseContainerList ancestorList = ancestor.GetObjectArray(varName);
			if (ancestorList)
				ancestorCount = ancestorList.Count();
		}
		return itemCount == ancestorCount;
	}

	//------------------------------------------------------------------------------------------------
	//! The holder of an object array path (the path ends at the array, not an element); varType and
	//! objectClass (the array's base class) answered. Null with the answer written.
	protected static BaseContainer ArrayHolder(EMCP_WB_ContainerTarget t, string path, out string leafName, array<ref ContainerIdPathEntry> idPath, array<BaseContainer> steps, EMCP_WB_ContainerResponse resp)
	{
		leafName = "";
		int leafIndex = -1;
		BaseContainer holder = Resolve(t.m_Root, path, leafName, leafIndex, idPath, steps, resp);
		if (!holder)
			return null;
		int varIndex = holder.GetVarIndex(leafName);
		DataVarType dataType = holder.GetDataVarType(varIndex);
		resp.varType = typename.EnumToString(DataVarType, dataType);
		if (leafIndex >= 0 || dataType != DataVarType.OBJECT_ARRAY)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "the path must end at an object array, not at an element or another type", "a path like components[SCR_Foo].m_aItems");
			return null;
		}
		resp.objectClass = holder.GetObjectBaseClass(varIndex);
		return holder;
	}

	//------------------------------------------------------------------------------------------------
	//! The element classes and count of the array at path, read again after a write.
	protected static void ReadArrayBack(EMCP_WB_ContainerTarget t, string path, EMCP_WB_ContainerResponse resp)
	{
		string leafName = "";
		int leafIndex = -1;
		BaseContainer again = Again(t.m_Root, path, leafName, leafIndex);
		if (!again)
			return;
		array<string> classes = {};
		ListClasses(again.GetObjectArray(leafName), classes);
		resp.after = JoinClasses(classes);
		resp.count = classes.Count();
	}

	//------------------------------------------------------------------------------------------------
	//! set on an entity: target: SetVariableValue in one entity action (U13: a components[i] entry in
	//! the path writes the component's property). Called by SetPath after its project check.
	protected static void SetEntity(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		EMCP_WB_ContainerTarget t = OpenForWrite(req.target, resp);
		if (!t)
			return;

		string leafName = "";
		int leafIndex = -1;
		array<ref ContainerIdPathEntry> idPath = {};
		BaseContainer holder = Resolve(t.m_Root, req.path, leafName, leafIndex, idPath, null, resp);
		if (!holder)
			return;
		if (leafIndex >= 0)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "set writes a variable, not an array element", "a path that ends at a value variable");
			return;
		}
		DataVarType dataType = holder.GetDataVarType(holder.GetVarIndex(leafName));
		resp.varType = typename.EnumToString(DataVarType, dataType);
		if (dataType == DataVarType.OBJECT || dataType == DataVarType.OBJECT_ARRAY)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "set writes a value; '" + leafName + "' is an object or an object array", "setClass for an object, arrayAdd for an array");
			return;
		}
		resp.before = ScrubHome(ReadAsText(holder, leafName, dataType));

		string undoName = UNDO_PREFIX + "set";
		resp.undoName = undoName;
		if (!BeginEdit(t.m_Api, undoName, resp))
			return;
		resp.written = t.m_Api.SetVariableValue(t.m_Root, PathOrNull(idPath), leafName, req.value);
		t.m_Api.EndEntityAction();

		string againName = "";
		int againIndex = -1;
		BaseContainer again = Again(t.m_Root, req.path, againName, againIndex);
		if (again)
			resp.after = ScrubHome(ReadAsText(again, againName, dataType));
		if (!resp.written)
		{
			Answer(resp, "error", "ENGINE_FALSE", "SetVariableValue returned false; nothing changed", "read the variable back with get");
			return;
		}
		Answer(resp, "ok", "", "set in memory as one undo step; the world is not saved", "");
	}

	//------------------------------------------------------------------------------------------------
	//! clear: the variable back to its inherited value. entity: ClearVariableValue in one entity
	//! action. path: dry run unless confirm, then BaseContainer.ClearVariable and SaveContainer.
	protected static void ClearVar(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		EMCP_WB_ContainerTarget t = OpenForWrite(req.target, resp);
		if (!t)
			return;

		string leafName = "";
		int leafIndex = -1;
		array<ref ContainerIdPathEntry> idPath = {};
		BaseContainer holder = Resolve(t.m_Root, req.path, leafName, leafIndex, idPath, null, resp);
		if (!holder)
			return;
		if (leafIndex >= 0)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "clear resets a variable, not an array element", "arrayRemove removes an element");
			return;
		}
		DataVarType dataType = holder.GetDataVarType(holder.GetVarIndex(leafName));
		resp.varType = typename.EnumToString(DataVarType, dataType);
		resp.before = ScrubHome(ReadAsText(holder, leafName, dataType));

		if (t.m_IsEntity)
		{
			string undoName = UNDO_PREFIX + "clear";
			resp.undoName = undoName;
			if (!BeginEdit(t.m_Api, undoName, resp))
				return;
			resp.written = t.m_Api.ClearVariableValue(t.m_Root, PathOrNull(idPath), leafName);
			t.m_Api.EndEntityAction();
		}
		else
		{
			if (!req.confirm)
			{
				resp.dryRun = true;
				resp.isSet = holder.IsVariableSet(leafName);
				Answer(resp, "ok", "", "dry run: nothing was cleared or written; the variable would read its inherited value", "send confirm true to clear and save");
				return;
			}
			holder.ClearVariable(leafName);
			resp.written = true;
		}

		string againName = "";
		int againIndex = -1;
		BaseContainer again = Again(t.m_Root, req.path, againName, againIndex);
		if (again)
		{
			resp.after = ScrubHome(ReadAsText(again, againName, dataType));
			resp.isSet = again.IsVariableSet(againName);
		}
		if (!resp.written)
		{
			Answer(resp, "error", "ENGINE_FALSE", "ClearVariableValue returned false; nothing changed", "read the variable back with get");
			return;
		}
		if (!t.m_IsEntity && !SaveWrite(t, resp))
			return;
		Answer(resp, "ok", "", "cleared", "");
	}

	//------------------------------------------------------------------------------------------------
	//! arrayAdd: a new element of className at index (-1 appends). entity: CreateObjectArrayVariableMember
	//! in one entity action. path: dry run unless confirm, then BaseContainerTools.CreateContainer,
	//! GetResource().ToBaseContainer(), BaseContainerList.Insert and SaveContainer.
	protected static void ArrayAdd(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		if (req.className == "")
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "className required", "the class of the new element");
			return;
		}
		EMCP_WB_ContainerTarget t = OpenForWrite(req.target, resp);
		if (!t)
			return;

		string leafName = "";
		array<ref ContainerIdPathEntry> idPath = {};
		array<BaseContainer> steps = {};
		BaseContainer holder = ArrayHolder(t, req.path, leafName, idPath, steps, resp);
		if (!holder)
			return;
		BaseContainerList list = holder.GetObjectArray(leafName);
		array<string> classes = {};
		ListClasses(list, classes);
		int itemCount = classes.Count();
		int at = req.index;
		if (at < 0)
			at = itemCount;
		if (at > itemCount)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "index " + at.ToString() + " is past the end: '" + leafName + "' holds " + itemCount.ToString() + " elements", "an index from 0 to the element count, or -1 to append");
			return;
		}
		resp.before = JoinClasses(classes);

		// The created container's resource lives until the save below.
		Resource created = null;
		if (t.m_IsEntity)
		{
			array<ref ContainerIdPathEntry> callPath = {};
			BaseContainer top = ArrayTop(t, req.path, idPath, steps, callPath);
			string undoName = UNDO_PREFIX + "arrayAdd";
			resp.undoName = undoName;
			if (!BeginEdit(t.m_Api, undoName, resp))
				return;
			resp.written = t.m_Api.CreateObjectArrayVariableMember(top, PathOrNull(callPath), leafName, req.className, at);
			t.m_Api.EndEntityAction();
		}
		else
		{
			if (!list)
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "'" + leafName + "' holds no list in this file (GetObjectArray returned null)", "give the array an element in the file first");
				return;
			}
			if (!req.confirm)
			{
				int proposedCount = 0;
				resp.after = Proposed(classes, -1, req.className, at, proposedCount);
				resp.count = proposedCount;
				resp.dryRun = true;
				Answer(resp, "ok", "", "dry run: nothing was added or written", "send confirm true to add and save");
				return;
			}
			created = BaseContainerTools.CreateContainer(req.className);
			BaseContainer item = null;
			if (created && created.IsValid())
			{
				BaseResourceObject createdObject = created.GetResource();
				if (createdObject)
					item = createdObject.ToBaseContainer();
			}
			if (!item)
			{
				Answer(resp, "error", "ENGINE_FALSE", "CreateContainer gave no container of class " + req.className + "; nothing changed", "check the class name against the array's base class");
				return;
			}
			resp.written = list.Insert(item, at);
		}

		ReadArrayBack(t, req.path, resp);
		if (!resp.written)
		{
			Answer(resp, "error", "ENGINE_FALSE", "the element was not added (the engine call returned false); nothing changed", "check the class name against the array's base class");
			return;
		}
		if (!t.m_IsEntity && !SaveWrite(t, resp))
			return;
		Answer(resp, "ok", "", "added", "");
	}

	//------------------------------------------------------------------------------------------------
	//! arrayRemove: the element at index. entity: RemoveObjectArrayVariableMember in one entity action,
	//! refused when every element is inherited. path: dry run unless confirm, then
	//! BaseContainerList.Get and Remove, and SaveContainer.
	protected static void ArrayRemove(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		EMCP_WB_ContainerTarget t = OpenForWrite(req.target, resp);
		if (!t)
			return;

		string leafName = "";
		array<ref ContainerIdPathEntry> idPath = {};
		array<BaseContainer> steps = {};
		BaseContainer holder = ArrayHolder(t, req.path, leafName, idPath, steps, resp);
		if (!holder)
			return;
		BaseContainerList list = holder.GetObjectArray(leafName);
		array<string> classes = {};
		ListClasses(list, classes);
		int itemCount = classes.Count();
		if (req.index < 0 || req.index >= itemCount)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "index " + req.index.ToString() + " is out of range: '" + leafName + "' holds " + itemCount.ToString() + " elements", "an index below the element count");
			return;
		}
		resp.before = JoinClasses(classes);

		if (t.m_IsEntity)
		{
			if (InheritedOnly(holder, leafName, itemCount))
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "every element of '" + leafName + "' is inherited from the prefab; removing one crashed the Workbench (1.x guard); nothing changed", "override the array in the prefab file first");
				return;
			}
			array<ref ContainerIdPathEntry> callPath = {};
			BaseContainer top = ArrayTop(t, req.path, idPath, steps, callPath);
			string undoName = UNDO_PREFIX + "arrayRemove";
			resp.undoName = undoName;
			if (!BeginEdit(t.m_Api, undoName, resp))
				return;
			resp.written = t.m_Api.RemoveObjectArrayVariableMember(top, PathOrNull(callPath), leafName, req.index);
			t.m_Api.EndEntityAction();
		}
		else
		{
			if (!req.confirm)
			{
				int proposedCount = 0;
				resp.after = Proposed(classes, req.index, "", -1, proposedCount);
				resp.count = proposedCount;
				resp.dryRun = true;
				Answer(resp, "ok", "", "dry run: nothing was removed or written", "send confirm true to remove and save");
				return;
			}
			BaseContainer item = list.Get(req.index);
			if (item)
				resp.written = list.Remove(item);
		}

		ReadArrayBack(t, req.path, resp);
		if (!resp.written)
		{
			Answer(resp, "error", "ENGINE_FALSE", "the element was not removed (the engine call returned false); nothing changed", "read the array back with get");
			return;
		}
		if (!t.m_IsEntity && !SaveWrite(t, resp))
			return;
		Answer(resp, "ok", "", "removed", "");
	}

	//------------------------------------------------------------------------------------------------
	//! arrayMove: the element at index to position toIndex. path only: dry run unless confirm, then
	//! BaseContainerList.Get, Remove and Insert, and SaveContainer. An entity: target refuses with
	//! UNPROVEN (ENTITY_MOVE_UNPROVEN).
	protected static void ArrayMove(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		if (req.target.StartsWith("entity:"))
		{
			Unproven(resp, ENTITY_MOVE_UNPROVEN);
			return;
		}
		EMCP_WB_ContainerTarget t = OpenForWrite(req.target, resp);
		if (!t)
			return;

		string leafName = "";
		BaseContainer holder = ArrayHolder(t, req.path, leafName, null, null, resp);
		if (!holder)
			return;
		BaseContainerList list = holder.GetObjectArray(leafName);
		array<string> classes = {};
		ListClasses(list, classes);
		int itemCount = classes.Count();
		if (req.index < 0 || req.index >= itemCount || req.toIndex < 0 || req.toIndex >= itemCount)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "index " + req.index.ToString() + " and toIndex " + req.toIndex.ToString() + " must both be below the element count " + itemCount.ToString(), "indexes below the element count");
			return;
		}
		resp.before = JoinClasses(classes);

		if (!req.confirm)
		{
			int proposedCount = 0;
			resp.after = Proposed(classes, req.index, classes.Get(req.index), req.toIndex, proposedCount);
			resp.count = proposedCount;
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: nothing was moved or written", "send confirm true to move and save");
			return;
		}
		BaseContainer item = list.Get(req.index);
		bool removed = false;
		if (item)
			removed = list.Remove(item);
		if (removed)
			resp.written = list.Insert(item, req.toIndex);

		ReadArrayBack(t, req.path, resp);
		if (!removed)
		{
			Answer(resp, "error", "ENGINE_FALSE", "BaseContainerList.Remove returned false; nothing changed", "read the array back with get");
			return;
		}
		if (!resp.written)
		{
			Answer(resp, "error", "ENGINE_FALSE", "Insert returned false after Remove: the loaded container lost the element; nothing was saved", "read the file back; it is unchanged");
			return;
		}
		if (!SaveWrite(t, resp))
			return;
		Answer(resp, "ok", "", "moved", "");
	}

	//------------------------------------------------------------------------------------------------
	//! setClass: an object variable (or, on an entity, an array element) becomes a new object of
	//! className. entity: ChangeObjectClass when an object is there, CreateObjectVariableMember when
	//! the variable is empty, in one entity action. path: object variables only; dry run unless
	//! confirm, then BaseContainerTools.CreateContainer, BaseContainer.SetObject and SaveContainer.
	protected static void SetClass(EMCP_WB_ContainerRequest req, EMCP_WB_ContainerResponse resp)
	{
		DropWalk();
		if (ProjectRefused(resp))
			return;
		if (req.className == "")
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "className required", "the class of the new object");
			return;
		}
		EMCP_WB_ContainerTarget t = OpenForWrite(req.target, resp);
		if (!t)
			return;

		string leafName = "";
		int leafIndex = -1;
		array<ref ContainerIdPathEntry> idPath = {};
		BaseContainer holder = Resolve(t.m_Root, req.path, leafName, leafIndex, idPath, null, resp);
		if (!holder)
			return;
		int varIndex = holder.GetVarIndex(leafName);
		DataVarType dataType = holder.GetDataVarType(varIndex);
		resp.varType = typename.EnumToString(DataVarType, dataType);
		if (leafIndex < 0 && dataType != DataVarType.OBJECT)
		{
			Answer(resp, "error", "INVALID_ARGUMENT", "setClass changes an object variable or an array element; '" + leafName + "' is " + resp.varType, "a path that ends at an object");
			return;
		}
		// An index must name an element of an object array, as get checks it: ChangeObjectClass is
		// never handed an index past the end (review round 1, F5).
		if (leafIndex >= 0)
		{
			if (dataType != DataVarType.OBJECT_ARRAY)
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "'" + leafName + "' is not an object array", "drop the index");
				return;
			}
			BaseContainerList setList = holder.GetObjectArray(leafName);
			int setCount = 0;
			if (setList)
				setCount = setList.Count();
			if (leafIndex >= setCount)
			{
				Answer(resp, "error", "PATH_NOT_FOUND", "'" + leafName + "' holds " + setCount.ToString() + " elements", "an index below the element count");
				return;
			}
		}
		resp.before = ObjectClassAt(holder, leafName, leafIndex);

		// The created container's resource lives until the save below.
		Resource created = null;
		if (t.m_IsEntity)
		{
			string undoName = UNDO_PREFIX + "setClass";
			resp.undoName = undoName;
			if (!BeginEdit(t.m_Api, undoName, resp))
				return;
			if (leafIndex >= 0 || resp.before != "")
			{
				// ChangeObjectClass takes the path to the object itself (the 1.x setObjectClass form).
				if (leafIndex >= 0)
					idPath.Insert(new ContainerIdPathEntry(leafName, leafIndex));
				else
					idPath.Insert(new ContainerIdPathEntry(leafName));
				resp.written = t.m_Api.ChangeObjectClass(t.m_Root, idPath, req.className);
			}
			else
				resp.written = t.m_Api.CreateObjectVariableMember(t.m_Root, PathOrNull(idPath), leafName, req.className);
			t.m_Api.EndEntityAction();
		}
		else
		{
			if (leafIndex >= 0)
			{
				Answer(resp, "error", "INVALID_ARGUMENT", "by path setClass changes an object variable, not an array element", "arrayRemove then arrayAdd for an element");
				return;
			}
			if (!req.confirm)
			{
				resp.after = req.className;
				resp.dryRun = true;
				Answer(resp, "ok", "", "dry run: nothing was changed or written; the object would be replaced by a new one with default values", "send confirm true to replace and save");
				return;
			}
			created = BaseContainerTools.CreateContainer(req.className);
			BaseContainer item = null;
			if (created && created.IsValid())
			{
				BaseResourceObject createdObject = created.GetResource();
				if (createdObject)
					item = createdObject.ToBaseContainer();
			}
			if (!item)
			{
				Answer(resp, "error", "ENGINE_FALSE", "CreateContainer gave no container of class " + req.className + "; nothing changed", "check the class name against the variable's base class");
				return;
			}
			resp.written = holder.SetObject(leafName, item);
		}

		string againName = "";
		int againIndex = -1;
		BaseContainer again = Again(t.m_Root, req.path, againName, againIndex);
		if (again)
			resp.after = ObjectClassAt(again, againName, againIndex);
		resp.objectClass = resp.after;
		if (!resp.written)
		{
			Answer(resp, "error", "ENGINE_FALSE", "the class was not changed (the engine call returned false); nothing changed", "check the class name against the variable's base class");
			return;
		}
		if (!t.m_IsEntity && !SaveWrite(t, resp))
			return;
		Answer(resp, "ok", "", "class set", "");
	}
}
