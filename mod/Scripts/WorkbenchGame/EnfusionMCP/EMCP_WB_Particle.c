/**
 * EMCP_WB_Particle.c - Particle preview handler of wb_particle (wave W5, phase5-w5-spec.md section 2.2)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Particle", dispatching on "action":
 *   spawn     a ParticleEffectEntity in the open world with EffectPath set to a .ptc, inside one
 *             entity action (BeginEntityAction, CreateEntity/6, SetVariableValue "EffectPath",
 *             EndEntityAction): the SCR_WorldWindowDataDropPlugin sequence without the window pixel
 *   stats     state, emitters, particle count, emitter names, active flag and simulation time
 *   control   play, stop, pause, stopEmission (ParticleEffectEntity) or restart (Particles.Restart)
 *   simulate  Particles.Simulate, or SimulateMultiStep with minFps; seconds capped at 60
 *   param     one float EmitterParam of one emitter: GetParam and GetParamOrig (P-W5-08)
 *   setParam  SetParam, or MultParam with multiply; read back through GetParam (P-W5-08)
 *   remove    DeleteEntity of a ParticleEffectEntity inside one entity action (undoable)
 *
 * Never opens or reads the Particle Editor (DEC-042, DEC-068 OD-6). Never calls
 * ParticleEffectEntity.SpawnParticleEffect (a game entity outside the editor's sources: no undo).
 * Workbench.GetModule(WorldEditor) opens a closed World Editor (DEC-053); no other module is touched.
 *
 * Guards (spec section 1.3):
 *   spawn, remove        project+world, +confirm: the project is found (EMCP_WB_Guard, DEC-058), a
 *                        world is loaded (EMCP_WB_Common.NoWorldReason), not prefab edit, not play
 *                        mode, the open world is under the project's "$<id>:" prefix; a dry run
 *                        unless confirm is true. Undo with wb_undo_redo.
 *   stats, param         world (read).
 *   control, simulate,   world; runtime only: they change engine state, no file, no confirm.
 *   setParam
 * Inputs the engine is not proven to accept are refused before the call: only the 23 float
 * EmitterParams are read or set (a vector, bool or int param through the out void of GetParam would
 * write a value of another size), CURRENT_TIME is read only and has no original, the emitter index
 * is checked against GetNumEmitters, values and multipliers are bounded, seconds is at most 60.
 * Floats travel as text (EMCP_WB_Common.ParseFloat); the effect is a project-relative path or
 * {GUID}path, resolved through Workbench.GetResourceName, so a packed vanilla .ptc resolves by GUID.
 *
 * P-W5-08 isolation: the only GetParam/GetParamOrig calls are in EMCP_WB_ParticleParamRead.ReadFloat.
 * The isolation only makes the repair a two-line edit; it does not contain a compile error: one
 * error in any file fails the whole script bundle, so every handler is gone until the fix. If that
 * probe's compile kills the calls, delete the two marked lines there and set PARAM_READ false:
 * param then refuses UNPROVEN and setParam answers with empty before/after and a weak-oracle note.
 *
 * A refusal answers status "refused" (guards) or "error" with code and next set and message in the
 * form "CODE: text | next: step" (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Particle.json.
 */

class EMCP_WB_ParticleRequest : JsonApiStruct
{
	string action;
	//! spawn: .ptc as a project-relative path or {GUID}path
	string effect;
	//! spawn: "x y z" as text; default 10 m in front of the camera
	string coords;
	//! spawn: the new entity's name
	string name;
	//! spawn, remove: false (default) is a dry run
	bool confirm;
	//! every action but spawn: entity reference (id:/name:/index:)
	string entity;
	//! control: play, stop, pause, stopEmission, restart
	string op;
	//! simulate: seconds as text, above 0 and at most 60
	string seconds;
	//! simulate: minimum steps per second as text; given: SimulateMultiStep
	string minFps;
	//! param: emitter index; setParam: index or -1 for all. Not given: EMITTER_NOT_GIVEN
	int emitter;
	//! param, setParam: EmitterParam name (a float param)
	string param;
	//! setParam: value (or multiplier with multiply) as text
	string value;
	//! setParam: MultParam (multiple of the original) instead of SetParam
	bool multiply;

