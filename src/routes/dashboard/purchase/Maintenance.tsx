import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { insertRows, updateRows } from '../../../lib/db';
import { useRoleContext } from '../../../contexts/RoleContext';
import { MOCK_PROFILES } from '../../../lib/profiles';
import { useBlacklist } from '../../../contexts/BlacklistContext';
import { uploadMaintenancePhoto } from '../../../lib/cloudinary';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, PanelFooter } from '../../../components/SlidePanel';
import { MentionText, NotesButton } from '../../../components/mentions';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import { useDirectory, useMentionNotifier, extractMentionIds, addWatchers, notifyWatchers, truncate } from '../../../lib/mentions';
import { useBlacklistGuard } from '../../../lib/blacklist/guard';
import { exportToCsv, type CsvColumn } from '../../../lib/utils/exportCsv';
import type { AppNotification } from '../../../contexts/NotificationsContext';
import type { Database } from '../../../lib/database.types';
import {
  FREQ_OPTIONS, FREQ_LABEL, STATUS_CFG, STAGE_LABELS,
  statusBadge, formatDate, daysFromNow, dueDateLabel, calculateNextDue,
  PhotoUploader, StageStrip,
} from './maintenance/shared';

type EntityNoteRow = Database['public']['Tables']['entity_notes']['Row'];

// Full date+time for report cells (locale, IST).
function fmtDT(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleString('en-IN') : '';
}
// Map a stored role id (e.g. 'technician_shd') to its human label.
function roleLabelFor(roleId: string | null | undefined): string {
  if (!roleId) return '';
  return MOCK_PROFILES.find((p) => p.id === roleId)?.roleLabel || roleId;
}

// CSV layout for the maintenance report — the full life of each ticket.
const REPORT_COLUMNS: CsvColumn[] = [
  { header: 'Maintenance ID', key: 'id' },
  { header: 'Ref #', key: 'shortId' },
  { header: 'Type', key: 'type' },
  { header: 'Equipment', key: 'equipment' },
  { header: 'Plant', key: 'plant' },
  { header: 'Issue / description', key: 'issue' },
  { header: 'Current status', key: 'status' },
  { header: 'Stage reached', key: 'stage' },
  { header: 'Raised by', key: 'raised_by' },
  { header: 'Raised by role', key: 'raised_role' },
  { header: 'Assigned to', key: 'assigned_to' },
  { header: 'Created at', key: 'created' },
  { header: 'Closed at', key: 'closed' },
  { header: 'Days open', key: 'days' },
  { header: 'How resolved', key: 'how' },
  { header: 'Defective part decision', key: 'defective' },
  { header: 'Part requested', key: 'part' },
  { header: 'Qty requested', key: 'qty' },
  { header: 'Specification', key: 'spec' },
  { header: 'Store decision', key: 'store_decision' },
  { header: 'Qty in store', key: 'qty_in_store' },
  { header: 'Shelf location', key: 'shelf' },
  { header: 'Part condition', key: 'condition' },
  { header: 'Unit head approval', key: 'approval' },
  { header: 'BUSY ref', key: 'busy' },
  { header: 'Handover at', key: 'handover' },
  { header: 'Handover notes', key: 'handover_notes' },
  { header: 'Tagged / watchers', key: 'tagged' },
  { header: 'Notes count', key: 'notes_count' },
];
const NOTE_COLUMNS: CsvColumn[] = [
  { header: 'Maintenance ID', key: 'id' },
  { header: 'Ref #', key: 'shortId' },
  { header: 'Equipment', key: 'equipment' },
  { header: 'Note / activity', key: 'note' },
  { header: 'Author', key: 'author' },
  { header: 'Tagged', key: 'tagged' },
  { header: 'At', key: 'at' },
];

// ── Row types (base table rows + the joined plants(name) relation) ─────────────
type Tables = Database['public']['Tables'];
type PlantRel = { plants?: { name: string | null } | null };
type TicketRow = Tables['maintenance_tickets']['Row'] & PlantRel;
type ScheduleRow = Tables['maintenance_schedules']['Row'] & PlantRel;
type StoreReqRow = Tables['maintenance_store_requests']['Row'];
type NotificationInsert = Tables['notifications']['Insert'];
type TicketUpdate = Tables['maintenance_tickets']['Update'];
type TicketStatus = Tables['maintenance_tickets']['Row']['status'];

// ── Domain write helpers (use Supabase; kept local) ────────────────────────────

function notify(payload: NotificationInsert) {
  insertRows('notifications', payload).then(() => {}, () => {});
}

async function updateTicketStatus(ticketId: string, status: TicketStatus, extra?: TicketUpdate) {
  await updateRows('maintenance_tickets', { status, ...extra })
    .eq('id', ticketId);
}

// People/teams an admin can assign a maintenance task to. Name-based so the
// blacklist guard (which matches on person name) can flag a restricted assignee.
const ASSIGNABLE_ROLE_IDS = ['technician_shd', 'store_manager_maint', 'factory_operator', 'unit_head'];
const ASSIGNABLE_STAFF = MOCK_PROFILES
  .filter((p) => ASSIGNABLE_ROLE_IDS.includes(p.id))
  .map((p) => ({ name: p.name, label: `${p.name} · ${p.roleLabel}` }));

// ── Jharkhand procurement units — store requests route to the matching store manager.
type Unit = 'chlorides' | 'plasticiser';
const UNIT_LABELS: Record<Unit, string> = { chlorides: 'Suntek Chlorides', plasticiser: 'Suntek Plasticiser' };
const UNIT_STORE_MANAGER: Record<Unit, string> = { chlorides: 'store_manager_chlorides', plasticiser: 'store_manager_plasticiser' };
const ALL_STORE_MANAGER_IDS = ['store_manager_maint', 'store_manager_chlorides', 'store_manager_plasticiser', 'warehouse_manager'];
/** Derive a unit from a profile's plant string. */
function unitOf(plant?: string | null): Unit | null {
  const p = (plant || '').toLowerCase();
  if (p.includes('chlorid')) return 'chlorides';
  if (p.includes('plastic')) return 'plasticiser';
  return null;
}

