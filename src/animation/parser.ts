/**
 * Readers for the animation graph text files (.agr .agf .ast .asi .aw).
 *
 * Wave W4 (phase5-w4-spec.md 2.4, 4): the struct readers walk the lossless
 * concrete syntax tree of src/formats/enfusion-cst.ts instead of scanning the
 * text with regular expressions. The tree never throws, so a reader never
 * throws either: a construct it does not know is skipped, not misread.
 *
 * The regex helpers (`extractBlocks`, `extractProp`, `extractStringArray`) stay
 * exported for the callers that still scan raw text; the struct readers no
 * longer use them.
 */
import {
  parseCst,
  tokenValue,
  type CstDocument,
  type CstObject,
  type CstRoot,
} from "../formats/enfusion-cst.js";
import type {
  ParsedAgr,
  ParsedVariable,
  ParsedCommand,
  ParsedIkChain,
  ParsedBoneMask,
  ParsedAgf,
  ParsedSheet,
  ParsedNode,
  ParsedQueueItem,
  ParsedState,
  ParsedTransition,
  ParsedBoneItem,
  ParsedIkBinding,
  ParsedSwitchItem,
  ParsedAst,
  ParsedAsi,
  ParsedAsiMapping,
  ParsedAnimGroup,
  ParsedAw,
} from "./types.js";

// ── Legacy regex helpers (kept for raw-text callers) ─────────────────────────

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractBlocks(
  text: string,
  typeName: string,
): Array<{ name: string; body: string }> {
  const results: Array<{ name: string; body: string }> = [];
  const openRe = new RegExp(
    `^[ \\t]*${escapeRegExp(typeName)}[ \\t]+(?:"([^"\\n]*)"|([^"\\s{][^{]*?))[ \\t]*\\{[ \\t]*\\r?$`,
    "gm",
  );
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(text)) !== null) {
    const name = (match[1] ?? match[2]).trim();
    const openBrace = text.indexOf("{", match.index + match[0].lastIndexOf("{"));
    let depth = 1;
    let i = openBrace + 1;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    const body = text.slice(openBrace + 1, i - 1);
    results.push({ name, body });
  }
  return results;
}

export function extractProp(body: string, propName: string): string | null {
  const re = new RegExp(`^[ \\t]*${escapeRegExp(propName)}[ \\t]+"?([^"\\n\\r]+?)"?[ \\t]*$`, "m");
  const m = body.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, "");
}

export function extractStringArray(body: string, propName: string): string[] {
  const startRe = new RegExp(`^[ \\t]*${escapeRegExp(propName)}[ \\t]*\\{`, "m");
  const startMatch = body.match(startRe);
  if (!startMatch || startMatch.index === undefined) return [];
  const openPos = body.indexOf("{", startMatch.index + startMatch[0].lastIndexOf("{") - 1);
  let depth = 1;
  let i = openPos + 1;
  while (i < body.length && depth > 0) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
    i++;
  }
  const inner = body.slice(openPos + 1, i - 1);
  const items: string[] = [];
  const itemRe = /"([^"\n\r]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(inner)) !== null) {
    items.push(m[1]);
  }
  return items;
}

// ── CST helpers (shared with graph-edit.ts) ──────────────────────────────────

export type Block = CstRoot | CstObject;

/** The first header word of an object: its class for a node (`AnimSrcNodeQueue Name {`). */
export function classOf(o: CstObject): string {
  return o.key;
}

/** The instance name of an object (`Type Name {` or `Type "Name" {`); "" when it has none. */
export function nameOf(o: CstObject): string {
  const t = o.head[1];
  return t ? tokenValue(t) : "";
}

/** Child objects of a block, optionally only those whose first header word is `key`. */
export function objectsOf(b: Block, key?: string): CstObject[] {
  const out: CstObject[] = [];
  for (const c of b.children) {
    if (c.kind === "object" && (key === undefined || c.key === key)) out.push(c);
  }
  return out;
}

/** The first child object whose first header word is `key`. */
export function objectOf(b: Block, key: string): CstObject | undefined {
  return b.children.find((c): c is CstObject => c.kind === "object" && c.key === key);
}

/** Every object below `b` (any depth) whose first header word is `key`, in text order. */
export function descendants(b: Block, key: string | ((o: CstObject) => boolean)): CstObject[] {
  const out: CstObject[] = [];
  const test = typeof key === "string" ? (o: CstObject) => o.key === key : key;
  const walk = (x: Block) => {
    for (const c of x.children) {
      if (c.kind !== "object") continue;
      if (test(c)) out.push(c);
      walk(c);
    }
  };
  walk(b);
  return out;
}

