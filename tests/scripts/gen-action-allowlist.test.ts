import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_ALLOW_LIST_FILE,
  generateActionAllowList,
  main,
  renderActionAllowList,
} from "../../scripts/gen-action-allowlist.js";
import {
  MENU_DENY_WORDS,
  labelWords,
  renderAllowList,
  type ProbePolicy,
} from "../../scripts/live/gen-probe-allowlist.js";
import {
  deniedBy,
  isAllowListed,
  loadAllowListFile,
  loadMenuItems,
  opensDialog,
  parseAllowListSource,
  runMenu,
} from "../../src/tools/wb-menu.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { loadPolicy } from "../../scripts/live/policy.js";

const policy = loadPolicy() as ProbePolicy;

/** The Insert lines of one fill method of a generated class. */
function inserts(text: string, method: string): string[] {
  const at = text.indexOf(`static void ${method}(`);
  expect(at).toBeGreaterThanOrEqual(0);
  const body = text.slice(at, text.indexOf("\t}", at));
  return [...body.matchAll(/\.Insert\((.*)\);/g)].map((m) => m[1]);
}

function withAllowList(allow: unknown[]): ProbePolicy {
  return {
    ...policy,
    execute_action: { ...policy.execute_action, allow_list: allow },
  } as ProbePolicy;
}

describe("gen-action-allowlist", () => {
  it("the committed file is what the policy generates", () => {
    expect(readFileSync(ACTION_ALLOW_LIST_FILE, "utf-8")).toBe(generateActionAllowList().text);
  });

  it("--check answers 0 on the committed file", () => {
    expect(main(["--check"])).toBe(0);
  });

  it("compiles the same three lists as the probe's ECEN_ProbeAllowList", () => {
    const mine = renderActionAllowList(policy);
    const probe = renderAllowList(policy);
    for (const m of ["Paths", "DenyLabels", "DenyWords"]) {
      expect(inserts(mine, m)).toEqual(inserts(probe, m));
    }
    expect(mine).toMatch(/^class EMCP_WB_ActionAllowList$/m);
  });

  it("lists every policy allow-list path with its segments joined by \\n", () => {
    const text = renderActionAllowList(policy);
    const allow = (policy.execute_action?.allow_list ?? []) as string[][];
    for (const segs of allow) expect(text).toContain(`outPaths.Insert("${segs.join("\\n")}");`);
    expect(text).toContain(`return ${allow.length};`);
  });

  it("refuses an entry with a refused word, a deny-list label or a quote", () => {
    expect(() => renderActionAllowList(withAllowList([["File", "Save World"]]))).toThrow(/refus/);
    expect(() => renderActionAllowList(withAllowList([["File", "Exit"]]))).toThrow(/refus/);
    expect(() => renderActionAllowList(withAllowList([["Window", 'Bad"Quote']]))).toThrow(
      /double quote/,
    );
  });

  it("an empty allow-list compiles to Count 0 and no path", () => {
    const text = renderActionAllowList(withAllowList([]));
    expect(text).toContain("return 0;");
    expect(inserts(text, "Paths")).toEqual([]);
  });
});

/** The menu battery plan (DEC-091 bookkeeping 2): one line per menu row with its class. */
const PLAN_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "v2",
  "inbox",
  "phase6",
  "bk3",
  "bk3-menu-plan.jsonl",
);
// The plan file is part of the 2.0 programme record (docs/v2), which the public export leaves
// out; the two blocks that check it skip there.
const HAS_PLAN = existsSync(PLAN_FILE);
const planRows = (HAS_PLAN ? readFileSync(PLAN_FILE, "utf-8") : "")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { id: string; path: string; cls: string });
const segsOf = (path: string): string[] => path.split(" > ");
/** The entries before DEC-092 (S-D U9, U19, S-F U31, P-W8-22's refusal item). */
const PRE_092 = new Set(
  [
    ["Edit", "Undo"],
    ["Window", "Hierarchy"],
    ["Window", "Log Console"],
    ["&Window", "Hierarchy"],
    ["&Window", "Log Console"],
    ["window", "hierarchy"],
    ["window", "log console"],
    ["Utilities", "Qt Introspection Tool"],
    ["File", "Options..."],
  ].map((s) => s.join("\n")),
);
/** PRE_092 as shipped: File > Options... left the compiled list (total audit live-tools-b-1). */
const PRE_092_SHIPPED = new Set([...PRE_092].filter((k) => k !== "File\nOptions..."));
/** DEC-095: the view- or selection-only safe-state rows main accepted (19 of the review's 28). */
const DEC_095_HELD =
  /^ui:(ResourceManager\/menu-item\/Editors\/|WorldEditor\/menu-item\/File\/Go to World File$)/;
