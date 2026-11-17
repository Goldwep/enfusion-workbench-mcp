/**
 * EMCP_WB_Diag.c - Diag Menu and Workbench environment handler of wb_diag (wave W8,
 * phase5-w8-spec.md section 2.4, DEC-076)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Diag", dispatching on "action":
 *   catalog  served by the TS tool (generated offline from DebugMenuID.c and the EDiagMenu enum);
 *            the handler refuses it INVALID_ARGUMENT and reads nothing
 *   get      option values by enum name: typename.StringToEnum over SCR_DebugMenuID, then EDiagMenu
 *            (checked back with typename.EnumToString), then DiagMenu.GetBool, GetValue,
 *            GetRangeValue, GetEngineValue or GetEngineRangeValue per kind; gameMode through
 *            WorldEditorAPI.IsGameMode
 *   info     Workbench.GetUserName, GetCwd, GetExecutableFilePath (out strings into locals this
 *            handler owns), GetCurrentGameProjectFile, GetGameProjectSettings + BaseContainer
 *            .GetClassName, GetPackedUtcTime + DateTimeUtcAsInt.GetYear/Month/Day/Hour/Minute/Second,
 *            GetWBScriptModule, GetWBGameScriptModule, and with cmdNames Workbench.GetModule of the
 *            module + WBModuleDef.GetCmdLine per name. userName goes back raw: the TS side redacts it
 *   set      one option at runtime: the getter, DiagMenu.SetValue, SetRangeValue, SetEngineValue or
 *            SetEngineRangeValue per kind, the getter again. The allow-list (policy.json
 *            diag.set_allow_list, DEC-076 OD-6) is checked by the TS tool before it sends set; this
 *            handler keeps no list of its own. Memory only: the caller restores with previous
 *   select   DiagMenu.SelectMenuByName or SelectMenuById, in play mode only (WRONG_MODE otherwise)
 *
 * Kinds (get, set): bool, value (script ids of SCR_DebugMenuID), range (script), engine and
 * engineRange (EDiagMenu ids). The default kind is value for a script name and engine for an
 * EDiagMenu name. Gates, refused UNPROVEN before any DiagMenu call until the main session flips the
 * constant after the probe passes: engine kinds on P-W8-08 (ENGINE_PROVEN); range on P-W8-07
 * (RANGE_PROVEN), because a float read of an option that holds a NaN or Inf raises the engine's
 * BadFloat modal (ECEN_ProbeSystem.DiagRead) and a range read was never made live.
 *
 * Shared rules (spec 1.2, 2.4). Ids travel as enum names and values as text (floats parsed with
 * EMCP_WB_Common.ParseFloat, ints with ParseInt). gameMode is read through Workbench.GetModule
 * (WorldEditor), which opens a closed World Editor (DEC-053): the messages say so; every World Editor
 * call goes through EMCP_WB_Common.NoWorldReason first. Engine pointers never travel through an out
 * parameter. Paths go back through EMCP_WB_Guard.ScrubHome.
 *
 * Not called on purpose (spec 2.4): DiagMenu.RegisterMenu, RegisterItem, RegisterBool,
 * RegisterRange and Unregister (registering is a mod's own init); the Workbench process, exit,
 * command and dialog calls (Appendix B, modal); ScriptModule.Call (W6 OD-8). No file method.
 *
 * Compile proof is probe P-W8-24 (no shipped handler calls GetCwd, GetUserName,
 * GetExecutableFilePath, GetGameProjectSettings, GetPackedUtcTime, the GetWB*ScriptModule calls or
 * GetCmdLine before this file).
 *
 * A refusal answers status refused, code, next and a message "CODE: text | next: step"
 * (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Diag.json.
 */

class EMCP_WB_DiagRequest : JsonApiStruct
{
	string action;
	// catalog (TS), select: a menu path or name
	string menu;
	// catalog (TS)
	string cursor;
	int limit;
	// get: SCR_DebugMenuID or EDiagMenu names
	ref array<string> names;
	// get: one kind for all names, or one per name
	ref array<string> kinds;
	// info: the module of cmdNames; default WorldEditor
	string module;
	// info: GetCmdLine names
	ref array<string> cmdNames;
	// set: one enum name
	string name;
	// set: bool, value, range, engine or engineRange
	string kind;
	// set: int, 0/1 or float as text
	string value;
	// select: a SCR_DebugMenuID value; -1 when not given
	int menuId;

