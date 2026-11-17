/**
 * EMCP_WB_CreateEntity.c - Create entity from prefab in WorldEditor
 *
 * Creates a new entity from a prefab resource path at the specified position.
 * Position and rotation are passed as "x y z" (or "x, y, z") strings.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_CreateEntity"
 *
 * WorldEditorAPI signature (verified against the API index):
 *   IEntitySource CreateEntity(string className, string name, int layerId,
 *                              IEntitySource parent, vector coords, vector angles)
 */

class EMCP_WB_CreateEntityRequest : JsonApiStruct
{
	string prefab;
	string position;
	string rotation;
	string name;
	int layerID;

	void EMCP_WB_CreateEntityRequest()
	{
		RegV("prefab");
		RegV("position");
		RegV("rotation");
		RegV("name");
		RegV("layerID");
		layerID = -1;
	}
}

class EMCP_WB_CreateEntityResponse : JsonApiStruct
{
	string status;
	string message;
	string entityName;
	string entityClass;
	string position;
	// Non-fatal advisory (e.g. bare prefab path without a {GUID} prefix). Empty when none.
	string warning;

	void EMCP_WB_CreateEntityResponse()
	{
		RegV("status");
		RegV("message");
		RegV("entityName");
		RegV("entityClass");
		RegV("position");
		RegV("warning");
	}
}

class EMCP_WB_CreateEntity : NetApiHandler
{
	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_CreateEntityRequest();
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_CreateEntityRequest req = EMCP_WB_CreateEntityRequest.Cast(request);
		EMCP_WB_CreateEntityResponse resp = new EMCP_WB_CreateEntityResponse();

		if (req.prefab == "")
		{
			resp.status = "error";
			resp.message = "prefab parameter required (resource path, e.g. '{GUID}Prefabs/Entity.et')";
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
			resp.message = "WorldEditorAPI not available (in game mode?)";
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

		// Position / rotation are optional (default origin / no rotation) but must parse when given.
		vector pos = vector.Zero;
		vector rot = vector.Zero;
		string parseErr;

		if (req.position != "" && !EMCP_WB_Common.ParseVectorString(req.position, pos, parseErr))
		{
			resp.status = "error";
			resp.message = "Invalid position: " + parseErr;
			return resp;
		}
		if (req.rotation != "" && !EMCP_WB_Common.ParseVectorString(req.rotation, rot, parseErr))
		{
			resp.status = "error";
			resp.message = "Invalid rotation: " + parseErr;
			return resp;
		}

		// A prefab path without a {GUID} prefix is accepted by CreateEntity but the entity source
		// then stores a zero GUID for its ancestor, which breaks prefab linkage on save/reload.
		if (!req.prefab.StartsWith("{"))
			resp.warning = "bare path stores a zero GUID; use {GUID}path";

		// Default to layer 0 if not specified
		int targetLayer = req.layerID;
		if (targetLayer < 0)
			targetLayer = 0;

		// Entity name defaults to empty (auto-generated)
		string entityName = req.name;

		api.BeginEntityAction("CC: Create entity from prefab");

		IEntitySource entSrc = api.CreateEntity(req.prefab, entityName, targetLayer, null, pos, rot);

		if (!entSrc)
		{
			api.EndEntityAction();
			resp.status = "error";
			resp.message = "CreateEntity returned null. Check prefab path: " + req.prefab;
			return resp;
		}

		// If a name was requested but not set during creation, rename
		bool renameFailed = false;
		if (entityName != "" && entSrc.GetName() != entityName)
		{
			if (!api.RenameEntity(entSrc, entityName))
				renameFailed = true;
		}

		api.EndEntityAction();

		resp.entityName = entSrc.GetName();
		resp.entityClass = entSrc.GetClassName();
		// The placed entity's world origin, read back (never the request echoed: live-tools-a-02);
		// empty when the runtime entity is not there to read.
		IEntity placedEnt = api.SourceToEntity(entSrc);
		if (placedEnt)
			resp.position = EMCP_WB_Common.VectorToString(placedEnt.GetOrigin());

		if (renameFailed)
		{
			resp.status = "error";
			resp.message = "Entity created from prefab " + req.prefab + " but RenameEntity to '" + entityName + "' returned false (name in use?). Actual name: " + resp.entityName;
			return resp;
		}

		resp.status = "ok";
		resp.message = "Entity created from prefab: " + req.prefab;

		return resp;
	}
}
