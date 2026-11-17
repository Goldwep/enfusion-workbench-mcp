/**
 * ECEN_ProbeSystem.c - Workbench-wide actions of the read-only probe pack
 *
 * info (baseline; the opened-project assertion of plan 5.3 step 9), evalCompile (U5), diagRead
 * (U34), screenshot (U28) and modalTest (U6, U27). Every path a response carries goes through
 * ECEN_ProbeUtil.ShowPath first: the sandbox folder becomes "<sandbox>" and a home folder
 * "%USERPROFILE%". The user name is never read.
 */

class ECEN_ProbeSystem
{
	//------------------------------------------------------------------------------------------------
	//! info: the opened project file, whether it is the 2.0 sandbox, the executable path, the working
	//! directory and the loaded addons (GUID, id, title, vanilla). The only action that answers
	//! outside the 2.0 sandbox.
	static void Info(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		string projectFile = Workbench.GetCurrentGameProjectFile();
		string executable = "";
		Workbench.GetExecutableFilePath(executable);
		string cwd = "";
		Workbench.GetCwd(cwd);
		string projectDir = "";
		string why = "";
		bool isSandbox = ECEN_ProbeUtil.SandboxDir(projectDir, why);

		resp.Fact("projectFile", ECEN_ProbeUtil.ShowPath(projectFile));
		resp.Fact("isSandbox", isSandbox.ToString());
		resp.Fact("sandboxDir", ECEN_ProbeUtil.ShowPath(projectDir));
		resp.Fact("why", ECEN_ProbeUtil.ShowPath(why));
		resp.Fact("executable", ECEN_ProbeUtil.ShowPath(executable));
		resp.Fact("cwd", ECEN_ProbeUtil.ShowPath(cwd));

		// The World Editor's mode. WorldEditorAPI.IsGameMode is the readable play signal: with the
		// world played in the viewport (SwitchToGameMode(false, false)) the API stays available, so
		// "the API is null" is not one (P4-5 2026-10-12: GetState said edit while the world played).
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		resp.Fact("worldEditor", (worldEditor != null).ToString());
		string gameMode = "unknown";
		if (worldEditor)
		{
			WorldEditorAPI api = worldEditor.GetApi();
			resp.Fact("worldEditorApi", (api != null).ToString());
			if (api)
				gameMode = api.IsGameMode().ToString();
		}
		resp.Fact("isGameMode", gameMode);

		array<string> addons = {};
		GameProject.GetLoadedAddons(addons);
		resp.SetColumns("guid,id,title,vanilla");
		array<string> all = {};
		for (int i = 0; i < addons.Count(); i++)
		{
			string guid = addons.Get(i);
			all.Insert(guid);
			all.Insert(GameProject.GetAddonID(guid));
			all.Insert(GameProject.GetAddonTitle(guid));
			// GameProject.IsVanillaAddon is documented static but the 1.8.0.13 compiler refuses it
			// from a static method ("'this' or 'super' inside static method is not valid", S-D
			// 2026-10-06, DEC-042); the column stays, its value is not read live.
			all.Insert("not-read");
		}
		int addonCount = addons.Count();
		resp.Fact("loadedAddons", addonCount.ToString());
		ECEN_ProbeUtil.PageInto(resp, all, 4, req.page);
		resp.Ok("info");
	}