	void EMCP_WB_DiagRequest()
	{
		names = {};
		kinds = {};
		cmdNames = {};

		RegV("action");
		RegV("menu");
		RegV("cursor");
		RegV("limit");
		RegV("names");
		RegV("kinds");
		RegV("module");
		RegV("cmdNames");
		RegV("name");
		RegV("kind");
		RegV("value");
		RegV("menuId");

		// Defaults for keys the request leaves out.
		limit = 0;
		menuId = -1;
	}
}

class EMCP_WB_DiagResponse : JsonApiStruct
{
	// ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string action;
	string code;
	string message;
	string next;
	// catalog (TS only)
	int total;
	string nextCursor;
	ref array<string> rows;
	// get: name=value, floats as text
	ref array<string> values;
	// get: names with no enum value
	ref array<string> missing;
	// get, info, set
	bool gameMode;
	// info
	string userName;
	string cwd;
	string executable;
	string projectFile;
	string projectSettingsClass;
	string utcTime;
	ref array<string> scriptModules;
	ref array<string> cmdLine;
	// set: values as text
	string previous;
	string readback;
	bool changed;
	// set: the read-back equals the value asked for, compared as numbers by kind (review round 1,
	// W8-DIAG-01)
	bool applied;
	// select
	string selected;

	void EMCP_WB_DiagResponse()
	{
		rows = {};
		values = {};
		missing = {};
		scriptModules = {};
		cmdLine = {};

		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("next");
		RegV("total");
		RegV("nextCursor");
		RegV("rows");
		RegV("values");
		RegV("missing");
		RegV("gameMode");
		RegV("userName");
		RegV("cwd");
		RegV("executable");
		RegV("projectFile");
		RegV("projectSettingsClass");
		RegV("utcTime");
		RegV("scriptModules");
		RegV("cmdLine");
		RegV("previous");
		RegV("readback");
		RegV("changed");
		RegV("applied");
		RegV("selected");
	}
}

//! One resolved option: its id, the enum that holds its name and the kind it is read with.
class EMCP_WB_DiagOption
{
	string m_Name;
	int m_Id;
	bool m_IsEngine;
	string m_Kind;
}

class EMCP_WB_DiagUtil
{
	static const string KIND_BOOL = "bool";
	static const string KIND_VALUE = "value";
	static const string KIND_RANGE = "range";
	static const string KIND_ENGINE = "engine";
	static const string KIND_ENGINE_RANGE = "engineRange";
	static const string KIND_LIST = "bool, value, range, engine, engineRange";
	//! Range reads and writes refuse UNPROVEN until the main session sets this after probe P-W8-07
	//! records a range option read and set with restore (a float read of a NaN or Inf raises the
	//! engine's BadFloat modal).
	static const bool RANGE_PROVEN = false;
	static const string RANGE_PROBE = "P-W8-07";
	//! Engine kinds (EDiagMenu ids) refuse UNPROVEN until the main session sets this after probe
	//! P-W8-08 (the EDiagMenu ids answer GetEngineValue).
	static const bool ENGINE_PROVEN = false;
	static const string ENGINE_PROBE = "P-W8-08";
	//! get: the most names one call takes (268 SCR_DebugMenuID + 7 EDiagMenu values).
	static const int NAMES_MAX = 300;
	//! info: the most cmdNames one call takes.
	static const int CMD_NAMES_MAX = 20;
	//! The longest enum, menu or cmd name taken.
	static const int NAME_LEN_MAX = 128;
	//! set: the longest value text taken.
	static const int VALUE_LEN_MAX = 64;
	//! set: the largest float magnitude taken. ParseFloat accepts "1e999", which ToFloat turns into
	//! Inf; a stored Inf raises the BadFloat modal on the next read, so it is refused before the call.
	static const float FLOAT_ABS_MAX = 1000000000.0;
	static const string DEFAULT_MODULE = "WorldEditor";
	static const string NOTE_GETMODULE = "gameMode reads Workbench.GetModule(WorldEditor), which opens a closed World Editor";
	static const string NEXT_CATALOG = "wb_diag catalog lists the names";
	static const string NEXT_PLAY = "wb_world play, then repeat the call; wb_world stop after";

