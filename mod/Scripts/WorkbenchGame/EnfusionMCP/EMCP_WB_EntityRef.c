/**
 * EMCP_WB_EntityRef.c - The entity reference of wave W1 (phase5-w1-spec.md section 1)
 *
 * Static only, not a handler, nothing here writes. A W1 handler names one World Editor entity by
 * a reference string:
 *   id:<hex>     the entity's EntityID ("0x" optional, 1 to 16 hex digits, any case)
 *   name:<name>  the first editor entity with that exact name
 *   index:<i>    the editor entity at that index (GetEditorEntity), decimal digits only
 * Resolve fills an EMCP_WB_EntityRefResult with the IEntitySource and its editor index, or answers
 * false with a code (ENTITY_NOT_FOUND or INVALID_ARGUMENT, the codes of src/manifest/vocabulary.ts)
 * and a why in it. A holder, not out parameters: an out IEntitySource does not compile.
 *
 * OD-9 (DEC-061): id: resolves by WorldEditorAPI.FindEntityByID(EntityID.FromInt(hi, lo)) when
 * probe P-W1-01 passes, else by a GetEditorEntity scan comparing GetID().ToString(). Both paths
 * are here; ID_BY_FIND picks one. It stays false (the scan): the W1 live run of 2026-11-11 showed
 * GetID().ToString() is not plain hex (every id came back empty), so IdHex now takes the hex the
 * text holds or, failing that, a stable digest of the text; FindEntityByID applies only when the
 * text is the EntityID in hex. get answers idText and runtimeIdText verbatim so the next run
 * records the engine's form (docs/v2/inbox/w1/fixup-1.md).
 */

class EMCP_WB_EntityRef
{
	//! OD-9: true = FindEntityByID(EntityID.FromInt(hi, lo)); false = the GetEditorEntity scan.
	//! Flip only after a live run shows idText is the EntityID in hex (a digest id never resolves
	//! through FindEntityByID).
	static const bool ID_BY_FIND = false;

	static const string PREFIX_ID = "id:";
	static const string PREFIX_NAME = "name:";
	static const string PREFIX_INDEX = "index:";
	//! Refusal codes, spelled as in src/manifest/vocabulary.ts ERROR_CODES.
	static const string ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND";
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string HEX_DIGITS = "0123456789abcdef";
	//! Hex digits of an EntityID (64 bits).
	static const int ID_DIGITS = 16;

