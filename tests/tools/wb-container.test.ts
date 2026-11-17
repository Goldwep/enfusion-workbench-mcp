import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchError } from "../../src/workbench/client.js";
import {
  CONTAINER_CONTRACT,
  ENTITY_UNPROVEN_ACTIONS,
  checkPropertyPath,
  WB_CONTAINER_DESCRIPTION,
  flatInputShape,
  parseEditorTarget,
  prepareRequest,
  rowsToObjects,
  runContainer,
  SCHEMA_COLUMNS,
} from "../../src/tools/wb-container.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a queue (or a function) and records what was sent. */
function fakeClient(
  answer: (p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const row = (path: string, type: string, value: string) => [
  path,
  path.split(".").pop() ?? path,
  type,
  "",
  "true",
  "true",
  "",
  value,
];

describe("wb_container contract", () => {
  it("loads, and its description fits the 400-char budget", () => {
    expect(CONTAINER_CONTRACT.tool).toBe("wb_container");
    expect(WB_CONTAINER_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("lists exactly arrayMove as UNPROVEN, and only on an entity target", () => {
    expect([...ENTITY_UNPROVEN_ACTIONS]).toEqual(["arrayMove"]);
  });

  it("declares all nine actions", () => {
    expect(CONTAINER_CONTRACT.actions.map((a) => a.name)).toEqual([
      "describe",
      "get",
      "set",
      "clear",
      "arrayAdd",
      "arrayRemove",
      "arrayMove",
      "setClass",
      "save",
    ]);
  });

  it("marks every mutating action projectOnly and the reads not", () => {
    for (const a of CONTAINER_CONTRACT.actions) {
      expect(a.projectOnly, a.name).toBe(a.mutating);
      expect(a.mutating, a.name).toBe(!["describe", "get"].includes(a.name));
    }
  });

  it("gives registerTool a flat shape with every param key", () => {
    const shape = flatInputShape();
    for (const k of ["action", "target", "path", "value", "mode", "cursor", "limit", "confirm"])
      expect(shape[k], k).toBeDefined();
  });
});

describe("prepareRequest (nothing sent on refusal)", () => {
  it("refuses an absolute target with ABSOLUTE_PATH", () => {
    for (const t of [
      "path:C:/x/a.conf",
      "path:/a.conf",
      "path:$profile:a.conf",
      "path:a/../b.conf",
    ]) {
      const p = prepareRequest({ action: "get", target: t, path: "x" });
      expect(p.ok, t).toBe(false);
      if (!p.ok) expect(p.error.code, t).toBe("ABSOLUTE_PATH");
    }
  });

  it("set sends an empty string as a value, flagged so the handler can tell it from a missing key", () => {
    const empty = prepareRequest({ action: "set", target: "path:a.conf", path: "x", value: "" });
    expect(empty.ok && empty.params).toMatchObject({ value: "", emptyValue: true });
    const one = prepareRequest({ action: "set", target: "path:a.conf", path: "x", value: "1" });
    expect(one.ok && one.params).toMatchObject({ value: "1", emptyValue: false });
    // The flag is the tool's: a caller cannot set it for a value that is not empty.
    const forged = prepareRequest({
      action: "set",
      target: "path:a.conf",
      path: "x",
      value: "1",
      emptyValue: true,
    });
    expect(forged.ok && forged.params).toMatchObject({ emptyValue: false });
  });

  it("refuses a malformed target or path with INVALID_ARGUMENT", () => {
    const cases = [
      { action: "get", target: "open:AudioEditor", path: "x" },
      { action: "get", target: "file.conf", path: "x" },
      { action: "get", target: "path:a.conf", path: "a..b" },
      { action: "get", target: "path:a.conf", path: "a[1][2]" },
      { action: "describe", target: "path:a.conf", limit: 500 },
      { action: "describe", target: "path:a.conf", fields: "name,bogus" },
      { action: "get", target: "path:a.conf" },
      { action: "get", target: "path:a.conf", path: "x", value: "1" },
    ];
    for (const c of cases) {
      const p = prepareRequest(c);
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code, JSON.stringify(c)).toBe("INVALID_ARGUMENT");
    }
  });

  it("refuses arrayMove on an entity target and every write into open:WorldEditor", () => {
    const m = prepareRequest({
      action: "arrayMove",
      target: "entity:name:Tree",
      path: "components[Foo].m_aItems",
      index: 0,
      toIndex: 1,
    });
    expect(m.ok).toBe(false);
    if (!m.ok) {
      expect(m.error.code).toBe("UNPROVEN");
      expect(m.error.message).toContain("SetObjectVariableMember/4");
      expect(m.error.message).toContain("Nothing was sent");
    }
    const writes: Record<string, unknown>[] = [
      { action: "set", path: "x", value: "1" },
      { action: "clear", path: "x" },
      { action: "arrayAdd", path: "x", className: "A" },
      { action: "arrayRemove", path: "x", index: 0 },
      { action: "arrayMove", path: "x", index: 0, toIndex: 1 },
      { action: "setClass", path: "x", className: "A" },
      { action: "save" },
    ];
    for (const w of writes) {
      const p = prepareRequest({ target: "open:WorldEditor", ...w });
      expect(p.ok, String(w.action)).toBe(false);
      if (!p.ok) expect(p.error.code, String(w.action)).toBe("UNPROVEN");
    }
  });

  it("moves an array element by path", () => {
    const p = prepareRequest({
      action: "arrayMove",
      target: "path:a.conf",
      path: "Items",
      index: 0,
      toIndex: 2,
    });
    expect(p.ok && p.params).toMatchObject({ index: 0, toIndex: 2, confirm: false });
  });

  it("accepts entity targets for the reads and the five writes, normalising the reference", () => {
    const cases: Record<string, unknown>[] = [
      { action: "describe" },
      { action: "get", path: "components[Foo].x" },
      { action: "set", path: "x", value: "1" },
      { action: "clear", path: "x" },
      { action: "arrayAdd", path: "x", className: "A" },
      { action: "arrayRemove", path: "x", index: 0 },
      { action: "setClass", path: "x", className: "A" },
    ];
    for (const c of cases) {
      const p = prepareRequest({ target: "entity:id:0xAB", ...c });
      expect(p.ok, String(c.action)).toBe(true);
      if (p.ok) expect(p.params.target, String(c.action)).toBe("entity:id:0x00000000000000ab");
    }
    const byName = prepareRequest({ action: "get", target: "entity:name:Rock 1", path: "x" });
    expect(byName.ok && byName.params.target).toBe("entity:name:Rock 1");
    const byIndex = prepareRequest({ action: "get", target: "entity:index:7", path: "x" });
    expect(byIndex.ok && byIndex.params.target).toBe("entity:index:7");
  });

  it("refuses a malformed entity reference and save on an entity", () => {
    for (const t of ["entity:", "entity:id:zz", "entity:index:-1", "entity:Tree", "entity:name:"]) {
      const p = prepareRequest({ action: "get", target: t, path: "x" });
      expect(p.ok, t).toBe(false);
      if (!p.ok) expect(p.error.code, t).toBe("INVALID_ARGUMENT");
    }
    const s = prepareRequest({ action: "save", target: "entity:index:1" });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.code).toBe("INVALID_ARGUMENT");
  });

  it("takes name[Class] and name[i] path segments, one bracket each", () => {
    for (const good of ["components[SCR_Foo].m_aItems", "a.b[3].c", "components[_X1]"])
      expect(checkPropertyPath(good)).toBe(good);
    for (const bad of [
      "a[1][2]",
      "a[Foo][Bar]",
      "a[]",
      "a[1",
      "a[-1]",
      "a[Foo Bar]",
      "[0]",
      "a..b",
    ])
      expect(() => checkPropertyPath(bad), bad).toThrow();
    const p = prepareRequest({
      action: "arrayAdd",
      target: "entity:index:1",
      path: "components[Foo].m_aItems",
      className: "SCR_Item",
    });
    expect(p.ok && p.params.path).toBe("components[Foo].m_aItems");
  });

  it("takes leading #<i> child steps on get only (a layout's widgets, W2 run 3)", () => {
    const g = prepareRequest({ action: "get", target: "path:UI/a.layout", path: "#1.Text" });
    expect(g.ok && g.params.path).toBe("#1.Text");
    const deep = prepareRequest({
      action: "get",
      target: "path:UI/a.layout",
      path: "#0.#2.Slot.SizeX",
    });
    expect(deep.ok && deep.params.path).toBe("#0.#2.Slot.SizeX");
    for (const bad of ["#1", "#x.Text", "#-1.Text", "a.#1.Text", "#.Text"]) {
      const r = prepareRequest({ action: "get", target: "path:UI/a.layout", path: bad });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("INVALID_ARGUMENT");
    }
    // A write never takes a child step: nothing is sent.
    const s = prepareRequest({
      action: "set",
      target: "path:UI/a.layout",
      path: "#1.Text",
      value: "x",
      confirm: true,
    });
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.message).toMatch(/only get reads a child node/);
  });

  it("checks the per-action arguments of the writes before sending", () => {
    const bad: Record<string, unknown>[] = [
      { action: "arrayAdd", target: "path:a.conf", path: "x" },
      { action: "arrayAdd", target: "path:a.conf", path: "x", className: "" },
      { action: "arrayAdd", target: "path:a.conf", path: "x", className: "A", index: -2 },
      { action: "arrayRemove", target: "path:a.conf", path: "x" },
      { action: "arrayRemove", target: "path:a.conf", path: "x", index: -1 },
      { action: "arrayMove", target: "path:a.conf", path: "x", index: 0 },
      { action: "arrayMove", target: "path:a.conf", path: "x", index: 0, toIndex: -1 },
      { action: "setClass", target: "path:a.conf", path: "x" },
      { action: "setClass", target: "path:a.conf", path: "x", className: "  " },
      { action: "clear", target: "path:a.conf" },
      { action: "clear", target: "path:a.conf", path: "x", value: "1" },
    ];
    for (const c of bad) {
      const p = prepareRequest(c);
      expect(p.ok, JSON.stringify(c)).toBe(false);
      if (!p.ok) expect(p.error.code, JSON.stringify(c)).toBe("INVALID_ARGUMENT");
    }
  });

  it("sends index -1 for an arrayAdd that names none, and confirm false by default", () => {
    const p = prepareRequest({
      action: "arrayAdd",
      target: "path:a.conf",
      path: "x",
      className: "A",
    });
    expect(p.ok && p.params).toMatchObject({ index: -1, confirm: false });
    const q = prepareRequest({
      action: "arrayAdd",
      target: "path:a.conf",
      path: "x",
      className: "A",
      index: 2,
      confirm: true,
    });
    expect(q.ok && q.params).toMatchObject({ index: 2, confirm: true });
  });

  it("normalises the target and path, and sends confirm false by default", () => {
    const p = prepareRequest({
      action: "set",
      target: "path:a\\b.conf",
      path: "x[0].y",
      value: "2",
    });
    expect(p.ok).toBe(true);
    if (p.ok)
      expect(p.params).toMatchObject({ target: "path:a/b.conf", path: "x[0].y", confirm: false });
  });

  it("sends nothing to Workbench on a refusal", async () => {
    const { client, sent } = fakeClient(() => ok());
    for (const input of [
      { action: "clear", target: "path:a.conf" },
      { action: "arrayMove", target: "entity:index:1", path: "x", index: 0, toIndex: 1 },
      { action: "set", target: "open:WorldEditor", path: "x", value: "1" },
    ]) {
      const res = await runContainer(client, input);
      expect(res.ok).toBe(false);
    }
    expect(sent).toHaveLength(0);
  });
});

describe("runContainer", () => {
  it("describe defaults to summary, reads with access read, no spill when small", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        rootClass: "SCR_Config",
        total: 3,
        capped: false,
        typeCounts: ["SCALAR=2", "STRING=1"],
        setCount: 1,
        defaultCount: 2,
        children: [],
        topSet: ["Speed"],
      }),
    );
    const res = await runContainer(client, { action: "describe", target: "path:a.conf" });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Container");
    expect(sent[0].options.access).toBe("read");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toBeNull();
      expect(res.readback).toMatchObject({
        rootClass: "SCR_Config",
        typeCounts: { SCALAR: 2, STRING: 1 },
        set: 1,
        default: 2,
        topSet: ["Speed"],
      });
      expect((res.readback as Record<string, unknown>).artifact).toBeUndefined();
    }
  });

  it("describe page keeps the requested fields", async () => {
    const { client } = fakeClient(() =>
      ok({
        total: 2,
        rows: [...row("A", "SCALAR", "1"), ...row("B", "STRING", "x")],
        nextCursor: "",
      }),
    );
    const res = await runContainer(client, {
      action: "describe",
      target: "path:a.conf",
      mode: "page",
      fields: "path,value",
    });
    expect(res.ok).toBe(true);
    if (res.ok)
      expect((res.readback as Record<string, unknown>).rows).toEqual([
        { path: "A", value: "1" },
        { path: "B", value: "x" },
      ]);
  });

  it("a world target spills the full dump to the artifacts folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wbc-"));
    try {
      const { client, sent } = fakeClient((p) => {
        if (p.mode === "page" && !p.cursor)
          return ok({
            rootClass: "GenericWorldEntity",
            total: 2,
            rows: row("A", "SCALAR", "1"),
            nextCursor: "1",
          });
        if (p.mode === "page")
          return ok({
            rootClass: "GenericWorldEntity",
            total: 2,
            rows: row("B", "SCALAR", "2"),
            nextCursor: "",
          });
        return ok({ rootClass: "GenericWorldEntity", total: 2, typeCounts: ["SCALAR=2"] });
      });
      const res = await runContainer(
        client,
        { action: "describe", target: "open:WorldEditor" },
        { artifactsRoot: dir, now: () => new Date("2026-10-10T12:00:00Z") },
      );
      expect(sent.map((s) => s.params.mode)).toEqual([undefined, "page", "page"]);
      expect(res.ok).toBe(true);
      if (res.ok) {
        const file = (res.readback as Record<string, unknown>).artifact as string;
        expect(file).toBe("<artifacts>/container/2026-10-10T12-00-00-000Z.json");
        expect(file).not.toContain(dir);
        const dump = JSON.parse(
          readFileSync(join(dir, "container", "2026-10-10T12-00-00-000Z.json"), "utf-8"),
        );
        expect(dump.rows.map((r: { path: string }) => r.path)).toEqual(["A", "B"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("get answers the value at the path", async () => {
    const { client } = fakeClient(() => ok({ varType: "SCALAR", value: "1.5" }));
    const res = await runContainer(client, { action: "get", target: "path:a.conf", path: "Speed" });
    expect(res.ok && res.readback).toMatchObject({ path: "Speed", type: "SCALAR", value: "1.5" });
  });

  it("set without confirm is a dry run with the would-change diff, sent as mutate", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ varType: "SCALAR", before: "1", after: "2", dryRun: true }),
    );
    const res = await runContainer(client, {
      action: "set",
      target: "path:a.conf",
      path: "Speed",
      value: "2",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params.confirm).toBe(false);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toBeNull();
      expect(res.readback).toMatchObject({
        dryRun: true,
        wouldChange: [{ path: "Speed", before: "1", after: "2" }],
      });
      expect(res.next).toMatch(/confirm: true/);
    }
  });

  it("set with confirm answers changed and the read-back", async () => {
    const { client } = fakeClient(() =>
      ok({
        varType: "SCALAR",
        before: "1",
        after: "2",
        written: true,
        saved: true,
        savedPath: "a.conf",
      }),
    );
    const res = await runContainer(client, {
      action: "set",
      target: "path:a.conf",
      path: "Speed",
      value: "2",
      confirm: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: "Speed", before: "1", after: "2" }]);
      expect(res.readback).toMatchObject({ value: "2", saved: true, file: "a.conf" });
    }
  });

  it("surfaces the deciding guard's message and the sourceAddons list on a write refusal", async () => {
    const msg =
      "NOT_IN_PROJECT: SourceAddonsAreOnly: the container names a source addon other than MyMod (GetSourceAddons: [ArmaReforger]); nothing was changed | next: copy the resource into the open project first";
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NOT_IN_PROJECT",
      next: "copy the resource into the open project first",
      message: msg,
      sourceAddons: "ArmaReforger",
    }));
    const res = await runContainer(client, { action: "save", target: "path:Configs/a.conf" });
    expect(res).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
      message: msg,
      sourceAddons: "ArmaReforger",
    });

    const { client: c2 } = fakeClient(() => ({
      status: "refused",
      code: "NOT_IN_PROJECT",
      next: "target a resource inside the open project",
      message:
        "NOT_IN_PROJECT: TargetInsideProject: the target does not resolve inside the project's folder",
      sourceAddons: "",
    }));
    const r2 = await runContainer(c2, { action: "save", target: "path:a.conf" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.code).toBe("NOT_IN_PROJECT");
      expect(r2.message).toContain("TargetInsideProject");
      expect(r2.message).toContain("(sourceAddons: [])");
      expect(r2.sourceAddons).toBe("");
    }
  });

  // DEC-058: a write anywhere inside the open project is allowed, not only under _throwaway/.
  it("carries sourceAddons on a by-path write's dry run anywhere in the project", async () => {
    const { client, sent } = fakeClient(() => ({
      status: "ok",
      dryRun: true,
      savedPath: "Configs/Sub/a.conf",
      message: "dry run",
      sourceAddons: "",
    }));
    const res = await runContainer(client, { action: "save", target: "path:Configs/Sub/a.conf" });
    expect(sent[0].params).toMatchObject({ action: "save", target: "path:Configs/Sub/a.conf" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.readback).toMatchObject({ dryRun: true, sourceAddons: "" });
  });

  it("maps a handler refusal to its code, next and the sibling names", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NOT_IN_PROJECT",
      next: "install the handlers in the project you have open",
      message:
        "NOT_IN_PROJECT: ProjectRefused: mutating actions need the handlers installed in the open project",
    }));
    const res = await runContainer(client, { action: "save", target: "path:a.conf" });
    expect(res).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
      next: "install the handlers in the project you have open",
    });

    const { client: c2 } = fakeClient(() => ({
      status: "error",
      code: "PATH_NOT_FOUND",
      next: "",
      message: "no variable",
      siblings: ["A", "B"],
    }));
    const r2 = await runContainer(c2, { action: "get", target: "path:a.conf", path: "Z" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.code).toBe("PATH_NOT_FOUND");
      expect(r2.message).toContain("siblings: A, B");
      expect(r2.next).toMatch(/sibling/);
    }
  });

  it("a lost mutating call is LOST, never retried", async () => {
    const { client, sent } = fakeClient(() => new WorkbenchError("reset", "LOST"));
    const res = await runContainer(client, {
      action: "save",
      target: "path:a.conf",
      confirm: true,
    });
    expect(sent).toHaveLength(1);
    expect(res).toMatchObject({ ok: false, code: "LOST" });
  });

  it("get answers isSet, isSetDirectly and defaultValue, but not for an element", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ varType: "SCALAR", value: "1.5", isSet: 1, isSetDirectly: 0, defaultValue: "1" }),
    );
    const res = await runContainer(client, {
      action: "get",
      target: "entity:name:Rock",
      path: "components[Foo].Speed",
    });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toMatchObject({
      target: "entity:name:Rock",
      path: "components[Foo].Speed",
    });
    expect(res.ok && res.readback).toMatchObject({
      type: "SCALAR",
      value: "1.5",
      isSet: true,
      isSetDirectly: false,
      defaultValue: "1",
    });
    const { client: c2 } = fakeClient(() =>
      ok({ varType: "element", objectClass: "Foo", value: "Foo" }),
    );
    const el = await runContainer(c2, { action: "get", target: "path:a.conf", path: "Items[0]" });
    expect(el.ok).toBe(true);
    if (el.ok) {
      expect(el.readback).toMatchObject({ type: "element", objectClass: "Foo" });
      expect((el.readback as Record<string, unknown>).isSet).toBeUndefined();
    }
  });

  it("set on an entity applies at once: changed, undoName, an in-memory warning", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ varType: "SCALAR", before: "1", after: "2", written: 1, undoName: "emcp: set" }),
    );
    const res = await runContainer(client, {
      action: "set",
      target: "entity:index:4",
      path: "components[Foo].Speed",
      value: "2",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: "components[Foo].Speed", before: "1", after: "2" }]);
      expect(res.readback).toMatchObject({ value: "2", saved: false, undoName: "emcp: set" });
      expect(res.warnings.join(" ")).toMatch(/in memory.*undo step \(emcp: set\).*not saved/);
    }
  });

  it("warns when the engine reads back another value than the one sent", async () => {
    const { client } = fakeClient(() => ok({ varType: "SCALAR", before: "1", after: "0" }));
    const res = await runContainer(client, {
      action: "set",
      target: "path:a.conf",
      path: "Speed",
      value: "",
      confirm: true,
    });
    expect(res.ok && res.warnings[0]).toMatch(/reads back "0"/);
  });

  it("clear by path is a dry run without confirm, then a change", async () => {
    const { client, sent } = fakeClient((p) =>
      p.confirm === true
        ? ok({
            varType: "SCALAR",
            before: "5",
            after: "1",
            isSet: 0,
            written: 1,
            saved: 1,
            savedPath: "a.conf",
          })
        : ok({ varType: "SCALAR", before: "5", isSet: 1, dryRun: 1 }),
    );
    const dry = await runContainer(client, {
      action: "clear",
      target: "path:a.conf",
      path: "Speed",
    });
    expect(sent[0].params).toMatchObject({ action: "clear", path: "Speed", confirm: false });
    expect(dry.ok).toBe(true);
    if (dry.ok) {
      expect(dry.changed).toBeNull();
      expect(dry.readback).toMatchObject({
        dryRun: true,
        isSet: true,
        wouldChange: [{ path: "Speed", before: "5", after: "(inherited value)" }],
      });
      expect(dry.next).toMatch(/confirm: true/);
    }
    const done = await runContainer(client, {
      action: "clear",
      target: "path:a.conf",
      path: "Speed",
      confirm: true,
    });
    expect(sent[1].params.confirm).toBe(true);
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(done.changed).toEqual([{ path: "Speed", before: "5", after: "1" }]);
      expect(done.readback).toMatchObject({ isSet: false, saved: true, file: "a.conf" });
    }
  });

  it("clear on an entity answers the undo point and no file", async () => {
    const { client } = fakeClient(() =>
      ok({
        varType: "SCALAR",
        before: "5",
        after: "1",
        isSet: 0,
        written: 1,
        undoName: "emcp: clear",
      }),
    );
    const res = await runContainer(client, {
      action: "clear",
      target: "entity:index:4",
      path: "Speed",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: "Speed", before: "5", after: "1" }]);
      expect(res.readback).toMatchObject({ saved: false, undoName: "emcp: clear", isSet: false });
      expect((res.readback as Record<string, unknown>).file).toBeUndefined();
    }
  });

  it("array writes by path dry-run the element classes and the count", async () => {
    const answers: Record<string, Record<string, unknown>> = {
      arrayAdd: { before: "A,B", after: "A,B,C", count: 3 },
      arrayRemove: { before: "A,B", after: "A", count: 1 },
      arrayMove: { before: "A,B", after: "B,A", count: 2 },
    };
    for (const action of Object.keys(answers)) {
      const { client, sent } = fakeClient(() =>
        ok({ varType: "OBJECT_ARRAY", objectClass: "Base", dryRun: 1, ...answers[action] }),
      );
      const input: Record<string, unknown> = { action, target: "path:a.conf", path: "Items" };
      if (action === "arrayAdd") input.className = "C";
      else input.index = 0;
      if (action === "arrayMove") input.toIndex = 1;
      const res = await runContainer(client, input);
      expect(sent[0].params.confirm, action).toBe(false);
      expect(res.ok, action).toBe(true);
      if (res.ok) {
        expect(res.changed, action).toBeNull();
        expect(res.readback, action).toMatchObject({
          dryRun: true,
          count: answers[action].count,
          objectClass: "Base",
          wouldChange: [
            { path: "Items", before: answers[action].before, after: answers[action].after },
          ],
        });
        expect(res.next, action).toMatch(/confirm: true/);
      }
    }
  });

  it("array writes by path with confirm answer changed and the saved file", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        varType: "OBJECT_ARRAY",
        objectClass: "Base",
        before: "A",
        after: "A,C",
        count: 2,
        written: 1,
        saved: 1,
        savedPath: "a.conf",
      }),
    );
    const res = await runContainer(client, {
      action: "arrayAdd",
      target: "path:a.conf",
      path: "Items",
      className: "C",
      confirm: true,
    });
    expect(sent[0].params).toMatchObject({ className: "C", index: -1, confirm: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual([{ path: "Items", before: "A", after: "A,C" }]);
      expect(res.readback).toMatchObject({ count: 2, saved: true, file: "a.conf" });
    }
  });

  it("array writes and setClass on an entity pass class and index and answer the undo point", async () => {
    const { client, sent } = fakeClient((p) =>
      p.action === "setClass"
        ? ok({
            varType: "OBJECT",
            objectClass: "New",
            before: "Old",
            after: "New",
            written: 1,
            undoName: "emcp: setClass",
          })
        : ok({
            varType: "OBJECT_ARRAY",
            objectClass: "Base",
            before: "A",
            after: p.action === "arrayAdd" ? "A,C" : "",
            count: p.action === "arrayAdd" ? 2 : 0,
            written: 1,
            undoName: `emcp: ${String(p.action)}`,
          }),
    );
    const add = await runContainer(client, {
      action: "arrayAdd",
      target: "entity:id:0x1",
      path: "components[Foo].Items",
      className: "C",
      index: 1,
    });
    expect(sent[0].params).toMatchObject({
      target: "entity:id:0x0000000000000001",
      className: "C",
      index: 1,
    });
    expect(add.ok && add.readback).toMatchObject({ count: 2, undoName: "emcp: arrayAdd" });
    const rem = await runContainer(client, {
      action: "arrayRemove",
      target: "entity:id:0x1",
      path: "components[Foo].Items",
      index: 0,
    });
    expect(rem.ok && rem.changed).toEqual([
      { path: "components[Foo].Items", before: "A", after: "" },
    ]);
    const cls = await runContainer(client, {
      action: "setClass",
      target: "entity:id:0x1",
      path: "components[Foo].Items[0]",
      className: "New",
    });
    expect(cls.ok).toBe(true);
    if (cls.ok) {
      expect(cls.changed).toEqual([
        { path: "components[Foo].Items[0]", before: "Old", after: "New" },
      ]);
      expect(cls.readback).toMatchObject({
        objectClass: "New",
        undoName: "emcp: setClass",
        saved: false,
      });
    }
  });

  it("setClass by path dry-runs the class change", async () => {
    const { client } = fakeClient(() =>
      ok({ varType: "OBJECT", before: "Old", after: "New", dryRun: 1 }),
    );
    const res = await runContainer(client, {
      action: "setClass",
      target: "path:a.conf",
      path: "Obj",
      className: "New",
    });
    expect(res.ok && res.readback).toMatchObject({
      dryRun: true,
      wouldChange: [{ path: "Obj", before: "Old", after: "New" }],
    });
  });

  it("maps the handler's write refusals and the kernel codes", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "UNPROVEN",
      next: "waits for train #2 gate 2",
      message: "UNPROVEN: world write; nothing was changed",
    }));
    const res = await runContainer(client, {
      action: "arrayRemove",
      target: "path:a.conf",
      path: "Items",
      index: 0,
    });
    expect(res).toMatchObject({ ok: false, code: "UNPROVEN", next: "waits for train #2 gate 2" });

    const { client: c2 } = fakeClient(() => ({
      status: "refused",
      code: "WRONG_MODE",
      next: "stop play (wb_world stop) and retry",
      message: "WRONG_MODE: MayWrite: the World Editor is in play mode; nothing was changed",
    }));
    const r2 = await runContainer(c2, { action: "clear", target: "entity:index:1", path: "x" });
    expect(r2).toMatchObject({ ok: false, code: "WRONG_MODE" });

    const { client: c3, sent } = fakeClient(() => new WorkbenchError("reset", "LOST"));
    const r3 = await runContainer(c3, {
      action: "setClass",
      target: "entity:index:1",
      path: "x",
      className: "A",
    });
    expect(sent).toHaveLength(1);
    expect(r3).toMatchObject({ ok: false, code: "LOST" });

    const { client: c4 } = fakeClient(() => new WorkbenchError("modal", "MODAL_OPEN"));
    const r4 = await runContainer(c4, { action: "get", target: "entity:index:1", path: "x" });
    expect(r4).toMatchObject({ ok: false, code: "MODAL_OPEN" });
  });

  it("describe of an entity target pages like a path target", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ rootClass: "GenericEntity", total: 1, rows: row("A", "SCALAR", "1"), nextCursor: "" }),
    );
    const res = await runContainer(client, {
      action: "describe",
      target: "entity:name:Rock",
      mode: "page",
      limit: 50,
    });
    expect(sent[0].params).toMatchObject({ target: "entity:name:Rock", mode: "page", limit: 50 });
    expect(res.ok && res.target).toBe("entity:name:Rock");
  });

  it("rowsToObjects drops a trailing partial row", () => {
    expect(rowsToObjects([...row("A", "INTEGER", "3"), "x"], ["path", "type"])).toEqual([
      { path: "A", type: "INTEGER" },
    ]);
  });
});

