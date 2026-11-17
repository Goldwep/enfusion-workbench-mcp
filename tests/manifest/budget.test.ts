import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  checkBudget,
  CORE_BUDGET,
  fetchToolsList,
  FULL_BUDGET,
  listChars,
} from "../../src/manifest/budget.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = resolve(root, "dist/index.js");
const haveDist = existsSync(entry);

describe("checkBudget", () => {
  it("measures JSON chars and filters core by the tiers table", () => {
    const tools = [
      { name: "wb_state", description: "a" },
      { name: "terrain_inspect", description: "b".repeat(FULL_BUDGET) },
    ];
    const r = checkBudget(tools);
    expect(r.coreTools).toBe(1);
    expect(r.coreChars).toBe(listChars([tools[0]]));
    expect(r.coreOk).toBe(true);
    expect(r.fullOk).toBe(false);
  });
});

// Measures the tools/list the built server serves today. dist/ may be stale against src/;
// main rebuilds before re-running this gate.
describe.skipIf(!haveDist)("tools/list byte budget (dist/index.js over stdio)", () => {
  it(`stays within core ${CORE_BUDGET} and full ${FULL_BUDGET} chars`, async () => {
    const tools = await fetchToolsList(entry);
    const r = checkBudget(tools);
    console.log(
      `[budget] full ${r.fullTools} tools ${r.fullChars} chars; core ${r.coreTools} tools ${r.coreChars} chars`,
    );
    expect(tools.length).toBeGreaterThan(0);
    expect(r.fullChars).toBeLessThanOrEqual(FULL_BUDGET);
    expect(r.coreChars).toBeLessThanOrEqual(CORE_BUDGET);
  }, 90_000);
});

describe.skipIf(haveDist)("tools/list byte budget", () => {
  it.skip("skipped: dist/index.js is absent (run npm run build first)", () => {});
});
