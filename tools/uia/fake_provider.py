"""Fake tree provider for tools/uia/walker.py: the walker's tests run against it.

The input is a JSON document:

  {"windows": [{"hwnd": 101, "pid": 4242, "className": "...", "title": "...",
                "visible": true, "owned": false, "hung": false,
                "identity": {...optional overrides of pid, className, hwnd...},
                "uiaClassName": "...optional: the root's UIA ClassName...",
                "attachError": "...optional: attach raises...",
                "attachUnavailable": "...optional: attach raises provider-unavailable...",
                "hungAfterReads": 12,
                "tree": <node>}]}

  <node> = {"controlType": "...", "name": "...", "automationId": "...",
            "className": "...", "rect": [x, y, w, h], "enabled": true,
            "offscreen": false, "patterns": ["Invoke", ...], "frameworkId": "...",
            "acceleratorKey": "...", "helpText": "...", "legacyShortcut": "...",
            "gridRowCount": 3, "children": [<node>, ...],
            "generate": {"count": 30000, "controlType": "ListItem",
                         "namePrefix": "row ", "automationIdPrefix": "", "patterns": []},
            "delayMs": 5, "error": "timeout", "childError": "unavailable"}

`generate` synthesises children on demand, so a 30,000-row list costs nothing
until the walker navigates to it. `delayMs` sleeps in each read of that node (to
test the wall-clock budget); `error` makes each read of that node raise
("timeout" as an unresponsive provider would, "unavailable" as
UIA_E_ELEMENTNOTAVAILABLE); `childError` does the same for its first-child
call. The root's identity answers a UIA ClassName that differs from the Win32
class, as Qt's provider does [unverified until S-C]; `hungAfterReads` makes
IsHungAppWindow report the window hung once that many reads were made. Trees in tests are synthetic: nothing
here claims to reproduce what Workbench exposes. Every call is counted per kind
and reported through info(), so a test can assert how much navigation a walk
cost.
"""

import time

READ_FIELDS = (
    "controlType",
    "name",
    "automationId",
    "className",
    "rect",
    "enabled",
    "offscreen",
    "patterns",
    "frameworkId",
    "acceleratorKey",
    "accessKey",
    "helpText",
    "legacyShortcut",
    "legacyDescription",
    "legacyDefaultAction",
    "gridRowCount",
    "gridColumnCount",
)


class FakeTimeoutError(Exception):
    """What a provider call that ran out of time raises in the fake."""


class FakeElementNotAvailable(Exception):
    """UIA_E_ELEMENTNOTAVAILABLE, carried as a COM error carries it."""

    hresult = -2147220991


class FakeProviderUnavailable(RuntimeError):
    """The fake's stand-in for uia_com.ProviderUnavailable (client timeouts not set)."""

    provider_unavailable = True


# The UIA ClassName a Qt provider answers for a top-level window differs from
# the Win32 class: the fake answers this unless the window sets "uiaClassName".
DEFAULT_UIA_CLASS_NAME = "FakeQtMainWindow"


def _raise(kind):
    if kind == "timeout":
        raise FakeTimeoutError("fake provider call timed out")
    if kind == "unavailable":
        raise FakeElementNotAvailable("fake element not available")


class FakeElement:
    __slots__ = ("node", "parent", "index")

    def __init__(self, node, parent, index):
        self.node = node
        self.parent = parent
        self.index = index


def _child_count(node):
    gen = node.get("generate")
    if gen:
        return int(gen.get("count", 0))
    return len(node.get("children") or [])


def _child_node(node, i):
    gen = node.get("generate")
    if gen:
        return {
            "controlType": gen.get("controlType", "ListItem"),
            "name": "%s%d" % (gen.get("namePrefix", ""), i),
            "automationId": ("%s%d" % (gen["automationIdPrefix"], i)) if gen.get("automationIdPrefix") else "",
            "patterns": list(gen.get("patterns", [])),
        }
    return node["children"][i]


class FakeProvider:
    name = "fake"

    def __init__(self, data):
        self.data = data
        self.calls = {}
        self._roots = {}

    def _tick(self, kind):
        self.calls[kind] = self.calls.get(kind, 0) + 1

    def info(self):
        return {"calls": dict(sorted(self.calls.items()))}

    def windows(self, pid):
        self._tick("windows")
        out = []
        for w in self.data.get("windows", []):
            out.append(
                {
                    "hwnd": w.get("hwnd"),
                    "pid": w.get("pid"),
                    "className": w.get("className"),
                    "title": w.get("title"),
                    "visible": w.get("visible", True),
                    "owned": w.get("owned", False),
                    "hung": w.get("hung", False),
                }
            )
        return out

    def _window(self, hwnd):
        for w in self.data.get("windows", []):
            if w.get("hwnd") == hwnd:
                return w
        return None

    def attach(self, window):
        self._tick("attach")
        w = self._window(window.get("hwnd"))
        if w is None:
            raise LookupError("no fake window with that handle")
        if w.get("attachUnavailable"):
            raise FakeProviderUnavailable(w["attachUnavailable"])
        if w.get("attachError"):
            raise FakeTimeoutError(w["attachError"])
        root = FakeElement(w["tree"], None, 0)
        self._roots[id(root)] = w
        return root

    def identity(self, el):
        w = self._roots[id(el)]
        ident = {
            "pid": w.get("pid"),
            "className": w.get("uiaClassName", DEFAULT_UIA_CLASS_NAME),
            "hwnd": w.get("hwnd"),
        }
        ident.update(w.get("identity") or {})
        return ident

    def hung(self, hwnd):
        """The window's "hungAfterReads": hung once that many reads were made."""
        self._tick("hung")
        w = self._window(hwnd) or {}
        after = w.get("hungAfterReads")
        return after is not None and self.calls.get("read", 0) >= after

    def read(self, el):
        self._tick("read")
        node = el.node
        if node.get("delayMs"):
            time.sleep(node["delayMs"] / 1000.0)
        _raise(node.get("error"))
        return {k: node[k] for k in READ_FIELDS if k in node}

    def first_child(self, el):
        self._tick("first_child")
        _raise(el.node.get("childError"))
        if _child_count(el.node) == 0:
            return None
        return FakeElement(_child_node(el.node, 0), el, 0)

    def _next(self, el):
        parent = el.parent
        if parent is None:
            return None
        i = el.index + 1
        if i >= _child_count(parent.node):
            return None
        return FakeElement(_child_node(parent.node, i), parent, i)

    def next_sibling(self, el):
        self._tick("next_sibling")
        return self._next(el)

    def next_sibling_bare(self, el):
        self._tick("next_sibling_bare")
        return self._next(el)
