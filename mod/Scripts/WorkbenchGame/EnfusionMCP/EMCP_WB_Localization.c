/**
 * EMCP_WB_Localization.c - The string table open in the Localization Editor (wave W3, wb_localization)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Localization", dispatching on "action"
 * (docs/v2/design/phase5-w3-spec.md section 2.2, KD-009). The table is the BaseContainer that
 * LocalizationEditor.GetTable answers; its items are the object array "Items" (BaseContainerList
 * Count/Get), each a CustomStringTableItem whose fields are the container's variables
 * (GetNumVars, GetVarName, GetDataVarType), read the way the Bohemia SCR_Loc* plugins read them.
 * The 1.x walk of GetNumChildren/GetChild and its invented columns (en_us, target, comment) are
 * gone. One action surface: the 1.x names (getTable, listLanguages, modify) are mapped by the
 * TypeScript tool, not here (DEC-061).
 *   status        the module, the open table, its root and item class, the Items count, the path
 *                 when it was opened through open; GetNumContainers/GetContainer(0) are read as the
 *                 evidence of probe P-W3-17 (no other route names the open file)
 *   columns       the first item's variables: name|type|NAME=n,... (GetEnumValues of an integer)
 *   list          item rows "index|field|...", Id prefix filter, paged
 *   get           one item (Id or Items index), every variable as name|type|value
 *   selection     GetSelectedRows and GetFilteredRows (row indices; same as Items indices is P-W3-15)
 *   open          OpenModule, then SetOpenedResource of a clean relative .st path (plain or {GUID})
 *   insert        BeginModify, InsertItem(id, true, true) (the 1.x form), ModifyProperty per field,
 *                 EndModify; read back
 *   set           ModifyProperty per field inside BeginModify/EndModify; before and after read back
 *   delete        snapshot, DeleteItem(Id) inside BeginModify/EndModify; read back
 *   filter        the Items indices whose column contains the text, AddUserFilter(rows, caption),
 *                 RefreshUI, GetFilteredRows (the engine's AddUserFilter takes row indices and a
 *                 caption, not a column and a text)
 *   save          WBModuleDef.Save of a table opened through open whose file is inside the project
 *                 (TargetExistsInProject); a dry run unless confirm is true
 *   buildRuntime  GATED (P-W3-18: the menu path is unverified and may open a dialog); the offline
 *                 string_table buildRuntime is the route (DEC-063 OD-2). Nothing is sent.
 *   close         GATED (P-W3-19: no call tells whether the table has unsaved edits, DEC-063 OD-3)
 *
 * Values (spec section 1): a string as is; an integer as its number (an enum by its number, or by
 * its name, which is turned into the number); a bool as true/false/1/0, sent as bool.ToString; an
 * array of int, bool or string comma-joined. Any other type refuses UNSUPPORTED_TYPE. Every write is
 * read back; a field that does not read back as sent answers ENGINE_FALSE.
 * Rows are "|"-joined; inside a value "\" is "\\", "|" is "\|", a line break "\n" and "\r".
 * Modal hazards (spec section 0): SCR_LocStatusPlugin.OnChange opens a dialog for an edit of
 * Target_en_us at any Status but DEVELOPMENT_PENDING and for a Target_en_us_edited that is not empty
 * and not "@@@"; such an edit refuses MODAL_HAZARD before any engine call. SCR_LocModifiedPlugin
 * writes the Workbench user name into Author and LastChanged of an edited item: insert, set and save
 * say so in warnings (DEC-063 OD-5); nothing here reads or blanks the name.
 * Documents: no call answers whether the open table has unsaved edits, and replacing a document with
 * unsaved edits opens an engine prompt (W1 lesson). The handler remembers the table it opened
 * (path, and the fingerprints "count|first Id|last Id" it had at open and after each own edit, so an
 * Edit > Undo or Redo of an own edit keeps it known) and its own edits
 * since that open or the last save: open refuses MODAL_HAZARD over its own unsaved edits and over a
 * table opened by hand; save refuses NO_DOCUMENT for a table it did not open. Edits made by hand in
 * the editor are not seen. Workbench.GetModule opens a closed Localization Editor.
 * Guards: reads none; insert, set, delete, filter act in memory on whatever table is open (no file
 * is written until save); save needs the project found and the file inside it (DEC-058).
 * Paging: cursor "<start>:<count>", count = the matched total; a changed total answers
 * STALE_CURSOR; limit default 50, max 200. Keys: contracts/EMCP_WB_Localization.json.
 */

class EMCP_WB_LocalizationRequest : JsonApiStruct
{
	string action;
	//! open: a clean relative .st path, plain or "{GUID}path"
	string path;
	//! get, set, delete: the item Id (or index); insert: the new item's Id
	string id;
	//! get, set, delete: the Items index; -1 (left out) = by id
	int index;
	//! list: the fields to show (default Id, Target_en_us); insert, set: the fields to write
	ref array<string> fields;
	//! insert, set: the encoded values, in the order of fields
	ref array<string> values;
	//! list: the Id prefix
	string prefix;
	//! filter: the field to match
	string column;
	//! filter: the text the field contains (case folded)
	string filter;
	//! list: nextCursor of the previous page
	string cursor;
	int limit;
	//! save: true saves; else a dry run
	bool confirm;

	void EMCP_WB_LocalizationRequest()
	{
		fields = {};
		values = {};

		RegV("action");
		RegV("path");
		RegV("id");
		RegV("index");
		RegV("fields");
		RegV("values");
		RegV("prefix");
		RegV("column");
		RegV("filter");
		RegV("cursor");
		RegV("limit");
		RegV("confirm");

		// Defaults for keys the request leaves out.
		index = -1;
		limit = 0;
		confirm = false;
	}
}

class EMCP_WB_LocalizationResponse : JsonApiStruct
{
	//! ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	//! the project-relative path, when the table was opened through open
	string table;
	bool inProject;
	string itemClass;
	int total;
	ref array<string> columns;
	ref array<string> rows;
	string nextCursor;
	string id;
	int index;
	//! open: what SetOpenedResource returned
	bool result;
	ref array<string> before;
	ref array<string> after;
	ref array<int> selected;
	ref array<int> filtered;
	bool dryRun;
	bool saved;
	bool built;
	bool closed;
	ref array<string> warnings;

	void EMCP_WB_LocalizationResponse()
	{
		columns = {};
		rows = {};
		before = {};
		after = {};
		selected = {};
		filtered = {};
		warnings = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("table");
		RegV("inProject");
		RegV("itemClass");
		RegV("total");
		RegV("columns");
		RegV("rows");
		RegV("nextCursor");
		RegV("id");
		RegV("index");
		RegV("result");
		RegV("before");
		RegV("after");
		RegV("selected");
		RegV("filtered");
		RegV("dryRun");
		RegV("saved");
		RegV("built");
		RegV("closed");
		RegV("warnings");

		index = -1;
	}
}

//! The open table, filled by EMCP_WB_Localization.FindDoc (a result object: no engine pointer travels
//! through an out parameter).
class EMCP_WB_LocalizationDoc
{
	LocalizationEditor m_Editor;
	BaseContainer m_Table;
	ref BaseContainerList m_Items;
}

//! One item found by Id or index (EMCP_WB_LocalizationUtil.Locate).
class EMCP_WB_LocalizationItem
{
	BaseContainer m_Item;
	int m_Index;
	string m_Id;
	string m_Code;
	string m_Why;

	//------------------------------------------------------------------------------------------------
	//! Nothing found: m_Item null, m_Index -1, the texts empty.
	void Reset()
	{
		// Through a local: the proven form (EMCP_WB_EntityRefResult.Reset).
		BaseContainer none = null;
		m_Item = none;
		m_Index = -1;
		m_Id = "";
		m_Code = "";
		m_Why = "";
	}
}

//! Static helpers of the Localization handler that take neither the request nor the response.
class EMCP_WB_LocalizationUtil
{
	static const int PAGE_DEFAULT = 50;
	static const int PAGE_MAX = 200;
	static const int FIELDS_MAX = 64;
	//! selection, filter: at most this many row indices are answered
	static const int ROWS_MAX = 1000;
	static const string VAR_ITEMS = "Items";
	static const string VAR_ID = "Id";
	static const string VAR_STATUS = "Status";
	static const string VAR_TARGET = "Target_en_us";
	static const string VAR_TARGET_EDITED = "Target_en_us_edited";
	//! The Target_en_us_edited value SCR_LocStatusPlugin reads as "no edit"
	static const string EDITED_NONE = "@@@";
	static const string STATUS_DEV_PENDING = "DEVELOPMENT_PENDING";
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string UNSUPPORTED_TYPE = "UNSUPPORTED_TYPE";
	static const string ITEM_NOT_FOUND = "ITEM_NOT_FOUND";
	static const string DUPLICATE_ID = "DUPLICATE_ID";

