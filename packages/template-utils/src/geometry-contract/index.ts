export * from "./types";
export * from "./frameResolution";
export * from "./checkDocGeometry";
export * from "./assertGeometry";
export * from "./withGeometryContract";
export * from "./layoutConstraint";
export * from "./latticeRelations";
export * from "./withLayoutContract";
// P4 (2026-09-27): the contract wireframe builders were the one geometry-contract
// module the barrel left out — an external pack (prague-hiphop) could not draw
// the same violation wireframe the gate draws. Web-safe: its imports are the
// ones frameResolution / layoutConstraint already carry.
export * from "./violationWireframe";
