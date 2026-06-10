import { Router } from 'express';
import { getPool } from '../db.js';
import { withFallback } from '../lib/fallback.js';

const router = Router();

// KPI #1 Sales MTD, #2 Purchase MTD, #3 Pending Receivables,
// #4 Overdue debtors, #7 Total vouchers, #15 FY Revenue vs Purchase
// Note: In BUSY DB — Tran3.Status: 1=pending, 2=cleared
//                   — Tran1.Cancelled: bit (0=active, 1=cancelled)
router.get('/overview', withFallback('kpis-overview', async () => {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        -- Sales MTD (#1)
        (SELECT ISNULL(SUM(VchAmtBaseCur), 0) FROM Tran1
         WHERE VchType = 9 AND Cancelled = 0
           AND MONTH([Date]) = MONTH(GETDATE()) AND YEAR([Date]) = YEAR(GETDATE())
        ) AS salesMTD,

        -- Purchase MTD (#2)
        (SELECT ISNULL(SUM(VchAmtBaseCur), 0) FROM Tran1
         WHERE VchType = 14 AND Cancelled = 0
           AND MONTH([Date]) = MONTH(GETDATE()) AND YEAR([Date]) = YEAR(GETDATE())
        ) AS purchaseMTD,

        -- Pending product deliveries (Tran3 Status=1=pending, total balance)
        (SELECT ISNULL(SUM(Balance1), 0) FROM Tran3 WHERE [Status] = 1) AS pendingBills,

        -- Customer outstanding (sum of positive Dr-Cr for all Sundry Debtors from DailySum)
        (SELECT ISNULL(SUM(net), 0) FROM (
          SELECT SUM(ISNULL(Dr1,0)-ISNULL(Cr1,0)) AS net
          FROM DailySum
          WHERE MasterCode1 IN (SELECT Code FROM Master1 WHERE MasterType=2 AND ParentGrp=116)
          GROUP BY MasterCode1
          HAVING SUM(ISNULL(Dr1,0)-ISNULL(Cr1,0)) > 0
        ) x) AS debtorsOutstanding,

        -- Count of customers with outstanding (Dr > Cr in DailySum)
        (SELECT COUNT(*) FROM (
          SELECT MasterCode1
          FROM DailySum
          WHERE MasterCode1 IN (SELECT Code FROM Master1 WHERE MasterType=2 AND ParentGrp=116)
          GROUP BY MasterCode1
          HAVING SUM(ISNULL(Dr1,0)-ISNULL(Cr1,0)) > 0
        ) x) AS debtorCount,

        -- FY Revenue (all Sales invoices this FY)
        (SELECT ISNULL(SUM(VchAmtBaseCur), 0) FROM Tran1
         WHERE VchType = 9 AND Cancelled = 0) AS fyRevenue,

        -- FY Purchase
        (SELECT ISNULL(SUM(VchAmtBaseCur), 0) FROM Tran1
         WHERE VchType = 14 AND Cancelled = 0) AS fyPurchase,

        -- Total sales invoices count FY
        (SELECT COUNT(*) FROM Tran1 WHERE VchType = 9 AND Cancelled = 0) AS salesInvoiceCount,

        -- Total purchase invoices count FY
        (SELECT COUNT(*) FROM Tran1 WHERE VchType = 14 AND Cancelled = 0) AS purchaseInvoiceCount,

        -- Payments made MTD (VchType=19=Payment)
        (SELECT ISNULL(SUM(VchAmtBaseCur), 0) FROM Tran1
         WHERE VchType = 19 AND Cancelled = 0
           AND MONTH([Date]) = MONTH(GETDATE()) AND YEAR([Date]) = YEAR(GETDATE())
        ) AS paymentsMTD,

        -- Receipts received MTD (VchType=16=Receipt)
        (SELECT ISNULL(SUM(VchAmtBaseCur), 0) FROM Tran1
         WHERE VchType = 16 AND Cancelled = 0
           AND MONTH([Date]) = MONTH(GETDATE()) AND YEAR([Date]) = YEAR(GETDATE())
        ) AS receiptsMTD
    `);

    return result.recordset[0];
}));

// KPI #6 Monthly revenue trend (last 6 months)
router.get('/revenue-trend', withFallback('kpis-revenue-trend', async () => {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        YEAR([Date]) AS yr,
        MONTH([Date]) AS mo,
        SUM(VchAmtBaseCur) AS revenue,
        COUNT(*) AS invoiceCount
      FROM Tran1
      WHERE VchType = 9
        AND Cancelled = 0
        AND [Date] >= DATEADD(MONTH, -5,
              DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
      GROUP BY YEAR([Date]), MONTH([Date])
      ORDER BY yr, mo
    `);

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const trend = result.recordset.map(r => ({
      month: months[r.mo - 1] + ' ' + r.yr,
      revenue: r.revenue,
      invoiceCount: r.invoiceCount,
    }));

    return trend;
}));

export default router;
