import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { registerTools } from "../src/server.js";
import {
  ALIAS_TOOLS,
  CORE_TOOLS,
  EXTENDED_TOOLS,
  TIERS,
  gateToolRegistration,
} from "../src/manifest/tiers.js";

/**
 * The names the E11 inventory counts as registered tools at HEAD (not hard-coded): its file for
 * the census's current build, which is the one E11 rewrites when it runs.
 */
function e11Tools(): string[] {
  const { tag } = JSON.parse(readFileSync("data/census/current-build.json", "utf8")) as {
    tag: string;
  };
  const text = readFileSync(`data/census/observations/E11/${tag}.jsonl`, "utf8");
  const names = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { kind?: string; key?: { tool?: string } })
    .filter((r) => r.kind === "mcp-tool")
    .map((r) => r.key!.tool!);
  return [...new Set(names)].sort();
}

interface Run {
  tools: string[];
  other: string[];
  lines: string[];
}

let tmp: string;
let config: Config;

/** registerTools against a recording fake server, with the env given; undoes its process hooks. */
function run(env: Record<string, string>): Run {
  vi.stubEnv("ENFUSION_TOOLSET", "");
  vi.stubEnv("ENFUSION_TOOLS", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const tools: string[] = [];
  const other: string[] = [];
  const fake = {
    registerTool: (n: string) => void tools.push(n),
    registerPrompt: (n: string) => void other.push(`prompt:${n}`),
    registerResource: (n: string) => void other.push(`resource:${n}`),
  };
  const lines: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    lines.push(a.join(" "));
  });
  const em = process as unknown as NodeJS.EventEmitter;
  const events = ["exit", "SIGINT", "SIGTERM"];
  const before = new Map(events.map((ev) => [ev, em.listeners(ev)]));
  try {
    registerTools(fake as never, { ...config, projectIndexPath: join(tmp, `i${Date.now()}.db`) });
  } finally {
    spy.mockRestore();
    for (const ev of events) {
      for (const l of em.listeners(ev)) {
        if (!before.get(ev)!.includes(l)) em.off(ev, l as (...a: unknown[]) => void);
      }
    }
    vi.unstubAllEnvs();
  }
  return { tools: tools.sort(), other, lines };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "emcp-reg-"));
  config = {
    ...loadConfig(),
    projectPath: join(tmp, "none-project"),
    corePath: join(tmp, "none-core"),
    workshopPath: undefined,
  };
});

afterAll(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* an open sqlite handle can pin the file on Windows */
  }
});

describe("registerTools honours ENFUSION_TOOLSET and ENFUSION_TOOLS", () => {
  it("registers every tool the E11 inventory counts under all", () => {
    const r = run({ ENFUSION_TOOLSET: "all" });
    expect(r.tools).toEqual(e11Tools());
    expect(r.tools.length).toBeGreaterThan(100);
    expect(r.other.length).toBeGreaterThan(0); // prompts and resources are never gated
    const log = r.lines.find((l) => l.includes("toolset=all"));
    expect(log).toContain(`${r.tools.length} tools registered, 0 skipped`);
  });

  it("registers exactly the core set under the default toolset", () => {
    const all = e11Tools();
    const r = run({});
    const expected = (CORE_TOOLS as readonly string[]).filter((n) => all.includes(n)).sort();
    expect(r.tools).toEqual(expected);
    expect(r.tools.some((n) => (ALIAS_TOOLS as readonly string[]).includes(n))).toBe(false);
    const log = r.lines.find((l) => l.includes("toolset=core"));
    expect(log).toContain(
      `${expected.length} tools registered, ${all.length - expected.length} skipped`,
    );
  });

  it("extended registers everything except the aliases", () => {
    const all = e11Tools();
    const r = run({ ENFUSION_TOOLSET: "extended" });
    expect(r.tools).toEqual(all.filter((n) => !(ALIAS_TOOLS as readonly string[]).includes(n)));
  });

  it("applies +name and -name over the toolset", () => {
    const r = run({ ENFUSION_TOOLS: "+terrain_inspect,-wiki_read" });
    expect(r.tools).toContain("terrain_inspect");
    expect(r.tools).not.toContain("wiki_read");
    expect(r.tools).toContain("wiki_search");
    expect(r.lines.some((l) => l.includes("overrides=+terrain_inspect,-wiki_read"))).toBe(true);
  });

  it("refuses a bad ENFUSION_TOOLSET at startup", () => {
    expect(() => run({ ENFUSION_TOOLSET: "most" })).toThrow(/core, extended or all/);
  });
});

describe("the tiers table covers every tool", () => {
  it("lists tool names the table does not know (they would be extended by default)", () => {
    const unknown = e11Tools().filter((n) => !(n in TIERS));
    expect(unknown, `add these to EXTENDED_TOOLS or CORE_TOOLS: ${unknown.join(", ")}`).toEqual([]);
  });

  it("has no extended entry for a tool that also sits in core or alias", () => {
    const other = new Set<string>([...CORE_TOOLS, ...ALIAS_TOOLS]);
    expect((EXTENDED_TOOLS as readonly string[]).filter((n) => other.has(n))).toEqual([]);
  });

  it("every table name (core, alias, extended) is a registered tool", () => {
    const all = new Set(e11Tools());
    const missing = [...CORE_TOOLS, ...ALIAS_TOOLS, ...EXTENDED_TOOLS].filter((n) => !all.has(n));
    expect(missing).toEqual([]);
  });
});

describe("gateToolRegistration", () => {
  it("binds pass-through members to the real server and skips refused tools", () => {
    const seen: string[] = [];
    const real = {
      tag: "real",
      registerTool(this: { tag: string }, n: string) {
        seen.push(`${this.tag}:${n}`);
      },
      registerPrompt(this: { tag: string }) {
        return this.tag;
      },
    };
    const { server, stats } = gateToolRegistration(real, {});
    server.registerTool("wb_state");
    server.registerTool("terrain_inspect");
    const pass = server.registerPrompt as () => string;
    expect(pass()).toBe("real");
    expect(seen).toEqual(["real:wb_state"]);
    expect(stats).toEqual({
      toolset: "core",
      registered: ["wb_state"],
      skipped: ["terrain_inspect"],
    });
  });
});
