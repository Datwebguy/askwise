// Notion connection, page selection, page reading and approved exports.
import crypto from 'node:crypto'
import type { Db } from '../db.ts'
import { now, tx } from '../db.ts'
import { record } from '../activity.ts'
import { isOwner, sha256 } from '../auth.ts'
import type { SecretBox } from '../secret-box.ts'
import type { ConnectionView, ExportPreview, NotionPageChoice, Report } from '../../shared/types.ts'
import { NotionClient, NotionError } from './client.ts'
import { reportLines, reportPageTitle, toNotionBlocks } from './report-page.ts'
import type { ExportLine } from './report-page.ts'
import type { NotesReader } from '../research/engine.ts'

interface ConnectionRow {
  user_id: string
  provider: string
  workspace_name: string | null
  read_page_id: string | null
  read_page_title: string | null
  destination_id: string | null
  destination_title: string | null
  needs_reconnect: number
  mode: 'owner' | 'oauth'
  token_enc: string | null
}

interface ExportRow {
  id: string
  job_id: string
  user_id: string
  destination_id: string
  destination_title: string
  content_json: string
  content_hash: string
  idempotency_key: string
  status: 'PREVIEWED' | 'APPROVED' | 'EXPORTED' | 'REJECTED'
  notion_page_id: string | null
  notion_url: string | null
  updated_at: string
}

/** Reasons an export or connection request is refused. Each maps to a friendly message. */
export type NotionRefusal =
  | 'not_configured'
  | 'not_connected'
  | 'reconnect'
  | 'no_destination'
  | 'page_not_shared'
  | 'changed'
  | 'wrong_destination'
  | 'not_found'
  | 'in_progress'
  | 'rejected'
  | 'owner_only'
  | 'sign_in_failed'

export class NotionRefused extends Error {
  constructor(readonly reason: NotionRefusal) {
    super(reason)
  }
}

export interface ExportContent {
  destinationId: string
  title: string
  lines: ExportLine[]
}

export function contentHash(c: ExportContent): string {
  return sha256(JSON.stringify([c.destinationId, c.title, c.lines]))
}

export interface NotionOptions {
  /** The service's own Notion connection: used for the owner's pages and the shared page. */
  serviceToken: string | null
  /** A page anyone can save reports to, with its public link. */
  shared: { pageId: string; url: string | null } | null
  /** Notion public connection details, so people can connect their own workspace. */
  oauth: { clientId: string; clientSecret: string; redirectUri: string } | null
  box: SecretBox
  fetchImpl?: typeof fetch
}

/** Where a report will be saved, and with which connection. */
interface Target {
  id: string
  title: string
  token: string
  shared: boolean
}

export const SHARED_TITLE = 'AskWise shared reports'

export class NotionService implements NotesReader {
  constructor(
    private readonly db: Db,
    private readonly opts: NotionOptions,
  ) {}

  /** True when people can save reports somewhere, or connect their own Notion. */
  get configured(): boolean {
    return this.opts.serviceToken !== null || this.opts.oauth !== null
  }

  get oauthAvailable(): boolean {
    return this.opts.oauth !== null
  }

  get sharedPage(): { title: string; url: string | null } | null {
    return this.opts.shared && this.opts.serviceToken ? { title: SHARED_TITLE, url: this.opts.shared.url } : null
  }

  private clientWith(token: string): NotionClient {
    return new NotionClient(token, this.opts.fetchImpl)
  }

  /** The token behind a person's own connection. */
  private tokenFor(row: ConnectionRow): string {
    if (row.mode === 'oauth') {
      if (!row.token_enc) throw new NotionRefused('reconnect')
      return this.opts.box.open(row.token_enc)
    }
    if (!this.opts.serviceToken) throw new NotionRefused('not_configured')
    if (!isOwner(this.db, row.user_id)) throw new NotionRefused('owner_only')
    return this.opts.serviceToken
  }

  private client(userId: string): NotionClient {
    return this.clientWith(this.tokenFor(this.active(userId)))
  }

  private row(userId: string): ConnectionRow | null {
    return (
      (this.db.prepare(`SELECT * FROM connections WHERE user_id = ? AND provider = 'notion'`).get(userId) as ConnectionRow | undefined) ??
      null
    )
  }

  /** Returns a usable connection or refuses. */
  private active(userId: string): ConnectionRow {
    const row = this.row(userId)
    if (!row) throw new NotionRefused('not_connected')
    if (row.needs_reconnect) throw new NotionRefused('reconnect')
    return row
  }

