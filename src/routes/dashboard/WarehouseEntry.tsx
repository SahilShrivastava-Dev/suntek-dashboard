import React from 'react';
import { Warehouse } from '../warehouse/Warehouse';

/**
 * Dashboard-embedded version of the Warehouse Console.
 * Renders inside DashboardLayout (with sidebar + TopBar) instead of the
 * standalone full-screen app. The `embedded` prop hides the standalone header.
 */
export function WarehouseEntry() {
  return (
    <div style={{ minHeight: '70vh' }} className="flex flex-col">
      <Warehouse embedded />
    </div>
  );
}
