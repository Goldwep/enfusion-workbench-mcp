import { describe, it, expect } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILD_STAMP_FILE,
  CallQueue,
  WorkbenchClient,
  WorkbenchError,
  buildWorkbenchArgs,
  bundleDigest,
  checkBuildStamp,
  classifyReset,
  classifyTimeout,
  isValidateSuccessLine,
  MODAL_RESET_MIN_MS,
  WEDGE_AFTER_MS,
} from "../../src/workbench/client.js";
import { decodeResponse, encodePascalString } from "../../src/workbench/protocol.js";

function listen(server: Server): number {
  server.listen(0);
  const a = server.address();
  return a && typeof a !== "string" ? a.port : 0;
}

const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

function okFrame(obj: unknown): Buffer {
  return Buffer.concat([encodePascalString("Ok"), encodePascalString(JSON.stringify(obj))]);
}

describe("empty-payload tolerance (DEC-040 sc-08)", () => {
  it("a bare Ok status throws by default and decodes as {} when allowed", () => {
    const bare = encodePascalString("Ok");
    expect(() => decodeResponse(bare)).toThrow(/no payload/);
    expect(decodeResponse(bare, { allowEmptyPayload: true })).toEqual({});
  });
  it("an empty payload string decodes as {} with or without the option (KD-006)", () => {
    const empty = Buffer.concat([encodePascalString("Ok"), encodePascalString("")]);
    expect(decodeResponse(empty)).toEqual({});
    expect(decodeResponse(empty, { allowEmptyPayload: true })).toEqual({});
  });
  it("an error status still throws when allowed", () => {
    expect(() =>
      decodeResponse(encodePascalString("Undefined API func"), { allowEmptyPayload: true }),
    ).toThrow(/Undefined API func/);
  });
});

describe("CallQueue (U30 serial, wedge detector)", () => {
  it("runs normal jobs one at a time and a probe beside the job in flight", async () => {
    const q = new CallQueue();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const job = (name: string) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(name);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return name;
    };
    const a = q.run("a", job("a"));
    const b = q.run("b", job("b"));
    const c = q.run("c", job("c"), "high");
    expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
    // c is a probe: it starts while a is in flight; b waits for a.
    expect(order).toEqual(["a", "c", "b"]);
    expect(maxActive).toBe(2);
  });

  it("probes run one at a time on their own lane, and a failed one does not stall it", async () => {
    const q = new CallQueue();
    let active = 0;
    let maxActive = 0;
    const probe = (fail: boolean) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (fail) throw new Error("no answer");
      return "pong";
    };
    const first = q.run("p1", probe(true), "high");
    const second = q.run("p2", probe(false), "high");
    await expect(first).rejects.toThrow("no answer");
    expect(await second).toBe("pong");
    expect(maxActive).toBe(1);
  });

  it("a probe is sent while the normal lane is wedged", async () => {
    let fire: (() => void) | null = null;
    const q = new CallQueue(1000, {
      now: () => 0,
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
    });
    let release!: () => void;
    const stuck = q.run("stuck", () => new Promise<void>((r) => (release = r)));
    fire!();
    await expect(q.run("new", async () => 1)).rejects.toMatchObject({ code: "WEDGED" });
    expect(await q.run("ping", async () => "pong", "high")).toBe("pong");
    release();
    await stuck;
  });

  it("a failing job does not stall the queue", async () => {
    const q = new CallQueue();
    const a = q.run("a", async () => {
      throw new Error("boom");
    });
    await expect(a).rejects.toThrow("boom");
    expect(await q.run("b", async () => 1)).toBe(1);
  });

  it("past the wedge threshold waiting and new jobs fail WEDGED; it clears when the job settles", async () => {
    let fire: (() => void) | null = null;
    let t = 0;
    const q = new CallQueue(1000, {
      now: () => t,
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
    });
    let release!: () => void;
    const stuck = q.run("stuck", () => new Promise<string>((r) => (release = () => r("late"))));
    const waiting = q.run("waiting", async () => "never");
    t = 1500;
    fire!();
    await expect(waiting).rejects.toMatchObject({ code: "WEDGED" });
    await expect(q.run("new", async () => 1)).rejects.toMatchObject({ code: "WEDGED" });
    expect(q.inFlight()).toMatchObject({ label: "stuck", wedged: true });
    release();
    expect(await stuck).toBe("late");
    await new Promise((r) => setImmediate(r));
    expect(await q.run("after", async () => 2)).toBe(2);
  });
});

