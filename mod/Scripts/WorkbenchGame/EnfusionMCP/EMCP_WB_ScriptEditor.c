/**
 * EMCP_WB_ScriptEditor.c - The Script Editor's active file, 0-based lines (wave W3, wb_script_editor)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_ScriptEditor", dispatching on "action"
 * (docs/v2/design/phase5-w3-spec.md section 2.1). One action surface (DEC-061): the 1.x names
 * (getCurrentFile, getLine, getLinesCount, openFile) are mapped by the TypeScript tool, not here.
 * Lines are 0-based everywhere (KD-010): the engine's line argument is 0-based, and its -1 "current
 * line" default is never sent; every line is bounds-checked against GetLinesCount first.
 *   state         GetCurrentFile, GetCurrentLine, GetLinesCount; the file classified against the
 *                 open project (EMCP_WB_Guard.TargetExistsInProject; its path form is P-W3-01)
 *   getLines      GetLineText per line, paged
 *   open          SetOpenedResource on a clean relative .c path that resolves in a loaded addon
 *                 (Workbench.GetAbsolutePath, no file method); the Script Editor opens it in a tab
 *   jump          Workbench.JumpToScriptSymbol on "Class" or "Class.Member" whose class exists
 *                 (string.ToType); then the file and caret (P-W3-05)
 *   setLine       GetLineText (before), SetLineText, read back
 *   insertLine    InsertLine before line N (0..linesCount), read back (P-W3-02)
 *   removeLine    GetLineText (before), RemoveLine, count read back (P-W3-02)
 *   replaceRange  `expected` checked (else TEXT_CHANGED), then SetLineText over the overlap and
 *                 InsertLine or RemoveLine for the rest; read back
 *   save          WBModuleDef.Save on the active file; a dry run unless confirm is true (P-W3-03)
 *   close         refused GATED until probe P-W3-04 (W3 OD-3, DEC-063); nothing is sent
 *
 * Guards (spec section 1): state and getLines none; open and jump none (they open or jump);
 * line edits and save need the project found (DEC-058) and the active file inside it
 * (projectOnly), else NOT_IN_PROJECT. No file is written but by save with confirm. Every action
 * but close calls Workbench.GetModule, which opens a closed Script Editor: mayHaveOpened.
 * Paging: cursor "<start>:<count>", count = the line count at the first read; a changed count
 * answers STALE_CURSOR; limit default 100, max 200. Keys: contracts/EMCP_WB_ScriptEditor.json.
 */

class EMCP_WB_ScriptEditorRequest : JsonApiStruct
{
	string action;
	//! open: a clean relative .c path
	string path;
	//! jump: "Class" or "Class.Member"
	string symbol;
	//! setLine, insertLine, removeLine: the 0-based line; -1 (left out) is refused
	int line;
	//! setLine, insertLine: the new text, no line break
	string text;
	//! getLines: the first line (default 0); replaceRange: the first line replaced
	int start;
	//! replaceRange: the number of lines replaced (0 inserts); -1 (left out) is refused
	int count;
	//! replaceRange: the new lines (empty deletes)
	ref array<string> lines;
	//! replaceRange: the current text of the replaced lines; a mismatch answers TEXT_CHANGED
	ref array<string> expected;
	//! getLines: nextCursor of the previous page
	string cursor;
	int limit;
	//! save: true saves; else a dry run
	bool confirm;

	void EMCP_WB_ScriptEditorRequest()
	{
		lines = {};
		expected = {};

		RegV("action");
		RegV("path");
		RegV("symbol");
		RegV("line");
		RegV("text");
		RegV("start");
		RegV("count");
		RegV("lines");
		RegV("expected");
		RegV("cursor");
		RegV("limit");
		RegV("confirm");

		// Defaults for keys the request leaves out.
		line = -1;
		start = 0;
		count = -1;
		confirm = false;
	}
}

class EMCP_WB_ScriptEditorResponse : JsonApiStruct
{
	//! ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	string file;
	string relPath;
	bool inProject;
	int line;
	int linesCount;
	string link;
	ref array<string> rows;
	int start;
	int total;
	string nextCursor;
	string before;
	string after;
	ref array<string> removed;
	bool result;
	bool opened;
	bool dryRun;
	bool saved;
	bool closed;
	ref array<string> warnings;
	//! Workbench.GetModule opens a closed Script Editor (DEC-053)
	bool mayHaveOpened;

