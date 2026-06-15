import React, { createContext, useContext, useMemo } from 'react';
import { useAnomalyScan } from '../lib/anomaly/useAnomalies';
import type { ScanResult, AnomalyFinding } from '../lib/anomaly/types';
import { useRoleContext } from './RoleContext';

interface AnomalyContextValue {
  scan: ScanResult | undefined;
  findings: AnomalyFinding[];     // role-scoped
  criticalCount: number;          // urgent + warning, role-scoped
  urgentCount: number;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

const AnomalyContext = createContext<AnomalyContextValue>({
  scan: undefined, findings: [], criticalCount: 0, urgentCount: 0,
  loading: false, error: false, refetch: () => {},
});

export function useAnomalies() {
  return useContext(AnomalyContext);
}

// Per-role anomaly scoping: which entity_types each role should see.
// Accountants → financial/customer; unit_head → ops/vendor/equipment; admin → all.
function scopeForRole(roleId: string): Set<string> | null {
  if (roleId === 'admin') return null; // all
  if (roleId === 'unit_head') return new Set(['vendor', 'equipment', 'plant', 'batch', 'kpi']);
  if (roleId === 'accountant_delhi' || roleId === 'accountant_other')
    return new Set(['customer', 'kpi', 'vendor']);
  return new Set(['kpi']);
}

export function AnomalyProvider({ children }: { children: React.ReactNode }) {
  const { activeProfile } = useRoleContext();
  const roleId = activeProfile?.id ?? 'admin';
  const { data: scan, isLoading, isError, refetch } = useAnomalyScan();

  const findings = useMemo(() => {
    const all = scan?.findings ?? [];
    const scope = scopeForRole(roleId);
    if (!scope) return all;
    return all.filter(f => !f.entity_type || scope.has(f.entity_type));
  }, [scan, roleId]);

  const urgentCount = findings.filter(f => f.severity === 'urgent').length;
  const criticalCount = findings.filter(f => f.severity === 'urgent' || f.severity === 'warning').length;

  return (
    <AnomalyContext.Provider value={{
      scan, findings, criticalCount, urgentCount,
      loading: isLoading, error: isError, refetch: () => refetch(),
    }}>
      {children}
    </AnomalyContext.Provider>
  );
}
