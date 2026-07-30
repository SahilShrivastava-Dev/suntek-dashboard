/**
 * Client wrapper for the `admin-users` edge function.
 *
 * Provisioning a login requires the service_role key, which must never live in
 * the browser. All credential mutations therefore go through the edge function,
 * which verifies the caller is an admin before doing anything. The user's JWT is
 * attached automatically by supabase-js when a session exists.
 */
import { supabase } from './supabase';
import { rawErrorText } from './errors';

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
    // Edge function errors carry the real JSON body in error.context; the
    // top-level message is only ever "non-2xx status code".
    //
    // Everything is funnelled through rawErrorText so this ALWAYS returns a
    // string. It used to assign whatever `j.error` happened to be — and when
    // that was an object, the caller interpolated it into a toast and the user
    // saw "Login update failed: {}".
    let msg = rawErrorText(error);
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        const fromBody = rawErrorText(body?.error ?? body);
        if (fromBody) msg = fromBody;
      }
    } catch { /* body already consumed or not JSON — keep what we have */ }
    return { data: null, error: msg || 'The server rejected the request.' };
  }
  if (data && data.ok === false) {
    return { data: null, error: rawErrorText(data.error) || 'The server rejected the request.' };
  }
  return { data: data ?? null, error: null };
}

export function createLogin(input: CreateLoginInput) {
  return invoke({ action: 'create', ...input });
}

export function updateLogin(input: UpdateLoginInput) {
  return invoke({ action: 'update', ...input });
}

/**
 * Destroy the auth identity behind a deleted profile.
 *
 * Soft-deleting the directory row hides the person but leaves them signed in
 * (their JWT is valid until it expires), keeps their reset links and OTPs live,
 * and keeps their email claimed in auth.users — so a replacement account cannot
 * reuse that address. This is the call that actually revokes access.
 *
 * Idempotent server-side: an identity that has already gone returns ok.
 */
export function deleteLoginIdentity(auth_user_id: string, user_account_id?: string) {
  return invoke({ action: 'delete_identity', auth_user_id, user_account_id });
}

export function setLoginEnabled(auth_user_id: string, enabled: boolean, user_account_id?: string) {
  return invoke({ action: enabled ? 'enable' : 'disable', auth_user_id, user_account_id });
}
