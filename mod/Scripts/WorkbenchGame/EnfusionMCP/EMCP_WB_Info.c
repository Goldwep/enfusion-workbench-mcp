/**
 * EMCP_WB_Info.c - Read-only bridge facts for wb_diagnose (DEC-048 package 3.3, Info unit)
 *
 * One action, "info": the build stamp, whether the project carrying the handlers is found
 * (projectFound, projectName = its addon id, DEC-058), the names of
 * the 9 present modules (modules; the Particle Editor in unreadModules, DEC-042) with no open
 * state, the handler classes this bundle compiles (a constant list: no proven reflection call
 * enumerates NetApiHandler subclasses) and the authorization-prompt hazard flag of the file methods
 * (constant true until the S-F repeat settles U27, DEC-047).
 * No Workbench.GetModule call: GetModule OPENS a closed module's window (sitting P3-3 gate 1), so
 * open state and the World Editor's world path are not read here (worldPathForm is "unread"); the
 * TypeScript side asks the NET native IsWorldEditorRunning, and wb_module info reads one module.
 * Nothing here opens a module, loads a resource or writes.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Info"
 */

class EMCP_WB_InfoRequest : JsonApiStruct
{
	//! The one action is "info"; the key is optional.
	string action;

	void EMCP_WB_InfoRequest()
	{
		RegV("action");
	}
}

class EMCP_WB_InfoResponse : JsonApiStruct
{
	string status;
	string message;
	string buildStamp;
	bool projectFound;
	string projectName;
	string modules;
	string unreadModules;
	string worldPath;
	string worldPathForm;
	int handlerCount;
	string handlers;
	string handlerSource;
	bool filePromptHazard;

	void EMCP_WB_InfoResponse()
	{
		RegV("status");
		RegV("message");
		RegV("buildStamp");
		RegV("projectFound");
		RegV("projectName");
		RegV("modules");
		RegV("unreadModules");
		RegV("worldPath");
		RegV("worldPathForm");
		RegV("handlerCount");
		RegV("handlers");
		RegV("handlerSource");
		RegV("filePromptHazard");
	}
}

class EMCP_WB_Info : NetApiHandler
{
	//! The handler classes of this bundle, kept by hand (tests/live-harness/shipped-info.test.ts
	//! checks the list equals the NetApiHandler classes in this folder).
	static const string HANDLERS = "EMCP_WB_Anim,EMCP_WB_AnimDebug,EMCP_WB_Audio,EMCP_WB_Clipboard,EMCP_WB_Components,EMCP_WB_Container,EMCP_WB_CreateEntity,EMCP_WB_DeleteEntity,EMCP_WB_Diag,EMCP_WB_EditorControl,EMCP_WB_Entity,EMCP_WB_ExecuteAction,EMCP_WB_Generator,EMCP_WB_GetCameraPos,EMCP_WB_GetState,EMCP_WB_Info,EMCP_WB_Layers,EMCP_WB_Localization,EMCP_WB_Meta,EMCP_WB_ModifyEntity,EMCP_WB_Module,EMCP_WB_Navmesh,EMCP_WB_Particle,EMCP_WB_Ping,EMCP_WB_Plugin,EMCP_WB_Prefabs,EMCP_WB_Reload,EMCP_WB_Resources,EMCP_WB_ScriptEditor,EMCP_WB_SelectEntity,EMCP_WB_Shape,EMCP_WB_Terrain,EMCP_WB_TerrainEdit,EMCP_WB_Validate,EMCP_WB_View,EMCP_WB_World,EMCP_WB_WorldTools";
	static const int HANDLER_COUNT = 37;
	// filePromptHazard is the literal true: a file method may raise the per-method authorization
	// prompt (U27: DEC-047 partial, confounded) until the S-F repeat proves which methods prompt and whether a click persists.

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_InfoRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_InfoRequest req = EMCP_WB_InfoRequest.Cast(request);
		EMCP_WB_InfoResponse resp = new EMCP_WB_InfoResponse();
		resp.buildStamp = EMCP_WB_BuildStamp.VALUE;
		resp.handlers = HANDLERS;
		resp.handlerCount = HANDLER_COUNT;
		resp.handlerSource = "compiled constant";
		resp.filePromptHazard = true;

		if (req && req.action != "" && req.action != "info")
		{
			resp.status = EMCP_WB_Guard.REFUSED;
			resp.message = EMCP_WB_Guard.RefusalMessage("INVALID_ARGUMENT", "unknown action: " + req.action, "action info");
			return resp;
		}

		resp.projectFound = EMCP_WB_Guard.IsProjectFound();
		resp.projectName = EMCP_WB_Guard.ProjectId();

		array<string> names = {"AnimEditor", "AudioEditor", "BehaviorEditor", "LocalizationEditor", "ParticleEditor", "ProcAnimEditor", "ResourceManager", "ScriptEditor", "WorldEditor"};
		string present = "";
		string unread = "";
		for (int i = 0; i < names.Count(); i++)
		{
			string moduleName = names.Get(i);
			typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(moduleName);
			if (!moduleType)
				unread = Join(unread, moduleName);
			else
				present = Join(present, moduleName);
		}
		resp.modules = present;
		resp.unreadModules = unread;

		// Not read: the world path needs GetModule(WorldEditor), which opens a closed World Editor.
		resp.worldPath = "";
		resp.worldPathForm = "unread";

		resp.status = "ok";
		resp.message = "info";
		return resp;
	}

	//! list plus one comma-separated item.
	static string Join(string list, string item)
	{
		if (list == "")
			return item;
		return list + "," + item;
	}
}
