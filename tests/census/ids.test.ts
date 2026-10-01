import { describe, it, expect } from "vitest";
import { deriveId, escapeSegment, normalizeLabel } from "../../src/census/ids.js";

describe("normalizeLabel", () => {
  it("removes the mnemonic marker and shortcut text", () => {
    expect(normalizeLabel("&File")).toBe("File");
    expect(normalizeLabel("Save &As...\tCtrl+Shift+S")).toBe("Save As...");
    expect(normalizeLabel("Find && Replace")).toBe("Find & Replace");
    expect(normalizeLabel("  Two   words ")).toBe("Two words");
  });
});

describe("deriveId", () => {
  it("derives the plan 4.4 forms", () => {
    expect(
      deriveId({
        dim: "api",
        kind: "method",
        module: "Shared",
        key: { class: "WorldEditorAPI", method: "GetEntity", arity: 2 },
      }),
    ).toBe("api:WorldEditorAPI.GetEntity/2");
    expect(
      deriveId({
        dim: "plugin",
        kind: "plugin-button",
        module: "Shared",
        key: { class: "P", button: "Run" },
      }),
    ).toBe("plugin:P#button:Run");
    expect(
      deriveId({
        dim: "net",
        kind: "net-function",
        module: "none",
        key: { native: "EvaluateScript" },
      }),
    ).toBe("net:native/EvaluateScript");
    expect(
      deriveId({
        dim: "net",
        kind: "net-field",
        module: "none",
        key: { handler: "H", resp: "ok" },
      }),
    ).toBe("net:handler/H#resp:ok");
    expect(
      deriveId({ dim: "cli", kind: "cli-switch", module: "none", key: { switch: "-gproj" } }),
    ).toBe("cli:-gproj");
    expect(deriveId({ dim: "file", kind: "file-type", module: "none", key: { ext: ".ET" } })).toBe(
      "file:.et",
    );
    expect(
      deriveId({
        dim: "schema",
        kind: "schema-key",
        module: "none",
        key: { class: "C", key: "k" },
      }),
    ).toBe("schema:C.k");
    expect(
      deriveId({
        dim: "setting",
        kind: "setting-key",
        module: "none",
        key: { section: "Editor", key: "Auto save" },
      }),
    ).toBe("setting:Editor/Auto save");
    expect(
      deriveId({
        dim: "diag",
        kind: "diag-option",
        module: "none",
        key: { path: ["AI", "Show paths"] },
      }),
    ).toBe("diag:AI/Show paths");
    expect(
      deriveId({
        dim: "mcp",
        kind: "mcp-action",
        module: "none",
        key: { tool: "wb_entities", action: "list" },
      }),
    ).toBe("mcp:action/wb_entities.list");
    expect(
      deriveId({
        dim: "api",
        kind: "attribute",
        module: "Shared",
        key: { class: "SCR_X", attr: "m_iY" },
      }),
    ).toBe("api:SCR_X#attr:m_iY");
  });

  it("uses the Qt object name as the ui join key when present", () => {
    expect(
      deriveId({
        dim: "ui",
        kind: "dock",
        module: "WorldEditor",
        key: { object_name: "dockHierarchy" },
      }),
    ).toBe("ui:WorldEditor/dock/#dockHierarchy");
    expect(
      deriveId({
        dim: "ui",
        kind: "menu-item",
        module: "WorldEditor",
        key: { path: ["&File", "Save/Load"] },
      }),
    ).toBe("ui:WorldEditor/menu-item/File/Save%2FLoad");
  });

  it("rejects a key that does not fit the kind", () => {
    expect(() =>
      deriveId({ dim: "api", kind: "method", module: "Shared", key: { class: "C", method: "M" } }),
    ).toThrow("does not fit");
    expect(() =>
      deriveId({
        dim: "api",
        kind: "method",
        module: "Shared",
        key: { class: "C", method: "M", arity: 0, name: "x" },
      }),
    ).toThrow("does not fit");
  });

  it("falls back to the generic form only when allowed", () => {
    const input = {
      dim: "api" as const,
      kind: "method" as const,
      module: "Shared",
      key: { name: "59 actions" },
    };
    expect(() => deriveId(input)).toThrow("does not fit");
    expect(deriveId(input, { allowGeneric: true })).toBe("api:method/59 actions");
  });
});

describe("escapeSegment", () => {
  it("escapes percent, slash and a leading hash", () => {
    expect(escapeSegment("#a/b%c")).toBe("%23a%2Fb%25c");
  });
});
