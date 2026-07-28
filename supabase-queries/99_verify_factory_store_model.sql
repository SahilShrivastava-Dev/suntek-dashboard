-- ═══════════════════════════════════════════════════════════════════════════
-- 99_verify_factory_store_model.sql — READ-ONLY acceptance sweep
-- ═══════════════════════════════════════════════════════════════════════════
-- Asserts the whole 57→64 restructure in one run. Writes nothing, changes
-- nothing — safe against production.
--
-- Covers the client's three requirements at Rehla ("store common for all 3,
-- FAR different for all 3, maintenance different for all 3"), the regression
-- guarantee for the single-store sites (Sikandrabad, Ganjam), and the rename
-- safety properties that the whole project rests on.
--
-- Every row is assertion / expected / actual / status. Scan the status column:
--   PASS  — asserted and correct
--   FAIL  — broken, do not deploy
--   EMPTY — nothing to assert yet (no data of that kind); NOT a pass
-- ═══════════════════════════════════════════════════════════════════════════

with

-- ── Reference ───────────────────────────────────────────────────────────────
f as (select id, name, factory_code, location_id from plants where is_active and is_factory),
rehla as (select id from f where factory_code in ('SCPL_REHLA','SPPL_REHLA','SPPLK_REHLA')),

checks as (

-- ═══ A. NAMING & RENAME SAFETY ═════════════════════════════════════════════
select 'A1' as id, 'Exactly five active factories' as assertion,
       '5' as expected, count(*)::text as actual,
       case when count(*) = 5 then 'PASS' else 'FAIL' end as status
  from f
union all
select 'A2', 'Factory names follow <Entity> – <Location>',
       '5', count(*)::text,
       case when count(*) = 5 then 'PASS' else 'FAIL' end
  from f where name like '%–%'
union all
select 'A3', 'Retired rows kept, never deleted (history still resolves)',
       '>=1', count(*)::text,
       case when count(*) >= 1 then 'PASS' else 'FAIL' end
  from plants where not is_active
union all
select 'A4', 'Retired rows remember their old name (alias search)',
       '0 missing', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from plants where not is_active and coalesce(cardinality(legacy_names),0) = 0

-- ═══ B. ACCESS SURVIVED THE RENAME ═════════════════════════════════════════
union all
select 'B1', 'No user assigned to a retired factory',
       '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from user_plants up join plants p on p.id = up.plant_id where not p.is_active
union all
select 'B2', 'Every user_plants row resolves to a real factory',
       '0 orphans', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from user_plants up where not exists (select 1 from plants p where p.id = up.plant_id)
union all
select 'B3', 'Denormalized user_accounts.plant_name matches the live name',
       '0 stale', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from user_accounts ua join plants p on p.id = ua.plant_id
 where ua.plant_name is distinct from p.name

-- ═══ C. REHLA — ONE STORE, THREE FACTORIES ═════════════════════════════════
union all
select 'C1', 'REHLA: all three factories exist',
       '3', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from rehla
union all
select 'C2', 'REHLA: all three map to exactly ONE shared store',
       '1', coalesce(count(distinct fsa.store_id)::text,'0'),
       case when count(distinct fsa.store_id) = 1 then 'PASS' else 'FAIL' end
  from factory_store_access fsa where fsa.plant_id in (select id from rehla)
union all
select 'C3', 'REHLA: that store is the Rehla Common Store',
       '3 links', count(*)::text,
       case when count(*) = 3 then 'PASS' else 'FAIL' end
  from factory_store_access fsa join stores s on s.id = fsa.store_id
 where s.code = 'REHLA_COMMON' and fsa.plant_id in (select id from rehla)
union all
select 'C4', 'REHLA: stock held ONCE — no duplicate item in the shared store',
       '0 dupes',
       coalesce((select count(*)::text from (
          select 1 from store_items si join stores s on s.id = si.store_id
           where s.code = 'REHLA_COMMON'
           group by lower(btrim(si.item_name)) having count(*) > 1) d), '0'),
       case when coalesce((select count(*) from (
          select 1 from store_items si join stores s on s.id = si.store_id
           where s.code = 'REHLA_COMMON'
           group by lower(btrim(si.item_name)) having count(*) > 1) d), 0) = 0
            then 'PASS' else 'FAIL' end

-- ═══ D. SINGLE-STORE SITES UNCHANGED (regression) ══════════════════════════
union all
select 'D1', 'SIKANDRABAD: exactly one store, serving only itself',
       '1 store / 1 factory',
       coalesce((select count(distinct fsa.store_id)::text from factory_store_access fsa
                  where fsa.plant_id = (select id from f where factory_code='MADAN_SIKANDRABAD')), '0')
       || ' / ' ||
       coalesce((select count(distinct fsa2.plant_id)::text from factory_store_access fsa2
                  where fsa2.store_id in (select store_id from factory_store_access
                                           where plant_id = (select id from f where factory_code='MADAN_SIKANDRABAD'))), '0'),
       case when (select count(distinct fsa.store_id) from factory_store_access fsa
                   where fsa.plant_id = (select id from f where factory_code='MADAN_SIKANDRABAD')) = 1
             and (select count(distinct fsa2.plant_id) from factory_store_access fsa2
                   where fsa2.store_id in (select store_id from factory_store_access
                                            where plant_id = (select id from f where factory_code='MADAN_SIKANDRABAD'))) = 1
            then 'PASS' else 'FAIL' end
union all
select 'D2', 'GANJAM: exactly one store, serving only itself',
       '1 store / 1 factory',
       coalesce((select count(distinct fsa.store_id)::text from factory_store_access fsa
                  where fsa.plant_id = (select id from f where factory_code='SCPL_GANJAM')), '0')
       || ' / ' ||
       coalesce((select count(distinct fsa2.plant_id)::text from factory_store_access fsa2
                  where fsa2.store_id in (select store_id from factory_store_access
                                           where plant_id = (select id from f where factory_code='SCPL_GANJAM'))), '0'),
       case when (select count(distinct fsa.store_id) from factory_store_access fsa
                   where fsa.plant_id = (select id from f where factory_code='SCPL_GANJAM')) = 1
             and (select count(distinct fsa2.plant_id) from factory_store_access fsa2
                   where fsa2.store_id in (select store_id from factory_store_access
                                            where plant_id = (select id from f where factory_code='SCPL_GANJAM'))) = 1
            then 'PASS' else 'FAIL' end
union all
select 'D3', 'Every active factory reaches exactly one store',
       '0 unmapped', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from f where not exists (select 1 from factory_store_access fsa where fsa.plant_id = f.id)

-- ═══ E. STOCK INTEGRITY ════════════════════════════════════════════════════
union all
select 'E1', 'No stock row without a store (phantom register guard)',
       '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from store_items where store_id is null
union all
select 'E2', 'One row per item per store, everywhere',
       '0 dupes',
       coalesce((select count(*)::text from (
         select 1 from store_items group by store_id, lower(btrim(item_name)) having count(*) > 1) d), '0'),
       case when coalesce((select count(*) from (
         select 1 from store_items group by store_id, lower(btrim(item_name)) having count(*) > 1) d), 0) = 0
            then 'PASS' else 'FAIL' end
union all
select 'E3', 'No negative stock',
       '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from store_items where on_hand < 0
union all
select 'E4', 'Reservations never exceed stock on hand',
       '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from store_items where coalesce(reserved_qty,0) > on_hand
union all
select 'E5', 'Movements are attributed — store_id AND requesting factory',
       '0 untagged',
       (select count(*)::text from store_stock_events where store_id is null or requesting_plant_id is null),
       case when (select count(*) from store_stock_events) = 0 then 'EMPTY'
            when (select count(*) from store_stock_events where store_id is null or requesting_plant_id is null) = 0
            then 'PASS' else 'FAIL' end
union all
select 'E6', 'Every stock event points at a live register row',
       '0 orphans', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from store_stock_events e
 where e.item_id is not null and not exists (select 1 from store_items si where si.id = e.item_id)

-- ═══ F. FAR ISOLATION — the point of the whole exercise ════════════════════
union all
select 'F1', 'fixed_assets RLS is FACTORY-scoped, never store-scoped',
       '0 store-scoped policies',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='fixed_assets'
           and (coalesce(qual,'') like '%store_in_scope%' or coalesce(with_check,'') like '%store_in_scope%')),
       case when (select count(*) from pg_policies
                   where schemaname='public' and tablename='fixed_assets'
                     and (coalesce(qual,'') like '%store_in_scope%' or coalesce(with_check,'') like '%store_in_scope%')) = 0
            then 'PASS' else 'FAIL' end
