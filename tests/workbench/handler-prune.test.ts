import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HANDLER_FILE_PATTERN, pruneStaleHandlers } from "../../src/workbench/handler-prune.js";
import { WorkbenchClient } from "../../src/workbench/client.js";
import { installHandlers } from "../../scripts/live/launch.js";

const BUNDLED = resolve("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const bundleFiles = (): string[] => readdirSync(BUNDLED).filter((f) => f.endsWith(".c"));

/** A project folder with an installed handler folder holding stale, foreign and old bundle files. */
function project(root: string, name = "EMCP2_sandbox"): { mod: string; handlers: string } {
  const mod = join(root, name);
  const handlers = join(mod, "Scripts", "WorkbenchGame", "EnfusionMCP");
  mkdirSync(handlers, { recursive: true });
  writeFileSync(join(mod, `${name}.gproj`), "GameProject {\n}\n");
  // Retired handlers (session 023: EMCP_WB_GetEntity, EMCP_WB_ListEntities).
  writeFileSync(join(handlers, "EMCP_WB_GetEntity.c"), "// retired");
  writeFileSync(join(handlers, "EMCP_WB_ListEntities.c"), "// retired");
  // An old copy of a bundle file: the install must replace it.
  writeFileSync(join(handlers, "EMCP_WB_Ping.c"), "// old ping");
  // Foreign files: another name, another extension, a sub-folder, a file beside the folder.
  writeFileSync(join(handlers, "Keep_Me.c"), "// not ours");
  writeFileSync(join(handlers, "EMCP_WB_Notes.txt"), "notes");
  writeFileSync(join(handlers, "EMCP_Other.c"), "// other prefix");
  mkdirSync(join(handlers, "EMCP_WB_Sub.c"));
  writeFileSync(join(handlers, "EMCP_WB_Sub.c", "EMCP_WB_Inner.c"), "// under a sub-folder");
  writeFileSync(join(mod, "Scripts", "WorkbenchGame", "EMCP_WB_Beside.c"), "// outside the folder");
  return { mod, handlers };
}

function expectForeignKept(mod: string, handlers: string): void {
  expect(existsSync(join(handlers, "Keep_Me.c"))).toBe(true);
  expect(existsSync(join(handlers, "EMCP_WB_Notes.txt"))).toBe(true);
  expect(existsSync(join(handlers, "EMCP_Other.c"))).toBe(true);
  expect(existsSync(join(handlers, "EMCP_WB_Sub.c", "EMCP_WB_Inner.c"))).toBe(true);
  expect(existsSync(join(mod, "Scripts", "WorkbenchGame", "EMCP_WB_Beside.c"))).toBe(true);
}

function expectInstalled(handlers: string): void {
  for (const f of bundleFiles())
    expect(readFileSync(join(handlers, f)).equals(readFileSync(join(BUNDLED, f))), f).toBe(true);
  expect(readFileSync(join(handlers, "EMCP_WB_Ping.c"), "utf-8")).not.toBe("// old ping");
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "emcp-prune-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pruneStaleHandlers", () => {
  it("matches EMCP_WB_*.c names only", () => {
    expect(HANDLER_FILE_PATTERN.test("EMCP_WB_Ping.c")).toBe(true);
    for (const n of [
      "EMCP_WB_.c",
      "EMCP_Other.c",
      "Keep_Me.c",
      "EMCP_WB_Ping.c.bak",
      "x/EMCP_WB_A.c",
    ])
      expect(HANDLER_FILE_PATTERN.test(n), n).toBe(false);
  });

  it("lists the stale files on a dry run and deletes only them with really", () => {
    const { mod, handlers } = project(root);
    const keep = bundleFiles();
    const dry = pruneStaleHandlers(handlers, keep, { really: false });
    expect(dry).toEqual(["EMCP_WB_GetEntity.c", "EMCP_WB_ListEntities.c"]);
    expect(existsSync(join(handlers, "EMCP_WB_GetEntity.c"))).toBe(true);
    const removed = pruneStaleHandlers(handlers, keep, { really: true });
    expect(removed).toEqual(dry);
    expect(existsSync(join(handlers, "EMCP_WB_GetEntity.c"))).toBe(false);
    expect(existsSync(join(handlers, "EMCP_WB_ListEntities.c"))).toBe(false);
    // A bundle file is never pruned; foreign files stay.
    expect(existsSync(join(handlers, "EMCP_WB_Ping.c"))).toBe(true);
    expectForeignKept(mod, handlers);
    expect(pruneStaleHandlers(handlers, keep, { really: true })).toEqual([]);
  });

  it("compares names case-insensitively and answers [] for a missing folder", () => {
    const { handlers } = project(root);
    const removed = pruneStaleHandlers(
      handlers,
      bundleFiles().map((f) => f.toUpperCase()),
      { really: false },
    );
    expect(removed).not.toContain("EMCP_WB_Ping.c");
    expect(pruneStaleHandlers(join(root, "nowhere"), [], { really: true })).toEqual([]);
  });
});

describe("the installers prune after the copy", () => {
  it("launch.ts --install-handlers: stale removed, foreign kept, bundle file updated", () => {
    const { mod, handlers } = project(root);
    const dry = installHandlers(mod, { really: false });
    expect(dry.removed).toEqual(["EMCP_WB_GetEntity.c", "EMCP_WB_ListEntities.c"]);
    expect(existsSync(join(handlers, "EMCP_WB_GetEntity.c"))).toBe(true);
    const real = installHandlers(mod, { really: true });
    expect(real.removed).toEqual(["EMCP_WB_GetEntity.c", "EMCP_WB_ListEntities.c"]);
    expect(existsSync(join(handlers, "EMCP_WB_GetEntity.c"))).toBe(false);
    expect(existsSync(join(handlers, "EMCP_WB_ListEntities.c"))).toBe(false);
    expectInstalled(handlers);
    expectForeignKept(mod, handlers);
  });

  it("WorkbenchClient.installHandlerScripts: stale removed, foreign kept, bundle file updated", () => {
    const { mod, handlers } = project(root, "SomeUserMod");
    const client = new WorkbenchClient("127.0.0.1", 1);
    (
      client as unknown as { installHandlerScripts(d: string, f?: boolean): void }
    ).installHandlerScripts(mod);
    expect(existsSync(join(handlers, "EMCP_WB_GetEntity.c"))).toBe(false);
    expect(existsSync(join(handlers, "EMCP_WB_ListEntities.c"))).toBe(false);
    expectInstalled(handlers);
    expectForeignKept(mod, handlers);
  });

  it("cleanupHandlerScripts still removes the whole handler folder (before publishing)", () => {
    const { mod, handlers } = project(root, "SomeUserMod");
    const client = new WorkbenchClient("127.0.0.1", 1);
    expect(client.cleanupHandlerScripts(mod)).toBe(true);
    expect(existsSync(handlers)).toBe(false);
    // The file beside the folder is not the cleanup's either.
    expect(existsSync(join(mod, "Scripts", "WorkbenchGame", "EMCP_WB_Beside.c"))).toBe(true);
  });
});
