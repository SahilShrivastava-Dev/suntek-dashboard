import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../lib/database.types';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthUser {
  id: string;
  email: string | undefined;
  name: string;
  role: UserRole;
  plantId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  });

  async function fetchProfile(authUser: User, session: Session) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .limit(1)
      .returns<{ name: string; role: string; plant_id: string | null }[]>();

    const profile = data?.[0];

    if (error || !profile) {
      // Authenticated but no profile row — FAIL CLOSED: grant the lowest
      // privilege (L1), never admin. A missing profile is a misconfiguration,
      // not a reason to hand out full access.
      setState({
        user: {
          id: authUser.id,
          email: authUser.email,
          name: authUser.email?.split('@')[0] ?? 'User',
          role: 'L1',
          plantId: null,
        },
        session,
        loading: false,
        error: null,
      });
      return;
    }

    setState({
      user: {
        id: authUser.id,
        email: authUser.email,
        name: profile.name,
        role: profile.role as UserRole,
        plantId: profile.plant_id,
      },
      session,
      loading: false,
      error: null,
    });
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchProfile(session.user, session);
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          fetchProfile(session.user, session);
        } else {
          setState({ user: null, session: null, loading: false, error: null });
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);



  /**
   * Sign in with EITHER an email or a phone number, plus password.
   *
   * Supabase authenticates on a unique email, so we first resolve the typed
   * identifier to the account's `login_email` (the exact email registered in
   * auth.users) via the user_accounts directory, then sign in with that:
   *   • phone  → matched on the normalized number (unique) → one account.
   *   • email  → matched on the real email; if it's shared across accounts the
   *              match is ambiguous, so we ask the user to use their phone.
   * Falls back to signing in with the raw identifier when no directory row
   * resolves (e.g. the bootstrap admin created directly in auth).
   */
  async function signIn(identifier: string, password: string) {
    setState((s) => ({ ...s, loading: true, error: null }));

    const id = identifier.trim();
    const isEmail = id.includes('@');
    let authEmail = id; // default: try the identifier as-is (bootstrap admin)

    // Only rows with a provisioned login (auth_user_id) count. We filter that in
    // JS rather than a .not() DB filter to keep the query on the same typed path
    // the rest of the app uses.
    type LoginRow = { login_email: string | null; email: string | null; auth_user_id: string | null };

    if (isEmail) {
      const { data } = await supabase
        .from('user_accounts')
        .select('login_email, email, auth_user_id')
        .eq('email', id.toLowerCase())
        .returns<LoginRow[]>();
      const rows = (data ?? []).filter((r) => r.auth_user_id);
      if (rows.length > 1) {
        setState((s) => ({ ...s, loading: false, error: 'This email is used by more than one account. Please log in with your phone number instead.' }));
        return false;
      }
      if (rows.length === 1) authEmail = rows[0].login_email || rows[0].email || id;
    } else {
      // Phone: normalize to the last 10 digits to match user_accounts.mobile_norm.
      const norm = id.replace(/\D/g, '').slice(-10);
      if (!norm) {
        setState((s) => ({ ...s, loading: false, error: 'Enter a valid email or phone number.' }));
        return false;
      }
      const { data } = await supabase
        .from('user_accounts')
        .select('login_email, email, auth_user_id')
        .eq('mobile_norm', norm)
        .returns<LoginRow[]>();
      const row = (data ?? []).find((r) => r.auth_user_id);
      if (!row || !(row.login_email || row.email)) {
        setState((s) => ({ ...s, loading: false, error: 'No login found for that phone number.' }));
        return false;
      }
      authEmail = row.login_email || row.email!;
    }

    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
    if (error) {
      setState((s) => ({ ...s, loading: false, error: error.message }));
      return false;
    }
    return true;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { ...state, signIn, signOut };
}
