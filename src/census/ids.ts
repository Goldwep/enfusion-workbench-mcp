/**
 * Row identity (plan 4.4, main ruling 4). Ids are derived from an
 * observation's `key`; an observation never supplies a trusted id.
 *
 * Forms (the plan's, plus the ones the plan leaves open, recorded as
 * decisions in the hand-off):
 *   api:<Class>.<Method>/<arity>     method, static-method, event
 *   api:<Class>                      class, enum
 *   api:<Class>.<Member>             enum-value
 *   api:<Class>#attr:<member>        attribute of a non-plugin class (ruling 4)
 *   plugin:<Class>                   plugin, tool (script tool)
 *   plugin:<Class>#attr:|#button:|#cli:<name>
 *   net:native/<Name>  net:handler/<Class>  net:handler/<Class>#req:|#resp:<field>
 *   cli:-<switch>
 *   ui:<Module>/<kind>/<path...>     or ui:<Module>/<kind>/#<object name>
 *   file:.<ext>
 *   schema:<Class>  schema:<Class>.<key>  schema:<Class>#prop:<key>
 *   setting:<Section>/<key>
 *   diag:<menu path>
 *   mcp:tool/<name>  mcp:action/<tool>.<action>  mcp:handler-action/<Class>.<action>
 *   link:<name>
 *   <dim>:<kind>/<name>              generic form: kinds with no form above, and
 *                                    provisional (E01) rows that lack the parts
 */
import type { ObservationKey } from "./schemas.js";
import type { Dim, Kind } from "./vocab.js";

// ── Labels ────────────────────────────────────────────────────────────────────

/**
 * Normalises a UI label for identity: drops the shortcut text after a tab,
 * removes the mnemonic marker (`&File` -> `File`, `&&` -> `&`), trims and
 * collapses whitespace. Case is kept (ids are case-sensitive).
 */
export function normalizeLabel(raw: string): string {
  const noShortcut = raw.split("\t")[0];
  const noMnemonic = noShortcut.replace(/&(&?)/g, (_m, amp: string) => amp);
  return noMnemonic.replace(/\s+/g, " ").trim();
}

