import { describe, it, expect } from "vitest";
import { liveGateReason, optionValues, parseArgs } from "../../scripts/live/cli.js";

describe("liveGateReason", () => {
  it("allows a real operation only with really, win32 and a held lease", () => {
    expect(liveGateReason({ really: true, platform: "win32", leaseHeld: true })).toBeNull();
    expect(liveGateReason({ really: false, platform: "win32", leaseHeld: true })).toContain(
      "dry run",
    );
    expect(liveGateReason({ really: true, platform: "linux", leaseHeld: true })).toContain(
      "Windows-only",
    );
    expect(liveGateReason({ really: true, platform: "win32", leaseHeld: false })).toContain(
      "refused",
    );
  });
});

describe("parseArgs", () => {
  it("separates positionals, valued options and switches", () => {
    const a = parseArgs(["status", "--id", "x", "--really", "--purpose=S-C"], ["id", "purpose"]);
    expect(a.positional).toEqual(["status"]);
    expect(a.options).toEqual({ id: "x", purpose: "S-C" });
    expect([...a.flags]).toEqual(["really"]);
  });

  it("rejects a valued option without a value", () => {
    expect(() => parseArgs(["--id", "--really"], ["id"])).toThrow("needs a value");
  });
});

describe("optionValues", () => {
  it("returns every value of a repeated option, in order, in both spellings", () => {
    const argv = ["--probe-pack", "a", "--id", "x", "--probe-pack=b", "--really"];
    expect(optionValues(argv, "probe-pack")).toEqual(["a", "b"]);
    expect(parseArgs(argv, ["probe-pack", "id"]).options["probe-pack"]).toBe("b");
    expect(optionValues(["--id", "x"], "probe-pack")).toEqual([]);
    expect(() => optionValues(["--probe-pack", "--really"], "probe-pack")).toThrow("needs a value");
  });
});