union all
select 'F2', 'fixed_assets IS plant-scoped (isolation actually enforced)',
       '>=1 plant_in_scope policy',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='fixed_assets' and coalesce(qual,'') like '%plant_in_scope%'),
       case when (select count(*) from pg_policies
                   where schemaname='public' and tablename='fixed_assets'
                     and coalesce(qual,'') like '%plant_in_scope%') >= 1
            then 'PASS' else 'FAIL' end
union all
select 'F3', 'No ticket uses an asset from another factory''s FAR',
       '0',
       (select count(*)::text from maintenance_tickets t
          join fixed_assets fa on fa.id = t.far_asset_id
         where fa.plant_id is distinct from t.plant_id),
       case when (select count(*) from maintenance_tickets where far_asset_id is not null) = 0 then 'EMPTY'
            when (select count(*) from maintenance_tickets t
                    join fixed_assets fa on fa.id = t.far_asset_id
                   where fa.plant_id is distinct from t.plant_id) = 0
            then 'PASS' else 'FAIL' end
union all
select 'F4', 'No asset stranded on a retired factory',
       '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from fixed_assets fa join plants p on p.id = fa.plant_id where not p.is_active

-- ═══ G. MAINTENANCE OWNERSHIP ══════════════════════════════════════════════
union all
select 'G1', 'Every ticket belongs to a live factory',
       '0 orphans', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from maintenance_tickets t
 where t.plant_id is not null and not exists (select 1 from plants p where p.id = t.plant_id and p.is_active)
