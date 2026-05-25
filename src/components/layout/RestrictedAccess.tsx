import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoleContext } from '../../contexts/RoleContext';

/**
 * Shown when the active profile tries to access a route they're not allowed to see.
 * Replaces the page content — sidebar remains visible so they can navigate to allowed pages.
 */
export function RestrictedAccess() {
  const { activeProfile, switchProfile, isViewingAs } = useRoleContext();
  const navigate = useNavigate();

  function goHome() {
    navigate(activeProfile.homeRoute);
  }

  function goAdmin() {
    switchProfile('admin');
    navigate('/dashboard');
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      {/* Lock icon */}
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
        <svg
          width="28" height="28" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.8"
          className="text-slate-400"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>

      {/* Message */}
      <h2 className="text-[22px] font-bold text-slate-800 leading-tight mb-2">
        Access Restricted
      </h2>
      <p className="text-[14px] text-slate-500 max-w-[340px] leading-relaxed mb-1">
        This section is not available for{' '}
        <span className="font-semibold text-slate-700">{activeProfile.roleLabel}</span>.
      </p>
      {activeProfile.accessNote && (
        <p className="text-[12px] text-amber-600 font-medium mb-6">
          ⚠ {activeProfile.accessNote}
        </p>
      )}
      {!activeProfile.accessNote && <div className="mb-6" />}

      {/* Role badge */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl mb-6">
        <div
          className={[
            'w-8 h-8 rounded-full flex-shrink-0',
            'bg-gradient-to-br',
            activeProfile.avatarFrom,
            activeProfile.avatarTo,
            'flex items-center justify-center',
            'text-white font-bold text-xs',
          ].join(' ')}
        >
          {activeProfile.initials}
        </div>
        <div className="text-left">
          <div className="text-[13px] font-semibold text-slate-800">{activeProfile.name}</div>
          <div className="text-[11px] text-slate-500">{activeProfile.roleLabel}</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap justify-center">
        <button
          onClick={goHome}
          className="px-4 py-2 rounded-full border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Go to my section
        </button>
        {isViewingAs && (
          <button
            onClick={goAdmin}
            className="px-4 py-2 rounded-full bg-orange-500 text-white text-[13px] font-bold hover:bg-orange-600 transition-colors"
          >
            ← Back to Admin
          </button>
        )}
      </div>
    </div>
  );
}
