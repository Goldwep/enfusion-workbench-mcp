import { describe, it, expect } from "vitest";
import {
  generateServerConfig,
  buildServerConfig,
} from "../../src/templates/server-config.js";
import {
  redactServerConfig,
  REDACTED,
} from "../../src/tools/server-redact.js";

describe("generateServerConfig (v0.9.8.73+ schema)", () => {
  it("returns valid JSON", () => {
    const result = generateServerConfig({ name: "Test Server" });
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
  });

  it("sets server name", () => {
    const result = JSON.parse(generateServerConfig({ name: "My Server" }));
    expect(result.game.name).toBe("My Server");
  });

  it("defaults bindPort to 2001", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test" }));
    expect(result.bindPort).toBe(2001);
    expect(result.gameHostBindPort).toBeUndefined();
  });

  it("uses new field names (no deprecated emission)", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test" }));
    expect(result).toHaveProperty("bindAddress");
    expect(result).toHaveProperty("bindPort");
    expect(result).not.toHaveProperty("gameHostBindAddress");
    expect(result).not.toHaveProperty("gameHostRegisterPort");
    expect(result).not.toHaveProperty("gameHostBindPort");
    expect(result).not.toHaveProperty("gameHostRegisterAddress");
  });

  it("defaults maxPlayers to 32", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test" }));
    expect(result.game.maxPlayers).toBe(32);
  });

  it("defaults visible to false", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test" }));
    expect(result.game.visible).toBe(false);
  });

  it("uses custom bindPort", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test", bindPort: 3000 }));
    expect(result.bindPort).toBe(3000);
  });

  it("uses custom maxPlayers", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test", maxPlayers: 64 }));
    expect(result.game.maxPlayers).toBe(64);
  });

  it("includes a mods array with addon info", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test", modName: "MyMod", modId: "ABCDEF1234567890" }),
    );
    expect(result.game.mods).toEqual([{ modId: "ABCDEF1234567890", name: "MyMod", version: "" }]);
  });

  it("empty mods when no addon info given", () => {
    const result = JSON.parse(generateServerConfig({ name: "Test" }));
    expect(result.game.mods).toEqual([]);
  });

  it("emits passwordAdmin only when non-empty", () => {
    const empty = JSON.parse(generateServerConfig({ name: "Test", passwordAdmin: "" }));
    expect(empty.passwordAdmin).toBeUndefined();
    const set = JSON.parse(generateServerConfig({ name: "Test", passwordAdmin: "hunter2" }));
    expect(set.passwordAdmin).toBe("hunter2");
  });

  it("emits rcon block when password set", () => {
    const result = JSON.parse(
      generateServerConfig({
        name: "Test",
        rcon: { password: "rconpw", port: 19999, permission: "admin" },
      }),
    );
    expect(result.rcon).toBeDefined();
    expect(result.rcon.password).toBe("rconpw");
    expect(result.rcon.port).toBe(19999);
    expect(result.rcon.permission).toBe("admin");
  });
});

describe("redactServerConfig", () => {
  it("redacts passwordAdmin", () => {
    const raw = buildServerConfig({ name: "Test", passwordAdmin: "hunter2" });
    const red = redactServerConfig(raw);
    expect(red.passwordAdmin).toBe(REDACTED);
  });

  it("redacts rcon password", () => {
    const raw = buildServerConfig({
      name: "Test",
      rcon: { password: "rconpw" },
    });
    const red = redactServerConfig(raw);
    expect(red.rcon?.password).toBe(REDACTED);
  });

  it("keeps empty join password as empty (not redacted)", () => {
    const raw = buildServerConfig({ name: "Test", password: "" });
    const red = redactServerConfig(raw);
    expect(red.game.password).toBe("");
  });

  it("redacts non-empty join password", () => {
    const raw = buildServerConfig({ name: "Test", password: "joinpw" });
    const red = redactServerConfig(raw);
    expect(red.game.password).toBe(REDACTED);
  });
});
