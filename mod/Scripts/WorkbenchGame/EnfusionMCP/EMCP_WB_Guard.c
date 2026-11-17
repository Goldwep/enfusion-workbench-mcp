/**
 * EMCP_WB_Guard.c - Shared guard of the EnfusionMCP handlers (DEC-048 package 3.3, DEC-058)
 *
 * Static only, nothing here writes. The checks every mutating handler runs: (a) the project is
 * found: exactly one loaded addon carries this handler set as loose files, and that addon is the
 * project the server installed the handlers into (the project the user opened); (b) a target is
 * relative to that project, with no drive or file-system prefix and no empty, "." or ".."
 * segment, and resolves inside its folder; (c) a container comes from that addon alone. No
 * project name is compiled in: the guard holds for whatever project the user works on (DEC-058
 * replaces the fixed sandbox of DEC-048). Also the module enum (the 9 present modules; the
 * Dialogue Editor is absent in this build and the Particle Editor is never read, DEC-042, DEC-047)
 * and the refusal message form.
 *
 * Workbench.GetCurrentGameProjectFile() is the GAME project (ArmaReforger), not the addon (S-D
 * 2026-10-06, DEC-042), so the project is identified through the loaded addons' file-system
 * prefixes (GameProject.GetLoadedAddons and GetAddonID, the calls of ECEN_ProbeSystem.c).
 */

class EMCP_WB_Guard
{
	//! This file's path inside the project that carries the handler set.
	static const string SELF_PATH = "Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Guard.c";
	//! Status a refusing handler writes into its response.
	static const string REFUSED = "refused";
	//! Code of a refusal by this guard: no project, or a target outside it.
	static const string NOT_IN_PROJECT = "NOT_IN_PROJECT";
	//! What a response shows instead of a home folder (ScrubHome).
	static const string HOME_PLACEHOLDER = "%USERPROFILE%";

