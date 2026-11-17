/**
 * EMCP_WB_Module.c - Module handler of wb_module (DEC-048 package 3.3, design section 2)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Module", dispatching on "action":
 *   list         the present module names, no Workbench.GetModule call (GetModule OPENS a
 *                closed module's window, sitting P3-3 gate 1); NavmeshGeneratorMain is listed only
 *                when its type resolves (absent from 1.9.0.37 on, W5 OD-5, DEC-068); openModules
 *                holds only the modules this handler opened (open, info) since the script reload,
 *                which the owner may have closed since; the Particle Editor is never read
 *                (DEC-042), listed as unread
 *   info         one module: OPENS IT IF CLOSED (GetModule), then its container count, container
 *                class names and docPath, the path of container 0's resource
 *                (GetContainer(0).GetResourceName(), W4 spec 2.3) where that read is proven: the
 *                World Editor and the Resource Manager; AnimEditor, BehaviorEditor and ProcAnimEditor
 *                answer 0 containers with a file open (P-W4-10 killed, W4 run 1), so their docPath
 *                stays empty and info says why; mayHaveOpened is always true (no passive pre-check)
 *   open         Workbench.OpenModule for one of the present modules (the Particle Editor included)
 *   front        refused here: BringModuleWindowToFront is a NET native the TypeScript tool calls
 *   close        refused: no proven call tells whether the document is dirty, and one WM_CLOSE
 *                does not exit a dirty world (DEC-045); the owner closes by hand
 *   setResource  SetOpenedResource on a clean relative path in the named module, which must own the
 *                file type (World Editor: .ent and .et only; .conf, .emat, .layout etc.: Resource
 *                Manager; EMCP_WB_OpenResource.OwnerOf); another type is refused INVALID_ARGUMENT
 *                (opening is not a write; the engine resolves the path across the addons, DEC-058).
 *                AnimEditor and ProcAnimEditor take the project-relative SetOpenedResource form only
 *                once probe P-W4-07 / P-W4-08 passed for them; until then Workbench.OpenResource
 *                opens the file in its default editor (the 1.x route, W4 spec 2.3)
 *   save         project only, dry run unless confirm. World Editor: WorldEditor.Save() of a world
 *                of the open project. AnimEditor, BehaviorEditor, ProcAnimEditor (W4 spec 2.3): the
 *                module holds exactly one container, the path of its resource passes
 *                TargetExistsInProject, then WBModuleDef.Save. On 1.9.0.37 each refuses NO_DOCUMENT
 *                with no engine call: the editors expose no container for the open file (P-W4-10
 *                killed, W4 run 1); behind that, GATED until P-W4-11 AnimEditor, P-W4-13
 *                BehaviorEditor, P-W4-12 ProcAnimEditor; the save may change the file beyond
 *                canonical form, which the answer says (OD-6, DEC-067). Any other module refuses MODULE_NOT_SUPPORTED
 *   action       WBModuleDef.ExecuteAction for a menu path on the allow-list compiled
 *                into EMCP_WB_ActionAllowList.c (generated from data/census/policy.json); a path
 *                one segment of which holds a deny-list label or a refused word is refused even
 *                when listed (the probe's executeAction, mod-dev/probe/ECEN_ProbeModules.c)
 *
 * A refusal answers status EMCP_WB_Guard.REFUSED with code and nextStep set and message in the
 * form "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Module.json.
 */

class EMCP_WB_ModuleRequest : JsonApiStruct
{
	string action;
	// every action but list: one of the present module names
	string moduleName;
	// setResource: a clean relative resource path (no drive, prefix, '.' or '..')
	string path;
	// action: the menu path, one segment per entry
	ref array<string> menuPath;
	// action: keep the focus where it is (default true)
	bool keepFocus;
	// save: true writes; without it save is a dry run that writes nothing
	bool confirm;

	void EMCP_WB_ModuleRequest()
	{
		menuPath = {};

		RegV("action");
		RegV("moduleName");
		RegV("path");
		RegV("menuPath");
		RegV("keepFocus");
		RegV("confirm");

		keepFocus = true;
		confirm = false;
	}
}

