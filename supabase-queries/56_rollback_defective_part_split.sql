-- ═══════════════════════════════════════════════════════════════════════════
-- 56_rollback_defective_part_split.sql — undo 56_defective_part_split.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- WARNING: this DISCARDS the per-part Repair/Scrap split. Tickets fall back to
-- one decision each, so a job that split 5 parts into 3 repair + 2 scrap loses
-- that detail permanently. Ticket-level repair counters are re-derived from the
-- part rows FIRST so migration 55's flows keep working afterwards.
--
-- Restores the 55-era functions? NO — re-run 55_repair_returns.sql after this
-- to reinstate the ticket-based apply_repair_return / reverse_repair_return.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Collapse the split back onto the ticket before dropping the detail.
update maintenance_tickets t
   set repair_qty          = greatest(d.rep, 1),   -- 55 requires > 0
       repair_returned_qty = d.ret,
       defective_part_decision = case when d.rep > 0 then 'repair' else 'scrap' end
  from (select ticket_id,
               sum(repair_qty)          as rep,
               sum(repair_returned_qty) as ret
          from maintenance_defective_parts group by ticket_id) d
 where d.ticket_id = t.id;

-- Any ticket left as 'mixed' must become a plain enum value again.
update maintenance_tickets set defective_part_decision = 'repair'
 where defective_part_decision = 'mixed';

-- 2) Drop the split model.
drop function if exists public.record_defective_disposition(jsonb);
alter table repair_return_allocations drop column if exists defective_part_id;
drop table if exists maintenance_defective_parts cascade;

-- 3) Restore 55's stricter ticket constraint.
alter table maintenance_tickets drop constraint if exists maintenance_tickets_repair_qty_check;
alter table maintenance_tickets add constraint maintenance_tickets_repair_qty_check
  check (repair_qty > 0);

notify pgrst, 'reload schema';
