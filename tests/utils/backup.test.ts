/**
 * src/utils/backup.ts: backUp takes the first free `.bak` name and never overwrites a backup
 * (the copy is create-only, COPYFILE_EXCL).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backUp, backupRel, MAX_BACKUPS } from "../../src/utils/backup.js";

const tmp = mkdtempSync(join(tmpdir(), "backup-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const fail = (m: string): never => {
  throw new Error(m);
};

describe("backUp", () => {
  it("writes <file>.bak first, then .bak2, keeping each earlier backup", () => {
    const f = join(tmp, "a.conf");
    writeFileSync(f, "one");
    expect(backUp(f, fail)).toBe(`${f}.bak`);
    writeFileSync(f, "two");
    expect(backUp(f, fail)).toBe(`${f}.bak2`);
    expect(readFileSync(`${f}.bak`, "utf8")).toBe("one");
    expect(readFileSync(`${f}.bak2`, "utf8")).toBe("two");
    expect(backupRel("Configs/a.conf", f, `${f}.bak2`)).toBe("Configs/a.conf.bak2");
  });

  it("skips a name already taken and leaves that file as it was", () => {
    const f = join(tmp, "b.conf");
    writeFileSync(f, "new");
    writeFileSync(`${f}.bak`, "the user's own backup");
    expect(backUp(f, fail)).toBe(`${f}.bak2`);
    expect(readFileSync(`${f}.bak`, "utf8")).toBe("the user's own backup");
  });

  it("refuses through fail when every numbered name is taken, copying nothing", () => {
    const f = join(tmp, "c.conf");
    writeFileSync(f, "x");
    for (let i = 1; i <= MAX_BACKUPS; i++) writeFileSync(`${f}.bak${i === 1 ? "" : i}`, "old");
    expect(() => backUp(f, fail)).toThrow(`${MAX_BACKUPS} backups`);
    expect(existsSync(`${f}.bak${MAX_BACKUPS + 1}`)).toBe(false);
  });
});
