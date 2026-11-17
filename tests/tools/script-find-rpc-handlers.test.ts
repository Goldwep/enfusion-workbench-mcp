import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findRpcHandlers } from "../../src/tools/script-find-rpc-handlers.js";

// Phase-7 integration: Enforce's RPC attribute is RplRpc. The default
// filter must find it, not only the older `RPC` spelling.
describe("findRpcHandlers default attribute", () => {
  const root = mkdtempSync(join(tmpdir(), "emcp-rpc-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "Scripts"), { recursive: true });
  writeFileSync(
    join(root, "Scripts", "Net.c"),
    [
      "class TAG_Net",
      "{",
      "\t[RplRpc(RplChannel.Reliable, RplRcver.Server)]",
      "\tprotected void RpcAsk_Do(int a)",
      "\t{",
      "\t}",
      "",
      "\t[RPC()]",
      "\tvoid OldStyle()",
      "\t{",
      "\t}",
      "}",
      "",
    ].join("\n"),
  );

  it("matches RplRpc and RPC by default", () => {
    const names = findRpcHandlers(root).map((h) => h.methodName);
    expect(names).toEqual(["OldStyle", "RpcAsk_Do"]);
  });

  it("an explicit attribute name matches only that name", () => {
    const names = findRpcHandlers(root, { attributeName: "RplRpc" }).map((h) => h.methodName);
    expect(names).toEqual(["RpcAsk_Do"]);
  });
});