	void EMCP_WB_ScriptEditorResponse()
	{
		rows = {};
		removed = {};
		warnings = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("file");
		RegV("relPath");
		RegV("inProject");
		RegV("line");
		RegV("linesCount");
		RegV("link");
		RegV("rows");
		RegV("start");
		RegV("total");
		RegV("nextCursor");
		RegV("before");
		RegV("after");
		RegV("removed");
		RegV("result");
		RegV("opened");
		RegV("dryRun");
		RegV("saved");
		RegV("closed");
		RegV("warnings");
		RegV("mayHaveOpened");

		line = -1;
	}
}

//! The active file of the Script Editor as one read found it. Strings and bools only: no engine
//! pointer is carried (W1 fix-up 1).
class EMCP_WB_ScriptEditorDoc
{
	//! GetCurrentFile returned true
	bool m_Opened;
	//! as GetCurrentFile gave it
	string m_File;
	//! m_File with a home folder replaced (EMCP_WB_Guard.ScrubHome)
	string m_Shown;
	//! project-relative, forward slashes; "" when the file is not the project's
	string m_Rel;
	//! the file passed EMCP_WB_Guard.TargetExistsInProject
	bool m_InProject;
	//! why m_InProject is false
	string m_Why;
}

//! Static helpers of the Script Editor handler that take neither the request nor the response.
class EMCP_WB_ScriptEditorUtil
{
	static const int PAGE_DEFAULT = 100;
	static const int PAGE_MAX = 200;
	//! replaceRange: lines replaced, and new lines, at most
	static const int RANGE_MAX = 200;
	static const int SYMBOL_MAX = 256;
	static const string LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	static const string LINK_PREFIX = "enfusion://ScriptEditor/";

