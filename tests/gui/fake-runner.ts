/** A fake PowerShell runner for the GUI tests: no real UI Automation runs. */
import type { PowerShellRunner, UiaNode, WindowInfo } from "../../src/gui/uia.js";

export interface FakeCall {
  kind: "list" | "walk" | "capture" | "other";
  env: Record<string, string>;
  script: string;
}

export function win(p: Partial<WindowInfo> & { hwnd: number }): WindowInfo {
  return {
    pid: 100,
    className: "QtWindow",
    title: "",
    visible: true,
    owned: false,
    hung: false,
    ...p,
  };
}

export function node(p: Partial<UiaNode>): UiaNode {
  return {
    controlType: "Pane",
    name: "",
    automationId: "",
    className: "",
    rect: null,
    enabled: true,
    offscreen: false,
    patterns: [],
    ...p,
  };
}

export function fakeRunner(state: {
  windows: () => WindowInfo[];
  trees?: Record<number, UiaNode>;
  identity?: (hwnd: number) => { pid: number; hwnd: number };
  fail?: boolean;
}): { run: PowerShellRunner; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const run: PowerShellRunner = async (script, opts) => {
    const kind = script.includes("EmcpGuiWalk]::Run")
      ? "walk"
      : script.includes("EmcpGuiWindows]::List")
        ? "list"
        : script.includes("CopyFromScreen")
          ? "capture"
          : "other";
    calls.push({ kind, env: opts.env, script });
    if (state.fail) return { ok: false, stdout: "", stderr: "boom", error: "boom" };
    if (kind === "list") {
      return {
        ok: true,
        stdout: `noise\n${JSON.stringify(state.windows())}\n`,
        stderr: "",
        error: null,
      };
    }
    if (kind === "walk") {
      const hwnd = Number(opts.env.EMCP_GUI_HWND);
      const tree = state.trees?.[hwnd] ?? node({ name: "empty" });
      const identity = state.identity?.(hwnd) ?? { pid: Number(opts.env.EMCP_GUI_PID), hwnd };
      return {
        ok: true,
        stdout: JSON.stringify({ identity, tree, nodes: 3, stopReason: null, elapsedMs: 5 }),
        stderr: "",
        error: null,
      };
    }
    if (kind === "capture") {
      return { ok: true, stdout: '{"width":3840,"height":1080}', stderr: "", error: null };
    }
    return { ok: false, stdout: "", stderr: "", error: "unexpected script" };
  };
  return { run, calls };
}
