import { describe, it, expect } from 'vitest';
import {
  resolveItemOwner, buildItemOwnerMap, moduleLabel, IMPORT_MODULES,
  describeDeleteError, isBlockedError,
} from './batches';

const BATCH_A = 'batch-a';
const BATCH_B = 'batch-b';

describe('resolveItemOwner — which batch may DELETE a register row', () => {
  it('claims a brand-new item for the uploading batch', () => {
    const owners = buildItemOwnerMap([]);
    expect(resolveItemOwner(owners, 'BALL BEARING 6205', BATCH_A)).toBe(BATCH_A);
  });

  it('does NOT re-own an item created by an earlier upload', () => {
    // The regression that would break the feature's one guarantee: if this
    // returned BATCH_B, deleting B would delete rows that belong to A.
    const owners = buildItemOwnerMap([
      { item_name: 'BALL BEARING 6205', created_by_batch_id: BATCH_A },
    ]);
    expect(resolveItemOwner(owners, 'BALL BEARING 6205', BATCH_B)).toBe(BATCH_A);
  });

  it('leaves a manually created item unowned, so no deletion can reach it', () => {
    const owners = buildItemOwnerMap([
      { item_name: 'HAND-ADDED GASKET', created_by_batch_id: null },
    ]);
    expect(resolveItemOwner(owners, 'HAND-ADDED GASKET', BATCH_A)).toBeNull();
  });

  it('matches item names the way the SQL side does — case and space insensitive', () => {
    const owners = buildItemOwnerMap([
      { item_name: '  Ball Bearing 6205 ', created_by_batch_id: BATCH_A },
    ]);
    // A stray case or padding difference must not read as a NEW item; that would
    // hand an existing row to the wrong batch.
    expect(resolveItemOwner(owners, 'BALL BEARING 6205', BATCH_B)).toBe(BATCH_A);
    expect(resolveItemOwner(owners, 'ball bearing 6205', BATCH_B)).toBe(BATCH_A);
  });

  it('treats a genuinely different item as new even when names are similar', () => {
    const owners = buildItemOwnerMap([
      { item_name: 'BALL BEARING 6205', created_by_batch_id: BATCH_A },
    ]);
    expect(resolveItemOwner(owners, 'BALL BEARING 6206', BATCH_B)).toBe(BATCH_B);
  });

  it('is stable across a re-upload of the same file', () => {
    // First import claims the item…
    let owners = buildItemOwnerMap([]);
    const first = resolveItemOwner(owners, 'V-BELT B-52', BATCH_A);
    expect(first).toBe(BATCH_A);
    // …and re-uploading the corrected file for the same month leaves it with A,
    // so the row is not orphaned between two batches.
    owners = buildItemOwnerMap([{ item_name: 'V-BELT B-52', created_by_batch_id: first }]);
    expect(resolveItemOwner(owners, 'V-BELT B-52', BATCH_A)).toBe(BATCH_A);
  });
});

describe('module labels', () => {
  it('labels every module that has a real bulk importer', () => {
    for (const m of IMPORT_MODULES) {
      expect(moduleLabel(m.key)).toBe(m.label);
      expect(moduleLabel(m.key)).not.toBe(m.key);
    }
  });

  it('covers exactly the modules the SQL CHECK constraint allows', () => {
    // Purchase Orders and Store Requisitions are deliberately absent — neither
    // has a CSV/Excel importer, only single-document OCR. If one gains a real
    // importer, this list, the SQL CHECK and delete_import_batch() must all be
    // extended together.
    expect(IMPORT_MODULES.map(m => m.key).sort()).toEqual(['far', 'pm_schedule', 'stock']);
  });

  it('falls back to the raw key for an unknown module rather than rendering blank', () => {
    expect(moduleLabel('something_new')).toBe('something_new');
  });
});

describe('describeDeleteError — RPC exceptions an admin can act on', () => {
  it('explains a missing capability as a permissions problem', () => {
    const msg = describeDeleteError('forbidden: missing capability delete_import_batch');
    expect(msg).toMatch(/permission/i);
    expect(msg).toMatch(/administrator/i);
    expect(msg).not.toMatch(/forbidden:/);
  });

  it('explains an out-of-scope factory', () => {
    expect(describeDeleteError('forbidden: plant out of scope')).toMatch(/outside your access/i);
  });

  it('explains a double deletion', () => {
    expect(describeDeleteError('already_deleted: this upload has already been deleted'))
      .toMatch(/already been deleted/i);
  });

  it('asks for a reason when one is required', () => {
    expect(describeDeleteError('reason_required: forcing a blocked deletion requires a reason'))
      .toMatch(/reason/i);
  });

  it('points at the override flow when the deletion is blocked', () => {
    const msg = describeDeleteError('blocked: [{"kind":"stock_events","count":12}]');
    expect(msg).toMatch(/activity/i);
    // The raw JSON payload must not leak into the toast.
    expect(msg).not.toMatch(/stock_events/);
  });

  it('explains a stale list', () => {
    expect(describeDeleteError('unknown_batch: 0000')).toMatch(/no longer exists/i);
  });

  it('passes an unrecognised message through unchanged', () => {
    // Better a raw database message than a wrong explanation.
    expect(describeDeleteError('connection terminated unexpectedly'))
      .toBe('connection terminated unexpectedly');
  });
});

describe('isBlockedError', () => {
  it('distinguishes a blocker refusal from every other failure', () => {
    expect(isBlockedError('blocked: [{"kind":"adjusted_items"}]')).toBe(true);
    expect(isBlockedError('forbidden: missing capability delete_import_batch')).toBe(false);
    expect(isBlockedError('already_deleted: …')).toBe(false);
  });
});
