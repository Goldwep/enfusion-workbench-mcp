/**
 * ECEN_ProbeModules.c - Module, menu-action and plugin actions of the read-only probe pack
 *
 * moduleMatrix (U8), executeAction (U9, allow-listed), getPlugin and pluginAttrs (U10),
 * toolInstance (U10). Only moduleMatrix may open a module, one named module a call and only when
 * the request sets openModules; the other actions refuse a module that is not open. GetPlugin focuses the module
 * window (Bohemia's comment in SCR_AutotestPlugin.FocusWorldEditor); U10 records it.
 */

class ECEN_ProbeModules
{
	//------------------------------------------------------------------------------------------------
	//! moduleMatrix: for each of the ten modules (never the Particle Editor, DEC-042), GetModule; GetNumContainers; per container its
	//! class name and variable names (names only, never values). One row per container, or one row
	//! with container -1 for a module that is absent or holds no container. With openModules, the
	//! one module moduleName names is opened first (OpenModule) when it is not open; no other module
	//! is ever opened, so the queue opens modules one call at a time.
	static void ModuleMatrix(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		if (req.openModules)
		{
			typename openType = ECEN_ProbeUtil.ModuleType(req.moduleName);
			if (!openType)
			{
				resp.Fail("openModules opens one module: moduleName must be one of the ten module names (never ParticleEditor, DEC-042); got '" + req.moduleName + "'");
				return;
			}
		}

		array<string> names = {};
		ECEN_ProbeUtil.ModuleNames(names);
		resp.SetColumns("module,present,openCalled,openResult,containers,container,className,variableCount,variables,variablesCut");

		array<string> all = {};
		int present = 0;
		for (int m = 0; m < names.Count(); m++)
		{
			string moduleName = names.Get(m);
			typename moduleType = ECEN_ProbeUtil.ModuleType(moduleName);
			WBModuleDef wbModule = Workbench.GetModule(moduleType);
			bool openCalled = false;
			bool openResult = false;
			if (!wbModule && req.openModules && moduleName == req.moduleName)
			{
				openCalled = true;
				openResult = Workbench.OpenModule(moduleType);
				wbModule = Workbench.GetModule(moduleType);
			}

			int containerCount = 0;
			if (wbModule)
			{
				present++;
				containerCount = wbModule.GetNumContainers();
			}

			if (containerCount <= 0)
			{
				bool isPresent = wbModule != null;
				all.Insert(moduleName);
				all.Insert(isPresent.ToString());
				all.Insert(openCalled.ToString());
				all.Insert(openResult.ToString());
				all.Insert(containerCount.ToString());
				all.Insert("-1");
				all.Insert("");
				all.Insert("0");
				all.Insert("");
				all.Insert("false");
				continue;
			}

			for (int c = 0; c < containerCount; c++)
			{
				BaseContainer cont = wbModule.GetContainer(c);
				string className = "";
				int varCount = 0;
				array<string> varNames = {};
				bool cut = false;
				if (cont)
				{
					className = cont.GetClassName();
					varCount = cont.GetNumVars();
					for (int v = 0; v < varCount; v++)
					{
						if (v >= ECEN_ProbeUtil.MAX_VARIABLE_NAMES)
						{
							cut = true;
							break;
						}
						varNames.Insert(cont.GetVarName(v));
					}
				}

				all.Insert(moduleName);
				all.Insert("true");
				all.Insert(openCalled.ToString());
				all.Insert(openResult.ToString());
				all.Insert(containerCount.ToString());
				all.Insert(c.ToString());
				all.Insert(className);
				all.Insert(varCount.ToString());
				all.Insert(string.Join(",", varNames, false));
				all.Insert(cut.ToString());
			}
		}

		int moduleCount = names.Count();
		bool openModules = req.openModules;
		ECEN_ProbeUtil.PageInto(resp, all, 10, req.page);
		resp.Fact("modules", moduleCount.ToString());
		resp.Fact("present", present.ToString());
		resp.Fact("openModules", openModules.ToString());
		if (openModules)
			resp.Fact("openedModule", req.moduleName);
		resp.Ok("module matrix: " + present.ToString() + " of " + moduleCount.ToString() + " modules present");
	}

