import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_GATED,
  BI_HANDLERS,
  BI_TIMEOUTS,
  VERIFIED_READ,
  callVerifiedRead,
  findHandler,
  requestSchema,
  timeoutFor,
  verifiedCallSchema,
} from "../../src/workbench/bi-handlers.js";
import { MODAL_RESET_MIN_MS, WEDGE_AFTER_MS, classifyTimeout } from "../../src/workbench/client.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface E04Row {
  kind: string;
  label: string;
  ref: string;
  key: { handler?: string; req?: string };
  signature?: string;
  risk_hint?: string;
}

const E04: E04Row[] = readFileSync(
  join(ROOT, "data/census/observations/E04/1.9.0.37.jsonl"),
  "utf-8",
)
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => JSON.parse(l) as E04Row);

describe("the catalog matches E04", () => {
  const handlers = E04.filter((r) => r.kind === "net-handler" && r.label !== "ExampleCall");

  it("lists every compiled handler (ExampleCall is DOXYGEN-only)", () => {
    expect(BI_HANDLERS.map((h) => h.name)).toEqual(handlers.map((h) => h.label).sort());
    expect(BI_HANDLERS).toHaveLength(42);
  });

  it("declares exactly E04's request fields and types, and its source ref", () => {
    for (const h of BI_HANDLERS) {
      const fields = E04.filter(
        (r) => r.kind === "net-field" && r.key.handler === h.name && r.key.req,
      )
        .map((r) => [r.label, r.signature])
        .sort();
      expect(
        [...h.request].map(([k, t]) => [k, t]),
        h.name,
      ).toEqual(fields);
      expect(h.ref, h.name).toBe(handlers.find((r) => r.label === h.name)!.ref);
    }
  });

  it("classes E04's mutating hints as mutating", () => {
    const hinted = E04.filter((r) => r.kind === "net-handler" && r.risk_hint === "mutating").map(
      (r) => r.label,
    );
    expect(hinted).toHaveLength(8);
    for (const n of hinted) expect(findHandler(n)!.class, n).toBe("mutating");
  });
});

describe("the verified read subset (DEC-047 L6)", () => {
  it("is 14 read handlers verified live; LocatePrefabsFromPath is the fifteenth, not verified", () => {
    expect(VERIFIED_READ).toHaveLength(14);
    const reads = BI_HANDLERS.filter((h) => h.class === "read").map((h) => h.name);
    expect(reads).toHaveLength(15);
    expect(reads.filter((n) => !(VERIFIED_READ as readonly string[]).includes(n))).toEqual([
      AUTH_GATED,
    ]);
    for (const n of VERIFIED_READ) expect(findHandler(n)!.verifiedLive, n).toBe(true);
    expect(findHandler(AUTH_GATED)!.verifiedLive).toBe(false);
  });

  it("request schemas refuse undeclared keys, missing keys and wrong types", () => {
    const s = requestSchema(findHandler("GetResourceInfo")!);
    expect(s.safeParse({ path: "a.et", expandResource: false }).success).toBe(true);
    expect(s.safeParse({ path: "a.et", expandResource: false, extra: 1 }).success).toBe(false);
    expect(s.safeParse({ path: "a.et", expandResource: "no" }).success).toBe(false);
    expect(s.safeParse({ path: "a.et" }).success).toBe(false);
    const child = requestSchema(findHandler("GetPrefabChildInfo")!);
    expect(
      child.safeParse({ resourceName: "x", childIdx: [0.5], expandResource: false }).success,
    ).toBe(false);
  });

  it("the discriminated union covers exactly the 14", () => {
    const u = verifiedCallSchema();
    expect(u.safeParse({ handler: "GetLoadedProjects" }).success).toBe(true);
    expect(u.safeParse({ handler: "CheckGUID", request: { matName: "x" } }).success).toBe(true);
    expect(u.safeParse({ handler: AUTH_GATED, request: {} }).success).toBe(false);
    expect(u.safeParse({ handler: "RegisterResource", request: { path: [] } }).success).toBe(false);
  });

  it("each sender sends its own name, only declared keys, access read", async () => {
    for (const n of VERIFIED_READ) {
      const row = findHandler(n)!;
      const req: Record<string, unknown> = {};
      for (const [k, t] of row.request)
        req[k] = t === "int" ? 0 : t === "bool" ? false : t.startsWith("array") ? [] : "x";
      const call = vi.fn().mockResolvedValue({});
      await callVerifiedRead({ call } as never, n, req);
      expect(call).toHaveBeenCalledTimes(1);
      const [name, sent, opts] = call.mock.calls[0];
      expect(name).toBe(n);
      expect(Object.keys(sent).sort()).toEqual(row.request.map(([k]) => k).sort());
      expect(opts.access).toBe("read");
    }
  });

  it("timeouts: past the modal reset so a blocked read reports MODAL_OPEN, not TIMEOUT", () => {
    expect(timeoutFor("GetGameMaterials", {})).toBe(BI_TIMEOUTS.heavy);
    for (const n of VERIFIED_READ.filter((x) => x !== "GetGameMaterials")) {
      const t = timeoutFor(n, { expandResource: true });
      expect(t, n).toBeGreaterThan(MODAL_RESET_MIN_MS + 20_000);
      expect(classifyTimeout(t, WEDGE_AFTER_MS, "read"), n).toBe("TIMEOUT");
    }
  });
});
