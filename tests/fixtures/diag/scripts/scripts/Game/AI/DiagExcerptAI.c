// Test excerpt in the shape of the game's Diag Menu registrations (not a copy of a game file).
class DiagExcerptAI
{
	void RegisterDiag(string categories)
	{
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_AI_SCRIPT, "AIScript", "AI");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_AI_PRINT_DEBUG,"","Print debug","AIScript");
		DiagMenu.RegisterItem(
			SCR_DebugMenuID.DEBUGUI_AI_DEBUG_CATEGORY,
			"",
			"Debug category",
			"AIScript",
			categories);
		// DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_SINGLEPLAYER, "", "Commented out", "AI");
		Print("DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_SINGLEPLAYER, \"\", \"In a string\", \"AI\")");
	}
}
