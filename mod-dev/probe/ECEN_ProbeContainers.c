/**
 * ECEN_ProbeContainers.c - BaseContainer reflection of the read-only probe pack
 *
 * containerDump (U8): a container of an open module. loadContainer (U16 read half): a resource
 * loaded with BaseContainerTools.LoadContainer. Both list, per variable, its path, name, data
 * type, default (GetDefaultAsString), set state (IsVariableSet, IsVariableSetDirectly), object
 * class and UI widget; never a current value. Objects and object arrays are followed down to
 * the requested depth (at most ECEN_ProbeUtil.MAX_DEPTH). Paged.
 */

class ECEN_ProbeContainers
{
	//! Columns of a dump row.
	static const int DUMP_COLUMNS = 8;

	//------------------------------------------------------------------------------------------------
	//! containerDump: GetContainer(index) of an open module. Never opens a module.
	static void ContainerDump(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		typename moduleType = ECEN_ProbeUtil.ModuleType(req.moduleName);
		if (!moduleType)
		{
			resp.Fail("module must be one of the ten module names (never ParticleEditor, DEC-042); got '" + req.moduleName + "'");
			return;
		}
		WBModuleDef wbModule = Workbench.GetModule(moduleType);
		if (!wbModule)
		{
			resp.Fail("module " + req.moduleName + " is not open; containerDump never opens a module");
			return;
		}

		int count = wbModule.GetNumContainers();
		int index = req.index;
		resp.Fact("module", req.moduleName);
		resp.Fact("containers", count.ToString());
		resp.Fact("index", index.ToString());
		if (index < 0 || index >= count)
		{
			resp.Fail("index out of range: the module holds " + count.ToString() + " containers");
			return;
		}

		BaseContainer cont = wbModule.GetContainer(index);
		if (!cont)
		{
			resp.Fail("GetContainer returned null");
			return;
		}
		Dump(cont, req, resp);
	}

	//------------------------------------------------------------------------------------------------
	//! loadContainer: BaseContainerTools.LoadContainer(path), read only. The path is a resource name
	//! ("{GUID}path/file.ext"); nothing is saved. A name ending in .ent (any case) is refused.
	static void LoadContainer(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		if (req.path == "")
		{
			resp.Fail("path required (a resource name)");
			return;
		}

		resp.Fact("path", ECEN_ProbeUtil.ShowPath(req.path));
		// A world file is never loaded: its load is unbounded and would run on the NET thread.
		string lowerPath = req.path;
		lowerPath.ToLower();
		if (lowerPath.EndsWith(".ent"))
		{
			resp.Fact("error", "world file refused");
			resp.Fail("loadContainer refuses a world file (.ent); send a .conf, .et or other small resource");
			return;
		}

		ResourceName resourceName = req.path;
		Resource holder = BaseContainerTools.LoadContainer(resourceName);
		if (!holder)
		{
			resp.Fail("LoadContainer returned null");
			return;
		}
		bool valid = holder.IsValid();
		resp.Fact("valid", valid.ToString());
		if (!valid)
		{
			resp.Fail("LoadContainer returned a resource that is not valid");
			return;
		}

		BaseResourceObject resourceObject = holder.GetResource();
		if (!resourceObject)
		{
			resp.Fail("GetResource returned null");
			return;
		}
		BaseContainer cont = resourceObject.ToBaseContainer();
		if (!cont)
		{
			resp.Fail("the resource is not a BaseContainer");
			return;
		}
		Dump(cont, req, resp);
	}

	//------------------------------------------------------------------------------------------------
	//! Facts about the root container and one page of its variable rows.
	static void Dump(BaseContainer root, ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		int depth = req.depth;
		if (depth < 0)
			depth = 0;
		if (depth > ECEN_ProbeUtil.MAX_DEPTH)
			depth = ECEN_ProbeUtil.MAX_DEPTH;

		int varCount = root.GetNumVars();
		int childCount = root.GetNumChildren();
		resp.Fact("className", root.GetClassName());
		resp.Fact("name", ECEN_ProbeUtil.ShowPath(root.GetName()));
		resp.Fact("variables", varCount.ToString());
		resp.Fact("children", childCount.ToString());
		resp.Fact("depth", depth.ToString());
		BaseContainer ancestor = root.GetAncestor();
		if (ancestor)
			resp.Fact("ancestorClass", ancestor.GetClassName());

		resp.SetColumns("path,name,type,default,set,setDirectly,objectClass,uiWidget");
		array<string> all = {};
		Walk(root, "", depth, all);
		int rows = all.Count() / DUMP_COLUMNS;
		bool capped = rows >= ECEN_ProbeUtil.MAX_ROWS;
		resp.Fact("capped", capped.ToString());
		ECEN_ProbeUtil.PageInto(resp, all, DUMP_COLUMNS, req.page);
		resp.Ok("container dump");
	}

	//------------------------------------------------------------------------------------------------
	//! Appends one row per variable of cont, then follows objects and object arrays while
	//! depthLeft is above zero. Stops at ECEN_ProbeUtil.MAX_ROWS rows.
	static void Walk(BaseContainer cont, string prefix, int depthLeft, array<string> all)
	{
		int varCount = cont.GetNumVars();
		for (int i = 0; i < varCount; i++)
		{
			if (all.Count() >= ECEN_ProbeUtil.MAX_ROWS * DUMP_COLUMNS)
				return;

			string varName = cont.GetVarName(i);
			DataVarType dataType = cont.GetDataVarType(i);
			string typeName = typename.EnumToString(DataVarType, dataType);
			string defaultText = "";
			bool hasDefault = cont.GetDefaultAsString(varName, defaultText);
			if (!hasDefault)
				defaultText = "";
			bool isSet = cont.IsVariableSet(varName);
			bool isSetDirectly = cont.IsVariableSetDirectly(varName);
			string widget = cont.GetUIWidget(i);
			string path = prefix + varName;

			string objectClass = "";
			BaseContainer child = null;
			BaseContainerList list = null;
			if (dataType == DataVarType.OBJECT)
			{
				objectClass = cont.GetObjectBaseClass(i);
				child = cont.GetObject(varName);
				if (child)
					objectClass = child.GetClassName();
			}
			else if (dataType == DataVarType.OBJECT_ARRAY)
			{
				objectClass = cont.GetObjectBaseClass(i);
				list = cont.GetObjectArray(varName);
			}

			all.Insert(path);
			all.Insert(varName);
			all.Insert(typeName);
			all.Insert(ECEN_ProbeUtil.ScrubHome(defaultText));
			all.Insert(isSet.ToString());
			all.Insert(isSetDirectly.ToString());
			all.Insert(objectClass);
			all.Insert(widget);

			if (depthLeft <= 0)
				continue;

			if (child)
				Walk(child, path + ".", depthLeft - 1, all);

			if (list)
			{
				int itemCount = list.Count();
				for (int k = 0; k < itemCount; k++)
				{
					if (all.Count() >= ECEN_ProbeUtil.MAX_ROWS * DUMP_COLUMNS)
						return;
					BaseContainer item = list.Get(k);
					if (!item)
						continue;
					string itemPath = path + "[" + k.ToString() + "]";
					all.Insert(itemPath);
					all.Insert("");
					all.Insert("element");
					all.Insert("");
					all.Insert("");
					all.Insert("");
					all.Insert(item.GetClassName());
					all.Insert("");
					Walk(item, itemPath + ".", depthLeft - 1, all);
				}
			}
		}
	}
}
