/**
 * EMCP_WB_AnimDebug.c - Play-mode animation debug handler of wb_anim_debug (wave W4, DEC-067 OD-1,
 * phase5-w4-spec.md section 2.2)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_AnimDebug", dispatching on "action":
 *   vars          graph variable values (Bind*Variable, Get*Variable), one row per name (P-W4-18)
 *   tags          tags (BindTag, IsTag) or events (BindEvent, IsEvent) set this frame (P-W4-19)
 *   procAnim      ProcAnim controllers, signals, bones, bone slots of one controller (P-W4-20)
 *   set           set a graph variable in memory: refused UNPROVEN until P-W4-19
 *   command       call a graph command: refused UNPROVEN until P-W4-19
 *   btBreakpoint  the AI behaviour-tree breakpoint: refused UNPROVEN until P-W4-21 (may hang play)
 *
 * Every action takes target = entity:<ref>, the W1 entity reference (EMCP_WB_EntityRef: id:<hex> |
 * name:<name> | index:<i>), resolved to the editor source and then by WorldEditorAPI.SourceToEntity to
 * the runtime entity (W1); when that answers null in play mode (W4 run 1), the game world is asked by
 * the source's name (GameEntityByName, unproven: P-W4-18 retry). Order of the checks: the World Editor (Workbench.GetModule opens a closed
 * World Editor, DEC-053; the answer says so), a loaded world (EMCP_WB_Common.NoWorldReason), play
 * mode (IsGameMode false refuses WRONG_MODE), the reference, the runtime entity, the component. Each
 * engine object is null-checked. Nothing is written to a file and no dialog is opened; nothing here
 * names a project (DEC-058). Floats travel as text both ways (floatParam, value, read values).
 *
 * Compile gate P-W4-01: the GameLib class (BaseAnimationControllerComponent) and the Game classes
 * (BaseProcAnimComponent, AIControlComponent, AIAgent, AIBehaviorTreeComponent) are named only in
 * the three helper classes below (EMCP_WB_AnimDebugGraph, EMCP_WB_AnimDebugProc,
 * EMCP_WB_AnimDebugBt). No other file names any class of this file, so a compile kill is repaired
 * by deleting this file (or only the Proc and Bt helpers and the actions that call them when the
 * Game classes alone fail). Until that repair the kill is not contained: one compile error fails
 * the whole script bundle and every handler with it.
 *
 * A refusal answers status "refused" with code and next set and message in the form
 * "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_AnimDebug.json.
 */

class EMCP_WB_AnimDebugRequest : JsonApiStruct
{
	string action;
	//! every action: entity:<ref> of a play-mode entity (id:<hex> | name:<name> | index:<i>)
	string target;
	//! vars: variable names; tags: tag or event names (at most 64)
	ref array<string> names;
	//! vars: int|float|bool, one per name
	ref array<string> varTypes;
	//! tags: tag (default) or event
	string kind;
	//! procAnim: controller index (default 0)
	int ctrl;
	//! set: variable name; command: command name
	string name;
	//! set: int|float|bool
	string varType;
	//! set: the new value as text (floats as text, bool true|false|1|0)
	string value;
	//! command: the int parameter (default 0)
	int intParam;
	//! command: the float parameter as text; "" is 0 (a JSON number never reaches a float field)
	string floatParam;
	//! btBreakpoint: on or off
	bool enable;

	void EMCP_WB_AnimDebugRequest()
	{
		names = {};
		varTypes = {};

		RegV("action");
		RegV("target");
		RegV("names");
		RegV("varTypes");
		RegV("kind");
		RegV("ctrl");
		RegV("name");
		RegV("varType");
		RegV("value");
		RegV("intParam");
		RegV("floatParam");
		RegV("enable");

		// Defaults for keys the request leaves out.
		ctrl = 0;
		intParam = 0;
		enable = false;
	}
}

