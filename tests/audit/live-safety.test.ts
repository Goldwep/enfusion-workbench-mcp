import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MECHANISMS,
  auditDenyLabels,
  auditMechanisms,
  denyLabels,
  hasTestName,
  renderMarkdown,
  run,
  type FileReader,
  type Mechanism,
} from "../../scripts/audit/live-safety.js";

const memReader = (files: Record<string, string>): FileReader => ({
  exists: (rel) => rel in files,
  read: (rel) => {
    if (!(rel in files)) throw new Error(`ENOENT ${rel}`);
    return files[rel]!;
  },
});

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
};

/** The eight items PLAN section 11 criterion 8 names, by mechanism id. */
const C8 = [
  "client-queue",
  "lease",
  "modal-watchdog",
  "build-stamp",
  "opened-project",
  "deny-lists",
  "runcommandline-ban",
  "sandbox-only",
];

describe("live-safety audit on the tree", () => {
  it("pairs every mechanism with a negative test, and every reference resolves", () => {
    const results = auditMechanisms(MECHANISMS);
    const notPaired = results
      .filter((r) => r.status !== "PAIRED")
      .map((r) => ({
        id: r.m.id,
        status: r.status,
        missing: [...r.impl, ...r.positive, ...r.negative].filter((x) => !x.found),
      }));
    expect(notPaired).toEqual([]);
  });

  it("covers each criterion 8 item with at least one executed (not static) negative test", () => {
    const byId = new Map(MECHANISMS.map((m) => [m.id, m]));
    for (const id of C8) {
      const m = byId.get(id);
      expect(m, id).toBeDefined();
      expect(m!.source, id).toMatch(/\bC8\b/);
      expect(m!.negative.filter((t) => t.kind !== "static").length, id).toBeGreaterThan(0);
    }
  });

  it("mechanism ids are unique and no test is listed twice under one mechanism", () => {
    const ids = MECHANISMS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MECHANISMS) {
      const keys = [...m.positive, ...m.negative].map((t) => `${t.file}::${t.name}`);
      expect(new Set(keys).size, m.id).toBe(keys.length);
    }
  });

  it("the CLI exits 0 on the tree with --no-ledger and prints one line per mechanism", () => {
    const c = capture();
    expect(run(["--no-ledger"], c.io)).toBe(0);
    const text = c.out.join("\n");
    for (const m of MECHANISMS) expect(text).toContain(`[PAIRED] ${m.id}:`);
    expect(text).toMatch(new RegExp(`${MECHANISMS.length} mechanisms: ${MECHANISMS.length} paired, 0 not`));
  });
});

