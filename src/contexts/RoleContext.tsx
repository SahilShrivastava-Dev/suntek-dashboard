import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { MOCK_PROFILES, DEFAULT_PROFILE } from '../lib/profiles';
import type { MockProfile } from '../lib/profiles';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type DbUser = Pick<
  Database['public']['Tables']['user_accounts']['Row'],
  'id' | 'name' | 'role_id' | 'role_label' | 'plant_name' | 'access_note'
>;

/**
 * Fail-closed identity for a logged-in user whose profiles.role doesn't match any
 * known role template (missing/unknown role). Grants NO dashboard access — never
 * default an unrecognized login to admin.
 */
const LOCKED_FALLBACK: MockProfile = {
  ...DEFAULT_PROFILE,
  id: 'locked',
  name: 'Restricted',
  roleLabel: 'No access',
  roleDescription: 'No role assigned — contact admin',
  allowedDashboardRoutes: [],
  standaloneOnly: false,
};

interface RoleContextValue {
  /** The profile whose access/views are currently in effect. */
  activeProfile: MockProfile;
  /** The logged-in user's own profile (who they actually are). */
  authProfile: MockProfile | null;
  allProfiles: MockProfile[];
  switchProfile: (profileId: string) => void;
  /** True when the active profile differs from the user's own profile (admin preview). */
  isViewingAs: boolean;
  /** True only when the current user may switch/preview roles (admin or dev bypass). */
  canSwitch: boolean;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  // The logged-in user's locked identity, resolved from their profiles row.
  // null = no session yet (loading, signed out, or the dev bypass).
  const [authProfile, setAuthProfile] = useState<MockProfile | null>(null);
  // Admin-only "preview as" selection. null = view as self.
  const [previewProfileId, setPreviewProfileId] = useState<string | null>(null);
  const [extraProfiles, setExtraProfiles] = useState<MockProfile[]>([]);

  // ── Resolve the logged-in user → locked MockProfile ────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function resolveFromSession(userId: string | null) {
      if (!userId) {
        if (!cancelled) setAuthProfile(null);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('role, plant_id, name')
        .eq('id', userId)
        .maybeSingle()
        .returns<{ role: string | null; plant_id: string | null; name: string | null }>();
      if (cancelled) return;

      const template = MOCK_PROFILES.find((p) => p.id === data?.role);
      if (!template) {
        // Logged in but no recognizable role → fail closed.
        setAuthProfile({ ...LOCKED_FALLBACK, name: data?.name || LOCKED_FALLBACK.name });
        return;
      }
      setAuthProfile({ ...template, name: data?.name || template.name });
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      resolveFromSession(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setPreviewProfileId(null); // reset any preview on login/logout
      resolveFromSession(session?.user?.id ?? null);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  // ── Extra (DB-created) profiles — only used for the admin preview switcher ──
  useEffect(() => {
    async function loadDbUsers() {
      const { data } = await supabase
        .from('user_accounts')
        .select('id, name, role_id, role_label, plant_name, access_note')
        .eq('is_active', true)
        .returns<DbUser[]>();
      if (!data?.length) return;
      const extras: MockProfile[] = [];
      for (const u of data) {
        const template = MOCK_PROFILES.find((p) => p.id === u.role_id);
        if (!template) continue;
        // Skip if this name already maps to an existing built-in profile
        if (MOCK_PROFILES.some((p) => p.name.toLowerCase() === u.name.trim().toLowerCase())) continue;
        const parts = u.name.trim().split(/\s+/);
        const initials = parts.length >= 2
          ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
          : parts[0].slice(0, 2).toUpperCase();
        extras.push({
          ...template,
          id: `db_${u.id}`,
          name: u.name,
          initials,
          roleLabel: u.role_label || template.roleLabel,
          plant: u.plant_name || template.plant,
          accessNote: u.access_note || template.accessNote,
        });
      }
      setExtraProfiles(extras);
    }
    loadDbUsers();
  }, []);

  const allProfiles = useMemo(() => [...MOCK_PROFILES, ...extraProfiles], [extraProfiles]);

  // Who can preview/switch: a real admin login, OR the dev bypass (no session in
  // a dev build, where Login lets you skip auth to demo the role switcher).
  const isAdmin = authProfile?.id === 'admin';
  const devBypass = import.meta.env.DEV && !authProfile;
  const canSwitch = isAdmin || devBypass;

  // The user's own identity. In a dev bypass we present as admin (the demo owner).
  const selfProfile: MockProfile = authProfile
    ?? (devBypass ? DEFAULT_PROFILE : LOCKED_FALLBACK);

  // Active = (admin's preview selection) else self. Non-admins can never deviate.
  const activeProfile: MockProfile = useMemo(() => {
    if (canSwitch && previewProfileId) {
      return allProfiles.find((p) => p.id === previewProfileId) ?? selfProfile;
    }
    return selfProfile;
  }, [canSwitch, previewProfileId, allProfiles, selfProfile]);

  function switchProfile(profileId: string) {
    if (!canSwitch) return; // locked users cannot change their role
    // Switching back to self clears the preview.
    setPreviewProfileId(profileId === selfProfile.id ? null : profileId);
  }

  return (
    <RoleContext.Provider
      value={{
        activeProfile,
        authProfile,
        allProfiles,
        switchProfile,
        canSwitch,
        isViewingAs: activeProfile.id !== selfProfile.id,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRoleContext(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRoleContext must be used inside <RoleProvider>');
  return ctx;
}