class EMCP_WB_AnimDebugResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	//! the target as given
	string target;
	//! vars: "name|type|id|value"; tags: "name|id|on"
	ref array<string> values;
	ref array<string> warnings;
	//! procAnim: GetControllerCount
	int controllers;
	//! procAnim: "index|name" (GetSignalIndex)
	ref array<string> signals;
	//! procAnim: "index|name"
	ref array<string> bones;
	//! procAnim: "index|name"
	ref array<string> slots;
	//! set: "name|type|id|value" before and after
	ref array<string> before;
	ref array<string> after;
	//! command: the BindCommand id, -1 when unknown
	int id;
	//! command, btBreakpoint: the engine call was made
	bool called;

	void EMCP_WB_AnimDebugResponse()
	{
		values = {};
		warnings = {};
		signals = {};
		bones = {};
		slots = {};
		before = {};
		after = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("target");
		RegV("values");
		RegV("warnings");
		RegV("controllers");
		RegV("signals");
		RegV("bones");
		RegV("slots");
		RegV("before");
		RegV("after");
		RegV("id");
		RegV("called");

		controllers = 0;
		id = -1;
		called = false;
	}
}

//! The outcome of one helper call: a refusal code and why ("" when it worked), the bound id and
//! whether the engine call was made. A holder, not out parameters (W1 compile lesson).
class EMCP_WB_AnimDebugResult
{
	string m_Code;
	string m_Why;
	int m_Id;
	bool m_Called;

	//------------------------------------------------------------------------------------------------
	void Reset()
	{
		m_Code = "";
		m_Why = "";
		m_Id = -1;
		m_Called = false;
	}
}

//! Text rules shared by the handler and the helpers; names no engine class.
class EMCP_WB_AnimDebugText
{
	static const string TYPE_INT = "int";
	static const string TYPE_FLOAT = "float";
	static const string TYPE_BOOL = "bool";

	//------------------------------------------------------------------------------------------------
	//! True for int, float and bool.
	static bool IsVarType(string text)
	{
		return text == TYPE_INT || text == TYPE_FLOAT || text == TYPE_BOOL;
	}

	//------------------------------------------------------------------------------------------------
	//! true|1 and false|0 (any case, trimmed), else false.
	static bool ParseBool(string text, out bool flag)
	{
		flag = false;
		string lower = text.Trim();
		lower.ToLower();
		if (lower == "true" || lower == "1")
		{
			flag = true;
			return true;
		}
		if (lower == "false" || lower == "0")
			return true;
		return false;
	}
}

//! GameLib side (P-W4-01): the only class of this file that names BaseAnimationControllerComponent.
class EMCP_WB_AnimDebugGraph
{
	//! The same words as EMCP_WB_AnimDebugText (literals: a const is not initialised from another class).
	static const string TYPE_INT = "int";
	static const string TYPE_FLOAT = "float";
	static const string TYPE_BOOL = "bool";

	//------------------------------------------------------------------------------------------------
	//! The animation controller of a runtime entity, null without one.
	static BaseAnimationControllerComponent AnimOf(IEntity ent)
	{
		if (!ent)
			return null;
		return BaseAnimationControllerComponent.Cast(ent.FindComponent(BaseAnimationControllerComponent));
	}

	//------------------------------------------------------------------------------------------------
	//! Bind*Variable by type; -1 for an unknown type (the caller has checked it).
	static int Bind(BaseAnimationControllerComponent anim, string varName, string varType)
	{
		if (!anim)
			return -1;
		if (varType == TYPE_INT)
			return anim.BindIntVariable(varName);
		if (varType == TYPE_FLOAT)
			return anim.BindFloatVariable(varName);
		if (varType == TYPE_BOOL)
			return anim.BindBoolVariable(varName);
		return -1;
	}

