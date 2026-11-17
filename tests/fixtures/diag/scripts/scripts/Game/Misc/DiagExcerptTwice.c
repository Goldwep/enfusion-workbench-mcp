// Test excerpt in the shape of the game's Diag Menu registrations (not a copy of a game file).
class DiagExcerptTwice
{
	void RegisterDiag()
	{
		// Registered twice with the same kind: kept, two registrations.
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_SCRIPTS_MENU, "Scripts", "Physics");
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_SCRIPTS_MENU, "Scripts", "Physics");
		// Registered with two kinds: the catalog answers kind unknown.
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_CHARACTER_MENU, "", "Character UI", "Character");
		DiagMenu.RegisterItem(SCR_DebugMenuID.DEBUGUI_CHARACTER_MENU, "", "Character UI", "Character", "a,b");
	}
}
