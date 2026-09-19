/**
 * Tier validation tests for the identifier hygiene patterns.
 */
import {
  asAliasId,
  asAssetId,
  asDiagnosticCode,
  asDictionaryEntryId,
  asFlattenedStableKey,
  asInstallId,
  asOutputKey,
  asRepoId,
  asSpanId,
  asTemplateId,
  asTraceId,
  DIAGNOSTIC_CODE_PATTERN,
  FLATTENED_STABLE_KEY_PATTERN,
  FRIENDLY_SLUG_PATTERN,
  isAliasId,
  isAssetId,
  isDiagnosticCode,
  isDictionaryEntryId,
  isFlattenedStableKey,
  isFriendlySlug,
  isInstallId,
  isNamespacedId,
  isOutputKey,
  isRepoId,
  isSpanId,
  isStrictIdentifier,
  isTemplateId,
  isTraceId,
  NAMESPACED_ID_PATTERN,
  STRICT_IDENTIFIER_PATTERN,
  TEMPLATE_ROLE_PATTERN,
  TRACE_ID_PATTERN,
} from "./identifiers";

// covers: T:identifiers.STRICT_IDENTIFIER_PATTERN, T:identifiers.isStrictIdentifier
describe("STRICT_IDENTIFIER_PATTERN", () => {
  it("accepts safe identifier shapes", () => {
    for (const ok of ["hero", "intro_hero", "_private", "a", "camelCase", "Pascal", "x0", "_0"]) {
      expect(isStrictIdentifier(ok)).toBe(true);
    }
  });

  it("rejects hyphens, dots, spaces, leading digits, emojis, non-ASCII", () => {
    for (const bad of [
      "alpha-master",   // hyphen
      "hero.mp4",       // dot
      "intro hero",     // space
      "0_first",        // leading digit
      "✨",             // emoji
      "café",           // non-ASCII letter
      "",               // empty
      " ",              // whitespace
    ]) {
      expect(isStrictIdentifier(bad)).toBe(false);
    }
  });

  it("rejects > 64 chars", () => {
    expect(isStrictIdentifier("a".repeat(64))).toBe(true);
    expect(isStrictIdentifier("a".repeat(65))).toBe(false);
  });
});

// covers: T:identifiers.FRIENDLY_SLUG_PATTERN, T:identifiers.isFriendlySlug
describe("FRIENDLY_SLUG_PATTERN", () => {
  it("accepts strict identifiers PLUS hyphens and dots", () => {
    for (const ok of ["alpha-master", "hero.mp4", "Q2-launch", "v1.0.0", "with_underscore", "0starts-digit"]) {
      expect(isFriendlySlug(ok)).toBe(true);
    }
  });

  it("rejects leading hyphen or dot, colons, spaces, emojis", () => {
    for (const bad of ["-leading-hyphen", ".leading-dot", "a:b", "with space", "✨emoji"]) {
      expect(isFriendlySlug(bad)).toBe(false);
    }
  });

  it("rejects > 128 chars", () => {
    expect(isFriendlySlug("a".repeat(128))).toBe(true);
    expect(isFriendlySlug("a".repeat(129))).toBe(false);
  });
});

// covers: T:identifiers.FLATTENED_STABLE_KEY_PATTERN, T:identifiers.FlattenedStableKey, T:identifiers.isFlattenedStableKey
describe("FLATTENED_STABLE_KEY_PATTERN", () => {
  it("accepts strict identifier with optional c<N>_ prefixes", () => {
    for (const ok of [
      "intro_hero",            // no prefix
      "c0_intro_hero",         // one prefix
      "c0_c1_intro_hero",      // chained prefixes (deep nesting)
      "c12_outro",             // multi-digit prefix
    ]) {
      expect(isFlattenedStableKey(ok)).toBe(true);
    }
  });

  it("rejects identifier-invalid suffixes and shapes outside STRICT_IDENTIFIER", () => {
    // NB: strings like "c_intro" / "C0_intro" / "c0intro" parse as
    // bare STRICT_IDENTIFIERs (the c<N>_ prefix is optional). They
    // are legal flattened stable keys, just without a prefix.
    for (const bad of [
      "c0_alpha-master",  // suffix is FRIENDLY_SLUG, not STRICT_IDENTIFIER (hyphen)
      "c0_intro hero",    // suffix contains space
      "-leading-hyphen",  // not an identifier at all
      "",
    ]) {
      expect(isFlattenedStableKey(bad)).toBe(false);
    }
  });
});

