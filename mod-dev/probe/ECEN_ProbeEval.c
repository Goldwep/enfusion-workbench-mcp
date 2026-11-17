/**
 * ECEN_ProbeEval.c - The allow screen of evalCompile (read-only probe pack, development only)
 *
 * evalCompile compiles the text it is sent and calls it synchronously on the main thread
 * (ScriptModule.Call with async false blocks), so a text is compiled only when every token of it
 * passes this screen. It is an allow screen, not a deny screen: what is not listed is refused.
 *
 * The text must be exactly one function, "string ECEN_Eval() { ... }", at most MAX_TEXT
 * characters, with no comment, no preprocessor line and no character outside ASCII letters,
 * digits, white space and ( ) { } [ ] ; , . = < > ! + - * / & | % (string literals hold any text).
 * Every identifier must then be one of:
 *   - a method called on a receiver (".Name("): a getter by name (Get, Is, Has, Can, Find, Count
 *     or Contains followed by an upper-case letter, a digit, '_' or the end) or one of the
 *     METHODS list; never a name holding a BANNED substring;
 *   - a member that is not called (".NAME"): an upper-case constant only, so no field is read or
 *     written;
 *   - a keyword or built-in type of the KEYWORDS list; only "if" and "return" may stand before "(";
 *   - a class of the CLASSES list (a receiver of static getters, or the type of a local), never
 *     before "(";
 *   - an upper-case constant, never before "(" or ".";
 *   - a local: a name starting with a lower-case letter that is not on the REFUSED_KEYWORDS list,
 *     never before "(".
 * So the text cannot loop (while, for and foreach are refused), cannot recurse or call a global
 * function (no free identifier stands before "("), cannot allocate (new is refused), cannot
 * declare a class, cannot write a member, and calls only getters by name on listed classes and the
 * objects they return. A getter with a side effect is not excluded by its name alone: GetPlugin
 * focuses the module window (Bohemia's comment in SCR_AutotestPlugin), and a script class reached
 * through a getter runs its own script code [unverified that every such getter is read-only].
 */

class ECEN_ProbeEval
{
	//! The function the text defines and evalCompile calls.
	static const string EVAL_FUNCTION = "ECEN_Eval";
	//! Longest text evalCompile accepts.
	static const int MAX_TEXT = 2000;
	//! Characters a text may hold outside identifiers, numbers, string literals and white space.
	static const string PUNCTUATION = "(){}[];,.=<>!+-*/&|%";

	//------------------------------------------------------------------------------------------------
	//! Keywords and built-in types a text may use outside a member access.
	static void Keywords(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("string");
		outNames.Insert("int");
		outNames.Insert("float");
		outNames.Insert("bool");
		outNames.Insert("vector");
		outNames.Insert("auto");
		outNames.Insert("ref");
		outNames.Insert("array");
		outNames.Insert("typename");
		outNames.Insert("return");
		outNames.Insert("if");
		outNames.Insert("else");
		outNames.Insert("true");
		outNames.Insert("false");
		outNames.Insert("null");
	}

	//------------------------------------------------------------------------------------------------
	//! Lower-case words that are never a local's name: loops, allocation, declarations, modifiers.
	static void RefusedKeywords(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("while");
		outNames.Insert("for");
		outNames.Insert("foreach");
		outNames.Insert("do");
		outNames.Insert("goto");
		outNames.Insert("switch");
		outNames.Insert("case");
		outNames.Insert("break");
		outNames.Insert("continue");
		outNames.Insert("new");
		outNames.Insert("delete");
		outNames.Insert("thread");
		outNames.Insert("class");
		outNames.Insert("modded");
		outNames.Insert("static");
		outNames.Insert("typedef");
		outNames.Insert("enum");
		outNames.Insert("override");
		outNames.Insert("proto");
		outNames.Insert("native");
		outNames.Insert("external");
		outNames.Insert("event");
		outNames.Insert("sealed");
		outNames.Insert("private");
		outNames.Insert("protected");
		outNames.Insert("autoptr");
		outNames.Insert("out");
		outNames.Insert("inout");
		outNames.Insert("notnull");
		outNames.Insert("volatile");
		outNames.Insert("func");
		outNames.Insert("local");
		outNames.Insert("void");
	}