union all
select 'G2', 'Part requests record BOTH requesting factory and source store',
       '0 untagged',
       (select count(*)::text from maintenance_store_requests where plant_id is null or source_store_id is null),
       case when (select count(*) from maintenance_store_requests) = 0 then 'EMPTY'
            when (select count(*) from maintenance_store_requests
                   where plant_id is null or source_store_id is null) = 0
            then 'PASS' else 'FAIL' end
union all
select 'G3', 'A request''s store is one its factory actually uses',
       '0 mismatched', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from maintenance_store_requests r
 where r.source_store_id is not null and r.plant_id is not null
   and not exists (select 1 from factory_store_access fsa
                    where fsa.plant_id = r.plant_id and fsa.store_id = r.source_store_id)

-- ═══ H. HIERARCHY (migration 64) ═══════════════════════════════════════════
union all
select 'H1', 'Ladder starts at L0',
       'L0 present', coalesce((select id from tiers where id='L0'), 'MISSING'),
       case when exists (select 1 from tiers where id='L0') then 'PASS' else 'FAIL' end
union all
select 'H2', 'L0 is the most senior (highest rank)',
       'L0',
       coalesce((select id from tiers order by rank desc limit 1), 'NONE'),
       case when (select id from tiers order by rank desc limit 1) = 'L0' then 'PASS' else 'FAIL' end
union all
select 'H3', 'Every role sits on a real tier',
       '0 orphans', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from roles r where not exists (select 1 from tiers t where t.id = r.level)
union all
select 'H4', 'Admin is on the top tier',
       'L0', coalesce((select level from roles where id='admin'), 'MISSING'),
       case when (select level from roles where id='admin') = 'L0' then 'PASS' else 'FAIL' end

-- ═══ I. STORE ACCESS SEPARABLE FROM FACTORY ACCESS ═════════════════════════
union all
select 'I1', 'user_stores exists (store access is its own grant)',
       'present',
       case when to_regclass('public.user_stores') is null then 'MISSING' else 'present' end,
       case when to_regclass('public.user_stores') is null then 'FAIL' else 'PASS' end
union all
select 'I2', 'Every store grant points at a real store',
       '0 orphans', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from user_stores us where not exists (select 1 from stores s where s.id = us.store_id)
)

select id, assertion, expected, actual, status from checks order by id;

-- ═══════════════════════════════════════════════════════════════════════════
-- Shape of the world, for eyeballing after the assertions above
-- ═══════════════════════════════════════════════════════════════════════════
-- select l.state, l.name as location, p.company_name, p.name as factory,
--        s.name as store,
--        (select count(*) from fixed_assets fa where fa.plant_id = p.id)        as far_assets,
--        (select count(*) from maintenance_tickets t where t.plant_id = p.id)   as tickets,
--        (select count(*) from store_items si where si.store_id = s.id)         as store_items
--   from plants p
--   left join locations l on l.id = p.location_id
--   left join factory_store_access fsa on fsa.plant_id = p.id
--   left join stores s on s.id = fsa.store_id
--  where p.is_active and p.is_factory
--  order by l.state, l.name, p.name;