	//------------------------------------------------------------------------------------------------
	//! The page window of getLines: cursor "<start>:<count>" (count must be the current total, else
	//! STALE_CURSOR) wins over start; without a cursor the page begins at start (0 <= start <= total).
	//! limit <= 0 is PAGE_DEFAULT, above PAGE_MAX is PAGE_MAX. False with code and why on a bad
	//! cursor or start.
	static bool PageWindow(string cursor, int startLine, int limit, int total, out int first, out int stop, out string code, out string why)
	{
		first = 0;
		stop = 0;
		code = "";
		why = "";
		int size = limit;
		if (size <= 0)
			size = PAGE_DEFAULT;
		if (size > PAGE_MAX)
			size = PAGE_MAX;

		if (cursor != "")
		{
			array<string> parts = {};
			cursor.Split(":", parts, false);
			int at = 0;
			int issued = 0;
			if (parts.Count() != 2 || !EMCP_WB_Common.ParseInt(parts.Get(0), at) || !EMCP_WB_Common.ParseInt(parts.Get(1), issued) || at < 0 || issued < 0)
			{
				code = "INVALID_ARGUMENT";
				why = "cursor is not one this handler answered ('<start>:<count>'): " + cursor;
				return false;
			}
			if (issued != total || at > total)
			{
				code = "STALE_CURSOR";
				why = "the file's line count changed since the cursor was issued (count " + issued.ToString() + ", now " + total.ToString() + ")";
				return false;
			}
			first = at;
		}
		else
		{
			if (startLine < 0 || startLine > total)
			{
				code = "INVALID_ARGUMENT";
				why = "start " + startLine.ToString() + " is out of range (valid 0.." + total.ToString() + ", the file has " + total.ToString() + " lines)";
				return false;
			}
			first = startLine;
		}

		stop = first + size;
		if (stop > total)
			stop = total;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The nextCursor of a page that ends at stop: "" on the last page.
	static string NextCursor(int stop, int total)
	{
		if (stop >= total)
			return "";
		return stop.ToString() + ":" + total.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! True when a text holds a line break: one line's text never does.
	static bool HasBreak(string s)
	{
		return s.Contains("\n") || s.Contains("\r");
	}

	//------------------------------------------------------------------------------------------------
	//! A script identifier: a letter or '_' first, then letters, digits or '_'.
	static bool IsIdentifier(string s)
	{
		if (s == "")
			return false;
		if (s.IsDigitAt(0))
			return false;
		for (int i = 0; i < s.Length(); i++)
		{
			if (s.IsDigitAt(i))
				continue;
			string ch = s.Get(i);
			if (ch == "_" || LETTERS.Contains(ch))
				continue;
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! jump's symbol: "Class" or "Class.Member", identifiers only. className answers the class part.
	static bool ValidSymbol(string symbol, out string className, out string why)
	{
		className = "";
		why = "";
		if (symbol == "" || symbol.Length() > SYMBOL_MAX)
		{
			why = "symbol must be 1 to " + SYMBOL_MAX.ToString() + " characters";
			return false;
		}
		array<string> parts = {};
		symbol.Split(".", parts, false);
		if (parts.Count() < 1 || parts.Count() > 2)
		{
			why = "symbol must be Class or Class.Member: " + symbol;
			return false;
		}
		foreach (string part : parts)
		{
			if (!IsIdentifier(part))
			{
				why = "'" + part + "' is not a script identifier in the symbol " + symbol;
				return false;
			}
		}
		className = parts.Get(0);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True when a clean relative path resolves to an existing file under a loaded addon's
	//! file-system prefix (Workbench.GetAbsolutePath with mustExist true: no file method is called,
	//! FileIO.FileExists prompts without -scriptAuthorizeAll, DEC-053).
	static bool ResolvesInAnyAddon(string clean)
	{
		array<string> addons = {};
		GameProject.GetLoadedAddons(addons);
		for (int i = 0; i < addons.Count(); i++)
		{
			string id = GameProject.GetAddonID(addons.Get(i));
			if (id == "")
				continue;
			string abs = "";
			if (Workbench.GetAbsolutePath("$" + id + ":" + clean, abs, true))
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! Reads the active file into doc: GetCurrentFile, then the project classification.
	static void ReadDoc(ScriptEditor se, notnull EMCP_WB_ScriptEditorDoc doc)
	{
		doc.m_Opened = false;
		doc.m_File = "";
		doc.m_Shown = "";
		doc.m_Rel = "";
		doc.m_InProject = false;
		doc.m_Why = "";
		if (!se)
		{
			doc.m_Why = "the Script Editor is not open";
			return;
		}
		string current = "";
		doc.m_Opened = se.GetCurrentFile(current);
		doc.m_File = current;
		doc.m_Shown = EMCP_WB_Guard.ScrubHome(current);
		if (!doc.m_Opened || current == "")
		{
			doc.m_Opened = false;
			doc.m_Why = "no file is open in the Script Editor";
			return;
		}
		ClassifyFile(current, doc);
	}

	//------------------------------------------------------------------------------------------------
	//! Whether the active file is a file of the open project (P-W3-01: the path form GetCurrentFile
	//! gives is not yet proven, so each form is classified and only a proven-inside one passes):
	//!   "$<projectId>:<rel>"   rel, which must pass TargetExistsInProject
	//!   "$<other>:<rel>"       another addon's file: not the project's
	//!   absolute               inside the project's folder, and TargetExistsInProject of its relative
	//!                          part must resolve to the same file
	//!   relative               must pass TargetExistsInProject: a project file of that path shadows
	//!                          the game's in the merged file system, so it is the one the editor opened
	//! Anything else (a ':' that is no file-system prefix, a '.' or '..' segment) is not the project's.
	static void ClassifyFile(string file, notnull EMCP_WB_ScriptEditorDoc doc)
	{
		doc.m_Rel = "";
		doc.m_InProject = false;
		doc.m_Why = "";
		string addonId = "";
		string projectDir = "";
		string why = "";
		if (!EMCP_WB_Guard.Project(addonId, projectDir, why))
		{
			doc.m_Why = why;
			return;
		}

		string s = file;
		s.Replace("\\", "/");
		string folded = EMCP_WB_Guard.Fold(s);
		string prefix = EMCP_WB_Guard.Fold("$" + addonId + ":");
		string rel = "";
		bool absoluteForm = false;
		if (folded.StartsWith(prefix))
		{
			rel = s.Substring(prefix.Length(), s.Length() - prefix.Length());
		}
		else if (s.StartsWith("$"))
		{
			doc.m_Why = "the file is under another addon's file-system prefix, not the project " + addonId;
			return;
		}
		else if (FilePath.IsAbsolutePath(s))
		{
			if (!EMCP_WB_Guard.IsUnder(s, projectDir))
			{
				doc.m_Why = "the file is outside the project's folder";
				return;
			}
			string dir = projectDir;
			dir.Replace("\\", "/");
			if (dir.EndsWith("/"))
				dir = dir.Substring(0, dir.Length() - 1);
			rel = s.Substring(dir.Length() + 1, s.Length() - dir.Length() - 1);
			absoluteForm = true;
		}
		else
		{
			rel = s;
		}

		string abs = "";
		string guardWhy = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(rel, abs, guardWhy))
		{
			doc.m_Why = guardWhy;
			return;
		}
		if (absoluteForm && EMCP_WB_Guard.Fold(abs) != folded)
		{
			doc.m_Why = "the project resolves " + rel + " to another file than the one open";
			return;
		}
		doc.m_Rel = rel;
		doc.m_InProject = true;
	}
}

class EMCP_WB_ScriptEditor : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string PATH_NOT_FOUND = "PATH_NOT_FOUND";
	static const string MODULE_NOT_OPEN = "MODULE_NOT_OPEN";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string ITEM_NOT_FOUND = "ITEM_NOT_FOUND";
	static const string GATED = "GATED";
	//! Proposed by the W3 spec section 1 (main owns vocabulary.ts).
	static const string NO_DOCUMENT = "NO_DOCUMENT";
	static const string TEXT_CHANGED = "TEXT_CHANGED";
	static const string OPEN_NEXT = "open a script (wb_script_editor open)";
	static const string READ_NEXT = "read the lines again (wb_script_editor getLines)";
	static const string SAVE_WARNING = "Save may also write other open tabs with unsaved edits (probe P-W3-03 is not yet run)";
	static const string SAVE_NEXT = "save it by hand in the Script Editor (File > Save All, Ctrl+S), or write the file offline while it is not open";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ScriptEditorRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ScriptEditorRequest req = EMCP_WB_ScriptEditorRequest.Cast(request);
		EMCP_WB_ScriptEditorResponse resp = new EMCP_WB_ScriptEditorResponse();
		if (!req)
		{
			Refuse(resp, INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "state")
			ReadState(resp);
		else if (req.action == "getLines")
			ReadLines(req, resp);
		else if (req.action == "open")
			OpenScript(req, resp);
		else if (req.action == "jump")
			JumpTo(req, resp);
		else if (req.action == "setLine")
			SetOne(req, resp);
		else if (req.action == "insertLine")
			InsertOne(req, resp);
		else if (req.action == "removeLine")
			RemoveOne(req, resp);
		else if (req.action == "replaceRange")
			ReplaceLines(req, resp);
		else if (req.action == "save")
			SaveFile(req, resp);
		else if (req.action == "close")
			CloseEditor(resp);
		else
			Refuse(resp, INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of state, getLines, open, jump, setLine, insertLine, removeLine, replaceRange, save, close");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_ScriptEditorResponse resp, string status, string code, string text, string nextStep)
	{
		resp.status = status;
		resp.code = code;
		resp.next = nextStep;
		if (code == "")
			resp.message = text;
		else
			resp.message = EMCP_WB_Guard.RefusalMessage(code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! A refusal: status refused (EMCP_WB_Guard.REFUSED).
	protected static void Refuse(EMCP_WB_ScriptEditorResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The Script Editor, or null with the refusal written. GetModule opens a closed Script Editor
	//! (DEC-053): mayHaveOpened.
	protected static ScriptEditor Editor(EMCP_WB_ScriptEditorResponse resp)
	{
		resp.mayHaveOpened = true;
		ScriptEditor se = Workbench.GetModule(ScriptEditor);
		if (!se)
		{
			Refuse(resp, MODULE_NOT_OPEN, "the Script Editor is not open: GetModule returned null", "wb_module open ScriptEditor");
			return null;
		}
		return se;
	}

	//------------------------------------------------------------------------------------------------
	//! The Script Editor with a file open, doc read; null with the refusal written (NO_DOCUMENT when
	//! no file is open).
	protected static ScriptEditor OpenDoc(EMCP_WB_ScriptEditorResponse resp, notnull EMCP_WB_ScriptEditorDoc doc)
	{
		ScriptEditor se = Editor(resp);
		if (!se)
			return null;
		EMCP_WB_ScriptEditorUtil.ReadDoc(se, doc);
		resp.file = doc.m_Shown;
		if (!doc.m_Opened)
		{
			Refuse(resp, NO_DOCUMENT, "no file is open in the Script Editor", OPEN_NEXT);
			return null;
		}
		return se;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of a line edit or a save (spec section 1, projectOnly), in order: the project is
	//! found (DEC-058), the Script Editor has a file open, that file is the project's
	//! (TargetExistsInProject, P-W3-01). Answers the editor, or null with the refusal written.
	protected static ScriptEditor EditDoc(EMCP_WB_ScriptEditorResponse resp, notnull EMCP_WB_ScriptEditorDoc doc)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "line edits and save need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return null;
		}
		ScriptEditor se = OpenDoc(resp, doc);
		if (!se)
			return null;
		if (!doc.m_InProject)
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "the open file is not a file of the open project (" + doc.m_Why + "); nothing was changed", "copy the script into the project and open the copy");
			return null;
		}
		return se;
	}

	//------------------------------------------------------------------------------------------------
	//! state: the active file, the caret line and the line count; inProject and relPath from the
	//! project classification. No file open is an ok answer with opened false.
	static void ReadState(EMCP_WB_ScriptEditorResponse resp)
	{
		ScriptEditor se = Editor(resp);
		if (!se)
			return;
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		EMCP_WB_ScriptEditorUtil.ReadDoc(se, doc);
		resp.opened = doc.m_Opened;
		resp.file = doc.m_Shown;
		if (!doc.m_Opened)
		{
			Answer(resp, "ok", "", "no file is open in the Script Editor", "");
			return;
		}
		resp.relPath = doc.m_Rel;
		resp.inProject = doc.m_InProject;
		int caret = se.GetCurrentLine();
		resp.line = caret;
		resp.linesCount = se.GetLinesCount();
		// The line base of the link is not yet proven (spec section 2, "the base of the link line").
		if (doc.m_Rel != "")
			resp.link = EMCP_WB_ScriptEditorUtil.LINK_PREFIX + doc.m_Rel + ";" + caret.ToString();
		string where = "outside the project (" + doc.m_Why + ")";
		if (doc.m_InProject)
			where = "in the project";
		Answer(resp, "ok", "", doc.m_Shown + ": " + resp.linesCount.ToString() + " lines, caret on line " + caret.ToString() + ", " + where, "");
	}

	//------------------------------------------------------------------------------------------------
	//! getLines: the active file's lines, paged; rows are the line texts in order, from line start.
	static void ReadLines(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		ScriptEditor se = OpenDoc(resp, doc);
		if (!se)
			return;
		int lineTotal = se.GetLinesCount();
		resp.total = lineTotal;
		int first = 0;
		int stop = 0;
		string pageCode = "";
		string why = "";
		if (!EMCP_WB_ScriptEditorUtil.PageWindow(req.cursor, req.start, req.limit, lineTotal, first, stop, pageCode, why))
		{
			Refuse(resp, pageCode, why, READ_NEXT);
			return;
		}
		resp.start = first;
		for (int i = first; i < stop; i++)
		{
			string lineText = "";
			if (!se.GetLineText(lineText, i))
			{
				resp.rows.Clear();
				Answer(resp, "error", ENGINE_FALSE, "GetLineText returned false for line " + i.ToString() + " of " + lineTotal.ToString(), READ_NEXT);
				return;
			}
			resp.rows.Insert(lineText);
		}
		resp.nextCursor = EMCP_WB_ScriptEditorUtil.NextCursor(stop, lineTotal);
		int last = stop - 1;
		Answer(resp, "ok", "", "lines " + first.ToString() + " to " + last.ToString() + " of " + lineTotal.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! open: a clean relative .c path that resolves under a loaded addon, opened in the Script
	//! Editor (SetOpenedResource; OpenModule first when GetModule answers null). No project test:
	//! opening is not a write. The Script Editor opens a file in its own tab, so no other open
	//! document is replaced.
	static void OpenScript(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		string clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(req.path, clean, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass a relative script path, no drive, prefix, '.' or '..'");
			return;
		}
		string lower = clean;
		lower.ToLower();
		if (!lower.EndsWith(".c"))
		{
			Refuse(resp, INVALID_ARGUMENT, "path is not a .c script: " + clean, "open other resources with wb_module setResource");
			return;
		}
		if (!EMCP_WB_ScriptEditorUtil.ResolvesInAnyAddon(clean))
		{
			Refuse(resp, PATH_NOT_FOUND, "no loaded addon holds " + clean + "; nothing was opened", "check the path (wb_resources or script_analyze)");
			return;
		}

		resp.mayHaveOpened = true;
		ScriptEditor se = Workbench.GetModule(ScriptEditor);
		if (!se)
		{
			Workbench.OpenModule(ScriptEditor);
			se = Workbench.GetModule(ScriptEditor);
		}
		if (!se)
		{
			Refuse(resp, MODULE_NOT_OPEN, "the Script Editor did not open: OpenModule and GetModule answered no module", "wb_module open ScriptEditor");
			return;
		}

		bool opened = se.SetOpenedResource(clean);
		resp.result = opened;
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		EMCP_WB_ScriptEditorUtil.ReadDoc(se, doc);
		resp.file = doc.m_Shown;
		resp.relPath = doc.m_Rel;
		resp.inProject = doc.m_InProject;
		if (doc.m_Opened)
			resp.linesCount = se.GetLinesCount();
		if (!opened)
		{
			Answer(resp, "error", ENGINE_FALSE, "SetOpenedResource returned false for " + clean, OPEN_NEXT);
			return;
		}
		Answer(resp, "ok", "", "opened " + clean + " in the Script Editor", "");
	}

	//------------------------------------------------------------------------------------------------
	//! jump: Workbench.JumpToScriptSymbol on "Class" or "Class.Member". The class must exist as a
	//! script type (string.ToType) before the call: a miss is refused ITEM_NOT_FOUND and the engine is
	//! not asked (what it does on a miss is probe P-W3-05). Then the file and caret it shows.
	static void JumpTo(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		string className = "";
		string why = "";
		if (!EMCP_WB_ScriptEditorUtil.ValidSymbol(req.symbol, className, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass Class or Class.Member");
			return;
		}
		typename symbolType = className.ToType();
		if (!symbolType)
		{
			Refuse(resp, ITEM_NOT_FOUND, "no script class " + className + " is loaded; nothing was sent", "check the class name (api_search)");
			return;
		}

		// JumpToScriptSymbol itself opens or focuses the Script Editor (review S1).
		resp.mayHaveOpened = true;
		bool jumped = Workbench.JumpToScriptSymbol(req.symbol);
		resp.result = jumped;
		if (!jumped)
		{
			Answer(resp, "error", ENGINE_FALSE, "JumpToScriptSymbol returned false for " + req.symbol, "check the member name (api_search)");
			return;
		}
		ScriptEditor se = Editor(resp);
		if (!se)
			return;
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		EMCP_WB_ScriptEditorUtil.ReadDoc(se, doc);
		resp.file = doc.m_Shown;
		resp.relPath = doc.m_Rel;
		if (doc.m_Opened)
			resp.line = se.GetCurrentLine();
		Answer(resp, "ok", "", "jumped to " + req.symbol + ": " + doc.m_Shown + " line " + resp.line.ToString(), "");
	}

	//------------------------------------------------------------------------------------------------
	//! setLine: line 0..linesCount-1 of the project's open file; before, SetLineText, read back.
	static void SetOne(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		ScriptEditor se = EditDoc(resp, doc);
		if (!se)
			return;
		int lineCount = se.GetLinesCount();
		resp.linesCount = lineCount;
		resp.line = req.line;
		int maxLine = lineCount - 1;
		if (req.line < 0 || req.line > maxLine)
		{
			Refuse(resp, INVALID_ARGUMENT, "line " + req.line.ToString() + " is out of range for setLine (valid 0.." + maxLine.ToString() + ", the file has " + lineCount.ToString() + " lines; lines are 0-based)", READ_NEXT);
			return;
		}
		if (EMCP_WB_ScriptEditorUtil.HasBreak(req.text))
		{
			Refuse(resp, INVALID_ARGUMENT, "text holds a line break; one line is set at a time", "use replaceRange for several lines");
			return;
		}

		string oldText = "";
		if (!se.GetLineText(oldText, req.line))
		{
			Answer(resp, "error", ENGINE_FALSE, "GetLineText returned false for line " + req.line.ToString() + "; nothing was changed", READ_NEXT);
			return;
		}
		resp.before = oldText;

		se.SetLineText(req.text, req.line);

		string readback = "";
		bool got = se.GetLineText(readback, req.line);
		resp.after = readback;
		int countAfter = se.GetLinesCount();
		resp.linesCount = countAfter;
		if (!got || readback != req.text || countAfter != lineCount)
		{
			Answer(resp, "error", ENGINE_FALSE, "SetLineText did not apply on line " + req.line.ToString() + " (read back differs, or the line count changed " + lineCount.ToString() + " -> " + countAfter.ToString() + "); before holds the old text", READ_NEXT);
			return;
		}
		Answer(resp, "ok", "", "line " + req.line.ToString() + " set (not saved)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! insertLine: a line before line 0..linesCount (linesCount appends) of the project's open file;
	//! read back the count and the new line (P-W3-02).
	static void InsertOne(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		ScriptEditor se = EditDoc(resp, doc);
		if (!se)
			return;
		int lineCount = se.GetLinesCount();
		resp.linesCount = lineCount;
		resp.line = req.line;
		int maxLine = lineCount;
		if (req.line < 0 || req.line > maxLine)
		{
			Refuse(resp, INVALID_ARGUMENT, "line " + req.line.ToString() + " is out of range for insertLine (valid 0.." + maxLine.ToString() + ", the file has " + lineCount.ToString() + " lines; lines are 0-based)", READ_NEXT);
			return;
		}
		if (EMCP_WB_ScriptEditorUtil.HasBreak(req.text))
		{
			Refuse(resp, INVALID_ARGUMENT, "text holds a line break; one line is inserted at a time", "use replaceRange for several lines");
			return;
		}

		se.InsertLine(req.text, req.line);

		int countAfter = se.GetLinesCount();
		resp.linesCount = countAfter;
		string readback = "";
		bool got = se.GetLineText(readback, req.line);
		resp.after = readback;
		if (countAfter != lineCount + 1 || !got || readback != req.text)
		{
			Answer(resp, "error", ENGINE_FALSE, "InsertLine did not apply at line " + req.line.ToString() + " (line count " + lineCount.ToString() + " -> " + countAfter.ToString() + ", or the read back differs)", READ_NEXT);
			return;
		}
		Answer(resp, "ok", "", "line inserted at " + req.line.ToString() + " (not saved)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! removeLine: line 0..linesCount-1 of the project's open file; before, RemoveLine, count read
	//! back (P-W3-02). The only line of a file is not removed.
	static void RemoveOne(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		ScriptEditor se = EditDoc(resp, doc);
		if (!se)
			return;
		int lineCount = se.GetLinesCount();
		resp.linesCount = lineCount;
		resp.line = req.line;
		int maxLine = lineCount - 1;
		if (req.line < 0 || req.line > maxLine)
		{
			Refuse(resp, INVALID_ARGUMENT, "line " + req.line.ToString() + " is out of range for removeLine (valid 0.." + maxLine.ToString() + ", the file has " + lineCount.ToString() + " lines; lines are 0-based)", READ_NEXT);
			return;
		}
		if (lineCount < 2)
		{
			Refuse(resp, INVALID_ARGUMENT, "the file's only line is not removed", "set it to an empty text with setLine");
			return;
		}

		string oldText = "";
		if (!se.GetLineText(oldText, req.line))
		{
			Answer(resp, "error", ENGINE_FALSE, "GetLineText returned false for line " + req.line.ToString() + "; nothing was changed", READ_NEXT);
			return;
		}
		resp.before = oldText;

		se.RemoveLine(req.line);

		int countAfter = se.GetLinesCount();
		resp.linesCount = countAfter;
		if (countAfter != lineCount - 1)
		{
			Answer(resp, "error", ENGINE_FALSE, "RemoveLine did not apply on line " + req.line.ToString() + " (line count " + lineCount.ToString() + " -> " + countAfter.ToString() + ")", READ_NEXT);
			return;
		}
		Answer(resp, "ok", "", "line " + req.line.ToString() + " removed (not saved); before holds its text", "");
	}

	//------------------------------------------------------------------------------------------------
	//! replaceRange: count lines from start replaced by lines, in the project's open file. Every
	//! argument is checked before any edit; expected, when given, must match the current lines
	//! (else TEXT_CHANGED). removed answers the old lines, rows the new lines read back.
	static void ReplaceLines(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		ScriptEditor se = EditDoc(resp, doc);
		if (!se)
			return;
		int lineTotal = se.GetLinesCount();
		resp.linesCount = lineTotal;
		resp.start = req.start;
		int replaced = req.count;
		int newCount = 0;
		if (req.lines)
			newCount = req.lines.Count();
		int expectedCount = 0;
		if (req.expected)
			expectedCount = req.expected.Count();

		if (req.start < 0 || req.start > lineTotal)
		{
			Refuse(resp, INVALID_ARGUMENT, "start " + req.start.ToString() + " is out of range (valid 0.." + lineTotal.ToString() + ", the file has " + lineTotal.ToString() + " lines; lines are 0-based)", READ_NEXT);
			return;
		}
		if (replaced < 0 || req.start + replaced > lineTotal)
		{
			Refuse(resp, INVALID_ARGUMENT, "count " + replaced.ToString() + " from start " + req.start.ToString() + " is out of range (the file has " + lineTotal.ToString() + " lines)", READ_NEXT);
			return;
		}
		if (replaced == 0 && newCount == 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "count is 0 and lines is empty: nothing to replace", "pass count, lines or both");
			return;
		}
		if (replaced > EMCP_WB_ScriptEditorUtil.RANGE_MAX || newCount > EMCP_WB_ScriptEditorUtil.RANGE_MAX)
		{
			Refuse(resp, INVALID_ARGUMENT, "at most " + EMCP_WB_ScriptEditorUtil.RANGE_MAX.ToString() + " lines are replaced and given per call", "split the edit");
			return;
		}
		if (lineTotal - replaced + newCount < 1)
		{
			Refuse(resp, INVALID_ARGUMENT, "the edit would leave the file without a line", "keep at least one line");
			return;
		}
		for (int n = 0; n < newCount; n++)
		{
			if (EMCP_WB_ScriptEditorUtil.HasBreak(req.lines.Get(n)))
			{
				Refuse(resp, INVALID_ARGUMENT, "lines[" + n.ToString() + "] holds a line break; pass one entry per line", "split the text at its line breaks");
				return;
			}
		}
		if (expectedCount > 0 && expectedCount != replaced)
		{
			Refuse(resp, INVALID_ARGUMENT, "expected holds " + expectedCount.ToString() + " lines, count is " + replaced.ToString(), "pass the current text of the replaced lines, one entry per line");
			return;
		}

		for (int r = 0; r < replaced; r++)
		{
			string oldText = "";
			int oldLine = req.start + r;
			if (!se.GetLineText(oldText, oldLine))
			{
				Answer(resp, "error", ENGINE_FALSE, "GetLineText returned false for line " + oldLine.ToString() + "; nothing was changed", READ_NEXT);
				return;
			}
			resp.removed.Insert(oldText);
		}
		for (int e = 0; e < expectedCount; e++)
		{
			if (req.expected.Get(e) != resp.removed.Get(e))
			{
				int changedLine = req.start + e;
				Refuse(resp, TEXT_CHANGED, "line " + changedLine.ToString() + " is not the expected text; nothing was changed", READ_NEXT);
				return;
			}
		}

		int overlap = replaced;
		if (newCount < overlap)
			overlap = newCount;
		for (int s = 0; s < overlap; s++)
			se.SetLineText(req.lines.Get(s), req.start + s);
		for (int a = overlap; a < newCount; a++)
			se.InsertLine(req.lines.Get(a), req.start + a);
		for (int d = overlap; d < replaced; d++)
			se.RemoveLine(req.start + overlap);

		int countAfter = se.GetLinesCount();
		resp.linesCount = countAfter;
		int countWanted = lineTotal - replaced + newCount;
		bool same = (countAfter == countWanted);
		for (int b = 0; b < newCount && same; b++)
		{
			string readback = "";
			if (!se.GetLineText(readback, req.start + b))
				same = false;
			resp.rows.Insert(readback);
			if (readback != req.lines.Get(b))
				same = false;
		}
		if (!same)
		{
			Answer(resp, "error", ENGINE_FALSE, "the replacement did not read back as sent (line count " + lineTotal.ToString() + " -> " + countAfter.ToString() + "); removed holds the old lines", READ_NEXT);
			return;
		}
		Answer(resp, "ok", "", replaced.ToString() + " lines from line " + req.start.ToString() + " replaced by " + newCount.ToString() + " (not saved); removed holds the old lines", "");
	}

	//------------------------------------------------------------------------------------------------
	//! save: the project's open file. Without confirm a dry run that names the file and writes
	//! nothing; with confirm WBModuleDef.Save. Which tabs Save writes is probe P-W3-03: warned.
	static void SaveFile(EMCP_WB_ScriptEditorRequest req, EMCP_WB_ScriptEditorResponse resp)
	{
		EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc();
		ScriptEditor se = EditDoc(resp, doc);
		if (!se)
			return;
		resp.relPath = doc.m_Rel;
		resp.warnings.Insert(SAVE_WARNING);
		if (!req.confirm)
		{
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: would save " + doc.m_Rel + "; nothing was written; pass confirm true to save", "");
			return;
		}

		bool written = se.Save();
		resp.dryRun = false;
		resp.saved = written;
		// W3 run 3: Save returned false for every script under _throwaway/W3/ (outside every script
		// module folder, not registered), edited or not, with the tab current, and wrote nothing; the
		// log said nothing. Whether it saves a script inside a script module is not proven.
		if (!written)
		{
			Answer(resp, "error", ENGINE_FALSE, "Save returned false for " + doc.m_Rel + "; nothing was written and the tab keeps its edits (W3 run 3: false for every script outside the script module folders, edited or not)", SAVE_NEXT);
			return;
		}
		Answer(resp, "ok", "", "saved " + doc.m_Rel, "");
	}

	//------------------------------------------------------------------------------------------------
	//! close: GATED (W3 OD-3, DEC-063). No call tells whether a tab holds unsaved edits, and what
	//! Close does over them (a prompt or a discard) is probe P-W3-04. No engine call is made.
	static void CloseEditor(EMCP_WB_ScriptEditorResponse resp)
	{
		resp.closed = false;
		resp.dryRun = true;
		Refuse(resp, GATED, "close waits for probe P-W3-04 (W3 OD-3, DEC-063): no call tells whether a tab holds unsaved edits, and Close over them may prompt or discard them; nothing was sent", "the owner closes the Script Editor by hand");
	}
}
