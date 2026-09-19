// GENERATED FILE — do not hand-edit.
// Run `npm run dictionary:index` to regenerate.
//
// 34 entries discovered.

import type { MosaicDictionaryEntryResolved } from "@m0saic/types";
import type { MosaicRankSet, MosaicMaskSetFile } from "@m0saic/types";

import { entry as brand_m_33 } from "./brand/m-33";
import { entry as brand_m_33_bitmap } from "./brand/m-33_bitmap";
import { entry as brand_m0 } from "./brand/m0";
import { entry as brand_m0saic_pattern } from "./brand/m0saic-pattern";
import { entry as brand_qr } from "./brand/qr";
import { entry as grids_2x2 } from "./grids/2x2";
import { entry as grids_2x3 } from "./grids/2x3";
import { entry as grids_3x2 } from "./grids/3x2";
import { entry as grids_3x3 } from "./grids/3x3";
import { entry as grids_4x4 } from "./grids/4x4";
import { entry as layouts_bottom_feature } from "./layouts/bottom-feature";
import { entry as layouts_column_grid } from "./layouts/column-grid";
import { entry as layouts_dense_dashboard } from "./layouts/dense-dashboard";
import { entry as layouts_feature_sidebar } from "./layouts/feature-sidebar";
import { entry as layouts_hero_bottom_strip } from "./layouts/hero-bottom-strip";
import { entry as layouts_hero_sidebar } from "./layouts/hero-sidebar";
import { entry as layouts_hero_top_strip } from "./layouts/hero-top-strip";
import { entry as layouts_l_shape } from "./layouts/l-shape";
import { entry as layouts_main_two_supporting } from "./layouts/main-two-supporting";
import { entry as layouts_sidebar_main } from "./layouts/sidebar-main";
import { entry as layouts_stacked_pairs } from "./layouts/stacked-pairs";
import { entry as layouts_t_shape } from "./layouts/t-shape";
import { entry as layouts_three_up } from "./layouts/three-up";
import { entry as layouts_wide_feature } from "./layouts/wide-feature";
import { entry as splits_1_2_col } from "./splits/1-2-col";
import { entry as splits_1_2_row } from "./splits/1-2-row";
import { entry as splits_2_1_col } from "./splits/2-1-col";
import { entry as splits_2_1_row } from "./splits/2-1-row";
import { entry as splits_2_col } from "./splits/2-col";
import { entry as splits_2_row } from "./splits/2-row";
import { entry as splits_3_col } from "./splits/3-col";
import { entry as splits_3_row } from "./splits/3-row";
import { entry as splits_4_col } from "./splits/4-col";
import { entry as splits_4_row } from "./splits/4-row";

/** All dictionary entries as a flat array. */
export const all: MosaicDictionaryEntryResolved[] = [
  brand_m_33,
  brand_m_33_bitmap,
  brand_m0,
  brand_m0saic_pattern,
  brand_qr,
  grids_2x2,
  grids_2x3,
  grids_3x2,
  grids_3x3,
  grids_4x4,
  layouts_bottom_feature,
  layouts_column_grid,
  layouts_dense_dashboard,
  layouts_feature_sidebar,
  layouts_hero_bottom_strip,
  layouts_hero_sidebar,
  layouts_hero_top_strip,
  layouts_l_shape,
  layouts_main_two_supporting,
  layouts_sidebar_main,
  layouts_stacked_pairs,
  layouts_t_shape,
  layouts_three_up,
  layouts_wide_feature,
  splits_1_2_col,
  splits_1_2_row,
  splits_2_1_col,
  splits_2_1_row,
  splits_2_col,
  splits_2_row,
  splits_3_col,
  splits_3_row,
  splits_4_col,
  splits_4_row,
];

/** All dictionary entries keyed by id. */
export const byId: Record<string, MosaicDictionaryEntryResolved> =
  Object.fromEntries(all.map((entry) => [entry.id, entry]));

/** Look up a rank set by entry id and rank set name. */
export function getRankSet(
  entryId: string,
  name: string,
): MosaicRankSet {
  const entry = byId[entryId];
  if (!entry) {
    throw new Error(`Dictionary entry not found: "${entryId}"`);
  }

  const rs = entry.rankSets?.[name];
  if (!rs) {
    throw new Error(
      `Rank set not found: entry="${entryId}" name="${name}"`,
    );
  }

  return rs;
}

/** Look up a mask set by entry id and mask set name. */
export function getMaskSet(
  entryId: string,
  name: string,
): MosaicMaskSetFile {
  const entry = byId[entryId];
  if (!entry) {
    throw new Error(`Dictionary entry not found: "${entryId}"`);
  }

  const ms = entry.maskSetsResolved?.[name];
  if (!ms) {
    throw new Error(
      `Mask set not found: entry="${entryId}" name="${name}"`,
    );
  }

  return ms;
}