	void EMCP_WB_ParticleRequest()
	{
		RegV("action");
		RegV("effect");
		RegV("coords");
		RegV("name");
		RegV("confirm");
		RegV("entity");
		RegV("op");
		RegV("seconds");
		RegV("minFps");
		RegV("emitter");
		RegV("param");
		RegV("value");
		RegV("multiply");

		// EMCP_WB_Particle.EMITTER_NOT_GIVEN: not given (0 is an emitter, -1 is all)
		emitter = -2;
	}
}

class EMCP_WB_ParticleResponse : JsonApiStruct
{
	//! ok, error or refused
	string status;
	string code;
	string next;
	string message;
	string action;
	//! id: reference of the effect entity
	string entity;
	string effectPath;
	string coords;
	bool dryRun;
	//! EParticleEffectState name
	string state;
	int emitters;
	int particles;
	ref array<string> emitterNames;
	bool active;
	//! float as text
	string time;
	string stateBefore;
	string param;
	//! param: float as text
	string value;
	//! param: GetParamOrig as text ("" for CURRENT_TIME)
	string original;
	//! setParam: GetParam before and after, as text ("" when not read)
	string before;
	string after;
	bool removed;

	void EMCP_WB_ParticleResponse()
	{
		emitterNames = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("entity");
		RegV("effectPath");
		RegV("coords");
		RegV("dryRun");
		RegV("state");
		RegV("emitters");
		RegV("particles");
		RegV("emitterNames");
		RegV("active");
		RegV("time");
		RegV("stateBefore");
		RegV("param");
		RegV("value");
		RegV("original");
		RegV("before");
		RegV("after");
		RegV("removed");
	}
}

//! The effect entity an action works on: its source and its runtime ParticleEffectEntity. A holder,
//! not out parameters: an out parameter of an engine pointer type does not compile (W1 fix-up 1).
class EMCP_WB_ParticleTarget
{
	IEntitySource m_Src;
	ParticleEffectEntity m_Effect;

	//------------------------------------------------------------------------------------------------
	//! Nothing resolved. Through locals: the proven form for a null engine pointer member.
	void Reset()
	{
		IEntitySource noSrc = null;
		ParticleEffectEntity noEffect = null;
		m_Src = noSrc;
		m_Effect = noEffect;
	}
}

//! The P-W5-08 isolation: the only Particles.GetParam and GetParamOrig calls of the handler set.
class EMCP_WB_ParticleParamRead
{
	//! False after a P-W5-08 kill (a compile error, or a value always 0): then also delete the two
	//! lines marked P-W5-08 below. param refuses UNPROVEN; setParam sets without a readback.
	static const bool PARAM_READ = true;

	//------------------------------------------------------------------------------------------------
	//! One float EmitterParam of one emitter, current (GetParam) or original (GetParamOrig), into a
	//! typed float local. The caller has checked the particles, the index and that the param is a
	//! float. False when reading is switched off (PARAM_READ).
	static bool ReadFloat(Particles particles, int emitterIdx, EmitterParam which, bool orig, out float result)
	{
		result = 0;
		if (!PARAM_READ || !particles)
			return false;
		float readValue = 0;
		// Blocks, so deleting the two P-W5-08 lines leaves code that still compiles.
		if (orig)
		{
			particles.GetParamOrig(emitterIdx, which, readValue); // P-W5-08
		}
		else
		{
			particles.GetParam(emitterIdx, which, readValue); // P-W5-08
		}
		result = readValue;
		return true;
	}
}

