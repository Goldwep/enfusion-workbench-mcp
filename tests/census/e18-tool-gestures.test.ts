import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { buildSourceIndex, loadSourceIndex } from "../../src/census/source-index.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  GENERATOR,
  INPUT_EVENTS,
  LIFECYCLE_EVENTS,
  enumerateGestures,
  gestureName,
  headline,
  moduleOfAttribute,
  observationFileText,
  overrideDoc,
  prepareSource,
  run as runE18,
  type GestureResult,
} from "../../scripts/census/enumerators/e18-tool-gestures.js";
import { makeCensus, runIn, writeObservations, type Fixture } from "./helpers.js";
import { INSTALL_IS_CENSUS_BUILD } from "./_installed.js";

// ── Synthetic sources ─────────────────────────────────────────────────────────

const BUILD = "1.0.0.1";

/** The shape of the real `WorldEditorTool` declaration: prototypes only, thirteen events. */
const WET = `
class Managed {}
enum ModifierKey { SHIFT, CONTROL, ALT }
enum WETMouseButtonFlag { LEFT, RIGHT, MIDDLE }
enum KeyCode { KC_ESCAPE, KC_SPACE, KC_DELETE, KC_A, KC_F1, KC_X }
class WorldEditorTool: Managed
{
	static proto bool GetModifierKeyState(ModifierKey key);
	static proto void UpdatePropertyPanel();
	event void OnKeyPressEvent(KeyCode key, bool isAutoRepeat);
	event void OnKeyReleaseEvent(KeyCode key, bool isAutoRepeat);
	event void OnEnterEvent();
	event void OnLeaveEvent();
	event void OnMouseMoveEvent(float x, float y);
	event void OnMouseDoubleClickEvent(float x, float y, WETMouseButtonFlag buttons);
	event void OnMousePressEvent(float x, float y, WETMouseButtonFlag buttons);
	event void OnMouseReleaseEvent(float x, float y, WETMouseButtonFlag buttons);
	event void OnWheelEvent(int delta);
	event void OnActivate();
	event void OnDeActivate();
	event void OnAfterLoadWorld();
	event void OnBeforeUnloadWorld();
}
`;

const KEY_TOOL = `
[WorkbenchToolAttribute(name: "Key Tool", description: "d", wbModules: { "WorldEditor" })]
class KeyTool: WorldEditorTool
{
	//! Handles the keyboard
	//! \\param[in] key
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		//Cancel it
		if (key == KeyCode.KC_ESCAPE && isAutoRepeat == false)
		{
			CancelAll();
		}
		else if (KeyCode.KC_DELETE == key) // remove the selection
			DeleteAll();
		else if (key != KeyCode.KC_F1)
		{
			Other();
		}
		switch (key)
		{
			case KeyCode.KC_A:
				AddOne();
				break;
		}
	}

	override void OnKeyReleaseEvent(KeyCode key, bool isAutoRepeat)
	{
		if (key == KeyCode.KC_SPACE)
			Stop();
	}
}
`;

const MOUSE_TOOL = `
[WorkbenchToolAttribute(name: "Mouse Tool", description: "d", wbModules: { "WorldEditor", "ResourceManager" })]
class MouseTool: WorldEditorTool
{
	//! Event triggering on Mouse click - see WorldEditorTool.OnMousePressEvent()
	//! Left click only
	//! \\param[in] buttons
	override void OnMousePressEvent(float x, float y, WETMouseButtonFlag buttons)
	{
		if (buttons != WETMouseButtonFlag.LEFT)
			return;

		if (GetModifierKeyState(ModifierKey.ALT))
		{
			LineMode();
		}
		else
		{
			Paint();
		}

		if (GetModifierKeyState(ModifierKey.SHIFT) && GetModifierKeyState(ModifierKey.CONTROL))
			Both();
	}

	override void OnMouseReleaseEvent(float x, float y, WETMouseButtonFlag buttons)
	{
		if (buttons == WETMouseButtonFlag.RIGHT)
			Context();
		else if (buttons & WETMouseButtonFlag.MIDDLE)
			Pan();
	}

	override void OnWheelEvent(int delta)
	{
		// adjusts the radius using Ctrl + wheel
		if (GetModifierKeyState(ModifierKey.CONTROL))
		{
			Radius(delta);
		}
		if (GetModifierKeyState(ModifierKey.SHIFT))
			Strength(delta);
	}

	override void OnMouseMoveEvent(float x, float y)
	{
		Track(x, y);
	}

	override void OnMouseDoubleClickEvent(float x, float y, WETMouseButtonFlag buttons)
	{
	}

	override void OnLeaveEvent()
	{
		if (!m_bDrawing)
			Clear();
	}

	override void OnActivate()
	{
		Setup();
	}

	override void OnDeActivate()
	{
	}
}
`;

