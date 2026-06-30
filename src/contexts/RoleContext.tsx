import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { MOCK_PROFILES, DEFAULT_PROFILE } from '../lib/profiles';
import type { MockProfile } from '../lib/profiles';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { applyLanguage, hasStoredLanguage } from '../i18n';

type DbUser = Pick<
  Database['public']['Tables']['user_accounts']['Row'],
  'id' | 'name' | 'role_id' | 'role_label' | 'plant_name' | 'access_note' | 'auth_user_id' | 'created_at'
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
  /**
   * Every id the active profile answers to for notifications/tagging: their
   * primary id, their role-template id, and their per-person `db_<uuid>` twin
   * if one exists in the directory. A notification addressed to ANY of these
   * belongs to this person. Always non-empty (at least `[activeProfile.id]`).
   */
  activeIdentityIds: string[];
  /**
   * The active person's SINGLE personal identity — their `db_<uuid>` when they
   * are a provisioned user, otherwise their profile id. Unlike `activeProfile.id`
   * (which is the shared role-template id for provisioned users), this is unique
   * per person, so it's what "is this note mine / mark it seen / don't tag
   * myself" must key on. Two different technicians get two different personIds.
   */
  activePersonId: string;
  /**
   * When the active person's account was created — notifications older than this
   * are hidden so a freshly-provisioned user doesn't inherit the whole backlog.
   * null for the static archetypes / dev (they see everything).
   */
  activeAccountFloor: string | null;
  /** False until the session/profile has been resolved (show a loader, not the
   * locked fallback, while this is false). */
  authResolved: boolean;
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

/**
 * All ids a person answers to: their own id, their role-template id, and the
 * per-person `db_<uuid>` twin that the taggable directory exposes for them
 * (matched by name). This bridges the two identity spaces — a user resolved to
 * a role-template id at login still receives notifications tagged to their
 * personal directory id, and vice-versa.
 */
function identitiesFor(profile: MockProfile, directory: MockProfile[]): string[] {
  const ids = new Set<string>([profile.id]);
  if (profile.baseRoleId) ids.add(profile.baseRoleId);
  const key = profile.name.trim().toLowerCase();
  const twin = directory.find((p) => p.name.trim().toLowerCase() === key);
  if (twin) {
    ids.add(twin.id);
    if (twin.baseRoleId) ids.add(twin.baseRoleId);
  }
  return [...ids];
}

