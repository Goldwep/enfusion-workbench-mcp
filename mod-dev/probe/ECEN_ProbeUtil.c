/**
 * ECEN_ProbeUtil.c - Helpers of the read-only census probe pack (development only)
 *
 * Static only. Ten module types (never the Particle Editor, DEC-042), paging of table responses, the ExecuteAction allow-list
 * and deny-list checks (lists compiled in from ECEN_ProbeAllowList.c), the 2.0 sandbox check, the
 * project-relative path check and ShowPath, which keeps the sandbox folder and the account name out
 * of a response. Nothing here writes.
 */

class ECEN_ProbeUtil
{
	//! Rows per page of a table response.
	static const int PAGE_ROWS = 200;
	//! Rows a table may collect before paging; past it the table is cut and "capped" says so.
	static const int MAX_ROWS = 20000;
	//! Deepest object nesting containerDump and loadContainer follow.
	static const int MAX_DEPTH = 4;
	//! Variable names moduleMatrix lists per container before it cuts the list.
	static const int MAX_VARIABLE_NAMES = 400;
	//! The 2.0 sandbox (plan 5.1): its folder and its project file name.
	static const string SANDBOX_FOLDER = "EMCP2_sandbox";
	static const string SANDBOX_GPROJ = "EMCP2_sandbox.gproj";
	//! Folder of the sandbox the screenshot action writes into.
	static const string THROWAWAY = "_throwaway";
	//! Fewest hex digits of the run nonce a screenshot file name ends with ("<label>-<nonce>.bmp").
	static const int RUN_NONCE_MIN_HEX = 6;
	//! Placeholders a response shows instead of the sandbox folder and a home folder.
	static const string SANDBOX_PLACEHOLDER = "<sandbox>";
	static const string HOME_PLACEHOLDER = "%USERPROFILE%";

	//------------------------------------------------------------------------------------------------
	//! Ten of the eleven module types of the Workbench API (the children of WBModuleDef), in name
	//! order. The Particle Editor is left out: GetModule(ParticleEditor) followed by the container
	//! reads crashed the Workbench in S-D (DEC-042); no action of this pack addresses it.
	static void ModuleNames(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("AnimEditor");
		outNames.Insert("AudioEditor");
		outNames.Insert("BehaviorEditor");
		outNames.Insert("DialogueEditor");
		outNames.Insert("LocalizationEditor");
		outNames.Insert("NavmeshGeneratorMain");
		outNames.Insert("ProcAnimEditor");
		outNames.Insert("ResourceManager");
		outNames.Insert("ScriptEditor");
		outNames.Insert("WorldEditor");
	}

	//------------------------------------------------------------------------------------------------
	//! The type of one of the ten module names; typename.Empty for any other name (ParticleEditor included).
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
	//! Copies one page of a row-major table into the response; sets total, page and pageCount.
	static void PageInto(ECEN_ProbeResponse resp, array<string> all, int columnCount, int page)
	{
		int rows = 0;
		if (columnCount > 0)
			rows = all.Count() / columnCount;

		int pages = (rows + PAGE_ROWS - 1) / PAGE_ROWS;
		if (pages < 1)
			pages = 1;

		// Clamped to [0, pages - 1] before any multiplication, so no page index overflows.
		int wanted = page;
		if (wanted < 0)
			wanted = 0;
		if (wanted > pages - 1)
			wanted = pages - 1;

		resp.total = rows;
		resp.pageCount = pages;
		resp.page = wanted;

		int first = wanted * PAGE_ROWS;
		int last = first + PAGE_ROWS;
		if (last > rows)
			last = rows;

		for (int r = first; r < last; r++)
		{
			for (int c = 0; c < columnCount; c++)
			{
				string value = all.Get(r * columnCount + c);
				resp.Cell(value);
			}
		}
	}