const WHEEL_UNGATED = `
[WorkbenchToolAttribute(name: "Wheel", description: "d", wbModules: { "Nope" })]
class WheelTool: WorldEditorTool
{
	override void OnWheelEvent(int delta)
	{
		Always(delta);
		if (GetModifierKeyState(ModifierKey.CONTROL))
			WithCtrl();
	}
}
`;

const DELEGATING = `
[WorkbenchToolAttribute(name: "Delegating", description: "d")]
class DelegatingTool: WorldEditorTool
{
	void HandleKey(KeyCode k)
	{
		// show the help
		if (k == KeyCode.KC_F1)
			Help();
	}

	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		HandleKey(key);
	}

	override void OnKeyReleaseEvent(KeyCode key, bool isAutoRepeat)
	{
		m_Other.Process(key);
	}
}

[WorkbenchToolAttribute(name: "Computed", description: "d")]
class ComputedTool: WorldEditorTool
{
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		KeyCode copy = key;
		if (copy == KeyCode.KC_F1)
			Help();
	}
}
`;

const INHERITING = `
class BaseTool: WorldEditorTool
{
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		if (key == KeyCode.KC_ESCAPE)
			Cancel();
	}

	override void OnMouseMoveEvent(float x, float y)
	{
		Hover();
	}
}

[WorkbenchToolAttribute(name: "Child", description: "d", wbModules: { "WorldEditor" })]
class ChildTool: BaseTool
{
}

[WorkbenchToolAttribute(name: "Grandchild", description: "d", wbModules: { "WorldEditor" })]
class GrandchildTool: BaseTool
{
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		super.OnKeyPressEvent(key, isAutoRepeat);
		if (key == KeyCode.KC_X)
			Extra();
	}
}
`;

const HELPER_MODS = `
[WorkbenchToolAttribute(name: "Helper Mods", description: "d", wbModules: { "WorldEditor" })]
class HelperModTool: WorldEditorTool
{
	void Select(int x)
	{
		if (m_Filter && !GetModifierKeyState(ModifierKey.SHIFT))
			ApplyFilter();
		Deeper();
	}

	void Deeper()
	{
		// a deeper helper
		if (GetModifierKeyState(ModifierKey.ALT))
			AltBehaviour();
	}

	override void OnMousePressEvent(float x, float y, WETMouseButtonFlag buttons)
	{
		if (buttons != WETMouseButtonFlag.LEFT)
			return;

		Select(1);
	}

	override void OnMouseMoveEvent(float x, float y)
	{
		Select(2);
	}

	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		if (!GetModifierKeyState(ModifierKey.CONTROL))
			Plain();
	}
}
`;

const PLUGIN_WITH_TOOL_ATTRIBUTE = `
[WorkbenchToolAttribute(name: "Not a tool", description: "d", wbModules: { "WorldEditor" })]
class NotAWorldEditorTool: WorkbenchPlugin
{
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		if (key == KeyCode.KC_ESCAPE)
			Nope();
	}
}
class WorkbenchPlugin: Managed {}
`;

function files(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "scripts/GameLib/generated/WorkbenchAPI/Plugins/WorldEditorTool.c": WET,
    "scripts/WorkbenchGame/WorldEditor/KeyTool.c": KEY_TOOL,
    "scripts/WorkbenchGame/WorldEditor/MouseTool.c": MOUSE_TOOL,
    "scripts/WorkbenchGame/WorldEditor/WheelTool.c": WHEEL_UNGATED,
    "scripts/WorkbenchGame/WorldEditor/DelegatingTool.c": DELEGATING,
    "scripts/WorkbenchGame/WorldEditor/InheritingTool.c": INHERITING,
    "scripts/WorkbenchGame/WorldEditor/HelperMods.c": HELPER_MODS,
    "scripts/WorkbenchGame/WorldEditor/NotATool.c": PLUGIN_WITH_TOOL_ATTRIBUTE,
    ...extra,
  };
}

function enumerate(f: Record<string, string> = files()): {
  result: GestureResult;
  index: ReturnType<typeof buildSourceIndex>;
} {
  const index = buildSourceIndex(
    Object.entries(f).map(([path, text]) => ({ path, text })),
    { build: BUILD },
  );
  return { result: enumerateGestures(index, (p) => f[p]), index };
}

