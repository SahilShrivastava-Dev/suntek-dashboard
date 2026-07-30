/**
 * Upload batches — the client half of migration 70.
 *
 * Every bulk CSV/Excel import registers a batch FIRST, then stamps
 * `import_batch_id` on the rows it writes. That stamp is the only thing that
 * makes an incorrect upload reversible, and the only thing that keeps a
 * hand-entered record safe from a file deletion: rows with no batch id cannot
 * be reached by any deletion, by construction rather than by care.
 *
 * The three importers (FAR, Stock Register, PM Schedules) and the admin Upload
 * History screen all go through here, so "what is a batch" is one decision
 * instead of three that drift.
 *
 * Deletion is NOT done from the client. It runs in delete_import_batch(), a
 * SECURITY DEFINER RPC, because it has to check a capability, count rows,
 * refuse when a stock register has live movements against it, roll baselines
 * back and write an audit row — atomically. A client-side loop of DELETEs could
 * do none of those things safely.
 */
import { supabase } from '../supabase';
import { insertRows, callRpc } from '../db';

/** Modules with a real bulk importer. Mirrors the CHECK on import_batches.module.
 *
 *  Purchase Orders and Store Requisitions are absent on purpose: both capture
 *  one document at a time via OCR and have no CSV/Excel import, so they would
 *  only ever show an empty Upload History. Add them here, to the SQL CHECK, and
 *  to the dispatch in delete_import_batch() together — never one alone. */
export type ImportModule = 'far' | 'stock' | 'pm_schedule';

export const IMPORT_MODULES: { key: ImportModule; label: string }[] = [
  { key: 'far',         label: 'Fixed Asset Register' },
  { key: 'stock',       label: 'Stock Register' },
  { key: 'pm_schedule', label: 'Maintenance Schedules' },
];

export function moduleLabel(m: string): string {
  return IMPORT_MODULES.find(x => x.key === m)?.label ?? m;
}

export interface ImportBatchRow {
  id: string;
  module: ImportModule;
  plant_id: string | null;
  store_id: string | null;
  file_name: string | null;
  file_url: string | null;
  period_month: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  row_count: number;
  sheet_count: number;
  notes: string | null;
  status: 'active' | 'deleted';
  created_at: string;
}

/** One reason a deletion is not safe to do silently. Not a hard refusal — an
 *  admin may override it, with a reason, which the audit row records. */
export interface BatchBlocker {
  kind: string;
  count: number;
  detail: string;
}

export interface BatchPreview {
  batch_id: string;
  module: string;
  file_name: string | null;
  status: string;
  /** Per-table row counts. */
  counts: Record<string, number>;
  /** The number shown in the confirmation dialog. */
  total: number;
  blockers: BatchBlocker[];
  can_delete: boolean;
}

export interface NewImportBatch {
  module: ImportModule;
  plantId: string | null;
  /** Stock only — which register the workbook belongs to. */
  storeId?: string | null;
  fileName: string;
  /** Cloudinary archive of the raw file, when the upload succeeded. */
  fileUrl?: string | null;
  /** Stock only — first day of the month the file covers. */
  periodMonth?: string | null;
  rowCount: number;
  sheetCount?: number;
  uploadedByName: string;
  notes?: string | null;
}

/**
 * Register a batch and return its id.
 *
 * Call this BEFORE writing any rows, so the id exists to stamp them with. If
 * the row insert then fails, an empty batch is left behind — deliberately.
 * An empty batch is visible in Upload History and deletable in one click, which
 * is a far better failure mode than rows in the database that belong to no file
 * and can never be removed.
 */
export async function createImportBatch(b: NewImportBatch): Promise<string> {
  const { data, error } = await insertRows('import_batches', {
    module: b.module,
    plant_id: b.plantId,
    store_id: b.storeId ?? null,
    file_name: b.fileName,
    file_url: b.fileUrl ?? null,
    period_month: b.periodMonth ?? null,
    uploaded_by: null,
    uploaded_by_name: b.uploadedByName,
    row_count: b.rowCount,
    sheet_count: b.sheetCount ?? 0,
    notes: b.notes ?? null,
  }).select('id').single();
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error('Could not register the upload batch.');
  return id;
}

/** Correct a batch's row count after the fact — the importer only knows how many
 *  rows actually landed once it has finished chunking them in. */
export async function setImportBatchRowCount(batchId: string, rowCount: number): Promise<void> {
  await (supabase.from('import_batches') as unknown as {
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<unknown> };
  }).update({ row_count: rowCount }).eq('id', batchId);
}

