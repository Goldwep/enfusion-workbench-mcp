"""Active menu tool for session S-F (blocker B4; owner ruling Q4 of the S-F design).

Separate from the passive walker (tools/uia/walker.py) so the walker's
no-mutation scan stays true. This tool may do exactly two things to the
Workbench: ExpandCollapse Expand and ExpandCollapse Collapse, on allow-listed
top-level menu titles of ONE window (and at most one sub-menu level under
each, also by name). Everything else is a read.

Rules, each enforced here:

  - the window is chosen like the walker chooses it: pid AND Win32 class AND a
    title pattern together (walker.select_window), never the foreground window,
    never an owned window; the attached element must carry that pid and hwnd;
  - the Workbench must NOT be the foreground window: checked before the first
    pattern call and before and after every Expand; when any window of the pid
    is in front, the tool stops (collapsing what it opened) and says so. It
    never sets focus, and the real provider's client has AutoSetFocus off;
  - a pattern call is made only on an element whose control type is MenuItem,
    whose parent is a MenuBar (top level) or the expanded allow-listed MenuItem
    (one sub-menu level), whose name is on the allow-list given on the command
    line, and which reports the ExpandCollapse pattern available. Any other
    element is refused before a pattern is fetched;
  - never Invoke, Toggle, selection, value setting, focus, a key, the mouse, a
    posted or sent window message, or a right-click: context menus come from the
    owner's own right-click, read by the passive walker (owner ruling);
  - after each Collapse the state is read back; a popup still open is read once more
    after LATE_RECHECK_S (nothing sent) and recorded `closedLate: true` when it closed
    by itself; still open then is a stop, and the handoff text asks the owner to press Esc;
  - a new top-level window of the pid that is not a popup (owned, or of the Qt popup class) after an
    Expand is a stop: something other than a menu opened;
  - a provider error raised by an Expand (a COMError from the pattern call: session 017 stopped
    b-075 and six Plugins sub-menus on one, and the traceback left them open) is caught: the item
    is collapsed, reported `failed` with the error (and listed in `failedItems`), and the walk
    goes on. A Collapse that cannot be confirmed after it is a stop with the Esc handoff;
  - every string is redacted (walker.Redactor) before it is printed; ONE JSON
    document goes to stdout; nothing is written to disk (tools/uia/menus.ts
    applies the harness placeholders again and writes the artifact).

Dry run is the default: without --really the tool selects nothing and prints
the plan (which titles, which sub-menus, which calls) and exits 0. With
--really the `fake` provider (a JSON description, for tests) runs; the `uia`
provider (comtypes IUIAutomation) additionally needs win32 and
ENFUSION_UIA_MENU_PLAN_VERDICT=PASS, which tools/uia/menus.ts sets only after
its `uia-menu` action plan passed the dry-run checker.

Usage (normally through tools/uia/menus.ts):
  python -B tools/uia/menus.py --provider fake|uia [--fake-tree <menus.json>] --pid <n>
      --class <window class> --title <regex> --menus "<t1>,<t2>" [--allowed "<t1>,..."] [--depth 0|1]
      [--allow-foreground] [--settle-ms 400] [--max-items 200] [--dry-run] [--really]

`--menus` must be a subset of the allow-list: `--allowed "<t1>,<t2>"` (the plan's
titles for the module, `live_lane.uia_menu.titles_by_module`, passed by tools/uia/menus.ts
--module) or, without it, MAIN_MENU_TITLES (the Resource Manager's menu bar as S-C's walk
read it; the S-F scripts). The title-bar System menu is never addressed, whatever the list. `--depth 1`
also expands, reads and collapses each sub-menu item of an allow-listed title.
Items are read inside the popup: Qt exposes an expanded title's items under one unnamed
`Menu` child (the QMenu popup; sf-13 read only that node), so the reader descends into every
`Menu` child and reads its MenuItems and Separators (popup_children, read_items).
A window of the pid titled "Script Authorization Required" makes the tool
refuse to start. `--allow-foreground` (sf-13 only, after the owner fronted the
Workbench by hand) lifts the foreground refusal; it never brings a window up.

The document's `result` is ok | refused | refused-foreground |
refused-auth-window | stopped; per title `opened`, `tree`, `collapsed`; at the
top `leftOpen` lists every path this run expanded and did not see collapsed.

Exit codes: 0 done (or dry run), 2 usage error, 3 refused (target, element,
foreground, authorization window), 4 provider unavailable, 5 real run refused,
6 stopped mid-run (a popup left open, a new non-popup window): the document
says why and what the owner should do.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from walker import TargetError, _redact_report, _redact_window, redactor_from_env, select_window  # noqa: E402

SCHEMA = "emcp-uia-menus/1"
PLAN_VERDICT_ENV = "ENFUSION_UIA_MENU_PLAN_VERDICT"

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_REFUSED = 3
EXIT_PROVIDER = 4
EXIT_REAL_RUN_REFUSED = 5
EXIT_STOPPED = 6

# UIA ExpandCollapseState values.
COLLAPSED, EXPANDED, PARTIAL, LEAF = 0, 1, 2, 3
# One more read of a popup still expanded after Collapse, this long after (seconds; <= 2 s).
LATE_RECHECK_S = 1.5

STATE_NAMES = {COLLAPSED: "collapsed", EXPANDED: "expanded", PARTIAL: "partial", LEAF: "leaf"}

MENU_CONTAINER_TYPES = frozenset({"MenuBar", "Menu"})
# The main window's top-level menu titles, read by S-C's walk (u7-walk.json, 2026-10-07).
MAIN_MENU_TITLES = ("File", "Editors", "View", "Edit", "Window", "Utilities", "Plugins", "Help")
SYSTEM_MENU_NAME = "System"
AUTH_WINDOW_TITLE = "Script Authorization Required"
# Qt menu popups are UNOWNED top-level windows of this class family: the S-F --list-windows
# record uia-walk-windows-uia-2026-10-09T03-06-17-508Z.json shows
# Qt683QWindowPopupDropShadowSaveBits windows with owned False.
POPUP_CLASS_MARK = "QWindowPopup"
# A Qt popup comes with a Windows drop-shadow helper: class SysShadow, unowned, untitled, same pid
# (uia-walk-windows-uia-2026-10-09T04-22-35-604Z.json and ...T04-25-28-372Z.json). It is part of
# the popup, not a new window.
POPUP_SHADOW_CLASS = "SysShadow"
# A QMenu-class window (no record yet; listed so a Qt build that names its popups after the widget
# class is still read as a popup).
QMENU_CLASS_MARK = "QMenu"
# The Qt application display name: Qt top-level popups of the Workbench carry it as their title
# (S-F file-menu fake slice; P3-3 records of Qt683QWindowToolSaveBits windows, session 013).
APP_TITLE = "Arma Reforger Workbench"


def is_popup(w, main_hwnd=None, main_title=None, labels=()):
    """A menu popup of the run (review P4 F18): all four must hold.

    1. unowned, or owned by the main window (`ownerHwnd`; an owned window whose owner is not
       known is not a popup);
    2. of a popup class: the Qt popup class family, a QMenu class, or the SysShadow helper;
    3. not disabled;
    4. untitled, or titled like a menu: the Qt application name (APP_TITLE), the main window's
       title, or a label on the expanded path. A SysShadow helper must be untitled.
    Any other window, e.g. an owned titled Qt683QWindowIcon or a #32770, is a new window: a Stop.
    """
    cls = w.get("className") or ""
    title = w.get("title") or ""
    if bool(w.get("owned")):
        if main_hwnd is None or w.get("ownerHwnd") != main_hwnd:
            return False
    if w.get("enabled") is False:
        return False
    if cls == POPUP_SHADOW_CLASS:
        return not title
    if POPUP_CLASS_MARK not in cls and QMENU_CLASS_MARK not in cls:
        return False
    return not title or title in (APP_TITLE, main_title or APP_TITLE) or title in tuple(labels)


MENU_ITEM_TYPE = "MenuItem"
MAX_SEARCH_DEPTH = 6

ESC_HANDOFF = "a menu popup may still be open: the owner presses Esc once, by hand, then says done"
FOREGROUND_HANDOFF = (
    "a window of the Workbench is in front; this tool never works with the Workbench in front: "
    "the owner brings another window to the front, by hand, then runs it again"
)


class ElementRefused(Exception):
    """An element failed the menu-only check; no pattern was fetched for it."""


class Stop(Exception):
    """A stop condition during the run; `handoff` says what the owner does."""

    def __init__(self, reason, handoff, new_windows=None):
        super().__init__(reason)
        self.reason = reason
        self.handoff = handoff
        self.new_windows = new_windows


# ── Fake provider (tests) ────────────────────────────────────────────────────


class FakeProviderError(Exception):
    """What the fake raises for "expandRaises" / "collapseRaises": stands for comtypes' COMError."""


