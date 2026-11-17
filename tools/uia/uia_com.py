"""Real UI Automation provider for tools/uia/walker.py.

Route (plan 8 Phase 2: "Python for the probe, because it is already installed"):
COM IUIAutomation (UIAutomationCore) through `comtypes`, which is installed with
Python 3.13 on the owner's machine, using the wrapper module comtypes already
generated for UIAutomationCore (`comtypes.gen.UIAutomationClient`). The provider
never asks comtypes to generate a wrapper (that would write into
site-packages): when the wrapper is missing, the provider is unavailable.

The wrapper goes missing when Python or comtypes is updated (session 017, DEC-057:
b-001's UIA provider failed until `comtypes.client.GetModule('UIAutomationCore.dll')`
regenerated it). Before a sitting, check it read-only and regenerate only on
purpose, by hand, with the one write named:

  python -B tools/uia/uia_com.py --check-wrapper              read-only; exit 0 ok, 4 missing
  python -B tools/uia/uia_com.py --check-wrapper --regenerate writes comtypes.gen (site-packages)

Both print one JSON document (`wrapper_status`, plus `regenerated` with
--regenerate).
`uiautomation` (also installed) is not used: it wraps the same COM API but also
carries click, key and pattern helpers this walker must not have within reach.

Window facts come from Win32 through ctypes, read-only: EnumWindows,
GetWindowThreadProcessId, and, only for windows of the requested process,
GetClassNameW, GetWindowTextW (which reads another process's caption without
sending it a message), IsWindowVisible, GetWindow(GW_OWNER) and IsHungAppWindow.

Read-only by construction:
  - every element is fetched with a cache request that holds property ids only;
    values are read with GetCachedPropertyValue;
  - pattern support is read from the Is<Pattern>PatternAvailable properties; no
    pattern object is ever retrieved, so no pattern method can run;
  - navigation is a tree walker's first-child and next-sibling calls;
  - the client is created from CUIAutomation8 as IUIAutomation2 and its own
    connection and transaction timeouts are lowered, so that one call cannot
    hang on a busy GUI thread for the default 20 seconds; when they cannot be
    set the provider raises ProviderUnavailable and the walk does not start;
    AutoSetFocus is switched off on this client;
  - this process declares itself per-monitor DPI aware (a setting of this
    process only) so bounding rectangles are physical pixels on both monitors.

Nothing here runs at import time except loading comtypes and declaring ctypes
prototypes. Every claim about what Workbench's Qt provider answers is
[unverified] until session S-C.
"""

import ctypes
import importlib
import json
import sys
from ctypes import wintypes

import comtypes
import comtypes.client

try:
    from comtypes.gen import UIAutomationClient as _UIA
except ImportError as _e:  # wrapper not generated on this machine
    _UIA = None
    _IMPORT_ERROR = _e
else:
    _IMPORT_ERROR = None

# walker field -> UIA property name (UIA_<name>PropertyId in the generated module)
PROPERTY_NAMES = (
    ("controlType", "ControlType"),
    ("name", "Name"),
    ("automationId", "AutomationId"),
    ("className", "ClassName"),
    ("rect", "BoundingRectangle"),
    ("enabled", "IsEnabled"),
    ("offscreen", "IsOffscreen"),
    ("frameworkId", "FrameworkId"),
    ("acceleratorKey", "AcceleratorKey"),
    ("accessKey", "AccessKey"),
    ("helpText", "HelpText"),
    ("legacyShortcut", "LegacyIAccessibleKeyboardShortcut"),
    ("legacyDescription", "LegacyIAccessibleDescription"),
    ("legacyDefaultAction", "LegacyIAccessibleDefaultAction"),
    ("gridRowCount", "GridRowCount"),
    ("gridColumnCount", "GridColumnCount"),
    ("processId", "ProcessId"),
    ("nativeWindowHandle", "NativeWindowHandle"),
)

GW_OWNER = 4
DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4

_user32 = ctypes.WinDLL("user32", use_last_error=True)
_WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
_user32.EnumWindows.argtypes = [_WNDENUMPROC, wintypes.LPARAM]
_user32.EnumWindows.restype = wintypes.BOOL
_user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
_user32.GetWindowThreadProcessId.restype = wintypes.DWORD
_user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
_user32.GetClassNameW.restype = ctypes.c_int
_user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
_user32.GetWindowTextW.restype = ctypes.c_int
_user32.IsWindowVisible.argtypes = [wintypes.HWND]
_user32.IsWindowVisible.restype = wintypes.BOOL
_user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
_user32.GetWindow.restype = wintypes.HWND
_user32.IsHungAppWindow.argtypes = [wintypes.HWND]
_user32.IsHungAppWindow.restype = wintypes.BOOL


