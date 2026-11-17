/**
 * EMCP_WB_Meta.c - A resource's .meta file: its import settings per platform (wave W2, phase5-w2-spec.md 2.2, OD-2)
 *
 * path is always the source file (a project-relative path, or a ResourceName "{GUID}path"), never the
 * .meta. Actions:
 *   get             GetMetaFile, GetResourceID, GetSourceFilePath, the Configurations array (name,
 *                   class, ancestor per platform) and the space-separated Tags string (the form
 *                   BI's ExportFBXResource reads).
 *   vars            one configuration's variables, paged (<start>:<count>, default 50, max 200):
 *                   GetNumVars, GetVarName, GetDataVarType, GetDefaultAsString, IsVariableSet,
 *                   IsVariableSetDirectly, GetUIWidget, GetLimits (scalar and integer only),
 *                   GetEnumValues (integer only), GetObjectBaseClass (object types only); values
 *                   through EMCP_WB_Container.ReadAsText.
 *   set, clear      one variable of one configuration (platform, default PC) or of all of them
 *                   (allPlatforms), through EMCP_WB_Container.WriteFromText or ClearVariable.
 *   setAncestor     SetAncestor on one configuration; the ancestor must load (LoadContainer).
 *   assignMaterial  a model's material slot to an .emat, in Configurations[0].MaterialAssigns, with
 *                   the sequence of BI's ExportFBXResource (SetObjectArray, the slot found or a new
 *                   MaterialAssignClass container inserted), then MetaFile.Save.
 * Meta lifecycle (spec section 1): GetMetaFile -> read or write -> Save (writes only) ->
 * Release(false). No meta is held across calls.
 * GetMetaFile takes the ABSOLUTE path: the form W1 made live (EMCP_WB_World register, EMCP_WB_Prefabs).
 * A read resolves it with Workbench.GetAbsolutePath(path, abs, true); a path that does not resolve to a
 * file on disk (a packed game resource, a missing file) answers META_NOT_FOUND before any meta call
 * (P-W2-05's kill route; BI's GetMetaFileFromString and its FileIO.FileExists are never used).
 * Guards (DEC-058): the writes need the handlers installed in the open project (NOT_IN_PROJECT) and
 * an existing file inside it (TargetExistsInProject), and write nothing without confirm (a dry run
 * answers before and the proposed after). Every write is reversed by the same action with before.
 * Every value is checked before the first write, so a refused input changes nothing.
 * Workbench.GetModule(ResourceManager) names the Resource Manager, the Workbench's main window, which
 * is open while the NET API answers (GetModule would open a closed module, DEC-053).
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Meta"
 */

class EMCP_WB_MetaRequest : JsonApiStruct
{
	string action;
	//! the source file (project-relative or "{GUID}path"), never the .meta
	string path;
	//! vars, set, clear, setAncestor: the configuration's name (PC, XBOX_ONE, ...); default PC
	string platform;
	//! vars: the columns kept, comma-separated; empty keeps all
	string fields;
	//! vars: the nextCursor of the previous page
	string cursor;
	int limit;
	//! set, clear: the variable; assignMaterial: the source material slot
	string name;
	//! set: the new value as text; setAncestor: the ancestor ResourceName; assignMaterial: the .emat
	string value;
	//! set, clear: every configuration
	bool allPlatforms;
	//! writes: true writes, anything else is a dry run
	bool confirm;

	void EMCP_WB_MetaRequest()
	{
		RegV("action");
		RegV("path");
		RegV("platform");
		RegV("fields");
		RegV("cursor");
		RegV("limit");
		RegV("name");
		RegV("value");
		RegV("allPlatforms");
		RegV("confirm");
	}
}

class EMCP_WB_MetaResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	string resourceName;
	string guid;
	string sourcePath;
	//! get: PLATFORM=Class:ancestor per configuration
	ref array<string> platforms;
	ref array<string> tags;
	int count;
	int total;
	string nextCursor;
	string columns;
	ref array<string> rows;
	ref array<string> before;
	ref array<string> after;
	bool saved;
	bool dryRun;

	void EMCP_WB_MetaResponse()
	{
		platforms = {};
		tags = {};
		rows = {};
		before = {};
		after = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("resourceName");
		RegV("guid");
		RegV("sourcePath");
		RegV("platforms");
		RegV("tags");
		RegV("count");
		RegV("total");
		RegV("nextCursor");
		RegV("columns");
		RegV("rows");
		RegV("before");
		RegV("after");
		RegV("saved");
		RegV("dryRun");
	}
}