const DEC_095_ROWS = [
  "ui:AnimEditor/menu-item/Track/Stop",
  "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Collapse all groups",
  "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Expand all groups",
  "ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Show only modified properties",
  "ui:ResourceManager/menu-item/Edit/Locate File in Resource Browser",
  "ui:ScriptEditor/menu-item/Bookmarks/Next Bookmark",
  "ui:ScriptEditor/menu-item/Bookmarks/Previous Bookmark",
  "ui:ScriptEditor/menu-item/Edit/Navigate Back",
  "ui:ScriptEditor/menu-item/Edit/Navigate Forward",
  "ui:WorldEditor/menu-item/Entities/Focus Selection",
  "ui:WorldEditor/menu-item/Entities/Locate Nested Prefab",
  "ui:WorldEditor/menu-item/Entities/Locate Prefab",
  "ui:WorldEditor/menu-item/Entities/Locate Prefab in Library",
  "ui:WorldEditor/menu-item/Entities/Select Children",
  "ui:WorldEditor/menu-item/Entities/Select Layer",
  "ui:WorldEditor/menu-item/Entities/Select Parent",
  "ui:WorldEditor/menu-item/Entities/Select Prefab Instance Members",
  "ui:WorldEditor/menu-item/Entities/Select Prefab Instance Root",
  "ui:WorldEditor/menu-item/Entities/Select Siblings",
];
const DEC_095_PATHS = new Set(
  planRows.filter((r) => DEC_095_ROWS.includes(r.id)).map((r) => segsOf(r.path).join("\n")),
);

/** A path is on the shipped allow-list or a DEC-100 candidate (DEC-092/095 put both on the list). */
const keyOf = (e: unknown): string =>
  (Array.isArray(e) ? e.map(String) : String(e).split(" > ")).join("\n");
const ALLOW_KEYS = new Set((policy.execute_action?.allow_list ?? []).map(keyOf));
const CANDIDATE_KEYS = new Set((policy.execute_action?.candidates ?? []).map(keyOf));
const OPENER_KEYS = new Set((policy.execute_action?.dialog_openers ?? []).map(keyOf));
const MANAGE_LAYOUTS = "Window\nManage Layouts";

describe.skipIf(!HAS_PLAN)("DEC-092: the safe-toggle menu rows (narrowed by DEC-100)", () => {
  const pack = parseAllowListSource(readFileSync(ACTION_ALLOW_LIST_FILE, "utf-8"));
  const toggles = planRows.filter((r) => r.cls === "safe-toggle");

  it("the plan holds 113 safe-toggle rows over 82 distinct paths; DEC-092/095 named 108 paths, DEC-100 split them 59 proven (58 shipped: File > Options... left), 48 candidates, 1 dialog opener", () => {
    expect(toggles).toHaveLength(113);
    expect(new Set(toggles.map((r) => r.path)).size).toBe(82);
    expect(policy.execute_action?.allow_list).toHaveLength(58);
    expect(pack.paths).toHaveLength(58);
    expect(policy.execute_action?.candidates).toHaveLength(48);
    expect(policy.execute_action?.dialog_openers).toEqual([["Window", "Manage Layouts"]]);
    // 108 before live-tools-b-1 took File > Options... off the allow-list.
    expect(ALLOW_KEYS.size + CANDIDATE_KEYS.size + OPENER_KEYS.size).toBe(107);
  });

  it("every safe-toggle row is proven, a candidate, or the one dialog opener", () => {
    for (const r of toggles) {
      const k = segsOf(r.path).join("\n");
      const on = [ALLOW_KEYS.has(k), CANDIDATE_KEYS.has(k), OPENER_KEYS.has(k)].filter(Boolean);
      expect(on, r.id).toHaveLength(1);
      expect(isAllowListed(pack, segsOf(r.path)), r.id).toBe(ALLOW_KEYS.has(k));
    }
  });

  it("no toggle segment holds a refused word, and no toggle path ends in an ellipsis", () => {
    for (const r of toggles) {
      const segs = segsOf(r.path);
      for (const s of segs) {
        const hit = labelWords(s).find((w) => (MENU_DENY_WORDS as readonly string[]).includes(w));
        expect(hit, `${r.id}: ${s}`).toBeUndefined();
      }
      expect(opensDialog(segs[segs.length - 1]!), r.id).toBe(false);
      expect(deniedBy(pack, segs), r.id).toBeNull();
    }
  });

  it("a toggle with a refused word or a trailing ellipsis would not get in", () => {
    expect(() =>
      renderActionAllowList(
        withAllowList([...policy.execute_action!.allow_list!, ["Window", "Close Tab"]]),
      ),
    ).toThrow(/refused word "close"/);
    const added = [...ALLOW_KEYS, ...CANDIDATE_KEYS]
      .filter((k) => !PRE_092.has(k) && !DEC_095_PATHS.has(k))
      .map((k) => k.split("\n"));
    // DEC-092's 80 new paths, less Manage Layouts (now a dialog opener)
    expect(added).toHaveLength(79);
    for (const s of added) expect(opensDialog(s[s.length - 1]!), s.join(" > ")).toBe(false);
  });

  it("no safe-state, refused-word, dialog or destructive row was added (they wait for a ruling)", () => {
    const other = planRows.filter((r) => r.cls !== "safe-toggle");
    for (const r of other) {
      const segs = segsOf(r.path);
      if (isAllowListed(pack, segs) && !DEC_095_ROWS.includes(r.id))
        expect(PRE_092.has(segs.join("\n")), r.id).toBe(true);
    }
  });
});

