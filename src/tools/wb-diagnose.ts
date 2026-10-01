import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient, DiagnosticReport } from "../workbench/client.js";
import { describeLease } from "../workbench/lease.js";

/** Lines for the lease / no-autolaunch section of the report. */
function formatLeaseSection(r: DiagnosticReport): string[] {
  const lines: string[] = ["\n### Workbench Lease and Auto-launch"];
  if (!r.lease || !r.noAutolaunch) {
    lines.push("- **Lease:** config not loaded");
    return lines;
  }
  const c = r.lease.check;
  switch (c.state) {
    case "free":
      lines.push("- **Lease:** FREE — no session holds Workbench");
      break;
    case "held":
      lines.push(
        r.lease.ours
          ? `- **Lease:** HELD BY THIS SERVER — ${describeLease(c.lease)}`
          : `- **Lease:** HELD BY ANOTHER SESSION — ${describeLease(c.lease)}. Live calls and launches are refused until it is released.`,
      );
      break;
    case "stale":
      lines.push(
        `- **Lease:** STALE (heartbeat expired, Workbench pid gone; the next live call takes it over) — ${describeLease(c.lease)}`,
      );
      break;
    case "orphaned":
      lines.push(
        r.lease.ours
          ? `- **Lease:** HELD BY THIS SERVER (heartbeat expired; refreshed on the next live call) — ${describeLease(c.lease)}`
          : `- **Lease:** ORPHANED (heartbeat expired but its Workbench pid is still running; owner decision needed) — ${describeLease(c.lease)}`,
      );
      break;
    case "corrupt":
      lines.push(
        `- **Lease:** CORRUPT — ${c.reason}. Live calls are refused until the file is inspected.`,
      );
      break;
  }
  lines.push(`- **Lease file:** \`${r.lease.path}\` (this server: ${r.lease.session})`);
  lines.push(
    r.noAutolaunch.exists
      ? `- **No-autolaunch marker:** PRESENT — \`${r.noAutolaunch.path}\`. Workbench is never started implicitly; wb_launch with an explicit gprojPath still works.`
      : `- **No-autolaunch marker:** absent — \`${r.noAutolaunch.path}\``,
  );
  return lines;
}

export function registerWbDiagnose(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_diagnose",
    {
      description:
        "Run a full diagnostic of the EnfusionMCP ↔ Workbench connection. " +
        "Reports config, handler script locations, the Workbench lease holder, the no-autolaunch marker " +
        "and NET API status without auto-launching Workbench or taking the lease. " +
        "Use this when wb_launch fails or wb_connect returns errors.",
      inputSchema: {},
    },
    async () => {
      const r = await client.diagnose();

      const lines: string[] = ["## EnfusionMCP Diagnostic Report\n"];

      // --- Config ---
      lines.push("### Configuration");
      lines.push(`- **NET API:** ${r.host}:${r.port}`);
      if (r.workbenchExe) {
        const mark = r.workbenchExe.exists ? "FOUND" : "NOT FOUND";
        lines.push(`- **Workbench Exe:** ${mark} — \`${r.workbenchExe.path}\``);
      } else {
        lines.push("- **Workbench Exe:** config not loaded");
      }
      if (r.projectPath) {
        const mark = r.projectPath.exists ? "EXISTS" : "NOT FOUND";
        lines.push(`- **Project Path:** ${mark} — \`${r.projectPath.path}\``);
      } else {
        lines.push("- **Project Path:** not configured");
      }
      lines.push(`- **Default Mod:** ${r.defaultMod ?? "(not set)"}`);

      // --- Handler Scripts ---
      lines.push("\n### Handler Scripts");
      {
        const mark = r.bundledScripts.exists ? "FOUND" : "MISSING";
        lines.push(`- **Bundled source:** ${mark} — \`${r.bundledScripts.path}\``);
      }
      {
        const mark = r.standaloneAddon.exists
          ? `EXISTS (${r.standaloneAddon.fileCount} .c files) — should be absent when injecting into a mod`
          : "not present (correct)";
        lines.push(`- **Standalone addon:** ${mark} — \`${r.standaloneAddon.path}\``);
      }
      if (r.installedMods.length === 0) {
        lines.push("- **Installed in mods:** none found — handlers not injected into any mod");
      } else {
        for (const m of r.installedMods) {
          lines.push(`- **Installed:** ${m.fileCount} .c files → \`${m.handlerDir}\``);
        }
      }

      // --- NET API ---
      lines.push("\n### NET API Connection");
      switch (r.netApi) {
        case "up_with_handlers":
          lines.push(
            "- **Status:** CONNECTED — EMCP_WB_Ping responded. All wb_* tools are available.",
          );
          break;
        case "up_no_handlers":
          lines.push("- **Status:** PORT OPEN, HANDLERS NOT LOADED");
          lines.push("  - Workbench NET API is reachable but EMCP_WB_Ping is not registered.");
          lines.push("  - Handler scripts were not compiled. Check:");
          lines.push("    1. Are handlers installed in the mod listed above?");
          lines.push("    2. Does that mod have script errors preventing compilation?");
          lines.push("    3. Is Workbench open with that mod's .gproj loaded?");
          if (r.netApiError) lines.push(`  - Raw error: \`${r.netApiError}\``);
          break;
        case "refused":
          lines.push(
            "- **Status:** CONNECTION REFUSED — Workbench is not running or NET API is disabled.",
          );
          lines.push("  - Start Workbench and enable NET API: File > Options > General > Net API");
          if (r.netApiError) lines.push(`  - Raw error: \`${r.netApiError}\``);
          break;
        case "timeout":
          lines.push(
            "- **Status:** TIMEOUT — connection hung. Possible firewall or port conflict.",
          );
          if (r.netApiError) lines.push(`  - Raw error: \`${r.netApiError}\``);
          break;
        case "error":
          lines.push("- **Status:** ERROR");
          if (r.netApiError) lines.push(`  - Raw error: \`${r.netApiError}\``);
          break;
      }

      lines.push(...formatLeaseSection(r));

      // --- Recommendations ---
      const problems: string[] = [];
      if (!r.bundledScripts.exists) {
        problems.push(
          "Bundled handler scripts are missing from the package installation. Re-install enfusion-mcp.",
        );
      }
      if (r.standaloneAddon.exists && r.installedMods.length > 0) {
        problems.push(
          "A standalone addon AND mod-injected handlers coexist — this causes duplicate class errors. " +
            "Run wb_launch to clean up the standalone addon automatically, or delete it manually: " +
            `\`${r.standaloneAddon.path}\``,
        );
      }
      if (r.netApi === "up_no_handlers" && r.installedMods.length === 0) {
        problems.push(
          "NET API is up but no handler scripts are installed anywhere. " +
            "Call wb_launch with a gprojPath to inject handlers into the correct mod.",
        );
      }

      if (problems.length > 0) {
        lines.push("\n### Issues Detected");
        for (const p of problems) {
          lines.push(`- ${p}`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}