// ── Row actions menu (gear → dropdown) ─────────────────────────────────────────
// Replaces a row of inline buttons with one gear icon that opens a compact menu.
function ScheduleRowMenu({ isActive, deleting, onRevise, onToggle, onDuplicate, onDelete }: {
  isActive: boolean;
  deleting: boolean;
  onRevise: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    function onScroll() { setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#334155',
    textAlign: 'left', whiteSpace: 'nowrap',
  };
  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Manage schedule"
        aria-label="Manage schedule"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0',
          background: open ? '#F1F5F9' : '#fff', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#475569',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{
          position: 'fixed', top: coords.top, right: coords.right, zIndex: 1000,
          minWidth: 168, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(15,23,42,0.14)', padding: 4, overflow: 'hidden',
        }}>
          <button role="menuitem" style={item} onClick={run(onRevise)} onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            Revise
          </button>
          <button role="menuitem" style={item} onClick={run(onToggle)} onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            {isActive ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            )}
            {isActive ? 'Pause' : 'Resume'}
          </button>
          <button role="menuitem" style={item} onClick={run(onDuplicate)} onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            Duplicate
          </button>
          <div style={{ height: 1, background: '#F1F5F9', margin: '4px 0' }} />
          <button role="menuitem" disabled={deleting} style={{ ...item, color: '#DC2626' }} onClick={run(onDelete)} onMouseEnter={e => (e.currentTarget.style.background = '#FEF2F2')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Maintenance() {
  const { activeProfile } = useRoleContext();
  const { isPersonBlacklisted, notifyActivity, tableReady: blacklistReady } = useBlacklist();
  const toast = useToast();
  const people = useDirectory();
  const notifyMentions = useMentionNotifier();
  const screenBlacklist = useBlacklistGuard();
  const actionBusyRef = useRef(false); // guards one-shot workflow actions from double-clicks
  const role = activeProfile.id;

  // ── @-mention / watcher plumbing for tickets ────────────────────────────────
  const ticketRef = (t: TicketRow) => ({
    entityType: 'maintenance_ticket', entityId: t.id,
    entityLabel: t.equipment || t.title || 'Maintenance ticket',
    route: `/dashboard/purchase/maint?ticket=${t.id}`,
  });
  const actorObj = () => ({ id: activeProfile.id, name: activeProfile.name, role: activeProfile.roleLabel });
  // Insert directly (mirrors the module's role-based notify) so it doesn't depend on context tableReady.
  const addNote = async (n: Omit<AppNotification, 'id' | 'created_at' | 'read_by'>) => {
    await insertRows('notifications', { ...n, read_by: [] }).then(() => {}, () => {});
  };
  // Ping everyone tagged / CC'd on a ticket that its workflow moved.
  async function notifyTicketWatchers(t: TicketRow, title: string, body: string, type: AppNotification['type'] = 'info') {
    await notifyWatchers({ ref: ticketRef(t), actor: actorObj(), title, body, type, addNotification: addNote });
  }

  const isTechnician = role === 'technician_shd';
  const isAdmin = role === 'admin';
  const isUnitHead = role === 'unit_head';
  const isStoreManager = ALL_STORE_MANAGER_IDS.includes(role);
  const isPurchaseManager = role === 'purchase_manager';
  const myStoreUnit = unitOf(activeProfile.plant); // for unit-specific store managers

  // Data
  const [tab, setTab] = useState<'periodic' | 'emergency' | 'schedule'>('periodic');
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [dbPlants, setDbPlants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Panel state
  const [completingSchedule, setCompletingSchedule] = useState<ScheduleRow | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [selectedStoreReq, setSelectedStoreReq] = useState<StoreReqRow | null>(null);
  const [showRaisePanel, setShowRaisePanel] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  // When set, the schedule panel is in "revise" mode editing this row; null = creating new.
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  // Form state
  const today = new Date().toISOString().split('T')[0];
  const [raiseForm, setRaiseForm] = useState({ equipment: '', plant: '', description: '', assessment: 'repairable', unit: unitOf(activeProfile.plant) || '' });
  const [scheduleForm, setScheduleForm] = useState({ title: '', equipment: '', plant: '', frequency: 'weekly', description: '', firstDue: today, assignedTo: '' });
  const [storeForm, setStoreForm] = useState({ partName: '', quantity: '', specification: '' });
  const [showStoreForm, setShowStoreForm] = useState(false);

  // Store manager availability form
  const [storeDecisionForm, setStoreDecisionForm] = useState({
    available: null as boolean | null,
    qtyInStore: '',
    shelfLocation: '',
    partCondition: 'new',
  });

  // Handover form (store manager uploads invoice + product photo)
  const [handoverInvoiceBlob, setHandoverInvoiceBlob] = useState<Blob | null>(null);
  const [handoverPhotoBlob, setHandoverPhotoBlob] = useState<Blob | null>(null);
  const [dispatchBlob, setDispatchBlob] = useState<Blob | null>(null); // purchase manager bill photo
  const [handoverNotes, setHandoverNotes] = useState('');

  // Other action state
  const [busyRef, setBusyRef] = useState('');
  const [unitPrice, setUnitPrice] = useState(''); // procurement unit price (₹) → feeds FAR cost
  const [supplierName, setSupplierName] = useState(''); // external vendor → recorded as a Purchase Order
  const [defectiveDecision, setDefectiveDecision] = useState<'repair' | 'scrap' | ''>('');

  // Upload
  const [completionBlob, setCompletionBlob] = useState<Blob | null>(null);
  const [defectiveBlob, setDefectiveBlob] = useState<Blob | null>(null);
  const [raisePhotoBlob, setRaisePhotoBlob] = useState<Blob | null>(null); // optional defective-item photo at raise
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Save states
  const [raiseSaved, setRaiseSaved] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [raising, setRaising] = useState(false);          // double-submit guard
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);

  // Admin edit + report
  const [editingTicket, setEditingTicket] = useState(false);
  const [editForm, setEditForm] = useState({ equipment: '', description: '', plant: '', status: '' });
  const [viewStage, setViewStage] = useState<string | null>(null); // clicked stage in the timeline
  const [showReport, setShowReport] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportForm, setReportForm] = useState({ emergency: true, periodic: true, status: 'all', from: '', to: '', includeNotes: true });

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    let ticketsData: TicketRow[] | null = null;
    let schedulesData: ScheduleRow[] | null = null;
    try {
      const [tRes, sRes, pRes] = await Promise.all([
        supabase.from('maintenance_tickets').select('*, plants(name)').order('created_at', { ascending: false }).returns<TicketRow[]>(),
        supabase.from('maintenance_schedules').select('*, plants(name)').order('next_due_at', { ascending: true }).returns<ScheduleRow[]>(),
        supabase.from('plants').select('id, name').returns<{ id: string; name: string }[]>(),
      ]);
      if (tRes.error) throw tRes.error;
      if (sRes.error) throw sRes.error;
      ticketsData = tRes.data;
      schedulesData = sRes.data;
      setTickets(ticketsData || []);
      setSchedules(schedulesData || []);
      if (pRes.data?.length) setDbPlants(pRes.data);
      setLoadError(false);
    } catch (err) {
      console.error('[Maintenance] load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }

    if (schedulesData) {
      for (const s of schedulesData) {
        if (!s.is_active || !s.next_due_at) continue;
        if (new Date(s.next_due_at) > new Date()) continue;
        const hasOpen = (ticketsData || []).some((t) => t.schedule_id === s.id && t.status !== 'closed');
        if (hasOpen) continue;
        const { data: newT } = await insertRows('maintenance_tickets', {
          type: 'periodic', status: 'open', title: s.title,
          equipment: s.equipment, plant_id: s.plant_id || null,
          schedule_id: s.id, description: s.description || null,
          assigned_to: s.assigned_to || null,
          due_date: s.next_due_at ? s.next_due_at.split('T')[0] : null,
        }).select('*, plants(name)').single();
        if (newT) {
          notify({
            target_roles: ['admin', 'unit_head', 'technician_shd'],
            title: `Periodic maintenance due: ${s.title}`,
            body: `${s.equipment} · ${FREQ_LABEL[s.frequency] || s.frequency}`,
            type: 'warning', route: '/dashboard/purchase/maint',
            actor_name: 'System', actor_role: 'system', read_by: [],
          });
        }
      }
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Deep-link: a notification's "?ticket=<id>" opens that ticket directly.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const tid = searchParams.get('ticket');
    if (!tid) return;
    const t = tickets.find((x) => x.id === tid);
    if (!t) return; // tickets may still be loading; this effect re-runs when they arrive
    setSelectedTicket(t);
    setTab(t.type === 'periodic' ? 'periodic' : 'emergency');
    const next = new URLSearchParams(searchParams);
    next.delete('ticket');
    setSearchParams(next, { replace: true });
  }, [searchParams, tickets, setSearchParams]);

  useEffect(() => {
    if (!selectedTicket) { setSelectedStoreReq(null); return; }
    supabase.from('maintenance_store_requests').select('*').eq('ticket_id', selectedTicket.id).limit(1).returns<StoreReqRow[]>()
      .then(({ data }) => setSelectedStoreReq(data?.[0] || null));
  }, [selectedTicket?.id]);

  const plantNames = dbPlants.length > 0 ? dbPlants.map(p => p.name) : ['SHD', 'Rehla', 'Ganjam', 'HQ'];

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const periodicTickets = tickets.filter(t => t.type === 'periodic');
  const emergencyTickets = tickets.filter(t => t.type === 'emergency');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const openEmergency = emergencyTickets.filter(t => t.status !== 'closed').length;
  const pendingStore = emergencyTickets.filter(t => ['pending_store', 'pending_unit_head'].includes(t.status)).length;
  const pendingPurchase = emergencyTickets.filter(t => ['pending_purchase', 'pending_purchase_manager', 'pending_handover'].includes(t.status)).length;
  const closedMTD = emergencyTickets.filter(t => t.status === 'closed' && !!t.closed_at && t.closed_at >= monthStart).length;

  const dueToday = periodicTickets.filter(t => t.status === 'open' && t.due_date === today).length;
  const dueWeek = periodicTickets.filter(t => { const d = daysFromNow(t.due_date); return t.status === 'open' && d !== null && d >= 0 && d <= 7; }).length;
  const overdue = periodicTickets.filter(t => { const d = daysFromNow(t.due_date); return t.status === 'open' && d !== null && d < 0; }).length;
  const closedPeriodicMTD = periodicTickets.filter(t => t.status === 'closed' && !!t.closed_at && t.closed_at >= monthStart).length;

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRaiseTicket() {
    if (!raiseForm.equipment.trim() || raising) return;
    setRaising(true);
    try {
    const plant = dbPlants.find(p => p.name === raiseForm.plant);
    const { data: newTicket, error } = await insertRows('maintenance_tickets', {
      type: 'emergency', status: 'open',
      title: `${raiseForm.equipment} — ${raiseForm.assessment === 'repairable' ? 'Repairable' : 'Needs part'}`,
      equipment: raiseForm.equipment,
      plant_id: plant?.id || null,
      unit: raiseForm.unit || null,
      description: raiseForm.description || null,
      raised_by: activeProfile.name, raised_role: role,
      // A technician raising their own job is implicitly assigned to themselves.
      assigned_to: isTechnician ? activeProfile.name : null,
    }).select('*, plants(name)').single();
    if (error) { toast.error(`Failed: ${error.message}`); return; }

    // Optional: photo of the broken/defective item(s) attached at raise time.
    if (newTicket && raisePhotoBlob) {
      try {
        setUploading(true);
        const r = await uploadMaintenancePhoto(raisePhotoBlob, {
          ticketId: newTicket.id, plantName: newTicket.plants?.name || 'Plant',
          photoType: 'defective', creator: activeProfile.name, onProgress: setUploadPct,
        });
        await updateRows('maintenance_tickets', { defective_raise_photo_url: r.secure_url }).eq('id', newTicket.id);
        newTicket.defective_raise_photo_url = r.secure_url;
      } catch { /* non-blocking — the ticket is already raised */ }
      finally { setUploading(false); setUploadPct(0); }
    }

    notify({
      target_roles: ['admin', 'unit_head', 'store_manager_maint'],
      title: `Maintenance ticket raised: ${raiseForm.equipment}`,
      body: `${activeProfile.name} · ${raiseForm.assessment === 'repairable' ? 'Repairable in-house' : 'Needs store part'}`,
      type: 'urgent', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });

    // Notify anyone @-tagged in the description and make them watchers of this
    // ticket, so they also get pinged as it moves through the workflow.
    if (newTicket) {
      const mentionIds = extractMentionIds(raiseForm.description || '', people).filter(id => id !== activeProfile.id);
      if (mentionIds.length) {
        const tagged = people.filter(p => mentionIds.includes(p.id));
        await addWatchers(ticketRef(newTicket), tagged.map(p => ({ id: p.id, name: p.name })), 'mention', activeProfile.id);
        notify({
          target_roles: mentionIds,
          title: `${activeProfile.name} tagged you in a maintenance ticket`,
          body: `${raiseForm.equipment}: “${truncate(raiseForm.description || '')}”`,
          type: 'urgent', route: `/dashboard/purchase/maint?ticket=${newTicket.id}`,
          actor_name: activeProfile.name, actor_role: role, read_by: [],
        });
      }
    }

    // Screen the equipment/description against the blacklist.
    const hits = await screenBlacklist(
      [{ value: raiseForm.equipment, label: 'Equipment' }, { value: raiseForm.description, label: 'Description' }],
      { workflow: 'Maintenance', source: 'entry', entityLabel: raiseForm.equipment },
    );
    if (hits.length) {
      const h = hits[0];
      toast.error(`⚠ "${h.candidate.value}" ≈ blacklisted ${h.entry.type} "${h.entry.name}" (${Math.round(h.score * 100)}%). Admin notified.`);
    }

    setRaiseSaved(true);
    await loadData();
    setTimeout(() => {
      setShowRaisePanel(false); setRaiseSaved(false); setRaisePhotoBlob(null);
      setRaiseForm({ equipment: '', plant: '', description: '', assessment: 'repairable', unit: unitOf(activeProfile.plant) || '' });
      if (newTicket && raiseForm.assessment === 'needs_part') {
        setSelectedTicket(newTicket); setShowStoreForm(true);
      }
    }, 1400);
    } finally { setRaising(false); }
  }

  // ── Admin: edit / delete a ticket ───────────────────────────────────────────
  function startEdit(t: TicketRow) {
    setEditForm({ equipment: t.equipment || '', description: t.description || '', plant: t.plants?.name || '', status: t.status });
    setEditingTicket(true);
  }

  async function saveEdit() {
    if (!selectedTicket) return;
    const plant = dbPlants.find(p => p.name === editForm.plant);
    await updateRows('maintenance_tickets', {
      equipment: editForm.equipment,
      description: editForm.description || null,
      plant_id: plant?.id ?? selectedTicket.plant_id ?? null,
      status: editForm.status as TicketStatus,
    }).eq('id', selectedTicket.id);
    setSelectedTicket((t) => t ? { ...t, equipment: editForm.equipment, description: editForm.description || null, status: editForm.status as TicketStatus, plants: plant ? { name: plant.name } : t.plants } : t);
    await notifyMentions(editForm.description, {
      entityType: 'maintenance_ticket', entityId: selectedTicket.id,
      entityLabel: editForm.equipment || 'Ticket', route: `/dashboard/purchase/maint?ticket=${selectedTicket.id}`,
    });
    setEditingTicket(false);
    toast.success('Ticket updated');
    await loadData();
  }

  async function handleDeleteTicket(t: TicketRow) {
    if (!isAdmin) return;
    if (!window.confirm(`Delete ticket "${t.equipment || t.title}"? This permanently removes it and cannot be undone.`)) return;
    // Remove dependent store-request rows first (FK: maintenance_store_requests.ticket_id).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: srErr } = await (supabase.from('maintenance_store_requests') as any).delete().eq('ticket_id', t.id);
    if (srErr) { toast.error(`Delete failed: ${srErr.message}`); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('maintenance_tickets') as any).delete().eq('id', t.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    setTickets((prev) => prev.filter((x) => x.id !== t.id));
    if (selectedTicket?.id === t.id) { setSelectedTicket(null); setEditingTicket(false); }
    toast.success('Ticket deleted');
  }

  // Bulk-delete every emergency ticket currently shown (admin cleanup tool).
  async function handleDeleteAllEmergency() {
    if (!isAdmin) return;
    const ids = emergencyTickets.map((t) => t.id);
    if (!ids.length) return;
    if (!window.confirm(`Delete ALL ${ids.length} emergency tickets? This permanently removes every emergency ticket and cannot be undone.`)) return;
    setDeletingAll(true);
    try {
      // Delete in chunks so a long id list doesn't blow the URL length limit.
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        // Remove dependent store-request rows first (FK: maintenance_store_requests.ticket_id).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: srErr } = await (supabase.from('maintenance_store_requests') as any).delete().in('ticket_id', chunk);
        if (srErr) { toast.error(`Delete failed: ${srErr.message}`); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('maintenance_tickets') as any).delete().in('id', chunk);
        if (error) { toast.error(`Delete failed: ${error.message}`); return; }
      }
      setTickets((prev) => prev.filter((t) => !ids.includes(t.id)));
      setSelectedTicket(null); setEditingTicket(false);
      toast.success(`Deleted ${ids.length} emergency tickets`);
    } finally {
      setDeletingAll(false);
    }
  }

  // ── Admin: generate CSV maintenance report ──────────────────────────────────
  function reportTickets(): TicketRow[] {
    return tickets.filter((t) => {
      if (t.type === 'emergency' && !reportForm.emergency) return false;
      if (t.type === 'periodic' && !reportForm.periodic) return false;
      if (t.type !== 'emergency' && t.type !== 'periodic') return false;
      if (reportForm.status === 'open' && t.status === 'closed') return false;
      if (reportForm.status === 'closed' && t.status !== 'closed') return false;
      const created = (t.created_at || '').slice(0, 10);
      if (reportForm.from && created < reportForm.from) return false;
      if (reportForm.to && created > reportForm.to) return false;
      return true;
    });
  }

  async function generateReport() {
    if (generating) return;
    setGenerating(true);
    try {
      const rows = reportTickets();
      if (!rows.length) { toast.error('No tickets match these filters'); return; }
      const ids = rows.map((t) => t.id);

      // Enrich each ticket with its full trail: store-request lifecycle,
      // watchers (who's tagged/following), and the notes/@-mention thread.
      const [srRes, wRes, nRes] = await Promise.all([
        supabase.from('maintenance_store_requests').select('*').in('ticket_id', ids).returns<StoreReqRow[]>(),
        supabase.from('entity_watchers').select('entity_id, profile_name, kind').eq('entity_type', 'maintenance_ticket').in('entity_id', ids).returns<{ entity_id: string; profile_name: string; kind: string }[]>(),
        supabase.from('entity_notes').select('*').eq('entity_type', 'maintenance_ticket').in('entity_id', ids).order('created_at', { ascending: true }).returns<EntityNoteRow[]>(),
      ]);

      const srBy = new Map<string, StoreReqRow>();
      (srRes.data ?? []).forEach((s) => { if (s.ticket_id && !srBy.has(s.ticket_id)) srBy.set(s.ticket_id, s); });

      const watchersBy = new Map<string, Set<string>>();
      (wRes.data ?? []).forEach((w) => {
        if (!watchersBy.has(w.entity_id)) watchersBy.set(w.entity_id, new Set());
        watchersBy.get(w.entity_id)!.add(w.profile_name);
      });

      const notes = nRes.data ?? [];
      const notesBy = new Map<string, EntityNoteRow[]>();
      notes.forEach((n) => {
        if (!notesBy.has(n.entity_id)) notesBy.set(n.entity_id, []);
        notesBy.get(n.entity_id)!.push(n);
      });

      const csvRows = rows.map((t) => {
        const sr = srBy.get(t.id);
        const created = t.created_at ? new Date(t.created_at).getTime() : null;
        const closedT = t.closed_at ? new Date(t.closed_at).getTime() : null;
        const days = created != null ? Math.max(0, Math.round(((closedT ?? Date.now()) - created) / 86400000)) : '';
        const how = t.status === 'closed'
          ? (t.defective_part_decision ? `Part replaced · old part ${t.defective_part_decision}` : sr ? 'Part from store' : 'Fixed in-house')
          : (sr ? 'Awaiting part / approval' : 'In progress');
        return {
          id: t.id,
          shortId: t.id.slice(0, 8),
          type: t.type,
          equipment: t.equipment || '',
          plant: t.plants?.name || '',
          issue: t.description || t.title || '',
          status: STATUS_CFG[t.status]?.label || t.status,
          stage: STAGE_LABELS[t.status] || '',
          raised_by: t.raised_by || '',
          raised_role: roleLabelFor(t.raised_role),
          assigned_to: t.assigned_to || '',
          created: fmtDT(t.created_at),
          closed: fmtDT(t.closed_at),
          days,
          how,
          defective: t.defective_part_decision || '',
          part: sr?.part_name || '',
          qty: sr?.quantity ?? '',
          spec: sr?.specification || '',
          store_decision: sr?.store_decision || '',
          qty_in_store: sr?.qty_in_store ?? '',
          shelf: sr?.shelf_location || '',
          condition: sr?.part_condition || '',
          approval: sr?.unit_head_approval || '',
          busy: sr?.busy_transaction_ref || '',
          handover: fmtDT(sr?.handover_confirmed_at),
          handover_notes: sr?.handover_notes || '',
          tagged: [...(watchersBy.get(t.id) ?? new Set<string>())].join('; '),
          notes_count: (notesBy.get(t.id) ?? []).length,
        };
      });

      // Report metadata header (who generated it, when, and the filters used).
      const typeSel = [reportForm.emergency && 'Emergency', reportForm.periodic && 'Periodic'].filter(Boolean).join(' + ') || 'None';
      const statusSel = reportForm.status === 'all' ? 'All statuses' : reportForm.status === 'open' ? 'Open / in progress' : 'Closed only';
      const dateSel = (reportForm.from || reportForm.to) ? `${reportForm.from || '…'} → ${reportForm.to || '…'}` : 'All dates';
      const preamble: (string | number)[][] = [
        ['Suntek — Maintenance Report'],
        ['Generated by', `${activeProfile.name} (${activeProfile.roleLabel})`],
        ['Generated at', new Date().toLocaleString('en-IN')],
        ['Scope', `${typeSel} · ${statusSel} · ${dateSel}`],
        ['Total tickets', rows.length],
      ];

      exportToCsv(`maintenance-report-${today}`, REPORT_COLUMNS, csvRows, preamble);

      // Optional second CSV: the notes / @-mention activity timeline.
      if (reportForm.includeNotes && notes.length) {
        const eqById = new Map(rows.map((t) => [t.id, t.equipment || '']));
        const noteRows = notes.map((n) => ({
          id: n.entity_id,
          shortId: n.entity_id.slice(0, 8),
          equipment: eqById.get(n.entity_id) || '',
          note: n.body,
          author: n.author_name,
          tagged: people.filter((p) => (n.mentions || []).includes(p.id)).map((p) => p.name).join('; '),
          at: fmtDT(n.created_at),
        }));
        exportToCsv(`maintenance-activity-${today}`, NOTE_COLUMNS, noteRows, preamble);
      }

      toast.success(`Report ready · ${csvRows.length} tickets exported`);
      setShowReport(false);
    } catch (err) {
      toast.error(`Report failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCompletePeriodicTicket() {
    if (!completingSchedule || !completionBlob) return;
    setUploading(true);
    try {
      let ticket = tickets.find(t => t.schedule_id === completingSchedule.id && t.status === 'open');
      if (!ticket) {
        const { data } = await insertRows('maintenance_tickets', {
          type: 'periodic', status: 'open', title: completingSchedule.title,
          equipment: completingSchedule.equipment, plant_id: completingSchedule.plant_id || null,
          schedule_id: completingSchedule.id,
          due_date: completingSchedule.next_due_at ? completingSchedule.next_due_at.split('T')[0] : null,
          raised_by: activeProfile.name, raised_role: role,
          assigned_to: completingSchedule.assigned_to || null,
        }).select('*, plants(name)').single();
        ticket = data ?? undefined;
      }
      if (!ticket) throw new Error('Could not create ticket');
      const result = await uploadMaintenancePhoto(completionBlob, {
        ticketId: ticket.id, plantName: ticket.plants?.name || completingSchedule.plants?.name || 'Plant',
        photoType: 'completion', creator: activeProfile.name, onProgress: setUploadPct,
      });
      await updateRows('maintenance_tickets', { status: 'closed', completion_photo_url: result.secure_url, closed_at: new Date().toISOString(), assigned_to: completingSchedule.assigned_to || activeProfile.name })
        .eq('id', ticket.id);
      const nextDue = calculateNextDue(completingSchedule.frequency);
      await updateRows('maintenance_schedules', { last_completed_at: new Date().toISOString(), next_due_at: nextDue })
        .eq('id', completingSchedule.id);
      notify({
        target_roles: ['admin', 'unit_head'],
        title: `Periodic done: ${completingSchedule.title}`,
        body: `${completingSchedule.equipment} · By ${activeProfile.name}`,
        type: 'info', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
      setCompletingSchedule(null); setCompletionBlob(null); setUploadPct(0);
      await loadData();
    } catch (err) { toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setUploading(false); }
  }

  async function handleRaiseStoreReq() {
    if (!storeForm.partName.trim() || !selectedTicket || actionBusyRef.current) return;
    actionBusyRef.current = true;
    try {
    const plant = dbPlants.find(p => p.name === selectedTicket.plants?.name);
    const { data: sr } = await insertRows('maintenance_store_requests', {
      ticket_id: selectedTicket.id, part_name: storeForm.partName,
      quantity: parseFloat(storeForm.quantity) || null,
      specification: storeForm.specification || null,
      plant_id: plant?.id || selectedTicket.plant_id || null,
    }).select('*').single();
    setSelectedStoreReq(sr);
    await updateTicketStatus(selectedTicket.id, 'pending_store');
    setSelectedTicket((t) => t ? { ...t, status: 'pending_store' } : t);
    // Route to the store manager of the ticket's Jharkhand unit (Chlorides /
    // Plasticiser); fall back to the generic store manager if no unit is set.
    const unit = (selectedTicket.unit as Unit | null) || null;
    const storeTargets = unit
      ? [UNIT_STORE_MANAGER[unit], 'admin']
      : ['admin', 'store_manager_maint', 'warehouse_manager'];
    notify({
      target_roles: storeTargets,
      title: `Store part needed${unit ? ` · ${UNIT_LABELS[unit]}` : ''}: ${storeForm.partName}`,
      body: `${selectedTicket.equipment} · Qty: ${storeForm.quantity || '—'} · Check availability`,
      type: 'warning', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    await notifyMentions(storeForm.specification, {
      entityType: 'maintenance_ticket', entityId: selectedTicket.id,
      entityLabel: selectedTicket.equipment || 'Ticket', route: `/dashboard/purchase/maint?ticket=${selectedTicket.id}`,
    });
    setShowStoreForm(false);
    setStoreForm({ partName: '', quantity: '', specification: '' });
    await loadData();
    } finally { actionBusyRef.current = false; }
  }

  // Unit head override: reroute the store request to the other unit's store manager.
  async function rerouteStoreUnit() {
    if (!selectedTicket) return;
    const cur = (selectedTicket.unit as Unit | null) || 'chlorides';
    const other: Unit = cur === 'chlorides' ? 'plasticiser' : 'chlorides';
    await updateRows('maintenance_tickets', { unit: other }).eq('id', selectedTicket.id);
    setSelectedTicket((t) => t ? { ...t, unit: other } : t);
    notify({
      target_roles: [UNIT_STORE_MANAGER[other], 'admin'],
      title: `Rerouted to ${UNIT_LABELS[other]} store`,
      body: `${activeProfile.name} rerouted "${selectedTicket.equipment}" to the ${UNIT_LABELS[other]} store manager.`,
      type: 'warning', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    await loadData();
  }

  async function startRepair() {
    if (!selectedTicket) return;
    await updateTicketStatus(selectedTicket.id, 'in_progress', { assigned_to: activeProfile.name });
    setSelectedTicket((t) => t ? { ...t, status: 'in_progress' } : t);
    await notifyTicketWatchers(selectedTicket, `Repair started: ${selectedTicket.equipment}`, `${activeProfile.name} started fixing it in-house.`);
    await loadData();
  }

  async function closeInHouse() {
    if (!selectedTicket || !completionBlob) return;
    setUploading(true);
    try {
      const result = await uploadMaintenancePhoto(completionBlob, {
        ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
        photoType: 'completion', creator: activeProfile.name, onProgress: setUploadPct,
      });
      await updateTicketStatus(selectedTicket.id, 'closed', {
        completion_photo_url: result.secure_url, closed_at: new Date().toISOString(),
      });
      notify({
        target_roles: ['admin', 'unit_head'],
        title: `Ticket closed: ${selectedTicket.equipment}`,
        body: `Fixed in-house by ${activeProfile.name}`,
        type: 'info', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
      await notifyTicketWatchers(selectedTicket, `Ticket closed: ${selectedTicket.equipment}`, `Fixed in-house by ${activeProfile.name}.`);
      setSelectedTicket(null); setCompletionBlob(null); setUploadPct(0);
      await loadData();
    } catch (err) { toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setUploading(false); }
  }

  // Store manager submits availability decision with full part details
  async function submitStoreDecision() {
    if (!selectedTicket || !selectedStoreReq || storeDecisionForm.available === null) return;
    const available = storeDecisionForm.available;
    await updateRows('maintenance_store_requests', {
        store_decision: available ? 'available' : 'unavailable',
        purchase_required: !available,
        qty_in_store: available ? (parseFloat(storeDecisionForm.qtyInStore) || null) : null,
        shelf_location: available ? (storeDecisionForm.shelfLocation || null) : null,
        part_condition: available ? storeDecisionForm.partCondition : null,
      })
      .eq('id', selectedStoreReq.id);
    await updateTicketStatus(selectedTicket.id, 'pending_unit_head');
    setSelectedTicket((t) => t ? { ...t, status: 'pending_unit_head' } : t);
    setSelectedStoreReq((sr) => sr ? {
      ...sr,
      store_decision: available ? 'available' : 'unavailable',
      purchase_required: !available,
      qty_in_store: available ? parseFloat(storeDecisionForm.qtyInStore) : null,
      shelf_location: available ? storeDecisionForm.shelfLocation : null,
      part_condition: available ? storeDecisionForm.partCondition : null,
    } : sr);
    notify({
      target_roles: ['admin', 'unit_head'],
      title: available ? `Part available: ${selectedStoreReq.part_name}` : `Part not in store: ${selectedStoreReq.part_name}`,
      body: available
        ? `Qty: ${storeDecisionForm.qtyInStore || '?'} · Shelf: ${storeDecisionForm.shelfLocation || '—'} · Condition: ${storeDecisionForm.partCondition} · Awaiting unit head approval`
        : `${selectedTicket.equipment} — external procurement needed. Awaiting unit head approval.`,
      type: available ? 'info' : 'warning', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    setStoreDecisionForm({ available: null, qtyInStore: '', shelfLocation: '', partCondition: 'new' });
    await loadData();
  }

  async function unitHeadApprove(approved: boolean) {
    if (!selectedTicket || !selectedStoreReq) return;
    const partAvailable = selectedStoreReq.store_decision === 'available';
    // If part available + approved → pending_handover (store hands part to tech)
    // If part unavailable + approved → pending_purchase (Vijay procures)
    // If rejected → open (tech re-assesses)
    const nextStatus = !approved ? 'open' : partAvailable ? 'pending_handover' : 'pending_purchase';
    await updateRows('maintenance_store_requests', { unit_head_approval: approved ? 'approved' : 'rejected' })
      .eq('id', selectedStoreReq.id);
    await updateTicketStatus(selectedTicket.id, nextStatus);
    setSelectedTicket((t) => t ? { ...t, status: nextStatus } : t);
    if (approved && partAvailable) {
      notify({
        target_roles: ['store_manager_maint', 'warehouse_manager', 'technician_shd'],
        title: `Approved: hand over ${selectedStoreReq.part_name}`,
        body: `Unit head approved. Store manager to hand part to technician and upload invoice + photo.`,
        type: 'info', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
    } else if (approved && !partAvailable) {
      notify({
        target_roles: ['admin', 'unit_head'],
        title: `Procurement approved: ${selectedStoreReq.part_name}`,
        body: `${selectedTicket.equipment} — procure from market. Enter BUSY ref when done.`,
        type: 'warning', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
    } else {
      notify({
        target_roles: ['technician_shd', 'admin'],
        title: `Request rejected: ${selectedStoreReq.part_name}`,
        body: `Unit head rejected — ticket sent back to technician`,
        type: 'warning', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
    }
    await notifyTicketWatchers(
      selectedTicket,
      approved ? `Approved: ${selectedTicket.equipment}` : `Sent back: ${selectedTicket.equipment}`,
      approved ? `${activeProfile.name} approved the store request.` : `${activeProfile.name} sent the ticket back to the technician.`,
    );
    await loadData();
  }

  async function markPurchased() {
    if (!selectedTicket || !selectedStoreReq || !busyRef.trim()) return;
    // Unit head procures: records the BUSY ref + supplier. Price is entered by
    // the Purchase Manager (from the actual bill) at the next stage.
    const supplier = supplierName.trim();
    await updateRows('maintenance_store_requests', { busy_transaction_ref: busyRef, supplier_name: supplier || null })
      .eq('id', selectedStoreReq.id);
    setSelectedStoreReq((sr) => sr ? { ...sr, busy_transaction_ref: busyRef, supplier_name: supplier || null } : sr);
    await updateTicketStatus(selectedTicket.id, 'pending_purchase_manager');
    setSelectedTicket((t) => t ? { ...t, status: 'pending_purchase_manager' } : t);
    notify({
      target_roles: ['purchase_manager', 'admin'],
      title: `Procured — Purchase Manager to bill: ${selectedStoreReq.part_name}`,
      body: `BUSY ref: ${busyRef}${supplier ? ` · ${supplier}` : ''} — Purchase Manager to enter the price, upload the bill, and mark en route.`,
      type: 'info', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    // Screen the chosen supplier against the blacklist (vendor risk).
    if (supplier) {
      const hits = await screenBlacklist(
        [{ value: supplier, label: 'Supplier' }],
        { workflow: 'Maintenance Procurement', source: 'entry', entityLabel: selectedTicket.equipment },
      );
      if (hits.length) {
        const h = hits[0];
        toast.error(`⚠ Supplier "${h.candidate.value}" ≈ blacklisted ${h.entry.type} "${h.entry.name}" (${Math.round(h.score * 100)}%). Admin notified.`);
      }
    }
    setBusyRef(''); setSupplierName(''); await loadData();
  }

  // Purchase Manager: upload the supplier bill photo + mark the part en route.
  async function confirmDispatch() {
    if (!selectedTicket || !selectedStoreReq || !dispatchBlob) return;
    setUploading(true);
    try {
      const r = await uploadMaintenancePhoto(dispatchBlob, {
        ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
        photoType: 'bill', creator: activeProfile.name, onProgress: setUploadPct,
      });
      // Purchase manager can confirm/correct the price from the actual bill.
      const qty = selectedStoreReq.quantity || 1;
      const up = unitPrice.trim() ? parseFloat(unitPrice.replace(/[^0-9.]/g, '')) : selectedStoreReq.unit_price ?? null;
      const total = up != null ? up * qty : selectedStoreReq.total_price ?? null;
      await updateRows('maintenance_store_requests', { handover_invoice_url: r.secure_url, bill_verified: true, unit_price: up, total_price: total })
        .eq('id', selectedStoreReq.id);
      setSelectedStoreReq((sr) => sr ? { ...sr, handover_invoice_url: r.secure_url, bill_verified: true, unit_price: up, total_price: total } : sr);
      // The Purchase Orders page derives this external buy directly from the
      // store request (single source of truth) — no separate PO row to insert.
      await updateTicketStatus(selectedTicket.id, 'pending_handover');
      setSelectedTicket((t) => t ? { ...t, status: 'pending_handover' } : t);
      notify({
        target_roles: ['store_manager_maint', 'warehouse_manager', 'admin'],
        title: `Part en route: ${selectedStoreReq.part_name}`,
        body: `${activeProfile.name} uploaded the supplier bill — part dispatched to store. Confirm receipt on arrival.`,
        type: 'info', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
      await notifyTicketWatchers(selectedTicket, `Part dispatched: ${selectedTicket.equipment}`, `${activeProfile.name} uploaded the bill — en route to store.`);
      setDispatchBlob(null); setUploadPct(0);
      await loadData();
    } catch (err) { toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setUploading(false); }
  }

  // Store manager: upload invoice + product photo, confirm physical handover to technician
  async function confirmHandover() {
    if (!selectedTicket || !selectedStoreReq) return;
    if (!handoverInvoiceBlob && !handoverPhotoBlob) { toast.error('Please upload at least the invoice or product photo before confirming handover.'); return; }
    setUploading(true);
    try {
      let invoiceUrl: string | null = null;
      let photoUrl: string | null = null;
      if (handoverInvoiceBlob) {
        const r = await uploadMaintenancePhoto(handoverInvoiceBlob, {
          ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
          photoType: 'bill', creator: activeProfile.name, onProgress: pct => setUploadPct(Math.round(pct / 2)),
        });
        invoiceUrl = r.secure_url;
      }
      if (handoverPhotoBlob) {
        const r = await uploadMaintenancePhoto(handoverPhotoBlob, {
          ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
          photoType: 'completion', creator: activeProfile.name, onProgress: pct => setUploadPct(50 + Math.round(pct / 2)),
        });
        photoUrl = r.secure_url;
      }
      await updateRows('maintenance_store_requests', {
          ...(invoiceUrl ? { handover_invoice_url: invoiceUrl } : {}),
          ...(photoUrl ? { handover_photo_url: photoUrl } : {}),
          ...(handoverNotes.trim() ? { handover_notes: handoverNotes } : {}),
          handover_confirmed_at: new Date().toISOString(),
          bill_verified: true,
        })
        .eq('id', selectedStoreReq.id);
      await updateTicketStatus(selectedTicket.id, 'pending_defective_return');
      setSelectedTicket((t) => t ? { ...t, status: 'pending_defective_return' } : t);
      notify({
        target_roles: ['technician_shd', 'admin', 'unit_head'],
        title: `Part handed over: ${selectedStoreReq.part_name}`,
        body: `${activeProfile.name} confirmed handover. Technician to decide repair or scrap on old part.`,
        type: 'info', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
      await notifyTicketWatchers(selectedTicket, `Part handed over: ${selectedTicket.equipment}`, `${activeProfile.name} confirmed handover — repair can proceed.`);
      await notifyMentions(handoverNotes, {
        entityType: 'maintenance_ticket', entityId: selectedTicket.id,
        entityLabel: selectedTicket.equipment || 'Ticket', route: `/dashboard/purchase/maint?ticket=${selectedTicket.id}`,
      });
      setHandoverInvoiceBlob(null); setHandoverPhotoBlob(null); setHandoverNotes(''); setUploadPct(0);
      await loadData();
    } catch (err) { toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setUploading(false); }
  }

  async function submitDefectiveReturn() {
    if (!selectedTicket || !defectiveBlob || !defectiveDecision) return;
    setUploading(true);
    try {
      const result = await uploadMaintenancePhoto(defectiveBlob, {
        ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
        photoType: 'defective', creator: activeProfile.name, onProgress: setUploadPct,
      });
      await updateTicketStatus(selectedTicket.id, 'closed', {
        defective_part_photo_url: result.secure_url,
        defective_part_decision: defectiveDecision,
        closed_at: new Date().toISOString(),
        assigned_to: activeProfile.name,
      });
      notify({
        target_roles: ['admin', 'unit_head', 'store_manager_maint'],
        title: `Ticket closed: ${selectedTicket.equipment}`,
        body: `Defective part → ${defectiveDecision} · By ${activeProfile.name}`,
        type: 'info', route: '/dashboard/purchase/maint',
        actor_name: activeProfile.name, actor_role: role, read_by: [],
      });
      await notifyTicketWatchers(selectedTicket, `Ticket closed: ${selectedTicket.equipment}`, `Defective part → ${defectiveDecision} · closed by ${activeProfile.name}.`);
      setSelectedTicket(null); setDefectiveBlob(null); setDefectiveDecision(''); setUploadPct(0);
      await loadData();
    } catch (err) { toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setUploading(false); }
  }

  const EMPTY_SCHEDULE_FORM = { title: '', equipment: '', plant: '', frequency: 'weekly', description: '', firstDue: today, assignedTo: '' };

  // Open the panel to create a brand-new schedule.
  function openAddSchedule() {
    setEditingSchedule(null);
    setScheduleForm(EMPTY_SCHEDULE_FORM);
    setShowSchedulePanel(true);
  }

  // Open the panel pre-filled to revise an existing schedule — reassign owner,
  // change frequency, reschedule next due, edit the checklist, etc.
  function openEditSchedule(s: ScheduleRow) {
    setEditingSchedule(s);
    setScheduleForm({
      title: s.title,
      equipment: s.equipment,
      plant: s.plants?.name || '',
      frequency: s.frequency,
      description: s.description || '',
      firstDue: s.next_due_at ? s.next_due_at.split('T')[0] : today,
      assignedTo: s.assigned_to || '',
    });
    setShowSchedulePanel(true);
  }

  // Clone an existing schedule into a new draft (calendar-style "duplicate event").
  function openDuplicateSchedule(s: ScheduleRow) {
    setEditingSchedule(null);
    setScheduleForm({
      title: `${s.title} (copy)`,
      equipment: s.equipment,
      plant: s.plants?.name || '',
      frequency: s.frequency,
      description: s.description || '',
      firstDue: today,
      assignedTo: s.assigned_to || '',
    });
    setShowSchedulePanel(true);
  }

  function closeSchedulePanel() {
    setShowSchedulePanel(false); setScheduleSaved(false); setEditingSchedule(null);
  }

  // Pause (snooze) or resume a recurring schedule without deleting it — paused
  // schedules stop auto-generating tickets. Useful when an owner leaves and the
  // task needs a temporary hold until it's reassigned.
  async function toggleScheduleActive(s: ScheduleRow) {
    if (!isAdmin) return;
    const next = !s.is_active;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await updateRows('maintenance_schedules', { is_active: next }).eq('id', s.id);
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    setSchedules(prev => prev.map(x => (x.id === s.id ? { ...x, is_active: next } : x)));
    toast.success(next ? 'Schedule resumed' : 'Schedule paused');
  }

  // Delete a schedule.
  //  • Pending (still 'open', un-started) auto-tickets it generated are DELETED
  //    alongside it — so KPI counters (Due today / Overdue) and the tab badge
  //    drop back to reality immediately.
  //  • Tickets that were actually worked on (in_progress … closed) are KEPT but
  //    unlinked (schedule_id → null) so the maintenance history stays intact.
  async function handleDeleteSchedule(s: ScheduleRow) {
    if (!isAdmin || deletingScheduleId) return;
    if (!window.confirm(`Delete schedule "${s.title}"? This stops auto-ticket generation and removes any pending tickets it created (started/completed ones are kept for history). This cannot be undone.`)) return;
    setDeletingScheduleId(s.id);
    try {
      const pendingIds = tickets.filter(t => t.schedule_id === s.id && t.status === 'open').map(t => t.id);
      if (pendingIds.length) {
        // Remove dependent store-request rows first (FK: maintenance_store_requests.ticket_id).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: srErr } = await (supabase.from('maintenance_store_requests') as any).delete().in('ticket_id', pendingIds);
        if (srErr) { toast.error(`Delete failed: ${srErr.message}`); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: tdErr } = await (supabase.from('maintenance_tickets') as any).delete().in('id', pendingIds);
        if (tdErr) { toast.error(`Delete failed: ${tdErr.message}`); return; }
      }
      // Unlink any remaining (worked-on/closed) tickets so the FK clears but history survives.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: tErr } = await (supabase.from('maintenance_tickets') as any).update({ schedule_id: null }).eq('schedule_id', s.id);
      if (tErr) { toast.error(`Delete failed: ${tErr.message}`); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('maintenance_schedules') as any).delete().eq('id', s.id);
      if (error) { toast.error(`Delete failed: ${error.message}`); return; }
      setSchedules(prev => prev.filter(x => x.id !== s.id));
      // Update local tickets so the periodic KPIs recompute instantly.
      setTickets(prev => prev
        .filter(t => !pendingIds.includes(t.id))
        .map(t => (t.schedule_id === s.id ? { ...t, schedule_id: null } : t)));
      toast.success('Schedule deleted');
    } finally {
      setDeletingScheduleId(null);
    }
  }

  async function handleSaveSchedule() {
    if (!scheduleForm.title.trim() || !scheduleForm.equipment.trim() || savingSchedule) return;
    setSavingSchedule(true);
    try {
    const plant = dbPlants.find(p => p.name === scheduleForm.plant);
    const payload = {
      title: scheduleForm.title, equipment: scheduleForm.equipment,
      plant_id: plant?.id || null, frequency: scheduleForm.frequency as ScheduleRow['frequency'],
      description: scheduleForm.description || null,
      assigned_to: scheduleForm.assignedTo || null,
      next_due_at: scheduleForm.firstDue ? new Date(scheduleForm.firstDue).toISOString() : null,
    };
    const reassigned = !!editingSchedule && (editingSchedule.assigned_to || '') !== scheduleForm.assignedTo;
    if (editingSchedule) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await updateRows('maintenance_schedules', payload).eq('id', editingSchedule.id);
      if (error) { toast.error(`Failed: ${error.message}`); return; }
    } else {
      const { error } = await insertRows('maintenance_schedules', { ...payload, is_active: true });
      if (error) { toast.error(`Failed: ${error.message}`); return; }
    }
    // If the assignee is restricted, alert admin + unit head immediately.
    if (scheduleForm.assignedTo && (!editingSchedule || reassigned)) {
      const entry = isPersonBlacklisted(scheduleForm.assignedTo);
      if (entry) notifyActivity(entry, `assigned the recurring task "${scheduleForm.title}" (${FREQ_LABEL[scheduleForm.frequency] || scheduleForm.frequency})`);
    }
    await notifyMentions(scheduleForm.description, {
      entityLabel: scheduleForm.title || 'Maintenance schedule', route: '/dashboard/purchase/maint',
    });
    setScheduleSaved(true);
    await loadData();
    setTimeout(() => {
      setShowSchedulePanel(false); setScheduleSaved(false); setEditingSchedule(null);
      setScheduleForm(EMPTY_SCHEDULE_FORM);
    }, 1400);
    } finally { setSavingSchedule(false); }
  }

  // ── Read-only stage history (click a stage in the strip) ────────────────────
  function renderStageDetail(stage: string) {
    const t = selectedTicket;
    if (!t) return null;
    const sr = selectedStoreReq;
    const label = STAGE_LABELS[stage] || stage;

    const photo = (url: string | null | undefined, cap: string) => url ? (
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>{cap}</div>
        <img src={url} alt={cap} style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: '1px solid #E2E8F0' }} />
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563EB', display: 'block', marginTop: 4 }}>Open full image ↗</a>
      </div>
    ) : null;
    const line = (k: string, v: React.ReactNode) => (v || v === 0) ? (
      <div style={{ fontSize: 12.5, color: '#334155', marginTop: 5 }}><span style={{ color: '#94A3B8' }}>{k}: </span><strong>{v}</strong></div>
    ) : null;

    let body: React.ReactNode = <div style={{ fontSize: 12.5, color: '#94A3B8' }}>No details captured for this step.</div>;
    switch (stage) {
      case 'open':
        body = <>{line('Raised by', t.raised_by)}{line('Role', roleLabelFor(t.raised_role))}{line('When', formatDate(t.created_at))}{t.description && <div style={{ fontSize: 12.5, color: '#334155', marginTop: 6 }}><MentionText text={t.description} /></div>}</>;
        break;
      case 'in_progress':
        body = <>{line('Handled by', t.assigned_to || t.raised_by)}<div style={{ fontSize: 12.5, color: '#334155', marginTop: 5 }}>{sr ? 'Needs a part — store request raised.' : 'Decided to fix in-house.'}</div></>;
        break;
      case 'pending_store':
        if (sr) body = <>{line('Part requested', sr.part_name)}{line('Qty', sr.quantity)}{line('Specification', sr.specification)}{line('Store decision', sr.store_decision)}{line('Qty in store', sr.qty_in_store)}{line('Shelf', sr.shelf_location)}{line('Condition', sr.part_condition)}</>;
        break;
      case 'pending_unit_head':
        if (sr) body = <>{line('Unit head decision', sr.unit_head_approval)}{line('Part availability', sr.store_decision)}</>;
        break;
      case 'pending_purchase':
        if (sr) body = <>{line('BUSY transaction ref', sr.busy_transaction_ref)}{line('Supplier', sr.supplier_name)}<div style={{ fontSize: 12.5, color: '#334155', marginTop: 5 }}>External procurement by unit head (price entered by Purchase Manager).</div></>;
        break;
      case 'pending_purchase_manager':
        if (sr) body = <>{line('Supplier', sr.supplier_name)}{line('Unit price', sr.unit_price != null ? `₹ ${Number(sr.unit_price).toLocaleString('en-IN')}` : null)}{line('Total cost', sr.total_price != null ? `₹ ${Number(sr.total_price).toLocaleString('en-IN')}` : null)}{line('Bill uploaded', sr.bill_verified ? 'Yes' : '—')}{photo(sr.handover_invoice_url, 'Supplier bill (Purchase Manager)')}</>;
        break;
      case 'pending_handover':
        if (sr) body = <>{line('Receipt confirmed', sr.handover_confirmed_at ? formatDate(sr.handover_confirmed_at) : '—')}{line('Notes', sr.handover_notes)}{photo(sr.handover_invoice_url, 'Bill / invoice')}{photo(sr.handover_photo_url, 'Part received photo')}</>;
        break;
      case 'pending_defective_return':
        body = <>{line('Defective part decision', t.defective_part_decision)}{photo(t.defective_part_photo_url, 'Defective part photo')}</>;
        break;
      case 'closed':
        body = <>{line('Closed at', t.closed_at ? formatDate(t.closed_at) : '—')}{line('Defective part', t.defective_part_decision)}{photo(t.completion_photo_url, 'Completion photo')}</>;
        break;
    }

    return (
      <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 16, background: '#FCFCFD' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#0F172A' }}>{label} — what happened <span style={{ fontWeight: 500, color: '#94A3B8' }}>(read-only)</span></div>
          <button onClick={() => setViewStage(null)} style={{ border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>
        {body}
      </div>
    );
  }

  // ── Ticket action panel ───────────────────────────────────────────────────

  function renderTicketActions() {
    if (!selectedTicket) return null;
    const status = selectedTicket.status;
    const partAvailable = selectedStoreReq?.store_decision === 'available';

    if (status === 'closed') {
      return (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 14, padding: 16 }}>
          <div style={{ fontWeight: 700, color: '#16A34A', marginBottom: 8 }}>Ticket closed</div>
          {selectedTicket.completion_photo_url && (
            <>
              <img src={selectedTicket.completion_photo_url} alt="Completion" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, marginTop: 4 }} />
              <a href={selectedTicket.completion_photo_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563EB', display: 'block', marginTop: 6 }}>View in Cloudinary ↗</a>
            </>
          )}
          {selectedStoreReq?.handover_invoice_url && (
            <a href={selectedStoreReq.handover_invoice_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563EB', display: 'block', marginTop: 4 }}>View handover invoice ↗</a>
          )}
          {selectedTicket.defective_part_decision && (
            <div style={{ fontSize: 12, marginTop: 8, color: '#475569' }}>Defective part: <strong style={{ textTransform: 'capitalize' }}>{selectedTicket.defective_part_decision}</strong></div>
          )}
        </div>
      );
    }

    // ── open: technician decides in-house vs store ──
    if (status === 'open' && (isTechnician || isAdmin || isUnitHead)) {
      if (showStoreForm) {
        return (
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Store request — part details</div>
            <PanelField label="Part name *">
              <PanelInput value={storeForm.partName} onChange={e => setStoreForm(f => ({ ...f, partName: e.target.value }))} placeholder="e.g. Mechanical seal, O-ring kit" />
            </PanelField>
            <PanelRow>
              <PanelField label="Quantity needed">
                <PanelInput type="number" value={storeForm.quantity} onChange={e => setStoreForm(f => ({ ...f, quantity: e.target.value }))} placeholder="e.g. 2" />
              </PanelField>
            </PanelRow>
            <PanelField label="Specification / quality">
              <PanelTextarea value={storeForm.specification} onChange={e => setStoreForm(f => ({ ...f, specification: e.target.value }))} placeholder="Brand, size, grade, tolerance…" />
            </PanelField>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setShowStoreForm(false)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1px solid #E2E8F0', background: '#F8FAFC', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleRaiseStoreReq} disabled={!storeForm.partName.trim()} style={{ flex: 2, padding: '10px', borderRadius: 12, border: 'none', background: '#F47651', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', opacity: !storeForm.partName.trim() ? 0.5 : 1 }}>Send to Store Manager</button>
            </div>
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>What needs to happen?</div>
          <button onClick={startRepair} style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid #16A34A', background: '#F0FDF4', color: '#16A34A', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            ✓ Can fix in-house — start working on it
          </button>
          <button onClick={() => setShowStoreForm(true)} style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid #F47651', background: '#FFF7F5', color: '#F47651', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            🔧 Need a part from store — raise request
          </button>
        </div>
      );
    }

    // ── in_progress: technician closes with photo ──
    if (status === 'in_progress' && (isTechnician || isAdmin)) {
      return (
        <div>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 12 }}>Upload photo proof to close ticket</div>
          <PhotoUploader onBlobReady={setCompletionBlob} label="Completion photo" hint="Photo of the fixed equipment / completed repair" />
          {uploading && <UploadBar pct={uploadPct} color="#F47651" />}
          <button onClick={closeInHouse} disabled={!completionBlob || uploading} style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#16A34A', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: (!completionBlob || uploading) ? 0.5 : 1 }}>
            {uploading ? 'Uploading…' : 'Close ticket — repair complete'}
          </button>
        </div>
      );
    }

    // ── pending_store: store manager checks availability ──
    if (status === 'pending_store') {
      if (!selectedStoreReq) return <div style={{ fontSize: 12, color: '#94A3B8' }}>Loading store request…</div>;
      const ticketUnit = (selectedTicket.unit as Unit | null) || null;
      // The matching unit's store manager (or generic/warehouse, or admin) can act.
      const storeManagerCanAct = isAdmin || (isStoreManager && (
        role === 'store_manager_maint' || role === 'warehouse_manager' || !ticketUnit || myStoreUnit === ticketUnit
      ));
      // Unit head can override the routing to the other unit's store.
      const overrideBtn = (isUnitHead || isAdmin) ? (
        <button onClick={rerouteStoreUnit} style={{ width: '100%', padding: '9px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', marginTop: 10 }}>
          ⇄ Override · reroute to {UNIT_LABELS[ticketUnit === 'plasticiser' ? 'chlorides' : 'plasticiser']} store
        </button>
      ) : null;
      if (storeManagerCanAct) {
        return (
          <div>
            {ticketUnit && <div style={{ fontSize: 11, color: '#A21CAF', fontWeight: 700, marginBottom: 8 }}>Routed to {UNIT_LABELS[ticketUnit]} store</div>}
            {/* Part request info */}
            <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#EA580C', textTransform: 'uppercase', marginBottom: 6 }}>Store request — check availability</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{selectedStoreReq.part_name}</div>
              {selectedStoreReq.quantity && <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Qty requested: {selectedStoreReq.quantity}</div>}
              {selectedStoreReq.specification && <div style={{ fontSize: 12, color: '#475569', marginTop: 4, fontStyle: 'italic' }}>{selectedStoreReq.specification}</div>}
            </div>

            {/* Availability toggle */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 8 }}>Is this part available in store?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([true, false] as const).map(v => (
                  <button key={String(v)} onClick={() => setStoreDecisionForm(f => ({ ...f, available: v }))}
                    style={{ flex: 1, padding: '12px', borderRadius: 12, border: `2px solid ${storeDecisionForm.available === v ? (v ? '#16A34A' : '#DC2626') : '#E2E8F0'}`, background: storeDecisionForm.available === v ? (v ? '#F0FDF4' : '#FEF2F2') : '#F8FAFC', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: storeDecisionForm.available === v ? (v ? '#16A34A' : '#DC2626') : '#64748B', fontFamily: 'inherit' }}>
                    {v ? '✓ Yes, in stock' : '✗ Not in stock'}
                  </button>
                ))}
              </div>
            </div>

            {/* If available: fill in stock details */}
            {storeDecisionForm.available === true && (
              <div style={{ border: '1px solid #BBF7D0', borderRadius: 12, padding: 14, marginBottom: 14, background: '#F0FDF4' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#16A34A', textTransform: 'uppercase', marginBottom: 10 }}>Stock details</div>
                <PanelRow>
                  <PanelField label="Qty available in store">
                    <PanelInput type="number" value={storeDecisionForm.qtyInStore} onChange={e => setStoreDecisionForm(f => ({ ...f, qtyInStore: e.target.value }))} placeholder="e.g. 3" />
                  </PanelField>
                  <PanelField label="Shelf / bin location">
                    <PanelInput value={storeDecisionForm.shelfLocation} onChange={e => setStoreDecisionForm(f => ({ ...f, shelfLocation: e.target.value }))} placeholder="e.g. Rack B-12, Shelf 3" />
                  </PanelField>
                </PanelRow>
                <PanelField label="Part condition">
                  <PanelSelect value={storeDecisionForm.partCondition} onChange={e => setStoreDecisionForm(f => ({ ...f, partCondition: e.target.value }))}>
                    <option value="new">New</option>
                    <option value="used_good">Used — good condition</option>
                    <option value="refurbished">Refurbished</option>
                  </PanelSelect>
                </PanelField>
              </div>
            )}

            {storeDecisionForm.available === false && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#DC2626' }}>Part not in store — will go to unit head for external procurement approval.</div>
              </div>
            )}

            <button onClick={submitStoreDecision} disabled={storeDecisionForm.available === null}
              style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#F47651', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: storeDecisionForm.available === null ? 0.4 : 1 }}>
              Submit to unit head for approval
            </button>
            {overrideBtn}
          </div>
        );
      }
      return (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ fontSize: 12, color: '#94A3B8' }}>Awaiting {ticketUnit ? `${UNIT_LABELS[ticketUnit]} ` : ''}store manager decision…</div>
          {overrideBtn}
        </div>
      );
    }

    // ── pending_unit_head: unit head approves based on store decision ──
    if (status === 'pending_unit_head') {
      return (
        <div>
          <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', marginBottom: 6 }}>
              {partAvailable ? 'Approve part handover' : 'Approve external procurement'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedStoreReq?.part_name}</div>
            {partAvailable ? (
              <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
                Store says: <strong>In stock</strong>
                {selectedStoreReq?.qty_in_store ? ` · Qty: ${selectedStoreReq.qty_in_store}` : ''}
                {selectedStoreReq?.shelf_location ? ` · ${selectedStoreReq.shelf_location}` : ''}
                {selectedStoreReq?.part_condition ? ` · ${selectedStoreReq.part_condition}` : ''}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#DC2626', marginTop: 6 }}>
                Store says: <strong>Not in stock</strong> — needs external procurement from market
              </div>
            )}
          </div>
          {isUnitHead || isAdmin ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => unitHeadApprove(true)} style={{ flex: 2, padding: '12px', borderRadius: 12, border: 'none', background: '#16A34A', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                {partAvailable ? 'Approve handover' : 'Approve procurement'}
              </button>
              <button onClick={() => unitHeadApprove(false)} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Reject</button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Awaiting Vijay Ji approval…</div>
          )}
        </div>
      );
    }

    // ── pending_purchase: unit head / Vijay enters BUSY ref ──
    if (status === 'pending_purchase') {
      return (
        <div>
          <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', marginBottom: 4 }}>External purchase required</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Part not in store. Vijay Ji to procure from market.<br />
              Enter the BUSY transaction reference once purchase is done.
            </div>
          </div>
          {isUnitHead || isAdmin ? (
            <div>
              <PanelField label="BUSY transaction reference *">
                <PanelInput value={busyRef} onChange={e => setBusyRef(e.target.value)} placeholder="e.g. PUR/2026/04421" />
              </PanelField>
              <PanelField label="Supplier / vendor (bought from)">
                <PanelInput value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="e.g. Madan Chemicals · recorded as a PO" />
              </PanelField>
              <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>The Purchase Manager enters the price from the supplier bill at the next step.</div>
              <button onClick={markPurchased} disabled={!busyRef.trim()} style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#7C3AED', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, opacity: !busyRef.trim() ? 0.5 : 1 }}>
                Mark as purchased — send to Purchase Manager
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Vijay Ji is procuring the part…</div>
          )}
        </div>
      );
    }

    // ── pending_purchase_manager: purchase manager uploads supplier bill, marks en route ──
    if (status === 'pending_purchase_manager') {
      return (
        <div>
          <div style={{ background: '#FDF4FF', border: '1px solid #F5D0FE', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#A21CAF', textTransform: 'uppercase', marginBottom: 4 }}>Upload supplier bill &amp; dispatch</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Procured via BUSY ({selectedStoreReq?.busy_transaction_ref || 'ref pending'}). Upload the supplier bill photo and confirm the part is en route to the store.
            </div>
          </div>
          {isPurchaseManager || isAdmin ? (
            <div>
              <PanelRow>
                <PanelField label="Unit price (₹)">
                  <PanelInput type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder={selectedStoreReq?.unit_price != null ? String(selectedStoreReq.unit_price) : 'e.g. 4500'} />
                </PanelField>
                <PanelField label={`Total (× ${selectedStoreReq?.quantity || 1})`}>
                  <PanelInput disabled value={(() => { const up = unitPrice.trim() ? (parseFloat(unitPrice.replace(/[^0-9.]/g, '')) || 0) : (selectedStoreReq?.unit_price || 0); return up ? `₹ ${(up * (selectedStoreReq?.quantity || 1)).toLocaleString('en-IN')}` : '—'; })()} />
                </PanelField>
              </PanelRow>
              <PhotoUploader onBlobReady={setDispatchBlob} label="Supplier bill / invoice photo" hint="Clear photo of the supplier bill for this part" />
              {uploading && <UploadBar pct={uploadPct} color="#A21CAF" />}
              <button onClick={confirmDispatch} disabled={!dispatchBlob || uploading}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#A21CAF', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, opacity: (!dispatchBlob || uploading) ? 0.5 : 1 }}>
                {uploading ? `Uploading… ${uploadPct}%` : 'Upload bill — mark en route to store'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Purchase Manager (Anshul) uploading the bill…</div>
          )}
        </div>
      );
    }

    // ── pending_handover: store manager uploads invoice + product photo, confirms handover ──
    if (status === 'pending_handover') {
      return (
        <div>
          <div style={{ background: '#FDF4FF', border: '1px solid #E9D5FF', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9333EA', textTransform: 'uppercase', marginBottom: 4 }}>
              {partAvailable ? 'Hand over part to technician' : 'Receive part & hand over to technician'}
            </div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              {partAvailable
                ? `Issue ${selectedStoreReq?.part_name} from store to technician. Upload invoice and part photo, then confirm handover.`
                : `Part procured via BUSY (${selectedStoreReq?.busy_transaction_ref || 'ref pending'}). Receive from Vijay Ji, upload invoice + product photo, then hand over to technician.`}
            </div>
          </div>
          {isStoreManager || isAdmin ? (
            <div>
              <PhotoUploader onBlobReady={setHandoverInvoiceBlob} label="Invoice / purchase bill" hint="Photo of the invoice or purchase bill for this part" />
              <PhotoUploader onBlobReady={setHandoverPhotoBlob} label="Part photo" hint="Clear photo of the part being handed over" />
              <PanelField label="Handover notes (optional)">
                <PanelTextarea value={handoverNotes} onChange={e => setHandoverNotes(e.target.value)} placeholder="e.g. New seal from supplier X, batch no…" />
              </PanelField>
              {uploading && <UploadBar pct={uploadPct} color="#9333EA" />}
              <button onClick={confirmHandover} disabled={(!handoverInvoiceBlob && !handoverPhotoBlob) || uploading}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#9333EA', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, opacity: ((!handoverInvoiceBlob && !handoverPhotoBlob) || uploading) ? 0.5 : 1 }}>
                {uploading ? `Uploading… ${uploadPct}%` : 'Confirm handover to technician'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Store manager confirming handover…</div>
          )}
        </div>
      );
    }

    // ── pending_defective_return: technician uploads old part photo + decides repair/scrap ──
    if (status === 'pending_defective_return') {
      return (
        <div>
          <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#EA580C', textTransform: 'uppercase', marginBottom: 4 }}>Return defective part</div>
            <div style={{ fontSize: 12, color: '#475569' }}>Return the old/defective part to store. Upload a clear photo and decide: repair or scrap?</div>
            {selectedStoreReq?.handover_invoice_url && (
              <a href={selectedStoreReq.handover_invoice_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563EB', display: 'block', marginTop: 6 }}>View handover invoice ↗</a>
            )}
          </div>
          {isTechnician || isAdmin ? (
            <div>
              <PhotoUploader onBlobReady={setDefectiveBlob} label="Photo of defective part" hint="Clear photo of the old/broken part being returned" />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: 8 }}>What should be done with this part?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['repair', 'scrap'] as const).map(d => (
                    <button key={d} onClick={() => setDefectiveDecision(d)}
                      style={{ flex: 1, padding: '10px', borderRadius: 12, border: `2px solid ${defectiveDecision === d ? (d === 'repair' ? '#16A34A' : '#DC2626') : '#E2E8F0'}`, background: defectiveDecision === d ? (d === 'repair' ? '#F0FDF4' : '#FEF2F2') : '#F8FAFC', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: defectiveDecision === d ? (d === 'repair' ? '#16A34A' : '#DC2626') : '#64748B', fontFamily: 'inherit' }}>
                      {d === 'repair' ? '🔧 Send for repair' : '🗑 Scrap it'}
                    </button>
                  ))}
                </div>
              </div>
              {uploading && <UploadBar pct={uploadPct} color="#F47651" />}
              <button onClick={submitDefectiveReturn} disabled={!defectiveBlob || !defectiveDecision || uploading}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#F47651', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: (!defectiveBlob || !defectiveDecision || uploading) ? 0.5 : 1 }}>
                {uploading ? 'Uploading…' : 'Submit return & close ticket'}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Awaiting technician defective part return…</div>
          )}
        </div>
      );
    }

    return null;
  }

  // skipped stages for stage strip (pending_purchase skipped if part was in store)
  // Part-in-store path skips both the external purchase and the purchase-manager dispatch.
  const skippedStages = selectedTicket && selectedStoreReq?.store_decision === 'available'
    ? ['pending_purchase', 'pending_purchase_manager']
    : [];

  // ── Blacklist guard ─────────────────────────────────────────────────────────
  // A ticket assigned to (or raised by) a restricted person is flagged. We check
  // assigned_to first (the active worker), then fall back to raised_by. When a hit
  // is found we surface a banner in the drawer AND fire one urgent notification to
  // admin + unit_head so the restriction is visible even to supervisors who aren't
  // themselves locked out by the dashboard-level overlay.
  const blacklistHit = (() => {
    if (!selectedTicket || !blacklistReady) return null;
    const candidates: { who: string; name: string | null }[] = [
      { who: 'assigned to', name: selectedTicket.assigned_to },
      { who: 'raised by',   name: selectedTicket.raised_by   },
    ];
    for (const c of candidates) {
      if (!c.name) continue;
      const entry = isPersonBlacklisted(c.name);
      if (entry) return { entry, who: c.who, name: c.name };
    }
    return null;
  })();

  const blacklistNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!blacklistHit || !selectedTicket) return;
    const key = `${selectedTicket.id}:${blacklistHit.entry.id}`;
    if (blacklistNotifiedRef.current === key) return;
    blacklistNotifiedRef.current = key;
    notifyActivity(
      blacklistHit.entry,
      `${blacklistHit.who} maintenance ticket "${selectedTicket.equipment}" (#${selectedTicket.id.slice(0, 8)})`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blacklistHit?.entry.id, selectedTicket?.id]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Tab bar */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['periodic', 'emergency'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`chip${tab === t ? ' active' : ''}`} style={{ textTransform: 'capitalize' }}>
            {t === 'periodic' ? '🔄 Periodic' : '⚡ Emergency'}
          </button>
        ))}
        {!isTechnician && !isStoreManager && (
          <button onClick={() => setTab('schedule')} className={`chip${tab === 'schedule' ? ' active' : ''}`}>
            📋 Schedule Setup
          </button>
        )}
      </div>

      {loadError ? (
        <ErrorState
          title="Couldn't load maintenance"
          message="The maintenance tickets and schedules failed to load. Check your connection and try again."
          onRetry={() => { setLoading(true); setLoadError(false); loadData(); }}
        />
      ) : loading ? (
        <div className="card p-5"><SkeletonRows rows={6} /></div>
      ) : (
      <>

      {/* ── PERIODIC TAB ─────────────────────────────────────────────────── */}
      {tab === 'periodic' && (
        <>
          <div className="grid grid-cols-12 gap-5 mb-5">
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Due today</div>
              <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{dueToday}</div>
            </div>
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Due this week</div>
              <div className="text-[28px] font-extrabold mt-1 num">{dueWeek}</div>
            </div>
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Overdue</div>
              <div className="text-[28px] font-extrabold mt-1 num text-red-600">{overdue}</div>
              <div className="text-[11px] text-red-600 mt-1">needs immediate attention</div>
            </div>
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Completed MTD</div>
              <div className="text-[28px] font-extrabold mt-1 num text-green-600">{closedPeriodicMTD}</div>
            </div>
          </div>
          <div className="card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
            <div className="text-base font-bold mb-1">Periodic maintenance schedule</div>
            <div className="text-xs text-slate-500 mb-4">Recurring tasks — auto-ticket generated when due</div>
            <div className="overflow-x-auto scroll-x">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Task</th><th>Equipment</th><th>Plant</th><th>Frequency</th>
                    <th>Last done</th><th>Next due</th><th>Status</th>
                    {(isTechnician || isAdmin || isUnitHead) && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {schedules.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-400 py-6 text-sm">
                      No schedules yet — {!isTechnician ? 'add one in Schedule Setup tab' : 'admin will set up the schedule'}
                    </td></tr>
                  )}
                  {schedules.map(s => {
                    const linkedTicket = tickets.find(t => t.schedule_id === s.id && t.status !== 'closed');
                    const days = daysFromNow(s.next_due_at);
                    const due = dueDateLabel(days);
                    let statusLabel = 'On track'; let statusBg = '#DCFCE7'; let statusColor = '#16A34A';
                    if (linkedTicket) { statusLabel = 'Ticket open'; statusBg = '#DBEAFE'; statusColor = '#2563EB'; }
                    else if (days !== null && days < 0) { statusLabel = 'Overdue'; statusBg = '#FEE2E2'; statusColor = '#DC2626'; }
                    else if (days !== null && days <= 3) { statusLabel = 'Due soon'; statusBg = '#FEF3C7'; statusColor = '#D97706'; }
                    return (
                      <tr key={s.id}>
                        <td className="font-semibold">{s.title}</td>
                        <td>{s.equipment}</td>
                        <td>{s.plants?.name || '—'}</td>
                        <td className="text-slate-500">{FREQ_LABEL[s.frequency] || s.frequency}</td>
                        <td className="text-slate-500 text-xs">{s.last_completed_at ? formatDate(s.last_completed_at) : '—'}</td>
                        <td style={{ color: due.color, fontWeight: 600, fontSize: 12 }}>{due.text}</td>
                        <td><span className="badge" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span></td>
                        {(isTechnician || isAdmin || isUnitHead) && (
                          <td>
                            {(linkedTicket || (days !== null && days <= 0)) ? (
                              <button onClick={() => setCompletingSchedule(s)} className="btn-accent pill px-3 py-1.5 font-semibold text-xs">
                                Mark complete
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">Not due</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── EMERGENCY TAB ─────────────────────────────────────────────────── */}
      {tab === 'emergency' && (
        <>
          <div className="grid grid-cols-12 gap-5 mb-5">
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Open tickets</div>
              <div className="text-[28px] font-extrabold mt-1 num text-red-600">{openEmergency}</div>
            </div>
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Pending store / approval</div>
              <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{pendingStore}</div>
            </div>
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Purchase / handover</div>
              <div className="text-[28px] font-extrabold mt-1 num text-purple-600">{pendingPurchase}</div>
            </div>
            <div className="col-span-12 lg:col-span-3 card p-5">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">Closed MTD</div>
              <div className="text-[28px] font-extrabold mt-1 num text-green-600">{closedMTD}</div>
            </div>
          </div>
          <div className="card p-6" style={{ background: 'var(--red-soft)', border: '1px solid #fecaca' }}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div>
                <div className="text-base font-bold">Emergency maintenance tickets</div>
                <div className="text-xs text-slate-500">Breakdown repairs · click any row for full workflow</div>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && emergencyTickets.length > 0 && (
                  <button
                    className="chip"
                    onClick={handleDeleteAllEmergency}
                    disabled={deletingAll}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#DC2626', borderColor: '#FECACA' }}
                  >
                    🗑 {deletingAll ? 'Deleting…' : `Delete all (${emergencyTickets.length})`}
                  </button>
                )}
                {(isAdmin || isUnitHead) && (
                  <button className="chip" onClick={() => setShowReport(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    📄 Create report
                  </button>
                )}
                <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setShowRaisePanel(true)}>
                  + Raise ticket
                </button>
              </div>
            </div>
            <div className="overflow-x-auto scroll-x">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Ticket #</th><th>Equipment</th><th>Plant</th><th>Issue</th>
                    <th>Status</th><th>Raised by</th><th>Created</th>
                    {isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {emergencyTickets.length === 0 && (
                    <tr><td colSpan={isAdmin ? 8 : 7} className="text-center text-slate-400 py-6 text-sm">No emergency tickets raised yet</td></tr>
                  )}
                  {emergencyTickets.map(t => (
                    <tr key={t.id} onClick={() => setSelectedTicket(t)} style={{ cursor: 'pointer' }}>
                      <td className="font-mono text-xs text-slate-400">{t.id.slice(0, 8)}</td>
                      <td className="font-semibold">{t.equipment}</td>
                      <td>{t.plants?.name || '—'}</td>
                      <td className="text-slate-500 text-xs">{t.description ? <MentionText text={t.description} /> : t.title}</td>
                      <td>{statusBadge(t.status)}</td>
                      <td className="text-slate-500 text-xs">{t.raised_by || '—'}</td>
                      <td className="text-slate-500 text-xs">{formatDate(t.created_at)}</td>
                      {isAdmin && (
                        <td>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteTicket(t); }}
                            title="Delete ticket"
                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#DC2626', fontSize: 13, padding: '2px 6px', lineHeight: 1 }}
                          >🗑</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── SCHEDULE SETUP TAB ─────────────────────────────────────────────── */}
      {tab === 'schedule' && !isTechnician && !isStoreManager && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <div className="text-base font-bold">Maintenance schedules</div>
              <div className="text-xs text-slate-500">Define recurring tasks — auto-tickets fire when due</div>
            </div>
            {isAdmin && (
              <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={openAddSchedule}>
                + Add schedule
              </button>
            )}
          </div>
          <div className="overflow-x-auto scroll-x">
            <table className="dt">
              <thead>
                <tr>
                  <th>Task title</th><th>Equipment</th><th>Plant</th><th>Frequency</th>
                  <th>Assigned to</th><th>Next due</th><th>Status</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {schedules.length === 0 && (
                  <tr><td colSpan={isAdmin ? 8 : 7} className="text-center text-slate-400 py-6 text-sm">No schedules defined yet</td></tr>
                )}
                {schedules.map(s => {
                  const due = dueDateLabel(daysFromNow(s.next_due_at));
                  const paused = !s.is_active;
                  return (
                    <tr key={s.id} style={paused ? { opacity: 0.6 } : undefined}>
                      <td className="font-semibold">{s.title}</td>
                      <td>{s.equipment}</td>
                      <td>{s.plants?.name || '—'}</td>
                      <td>{FREQ_LABEL[s.frequency] || s.frequency}</td>
                      <td>{s.assigned_to || <span className="text-slate-400">Unassigned</span>}</td>
                      <td style={{ color: paused ? '#94A3B8' : due.color, fontWeight: 600 }}>{paused ? 'Paused' : due.text}</td>
                      <td><span className="badge" style={{ background: s.is_active ? '#DCFCE7' : '#F1F5F9', color: s.is_active ? '#16A34A' : '#94A3B8' }}>{s.is_active ? 'Active' : 'Paused'}</span></td>
                      {isAdmin && (
                        <td>
                          <ScheduleRowMenu
                            isActive={s.is_active}
                            deleting={deletingScheduleId === s.id}
                            onRevise={() => openEditSchedule(s)}
                            onToggle={() => toggleScheduleActive(s)}
                            onDuplicate={() => openDuplicateSchedule(s)}
                            onDelete={() => handleDeleteSchedule(s)}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      </>
      )}

      {/* ── PANEL: Raise ticket ──────────────────────────────────────────── */}
      <SlidePanel open={showRaisePanel} onClose={() => { setShowRaisePanel(false); setRaiseSaved(false); }} title="Raise maintenance ticket" subtitle="Emergency · Maintenance">
        <PanelField label="Equipment / asset *">
          <PanelInput value={raiseForm.equipment} onChange={e => setRaiseForm(f => ({ ...f, equipment: e.target.value }))} placeholder="e.g. Reactor R-1, Cooling tower pump" />
        </PanelField>
        <PanelRow>
          <PanelField label="Plant">
            <PanelSelect value={raiseForm.plant} onChange={e => setRaiseForm(f => ({ ...f, plant: e.target.value }))}>
              <option value="">— Select plant —</option>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label="Procurement unit (Jharkhand)">
            <PanelSelect value={raiseForm.unit} onChange={e => setRaiseForm(f => ({ ...f, unit: e.target.value }))}>
              <option value="">— Not Jharkhand / N/A —</option>
              <option value="chlorides">Suntek Chlorides</option>
              <option value="plasticiser">Suntek Plasticiser</option>
            </PanelSelect>
          </PanelField>
        </PanelRow>
        <PanelField label="Issue description">
          <PanelTextarea value={raiseForm.description} onChange={e => setRaiseForm(f => ({ ...f, description: e.target.value }))} placeholder="What broke? What symptoms? What was the impact?" />
        </PanelField>
        <PanelField label="Initial assessment">
          <PanelSelect value={raiseForm.assessment} onChange={e => setRaiseForm(f => ({ ...f, assessment: e.target.value }))}>
            <option value="repairable">Can repair in-house</option>
            <option value="needs_part">Need a part from store</option>
          </PanelSelect>
        </PanelField>
        <PhotoUploader onBlobReady={setRaisePhotoBlob} label="Defective item photo (optional)" hint="Photo of the broken / defective item(s) — helps the team assess" />
        {uploading && <UploadBar pct={uploadPct} color="#F47651" />}
        <PanelDivider />
        <PanelFooter saved={raiseSaved} onCancel={() => setShowRaisePanel(false)} onSave={handleRaiseTicket} saveLabel={raising ? 'Raising…' : 'Raise ticket'} successLabel="Ticket raised" successSub="Store manager, admin and unit head notified" disabled={!raiseForm.equipment.trim() || raising} requiredHint="Fill in equipment name to raise ticket" />
      </SlidePanel>

      {/* ── PANEL: Complete periodic ─────────────────────────────────────── */}
      <SlidePanel open={!!completingSchedule} onClose={() => { setCompletingSchedule(null); setCompletionBlob(null); }} title="Mark maintenance complete" subtitle={completingSchedule?.title || 'Periodic · Maintenance'}>
        {completingSchedule && (
          <>
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12, padding: 14, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{completingSchedule.equipment}</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{FREQ_LABEL[completingSchedule.frequency]} maintenance · {completingSchedule.plants?.name || '—'}</div>
              {completingSchedule.description && <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>{completingSchedule.description}</div>}
            </div>
            <PhotoUploader onBlobReady={setCompletionBlob} label="Upload completion photo *" hint="Photo of the completed maintenance work as proof" />
            {uploading && <UploadBar pct={uploadPct} color="#F47651" />}
            <PanelDivider />
            <PanelFooter saved={false} onCancel={() => { setCompletingSchedule(null); setCompletionBlob(null); }} onSave={handleCompletePeriodicTicket} saveLabel={uploading ? `Uploading… ${uploadPct}%` : 'Submit & close ticket'} successLabel="Ticket closed" successSub="Admin notified · next due date updated" disabled={!completionBlob || uploading} requiredHint="Upload a photo to confirm completion" />
          </>
        )}
      </SlidePanel>

      {/* ── PANEL: Ticket detail ─────────────────────────────────────────── */}
      <SlidePanel
        open={!!selectedTicket}
        onClose={() => { setSelectedTicket(null); setEditingTicket(false); setViewStage(null); setShowStoreForm(false); setCompletionBlob(null); setDefectiveBlob(null); setHandoverInvoiceBlob(null); setHandoverPhotoBlob(null); setDispatchBlob(null); setBusyRef(''); setUnitPrice(''); setSupplierName(''); setDefectiveDecision(''); setStoreDecisionForm({ available: null, qtyInStore: '', shelfLocation: '', partCondition: 'new' }); }}
        title={selectedTicket?.equipment || 'Ticket detail'}
        subtitle={`Emergency · ${selectedTicket?.plants?.name || 'Maintenance'}`}
      >
        {selectedTicket && (
          <>
            <StageStrip status={selectedTicket.status} skippedStages={skippedStages} onStageClick={(s) => setViewStage((cur) => cur === s ? null : s)} activeStage={viewStage} />
            {viewStage && renderStageDetail(viewStage)}
            {blacklistHit && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🚫 Restricted person on this ticket
                </div>
                <div style={{ fontSize: 12, color: '#7F1D1D', marginTop: 4, lineHeight: 1.5 }}>
                  <strong>{blacklistHit.name}</strong> is {blacklistHit.who} this ticket but is on the active
                  blacklist (<strong>{blacklistHit.entry.severity}</strong>). Reason: {blacklistHit.entry.reason}.
                  <br />Admin &amp; Unit Head have been notified.
                </div>
              </div>
            )}
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>
                #{selectedTicket.id.slice(0, 8)} · Raised by {selectedTicket.raised_by || '—'}
                {selectedTicket.assigned_to && <> · Assigned to {selectedTicket.assigned_to}</>} · {formatDate(selectedTicket.created_at)}
                {selectedTicket.unit && <> · <span style={{ color: '#A21CAF', fontWeight: 700 }}>{UNIT_LABELS[selectedTicket.unit as Unit] || selectedTicket.unit}</span></>}
              </div>
              {selectedTicket.description && <div style={{ fontSize: 13, color: '#0F172A', marginTop: 4 }}><MentionText text={selectedTicket.description} /></div>}
            </div>

            {/* Notes are visible to everyone on the ticket; edit/delete are admin-only. */}
            {!editingTicket && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <NotesButton entityType="maintenance_ticket" entityId={selectedTicket.id} entityLabel={selectedTicket.equipment || selectedTicket.title || 'Ticket'} route={`/dashboard/purchase/maint?ticket=${selectedTicket.id}`} />
                {isAdmin && <button onClick={() => startEdit(selectedTicket)} className="chip">✎ Edit</button>}
                {isAdmin && <button onClick={() => handleDeleteTicket(selectedTicket)} className="chip" style={{ color: '#DC2626' }}>🗑 Delete</button>}
              </div>
            )}

            {editingTicket ? (
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Edit ticket (admin)</div>
                <PanelField label="Equipment / asset">
                  <PanelInput value={editForm.equipment} onChange={e => setEditForm(f => ({ ...f, equipment: e.target.value }))} />
                </PanelField>
                <PanelRow>
                  <PanelField label="Plant">
                    <PanelSelect value={editForm.plant} onChange={e => setEditForm(f => ({ ...f, plant: e.target.value }))}>
                      <option value="">— Select plant —</option>
                      {plantNames.map(p => <option key={p}>{p}</option>)}
                    </PanelSelect>
                  </PanelField>
                  <PanelField label="Status">
                    <PanelSelect value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                      {Object.keys(STATUS_CFG).map(s => <option key={s} value={s}>{STATUS_CFG[s].label}</option>)}
                    </PanelSelect>
                  </PanelField>
                </PanelRow>
                <PanelField label="Issue description">
                  <PanelTextarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="What broke? Type @ to tag someone." />
                </PanelField>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setEditingTicket(false)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1px solid #E2E8F0', background: '#F8FAFC', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={saveEdit} disabled={!editForm.equipment.trim()} style={{ flex: 2, padding: '10px', borderRadius: 12, border: 'none', background: '#F47651', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', opacity: !editForm.equipment.trim() ? 0.5 : 1 }}>Save changes</button>
                </div>
              </div>
            ) : (
              renderTicketActions()
            )}
          </>
        )}
      </SlidePanel>

      {/* ── PANEL: Add / revise schedule ─────────────────────────────────── */}
      <SlidePanel open={showSchedulePanel} onClose={closeSchedulePanel} title={editingSchedule ? 'Revise maintenance schedule' : 'Add maintenance schedule'} subtitle="Schedule Setup · Maintenance">
        <PanelField label="Task title *">
          <PanelInput value={scheduleForm.title} onChange={e => setScheduleForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Boiler bearing check, Filter replacement" />
        </PanelField>
        <PanelField label="Equipment *">
          <PanelInput value={scheduleForm.equipment} onChange={e => setScheduleForm(f => ({ ...f, equipment: e.target.value }))} placeholder="e.g. Boiler B-01, Cooling tower pump" />
        </PanelField>
        <PanelRow>
          <PanelField label="Plant">
            <PanelSelect value={scheduleForm.plant} onChange={e => setScheduleForm(f => ({ ...f, plant: e.target.value }))}>
              <option value="">— All plants —</option>
              {plantNames.map(p => <option key={p}>{p}</option>)}
            </PanelSelect>
          </PanelField>
          <PanelField label="Frequency">
            <PanelSelect value={scheduleForm.frequency} onChange={e => setScheduleForm(f => ({ ...f, frequency: e.target.value }))}>
              {FREQ_OPTIONS.map(f => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}
            </PanelSelect>
          </PanelField>
        </PanelRow>
        <PanelRow>
          <PanelField label={editingSchedule ? 'Next due date' : 'First due date'}>
            <PanelInput type="date" value={scheduleForm.firstDue} onChange={e => setScheduleForm(f => ({ ...f, firstDue: e.target.value }))} />
          </PanelField>
          <PanelField label="Assign to">
            <PanelSelect value={scheduleForm.assignedTo} onChange={e => setScheduleForm(f => ({ ...f, assignedTo: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {ASSIGNABLE_STAFF.map(s => <option key={s.name} value={s.name}>{s.label}</option>)}
              {/* Keep a current assignee selectable even if they're no longer in the standard staff list. */}
              {scheduleForm.assignedTo && !ASSIGNABLE_STAFF.some(s => s.name === scheduleForm.assignedTo) && (
                <option value={scheduleForm.assignedTo}>{scheduleForm.assignedTo} (current)</option>
              )}
            </PanelSelect>
          </PanelField>
        </PanelRow>
        {editingSchedule && (
          <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#0369A1' }}>
            Reassign the owner here if the current person has left — the schedule and its history stay intact. Use <b>Pause</b> on the row to put it on hold instead.
          </div>
        )}
        {scheduleForm.assignedTo && blacklistReady && isPersonBlacklisted(scheduleForm.assignedTo) && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: '#B91C1C', fontWeight: 600 }}>
            🚫 {scheduleForm.assignedTo} is on the active blacklist. Admin &amp; Unit Head will be notified on save.
          </div>
        )}
        <PanelField label="Task description / checklist">
          <PanelTextarea value={scheduleForm.description} onChange={e => setScheduleForm(f => ({ ...f, description: e.target.value }))} placeholder="Steps to complete, tools needed, safety precautions…" />
        </PanelField>
        <PanelDivider />
        <PanelFooter saved={scheduleSaved} onCancel={closeSchedulePanel} onSave={handleSaveSchedule} saveLabel={savingSchedule ? 'Saving…' : (editingSchedule ? 'Save changes' : 'Save schedule')} successLabel={editingSchedule ? 'Schedule updated' : 'Schedule created'} successSub={editingSchedule ? 'Changes saved · next ticket uses new settings' : 'Ticket will auto-generate on due date'} disabled={!scheduleForm.title.trim() || !scheduleForm.equipment.trim() || savingSchedule} requiredHint="Fill in title and equipment to create schedule" />
      </SlidePanel>

      {/* ── PANEL: Create maintenance report (CSV) ───────────────────────────── */}
      <SlidePanel open={showReport} onClose={() => setShowReport(false)} title="Create maintenance report" subtitle="Export · CSV">
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 18, lineHeight: 1.5 }}>
          Pick what to include. The CSV carries the full life of each ticket — maintenance ID, who raised it &amp; their role, who's tagged/watching, the whole part-procurement trail, every timestamp, and how it was resolved — plus a header noting who generated the report and when. Tick the box below to also export the @-mention/notes timeline as a second CSV.
        </div>

        <PanelField label="Include ticket types">
          <div style={{ display: 'flex', gap: 8 }}>
            {([['emergency', '⚡ Emergency'], ['periodic', '🔄 Periodic']] as const).map(([key, label]) => {
              const on = reportForm[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReportForm(f => ({ ...f, [key]: !f[key] }))}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                    border: `2px solid ${on ? '#F47651' : '#E2E8F0'}`, background: on ? '#FFF7F5' : '#F8FAFC', color: on ? '#F47651' : '#64748B',
                  }}
                >
                  {on ? '✓ ' : ''}{label}
                </button>
              );
            })}
          </div>
        </PanelField>

        <PanelField label="Status">
          <PanelSelect value={reportForm.status} onChange={e => setReportForm(f => ({ ...f, status: e.target.value }))}>
            <option value="all">All statuses</option>
            <option value="open">Open / in progress only</option>
            <option value="closed">Closed only</option>
          </PanelSelect>
        </PanelField>

        <PanelRow>
          <PanelField label="From date (created)">
            <PanelInput type="date" value={reportForm.from} onChange={e => setReportForm(f => ({ ...f, from: e.target.value }))} />
          </PanelField>
          <PanelField label="To date (created)">
            <PanelInput type="date" value={reportForm.to} onChange={e => setReportForm(f => ({ ...f, to: e.target.value }))} />
          </PanelField>
        </PanelRow>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer', marginBottom: 8 }}>
          <input type="checkbox" checked={reportForm.includeNotes} onChange={e => setReportForm(f => ({ ...f, includeNotes: e.target.checked }))} />
          Also export the notes / @-mention activity log (second CSV)
        </label>

        <PanelDivider />
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12, textAlign: 'center' }}>
          <strong style={{ color: '#0F172A' }}>{reportTickets().length}</strong> ticket{reportTickets().length === 1 ? '' : 's'} match these filters
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={() => setShowReport(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 24, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button type="button" onClick={generateReport} disabled={generating || reportTickets().length === 0} style={{ flex: 2, padding: '11px 0', borderRadius: 24, border: 'none', background: (generating || reportTickets().length === 0) ? '#CBD5E1' : '#F47651', fontSize: 13, fontWeight: 700, color: '#fff', cursor: (generating || reportTickets().length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {generating ? 'Generating…' : 'Generate CSV report'}
          </button>
        </div>
      </SlidePanel>
    </>
  );
}

// ── Inline upload progress bar ────────────────────────────────────────────────

function UploadBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Uploading… {pct}%</div>
      <div style={{ height: 4, background: '#E2E8F0', borderRadius: 4 }}>
        <div style={{ height: 4, background: color, borderRadius: 4, width: `${pct}%`, transition: 'width 0.2s' }} />
      </div>
    </div>
  );
}