describe("reset and timeout classification (U6, DEC-042)", () => {
  it("a mutating reset is LOST at any age", () => {
    expect(classifyReset("mutate", 5)).toBe("LOST");
    expect(classifyReset("mutate", 120_000)).toBe("LOST");
  });
  it("a read-only reset near 120 s is MODAL_OPEN, an early one a PROTOCOL_ERROR", () => {
    expect(classifyReset("read", 120_000)).toBe("MODAL_OPEN");
    expect(classifyReset("read", MODAL_RESET_MIN_MS - 1)).toBe("PROTOCOL_ERROR");
  });
  it("a timeout at or past the wedge threshold is WEDGED", () => {
    expect(classifyTimeout(10_000)).toBe("TIMEOUT");
    expect(classifyTimeout(WEDGE_AFTER_MS)).toBe("WEDGED");
  });
});

describe("WorkbenchClient over the queue", () => {
  it("serialises concurrent calls: the server never sees two at once", async () => {
    let open = 0;
    let maxOpen = 0;
    const server = createServer({ allowHalfOpen: true }, (s: Socket) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      s.on("data", () => {});
      s.on("end", () =>
        setTimeout(() => {
          open--;
          s.end(okFrame({ ok: 1 }));
        }, 10),
      );
    });
    const port = listen(server);
    try {
      const c = new WorkbenchClient("127.0.0.1", port);
      await Promise.all(Array.from({ length: 5 }, () => c.call("X", {}, { skipAutoLaunch: true })));
      expect(maxOpen).toBe(1);
    } finally {
      await close(server);
    }
  });

  it("retries a refused READ-ONLY call and gives up with CONNECTION_REFUSED", async () => {
    const server = createServer();
    const port = listen(server);
    await close(server); // nothing listens: every connect is refused
    const c = new WorkbenchClient("127.0.0.1", port);
    c.refusalRetryDelaysMs = [1, 1];
    const tries: string[] = [];
    const orig = (c as unknown as { exchange: (...a: unknown[]) => Promise<unknown> }).exchange;
    (c as unknown as { exchange: (...a: unknown[]) => Promise<unknown> }).exchange = function (
      ...a: unknown[]
    ) {
      tries.push(String(a[0]));
      return orig.apply(this, a);
    };
    await expect(c.call("R", {}, { skipAutoLaunch: true, access: "read" })).rejects.toMatchObject({
      code: "CONNECTION_REFUSED",
    });
    expect(tries).toEqual(["R", "R", "R"]);
    tries.length = 0;
    await expect(c.call("M", {}, { skipAutoLaunch: true })).rejects.toMatchObject({
      code: "CONNECTION_REFUSED",
    });
    expect(tries).toEqual(["M"]);
  });

  it("an early reset of a mutating call is LOST, of a read-only call a PROTOCOL_ERROR", async () => {
    const server = createServer((s: Socket) => {
      s.on("error", () => {});
      s.on("data", () => s.resetAndDestroy());
    });
    const port = listen(server);
    try {
      const c = new WorkbenchClient("127.0.0.1", port);
      const lost = await c.call("Mut", {}, { skipAutoLaunch: true }).catch((e: unknown) => e);
      expect(lost).toBeInstanceOf(WorkbenchError);
      expect((lost as WorkbenchError).code).toBe("LOST");
      const read = await c
        .call("Rd", {}, { skipAutoLaunch: true, access: "read" })
        .catch((e: unknown) => e);
      expect((read as WorkbenchError).code).toBe("PROTOCOL_ERROR");
    } finally {
      await close(server);
    }
  });

  it("ping records the build-stamp check (absent stamp tolerated)", async () => {
    const server = createServer((s: Socket) => {
      s.on("data", () => {});
      s.on("end", () => s.end(okFrame({ status: "ok" })));
    });
    const port = listen(server);
    try {
      const c = new WorkbenchClient("127.0.0.1", port);
      expect(await c.ping()).toBe(true);
      expect(c.lastBuildCheck?.status).toBe("absent");
      expect(c.lastBuildCheck?.warning).toMatch(/no buildStamp/);
    } finally {
      await close(server);
    }
  });
});

