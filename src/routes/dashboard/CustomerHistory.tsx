import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOverviewKPIs, useTopCustomers, useCustomerList, useAnalyticsKPIs, fmtINR } from '../../hooks/useBusyData';
import { ConcentrationBar, MiniBarChart } from '../../components/charts/AnalyticsViz';
import { KpiInfoButton } from '../../components/KpiInfoButton';

export function CustomerHistory() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const { data: kpis } = useOverviewKPIs();
  const { data: topCustomers } = useTopCustomers(1);
  const { data: customerList } = useCustomerList();
  const { data: analytics } = useAnalyticsKPIs();

  const topCustomer = topCustomers?.[0];

  const filteredList = (customerList || []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* KPIs — live from BUSY — blue tiles */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Customers with Outstanding', what: 'Count of unique debtor parties in BUSY Sundry Debtors that have a non-zero positive (Dr) balance outstanding.', source: 'BUSY DB', tables: ['DailySum', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > DailySum\nBusyFY2026 > dbo > Tables > Master1', filter: 'Master1.ParentGrp=116, MasterType=2 (Sundry Debtors)' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('customers.customersWithOutstanding')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">{kpis ? kpis.debtorCount : '…'}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('customers.fromBusySundryDebtors')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Top Customer MTD', what: 'Customer with the highest sales revenue in the current calendar month, including invoice count.', source: 'BUSY DB', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1', filter: 'VchType=9, Cancelled=0, current month · TOP 1 by SUM(VchAmtBaseCur)' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('customers.topCustomerMtdBusy')}</div>
          <div className="text-[16px] font-extrabold mt-1 leading-tight text-blue-700">
            {topCustomer ? topCustomer.name : '…'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {topCustomer ? fmtINR(topCustomer.mtdRevenue) + ' · ' + topCustomer.invoiceCount + ' ' + t('customers.invoices') : ''}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Total Debtors Outstanding', what: 'Sum of all outstanding Dr balances across every customer in the Sundry Debtors group. This is the total receivables the company is owed.', source: 'BUSY DB', tables: ['DailySum', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > DailySum\nBusyFY2026 > dbo > Tables > Master1', filter: 'Master1.ParentGrp=116, MasterType=2 · SUM(Dr - Cr)' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('customers.totalDebtorsOutstanding')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">{kpis ? fmtINR(kpis.debtorsOutstanding) : '…'}</div>
          <div className="text-[11px] text-slate-500 mt-1">{t('customers.drBalanceSundryDebtors')}</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #bfdbfe', position: 'relative' }}>
          <KpiInfoButton info={{ title: 'FY Sales Invoices', what: 'Total number of sales invoices raised during the current financial year, and the cumulative revenue they represent.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0, YEAR(Date)=current FY' }} />
          <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('customers.fySalesInvoices')}</div>
          <div className="text-[28px] font-extrabold mt-1 num text-blue-700">{kpis ? kpis.salesInvoiceCount : '…'}</div>
          <div className="text-[11px] text-slate-500 mt-1">{kpis ? fmtINR(kpis.fyRevenue) + ' ' + t('customers.total') : ''}</div>
        </div>
      </div>

      {/* Analytics row */}
      {analytics && (
        <div className="grid grid-cols-12 gap-5 mb-5">
          {/* Revenue per Customer */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Revenue per Customer', what: 'Average revenue generated per unique buying customer over the full financial year. Increasing trend = deeper wallet share. Decreasing = customer base growing faster than revenue.', source: 'Derived', formula: 'Rev/Customer = FY Revenue / Unique Customers FY', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('customers.revenuePerCustomerFy')}</div>
            <div className="text-[24px] font-extrabold mt-1 num text-slate-800">{fmtINR(analytics.revenuePerCustomer)}</div>
            <div className="text-[11px] text-slate-500 mt-1">{t('customers.acrossUniqueBuyers', { count: analytics.uniqueCustomersFY })}</div>
          </div>

          {/* Debtor Turnover */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Debtor Turnover Ratio', what: 'How many times per year the total debtor book is "turned over" (collected and replaced). Higher is better. Directly linked to DSO — Turnover = 365 / DSO.', source: 'Derived', formula: 'Turnover = FY Revenue / Debtors Outstanding\nDSO = 365 / Turnover', tables: ['Tran1', 'DailySum', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > DailySum' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">{t('customers.debtorTurnoverRatio')}</div>
            <div className="text-[24px] font-extrabold mt-1 num text-slate-800">{analytics.debtorTurnover}×</div>
            <div className="text-[11px] text-slate-500 mt-1">{t('customers.dsoDaysTarget', { count: analytics.dso })}</div>
          </div>

          {/* Top-5 Concentration — full width bar */}
          <div className="col-span-12 lg:col-span-6 card p-5" style={{ position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Top-5 Customer Revenue Concentration', what: 'Visual breakdown of how much of total FY revenue is held by the 5 largest customers. Wider bars = more dependency. "Others" is everything outside the top 5.', source: 'Derived', formula: 'Share% = Customer FY Revenue / Total FY Revenue × 100', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1', filter: 'VchType=9, Cancelled=0 · TOP 5 by SUM' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">{t('customers.top5CustomerRevenueConcentration')}</div>
            <ConcentrationBar segments={analytics.top5} />
          </div>
        </div>
      )}

      {/* Analytics row 2 — Supplier & Purchase intel */}
      {analytics && analytics.top5Suppliers !== undefined && (
        <div className="grid grid-cols-12 gap-5 mb-5">

          {/* Invoice Frequency */}
          <div className="col-span-6 lg:col-span-3 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Invoice Frequency', what: 'Average invoices per customer in the financial year. >3× indicates customers order repeatedly (sticky). <2× is transactional — single-use buyers with churn risk.', source: 'Derived', formula: 'Frequency = FY Invoice Count / Unique Customers FY', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=9, Cancelled=0' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('customers.invoiceFrequencyFy')}</div>
            <div className="text-[28px] font-extrabold num text-blue-700">{analytics.invoiceFrequency}×</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{t('customers.avgInvoicesPerCustomer')}</div>
            <div className="mt-2">
              <span style={{
                padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                background: analytics.invoiceFrequency >= 3 ? '#F0FDF4' : '#FEF3C7',
                color: analytics.invoiceFrequency >= 3 ? '#15803D' : '#92400E',
              }}>
                {analytics.invoiceFrequency >= 3 ? t('customers.stickyRepeatBuyers') : t('customers.moderateRepeatRate')}
              </span>
            </div>
          </div>

          {/* Top-5 Supplier Concentration */}
          <div className="col-span-12 lg:col-span-5 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Top-5 Supplier Spend Concentration', what: 'How much of total FY purchasing spend goes to the 5 largest suppliers. High concentration = supply chain risk — one vendor failing disrupts production.', source: 'Derived', formula: 'Share% = Supplier FY Purchase / Total FY Purchase × 100', tables: ['Tran1', 'Master1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1', filter: 'VchType=14, Cancelled=0 · TOP 5 by SUM(VchAmtBaseCur)' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">{t('customers.top5SupplierSpendConcentration')}</div>
            <ConcentrationBar segments={analytics.top5Suppliers.map(s => ({ name: s.name, sharePct: s.sharePct }))} />
          </div>

          {/* Monthly Purchase Trend */}
          <div className="col-span-12 lg:col-span-4 card p-5" style={{ background: 'var(--blue-soft)', border: '1px solid #BFDBFE', position: 'relative' }}>
            <KpiInfoButton info={{ title: 'Monthly Purchase Trend (6 months)', what: 'Total purchase spend per calendar month for the last 6 months. A rising trend while revenue stays flat = margin compression. Falling purchase costs = positive.', source: 'BUSY DB', tables: ['Tran1'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1', filter: 'VchType=14, Cancelled=0, last 6 months · GROUP BY year/month' }} />
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{t('customers.monthlyPurchaseTrend6m')}</div>
            <MiniBarChart
              data={analytics.monthlyPurchase.map(m => m.purchase)}
              labels={analytics.monthlyPurchase.map(m => m.label)}
              color="#2563EB"
              height={48}
            />
          </div>
        </div>
      )}

      {/* Customer ledger — green-soft */}
      <div className="card p-6 mb-5" style={{ background: 'var(--green-soft)', border: '1px solid #bbf7d0', position: 'relative' }}>
        <KpiInfoButton info={{ title: 'Customer Ledger', what: 'Full list of all customer parties with FY sales, MTD sales, invoice count, and outstanding Dr balance. Data is live from BUSY. Click any customer row to view their full history and density preferences.', source: 'BUSY DB', tables: ['Tran1', 'Master1', 'DailySum'], dbPath: 'BusyFY2026 > dbo > Tables > Tran1\nBusyFY2026 > dbo > Tables > Master1\nBusyFY2026 > dbo > Tables > DailySum', filter: 'VchType=9, Cancelled=0 · outstanding from DailySum grouped by Master1.Code' }} />
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-base font-bold">{t('customers.customerLedger')}</div>
            <div className="text-xs text-slate-500">{t('customers.ledgerHint')}</div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('customers.searchCustomerPlaceholder')}
            className="px-4 py-2 bg-slate-50 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <div className="overflow-x-auto scroll-x">
          <table className="dt">
            <thead>
              <tr>
                <th>{t('customers.colCustomerBusy')}</th>
                <th className="num">{t('customers.colMtdSales')}</th>
                <th className="num">{t('customers.colFySales')}</th>
                <th className="num">{t('customers.colFyInvoices')}</th>
                <th className="num">{t('customers.colOutstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map(c => (
                <tr key={c.code} style={{ cursor: 'pointer' }}>
                  <td className="font-semibold">{c.name}</td>
                  <td className="num font-bold">{fmtINR(c.mtdRevenue)}</td>
                  <td className="num text-slate-500">{fmtINR(c.fyRevenue)}</td>
                  <td className="num text-slate-500">{c.fyInvoices}</td>
                  <td className={`num font-semibold ${c.outstanding > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                    {c.outstanding > 0 ? fmtINR(c.outstanding) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Dispatch History', what: 'Monthly drums dispatched to the top customer over the last 6 months. Used to spot seasonal patterns and forecast the next order.', source: 'BUSY DB', note: 'No per-month per-customer dispatch series is available yet — shows an empty state instead of sample numbers. Future: pull from Tran1 WHERE MasterCode1 = customer code, grouped by month.' }} />
          <div className="text-base font-bold">
            {topCustomer ? topCustomer.name : t('customers.densityPreference')} · {t('customers.last6Months')}
          </div>
          <div className="text-xs text-slate-500 mb-4">{t('customers.drumsDispatchedPerMonth')}</div>
          <div className="py-10 text-center text-sm text-slate-400">
            No dispatch history available yet.
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 card p-6" style={{ position: 'relative' }}>
          <KpiInfoButton info={{ title: 'Density Preference Chart', what: 'Breakdown of the customer\'s order volume by CP density grade (1300, 1400, 1450, 1500). Shows which density grades they predominantly purchase — important for production planning and stock allocation.', source: 'BUSY DB', note: 'No per-customer density breakdown source is available yet — shows an empty state instead of sample numbers. Future: derived from Tran1 joined with item/density metadata.' }} />
          <div className="text-base font-bold">{t('customers.densityPreference')}</div>
          <div className="text-xs text-slate-500 mb-4">{t('customers.whereVolumeSits')}</div>
          <div className="py-10 text-center text-sm text-slate-400">
            No density breakdown available yet.
          </div>
        </div>
      </div>
    </>
  );
}
