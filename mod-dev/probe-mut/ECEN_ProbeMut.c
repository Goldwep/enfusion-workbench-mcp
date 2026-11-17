/**
 * ECEN_ProbeMut.c - Mutating census probe handler (development only, never shipped)
 *
 * Plan 5.4 item 7 and Appendix A. Installed only for session S-E, by the live harness, beside the
 * complete shipped handler set:
 *   scripts/live/launch.ts --install-handlers <sandbox> --probe-pack mod-dev/probe-mut
 *
 * One NET API function, APIFunc = "ECEN_ProbeMut", dispatching on "action":
 *   containerWriteTest, saveContainer, pluginRunDialogFree, layerCreateThrowaway,
 *   terrainWriteThrowaway, diagSet, createSandboxWorlds
 *
 * Guards compiled in (ECEN_ProbeMutGuard.c), not promised by the harness: every action refuses
 * unless the opened project is the 2.0 sandbox (EMCP2_sandbox/EMCP2_sandbox.gproj); every action
 * that writes a file takes an explicit target that must resolve inside that project's folder, and,
 * for every action except createSandboxWorlds, inside its _throwaway/ folder; the world actions
 * also check that the world open in the World Editor is the target and has exactly one sub-scene,
 * and no action switches the World Editor's world; containerWriteTest writes only a container whose
 * GetSourceAddons is the sandbox alone and never calls a module Save(). pluginRunDialogFree runs
 * Run() only for a module and class compiled into ECEN_ProbeMutLists.c, diagSet changes only an
 * option compiled there; both lists are generated; one entry each for S-E (DEC-043). Paths in a response go through
 * ECEN_ProbeMutGuard.ShowPath. Request and response keys: mod-dev/contracts/ECEN_ProbeMut.json.
 *
 * Installed for S-E only: pre-flight refuses any other session's queue while these files are in
 * the sandbox's EnfusionCensus/ folder, S-E's post-flight removes them, and an install of the
 * read-only pack alone deletes them (mod-dev/README.md, "Removal of the mutating pack").
 */

class ECEN_ProbeMutRequest : JsonApiStruct
{
	string action;
	// project-relative target (createSandboxWorlds: the addon-prefixed folder CreateWorld takes)
	string target;
	// saveContainer: resource name to load
	string source;
	// containerWriteTest, pluginRunDialogFree: one of ten module names (never ParticleEditor, DEC-042)
	string moduleName;
	int index;
	string varName;
	string value;
	// compiled off: a request that sets it is refused
	bool moduleSave;
	// pluginRunDialogFree ("class" is a keyword in Enforce)
	string className;
	// layerCreateThrowaway, terrainWriteThrowaway
	int subScene;
	string name;
	string parentPath;
	bool setActive;
	bool save;
	string mode;
	int terrainIndex;
	int tileX;
	int tileY;
	int sample;
	float delta;
	float x;
	float z;
	float size;
	float inner;
	// diagSet
	string diagEnum;
	int diagId;
	bool engine;
	int diagValue;
	// createSandboxWorlds
	string tinyName;
	string terrainName;
	ref array<string> terrainEntities;

	void ECEN_ProbeMutRequest()
	{
		terrainEntities = {};

		RegV("action");
		RegV("target");
		RegV("source");
		RegV("moduleName");
		RegV("index");
		RegV("varName");
		RegV("value");
		RegV("moduleSave");
		RegV("className");
		RegV("subScene");
		RegV("name");
		RegV("parentPath");
		RegV("setActive");
		RegV("save");
		RegV("mode");
		RegV("terrainIndex");
		RegV("tileX");
		RegV("tileY");
		RegV("sample");
		RegV("delta");
		RegV("x");
		RegV("z");
		RegV("size");
		RegV("inner");
		RegV("diagEnum");
		RegV("diagId");
		RegV("engine");
		RegV("diagValue");
		RegV("tinyName");
		RegV("terrainName");
		RegV("terrainEntities");

		// Defaults for keys the request leaves out.
		subScene = -1;
		diagId = -1;
	}
}

class ECEN_ProbeMutResponse : JsonApiStruct
{
	// ok, error or refused
	string status;
	string action;
	string message;
	ref array<string> factKeys;
	ref array<string> factValues;
	ref array<string> columns;
	ref array<string> cells;

	void ECEN_ProbeMutResponse()
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

class ECEN_ProbeMut : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new ECEN_ProbeMutRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		ECEN_ProbeMutRequest req = ECEN_ProbeMutRequest.Cast(request);
		ECEN_ProbeMutResponse resp = new ECEN_ProbeMutResponse();
		resp.action = req.action;

		// Guard (a) for every action: the opened project is the 2.0 sandbox.
		string projectDir = "";
		string why = "";
		if (!ECEN_ProbeMutGuard.SandboxDir(projectDir, why))
		{
			resp.Refuse(why);
			return resp;
		}

		if (req.action == "containerWriteTest")
			ECEN_ProbeMutActions.ContainerWriteTest(req, resp);
		else if (req.action == "saveContainer")
			ECEN_ProbeMutActions.SaveContainerCopy(req, resp);
		else if (req.action == "pluginRunDialogFree")
			ECEN_ProbeMutActions.PluginRunDialogFree(req, resp);
		else if (req.action == "diagSet")
			ECEN_ProbeMutActions.DiagSet(req, resp);
		else if (req.action == "createSandboxWorlds")
			ECEN_ProbeMutActions.CreateSandboxWorlds(req, resp);
		else if (req.action == "layerCreateThrowaway")
			ECEN_ProbeMutWorld.LayerCreateThrowaway(req, resp);
		else if (req.action == "terrainWriteThrowaway")
			ECEN_ProbeMutWorld.TerrainWriteThrowaway(req, resp);
		else
			resp.Fail("Unknown action: " + req.action + ". Valid: containerWriteTest, saveContainer, pluginRunDialogFree, layerCreateThrowaway, terrainWriteThrowaway, diagSet, createSandboxWorlds");

		return resp;
	}
}
