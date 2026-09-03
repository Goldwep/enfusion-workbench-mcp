import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  readRedactedServerConfig,
  rejectFlagLikePath,
} from "../../src/server-mgmt/redact-io.js";

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-redact-io");

function setup(name: string, content: string): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const full = join(TEST_DIR, name);
  writeFileSync(full, content, "utf-8");
  return full;
}

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const SAMPLE_CONFIG_WITH_SECRETS = JSON.stringify({
  bindAddress: "0.0.0.0",
  bindPort: 2001,
  a2s: { address: "0.0.0.0", port: 17777 },
  rcon: {
    address: "0.0.0.0",
    port: 19999,
    password: "totallySensitiveValue!",
    permission: "admin",
  },
  passwordAdmin: "adminSecret",
  game: {
    name: "Test Server",
    password: "joinSecret",
    scenarioId: "{ABCD1234DEAD5678}Missions/M.conf",
    maxPlayers: 32,
    visible: false,
    gameProperties: {},
    mods: [],
  },
});

describe("server-mgmt/redact-io — rejectFlagLikePath", () => {
  it("accepts a normal path", () => {
    expect(() => rejectFlagLikePath("server.json", "p")).not.toThrow();
    expect(() => rejectFlagLikePath("C:\\Path\\server.json", "p")).not.toThrow();
  });

  it("rejects a flag-smuggling path", () => {
    expect(() => rejectFlagLikePath("-config=evil.json", "p")).toThrow(/CLI flag/);
    expect(() => rejectFlagLikePath("--scenarioId=bad", "p")).toThrow(/CLI flag/);
  });

  it("rejects empty / non-string inputs", () => {
    expect(() => rejectFlagLikePath("", "p")).toThrow();
    // @ts-expect-error — testing the runtime guard
    expect(() => rejectFlagLikePath(null, "p")).toThrow();
  });
});

describe("server-mgmt/redact-io — readRedactedServerConfig", () => {
  it("redacts every secret field", () => {
    const path = setup("server.json", SAMPLE_CONFIG_WITH_SECRETS);
    const { config, absolutePath } = readRedactedServerConfig(path);
    expect(absolutePath).toBe(resolve(path));
    expect(config.passwordAdmin).toBe("<redacted>");
    expect(config.rcon?.password).toBe("<redacted>");
    expect(config.game.password).toBe("<redacted>");
    // Non-secret fields pass through.
    expect(config.bindAddress).toBe("0.0.0.0");
    expect(config.game.name).toBe("Test Server");
    expect(config.game.scenarioId).toBe("{ABCD1234DEAD5678}Missions/M.conf");
  });

  it("never echoes the raw password text in the returned object", () => {
    const path = setup("server.json", SAMPLE_CONFIG_WITH_SECRETS);
    const { config } = readRedactedServerConfig(path);
    const dump = JSON.stringify(config);
    expect(dump).not.toContain("totallySensitiveValue!");
    expect(dump).not.toContain("adminSecret");
    expect(dump).not.toContain("joinSecret");
  });

  it("preserves empty join password as empty (not <redacted>)", () => {
    const cfg = JSON.parse(SAMPLE_CONFIG_WITH_SECRETS);
    cfg.game.password = "";
    const path = setup("server.json", JSON.stringify(cfg));
    const { config } = readRedactedServerConfig(path);
    expect(config.game.password).toBe("");
  });

  it("rejects flag-smuggling path BEFORE resolve", () => {
    expect(() => readRedactedServerConfig("-config=evil.json")).toThrow(/CLI flag/);
  });

  it("throws when the file is missing", () => {
    const missing = join(TEST_DIR, "does-not-exist.json");
    rmSync(missing, { force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    expect(() => readRedactedServerConfig(missing)).toThrow(/not found/);
  });

  it("throws a parse error for malformed JSON", () => {
    const path = setup("server.json", "{ not valid json");
    expect(() => readRedactedServerConfig(path)).toThrow(/Failed to parse/);
  });
});
