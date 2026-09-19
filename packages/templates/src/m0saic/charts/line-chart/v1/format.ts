/**
 * ============================================================================
 * @m0saic/charts/line-chart — value/tick label formatting
 * ============================================================================
 *
 * Pure formatters for axis ticks + per-point value labels. The axis MATH
 * (nice ticks / projection) lives in @m0saic/dsl-stdlib (via charts/_shared);
 * this file only turns a number into a display string with the chosen
 * format / decimals / prefix / suffix.
 * ============================================================================
 */

import type { AxisTickFormat, ValueLabelFormat } from "./types";

function compact(n: number, decimals: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(decimals) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(decimals) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(decimals) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(decimals) + "K";
  return sign + abs.toFixed(decimals);
}

/**
 * Format an axis tick value.
 *
 * @param value   the tick value
 * @param format  raw | compact | percent
 * @param decimals fixed decimal places
 * @param domainMax used by "percent" (value / max * 100)
 * @param prefix/suffix wrappers (e.g. "$" / "ms")
 */
export function formatAxisValue(
  value: number,
  format: AxisTickFormat,
  decimals: number,
  domainMax: number,
  prefix = "",
  suffix = "",
): string {
  let base: string;
  switch (format) {
    case "raw":
      // Comma-group thousands for the canonical numeric-axis look (1,000).
      base = groupThousands(value, decimals);
      break;
    case "percent":
      base = domainMax === 0 ? (0).toFixed(decimals) + "%" : ((value / domainMax) * 100).toFixed(decimals) + "%";
      break;
    case "compact":
    default:
      base = compact(value, decimals);
      break;
  }
  return `${prefix}${base}${suffix}`;
}

/** Format a per-point value label. */
export function formatValueLabel(
  value: number,
  format: ValueLabelFormat,
  decimals: number,
): string {
  switch (format) {
    case "raw":
      return groupThousands(value, decimals);
    case "percent":
      return value.toFixed(decimals) + "%";
    case "compact":
    default:
      return compact(value, decimals);
  }
}

/** "1234567" → "1,234,567" (with fixed decimals). */
export function groupThousands(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const digits = sign ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`;
}
