/**
 * Parser and serializer for Enfusion text serialization format.
 * Used by .gproj, .et, .ct, .conf, .layer files.
 *
 * Grammar:
 *   Document     = Node
 *   Node         = TypeName [GUID] [":" QuotedString] "{" Content* "}"
 *   Content      = Property | BareValue | Node
 *   Property     = Key (QuotedString | Number | Node)
 *   BareValue    = QuotedString (standalone value inside a block, e.g. dependency GUIDs)
 *   QuotedString = '"' chars '"'
 */

/** A single property: key-value pair */
export interface EnfusionProperty {
  key: string;
  value: string | EnfusionNode;
}

/** A node in the Enfusion text tree */
export interface EnfusionNode {
  /** Type name (e.g., "GameProject", "GenericEntity", "MeshObject") */
  type: string;
  /** Quoted GUID that follows the type name (e.g., component instance ID) */
  id?: string;
  /**
   * Class qualifier between type/key and the GUID.
   * E.g., in `Attributes SCR_ItemAttributeCollection "{GUID}" { ... }`,
   * type="Attributes", className="SCR_ItemAttributeCollection", id="{GUID}".
   */
  className?: string;
  /** Parent reference after ":" (e.g., "{GUID}path/to/parent.et") */
  inheritance?: string;
  /** Key-value properties */
  properties: EnfusionProperty[];
  /** Standalone quoted values (e.g., dependency GUIDs in Dependencies block) */
  values: string[];
  /** Child nodes (blocks nested inside this node) */
  children: EnfusionNode[];
  /**
   * Optional raw string to emit verbatim inside the braces instead of serializing
   * properties/values/children. Used when injecting ancestor components with their
   * original content preserved exactly.
   */
  rawContent?: string;
  /**
   * Line-ending style detected on the ROOT node at parse time ("\r\n" when the
   * source used CRLF). serialize() honors it so CRLF files round-trip
   * byte-identically. Undefined (or "\n") means LF.
   */
  eol?: "\n" | "\r\n";
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

enum TokenType {
  String, // "quoted string"
  Identifier, // bare word (alphanumeric + _ + .)
  OpenBrace, // {
  CloseBrace, // }
  Colon, // :
}

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

/**
 * Source pattern for one numeric scalar as Enfusion writes it bare:
 *   - optional sign (`-` or `+`)
 *   - hex integer (`0x3`, `0xFF`) — engine flag masks, e.g. `Flags 0 0x3`
 *   - decimal in any of the forms `5`, `5.`, `.5`, `5.25`
 *   - optional exponent (`1e-05`, `2.5E+3`) — the engine prints small floats
 *     in scientific notation
 * Shared by the parser (inline-vector run detection) and the serializer
 * (bare emission) so both sides agree on what "numeric" means. C1: the old
 * `-?\d+(\.\d+)?` rejected hex/exponent tokens, which broke the run logic
 * and turned `Flags 0 0x3` + `coords x y z` into bogus key/value pairs.
 */
const NUMERIC_SRC = String.raw`[-+]?(?:0[xX][0-9A-Fa-f]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)`;
const NUMERIC_RE = new RegExp(`^${NUMERIC_SRC}$`);
/** Two or more numeric scalars separated by single spaces (`0 0x3`, `1 2 3`). */
const NUMERIC_VECTOR_RE = new RegExp(`^${NUMERIC_SRC}(?: ${NUMERIC_SRC})+$`);

/** Maximum node nesting depth accepted by the parser (M22: clear Error, not RangeError). */
export const MAX_NODE_DEPTH = 256;

/** True when a string is a single bare numeric scalar (see NUMERIC_SRC). */
export function isNumericScalar(value: string): boolean {
  return NUMERIC_RE.test(value);
}

/**
 * True when an identifier token is a numeric scalar (integer, decimal, hex,
 * or exponent form, optionally signed). Used to recognize inline
 * multi-component vectors like `coords 0 0 0` or `angles 0 90 0`, whose
 * components the tokenizer emits as separate identifier tokens (newlines are
 * discarded). Only numeric runs are joined into a single property value —
 * this is deliberately narrow so that a bare value followed by a node type
 * (`Key TypeName { ... }`) is never swallowed, and non-numeric bare values
 * keep their single-token behavior.
 */
function isNumericToken(tok: Token | undefined): boolean {
  return tok !== undefined && tok.type === TokenType.Identifier && NUMERIC_RE.test(tok.value);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Skip single-line comments (// ...)
    if (ch === "/" && i + 1 < len && input[i + 1] === "/") {
      while (i < len && input[i] !== "\n") i++;
      continue;
    }

    // Quoted string
    if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      let str = "";
      while (i < len && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < len) {
          const esc = input[i + 1];
          switch (esc) {
            case "n":
              str += "\n";
              break;
            case "t":
              str += "\t";
              break;
            case "r":
              str += "\r";
              break;
            case "\\":
              str += "\\";
              break;
            case '"':
              str += '"';
              break;
            default:
              str += esc;
              break;
          }
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i < len) i++; // skip closing quote
      tokens.push({ type: TokenType.String, value: str, pos: start });
      continue;
    }

    if (ch === "{") {
      tokens.push({ type: TokenType.OpenBrace, value: "{", pos: i });
      i++;
      continue;
    }

    if (ch === "}") {
      tokens.push({ type: TokenType.CloseBrace, value: "}", pos: i });
      i++;
      continue;
    }

    if (ch === ":") {
      tokens.push({ type: TokenType.Colon, value: ":", pos: i });
      i++;
      continue;
    }

    // Identifier (bare word): letters, digits, underscore, dot, dash, plus
    // (`+` so exponent floats like `1e+05` stay one token — it used to be
    // silently dropped as an unknown character).
    if (/[a-zA-Z0-9_.\-+]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_.\-+]/.test(input[i])) i++;
      tokens.push({ type: TokenType.Identifier, value: input.substring(start, i), pos: start });
      continue;
    }

    // Unknown character — skip
    i++;
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const tok = this.advance();
    if (!tok || tok.type !== type) {
      const got = tok ? `${TokenType[tok.type]}("${tok.value}") at pos ${tok.pos}` : "EOF";
      throw new Error(`Expected ${TokenType[type]} but got ${got}`);
    }
    return tok;
  }

  /**
   * Parse the root node. An Enfusion document is a single top-level node.
   */
  parseDocument(): EnfusionNode {
    const node = this.parseNode(0);
    return node;
  }

  /**
   * Parse a node:
   *   TypeName [GUID_STRING] [":" InheritanceString] "{" content* "}"
   *
   * `depth` is the nesting level of this node (root = 0); nesting deeper than
   * MAX_NODE_DEPTH raises a clear Error instead of overflowing the stack.
   */
  private parseNode(depth: number): EnfusionNode {
    if (depth > MAX_NODE_DEPTH) {
      const at = this.peek();
      throw new Error(
        `Node nesting exceeds maximum depth of ${MAX_NODE_DEPTH}` +
          (at ? ` at pos ${at.pos}` : ""),
      );
    }
    // Type name — can be Identifier or String (some types are quoted)
    const typeTok = this.advance();
    if (!typeTok || (typeTok.type !== TokenType.Identifier && typeTok.type !== TokenType.String)) {
      const got = typeTok ? `${TokenType[typeTok.type]}("${typeTok.value}")` : "EOF";
      throw new Error(`Expected type name but got ${got}`);
    }

    const node: EnfusionNode = {
      type: typeTok.value,
      properties: [],
      values: [],
      children: [],
    };

    // Optional bare-word after type name (e.g., "GameProjectConfig PC" or class qualifier)
    let next = this.peek();
    if (next && next.type === TokenType.Identifier) {
      const saved = this.pos;
      const bareId = this.advance();
      const afterBare = this.peek();
      if (
        afterBare &&
        (afterBare.type === TokenType.OpenBrace || afterBare.type === TokenType.Colon)
      ) {
        // BareWord followed by { or : — it's a simple bare-word ID (e.g., "PC")
        node.id = bareId.value;
      } else if (afterBare && afterBare.type === TokenType.String) {
        // BareWord followed by "String" — could be className + GUID or just bare ID before colon
        const saved2 = this.pos;
        const strTok = this.advance();
        const afterStr = this.peek();
        if (
          afterStr &&
          (afterStr.type === TokenType.OpenBrace || afterStr.type === TokenType.Colon)
        ) {
          // Type BareWord "GUID" { — bare word is class qualifier, string is ID
          node.className = bareId.value;
          node.id = strTok.value;
        } else {
          // BareWord "String" not followed by { or : — bare word is just an ID
          this.pos = saved2;
          node.id = bareId.value;
        }
      } else {
        this.pos = saved;
      }
    }

    // Optional quoted GUID string after type name (when no bare-word was consumed)
    next = this.peek();
    if (next && next.type === TokenType.String && node.id === undefined) {
      const saved = this.pos;
      const strTok = this.advance();
      const afterStr = this.peek();
      if (
        afterStr &&
        (afterStr.type === TokenType.OpenBrace || afterStr.type === TokenType.Colon)
      ) {
        node.id = strTok.value;
      } else {
        this.pos = saved;
      }
    }

    // Optional inheritance: ":" QuotedString
    next = this.peek();
    if (next && next.type === TokenType.Colon) {
      this.advance(); // consume ":"
      const inhTok = this.expect(TokenType.String);
      node.inheritance = inhTok.value;
    }

    // Opening brace
    this.expect(TokenType.OpenBrace);

    // Parse contents until closing brace
    while (true) {
      next = this.peek();
      if (!next) {
        throw new Error("Unexpected EOF, expected '}'");
      }
      if (next.type === TokenType.CloseBrace) {
        this.advance();
        break;
      }

      // What kind of content?
      if (next.type === TokenType.Identifier) {
        // Could be:
        // 1. Property: Key "value"  or  Key Number
        // 2. Property: Key SubNode  (Key TypeName "{" ... "}")
        // 3. Child node: TypeName ["guid"] [":" "parent"] "{" ... "}"

        // Look ahead to determine which case
        const saved = this.pos;
        const identTok = this.advance();
        const after = this.peek();

        if (!after || after.type === TokenType.CloseBrace) {
          // Bare identifier at end of block — treat as a value
          node.values.push(identTok.value);
        } else if (after.type === TokenType.String) {
          // Could be: Key "value" (property)
          // Or: TypeName "guid" { ... } (child node with ID)
          const saved2 = this.pos;
          const strTok = this.advance();
          const afterStr = this.peek();

          if (afterStr && afterStr.type === TokenType.OpenBrace) {
            // TypeName "guid" { ... } — child node with ID
            this.pos = saved; // restore to before identifier
            const child = this.parseNode(depth + 1);
            node.children.push(child);
          } else if (afterStr && afterStr.type === TokenType.Colon) {
            // TypeName "guid" : "parent" { ... } — child node with ID + inheritance
            this.pos = saved;
            const child = this.parseNode(depth + 1);
            node.children.push(child);
          } else {
            // Key "value" — simple property
            node.properties.push({ key: identTok.value, value: strTok.value });
          }
        } else if (after.type === TokenType.Identifier) {
          // Could be: Key SubNode  (e.g., "Configurations" "GameProjectConfig PC { ... }")
          // Or property with bare value: Key BareValue
          // Look further: if after the second identifier we see "{", it's a child node
          const saved2 = this.pos;
          const ident2 = this.advance();
          const afterIdent2 = this.peek();

          if (afterIdent2 && afterIdent2.type === TokenType.OpenBrace) {
            // Key TypeName { ... } — this is a property whose value is a child node
            // OR it's two identifiers before a brace (TypeName SubType { })
            // In Enfusion: "GameProjectConfig PC { ... }" means type=GameProjectConfig, but "PC" is like an ID
            // Let's treat it as: identTok is the key, and ident2 + { } is the value node
            this.pos = saved2; // back to ident2
            // But actually, in Enfusion:
            //   Configurations {
            //     GameProjectConfig PC { ... }
            //   }
            // "GameProjectConfig" is the type, "PC" is essentially an ID
            // So we restore to identTok and parse a child node
            this.pos = saved;
            const child = this.parseNode(depth + 1);
            node.children.push(child);
          } else if (afterIdent2 && afterIdent2.type === TokenType.String) {
            // Three tokens: Ident1 Ident2 "string" — could be node: Type SubId "guid" { }
            const saved3 = this.pos;
            const strTok = this.advance();
            const afterStr = this.peek();
            if (afterStr && afterStr.type === TokenType.OpenBrace) {
              // TypeName SubType "guid" { ... }
              this.pos = saved;
              const child = this.parseNode(depth + 1);
              node.children.push(child);
            } else {
              // Ident Ident "string" without brace — unusual
              // Treat first ident as key, rest as value
              this.pos = saved2;
              node.properties.push({ key: identTok.value, value: ident2.value });
            }
          } else {
            // Key BareValue — simple property with unquoted value.
            //
            // Inline multi-component vector handling: real Reforger files (and
            // this project's own scenario template) write transforms as bare,
            // space-separated triples, e.g. `coords 0 0 0` / `angles 0 90 0`.
            // The tokenizer discards newlines, so those components arrive as
            // separate identifier tokens. If `ident2` is numeric and one or
            // more numeric tokens follow, greedily join the whole run into one
            // space-separated value — matching how the quoted form
            // (`coords "0 0 0"`) already parses. Stops at the first
            // non-numeric token ({ } " : or a new property key), so node
            // detection and non-numeric bare values are untouched.
            let value = ident2.value;
            if (isNumericToken(ident2)) {
              while (isNumericToken(this.peek())) {
                value += ` ${this.advance().value}`;
              }
            }
            node.properties.push({ key: identTok.value, value });
          }
        } else if (after.type === TokenType.OpenBrace) {
          // TypeName { ... } — child node with no ID
          this.pos = saved;
          const child = this.parseNode(depth + 1);
          node.children.push(child);
        } else if (after.type === TokenType.Colon) {
          // TypeName : "parent" { ... } — child node with inheritance
          this.pos = saved;
          const child = this.parseNode(depth + 1);
          node.children.push(child);
        } else {
          // Bare identifier followed by something unexpected
          node.values.push(identTok.value);
        }
      } else if (next.type === TokenType.String) {
        // Standalone quoted string (e.g., dependency GUIDs)
        const strTok = this.advance();

        // Check if this string is followed by "{" — meaning it's a type name
        const after = this.peek();
        if (after && after.type === TokenType.OpenBrace) {
          // Quoted type name node (rare but possible)
          if (this.pos > 0) this.pos--;
          const child = this.parseNode(depth + 1);
          node.children.push(child);
        } else {
          node.values.push(strTok.value);
        }
      } else {
        // Skip unexpected tokens
        this.advance();
      }
    }

    return node;
  }
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

