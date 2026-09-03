/**
 * EMCP_WB_GetCameraPos.c - Get current World Editor camera position
 *
 * Returns the position of the current Workbench viewport camera using
 * BaseWorld.GetCurrentCamera(out vector mat[4]).
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_GetCameraPos"
 */

class EMCP_WB_GetCameraPosRequest : JsonApiStruct
{
	void EMCP_WB_GetCameraPosRequest()
	{
		// No parameters needed
	}
}

class EMCP_WB_GetCameraPosResponse : JsonApiStruct
{
	string status;
	string message;
	string position;

	void EMCP_WB_GetCameraPosResponse()
	{
		RegV("status");
		RegV("message");
		RegV("position");
	}
}

class EMCP_WB_GetCameraPos : NetApiHandler
{
	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_GetCameraPosRequest();
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_GetCameraPosResponse resp = new EMCP_WB_GetCameraPosResponse();

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

		BaseWorld world = api.GetWorld();
		if (!world)
		{
			resp.status = "error";
			resp.message = "No world loaded";
			return resp;
		}

		vector camMat[4];
		world.GetCurrentCamera(camMat);

		vector pos = camMat[3];
		resp.position = pos[0].ToString() + " " + pos[1].ToString() + " " + pos[2].ToString();
		resp.status = "ok";
		resp.message = "Camera position retrieved";

		return resp;
	}
}
