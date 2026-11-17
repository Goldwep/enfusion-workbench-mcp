/**
 * EMCP_WB_Prefabs.c - Prefab handler of wb_prefabs (wave W1, phase5-w1-spec.md section 2.7)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Prefabs", dispatching on "action":
 *   getAncestor     the prefab an entity inherits from (BaseContainer.GetAncestor, 1.x)
 *   createTemplate  CreateEntityTemplate(entity, abs) to a NEW project-relative .et (1.x call);
 *                   project+target(new), dry run unless confirm
 *   save            SaveEntityTemplate of the prefab side (the ancestor) of an entity (default: the
 *                   prefab edit root) into its prefab's .et, which must be a file of the project (P-W1-18); dry run unless confirm
 *   editState       WorldEditor.IsPrefabEditMode and SCR_WorldEditorToolHelper
 *                   .GetPrefabEditModeEntitySource: the root, its prefab and its child count
 *   addMembers      AddPrefabMembers(the member's prefab-side source, one new GenericEntity source whose
 *                   ancestor is `prefab`) in prefab edit mode (P-W1-18), one undo step
 *   removeMembers   RemovePrefabMembers(the prefab-side children of the given instance children) in
 *                   prefab edit mode, one undo step; a non-member is refused, never passed on
 *   moveToPrefab    MoveEntitiesToPrefab(instance, its prefab source, entities, convert), one undo step
 *
 * The three member calls follow the vanilla call sites (SCR_GenerateWindowsPrefabsTool.RefreshPrefab,
 * SCR_SocketSpawnerPlugin.ProcessSinglePrefab, SCR_PrefabBoneSnappingTool): the prefab side is the
 * instance's ancestor; RemovePrefabMembers gets ancestor.GetChild(i) for the instance's child i and
 * never an empty list; AddPrefabMembers gets fresh "nowhere used" sources (BaseContainerTools
 * .CreateContainer, SetAncestor), held until the call returns. Fix-up 2: a world entity passed to
 * RemovePrefabMembers crashed Workbench 1.9.0.37 (access violation, live run of 2026-11-11), and
 * AddPrefabMembers answered false for world entities.
 *   clone           a copy of a prefab at a new project .et (P-W1-19), dry run unless confirm
 *   createChild     a new project .et inheriting a prefab (P-W1-19), dry run unless confirm
 *
 * clone and createChild make the calls of SCR_PrefabHelper.ClonePrefab / CreateChildPrefab
 * (CreateEntity of the prefab, CreateEntityTemplate of its ancestor or of the instance, the
 * temporary instance deleted, GetMetaFile for the resource name) without the helper itself: the
 * helper calls FileIO.FileExists and FileIO.MakeDirectory, which a shipped handler never calls
 * (DEC-048, DEC-053/U27). The guard's NewTargetInProject requires the folder to exist instead.
 *
 * Entities are named by EMCP_WB_EntityRef (id:<hex> | name:<name> | index:<i>). No file method is
 * called. A refusal answers status refused, code, next and a message "CODE: text | next: step"
 * (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Prefabs.json.
 */

class EMCP_WB_PrefabsRequest : JsonApiStruct
{
	string action;
	// getAncestor, createTemplate, save: entity reference
	string entity;
	// createTemplate, clone, createChild: new project-relative .et
	string path;
	// mutating file actions: true writes; else a dry run
	bool confirm;
	// addMembers: the instance (in the edited prefab) whose prefab-side source gets the new member
	string member;
	// removeMembers, moveToPrefab: entity references, at most 200
	ref array<string> entities;
	// moveToPrefab: the prefab instance in the world
	string parent;
	// moveToPrefab: world to local transforms (default true)
	bool convertTransform;
	// clone, createChild: the source prefab; addMembers: the new member's prefab ({GUID}path.et)
	string prefab;

	void EMCP_WB_PrefabsRequest()
	{
		entities = {};

		RegV("action");
		RegV("entity");
		RegV("path");
		RegV("confirm");
		RegV("member");
		RegV("entities");
		RegV("parent");
		RegV("convertTransform");
		RegV("prefab");

		confirm = false;
		convertTransform = true;
	}
}

