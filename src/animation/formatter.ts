import type {
  ParsedAgf,
  ParsedAgr,
  ParsedAst,
  ParsedAsi,
  ParsedAw,
  ParsedNode,
  ParsedSheet,
} from "./types.js";

function shortType(type: string): string {
  return type.replace(/^AnimSrcNode/, "");
}

function nodeTypeCounts(sheets: ParsedSheet[]): string {
  const counts = new Map<string, number>();
  for (const sheet of sheets) {
    for (const node of sheet.nodes) {
      const st = shortType(node.type);
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([t, c]) => `${c} ${t}`)
    .join(", ");
}

function renderNode(
  node: ParsedNode,
  nodeMap: Map<string, ParsedNode>,
  visited: Set<string>,
  indent: string,
  lines: string[],
): void {
  const st = shortType(node.type);

  if (visited.has(node.name)) {
    lines.push(`${indent}${st} "${node.name}" (see above)`);
    return;
  }
  visited.add(node.name);

  // Build node line with inline properties
  let line = `${indent}${st} "${node.name}"`;
  if (node.type === "AnimSrcNodeSource" && node.properties.source) {
    line += ` -> "${node.properties.source}"`;
  }
  if (node.type === "AnimSrcNodeBlend" && node.properties.blendWeight) {
    line += ` [weight: ${node.properties.blendWeight}]`;
  }
  lines.push(line);

  const childIndent = indent + "  ";

  // StateMachine details
  if (node.type === "AnimSrcNodeStateMachine") {
    const states = (node.properties.states ?? []) as Array<Record<string, unknown>>;
    const transitions = (node.properties.transitions ?? []) as Array<Record<string, unknown>>;

    for (const state of states) {
      lines.push(`${childIndent}State "${state.name}"`);
      if (state.startCondition) {
        lines.push(`${childIndent}  StartCondition: ${state.startCondition}`);
      }
      if (state.timeMode) {
        lines.push(`${childIndent}  Time: ${state.timeMode}`);
      }
      if (state.child) {
        const childNode = nodeMap.get(state.child as string);
        if (childNode) {
          renderNode(childNode, nodeMap, visited, childIndent + "  ", lines);
        }
      }
    }

    for (const t of transitions) {
      lines.push(`${childIndent}Transition: ${t.from} -> ${t.to}`);
      if (t.condition) lines.push(`${childIndent}  Condition: ${t.condition}`);
      if (t.duration) lines.push(`${childIndent}  Duration: ${t.duration}`);
      if (t.postEval) lines.push(`${childIndent}  PostEval: true`);
      if (t.blendFn) lines.push(`${childIndent}  BlendFn: ${t.blendFn}`);
    }
  }

  // Queue items
  if (node.type === "AnimSrcNodeQueue") {
    const items = (node.properties.queueItems ?? []) as Array<Record<string, unknown>>;
    for (const item of items) {
      lines.push(`${childIndent}QueueItem: ${item.child ?? "(none)"}`);
      if (item.startExpr) lines.push(`${childIndent}  StartExpr: ${item.startExpr}`);
      if (item.enqueueMethod) lines.push(`${childIndent}  EnqueueMethod: ${item.enqueueMethod}`);
    }
  }

  // ProcTransform bones
  if (node.type === "AnimSrcNodeProcTransform") {
    const boneItems = (node.properties.boneItems ?? []) as Array<Record<string, unknown>>;
    for (const bi of boneItems) {
      lines.push(
        `${childIndent}Bone: ${bi.bone} [${bi.op ?? "?"}${bi.axis ? ` ${bi.axis}` : ""}] = ${bi.amount ?? "?"}`,
      );
    }
  }

  // Render children (excluding those already rendered inline by StateMachine)
  const smChildNames = new Set<string>();
  if (node.type === "AnimSrcNodeStateMachine") {
    const states = (node.properties.states ?? []) as Array<Record<string, unknown>>;
    for (const s of states) {
      if (s.child) smChildNames.add(s.child as string);
    }
  }

  for (const childName of node.children) {
    if (smChildNames.has(childName)) continue;
    const childNode = nodeMap.get(childName);
    if (childNode) {
      renderNode(childNode, nodeMap, visited, childIndent, lines);
    } else {
      lines.push(`${childIndent}(unresolved: "${childName}")`);
    }
  }
}

export function formatAgfTree(agf: ParsedAgf): string {
  const totalNodes = agf.sheets.reduce((sum, s) => sum + s.nodes.length, 0);
  const lines: string[] = [];

  lines.push(`Sheets: ${agf.sheets.length} | Nodes: ${totalNodes}`);
  if (totalNodes > 0) {
    lines.push(`Types: ${nodeTypeCounts(agf.sheets)}`);
  }
  lines.push("");

  for (const sheet of agf.sheets) {
    lines.push(`Sheet "${sheet.name}":`);

    const nodeMap = new Map<string, ParsedNode>();
    for (const node of sheet.nodes) {
      nodeMap.set(node.name, node);
    }

    // Find root nodes (not referenced as children by any other node)
    const allChildRefs = new Set<string>();
    for (const node of sheet.nodes) {
      for (const child of node.children) {
        allChildRefs.add(child);
      }
    }
    const roots = sheet.nodes.filter((n) => !allChildRefs.has(n.name));

    const visited = new Set<string>();
    for (const root of roots) {
      renderNode(root, nodeMap, visited, "  ", lines);
    }

    // Render any nodes not yet visited (orphans or only reachable through cycles)
    for (const node of sheet.nodes) {
      if (!visited.has(node.name)) {
        renderNode(node, nodeMap, visited, "  ", lines);
      }
    }
  }

  return lines.join("\n");
}

export function formatAgrSummary(agr: ParsedAgr): string {
  const lines: string[] = [];

  lines.push("=== Animation Graph Resource ===");
  if (agr.defaultRunNode) lines.push(`DefaultRunNode: ${agr.defaultRunNode}`);
  if (agr.astReference) lines.push(`AnimSetTemplate: ${agr.astReference}`);
  if (agr.globalTags.length > 0) lines.push(`GlobalTags: ${agr.globalTags.join(", ")}`);

  if (agr.agfReferences.length > 0) {
    lines.push(`\nGraph Files (${agr.agfReferences.length}):`);
    for (const ref of agr.agfReferences) lines.push(`  ${ref}`);
  }

  if (agr.variables.length > 0) {
    lines.push(`\nVariables (${agr.variables.length}):`);
    for (const v of agr.variables) {
      let desc = `  ${v.type} ${v.name}`;
      if (v.min !== null || v.max !== null) desc += ` [${v.min ?? "?"} .. ${v.max ?? "?"}]`;
      if (v.defaultValue !== null) desc += ` = ${v.defaultValue}`;
      lines.push(desc);
    }
  }

  if (agr.commands.length > 0) {
    lines.push(`\nCommands (${agr.commands.length}):`);
    for (const c of agr.commands) lines.push(`  ${c.name}`);
  }

  if (agr.ikChains.length > 0) {
    lines.push(`\nIK Chains (${agr.ikChains.length}):`);
    for (const ik of agr.ikChains) {
      lines.push(`  ${ik.name}: ${ik.joints.join(" -> ")}`);
      if (ik.middleJoint) lines.push(`    MiddleJoint: ${ik.middleJoint}`);
      if (ik.chainAxis) lines.push(`    ChainAxis: ${ik.chainAxis}`);
    }
  }

  if (agr.boneMasks.length > 0) {
    lines.push(`\nBone Masks (${agr.boneMasks.length}):`);
    for (const bm of agr.boneMasks) {
      lines.push(`  ${bm.name}: ${bm.bones.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function formatAstSummary(ast: ParsedAst): string {
  const lines: string[] = [];
  lines.push("=== Animation Set Template ===");
  lines.push(`Groups: ${ast.groups.length}`);
  for (const g of ast.groups) {
    lines.push(`\n  ${g.name}:`);
    lines.push(`    Animations (${g.animationNames.length}): ${g.animationNames.join(", ")}`);
    lines.push(`    Columns (${g.columnNames.length}): ${g.columnNames.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatAsiSummary(asi: ParsedAsi): string {
  const lines: string[] = [];
  lines.push("=== Animation Set Instance ===");
  lines.push(`Mappings: ${asi.mappings.length}`);

  const groups = new Map<string, typeof asi.mappings>();
  for (const m of asi.mappings) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group)!.push(m);
  }

  for (const [group, mappings] of groups) {
    lines.push(`\n  ${group}:`);
    const mapped = mappings.filter((m) => m.anmPath !== null);
    const unmapped = mappings.filter((m) => m.anmPath === null);
    lines.push(`    Mapped: ${mapped.length}, Unmapped: ${unmapped.length}`);
    for (const m of mapped) {
      lines.push(`    ${m.column}.${m.animation} -> ${m.anmPath}`);
    }
    if (unmapped.length > 0) {
      lines.push(`    Missing: ${unmapped.map((m) => `${m.column}.${m.animation}`).join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function formatAwSummary(aw: ParsedAw): string {
  const lines: string[] = [];
  lines.push("=== Animation Workspace ===");
  if (aw.animGraph) lines.push(`AnimGraph: ${aw.animGraph}`);
  if (aw.animSetTemplate) lines.push(`AnimSetTemplate: ${aw.animSetTemplate}`);
  if (aw.animSetInstances.length > 0) {
    lines.push(`AnimSetInstances (${aw.animSetInstances.length}):`);
    for (const inst of aw.animSetInstances) lines.push(`  ${inst}`);
  }
  if (aw.previewModels.length > 0) {
    lines.push(`PreviewModels: ${aw.previewModels.join(", ")}`);
  }
  if (aw.childPreviewModels.length > 0) {
    lines.push("ChildPreviewModels:");
    for (const c of aw.childPreviewModels) {
      lines.push(`  ${c.model} @ ${c.bone} [${c.enabled ? "enabled" : "disabled"}]`);
    }
  }
  return lines.join("\n");
}

export function formatValidationReport(
  issues: Array<{ id: string; severity: string; message: string }>,
  errorCount: number,
  warningCount: number,
): string {
  const lines: string[] = [];
  if (errorCount === 0 && warningCount === 0) {
    lines.push("PASSED -- no issues found.");
    return lines.join("\n");
  }

  lines.push(`ISSUES: ${errorCount} error(s), ${warningCount} warning(s)`);
  lines.push("");

  for (const issue of issues) {
    const icon = issue.severity === "error" ? "[ERROR]" : "[WARN]";
    lines.push(`${icon} ${issue.id}: ${issue.message}`);
  }

  return lines.join("\n");
}
