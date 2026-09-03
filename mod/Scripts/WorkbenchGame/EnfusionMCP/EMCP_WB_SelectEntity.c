/**
 * EMCP_WB_SelectEntity.c - Selection management handler
 *
 * Actions: select, deselect, clear, getSelected
 * "select"      uses WorldEditorAPI.SetEntitySelection (replaces the current selection) and
 *               verifies the result via GetSelectedEntity(0).
 * "deselect"    uses RemoveFromEntitySelection.
 * "clear"       uses ClearEntitySelection.
 * "getSelected" iterates GetSelectedEntity.
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_SelectEntity"
 */

class EMCP_WB_SelectEntityRequest : JsonApiStruct
{
	string action;
	string name;

	void EMCP_WB_SelectEntityRequest()
	{
		RegV("action");
		RegV("name");
	}
}

class EMCP_WB_SelectEntityResponse : JsonApiStruct
{
	string status;
	string message;
	string action;
	int selectedCount;

	// Selected entity names for getSelected
	ref array<string> m_aSelectedNames;
	ref array<string> m_aSelectedClasses;

	void EMCP_WB_SelectEntityResponse()
	{
		RegV("status");
		RegV("message");
		RegV("action");
		RegV("selectedCount");

		m_aSelectedNames = {};
		m_aSelectedClasses = {};
	}

	override void OnPack()
	{
		if (m_aSelectedNames.Count() > 0)
		{
			StartArray("selectedEntities");
			for (int i = 0; i < m_aSelectedNames.Count(); i++)
			{
				StartObject("");
				StoreString("name", m_aSelectedNames[i]);
				StoreString("className", m_aSelectedClasses[i]);
				EndObject();
			}
			EndArray();
		}
	}
}

class EMCP_WB_SelectEntity : NetApiHandler
{
	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_SelectEntityRequest();
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_SelectEntityRequest req = EMCP_WB_SelectEntityRequest.Cast(request);
		EMCP_WB_SelectEntityResponse resp = new EMCP_WB_SelectEntityResponse();
		resp.action = req.action;

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

		if (req.action == "select")
		{
			if (req.name == "")
			{
				resp.status = "error";
				resp.message = "name parameter required for select action";
				return resp;
			}

			IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.name);
			if (!entSrc)
			{
				resp.status = "error";
				resp.message = "Entity not found: " + req.name;
				return resp;
			}

			// SetEntitySelection(notnull IEntitySource) is void - verify by reading the selection back.
			api.SetEntitySelection(entSrc);

			resp.selectedCount = api.GetSelectedEntitiesCount();
			bool verified = false;
			if (resp.selectedCount > 0)
			{
				IEntitySource sel = api.GetSelectedEntity(0);
				if (sel && sel.GetName() == req.name)
					verified = true;
			}

			if (verified)
			{
				resp.m_aSelectedNames.Insert(entSrc.GetName());
				resp.m_aSelectedClasses.Insert(entSrc.GetClassName());
				resp.status = "ok";
				resp.message = "Entity selected: " + req.name;
			}
			else
			{
				resp.status = "error";
				resp.message = "SetEntitySelection did not take effect for: " + req.name + " (selected count after call: " + resp.selectedCount.ToString() + ")";
			}
		}
		else if (req.action == "deselect")
		{
			if (req.name == "")
			{
				resp.status = "error";
				resp.message = "name parameter required for deselect action";
				return resp;
			}

			IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.name);
			if (!entSrc)
			{
				resp.status = "error";
				resp.message = "Entity not found: " + req.name;
				return resp;
			}

			int before = api.GetSelectedEntitiesCount();
			api.RemoveFromEntitySelection(entSrc);
			resp.selectedCount = api.GetSelectedEntitiesCount();
			resp.status = "ok";
			if (resp.selectedCount < before)
				resp.message = "Entity deselected: " + req.name;
			else
				resp.message = "Entity was not in the selection: " + req.name + " (selection unchanged)";
		}
		else if (req.action == "clear")
		{
			api.ClearEntitySelection();
			resp.selectedCount = api.GetSelectedEntitiesCount();
			if (resp.selectedCount == 0)
			{
				resp.status = "ok";
				resp.message = "Selection cleared";
			}
			else
			{
				resp.status = "error";
				resp.message = "ClearEntitySelection did not take effect (" + resp.selectedCount.ToString() + " still selected)";
			}
		}
		else if (req.action == "getSelected")
		{
			int selCount = api.GetSelectedEntitiesCount();
			resp.selectedCount = selCount;

			int maxReport = selCount;
			if (maxReport > 100)
				maxReport = 100; // Cap to prevent oversized responses

			for (int i = 0; i < maxReport; i++)
			{
				IEntitySource selSrc = api.GetSelectedEntity(i);
				if (selSrc)
				{
					resp.m_aSelectedNames.Insert(selSrc.GetName());
					resp.m_aSelectedClasses.Insert(selSrc.GetClassName());
				}
			}

			resp.status = "ok";
			resp.message = "Selected entities: " + selCount.ToString();
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: select, deselect, clear, getSelected";
		}

		return resp;
	}
}
