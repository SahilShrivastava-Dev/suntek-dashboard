import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

/**
 * Gate for the standalone L1 shop-floor apps (Warehouse, Batch Logger, night
 * check-in). Phase 2b: these must run as a logged-in operator so their writes
 * are attributed + plant-scoped (RLS). In production, no session → redirect to
 * /login. In dev, the bypass is allowed (like the dashboard).
 */
export function RequireLogin({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  if (session === undefined) return null; // still resolving
  if (import.meta.env.PROD && !session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