class EMCP_WB_ModuleResponse : JsonApiStruct
{
	// ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string action;
	string code;
	string message;
	string nextStep;
	string moduleName;
	// list
	ref array<string> modules;
	ref array<string> openModules;
	ref array<string> unreadModules;
	// info, open
	bool isOpen;
	// info: GetModule opens a closed module and no passive check tells beforehand
	bool mayHaveOpened;
	// info
	int containerCount;
	ref array<string> containerClasses;
	// open, setResource, save, action: whether the engine call was made and what it returned
	bool called;
	bool result;
	// setResource
	string path;
	//! setResource: the module that took the resource
	string openedIn;
	// action
	string executedPath;
	int allowListCount;
	// save: the open world (shown only in its project form), its form, and whether nothing was written
	string worldPath;
	string worldPathForm;
	bool dryRun;
	//! info, save: the path of container 0's resource (GetContainer(0).GetResourceName()); "" when
	//! the module holds none or the read is not proven for it
	string docPath;

	void EMCP_WB_ModuleResponse()
	{
		modules = {};
		openModules = {};
		unreadModules = {};
		containerClasses = {};

		RegV("status");
		RegV("action");
		RegV("code");
		RegV("message");
		RegV("nextStep");
		RegV("moduleName");
		RegV("modules");
		RegV("openModules");
		RegV("unreadModules");
		RegV("isOpen");
		RegV("mayHaveOpened");
		RegV("containerCount");
		RegV("containerClasses");
		RegV("called");
		RegV("result");
		RegV("path");
		RegV("openedIn");
		RegV("executedPath");
		RegV("allowListCount");
		RegV("worldPath");
		RegV("worldPathForm");
		RegV("dryRun");
		RegV("docPath");
	}
}

class EMCP_WB_ModuleUtil
{
	//! Container class names info reports at most.
	static const int MAX_CONTAINERS = 64;
	static const string NOT_SUPPORTED = "MODULE_NOT_SUPPORTED";
	static const string WAITS_P3_1 = "waits for sitting P3-1";
	static const string GATED = "GATED";
	static const string GATED_NEXT = "waits for the W4 live train; the main session opens it when the probe passes";
	static const string NAVMESH = "NavmeshGeneratorMain";
	//! Live gates of wave W4 (phase5-w4-spec.md 2.3 and 3, DEC-067). Each stays false until its
	//! probe passes on the live train; the main session sets it. No call behind a false gate is made.
	//! P-W4-10: GetContainer(0) and GetResourceName of the open document, per editor (the Particle
	//! Editor's module read crashed the Workbench, DEC-042). KILLED in W4 run 1 for all three: each
	//! answered 0 containers with a file open; these stay false on 1.9.0.37 (NoDocumentWhy).
	static const bool DOC_READ_ANIM = false;
	static const bool DOC_READ_BEHAVIOR = false;
	static const bool DOC_READ_PROCANIM = false;
	//! WBModuleDef.Save of the open document: P-W4-11 AnimEditor, P-W4-13 BehaviorEditor, P-W4-12
	//! ProcAnimEditor (the U11 editor half: does the save recompile the .pap blocks).
	static const bool SAVE_ANIM = false;
	static const bool SAVE_BEHAVIOR = false;
	static const bool SAVE_PROCANIM = false;
	//! SetOpenedResource with the project-relative path: P-W4-07 AnimEditor, P-W4-08 ProcAnimEditor.
	static const bool RELATIVE_OPEN_ANIM = false;
	static const bool RELATIVE_OPEN_PROCANIM = false;
	//! Modules this handler opened (open, info) since the script reload; not proof they are open now.
	static ref array<string> s_HandlerOpened;

	//------------------------------------------------------------------------------------------------
	static void NoteOpened(string name)
	{
		if (!s_HandlerOpened)
			s_HandlerOpened = new array<string>();
		if (s_HandlerOpened.Find(name) < 0)
			s_HandlerOpened.Insert(name);
	}

	//------------------------------------------------------------------------------------------------
	//! The present modules in name order (EMCP_WB_Guard.ModuleType). NavmeshGeneratorMain only when
	//! its type resolves: build 1.9.0.37 has no such class (W5 OD-5, DEC-068).
	static void ModuleNames(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("AnimEditor");
		outNames.Insert("AudioEditor");
		outNames.Insert("BehaviorEditor");
		outNames.Insert("LocalizationEditor");
		typename navmeshType = EMCP_WB_Guard.ModuleType(NAVMESH);
		if (navmeshType)
			outNames.Insert(NAVMESH);
		outNames.Insert("ParticleEditor");
		outNames.Insert("ProcAnimEditor");
		outNames.Insert("ResourceManager");
		outNames.Insert("ScriptEditor");
		outNames.Insert("WorldEditor");
	}

