import { useQuery } from '@tanstack/react-query';

// ── Type definitions ──────────────────────────────────────────────────────────

export interface OverviewKPIs {
  salesMTD: number;
  purchaseMTD: number;
  pendingBills: number;
  debtorsOutstanding: number;
  debtorCount: number;
  fyRevenue: number;
  fyPurchase: number;
  salesInvoiceCount: number;
  purchaseInvoiceCount: number;
  paymentsMTD: number;
  receiptsMTD: number;
}

export interface RevenueTrendPoint {
  month: string;
  revenue: number;
  invoiceCount: number;
}

export interface TopCustomer {
  code: number;
  name: string;
  mtdRevenue: number;
  invoiceCount: number;
}

export interface CustomerOutstanding {
  code: number;
  name: string;
  outstanding: number;
}

export interface CustomerListItem {
  code: number;
  name: string;
  fyRevenue: number;
  mtdRevenue: number;
  fyInvoices: number;
  lastInvoiceDate: string;
  outstanding: number;
}

export interface SalesMTD {
  totalSalesMTD: number;
  receiptsMTD: number;
  openContracts: number;
  gstOutputMTD: number;
  gstInputMTD: number;
  netGSTPayable: number;
  dispatchesMTD: number;
}

export interface SalesContract {
  customer: string;
  totalSales: number;
  mtdSales: number;
  invoiceCount: number;
  outstanding: number;
  status: 'overdue' | 'on track' | 'cleared';
}

export interface Movement {
  type: 'sales' | 'purchase' | 'batch' | 'stock' | 'maint' | 'journal';
  title: string;
  sub: string;
  amt: string;
  col: string;
  when: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

const STALE = 5 * 60 * 1000;     // 5 min
const REFETCH = 10 * 60 * 1000;  // 10 min

const BUSY_BASE = import.meta.env.VITE_BUSY_API_URL ?? '';

async function fetchBusy<T>(path: string): Promise<T> {
  const res = await fetch(`${BUSY_BASE}${path}`, {
    headers: { 'ngrok-skip-browser-warning': '1' },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data as T;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useOverviewKPIs() {
  return useQuery<OverviewKPIs>({
    queryKey: ['busy-overview'],
    queryFn: () => fetchBusy('/api/kpis/overview'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useRevenueTrend() {
  return useQuery<RevenueTrendPoint[]>({
    queryKey: ['busy-revenue-trend'],
    queryFn: () => fetchBusy('/api/kpis/revenue-trend'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useTopCustomers(limit = 5) {
  return useQuery<TopCustomer[]>({
    queryKey: ['busy-top-customers', limit],
    queryFn: () => fetchBusy(`/api/customers/top?limit=${limit}`),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useCustomerOutstanding() {
  return useQuery<CustomerOutstanding[]>({
    queryKey: ['busy-customer-outstanding'],
    queryFn: () => fetchBusy('/api/customers/outstanding'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useCustomerList() {
  return useQuery<CustomerListItem[]>({
    queryKey: ['busy-customer-list'],
    queryFn: () => fetchBusy('/api/customers/list'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useSalesMTD() {
  return useQuery<SalesMTD>({
    queryKey: ['busy-sales-mtd'],
    queryFn: () => fetchBusy('/api/sales/mtd'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useSalesContracts() {
  return useQuery<SalesContract[]>({
    queryKey: ['busy-sales-contracts'],
    queryFn: () => fetchBusy('/api/sales/contracts'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

export function useRecentMovements(days = 3) {
  return useQuery<Movement[]>({
    queryKey: ['busy-movements', days],
    queryFn: () => fetchBusy(`/api/movements/recent?days=${days}`),
    staleTime: 60 * 1000,       // 1 min (more frequent for feed)
    refetchInterval: 3 * 60 * 1000,
  });
}

export interface AnalyticsKPIs {
  // Existing KPIs
  grossMarginPct: number;
  purchaseToCostPct: number;
  dso: number;
  debtorTurnover: number;
  creditorsOutstanding: number;
  netWorkingCapital: number;
  revenueRunRate: number;
  avgTicketFY: number;
  avgTicketPrevMonth: number;
  momRevGrowthPct: number;
  momInvoiceGrowthPct: number;
  dailyVelocity: number;
  uniqueCustomersFY: number;
  uniqueCustomersMTD: number;
  prevMonthUniqueCust: number;
  top5ConcentrationPct: number;
  revenuePerCustomer: number;
  fyReceipts: number;
  fyPayments: number;
  top5: { name: string; fyRevenue: number; sharePct: number }[];
  monthly: { label: string; revenue: number; invoiceCount: number; uniqueCustomers: number }[];
  // New KPIs 1-2: Liquidity cycle
  dpo: number;
  cashConversionCycle: number;
  // New KPI 3: Collection quality
  collectionRatioMTD: number;
  receiptsMTD: number;
  // New KPI 4: Overdue aging
  overdueAging: {
    d1_30: number; d31_60: number; d61_90: number; d90plus: number;
    c1_30: number; c31_60: number; c61_90: number; c90plus: number;
  };
  // New KPI 5: Revenue vs cash gap
  revenueReceiptsGap: number;
  // New KPI 6: Payment completion
  paymentCompletionPct: number;
  // New KPIs 7-8: Supplier intel
  activeSuppliersFY: number;
  activeSuppliersMTD: number;
  top5SupplierConcentrationPct: number;
  top5Suppliers: { name: string; fyPurchase: number; sharePct: number }[];
  // New KPIs 9-10: Customer dynamics
  newCustomersMTD: number;
  lapsedCustomersMTD: number;
  // New KPI 11: Invoice frequency
  invoiceFrequency: number;
  // New KPI 12: Monthly purchase trend
  monthlyPurchase: { label: string; purchase: number; invoiceCount: number }[];
  // New KPI 13: GST net position
  gstOutputMTD: number;
  gstInputMTD: number;
  gstNetMTD: number;
  snapshotAt: string;
  _fallback?: true;
}

export function useAnalyticsKPIs() {
  return useQuery<AnalyticsKPIs>({
    queryKey: ['busy-analytics-kpis'],
    queryFn: () => fetchBusy('/api/analytics/kpis'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtINR(n: number): string {
  if (!n || isNaN(n)) return '—';
  if (n >= 10_000_000) return `₹ ${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000)   return `₹ ${(n / 100_000).toFixed(1)} L`;
  return `₹ ${Math.round(n).toLocaleString('en-IN')}`;
}

export function fmtINRShort(n: number): string {
  if (!n || isNaN(n)) return '—';
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000)   return `${(n / 100_000).toFixed(1)} L`;
  return Math.round(n).toLocaleString('en-IN');
}
