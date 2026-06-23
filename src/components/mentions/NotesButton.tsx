import React, { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { SlidePanel } from '../SlidePanel';
import { MentionTextarea } from './MentionTextarea';
import { MentionText } from './MentionText';
import { CcSelect } from './CcSelect';
import { useRoleContext } from '../../contexts/RoleContext';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useToast } from '../ui/toast';
import {
  useDirectory, getNotes, getNotesCount, getWatchers, postNote, addWatchers, truncate,
  type EntityNote,
} from '../../lib/mentions';

/**
 * A self-contained "Notes" button for any record — especially button-only
 * workflows that have no free-text field. Opens a thread where users can write
 * a note, @-tag people, and CC watchers. Tagged people are notified instantly;
 * CC'd people are persisted as watchers so future workflow changes notify them
 * too (via notifyWatchers at the status-transition points).
 */
interface Props {
  entityType: string;
  entityId: string;
  entityLabel: string;
  route?: string | null;
  /** Override the trigger's class (defaults to the global `chip` style). */
  triggerClassName?: string;
  /** Render just an icon (for dense rows). */
  iconOnly?: boolean;
}

export function NotesButton({ entityType, entityId, entityLabel, route, triggerClassName = 'chip', iconOnly }: Props) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<EntityNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [count, setCount] = useState(0);

  const { activeProfile } = useRoleContext();
  const { addNotification } = useNotifications();
  const people = useDirectory();
  const toast = useToast();

  const ref = { entityType, entityId, entityLabel, route };
  const actor = { id: activeProfile.id, name: activeProfile.name, role: activeProfile.roleLabel };

  async function load() {
    setLoading(true);
    const [n, w] = await Promise.all([getNotes(entityType, entityId), getWatchers(entityType, entityId)]);
    setNotes(n);
    setCount(n.length);
    setCc(w.filter((x) => x.kind === 'cc').map((x) => x.profile_id));
    setLoading(false);
  }

  // Fetch the thread when the panel opens. State is updated after the awaited
  // fetch resolves (not synchronously in the effect body), with a cancel guard.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([getNotes(entityType, entityId), getWatchers(entityType, entityId)]).then(([n, w]) => {
      if (cancelled) return;
      setNotes(n);
      setCount(n.length);
      setCc(w.filter((x) => x.kind === 'cc').map((x) => x.profile_id));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, entityType, entityId]);

  // Show how many notes exist on mount, so the button hints there's a trace.
  useEffect(() => {
    let cancelled = false;
    getNotesCount(entityType, entityId).then((c) => { if (!cancelled) setCount(c); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      const text = body.trim();
      await postNote({ ref, actor, body: text, mentionIds, people, addNotification });

      // Persist CC watchers and notify the ones not already pinged as mentions.
      const ccPeople = people.filter((p) => cc.includes(p.id));
      if (ccPeople.length) {
        await addWatchers(ref, ccPeople.map((p) => ({ id: p.id, name: p.name })), 'cc', actor.id);
        const ccTargets = cc.filter((id) => id !== actor.id && !mentionIds.includes(id));
        if (ccTargets.length) {
          await addNotification({
            target_roles: ccTargets,
            title: `${actor.name} CC’d you`,
            body: `${entityLabel}: “${truncate(text)}”`,
            type: 'info',
            route: route ?? null,
            actor_name: actor.name,
            actor_role: actor.role,
          });
        }
      }

      const notified =
        mentionIds.filter((id) => id !== actor.id).length +
        cc.filter((id) => id !== actor.id && !mentionIds.includes(id)).length;
      toast.success(notified ? `Note posted · ${notified} notified` : 'Note posted');
      setBody('');
      setMentionIds([]);
      await load();
    } catch {
      toast.error('Could not post note');
    } finally {
      setPosting(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setLoading(true); setOpen(true); }} className={triggerClassName} style={iconOnly ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <MessageSquare size={13} />
        {!iconOnly && <span>Notes{(notes.length || count) ? ` · ${notes.length || count}` : ''}</span>}
      </button>

      <SlidePanel open={open} onClose={() => setOpen(false)} title="Notes & tags" subtitle={entityLabel}>
        {/* Existing thread */}
        {loading ? (
          <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>Loading…</div>
        ) : notes.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94A3B8', padding: '4px 0 12px' }}>
            No notes yet. Add one below — type <strong>@</strong> to tag a teammate.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ border: '1px solid #F1F5F9', borderRadius: 12, padding: '10px 12px', background: '#FCFCFD' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>{n.author_name}</span>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>{fmtTime(n.created_at)}</span>
                </div>
                <MentionText text={n.body} style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }} />
              </div>
            ))}
          </div>
        )}

        {/* Composer */}
        <div style={{ marginBottom: 12 }}>
          <MentionTextarea
            value={body}
            onChange={setBody}
            onMentionsChange={setMentionIds}
            placeholder="Write a note… type @ to tag someone for a heads-up"
            excludeIds={[actor.id]}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <CcSelect value={cc} onChange={setCc} excludeIds={[actor.id]} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ flex: 1, padding: '11px 0', borderRadius: 24, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: 13, fontWeight: 600, color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={post}
            disabled={!body.trim() || posting}
            style={{ flex: 2, padding: '11px 0', borderRadius: 24, border: 'none', background: !body.trim() || posting ? '#CBD5E1' : '#F47651', fontSize: 13, fontWeight: 700, color: '#fff', cursor: !body.trim() || posting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            {posting ? 'Posting…' : 'Post note'}
          </button>
        </div>
      </SlidePanel>
    </>
  );
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