class FakeMenuProvider:
    """A JSON description: {foreground, windows:[{hwnd,pid,className,title,owned,tree}]}.

    Tree nodes: {controlType, name, patterns, state, children, popup}. `popup` is a
    window dict that appears among the pid's windows while the node is expanded.
    Flags for tests: node "stuck": true (Collapse leaves it expanded), node "closesLate":
    true (the first read after Collapse still says expanded, the next says collapsed), node
    "opensWindow": {...} (a window appears on Expand; owned or not, as given), node
    "expandRaises": "<text>" (Expand raises FakeProviderError after it is recorded, the way a
    COMError leaves the pattern call; the node is left half-open), node "collapseRaises": true
    (Collapse raises too, state unchanged), top-level "foregroundAfterExpand": hwnd. Every
    pattern call is recorded in `calls`.
    """

    name = "fake"

    def __init__(self, doc):
        self.doc = doc
        self.foreground = doc.get("foreground", 0)
        self.extra = []
        self.calls = []
        self._parents = {}

    def info(self):
        return {"route": "fake"}

    def windows(self, pid):
        return [dict(w) for w in self.doc.get("windows", [])] + [dict(w) for w in self.extra]

    def foreground_hwnd(self):
        return self.foreground

    def attach(self, window):
        for w in self.doc.get("windows", []):
            if w.get("hwnd") == window.get("hwnd"):
                root = w["tree"]
                root.setdefault("_id", {"pid": w.get("pid"), "hwnd": w.get("hwnd")})
                return root
        raise TargetError("fake: no tree for that window")

    def identity(self, root):
        return dict(root.get("_id", {}))

    def children(self, el):
        return list(el.get("children", []))

    def read(self, el):
        return {
            "controlType": el.get("controlType", ""),
            "name": el.get("name", ""),
            "className": el.get("className"),
            "automationId": el.get("automationId"),
            "enabled": el.get("enabled", True),
            "checked": el.get("checked"),
            "acceleratorKey": el.get("acceleratorKey"),
            "accessKey": el.get("accessKey"),
            "patterns": list(el.get("patterns", [])),
            "state": self._state(el),
        }

    def _state(self, el):
        late = el.get("_lateReads")
        if late is not None:
            if late > 0:
                el["_lateReads"] = late - 1
                return EXPANDED
            del el["_lateReads"]
            el["state"] = COLLAPSED
            if el.get("popup") in self.extra:
                self.extra.remove(el["popup"])
        return el.get("state", LEAF if not el.get("children") else COLLAPSED)

    def expand(self, el):
        self.calls.append(("Expand", el.get("name")))
        if el.get("expandRaises"):
            el["state"] = EXPANDED
            raise FakeProviderError(el["expandRaises"])
        el["state"] = EXPANDED
        if el.get("popup"):
            self.extra.append(el["popup"])
        if el.get("opensWindow"):
            self.extra.append(el["opensWindow"])
        if el.get("disablesMain"):
            for w in self.doc.get("windows", []):
                if w.get("hwnd") == el["disablesMain"]:
                    w["enabled"] = False
        if self.doc.get("foregroundAfterExpand"):
            self.foreground = self.doc["foregroundAfterExpand"]

    def collapse(self, el):
        self.calls.append(("Collapse", el.get("name")))
        if el.get("collapseRaises"):
            raise FakeProviderError("collapse failed")
        if el.get("stuck"):
            return
        if el.get("closesLate"):
            el["_lateReads"] = 1
            return
        el["state"] = COLLAPSED
        if el.get("popup") in self.extra:
            self.extra.remove(el["popup"])


