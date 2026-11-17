import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SearchEngine } from "../index/search-engine.js";

export function registerClassResource(server: McpServer, searchEngine: SearchEngine): void {
  server.registerResource(
    "class-info",
    new ResourceTemplate("enfusion://class/{className}", {
      list: async () => {
        const names = searchEngine.getAllClassNames();
        // Return first 100 alphabetically to avoid overwhelming the list
        const sorted = [...names].sort();
        return {
          resources: sorted.slice(0, 100).map((name) => ({
            uri: `enfusion://class/${name}`,
            name,
          })),
        };
      },
    }),
    { title: "Enfusion Class Info", mimeType: "application/json" },
    async (uri, { className }) => {
      const name = Array.isArray(className) ? className[0] : className;
      const cls = searchEngine.getClass(name);

      if (!cls) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ error: `Class "${name}" not found` }),
            },
          ],
        };
      }

      const tree = searchEngine.getClassTree(name);
      const chain = searchEngine.getInheritanceChain(name);
      const inherited = searchEngine.getInheritedMembers(name);
      // A class the source backfill added says so, as its methods do: the
      // method arrays pass through whole, so a pak method's origin, pakFile,
      // pakLine and guards reach the reader as stored.
      const provenance =
        cls.origin === "pak"
          ? {
              origin: cls.origin,
              pakFile: cls.pakFile,
              pakLine: cls.pakLine,
              ...(cls.guards && cls.guards.length > 0 ? { guards: cls.guards } : {}),
            }
          : {};

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(
              {
                name: cls.name,
                source: cls.source,
                ...provenance,
                group: cls.group,
                brief: cls.brief,
                description: cls.description,
                parents: cls.parents,
                children: searchEngine.getChildren(cls.name),
                inheritanceChain: chain,
                ancestors: tree.ancestors,
                descendants: tree.descendants,
                enums: cls.enums || [],
                staticMethods: cls.staticMethods || [],
                methods: cls.methods,
                protectedMethods: cls.protectedMethods,
                properties: cls.properties || [],
                protectedProperties: cls.protectedProperties || [],
                inheritedMethods: inherited.methods,
                inheritedProperties: inherited.properties,
                inheritedEnums: inherited.enums,
                docsUrl: cls.docsUrl,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
