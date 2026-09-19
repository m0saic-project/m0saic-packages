const { createDefaultPreset } = require("ts-jest");

// Self-contained config: handles .ts AND .tsx with the React automatic JSX
// runtime, node test environment (component tests use react-dom/server's
// renderToStaticMarkup — no jsdom needed). Kept local so the monorepo's
// shared jest config stays React-free.

/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    ...createDefaultPreset({
      tsconfig: {
        ...require("../../tsconfig.base.json").compilerOptions,
        target: "ES2020",
        module: "CommonJS",
        moduleResolution: "Node10",
        jsx: "react-jsx",
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        strict: true,
        esModuleInterop: true,
        types: ["jest", "node", "react"],
        ignoreDeprecations: "6.0",
      },
    }).transform,
  },
  testMatch: [
    "<rootDir>/src/**/*.test.ts",
    "<rootDir>/src/**/*.test.tsx",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
