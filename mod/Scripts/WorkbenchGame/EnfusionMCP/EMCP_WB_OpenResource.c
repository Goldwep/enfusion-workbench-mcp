/**
 * EMCP_WB_OpenResource.c - Opening a resource in the editor that owns its file type
 *
 * Shared by EMCP_WB_EditorControl (openResource) and EMCP_WB_Module (setResource). Not a NET handler:
 * it is kept out of both so that each handler file names the modules it serves itself.
 *
 * The World Editor is handed a world (.ent) or a prefab (.et, prefab edit mode: W1 w1-43 on 1.9.0.37)
 * and nothing else: given a .conf it raised the modal "Cannot open prefabs at this time (not
 * implemented)" (W2 live run 2, w2-50, 1.9.0.37). No other file type is ever sent to it.
 */

class EMCP_WB_OpenResource
{
	static const string WORLD_EDITOR = "WorldEditor";
	static const string RESOURCE_MANAGER = "ResourceManager";
	static const string PARTICLE_EDITOR = "ParticleEditor";

	//------------------------------------------------------------------------------------------------
	//! The module that owns a path's file type: WorldEditor for .ent and .et; BehaviorEditor (.bt),
	//! AnimEditor (.aw .agr .agf .ast .asi), AudioEditor (.acp .sig), ProcAnimEditor (.pap .siga),
	//! LocalizationEditor (.st), ScriptEditor (.c), ParticleEditor (.ptc); ResourceManager for the
	//! rest (.conf, .emat, .layout, .imageset, textures, models and every other type).
	static string OwnerOf(string path)
	{
		string lower = path;
		lower.ToLower();
		if (lower.EndsWith(".ent") || lower.EndsWith(".et"))
			return WORLD_EDITOR;
		if (lower.EndsWith(".bt"))
			return "BehaviorEditor";
		if (lower.EndsWith(".aw") || lower.EndsWith(".agr") || lower.EndsWith(".agf") || lower.EndsWith(".ast") || lower.EndsWith(".asi"))
			return "AnimEditor";
		if (lower.EndsWith(".acp") || lower.EndsWith(".sig"))
			return "AudioEditor";
		if (lower.EndsWith(".pap") || lower.EndsWith(".siga"))
			return "ProcAnimEditor";
		if (lower.EndsWith(".st"))
			return "LocalizationEditor";
		if (lower.EndsWith(".c"))
			return "ScriptEditor";
		if (lower.EndsWith(".ptc"))
			return PARTICLE_EDITOR;
		return RESOURCE_MANAGER;
	}

	//------------------------------------------------------------------------------------------------
	//! Opens a path in the named module and returns the name of the module that took it, or "".
	//! The caller checks that the module owns the file type (OwnerOf). The Particle Editor is never
	//! asked (reading that module has crashed the Workbench). A behavior tree the Behavior Editor
	//! refuses goes to the Resource Manager, which hands it on to the Behavior Editor (seen on build
	//! 1.9.0.37, where BehaviorEditor itself answers false). No other fallback: a module is never
	//! handed a file type it does not own.
	static string OpenIn(string moduleName, string path)
	{
		if (moduleName == PARTICLE_EDITOR || moduleName == "")
			return "";
		if (moduleName == WORLD_EDITOR)
		{
			WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
			if (worldEditor && worldEditor.SetOpenedResource(path))
				return WORLD_EDITOR;
			return "";
		}
		if (moduleName == RESOURCE_MANAGER)
			return OpenInResourceManager(path);

		typename moduleType = EMCP_WB_Guard.ModuleType(moduleName);
		if (!moduleType)
			return "";
		// The table wb_localization open opened stops being the known one (review round 1, W3-LOC-2).
		if (moduleName == "LocalizationEditor")
			EMCP_WB_Localization.Forget();
		WBModuleDef owner = Workbench.GetModule(moduleType);
		if (owner && owner.SetOpenedResource(path))
			return moduleName;
		if (moduleName == "BehaviorEditor")
			return OpenInResourceManager(path);
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! Opens a path in the module that owns its file type (OwnerOf, OpenIn).
	static string OpenInOwningModule(string path)
	{
		return OpenIn(OwnerOf(path), path);
	}

	//------------------------------------------------------------------------------------------------
	//! Resource Manager SetOpenedResource; "" when the module is absent or answers false.
	protected static string OpenInResourceManager(string path)
	{
		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (resourceManager && resourceManager.SetOpenedResource(path))
			return RESOURCE_MANAGER;
		return "";
	}
}
