import type { Db } from './db.ts'
import { now } from './db.ts'

export type ActivityEvent =
  | 'sign_in'
  | 'sign_in_refused'
  | 'research_created'
  | 'research_recheck'
  | 'research_follow_up'
  | 'research_cancelled'
  | 'research_stopped'
  | 'notion_connected'
  | 'notion_disconnected'
  | 'notion_page_read'
  | 'notion_access_lost'
  | 'export_previewed'
  | 'export_rejected'
  | 'export_approved'
  | 'export_completed'
  | 'export_repeat'
  | 'access_refused'
  | 'data_deleted'

// Details must never contain credentials, report text or page content.
const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|ntn_[A-Za-z0-9]{8,}|secret_[A-Za-z0-9]{8,}|Bearer\s+\S+)/g

export function redact(text: string): string {
  return text.replace(SECRET_PATTERN, '[hidden]')
}

/** Records an event without making the caller wait; a missed record never blocks the person. */
export function record(db: Db, userId: string | null, event: ActivityEvent, detail?: string): void {
  void db.run('INSERT INTO activity (user_id, event, detail, created_at) VALUES (?, ?, ?, ?)', 
    userId,
    event,
    detail ? redact(detail).slice(0, 300) : null,
    now(),
  ).catch(() => undefined)
}

/** Writes an operational line to the console with any credentials removed. */
export function log(message: string): void {
  console.log(`[askwise] ${redact(message)}`)
}