	//------------------------------------------------------------------------------------------------
	//! Sets a refusal: status refused, code, next and the message "CODE: text | next: step".
	static void Refuse(EMCP_WB_DiagResponse resp, string code, string text, string nextStep)
	{
		resp.status = EMCP_WB_Guard.REFUSED;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! True when the World Editor runs a world in play mode. GetModule opens a closed World Editor
	//! (DEC-053). IsGameMode is called only after EMCP_WB_Common.NoWorldReason answers "" (a loaded
	//! world); with no world the answer is false.
	static bool InPlay()
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
			return false;
		WorldEditorAPI api = worldEditor.GetApi();
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
			return false;
		return api.IsGameMode();
	}

	//------------------------------------------------------------------------------------------------
	//! True when text is a usable name: not empty, at most NAME_LEN_MAX characters, no space,
	//! quote, '=' or control character.
	static bool IsPlainName(string text)
	{
		int len = text.Length();
		if (len == 0 || len > NAME_LEN_MAX)
			return false;
		for (int i = 0; i < len; i++)
		{
			string ch = text.Get(i);
			if (ch == " " || ch == "\"" || ch == "=" || ch == "\t" || ch == "\n" || ch == "\r")
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The id of an enum name, SCR_DebugMenuID first, then EDiagMenu; -1 when neither enum holds it.
	//! typename.StringToEnum is checked back with typename.EnumToString, so an unknown name never
	//! reaches a DiagMenu call. isEngine answers which enum holds it.
	static int IdOf(string enumName, out bool isEngine)
	{
		isEngine = false;
		if (!IsPlainName(enumName))
			return -1;
		int scriptId = typename.StringToEnum(SCR_DebugMenuID, enumName);
		if (scriptId >= 0 && typename.EnumToString(SCR_DebugMenuID, scriptId) == enumName)
			return scriptId;
		int engineId = typename.StringToEnum(EDiagMenu, enumName);
		if (engineId >= 0 && typename.EnumToString(EDiagMenu, engineId) == enumName)
		{
			isEngine = true;
			return engineId;
		}
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! True when kind is one of the five kinds.
	static bool IsKind(string kind)
	{
		return kind == KIND_BOOL || kind == KIND_VALUE || kind == KIND_RANGE || kind == KIND_ENGINE || kind == KIND_ENGINE_RANGE;
	}

	//------------------------------------------------------------------------------------------------
	//! True for the kinds that read and write a float.
	static bool IsFloatKind(string kind)
	{
		return kind == KIND_RANGE || kind == KIND_ENGINE_RANGE;
	}

	//------------------------------------------------------------------------------------------------
	//! The kind of an option: given, or the default (value for a script name, engine for an EDiagMenu
	//! name). Checked against the enum and the gates; "" with the response refused (INVALID_ARGUMENT,
	//! UNPROVEN). No DiagMenu call.
	static string KindFor(string enumName, bool isEngine, string given, EMCP_WB_DiagResponse resp)
	{
		string kind = given;
		if (kind == "")
		{
			if (isEngine)
				kind = KIND_ENGINE;
			else
				kind = KIND_VALUE;
		}
		if (!IsKind(kind))
		{
			Refuse(resp, "INVALID_ARGUMENT", "kind must be one of " + KIND_LIST + ", got '" + kind + "'", "pass a kind from wb_diag catalog");
			return "";
		}
		bool engineKind = kind == KIND_ENGINE || kind == KIND_ENGINE_RANGE;
		if (isEngine && !engineKind)
		{
			Refuse(resp, "INVALID_ARGUMENT", enumName + " is an EDiagMenu (engine) id; its kind is engine or engineRange, not " + kind, NEXT_CATALOG);
			return "";
		}
		if (!isEngine && engineKind)
		{
			Refuse(resp, "INVALID_ARGUMENT", enumName + " is a SCR_DebugMenuID (script) id; its kind is bool, value or range, not " + kind, NEXT_CATALOG);
			return "";
		}
		if (engineKind && !ENGINE_PROVEN)
		{
			Refuse(resp, "UNPROVEN", "engine kinds wait for probe " + ENGINE_PROBE + " (the EDiagMenu ids answer GetEngineValue); nothing was read or set", "the main session opens them after the probe passes");
			return "";
		}
		// Both float kinds wait for the range probe: engineRange reads a float too (BadFloat modal), so
		// opening ENGINE_PROVEN alone must not open it.
		if (IsFloatKind(kind) && !RANGE_PROVEN)
		{
			Refuse(resp, "UNPROVEN", kind + " waits for probe " + RANGE_PROBE + " (a float read of a NaN or Inf raises the engine's BadFloat modal); nothing was read or set", "read the option as value or bool, or wait for the probe");
			return "";
		}
		return kind;
	}

	//------------------------------------------------------------------------------------------------
	//! The current value of an option as text, by kind: bool "1" or "0", ints and floats as text.
	static string ReadText(int id, string kind)
	{
		if (kind == KIND_BOOL)
		{
			bool flag = DiagMenu.GetBool(id);
			if (flag)
				return "1";
			return "0";
		}
		if (kind == KIND_RANGE)
		{
			float rangeValue = DiagMenu.GetRangeValue(id);
			return rangeValue.ToString();
		}
		if (kind == KIND_ENGINE)
		{
			int engineValue = DiagMenu.GetEngineValue(id);
			return engineValue.ToString();
		}
		if (kind == KIND_ENGINE_RANGE)
		{
			float engineRange = DiagMenu.GetEngineRangeValue(id);
			return engineRange.ToString();
		}
		int intValue = DiagMenu.GetValue(id);
		return intValue.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! True when the option now holds the value asked for, read by kind and compared as a number:
	//! a bool as true or false, an int exactly, a float within a relative 1e-4 (ReadText's text is
	//! never compared with the request's).
	static bool Applied(int id, string kind, int wantedInt, float wantedFloat)
	{
		if (kind == KIND_BOOL)
			return DiagMenu.GetBool(id) == (wantedInt != 0);
		float gotFloat = 0;
		if (kind == KIND_RANGE)
			gotFloat = DiagMenu.GetRangeValue(id);
		else if (kind == KIND_ENGINE_RANGE)
			gotFloat = DiagMenu.GetEngineRangeValue(id);
		else if (kind == KIND_ENGINE)
			return DiagMenu.GetEngineValue(id) == wantedInt;
		else
			return DiagMenu.GetValue(id) == wantedInt;
		float tolerance = Math.AbsFloat(wantedFloat) * 0.0001;
		if (tolerance < 0.0001)
			tolerance = 0.0001;
		return Math.AbsFloat(gotFloat - wantedFloat) <= tolerance;
	}

	//------------------------------------------------------------------------------------------------
	//! Writes an option by kind: bool and value through SetValue, range through SetRangeValue,
	//! engine through SetEngineValue, engineRange through SetEngineRangeValue.
	static void WriteValue(int id, string kind, int wantedInt, float wantedFloat)
	{
		if (kind == KIND_RANGE)
			DiagMenu.SetRangeValue(id, wantedFloat);
		else if (kind == KIND_ENGINE)
			DiagMenu.SetEngineValue(id, wantedInt);
		else if (kind == KIND_ENGINE_RANGE)
			DiagMenu.SetEngineRangeValue(id, wantedFloat);
		else
			DiagMenu.SetValue(id, wantedInt);
	}

	//------------------------------------------------------------------------------------------------
	//! Parses a set value by kind: bool takes 0, 1, true or false; value and engine an int; range
	//! and engineRange a float. False with the response refused INVALID_ARGUMENT.
	static bool ParseValue(string text, string kind, out int wantedInt, out float wantedFloat, EMCP_WB_DiagResponse resp)
	{
		wantedInt = 0;
		wantedFloat = 0;
		if (text == "" || text.Length() > VALUE_LEN_MAX)
		{
			Refuse(resp, "INVALID_ARGUMENT", "value is required as text of at most " + VALUE_LEN_MAX.ToString() + " characters", "pass value as text, e.g. \"1\"");
			return false;
		}
		if (kind == KIND_BOOL)
		{
			if (text == "1" || text == "true")
			{
				wantedInt = 1;
				return true;
			}
			if (text == "0" || text == "false")
				return true;
			Refuse(resp, "INVALID_ARGUMENT", "a bool value is 0, 1, true or false, got '" + text + "'", "pass value \"0\" or \"1\"");
			return false;
		}
		if (IsFloatKind(kind))
		{
			if (EMCP_WB_Common.ParseFloat(text, wantedFloat) && wantedFloat <= FLOAT_ABS_MAX && wantedFloat >= -FLOAT_ABS_MAX)
				return true;
			wantedFloat = 0;
			Refuse(resp, "INVALID_ARGUMENT", "a " + kind + " value is a number within +-" + FLOAT_ABS_MAX.ToString() + " sent as text, got '" + text + "'", "pass value as text, e.g. \"0.5\"");
			return false;
		}
		if (EMCP_WB_Common.ParseInt(text, wantedInt))
			return true;
		wantedInt = 0;
		Refuse(resp, "INVALID_ARGUMENT", "a " + kind + " value is an integer sent as text, got '" + text + "'", "pass value as text, e.g. \"1\"");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! A packed UTC time as "YYYY-MM-DD hh:mm:ss" (DateTimeUtcAsInt getters).
	static string UtcText(DateTimeUtcAsInt packed)
	{
		int year = packed.GetYear();
		int month = packed.GetMonth();
		int day = packed.GetDay();
		int hour = packed.GetHour();
		int minute = packed.GetMinute();
		int second = packed.GetSecond();
		return year.ToString() + "-" + month.ToString(2) + "-" + day.ToString(2) + " " + hour.ToString(2) + ":" + minute.ToString(2) + ":" + second.ToString(2);
	}
}

class EMCP_WB_Diag : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_DiagRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_DiagRequest req = EMCP_WB_DiagRequest.Cast(request);
		EMCP_WB_DiagResponse resp = new EMCP_WB_DiagResponse();
		if (!req)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "catalog")
			DoCatalog(req, resp);
		else if (req.action == "get")
			DoGet(req, resp);
		else if (req.action == "info")
			DoInfo(req, resp);
		else if (req.action == "set")
			DoSet(req, resp);
		else if (req.action == "select")
			DoSelect(req, resp);
		else
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "unknown action '" + req.action + "'", "one of catalog, get, info, set, select");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! catalog: served by the TS tool from the offline catalog; the handler reads nothing.
	static void DoCatalog(EMCP_WB_DiagRequest req, EMCP_WB_DiagResponse resp)
	{
		EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "catalog is served by the TS tool from the offline diag catalog; the handler does not answer it", "call wb_diag catalog through the MCP server");
	}

	//------------------------------------------------------------------------------------------------
	//! get: every name resolved and every kind checked first (no DiagMenu call before a refusal),
	//! then one read per known name. Unknown names go to missing; none known refuses DIAG_UNKNOWN.
	static void DoGet(EMCP_WB_DiagRequest req, EMCP_WB_DiagResponse resp)
	{
		int nameCount = 0;
		if (req.names)
			nameCount = req.names.Count();
		if (nameCount == 0)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "names is required", EMCP_WB_DiagUtil.NEXT_CATALOG);
			return;
		}
		if (nameCount > EMCP_WB_DiagUtil.NAMES_MAX)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", nameCount.ToString() + " names; at most " + EMCP_WB_DiagUtil.NAMES_MAX.ToString(), "pass fewer names");
			return;
		}
		int kindCount = 0;
		if (req.kinds)
			kindCount = req.kinds.Count();
		if (kindCount > 1 && kindCount != nameCount)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "kinds holds " + kindCount.ToString() + " entries for " + nameCount.ToString() + " names: pass one kind for all, or one per name", "pass one kind, or as many kinds as names");
			return;
		}

		array<ref EMCP_WB_DiagOption> options = {};
		for (int i = 0; i < nameCount; i++)
		{
			string enumName = req.names.Get(i);
			bool isEngine = false;
			int id = EMCP_WB_DiagUtil.IdOf(enumName, isEngine);
			if (id < 0)
			{
				resp.missing.Insert(enumName);
				continue;
			}
			string given = "";
			if (kindCount == 1)
				given = req.kinds.Get(0);
			else if (kindCount > 1)
				given = req.kinds.Get(i);
			string kind = EMCP_WB_DiagUtil.KindFor(enumName, isEngine, given, resp);
			if (kind == "")
				return;
			EMCP_WB_DiagOption option = new EMCP_WB_DiagOption();
			option.m_Name = enumName;
			option.m_Id = id;
			option.m_IsEngine = isEngine;
			option.m_Kind = kind;
			options.Insert(option);
		}
		if (options.Count() == 0)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "DIAG_UNKNOWN", "no name is a SCR_DebugMenuID or EDiagMenu value (" + resp.missing.Count().ToString() + " missing)", EMCP_WB_DiagUtil.NEXT_CATALOG);
			return;
		}

		resp.gameMode = EMCP_WB_DiagUtil.InPlay();
		foreach (EMCP_WB_DiagOption resolved : options)
			resp.values.Insert(resolved.m_Name + "=" + EMCP_WB_DiagUtil.ReadText(resolved.m_Id, resolved.m_Kind));
		resp.status = "ok";
		resp.message = resp.values.Count().ToString() + " values read, " + resp.missing.Count().ToString() + " names missing; " + EMCP_WB_DiagUtil.NOTE_GETMODULE;
	}

	//------------------------------------------------------------------------------------------------
	//! info: the Workbench environment. Every out string is a local of this method. GetModule and
	//! GetCmdLine run only when cmdNames is given; an absent name is left out of cmdLine.
	static void DoInfo(EMCP_WB_DiagRequest req, EMCP_WB_DiagResponse resp)
	{
		string moduleName = req.module;
		if (moduleName == "")
			moduleName = EMCP_WB_DiagUtil.DEFAULT_MODULE;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(moduleName);
		if (!moduleType)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "module must be one of the present modules (the Particle Editor is never read); got '" + moduleName + "'", "use a module id of the shared vocabulary");
			return;
		}
		int cmdCount = 0;
		if (req.cmdNames)
			cmdCount = req.cmdNames.Count();
		if (cmdCount > EMCP_WB_DiagUtil.CMD_NAMES_MAX)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", cmdCount.ToString() + " cmdNames; at most " + EMCP_WB_DiagUtil.CMD_NAMES_MAX.ToString(), "pass fewer cmdNames");
			return;
		}
		for (int i = 0; i < cmdCount; i++)
		{
			string checkedName = req.cmdNames.Get(i);
			if (!EMCP_WB_DiagUtil.IsPlainName(checkedName))
			{
				EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "a cmdNames entry is a bare parameter name (no space, quote or '='), got '" + checkedName + "'", "pass names such as gproj or wbModule");
				return;
			}
		}
		WBModuleDef wbModule = null;
		if (cmdCount > 0)
		{
			wbModule = Workbench.GetModule(moduleType);
			if (!wbModule)
			{
				EMCP_WB_DiagUtil.Refuse(resp, "MODULE_NOT_OPEN", moduleName + " is not open: GetModule returned null; nothing was read", "wb_module open " + moduleName);
				return;
			}
		}

		string userName = "";
		Workbench.GetUserName(userName);
		resp.userName = userName;
		string currentDir = "";
		Workbench.GetCwd(currentDir);
		resp.cwd = EMCP_WB_Guard.ScrubHome(currentDir);
		string exePath = "";
		Workbench.GetExecutableFilePath(exePath);
		resp.executable = EMCP_WB_Guard.ScrubHome(exePath);
		resp.projectFile = EMCP_WB_Guard.ScrubHome(Workbench.GetCurrentGameProjectFile());
		BaseContainer settings = Workbench.GetGameProjectSettings();
		if (settings)
			resp.projectSettingsClass = settings.GetClassName();
		DateTimeUtcAsInt packed = Workbench.GetPackedUtcTime();
		resp.utcTime = EMCP_WB_DiagUtil.UtcText(packed);
		ScriptModule wbScripts = Workbench.GetWBScriptModule();
		bool hasWb = wbScripts != null;
		resp.scriptModules.Insert("WB=" + hasWb.ToString());
		ScriptModule wbGameScripts = Workbench.GetWBGameScriptModule();
		bool hasWbGame = wbGameScripts != null;
		resp.scriptModules.Insert("WBGame=" + hasWbGame.ToString());

		if (wbModule)
		{
			for (int c = 0; c < cmdCount; c++)
			{
				string cmdName = req.cmdNames.Get(c);
				string cmdValue = "";
				if (wbModule.GetCmdLine(cmdName, cmdValue))
					resp.cmdLine.Insert(cmdName + "=" + EMCP_WB_Guard.ScrubHome(cmdValue));
			}
		}

		resp.gameMode = EMCP_WB_DiagUtil.InPlay();
		resp.status = "ok";
		resp.message = "environment read";
		if (cmdCount > 0)
			resp.message = resp.message + "; " + resp.cmdLine.Count().ToString() + " of " + cmdCount.ToString() + " cmdNames present in " + moduleName + " (GetModule may have opened it)";
		resp.message = resp.message + "; " + EMCP_WB_DiagUtil.NOTE_GETMODULE;
	}

	//------------------------------------------------------------------------------------------------
	//! set: one option at runtime, after the TS tool's allow-list check. Name, kind and value are all
	//! checked before the first DiagMenu call; then the getter, the setter, the getter.
	static void DoSet(EMCP_WB_DiagRequest req, EMCP_WB_DiagResponse resp)
	{
		if (req.name == "")
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "name is required", EMCP_WB_DiagUtil.NEXT_CATALOG);
			return;
		}
		bool isEngine = false;
		int id = EMCP_WB_DiagUtil.IdOf(req.name, isEngine);
		if (id < 0)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "DIAG_UNKNOWN", "'" + req.name + "' is no SCR_DebugMenuID or EDiagMenu value; nothing was set", EMCP_WB_DiagUtil.NEXT_CATALOG);
			return;
		}
		string kind = EMCP_WB_DiagUtil.KindFor(req.name, isEngine, req.kind, resp);
		if (kind == "")
			return;
		int wantedInt = 0;
		float wantedFloat = 0;
		if (!EMCP_WB_DiagUtil.ParseValue(req.value, kind, wantedInt, wantedFloat, resp))
			return;

		resp.gameMode = EMCP_WB_DiagUtil.InPlay();
		resp.previous = EMCP_WB_DiagUtil.ReadText(id, kind);
		EMCP_WB_DiagUtil.WriteValue(id, kind, wantedInt, wantedFloat);
		resp.readback = EMCP_WB_DiagUtil.ReadText(id, kind);
		resp.changed = resp.previous != resp.readback;
		resp.applied = EMCP_WB_DiagUtil.Applied(id, kind, wantedInt, wantedFloat);
		resp.status = "ok";
		resp.message = req.name + " (" + kind + "): " + resp.previous + " -> " + resp.readback + " (runtime only; restore with set value " + resp.previous + "); " + EMCP_WB_DiagUtil.NOTE_GETMODULE;
		if (!resp.applied)
			resp.message = resp.message + "; the read-back is not the value asked for (" + req.value + "): the engine clamped or ignored it";
	}

	//------------------------------------------------------------------------------------------------
	//! select: shows a Diag Menu page, in play mode only. By name (menu) or by a SCR_DebugMenuID value
	//! (menuId, checked back through typename.EnumToString and StringToEnum); exactly one of the two.
	static void DoSelect(EMCP_WB_DiagRequest req, EMCP_WB_DiagResponse resp)
	{
		bool byName = req.menu != "";
		bool byId = req.menuId >= 0;
		if (byName == byId)
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "pass exactly one of menu (a registered menu name) and menuId (a SCR_DebugMenuID value)", "pass menu, or menuId");
			return;
		}
		if (byName && !EMCP_WB_DiagUtil.IsPlainName(req.menu))
		{
			EMCP_WB_DiagUtil.Refuse(resp, "INVALID_ARGUMENT", "menu must be a registered menu name of at most " + EMCP_WB_DiagUtil.NAME_LEN_MAX.ToString() + " characters with no space, quote or '='", EMCP_WB_DiagUtil.NEXT_CATALOG);
			return;
		}
		string idName = "";
		if (byId)
		{
			idName = typename.EnumToString(SCR_DebugMenuID, req.menuId);
			if (idName == "" || typename.StringToEnum(SCR_DebugMenuID, idName) != req.menuId)
			{
				EMCP_WB_DiagUtil.Refuse(resp, "DIAG_UNKNOWN", "menuId " + req.menuId.ToString() + " is no SCR_DebugMenuID value; nothing was selected", EMCP_WB_DiagUtil.NEXT_CATALOG);
				return;
			}
		}
		if (!EMCP_WB_DiagUtil.InPlay())
		{
			EMCP_WB_DiagUtil.Refuse(resp, "WRONG_MODE", "select runs in play mode only (the Diag Menu shows in the game view); GetModule may have opened the World Editor", EMCP_WB_DiagUtil.NEXT_PLAY);
			return;
		}
		if (byName)
		{
			DiagMenu.SelectMenuByName(req.menu);
			resp.selected = req.menu;
		}
		else
		{
			DiagMenu.SelectMenuById(req.menuId);
			resp.selected = idName;
		}
		resp.status = "ok";
		resp.message = "selected " + resp.selected + " (the engine answers no result: check the game view)";
	}
}
