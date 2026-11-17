"""Passive UI Automation walker for unknown U7 (plan 7; plan 8 Phase 2, CORE-AUTHOR walker).

U7 asks whether UI Automation exposes the Workbench's Qt widgets (menu bar, menu
items, object names as automation ids, property-grid rows) and what attaching
costs. This walker answers the first half by reading the accessibility tree of
ONE top-level window; the session script around it measures the second half.

What it does, and nothing else:

  - chooses the window by process id AND Win32 window class AND a title pattern
    together (never the foreground window, never a search by title alone); it
    refuses when no window or more than one window matches, when the window is
    owned (a dialog or popup) unless --allow-owned, and when Windows reports it
    as not responding;
  - after attaching, checks that the element's process id and native window
    handle are the ones chosen, and refuses otherwise (the element's UIA
    ClassName is recorded as target.uiaClassName, not compared: Qt's provider
    answers it with its own value, not the Win32 class);
  - reads properties only: control type, name, automation id, class name,
    bounding rectangle, enabled and offscreen state, framework id, accelerator
    and access keys, help text, three LegacyIAccessible properties (keyboard
    shortcut, description, default action), grid row and column counts, and the
    list of control patterns the element SUPPORTS (from the
    Is<Pattern>PatternAvailable properties). It never retrieves a pattern
    object, so no pattern method can be called, not even to read;
  - walks within bounds: maximum depth, maximum nodes, a wall-clock budget, a
    per-call timeout (real provider; the walk refuses when it cannot be set), a
    stop at the FIRST timed-out call (plan 5.3: no retry), a stop after
    consecutive failed calls of other kinds, and a stop when IsHungAppWindow,
    sampled every HUNG_SAMPLE_EVERY calls, reports the window hung.
    Children of data containers (List, Tree, Table, DataGrid, their item rows,
    and anything exposing the Grid or Table pattern) are sampled: the first
    `row_sample` are read, the rest are only counted by navigation, up to
    `count_cap`; any other element keeps at most `max_children` children;
  - passes every string through a redaction step (known roots, the account and
    machine names and the generic personal-data shapes become placeholders) and
    reports how many were redacted;
  - prints ONE JSON document on stdout. It writes no file: tools/uia/walk.ts
    applies the harness's toPlaceholders a second time and writes the artifact.

Providers: `fake` (tools/uia/fake_provider.py, a JSON tree, for tests) and `uia`
(tools/uia/uia_com.py, COM IUIAutomation through comtypes). The `uia` provider
runs only with --really, on win32, and with ENFUSION_UIA_PLAN_VERDICT=PASS in the
environment, which tools/uia/walk.ts sets after the action plan passed the
dry-run checker. That is an interlock against an accidental direct run, not a
security boundary; the live gate (lease, --really) is walk.ts's.

Usage (normally through tools/uia/walk.ts):
  python -B tools/uia/walker.py --provider fake --fake-tree <tree.json> --pid <n>
      --class <window class> --title-pattern <regex> [--view raw|control] [bounds]
  python -B tools/uia/walker.py --provider fake --fake-tree <tree.json> --pid <n> --list-windows
  python -B tools/uia/walker.py --provider uia --pid <n> --class <c> --title-pattern <re>
      [bounds] --really
  python -B tools/uia/walker.py --print-defaults

Bounds: --max-depth --max-nodes --budget-ms --row-sample --max-children
  --count-cap --call-timeout-ms --slow-call-ms --max-consecutive-errors

Exit codes: 0 walked or listed, 2 usage error, 3 target refused, 4 provider
unavailable (including: the client timeouts could not be set), 5 real run
refused (no --really, not win32, or no checked plan).
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import re
import sys
import time
import urllib.parse

SCHEMA = "emcp-uia-walk/1"

# Mirrored by DEFAULT_BOUNDS in tools/uia/walk.ts (a test compares the two).
DEFAULT_BOUNDS = {
    "max_depth": 40,
    "max_nodes": 5000,
    "budget_ms": 60000,
    "row_sample": 40,
    "max_children": 1000,
    "count_cap": 2000,
    "call_timeout_ms": 2000,
    "slow_call_ms": 250,
    "max_consecutive_errors": 3,
}

# Upper limits a bound may be raised to. Mirrored by BOUND_CAPS in walk.ts.
BOUND_CAPS = {
    "max_depth": 200,
    "max_nodes": 100000,
    "budget_ms": 600000,
    "row_sample": 1000,
    "max_children": 10000,
    "count_cap": 100000,
    "call_timeout_ms": 30000,
    "slow_call_ms": 60000,
    "max_consecutive_errors": 50,
}

# Containers whose children are data rows, not UI structure: read the first
# `row_sample`, count the rest. A 30,000-row resource list or a large Hierarchy
# must not be walked in full (recon gui-census-feasibility section 6 risk 3).
DATA_CONTAINER_TYPES = frozenset({"List", "Tree", "Table", "DataGrid"})
DATA_ROW_TYPES = frozenset({"ListItem", "TreeItem", "DataItem"})
DATA_PATTERNS = frozenset({"Grid", "Table"})

# Patterns whose availability is read (Is<Name>PatternAvailable). Names only:
# the walker never retrieves the pattern objects.
PATTERN_NAMES = (
    "Invoke",
    "ExpandCollapse",
    "Toggle",
    "Value",
    "RangeValue",
    "Selection",
    "SelectionItem",
    "Grid",
    "GridItem",
    "Table",
    "TableItem",
    "Scroll",
    "ScrollItem",
    "Text",
    "Window",
    "Transform",
    "Dock",
    "MultipleView",
    "ItemContainer",
    "VirtualizedItem",
    "SynchronizedInput",
    "LegacyIAccessible",
)

# String properties a provider may return; every one is redacted.
STRING_FIELDS = (
    "name",
    "automationId",
    "className",
    "frameworkId",
    "acceleratorKey",
    "accessKey",
    "helpText",
    "legacyShortcut",
    "legacyDescription",
    "legacyDefaultAction",
)

# Optional string fields are written only when non-empty, to keep the tree small.
OPTIONAL_STRING_FIELDS = STRING_FIELDS[3:]

# How many examples of names and automation ids the U7 summary keeps.
SUMMARY_EXAMPLES = 40

# IsHungAppWindow of the target is read once per this many provider calls during
# the walk, and once after it (the GUI-stall half of U7's cost question).
HUNG_SAMPLE_EVERY = 25

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_REFUSED = 3
EXIT_PROVIDER = 4
EXIT_REAL_RUN_REFUSED = 5

PLAN_VERDICT_ENV = "ENFUSION_UIA_PLAN_VERDICT"
REDACT_ENV = "ENFUSION_UIA_REDACT"

# UIA_E_TIMEOUT and UIA_E_ELEMENTNOTAVAILABLE, as signed 32-bit HRESULTs.
HRESULT_KINDS = {-2146233083: "timeout", -2147220991: "element-not-available"}


class TargetError(Exception):
    """The target window could not be chosen safely; nothing was attached."""


class CallFailed(Exception):
    """One provider call raised; `kind` classifies it."""

    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


# ── Redaction ────────────────────────────────────────────────────────────────


def _spellings(path):
    trimmed = path.rstrip("\\/")
    if len(trimmed) < 2:
        return []
    back = trimmed.replace("/", "\\")
    fwd = trimmed.replace("\\", "/")
    return list(dict.fromkeys([trimmed, back, fwd]))


# Generic personal-data shapes (walk.ts GENERIC_SHAPES, same expressions).
_PLACEHOLDER_NAME = re.compile(
    r"^(?:<[^<>]*>|&lt|\{[^{}]*\}|%[^%]+%|\$env:[A-Za-z_]\w*|\$\{?[A-Za-z_]\w*\}?|~|\.{2,}|…|public|default)$",
    re.I,
)
_HOME_PATH_RE = re.compile(
    r"(?:\b[A-Za-z]:|(?<![\w./-])/[A-Za-z])[\\/]+users[\\/]+([^\\/\s\"'`|:*?,;()\[\]=]+)", re.I
)
_STEAM_ID_RE = re.compile(r"(?<!\d)7656\d{13}(?!\d)")
_EMAIL_RE = re.compile(r"(?<![\w.%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b")
_DOC_DOMAIN_RE = re.compile(r"(?:^|\.)(?:example\.(?:com|net|org)|example|invalid|test|localhost)$", re.I)


class Redactor:
    """Replace known roots, bare tokens and personal-data shapes in every string, counting what changed.

    Paths match in both slash styles, ignoring case, longest first, and only up
    to a path boundary (the same rule as toPlaceholders in scripts/live/paths.ts).
    Tokens (the account and machine names) match anywhere as substrings, ignoring
    case, so `<name>_old`, `<name>2`, `<name>PC` and URL-encoded paths are caught
    too; tokens shorter than three characters are ignored. Then the generic
    shapes (a home path of another account, a Steam64 id, an e-mail address
    outside the documentation domains) are replaced. A string that contains %XX escapes is
    also decoded and checked: when the decoded form needs redaction, the
    redacted decoded form replaces it.
    """

    def __init__(self, paths=(), tokens=()):
        table = {}
        for literal, placeholder in paths:
            if not literal:
                continue
            for s in _spellings(literal):
                table.setdefault(s.lower(), placeholder)
        self._paths = table
        alternatives = sorted(table, key=len, reverse=True)
        self._path_re = (
            re.compile("(?:" + "|".join(re.escape(a) for a in alternatives) + r")(?![\w-])", re.I)
            if alternatives
            else None
        )
        tok = {}
        for literal, placeholder in tokens:
            if literal and len(literal) >= 3:
                tok.setdefault(literal.lower(), placeholder)
        self._tokens = tok
        self._token_re = (
            re.compile("|".join(re.escape(t) for t in sorted(tok, key=len, reverse=True)), re.I) if tok else None
        )
        self.seen = 0
        self.redacted = 0
        self.used = set()

    def _path_sub(self, m):
        ph = self._paths[m.group(0).lower()]
        self.used.add(ph)
        return ph

    def _token_sub(self, m):
        ph = self._tokens[m.group(0).lower()]
        self.used.add(ph)
        return ph

    def _shape(self, rx, placeholder, s, keep=None):
        def sub(m):
            if keep is not None and keep(m):
                return m.group(0)
            self.used.add(placeholder)
            return placeholder

        return rx.sub(sub, s)

    def _apply(self, s):
        out = s
        if self._path_re is not None:
            out = self._path_re.sub(self._path_sub, out)
        if self._token_re is not None:
            out = self._token_re.sub(self._token_sub, out)
        out = self._shape(_HOME_PATH_RE, "<home-path>", out, lambda m: bool(_PLACEHOLDER_NAME.match(m.group(1))))
        out = self._shape(_STEAM_ID_RE, "<steam-id>", out)
        out = self._shape(_EMAIL_RE, "<email>", out, lambda m: bool(_DOC_DOMAIN_RE.search(m.group(1))))
        return out

    def __call__(self, s):
        if not isinstance(s, str) or not s:
            return s
        self.seen += 1
        out = self._apply(s)
        if "%" in out:
            decoded = urllib.parse.unquote(out)
            if decoded != out:
                again = self._apply(decoded)
                if again != decoded:
                    out = again
        if out != s:
            self.redacted += 1
        return out

    def report(self):
        return {
            "strings_seen": self.seen,
            "strings_redacted": self.redacted,
            "placeholders_used": sorted(self.used),
        }


def redactor_from_env(env):
    """Build the redactor from ENFUSION_UIA_REDACT (walk.ts) plus this process's own environment."""
    paths = []
    tokens = []
    raw = env.get(REDACT_ENV)
    if raw:
        extra = json.loads(raw)
        paths.extend((p[0], p[1]) for p in extra.get("paths", []))
        tokens.extend((t[0], t[1]) for t in extra.get("tokens", []))
    for var, placeholder in (
        ("LOCALAPPDATA", "%LOCALAPPDATA%"),
        ("APPDATA", "%APPDATA%"),
        ("USERPROFILE", "%USERPROFILE%"),
    ):
        if env.get(var):
            paths.append((env[var], placeholder))
    for var, placeholder in (("USERNAME", "<user>"), ("COMPUTERNAME", "<host>")):
        if env.get(var):
            tokens.append((env[var], placeholder))
    return Redactor(paths, tokens)


