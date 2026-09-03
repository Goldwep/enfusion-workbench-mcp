import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * `character_anim_pipeline_guide` — explainer for the Enfusion
 * character-animation layer cake.
 *
 * Bohemia's character setup (skeleton ↔ AGR ↔ ASI ↔ AGF ↔ clips) is famously
 * confusing for newcomers. Ships as a PROMPT (not a tool) because the output
 * is a static explainer the agent should consume as guidance rather than a
 * data query. See docs/L8-PLAN.md §L8 Wave 3.
 */
export function registerCharacterAnimPipelineGuidePrompt(server: McpServer): void {
  server.registerPrompt(
    "character_anim_pipeline_guide",
    {
      title: "Character animation pipeline guide",
      description:
        "Explain Enfusion's character-animation pipeline (skeleton → AGR → ASI → AGF → clips), with build order and tool recommendations.",
      argsSchema: {
        target_character: z
          .string()
          .optional()
          .describe(
            "Character class this guide is being read for, e.g. 'soldier', 'civilian', 'pilot'. Default 'soldier'. Used only for examples — the pipeline is identical for any humanoid.",
          ),
        audience_level: z
          .enum(["beginner", "intermediate", "expert"])
          .optional()
          .describe(
            "Detail level: 'beginner' (what each layer does + build order), 'intermediate' (adds validation tools + common pitfalls), 'expert' (adds proc-anim layering, m_BoneRemap shape, RNG-based clip selection). Default 'beginner'.",
          ),
      },
    },
    ({ target_character, audience_level }) => {
      const char = target_character ?? "soldier";
      const level = audience_level ?? "beginner";

      const body = renderGuide(char, level);

      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: body },
          },
        ],
      };
    },
  );
}