class EMCP_WB_Particle : NetApiHandler
{
	//! emitter when the request leaves it out.
	static const int EMITTER_NOT_GIVEN = -2;
	//! simulate: seconds at most (spec section 2.2).
	static const float MAX_SECONDS = 60;
	//! simulate: minFps at most.
	static const float MAX_MIN_FPS = 240;
	//! setParam: |value| at most, and the multiplier range, so one call cannot flood the editor.
	static const float MAX_PARAM_VALUE = 10000;
	static const float MAX_MULTIPLIER = 10;
	//! spawn: metres in front of the camera when coords is not given.
	static const float CAMERA_DISTANCE = 10;
	static const string EFFECT_CLASS = "ParticleEffectEntity";
	static const string EFFECT_KEY = "EffectPath";
	//! The float EmitterParams (EmitterParam.c of 1.9.0.37 marks each one "Float"), "|"-delimited:
	//! a static const cannot be an array.
	static const string FLOAT_PARAMS = "|VELOCITY|VELOCITY_AFFECT|VELOCITY_RND|AVELOCITY|SIZE|SIZE_RND|STRETCH|AIR_RESISTANCE|AIR_RESISTANCE_RND|GRAVITY_SCALE|GRAVITY_SCALE_RND|BIRTH_RATE|BIRTH_RATE_RND|LIFETIME|LIFETIME_RND|EMITTING_TIME|CURRENT_TIME|SPRING|SCALE_X|SCALE_Y|CENTER_X|CENTER_Y|MAX_LV|";
	//! Read only: no GetParamOrig, no SetParam or MultParam (EmitterParam.c).
	static const string READ_ONLY_PARAM = "CURRENT_TIME";
	static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";
	static const string NO_WORLD = "NO_WORLD";
	static const string WRONG_MODE = "WRONG_MODE";
	static const string RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND";
	static const string NOT_A_PARTICLE_EFFECT = "NOT_A_PARTICLE_EFFECT";
	static const string NO_PARTICLES = "NO_PARTICLES";
	static const string ENGINE_FALSE = "ENGINE_FALSE";
	static const string UNPROVEN = "UNPROVEN";
	static const string NEXT_WORLD = "open a world (wb_module setResource)";
	static const string UNDO_SPAWN = "EMCP wb_particle spawn";
	static const string UNDO_REMOVE = "EMCP wb_particle remove";

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ParticleRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ParticleRequest req = EMCP_WB_ParticleRequest.Cast(request);
		EMCP_WB_ParticleResponse resp = new EMCP_WB_ParticleResponse();
		if (!req)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "spawn")
			Spawn(req, resp);
		else if (req.action == "stats")
			Stats(req, resp);
		else if (req.action == "control")
			Control(req, resp);
		else if (req.action == "simulate")
			SimulateEffect(req, resp);
		else if (req.action == "param")
			ReadParam(req, resp);
		else if (req.action == "setParam")
			WriteParam(req, resp);
		else if (req.action == "remove")
			Remove(req, resp);
		else
			Answer(resp, "error", INVALID_ARGUMENT, "unknown action '" + req.action + "'", "one of spawn, stats, control, simulate, param, setParam, remove");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! Sets status, code, next and message. With a code the message is in the
	//! EMCP_WB_Guard.RefusalMessage form; without one it is the text.
	protected static void Answer(EMCP_WB_ParticleResponse resp, string status, string code, string text, string nextStep)
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
	//! A guard refusal: status refused (EMCP_WB_Guard.REFUSED).
	protected static void Refuse(EMCP_WB_ParticleResponse resp, string code, string text, string nextStep)
	{
		Answer(resp, EMCP_WB_Guard.REFUSED, code, text, nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of class "world": the World Editor answers an API with a loaded world
	//! (EMCP_WB_Common.NoWorldReason), not in prefab edit mode, not in play mode. The API, or null
	//! with the refusal written. GetModule opens a closed World Editor (DEC-053).
	protected static WorldEditorAPI WorldApi(EMCP_WB_ParticleResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Answer(resp, "error", "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null (it may have been opened by this call)", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Answer(resp, "error", NO_WORLD, noWorld, NEXT_WORLD);
			return null;
		}
		if (worldEditor.IsPrefabEditMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in prefab edit mode; nothing was done", "leave prefab edit mode first");
			return null;
		}
		if (api.IsGameMode())
		{
			Refuse(resp, WRONG_MODE, "the World Editor is in play mode; nothing was done", "stop play first (wb_world stop)");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The guard of class "project+world": the project is found (DEC-058), the "world" guard, and the
	//! open world lies under the project's "$<id>:" prefix (WorldEditorAPI.GetWorldPath, as
	//! wb_module save checks it). The API, or null with the refusal written.
	protected static WorldEditorAPI ProjectWorldApi(EMCP_WB_ParticleResponse resp)
	{
		string projectId = EMCP_WB_Guard.ProjectId();
		if (projectId == "")
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "spawn and remove need the handlers installed in the open project; nothing was changed", "install the handlers in the project you have open");
			return null;
		}
		WorldEditorAPI api = WorldApi(resp);
		if (!api)
			return null;
		string worldPath = "";
		api.GetWorldPath(worldPath);
		if (!worldPath.StartsWith("$" + projectId + ":"))
		{
			Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "the open world is not a world of the open project; nothing was changed", "open a world of the project you have open");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! Resolves the entity reference to a ParticleEffectEntity into target; writes resp.entity.
	//! False with the error written: ENTITY_NOT_FOUND or INVALID_ARGUMENT (EMCP_WB_EntityRef), or
	//! NOT_A_PARTICLE_EFFECT when the entity's runtime entity is not a ParticleEffectEntity.
	protected static bool ResolveEffect(WorldEditorAPI api, string entityRef, EMCP_WB_ParticleResponse resp, notnull EMCP_WB_ParticleTarget target)
	{
		target.Reset();
		if (entityRef == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "entity required", "an id:, name: or index: reference (wb_entity list)");
			return false;
		}
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, entityRef, resolved))
		{
			Answer(resp, "error", resolved.m_Code, resolved.m_Why, "list the entities (wb_entity list) and pass the id: it answers");
			return false;
		}
		IEntitySource src = resolved.m_Src;
		if (!src)
		{
			Answer(resp, "error", EMCP_WB_EntityRef.ENTITY_NOT_FOUND, "the reference resolved to no entity source", "list the entities (wb_entity list) and pass the id: it answers");
			return false;
		}
		resp.entity = EMCP_WB_EntityRef.Format(src);
		IEntity ent = api.SourceToEntity(src);
		ParticleEffectEntity effect = ParticleEffectEntity.Cast(ent);
		if (!effect)
		{
			Answer(resp, "error", NOT_A_PARTICLE_EFFECT, "the entity (class " + src.GetClassName() + ") has no runtime ParticleEffectEntity", "spawn one with wb_particle spawn");
			return false;
		}
		target.m_Src = src;
		target.m_Effect = effect;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The Particles of an effect, or null with NO_PARTICLES written.
	protected static Particles ParticlesOf(ParticleEffectEntity effect, EMCP_WB_ParticleResponse resp)
	{
		Particles particles = effect.GetParticles();
		if (!particles)
			Answer(resp, "error", NO_PARTICLES, "GetParticles returned null: the effect has no loaded particle system (no EffectPath, or an empty .ptc)", "check the effect with wb_particle stats");
		return particles;
	}

	//------------------------------------------------------------------------------------------------
	//! The name of an EParticleEffectState.
	static string StateName(ParticleEffectEntity effect)
	{
		if (!effect)
			return "";
		return typename.EnumToString(EParticleEffectState, effect.GetState());
	}

	//------------------------------------------------------------------------------------------------
	//! The GUID of a resource name "{GUID}path", "" when it has none.
	static string GuidOf(string resourceName)
	{
		if (!resourceName.StartsWith("{"))
			return "";
		int close = resourceName.IndexOf("}");
		if (close != 17)
			return "";
		return resourceName.Substring(1, 16);
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name "{GUID}path" of a .ptc given as a project-relative path or {GUID}path, ""
	//! with code and why when it does not resolve. Workbench.GetResourceName names it; a packed file
	//! is confirmed by its GUID (GetResourceName("{GUID}") answers the GUID unchanged for an unknown
	//! one), never through GetAbsolutePath (a packed file does not resolve there).
	static string EffectNameOf(string effectInput, out string code, out string why)
	{
		code = "";
		why = "";
		string pathPart = effectInput;
		if (effectInput.StartsWith("{"))
		{
			if (GuidOf(effectInput) == "")
			{
				code = INVALID_ARGUMENT;
				why = "a GUID is 16 characters in braces, got '" + effectInput + "'";
				return "";
			}
			pathPart = effectInput.Substring(18, effectInput.Length() - 18);
		}
		if (pathPart != "")
		{
			string clean = "";
			string cleanWhy = "";
			if (!EMCP_WB_Guard.CleanRelative(pathPart, clean, cleanWhy))
			{
				code = INVALID_ARGUMENT;
				why = "effect: " + cleanWhy;
				return "";
			}
		}
		ResourceName named = Workbench.GetResourceName(effectInput);
		string namedText = named;
		string guid = GuidOf(namedText);
		string rel = "";
		if (guid != "")
			rel = named.GetPath();
		if (guid == "" || rel == "")
		{
			code = RESOURCE_NOT_FOUND;
			why = "Workbench.GetResourceName gave no {GUID}path for '" + effectInput + "' (got '" + namedText + "')";
			return "";
		}
		string braced = "{" + guid + "}";
		ResourceName known = Workbench.GetResourceName(braced);
		string knownText = known;
		if (knownText == "" || knownText == braced)
		{
			code = RESOURCE_NOT_FOUND;
			why = "the resource database does not know " + braced;
			return "";
		}
		string lower = rel;
		lower.ToLower();
		if (!lower.EndsWith(".ptc"))
		{
			code = INVALID_ARGUMENT;
			why = "effect must be a .ptc, got '" + rel + "'";
			return "";
		}
		return namedText;
	}

	//------------------------------------------------------------------------------------------------
	//! spawn: CreateEntity("ParticleEffectEntity") at coords (default CAMERA_DISTANCE in front of the
	//! camera) in the current layer, then SetVariableValue EffectPath, in one entity action. A dry
	//! run without confirm.
	protected static void Spawn(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		if (req.effect == "")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "effect required", "a .ptc path or {GUID}path");
			return;
		}
		vector pos = vector.Zero;
		string parseErr = "";
		bool hasCoords = req.coords != "";
		if (hasCoords && !EMCP_WB_Common.ParseVectorString(req.coords, pos, parseErr))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "coords: " + parseErr, "coords as \"x y z\"");
			return;
		}
		WorldEditorAPI api = ProjectWorldApi(resp);
		if (!api)
			return;
		string code = "";
		string why = "";
		string effectName = EffectNameOf(req.effect, code, why);
		if (effectName == "")
		{
			Answer(resp, "error", code, why + "; nothing was created", "find the effect with wb_resources search");
			return;
		}
		if (!hasCoords)
		{
			BaseWorld world = api.GetWorld();
			if (!world)
			{
				Answer(resp, "error", NO_WORLD, "GetWorld returned null", NEXT_WORLD);
				return;
			}
			vector camMat[4];
			world.GetCurrentCamera(camMat);
			pos = camMat[3] + camMat[2] * CAMERA_DISTANCE;
		}
		resp.effectPath = effectName;
		resp.coords = EMCP_WB_Common.VectorToString(pos);

		if (!req.confirm)
		{
			resp.dryRun = true;
			Answer(resp, "ok", "", "dry run: would create a ParticleEffectEntity with EffectPath " + effectName + " at " + resp.coords + "; nothing was created; pass confirm true", "");
			return;
		}
		resp.dryRun = false;
		if (!api.BeginEntityAction(UNDO_SPAWN))
		{
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was created", "finish the open edit in the World Editor, then retry");
			return;
		}
		int layerId = api.GetCurrentEntityLayerId();
		IEntitySource created = api.CreateEntity(EFFECT_CLASS, req.name, layerId, null, pos, vector.Zero);
		if (!created)
		{
			api.EndEntityAction();
			Answer(resp, "error", ENGINE_FALSE, "CreateEntity returned null for " + EFFECT_CLASS + "; nothing was created", "check the world with wb_world state");
			return;
		}
		bool pathSet = api.SetVariableValue(created, null, EFFECT_KEY, effectName);
		if (!pathSet)
		{
			// Leave nothing behind: an effect without its path is not what was asked for.
			api.DeleteEntity(created);
			api.EndEntityAction();
			Answer(resp, "error", ENGINE_FALSE, "SetVariableValue EffectPath returned false; the entity was deleted again in the same action", "check the .ptc with particle inspect");
			return;
		}
		api.EndEntityAction();

		resp.entity = EMCP_WB_EntityRef.Format(created);
		ResourceName readBack = "";
		created.Get(EFFECT_KEY, readBack);
		string readText = readBack;
		resp.effectPath = readText;
		string note = "";
		if (req.name != "" && created.GetName() != req.name)
			note = "; the engine named it '" + created.GetName() + "', not '" + req.name + "'";
		Answer(resp, "ok", "", "created; read it with wb_particle stats; undo with wb_undo_redo or wb_particle remove" + note, "");
	}

	//------------------------------------------------------------------------------------------------
	//! stats: the effect's path, state, active flag and simulation time, then its emitters and
	//! particle count from Particles.
	protected static void Stats(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		WorldEditorAPI api = WorldApi(resp);
		if (!api)
			return;
		EMCP_WB_ParticleTarget target = new EMCP_WB_ParticleTarget();
		if (!ResolveEffect(api, req.entity, resp, target))
			return;
		ParticleEffectEntity effect = target.m_Effect;
		IEntitySource src = target.m_Src;
		ResourceName effectName = "";
		src.Get(EFFECT_KEY, effectName);
		string effectText = effectName;
		resp.effectPath = effectText;
		resp.state = StateName(effect);
		resp.active = effect.HasActiveParticles();
		resp.time = effect.GetTotalSimulationTime().ToString();
		Particles particles = ParticlesOf(effect, resp);
		if (!particles)
			return;
		resp.emitters = particles.GetNumEmitters();
		resp.particles = particles.GetNumParticles();
		array<string> names = {};
		particles.GetEmitterNames(names);
		for (int i = 0; i < names.Count(); i++)
			resp.emitterNames.Insert(names.Get(i));
		Answer(resp, "ok", "", resp.emitters.ToString() + " emitters, " + resp.particles.ToString() + " particles, " + resp.state, "");
	}

	//------------------------------------------------------------------------------------------------
	//! control: Play, Stop, Pause, StopEmission or Particles.Restart; the state before and after.
	protected static void Control(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		string op = req.op;
		if (op != "play" && op != "stop" && op != "pause" && op != "stopEmission" && op != "restart")
		{
			Answer(resp, "error", INVALID_ARGUMENT, "op must be play, stop, pause, stopEmission or restart, got '" + op + "'", "pass one of the five ops");
			return;
		}
		WorldEditorAPI api = WorldApi(resp);
		if (!api)
			return;
		EMCP_WB_ParticleTarget target = new EMCP_WB_ParticleTarget();
		if (!ResolveEffect(api, req.entity, resp, target))
			return;
		ParticleEffectEntity effect = target.m_Effect;
		resp.stateBefore = StateName(effect);
		if (op == "play")
			effect.Play();
		else if (op == "stop")
			effect.Stop();
		else if (op == "pause")
			effect.Pause();
		else if (op == "stopEmission")
			effect.StopEmission();
		else
		{
			Particles particles = ParticlesOf(effect, resp);
			if (!particles)
				return;
			particles.Restart(false);
		}
		resp.state = StateName(effect);
		Answer(resp, "ok", "", op + ": " + resp.stateBefore + " -> " + resp.state + "; runtime only, nothing is saved", "");
	}

	//------------------------------------------------------------------------------------------------
	//! simulate: Particles.Simulate(seconds), or SimulateMultiStep(seconds, minFps). The engine runs
	//! the step later in the frame, so particles and time are as read right after the call; read
	//! stats again for the result.
	protected static void SimulateEffect(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		float duration = 0;
		if (!EMCP_WB_Common.ParseFloat(req.seconds, duration) || duration <= 0 || duration > MAX_SECONDS)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "seconds must be a number above 0 and at most " + MAX_SECONDS.ToString() + ", got '" + req.seconds + "'", "pass seconds as text, e.g. \"1\"");
			return;
		}
		bool multiStep = req.minFps != "";
		float stepsPerSecond = 0;
		if (multiStep && (!EMCP_WB_Common.ParseFloat(req.minFps, stepsPerSecond) || stepsPerSecond <= 0 || stepsPerSecond > MAX_MIN_FPS))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "minFps must be a number above 0 and at most " + MAX_MIN_FPS.ToString() + ", got '" + req.minFps + "'", "leave minFps out for one step");
			return;
		}
		WorldEditorAPI api = WorldApi(resp);
		if (!api)
			return;
		EMCP_WB_ParticleTarget target = new EMCP_WB_ParticleTarget();
		if (!ResolveEffect(api, req.entity, resp, target))
			return;
		ParticleEffectEntity effect = target.m_Effect;
		Particles particles = ParticlesOf(effect, resp);
		if (!particles)
			return;
		bool finished = false;
		if (multiStep)
			finished = particles.SimulateMultiStep(duration, stepsPerSecond);
		else
			finished = particles.Simulate(duration);
		resp.particles = particles.GetNumParticles();
		resp.time = effect.GetTotalSimulationTime().ToString();
		string doneNote = "";
		if (finished)
			doneNote = "; the engine reports the effect finished";
		Answer(resp, "ok", "", "simulation of " + duration.ToString() + " s scheduled (it runs later this frame: read stats again for the result); runtime only" + doneNote, "");
	}

	//------------------------------------------------------------------------------------------------
	//! The EmitterParam of a name, or -1 with code and why: only the float params (FLOAT_PARAMS) are
	//! taken, resolved through typename.StringToEnum.
	static int ParamOf(string paramName, out string why)
	{
		why = "";
		if (paramName == "" || paramName.Contains("|") || !FLOAT_PARAMS.Contains("|" + paramName + "|"))
		{
			why = "param must be a float EmitterParam (" + FLOAT_PARAMS + "), got '" + paramName + "'; vector, bool and int params are not read or set";
			return -1;
		}
		int enumValue = typename.StringToEnum(EmitterParam, paramName);
		if (enumValue < 0)
			why = "typename.StringToEnum(EmitterParam, '" + paramName + "') found no value";
		return enumValue;
	}

	//------------------------------------------------------------------------------------------------
	//! True when emitterIdx is an emitter of particles (0 <= idx < GetNumEmitters), or -1 when
	//! allowAll; false with the error written.
	protected static bool EmitterOk(Particles particles, int emitterIdx, bool allowAll, EMCP_WB_ParticleResponse resp)
	{
		int count = particles.GetNumEmitters();
		if (emitterIdx == EMITTER_NOT_GIVEN)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "emitter required", "an emitter index from wb_particle stats");
			return false;
		}
		if (allowAll && emitterIdx == -1 && count > 0)
			return true;
		if (emitterIdx < 0 || emitterIdx >= count)
		{
			Answer(resp, "error", INVALID_ARGUMENT, "emitter " + emitterIdx.ToString() + " is out of range (the effect has " + count.ToString() + " emitters)", "an emitter index from wb_particle stats");
			return false;
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! param: GetParam and GetParamOrig of one float param of one emitter (P-W5-08), as text.
	protected static void ReadParam(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		resp.param = req.param;
		if (!EMCP_WB_ParticleParamRead.PARAM_READ)
		{
			Refuse(resp, UNPROVEN, "reading an EmitterParam (Particles.GetParam out void) did not pass probe P-W5-08; nothing was read", "read the emitter offline with particle emitter");
			return;
		}
		string why = "";
		int enumValue = ParamOf(req.param, why);
		if (enumValue < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "a float EmitterParam name such as BIRTH_RATE");
			return;
		}
		WorldEditorAPI api = WorldApi(resp);
		if (!api)
			return;
		EMCP_WB_ParticleTarget target = new EMCP_WB_ParticleTarget();
		if (!ResolveEffect(api, req.entity, resp, target))
			return;
		Particles particles = ParticlesOf(target.m_Effect, resp);
		if (!particles)
			return;
		if (!EmitterOk(particles, req.emitter, false, resp))
			return;
		EmitterParam which = enumValue;
		float current = 0;
		EMCP_WB_ParticleParamRead.ReadFloat(particles, req.emitter, which, false, current);
		resp.value = current.ToString();
		if (req.param != READ_ONLY_PARAM)
		{
			float orig = 0;
			EMCP_WB_ParticleParamRead.ReadFloat(particles, req.emitter, which, true, orig);
			resp.original = orig.ToString();
		}
		Answer(resp, "ok", "", req.param + " of emitter " + req.emitter.ToString() + ": " + resp.value, "");
	}

	//------------------------------------------------------------------------------------------------
	//! setParam: SetParam(emitter, param, value), or MultParam (a multiple of the original) with
	//! multiply; before and after read back through GetParam (emitter 0 for -1). Runtime only.
	protected static void WriteParam(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		resp.param = req.param;
		string why = "";
		int enumValue = ParamOf(req.param, why);
		if (enumValue < 0)
		{
			Answer(resp, "error", INVALID_ARGUMENT, why, "a float EmitterParam name such as BIRTH_RATE");
			return;
		}
		if (req.param == READ_ONLY_PARAM)
		{
			Answer(resp, "error", INVALID_ARGUMENT, READ_ONLY_PARAM + " is read only (no SetParam or MultParam)", "read it with param");
			return;
		}
		float amount = 0;
		if (!EMCP_WB_Common.ParseFloat(req.value, amount))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "value must be a number as text, got '" + req.value + "'", "pass value as text, e.g. \"0.5\"");
			return;
		}
		if (req.multiply && (amount < 0 || amount > MAX_MULTIPLIER))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "a multiplier must be from 0 to " + MAX_MULTIPLIER.ToString() + ", got " + amount.ToString(), "a smaller multiplier");
			return;
		}
		if (!req.multiply && (amount < -MAX_PARAM_VALUE || amount > MAX_PARAM_VALUE))
		{
			Answer(resp, "error", INVALID_ARGUMENT, "value must be from -" + MAX_PARAM_VALUE.ToString() + " to " + MAX_PARAM_VALUE.ToString() + ", got " + amount.ToString(), "a smaller value");
			return;
		}
		WorldEditorAPI api = WorldApi(resp);
		if (!api)
			return;
		EMCP_WB_ParticleTarget target = new EMCP_WB_ParticleTarget();
		if (!ResolveEffect(api, req.entity, resp, target))
			return;
		Particles particles = ParticlesOf(target.m_Effect, resp);
		if (!particles)
			return;
		if (!EmitterOk(particles, req.emitter, true, resp))
			return;
		EmitterParam which = enumValue;
		int readIdx = req.emitter;
		if (readIdx < 0)
			readIdx = 0;
		float beforeValue = 0;
		bool readable = EMCP_WB_ParticleParamRead.ReadFloat(particles, readIdx, which, false, beforeValue);
		if (req.multiply)
			particles.MultParam(req.emitter, which, amount);
		else
			particles.SetParam(req.emitter, which, amount);
		if (!readable)
		{
			Answer(resp, "ok", "", "set; no readback: GetParam did not pass probe P-W5-08 (weak oracle); runtime only, restart or setParam back to undo", "");
			return;
		}
		float afterValue = 0;
		EMCP_WB_ParticleParamRead.ReadFloat(particles, readIdx, which, false, afterValue);
		resp.before = beforeValue.ToString();
		resp.after = afterValue.ToString();
		string scope = "emitter " + req.emitter.ToString();
		if (req.emitter == -1)
			scope = "all emitters (read back on emitter 0)";
		Answer(resp, "ok", "", req.param + " of " + scope + ": " + resp.before + " -> " + resp.after + "; runtime only, setParam back or restart to undo", "");
	}

	//------------------------------------------------------------------------------------------------
	//! remove: DeleteEntity of a ParticleEffectEntity in one entity action. A dry run without confirm.
	protected static void Remove(EMCP_WB_ParticleRequest req, EMCP_WB_ParticleResponse resp)
	{
		WorldEditorAPI api = ProjectWorldApi(resp);
		if (!api)
			return;
		EMCP_WB_ParticleTarget target = new EMCP_WB_ParticleTarget();
		if (!ResolveEffect(api, req.entity, resp, target))
			return;
		IEntitySource src = target.m_Src;
		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.removed = false;
			Answer(resp, "ok", "", "dry run: would delete " + resp.entity + "; nothing was deleted; pass confirm true", "");
			return;
		}
		resp.dryRun = false;
		if (!api.BeginEntityAction(UNDO_REMOVE))
		{
			Refuse(resp, ENGINE_FALSE, "BeginEntityAction returned false (an edit action is already open); nothing was deleted", "finish the open edit in the World Editor, then retry");
			return;
		}
		bool deleted = api.DeleteEntity(src);
		api.EndEntityAction();
		resp.removed = deleted;
		if (!deleted)
		{
			Answer(resp, "error", ENGINE_FALSE, "DeleteEntity returned false", "read the entity back with wb_particle stats");
			return;
		}
		Answer(resp, "ok", "", "deleted; undo with wb_undo_redo", "");
	}
}
