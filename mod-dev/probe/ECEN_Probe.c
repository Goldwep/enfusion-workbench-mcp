/**
 * ECEN_Probe.c - Read-only census probe handler (development only, never shipped)
 *
 * Plan 5.4 item 7 and Appendix A. Installed only by the live harness, beside the complete shipped
 * handler set, into the 2.0 sandbox's Scripts/WorkbenchGame/EnfusionCensus/ folder:
 *   scripts/live/launch.ts --install-handlers <sandbox> --probe-pack mod-dev/probe
 *
 * One NET API function, APIFunc = "ECEN_Probe", dispatching on "action":
 *   info, moduleMatrix, containerDump, executeAction, getPlugin, pluginAttrs, toolInstance,
 *   evalCompile, loadContainer, layerRead, terrainFacts, diagRead, screenshot, modalTest, authProbe
 *
 * Every action except info refuses unless the opened project is the 2.0 sandbox
 * (ECEN_ProbeUtil.SandboxDir). Every action reads. The exceptions are named: executeAction runs a
 * menu action only for a path compiled into ECEN_ProbeAllowList.c (generated from the policy: the
 * allow-list, or with candidate set the candidate list of DEC-100); moduleMatrix opens one named module only when the request sets openModules;
 * evalCompile compiles and calls the text it is sent (plan U5) only when the allow screen of
 * ECEN_ProbeEval.c passes it; screenshot writes one new BMP under the sandbox's _throwaway/ folder;
 * modalTest opens the one dialog this pack opens. Paths in a response go through
 * ECEN_ProbeUtil.ShowPath ("<sandbox>", "%USERPROFILE%"). Request and response keys:
 * mod-dev/contracts/ECEN_Probe.json. A table travels as "columns" plus "cells" (row-major),
 * paged by "page" (ECEN_ProbeUtil.PAGE_ROWS rows a page).
 */

class ECEN_ProbeRequest : JsonApiStruct
{
	string action;
	// moduleMatrix: open the one module moduleName names when it is not open
	bool openModules;
	// moduleMatrix (with openModules), containerDump, executeAction, getPlugin, pluginAttrs: one
	// of the ten module names (never ParticleEditor, DEC-042)
	string moduleName;
	// containerDump
	int index;
	// containerDump, loadContainer
	int depth;
	// any action that returns a table
	int page;
	// executeAction
	ref array<string> menuPath;
	bool keepFocus;
	// executeAction: match the path against the candidate list compiled into ECEN_ProbeAllowList.c
	// (DEC-100: no live result yet) instead of the allow-list. Only a live battery sets it.
	bool candidate;
	// getPlugin, pluginAttrs, toolInstance ("class" is a keyword in Enforce)
	string className;
	// evalCompile
	string text;
	// loadContainer: a resource name; screenshot: the file name inside folder
	string path;
	// screenshot: a folder relative to the 2.0 sandbox project folder
	string folder;
	// layerRead (-1: the current sub-scene)
	int subScene;
	// terrainFacts
	int terrainIndex;
	// diagRead: diagEnum for a script option; diagId with engine for an engine option
	string diagEnum;
	int diagId;
	bool engine;
	string diagMenu;
	// diagRead: also read the option's range value (GetRangeValue / GetEngineRangeValue). Off by
	// default: the engine asserts (enf_scriptcontext BadFloat) when a non-range option's stored float
	// is NaN or Inf, and that assertion is a modal box (P4-1 and P4-5, 2026-10-12)
	bool readRange;
	// authProbe (ECEN_ProbeAuth.c): closed lists, compared exactly
	string authMethod;
	string authRoot;
	string authVariant;

	void ECEN_ProbeRequest()
	{
		menuPath = {};

		RegV("action");
		RegV("openModules");
		RegV("moduleName");
		RegV("index");
		RegV("depth");
		RegV("page");
		RegV("menuPath");
		RegV("keepFocus");
		RegV("candidate");
		RegV("className");
		RegV("text");
		RegV("path");
		RegV("folder");
		RegV("subScene");
		RegV("terrainIndex");
		RegV("diagEnum");
		RegV("diagId");
		RegV("engine");
		RegV("diagMenu");
		RegV("readRange");
		RegV("authMethod");
		RegV("authRoot");
		RegV("authVariant");

		// Defaults for keys the request leaves out.
		keepFocus = true;
		subScene = -1;
		diagId = -1;
	}
}

