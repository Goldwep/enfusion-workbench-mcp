/**
 * EMCP_WB_Validate.c - Bohemia's material and texture validators, run as data (wave W2, phase5-w2-spec.md 2.3)
 *
 * Replaces the 1.x route through BI's MaterialValidator and TextureValidator NET handlers (ruling W2
 * OD-7, closes KD-011): MaterialValidator reads ValidateMaterialPlugin.materials[req.mat_index], a static
 * array only the plugin's dialog fills, and TextureValidator prints its findings. Actions:
 *   material    LoadContainer of an .emat, then BI's five MaterialValidatorUtils checks in BI's order
 *               and with BI's constants: ValidateUVs(0, 5), CheckDefaults, CheckExtremes(5, 95),
 *               CheckDependencies, CheckTextures. Packed and game materials are read too.
 *   texture     the TextureTypes checks with TextureIssueOp.Ignore, in the order of BI's
 *               BatchTextureProcessorPlugin, stopping at the first UnfixedFatalIssue; each answers
 *               Check=TextureCheckResult. Under Ignore, CheckUnnecessarySettingInPc and
 *               CheckWrongPropertyValues always answer NothingChanged (src): only Configurations,
 *               Ancestors and SuspiciousNonPc give a verdict.
 *   fixTexture  the same checks with ReportAndFix, then MetaFile.Save when one changed something,
 *               optionally RebuildResourceFile(abs, "PC", false) + WaitForFile. before and after are the
 *               ancestors and directly set values that changed (inverse: wb_meta set / setAncestor).
 *               A dry run without confirm runs the Ignore checks and answers the current values.
 * Not called on purpose: TextureTypes.DoChecks, which runs FindTextureType again on its own and
 * would ignore typeName. Its five checks are called one by one in its order instead.
 * Crash and prompt safety (W1 lessons 4 and 8):
 *  - BI's checks dereference without null checks: Configurations, Configurations[0] and each
 *    configuration, and in CheckTextures a texture's meta configuration, its class name's first
 *    three letters, the GUID's first 18 characters and the suffix's last letter. Every one of those
 *    is checked here before the BI call. A texture check refuses a meta whose first configuration
 *    is not an image class; CheckTextures is skipped, and the reason reported, when an input fails.
 *  - FindTextureType reaches FontTextureType.IsType, which calls FileIO.FileExists, only when no
 *    other suffix matches. Without typeName this handler first matches the other suffixes itself
 *    (TextureType.IsType's own test) and takes the first match directly; FindTextureType is never
 *    called, so the font type is unreachable. No match refuses with INVALID_ARGUMENT and asks for typeName.
 * Reads take any file on disk; fixTexture needs the handlers installed in the open project and an
 * existing file inside it (DEC-058). Meta lifecycle: GetMetaFile(absolute) -> checks -> Save (fix
 * only) -> Release(false), through EMCP_WB_MetaTarget (EMCP_WB_Meta.c).
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Validate"
 */

class EMCP_WB_ValidateRequest : JsonApiStruct
{
	string action;
	//! material: the .emat; texture, fixTexture: the source texture (its meta's resource)
	string path;
	//! texture, fixTexture: the suffix type ("co", "_nohq", ... or "unspecified"); skips detection
	string typeName;
	//! fixTexture: rebuild the resource after the save
	bool rebuild;
	//! fixTexture: true writes, anything else is a dry run
	bool confirm;

	void EMCP_WB_ValidateRequest()
	{
		RegV("action");
		RegV("path");
		RegV("typeName");
		RegV("rebuild");
		RegV("confirm");
	}
}

class EMCP_WB_ValidateResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	//! material: the highest severity of the reports, 0 when none
	int severity;
	//! material: "<severity>: <report>", BI's text
	ref array<string> reports;
	ref array<string> textures;
	string textureType;
	//! texture, fixTexture: Check=TextureCheckResult, or Check=skipped after a fatal one
	ref array<string> checks;
	bool fatal;
	ref array<string> before;
	ref array<string> after;
	bool saved;
	bool dryRun;
	bool rebuilt;

	void EMCP_WB_ValidateResponse()
	{
		reports = {};
		textures = {};
		checks = {};
		before = {};
		after = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("severity");
		RegV("reports");
		RegV("textures");
		RegV("textureType");
		RegV("checks");
		RegV("fatal");
		RegV("before");
		RegV("after");
		RegV("saved");
		RegV("dryRun");
		RegV("rebuilt");
	}
}

