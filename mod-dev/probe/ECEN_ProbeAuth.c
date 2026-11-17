/**
 * ECEN_ProbeAuth.c - authProbe, the file-access action of the read-only probe pack (S-F B2)
 *
 * One call per request from closed lists compared exactly: authMethod (FileExists, OpenFile,
 * FindFiles, SearchResources), authRoot ($EMCP2_sandbox: only; the action never reaches outside the
 * 2.0 sandbox) and authVariant (a, or b for FindFiles only: a second call site of the same call).
 * Anything else fails before any API call. The answer is five facts: method, root, variant,
 * returned (the call's bool) and count (callback calls; 0 for FileExists and OpenFile). Never a
 * file name or a path from the call. Its own file, so a compile failure is attributable (DEC-042).
 * Static only. Read-only in effect:
 *   FileExists       FileIO.FileExists(root + AUTH_OPEN_FILE), the sandbox's own project file
 *   OpenFile         FileIO.OpenFile(root + AUTH_OPEN_FILE, FileMode.READ) only after
 *                    FileIO.FileExists answered true for that file; the handle is closed at once
 *   FindFiles        FileIO.FindFiles(callback, root, ".c"); the callback counts, stores nothing
 *   SearchResources  Workbench.SearchResources(callback, {"conf"}, null, root, true); same.
 *                    The call B2 names; it is [Obsolete] in 1.8.0.13 ("Use
 *                    ResourceDatabase.SearchResources() instead", Workbench.c:25), so a compile
 *                    warning on it is expected, not a failure
 * Never MakeDirectory, DeleteFile, CopyFile, RunCmd, RunProcess, GetUserName, the clipboard,
 * MakeScreenshot or a handle read or write.
 */

class ECEN_ProbeAuth
{
	//! The one root authProbe accepts: the 2.0 sandbox's file system.
	static const string AUTH_ROOT_SANDBOX = "$EMCP2_sandbox:";
	//! The fixed file OpenFile opens under the root: the sandbox's own project file.
	static const string AUTH_OPEN_FILE = "EMCP2_sandbox.gproj";
	//! Callback calls of the running FindFiles or SearchResources; reset before each call.
	protected static int s_iCalls;

	//------------------------------------------------------------------------------------------------
	//! The closed method list.
	static void Methods(notnull array<string> outMethods)
	{
		outMethods.Clear();
		outMethods.Insert("FileExists");
		outMethods.Insert("OpenFile");
		outMethods.Insert("FindFiles");
		outMethods.Insert("SearchResources");
	}

	//------------------------------------------------------------------------------------------------
	//! The closed root list.
	static void Roots(notnull array<string> outRoots)
	{
		outRoots.Clear();
		outRoots.Insert(AUTH_ROOT_SANDBOX);
	}

	//------------------------------------------------------------------------------------------------
	//! FindFilesCallback: counts, stores nothing.
	protected static void CountFile(string fileName, FileAttribute attributes = 0, string filesystem = string.Empty)
	{
		s_iCalls++;
	}

	//------------------------------------------------------------------------------------------------
	//! WorkbenchSearchResourcesCallback: counts, stores nothing.
	protected static void CountResource(ResourceName resName, string filePath = "")
	{
		s_iCalls++;
	}

	//------------------------------------------------------------------------------------------------
	//! authProbe: see the file comment.
	static void AuthProbe(ECEN_ProbeRequest req, ECEN_ProbeResponse resp)
	{
		string method = req.authMethod;
		string root = req.authRoot;
		string variant = req.authVariant;

		array<string> methods = {};
		Methods(methods);
		if (!methods.Contains(method))
		{
			resp.Fail("authProbe refuses authMethod: not FileExists, OpenFile, FindFiles or SearchResources");
			return;
		}
		array<string> roots = {};
		Roots(roots);
		if (!roots.Contains(root))
		{
			resp.Fail("authProbe refuses authRoot: only " + AUTH_ROOT_SANDBOX);
			return;
		}
		if (variant != "a" && variant != "b")
		{
			resp.Fail("authProbe refuses authVariant: a or b");
			return;
		}
		if (variant == "b" && method != "FindFiles")
		{
			resp.Fail("authProbe refuses authVariant b: FindFiles only");
			return;
		}

		bool returned = false;
		int count = 0;
		if (method == "FileExists")
		{
			// The sandbox's own project file, not the bare root: FileExists checks a file, so a
			// false here is not "the root is a directory" (review F-P2).
			returned = FileIO.FileExists(root + AUTH_OPEN_FILE);
		}
		else if (method == "OpenFile")
		{
			string openTarget = root + AUTH_OPEN_FILE;
			if (FileIO.FileExists(openTarget))
			{
				FileHandle handle = FileIO.OpenFile(openTarget, FileMode.READ);
				returned = handle != null;
				if (handle)
					handle.Close();
			}
		}
		else if (method == "FindFiles")
		{
			s_iCalls = 0;
			if (variant == "a")
				returned = FileIO.FindFiles(CountFile, root, ".c");
			else
				returned = FileIO.FindFiles(CountFile, root, ".c");
			count = s_iCalls;
		}
		else if (method == "SearchResources")
		{
			array<string> extensions = {"conf"};
			s_iCalls = 0;
			returned = Workbench.SearchResources(CountResource, extensions, null, root, true);
			count = s_iCalls;
		}

		resp.Fact("method", method);
		resp.Fact("root", root);
		resp.Fact("variant", variant);
		resp.Fact("returned", returned.ToString());
		resp.Fact("count", count.ToString());
		resp.Ok("authProbe " + method + " " + variant + " returned " + returned.ToString());
	}
}