class EMCP_WB_PrefabsResponse : JsonApiStruct
{
	// ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	// getAncestor
	string ancestorPath;
	// createTemplate, clone, createChild, editState
	string resourceName;
	bool dryRun;
	string savedPath;
	// editState
	bool prefabEdit;
	string rootId;
	int memberCount;
	// addMembers: the prefab added; removeMembers, moveToPrefab: ids; undoName also for
	// createTemplate, clone and createChild (each one undo step)
	ref array<string> added;
	string undoName;
	ref array<string> removed;
	ref array<string> moved;

	void EMCP_WB_PrefabsResponse()
	{
		added = {};
		removed = {};
		moved = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("ancestorPath");
		RegV("resourceName");
		RegV("dryRun");
		RegV("savedPath");
		RegV("prefabEdit");
		RegV("rootId");
		RegV("memberCount");
		RegV("added");
		RegV("undoName");
		RegV("removed");
		RegV("moved");
	}
}

class EMCP_WB_PrefabsUtil
{
	//! Entity references one call takes at most.
	static const int MAX_ENTITIES = 200;
	static const string PREFAB_EXT = ".et";
	static const string UNDO_PREFIX = "EMCP wb_prefabs ";
	static const string NEXT_PROJECT = "install the handlers in the project you have open";
	static const string NEXT_REF = "wb_entity list, then pass the id: it answers";

