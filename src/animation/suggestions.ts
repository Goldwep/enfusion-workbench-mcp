import type { ParsedAgf, ParsedAgr, Suggestion } from "./types.js";

export function generateSuggestions(agf: ParsedAgf, agr?: ParsedAgr): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const sheet of agf.sheets) {
    for (const node of sheet.nodes) {
      // Performance: Blend without Optimization
      if (node.type === "AnimSrcNodeBlend") {
        const weight = node.properties.blendWeight as string | undefined;
        const opt = node.properties.optimization as boolean | undefined;
        if (weight && !opt) {
          suggestions.push({
            category: "Performance",
            title: `Blend "${node.name}" has no Optimization flag`,
            description:
              "When BlendWeight is variable-driven, enabling Optimization skips evaluating the child branch at 0% influence, saving CPU.",
            snippet: `// Add to ${node.name}:\nOptimization 1`,
          });
        }
      }

      // Smoothing: Instant transitions
      if (node.type === "AnimSrcNodeStateMachine") {
        const transitions = (node.properties.transitions ?? []) as Array<Record<string, unknown>>;
        for (const t of transitions) {
          if (t.duration === "0.0" || t.duration === "0.00") {
            suggestions.push({
              category: "Smoothing",
              title: `Transition "${t.from} -> ${t.to}" is instant (Duration 0.0)`,
              description:
                "Instant transitions cause visible pose snapping. Use Duration 0.2-0.3 with BlendFn S for smooth crossfade.",
              snippet: "Duration 0.3\nBlendFn S",
            });
          }
        }
      }

      // Flexibility: Hardcoded ProcTransform Amount
      if (node.type === "AnimSrcNodeProcTransform") {
        const boneItems = (node.properties.boneItems ?? []) as Array<Record<string, unknown>>;
        for (const bi of boneItems) {
          const amount = (bi.amount as string) ?? "";
          if (/\*\s*\d+\.?\d*\s*$/.test(amount) && !amount.match(/[A-Za-z_]\w*\s*$/)) {
            suggestions.push({
              category: "Flexibility",
              title: `ProcTransform "${node.name}" uses hardcoded value in Amount`,
              description:
                "Extract the numeric multiplier to an AGR float variable for runtime control.",
              snippet: `// AGR: Add variable\nAnimSrcGCTVarFloat SpeedMultiplier {\n DefaultValue ${amount.match(/(\d+\.?\d*)$/)?.[1] ?? "1.0"}\n}\n\n// AGF: Replace hardcoded value\nAmount "${amount.replace(/\d+\.?\d*\s*$/, "SpeedMultiplier")}"`,
            });
          }
        }
      }

      // Robustness: Queue items without InterruptExpr
      if (node.type === "AnimSrcNodeQueue") {
        const items = (node.properties.queueItems ?? []) as Array<Record<string, unknown>>;
        for (const item of items) {
          if (item.startExpr && !item.interruptExpr) {
            suggestions.push({
              category: "Robustness",
              title: `Queue item in "${node.name}" has no InterruptExpr`,
              description:
                "Without InterruptExpr, the queued action cannot be cancelled mid-play. Add an interrupt condition to prevent stuck animations.",
              snippet: 'InterruptExpr "IsCommand(CMD_Cancel)"',
            });
          }
        }
      }

      // Sync: Locomotion transitions without GetLowerTime
      if (node.type === "AnimSrcNodeStateMachine") {
        const transitions = (node.properties.transitions ?? []) as Array<Record<string, unknown>>;
        for (const t of transitions) {
          const dur = parseFloat((t.duration as string) ?? "0");
          if (dur > 0 && !t.startTime) {
            suggestions.push({
              category: "Sync",
              title: `Transition "${t.from} -> ${t.to}" could use time sync`,
              description:
                "Adding GetLowerTime() as StartTime syncs the destination animation's playback position with the source, preventing foot sliding in locomotion.",
              snippet: 'StartTime "GetLowerTime()"',
            });
          }
        }
      }

      // IK completeness: TwoBoneSolver without PoleSolver
      if (node.type === "AnimSrcNodeIK2") {
        const solver = node.properties.solver as string | undefined;
        if (solver && /TwoBone/i.test(solver)) {
          const hasPoleSolver = sheet.nodes.some(
            (n) =>
              n.type === "AnimSrcNodeIK2" &&
              n.name !== node.name &&
              /Pole/i.test((n.properties.solver as string) ?? ""),
          );
          if (!hasPoleSolver) {
            suggestions.push({
              category: "IK completeness",
              title: `IK2 "${node.name}" uses TwoBoneSolver without PoleSolver companion`,
              description:
                "Without a PoleSolver, the knee/elbow direction may flip unpredictably. Add a PoleSolver IK2 node with a pole target.",
              snippet: `AnimSrcNodeIK2 ${node.name}Pole {\n Child "..."\n Solver AnimSrcNodeIK2PoleSolver {\n }\n}`,
            });
          }
        }
      }
    }
  }

  // Architecture: turret/chassis split detection (requires AGR)
  if (agr) {
    const hasTurretMask = agr.boneMasks.some((m) =>
      /turret|hull|chassis|body|upper|lower/i.test(m.name),
    );
    const hasBufferNodes = agf.sheets.some((s) =>
      s.nodes.some((n) => n.type === "AnimSrcNodeBufferSave" || n.type === "AnimSrcNodeBufferUse"),
    );
    if (hasTurretMask && !hasBufferNodes) {
      suggestions.push({
        category: "Architecture",
        title: "Bone masks suggest upper/lower body split but no BufferSave/Use",
        description:
          "Use BufferSave to capture the chassis pose, then BufferUse to restore it before applying turret IK.",
        snippet:
          'AnimSrcNodeBufferSave SaveChassis {\n BufferName "chassis_pose"\n Child "LocomotionOutput"\n}\n\nAnimSrcNodeBufferUse RestoreChassis {\n BufferName "chassis_pose"\n}',
      });
    }
  }

  return suggestions;
}

export function formatSuggestions(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) {
    return "No suggestions -- the graph looks well-structured.";
  }

  const lines: string[] = [];
  lines.push(`=== ${suggestions.length} Suggestion(s) ===\n`);

  const byCategory = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }

  for (const [cat, items] of byCategory) {
    lines.push(`## ${cat}`);
    for (const s of items) {
      lines.push(`  ${s.title}`);
      lines.push(`    ${s.description}`);
      lines.push(`    Snippet:\n      ${s.snippet.replace(/\n/g, "\n      ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
