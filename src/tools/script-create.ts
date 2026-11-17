import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Config } from "../config.js";
import type { SearchEngine } from "../index/search-engine.js";
import {
  generateScript,
  getScriptModuleFolder,
  getScriptFilename,
  type ScriptType,
} from "../templates/script.js";
import { validateFilename, validateEnforceIdentifier } from "../utils/safe-path.js";
import { assertInsideRoot } from "../utils/path-guard.js";

export function registerScriptCreate(
  server: McpServer,
  config: Config,
  searchEngine?: SearchEngine,
): void {
  server.registerTool(
    "script_create",
    {
      description:
        "Create a new Enforce Script (.c) file for an Arma Reforger mod from a template, with its class hierarchy and method stubs. With parentClass and no methods, the overridable methods come from the API index. A plugin goes to Scripts/WorkbenchGame.",
      inputSchema: {
        className: z.string().min(1).describe("Class name with its prefix, e.g. 'TAG_MyComponent'"),
        scriptType: z
          .enum([
            "modded",
            "component",
            "gamemode",
            "action",
            "entity",
            "manager",
            "basic",
            "plugin",
          ])
          .describe(
            "modded: override a class; component: ScriptComponent; gamemode: game mode; action: UserAction; entity: entity; manager: singleton; basic: plain class; plugin: Workbench plugin or tool.",
          ),
        parentClass: z
          .string()
          .optional()
          .describe(
            "Base class; required for modded, else a default per type. plugin: WorkbenchPlugin (default), WorldEditorPlugin, ResourceManagerPlugin, LocalizationEditorPlugin, WorldEditorTool.",
          ),
        methods: z
          .array(z.string())
          .optional()
          .describe(
            "Signatures to stub, e.g. ['void OnGameStart()']; per-type defaults if omitted.",
          ),
        description: z.string().optional().describe("Header comment of the file"),
        module: z
          .string()
          .optional()
          .describe(
            "plugin on WorkbenchPlugin: wbModules module (WorldEditor, ResourceManager, ScriptEditor, LocalizationEditor).",
          ),
        shortcut: z.string().optional().describe("plugin: shortcut, e.g. 'Ctrl+Shift+X'."),
        awesomeFontCode: z
          .union([z.number().int(), z.string()])
          .optional()
          .describe("plugin: Font Awesome icon code, e.g. '0xF0C5'."),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root; the configured project if omitted."),
      },
    },
    async ({
      className,
      scriptType,
      parentClass,
      methods,
      description,
      module,
      shortcut,
      awesomeFontCode,
      projectPath,
    }) => {
      const basePath = projectPath || config.projectPath;

      try {
        validateFilename(className);
        validateEnforceIdentifier(className);

        // Resolve parent methods from API index if available and no explicit methods given
        let dynamicMethods: string[] | undefined;
        if (!methods && searchEngine && parentClass && scriptType !== "plugin") {
          const cls = searchEngine.getClass(parentClass);
          if (cls) {
            const allMethods = [...(cls.methods || []), ...(cls.protectedMethods || [])];
            const overridable = allMethods.filter(
              (m) =>
                // A method the source declares only under a preprocessor guard
                // (`#ifdef ENABLE_DIAG`) may not exist in the build the script
                // compiles in, so an override of it may not compile.
                !(m.origin === "pak" && m.guards && m.guards.length > 0) &&
                (/^(On|EOn|Get|Set|Can|Handle|Do)/.test(m.name) || m.signature.includes("event")),
            );
            if (overridable.length > 0) {
              dynamicMethods = overridable.slice(0, 8).map((m) => m.signature);
            }
          }
        }

        const code = generateScript({
          className,
          scriptType: scriptType as ScriptType,
          parentClass,
          methods,
          dynamicMethods,
          description,
          module,
          shortcut,
          awesomeFontCode,
        });

        // If a project path is available, write the file
        if (basePath) {
          const moduleFolder = getScriptModuleFolder(scriptType as ScriptType);
          const filename = getScriptFilename(className);
          const targetDir = resolve(basePath, moduleFolder);
          const targetPath = join(targetDir, filename);

          // H7 containment: LLM-supplied projectPath must stay inside the
          // configured project root; check the final write path too.
          assertInsideRoot(resolve(basePath), config.projectPath, "projectPath");
          assertInsideRoot(targetPath, config.projectPath, "script path");

          mkdirSync(targetDir, { recursive: true });

          if (existsSync(targetPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `File already exists: ${moduleFolder}/${filename}\n\nGenerated code (not written):\n\n\`\`\`c\n${code}\`\`\``,
                },
              ],
            };
          }

          // A new file only: flag wx refuses one that appeared after the check (write-safety gap 20).
          writeFileSync(targetPath, code, { encoding: "utf-8", flag: "wx" });

          return {
            content: [
              {
                type: "text",
                text: `Script created: ${moduleFolder}/${filename}\n\n\`\`\`c\n${code}\`\`\``,
              },
            ],
          };
        }

        // No project path — just return the generated code
        return {
          content: [
            {
              type: "text",
              text: `Generated script (no project path configured — not written to disk):\n\n\`\`\`c\n${code}\`\`\`\n\nSet ENFUSION_PROJECT_PATH to write files automatically.`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Error creating script: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
