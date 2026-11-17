/**
 * The W1 play recorder plugin (EMCP_WB_PlayRecorder.c, phase5-w1-spec.md section 2.6, OD-7)
 * checked over its Enforce text offline: a World Editor plugin overriding the two play-mode events
 * with the WorldEditorPlugin signatures of build 1.9.0.37, a static ring buffer of 32 rows, and no
 * Run, settings, file or banned call. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { denyFindings } from "../../scripts/enforce-lint.js";

const FILE = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_PlayRecorder.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const world = readFileSync(
  join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP", "EMCP_WB_World.c"),
  "utf-8",
);

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const c = code(src);

describe("EMCP_WB_PlayRecorder", () => {
  it("is a World Editor plugin registered on the World Editor module only", () => {
    expect(c).toMatch(
      /\[WorkbenchPluginAttribute\(name: "EMCP Play Recorder", [^\]]*wbModules: \{"WorldEditor"\}\)\]\s*class EMCP_WB_PlayRecorder : WorldEditorPlugin/,
    );
  });

  it("overrides the two play-mode events with the 1.9.0.37 signatures", () => {
    expect(c).toContain(
      "override void OnGameModeStarted(string worldName, string gameMode, bool playFromCameraPos, vector cameraPosition, vector cameraAngles)",
    );
    expect(c).toContain("override void OnGameModeEnded()");
  });

  it("has no Run, no settings dialog and no NET handler surface (OD-7: no UI action)", () => {
    expect(c).not.toMatch(/\bvoid Run\(|\bConfigure\b|NetApiHandler|JsonApiStruct/);
  });

  it("keeps a ring buffer of 32 rows with a tick from System.GetTickCount", () => {
    expect(c).toContain("static const int CAPACITY = 32;");
    expect(c).toContain("int tick = System.GetTickCount(0);");
    expect(c).toMatch(
      /while \(s_Rows\.Count\(\) > CAPACITY\)\s*\{\s*s_Rows\.RemoveOrdered\(0\);\s*s_Seqs\.RemoveOrdered\(0\);/,
    );
    expect(c).toContain(
      'string row = s_LastSeq.ToString() + "|" + tick.ToString() + "|" + eventName + "|" + world + "|" + gameMode + "|" + camera;',
    );
  });

  it("scrubs the home folder from the world name", () => {
    expect(c).toContain("s_World = EMCP_WB_Guard.ScrubHome(worldName);");
  });

  it("answers what EMCP_WB_World reads", () => {
    expect(c).toContain("static int LastSeq()");
    expect(c).toContain("static int After(int afterSeq, notnull array<string> outRows)");
    expect(code(world)).toContain("EMCP_WB_PlayRecorder.After(afterSeq, resp.rows)");
    expect(code(world)).toContain("EMCP_WB_PlayRecorder.LastSeq()");
  });

  it("makes no banned or file call", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of ["FileIO", "FindFiles", "RunCommandline", "RunCmd", "Workbench.Dialog"])
      expect(c, banned).not.toContain(banned);
  });
});
