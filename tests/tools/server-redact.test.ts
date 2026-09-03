/**
 * Type-enforced redaction lockdown — L9-2 canary tests.
 *
 * The point of these tests is to guarantee that `redactServerConfig`
 * scrubs every known-secret field, and that ANY future schema addition
 * that introduces a new secret-bearing field WILL fail this test until
 * the redactor + redacted types are updated together.
 *
 * Three layers of defense:
 *   1. Whole-object snapshot — exact shape of the redacted output for a
 *      realistic ServerConfig. Any drift forces an explicit review.
 *   2. Field-by-field assertions — each known secret slot is redacted,
 *      each non-secret slot passes through verbatim.
 *   3. Negative search over the stringified output — verifies no raw
 *      password / RCON pwd / persistence API key text survives.
 *
 * The snapshot is the canary. If someone adds e.g. `apiToken` to
 * ServerConfig without teaching the redactor about it, the layer-1 test
 * fails when the new field surfaces in output, and layer-3 fails if the
 * new field carries a value that matches one of the secret strings.
 */

import { describe, it, expect } from "vitest";
import {
  redactServerConfig,
  REDACTED,
  stringifyRedacted,
  type RedactedServerConfig,
  type ServerConfig,
} from "../../src/tools/server-redact.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Distinctive sentinel strings — every secret field uses a different
// value so we can grep the redacted output and verify NONE of them
// survive. Don't share strings across fields or the negative tests
// degrade to a single check.
const SECRET_ADMIN_PWD = "adminS3cret!_DONOT_LEAK";
const SECRET_RCON_PWD = "rconP@ss_DONOT_LEAK";
const SECRET_JOIN_PWD = "joinPassword_DONOT_LEAK";
const SECRET_API_KEY = "x-api-key-DONOT_LEAK-abc123";
const SECRET_AUTH_HEADER = "Bearer DONOT_LEAK_TOKEN_xyz";

const ALL_SECRETS = [
  SECRET_ADMIN_PWD,
  SECRET_RCON_PWD,
  SECRET_JOIN_PWD,
  SECRET_API_KEY,
  SECRET_AUTH_HEADER,
];

/**
 * Realistic ServerConfig with every secret-bearing field populated.
 * Drives both the snapshot test and the leakage scan.
 */
function makeFullConfig(): ServerConfig {
  return {
    dedicatedServerId: "test-server-id-001",
    region: "EU",
    bindAddress: "0.0.0.0",
    bindPort: 2001,
    publicAddress: "203.0.113.10",
    publicPort: 2001,
    a2s: { address: "0.0.0.0", port: 17777 },
    rcon: {
      address: "0.0.0.0",
      port: 19999,
      password: SECRET_RCON_PWD,
      permission: "admin",
      blacklist: [],
      whitelist: [],
      maxClients: 16,
    },
    passwordAdmin: SECRET_ADMIN_PWD,
    admins: ["76561197960287930"],
    game: {
      name: "Test Server",
      password: SECRET_JOIN_PWD,
      scenarioId: "{ABCD1234DEAD5678}Missions/MyMission.conf",
      maxPlayers: 32,
      visible: true,
      gameProperties: {
        serverMaxViewDistance: 2500,
        serverMinGrassDistance: 50,
        fastValidation: true,
        battlEye: true,
        disableThirdPerson: false,
        VONDisableUI: false,
        VONDisableDirectSpeechUI: false,
        VONCanTransmitCrossFaction: false,
        missionHeader: { extra: "metadata" },
      },
      mods: [
        { modId: "591AF5BDA9F6E16F", name: "TestMod", version: "0.1.0", required: true },
      ],
      supportedGameClientTypes: ["PC", "XBL", "PSN"],
    },
    crossPlatform: true,
    operating: {
      lobbyPlayerSynchronise: true,
      joinQueue: { maxSize: 12 },
      disableNavmeshStreaming: [],
      disableServerShutdown: false,
      disableCrashReporter: false,
      disableAI: false,
    },
    persistence: {
      driver: "rest",
      location: "https://persistence.example",
      databases: [
        {
          type: "postgresql",
          name: "primary",
          uri: "postgres://user@host:5432/db",
          options: {
            // headers map — every value treated as secret
            headers: {
              "X-API-KEY": SECRET_API_KEY,
              "Authorization": SECRET_AUTH_HEADER,
            },
            // Non-secret option — should pass through verbatim
            timeoutMs: 30_000,
          },
        },
      ],
    },
  };
}

