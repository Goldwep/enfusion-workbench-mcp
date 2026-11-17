import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { memoryIo } from "../../scripts/census/cli-common.js";
import { checkText, run, type Known } from "../../scripts/census/check-doc-citations.js";
import { REAL_CENSUS } from "./helpers.js";

const known: Known = {
  tools: new Set(["wb_menu", "wb_gui", "api_search"]),
  actions: new Set(["wb_menu.run", "wb_gui.invoke"]),
  ids: new Set(["api:WorldEditorAPI", "mcp:action/wb_menu.run"]),
};

describe("check-doc-citations", () => {
  it("passes ids and tool names the ledger knows", () => {
    const text = [
      "Use `wb_menu` (`wb_menu.run`) or api_search; see `api:WorldEditorAPI`.",
      "The id form is `api:<Class>.<Method>/<arity>`; src/tools/wb-menu.ts and wb_menu.ts are files.",
      "ENFUSION_TOOLS=+wb_gui and set_allow_list are not tool names of a known family.",
    ].join("\n");
    expect(checkText("doc.md", text, known)).toEqual([]);
  });

  it("flags an unknown tool, an unknown action and a dangling id, with the line", () => {
    const text = ["Run wb_menus first.", "Then `wb_gui.press` on `api:Nope`."].join("\n");
    expect(checkText("doc.md", text, known)).toEqual([
      { file: "doc.md", line: 1, cited: "wb_menus", why: "no registered tool of that name" },
      {
        file: "doc.md",
        line: 2,
        cited: "api:Nope",
        why: "no ledger row or alias",
      },
      {
        file: "doc.md",
        line: 2,
        cited: "wb_gui.press",
        why: "the tool has no action of that name",
      },
    ]);
  });

  it.skipIf(!existsSync(join(REAL_CENSUS, "ledger.jsonl")))(
    "passes on README, the update playbook and the operations guide",
    () => {
      const io = memoryIo();
      expect(run(["--data", REAL_CENSUS], io), io.stdout()).toBe(0);
    },
  );
});
