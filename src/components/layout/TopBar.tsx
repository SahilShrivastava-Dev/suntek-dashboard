import React from 'react';
import { ProfileSwitcher } from './ProfileSwitcher';

interface TopBarProps {
  title: string;
  breadcrumb: string;
}

export function TopBar({ title, breadcrumb }: TopBarProps) {
  return (
    <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
      {/* Left: title block */}
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[12px] text-slate-500">{breadcrumb}</div>
          <h1 className="serif text-[34px] leading-[1] mt-0.5">{title}</h1>
        </div>
      </div>

      {/* Right: live indicator + notifications + profile switcher */}
      <div className="flex items-center gap-2">
        {/* Live sync pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full text-[12px]">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="font-medium">Live</span>
          <span className="text-slate-400">· last sync 12s</span>
        </div>

        {/* Notifications */}
        <button
          className="w-10 h-10 rounded-full bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center relative"
          onClick={() => {}}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10 21a2 2 0 0 0 4 0"/>
          </svg>
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-orange-500"></span>
        </button>

        {/* Profile switcher — replaces the old static user button */}
        <ProfileSwitcher />
      </div>
    </div>
  );
}