	//------------------------------------------------------------------------------------------------
	//! A menu label as the deny check compares it, as normalizeLabel of the dry-run checker does:
	//! the text before a tab; "&x" becomes "x" (so "&&" becomes "&", a lone trailing '&' stays); a
	//! trailing "..." or U+2026 ellipsis removed; runs of white space collapsed to one space;
	//! trimmed; lower case.
	static string NormLabel(string label)
	{
		string s = label;
		int tab = s.IndexOf("\t");
		if (tab >= 0)
			s = s.Substring(0, tab);

		string unmarked = "";
		int len = s.Length();
		int i = 0;
		while (i < len)
		{
			string ch = s.Get(i);
			if (ch == "&" && i + 1 < len)
			{
				unmarked += s.Get(i + 1);
				i += 2;
				continue;
			}
			unmarked += ch;
			i++;
		}

		s = unmarked.Trim();
		string ellipsis = "…";
		if (s.EndsWith("..."))
			s = s.Substring(0, s.Length() - 3);
		else if (s.EndsWith(ellipsis))
			s = s.Substring(0, s.Length() - ellipsis.Length());

		string collapsed = "";
		bool inSpace = false;
		int sLength = s.Length();
		for (int c = 0; c < sLength; c++)
		{
			int code = s.ToAscii(c);
			if (code == 32 || code == 9 || code == 10 || code == 13 || code == 11 || code == 12)
			{
				inSpace = true;
				continue;
			}
			if (inSpace && collapsed != "")
				collapsed += " ";
			inSpace = false;
			collapsed += s.Get(c);
		}
		collapsed.ToLower();
		return collapsed;
	}

	//------------------------------------------------------------------------------------------------
	//! The words of a label: NormLabel, then split on every character that is not a lower-case ASCII
	//! letter or a digit. Mirrors labelWords of scripts/live/gen-probe-allowlist.ts.
	static void Words(string label, notnull array<string> outWords)
	{
		outWords.Clear();
		string norm = NormLabel(label);
		string word = "";
		int len = norm.Length();
		for (int i = 0; i < len; i++)
		{
			int code = norm.ToAscii(i);
			bool lower = code >= 97 && code <= 122;
			bool digit = code >= 48 && code <= 57;
			if (lower || digit)
			{
				word += norm.Get(i);
				continue;
			}
			if (word != "")
				outWords.Insert(word);
			word = "";
		}
		if (word != "")
			outWords.Insert(word);
	}

