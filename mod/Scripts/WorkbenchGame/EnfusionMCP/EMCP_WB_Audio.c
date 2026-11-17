/**
 * EMCP_WB_Audio.c - Sound audition handler of wb_audio (wave W5, phase5-w5-spec.md section 2.1)
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Audio", dispatching on "action":
 *   play            Workbench.GetResourceName of an .acp, AudioSystem.PlayEventInitialize, then
 *                   AudioSystem.PlayEvent(resource, eventName, transform, signal names, values) at a
 *                   position (default: BaseWorld.GetCurrentCamera of the World Editor's world) and
 *                   IsSoundPlayed; play-mode guard
 *   playSound       AudioSystem.PlaySound of a .wav or .snd, IsSoundPlayed; play-mode guard
 *   isPlaying       AudioSystem.IsSoundPlayed of a handle
 *   stop            IsSoundPlayed, TerminateSound or TerminateSoundFadeOut(handle, true, fadeTime),
 *                   IsSoundPlayed
 *                   (fix-up 2) IsSoundPlayed is true once a sound has FINISHED playing: vanilla
 *                   SCR_MovingSoundSourceManagerEntity.c:116-117 ("Sound finished playing") and
 *                   SCR_SoundManagerModule.c:346-347 drop a source when it answers true; run 2 read
 *                   false right after play and true right after stop. Every "playing" answered here
 *                   is therefore !IsSoundPlayed.
 *   audible         AudioSystem.IsAudible(resource, eventName, position) and GetDistance(position);
 *                   play-mode guard (the default position is the camera)
 *   variable        AudioSystem.GetVariableIDByName and GetVariableValue on a variables .conf
 *   setVariable     GetVariableValue, SetVariableByName, GetVariableValue (runtime only)
 *   resetVariables  AudioSystem.ResetVariables
 *   masters         AudioSystem.OutputVolume and GetMasterVolume over SFX, Music, VoiceChat, Dialog, UI
 *   setMaster       GetMasterVolume, SetMasterVolume, GetMasterVolume (runtime only)
 *   pause           AudioSystem.Pause or Resume of the mask OR-ed from (1 << master id), the form of
 *                   the engine's own doc comment on Pause
 *   outputStates    AudioSystem.GetOutputStateCount, GetOutputStateIdx of an .afm and
 *                   GetOutpuStateSignalIdx (the engine's spelling) of a signal name
 *   entityEvents    EMCP_WB_EntityRef.Resolve, WorldEditorAPI.SourceToEntity, IEntity.FindComponent
 *                   (BaseSoundComponent), GetEvents and GetSignalNames; world guard
 *   entityPlay      as entityEvents, then BaseSoundComponent.PlayStr and IsPlaying; world guard
 *   setSignal       IEntity.FindComponent(SignalsManagerComponent), FindSignal, GetSignalValue,
 *                   SetSignalValue, GetSignalValue; world guard. AddOrFindSignal is never called, so no
 *                   signal is created: an unknown name answers index -1 and sets nothing
 *   soundMap        ChimeraWorld.CastFrom, GetSoundWorld, SoundWorld.GetMapValuesAtPos and
 *                   GetMapValuesAdvAtPos; world guard
 *   open            Workbench.OpenResource of an existing project .acp or .sig after
 *                   EMCP_WB_Guard.TargetExistsInProject and EMCP_WB_OpenResource.OwnerOf (it must name
 *                   AudioEditor, else WRONG_MODULE); dry run unless confirm. Gated on probe P-W5-12:
 *                   with confirm it refuses GATED until the main session sets OPEN_PROVEN
 *
 * Play mode (fix-up 1, probe P-W5-06 KILLED in W5 run 1): play, playSound, isPlaying, audible,
 * variable, setVariable, resetVariables, masters, setMaster, pause and outputStates take the play-mode
 * guard (PlayApi: IsGameMode true, else WRONG_MODE) and run inside wb_world play. stop is not
 * guarded (it must always be sendable). entityEvents, entityPlay, setSignal and soundMap keep the
 * world guard (edit mode; P-W5-16 settles the entity half).
 *
 * Shared rules (spec section 1.3). Every World Editor call goes through EMCP_WB_Common.NoWorldReason
 * first, and the world guard refuses prefab edit mode and play mode (WRONG_MODE). Workbench.GetModule
 * opens a closed World Editor (DEC-053): the refusal says so. Float values travel as text and are parsed
 * with EMCP_WB_Common.ParseFloat, vectors with ParseVectorString; a float goes back as text. A resource
 * is a project-relative path or {GUID}path, resolved through Workbench.GetResourceName ({GUID} alone
 * for a packed file, never GetAbsolutePath); its type is checked before any engine call. Engine
 * pointers never travel through an out parameter. No file method, no RunCmd, no RunProcess, no
 * Configure. Nothing here saves a file: every change is runtime engine state.
 *
 * Not called on purpose (spec 2.1 notes): AudioSystem.SetBoundingVolumeParams (no getter, could not be
 * verified), CreateOutputState and SetOutputStateSignal (global mixer state with no reset call), the
 * MusicProject calls and ChimeraWorld.GetMusicManager (P-W5-10 only), SignalsManagerComponent
 * .AddOrFindSignal (it would create a signal).
 *
 * A refusal answers status refused, code, next and a message "CODE: text | next: step"
 * (EMCP_WB_Guard.RefusalMessage). Keys: contracts/EMCP_WB_Audio.json.
 */

class EMCP_WB_AudioRequest : JsonApiStruct
{
	string action;
	// play, playSound, audible, variable, setVariable, outputStates: rel path or {GUID}path
	string resource;
	// play, audible, entityPlay: the event (Sound node) name; not "event", an Enforce keyword
	string eventName;
	// play, audible, soundMap: "x y z" as text; empty: the camera
	string position;
	// play: name=value per signal, the value as text
	ref array<string> signals;
	// isPlaying, stop: an AudioHandle; -1 when not given
	int handle;
	// stop: seconds as text; empty: cut at once
	string fadeTime;
	// variable, setVariable, setSignal: variable or signal name; outputStates: signal name
	string name;
	// setVariable, setMaster, setSignal: float as text
	string value;
	// setMaster: SFX, Music, VoiceChat, Dialog or UI
	string master;
	// pause: master names
	ref array<string> masters;
	// pause: resume instead of pause
	bool resume;
	// entityEvents, entityPlay, setSignal: id:/name:/index: reference
	string entity;
	// open: project-relative .acp or .sig
	string path;
	// open: true opens; else a dry run
	bool confirm;

