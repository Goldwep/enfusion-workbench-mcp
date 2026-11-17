/**
 * EMCP_WB_Reload.c - retired reload handler (KD-007 fixed)
 *
 * The 1.x handler guessed ScriptEditor, WorldEditor and ResourceManager menu
 * labels through ExecuteAction; none was confirmed by a measured source. Script
 * reload is the native NET function ReloadScripts (DEC-040 U4, DEC-044), which
 * the server calls directly (src/workbench/native.ts reloadScripts; the
 * wb_scripts tool, with wb_reload as its alias). Enforce script has no API that
 * reloads the script modules from inside a handler, so this handler no longer
 * acts: it validates the target and answers which native route to use.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Reload"
 */

class EMCP_WB_ReloadRequest : JsonApiStruct
{
	string target;

	void EMCP_WB_ReloadRequest()
	{
		RegV("target");
	}
}

class EMCP_WB_ReloadResponse : JsonApiStruct
{
	string status;
	string message;

	void EMCP_WB_ReloadResponse()
	{
		RegV("status");
		RegV("message");
	}
}

class EMCP_WB_Reload : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ReloadRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ReloadRequest req = EMCP_WB_ReloadRequest.Cast(request);
		EMCP_WB_ReloadResponse resp = new EMCP_WB_ReloadResponse();

		string target = req.target;
		if (target == "")
			target = "scripts";

		if (target != "scripts" && target != "plugins" && target != "both")
		{
			resp.status = "error";
			resp.message = "Unknown target: " + target + ". Valid: scripts, plugins, both";
			return resp;
		}

		// No ExecuteAction and no menu label: the reload runs as the native NET
		// function ReloadScripts, called by the client, not by a handler.
		resp.status = "error";
		resp.message = "EMCP_WB_Reload no longer reloads (target " + target + "): call the native NET function ReloadScripts (wb_scripts action reload; wb_reload is its alias).";

		return resp;
	}
}
