import React from 'react';
import { BatchLogger } from '../operator/BatchLogger';

/**
 * Dashboard-embedded version of the Factory Operator batch logger.
 * Renders inside DashboardLayout (with sidebar + TopBar) instead of the
 * standalone full-screen app. The `embedded` prop hides BatchLogger's own header.
 */
export function BatchEntry() {
  return (
    <div style={{ minHeight: '70vh' }} className="flex flex-col">
      <BatchLogger embedded />
    </div>
  );
}