	//------------------------------------------------------------------------------------------------
	//! executeAction: WBModuleDef.ExecuteAction(menuPath, keepFocus) on an open module, only for a
	//! path on the allow-list compiled into ECEN_ProbeAllowList.c; with candidate set, only for a
	//! path on its candidate list instead (DEC-100: a live battery's override, never a shipped
	//! tool's). A path any segment of which holds a deny-list label as a run of words, or a refused
	//! word (save, close, delete, ...), is refused even when listed. The dispatcher has already
	//! refused a project other than the 2.0 sandbox.
	static void ExecuteAction(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		typename moduleType = ECEN_ProbeUtil.ModuleType(req.moduleName);
		if (!moduleType)
		{
			resp.Fail("module must be one of the ten module names (never ParticleEditor, DEC-042); got '" + req.moduleName + "'");
			return;
		}

		array<string> path = req.menuPath;
		if (!path || path.Count() == 0)
		{
			resp.Fail("menuPath must hold at least one segment");
			return;
		}
		for (int i = 0; i < path.Count(); i++)
		{
			string segment = path.Get(i);
			if (segment == "" || segment.Contains("\n"))
			{
				resp.Refuse("menuPath segment " + i.ToString() + " is empty or holds a line break");
				return;
			}
		}

		bool keepFocus = req.keepFocus;
		bool candidate = req.candidate;
		resp.Fact("module", req.moduleName);
		resp.Fact("menuPath", string.Join(" > ", path, false));
		resp.Fact("keepFocus", keepFocus.ToString());
		resp.Fact("candidate", candidate.ToString());

		string deniedWhy = "";
		string denied = ECEN_ProbeUtil.DeniedSegment(path, deniedWhy);
		if (denied != "")
		{
			resp.Refuse("segment '" + denied + "' " + deniedWhy);
			return;
		}
		if (candidate)
		{
			if (!ECEN_ProbeUtil.PathCandidate(path))
			{
				int candidates = ECEN_ProbeAllowList.CandidateCount();
				resp.Refuse("menuPath is not on the candidate list compiled into ECEN_ProbeAllowList.c (" + candidates.ToString() + " entries)");
				return;
			}
		}
		else if (!ECEN_ProbeUtil.PathAllowed(path))
		{
			int allowed = ECEN_ProbeAllowList.Count();
			resp.Refuse("menuPath is not on the allow-list compiled into ECEN_ProbeAllowList.c (" + allowed.ToString() + " entries)");
			return;
		}

		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Fail("module " + req.moduleName + " is not open; executeAction never opens a module");
			return;
		}