describe.skipIf(!HAS_PLAN)("DEC-095: the view and selection safe-state rows (narrowed by DEC-100)", () => {
  const pack = parseAllowListSource(readFileSync(ACTION_ALLOW_LIST_FILE, "utf-8"));

  it("19 accepted rows, each a safe-state row of the plan, over 19 new paths", () => {
    const rows = planRows.filter((r) => DEC_095_ROWS.includes(r.id));
    expect(rows).toHaveLength(19);
    for (const r of rows) expect(r.cls, r.id).toBe("safe-state");
    expect(DEC_095_PATHS.size).toBe(19);
    for (const p of DEC_095_PATHS) expect(PRE_092.has(p)).toBe(false);
  });

  it("2 accepted rows are proven (W9 run 3), 17 are candidates; none holds a refused word or an ellipsis", () => {
    const proven = [...DEC_095_PATHS].filter((k) => ALLOW_KEYS.has(k));
    expect(proven.sort()).toEqual(["Entities\nFocus Selection", "Entities\nSelect Layer"]);
    for (const k of DEC_095_PATHS) expect(ALLOW_KEYS.has(k) || CANDIDATE_KEYS.has(k), k).toBe(true);
    for (const r of planRows.filter((x) => DEC_095_ROWS.includes(x.id))) {
      const segs = segsOf(r.path);
      expect(isAllowListed(pack, segs), r.id).toBe(ALLOW_KEYS.has(segs.join("\n")));
      for (const s of segs) {
        const hit = labelWords(s).find((w) => (MENU_DENY_WORDS as readonly string[]).includes(w));
        expect(hit, `${r.id}: ${s}`).toBeUndefined();
      }
      expect(opensDialog(segs[segs.length - 1]!), r.id).toBe(false);
      expect(deniedBy(pack, segs), r.id).toBeNull();
    }
  });

  it("the items that open another window or module stay off: Editors > * and Go to World File", () => {
    const held = planRows.filter((r) => DEC_095_HELD.test(r.id));
    expect(held).toHaveLength(9);
    for (const r of held) {
      expect(isAllowListed(pack, segsOf(r.path)), r.id).toBe(false);
      expect(CANDIDATE_KEYS.has(segsOf(r.path).join("\n")), r.id).toBe(false);
    }
  });
});