class EMCP_WB_Validate : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string CONFIGURATIONS = "Configurations";
	//! BI's MaterialValidator constants
	static const float UV_MIN = 0;
	static const float UV_MAX = 5;
	static const float EXTREME_MIN = 5;
	static const float EXTREME_MAX = 95;
	//! The configuration a rebuild runs (BI's ExportFBXResource and BatchTextureProcessorPlugin)
	static const string REBUILD_CONFIGURATION = "PC";
	static const int REBUILD_WAIT_MS = 10000;
	static const string SKIPPED = "skipped";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ValidateRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ValidateRequest req = EMCP_WB_ValidateRequest.Cast(request);
		EMCP_WB_ValidateResponse resp = new EMCP_WB_ValidateResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action and path");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "material")
			ValidateMaterial(req, resp);
		else if (req.action == "texture")
			ValidateTexture(req, resp);
		else if (req.action == "fixTexture")
			FixTexture(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action: " + req.action, "one of material, texture, fixTexture");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message (the message in EMCP_WB_Guard.RefusalMessage form).
	protected static void Answer(EMCP_WB_ValidateResponse resp, string status, string code, string text, string nextStep)
	{
		resp.status = status;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! A failed meta open: refused for the project guard, an error otherwise.
	protected static void OpenFailed(EMCP_WB_MetaTarget t, EMCP_WB_ValidateResponse resp)
	{
		if (t.m_Code == EMCP_WB_Guard.NOT_IN_PROJECT)
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, t.m_Code, t.m_Why, "target a file of the open project");
			return;
		}
		Answer(resp, "error", t.m_Code, t.m_Why, "");
	}

	//------------------------------------------------------------------------------------------------
	//! Why CheckTextures cannot run safely on this material, "" when it can: the conditions its loop
	//! dereferences or indexes without a check, tested with its own calls on its own inputs.
	static string TextureHazard(BaseContainer mat)
	{
		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
			return "the Resource Manager is not open: GetModule returned null";
		int varCount = mat.GetNumVars();
		for (int i = 0; i < varCount; i++)
		{
			string varName = mat.GetVarName(i);
			ResourceName texture = "";
			mat.Get(varName, texture);
			if (!texture.Contains(".edds"))
				continue;
			string texturePath = texture;
			if (texturePath.EndsWith(" 0"))
				texturePath = texturePath.Substring(0, texturePath.Length() - 2);
			if (texturePath.Length() < 18)
				return varName + ": the texture value is shorter than a GUID: " + texturePath;
			string guid = texturePath.Substring(0, 18);
			// CheckTextures reports a wrong GUID and returns there: nothing past it runs.
			if (Workbench.GetResourceName(guid) == guid)
				return "";

			ResourceName stripped = texturePath;
			MetaFile meta = resourceManager.GetMetaFile(stripped.GetPath());
			if (meta)
			{
				string metaProblem = "";
				BaseContainerList configs = meta.GetObjectArray(CONFIGURATIONS);
				if (!configs || configs.Count() == 0 || !configs.Get(0))
					metaProblem = "its meta has no first configuration";
				else if (configs.Get(0).GetClassName().Length() < 3)
					metaProblem = "its meta's configuration class name is shorter than 3 letters";
				meta.Release(false);
				if (metaProblem != "")
					return varName + " (" + texturePath + "): " + metaProblem;
			}

			string fileName = FilePath.StripPath(texturePath);
			int underscore = fileName.LastIndexOf("_");
			int dot = fileName.LastIndexOf(".");
			if (dot < 0 || dot - underscore - 1 < 1)
				return varName + " (" + texturePath + "): no texture suffix between the last '_' and the extension";
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! material: BI's five checks on the loaded .emat.
	protected static void ValidateMaterial(EMCP_WB_ValidateRequest req, EMCP_WB_ValidateResponse resp)
	{
		string clean = "";
		string why = "";
		if (!EMCP_WB_Meta.SourcePath(req.path, clean, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "the .emat's project-relative path");
			return;
		}
		string lowerPath = clean;
		lowerPath.ToLower();
		if (!lowerPath.EndsWith(".emat"))
		{
			Answer(resp, "error", UNSUPPORTED_TYPE, "material validates an .emat, got " + clean, "a material file (.emat)");
			return;
		}
		// BI's MaterialValidator loads a "{GUID}path" name; the registered name is used when the
		// resource database knows one, else the path (review V2).
		ResourceName materialName = clean;
		ResourceName registeredName = Workbench.GetResourceName(clean);
		string registeredText = registeredName;
		if (registeredText.StartsWith("{") && registeredName.GetPath() != "")
			materialName = registeredName;
		Resource holder = BaseContainerTools.LoadContainer(materialName);
		if (!holder || !holder.IsValid())
		{
			Answer(resp, "error", PATH_NOT_FOUND, "LoadContainer found no valid resource at " + clean, "an existing .emat");
			return;
		}
		BaseResourceObject resourceObject = holder.GetResource();
		if (!resourceObject)
		{
			Answer(resp, "error", PATH_NOT_FOUND, "GetResource returned null for " + clean, "an existing .emat");
			return;
		}
		BaseContainer mat = resourceObject.ToBaseContainer();
		if (!mat)
		{
			Answer(resp, "error", UNSUPPORTED_TYPE, "the resource is not a BaseContainer: " + clean, "a material file (.emat)");
			return;
		}

		MaterialValidatorUtils utils = new MaterialValidatorUtils();
		MaterialValidatorResponse report = new MaterialValidatorResponse();
		utils.ValidateUVs(mat, UV_MIN, UV_MAX, report);
		utils.CheckDefaults(mat, report);
		utils.CheckExtremes(mat, EXTREME_MIN, EXTREME_MAX, report);
		utils.CheckDependencies(mat, report);
		string hazard = TextureHazard(mat);
		if (hazard == "")
			utils.CheckTextures(mat, report);

		int highest = 0;
		int reportCount = report.reports.Count();
		for (int i = 0; i < reportCount; i++)
		{
			string level = "?";
			if (i < report.severity.Count())
			{
				int reportSeverity = report.severity.Get(i);
				level = reportSeverity.ToString();
				if (reportSeverity > highest)
					highest = reportSeverity;
			}
			resp.reports.Insert(level + ": " + EMCP_WB_Guard.ScrubHome(report.reports.Get(i)));
		}
		if (hazard != "")
			resp.reports.Insert(SKIPPED + ": CheckTextures not run: " + hazard);
		foreach (string texturePath : report.abs_textures)
			resp.textures.Insert(EMCP_WB_Guard.ScrubHome(texturePath));
		resp.severity = highest;
		Answer(resp, "ok", "", "material validated: " + reportCount.ToString() + " reports", "");
	}

	//------------------------------------------------------------------------------------------------
	//! Why the texture checks cannot run safely on this meta, "" when they can: they index
	//! Configurations and each configuration without a null check, and only an image's meta is
	//! theirs (BI's TextureImportPlugin.IsImage list; EDDSResourceClass is CheckConfigurations' own
	//! fatal verdict).
	static string TextureMetaProblem(MetaFile meta)
	{
		BaseContainerList configs = meta.GetObjectArray(CONFIGURATIONS);
		if (!configs || configs.Count() == 0)
			return "the meta has no Configurations";
		int configCount = configs.Count();
		for (int i = 0; i < configCount; i++)
		{
			if (!configs.Get(i))
				return "configuration " + i.ToString() + " is null";
		}
		string className = configs.Get(0).GetClassName();
		array<string> images = {"PNGResourceClass", "DDSResourceClass", "TGAResourceClass", "TIFFResourceClass", "HDRResourceClass", "JPGResourceClass", "EDDSResourceClass"};
		if (images.Find(className) < 0)
			return "the meta's first configuration is " + className + ", not an image";
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! TextureType.IsType's own test (FilePath.StripExtension, lower case, EndsWith the postfix), with
	//! no FileIO: the base type's IsType. FontTextureType overrides it with FileIO.FileExists.
	static bool SuffixMatches(string postFix, string path)
	{
		string pathNoExt = FilePath.StripExtension(path);
		pathNoExt.ToLower();
		return pathNoExt.EndsWith(postFix);
	}

	//------------------------------------------------------------------------------------------------
	//! The texture type: by typeName ("co" or "_co", "unspecified" for the catch-all), else
	//! The first non-font type whose suffix matches (FindTextureType's answer, without its FileIO route). Null with why otherwise.
	static TextureType PickType(TextureTypes types, string typeName, string path, out string why)
	{
		why = "";
		if (typeName != "")
		{
			string wanted = typeName;
			wanted.ToLower();
			if (wanted == "unspecified")
				wanted = "";
			else if (!wanted.StartsWith("_"))
				wanted = "_" + wanted;
			foreach (TextureType named : types.m_Types)
			{
				if (named && named.m_PostFix == wanted)
					return named;
			}
			why = "no texture type '" + typeName + "' (a suffix such as co, nohq, mask, fnt, or unspecified)";
			return null;
		}

		// FindTextureType's own walk (m_Types in order, the "" type skipped, the first IsType wins)
		// with the font type skipped: the first non-font match is the type FindTextureType answers,
		// since only the catch-all follows the font type. Returned directly, so no IsType of
		// FontTextureType (FileIO.FileExists) can run whatever the order (review V1).
		foreach (TextureType candidate : types.m_Types)
		{
			if (!candidate || candidate.m_PostFix == "")
				continue;
			if (FontTextureType.Cast(candidate))
				continue;
			if (SuffixMatches(candidate.m_PostFix, path))
				return candidate;
		}
		why = "no texture suffix matches " + path + "; detecting the font or unspecified type would call FileIO.FileExists (FontTextureType.IsType)";
		return null;
	}

	//------------------------------------------------------------------------------------------------
	//! One check's line, and whether it stops the run.
	static bool Record(string checkName, TextureCheckResult result, EMCP_WB_ValidateResponse resp)
	{
		resp.checks.Insert(checkName + "=" + typename.EnumToString(TextureCheckResult, result));
		if (result == TextureCheckResult.UnfixedFatalIssue)
		{
			resp.fatal = true;
			return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The five checks in BatchTextureProcessorPlugin's order, stopping at the first fatal one (the
	//! rest answer skipped). True when one of them changed the meta (a Fix op only).
	static bool RunChecks(TextureTypes types, TextureIssueOp op, ResourceName resourceName, MetaFile meta, TextureType texType, EMCP_WB_ValidateResponse resp)
	{
		bool changed = false;
		array<string> names = {"CheckConfigurations", "CheckAncestors", "CheckUnnecessarySettingInPc", "CheckSuspiciousNonPcSetting", "CheckWrongPropertyValues"};
		int done = 0;
		bool stop = false;
		TextureCheckResult result = types.CheckConfigurations(op, resourceName, meta);
		if (result == TextureCheckResult.SomethingChanged)
			changed = true;
		stop = Record(names.Get(0), result, resp);
		done = 1;
		if (!stop)
		{
			result = types.CheckAncestors(op, resourceName, meta, texType);
			if (result == TextureCheckResult.SomethingChanged)
				changed = true;
			stop = Record(names.Get(1), result, resp);
			done = 2;
		}
		if (!stop)
		{
			result = types.CheckUnnecessarySettingInPc(op, resourceName, meta);
			if (result == TextureCheckResult.SomethingChanged)
				changed = true;
			stop = Record(names.Get(2), result, resp);
			done = 3;
		}
		if (!stop)
		{
			result = types.CheckSuspiciousNonPcSetting(op, resourceName, meta);
			if (result == TextureCheckResult.SomethingChanged)
				changed = true;
			stop = Record(names.Get(3), result, resp);
			done = 4;
		}
		if (!stop)
		{
			result = types.CheckWrongPropertyValues(op, resourceName, meta, texType);
			if (result == TextureCheckResult.SomethingChanged)
				changed = true;
			Record(names.Get(4), result, resp);
			done = 5;
		}
		for (int i = done; i < names.Count(); i++)
			resp.checks.Insert(names.Get(i) + "=" + SKIPPED);
		return changed;
	}

	//------------------------------------------------------------------------------------------------
	//! Every configuration's ancestor and directly set variables as key=value, the state a fix changes.
	static void Snapshot(MetaFile meta, array<string> lines)
	{
		BaseContainerList configs = meta.GetObjectArray(CONFIGURATIONS);
		if (!configs)
			return;
		int configCount = configs.Count();
		for (int c = 0; c < configCount; c++)
		{
			BaseContainer config = configs.Get(c);
			if (!config)
				continue;
			string configName = config.GetName();
			lines.Insert(configName + ".ancestor=" + EMCP_WB_Meta.AncestorName(config));
			int varCount = config.GetNumVars();
			for (int v = 0; v < varCount; v++)
			{
				string varName = config.GetVarName(v);
				if (!config.IsVariableSetDirectly(varName))
					continue;
				DataVarType dataType = config.GetDataVarType(v);
				lines.Insert(configName + "." + varName + "=" + EMCP_WB_Meta.ValueText(config, varName, dataType));
			}
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The meta's texture type (textureType answered); null with the refusal written when the meta is
	//! not a texture's or no type is known without FileIO.
	protected static TextureType Prepare(EMCP_WB_ValidateRequest req, EMCP_WB_ValidateResponse resp, EMCP_WB_MetaTarget t, TextureTypes types)
	{
		string problem = TextureMetaProblem(t.m_Meta);
		if (problem != "")
		{
			Answer(resp, "error", UNSUPPORTED_TYPE, problem, "a texture source file with a meta");
			return null;
		}
		string why = "";
		TextureType texType = PickType(types, req.typeName, t.m_Rel, why);
		if (!texType)
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "pass typeName (for example co, nohq, fnt or unspecified)");
			return null;
		}
		resp.textureType = texType.m_PostFix;
		if (resp.textureType == "")
			resp.textureType = "unspecified";
		return texType;
	}

	//------------------------------------------------------------------------------------------------
	//! texture: the checks with TextureIssueOp.Ignore; nothing is changed or saved.
	protected static void ValidateTexture(EMCP_WB_ValidateRequest req, EMCP_WB_ValidateResponse resp)
	{
		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenRead(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		TextureTypes types = new TextureTypes();
		TextureType texType = Prepare(req, resp, t, types);
		if (!texType)
		{
			t.Close();
			return;
		}
		ResourceName resourceName = Workbench.GetResourceName(t.m_Rel);
		RunChecks(types, TextureIssueOp.Ignore, resourceName, t.m_Meta, texType, resp);
		t.Close();
		Answer(resp, "ok", "", "texture checked (Ignore: nothing changed)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! fixTexture: a dry run answers the Ignore checks and the current values; confirm runs the checks
	//! with ReportAndFix, saves when one changed something, answers the changed values, and rebuilds
	//! when asked.
	protected static void FixTexture(EMCP_WB_ValidateRequest req, EMCP_WB_ValidateResponse resp)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "ProjectRefused: mutating actions need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return;
		}
		EMCP_WB_MetaTarget t = new EMCP_WB_MetaTarget();
		if (!t.OpenWrite(req.path))
		{
			OpenFailed(t, resp);
			return;
		}
		TextureTypes types = new TextureTypes();
		TextureType texType = Prepare(req, resp, t, types);
		if (!texType)
		{
			t.Close();
			return;
		}
		ResourceName resourceName = Workbench.GetResourceName(t.m_Rel);
		array<string> beforeLines = {};
		Snapshot(t.m_Meta, beforeLines);

		if (!req.confirm)
		{
			RunChecks(types, TextureIssueOp.Ignore, resourceName, t.m_Meta, texType, resp);
			foreach (string current : beforeLines)
				resp.before.Insert(current);
			t.Close();
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: checks run with Ignore; nothing was changed or written", "send confirm true to fix and save");
			return;
		}

		bool changed = RunChecks(types, TextureIssueOp.ReportAndFix, resourceName, t.m_Meta, texType, resp);
		if (!changed)
		{
			t.Close();
			Answer(resp, "ok", "", "nothing to fix; the meta was not written", "");
			return;
		}
		array<string> afterLines = {};
		Snapshot(t.m_Meta, afterLines);
		foreach (string had : beforeLines)
		{
			if (afterLines.Find(had) < 0)
				resp.before.Insert(had);
		}
		foreach (string now : afterLines)
		{
			if (beforeLines.Find(now) < 0)
				resp.after.Insert(now);
		}
		t.m_Meta.Save();
		resp.saved = true;

		if (req.rebuild)
		{
			t.m_Manager.RebuildResourceFile(t.m_Abs, REBUILD_CONFIGURATION, false);
			resp.rebuilt = t.m_Manager.WaitForFile(t.m_Abs, REBUILD_WAIT_MS);
		}
		t.Close();
		Answer(resp, "ok", "", "fixed and saved", "");
	}
}
