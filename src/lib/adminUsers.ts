/**
 * Client wrapper for the `admin-users` edge function.
 *
 * Provisioning a login requires the service_role key, which must never live in
 * the browser. All credential mutations therefore go through the edge function,
 * which verifies the caller is an admin before doing anything. The user's JWT is
 * attached automatically by supabase-js when a session exists.
 */
import { supabase } from './supabase';

export interface CreateLoginInput {
  user_account_id: string;
  email?: string | null; // optional — omit/empty to use a phone-only login
  password: string;
  name: string;
  role_id: string;
  plant_id?: string | null;
}

export interface UpdateLoginInput {
  auth_user_id: string;
  user_account_id?: string;
  email?: string;
  password?: string;
  name?: string;
  role_id?: string;
  plant_id?: string | null;
}

interface AdminUsersResult {
  ok: boolean;
  auth_user_id?: string;
  error?: string;
}

async function invoke(body: Record<string, unknown>): Promise<{ data: AdminUsersResult | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<AdminUsersResult>('admin-users', { body });
  if (error) {
    // Edge function errors carry the JSON body in error.context when available.
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch { /* ignore */ }
    return { data: null, error: msg };
  }
  if (data && data.ok === false) return { data: null, error: data.error ?? 'Request failed' };
  return { data: data ?? null, error: null };
}

export function createLogin(input: CreateLoginInput) {
  return invoke({ action: 'create', ...input });
}

export function updateLogin(input: UpdateLoginInput) {
  return invoke({ action: 'update', ...input });
}

export function setLoginEnabled(auth_user_id: string, enabled: boolean, user_account_id?: string) {
  return invoke({ action: enabled ? 'enable' : 'disable', auth_user_id, user_account_id });
}
