/* Benchmark runner (capability tier) — renders the frozen workload battery and
   writes a shareable benchmark.json session. */
export * from "./run/v1";

/* Benchmark report (core tier) — reads a benchmark.json session and renders the
   standard shareable results dashboard video. */
export * from "./report/v1";
