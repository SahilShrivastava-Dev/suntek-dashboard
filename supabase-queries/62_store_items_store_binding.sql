-- ═══════════════════════════════════════════════════════════════════════════
-- 62_store_items_store_binding.sql — every stock row belongs to a store
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BUG
-- Migrations 59/60 added `store_items.store_id` and merged the Rehla register,
-- but the four places that CREATE stock rows were never taught about it:
--   • apply_stock_purchase()        (53)  — "Add Purchase"
--   • apply_repair_return()         (56)  — closing a ticket with a repaired part
--   • record_defective_disposition()(56)
--   • the Excel import upsert       (StockRegister.tsx)
--
-- So a row created after the merge got store_id = NULL and fell back to being
-- grouped by plant — which is why closing an SPPL – Rehla ticket conjured a
-- phantom "SPPL – Rehla" register next to "Rehla Common Store". The stock was
-- real; it was simply filed outside the shared store.
--
-- Worse, those RPCs also LOOK UP an existing row with
--     where si.plant_id = v_plant
-- After the merge the shared row carries the ANCHOR factory's plant_id, so a
-- purchase raised by a sibling factory matched nothing and created a second
-- row for an item the store already had — re-introducing exactly the
-- duplication migration 60 existed to remove.
--
-- THE FIX (three layers, so no future writer can reopen this)
--   1. store_for_plant()  — the one place that answers "which store does this
--      factory draw from".
--   2. A BEFORE INSERT/UPDATE TRIGGER on store_items that fills store_id from
--      plant_id. This catches EVERY writer, including ones added later and the
--      client-side upsert, rather than relying on each remembering.
--   3. The two live RPCs' lookups are repointed at the store. Done as a text
--      patch on the installed definition so their bodies are not restated here
--      and cannot drift out of sync with 53/56 — and the patch VERIFIES it
--      applied, so a silent no-op is impossible.
--
-- Then the orphans already created are adopted into their store and merged
-- with any row the store already had for the same item.
--
-- Requires 59 (store_id, factory_store_access), 60 (merge), 53/56 (the RPCs).
-- Idempotent. Reversible via 62_rollback_store_items_store_binding.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which store does a factory draw from? ────────────────────────────────
create or replace function public.store_for_plant(p_plant uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select f.store_id from factory_store_access f where f.plant_id = p_plant limit 1;
$$;
grant execute on function public.store_for_plant(uuid) to anon, authenticated;

-- ── 2. Trigger: a stock row can never be created without its store ──────────
create or replace function public.store_items_fill_store_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.store_id is null and new.plant_id is not null then
    new.store_id := public.store_for_plant(new.plant_id);
  end if;
  return new;
end $$;

drop trigger if exists store_items_fill_store_id on store_items;
create trigger store_items_fill_store_id
  before insert or update of plant_id, store_id on store_items
  for each row execute function public.store_items_fill_store_id();

-- ── 3. Repoint the RPC lookups from factory to store ────────────────────────
-- Patches the INSTALLED definition rather than restating ~250 lines of function
-- body here (which would silently rot the moment 53 or 56 changes). Both
-- functions use the same predicate, so one replacement covers all four sites.
--
-- The replacement keeps working before migration 59: if the factory has no
-- store mapping yet, store_for_plant() is NULL and it falls back to matching on
-- plant_id exactly as before.
do $$
declare
  v_fn     text;
  v_src    text;
  v_new    text;
  v_needle constant text := 'si.plant_id = v_plant';
  v_repl   constant text :=
    '(si.store_id = public.store_for_plant(v_plant)'
    ' or (public.store_for_plant(v_plant) is null and si.plant_id = v_plant))';
  v_hits   int;
begin
  foreach v_fn in array array['apply_stock_purchase', 'apply_repair_return'] loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn
     order by p.oid desc limit 1;

    if v_src is null then
      raise exception 'function public.%() not found — apply 53 and 56 first', v_fn;
    end if;

    -- Already patched (re-run) → skip.
    if position('store_for_plant' in v_src) > 0 then
      raise notice '%() already store-aware — skipped', v_fn;
      continue;
    end if;

    v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
    if v_hits = 0 then
      raise exception
        'Could not patch public.%(): the expected lookup "%" is not present. '
        'Its definition has changed — repoint the store_items lookup by hand.',
        v_fn, v_needle;
    end if;

    v_new := replace(v_src, v_needle, v_repl);
    execute v_new;
    raise notice 'Patched %() — % lookup site(s) now resolve by store.', v_fn, v_hits;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Adopt the orphans already created, merging duplicates
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists store_item_orphan_pre62_backup as
  select *, now() as snapshot_at from store_items where store_id is null;

do $$
declare
  v_row   record;
  v_keep  uuid;
  v_fk    record;
  v_n     bigint;
  v_moved bigint := 0;
  v_merged bigint := 0;
begin
  -- Walk each orphan: if its store already holds that item, fold it in and drop
  -- the orphan; otherwise just adopt it.
  for v_row in
    select si.id, si.item_name, si.plant_id, public.store_for_plant(si.plant_id) as store_id
      from store_items si
     where si.store_id is null and si.plant_id is not null
  loop
    if v_row.store_id is null then
      continue;  -- factory has no store mapping; leave it alone
    end if;

    select id into v_keep from store_items
     where store_id = v_row.store_id
       and lower(btrim(item_name)) = lower(btrim(v_row.item_name))
       and id <> v_row.id
     order by created_at limit 1;

    if v_keep is null then
      update store_items set store_id = v_row.store_id where id = v_row.id;
      v_moved := v_moved + 1;
    else
      -- Move the orphan's history onto the surviving row FIRST — store_stock_
      -- events.item_id is ON DELETE CASCADE and would otherwise be destroyed.
      for v_fk in
        select con.conrelid::regclass::text as child_table, att.attname as child_column
          from pg_constraint con
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
         where con.contype = 'f' and con.confrelid = 'public.store_items'::regclass
           and con.conrelid::regclass::text not like '%backup'
      loop
        execute format('update %s set %I = %L where %I = %L',
                       v_fk.child_table, v_fk.child_column, v_keep, v_fk.child_column, v_row.id);
      end loop;

      update store_items w
         set procured_qty        = w.procured_qty        + coalesce(l.procured_qty, 0),
             issued_qty          = w.issued_qty          + coalesce(l.issued_qty, 0),
             manual_delta        = w.manual_delta        + coalesce(l.manual_delta, 0),
             ticket_procured_qty = coalesce(w.ticket_procured_qty, 0) + coalesce(l.ticket_procured_qty, 0),
             repaired_qty        = coalesce(w.repaired_qty, 0)        + coalesce(l.repaired_qty, 0),
             on_hand             = w.on_hand             + coalesce(l.on_hand, 0),
             updated_at          = now()
        from store_items l
       where w.id = v_keep and l.id = v_row.id;

      delete from store_items where id = v_row.id;
      v_merged := v_merged + 1;
    end if;
  end loop;

  -- Stock movements recorded against an orphan carry the same gap.
  update store_stock_events e
     set store_id = public.store_for_plant(e.plant_id)
   where e.store_id is null and e.plant_id is not null;
  get diagnostics v_n = row_count;

  raise notice 'Adopted % orphan row(s), merged % into an existing item, tagged % event(s).',
               v_moved, v_merged, v_n;
end $$;

notify pgrst, 'reload schema';

-- ── Diagnostics ─────────────────────────────────────────────────────────────
--   No stock row should be storeless (expect zero):
--     select count(*) from store_items where store_id is null;
--
--   One row per item per store (expect zero):
--     select store_id, item_name, count(*) from store_items
--      group by 1,2 having count(*) > 1;
--
--   The registers a user will now see — Rehla's three factories share one:
--     select s.name as store, count(si.*) as items
--       from stores s left join store_items si on si.store_id = s.id
--      where s.is_active group by s.name order by s.name;
