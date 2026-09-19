// Written by scripts/sync-public-packages.mjs (monorepo) — this package used the
// monorepo's shared jest config; the mirror gets a self-contained one.
const { createDefaultPreset } = require("ts-jest");

/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    ...createDefaultPreset({
      tsconfig: require("fs").existsSync("tsconfig.json") /* npm runs tests from the package dir */
        ? "./tsconfig.json"
        : { module: "commonjs", target: "es2019", esModuleInterop: true, strict: true, skipLibCheck: true, resolveJsonModule: true, types: ["jest", "node"] },
    }).transform,
  },
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  moduleNameMapper: {
      "^@m0saic/types$": "<rootDir>/../types/src",
      "^@m0saic/types/dist/(?:cjs/|esm/|types/)?(.*)$": "<rootDir>/../types/src/$1",
      "^@m0saic/types/(.*)$": "<rootDir>/../types/src/$1",
      "^@m0saic/platform$": "<rootDir>/../platform/src",
      "^@m0saic/platform/dist/(?:cjs/|esm/|types/)?(.*)$": "<rootDir>/../platform/src/$1",
      "^@m0saic/platform/(.*)$": "<rootDir>/../platform/src/$1"
  },
};
