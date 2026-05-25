import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoleContext } from '../../contexts/RoleContext';
import type { MockProfile } from '../../lib/profiles';

// ── Avatar ────────────────────────────────────────────────────────────────────

type AvatarSize = 'sm' | 'md' | 'lg';

const AVATAR_SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-11 h-11 text-sm',
};

export function ProfileAvatar({
  profile,
  size = 'md',
}: {
  profile: MockProfile;
  size?: AvatarSize;
}) {
  return (
    <div
      className={[
        AVATAR_SIZE_CLASSES[size],
        'rounded-full flex-shrink-0',
        'bg-gradient-to-br',
        profile.avatarFrom,
        profile.avatarTo,
        'flex items-center justify-center',
        'text-white font-bold',
      ].join(' ')}
    >
      {profile.initials}
    </div>
  );
}

// ── Access badge ──────────────────────────────────────────────────────────────

function AccessBadge({ profile }: { profile: MockProfile }) {
  if (profile.standaloneOnly) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
        App only
      </span>
    );
  }
  if (profile.allowedDashboardRoutes.includes('*')) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
        Full
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">
      {profile.allowedDashboardRoutes.length} views
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProfileSwitcher() {
  const { activeProfile, allProfiles, switchProfile } = useRoleContext();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleSelect(profile: MockProfile) {
    switchProfile(profile.id);
    navigate(profile.homeRoute);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition-colors"
      >
        <ProfileAvatar profile={activeProfile} size="sm" />
        <div className="text-left hidden md:block">
          <div className="text-[12px] font-semibold leading-tight">
            {activeProfile.name.split(' ')[0]}
          </div>
          <div className="text-[10px] text-slate-500">{activeProfile.roleLabel}</div>
        </div>
        {/* Chevron */}
        <svg
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[290px] bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-slate-100 bg-slate-50/60">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Preview as role
            </div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              Switch to see role-specific views &amp; access
            </div>
          </div>

          {/* Profile list */}
          <div className="p-2 max-h-[420px] overflow-y-auto">
            {allProfiles.map((profile) => {
              const isActive = profile.id === activeProfile.id;
              return (
                <button
                  key={profile.id}
                  onClick={() => handleSelect(profile)}
                  className={[
                    'w-full flex items-start gap-3 p-3 rounded-xl text-left transition-colors',
                    isActive
                      ? 'bg-orange-50 border border-orange-200'
                      : 'hover:bg-slate-50 border border-transparent',
                  ].join(' ')}
                >
                  <ProfileAvatar profile={profile} size="md" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-bold leading-tight truncate">
                        {profile.name}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 whitespace-nowrap">
                          active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
                      {profile.roleLabel}
                    </div>
                    <div className="text-[11px] text-slate-400">{profile.roleDescription}</div>
                    {profile.plant && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        📍 {profile.plant}
                      </div>
                    )}
                    {profile.accessNote && (
                      <div className="text-[11px] text-amber-600 font-medium mt-0.5">
                        ⚠ {profile.accessNote}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 mt-0.5">
                    <AccessBadge profile={profile} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/60">
            <div className="text-[11px] text-slate-400 text-center">
              Role preview mode · Navigation adapts per role
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
