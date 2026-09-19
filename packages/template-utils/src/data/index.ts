// Cross-step data channel (upstream) + data-fetcher / host-connection registries.
export * from "./upstream";

// hostConnectionRegistry + connectionOptionsRegistry expose a CURATED surface
// (not `export *`) — the same names the root barrel published before the reorg.
export {
  registerHostConnection,
  getHostConnection,
  requireHostConnection,
  listRegisteredHostConnectionIds,
  listRegisteredHostConnections,
} from "./hostConnectionRegistry";
export {
  registerConnectionOptionsFetcher,
  getConnectionOptionsFetcher,
  requireConnectionOptionsFetcher,
  listRegisteredConnectionOptionsKinds,
  registerConnectionOptionImagesFetcher,
  getConnectionOptionImagesFetcher,
  listRegisteredConnectionOptionImagesKinds,
  type ConnectionOptionsFetcher,
  type ConnectionOptionsFetcherArgs,
  type ConnectionOptionsResult,
  type ConnectionOptionImagesFetcher,
  type ConnectionOptionImagesFetcherArgs,
} from "./connectionOptionsRegistry";