	void EMCP_WB_AudioRequest()
	{
		signals = {};
		masters = {};

		RegV("action");
		RegV("resource");
		RegV("eventName");
		RegV("position");
		RegV("signals");
		RegV("handle");
		RegV("fadeTime");
		RegV("name");
		RegV("value");
		RegV("master");
		RegV("masters");
		RegV("resume");
		RegV("entity");
		RegV("path");
		RegV("confirm");

		// Defaults for keys the request leaves out.
		handle = -1;
		resume = false;
		confirm = false;
	}
}

class EMCP_WB_AudioResponse : JsonApiStruct
{
	// ok, error or refused (EMCP_WB_Guard.REFUSED)
	string status;
	string code;
	string next;
	string message;
	string action;
	// play, playSound, isPlaying, stop, entityPlay
	int handle;
	bool playing;
	// play, soundMap: the position used, as text
	string position;
	// stop
	bool playingBefore;
	// audible: floats as text
	string audibility;
	string distance;
	// variable, setVariable
	int id;
	string value;
	// setVariable, setMaster, setSignal: floats as text
	string before;
	string after;
	// resetVariables
	bool reset;
	// masters: float as text; masters, pause: one row per master
	string outputVolume;
	ref array<string> masters;
	// setMaster
	string master;
	// pause
	bool paused;
	// outputStates: instance count; entityEvents: event count
	int count;
	// outputStates: output-state index; setSignal: signal index
	int index;
	// outputStates
	int signalIndex;
	// entityEvents, entityPlay, setSignal: the id: reference
	string entity;
	// entityEvents
	string component;
	ref array<string> events;
	ref array<string> signals;
	// soundMap: name=value per sound-map channel
	ref array<string> values;
	// open
	string path;
	string module;
	bool opened;
	bool dryRun;

	void EMCP_WB_AudioResponse()
	{
		masters = {};
		events = {};
		signals = {};
		values = {};

		RegV("status");
		RegV("code");
		RegV("next");
		RegV("message");
		RegV("action");
		RegV("handle");
		RegV("playing");
		RegV("position");
		RegV("playingBefore");
		RegV("audibility");
		RegV("distance");
		RegV("id");
		RegV("value");
		RegV("before");
		RegV("after");
		RegV("reset");
		RegV("outputVolume");
		RegV("masters");
		RegV("master");
		RegV("paused");
		RegV("count");
		RegV("index");
		RegV("signalIndex");
		RegV("entity");
		RegV("component");
		RegV("events");
		RegV("signals");
		RegV("values");
		RegV("path");
		RegV("module");
		RegV("opened");
		RegV("dryRun");

		handle = -1;
		index = -1;
		signalIndex = -1;
		id = -1;
	}
}

class EMCP_WB_AudioUtil
{
	//! The module OwnerOf must name for open.
	static const string AUDIO_EDITOR = "AudioEditor";
	//! open with confirm refuses GATED until the main session sets this after probe P-W5-12 passes
	//! (Workbench.OpenResource of a project .acp and .sig opens the Audio Editor with no modal).
	static const bool OPEN_PROVEN = false;
	static const string OPEN_PROBE = "P-W5-12";
	//! Resource types per action (lower case, comma-separated).
	static const string ACP_EXT = ".acp";
	static const string SAMPLE_EXTS = ".wav,.snd";
	static const string CONF_EXT = ".conf";
	static const string MIXER_EXT = ".afm";
	//! The masters, in the order masters answers them.
	static const string MASTER_NAMES = "SFX,Music,VoiceChat,Dialog,UI";
	//! stop: the longest fade, seconds.
	static const int FADE_MAX = 60;
	//! play: the most signals one call takes.
	static const int SIGNALS_MAX = 64;
	static const string NEXT_WORLD = "open a world in the World Editor (wb_module setResource)";
	static const string NEXT_ENTITY = "list the entities (wb_entity list) and pass the id: it answers";
	static const string NEXT_SOUND_WORLD = "open a game world (a ChimeraWorld with a SoundWorld) in the World Editor";
	static const string NEXT_PLAY = "wb_world play, then repeat the call; wb_world stop after";

