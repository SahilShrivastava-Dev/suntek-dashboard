import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { RoleProvider } from './contexts/RoleContext';

// Layout
import { DashboardLayout } from './components/layout/DashboardLayout';

// Auth
import { Login } from './routes/auth/Login';

// Dashboard routes
import { Overview } from './routes/dashboard/Overview';
import { Sales } from './routes/dashboard/Sales';
import { CPMStock } from './routes/dashboard/CPMStock';
import { BatchSheet } from './routes/dashboard/BatchSheet';
import { CustomerHistory } from './routes/dashboard/CustomerHistory';
import { NightManagerBoard } from './routes/dashboard/NightManagerBoard';
import { OilRatioTable } from './routes/dashboard/OilRatioTable';
import { AuditLog } from './routes/dashboard/AuditLog';
import { NightEntry } from './routes/dashboard/NightEntry';
import { BatchEntry } from './routes/dashboard/BatchEntry';
import { WarehouseEntry } from './routes/dashboard/WarehouseEntry';
import { DailyLogPage } from './routes/dashboard/DailyLogPage';

// L1 Operator apps (standalone — no DashboardLayout)
import { CheckIn } from './routes/night-manager/CheckIn';
import { Warehouse } from './routes/warehouse/Warehouse';
import { BatchLogger } from './routes/operator/BatchLogger';

// Purchase layout + sub-routes
import { PurchaseLayout } from './routes/dashboard/purchase/PurchaseLayout';
import { StoreRequisitions } from './routes/dashboard/purchase/StoreRequisitions';
import { FAR } from './routes/dashboard/purchase/FAR';
import { Maintenance } from './routes/dashboard/purchase/Maintenance';
import { ActivityLog } from './routes/dashboard/purchase/ActivityLog';
import { PurchaseOrders } from './routes/dashboard/purchase/PurchaseOrders';
import { MarineInsurance } from './routes/dashboard/purchase/MarineInsurance';
import { Labour } from './routes/dashboard/purchase/Labour';

function App() {
  return (
    // RoleProvider wraps BrowserRouter so the role context is available
    // everywhere in the app, including inside router-dependent hooks.
    <RoleProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </RoleProvider>
  );
}

export default App;