/** The ledger rows whose execute-action path a W9 live run verified (EV-W9-*). */
const LEDGER_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "census",
  "ledger.jsonl",
);
type LedgerRow = {
  id: string;
  kind?: string;
  locator?: { menuPath?: string[] };
  paths?: Array<{ path: string; status: string; evidence?: string }>;
};
const ledger = readFileSync(LEDGER_FILE, "utf-8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as LedgerRow);
const w9Verified = ledger.filter(
  (r) =>
    r.kind === "menu-item" &&
    (r.paths ?? []).some(
      (p) =>
        p.path === "execute-action" && p.status === "verified" && /^EV-W9-/.test(p.evidence ?? ""),
    ),
);

describe("DEC-100: the shipped allow-list holds only proven paths", () => {
  const shipped = readFileSync(ACTION_ALLOW_LIST_FILE, "utf-8");
  const pack = parseAllowListSource(shipped);

  it("the proven set is the 9 entries before DEC-092 plus the paths a W9 run verified", () => {
    expect(w9Verified).toHaveLength(65);
    const w9Paths = new Set(w9Verified.map((r) => (r.locator?.menuPath ?? []).join("\n")));
    expect(w9Paths.size).toBe(52);
    expect(new Set([...PRE_092_SHIPPED, ...w9Paths])).toEqual(ALLOW_KEYS);
    // No dialog opener is compiled (live-tools-b-1).
    expect(pack.paths.filter((p) => opensDialog(p[p.length - 1]!))).toEqual([]);
  });

  it("candidates are compiled into the probe pack only, never into the shipped list or a shipped handler", () => {
    const probe = renderAllowList(policy);
    const probeCandidates = new Set(
      inserts(probe, "Candidates").map((s) => JSON.parse(s) as string),
    );
    expect(probeCandidates).toEqual(new Set([...CANDIDATE_KEYS]));
    for (const k of CANDIDATE_KEYS) {
      expect(isAllowListed(pack, k.split("\n")), k).toBe(false);
      expect(shipped).not.toContain(`"${k.replace(/\n/g, "\\n")}"`);
    }
    expect(shipped).not.toMatch(/Candidate/);
    for (const k of ALLOW_KEYS) expect(CANDIDATE_KEYS.has(k), k).toBe(false);
  });

  it("Window > Manage Layouts is on neither list, only on dialog_openers", () => {
    expect(ALLOW_KEYS.has(MANAGE_LAYOUTS)).toBe(false);
    expect(CANDIDATE_KEYS.has(MANAGE_LAYOUTS)).toBe(false);
    expect(OPENER_KEYS.has(MANAGE_LAYOUTS)).toBe(true);
    expect(isAllowListed(pack, ["Window", "Manage Layouts"])).toBe(false);
  });

  it("both generators refuse a dialog opener on either list, and a path on both lists", () => {
    const ml = ["Window", "Manage Layouts"];
    const withCandidates = (c: unknown[]): ProbePolicy =>
      ({ ...policy, execute_action: { ...policy.execute_action, candidates: c } }) as ProbePolicy;
    expect(() =>
      renderActionAllowList(withAllowList([...policy.execute_action!.allow_list!, ml])),
    ).toThrow(/dialog_openers/);
    expect(() =>
      renderAllowList(withAllowList([...policy.execute_action!.allow_list!, ml])),
    ).toThrow(/dialog_openers/);
    expect(() =>
      renderActionAllowList(withCandidates([...policy.execute_action!.candidates!, ml])),
    ).toThrow(/dialog_openers/);
    expect(() =>
      renderActionAllowList(
        withCandidates([...policy.execute_action!.candidates!, ["Edit", "Undo"]]),
      ),
    ).toThrow(/never both/);
  });

  it("wb_menu run refuses a World Editor candidate NOT_ALLOWLISTED and sends nothing", async () => {
    const sent: unknown[] = [];
    const client = {
      call: async (fn: string, params: unknown) => {
        sent.push([fn, params]);
        return { status: "ok", message: "Action executed successfully" };
      },
    } as unknown as WorkbenchClient;
    const deps = { items: () => loadMenuItems(), allowList: () => loadAllowListFile() };
    expect(CANDIDATE_KEYS.has("Entities\nSelect Children")).toBe(true);
    for (const path of ["Entities,Select Children", "Window,Manage Layouts"]) {
      const r = await runMenu(
        client,
        { action: "run", module: "WorldEditor", path, confirm: true },
        deps,
      );
      expect(r.ok === false && r.code, path).toBe("NOT_ALLOWLISTED");
    }
    expect(sent).toEqual([]);
  });

  it("wb_module action's handler checks the same compiled list, which names no candidate", () => {
    const handler = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "mod",
        "Scripts",
        "WorkbenchGame",
        "EnfusionMCP",
        "EMCP_WB_Module.c",
      ),
      "utf-8",
    );
    expect(handler).toMatch(/EMCP_WB_ActionAllowList/);
    expect(handler).not.toMatch(/Candidate/);
    for (const k of CANDIDATE_KEYS) expect(isAllowListed(pack, k.split("\n")), k).toBe(false);
  });
});