const rowsOf = (r: GestureResult, tool: string): string[] =>
  r.observations
    .filter((o) => o.obs.key.path?.[0] === tool)
    .map((o) => o.obs.key.path?.[1] as string)
    .sort();

const rowOf = (r: GestureResult, tool: string, gesture: string) =>
  r.observations.find((o) => o.obs.key.path?.[0] === tool && o.obs.key.path?.[1] === gesture)?.obs;

// ── Tests: what each override says ────────────────────────────────────────────

describe("e18 an override that tests a key constant", () => {
  const { result } = enumerate();

  it("gives one row per (event, key): ==, reversed ==, != and a switch case", () => {
    expect(rowsOf(result, "KeyTool")).toEqual([
      "KeyPress KC_A",
      "KeyPress KC_DELETE",
      "KeyPress KC_ESCAPE",
      "KeyPress KC_F1",
      "KeyRelease KC_SPACE",
    ]);
  });

  it("has no bare KeyPress row when every statement sits under a test", () => {
    expect(rowOf(result, "KeyTool", "KeyPress")).toBeUndefined();
  });

  it("cites the line of the test, quotes it, and is high confidence for a named constant", () => {
    const esc = rowOf(result, "KeyTool", "KeyPress KC_ESCAPE");
    expect(esc).toMatchObject({
      dim: "ui",
      kind: "canvas-gesture",
      module: "WorldEditor",
      origin: "vanilla",
      confidence: "high",
      label: "KeyPress KC_ESCAPE",
      parent_key: { dim: "plugin", kind: "tool", module: "WorldEditor", key: { class: "KeyTool" } },
    });
    const text = KEY_TOOL.split("\n");
    const line = Number(esc?.ref.split("#L")[1]);
    expect(esc?.ref.startsWith("pak:scripts/WorkbenchGame/WorldEditor/KeyTool.c#L")).toBe(true);
    expect(text[line - 1].trim()).toBe(esc?.quote);
    expect(esc?.quote).toContain("KC_ESCAPE");
  });

  it("takes `what` from the comment above the test or on its line, and names the call", () => {
    expect(rowOf(result, "KeyTool", "KeyPress KC_ESCAPE")).toMatchObject({
      what: "Cancel it",
      signature: "OnKeyPressEvent -> CancelAll",
    });
    expect(rowOf(result, "KeyTool", "KeyPress KC_DELETE")).toMatchObject({
      what: "remove the selection",
    });
    const a = rowOf(result, "KeyTool", "KeyPress KC_A");
    expect(a?.what).toBeUndefined();
    expect(a?.signature).toBe("OnKeyPressEvent -> AddOne");
  });
});

describe("e18 an override that tests a mouse button, with a modifier", () => {
  const { result } = enumerate();

  it("combines a modifier inside a guard with the guarded button and keeps the guard's own row", () => {
    expect(rowsOf(result, "MouseTool").filter((g) => g.startsWith("MousePress"))).toEqual([
      "MousePress ALT+LEFT",
      "MousePress CONTROL+SHIFT+LEFT",
      "MousePress LEFT",
    ]);
  });

  it("reads `==` and `&` tests of a button into one row per button", () => {
    expect(rowsOf(result, "MouseTool").filter((g) => g.startsWith("MouseRelease"))).toEqual([
      "MouseRelease MIDDLE",
      "MouseRelease RIGHT",
    ]);
  });

  it("uses the override's doc for a guard, without the parameter and the 'see' line", () => {
    expect(rowOf(result, "MouseTool", "MousePress LEFT")?.what).toBe("Left click only");
    expect(overrideDoc("Event - see WorldEditorTool.OnX()\nUsed to do it\n\\param[in] x")).toBe(
      "Used to do it",
    );
    expect(overrideDoc(undefined)).toBeUndefined();
  });

  it("gives a modifier-only wheel one row per modifier and no bare Wheel row", () => {
    expect(rowsOf(result, "MouseTool").filter((g) => g.startsWith("Wheel"))).toEqual([
      "Wheel CONTROL",
      "Wheel SHIFT",
    ]);
    expect(rowOf(result, "MouseTool", "Wheel CONTROL")?.what).toBe(
      "adjusts the radius using Ctrl + wheel",
    );
    expect(rowOf(result, "MouseTool", "Wheel CONTROL")?.signature).toBe("OnWheelEvent -> Radius");
  });

  it("adds a bare Wheel row when code outside every modifier test still runs", () => {
    expect(rowsOf(result, "WheelTool")).toEqual(["Wheel", "Wheel CONTROL"]);
  });

  it("gives an override that tests nothing one row for the event, empty body included", () => {
    expect(rowOf(result, "MouseTool", "MouseMove")?.signature).toBe("OnMouseMoveEvent");
    expect(rowOf(result, "MouseTool", "MouseDoubleClick")).toBeDefined();
    expect(rowOf(result, "MouseTool", "Leave")).toBeDefined();
  });

  it("does not turn lifecycle overrides into rows, and counts them", () => {
    expect(rowsOf(result, "MouseTool").some((g) => /Activate/.test(g))).toBe(false);
    const t = result.tools.find((x) => x.class === "MouseTool");
    expect(t?.overrides.filter((o) => o.lifecycle).map((o) => o.event)).toEqual([
      "OnActivate",
      "OnDeActivate",
    ]);
    expect(result.leftOut["lifecycle override (OnActivate)"]).toBe(1);
    expect(LIFECYCLE_EVENTS).toHaveLength(4);
    expect(Object.keys(INPUT_EVENTS)).toHaveLength(9);
  });
});

