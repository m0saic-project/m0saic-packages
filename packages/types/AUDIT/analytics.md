# `analytics/` — connectivity matrix

**Source:** `packages/types/src/analytics/` — `consent.ts`, `event.ts`, `redaction.ts`, `redactor.ts`, `sink.ts`
**Test:** `consent.test.ts`, `event.test.ts`, `sink.test.ts`
**Phase 3 owners:** Phase 5 app-side wiring (no Phase 3 sub-epic)

---

## Status: ⬜ not yet enumerated

## Types in this concept

- `MosaicAnalyticsConsent` — top-level consent struct
- `MosaicAnalyticsConsentMode` — `"undecided" | "opted-in" | "opted-out"`
- `MosaicAnalyticsChannelConsent` — per-channel toggles (rollup, errorReports, lifecycle)
- `MosaicAnalyticsScramblingMode` — `"off" | "deterministic" | "random"`
- `MosaicAnalyticsRedactionConfig` — per-field treatment (templateIds, filePaths, errorMessages, ffmpegArgs, stderrLines)
- `MosaicAnalyticsRedactor` — telemetry → analytics fn
- `MosaicAnalyticsScrambler` — interface for install-keyed scrambling
- `MosaicAnalyticsEvent` — discriminated union
- `MosaicAnalyticsRollupEvent` (daily aggregates)
- `MosaicAnalyticsImmediateEvent` — `install_completed`, `update_completed`, `error_report`
- `MosaicAnalyticsRollupSink`, `MosaicAnalyticsImmediateSink` — split sinks
- `routeAnalyticsEvent(sinks, event)` — dispatch helper
- `isAnalyticsEmissionEnabled(consent)` — emission gate

## Matrix

| Codename | TS path | Status | Visual | Sub-epic | Unit test | Visual test | Notes |
|---|---|---|---|---|---|---|---|
| `T:analytics.consent.mode=undecided` | mode | wired | non-visual | Phase 5 | `consent.test.ts` | n/a | Default; emits per channel toggles. |
| `T:analytics.consent.mode=opted-in` | mode | wired | non-visual | Phase 5 | `consent.test.ts` | n/a | — |
| `T:analytics.consent.mode=opted-out` | mode | wired | non-visual | Phase 5 | `consent.test.ts` | n/a | Hard stop. |
| `T:analytics.consent.channels.rollup` | toggle | wired | non-visual | Phase 5 | `consent.test.ts` | n/a | — |
| `T:analytics.consent.channels.errorReports` | toggle | wired | non-visual | Phase 5 | `consent.test.ts` | n/a | — |
| `T:analytics.consent.channels.lifecycle` | toggle | wired | non-visual | Phase 5 | `consent.test.ts` | n/a | — |
| `T:analytics.consent.scrambling=off` | mode | needs-wiring (impl) | non-visual | Phase 5 | `consent.test.ts` | n/a | Scrambler implementation needed. |
| `T:analytics.consent.scrambling=deterministic` | mode | needs-wiring (impl) | non-visual | Phase 5 | `consent.test.ts` | n/a | Default. HMAC-SHA256 w/ installId salt. |
| `T:analytics.consent.scrambling=random` | mode | needs-wiring (impl) | non-visual | Phase 5 | `consent.test.ts` | n/a | — |
| `T:analytics.redactions.templateIds=send` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | — |
| `T:analytics.redactions.templateIds=scramble` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | Default. |
| `T:analytics.redactions.templateIds=drop` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | — |
| `T:analytics.redactions.filePaths=scramble` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | — |
| `T:analytics.redactions.filePaths=drop` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | Default. |
| `T:analytics.redactions.errorMessages=send-sanitized` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | — |
| `T:analytics.redactions.errorMessages=drop` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | Default. |
| `T:analytics.redactions.ffmpegArgs=*` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | — |
| `T:analytics.redactions.stderrLines=*` | treatment | needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | — |
| `T:analytics.event.rollup` | rollup event | wired (types) | non-visual | Phase 5 | `event.test.ts` | n/a | — |
| `T:analytics.event.kind=install_completed` | immediate | wired (types) | non-visual | Phase 5 | `event.test.ts` | n/a | Direct-emit (bypass redactor). |
| `T:analytics.event.kind=update_completed` | immediate | wired (types) | non-visual | Phase 5 | `event.test.ts` | n/a | Direct-emit. |
| `T:analytics.event.kind=error_report` | immediate | wired (types) | non-visual | Phase 5 | `event.test.ts` | n/a | Per-event error channel. |
| `T:analytics.redactor` | `MosaicAnalyticsRedactor` | wired (interface) + needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | Single-boundary firewall. |
| `T:analytics.scrambler` | `MosaicAnalyticsScrambler` | wired (interface) + needs-wiring (impl) | non-visual | Phase 5 | TBD | n/a | Install-keyed hash. |
| `T:analytics.sink.rollup` | `MosaicAnalyticsRollupSink` | wired (NOOP) + needs-wiring (upload impl) | non-visual | Phase 5 | `sink.test.ts` | n/a | — |
| `T:analytics.sink.immediate` | `MosaicAnalyticsImmediateSink` | wired (NOOP) + needs-wiring (upload impl) | non-visual | Phase 5 | `sink.test.ts` | n/a | — |
| `T:analytics.routeAnalyticsEvent` | dispatcher | wired | non-visual | — | `sink.test.ts` | n/a | — |
| `T:analytics.isAnalyticsEmissionEnabled` | gate | wired | non-visual | — | `consent.test.ts` | n/a | — |
