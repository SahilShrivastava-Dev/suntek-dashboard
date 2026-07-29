import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rawErrorText, humanizeError } from './errors';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('rawErrorText — never yields "{}" or "[object Object]"', () => {
  it('reads an Error', () => {
    expect(rawErrorText(new Error('boom'))).toBe('boom');
  });

  it('reads a PostgREST-shaped object', () => {
    expect(rawErrorText({ message: 'duplicate key value', code: '23505' })).toBe('duplicate key value');
  });

  it('digs into a NESTED error object', () => {
    // An edge function forwarding a Postgres error verbatim.
    expect(rawErrorText({ error: { message: 'permission denied for table users' } }))
      .toBe('permission denied for table users');
  });

  it('falls back to the SQLSTATE when there is no text', () => {
    expect(rawErrorText({ code: '23505' })).toBe('Error 23505');
  });

  it('returns EMPTY for a useless object rather than "{}"', () => {
    // This is the exact shape that produced "Login update failed: {}".
    expect(rawErrorText({})).toBe('');
    expect(rawErrorText({ error: {} })).toBe('');
  });

  it('handles null / undefined / empty string', () => {
    expect(rawErrorText(null)).toBe('');
    expect(rawErrorText(undefined)).toBe('');
    expect(rawErrorText('')).toBe('');
  });
});

describe('humanizeError — the user gets a sentence, not a code', () => {
  it('never shows a bare object', () => {
    const msg = humanizeError({}, { action: 'update this login' });
    expect(msg).not.toContain('{}');
    expect(msg).not.toContain('[object Object]');
    expect(msg).toContain("Couldn't update this login");
  });

  it('gives a quotable reference when nothing is recognisable', () => {
    const msg = humanizeError({}, { action: 'update this login' });
    expect(msg).toMatch(/reference [0-9A-Z]{5}/);
  });

  it('explains a lost connection', () => {
    const msg = humanizeError(new Error('Failed to send a request to the Edge Function'), { action: 'save' });
    expect(msg).toMatch(/internet connection/i);
  });

  it('tells the user to sign in again when the session died', () => {
    expect(humanizeError({ message: 'JWT expired' })).toMatch(/sign in again/i);
  });

  it('names the conflicting field on a duplicate', () => {
    expect(humanizeError({ code: '23505', message: 'duplicate key value violates unique constraint "user_accounts_mobile_key"' }))
      .toMatch(/mobile number is already used/i);
    expect(humanizeError({ message: 'A user with this email address has already been registered' }))
      .toMatch(/email address is already in use/i);
  });

  it('explains a permission failure without jargon', () => {
    const msg = humanizeError({ code: '42501', message: 'new row violates row-level security policy' }, { action: 'save this ticket' });
    expect(msg).toMatch(/don't have permission/i);
    expect(msg).not.toMatch(/row-level security/i);
  });

  it('translates a negative-stock check into what to do', () => {
    expect(humanizeError({ code: '23514', message: 'violates check constraint "store_items_on_hand_nonneg"' }))
      .toMatch(/below zero/i);
  });

  it('flags an unapplied migration as an admin problem', () => {
    expect(humanizeError({ code: '42703', message: 'column store_items.store_id does not exist' }))
      .toMatch(/database update that hasn't been applied/i);
  });

  it('passes through messages the backend already wrote for humans', () => {
    const forbidden = 'Forbidden — you cannot assign that role (it is above your level).';
    expect(humanizeError(forbidden)).toBe(forbidden);
    expect(humanizeError('Password must be at least 8 characters')).toBe('Password must be at least 8 characters');
  });

  it('shows a short unmapped message rather than hiding it', () => {
    expect(humanizeError('Vendor name is required', { action: 'save the purchase' }))
      .toBe("Couldn't save the purchase: Vendor name is required");
  });

  it('hides an overlong or JSON-ish blob behind the friendly fallback', () => {
    const blob = '{"hint":null,"details":' + 'x'.repeat(200) + '}';
    const msg = humanizeError(blob, { action: 'save' });
    expect(msg).not.toContain('xxxx');
    expect(msg).toMatch(/unexpected error/i);
  });

  it('still logs the technical detail for support', () => {
    const spy = vi.spyOn(console, 'error');
    humanizeError({ message: 'boom' }, { context: 'UserManagement.updateLogin' });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('UserManagement.updateLogin');
  });
});
