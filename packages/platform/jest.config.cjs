const { createDefaultPreset } = require("ts-jest");

/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    ...createDefaultPreset({ tsconfig: "./tsconfig.json" }).transform,
  },
  testMatch: [
    "<rootDir>/src/**/*.test.ts",
    "<rootDir>/src/**/*.spec.ts",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