	//------------------------------------------------------------------------------------------------
	//! Sets a refusal: status refused, code, nextStep and the message "CODE: text | next: step".
	static void Refuse(EMCP_WB_ModuleResponse resp, string code, string text, string nextStep)
	{
		resp.status = EMCP_WB_Guard.REFUSED;
		resp.code = code;
		resp.nextStep = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! Refuses a name that is not one of the present modules, and the Particle Editor for a read.
	static void RefuseModule(EMCP_WB_ModuleResponse resp, string name, bool forRead)
	{
		typename anyType = EMCP_WB_Guard.ModuleType(name);
		if (!anyType || !forRead)
		{
			string absent = "";
			if (name == NAVMESH)
				absent = " (its class does not exist in this build)";
			Refuse(resp, "INVALID_ARGUMENT", "moduleName must be one of the present modules; got '" + name + "'" + absent, "pass a module name from wb_module list");
			return;
		}
		Refuse(resp, NOT_SUPPORTED, "the Particle Editor is never read (its module read crashed the Workbench, DEC-042)", "use open or front for ParticleEditor");
	}

	//------------------------------------------------------------------------------------------------
	//! True for the three W4 editors: AnimEditor, BehaviorEditor, ProcAnimEditor.
	static bool IsW4Editor(string name)
	{
		return name == "AnimEditor" || name == "BehaviorEditor" || name == "ProcAnimEditor";
	}

	//------------------------------------------------------------------------------------------------
	//! "" when reading container 0's resource name is proven for the module: the World Editor and the
	//! Resource Manager (W1, W2 live), a W4 editor once P-W4-10 passed for it. Otherwise the reason.
	static string DocReadGate(string name)
	{
		if (name == "WorldEditor" || name == "ResourceManager")
			return "";
		if (name == "AnimEditor" && DOC_READ_ANIM)
			return "";
		if (name == "BehaviorEditor" && DOC_READ_BEHAVIOR)
			return "";
		if (name == "ProcAnimEditor" && DOC_READ_PROCANIM)
			return "";
		if (IsW4Editor(name))
			return NoDocumentWhy(name);
		return "no read of the open document's name was ever made in " + name;
	}

	//------------------------------------------------------------------------------------------------
	//! P-W4-10 KILLED (W4 run 1, 1.9.0.37): AnimEditor, BehaviorEditor and ProcAnimEditor each
	//! answered GetNumContainers 0 with a file open (w4-31, w4-32, w4-34), so no container names the
	//! open document. The kill branch: docPath stays empty and save refuses NO_DOCUMENT.
	static string NoDocumentWhy(string name)
	{
		return name + " exposes no container for its open document (GetNumContainers answered 0 with a file open, probe P-W4-10 killed on 1.9.0.37), so the open document's path is not known";
	}

	//------------------------------------------------------------------------------------------------
	//! "" when save may reach a W4 editor: its document read (P-W4-10) and its save probe passed.
	static string SaveGate(string name)
	{
		string readGate = DocReadGate(name);
		if (readGate != "")
			return "save in " + name + ": " + readGate;
		if (name == "AnimEditor" && !SAVE_ANIM)
			return "save in AnimEditor waits for probe P-W4-11 (does WBModuleDef.Save write without a dialog)";
		if (name == "BehaviorEditor" && !SAVE_BEHAVIOR)
			return "save in BehaviorEditor waits for probe P-W4-13 (does WBModuleDef.Save write without a dialog)";
		if (name == "ProcAnimEditor" && !SAVE_PROCANIM)
			return "save in ProcAnimEditor waits for probe P-W4-12 (does the editor save recompile the .pap blocks)";
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! True when the module takes SetOpenedResource with a project-relative path: every owning
	//! module but AnimEditor and ProcAnimEditor, which take it once P-W4-07 / P-W4-08 passed.
	static bool RelativeOpenProven(string name)
	{
		if (name == "AnimEditor")
			return RELATIVE_OPEN_ANIM;
		if (name == "ProcAnimEditor")
			return RELATIVE_OPEN_PROCANIM;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The path of a container's resource (BaseContainer.GetResourceName, then ResourceName.GetPath),
	//! the read open:ResourceManager makes in EMCP_WB_Container; "" for a null container.
	static string DocPath(BaseContainer doc)
	{
		if (!doc)
			return "";
		ResourceName opened = doc.GetResourceName();
		string openedPath = opened.GetPath();
		return openedPath;
	}

	//------------------------------------------------------------------------------------------------
	//! A menu label as the deny check compares it (ECEN_ProbeUtil.NormLabel): the text before a tab;
	//! "&x" becomes "x"; a trailing "..." or ellipsis removed; white space collapsed; trimmed; lower case.
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
	//! The words of a label (ECEN_ProbeUtil.Words): NormLabel, then split on every character that is
	//! not a lower-case ASCII letter or a digit.
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
	//! The first segment that holds a deny-list label as a run of words, or a refused word (both
	//! compiled into EMCP_WB_ActionAllowList.c); "" when none does (ECEN_ProbeUtil.DeniedSegment).
	static string DeniedSegment(array<string> menuPath, out string why)
	{
		why = "";
		array<string> denied = {};
		EMCP_WB_ActionAllowList.DenyLabels(denied);
		array<string> refusedWords = {};
		EMCP_WB_ActionAllowList.DenyWords(refusedWords);
		for (int i = 0; i < menuPath.Count(); i++)
		{
			array<string> words = {};
			Words(menuPath.Get(i), words);
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
					return menuPath.Get(i);
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
						return menuPath.Get(i);
					}
				}
			}
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! True when the path equals an allow-list entry exactly: same segments, no prefix match, no case
	//! folding (ECEN_ProbeUtil.PathAllowed).
	static bool PathAllowed(array<string> menuPath)
	{
		string joined = string.Join("\n", menuPath, false);
		array<string> allowed = {};
		EMCP_WB_ActionAllowList.Paths(allowed);
		for (int i = 0; i < allowed.Count(); i++)
		{
			if (allowed.Get(i) == joined)
				return true;
		}
		return false;
	}
}

class EMCP_WB_Module : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ModuleRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ModuleRequest req = EMCP_WB_ModuleRequest.Cast(request);
		EMCP_WB_ModuleResponse resp = new EMCP_WB_ModuleResponse();
		resp.action = req.action;

		if (req.action == "list")
			ListModules(req, resp);
		else if (req.action == "info")
			InfoModule(req, resp);
		else if (req.action == "open")
			OpenOne(req, resp);
		else if (req.action == "front")
			FrontOne(req, resp);
		else if (req.action == "close")
			CloseOne(req, resp);
		else if (req.action == "setResource")
			SetResource(req, resp);
		else if (req.action == "save")
			SaveOne(req, resp);
		else if (req.action == "action")
			RunAction(req, resp);
		else
			EMCP_WB_ModuleUtil.Refuse(resp, "INVALID_ARGUMENT", "unknown action '" + req.action + "'", "one of list, info, open, front, close, setResource, save, action");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! list: the module names, no GetModule (it opens a closed module). openModules: the modules this
	//! handler opened since the script reload.
	static void ListModules(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		array<string> names = {};
		EMCP_WB_ModuleUtil.ModuleNames(names);
		for (int m = 0; m < names.Count(); m++)
		{
			string name = names.Get(m);
			typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(name);
			if (!moduleType)
			{
				resp.unreadModules.Insert(name);
				continue;
			}
			resp.modules.Insert(name);
			if (EMCP_WB_ModuleUtil.s_HandlerOpened && EMCP_WB_ModuleUtil.s_HandlerOpened.Find(name) >= 0)
				resp.openModules.Insert(name);
		}
		int openCount = resp.openModules.Count();
		int readCount = resp.modules.Count();
		resp.status = "ok";
		resp.message = readCount.ToString() + " modules; open state not read (GetModule opens a module); " + openCount.ToString() + " opened by this handler";
	}

	//------------------------------------------------------------------------------------------------
	//! info: GetModule, GetNumContainers and each container's class name (moduleMatrix's calls), then
	//! docPath from container 0's resource name where DocReadGate allows that read (W4 spec 2.3).
	//! GetModule OPENS the module's window when it is closed (sitting P3-3 gate 1): not a passive read.
	static void InfoModule(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, true);
			return;
		}