/** The value of the first scalar `key` of a block: its values joined by one blank, quotes off. */
export function scalarOf(b: Block, key: string): string | null {
  for (const c of b.children) {
    if (c.kind === "scalar" && c.key === key) return c.values.map(tokenValue).join(" ");
  }
  return null;
}

/** The items of a list block (`Key { "a" "b" }` or one item per line): every value token. */
export function listValues(o: CstObject | undefined): string[] {
  if (!o) return [];
  const out: string[] = [];
  for (const c of o.children) {
    if (c.kind === "value") for (const t of c.values) out.push(tokenValue(t));
    else if (c.kind === "scalar" && c.values.length === 0) out.push(c.key); // a lone bare word
  }
  return out;
}

/** The list under key `key` of a block; [] when the block has none. */
export function listOf(b: Block, key: string): string[] {
  return listValues(objectOf(b, key));
}

/** Keys that connect a node to a child node by name. */
export const CONNECTION_KEY = /^Child\d*$/;

/**
 * The node names a node connects to: every `Child`/`ChildN` scalar at any
 * depth (the node's own, queue items, states, switch items) and every item
 * of a `Children` list (BlendN). Empty names are left out.
 */
export function connectionsOf(node: CstObject): string[] {
  const out: string[] = [];
  const walk = (b: CstObject) => {
    for (const c of b.children) {
      if (c.kind === "scalar" && CONNECTION_KEY.test(c.key)) {
        const v = c.values.map(tokenValue).join(" ");
        if (v !== "") out.push(v);
      } else if (c.kind === "object") {
        if (c.key === "Children") {
          for (const v of listValues(c)) if (v !== "") out.push(v);
        } else {
          walk(c);
        }
      }
    }
  };
  walk(node);
  return out;
}

/** The graph-file root of an .agf document (`AnimSrcGraphFile { ... }`), or the base block. */
function rootOf(doc: CstDocument): Block {
  return doc.base;
}

/** The sheets of an .agf document: every `AnimSrcGraphSheet` under its `Sheets` block (or anywhere). */
export function sheetsOf(doc: CstDocument): CstObject[] {
  const root = rootOf(doc);
  const sheets = objectOf(root, "Sheets");
  if (sheets) return objectsOf(sheets, "AnimSrcGraphSheet");
  return descendants(root, "AnimSrcGraphSheet");
}

/** The node objects of a sheet: the objects of its `Nodes` block, else its own AnimSrcNode* objects. */
export function nodesOf(sheet: CstObject): CstObject[] {
  const nodes = objectOf(sheet, "Nodes");
  if (nodes) return objectsOf(nodes);
  return objectsOf(sheet).filter((o) => o.key.startsWith("AnimSrcNode"));
}

// ── AGR ──────────────────────────────────────────────────────────────────────

const VAR_TYPES: Record<string, ParsedVariable["type"]> = {
  AnimSrcGCTVarFloat: "Float",
  AnimSrcGCTVarInt: "Int",
  AnimSrcGCTVarBool: "Bool",
  AnimSrcGCTVarString: "String",
};

export function parseAgrDoc(doc: CstDocument): ParsedAgr {
  const root = rootOf(doc);
  const variables: ParsedVariable[] = descendants(root, (o) => o.key in VAR_TYPES).map((o) => ({
    name: nameOf(o),
    type: VAR_TYPES[o.key],
    min: scalarOf(o, "MinValue") ?? scalarOf(o, "Min"),
    max: scalarOf(o, "MaxValue") ?? scalarOf(o, "Max"),
    defaultValue: scalarOf(o, "DefaultValue") ?? scalarOf(o, "Default"),
  }));
  const commands: ParsedCommand[] = descendants(root, "AnimSrcGCTCmd").map((o) => ({
    name: nameOf(o),
  }));
  const ikChains: ParsedIkChain[] = descendants(root, "AnimSrcGCTIkChain").map((o) => ({
    name: nameOf(o),
    joints: listOf(o, "Joints"),
    middleJoint: scalarOf(o, "MiddleJoint"),
    chainAxis: scalarOf(o, "ChainAxis"),
  }));
  const boneMasks: ParsedBoneMask[] = descendants(root, "AnimSrcGCTBoneMask").map((o) => ({
    name: nameOf(o),
    bones: objectOf(o, "Bones") ? listOf(o, "Bones") : listOf(o, "BoneNames"),
  }));
  const tagsBlock = descendants(root, "GlobalTags")[0];
  const filesBlock = descendants(root, "GraphFilesResourceNames")[0];
  return {
    variables,
    commands,
    ikChains,
    boneMasks,
    globalTags: listValues(tagsBlock),
    hasGlobalTags: tagsBlock !== undefined,
    defaultRunNode: root.kind === "object" ? scalarOf(root, "DefaultRunNode") : null,
    agfReferences: listValues(filesBlock),
    astReference: root.kind === "object" ? scalarOf(root, "AnimSetTemplate") : null,
  };
}