class ECEN_ProbeResponse : JsonApiStruct
{
	// ok, error or refused
	string status;
	string action;
	string message;
	ref array<string> factKeys;
	ref array<string> factValues;
	ref array<string> columns;
	ref array<string> cells;
	int total;
	int page;
	int pageCount;

	void ECEN_ProbeResponse()
	{
		factKeys = {};
		factValues = {};
		columns = {};
		cells = {};

		RegV("status");
		RegV("action");
		RegV("message");
		RegV("factKeys");
		RegV("factValues");
		RegV("columns");
		RegV("cells");
		RegV("total");
		RegV("page");
		RegV("pageCount");
	}

	//------------------------------------------------------------------------------------------------
	void Fact(string key, string value)
	{
		factKeys.Insert(key);
		factValues.Insert(value);
	}

	//------------------------------------------------------------------------------------------------
	//! Sets the table columns from a comma-separated list.
	void SetColumns(string names)
	{
		columns.Clear();
		names.Split(",", columns, true);
	}

	//------------------------------------------------------------------------------------------------
	void Cell(string value)
	{
		cells.Insert(value);
	}

	//------------------------------------------------------------------------------------------------
	void Ok(string why)
	{
		status = "ok";
		message = why;
	}

	//------------------------------------------------------------------------------------------------
	void Fail(string why)
	{
		status = "error";
		message = why;
	}

	//------------------------------------------------------------------------------------------------
	void Refuse(string why)
	{
		status = "refused";
		message = why;
	}
}

class ECEN_Probe : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new ECEN_ProbeRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		ECEN_ProbeRequest req = ECEN_ProbeRequest.Cast(request);
		ECEN_ProbeResponse resp = new ECEN_ProbeResponse();
		resp.action = req.action;

		// Every action but info answers only when the opened project is the 2.0 sandbox.
		if (req.action != "info")
		{
			string projectDir = "";
			string why = "";
			if (!ECEN_ProbeUtil.SandboxDir(projectDir, why))
			{
				resp.Refuse(why + "; every action except info refuses outside the 2.0 sandbox");
				return resp;
			}
		}

		if (req.action == "info")
			ECEN_ProbeSystem.Info(req, resp);
		else if (req.action == "moduleMatrix")
			ECEN_ProbeModules.ModuleMatrix(req, resp);
		else if (req.action == "containerDump")
			ECEN_ProbeContainers.ContainerDump(req, resp);
		else if (req.action == "executeAction")
			ECEN_ProbeModules.ExecuteAction(req, resp);
		else if (req.action == "getPlugin")
			ECEN_ProbeModules.GetPluginInfo(req, resp);
		else if (req.action == "pluginAttrs")
			ECEN_ProbeModules.PluginAttrs(req, resp);
		else if (req.action == "toolInstance")
			ECEN_ProbeModules.ToolInstance(req, resp);
		else if (req.action == "evalCompile")
			ECEN_ProbeSystem.EvalCompile(req, resp);
		else if (req.action == "loadContainer")
			ECEN_ProbeContainers.LoadContainer(req, resp);
		else if (req.action == "layerRead")
			ECEN_ProbeWorld.LayerRead(req, resp);
		else if (req.action == "terrainFacts")
			ECEN_ProbeWorld.TerrainFacts(req, resp);
		else if (req.action == "diagRead")
			ECEN_ProbeSystem.DiagRead(req, resp);
		else if (req.action == "screenshot")
			ECEN_ProbeSystem.Screenshot(req, resp);
		else if (req.action == "modalTest")
			ECEN_ProbeSystem.ModalTest(req, resp);
		else if (req.action == "authProbe")
			ECEN_ProbeAuth.AuthProbe(req, resp);
		else
			resp.Fail("Unknown action: " + req.action + ". Valid: info, moduleMatrix, containerDump, executeAction, getPlugin, pluginAttrs, toolInstance, evalCompile, loadContainer, layerRead, terrainFacts, diagRead, screenshot, modalTest, authProbe");

		return resp;
	}
}