// ── Layer 1: whole-object snapshot ───────────────────────────────────────────

describe("redactServerConfig — snapshot canary (L9-2)", () => {
  it("produces the exact expected redacted shape", () => {
    const raw = makeFullConfig();
    const redacted = redactServerConfig(raw);

    // Inline snapshot: any change to the redaction shape forces an
    // explicit review (regenerate intentionally with `-u`).
    expect(redacted).toMatchInlineSnapshot(`
      {
        "a2s": {
          "address": "0.0.0.0",
          "port": 17777,
        },
        "admins": [
          "76561197960287930",
        ],
        "bindAddress": "0.0.0.0",
        "bindPort": 2001,
        "crossPlatform": true,
        "dedicatedServerId": "test-server-id-001",
        "game": {
          "gameProperties": {
            "VONCanTransmitCrossFaction": false,
            "VONDisableDirectSpeechUI": false,
            "VONDisableUI": false,
            "battlEye": true,
            "disableThirdPerson": false,
            "fastValidation": true,
            "missionHeader": {
              "extra": "metadata",
            },
            "serverMaxViewDistance": 2500,
            "serverMinGrassDistance": 50,
          },
          "maxPlayers": 32,
          "mods": [
            {
              "modId": "591AF5BDA9F6E16F",
              "name": "TestMod",
              "required": true,
              "version": "0.1.0",
            },
          ],
          "name": "Test Server",
          "password": "<redacted>",
          "scenarioId": "{ABCD1234DEAD5678}Missions/MyMission.conf",
          "supportedGameClientTypes": [
            "PC",
            "XBL",
            "PSN",
          ],
          "visible": true,
        },
        "operating": {
          "disableAI": false,
          "disableCrashReporter": false,
          "disableNavmeshStreaming": [],
          "disableServerShutdown": false,
          "joinQueue": {
            "maxSize": 12,
          },
          "lobbyPlayerSynchronise": true,
        },
        "passwordAdmin": "<redacted>",
        "persistence": {
          "databases": [
            {
              "name": "primary",
              "options": {
                "headers": {
                  "Authorization": "<redacted>",
                  "X-API-KEY": "<redacted>",
                },
                "timeoutMs": 30000,
              },
              "type": "postgresql",
              "uri": "postgres://user@host:5432/db",
            },
          ],
          "driver": "rest",
          "location": "https://persistence.example",
        },
        "publicAddress": "203.0.113.10",
        "publicPort": 2001,
        "rcon": {
          "address": "0.0.0.0",
          "blacklist": [],
          "maxClients": 16,
          "password": "<redacted>",
          "permission": "admin",
          "port": 19999,
          "whitelist": [],
        },
        "region": "EU",
      }
    `);
  });
});

// ── Layer 2: field-by-field assertions ───────────────────────────────────────

