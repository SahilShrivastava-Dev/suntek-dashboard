import type { Database } from '../database.types';

type TicketRow = Database['public']['Tables']['maintenance_tickets']['Row'];

/** Units still awaiting return = sent − already returned. Legacy rows
 *  (pre-migration-55) have no columns yet → treat as 1 sent / 0 returned,
 *  matching the migration's defaults. */
export function repairPending(t: Pick<TicketRow, 'repair_qty' | 'repair_returned_qty'>): number {
  const sent = Number(t.repair_qty ?? 1);
  const ret = Number(t.repair_returned_qty ?? 0);
  return Math.max(0, sent - ret);
}
