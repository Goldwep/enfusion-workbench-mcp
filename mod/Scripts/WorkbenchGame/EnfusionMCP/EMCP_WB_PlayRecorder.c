/**
 * EMCP_WB_PlayRecorder.c - Play-mode event recorder of wave W1 (phase5-w1-spec.md section 2.6, OD-7)
 *
 * Not a handler. A World Editor plugin that overrides the WorldEditorPlugin events
 * OnGameModeStarted (worldName, gameMode, playFromCameraPos, cameraPosition, cameraAngles) and
 * OnGameModeEnded, and keeps the last CAPACITY events in a static ring buffer. wb_world playEvents
 * (EMCP_WB_World) reads them after a seq. Each event is one row "seq|tick|event|world|mode|camera"
 * (tick = System.GetTickCount(0); camera = "x y z;pitch yaw roll" when play started from the camera,
 * else empty). OD-7 (DEC-061): the plugin may show in the Plugins menu; it has no Run, no settings
 * and no UI action. Nothing here writes a file.
 */

[WorkbenchPluginAttribute(name: "EMCP Play Recorder", description: "Records play-mode start and end for wb_world playEvents", wbModules: {"WorldEditor"})]
class EMCP_WB_PlayRecorder : WorldEditorPlugin
{
	//! Events kept; the oldest is dropped first.
	static const int CAPACITY = 32;
	static const string EVENT_STARTED = "started";
	static const string EVENT_ENDED = "ended";

	//! The ring buffer: rows in seq order, at most CAPACITY.
	protected static ref array<string> s_Rows;
	//! The seq of each row in s_Rows, same order.
	protected static ref array<int> s_Seqs;
	//! The last seq given out; 0 before the first event.
	protected static int s_LastSeq;
	//! World and game mode of the running play session, for the ended row.
	protected static string s_World;
	protected static string s_Mode;

	//------------------------------------------------------------------------------------------------
	override void OnGameModeStarted(string worldName, string gameMode, bool playFromCameraPos, vector cameraPosition, vector cameraAngles)
	{
		string camera = "";
		if (playFromCameraPos)
			camera = EMCP_WB_Common.VectorToString(cameraPosition) + ";" + EMCP_WB_Common.VectorToString(cameraAngles);
		s_World = EMCP_WB_Guard.ScrubHome(worldName);
		s_Mode = gameMode;
		Record(EVENT_STARTED, s_World, s_Mode, camera);
	}

	//------------------------------------------------------------------------------------------------
	override void OnGameModeEnded()
	{
		Record(EVENT_ENDED, s_World, s_Mode, "");
	}

	//------------------------------------------------------------------------------------------------
	//! Appends one event and drops the oldest past CAPACITY.
	static void Record(string eventName, string world, string gameMode, string camera)
	{
		if (!s_Rows)
			s_Rows = new array<string>();
		if (!s_Seqs)
			s_Seqs = new array<int>();
		s_LastSeq++;
		int tick = System.GetTickCount(0);
		string row = s_LastSeq.ToString() + "|" + tick.ToString() + "|" + eventName + "|" + world + "|" + gameMode + "|" + camera;
		s_Rows.Insert(row);
		s_Seqs.Insert(s_LastSeq);
		while (s_Rows.Count() > CAPACITY)
		{
			s_Rows.RemoveOrdered(0);
			s_Seqs.RemoveOrdered(0);
		}
	}

	//------------------------------------------------------------------------------------------------
	//! The last seq given out; 0 before the first event since the script reload.
	static int LastSeq()
	{
		return s_LastSeq;
	}

	//------------------------------------------------------------------------------------------------
	//! Appends the rows with a seq above afterSeq to outRows, oldest first; answers how many.
	static int After(int afterSeq, notnull array<string> outRows)
	{
		if (!s_Rows || !s_Seqs)
			return 0;
		int added = 0;
		for (int i = 0; i < s_Rows.Count(); i++)
		{
			if (s_Seqs.Get(i) <= afterSeq)
				continue;
			outRows.Insert(s_Rows.Get(i));
			added++;
		}
		return added;
	}
}
