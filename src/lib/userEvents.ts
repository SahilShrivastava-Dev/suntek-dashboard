/**
 * Profile-settings shared helpers: the preferred-language list and the audit-log
 * writer. Both the self-service SettingsModal and the admin UserManagement page
 * record changes here so the History panel can show who changed what.
 */
import { insertRows } from './db';

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी · Hindi' },
  { value: 'bn', label: 'বাংলা · Bengali' },
  { value: 'or', label: 'ଓଡ଼ିଆ · Odia' },
  { value: 'pa', label: 'ਪੰਜਾਬੀ · Punjabi' },
];

export function languageLabel(code: string | null | undefined): string {
  return LANGUAGE_OPTIONS.find((l) => l.value === code)?.label ?? 'English';
}

export type UserEventAction =
  | 'created'
  | 'self_update'
  | 'admin_update'
  | 'password_reset'
  | 'login_enabled'
  | 'login_disabled';

export interface LogEventInput {
  userAccountId?: string | null;
  targetName?: string | null;
  targetEmail?: string | null;
  action: UserEventAction;
  details: string;
  actorName?: string | null;
  actorRole?: string | null;
}

/**
 * Append a profile-change event to user_account_events. Best-effort — never
 * throws (a missing table or RLS issue must not block the actual save).
 */
export async function logUserAccountEvent(e: LogEventInput): Promise<void> {
  try {
    await insertRows('user_account_events', {
      user_account_id: e.userAccountId ?? null,
      target_name: e.targetName ?? null,
      target_email: e.targetEmail ?? null,
      action: e.action,
      details: e.details,
      actor_name: e.actorName ?? null,
      actor_role: e.actorRole ?? null,
    });
  } catch {
    /* swallow — auditing is best-effort */
  }
}