class ProviderUnavailable(RuntimeError):
    """The real provider cannot run within its bounds; walker.py exits 4."""

    provider_unavailable = True


def _hwnd_int(h):
    return int(h or 0)


def _value(v):
    """A cached property value as plain data; anything else (the not-supported sentinel) is None."""
    if isinstance(v, (str, bool, int, float)):
        return v
    if isinstance(v, (tuple, list)) and all(isinstance(x, (int, float)) for x in v):
        return list(v)
    return None


class ComUiaProvider:
    name = "uia"

    def __init__(self, pattern_names, view="raw", call_timeout_ms=2000):
        if _UIA is None:
            raise RuntimeError(
                "comtypes has no generated UIAutomationCore wrapper (comtypes.gen.UIAutomationClient): %s"
                % _IMPORT_ERROR
            )
        self.view = view
        self.call_timeout_ms = int(call_timeout_ms)
        self.timeouts_set = False
        self.dpi_aware = None
        self.missing = []
        self._props = []
        for field, uia_name in PROPERTY_NAMES:
            pid = getattr(_UIA, "UIA_%sPropertyId" % uia_name, None)
            if pid is None:
                self.missing.append(uia_name)
            else:
                self._props.append((field, pid))
        self._patterns = []
        # Pattern availability is a property: names only, never the pattern object.
        for pname in pattern_names:
            pid = getattr(_UIA, "UIA_Is%sPatternAvailablePropertyId" % pname, None)
            if pid is None:
                self.missing.append("Is%sPatternAvailable" % pname)
            else:
                self._patterns.append((pname, pid))
        self._types = {}
        for attr in dir(_UIA):
            if attr.startswith("UIA_") and attr.endswith("ControlTypeId"):
                self._types[getattr(_UIA, attr)] = attr[len("UIA_") : -len("ControlTypeId")]
        self._auto = None
        self._cache = None
        self._walker = None

    def info(self):
        return {
            "route": "comtypes IUIAutomation (UIAutomationCore), Win32 via ctypes",
            "comtypes_version": getattr(comtypes, "__version__", None),
            "view": self.view,
            "client_timeouts_set": self.timeouts_set,
            "call_timeout_ms": self.call_timeout_ms,
            "dpi_per_monitor_v2": self.dpi_aware,
            "missing_properties": self.missing,
        }

    # ── Win32 window facts (no UI Automation) ──

    def windows(self, pid):
        hwnds = []

        def collect(hwnd, _lparam):
            hwnds.append(hwnd)
            return True

        _user32.EnumWindows(_WNDENUMPROC(collect), 0)
        out = []
        for h in hwnds:
            owner_pid = wintypes.DWORD(0)
            _user32.GetWindowThreadProcessId(h, ctypes.byref(owner_pid))
            entry = {"hwnd": _hwnd_int(h), "pid": int(owner_pid.value)}
            if entry["pid"] == pid:
                cls = ctypes.create_unicode_buffer(256)
                _user32.GetClassNameW(h, cls, 256)
                title = ctypes.create_unicode_buffer(512)
                _user32.GetWindowTextW(h, title, 512)
                entry.update(
                    {
                        "className": cls.value,
                        "title": title.value,
                        "visible": bool(_user32.IsWindowVisible(h)),
                        "owned": bool(_user32.GetWindow(h, GW_OWNER)),
                        "hung": bool(_user32.IsHungAppWindow(h)),
                    }
                )
            out.append(entry)
        return out

    # ── UI Automation, read-only ──

    def hung(self, hwnd):
        """IsHungAppWindow: sends the window no message."""
        return bool(_user32.IsHungAppWindow(wintypes.HWND(hwnd)))

    def attach(self, window):
        try:
            self.dpi_aware = bool(
                _user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
            )
        except AttributeError:
            self.dpi_aware = None
        # CUIAutomation8 (Windows 8 and later) is the coclass that carries
        # IUIAutomation2 (the generated wrapper declares only IUIAutomation on
        # CUIAutomation). Without the client timeouts one call into a busy GUI
        # waits the default 20 s, so the walk refuses instead of running unbounded.
        try:
            self._auto = comtypes.client.CreateObject(_UIA.CUIAutomation8, interface=_UIA.IUIAutomation2)
            self._auto.ConnectionTimeout = self.call_timeout_ms
            self._auto.TransactionTimeout = self.call_timeout_ms
            # Only matters for pattern methods, which this walker never calls;
            # switched off so no call of this client can move the focus.
            self._auto.AutoSetFocus = False
            self.timeouts_set = (
                int(self._auto.ConnectionTimeout) == self.call_timeout_ms
                and int(self._auto.TransactionTimeout) == self.call_timeout_ms
            )
        except Exception as e:
            self.timeouts_set = False
            raise ProviderUnavailable("the UI Automation client timeouts could not be set (%s)" % type(e).__name__)
        if not self.timeouts_set:
            raise ProviderUnavailable("the UI Automation client timeouts did not take the requested value")
        cache = self._auto.CreateCacheRequest()
        for _field, pid in self._props:
            cache.AddProperty(pid)
        for _name, pid in self._patterns:
            cache.AddProperty(pid)
        if self.view == "raw":
            cache.TreeFilter = self._auto.RawViewCondition
            self._walker = self._auto.RawViewWalker
        else:
            cache.TreeFilter = self._auto.ControlViewCondition
            self._walker = self._auto.ControlViewWalker
        self._cache = cache
        return self._auto.ElementFromHandleBuildCache(window["hwnd"], cache)

    def _cached(self, el, pid):
        return _value(el.GetCachedPropertyValue(pid))

    def identity(self, el):
        props = dict(self._props)
        return {
            "pid": self._cached(el, props["processId"]) if "processId" in props else None,
            "className": self._cached(el, props["className"]) if "className" in props else None,
            "hwnd": self._cached(el, props["nativeWindowHandle"]) if "nativeWindowHandle" in props else None,
        }

    def read(self, el):
        out = {}
        for field, pid in self._props:
            if field in ("processId", "nativeWindowHandle"):
                continue
            out[field] = self._cached(el, pid)
        ct = out.get("controlType")
        out["controlType"] = self._types.get(ct, "ControlType%s" % ct) if isinstance(ct, int) else ""
        out["patterns"] = [name for name, pid in self._patterns if self._cached(el, pid) is True]
        return out

    def first_child(self, el):
        child = self._walker.GetFirstChildElementBuildCache(el, self._cache)
        return child if child else None

    def next_sibling(self, el):
        sib = self._walker.GetNextSiblingElementBuildCache(el, self._cache)
        return sib if sib else None

    def next_sibling_bare(self, el):
        sib = self._walker.GetNextSiblingElement(el)
        return sib if sib else None


