import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, RefreshCw, Activity, Download, Cpu, Sparkles, Database, Check } from 'lucide-react';
import { SlidePanel } from '../../components/SlidePanel';
import { useAnomalies } from '../../contexts/AnomalyContext';
import { useExportFeatures } from '../../lib/anomaly/useAnomalies';
import { AnomalyCard } from '../../components/anomaly/AnomalyCard';
import { ProblemKpiGrid } from '../../components/anomaly/ProblemKpiGrid';
import { AnomalyDrilldown } from '../../components/anomaly/AnomalyDrilldown';
import { MetricExplorer } from '../../components/anomaly/MetricExplorer';
import { AnomalyAnalyticsGrid } from '../../components/anomaly/AnomalyAnalyticsGrid';
import { LEVEL_COLOR, LEVEL_BG, LEVEL_LABEL, LEVEL_ORDER } from '../../lib/anomaly/levels';
import type { AnomalyFinding, Level } from '../../lib/anomaly/types';

function TierPill({ level, count, active, onClick }: { level: Level; count: number; active: boolean; onClick: () => void }) {
  const color = LEVEL_COLOR[level];
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 120, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      background: active ? color : LEVEL_BG[level], borderRadius: 16, padding: '14px 18px',
      border: `1.5px solid ${active ? color : `${color}33`}`, transition: 'all 0.12s',
    }}>
      <div style={{ fontSize: 30, fontWeight: 800, color: active ? '#fff' : color, lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#fff' : color, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{LEVEL_LABEL[level]}</div>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>{children}</div>;
}

export function AnomalyDashboard() {
  const { t } = useTranslation();
  const { scan, findings, loading, error, refetch } = useAnomalies();
  const exporter = useExportFeatures();
  const [selected, setSelected] = useState<AnomalyFinding | null>(null);
  const [tierModal, setTierModal] = useState<Level | null>(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const a = params.get('a');
    if (a && findings.length) { const f = findings.find(x => x.id === a); if (f) setSelected(f); }
  }, [params, findings]);

  const levels = scan?.summary.levels ?? { mild: 0, moderate: 0, heavy: 0, extreme: 0 };
  const tierFindings = tierModal ? findings.filter(f => f.level === tierModal) : [];

  function openFinding(f: AnomalyFinding) { setTierModal(null); setSelected(f); setParams({ a: f.id }); }
  function closeFinding() { setSelected(null); setParams({}); }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={20} color="#D97706" />
          </div>
          <div style={{ fontSize: 13, color: '#64748B' }}>
            {t('anomaly.scanSubtitle')} · {scan?.anchor_date ? t('anomaly.dataThrough', { date: new Date(scan.anchor_date).toLocaleDateString('en-IN') }) : '—'}
            {scan?._fallback && <span style={{ color: '#D97706' }}> · {t('anomaly.cached')}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exporter.mutate()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 20, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}>
            {exporter.isSuccess ? <Check size={13} color="#16A34A" /> : <Download size={13} />}
            {exporter.isPending ? t('anomaly.exporting') : exporter.isSuccess ? t('anomaly.savedCsvs', { count: exporter.data?.count }) : t('anomaly.exportFeatures')}
          </button>
          <button onClick={refetch}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 20, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}>
            <RefreshCw size={13} /> {t('anomaly.rescan')}
          </button>
        </div>
      </div>

      {/* Severity tiers (mild → extreme) — click a tier to view its anomalies */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        {LEVEL_ORDER.map(l => (
          <TierPill key={l} level={l} count={levels[l]} active={tierModal === l}
            onClick={() => setTierModal(l)} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 22 }}>{t('anomaly.clickTierHint')}</div>

      {/* Problem-KPI grid */}
      {scan?.kpis && scan.kpis.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>{t('anomaly.keyMetricsTitle')}</SectionTitle>
          <ProblemKpiGrid kpis={scan.kpis} />
        </div>
      )}

      {/* Risk analytics — multi-plot grid */}
      <div style={{ marginBottom: 26 }}>
        <SectionTitle>{t('anomaly.riskAnalytics')}</SectionTitle>
        <AnomalyAnalyticsGrid />
      </div>

      {/* Metric Explorer — interactive charts with granularity */}
      <div style={{ marginBottom: 26 }}>
        <SectionTitle>{t('anomaly.metricExplorerTitle')}</SectionTitle>
        <MetricExplorer />
      </div>

      {/* AI & methodology / data dependency panel */}
      <MethodologyPanel />

      {/* Tier popup — opened from a severity pill */}
      {tierModal && (
        <SlidePanel open onClose={() => setTierModal(null)} subtitle={t('anomaly.detectedAnomalies')}
          title={`${LEVEL_LABEL[tierModal]} · ${tierFindings.length}`}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: 13 }}>{t('anomaly.scanningLiveData')}</div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94A3B8', fontSize: 13 }}>{t('anomaly.engineUnreachable')}</div>
          ) : tierFindings.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '36px 0', color: '#16A34A' }}>
              <ShieldCheck size={34} />
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10, color: '#15803D' }}>{t('anomaly.noTierAnomalies', { level: LEVEL_LABEL[tierModal].toLowerCase() })}</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>{t('anomaly.nothingAtSeverity')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tierFindings.map(f => <AnomalyCard key={f.id} finding={f} onClick={() => openFinding(f)} />)}
            </div>
          )}
        </SlidePanel>
      )}

      <AnomalyDrilldown finding={selected} open={!!selected} onClose={closeFinding} />
    </div>
  );
}

function MethodologyPanel() {
  const { t } = useTranslation();
  const card: React.CSSProperties = { flex: 1, minWidth: 240, background: '#fff', border: '1px solid #EEF2F6', borderRadius: 16, padding: '16px 18px' };
  return (
    <div style={{ marginTop: 30 }}>
      <SectionTitle>{t('anomaly.howItWorksTitle')}</SectionTitle>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Cpu size={16} color="#2563EB" /><span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{t('anomaly.statEngineTitle')}</span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            Deterministic detectors decide <strong>what</strong> is anomalous: rolling z-score, EWMA drift, robust MAD (outlier-tolerant), and IQR fences over engineered features. Severity tier = max(|z|, |robust-z|): mild ≥2σ, moderate ≥2.5σ, heavy ≥3.5σ, extreme ≥5σ.
          </div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Sparkles size={16} color="#9333EA" /><span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{t('anomaly.aiAnalystTitle')}</span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            Llama-3.3-70B explains <strong>why</strong> — the root-cause story and recommended action — given only the numbers the engine already computed. It never decides severity and never invents figures. Open any anomaly to see its analysis.
          </div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Database size={16} color="#16A34A" /><span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{t('anomaly.dataDependencyTitle')}</span>
          </div>
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            Financial detectors run on <strong>real BUSY data</strong> (live, ~2 months). Statistical baselines sharpen as more history accrues; thin metrics show as <em>calibrating</em> rather than false-firing. Engineered features are exported to <code style={{ fontSize: 11 }}>data/anomaly/*.csv</code>.
          </div>
        </div>
      </div>
    </div>
  );
}
