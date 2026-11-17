import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REGISTRY_KEY,
  decodeRegText,
  exportRegistry,
  exportsDir,
  gateScan,
  listExports,
  parseRegText,
  personalContextFromEnv,
  personalReason,
  readExport,
  stamp,
  subtreeReason,
  type ExecFn,
} from "../../src/settings/reg-export.js";

// Planted personal data is assembled at test time, never written whole into the repository.
const ACCT = ["tst", "acct"].join("");
const HOST = ["TST", "HOST9"].join("");
const PERSONAL = { accountNames: [ACCT], hostNames: [HOST] };

const ROOT = "HKEY_CURRENT_USER\\Software\\Bohemia Interactive\\Arma Reforger Workbench";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "wbset-reg-"));
  dirs.push(d);
  return d;
}

const utf16 = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

describe("decodeRegText", () => {
  it("reads UTF-16LE with and without a BOM, and UTF-8", () => {
    expect(decodeRegText(utf16("Windows Registry Editor"))).toBe("Windows Registry Editor");
    expect(decodeRegText(Buffer.from("REGEDIT4", "utf16le"))).toBe("REGEDIT4");
    expect(decodeRegText(Buffer.from("\ufeffREGEDIT4", "utf-8"))).toBe("REGEDIT4");
  });
});

describe("parseRegText", () => {
  const text = [
    "Windows Registry Editor Version 5.00",
    "",
    `[${ROOT}]`,
    '"Version"="1"',
    '@="default"',
    "",
    `[${ROOT}\\Workbench]`,
    '"NetAPI_Enabled"="1"',
    '"Port"=dword:0000167f',
    '"Blob"=hex:01,02,\\',
    "  03",
    '"Multi"=hex(7):41,00,00,00,00,00',
    '"Wide"=hex(2):41,00,42,00,00,00',
    '"Quoted"="a \\"b\\" c"',
    '"Gone"=-',
    "",
    "[HKEY_CURRENT_USER\\Software\\Other]",
    '"x"="y"',
    `[-${ROOT}\\Old]`,
  ].join("\r\n");

  it("parses keys, value types, wrapped hex, escapes and deletions", () => {
    const r = parseRegText(text);
    expect(r.keys.map((k) => k.segments)).toEqual([[], ["Workbench"]]);
    expect(r.outsideKeys).toBe(1);
    expect(r.deletions).toBe(2);
    const root = r.keys[0].values;
    expect(root).toEqual([
      { name: "Version", type: "REG_SZ", text: "1" },
      { name: "", type: "REG_SZ", text: "default" },
    ]);
    const wb = Object.fromEntries(r.keys[1].values.map((v) => [v.name, v]));
    expect(wb.Port).toEqual({ name: "Port", type: "REG_DWORD", text: "0000167f" });
    expect(wb.Blob.type).toBe("REG_BINARY");
    expect([...wb.Blob.bytes!]).toEqual([1, 2, 3]);
    expect(wb.Multi.type).toBe("REG_MULTI_SZ");
    expect(wb.Wide).toEqual({ name: "Wide", type: "REG_EXPAND_SZ", text: "AB" });
    expect(wb.Quoted.text).toBe('a "b" c');
  });

  it("refuses text that is not a registry export", () => {
    expect(() => parseRegText("[x]\n")).toThrow(/not a registry export/);
  });
});

describe("subtreeReason and personal data", () => {
  it("excludes recent files, world paths, file ids and user layouts", () => {
    expect(subtreeReason(["Workbench", "RecentFiles"])).toBe("recent-file-list");
    expect(subtreeReason(["World Editor", "Worlds", "x"])).toBe("world-path-keyed");
    expect(subtreeReason(["A", "0123456789abcdef"])).toBe("file-id-keyed");
    expect(subtreeReason(["World Editor", "Perspectives", "mine"])).toBe(
      "layout-name-user-defined",
    );
    expect(subtreeReason(["World Editor", "Perspectives", "default"])).toBeNull();
    expect(subtreeReason(["World Editor"])).toBeNull();
  });

  it("names the reason, never the match", () => {
    expect(personalReason("C:\\x\\y", PERSONAL)).toBe("machine-path");
    expect(personalReason("$ArmaReforger:Worlds/x.ent", PERSONAL)).toBe("resource-path");
    expect(personalReason(`hi ${ACCT}`, PERSONAL)).toBe("account-name");
    expect(personalReason(`on ${HOST.toLowerCase()}`, PERSONAL)).toBe("machine-name");
    expect(personalReason("a@b.example", PERSONAL)).toBe("e-mail");
    expect(personalReason("76561190000000001", PERSONAL)).toBe("steam-id");
    expect(personalReason("notes.txt", PERSONAL)).toBe("file-name");
    expect(personalReason("Dark", PERSONAL)).toBeNull();
    expect(gateScan(`D:\\x ${ACCT}`, PERSONAL)).toEqual(["account name", "drive-letter path"]);
  });

  it("takes account and machine names from the environment", () => {
    expect(personalContextFromEnv({ USERNAME: ACCT, COMPUTERNAME: HOST, USER: "ab" })).toEqual({
      accountNames: [ACCT],
      hostNames: [HOST],
    });
  });
});

describe("exportRegistry", () => {
  const regText = `Windows Registry Editor Version 5.00\r\n\r\n[${ROOT}]\r\n"Version"="1"\r\n`;
  const fakeReg =
    (calls: string[][]): ExecFn =>
    (file, args) => {
      calls.push([file, ...args]);
      writeFileSync(args[2], utf16(regText));
      return "";
    };

  it("exports the one key read-only into a new file, never with /y", () => {
    const root = tmp();
    const calls: string[][] = [];
    const now = () => new Date("2026-11-12T10:20:30.123Z");
    const deps = { artifactsRoot: root, exec: fakeReg(calls), platform: "win32" as const, now };
    const a = exportRegistry(deps);
    const b = exportRegistry(deps);
    expect(basename(a)).toBe(`registry-${stamp(now())}.reg`);
    expect(basename(b)).toBe(`registry-${stamp(now())}-2.reg`);
    expect(calls).toEqual([
      ["reg", "export", REGISTRY_KEY, a],
      ["reg", "export", REGISTRY_KEY, b],
    ]);
    expect(calls.flat()).not.toContain("/y");
    expect(readExport(a).keys[0].values[0]).toEqual({ name: "Version", type: "REG_SZ", text: "1" });
    expect(listExports(root).map((f) => basename(f))).toEqual([basename(b), basename(a)]);
  });

  it("throws off Windows and when reg writes nothing", () => {
    const root = tmp();
    const now = () => new Date(0);
    expect(() =>
      exportRegistry({ artifactsRoot: root, exec: () => "", platform: "linux", now }),
    ).toThrow(/only on Windows/);
    expect(() =>
      exportRegistry({ artifactsRoot: root, exec: () => "", platform: "win32", now }),
    ).toThrow(/wrote no file/);
    expect(existsSync(exportsDir(root))).toBe(true);
    expect(listExports(join(root, "nothing"))).toEqual([]);
  });

  it("stamps sort by time", () => {
    expect(stamp(new Date("2026-11-12T10:20:30.123Z"))).toBe("20261112T102030123Z");
  });
});
