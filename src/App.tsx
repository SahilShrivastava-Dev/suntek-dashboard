import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleProvider } from './contexts/RoleContext';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { BlacklistProvider } from './contexts/BlacklistContext';
import { AnomalyProvider } from './contexts/AnomalyContext';

// Layout + auth load eagerly (shell + entry — always needed, small).
import { DashboardLayout } from './components/layout/DashboardLayout';
import { PurchaseLayout } from './routes/dashboard/purchase/PurchaseLayout';
import { Login } from './routes/auth/Login';

// Page components are code-split so each route ships its own chunk — heavy deps
// (leaflet, recharts, xlsx, the OCR client) no longer bloat the initial bundle.
const Overview         = lazy(() => import('./routes/dashboard/Overview').then(m => ({ default: m.Overview })));
const Sales            = lazy(() => import('./routes/dashboard/Sales').then(m => ({ default: m.Sales })));
const CPMStock         = lazy(() => import('./routes/dashboard/CPMStock').then(m => ({ default: m.CPMStock })));
const BatchSheet       = lazy(() => import('./routes/dashboard/BatchSheet').then(m => ({ default: m.BatchSheet })));
const CustomerHistory  = lazy(() => import('./routes/dashboard/CustomerHistory').then(m => ({ default: m.CustomerHistory })));
const NightManagerBoard = lazy(() => import('./routes/dashboard/NightManagerBoard').then(m => ({ default: m.NightManagerBoard })));
const OilRatioTable    = lazy(() => import('./routes/dashboard/OilRatioTable').then(m => ({ default: m.OilRatioTable })));
const AuditLog         = lazy(() => import('./routes/dashboard/AuditLog').then(m => ({ default: m.AuditLog })));
const NightEntry       = lazy(() => import('./routes/dashboard/NightEntry').then(m => ({ default: m.NightEntry })));
const BatchEntry       = lazy(() => import('./routes/dashboard/BatchEntry').then(m => ({ default: m.BatchEntry })));
const WarehouseEntry   = lazy(() => import('./routes/dashboard/WarehouseEntry').then(m => ({ default: m.WarehouseEntry })));
const DailyLogPage     = lazy(() => import('./routes/dashboard/DailyLogPage').then(m => ({ default: m.DailyLogPage })));
const UserManagement   = lazy(() => import('./routes/dashboard/UserManagement').then(m => ({ default: m.UserManagement })));
const Blacklist        = lazy(() => import('./routes/dashboard/Blacklist').then(m => ({ default: m.Blacklist })));
const AnomalyDashboard = lazy(() => import('./routes/dashboard/AnomalyDashboard').then(m => ({ default: m.AnomalyDashboard })));
const AnomalyOperationsCenter = lazy(() => import('./routes/dashboard/AnomalyOperationsCenter').then(m => ({ default: m.AnomalyOperationsCenter })));

// Purchase sub-routes
const StoreRequisitions = lazy(() => import('./routes/dashboard/purchase/StoreRequisitions').then(m => ({ default: m.StoreRequisitions })));
const FAR             = lazy(() => import('./routes/dashboard/purchase/FAR').then(m => ({ default: m.FAR })));
const Maintenance     = lazy(() => import('./routes/dashboard/purchase/Maintenance').then(m => ({ default: m.Maintenance })));
const ActivityLog     = lazy(() => import('./routes/dashboard/purchase/ActivityLog').then(m => ({ default: m.ActivityLog })));
const PurchaseOrders  = lazy(() => import('./routes/dashboard/purchase/PurchaseOrders').then(m => ({ default: m.PurchaseOrders })));
const MarineInsurance = lazy(() => import('./routes/dashboard/purchase/MarineInsurance').then(m => ({ default: m.MarineInsurance })));
const Labour          = lazy(() => import('./routes/dashboard/purchase/Labour').then(m => ({ default: m.Labour })));

// L1 Operator apps (standalone — no DashboardLayout)
const CheckIn     = lazy(() => import('./routes/night-manager/CheckIn').then(m => ({ default: m.CheckIn })));
const Warehouse   = lazy(() => import('./routes/warehouse/Warehouse').then(m => ({ default: m.Warehouse })));
const BatchLogger = lazy(() => import('./routes/operator/BatchLogger').then(m => ({ default: m.BatchLogger })));

/** Lightweight fallback while a route chunk loads. */
function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
    </div>
  );
}

function App() {
  return (
    // RoleProvider wraps BrowserRouter so the role context is available
    // everywhere in the app, including inside router-dependent hooks.
    <RoleProvider>
      <NotificationsProvider>
      <BlacklistProvider>
      <AnomalyProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Auth */}
          <Route path="/login" element={<Login />} />

          {/* Dashboard — protected layout */}
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<Overview />} />

            {/* Purchase hub — nested layout with shared stage flow + sub-tabs */}
            <Route path="purchase" element={<PurchaseLayout />}>
              <Route index element={<Navigate to="far" replace />} />
              <Route path="far"      element={<FAR />} />
              <Route path="maint"    element={<Maintenance />} />
              <Route path="activity" element={<ActivityLog />} />
              <Route path="storereq" element={<StoreRequisitions />} />
              <Route path="purchase" element={<PurchaseOrders />} />
              <Route path="marine"   element={<MarineInsurance />} />
              <Route path="labour"   element={<Labour />} />
            </Route>

            {/* Main tabs */}
            <Route path="sales"         element={<Sales />} />
            <Route path="stock"         element={<CPMStock />} />
            <Route path="batches"       element={<BatchSheet />} />
            <Route path="customers"     element={<CustomerHistory />} />
            <Route path="night-manager" element={<NightManagerBoard />} />
            <Route path="oil-ratio"     element={<OilRatioTable />} />
            <Route path="audit"         element={<AuditLog />} />
            {/* Embedded L1 app views — full dashboard layout but single-purpose */}
            <Route path="night-entry"       element={<NightEntry />} />
            <Route path="batch-entry"       element={<BatchEntry />} />
            <Route path="warehouse-entry"   element={<WarehouseEntry />} />
            <Route path="daily-log"         element={<DailyLogPage />} />
            <Route path="users"             element={<UserManagement />} />
            <Route path="blacklist"         element={<Blacklist />} />
            <Route path="anomalies"         element={<AnomalyDashboard />} />
            <Route path="anomaly-center"    element={<AnomalyOperationsCenter />} />
          </Route>

          {/* L1 Operator apps — standalone, no sidebar */}
          <Route path="/night-manager/check-in" element={<CheckIn />} />
          <Route path="/warehouse"              element={<Warehouse />} />
          <Route path="/warehouse/stock-entry"  element={<Warehouse />} />
          <Route path="/warehouse/requisition"  element={<Warehouse />} />
          <Route path="/operator/batch-logger"  element={<BatchLogger />} />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </AnomalyProvider>
      </BlacklistProvider>
      </NotificationsProvider>
    </RoleProvider>
  );
}

export default App;
