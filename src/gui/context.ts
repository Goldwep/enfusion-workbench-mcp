/**
 * The passive context-menu read (W8 spec 2.1 `context`), a port of the `--passive` route of
 * tools/uia/context.ts and tools/uia/context.py (`run_passive`, the sf-15 route, commit 5072d58).
 *
 * It sends NOTHING: no ShowContextMenu, no Collapse, no key, no click. It reads a context menu
 * that is ALREADY open (the hand right-clicked a target): the pid's windows are listed once, the
 * one popup of the Qt popup class (`QWindowPopup` in the class, unowned, visible:
 * context.py `is_popup_window`) is read through src/gui/uia.ts `snapshot` in the raw view
 * (PASSIVE_READ_BOUNDS), and its items are read as menus.py `popup_children` / `read_items` read
 * them: the children of the popup root, descending one level into each unnamed `Menu` child.
 * A sub-menu is never expanded; the popup is left open for the hand's Esc.
 *
 * Differences from the Python route, recorded: there is no wait for the popup (the tool answers
 * at once; no popup is a refusal, not a timeout), and `submenu` is read from the ExpandCollapse
 * pattern's availability only (the managed snapshot reads no expand state).
 */

import { AUTH_WINDOW_TITLE } from "./modal-watchdog.js";
import {
  POPUP_CLASS_MARK,
  listWindows,
  redactText,
  snapshot,
  type UiaDeps,
  type UiaNode,
  type WindowInfo,
} from "./uia.js";

/** A menu is one level deep (sf-15: 19 nodes, depth 1); tools/uia/context.ts PASSIVE_READ_BOUNDS. */
export const PASSIVE_READ_BOUNDS = { maxDepth: 4, maxNodes: 500, budgetMs: 15_000 } as const;
/** menus.py `max_items` default of context.py. */
export const MAX_ITEMS = 200;

/** context.py `is_popup_window`: the popup itself, unowned, of the Qt popup class, visible. */
export function isContextPopup(w: Pick<WindowInfo, "className" | "owned" | "visible">): boolean {
  return (w.className ?? "").includes(POPUP_CLASS_MARK) && !w.owned && w.visible;
}

export interface ContextMenuItem {
  controlType: string;
  name: string;
  automationId: string | null;
  enabled: boolean | null;
  acceleratorKey: string | null;
  /** The item offers ExpandCollapse (a sub-menu); never expanded here. */
  submenu: boolean;
}

/** menus.py `popup_children` + `read_items` over a snapshot of the popup. */
export function readMenuItems(
  root: UiaNode,
  maxItems: number = MAX_ITEMS,
): { items: ContextMenuItem[]; menus: number; truncated: boolean } {
  const elements: UiaNode[] = [];
  let menus = 0;
  for (const c of root.children ?? []) {
    if (c.controlType === "Menu") {
      menus++;
      elements.push(...(c.children ?? []));
    } else {
      elements.push(c);
    }
  }
  const items = elements.slice(0, maxItems).map((n) => ({
    controlType: n.controlType,
    name: redactText(n.name ?? ""),
    automationId: n.automationId ? redactText(n.automationId) : null,
    enabled: n.enabled,
    acceleratorKey: n.acceleratorKey ? redactText(n.acceleratorKey) : null,
    submenu: (n.patterns ?? []).includes("ExpandCollapse"),
  }));
  return { items, menus, truncated: elements.length > maxItems };
}

export type ContextRefusal = "none" | "several" | "auth" | "list" | "read";

export interface ContextRead {
  ok: boolean;
  refusal: ContextRefusal | null;
  reason: string | null;
  popup: { hwnd: number; className: string; title: string; controlType: string } | null;
  items: ContextMenuItem[];
  menus: number;
  truncated: boolean;
}

function refuse(refusal: ContextRefusal, reason: string): ContextRead {
  return { ok: false, refusal, reason, popup: null, items: [], menus: 0, truncated: false };
}

/** Read the one context menu of the pid that is open now. Sends nothing. */
export async function readOpenContextMenu(pid: number, deps: UiaDeps = {}): Promise<ContextRead> {
  const listed = await listWindows(pid, deps);
  if (!listed.ok) return refuse("list", listed.error ?? "the window list failed");
  const mine = listed.windows.filter((w) => w.pid === pid && w.visible);
  if (mine.some((w) => w.title === AUTH_WINDOW_TITLE)) {
    return refuse(
      "auth",
      `a "${AUTH_WINDOW_TITLE}" window is open; nothing is read while it is (the owner answers it)`,
    );
  }
  const pops = mine.filter(isContextPopup);
  if (pops.length === 0) {
    return refuse("none", "no context menu of the pid is open (nothing was sent)");
  }
  if (pops.length > 1) {
    return refuse(
      "several",
      `${pops.length} popup windows are open (a sub-menu?); refusing to choose; the hand presses Esc until one is left`,
    );
  }
  const popup = pops[0];
  const snap = await snapshot(
    { pid, hwnd: popup.hwnd },
    { bounds: PASSIVE_READ_BOUNDS, view: "raw" },
    deps,
  );
  if (!snap.ok || !snap.tree) return refuse("read", snap.reason ?? "the popup read failed");
  const { items, menus, truncated } = readMenuItems(snap.tree);
  return {
    ok: true,
    refusal: null,
    reason: null,
    popup: {
      hwnd: popup.hwnd,
      className: redactText(popup.className),
      title: redactText(popup.title),
      controlType: snap.tree.controlType,
    },
    items,
    menus,
    truncated,
  };
}