describe("live-safety audit refuses an unpaired mechanism", () => {
  const base: Mechanism = {
    id: "planted",
    name: "planted",
    source: "test",
    impl: [{ file: "src/a.ts", marker: "guard()" }],
    positive: [{ file: "tests/a.test.ts", name: "passes" }],
    negative: [{ file: "tests/a.test.ts", name: "refuses" }],
  };
  const files = {
    "src/a.ts": "export function guard() {}",
    "tests/a.test.ts": 'it("passes", () => {}); it(\'refuses\', () => {});',
  };

  it("PAIRED when the impl marker and both tests resolve", () => {
    expect(auditMechanisms([base], memReader(files))[0]!.status).toBe("PAIRED");
  });

  it("NO-NEGATIVE when the mechanism lists no negative test", () => {
    const r = auditMechanisms([{ ...base, negative: [] }], memReader(files))[0]!;
    expect(r.status).toBe("NO-NEGATIVE");
  });

  it("NO-NEGATIVE when every listed negative test is gone from its file", () => {
    const r = auditMechanisms(
      [{ ...base, negative: [{ file: "tests/a.test.ts", name: "was renamed" }] }],
      memReader(files),
    )[0]!;
    expect(r.status).toBe("NO-NEGATIVE");
    expect(r.negative[0]).toMatchObject({ found: false, why: "test name not in file" });
  });

  it("BROKEN-REF on a missing file or a missing impl marker, though a negative resolves", () => {
    for (const m of [
      { ...base, positive: [{ file: "tests/gone.test.ts", name: "passes" }] },
      { ...base, impl: [{ file: "src/a.ts", marker: "removedGuard(" }] },
    ]) {
      expect(auditMechanisms([m], memReader(files))[0]!.status).toBe("BROKEN-REF");
    }
  });

  it("the CLI exits 1 on a tree where the referenced tests are absent", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-audit-empty-"));
    try {
      const c = capture();
      expect(run(["--no-ledger"], c.io, root)).toBe(1);
      expect(c.out.join("\n")).toMatch(/\[NO-NEGATIVE\] client-queue/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the CLI exits 2 on an unknown switch", () => {
    const c = capture();
    expect(run(["--bogus"], c.io)).toBe(2);
    expect(c.err.join("")).toMatch(/usage/);
  });

  it("matches a test name in any quote form, never a bare substring", () => {
    expect(hasTestName('it("a b", () => {})', "a b")).toBe(true);
    expect(hasTestName("it('a b', () => {})", "a b")).toBe(true);
    expect(hasTestName("it(`a b`, () => {})", "a b")).toBe(true);
    expect(hasTestName('it("a b c", () => {})', "a b")).toBe(false);
  });
});

describe("deny labels against the census", () => {
  const policy = {
    deny_lists: {
      openers: { labels: ["New World", "Create Terrain"] },
      commit: { labels: ["Login:confirm"], cli_switches: ["-x"] },
      apis: { api: ["RunCommandline"] },
    },
  };

  it("reads the labels of every list and skips lists without labels", () => {
    expect(denyLabels(policy)).toEqual([
      { list: "openers", label: "New World" },
      { list: "openers", label: "Create Terrain" },
      { list: "commit", label: "Login:confirm" },
    ]);
  });

  it("counts a label verified only when a live enumerator saw a ui row of it", () => {
    const ledger = [
      JSON.stringify({ id: "ui:WE/menu-item/File/New World", dim: "ui", label: "New World", sources: [{ enumerator: "L02" }] }),
      JSON.stringify({ id: "ui:RM/dialog/Login", dim: "ui", kind: "dialog", label: "Login", sources: [{ enumerator: "E07" }] }),
      JSON.stringify({ id: "ui:RM/control/Login/Login", dim: "ui", kind: "control", parent: "ui:RM/dialog/Login", label: "Login", sources: [{ enumerator: "E07" }] }),
      JSON.stringify({ id: "api:Create Terrain", dim: "api", label: "Create Terrain", sources: [{ enumerator: "L02" }] }),
      "not json",
    ];
    expect(auditDenyLabels(policy, ledger)).toEqual([
      { list: "openers", label: "New World", rows: 1, liveRows: 1 },
      { list: "openers", label: "Create Terrain", rows: 0, liveRows: 0 },
      { list: "commit", label: "Login:confirm", rows: 1, liveRows: 0 },
    ]);
  });

  it("matches X:confirm on the confirm control of dialog X, loosely, and never on the opener", () => {
    const p = {
      deny_lists: {
        c: { labels: ["Create World:confirm", "Pack Project:confirm", "Publish:confirm", "Save As:confirm"] },
      },
    };
    const live = [{ enumerator: "L04" }];
    const ledger = [
      // "Create world" dialog (other case) with a live OK control.
      JSON.stringify({ id: "ui:WE/dialog/cw", dim: "ui", kind: "dialog", label: "Create world", sources: [{ enumerator: "E01" }] }),
      JSON.stringify({ id: "ui:WE/control/cw/OK", dim: "ui", kind: "control", parent: "ui:WE/dialog/cw", label: "OK", sources: live }),
      JSON.stringify({ id: "ui:WE/control/cw/Cancel", dim: "ui", kind: "control", parent: "ui:WE/dialog/cw", label: "Cancel", sources: live }),
      // Only the opener of Pack Project, live: it must not count for the :confirm entry.
      JSON.stringify({ id: "ui:WE/menu-item/Pack Project", dim: "ui", kind: "menu-item", label: "Pack Project", sources: live }),
      // "Publish Project" dialog stands in for "Publish" (prefix match), static only.
      JSON.stringify({ id: "ui:RM/dialog/pp", dim: "ui", kind: "dialog", label: "Publish Project", sources: [{ enumerator: "E05" }] }),
      JSON.stringify({ id: "ui:RM/control/pp/Publish", dim: "ui", kind: "control", parent: "ui:RM/dialog/pp", label: "Publish", sources: [{ enumerator: "E05" }] }),
      // A live "Save As..." dialog with no confirm control recorded.
      JSON.stringify({ id: "ui:WE/dialog/sa", dim: "ui", kind: "dialog", label: "Save As...", sources: live }),
    ];
    expect(auditDenyLabels(p, ledger)).toEqual([
      { list: "c", label: "Create World:confirm", rows: 1, liveRows: 1 },
      { list: "c", label: "Pack Project:confirm", rows: 0, liveRows: 0 },
      { list: "c", label: "Publish:confirm", rows: 1, liveRows: 0 },
      { list: "c", label: "Save As:confirm", rows: 1, liveRows: 1 },
    ]);
  });

  it("the Markdown table marks an unverified label", () => {
    const md = renderMarkdown([], [{ list: "openers", label: "Create Terrain", rows: 0, liveRows: 0 }]);
    expect(md).toContain("| openers | Create Terrain | 0 | 0 | **no** |");
  });
});