const srow = (
  path: string,
  type: string,
  value: string,
  widget: string,
  limits: string,
  en: string,
) => [...row(path, type, value), widget, limits, en];

describe("W2: open:ResourceManager and class:<Name> targets", () => {
  it("sends open:ResourceManager through for describe and get as reads", async () => {
    const { client, sent } = fakeClient((p) =>
      p.action === "describe"
        ? ok({ rootClass: "MetaFile", total: 1, typeCounts: ["SCALAR=1"] })
        : ok({ varType: "SCALAR", value: "2", isSet: true, isSetDirectly: false }),
    );
    const d = await runContainer(client, { action: "describe", target: "open:ResourceManager" });
    const g = await runContainer(client, {
      action: "get",
      target: "open:ResourceManager",
      path: "Speed",
    });
    expect(d.ok && d.target).toBe("open:ResourceManager");
    expect(g.ok && g.readback).toMatchObject({ path: "Speed", value: "2" });
    expect(sent.map((s) => s.options.access)).toEqual(["read", "read"]);
    expect(sent.map((s) => s.params.target)).toEqual([
      "open:ResourceManager",
      "open:ResourceManager",
    ]);
  });

  it("describe of the Resource Manager's resource does not spill when it fits one page", async () => {
    const { client, sent } = fakeClient(() => ok({ rootClass: "X", total: 3, typeCounts: [] }));
    const res = await runContainer(client, { action: "describe", target: "open:ResourceManager" });
    expect(sent).toHaveLength(1);
    expect(res.ok && (res.readback as Record<string, unknown>).artifact).toBeUndefined();
  });

  it("set on open:ResourceManager: a dry run first, then a confirmed write, both as mutate", async () => {
    const { client, sent } = fakeClient((p) =>
      p.confirm === true
        ? ok({
            varType: "SCALAR",
            before: "1",
            after: "2",
            saved: 1,
            savedPath: "Configs/a.conf",
            sourceAddons: "Mod",
          })
        : ok({ varType: "SCALAR", before: "1", after: "2", dryRun: 1, sourceAddons: "Mod" }),
    );
    const dry = await runContainer(client, {
      action: "set",
      target: "open:ResourceManager",
      path: "Speed",
      value: "2",
    });
    expect(dry.ok && dry.changed).toBeNull();
    expect(dry.ok && dry.readback).toMatchObject({
      dryRun: true,
      wouldChange: [{ path: "Speed", before: "1", after: "2" }],
    });
    const wet = await runContainer(client, {
      action: "set",
      target: "open:ResourceManager",
      path: "Speed",
      value: "2",
      confirm: true,
    });
    expect(wet.ok && wet.changed).toEqual([{ path: "Speed", before: "1", after: "2" }]);
    expect(wet.ok && wet.readback).toMatchObject({ saved: true, file: "Configs/a.conf" });
    expect(sent.map((s) => s.options.access)).toEqual(["mutate", "mutate"]);
    expect(sent.map((s) => s.params.confirm)).toEqual([false, true]);
  });

  it("save on open:ResourceManager dry-runs, then saves the opened resource", async () => {
    const { client } = fakeClient((p) =>
      p.confirm === true
        ? ok({ saved: 1, savedPath: "Configs/a.conf" })
        : ok({ dryRun: 1, savedPath: "Configs/a.conf", message: "would save" }),
    );
    const dry = await runContainer(client, { action: "save", target: "open:ResourceManager" });
    expect(dry.ok && dry.readback).toMatchObject({ dryRun: true, file: "Configs/a.conf" });
    const wet = await runContainer(client, {
      action: "save",
      target: "open:ResourceManager",
      confirm: true,
    });
    expect(wet.ok && wet.changed).toEqual([
      { path: "Configs/a.conf", before: null, after: "saved" },
    ]);
  });

  it("refuses clear, arrays and setClass on open:ResourceManager with UNPROVEN, sending nothing", async () => {
    const writes: Record<string, unknown>[] = [
      { action: "clear", path: "x" },
      { action: "arrayAdd", path: "x", className: "A" },
      { action: "arrayRemove", path: "x", index: 0 },
      { action: "arrayMove", path: "x", index: 0, toIndex: 1 },
      { action: "setClass", path: "x", className: "A" },
    ];
    const { client, sent } = fakeClient(() => ok());
    for (const w of writes) {
      const res = await runContainer(client, { target: "open:ResourceManager", ...w });
      expect(res.ok, String(w.action)).toBe(false);
      if (!res.ok) {
        expect(res.code, String(w.action)).toBe("UNPROVEN");
        expect(res.message).toContain("Nothing was sent");
      }
    }
    expect(sent).toHaveLength(0);
  });

  it("maps MODULE_NOT_OPEN and NO_OPEN_RESOURCE from the Resource Manager", async () => {
    const answers = [
      { status: "error", code: "MODULE_NOT_OPEN", message: "the module is not open" },
      { status: "error", code: "NO_OPEN_RESOURCE", message: "holds no opened resource" },
    ];
    const { client } = fakeClient((_p, n) => answers[n]);
    const a = await runContainer(client, { action: "describe", target: "open:ResourceManager" });
    const b = await runContainer(client, { action: "describe", target: "open:ResourceManager" });
    expect(!a.ok && a.code).toBe("MODULE_NOT_OPEN");
    expect(!a.ok && a.next).toContain("wb_module open");
    expect(!b.ok && b.code).toBe("NO_OPEN_RESOURCE");
    expect(!b.ok && b.next).toContain("Resource Manager");
  });

  it("the handler's own next wins over the local one", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "NO_OPEN_RESOURCE",
      message: "m",
      next: "handler says",
    }));
    const res = await runContainer(client, {
      action: "get",
      target: "open:ResourceManager",
      path: "x",
    });
    expect(!res.ok && res.next).toBe("handler says");
  });

  it("reads class:<Name> as describe and get (read access), target echoed", async () => {
    const { client, sent } = fakeClient((p) =>
      p.action === "describe"
        ? ok({ rootClass: "SCR_Foo", total: 2, typeCounts: ["SCALAR=2"], setCount: 0 })
        : ok({ varType: "SCALAR", value: "0", isSet: false, isSetDirectly: false }),
    );
    const d = await runContainer(client, { action: "describe", target: "class:SCR_Foo" });
    const g = await runContainer(client, {
      action: "get",
      target: "class:SCR_Foo",
      path: "m_fSpeed",
    });
    expect(d.ok && d.target).toBe("class:SCR_Foo");
    expect(g.ok && g.readback).toMatchObject({ path: "m_fSpeed", value: "0" });
    expect(sent.map((s) => [s.params.target, s.options.access])).toEqual([
      ["class:SCR_Foo", "read"],
      ["class:SCR_Foo", "read"],
    ]);
  });

  it("refuses every write on class:<Name> with WRONG_MODE before sending", async () => {
    const writes: Record<string, unknown>[] = [
      { action: "set", path: "x", value: "1" },
      { action: "clear", path: "x" },
      { action: "arrayAdd", path: "x", className: "A" },
      { action: "arrayRemove", path: "x", index: 0 },
      { action: "arrayMove", path: "x", index: 0, toIndex: 1 },
      { action: "setClass", path: "x", className: "A" },
      { action: "save" },
    ];
    const { client, sent } = fakeClient(() => ok());
    for (const w of writes) {
      const res = await runContainer(client, { target: "class:SCR_Foo", ...w });
      expect(res.ok, String(w.action)).toBe(false);
      if (!res.ok) {
        expect(res.code, String(w.action)).toBe("WRONG_MODE");
        expect(res.next).toBeTruthy();
      }
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses a bad class name with INVALID_ARGUMENT", () => {
    for (const t of ["class:", "class:1Foo", "class:Foo.Bar", "class:Foo Bar", "class:a/b"]) {
      const p = prepareRequest({ action: "describe", target: t });
      expect(p.ok, t).toBe(false);
      if (!p.ok) expect(p.error.code, t).toBe("INVALID_ARGUMENT");
    }
    expect(prepareRequest({ action: "describe", target: "class:_Foo9" }).ok).toBe(true);
  });

  it("still refuses an unknown open: module and a save on an entity", () => {
    expect(prepareRequest({ action: "describe", target: "open:ScriptEditor" }).ok).toBe(false);
    expect(prepareRequest({ action: "save", target: "entity:name:X" }).ok).toBe(false);
  });

  it("a long class:<Name> describe spills its pages to the artifacts folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wbc-"));
    try {
      const { client, sent } = fakeClient((p) => {
        if (p.mode === "page" && !p.cursor)
          return ok({
            rootClass: "C",
            total: 250,
            rows: row("A", "SCALAR", "1"),
            nextCursor: "200",
          });
        if (p.mode === "page")
          return ok({ rootClass: "C", total: 250, rows: row("B", "SCALAR", "2"), nextCursor: "" });
        return ok({ rootClass: "C", total: 250, typeCounts: ["SCALAR=250"] });
      });
      const res = await runContainer(
        client,
        { action: "describe", target: "class:C" },
        { artifactsRoot: dir, now: () => new Date("2026-11-11T00:00:00Z") },
      );
      expect(res.ok && (res.readback as Record<string, unknown>).artifactRows).toBe(2);
      expect(sent.map((s) => s.params.mode)).toEqual([undefined, "page", "page"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("W2: fields schema and the get schema keys", () => {
  it("fields schema adds widget, limits and enumValues to the default columns, and tells the handler", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        total: 1,
        rows: srow("Speed", "ENUM", "1", "ComboBox", "0,10,1", "A=0|B=1"),
        nextCursor: "",
      }),
    );
    const res = await runContainer(client, {
      action: "describe",
      target: "class:C",
      mode: "page",
      fields: "schema",
    });
    expect(sent[0].params.fields).toBe("schema");
    expect(res.ok && (res.readback as Record<string, unknown>).rows).toEqual([
      {
        name: "Speed",
        type: "ENUM",
        value: "1",
        widget: "ComboBox",
        limits: "0,10,1",
        enumValues: "A=0|B=1",
      },
    ]);
  });

  it("fields path,value,schema keeps the named columns and adds the three; the handler sees only schema", () => {
    const p = prepareRequest({
      action: "describe",
      target: "path:a.conf",
      mode: "page",
      fields: "path, value ,schema",
    });
    expect(p.ok && p.schema).toBe(true);
    expect(p.ok && p.columns).toEqual(["path", "value", "widget", "limits", "enumValues"]);
    expect(p.ok && p.params.fields).toBe("schema");
  });

  it("naming only widget asks for the schema walk and shows just that extra column", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ total: 1, rows: srow("S", "SCALAR", "1", "Slider", "", ""), nextCursor: "" }),
    );
    const res = await runContainer(client, {
      action: "describe",
      target: "path:a.conf",
      mode: "page",
      fields: "path,widget",
    });
    expect(sent[0].params.fields).toBe("schema");
    expect(res.ok && (res.readback as Record<string, unknown>).rows).toEqual([
      { path: "S", widget: "Slider" },
    ]);
  });

  it("without schema the handler is sent no fields", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ total: 1, rows: row("A", "SCALAR", "1"), nextCursor: "" }),
    );
    await runContainer(client, {
      action: "describe",
      target: "path:a.conf",
      mode: "page",
      fields: "path",
    });
    expect(sent[0].params.fields).toBeUndefined();
  });

  it("still refuses an unknown field, naming schema among the choices", () => {
    const p = prepareRequest({ action: "describe", target: "path:a.conf", fields: "name,bogus" });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe("INVALID_ARGUMENT");
      expect(p.error.message).toContain("schema");
    }
  });

  it("a schema describe that spills asks every page for the schema and writes 11 columns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wbc-"));
    try {
      const { client, sent } = fakeClient((p) =>
        p.mode === "page"
          ? ok({
              rootClass: "GenericWorldEntity",
              total: 1,
              rows: srow("A", "SCALAR", "1", "W", "0,1,1", ""),
              nextCursor: "",
            })
          : ok({ rootClass: "GenericWorldEntity", total: 1, typeCounts: ["SCALAR=1"] }),
      );
      const res = await runContainer(
        client,
        { action: "describe", target: "open:WorldEditor", fields: "schema" },
        { artifactsRoot: dir, now: () => new Date("2026-11-11T00:00:00Z") },
      );
      expect(sent.map((s) => s.params.fields)).toEqual(["schema", "schema"]);
      expect(res.ok).toBe(true);
      const dump = JSON.parse(
        readFileSync(join(dir, "container", "2026-11-11T00-00-00-000Z.json"), "utf-8"),
      );
      expect(dump.columns).toHaveLength(11);
      expect(dump.rows[0]).toMatchObject({ path: "A", widget: "W", limits: "0,1,1" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("get answers widget, limits and enumValues when the handler gives them, and omits empties", async () => {
    const { client } = fakeClient((_p, n) =>
      n === 0
        ? ok({
            varType: "ENUM",
            value: "1",
            widget: "ComboBox",
            limits: "0,10,1",
            enumValues: ["A=0", "B=1"],
          })
        : ok({ varType: "STRING", value: "x" }),
    );
    const a = await runContainer(client, { action: "get", target: "path:a.conf", path: "E" });
    expect(a.ok && a.readback).toMatchObject({
      widget: "ComboBox",
      limits: "0,10,1",
      enumValues: ["A=0", "B=1"],
    });
    const b = await runContainer(client, { action: "get", target: "path:a.conf", path: "S" });
    const rb = (b.ok ? b.readback : {}) as Record<string, unknown>;
    expect("widget" in rb).toBe(false);
    expect("limits" in rb).toBe(false);
    expect("enumValues" in rb).toBe(false);
  });

  it("rowsToObjects honours an 11-column layout and drops a trailing partial row", () => {
    const cells = [...srow("A", "T", "v", "W", "L", "E"), "x", "y"];
    expect(rowsToObjects(cells, ["path", "enumValues"], SCHEMA_COLUMNS)).toEqual([
      { path: "A", enumValues: "E" },
    ]);
  });
});

describe("W4: open:<editor> targets (phase5-w4-spec.md 2.3)", () => {
  const EDITORS = ["AnimEditor", "BehaviorEditor", "ProcAnimEditor"] as const;
  const gated = (target: string) => ({
    status: "refused",
    code: "GATED",
    message: `GATED: ${target} waits for probes P-W4-10 and P-W4-29 | next: waits for the W4 live train`,
    next: "waits for the W4 live train; the main session opens it when the probe passes",
  });

  it("the contract purpose names open:<module> and stays within the budget", () => {
    expect(CONTAINER_CONTRACT.purpose).toContain("open:<module>");
    expect(WB_CONTAINER_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("parses each editor target and sends it unchanged, describe and get as reads", () => {
    for (const e of EDITORS) {
      expect(parseEditorTarget(`open:${e}`)).toEqual({ kind: "editor", module: e });
      for (const action of ["describe", "get"]) {
        const p = prepareRequest({
          action,
          target: `open:${e}`,
          ...(action === "get" ? { path: "x" } : {}),
        });
        expect(p.ok, `${action} ${e}`).toBe(true);
        if (p.ok) {
          expect(p.params.target).toBe(`open:${e}`);
          expect(p.mutating).toBe(false);
        }
      }
    }
    expect(parseEditorTarget("open:AudioEditor")).toBeUndefined();
    expect(parseEditorTarget("open:ParticleEditor")).toBeUndefined();
  });

  it("another open: module is refused before anything is sent", async () => {
    const { client, sent } = fakeClient(() => ok());
    for (const target of ["open:ParticleEditor", "open:AudioEditor", "open:ScriptEditor"]) {
      const res = await runContainer(client, { action: "describe", target });
      expect(res.ok, target).toBe(false);
      if (!res.ok) expect(res.code).toBe("INVALID_ARGUMENT");
    }
    expect(sent).toHaveLength(0);
  });

  it("the handler's GATED refusal comes back with its code and next", async () => {
    for (const e of EDITORS) {
      const target = `open:${e}`;
      const { client, sent } = fakeClient(() => gated(target));
      const res = await runContainer(client, { action: "describe", target });
      expect(sent).toHaveLength(1);
      expect(res).toMatchObject({ ok: false, code: "GATED", target });
      if (!res.ok) expect(res.next).toMatch(/W4 live train/);
    }
  });

  it("refuses clear, arrays and setClass on an editor target with UNPROVEN, sending nothing", async () => {
    const writes: Record<string, unknown>[] = [
      { action: "clear", path: "x" },
      { action: "arrayAdd", path: "x", className: "A" },
      { action: "arrayRemove", path: "x", index: 0 },
      { action: "arrayMove", path: "x", index: 0, toIndex: 1 },
      { action: "setClass", path: "x", className: "A" },
    ];
    const { client, sent } = fakeClient(() => ok());
    for (const e of EDITORS) {
      for (const w of writes) {
        const res = await runContainer(client, { target: `open:${e}`, ...w });
        expect(res.ok, `${String(w.action)} ${e}`).toBe(false);
        if (!res.ok) {
          expect(res.code).toBe("UNPROVEN");
          expect(res.message).toContain(`open:${e}`);
          expect(res.message).toContain("Nothing was sent");
        }
      }
    }
    expect(sent).toHaveLength(0);
  });

  it("set and save on an editor target go as mutate; a confirmed save carries the OD-6 warning", async () => {
    const { client, sent } = fakeClient((p) =>
      p.confirm === true
        ? ok({ saved: 1, savedPath: "Anims/a.agr" })
        : ok({ dryRun: 1, savedPath: "Anims/a.agr", message: "would save" }),
    );
    const dry = await runContainer(client, { action: "save", target: "open:AnimEditor" });
    expect(dry.ok && dry.readback).toMatchObject({ dryRun: true, file: "Anims/a.agr" });
    expect(dry.ok && dry.warnings.join(" ")).not.toMatch(/OD-6/);
    const wet = await runContainer(client, {
      action: "save",
      target: "open:AnimEditor",
      confirm: true,
    });
    expect(wet.ok && wet.changed).toEqual([{ path: "Anims/a.agr", before: null, after: "saved" }]);
    expect(wet.ok && wet.warnings.join(" ")).toMatch(/OD-6/);
    expect(sent.map((s) => s.options.access)).toEqual(["mutate", "mutate"]);
    expect(sent.map((s) => s.params.target)).toEqual(["open:AnimEditor", "open:AnimEditor"]);
  });
});

// Census rows this file tests (W1 promotion, EV-W1-119; written by the session 023 close-out).
// census:mcp:action/wb_container.arrayAdd
// census:mcp:action/wb_container.arrayMove
// census:mcp:action/wb_container.arrayRemove
// census:mcp:action/wb_container.clear
// census:mcp:action/wb_container.describe
// census:mcp:action/wb_container.get
// census:mcp:action/wb_container.save
// census:mcp:action/wb_container.set
// census:mcp:action/wb_container.setClass
