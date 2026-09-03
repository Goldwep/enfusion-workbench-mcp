import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * `mission_setup` — interactive scaffold for a new Arma Reforger
 * mission / scenario.
 *
 * Walks the agent through: pick a template, create the .conf + world stub,
 * define the faction list, validate, and headless-compile-check. Ships as
 * a PROMPT (not a tool) because the workflow is multi-step authoring with
 * branching by template — the agent needs to chain tool calls under user
 * supervision, not return one chunk of analysis. See docs/L8-PLAN.md §L8
 * Wave 3.
 */
export function registerMissionSetupPrompt(server: McpServer): void {
  server.registerPrompt(
    "mission_setup",
    {
      title: "Set up a new mission / scenario",
      description:
        "Step-by-step scaffold for a new mission — pick template, create .conf + world stub, define factions, validate.",
      argsSchema: {
        mission_name: z
          .string()
          .describe(
            "Display name for the new mission, e.g. 'Operation Northstar'. Used as the scenario filename (spaces collapsed to underscores) and the in-browser title.",
          ),
        template: z
          .enum(["conflict", "game_master", "combat_ops"])
          .optional()
          .describe(
            "Scenario template: 'conflict' (MP, Seize-style PvP), 'game_master' (sandbox editor session), 'combat_ops' (co-op narrative via Scenario Framework). Default 'conflict'.",
          ),
        factions: z
          .array(z.string())
          .optional()
          .describe(
            "Faction keys to scaffold, e.g. ['US','FIA']. Default ['US','FIA']. Keys must match /^[A-Z][A-Z0-9_]{1,15}$/.",
          ),
      },
    },
    ({ mission_name, template, factions }) => {
      const tpl = template ?? "conflict";
      const fac = factions && factions.length > 0 ? factions : ["US", "FIA"];
      const factionList = fac.map((k) => `\`${k}\``).join(", ");
      // Derive a safe scenario identifier — no spaces, used as filename.
      const scenarioId = mission_name.trim().replace(/\s+/g, "_");

      const body = `I want to scaffold a new mission for an Arma Reforger mod.

- **Display name:** ${mission_name}
- **Scenario id (filename):** ${scenarioId}
- **Template:** ${tpl}
- **Factions:** ${factionList}

Walk me through this step-by-step. Do not skip ahead — pause after each step so I can review the output before you move on. Use ONLY the MCP tools listed below; do not hand me manual Workbench instructions.

## Step 1 — Confirm the template choice

Each template has different tooling and tradeoffs. Pick based on the goal:

- **\`conflict\`** — multiplayer Seize-style PvP. Uses **\`scenario_create_conflict\`** which writes the full file set (mission .conf + world .ent + Bases/Defenders/CAH/AmbientVehicles .layer files) from a base list. Best when you want a working MP scenario in one shot.
- **\`game_master\`** — sandbox editor session. Uses **\`config_create\`** with \`configType: "mission-header"\` and \`missionMode: "Conflict"\` (Game Master is a GM-controlled variant of the Conflict header); world stub is authored separately via **\`wb_knowledge\`** patterns. Best for ad-hoc multiplayer.
- **\`combat_ops\`** — co-op narrative via Scenario Framework. Uses **\`config_create\`** with \`configType: "mission-header"\` and \`missionMode: "SF"\`, then objectives are stamped via **\`scenario_create\`** with \`type: "objective"\` (live Workbench). Best for designed missions with task graphs.

Current selection: **${tpl}**. If that's wrong, stop and ask me to re-run with the right template.

## Step 2 — Create the mission header (.conf) + world

${tpl === "conflict" ? renderConflictStep(scenarioId, mission_name, fac) : tpl === "game_master" ? renderGameMasterStep(scenarioId, mission_name) : renderCombatOpsStep(scenarioId, mission_name)}

## Step 3 — Define the faction list

For each faction key, scaffold a \`Configs/Factions/<KEY>.conf\` via **\`faction_create\`**. One call per faction:

\`\`\`json
${fac
  .map(
    (key) =>
      `// faction_create call ${fac.indexOf(key) + 1} of ${fac.length}
{
  "tool": "faction_create",
  "args": {
    "faction_key": "${key}",
    "display_name": "${guessDisplayName(key)}",
    "color_rgb": ${JSON.stringify(guessColor(key))},
    "dry_run": true
  }
}`,
  )
  .join("\n\n")}
\`\`\`

Run each with \`dry_run: true\` first so I can review the rendered .conf. When I approve, flip to \`dry_run: false\`. \`faction_create\` refuses to overwrite existing files or write to a dirty git worktree — that's intentional, do not pass \`force: true\` without asking.

## Step 4 — Validate

Run validation in this order; stop on the first non-clean result:

1. **Per-faction shape check** — \`project_validate\` scope=\`faction\` against the project root catches the F1–F5 rules (required fields, key shape /^[A-Z][A-Z0-9_]{1,15}$/, color range, duplicate keys, orphan factions):

   \`\`\`json
   { "tool": "project_validate", "args": { "scope": "faction", "target": "<projectPath>" } }
   \`\`\`

2. **Scenario .conf shape check** — \`project_validate\` scope=\`scenario\` against the mission header confirms basic shape (mission mode, world ref, faction-manager presence):

   \`\`\`json
   { "tool": "project_validate", "args": { "scope": "scenario", "target": "<projectPath>/Missions/${scenarioId}.conf" } }
   \`\`\`

3. **Mod-level pre-flight** — \`project_validate\` scope=\`mod\` against the \`.gproj\` confirms the addon manifest is still publishable:

   \`\`\`json
   { "tool": "project_validate", "args": { "scope": "mod", "target": "<projectPath>/<addonName>.gproj" } }
   \`\`\`

## Step 5 — Headless script compile (recommended before first run)

Before you launch Workbench, run a headless compile check so script errors surface in seconds, not after the editor opens:

\`\`\`json
{
  "tool": "wb_validate_scripts",
  "args": {
    "gproj_path": "<projectPath>/<addonName>.gproj",
    "config": "PC",
    "timeout_seconds": 180
  }
}
\`\`\`

Then again with \`config: "HEADLESS"\` — that's the server-side compile and catches things PC config misses. Both must come back clean before you launch.

## Step 6 — Report back

When all five steps are done, summarize:

- Files written (with relative paths)
- Validation results (counts of errors / warnings)
- Anything I need to fix before launching Workbench

Do **not** tell me to "open Workbench" or "build with Ctrl+F7". The next step after this prompt is mine to drive.`;

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

// ── Per-template step bodies ─────────────────────────────────────────────────

function renderConflictStep(
  scenarioId: string,
  displayName: string,
  factions: string[],
): string {
  const primary = factions[0] ?? "US";
  const secondary = factions[1] ?? "USSR";
  return `Use **\`scenario_create_conflict\`** — it writes the complete file set in one call (mission .conf + world .ent + Bases/Defenders/CAH/AmbientVehicles .layer files).

You need to pick base positions. \`y\` can be \`0\` — Workbench snaps to terrain when the world is opened.

\`\`\`json
{
  "tool": "scenario_create_conflict",
  "args": {
    "scenarioName": "${scenarioId}",
    "scenarioDisplayName": "${displayName}",
    "worldName": "Everon",
    "playerCount": 40,
    "savingEnabled": true,
    "bases": [
      { "name": "MOB_${primary}", "position": "1200 0 3400", "faction": "${primary}", "type": "MOB" },
      { "name": "MOB_${secondary}", "position": "8800 0 6200", "faction": "${secondary}", "type": "MOB" },
      { "name": "Base_Central", "position": "5000 0 5000", "faction": "${primary}", "type": "base" }
    ]
  }
}
\`\`\`

Substitute real coordinates for the bases. \`worldName\` is \`Everon\`/\`Arland\`/\`Western Everon\` for vanilla maps, or a full \`{GUID}worlds/MyMap.ent\` for a custom map.`;
}

function renderGameMasterStep(scenarioId: string, displayName: string): string {
  return `Use **\`config_create\`** with \`configType: "mission-header"\` and \`missionMode: "Conflict"\` — Game Master is a GM-controlled variant of the Conflict header. Then add a \`SCR_GameModeEditor\` entity to the world layer (do that step in Workbench).

\`\`\`json
{
  "tool": "config_create",
  "args": {
    "configType": "mission-header",
    "name": "${scenarioId}",
    "scenarioName": "${displayName}",
    "missionMode": "Conflict",
    "worldPath": "{GUID}worlds/MP/MP_GM_Everon.ent",
    "gameModeLabel": "Game Master",
    "playerCount": 32
  }
}
\`\`\`

Then look up Game Master setup patterns:

\`\`\`json
{ "tool": "wb_knowledge", "args": { "query": "game master", "max_files": 2 } }
\`\`\``;
}

function renderCombatOpsStep(scenarioId: string, displayName: string): string {
  return `Use **\`config_create\`** with \`configType: "mission-header"\` and \`missionMode: "SF"\` — that's the Scenario Framework header for narrative SP/co-op missions. Then stamp objectives into the world layer via **\`scenario_create\`** (live Workbench).

\`\`\`json
{
  "tool": "config_create",
  "args": {
    "configType": "mission-header",
    "name": "${scenarioId}",
    "scenarioName": "${displayName}",
    "missionMode": "SF",
    "worldPath": "{GUID}worlds/SP/MyCombatOps_World.ent"
  }
}
\`\`\`

For each objective (kill / clearArea / destroy), once Workbench is running:

\`\`\`json
{
  "tool": "scenario_create",
  "args": {
    "type": "objective",
    "taskType": "kill",
    "taskName": "Eliminate_Patrol_1",
    "position": "3200 0 4100",
    "description": "Eliminate the enemy patrol guarding the radio site.",
    "targetPrefab": "{GUID}Prefabs/Characters/Factions/Enemy/CharacterPatrolMember.et",
    "aiGroupPrefab": "{GUID}Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et",
    "triggerRadius": 100,
    "faction": "US"
  }
}
\`\`\`

Look up Scenario Framework patterns before authoring objectives:

\`\`\`json
{ "tool": "wb_knowledge", "args": { "query": "scenario framework", "max_files": 2 } }
\`\`\``;
}

// ── Faction default helpers (instructional defaults, not authoritative) ──────

function guessDisplayName(key: string): string {
  const map: Record<string, string> = {
    US: "United States Army",
    USSR: "Soviet Armed Forces",
    FIA: "Forces of Independence and Autonomy",
  };
  return map[key] ?? key;
}

function guessColor(key: string): { r: number; g: number; b: number } {
  const map: Record<string, { r: number; g: number; b: number }> = {
    US: { r: 30, g: 70, b: 140 },
    USSR: { r: 160, g: 30, b: 30 },
    FIA: { r: 60, g: 130, b: 60 },
  };
  return map[key] ?? { r: 128, g: 128, b: 128 };
}
