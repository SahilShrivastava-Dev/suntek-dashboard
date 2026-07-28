/**
 * Tile presentation metadata.
 *
 * This module used to also carry a hard-coded L1–L4 role hierarchy
 * (ROLE_LEVEL / hasAccess / getHomeRoute). It was dead — nothing imported it —
 * and it had drifted out of step with reality twice over: it never knew about
 * the L5 tier added in migration 29, and its ordering is the reverse of the
 * ladder the client uses (L0 top → L4 entry, migration 64).
 *
 * Seniority is DATA now: the `tiers` table owns the ladder and `roles.level`
 * points into it. Compare `tiers.rank` (higher = more senior); each role's
 * `home_route` and `allowed_routes` live on the role row. Keeping a second,
 * hard-coded copy of the hierarchy here would just be another thing to forget
 * to renumber.
 */

/** Tile colour by data source */
export type TileVariant = 'red' | 'green' | 'yellow';

export const TILE_META: Record<TileVariant, { label: string; badgeClass: string }> = {
  red:    { label: 'Busy API',      badgeClass: 'badge-api'    },
  green:  { label: 'Excel Import',  badgeClass: 'badge-excel'  },
  yellow: { label: 'Manual Entry',  badgeClass: 'badge-manual' },
};