# ── Real provider ────────────────────────────────────────────────────────────


class ComMenuProvider:
    """comtypes IUIAutomation2; reads with GetCurrentPropertyValue, one pattern only."""

    name = "uia"

    def __init__(self, call_timeout_ms=2000):
        import ctypes
        from ctypes import wintypes

        import comtypes.client
        from comtypes.gen import UIAutomationClient as uia  # never generated here

        from uia_com import ComUiaProvider

        self._ct = ctypes
        self._uia = uia
        self._client = comtypes.client
        self._win = ComUiaProvider((), call_timeout_ms=call_timeout_ms)
        self._user32 = ctypes.WinDLL("user32", use_last_error=True)
        self._user32.GetForegroundWindow.restype = wintypes.HWND
        self._user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
        self._user32.GetWindow.restype = wintypes.HWND
        self.call_timeout_ms = int(call_timeout_ms)
        self._auto = None
        self._walker = None
        self._types = {}
        for attr in dir(uia):
            if attr.startswith("UIA_") and attr.endswith("ControlTypeId"):
                self._types[getattr(uia, attr)] = attr[len("UIA_") : -len("ControlTypeId")]

    def info(self):
        return {"route": "comtypes IUIAutomation2, ExpandCollapse only", "call_timeout_ms": self.call_timeout_ms}

    def windows(self, pid):
        out = self._win.windows(pid)
        for w in out:
            if w.get("pid") == pid:
                # IsWindowEnabled: a read; a disabled main window means a modal window opened.
                w["enabled"] = bool(self._user32.IsWindowEnabled(w["hwnd"]))
                # GetWindow(GW_OWNER): a read; is_popup accepts an owned popup of the main window only.
                w["ownerHwnd"] = int(self._user32.GetWindow(w["hwnd"], 4) or 0) if w.get("owned") else 0
        return out

    def foreground_hwnd(self):
        """GetForegroundWindow: a read; this tool never changes the foreground."""
        return int(self._user32.GetForegroundWindow() or 0)

    def attach(self, window):
        uia = self._uia
        try:
            self._auto = self._client.CreateObject(uia.CUIAutomation8, interface=uia.IUIAutomation2)
            self._auto.ConnectionTimeout = self.call_timeout_ms
            self._auto.TransactionTimeout = self.call_timeout_ms
            self._auto.AutoSetFocus = False
        except Exception as e:
            err = RuntimeError("the UI Automation client could not be set up (%s)" % type(e).__name__)
            err.provider_unavailable = True
            raise err
        if self._auto.AutoSetFocus:
            err = RuntimeError("AutoSetFocus could not be switched off")
            err.provider_unavailable = True
            raise err
        self._walker = self._auto.ControlViewWalker
        return self._auto.ElementFromHandle(window["hwnd"])

    def _prop(self, el, name):
        v = el.GetCurrentPropertyValue(getattr(self._uia, "UIA_%sPropertyId" % name))
        return v if isinstance(v, (str, bool, int)) else None

    def identity(self, root):
        return {"pid": self._prop(root, "ProcessId"), "hwnd": self._prop(root, "NativeWindowHandle")}

    def children(self, el):
        out = []
        c = self._walker.GetFirstChildElement(el)
        while c:
            out.append(c)
            c = self._walker.GetNextSiblingElement(c)
        return out

    def read(self, el):
        ct = self._prop(el, "ControlType")
        avail = self._prop(el, "IsExpandCollapsePatternAvailable") is True
        state = self._prop(el, "ExpandCollapseExpandCollapseState") if avail else None
        return {
            "controlType": self._types.get(ct, "ControlType%s" % ct) if isinstance(ct, int) else "",
            "name": self._prop(el, "Name") or "",
            "className": self._prop(el, "ClassName"),
            "automationId": self._prop(el, "AutomationId"),
            "enabled": self._prop(el, "IsEnabled"),
            "checked": self._checked(el),
            "acceleratorKey": self._prop(el, "AcceleratorKey"),
            "accessKey": self._prop(el, "AccessKey"),
            "patterns": ["ExpandCollapse"] if avail else [],
            "state": state,
        }

    def _checked(self, el):
        """Property reads only: the toggle state when that pattern is offered, else the
        LegacyIAccessible STATE_SYSTEM_CHECKED bit (0x10); None when neither says."""
        if self._prop(el, "IsTogglePatternAvailable") is True:
            v = self._prop(el, "ToggleToggleState")
            if isinstance(v, int) and not isinstance(v, bool):
                return v == 1
        v = self._prop(el, "LegacyIAccessibleState")
        if isinstance(v, int) and not isinstance(v, bool):
            return bool(v & 0x10)
        return None

    def _expand_collapse(self, el):
        uia = self._uia
        p = el.GetCurrentPatternAs(uia.UIA_ExpandCollapsePatternId, uia.IUIAutomationExpandCollapsePattern._iid_)
        return self._ct.cast(p, self._ct.POINTER(uia.IUIAutomationExpandCollapsePattern))

    def expand(self, el):
        self._expand_collapse(el).Expand()

    def collapse(self, el):
        self._expand_collapse(el).Collapse()


