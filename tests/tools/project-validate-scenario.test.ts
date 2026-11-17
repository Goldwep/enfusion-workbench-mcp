import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerProjectValidate } from "../../src/tools/project-validate.js";
import { generateConfig } from "../../src/templates/config.js";
import { captureTool, textOf } from "./_tool-harness.js";

describe("project_validate scope=scenario", () => {
  const handler = captureTool(registerProjectValidate);
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pv-scenario-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(name: string, body: string): Promise<string> {
    const p = join(dir, name);
    writeFileSync(p, body, "utf-8");
    const r = await handler({ scope: "scenario", target: p });
    return textOf(r);
  }

  it("accepts the native World property of a mission header", async () => {
    const text = await run(
      "native.conf",
      `SCR_MissionHeaderCampaign {\n World "{853E92315D1D9EFE}worlds/Eden/Eden.ent"\n m_sName "X"\n}\n`,
    );
    expect(text).toContain("0 errors");
  });

  it("accepts the headers config_create writes (Conflict and SF)", async () => {
    for (const mode of ["Conflict", "SF"] as const) {
      const body = generateConfig({
        configType: "mission-header",
        name: `T_${mode}`,
        missionMode: mode,
        worldPath: "{853E92315D1D9EFE}worlds/Eden/Eden.ent",
      } as Parameters<typeof generateConfig>[0]);
      const text = await run(`gen_${mode}.conf`, body);
      expect(text, mode).toContain("0 errors");
    }
  });

  it("still accepts the legacy m_sWorld key", async () => {
    const text = await run("legacy.conf", `SCR_MissionHeader {\n m_sWorld "{DC924A8DDECC73AD}worlds/MP/CTI.ent"\n}\n`);
    expect(text).toContain("0 errors");
  });

  it("reports an error when no world is declared", async () => {
    const text = await run("noworld.conf", `SCR_MissionHeader {\n m_sName "X"\n}\n`);
    expect(text).toContain("1 error");
    expect(text).toContain("Scenario does not declare a world");
  });
});
