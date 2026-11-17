/**
 * loadConfig — values set in a config file must survive auto-derivation
 * (4-tier merge, top wins: env > home config > package config > defaults).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/config.js";

describe("loadConfig — config-file values beat auto-derivation", () => {
  let dir: string;
  let homeConfigPath: string;
  const missingLocal = () => join(dir, "no-such-local.json");

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "load-config-"));
    homeConfigPath = join(dir, "config.json");
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps gamePath, corePath and logsPath from the home config file", () => {
    const tools = join(dir, "Tools", "Arma Reforger Tools");
    const game = join(dir, "Game", "Arma Reforger");
    const core = join(dir, "CoreElsewhere");
    const logs = join(dir, "LogsElsewhere");
    const project = join(dir, "Profile", "addons");
    // A sibling logs dir exists, so the derivation would fire if allowed.
    mkdirSync(join(dir, "Profile", "logs"), { recursive: true });
    writeFileSync(
      homeConfigPath,
      JSON.stringify({ workbenchPath: tools, gamePath: game, corePath: core, logsPath: logs, projectPath: project }),
    );
    const cfg = loadConfig({ env: {}, homeConfigPath, localConfigPath: missingLocal() });
    expect(cfg.gamePath).toBe(game);
    expect(cfg.corePath).toBe(core);
    expect(cfg.logsPath).toBe(logs);
  });

  it("still derives values the config file leaves unset", () => {
    const tools = join(dir, "Tools2", "Arma Reforger Tools");
    const game = join(dir, "Tools2", "Arma Reforger");
    mkdirSync(join(game, "addons"), { recursive: true });
    writeFileSync(homeConfigPath, JSON.stringify({ workbenchPath: tools }));
    const cfg = loadConfig({ env: {}, homeConfigPath, localConfigPath: missingLocal() });
    expect(cfg.gamePath).toBe(resolve(tools, "..", "Arma Reforger"));
    expect(cfg.corePath).toBe(join(tools, "Workbench", "addons"));
  });

  it("env vars still override the config file", () => {
    const game = join(dir, "EnvGame");
    writeFileSync(homeConfigPath, JSON.stringify({ gamePath: join(dir, "FileGame") }));
    const cfg = loadConfig({
      env: { ENFUSION_GAME_PATH: game },
      homeConfigPath,
      localConfigPath: missingLocal(),
    });
    expect(cfg.gamePath).toBe(game);
  });
});
