import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useRoleContext } from './RoleContext';

/**
 * PlantScopeContext — the logged-in user's DATA scope (Phase 1, app-layer).
 *
 * A user's scope = the plants they belong to (`user_plants`), optionally narrowed
 * to specific units within those plants (`user_units`), OR global (`is_global` /
 * Owner-Admin / dev bypass) which sees everything. This is the dimension the app
 * discarded before; here it drives query filtering, create-time stamping, and
 * notification delivery.
 *
 * NOTE: scope follows the REAL logged-in user, not an admin's "view as" preview
 * (admins are global and see all data regardless of the previewed role).
 *
 * This is the visible/testable half. Phase 2 enforces the same rules in the DB
 * with RLS so they can't be bypassed via the API.
 */

export interface PlantRow { id: string; name: string }
export interface UnitRow { id: string; plant_id: string; name: string; code: string | null }

const NIL_UUID = '00000000-0000-0000-0000-000000000000'; // matches no row (fail-closed)
const EMPTY_IDS: string[] = []; // stable ref so scope memoization doesn't churn each render

interface PlantScopeValue {
  /** True once plants/units are loaded and the user's scope is resolved. */
  ready: boolean;
  /** Sees every plant (Owner/Admin, dev bypass, or a user flagged is_global). */
  isGlobal: boolean;
  /** Plant ids the user may see/act on. For a global user this is every plant. */
  plantIds: string[];
  /** Unit ids the user is restricted to. Empty = all units of their plants. */
  unitIds: string[];
  /** All plants (labels + pickers). */
  plants: PlantRow[];
  /** All units (labels + pickers). */
  units: UnitRow[];
  /** Plants the user may pick when creating a record (all if global). */
  allowedPlants: PlantRow[];
  /** Units within one plant the user may pick (respects unit restriction). */
  allowedUnits: (plantId: string | null | undefined) => UnitRow[];
  /** Is a (plant, unit?) row inside the user's scope? */
  inScope: (plantId: string | null | undefined, unitId?: string | null) => boolean;
  /**
   * Apply the scope to a Supabase query. No-op for global users. Adds a plant
   * filter, and (when unitCol is given and the user is unit-restricted) also
   * limits to their units OR unit-less rows.
   */
  scopeQuery: <T>(query: T, opts?: { plantCol?: string; unitCol?: string }) => T;
  refresh: () => void;
}

const PlantScopeContext = createContext<PlantScopeValue | null>(null);

