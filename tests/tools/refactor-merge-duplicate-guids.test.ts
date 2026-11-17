import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractMetaGuid,
  findDuplicateGuids,
} from "../../src/tools/refactor-merge-duplicate-guids.js";

const meta = (guid: string, path: string): string =>
  `MetaFileClass {\n Name "{${guid}}${path}"\n Configurations {\n }\n}\n`;

describe("refactor_merge_duplicate_guids: .meta sidecars", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });
  function root(): string {
    const r = mkdtempSync(join(tmpdir(), "mdg-"));
    cleanups.push(() => rmSync(r, { recursive: true, force: true }));
    mkdirSync(join(r, "Materials"), { recursive: true });
    return r;
  }

  it("reads the Name GUID of a sidecar", () => {
    expect(extractMetaGuid(meta("f90e31bf7b1f3fab", "a.physmat"))).toBe("F90E31BF7B1F3FAB");
    expect(extractMetaGuid("MetaFileClass {\n}\n")).toBeNull();
  });

  it("reports two .meta-owned resources that claim one GUID", () => {
    const r = root();
    const g = "F90E31BF7B1F3FAB";
    writeFileSync(join(r, "Materials", "a.physmat.meta"), meta(g, "Materials/a.physmat"), "utf-8");
    writeFileSync(join(r, "Materials", "b.physmat.meta"), meta(g, "Materials/a.physmat"), "utf-8");
    const c = findDuplicateGuids(r);
    expect([...c.keys()]).toEqual([g]);
    expect(c.get(g)!.map((f) => f.relPath).sort()).toEqual([
      "Materials/a.physmat.meta",
      "Materials/b.physmat.meta",
    ]);
  });

  it("a sidecar naming its own resource's root GUID is not a duplicate", () => {
    const r = root();
    const g = "AAAA000000000001";
    writeFileSync(join(r, "Materials", "x.conf"), `SCR_Thing "{${g}}" {\n}\n`, "utf-8");
    writeFileSync(join(r, "Materials", "x.conf.meta"), meta(g, "Materials/x.conf"), "utf-8");
    expect(findDuplicateGuids(r).size).toBe(0);
  });
});
