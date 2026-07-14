import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  if (session === undefined) return null; // still resolving
  if (import.meta.env.PROD && !session) {
    // Remember where they were headed (e.g. a scanned /asset/<token>) so Login can
    // send them straight back after authenticating instead of to /dashboard.
    const to = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}