describe("e18 an override that delegates to a helper", () => {
  const { result } = enumerate();

  it("follows a resolved helper: its tests count, with the helper's line and a high confidence", () => {
    const row = rowOf(result, "DelegatingTool", "KeyPress KC_F1");
    expect(row).toMatchObject({ confidence: "high", what: "show the help" });
    expect(row?.signature).toBe("OnKeyPressEvent via DelegatingTool.HandleKey -> Help");
    const line = Number(row?.ref.split("#L")[1]);
    expect(DELEGATING.split("\n")[line - 1]).toContain("KC_F1");
    expect(rowsOf(result, "DelegatingTool").filter((g) => g.startsWith("KeyPress"))).toEqual([
      "KeyPress KC_F1",
    ]);
  });

  it("gives an unresolved helper a bare, medium-confidence row that names the call", () => {
    const row = rowOf(result, "DelegatingTool", "KeyRelease");
    expect(row).toMatchObject({ confidence: "medium" });
    expect(row?.signature).toBe("OnKeyReleaseEvent -> Process (parameter passed on, not resolved)");
  });

  it("gives a computed use of the key a medium bare row next to the test it could read", () => {
    expect(rowsOf(result, "ComputedTool")).toEqual(["KeyPress"]);
    expect(rowOf(result, "ComputedTool", "KeyPress")?.confidence).toBe("medium");
  });

  it("counts the overrides it could not interpret", () => {
    const h = headline(result, enumerate().index);
    expect(h.overrides_not_interpreted.map((u) => `${u.tool}.${u.event}`)).toEqual([
      "ComputedTool.OnKeyPressEvent",
      "DelegatingTool.OnKeyReleaseEvent",
    ]);
  });
});

describe("e18 modifier tests reached through a helper", () => {
  const { result } = enumerate();

  it("reads a modifier tested in a method the override calls, with the call site's button", () => {
    expect(rowsOf(result, "HelperModTool").filter((g) => g.startsWith("Mouse"))).toEqual([
      "MouseMove",
      "MouseMove ALT",
      "MouseMove SHIFT",
      "MousePress ALT+LEFT",
      "MousePress LEFT",
      "MousePress SHIFT+LEFT",
    ]);
  });

  it("gives such a row medium confidence, the line of the test in the helper, and the helper's name", () => {
    const row = rowOf(result, "HelperModTool", "MousePress ALT+LEFT");
    expect(row).toMatchObject({
      confidence: "medium",
      what: "a deeper helper",
      signature: "OnMousePressEvent via HelperModTool.Select",
    });
    const line = Number(row?.ref.split("#L")[1]);
    expect(HELPER_MODS.split("\n")[line - 1]).toContain("ModifierKey.ALT");
  });

  it("keeps the call that no test gates as a bare event row", () => {
    expect(rowOf(result, "HelperModTool", "MouseMove")?.confidence).toBe("high");
    expect(rowOf(result, "HelperModTool", "MousePress")).toBeUndefined();
  });

  it("names a negated modifier without else as a gesture and keeps the plain behaviour as a bare row", () => {
    expect(rowsOf(result, "HelperModTool").filter((g) => g.startsWith("KeyPress"))).toEqual([
      "KeyPress",
      "KeyPress CONTROL",
    ]);
    expect(rowOf(result, "HelperModTool", "KeyPress CONTROL")?.confidence).toBe("high");
  });
});

