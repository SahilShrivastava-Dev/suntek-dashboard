import React, { useState, useRef, useCallback } from 'react';
import { supabase } from './supabase';

/**
 * Step-up (re-authentication) for sensitive actions — e.g. unlocking a
 * privileged "special allowance" on a role. The user confirms their password;
 * on success it's cached for 5 minutes so they can perform several sensitive
 * actions in one session without re-typing.
 *
 * Usage:
 *   const { stepUp, modal } = useStepUp();
 *   ... render {modal} ...
 *   if (await stepUp()) { doSensitiveThing(); }
 */
const CACHE_MS = 5 * 60 * 1000;
let verifiedUntil = 0; // module-level so it survives re-mounts within the session

export function useStepUp() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const stepUp = useCallback((): Promise<boolean> => {
    if (Date.now() < verifiedUntil) return Promise.resolve(true); // still cached
    setPw(''); setError(null); setOpen(true);
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  function finish(ok: boolean) {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    r?.(ok);
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) { setError('No active session — please sign in again.'); return; }
      // Verify the current user's password by re-authenticating (same account).
      const { error: err } = await supabase.auth.signInWithPassword({ email: user.email, password: pw });
      if (err) { setError('Incorrect password. Please try again.'); return; }
      verifiedUntil = Date.now() + CACHE_MS;
      finish(true);
    } finally { setBusy(false); }
  }

  const modal = open ? (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={() => finish(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 380, background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>🔒 Confirm it's you</div>
        <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 4, lineHeight: 1.4 }}>
          Granting a special allowance is a privileged action. Re-enter your password to continue (cached for 5 minutes).
        </div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') finish(false); }}
          placeholder="Your password"
          style={{ width: '100%', marginTop: 14, padding: '10px 12px', fontSize: 14, border: '1.5px solid #E2E8F0', borderRadius: 10, outline: 'none', fontFamily: 'inherit' }}
        />
        {error && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => finish(false)}
            style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !pw}
            style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: '#0F172A', color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy || !pw ? 'not-allowed' : 'pointer', opacity: busy || !pw ? 0.5 : 1 }}
          >
            {busy ? 'Verifying…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { stepUp, modal };
}
