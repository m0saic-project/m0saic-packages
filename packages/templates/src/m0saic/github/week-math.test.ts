// covers: github/week-math — pure ISO-8601 week + Monday-window arithmetic,
// Date-free, with year-boundary cases.
import {
  addDaysISO,
  isoDayOfWeek,
  mondayOfISO,
  isoWeekNumber,
  lastFullWeek,
  parseISODate,
  formatISODate,
  daysFromCivil,
  civilFromDays,
} from "./week-math";

describe("github/week-math", () => {
  describe("parse / format round-trip", () => {
    it("parses and reformats, zero-padding", () => {
      expect(parseISODate("2026-07-06")).toEqual({ y: 2026, m: 7, d: 6 });
      expect(formatISODate({ y: 7, m: 1, d: 9 })).toBe("0007-01-09");
      expect(parseISODate("2026-07-06T12:34:56Z")).toEqual({ y: 2026, m: 7, d: 6 });
    });
    it("throws on a non-date", () => {
      expect(() => parseISODate("nope")).toThrow(/not an ISO date/);
    });
  });

  describe("civil <-> days is an exact inverse (incl. leap + epoch)", () => {
    for (const iso of ["1970-01-01", "2000-02-29", "2024-02-29", "1999-12-31", "2026-07-06", "2100-03-01"]) {
      it(iso, () => {
        const { y, m, d } = parseISODate(iso);
        expect(civilFromDays(daysFromCivil(y, m, d))).toEqual({ y, m, d });
      });
    }
    it("epoch is day 0", () => {
      expect(daysFromCivil(1970, 1, 1)).toBe(0);
    });
  });

  describe("addDaysISO crosses month / year / leap boundaries", () => {
    it("day, month, year rollover", () => {
      expect(addDaysISO("2026-07-06", -1)).toBe("2026-07-05");
      expect(addDaysISO("2026-07-31", 1)).toBe("2026-08-01");
      expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
      expect(addDaysISO("2027-01-01", -1)).toBe("2026-12-31");
    });
    it("leap vs non-leap February", () => {
      expect(addDaysISO("2024-02-28", 1)).toBe("2024-02-29"); // leap
      expect(addDaysISO("2023-02-28", 1)).toBe("2023-03-01"); // non-leap
    });
  });

  describe("isoDayOfWeek (0=Mon..6=Sun)", () => {
    it("known days", () => {
      expect(isoDayOfWeek("2026-07-06")).toBe(0); // Monday
      expect(isoDayOfWeek("2026-07-12")).toBe(6); // Sunday
      expect(isoDayOfWeek("1970-01-01")).toBe(3); // Thursday
    });
  });

  describe("mondayOfISO", () => {
    it("maps any weekday to its Monday", () => {
      expect(mondayOfISO("2026-07-12")).toBe("2026-07-06"); // Sun -> that Monday
      expect(mondayOfISO("2026-07-06")).toBe("2026-07-06"); // Mon -> itself
      expect(mondayOfISO("2026-07-08")).toBe("2026-07-06"); // Wed
    });
  });

  describe("isoWeekNumber — textbook ISO-8601 boundary cases", () => {
    it("weeks belonging to the neighbouring year", () => {
      expect(isoWeekNumber("2016-01-01")).toBe(53); // Fri -> W53 of 2015
      expect(isoWeekNumber("2015-12-31")).toBe(53);
      expect(isoWeekNumber("2005-01-01")).toBe(53); // Sat -> W53 of 2004
      expect(isoWeekNumber("2018-12-31")).toBe(1); // Mon -> W1 of 2019
      expect(isoWeekNumber("2007-01-01")).toBe(1); // Mon -> W1
    });
    it("is constant across a Mon..Sun week", () => {
      const wk = isoWeekNumber("2026-07-06");
      for (let i = 0; i < 7; i++) expect(isoWeekNumber(addDaysISO("2026-07-06", i))).toBe(wk);
      // and the next Monday advances by one
      expect(isoWeekNumber("2026-07-13")).toBe(wk + 1);
    });
  });

  describe("lastFullWeek — most recent COMPLETE Mon..Sun strictly before today", () => {
    it("on a Monday, returns the immediately preceding week", () => {
      expect(lastFullWeek("2026-07-13")).toEqual({ startISO: "2026-07-06", endISO: "2026-07-12" });
    });
    it("on a Sunday, the current (incomplete) week is excluded", () => {
      expect(lastFullWeek("2026-07-12")).toEqual({ startISO: "2026-06-29", endISO: "2026-07-05" });
    });
    it("on a Wednesday, same as its week's prior week", () => {
      expect(lastFullWeek("2026-07-08")).toEqual({ startISO: "2026-06-29", endISO: "2026-07-05" });
    });
  });
});
