import React from 'react';
import { CheckIn } from '../night-manager/CheckIn';

/**
 * Dashboard-embedded version of the Night Manager check-in form.
 * Renders inside DashboardLayout (with sidebar + TopBar) instead of the
 * standalone full-screen app. The `embedded` prop hides CheckIn's own header.
 */
export function NightEntry() {
  return (
    <div className="max-w-xl">
      <CheckIn embedded />
    </div>
  );
}