	//------------------------------------------------------------------------------------------------
	//! Resolves an entity reference into res (EMCP_WB_EntityRefResult, in EMCP_WB_EntityRefResolver.c:
	//! an out parameter of an engine type such as IEntitySource does not compile, Workbench 1.9.0.37).
	//! On success res.m_Src is the entity source, res.m_Index its editor index
	//! (0 <= index < GetEditorEntityCount), m_Code and m_Why empty. On failure m_Src is null,
	//! m_Index -1, m_Code ENTITY_NOT_FOUND or INVALID_ARGUMENT and m_Why says what failed.
	static bool Resolve(WorldEditorAPI api, string entityRef, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		if (!api)
		{
			res.m_Code = ENTITY_NOT_FOUND;
			res.m_Why = "no World Editor API: open the World Editor with a world first";
			return false;
		}
		if (entityRef.StartsWith(PREFIX_ID))
			return ResolveId(api, entityRef.Substring(PREFIX_ID.Length(), entityRef.Length() - PREFIX_ID.Length()), res);
		if (entityRef.StartsWith(PREFIX_NAME))
			return ResolveName(api, entityRef.Substring(PREFIX_NAME.Length(), entityRef.Length() - PREFIX_NAME.Length()), res);
		if (entityRef.StartsWith(PREFIX_INDEX))
			return ResolveIndex(api, entityRef.Substring(PREFIX_INDEX.Length(), entityRef.Length() - PREFIX_INDEX.Length()), res);

		res.m_Code = INVALID_ARGUMENT;
		res.m_Why = "an entity reference is id:<hex>, name:<name> or index:<i>, got '" + entityRef + "'";
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! id:<hex>. Validates the hex, then takes the path ID_BY_FIND selects (OD-9).
	static bool ResolveId(WorldEditorAPI api, string hex, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		string norm = NormalizeHex(hex);
		if (norm == "")
		{
			res.m_Code = INVALID_ARGUMENT;
			res.m_Why = "id: takes 1 to 16 hex digits with an optional 0x, got '" + hex + "'";
			return false;
		}
		if (ID_BY_FIND)
			return ResolveIdByFind(api, norm, res);
		return ResolveIdByScan(api, norm, res);
	}

	//------------------------------------------------------------------------------------------------
	//! OD-9 path a: FindEntityByID(EntityID.FromInt(hi, lo)), then the editor index by a pointer scan.
	//! norm is NormalizeHex output (16 lower-case hex digits).
	static bool ResolveIdByFind(WorldEditorAPI api, string norm, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		int hi = 0;
		int lo = 0;
		if (!HexToInts(norm, hi, lo))
		{
			res.m_Code = INVALID_ARGUMENT;
			res.m_Why = "id: is not 16 hex digits after normalising: '" + norm + "'";
			return false;
		}
		IEntitySource found = api.FindEntityByID(EntityID.FromInt(hi, lo));
		if (!found)
		{
			res.m_Code = ENTITY_NOT_FOUND;
			res.m_Why = "no entity with id 0x" + norm;
			return false;
		}
		int at = IndexOf(api, found);
		if (at < 0)
		{
			res.m_Code = ENTITY_NOT_FOUND;
			res.m_Why = "the entity with id 0x" + norm + " is not in the editor entity list";
			return false;
		}
		res.m_Src = found;
		res.m_Index = at;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! OD-9 path b: scan the whole GetEditorEntity list comparing IdHex. Two entities with the same
	//! id answer INVALID_ARGUMENT (an id that does not name one entity is never acted on).
	static bool ResolveIdByScan(WorldEditorAPI api, string norm, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		int count = api.GetEditorEntityCount();
		int matches = 0;
		IEntitySource hit = null;
		int hitIndex = -1;
		for (int i = 0; i < count; i++)
		{
			IEntitySource candidate = api.GetEditorEntity(i);
			if (!candidate)
				continue;
			if (IdHex(candidate) == norm)
			{
				matches++;
				if (!hit)
				{
					hit = candidate;
					hitIndex = i;
				}
			}
		}
		if (matches == 1)
		{
			res.m_Src = hit;
			res.m_Index = hitIndex;
			return true;
		}
		if (matches > 1)
		{
			res.m_Code = INVALID_ARGUMENT;
			res.m_Why = "id 0x" + norm + " names " + matches.ToString() + " editor entities; use name: or index:";
			return false;
		}
		res.m_Code = ENTITY_NOT_FOUND;
		res.m_Why = "no editor entity with id 0x" + norm + " among " + count.ToString();
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! name:<name>: the first editor entity whose name is exactly that (case-sensitive).
	static bool ResolveName(WorldEditorAPI api, string entityName, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		if (entityName == "")
		{
			res.m_Code = INVALID_ARGUMENT;
			res.m_Why = "name: needs a name";
			return false;
		}
		int count = api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			IEntitySource candidate = api.GetEditorEntity(i);
			if (candidate && candidate.GetName() == entityName)
			{
				res.m_Src = candidate;
				res.m_Index = i;
				return true;
			}
		}
		res.m_Code = ENTITY_NOT_FOUND;
		res.m_Why = "no editor entity named '" + entityName + "' among " + count.ToString();
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! index:<i>: decimal digits only (no sign), 0 <= i < GetEditorEntityCount.
	static bool ResolveIndex(WorldEditorAPI api, string digits, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		int len = digits.Length();
		bool allDigits = len > 0 && len <= 9;
		for (int c = 0; c < len; c++)
		{
			if (!digits.IsDigitAt(c))
				allDigits = false;
		}
		if (!allDigits)
		{
			res.m_Code = INVALID_ARGUMENT;
			res.m_Why = "index: takes 1 to 9 decimal digits, got '" + digits + "'";
			return false;
		}
		int wanted = digits.ToInt();
		int count = api.GetEditorEntityCount();
		if (wanted >= count)
		{
			res.m_Code = ENTITY_NOT_FOUND;
			res.m_Why = "index " + wanted.ToString() + " is out of range (count " + count.ToString() + ")";
			return false;
		}
		IEntitySource candidate = api.GetEditorEntity(wanted);
		if (!candidate)
		{
			res.m_Code = ENTITY_NOT_FOUND;
			res.m_Why = "no editor entity at index " + wanted.ToString();
			return false;
		}
		res.m_Src = candidate;
		res.m_Index = wanted;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The editor index of an entity source, -1 when it is not in the list.
	static int IndexOf(WorldEditorAPI api, IEntitySource target)
	{
		if (!api || !target)
			return -1;
		int count = api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			if (api.GetEditorEntity(i) == target)
				return i;
		}
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! The id: reference of an entity source: "id:0x" + 16 lower-case hex digits (IdHex). "" for null
	//! or when the engine gives no id text.
	static string Format(IEntitySource entSrc)
	{
		if (!entSrc)
			return "";
		string norm = IdHex(entSrc);
		if (norm == "")
			return "";
		return PREFIX_ID + "0x" + norm;
	}

	//------------------------------------------------------------------------------------------------
	//! The id of an entity source as 16 lower-case hex digits, "" when it has none.
	//! W1 live run 2026-11-11 (P-W1-01): GetID().ToString() was not plain hex, so the id was empty
	//! everywhere. Now: the hex the text holds (plain, or after a "0x" inside it) is the EntityID;
	//! any other non-empty text gives a stable 64-bit digest of that text (Digest), so id: works on
	//! whatever form the engine prints. The text of EntityID.INVALID is no id.
	static string IdHex(IEntitySource entSrc)
	{
		if (!entSrc)
			return "";
		string raw = RawIdText(entSrc);
		if (raw == "" || raw == InvalidIdText())
			return "";
		string hex = HexOfText(raw);
		if (hex != "")
			return hex;
		return Digest(raw);
	}

	//------------------------------------------------------------------------------------------------
	//! GetID().ToString() of an entity source, trimmed and verbatim ("" for null). Recorded by get
	//! (idText) so a live run shows the engine's text form.
	static string RawIdText(IEntitySource entSrc)
	{
		if (!entSrc)
			return "";
		EntityID eid = entSrc.GetID();
		string text = eid.ToString();
		return text.Trim();
	}

	//------------------------------------------------------------------------------------------------
	//! The runtime entity's GetID().ToString() (SourceToEntity), trimmed; "" without one. The id
	//! vanilla World Editor tools keep and pass to BaseWorld.FindEntityByID (SCR_ObjectBrushTool).
	static string RuntimeIdText(WorldEditorAPI api, IEntitySource entSrc)
	{
		if (!api || !entSrc)
			return "";
		IEntity ent = api.SourceToEntity(entSrc);
		if (!ent)
			return "";
		EntityID eid = ent.GetID();
		string text = eid.ToString();
		return text.Trim();
	}

	//------------------------------------------------------------------------------------------------
	//! EntityID.INVALID as text, trimmed.
	static string InvalidIdText()
	{
		EntityID invalid = EntityID.INVALID;
		string text = invalid.ToString();
		return text.Trim();
	}

	//------------------------------------------------------------------------------------------------
	//! The hex an id text holds: the whole text (NormalizeHex), else the hex digits after the first
	//! "0x" in it. "" when there is none.
	static string HexOfText(string raw)
	{
		string whole = NormalizeHex(raw);
		if (whole != "")
			return whole;
		string lower = raw;
		lower.ToLower();
		int at = lower.IndexOf("0x");
		if (at < 0)
			return "";
		string digits = "";
		int len = lower.Length();
		for (int i = at + 2; i < len; i++)
		{
			string c = lower.Get(i);
			if (HEX_DIGITS.IndexOf(c) < 0)
				break;
			digits += c;
		}
		if (digits == "")
			return "";
		return NormalizeHex(digits);
	}

	//------------------------------------------------------------------------------------------------
	//! A stable 64-bit digest of a text as 16 lower-case hex digits (two string.Hash values).
	static string Digest(string raw)
	{
		string salted = raw + "|emcp";
		return IntHex(raw.Hash()) + IntHex(salted.Hash());
	}

	//------------------------------------------------------------------------------------------------
	//! The 32 bits of an int as 8 lower-case hex digits, high nibble first.
	static string IntHex(int value)
	{
		string text = "";
		for (int k = 7; k >= 0; k--)
		{
			int nibble = (value >> (4 * k)) & 15;
			text += HEX_DIGITS.Get(nibble);
		}
		return text;
	}

	//------------------------------------------------------------------------------------------------
	//! A hex id in canonical form: lower case, no "0x", left-padded with zeros to 16 digits. "" when
	//! the input is empty, has a non-hex character or more than 16 significant digits.
	static string NormalizeHex(string raw)
	{
		string s = raw.Trim();
		s.ToLower();
		if (s.StartsWith("0x"))
			s = s.Substring(2, s.Length() - 2);
		int len = s.Length();
		if (len == 0)
			return "";
		for (int i = 0; i < len; i++)
		{
			if (HEX_DIGITS.IndexOf(s.Get(i)) < 0)
				return "";
		}
		// Drop leading zeros beyond 16 digits, then pad to 16.
		while (s.Length() > ID_DIGITS && s.Get(0) == "0")
			s = s.Substring(1, s.Length() - 1);
		if (s.Length() > ID_DIGITS)
			return "";
		while (s.Length() < ID_DIGITS)
			s = "0" + s;
		return s;
	}

	//------------------------------------------------------------------------------------------------
	//! Splits 16 lower-case hex digits into the high and low 32 bits (EntityID.FromInt order).
	static bool HexToInts(string norm, out int hi, out int lo)
	{
		hi = 0;
		lo = 0;
		if (norm.Length() != ID_DIGITS)
			return false;
		for (int i = 0; i < ID_DIGITS; i++)
		{
			int digit = HEX_DIGITS.IndexOf(norm.Get(i));
			if (digit < 0)
			{
				hi = 0;
				lo = 0;
				return false;
			}
			if (i < 8)
				hi = (hi << 4) | digit;
			else
				lo = (lo << 4) | digit;
		}
		return true;
	}
}
