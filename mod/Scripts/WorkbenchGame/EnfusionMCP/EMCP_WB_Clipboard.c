/**
 * EMCP_WB_Clipboard.c - Clipboard operations handler
 *
 * Actions: copy, cut, paste, pasteAtCursor, duplicate, hasCopied
 * All operate on the current editor selection.
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Clipboard"
 */

class EMCP_WB_ClipboardRequest : JsonApiStruct
{
	string action;

	void EMCP_WB_ClipboardRequest()
	{
		RegV("action");
	}
}

class EMCP_WB_ClipboardResponse : JsonApiStruct
{
	string status;
	string message;
	string action;
	bool result;

	void EMCP_WB_ClipboardResponse()
	{
		RegV("status");
		RegV("message");
		RegV("action");
		RegV("result");
	}
}

class EMCP_WB_Clipboard : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ClipboardRequest();
	}

	//------------------------------------------------------------------------------------------------
	// Mutating clipboard operations: a false return is a failure, not a success with a note.
	static void SetResult(EMCP_WB_ClipboardResponse resp, bool result, string okMsg, string failMsg)
	{
		resp.result = result;
		if (result)
		{
			resp.status = "ok";
			resp.message = okMsg;
		}
		else
		{
			resp.status = "error";
			resp.message = failMsg;
		}
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ClipboardRequest req = EMCP_WB_ClipboardRequest.Cast(request);
		EMCP_WB_ClipboardResponse resp = new EMCP_WB_ClipboardResponse();
		resp.action = req.action;

		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			resp.status = "error";
			resp.message = "WorldEditor module not available";
			return resp;
		}

		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			resp.status = "error";
			resp.message = "WorldEditorAPI not available";
			return resp;
		}

		if (req.action == "copy")
		{
			SetResult(resp, api.CopySelectedEntities(), "Selected entities copied", "CopySelectedEntities returned false (nothing selected?)");
		}
		else if (req.action == "cut")
		{
			SetResult(resp, api.CutSelectedEntities(), "Selected entities cut", "CutSelectedEntities returned false (nothing selected?)");
		}
		else if (req.action == "paste")
		{
			SetResult(resp, api.PasteEntities(), "Entities pasted at original position", "PasteEntities returned false (nothing copied?)");
		}
		else if (req.action == "pasteAtCursor")
		{
			SetResult(resp, api.PasteEntitiesAtMouseCursorPos(), "Entities pasted at mouse cursor position", "PasteEntitiesAtMouseCursorPos returned false (nothing copied, or cursor not over the viewport?)");
		}
		else if (req.action == "duplicate")
		{
			SetResult(resp, api.DuplicateSelectedEntities(), "Selected entities duplicated", "DuplicateSelectedEntities returned false (nothing selected?)");
		}
		else if (req.action == "hasCopied")
		{
			// Query, not a mutation: an empty clipboard is a valid answer, not an error.
			resp.result = api.HasCopiedEntities();
			resp.status = "ok";
			if (resp.result)
				resp.message = "Clipboard has copied entities";
			else
				resp.message = "Clipboard is empty";
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: copy, cut, paste, pasteAtCursor, duplicate, hasCopied";
		}

		return resp;
	}
}
