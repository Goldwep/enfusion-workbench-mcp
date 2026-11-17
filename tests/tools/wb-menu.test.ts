import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  ALLOW_LIST_FILE,
  MENU_ACTIONS,
  WB_MENU_DESCRIPTION,
  buildMenuItems,
  deniedBy,
  isAllowListed,
  loadAllowListFile,
  loadMenuItems,
  opensDialog,
  parseAllowListSource,
  registerWbMenu,
  runMenu,
  runRefusal,
  segmentsOf,
  type AllowListPack,
  type MenuArgs,
  type MenuDeps,
  type MenuItem,
} from "../../src/tools/wb-menu.js";
import { callExecuteAction } from "../../src/tools/wb-execute-action.js";
import type { Row } from "../../src/census/schemas.js";
import { captureTool, textOf } from "./_tool-harness.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
}

function fakeClient(
  answer: (p: Record<string, unknown>) => Record<string, unknown> | Error,
  state?: { mode: string },
): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    state,
    call: async (fn: string, params: Record<string, unknown>) => {
      sent.push({ fn, params });
      const a = answer(params);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const NO_CLIENT = { call: async () => ({}) } as unknown as WorkbenchClient;

const item = (
  module: string,
  segments: string[],
  risk = "mutating",
  verified = false,
): MenuItem => ({
  module,
  path: segments.join(","),
  segments,
  risk,
  verified,
  opensDialog: opensDialog(segments[segments.length - 1] as string),
});

const PACK: AllowListPack = {
  paths: [
    ["Edit", "Undo"],
    ["Window", "Hierarchy"],
    ["Window", "Log Console"],
    ["File", "Options..."],
    ["Edit", "Delete Things"],
    ["Edit", "Cut"],
    ["File", "Exit"],
  ],
  denyLabels: ["Exit", "New World", "Publish:confirm"],
  denyWords: ["cut", "delete", "save"],
};

const ITEMS: MenuItem[] = [
  item("WorldEditor", ["Edit", "Undo"], "mutating"),
  item("WorldEditor", ["Window", "Hierarchy"], "safe", true),
  item("WorldEditor", ["Window", "Log Console"], "safe"),
  item("WorldEditor", ["File", "Options..."], "safe"),
  item("WorldEditor", ["File", "Wipe"], "destructive"),
  item("WorldEditor", ["Edit", "Delete Things"], "mutating"),
  item("ScriptEditor", ["Edit", "Undo"], "mutating"),
];

const deps = (items: MenuItem[] = ITEMS, pack: AllowListPack = PACK): MenuDeps => ({
  items: () => items,
  allowList: () => pack,
});

const okAnswer = () => ({ status: "ok", menuPath: "x", message: "Action executed successfully" });

type Out = Awaited<ReturnType<typeof runMenu>>;
const readback = (r: Out) => (r.ok ? (r.readback as Record<string, unknown>) : {});

describe("wb_menu description and input", () => {
  it("names the three actions", () => {
    expect([...MENU_ACTIONS]).toEqual(["list", "describe", "run"]);
  });
  it("its description is at most 307 characters (budget 400)", () => {
    expect(WB_MENU_DESCRIPTION.length).toBeLessThanOrEqual(307);
    expect(WB_MENU_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe("ledger rows", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: "ui:WorldEditor/menu-item/Edit/Copy",
      kind: "menu-item",
      module: "WorldEditor",
      risk: "mutating",
      paths: [{ path: "execute-action", status: "candidate" }],
      ...over,
    }) as unknown as Row;

  it("reads the path from the locator, else from the id with %2F decoded", () => {
    expect(segmentsOf(row({ locator: { menuPath: ["Edit", "Copy"] } }))).toEqual(["Edit", "Copy"]);
    expect(segmentsOf(row({}))).toEqual(["Edit", "Copy"]);
    expect(
      segmentsOf(row({ id: "ui:AnimEditor/menu-item/Cut %2F Copy %2F Paste selection" })),
    ).toEqual(["Cut / Copy / Paste selection"]);
  });

  it("keeps menu-item rows only, one per module and path, sorted", () => {
    const items = buildMenuItems([
      row({ id: "ui:WorldEditor/menu-item/Edit/Copy" }),
      row({ id: "ui:WorldEditor/menu-item/Edit/Copy2", locator: { menuPath: ["Edit", "Copy"] } }),
      row({ id: "ui:WorldEditor/menu/Edit", kind: "menu" }),
      row({ id: "ui:AnimEditor/menu-item/Zed", module: "AnimEditor" }),
      row({
        id: "ui:WorldEditor/menu-item/A/B...",
        paths: [{ path: "execute-action", status: "verified" }],
      }),
    ]);
    expect(items.map((i) => `${i.module}:${i.path}`)).toEqual([
      "AnimEditor:Zed",
      "WorldEditor:A,B...",
      "WorldEditor:Edit,Copy",
    ]);
    expect(items[1]?.verified).toBe(true);
    expect(items[1]?.opensDialog).toBe(true);
    expect(items[2]?.verified).toBe(false);
  });

  it("a trailing ellipsis (three dots or one character) opens a dialog", () => {
    expect(opensDialog("Options...")).toBe(true);
    expect(opensDialog("Options\u2026")).toBe(true);
    expect(opensDialog("Undo")).toBe(false);
  });
});

describe("the allow-list pack", () => {
  it("parses the three lists out of the generated source", () => {
    const src = `class X {
	static void Paths(notnull array<string> outPaths)
	{
		outPaths.Clear();
		outPaths.Insert("Edit\\nUndo");
		outPaths.Insert("File\\nOptions...");
	}
	static void DenyLabels(notnull array<string> outLabels)
	{
		outLabels.Insert("Exit");
	}
	static void DenyWords(notnull array<string> outWords)
	{
		outWords.Insert("save");
	}
}`;
    expect(parseAllowListSource(src)).toEqual({
      paths: [
        ["Edit", "Undo"],
        ["File", "Options..."],
      ],
      denyLabels: ["Exit"],
      denyWords: ["save"],
    });
  });

  it("an unreadable file fails closed (empty pack)", () => {
    expect(loadAllowListFile("C:/no/such/file.c")).toEqual({
      paths: [],
      denyLabels: [],
      denyWords: [],
    });
  });

  it("matches a path exactly, with no case folding", () => {
    expect(isAllowListed(PACK, ["Edit", "Undo"])).toBe(true);
    expect(isAllowListed(PACK, ["edit", "undo"])).toBe(false);
    expect(isAllowListed(PACK, ["Edit"])).toBe(false);
  });

  it("denies a label as a run of words and a word as a word", () => {
    expect(deniedBy(PACK, ["File", "Exit"])).toBe("Exit");
    expect(deniedBy(PACK, ["Edit", "Cut"])).toBe("cut");
    expect(deniedBy(PACK, ["Edit", "Cutlery"])).toBeNull();
    expect(deniedBy(PACK, ["Publish"])).toBeNull();
  });

  it("the shipped file, when present, parses to a non-empty pack", () => {
    const pack = loadAllowListFile(ALLOW_LIST_FILE);
    expect(pack.paths.length).toBeGreaterThan(0);
    expect(pack.denyWords).toContain("save");
  });
});

describe("wb_menu list", () => {
  it("pages the items with allowListed and nextCursor", async () => {
    const r1 = await runMenu(NO_CLIENT, { action: "list", limit: 3 }, deps());
    expect(r1.ok).toBe(true);
    const rb = readback(r1);
    expect(rb.total).toBe(7);
    expect(rb.nextCursor).toBe("3:7");
    const items = rb.items as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    expect(Object.keys(items[0] as object).sort()).toEqual(
      ["allowListed", "module", "opensDialog", "path", "risk", "verified"].sort(),
    );
    const r2 = await runMenu(NO_CLIENT, { action: "list", limit: 3, cursor: "3:7" }, deps());
    expect((readback(r2).items as unknown[]).length).toBe(3);
    const r3 = await runMenu(NO_CLIENT, { action: "list", limit: 3, cursor: "6:7" }, deps());
    expect(readback(r3).nextCursor).toBeNull();
  });

  it("filters by module and sends nothing", async () => {
    const { client, sent } = fakeClient(okAnswer);
    const r = await runMenu(client, { action: "list", module: "ScriptEditor" }, deps());
    expect(readback(r).total).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("flags allowListed and opensDialog per item", async () => {
    const r = await runMenu(NO_CLIENT, { action: "list", module: "WorldEditor" }, deps());
    const items = readback(r).items as {
      path: string;
      allowListed: boolean;
      opensDialog: boolean;
    }[];
    const opt = items.find((i) => i.path === "File,Options...");
    expect(opt).toMatchObject({ allowListed: true, opensDialog: true });
    expect(items.find((i) => i.path === "File,Wipe")?.allowListed).toBe(false);
  });

  it("a changed total is STALE_CURSOR, a malformed cursor INVALID_ARGUMENT", async () => {
    const stale = await runMenu(NO_CLIENT, { action: "list", cursor: "3:99" }, deps());
    expect(stale.ok === false && stale.code).toBe("STALE_CURSOR");
    const bad = await runMenu(NO_CLIENT, { action: "list", cursor: "x" }, deps());
    expect(bad.ok === false && bad.code).toBe("INVALID_ARGUMENT");
  });

  it("warns when the ledger has no items", async () => {
    const r = await runMenu(NO_CLIENT, { action: "list" }, deps([]));
    expect(r.ok && r.warnings.length).toBe(1);
  });
});

describe("wb_menu describe", () => {
  it("answers the five fields", async () => {
    const r = await runMenu(
      NO_CLIENT,
      { action: "describe", module: "WorldEditor", path: " Window , Hierarchy " },
      deps(),
    );
    expect(readback(r)).toMatchObject({
      path: "Window,Hierarchy",
      risk: "safe",
      verified: true,
      allowListed: true,
      opensDialog: false,
    });
  });

  it("refuses INVALID_ARGUMENT for a missing key or an unknown item", async () => {
    for (const args of [
      { action: "describe" },
      { action: "describe", module: "WorldEditor" },
      { action: "describe", module: "WorldEditor", path: "No,Such" },
    ] as MenuArgs[]) {
      const r = await runMenu(NO_CLIENT, args, deps());
      expect(r.ok === false && r.code).toBe("INVALID_ARGUMENT");
    }
  });
});

describe("wb_menu run: refusals before anything is sent", () => {
  const cases: [string, MenuArgs, string, MenuItem[]?][] = [
    ["no module", { action: "run", path: "Edit,Undo" }, "INVALID_ARGUMENT"],
    ["no path", { action: "run", module: "WorldEditor" }, "INVALID_ARGUMENT"],
    ["empty path", { action: "run", module: "WorldEditor", path: " , " }, "INVALID_ARGUMENT"],
    [
      "blocked path",
      { action: "run", module: "WorldEditor", path: "File,Exit" },
      "NOT_ALLOWLISTED",
    ],
    [
      "not on the list",
      { action: "run", module: "WorldEditor", path: "File,Wipe", confirm: true },
      "NOT_ALLOWLISTED",
    ],
    [
      "a denied word",
      { action: "run", module: "WorldEditor", path: "Edit,Delete Things", confirm: true },
      "NOT_ALLOWLISTED",
    ],
    [
      "a dialog item",
      { action: "run", module: "WorldEditor", path: "File,Options...", confirm: true },
      "MODAL_HAZARD",
    ],
    [
      "a destructive row",
      { action: "run", module: "WorldEditor", path: "Window,Hierarchy", confirm: true },
      "NOT_ALLOWLISTED",
      [item("WorldEditor", ["Window", "Hierarchy"], "destructive")],
    ],
    [
      "another module",
      { action: "run", module: "ScriptEditor", path: "Edit,Undo", confirm: true },
      "MODULE_NOT_SUPPORTED",
    ],
  ];
  for (const [name, args, code, items] of cases) {
    it(name, async () => {
      const { client, sent } = fakeClient(okAnswer);
      const r = await runMenu(client, args, deps(items));
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.code).toBe(code);
      expect(sent).toHaveLength(0);
    });
  }

  it("an empty allow-list refuses every run", async () => {
    const { client, sent } = fakeClient(okAnswer);
    const r = await runMenu(
      client,
      { action: "run", module: "WorldEditor", path: "Window,Hierarchy" },
      deps(ITEMS, { paths: [], denyLabels: [], denyWords: [] }),
    );
    expect(r.ok === false && r.code).toBe("NOT_ALLOWLISTED");
    expect(sent).toHaveLength(0);
  });

  it("play mode and unknown mode refuse WRONG_MODE", async () => {
    for (const mode of ["play", "unknown"]) {
      const { client, sent } = fakeClient(okAnswer, { mode });
      const r = await runMenu(
        client,
        { action: "run", module: "WorldEditor", path: "Window,Hierarchy" },
        deps(),
      );
      expect(r.ok === false && r.code).toBe("WRONG_MODE");
      expect(sent).toHaveLength(0);
    }
  });
});

describe("wb_menu run: dry run and the call", () => {
  it("a mutating item is a dry run unless confirm", async () => {
    const { client, sent } = fakeClient(okAnswer, { mode: "edit" });
    const r = await runMenu(
      client,
      { action: "run", module: "WorldEditor", path: "Edit,Undo" },
      deps(),
    );
    expect(r.ok).toBe(true);
    expect(readback(r)).toMatchObject({ dryRun: true, ran: false, path: "Edit,Undo" });
    expect(r.ok && r.next).toContain("confirm: true");
    expect(sent).toHaveLength(0);
  });

  it("an item the ledger does not know is treated as mutating", async () => {
    const { client, sent } = fakeClient(okAnswer);
    const r = await runMenu(
      client,
      { action: "run", module: "WorldEditor", path: "Window,Hierarchy" },
      deps([]),
    );
    expect(readback(r).dryRun).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("confirm presses a mutating item through EMCP_WB_ExecuteAction", async () => {
    const { client, sent } = fakeClient(okAnswer, { mode: "edit" });
    const r = await runMenu(
      client,
      { action: "run", module: "WorldEditor", path: " Edit , Undo ", confirm: true },
      deps(),
    );
    expect(r.ok).toBe(true);
    expect(readback(r)).toEqual({ ran: true, path: "Edit,Undo" });
    expect(sent).toEqual([{ fn: "EMCP_WB_ExecuteAction", params: { menuPath: "Edit,Undo" } }]);
  });

  it("a safe item runs without confirm", async () => {
    const { client, sent } = fakeClient(okAnswer);
    const r = await runMenu(
      client,
      { action: "run", module: "WorldEditor", path: "Window,Hierarchy" },
      deps(),
    );
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("confirm false is still a dry run", async () => {
    const { client, sent } = fakeClient(okAnswer);
    const r = await runMenu(
      client,
      { action: "run", module: "WorldEditor", path: "Edit,Undo", confirm: false },
      deps(),
    );
    expect(readback(r).dryRun).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("wb_menu run: response mapping", () => {
  const args: MenuArgs = {
    action: "run",
    module: "WorldEditor",
    path: "Window,Hierarchy",
  };
  const codeOf = (r: Out) => (r.ok ? "ok" : r.code);

  it("maps the handler's module-not-available answer to MODULE_NOT_OPEN", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      message: "WorldEditor module not available",
    }));
    expect(codeOf(await runMenu(client, args, deps()))).toBe("MODULE_NOT_OPEN");
  });

  it("maps a false answer to ENGINE_FALSE and other errors to HANDLER_ERROR", async () => {
    const f = fakeClient(() => ({
      status: "error",
      message: "ExecuteAction returned false (menu path not found)",
    }));
    expect(codeOf(await runMenu(f.client, args, deps()))).toBe("ENGINE_FALSE");
    const h = fakeClient(() => ({ status: "error", message: "boom" }));
    expect(codeOf(await runMenu(h.client, args, deps()))).toBe("HANDLER_ERROR");
  });

  it("carries a handler refusal code, and an unknown one becomes HANDLER_ERROR", async () => {
    const a = fakeClient(() => ({ status: "refused", code: "MODULE_NOT_OPEN", message: "closed" }));
    expect(codeOf(await runMenu(a.client, args, deps()))).toBe("MODULE_NOT_OPEN");
    const b = fakeClient(() => ({ status: "refused", code: "WHAT", message: "?" }));
    expect(codeOf(await runMenu(b.client, args, deps()))).toBe("HANDLER_ERROR");
  });

  it("keeps LOST, MODAL_OPEN and WEDGED by name and never retries", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError("x", code));
      const r = await runMenu(client, args, deps());
      expect(codeOf(r)).toBe(code);
      expect(sent).toHaveLength(1);
    }
    const u = fakeClient(() => new Error("down"));
    expect(codeOf(await runMenu(u.client, args, deps()))).toBe("UNREACHABLE");
  });
});

describe("shared run path and registration", () => {
  it("callExecuteAction sends the path to EMCP_WB_ExecuteAction", async () => {
    const { client, sent } = fakeClient(okAnswer);
    await callExecuteAction(client, "Edit,Undo");
    expect(sent).toEqual([{ fn: "EMCP_WB_ExecuteAction", params: { menuPath: "Edit,Undo" } }]);
  });

  it("registerWbMenu installs a handler that answers JSON text", async () => {
    const { client } = fakeClient(okAnswer);
    const handler = captureTool((s) => registerWbMenu(s, client));
    const res = await handler({ action: "describe" });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res)).code).toBe("INVALID_ARGUMENT");
  });

  it("the default loader reads the census ledger's menu items", () => {
    const items = loadMenuItems();
    for (const i of items) expect(i.path.length).toBeGreaterThan(0);
  });
});

describe("runRefusal (what howto and the cold-test key read)", () => {
  const r = (module: string, path: string, risk = "safe") =>
    ({ id: `ui:${module}/menu-item/${path}`, module, kind: "menu-item", risk }) as unknown as Row;
  it("sends an allow-listed World Editor item and names why it refuses the rest", () => {
    expect(runRefusal(r("WorldEditor", "Window/Hierarchy"), PACK)).toBeNull();
    expect(runRefusal(r("WorldEditor", "Window/Missing"), PACK)).toBe(
      "not on the run allow-list (P-W8-22)",
    );
    expect(runRefusal(r("WorldEditor", "Edit/Cut"), PACK)).toBe(
      "it holds the denied word or label 'cut'",
    );
    expect(runRefusal(r("WorldEditor", "File/Options..."), PACK)).toBe("it opens a dialog");
    expect(runRefusal(r("ScriptEditor", "Edit/Undo"), PACK)).toBe(
      "the handler drives the WorldEditor only",
    );
    expect(runRefusal(r("WorldEditor", "Window/Log Console", "destructive"), PACK)).toBe(
      "risk destructive",
    );
  });
});