export function parseAgrToStruct(content: string): ParsedAgr {
  return parseAgrDoc(parseCst(content));
}

// ── AGF ──────────────────────────────────────────────────────────────────────

function editorPos(node: CstObject): { x: number; y: number } | undefined {
  const v = scalarOf(node, "EditorPos");
  if (v === null) return undefined;
  const [x, y] = v.split(" ").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function flag(b: CstObject, key: string): boolean {
  return scalarOf(b, key) === "1";
}

function queueItems(node: CstObject): ParsedQueueItem[] {
  return descendants(node, "AnimSrcNodeQueueItem").map((o) => ({
    child: scalarOf(o, "Child"),
    startExpr: scalarOf(o, "StartExpr"),
    interruptExpr: scalarOf(o, "InterruptExpr"),
    blendInTime: scalarOf(o, "BlendInTime"),
    blendOutTime: scalarOf(o, "BlendOutTime"),
    enqueueMethod: scalarOf(o, "EnqueueMethod"),
    tagMainPath: scalarOf(o, "TagMainPath"),
  }));
}

function states(node: CstObject): ParsedState[] {
  return descendants(node, "AnimSrcNodeState").map((o) => ({
    name: nameOf(o),
    startCondition: scalarOf(o, "StartCondition"),
    timeMode: scalarOf(o, "TimeStorage") ?? scalarOf(o, "Time"),
    exit: (scalarOf(o, "IsExit") ?? scalarOf(o, "Exit")) === "1",
    child: scalarOf(o, "Child"),
  }));
}

function transitions(node: CstObject): ParsedTransition[] {
  return descendants(node, "AnimSrcNodeTransition").map((o) => ({
    from: scalarOf(o, "FromState") ?? scalarOf(o, "From") ?? "",
    to: scalarOf(o, "ToState") ?? scalarOf(o, "To") ?? "",
    condition: scalarOf(o, "Condition"),
    duration: scalarOf(o, "Duration"),
    postEval: flag(o, "PostEval"),
    blendFn: scalarOf(o, "BlendFn"),
    startTime: scalarOf(o, "StartTime"),
  }));
}

function boneItems(node: CstObject): ParsedBoneItem[] {
  return descendants(node, "AnimSrcNodeProcTrBoneItem").map((o) => ({
    bone: scalarOf(o, "Bone"),
    op: scalarOf(o, "Op"),
    axis: scalarOf(o, "Axis"),
    amount: scalarOf(o, "Amount"),
  }));
}

function ikBindings(node: CstObject): ParsedIkBinding[] {
  return descendants(
    node,
    (o) => o.key === "AnimSrcIkBinding" || o.key === "AnimSrcIkTargetBinding",
  ).map((o) => ({ ikTarget: scalarOf(o, "IkTarget"), ikChain: scalarOf(o, "IkChain") }));
}

function switchItems(node: CstObject): ParsedSwitchItem[] {
  return descendants(node, "AnimSrcNodeSwitchItem").map((o) => ({
    child: scalarOf(o, "Child"),
    nextProbabilities: scalarOf(o, "NextProbabilities"),
  }));
}

/** BlendN thresholds: a `Thresholds { 0 1 2 }` list or a legacy `Thresholds "0 1 2"` scalar. */
export function thresholdsOf(node: CstObject): number[] {
  const list = objectOf(node, "Thresholds");
  const raw = list ? listValues(list) : (scalarOf(node, "Thresholds")?.split(/\s+/) ?? []);
  return raw.filter((s) => s !== "").map(Number);
}

function nodeProperties(node: CstObject): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  switch (node.key) {
    case "AnimSrcNodeQueue":
      p.queueItems = queueItems(node);
      break;
    case "AnimSrcNodeStateMachine":
      p.states = states(node);
      p.transitions = transitions(node);
      break;
    case "AnimSrcNodeSource":
    case "AnimSrcNodePose":
      p.source = scalarOf(node, "Source");
      break;
    case "AnimSrcNodeProcTransform":
      p.expression = scalarOf(node, "Expression");
      p.boneItems = boneItems(node);
      break;
    case "AnimSrcNodeBlend":
      p.blendWeight = scalarOf(node, "BlendWeight");
      p.optimization = flag(node, "Optimization");
      break;
    case "AnimSrcNodeBlendN":
      p.blendWeight = scalarOf(node, "BlendWeight");
      p.isCyclic = flag(node, "IsCyclic");
      p.thresholds = thresholdsOf(node);
      break;
    case "AnimSrcNodeBlendT":
    case "AnimSrcNodeBlendTAdd":
    case "AnimSrcNodeBlendTW":
      p.triggerOn = scalarOf(node, "TriggerOn");
      p.triggerOff = scalarOf(node, "TriggerOff");
      p.blendTime = scalarOf(node, "BlendTime");
      p.postEval = flag(node, "PostEval");
      break;
    case "AnimSrcNodeSwitch":
      p.firstProbabilities = scalarOf(node, "FirstProbabilities");
      p.switchItems = switchItems(node);
      break;
    case "AnimSrcNodeFilter":
      p.boneMask = scalarOf(node, "BoneMask");
      p.condition = scalarOf(node, "Condition");
      break;
    case "AnimSrcNodeBufferSave":
    case "AnimSrcNodeBufferUse":
      p.buffer = scalarOf(node, "Buffer");
      break;
    case "AnimSrcNodeFuncBegin":
    case "AnimSrcNodeFuncEnd":
    case "AnimSrcNodeFuncCall":
    case "AnimSrcNodeFunctionBegin":
    case "AnimSrcNodeFunctionEnd":
    case "AnimSrcNodeFunctionCall":
      p.method = scalarOf(node, "Method");
      break;
    case "AnimSrcNodeGroupSelect":
      p.group = scalarOf(node, "Group");
      p.column = scalarOf(node, "Column");
      break;
    default:
      break;
  }
  if (node.key.startsWith("AnimSrcNodeIK") || objectOf(node, "Chains")) {
    p.weight = scalarOf(node, "Weight");
    p.solver = scalarOf(node, "Solver");
    const chains = ikBindings(node);
    if (chains.length > 0) p.chains = chains;
  }
  return p;
}

