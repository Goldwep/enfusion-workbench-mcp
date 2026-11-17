// Test excerpt in the shape of the game's Diag Menu registrations (not a copy of a game file).
#ifdef ENABLE_DIAG
class DiagExcerptAutotest
{
	void RegisterDiag()
	{
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_AUTOTEST_PROGRESS, "", "Autotest status", "GameCode", true);
	}
}
#endif
