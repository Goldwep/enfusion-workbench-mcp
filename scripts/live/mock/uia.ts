/**
 * Scripted fake of the accessibility layer for the dry-run gate and tests.
 *
 * The tree is plain nested nodes with the three properties a UI Automation
 * element is located by here: `controlType`, `name` and `automationId`
 * (plus an optional `className` for top-level windows). Trees in tests are
 * synthetic; the real Workbench tree, its control types and its window
 * classes are captured live in Phase 4 and are [unverified] until then.
 *
 * Path lookup walks one label per step and searches all descendants of the
 * current node for the first match, so unnamed intermediate containers (a
 * menu bar, a pane) need not be spelled out.
 */

export interface UiaNode {
  controlType: string;
  name: string;
  automationId?: string;
  /** Win32 window class; meaningful for top-level windows. */
  className?: string;
  children?: UiaNode[];
}

/**
 * Normalise a UI label for comparison: drop the `&` mnemonic marker, a
 * trailing ellipsis, an accelerator suffix after a tab, collapse whitespace,
 * and ignore case.
 */
export function normalizeLabel(label: string): string {
  return label
    .split("\t")[0]
    .replace(/&(.)/g, "$1")
    .replace(/(\.\.\.|…)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True for a menu leaf: a MenuItem without children (invoking it runs a command). */
export function isMenuLeaf(node: UiaNode): boolean {
  return node.controlType === "MenuItem" && (node.children?.length ?? 0) === 0;
}

function findDescendant(from: UiaNode, pred: (n: UiaNode) => boolean): UiaNode | null {
  const queue: UiaNode[] = [...(from.children ?? [])];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (pred(n)) return n;
    queue.push(...(n.children ?? []));
  }
  return null;
}

export class MockUia {
  constructor(readonly root: UiaNode) {}

  /** Top-level windows (direct children of the root with controlType "Window"). */
  windows(): UiaNode[] {
    return (this.root.children ?? []).filter((n) => n.controlType === "Window");
  }

  /** A top-level window by exact title and/or class name. */
  findWindow(match: { title?: string; className?: string }): UiaNode | null {
    return (
      this.windows().find(
        (w) =>
          (match.title === undefined || w.name === match.title) &&
          (match.className === undefined || w.className === match.className),
      ) ?? null
    );
  }

  /** Resolve a label path under `from` (default: the root). Null when any step is missing. */
  findByPath(path: string[], from: UiaNode = this.root): UiaNode | null {
    let cur: UiaNode | null = from;
    for (const step of path) {
      const want = normalizeLabel(step);
      cur = findDescendant(cur, (n) => normalizeLabel(n.name) === want);
      if (!cur) return null;
    }
    return cur;
  }

  /** First node with the given automation id. */
  findByAutomationId(id: string, from: UiaNode = this.root): UiaNode | null {
    return findDescendant(from, (n) => n.automationId === id);
  }
}