# ── The generated wrapper: check, and regenerate on purpose ──────────────────

WRAPPER_MODULE = "comtypes.gen.UIAutomationClient"
WRAPPER_TYPELIB = "UIAutomationCore.dll"
EXIT_WRAPPER_OK = 0
EXIT_WRAPPER_MISSING = 4
EXIT_WRAPPER_USAGE = 2


def wrapper_status(import_module=importlib.import_module):
    """Whether the generated UIAutomationCore wrapper imports, read-only: {ok, module, file, error}."""
    try:
        mod = import_module(WRAPPER_MODULE)
    except Exception as e:  # ImportError, or a stale wrapper that fails to load
        return {"ok": False, "module": WRAPPER_MODULE, "file": None, "error": "%s: %s" % (type(e).__name__, e)}
    return {"ok": True, "module": WRAPPER_MODULE, "file": getattr(mod, "__file__", None), "error": None}


def regenerate_wrapper(get_module=None):
    """The one write: comtypes.client.GetModule('UIAutomationCore.dll') generates the wrapper into
    comtypes.gen (site-packages). Run only from --check-wrapper --regenerate. Returns {ok, error}."""
    if get_module is None:
        get_module = comtypes.client.GetModule
    try:
        get_module(WRAPPER_TYPELIB)
    except Exception as e:
        return {"ok": False, "typelib": WRAPPER_TYPELIB, "error": "%s: %s" % (type(e).__name__, e)}
    importlib.invalidate_caches()
    return {"ok": True, "typelib": WRAPPER_TYPELIB, "error": None}


def main(argv, import_module=importlib.import_module, get_module=None, out=None):
    out = sys.stdout if out is None else out
    args = list(argv)
    if "--check-wrapper" not in args or any(a not in ("--check-wrapper", "--regenerate") for a in args):
        sys.stderr.write("usage: uia_com.py --check-wrapper [--regenerate]\n")
        return EXIT_WRAPPER_USAGE
    doc = {"wrapper_status": wrapper_status(import_module)}
    if "--regenerate" in args and not doc["wrapper_status"]["ok"]:
        doc["regenerated"] = regenerate_wrapper(get_module)
        doc["wrapper_status"] = wrapper_status(import_module)
    out.write(json.dumps(doc) + "\n")
    return EXIT_WRAPPER_OK if doc["wrapper_status"]["ok"] else EXIT_WRAPPER_MISSING


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
