/**
 * EMCP_WB_EntityRefResolver.c - The entity references of one request (wave W1, review R1)
 *
 * Not a handler, nothing here writes. EMCP_WB_EntityRef resolves one reference; a request that
 * resolves a list makes one of these so that its id: references share one id-to-index map.
 */

//! The answer of one entity reference (EMCP_WB_EntityRef.Resolve, EMCP_WB_EntityRefResolver.Resolve).
//! A holder class, as EMCP_WB_ContainerTarget carries its BaseContainer: Workbench 1.9.0.37 refuses
//! an out parameter of an engine type ("Types 'Class' and 'IEntitySource' are unrelated").
//! The engine pointer member carries no ref, exactly as EMCP_WB_ContainerTarget.m_Root.
class EMCP_WB_EntityRefResult
{
	IEntitySource m_Src;
	int m_Index;
	string m_Code;
	string m_Why;

	//------------------------------------------------------------------------------------------------
	//! Nothing resolved: m_Src null, m_Index -1, m_Code and m_Why empty.
	void Reset()
	{
		// Through a local: a null local of an engine type and a member assigned from a local are
		// the proven forms (EMCP_WB_Container.c); a member assigned null directly is not yet.
		IEntitySource none = null;
		m_Src = none;
		m_Index = -1;
		m_Code = "";
		m_Why = "";
	}
}

//! Resolves the entity references of one request. The first id: reference scans the editor list
//! as EMCP_WB_EntityRef.Resolve does; from the second on, the id-to-index map is built once (one
//! walk of the editor list) and reused, so a list of id: references costs one walk, not one each.
//! name: and index: references go straight to EMCP_WB_EntityRef. Make one per request.
class EMCP_WB_EntityRefResolver
{
	protected WorldEditorAPI m_Api;
	//! IdHex -> first editor index with that id; built on the second id: reference.
	protected ref map<string, int> m_IdIndex;
	//! IdHex -> how many editor entities carry it; more than one refuses as the scan does (review
	//! round 1, F4).
	protected ref map<string, int> m_IdMatches;
	protected int m_IdLookups;

	//------------------------------------------------------------------------------------------------
	void EMCP_WB_EntityRefResolver(WorldEditorAPI api)
	{
		m_Api = api;
		m_IdLookups = 0;
	}

	//------------------------------------------------------------------------------------------------
	//! EMCP_WB_EntityRef.Resolve, with the id map of this request.
	bool Resolve(string entityRef, notnull EMCP_WB_EntityRefResult res)
	{
		res.Reset();
		if (!m_Api || EMCP_WB_EntityRef.ID_BY_FIND || !entityRef.StartsWith(EMCP_WB_EntityRef.PREFIX_ID))
			return EMCP_WB_EntityRef.Resolve(m_Api, entityRef, res);

		m_IdLookups++;
		if (m_IdLookups < 2)
			return EMCP_WB_EntityRef.Resolve(m_Api, entityRef, res);

		int prefixLen = EMCP_WB_EntityRef.PREFIX_ID.Length();
		string hex = entityRef.Substring(prefixLen, entityRef.Length() - prefixLen);
		string norm = EMCP_WB_EntityRef.NormalizeHex(hex);
		if (norm == "")
		{
			res.m_Code = EMCP_WB_EntityRef.INVALID_ARGUMENT;
			res.m_Why = "id: takes 1 to 16 hex digits with an optional 0x, got '" + hex + "'";
			return false;
		}
		if (!m_IdIndex)
			BuildIdIndex();

		int count = m_Api.GetEditorEntityCount();
		int matches = 0;
		if (m_IdMatches.Find(norm, matches) && matches > 1)
		{
			res.m_Code = EMCP_WB_EntityRef.INVALID_ARGUMENT;
			res.m_Why = "id 0x" + norm + " names " + matches.ToString() + " editor entities; use name: or index:";
			return false;
		}
		int at = -1;
		if (m_IdIndex.Find(norm, at) && at >= 0 && at < count)
		{
			IEntitySource candidate = m_Api.GetEditorEntity(at);
			if (candidate)
			{
				res.m_Src = candidate;
				res.m_Index = at;
				return true;
			}
		}
		res.m_Code = EMCP_WB_EntityRef.ENTITY_NOT_FOUND;
		res.m_Why = "no editor entity with id 0x" + norm + " among " + count.ToString();
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! One walk of the editor list: IdHex -> the first index with that id, and how many carry it.
	protected void BuildIdIndex()
	{
		m_IdIndex = new map<string, int>();
		m_IdMatches = new map<string, int>();
		int count = m_Api.GetEditorEntityCount();
		for (int i = 0; i < count; i++)
		{
			IEntitySource candidate = m_Api.GetEditorEntity(i);
			if (!candidate)
				continue;
			string norm = EMCP_WB_EntityRef.IdHex(candidate);
			if (norm == "")
				continue;
			int seen = 0;
			if (m_IdMatches.Find(norm, seen))
			{
				m_IdMatches.Set(norm, seen + 1);
				continue;
			}
			m_IdMatches.Insert(norm, 1);
			m_IdIndex.Insert(norm, i);
		}
	}
}