//! The meta a path names: the module, the meta and the absolute path it was found under. Carried in
//! an object, not out parameters: an out parameter of an engine type assigned null does not compile
//! on 1.9.0.37 (W1, the EMCP_WB_EntityRefResult form).
class EMCP_WB_MetaTarget
{
	ResourceManager m_Manager;
	MetaFile m_Meta;
	//! the clean relative source path
	string m_Rel;
	string m_Abs;
	string m_Code;
	string m_Why;

	//------------------------------------------------------------------------------------------------
	//! A read: any source file on disk (the project's, a dependency's, a loose game file).
	bool OpenRead(string path)
	{
		string clean = "";
		string why = "";
		if (!EMCP_WB_Meta.SourcePath(path, clean, why))
		{
			m_Code = EMCP_WB_Meta.INVALID_ARGUMENT;
			m_Why = why;
			return false;
		}
		m_Rel = clean;
		string absolute = "";
		if (!Workbench.GetAbsolutePath(clean, absolute, true))
		{
			m_Code = EMCP_WB_Meta.META_NOT_FOUND;
			m_Why = "no file " + clean + " on disk (a packed game resource has no editable .meta)";
			return false;
		}
		m_Abs = absolute;
		return OpenAbsolute();
	}

	//------------------------------------------------------------------------------------------------
	//! A write: an existing file inside the open project (TargetExistsInProject, DEC-058).
	bool OpenWrite(string path)
	{
		string clean = "";
		string why = "";
		if (!EMCP_WB_Meta.SourcePath(path, clean, why))
		{
			m_Code = EMCP_WB_Meta.INVALID_ARGUMENT;
			m_Why = why;
			return false;
		}
		m_Rel = clean;
		string absolute = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why))
		{
			m_Code = EMCP_WB_Guard.NOT_IN_PROJECT;
			m_Why = "TargetExistsInProject: " + why + "; nothing was changed";
			return false;
		}
		m_Abs = absolute;
		return OpenAbsolute();
	}

	//------------------------------------------------------------------------------------------------
	protected bool OpenAbsolute()
	{
		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
		{
			m_Code = "MODULE_NOT_OPEN";
			m_Why = "the Resource Manager is not open: GetModule returned null";
			return false;
		}
		m_Manager = resourceManager;
		MetaFile meta = resourceManager.GetMetaFile(m_Abs);
		if (!meta)
		{
			m_Code = EMCP_WB_Meta.META_NOT_FOUND;
			m_Why = "GetMetaFile found no .meta for " + m_Rel + " (register the file first: wb_resources register)";
			return false;
		}
		m_Meta = meta;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! BaseResourceObject.Release(false), once; the meta is not used after it.
	void Close()
	{
		if (!m_Meta)
			return;
		m_Meta.Release(false);
		MetaFile none = null;
		m_Meta = none;
	}
}

