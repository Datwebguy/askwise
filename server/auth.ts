import crypto from 'node:crypto'
import type { Db } from './db.ts'
import { now, tx } from './db.ts'

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// Invite codes: 10 characters from an alphabet without look-alike characters.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Creates a one-time code. With a userId it signs that same person in on another device. */
export function createInvite(db: Db, hoursValid = 72, userId: string | null = null): string {
  const bytes = crypto.randomBytes(10)
  const code = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  const created = new Date()
  const expires = new Date(created.getTime() + hoursValid * 3600_000)
  db.prepare('INSERT INTO invites (code_hash, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)').run(
    sha256(code),
    created.toISOString(),
    expires.toISOString(),
    userId,
  )
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

export interface Session {
  token: string
  userId: string
  expiresAt: string
}

/** Exchanges a one-time invite code for a new account and session. Returns null if the code is not valid. */
export function redeemInvite(db: Db, code: string, sessionDays: number): Session | null {
  const hash = sha256(normaliseCode(code))
  return tx(db, () => {
    const row = db.prepare('SELECT expires_at, used_at, user_id FROM invites WHERE code_hash = ?').get(hash) as
      | { expires_at: string; used_at: string | null; user_id: string | null }
      | undefined
    if (!row || row.used_at || row.expires_at < now()) return null
    let userId = row.user_id
    if (userId) {
      if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return null
    } else {
      userId = crypto.randomUUID()
      db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, now())
    }
    db.prepare('UPDATE invites SET used_at = ?, user_id = ? WHERE code_hash = ?').run(now(), userId, hash)
    return createSession(db, userId, sessionDays)
  })
}

export function createSession(db: Db, userId: string, sessionDays: number): Session {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionDays * 86400_000).toISOString()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    now(),
    expiresAt,
  )
  return { token, userId, expiresAt }
}

/** Returns the user that owns a session token, or null when the token is unknown or expired. */
export function userForToken(db: Db, token: string | undefined | null): string | null {
  if (!token || token.length < 20 || token.length > 200) return null
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
    | { user_id: string; expires_at: string }
    | undefined
  if (!row || row.expires_at < now()) return null
  return row.user_id
}

export function endSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}
