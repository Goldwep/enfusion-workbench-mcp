import { describe, it, expect } from "vitest";
import { liveGateReason, parseArgs } from "../../scripts/live/cli.js";

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
