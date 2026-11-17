/**
 * EMCP_WB_Plugin.c - Workbench plugin handler (DEC-048 package 3.3; reworked in wave W6,
 * phase5-w6-spec.md sections 1.2, 2.1 and 2.1.1, DEC-069)
 *
 * Actions:
 *   list         the plugins describe and getSettings may resolve (the read allow-list compiled in
 *                below); the full catalog (E03) is served by the server from the census ledger
 *   describe     {moduleName, className}: is the class a WorkbenchPlugin, and does the open module's
 *                GetPlugin return an instance (U10, DEC-042: yes for 3 plugins; the call brought the
 *                module window to the front for 1 of 3)
 *   getSettings  {moduleName, className, cursor, limit}: the instance's variables with type, whether an
 *                [Attribute] annotates them, and the current value (read only; the probe's pluginAttrs)
 *   setSettings  {moduleName, className, name, value, confirm}: one [Attribute] variable of a scalar
 *                type (bool, int, float, string, ResourceName, vector), value parsed against its
 *                type. Without confirm a dry run: the previous value and what would be written. With
 *                confirm refused NO_SETTER: the 1.9.0.37 index has no setter (typename
 *                SetVariableValue and EnScript.SetClassVar are absent) and a modded-class setter on
 *                vanilla plugins is rejected (DEC-069 OD-4); probe P-W6-03 decides. A write that
 *                persists to the registry stays refused until the owner rules (OD-5, OI-W6-1).
 *   run          {moduleName, className, confirm}: Run() of a class on the compiled run allow-list
 *                (spec 2.1.1, 13 classes). Every E03 modal class refuses PLUGIN_MODAL; each class's
 *                preconditions are checked before anything runs (PRECONDITION_UNMET). Without confirm
 *                only the preconditions are checked. With confirm a class runs only once probe
 *                P-W6-05 has proven it (RunProven); until then GATED. No method-name and no resources
 *                parameter (DEC-048, DEC-069 OD-3, OD-8).
 *
 * The entry points RunCommandline and Configure are refused by name and are never called. A class
 * is resolved for a read only when its module and name are on the read allow-list (data/census/
 * policy.json plugin_read_allow_list.allow_list); run uses the run allow-list (spec 2.1.1, policy
 * plugin_run_allow_list); anything else is NOT_ALLOWLISTED. Workbench.GetModule opens a module that
 * is closed: describe, getSettings, setSettings and the run precondition check may open one.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Plugin"
 */

class EMCP_WB_PluginRequest : JsonApiStruct
{
	string action;
	string moduleName;
	string className;
	string cursor;
	int limit;
	string name;
	string value;
	bool confirm;

	void EMCP_WB_PluginRequest()
	{
		RegV("action");
		RegV("moduleName");
		RegV("className");
		RegV("cursor");
		RegV("limit");
		RegV("name");
		RegV("value");
		RegV("confirm");
	}
}

class EMCP_WB_PluginResponse : JsonApiStruct
{
	string status;
	string action;
	string code;
	string message;
	string nextStep;
	string moduleName;
	string className;
	bool present;
	bool instance;
	string instanceClass;
	int variableCount;
	int attributeCount;
	int total;
	string nextCursor;
	string name;
	string type;
	string value;
	string previous;
	bool changed;
	bool ran;
	string entry;

	// Rows packed by OnPack: settings {name, type, attribute, value}; plugins {moduleName, className}.
	ref array<string> m_aRows;
	bool m_bPluginRows;

	void EMCP_WB_PluginResponse()
	{
		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("nextStep");
		RegV("moduleName");
		RegV("className");
		RegV("present");
		RegV("instance");
		RegV("instanceClass");
		RegV("variableCount");
		RegV("attributeCount");
		RegV("total");
		RegV("nextCursor");
		RegV("name");
		RegV("type");
		RegV("value");
		RegV("previous");
		RegV("changed");
		RegV("ran");
		RegV("entry");

		m_aRows = {};
		m_bPluginRows = false;
	}

	//! One settings row (four strings).
	void AddSetting(string settingName, string typeName, string attribute, string settingValue)
	{
		m_aRows.Insert(settingName);
		m_aRows.Insert(typeName);
		m_aRows.Insert(attribute);
		m_aRows.Insert(settingValue);
	}

	//! One allow-list row (two strings).
	void AddPlugin(string moduleId, string pluginClass)
	{
		m_bPluginRows = true;
		m_aRows.Insert(moduleId);
		m_aRows.Insert(pluginClass);
	}

	//! status, code, message and next of a refusal in one call.
	void Refuse(string refusalCode, string text, string step)
	{
		status = EMCP_WB_Guard.REFUSED;
		code = refusalCode;
		message = EMCP_WB_Guard.RefusalMessage(refusalCode, text, step);
		nextStep = step;
	}

	override void OnPack()
	{
		if (m_bPluginRows)
		{
			StartArray("plugins");
			for (int i = 0; i + 1 < m_aRows.Count(); i += 2)
			{
				StartObject("");
				StoreString("moduleName", m_aRows[i]);
				StoreString("className", m_aRows[i + 1]);
				EndObject();
			}
			EndArray();
			return;
		}

		StartArray("settings");
		for (int r = 0; r + 3 < m_aRows.Count(); r += 4)
		{
			StartObject("");
			StoreString("name", m_aRows[r]);
			StoreString("type", m_aRows[r + 1]);
			StoreString("attribute", m_aRows[r + 2]);
			StoreString("value", m_aRows[r + 3]);
			EndObject();
		}
		EndArray();
	}
}