export function parseNode(doc: CstDocument, node: CstObject): ParsedNode {
  const body = node.close ? doc.text.slice(node.open.end, node.close.start) : "";
  return {
    type: node.key,
    name: nameOf(node),
    editorPos: editorPos(node),
    children: connectionsOf(node),
    properties: nodeProperties(node),
    raw: body,
  };
}

export function parseAgfDoc(doc: CstDocument): ParsedAgf {
  const sheets: ParsedSheet[] = sheetsOf(doc).map((s) => ({
    name: nameOf(s),
    nodes: nodesOf(s).map((n) => parseNode(doc, n)),
  }));
  return { sheets };
}

export function parseAgfToStruct(content: string): ParsedAgf {
  return parseAgfDoc(parseCst(content));
}

// ── AST ──────────────────────────────────────────────────────────────────────

export function parseAstToStruct(content: string): ParsedAst {
  const root = rootOf(parseCst(content));
  const groups: ParsedAnimGroup[] = descendants(root, "AnimSetTemplateSource_AnimationGroup").map(
    (o) => ({
      // The block's own name is a GUID; the group's name is its Name property.
      name: scalarOf(o, "Name") ?? nameOf(o),
      animationNames: listOf(o, "Animations"),
      columnNames: listOf(o, "Columns"),
    }),
  );
  return { groups };
}

// ── ASI ──────────────────────────────────────────────────────────────────────

export function parseAsiToStruct(content: string): ParsedAsi {
  // Lines { AnimSetInstanceSource_Line "Group.Column.Animation" { Resource "{GUID}path.anm" } }
  const root = rootOf(parseCst(content));
  const mappings: ParsedAsiMapping[] = [];
  for (const o of descendants(root, "AnimSetInstanceSource_Line")) {
    const name = nameOf(o);
    const first = name.indexOf(".");
    const second = first < 0 ? -1 : name.indexOf(".", first + 1);
    if (second < 0) continue;
    const resource = scalarOf(o, "Resource");
    const anmPath = resource ? resource.replace(/^\{[^}]*\}/, "") || null : null;
    mappings.push({
      group: name.slice(0, first),
      column: name.slice(first + 1, second),
      animation: name.slice(second + 1),
      anmPath,
    });
  }
  return { mappings };
}

// ── AW ───────────────────────────────────────────────────────────────────────

export function parseAwToStruct(content: string): ParsedAw {
  const root = rootOf(parseCst(content));
  const top = (key: string) => (root.kind === "object" ? scalarOf(root, key) : null);
  const previewModels: string[] = [];
  for (const o of descendants(root, "AnimSrcWorkspacePreviewModel")) {
    const model = scalarOf(o, "Model");
    if (model) previewModels.push(model);
  }
  const childPreviewModels = descendants(root, "AnimSrcWorkspaceChildPreviewModel").map((o) => ({
    model: scalarOf(o, "Model") ?? "(unknown)",
    bone: scalarOf(o, "Bone") ?? "(no bone)",
    enabled: scalarOf(o, "Enabled") !== "0",
  }));
  return {
    animGraph: top("AnimGraph"),
    animSetTemplate: top("AnimSetTemplate"),
    animSetInstances: root.kind === "object" ? listOf(root, "AnimSetInstances") : [],
    previewModels,
    childPreviewModels,
  };
}
