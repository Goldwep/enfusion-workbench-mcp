/**
 * Total audit offline-writers-01: the 2.0 CST editors took a caller projectPath as their root and
 * never compared it with the configured project root, so a write (or read) could land in any
 * folder on disk. Each tool now pins a caller projectPath inside the configured root
 * (pinnedProjectRoot, src/utils/path-guard.ts). config_edit, string_table, behavior_tree and
 * project_settings have their own cases in their test files; this file covers the rest.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ActionResponse } from "../../src/manifest/vocabulary.js";
import { runAnimationGraph } from "../../src/tools/animation-graph.js";
import { runAnimationSet } from "../../src/tools/animation-set.js";
import { runAnimationWorkspace } from "../../src/tools/animation-workspace.js";
import { runAudio } from "../../src/tools/audio.js";
import { runImageset } from "../../src/tools/imageset.js";
import { runLayoutEdit } from "../../src/tools/layout-edit.js";
import { runMetaFile } from "../../src/tools/meta-file.js";
import { runNavmesh } from "../../src/tools/navmesh.js";
import { runParticle } from "../../src/tools/particle.js";
import { runProcAnim } from "../../src/tools/procanim.js";
import { runProjectSettings } from "../../src/tools/project-settings.js";
import { makeConfig } from "./_tool-harness.js";

const tmp = mkdtempSync(join(tmpdir(), "root-pin-"));
const root = join(tmp, "addons");
const outside = join(tmp, "elsewhere");
mkdirSync(join(root, "Inside"), { recursive: true });
mkdirSync(outside, { recursive: true });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const config = makeConfig({
  projectPath: root,
  gamePath: join(tmp, "no-game"),
  dataDir: join(tmp, "data"),
});

/** Files in the outside folder that each tool could read or rewrite there. */
const FILES: Record<string, string> = {
  "A.layout": "FrameWidgetClass Root {\n}\n",
  "A.imageset": "ImageSetClass {\n}\n",
  "A.et": "GenericEntity {\n}\n",
  "A.et.meta": 'MetaFileClass {\n Name "{0123456789ABCDEF}A.et"\n}\n',
  "A.gproj": 'GameProject {\n ID "A"\n}\n',
  "A.ast": "AnimSetTemplateSource {\n}\n",
  "A.aw": "AnimSrcWorkspace {\n}\n",
  "A.agf": "AnimSrcGraphFile {\n}\n",
  "A.pap": "ProcAnimParams {\n}\n",
  "A.acp": "AudioClass {\n}\n",
  "A.ptc": "ParticleEffect {\n}\n",
};
for (const [name, text] of Object.entries(FILES)) writeFileSync(join(outside, name), text);

function refusedOutside(res: ActionResponse | { ok: boolean; code?: string }): void {
  expect(res.ok).toBe(false);
  expect((res as { code: string }).code).toBe("NOT_IN_PROJECT");
}

function untouched(): void {
  for (const [name, text] of Object.entries(FILES)) {
    expect(readFileSync(join(outside, name), "utf-8"), name).toBe(text);
  }
}

describe("a caller projectPath outside the configured root is refused", () => {
  const at = { projectPath: outside, confirm: true };

  it("layout_edit", () => {
    refusedOutside(runLayoutEdit({ action: "read", path: "A.layout", ...at } as never, config));
  });

  it("imageset", () => {
    refusedOutside(runImageset({ action: "read", path: "A.imageset", ...at } as never, config));
  });

  it("meta_file", () => {
    refusedOutside(runMetaFile({ action: "read", path: "A.et", ...at } as never, config));
  });

  it("project_settings", () => {
    refusedOutside(runProjectSettings({ action: "read", path: "A.gproj", ...at } as never, config));
  });

  it("animation_set", () => {
    refusedOutside(
      runAnimationSet({ action: "read", path: "A.ast", ...at } as never, config, { game: null }),
    );
  });

  it("animation_workspace", async () => {
    refusedOutside(
      await runAnimationWorkspace({ action: "read", path: "A.aw", ...at } as never, config, {
        vfs: null,
      }),
    );
  });

  it("animation_graph", () => {
    const res = runAnimationGraph({ action: "validate", path: "A.agf", ...at } as never, config);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.text).code).toBe("NOT_IN_PROJECT");
    const author = runAnimationGraph(
      { action: "author", vehicleName: "V", outputPath: "Anims", ...at } as never,
      config,
    );
    expect(author.isError).toBe(true);
    expect(author.text).toContain("outside the configured project root");
  });

  it("procanim", () => {
    refusedOutside(runProcAnim({ action: "inspect", path: "A.pap", ...at } as never, config));
  });

  it("audio", () => {
    refusedOutside(runAudio({ action: "inspect", path: "A.acp", ...at } as never, config));
    refusedOutside(runAudio({ action: "catalog", ...at } as never, config));
  });

  it("particle", () => {
    refusedOutside(runParticle({ action: "inspect", path: "A.ptc", ...at } as never, config));
    refusedOutside(
      runParticle(
        { action: "set", path: "A.ptc", property: "x", value: 1, ...at } as never,
        config,
      ),
    );
  });

  it("navmesh", () => {
    refusedOutside(runNavmesh({ action: "config", path: "A.conf", ...at } as never, config, null));
  });

  it("leaves every outside file as it was", () => {
    untouched();
  });
});

describe("a caller projectPath under the configured root is still taken (DEC-058)", () => {
  it("reads a project folder below the root", () => {
    const sub = join(root, "Inside");
    writeFileSync(join(sub, "A.gproj"), FILES["A.gproj"]);
    const res = runProjectSettings(
      { action: "read", path: "A.gproj", projectPath: sub } as never,
      config,
    );
    expect(res.ok).toBe(true);
  });
});
