import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { memoryIo } from "../../scripts/census/cli-common.js";
import {
  run,
  compareBuilds,
  batteryOfRef,
  type DiffReport,
} from "../../scripts/census/diff-builds.js";

const FX = resolve(import.meta.dirname, "fixtures", "diff-builds");
const DATA = resolve(FX, "census");

function diff(extra: string[] = []): {
  code: number;
  report: DiffReport;
  out: string;
  err: string;
} {
  const io = memoryIo();
  const code = run(["--from", "1.0", "--to", "2.0", "--data", DATA, "--json", ...extra], io);
  const out = io.stdout();
  return {
    code,
    report: out ? (JSON.parse(out) as DiffReport) : ({} as DiffReport),
    out,
    err: io.stderr(),
  };
}

describe("diff-builds", () => {
  it("lists rows present on one build only", () => {
    const { code, report } = diff();
    expect(code).toBe(0);
    expect(report.rows.onlyFrom).toEqual(["r:import", "r:old", "r:walked"]);
    expect(report.rows.onlyTo).toEqual(["r:new"]);
  });

  it("separates removed rows from rows not re-walked, honouring carry_over", () => {
    const { report, code } = diff();
    expect(code).toBe(0);
    // E02 ran again on 2.0 in full and did not see r:old: removed surface.
    expect(report.rows.removed).toEqual(["r:old"]);
    // E05 has no 2.0 observations; L01 ran on 2.0 but carry_over carries it: not re-walked.
    expect(report.rows.notRewalked).toEqual(["r:import", "r:walked"]);
    expect(report.rows.notRewalkedBy).toEqual({ E05: 1, L01: 1 });
    expect(report.carryOver).toEqual({ enumerators: ["L01"], evidence: ["EV-fixture-carry"] });
    expect(report.summary.rowsRemoved).toBe(1);
    expect(report.summary.rowsNotRewalked).toBe(2);
    const io = memoryIo();
    run(["--from", "1.0", "--to", "2.0", "--data", DATA], io);
    const text = io.stdout();
    expect(text).toContain("rows removed (re-enumerated on 2.0 in full and not seen): 1");
    expect(text).toContain("rows not re-walked on 2.0 (unknown, not removed): 2");
    expect(text).toContain("carry_over 1.0 -> 2.0 (EV-fixture-carry): L01");
    expect(text).toContain(
      "enumerators with observations on 1.0 only (one-time or not re-run): E05",
    );
  });

  it("reports locator records added, removed and changed", () => {
    const { report } = diff();
    expect(report.locators.added).toEqual(["ui:fresh"]);
    expect(report.locators.removed).toEqual(["ui:gone"]);
    expect(report.locators.changed).toEqual([{ id: "ui:chg", fields: ["name"] }]);
  });

  it("ignores build and evidence differences in a locator", () => {
    // ui:keep differs only in build and evidence between the files
    expect(diff().report.locators.changed.map((c) => c.id)).not.toContain("ui:keep");
  });

  it("reports observations added, removed, changed; ignores ref", () => {
    const { report } = diff();
    const o = report.observations;
    expect(o.byEnumerator.E02).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(o.changed).toHaveLength(1);
    expect(o.changed[0].fields).toEqual(["quote"]);
    expect(o.changed[0].id).toContain('"class":"K2"');
    expect(o.enumeratorsOnlyFrom).toEqual(["E05"]);
    expect(o.enumeratorsOnlyTo).toEqual([]);
  });

  it("groups stale T5 rows by wave and battery", () => {
    const { report } = diff();
    expect(report.staleT5.count).toBe(4);
    expect(report.staleT5.byWave).toEqual({
      "(unnamed)": { "(unnamed)": ["r:t5unnamed"] },
      w1: { "w1-10-fixture": ["r:t5stale"], "w1-11-other": ["r:t5w1b"] },
      w3: { "w3-23-loc-insert": ["r:t5w3"] },
    });
    expect(JSON.stringify(report.staleT5)).not.toContain("r:t5fresh");
  });

  it("is deterministic and carries no machine path", () => {
    const a = diff().out;
    const b = diff().out;
    expect(a).toBe(b);
    expect(a).not.toContain("fixtures");
    expect(a).not.toMatch(/[A-Za-z]:[\/]/);
    const text = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--data", DATA], text)).toBe(0);
    expect(text.stdout()).toContain("staleT5Rows: 4");
  });

  it("accepts a ledger snapshot for one side", () => {
    const { code, report } = diff(["--from-ledger", resolve(FX, "snapshot", "from-rows.jsonl")]);
    expect(code).toBe(0);
    expect(report.rows.onlyFrom).toEqual(["r:old"]);
    // every row of the 2.0 side is present in it, except those not on 2.0
    expect(report.rows.onlyTo).toContain("r:new");
    expect(report.rows.onlyTo).toContain("r:t5w3");
  });

  it("counts a row T5 on the old side and not T5 on the new one as stale (a rebuilt ledger)", () => {
    const { code, report } = diff(["--from-ledger", resolve(FX, "snapshot", "from-t5.jsonl")]);
    expect(code).toBe(0);
    // r:keep was T5 on 1.0 and is T2 on 2.0: listed under its old-side battery.
    expect(report.staleT5.byWave.w2).toEqual({ "w2-05-demoted": ["r:keep"] });
    // r:t5fresh is T5 on both sides with 2.0 evidence: not stale.
    expect(JSON.stringify(report.staleT5)).not.toContain("r:t5fresh");
    expect(report.staleT5.count).toBe(5);
  });

  it("accepts a census directory as a snapshot", () => {
    const { code, report } = diff(["--from-ledger", DATA]);
    expect(code).toBe(0);
    expect(report.locators.removed).toEqual(["ui:gone"]);
  });

  it("exits 2 on usage errors", () => {
    for (const argv of [
      [],
      ["--from", "1.0"],
      ["--from", "1.0", "--to", "1.0", "--data", DATA],
      ["--from", "1.0", "--to", "2.0", "--bogus"],
      ["--from", "1.0", "--to", "2.0", "--data", resolve(FX, "snapshot")],
      ["--from", "1.0", "--to", "2.0", "--data", DATA, "--from-ledger", resolve(FX, "nope.jsonl")],
    ]) {
      const io = memoryIo();
      expect(run(argv, io), argv.join(" ")).toBe(2);
    }
  });

  it("exits 3 on a malformed ledger line", () => {
    const io = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--data", resolve(FX, "malformed")], io)).toBe(3);
    expect(io.stderr()).toContain("line 2");
  });

  it("exits 3 on a duplicate row id", () => {
    const io = memoryIo();
    expect(run(["--from", "1.0", "--to", "2.0", "--data", resolve(FX, "dup")], io)).toBe(3);
    expect(io.stderr()).toContain("duplicate id");
  });

  it("compares build tags numerically", () => {
    expect(compareBuilds("1.9.0.37", "1.10.0.1")).toBeLessThan(0);
    expect(compareBuilds("1.8.0.13", "1.8.0.13")).toBe(0);
  });

  it("reads wave and battery from a T5 ref", () => {
    expect(batteryOfRef("w3-23-loc-insert-undo state-readback@1.9.0.37")).toEqual({
      wave: "w3",
      battery: "w3-23-loc-insert-undo",
    });
    expect(batteryOfRef("some probe@1.0")).toBeNull();
  });
});
