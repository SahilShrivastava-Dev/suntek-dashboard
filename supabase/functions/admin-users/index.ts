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
 *    user. That user must hold the `manage_users` capability (Admin implicitly
 *    does). Anyone else is rejected.
 *  - A delegate (manage_users but not admin) can only assign roles at/below their
 *    own tier that grant no capability they lack (see canAssignRole).
 *  - Only then do we use the service_role client to mutate auth.users / profiles.
 *
 * POST body (JSON):
 *   { action: 'create',
 *     user_account_id, password, name, role_id, email?, plant_id? }
 *     // email optional — if absent or already taken, a synthetic unique auth
 *     // email is used and the login is reached by phone instead.
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
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: callerUser, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerUser?.user) {
    return json({ error: 'Invalid or expired session' }, 401);
  }

  // The caller must hold the `manage_users` capability (Admin implicitly does).
  // Resolved with the service_role client so RLS can't be used to spoof it.
  const caller = await resolveCaller(admin, callerUser.user.id);
  if (!caller.caps.has('manage_users')) {
    return json({ error: 'Forbidden — you do not have permission to manage users' }, 403);
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
        return await handleCreate(admin, body, caller);
      case 'update':
        return await handleUpdate(admin, body, caller);
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

/** The authorization profile of the caller: their capabilities + seniority. */
type Caller = { isAdmin: boolean; caps: Set<string>; maxRank: number };

/**
 * Resolve the caller's capabilities across ALL their roles (multi-role via
 * user_roles + primary user_accounts.role_id + bootstrap owner via profiles) and
 * their most-senior tier rank. Admin implicitly holds every capability.
 */
async function resolveCaller(admin: Admin, uid: string): Promise<Caller> {
  const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle();
  let isAdmin = prof?.role === 'admin';

  const { data: acct } = await admin
    .from('user_accounts').select('id, role_id').eq('auth_user_id', uid).maybeSingle();

  const roleIds = new Set<string>();
  if (acct?.role_id) roleIds.add(acct.role_id);
  if (acct?.id) {
    const { data: urs } = await admin.from('user_roles').select('role_id').eq('user_account_id', acct.id);
    for (const r of urs ?? []) roleIds.add(r.role_id);
  }

  const caps = new Set<string>();
  let maxRank = 0;
  if (roleIds.size) {
    const { data: roleRows } = await admin
      .from('roles').select('id, is_admin, capabilities, level').in('id', [...roleIds]);
    const levels: string[] = [];
    for (const r of roleRows ?? []) {
      if (r.is_admin) isAdmin = true;
      for (const c of r.capabilities ?? []) caps.add(c);
      if (r.level) levels.push(r.level);
    }
    if (levels.length) {
      const { data: tierRows } = await admin.from('tiers').select('rank').in('id', levels);
      maxRank = Math.max(0, ...(tierRows ?? []).map((t: { rank: number }) => t.rank));
    }
  }
  if (isAdmin) { caps.add('manage_users'); caps.add('manage_roles'); maxRank = Number.MAX_SAFE_INTEGER; }
  return { isAdmin, caps, maxRank };
}

/**
 * Delegation guard: can the caller assign `roleId` to a user? Admin can assign
 * anything. A delegate can only assign a role that is (a) not the admin role,
 * (b) at or below their own tier, and (c) grants no capability the caller lacks
 * — so a delegate can never escalate someone above themselves.
 */
async function canAssignRole(admin: Admin, caller: Caller, roleId: string): Promise<boolean> {
  if (caller.isAdmin) return true;
  const { data: r } = await admin
    .from('roles').select('is_admin, capabilities, level').eq('id', roleId).maybeSingle();
  if (!r || r.is_admin) return false;
  for (const c of r.capabilities ?? []) if (!caller.caps.has(c)) return false;
  const { data: t } = await admin.from('tiers').select('rank').eq('id', r.level).maybeSingle();
  return (t?.rank ?? 0) <= caller.maxRank;
}

function requireStr(v: unknown, field: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error(`Missing required field: ${field}`);
  return s;
}

/** True when createUser/updateUser failed because the email is already taken. */
function isDuplicateEmail(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const code = (err.code ?? '').toLowerCase();
  if (code === 'email_exists') return true;
  return /already.*(regist|exist)|duplicate|email.*taken/i.test(err.message ?? '');
}

/**
 * Create a new auth login + profiles row, and link it back to the directory row.
 *
 * The login can be identified by email OR phone. Since auth.users.email must be
 * globally unique, we register the REAL email as the auth email only when it's
 * free; otherwise (shared or absent email) we register a synthetic unique address
 * derived from the directory row id. Either way the resolved auth email is stored
 * on user_accounts.login_email — that's what the login flow signs in with.
 */
async function handleCreate(admin: Admin, body: Record<string, unknown>, caller: Caller) {
  const password = requireStr(body.password, 'password');
  const role_id = requireStr(body.role_id, 'role_id');
  if (!(await canAssignRole(admin, caller, role_id))) {
    return json({ error: 'Forbidden — you cannot assign that role (it is above your level or grants powers you don’t have).' }, 403);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const plant_id = (body.plant_id as string) || null;
  const user_account_id = requireStr(body.user_account_id, 'user_account_id');
  const realEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  // The synthetic fallback is stable + unique because the directory row id is.
  const syntheticEmail = `u-${user_account_id}@login.suntek.local`;
  const opts = { password, email_confirm: true, user_metadata: { name, role_id } };

  // Try the real email first; on a uniqueness clash (shared email), fall back to
  // the synthetic address so the account still gets a working login.
  let authEmail = realEmail;
  let created: { user?: { id: string } } | null = null;
  if (realEmail) {
    const r = await admin.auth.admin.createUser({ email: realEmail, ...opts });
    if (r.error) {
      if (!isDuplicateEmail(r.error)) return json({ error: r.error.message }, 400);
      authEmail = ''; // clash → use synthetic below
    } else {
      created = r.data;
    }
  }
  if (!created) {
    authEmail = syntheticEmail;
    const r = await admin.auth.admin.createUser({ email: syntheticEmail, ...opts });
    if (r.error || !r.data?.user) {
      return json({ error: r.error?.message ?? 'Failed to create auth user' }, 400);
    }
    created = r.data;
  }
  const authId = created!.user!.id;

  // profiles row is the source of truth for RoleContext lock-to-role.
  const { error: profErr } = await admin
    .from('profiles')
    .upsert({ id: authId, name, role: role_id, plant_id }, { onConflict: 'id' });
  if (profErr) {
    // Roll back the auth user so we don't leave an orphan login.
    await admin.auth.admin.deleteUser(authId);
    return json({ error: `Profile link failed: ${profErr.message}` }, 500);
  }

  // Link the directory row to the new login. login_email is the auth identity we
  // sign in with; the real email/phone stay as the client wrote them.
  await admin
    .from('user_accounts')
    .update({ auth_user_id: authId, login_email: authEmail, login_enabled: true })
    .eq('id', user_account_id);

  return json({ ok: true, auth_user_id: authId, login_email: authEmail });
}

/** Update an existing login: email / password / role / plant. */
async function handleUpdate(admin: Admin, body: Record<string, unknown>, caller: Caller) {
  const authId = requireStr(body.auth_user_id, 'auth_user_id');
  const user_account_id = typeof body.user_account_id === 'string' ? body.user_account_id : '';
  if (typeof body.role_id === 'string' && body.role_id && !(await canAssignRole(admin, caller, body.role_id))) {
    return json({ error: 'Forbidden — you cannot assign that role (it is above your level or grants powers you don’t have).' }, 403);
  }

  // Password change (kept independent of email so it always applies).
  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400);
    }
    const { error } = await admin.auth.admin.updateUserById(authId, { password: body.password });
    if (error) return json({ error: error.message }, 400);
  }

  // Email change: point the auth login at the new real email when it's free; if
  // it clashes (shared email) we leave the current auth email untouched — login
  // by phone still works, and the real (shared) email lives on user_accounts.
  if (typeof body.email === 'string' && body.email.trim()) {
    const nextEmail = body.email.trim().toLowerCase();
    const { error } = await admin.auth.admin.updateUserById(authId, { email: nextEmail });
    if (error && !isDuplicateEmail(error)) return json({ error: error.message }, 400);
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

  // Sync login_email to whatever the auth login actually resolved to.
  if (user_account_id) {
    const { data: fresh } = await admin.auth.admin.getUserById(authId);
    if (fresh?.user?.email) {
      await admin
        .from('user_accounts')
        .update({ login_email: fresh.user.email })
        .eq('id', user_account_id);
    }
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