export function RoleProvider({ children }: { children: React.ReactNode }) {
  // The logged-in user's locked identity, resolved from their profiles row.
  // null = no session yet (loading, signed out, or the dev bypass).
  const [authProfile, setAuthProfile] = useState<MockProfile | null>(null);
  // Admin-only "preview as" selection. null = view as self.
  const [previewProfileId, setPreviewProfileId] = useState<string | null>(null);
  const [extraProfiles, setExtraProfiles] = useState<MockProfile[]>([]);
  // The logged-in Supabase auth user id — the exact link to this person's
  // directory (db) identity, used to bridge notification ids. null = no session.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  // False until the logged-in user's profile has been resolved (or determined
  // absent). Lets the UI show a loading state instead of flashing the locked /
  // "Access Restricted" fallback while the profile fetch is still in flight.
  const [authResolved, setAuthResolved] = useState(false);
  // The auth user whose saved language we've already applied this session. Auth
  // events (token refresh, tab focus) fire resolveFromSession repeatedly — we
  // must apply the DB language only ONCE per login, never re-apply it, so it
  // can't clobber a language the user switched to at runtime.
  const langAppliedForRef = useRef<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Resolve the logged-in user → locked MockProfile ────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function resolveFromSession(userId: string | null) {
      if (!cancelled) setSessionUserId(userId);
      if (!userId) {
        langAppliedForRef.current = null; // signed out → re-apply on next login
        if (!cancelled) { setAuthProfile(null); setAuthResolved(true); }
        return;
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('role, plant_id, name, preferred_language')
        .eq('id', userId)
        .maybeSingle()
        .returns<{ role: string | null; plant_id: string | null; name: string | null; preferred_language: string | null }>();
      if (cancelled) return;

      // Transient fetch failure (flaky mobile network) → retry instead of failing
      // closed to "No access". The loader stays up until it resolves.
      if (error) {
        retryRef.current = setTimeout(() => { if (!cancelled) resolveFromSession(userId); }, 1500);
        return;
      }

      // Language source of truth = the user's local choice (localStorage). The
      // DB preference only SEEDS the language on a fresh device that has no
      // local choice yet — so a refresh/token-refresh/tab-focus can never
      // override a language the user picked. Applied at most once per login.
      if (langAppliedForRef.current !== userId) {
        langAppliedForRef.current = userId;
        if (!hasStoredLanguage()) applyLanguage(data?.preferred_language);
      }

      const template = MOCK_PROFILES.find((p) => p.id === data?.role);
      if (!template) {
        // Logged in but no recognizable role → fail closed.
        setAuthProfile({ ...LOCKED_FALLBACK, name: data?.name || LOCKED_FALLBACK.name });
        setAuthResolved(true);
        return;
      }
      setAuthProfile({ ...template, name: data?.name || template.name });
      setAuthResolved(true);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      resolveFromSession(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setPreviewProfileId(null); // reset any preview on login/logout
      resolveFromSession(session?.user?.id ?? null);
    });
    return () => { cancelled = true; clearTimeout(retryRef.current); subscription.unsubscribe(); };
  }, []);

  // ── Extra (DB-created) profiles — only used for the admin preview switcher ──
  useEffect(() => {
    async function loadDbUsers() {
      const { data } = await supabase
        .from('user_accounts')
        .select('id, name, role_id, role_label, plant_name, access_note, auth_user_id, created_at')
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
          baseRoleId: template.id, // keep the role link so role-targeted notifications still reach this person
          authUserId: u.auth_user_id ?? undefined, // exact session ↔ directory link
          accountCreatedAt: u.created_at ?? undefined, // notification floor
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

  // Every id the active person answers to (self id + role id + db twin id).
  const activeIdentityIds = useMemo(() => {
    const ids = new Set(identitiesFor(activeProfile, extraProfiles));
    // Exact bridge for the logged-in self: map this auth session straight to its
    // directory `db_<uuid>` identity (name-independent, the robust link). Only
    // when viewing as self — an admin previewing someone else keeps their ids.
    if (sessionUserId && activeProfile.id === selfProfile.id) {
      const mine = extraProfiles.find((p) => p.authUserId === sessionUserId);
      if (mine) {
        ids.add(mine.id);
        if (mine.baseRoleId) ids.add(mine.baseRoleId);
      }
    }
    return [...ids];
  }, [activeProfile, extraProfiles, sessionUserId, selfProfile]);

  // The active person's unique personal id (their db twin if provisioned, else
  // their profile id). NEVER the shared role id — used for "is this mine /
  // mark seen / exclude self" so two same-role people stay distinct.
  const activePersonId = useMemo(() => {
    if (activeProfile.id.startsWith('db_')) return activeProfile.id; // already personal
    if (sessionUserId && activeProfile.id === selfProfile.id) {
      const mine = extraProfiles.find((p) => p.authUserId === sessionUserId);
      if (mine) return mine.id; // exact auth link
    }
    const key = activeProfile.name.trim().toLowerCase();
    const twin = extraProfiles.find((p) => p.name.trim().toLowerCase() === key);
    return twin?.id ?? activeProfile.id; // name twin, else the (mock) profile id
  }, [activeProfile, extraProfiles, sessionUserId, selfProfile]);

  // The active person's provisioning date (notification floor). Resolved from
  // whichever directory entry matches their personal id; null for archetypes.
  const activeAccountFloor = useMemo(() => {
    if (activeProfile.accountCreatedAt) return activeProfile.accountCreatedAt;
    const mine = extraProfiles.find((p) => p.id === activePersonId);
    return mine?.accountCreatedAt ?? null;
  }, [activeProfile, extraProfiles, activePersonId]);

  function switchProfile(profileId: string) {
    if (!canSwitch) return; // locked users cannot change their role
    // Switching back to self clears the preview.
    setPreviewProfileId(profileId === selfProfile.id ? null : profileId);
  }

  return (
    <RoleContext.Provider
      value={{
        activeProfile,
        activeIdentityIds,
        activePersonId,
        activeAccountFloor,
        authResolved,
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
