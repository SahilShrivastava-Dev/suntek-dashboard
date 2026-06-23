import React, { createContext, useContext, useState, useEffect } from 'react';
import { MOCK_PROFILES, DEFAULT_PROFILE } from '../lib/profiles';
import type { MockProfile } from '../lib/profiles';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type DbUser = Pick<
  Database['public']['Tables']['user_accounts']['Row'],
  'id' | 'name' | 'role_id' | 'role_label' | 'plant_name' | 'access_note'
>;

interface RoleContextValue {
  activeProfile: MockProfile;
  allProfiles: MockProfile[];
  switchProfile: (profileId: string) => void;
  /** True when not viewing as admin — triggers the "Viewing as" preview banner */
  isViewingAs: boolean;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [activeProfile, setActiveProfile] = useState<MockProfile>(DEFAULT_PROFILE);
  const [extraProfiles, setExtraProfiles] = useState<MockProfile[]>([]);

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

  const allProfiles = [...MOCK_PROFILES, ...extraProfiles];

  function switchProfile(profileId: string) {
    const found = allProfiles.find((p) => p.id === profileId);
    if (found) setActiveProfile(found);
  }

  return (
    <RoleContext.Provider
      value={{
        activeProfile,
        allProfiles,
        switchProfile,
        isViewingAs: activeProfile.id !== 'admin',
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
