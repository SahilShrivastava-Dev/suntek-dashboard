import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { insertRows, updateRows } from '../../../lib/db';
import { useRoleContext } from '../../../contexts/RoleContext';
import { uploadMaintenancePhoto } from '../../../lib/cloudinary';
import { SlidePanel, PanelField, PanelInput, PanelSelect, PanelTextarea, PanelRow, PanelDivider, PanelFooter } from '../../../components/SlidePanel';
import { useToast } from '../../../components/ui/toast';
import { SkeletonRows, ErrorState } from '../../../components/ui/states';
import type { Database } from '../../../lib/database.types';
import {
  FREQ_OPTIONS, FREQ_LABEL, STATUS_CFG, EMERGENCY_STAGES, STAGE_LABELS,
  statusBadge, formatDate, daysFromNow, dueDateLabel, calculateNextDue,
  PhotoUploader, StageStrip,
} from './maintenance/shared';

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

// ── Main component ────────────────────────────────────────────────────────────

export function Maintenance() {
  const { activeProfile } = useRoleContext();
  const toast = useToast();
  const role = activeProfile.id;
  const isTechnician = role === 'technician_shd';
  const isAdmin = role === 'admin';
  const isUnitHead = role === 'unit_head';
  const isStoreManager = role === 'store_manager_maint' || role === 'warehouse_manager';

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

  // Form state
  const today = new Date().toISOString().split('T')[0];
  const [raiseForm, setRaiseForm] = useState({ equipment: '', plant: '', description: '', assessment: 'repairable' });
  const [scheduleForm, setScheduleForm] = useState({ title: '', equipment: '', plant: '', frequency: 'weekly', description: '', firstDue: today });
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
  const [handoverNotes, setHandoverNotes] = useState('');

  // Other action state
  const [busyRef, setBusyRef] = useState('');
  const [defectiveDecision, setDefectiveDecision] = useState<'repair' | 'scrap' | ''>('');

  // Upload
  const [completionBlob, setCompletionBlob] = useState<Blob | null>(null);
  const [defectiveBlob, setDefectiveBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Save states
  const [raiseSaved, setRaiseSaved] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);

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
  const pendingPurchase = emergencyTickets.filter(t => ['pending_purchase', 'pending_handover'].includes(t.status)).length;
  const closedMTD = emergencyTickets.filter(t => t.status === 'closed' && !!t.closed_at && t.closed_at >= monthStart).length;

  const dueToday = periodicTickets.filter(t => t.status === 'open' && t.due_date === today).length;
  const dueWeek = periodicTickets.filter(t => { const d = daysFromNow(t.due_date); return t.status === 'open' && d !== null && d >= 0 && d <= 7; }).length;
  const overdue = periodicTickets.filter(t => { const d = daysFromNow(t.due_date); return t.status === 'open' && d !== null && d < 0; }).length;
  const closedPeriodicMTD = periodicTickets.filter(t => t.status === 'closed' && !!t.closed_at && t.closed_at >= monthStart).length;

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRaiseTicket() {
    if (!raiseForm.equipment.trim()) return;
    const plant = dbPlants.find(p => p.name === raiseForm.plant);
    const { data: newTicket, error } = await insertRows('maintenance_tickets', {
      type: 'emergency', status: 'open',
      title: `${raiseForm.equipment} — ${raiseForm.assessment === 'repairable' ? 'Repairable' : 'Needs part'}`,
      equipment: raiseForm.equipment,
      plant_id: plant?.id || null,
      description: raiseForm.description || null,
      raised_by: activeProfile.name, raised_role: role,
    }).select('*, plants(name)').single();
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    notify({
      target_roles: ['admin', 'unit_head', 'store_manager_maint'],
      title: `Maintenance ticket raised: ${raiseForm.equipment}`,
      body: `${activeProfile.name} · ${raiseForm.assessment === 'repairable' ? 'Repairable in-house' : 'Needs store part'}`,
      type: 'urgent', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    setRaiseSaved(true);
    await loadData();
    setTimeout(() => {
      setShowRaisePanel(false); setRaiseSaved(false);
      setRaiseForm({ equipment: '', plant: '', description: '', assessment: 'repairable' });
      if (newTicket && raiseForm.assessment === 'needs_part') {
        setSelectedTicket(newTicket); setShowStoreForm(true);
      }
    }, 1400);
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
        }).select('*, plants(name)').single();
        ticket = data ?? undefined;
      }
      if (!ticket) throw new Error('Could not create ticket');
      const result = await uploadMaintenancePhoto(completionBlob, {
        ticketId: ticket.id, plantName: ticket.plants?.name || completingSchedule.plants?.name || 'Plant',
        photoType: 'completion', onProgress: setUploadPct,
      });
      await updateRows('maintenance_tickets', { status: 'closed', completion_photo_url: result.secure_url, closed_at: new Date().toISOString(), assigned_to: activeProfile.name })
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
    if (!storeForm.partName.trim() || !selectedTicket) return;
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
    notify({
      target_roles: ['admin', 'store_manager_maint', 'warehouse_manager'],
      title: `Store part needed: ${storeForm.partName}`,
      body: `${selectedTicket.equipment} · Qty: ${storeForm.quantity || '—'} · Check availability`,
      type: 'warning', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    setShowStoreForm(false);
    setStoreForm({ partName: '', quantity: '', specification: '' });
    await loadData();
  }

  async function startRepair() {
    if (!selectedTicket) return;
    await updateTicketStatus(selectedTicket.id, 'in_progress', { assigned_to: activeProfile.name });
    setSelectedTicket((t) => t ? { ...t, status: 'in_progress' } : t);
    await loadData();
  }

  async function closeInHouse() {
    if (!selectedTicket || !completionBlob) return;
    setUploading(true);
    try {
      const result = await uploadMaintenancePhoto(completionBlob, {
        ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
        photoType: 'completion', onProgress: setUploadPct,
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
    await loadData();
  }

  async function markPurchased() {
    if (!selectedTicket || !selectedStoreReq || !busyRef.trim()) return;
    await updateRows('maintenance_store_requests', { busy_transaction_ref: busyRef })
      .eq('id', selectedStoreReq.id);
    await updateTicketStatus(selectedTicket.id, 'pending_handover');
    setSelectedTicket((t) => t ? { ...t, status: 'pending_handover' } : t);
    notify({
      target_roles: ['store_manager_maint', 'warehouse_manager', 'admin'],
      title: `Part procured: ${selectedStoreReq.part_name}`,
      body: `BUSY ref: ${busyRef} — store manager to receive, upload invoice + photo, hand over to technician`,
      type: 'info', route: '/dashboard/purchase/maint',
      actor_name: activeProfile.name, actor_role: role, read_by: [],
    });
    setBusyRef(''); await loadData();
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
          photoType: 'bill', onProgress: pct => setUploadPct(Math.round(pct / 2)),
        });
        invoiceUrl = r.secure_url;
      }
      if (handoverPhotoBlob) {
        const r = await uploadMaintenancePhoto(handoverPhotoBlob, {
          ticketId: selectedTicket.id, plantName: selectedTicket.plants?.name || 'Plant',
          photoType: 'completion', onProgress: pct => setUploadPct(50 + Math.round(pct / 2)),
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
        photoType: 'defective', onProgress: setUploadPct,
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
      setSelectedTicket(null); setDefectiveBlob(null); setDefectiveDecision(''); setUploadPct(0);
      await loadData();
    } catch (err) { toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally { setUploading(false); }
  }

  async function handleAddSchedule() {
    if (!scheduleForm.title.trim() || !scheduleForm.equipment.trim()) return;
    const plant = dbPlants.find(p => p.name === scheduleForm.plant);
    const { error } = await insertRows('maintenance_schedules', {
      title: scheduleForm.title, equipment: scheduleForm.equipment,
      plant_id: plant?.id || null, frequency: scheduleForm.frequency as ScheduleRow['frequency'],
      description: scheduleForm.description || null, is_active: true,
      next_due_at: scheduleForm.firstDue ? new Date(scheduleForm.firstDue).toISOString() : null,
    });
    if (error) { toast.error(`Failed: ${error.message}`); return; }
    setScheduleSaved(true);
    await loadData();
    setTimeout(() => {
      setShowSchedulePanel(false); setScheduleSaved(false);
      setScheduleForm({ title: '', equipment: '', plant: '', frequency: 'weekly', description: '', firstDue: today });
    }, 1400);
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
      if (isStoreManager || isAdmin) {
        return (
          <div>
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
          </div>
        );
      }
      return <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Awaiting store manager decision…</div>;
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
              <button onClick={markPurchased} disabled={!busyRef.trim()} style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: '#7C3AED', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 8, opacity: !busyRef.trim() ? 0.5 : 1 }}>
                Mark as purchased — notify store manager
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '12px 0' }}>Vijay Ji is procuring the part…</div>
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
  const skippedStages = selectedTicket && selectedStoreReq?.store_decision === 'available'
    ? ['pending_purchase']
    : [];

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
              <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setShowRaisePanel(true)}>
                + Raise ticket
              </button>
            </div>
            <div className="overflow-x-auto scroll-x">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Ticket #</th><th>Equipment</th><th>Plant</th><th>Issue</th>
                    <th>Status</th><th>Raised by</th><th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {emergencyTickets.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-slate-400 py-6 text-sm">No emergency tickets raised yet</td></tr>
                  )}
                  {emergencyTickets.map(t => (
                    <tr key={t.id} onClick={() => setSelectedTicket(t)} style={{ cursor: 'pointer' }}>
                      <td className="font-mono text-xs text-slate-400">{t.id.slice(0, 8)}</td>
                      <td className="font-semibold">{t.equipment}</td>
                      <td>{t.plants?.name || '—'}</td>
                      <td className="text-slate-500 text-xs">{t.description || t.title}</td>
                      <td>{statusBadge(t.status)}</td>
                      <td className="text-slate-500 text-xs">{t.raised_by || '—'}</td>
                      <td className="text-slate-500 text-xs">{formatDate(t.created_at)}</td>
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
              <button className="btn-accent pill px-4 py-2 font-semibold text-sm" onClick={() => setShowSchedulePanel(true)}>
                + Add schedule
              </button>
            )}
          </div>
          <div className="overflow-x-auto scroll-x">
            <table className="dt">
              <thead>
                <tr><th>Task title</th><th>Equipment</th><th>Plant</th><th>Frequency</th><th>Next due</th><th>Status</th></tr>
              </thead>
              <tbody>
                {schedules.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-slate-400 py-6 text-sm">No schedules defined yet</td></tr>
                )}
                {schedules.map(s => {
                  const due = dueDateLabel(daysFromNow(s.next_due_at));
                  return (
                    <tr key={s.id}>
                      <td className="font-semibold">{s.title}</td>
                      <td>{s.equipment}</td>
                      <td>{s.plants?.name || '—'}</td>
                      <td>{FREQ_LABEL[s.frequency] || s.frequency}</td>
                      <td style={{ color: due.color, fontWeight: 600 }}>{due.text}</td>
                      <td><span className="badge" style={{ background: s.is_active ? '#DCFCE7' : '#F1F5F9', color: s.is_active ? '#16A34A' : '#94A3B8' }}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
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
        <PanelField label="Plant">
          <PanelSelect value={raiseForm.plant} onChange={e => setRaiseForm(f => ({ ...f, plant: e.target.value }))}>
            <option value="">— Select plant —</option>
            {plantNames.map(p => <option key={p}>{p}</option>)}
          </PanelSelect>
        </PanelField>
        <PanelField label="Issue description">
          <PanelTextarea value={raiseForm.description} onChange={e => setRaiseForm(f => ({ ...f, description: e.target.value }))} placeholder="What broke? What symptoms? What was the impact?" />
        </PanelField>
        <PanelField label="Initial assessment">
          <PanelSelect value={raiseForm.assessment} onChange={e => setRaiseForm(f => ({ ...f, assessment: e.target.value }))}>
            <option value="repairable">Can repair in-house</option>
            <option value="needs_part">Need a part from store</option>
          </PanelSelect>
        </PanelField>
        <PanelDivider />
        <PanelFooter saved={raiseSaved} onCancel={() => setShowRaisePanel(false)} onSave={handleRaiseTicket} saveLabel="Raise ticket" successLabel="Ticket raised" successSub="Store manager, admin and unit head notified" disabled={!raiseForm.equipment.trim()} requiredHint="Fill in equipment name to raise ticket" />
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
        onClose={() => { setSelectedTicket(null); setShowStoreForm(false); setCompletionBlob(null); setDefectiveBlob(null); setHandoverInvoiceBlob(null); setHandoverPhotoBlob(null); setBusyRef(''); setDefectiveDecision(''); setStoreDecisionForm({ available: null, qtyInStore: '', shelfLocation: '', partCondition: 'new' }); }}
        title={selectedTicket?.equipment || 'Ticket detail'}
        subtitle={`Emergency · ${selectedTicket?.plants?.name || 'Maintenance'}`}
      >
        {selectedTicket && (
          <>
            <StageStrip status={selectedTicket.status} skippedStages={skippedStages} />
            <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>
                #{selectedTicket.id.slice(0, 8)} · Raised by {selectedTicket.raised_by || '—'} · {formatDate(selectedTicket.created_at)}
              </div>
              {selectedTicket.description && <div style={{ fontSize: 13, color: '#0F172A', marginTop: 4 }}>{selectedTicket.description}</div>}
            </div>
            {renderTicketActions()}
          </>
        )}
      </SlidePanel>

      {/* ── PANEL: Add schedule ──────────────────────────────────────────── */}
      <SlidePanel open={showSchedulePanel} onClose={() => { setShowSchedulePanel(false); setScheduleSaved(false); }} title="Add maintenance schedule" subtitle="Schedule Setup · Maintenance">
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
        <PanelField label="First due date">
          <PanelInput type="date" value={scheduleForm.firstDue} onChange={e => setScheduleForm(f => ({ ...f, firstDue: e.target.value }))} />
        </PanelField>
        <PanelField label="Task description / checklist">
          <PanelTextarea value={scheduleForm.description} onChange={e => setScheduleForm(f => ({ ...f, description: e.target.value }))} placeholder="Steps to complete, tools needed, safety precautions…" />
        </PanelField>
        <PanelDivider />
        <PanelFooter saved={scheduleSaved} onCancel={() => setShowSchedulePanel(false)} onSave={handleAddSchedule} saveLabel="Save schedule" successLabel="Schedule created" successSub="Ticket will auto-generate on due date" disabled={!scheduleForm.title.trim() || !scheduleForm.equipment.trim()} requiredHint="Fill in title and equipment to create schedule" />
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
