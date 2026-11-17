/**
 * EMCP_WB_Anim.c - Handler of wb_anim (wave W4, phase5-w4-spec.md section 2.1, DEC-067)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Anim", dispatching on "action":
 *   txaProfiles  the animation export profiles (.apr) of the loaded addons: ResourceDatabase.SearchResources
 *                with a $<addon>: root and the apr extension (the vanilla FindAnimationProfilesInProject
 *                filter), Workbench.GetAbsolutePath of each hit, then per folder TxaExporter.LoadProfiles
 *                with the absolute folder (the form vanilla AnimExportProfiles sends, P-W4-03),
 *                GetNumProfiles, GetProfileName, GetProfileChannelCount
 *   txaChannels  one profile's channels: LoadProfiles on its folder, GetProfileIndex on the stem,
 *                GetProfileChannelName and GetProfileChannelGenFn (vanilla GetAnimationExporProfileChannelsInfo)
 *   txaRead      a .txa's events and custom properties, paged by "<start>:<count>" (STALE_CURSOR on a
 *                changed total): TrackLoad, TrackGetEventCount, TrackGetEvent read through
 *                BaseContainer.GetClassName, GetNumVars, GetVarName and the shipped
 *                EMCP_WB_Container.ReadAsText; TrackGetCustomProperty per asked name (P-W4-05)
 *   check        GATED: refuses MODAL_HAZARD until probe P-W4-14 shows that the owning editor logs a
 *                load error between two markers inside the same call with no dialog. Nothing is
 *                opened and no module is fetched (GetModule would open a closed editor).
 *   txaExport    a NEW .txa in the project (NewTargetInProject; an existing file is refused): LoadProfiles,
 *                GetProfileIndex, GetProfileChannelCount (must equal channelCount), TrackReset,
 *                TrackSetChannels (keyData and diffData arrive as text and are parsed with
 *                EMCP_WB_Common.ParseFloat), TrackExport, then ResourceManager.RegisterResourceFile and
 *                RebuildResourceFile "PC" (the 1.9 ExportTXAResource sequence without its
 *                GetMetaFileFromString, which calls FileIO). Dry run unless confirm (P-W4-04).
 *   txaEdit      an existing .txa in the project (TargetExistsInProject): the dry run loads it and answers
 *                before and the proposed after; the write (TrackAdd*Event, TrackEditEvent + Set,
 *                TrackEraseEvent, TrackSetCustomProperty, TrackClearCustomProperties, TrackExport, then a
 *                reload) is built and refuses UNPROVEN until probe P-W4-06 shows where TrackExport writes
 *                after TrackLoad (TXA_EDIT_PROVEN).
 *
 * OI-W4-1 (DEC-067, OD-2): no .apr ships in the game. Until one is found in a loaded addon every txa*
 * action refuses RESOURCE_NOT_FOUND with the owner's step in next. No profile is synthesised.
 * A TxaExporter answer of TXAERR_ERROR refuses TXA_ERROR with ErrMsg in message; TXAERR_WARNING
 * answers ok and carries the message. No file method is called (FileIO prompts without
 * -scriptAuthorizeAll, DEC-053); paths are checked through EMCP_WB_Guard. Absolute paths never reach
 * a response: home folders are scrubbed and profile paths are shown as $<addon>:<path>. Engine
 * pointers never travel through an out parameter. No project is named: the guard finds it (DEC-058).
 * Workbench.GetModule(ResourceManager) names the Workbench's main window, which is open while the NET
 * API answers (GetModule would open a closed module, DEC-053). Keys: contracts/EMCP_WB_Anim.json.
 */

class EMCP_WB_AnimRequest : JsonApiStruct
{
	string action;
	//! txaProfiles: one addon id; empty searches every loaded addon
	string addon;
	//! txaChannels, txaExport: the profile as $<addon>:<path>.apr, a project-relative path or its name
	string profile;
	//! txaRead, txaEdit: the .txa; check: the file to check
	string path;
	//! txaRead: the source file hint of TrackLoad
	string hint;
	ref array<string> propNames;
	string cursor;
	int limit;
	//! txaExport: the new .txa, project-relative
	string target;
	//! txaExport: the source file name kept in the track
	string source;
	int frames;
	int fps;
	int channelCount;
	//! txaExport: floats as text
	ref array<string> keyData;
	ref array<string> diffData;
	bool confirm;
	//! txaEdit: add, edit, erase, setProp or clearProps
	string op;
	//! txaEdit add: generic, audio or weighted
	string eventType;
	int index;
	ref array<string> fields;
	ref array<string> values;
	string propName;
	string propValue;

	void EMCP_WB_AnimRequest()
	{
		propNames = {};
		keyData = {};
		diffData = {};
		fields = {};
		values = {};

		RegV("action");
		RegV("addon");
		RegV("profile");
		RegV("path");
		RegV("hint");
		RegV("propNames");
		RegV("cursor");
		RegV("limit");
		RegV("target");
		RegV("source");
		RegV("frames");
		RegV("fps");
		RegV("channelCount");
		RegV("keyData");
		RegV("diffData");
		RegV("confirm");
		RegV("op");
		RegV("eventType");
		RegV("index");
		RegV("fields");
		RegV("values");
		RegV("propName");
		RegV("propValue");
	}
}