# ── Target selection ─────────────────────────────────────────────────────────


def select_window(windows, pid, class_name, title_pattern, allow_owned=False, hwnd=None):
    """Choose exactly one top-level window by pid, class and title pattern together.

    `windows` is a list of dicts {hwnd, pid, className, title, visible, owned, hung};
    a provider fills className and title only for windows of `pid`. Returns
    (window, report). Raises TargetError when the inputs cannot identify a window
    safely; returns (None, report) with report["reason"] when nothing or more than
    one window matches, or the match is not responding.
    """
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise TargetError("a positive process id is required (never the foreground window)")
    if not class_name:
        raise TargetError("a window class is required (never a search by title alone)")
    if not title_pattern:
        raise TargetError("a title pattern is required")
    try:
        rx = re.compile(title_pattern)
    except re.error as e:
        raise TargetError("the title pattern does not compile: %s" % e)

    matches = []
    refused = []
    for w in windows:
        entry = {"hwnd": w.get("hwnd")}
        if w.get("pid") != pid:
            entry["reason"] = "other process"
            refused.append(entry)
            continue
        entry["className"] = w.get("className")
        entry["title"] = w.get("title")
        if hwnd is not None and w.get("hwnd") != hwnd:
            entry["reason"] = "not the requested window handle"
        elif w.get("className") != class_name:
            entry["reason"] = "window class differs"
        elif not rx.fullmatch(w.get("title") or ""):
            entry["reason"] = "title does not match the pattern"
        elif not w.get("visible", True):
            entry["reason"] = "not visible"
        elif w.get("owned") and not allow_owned:
            entry["reason"] = "owned window (a dialog or popup)"
        else:
            matches.append(w)
            continue
        refused.append(entry)

    report = {
        "pid": pid,
        "className": class_name,
        "titlePattern": title_pattern,
        "windows_seen": len(windows),
        "windows_of_pid": sum(1 for w in windows if w.get("pid") == pid),
        "matches": len(matches),
        "refused": refused,
        "reason": None,
    }
    if not matches:
        report["reason"] = "no top-level window of pid %d has class %r and a title matching %r" % (
            pid,
            class_name,
            title_pattern,
        )
        return None, report
    if len(matches) > 1:
        report["reason"] = "%d windows match; refusing to choose between them" % len(matches)
        report["ambiguous"] = [{"hwnd": w.get("hwnd"), "title": w.get("title")} for w in matches]
        return None, report
    chosen = matches[0]
    if chosen.get("hung"):
        report["reason"] = "the window is not responding (IsHungAppWindow); not attaching"
        return None, report
    return chosen, report


