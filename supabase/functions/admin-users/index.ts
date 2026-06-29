/**
 * Supabase Edge Function: admin-users
 *
 * Privileged user-provisioning endpoint. Creates / updates real Supabase auth
 * logins on behalf of an ADMIN, using the service_role key (which must NEVER be
 * exposed to the browser). The frontend (UserManagement) calls this instead of
 * touching auth.users directly.
 *
 * Security model:
 *  - The caller's JWT is read from the Authorization header and resolved to a
 *    user. That user must have profiles.role = 'admin'. Anyone else is rejected.
 *  - Only then do we use the service_role client to mutate auth.users / profiles.
 *
 * POST body (JSON):
 *   { action: 'create',
 *     user_account_id, email, password, name, role_id, plant_id? }
 *   { action: 'update',
 *     auth_user_id, email?, password?, name?, role_id?, plant_id? }
 *   { action: 'disable' | 'enable', auth_user_id }   // bans / unbans the login
 *
 * → 200 { ok: true, auth_user_id }   |   4xx/5xx { error }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // service_role client — full access, used for all privileged mutations.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Authenticate + authorize the caller ──────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Missing Authorization bearer token' }, 401);

  // Resolve the JWT to a user using a request-scoped anon client.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerUser, error: callerErr } = await caller.auth.getUser();
  if (callerErr || !callerUser?.user) {
    return json({ error: 'Invalid or expired session' }, 401);
  }

  // The caller must be an admin (checked with the service_role client so RLS
  // can't be used to spoof the role).
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerUser.user.id)
    .maybeSingle();
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Forbidden — admin role required' }, 403);
  }

  // ── 2. Parse + dispatch ──────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const action = String(body.action ?? '');

  try {
    switch (action) {
      case 'create':
        return await handleCreate(admin, body);
      case 'update':
        return await handleUpdate(admin, body);
      case 'disable':
        return await handleBan(admin, body, true);
      case 'enable':
        return await handleBan(admin, body, false);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
type Admin = any;

function requireStr(v: unknown, field: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error(`Missing required field: ${field}`);
  return s;
}

/** Create a new auth login + profiles row, and link it back to the directory row. */
async function handleCreate(admin: Admin, body: Record<string, unknown>) {
  const email = requireStr(body.email, 'email').toLowerCase();
  const password = requireStr(body.password, 'password');
  const role_id = requireStr(body.role_id, 'role_id');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const plant_id = (body.plant_id as string) || null;
  const user_account_id = (body.user_account_id as string) || null;

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  // Auto-confirm so the admin-set password works for first login immediately.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role_id },
  });
  if (createErr || !created?.user) {
    return json({ error: createErr?.message ?? 'Failed to create auth user' }, 400);
  }
  const authId = created.user.id;

  // profiles row is the source of truth for RoleContext lock-to-role.
  const { error: profErr } = await admin
    .from('profiles')
    .upsert({ id: authId, name, role: role_id, plant_id }, { onConflict: 'id' });
  if (profErr) {
    // Roll back the auth user so we don't leave an orphan login.
    await admin.auth.admin.deleteUser(authId);
    return json({ error: `Profile link failed: ${profErr.message}` }, 500);
  }

  // Link the directory row (if one was passed) to the new login.
  if (user_account_id) {
    await admin
      .from('user_accounts')
      .update({ auth_user_id: authId, email, login_enabled: true })
      .eq('id', user_account_id);
  }

  return json({ ok: true, auth_user_id: authId });
}

/** Update an existing login: email / password / role / plant. */
async function handleUpdate(admin: Admin, body: Record<string, unknown>) {
  const authId = requireStr(body.auth_user_id, 'auth_user_id');

  const authPatch: Record<string, unknown> = {};
  if (typeof body.email === 'string' && body.email.trim()) {
    authPatch.email = body.email.trim().toLowerCase();
  }
  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400);
    }
    authPatch.password = body.password;
  }
  if (Object.keys(authPatch).length) {
    const { error } = await admin.auth.admin.updateUserById(authId, authPatch);
    if (error) return json({ error: error.message }, 400);
  }

  // Keep profiles in sync (role / plant / name drive access + display).
  const profPatch: Record<string, unknown> = {};
  if (typeof body.name === 'string') profPatch.name = body.name.trim();
  if (typeof body.role_id === 'string' && body.role_id) profPatch.role = body.role_id;
  if ('plant_id' in body) profPatch.plant_id = (body.plant_id as string) || null;
  if (Object.keys(profPatch).length) {
    profPatch.id = authId;
    await admin.from('profiles').upsert(profPatch, { onConflict: 'id' });
  }

  // Reflect a new email on the directory row too.
  if (authPatch.email && typeof body.user_account_id === 'string' && body.user_account_id) {
    await admin
      .from('user_accounts')
      .update({ email: authPatch.email })
      .eq('id', body.user_account_id);
  }

  return json({ ok: true, auth_user_id: authId });
}

/** Ban (disable) or unban (enable) a login without deleting it. */
async function handleBan(admin: Admin, body: Record<string, unknown>, ban: boolean) {
  const authId = requireStr(body.auth_user_id, 'auth_user_id');
  const { error } = await admin.auth.admin.updateUserById(authId, {
    ban_duration: ban ? '876000h' : 'none', // ~100 years = effectively disabled
  });
  if (error) return json({ error: error.message }, 400);
  if (typeof body.user_account_id === 'string' && body.user_account_id) {
    await admin
      .from('user_accounts')
      .update({ login_enabled: !ban })
      .eq('id', body.user_account_id);
  }
  return json({ ok: true, auth_user_id: authId });
}
