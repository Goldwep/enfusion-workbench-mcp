"""Context-menu kernel for the Phase 4 live census, L05 (design phase4-live-census.md 2.2 `uia-context`).

Separate from the passive walker and from menus.py. This tool may do exactly two things to the
Workbench: IUIAutomationElement3::ShowContextMenu on ONE target element, and ExpandCollapse
Collapse on the popup that call opened. Everything else is a property read.

Rules, each enforced here:

  - the window is chosen like the walker chooses it: pid AND Win32 class AND a title pattern
    (walker.select_window), never the foreground window, never an owned window; the attached
    element must carry that pid and hwnd;
  - the target is resolved by its label path (`--path`, a JSON list: the dock name, then each
    label under it, as L05's targets carry it): each label must match exactly one element by
    Name below the previous match (bounded breadth-first search); none or several is a refusal,
    nothing touched. Two relaxations (P4-FIX-K): a non-final step named by several elements takes
    the first container (Tree/List/Pane/Window/Group/DataGrid/Table) among them, and a step
    `@<Class>.<n>` picks the n-th element of that class, as L01 keys unnamed controls;
  - ShowContextMenu is the only call on the target. Not supported (no IUIAutomationElement3,
    E_NOTIMPL, E_NOINTERFACE, UIA_E_NOTSUPPORTED): `supported: false`, nothing touched, exit 0;
  - the popup is a NEW unowned window of the pid of the Qt popup class (QWindowPopup; sf-15:
    Qt683QWindowPopupDropShadowSaveBits, root uiaClassName QMenu), waited for up to
    `--timeout-ms`; it is read passively (menus.popup_children / read_items, L02's descent);
  - the popup is closed ONLY through ExpandCollapse Collapse on the popup root (or its `Menu`
    child) when that element offers the pattern; otherwise it is left open, `leftOpen: true`,
    exit 5, and the owner presses Esc. Never a key, never Esc, never the mouse, never Invoke,
    never a window message;
  - a new window that is not the popup pair (the Qt popup and its untitled SysShadow helper)
    is a stop (exit 6);
  - the selection of the target's dock (SelectionItem IsSelected, a property read) is read
    before and after ShowContextMenu; `selectionChanged` records whether the call moved it.

PASSIVE mode (`--passive`, the sf-15 route; DEC-057 open list): the hand (the owner, or main
through computer use) right-clicks the target; this tool sends NOTHING. It never calls
ShowContextMenu, never Collapse, never resolves or touches the target; it lists the pid's windows
until exactly one popup of the Qt popup class (is_popup_window: `QWindowPopup` in the class,
unowned; the same rule as the active path) is visible, for up to `--timeout-ms` (default 20000),
then reads it exactly as the active path does (popup_children / read_items: labels, enabled,
checked, accelerator, `submenu` from the pattern list; a sub-menu is never expanded). A popup
already open when the wait starts is read (nothing is sent, so the active path's reason to refuse
does not hold; `popupPresentAtStart` records it). The popup is left open for the hand's Esc
(`leftOpen: true`, `openedBy: "hand"`, `passive: true`). No popup in time: result `no-popup`,
exit 0 (a clean answer, not an error). Several popups at once, or a new window that is not the
popup pair: `stopped`, exit 6, nothing read.

Usage (normally through tools/uia/context.ts):
  python -B tools/uia/context.py --provider fake|uia [--fake-tree <ctx.json>] --pid <n>
      --class <window class> --title <regex> --path '["Hierarchy","default"]'
      [--timeout-ms 15000] [--settle-ms 300] [--max-items 200] [--dry-run] [--really]
      [--passive]

Result: ok | unsupported | timeout | refused | refused-auth-window | left-open | stopped
(passive: ok | no-popup | refused | refused-auth-window | stopped).
Exit codes: 0 ok, unsupported or dry run; 2 usage; 3 refused; 4 provider unavailable;
5 the popup left open (owner's Esc); 6 stopped (no popup in time, or a new window);
7 real run refused (no plan verdict, not Windows).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from menus import (  # noqa: E402
    AUTH_WINDOW_TITLE,
    COLLAPSED,
    EXPANDED,
    LEAF,
    POPUP_CLASS_MARK,
    POPUP_SHADOW_CLASS,
    is_popup,
    popup_children,
    popup_record,
    read_items,
)
from walker import TargetError, _redact_report, redactor_from_env, select_window  # noqa: E402

SCHEMA = "emcp-uia-context/1"
PLAN_VERDICT_ENV = "ENFUSION_UIA_CONTEXT_PLAN_VERDICT"

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_REFUSED = 3
EXIT_PROVIDER = 4
EXIT_LEFT_OPEN = 5
EXIT_STOPPED = 6
EXIT_REAL_RUN_REFUSED = 7

MAX_SEARCH_NODES = 20000
MAX_SEARCH_DEPTH = 40
MAX_SELECTION_NODES = 5000
POLL_MS = 100

# HRESULTs that mean "this element does not do ShowContextMenu".
E_NOTIMPL = -2147467263  # 0x80004001
E_NOINTERFACE = -2147467262  # 0x80004002
UIA_E_NOTSUPPORTED = -2147220988  # 0x80040204
UNSUPPORTED_HRESULTS = frozenset({E_NOTIMPL, E_NOINTERFACE, UIA_E_NOTSUPPORTED})

ESC_HANDOFF = "the context menu popup is still open: the owner presses Esc once, by hand, then says done"
HAND_ESC = "the popup was opened by hand and is left open by this read: the owner presses Esc once, by hand"
DEFAULT_TIMEOUT_MS = 15000
PASSIVE_TIMEOUT_MS = 20000


class Unsupported(Exception):
    """The element does not support ShowContextMenu; nothing was done to it."""


class Refused(Exception):
    """The target could not be resolved safely; nothing was done."""


def is_popup_window(w):
    """The popup itself: unowned Qt popup class (an owned window is never the context popup)."""
    return POPUP_CLASS_MARK in (w.get("className") or "") and not w.get("owned")


def is_popup_pair(w):
    return is_popup_window(w) or ((w.get("className") or "") == POPUP_SHADOW_CLASS and not (w.get("title") or ""))


# ── Fake provider (tests) ────────────────────────────────────────────────────


class FakeContextProvider:
    """A JSON description: {foreground, windows:[{hwnd,pid,className,title,owned,tree}]}.

    Tree nodes: {controlType, name, automationId, className, patterns, selected, children}.
    Flags on a target node: "contextPopup": a window dict (with its own "tree") that appears
    among the pid's windows on ShowContextMenu; "showUnsupported": true (the call raises
    E_NOTIMPL); "selectOnShow": true (the call marks the node selected and clears the other
    selected nodes); "opensWindow": a window dict that also appears. On a popup window:
    "stuck": true (Collapse leaves it open), "popupDelayPolls": n (it appears only after n
    window listings). Top level "handPopup": a popup window dict (with its "tree") that the
    hand's right-click opens, with its shadow, after its "popupDelayPolls" listings (passive
    mode). Every call is recorded in `calls`.
    """

    name = "fake"

    def __init__(self, doc):
        self.doc = doc
        self.foreground = doc.get("foreground", 0)
        self.extra = []
        self.pending = []  # (window, polls left)
        self.calls = []
        self._ids = {}
        hand = doc.get("handPopup")
        if hand:
            hand.setdefault("tree", {}).setdefault("state", EXPANDED)
            shadow = {"hwnd": hand.get("hwnd", 0) + 1, "pid": hand.get("pid"), "className": POPUP_SHADOW_CLASS, "title": "", "owned": False, "_shadowOf": hand.get("hwnd")}
            delay = int(hand.get("popupDelayPolls", 0))
            self.pending.append((hand, delay))
            self.pending.append((shadow, delay))

    def info(self):
        return {"route": "fake"}

    def windows(self, pid):
        still = []
        for w, n in self.pending:
            if n <= 0:
                self.extra.append(w)
            else:
                still.append((w, n - 1))
        self.pending = still
        return [dict(w) for w in self.doc.get("windows", [])] + [dict(w) for w in self.extra]

    def foreground_hwnd(self):
        return self.foreground

    def attach(self, window):
        for w in list(self.doc.get("windows", [])) + list(self.extra):
            if w.get("hwnd") == window.get("hwnd"):
                root = w["tree"]
                root.setdefault("_id", {"pid": w.get("pid"), "hwnd": w.get("hwnd")})
                root.setdefault("_window", w.get("hwnd"))
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
            "state": el.get("state", LEAF if not el.get("children") else COLLAPSED),
            "selected": el.get("selected"),
        }

    def _all_nodes(self, node):
        yield node
        for c in node.get("children", []) or []:
            yield from self._all_nodes(c)

    def show_context_menu(self, el):
        self.calls.append(("ShowContextMenu", el.get("name")))
        if el.get("showUnsupported"):
            raise Unsupported("E_NOTIMPL (fake)")
        if el.get("selectOnShow"):
            for w in self.doc.get("windows", []):
                for n in self._all_nodes(w.get("tree") or {}):
                    if n.get("selected"):
                        n["selected"] = False
            el["selected"] = True
        popup = el.get("contextPopup")
        if popup:
            popup.setdefault("tree", {}).setdefault("state", EXPANDED)
            delay = int(popup.get("popupDelayPolls", 0))
            if delay:
                self.pending.append((popup, delay))
            else:
                self.extra.append(popup)
            self.extra.append({"hwnd": popup.get("hwnd", 0) + 1, "pid": popup.get("pid"), "className": POPUP_SHADOW_CLASS, "title": "", "owned": False, "_shadowOf": popup.get("hwnd")})
        if el.get("opensWindow"):
            self.extra.append(el["opensWindow"])

    def collapse(self, el):
        self.calls.append(("Collapse", el.get("name")))
        hwnd = el.get("_window")
        w = next((x for x in self.extra if x.get("hwnd") == hwnd), None)
        if w is None or w.get("stuck"):
            return
        el["state"] = COLLAPSED
        self.extra = [x for x in self.extra if x is not w and x.get("_shadowOf") != hwnd]


# ── Real provider ────────────────────────────────────────────────────────────


class ComContextProvider:
    """comtypes IUIAutomation2 reads (menus.ComMenuProvider), plus ShowContextMenu and Collapse."""

    name = "uia"

    def __init__(self, call_timeout_ms=2000):
        from menus import ComMenuProvider

        self._m = ComMenuProvider(call_timeout_ms)
        self._uia = self._m._uia
        self._ct = self._m._ct

    def info(self):
        i = self._m.info()
        i["route"] = "comtypes IUIAutomation2; IUIAutomationElement3 ShowContextMenu and ExpandCollapse Collapse only"
        return i

    def windows(self, pid):
        return self._m.windows(pid)

    def foreground_hwnd(self):
        return self._m.foreground_hwnd()

    def attach(self, window):
        return self._m.attach(window)

    def identity(self, root):
        return self._m.identity(root)

    def children(self, el):
        return self._m.children(el)

    def read(self, el):
        out = self._m.read(el)
        out["selected"] = None
        if self._m._prop(el, "IsSelectionItemPatternAvailable") is True:
            v = self._m._prop(el, "SelectionItemIsSelected")
            out["selected"] = v if isinstance(v, bool) else None
        return out

    def show_context_menu(self, el):
        import comtypes

        iface = getattr(self._uia, "IUIAutomationElement3", None)
        if iface is None:
            raise Unsupported("the comtypes wrapper has no IUIAutomationElement3")
        try:
            el3 = el.QueryInterface(iface)
        except comtypes.COMError as e:
            raise Unsupported("QueryInterface IUIAutomationElement3 failed (0x%08X)" % (e.hresult & 0xFFFFFFFF))
        try:
            el3.ShowContextMenu()
        except comtypes.COMError as e:
            if e.hresult in UNSUPPORTED_HRESULTS:
                raise Unsupported("ShowContextMenu returned 0x%08X" % (e.hresult & 0xFFFFFFFF))
            raise

    def collapse(self, el):
        self._m.collapse(el)


# ── The run ──────────────────────────────────────────────────────────────────


def parse_path(value):
    try:
        path = json.loads(value or "")
    except ValueError:
        raise ValueError("--path must be a JSON list of labels")
    if not isinstance(path, list) or not path or not all(isinstance(x, str) and x for x in path):
        raise ValueError("--path must be a non-empty JSON list of non-empty labels")
    return path


def build_plan(pid, class_name, title_pattern, path, timeout_ms):
    return {
        "target": {"pid": pid, "className": class_name, "titlePattern": title_pattern, "path": list(path)},
        "timeoutMs": timeout_ms,
        "steps": [
            {"call": "ShowContextMenu", "path": list(path)},
            {"call": "read popup (properties only)"},
            {"call": "Collapse", "on": "the popup root, only if it offers ExpandCollapse"},
        ],
        "never": ["invoke", "toggle", "selection change", "value", "focus", "key", "Esc", "mouse", "window message"],
    }


# Control types a non-final path step may settle on when its label is not unique (a dock's
# window shares its title with its tab-bar TabItems; P4-FIX-K: "2 elements named 'Hierarchy'").
CONTAINER_TYPES = ("Tree", "List", "Pane", "Window", "Group", "DataGrid", "Table")


def _class_step(label):
    """`@<Class>.<n>` (L01's ordinal key): (class, n), else None."""
    if not label.startswith("@") or "." not in label:
        return None
    cls, _, n = label[1:].rpartition(".")
    if not cls or not n.isdigit() or int(n) < 1:
        return None
    return cls, int(n)


def _find(provider, start, match):
    """Breadth-first below `start`: every element `match(info)` accepts, in BFS order (bounded)."""
    found = []
    level = [(start, 0)]
    seen = 0
    while level:
        nxt = []
        for el, d in level:
            for c in provider.children(el):
                seen += 1
                if seen > MAX_SEARCH_NODES:
                    raise Refused("the search passed %d elements; refusing" % MAX_SEARCH_NODES)
                if match(provider.read(c)):
                    found.append(c)
                elif d + 1 < MAX_SEARCH_DEPTH:
                    nxt.append((c, d + 1))
        level = nxt
    return found


def _find_named(provider, start, name):
    """Breadth-first below `start`: every element whose Name equals `name` (bounded)."""
    return _find(provider, start, lambda info: (info.get("name") or "") == name)


HIERARCHY_DOCK = "Hierarchy"
DIRTY_MARK = "*"


def resolve_target(provider, root, path, live_names=None):
    """Each label of the path matches one element below the previous one.

    A label `@<Class>.<n>` is the n-th element (breadth-first) of that UIA class, as L01 keys an
    unnamed control. A plain label matches by Name; when several match, a NON-final step takes the
    first match whose controlType is a container (CONTAINER_TYPES), the final step (the element
    ShowContextMenu goes to) must still match exactly one.

    The dirty marker (P4-5 2026-11-13: the layer row of an unsaved world reads `default*`, and the
    probe refused "0 elements named 'default'"): in a path under the Hierarchy dock only, a step
    after the first that matches no element by its exact name matches an element whose name is the
    label plus one trailing `*`. An exact match always wins; uniqueness is still required. Each such
    step is appended to `live_names` as {step, census, live}.
    """
    el = root
    scope = None
    last = len(path) - 1
    for i, label in enumerate(path):
        cs = _class_step(label)
        if cs is not None:
            hits = _find(provider, el, lambda info, c=cs[0]: (info.get("className") or "") == c)
            if len(hits) < cs[1]:
                raise Refused("%d elements of class %r at path step %d; refusing" % (len(hits), cs[0], i + 1))
            el = hits[cs[1] - 1]
        else:
            hits = _find_named(provider, el, label)
            if not hits and i > 0 and path[0] == HIERARCHY_DOCK:
                hits = _find_named(provider, el, label + DIRTY_MARK)
                if hits and live_names is not None:
                    live_names.append({"step": i + 1, "census": label, "live": label + DIRTY_MARK})
            if len(hits) > 1 and i < last:
                hits = [h for h in hits if provider.read(h).get("controlType") in CONTAINER_TYPES][:1]
            if len(hits) != 1:
                raise Refused("%d elements named %r at path step %d; refusing to choose" % (len(hits), label, i + 1))
            el = hits[0]
        if i == 0:
            scope = el
    return el, scope


def selected_names(provider, scope):
    """Names of the selected elements under `scope` (SelectionItem IsSelected, a property read)."""
    out = []
    stack = [scope]
    seen = 0
    while stack and seen < MAX_SELECTION_NODES:
        el = stack.pop()
        for c in provider.children(el):
            seen += 1
            info = provider.read(c)
            if info.get("selected") is True:
                out.append(info.get("name") or "")
            stack.append(c)
    return sorted(out), seen >= MAX_SELECTION_NODES


def _describe(w, redact):
    return {"className": w.get("className") or "", "title": redact(w.get("title") or ""), "owned": bool(w.get("owned"))}


def run_context(provider, pid, class_name, title_pattern, path, redact, timeout_ms=15000, settle_ms=300, max_items=200, sleep=time.sleep, clock=time.monotonic):
    doc = {"schema": SCHEMA, "provider": provider.name, "path": [redact(x) for x in path], "supported": None, "popup": None, "items": [], "collapsed": None, "leftOpen": False, "calls": []}

    def finish(result, code):
        doc["result"] = result
        doc["provider_info"] = provider.info()
        doc["redaction"] = redact.report()
        return code, doc

    windows = provider.windows(pid)
    if any(w.get("pid") == pid and (w.get("title") or "") == AUTH_WINDOW_TITLE for w in windows):
        doc["reason"] = "a %r window of the pid is open; nothing is touched while it is" % AUTH_WINDOW_TITLE
        return finish("refused-auth-window", EXIT_REFUSED)
    window, report = select_window(windows, pid, class_name, title_pattern, allow_owned=False)
    if window is None:
        doc["reason"] = redact(report["reason"])
        doc["target"] = {"selection": _redact_report(report, redact)}
        return finish("refused", EXIT_REFUSED)
    if any(is_popup_window(w) and w.get("pid") == pid and w.get("visible", True) for w in windows):
        doc["reason"] = "a popup of the pid is already open; nothing is touched while it is"
        return finish("refused", EXIT_REFUSED)
    try:
        root = provider.attach(window)
        ident = provider.identity(root)
    except Exception as e:
        unavailable = bool(getattr(e, "provider_unavailable", False))
        doc["reason"] = redact("%s: %s" % ("provider unavailable" if unavailable else "attach failed", e))
        return finish("refused", EXIT_PROVIDER if unavailable else EXIT_REFUSED)
    if ident.get("pid") != pid or ident.get("hwnd") != window.get("hwnd"):
        doc["reason"] = "the attached element is not the chosen window"
        return finish("refused", EXIT_REFUSED)
    doc["target"] = {"pid": pid, "hwnd": window.get("hwnd"), "className": redact(class_name), "title": redact(window.get("title") or "")}
    live_names = []
    try:
        target, scope = resolve_target(provider, root, path, live_names)
    except Refused as e:
        doc["reason"] = redact(str(e))
        return finish("refused", EXIT_REFUSED)
    if live_names:
        doc["target"]["liveNames"] = [
            {"step": x["step"], "census": redact(x["census"]), "live": redact(x["live"])} for x in live_names
        ]
    tinfo = provider.read(target)
    doc["target"]["element"] = {"controlType": tinfo.get("controlType"), "automationId": redact(tinfo.get("automationId") or "") or None}
    sel_before, trunc_b = selected_names(provider, scope)
    fg_mine = {w.get("hwnd") for w in windows if w.get("pid") == pid}
    doc["foregroundBefore"] = provider.foreground_hwnd() in fg_mine
    before = {w.get("hwnd") for w in provider.windows(pid) if w.get("pid") == pid}

    doc["calls"].append({"call": "ShowContextMenu", "path": doc["path"]})
    try:
        provider.show_context_menu(target)
    except Unsupported as e:
        doc["supported"] = False
        doc["reason"] = redact(str(e))
        return finish("unsupported", EXIT_OK)
    except Exception as e:  # an unexpected failure of the one call: say so, read nothing more
        doc["reason"] = redact("ShowContextMenu failed: %s: %s" % (type(e).__name__, e))
        doc["handoff"] = "the owner looks whether a popup opened and, if so, presses Esc once, by hand"
        return finish("stopped", EXIT_STOPPED)
    doc["supported"] = True

    deadline = clock() + timeout_ms / 1000.0
    popup = None
    stray = []
    while True:
        now_w = [w for w in provider.windows(pid) if w.get("pid") == pid and w.get("hwnd") not in before and w.get("visible", True)]
        stray = [w for w in now_w if not is_popup_pair(w)]
        pops = [w for w in now_w if is_popup_window(w)]
        if stray or pops or clock() >= deadline:
            popup = pops[0] if len(pops) == 1 else None
            if len(pops) > 1:
                stray = stray + pops[1:]
            break
        sleep(POLL_MS / 1000.0)
    sleep(settle_ms / 1000.0)
    doc["foregroundAfter"] = provider.foreground_hwnd() in fg_mine | {w.get("hwnd") for w in provider.windows(pid) if w.get("pid") == pid}

    popup_root = None
    if popup is not None:
        doc["popup"] = {"className": popup.get("className") or "", "title": redact(popup.get("title") or ""), "owned": bool(popup.get("owned"))}
        try:
            popup_root = provider.attach(popup)
            pinfo = provider.read(popup_root)
            elements, popups, truncated = popup_children(provider, popup_root, max_items)
            doc["popup"].update({"controlType": pinfo.get("controlType"), "name": redact(pinfo.get("name") or ""), "uiaClassName": redact(pinfo.get("className") or "") or None, "automationId": redact(pinfo.get("automationId") or "") or None, "menuChildren": popup_record(popups, redact, truncated)})
            doc["items"] = read_items(provider, popup_root, redact, max_items, elements)
        except Exception as e:  # the read failed: still try to close it
            doc["popup"]["readError"] = redact("%s: %s" % (type(e).__name__, e))

    sel_after, trunc_a = selected_names(provider, scope)
    doc["selection"] = {"before": [redact(x) for x in sel_before], "after": [redact(x) for x in sel_after], "truncated": trunc_b or trunc_a}
    doc["selectionChanged"] = sel_before != sel_after

    if popup_root is not None:
        doc["collapsed"] = collapse_popup(provider, pid, popup, popup_root, doc, settle_ms, sleep)
        doc["leftOpen"] = not doc["collapsed"]
    elif popup is not None:
        doc["collapsed"] = False
        doc["leftOpen"] = True

    if stray:
        doc["newWindows"] = [_describe(w, redact) for w in stray]
        doc["reason"] = "a new window that is not the popup pair appeared after ShowContextMenu"
        doc["handoff"] = "the owner looks at the new window and closes it by hand (Esc or Cancel), never a choice"
        return finish("stopped", EXIT_STOPPED)
    if popup is None:
        doc["reason"] = "no popup window of the pid appeared within %d ms of ShowContextMenu" % timeout_ms
        return finish("timeout", EXIT_STOPPED)
    if doc["leftOpen"]:
        doc["handoff"] = ESC_HANDOFF
        return finish("left-open", EXIT_LEFT_OPEN)
    return finish("ok", EXIT_OK)


def build_passive_plan(pid, class_name, title_pattern, path, timeout_ms):
    return {
        "target": {"pid": pid, "className": class_name, "titlePattern": title_pattern, "path": list(path)},
        "mode": "passive",
        "openedBy": "hand",
        "timeoutMs": timeout_ms,
        "steps": [
            {"call": "window list only: wait for one popup of the pid (the hand right-clicks the target)"},
            {"call": "read popup (properties only)"},
        ],
        "never": ["ShowContextMenu", "Collapse", "expand", "invoke", "toggle", "selection change", "value", "focus", "key", "Esc", "mouse", "window message"],
    }


def run_passive(provider, pid, class_name, title_pattern, path, redact, timeout_ms=PASSIVE_TIMEOUT_MS, settle_ms=300, max_items=200, sleep=time.sleep, clock=time.monotonic):
    """The sf-15 route: wait for a hand-opened popup of the pid and read it. Sends nothing.

    Only provider.windows / attach / identity / children / read are used here: never
    show_context_menu, never collapse, and the target path is a label for the record only.
    """
    doc = {"schema": SCHEMA, "provider": provider.name, "mode": "passive", "passive": True, "openedBy": "hand", "path": [redact(x) for x in path], "supported": None, "popup": None, "items": [], "collapsed": None, "leftOpen": False, "calls": []}

    def finish(result, code):
        doc["result"] = result
        doc["provider_info"] = provider.info()
        doc["redaction"] = redact.report()
        return code, doc

    windows = provider.windows(pid)
    if any(w.get("pid") == pid and (w.get("title") or "") == AUTH_WINDOW_TITLE for w in windows):
        doc["reason"] = "a %r window of the pid is open; nothing is read while it is" % AUTH_WINDOW_TITLE
        return finish("refused-auth-window", EXIT_REFUSED)
    window, report = select_window(windows, pid, class_name, title_pattern, allow_owned=False)
    if window is None:
        doc["reason"] = redact(report["reason"])
        doc["target"] = {"selection": _redact_report(report, redact)}
        return finish("refused", EXIT_REFUSED)
    doc["target"] = {"pid": pid, "hwnd": window.get("hwnd"), "className": redact(class_name), "title": redact(window.get("title") or "")}
    mine = [w for w in windows if w.get("pid") == pid and w.get("visible", True)]
    doc["popupPresentAtStart"] = any(is_popup_window(w) for w in mine)
    before = {w.get("hwnd") for w in mine}

    deadline = clock() + timeout_ms / 1000.0
    pops = []
    stray = []
    while True:
        now_w = [w for w in provider.windows(pid) if w.get("pid") == pid and w.get("visible", True)]
        pops = [w for w in now_w if is_popup_window(w)]
        stray = [w for w in now_w if w.get("hwnd") not in before and not is_popup_pair(w)]
        if stray or pops or clock() >= deadline:
            break
        sleep(POLL_MS / 1000.0)
    if stray:
        doc["newWindows"] = [_describe(w, redact) for w in stray]
        doc["reason"] = "a new window that is not the popup pair appeared while waiting for the hand's popup; nothing read"
        doc["handoff"] = "the owner looks at the new window and closes it by hand (Esc or Cancel), never a choice"
        return finish("stopped", EXIT_STOPPED)
    if not pops:
        doc["reason"] = "no popup window of the pid appeared within %d ms (nothing was sent)" % timeout_ms
        return finish("no-popup", EXIT_OK)
    if len(pops) > 1:
        doc["newWindows"] = [_describe(w, redact) for w in pops]
        doc["reason"] = "%d popup windows of the pid are open; refusing to choose (a sub-menu open?)" % len(pops)
        doc["leftOpen"] = True
        doc["handoff"] = "the owner presses Esc until every popup is closed, by hand"
        return finish("stopped", EXIT_STOPPED)
    sleep(settle_ms / 1000.0)
    popup = pops[0]
    doc["popup"] = {"className": popup.get("className") or "", "title": redact(popup.get("title") or ""), "owned": bool(popup.get("owned"))}
    doc["leftOpen"] = True
    doc["handoff"] = HAND_ESC
    try:
        popup_root = provider.attach(popup)
        pinfo = provider.read(popup_root)
        elements, popups, truncated = popup_children(provider, popup_root, max_items)
        doc["popup"].update({"controlType": pinfo.get("controlType"), "name": redact(pinfo.get("name") or ""), "uiaClassName": redact(pinfo.get("className") or "") or None, "automationId": redact(pinfo.get("automationId") or "") or None, "menuChildren": popup_record(popups, redact, truncated)})
        doc["items"] = read_items(provider, popup_root, redact, max_items, elements)
    except Exception as e:
        doc["popup"]["readError"] = redact("%s: %s" % (type(e).__name__, e))
        doc["reason"] = "the hand-opened popup could not be read"
        return finish("stopped", EXIT_STOPPED)
    return finish("ok", EXIT_OK)


def collapse_popup(provider, pid, popup, popup_root, doc, settle_ms, sleep):
    """Collapse on the popup root or its `Menu` child, whichever offers ExpandCollapse; never a key."""
    target = None
    if "ExpandCollapse" in (provider.read(popup_root).get("patterns") or []):
        target = popup_root
    else:
        for c in provider.children(popup_root):
            ci = provider.read(c)
            if ci.get("controlType") == "Menu" and "ExpandCollapse" in (ci.get("patterns") or []):
                target = c
                break
    if target is None:
        doc["collapseSkipped"] = "the popup offers no ExpandCollapse pattern"
        return False
    doc["calls"].append({"call": "Collapse", "on": "popup"})
    try:
        provider.collapse(target)
    except Exception as e:
        doc["collapseError"] = "%s" % type(e).__name__
        return False
    sleep(settle_ms / 1000.0)
    return not any(w.get("hwnd") == popup.get("hwnd") and w.get("visible", True) for w in provider.windows(pid))


# ── CLI ──────────────────────────────────────────────────────────────────────


def build_parser():
    ap = argparse.ArgumentParser(description="L05 context-menu kernel: ShowContextMenu and Collapse only.")
    ap.add_argument("--provider", choices=("fake", "uia"))
    ap.add_argument("--fake-tree")
    ap.add_argument("--pid", type=int)
    ap.add_argument("--class", dest="class_name")
    ap.add_argument("--title")
    ap.add_argument("--path")
    ap.add_argument("--timeout-ms", type=int, default=None)
    ap.add_argument("--settle-ms", type=int, default=300)
    ap.add_argument("--max-items", type=int, default=200)
    ap.add_argument("--call-timeout-ms", type=int, default=2000)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--really", action="store_true")
    ap.add_argument("--passive", action="store_true")
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
    if a.timeout_ms is None:
        a.timeout_ms = PASSIVE_TIMEOUT_MS if a.passive else DEFAULT_TIMEOUT_MS
    if not (1 <= a.timeout_ms <= 60000) or not (0 <= a.settle_ms <= 5000) or not (1 <= a.max_items <= 2000) or not (1 <= a.call_timeout_ms <= 30000):
        sys.stderr.write("--timeout-ms 1..60000, --settle-ms 0..5000, --max-items 1..2000, --call-timeout-ms 1..30000\n")
        return EXIT_USAGE
    try:
        path = parse_path(a.path)
        redact = redactor_from_env(env)
    except (ValueError, TypeError, IndexError) as e:
        sys.stderr.write("%s\n" % e)
        return EXIT_USAGE
    if a.dry_run or not a.really:
        plan = (build_passive_plan if a.passive else build_plan)(a.pid, a.class_name, a.title, path, a.timeout_ms)
        _emit({"schema": SCHEMA, "dry_run": True, "plan": json.loads(redact(json.dumps(plan, ensure_ascii=False)))})
        return EXIT_OK
    if a.provider == "fake":
        if not a.fake_tree:
            sys.stderr.write("--fake-tree is required with --provider fake\n")
            return EXIT_USAGE
        with open(a.fake_tree, encoding="utf-8") as f:
            provider = FakeContextProvider(json.load(f))
        ticks = [0.0]

        def sleep(s):
            ticks[0] += s

        def clock():
            return ticks[0]

    else:
        if sys.platform != "win32":
            sys.stderr.write("refused: the uia provider is Windows-only\n")
            return EXIT_REAL_RUN_REFUSED
        if env.get(PLAN_VERDICT_ENV) != "PASS":
            sys.stderr.write("refused: %s is not PASS; run through tools/uia/context.ts\n" % PLAN_VERDICT_ENV)
            return EXIT_REAL_RUN_REFUSED
        try:
            provider = ComContextProvider(a.call_timeout_ms)
        except Exception as e:
            sys.stderr.write("provider unavailable: %s\n" % type(e).__name__)
            return EXIT_PROVIDER
        sleep = time.sleep
        clock = time.monotonic
    run = run_passive if a.passive else run_context
    try:
        code, doc = run(provider, a.pid, a.class_name, a.title, path, redact, a.timeout_ms, a.settle_ms, a.max_items, sleep, clock)
    except TargetError as e:
        sys.stderr.write("refused: %s\n" % e)
        return EXIT_USAGE
    if a.provider == "fake":
        # Tests: every call the fake provider received (ShowContextMenu, Collapse), so a passive
        # run can be shown to have sent nothing.
        doc["fakeCalls"] = [list(c) for c in provider.calls]
    _emit(doc)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