class EMCP_WB_Plugin : NetApiHandler
{
	//! Rows per getSettings page: the default and the cap (design section 3 paging).
	static const int LIMIT_DEFAULT = 100;
	static const int LIMIT_MAX = 200;
	//! Plugin entry points this handler refuses by name and never calls.
	static const string NEVER_CALLED = "RunCommandline and Configure are never called";
	//! Placeholders a response shows instead of the project folder and a home folder.
	static const string PROJECT_PLACEHOLDER = "<project>";
	static const string HOME_PLACEHOLDER = "%USERPROFILE%";
	//! The one plugin entry point run calls.
	static const string RUN_ENTRY = "Run";
	//! Refusal codes of this handler beyond the shared ones (spec 1.2 rule 12).
	static const string PLUGIN_MODAL = "PLUGIN_MODAL";
	static const string PRECONDITION_UNMET = "PRECONDITION_UNMET";
	static const string NO_SETTER = "NO_SETTER";
	static const string GATED = "GATED";
	//! What a write of a plugin setting waits on (DEC-069 OD-4, OD-5).
	static const string NO_SETTER_TEXT = "this build has no compiled way to write a plugin setting (typename.SetVariableValue and EnScript.SetClassVar are absent from the 1.9.0.37 index; a modded-class setter is rejected, DEC-069 OD-4)";
	static const string NO_SETTER_NEXT = "read it with getSettings; probe P-W6-03 decides, and a write that persists to the registry waits on the owner (OI-W6-1)";
	//! The most entities AddPrefab may create in one run: browser selection times world selection.
	static const int ADD_PREFAB_MAX = 200;

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_PluginRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_PluginRequest req = EMCP_WB_PluginRequest.Cast(request);
		EMCP_WB_PluginResponse resp = new EMCP_WB_PluginResponse();
		resp.action = req.action;