// covers: T:identifiers.NAMESPACED_ID_PATTERN, T:identifiers.isNamespacedId
describe("NAMESPACED_ID_PATTERN", () => {
  it("accepts @scope/path/v1-style ids", () => {
    for (const ok of [
      "@m0saic/dj/session-hero/v1",
      "@community/montage/v0",
      "splits/2-col",
      "brand/m0saic-m-256",
      "@user/private-thing",
      "single",
    ]) {
      expect(isNamespacedId(ok)).toBe(true);
    }
  });

  it("rejects empty segments, spaces, dots, invalid characters", () => {
    for (const bad of [
      "@m0saic//double-slash",
      "with space/x",
      "trailing/",
      "/leading",
      "has.dot",
      "",
    ]) {
      expect(isNamespacedId(bad)).toBe(false);
    }
  });
});

// covers: T:identifiers.DIAGNOSTIC_CODE_PATTERN, T:identifiers.DiagnosticCode, T:identifiers.isDiagnosticCode
describe("DIAGNOSTIC_CODE_PATTERN", () => {
  it("accepts SCREAMING_SNAKE_CASE codes", () => {
    for (const ok of [
      "MISSING_SOURCE",
      "MOSAIC_REF_FORWARD_REFERENCE",
      "A",
      "OUTPUT_TARGET_NOT_YET_IMPLEMENTED",
      "ERR_42",
    ]) {
      expect(isDiagnosticCode(ok)).toBe(true);
    }
  });

  it("rejects lowercase, leading digit, hyphens, dots", () => {
    for (const bad of [
      "missing_source",
      "Missing_Source",
      "0_LEAD",
      "FOO-BAR",
      "FOO.BAR",
      "",
    ]) {
      expect(isDiagnosticCode(bad)).toBe(false);
    }
  });
});

// covers: T:identifiers.TEMPLATE_ROLE_PATTERN
describe("TEMPLATE_ROLE_PATTERN", () => {
  it("accepts kebab-case lowercase slugs", () => {
    for (const ok of [
      "renderable",
      "data-fetcher",
      "building-block",
      "orchestrator",
      "harness",
      "a",
      "v1",
      "long-multi-word-slug",
    ]) {
      expect(TEMPLATE_ROLE_PATTERN.test(ok)).toBe(true);
    }
  });

  it("rejects uppercase, underscores, leading hyphens, empty, special chars", () => {
    for (const bad of [
      "",
      "Renderable",
      "DATA_FETCHER",
      "data_fetcher",
      "-leading",
      "trailing-",
      "double--hyphen",
      "has space",
      "has.dot",
      "has/slash",
      "1leading-digit",
    ]) {
      expect(TEMPLATE_ROLE_PATTERN.test(bad)).toBe(false);
    }
  });
});

