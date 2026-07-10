import React, { useState } from 'react';
import { EmptyState } from '../../components/ui/states';
import { usePagination } from '../../components/ui/usePagination';
import { TablePagination } from '../../components/ui/TablePagination';
import { TableSearch, useTextFilter } from '../../components/ui/TableSearch';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { insertRows } from '../../lib/db';
import { useSalesMTD, useSalesContracts, useAnalyticsKPIs, fmtINR } from '../../hooks/useBusyData';
import { DeltaBadge, BulletCompare } from '../../components/charts/AnalyticsViz';
import { KpiInfoButton } from '../../components/KpiInfoButton';
import { exportToXlsx } from '../../lib/utils/exportXlsx';
import { useRoleContext } from '../../contexts/RoleContext';
import { useToast } from '../../components/ui/toast';
import { OcrUploadCard } from '../../components/OcrUploadCard';

// Sales sheet OCR upload is available to management/finance roles only.
const CAN_UPLOAD_SHEET = ['admin', 'unit_head', 'accountant_delhi', 'accountant_other'];

interface NewContractForm {
  customer: string;
  density: string;
  lockedPrice: string;
  bookedQty: string;
}

const DENSITY_OPTIONS = ['1300', '1400', '1450', '1500'];

export function Sales() {
  const { t } = useTranslation();
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);
  const { activeProfile } = useRoleContext();
  const { data: salesKPIs } = useSalesMTD();
  const { data: liveContracts } = useSalesContracts();
  const [salesSearch, setSalesSearch] = useState('');
  const contractRows = liveContracts || [];
  const filteredContracts = useTextFilter(contractRows, salesSearch, c => [c.customer, c.status]);
  const salesPg = usePagination(filteredContracts, { resetKey: salesSearch });
  const { data: analytics } = useAnalyticsKPIs();

  function handleExport() {
    const rows = (liveContracts || []).map(c => ({
      customer: c.customer,
      totalSales: c.totalSales,
      mtdSales: c.mtdSales,
      invoiceCount: c.invoiceCount,
      outstanding: c.outstanding,
      status: c.status,
    }));
    exportToXlsx(
      rows,
      [
        { header: 'Customer', key: 'customer' },
        { header: 'FY Sales (₹)', key: 'totalSales' },
        { header: 'MTD Sales (₹)', key: 'mtdSales' },
        { header: 'Invoices', key: 'invoiceCount' },
        { header: 'Outstanding (₹)', key: 'outstanding' },
        { header: 'Status', key: 'status' },
      ],
      'sales-contracts',
      activeProfile,
      'Sales Contracts',
    );
  }

  const [form, setForm] = useState<NewContractForm>({
    customer: '',
    density: '1400',
    lockedPrice: '',
    bookedQty: '',
  });
  const [formSaved, setFormSaved] = useState(false);

  function handleFormChange(field: keyof NewContractForm, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSaveContract() {
    if (!form.customer.trim() || !form.lockedPrice || !form.bookedQty) return;
    // Find or create customer
    let customerId: string | null = null;
    const { data: existingCustomers } = await supabase
      .from('customers')
      .select('id')
      .ilike('name', form.customer.trim())
      .limit(1)
      .returns<{ id: string }[]>();
    if (existingCustomers && existingCustomers.length > 0) {
      customerId = existingCustomers[0].id;
    } else {
      const { data: newCust } = await insertRows('customers', { name: form.customer.trim(), outstanding: 0, is_active: true })
        .select('id')
        .single();
      if (newCust) customerId = newCust.id;
    }
    if (!customerId) { toast.error('Failed to find or create customer. Please try again.'); return; }
    const { error } = await insertRows('sales_contracts', {
      customer_id: customerId,
      density: parseInt(form.density) || 1400,
      locked_price: parseFloat(form.lockedPrice) || 0,
      booked_qty: parseFloat(form.bookedQty) || 0,
      dispatched_qty: 0,
      status: 'open',
    });
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    setFormSaved(true);
    setTimeout(() => {
      setShowModal(false);
      setFormSaved(false);
      setForm({ customer: '', density: '1400', lockedPrice: '', bookedQty: '' });
    }, 1400);
  }

  function handleCloseModal() {
    setShowModal(false);
    setFormSaved(false);
    setForm({ customer: '', density: '1400', lockedPrice: '', bookedQty: '' });
  }

  return (
    <>
      {/* Sales sheet OCR upload — management/finance only */}
      {CAN_UPLOAD_SHEET.includes(activeProfile.id) && <OcrUploadCard kind="sales" />}

      {/* KPIs — live from BUSY — blue tiles */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Total Sales MTD', what: 'Gross sales value invoiced this calendar month across all customers and plants. Counts non-cancelled sales vouchers only.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0, current month' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.totalSalesLabel')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">
            {salesKPIs ? fmtINR(salesKPIs.totalSalesMTD) : '…'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{salesKPIs ? t('sales.dispatchesMtd', { count: salesKPIs.dispatchesMTD }) : ''}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'GST Output MTD', what: 'Total GST collected from customers on sales invoices this month. Net payable = Output GST minus Input ITC. This is what must be remitted to the government.', source: 'BUSY DB', tables: ['VchGSTSumItemWise', 'Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > VchGSTSumItemWise', filter: 'VchType=9, current month' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.gstOutputLabel')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">
            {salesKPIs ? fmtINR(salesKPIs.gstOutputMTD) : '…'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{salesKPIs ? t('sales.netPayable', { amount: fmtINR(salesKPIs.netGSTPayable) }) : ''}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Customers with Outstanding', what: 'Count of unique parties in the Sundry Debtors group that have a non-zero Dr balance — i.e., customers who owe money.', source: 'BUSY DB', tables: ['DailySum', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > DailySum\nBusyFY2026 > dbo > Tables > Master1', filter: 'Master1.ParentGrp=116 (Sundry Debtors), MasterType=2' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.customersOutstandingLabel')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">
            {salesKPIs ? salesKPIs.openContracts : '…'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{t('sales.partiesSundryDebtors')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Receipts MTD', what: 'Cash actually received from customers this month via receipt vouchers. Excludes sales invoices not yet paid. Key indicator of real cash inflow.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=16 (Receipt), Cancelled=0, current month' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.receiptsLabel')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">
            {salesKPIs ? fmtINR(salesKPIs.receiptsMTD) : '…'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{t('sales.customerPaymentsReceived')}</div>
        </div>
      </div>

      {/* Analytics KPI row */}
      {analytics && (
        <div className="grid grid-cols-12 gap-5 mb-5">
          {/* Avg Ticket */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Average Invoice Ticket', what: 'Mean value of each sales invoice for the full financial year. Tracks if orders are growing larger or fragmenting into smaller deals.', source: 'Derived', formula: 'Avg Ticket = FY Revenue / FY Invoice Count', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.avgInvoiceTicketLabel')}</div>
            <div className="text-[24px] font-extrabold mt-1 num text-slate-800">
              {fmtINR(analytics.avgTicketFY)}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <DeltaBadge value={analytics.momInvoiceGrowthPct} />
              <span className="text-[10px] text-slate-500">{t('sales.invoiceCountMom')}</span>
            </div>
          </div>

          {/* Daily Sales Velocity */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Daily Sales Velocity', what: 'Average revenue generated per working day so far this month. Useful to project end-of-month sales and spot early slowdowns.', source: 'Derived', formula: 'Velocity = MTD Sales / Days elapsed in month', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0, current month' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.dailyVelocityLabel')}</div>
            <div className="text-[24px] font-extrabold mt-1 num text-slate-800">
              {fmtINR(analytics.dailyVelocity)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">{t('sales.perWorkingDay')}</div>
          </div>

          {/* Unique customers FY vs MTD */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Active Customers', what: 'Number of unique customer parties that have received at least one sales invoice this month (MTD) vs. the full year (FY). MTD percentage shows what share of the annual customer base is active now.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0 · COUNT DISTINCT MasterCode1' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.activeCustomersLabel')}</div>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-[24px] font-extrabold num text-slate-800">{analytics.uniqueCustomersMTD}</span>
              <span className="text-sm text-slate-500 mb-0.5">/ {analytics.uniqueCustomersFY} {t('sales.fyLabel')}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {t('sales.fyBaseActive', { pct: ((analytics.uniqueCustomersMTD / (analytics.uniqueCustomersFY || 1)) * 100).toFixed(0) })}
            </div>
          </div>

          {/* Customer Concentration */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Top-5 Customer Revenue Concentration', what: 'Percentage of total FY revenue coming from the 5 highest-spending customers. High concentration (>60%) signals customer dependency risk — losing one party would have significant impact.', source: 'Derived', formula: 'Concentration = Sum(top 5 FY revenue) / Total FY Revenue × 100', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0 · TOP 5 by SUM(VchAmtBaseCur)' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.top5RevenueLabel')}</div>
            <div className="text-[24px] font-extrabold mt-1 num text-amber-600">{analytics.top5ConcentrationPct}%</div>
            <div className="text-[11px] text-slate-500 mt-1">
              {t('sales.leadsAt', { name: analytics.top5[0]?.name, pct: analytics.top5[0]?.sharePct })}
            </div>
          </div>
        </div>
      )}

      {/* Analytics KPI row 2 — Supplier & Customer Dynamics */}
      {analytics && analytics.activeSuppliersFY !== undefined && (
        <div className="grid grid-cols-12 gap-5 mb-5">

          {/* Active Suppliers */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Active Suppliers FY / MTD', what: 'Number of unique supplier parties that had at least one purchase invoice this financial year (FY) and this month (MTD). The top-5 concentration % shows if spend is dangerously concentrated in a few vendors.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=14, Cancelled=0 · COUNT DISTINCT MasterCode1' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('sales.activeSuppliersLabel')}</div>
            <div className="text-[28px] font-extrabold mt-1 num text-blue-700">{analytics.activeSuppliersFY}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t('sales.fyLabel')} · <strong>{analytics.activeSuppliersMTD}</strong> {t('sales.thisMonth')}</div>
            <div className="mt-2 text-[10px] text-slate-400">
              {t('sales.top5Share')}: <strong className="text-amber-600">{analytics.top5SupplierConcentrationPct}%</strong>
            </div>
          </div>

          {/* New vs Lapsed Customers */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Customer Flow MTD', what: 'New = customers whose very first-ever invoice was this month. Lapsed = customers active last month who have zero invoices so far this month. Net = New minus Lapsed — an early churn signal.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0 · MIN(Date) per party for New; EXCEPT query for Lapsed', note: 'Lapsed uses an EXCEPT between last-month buyers and this-month buyers.' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">{t('sales.customerFlowLabel')}</div>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-[24px] font-extrabold text-green-600">{analytics.newCustomersMTD}</div>
                <div className="text-[10px] text-slate-500">{t('sales.new')}</div>
              </div>
              <div className="h-8 w-px bg-blue-200"/>
              <div>
                <div className="text-[24px] font-extrabold text-red-500">{analytics.lapsedCustomersMTD}</div>
                <div className="text-[10px] text-slate-500">{t('sales.lapsed')}</div>
              </div>
            </div>
            <div className="mt-2">
              <DeltaBadge value={analytics.newCustomersMTD - analytics.lapsedCustomersMTD} unit=" net" />
            </div>
          </div>

          {/* GST Net Position */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'GST Net Position MTD', what: 'GST Output (collected from customers) minus GST Input ITC (paid to suppliers). Positive = amount payable to government. Negative = ITC refund position.', source: 'Derived', formula: 'GST Net = Output MTD − Input ITC MTD', tables: ['VchGSTSumItemWise'], dbPath: 'BusyFY2026 > dbo > Tables > VchGSTSumItemWise', filter: 'Output: VchType=9 · Input: VchType=14, current month' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('sales.gstNetPositionLabel')}</div>
            <div className={`text-[22px] font-extrabold num mt-1 ${analytics.gstNetMTD > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {analytics.gstNetMTD > 0 ? '+' : ''}{fmtINR(Math.abs(analytics.gstNetMTD))}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 mb-3">
              {analytics.gstNetMTD > 0 ? t('sales.payableToGovernment') : t('sales.itcRefundPosition')}
            </div>
            <BulletCompare
              left={analytics.gstOutputMTD || 0}
              right={analytics.gstInputMTD || 0}
              leftLabel={`Output ${fmtINR(analytics.gstOutputMTD || 0)}`}
              rightLabel={`ITC ${fmtINR(analytics.gstInputMTD || 0)}`}
              leftColor="#DC2626"
              rightColor="#16A34A"
            />
          </div>

          {/* Invoice Frequency */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Invoice Frequency', what: 'Average number of invoices raised per customer over the full financial year. >3× = sticky repeat buyers. 2-3× = moderate repeat. <2× = largely transactional, one-off purchases.', source: 'Derived', formula: 'Frequency = FY Invoice Count / Unique Customers FY', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('sales.invoiceFrequencyLabel')}</div>
            <div className="text-[28px] font-extrabold num text-blue-700">{analytics.invoiceFrequency}×</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t('sales.avgInvoicesPerCustomer')}</div>
            <div className="mt-2">
              <span style={{
                padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                background: analytics.invoiceFrequency >= 3 ? '#F0FDF4' : analytics.invoiceFrequency >= 2 ? '#FEF3C7' : '#FEF2F2',
                color: analytics.invoiceFrequency >= 3 ? '#15803D' : analytics.invoiceFrequency >= 2 ? '#92400E' : '#DC2626',
              }}>
                {analytics.invoiceFrequency >= 3 ? t('sales.stickyBuyers') : analytics.invoiceFrequency >= 2 ? t('sales.moderateRepeat') : t('sales.transactional')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Info banner */}
      <div className="card p-5 mb-5" style={{ background: '#FFF7E6', border: '1px solid #FCD9C5', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Sales → Ops Pipeline', what: 'Explains the auto-cascade: when a sale is logged in BUSY, it triggers stock deduction, contract balance update, labour cost posting, and syncs back to this dashboard — all without manual re-entry. This card is an informational note, not a data tile.', source: 'Mock data', note: 'Static explainer banner. No data source.' }} />
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <div>
            <div className="font-semibold text-sm">{t('sales.feedsTitle')}</div>
            <div className="text-[12px] text-slate-600 mt-1">
              {t('sales.feedsBody')}
            </div>
          </div>
        </div>
      </div>

      {/* Contracts table — green-soft */}
      <div className="card p-6" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Sales Contracts Table', what: 'All customer contracts with locked-in price and density spread. Shows FY sales, MTD sales, invoice count, and outstanding balance per customer. Status (On Track / Overdue / Cleared) is derived from BUSY outstanding balance. Live data from BUSY DB.', source: 'BUSY DB', tables: ['Tran1', 'Master1', 'DailySum'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1', filter: 'VchType=9, Cancelled=0 · outstanding from DailySum/Master1 ParentGrp=116' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">{t('sales.contractsTitle')}</div>
            <div className="text-xs text-slate-500">{t('sales.contractsSub')}</div>
          </div>
          <button
            className="btn-ghost pill px-4 py-2 font-semibold text-sm flex items-center gap-2"
            onClick={handleExport}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {t('sales.export')}
          </button>
          <button
            className="btn-accent pill px-4 py-2 font-semibold text-sm"
            onClick={() => setShowModal(true)}
          >
            {t('sales.newContract')}
          </button>
        </div>
        <TableSearch value={salesSearch} onChange={setSalesSearch} placeholder={t('sales.searchPh', 'Search customer…')} />
        {filteredContracts.length === 0 ? (
          <EmptyState title={salesSearch ? t('sales.noMatches', 'No customers match your search.') : t('sales.noContracts', 'No contracts — data loads from BUSY')} />
        ) : (
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>{t('sales.colCustomer')}</th>
                <th className="num">{t('sales.colFySales')}</th>
                <th className="num">{t('sales.colMtdSales')}</th>
                <th className="num">{t('sales.colInvoices')}</th>
                <th className="num">{t('sales.colOutstanding')}</th>
                <th>{t('sales.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {salesPg.pageRows.map(c => {
                const sc = c.status === 'on track' ? '#16A34A' : c.status === 'cleared' ? '#475569' : '#DC2626';
                const sb = c.status === 'on track' ? '#DCFCE7' : c.status === 'cleared' ? '#F1F5F9' : '#FEE2E2';
                return (
                  <tr key={c.customer} style={{ cursor: 'pointer' }}>
                    <td className="font-semibold">{c.customer}</td>
                    <td className="num">{fmtINR(c.totalSales)}</td>
                    <td className="num">{fmtINR(c.mtdSales)}</td>
                    <td className="num">{c.invoiceCount}</td>
                    <td className="num font-semibold" style={{ color: c.outstanding > 0 ? '#F47651' : '#475569' }}>
                      {c.outstanding > 0 ? fmtINR(c.outstanding) : '—'}
                    </td>
                    <td>
                      <span className="badge" style={{ background: sb, color: sc }}>
                        {c.status === 'on track' ? t('sales.statusOnTrack') : c.status === 'cleared' ? t('sales.statusCleared') : t('sales.statusOverdue')}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination controls={salesPg.controls} />
        </div>
        )}
      </div>

      {/* ── New Contract Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) handleCloseModal(); }}
        >
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-7 relative">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Sales · Contracts</div>
                <div className="text-xl font-bold">New sales contract</div>
                <div className="text-xs text-slate-500 mt-1">Lock in price and booked quantity for a customer</div>
              </div>
              <button
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0 ml-4 transition-colors"
                onClick={handleCloseModal}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {formSaved ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </div>
                <div className="font-semibold text-green-700">Contract saved</div>
                <div className="text-xs text-slate-500 mt-1">Syncing to Busy…</div>
              </div>
            ) : (
              <>
                {/* Form fields */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Customer name *</label>
                    <input
                      type="text"
                      value={form.customer}
                      onChange={e => handleFormChange('customer', e.target.value)}
                      placeholder="e.g. Samarth Polymers"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Density grade</label>
                    <div className="flex gap-2 flex-wrap">
                      {DENSITY_OPTIONS.map(d => (
                        <button
                          key={d}
                          onClick={() => handleFormChange('density', d)}
                          className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                            form.density === d
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Locked price (₹/drum) *</label>
                      <input
                        type="number"
                        value={form.lockedPrice}
                        onChange={e => handleFormChange('lockedPrice', e.target.value)}
                        placeholder="e.g. 85"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Booked quantity (drums) *</label>
                      <input
                        type="number"
                        value={form.bookedQty}
                        onChange={e => handleFormChange('bookedQty', e.target.value)}
                        placeholder="e.g. 50"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 transition"
                      />
                    </div>
                  </div>

                  {/* Estimated value preview */}
                  {form.lockedPrice && form.bookedQty && (
                    <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
                      <div className="text-[11px] text-orange-600 font-semibold uppercase tracking-wider">Contract value</div>
                      <div className="text-xl font-extrabold num mt-0.5">
                        ₹ {(Number(form.lockedPrice) * Number(form.bookedQty)).toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-slate-500">{form.bookedQty} drums × ₹{form.lockedPrice} · density {form.density}</div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 mt-6">
                  <button
                    className="btn-ghost pill flex-1 py-3 font-semibold text-sm"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-accent pill flex-1 py-3 font-semibold text-sm"
                    disabled={!form.customer.trim() || !form.lockedPrice || !form.bookedQty}
                    onClick={handleSaveContract}
                    style={{ opacity: (!form.customer.trim() || !form.lockedPrice || !form.bookedQty) ? 0.5 : 1 }}
                  >
                    Save contract
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