		resp.mayHaveOpened = true;
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		bool isOpen = wbModule != null;
		resp.isOpen = isOpen;
		if (isOpen)
			EMCP_WB_ModuleUtil.NoteOpened(req.moduleName);
		if (!wbModule)
		{
			resp.status = "ok";
			resp.message = req.moduleName + " is not open";
			return;
		}

		int count = wbModule.GetNumContainers();
		resp.containerCount = count;
		for (int c = 0; c < count && c < EMCP_WB_ModuleUtil.MAX_CONTAINERS; c++)
		{
			BaseContainer cont = wbModule.GetContainer(c);
			string className = "";
			if (cont)
				className = cont.GetClassName();
			resp.containerClasses.Insert(className);
		}
		string docNote = "";
		if (count == 0 && EMCP_WB_ModuleUtil.IsW4Editor(req.moduleName) && EMCP_WB_ModuleUtil.DocReadGate(req.moduleName) != "")
			docNote = "; docPath stays empty: " + EMCP_WB_ModuleUtil.NoDocumentWhy(req.moduleName);
		if (count > 0)
		{
			string readGate = EMCP_WB_ModuleUtil.DocReadGate(req.moduleName);
			if (readGate == "")
			{
				BaseContainer firstDoc = wbModule.GetContainer(0);
				resp.docPath = EMCP_WB_Guard.ScrubHome(EMCP_WB_ModuleUtil.DocPath(firstDoc));
			}
			else
				docNote = "; docPath not read: " + readGate;
		}
		resp.status = "ok";
		resp.message = req.moduleName + " is open with " + count.ToString() + " containers" + docNote;
	}

	//------------------------------------------------------------------------------------------------
	//! open: Workbench.OpenModule when the module is not open (moduleMatrix's call). The Particle
	//! Editor is opened but never read back with GetModule (DEC-042).
	static void OpenOne(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForOpen(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, false);
			return;
		}

		typename readType = EMCP_WB_Guard.ModuleTypeForRead(req.moduleName);
		if (!readType)
		{
			bool particleOpened = Workbench.OpenModule(moduleType);
			resp.called = true;
			resp.result = particleOpened;
			resp.isOpen = particleOpened;
			resp.status = "ok";
			resp.message = "OpenModule returned " + particleOpened.ToString() + " (not read back: the Particle Editor is never read)";
			return;
		}

		// GetModule opens a closed module (DEC-053), so a non-null answer does not say it was open before.
		resp.mayHaveOpened = true;
		WBModuleDef wbModule = Workbench.GetModule(readType);
		if (wbModule)
		{
			EMCP_WB_ModuleUtil.NoteOpened(req.moduleName);
			resp.isOpen = true;
			resp.result = true;
			resp.status = "ok";
			resp.message = req.moduleName + " is open: GetModule returned it (GetModule opens a closed module, so whether it was open before is not known); OpenModule not called";
			return;
		}

		bool openResult = Workbench.OpenModule(moduleType);
		wbModule = Workbench.GetModule(readType);
		bool isOpen = wbModule != null;
		if (isOpen)
			EMCP_WB_ModuleUtil.NoteOpened(req.moduleName);
		resp.called = true;
		resp.result = openResult;
		resp.isOpen = isOpen;
		resp.status = "ok";
		resp.message = "OpenModule returned " + openResult.ToString() + "; read back open " + isOpen.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! front: refused. BringModuleWindowToFront is a NET native, not a script call.
	static void FrontOne(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForOpen(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, false);
			return;
		}
		EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_ModuleUtil.NOT_SUPPORTED, "front is the NET native BringModuleWindowToFront, not a script call", "the wb_module tool calls the native (src/workbench/native.ts bringModuleWindowToFront)");
	}

	//------------------------------------------------------------------------------------------------
	//! close: refused. No proven call tells whether the module's document is dirty (DEC-045).
	static void CloseOne(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForOpen(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, false);
			return;
		}
		EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_ModuleUtil.NOT_SUPPORTED, "close is refused: no proven call tells whether the document is dirty, and one WM_CLOSE does not exit a dirty world (DEC-045)", "the owner closes by hand");
	}

	//------------------------------------------------------------------------------------------------
	//! setResource: a clean relative path (EMCP_WB_Guard.CleanRelative), opened in the named module,
	//! which must own the path's file type (EMCP_WB_OpenResource.OwnerOf): the World Editor takes only
	//! a world (.ent) or a prefab (.et); a .conf handed to it raised the modal "Cannot open prefabs at
	//! this time (not implemented)" (W2 run 2, w2-50, 1.9.0.37). Another type is refused
	//! INVALID_ARGUMENT before any module is touched, the owning module named in nextStep. The Particle
	//! Editor is never asked. No project is required: opening is not a write, and the engine resolves
	//! the path across the loaded addons (DEC-058). The check is textual: nothing checks that the file
	//! exists or which addon the engine resolves it from.
	static void SetResource(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		resp.path = req.path;
		typename moduleType = EMCP_WB_Guard.ModuleType(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, false);
			return;
		}
		string clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(req.path, clean, why))
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "INVALID_ARGUMENT", why, "pass a relative resource path, no drive, prefix, '.' or '..'");
			return;
		}
		resp.path = clean;

		string owner = EMCP_WB_OpenResource.OwnerOf(clean);
		if (owner == EMCP_WB_OpenResource.PARTICLE_EDITOR)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_ModuleUtil.NOT_SUPPORTED, "a particle effect (.ptc) is never opened: reading the Particle Editor module crashed the Workbench (DEC-042)", "the owner opens it by hand");
			return;
		}
		if (owner != req.moduleName)
		{
			string kind = "the module that owns its file type";
			if (req.moduleName == EMCP_WB_OpenResource.WORLD_EDITOR)
				kind = "the World Editor opens only a world (.ent) or a prefab (.et)";
			EMCP_WB_ModuleUtil.Refuse(resp, "INVALID_ARGUMENT", req.moduleName + " cannot open " + clean + ": " + kind + "; nothing was opened", "wb_module setResource module " + owner + " (or wb_resources open)");
			return;
		}

		resp.mayHaveOpened = true;
		if (owner == EMCP_WB_OpenResource.WORLD_EDITOR)
		{
			WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
			if (!worldEditor)
			{
				EMCP_WB_ModuleUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
				return;
			}
		}

		// AnimEditor and ProcAnimEditor: the project-relative SetOpenedResource form waits for P-W4-07 /
		// P-W4-08 (the U8 retry); until then the 1.x route, Workbench.OpenResource, opens the file in
		// the default editor of its type, which OwnerOf names (W4 spec 2.3).
		if (!EMCP_WB_ModuleUtil.RelativeOpenProven(owner))
		{
			bool routed = Workbench.OpenResource(clean);
			resp.called = true;
			resp.result = routed;
			if (!routed)
			{
				resp.status = "error";
				resp.message = "Workbench.OpenResource returned false (SetOpenedResource with a project-relative path waits for its W4 probe in " + owner + ")";
				return;
			}
			resp.openedIn = owner;
			resp.status = "ok";
			resp.message = "Workbench.OpenResource returned true: opened in the default editor of the type (" + owner + "), not read back; SetOpenedResource with a project-relative path waits for its W4 probe";
			return;
		}

		// Only the owning module is asked (a .bt the Behavior Editor refuses goes to the Resource
		// Manager, which hands it on: 1.9.0.37); EMCP_WB_OpenResource.OpenIn.
		string openedIn = EMCP_WB_OpenResource.OpenIn(owner, clean);
		bool opened = openedIn != "";
		resp.called = true;
		resp.result = opened;
		resp.openedIn = openedIn;
		if (opened)
		{
			resp.status = "ok";
			resp.message = "SetOpenedResource returned true in " + openedIn;
		}
		else
		{
			resp.status = "error";
			resp.message = "SetOpenedResource returned false in every module tried";
		}
	}

	//------------------------------------------------------------------------------------------------
	//! save: the World Editor (SaveWorld) or one of the three W4 editors (SaveDocument); any other
	//! module refuses MODULE_NOT_SUPPORTED with the P3-1 next step.
	static void SaveOne(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		if (EMCP_WB_ModuleUtil.IsW4Editor(req.moduleName))
			SaveDocument(req, resp);
		else
			SaveWorld(req, resp);
	}

	//------------------------------------------------------------------------------------------------
	//! save in AnimEditor, BehaviorEditor or ProcAnimEditor (W4 spec 2.3, DEC-067): GATED first (no
	//! engine call) until the editor's probes pass (SaveGate); then the project, the open module,
	//! exactly one container (which document WBModuleDef.Save writes with more open is unproven, the
	//! W2 rule of open:ResourceManager), the path of its resource through CleanRelative and
	//! TargetExistsInProject (DEC-058), a dry run without confirm, WBModuleDef.Save with it. OD-6: the
	//! editor's save may change the file beyond canonical form; the answer says so (the handler
	//! reads no file to diff).
	static void SaveDocument(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		// P-W4-10 killed: the editor names no open document, so there is no path to guard (no engine call).
		if (EMCP_WB_ModuleUtil.DocReadGate(req.moduleName) != "")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "NO_DOCUMENT", "save in " + EMCP_WB_ModuleUtil.NoDocumentWhy(req.moduleName) + "; nothing was sent to the editor", "save in the editor by hand");
			return;
		}
		string gate = EMCP_WB_ModuleUtil.SaveGate(req.moduleName);
		if (gate != "")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_ModuleUtil.GATED, gate + "; nothing was sent to the editor", EMCP_WB_ModuleUtil.GATED_NEXT);
			return;
		}
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "save needs the handlers installed in the open project", "install the handlers in the project you have open");
			return;
		}
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, true);
			return;
		}

		resp.mayHaveOpened = true;
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "MODULE_NOT_OPEN", req.moduleName + " is not open: GetModule returned null", "wb_module open " + req.moduleName);
			return;
		}
		int count = wbModule.GetNumContainers();
		if (count < 1)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "NO_DOCUMENT", req.moduleName + " holds no open document (GetNumContainers is 0)", "wb_module setResource module " + req.moduleName);
			return;
		}
		if (count != 1)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "UNPROVEN", req.moduleName + " holds " + count.ToString() + " containers; which one WBModuleDef.Save writes is unproven, so only a single open document is saved; nothing was written", "close the other documents, or save in the editor by hand");
			return;
		}
		BaseContainer doc = wbModule.GetContainer(0);
		if (!doc)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "NO_DOCUMENT", "GetContainer(0) of " + req.moduleName + " returned null", "wb_module setResource module " + req.moduleName);
			return;
		}
		string openedPath = EMCP_WB_ModuleUtil.DocPath(doc);
		string clean = "";
		string why = "";
		if (openedPath == "" || !EMCP_WB_Guard.CleanRelative(openedPath, clean, why))
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "the open document's name (GetResourceName) gives no project-relative path; nothing was written", "open a file of the project you have open");
			return;
		}
		resp.docPath = clean;
		string absolute = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why))
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why + "; nothing was written", "open a file of the project you have open");
			return;
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would save " + clean + " through " + req.moduleName + "; the editor's save may change the file beyond canonical form (OD-6); nothing was written; pass confirm true to save";
			return;
		}

		bool saved = wbModule.Save();
		resp.called = true;
		resp.dryRun = false;
		resp.result = saved;
		if (!saved)
		{
			resp.status = "error";
			resp.code = "SAVE_FAILED";
			resp.message = "WBModuleDef.Save returned false in " + req.moduleName + "; the document may hold unsaved edits";
			return;
		}
		resp.status = "ok";
		resp.message = "WBModuleDef.Save returned true in " + req.moduleName + "; the editor's save may change the file beyond canonical form (OD-6): compare it with its copy before the save";
	}

	//------------------------------------------------------------------------------------------------
	//! save: World Editor only, project only. Without confirm a dry run: the open world's path
	//! (WorldEditorAPI.GetWorldPath, as EMCP_WB_Info and ECEN_ProbeWorld read it) and nothing written.
	//! With confirm, only a world under the open project's file-system prefix ("$" + ProjectId + ":",
	//! DEC-058) is saved, by WorldEditor.Save() (EMCP_WB_EditorControl's call).
	static void SaveWorld(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		if (req.moduleName != "WorldEditor")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_ModuleUtil.NOT_SUPPORTED, "save takes WorldEditor, AnimEditor, BehaviorEditor or ProcAnimEditor; got '" + req.moduleName + "'", EMCP_WB_ModuleUtil.WAITS_P3_1);
			return;
		}
		string projectId = EMCP_WB_Guard.ProjectId();
		if (projectId == "")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "save needs the handlers installed in the open project", "install the handlers in the project you have open");
			return;
		}

		resp.mayHaveOpened = true;
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return;
		}

		string worldPath = "";
		WorldEditorAPI api = worldEditor.GetApi();
		if (api)
			api.GetWorldPath(worldPath);
		string projectPrefix = "$" + projectId + ":";
		resp.worldPathForm = "withheld";
		if (worldPath == "")
			resp.worldPathForm = "none";
		else if (worldPath.StartsWith(projectPrefix))
		{
			resp.worldPath = worldPath;
			resp.worldPathForm = "project";
		}

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would save the open world (" + resp.worldPathForm + "); nothing was written; pass confirm true to save";
			return;
		}
		if (resp.worldPathForm != "project")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "the open world is not a world of the open project (" + resp.worldPathForm + ")", "open a world of the project you have open");
			return;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "NO_WORLD", noWorld, "open a world (wb_module setResource)");
			return;
		}

		bool saved = worldEditor.Save();
		resp.called = true;
		resp.dryRun = false;
		resp.result = saved;
		if (saved)
		{
			resp.status = "ok";
			resp.message = "WorldEditor.Save returned true";
		}
		else
		{
			resp.status = "error";
			resp.message = "WorldEditor.Save returned false";
		}
	}

	//------------------------------------------------------------------------------------------------
	//! action: ExecuteAction for an allow-listed menu path on an open module (the probe's
	//! executeAction). No project requirement (DEC-058); the allow-list and deny list decide, and a
	//! label ending in "..." (a dialog) is refused MODAL_HAZARD. Its
	//! GetModule call opens a closed module (DEC-053): mayHaveOpened.
	static void RunAction(EMCP_WB_ModuleRequest req, EMCP_WB_ModuleResponse resp)
	{
		resp.moduleName = req.moduleName;
		int allowed = EMCP_WB_ActionAllowList.Count();
		resp.allowListCount = allowed;
		typename moduleType = EMCP_WB_Guard.ModuleTypeForRead(req.moduleName);
		if (!moduleType)
		{
			EMCP_WB_ModuleUtil.RefuseModule(resp, req.moduleName, true);
			return;
		}

		array<string> menuPath = req.menuPath;
		if (!menuPath || menuPath.Count() == 0)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "INVALID_ARGUMENT", "menuPath must hold at least one segment", "pass the menu path as segments");
			return;
		}
		for (int i = 0; i < menuPath.Count(); i++)
		{
			string segment = menuPath.Get(i);
			if (segment == "" || segment.Contains("\n"))
			{
				EMCP_WB_ModuleUtil.Refuse(resp, "INVALID_ARGUMENT", "menuPath segment " + i.ToString() + " is empty or holds a line break", "pass the menu path as segments");
				return;
			}
		}
		resp.executedPath = string.Join(" > ", menuPath, false);

		// A label with a trailing ellipsis opens a dialog, which blocks the NET queue (wb_menu run
		// refuses it the same way; DEC-100 keeps dialog openers off the allow-list).
		string lastSegment = menuPath.Get(menuPath.Count() - 1);
		lastSegment.TrimInPlace();
		if (lastSegment.EndsWith("..."))
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "MODAL_HAZARD", "'" + lastSegment + "' opens a dialog; nothing was sent", "press it by hand in Workbench");
			return;
		}

		string deniedWhy = "";
		string denied = EMCP_WB_ModuleUtil.DeniedSegment(menuPath, deniedWhy);
		if (denied != "")
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "NOT_ALLOWLISTED", "segment '" + denied + "' " + deniedWhy, "nothing was sent; a human runs this menu item");
			return;
		}
		if (!EMCP_WB_ModuleUtil.PathAllowed(menuPath))
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "NOT_ALLOWLISTED", "the menu path is not on the allow-list compiled into EMCP_WB_ActionAllowList.c (" + allowed.ToString() + " entries)", "nothing was sent; main adds a path to policy.json execute_action.allow_list and regenerates");
			return;
		}

		resp.mayHaveOpened = true;
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			EMCP_WB_ModuleUtil.Refuse(resp, "MODULE_NOT_OPEN", req.moduleName + " is not open: GetModule returned null", "wb_module open " + req.moduleName);
			return;
		}

		bool keepFocus = req.keepFocus;
		bool result = wbModule.ExecuteAction(menuPath, keepFocus);
		resp.called = true;
		resp.result = result;
		resp.status = "ok";
		resp.message = "ExecuteAction returned " + result.ToString();
	}
}