# ── The run ──────────────────────────────────────────────────────────────────


def parse_allowed(value):
    """The allow-list of titles (`--allowed`), or MAIN_MENU_TITLES when none is given."""
    if value is None:
        return tuple(MAIN_MENU_TITLES)
    titles = tuple(t.strip() for t in value.split(",") if t.strip())
    if not titles:
        raise ValueError("--allowed names no title")
    if SYSTEM_MENU_NAME in titles:
        raise ValueError("--allowed may not name the %s menu" % SYSTEM_MENU_NAME)
    return titles


def parse_menus(value, allowed=MAIN_MENU_TITLES):
    titles = [t.strip() for t in (value or "").split(",") if t.strip()]
    if not titles:
        raise ValueError("--menus needs at least one title")
    bad = [t for t in titles if t not in allowed]
    if bad:
        raise ValueError("--menus %s not among the allowed titles %s" % (bad, list(allowed)))
    if len(set(titles)) != len(titles):
        raise ValueError("--menus names a title twice")
    return titles


def build_plan(pid, class_name, title_pattern, menus, depth):
    """The calls a real run would make (the dry-run output and menus.ts's plan)."""
    steps = []
    for m in menus:
        steps.append({"call": "Expand", "path": [m]})
        if depth >= 1:
            steps.append({"call": "Expand, then Collapse", "path": [m, "<each sub-menu item>"]})
        steps.append({"call": "Collapse", "path": [m]})
    return {
        "target": {"pid": pid, "className": class_name, "titlePattern": title_pattern},
        "depth": depth,
        "steps": steps,
        "never": ["invoke", "toggle", "selection", "value", "focus", "key", "mouse", "window message", "right-click"],
    }