describe("redactServerConfig — explicit field assertions", () => {
  it("redacts every secret field", () => {
    const raw = makeFullConfig();
    const r: RedactedServerConfig = redactServerConfig(raw);

    expect(r.passwordAdmin).toBe(REDACTED);
    expect(r.rcon?.password).toBe(REDACTED);
    expect(r.game.password).toBe(REDACTED);
    expect(r.persistence?.databases?.[0]?.options?.headers?.["X-API-KEY"]).toBe(
      REDACTED,
    );
    expect(r.persistence?.databases?.[0]?.options?.headers?.["Authorization"]).toBe(
      REDACTED,
    );
  });

  it("preserves non-secret fields verbatim", () => {
    const raw = makeFullConfig();
    const r = redactServerConfig(raw);

    // Identity / network — passes through.
    expect(r.dedicatedServerId).toBe("test-server-id-001");
    expect(r.region).toBe("EU");
    expect(r.bindAddress).toBe("0.0.0.0");
    expect(r.bindPort).toBe(2001);
    expect(r.publicAddress).toBe("203.0.113.10");
    expect(r.publicPort).toBe(2001);
    expect(r.crossPlatform).toBe(true);

    // a2s — passes through.
    expect(r.a2s).toEqual({ address: "0.0.0.0", port: 17777 });

    // Game (minus password) — passes through.
    expect(r.game.name).toBe("Test Server");
    expect(r.game.scenarioId).toBe("{ABCD1234DEAD5678}Missions/MyMission.conf");
    expect(r.game.maxPlayers).toBe(32);
    expect(r.game.visible).toBe(true);
    expect(r.game.gameProperties).toEqual({
      serverMaxViewDistance: 2500,
      serverMinGrassDistance: 50,
      fastValidation: true,
      battlEye: true,
      disableThirdPerson: false,
      VONDisableUI: false,
      VONDisableDirectSpeechUI: false,
      VONCanTransmitCrossFaction: false,
      missionHeader: { extra: "metadata" },
    });
    expect(r.game.mods).toHaveLength(1);
    expect(r.game.mods[0]?.modId).toBe("591AF5BDA9F6E16F");
    expect(r.game.supportedGameClientTypes).toEqual(["PC", "XBL", "PSN"]);

    // Rcon (minus password) — passes through.
    expect(r.rcon?.address).toBe("0.0.0.0");
    expect(r.rcon?.port).toBe(19999);
    expect(r.rcon?.permission).toBe("admin");
    expect(r.rcon?.maxClients).toBe(16);

    // Persistence (non-header, non-secret options) — passes through.
    expect(r.persistence?.driver).toBe("rest");
    expect(r.persistence?.location).toBe("https://persistence.example");
    expect(r.persistence?.databases?.[0]?.type).toBe("postgresql");
    expect(r.persistence?.databases?.[0]?.name).toBe("primary");
    expect(r.persistence?.databases?.[0]?.uri).toBe(
      "postgres://user@host:5432/db",
    );
    expect(
      r.persistence?.databases?.[0]?.options?.["timeoutMs"],
    ).toBe(30_000);

    // PII but not secret.
    expect(r.admins).toEqual(["76561197960287930"]);
  });

  it("preserves empty join password as empty string (not <redacted>)", () => {
    const raw = makeFullConfig();
    raw.game.password = "";
    const r = redactServerConfig(raw);
    expect(r.game.password).toBe("");
  });

  it("omits passwordAdmin when absent in raw", () => {
    const raw = makeFullConfig();
    delete raw.passwordAdmin;
    const r = redactServerConfig(raw);
    expect(r.passwordAdmin).toBeUndefined();
  });

  it("omits rcon block when absent in raw", () => {
    const raw = makeFullConfig();
    delete raw.rcon;
    const r = redactServerConfig(raw);
    expect(r.rcon).toBeUndefined();
  });

  it("omits persistence block when absent in raw", () => {
    const raw = makeFullConfig();
    delete raw.persistence;
    const r = redactServerConfig(raw);
    expect(r.persistence).toBeUndefined();
  });

  it("redacts a persistence DB even when only headers are present (no other opts)", () => {
    const raw = makeFullConfig();
    raw.persistence!.databases![0]!.options = {
      headers: { "X-API-KEY": SECRET_API_KEY },
    };
    const r = redactServerConfig(raw);
    expect(r.persistence?.databases?.[0]?.options?.headers?.["X-API-KEY"]).toBe(
      REDACTED,
    );
  });

  it("does not mutate the raw input", () => {
    const raw = makeFullConfig();
    const before = JSON.stringify(raw);
    redactServerConfig(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

// ── Layer 3: negative search — no secret string survives ─────────────────────

describe("redactServerConfig — leak scan", () => {
  it("no raw secret value appears in the redacted output (object)", () => {
    const raw = makeFullConfig();
    const r = redactServerConfig(raw);
    const dump = JSON.stringify(r);
    for (const s of ALL_SECRETS) {
      expect(dump, `secret leak in redacted object: ${s}`).not.toContain(s);
    }
  });

  it("no raw secret value appears in the redacted output (pretty-printed)", () => {
    const raw = makeFullConfig();
    const r = redactServerConfig(raw);
    const pretty = stringifyRedacted(r);
    for (const s of ALL_SECRETS) {
      expect(pretty, `secret leak in pretty-printed output: ${s}`).not.toContain(
        s,
      );
    }
    // Sanity — the redacted token MUST appear (we'd never expect a clean
    // config to have zero secrets, so the test should detect the
    // "everything is empty" regression too).
    expect(pretty).toContain("<redacted>");
  });
});
