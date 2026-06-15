/**
 * AI "analyst" layer — turns a structured anomaly finding into a plain-English
 * root-cause narrative + correlation hypotheses + recommended action.
 *
 * Uses the NVIDIA NIM OpenAI-compatible API (same key the OCR edge functions use,
 * VITE_NVIDIA_API_KEY in .env). The LLM is given ONLY the structured evidence and is
 * instructed to explain the story — never to invent numbers or decide severity.
 * If the key is missing or the call fails, a deterministic template narrative is
 * returned so the dashboard always shows an "AI analysis" block.
 */

const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = 'meta/llama-3.3-70b-instruct';
const apiKey = () => process.env.NVIDIA_API_KEY || process.env.VITE_NVIDIA_API_KEY || '';

const SYSTEM = `You are a manufacturing-operations financial analyst for Suntek Group, a chlorinated-paraffin maker.
You receive ONE anomaly finding as JSON: a metric, its baseline, and supporting evidence already computed from the books.
Write a concise root-cause analysis. Rules:
- Explain the likely causal STORY connecting the numbers (e.g. a vendor switch raising input cost and compressing margin).
- Cite ONLY numbers present in the input. Never invent figures, dates, names, or percentages.
- Format large rupee amounts compactly in Indian units: ₹1,50,00,000 → "₹1.50 Cr"; ₹5,20,000 → "₹5.2 L". Never print raw long numbers.
- Do not re-decide whether it is an anomaly or its severity — that is already decided. Explain WHY and WHAT TO DO.
- Return STRICT JSON only, no prose outside it:
  {"narrative": string, "hypotheses": string[], "recommended_action": string, "confidence": "low"|"medium"|"high"}`;