// covers: T:identifiers.asAssetId, T:identifiers.asFlattenedStableKey, T:identifiers.asAliasId, T:identifiers.asTemplateId, T:identifiers.asRepoId, T:identifiers.asDictionaryEntryId, T:identifiers.asDiagnosticCode
describe("Brand cast helpers (asXxx — no runtime validation)", () => {
  // Matches the existing asAssetId contract: cast only, no throw.
  // The predicate functions are the validators.

  it("asFlattenedStableKey casts without validating", () => {
    const k = asFlattenedStableKey("intro_hero");
    expect(k).toBe("intro_hero");
    // Even a malformed string passes the cast — by design. The
    // validator predicate is the safety check; cast is for JSON
    // parse boundaries.
    const malformed = asFlattenedStableKey("---not-valid---");
    expect(malformed).toBe("---not-valid---");
  });

  it("asAliasId casts without validating", () => {
    expect(asAliasId("templateContext")).toBe("templateContext");
  });

  it("asAssetId casts without validating", () => {
    expect(asAssetId("hero.mp4")).toBe("hero.mp4");
    // Malformed strings pass — the cast does not validate. Use
    // isFriendlySlug at JSON-parse boundaries to check the shape.
    expect(asAssetId("---not-valid---")).toBe("---not-valid---");
  });

  it("asTemplateId casts without validating", () => {
    expect(asTemplateId("@m0saic/dj/session-hero/v1")).toBe(
      "@m0saic/dj/session-hero/v1",
    );
  });

  it("asRepoId casts without validating", () => {
    expect(asRepoId("@m0saic-starter")).toBe("@m0saic-starter");
    expect(asRepoId("@community")).toBe("@community");
  });

  it("asDictionaryEntryId casts without validating", () => {
    expect(asDictionaryEntryId("splits/2-col")).toBe("splits/2-col");
  });

  it("asDiagnosticCode casts without validating", () => {
    expect(asDiagnosticCode("MOSAIC_REF_FORWARD_REFERENCE")).toBe(
      "MOSAIC_REF_FORWARD_REFERENCE",
    );
  });
});

