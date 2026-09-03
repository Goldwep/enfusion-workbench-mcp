// ESLint flat config — see https://eslint.org/docs/latest/use/configure/configuration-files-new
// Deliberate divergence from upstream: this fork adds lint + format tooling.
// Reason: catch console.log usage (forbidden under stdio MCP — corrupts JSON-RPC),
// catch unused imports, and enforce consistent double-quote / semi style.

import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Stdio MCP servers MUST NOT write to stdout outside the JSON-RPC channel.
      // console.error is fine (stderr); console.log/info/warn are not.
      "no-console": ["error", { allow: ["error"] }],
      quotes: ["error", "double", { avoidEscape: true }],
      semi: ["error", "always"],
    },
  },
  {
    // CLI scripts (build/scrape) legitimately use console output — relax there.
    files: ["scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // ── L9-2: type-enforced redaction lockdown ────────────────────────────────
  //
  // Ban raw `ServerConfig` imports outside the L3-2 trust boundary. The
  // raw shape carries plaintext passwords/RCON pwd/persistence API keys;
  // anything outside `src/tools/server-redact.ts` (the definer),
  // `src/server-mgmt/redact-io.ts` (the read+redact gate),
  // `src/templates/server-config.ts` (the writer that constructs raw
  // configs for disk emission), and `src/tools/server-validate-config.ts`
  // (the validator that consumes raw JSON for diagnostics) should consume
  // `RedactedServerConfig` instead.
  //
  // The pattern matches any module specifier ending in `server-redact`
  // (the file may be referenced via several relative paths). `importNames`
  // narrows the ban to the raw `ServerConfig` symbol only — siblings like
  // `redactServerConfig`, `stringifyRedacted`, `RedactedServerConfig`,
  // `ModEntry`, etc. remain freely importable.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/tools/server-redact.ts",
      "src/server-mgmt/redact-io.ts",
      "src/templates/server-config.ts",
      "src/tools/server-validate-config.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server-redact", "**/server-redact.js"],
              importNames: ["ServerConfig"],
              message:
                "Import RedactedServerConfig instead. The raw ServerConfig type carries plaintext passwords and is restricted to src/tools/server-redact.ts, src/server-mgmt/redact-io.ts, src/templates/server-config.ts, and src/tools/server-validate-config.ts (L9-2 redaction lockdown).",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "data/", "mod/", "docs/", "*.config.js"],
  },
);