const INR = (n) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n || 0).toLocaleString('en-IN')}`);
const PC = (n) => `${(n * 100).toFixed(1)}%`;

// Pre-formatted, human-readable evidence per anomaly type (no raw numbers reach the LLM).
function formatEvidence(f) {
  const d = f.detail || {};
  switch (f.anomaly_type) {
    case 'MARGIN_COMPRESSION':
      return {
        'gross margin (last 14d)': PC(d.recentMarginPct),
        'gross margin (prior 14d)': PC(d.priorMarginPct),
        'sales (last 14d)': INR(d.recentSales),
        'purchase cost (last 14d)': INR(d.recentPurch),
        'sales (prior 14d)': INR(d.priorSales),
        'purchase cost (prior 14d)': INR(d.priorPurch),
      };
    case 'A14_vendor_switch':
      return {
        'new top vendor': d.newVendor,
        'new vendor spend (14d)': INR(d.newVendorSpend),
        'displaced vendor': d.priorTopVendor,
        'displaced vendor spend': INR(d.priorTopSpend),
        'total purchase (last 14d)': INR(d.recentPurchTotal),
        'total purchase (prior 14d)': INR(d.priorPurchTotal),
      };
    case 'A6_revenue_pace':
      return { 'sales this month-to-date': INR(d.mtdSales), 'sales at same point last month': INR(d.prevPaceSales) };
    case 'A7_customer_silent':
      return { customer: d.customer, 'days since last order': `${d.daysSilent}`, 'FY revenue': INR(d.fyRevenue), outstanding: INR(d.outstanding) };
    case 'A8_credit_risk':
      return { customer: d.customer, outstanding: INR(d.outstanding), 'days since last invoice': `${d.daysSilent}`, 'FY revenue': INR(d.fyRevenue) };
    default:
      return d;
  }
}

export async function buildNarrative(finding) {
  const key = apiKey();
  if (key) {
    try {
      // Send the LLM a pre-formatted, human-readable payload so it physically cannot
      // emit raw long numbers — every figure is already a "₹15.0 Cr" / "12.8%" string.
      const payload = {
        anomaly_type: finding.anomaly_type,
        severity: finding.severity,
        title: finding.title,
        summary: finding.body,
        evidence: formatEvidence(finding),
      };
      const res = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_tokens: 600,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        const parsed = extractJson(content);
        if (parsed?.narrative) return { ...parsed, source: 'nvidia-llama-3.3-70b' };
      }
    } catch {
      /* fall through to template */
    }
  }
  return { ...templateNarrative(finding), source: 'template' };
}

function extractJson(text) {
  try { return JSON.parse(text); } catch { /* try to slice */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

// Deterministic, data-grounded fallback so the UI always has an AI-analysis block.
function templateNarrative(f) {
  const d = f.detail || {};
  const inr = (n) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n || 0).toLocaleString('en-IN')}`);
  const pc = (n) => `${(n * 100).toFixed(1)}%`;

  switch (f.anomaly_type) {
    case 'MARGIN_COMPRESSION':
      return {
        narrative: `Gross margin moved from ${pc(d.priorMarginPct)} to ${pc(d.recentMarginPct)} over the last two 14-day windows. Sales held around ${inr(d.recentSales)} while purchase cost ran at ${inr(d.recentPurch)}, so input cost is climbing faster than revenue. Sustained, this turns the operation loss-making.`,
        hypotheses: [
          'A recent raw-material vendor switch raised the landed input price.',
          'Selling price is locked/fixed while purchase cost rose, squeezing the spread.',
          'Product mix shifted toward lower-margin grades.',
        ],
        recommended_action: 'Compare the current top vendor’s rate against the previous vendor for the same oil grade; if higher, renegotiate or revert, or pass the cost through on new contracts.',
        confidence: 'medium',
      };
    case 'A14_vendor_switch':
      return {
        narrative: `${d.newVendor} became the largest supplier in the last 14 days at ${inr(d.newVendorSpend)}, displacing ${d.priorTopVendor} (${inr(d.priorTopSpend)}). Total purchase spend moved from ${inr(d.priorPurchTotal)} to ${inr(d.recentPurchTotal)}. An unreviewed vendor change is a common source of silent cost leaks.`,
        hypotheses: [
          'The new vendor’s rate is higher than the displaced vendor for the same material.',
          'A supply constraint forced the switch and pricing was not negotiated.',
          'The switch is legitimate but should be confirmed against the approved vendor list.',
        ],
        recommended_action: `Pull ${d.newVendor}’s per-unit rate and compare with ${d.priorTopVendor}; confirm the switch was approved before the next purchase order.`,
        confidence: 'medium',
      };
    case 'A6_revenue_pace':
      return {
        narrative: `Month-to-date sales are ${inr(d.mtdSales)} against ${inr(d.prevPaceSales)} at the same day last month — a ${pc(1 - d.paceRatio)} shortfall in pace. Left unaddressed this becomes a month-end revenue miss.`,
        hypotheses: ['Dispatch pipeline slowed.', 'A large recurring customer has not yet ordered this month.', 'Seasonal demand dip.'],
        recommended_action: 'Review open contracts with zero dispatch and chase the dispatch pipeline before month-end.',
        confidence: 'medium',
      };
    case 'A7_customer_silent':
      return {
        narrative: `${d.customer} (FY revenue ${inr(d.fyRevenue)}) has not ordered for ${d.daysSilent} days and carries ${inr(d.outstanding)} outstanding. A previously regular buyer going quiet often signals a competitor switch or a dispute.`,
        hypotheses: ['Buying from a competitor.', 'Unresolved dispute or quality complaint.', 'Seasonal pause.'],
        recommended_action: `Have sales reach out to ${d.customer} to confirm status and recover the relationship.`,
        confidence: 'medium',
      };
    case 'A8_credit_risk':
      return {
        narrative: `${d.customer} carries ${inr(d.outstanding)} outstanding while still being dispatched to (last invoice ${d.daysSilent} days ago). Continuing to ship to a slow payer escalates credit exposure.`,
        hypotheses: ['Payment terms being stretched.', 'Customer-side cash-flow stress.', 'Missing reconciliation of receipts.'],
        recommended_action: `Place a credit hold review on ${d.customer} and require part-payment before the next dispatch.`,
        confidence: 'high',
      };
    default:
      return {
        narrative: f.body || 'An anomaly was detected in the operational data.',
        hypotheses: [],
        recommended_action: 'Review the underlying records for this entity.',
        confidence: 'low',
      };
  }
}