/**
 * What would deleting this batch remove, and is anything in the way?
 *
 * Read-only. The count it returns is the SAME expression the deletion uses, so
 * the number in the confirmation dialog cannot disagree with the number that is
 * actually deleted.
 */
export async function previewImportBatch(batchId: string): Promise<BatchPreview> {
  const { data, error } = await callRpc<BatchPreview>('preview_import_batch', { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No preview returned for this upload.');
  return data;
}

export interface DeleteResult {
  ok: boolean;
  batches: number;
  deleted_count: number;
}

/**
 * Delete one or more batches — a single upload, a multi-select, or everything
 * under the admin's current filters. All three are the same call with a
 * different-length list.
 *
 * One transaction, all or nothing: deleting three files and failing on the
 * fourth would leave the admin unsure which had gone.
 *
 * `force` overrides the blockers preview reported. `reason` is required when
 * forcing — it is the one thing the audit row cannot reconstruct on its own.
 */
export async function deleteImportBatches(
  ids: string[],
  opts?: { force?: boolean; reason?: string },
): Promise<DeleteResult> {
  if (!ids.length) throw new Error('Nothing selected.');
  const { data, error } = await callRpc<DeleteResult>('delete_import_batches', {
    p_ids: ids,
    p_force: opts?.force ?? false,
    p_reason: opts?.reason ?? null,
  });
  if (error) throw new Error(describeDeleteError(error.message));
  return data ?? { ok: true, batches: ids.length, deleted_count: 0 };
}

/**
 * Turn the RPC's machine-readable exceptions into something an admin can act on.
 *
 * The RPC raises tagged messages (`blocked: [...]`, `reason_required: …`) so the
 * client can branch on them; shown raw they read as Postgres noise, which is
 * the same problem `lib/errors.ts` solves for schema drift.
 */
export function describeDeleteError(message: string): string {
  if (message.includes('missing capability delete_import_batch')) {
    return 'You do not have permission to delete uploaded data. This is restricted to administrators.';
  }
  if (message.includes('plant out of scope')) {
    return 'That upload belongs to a factory outside your access.';
  }
  if (message.startsWith('already_deleted') || message.includes('already_deleted')) {
    return 'This upload has already been deleted.';
  }
  if (message.includes('reason_required')) {
    return 'Give a reason — you are overriding a safety check.';
  }
  if (message.includes('unknown_batch')) {
    return 'That upload no longer exists. Refresh the list.';
  }
  if (message.startsWith('blocked:') || message.includes('blocked:')) {
    return 'This upload has activity recorded against it. Review the warnings and confirm the override to continue.';
  }
  return message;
}

/** Did the RPC refuse because of blockers (rather than fail for another reason)? */
export function isBlockedError(message: string): boolean {
  return message.includes('blocked:');
}

/**
 * Who "owns" a stock register row after an upload — i.e. which batch may delete
 * it, as opposed to merely rolling its baseline back.
 *
 * This is the subtlest decision in the whole feature, and the one with the worst
 * failure mode. A stock upload UPSERTS store_items on (store_id, item_name): it
 * CREATES rows for items the register did not have, and only re-baselines rows
 * that were already there. Deleting a batch must therefore:
 *   • delete the rows it created                     → created_by_batch_id = it
 *   • roll the baseline back on rows it re-baselined  → owner unchanged
 *
 * Because the upsert writes every column it is given, stamping
 * created_by_batch_id unconditionally would silently RE-OWN rows created by an
 * earlier file — and deleting this batch would then delete that file's rows too,
 * breaking the one guarantee the feature makes ("only rows from that file").
 * Hence: new items get this batch, existing items keep whatever they had,
 * including null for a row created by a purchase or by hand.
 *
 * Item names are matched case- and whitespace-insensitively, the same way the
 * SQL side compares them (`lower(btrim(item_name))`).
 */
export function resolveItemOwner(
  existingOwners: Map<string, string | null>,
  itemName: string,
  batchId: string,
): string | null {
  const key = itemName.trim().toLowerCase();
  if (!existingOwners.has(key)) return batchId; // new item → this batch created it
  return existingOwners.get(key) ?? null;        // pre-existing → owner is unchanged
}

/** Build the lookup resolveItemOwner() expects from the rows already in a store. */
export function buildItemOwnerMap(
  rows: { item_name: string; created_by_batch_id: string | null }[],
): Map<string, string | null> {
  return new Map(rows.map(r => [r.item_name.trim().toLowerCase(), r.created_by_batch_id]));
}
