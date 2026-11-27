// Storage for AskWise. The same queries run on SQLite (local use and tests)
// and on Postgres (hosted). Queries use "?" placeholders.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export interface Db {
  readonly kind: 'sqlite' | 'postgres'
  get<T>(sql: string, ...args: unknown[]): Promise<T | undefined>
  all<T>(sql: string, ...args: unknown[]): Promise<T[]>
  run(sql: string, ...args: unknown[]): Promise<{ changes: number }>
  /** Runs fn inside one transaction; everything inside must use the db it is given. */
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>
  /** Releases connections. */
  close(): Promise<void>
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  country TEXT,
  currency TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key TEXT,
  question TEXT NOT NULL,
  clarification TEXT,
  clarifying_question TEXT,
  use_notion INTEGER NOT NULL DEFAULT 0,
  research_type TEXT,
  plan_json TEXT,
  status TEXT NOT NULL,
  stage TEXT,
  message TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, request_key)
);
CREATE INDEX IF NOT EXISTS research_jobs_user ON research_jobs(user_id, created_at);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL,
  destination_title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  notion_page_id TEXT,
  notion_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  workspace_name TEXT,
  read_page_id TEXT,
  read_page_title TEXT,
  destination_id TEXT,
  destination_title TEXT,
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
`

// Columns added after the first release. Each is added once if missing.
const ADDED_COLUMNS: [table: string, column: string, definition: string][] = [
  ['users', 'is_owner', 'INTEGER NOT NULL DEFAULT 0'],
  ['invites', 'make_owner', 'INTEGER NOT NULL DEFAULT 0'],
  ['connections', 'mode', "TEXT NOT NULL DEFAULT 'owner'"],
  ['connections', 'token_enc', 'TEXT'],
]

const LATER_TABLES = `
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
`

// ---- SQLite (local use and tests) -----------------------------------
class SqliteDb implements Db {
  readonly kind = 'sqlite' as const
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly raw: DatabaseSync) {}

  async get<T>(sql: string, ...args: unknown[]): Promise<T | undefined> {
    return this.raw.prepare(sql).get(...(args as never[])) as T | undefined
  }
  async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.raw.prepare(sql).all(...(args as never[])) as unknown as T[]
  }
  async run(sql: string, ...args: unknown[]): Promise<{ changes: number }> {
    return { changes: Number(this.raw.prepare(sql).run(...(args as never[])).changes) }
  }
  async close(): Promise<void> {
    this.raw.close()
  }
  /** SQLite has one connection, so transactions wait for each other. */
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.raw.exec('BEGIN IMMEDIATE')
      try {
        const out = await fn(this)
        this.raw.exec('COMMIT')
        return out
      } catch (e) {
        this.raw.exec('ROLLBACK')
        throw e
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  raw.exec(SCHEMA)
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const cols = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!cols.some(c => c.name === column)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
  raw.exec(LATER_TABLES)
  return new SqliteDb(raw)
}

// ---- Postgres (hosted) ----------------------------------------------
/** Turns "?" placeholders into $1, $2 and so on. */
export function toPostgres(sql: string): string {
  let n = 0
  return sql.replace(/[?]/g, () => `$${++n}`)
}

interface PgQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>
}

/** Postgres returns COUNT(*) as text; AskWise always names counts "n". */
function fixRow<T>(row: unknown): T {
  const r = row as Record<string, unknown>
  if (r && typeof r.n === 'string') r.n = Number(r.n)
  return r as T
}

class PostgresDb implements Db {
  readonly kind = 'postgres' as const

  constructor(
    private readonly q: PgQueryable,
    private readonly connect: (() => Promise<{ client: PgQueryable; release(): void }>) | null,
    private readonly end: () => Promise<void> = async () => undefined,
  ) {}

  close(): Promise<void> {
    return this.end()
  }

  async get<T>(sql: string, ...args: unknown[]): Promise<T | undefined> {
    const r = await this.q.query(toPostgres(sql), args)
    return r.rows[0] === undefined ? undefined : fixRow<T>(r.rows[0])
  }
  async all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return (await this.q.query(toPostgres(sql), args)).rows.map(x => fixRow<T>(x))
  }
  async run(sql: string, ...args: unknown[]): Promise<{ changes: number }> {
    return { changes: (await this.q.query(toPostgres(sql), args)).rowCount ?? 0 }
  }
  async transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (!this.connect) return fn(this)
    const { client, release } = await this.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(new PostgresDb(client, null))
      await client.query('COMMIT')
      return out
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      release()
    }
  }
}

/** Any pg-compatible pool: Neon's serverless pool when hosted, or the standard pg pool for tests. */
export interface PgPool extends PgQueryable {
  connect(): Promise<PgQueryable & { release(): void }>
  end(): Promise<void>
}

export async function openPostgresPool(pool: PgPool): Promise<Db> {
  const schema = (SCHEMA + LATER_TABLES).replace('id INTEGER PRIMARY KEY AUTOINCREMENT', 'id SERIAL PRIMARY KEY')
  for (const stmt of schema.split(';').map(x => x.trim()).filter(Boolean)) await pool.query(stmt)
  for (const [table, column, definition] of ADDED_COLUMNS) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`)
  }
  return new PostgresDb(
    pool,
    async () => {
      const client = await pool.connect()
      return { client, release: () => client.release() }
    },
    () => pool.end(),
  )
}

export async function openPostgres(url: string): Promise<Db> {
  // Neon needs its own driver; any other Postgres host uses the standard one.
  const onNeon = /(^|[.@])neon\.tech([:/?]|$)/.test(url)
  const { Pool } = onNeon ? await import('@neondatabase/serverless') : (await import('pg')).default
  return openPostgresPool(new Pool({ connectionString: url }) as unknown as PgPool)
}

export const now = () => new Date().toISOString()
