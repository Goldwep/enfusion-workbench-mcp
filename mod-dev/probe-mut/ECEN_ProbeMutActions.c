/**
 * ECEN_ProbeMutActions.c - Container, plugin, diag and world-file actions of the mutating pack
 *
 * containerWriteTest (U8 write half), saveContainer (U16 write half), pluginRunDialogFree (U10),
 * diagSet (U34) and createSandboxWorlds (the fallback for OA-3). The handler has already checked
 * guard (a), the opened project is the 2.0 sandbox; each action checks its own target again.
 */

class ECEN_ProbeMutActions
{
	//------------------------------------------------------------------------------------------------
	//! A container variable's current value as text for the scalar data types; "<type>" otherwise.
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
	//! Sets a scalar container variable from text, parsed strictly for its data type. False with the
	//! reason in why for any other data type or text that does not parse.
	static bool WriteFromText(BaseContainer cont, string varName, DataVarType dataType, string text, out string why)
	{
		why = "";
		if (dataType == DataVarType.SCALAR)
		{
			float floatValue;
			if (!ECEN_ProbeMutGuard.ParseFloat(text, floatValue))
			{
				why = "value is not a number: " + text;
				return false;
			}
			return cont.Set(varName, floatValue);
		}
		if (dataType == DataVarType.INTEGER)
		{
			int intValue;
			if (!ECEN_ProbeMutGuard.ParseInt(text, intValue))
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
		why = "containerWriteTest writes scalar, integer, boolean, string and resource-name variables only";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! containerWriteTest: opens the target (a file under _throwaway/) in an open module other than
	//! the World Editor with SetOpenedResource, then sets one variable of GetContainer(index) and
	//! reads it back, but only when that container's GetSourceAddons lists exactly the 2.0 sandbox:
	//! a module or editor settings container, or a document of another addon, is never written.
	//! moduleSave is refused: WBModuleDef.Save() takes no file argument and nothing shows which
	//! document it saves until the U8 read half has run; persistence is tested with saveContainer.
	static void ContainerWriteTest(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		if (req.moduleSave)
		{
			resp.Refuse("moduleSave is compiled off: WBModuleDef.Save() saves whatever document is current; use saveContainer to persist");
			return;
		}

		string absolute = "";
		string why = "";
		if (!ECEN_ProbeMutGuard.Target(req.target, true, absolute, why))
		{
			resp.Refuse(why);
			return;
		}

		typename moduleType = ECEN_ProbeMutGuard.ModuleType(req.moduleName);
		if (!moduleType)
		{
			resp.Fail("module must be one of the ten module names (never ParticleEditor, DEC-042); got '" + req.moduleName + "'");
			return;
		}
		if (req.moduleName == "WorldEditor")
		{
			// SetOpenedResource in the World Editor loads another world: never from this pack.
			resp.Refuse("containerWriteTest never switches the World Editor's world; use the world actions");
			return;
		}
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Fail("module " + req.moduleName + " is not open; this action never opens a module");
			return;
		}

		resp.Fact("module", req.moduleName);
		resp.Fact("target", req.target);
		// Sitting S-E passed the absolute path only and every module answered false (U8 write, DEC-044);
		// the shipped World Editor route passes the project-relative path as given and loads the world
		// (DEC-045). Project-relative first, the absolute form second; pathForm says which one opened.
		string pathForm = "none";
		string relative = req.target;
		relative.Replace("\\", "/");
		bool opened = wbModule.SetOpenedResource(relative);
		if (opened)
			pathForm = "relative";
		else
		{
			opened = wbModule.SetOpenedResource(absolute);
			if (opened)
				pathForm = "absolute";
		}
		resp.Fact("opened", opened.ToString());
		resp.Fact("pathForm", pathForm);
		if (!opened)
		{
			resp.Fail("SetOpenedResource returned false for the target in both path forms (project-relative, then absolute); nothing written");
			return;
		}

		int count = wbModule.GetNumContainers();
		int index = req.index;
		resp.Fact("containers", count.ToString());
		if (index < 0 || index >= count)
		{
			resp.Fail("index out of range: the module holds " + count.ToString() + " containers");
			return;
		}
		BaseContainer cont = wbModule.GetContainer(index);
		if (!cont)
		{
			resp.Fail("GetContainer returned null");
			return;
		}

		// The container must come from the sandbox alone, so the write cannot reach module or editor
		// settings, which the Workbench writes back at exit, or a document of another addon.
		array<string> sourceAddons = {};
		cont.GetSourceAddons(sourceAddons);
		string sources = string.Join(",", sourceAddons, false);
		resp.Fact("sourceAddons", sources);
		if (sourceAddons.Count() != 1 || sourceAddons.Get(0) != ECEN_ProbeMutGuard.SANDBOX_FOLDER)
		{
			resp.Refuse("container " + index.ToString() + " does not come from the 2.0 sandbox alone (GetSourceAddons: '" + sources + "'); nothing written");
			return;
		}

		string varName = req.varName;
		int varIndex = cont.GetVarIndex(varName);
		if (varName == "" || varIndex < 0)
		{
			resp.Fail("the container has no variable named '" + varName + "'");
			return;
		}

		DataVarType dataType = cont.GetDataVarType(varIndex);
		resp.Fact("className", cont.GetClassName());
		resp.Fact("varName", varName);
		resp.Fact("type", typename.EnumToString(DataVarType, dataType));
		resp.Fact("before", ReadAsText(cont, varName, dataType));
		bool written = WriteFromText(cont, varName, dataType, req.value, why);
		resp.Fact("written", written.ToString());
		resp.Fact("after", ReadAsText(cont, varName, dataType));
		if (!written)
		{
			if (why == "")
				why = "BaseContainer.Set returned false";
			resp.Fail(why + "; nothing saved");
			return;
		}
		resp.Ok("container write test done (in memory; not saved)");
	}

	//------------------------------------------------------------------------------------------------
	//! saveContainer: BaseContainerTools.LoadContainer(source), then SaveContainer of that container
	//! to the target, a file under _throwaway/, in the form vanilla uses for a plain file
	//! (ResourceInfo.c, BakeMLOD.c): an empty resource name and the absolute path as fileName.
	static void SaveContainerCopy(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		string absolute = "";
		string why = "";
		if (!ECEN_ProbeMutGuard.Target(req.target, true, absolute, why))
		{
			resp.Refuse(why);
			return;
		}
		if (req.source == "")
		{
			resp.Fail("source required (a resource name to load)");
			return;
		}

		ResourceName sourceName = req.source;
		resp.Fact("source", req.source);
		resp.Fact("target", req.target);
		Resource holder = BaseContainerTools.LoadContainer(sourceName);
		if (!holder)
		{
			resp.Fail("LoadContainer returned null");
			return;
		}
		bool valid = holder.IsValid();
		if (!valid)
		{
			resp.Fail("LoadContainer returned a resource that is not valid");
			return;
		}
		BaseResourceObject resourceObject = holder.GetResource();
		if (!resourceObject)
		{
			resp.Fail("GetResource returned null");
			return;
		}
		BaseContainer cont = resourceObject.ToBaseContainer();
		if (!cont)
		{
			resp.Fail("the source is not a BaseContainer");
			return;
		}

		resp.Fact("className", cont.GetClassName());

		// S-E 2026-10-08, first launch: SaveContainer answered false for every target with the
		// absolute path and a parent folder that did not exist. Bohemia's own handlers
		// (ResourceInfo.c ExportMaterialResource) pass a project-relative path and an empty resource
		// name, so: the parent folder is made first (inside _throwaway/, guard (b) above), then the
		// project-relative form is tried, then the absolute one; the form that worked is a fact.
		int cutDir = absolute.LastIndexOf("/");
		string parentDir = absolute.Substring(0, cutDir);
		bool madeDir = FileIO.MakeDirectory(parentDir);
		resp.Fact("parentDirMade", madeDir.ToString());
		string projectDir = "";
		string whyDir = "";
		ECEN_ProbeMutGuard.SandboxDir(projectDir, whyDir);
		string relativeTarget = absolute.Substring(projectDir.Length() + 1, absolute.Length() - projectDir.Length() - 1);
		ResourceName noResourceName = "";
		string form = "relative";
		bool saved = BaseContainerTools.SaveContainer(cont, noResourceName, relativeTarget);
		if (!saved)
		{
			form = "absolute";
			saved = BaseContainerTools.SaveContainer(cont, noResourceName, absolute);
		}
		resp.Fact("saved", saved.ToString());
		resp.Fact("form", form);
		if (!saved)
		{
			// A false return is a failure, not an observation: the caller must not read ok.
			resp.Fail("SaveContainer returned false for the relative and the absolute form (nothing written)");
			return;
		}
		resp.Ok("SaveContainer returned true (" + form + " path)");
	}

	//------------------------------------------------------------------------------------------------
	//! True when module and class are on the plugin list compiled into ECEN_ProbeMutLists.c.
	static bool PluginListed(string moduleName, string className)
	{
		string key = moduleName + "\n" + className;
		array<string> listed = {};
		ECEN_ProbeMutLists.Plugins(listed);
		for (int i = 0; i < listed.Count(); i++)
		{
			if (listed.Get(i) == key)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! pluginRunDialogFree: GetPlugin(type).Run() for a module and class on the compiled-in list
	//! (one entry for S-E, DEC-043). The target is what the plugin works on: for the World Editor it must be the
	//! world open now (ThrowawayWorld: an .ent under _throwaway/ with one sub-scene; this action never
	//! switches the World Editor's world); for any other module it is opened first with
	//! SetOpenedResource, which switches that module's current document (a module with an unsaved
	//! document may prompt [unverified]; the S-E queue keeps every module clean before the call).
	//! Never RunCommandline, never Configure.
	static void PluginRunDialogFree(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		string className = req.className;
		if (!PluginListed(req.moduleName, className))
		{
			int listed = ECEN_ProbeMutLists.PluginCount();
			resp.Refuse("module and class are not on the plugin list compiled into ECEN_ProbeMutLists.c (" + listed.ToString() + " entries)");
			return;
		}

		typename moduleType = ECEN_ProbeMutGuard.ModuleType(req.moduleName);
		if (!moduleType)
		{
			resp.Fail("module must be one of the ten module names (never ParticleEditor, DEC-042); got '" + req.moduleName + "'");
			return;
		}

		string absolute = "";
		string why = "";
		if (req.moduleName == "WorldEditor")
		{
			WorldEditorAPI api = ECEN_ProbeMutGuard.ThrowawayWorld(req.target, absolute, why);
			if (!api)
			{
				resp.Refuse(why);
				return;
			}
		}
		else
		{
			if (!ECEN_ProbeMutGuard.Target(req.target, true, absolute, why))
			{
				resp.Refuse(why);
				return;
			}
		}

		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Fail("module " + req.moduleName + " is not open; this action never opens a module");
			return;
		}
		if (req.moduleName != "WorldEditor")
		{
			bool opened = wbModule.SetOpenedResource(absolute);
			resp.Fact("opened", opened.ToString());
			if (!opened)
			{
				resp.Fail("SetOpenedResource returned false for the target; nothing run");
				return;
			}
		}

		typename pluginType = className.ToType();
		if (!pluginType || !pluginType.IsInherited(WorkbenchPlugin))
		{
			resp.Fail(className + " is not a WorkbenchPlugin class");
			return;
		}
		WorkbenchPlugin plugin = wbModule.GetPlugin(pluginType);
		if (!plugin)
		{
			resp.Fail("GetPlugin returned null");
			return;
		}

		resp.Fact("module", req.moduleName);
		resp.Fact("className", className);
		resp.Fact("target", req.target);
		plugin.Run();
		resp.Ok("Run() returned");
	}

	//------------------------------------------------------------------------------------------------
	//! diagSet: DiagMenu.SetValue (or SetEngineValue with engine) on an option compiled into
	//! ECEN_ProbeMutLists.c (one entry for S-E, DEC-043), with the value read before and after. A script option is
	//! named by its SCR_DebugMenuID value (diagEnum); an engine option by its int id (diagId).
	static void DiagSet(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		bool engine = req.engine;
		int id = -1;
		string key = "";
		if (engine)
		{
			id = req.diagId;
			if (id < 0)
			{
				resp.Fail("diagId required for an engine option");
				return;
			}
			key = "engine:" + id.ToString();
		}
		else
		{
			string enumName = req.diagEnum;
			if (enumName == "")
			{
				resp.Fail("diagEnum (a SCR_DebugMenuID value name) required for a script option");
				return;
			}
			id = typename.StringToEnum(SCR_DebugMenuID, enumName);
			string back = typename.EnumToString(SCR_DebugMenuID, id);
			if (back != enumName)
			{
				resp.Fail("diagEnum is not a SCR_DebugMenuID value: " + enumName);
				return;
			}
			key = "script:" + enumName;
		}

		array<string> listed = {};
		ECEN_ProbeMutLists.DiagKeys(listed);
		bool allowed = false;
		for (int i = 0; i < listed.Count(); i++)
		{
			if (listed.Get(i) == key)
				allowed = true;
		}
		if (!allowed)
		{
			int listedCount = ECEN_ProbeMutLists.DiagCount();
			resp.Refuse("option " + key + " is not on the diag list compiled into ECEN_ProbeMutLists.c (" + listedCount.ToString() + " entries)");
			return;
		}

		int value = req.diagValue;
		resp.Fact("option", key);
		resp.Fact("value", value.ToString());
		if (engine)
		{
			int engineBefore = DiagMenu.GetEngineValue(id);
			DiagMenu.SetEngineValue(id, value);
			int engineAfter = DiagMenu.GetEngineValue(id);
			resp.Fact("before", engineBefore.ToString());
			resp.Fact("after", engineAfter.ToString());
		}
		else
		{
			int scriptBefore = DiagMenu.GetValue(id);
			DiagMenu.SetValue(id, value);
			int scriptAfter = DiagMenu.GetValue(id);
			resp.Fact("before", scriptBefore.ToString());
			resp.Fact("after", scriptAfter.ToString());
		}
		resp.Ok("diag option set");
	}

	//------------------------------------------------------------------------------------------------
	//! Registers one world file written by CreateWorld in the resource database, as Bohemia's
	//! SCR_WorldFilesHelper.DuplicateWorld and RegisterResource.Register do: GetMetaFile first, and
	//! RegisterResourceFile(absolute path, no runtime build) only when no .meta exists yet. Only a
	//! file under _throwaway/ (guard (b)) is registered. Reports <prefix>Registered and
	//! <prefix>ResourceName; a false registration is reported, never a failure of the action.
	protected static void RegisterWorld(string worldAbsolute, string throwawayDir, string prefix, ECEN_ProbeMutResponse resp)
	{
		bool registered = false;
		string resourceName = "";
		if (ECEN_ProbeMutGuard.IsUnder(worldAbsolute, throwawayDir) && FileIO.FileExists(worldAbsolute))
		{
			ResourceManager rm = Workbench.GetModule(ResourceManager);
			if (rm)
			{
				MetaFile meta = rm.GetMetaFile(worldAbsolute);
				if (!meta && rm.RegisterResourceFile(worldAbsolute, false))
					meta = rm.GetMetaFile(worldAbsolute);
				if (meta)
				{
					registered = true;
					resourceName = meta.GetResourceID();
				}
			}
		}
		resp.Fact(prefix + "Registered", registered.ToString());
		resp.Fact(prefix + "ResourceName", ECEN_ProbeMutGuard.ShowPath(resourceName));
	}

	//------------------------------------------------------------------------------------------------
	//! createSandboxWorlds: SCR_WorldFilesHelper.CreateWorld for the tiny world (tinyName) and the
	//! terrain world (terrainName) in the folder target, an addon-prefixed path as CreateWorld takes
	//! it. The target must resolve, through the same Workbench.GetAbsolutePath call CreateWorld makes,
	//! inside the 2.0 sandbox's folder. Existing files are never overwritten (both overwrite flags
	//! are false). CreateWorld writes no terrain: terrainEntities, when given, are the prefabs it
	//! places in the terrain world's default layer, each a well-formed resource name.
	static void CreateSandboxWorlds(ECEN_ProbeMutRequest req, ECEN_ProbeMutResponse resp)
	{
		string projectDir = "";
		string why = "";
		if (!ECEN_ProbeMutGuard.SandboxDir(projectDir, why))
		{
			resp.Refuse(why);
			return;
		}

		string folder = req.target;
		if (folder == "" || !folder.StartsWith("$") || folder.Contains(".."))
		{
			resp.Refuse("target must be an addon-prefixed folder ($<filesystem>:<path>) without '..'");
			return;
		}
		string absolute = "";
		if (!Workbench.GetAbsolutePath(folder, absolute, false))
		{
			resp.Refuse("target does not resolve: " + folder);
			return;
		}
		if (!ECEN_ProbeMutGuard.IsUnder(absolute, projectDir + "/" + ECEN_ProbeMutGuard.THROWAWAY))
		{
			resp.Refuse("refused: target does not resolve inside the 2.0 sandbox's " + ECEN_ProbeMutGuard.THROWAWAY + " folder");
			return;
		}

		string tinyName = req.tinyName;
		string terrainName = req.terrainName;
		if (!ECEN_ProbeMutGuard.IsIdentifier(tinyName) || !ECEN_ProbeMutGuard.IsIdentifier(terrainName) || tinyName == terrainName)
		{
			resp.Fail("tinyName and terrainName must be two different identifiers");
			return;
		}

		// CreateWorld writes each prefab name inside double quotes into the kept default.layer: only
		// well-formed resource names pass (ECEN_ProbeMutGuard.IsPrefabName).
		array<ResourceName> entities = {};
		array<string> requested = req.terrainEntities;
		if (requested)
		{
			for (int i = 0; i < requested.Count(); i++)
			{
				string entry = requested.Get(i);
				if (!ECEN_ProbeMutGuard.IsPrefabName(entry))
				{
					resp.Refuse("terrainEntities entry " + i.ToString() + " is not a resource name of the form {16 hex digits}path with plain characters");
					return;
				}
				ResourceName entity = entry;
				entities.Insert(entity);
			}
		}

		resp.Fact("target", folder);
		// CreateWorld skips an existing .ent (overwrite false) and still returns its path, so the
		// status alone cannot say whether anything was written: report what existed before.
		bool tinyExisted = FileIO.FileExists(absolute + "/" + tinyName + ".ent");
		bool terrainExisted = FileIO.FileExists(absolute + "/" + terrainName + ".ent");
		resp.Fact("tinyExistedBefore", tinyExisted.ToString());
		resp.Fact("terrainExistedBefore", terrainExisted.ToString());
		string tinyWorld = SCR_WorldFilesHelper.CreateWorld(folder, tinyName, null, false, false);
		resp.Fact("tinyWorld", ECEN_ProbeMutGuard.ShowPath(tinyWorld));
		string terrainWorld = SCR_WorldFilesHelper.CreateWorld(folder, terrainName, entities, false, false);
		resp.Fact("terrainWorld", ECEN_ProbeMutGuard.ShowPath(terrainWorld));
		int entityCount = entities.Count();
		resp.Fact("terrainEntities", entityCount.ToString());
		if (tinyWorld == "" || terrainWorld == "")
		{
			resp.Fail("CreateWorld returned an empty path (see the Workbench log)");
			return;
		}
		// CreateWorld's doc says it registers the world, but its body only writes files (DEC-044):
		// register each .ent the way DuplicateWorld does, so OpenResource and GetWorldPath know it.
		string throwawayDir = projectDir + "/" + ECEN_ProbeMutGuard.THROWAWAY;
		RegisterWorld(absolute + "/" + tinyName + ".ent", throwawayDir, "tiny", resp);
		RegisterWorld(absolute + "/" + terrainName + ".ent", throwawayDir, "terrain", resp);
		if (tinyExisted || terrainExisted)
		{
			resp.Ok("a world existed before; CreateWorld skips an existing .ent (see tinyExistedBefore, terrainExistedBefore)");
			return;
		}
		resp.Ok("worlds created");
	}
}