export function PlantScopeProvider({ children }: { children: React.ReactNode }) {
  const { canSwitch, authResolved } = useRoleContext();

  const [plants, setPlants] = useState<PlantRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [refDataReady, setRefDataReady] = useState(false);

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [membership, setMembership] = useState<{ isGlobal: boolean; plantIds: string[]; unitIds: string[] } | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Reference data: all plants + units (global reads; used for labels/pickers).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: p }, { data: u }] = await Promise.all([
        supabase.from('plants').select('id, name').order('name').returns<PlantRow[]>(),
        supabase.from('units').select('id, plant_id, name, code').order('name').returns<UnitRow[]>(),
      ]);
      if (cancelled) return;
      setPlants(p ?? []);
      setUnits(u ?? []);
      setRefDataReady(true);
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  // Track the logged-in auth user id (independent of RoleContext's preview state).
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setAuthUserId(session?.user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) =>
      setAuthUserId(session?.user?.id ?? null),
    );
    return () => subscription.unsubscribe();
  }, []);

  // Resolve the user's membership. Global (admin/dev) short-circuits any lookup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authResolved) return;
      if (canSwitch) { // Owner/Admin or dev bypass → global
        if (!cancelled) { setMembership({ isGlobal: true, plantIds: [], unitIds: [] }); setScopeReady(true); }
        return;
      }
      if (!authUserId) { // no session (and not dev) → no scope
        if (!cancelled) { setMembership({ isGlobal: false, plantIds: [], unitIds: [] }); setScopeReady(true); }
        return;
      }
      // Find this user's directory row, then their plant/unit memberships.
      const { data: acct } = await supabase
        .from('user_accounts')
        .select('id, is_global')
        .eq('auth_user_id', authUserId)
        .limit(1)
        .returns<{ id: string; is_global: boolean | null }[]>();
      const row = acct?.[0];
      if (!row) { if (!cancelled) { setMembership({ isGlobal: false, plantIds: [], unitIds: [] }); setScopeReady(true); } return; }
      if (row.is_global) { if (!cancelled) { setMembership({ isGlobal: true, plantIds: [], unitIds: [] }); setScopeReady(true); } return; }

      const [{ data: ups }, { data: uus }] = await Promise.all([
        supabase.from('user_plants').select('plant_id').eq('user_account_id', row.id).returns<{ plant_id: string }[]>(),
        supabase.from('user_units').select('unit_id').eq('user_account_id', row.id).returns<{ unit_id: string }[]>(),
      ]);
      if (cancelled) return;
      setMembership({
        isGlobal: false,
        plantIds: (ups ?? []).map((r) => r.plant_id),
        unitIds: (uus ?? []).map((r) => r.unit_id),
      });
      setScopeReady(true);
    })();
    return () => { cancelled = true; };
  }, [authResolved, canSwitch, authUserId, nonce]);

  const isGlobal = membership?.isGlobal ?? false;
  const allPlantIds = useMemo(() => plants.map((p) => p.id), [plants]);
  const plantIds = useMemo(
    () => (isGlobal ? allPlantIds : (membership?.plantIds ?? EMPTY_IDS)),
    [isGlobal, allPlantIds, membership],
  );
  const unitIds = useMemo(() => membership?.unitIds ?? EMPTY_IDS, [membership]);

  const plantIdSet = useMemo(() => new Set(plantIds), [plantIds]);
  const unitIdSet = useMemo(() => new Set(unitIds), [unitIds]);

  const inScope = useCallback(
    (plantId: string | null | undefined, unitId?: string | null) => {
      if (isGlobal) return true;
      if (!plantId || !plantIdSet.has(plantId)) return false;
      // Unit-restricted users: a row tagged to a unit must be one of theirs;
      // unit-less (plant-level) rows are always visible within the plant.
      if (unitIdSet.size > 0 && unitId) return unitIdSet.has(unitId);
      return true;
    },
    [isGlobal, plantIdSet, unitIdSet],
  );

  const allowedPlants = useMemo(
    () => (isGlobal ? plants : plants.filter((p) => plantIdSet.has(p.id))),
    [isGlobal, plants, plantIdSet],
  );

  const allowedUnits = useCallback(
    (plantId: string | null | undefined) => {
      if (!plantId) return [];
      let list = units.filter((u) => u.plant_id === plantId);
      if (!isGlobal && unitIdSet.size > 0) list = list.filter((u) => unitIdSet.has(u.id));
      return list;
    },
    [units, isGlobal, unitIdSet],
  );

  const scopeQuery = useCallback(
    <T,>(query: T, opts?: { plantCol?: string; unitCol?: string }): T => {
      if (isGlobal) return query;
      const plantCol = opts?.plantCol ?? 'plant_id';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = query;
      q = plantIds.length ? q.in(plantCol, plantIds) : q.eq(plantCol, NIL_UUID);
      if (opts?.unitCol && unitIdSet.size > 0) {
        q = q.or(`${opts.unitCol}.in.(${unitIds.join(',')}),${opts.unitCol}.is.null`);
      }
      return q as T;
    },
    [isGlobal, plantIds, unitIds, unitIdSet],
  );

  const value: PlantScopeValue = {
    ready: refDataReady && scopeReady,
    isGlobal,
    plantIds,
    unitIds,
    plants,
    units,
    allowedPlants,
    allowedUnits,
    inScope,
    scopeQuery,
    refresh,
  };

  return <PlantScopeContext.Provider value={value}>{children}</PlantScopeContext.Provider>;
}

export function usePlantScope(): PlantScopeValue {
  const ctx = useContext(PlantScopeContext);
  if (!ctx) throw new Error('usePlantScope must be used inside <PlantScopeProvider>');
  return ctx;
}