		if (req.action == "list")
			ListPlugins(resp);
		else if (req.action == "describe")
			Describe(req, resp);
		else if (req.action == "getSettings")
			GetSettings(req, resp);
		else if (req.action == "setSettings")
			SetSettings(req, resp);
		else if (req.action == "run")
			RunPlugin(req, resp);
		else
			resp.Refuse("INVALID_ARGUMENT", "unknown action '" + req.action + "'", "use list, describe, getSettings, setSettings or run");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! True when the module and class are on the read allow-list compiled from data/census/policy.json
	//! plugin_read_allow_list.allow_list (a test keeps the two equal). Exact match, no case folding.
	static bool Listed(string moduleId, string pluginClass)
	{
		if (moduleId == "WorldEditor" && pluginClass == "SCR_SnapAndOrientToTerrainPlugin")
			return true;
		if (moduleId == "ScriptEditor" && pluginClass == "SCR_CopyClassAndMethodPlugin")
			return true;
		if (moduleId == "ScriptEditor" && pluginClass == "SCR_DebugLinePlugin")
			return true;
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! True when the module and class are on the run allow-list of spec 2.1.1 (policy
	//! plugin_run_allow_list): the 13 classes whose Run body was read and opens no dialog. Modules are
	//! the E03 catalog's (wbModules): SCR_CheckRuinModelsAndUsagePlugin is a Resource Manager plugin.
	static bool RunListed(string moduleId, string pluginClass)
	{
		if (moduleId == "WorldEditor" && pluginClass == "SCR_SnapAndOrientToTerrainPlugin")
			return true;
		if (moduleId == "WorldEditor" && pluginClass == "SCR_WrapEntitiesPlugin")
			return true;
		if (moduleId == "WorldEditor" && pluginClass == "SCR_AddPrefabToSelectedEntitiesPlugin")
			return true;
		if (moduleId == "WorldEditor" && pluginClass == "EntityOrientationTool")
			return true;
		if (moduleId == "WorldEditor" && pluginClass == "CameraOrientationTool")
			return true;
		if (moduleId == "ScriptEditor" && pluginClass == "SCR_CopyClassAndMethodPlugin")
			return true;
		if (moduleId == "ScriptEditor" && pluginClass == "SCR_DebugLinePlugin")
			return true;
		if (moduleId == "LocalizationEditor" && pluginClass == "SCR_LocEditedTextPlugin")
			return true;
		if (moduleId == "LocalizationEditor" && pluginClass == "SCR_LocStatusPlugin")
			return true;
		if (moduleId == "LocalizationEditor" && pluginClass == "SCR_LocLengthPlugin")
			return true;
		if (moduleId == "ResourceManager" && pluginClass == "SCR_CheckRuinModelsAndUsagePlugin")
			return true;
		if (moduleId == "ResourceManager" && pluginClass == "SCR_ReforgerEngineSettingsPlugin")
			return true;
		if (moduleId == "ResourceManager" && pluginClass == "SCR_ReforgerGameSettingsPlugin")
			return true;
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! Whether probe P-W6-05 has proven Run of the class (no window, no modal, the effect read back).
	//! One line per class of the run allow-list; a line turns true only on its P-W6-05 evidence, and
	//! the main session turns it. Until then run with confirm refuses GATED.
	static bool RunProven(string pluginClass)
	{
		if (pluginClass == "SCR_SnapAndOrientToTerrainPlugin")
			return false;
		if (pluginClass == "SCR_WrapEntitiesPlugin")
			return false;
		if (pluginClass == "SCR_AddPrefabToSelectedEntitiesPlugin")
			return false;
		if (pluginClass == "EntityOrientationTool")
			return false;
		if (pluginClass == "CameraOrientationTool")
			return true; // DEC-103
		if (pluginClass == "SCR_CopyClassAndMethodPlugin")
			return false;
		if (pluginClass == "SCR_DebugLinePlugin")
			return false;
		if (pluginClass == "SCR_LocEditedTextPlugin")
			return false;
		if (pluginClass == "SCR_LocStatusPlugin")
			return false;
		if (pluginClass == "SCR_LocLengthPlugin")
			return true; // DEC-103
		if (pluginClass == "SCR_CheckRuinModelsAndUsagePlugin")
			return true; // DEC-103
		if (pluginClass == "SCR_ReforgerEngineSettingsPlugin")
			return false;
		if (pluginClass == "SCR_ReforgerGameSettingsPlugin")
			return false;
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! True for the 71 classes the E03 catalog (1.9.0.37) measures modal in Run: their Run opens a
	//! dialog at depth 1, so run never calls it (spec 1.2 rule 7; the GUI path is wave W8).
	static bool IsModal(string pluginClass)
	{
		array<string> modal = {
			"BatchTextureProcessorPlugin", "CheckLocalizationPlugin", "EntityRelativePlugin",
			"ResaveMetaPlugin", "ResavePlugin", "ResourceProcessorPlugin",
			"SCR_AiScriptGeneratorPlugin", "SCR_AutocompletePlugin", "SCR_AutotestConfigValidationPlugin",
			"SCR_AutotestPlugin", "SCR_BIKIExportTerrainStatisticsPlugin", "SCR_BIKIFactionAssetsExportPlugin",
			"SCR_BasicCodeFormatterForcedPlugin", "SCR_BasicCodeFormatterPlugin",
			"SCR_BookmarkPlugin0", "SCR_BookmarkPlugin1", "SCR_BookmarkPlugin2", "SCR_BookmarkPlugin3",
			"SCR_BookmarkPlugin4", "SCR_BookmarkPlugin5", "SCR_BookmarkPlugin6", "SCR_BookmarkPlugin7",
			"SCR_BookmarkPlugin8", "SCR_BookmarkPlugin9",
			"SCR_ClassRenamingPlugin", "SCR_CreateEditablePrefabsPluginResourceManager",
			"SCR_CreateEditablePrefabsPlugin", "SCR_DamageAreaShapesPlugin", "SCR_DataToSpreadsheetPlugin",
			"SCR_DedicatedServerPlugin", "SCR_EditableEntityMaintenancePlugin", "SCR_EntityFlagsManagerPlugin",
			"SCR_EntitySpawnerPlugin", "SCR_ExportGeoDataPlugin", "SCR_FPSDiagnosticPlugin",
			"SCR_FindResourcesPlugin", "SCR_GameModeSetupPlugin", "SCR_GenerateControlsSchemePlugin",
			"SCR_GenerateLayoutClassPlugin", "SCR_ImageSetGenerator", "SCR_ImportShapefilePlugin",
			"SCR_LocLinkImagePlugin", "SCR_LocParserPlugin", "SCR_MarkShapesEditorOnlyPlugin",
			"SCR_MultiPhaseDestructionSoundlessPrefabSearchPlugin", "SCR_NewScriptPlugin",
			"SCR_NormalAlignedFloatersFinderPlugin", "SCR_ObjectImportPlugin",
			"SCR_PrefabEditingPluginResourceManager", "SCR_PrefabEditingPlugin",
			"SCR_PrefabStructureCreationPlugin", "SCR_PrefabStructureFillingPlugin", "SCR_PrefabValidatorPlugin",
			"SCR_ProjectileWindageDataGeneratorPlugin", "SCR_RegisterPlaceableEntitiesPlugin",
			"SCR_ScriptTemplatePlugin", "SCR_SocketSpawnerPluginWE", "SCR_SocketSpawnerPlugin",
			"SCR_TerrainEdgesFinderPlugin", "SCR_TerrainEntityVariantReplacementPlugin",
			"SCR_TerrainSlopeViewerPlugin", "SCR_UpdateAllEditablePrefabsPlugin", "SCR_VerifyItemsPlugin",
			"SCR_VerifySlotEntitiesPlugin", "SCR_WorldEntitiesStatisticsPlugin", "SCR_WorldSetupPlugin_Entities",
			"SCR_WorldSetupPlugin_GenericWorldEntity", "SearchXOBPlugin", "TranslationPlugin",
			"ValidateFBXPlugin", "WorldExporterPlugin"
		};
		return modal.Find(pluginClass) >= 0;
	}

	//------------------------------------------------------------------------------------------------
	//! The plugin entry points refused by name: a request naming one is refused before any lookup.
	static bool NeverCalled(string entryPoint)
	{
		return entryPoint == "RunCommandline" || entryPoint == "Configure";
	}

	//------------------------------------------------------------------------------------------------
	//! list: the read allow-list rows. No engine call.
	static void ListPlugins(EMCP_WB_PluginResponse resp)
	{
		resp.AddPlugin("WorldEditor", "SCR_SnapAndOrientToTerrainPlugin");
		resp.AddPlugin("ScriptEditor", "SCR_CopyClassAndMethodPlugin");
		resp.AddPlugin("ScriptEditor", "SCR_DebugLinePlugin");
		resp.total = 3;
		resp.status = "ok";
		resp.message = "allow-listed plugins; the full catalog is served from the census ledger";
	}

	//------------------------------------------------------------------------------------------------
	//! The plugin instance of the request's module and class, or null with the refusal or error in
	//! the response. The module must be one of the 9 present (never ParticleEditor for a read); the
	//! class must be on the read allow-list and inherit WorkbenchPlugin. Calls exactly what the probe's
	//! FindPlugin calls (mod-dev/probe/ECEN_ProbeModules.c). GetModule opens a closed module.
	static WorkbenchPlugin FindPlugin(EMCP_WB_PluginRequest req, EMCP_WB_PluginResponse resp)
	{
		string moduleName = req.moduleName;
		string pluginClass = req.className;
		resp.moduleName = moduleName;
		resp.className = pluginClass;
		resp.present = false;
		resp.instance = false;

		if (pluginClass == "" || moduleName == "")
		{
			resp.Refuse("INVALID_ARGUMENT", "module and className are required", "name the module and the plugin class");
			return null;
		}
		if (NeverCalled(pluginClass))
		{
			resp.Refuse("INVALID_ARGUMENT", NEVER_CALLED, "name a plugin class");
			return null;
		}

		if (moduleName == "ParticleEditor")
		{
			resp.Refuse("MODULE_NOT_SUPPORTED", "the Particle Editor is never read (its module read crashed the Workbench, DEC-042)", "use wb_module open, front or close for ParticleEditor");
			return null;
		}
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(moduleName);
		if (!moduleType)
		{
			resp.Refuse("INVALID_ARGUMENT", "module must be one of the 9 present modules; got '" + moduleName + "'", "use a module id of the shared vocabulary");
			return null;
		}

		if (!Listed(moduleName, pluginClass))
		{
			resp.Refuse("NOT_ALLOWLISTED", moduleName + " " + pluginClass + " is not on the plugin allow-list; nothing was resolved", "propose the class for data/census/policy.json");
			return null;
		}

		typename pluginType = pluginClass.ToType();
		if (!pluginType)
		{
			resp.status = "error";
			resp.message = "no script class named " + pluginClass;
			return null;
		}
		if (!pluginType.IsInherited(WorkbenchPlugin))
		{
			resp.status = "error";
			resp.message = pluginClass + " does not inherit WorkbenchPlugin";
			return null;
		}
		resp.present = true;

		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Refuse("MODULE_NOT_OPEN", "module " + moduleName + " is not open: GetModule returned null", "open the module first: wb_module open");
			return null;
		}

		WorkbenchPlugin plugin = wbModule.GetPlugin(pluginType);
		if (!plugin)
		{
			resp.status = "ok";
			resp.message = "GetPlugin returned null";
			return null;
		}
		resp.instance = true;
		resp.instanceClass = plugin.ClassName();
		return plugin;
	}

	//------------------------------------------------------------------------------------------------
	//! describe: presence and instance only.
	static void Describe(EMCP_WB_PluginRequest req, EMCP_WB_PluginResponse resp)
	{
		WorkbenchPlugin plugin = FindPlugin(req, resp);
		if (!plugin)
			return;
		resp.status = "ok";
		resp.message = "GetPlugin returned an instance";
	}

	//------------------------------------------------------------------------------------------------
	//! getSettings: one page of the instance's variables (name, type, attribute, value). Read only:
	//! nothing is written to the instance. The probe's pluginAttrs, with the shared paging.
	static void GetSettings(EMCP_WB_PluginRequest req, EMCP_WB_PluginResponse resp)
	{
		int start = 0;
		string cursor = req.cursor;
		if (cursor != "" && (!EMCP_WB_Common.ParseInt(cursor, start) || start < 0))
		{
			resp.Refuse("INVALID_ARGUMENT", "cursor must be the nextCursor of an earlier page", "omit cursor for the first page");
			return;
		}
		int limit = req.limit;
		if (limit <= 0)
			limit = LIMIT_DEFAULT;
		if (limit > LIMIT_MAX)
			limit = LIMIT_MAX;

		WorkbenchPlugin plugin = FindPlugin(req, resp);
		if (!plugin)
		{
			// GetPlugin returned null: describe answers ok with instance false, but there are no
			// settings to read, so getSettings is an error (the probe's FindPlugin fails here).
			if (resp.status == "ok")
				resp.status = "error";
			return;
		}

		typename instanceType = plugin.Type();
		int count = instanceType.GetVariableCount();
		int annotated = 0;
		for (int i = 0; i < count; i++)
		{
			bool isAttribute = HasAttribute(instanceType, i);
			if (isAttribute)
				annotated++;
			if (i < start || i >= start + limit)
				continue;

			string name = instanceType.GetVariableName(i);
			typename varType = instanceType.GetVariableType(i);
			// Persisted plugin settings can hold user paths: ShowPath keeps the account name out.
			resp.AddSetting(name, varType.ToString(), isAttribute.ToString(), ShowPath(VariableValue(instanceType, plugin, i)));
		}

		resp.variableCount = count;
		resp.attributeCount = annotated;
		resp.total = count;
		resp.nextCursor = "";
		if (start + limit < count)
		{
			int nextStart = start + limit;
			resp.nextCursor = nextStart.ToString();
		}
		resp.status = "ok";
		resp.message = "plugin variables read";
	}

	//------------------------------------------------------------------------------------------------
	//! Whether an [Attribute] annotates variable i of owner (GetVariableAttributes, the probe's read).
	static bool HasAttribute(typename instanceType, int i)
	{
		array<Class> attrs = {};
		instanceType.GetVariableAttributes(i, attrs);
		bool isAttribute = false;
		for (int a = 0; a < attrs.Count(); a++)
		{
			Attribute attr = Attribute.Cast(attrs.Get(a));
			if (attr)
				isAttribute = true;
		}
		return isAttribute;
	}

	//------------------------------------------------------------------------------------------------
	//! setSettings (spec 2.1, DEC-069 OD-4 and OD-5): read allow-list, project found, one [Attribute]
	//! variable of a scalar type, the value parsed against that type. Without confirm a dry run that
	//! reads the previous value and writes nothing; with confirm NO_SETTER (no setter compiles in this
	//! build). Nothing here writes the instance.
	static void SetSettings(EMCP_WB_PluginRequest req, EMCP_WB_PluginResponse resp)
	{
		string varName = req.name;
		string wanted = req.value;
		resp.moduleName = req.moduleName;
		resp.className = req.className;
		resp.name = varName;
		resp.changed = false;

		if (varName == "")
		{
			resp.Refuse("INVALID_ARGUMENT", "name (the variable) is required", "name one variable from getSettings");
			return;
		}
		if (!Listed(req.moduleName, req.className))
		{
			resp.Refuse("NOT_ALLOWLISTED", req.moduleName + " " + req.className + " is not on the plugin allow-list; nothing was resolved", "propose the class for data/census/policy.json");
			return;
		}
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			resp.Refuse(EMCP_WB_Guard.NOT_IN_PROJECT, "setSettings needs the handlers installed in the open project; nothing was resolved", "install the handlers in the project you have open");
			return;
		}

		WorkbenchPlugin plugin = FindPlugin(req, resp);
		if (!plugin)
		{
			if (resp.status == "ok")
				resp.status = "error";
			return;
		}

		typename instanceType = plugin.Type();
		int count = instanceType.GetVariableCount();
		int index = -1;
		for (int i = 0; i < count; i++)
		{
			if (instanceType.GetVariableName(i) == varName)
			{
				index = i;
				break;
			}
		}
		if (index < 0)
		{
			resp.Refuse("INVALID_ARGUMENT", req.className + " has no variable named '" + varName + "'", "name one variable from getSettings");
			return;
		}
		if (!HasAttribute(instanceType, index))
		{
			resp.Refuse("INVALID_ARGUMENT", varName + " carries no [Attribute]; only plugin settings are written", "name an attribute variable from getSettings");
			return;
		}

		typename varType = instanceType.GetVariableType(index);
		resp.type = varType.ToString();
		string normal = "";
		string why = "";
		if (!NormalValue(varType, wanted, normal, why))
		{
			resp.Refuse("INVALID_ARGUMENT", why, "send the value as text of the variable's type (floats and vectors as text)");
			return;
		}

		resp.previous = ShowPath(VariableValue(instanceType, plugin, index));
		resp.value = resp.previous;
		if (!req.confirm)
		{
			resp.status = "ok";
			resp.message = "dry run: would set " + varName + " (" + resp.type + ") from '" + resp.previous + "' to '" + ShowPath(normal) + "'; nothing was written. With confirm true this build refuses " + NO_SETTER + " (probe P-W6-03)";
			resp.nextStep = NO_SETTER_NEXT;
			return;
		}

		resp.Refuse(NO_SETTER, NO_SETTER_TEXT + "; nothing was written", NO_SETTER_NEXT);
	}

	//------------------------------------------------------------------------------------------------
	//! The value as the text a scalar of varType reads back as, or false with why: int (EMCP_WB_Common
	//! ParseInt), float (ParseFloat; floats travel as text), bool (true, false, 1, 0), string,
	//! ResourceName (as sent), vector ("x y z", ParseVectorString). Any other type (an enum, an array,
	//! an object) is refused by name: only these scalars are written (spec 2.1; enums wait on P-W6-02).
	static bool NormalValue(typename varType, string text, out string normal, out string why)
	{
		normal = "";
		why = "";
		if (varType == int)
		{
			int intValue = 0;
			if (!EMCP_WB_Common.ParseInt(text, intValue))
			{
				why = "'" + text + "' is not an int";
				return false;
			}
			normal = intValue.ToString();
			return true;
		}
		if (varType == float)
		{
			float floatValue = 0;
			if (!EMCP_WB_Common.ParseFloat(text, floatValue))
			{
				why = "'" + text + "' is not a float";
				return false;
			}
			normal = floatValue.ToString();
			return true;
		}
		if (varType == bool)
		{
			if (text == "true" || text == "1")
			{
				normal = "true";
				return true;
			}
			if (text == "false" || text == "0")
			{
				normal = "false";
				return true;
			}
			why = "'" + text + "' is not a bool (true, false, 1 or 0)";
			return false;
		}
		if (varType == string || varType == ResourceName)
		{
			normal = text;
			return true;
		}
		if (varType == vector)
		{
			vector vectorValue = vector.Zero;
			string vectorWhy = "";
			if (!EMCP_WB_Common.ParseVectorString(text, vectorValue, vectorWhy))
			{
				why = vectorWhy;
				return false;
			}
			normal = vectorValue.ToString(false);
			return true;
		}
		why = "type " + varType.ToString() + " is not written: only bool, int, float, string, ResourceName and vector settings are";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! run (spec 2.1 and 2.1.1): the checks in order, then Run of the instance. Request checks first
	//! (no engine call): class and module given, not an entry point, a present module, not an E03 modal
	//! class (PLUGIN_MODAL), on the run allow-list (NOT_ALLOWLISTED), the project found
	//! (NOT_IN_PROJECT); then the class exists and inherits WorkbenchPlugin, then its preconditions
	//! (PRECONDITION_UNMET, MODULE_NOT_OPEN). Without confirm the answer ends there. With confirm the
	//! class must be proven by P-W6-05 (GATED otherwise); only then are GetPlugin and Run called.
	static void RunPlugin(EMCP_WB_PluginRequest req, EMCP_WB_PluginResponse resp)
	{
		string moduleName = req.moduleName;
		string pluginClass = req.className;
		resp.moduleName = moduleName;
		resp.className = pluginClass;
		resp.ran = false;
		resp.entry = RUN_ENTRY;

		if (pluginClass == "" || moduleName == "")
		{
			resp.Refuse("INVALID_ARGUMENT", "module and className are required", "name the module and the plugin class");
			return;
		}
		if (NeverCalled(pluginClass))
		{
			resp.Refuse("INVALID_ARGUMENT", NEVER_CALLED, "name a plugin class");
			return;
		}
		if (moduleName == "ParticleEditor")
		{
			resp.Refuse("MODULE_NOT_SUPPORTED", "the Particle Editor is never read (its module read crashed the Workbench, DEC-042)", "use wb_module open, front or close for ParticleEditor");
			return;
		}
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(moduleName);
		if (!moduleType)
		{
			resp.Refuse("INVALID_ARGUMENT", "module must be one of the 9 present modules; got '" + moduleName + "'", "use a module id of the shared vocabulary");
			return;
		}
		if (IsModal(pluginClass))
		{
			resp.Refuse(PLUGIN_MODAL, pluginClass + "'s Run opens a dialog (E03); it is never run from here; nothing was run", "use the GUI path, wave W8");
			return;
		}
		if (!RunListed(moduleName, pluginClass))
		{
			resp.Refuse("NOT_ALLOWLISTED", moduleName + " " + pluginClass + " is not on the plugin run allow-list; nothing was run", "the run allow-list is spec 2.1.1 (policy plugin_run_allow_list)");
			return;
		}
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			resp.Refuse(EMCP_WB_Guard.NOT_IN_PROJECT, "run needs the handlers installed in the open project; nothing was run", "install the handlers in the project you have open");
			return;
		}

		typename pluginType = pluginClass.ToType();
		if (!pluginType)
		{
			resp.status = "error";
			resp.message = "no script class named " + pluginClass + "; nothing was run";
			return;
		}
		if (!pluginType.IsInherited(WorkbenchPlugin))
		{
			resp.status = "error";
			resp.message = pluginClass + " does not inherit WorkbenchPlugin; nothing was run";
			return;
		}

		string unmetCode = "";
		string unmetWhy = "";
		if (!Preconditions(pluginClass, unmetCode, unmetWhy))
		{
			resp.Refuse(unmetCode, unmetWhy + "; nothing was run", PreconditionNext(pluginClass));
			return;
		}

		if (!req.confirm)
		{
			resp.status = "ok";
			resp.message = "dry run: the preconditions of " + pluginClass + " are met (GetModule opens a closed module); nothing was run; resend with confirm true";
			if (!RunProven(pluginClass))
				resp.message = resp.message + " once probe P-W6-05 has proven its Run (until then confirm true refuses " + GATED + ")";
			resp.nextStep = "run with confirm true";
			return;
		}

		if (!RunProven(pluginClass))
		{
			resp.Refuse(GATED, "Run of " + pluginClass + " waits for probe P-W6-05 (no window, no modal, its effect read back); the preconditions are met; nothing was run", "the main session opens the class on its P-W6-05 evidence");
			return;
		}

		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Refuse("MODULE_NOT_OPEN", "module " + moduleName + " is not open: GetModule returned null; nothing was run", "open the module first: wb_module open");
			return;
		}
		WorkbenchPlugin plugin = wbModule.GetPlugin(pluginType);
		if (!plugin)
		{
			resp.status = "error";
			resp.message = "GetPlugin returned null for " + pluginClass + "; nothing was run";
			return;
		}

		plugin.Run();
		resp.ran = true;
		resp.status = "ok";
		resp.message = "Run of " + pluginClass + " returned";
		resp.nextStep = Oracle(pluginClass);
	}

	//------------------------------------------------------------------------------------------------
	//! The preconditions of one class of the run allow-list (spec 2.1.1), checked before Run so that
	//! no vanilla error path is reached half-way; false with the code (PRECONDITION_UNMET or
	//! MODULE_NOT_OPEN) and why. A class without a check here is unmet: a new list entry needs one.
	static bool Preconditions(string pluginClass, out string unmetCode, out string unmetWhy)
	{
		unmetCode = PRECONDITION_UNMET;
		unmetWhy = "";
		if (pluginClass == "SCR_SnapAndOrientToTerrainPlugin")
			return WorldReady(1, -1, true, false, unmetCode, unmetWhy);
		if (pluginClass == "SCR_WrapEntitiesPlugin")
			return WorldReady(1, -1, true, false, unmetCode, unmetWhy);
		if (pluginClass == "SCR_AddPrefabToSelectedEntitiesPlugin")
			return WorldReady(1, -1, true, true, unmetCode, unmetWhy);
		if (pluginClass == "EntityOrientationTool")
			return WorldReady(1, 1, true, false, unmetCode, unmetWhy);
		if (pluginClass == "CameraOrientationTool")
			return WorldReady(1, 1, false, false, unmetCode, unmetWhy);
		if (pluginClass == "SCR_CopyClassAndMethodPlugin")
			return ScriptReady(false, unmetCode, unmetWhy);
		if (pluginClass == "SCR_DebugLinePlugin")
			return ScriptReady(true, unmetCode, unmetWhy);
		if (pluginClass == "SCR_LocEditedTextPlugin")
			return TableReady(true, true, unmetCode, unmetWhy);
		if (pluginClass == "SCR_LocStatusPlugin")
			return TableReady(true, false, unmetCode, unmetWhy);
		if (pluginClass == "SCR_LocLengthPlugin")
			return TableReady(false, false, unmetCode, unmetWhy);
		if (pluginClass == "SCR_CheckRuinModelsAndUsagePlugin")
			return ResourceManagerReady(unmetCode, unmetWhy);
		if (pluginClass == "SCR_ReforgerEngineSettingsPlugin" || pluginClass == "SCR_ReforgerGameSettingsPlugin")
		{
			// Run calls SetOpenedResource on a $profile settings file: it replaces the Resource
			// Manager's opened document, and no proven call tells whether that document holds
			// unsaved edits (a replace over them raises the engine's save prompt). Unmet until one is.
			unmetWhy = pluginClass + " replaces the Resource Manager's opened document (SetOpenedResource of a $profile settings file), and no proven call tells whether that document holds unsaved edits";
			return false;
		}
		unmetWhy = pluginClass + " has no precondition check in this handler";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! World Editor plugins: the module answers, a world is loaded (EMCP_WB_Common.NoWorldReason), not
	//! play mode, not prefab edit mode when editOnly, at least minSelected selected (exactly
	//! exactSelected when that is not -1), every selected source resolves to an entity (the vanilla
	//! bodies call methods on them unchecked), and for browserPrefabs at least one .et selected in the
	//! Resource Browser with selected prefabs times selected entities at most ADD_PREFAB_MAX.
	static bool WorldReady(int minSelected, int exactSelected, bool editOnly, bool browserPrefabs, out string unmetCode, out string unmetWhy)
	{
		unmetCode = PRECONDITION_UNMET;
		unmetWhy = "";
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			unmetCode = "MODULE_NOT_OPEN";
			unmetWhy = "the World Editor is not open: GetModule returned null";
			return false;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			unmetWhy = noWorld;
			return false;
		}
		if (api.IsGameMode())
		{
			unmetWhy = "the World Editor is in play mode";
			return false;
		}
		if (editOnly && worldEditor.IsPrefabEditMode())
		{
			unmetWhy = "the World Editor is in prefab edit mode";
			return false;
		}

		int selectedCount = api.GetSelectedEntitiesCount();
		if (selectedCount < minSelected)
		{
			unmetWhy = "at least " + minSelected.ToString() + " entity must be selected; " + selectedCount.ToString() + " selected";
			return false;
		}
		if (exactSelected >= 0 && selectedCount != exactSelected)
		{
			unmetWhy = "exactly " + exactSelected.ToString() + " entity must be selected; " + selectedCount.ToString() + " selected";
			return false;
		}
		for (int i = 0; i < selectedCount; i++)
		{
			IEntitySource selected = api.GetSelectedEntity(i);
			if (!selected)
			{
				unmetWhy = "selected entity " + i.ToString() + " has no source";
				return false;
			}
			if (!api.SourceToEntity(selected))
			{
				unmetWhy = "selected entity " + i.ToString() + " has no runtime entity";
				return false;
			}
		}

		if (!browserPrefabs)
			return true;

		array<ResourceName> picked = {};
		worldEditor.GetResourceBrowserSelection(picked.Insert, true);
		int pickedCount = picked.Count();
		if (pickedCount < 1)
		{
			unmetWhy = "no prefab is selected in the World Editor's Resource Browser";
			return false;
		}
		for (int p = 0; p < pickedCount; p++)
		{
			string pickedName = picked.Get(p);
			pickedName.ToLower();
			if (!pickedName.EndsWith(".et"))
			{
				unmetWhy = "the Resource Browser selection holds a resource that is not a prefab (.et): " + EMCP_WB_Guard.ScrubHome(picked.Get(p));
				return false;
			}
		}
		if (pickedCount * selectedCount > ADD_PREFAB_MAX)
		{
			unmetWhy = pickedCount.ToString() + " prefabs times " + selectedCount.ToString() + " entities is more than " + ADD_PREFAB_MAX.ToString() + " entities in one run";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Script Editor plugins: the module answers, a .c file is open (EMCP_WB_ScriptEditorUtil.ReadDoc,
	//! the Script Editor handler's read), its caret line lies inside the file, and for inProject the
	//! file is the open project's (ReadDoc's TargetExistsInProject classification).
	static bool ScriptReady(bool inProject, out string unmetCode, out string unmetWhy)
	{
		unmetCode = PRECONDITION_UNMET;
		unmetWhy = "";
		ScriptEditor scriptEditor = Workbench.GetModule(ScriptEditor);
		if (!scriptEditor)
		{
			unmetCode = "MODULE_NOT_OPEN";
			unmetWhy = "the Script Editor is not open: GetModule returned null";
			return false;
		}
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		EMCP_WB_ScriptEditorUtil.ReadDoc(scriptEditor, doc);
		if (!doc.m_Opened)
		{
			unmetWhy = doc.m_Why;
			return false;
		}
		string folded = EMCP_WB_Guard.Fold(doc.m_File);
		if (!folded.EndsWith(".c"))
		{
			unmetWhy = "the open file is not a script (.c): " + doc.m_Shown;
			return false;
		}
		int caret = scriptEditor.GetCurrentLine();
		int lineCount = scriptEditor.GetLinesCount();
		if (caret < 0 || caret >= lineCount)
		{
			unmetWhy = "the caret line " + caret.ToString() + " is outside the file's " + lineCount.ToString() + " lines";
			return false;
		}
		if (inProject && !doc.m_InProject)
		{
			unmetWhy = "the open file is not a file of the open project: " + doc.m_Why;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Localization Editor plugins: the module answers, a string table is open with an Items array,
	//! and for needSelection at least one row selected with every index inside Items. For editsTable
	//! (SCR_LocEditedTextPlugin moves Target_en_us_edited into Target_en_us): the table names the
	//! project as its only source addon (EMCP_WB_Guard.SourceAddonsAreOnly, an empty list fails), and
	//! no selected edit would open SCR_LocStatusPlugin's dialog (EMCP_WB_LocalizationUtil.ModalHazard,
	//! the String Editor handler's check, on the two edits Run makes per row).
	static bool TableReady(bool needSelection, bool editsTable, out string unmetCode, out string unmetWhy)
	{
		unmetCode = PRECONDITION_UNMET;
		unmetWhy = "";
		LocalizationEditor locEditor = Workbench.GetModule(LocalizationEditor);
		if (!locEditor)
		{
			unmetCode = "MODULE_NOT_OPEN";
			unmetWhy = "the Localization Editor is not open: GetModule returned null";
			return false;
		}
		BaseContainer table = locEditor.GetTable();
		if (!table)
		{
			unmetWhy = "no string table is open in the Localization Editor";
			return false;
		}
		BaseContainerList items = table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		if (!items)
		{
			unmetWhy = "the open table has no Items array";
			return false;
		}
		if (!needSelection)
			return true;

		int itemCount = items.Count();
		array<int> selected = {};
		locEditor.GetSelectedRows(selected);
		if (selected.Count() < 1)
		{
			unmetWhy = "no row is selected in the Localization Editor";
			return false;
		}
		for (int s = 0; s < selected.Count(); s++)
		{
			int row = selected.Get(s);
			if (row < 0 || row >= itemCount)
			{
				unmetWhy = "selected row " + row.ToString() + " is outside the table's " + itemCount.ToString() + " items";
				return false;
			}
		}
		if (!editsTable)
			return true;

		string sourceAddons = "";
		if (!EMCP_WB_Guard.SourceAddonsAreOnly(table, EMCP_WB_Guard.ProjectId(), sourceAddons) || sourceAddons == "")
		{
			unmetWhy = "the open table is not proven the project's (its source addons: '" + sourceAddons + "')";
			return false;
		}
		for (int e = 0; e < selected.Count(); e++)
		{
			BaseContainer item = items.Get(selected.Get(e));
			if (!item)
			{
				unmetWhy = "selected row " + selected.Get(e).ToString() + " has no item";
				return false;
			}
			if (item.GetVarIndex(EMCP_WB_LocalizationUtil.VAR_TARGET) < 0 || item.GetVarIndex(EMCP_WB_LocalizationUtil.VAR_TARGET_EDITED) < 0)
			{
				unmetWhy = "selected row " + selected.Get(e).ToString() + " has no " + EMCP_WB_LocalizationUtil.VAR_TARGET + " or " + EMCP_WB_LocalizationUtil.VAR_TARGET_EDITED;
				return false;
			}
			string edited = "";
			item.Get(EMCP_WB_LocalizationUtil.VAR_TARGET_EDITED, edited);
			if (edited == "")
				continue;
			array<string> fieldNames = {EMCP_WB_LocalizationUtil.VAR_TARGET, EMCP_WB_LocalizationUtil.VAR_TARGET_EDITED};
			array<string> encoded = {edited, ""};
			int statusNow = 0;
			bool hasStatus = EMCP_WB_LocalizationUtil.StatusOf(item, statusNow);
			string hazard = EMCP_WB_LocalizationUtil.ModalHazard(item, fieldNames, encoded, hasStatus, statusNow);
			if (hazard != "")
			{
				unmetWhy = "selected row " + selected.Get(e).ToString() + ": " + hazard;
				return false;
			}
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Resource Manager plugins that only read: the module answers.
	static bool ResourceManagerReady(out string unmetCode, out string unmetWhy)
	{
		unmetCode = PRECONDITION_UNMET;
		unmetWhy = "";
		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
		{
			unmetCode = "MODULE_NOT_OPEN";
			unmetWhy = "the Resource Manager is not open: GetModule returned null";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! What to set up when a class's preconditions are unmet.
	static string PreconditionNext(string pluginClass)
	{
		if (pluginClass == "SCR_AddPrefabToSelectedEntitiesPlugin")
			return "load a world in edit mode, select the entities (wb_view select) and the prefabs in the Resource Browser (wb_world browserSelection reads it)";
		if (pluginClass == "EntityOrientationTool" || pluginClass == "CameraOrientationTool")
			return "load a world in edit mode and select exactly one entity (wb_view select)";
		if (pluginClass == "SCR_SnapAndOrientToTerrainPlugin" || pluginClass == "SCR_WrapEntitiesPlugin")
			return "load a world in edit mode and select the entities (wb_view select)";
		if (pluginClass == "SCR_CopyClassAndMethodPlugin" || pluginClass == "SCR_DebugLinePlugin")
			return "open a .c file of the project in the Script Editor (wb_script_editor open) and place the caret";
		if (pluginClass == "SCR_LocEditedTextPlugin" || pluginClass == "SCR_LocStatusPlugin" || pluginClass == "SCR_LocLengthPlugin")
			return "open a .st table of the project (wb_localization open) and select rows";
		if (pluginClass == "SCR_ReforgerEngineSettingsPlugin" || pluginClass == "SCR_ReforgerGameSettingsPlugin")
			return "open the settings file by hand; run waits for a proven unsaved-document check";
		return "open the plugin's module (wb_module open)";
	}

	//------------------------------------------------------------------------------------------------
	//! Where the effect of a Run reads back (spec 2.1.1 oracle column).
	static string Oracle(string pluginClass)
	{
		if (pluginClass == "SCR_SnapAndOrientToTerrainPlugin" || pluginClass == "EntityOrientationTool")
			return "read the transform back with wb_entity get; one undo restores it";
		if (pluginClass == "SCR_WrapEntitiesPlugin" || pluginClass == "SCR_AddPrefabToSelectedEntitiesPlugin")
			return "read the children back with wb_entity children; one undo restores them";
		if (pluginClass == "CameraOrientationTool")
			return "read the camera back with wb_view camera";
		if (pluginClass == "SCR_CopyClassAndMethodPlugin")
			return "the system clipboard now holds Class.Method()";
		if (pluginClass == "SCR_DebugLinePlugin")
			return "read the inserted line with wb_script_editor getLines; removeLine takes it out; nothing was saved";
		if (pluginClass == "SCR_LocEditedTextPlugin" || pluginClass == "SCR_LocStatusPlugin")
			return "read the rows back with wb_localization get";
		return "read the log (logs_tail)";
	}

	//------------------------------------------------------------------------------------------------
	//! The value of variable i of inst as text for int, float, bool, string, ResourceName and
	//! vector; "<type>" for any other type and "<unread>" when GetVariableValue fails. Verbatim from
	//! the probe's VariableValue (mod-dev/probe/ECEN_ProbeModules.c).
	static string VariableValue(typename owner, Class inst, int i)
	{
		typename varType = owner.GetVariableType(i);
		if (varType == int)
		{
			int intValue;
			if (owner.GetVariableValue(inst, i, intValue))
				return intValue.ToString();
			return "<unread>";
		}
		if (varType == float)
		{
			float floatValue;
			if (owner.GetVariableValue(inst, i, floatValue))
				return floatValue.ToString();
			return "<unread>";
		}
		if (varType == bool)
		{
			bool boolValue;
			if (owner.GetVariableValue(inst, i, boolValue))
				return boolValue.ToString();
			return "<unread>";
		}
		if (varType == string)
		{
			string stringValue;
			if (owner.GetVariableValue(inst, i, stringValue))
				return stringValue;
			return "<unread>";
		}
		if (varType == ResourceName)
		{
			ResourceName resourceValue;
			if (owner.GetVariableValue(inst, i, resourceValue))
				return resourceValue;
			return "<unread>";
		}
		if (varType == vector)
		{
			vector vectorValue;
			if (owner.GetVariableValue(inst, i, vectorValue))
				return vectorValue.ToString(false);
			return "<unread>";
		}
		return "<" + varType.ToString() + ">";
	}

	//------------------------------------------------------------------------------------------------
	//! A home folder replaced with %USERPROFILE%: EMCP_WB_Guard.ScrubHome, the one copy.
	static string ScrubHome(string text)
	{
		return EMCP_WB_Guard.ScrubHome(text);
	}

	//------------------------------------------------------------------------------------------------
	//! A value as a response may carry it: the project folder (either slash style) replaced with
	//! "<project>", then ScrubHome. The probe's ShowPath over the shared guard's ProjectDir (DEC-058).
	static string ShowPath(string text)
	{
		string shown = text;
		string projectDir = "";
		string why = "";
		if (EMCP_WB_Guard.ProjectDir(projectDir, why))
		{
			string backDir = projectDir;
			backDir.Replace("/", "\\");
			shown.Replace(projectDir, PROJECT_PLACEHOLDER);
			shown.Replace(backDir, PROJECT_PLACEHOLDER);
		}
		return ScrubHome(shown);
	}
}
