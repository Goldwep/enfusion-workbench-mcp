import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASELINE_DIR,
  applyBaselineGuard,
  baselineFromSteps,
  baselinePath,
  baselineRegressions,
  parseBaseline,
  serializeBaseline,
  sittingLabel,
  type Baseline,
  type GuardIo,
} from "../live/baseline.js";

const WAVES = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "w11", "w12"];
const LIVE_DIR = join(BASELINE_DIR, "..", "..", "..", "..", "tests", "live");

const BASE: Baseline = {
  wave: "w5",
  sitting: "W5/cold7",
  steps: { "w5-10-a": "PASS", "w5-11-b": "KILLED", "w5-12-c": "NOT-RUN" },
};

function fakeIo(baseline: Baseline | null, steps: { id: string; status: string }[] = []) {
  const writes: { path: string; text: string }[] = [];
  const io: GuardIo = {
    read: () => baseline,
    steps: () => steps,
    write: (path, text) => writes.push({ path, text }),
  };
  return { io, writes };
}

const OPTS = {
  wave: "w5",
  sittingDir: join("x", "W5", "cold8"),
  resultFile: "w5-result.json",
  update: false,
  exitDone: 0,
  exitRefused: 1,
  dir: "baselines",
};

describe("regression guard (tests/live/baseline.ts)", () => {
  it("a step that PASSED in the baseline and ends KILLED is one REGRESSION line", () => {
    expect(
      baselineRegressions(
        [
          { step: "w5-10-a", status: "KILLED", detail: "P-W5-01 refused" },
          { step: "w5-11-b", status: "KILLED" },
          { step: "w5-12-c", status: "KILLED" },
          { step: "w5-13-new", status: "KILLED" },
          { step: "w5-10-a", status: "PASS" },
        ],
        BASE,
      ),
    ).toEqual(["REGRESSION w5-10-a: PASS in W5/cold7, KILLED now (P-W5-01 refused)"]);
  });

  it("a step missing from the baseline, or no baseline at all, is not a regression", () => {
    expect(baselineRegressions([{ step: "w5-99-new", status: "KILLED" }], BASE)).toEqual([]);
    expect(baselineRegressions([{ step: "w5-10-a", status: "KILLED" }], null)).toEqual([]);
  });

  it("FAIL, HELD and the other statuses are left to the table and the FAIL rule", () => {
    expect(
      baselineRegressions(
        [
          { step: "w5-10-a", status: "FAIL" },
          { step: "w5-10-a", status: "HELD" },
          { step: "w5-10-a", status: "NOT-RUN" },
        ],
        BASE,
      ),
    ).toEqual([]);
  });

  it("a regression turns a done exit into refused and appends its line to the message", () => {
    const { io, writes } = fakeIo(BASE);
    const r = {
      exit: 0,
      message: null as string | null,
      records: [{ step: "w5-10-a", status: "KILLED", detail: "d" }],
    };
    expect(applyBaselineGuard(r, OPTS, io)).toEqual([]);
    expect(r.exit).toBe(1);
    expect(r.message).toBe("REGRESSION w5-10-a: PASS in W5/cold7, KILLED now (d)");
    expect(writes).toEqual([]);
  });

  it("a stop or handoff keeps its own exit; the line joins its message", () => {
    const { io } = fakeIo(BASE);
    const r = {
      exit: 5,
      message: "handoff at w5-20" as string | null,
      records: [{ step: "w5-10-a", status: "KILLED" }],
    };
    applyBaselineGuard(r, OPTS, io);
    expect(r.exit).toBe(5);
    expect(r.message).toBe("handoff at w5-20; REGRESSION w5-10-a: PASS in W5/cold7, KILLED now");
  });

  it("a clean run is unchanged", () => {
    const { io } = fakeIo(BASE);
    const r = { exit: 0, message: null, records: [{ step: "w5-10-a", status: "PASS" }] };
    applyBaselineGuard(r, OPTS, io);
    expect(r).toEqual({ exit: 0, message: null, records: [{ step: "w5-10-a", status: "PASS" }] });
  });

  it("--update-baseline rewrites the file from the sitting's result steps and does not fail the run", () => {
    const { io, writes } = fakeIo(BASE, [
      { id: "w5-11-b", status: "PASS" },
      { id: "w5-10-a", status: "KILLED" },
    ]);
    const r = { exit: 0, message: null, records: [{ step: "w5-10-a", status: "KILLED" }] };
    const lines = applyBaselineGuard(r, { ...OPTS, update: true }, io);
    expect(r.exit).toBe(0);
    expect(lines[0]).toBe(
      "REGRESSION w5-10-a: PASS in W5/cold7, KILLED now (accepted: --update-baseline)",
    );
    expect(lines[1]).toBe("baseline w5-baseline.json rewritten from W5/cold8: 2 steps");
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe(join("baselines", "w5-baseline.json"));
    const written = parseBaseline(writes[0]!.text);
    expect(written).toEqual({
      wave: "w5",
      sitting: "W5/cold8",
      steps: { "w5-10-a": "KILLED", "w5-11-b": "PASS" },
    });
    expect(Object.keys(written.steps)).toEqual(["w5-10-a", "w5-11-b"]);
  });

  it("baselineFromSteps sorts ids and takes step or id; serialize round-trips", () => {
    const b = baselineFromSteps("W2", "W2/cold7", [
      { step: "w2-20", status: "PASS" },
      { id: "w2-10", status: "NOT-RUN" },
    ]);
    expect(b).toEqual({ wave: "w2", sitting: "W2/cold7", steps: { "w2-10": "NOT-RUN", "w2-20": "PASS" } });
    expect(parseBaseline(serializeBaseline(b))).toEqual(b);
  });

  it("a malformed baseline throws instead of passing silently", () => {
    expect(() => parseBaseline("{}")).toThrow(/wave and sitting/);
    expect(() => parseBaseline('{"wave":"w1","sitting":"W1/a4","steps":[]}')).toThrow(/steps/);
    expect(() => parseBaseline('{"wave":"w1","sitting":"W1/a4","steps":{"a":1}}')).toThrow(/status/);
  });

  it("sittingLabel names the wave folder and the sitting, not the path", () => {
    expect(sittingLabel(join("C:", "u", "artifacts", "sessions", "W8", "sw1"))).toBe("W8/sw1");
  });

  it("every wave has a committed baseline from its latest green sitting", () => {
    const expected: Record<string, string> = { w1: "W1/a4", w3: "W3/a4" };
    for (const w of WAVES) {
      const p = baselinePath(w);
      expect(existsSync(p), p).toBe(true);
      const b = parseBaseline(readFileSync(p, "utf-8"));
      expect(b.wave).toBe(w);
      expect(b.sitting).toBe(expected[w] ?? `${w.toUpperCase()}/cold7`);
      expect(Object.keys(b.steps).length).toBeGreaterThan(0);
      for (const id of Object.keys(b.steps)) expect(id.startsWith(`${w}-`), id).toBe(true);
    }
  });

  it("every wave battery's main applies the guard and accepts --update-baseline", () => {
    for (const w of WAVES) {
      const src = readFileSync(join(LIVE_DIR, `${w}.live.ts`), "utf-8");
      expect(src, w).toContain('from "./baseline.js"');
      expect(src, w).toMatch(/const FLAGS = \[[^\]]*"update-baseline"[^\]]*\] as const;/);
      expect(src, w).toContain(`wave: "${w}",`);
      expect(src.split("applyBaselineGuard(r,").length - 1, w).toBe(1);
    }
  });
});
