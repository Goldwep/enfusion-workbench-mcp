/**
 * EMCP_WB_DeleteEntity.c - Delete entity by name
 *
 * Finds an entity by name and deletes it using WorldEditorAPI.DeleteEntity (returns bool).
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_DeleteEntity"
 */

class EMCP_WB_DeleteEntityRequest : JsonApiStruct
{
	string name;

	void EMCP_WB_DeleteEntityRequest()
	{
		RegV("name");
	}
}

class EMCP_WB_DeleteEntityResponse : JsonApiStruct
{
	string status;
	string message;
	string deletedName;
	string deletedClass;

	void EMCP_WB_DeleteEntityResponse()
	{
		RegV("status");
		RegV("message");
		RegV("deletedName");
		RegV("deletedClass");
	}
}

class EMCP_WB_DeleteEntity : NetApiHandler
{
	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_DeleteEntityRequest();
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_DeleteEntityRequest req = EMCP_WB_DeleteEntityRequest.Cast(request);
		EMCP_WB_DeleteEntityResponse resp = new EMCP_WB_DeleteEntityResponse();

		if (req.name == "")
		{
			resp.status = "error";
			resp.message = "name parameter required";
			return resp;
		}

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return resp;
		}

		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			resp.status = "error";
			resp.message = "WorldEditorAPI not available";
			return resp;
		}

		// The guard of the W-wave edit handlers (DEC-058, EditApi of EMCP_WB_Entity.c): the project
		// is found, the editor is not in play mode.
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			resp.status = "error";
			resp.message = EMCP_WB_Guard.NOT_IN_PROJECT + ": mutating actions need the handlers installed in the open project; nothing was changed";
			return resp;
		}
		if (api.IsGameMode())
		{
			resp.status = "error";
			resp.message = "WRONG_MODE: the World Editor is in play mode; nothing was changed - stop play first (wb_world stop)";
			return resp;
		}

		IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.name);
		if (!entSrc)
		{
			resp.status = "error";
			resp.message = "Entity not found: " + req.name;
			return resp;
		}

		resp.deletedName = entSrc.GetName();
		resp.deletedClass = entSrc.GetClassName();

		api.BeginEntityAction("CC: Delete entity");
		bool deleted = api.DeleteEntity(entSrc);
		api.EndEntityAction();

		if (deleted)
		{
			resp.status = "ok";
			resp.message = "Entity deleted: " + resp.deletedName;
		}
		else
		{
			resp.status = "error";
			resp.message = "DeleteEntity returned false for: " + resp.deletedName;
		}

		return resp;
	}
}
