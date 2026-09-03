/**
 * EMCP_WB_ScriptEditor.c - Script editor operations handler
 *
 * Actions: getCurrentFile, getLine, setLine, insertLine, removeLine, getLinesCount, openFile
 * Uses the ScriptEditor Workbench module.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_ScriptEditor"
 *
 * SetLineText / InsertLine / RemoveLine are void in the API (line=-1 means "current line").
 * This handler requires an explicit line >= 0, bounds-checks it against GetLinesCount(), and
 * verifies the edit afterwards (readback / line-count delta) so a no-op is reported as an error.
 */

class EMCP_WB_ScriptEditorRequest : JsonApiStruct
{
	string action;
	int line;
	string text;
	string path;

	void EMCP_WB_ScriptEditorRequest()
	{
		RegV("action");
		RegV("line");
		RegV("text");
		RegV("path");
		line = -1;
	}
}

class EMCP_WB_ScriptEditorResponse : JsonApiStruct
{
	string status;
	string message;
	string action;
	string currentFile;
	int currentLine;
	int linesCount;
	string lineText;

	void EMCP_WB_ScriptEditorResponse()
	{
		RegV("status");
		RegV("message");
		RegV("action");
		RegV("currentFile");
		RegV("currentLine");
		RegV("linesCount");
		RegV("lineText");
	}
}

class EMCP_WB_ScriptEditor : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ScriptEditorRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ScriptEditorRequest req = EMCP_WB_ScriptEditorRequest.Cast(request);
		EMCP_WB_ScriptEditorResponse resp = new EMCP_WB_ScriptEditorResponse();
		resp.action = req.action;

		ScriptEditor scriptEditor = Workbench.GetModule(ScriptEditor);
		if (!scriptEditor)
		{
			resp.status = "error";
			resp.message = "ScriptEditor module not available";
			return resp;
		}

		if (req.action == "getCurrentFile")
		{
			string filename;
			bool result = scriptEditor.GetCurrentFile(filename);
			if (result)
			{
				resp.currentFile = filename;
				resp.currentLine = scriptEditor.GetCurrentLine();
				resp.linesCount = scriptEditor.GetLinesCount();
				resp.status = "ok";
				resp.message = "Current file: " + filename;
			}
			else
			{
				resp.status = "error";
				resp.message = "No file currently open in script editor";
			}
		}
		else if (req.action == "getLine")
		{
			string lineText;
			bool result = scriptEditor.GetLineText(lineText, req.line);
			if (result)
			{
				resp.lineText = lineText;
				resp.status = "ok";
				resp.message = "Line " + req.line.ToString() + " retrieved";
			}
			else
			{
				resp.status = "error";
				resp.message = "GetLineText returned false for line " + req.line.ToString() + " (no file open or line out of range)";
			}
		}
		else if (req.action == "setLine" || req.action == "insertLine" || req.action == "removeLine")
		{
			string openFile;
			if (!scriptEditor.GetCurrentFile(openFile))
			{
				resp.status = "error";
				resp.message = "No file currently open in script editor - open one first (openFile)";
				return resp;
			}

			int lineCount = scriptEditor.GetLinesCount();
			resp.currentFile = openFile;

			if (req.line < 0)
			{
				resp.status = "error";
				resp.message = "line parameter required (>= 0) for " + req.action + "; the -1 'current line' default is not accepted over NetAPI";
				return resp;
			}

			// setLine/removeLine target an existing line; insertLine may also target lineCount (append).
			int maxLine = lineCount - 1;
			if (req.action == "insertLine")
				maxLine = lineCount;

			if (req.line > maxLine)
			{
				resp.status = "error";
				resp.message = "line " + req.line.ToString() + " out of range for " + req.action + " (valid 0.." + maxLine.ToString() + ", file has " + lineCount.ToString() + " lines)";
				return resp;
			}

			if (req.action == "setLine")
			{
				scriptEditor.SetLineText(req.text, req.line);

				string readback;
				bool got = scriptEditor.GetLineText(readback, req.line);
				resp.linesCount = scriptEditor.GetLinesCount();
				resp.lineText = readback;
				if (got && readback == req.text)
				{
					resp.status = "ok";
					resp.message = "Line " + req.line.ToString() + " set";
				}
				else
				{
					resp.status = "error";
					resp.message = "SetLineText did not apply on line " + req.line.ToString() + " (readback differs from requested text)";
				}
			}
			else if (req.action == "insertLine")
			{
				scriptEditor.InsertLine(req.text, req.line);

				int after = scriptEditor.GetLinesCount();
				resp.linesCount = after;
				if (after == lineCount + 1)
				{
					resp.status = "ok";
					resp.message = "Line inserted at " + req.line.ToString();
				}
				else
				{
					resp.status = "error";
					resp.message = "InsertLine did not apply at " + req.line.ToString() + " (line count " + lineCount.ToString() + " -> " + after.ToString() + ")";
				}
			}
			else
			{
				string removedText;
				scriptEditor.GetLineText(removedText, req.line);
				scriptEditor.RemoveLine(req.line);

				int after = scriptEditor.GetLinesCount();
				resp.linesCount = after;
				if (after == lineCount - 1)
				{
					resp.lineText = removedText;
					resp.status = "ok";
					resp.message = "Line " + req.line.ToString() + " removed";
				}
				else
				{
					resp.status = "error";
					resp.message = "RemoveLine did not apply on line " + req.line.ToString() + " (line count " + lineCount.ToString() + " -> " + after.ToString() + ")";
				}
			}
		}
		else if (req.action == "getLinesCount")
		{
			resp.linesCount = scriptEditor.GetLinesCount();
			resp.status = "ok";
			resp.message = "Lines count: " + resp.linesCount.ToString();
		}
		else if (req.action == "openFile")
		{
			if (req.path == "")
			{
				resp.status = "error";
				resp.message = "path parameter required for openFile action";
				return resp;
			}

			bool result = scriptEditor.SetOpenedResource(req.path);
			if (result)
			{
				resp.status = "ok";
				resp.message = "Opened file: " + req.path;
			}
			else
			{
				resp.status = "error";
				resp.message = "SetOpenedResource returned false for: " + req.path;
			}
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: getCurrentFile, getLine, setLine, insertLine, removeLine, getLinesCount, openFile";
		}

		return resp;
	}
}
