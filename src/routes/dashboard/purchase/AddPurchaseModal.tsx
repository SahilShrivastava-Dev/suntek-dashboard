import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows } from '../../../lib/db';
import { uploadWorkflowFile } from '../../../lib/cloudinary';
import { usePlantScope } from '../../../contexts/PlantScopeContext';
import { useRoleContext } from '../../../contexts/RoleContext';
import { deriveEquipment, normalizeUnit } from '../../../lib/store/parseStockFile';
import { parseBill, matchCandidates, type ParsedBill, type StockLite } from '../../../lib/store/purchaseParse';
import { ProgressBar, useFakeProgress } from '../../../components/ui/ProgressBar';

type StockItem = StockLite & { plant_id: string | null };
type Plant = { id: string; name: string };

interface Line {
  key: string;
  name: string;
  qty: string;
  unit: string;
  amount: number | null;
  choice: string;              // store_item id, or 'new'
}

function errMsg(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  const o = e as { message?: string; details?: string; hint?: string };
  return o.message || o.details || o.hint || JSON.stringify(e);
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
let seq = 0;
const nextKey = () => `l${++seq}`;

/** Self-contained purchase → stock modal. Drops into any tab; loads its own
 *  plants + stock (plant-scoped) so callers only wire open/onClose/onApplied. */
export function AddPurchaseModal({ open, onClose, onApplied }: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { activeProfile } = useRoleContext();
  const { scopeQuery, allowedPlants } = usePlantScope();
  const actorName = activeProfile.name;

  const [plants, setPlants] = useState<Plant[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [mode, setMode] = useState<'choose' | 'manual' | 'bill'>('choose');
  const [stage, setStage] = useState<'choose' | 'parsing' | 'edit' | 'saving' | 'done' | 'error'>('choose');
  const [plantId, setPlantId] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [bill, setBill] = useState<ParsedBill | null>(null);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [parseProg, setParseProg] = useState<{ page: number; pages: number }>({ page: 0, pages: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  // Reading a bill is a single vision-model call with no streamed %; ease a bar
  // toward 85% while it runs and let per-page progress pull it forward.
  const parseFloor = parseProg.pages > 0 ? Math.round(((parseProg.page - 1) / parseProg.pages) * 85) : 0;
  const billProgress = useFakeProgress(stage === 'parsing', { floor: parseFloor });

  // Load plants + current stock (plant-scoped) whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const { data: pl } = await supabase.from('plants').select('id, name').returns<Plant[]>();
      const base = allowedPlants.length ? (allowedPlants as Plant[]) : (pl || []);
      const { data: si } = await scopeQuery(supabase.from('store_items').select('id, item_name, on_hand, unit, plant_id')).returns<StockItem[]>();
      if (!alive) return;
      setPlants(base);
      setPlantId(prev => prev || base[0]?.id || '');
      setStock(si || []);
    })();
    return () => { alive = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const stockForPlant = useMemo(() => stock.filter(s => s.plant_id === plantId), [stock, plantId]);

  function reset() {
    setMode('choose'); setStage('choose'); setLines([]); setBill(null);
    setCloudUrl(null); setFileName(''); setErr(null); setAppliedCount(0);
  }
  function close() { reset(); onClose(); }

  if (!open) return null;

  const candidatesFor = (name: string) => matchCandidates(name, stockForPlant);
  const bestChoice = (name: string) => { const c = candidatesFor(name); return c[0] && c[0].score >= 0.6 ? c[0].id : 'new'; };

  async function handleBill(file: File) {
    setFileName(file.name); setErr(null); setParseProg({ page: 0, pages: 0 }); billProgress.reset(); setStage('parsing');
    try {
      try {
        const up = await uploadWorkflowFile(file, { workflow: 'store-req', subfolder: 'purchase-bills', kind: 'bill', creator: actorName });
        setCloudUrl(up.secure_url);
      } catch { /* archive is best-effort */ }
      const parsed = await parseBill(file, info => setParseProg(info));
      if (!parsed.lineItems.length) throw new Error('No line items could be read from this bill. Try a clearer scan, or add them manually.');
      setBill(parsed);
      setLines(parsed.lineItems.map(li => {
        const name = (li.description || '').trim();
        return { key: nextKey(), name, qty: li.quantity != null ? String(li.quantity) : '', unit: li.unit || '', amount: li.amount ?? null, choice: bestChoice(name) };
      }));
      setStage('edit');
    } catch (e) { setErr(errMsg(e)); setStage('error'); }
  }

  function startManual() { setMode('manual'); setLines([{ key: nextKey(), name: '', qty: '', unit: '', amount: null, choice: 'new' }]); setStage('edit'); }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l));
  }
  function setName(key: string, name: string) {
    updateLine(key, { name, choice: bestChoice(name) });
  }

  async function apply() {
    const valid = lines.filter(l => l.name.trim() && (Number(l.qty) || 0) > 0);
    if (!valid.length) { setErr('Add at least one item with a quantity.'); setStage('error'); return; }
    setStage('saving');
    const refLabel = bill?.invoiceNumber ? `invoice ${bill.invoiceNumber}` : 'manual purchase';
    try {
      let count = 0;
      for (const ln of valid) {
        const qty = Number(ln.qty) || 0;
        // create-new but the name already exists in this plant → increment (avoids unique clash)
        let targetId = ln.choice !== 'new' ? ln.choice : (stockForPlant.find(s => norm(s.item_name) === norm(ln.name))?.id ?? null);
        if (targetId) {
          const { data: si } = await (supabase.from('store_items') as any).select('*').eq('id', targetId).single();
          if (!si) continue;
          const newOnHand = Number(si.on_hand) + qty;
          await (supabase.from('store_items') as any)
            .update({ procured_qty: Number(si.procured_qty) + qty, on_hand: newOnHand, updated_at: new Date().toISOString() }).eq('id', targetId);
          await insertRows('store_stock_events', {
            item_id: targetId, plant_id: plantId, event_type: 'procure', qty_delta: qty, on_hand_after: newOnHand,
            ref: refLabel, justification: `Purchased ${qty} · ${ln.name}${cloudUrl ? ' · bill on file' : ''}`, actor_name: actorName,
          });
        } else {
          const { equipment, model } = deriveEquipment(ln.name.trim());
          const { data: created } = await (supabase.from('store_items') as any).insert({
            plant_id: plantId, item_name: ln.name.trim(), unit: normalizeUnit(ln.unit), equipment, model,
            baseline_qty: 0, procured_qty: qty, issued_qty: 0, manual_delta: 0, on_hand: qty,
          }).select('id').single();
          if (created?.id) await insertRows('store_stock_events', {
            item_id: created.id, plant_id: plantId, event_type: 'procure', qty_delta: qty, on_hand_after: qty,
            ref: refLabel, justification: `New item from purchase · ${ln.name}`, actor_name: actorName,
          });
        }
        count++;
      }
      await insertRows('activity_logs', {
        equipment: `Purchase: ${count} item(s)`, type: 'stock_purchase', date: new Date().toISOString().slice(0, 10),
        done_by: actorName, plant_id: plantId,
        note: `${refLabel}${bill?.supplierName ? ` · ${bill.supplierName}` : ''}${cloudUrl ? ` · bill: ${cloudUrl}` : ''}`,
      });
      setAppliedCount(count); setStage('done'); onApplied();
    } catch (e) { setErr(errMsg(e)); setStage('error'); }
  }

  // Validation banner (bill only): compare line amounts vs invoice total.
  const amountSum = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const totalMismatch = bill?.totalAmount != null && amountSum > 0 && Math.abs(amountSum - bill.totalAmount) / bill.totalAmount > 0.02;

  return (
    <div style={overlay} onClick={() => { if (stage !== 'parsing' && stage !== 'saving') close(); }}>
      <div style={{ ...modal, width: stage === 'edit' ? 'min(760px, 100%)' : 'min(460px, 100%)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Add purchase to stock</div>
          <button onClick={close} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#94A3B8' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 14 }}>New stock bought is added to the register — matched items increment, new items are created.</div>

        {/* Plant picker (always) */}
        {plants.length > 1 && stage === 'choose' && (
          <div style={{ marginBottom: 14 }}>
            <div style={label}>Plant</div>
            <select value={plantId} onChange={e => setPlantId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
              {plants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {stage === 'choose' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setMode('bill'); fileRef.current?.click(); }} style={{ ...btnGhost, flex: 1, padding: '18px 12px', borderColor: '#C7D2FE' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#4338CA' }}>📄 Upload bill (AI)</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>Image or PDF — auto-reads items & quantities</div>
            </button>
            <button onClick={startManual} style={{ ...btnGhost, flex: 1, padding: '18px 12px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>✎ Enter manually</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>Type item + quantity</div>
            </button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleBill(f); e.target.value = ''; }} />
          </div>
        )}

        {stage === 'parsing' && (
          <div style={{ padding: '16px 0 8px' }}>
            <ProgressBar
              pct={billProgress.pct}
              label={parseProg.pages > 1 ? `Reading the bill… page ${parseProg.page} of ${parseProg.pages}` : `Reading the bill… (${fileName})`}
            />
            <div style={{ fontSize: 11, color: '#94A3B8' }}>AI is extracting items &amp; quantities — this can take a few seconds.</div>
          </div>
        )}

        {stage === 'edit' && (
          <div>
            {mode === 'bill' && bill && (
              <div style={{ fontSize: 12, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                {bill.invoiceNumber ? <>Invoice <strong>{bill.invoiceNumber}</strong>{bill.supplierName ? ` · ${bill.supplierName}` : ''} · </> : null}
                <strong>{lines.length}</strong> item(s) read from {bill.pages} page(s).
                {totalMismatch && <span style={{ color: '#B45309' }}> ⚠ line amounts (₹{Math.round(amountSum).toLocaleString('en-IN')}) differ from bill total (₹{Math.round(bill.totalAmount!).toLocaleString('en-IN')}) — verify quantities.</span>}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lines.map(ln => {
                const cands = candidatesFor(ln.name);
                const chosen = ln.choice !== 'new' ? stockForPlant.find(s => s.id === ln.choice) : null;
                const qtyN = Number(ln.qty) || 0;
                return (
                  <div key={ln.key} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <input value={ln.name} onChange={e => setName(ln.key, e.target.value)} placeholder="Item name" style={{ ...inputStyle, flex: 1 }} />
                      <input type="number" value={ln.qty} onChange={e => updateLine(ln.key, { qty: e.target.value })} placeholder="Qty" style={{ ...inputStyle, width: 80 }} />
                      {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(l => l.key !== ln.key))} style={{ border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>}
                    </div>
                    {/* Match confirmation: top-3 candidates + create-new */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>{cands.length ? 'Same as?' : 'No match —'}</span>
                      {cands.map(c => (
                        <button key={c.id} onClick={() => updateLine(ln.key, { choice: c.id })}
                          style={{ ...pill, borderColor: ln.choice === c.id ? '#16A34A' : '#E2E8F0', background: ln.choice === c.id ? '#F0FDF4' : '#fff', color: ln.choice === c.id ? '#16A34A' : '#475569' }}>
                          {c.item_name} · {c.on_hand}
                        </button>
                      ))}
                      <button onClick={() => updateLine(ln.key, { choice: 'new' })}
                        style={{ ...pill, borderColor: ln.choice === 'new' ? '#7C3AED' : '#E2E8F0', background: ln.choice === 'new' ? '#FAF5FF' : '#fff', color: ln.choice === 'new' ? '#7C3AED' : '#475569' }}>
                        ＋ Create new
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B', marginTop: 6 }}>
                      {chosen ? <>→ <strong>{chosen.item_name}</strong>: {chosen.on_hand} + {qtyN} = <strong style={{ color: '#16A34A' }}>{chosen.on_hand + qtyN}</strong></>
                        : <>→ new item <strong>{ln.name || '—'}</strong> with qty <strong style={{ color: '#7C3AED' }}>{qtyN}</strong></>}
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={() => setLines(ls => [...ls, { key: nextKey(), name: '', qty: '', unit: '', amount: null, choice: 'new' }])}
              style={{ width: '100%', padding: '8px', borderRadius: 10, border: '1.5px dashed #CBD5E1', background: '#fff', color: '#475569', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, fontFamily: 'inherit', margin: '10px 0' }}>+ Add line</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={close} style={btnGhost}>Cancel</button>
              <button onClick={apply} style={{ ...btnPrimary, flex: 1 }}>Add to stock</button>
            </div>
          </div>
        )}

        {stage === 'saving' && <div style={{ fontSize: 13, color: '#475569', padding: '20px 0' }}>Updating the register…</div>}

        {stage === 'done' && (
          <div>
            <div style={{ fontSize: 13, color: '#16A34A', marginBottom: 14 }}>✓ Added {appliedCount} item(s) to the stock register.</div>
            <button onClick={close} style={{ ...btnPrimary, width: '100%' }}>Done</button>
          </div>
        )}

        {stage === 'error' && (
          <div>
            <div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: 10, marginBottom: 12 }}>{err}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStage(lines.length ? 'edit' : 'choose')} style={{ ...btnGhost, flex: 1 }}>Back</button>
              <button onClick={close} style={{ ...btnPrimary, flex: 1 }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const modal: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 };
const inputStyle: React.CSSProperties = { boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' };
const pill: React.CSSProperties = { border: '1px solid #E2E8F0', borderRadius: 20, padding: '3px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: 'none', background: '#F47651', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