	//------------------------------------------------------------------------------------------------
	//! evalCompile: ScriptModule.CompileScript(text) with Workbench.GetWBGameScriptModule() as the
	//! parent, then Call(null, "ECEN_Eval", false, result). Compiled only when the text passes the
	//! allow screen of ECEN_ProbeEval.c: one function string ECEN_Eval(), no loop, no call of a
	//! global or own function, getters by name on listed classes only.
	static void EvalCompile(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		string text = req.text;
		string why = "";
		if (!ECEN_ProbeEval.Screen(text, why))
		{
			resp.Refuse("evalCompile refuses the text: " + why);
			return;
		}

		ScriptModule parent = Workbench.GetWBGameScriptModule();
		resp.Fact("parentModule", "GetWBGameScriptModule");
		if (!parent)
		{
			resp.Fail("Workbench.GetWBGameScriptModule returned null");
			return;
		}

		string errorText = "";
		int errorLine = 0;
		ScriptModule compiled = ScriptModule.CompileScript(parent, text, errorText, errorLine);
		bool isCompiled = compiled != null;
		resp.Fact("compiled", isCompiled.ToString());
		resp.Fact("errorText", ECEN_ProbeUtil.ShowPath(errorText));
		resp.Fact("errorLine", errorLine.ToString());
		if (!compiled)
		{
			resp.Fail("CompileScript returned null");
			return;
		}

		string result = "";
		bool called = compiled.Call(null, ECEN_ProbeEval.EVAL_FUNCTION, false, result);
		resp.Fact("called", called.ToString());
		resp.Fact("result", ECEN_ProbeUtil.ShowPath(result));
		resp.Ok("evalCompile done");
	}