	//------------------------------------------------------------------------------------------------
	//! The first segment of the path that holds the words of a deny-list label as one run, or a
	//! refused word (both lists compiled into ECEN_ProbeAllowList.c); "" when none does, else the
	//! segment with the reason in why.
	static string DeniedSegment(array<string> path, out string why)
	{
		why = "";
		array<string> denied = {};
		ECEN_ProbeAllowList.DenyLabels(denied);
		array<string> refusedWords = {};
		ECEN_ProbeAllowList.DenyWords(refusedWords);
		for (int i = 0; i < path.Count(); i++)
		{
			array<string> words = {};
			Words(path.Get(i), words);
			string padded = " " + string.Join(" ", words, false) + " ";
			for (int d = 0; d < denied.Count(); d++)
			{
				array<string> labelWords = {};
				Words(denied.Get(d), labelWords);
				if (labelWords.Count() == 0)
					continue;
				string run = " " + string.Join(" ", labelWords, false) + " ";
				if (padded.Contains(run))
				{
					why = "holds the deny-list label '" + denied.Get(d) + "'";
					return path.Get(i);
				}
			}
			for (int w = 0; w < words.Count(); w++)
			{
				string segmentWord = words.Get(w);
				for (int r = 0; r < refusedWords.Count(); r++)
				{
					if (segmentWord == refusedWords.Get(r))
					{
						why = "holds the refused word '" + segmentWord + "'";
						return path.Get(i);
					}
				}
			}
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! True when the path equals an allow-list entry exactly: same segment count, every segment
	//! equal, no prefix match, no case folding. Entries are compiled in as segments joined by "\n".
	static bool PathAllowed(array<string> path)
	{
		string joined = string.Join("\n", path, false);
		array<string> allowed = {};
		ECEN_ProbeAllowList.Paths(allowed);
		for (int i = 0; i < allowed.Count(); i++)
		{
			if (allowed.Get(i) == joined)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! True when the path equals a candidate entry exactly (DEC-100: no live result yet), matched as
	//! PathAllowed matches the allow-list. Read only when the request says candidate.
	static bool PathCandidate(array<string> path)
	{
		string joined = string.Join("\n", path, false);
		array<string> listed = {};
		ECEN_ProbeAllowList.Candidates(listed);
		for (int i = 0; i < listed.Count(); i++)
		{
			if (listed.Get(i) == joined)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The folder of the opened project when it is the 2.0 sandbox; false with a reason otherwise.
	//! Workbench.GetCurrentGameProjectFile returns the absolute path of the project file.
	static bool SandboxDir(out string projectDir, out string why)
	{
		projectDir = "";
		why = "";
		// Workbench.GetCurrentGameProjectFile() is the GAME project (ArmaReforger), not the addon
		// (S-D 2026-10-06: the first gate answered isSandbox false on the sandbox, DEC-042). The
		// sandbox is a loaded addon; its gproj resolves through its own filesystem prefix.
		string file = "";
		string prefixed = "$" + SANDBOX_FOLDER + ":" + SANDBOX_GPROJ;
		if (!Workbench.GetAbsolutePath(prefixed, file, true))
		{
			why = "the 2.0 sandbox addon is not loaded: " + prefixed + " does not resolve";
			return false;
		}
		file.Replace("\\", "/");
		int cut = file.LastIndexOf("/");
		if (cut <= 0)
		{
			why = "the sandbox project file has no folder part";
			return false;
		}

		string fileName = file.Substring(cut + 1, file.Length() - cut - 1);
		string dir = file.Substring(0, cut);
		int cutDir = dir.LastIndexOf("/");
		string folderName = dir.Substring(cutDir + 1, dir.Length() - cutDir - 1);
		if (fileName != SANDBOX_GPROJ || folderName != SANDBOX_FOLDER)
		{
			why = "the opened project is not the 2.0 sandbox " + SANDBOX_FOLDER + "/" + SANDBOX_GPROJ;
			return false;
		}
		if (!FilePath.IsAbsolutePath(dir))
		{
			why = "the opened project's folder is not an absolute path";
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
			why = "empty path";
			return false;
		}
		if (s.Contains(":"))
		{
			why = "a drive or file-system prefix is not allowed: " + rel;
			return false;
		}

		array<string> parts = {};
		s.Split("/", parts, false);
		for (int i = 0; i < parts.Count(); i++)
		{
			string part = parts.Get(i);
			if (part == "" || part == "." || part == "..")
			{
				why = "empty, '.' or '..' segment, or a leading or trailing slash: " + rel;
				return false;
			}
		}

		clean = s;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True when a clean project-relative folder is _throwaway or lies under it.
	static bool IsThrowawayFolder(string clean)
	{
		if (clean == THROWAWAY)
			return true;
		return clean.StartsWith(THROWAWAY + "/");
	}

	//------------------------------------------------------------------------------------------------
	//! True when fileName is "<label>-<nonce>.bmp": a non-empty label, then after the last "-" a run
	//! nonce of at least RUN_NONCE_MIN_HEX hex digits the harness supplies, then ".bmp". The nonce
	//! makes each screenshot's name new to the run, so the never-overwrite guard does not rest on
	//! FileIO.FileExists alone (which may answer false after a refused authorization prompt).
	static bool HasRunNonce(string fileName)
	{
		if (!fileName.EndsWith(".bmp"))
			return false;
		string stem = fileName.Substring(0, fileName.Length() - 4);
		int dash = stem.LastIndexOf("-");
		if (dash < 1)
			return false;
		int nonceLength = stem.Length() - dash - 1;
		if (nonceLength < RUN_NONCE_MIN_HEX)
			return false;
		for (int i = dash + 1; i < stem.Length(); i++)
		{
			int code = stem.ToAscii(i);
			bool digit = code >= 48 && code <= 57;
			bool lowerHex = code >= 97 && code <= 102;
			bool upperHex = code >= 65 && code <= 70;
			if (!digit && !lowerHex && !upperHex)
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Every "<drive>:/Users/<name>" or "<drive>:\Users\<name>" in value, in any letter case, replaced
	//! with %USERPROFILE%, so no account name leaves the handler in a path. The markers are found in a
	//! lower-cased copy (ToLower changes ASCII letters only, so its indexes are those of shown).
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
	//! A path, or any text holding paths, as a response may carry it: the 2.0 sandbox folder (either
	//! slash style) replaced with "<sandbox>", then ScrubHome. The harness rewrites again before it
	//! writes evidence; this keeps the account name out of the raw NET response as well.
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
}