describe("handler build stamp", () => {
  it("digest leaves the stamp file out and changes with any handler", () => {
    const dir = mkdtempSync(join(tmpdir(), "emcp-stamp-"));
    try {
      writeFileSync(join(dir, "A.c"), "class A {}");
      const d1 = bundleDigest(dir);
      writeFileSync(join(dir, BUILD_STAMP_FILE), "stamp");
      expect(bundleDigest(dir)).toBe(d1);
      writeFileSync(join(dir, "A.c"), "class A { }");
      expect(bundleDigest(dir)).not.toBe(d1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("compares Ping's buildStamp with the bundle", () => {
    expect(checkBuildStamp({ buildStamp: "ABC" }, "abc").status).toBe("match");
    expect(checkBuildStamp({ buildStamp: "def" }, "abc").status).toBe("mismatch");
    // live-client-11: wb_launch takes the already-running path when Ping
    // answers, so the advice must be a restart through wb_launch.
    expect(checkBuildStamp({ buildStamp: "def" }, "abc").warning).toContain(
      "close Workbench and start it again with wb_launch",
    );
    expect(checkBuildStamp({}, "abc").status).toBe("absent");
    expect(checkBuildStamp({ buildStamp: "abc" }, null).status).toBe("no-bundle");
  });
});

describe("launch arguments (DEC-047 L7)", () => {
  const g = "C:/x/Sandbox.gproj";
  it("always passes -gproj and -scriptAuthorizeAll and never the removed forms", () => {
    const a = buildWorkbenchArgs({ gproj: g });
    expect(a).toEqual(["-gproj", g, "-scriptAuthorizeAll"]);
    expect(a.join(" ")).not.toMatch(/wbProjectPath|-config=|logCRC/);
  });
  it("scratch profile, validate, plugin with one token per key, exitAfterInit", () => {
    expect(
      buildWorkbenchArgs({
        gproj: g,
        forceSettings: "C:/s/scratch.ini",
        validate: "PC",
        plugin: { name: "AddonBuildInfoTool", args: { addonPath: "C:/a b" } },
        exitAfterInit: true,
      }),
    ).toEqual([
      "-gproj",
      g,
      "-scriptAuthorizeAll",
      "-forceSettings",
      "C:/s/scratch.ini",
      "-validate=PC",
      "-plugin=AddonBuildInfoTool",
      "-addonPath=C:/a b",
      "-exitAfterInit",
    ]);
  });
  it("ENFUSION_NO_SCRIPT_AUTHORIZE_ALL=1 omits -scriptAuthorizeAll", () => {
    const prev = process.env.ENFUSION_NO_SCRIPT_AUTHORIZE_ALL;
    process.env.ENFUSION_NO_SCRIPT_AUTHORIZE_ALL = "1";
    try {
      expect(buildWorkbenchArgs({ gproj: g })).toEqual(["-gproj", g]);
    } finally {
      if (prev === undefined) delete process.env.ENFUSION_NO_SCRIPT_AUTHORIZE_ALL;
      else process.env.ENFUSION_NO_SCRIPT_AUTHORIZE_ALL = prev;
    }
  });
  it("refuses flag-shaped paths and bad names", () => {
    expect(() => buildWorkbenchArgs({ gproj: "-x.gproj" })).toThrow();
    expect(() => buildWorkbenchArgs({ gproj: "C:/x/a.txt" })).toThrow();
    expect(() => buildWorkbenchArgs({ gproj: g, forceSettings: "-evil" })).toThrow();
    expect(() => buildWorkbenchArgs({ gproj: g, validate: "PC -x" })).toThrow();
    expect(() => buildWorkbenchArgs({ gproj: g, plugin: { name: "a=b" } })).toThrow();
  });
  it("recognises the validate success line", () => {
    expect(isValidateSuccessLine("12:00 SCRIPT : Script validation successful.")).toBe(true);
    expect(isValidateSuccessLine("Script validation failed")).toBe(false);
  });
});

describe("review fixes", () => {
  it("A-1: a timed-out mutating call is LOST, a read-only one TIMEOUT", async () => {
    expect(classifyTimeout(10_000, WEDGE_AFTER_MS, "mutate")).toBe("LOST");
    expect(classifyTimeout(10_000, WEDGE_AFTER_MS, "read")).toBe("TIMEOUT");
    const held: Socket[] = [];
    const server = createServer({ allowHalfOpen: true }, (s: Socket) => {
      held.push(s);
      s.on("error", () => {});
      s.on("data", () => {});
    });
    const port = listen(server);
    try {
      const c = new WorkbenchClient("127.0.0.1", port);

      const m = await c.call("M", {}, { skipAutoLaunch: true, timeout: 50 }).catch((e) => e);
      expect((m as WorkbenchError).code).toBe("LOST");
      // No answer in the time given: the cached state does not claim a live Workbench.
      expect((m as WorkbenchError).timedOut).toBe(true);
      expect(c.state.connected).toBe(false);
      const r = await c
        .call("R", {}, { skipAutoLaunch: true, timeout: 50, access: "read" })
        .catch((e) => e);
      expect((r as WorkbenchError).code).toBe("TIMEOUT");
    } finally {
      for (const s of held) s.destroy();
      await close(server);
    }
  });

  it("A-2: an early-reset LOST marks the cached state disconnected", async () => {
    let n = 0;
    const server = createServer({ allowHalfOpen: true }, (s: Socket) => {
      s.on("error", () => {});
      s.on("data", () => {});
      s.on("end", () => {
        if (n++ === 0) s.end(okFrame({ ok: 1 }));
        else s.resetAndDestroy();
      });
    });
    const port = listen(server);
    try {
      const c = new WorkbenchClient("127.0.0.1", port);
      await c.call("A", {}, { skipAutoLaunch: true });
      expect(c.state.connected).toBe(true);
      const e = await c.call("B", {}, { skipAutoLaunch: true }).catch((x) => x);
      expect((e as WorkbenchError).code).toBe("LOST");
      expect((e as WorkbenchError).connectionDropped).toBe(true);
      expect(c.state.connected).toBe(false);
    } finally {
      await close(server);
    }
  });

  it("A-3: probe() never auto-launches or claims the lease and retries refusals", async () => {
    const server = createServer();
    const port = listen(server);
    await close(server);
    const c = new WorkbenchClient("127.0.0.1", port);
    c.refusalRetryDelaysMs = [1];
    const seen: unknown[] = [];
    const ex = c as unknown as { exchange: (...a: unknown[]) => Promise<unknown> };
    const orig = ex.exchange;
    ex.exchange = function (...a: unknown[]) {
      seen.push(a[2]);
      return orig.apply(this, a);
    };
    await expect(c.probe("IsWorkbenchRunning")).rejects.toMatchObject({
      code: "CONNECTION_REFUSED",
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ access: "read", skipAutoLaunch: true });
  });

  it("A-5: diagnose() pings read-only at high priority", async () => {
    const c = new WorkbenchClient("127.0.0.1", 1);
    const seen: Array<[unknown, unknown]> = [];
    const ex = c as unknown as { exchange: (...a: unknown[]) => Promise<unknown> };
    ex.exchange = async (...a: unknown[]) => {
      seen.push([a[0], a[2]]);
      return { status: "ok" };
    };
    await c.diagnose();
    const ping = seen.find(([f]) => f === "EMCP_WB_Ping");
    expect(ping?.[1]).toMatchObject({ access: "read", priority: "high" });
  });
});