# ── Walk ─────────────────────────────────────────────────────────────────────


def classify_error(e):
    hresult = getattr(e, "hresult", None)
    if hresult is None and getattr(e, "args", None) and isinstance(e.args[0], int):
        hresult = e.args[0]
    if isinstance(hresult, int):
        signed = hresult - (1 << 32) if hresult >= (1 << 31) else hresult
        if signed in HRESULT_KINDS:
            return HRESULT_KINDS[signed]
        return "hresult 0x%08X" % (signed & 0xFFFFFFFF)
    name = type(e).__name__
    if "timeout" in name.lower():
        return "timeout"
    return name


def _clean_rect(v):
    if not isinstance(v, (list, tuple)) or len(v) != 4:
        return None
    out = []
    for x in v:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
            return None
        out.append(int(round(x)))
    return out


def _clean_bool(v):
    return v if isinstance(v, bool) else None


def _clean_int(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _percentile(sorted_values, q):
    if not sorted_values:
        return None
    i = min(len(sorted_values) - 1, max(0, int(math.ceil(q * len(sorted_values))) - 1))
    return round(sorted_values[i], 3)


class Walk:
    def __init__(self, provider, bounds, redact, clock=time.perf_counter, hung_check=None):
        self.p = provider
        self.b = bounds
        self.redact = redact
        self.clock = clock
        self.t0 = clock()
        self.stop_reason = None
        # IsHungAppWindow of the target, sampled every HUNG_SAMPLE_EVERY calls (it
        # sends the window no message); a hung window stops the walk.
        self.hung_check = hung_check
        self.hung_samples = 0
        self.hung_true = 0
        self.calls_at_last_sample = 0
        self.child_errors = 0
        self.nodes = 0
        self.by_type = {}
        self.by_pattern = {}
        self.with_id = 0
        self.with_name = 0
        self.with_both = 0
        self.max_depth_seen = 0
        self.depth_truncated = 0
        self.read_errors = 0
        self.sampling = []
        self.durations = []
        self.errors = 0
        self.timeouts = 0
        self.error_kinds = {}
        self.consecutive_errors = 0

    def elapsed_ms(self):
        return (self.clock() - self.t0) * 1000.0

    def over_budget(self):
        return self.elapsed_ms() >= self.b["budget_ms"]

    def call(self, fn, *args):
        t = self.clock()
        try:
            result = fn(*args)
        except Exception as e:  # any provider failure is data, not a crash
            self.durations.append((self.clock() - t) * 1000.0)
            kind = classify_error(e)
            self.errors += 1
            self.error_kinds[kind] = self.error_kinds.get(kind, 0) + 1
            if kind == "timeout":
                # Plan 5.3 "During": on any timeout, do not retry. The walk makes
                # no further call into the GUI after the first one.
                self.timeouts += 1
                if self.stop_reason is None:
                    self.stop_reason = "timeout"
            self.consecutive_errors += 1
            if self.consecutive_errors >= self.b["max_consecutive_errors"] and self.stop_reason is None:
                self.stop_reason = "unresponsive"
            raise CallFailed(kind)
        self.durations.append((self.clock() - t) * 1000.0)
        return result

    def sample_hung(self, force=False):
        """Read IsHungAppWindow when HUNG_SAMPLE_EVERY calls passed (or `force`); True when hung."""
        if self.hung_check is None:
            return False
        if not force and len(self.durations) - self.calls_at_last_sample < HUNG_SAMPLE_EVERY:
            return False
        self.calls_at_last_sample = len(self.durations)
        self.hung_samples += 1
        try:
            hung = bool(self.hung_check())
        except Exception:
            return False
        if hung:
            self.hung_true += 1
            if self.stop_reason is None:
                self.stop_reason = "hung"
        return hung

    def check_stop(self):
        if self.stop_reason is None:
            if self.nodes >= self.b["max_nodes"]:
                self.stop_reason = "max-nodes"
            elif self.over_budget():
                self.stop_reason = "budget"
            else:
                self.sample_hung()
        return self.stop_reason is not None

    def shape(self, props):
        r = self.redact
        node = {
            "controlType": props.get("controlType") if isinstance(props.get("controlType"), str) else "",
            "name": r(props.get("name")) if isinstance(props.get("name"), str) else "",
            "automationId": r(props.get("automationId")) if isinstance(props.get("automationId"), str) else "",
            "className": r(props.get("className")) if isinstance(props.get("className"), str) else "",
            "rect": _clean_rect(props.get("rect")),
            "enabled": _clean_bool(props.get("enabled")),
            "offscreen": _clean_bool(props.get("offscreen")),
            "patterns": [p for p in (props.get("patterns") or []) if p in PATTERN_NAMES],
        }
        for field in OPTIONAL_STRING_FIELDS:
            v = props.get(field)
            if isinstance(v, str) and v:
                node[field] = r(v)
        for field in ("gridRowCount", "gridColumnCount"):
            v = _clean_int(props.get(field))
            if v is not None:
                node[field] = v
        return node

    def count(self, node, depth):
        t = node["controlType"] or "(none)"
        self.by_type[t] = self.by_type.get(t, 0) + 1
        for p in node["patterns"]:
            self.by_pattern[p] = self.by_pattern.get(p, 0) + 1
        has_id = bool(node["automationId"])
        has_name = bool(node["name"])
        self.with_id += has_id
        self.with_name += has_name
        self.with_both += has_id and has_name
        self.max_depth_seen = max(self.max_depth_seen, depth)

    def node(self, el, depth, path):
        """Read `el` and its children within the bounds. None when the walk stopped first."""
        if self.check_stop():
            return None
        try:
            props = self.call(self.p.read, el)
        except CallFailed as e:
            self.nodes += 1
            self.read_errors += 1
            return {"controlType": "", "path": path, "error": e.kind}
        # Only a successful read resets the failure run: a provider that still
        # navigates but times out on every read is unresponsive all the same.
        self.consecutive_errors = 0
        node = self.shape(props)
        self.nodes += 1
        self.count(node, depth)

        if depth >= self.b["max_depth"]:
            try:
                has_child = self.call(self.p.first_child, el) is not None
            except CallFailed as e:
                node["childError"] = e.kind
                self.child_errors += 1
                return node
            if has_child:
                node["truncated"] = "depth"
                self.depth_truncated += 1
            else:
                node["childCount"] = 0
            return node

        ctype = node["controlType"]
        is_data = ctype in DATA_CONTAINER_TYPES or ctype in DATA_ROW_TYPES or bool(DATA_PATTERNS.intersection(node["patterns"]))
        limit = self.b["row_sample"] if is_data else self.b["max_children"]
        rule = "data-container" if is_data else "fanout"

        children = []
        node["children"] = children
        try:
            child = self.call(self.p.first_child, el)
        except CallFailed as e:
            node["childError"] = e.kind
            self.child_errors += 1
            return node
        walked = 0
        while child is not None and walked < limit:
            sub = self.node(child, depth + 1, "%s/%d" % (path, walked))
            if sub is None:
                break
            children.append(sub)
            walked += 1
            if self.stop_reason is not None:
                # The walk stopped while reading this child (a timeout, a hung
                # window, or too many failures): no further call, not even to
                # the next sibling.
                node["truncated"] = self.stop_reason
                node["childCountAtLeast"] = walked
                return node
            try:
                child = self.call(self.p.next_sibling, child)
            except CallFailed as e:
                node["childError"] = e.kind
                node["childCountAtLeast"] = walked
                self.child_errors += 1
                return node

        if child is None:
            node["childCount"] = walked
            return node
        if self.stop_reason is not None:
            node["truncated"] = self.stop_reason
            node["childCountAtLeast"] = walked + 1
            return node

        # More siblings than the limit: count them by navigation only, no reads.
        total = walked + 1
        cur = child
        stopped = None
        while True:
            if total >= self.b["count_cap"]:
                stopped = "cap"
                break
            if self.over_budget():
                stopped = "budget"
                break
            if self.stop_reason is not None or self.sample_hung():
                stopped = self.stop_reason
                break
            try:
                cur = self.call(self.p.next_sibling_bare, cur)
            except CallFailed:
                stopped = "error"
                break
            if cur is None:
                break
            total += 1
        if stopped is None:
            node["childCount"] = total
        else:
            node["childCountAtLeast"] = total
        node["sampled"] = {"kept": walked, "rule": rule}
        entry = {"path": path, "controlType": ctype, "rule": rule, "kept": walked}
        entry["childCount" if stopped is None else "childCountAtLeast"] = total
        entry["countStopped"] = stopped
        if "gridRowCount" in node:
            entry["gridRowCount"] = node["gridRowCount"]
        self.sampling.append(entry)
        return node

    def call_stats(self):
        d = sorted(self.durations)
        return {
            "count": len(d),
            "total_ms": round(sum(d), 3),
            "max_ms": round(d[-1], 3) if d else None,
            "p50_ms": _percentile(d, 0.5),
            "p95_ms": _percentile(d, 0.95),
            "slow_threshold_ms": self.b["slow_call_ms"],
            "slow_calls": sum(1 for x in d if x >= self.b["slow_call_ms"]),
            "errors": self.errors,
            "timeouts": self.timeouts,
            "error_kinds": self.error_kinds,
        }


def _iter_nodes(node, ancestors=()):
    yield node, ancestors
    for c in node.get("children", []):
        yield from _iter_nodes(c, ancestors + (node.get("controlType", ""),))


def summarize_u7(tree):
    """The facts the U7 verdict reads, computed from the redacted tree."""
    frameworks = {}
    class_names = {}
    menu_bars = menu_items = under_bar = tool_bars = toolbar_buttons = 0
    menu_names = []
    ids = {"non_empty": 0, "dotted": 0, "slashed": 0, "examples": []}
    accel = legacy_sc = help_texts = 0
    data_containers = []
    for node, anc in _iter_nodes(tree):
        t = node.get("controlType", "")
        fw = node.get("frameworkId")
        if fw:
            frameworks[fw] = frameworks.get(fw, 0) + 1
        cn = node.get("className")
        if cn:
            class_names[cn] = class_names.get(cn, 0) + 1
        if t == "MenuBar":
            menu_bars += 1
        elif t == "MenuItem":
            menu_items += 1
            if "MenuBar" in anc:
                under_bar += 1
            if node.get("name") and len(menu_names) < SUMMARY_EXAMPLES:
                menu_names.append(node["name"])
        elif t == "ToolBar":
            tool_bars += 1
        elif t == "Button" and "ToolBar" in anc:
            toolbar_buttons += 1
        aid = node.get("automationId")
        if aid:
            ids["non_empty"] += 1
            ids["dotted"] += "." in aid
            ids["slashed"] += "/" in aid
            if aid not in ids["examples"] and len(ids["examples"]) < SUMMARY_EXAMPLES:
                ids["examples"].append(aid)
        accel += bool(node.get("acceleratorKey"))
        legacy_sc += bool(node.get("legacyShortcut"))
        help_texts += bool(node.get("helpText"))
        if t in DATA_CONTAINER_TYPES or DATA_PATTERNS.intersection(node.get("patterns", [])):
            entry = {"controlType": t, "name": node.get("name", ""), "automationId": aid or ""}
            for k in ("childCount", "childCountAtLeast", "gridRowCount", "gridColumnCount"):
                if k in node:
                    entry[k] = node[k]
            data_containers.append(entry)
    top_classes = sorted(class_names.items(), key=lambda kv: (-kv[1], kv[0]))[:SUMMARY_EXAMPLES]
    return {
        "framework_ids": frameworks,
        "class_names_top": dict(top_classes),
        "menu_bars": menu_bars,
        "menu_items": menu_items,
        "menu_items_under_menu_bar": under_bar,
        "menu_item_names": menu_names,
        "tool_bars": tool_bars,
        "toolbar_buttons": toolbar_buttons,
        "automation_ids": ids,
        "with_accelerator_key": accel,
        "with_legacy_shortcut": legacy_sc,
        "with_help_text": help_texts,
        "data_containers": data_containers[:SUMMARY_EXAMPLES],
        "data_containers_total": len(data_containers),
    }


def _redact_window(w, redact):
    out = dict(w)
    for k in ("className", "title"):
        if isinstance(out.get(k), str):
            out[k] = redact(out[k])
    return out


def _redact_report(report, redact):
    out = dict(report)
    out["refused"] = [_redact_window(r, redact) for r in report.get("refused", [])]
    if "ambiguous" in report:
        out["ambiguous"] = [_redact_window(r, redact) for r in report["ambiguous"]]
    for k in ("className", "titlePattern"):
        if isinstance(out.get(k), str):
            out[k] = redact(out[k])
    return out


def run_walk(provider, pid, class_name, title_pattern, bounds, redact, view="raw", allow_owned=False, hwnd=None):
    """Select, attach, verify and walk. Returns (exit code, document)."""
    started = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    t0 = time.perf_counter()
    doc = {"schema": SCHEMA, "provider": provider.name, "view": view, "started_at": started, "bounds": bounds}
    windows = provider.windows(pid)
    window, report = select_window(windows, pid, class_name, title_pattern, allow_owned, hwnd)
    if window is None:
        doc["refused"] = True
        doc["reason"] = redact(report["reason"])
        doc["target"] = {"selection": _redact_report(report, redact)}
        doc["redaction"] = redact.report()
        return EXIT_REFUSED, doc

    t_attach = time.perf_counter()
    try:
        root = provider.attach(window)
        identity = provider.identity(root)
    except Exception as e:
        unavailable = bool(getattr(e, "provider_unavailable", False))
        doc["refused"] = True
        doc["reason"] = ("provider unavailable: %s" % e) if unavailable else ("attach failed: %s" % classify_error(e))
        doc["reason"] = redact(doc["reason"])
        doc["target"] = {"selection": _redact_report(report, redact)}
        doc["provider_info"] = provider.info()
        doc["redaction"] = redact.report()
        return (EXIT_PROVIDER if unavailable else EXIT_REFUSED), doc
    attach_ms = (time.perf_counter() - t_attach) * 1000.0
    # Identity is the process id and the native window handle. The element's UIA
    # ClassName is NOT compared with --class: --class is the Win32 window class
    # (GetClassNameW), and Qt's UIA provider answers ClassName with its own value
    # (the widget's meta-class name [unverified]), which overrides the HWND host's.
    mismatch = [k for k, want in (("pid", pid), ("hwnd", window.get("hwnd"))) if identity.get(k) != want]
    if mismatch:
        doc["refused"] = True
        doc["reason"] = "the attached element is not the chosen window (%s differ)" % ", ".join(mismatch)
        doc["target"] = {"selection": _redact_report(report, redact)}
        doc["redaction"] = redact.report()
        return EXIT_REFUSED, doc

    hung_check = (lambda: provider.hung(window.get("hwnd"))) if hasattr(provider, "hung") else None
    w = Walk(provider, bounds, redact, hung_check=hung_check)
    tree = w.node(root, 0, "0")
    if tree is None:
        tree = {"controlType": "", "truncated": w.stop_reason}
    w.sample_hung(force=True)
    uia_class = identity.get("className")
    doc["target"] = {
        "pid": pid,
        "hwnd": window.get("hwnd"),
        "className": redact(class_name),
        "uiaClassName": redact(uia_class) if isinstance(uia_class, str) else None,
        "title": redact(window.get("title") or ""),
        "titlePattern": redact(title_pattern),
        "selection": _redact_report(report, redact),
    }
    doc["attach_ms"] = round(attach_ms, 3)
    doc["walk_ms"] = round(w.elapsed_ms(), 3)
    doc["elapsed_ms"] = round((time.perf_counter() - t0) * 1000.0, 3)
    # Completed means: no stop, and every call answered. A walk with any failed
    # call is partial evidence and cannot support U7's no branch on its own.
    doc["completed"] = w.stop_reason is None and w.errors == 0
    doc["partial"] = w.child_errors > 0 or w.read_errors > 0
    doc["stop_reason"] = w.stop_reason
    doc["counts"] = {
        "nodes": w.nodes,
        "by_control_type": dict(sorted(w.by_type.items())),
        "with_automation_id": w.with_id,
        "with_name": w.with_name,
        "with_automation_id_and_name": w.with_both,
        "max_depth_seen": w.max_depth_seen,
        "depth_truncated": w.depth_truncated,
        "read_errors": w.read_errors,
        "child_errors": w.child_errors,
    }
    doc["hung"] = {
        "sample_every_calls": HUNG_SAMPLE_EVERY,
        "samples": w.hung_samples,
        "true": w.hung_true,
    }
    doc["patterns"] = dict(sorted(w.by_pattern.items()))
    doc["sampling"] = {
        "containers_sampled": len(w.sampling),
        "rows_not_read_at_least": sum(
            e.get("childCount", e.get("childCountAtLeast", 0)) - e["kept"] for e in w.sampling
        ),
        "applied": w.sampling,
    }
    doc["uia_calls"] = w.call_stats()
    doc["provider_info"] = provider.info()
    doc["u7"] = summarize_u7(tree)
    doc["redaction"] = redact.report()
    doc["tree"] = tree
    return EXIT_OK, doc


# ── CLI ──────────────────────────────────────────────────────────────────────


def _bounds_from_args(a):
    b = {}
    for k, default in DEFAULT_BOUNDS.items():
        v = getattr(a, k)
        v = default if v is None else v
        if v <= 0 or v > BOUND_CAPS[k]:
            raise ValueError("--%s must be between 1 and %d" % (k.replace("_", "-"), BOUND_CAPS[k]))
        b[k] = v
    return b


def build_parser():
    ap = argparse.ArgumentParser(description="Passive UI Automation walker (U7).")
    ap.add_argument("--provider", choices=("fake", "uia"))
    ap.add_argument("--fake-tree", help="fake provider: JSON window list with trees")
    ap.add_argument("--pid", type=int)
    ap.add_argument("--class", dest="class_name")
    ap.add_argument("--title-pattern")
    ap.add_argument("--hwnd", type=int, help="optional: the window handle must also be this one")
    ap.add_argument("--allow-owned", action="store_true")
    ap.add_argument("--view", choices=("raw", "control"), default="raw")
    ap.add_argument("--list-windows", action="store_true", help="list the pid's top-level windows; no UIA")
    ap.add_argument("--print-defaults", action="store_true")
    ap.add_argument("--really", action="store_true")
    for k in DEFAULT_BOUNDS:
        ap.add_argument("--" + k.replace("_", "-"), dest=k, type=int)
    return ap


def _emit(doc):
    sys.stdout.write(json.dumps(doc, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main(argv, env=None):
    env = os.environ if env is None else env
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = build_parser()
    try:
        a = ap.parse_args(argv)
    except SystemExit:
        return EXIT_USAGE
    if a.print_defaults:
        _emit({"defaults": DEFAULT_BOUNDS, "caps": BOUND_CAPS})
        return EXIT_OK
    if a.provider is None or a.pid is None:
        sys.stderr.write("--provider and --pid are required\n")
        return EXIT_USAGE
    try:
        bounds = _bounds_from_args(a)
    except ValueError as e:
        sys.stderr.write("%s\n" % e)
        return EXIT_USAGE
    if not a.list_windows and (not a.class_name or not a.title_pattern):
        sys.stderr.write("--class and --title-pattern are required (never the foreground window, never title alone)\n")
        return EXIT_USAGE
    try:
        redact = redactor_from_env(env)
    except (ValueError, TypeError, IndexError) as e:
        sys.stderr.write("%s is not valid JSON of the expected shape: %s\n" % (REDACT_ENV, e))
        return EXIT_USAGE

    if a.provider == "fake":
        if not a.fake_tree:
            sys.stderr.write("--fake-tree is required with --provider fake\n")
            return EXIT_USAGE
        from fake_provider import FakeProvider

        with open(a.fake_tree, encoding="utf-8") as f:
            provider = FakeProvider(json.load(f))
    else:
        # The real provider: refuse before importing anything that talks to UI Automation.
        if sys.platform != "win32":
            sys.stderr.write("refused: the uia provider is Windows-only\n")
            return EXIT_REAL_RUN_REFUSED
        if not a.really:
            sys.stderr.write("refused: a real walk needs --really (normally passed by tools/uia/walk.ts)\n")
            return EXIT_REAL_RUN_REFUSED
        if env.get(PLAN_VERDICT_ENV) != "PASS":
            sys.stderr.write(
                "refused: %s is not PASS; run through tools/uia/walk.ts, which checks the action plan first\n"
                % PLAN_VERDICT_ENV
            )
            return EXIT_REAL_RUN_REFUSED
        try:
            from uia_com import ComUiaProvider

            provider = ComUiaProvider(PATTERN_NAMES, view=a.view, call_timeout_ms=bounds["call_timeout_ms"])
        except Exception as e:
            sys.stderr.write("provider unavailable: %s\n" % e)
            return EXIT_PROVIDER

    if a.list_windows:
        windows = [_redact_window(w, redact) for w in provider.windows(a.pid) if w.get("pid") == a.pid]
        _emit({"schema": SCHEMA, "provider": provider.name, "pid": a.pid, "windows": windows, "redaction": redact.report()})
        return EXIT_OK

    try:
        code, doc = run_walk(
            provider, a.pid, a.class_name, a.title_pattern, bounds, redact, a.view, a.allow_owned, a.hwnd
        )
    except TargetError as e:
        sys.stderr.write("refused: %s\n" % e)
        return EXIT_USAGE
    _emit(doc)
    return code


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main(sys.argv[1:]))