	//------------------------------------------------------------------------------------------------
	//! True when id is on the engine diag list compiled into ECEN_ProbeAllowList.c.
	static bool EngineDiagListed(int id)
	{
		array<int> listed = {};
		ECEN_ProbeAllowList.EngineDiagIds(listed);
		for (int i = 0; i < listed.Count(); i++)
		{
			if (listed.Get(i) == id)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! diagRead: selects a diag menu by name when diagMenu is given (DiagMenu.SelectMenuByName), then
	//! reads one option. DiagMenu reads take an int id, not a path. A script option is named by its
	//! SCR_DebugMenuID value (diagEnum, resolved with typename.StringToEnum and checked back) and read
	//! with GetValue and GetBool. An engine option (engine: true) is named by its int id (diagId), read
	//! with GetEngineValue, and only when that id is on the list compiled into ECEN_ProbeAllowList.c
	//! (empty today): an id past the engine's table is never sent. The range value (GetRangeValue /
	//! GetEngineRangeValue) is read only when readRange is true: the engine asserts on a NaN or Inf
	//! stored float (enf_scriptcontext BadFloat, a modal box), and a non-range option's float may be one.
	static void DiagRead(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		bool engine = req.engine;
		string enumName = req.diagEnum;
		int id = -1;
		if (engine)
		{
			id = req.diagId;
			if (id < 0)
			{
				resp.Fail("diagId required for an engine option");
				return;
			}
			if (!EngineDiagListed(id))
			{
				int listedCount = ECEN_ProbeAllowList.EngineDiagCount();
				resp.Refuse("engine option " + id.ToString() + " is not on the list compiled into ECEN_ProbeAllowList.c (" + listedCount.ToString() + " entries)");
				return;
			}
		}
		else if (enumName != "")
		{
			id = typename.StringToEnum(SCR_DebugMenuID, enumName);
			string back = typename.EnumToString(SCR_DebugMenuID, id);
			if (back != enumName)
			{
				resp.Fail("diagEnum is not a SCR_DebugMenuID value: " + enumName);
				return;
			}
		}
		else if (req.diagId >= 0)
		{
			resp.Refuse("a script option is read by its SCR_DebugMenuID name (diagEnum), never by a raw diagId");
			return;
		}

		string menu = req.diagMenu;
		if (menu != "")
		{
			DiagMenu.SelectMenuByName(menu);
			resp.Fact("selectedMenu", menu);
		}
		if (id < 0)
		{
			if (menu != "")
			{
				resp.Ok("menu selected; no option read (give diagEnum, or diagId with engine)");
				return;
			}
			resp.Fail("give diagEnum (a SCR_DebugMenuID value name), diagId with engine, or diagMenu");
			return;
		}

		resp.Fact("diagId", id.ToString());
		resp.Fact("engine", engine.ToString());
		if (engine)
		{
			int engineValue = DiagMenu.GetEngineValue(id);
			resp.Fact("value", engineValue.ToString());
			if (req.readRange)
			{
				float engineRange = DiagMenu.GetEngineRangeValue(id);
				resp.Fact("rangeValue", engineRange.ToString());
			}
		}
		else
		{
			resp.Fact("diagEnum", enumName);
			int value = DiagMenu.GetValue(id);
			bool flag = DiagMenu.GetBool(id);
			resp.Fact("value", value.ToString());
			resp.Fact("bool", flag.ToString());
			if (req.readRange)
			{
				float range = DiagMenu.GetRangeValue(id);
				resp.Fact("rangeValue", range.ToString());
			}
		}
		resp.Ok("diag option read");
	}

	//------------------------------------------------------------------------------------------------
	//! screenshot: System.MakeScreenshot(path) writes a BMP. The engine takes one path string: an
	//! absolute or "$filesystem:" path is used as given, a relative one lands under $profile:, and an
	//! empty one under $profile:ScreenShots/. This action always passes an absolute path inside the
	//! 2.0 sandbox's _throwaway/ folder: <project folder>/<folder>/<path>, where folder is
	//! "_throwaway" or a folder under it and path a bare file name "<label>-<nonce>.bmp" whose nonce
	//! (at least six hex digits, supplied by the harness per run) makes the name new to the run, and
	//! that does not exist yet (FileIO.FileExists), so the call never overwrites a file even when
	//! FileExists answers false after a refused authorization prompt.
	static void Screenshot(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		string projectDir = "";
		string why = "";
		if (!ECEN_ProbeUtil.SandboxDir(projectDir, why))
		{
			resp.Refuse(why);
			return;
		}

		string folder = "";
		if (!ECEN_ProbeUtil.CleanRelative(req.folder, folder, why))
		{
			resp.Refuse("folder: " + why);
			return;
		}
		if (!ECEN_ProbeUtil.IsThrowawayFolder(folder))
		{
			resp.Refuse("folder must be " + ECEN_ProbeUtil.THROWAWAY + " or a folder under it");
			return;
		}

		string fileName = req.path;
		if (fileName == "" || fileName.Contains("/") || fileName.Contains("\\") || fileName.Contains(":") || fileName.StartsWith("."))
		{
			resp.Refuse("path must be a bare file name inside folder");
			return;
		}
		if (!fileName.EndsWith(".bmp"))
		{
			resp.Refuse("path must end with .bmp (MakeScreenshot writes BMP)");
			return;
		}
		if (!ECEN_ProbeUtil.HasRunNonce(fileName))
		{
			int minHex = ECEN_ProbeUtil.RUN_NONCE_MIN_HEX;
			resp.Refuse("path must be <label>-<nonce>.bmp with a run nonce of at least " + minHex.ToString() + " hex digits the harness supplies; screenshot never writes a name that is not new to the run");
			return;
		}

		string target = projectDir + "/" + folder + "/" + fileName;
		// Kept as a second guard; the nonce above holds even when FileExists answers false after a
		// refused "Script Authorization Required" prompt.
		if (FileIO.FileExists(target))
		{
			resp.Refuse("the file exists already; screenshot never overwrites a file");
			return;
		}
		bool written = System.MakeScreenshot(target);
		resp.Fact("folder", folder);
		resp.Fact("path", fileName);
		resp.Fact("written", written.ToString());
		resp.Ok("MakeScreenshot returned " + written.ToString());
	}

	//------------------------------------------------------------------------------------------------
	//! modalTest: opens one Workbench.Dialog with the fixed caption "ECEN probe modal" and returns
	//! when it is closed. Run detached, owner present (plan U6); no script posts input to it, the
	//! owner closes it by hand. No other action of this pack opens a dialog.
	static void ModalTest(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		Workbench.Dialog("ECEN probe modal", "ECEN probe modal test (plan U6). Close this dialog to let the call return.");
		resp.Fact("caption", "ECEN probe modal");
		resp.Ok("Workbench.Dialog returned");
	}
}