	//------------------------------------------------------------------------------------------------
	//! Get*Variable as text; "" for an id below 0 (never read through an unbound id).
	static string ValueText(BaseAnimationControllerComponent anim, int varId, string varType)
	{
		if (!anim || varId < 0)
			return "";
		if (varType == TYPE_INT)
		{
			int intValue = anim.GetIntVariable(varId);
			return intValue.ToString();
		}
		if (varType == TYPE_FLOAT)
		{
			float floatValue = anim.GetFloatVariable(varId);
			return floatValue.ToString();
		}
		if (varType == TYPE_BOOL)
		{
			if (anim.GetBoolVariable(varId))
				return "true";
			return "false";
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! One row: "name|type|id|value".
	static string Row(string varName, string varType, int varId, string text)
	{
		return varName + "|" + varType + "|" + varId.ToString() + "|" + text;
	}

	//------------------------------------------------------------------------------------------------
	//! vars: one row per name into rows, a warning per unknown name. False without a controller.
	static bool ReadVars(IEntity ent, array<string> varNames, array<string> types, notnull array<string> rows, notnull array<string> warnings)
	{
		BaseAnimationControllerComponent anim = AnimOf(ent);
		if (!anim)
			return false;
		for (int i = 0; i < varNames.Count(); i++)
		{
			string varName = varNames.Get(i);
			string varType = types.Get(i);
			int varId = Bind(anim, varName, varType);
			if (varId < 0)
				warnings.Insert("no " + varType + " variable '" + varName + "' in the graph (bind answered " + varId.ToString() + ")");
			rows.Insert(Row(varName, varType, varId, ValueText(anim, varId, varType)));
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! tags: "name|id|on" per name, BindTag/IsTag or BindEvent/IsEvent. False without a controller.
	static bool ReadTags(IEntity ent, array<string> tagNames, bool asEvents, notnull array<string> rows, notnull array<string> warnings)
	{
		BaseAnimationControllerComponent anim = AnimOf(ent);
		if (!anim)
			return false;
		for (int i = 0; i < tagNames.Count(); i++)
		{
			string tagName = tagNames.Get(i);
			int tagId = -1;
			if (asEvents)
				tagId = anim.BindEvent(tagName);
			else
				tagId = anim.BindTag(tagName);
			bool isOn = false;
			if (tagId >= 0)
			{
				if (asEvents)
					isOn = anim.IsEvent(tagId);
				else
					isOn = anim.IsTag(tagId);
			}
			else
			{
				warnings.Insert("no tag or event '" + tagName + "' in the graph (bind answered " + tagId.ToString() + ")");
			}
			string onText = "false";
			if (isOn)
				onText = "true";
			rows.Insert(tagName + "|" + tagId.ToString() + "|" + onText);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! set (P-W4-19): the value before, Set*Variable, the value read back. text is already checked by
	//! the handler and is parsed again here.
	static void WriteVar(IEntity ent, string varName, string varType, string text, notnull array<string> beforeRows, notnull array<string> afterRows, notnull EMCP_WB_AnimDebugResult res)
	{
		res.Reset();
		BaseAnimationControllerComponent anim = AnimOf(ent);
		if (!anim)
		{
			res.m_Code = "ENTITY_NOT_FOUND";
			res.m_Why = "the runtime entity has no BaseAnimationControllerComponent";
			return;
		}
		int varId = Bind(anim, varName, varType);
		res.m_Id = varId;
		if (varId < 0)
		{
			res.m_Code = "INVALID_ARGUMENT";
			res.m_Why = "no " + varType + " variable '" + varName + "' in the graph (bind answered " + varId.ToString() + ")";
			return;
		}
		beforeRows.Insert(Row(varName, varType, varId, ValueText(anim, varId, varType)));
		if (varType == TYPE_INT)
		{
			int intValue = 0;
			if (!EMCP_WB_Common.ParseInt(text, intValue))
			{
				res.m_Code = "INVALID_ARGUMENT";
				res.m_Why = "value '" + text + "' is not an int";
				return;
			}
			anim.SetIntVariable(varId, intValue);
		}
		else if (varType == TYPE_FLOAT)
		{
			float floatValue = 0;
			if (!EMCP_WB_Common.ParseFloat(text, floatValue))
			{
				res.m_Code = "INVALID_ARGUMENT";
				res.m_Why = "value '" + text + "' is not a float";
				return;
			}
			anim.SetFloatVariable(varId, floatValue);
		}
		else
		{
			bool flag = false;
			if (!EMCP_WB_AnimDebugText.ParseBool(text, flag))
			{
				res.m_Code = "INVALID_ARGUMENT";
				res.m_Why = "value '" + text + "' is not true, false, 1 or 0";
				return;
			}
			anim.SetBoolVariable(varId, flag);
		}
		res.m_Called = true;
		afterRows.Insert(Row(varName, varType, varId, ValueText(anim, varId, varType)));
	}

	//------------------------------------------------------------------------------------------------
	//! command (P-W4-19): BindCommand, then CallCommand when the id is known.
	static void Command(IEntity ent, string cmdName, int cmdInt, float cmdFloat, notnull EMCP_WB_AnimDebugResult res)
	{
		res.Reset();
		BaseAnimationControllerComponent anim = AnimOf(ent);
		if (!anim)
		{
			res.m_Code = "ENTITY_NOT_FOUND";
			res.m_Why = "the runtime entity has no BaseAnimationControllerComponent";
			return;
		}
		int cmdId = anim.BindCommand(cmdName);
		res.m_Id = cmdId;
		if (cmdId < 0)
		{
			res.m_Code = "INVALID_ARGUMENT";
			res.m_Why = "no command '" + cmdName + "' in the graph (bind answered " + cmdId.ToString() + ")";
			return;
		}
		anim.CallCommand(cmdId, cmdInt, cmdFloat);
		res.m_Called = true;
	}
}

//! Game side (P-W4-01, P-W4-20): the only class of this file that names BaseProcAnimComponent.
class EMCP_WB_AnimDebugProc
{
	//------------------------------------------------------------------------------------------------
	//! The ProcAnim component of a runtime entity, null without one.
	static BaseProcAnimComponent ProcOf(IEntity ent)
	{
		if (!ent)
			return null;
		return BaseProcAnimComponent.Cast(ent.FindComponent(BaseProcAnimComponent));
	}

	//------------------------------------------------------------------------------------------------
	//! GetControllerCount, -1 without a ProcAnim component.
	static int Controllers(IEntity ent)
	{
		BaseProcAnimComponent proc = ProcOf(ent);
		if (!proc)
			return -1;
		return proc.GetControllerCount();
	}

	//------------------------------------------------------------------------------------------------
	//! Signals ("index|name", the index from GetSignalIndex), bones and bone slots ("index|name") of
	//! controller ctrlIdx (0 <= ctrlIdx < Controllers, checked by the caller). GetSignals has an out
	//! array parameter: it gets a new array, never null.
	static void Read(IEntity ent, int ctrlIdx, notnull array<string> signalRows, notnull array<string> boneRows, notnull array<string> slotRows)
	{
		BaseProcAnimComponent proc = ProcOf(ent);
		if (!proc)
			return;
		array<string> signalNames = {};
		proc.GetSignals(ctrlIdx, signalNames);
		if (signalNames)
		{
			for (int i = 0; i < signalNames.Count(); i++)
			{
				string signalName = signalNames.Get(i);
				int signalIdx = proc.GetSignalIndex(ctrlIdx, signalName);
				signalRows.Insert(signalIdx.ToString() + "|" + signalName);
			}
		}
		array<string> boneNames = {};
		proc.GetBoneNames(ctrlIdx, boneNames);
		for (int b = 0; b < boneNames.Count(); b++)
		{
			boneRows.Insert(b.ToString() + "|" + boneNames.Get(b));
		}
		array<string> slotNames = {};
		proc.GetBoneSlotNames(ctrlIdx, slotNames);
		for (int s = 0; s < slotNames.Count(); s++)
		{
			slotRows.Insert(s.ToString() + "|" + slotNames.Get(s));
		}
	}
}

//! Game side (P-W4-01, P-W4-21): the only class of this file that names the AI classes.
class EMCP_WB_AnimDebugBt
{
	//------------------------------------------------------------------------------------------------
	//! SetBtBreakpoint on the behaviour tree of the entity's AI agent: the entity itself when it is an
	//! AIAgent, else AIControlComponent.GetControlAIAgent. Called only once P-W4-21 has passed.
	static void SetBreakpoint(IEntity ent, bool enable, notnull EMCP_WB_AnimDebugResult res)
	{
		res.Reset();
		if (!ent)
		{
			res.m_Code = "ENTITY_NOT_FOUND";
			res.m_Why = "no runtime entity";
			return;
		}
		AIAgent agent = AIAgent.Cast(ent);
		if (!agent)
		{
			AIControlComponent control = AIControlComponent.Cast(ent.FindComponent(AIControlComponent));
			if (!control)
			{
				res.m_Code = "ENTITY_NOT_FOUND";
				res.m_Why = "the runtime entity is not an AIAgent and has no AIControlComponent";
				return;
			}
			agent = control.GetControlAIAgent();
		}
		if (!agent)
		{
			res.m_Code = "ENTITY_NOT_FOUND";
			res.m_Why = "GetControlAIAgent returned no AI agent";
			return;
		}
		AIBehaviorTreeComponent tree = AIBehaviorTreeComponent.Cast(agent.FindComponent(AIBehaviorTreeComponent));
		if (!tree)
		{
			res.m_Code = "ENTITY_NOT_FOUND";
			res.m_Why = "the AI agent has no AIBehaviorTreeComponent";
			return;
		}
		tree.SetBtBreakpoint(enable);
		res.m_Called = true;
	}
}

class EMCP_WB_AnimDebug : NetApiHandler
{
	//! P-W4-19: set and command stay refused UNPROVEN until the probe shows Set*Variable and
	//! CallCommand are safe in play mode. Flip only after that run.
	static const bool SET_COMMAND_PROVEN = false;
	//! P-W4-21: btBreakpoint stays refused UNPROVEN until the probe shows SetBtBreakpoint opens no
	//! dialog and does not hang play. Flip only after that run.
	static const bool BT_BREAKPOINT_PROVEN = false;
	//! Names one vars or tags call takes at most.
	static const int MAX_NAMES = 64;
	static const string KIND_TAG = "tag";
	static const string KIND_EVENT = "event";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string NO_WORLD = "NO_WORLD";
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND";
	static const string UNPROVEN = "UNPROVEN";
	static const string NEXT_PLAY = "wb_world play";
	static const string NEXT_ENTITY = "list the entities (wb_entity list) and pass the id: it answers";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_AnimDebugRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_AnimDebugRequest req = EMCP_WB_AnimDebugRequest.Cast(request);
		EMCP_WB_AnimDebugResponse resp = new EMCP_WB_AnimDebugResponse();
		if (!req)
		{
			Refuse(resp, INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "vars")
			Vars(req, resp);
		else if (req.action == "tags")
			Tags(req, resp);
		else if (req.action == "procAnim")
			ProcAnim(req, resp);
		else if (req.action == "set")
			SetVar(req, resp);
		else if (req.action == "command")
			CallCmd(req, resp);
		else if (req.action == "btBreakpoint")
			BtBreakpoint(req, resp);
		else
			Refuse(resp, INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of vars, tags, procAnim, set, command, btBreakpoint");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_AnimDebugResponse resp, string status, string code, string text, string nextStep)
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
	protected static void Refuse(EMCP_WB_AnimDebugResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! Why a name list is unusable ("" when it is fine): empty, over MAX_NAMES, or an empty name.
	static string NamesWhy(array<string> nameList)
	{
		if (!nameList || nameList.Count() == 0)
			return "names must hold at least one name";
		if (nameList.Count() > MAX_NAMES)
			return "names holds " + nameList.Count().ToString() + " names, at most " + MAX_NAMES.ToString();
		for (int i = 0; i < nameList.Count(); i++)
		{
			if (nameList.Get(i) == "")
				return "names[" + i.ToString() + "] is empty";
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! Why varTypes does not match names ("" when it does): one int|float|bool per name.
	static string VarTypesWhy(array<string> nameList, array<string> typeList)
	{
		if (!typeList || typeList.Count() != nameList.Count())
		{
			int typeCount = 0;
			if (typeList)
				typeCount = typeList.Count();
			return "varTypes must hold one type per name: " + nameList.Count().ToString() + " names, " + typeCount.ToString() + " types";
		}
		for (int i = 0; i < typeList.Count(); i++)
		{
			if (!EMCP_WB_AnimDebugText.IsVarType(typeList.Get(i)))
				return "varTypes[" + i.ToString() + "] is '" + typeList.Get(i) + "'; one of int, float, bool";
		}
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! Why a value text does not parse as varType ("" when it does).
	static string ValueWhy(string varType, string text)
	{
		if (varType == EMCP_WB_AnimDebugText.TYPE_INT)
		{
			int intValue = 0;
			if (!EMCP_WB_Common.ParseInt(text, intValue))
				return "value '" + text + "' is not an int";
			return "";
		}
		if (varType == EMCP_WB_AnimDebugText.TYPE_FLOAT)
		{
			float floatValue = 0;
			if (!EMCP_WB_Common.ParseFloat(text, floatValue))
				return "value '" + text + "' is not a float (send it as text)";
			return "";
		}
		bool flag = false;
		if (!EMCP_WB_AnimDebugText.ParseBool(text, flag))
			return "value '" + text + "' is not true, false, 1 or 0";
		return "";
	}

	//------------------------------------------------------------------------------------------------
	//! The runtime entity of req.target, or null with the refusal written. In order: the target is
	//! given; the World Editor (Workbench.GetModule opens a closed one); a loaded world
	//! (EMCP_WB_Common.NoWorldReason); play mode (WRONG_MODE outside it); the entity reference
	//! (EMCP_WB_EntityRef.Resolve); WorldEditorAPI.SourceToEntity.
	protected static IEntity Runtime(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp, notnull array<string> notes)
	{
		resp.target = req.target;
		if (req.target == "")
		{
			Refuse(resp, INVALID_ARGUMENT, "target is empty: pass entity:<ref> (id:<hex>, name:<name> or index:<i>)", NEXT_ENTITY);
			return null;
		}
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api)
		{
			Refuse(resp, NO_WORLD, "the World Editor has no API: no world is open (GetModule may have opened the World Editor)", "open a world (wb_module setResource), then wb_world play");
			return null;
		}
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, NO_WORLD, noWorld + " (GetModule may have opened the World Editor)", "open a world (wb_module setResource), then wb_world play");
			return null;
		}
		if (!api.IsGameMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is not in play mode; wb_anim_debug reads the running game only; nothing was called", NEXT_PLAY);
			return null;
		}
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, req.target, resolved))
		{
			Refuse(resp, resolved.m_Code, resolved.m_Why, NEXT_ENTITY);
			return null;
		}
		IEntitySource src = resolved.m_Src;
		if (!src)
		{
			Refuse(resp, ENTITY_NOT_FOUND, "the reference resolved to no entity source", NEXT_ENTITY);
			return null;
		}
		IEntity ent = api.SourceToEntity(src);
		if (ent)
			return ent;
		ent = GameEntityByName(src.GetName(), notes);
		if (!ent)
		{
			Refuse(resp, ENTITY_NOT_FOUND, "SourceToEntity returned no runtime entity for '" + req.target + "', and the game world holds no entity named '" + src.GetName() + "'", "name the entity in the World Editor, then pass entity:name:<name>");
			return null;
		}
		return ent;
	}

	//------------------------------------------------------------------------------------------------
	//! W4 fix-up 1, P-W4-18 retry: in play mode SourceToEntity answered null for an edit-world source
	//! (W4 run 1, w4-60-play: the source resolved, the runtime entity did not). The game runs its own
	//! world, so the entity is looked up there by its editor name: GetGame() (compiled and answered
	//! live in EMCP_WB_Navmesh, W5 run 1 w5-50), Game.GetWorld/0 and World.FindEntityByName/1 (API
	//! index, data/api/enfusion-classes.json). Unproven: whether the play world keeps editor names is
	//! the next run's P-W4-18. Null when the name is empty or any step answers null; a hit adds a
	//! note naming the route (vars, tags and procAnim pass their warnings).
	protected static IEntity GameEntityByName(string entName, notnull array<string> notes)
	{
		if (entName == "")
			return null;
		ArmaReforgerScripted game = GetGame();
		if (!game)
			return null;
		World gameWorld = game.GetWorld();
		if (!gameWorld)
			return null;
		IEntity found = gameWorld.FindEntityByName(entName);
		if (found)
			notes.Insert("reached through the game world by name (GetGame().GetWorld().FindEntityByName '" + entName + "'): SourceToEntity answered null in play mode (P-W4-18 retry, unproven)");
		return found;
	}

	//------------------------------------------------------------------------------------------------
	//! vars: Bind*Variable and Get*Variable per name (P-W4-18). An unknown name answers id -1, an
	//! empty value and a warning.
	protected static void Vars(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp)
	{
		resp.target = req.target;
		string why = NamesWhy(req.names);
		if (why == "")
			why = VarTypesWhy(req.names, req.varTypes);
		if (why != "")
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass names and varTypes (int|float|bool), one type per name");
			return;
		}
		IEntity ent = Runtime(req, resp, resp.warnings);
		if (!ent)
			return;
		if (!EMCP_WB_AnimDebugGraph.ReadVars(ent, req.names, req.varTypes, resp.values, resp.warnings))
		{
			Refuse(resp, ENTITY_NOT_FOUND, "the runtime entity has no BaseAnimationControllerComponent", "target an entity with an animation graph (a character)");
			return;
		}
		Answer(resp, "ok", "", "read " + resp.values.Count().ToString() + " variable(s)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! tags: BindTag/IsTag, or BindEvent/IsEvent with kind event (P-W4-19).
	protected static void Tags(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp)
	{
		resp.target = req.target;
		string why = NamesWhy(req.names);
		if (why != "")
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass names");
			return;
		}
		bool asEvents = false;
		if (req.kind == KIND_EVENT)
			asEvents = true;
		else if (req.kind != "" && req.kind != KIND_TAG)
		{
			Refuse(resp, INVALID_ARGUMENT, "kind is '" + req.kind + "'; tag or event", "pass kind tag or event");
			return;
		}
		IEntity ent = Runtime(req, resp, resp.warnings);
		if (!ent)
			return;
		if (!EMCP_WB_AnimDebugGraph.ReadTags(ent, req.names, asEvents, resp.values, resp.warnings))
		{
			Refuse(resp, ENTITY_NOT_FOUND, "the runtime entity has no BaseAnimationControllerComponent", "target an entity with an animation graph (a character)");
			return;
		}
		Answer(resp, "ok", "", "read " + resp.values.Count().ToString() + " name(s)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! procAnim: controller count, then signals, bones and slots of controller ctrl (P-W4-20).
	protected static void ProcAnim(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp)
	{
		resp.target = req.target;
		if (req.ctrl < 0)
		{
			Refuse(resp, INVALID_ARGUMENT, "ctrl is " + req.ctrl.ToString() + "; a controller index is 0 or more", "pass ctrl 0");
			return;
		}
		IEntity ent = Runtime(req, resp, resp.warnings);
		if (!ent)
			return;
		int count = EMCP_WB_AnimDebugProc.Controllers(ent);
		if (count < 0)
		{
			Refuse(resp, ENTITY_NOT_FOUND, "the runtime entity has no BaseProcAnimComponent", "target an entity whose prefab has a ProcAnim component");
			return;
		}
		resp.controllers = count;
		if (count == 0)
		{
			resp.warnings.Insert("the ProcAnim component has no controller");
			Answer(resp, "ok", "", "0 controllers", "");
			return;
		}
		if (req.ctrl >= count)
		{
			Refuse(resp, INVALID_ARGUMENT, "ctrl " + req.ctrl.ToString() + " is out of range (" + count.ToString() + " controllers)", "pass ctrl below " + count.ToString());
			return;
		}
		EMCP_WB_AnimDebugProc.Read(ent, req.ctrl, resp.signals, resp.bones, resp.slots);
		Answer(resp, "ok", "", "controller " + req.ctrl.ToString() + " of " + count.ToString() + ": " + resp.signals.Count().ToString() + " signal(s), " + resp.bones.Count().ToString() + " bone(s), " + resp.slots.Count().ToString() + " slot(s)", "");
	}

	//------------------------------------------------------------------------------------------------
	//! set: refused UNPROVEN until P-W4-19, before any engine call. Then: the inputs, the runtime
	//! entity, Bind*Variable, the value before, Set*Variable, the value read back (the graph may
	//! overwrite it on the next frame). In memory only.
	protected static void SetVar(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp)
	{
		resp.target = req.target;
		if (!SET_COMMAND_PROVEN)
		{
			Refuse(resp, UNPROVEN, "set waits for probe P-W4-19 (Set*Variable in play mode is not proven safe); nothing was called", "read the value with vars");
			return;
		}
		if (req.name == "" || !EMCP_WB_AnimDebugText.IsVarType(req.varType))
		{
			Refuse(resp, INVALID_ARGUMENT, "set needs name and varType int, float or bool", "pass name, varType and value");
			return;
		}
		string why = ValueWhy(req.varType, req.value);
		if (why != "")
		{
			Refuse(resp, INVALID_ARGUMENT, why, "pass value as text");
			return;
		}
		IEntity ent = Runtime(req, resp, new array<string>());
		if (!ent)
			return;
		EMCP_WB_AnimDebugResult res = new EMCP_WB_AnimDebugResult();
		EMCP_WB_AnimDebugGraph.WriteVar(ent, req.name, req.varType, req.value, resp.before, resp.after, res);
		if (res.m_Code != "")
		{
			Refuse(resp, res.m_Code, res.m_Why, "check the name with vars");
			return;
		}
		Answer(resp, "ok", "", "set " + req.name + " in memory; the graph may overwrite it on the next frame", "");
	}

	//------------------------------------------------------------------------------------------------
	//! command: refused UNPROVEN until P-W4-19, before any engine call. Then BindCommand and
	//! CallCommand(id, intParam, floatParam).
	protected static void CallCmd(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp)
	{
		resp.target = req.target;
		if (!SET_COMMAND_PROVEN)
		{
			Refuse(resp, UNPROVEN, "command waits for probe P-W4-19 (CallCommand in play mode is not proven safe); nothing was called", "read tags and vars instead");
			return;
		}
		if (req.name == "")
		{
			Refuse(resp, INVALID_ARGUMENT, "command needs name", "pass the command name from the graph");
			return;
		}
		float floatValue = 0;
		if (req.floatParam != "" && !EMCP_WB_Common.ParseFloat(req.floatParam, floatValue))
		{
			Refuse(resp, INVALID_ARGUMENT, "floatParam '" + req.floatParam + "' is not a float", "send floatParam as text");
			return;
		}
		IEntity ent = Runtime(req, resp, new array<string>());
		if (!ent)
			return;
		EMCP_WB_AnimDebugResult res = new EMCP_WB_AnimDebugResult();
		EMCP_WB_AnimDebugGraph.Command(ent, req.name, req.intParam, floatValue, res);
		resp.id = res.m_Id;
		resp.called = res.m_Called;
		if (res.m_Code != "")
		{
			Refuse(resp, res.m_Code, res.m_Why, "check the command name in the graph (animation_graph inspect)");
			return;
		}
		Answer(resp, "ok", "", "called " + req.name + " (id " + res.m_Id.ToString() + ")", "");
	}

	//------------------------------------------------------------------------------------------------
	//! btBreakpoint: refused UNPROVEN until P-W4-21, before any engine call (SetBtBreakpoint may pause
	//! play or open the BT debugger). Then the AI agent's AIBehaviorTreeComponent.SetBtBreakpoint.
	protected static void BtBreakpoint(EMCP_WB_AnimDebugRequest req, EMCP_WB_AnimDebugResponse resp)
	{
		resp.target = req.target;
		if (!BT_BREAKPOINT_PROVEN)
		{
			Refuse(resp, UNPROVEN, "btBreakpoint waits for probe P-W4-21 (SetBtBreakpoint may pause play or open the BT debugger); nothing was called", "none until the probe passes");
			return;
		}
		IEntity ent = Runtime(req, resp, new array<string>());
		if (!ent)
			return;
		EMCP_WB_AnimDebugResult res = new EMCP_WB_AnimDebugResult();
		EMCP_WB_AnimDebugBt.SetBreakpoint(ent, req.enable, res);
		resp.called = res.m_Called;
		if (res.m_Code != "")
		{
			Refuse(resp, res.m_Code, res.m_Why, "target a character with an AI agent");
			return;
		}
		string state = "off";
		if (req.enable)
			state = "on";
		Answer(resp, "ok", "", "behaviour-tree breakpoint " + state, "");
	}
}