		bool result = wbModule.ExecuteAction(path, keepFocus);
		resp.Fact("result", result.ToString());
		resp.Ok("ExecuteAction returned " + result.ToString());
	}

	//------------------------------------------------------------------------------------------------
	//! The plugin instance GetPlugin returns for the request's module and class, or null with the
	//! reason in the response. The module must be open; the class must inherit WorkbenchPlugin.
	static WorkbenchPlugin FindPlugin(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		typename moduleType = ECEN_ProbeUtil.ModuleType(req.moduleName);
		if (!moduleType)
		{
			resp.Fail("module must be one of the ten module names (never ParticleEditor, DEC-042); got '" + req.moduleName + "'");
			return null;
		}

		string className = req.className;
		if (className == "")
		{
			resp.Fail("className required");
			return null;
		}
		typename pluginType = className.ToType();
		if (!pluginType)
		{
			resp.Fail("no script class named " + className);
			return null;
		}
		if (!pluginType.IsInherited(WorkbenchPlugin))
		{
			resp.Fail(className + " does not inherit WorkbenchPlugin");
			return null;
		}

		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Fail("module " + req.moduleName + " is not open; this action never opens a module");
			return null;
		}

		resp.Fact("module", req.moduleName);
		resp.Fact("className", className);
		WorkbenchPlugin plugin = wbModule.GetPlugin(pluginType);
		bool returned = plugin != null;
		resp.Fact("returned", returned.ToString());
		if (!plugin)
		{
			resp.Fail("GetPlugin returned null");
			return null;
		}
		resp.Fact("instanceClass", plugin.ClassName());
		return plugin;
	}

	//------------------------------------------------------------------------------------------------
	//! getPlugin: GetPlugin(type) on the module; whether it returns an instance and of what class.
	static void GetPluginInfo(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		WorkbenchPlugin plugin = FindPlugin(req, resp);
		if (!plugin)
			return;
		resp.Ok("GetPlugin returned an instance");
	}

	//------------------------------------------------------------------------------------------------
	//! pluginAttrs: the plugin's variables with their type, whether an [Attribute] annotates them,
	//! and their current value where the type is int, float, bool, string, ResourceName or vector.
	//! Read only: nothing is written to the instance.
	static void PluginAttrs(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		WorkbenchPlugin plugin = FindPlugin(req, resp);
		if (!plugin)
			return;

		typename instanceType = plugin.Type();
		int count = instanceType.GetVariableCount();
		resp.SetColumns("name,type,attribute,value");
		array<string> all = {};
		int annotated = 0;
		for (int i = 0; i < count; i++)
		{
			string name = instanceType.GetVariableName(i);
			typename varType = instanceType.GetVariableType(i);
			array<Class> attrs = {};
			instanceType.GetVariableAttributes(i, attrs);
			bool isAttribute = false;
			for (int a = 0; a < attrs.Count(); a++)
			{
				Attribute attr = Attribute.Cast(attrs.Get(a));
				if (attr)
					isAttribute = true;
			}
			if (isAttribute)
				annotated++;

			all.Insert(name);
			all.Insert(varType.ToString());
			all.Insert(isAttribute.ToString());
			// Persisted plugin settings can hold user paths: ShowPath keeps the account name out.
			all.Insert(ECEN_ProbeUtil.ShowPath(VariableValue(instanceType, plugin, i)));
		}

		ECEN_ProbeUtil.PageInto(resp, all, 4, req.page);
		resp.Fact("variables", count.ToString());
		resp.Fact("attributes", annotated.ToString());
		resp.Ok("plugin variables read");
	}

	//------------------------------------------------------------------------------------------------
	//! The value of variable i of inst as text, for the types listed on PluginAttrs; "<type>" for
	//! any other type and "<unread>" when GetVariableValue fails.
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
	//! toolInstance: World Editor GetPlugin with a WorldEditorTool type, and the current tool name.
	//! GetPlugin is declared to return a WorkbenchPlugin and WorldEditorTool does not inherit it;
	//! this action records what the call returns for a tool type.
	static void ToolInstance(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		string className = req.className;
		if (className == "")
		{
			resp.Fail("className required");
			return;
		}
		typename toolType = className.ToType();
		if (!toolType)
		{
			resp.Fail("no script class named " + className);
			return;
		}
		if (!toolType.IsInherited(WorldEditorTool))
		{
			resp.Fail(className + " does not inherit WorldEditorTool");
			return;
		}

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.Fail("WorldEditor module is not open; this action never opens a module");
			return;
		}

		resp.Fact("className", className);
		WorkbenchPlugin instance = worldEditor.GetPlugin(toolType);
		bool returned = instance != null;
		resp.Fact("returned", returned.ToString());
		if (instance)
			resp.Fact("instanceClass", instance.ClassName());

		WorldEditorAPI api = worldEditor.GetApi();
		if (api)
			resp.Fact("currentToolName", api.GetCurrentToolName());
		else
			resp.Fact("currentToolName", "<no WorldEditorAPI>");

		resp.Ok("tool instance probed");
	}
}
