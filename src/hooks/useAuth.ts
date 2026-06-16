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



  async function signIn(email: string, password: string) {
    setState((s) => ({ ...s, loading: true, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email, password });
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