def check_menu_item(info, name, parent_type):
    """Refuse anything but a MenuItem with ExpandCollapse under a menu bar or menu item."""
    if info.get("controlType") != MENU_ITEM_TYPE:
        raise ElementRefused("%r is a %s, not a MenuItem" % (name, info.get("controlType") or "?"))
    if parent_type not in MENU_CONTAINER_TYPES and parent_type != MENU_ITEM_TYPE:
        raise ElementRefused("%r is not under a menu bar or menu (parent %s)" % (name, parent_type))
    if "ExpandCollapse" not in (info.get("patterns") or []):
        raise ElementRefused("%r does not offer ExpandCollapse" % name)


def find_menu_bar(provider, root):
    """Bounded breadth-first search: exactly one MenuBar that is not the title-bar System menu."""
    found = []
    level = [(root, 0)]
    while level:
        nxt = []
        for el, d in level:
            for c in provider.children(el):
                info = provider.read(c)
                if info.get("controlType") == "MenuBar":
                    names = [provider.read(x).get("name") for x in provider.children(c)]
                    if names != [SYSTEM_MENU_NAME]:
                        found.append(c)
                elif d + 1 < MAX_SEARCH_DEPTH:
                    nxt.append((c, d + 1))
        level = nxt
    if len(found) != 1:
        raise ElementRefused("%d application menu bars under the window; refusing to choose" % len(found))
    return found[0]


POPUP_TYPE = "Menu"


def popup_children(provider, el, max_items):
    """The item elements of an expanded item. Qt puts them under an unnamed `Menu` child (the
    QMenu popup; sf-13 stopped there), so each `Menu` child is descended into, one level; a child
    that is not a `Menu` is an item itself (the S-F fake trees). Returns (elements, popups,
    truncated): popups is the read of each `Menu` node descended into. Reads only."""
    elements, popups = [], []
    for c in provider.children(el):
        info = provider.read(c)
        if info.get("controlType") == POPUP_TYPE:
            popups.append(info)
            elements.extend(provider.children(c))
        else:
            elements.append(c)
    return elements[:max_items], popups, len(elements) > max_items


def popup_record(popups, redact, truncated):
    """What the document says about the popup node(s) descended into."""
    return {
        "count": len(popups),
        "automationIds": [redact(p.get("automationId") or "") for p in popups],
        "classNames": [redact(p.get("className") or "") for p in popups],
        "truncated": truncated,
    }


def read_items(provider, el, redact, max_items, elements=None):
    """The items of an expanded item, read only (inside its `Menu` popup child)."""
    if elements is None:
        elements = popup_children(provider, el, max_items)[0]
    items = []
    for c in elements:
        i = provider.read(c)
        items.append(
            {
                "controlType": i.get("controlType"),
                "name": redact(i.get("name") or ""),
                "className": redact(i.get("className") or "") or None,
                "automationId": redact(i.get("automationId") or "") or None,
                "enabled": i.get("enabled"),
                "checked": i.get("checked"),
                "acceleratorKey": redact(i.get("acceleratorKey") or "") or None,
                "accessKey": redact(i.get("accessKey") or "") or None,
                "submenu": "ExpandCollapse" in (i.get("patterns") or []) and i.get("state") not in (LEAF, None),
            }
        )
    return items