class EMCP_WB_AnimResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	//! txaProfiles: name|channels|path
	ref array<string> profiles;
	int total;
	ref array<string> warnings;
	//! txaChannels: index|name|genFn
	ref array<string> channels;
	//! TxaErrCode: 0 ok, 1 warning, 2 error
	int errCode;
	string errMsg;
	string path;
	int eventCount;
	//! txaRead: index|class|var=value;...
	ref array<string> events;
	//! txaRead: name=value
	ref array<string> props;
	string nextCursor;
	string openedIn;
	bool result;
	string marker;
	string docClass;
	string target;
	bool dryRun;
	bool written;
	bool registered;
	bool rebuilt;
	ref array<string> before;
	ref array<string> after;

	void EMCP_WB_AnimResponse()
	{
		profiles = {};
		warnings = {};
		channels = {};
		events = {};
		props = {};
		before = {};
		after = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("profiles");
		RegV("total");
		RegV("warnings");
		RegV("channels");
		RegV("errCode");
		RegV("errMsg");
		RegV("path");
		RegV("eventCount");
		RegV("events");
		RegV("props");
		RegV("nextCursor");
		RegV("openedIn");
		RegV("result");
		RegV("marker");
		RegV("docClass");
		RegV("target");
		RegV("dryRun");
		RegV("written");
		RegV("registered");
		RegV("rebuilt");
		RegV("before");
		RegV("after");
	}
}

//! One .apr found in a loaded addon: its stem (the profile name TxaExporter answers), the path shown
//! ($<addon>:<path>), and the absolute file and folder (never answered).
class EMCP_WB_AnimProfile
{
	string m_Name;
	string m_Shown;
	string m_Abs;
	string m_Folder;
}

