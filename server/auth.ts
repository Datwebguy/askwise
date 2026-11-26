import crypto from 'node:crypto'
import type { Db } from './db.ts'
import { now } from './db.ts'

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// Invite codes: 10 characters from an alphabet without look-alike characters.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Creates a one-time code. With a userId it signs that same person in on another device. */
export async function createInvite(db: Db, hoursValid = 72, userId: string | null = null, makeOwner = false): Promise<string> {
  const bytes = crypto.randomBytes(10)
  const code = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  const created = new Date()
  const expires = new Date(created.getTime() + hoursValid * 3600_000)
  await db.run('INSERT INTO invites (code_hash, created_at, expires_at, user_id, make_owner) VALUES (?, ?, ?, ?, ?)', 
    sha256(code),
    created.toISOString(),
    expires.toISOString(),
    userId,
    makeOwner ? 1 : 0,
  )
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

export interface Session {
  token: string
  userId: string
  expiresAt: string
}

/** Exchanges a one-time invite code for a new account and session. Returns null if the code is not valid. */
export async function redeemInvite(db: Db, code: string, sessionDays: number): Promise<Session | null> {
  const hash = sha256(normaliseCode(code))
  return db.transaction(async db => {
    const row = await db.get('SELECT expires_at, used_at, user_id, make_owner FROM invites WHERE code_hash = ?', hash) as
      | { expires_at: string; used_at: string | null; user_id: string | null; make_owner: number }
      | undefined
    if (!row || row.used_at || row.expires_at < now()) return null
    let userId = row.user_id
    if (userId) {
      if (!await db.get('SELECT id FROM users WHERE id = ?', userId)) return null
    } else {
      userId = crypto.randomUUID()
      await db.run('INSERT INTO users (id, created_at) VALUES (?, ?)', userId, now())
    }
    await db.run('UPDATE invites SET used_at = ?, user_id = ? WHERE code_hash = ?', now(), userId, hash)
    if (row.make_owner) await db.run('UPDATE users SET is_owner = 1 WHERE id = ?', userId)
    return await createSession(db, userId, sessionDays)
  })
}

/** Starts a new private space for someone who just opened AskWise. No code or account details needed. */
export async function createGuest(db: Db, sessionDays: number): Promise<Session> {
  return db.transaction(async db => {
    const userId = crypto.randomUUID()
    await db.run('INSERT INTO users (id, created_at) VALUES (?, ?)', userId, now())
    return await createSession(db, userId, sessionDays)
  })
}

export async function isOwner(db: Db, userId: string): Promise<boolean> {
  const row = await db.get('SELECT is_owner FROM users WHERE id = ?', userId) as { is_owner: number } | undefined
  return row?.is_owner === 1
}

export async function createSession(db: Db, userId: string, sessionDays: number): Promise<Session> {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionDays * 86400_000).toISOString()
  await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', 
    sha256(token),
    userId,
    now(),
    expiresAt,
  )
  return { token, userId, expiresAt }
}

/** Returns the user that owns a session token, or null when the token is unknown or expired. */
export async function userForToken(db: Db, token: string | undefined | null): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null
  const row = await db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token)) as
    | { user_id: string; expires_at: string }
    | undefined
  if (!row || row.expires_at < now()) return null
  return row.user_id
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token))
}

/** Removes sessions and sign-in codes that have expired. */
export async function removeExpired(db: Db): Promise<number> {
  const t = now()
  const a = await db.run('DELETE FROM sessions WHERE expires_at < ?', t)
  const b = await db.run('DELETE FROM invites WHERE expires_at < ? AND used_at IS NULL', t)
  return Number(a.changes) + Number(b.changes)
}