/** Escapes one id path segment: `%`, `/` and a leading `#`. */
export function escapeSegment(s: string): string {
  const e = s.replace(/%/g, "%25").replace(/\//g, "%2F");
  return e.startsWith("#") ? "%23" + e.slice(1) : e;
}

// ── Derivation ────────────────────────────────────────────────────────────────

export interface IdInput {
  dim: Dim;
  kind: Kind;
  module: string;
  key: ObservationKey;
}

interface Form {
  dims: readonly Dim[];
  kinds: readonly Kind[];
  /** Key fields that must be present (and no others). Alternatives are tried in order. */
  fields: readonly (readonly (keyof ObservationKey)[])[];
  make: (k: ObservationKey, input: IdInput) => string;
}

const FORMS: readonly Form[] = [
  {
    dims: ["api"],
    kinds: ["method", "static-method", "event"],
    fields: [["class", "method", "arity"]],
    make: (k) => `api:${k.class}.${k.method}/${k.arity}`,
  },
  { dims: ["api"], kinds: ["class", "enum"], fields: [["class"]], make: (k) => `api:${k.class}` },
  {
    dims: ["api"],
    kinds: ["enum-value"],
    fields: [["class", "member"]],
    make: (k) => `api:${k.class}.${k.member}`,
  },
  {
    dims: ["api"],
    kinds: ["attribute"],
    fields: [["class", "attr"]],
    make: (k) => `api:${k.class}#attr:${k.attr}`,
  },
  {
    dims: ["plugin"],
    kinds: ["plugin", "tool"],
    fields: [["class"]],
    make: (k) => `plugin:${k.class}`,
  },
  {
    dims: ["plugin"],
    kinds: ["plugin-setting", "attribute"],
    fields: [["class", "attr"]],
    make: (k) => `plugin:${k.class}#attr:${k.attr}`,
  },
  {
    dims: ["plugin"],
    kinds: ["plugin-button"],
    fields: [["class", "button"]],
    make: (k) => `plugin:${k.class}#button:${k.button}`,
  },
  {
    dims: ["plugin"],
    kinds: ["plugin-cli-arg"],
    fields: [["class", "cli"]],
    make: (k) => `plugin:${k.class}#cli:${k.cli}`,
  },
  {
    dims: ["net"],
    kinds: ["net-function"],
    fields: [["native"]],
    make: (k) => `net:native/${k.native}`,
  },
  {
    dims: ["net"],
    kinds: ["net-handler"],
    fields: [["handler"]],
    make: (k) => `net:handler/${k.handler}`,
  },
  {
    dims: ["net"],
    kinds: ["net-field"],
    fields: [
      ["handler", "req"],
      ["handler", "resp"],
    ],
    make: (k) =>
      k.req !== undefined
        ? `net:handler/${k.handler}#req:${k.req}`
        : `net:handler/${k.handler}#resp:${k.resp}`,
  },
  {
    dims: ["cli"],
    kinds: ["cli-switch"],
    fields: [["switch"]],
    make: (k) => `cli:-${(k.switch ?? "").replace(/^-+/, "")}`,
  },
  {
    dims: ["file"],
    kinds: ["file-type"],
    fields: [["ext"]],
    make: (k) => `file:.${(k.ext ?? "").replace(/^\.+/, "").toLowerCase()}`,
  },
  {
    dims: ["schema"],
    kinds: ["schema-class"],
    fields: [["class"]],
    make: (k) => `schema:${k.class}`,
  },
  {
    dims: ["schema"],
    kinds: ["schema-key"],
    fields: [["class", "key"]],
    make: (k) => `schema:${k.class}.${k.key}`,
  },
  {
    dims: ["schema"],
    kinds: ["property"],
    fields: [["class", "key"]],
    make: (k) => `schema:${k.class}#prop:${k.key}`,
  },
  {
    dims: ["setting"],
    kinds: ["setting-key", "option"],
    fields: [["section", "key"]],
    make: (k) => `setting:${escapeSegment(k.section ?? "")}/${escapeSegment(k.key ?? "")}`,
  },
  {
    dims: ["diag"],
    kinds: ["diag-menu", "diag-option"],
    fields: [["path"]],
    make: (k) => `diag:${(k.path ?? []).map((s) => escapeSegment(normalizeLabel(s))).join("/")}`,
  },
  {
    dims: ["mcp"],
    kinds: ["mcp-tool"],
    fields: [["tool"]],
    make: (k) => `mcp:tool/${k.tool}`,
  },
  {
    dims: ["mcp"],
    kinds: ["mcp-action"],
    fields: [["tool", "action"]],
    make: (k) => `mcp:action/${k.tool}.${k.action}`,
  },
  {
    dims: ["mcp"],
    kinds: ["handler-action"],
    fields: [["handler", "action"]],
    make: (k) => `mcp:handler-action/${k.handler}.${k.action}`,
  },
  { dims: ["link"], kinds: ["link-format"], fields: [["name"]], make: (k) => `link:${k.name}` },
  {
    dims: ["ui"],
    kinds: [],
    fields: [["object_name"], ["path"]],
    make: (k, input) =>
      k.object_name !== undefined
        ? `ui:${input.module}/${input.kind}/#${k.object_name}`
        : `ui:${input.module}/${input.kind}/${(k.path ?? [])
            .map((s) => escapeSegment(normalizeLabel(s)))
            .join("/")}`,
  },
];

function presentFields(key: ObservationKey): string[] {
  return Object.keys(key).filter((f) => key[f as keyof ObservationKey] !== undefined);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function genericId(input: IdInput): string {
  return `${input.dim}:${input.kind}/${escapeSegment(input.key.name ?? "")}`;
}

/**
 * Derives a row id from an observation's identity. Throws with a reason when
 * the key does not fit the kind's form. `allowGeneric` lets a provisional
 * enumerator (E01) fall back to `<dim>:<kind>/<name>` when it lacks the parts
 * of the strong form.
 */
export function deriveId(input: IdInput, options: { allowGeneric?: boolean } = {}): string {
  const present = presentFields(input.key);
  const form = FORMS.find(
    (f) => f.dims.includes(input.dim) && (f.kinds.length === 0 || f.kinds.includes(input.kind)),
  );
  if (form) {
    for (const fields of form.fields) {
      if (sameSet(fields, present)) {
        for (const f of fields) {
          const v = input.key[f];
          if (typeof v === "string" && /[\s]/.test(v) && f !== "path" && input.dim !== "setting") {
            throw new Error(`key.${f} must not contain whitespace for ${input.dim} ${input.kind}`);
          }
        }
        return form.make(input.key, input);
      }
    }
    if (options.allowGeneric && sameSet(["name"], present)) return genericId(input);
    const wanted = form.fields.map((f) => `{${f.join(", ")}}`).join(" or ");
    throw new Error(
      `key {${present.join(", ")}} does not fit ${input.dim} ${input.kind}: expected ${wanted}`,
    );
  }
  if (sameSet(["name"], present)) return genericId(input);
  throw new Error(
    `key {${present.join(", ")}} does not fit ${input.dim} ${input.kind}: expected {name}`,
  );
}

/** The id prefix (`api:`, `ui:`, ...) of an id. */
export function idPrefix(id: string): string {
  const i = id.indexOf(":");
  return i === -1 ? "" : id.slice(0, i + 1);
}