/** Escape backslashes and double quotes in string values for serialization. */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
}

function serializeNode(node: EnfusionNode, indent: number, eol: string): string {
  const pad = " ".repeat(indent);
  const innerPad = " ".repeat(indent + 1);
  const parts: string[] = [];

  // Type name. The parser accepts a quoted string as a type name (real
  // configs use e.g. `"Table data" { ... }` in AIBallisticTables); anything
  // that is not a plain bare identifier must be re-quoted or it re-parses as
  // type="Table", id="data".
  let header = /^[a-zA-Z0-9_.\-+]+$/.test(node.type)
    ? node.type
    : `"${escapeString(node.type)}"`;

  // Class qualifier (e.g., "SCR_ItemAttributeCollection" in "Attributes SCR_ItemAttributeCollection "{GUID}" {")
  if (node.className !== undefined) {
    header += ` ${node.className}`;
  }

  // Node ID — bare word (e.g., "PC") or quoted GUID
  if (node.id !== undefined) {
    if (/^[A-Za-z0-9_]+$/.test(node.id) && !/^[0-9A-Fa-f]{16}$/.test(node.id)) {
      header += ` ${node.id}`;
    } else {
      header += ` "${escapeString(node.id)}"`;
    }
  }

  // Inheritance
  if (node.inheritance !== undefined) {
    header += ` : "${escapeString(node.inheritance)}"`;
  }

  // If raw content is provided, re-indent it to match the target depth and emit
  if (node.rawContent !== undefined) {
    const lines = node.rawContent.split(/\r?\n/);
    // Find minimum indentation of non-empty lines
    let minIndent = Infinity;
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const leading = line.match(/^[ \t]*/)?.[0].length ?? 0;
      if (leading < minIndent) minIndent = leading;
    }
    if (minIndent === Infinity) minIndent = 0;

    // Re-indent each line to innerPad level
    const reindented = lines
      .map((line) => {
        if (line.trim().length === 0) return "";
        return innerPad + line.slice(minIndent);
      })
      .filter((line, idx, arr) => {
        // Remove leading/trailing blank lines
        if (idx === 0 && line === "") return false;
        if (idx === arr.length - 1 && line === "") return false;
        return true;
      })
      .join(eol);

    return `${pad}${header} {${eol}${reindented}${eol}${pad}}`;
  }

  parts.push(`${pad}${header} {`);

  // Properties.
  //
  // L2-5.1: the bare-emission regex used to be `/^[A-Za-z_][A-Za-z0-9_]*$/`,
  // which matched any identifier-like string — including mixed-case names like
  // `TestMod` (project IDs, class names, asset names). Real Enfusion files
  // QUOTE those (e.g. `ID "core"`, `GUID "5614BBCCBB55ED1C"`), so emitting
  // bare produced wire-incompatible output. The conservative rule now: only
  // numbers, booleans, and ALL-UPPERCASE identifiers (engine enums like `PC`,
  // `XBOX_ONE`, `HEADLESS`) skip the quotes. Everything else is quoted.
  // Workbench accepts quotes interchangeably for bare-eligible values, so
  // over-quoting is always safe; under-quoting (the old behavior) was not.
  for (const prop of node.properties) {
    if (typeof prop.value === "string") {
      const isNumber = NUMERIC_RE.test(prop.value);
      const isBool = prop.value === "true" || prop.value === "false";
      // ALL-UPPERCASE enums (PC, HEADLESS, XBOX_ONE, PLATFORM_WINDOWS) are
      // bare. EXCEPTION: 16-hex strings are GUIDs, always quoted, even though
      // they're all-uppercase-ish.
      const isUpperEnum =
        /^[A-Z][A-Z0-9_]*$/.test(prop.value) &&
        !/^[0-9A-F]{16}$/.test(prop.value);
      // Inline numeric vectors (`coords 0 0 0`, `angles 0 90 0`) are a
      // space-separated run of numeric scalars. Real Reforger `.layer`/`.ent`
      // files and this project's scenario template emit these BARE, and the
      // parser now captures them as one space-joined value — so emit them bare
      // to preserve wire fidelity and round-trip identically. A single leading
      // space or any non-numeric token forces the quoted path.
      const isNumericVector = NUMERIC_VECTOR_RE.test(prop.value);
      if (isNumber || isBool || isUpperEnum || isNumericVector) {
        parts.push(`${innerPad}${prop.key} ${prop.value}`);
      } else {
        parts.push(`${innerPad}${prop.key} "${escapeString(prop.value)}"`);
      }
    } else {
      // Value is a child node
      parts.push(serializeNode(prop.value, indent + 1, eol));
    }
  }

  // Standalone values (e.g., dependency GUIDs)
  for (const val of node.values) {
    parts.push(`${innerPad}"${escapeString(val)}"`);
  }

  // Child nodes
  for (const child of node.children) {
    parts.push(serializeNode(child, indent + 1, eol));
  }

  parts.push(`${pad}}`);
  return parts.join(eol);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse Enfusion text serialization format into a node tree.
 */
