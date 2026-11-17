/**
 * ECEN_ProbeMutGuard.c - Compiled-in guards of the mutating probe pack (development only)
 *
 * Static only. (a) The 2.0 sandbox addon is loaded: $EMCP2_sandbox:EMCP2_sandbox.gproj resolves to
 * an absolute path whose file name is EMCP2_sandbox.gproj and whose folder is EMCP2_sandbox.
 * (b) A target resolves inside that project's folder and, unless the caller says otherwise, inside
 * its _throwaway/ folder. Also the world check of the World Editor actions, the module names and
 * strict number parsing. Nothing here writes.
 */

class ECEN_ProbeMutGuard
{
	//! The 2.0 sandbox (plan 5.1): its folder and its project file name.
	static const string SANDBOX_FOLDER = "EMCP2_sandbox";
	static const string SANDBOX_GPROJ = "EMCP2_sandbox.gproj";
	//! Folder of the sandbox every write target except createSandboxWorlds' must lie in.
	static const string THROWAWAY = "_throwaway";
	//! Placeholders a response shows instead of the sandbox folder and a home folder.
	static const string SANDBOX_PLACEHOLDER = "<sandbox>";
	static const string HOME_PLACEHOLDER = "%USERPROFILE%";

	//------------------------------------------------------------------------------------------------
	//! Guard (a): the folder of the opened project when it is the 2.0 sandbox; false with a reason
	//! otherwise. Workbench.GetCurrentGameProjectFile() is the GAME project (ArmaReforger), not the
	//! addon (S-D 2026-10-06, DEC-042): the sandbox is a loaded addon and its gproj resolves through
	//! its own filesystem prefix, the same way as ECEN_ProbeUtil.SandboxDir (92e0549).
	static bool SandboxDir(out string projectDir, out string why)
	{
		projectDir = "";
		why = "";
		string file = "";
		string prefixed = "$" + SANDBOX_FOLDER + ":" + SANDBOX_GPROJ;
		if (!Workbench.GetAbsolutePath(prefixed, file, true))
		{
			why = "refused: the 2.0 sandbox addon is not loaded: " + prefixed + " does not resolve";
			return false;
		}
		file.Replace("\\", "/");
		int cut = file.LastIndexOf("/");
		if (cut <= 0)
		{
			why = "the opened project file has no folder part";
			return false;
		}

		string fileName = file.Substring(cut + 1, file.Length() - cut - 1);
		string dir = file.Substring(0, cut);
		int cutDir = dir.LastIndexOf("/");
		string folderName = dir.Substring(cutDir + 1, dir.Length() - cutDir - 1);
		if (fileName != SANDBOX_GPROJ || folderName != SANDBOX_FOLDER)
		{
			why = "refused: the opened project is not the 2.0 sandbox " + SANDBOX_FOLDER + "/" + SANDBOX_GPROJ;
			return false;
		}
		if (!FilePath.IsAbsolutePath(dir))
		{
			why = "refused: the opened project's folder is not an absolute path";
			return false;
		}

		projectDir = dir;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A path relative to the project folder: not empty, no ':' (no drive and no $filesystem:
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
	//! Guards (a) and (b) for a project-relative target: its absolute path, or false with a reason.
	//! With throwawayOnly the first segment must be _throwaway and at least one more must follow.
	static bool Target(string rel, bool throwawayOnly, out string absolute, out string why)
	{
		absolute = "";
		why = "";
		string projectDir = "";
		if (!SandboxDir(projectDir, why))
			return false;

		string clean = "";
		if (!CleanRelative(rel, clean, why))
			return false;
		if (throwawayOnly && !clean.StartsWith(THROWAWAY + "/"))
		{
			why = "refused: the target must lie under " + THROWAWAY + "/ of the 2.0 sandbox: " + rel;
			return false;
		}

		string candidate = projectDir + "/" + clean;
		string root = projectDir;
		if (throwawayOnly)
			root = projectDir + "/" + THROWAWAY;
		if (!IsUnder(candidate, root))
		{
			why = "refused: the target does not resolve inside " + root;
			return false;
		}

		absolute = candidate;
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
	//! The world open in the World Editor is the given absolute .ent path. WorldEditorAPI.GetWorldPath
	//! is resolved with Workbench.GetAbsolutePath when it is not already absolute.
	static bool OpenWorldIs(WorldEditorAPI api, string targetAbsolute, out string why)
	{
		why = "";
		string worldPath = "";
		api.GetWorldPath(worldPath);
		if (worldPath == "")
		{
			why = "no world is open in the World Editor";
			return false;
		}

		// A registered world may answer its GUID-prefixed resource name ({16 hex}path): take the
		// path part before resolving, as Bohemia's ResourceInfo.c does with ResourceName.GetPath().
		string pathPart = worldPath;
		if (worldPath.StartsWith("{"))
		{
			ResourceName asName = worldPath;
			pathPart = asName.GetPath();
		}
		string resolved = pathPart;
		if (!FilePath.IsAbsolutePath(pathPart))
		{
			if (!Workbench.GetAbsolutePath(pathPart, resolved, true))
			{
				why = "the open world's path does not resolve to a file";
				return false;
			}
		}

		if (Fold(resolved) != Fold(targetAbsolute))
		{
			why = "refused: the world open in the World Editor is not the target";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Guards (a) and (b) for a World Editor action: the target is an .ent under _throwaway/, it is
	//! the world open now, and that world has exactly one sub-scene (no parent world, whose layers
	//! and terrain would lie outside _throwaway/). Returns the World Editor API, or null with the
	//! reason in why.
	static WorldEditorAPI ThrowawayWorld(string rel, out string absolute, out string why)
	{
		absolute = "";
		why = "";
		if (!Target(rel, true, absolute, why))
			return null;
		if (!absolute.EndsWith(".ent"))
		{
			why = "refused: a world target must be an .ent file";
			return null;
		}

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			why = "WorldEditor module is not open";
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			why = "WorldEditorAPI not available (game mode, or no world loaded)";
			return null;
		}
		if (!OpenWorldIs(api, absolute, why))
			return null;
		int subScenes = api.GetNumSubScenes();
		if (subScenes != 1)
		{
			why = "refused: the throwaway world has " + subScenes.ToString() + " sub-scenes; a world with a parent world is never written";
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! Every "<drive>:/Users/<name>" or "<drive>:\Users\<name>" in value replaced with %USERPROFILE%,
	//! so no account name leaves the handler in a path.
	static string ScrubHome(string value)
	{
		string shown = value;
		array<string> markers = {":/Users/", ":\\Users\\", ":/users/", ":\\users\\"};
		for (int m = 0; m < markers.Count(); m++)
		{
			string marker = markers.Get(m);
			int rounds = 0;
			int at = shown.IndexOf(marker);
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
				at = shown.IndexOf(marker);
				rounds++;
			}
		}
		return shown;
	}

	//------------------------------------------------------------------------------------------------
	//! A path, or any text holding paths, as a response may carry it: the 2.0 sandbox folder (either
	//! slash style) replaced with "<sandbox>", then ScrubHome.
	static string ShowPath(string value)
	{
		string shown = value;
		string projectDir = "";
		string why = "";
		if (SandboxDir(projectDir, why))
		{
			string backDir = projectDir;
			backDir.Replace("/", "\\");
			shown.Replace(projectDir, SANDBOX_PLACEHOLDER);
			shown.Replace(backDir, SANDBOX_PLACEHOLDER);
		}
		return ScrubHome(shown);
	}

	//------------------------------------------------------------------------------------------------
	//! A resource name CreateWorld may write into a layer file: "{" + 16 hex digits + "}" + a path of
	//! ASCII letters, digits, '_', '-', '.', '/' and ' ', with no ".." and no leading '/'. Nothing
	//! that could close the quoted string CreateWorld writes (no quote, backslash or control
	//! character).
	static bool IsPrefabName(string s)
	{
		int len = s.Length();
		if (len < 19 || s.Get(0) != "{" || s.Get(17) != "}")
			return false;
		string hex = "0123456789ABCDEFabcdef";
		for (int i = 1; i < 17; i++)
		{
			if (!hex.Contains(s.Get(i)))
				return false;
		}
		if (s.Contains("..") || s.Get(18) == "/")
			return false;
		for (int c = 18; c < len; c++)
		{
			int code = s.ToAscii(c);
			bool upper = code >= 65 && code <= 90;
			bool lower = code >= 97 && code <= 122;
			bool digit = code >= 48 && code <= 57;
			if (upper || lower || digit)
				continue;
			if (code == 95 || code == 45 || code == 46 || code == 47 || code == 32)
				continue;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The type of one of ten module names; typename.Empty for any other name. The Particle Editor
	//! is not among them: GetModule(ParticleEditor) followed by the container reads crashed the
	//! Workbench in S-D (DEC-042), and this pack never addresses that module.
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
		else if (name == "DialogueEditor")
			moduleType = DialogueEditor;
		else if (name == "LocalizationEditor")
			moduleType = LocalizationEditor;
		else if (name == "NavmeshGeneratorMain")
			moduleType = name.ToType(); // by name: the class is absent from build 1.9.0.37 on, and a missing type does not compile
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
	//! True when s is a script identifier: a letter or '_' first, then letters, digits or '_'.
	static bool IsIdentifier(string s)
	{
		string letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
		int len = s.Length();
		if (len == 0)
			return false;
		for (int i = 0; i < len; i++)
		{
			string ch = s.Get(i);
			if (letters.Contains(ch))
				continue;
			if (i > 0 && s.IsDigitAt(i))
				continue;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Strict integer: optional sign, then digits only (string.ToInt returns 0 for anything else).
	static bool ParseInt(string s, out int value)
	{
		value = 0;
		int len = s.Length();
		if (len == 0)
			return false;
		int start = 0;
		string first = s.Get(0);
		if (first == "-" || first == "+")
			start = 1;
		if (start >= len)
			return false;
		for (int i = start; i < len; i++)
		{
			if (!s.IsDigitAt(i))
				return false;
		}
		value = s.ToInt();
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Strict float: digits, sign, '.', 'e' or 'E' only, at least one digit.
	static bool ParseFloat(string s, out float value)
	{
		value = 0;
		int len = s.Length();
		if (len == 0)
			return false;
		int digits = 0;
		for (int i = 0; i < len; i++)
		{
			if (s.IsDigitAt(i))
			{
				digits++;
				continue;
			}
			string ch = s.Get(i);
			if (ch == "-" || ch == "+" || ch == "." || ch == "e" || ch == "E")
				continue;
			return false;
		}
		if (digits == 0)
			return false;
		value = s.ToFloat();
		return true;
	}
}