describe("e18 modifier variables passed on to a helper", () => {
  const VAR_MODS = `
[WorkbenchToolAttribute(name: "Var Mods", description: "d", wbModules: { "WorldEditor" })]
class VarModTool: WorldEditorTool
{
	void ToFirst(int name, bool isDeletion)
	{
		if (isDeletion)
			RemoveIt();
	}

	void ToSecond(int name, bool isDeletion)
	{
		if (isDeletion)
			RemoveOther();
	}

	override void OnMousePressEvent(float x, float y, WETMouseButtonFlag buttons)
	{
		if (buttons != WETMouseButtonFlag.LEFT)
			return;

		bool first = GetModifierKeyState(ModifierKey.CONTROL);
		bool second = GetModifierKeyState(ModifierKey.ALT);
		bool shift = GetModifierKeyState(ModifierKey.SHIFT);

		if (first == second)
		{
			if (shift)
				Add();
			Refresh();
			return;
		}

		if (first)
			ToFirst(1, shift);
		else
			ToSecond(1, shift);
	}

	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		if (key == KeyCode.KC_SPACE)
		{
			Delete(); // delete mode
		}
		else if (key == KeyCode.KC_ESCAPE)
		{
			if (m_bLineMode) // line mode only
			{
				Reset();
			}
		}
	}
}
`;
  const f = files({ "scripts/WorkbenchGame/WorldEditor/VarMods.c": VAR_MODS });
  const { result } = enumerate(f);
  const lineOf = (needle: string): number =>
    VAR_MODS.split("\n").findIndex((l) => l.includes(needle)) + 1;

  it("gives the combination of a variable test and the modifier variable passed to a helper", () => {
    expect(rowsOf(result, "VarModTool").filter((g) => g.startsWith("MousePress"))).toEqual([
      "MousePress ALT+LEFT",
      "MousePress CONTROL+LEFT",
      "MousePress CONTROL+SHIFT+LEFT",
      "MousePress LEFT",
      "MousePress SHIFT+ALT+LEFT",
      "MousePress SHIFT+LEFT",
    ]);
  });

  it("cites and quotes the call, names the helper, and reads the else branch as the partner at medium", () => {
    const then = rowOf(result, "VarModTool", "MousePress CONTROL+SHIFT+LEFT");
    expect(then).toMatchObject({
      confidence: "high",
      quote: "ToFirst(1, shift);",
      signature: "OnMousePressEvent via VarModTool.ToFirst",
    });
    expect(then?.ref.endsWith(`#L${lineOf("ToFirst(1, shift);")}`)).toBe(true);
    const other = rowOf(result, "VarModTool", "MousePress SHIFT+ALT+LEFT");
    expect(other).toMatchObject({ confidence: "medium", quote: "ToSecond(1, shift);" });
    expect(other?.ref.endsWith(`#L${lineOf("ToSecond(1, shift);")}`)).toBe(true);
  });

  it("does not read the else branch as a partner without the exclusive `==` test", () => {
    const loose = VAR_MODS.replace("if (first == second)", "if (m_bOther)");
    const r = enumerate(files({ "scripts/WorkbenchGame/WorldEditor/VarMods.c": loose })).result;
    expect(rowsOf(r, "VarModTool")).not.toContain("MousePress SHIFT+ALT+LEFT");
    expect(rowsOf(r, "VarModTool")).toContain("MousePress CONTROL+SHIFT+LEFT");
  });

  it("takes `what` from a comment on a plain first statement, not from one on an inner condition", () => {
    expect(rowOf(result, "VarModTool", "KeyPress KC_SPACE")?.what).toBe("delete mode");
    const esc = rowOf(result, "VarModTool", "KeyPress KC_ESCAPE");
    expect(esc).toBeDefined();
    expect(esc?.what).toBeUndefined();
  });
});

describe("e18 an inherited override", () => {
  const { result } = enumerate();

  it("gives a tool the gestures of the override it inherits, cited at the ancestor's lines", () => {
    expect(rowsOf(result, "ChildTool")).toEqual(["KeyPress KC_ESCAPE", "MouseMove"]);
    const row = rowOf(result, "ChildTool", "KeyPress KC_ESCAPE");
    const line = Number(row?.ref.split("#L")[1]);
    expect(INHERITING.split("\n")[line - 1]).toContain("KC_ESCAPE");
    expect(
      result.tools.find((t) => t.class === "ChildTool")?.overrides.map((o) => o.inherited),
    ).toEqual([true, true]);
  });

  it("reads a super call as the ancestor's override plus the tool's own tests", () => {
    expect(rowsOf(result, "GrandchildTool")).toEqual([
      "KeyPress KC_ESCAPE",
      "KeyPress KC_X",
      "MouseMove",
    ]);
  });

  it("emits nothing for a base class without the tool attribute, and reports it", () => {
    expect(rowsOf(result, "BaseTool")).toEqual([]);
    expect(result.withoutAttribute).toContain("BaseTool");
  });

  it("leaves out a class with the tool attribute that does not extend WorldEditorTool", () => {
    expect(rowsOf(result, "NotAWorldEditorTool")).toEqual([]);
    expect(result.attributeOnly).toEqual(["NotAWorldEditorTool"]);
    expect(result.descendants).not.toContain("NotAWorldEditorTool");
  });
});