export function parse(input: string): EnfusionNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new Error("Empty input");
  }
  const parser = new Parser(tokens);
  const root = parser.parseDocument();
  // Remember CRLF sources so serialize() can write them back byte-identically.
  // (The tokenizer treats \r as whitespace and a leading BOM as an unknown
  // character, so neither affects the tree itself.)
  if (input.includes("\r\n")) root.eol = "\r\n";
  return root;
}

/**
 * Serialize an EnfusionNode tree back to Enfusion text format.
 */
export function serialize(node: EnfusionNode): string {
  return serializeNode(node, 0, node.eol === "\r\n" ? "\r\n" : "\n");
}

/**
 * Create a new empty EnfusionNode.
 */
export function createNode(
  type: string,
  opts?: {
    id?: string;
    inheritance?: string;
    properties?: EnfusionProperty[];
    values?: string[];
    children?: EnfusionNode[];
  },
): EnfusionNode {
  return {
    type,
    id: opts?.id,
    inheritance: opts?.inheritance,
    properties: opts?.properties ?? [],
    values: opts?.values ?? [],
    children: opts?.children ?? [],
  };
}

/**
 * Helper: set or update a property on a node.
 */
export function setProperty(node: EnfusionNode, key: string, value: string | EnfusionNode): void {
  const existing = node.properties.find((p) => p.key === key);
  if (existing) {
    existing.value = value;
  } else {
    node.properties.push({ key, value });
  }
}

/**
 * Helper: get a property value from a node.
 */
export function getProperty(node: EnfusionNode, key: string): string | EnfusionNode | undefined {
  const prop = node.properties.find((p) => p.key === key);
  return prop?.value;
}
