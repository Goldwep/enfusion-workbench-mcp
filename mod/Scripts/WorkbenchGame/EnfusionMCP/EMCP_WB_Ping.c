/**
 * EMCP_WB_Ping.c - Health check handler for EnfusionMCP Workbench bridge
 *
 * Returns status, the current editor mode (edit vs game) and buildStamp: the digest of the handler
 * set this bundle was built from (EMCP_WB_BuildStamp.c, written by scripts/build-stamp.ts), which
 * the server compares with its own bundle (client.ts checkBuildStamp).
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Ping"
 */

class EMCP_WB_PingRequest : JsonApiStruct
{
	//! The one action is "ping"; the key is optional (1.x clients send no parameters).
	string action;

	void EMCP_WB_PingRequest()
	{
		RegV("action");
	}
}

class EMCP_WB_PingResponse : JsonApiStruct
{
	string status;
	string mode;
	string message;
	string buildStamp;

	void EMCP_WB_PingResponse()
	{
		RegV("status");
		RegV("mode");
		RegV("message");
		RegV("buildStamp");
	}
}

class EMCP_WB_Ping : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_PingRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_PingResponse resp = new EMCP_WB_PingResponse();
		resp.buildStamp = EMCP_WB_BuildStamp.VALUE;

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "ok";
			resp.mode = "no_world_editor";
			resp.message = "EnfusionMCP Workbench bridge active (no WorldEditor module)";
			return resp;
		}

		WorldEditorAPI api = worldEditor.GetApi();
		if (api)
		{
			resp.status = "ok";
			resp.mode = "edit";
			resp.message = "EnfusionMCP Workbench bridge active";
		}
		else
		{
			resp.status = "ok";
			resp.mode = "game";
			resp.message = "EnfusionMCP Workbench bridge active (game mode)";
		}

		return resp;
	}
}