describe("e18 module rule and names", () => {
  const { result } = enumerate();

  it("applies the shared plugin rule: one known entry gives it, anything else Shared", () => {
    expect(moduleOfAttribute('name: "x", wbModules: { "WorldEditor" }')).toBe("WorldEditor");
    expect(moduleOfAttribute('name: "x", wbModules: { "ResourceManager.Config" }')).toBe(
      "ResourceManager.Config",
    );
    expect(moduleOfAttribute('name: "x", wbModules: { "WorldEditor", "ResourceManager" }')).toBe(
      "Shared",
    );
    expect(moduleOfAttribute('name: "x", wbModules: { "Nope" }')).toBe("Shared");
    expect(moduleOfAttribute('name: "x", wbModules: { "none" }')).toBe("Shared");
    expect(moduleOfAttribute('name: "x"')).toBe("Shared");
    expect(moduleOfAttribute(undefined)).toBe("Shared");
    expect(moduleOfAttribute('"n", "d", "", "", { "WorldEditor" }')).toBe("WorldEditor");
  });

  it("puts the tool's module on its rows and on the parent reference", () => {
    for (const [tool, module] of [
      ["KeyTool", "WorldEditor"],
      ["MouseTool", "Shared"],
      ["WheelTool", "Shared"],
      ["DelegatingTool", "Shared"],
      ["ChildTool", "WorldEditor"],
      ["HelperModTool", "WorldEditor"],
    ] as const) {
      for (const o of result.observations.filter((x) => x.obs.key.path?.[0] === tool)) {
        expect(o.obs.module).toBe(module);
        expect(o.obs.parent_key?.module).toBe(module);
        expect(o.id.startsWith(`ui:${module}/canvas-gesture/${tool}/`)).toBe(true);
      }
    }
  });

  it("names a gesture from its event and parts, modifiers first", () => {
    expect(gestureName("MousePress", ["ALT"], ["LEFT"])).toBe("MousePress ALT+LEFT");
    expect(gestureName("Wheel", [], [])).toBe("Wheel");
    expect(gestureName("KeyPress", [], ["KC_ESCAPE"])).toBe("KeyPress KC_ESCAPE");
  });
});

describe("e18 source reading", () => {
  it("masks comments, strings and preprocessor lines without moving an offset", () => {
    const text = `a // x { \n"s{" /* } */ b\n#ifdef Q\nc`;
    const f = prepareSource("p.c", text);
    expect(f.masked).toHaveLength(text.length);
    expect(f.masked).not.toMatch(/[{}]/);
    expect(f.masked).not.toContain("ifdef");
    expect(f.comments.map((c) => c.line)).toEqual([1, 2]);
    expect(f.comments[0].trailing).toBe(true);
  });

  it("reads a body whose brace sits in a string or a comment", () => {
    const f = files({
      "scripts/WorkbenchGame/WorldEditor/Tricky.c": `
[WorkbenchToolAttribute(name: "Tricky", description: "d")]
class TrickyTool: WorldEditorTool
{
	override void OnKeyPressEvent(KeyCode key, bool isAutoRepeat)
	{
		string s = "}{"; // } {
		/* if (key == KeyCode.KC_X) { */
		if (key == KeyCode.KC_F1) { Help(); }
#ifdef DEBUG
		Print("debug");
#endif
	}
}
`,
    });
    const { result } = enumerate(f);
    expect(rowsOf(result, "TrickyTool")).toEqual(["KeyPress KC_F1"]);
  });

  it("refuses an index that no longer matches the text it reads", () => {
    const f = files();
    const index = buildSourceIndex(
      Object.entries(f).map(([path, text]) => ({ path, text })),
      { build: BUILD },
    );
    const changed: Record<string, string> = {
      ...f,
      "scripts/WorkbenchGame/WorldEditor/KeyTool.c": KEY_TOOL + "\n// more",
    };
    expect(() => enumerateGestures(index, (p) => changed[p])).toThrow(/stale source index/);
  });
});

// ── Files, determinism, ledger ────────────────────────────────────────────────

