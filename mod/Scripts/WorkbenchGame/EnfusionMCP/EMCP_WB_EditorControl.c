/**
 * EMCP_WB_EditorControl.c - Editor mode control handler
 *
 * Supports actions: play, stop, save and saveAs (both always error - see below), undo, redo,
 * openResource
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_EditorControl"
 */

class EMCP_WB_EditorControlRequest : JsonApiStruct
{
	string action;
	bool debugMode;
	bool fullScreen;
	string path;

	void EMCP_WB_EditorControlRequest()
	{
		RegV("action");
		RegV("debugMode");
		RegV("fullScreen");
		RegV("path");
	}
}

class EMCP_WB_EditorControlResponse : JsonApiStruct
{
	string status;
	string action;
	string message;

	void EMCP_WB_EditorControlResponse()
	{
		RegV("status");
		RegV("action");
		RegV("message");
	}
}

class EMCP_WB_EditorControl : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_EditorControlRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_EditorControlRequest req = EMCP_WB_EditorControlRequest.Cast(request);
		EMCP_WB_EditorControlResponse resp = new EMCP_WB_EditorControlResponse();
		resp.action = req.action;

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return resp;
		}

		// undo and redo edit the open world: the guard of the W-wave edit handlers (DEC-058, EditApi
		// of EMCP_WB_Entity.c): the project is found, the editor is not in play mode.
		if (req.action == "undo" || req.action == "redo")
		{
			if (!EMCP_WB_Guard.IsProjectFound())
			{
				resp.status = "error";
				resp.message = EMCP_WB_Guard.NOT_IN_PROJECT + ": mutating actions need the handlers installed in the open project; nothing was changed";
				return resp;
			}
			WorldEditorAPI api = worldEditor.GetApi();
			if (!api)
			{
				resp.status = "error";
				resp.message = "WorldEditorAPI not available: no world is open";
				return resp;
			}
			if (api.IsGameMode())
			{
				resp.status = "error";
				resp.message = "WRONG_MODE: the World Editor is in play mode; nothing was changed - stop play first (wb_world stop)";
				return resp;
			}
		}

		if (req.action == "play")
		{
			// SwitchToGameMode(bool debugMode=false, bool fullScreen=false) is void and the mode
			// switch is applied by the editor after this call returns, so GetApi() cannot be used
			// to confirm it here. Confirm via EMCP_WB_Ping / EMCP_WB_GetState "mode".
			worldEditor.SwitchToGameMode(req.debugMode, req.fullScreen);
			resp.status = "ok";
			resp.message = "Switched to game mode (SwitchToGameMode is void - confirm via wb_state mode)";
		}
		else if (req.action == "stop")
		{
			// SwitchToEditMode() is void - same caveat as play.
			worldEditor.SwitchToEditMode();
			resp.status = "ok";
			resp.message = "Switched to edit mode (SwitchToEditMode is void - confirm via wb_state mode)";
		}
		else if (req.action == "save")
		{
			// Retired (review round 1, F11): the 1.x save had no project guard, no confirm and no
			// project-world check, and no shipped tool sends it (wb_save routes through wb_module).
			// EMCP_WB_Module save is the one guarded save; nothing is saved here.
			resp.status = "error";
			resp.message = "save is retired on EMCP_WB_EditorControl: it saved any open world unguarded; nothing was saved - use EMCP_WB_Module save (wb_module save, or wb_save)";
		}
		else if (req.action == "saveAs")
		{
			// The Workbench WorldEditor module exposes only Save(). SaveWorldAs(string, bool) exists
			// solely on GameWorldEditor (the in-game editor), which is not reachable from this
			// Workbench-side handler. Refuse instead of silently overwriting the current world.
			resp.status = "error";
			resp.message = "saveAs not supported by the public WorldEditor API (SaveWorldAs exists only on GameWorldEditor) - use save";
		}
		else if (req.action == "undo")
		{
			array<string> menuPath = {};
			menuPath.Insert("Edit");
			menuPath.Insert("Undo");
			bool executed = worldEditor.ExecuteAction(menuPath);
			if (executed)
			{
				resp.status = "ok";
				resp.message = "Undo executed";
			}
			else
			{
				resp.status = "error";
				resp.message = "ExecuteAction(Edit, Undo) returned false (nothing to undo, or action unavailable in current mode)";
			}
		}
		else if (req.action == "redo")
		{
			array<string> menuPath = {};
			menuPath.Insert("Edit");
			menuPath.Insert("Redo");
			bool executed = worldEditor.ExecuteAction(menuPath);
			if (executed)
			{
				resp.status = "ok";
				resp.message = "Redo executed";
			}
			else
			{
				resp.status = "error";
				resp.message = "ExecuteAction(Edit, Redo) returned false (nothing to redo, or action unavailable in current mode)";
			}
		}
		else if (req.action == "openResource")
		{
			if (req.path == "")
			{
				resp.status = "error";
				resp.message = "path parameter required for openResource action";
			}
			else
			{
				// Only the module that owns the file type is asked: the World Editor takes a .ent or
				// a .et and nothing else (a .conf raised a modal, W2 run 2).
				string openedIn = EMCP_WB_OpenResource.OpenInOwningModule(req.path);
				if (openedIn != "")
				{
					resp.status = "ok";
					resp.message = "Opened resource: " + req.path;
					if (openedIn != "WorldEditor")
						resp.message = resp.message + " (through " + openedIn + ")";
				}
				else
				{
					resp.status = "error";
					resp.message = "SetOpenedResource returned false for: " + req.path;
				}
			}
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: play, stop, save, saveAs, undo, redo, openResource";
		}

		return resp;
	}
}
