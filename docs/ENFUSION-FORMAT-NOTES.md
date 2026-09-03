# Enfusion text-format field notes

Hard-won findings about the Enfusion text container grammar (`.gproj` / `.conf` / `.et` / `.ent` / `.layer` / `.emat` / `.styles` / `.st`), collected while building and testing this server's parser (`src/formats/enfusion-text.ts`), the project index, and the refactor tools. Everything here was verified against real Arma Reforger content or the live Workbench.

## GUID encoding varies by file type

A resource's own GUID is stored differently depending on the container:

| File type | Where the GUID lives | Example |
|---|---|---|
| `.gproj` | `GUID` property on the root | `GUID "6968F5564CA31D9D"` |
| `.et` | `ID` property on the root | `ID "26A9756790131354"` |
| `.conf` | brace-wrapped id on the root node | `SCR_Faction "{5C669673C2A82A2B}" { ... }` |

A scanner has to try all three. Getting this wrong silently drops resources from an index.

## Dependency GUIDs are bare; inheritance refs are braced

- `.gproj` `Dependencies` blocks contain **bare** 16-hex GUIDs: `"58D0FB3206B6F859"` — no braces, no path.
- Inheritance / asset references are **braced + path**: `"{A9806AF617972E97}worlds/Eden/Eden.ent"`.

Two different code paths. A regex that expects one form will miss the other.

## SubScene files have no GUID of their own

A world variant file can be nothing but:

```
SubScene {
 Parent "{GUID}worlds/SomeWorld/SomeWorld.ent"
}
```

This is valid and common (it's how a mod overlays a base-game terrain). It is **not** an indexing error — classify it as unindexable-by-design, not as a parse failure. Refactor tools that need a target GUID must refuse cleanly on SubScene files.

## Inline multi-token vectors are the dominant real-world form

Real `.layer`/`.ent` content stores transforms as **bare, unquoted, space-separated** values:

```
GenericEntity {
 coords 6120.51 157.665 4210.3
 angles 0 90 0
}
```

The quoted form (`coords "100 0 200"`) also exists but is the minority. A parser that only handles the quoted form will appear to work against hand-written fixtures and then silently corrupt Y/Z components of every entity transform on a real file round-trip (this exact bug shipped here once — see `docs/CODE-REVIEW-2026-06-fable.md` FMT-1; the fix collects consecutive numeric tokens into a single property value and round-trips them bare).

**If you touch the parser: add a parse→serialize→parse round-trip test against a real layer file, not just synthetic fixtures.**

## Single-root vs multi-root files

- `.layer` files are **multi-rooted** — a flat sequence of top-level entities with no shared parent.
- `.conf` / `.et` / `.ent` files are **single-rooted** with a typed root (`SCR_MissionHeader*`, `GenericEntity`, `GameProject`, …).

A generic "wrap everything in a sentinel container" parse strategy corrupts single-root files on write: the root's own properties get dropped when the sentinel is unwrapped naively. Handle the two shapes explicitly.

## Serializer bare-vs-quoted rules

Observed contract for when a value may be emitted without quotes:

- Numbers, booleans, and ALL-UPPERCASE identifiers (engine enums like `PC`, `HEADLESS`) → bare.
- All-numeric space-joined vectors (`0 90 0`) → bare (matches real files).
- **16-hex GUIDs → always quoted**, even though they look bare-eligible.
- Mixed-case strings → always quoted.

Over-quoting is always safe; under-quoting corrupts (`ID TestMod` without quotes breaks a `.gproj`).

## resourceDatabase.rdb is an IFF/FORM binary

The Workbench's `resourceDatabase.rdb` is a FORM-chunked binary (`FORM…RDBC` header), not a flat table. Entries embed `<path>\0` strings followed by little-endian 8-byte GUIDs — note the canonical *text* form of a GUID (`{59AD59368755F41A}`) is the **byte-reversed** (big-endian) rendering of the stored value. A `strings`-scan is often good enough to enumerate content paths; a full parse requires walking the chunk structure.

## Doxygen API docs move between builds

The Tools ship the script API as Doxygen HTML inside `Workbench/docs/ArmaReforgerScriptAPIPublic.zip`. Two things have changed across game updates and will again:

1. The **internal layout** moved from `<Root>/annotated.html` to `<Root>/html/annotated.html` (build `stable_1_87_80`). The scraper auto-detects both (`resolvePrefix` in `src/scraper/source-local.ts`).
2. The standalone `EnfusionScriptAPIPublic.zip` was **dropped** — only the combined Arma zip ships now. The scrape writer preserves previously-scraped data when a source disappears (`writeClassesPreserving`) instead of blanking the file.

The Jenkins build branch (e.g. `stable_1_87_80`) is recoverable from the Doxygen-mangled source paths inside the zip and is recorded to `data/api/scrape-meta.json` as provenance.
