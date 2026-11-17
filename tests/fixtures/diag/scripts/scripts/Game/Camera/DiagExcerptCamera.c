// Test excerpt in the shape of the game's Diag Menu registrations (not a copy of a game file).
class DiagExcerptCamera
{
	void RegisterDiag()
	{
		DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_MANUAL_CAMERA, "Manual Camera", "");
		DiagMenu.RegisterBool(SCR_DebugMenuID.DEBUGUI_MANUAL_CAMERA_DEBUG, "lshift+lalt+d", "Show debug; menu", "Manual Camera", false);
		DiagMenu.RegisterRange(SCR_DebugMenuID.DEBUGUI_CHARACTER_ADS_CAMERA, "", "ADS Camera", "Character", "0, 3, 0, 1");
		DiagMenu.RegisterItem(SCR_DebugMenuID.DEBUGUI_VEHICLES_COLLISIONS, "", "Collisions", "Vehicles", "disabled,base,all");
		DiagMenu.RegisterBool(DiagMenus.MY_DIAG_BOOL, "", "Not a script id", "Systems");
		/* DiagMenu.RegisterMenu(SCR_DebugMenuID.DEBUGUI_SINGLEPLAYER, "Block comment", ""); */
	}
}