	//------------------------------------------------------------------------------------------------
	//! A value inside a "|"-joined row: "\" -> "\\", "|" -> "\|", line breaks -> "\n", "\r".
	static string Esc(string value)
	{
		string s = value;
		s.Replace("\\", "\\\\");
		s.Replace("|", "\\|");
		s.Replace("\n", "\\n");
		s.Replace("\r", "\\r");
		return s;
	}

	//------------------------------------------------------------------------------------------------
	//! "true" or "false".
	static string BoolText(bool value)
	{
		if (value)
			return "true";
		return "false";
	}

	//------------------------------------------------------------------------------------------------
	//! true, false, 1 or 0; false for any other text.
	static bool ParseBool(string text, out bool value)
	{
		value = false;
		if (text == "true" || text == "1")
		{
			value = true;
			return true;
		}
		return text == "false" || text == "0";
	}

	//------------------------------------------------------------------------------------------------
	//! The page window of a paged read: cursor "<start>:<count>" ("" = the first page), count must be
	//! the current total (else STALE_CURSOR). limit <= 0 is PAGE_DEFAULT, above PAGE_MAX is PAGE_MAX.
	static bool PageWindow(string cursor, int limit, int total, out int first, out int stop, out string code, out string why)
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
			int count = 0;
			if (parts.Count() != 2 || !EMCP_WB_Common.ParseInt(parts.Get(0), at) || !EMCP_WB_Common.ParseInt(parts.Get(1), count) || at < 0 || count < 0)
			{
				code = INVALID_ARGUMENT;
				why = "cursor is not one this handler answered ('<start>:<count>'): " + cursor;
				return false;
			}
			if (count != total || at > total)
			{
				code = "STALE_CURSOR";
				why = "the table changed since the cursor was issued (count " + count.ToString() + ", now " + total.ToString() + ")";
				return false;
			}
			first = at;
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
	//! The Id of an item, "" when it has none or the item is null.
	static string IdOf(BaseContainer item)
	{
		string itemId = "";
		if (!item)
			return "";
		if (!item.Get(VAR_ID, itemId))
			return "";
		return itemId;
	}

	//------------------------------------------------------------------------------------------------
	//! The number of items whose Id is itemId.
	static int CountId(BaseContainerList items, string itemId)
	{
		int n = 0;
		if (!items)
			return 0;
		int count = items.Count();
		for (int i = 0; i < count; i++)
		{
			if (IdOf(items.Get(i)) == itemId)
				n++;
		}
		return n;
	}