class MenuRun:
    def __init__(self, provider, pid, redact, settle_ms, max_items, allow_foreground=False, sleep=time.sleep):
        self.main_hwnd = None
        self.p = provider
        self.pid = pid
        self.redact = redact
        self.settle = settle_ms / 1000.0
        self.max_items = max_items
        self.allow_foreground = allow_foreground
        self.sleep = sleep
        self.open = []  # (element, path) expanded by this run and not yet seen collapsed
        self.closed_late = []  # paths that read collapsed only on the late re-check
        self.calls = []

    def foreground_is_mine(self):
        fg = self.p.foreground_hwnd()
        return fg in {w.get("hwnd") for w in self.p.windows(self.pid) if w.get("pid") == self.pid}

    def assert_background(self, when):
        if not self.allow_foreground and self.foreground_is_mine():
            raise Stop("a window of pid %d is the foreground window (%s)" % (self.pid, when), FOREGROUND_HANDOFF)

    def non_popup_windows(self, path=()):
        windows = [w for w in self.p.windows(self.pid) if w.get("pid") == self.pid]
        main_title = next((w.get("title") for w in windows if w.get("hwnd") == self.main_hwnd), None)
        return {
            w.get("hwnd"): w
            for w in windows
            if w.get("hwnd") != self.main_hwnd
            and not is_popup(w, self.main_hwnd, main_title, path)
            and w.get("visible", True)
        }

    def expand(self, el, path):
        self.assert_background("before Expand of %s" % " > ".join(path))
        before = self.non_popup_windows(path)
        self.calls.append({"call": "Expand", "path": path})
        self.p.expand(el)
        self.open.append((el, path))
        self.sleep(self.settle)
        after = self.non_popup_windows(path)
        new = [after[h] for h in after if h not in before]
        if new:
            described = [
                {"className": w.get("className") or "", "title": self.redact(w.get("title") or ""), "owned": bool(w.get("owned"))}
                for w in new
            ]
            raise Stop(
                "a new window that is not a popup appeared after Expand of %s: %s"
                % (
                    " > ".join(path),
                    "; ".join("className=%r title=%r owned=%s" % (d["className"], d["title"], d["owned"]) for d in described),
                ),
                "the owner looks at the new window and closes it by hand (Esc or Cancel), never a choice",
                described,
            )
        if self.main_hwnd is not None:
            main = [w for w in self.p.windows(self.pid) if w.get("hwnd") == self.main_hwnd]
            if main and main[0].get("enabled") is False:
                raise Stop(
                    "the main window is disabled after Expand of %s (a modal window opened)" % " > ".join(path),
                    "the owner looks at the modal window and closes it by hand (Esc or Cancel), never a choice",
                )
        # The Expand must not have fronted the Workbench: stop before any read or Collapse.
        self.assert_background("after Expand of %s" % " > ".join(path))
        return self.p.read(el).get("state") in (EXPANDED, PARTIAL)

    def collapse(self, el, path):
        """True when the popup reads collapsed. A popup still expanded after the settle is read once
        more after LATE_RECHECK_S, sending nothing (P4-1 2026-10-12: Plugins > Building Destruction
        read open after Collapse and was gone seconds later); `closed_late` then names the path."""
        self.calls.append({"call": "Collapse", "path": path})
        self.p.collapse(el)
        self.sleep(self.settle)
        if self.p.read(el).get("state") not in (COLLAPSED, LEAF):
            self.sleep(LATE_RECHECK_S)
            if self.p.read(el).get("state") not in (COLLAPSED, LEAF):
                return False
            self.closed_late.append(list(path))
        self.open = [(e, q) for e, q in self.open if e is not el]
        return True

    def try_expand(self, el, path):
        """`expand`, with a provider error from the pattern call (COMError) caught: the item is
        collapsed and the walk goes on. Returns (opened, error text or None). A Stop or a refusal
        passes through unchanged. When the Collapse after the error raises too, or the item still
        reads open after it, the run stops with the Esc handoff (the item stays in leftOpen)."""
        try:
            return self.expand(el, path), None
        except (Stop, ElementRefused):
            raise
        except Exception as e:
            err = "%s: %s" % (type(e).__name__, e)
        # The pattern call may have opened the popup before it failed: Collapse it, and keep it
        # in `open` until the Collapse is confirmed so a stop below still lists or unwinds it.
        if not any(x is el for x, _q in self.open):
            self.open.append((el, path))
        try:
            closed = self.collapse(el, path)
        except Exception as e2:
            if self.p.read(el).get("state") in (COLLAPSED, LEAF):
                self.open = [(x, q) for x, q in self.open if x is not el]
                return False, err
            raise Stop(
                "%s: Expand failed (%s) and the Collapse after it failed too (%s: %s)"
                % (" > ".join(path), err, type(e2).__name__, e2),
                ESC_HANDOFF,
            )
        if not closed:
            raise Stop("%s is still open after the Collapse that followed a failed Expand (%s)" % (" > ".join(path), err), ESC_HANDOFF)
        return False, err

    def unwind(self):
        """After a stop: Collapse what this run opened, innermost first; never anything else."""
        for el, path in reversed(list(self.open)):
            try:
                self.collapse(el, path)
            except Exception:  # left in leftOpen, not retried
                pass

    def left_open(self):
        return [[self.redact(x) for x in path] for _el, path in self.open]


def _finish(doc, run, provider, redact, result, code):
    doc["result"] = result
    if run is not None:
        doc["leftOpen"] = run.left_open()
        if doc["leftOpen"]:
            doc["handoff"] = ESC_HANDOFF
            if code == EXIT_OK:
                doc["result"], code = "stopped", EXIT_STOPPED
        doc["calls"] = [{"call": c["call"], "path": [redact(x) for x in c["path"]]} for c in run.calls]
    doc["provider_info"] = provider.info()
    doc["redaction"] = redact.report()
    return code, doc