function writeScripts(f: Record<string, string> = files()): string {
  const dir = mkdtempSync(join(tmpdir(), "e18-scripts-"));
  for (const [p, text] of Object.entries(f)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  return dir;
}

const obsFile = (fx: Fixture): string => join(fx.root, "observations", "E18", `${BUILD}.jsonl`);

describe("e18 file, determinism and ledger", () => {
  it("writes a header and sorted rows without an id, and a second run is byte-identical", () => {
    const fx = makeCensus(BUILD);
    const scripts = writeScripts();
    const r1 = runIn(fx, runE18, ["--scripts", scripts]);
    expect(r1.code).toBe(0);
    const text1 = readFileSync(obsFile(fx), "utf-8");
    const lines = text1.trim().split("\n");
    const header = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(header).toMatchObject({
      $header: 1,
      build: BUILD,
      enumerator: "E18",
      generator: GENERATOR,
      provisional: false,
      row_count: lines.length - 1,
    });
    const inputs = header.inputs as { path: string; sha256: string }[];
    expect(inputs[0].path).toBe("<game>/addons/**/scripts/**/*.c");
    expect(
      inputs.some((i) => i.path === "<game>/pak:scripts/WorkbenchGame/WorldEditor/KeyTool.c"),
    ).toBe(true);
    expect(inputs.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(true);
    expect(text1).not.toMatch(/[A-Za-z]:[\\/]/);
    const rows = lines.slice(1).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows.every((o) => !("id" in o) && !("tier" in o))).toBe(true);
    const keys = rows.map((o) => JSON.stringify((o.key as { path: string[] }).path));
    expect(new Set(keys).size).toBe(keys.length);
    const r2 = runIn(fx, runE18, ["--scripts", scripts]);
    expect(r2.code).toBe(0);
    expect(readFileSync(obsFile(fx), "utf-8")).toBe(text1);
    expect(r1.stdout).toContain(`E18 at build ${BUILD}:`);
    // The same rows come out of the exported functions.
    const { result } = enumerate();
    const again = observationFileText(result, BUILD, inputs);
    expect(again.trim().split("\n").slice(1)).toEqual(lines.slice(1));
  });

  it("is accepted by the ledger: no rejected line, and the only problems name the E03 parents", () => {
    const fx = makeCensus(BUILD);
    runIn(fx, runE18, ["--scripts", writeScripts()]);
    const noParents = buildLedger(fx.paths);
    expect(noParents.rejected).toEqual([]);
    const mine = noParents.rows.filter((r) => r.dim === "ui" && r.kind === "canvas-gesture");
    expect(mine.length).toBeGreaterThan(20);
    const problems = noParents.problems.filter((p) => (p.id ?? "").startsWith("ui:"));
    expect(problems.every((p) => /parent .* has no row/.test(p.message))).toBe(true);

    // With E03's tool rows present (written here as E03 would) nothing is left over.
    const tools = [
      ["KeyTool", "WorldEditor"],
      ["MouseTool", "Shared"],
      ["WheelTool", "Shared"],
      ["DelegatingTool", "Shared"],
      ["ComputedTool", "Shared"],
      ["HelperModTool", "WorldEditor"],
      ["ChildTool", "WorldEditor"],
      ["GrandchildTool", "WorldEditor"],
    ].map(([cls, module]) => ({
      dim: "plugin",
      kind: "tool",
      module,
      key: { class: cls },
      parent_key: null,
      origin: "vanilla",
      ref: `pak:scripts/WorkbenchGame/WorldEditor/${cls}.c#L1`,
      confidence: "high",
    }));
    writeObservations(fx, "E03", BUILD, tools);
    const built = buildLedger(fx.paths);
    expect(built.rejected).toEqual([]);
    expect(built.problems.filter((p) => (p.id ?? "").startsWith("ui:"))).toEqual([]);
    const row = built.rows.find(
      (r) => r.id === "ui:WorldEditor/canvas-gesture/KeyTool/KeyPress KC_ESCAPE",
    );
    expect(row).toMatchObject({
      kind: "canvas-gesture",
      parent: "plugin:KeyTool",
      module: "WorldEditor",
    });
    expect(row?.sources[0]).toMatchObject({ enumerator: "E18", confidence: "high" });
  });

  it("answers NO DATA without sources, and refuses a foreign --out", () => {
    const fx = makeCensus(BUILD);
    const noDir = runIn(fx, runE18, ["--scripts", join(tmpdir(), "no-such-e18-dir")]);
    expect(noDir.code).toBe(2);
    expect(noDir.stdout).toContain("NO DATA");
    const noGame = runIn(fx, runE18, ["--game", join(tmpdir(), "no-such-e18-game")]);
    expect(noGame.code).toBe(2);
    expect(noGame.stdout).toContain("NO DATA");
    expect(existsSync(obsFile(fx))).toBe(false);
    const foreign = runIn(fx, runE18, [
      "--scripts",
      writeScripts(),
      "--out",
      join(fx.root, "observations", "E02", `${BUILD}.jsonl`),
    ]);
    expect(foreign.code).toBe(1);
    expect(foreign.stderr).toContain("refusing --out outside observations/E18/");
  });

  it("prints the headline counts as JSON", () => {
    const fx = makeCensus(BUILD);
    const r = runIn(fx, runE18, ["--scripts", writeScripts(), "--json"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout) as { headline: ReturnType<typeof headline> };
    expect(j.headline.classes_extending_tool).toBe(9);
    expect(j.headline.classes_extending_tool_with_attribute).toBe(8);
    expect(j.headline.event_methods_declared).toHaveLength(13);
    expect(j.headline.tool_attribute_classes_not_extending_tool).toEqual(["NotAWorldEditorTool"]);
    expect(j.headline.distinct_modifiers).toEqual(["ALT", "CONTROL", "SHIFT"]);
    expect(j.headline.distinct_buttons).toEqual(["LEFT", "MIDDLE", "RIGHT"]);
    expect(j.headline.distinct_keys).toEqual([
      "KC_A",
      "KC_DELETE",
      "KC_ESCAPE",
      "KC_F1",
      "KC_SPACE",
      "KC_X",
    ]);
  });
});

// ── The real install (skipped when the source index or the game is absent) ────

const REAL_BUILD = "1.8.0.13";
const realIndex = (() => {
  try {
    return loadSourceIndex(REAL_BUILD);
  } catch {
    return undefined;
  }
})();
const gamePath = (() => {
  try {
    return loadConfig().gamePath;
  } catch {
    return "";
  }
})();
const haveGame = !!gamePath && existsSync(join(gamePath, "addons"));

describe.skipIf(!INSTALL_IS_CENSUS_BUILD || !realIndex || !haveGame)("e18 against the installed build", () => {
  it("reproduces the headline counts", () => {
    const vfs = PakVirtualFS.get(gamePath);
    expect(vfs).toBeTruthy();
    const index = realIndex as NonNullable<typeof realIndex>;
    const result = enumerateGestures(index, (p) => (vfs as PakVirtualFS).readTextFile(p));
    const h = headline(result, index);
    expect(h.classes_extending_tool).toBe(19);
    expect(h.classes_extending_tool_with_attribute).toBe(19);
    expect(h.classes_with_tool_attribute).toBe(21);
    expect(h.tool_attribute_classes_not_extending_tool).toEqual([
      "SCR_ImportShapefilePlugin",
      "SCR_NormalAlignedFloatersFinderPlugin",
    ]);
    expect(h.event_methods_declared).toEqual([
      "OnKeyPressEvent",
      "OnKeyReleaseEvent",
      "OnEnterEvent",
      "OnLeaveEvent",
      "OnMouseMoveEvent",
      "OnMouseDoubleClickEvent",
      "OnMousePressEvent",
      "OnMouseReleaseEvent",
      "OnWheelEvent",
      "OnActivate",
      "OnDeActivate",
      "OnAfterLoadWorld",
      "OnBeforeUnloadWorld",
    ]);
    const perTool = Object.fromEntries(
      Object.entries(h.overrides_per_tool).filter(([, v]) => v.input + v.lifecycle > 0),
    );
    expect(Object.keys(perTool)).toHaveLength(8);
    expect(h.overrides_per_tool.SCR_ObjectBrushTool.input).toBe(6);
    expect(h.overrides_per_tool.SCR_SelectionBrushTool.input).toBe(6);
    expect(h.gesture_rows_per_tool.SCR_ObjectBrushTool).toBe(9);
    expect(h.gesture_rows_per_tool.SCR_SelectionBrushTool).toBe(11);
    expect(h.gesture_rows_per_tool.SCR_EntityReplacerTool).toBe(6);
    expect(h.rows).toBe(40);
    expect(h.distinct_keys).toEqual(["KC_DELETE", "KC_ESCAPE", "KC_SPACE"]);
    expect(h.distinct_buttons).toEqual(["LEFT"]);
    expect(h.distinct_modifiers).toEqual(["ALT", "CONTROL", "SHIFT"]);
    expect(h.overrides_not_interpreted).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.scrubbed).toEqual([]);
  });
});