class EMCP_WB_Meta : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string META_NOT_FOUND = "META_NOT_FOUND";
	static const string UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string CONFIGURATIONS = "Configurations";
	static const string DEFAULT_PLATFORM = "PC";
	static const string MATERIAL_ASSIGNS = "MaterialAssigns";
	static const string MATERIAL_ASSIGN_CLASS = "MaterialAssignClass";
	static const string SOURCE_MATERIAL = "SourceMaterial";
	static const string ASSIGNED_MATERIAL = "AssignedMaterial";
	//! vars: every column, in order
	static const string ALL_COLUMNS = "name,type,default,set,setDirectly,value,widget,limits,enum,objectClass";
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_MetaRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_MetaRequest req = EMCP_WB_MetaRequest.Cast(request);
		EMCP_WB_MetaResponse resp = new EMCP_WB_MetaResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action and path");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "get")
			GetMeta(req, resp);
		else if (req.action == "vars")
			ListVars(req, resp);
		else if (req.action == "set")
			SetVar(req, resp);
		else if (req.action == "clear")
			ClearVar(req, resp);
		else if (req.action == "setAncestor")
			SetAncestorOf(req, resp);
		else if (req.action == "assignMaterial")
			AssignMaterial(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action: " + req.action, "one of get, vars, set, clear, setAncestor, assignMaterial");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message (the message in EMCP_WB_Guard.RefusalMessage form).
	protected static void Answer(EMCP_WB_MetaResponse resp, string status, string code, string text, string nextStep)
	{
		resp.status = status;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! A failed open: refused for the project guard, an error otherwise.
	protected static void OpenFailed(EMCP_WB_MetaTarget t, EMCP_WB_MetaResponse resp)
	{
		if (t.m_Code == EMCP_WB_Guard.NOT_IN_PROJECT)
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, t.m_Code, t.m_Why, "target a file of the open project");
			return;
		}
		Answer(resp, "error", t.m_Code, t.m_Why, "");
	}

	//------------------------------------------------------------------------------------------------
	//! True (with the refusal written) when the project is not found (DEC-058).
	protected static bool ProjectRefused(EMCP_WB_MetaResponse resp)
	{
		if (EMCP_WB_Guard.IsProjectFound())
			return false;
		Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "ProjectRefused: mutating actions need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The clean relative source path of a request path: a "{GUID}path" ResourceName loses its GUID
	//! (ResourceName.GetPath), then EMCP_WB_Guard.CleanRelative; a .meta path is refused.
	static bool SourcePath(string path, out string clean, out string why)
	{
		clean = "";
		why = "";
		string text = path;
		if (text.StartsWith("{"))
		{
			ResourceName named = path;
			text = named.GetPath();
		}
		if (!EMCP_WB_Guard.CleanRelative(text, clean, why))
			return false;
		string lowerPath = clean;
		lowerPath.ToLower();
		if (lowerPath.EndsWith(".meta"))
		{
			clean = "";
			why = "path names the .meta itself; name the source file it belongs to";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The configuration's ancestor ResourceName, "" when it has none.
	static string AncestorName(BaseContainer config)
	{
		if (!config)
			return "";
		BaseContainer ancestor = config.GetAncestor();
		if (!ancestor)
			return "";
		return ancestor.GetResourceName();
	}

	//------------------------------------------------------------------------------------------------
	//! A variable's value as text, the home folder scrubbed.
	static string ValueText(BaseContainer cont, string varName, DataVarType dataType)
	{
		return EMCP_WB_Guard.ScrubHome(EMCP_WB_Container.ReadAsText(cont, varName, dataType));
	}

	//------------------------------------------------------------------------------------------------
	//! The configurations a write or a read names: the one whose GetName is platform (default PC), or
	//! every one with all. Empty with why set when the meta has none or none has that name.
	static void Selected(MetaFile meta, string platform, bool all, array<BaseContainer> picked, out string why)
	{
		why = "";
		BaseContainerList list = meta.GetObjectArray(CONFIGURATIONS);
		if (!list || list.Count() == 0)
		{
			why = "the meta has no Configurations";
			return;
		}
		string wanted = platform;
		if (wanted == "")
			wanted = DEFAULT_PLATFORM;
		string names = "";
		int listCount = list.Count();
		for (int i = 0; i < listCount; i++)
		{
			BaseContainer config = list.Get(i);
			if (!config)
				continue;
			string configName = config.GetName();
			if (names != "")
				names += ",";
			names += configName;
			if (all || configName == wanted)
				picked.Insert(config);
		}
		if (picked.Count() == 0)
			why = "no configuration named " + wanted + " (the meta has " + names + ")";
	}

	//------------------------------------------------------------------------------------------------
	//! The integer an INTEGER variable's text names: digits, or one of its enum names (GetEnumValues).
	static bool IntegerText(BaseContainer config, int varIndex, string text, out string number)
	{
		number = "";
		int parsed = 0;
		if (EMCP_WB_Common.ParseInt(text, parsed))
		{
			number = text;
			return true;
		}
		array<string> enumNames = {};
		array<int> enumValues = {};
		config.GetEnumValues(varIndex, enumNames, enumValues);
		int enumCount = enumNames.Count();
		if (enumValues.Count() < enumCount)
			enumCount = enumValues.Count();
		for (int i = 0; i < enumCount; i++)
		{
			if (enumNames.Get(i) == text)
			{
				number = enumValues.Get(i).ToString();
				return true;
			}
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! get: identity, configurations and tags.
	protected static void GetMeta(EMCP_WB_MetaRequest req, EMCP_WB_MetaResponse resp)
	{
		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenRead(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		MetaFile meta = t.m_Meta;
		string named = meta.GetResourceID();
		resp.resourceName = named;
		if (named.StartsWith("{") && named.Length() >= 18)
			resp.guid = named.Substring(1, 16);
		resp.sourcePath = EMCP_WB_Guard.ScrubHome(meta.GetSourceFilePath());

		BaseContainerList list = meta.GetObjectArray(CONFIGURATIONS);
		if (list)
		{
			int listCount = list.Count();
			for (int i = 0; i < listCount; i++)
			{
				BaseContainer config = list.Get(i);
				if (!config)
					continue;
				resp.platforms.Insert(config.GetName() + "=" + config.GetClassName() + ":" + AncestorName(config));
			}
			resp.count = listCount;
		}

		if (meta.GetVarIndex("Tags") != -1)
		{
			string tagText = "";
			meta.Get("Tags", tagText);
			array<string> tagList = {};
			tagText.Split(" ", tagList, true);
			foreach (string tag : tagList)
				resp.tags.Insert(tag);
		}
		t.Close();
		Answer(resp, "ok", "", "meta read", "");
	}

	//------------------------------------------------------------------------------------------------
	//! vars cursor "<start>:<count>": digits on both sides, start at most count.
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
	static bool IsDigits(string text)
	{
		int len = text.Length();
		if (len == 0)
			return false;
		for (int i = 0; i < len; i++)
		{
			if (!text.IsDigitAt(i))
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The column positions fields keeps (all when empty); false with why on an unknown name.
	static bool KeptColumns(string fields, array<int> kept, out string why)
	{
		why = "";
		array<string> all = {};
		ALL_COLUMNS.Split(",", all, false);
		if (fields == "")
		{
			for (int a = 0; a < all.Count(); a++)
				kept.Insert(a);
			return true;
		}
		array<string> asked = {};
		fields.Split(",", asked, true);
		foreach (string column : asked)
		{
			string trimmed = column.Trim();
			int at = all.Find(trimmed);
			if (at < 0)
			{
				why = "unknown column '" + trimmed + "' (columns: " + ALL_COLUMNS + ")";
				return false;
			}
			kept.Insert(at);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! One variable's cells, in ALL_COLUMNS order.
	static void VarCells(BaseContainer config, int varIndex, array<string> cells)
	{
		string varName = config.GetVarName(varIndex);
		DataVarType dataType = config.GetDataVarType(varIndex);
		string defaultText = "";
		if (!config.GetDefaultAsString(varName, defaultText))
			defaultText = "";
		bool isSet = config.IsVariableSet(varName);
		bool isSetDirectly = config.IsVariableSetDirectly(varName);
		string current = "";
		if (EMCP_WB_Container.IsScalar(dataType))
			current = ValueText(config, varName, dataType);
		string widget = config.GetUIWidget(varIndex);

		string limits = "";
		if (dataType == DataVarType.SCALAR || dataType == DataVarType.INTEGER)
		{
			float low = 0;
			float high = 0;
			float step = 0;
			config.GetLimits(varIndex, low, high, step);
			limits = low.ToString() + "," + high.ToString() + "," + step.ToString();
		}

		string enumText = "";
		if (dataType == DataVarType.INTEGER)
		{
			array<string> enumNames = {};
			array<int> enumValues = {};
			config.GetEnumValues(varIndex, enumNames, enumValues);
			int enumCount = enumNames.Count();
			if (enumValues.Count() < enumCount)
				enumCount = enumValues.Count();
			for (int e = 0; e < enumCount; e++)
			{
				if (e > 0)
					enumText += "|";
				enumText += enumNames.Get(e) + "=" + enumValues.Get(e).ToString();
			}
		}

		string objectClass = "";
		if (dataType == DataVarType.OBJECT || dataType == DataVarType.OBJECT_ARRAY)
			objectClass = config.GetObjectBaseClass(varIndex);

		cells.Insert(varName);
		cells.Insert(typename.EnumToString(DataVarType, dataType));
		cells.Insert(EMCP_WB_Guard.ScrubHome(defaultText));
		cells.Insert(isSet.ToString());
		cells.Insert(isSetDirectly.ToString());
		cells.Insert(current);
		cells.Insert(widget);
		cells.Insert(limits);
		cells.Insert(enumText);
		cells.Insert(objectClass);
	}

	//------------------------------------------------------------------------------------------------
	//! vars: one page of one configuration's variables.
	protected static void ListVars(EMCP_WB_MetaRequest req, EMCP_WB_MetaResponse resp)
	{
		array<int> kept = {};
		string why = "";
		if (!KeptColumns(req.fields, kept, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "name columns from the list, comma-separated");
			return;
		}
		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenRead(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		array<BaseContainer> picked = {};
		Selected(t.m_Meta, req.platform, false, picked, why);
		if (picked.Count() == 0)
		{
			t.Close();
			Answer(resp, "error", INVALID_ARGUMENT, why, "a platform the meta has (wb_meta get lists them)");
			return;
		}
		BaseContainer config = picked.Get(0);
		int total = config.GetNumVars();
		int start = 0;
		if (req.cursor != "")
		{
			int issuedFor = 0;
			if (!ParseCursor(req.cursor, start, issuedFor))
			{
				t.Close();
				Answer(resp, "error", INVALID_ARGUMENT, "cursor must be <start>:<count> as nextCursor answered, got '" + req.cursor + "'", "omit cursor for the first page");
				return;
			}
			if (issuedFor != total)
			{
				t.Close();
				Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " variables, the configuration now has " + total.ToString(), "read again without a cursor");
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

		array<string> all = {};
		ALL_COLUMNS.Split(",", all, false);
		string columnNames = "";
		for (int k = 0; k < kept.Count(); k++)
		{
			if (k > 0)
				columnNames += ",";
			columnNames += all.Get(kept.Get(k));
		}
		resp.columns = columnNames;
		resp.total = total;
		for (int i = start; i < end; i++)
		{
			array<string> cells = {};
			VarCells(config, i, cells);
			for (int c = 0; c < kept.Count(); c++)
				resp.rows.Insert(cells.Get(kept.Get(c)));
		}
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();
		t.Close();
		int shown = end - start;
		Answer(resp, "ok", "", "variables: " + shown.ToString() + " of " + total.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! set: checks the value against every chosen configuration first; a dry run answers before and
	//! the proposed after; confirm writes each, reads back, then MetaFile.Save.
	protected static void SetVar(EMCP_WB_MetaRequest req, EMCP_WB_MetaResponse resp)
	{
		if (ProjectRefused(resp))
			return;
		if (req.name == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "name required", "the variable's name (wb_meta vars lists them)");
			return;
		}
		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenWrite(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		string why = "";
		array<BaseContainer> picked = {};
		Selected(t.m_Meta, req.platform, req.allPlatforms, picked, why);
		if (picked.Count() == 0)
		{
			t.Close();
			Answer(resp, "error", INVALID_ARGUMENT, why, "a platform the meta has (wb_meta get lists them)");
			return;
		}

		// Every configuration is checked before any is written.
		array<string> texts = {};
		foreach (BaseContainer config : picked)
		{
			int varIndex = config.GetVarIndex(req.name);
			if (varIndex == -1)
			{
				t.Close();
				Answer(resp, "error", INVALID_ARGUMENT, "configuration " + config.GetName() + " has no variable " + req.name + "; nothing was changed", "a name wb_meta vars lists");
				return;
			}
			DataVarType dataType = config.GetDataVarType(varIndex);
			string text = req.value;
			if (dataType == DataVarType.INTEGER && !IntegerText(config, varIndex, req.value, text))
			{
				t.Close();
				Answer(resp, "error", INVALID_ARGUMENT, "value is not an integer nor one of the variable's enum names: " + req.value + "; nothing was changed", "wb_meta vars shows the enum column");
				return;
			}
			if (!EMCP_WB_Container.CheckText(dataType, text, why))
			{
				t.Close();
				Answer(resp, "error", INVALID_ARGUMENT, why + "; nothing was changed", "a value of the variable's type");
				return;
			}
			texts.Insert(text);
			resp.before.Insert(config.GetName() + "=" + ValueText(config, req.name, dataType));
		}

		if (!req.confirm)
		{
			for (int p = 0; p < picked.Count(); p++)
				resp.after.Insert(picked.Get(p).GetName() + "=" + EMCP_WB_Guard.ScrubHome(texts.Get(p)));
			t.Close();
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: nothing was set or written", "send confirm true to set and save");
			return;
		}

		for (int w = 0; w < picked.Count(); w++)
		{
			BaseContainer target = picked.Get(w);
			DataVarType writeType = target.GetDataVarType(target.GetVarIndex(req.name));
			bool written = EMCP_WB_Container.WriteFromText(target, req.name, writeType, texts.Get(w), why);
			resp.after.Insert(target.GetName() + "=" + ValueText(target, req.name, writeType));
			if (!written)
			{
				t.Close();
				Answer(resp, "error", ENGINE_FALSE, "BaseContainer.Set returned false on " + target.GetName() + " " + why + "; the meta was not saved", "read the meta back with wb_meta vars");
				return;
			}
		}
		t.m_Meta.Save();
		resp.saved = true;
		t.Close();
		Answer(resp, "ok", "", "set and saved", "");
	}

	//------------------------------------------------------------------------------------------------
	//! The value a configuration would show for a variable once cleared: the ancestor's, else the
	//! default.
	static string ClearedText(BaseContainer config, string varName, DataVarType dataType)
	{
		BaseContainer ancestor = config.GetAncestor();
		if (ancestor && ancestor.GetVarIndex(varName) != -1)
			return ValueText(ancestor, varName, dataType);
		string defaultText = "";
		if (config.GetDefaultAsString(varName, defaultText))
			return EMCP_WB_Guard.ScrubHome(defaultText);
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! clear: ClearVariable on every chosen configuration; a dry run answers the inherited value.
	protected static void ClearVar(EMCP_WB_MetaRequest req, EMCP_WB_MetaResponse resp)
	{
		if (ProjectRefused(resp))
			return;
		if (req.name == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "name required", "the variable's name (wb_meta vars lists them)");
			return;
		}
		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenWrite(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		string why = "";
		array<BaseContainer> picked = {};
		Selected(t.m_Meta, req.platform, req.allPlatforms, picked, why);
		if (picked.Count() == 0)
		{
			t.Close();
			Answer(resp, "error", INVALID_ARGUMENT, why, "a platform the meta has (wb_meta get lists them)");
			return;
		}
		foreach (BaseContainer config : picked)
		{
			int varIndex = config.GetVarIndex(req.name);
			if (varIndex == -1)
			{
				t.Close();
				Answer(resp, "error", INVALID_ARGUMENT, "configuration " + config.GetName() + " has no variable " + req.name + "; nothing was changed", "a name wb_meta vars lists");
				return;
			}
			DataVarType dataType = config.GetDataVarType(varIndex);
			resp.before.Insert(config.GetName() + "=" + ValueText(config, req.name, dataType));
		}

		if (!req.confirm)
		{
			foreach (BaseContainer proposed : picked)
			{
				DataVarType proposedType = proposed.GetDataVarType(proposed.GetVarIndex(req.name));
				resp.after.Insert(proposed.GetName() + "=" + ClearedText(proposed, req.name, proposedType));
			}
			t.Close();
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: nothing was cleared or written", "send confirm true to clear and save");
			return;
		}

		foreach (BaseContainer target : picked)
		{
			target.ClearVariable(req.name);
			DataVarType clearedType = target.GetDataVarType(target.GetVarIndex(req.name));
			resp.after.Insert(target.GetName() + "=" + ValueText(target, req.name, clearedType));
		}
		t.m_Meta.Save();
		resp.saved = true;
		t.Close();
		Answer(resp, "ok", "", "cleared and saved", "");
	}

	//------------------------------------------------------------------------------------------------
	//! setAncestor: SetAncestor on one configuration. The ancestor is a "{GUID}path" ResourceName that
	//! LoadContainer reads as a valid container; anything else is refused before the call.
	protected static void SetAncestorOf(EMCP_WB_MetaRequest req, EMCP_WB_MetaResponse resp)
	{
		if (ProjectRefused(resp))
			return;
		if (!req.value.StartsWith("{"))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "value must be the ancestor's ResourceName {GUID}path, got '" + req.value + "'", "a base config's resource name");
			return;
		}
		ResourceName ancestorName = req.value;
		Resource ancestorHolder = BaseContainerTools.LoadContainer(ancestorName);
		if (!ancestorHolder || !ancestorHolder.IsValid())
		{
			Answer(resp, "error", PATH_NOT_FOUND, "LoadContainer found no valid resource at " + req.value + "; nothing was changed", "an existing base config");
			return;
		}
		BaseResourceObject ancestorObject = ancestorHolder.GetResource();
		if (!ancestorObject || !ancestorObject.ToBaseContainer())
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the ancestor is not a BaseContainer: " + req.value + "; nothing was changed", "a base config (.conf)");
			return;
		}
		string ancestorClass = ancestorObject.ToBaseContainer().GetClassName();

		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenWrite(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		string why = "";
		array<BaseContainer> picked = {};
		Selected(t.m_Meta, req.platform, false, picked, why);
		if (picked.Count() == 0)
		{
			t.Close();
			Answer(resp, "error", INVALID_ARGUMENT, why, "a platform the meta has (wb_meta get lists them)");
			return;
		}
		BaseContainer config = picked.Get(0);
		resp.before.Insert(config.GetName() + "=" + AncestorName(config));
		string classNote = "";
		if (ancestorClass != config.GetClassName())
			classNote = " (the ancestor's class " + ancestorClass + " is not the configuration's " + config.GetClassName() + ")";

		if (!req.confirm)
		{
			resp.after.Insert(config.GetName() + "=" + req.value);
			t.Close();
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: nothing was set or written" + classNote, "send confirm true to set and save");
			return;
		}

		config.SetAncestor(ancestorName);
		resp.after.Insert(config.GetName() + "=" + AncestorName(config));
		t.m_Meta.Save();
		resp.saved = true;
		t.Close();
		Answer(resp, "ok", "", "ancestor set and saved" + classNote, "");
	}

	//------------------------------------------------------------------------------------------------
	//! The slots of a MaterialAssigns list as slot=material.
	static void ListAssigns(BaseContainerList assigns, array<string> slots)
	{
		if (!assigns)
			return;
		int assignCount = assigns.Count();
		for (int i = 0; i < assignCount; i++)
		{
			BaseContainer assign = assigns.Get(i);
			if (!assign)
				continue;
			string sourceMaterial = "";
			assign.Get(SOURCE_MATERIAL, sourceMaterial);
			ResourceName assigned = "";
			assign.Get(ASSIGNED_MATERIAL, assigned);
			slots.Insert(sourceMaterial + "=" + assigned);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! True when a slot's read-back material names the one asked for: the same text with case
	//! folded, or, when both carry one, the same {GUID} (the engine may spell the path its own way).
	static bool SameMaterial(string readBack, string asked)
	{
		if (readBack == "")
			return false;
		string a = readBack;
		string b = asked;
		a.ToLower();
		b.ToLower();
		if (a == b)
			return true;
		int endA = a.IndexOf("}");
		int endB = b.IndexOf("}");
		if (a.StartsWith("{") && b.StartsWith("{") && endA > 1 && endB > 1)
			return a.Substring(0, endA + 1) == b.Substring(0, endB + 1);
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! assignMaterial: Configurations[0].MaterialAssigns, BI's ExportFBXResource sequence. Only a meta
	//! whose first configuration has MaterialAssigns (a model) is written; the .emat must load. The
	//! other slots are read back before the save; one lost refuses the save.
	protected static void AssignMaterial(EMCP_WB_MetaRequest req, EMCP_WB_MetaResponse resp)
	{
		if (ProjectRefused(resp))
			return;
		if (req.name == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "name required: the source material slot", "a slot name the model's meta lists");
			return;
		}
		string lowerValue = req.value;
		lowerValue.ToLower();
		if (!lowerValue.EndsWith(".emat"))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "value must be an .emat ResourceName, got '" + req.value + "'", "a material's resource name");
			return;
		}
		ResourceName material = req.value;
		Resource materialHolder = BaseContainerTools.LoadContainer(material);
		if (!materialHolder || !materialHolder.IsValid())
		{
			Answer(resp, "error", PATH_NOT_FOUND, "LoadContainer found no valid material at " + req.value + "; nothing was changed", "an existing .emat");
			return;
		}

		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenWrite(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		BaseContainerList configs = t.m_Meta.GetObjectArray(CONFIGURATIONS);
		BaseContainer config = null;
		if (configs && configs.Count() > 0)
			config = configs.Get(0);
		if (!config || config.GetVarIndex(MATERIAL_ASSIGNS) == -1)
		{
			t.Close();
			Answer(resp, "error", UNSUPPORTED_TYPE, "the meta's first configuration has no MaterialAssigns (not a model); nothing was changed", "a model source file (.fbx)");
			return;
		}
		array<string> beforeSlots = {};
		ListAssigns(config.GetObjectArray(MATERIAL_ASSIGNS), beforeSlots);
		string slotPrefix = req.name + "=";
		bool known = false;
		foreach (string slot : beforeSlots)
		{
			resp.before.Insert(slot);
			if (slot.StartsWith(slotPrefix))
				known = true;
		}

		if (!req.confirm)
		{
			foreach (string kept : beforeSlots)
			{
				if (kept.StartsWith(slotPrefix))
					resp.after.Insert(slotPrefix + req.value);
				else
					resp.after.Insert(kept);
			}
			if (!known)
				resp.after.Insert(slotPrefix + req.value);
			t.Close();
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: nothing was assigned or written", "send confirm true to assign and save");
			return;
		}

		BaseContainerList assigns = config.SetObjectArray(MATERIAL_ASSIGNS);
		if (!assigns)
		{
			t.Close();
			Answer(resp, "error", ENGINE_FALSE, "SetObjectArray(MaterialAssigns) returned null; the meta was not saved", "read the meta back with wb_meta get");
			return;
		}
		// Declared at function scope: the Resource that owns a new MaterialAssignClass container must
		// outlive the Insert, the read back and the Save (review M1).
		Resource assignHolder = null;
		bool found = false;
		// Every Set and the Insert answer a bool (data/api/enfusion-classes.json); one false refuses the
		// save (review round 1, F3).
		bool wrote = true;
		int assignCount = assigns.Count();
		for (int i = 0; i < assignCount; i++)
		{
			BaseContainer assign = assigns.Get(i);
			if (!assign)
				continue;
			string sourceMaterial = "";
			assign.Get(SOURCE_MATERIAL, sourceMaterial);
			if (sourceMaterial == req.name)
			{
				wrote = assign.Set(ASSIGNED_MATERIAL, material);
				found = true;
				break;
			}
		}
		if (!found)
		{
			assignHolder = BaseContainerTools.CreateContainer(MATERIAL_ASSIGN_CLASS);
			BaseContainer created = null;
			if (assignHolder && assignHolder.IsValid() && assignHolder.GetResource())
				created = assignHolder.GetResource().ToBaseContainer();
			if (!created)
			{
				t.Close();
				Answer(resp, "error", ENGINE_FALSE, "CreateContainer(MaterialAssignClass) gave no container; the meta was not saved", "read the meta back with wb_meta get");
				return;
			}
			bool setSource = created.Set(SOURCE_MATERIAL, req.name);
			bool setAssigned = created.Set(ASSIGNED_MATERIAL, material);
			bool inserted = assigns.Insert(created, -1);
			wrote = setSource && setAssigned && inserted;
		}
		if (!wrote)
		{
			t.Close();
			Answer(resp, "error", ENGINE_FALSE, "a Set or the Insert of the slot " + req.name + " returned false; the meta was not saved", "read the meta back with wb_meta get");
			return;
		}

		array<string> afterSlots = {};
		ListAssigns(config.GetObjectArray(MATERIAL_ASSIGNS), afterSlots);
		bool holds = false;
		foreach (string now : afterSlots)
		{
			resp.after.Insert(now);
			if (now.StartsWith(slotPrefix) && SameMaterial(now.Substring(slotPrefix.Length(), now.Length() - slotPrefix.Length()), req.value))
				holds = true;
		}
		if (!holds)
		{
			t.Close();
			Answer(resp, "error", ENGINE_FALSE, "the slot " + req.name + " does not read back " + req.value + " after the write; the meta was not saved", "read the meta back with wb_meta get");
			return;
		}
		foreach (string had : beforeSlots)
		{
			if (had.StartsWith(slotPrefix))
				continue;
			if (afterSlots.Find(had) < 0)
			{
				t.Close();
				Answer(resp, "error", ENGINE_FALSE, "the slot " + had + " was lost by the write; the meta was not saved", "read the meta back with wb_meta get");
				return;
			}
		}
		t.m_Meta.Save();
		resp.saved = true;
		t.Close();
		Answer(resp, "ok", "", "material assigned and saved", "");
	}
}