def run_menus(
    provider,
    pid,
    class_name,
    title_pattern,
    menus,
    redact,
    depth=0,
    allow_foreground=False,
    settle_ms=400,
    max_items=200,
    sleep=time.sleep,
    allowed=MAIN_MENU_TITLES,
):
    doc = {"schema": SCHEMA, "provider": provider.name, "depth": depth, "menus": [], "leftOpen": []}
    for t in menus:
        if t not in allowed or t == SYSTEM_MENU_NAME:
            doc["reason"] = "%r is not an allow-listed main-window title" % t
            return _finish(doc, None, provider, redact, "refused", EXIT_REFUSED)
    windows = provider.windows(pid)
    if any(w.get("pid") == pid and (w.get("title") or "") == AUTH_WINDOW_TITLE for w in windows):
        doc["reason"] = "a %r window of the pid is open; nothing is touched while it is" % AUTH_WINDOW_TITLE
        return _finish(doc, None, provider, redact, "refused-auth-window", EXIT_REFUSED)
    window, report = select_window(windows, pid, class_name, title_pattern, allow_owned=False)
    if window is None:
        doc["reason"] = redact(report["reason"])
        doc["target"] = {"selection": _redact_report(report, redact)}
        return _finish(doc, None, provider, redact, "refused", EXIT_REFUSED)
    run = MenuRun(provider, pid, redact, settle_ms, max_items, allow_foreground, sleep)
    run.main_hwnd = window.get("hwnd")
    if not allow_foreground and run.foreground_is_mine():
        doc["reason"] = "a window of pid %d is the foreground window" % pid
        doc["handoff"] = FOREGROUND_HANDOFF
        return _finish(doc, None, provider, redact, "refused-foreground", EXIT_REFUSED)
    try:
        root = provider.attach(window)
        ident = provider.identity(root)
    except Exception as e:
        unavailable = bool(getattr(e, "provider_unavailable", False))
        doc["reason"] = redact("%s: %s" % ("provider unavailable" if unavailable else "attach failed", e))
        return _finish(doc, None, provider, redact, "refused", EXIT_PROVIDER if unavailable else EXIT_REFUSED)
    if ident.get("pid") != pid or ident.get("hwnd") != window.get("hwnd"):
        doc["reason"] = "the attached element is not the chosen window"
        return _finish(doc, None, provider, redact, "refused", EXIT_REFUSED)
    doc["target"] = {
        "pid": pid,
        "hwnd": window.get("hwnd"),
        "className": redact(class_name),
        "title": redact(window.get("title") or ""),
    }
    try:
        bar = find_menu_bar(provider, root)
        top = {}
        for c in provider.children(bar):
            info = provider.read(c)
            top.setdefault(info.get("name") or "", (c, info))
        doc["menu_bar_titles"] = [redact(n) for n in top]
        for title in menus:
            entry = {"title": redact(title), "opened": False, "collapsed": None, "items": []}
            doc["menus"].append(entry)
            if title not in top:
                entry["skipped"] = "no top-level item with this exact name"
                continue
            el, info = top[title]
            check_menu_item(info, title, "MenuBar")
            entry["opened"], err = run.try_expand(el, [title])
            if err is not None:
                entry["failed"] = redact(err)
                entry["collapsed"] = True
                doc.setdefault("failedItems", []).append([redact(title)])
                continue
            elements, popups, truncated = popup_children(provider, el, max_items)
            entry["popup"] = popup_record(popups, redact, truncated)
            entry["items"] = read_items(provider, el, redact, max_items, elements)
            if depth >= 1:
                for child, item in zip(elements, entry["items"]):
                    if not item["submenu"] or item["controlType"] != MENU_ITEM_TYPE:
                        continue
                    cinfo = provider.read(child)
                    cname = cinfo.get("name") or ""
                    check_menu_item(cinfo, cname, MENU_ITEM_TYPE)
                    item["opened"], err = run.try_expand(child, [title, cname])
                    if err is not None:
                        item["failed"] = redact(err)
                        item["collapsed"] = True
                        doc.setdefault("failedItems", []).append([redact(title), redact(cname)])
                        continue
                    celements, cpopups, ctrunc = popup_children(provider, child, max_items)
                    item["popup"] = popup_record(cpopups, redact, ctrunc)
                    item["children"] = read_items(provider, child, redact, max_items, celements)
                    item["collapsed"] = run.collapse(child, [title, cname])
                    if [title, cname] in run.closed_late:
                        item["closedLate"] = True
                    if not item["collapsed"]:
                        raise Stop("%s > %s is still open after Collapse" % (title, cname), ESC_HANDOFF)
            entry["collapsed"] = run.collapse(el, [title])
            if [title] in run.closed_late:
                entry["closedLate"] = True
            if not entry["collapsed"]:
                raise Stop("%s is still open after Collapse" % title, ESC_HANDOFF)
    except ElementRefused as e:
        doc["reason"] = redact(str(e))
        run.unwind()
        return _finish(doc, run, provider, redact, "refused", EXIT_REFUSED)
    except Stop as s:
        doc["reason"] = redact(s.reason)
        doc["handoff"] = s.handoff
        if s.new_windows is not None:
            doc["newWindows"] = s.new_windows
        run.unwind()
        if s.handoff == FOREGROUND_HANDOFF:
            return _finish(doc, run, provider, redact, "refused-foreground", EXIT_REFUSED)
        return _finish(doc, run, provider, redact, "stopped", EXIT_STOPPED)
    return _finish(doc, run, provider, redact, "ok", EXIT_OK)


