import React, { createContext, useContext, useState } from 'react';
import { MOCK_PROFILES, DEFAULT_PROFILE } from '../lib/profiles';
import type { MockProfile } from '../lib/profiles';

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

  function switchProfile(profileId: string) {
    const found = MOCK_PROFILES.find((p) => p.id === profileId);
    if (found) setActiveProfile(found);
  }

  return (
    <RoleContext.Provider
      value={{
        activeProfile,
        allProfiles: MOCK_PROFILES,
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