	//------------------------------------------------------------------------------------------------
	//! Sets a refusal: status refused, code, next and the message "CODE: text | next: step".
	static void Refuse(EMCP_WB_PrefabsResponse resp, string code, string text, string nextStep)
	{
		resp.status = EMCP_WB_Guard.REFUSED;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! BeginEntityAction(pointName); false with the refusal written (ENGINE_FALSE, nothing changed)
	//! when it did not open an action, so EndEntityAction never closes an action this handler did
	//! not begin (review P2).
	static bool BeginEdit(WorldEditorAPI api, string pointName, EMCP_WB_PrefabsResponse resp)
	{
		if (api.BeginEntityAction(pointName))
			return true;
		Refuse(resp, "ENGINE_FALSE", "BeginEntityAction returned false (an edit action is already open); nothing was changed", "finish the open edit in the World Editor, then retry");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The entity source of an entity's ancestor (GetAncestor, then ToEntitySource), null when the
	//! entity has no ancestor (review P1: IEntitySource.Cast does not test for an entity source).
	static IEntitySource AncestorSource(IEntitySource entSrc)
	{
		if (!entSrc)
			return null;
		BaseContainer ancestor = entSrc.GetAncestor();
		if (!ancestor)
			return null;
		return ancestor.ToEntitySource();
	}

	//------------------------------------------------------------------------------------------------
	//! An engine call that returned false: status error, code ENGINE_FALSE.
	static void EngineFalse(EMCP_WB_PrefabsResponse resp, string text, string nextStep)
	{
		resp.status = "error";
		resp.code = "ENGINE_FALSE";
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage("ENGINE_FALSE", EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused NOT_IN_PROJECT) when the project is not found (DEC-058).
	static bool ProjectRefused(EMCP_WB_PrefabsResponse resp)
	{
		string addonId = "";
		string projectDir = "";
		string why = "";
		if (EMCP_WB_Guard.Project(addonId, projectDir, why))
			return false;
		Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, why, NEXT_PROJECT);
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The World Editor's API, or null with the response refused (MODULE_NOT_OPEN or NO_WORLD).
	//! GetModule opens a closed World Editor (DEC-053).
	static WorldEditorAPI Api(EMCP_WB_PrefabsResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			Refuse(resp, "NO_WORLD", "the World Editor has no API: no world is open", "open a world or a prefab in the World Editor");
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, "NO_WORLD", noWorld, "open a world or a prefab in the World Editor");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused WRONG_MODE) when the World Editor is in play mode.
	static bool PlayRefused(WorldEditorAPI api, EMCP_WB_PrefabsResponse resp)
	{
		if (!api.IsGameMode())
			return false;
		Refuse(resp, "WRONG_MODE", "the World Editor is in play mode; prefab edits run in edit mode only", "wb_world stop");
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! True (and the response refused WRONG_MODE) when the World Editor is not in prefab edit mode.
	static bool NotPrefabEditRefused(EMCP_WB_PrefabsResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (worldEditor && worldEditor.IsPrefabEditMode())
			return false;
		Refuse(resp, "WRONG_MODE", "the World Editor is not in prefab edit mode", "open the prefab with Edit Prefab in the Resource Browser");
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of a new prefab file: a clean project-relative .et (NewTargetInProject: inside the
	//! project, its folder exists) that does not exist yet (Workbench.GetAbsolutePath with mustExist
	//! true under the project's prefix; no file method). False with the response refused.
	static bool NewPrefabTarget(string rel, EMCP_WB_PrefabsResponse resp, out string absolute, out string clean)
	{
		absolute = "";
		clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(rel, clean, why))
		{
			clean = "";
			Refuse(resp, "INVALID_ARGUMENT", why, "pass a project-relative path ending in .et");
			return false;
		}
		string lower = clean;
		lower.ToLower();
		if (!lower.EndsWith(PREFAB_EXT))
		{
			Refuse(resp, "INVALID_ARGUMENT", "the new file must end in .et: " + clean, "pass a project-relative path ending in .et");
			clean = "";
			return false;
		}
		if (!EMCP_WB_Guard.NewTargetInProject(clean, absolute, why))
		{
			absolute = "";
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "NewTargetInProject: " + why, "pass a path inside the project whose folder exists");
			clean = "";
			return false;
		}
		string existing = "";
		if (Workbench.GetAbsolutePath("$" + EMCP_WB_Guard.ProjectId() + ":" + clean, existing, true))
		{
			absolute = "";
			Refuse(resp, "INVALID_ARGUMENT", "the file exists already: " + clean, "pick a new name, or use save to update an existing prefab");
			clean = "";
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Resolves up to MAX_ENTITIES references into sources and their ids. False with the response
	//! refused (INVALID_ARGUMENT, ENTITY_NOT_FOUND).
	static bool ResolveMany(WorldEditorAPI api, array<string> refs, EMCP_WB_PrefabsResponse resp, notnull array<IEntitySource> outSources, notnull array<string> outIds)
	{
		outSources.Clear();
		outIds.Clear();
		if (!refs || refs.Count() == 0)
		{
			Refuse(resp, "INVALID_ARGUMENT", "entities must hold at least one reference", "pass entity references");
			return false;
		}
		if (refs.Count() > MAX_ENTITIES)
		{
			Refuse(resp, "INVALID_ARGUMENT", "entities holds " + refs.Count().ToString() + " references; at most " + MAX_ENTITIES.ToString(), "split the call");
			return false;
		}
		// One resolver for the whole list: the id: map is built once (review R1).
		EMCP_WB_EntityRefResolver resolver = new EMCP_WB_EntityRefResolver(api);
		for (int i = 0; i < refs.Count(); i++)
		{
			EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
			if (!resolver.Resolve(refs.Get(i), resolved))
			{
				outSources.Clear();
				outIds.Clear();
				Refuse(resp, resolved.m_Code, "entities[" + i.ToString() + "]: " + resolved.m_Why, NEXT_REF);
				return false;
			}
			IEntitySource src = resolved.m_Src;
			outSources.Insert(src);
			outIds.Insert(EMCP_WB_EntityRef.Format(src));
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name of a prefab file just written (ResourceManager.GetMetaFile), "" when none.
	//! GetModule opens a closed Resource Manager (DEC-053).
	static string MetaResourceName(string absolute)
	{
		ResourceManager resourceManager = Workbench.GetModule(ResourceManager);
		if (!resourceManager)
			return "";
		MetaFile meta = resourceManager.GetMetaFile(absolute);
		if (!meta)
			return "";
		// Released before the return, as EMCP_WB_Resources.MetaIdOf does (review round 1, F7).
		string id = meta.GetResourceID();
		meta.Release(false);
		return id;
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name of the prefab an entity source inherits from, "" when it has none.
	static string AncestorName(IEntitySource src)
	{
		if (!src)
			return "";
		BaseContainer ancestor = src.GetAncestor();
		if (!ancestor)
			return "";
		return ancestor.GetResourceName();
	}

	//------------------------------------------------------------------------------------------------
	//! A prefab resource name: "{" first and ".et" last (any case).
	static bool IsPrefabName(string text)
	{
		string lower = text;
		lower.ToLower();
		return text.StartsWith("{") && lower.EndsWith(PREFAB_EXT);
	}

	//------------------------------------------------------------------------------------------------
	//! The prefab-side member of an instance child, mapped as the vanilla tools do: the child's
	//! parent instance, that instance's ancestor (the prefab side), and the ancestor's child at the
	//! same index. The prefab-side child must also be the child's own ancestor. Null with why set
	//! when any link is missing, so RemovePrefabMembers never gets a source that is not a member.
	static IEntitySource PrefabSideMember(IEntitySource instanceChild, out string why)
	{
		why = "";
		if (!instanceChild)
		{
			why = "no entity source";
			return null;
		}
		BaseContainer parentContainer = instanceChild.GetParent();
		if (!parentContainer)
		{
			why = "it has no parent: a member is a child of a prefab instance";
			return null;
		}
		IEntitySource parentSrc = parentContainer.ToEntitySource();
		IEntitySource prefabSide = AncestorSource(parentSrc);
		if (!prefabSide)
		{
			why = "its parent is not a prefab instance (no ancestor)";
			return null;
		}
		int index = -1;
		int count = parentSrc.GetNumChildren();
		for (int i = 0; i < count; i++)
		{
			BaseContainer sibling = parentSrc.GetChild(i);
			if (!sibling)
				continue;
			IEntitySource siblingSrc = sibling.ToEntitySource();
			if (siblingSrc == instanceChild)
			{
				index = i;
				break;
			}
		}
		if (index < 0 || index >= prefabSide.GetNumChildren())
		{
			why = "its index under the parent has no child in the parent's prefab (not a prefab member)";
			return null;
		}
		BaseContainer memberContainer = prefabSide.GetChild(index);
		if (!memberContainer)
		{
			why = "the parent's prefab has no child at index " + index.ToString();
			return null;
		}
		IEntitySource member = memberContainer.ToEntitySource();
		IEntitySource ownAncestor = AncestorSource(instanceChild);
		if (!member || member != ownAncestor)
		{
			why = "the prefab's child at index " + index.ToString() + " is not the entity's own ancestor (not a prefab member)";
			return null;
		}
		return member;
	}

	//------------------------------------------------------------------------------------------------
	//! True when src is root or lies under it (GetParent chain, at most 64 levels).
	static bool InHierarchyOf(IEntitySource src, IEntitySource root)
	{
		if (!src || !root)
			return false;
		BaseContainer walk = src;
		for (int depth = 0; depth < 64; depth++)
		{
			if (!walk)
				return false;
			IEntitySource walkSrc = walk.ToEntitySource();
			if (walkSrc == root)
				return true;
			walk = walk.GetParent();
		}
		return false;
	}
}

class EMCP_WB_Prefabs : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_PrefabsRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_PrefabsRequest req = EMCP_WB_PrefabsRequest.Cast(request);
		EMCP_WB_PrefabsResponse resp = new EMCP_WB_PrefabsResponse();
		if (!req)
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "getAncestor")
			GetAncestorOf(req, resp);
		else if (req.action == "createTemplate")
			CreateTemplate(req, resp);
		else if (req.action == "save")
			SaveTemplate(req, resp);
		else if (req.action == "editState")
			EditState(req, resp);
		else if (req.action == "addMembers")
			AddMembers(req, resp);
		else if (req.action == "removeMembers")
			RemoveMembers(req, resp);
		else if (req.action == "moveToPrefab")
			MoveToPrefab(req, resp);
		else if (req.action == "clone")
			FromPrefab(req, resp, true);
		else if (req.action == "createChild")
			FromPrefab(req, resp, false);
		else
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "unknown action '" + req.action + "'", "one of getAncestor, createTemplate, save, editState, addMembers, removeMembers, moveToPrefab, clone, createChild");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! getAncestor: the resource name of the prefab the entity inherits from (1.x call).
	static void GetAncestorOf(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.entity, resolved))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, resolved.m_Code, resolved.m_Why, EMCP_WB_PrefabsUtil.NEXT_REF);
			return;
		}
		IEntitySource src = resolved.m_Src;
		resp.ancestorPath = EMCP_WB_PrefabsUtil.AncestorName(src);
		resp.status = "ok";
		if (resp.ancestorPath == "")
			resp.message = "the entity has no ancestor (not a prefab instance)";
		else
			resp.message = "ancestor prefab found";
	}

	//------------------------------------------------------------------------------------------------
	//! createTemplate: CreateEntityTemplate(entity, abs) to a new project .et (the 1.x call), inside
	//! one undo step: the entity becomes an instance of the new prefab. Dry run unless confirm.
	static void CreateTemplate(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		if (EMCP_WB_PrefabsUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_PrefabsUtil.PlayRefused(api, resp))
			return;

		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.entity, resolved))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, resolved.m_Code, resolved.m_Why, EMCP_WB_PrefabsUtil.NEXT_REF);
			return;
		}
		IEntitySource src = resolved.m_Src;
		string absolute = "";
		string clean = "";
		if (!EMCP_WB_PrefabsUtil.NewPrefabTarget(req.path, resp, absolute, clean))
			return;
		resp.savedPath = clean;

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would write a new prefab from the entity; nothing was written; pass confirm true to write";
			return;
		}

		string undo = EMCP_WB_PrefabsUtil.UNDO_PREFIX + "createTemplate";
		if (!EMCP_WB_PrefabsUtil.BeginEdit(api, undo, resp))
			return;
		resp.undoName = undo;
		bool written = api.CreateEntityTemplate(src, absolute);
		api.EndEntityAction();
		resp.dryRun = false;
		if (!written)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "CreateEntityTemplate returned false", "for an entity of a locked or game layer, use createChild of its prefab");
			return;
		}
		resp.resourceName = EMCP_WB_PrefabsUtil.MetaResourceName(absolute);
		resp.status = "ok";
		resp.message = "prefab written";
	}

	//------------------------------------------------------------------------------------------------
	//! save: SaveEntityTemplate of the entity's prefab side (its ancestor; default entity the prefab
	//! edit root) into its prefab's file,
	//! which must be an existing file of the project (TargetExistsInProject). Dry run unless confirm.
	static void SaveTemplate(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		if (EMCP_WB_PrefabsUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_PrefabsUtil.PlayRefused(api, resp))
			return;

		IEntitySource src = null;
		string entityRef = req.entity;
		if (entityRef == "")
		{
			src = SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource();
			if (!src)
			{
				EMCP_WB_PrefabsUtil.Refuse(resp, "WRONG_MODE", "no entity given and no prefab is open in prefab edit mode", "pass entity, or open the prefab with Edit Prefab");
				return;
			}
		}
		else
		{
			EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
			if (!EMCP_WB_EntityRef.Resolve(api, entityRef, resolved))
			{
				EMCP_WB_PrefabsUtil.Refuse(resp, resolved.m_Code, resolved.m_Why, EMCP_WB_PrefabsUtil.NEXT_REF);
				return;
			}
			src = resolved.m_Src;
		}

		string prefabName = EMCP_WB_PrefabsUtil.AncestorName(src);
		if (prefabName == "")
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "the entity is not a prefab instance: it has no ancestor", "use createTemplate for a new prefab");
			return;
		}
		ResourceName prefabResource = prefabName;
		string prefabPath = prefabResource.GetPath();
		string absolute = "";
		string why = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(prefabPath, absolute, why))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why, "copy the prefab into the project (wb_prefabs clone) and edit the copy");
			return;
		}
		resp.savedPath = prefabPath;

		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would save the entity into its prefab file; nothing was written; pass confirm true to save";
			return;
		}

		// Fix-up 3: SaveEntityTemplate of the instance answered false live (run 3). Every vanilla
		// caller saves the prefab side, the instance's ancestor (SCR_PrefabHelper.UpdatePrefab and
		// UpdatePrefabFromEntitySourceAncestor, SCR_GenerateWindowsPrefabsTool.RefreshPrefab), and
		// opens an entity action only when none is open (IsDoingEditAction).
		IEntitySource prefabSide = EMCP_WB_PrefabsUtil.AncestorSource(src);
		if (!prefabSide)
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "the entity's prefab has no entity source", "pass a prefab instance or the prefab edit root");
			return;
		}
		bool manageAction = !api.IsDoingEditAction();
		if (manageAction)
			api.BeginEntityAction(EMCP_WB_PrefabsUtil.UNDO_PREFIX + "save");
		bool saved = api.SaveEntityTemplate(prefabSide);
		if (manageAction)
			api.EndEntityAction();
		resp.dryRun = false;
		if (!saved)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "SaveEntityTemplate of the prefab (the instance's ancestor) returned false", "check the prefab file is writable and a file of the project");
			return;
		}
		resp.status = "ok";
		resp.message = "prefab saved";
	}

	//------------------------------------------------------------------------------------------------
	//! editState: prefab edit mode on or off, the root entity (SCR_WorldEditorToolHelper
	//! .GetPrefabEditModeEntitySource: entity 1 of 2 in prefab edit mode), its prefab and child count.
	static void EditState(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return;
		}
		bool editing = worldEditor.IsPrefabEditMode();
		resp.prefabEdit = editing;
		if (editing)
		{
			IEntitySource root = SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource();
			if (root)
			{
				resp.rootId = EMCP_WB_EntityRef.Format(root);
				resp.resourceName = EMCP_WB_PrefabsUtil.AncestorName(root);
				resp.memberCount = root.GetNumChildren();
			}
		}
		resp.status = "ok";
		if (!editing)
			resp.message = "not in prefab edit mode";
		else if (resp.rootId == "")
			resp.message = "prefab edit mode, but the root entity was not found (the helper expects exactly 2 editor entities)";
		else
			resp.message = "prefab edit mode; root has " + resp.memberCount.ToString() + " children";
	}

	//------------------------------------------------------------------------------------------------
	//! addMembers: AddPrefabMembers(the member's prefab-side source, { a new source }) in prefab edit
	//! mode, one undo step (P-W1-18). As SCR_GenerateWindowsPrefabsTool.RefreshPrefab: the new
	//! source is a fresh GenericEntity container (BaseContainerTools.CreateContainer) whose ancestor
	//! is the prefab; the Resource is held until the call returns. World entities are never passed
	//! (AddPrefabMembers wants "nowhere used" sources; it answered false for them live).
	static void AddMembers(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		if (EMCP_WB_PrefabsUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_PrefabsUtil.PlayRefused(api, resp))
			return;
		if (EMCP_WB_PrefabsUtil.NotPrefabEditRefused(resp))
			return;

		string prefabName = req.prefab;
		if (!EMCP_WB_PrefabsUtil.IsPrefabName(prefabName))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "prefab must be a resource name {GUID}path.et, got '" + prefabName + "'", "pass the new member's prefab");
			return;
		}
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.member, resolved))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, resolved.m_Code, "member: " + resolved.m_Why, EMCP_WB_PrefabsUtil.NEXT_REF);
			return;
		}
		IEntitySource prefabSide = EMCP_WB_PrefabsUtil.AncestorSource(resolved.m_Src);
		if (!prefabSide)
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "member is not a prefab instance: it has no ancestor", "pass the prefab edit root (wb_prefabs editState rootId)");
			return;
		}

		Resource holder = BaseContainerTools.CreateContainer("GenericEntity");
		if (!holder || !holder.IsValid())
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "BaseContainerTools.CreateContainer returned no valid resource", "see P-W1-18");
			return;
		}
		BaseResourceObject holderObject = holder.GetResource();
		IEntitySource fresh = null;
		if (holderObject)
			fresh = holderObject.ToEntitySource();
		if (!fresh)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "the new container has no entity source", "see P-W1-18");
			return;
		}
		fresh.SetAncestor(prefabName);
		array<IEntitySource> sources = {};
		sources.Insert(fresh);

		string undo = EMCP_WB_PrefabsUtil.UNDO_PREFIX + "addMembers";
		if (!EMCP_WB_PrefabsUtil.BeginEdit(api, undo, resp))
			return;
		resp.undoName = undo;
		bool done = api.AddPrefabMembers(prefabSide, sources);
		api.EndEntityAction();
		if (!done)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "AddPrefabMembers returned false", "see P-W1-18");
			return;
		}
		resp.added.Insert(prefabName);
		resp.status = "ok";
		resp.message = "1 member added (not saved: wb_prefabs save)";
	}

	//------------------------------------------------------------------------------------------------
	//! removeMembers: RemovePrefabMembers of the prefab-side members in prefab edit mode, one undo
	//! step. Each entity must be a child of a prefab instance whose ancestor has the matching child
	//! (PrefabSideMember); anything else is refused before the engine call (fix-up 2: a world entity
	//! passed straight through crashed Workbench). The list is never empty ("crashes otherwise").
	static void RemoveMembers(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		if (EMCP_WB_PrefabsUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_PrefabsUtil.PlayRefused(api, resp))
			return;
		if (EMCP_WB_PrefabsUtil.NotPrefabEditRefused(resp))
			return;

		array<IEntitySource> instances = {};
		array<string> ids = {};
		if (!EMCP_WB_PrefabsUtil.ResolveMany(api, req.entities, resp, instances, ids))
			return;
		array<IEntitySource> sources = {};
		for (int k = 0; k < instances.Count(); k++)
		{
			string why = "";
			IEntitySource member = EMCP_WB_PrefabsUtil.PrefabSideMember(instances.Get(k), why);
			if (!member)
			{
				EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "entities[" + k.ToString() + "] " + ids.Get(k) + ": " + why, "pass children of the prefab edit root (wb_entity children)");
				return;
			}
			if (sources.Find(member) >= 0)
			{
				EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "entities[" + k.ToString() + "] names a member twice", "pass each member once");
				return;
			}
			sources.Insert(member);
		}
		if (sources.Count() == 0)
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "no member to remove", "pass children of the prefab edit root");
			return;
		}

		string undo = EMCP_WB_PrefabsUtil.UNDO_PREFIX + "removeMembers";
		if (!EMCP_WB_PrefabsUtil.BeginEdit(api, undo, resp))
			return;
		resp.undoName = undo;
		bool done = api.RemovePrefabMembers(sources);
		api.EndEntityAction();
		if (!done)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "RemovePrefabMembers returned false", "pass child members of the edited prefab");
			return;
		}
		for (int i = 0; i < ids.Count(); i++)
			resp.removed.Insert(ids.Get(i));
		resp.status = "ok";
		resp.message = ids.Count().ToString() + " members removed";
	}

	//------------------------------------------------------------------------------------------------
	//! moveToPrefab: MoveEntitiesToPrefab(instance in the world, the prefab source it inherits from,
	//! entities, convertTransform), one undo step. The entities leave the world and join the prefab.
	static void MoveToPrefab(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp)
	{
		if (EMCP_WB_PrefabsUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_PrefabsUtil.PlayRefused(api, resp))
			return;

		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.parent, resolved))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, resolved.m_Code, "parent: " + resolved.m_Why, EMCP_WB_PrefabsUtil.NEXT_REF);
			return;
		}
		IEntitySource instance = resolved.m_Src;
		IEntitySource inPrefab = EMCP_WB_PrefabsUtil.AncestorSource(instance);
		if (!inPrefab)
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "parent is not a prefab instance: it has no ancestor", "pass an instance of a prefab");
			return;
		}
		array<IEntitySource> sources = {};
		array<string> ids = {};
		if (!EMCP_WB_PrefabsUtil.ResolveMany(api, req.entities, resp, sources, ids))
			return;
		// The vanilla callers move entities that are not part of the instance (fresh map entities);
		// an entity of the instance's own hierarchy, or one above it, is refused before the call.
		for (int k = 0; k < sources.Count(); k++)
		{
			IEntitySource moving = sources.Get(k);
			if (EMCP_WB_PrefabsUtil.InHierarchyOf(moving, instance) || EMCP_WB_PrefabsUtil.InHierarchyOf(instance, moving))
			{
				EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "entities[" + k.ToString() + "] " + ids.Get(k) + " is the instance, part of it, or above it", "pass map entities outside the prefab instance");
				return;
			}
		}

		bool convert = req.convertTransform;
		string undo = EMCP_WB_PrefabsUtil.UNDO_PREFIX + "moveToPrefab";
		if (!EMCP_WB_PrefabsUtil.BeginEdit(api, undo, resp))
			return;
		resp.undoName = undo;
		bool done = api.MoveEntitiesToPrefab(instance, inPrefab, sources, convert);
		api.EndEntityAction();
		if (!done)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "MoveEntitiesToPrefab returned false", "see P-W1-18");
			return;
		}
		for (int i = 0; i < ids.Count(); i++)
			resp.moved.Insert(ids.Get(i));
		resp.status = "ok";
		resp.message = ids.Count().ToString() + " entities moved into the prefab (not saved: wb_prefabs save)";
	}

	//------------------------------------------------------------------------------------------------
	//! clone (asCopy true) and createChild (false): SCR_PrefabHelper's ClonePrefab / CreateChildPrefab
	//! calls without its file methods. A temporary instance of the prefab (CreateEntity in the current
	//! layer), CreateEntityTemplate of its ancestor (a copy) or of the instance (a child) to the new
	//! project .et, the instance deleted, all in one undo step; GetMetaFile for the resource name.
	static void FromPrefab(EMCP_WB_PrefabsRequest req, EMCP_WB_PrefabsResponse resp, bool asCopy)
	{
		if (EMCP_WB_PrefabsUtil.ProjectRefused(resp))
			return;
		WorldEditorAPI api = EMCP_WB_PrefabsUtil.Api(resp);
		if (!api)
			return;
		if (EMCP_WB_PrefabsUtil.PlayRefused(api, resp))
			return;

		string source = req.prefab;
		string lowerSource = source;
		lowerSource.ToLower();
		if (!source.StartsWith("{") || !lowerSource.EndsWith(EMCP_WB_PrefabsUtil.PREFAB_EXT))
		{
			EMCP_WB_PrefabsUtil.Refuse(resp, "INVALID_ARGUMENT", "prefab must be a resource name {GUID}path.et, got '" + source + "'", "pass the prefab's resource name");
			return;
		}
		string absolute = "";
		string clean = "";
		if (!EMCP_WB_PrefabsUtil.NewPrefabTarget(req.path, resp, absolute, clean))
			return;
		resp.savedPath = clean;

		string verb = "createChild";
		if (asCopy)
			verb = "clone";
		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: " + verb + " would write a new prefab; nothing was written; pass confirm true to write";
			return;
		}

		resp.dryRun = false;
		string undo = EMCP_WB_PrefabsUtil.UNDO_PREFIX + verb;
		if (!EMCP_WB_PrefabsUtil.BeginEdit(api, undo, resp))
			return;
		resp.undoName = undo;
		IEntitySource instance = api.CreateEntity(source, "", api.GetCurrentEntityLayerId(), null, vector.Zero, vector.Zero);
		if (!instance)
		{
			api.EndEntityAction();
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "CreateEntity returned null for the prefab", "check the resource name and that the current layer is not locked");
			return;
		}
		IEntitySource templateSource = instance;
		if (asCopy)
			templateSource = EMCP_WB_PrefabsUtil.AncestorSource(instance);
		bool written = false;
		if (templateSource)
			written = api.CreateEntityTemplate(templateSource, absolute);
		bool deleted = api.DeleteEntity(instance);
		api.EndEntityAction();

		if (!written)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "CreateEntityTemplate returned false (temporary instance deleted " + deleted.ToString() + ")", "see P-W1-19");
			return;
		}
		resp.resourceName = EMCP_WB_PrefabsUtil.MetaResourceName(absolute);
		if (!deleted)
		{
			EMCP_WB_PrefabsUtil.EngineFalse(resp, "the prefab was written but DeleteEntity of the temporary instance returned false; it stays at 0 0 0", "wb_undo_redo undo, or delete the instance");
			return;
		}
		resp.status = "ok";
		resp.message = verb + " written";
	}
}
