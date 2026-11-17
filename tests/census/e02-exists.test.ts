/**
 * exists.ts with the E02 source index (DEC-018): a symbol the E02 / E05 /
 * E04 observations do not know is looked up in the source index of the
 * build when that artifact is present, and the answer says which source
 * answered. Exact matching and the NO DATA exit code are kept.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceIndex, saveSourceIndex } from "../../src/census/source-index.js";
import { run as runExists } from "../../scripts/census/exists.js";
import { apiClass, apiMethod, makeCensus, runIn, writeObservations } from "./helpers.js";

const BUILD = "1.0.0.1";

/** An artifacts folder (outside any git tree) holding a small source index for BUILD. */
function artifacts(): string {
  const dir = mkdtempSync(join(tmpdir(), "e02-exists-"));
  const ix = buildSourceIndex(
    [
      {
        path: "scripts/GameLib/generated/WorkbenchAPI/Modules/WBModuleDef.c",
        text: "class WBModuleDef\n{\n\tproto external bool Save();\n}\n",
      },
      {
        path: "scripts/GameLib/generated/WorkbenchAPI/Modules/DialogueEditor.c",
        text: "class DialogueEditor : WBModuleDef\n{\n\tproto external int GetCurrentNode();\n}\n",
      },
      {
        path: "scripts/Game/Weapons/SCR_Gun.c",
        text: "enum EGunMode\n{\n\tSAFE,\n\tAUTO = 2\n}\nclass SCR_Gun\n{\n\tstatic int Fire(int rounds, bool loud = true);\n\tint m_iAmmo;\n}\n",
      },
    ],
    { build: BUILD },
  );
  saveSourceIndex(ix, { dir });
  return dir;
}

describe("exists.ts with the E02 source index", () => {
  it("answers from the source index when no observation file exists, and names the source", () => {
    const fx = makeCensus(BUILD);
    const r = runIn(fx, runExists, ["SCR_Gun.Fire", "--artifacts", artifacts()]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("FOUND SCR_Gun.Fire");
    expect(r.stdout).toContain(
      "SCR_Gun.Fire/2 | static-method | source-index@1.0.0.1 | pak:scripts/Game/Weapons/SCR_Gun.c#L8",
    );
    expect(r.stdout).toContain("answered by: E02 source index for build 1.0.0.1");
  });

  it("answers from observation rows first and says so", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("SCR_Gun"), apiMethod("SCR_Gun", "Fire", 2)]);
    const r = runIn(fx, runExists, ["SCR_Gun.Fire", "--artifacts", artifacts()]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("api:SCR_Gun.Fire/2 | method | E02@1.0.0.1");
    expect(r.stdout).toContain("answered by: observation rows (E02)");
    expect(r.stdout).not.toContain("source-index@");
  });

  it("falls back to the source index for a symbol the observations do not know", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("WBModuleDef")]);
    const r = runIn(fx, runExists, ["DialogueEditor.Save", "--artifacts", artifacts()]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      "WBModuleDef.Save/0 | method | source-index@1.0.0.1 | pak:scripts/GameLib/generated/WorkbenchAPI/Modules/WBModuleDef.c#L3 | inherited from WBModuleDef",
    );
    const enumValue = runIn(fx, runExists, ["EGunMode.AUTO", "--artifacts", artifacts()]);
    expect(enumValue.code).toBe(0);
    expect(enumValue.stdout).toContain(
      "EGunMode.AUTO | enum-value | source-index@1.0.0.1 | pak:scripts/Game/Weapons/SCR_Gun.c#L4",
    );
    expect(runIn(fx, runExists, ["api:SCR_Gun.Fire/2", "--artifacts", artifacts()]).code).toBe(0);
    expect(runIn(fx, runExists, ["api:SCR_Gun.Fire/1", "--artifacts", artifacts()]).code).toBe(1);
    expect(runIn(fx, runExists, ["SCR_Gun.m_iAmmo", "--artifacts", artifacts()]).code).toBe(0);
  });

  it("keeps exact matching: a prefix is NOT FOUND with near candidates, case needs --ci", () => {
    const fx = makeCensus(BUILD);
    const dir = artifacts();
    const r = runIn(fx, runExists, ["SCR_Gun.Fir", "--artifacts", dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("NOT FOUND: SCR_Gun.Fir (searched source-index@1.0.0.1)");
    expect(r.stdout).toContain("near: SCR_Gun.Fire");
    expect(runIn(fx, runExists, ["scr_gun.fire", "--artifacts", dir]).code).toBe(1);
    expect(runIn(fx, runExists, ["scr_gun.fire", "--ci", "--artifacts", dir]).code).toBe(0);
  });

  it("says which source answered in --json", () => {
    const fx = makeCensus(BUILD);
    const r = runIn(fx, runExists, ["Fire", "--json", "--artifacts", artifacts()]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j).toMatchObject({
      ok: true,
      found: true,
      answered_by: "source-index",
      matches: [
        {
          source: "source-index",
          symbol: "SCR_Gun.Fire/2",
          kind: "static-method",
          ref: "pak:scripts/Game/Weapons/SCR_Gun.c#L8",
          signature: "static int Fire(int rounds, bool loud = true)",
        },
      ],
    });
  });

  it("keeps NO DATA (exit 2) when neither observations nor a source index exist", () => {
    const fx = makeCensus(BUILD);
    const empty = mkdtempSync(join(tmpdir(), "e02-exists-empty-"));
    const r = runIn(fx, runExists, ["SCR_Gun", "--artifacts", empty]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("NO DATA");
    // The source index of another build does not answer for this one.
    expect(
      runIn(fx, runExists, ["SCR_Gun", "--build", "2.0.0.0", "--artifacts", artifacts()]).code,
    ).toBe(2);
  });
});
