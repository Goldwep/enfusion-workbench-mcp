/**
 * EMCP_WB_ModifyEntity.c - Modify entity properties and transform
 *
 * Actions: move, rotate, rename, reparent, setProperty, clearProperty, getProperty, listProperties,
 *          listArrayItems, addArrayItem, removeArrayItem, setObjectClass, getWorldTransform, makeVisible
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_ModifyEntity"
 */

class EMCP_WB_ModifyEntityRequest : JsonApiStruct
{
	string name;
	string action;
	string value;
	string propertyPath;
	string propertyKey;
	int    memberIndex;

	void EMCP_WB_ModifyEntityRequest()
	{
		RegV("name");
		RegV("action");
		RegV("value");
		RegV("propertyPath");
		RegV("propertyKey");
		RegV("memberIndex");
	}
}

class EMCP_WB_EntityProperty
{
	string m_sName;
	string m_sType;
	string m_sValue;
}

class EMCP_WB_ModifyEntityResponse : JsonApiStruct
{
	string status;
	string message;
	string entityName;
	string action;
	ref array<ref EMCP_WB_EntityProperty> m_aProperties;

	void EMCP_WB_ModifyEntityResponse()
	{
		RegV("status");
		RegV("message");
		RegV("entityName");
		RegV("action");
		m_aProperties = {};
	}

	override void OnPack()
	{
		if (m_aProperties.Count() > 0)
		{
			StartArray("properties");
			for (int i = 0; i < m_aProperties.Count(); i++)
			{
				EMCP_WB_EntityProperty p = m_aProperties[i];
				StartObject("");
				StoreString("name", p.m_sName);
				StoreString("type", p.m_sType);
				StoreString("value", p.m_sValue);
				EndObject();
			}
			EndArray();
		}
	}
}

class EMCP_WB_ModifyEntity : NetApiHandler
{
	//------------------------------------------------------------------------------------------------
	// Build a ContainerIdPathEntry array from a dot-separated path string.
	// Supports array indices: "m_aTriggerActions[0].m_aNames" produces
	//   ContainerIdPathEntry("m_aTriggerActions", 0) then ContainerIdPathEntry("m_aNames").
	// Returns null if the path is empty (meaning target the entity root).
	static array<ref ContainerIdPathEntry> BuildPathEntries(string propertyPath)
	{
		if (propertyPath == "")
			return null;

		array<ref ContainerIdPathEntry> pathEntries = {};
		array<string> pathParts = {};
		propertyPath.Split(".", pathParts, true);
		for (int p = 0; p < pathParts.Count(); p++)
		{
			string part = pathParts[p];
			int bracketPos = part.IndexOf("[");
			if (bracketPos > -1)
			{
				int closeBracket = part.IndexOf("]");
				if (closeBracket <= bracketPos)
				{
					// Malformed bracket syntax - treat the whole part as a plain name
					pathEntries.Insert(new ContainerIdPathEntry(part));
					continue;
				}
				string name = part.Substring(0, bracketPos);
				string idxStr = part.Substring(bracketPos + 1, closeBracket - bracketPos - 1);
				int idx = idxStr.ToInt();
				pathEntries.Insert(new ContainerIdPathEntry(name, idx));
			}
			else
			{
				pathEntries.Insert(new ContainerIdPathEntry(part));
			}
		}
		return pathEntries;
	}

	//------------------------------------------------------------------------------------------------
	// Walks the same dot/bracket path as BuildPathEntries through the container tree and returns
	// the container that actually holds the final property (used for prechecks that must inspect
	// the real holder, not the top-level entity). Returns null with an error when a segment does
	// not resolve; the empty path returns top itself.
	static BaseContainer ResolveContainerPath(BaseContainer top, string propertyPath, out string error)
	{
		error = "";
		if (propertyPath == "")
			return top;

		BaseContainer cur = top;
		array<string> pathParts = {};
		propertyPath.Split(".", pathParts, true);
		for (int p = 0; p < pathParts.Count(); p++)
		{
			string part = pathParts[p];
			string name = part;
			int idx = -1;
			int bracketPos = part.IndexOf("[");
			if (bracketPos > -1)
			{
				int closeBracket = part.IndexOf("]");
				if (closeBracket > bracketPos)
				{
					name = part.Substring(0, bracketPos);
					idx = part.Substring(bracketPos + 1, closeBracket - bracketPos - 1).ToInt();
				}
			}

			BaseContainer next = null;
			if (idx >= 0)
			{
				BaseContainerList list = cur.GetObjectArray(name);
				if (list && idx < list.Count())
					next = list.Get(idx);
			}
			else
			{
				next = cur.GetObject(name);
			}

			if (!next)
			{
				error = "could not resolve '" + part + "' in propertyPath '" + propertyPath + "'";
				return null;
			}
			cur = next;
		}
		return cur;
	}