// covers: T:identifiers.isAssetId
describe("isAssetId", () => {
  it("accepts FRIENDLY_SLUG-shaped asset keys", () => {
    for (const ok of ["hero", "hero.mp4", "big_buck_bunny_1080p", "intro-clip"]) {
      expect(isAssetId(ok)).toBe(true);
    }
  });

  it("rejects shapes that wouldn't survive a filename", () => {
    for (const bad of ["", " ", "/abs/path.mov", "hero clip", "✨", ".leading", "-leading"]) {
      expect(isAssetId(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isAssetId(42)).toBe(false);
    expect(isAssetId(null)).toBe(false);
    expect(isAssetId(undefined)).toBe(false);
  });
});

// covers: T:identifiers.isAliasId
describe("isAliasId", () => {
  it("accepts STRICT_IDENTIFIER-shaped aliases", () => {
    for (const ok of ["templateContext", "seasonData", "designTokens", "_private", "x"]) {
      expect(isAliasId(ok)).toBe(true);
    }
  });

  it("rejects hyphens, dots, spaces (would break dot-property access in upstreamData)", () => {
    for (const bad of ["template-context", "season.data", "design tokens", "0starts-digit", ""]) {
      expect(isAliasId(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isAliasId(42)).toBe(false);
    expect(isAliasId(null)).toBe(false);
  });
});

// covers: T:identifiers.isTemplateId
describe("isTemplateId", () => {
  it("accepts @scope/pack/name/vN template ids", () => {
    for (const ok of [
      "@m0saic/dj/session-hero/v1",
      "@community/montage/v0",
      "@my-org/my-template/v3",
    ]) {
      expect(isTemplateId(ok)).toBe(true);
    }
  });

  it("rejects malformed shapes", () => {
    for (const bad of [
      "@m0saic//empty-segment/v1",
      "trailing/",
      "/leading",
      "has.dot/v1",
      "has space/v1",
      "",
    ]) {
      expect(isTemplateId(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isTemplateId(42)).toBe(false);
    expect(isTemplateId(null)).toBe(false);
  });
});

// covers: T:identifiers.isRepoId
describe("isRepoId", () => {
  it("accepts repo scopes (degenerate single-segment NAMESPACED)", () => {
    for (const ok of ["@m0saic-starter", "@community", "@my-org"]) {
      expect(isRepoId(ok)).toBe(true);
    }
  });

  it("rejects empty / spaces / dots", () => {
    for (const bad of ["", "@with space", "@has.dot", "/leading", "trailing/"]) {
      expect(isRepoId(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isRepoId(42)).toBe(false);
    expect(isRepoId(null)).toBe(false);
  });
});

// covers: T:identifiers.isDictionaryEntryId
describe("isDictionaryEntryId", () => {
  it("accepts category/name dictionary entry ids", () => {
    for (const ok of ["splits/2-col", "brand/m0saic-m-256", "shapes/hex"]) {
      expect(isDictionaryEntryId(ok)).toBe(true);
    }
  });

  it("rejects empty segments, dots, spaces", () => {
    for (const bad of ["splits//double", "trailing/", "/leading", "has.dot", "has space", ""]) {
      expect(isDictionaryEntryId(bad)).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isDictionaryEntryId(42)).toBe(false);
    expect(isDictionaryEntryId(null)).toBe(false);
  });
});

// covers: T:identifiers.patterns#exported-as-RegExp
describe("Patterns are exported as RegExp constants", () => {
  // External validators (CLI lint, dev-server schema check, editor
  // form validation) consume these directly.
  it("exposes raw RegExp instances", () => {
    expect(STRICT_IDENTIFIER_PATTERN).toBeInstanceOf(RegExp);
    expect(FRIENDLY_SLUG_PATTERN).toBeInstanceOf(RegExp);
    expect(FLATTENED_STABLE_KEY_PATTERN).toBeInstanceOf(RegExp);
    expect(NAMESPACED_ID_PATTERN).toBeInstanceOf(RegExp);
    expect(DIAGNOSTIC_CODE_PATTERN).toBeInstanceOf(RegExp);
    expect(TRACE_ID_PATTERN).toBeInstanceOf(RegExp);
  });
});

// covers: T:identifiers.TRACE_ID_PATTERN, T:identifiers.TraceId, T:identifiers.SpanId, T:identifiers.isTraceId, T:identifiers.isSpanId, T:identifiers.asTraceId, T:identifiers.asSpanId
describe("TRACE_ID_PATTERN (UUIDv4)", () => {
  it("accepts lowercase UUIDv4", () => {
    for (const ok of [
      "550e8400-e29b-41d4-a716-446655440000",
      "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "00000000-0000-4000-8000-000000000000",
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    ]) {
      expect(isTraceId(ok)).toBe(true);
      expect(isSpanId(ok)).toBe(true);
    }
  });

  it("rejects malformed shapes", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      "550E8400-E29B-41D4-A716-446655440000", // uppercase
      "550e8400e29b41d4a716446655440000",      // no hyphens
      "550e8400-e29b-31d4-a716-446655440000",  // version != 4
      "550e8400-e29b-41d4-7716-446655440000",  // variant nibble not 8/9/a/b
      "550e8400-e29b-41d4-a716-44665544000",   // too short
      "550e8400-e29b-41d4-a716-4466554400000", // too long
    ]) {
      expect(isTraceId(bad)).toBe(false);
      expect(isSpanId(bad)).toBe(false);
    }
  });

  it("cast helpers return branded values without runtime validation", () => {
    const t = asTraceId("not-a-uuid");
    const s = asSpanId("also-not");
    expect(t).toBe("not-a-uuid");
    expect(s).toBe("also-not");
  });
});

// covers: T:identifiers.OutputKey, T:identifiers.isOutputKey, T:identifiers.asOutputKey
describe("OutputKey (FRIENDLY_SLUG)", () => {
  it("accepts the canonical output-map keys", () => {
    for (const ok of ["default", "desktop", "mobile", "alpha-master", "social.1080x1080"]) {
      expect(isOutputKey(ok)).toBe(true);
    }
  });

  it("rejects shapes that wouldn't survive a filename", () => {
    for (const bad of ["", " ", "alpha master", "✨", ".leading-dot", "-leading-hyphen"]) {
      expect(isOutputKey(bad)).toBe(false);
    }
  });

  it("asOutputKey casts without validating", () => {
    expect(asOutputKey("default")).toBe("default");
  });
});

// covers: T:identifiers.InstallId, T:identifiers.isInstallId, T:identifiers.asInstallId
describe("InstallId (UUIDv4)", () => {
  it("accepts the same shape as TraceId / SpanId", () => {
    expect(isInstallId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isInstallId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("rejects malformed shapes", () => {
    for (const bad of ["", "not-a-uuid", "550E8400-E29B-41D4-A716-446655440000"]) {
      expect(isInstallId(bad)).toBe(false);
    }
  });

  it("asInstallId casts without validating", () => {
    expect(asInstallId("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
});