  private markLost(userId: string, e: unknown): never {
    if (e instanceof NotionError && e.accessLost) {
      this.db.prepare(`UPDATE connections SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'notion'`).run(userId)
      record(this.db, userId, 'notion_access_lost', e.message)
      throw new NotionRefused('reconnect')
    }
    throw e
  }

  /** Where this person's next report would be saved. Refuses when there is nowhere to save. */
  private target(userId: string): Target {
    const row = this.row(userId)
    if (row) {
      if (row.needs_reconnect) throw new NotionRefused('reconnect')
      if (row.destination_id) {
        return { id: row.destination_id, title: row.destination_title ?? '', token: this.tokenFor(row), shared: false }
      }
      throw new NotionRefused('no_destination')
    }
    if (this.opts.shared && this.opts.serviceToken) {
      return { id: this.opts.shared.pageId, title: SHARED_TITLE, token: this.opts.serviceToken, shared: true }
    }
    throw new NotionRefused('not_connected')
  }

  view(userId: string): ConnectionView {
    const row = this.row(userId)
    return {
      provider: 'notion',
      connected: row !== null,
      workspaceName: row?.workspace_name ?? null,
      readPage: row?.read_page_id ? { id: row.read_page_id, title: row.read_page_title ?? '' } : null,
      destinationPage: row?.destination_id ? { id: row.destination_id, title: row.destination_title ?? '' } : null,
      needsReconnect: row ? row.needs_reconnect === 1 : false,
      mode: row?.mode ?? null,
    }
  }

  /** Connects the owner's account to the service's own Notion connection. */
  async connect(userId: string): Promise<ConnectionView> {
    if (!this.opts.serviceToken) throw new NotionRefused('not_configured')
    if (!isOwner(this.db, userId)) throw new NotionRefused('owner_only')
    const workspace = await this.clientWith(this.opts.serviceToken).workspaceName()
    this.saveConnection(userId, 'owner', null, workspace)
    return this.view(userId)
  }

  private saveConnection(userId: string, mode: 'owner' | 'oauth', tokenEnc: string | null, workspace: string): void {
    this.db
      .prepare(
        `INSERT INTO connections (user_id, provider, workspace_name, mode, token_enc, needs_reconnect, created_at)
         VALUES (?, 'notion', ?, ?, ?, 0, ?)
         ON CONFLICT (user_id, provider) DO UPDATE SET workspace_name = excluded.workspace_name, mode = excluded.mode,
           token_enc = excluded.token_enc, needs_reconnect = 0,
           read_page_id = CASE WHEN connections.mode = excluded.mode THEN connections.read_page_id END,
           read_page_title = CASE WHEN connections.mode = excluded.mode THEN connections.read_page_title END,
           destination_id = CASE WHEN connections.mode = excluded.mode THEN connections.destination_id END,
           destination_title = CASE WHEN connections.mode = excluded.mode THEN connections.destination_title END`,
      )
      .run(userId, workspace, mode, tokenEnc, now())
    record(this.db, userId, 'notion_connected')
  }