	//------------------------------------------------------------------------------------------------
	//! Classes a text may name: receivers of static getters and types of locals.
	static void Classes(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("Workbench");
		outNames.Insert("GameProject");
		outNames.Insert("FilePath");
		outNames.Insert("BaseContainer");
		outNames.Insert("BaseContainerList");
		outNames.Insert("DataVarType");
		outNames.Insert("WBModuleDef");
		outNames.Insert("WorldEditorAPI");
		outNames.Insert("WorkbenchPlugin");
		outNames.Insert("IEntitySource");
		outNames.Insert("IEntityComponentSource");
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
	//! Methods a text may call beside the getters by name: string reads and conversions, casts.
	static void Methods(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("Length");
		outNames.Insert("IndexOf");
		outNames.Insert("LastIndexOf");
		outNames.Insert("StartsWith");
		outNames.Insert("EndsWith");
		outNames.Insert("Substring");
		outNames.Insert("Trim");
		outNames.Insert("Join");
		outNames.Insert("Format");
		outNames.Insert("ToString");
		outNames.Insert("ToInt");
		outNames.Insert("ToFloat");
		outNames.Insert("EnumToString");
		outNames.Insert("Cast");
		outNames.Insert("ClassName");
		outNames.Insert("Type");
	}

	//------------------------------------------------------------------------------------------------
	//! Getter prefixes: a called method named <prefix> followed by an upper-case letter, a digit,
	//! '_' or nothing.
	static void GetterPrefixes(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("Get");
		outNames.Insert("Is");
		outNames.Insert("Has");
		outNames.Insert("Can");
		outNames.Insert("Find");
		outNames.Insert("Count");
		outNames.Insert("Contains");
	}

	//------------------------------------------------------------------------------------------------
	//! Substrings no identifier may hold, whatever else it matches (GetOrCreate..., IsOpen...).
	static void Banned(notnull array<string> outNames)
	{
		outNames.Clear();
		outNames.Insert("Save");
		outNames.Insert("Delete");
		outNames.Insert("Create");
		outNames.Insert("Exit");
		outNames.Insert("Run");
		outNames.Insert("Dialog");
		outNames.Insert("Set");
		outNames.Insert("Execute");
		outNames.Insert("Open");
		outNames.Insert("Close");
		outNames.Insert("Kill");
		outNames.Insert("Remove");
		outNames.Insert("Clear");
		outNames.Insert("Write");
		outNames.Insert("Move");
		outNames.Insert("Copy");
		outNames.Insert("Rename");
		outNames.Insert("UserName");
		outNames.Insert("Call");
		outNames.Insert("Compile");
		outNames.Insert("Spawn");
		outNames.Insert("Modify");
		outNames.Insert("Begin");
		outNames.Insert("Reload");
		outNames.Insert("Publish");
		outNames.Insert("Login");
		outNames.Insert("Upload");
		outNames.Insert("Workshop");
		outNames.Insert("Configure");
		outNames.Insert("Insert");
		outNames.Insert("Register");
		outNames.Insert("Rebuild");
		outNames.Insert("Duplicate");
		outNames.Insert("Replace");
		outNames.Insert("Paste");
		outNames.Insert("Switch");
		outNames.Insert("Focus");
		outNames.Insert("Regenerate");
		outNames.Insert("Export");
		outNames.Insert("Import");
		outNames.Insert("Process");
		outNames.Insert("Cmd");
	}

	//------------------------------------------------------------------------------------------------
	static bool InList(string name, array<string> names)
	{
		for (int i = 0; i < names.Count(); i++)
		{
			if (names.Get(i) == name)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! A letter or '_'.
	static bool IsIdentStart(int code)
	{
		if (code >= 65 && code <= 90)
			return true;
		if (code >= 97 && code <= 122)
			return true;
		return code == 95;
	}

	//------------------------------------------------------------------------------------------------
	//! A letter, a digit or '_'.
	static bool IsIdentPart(int code)
	{
		if (IsIdentStart(code))
			return true;
		return code >= 48 && code <= 57;
	}

	//------------------------------------------------------------------------------------------------
	//! An upper-case constant name: upper-case letters, digits and '_', an upper-case letter first.
	static bool IsConstantName(string name)
	{
		int len = name.Length();
		if (len == 0)
			return false;
		int first = name.ToAscii(0);
		if (first < 65 || first > 90)
			return false;
		for (int i = 1; i < len; i++)
		{
			int code = name.ToAscii(i);
			bool upper = code >= 65 && code <= 90;
			bool digit = code >= 48 && code <= 57;
			if (!upper && !digit && code != 95)
				return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A method name the text may call: a getter by name or one of Methods(); never a Banned() one.
	static bool MethodAllowed(string name)
	{
		array<string> methods = {};
		Methods(methods);
		if (InList(name, methods))
			return true;

		array<string> prefixes = {};
		GetterPrefixes(prefixes);
		for (int i = 0; i < prefixes.Count(); i++)
		{
			string prefix = prefixes.Get(i);
			if (!name.StartsWith(prefix))
				continue;
			int at = prefix.Length();
			if (at == name.Length())
				return true;
			int code = name.ToAscii(at);
			bool upper = code >= 65 && code <= 90;
			bool digit = code >= 48 && code <= 57;
			if (upper || digit || code == 95)
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The first Banned() substring name holds, or "".
	static string BannedPart(string name)
	{
		array<string> banned = {};
		Banned(banned);
		for (int i = 0; i < banned.Count(); i++)
		{
			string part = banned.Get(i);
			if (name.Contains(part))
				return part;
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! Splits text into tokens: identifiers as they are, every number as "0", every string literal
	//! as "\"\"", every punctuation character on its own. False with the reason for a comment, an
	//! unterminated string literal or a character outside the allowed set.
	static bool Tokens(string text, notnull array<string> outTokens, out string why)
	{
		outTokens.Clear();
		why = "";
		int len = text.Length();
		int i = 0;
		while (i < len)
		{
			int code = text.ToAscii(i);
			if (code == 32 || code == 9 || code == 10 || code == 13)
			{
				i++;
				continue;
			}
			if (IsIdentStart(code))
			{
				int start = i;
				i++;
				while (i < len && IsIdentPart(text.ToAscii(i)))
				{
					i++;
				}
				outTokens.Insert(text.Substring(start, i - start));
				continue;
			}
			if (code >= 48 && code <= 57)
			{
				i++;
				while (i < len)
				{
					int numberCode = text.ToAscii(i);
					if (!IsIdentPart(numberCode) && numberCode != 46)
						break;
					i++;
				}
				outTokens.Insert("0");
				continue;
			}
			if (code == 34)
			{
				i++;
				bool closed = false;
				while (i < len)
				{
					int literalCode = text.ToAscii(i);
					if (literalCode == 10 || literalCode == 13)
						break;
					if (literalCode == 92)
					{
						i += 2;
						continue;
					}
					i++;
					if (literalCode == 34)
					{
						closed = true;
						break;
					}
				}
				if (!closed)
				{
					why = "unterminated string literal";
					return false;
				}
				outTokens.Insert("\"\"");
				continue;
			}
			if (code == 47 && i + 1 < len)
			{
				int nextCode = text.ToAscii(i + 1);
				if (nextCode == 47 || nextCode == 42)
				{
					why = "comments are refused";
					return false;
				}
			}
			string ch = text.Get(i);
			if (!PUNCTUATION.Contains(ch))
			{
				why = "character code " + code.ToString() + " at " + i.ToString() + " is refused";
				return false;
			}
			outTokens.Insert(ch);
			i++;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True when an identifier token starts with a letter or '_' (numbers are "0", literals "\"\"").
	static bool IsIdentToken(string token)
	{
		if (token.Length() == 0)
			return false;
		return IsIdentStart(token.ToAscii(0));
	}

	//------------------------------------------------------------------------------------------------
	//! The screen: true when text may be compiled; false with the reason otherwise.
	static bool Screen(string text, out string why)
	{
		why = "";
		int textLength = text.Length();
		if (textLength == 0)
		{
			why = "text required";
			return false;
		}
		if (textLength > MAX_TEXT)
		{
			why = "the text is longer than " + MAX_TEXT.ToString() + " characters";
			return false;
		}

		array<string> tokens = {};
		if (!Tokens(text, tokens, why))
			return false;

		int count = tokens.Count();
		if (count < 6 || tokens.Get(0) != "string" || tokens.Get(1) != EVAL_FUNCTION || tokens.Get(2) != "(" || tokens.Get(3) != ")" || tokens.Get(4) != "{" || tokens.Get(count - 1) != "}")
		{
			why = "the text must be exactly one function: string " + EVAL_FUNCTION + "() { ... }";
			return false;
		}

		array<string> keywords = {};
		Keywords(keywords);
		array<string> refused = {};
		RefusedKeywords(refused);
		array<string> classes = {};
		Classes(classes);

		for (int k = 0; k < count; k++)
		{
			string token = tokens.Get(k);
			if (!IsIdentToken(token))
				continue;

			string previous = "";
			if (k > 0)
				previous = tokens.Get(k - 1);
			string next = "";
			if (k + 1 < count)
				next = tokens.Get(k + 1);
			bool member = previous == ".";
			bool called = next == "(";

			string banned = BannedPart(token);
			if (banned != "")
			{
				why = "'" + token + "' holds '" + banned + "'";
				return false;
			}
			if (token == EVAL_FUNCTION)
			{
				if (k != 1)
				{
					why = EVAL_FUNCTION + " may appear only as the name of the function";
					return false;
				}
				continue;
			}
			if (member)
			{
				if (called)
				{
					if (!MethodAllowed(token))
					{
						why = "'" + token + "' is not a getter or a listed method";
						return false;
					}
				}
				else if (!IsConstantName(token))
				{
					why = "member '" + token + "' is not called and not an upper-case constant (no field is read or written)";
					return false;
				}
				continue;
			}
			if (InList(token, refused))
			{
				why = "'" + token + "' is refused";
				return false;
			}
			if (InList(token, keywords))
			{
				if (called && token != "if" && token != "return")
				{
					why = "'" + token + "(' is refused";
					return false;
				}
				continue;
			}
			if (InList(token, classes))
			{
				if (called)
				{
					why = "'" + token + "(' is refused";
					return false;
				}
				continue;
			}
			if (IsConstantName(token))
			{
				if (called || next == ".")
				{
					why = "constant '" + token + "' may not be called or used as a receiver";
					return false;
				}
				continue;
			}
			int first = token.ToAscii(0);
			if (first >= 97 && first <= 122)
			{
				if (called)
				{
					why = "'" + token + "(': a text calls no global function and no function of its own";
					return false;
				}
				continue;
			}
			why = "'" + token + "' is not a listed class, keyword, constant or local name";
			return false;
		}
		return true;
	}
}
