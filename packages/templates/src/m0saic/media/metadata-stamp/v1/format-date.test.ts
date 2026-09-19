import {
  APPLE_CREATION_TAG,
  CREATION_TIME_TAG,
  STAMP_DATE_FORMATS,
  extractCreationTimestampRaw,
  formatVideoTimestamp,
  parseVideoTimestamp,
} from "./format-date";

describe("extractCreationTimestampRaw", () => {
  test("prefers the Apple key (format.tags) over creation_time", () => {
    const raw = extractCreationTimestampRaw({
      tags: { [CREATION_TIME_TAG]: "2024-03-11T18:22:04.000000Z" },
      format: { tags: { [APPLE_CREATION_TAG]: "2024-03-11T19:22:04+0100" } },
    });
    expect(raw).toBe("2024-03-11T19:22:04+0100");
  });

  test("falls back to creation_time from the merged tags", () => {
    const raw = extractCreationTimestampRaw({
      tags: { [CREATION_TIME_TAG]: "2024-03-11T18:22:04.000000Z" },
    });
    expect(raw).toBe("2024-03-11T18:22:04.000000Z");
  });

  test("Apple key is also found in merged tags", () => {
    const raw = extractCreationTimestampRaw({
      tags: { [APPLE_CREATION_TAG]: "2024-03-11T19:22:04+0100" },
    });
    expect(raw).toBe("2024-03-11T19:22:04+0100");
  });

  test("absent / empty tags → null", () => {
    expect(extractCreationTimestampRaw(undefined)).toBeNull();
    expect(extractCreationTimestampRaw({})).toBeNull();
    expect(extractCreationTimestampRaw({ tags: {} })).toBeNull();
    expect(extractCreationTimestampRaw({ tags: { [CREATION_TIME_TAG]: "  " } })).toBeNull();
    expect(extractCreationTimestampRaw({ tags: { other: "x" } })).toBeNull();
  });
});

describe("parseVideoTimestamp", () => {
  test("ffprobe UTC form with fraction and Z", () => {
    const p = parseVideoTimestamp("2024-03-11T18:22:04.000000Z");
    expect(p).toEqual({
      epochMs: Date.UTC(2024, 2, 11, 18, 22, 4),
      offsetMinutes: 0,
    });
  });

  test("Apple offset form +0100 (wall time is local)", () => {
    const p = parseVideoTimestamp("2024-03-11T19:22:04+0100");
    // Same instant as 18:22:04Z, with the +60min offset preserved.
    expect(p).toEqual({
      epochMs: Date.UTC(2024, 2, 11, 18, 22, 4),
      offsetMinutes: 60,
    });
  });

  test("colon offset form -05:30", () => {
    const p = parseVideoTimestamp("2024-03-11T12:52:04-05:30");
    expect(p).toEqual({
      epochMs: Date.UTC(2024, 2, 11, 18, 22, 4),
      offsetMinutes: -330,
    });
  });

  test("no zone designator → treated as UTC, offset null (never local time)", () => {
    const p = parseVideoTimestamp("2024-03-11 18:22:04");
    expect(p).toEqual({
      epochMs: Date.UTC(2024, 2, 11, 18, 22, 4),
      offsetMinutes: null,
    });
  });

  test("date-only form", () => {
    const p = parseVideoTimestamp("2024-03-11");
    expect(p).toEqual({ epochMs: Date.UTC(2024, 2, 11), offsetMinutes: null });
  });

  test("malformed / out-of-range → null", () => {
    expect(parseVideoTimestamp(null)).toBeNull();
    expect(parseVideoTimestamp("")).toBeNull();
    expect(parseVideoTimestamp("yesterday")).toBeNull();
    expect(parseVideoTimestamp("2024-13-01")).toBeNull();
    expect(parseVideoTimestamp("2024-00-01")).toBeNull();
    expect(parseVideoTimestamp("2024-03-32")).toBeNull();
    expect(parseVideoTimestamp("2024-03-11T25:00:00Z")).toBeNull();
    expect(parseVideoTimestamp("2024-03-11T18:22:04+2560")).toBeNull();
  });
});

describe("formatVideoTimestamp", () => {
  const TS = parseVideoTimestamp("2024-03-11T18:22:04.000000Z")!;

  test("every preset formats deterministically", () => {
    const expected: Record<(typeof STAMP_DATE_FORMATS)[number], string> = {
      "YYYY-MM-DD": "2024-03-11",
      "YYYY-MM-DD HH:mm": "2024-03-11 18:22",
      "MMM D, YYYY": "Mar 11, 2024",
      "D MMM YYYY": "11 Mar 2024",
      "MM/DD/YYYY": "03/11/2024",
      "DD.MM.YYYY": "11.03.2024",
    };
    for (const f of STAMP_DATE_FORMATS) {
      expect(formatVideoTimestamp(TS, f)).toBe(expected[f]);
    }
  });

  test("uses the tag's own offset when no override is given", () => {
    const apple = parseVideoTimestamp("2024-03-11T19:22:04+0100")!;
    // Renders the wall time the camera stamped, not UTC.
    expect(formatVideoTimestamp(apple, "YYYY-MM-DD HH:mm")).toBe("2024-03-11 19:22");
  });

  test("explicit override wins over the tag offset", () => {
    const apple = parseVideoTimestamp("2024-03-11T19:22:04+0100")!;
    expect(formatVideoTimestamp(apple, "YYYY-MM-DD HH:mm", -300)).toBe("2024-03-11 13:22");
  });

  test("offset can move the DATE across midnight", () => {
    // 18:22 UTC + 9h (Tokyo) = 03:22 next day.
    expect(formatVideoTimestamp(TS, "YYYY-MM-DD", 540)).toBe("2024-03-12");
    // 18:22 UTC - 19h = 23:22 previous day.
    expect(formatVideoTimestamp(TS, "YYYY-MM-DD HH:mm", -1140)).toBe("2024-03-10 23:22");
  });
});