	//------------------------------------------------------------------------------------------------
	//! The project: the one loaded addon that carries this handler set as loose files. Answers its
	//! addon id (its file-system prefix) and its folder; false with a reason when no loaded addon
	//! or more than one carries the set.
	static bool Project(out string addonId, out string projectDir, out string why)
	{
		addonId = "";
		projectDir = "";
		why = "";
		array<string> addons = {};
		GameProject.GetLoadedAddons(addons);
		int found = 0;
		for (int i = 0; i < addons.Count(); i++)
		{
			string id = GameProject.GetAddonID(addons.Get(i));
			if (id == "")
				continue;
			string file = "";
			if (!Workbench.GetAbsolutePath("$" + id + ":" + SELF_PATH, file, true))
				continue;
			file.Replace("\\", "/");
			if (!file.EndsWith("/" + SELF_PATH))
				continue;
			string dir = file.Substring(0, file.Length() - SELF_PATH.Length() - 1);
			if (!FilePath.IsAbsolutePath(dir))
				continue;
			found++;
			addonId = id;
			projectDir = dir;
		}
		if (found == 1)
			return true;

		addonId = "";
		projectDir = "";
		if (found == 0)
			why = "no loaded project carries the handler set as loose files (" + SELF_PATH + ")";
		else
			why = found.ToString() + " loaded projects carry the handler set; it must be installed in one";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The folder of the project; false with a reason when it is not found.
	static bool ProjectDir(out string projectDir, out string why)
	{
		string addonId = "";
		return Project(addonId, projectDir, why);
	}

	//------------------------------------------------------------------------------------------------
	//! True when the project is found.
	static bool IsProjectFound()
	{
		string addonId = "";
		string projectDir = "";
		string why = "";
		return Project(addonId, projectDir, why);
	}

	//------------------------------------------------------------------------------------------------
	//! The project's addon id, "" when it is not found. Never a path.
	static string ProjectId()
	{
		string addonId = "";
		string projectDir = "";
		string why = "";
		Project(addonId, projectDir, why);
		return addonId;
	}

	//------------------------------------------------------------------------------------------------
	//! A path relative to the project folder: not empty, no ':' (no drive and no file-system
	//! prefix), no leading slash, no empty, "." or ".." segment. Returned with forward slashes.
	static bool CleanRelative(string rel, out string clean, out string why)
	{
		clean = "";
		why = "";
		string s = rel;
		s.Replace("\\", "/");
		if (s == "")
		{
			why = "empty target";
			return false;
		}
		if (s.Contains(":"))
		{
			why = "a drive or file-system prefix is not allowed in a target: " + rel;
			return false;
		}

		array<string> parts = {};
		s.Split("/", parts, false);
		for (int i = 0; i < parts.Count(); i++)
		{
			string part = parts.Get(i);
			if (part == "" || part == "." || part == "..")
			{
				why = "empty, '.' or '..' segment, or a leading or trailing slash in the target: " + rel;
				return false;
			}
		}

		clean = s;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A path with forward slashes and in lower case, for comparing Windows paths.
	static string Fold(string path)
	{
		string s = path;
		s.Replace("\\", "/");
		s.ToLower();
		return s;
	}

	//------------------------------------------------------------------------------------------------
	//! True when absolute lies strictly inside folder (both absolute). A path with a "." or ".."
	//! segment is never inside.
	static bool IsUnder(string absolute, string folder)
	{
		string a = Fold(absolute);
		string f = Fold(folder);
		if (f.EndsWith("/"))
			f = f.Substring(0, f.Length() - 1);
		if (a.Contains("/../") || a.EndsWith("/..") || a.Contains("/./") || a.EndsWith("/."))
			return false;
		return a.StartsWith(f + "/");
	}

	//------------------------------------------------------------------------------------------------
	//! Guards (a) and (b) for a project-relative target, read or write: its absolute path inside
	//! the project's folder, or false with a reason.
	static bool TargetInsideProject(string rel, out string absolute, out string why)
	{
		absolute = "";
		why = "";
		string projectDir = "";
		if (!ProjectDir(projectDir, why))
			return false;

		string clean = "";
		if (!CleanRelative(rel, clean, why))
			return false;

		string candidate = projectDir + "/" + clean;
		if (!IsUnder(candidate, projectDir))
		{
			why = "the target does not resolve inside the project's folder";
			return false;
		}

		absolute = candidate;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The write guard: TargetInsideProject, and the engine resolves the target under the project's own
	//! file-system prefix to an existing file inside the project's folder. A resource that only the
	//! game or a dependency holds does not resolve there, so it is never written. GetSourceAddons does
	//! not decide this: live on 1.9.0.37 it lists the game beside the project for a mod's own config
	//! ([ArmaReforger,<project>]) and the game alone for a loose copy inside the project.
	static bool TargetExistsInProject(string rel, out string absolute, out string why)
	{
		absolute = "";
		why = "";
		string addonId = "";
		string projectDir = "";
		if (!Project(addonId, projectDir, why))
			return false;

		string clean = "";
		if (!CleanRelative(rel, clean, why))
			return false;

		string file = "";
		if (!Workbench.GetAbsolutePath("$" + addonId + ":" + clean, file, true))
		{
			why = "no file " + clean + " in the project " + addonId + " (a resource of the game or of a dependency is not written; copy it into the project first)";
			return false;
		}
		if (!IsUnder(file, projectDir))
		{
			why = "the target does not resolve inside the project's folder";
			return false;
		}

		absolute = file;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of a NEW file (W1 spec section 1): a clean relative path, inside the project's
	//! folder, whose parent folder exists: the project folder itself for a top-level name, else the
	//! engine resolves the parent under the project's own file-system prefix to a folder inside the
	//! project (Workbench.GetAbsolutePath with mustExist true). The file itself may or may not exist.
	//! No file method is called: FileIO.FileExists prompts without -scriptAuthorizeAll (DEC-053/U27).
	static bool NewTargetInProject(string rel, out string absolute, out string why)
	{
		absolute = "";
		why = "";
		string addonId = "";
		string projectDir = "";
		if (!Project(addonId, projectDir, why))
			return false;

		string clean = "";
		if (!CleanRelative(rel, clean, why))
			return false;

		string candidate = projectDir + "/" + clean;
		if (!IsUnder(candidate, projectDir))
		{
			why = "the target does not resolve inside the project's folder";
			return false;
		}

		int slash = clean.LastIndexOf("/");
		if (slash > 0)
		{
			string parentRel = clean.Substring(0, slash);
			string parentAbs = "";
			if (!Workbench.GetAbsolutePath("$" + addonId + ":" + parentRel, parentAbs, true))
			{
				why = "no folder " + parentRel + " in the project " + addonId + " (create the folder first)";
				return false;
			}
			if (!IsUnder(parentAbs, projectDir))
			{
				why = "the target's folder does not resolve inside the project's folder";
				return false;
			}
		}

		absolute = candidate;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A home folder (":/users/<name>" or ":\users\<name>") replaced with %USERPROFILE%. Verbatim from
	//! the probe's ScrubHome (mod-dev/probe/ECEN_ProbeUtil.c).
	static string ScrubHome(string value)
	{
		string shown = value;
		array<string> markers = {":/users/", ":\\users\\"};
		for (int m = 0; m < markers.Count(); m++)
		{
			string marker = markers.Get(m);
			int rounds = 0;
			string lower = shown;
			lower.ToLower();
			int at = lower.IndexOf(marker);
			while (at >= 1 && rounds < 64)
			{
				int nameStart = at + marker.Length();
				int nameEnd = shown.Length();
				int slash = shown.IndexOfFrom(nameStart, "/");
				int backslash = shown.IndexOfFrom(nameStart, "\\");
				if (slash >= 0 && slash < nameEnd)
					nameEnd = slash;
				if (backslash >= 0 && backslash < nameEnd)
					nameEnd = backslash;
				string head = shown.Substring(0, at - 1);
				string tail = shown.Substring(nameEnd, shown.Length() - nameEnd);
				shown = head + HOME_PLACEHOLDER + tail;
				lower = shown;
				lower.ToLower();
				at = lower.IndexOf(marker);
				rounds++;
			}
		}
		return shown;
	}

	//------------------------------------------------------------------------------------------------
	//! Guard (c): the container names no source addon other than the given one
	//! (BaseContainer.GetSourceAddons, the check of ECEN_ProbeMutActions.c): a resource another addon also
	//! defines is never written from here. An empty list is allowed:
	//! a by-path write is first held inside the project's folder by TargetInsideProject,
	//! and a raw file there is the project's own, not another addon's document. A null container
	//! is refused. sourceAddons answers the list, comma-joined, either way.
	static bool SourceAddonsAreOnly(BaseContainer cont, string addon, out string sourceAddons)
	{
		sourceAddons = "";
		if (!cont)
			return false;
		array<string> names = {};
		cont.GetSourceAddons(names);
		bool allowed = true;
		foreach (int i, string name : names)
		{
			if (i > 0)
				sourceAddons += ",";
			sourceAddons += name;
			if (name != addon)
				allowed = false;
		}
		return allowed;
	}

	//------------------------------------------------------------------------------------------------
	//! The type of one of the 9 present modules; typename.Empty for any other name. The Dialogue
	//! Editor is absent in this build (OpenModule false, U8 and U23, DEC-042), so it is not listed;
	//! NavmeshGeneratorMain left the list with build 1.9.0.37, where its class is gone (W5 OD-5, DEC-068).
	static typename ModuleType(string name)
	{
		// Assignment of a class name to a typename local, the form typename.c documents.
		typename moduleType = typename.Empty;
		if (name == "AnimEditor")
			moduleType = AnimEditor;
		else if (name == "AudioEditor")
			moduleType = AudioEditor;
		else if (name == "BehaviorEditor")
			moduleType = BehaviorEditor;
		else if (name == "LocalizationEditor")
			moduleType = LocalizationEditor;
		else if (name == "ParticleEditor")
			moduleType = ParticleEditor;
		else if (name == "ProcAnimEditor")
			moduleType = ProcAnimEditor;
		else if (name == "ResourceManager")
			moduleType = ResourceManager;
		else if (name == "ScriptEditor")
			moduleType = ScriptEditor;
		else if (name == "WorldEditor")
			moduleType = WorldEditor;
		return moduleType;
	}

	//------------------------------------------------------------------------------------------------
	//! ModuleType for a read: the Particle Editor is refused (its module read crashed the Workbench
	//! in S-D, DEC-042).
	static typename ModuleTypeForRead(string name)
	{
		typename moduleType = typename.Empty;
		if (name != "ParticleEditor")
			moduleType = ModuleType(name);
		return moduleType;
	}

	//------------------------------------------------------------------------------------------------
	//! ModuleType for open, front and close: all 9 present modules, the Particle Editor included.
	static typename ModuleTypeForOpen(string name)
	{
		return ModuleType(name);
	}

	//------------------------------------------------------------------------------------------------
	//! The message of a refusal in the fixed form "CODE: text | next: step", for a response whose
	//! struct has only status and message. A handler sets status to REFUSED and message to this; a
	//! struct that also registers code and next sets those fields to the same values.
	static string RefusalMessage(string code, string text, string nextStep)
	{
		string message = code + ": " + text;
		if (nextStep != "")
			message = message + " | next: " + nextStep;
		return message;
	}
}
