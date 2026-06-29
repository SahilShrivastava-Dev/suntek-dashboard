import { Check, CheckCheck } from 'lucide-react';
import type { TickState } from '../../lib/mentions';

/**
 * WhatsApp-style delivery / read tick for a comment, aggregated over everyone
 * it tagged:
 *   'sent'      → single grey ✓   (posted; not delivered to all → pipeline issue)
 *   'delivered' → double grey ✓✓  (notification created for every tagged person)
 *   'seen'      → double blue ✓✓  (every tagged person has viewed the comment)
 */
const GREY = '#94A3B8';
const BLUE = '#3B82F6';

const LABEL: Record<TickState, string> = {
  sent: 'Sent — not yet delivered to everyone tagged',
  delivered: 'Delivered to everyone tagged',
  seen: 'Seen by everyone tagged',
};

export function ReadReceipt({ state }: { state: TickState }) {
  return (
    <span title={LABEL[state]} style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }} aria-label={LABEL[state]}>
      {state === 'sent'
        ? <Check size={13} color={GREY} strokeWidth={2.5} />
        : <CheckCheck size={13} color={state === 'seen' ? BLUE : GREY} strokeWidth={2.5} />}
    </span>
  );
}
