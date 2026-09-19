const { createDefaultPreset } = require("ts-jest");

/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    ...createDefaultPreset({ tsconfig: "./tsconfig.json" }).transform,
  },
  // Unit tests only. The wireframe goldens under visual-tests/ render through
  // the m0saic CLI (closed-source), so they run only inside the monorepo:
  // `npm run test:visual` there. A standalone checkout has no CLI to spawn.
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
