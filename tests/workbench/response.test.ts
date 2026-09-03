import { describe, it, expect } from "vitest";
import {
  isHandlerError,
  handlerErrorMessage,
  handlerErrorResponse,
} from "../../src/workbench/response.js";

describe("isHandlerError", () => {
  it("returns true when payload status is 'error'", () => {
    expect(isHandlerError({ status: "error", message: "boom" })).toBe(true);
  });

  it("returns false when payload status is 'ok'", () => {
    expect(isHandlerError({ status: "ok" })).toBe(false);
  });

  it("returns false when status field is absent", () => {
    expect(isHandlerError({ mode: "edit", entities: [] })).toBe(false);
  });

  it("returns false for non-object inputs", () => {
    expect(isHandlerError(null)).toBe(false);
    expect(isHandlerError(undefined)).toBe(false);
    expect(isHandlerError("error")).toBe(false);
    expect(isHandlerError(42)).toBe(false);
  });
});

describe("handlerErrorMessage", () => {
  it("prefers the 'message' field", () => {
    expect(handlerErrorMessage({ status: "error", message: "no world editor" })).toBe(
      "no world editor",
    );
  });

  it("falls back to the 'error' field", () => {
    expect(handlerErrorMessage({ status: "error", error: "bad path" })).toBe("bad path");
  });

  it("returns a generic message when none present", () => {
    expect(handlerErrorMessage({ status: "error" })).toBe("(no message)");
    expect(handlerErrorMessage(null)).toBe("(no message)");
  });
});

describe("handlerErrorResponse", () => {
  it("sets isError and includes the handler message", () => {
    const resp = handlerErrorResponse({ status: "error", message: "WorldEditorAPI not available" });
    expect(resp.isError).toBe(true);
    expect(resp.content).toHaveLength(1);
    expect(resp.content[0].type).toBe("text");
    expect(resp.content[0].text).toContain("WorldEditorAPI not available");
  });

  it("uses the provided prefix", () => {
    const resp = handlerErrorResponse({ status: "error", message: "boom" }, undefined, "Error creating entity");
    expect(resp.content[0].text).toContain("Error creating entity: boom");
  });
});
