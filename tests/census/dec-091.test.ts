/**
 * DEC-091 ruling 1: a diag option that its state reader (L15) cannot address
 * at all, explained `out-of-scope` for L15 in its own universe, is settled for
 * every state; G3 does not await a per-mode read that cannot exist. The rule is
 * narrow: another explanation kind, another enumerator, another universe or a
 * diag menu keep their state asks.
 */
import { describe, it, expect } from "vitest";
import { runGates } from "../../src/census/gates.js";
import { run as runBuild } from "../../scripts/census/build.js";
import { run as runDispose } from "../../scripts/census/dispose.js";
import { makeCensus, runIn, writeEvidence, writeObservations, type Fixture } from "./helpers.js";

const BUILD = "1.0.0.1";
const EV = "EV-s1-001";
const READ = "diag:Render/Wireframe";
const UNREAD = "diag:Render/Engine";
const MENU = "diag:Render";

const opt = (name: string): Record<string, unknown> => ({
  dim: "diag",
  kind: "diag-option",
  module: "Shared",
  key: { path: ["Render", name] },
  label: name,
  origin: "vanilla",
  ref: `wiki:Arma_Reforger:Diag_Menu#${name}`,
  confidence: "high",
  what: `diag option ${name}`,
});

function census(): Fixture {
  const fx = makeCensus(BUILD);
  writeObservations(fx, "E14", BUILD, [
    {
      dim: "diag",
      kind: "diag-menu",
      module: "Shared",
      key: { path: ["Render"] },
      label: "Render",
      origin: "vanilla",
      ref: "wiki:Arma_Reforger:Diag_Menu#Render",
      confidence: "high",
      what: "diag menu Render",
    },
    opt("Wireframe"),
    opt("Engine"),
  ]);
  // L15 has run on this build (it saw one option), so the state asks are hard.
  writeObservations(fx, "L15", BUILD, [
    { ...opt("Wireframe"), ref: "artifact:" + "a".repeat(64) + "#d/DEBUGUI_WIREFRAME" },
  ]);
  writeEvidence(fx, EV);
  const b = runIn(fx, runBuild, []);
  expect(b.stdout).not.toMatch(/rejected|problem/);
  expect(b.code).toBe(0);
  return fx;
}

function explain(
  fx: Fixture,
  id: string,
  universe: string,
  enumerator: string,
  kind: string,
): void {
  const r = runIn(fx, runDispose, [
    id,
    "--reconcile-explained",
    universe,
    "--enumerator",
    enumerator,
    "--explain",
    kind,
    "--ref",
    "no read addresses this option (test)",
    "--evidence",
    EV,
  ]);
  expect(r.code).toBe(0);
}

function stateAsks(fx: Fixture, id: string): string[] {
  expect(runIn(fx, runBuild, []).code).toBe(0);
  return runGates(fx.paths, { gates: ["G3"], phase: "4" })
    .gates[0].offenders.filter((o) => o.id === id && o.message.includes(": state "))
    .map((o) => o.message);
}

describe("DEC-091 ruling 1: G3 and the out-of-scope diag option", () => {
  it("counts both mode pairs of an unexplained option as hard once L15 has run", () => {
    const fx = census();
    expect(stateAsks(fx, UNREAD)).toEqual([
      `${UNREAD}: state mode=edit not enumerated`,
      `${UNREAD}: state mode=play not enumerated`,
    ]);
  });

  it("settles every state of an option explained out-of-scope for L15", () => {
    const fx = census();
    explain(fx, UNREAD, "kind:diag-option", "L15", "out-of-scope");
    expect(stateAsks(fx, UNREAD)).toEqual([]);
    // The read option keeps its own asks: only the explained row moves.
    expect(stateAsks(fx, READ)).toHaveLength(2);
  });

  it("does not settle on another explanation kind, enumerator or universe", () => {
    const fx = census();
    explain(fx, UNREAD, "kind:diag-option", "L15", "live-only");
    explain(fx, UNREAD, "kind:diag-option", "E07", "out-of-scope");
    expect(stateAsks(fx, UNREAD)).toHaveLength(2);
  });

  it("does not cover a diag menu", () => {
    const fx = census();
    explain(fx, MENU, "kind:diag-menu", "L15", "out-of-scope");
    expect(stateAsks(fx, MENU)).toHaveLength(2);
  });
});
