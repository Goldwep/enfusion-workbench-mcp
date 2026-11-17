import { describe, it, expect } from "vitest";
import { collectIndexedStyleNames } from "../../src/tools/ui-layout-validate.js";
import type { ProjectIndex } from "../../src/project-index/project-index.js";

// Phase-7 integration: schema v4 indexes every file with a .meta, so a
// project's .styles rows can sit past the first 1000 listResources rows.
describe("collectIndexedStyleNames paging", () => {
  it("finds a .styles row past the first page", () => {
    const all = [
      ...Array.from({ length: 1500 }, (_, i) => ({ file_path: `Textures/t${i}.edds` })),
      { file_path: "UI/Late.styles" },
    ];
    const fake = {
      listResources: ({ limit, offset }: { limit: number; offset: number }) => ({
        rows: all.slice(offset, offset + limit),
        total: all.length,
        offset,
        limit,
      }),
    } as unknown as ProjectIndex;
    const names = collectIndexedStyleNames(fake, (p) => {
      if (p !== "UI/Late.styles") throw new Error("unexpected read " + p);
      return 'StyleRoot {\n Style LateStyle {\n  Name "LateStyle"\n }\n}\n';
    });
    expect(names.has("LateStyle")).toBe(true);
  });
});
