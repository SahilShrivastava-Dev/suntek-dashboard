import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { updateRows } from '../lib/db';
import { useToast } from './ui/toast';
import { useRoleContext } from '../contexts/RoleContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { LANGUAGE_OPTIONS, logUserAccountEvent } from '../lib/userEvents';

/**
 * Centered self-service settings modal, opened from the avatar dropdown.
 * A user can change their display name, preferred language, and own password.
 * Every save notifies the admin and is recorded in user_account_events so the
 * admin's History panel shows who changed what. The admin can still overwrite
 * these from User Management.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { authProfile } = useRoleContext();
  const { addNotification } = useNotifications();

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userAccountId, setUserAccountId] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState('en');
  const [origName, setOrigName] = useState('');
  const [origLang, setOrigLang] = useState('en');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  // Load the logged-in user's current values when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      setAuthUserId(user.id);
      setEmail(user.email ?? null);

      const { data: prof } = await supabase
        .from('profiles').select('name, preferred_language').eq('id', user.id)
        .maybeSingle().returns<{ name: string | null; preferred_language: string | null }>();
      const { data: acct } = await supabase
        .from('user_accounts').select('id, name, preferred_language').eq('auth_user_id', user.id)
        .maybeSingle().returns<{ id: string; name: string | null; preferred_language: string | null }>();
      if (cancelled) return;

      const name = prof?.name || acct?.name || authProfile?.name || '';
      const lang = prof?.preferred_language || acct?.preferred_language || 'en';
      setDisplayName(name); setOrigName(name);
      setLanguage(lang); setOrigLang(lang);
      setUserAccountId(acct?.id ?? null);
      setPassword(''); setConfirm('');
    })();
    return () => { cancelled = true; };
  }, [open, authProfile?.name]);

  if (!open) return null;

  async function handleSave() {
    if (!authUserId) { toast.error('No active session — sign in again'); return; }
    if (!displayName.trim()) { toast.error('Display name cannot be empty'); return; }
    if (password) {
      if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
      if (password !== confirm) { toast.error('Passwords do not match'); return; }
    }
    setSaving(true);

    const changes: string[] = [];
    if (displayName.trim() !== origName) changes.push(`name → "${displayName.trim()}"`);
    if (language !== origLang) changes.push(`language → ${LANGUAGE_OPTIONS.find(l => l.value === language)?.label ?? language}`);
    if (password) changes.push('password reset');

    // 1) profiles (the login row — always present for a logged-in user)
    const { error: pErr } = await updateRows('profiles', {
      name: displayName.trim(), preferred_language: language,
    }).eq('id', authUserId);
    if (pErr) { toast.error(`Save failed: ${pErr.message}`); setSaving(false); return; }

    // 2) user_accounts directory row, if this login is linked to one
    if (userAccountId) {
      await updateRows('user_accounts', {
        name: displayName.trim(), preferred_language: language,
      }).eq('id', userAccountId);
    }

    // 3) password — self-service via the user's own session (no service role)
    if (password) {
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) { toast.error(`Password change failed: ${pwErr.message}`); setSaving(false); return; }
    }

    if (changes.length === 0) { toast.info('No changes to save'); setSaving(false); onClose(); return; }

    const summary = changes.join(', ');
    // Notify admin + write to history
    await addNotification({
      target_roles: ['admin'],
      title: `${displayName.trim()} updated their profile`,
      body: summary,
      type: 'info',
      route: '/dashboard/users',
      actor_name: displayName.trim(),
      actor_role: authProfile?.roleLabel ?? null,
    });
    await logUserAccountEvent({
      userAccountId, targetName: displayName.trim(), targetEmail: email,
      action: 'self_update', details: summary,
      actorName: displayName.trim(), actorRole: authProfile?.id ?? null,
    });

    toast.success('Settings saved');
    setSaving(false);
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>Settings</div>
            <div style={{ fontSize: 12, color: '#94A3B8' }}>{email || 'Your account'} · {authProfile?.roleLabel}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: '#F1F5F9', cursor: 'pointer', color: '#64748B', fontSize: 16 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Display name">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} placeholder="Your name" />
          </Field>

          <Field label="Preferred language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...inputStyle, background: '#fff' }}>
              {LANGUAGE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>Stored as your preference. (Interface stays in English for now.)</div>
          </Field>

          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Change password</div>
            <Field label="New password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="Leave blank to keep current" />
            </Field>
            {password && (
              <div style={{ marginTop: 10 }}>
                <Field label="Confirm new password">
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} placeholder="Re-enter new password" />
                </Field>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: '#94A3B8', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px' }}>
            Changes here notify the admin and are recorded in the profile history.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 12, border: '1px solid #E2E8F0', background: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#475569' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '9px 20px', borderRadius: 12, border: 'none', background: saving ? '#94A3B8' : '#0F172A', color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12, border: '1.5px solid #E2E8F0',
  fontSize: 13, outline: 'none', fontFamily: 'inherit',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
