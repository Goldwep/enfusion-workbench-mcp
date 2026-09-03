/**
 * EMCP_WB_ExecuteAction.c - Generic menu action executor
 *
 * Executes arbitrary Workbench menu actions by path.
 * menuPath is comma-separated, e.g. "Edit,Select All" or "Tools,Reload Scripts"
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_ExecuteAction"
 */

class EMCP_WB_ExecuteActionRequest : JsonApiStruct
{
	string menuPath;

	void EMCP_WB_ExecuteActionRequest()
	{
		RegV("menuPath");
	}
}

class EMCP_WB_ExecuteActionResponse : JsonApiStruct
{
	string status;
	string menuPath;
	string message;

	void EMCP_WB_ExecuteActionResponse()
	{
		RegV("status");
		RegV("menuPath");
		RegV("message");
	}
}

class EMCP_WB_ExecuteAction : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ExecuteActionRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ExecuteActionRequest req = EMCP_WB_ExecuteActionRequest.Cast(request);
		EMCP_WB_ExecuteActionResponse resp = new EMCP_WB_ExecuteActionResponse();
		resp.menuPath = req.menuPath;

		if (req.menuPath == "")
		{
			resp.status = "error";
			resp.message = "menuPath parameter required (comma-separated, e.g. 'Edit,Select All')";
			return resp;
		}

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return resp;
		}

		// Split menuPath on commas and trim each segment.
		// string.Trim() returns a NEW string (proto external string Trim()); it does not modify
		// the receiver - the trimmed value must be assigned back. (TrimInPlace() is the in-place variant.)
		array<string> rawParts = {};
		req.menuPath.Split(",", rawParts, true);

		array<string> parts = {};
		for (int i = 0; i < rawParts.Count(); i++)
		{
			string part = rawParts[i].Trim();
			if (part.Length() > 0)
				parts.Insert(part);
		}

		if (parts.Count() == 0)
		{
			resp.status = "error";
			resp.message = "menuPath resolved to empty array";
			return resp;
		}

		bool result = worldEditor.ExecuteAction(parts);
		if (result)
		{
			resp.status = "ok";
			resp.message = "Action executed successfully";
		}
		else
		{
			resp.status = "error";
			resp.message = "ExecuteAction returned false (menu path not found or action unavailable in current mode)";
		}

		return resp;
	}
}