	//------------------------------------------------------------------------------------------------
	// Finds a component on the entity by class name, or null.
	static IEntityComponentSource FindComponentByClass(IEntitySource entSrc, string className)
	{
		int compCount = entSrc.GetComponentCount();
		for (int ci = 0; ci < compCount; ci++)
		{
			IEntityComponentSource c = entSrc.GetComponent(ci);
			if (c && c.GetClassName() == className)
				return c;
		}
		return null;
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ModifyEntityRequest();
	}

	//------------------------------------------------------------------------------------------------
	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ModifyEntityRequest req = EMCP_WB_ModifyEntityRequest.Cast(request);
		EMCP_WB_ModifyEntityResponse resp = new EMCP_WB_ModifyEntityResponse();
		resp.action = req.action;

		if (req.name == "")
		{
			resp.status = "error";
			resp.message = "name parameter required";
			return resp;
		}

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

		IEntitySource entSrc = EMCP_WB_Common.FindEntityByName(api, req.name);
		if (!entSrc)
		{
			resp.status = "error";
			resp.message = "Entity not found: " + req.name;
			return resp;
		}

		resp.entityName = entSrc.GetName();

		if (req.action == "move")
		{
			vector pos;
			string parseErr;
			if (!EMCP_WB_Common.ParseVectorString(req.value, pos, parseErr))
			{
				resp.status = "error";
				resp.message = "Invalid position for move: " + parseErr;
				return resp;
			}

			IEntity ent = api.SourceToEntity(entSrc);
			if (!ent)
			{
				resp.status = "error";
				resp.message = "Cannot get runtime entity for transform update";
				return resp;
			}

			// Position is the single "coords" vector property on the entity source. Write the
			// parsed (normalised) vector, not the raw request string, and check the bool.
			string coordsStr = EMCP_WB_Common.VectorToString(pos);

			api.BeginEntityAction("Move entity via NetAPI");
			bool moved = api.SetVariableValue(entSrc, null, "coords", coordsStr);
			api.EndEntityAction();

			if (moved)
			{
				resp.status = "ok";
				resp.message = "Entity moved to " + coordsStr;
			}
			else
			{
				resp.status = "error";
				resp.message = "SetVariableValue returned false for 'coords' (value '" + coordsStr + "')";
			}
		}
		else if (req.action == "rotate")
		{
			vector angles;
			string parseErr;
			if (!EMCP_WB_Common.ParseVectorString(req.value, angles, parseErr))
			{
				resp.status = "error";
				resp.message = "Invalid rotation for rotate: " + parseErr;
				return resp;
			}

			IEntity ent = api.SourceToEntity(entSrc);
			if (!ent)
			{
				resp.status = "error";
				resp.message = "Cannot get runtime entity for rotation update";
				return resp;
			}

			api.BeginEntityAction("Rotate entity via NetAPI");

			// Rotation is stored as a single "angles" vector property ("x y z"),
			// not separate angleX/angleY/angleZ keys (those fail SetVariableValue).
			string anglesStr = EMCP_WB_Common.VectorToString(angles);
			bool rotated = api.SetVariableValue(entSrc, null, "angles", anglesStr);

			api.EndEntityAction();
			if (rotated)
			{
				resp.status = "ok";
				resp.message = "Entity rotated to " + anglesStr;
			}
			else
			{
				resp.status = "error";
				resp.message = "SetVariableValue failed for 'angles' property";
			}
		}
		else if (req.action == "rename")
		{
			if (req.value == "")
			{
				resp.status = "error";
				resp.message = "value parameter required for rename (new name)";
				return resp;
			}

			api.BeginEntityAction("Rename entity via NetAPI");
			bool renamed = api.RenameEntity(entSrc, req.value);
			api.EndEntityAction();

			if (renamed)
			{
				resp.status = "ok";
				resp.message = "Entity renamed to: " + req.value;
			}
			else
			{
				resp.status = "error";
				resp.message = "RenameEntity returned false";
			}
		}
		else if (req.action == "reparent")
		{
			if (req.value == "")
			{
				resp.status = "error";
				resp.message = "value parameter required for reparent (parent entity name)";
				return resp;
			}

			IEntitySource parentSrc = EMCP_WB_Common.FindEntityByName(api, req.value);
			if (!parentSrc)
			{
				resp.status = "error";
				resp.message = "Parent entity not found: " + req.value;
				return resp;
			}

			if (parentSrc == entSrc)
			{
				resp.status = "error";
				resp.message = "Cannot reparent an entity to itself";
				return resp;
			}

			api.BeginEntityAction("Reparent entity via NetAPI");
			// false = keep local coords, true would convert world pos causing offset
			bool parented = api.ParentEntity(parentSrc, entSrc, false);
			api.EndEntityAction();

			if (parented)
			{
				resp.status = "ok";
				resp.message = "Entity reparented to: " + req.value;
			}
			else
			{
				resp.status = "error";
				resp.message = "ParentEntity returned false (parent may be a descendant, locked, or in another sub-scene)";
			}
		}
		else if (req.action == "setProperty")
		{
			if (req.propertyKey == "")
			{
				resp.status = "error";
				resp.message = "propertyKey parameter required for setProperty";
				return resp;
			}

			array<ref ContainerIdPathEntry> pathEntries = BuildPathEntries(req.propertyPath);

			api.BeginEntityAction("Set property via NetAPI");
			bool result = api.SetVariableValue(entSrc, pathEntries, req.propertyKey, req.value);
			api.EndEntityAction();

			if (result)
			{
				resp.status = "ok";
				resp.message = "Property '" + req.propertyKey + "' set to '" + req.value + "'";
			}
			else
			{
				resp.status = "error";
				resp.message = "SetVariableValue returned false for key: " + req.propertyKey;
			}
		}
		else if (req.action == "clearProperty")
		{
			if (req.propertyKey == "")
			{
				resp.status = "error";
				resp.message = "propertyKey parameter required for clearProperty";
				return resp;
			}

			array<ref ContainerIdPathEntry> pathEntries = BuildPathEntries(req.propertyPath);

			api.BeginEntityAction("Clear property via NetAPI");
			bool result = api.ClearVariableValue(entSrc, pathEntries, req.propertyKey);
			api.EndEntityAction();

			if (result)
			{
				resp.status = "ok";
				resp.message = "Property '" + req.propertyKey + "' cleared";
			}
			else
			{
				resp.status = "error";
				resp.message = "ClearVariableValue returned false for key: " + req.propertyKey;
			}
		}
		else if (req.action == "getProperty")
		{
			if (req.propertyKey == "")
			{
				resp.status = "error";
				resp.message = "propertyKey parameter required for getProperty";
				return resp;
			}

			// WorldEditorAPI has no GetVariableValue - use BaseContainer.Get() instead.
			BaseContainer source = entSrc;
			if (req.propertyPath != "")
			{
				source = FindComponentByClass(entSrc, req.propertyPath);
				if (!source)
				{
					resp.status = "error";
					resp.message = "Component not found: " + req.propertyPath;
					return resp;
				}
			}

			string val;
			if (source.Get(req.propertyKey, val))
			{
				resp.status = "ok";
				resp.message = val;
			}
			else
			{
				resp.status = "error";
				resp.message = "Get() returned false for '" + req.propertyKey + "' (property does not exist or is not string-convertible)";
			}
		}
		else if (req.action == "listProperties")
		{
			BaseContainer source = entSrc;
			if (req.propertyPath != "")
			{
				source = FindComponentByClass(entSrc, req.propertyPath);
				if (!source)
				{
					resp.status = "error";
					resp.message = "Component not found: " + req.propertyPath;
					return resp;
				}
			}

			int numVars = source.GetNumVars();
			for (int v = 0; v < numVars; v++)
			{
				string varName = source.GetVarName(v);
				string varValue = "";
				source.Get(varName, varValue);

				EMCP_WB_EntityProperty prop = new EMCP_WB_EntityProperty();
				prop.m_sName = varName;
				prop.m_sType = "";  // type info not available via script API - leave empty
				prop.m_sValue = varValue;
				resp.m_aProperties.Insert(prop);
			}

			resp.status = "ok";
			resp.message = "Listed " + resp.m_aProperties.Count().ToString() + " properties";
			if (req.propertyPath != "")
				resp.message = resp.message + " of " + req.propertyPath;
		}
		else if (req.action == "listArrayItems")
		{
			// Reads an array-of-objects property and returns each item's class name and index.
			// propertyPath = component class name (or "" for entity level)
			// propertyKey  = array property name (e.g. "Slots", "m_aTriggerActions")
			if (req.propertyKey == "")
			{
				resp.status = "error";
				resp.message = "propertyKey (array name) required for listArrayItems";
				return resp;
			}

			BaseContainer source = entSrc;
			if (req.propertyPath != "")
			{
				source = FindComponentByClass(entSrc, req.propertyPath);
				if (!source)
				{
					resp.status = "error";
					resp.message = "Component not found: " + req.propertyPath;
					return resp;
				}
			}

			BaseContainerList itemList = source.GetObjectArray(req.propertyKey);
			if (!itemList)
			{
				resp.status = "ok";
				resp.message = "[] (empty or not an object array)";
				return resp;
			}

			string listResult = "";
			int itemCount = itemList.Count();
			for (int li = 0; li < itemCount; li++)
			{
				BaseContainer item = itemList.Get(li);
				string className = "";
				if (item)
					className = item.GetClassName();
				else
					className = "(null)";
				if (listResult != "") listResult += ", ";
				listResult += li.ToString() + ":" + className;
			}

			resp.status = "ok";
			resp.message = "[" + listResult + "] (" + itemCount.ToString() + " items)";
		}
		else if (req.action == "addArrayItem")
		{
			// Creates a new element in an array-of-objects property (the + button in the editor).
			// propertyPath = component class name (or "" for entity level)
			// propertyKey  = array property name (e.g. "m_aTriggerActions")
			// value        = class name of the new item (e.g. "SCR_ScenarioFrameworkActionSpawnObjects")
			// memberIndex  = index to insert at (-1 = append at end)
			if (req.propertyKey == "" || req.value == "")
			{
				resp.status = "error";
				resp.message = "propertyKey (array name) and value (item class name) required for addArrayItem";
				return resp;
			}

			// Use component as topLevel if propertyPath is a component class name.
			// NOTE: CreateObjectArrayVariableMember requires the component as topLevel with null path -
			// passing the entity with a path entry returns false for component arrays.
			BaseContainer addTopLevel = entSrc;
			BaseContainer addHolder = entSrc;
			array<ref ContainerIdPathEntry> pathEntries = null;
			if (req.propertyPath != "")
			{
				IEntityComponentSource addComp = FindComponentByClass(entSrc, req.propertyPath);
				if (addComp)
				{
					addTopLevel = addComp;
					addHolder = addComp;
				}
				else
				{
					// Not a component: treat as a nested property path under the entity.
					pathEntries = BuildPathEntries(req.propertyPath);
					string resolveErr;
					addHolder = ResolveContainerPath(entSrc, req.propertyPath, resolveErr);
				}
			}

			// Precheck (emcp-1): only when the holder could be resolved script-side. When it could
			// not, fall through and let the engine resolve the path (it may accept forms this walker
			// does not), reporting its bool instead of refusing outright.
			int insertIdx = req.memberIndex;
			if (insertIdx < 0)
				insertIdx = -1; // will be treated as append by the API

			if (addHolder)
			{
				if (addHolder.GetVarIndex(req.propertyKey) < 0)
				{
					resp.status = "error";
					resp.message = "Property '" + req.propertyKey + "' not found on " + addHolder.GetClassName();
					return resp;
				}

				BaseContainerList addList = addHolder.GetObjectArray(req.propertyKey);
				int addCount = 0;
				if (addList)
					addCount = addList.Count();
				if (insertIdx > addCount)
				{
					resp.status = "error";
					resp.message = "memberIndex " + insertIdx.ToString() + " out of range for insert into '" + req.propertyKey + "' (array has " + addCount.ToString() + " items; use -1 to append)";
					return resp;
				}
			}

			api.BeginEntityAction("Add array item via NetAPI");
			bool result = api.CreateObjectArrayVariableMember(addTopLevel, pathEntries, req.propertyKey, req.value, insertIdx);
			api.EndEntityAction();

			if (result)
			{
				resp.status = "ok";
				resp.message = "Added '" + req.value + "' to '" + req.propertyKey + "' at index " + insertIdx.ToString();
			}
			else
			{
				resp.status = "error";
				resp.message = "CreateObjectArrayVariableMember returned false - check class name and property key";
			}
		}
		else if (req.action == "removeArrayItem")
		{
			// Removes an element from an array-of-objects property by index.
			// propertyPath = component class name (or "" for entity level)
			// propertyKey  = array property name
			// memberIndex  = 0-based index to remove
			if (req.propertyKey == "")
			{
				resp.status = "error";
				resp.message = "propertyKey (array name) required for removeArrayItem";
				return resp;
			}

			// Use component as topLevel if propertyPath is a component class name.
			// NOTE: RemoveObjectArrayVariableMember requires the component as topLevel with null path -
			// passing the entity with a path entry returns false for component arrays.
			BaseContainer removeTopLevel = entSrc;
			BaseContainer removeHolder = entSrc;
			array<ref ContainerIdPathEntry> removePathEntries = null;
			if (req.propertyPath != "")
			{
				IEntityComponentSource removeComp = FindComponentByClass(entSrc, req.propertyPath);
				if (removeComp)
				{
					removeTopLevel = removeComp;
					removeHolder = removeComp;
				}
				else
				{
					removePathEntries = BuildPathEntries(req.propertyPath);
					string resolveErr;
					removeHolder = ResolveContainerPath(entSrc, req.propertyPath, resolveErr);
					if (!removeHolder)
					{
						// The inherited-array guard below must inspect the real holder; refusing is
						// safer than guessing, because a wrong guess can crash Workbench.
						resp.status = "error";
						resp.message = "removeArrayItem: " + resolveErr + " (use a component class name, or a resolvable dotted path)";
						return resp;
					}
				}
			}

			if (removeHolder.GetVarIndex(req.propertyKey) < 0)
			{
				resp.status = "error";
				resp.message = "Property '" + req.propertyKey + "' not found on " + removeHolder.GetClassName();
				return resp;
			}

			BaseContainerList removeCheckList = removeHolder.GetObjectArray(req.propertyKey);
			int removeCheckCount = 0;
			if (removeCheckList)
				removeCheckCount = removeCheckList.Count();

			if (req.memberIndex < 0 || req.memberIndex >= removeCheckCount)
			{
				resp.status = "error";
				resp.message = "memberIndex " + req.memberIndex.ToString() + " out of range for '" + req.propertyKey + "' (array has " + removeCheckCount.ToString() + " items)";
				return resp;
			}

			// Safety check: if the array is only inherited (not set directly on the holder),
			// RemoveObjectArrayVariableMember will crash Workbench. Refuse with a clear error.
			BaseContainer removeAncestor = removeHolder.GetAncestor();
			int ancestorCount = 0;
			if (removeAncestor)
			{
				BaseContainerList ancestorList = removeAncestor.GetObjectArray(req.propertyKey);
				if (ancestorList)
					ancestorCount = ancestorList.Count();
			}

			if (!removeHolder.IsVariableSetDirectly(req.propertyKey) && removeCheckCount == ancestorCount)
			{
				resp.status = "error";
				resp.message = "Cannot remove from '" + req.propertyKey + "': all items are inherited from a parent prefab. " +
					"Edit the .et file directly and set an empty '" + req.propertyKey + " {}' block to override inherited items.";
				return resp;
			}

			api.BeginEntityAction("Remove array item via NetAPI");
			bool result = api.RemoveObjectArrayVariableMember(removeTopLevel, removePathEntries, req.propertyKey, req.memberIndex);
			api.EndEntityAction();

			if (result)
			{
				resp.status = "ok";
				resp.message = "Removed index " + req.memberIndex.ToString() + " from '" + req.propertyKey + "'";
			}
			else
			{
				resp.status = "error";
				resp.message = "RemoveObjectArrayVariableMember returned false - check index and property key";
			}
		}
		else if (req.action == "setObjectClass")
		{
			// Changes the class of an existing object property or array element (the dropdown in the editor).
			// propertyPath = component class name (e.g. "SCR_ScenarioFrameworkArea")
			// propertyKey  = property name of the object whose class is being changed
			// value        = new class name
			// The full path to the target is propertyPath + propertyKey.
			if (req.propertyKey == "" || req.value == "")
			{
				resp.status = "error";
				resp.message = "propertyKey and value (new class name) required for setObjectClass";
				return resp;
			}

			// Precheck (emcp-1): when the owning container can be resolved script-side, the target
			// property must exist on it. If propertyPath is a component class name, resolve that
			// component directly; otherwise walk it as a dotted path. Unresolvable paths fall
			// through to the engine call, which reports its own bool.
			BaseContainer ownerHolder = entSrc;
			if (req.propertyPath != "")
			{
				ownerHolder = FindComponentByClass(entSrc, req.propertyPath);
				if (!ownerHolder)
				{
					string resolveErr;
					ownerHolder = ResolveContainerPath(entSrc, req.propertyPath, resolveErr);
				}
			}
			if (ownerHolder && ownerHolder.GetVarIndex(req.propertyKey) < 0)
			{
				resp.status = "error";
				resp.message = "Property '" + req.propertyKey + "' not found on " + ownerHolder.GetClassName();
				return resp;
			}

			// Build path including propertyKey so ChangeObjectClass targets the correct object
			string fullPath = req.propertyPath;
			if (fullPath != "")
				fullPath += ".";
			fullPath += req.propertyKey;

			array<ref ContainerIdPathEntry> pathEntries = BuildPathEntries(fullPath);

			api.BeginEntityAction("Set object class via NetAPI");
			bool result = api.ChangeObjectClass(entSrc, pathEntries, req.value);
			api.EndEntityAction();

			if (result)
			{
				resp.status = "ok";
				resp.message = "Changed class of '" + req.propertyKey + "' to '" + req.value + "'";
			}
			else
			{
				resp.status = "error";
				resp.message = "ChangeObjectClass returned false - check class name";
			}
		}
		else if (req.action == "getWorldTransform")
		{
			// Read position and rotation from the entity source.
			// "coords" = world position, "angles" = euler rotation - both single vector
			// properties. Unset properties leave the vector at zero (entity defaults).
			vector coords, angles;
			entSrc.Get("coords", coords);
			entSrc.Get("angles", angles);

			EMCP_WB_EntityProperty posProp = new EMCP_WB_EntityProperty();
			posProp.m_sName = "position";
			posProp.m_sType = "vector";
			posProp.m_sValue = EMCP_WB_Common.VectorToString(coords);
			resp.m_aProperties.Insert(posProp);

			EMCP_WB_EntityProperty rotProp = new EMCP_WB_EntityProperty();
			rotProp.m_sName = "rotation";
			rotProp.m_sType = "vector";
			rotProp.m_sValue = EMCP_WB_Common.VectorToString(angles);
			resp.m_aProperties.Insert(rotProp);

			resp.status = "ok";
			resp.message = "Transform for: " + req.name;
		}
		else if (req.action == "makeVisible")
		{
			// Selecting the entity focuses it in the World Editor hierarchy (SetEntitySelection exists
			// in the public WorldEditorAPI). Report the position as well so the user knows where to look.
			api.SetEntitySelection(entSrc);

			vector coords;
			entSrc.Get("coords", coords);
			string coordsStr = EMCP_WB_Common.VectorToString(coords);

			bool selected = false;
			if (api.GetSelectedEntitiesCount() > 0)
			{
				IEntitySource sel = api.GetSelectedEntity(0);
				if (sel && sel.GetName() == entSrc.GetName())
					selected = true;
			}

			if (selected)
			{
				resp.status = "ok";
				resp.message = "Entity '" + req.name + "' selected in hierarchy; position " + coordsStr;
			}
			else
			{
				resp.status = "error";
				resp.message = "SetEntitySelection did not take effect for '" + req.name + "' (position " + coordsStr + ")";
			}
		}
		else
		{
			resp.status = "error";
			resp.message = "Unknown action: " + req.action + ". Valid: move, rotate, rename, reparent, setProperty, clearProperty, getProperty, listProperties, listArrayItems, addArrayItem, removeArrayItem, setObjectClass, getWorldTransform, makeVisible";
		}

		return resp;
	}
}
