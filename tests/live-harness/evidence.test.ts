import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { nextSequence, writeEvidence } from "../../scripts/live/evidence.js";

describe("writeEvidence", () => {
  it("rewrites every string to placeholders and hashes the artifact from the real file", () => {
    const root = mkdtempSync(join(tmpdir(), "emcp-ev-"));
    try {
      const artifacts = join(root, "artifacts");
      const evidence = join(root, "evidence");
      const artifact = join(root, "shot.png");
      writeFileSync(artifact, "png bytes");
      const { record, path } = writeEvidence(
        evidence,
        "S-C",
        {
          ran: `netcall.ts GetLoadedProjects from ${root}`,
          build: "1.2.3",
          result_summary: `opened ${artifacts}\\x.gproj`,
          artifacts: [artifact],
        },
        { localAppData: root, sandbox: artifacts },
        new Date("2026-10-01T00:00:00Z"),
      );
      expect(record.id).toBe("EV-S-C-001");
      expect(path).toBe(join(evidence, "EV-S-C-001.json"));
      expect(record.ran).toBe("netcall.ts GetLoadedProjects from %LOCALAPPDATA%");
      expect(record.result_summary).toBe("opened <sandbox>\\x.gproj");
      expect(record.artifacts).toEqual([
        {
          path: "%LOCALAPPDATA%/shot.png",
          sha256: createHash("sha256").update("png bytes").digest("hex"),
        },
      ]);
      const onDisk = readFileSync(path, "utf-8");
      expect(onDisk).not.toContain(root);
      expect(JSON.parse(onDisk).written_at).toBe("2026-10-01T00:00:00.000Z");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("numbers records from the files already in the directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-ev-"));
    try {
      writeFileSync(join(dir, "EV-S-C-007.json"), "{}");
      writeFileSync(join(dir, "EV-S-D-099.json"), "{}");
      writeFileSync(join(dir, "EV-S-C-notes.txt"), "");
      expect(nextSequence(dir, "S-C")).toBe(8);
      const input = { ran: "x", build: "b", result_summary: "r" };
      expect(writeEvidence(dir, "S-C", input, {}).record.id).toBe("EV-S-C-008");
      expect(writeEvidence(dir, "S-C", input, {}).record.id).toBe("EV-S-C-009");
      expect(writeEvidence(dir, "S-E", input, {}).record.id).toBe("EV-S-E-001");
      expect(readdirSync(dir).filter((f) => f.startsWith("EV-S-C-")).length).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a session id that is not a plain name", () => {
    expect(() => nextSequence(tmpdir(), "../x")).toThrow("Invalid evidence session id");
  });
});