function renderGuide(character: string, level: "beginner" | "intermediate" | "expert"): string {
  const sections: string[] = [];

  sections.push(`Walk me through Enfusion's character animation pipeline for a **${character}**. Target reading level: **${level}**.

I want to understand the layer cake — what each file does, what edits each one, and in what order I need to build them. Use the tools listed below; pull live patterns from \`wb_knowledge\` when you cite specifics.

## 1. The layer cake

Enfusion splits character animation into five layers. Each layer has a distinct purpose and a distinct editor. The ordering matters — a lower layer breaks every layer above it.

| Layer | File | What it holds | Workbench tool |
|---|---|---|---|
| **Skeleton** | \`.xob\` (rig + bind pose), \`.skin\` | Bone hierarchy + bind pose. The "ground truth" every other layer references by bone name. | Model editor (skinned mesh import) |
| **Clips** | \`.anm\` | Individual recorded motions — one walk cycle, one reload, one death. Bound to a specific skeleton. | Animation editor |
| **AGF** (Animation Graph File) | \`.agf\` | The state graph — nodes wire clips together, blend trees, transitions, parameters. The "logic" layer. | Animation Graph Editor |
| **ASI** (Animation State Index) | \`.asi\` | Lookup table mapping integer state IDs ↔ AGF node names. Script reads/writes state IDs through ASI. | Animation State Index editor |
| **AGR** (Animation Graph Runtime) | \`.agr\` | Runtime config: bone remap, global tags, IK chains, parameter defaults, ASI binding. The "wiring harness". | Animation Graph Runtime editor (text-format file) |

Read order at runtime: \`AGR\` is what the character component loads → it points at an \`AGF\` (graph) and an \`ASI\` (state lookup) → \`AGF\` references \`.anm\` clips → all of them resolve against the skeleton's bone names.

## 2. Build order — bottom up, no exceptions

Build in this order. Skipping ahead means you'll be re-doing earlier work when bone names don't line up.

1. **Skeleton reference** — finalize the rig (\`.xob\`) and the bind pose first. Every clip and every AGR bone-remap entry will hard-reference these bone names. Renaming a bone later means re-binding every clip.
2. **Clips** (\`.anm\`) — record / import the individual motions. Validate each clip against the skeleton before moving on.
3. **AGF** (the graph) — wire the clips into a state graph. Add transition conditions, blend trees, parameter inputs.
4. **ASI** (state mapping) — emit the state index that scripts will reference. ASI is regenerated from the AGF; do not hand-edit.
5. **AGR** (the runtime config) — bind the AGF + ASI, set bone remap, declare GlobalTags, configure IK and parameter defaults.

If you build out of order (e.g. start with AGR before clips exist), the editor will let you save broken refs that silently fail to load at runtime. The runtime errors are vague — "Animation state not found" with no clip name — so building bottom-up saves hours.

## 3. Tools available

For any character anim work, these MCP tools are the ones to reach for:

- **\`animation_graph\`** — unified vehicle-focused animation tool. Two relevant actions for *character* work:
  - \`action: "inspect"\` — read and summarize any \`.agr\` / \`.agf\` / \`.ast\` / \`.asi\` / \`.aw\` file. Pass \`sub_action: "validate"\` to run pitfall checks. (Despite the vehicle-leaning author/setup actions, inspect works on character files too.)
- **\`animation_find_unused_clips\`** — cross-references \`.anm\` files against AGF source nodes and ASI entries; surfaces clips that aren't reachable from any state. Use after a clip-heavy refactor.
- **\`weapon_pose_lint\`** — string-level lint of weapon poses against the AGR's \`GlobalTags\`. Catches the classic "weapon ignores stance" bug where a pose name doesn't match any tag. Character-relevant when authoring weapon-aware AGRs.
- **\`wb_knowledge\`** — search the pre-loaded BI knowledge base for animation patterns. Always run this *first* when you hit anything non-obvious. The character animation KB lives at \`data/kb/patterns/Character_And_Animation/animation/\` and includes:
  - **Animation Graph — Local Index** (\`query: "animation index"\`) — read first; picks AGF-node vs baked-clip approach
  - **Animation Core Concepts** (\`query: "animation core concepts"\`) — file types, AGR vs AGF, DOWN/UP evaluation, critical rules
  - **State Machine & Transition Guide** (\`query: "state machine transition"\`) — AGF StateMachine authoring, conditions
  - **Animation Node Reference** + **AGF Node Cheat Sheet** (\`query: "animation node reference"\` / \`"node cheatsheet"\`) — every AGF node type
  - **Animation Script Integration — Patterns & Pitfalls** (\`query: "AnimationControllerComponent script integration"\`) — SetVariable/CallCommand, lifecycle, replication
  - **Procedural Animation System — PAP / SIGA Reference** (\`query: "procedural pap siga"\`) — legacy procedural system; AGF/AGR preferred for new work
  - **Vehicle Animation Graph — Reference** (\`query: "vehicle animation"\`) — vehicle-specific (skip unless mixing humanoid + vehicle)

Recommended opening move on any character anim task:

\`\`\`json
{ "tool": "wb_knowledge", "args": { "query": "${character} animation", "max_files": 2 } }
\`\`\`

If the results don't cover what you need, fall back to \`query: "index"\` to see every topic.`);

  if (level !== "beginner") {
    sections.push(`
## 4. Common pitfalls (intermediate)

- **Bone-name drift.** If the skeleton's bone names change after clips are recorded, every clip silently mis-targets — characters T-pose at random states. Fix: re-bind clips, do not rename bones after step 2.
- **ASI desync.** ASI is generated from the AGF; if you save the AGF without regenerating ASI, script-side state IDs point at the wrong node. Symptom: a known animation plays the *previous* state's clip. Fix: always regenerate ASI after AGF edits.
- **GlobalTags case sensitivity.** \`GlobalTags\` in the AGR are case-sensitive. \`weapon_pose_lint\` catches a lot of these — run it whenever you add weapon stances.
- **Validate before commit.** Always run \`animation_graph action=inspect sub_action=validate\` against the AGR before you commit. The validator catches the top 5–10 recurring failure modes (missing bone remap, undeclared parameter, broken clip ref, etc.).
- **Unused clips bloat the addon.** \`animation_find_unused_clips\` after a refactor — orphan \`.anm\` files cost disk space and confuse future maintainers.`);
  }

  if (level === "expert") {
    sections.push(`
## 5. Expert layer — procedural, bone remap, RNG selection

### Procedural animation layering
The AGR composes recorded animation with procedural layers (IK, look-at, aim, recoil). Each procedural layer is declared in the AGR with a bone mask and a blend weight. Procedural layers run *after* the AGF emits its pose — they additively bend the resulting skeleton. The PAP/SIGA system (Procedural Aim Pose / Stance-Independent Gun Aim) is the canonical example. Pull \`procedural-pap-siga.md\` from the KB:

\`\`\`json
{ "tool": "wb_knowledge", "args": { "query": "procedural aim pose pap siga", "max_files": 2 } }
\`\`\`

### \`m_BoneRemap\` shape
The AGR's bone-remap block is an array of \`{ source, target }\` pairs that lets one AGF graph drive multiple skeletons (e.g. soldier + civilian sharing a walk cycle). Shape:

\`\`\`
m_BoneRemap {
  ${"{"} source "Spine_01" target "Bip01_Spine" ${"}"}
  ${"{"} source "Spine_02" target "Bip01_Spine1" ${"}"}
  ...
}
\`\`\`

Use \`animation_graph action=inspect\` against the AGR to dump the current remap. If the source bone doesn't exist on the AGF's reference skeleton, the engine silently skips that bone — failure mode is "one arm flops" rather than a hard error.

### RNG-based clip selection (variant clips)
Idle / hit / reload often have multiple recorded variants chosen randomly at playback. In the AGF, a \`RandomClip\` (or \`AnimationClip\` with a variant array) node holds N clips with weight per variant. Variants must all bind to the same skeleton and have the same duration (or use a \`MatchingTime\` flag) — mismatched durations cause hitching at the transition out. Look up the exact node-name in \`node-reference.md\`:

\`\`\`json
{ "tool": "wb_knowledge", "args": { "query": "random clip variant animation node", "max_files": 2 } }
\`\`\`

### Performance — bone count and update rate
The AGR's \`m_UpdateRate\` controls how often the graph re-evaluates. For background NPCs, dropping to 15Hz is invisible and saves measurable CPU. Bone count on the skeleton is the other knob — every IK chain costs a few % per character; turn off non-essential IK on AI-only characters via the AGR.`);
  }

  sections.push(`
## ${level === "expert" ? "6" : level === "intermediate" ? "5" : "4"}. Report back

When you've walked through this:
- Tell me which layer the current task touches.
- Tell me which tool you'd run first (\`wb_knowledge\` query, \`animation_graph\` inspect, \`animation_find_unused_clips\`, or \`weapon_pose_lint\`).
- Surface anything in the KB that looks newer than this guide — the knowledge base is the source of truth.`);

  return sections.join("\n");
}
