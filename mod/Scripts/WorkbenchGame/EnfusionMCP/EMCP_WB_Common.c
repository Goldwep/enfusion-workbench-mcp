/**
 * EMCP_WB_Common.c - Shared helpers for the EnfusionMCP Workbench NetAPI handlers
 *
 * Static-only. Used by the EMCP_WB_* handlers to avoid duplicating entity lookup,
 * vector parsing/formatting, numeric validation and JSON escaping.
 */

class EMCP_WB_Common
{
	//------------------------------------------------------------------------------------------------
	//! Linear scan of the editor entity list for an exact name match. Returns null when not found.
	static IEntitySource FindEntityByName(WorldEditorAPI api, string name)
	{
		int count = api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			IEntitySource candidate = api.GetEditorEntity(i);
			if (candidate && candidate.GetName() == name)
				return candidate;
		}
		return null;
	}

	//------------------------------------------------------------------------------------------------
	//! Strict integer check: optional leading sign, then digits only. string.ToInt() would silently
	//! return 0 for non-numeric input, so callers must use this before ToInt().
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
	//! Strict float check: only digits, sign, '.', 'e'/'E' allowed and at least one digit.
	//! string.ToFloat() would silently return 0 for non-numeric input.
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

	//------------------------------------------------------------------------------------------------
	//! Parses "x y z", "x, y, z" or "x,y,z". Returns false (with a human-readable error) on any
	//! failure instead of silently yielding 0 0 0.
	static bool ParseVectorString(string str, out vector result, out string error)
	{
		result = vector.Zero;
		error = "";

		string s = str;
		s.Replace(",", " ");
		array<string> parts = {};
		s.Split(" ", parts, true);

		if (parts.Count() != 3)
		{
			error = "expected 3 numeric components ('x y z' or 'x, y, z'), got " + parts.Count().ToString() + " in '" + str + "'";
			return false;
		}

		for (int i = 0; i < 3; i++)
		{
			float f;
			if (!ParseFloat(parts[i], f))
			{
				error = "component " + i.ToString() + " ('" + parts[i] + "') is not a number in '" + str + "'";
				return false;
			}
			result[i] = f;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	static string VectorToString(vector v)
	{
		return v[0].ToString() + " " + v[1].ToString() + " " + v[2].ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! Escapes a string for embedding inside a hand-built JSON string literal.
	static string JsonEscape(string s)
	{
		string r = s;
		r.Replace("\\", "\\\\");
		r.Replace("\"", "\\\"");
		r.Replace("\n", "\\n");
		r.Replace("\r", "\\r");
		r.Replace("\t", "\\t");
		return r;
	}
}