  /** Starts Notion's own sign-in. Returns the address to open. */
  startSignIn(userId: string): string {
    const o = this.opts.oauth
    if (!o) throw new NotionRefused('not_configured')
    const state = crypto.randomBytes(24).toString('base64url')
    this.db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now())
    this.db
      .prepare('INSERT INTO oauth_states (state, user_id, expires_at) VALUES (?, ?, ?)')
      .run(state, userId, new Date(Date.now() + 15 * 60_000).toISOString())
    const q = new URLSearchParams({ client_id: o.clientId, response_type: 'code', owner: 'user', redirect_uri: o.redirectUri, state })
    return `https://api.notion.com/v1/oauth/authorize?${q}`
  }

  /** Finishes Notion's sign-in: checks the one-time state, exchanges the code and stores the token encrypted. */
  async finishSignIn(state: string, code: string): Promise<string> {
    const o = this.opts.oauth
    if (!o) throw new NotionRefused('not_configured')
    const row = this.db.prepare('SELECT user_id, expires_at FROM oauth_states WHERE state = ?').get(state) as
      | { user_id: string; expires_at: string }
      | undefined
    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
    if (!row || row.expires_at < now()) throw new NotionRefused('sign_in_failed')
    const res = await (this.opts.fetchImpl ?? fetch)('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${o.clientId}:${o.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: o.redirectUri }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new NotionRefused('sign_in_failed')
    const body = (await res.json()) as { access_token?: string; workspace_name?: string }
    if (!body.access_token) throw new NotionRefused('sign_in_failed')
    this.saveConnection(row.user_id, 'oauth', this.opts.box.seal(body.access_token), body.workspace_name ?? 'Notion')
    return row.user_id
  }

  disconnect(userId: string): void {
    this.db.prepare(`DELETE FROM connections WHERE user_id = ? AND provider = 'notion'`).run(userId)
    record(this.db, userId, 'notion_disconnected')
  }

  /** Pages the person shared with AskWise in Notion. */
  async pages(userId: string): Promise<NotionPageChoice[]> {
    const pages = await this.client(userId).sharedPages().catch(e => this.markLost(userId, e))
    return pages.map(p => ({ id: p.id, title: p.title }))
  }

  /** Chooses the page AskWise may read and the page reports are saved under. Only shared pages are accepted. */
  async choosePages(userId: string, readPageId: string | null, destinationId: string | null): Promise<ConnectionView> {
    const client = this.client(userId)
    const check = async (id: string | null) => {
      if (!id) return null
      try {
        return await client.page(id)
      } catch (e) {
        if (e instanceof NotionError && e.accessLost) throw new NotionRefused('page_not_shared')
        throw e
      }
    }
    const read = await check(readPageId)
    const dest = await check(destinationId)
    this.db
      .prepare(
        `UPDATE connections SET read_page_id = ?, read_page_title = ?, destination_id = ?, destination_title = ?
         WHERE user_id = ? AND provider = 'notion'`,
      )
      .run(read?.id ?? null, read?.title ?? null, dest?.id ?? null, dest?.title ?? null, userId)
    return this.view(userId)
  }

  async readSelectedPage(userId: string): Promise<{ title: string; text: string } | null> {
    const row = this.row(userId)
    if (!row || row.needs_reconnect || !row.read_page_id) return null
    try {
      const text = await this.clientWith(this.tokenFor(row)).pageText(row.read_page_id)
      record(this.db, userId, 'notion_page_read')
      return { title: row.read_page_title ?? '', text }
    } catch (e) {
      if (e instanceof NotionError && e.accessLost) {
        this.db.prepare(`UPDATE connections SET needs_reconnect = 1 WHERE user_id = ? AND provider = 'notion'`).run(userId)
        record(this.db, userId, 'notion_access_lost', e.message)
      }
      if (e instanceof NotionRefused) return null
      return null
    }
  }

  private buildContent(report: Report, destinationId: string): ExportContent {
    return { destinationId, title: reportPageTitle(report), lines: reportLines(report) }
  }

  private exportedFor(jobId: string): ExportRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM exports WHERE job_id = ? AND status = 'EXPORTED' ORDER BY updated_at DESC LIMIT 1`)
        .get(jobId) as ExportRow | undefined) ?? null
    )
  }

  exportedInfo(jobId: string): { url: string; at: string } | null {
    const row = this.exportedFor(jobId)
    return row?.notion_url ? { url: row.notion_url, at: row.updated_at } : null
  }

  /** Prepares the exact content that would be saved. Nothing is written to Notion. */
  preview(userId: string, jobId: string, report: Report): ExportPreview {
    const target = this.target(userId)
    const content = this.buildContent(report, target.id)
    const hash = contentHash(content)
    const key = sha256(`${userId}|${jobId}|${hash}`)
    const existing = this.db.prepare('SELECT * FROM exports WHERE idempotency_key = ?').get(key) as ExportRow | undefined
    let id: string
    if (existing) {
      id = existing.id
      if (existing.status === 'REJECTED') {
        this.db.prepare(`UPDATE exports SET status = 'PREVIEWED', updated_at = ? WHERE id = ?`).run(now(), id)
      }
    } else {
      id = crypto.randomUUID()
      this.db
        .prepare(
          `INSERT INTO exports (id, job_id, user_id, destination_id, destination_title, content_json, content_hash, idempotency_key, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PREVIEWED', ?, ?)`,
        )
        .run(id, jobId, userId, target.id, target.title, JSON.stringify(content), hash, key, now(), now())
    }
    record(this.db, userId, 'export_previewed')
    const saved = this.exportedFor(jobId)
    const privateInfo: string[] = []
    if (target.shared) privateInfo.push('This goes to the public AskWise shared reports page. Anyone with its link can read it.')
    if (report.usedNotionPage) privateInfo.push(`This report mentions your Notion page "${report.usedNotionPage}".`)
    return {
      previewId: id,
      destination: { id: target.id, title: target.title },
      shared: target.shared,
      action: 'create',
      pageTitle: content.title,
      lines: content.lines,
      contentHash: hash,
      privateInfo,
      alreadySaved: saved?.notion_url ? { url: saved.notion_url, at: saved.updated_at } : null,
    }
  }

  reject(userId: string, jobId: string, previewId: string): void {
    const row = this.ownedExport(userId, jobId, previewId)
    if (row.status === 'PREVIEWED') {
      this.db.prepare(`UPDATE exports SET status = 'REJECTED', updated_at = ? WHERE id = ?`).run(now(), row.id)
    }
    record(this.db, userId, 'export_rejected')
  }

  private ownedExport(userId: string, jobId: string, previewId: string): ExportRow {
    const row = this.db.prepare('SELECT * FROM exports WHERE id = ? AND user_id = ? AND job_id = ?').get(previewId, userId, jobId) as
      | ExportRow
      | undefined
    if (!row) throw new NotionRefused('not_found')
    return row
  }

  /**
   * Writes the approved report. Checks that the person approved this exact
   * content and destination, and that it was not saved already. Repeating an
   * approval returns the page that was already created.
   */
  async approve(
    userId: string,
    jobId: string,
    previewId: string,
    approvedHash: string,
    report: Report,
  ): Promise<{ url: string; repeated: boolean }> {
    const row = this.ownedExport(userId, jobId, previewId)
    if (row.status === 'EXPORTED' && row.notion_url) {
      record(this.db, userId, 'export_repeat')
      return { url: row.notion_url, repeated: true }
    }
    if (row.status === 'REJECTED') throw new NotionRefused('rejected')
    if (row.status === 'APPROVED') throw new NotionRefused('in_progress')

    const target = this.target(userId)
    if (target.id !== row.destination_id) throw new NotionRefused('wrong_destination')
    const current = this.buildContent(report, row.destination_id)
    const hash = contentHash(current)
    if (hash !== row.content_hash || approvedHash !== row.content_hash) throw new NotionRefused('changed')

    const already = this.exportedFor(jobId)
    if (already?.notion_url && already.content_hash === row.content_hash) {
      record(this.db, userId, 'export_repeat')
      return { url: already.notion_url, repeated: true }
    }

    const claimed = tx(this.db, () => {
      const res = this.db
        .prepare(`UPDATE exports SET status = 'APPROVED', updated_at = ? WHERE id = ? AND status = 'PREVIEWED'`)
        .run(now(), row.id)
      return Number(res.changes) > 0
    })
    if (!claimed) {
      const again = this.ownedExport(userId, jobId, previewId)
      if (again.status === 'EXPORTED' && again.notion_url) return { url: again.notion_url, repeated: true }
      throw new NotionRefused('in_progress')
    }
    record(this.db, userId, 'export_approved')
    const before = (this.db.prepare('SELECT status FROM research_jobs WHERE id = ?').get(jobId) as { status: string }).status
    this.setJobStatus(jobId, 'APPROVED_FOR_EXPORT')

    try {
      const page = await this.clientWith(target.token).createPage(row.destination_id, current.title, toNotionBlocks(current.lines))
      this.db
        .prepare(`UPDATE exports SET status = 'EXPORTED', notion_page_id = ?, notion_url = ?, updated_at = ? WHERE id = ?`)
        .run(page.id, page.url, now(), row.id)
      this.setJobStatus(jobId, 'EXPORTED')
      record(this.db, userId, 'export_completed')
      return { url: page.url, repeated: false }
    } catch (e) {
      this.db.prepare(`UPDATE exports SET status = 'PREVIEWED', updated_at = ? WHERE id = ?`).run(now(), row.id)
      this.setJobStatus(jobId, before === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'READY')
      if (target.shared) throw e
      return this.markLost(userId, e)
    }
  }

  private setJobStatus(jobId: string, status: 'APPROVED_FOR_EXPORT' | 'EXPORTED' | 'READY' | 'NEEDS_REVIEW'): void {
    this.db.prepare('UPDATE research_jobs SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), jobId)
  }
}
