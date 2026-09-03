/**
 * EMCP_WB_Prefabs.c - Prefab operations handler
 *
 * Actions: createTemplate, save, getAncestor
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Prefabs"
 *
 * createTemplate requires a PROJECT-RELATIVE templatePath (e.g. "Prefabs/Custom/Thing.et").
 * Absolute paths, drive letters, UNC paths and ".." segments are refused so the handler cannot
 * be used to write outside the project tree. The path is resolved through Workbench.GetAbsolutePath:
 *   - with addonName:           "$<addonName>:<templatePath>"
 *   - templatePath "$Addon:..": used as-is
 *   - bare relative path:       passed to GetAbsolutePath directly; error if it cannot resolve.
 */

class EMCP_WB_PrefabsRequest : JsonApiStruct
{
	string action;
	string entityName;
	string templatePath;
	string addonName;

	void EMCP_WB_PrefabsRequest()
	{
		RegV("action");
		RegV("entityName");
		RegV("templatePath");
		RegV("addonName");
	}
}

class EMCP_WB_PrefabsResponse : JsonApiStruct
{
	string status;
	string message;
	string action;
	string entityName;
	string ancestorPath;

	void EMCP_WB_PrefabsResponse()
	{
		RegV("status");
		RegV("message");
		RegV("action");
		RegV("entityName");
		RegV("ancestorPath");
	}
}

class EMCP_WB_Prefabs : NetApiHandler
{
	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_PrefabsRequest();
	}

	//------------------------------------------------------------------------------------------------
	//! Validates that templatePath is project-relative. Returns an error string, or "" when OK.
	static string ValidateTemplatePath(string normalized)
	{
		if (normalized.Contains(".."))
			return "templatePath must not contain '..' segments";
		if (normalized.StartsWith("/"))
			return "templatePath must be project-relative, not absolute or UNC (got '" + normalized + "')";
		if (normalized.Contains(":") && !normalized.StartsWith("$"))
			return "templatePath must be project-relative; drive letters are not allowed (got '" + normalized + "'). Use e.g. 'Prefabs/Custom/Thing.et' plus addonName, or '$AddonName:Prefabs/Custom/Thing.et'";
		if (normalized.StartsWith("$") && !normalized.Contains(":"))
			return "templatePath '$' notation must be '$AddonName:relative/path' (got '" + normalized + "')";
		return "";
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_PrefabsRequest req = EMCP_WB_PrefabsRequest.Cast(request);
		EMCP_WB_PrefabsResponse resp = new EMCP_WB_PrefabsResponse();
		resp.action = req.action;
		resp.entityName = req.entityName;

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

		if (req.action == "createTemplate")
		{
			if (req.entityName == "" || req.templatePath == "")
			{
				resp.status = "error";
				resp.message = "entityName and templatePath required for createTemplate";
				return resp;
			}

			// Normalise separators before validation.
			string relPath = req.templatePath;
			relPath.Replace("\\", "/");

			string validationError = ValidateTemplatePath(relPath);
			if (validationError != "")
			{
				resp.status = "error";
				resp.message = validationError;
				return resp;
			}

			// Build the Workbench-notation path and resolve it to an absolute filesystem path.
			string wbPath = relPath;
			if (req.addonName != "")
			{
				wbPath = "$" + req.addonName + ":" + relPath;
			}

			string absTemplatePath;
			if (!Workbench.GetAbsolutePath(wbPath, absTemplatePath, false))
			{
				resp.status = "error";
				resp.message = "Could not resolve project-relative templatePath '" + wbPath + "' (addon not loaded?). Pass addonName so it resolves as $ADDONNAME:path, or use '$AddonName:Prefabs/...' notation.";
				return resp;
			}
			absTemplatePath.Replace("\\", "/");

			// Create parent directory if it does not exist
			int lastSlash = absTemplatePath.LastIndexOf("/");
			if (lastSlash > 0)
			{
				string absFolder = absTemplatePath.Substring(0, lastSlash + 1);
				if (!FileIO.FileExists(absFolder))
				{
					if (!FileIO.MakeDirectory(absFolder))
					{
						resp.status = "error";
						resp.message = "MakeDirectory failed for: " + absFolder;
						return resp;
					}
				}
			}

			IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.entityName);
			if (!entSrc)
			{
				resp.status = "error";
				resp.message = "Entity not found: " + req.entityName;
				return resp;
			}

			api.BeginEntityAction("Create template via NetAPI");

			// Try direct first - works when entity has children or is in your addon's layer
			bool result = api.CreateEntityTemplate(entSrc, absTemplatePath);
			bool tempDeleteFailed = false;

			if (!result)
			{
				// Fallback: spawn temp entity from ancestor prefab, save that, then delete it.
				// This handles locked base-game entities that have no scene children.
				BaseContainer ancestor = entSrc.GetAncestor();
				string ancestorPath;
				if (ancestor)
					ancestorPath = ancestor.GetResourceName();

				if (ancestorPath != string.Empty)
				{
					IEntitySource tempSrc = api.CreateEntity(ancestorPath, "", api.GetCurrentEntityLayerId(), null, vector.Zero, vector.Zero);
					if (tempSrc)
					{
						result = api.CreateEntityTemplate(tempSrc, absTemplatePath);
						if (!api.DeleteEntity(tempSrc))
							tempDeleteFailed = true;
					}
				}
			}

			api.EndEntityAction();

			if (result && tempDeleteFailed)
			{
				resp.status = "error";
				resp.message = "Template written to " + absTemplatePath + " but DeleteEntity returned false for the temporary entity - a stray entity spawned from the ancestor prefab of " + req.entityName + " remains at 0 0 0; delete it manually";
			}
			else if (result)
			{
				resp.status = "ok";
				resp.message = "Template created at: " + absTemplatePath;
			}
			else
			{
				resp.status = "error";
				resp.message = "CreateEntityTemplate returned false for path: " + absTemplatePath;
			}
		}
		else if (req.action == "save")
		{
			if (req.entityName == "")
			{
				resp.status = "error";
				resp.message = "entityName required for save action";
				return resp;
			}

			IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.entityName);
			if (!entSrc)
			{
				resp.status = "error";
				resp.message = "Entity not found: " + req.entityName;
				return resp;
			}

			bool result = api.SaveEntityTemplate(entSrc);
			if (result)
			{
				resp.status = "ok";
				resp.message = "Entity template saved for: " + req.entityName;
			}
			else
			{
				resp.status = "error";
				resp.message = "SaveEntityTemplate returned false (entity may not be a template instance)";
			}
		}
		else if (req.action == "getAncestor")
		{
			if (req.entityName == "")
			{
				resp.status = "error";
				resp.message = "entityName required for getAncestor action";
				return resp;
			}

			IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.entityName);
			if (!entSrc)
			{
				resp.status = "error";
				resp.message = "Entity not found: " + req.entityName;
				return resp;
			}

			BaseContainer ancestor = entSrc.GetAncestor();
			if (ancestor)
			{
				resp.ancestorPath = ancestor.GetResourceName();
				resp.status = "ok";
				resp.message = "Ancestor prefab: " + resp.ancestorPath;
			}
			else
			{
				resp.ancestorPath = "";
				resp.status = "ok";
				resp.message = "Entity has no ancestor (not a prefab instance)";
			}
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: createTemplate, save, getAncestor";
		}

		return resp;
	}
}