	//------------------------------------------------------------------------------------------------
	//! Sets a refusal: status refused, code, next and the message "CODE: text | next: step".
	static void Refuse(EMCP_WB_AudioResponse resp, string code, string text, string nextStep)
	{
		resp.status = EMCP_WB_Guard.REFUSED;
		resp.code = code;
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage(code, EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! An engine call that returned false: status error, code ENGINE_FALSE.
	static void EngineFalse(EMCP_WB_AudioResponse resp, string text, string nextStep)
	{
		resp.status = "error";
		resp.code = "ENGINE_FALSE";
		resp.next = nextStep;
		resp.message = EMCP_WB_Guard.RefusalMessage("ENGINE_FALSE", EMCP_WB_Guard.ScrubHome(text), nextStep);
	}

	//------------------------------------------------------------------------------------------------
	//! The world guard (spec 1.3): the World Editor's API with a loaded world (NoWorldReason empty), not
	//! in prefab edit mode and not in play mode; null with the response refused otherwise. GetModule
	//! opens a closed World Editor (DEC-053): the refusal says so.
	static WorldEditorAPI WorldApi(EMCP_WB_AudioResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		string noWorld = EMCP_WB_Common.NoWorldReason(worldEditor, api);
		if (noWorld != "")
		{
			Refuse(resp, "NO_WORLD", noWorld + " (GetModule may have opened the World Editor)", NEXT_WORLD);
			return null;
		}
		if (worldEditor.IsPrefabEditMode())
		{
			Refuse(resp, "WRONG_MODE", "the World Editor is in prefab edit mode; wb_audio runs on a world in edit mode", "leave prefab edit mode (open a world with wb_module setResource)");
			return null;
		}
		if (api.IsGameMode())
		{
			Refuse(resp, "WRONG_MODE", "the World Editor is in play mode; wb_audio runs in edit mode", "wb_world stop");
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! The play-mode guard of the AudioSystem actions (play, playSound, isPlaying, stop, audible,
	//! variable, setVariable, resetVariables, masters, setMaster, pause, outputStates). Probe P-W5-06
	//! was KILLED in W5 run 1: in edit mode a known-good vanilla event answered handle 256 not
	//! playing, GetVariableIDByName answered -1 for GInterior of GlobalVariables.conf (which holds it)
	//! and IsSoundPlayed(0) answered true. Fix-up 2: IsSoundPlayed is true once a sound has finished
	//! (see the header), so the first and third legs were misread; the kill now rests on the
	//! GInterior leg alone (run 2 read id 17 for it in play mode). Its repoint: these actions refuse in edit mode and run inside
	//! wb_world play. The World Editor's API in play mode (IsGameMode true); null with the response
	//! refused WRONG_MODE otherwise. GetModule opens a closed World Editor (DEC-053): the refusal says so.
	static WorldEditorAPI PlayApi(EMCP_WB_AudioResponse resp)
	{
		WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
		if (!worldEditor)
		{
			Refuse(resp, "MODULE_NOT_OPEN", "the World Editor is not open: GetModule returned null", "wb_module open WorldEditor");
			return null;
		}
		WorldEditorAPI api = worldEditor.GetApi();
		if (!api || !api.IsGameMode())
		{
			Refuse(resp, "WRONG_MODE", "the World Editor is not in play mode: the AudioSystem does not run in edit mode (probe P-W5-06 killed, W5 run 1; GetModule may have opened the World Editor)", NEXT_PLAY);
			return null;
		}
		return api;
	}

	//------------------------------------------------------------------------------------------------
	//! True when lower ends in one of exts (lower case, comma-separated).
	static bool EndsWithAny(string lower, string exts)
	{
		array<string> parts = {};
		exts.Split(",", parts, true);
		foreach (string ext : parts)
		{
			if (lower.EndsWith(ext))
				return true;
		}
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The resource name "{GUID}path" of a project-relative path or a {GUID}path, whose path ends in one
	//! of exts; "" with the response refused (INVALID_ARGUMENT, RESOURCE_NOT_FOUND). A {GUID}path is
	//! looked up by its GUID alone (Workbench.GetResourceName("{GUID}") answers the GUID unchanged for an
	//! unknown one, and resolves a packed file, which GetAbsolutePath does not: W2 run 2); the path the
	//! database names must be the path given, case aside. A relative path is cleaned
	//! (EMCP_WB_Guard.CleanRelative) and resolved with Workbench.GetResourceName. No file method.
	static string ResourceOf(string input, string exts, EMCP_WB_AudioResponse resp)
	{
		if (input == "")
		{
			Refuse(resp, "INVALID_ARGUMENT", "resource is required", "pass a project-relative path or {GUID}path ending in " + exts);
			return "";
		}
		string resolved = "";
		string checkedPath = "";
		if (input.StartsWith("{"))
		{
			if (input.IndexOf("}") != 17)
			{
				Refuse(resp, "INVALID_ARGUMENT", "a GUID is 16 characters in braces, got '" + input + "'", "pass {GUID}path");
				return "";
			}
			string braced = input.Substring(0, 18);
			string givenPath = input.Substring(18, input.Length() - 18);
			ResourceName known = Workbench.GetResourceName(braced);
			string knownText = known;
			if (knownText == "" || knownText == braced)
			{
				Refuse(resp, "RESOURCE_NOT_FOUND", "the resource database knows no resource " + braced, "check the GUID with wb_resources resolve");
				return "";
			}
			string knownPath = known.GetPath();
			if (givenPath != "" && knownPath != "")
			{
				string wanted = givenPath;
				wanted.ToLower();
				string knownLower = knownPath;
				knownLower.ToLower();
				if (wanted != knownLower)
				{
					Refuse(resp, "RESOURCE_NOT_FOUND", braced + " names " + knownPath + ", not " + givenPath, "pass the {GUID}path wb_resources resolve answers");
					return "";
				}
			}
			resolved = knownText;
			checkedPath = knownPath;
			if (checkedPath == "")
				checkedPath = givenPath;
		}
		else
		{
			string clean = "";
			string why = "";
			if (!EMCP_WB_Guard.CleanRelative(input, clean, why))
			{
				Refuse(resp, "INVALID_ARGUMENT", "resource: " + why, "pass a project-relative path or {GUID}path");
				return "";
			}
			ResourceName named = Workbench.GetResourceName(clean);
			string namedText = named;
			string namedPath = "";
			if (namedText.StartsWith("{") && namedText.IndexOf("}") == 17)
				namedPath = named.GetPath();
			if (namedPath == "")
			{
				Refuse(resp, "RESOURCE_NOT_FOUND", "Workbench.GetResourceName gave no {GUID}path for '" + clean + "' (got '" + namedText + "')", "check the path with wb_resources search");
				return "";
			}
			resolved = namedText;
			checkedPath = namedPath;
		}
		string lower = checkedPath;
		lower.ToLower();
		if (!EndsWithAny(lower, exts))
		{
			Refuse(resp, "INVALID_ARGUMENT", "this action takes a " + exts + " resource, got '" + checkedPath + "'", "pass a resource ending in " + exts);
			return "";
		}
		return resolved;
	}

	//------------------------------------------------------------------------------------------------
	//! The position of a request: "x y z" parsed with EMCP_WB_Common.ParseVectorString, or, when empty,
	//! the camera of the World Editor's world (BaseWorld.GetCurrentCamera, row 3). False with the
	//! response refused.
	static bool PositionOf(WorldEditorAPI api, string text, out vector pos, EMCP_WB_AudioResponse resp)
	{
		pos = vector.Zero;
		if (text != "")
		{
			string why = "";
			if (EMCP_WB_Common.ParseVectorString(text, pos, why))
				return true;
			pos = vector.Zero;
			Refuse(resp, "INVALID_ARGUMENT", "position: " + why, "pass position as x y z");
			return false;
		}
		BaseWorld world = api.GetWorld();
		if (!world)
		{
			Refuse(resp, "NO_WORLD", "GetWorld returned null: the world is not loaded", NEXT_WORLD);
			return false;
		}
		vector cam[4];
		world.GetCurrentCamera(cam);
		pos = cam[3];
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! A float sent as text (EMCP_WB_Common.ParseFloat); false with the response refused.
	static bool FloatOf(string text, string what, out float result, EMCP_WB_AudioResponse resp)
	{
		result = 0;
		if (EMCP_WB_Common.ParseFloat(text, result))
			return true;
		result = 0;
		Refuse(resp, "INVALID_ARGUMENT", what + " must be a number sent as text, got '" + text + "'", "pass " + what + " as text, e.g. \"0.5\"");
		return false;
	}

	//------------------------------------------------------------------------------------------------
	//! The AudioSystem id of a master name (SFX, Music, VoiceChat, Dialog, UI); false for another name.
	static bool MasterId(string masterName, out int masterId)
	{
		masterId = -1;
		if (masterName == "SFX")
			masterId = AudioSystem.SFX;
		else if (masterName == "Music")
			masterId = AudioSystem.Music;
		else if (masterName == "VoiceChat")
			masterId = AudioSystem.VoiceChat;
		else if (masterName == "Dialog")
			masterId = AudioSystem.Dialog;
		else if (masterName == "UI")
			masterId = AudioSystem.UI;
		else
			return false;
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! Splits name=value signals into the two arrays PlayEvent takes; false with the response refused
	//! for a malformed entry, a value that is not a number, or more than SIGNALS_MAX entries.
	static bool ParseSignals(array<string> raw, notnull array<string> sigNames, notnull array<float> sigValues, EMCP_WB_AudioResponse resp)
	{
		if (!raw)
			return true;
		if (raw.Count() > SIGNALS_MAX)
		{
			Refuse(resp, "INVALID_ARGUMENT", raw.Count().ToString() + " signals; at most " + SIGNALS_MAX.ToString(), "pass fewer signals");
			return false;
		}
		foreach (string entry : raw)
		{
			int eq = entry.IndexOf("=");
			if (eq < 1)
			{
				Refuse(resp, "INVALID_ARGUMENT", "a signal must be name=value, got '" + entry + "'", "pass signals as name=value");
				return false;
			}
			string sigName = entry.Substring(0, eq);
			string sigText = entry.Substring(eq + 1, entry.Length() - eq - 1);
			float sigValue = 0;
			if (!FloatOf(sigText, "signal " + sigName, sigValue, resp))
				return false;
			sigNames.Insert(sigName);
			sigValues.Insert(sigValue);
		}
		return true;
	}

	//------------------------------------------------------------------------------------------------
	//! The live entity of an entity reference (EMCP_WB_EntityRef.Resolve, WorldEditorAPI.SourceToEntity);
	//! the reference's id: form goes to resp.entity. Null with the response refused.
	static IEntity EntityOf(WorldEditorAPI api, string entityRef, EMCP_WB_AudioResponse resp)
	{
		if (entityRef == "")
		{
			Refuse(resp, "INVALID_ARGUMENT", "entity is required", NEXT_ENTITY);
			return null;
		}
		EMCP_WB_EntityRefResult resolved = new EMCP_WB_EntityRefResult();
		if (!EMCP_WB_EntityRef.Resolve(api, entityRef, resolved))
		{
			Refuse(resp, resolved.m_Code, resolved.m_Why, NEXT_ENTITY);
			return null;
		}
		IEntitySource src = resolved.m_Src;
		if (!src)
		{
			Refuse(resp, "ENTITY_NOT_FOUND", "the reference resolved to no entity source", NEXT_ENTITY);
			return null;
		}
		resp.entity = EMCP_WB_EntityRef.Format(src);
		IEntity ent = api.SourceToEntity(src);
		if (!ent)
		{
			Refuse(resp, "ENTITY_NOT_FOUND", "SourceToEntity returned null: the entity has no live instance in the editor world", NEXT_ENTITY);
			return null;
		}
		return ent;
	}

	//------------------------------------------------------------------------------------------------
	//! The BaseSoundComponent of a live entity, or null (no refusal: the caller tries SndOf next).
	static BaseSoundComponent SoundOf(IEntity ent)
	{
		return BaseSoundComponent.Cast(ent.FindComponent(BaseSoundComponent));
	}

	//------------------------------------------------------------------------------------------------
	//! The SndComponent of a live entity, or null. The game's sound components are not
	//! BaseSoundComponents: in the 1.9 scripts (generated, in the paks) SoundComponent derives from
	//! SimpleSoundComponent, then SndComponent, then GenericComponent, and SCR_CrowdSoundComponent,
	//! SCR_BuildingSoundComponent and the rest derive from SoundComponent. SndComponent has PlayStr,
	//! IsPlaying and GetSignalNames but no GetEvents (GameLib/generated/Components/SndComponent.c).
	static SndComponent SndOf(IEntity ent)
	{
		return SndComponent.Cast(ent.FindComponent(SndComponent));
	}

	//------------------------------------------------------------------------------------------------
	//! The refusal when neither a BaseSoundComponent nor an SndComponent is found.
	static void NoSound(EMCP_WB_AudioResponse resp)
	{
		Refuse(resp, "NO_SOUND_COMPONENT", "the entity has no sound component (FindComponent(BaseSoundComponent) and FindComponent(SndComponent) returned null)", "pick an entity whose prefab has a SoundComponent");
	}

	//------------------------------------------------------------------------------------------------
	//! A float as text.
	static string Text(float number)
	{
		return number.ToString();
	}
}

class EMCP_WB_Audio : NetApiHandler
{
	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_AudioRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_AudioRequest req = EMCP_WB_AudioRequest.Cast(request);
		EMCP_WB_AudioResponse resp = new EMCP_WB_AudioResponse();
		if (!req)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "no request", "send action");
			return resp;
		}
		resp.action = req.action;

		if (req.action == "play")
			DoPlay(req, resp);
		else if (req.action == "playSound")
			DoPlaySound(req, resp);
		else if (req.action == "isPlaying")
			DoIsPlaying(req, resp);
		else if (req.action == "stop")
			DoStop(req, resp);
		else if (req.action == "audible")
			DoAudible(req, resp);
		else if (req.action == "variable")
			DoVariable(req, resp);
		else if (req.action == "setVariable")
			DoSetVariable(req, resp);
		else if (req.action == "resetVariables")
			DoResetVariables(req, resp);
		else if (req.action == "masters")
			DoMasters(req, resp);
		else if (req.action == "setMaster")
			DoSetMaster(req, resp);
		else if (req.action == "pause")
			DoPause(req, resp);
		else if (req.action == "outputStates")
			DoOutputStates(req, resp);
		else if (req.action == "entityEvents")
			DoEntityEvents(req, resp);
		else if (req.action == "entityPlay")
			DoEntityPlay(req, resp);
		else if (req.action == "setSignal")
			DoSetSignal(req, resp);
		else if (req.action == "soundMap")
			DoSoundMap(req, resp);
		else if (req.action == "open")
			DoOpen(req, resp);
		else
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "unknown action '" + req.action + "'", "one of play, playSound, isPlaying, stop, audible, variable, setVariable, resetVariables, masters, setMaster, pause, outputStates, entityEvents, entityPlay, setSignal, soundMap, open");

		return resp;
	}

	//------------------------------------------------------------------------------------------------
	//! play: an event of an .acp at a position (default: the camera). Every input is checked before
	//! the first AudioSystem call; PlayEventInitialize (the .acp preload) false or an invalid handle
	//! refuses PLAY_FAILED. Reversed by stop with the handle.
	static void DoPlay(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.eventName == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "eventName is required", "pass the event (Sound node) name; audio events lists them");
			return;
		}
		array<string> sigNames = {};
		array<float> sigValues = {};
		if (!EMCP_WB_AudioUtil.ParseSignals(req.signals, sigNames, sigValues, resp))
			return;
		WorldEditorAPI api = EMCP_WB_AudioUtil.PlayApi(resp);
		if (!api)
			return;
		string resourceName = EMCP_WB_AudioUtil.ResourceOf(req.resource, EMCP_WB_AudioUtil.ACP_EXT, resp);
		if (resourceName == "")
			return;
		vector pos = vector.Zero;
		if (!EMCP_WB_AudioUtil.PositionOf(api, req.position, pos, resp))
			return;
		resp.position = EMCP_WB_Common.VectorToString(pos);

		if (!AudioSystem.PlayEventInitialize(resourceName))
		{
			EMCP_WB_AudioUtil.Refuse(resp, "PLAY_FAILED", "PlayEventInitialize returned false for " + resourceName, "check the .acp with audio inspect");
			return;
		}
		vector transf[4];
		Math3D.MatrixIdentity4(transf);
		transf[3] = pos;
		AudioHandle played = AudioSystem.PlayEvent(resourceName, req.eventName, transf, sigNames, sigValues);
		if (played == AudioHandle.Invalid)
		{
			// W5 run 2: SOUND_THROWN of the M67 .acp exists, yet PlayEvent answered an invalid handle at
			// 0 1 0 while IsAudible of the same event and position answered -1 (listener 399.982 m away).
			// The refusal names the audibility so an out-of-range position is told from a wrong name.
			string audibilityText = EMCP_WB_AudioUtil.Text(AudioSystem.IsAudible(resourceName, req.eventName, pos));
			string distanceText = EMCP_WB_AudioUtil.Text(AudioSystem.GetDistance(pos));
			EMCP_WB_AudioUtil.Refuse(resp, "PLAY_FAILED", "PlayEvent returned an invalid handle for event '" + req.eventName + "' of " + resourceName + " at " + resp.position + " (IsAudible " + audibilityText + ", -1 inaudible; listener distance " + distanceText + ")", "if IsAudible is -1, play nearer the listener (leave position out to play at the camera); else check the event name with audio events");
			return;
		}
		resp.handle = played;
		resp.playing = !AudioSystem.IsSoundPlayed(played);
		resp.status = "ok";
		resp.message = "playing event '" + req.eventName + "' of " + resourceName + "; stop it with wb_audio stop handle " + resp.handle.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! playSound: a sample (.wav or .snd) once through AudioSystem.PlaySound. Reversed by stop.
	static void DoPlaySound(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		WorldEditorAPI api = EMCP_WB_AudioUtil.PlayApi(resp);
		if (!api)
			return;
		string resourceName = EMCP_WB_AudioUtil.ResourceOf(req.resource, EMCP_WB_AudioUtil.SAMPLE_EXTS, resp);
		if (resourceName == "")
			return;
		AudioHandle played = AudioSystem.PlaySound(resourceName);
		if (played == AudioHandle.Invalid)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "PLAY_FAILED", "PlaySound returned an invalid handle for " + resourceName, "check the sample with wb_resources resolve");
			return;
		}
		resp.handle = played;
		resp.playing = !AudioSystem.IsSoundPlayed(played);
		resp.status = "ok";
		resp.message = "playing " + resourceName + "; stop it with wb_audio stop handle " + resp.handle.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! isPlaying: AudioSystem.IsSoundPlayed of a handle. A negative handle (none given) is refused.
	static void DoIsPlaying(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.handle < 0)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "handle is required (the handle play, playSound or entityPlay answered)", "pass handle");
			return;
		}
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		AudioHandle asked = req.handle;
		resp.handle = asked;
		resp.playing = !AudioSystem.IsSoundPlayed(asked);
		resp.status = "ok";
		resp.message = "handle " + resp.handle.ToString() + " playing " + resp.playing.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! stop: TerminateSound, or TerminateSoundFadeOut(handle, true, fadeTime) when a fade is given
	//! (0 to FADE_MAX seconds); IsSoundPlayed before and after. Not play-mode guarded: a stop must
	//! always be sendable (a restorer, an entityPlay handle in edit mode). playing and playingBefore
	//! are !IsSoundPlayed (true means finished; see the header).
	static void DoStop(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.handle < 0)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "handle is required (the handle play, playSound or entityPlay answered)", "pass handle");
			return;
		}
		bool fade = req.fadeTime != "";
		float fadeSeconds = 0;
		if (fade)
		{
			if (!EMCP_WB_AudioUtil.FloatOf(req.fadeTime, "fadeTime", fadeSeconds, resp))
				return;
			if (fadeSeconds < 0 || fadeSeconds > EMCP_WB_AudioUtil.FADE_MAX)
			{
				EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "fadeTime must be 0 to " + EMCP_WB_AudioUtil.FADE_MAX.ToString() + " seconds, got " + req.fadeTime, "leave fadeTime out to cut at once");
				return;
			}
		}
		AudioHandle asked = req.handle;
		resp.handle = asked;
		resp.playingBefore = !AudioSystem.IsSoundPlayed(asked);
		if (fade)
			AudioSystem.TerminateSoundFadeOut(asked, true, fadeSeconds);
		else
			AudioSystem.TerminateSound(asked);
		resp.playing = !AudioSystem.IsSoundPlayed(asked);
		resp.status = "ok";
		resp.message = "stop sent for handle " + resp.handle.ToString();
		if (fade)
			resp.message = resp.message + " with a fade of " + req.fadeTime + " s (playing stays true until the fade ends)";
	}

	//------------------------------------------------------------------------------------------------
	//! audible: AudioSystem.IsAudible(resource, eventName, position) (-1 for an inaudible event, else the
	//! distance to the listener, per its doc) and GetDistance(position). Nothing plays.
	static void DoAudible(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.eventName == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "eventName is required", "pass the event (Sound node) name");
			return;
		}
		WorldEditorAPI api = EMCP_WB_AudioUtil.PlayApi(resp);
		if (!api)
			return;
		string resourceName = EMCP_WB_AudioUtil.ResourceOf(req.resource, EMCP_WB_AudioUtil.ACP_EXT, resp);
		if (resourceName == "")
			return;
		vector pos = vector.Zero;
		if (!EMCP_WB_AudioUtil.PositionOf(api, req.position, pos, resp))
			return;
		float audibility = AudioSystem.IsAudible(resourceName, req.eventName, pos);
		float listenerDistance = AudioSystem.GetDistance(pos);
		resp.audibility = EMCP_WB_AudioUtil.Text(audibility);
		resp.distance = EMCP_WB_AudioUtil.Text(listenerDistance);
		resp.status = "ok";
		resp.message = "event '" + req.eventName + "' at " + EMCP_WB_Common.VectorToString(pos) + ": IsAudible " + resp.audibility + " (-1 inaudible), listener distance " + resp.distance;
	}

	//------------------------------------------------------------------------------------------------
	//! variable: GetVariableIDByName and GetVariableValue on a variables .conf. An id below 0 is an
	//! unknown variable (VARIABLE_NOT_FOUND).
	static void DoVariable(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.name == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "name is required", "pass the variable name; audio variables lists them");
			return;
		}
		string resourceName = EMCP_WB_AudioUtil.ResourceOf(req.resource, EMCP_WB_AudioUtil.CONF_EXT, resp);
		if (resourceName == "")
			return;
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		int varId = AudioSystem.GetVariableIDByName(req.name, resourceName);
		resp.id = varId;
		if (varId < 0)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "VARIABLE_NOT_FOUND", "no variable '" + req.name + "' in " + resourceName + " (GetVariableIDByName returned " + varId.ToString() + ")", "list the variables with audio variables");
			return;
		}
		resp.value = EMCP_WB_AudioUtil.Text(AudioSystem.GetVariableValue(req.name, resourceName));
		resp.status = "ok";
		resp.message = req.name + " = " + resp.value;
	}

	//------------------------------------------------------------------------------------------------
	//! setVariable: GetVariableValue, SetVariableByName, GetVariableValue. Runtime only, nothing is saved;
	//! reversed by setVariable with before, or by resetVariables.
	static void DoSetVariable(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.name == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "name is required", "pass the variable name");
			return;
		}
		float wanted = 0;
		if (!EMCP_WB_AudioUtil.FloatOf(req.value, "value", wanted, resp))
			return;
		string resourceName = EMCP_WB_AudioUtil.ResourceOf(req.resource, EMCP_WB_AudioUtil.CONF_EXT, resp);
		if (resourceName == "")
			return;
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		int varId = AudioSystem.GetVariableIDByName(req.name, resourceName);
		resp.id = varId;
		if (varId < 0)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "VARIABLE_NOT_FOUND", "no variable '" + req.name + "' in " + resourceName + " (GetVariableIDByName returned " + varId.ToString() + ")", "list the variables with audio variables");
			return;
		}
		resp.before = EMCP_WB_AudioUtil.Text(AudioSystem.GetVariableValue(req.name, resourceName));
		if (!AudioSystem.SetVariableByName(req.name, wanted, resourceName))
		{
			EMCP_WB_AudioUtil.EngineFalse(resp, "SetVariableByName returned false for '" + req.name + "'; nothing changed", "check the variable with wb_audio variable");
			return;
		}
		resp.after = EMCP_WB_AudioUtil.Text(AudioSystem.GetVariableValue(req.name, resourceName));
		resp.status = "ok";
		resp.message = req.name + ": " + resp.before + " -> " + resp.after + " (runtime only, nothing saved)";
	}

	//------------------------------------------------------------------------------------------------
	//! resetVariables: AudioSystem.ResetVariables (every runtime variable to 0 or its default).
	static void DoResetVariables(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		AudioSystem.ResetVariables();
		resp.reset = true;
		resp.status = "ok";
		resp.message = "runtime audio variables reset";
	}

	//------------------------------------------------------------------------------------------------
	//! masters: AudioSystem.OutputVolume and GetMasterVolume per master, one row name=value each.
	static void DoMasters(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		resp.outputVolume = EMCP_WB_AudioUtil.Text(AudioSystem.OutputVolume());
		array<string> names = {};
		string masterList = EMCP_WB_AudioUtil.MASTER_NAMES;
		masterList.Split(",", names, true);
		foreach (string masterName : names)
		{
			int masterId = -1;
			if (!EMCP_WB_AudioUtil.MasterId(masterName, masterId))
				continue;
			resp.masters.Insert(masterName + "=" + EMCP_WB_AudioUtil.Text(AudioSystem.GetMasterVolume(masterId)));
		}
		resp.status = "ok";
		resp.message = "output volume " + resp.outputVolume + "; " + resp.masters.Count().ToString() + " masters";
	}

	//------------------------------------------------------------------------------------------------
	//! setMaster: GetMasterVolume, SetMasterVolume, GetMasterVolume of one master. The value must lie
	//! between 0 and the larger of 1 and the current volume, so the before value can always be
	//! restored. Runtime only; reversed by setMaster with before.
	static void DoSetMaster(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		int masterId = -1;
		if (!EMCP_WB_AudioUtil.MasterId(req.master, masterId))
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "master must be one of " + EMCP_WB_AudioUtil.MASTER_NAMES + ", got '" + req.master + "'", "pass one of " + EMCP_WB_AudioUtil.MASTER_NAMES);
			return;
		}
		float wanted = 0;
		if (!EMCP_WB_AudioUtil.FloatOf(req.value, "value", wanted, resp))
			return;
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		float current = AudioSystem.GetMasterVolume(masterId);
		float upper = 1;
		if (current > upper)
			upper = current;
		if (wanted < 0 || wanted > upper)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "value must be 0 to " + EMCP_WB_AudioUtil.Text(upper) + ", got " + req.value, "wb_audio masters shows the current volumes");
			return;
		}
		resp.master = req.master;
		resp.before = EMCP_WB_AudioUtil.Text(current);
		if (!AudioSystem.SetMasterVolume(masterId, wanted))
		{
			EMCP_WB_AudioUtil.EngineFalse(resp, "SetMasterVolume returned false for " + req.master + "; nothing changed", "read the volumes with wb_audio masters");
			return;
		}
		resp.after = EMCP_WB_AudioUtil.Text(AudioSystem.GetMasterVolume(masterId));
		resp.status = "ok";
		resp.message = req.master + ": " + resp.before + " -> " + resp.after + " (runtime only, nothing saved)";
	}

	//------------------------------------------------------------------------------------------------
	//! pause: AudioSystem.Pause or Resume of the mask OR-ed from (1 << id) per master named, the form of
	//! the engine's doc comment on Pause. Reversed by pause with resume true.
	static void DoPause(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (!req.masters || req.masters.Count() == 0)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "masters is required", "pass one or more of " + EMCP_WB_AudioUtil.MASTER_NAMES);
			return;
		}
		int mask = 0;
		array<string> named = {};
		foreach (string masterName : req.masters)
		{
			int masterId = -1;
			if (!EMCP_WB_AudioUtil.MasterId(masterName, masterId))
			{
				EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "masters holds '" + masterName + "'; each must be one of " + EMCP_WB_AudioUtil.MASTER_NAMES, "pass master names only");
				return;
			}
			mask = mask | (1 << masterId);
			if (named.Find(masterName) < 0)
				named.Insert(masterName);
		}
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		bool resuming = req.resume;
		if (resuming)
			AudioSystem.Resume(mask);
		else
			AudioSystem.Pause(mask);
		foreach (string done : named)
			resp.masters.Insert(done);
		resp.paused = !resuming;
		resp.status = "ok";
		if (resuming)
			resp.message = "resumed " + named.Count().ToString() + " masters";
		else
			resp.message = "paused " + named.Count().ToString() + " masters; reverse with pause resume true";
	}

	//------------------------------------------------------------------------------------------------
	//! outputStates: GetOutputStateCount; with a resource (.afm), GetOutputStateIdx (-1: no instance);
	//! with a resource and a signal name, GetOutpuStateSignalIdx on that instance. CreateOutputState is
	//! never called, so nothing is instanced here.
	static void DoOutputStates(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.resource == "" && req.name != "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "name (a signal) needs resource (the .afm)", "pass resource with name, or neither");
			return;
		}
		resp.index = -1;
		resp.signalIndex = -1;
		string resourceName = "";
		if (req.resource != "")
		{
			resourceName = EMCP_WB_AudioUtil.ResourceOf(req.resource, EMCP_WB_AudioUtil.MIXER_EXT, resp);
			if (resourceName == "")
				return;
		}
		if (!EMCP_WB_AudioUtil.PlayApi(resp))
			return;
		resp.count = AudioSystem.GetOutputStateCount();
		resp.status = "ok";
		resp.message = resp.count.ToString() + " output-state instances";
		if (resourceName == "")
			return;
		int stateIdx = AudioSystem.GetOutputStateIdx(resourceName);
		resp.index = stateIdx;
		if (stateIdx < 0)
		{
			resp.message = resp.message + "; " + resourceName + " has no instance (index -1)";
			return;
		}
		resp.message = resp.message + "; " + resourceName + " is instance " + stateIdx.ToString();
		if (req.name == "")
			return;
		resp.signalIndex = AudioSystem.GetOutpuStateSignalIdx(stateIdx, req.name);
		resp.message = resp.message + "; signal '" + req.name + "' index " + resp.signalIndex.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! entityEvents: the BaseSoundComponent of an entity in the editor world, its event names
	//! (GetEvents) and signal names (GetSignalNames). Else its SndComponent (the game's SoundComponent
	//! family): the signal names only, since SndComponent has no GetEvents; the events are read
	//! offline (audio events on the component's .acp) and the message says so.
	static void DoEntityEvents(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		WorldEditorAPI api = EMCP_WB_AudioUtil.WorldApi(resp);
		if (!api)
			return;
		IEntity ent = EMCP_WB_AudioUtil.EntityOf(api, req.entity, resp);
		if (!ent)
			return;
		BaseSoundComponent sound = EMCP_WB_AudioUtil.SoundOf(ent);
		if (!sound)
		{
			SndComponent sndEvents = EMCP_WB_AudioUtil.SndOf(ent);
			if (!sndEvents)
			{
				EMCP_WB_AudioUtil.NoSound(resp);
				return;
			}
			resp.component = sndEvents.ClassName();
			array<string> sndSignalNames = {};
			sndEvents.GetSignalNames(sndSignalNames);
			if (sndSignalNames)
			{
				foreach (string sndSignalText : sndSignalNames)
					resp.signals.Insert(sndSignalText);
			}
			resp.count = 0;
			resp.status = "ok";
			resp.message = "warning: " + resp.component + " is an SndComponent, which has no GetEvents: read the events offline (audio events on the component's .acp); " + resp.signals.Count().ToString() + " signals";
			return;
		}
		resp.component = sound.ClassName();
		array<string> eventNames = {};
		sound.GetEvents(eventNames);
		array<string> signalNames = {};
		sound.GetSignalNames(signalNames);
		if (eventNames)
		{
			foreach (string eventText : eventNames)
				resp.events.Insert(eventText);
		}
		if (signalNames)
		{
			foreach (string signalText : signalNames)
				resp.signals.Insert(signalText);
		}
		resp.count = resp.events.Count();
		resp.status = "ok";
		resp.message = resp.component + ": " + resp.count.ToString() + " events, " + resp.signals.Count().ToString() + " signals";
	}

	//------------------------------------------------------------------------------------------------
	//! entityPlay: a named event on the entity's sound component (BaseSoundComponent.PlayStr) after the
	//! name is found among GetEvents (EVENT_NOT_FOUND otherwise); IsPlaying after. Else on its
	//! SndComponent (SndComponent.PlayStr; it has no GetEvents, so the name is not checked first and an
	//! unknown one answers PLAY_FAILED). Reversed by stop.
	static void DoEntityPlay(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.eventName == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "eventName is required", "list the events with wb_audio entityEvents");
			return;
		}
		WorldEditorAPI api = EMCP_WB_AudioUtil.WorldApi(resp);
		if (!api)
			return;
		IEntity ent = EMCP_WB_AudioUtil.EntityOf(api, req.entity, resp);
		if (!ent)
			return;
		BaseSoundComponent sound = EMCP_WB_AudioUtil.SoundOf(ent);
		if (!sound)
		{
			SndComponent sndPlay = EMCP_WB_AudioUtil.SndOf(ent);
			if (!sndPlay)
			{
				EMCP_WB_AudioUtil.NoSound(resp);
				return;
			}
			AudioHandle sndPlayed = sndPlay.PlayStr(req.eventName);
			if (sndPlayed == AudioHandle.Invalid)
			{
				EMCP_WB_AudioUtil.Refuse(resp, "PLAY_FAILED", "SndComponent.PlayStr returned an invalid handle for event '" + req.eventName + "' (no GetEvents to check the name: read the events offline)", "check the event name with audio events on the component's .acp");
				return;
			}
			resp.handle = sndPlayed;
			resp.playing = sndPlay.IsPlaying();
			resp.status = "ok";
			resp.message = "playing event '" + req.eventName + "' on " + resp.entity + " (SndComponent); stop it with wb_audio stop handle " + resp.handle.ToString();
			return;
		}
		array<string> eventNames = {};
		sound.GetEvents(eventNames);
		if (!eventNames || eventNames.Find(req.eventName) < 0)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "EVENT_NOT_FOUND", "the entity's sound component has no event '" + req.eventName + "'", "list the events with wb_audio entityEvents");
			return;
		}
		AudioHandle played = sound.PlayStr(req.eventName);
		if (played == AudioHandle.Invalid)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "PLAY_FAILED", "PlayStr returned an invalid handle for event '" + req.eventName + "'", "check the entity in the World Editor");
			return;
		}
		resp.handle = played;
		resp.playing = sound.IsPlaying();
		resp.status = "ok";
		resp.message = "playing event '" + req.eventName + "' on " + resp.entity + "; stop it with wb_audio stop handle " + resp.handle.ToString();
	}

	//------------------------------------------------------------------------------------------------
	//! setSignal: SignalsManagerComponent.FindSignal, GetSignalValue, SetSignalValue, GetSignalValue.
	//! AddOrFindSignal is never called: an unknown name answers index -1, sets nothing, and says so.
	//! Runtime only; reversed by setSignal with before.
	static void DoSetSignal(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.name == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "name is required", "list the signals with wb_audio entityEvents");
			return;
		}
		float wanted = 0;
		if (!EMCP_WB_AudioUtil.FloatOf(req.value, "value", wanted, resp))
			return;
		WorldEditorAPI api = EMCP_WB_AudioUtil.WorldApi(resp);
		if (!api)
			return;
		IEntity ent = EMCP_WB_AudioUtil.EntityOf(api, req.entity, resp);
		if (!ent)
			return;
		SignalsManagerComponent signalsManager = SignalsManagerComponent.Cast(ent.FindComponent(SignalsManagerComponent));
		if (!signalsManager)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "NO_SIGNALS_MANAGER", "the entity has no SignalsManagerComponent", "pick an entity whose prefab has a SignalsManagerComponent");
			return;
		}
		int signalIdx = signalsManager.FindSignal(req.name);
		resp.index = signalIdx;
		if (signalIdx < 0)
		{
			resp.status = "ok";
			resp.message = "warning: no signal '" + req.name + "' on " + resp.entity + " (index -1); nothing was set (signals are never created here)";
			return;
		}
		resp.before = EMCP_WB_AudioUtil.Text(signalsManager.GetSignalValue(signalIdx));
		signalsManager.SetSignalValue(signalIdx, wanted);
		resp.after = EMCP_WB_AudioUtil.Text(signalsManager.GetSignalValue(signalIdx));
		resp.status = "ok";
		resp.message = req.name + " on " + resp.entity + ": " + resp.before + " -> " + resp.after + " (runtime only, nothing saved)";
	}

	//------------------------------------------------------------------------------------------------
	//! soundMap: the sound-map values at a position (default: the camera) from the world's SoundWorld:
	//! GetMapValuesAtPos (sea, forest, city, meadow) and GetMapValuesAdvAtPos (river, riverSlope, lake,
	//! coast), one row name=value each.
	static void DoSoundMap(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		WorldEditorAPI api = EMCP_WB_AudioUtil.WorldApi(resp);
		if (!api)
			return;
		vector pos = vector.Zero;
		if (!EMCP_WB_AudioUtil.PositionOf(api, req.position, pos, resp))
			return;
		ChimeraWorld chimeraWorld = ChimeraWorld.CastFrom(api.GetWorld());
		if (!chimeraWorld)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "NO_SOUND_WORLD", "the editor world is not a ChimeraWorld (ChimeraWorld.CastFrom returned null)", EMCP_WB_AudioUtil.NEXT_SOUND_WORLD);
			return;
		}
		SoundWorld soundWorld = chimeraWorld.GetSoundWorld();
		if (!soundWorld)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "NO_SOUND_WORLD", "the world has no SoundWorld (GetSoundWorld returned null)", EMCP_WB_AudioUtil.NEXT_SOUND_WORLD);
			return;
		}
		float sea = 0;
		float forest = 0;
		float city = 0;
		float meadow = 0;
		soundWorld.GetMapValuesAtPos(pos, sea, forest, city, meadow);
		float river = 0;
		float riverSlope = 0;
		float lake = 0;
		float coast = 0;
		soundWorld.GetMapValuesAdvAtPos(pos, river, riverSlope, lake, coast);
		resp.position = EMCP_WB_Common.VectorToString(pos);
		resp.values.Insert("sea=" + EMCP_WB_AudioUtil.Text(sea));
		resp.values.Insert("forest=" + EMCP_WB_AudioUtil.Text(forest));
		resp.values.Insert("city=" + EMCP_WB_AudioUtil.Text(city));
		resp.values.Insert("meadow=" + EMCP_WB_AudioUtil.Text(meadow));
		resp.values.Insert("river=" + EMCP_WB_AudioUtil.Text(river));
		resp.values.Insert("riverSlope=" + EMCP_WB_AudioUtil.Text(riverSlope));
		resp.values.Insert("lake=" + EMCP_WB_AudioUtil.Text(lake));
		resp.values.Insert("coast=" + EMCP_WB_AudioUtil.Text(coast));
		resp.status = "ok";
		resp.message = "sound-map values at " + resp.position;
	}

	//------------------------------------------------------------------------------------------------
	//! open: an existing project .acp or .sig (EMCP_WB_Guard.TargetExistsInProject) whose owner is the
	//! Audio Editor (EMCP_WB_OpenResource.OwnerOf; any other type refuses WRONG_MODULE, since a file
	//! opened in a module that does not own it raised a modal: W2 fix-up 2). Dry run unless confirm.
	//! With confirm it refuses GATED until probe P-W5-12 passes (OPEN_PROVEN); then
	//! Workbench.OpenResource of the file's absolute path. Close the tab with wb_module close AudioEditor.
	static void DoOpen(EMCP_WB_AudioRequest req, EMCP_WB_AudioResponse resp)
	{
		if (req.path == "")
		{
			EMCP_WB_AudioUtil.Refuse(resp, "INVALID_ARGUMENT", "path is required", "pass a project-relative .acp or .sig");
			return;
		}
		string clean = "";
		string why = "";
		if (!EMCP_WB_Guard.CleanRelative(req.path, clean, why))
		{
			EMCP_WB_AudioUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "CleanRelative: " + why, "pass a project-relative path");
			return;
		}
		string absolute = "";
		if (!EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why))
		{
			EMCP_WB_AudioUtil.Refuse(resp, EMCP_WB_Guard.NOT_IN_PROJECT, "TargetExistsInProject: " + why, "copy the file into the project first (audio reads vanilla files offline)");
			return;
		}
		string owner = EMCP_WB_OpenResource.OwnerOf(clean);
		resp.path = clean;
		resp.module = owner;
		if (owner != EMCP_WB_AudioUtil.AUDIO_EDITOR)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "WRONG_MODULE", clean + " belongs to " + owner + ", not the Audio Editor; it is never opened here", "open it with wb_module setResource, or pass an .acp or .sig");
			return;
		}
		if (!req.confirm)
		{
			resp.dryRun = true;
			resp.status = "ok";
			resp.message = "dry run: would open " + clean + " in the Audio Editor; nothing was opened; pass confirm true to open";
			if (!EMCP_WB_AudioUtil.OPEN_PROVEN)
				resp.message = resp.message + " (open waits for probe " + EMCP_WB_AudioUtil.OPEN_PROBE + ")";
			return;
		}
		resp.dryRun = false;
		if (!EMCP_WB_AudioUtil.OPEN_PROVEN)
		{
			EMCP_WB_AudioUtil.Refuse(resp, "GATED", "open waits for probe " + EMCP_WB_AudioUtil.OPEN_PROBE + " (Workbench.OpenResource of an audio file with no modal); nothing was opened", "the main session opens it after the probe passes");
			return;
		}
		resp.opened = Workbench.OpenResource(absolute);
		if (!resp.opened)
		{
			EMCP_WB_AudioUtil.EngineFalse(resp, "Workbench.OpenResource returned false for " + clean, "check the Workbench log");
			return;
		}
		resp.status = "ok";
		resp.message = "opened " + clean + " in the Audio Editor; close it with wb_module close AudioEditor";
	}
}