	//------------------------------------------------------------------------------------------------
	//! The Items index of the first item whose Id is itemId, -1 when none.
	static int IndexOfId(BaseContainerList items, string itemId)
	{
		if (!items)
			return -1;
		int count = items.Count();
		for (int i = 0; i < count; i++)
		{
			if (IdOf(items.Get(i)) == itemId)
				return i;
		}
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! What identifies the open table between calls: "count|first Id|last Id|digest", the digest
	//! EMCP_WB_EntityRef.Digest over every Id in order (review round 1, W3-LOC-2: count, first and last alone let a
	//! different table with the same ends pass). A table with the very same Ids in the same order
	//! (a copy) still matches; the save answer says so.
	static string Fingerprint(BaseContainerList items)
	{
		if (!items)
			return "";
		int count = items.Count();
		string firstId = "";
		string lastId = "";
		string every = "";
		if (count > 0)
		{
			firstId = IdOf(items.Get(0));
			lastId = IdOf(items.Get(count - 1));
		}
		for (int i = 0; i < count; i++)
			every = every + IdOf(items.Get(i)) + "|";
		return count.ToString() + "|" + firstId + "|" + lastId + "|" + EMCP_WB_EntityRef.Digest(every);
	}

	//------------------------------------------------------------------------------------------------
	//! The "{GUID}" in front of a resource path, "" when there is none.
	static string GuidPrefix(string path)
	{
		if (!path.StartsWith("{"))
			return "";
		int close = path.IndexOf("}");
		if (close < 1)
			return "";
		return path.Substring(0, close + 1);
	}

	//------------------------------------------------------------------------------------------------
	//! A resource path without its "{GUID}".
	static string StripGuid(string path)
	{
		string guid = GuidPrefix(path);
		if (guid == "")
			return path;
		return path.Substring(guid.Length(), path.Length() - guid.Length());
	}

	//------------------------------------------------------------------------------------------------
	//! The data type's name (DataVarType).
	static string TypeName(DataVarType dataType)
	{
		return typename.EnumToString(DataVarType, dataType);
	}

	//------------------------------------------------------------------------------------------------
	//! A variable's current value as text: the scalar types, and arrays of int, bool and string
	//! comma-joined; "<TYPE>" for any other type, "<unread>" when Get answers false.
	static string ReadAsText(BaseContainer cont, string varName, DataVarType dataType)
	{
		if (!cont)
			return "<unread>";
		if (dataType == DataVarType.STRING)
		{
			string stringValue;
			if (cont.Get(varName, stringValue))
				return stringValue;
			return "<unread>";
		}
		if (dataType == DataVarType.INTEGER)
		{
			int intValue;
			if (cont.Get(varName, intValue))
				return intValue.ToString();
			return "<unread>";
		}
		if (dataType == DataVarType.BOOLEAN)
		{
			bool boolValue;
			if (cont.Get(varName, boolValue))
				return BoolText(boolValue);
			return "<unread>";
		}
		if (dataType == DataVarType.RESOURCE_NAME)
		{
			ResourceName resourceValue;
			if (cont.Get(varName, resourceValue))
				return resourceValue;
			return "<unread>";
		}
		if (dataType == DataVarType.SCALAR)
		{
			float floatValue;
			if (cont.Get(varName, floatValue))
				return floatValue.ToString();
			return "<unread>";
		}
		if (dataType == DataVarType.INTEGER_ARRAY)
		{
			array<int> intList = {};
			if (!cont.Get(varName, intList))
				return "<unread>";
			string joinedInts = "";
			if (!intList)
				return joinedInts;
			for (int i = 0; i < intList.Count(); i++)
			{
				if (i > 0)
					joinedInts += ",";
				joinedInts += intList.Get(i).ToString();
			}
			return joinedInts;
		}
		if (dataType == DataVarType.BOOLEAN_ARRAY)
		{
			array<bool> boolList = {};
			if (!cont.Get(varName, boolList))
				return "<unread>";
			string joinedBools = "";
			if (!boolList)
				return joinedBools;
			for (int j = 0; j < boolList.Count(); j++)
			{
				if (j > 0)
					joinedBools += ",";
				joinedBools += BoolText(boolList.Get(j));
			}
			return joinedBools;
		}
		if (dataType == DataVarType.STRING_ARRAY)
		{
			array<string> stringList = {};
			if (!cont.Get(varName, stringList))
				return "<unread>";
			string joinedStrings = "";
			if (!stringList)
				return joinedStrings;
			for (int k = 0; k < stringList.Count(); k++)
			{
				if (k > 0)
					joinedStrings += ",";
				joinedStrings += stringList.Get(k);
			}
			return joinedStrings;
		}
		return "<" + TypeName(dataType) + ">";
	}

	//------------------------------------------------------------------------------------------------
	//! The number of an enum name of an integer variable (GetEnumValues); false when the variable
	//! lists no such name.
	static bool EnumNumber(BaseContainer cont, int varIndex, string enumName, out int number)
	{
		number = 0;
		if (!cont || varIndex < 0)
			return false;
		if (cont.GetDataVarType(varIndex) != DataVarType.INTEGER)
			return false;
		array<string> enumNames = {};
		array<int> enumNumbers = {};
		cont.GetEnumValues(varIndex, enumNames, enumNumbers);
		if (!enumNames || !enumNumbers)
			return false;
		for (int i = 0; i < enumNames.Count() && i < enumNumbers.Count(); i++)
		{
			if (enumNames.Get(i) == enumName)
			{
				number = enumNumbers.Get(i);
				return true;
			}
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! "NAME=n" per enum value of an integer variable, comma-joined; "" for any other variable.
	static string EnumPairs(BaseContainer cont, int varIndex)
	{
		string pairs = "";
		if (!cont || varIndex < 0)
			return pairs;
		if (cont.GetDataVarType(varIndex) != DataVarType.INTEGER)
			return pairs;
		array<string> enumNames = {};
		array<int> enumNumbers = {};
		cont.GetEnumValues(varIndex, enumNames, enumNumbers);
		if (!enumNames || !enumNumbers)
			return pairs;
		for (int i = 0; i < enumNames.Count() && i < enumNumbers.Count(); i++)
		{
			if (i > 0)
				pairs += ",";
			pairs += enumNames.Get(i) + "=" + enumNumbers.Get(i).ToString();
		}
		return pairs;
	}

	//------------------------------------------------------------------------------------------------
	//! The text ModifyProperty gets for a value of the variable varName of cont (spec section 1):
	//! false with code and why when the field is unknown, the type unsupported or the text malformed.
	static bool Encode(BaseContainer cont, string varName, string text, out string encoded, out string code, out string why)
	{
		encoded = "";
		code = "";
		why = "";
		if (!cont)
		{
			code = INVALID_ARGUMENT;
			why = "no item to read the type of " + varName + " from";
			return false;
		}
		int varIndex = cont.GetVarIndex(varName);
		if (varIndex < 0)
		{
			code = INVALID_ARGUMENT;
			why = "no field " + varName + " on " + cont.GetClassName() + " (wb_localization columns lists them)";
			return false;
		}
		DataVarType dataType = cont.GetDataVarType(varIndex);
		if (dataType == DataVarType.STRING || dataType == DataVarType.RESOURCE_NAME || dataType == DataVarType.STRING_ARRAY)
		{
			encoded = text;
			return true;
		}
		if (dataType == DataVarType.INTEGER)
		{
			int number = 0;
			string pairs = EnumPairs(cont, varIndex);
			if (EMCP_WB_Common.ParseInt(text, number))
			{
				if (pairs != "")
				{
					array<string> enumNames = {};
					array<int> enumNumbers = {};
					cont.GetEnumValues(varIndex, enumNames, enumNumbers);
					if (enumNumbers && enumNumbers.Find(number) < 0)
					{
						code = INVALID_ARGUMENT;
						why = varName + " is an enum; " + text + " is none of its values (" + pairs + ")";
						return false;
					}
				}
				encoded = number.ToString();
				return true;
			}
			int byName = 0;
			if (EnumNumber(cont, varIndex, text, byName))
			{
				encoded = byName.ToString();
				return true;
			}
			code = INVALID_ARGUMENT;
			why = varName + " takes an integer";
			if (pairs != "")
				why = why + " or one of " + pairs;
			why = why + ", got '" + text + "'";
			return false;
		}
		if (dataType == DataVarType.BOOLEAN)
		{
			bool boolValue;
			if (!ParseBool(text, boolValue))
			{
				code = INVALID_ARGUMENT;
				why = varName + " takes true, false, 1 or 0, got '" + text + "'";
				return false;
			}
			encoded = boolValue.ToString();
			return true;
		}
		if (dataType == DataVarType.INTEGER_ARRAY || dataType == DataVarType.BOOLEAN_ARRAY)
		{
			string compact = text;
			compact.Replace(" ", "");
			if (compact == "")
				return true;
			array<string> parts = {};
			compact.Split(",", parts, false);
			string joined = "";
			for (int i = 0; i < parts.Count(); i++)
			{
				string part = parts.Get(i);
				string element = "";
				if (dataType == DataVarType.INTEGER_ARRAY)
				{
					int intElement = 0;
					if (!EMCP_WB_Common.ParseInt(part, intElement))
					{
						code = INVALID_ARGUMENT;
						why = varName + " takes comma-joined integers; element " + i.ToString() + " is '" + part + "'";
						return false;
					}
					element = intElement.ToString();
				}
				else
				{
					bool boolElement;
					if (!ParseBool(part, boolElement))
					{
						code = INVALID_ARGUMENT;
						why = varName + " takes comma-joined true/false/1/0; element " + i.ToString() + " is '" + part + "'";
						return false;
					}
					element = boolElement.ToString();
				}
				if (i > 0)
					joined += ",";
				joined += element;
			}
			encoded = joined;
			return true;
		}
		code = UNSUPPORTED_TYPE;
		why = varName + " is " + TypeName(dataType) + "; insert and set write strings, integers, enums, bools and arrays of int, bool or string";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! True when the value read back (ReadAsText) is the value sent (Encode) for the data type: bools
	//! compared as bools (bool.ToString is not assumed to be "true"/"false"), the rest as text.
	static bool SameValue(DataVarType dataType, string readBack, string sent)
	{
		if (dataType == DataVarType.BOOLEAN)
		{
			bool a;
			bool b;
			if (!ParseBool(readBack, a) || !ParseBool(sent, b))
				return false;
			return a == b;
		}
		if (dataType == DataVarType.BOOLEAN_ARRAY)
		{
			if (readBack == "" || sent == "")
				return readBack == sent;
			array<string> readParts = {};
			array<string> sentParts = {};
			readBack.Split(",", readParts, false);
			sent.Split(",", sentParts, false);
			if (readParts.Count() != sentParts.Count())
				return false;
			for (int i = 0; i < readParts.Count(); i++)
			{
				if (!SameValue(DataVarType.BOOLEAN, readParts.Get(i), sentParts.Get(i)))
					return false;
			}
			return true;
		}
		return readBack == sent;
	}

	//------------------------------------------------------------------------------------------------
	//! Why SCR_LocStatusPlugin.OnChange would open a dialog for these edits made in this order on an
	//! item (spec section 0), "" when none. statusNow: the item's Status before the edits; hasStatus
	//! false when its class has no Status (then only Target_en_us_edited counts). The Status number
	//! of DEVELOPMENT_PENDING comes from the Status enum of sample; when it cannot be read, any edit of
	//! Target_en_us is a hazard.
	static string ModalHazard(BaseContainer sample, notnull array<string> fieldNames, notnull array<string> encoded, bool hasStatus, int statusNow)
	{
		int devPending = 0;
		bool devKnown = false;
		if (hasStatus && sample)
			devKnown = EnumNumber(sample, sample.GetVarIndex(VAR_STATUS), STATUS_DEV_PENDING, devPending);
		int itemStatus = statusNow;
		// Field names are compared case folded: OnChange gets the variable's own name, whatever
		// case the request used (review L2).
		string statusKey = VAR_STATUS;
		statusKey.ToLower();
		string targetKey = VAR_TARGET;
		targetKey.ToLower();
		string editedKey = VAR_TARGET_EDITED;
		editedKey.ToLower();
		for (int i = 0; i < fieldNames.Count() && i < encoded.Count(); i++)
		{
			string fieldName = fieldNames.Get(i);
			fieldName.ToLower();
			string sent = encoded.Get(i);
			if (fieldName == statusKey)
			{
				int parsed = 0;
				if (EMCP_WB_Common.ParseInt(sent, parsed))
					itemStatus = parsed;
				continue;
			}
			if (fieldName == editedKey && sent != "" && sent != EDITED_NONE)
				return "an edit of " + VAR_TARGET_EDITED + " that is not empty and not '" + EDITED_NONE + "' opens SCR_LocStatusPlugin's dialog";
			if (fieldName == targetKey && hasStatus)
			{
				if (!devKnown)
					return "the Status enum names no " + STATUS_DEV_PENDING + ", so an edit of " + VAR_TARGET + " may open SCR_LocStatusPlugin's dialog";
				if (itemStatus != devPending)
					return "an edit of " + VAR_TARGET + " at Status " + itemStatus.ToString() + " (not " + STATUS_DEV_PENDING + ") opens SCR_LocStatusPlugin's dialog";
			}
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! The item's Status number; false when its class has no Status or Get answers false.
	static bool StatusOf(BaseContainer item, out int itemStatus)
	{
		itemStatus = 0;
		if (!item || item.GetVarIndex(VAR_STATUS) < 0)
			return false;
		return item.Get(VAR_STATUS, itemStatus);
	}

	//------------------------------------------------------------------------------------------------
	//! Finds an item by Id (itemId not "") or by Items index (itemIndex >= 0); both given must agree.
	//! An Id that two items share is refused DUPLICATE_ID (give the index). Fills found.
	static bool Locate(BaseContainerList items, string itemId, int itemIndex, EMCP_WB_LocalizationItem found)
	{
		found.Reset();
		int count = 0;
		if (items)
			count = items.Count();
		if (itemId == "" && itemIndex < 0)
		{
			found.m_Code = INVALID_ARGUMENT;
			found.m_Why = "give id or index";
			return false;
		}

		int at = itemIndex;
		if (itemId != "")
		{
			int matches = CountId(items, itemId);
			if (matches == 0)
			{
				found.m_Code = ITEM_NOT_FOUND;
				found.m_Why = "no item with Id '" + itemId + "' (" + count.ToString() + " items)";
				return false;
			}
			if (matches > 1 && itemIndex < 0)
			{
				found.m_Code = DUPLICATE_ID;
				found.m_Why = matches.ToString() + " items share Id '" + itemId + "'; give the index instead";
				return false;
			}
			if (itemIndex < 0)
				at = IndexOfId(items, itemId);
		}

		if (at < 0 || at >= count)
		{
			found.m_Code = ITEM_NOT_FOUND;
			found.m_Why = "index " + at.ToString() + " is outside the " + count.ToString() + " items";
			return false;
		}
		BaseContainer item = items.Get(at);
		if (!item)
		{
			found.m_Code = ITEM_NOT_FOUND;
			found.m_Why = "Items.Get(" + at.ToString() + ") returned null";
			return false;
		}
		string atId = IdOf(item);
		if (itemId != "" && atId != itemId)
		{
			found.m_Code = INVALID_ARGUMENT;
			found.m_Why = "index " + at.ToString() + " holds Id '" + atId + "', not '" + itemId + "'";
			return false;
		}
		found.m_Item = item;
		found.m_Index = at;
		found.m_Id = atId;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! "name|value" for each named field of an item, the value escaped.
	static void FieldRows(BaseContainer item, notnull array<string> fieldNames, notnull array<string> outRows)
	{
		outRows.Clear();
		if (!item)
			return;
		foreach (string fieldName : fieldNames)
		{
			int varIndex = item.GetVarIndex(fieldName);
			string shown = "<none>";
			if (varIndex >= 0)
				shown = ReadAsText(item, fieldName, item.GetDataVarType(varIndex));
			outRows.Insert(fieldName + "|" + Esc(shown));
		}
	}

	//------------------------------------------------------------------------------------------------
	//! "name|value" for every variable of an item, the value escaped: a full snapshot.
	static void AllRows(BaseContainer item, notnull array<string> outRows)
	{
		outRows.Clear();
		if (!item)
			return;
		int varCount = item.GetNumVars();
		for (int v = 0; v < varCount; v++)
		{
			string varName = item.GetVarName(v);
			outRows.Insert(varName + "|" + Esc(ReadAsText(item, varName, item.GetDataVarType(v))));
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The fields and values of an insert or set: as many values as fields, at least one (min), at
	//! most FIELDS_MAX, no field twice. why says what is wrong.
	static bool FieldsOk(notnull array<string> fieldNames, notnull array<string> fieldValues, int min, out string why)
	{
		why = "";
		if (fieldNames.Count() != fieldValues.Count())
		{
			why = "fields and values must have the same length (" + fieldNames.Count().ToString() + " fields, " + fieldValues.Count().ToString() + " values)";
			return false;
		}
		if (fieldNames.Count() < min)
		{
			why = "give at least one field and its value";
			return false;
		}
		if (fieldNames.Count() > FIELDS_MAX)
		{
			why = "at most " + FIELDS_MAX.ToString() + " fields";
			return false;
		}
		for (int i = 0; i < fieldNames.Count(); i++)
		{
			string fieldName = fieldNames.Get(i);
			if (fieldName == "")
			{
				why = "field " + i.ToString() + " is empty";
				return false;
			}
			for (int j = 0; j < i; j++)
			{
				if (SameField(fieldNames.Get(j), fieldName))
				{
					why = "field " + fieldName + " is given twice";
					return false;
				}
			}
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Two field names that may name one variable: equal with case folded. Whether GetVarIndex folds
	//! case is not proven (review L2), so the Id and twice tests fold it (review round 1, W3-LOC-4).
	static bool SameField(string a, string b)
	{
		string la = a;
		string lb = b;
		la.ToLower();
		lb.ToLower();
		return la == lb;
	}

	//------------------------------------------------------------------------------------------------
	//! The index of the first field that may name name (SameField), -1 when none.
	static int FieldIndex(array<string> fieldNames, string name)
	{
		if (!fieldNames)
			return -1;
		for (int i = 0; i < fieldNames.Count(); i++)
		{
			if (SameField(fieldNames.Get(i), name))
				return i;
		}
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! An item Id: not empty, no line break.
	static bool IdOk(string itemId, out string why)
	{
		why = "";
		if (itemId == "")
		{
			why = "the item Id is empty";
			return false;
		}
		if (itemId.Contains("\n") || itemId.Contains("\r"))
		{
			why = "the item Id holds a line break";
			return false;
		}
		return true;
	}
}

class EMCP_WB_Localization : NetApiHandler
{
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string MODULE_NOT_OPEN = "MODULE_NOT_OPEN";
	static const string NO_DOCUMENT = "NO_DOCUMENT";
	static const string MODAL_HAZARD = "MODAL_HAZARD";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string SAVE_FAILED = "SAVE_FAILED";
	static const string GATED = "GATED";
	static const string ITEM_NOT_FOUND = "ITEM_NOT_FOUND";
	static const string DUPLICATE_ID = "DUPLICATE_ID";
	static const string OPEN_NEXT = "wb_localization open <path>.st";
	static const string COLUMNS_NEXT = "list the fields (wb_localization columns)";
	//! Undo history point names (BeginModify).
	static const string UNDO_INSERT = "EMCP wb_localization insert";
	static const string UNDO_SET = "EMCP wb_localization set";
	static const string UNDO_DELETE = "EMCP wb_localization delete";
	//! DEC-063 OD-5: said by insert and set, and by save (its dry run included).
	static const string OD5_EDIT = "the engine's SCR_LocModifiedPlugin writes the Workbench user name into Author and LastChanged of the edited item (OD-5)";
	static const string OD5_SAVE = "the saved file keeps the Workbench user name SCR_LocModifiedPlugin wrote into Author and LastChanged of each edited item (OD-5)";
	static const string SAVE_PLUGINS = "the Localization Editor plugins' OnSave runs on save; whether one opens a dialog is probe P-W3-16";
	static const string GETMODULE_OPENS = "Workbench.GetModule opens a closed Localization Editor";
	static const string SAME_IDS_LIMIT = "the open table is known by its Ids (count, order and a digest of all of them), not by its file: a copy with the very same Ids opened by hand in the Localization Editor would pass for it";

	//! The project-relative path the last open opened ("" none), the fingerprints that table had at
	//! that open and after each of this handler's own edits since (oldest first, at most
	//! FINGERPRINTS_MAX), and this handler's edits since that open or the last save. A script reload
	//! clears them, which makes the open table one opened by hand.
	//! The table is the known one while its fingerprint is any of these, not only the latest: the
	//! module's Edit > Undo (wb_module action, not this handler) takes an own insert or delete back to
	//! an earlier fingerprint (W3 run 2, w3-23: insert 3 -> 4 items, one Edit > Undo -> 3, and status
	//! then answered "opened by hand" and w3-24's open MODAL_HAZARD on the handler's own table).
	//! A fingerprint no open or own edit produced still makes the table unknown.
	protected static string s_sTablePath;
	protected static ref array<string> s_aFingerprints;
	protected static int s_iUnsaved;
	static const int FINGERPRINTS_MAX = 64;

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_LocalizationRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_LocalizationRequest req = EMCP_WB_LocalizationRequest.Cast(request);
		EMCP_WB_LocalizationResponse resp = new EMCP_WB_LocalizationResponse();
		if (!req)
		{
			Refuse(resp, INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "status")
			TableStatus(req, resp);
		else if (req.action == "columns")
			ListColumns(req, resp);
		else if (req.action == "list")
			ListItems(req, resp);
		else if (req.action == "get")
			GetItem(req, resp);
		else if (req.action == "selection")
			ReadSelection(req, resp);
		else if (req.action == "open")
			OpenTable(req, resp);
		else if (req.action == "insert")
			InsertRow(req, resp);
		else if (req.action == "set")
			SetFields(req, resp);
		else if (req.action == "delete")
			DeleteRow(req, resp);
		else if (req.action == "filter")
			FilterRows(req, resp);
		else if (req.action == "save")
			SaveTable(req, resp);
		else if (req.action == "buildRuntime")
			BuildRuntime(req, resp);
		else if (req.action == "close")
			CloseTable(req, resp);
		else
			Refuse(resp, INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of status, columns, list, get, selection, open, insert, set, delete, filter, save, buildRuntime, close");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_LocalizationResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_LocalizationResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! Status ok with the text as the message.
	protected static void Ok(EMCP_WB_LocalizationResponse resp, string text)
	{
		Answer(resp, "ok", "", text, "");
	}

	//------------------------------------------------------------------------------------------------
	//! The Localization Editor, or null with the refusal written. GetModule opens a closed module.
	protected static LocalizationEditor Editor(EMCP_WB_LocalizationResponse resp)
	{
		LocalizationEditor locEditor = Workbench.GetModule(LocalizationEditor);
		if (!locEditor)
		{
			Refuse(resp, MODULE_NOT_OPEN, "the Localization Editor is not available: GetModule returned null", "wb_module open LocalizationEditor");
			return null;
		}
		return locEditor;
	}

	//------------------------------------------------------------------------------------------------
	//! The open table and its Items into doc, or false with the refusal written: no editor, no table
	//! open, or a table with no Items array. Every action but status and open starts here.
	protected static bool FindDoc(EMCP_WB_LocalizationDoc doc, EMCP_WB_LocalizationResponse resp)
	{
		LocalizationEditor locEditor = Editor(resp);
		if (!locEditor)
			return false;
		BaseContainer table = locEditor.GetTable();
		if (!table)
		{
			Refuse(resp, NO_DOCUMENT, "no string table is open in the Localization Editor", OPEN_NEXT);
			return false;
		}
		BaseContainerList items = table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		if (!items)
		{
			Refuse(resp, NO_DOCUMENT, "the open table (" + table.GetClassName() + ") has no Items array", OPEN_NEXT);
			return false;
		}
		doc.m_Editor = locEditor;
		doc.m_Table = table;
		doc.m_Items = items;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The path of the open table when this handler opened it and its fingerprint is one it had at
	//! that open or after an own edit (an Edit > Undo or Redo of those), else "" (opened by hand,
	//! another table, or items added or removed by hand).
	protected static string KnownPath(BaseContainerList items)
	{
		if (s_sTablePath == "" || !s_aFingerprints)
			return "";
		if (s_aFingerprints.Find(EMCP_WB_LocalizationUtil.Fingerprint(items)) < 0)
			return "";
		return s_sTablePath;
	}

	//------------------------------------------------------------------------------------------------
	//! Adds a fingerprint of the known table (after open or an own edit); the oldest is dropped past
	//! FINGERPRINTS_MAX.
	protected static void NoteFingerprint(string fingerprint)
	{
		if (!s_aFingerprints)
			s_aFingerprints = new array<string>();
		if (s_aFingerprints.Find(fingerprint) >= 0)
			return;
		s_aFingerprints.Insert(fingerprint);
		if (s_aFingerprints.Count() > FINGERPRINTS_MAX)
			s_aFingerprints.RemoveOrdered(0);
	}

	//------------------------------------------------------------------------------------------------
	//! An insert refused after InsertItem: DeleteItem, EndModify, then the edit counted (the undo point
	//! may leave the document dirty, and over-counting only makes a later open refuse) and the delete
	//! read back. Answers the tail of the refusal text (review round 1, W3-LOC-3).
	protected static string RollBackInsert(LocalizationEditor locEditor, EMCP_WB_LocalizationDoc doc, bool known, string itemId)
	{
		locEditor.DeleteItem(itemId);
		locEditor.EndModify();
		NoteEdit(known, doc.m_Table);
		BaseContainerList itemsNow = doc.m_Table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		int left = EMCP_WB_LocalizationUtil.CountId(itemsNow, itemId);
		if (left == 0)
			return "; the new item was deleted again (it reads back absent)";
		return "; the new item could not be deleted again: " + left.ToString() + " item(s) with Id '" + itemId + "' read back; check with wb_localization list";
	}

	//------------------------------------------------------------------------------------------------
	//! Forgets the table open opened: another route (wb_module setResource, the 1.x openResource,
	//! EMCP_WB_OpenResource.OpenIn) is about to hand the Localization Editor a .st, so whatever is
	//! open next is not known to this handler: open refuses MODAL_HAZARD and save NO_DOCUMENT until
	//! wb_localization open opens a table again (review round 1, W3-LOC-2).
	static void Forget()
	{
		s_sTablePath = "";
		s_aFingerprints = null;
		s_iUnsaved = 0;
	}

	//------------------------------------------------------------------------------------------------
	//! After an own edit: one more unsaved edit; the fingerprint is added when the table was the known one.
	protected static void NoteEdit(bool known, BaseContainer table)
	{
		s_iUnsaved++;
		if (!known || !table)
			return;
		BaseContainerList items = table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		NoteFingerprint(EMCP_WB_LocalizationUtil.Fingerprint(items));
	}

	//------------------------------------------------------------------------------------------------
	//! True when the project file is inside the open project (EMCP_WB_Guard.TargetExistsInProject).
	protected static bool InProject(string rel)
	{
		string absolute = "";
		string why = "";
		if (rel == "")
			return false;
		return EMCP_WB_Guard.TargetExistsInProject(rel, absolute, why);
	}

	//------------------------------------------------------------------------------------------------
	//! status: the module, the open table, its classes and Items count; the path when open opened it.
	//! GetNumContainers and GetContainer(0) are read as the evidence of probe P-W3-17.
	static void TableStatus(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		LocalizationEditor locEditor = Editor(resp);
		if (!locEditor)
			return;
		string probe = "GetNumContainers " + locEditor.GetNumContainers().ToString();
		if (locEditor.GetNumContainers() > 0)
		{
			BaseContainer first = locEditor.GetContainer(0);
			if (first)
				probe = probe + ", container 0 " + first.GetClassName() + " '" + EMCP_WB_Guard.ScrubHome(first.GetName()) + "'";
		}

		BaseContainer table = locEditor.GetTable();
		if (!table)
		{
			resp.total = 0;
			Ok(resp, "no string table is open in the Localization Editor (" + probe + "; " + GETMODULE_OPENS + ")");
			return;
		}
		BaseContainerList items = table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		if (!items)
		{
			resp.total = 0;
			Ok(resp, "the open table (" + table.GetClassName() + ") has no Items array (" + probe + ")");
			return;
		}
		resp.total = items.Count();
		if (resp.total > 0)
		{
			BaseContainer firstItem = items.Get(0);
			if (firstItem)
				resp.itemClass = firstItem.GetClassName();
		}
		resp.table = KnownPath(items);
		resp.inProject = InProject(resp.table);
		string where = "opened by hand or changed by hand since open: its file is not known";
		if (resp.table != "")
			where = resp.table + ", " + s_iUnsaved.ToString() + " handler edit(s) not saved";
		Ok(resp, "table " + table.GetClassName() + " with " + resp.total.ToString() + " items; " + where + " (" + probe + ")");
	}

	//------------------------------------------------------------------------------------------------
	//! columns: the first item's variables as name|type|NAME=n,... (the enum of an integer).
	static void ListColumns(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		if (doc.m_Items.Count() == 0)
		{
			Ok(resp, "the table has no items; columns are read from the first item");
			return;
		}
		BaseContainer sample = doc.m_Items.Get(0);
		if (!sample)
		{
			Answer(resp, "error", ENGINE_FALSE, "Items.Get(0) returned null", "");
			return;
		}
		resp.itemClass = sample.GetClassName();
		int varCount = sample.GetNumVars();
		for (int v = 0; v < varCount; v++)
		{
			string typeText = EMCP_WB_LocalizationUtil.TypeName(sample.GetDataVarType(v));
			resp.columns.Insert(sample.GetVarName(v) + "|" + typeText + "|" + EMCP_WB_LocalizationUtil.EnumPairs(sample, v));
		}
		Ok(resp, varCount.ToString() + " fields of " + resp.itemClass);
	}

	//------------------------------------------------------------------------------------------------
	//! list: "index|field|..." rows of the items whose Id starts with prefix, paged.
	static void ListItems(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		array<string> shownFields = {};
		foreach (string asked : req.fields)
			shownFields.Insert(asked);
		if (shownFields.IsEmpty())
		{
			shownFields.Insert(EMCP_WB_LocalizationUtil.VAR_ID);
			shownFields.Insert(EMCP_WB_LocalizationUtil.VAR_TARGET);
		}
		if (shownFields.Count() > EMCP_WB_LocalizationUtil.FIELDS_MAX)
		{
			Refuse(resp, INVALID_ARGUMENT, "at most " + EMCP_WB_LocalizationUtil.FIELDS_MAX.ToString() + " fields", COLUMNS_NEXT);
			return;
		}

		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		int count = doc.m_Items.Count();
		if (count > 0)
		{
			BaseContainer sample = doc.m_Items.Get(0);
			foreach (string fieldName : shownFields)
			{
				if (sample && sample.GetVarIndex(fieldName) < 0)
				{
					Refuse(resp, INVALID_ARGUMENT, "no field " + fieldName + " on " + sample.GetClassName(), COLUMNS_NEXT);
					return;
				}
			}
		}

		array<int> matched = {};
		for (int i = 0; i < count; i++)
		{
			if (req.prefix == "" || EMCP_WB_LocalizationUtil.IdOf(doc.m_Items.Get(i)).StartsWith(req.prefix))
				matched.Insert(i);
		}
		int total = matched.Count();
		int first = 0;
		int stop = 0;
		string code = "";
		string why = "";
		if (!EMCP_WB_LocalizationUtil.PageWindow(req.cursor, req.limit, total, first, stop, code, why))
		{
			Refuse(resp, code, why, "read again without a cursor");
			return;
		}

		resp.columns.Insert("index");
		foreach (string columnName : shownFields)
			resp.columns.Insert(columnName);
		for (int k = first; k < stop; k++)
		{
			int at = matched.Get(k);
			BaseContainer item = doc.m_Items.Get(at);
			string row = at.ToString();
			foreach (string shown : shownFields)
			{
				string text = "<none>";
				if (item)
				{
					int varIndex = item.GetVarIndex(shown);
					if (varIndex >= 0)
						text = EMCP_WB_LocalizationUtil.ReadAsText(item, shown, item.GetDataVarType(varIndex));
				}
				row = row + "|" + EMCP_WB_LocalizationUtil.Esc(text);
			}
			resp.rows.Insert(row);
		}
		resp.total = total;
		resp.nextCursor = EMCP_WB_LocalizationUtil.NextCursor(stop, total);
		Ok(resp, "items " + first.ToString() + " to " + stop.ToString() + " of " + total.ToString() + " matched (" + count.ToString() + " in the table)");
	}

	//------------------------------------------------------------------------------------------------
	//! get: one item by Id or Items index, every variable as name|type|value.
	static void GetItem(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		EMCP_WB_LocalizationItem found = new EMCP_WB_LocalizationItem();
		if (!EMCP_WB_LocalizationUtil.Locate(doc.m_Items, req.id, req.index, found))
		{
			Refuse(resp, found.m_Code, found.m_Why, "wb_localization list");
			return;
		}
		resp.id = found.m_Id;
		resp.index = found.m_Index;
		BaseContainer item = found.m_Item;
		int varCount = item.GetNumVars();
		for (int v = 0; v < varCount; v++)
		{
			string varName = item.GetVarName(v);
			DataVarType dataType = item.GetDataVarType(v);
			resp.rows.Insert(varName + "|" + EMCP_WB_LocalizationUtil.TypeName(dataType) + "|" + EMCP_WB_LocalizationUtil.Esc(EMCP_WB_LocalizationUtil.ReadAsText(item, varName, dataType)));
		}
		Ok(resp, "item " + found.m_Index.ToString() + " '" + found.m_Id + "', " + varCount.ToString() + " fields");
	}

	//------------------------------------------------------------------------------------------------
	//! selection: GetSelectedRows and GetFilteredRows, at most ROWS_MAX each.
	static void ReadSelection(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		array<int> selectedRows = {};
		doc.m_Editor.GetSelectedRows(selectedRows);
		array<int> filteredRows = {};
		doc.m_Editor.GetFilteredRows(filteredRows);
		int selectedCount = 0;
		int filteredCount = 0;
		if (selectedRows)
		{
			selectedCount = selectedRows.Count();
			for (int i = 0; i < selectedCount && i < EMCP_WB_LocalizationUtil.ROWS_MAX; i++)
				resp.selected.Insert(selectedRows.Get(i));
		}
		if (filteredRows)
		{
			filteredCount = filteredRows.Count();
			for (int j = 0; j < filteredCount && j < EMCP_WB_LocalizationUtil.ROWS_MAX; j++)
				resp.filtered.Insert(filteredRows.Get(j));
		}
		string text = selectedCount.ToString() + " selected, " + filteredCount.ToString() + " filtered rows (row indices; that they are Items indices is probe P-W3-15)";
		if (selectedCount > EMCP_WB_LocalizationUtil.ROWS_MAX || filteredCount > EMCP_WB_LocalizationUtil.ROWS_MAX)
			text = text + "; the first " + EMCP_WB_LocalizationUtil.ROWS_MAX.ToString() + " of each are answered";
		Ok(resp, text);
	}

	//------------------------------------------------------------------------------------------------
	//! open: a clean relative .st path (plain or {GUID}) in the Localization Editor. Never replaces a
	//! table with this handler's unsaved edits or one opened by hand: replacing a document with unsaved
	//! edits opens an engine prompt, and no call tells whether a table has them.
	static void OpenTable(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		string guid = EMCP_WB_LocalizationUtil.GuidPrefix(req.path);
		string clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(EMCP_WB_LocalizationUtil.StripGuid(req.path), clean, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "give a project-relative .st path");
			return;
		}
		string lower = clean;
		lower.ToLower();
		if (!lower.EndsWith(".st"))
		{
			Refuse(resp, INVALID_ARGUMENT, "open takes a string table (.st): " + clean, "give a .st path");
			return;
		}
		// The engine is only sent a file that resolves in a loaded addon (Workbench.GetAbsolutePath with
		// mustExist; no file method): what SetOpenedResource does with a missing one is not proven (review L3).
		string resolved = "";
		if (!Workbench.GetAbsolutePath(clean, resolved, true))
		{
			Refuse(resp, "PATH_NOT_FOUND", "no loaded addon holds " + clean + "; nothing was opened", "check the path (asset_search)");
			return;
		}
		// A {GUID} must name this path, case aside, as EMCP_WB_Audio.ResourceOf checks it: the path is
		// what open records and save checks, so a GUID of another table is never sent with it (review
		// round 1, W3-LOC-1). An unknown GUID is left to the engine as before.
		if (guid != "")
		{
			ResourceName byGuid = Workbench.GetResourceName(guid);
			string byGuidText = byGuid;
			if (byGuidText != "" && byGuidText != guid)
			{
				string guidPath = byGuid.GetPath();
				if (guidPath != "" && EMCP_WB_Guard.Fold(guidPath) != EMCP_WB_Guard.Fold(clean))
				{
					Refuse(resp, INVALID_ARGUMENT, guid + " names " + guidPath + ", not " + clean + "; nothing was opened", "pass the {GUID}path wb_resources resolve answers, or the path alone");
					return;
				}
			}
		}

		LocalizationEditor locEditor = Editor(resp);
		if (!locEditor)
			return;
		BaseContainer current = locEditor.GetTable();
		if (current)
		{
			BaseContainerList currentItems = current.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
			string known = KnownPath(currentItems);
			if (known != "" && EMCP_WB_Guard.Fold(known) == EMCP_WB_Guard.Fold(clean))
			{
				resp.result = true;
				resp.table = known;
				resp.inProject = InProject(known);
				if (currentItems)
					resp.total = currentItems.Count();
				Ok(resp, known + " is already the open table; nothing was switched");
				return;
			}
			if (known == "")
			{
				Refuse(resp, MODAL_HAZARD, "a table is open that was not opened through open, or its items changed by hand; no call tells whether it has unsaved edits, and replacing it over unsaved edits opens an engine prompt", "save or close that table in the Localization Editor, then open again");
				return;
			}
			if (s_iUnsaved > 0)
			{
				Refuse(resp, MODAL_HAZARD, s_iUnsaved.ToString() + " handler edit(s) on " + known + " are not saved; replacing it would open the engine's save prompt", "wb_localization save with confirm true, or undo the edits, then open again");
				return;
			}
		}

		bool opened = Workbench.OpenModule(LocalizationEditor);
		bool result = locEditor.SetOpenedResource(guid + clean);
		resp.result = result;
		if (!result)
		{
			Answer(resp, "error", ENGINE_FALSE, "SetOpenedResource returned false for " + guid + clean + " (OpenModule " + EMCP_WB_LocalizationUtil.BoolText(opened) + "; the path forms are probe P-W3-08)", "check the path (asset_search) or give the {GUID} form");
			return;
		}
		BaseContainer table = locEditor.GetTable();
		if (!table)
		{
			Answer(resp, "error", NO_DOCUMENT, "SetOpenedResource answered true but GetTable answers no table", "wb_localization status");
			return;
		}
		BaseContainerList items = table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		s_sTablePath = clean;
		s_aFingerprints = new array<string>();
		NoteFingerprint(EMCP_WB_LocalizationUtil.Fingerprint(items));
		s_iUnsaved = 0;
		resp.table = clean;
		resp.inProject = InProject(clean);
		if (items)
			resp.total = items.Count();
		string text = "opened " + clean + " (" + resp.total.ToString() + " items)";
		if (!items)
			text = text + "; the table (" + table.GetClassName() + ") has no Items array";
		Ok(resp, text);
	}

	//------------------------------------------------------------------------------------------------
	//! insert: a new item with the Id, then the fields, inside one BeginModify/EndModify, read back.
	//! Refuses DUPLICATE_ID for an Id in use and MODAL_HAZARD before any engine call when the fields
	//! would open SCR_LocStatusPlugin's dialog; checks again on the new item before its fields.
	static void InsertRow(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		resp.id = req.id;
		string why = "";
		if (!EMCP_WB_LocalizationUtil.IdOk(req.id, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, "give the new item's id");
			return;
		}
		if (!EMCP_WB_LocalizationUtil.FieldsOk(req.fields, req.values, 0, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, COLUMNS_NEXT);
			return;
		}
		if (EMCP_WB_LocalizationUtil.FieldIndex(req.fields, EMCP_WB_LocalizationUtil.VAR_ID) >= 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "the Id is given by id, not as a field", "drop Id from fields");
			return;
		}

		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		if (EMCP_WB_LocalizationUtil.CountId(doc.m_Items, req.id) > 0)
		{
			Refuse(resp, DUPLICATE_ID, "an item with Id '" + req.id + "' exists", "wb_localization set, or another id");
			return;
		}
		bool known = KnownPath(doc.m_Items) != "";
		int countBefore = doc.m_Items.Count();

		// Checked on the first item before anything is inserted (a new item starts at
		// DEVELOPMENT_PENDING, the Status default); checked again on the new item below.
		array<string> encoded = {};
		string code = "";
		if (countBefore > 0)
		{
			BaseContainer sample = doc.m_Items.Get(0);
			if (!EncodeAll(sample, req.fields, req.values, encoded, code, why))
			{
				Refuse(resp, code, why, COLUMNS_NEXT);
				return;
			}
			int devPending = 0;
			bool hasStatus = false;
			if (sample && sample.GetVarIndex(EMCP_WB_LocalizationUtil.VAR_STATUS) >= 0)
				hasStatus = true;
			if (hasStatus)
				EMCP_WB_LocalizationUtil.EnumNumber(sample, sample.GetVarIndex(EMCP_WB_LocalizationUtil.VAR_STATUS), EMCP_WB_LocalizationUtil.STATUS_DEV_PENDING, devPending);
			string hazard = EMCP_WB_LocalizationUtil.ModalHazard(sample, req.fields, encoded, hasStatus, devPending);
			if (hazard != "")
			{
				Refuse(resp, MODAL_HAZARD, hazard + "; nothing was inserted", "insert without that field, or set Target_en_us while the Status is DEVELOPMENT_PENDING");
				return;
			}
		}

		LocalizationEditor locEditor = doc.m_Editor;
		locEditor.BeginModify(UNDO_INSERT);
		BaseContainer item = locEditor.InsertItem(req.id, true, true);
		if (!item)
		{
			locEditor.EndModify();
			Answer(resp, "error", ENGINE_FALSE, "InsertItem returned null for '" + req.id + "'", "wb_localization status");
			return;
		}
		if (countBefore == 0 && !EncodeAll(item, req.fields, req.values, encoded, code, why))
		{
			string undone = RollBackInsert(locEditor, doc, known, req.id);
			Refuse(resp, code, why + undone, COLUMNS_NEXT);
			return;
		}
		int statusNow = 0;
		bool itemHasStatus = EMCP_WB_LocalizationUtil.StatusOf(item, statusNow);
		string itemHazard = EMCP_WB_LocalizationUtil.ModalHazard(item, req.fields, encoded, itemHasStatus, statusNow);
		if (itemHazard != "")
		{
			string hazardUndone = RollBackInsert(locEditor, doc, known, req.id);
			Refuse(resp, MODAL_HAZARD, itemHazard + " (the new item's Status is " + statusNow.ToString() + ")" + hazardUndone, "insert without that field");
			return;
		}
		for (int i = 0; i < req.fields.Count(); i++)
			locEditor.ModifyProperty(item, item.GetVarIndex(req.fields.Get(i)), encoded.Get(i));
		locEditor.EndModify();

		NoteEdit(known, doc.m_Table);
		resp.warnings.Insert(OD5_EDIT);
		BaseContainerList itemsAfter = doc.m_Table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		resp.index = EMCP_WB_LocalizationUtil.IndexOfId(itemsAfter, req.id);
		if (itemsAfter)
			resp.total = itemsAfter.Count();
		if (resp.index < 0 || resp.total != countBefore + 1)
		{
			Answer(resp, "error", ENGINE_FALSE, "after InsertItem the table holds " + resp.total.ToString() + " items (was " + countBefore.ToString() + ") and Id '" + req.id + "' is at " + resp.index.ToString(), "wb_localization list");
			return;
		}
		BaseContainer readItem = itemsAfter.Get(resp.index);
		resp.after.Insert(EMCP_WB_LocalizationUtil.VAR_ID + "|" + EMCP_WB_LocalizationUtil.Esc(req.id));
		array<string> fieldRows = {};
		EMCP_WB_LocalizationUtil.FieldRows(readItem, req.fields, fieldRows);
		foreach (string fieldRow : fieldRows)
			resp.after.Insert(fieldRow);
		string mismatch = Mismatch(readItem, req.fields, encoded);
		if (mismatch != "")
		{
			Answer(resp, "error", ENGINE_FALSE, "inserted '" + req.id + "' at " + resp.index.ToString() + ", but " + mismatch, "wb_localization get, then set");
			return;
		}
		Ok(resp, "inserted '" + req.id + "' at " + resp.index.ToString() + " with " + req.fields.Count().ToString() + " field(s); undo point '" + UNDO_INSERT + "'");
	}

	//------------------------------------------------------------------------------------------------
	//! set: the fields of one item inside one BeginModify/EndModify, before and after read back.
	//! Refuses MODAL_HAZARD before any engine call when an edit would open SCR_LocStatusPlugin's dialog.
	static void SetFields(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		string why = "";
		if (!EMCP_WB_LocalizationUtil.FieldsOk(req.fields, req.values, 1, why))
		{
			Refuse(resp, INVALID_ARGUMENT, why, COLUMNS_NEXT);
			return;
		}
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		EMCP_WB_LocalizationItem found = new EMCP_WB_LocalizationItem();
		if (!EMCP_WB_LocalizationUtil.Locate(doc.m_Items, req.id, req.index, found))
		{
			Refuse(resp, found.m_Code, found.m_Why, "wb_localization list");
			return;
		}
		resp.id = found.m_Id;
		resp.index = found.m_Index;
		BaseContainer item = found.m_Item;

		array<string> encoded = {};
		string code = "";
		if (!EncodeAll(item, req.fields, req.values, encoded, code, why))
		{
			Refuse(resp, code, why, COLUMNS_NEXT);
			return;
		}
		int newIdAt = EMCP_WB_LocalizationUtil.FieldIndex(req.fields, EMCP_WB_LocalizationUtil.VAR_ID);
		if (newIdAt >= 0)
		{
			string newId = encoded.Get(newIdAt);
			if (!EMCP_WB_LocalizationUtil.IdOk(newId, why))
			{
				Refuse(resp, INVALID_ARGUMENT, why, "give a new Id");
				return;
			}
			if (newId != found.m_Id && EMCP_WB_LocalizationUtil.CountId(doc.m_Items, newId) > 0)
			{
				Refuse(resp, DUPLICATE_ID, "an item with Id '" + newId + "' exists", "another Id");
				return;
			}
		}
		int statusNow = 0;
		bool hasStatus = EMCP_WB_LocalizationUtil.StatusOf(item, statusNow);
		string hazard = EMCP_WB_LocalizationUtil.ModalHazard(item, req.fields, encoded, hasStatus, statusNow);
		if (hazard != "")
		{
			Refuse(resp, MODAL_HAZARD, hazard + "; nothing was changed", "edit that field in the Localization Editor by hand");
			return;
		}

		EMCP_WB_LocalizationUtil.FieldRows(item, req.fields, resp.before);
		bool known = KnownPath(doc.m_Items) != "";
		LocalizationEditor locEditor = doc.m_Editor;
		locEditor.BeginModify(UNDO_SET);
		for (int i = 0; i < req.fields.Count(); i++)
			locEditor.ModifyProperty(item, item.GetVarIndex(req.fields.Get(i)), encoded.Get(i));
		locEditor.EndModify();

		NoteEdit(known, doc.m_Table);
		resp.warnings.Insert(OD5_EDIT);
		BaseContainerList itemsAfter = doc.m_Table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		BaseContainer readItem = null;
		if (itemsAfter && found.m_Index < itemsAfter.Count())
			readItem = itemsAfter.Get(found.m_Index);
		if (!readItem)
		{
			Answer(resp, "error", ENGINE_FALSE, "item " + found.m_Index.ToString() + " cannot be read after the edit", "wb_localization list");
			return;
		}
		resp.id = EMCP_WB_LocalizationUtil.IdOf(readItem);
		EMCP_WB_LocalizationUtil.FieldRows(readItem, req.fields, resp.after);
		string mismatch = Mismatch(readItem, req.fields, encoded);
		if (mismatch != "")
		{
			Answer(resp, "error", ENGINE_FALSE, mismatch + " (ModifyProperty is void; a locked item or an OnChange plugin may have kept or changed it)", "wb_localization get");
			return;
		}
		Ok(resp, "set " + req.fields.Count().ToString() + " field(s) of item " + found.m_Index.ToString() + " '" + resp.id + "'; undo point '" + UNDO_SET + "'");
	}

	//------------------------------------------------------------------------------------------------
	//! delete: snapshot (every variable), DeleteItem(Id) inside BeginModify/EndModify, read back.
	static void DeleteRow(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		EMCP_WB_LocalizationItem found = new EMCP_WB_LocalizationItem();
		if (!EMCP_WB_LocalizationUtil.Locate(doc.m_Items, req.id, req.index, found))
		{
			Refuse(resp, found.m_Code, found.m_Why, "wb_localization list");
			return;
		}
		resp.id = found.m_Id;
		resp.index = found.m_Index;
		if (found.m_Id == "")
		{
			Refuse(resp, ITEM_NOT_FOUND, "item " + found.m_Index.ToString() + " has no Id, and DeleteItem takes an Id", "delete it in the Localization Editor by hand");
			return;
		}
		int sharing = EMCP_WB_LocalizationUtil.CountId(doc.m_Items, found.m_Id);
		if (sharing > 1)
		{
			Refuse(resp, DUPLICATE_ID, sharing.ToString() + " items share Id '" + found.m_Id + "'; DeleteItem takes an Id and could remove another one", "set a unique Id first, or delete by hand");
			return;
		}

		EMCP_WB_LocalizationUtil.AllRows(found.m_Item, resp.before);
		bool known = KnownPath(doc.m_Items) != "";
		int countBefore = doc.m_Items.Count();
		LocalizationEditor locEditor = doc.m_Editor;
		locEditor.BeginModify(UNDO_DELETE);
		locEditor.DeleteItem(found.m_Id);
		locEditor.EndModify();

		NoteEdit(known, doc.m_Table);
		BaseContainerList itemsAfter = doc.m_Table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS);
		if (itemsAfter)
			resp.total = itemsAfter.Count();
		int left = EMCP_WB_LocalizationUtil.CountId(itemsAfter, found.m_Id);
		if (left > 0 || resp.total != countBefore - 1)
		{
			Answer(resp, "error", ENGINE_FALSE, "after DeleteItem the table holds " + resp.total.ToString() + " items (was " + countBefore.ToString() + ") and " + left.ToString() + " with Id '" + found.m_Id + "'", "wb_localization list");
			return;
		}
		Ok(resp, "deleted item " + found.m_Index.ToString() + " '" + found.m_Id + "'; before holds it for an insert; undo point '" + UNDO_DELETE + "'");
	}

	//------------------------------------------------------------------------------------------------
	//! filter: the Items indices whose column contains the text (case folded), AddUserFilter(rows,
	//! caption), RefreshUI, GetFilteredRows. No match refuses before the call.
	static void FilterRows(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		if (req.column == "" || req.filter == "")
		{
			Refuse(resp, INVALID_ARGUMENT, "give column and filter", COLUMNS_NEXT);
			return;
		}
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		int count = doc.m_Items.Count();
		string needle = req.filter;
		needle.ToLower();
		array<int> rowsIdx = {};
		bool fieldSeen = false;
		for (int i = 0; i < count; i++)
		{
			BaseContainer item = doc.m_Items.Get(i);
			if (!item)
				continue;
			int varIndex = item.GetVarIndex(req.column);
			if (varIndex < 0)
				continue;
			fieldSeen = true;
			string text = EMCP_WB_LocalizationUtil.ReadAsText(item, req.column, item.GetDataVarType(varIndex));
			text.ToLower();
			if (text.Contains(needle))
				rowsIdx.Insert(i);
		}
		if (!fieldSeen)
		{
			Refuse(resp, INVALID_ARGUMENT, "no item has a field " + req.column, COLUMNS_NEXT);
			return;
		}
		if (rowsIdx.IsEmpty())
		{
			Refuse(resp, ITEM_NOT_FOUND, "no item's " + req.column + " contains '" + req.filter + "'; no filter was added", "another text");
			return;
		}

		doc.m_Editor.AddUserFilter(rowsIdx, "EMCP " + req.column + " ~ " + req.filter);
		doc.m_Editor.RefreshUI();
		array<int> filteredRows = {};
		doc.m_Editor.GetFilteredRows(filteredRows);
		int filteredCount = 0;
		if (filteredRows)
		{
			filteredCount = filteredRows.Count();
			for (int j = 0; j < filteredCount && j < EMCP_WB_LocalizationUtil.ROWS_MAX; j++)
				resp.filtered.Insert(filteredRows.Get(j));
		}
		Ok(resp, rowsIdx.Count().ToString() + " item(s) matched; GetFilteredRows answers " + filteredCount.ToString() + " (row indices; that they are Items indices is probe P-W3-15)");
	}

	//------------------------------------------------------------------------------------------------
	//! save: WBModuleDef.Save of the table this handler opened, when its file is inside the open
	//! project; a dry run unless confirm is true. Both say what OD-5 and P-W3-16 leave open.
	static void SaveTable(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		if (!EMCP_WB_Guard.IsProjectFound())
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "save needs the handlers installed in the open project; nothing was saved", "install the handlers in the project you have open");
			return;
		}
		EMCP_WB_LocalizationDoc doc = new EMCP_WB_LocalizationDoc();
		if (!FindDoc(doc, resp))
			return;
		string known = KnownPath(doc.m_Items);
		if (known == "")
		{
			Refuse(resp, NO_DOCUMENT, "the open table was not opened through wb_localization open, or its items changed by hand, so its file is not known (probe P-W3-17); nothing was saved", "save it in the Localization Editor by hand, or open the .st through wb_localization open first");
			return;
		}
		resp.table = known;
		string absolute = "";
		string why = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(known, absolute, why))
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why + "; nothing was saved", "copy the table into the project and open the copy");
			return;
		}
		resp.warnings.Insert(OD5_SAVE);
		resp.warnings.Insert(SAVE_PLUGINS);
		resp.warnings.Insert(SAME_IDS_LIMIT);
		if (!req.confirm)
		{
			resp.dryRun = true;
			Ok(resp, "dry run: would save " + known + " (" + doc.m_Items.Count().ToString() + " items, " + s_iUnsaved.ToString() + " handler edit(s)); resend with confirm true");
			return;
		}
		bool saved = doc.m_Editor.Save();
		resp.saved = saved;
		if (!saved)
		{
			Answer(resp, "error", SAVE_FAILED, "WBModuleDef.Save returned false for " + known, "wb_localization status");
			return;
		}
		s_iUnsaved = 0;
		Ok(resp, "saved " + known);
	}

	//------------------------------------------------------------------------------------------------
	//! buildRuntime: GATED until probe P-W3-18 shows the menu path {Table, Build Runtime Table} builds
	//! without a dialog (DEC-063 OD-2). Nothing is sent.
	static void BuildRuntime(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		Refuse(resp, GATED, "buildRuntime waits for probe P-W3-18 (the menu path is unverified and may open a dialog); nothing was sent", "string_table buildRuntime (offline)");
	}

	//------------------------------------------------------------------------------------------------
	//! close: GATED until probe P-W3-19 (no call tells whether the table has unsaved edits, DEC-063
	//! OD-3). Nothing is sent.
	static void CloseTable(EMCP_WB_LocalizationRequest req, EMCP_WB_LocalizationResponse resp)
	{
		Refuse(resp, GATED, "close waits for probe P-W3-19 (no call tells whether the table has unsaved edits); nothing was sent", "the owner closes the Localization Editor by hand");
	}

	//------------------------------------------------------------------------------------------------
	//! Encode for every field against cont, into encoded (same order); false with code and why at the
	//! first field that does not encode.
	protected static bool EncodeAll(BaseContainer cont, notnull array<string> fieldNames, notnull array<string> fieldValues, notnull array<string> encoded, out string code, out string why)
	{
		code = "";
		why = "";
		encoded.Clear();
		for (int i = 0; i < fieldNames.Count(); i++)
		{
			string one = "";
			if (!EMCP_WB_LocalizationUtil.Encode(cont, fieldNames.Get(i), fieldValues.Get(i), one, code, why))
				return false;
			encoded.Insert(one);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The fields of item that do not read back as sent, "" when all do.
	protected static string Mismatch(BaseContainer item, notnull array<string> fieldNames, notnull array<string> encoded)
	{
		string listed = "";
		if (!item)
			return "the item cannot be read back";
		for (int i = 0; i < fieldNames.Count() && i < encoded.Count(); i++)
		{
			string fieldName = fieldNames.Get(i);
			int varIndex = item.GetVarIndex(fieldName);
			if (varIndex < 0)
				continue;
			DataVarType dataType = item.GetDataVarType(varIndex);
			string readBack = EMCP_WB_LocalizationUtil.ReadAsText(item, fieldName, dataType);
			if (EMCP_WB_LocalizationUtil.SameValue(dataType, readBack, encoded.Get(i)))
				continue;
			if (listed != "")
				listed += "; ";
			listed += fieldName + " reads back '" + readBack + "', sent '" + encoded.Get(i) + "'";
		}
		return listed;
	}
}