class EMCP_WB_Anim : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string ITEM_NOT_FOUND = "ITEM_NOT_FOUND";
	static const string STALE_CURSOR = "STALE_CURSOR";
	static const string TXA_ERROR = "TXA_ERROR";
	static const string SAVE_FAILED = "SAVE_FAILED";
	static const string UNPROVEN = "UNPROVEN";
	static const string MODAL_HAZARD = "MODAL_HAZARD";
	static const string MODULE_NOT_SUPPORTED = "MODULE_NOT_SUPPORTED";
	static const string APR_EXTENSION = "apr";
	static const string TXA_SUFFIX = ".txa";
	static const string REBUILD_CONFIGURATION = "PC";
	//! The held owner item OI-W4-1 (DEC-067): the step every txa* action answers in next until a profile exists.
	static const string OWNER_STEP = "owner step OI-W4-1: export one animation export profile (.apr) with the Enfusion Blender Tools add-on into the open project, then call again";
	//! txaEdit writes only once probe P-W4-06 shows that TrackExport after TrackLoad rewrites the loaded file.
	static const bool TXA_EDIT_PROVEN = false;
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;

	//! SearchResources hits of the current search (the EMCP_WB_Resources.CollectHit form).
	static ref array<string> s_aAprHits;

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_AnimRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_AnimRequest req = EMCP_WB_AnimRequest.Cast(request);
		EMCP_WB_AnimResponse resp = new EMCP_WB_AnimResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "txaProfiles")
			TxaProfiles(req, resp);
		else if (req.action == "txaChannels")
			TxaChannels(req, resp);
		else if (req.action == "txaRead")
			TxaRead(req, resp);
		else if (req.action == "check")
			Check(req, resp);
		else if (req.action == "txaExport")
			TxaExport(req, resp);
		else if (req.action == "txaEdit")
			TxaEdit(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action: " + req.action, "one of txaProfiles, txaChannels, txaRead, check, txaExport, txaEdit");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message (the message in EMCP_WB_Guard.RefusalMessage form, home scrubbed).
	protected static void Answer(EMCP_WB_AnimResponse resp, string status, string code, string text, string nextStep)
	{
		resp.status = status;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! True (with the refusal written) when the project is not found (DEC-058).
	protected static bool ProjectRefused(EMCP_WB_AnimResponse resp)
	{
		string addonId = "";
		string projectDir = "";
		string why = "";
		if (EMCP_WB_Guard.Project(addonId, projectDir, why))
			return false;
		Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was changed", "install the handlers in the project you have open");
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The refusal of every txa* action while no profile is found in a loaded addon (OI-W4-1).
	protected static void NoProfile(EMCP_WB_AnimResponse resp, string scope)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, RESOURCE_NOT_FOUND, "no animation export profile (.apr) in " + scope + "; the TXA actions need one and none is synthesised", OWNER_STEP);
	}

	//------------------------------------------------------------------------------------------------
	//! The SearchResourcesCallback: the exact path of a hit ($Addon:path), else its resource name.
	protected static bool CollectApr(ResourceName resourceName, string exactPath = "")
	{
		string hitText = exactPath;
		if (hitText == "")
			hitText = resourceName;
		if (s_aAprHits && hitText != "")
			s_aAprHits.Insert(hitText);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The .apr files of the loaded addons (or of the one named), each resolved to a file on disk. A
	//! search that answers false or a hit that does not resolve is a warning. False with why only for
	//! an addon id that no loaded addon has.
	static bool FindProfiles(string addonFilter, array<ref EMCP_WB_AnimProfile> found, array<string> warnings, out string why)
	{
		why = "";
		array<string> loaded = {};
		GameProject.GetLoadedAddons(loaded);
		bool addonSeen = false;
		foreach (string addonGuid : loaded)
		{
			string addonId = GameProject.GetAddonID(addonGuid);
			if (addonId == "")
				continue;
			if (addonFilter != "" && addonId != addonFilter)
				continue;
			addonSeen = true;

			SearchResourcesFilter filter = new SearchResourcesFilter();
			filter.rootPath = "$" + addonId + ":";
			array<string> extensions = {APR_EXTENSION};
			filter.fileExtensions = extensions;
			filter.recursive = true;
			s_aAprHits = {};
			bool searched = ResourceDatabase.SearchResources(filter, CollectApr);
			array<string> hits = {};
			hits.Copy(s_aAprHits);
			s_aAprHits.Clear();
			if (!searched)
			{
				warnings.Insert("SearchResources returned false for $" + addonId + ":");
				continue;
			}
			hits.Sort();
			foreach (string hit : hits)
				AddProfile(addonId, hit, found, warnings);
		}
		if (addonFilter != "" && !addonSeen)
		{
			why = "no loaded addon has the id " + addonFilter;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! One search hit resolved to a profile: "$id:" + its path first (mustExist), else the hit as the
	//! vanilla AnimationProfileCollector resolves it (GetAbsolutePath(exactPath, abs, false)).
	static void AddProfile(string addonId, string hit, array<ref EMCP_WB_AnimProfile> found, array<string> warnings)
	{
		string rel = hit;
		if (rel.StartsWith("{"))
		{
			ResourceName named = hit;
			rel = named.GetPath();
		}
		else if (rel.StartsWith("$"))
		{
			int colon = rel.IndexOf(":");
			if (colon > 0)
				rel = rel.Substring(colon + 1, rel.Length() - colon - 1);
		}
		rel.Replace("\\", "/");

		string absolute = "";
		bool resolved = false;
		if (rel != "" && !rel.Contains(":"))
			resolved = Workbench.GetAbsolutePath("$" + addonId + ":" + rel, absolute, true);
		if (!resolved)
			resolved = Workbench.GetAbsolutePath(hit, absolute, false);
		if (!resolved || absolute == "")
		{
			warnings.Insert("profile " + EMCP_WB_Guard.ScrubHome(hit) + " is not a file on disk; skipped");
			return;
		}

		EMCP_WB_AnimProfile p = new EMCP_WB_AnimProfile();
		p.m_Abs = absolute;
		p.m_Folder = FilePath.StripFileName(absolute);
		p.m_Name = FilePath.StripExtension(FilePath.StripPath(absolute));
		if (rel != "" && !rel.Contains(":"))
			p.m_Shown = "$" + addonId + ":" + rel;
		else
			p.m_Shown = EMCP_WB_Guard.ScrubHome(absolute);
		found.Insert(p);
	}

	//------------------------------------------------------------------------------------------------
	//! The profile a request names: its shown path ($addon:path), its path without the prefix, or its
	//! name (with or without .apr). matches counts the candidates; the first is returned, null for none.
	static EMCP_WB_AnimProfile PickProfile(string asked, array<ref EMCP_WB_AnimProfile> found, out int matches)
	{
		matches = 0;
		EMCP_WB_AnimProfile picked = null;
		string wanted = EMCP_WB_Guard.Fold(asked);
		string wantedName = wanted;
		if (wantedName.EndsWith(".apr"))
			wantedName = wantedName.Substring(0, wantedName.Length() - 4);
		foreach (EMCP_WB_AnimProfile p : found)
		{
			string shown = EMCP_WB_Guard.Fold(p.m_Shown);
			string bare = shown;
			int colon = bare.IndexOf(":");
			if (bare.StartsWith("$") && colon > 0)
				bare = bare.Substring(colon + 1, bare.Length() - colon - 1);
			string profileName = p.m_Name;
			profileName.ToLower();
			if (wanted == shown || wanted == bare || wantedName == profileName)
			{
				if (matches == 0)
					picked = p;
				matches++;
			}
		}
		return picked;
	}

	//------------------------------------------------------------------------------------------------
	//! A request path checked for a read: a "{GUID}path" ResourceName loses its GUID, then
	//! EMCP_WB_Guard.CleanRelative (no drive, prefix or dot segment).
	static bool CleanPath(string path, out string clean, out string why)
	{
		clean = "";
		why = "";
		string text = path;
		if (text.StartsWith("{"))
		{
			ResourceName named = path;
			text = named.GetPath();
		}
		return EMCP_WB_Guard.CleanRelative(text, clean, why);
	}

	//------------------------------------------------------------------------------------------------
	//! True for a path that ends in .txa (any case).
	static bool IsTxa(string path)
	{
		string lower = path;
		lower.ToLower();
		return lower.EndsWith(TXA_SUFFIX);
	}

	//------------------------------------------------------------------------------------------------
	//! The worse of a TxaExporter call's answer and TxaExporter.ErrCode after it (TXAERR_OK < WARNING < ERROR).
	static TxaErrCode Outcome(TxaExporter exporter, TxaErrCode returned)
	{
		TxaErrCode recorded = exporter.ErrCode();
		int recordedValue = recorded;
		int returnedValue = returned;
		if (recordedValue > returnedValue)
			return recorded;
		return returned;
	}

	//------------------------------------------------------------------------------------------------
	//! TxaExporter.ErrMsg, home scrubbed.
	static string ErrText(TxaExporter exporter)
	{
		return EMCP_WB_Guard.ScrubHome(exporter.ErrMsg());
	}

	//------------------------------------------------------------------------------------------------
	//! One event as index|class|var=value;... (values through EMCP_WB_Container.ReadAsText).
	static string EventText(int eventIndex, BaseContainer ev)
	{
		if (!ev)
			return eventIndex.ToString() + "|<null>|";
		string varsText = "";
		int varCount = ev.GetNumVars();
		for (int v = 0; v < varCount; v++)
		{
			string varName = ev.GetVarName(v);
			DataVarType dataType = ev.GetDataVarType(v);
			if (v > 0)
				varsText += ";";
			varsText += varName + "=" + EMCP_WB_Guard.ScrubHome(EMCP_WB_Container.ReadAsText(ev, varName, dataType));
		}
		return eventIndex.ToString() + "|" + ev.GetClassName() + "|" + varsText;
	}

	//------------------------------------------------------------------------------------------------
	//! A cursor "<start>:<count>": digits on both sides, start at most count.
	static bool ParseCursor(string cursorText, out int start, out int count)
	{
		start = 0;
		count = 0;
		int colon = cursorText.IndexOf(":");
		if (colon <= 0 || colon >= cursorText.Length() - 1)
			return false;
		string startText = cursorText.Substring(0, colon);
		string countText = cursorText.Substring(colon + 1, cursorText.Length() - colon - 1);
		int startValue = 0;
		int countValue = 0;
		if (!EMCP_WB_Common.ParseInt(startText, startValue) || !EMCP_WB_Common.ParseInt(countText, countValue))
			return false;
		if (startValue < 0 || countValue < 0 || startValue > countValue)
			return false;
		start = startValue;
		count = countValue;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Floats sent as text, parsed strictly (EMCP_WB_Common.ParseFloat); false with why on the first bad one.
	static bool ParseFloats(array<string> texts, string keyName, array<float> parsed, out string why)
	{
		why = "";
		for (int i = 0; i < texts.Count(); i++)
		{
			float number = 0;
			if (!EMCP_WB_Common.ParseFloat(texts.Get(i), number))
			{
				why = keyName + "[" + i.ToString() + "] is not a number: '" + texts.Get(i) + "'";
				return false;
			}
			parsed.Insert(number);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! txaProfiles: every .apr of the loaded addons, loaded per folder.
	protected static void TxaProfiles(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp)
	{
		array<ref EMCP_WB_AnimProfile> found = new array<ref EMCP_WB_AnimProfile>();
		string why = "";
		if (!FindProfiles(req.addon, found, resp.warnings, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "an addon id wb_resources addons lists, or omit addon");
			return;
		}
		if (found.Count() == 0)
		{
			string scope = "any loaded addon";
			if (req.addon != "")
				scope = "the addon " + req.addon;
			NoProfile(resp, scope);
			return;
		}

		array<string> folders = {};
		array<string> shownFolders = {};
		foreach (EMCP_WB_AnimProfile p : found)
		{
			string folded = EMCP_WB_Guard.Fold(p.m_Folder);
			if (folders.Find(folded) >= 0)
				continue;
			folders.Insert(folded);
			shownFolders.Insert(FilePath.StripFileName(p.m_Shown));
		}

		array<bool> listed = {};
		for (int f = 0; f < found.Count(); f++)
			listed.Insert(false);
		int loadedFolders = 0;
		string lastError = "";
		for (int k = 0; k < folders.Count(); k++)
		{
			string folderAbs = "";
			foreach (EMCP_WB_AnimProfile owner : found)
			{
				if (EMCP_WB_Guard.Fold(owner.m_Folder) == folders.Get(k))
				{
					folderAbs = owner.m_Folder;
					break;
				}
			}
			TxaExporter exporter = new TxaExporter();
			TxaErrCode err = Outcome(exporter, exporter.LoadProfiles(folderAbs));
			if (err == TxaErrCode.TXAERR_ERROR)
			{
				lastError = "LoadProfiles " + shownFolders.Get(k) + ": " + ErrText(exporter);
				resp.warnings.Insert(lastError);
				continue;
			}
			if (err == TxaErrCode.TXAERR_WARNING)
				resp.warnings.Insert("LoadProfiles " + shownFolders.Get(k) + ": " + ErrText(exporter));
			loadedFolders++;

			int numProfiles = exporter.GetNumProfiles();
			for (int i = 0; i < numProfiles; i++)
			{
				string profileName = exporter.GetProfileName(i);
				int channelTotal = exporter.GetProfileChannelCount(i);
				string shownPath = "";
				string lowerName = profileName;
				lowerName.ToLower();
				for (int m = 0; m < found.Count(); m++)
				{
					EMCP_WB_AnimProfile candidate = found.Get(m);
					string candidateName = candidate.m_Name;
					candidateName.ToLower();
					if (EMCP_WB_Guard.Fold(candidate.m_Folder) == folders.Get(k) && candidateName == lowerName)
					{
						shownPath = candidate.m_Shown;
						listed.Set(m, true);
						break;
					}
				}
				resp.profiles.Insert(profileName + "|" + channelTotal.ToString() + "|" + shownPath);
			}
		}

		for (int u = 0; u < found.Count(); u++)
		{
			if (!listed.Get(u))
				resp.warnings.Insert("profile file " + found.Get(u).m_Shown + " was found but LoadProfiles did not list it");
		}
		resp.total = resp.profiles.Count();
		if (loadedFolders == 0)
		{
			Answer(resp, "error", TXA_ERROR, lastError, "check the profile files with the Enfusion Blender Tools add-on");
			return;
		}
		Answer(resp, "ok", "", "profiles: " + resp.total.ToString() + " in " + loadedFolders.ToString() + " folder(s)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! txaChannels: one profile's channels.
	protected static void TxaChannels(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp)
	{
		if (req.profile == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "profile required", "a profile txaProfiles lists");
			return;
		}
		array<ref EMCP_WB_AnimProfile> found = new array<ref EMCP_WB_AnimProfile>();
		array<string> notes = {};
		string why = "";
		FindProfiles("", found, notes, why);
		if (found.Count() == 0)
		{
			NoProfile(resp, "any loaded addon");
			return;
		}
		int matches = 0;
		EMCP_WB_AnimProfile p = PickProfile(req.profile, found, matches);
		if (!p)
		{
			Answer(resp, "error", RESOURCE_NOT_FOUND, "no profile " + req.profile + " in the loaded addons", "a profile txaProfiles lists");
			return;
		}
		if (matches > 1)
		{
			Answer(resp, "error", INVALID_ARGUMENT, matches.ToString() + " profiles match " + req.profile, "name the profile by the path txaProfiles answers");
			return;
		}

		TxaExporter exporter = new TxaExporter();
		TxaErrCode err = Outcome(exporter, exporter.LoadProfiles(p.m_Folder));
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "LoadProfiles: " + resp.errMsg, "check the profile with the Enfusion Blender Tools add-on");
			return;
		}
		int profileIndex = exporter.GetProfileIndex(p.m_Name);
		if (profileIndex == -1)
		{
			Answer(resp, "error", RESOURCE_NOT_FOUND, "LoadProfiles did not load the profile " + p.m_Name + " from " + p.m_Shown, "check the profile with the Enfusion Blender Tools add-on");
			return;
		}
		int channelTotal = exporter.GetProfileChannelCount(profileIndex);
		for (int c = 0; c < channelTotal; c++)
			resp.channels.Insert(c.ToString() + "|" + exporter.GetProfileChannelName(profileIndex, c) + "|" + exporter.GetProfileChannelGenFn(profileIndex, c));
		resp.total = channelTotal;
		string note = "";
		if (err == TxaErrCode.TXAERR_WARNING)
			note = " (LoadProfiles warning: " + resp.errMsg + ")";
		Answer(resp, "ok", "", "channels of " + p.m_Name + ": " + channelTotal.ToString() + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! txaRead: one page of a .txa's events, and the custom properties asked for.
	protected static void TxaRead(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp)
	{
		resp.path = req.path;
		string clean = "";
		string why = "";
		if (!CleanPath(req.path, clean, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "a project-relative .txa path");
			return;
		}
		if (!IsTxa(clean))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "path must name a .txa, got " + clean, "a project-relative .txa path");
			return;
		}
		array<ref EMCP_WB_AnimProfile> found = new array<ref EMCP_WB_AnimProfile>();
		array<string> notes = {};
		FindProfiles("", found, notes, why);
		if (found.Count() == 0)
		{
			NoProfile(resp, "any loaded addon");
			return;
		}
		string absolute = "";
		if (!Workbench.GetAbsolutePath(clean, absolute, true))
		{
			Answer(resp, "error", PATH_NOT_FOUND, "no file " + clean + " on disk", "a .txa that exists (txaExport writes one)");
			return;
		}

		int start = 0;
		int issuedFor = -1;
		if (req.cursor != "")
		{
			if (!ParseCursor(req.cursor, start, issuedFor))
			{
				Answer(resp, "error", INVALID_ARGUMENT, "cursor must be <start>:<count> as nextCursor answered, got '" + req.cursor + "'", "omit cursor for the first page");
				return;
			}
		}

		TxaExporter exporter = new TxaExporter();
		TxaErrCode err = Outcome(exporter, exporter.TrackLoad(absolute, req.hint));
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "TrackLoad " + clean + ": " + resp.errMsg, "check the file; txaExport writes a fresh one");
			return;
		}
		int total = exporter.TrackGetEventCount();
		resp.eventCount = total;
		if (req.cursor != "" && issuedFor != total)
		{
			Answer(resp, "error", STALE_CURSOR, "the cursor was issued for " + issuedFor.ToString() + " events, the track now has " + total.ToString(), "read again without a cursor");
			return;
		}

		int pageSize = req.limit;
		if (pageSize <= 0)
			pageSize = PAGE_DEFAULT;
		if (pageSize > PAGE_MAX)
			pageSize = PAGE_MAX;
		int end = start + pageSize;
		if (end > total)
			end = total;
		for (int i = start; i < end; i++)
			resp.events.Insert(EventText(i, exporter.TrackGetEvent(i)));
		if (end < total)
			resp.nextCursor = end.ToString() + ":" + total.ToString();

		foreach (string propKey : req.propNames)
		{
			if (propKey == "")
				continue;
			resp.props.Insert(propKey + "=" + EMCP_WB_Guard.ScrubHome(exporter.TrackGetCustomProperty(propKey)));
		}
		int shown = end - start;
		string note = "";
		if (err == TxaErrCode.TXAERR_WARNING)
			note = " (TrackLoad warning: " + resp.errMsg + ")";
		Answer(resp, "ok", "", "events: " + shown.ToString() + " of " + total.ToString() + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! check: GATED on probe P-W4-14. The path and its owning editor are checked; nothing is opened and
	//! no module is fetched (Workbench.GetModule would open a closed editor).
	protected static void Check(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp)
	{
		resp.path = req.path;
		string clean = "";
		string why = "";
		if (!CleanPath(req.path, clean, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "a project or game path of an animation, behavior or procedural animation file");
			return;
		}
		string owner = EMCP_WB_OpenResource.OwnerOf(clean);
		if (owner != "AnimEditor" && owner != "BehaviorEditor" && owner != "ProcAnimEditor")
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, MODULE_NOT_SUPPORTED, clean + " belongs to the " + owner + "; check takes the files of the Anim, Behavior and ProcAnim editors", "wb_module setResource for other files");
			return;
		}
		Answer(resp, EMCP_WB_Guard.REFUSED, MODAL_HAZARD, "check waits for probe P-W4-14: opening " + clean + " in the " + owner + " may raise an editor dialog on a load error, and its log lines are not yet shown to land between markers in the same call; nothing was opened", "animation_graph, behavior_tree or procanim validate (offline)");
	}

	//------------------------------------------------------------------------------------------------
	//! txaExport: a new .txa in the project from keys, registered and rebuilt. Every input is checked
	//! before the dry run answers; nothing is written without confirm.
	protected static void TxaExport(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp)
	{
		if (ProjectRefused(resp))
			return;
		resp.target = req.target;
		array<ref EMCP_WB_AnimProfile> found = new array<ref EMCP_WB_AnimProfile>();
		string why = "";
		FindProfiles("", found, resp.warnings, why);
		if (found.Count() == 0)
		{
			NoProfile(resp, "any loaded addon");
			return;
		}
		if (req.profile == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "profile required", "a profile txaProfiles lists");
			return;
		}

		string clean = "";
		if (!EMCP_WB_Guard.CleanRelative(req.target, clean, why))
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was written", "a project-relative .txa path");
			return;
		}
		if (!IsTxa(clean))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "target must name a .txa, got " + clean, "a project-relative .txa path");
			return;
		}
		string absolute = "";
		if (!EMCP_WB_Guard.NewTargetInProject(clean, absolute, why))
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "NewTargetInProject: " + why + "; nothing was written", "a new .txa in a folder of the open project");
			return;
		}
		string existing = "";
		if (Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "the target " + clean + " exists; txaExport writes a new file only, nothing was written", "a target name that is not taken");
			return;
		}
		resp.target = clean;

		if (req.frames <= 0 || req.fps <= 0 || req.channelCount <= 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "frames, fps and channelCount must be positive, got " + req.frames.ToString() + ", " + req.fps.ToString() + ", " + req.channelCount.ToString(), "send the keyframe count, the frame rate and the profile's channel count");
			return;
		}
		array<float> keys = {};
		if (!ParseFloats(req.keyData, "keyData", keys, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why + "; nothing was written", "keyData as numbers in text");
			return;
		}
		array<float> diffs = {};
		if (!ParseFloats(req.diffData, "diffData", diffs, why))
		{
			Answer(resp, "error", INVALID_ARGUMENT, why + "; nothing was written", "diffData as numbers in text, or empty");
			return;
		}
		int perFrameBlock = req.channelCount * req.frames;
		if (keys.Count() == 0 || keys.Count() % perFrameBlock != 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "keyData has " + keys.Count().ToString() + " values, not a positive multiple of channelCount * frames = " + perFrameBlock.ToString() + "; nothing was written", "channelCount * frames * N values (the layout probe P-W4-04 records N)");
			return;
		}

		int matches = 0;
		EMCP_WB_AnimProfile p = PickProfile(req.profile, found, matches);
		if (!p)
		{
			Answer(resp, "error", RESOURCE_NOT_FOUND, "no profile " + req.profile + " in the loaded addons", "a profile txaProfiles lists");
			return;
		}
		if (matches > 1)
		{
			Answer(resp, "error", INVALID_ARGUMENT, matches.ToString() + " profiles match " + req.profile, "name the profile by the path txaProfiles answers");
			return;
		}
		TxaExporter exporter = new TxaExporter();
		TxaErrCode err = Outcome(exporter, exporter.LoadProfiles(p.m_Folder));
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "LoadProfiles: " + resp.errMsg + "; nothing was written", "check the profile with the Enfusion Blender Tools add-on");
			return;
		}
		if (err == TxaErrCode.TXAERR_WARNING)
			resp.warnings.Insert("LoadProfiles: " + resp.errMsg);
		int profileIndex = exporter.GetProfileIndex(p.m_Name);
		if (profileIndex == -1)
		{
			Answer(resp, "error", RESOURCE_NOT_FOUND, "LoadProfiles did not load the profile " + p.m_Name + " from " + p.m_Shown + "; nothing was written", "check the profile with the Enfusion Blender Tools add-on");
			return;
		}
		int profileChannels = exporter.GetProfileChannelCount(profileIndex);
		if (profileChannels != req.channelCount)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "channelCount " + req.channelCount.ToString() + " is not the profile's " + profileChannels.ToString() + "; nothing was written", "wb_anim txaChannels lists the profile's channels");
			return;
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: would export " + clean + " with the profile " + p.m_Name + " (" + profileChannels.ToString() + " channels, " + req.frames.ToString() + " frames at " + req.fps.ToString() + " fps, " + keys.Count().ToString() + " key values), then register and rebuild it; nothing was written", "send confirm true to export");
			return;
		}

		err = Outcome(exporter, exporter.TrackReset(profileIndex, req.frames, req.fps, req.source, absolute));
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "TrackReset: " + resp.errMsg + "; nothing was written", "check frames, fps and the profile");
			return;
		}
		if (err == TxaErrCode.TXAERR_WARNING)
			resp.warnings.Insert("TrackReset: " + resp.errMsg);
		err = Outcome(exporter, exporter.TrackSetChannels(req.channelCount, req.frames, keys, diffs));
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "TrackSetChannels: " + resp.errMsg + "; nothing was written", "check the keyData layout against the message");
			return;
		}
		if (err == TxaErrCode.TXAERR_WARNING)
			resp.warnings.Insert("TrackSetChannels: " + resp.errMsg);
		err = Outcome(exporter, exporter.TrackExport());
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "TrackExport: " + resp.errMsg, "read the Workbench log");
			return;
		}
		if (err == TxaErrCode.TXAERR_WARNING)
			resp.warnings.Insert("TrackExport: " + resp.errMsg);

		string writtenAbs = "";
		resp.written = Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, writtenAbs, true);
		if (!resp.written)
		{
			Answer(resp, "error", SAVE_FAILED, "TrackExport answered without error but no file " + clean + " is in the project", "read the Workbench log");
			return;
		}

		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
		{
			Answer(resp, "error", SAVE_FAILED, "the file was written but the Resource Manager is not open (GetModule returned null), so it was not registered", "wb_resources register " + clean);
			return;
		}
		bool registerAnswer = resourceManager.RegisterResourceFile(absolute, false);
		string resourceId = EMCP_WB_ResourcesUtil.MetaIdOf(resourceManager, absolute);
		resp.registered = resourceId != "";
		if (!resp.registered)
		{
			Answer(resp, "error", SAVE_FAILED, "the file was written but RegisterResourceFile returned " + registerAnswer.ToString() + " and no .meta was found", "wb_resources register " + clean);
			return;
		}
		resourceManager.RebuildResourceFile(absolute, REBUILD_CONFIGURATION, false);
		resp.rebuilt = true;
		Answer(resp, "ok", "", "exported, registered as " + resourceId + " and rebuilt (" + REBUILD_CONFIGURATION + ")", "");
	}

	//------------------------------------------------------------------------------------------------
	//! txaEdit: the dry run loads the track and answers before and the proposed after; the write
	//! refuses UNPROVEN until P-W4-06 (TXA_EDIT_PROVEN).
	protected static void TxaEdit(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp)
	{
		if (ProjectRefused(resp))
			return;
		resp.path = req.path;
		array<ref EMCP_WB_AnimProfile> found = new array<ref EMCP_WB_AnimProfile>();
		array<string> notes = {};
		string why = "";
		FindProfiles("", found, notes, why);
		if (found.Count() == 0)
		{
			NoProfile(resp, "any loaded addon");
			return;
		}

		string clean = "";
		if (!EMCP_WB_Guard.CleanRelative(req.path, clean, why))
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was changed", "a project-relative .txa path");
			return;
		}
		if (!IsTxa(clean))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "path must name a .txa, got " + clean, "a project-relative .txa path");
			return;
		}
		string absolute = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why))
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why + "; nothing was changed", "a .txa of the open project");
			return;
		}
		resp.path = clean;

		string op = req.op;
		if (op != "add" && op != "edit" && op != "erase" && op != "setProp" && op != "clearProps")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "op must be add, edit, erase, setProp or clearProps, got '" + op + "'", "one of add, edit, erase, setProp, clearProps");
			return;
		}
		if (op == "add" && req.eventType != "generic" && req.eventType != "audio" && req.eventType != "weighted")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "eventType must be generic, audio or weighted, got '" + req.eventType + "'", "one of generic, audio, weighted");
			return;
		}
		if (req.fields.Count() != req.values.Count())
		{
			Answer(resp, "error", INVALID_ARGUMENT, "fields has " + req.fields.Count().ToString() + " names and values " + req.values.Count().ToString() + "; they pair by position", "one value per field");
			return;
		}
		if (op == "edit" && req.fields.Count() == 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "edit needs fields and values", "the event vars to set (txaRead lists them)");
			return;
		}
		if (op == "setProp" && req.propName == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "setProp needs propName", "the custom property's name");
			return;
		}

		TxaExporter exporter = new TxaExporter();
		TxaErrCode err = Outcome(exporter, exporter.TrackLoad(absolute, ""));
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "TrackLoad " + clean + ": " + resp.errMsg + "; nothing was changed", "check the file with wb_anim txaRead");
			return;
		}
		int total = exporter.TrackGetEventCount();
		resp.eventCount = total;

		if (op == "edit" || op == "erase")
		{
			if (req.index < 0 || req.index >= total)
			{
				Answer(resp, "error", ITEM_NOT_FOUND, "no event " + req.index.ToString() + " (the track has " + total.ToString() + "); nothing was changed", "an index txaRead lists");
				return;
			}
			BaseContainer current = exporter.TrackGetEvent(req.index);
			resp.before.Insert(EventText(req.index, current));
			if (op == "edit")
			{
				if (!current)
				{
					Answer(resp, "error", ITEM_NOT_FOUND, "TrackGetEvent(" + req.index.ToString() + ") returned null; nothing was changed", "read the track with wb_anim txaRead");
					return;
				}
				for (int f = 0; f < req.fields.Count(); f++)
				{
					string fieldName = req.fields.Get(f);
					int varIndex = current.GetVarIndex(fieldName);
					if (varIndex == -1)
					{
						Answer(resp, "error", INVALID_ARGUMENT, "event " + req.index.ToString() + " has no var " + fieldName + "; nothing was changed", "a var txaRead lists for the event");
						return;
					}
					DataVarType dataType = current.GetDataVarType(varIndex);
					if (!EMCP_WB_Container.CheckText(dataType, req.values.Get(f), why))
					{
						Answer(resp, "error", INVALID_ARGUMENT, fieldName + ": " + why + "; nothing was changed", "a value of the var's type");
						return;
					}
					resp.after.Insert(fieldName + "=" + EMCP_WB_Guard.ScrubHome(req.values.Get(f)));
				}
			}
			else
			{
				resp.after.Insert("erased; the events after it move down by one");
			}
		}
		else if (op == "add")
		{
			resp.after.Insert(total.ToString() + "|" + req.eventType + "|");
			for (int a = 0; a < req.fields.Count(); a++)
				resp.after.Insert(req.fields.Get(a) + "=" + EMCP_WB_Guard.ScrubHome(req.values.Get(a)));
		}
		else if (op == "setProp")
		{
			resp.before.Insert(req.propName + "=" + EMCP_WB_Guard.ScrubHome(exporter.TrackGetCustomProperty(req.propName)));
			resp.after.Insert(req.propName + "=" + EMCP_WB_Guard.ScrubHome(req.propValue));
		}
		else
		{
			resp.after.Insert("every custom property cleared");
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			string addNote = "";
			if (op == "add" && req.fields.Count() > 0)
				addNote = " (the new event's vars are checked when it exists)";
			Answer(resp, "ok", "", "dry run: " + op + " on " + clean + addNote + "; nothing was changed", "send confirm true to write");
			return;
		}
		if (!TXA_EDIT_PROVEN)
		{
			Answer(resp, EMCP_WB_Guard.REFUSED, UNPROVEN, "txaEdit writes wait for probe P-W4-06 (where TrackExport writes after TrackLoad, and whether edits survive the round trip); nothing was changed", "txaExport a new .txa with the wanted content");
			return;
		}
		ApplyEdit(req, resp, exporter, clean, absolute);
	}

	//------------------------------------------------------------------------------------------------
	//! The txaEdit write on a loaded track, then TrackExport and a reload for after. Reached only once
	//! TXA_EDIT_PROVEN is set from P-W4-06.
	protected static void ApplyEdit(EMCP_WB_AnimRequest req, EMCP_WB_AnimResponse resp, TxaExporter exporter, string clean, string absolute)
	{
		string why = "";
		string op = req.op;
		int touched = req.index;
		TxaErrCode err = TxaErrCode.TXAERR_OK;
		if (op == "add")
		{
			touched = exporter.TrackGetEventCount();
			if (req.eventType == "generic")
				err = Outcome(exporter, exporter.TrackAddGenericEvent());
			else if (req.eventType == "audio")
				err = Outcome(exporter, exporter.TrackAddAudioEvent());
			else
				err = Outcome(exporter, exporter.TrackAddWeightedEvent());
		}
		else if (op == "erase")
		{
			err = Outcome(exporter, exporter.TrackEraseEvent(req.index));
		}
		else if (op == "setProp")
		{
			err = Outcome(exporter, exporter.TrackSetCustomProperty(req.propName, req.propValue));
		}
		else if (op == "clearProps")
		{
			err = Outcome(exporter, exporter.TrackClearCustomProperties());
		}
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, op + ": " + resp.errMsg + "; nothing was written", "check the request against wb_anim txaRead");
			return;
		}

		if ((op == "edit" || op == "add") && req.fields.Count() > 0)
		{
			BaseContainer ev = exporter.TrackEditEvent(touched);
			if (!ev)
			{
				Answer(resp, "error", ITEM_NOT_FOUND, "TrackEditEvent(" + touched.ToString() + ") returned null; nothing was written", "read the track with wb_anim txaRead");
				return;
			}
			for (int f = 0; f < req.fields.Count(); f++)
			{
				string fieldName = req.fields.Get(f);
				int varIndex = ev.GetVarIndex(fieldName);
				if (varIndex == -1)
				{
					Answer(resp, "error", INVALID_ARGUMENT, "the event has no var " + fieldName + "; nothing was written", "a var txaRead lists for the event");
					return;
				}
				DataVarType dataType = ev.GetDataVarType(varIndex);
				if (!EMCP_WB_Container.WriteFromText(ev, fieldName, dataType, req.values.Get(f), why))
				{
					Answer(resp, "error", INVALID_ARGUMENT, fieldName + ": " + why + "; nothing was written", "a value of the var's type");
					return;
				}
			}
		}

		err = Outcome(exporter, exporter.TrackExport());
		resp.errCode = err;
		resp.errMsg = ErrText(exporter);
		if (err == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", TXA_ERROR, "TrackExport: " + resp.errMsg, "read the Workbench log");
			return;
		}
		resp.written = true;

		TxaExporter reread = new TxaExporter();
		TxaErrCode reloadErr = Outcome(reread, reread.TrackLoad(absolute, ""));
		if (reloadErr == TxaErrCode.TXAERR_ERROR)
		{
			Answer(resp, "error", SAVE_FAILED, "written, but the reload failed: " + ErrText(reread), "read the track with wb_anim txaRead");
			return;
		}
		resp.after.Clear();
		int total = reread.TrackGetEventCount();
		resp.eventCount = total;
		if (op == "setProp")
			resp.after.Insert(req.propName + "=" + EMCP_WB_Guard.ScrubHome(reread.TrackGetCustomProperty(req.propName)));
		else if ((op == "edit" || op == "add") && touched >= 0 && touched < total)
			resp.after.Insert(EventText(touched, reread.TrackGetEvent(touched)));
		Answer(resp, "ok", "", op + " written to " + clean + "; events now " + total.ToString(), "");
	}
}
