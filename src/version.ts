import { createRequire } from "node:module";

// package.json is the only version source. It sits one level above this file
// both in src/ (tsx, vitest) and in dist/ (tsc -p tsconfig.build.json), so the
// same relative path works in both. createRequire keeps the file out of tsc's
// rootDir (./src), so the build neither fails on it nor copies it into dist.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const VERSION: string = pkg.version;