# ── CLI ──────────────────────────────────────────────────────────────────────


def build_parser():
    ap = argparse.ArgumentParser(description="S-F menu tool: ExpandCollapse only.")
    ap.add_argument("--provider", choices=("fake", "uia"))
    ap.add_argument("--fake-tree")
    ap.add_argument("--pid", type=int)
    ap.add_argument("--class", dest="class_name")
    ap.add_argument("--title")
    ap.add_argument("--menus")
    ap.add_argument("--allowed")
    ap.add_argument("--depth", type=int, choices=(0, 1), default=0)
    ap.add_argument("--allow-foreground", action="store_true")
    ap.add_argument("--settle-ms", type=int, default=400)
    ap.add_argument("--max-items", type=int, default=200)
    ap.add_argument("--call-timeout-ms", type=int, default=2000)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--really", action="store_true")
    return ap


def _emit(doc):
    sys.stdout.write(json.dumps(doc, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main(argv, env=None):
    env = os.environ if env is None else env
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        a = build_parser().parse_args(argv)
    except SystemExit:
        return EXIT_USAGE
    if a.provider is None or a.pid is None or a.pid <= 0 or not a.class_name or not a.title:
        sys.stderr.write("--provider, a positive --pid, --class and --title are required\n")
        return EXIT_USAGE
    if not (0 <= a.settle_ms <= 5000) or not (1 <= a.max_items <= 2000) or not (1 <= a.call_timeout_ms <= 30000):
        sys.stderr.write("--settle-ms 0..5000, --max-items 1..2000, --call-timeout-ms 1..30000\n")
        return EXIT_USAGE
    try:
        allowed = parse_allowed(a.allowed)
        menus = parse_menus(a.menus, allowed)
        redact = redactor_from_env(env)
    except (ValueError, TypeError, IndexError) as e:
        sys.stderr.write("%s\n" % e)
        return EXIT_USAGE
    if a.dry_run or not a.really:
        plan = build_plan(a.pid, a.class_name, a.title, menus, a.depth)
        plan["allowed"] = list(allowed)
        _emit({"schema": SCHEMA, "dry_run": True, "plan": json.loads(redact(json.dumps(plan, ensure_ascii=False)))})
        return EXIT_OK
    if a.provider == "fake":
        if not a.fake_tree:
            sys.stderr.write("--fake-tree is required with --provider fake\n")
            return EXIT_USAGE
        with open(a.fake_tree, encoding="utf-8") as f:
            provider = FakeMenuProvider(json.load(f))

        def sleep(_s):
            return None

    else:
        if sys.platform != "win32":
            sys.stderr.write("refused: the uia provider is Windows-only\n")
            return EXIT_REAL_RUN_REFUSED
        if env.get(PLAN_VERDICT_ENV) != "PASS":
            sys.stderr.write("refused: %s is not PASS; run through tools/uia/menus.ts\n" % PLAN_VERDICT_ENV)
            return EXIT_REAL_RUN_REFUSED
        try:
            provider = ComMenuProvider(a.call_timeout_ms)
        except Exception as e:
            sys.stderr.write("provider unavailable: %s\n" % type(e).__name__)
            return EXIT_PROVIDER
        sleep = time.sleep
    try:
        code, doc = run_menus(
            provider,
            a.pid,
            a.class_name,
            a.title,
            menus,
            redact,
            a.depth,
            a.allow_foreground,
            a.settle_ms,
            a.max_items,
            sleep,
            allowed,
        )
    except TargetError as e:
        sys.stderr.write("refused: %s\n" % e)
        return EXIT_USAGE
    _emit(doc)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
