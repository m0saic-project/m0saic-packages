// @m0saic/platform/share — template invocations over the wire.
//
// A `.mosaicx` invocation (template id + props + canvas) can travel as a set
// of URL query params. This module IS the format: the props payload codec
// (payloadCodec.ts), the query grammar (shareQuery.ts), the portability rules
// for props (portableProps.ts), and the bridge to and from a `.mosaicx`
// document (mosaicxLink.ts). Hosts add only their own origin, route and
// length cap in front — the web app mints `https://app.m0saic.io/make?…`.
//
// Pure: no node imports, no DOM beyond the WHATWG streams + URL globals
// every supported host has (browsers, Electron, Node 20.12+).
//
// Compatibility: the `p` prefix (`z`) is the payload version. Once published,
// the param names are a contract — add params, never repurpose one.

export * from "./payloadCodec";
export * from "./shareQuery";
export * from "./portableProps";
export * from "./mosaicxLink";
