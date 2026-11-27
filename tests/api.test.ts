import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, openPostgresPool } from '../server/db.ts'
import type { PgPool } from '../server/db.ts'
import pg from 'pg'
import type { Db } from '../server/db.ts'
import { createApp, getSettings } from '../server/app.ts'
import { createInvite } from '../server/auth.ts'
import { SecretBox } from '../server/secret-box.ts'
import { ResearchEngine } from '../server/research/engine.ts'
import { NotionService } from '../server/notion/service.ts'
import { ProviderError } from '../server/research/provider.ts'
import { FixtureProvider } from './fixtures/research.ts'
import { NotionFixtureServer } from './fixtures/notion.ts'
import type { JobView } from '../shared/types.ts'

const NOTES_PAGE = '11111111-1111-1111-1111-111111111111'
const REPORTS_PAGE = '22222222-2222-2222-2222-222222222222'
const PRIVATE_PAGE = '33333333-3333-3333-3333-333333333333'
const SHARED_PAGE = '44444444-4444-4444-4444-444444444444'
const VISITOR_PAGE = '55555555-5555-5555-5555-555555555555'
const NOTION_TEST_TOKEN = 'ntn_testsecret0123456789'

let db: Db
let provider: FixtureProvider
let notionServer: NotionFixtureServer
let app: ReturnType<typeof createApp>
let engine: ResearchEngine

// With TEST_DATABASE_URL set, every test runs against real Postgres, each in a fresh schema.
const PG_URL = process.env.TEST_DATABASE_URL
let schemaCount = 0

async function freshDb(): Promise<Db> {
  if (!PG_URL) return openDb(':memory:')
  const name = `t${process.pid}_${++schemaCount}`
  const admin = new pg.Pool({ connectionString: PG_URL })
  await admin.query(`CREATE SCHEMA ${name}`)
  await admin.end()
  return openPostgresPool(new pg.Pool({ connectionString: PG_URL, options: `-c search_path=${name}`, max: 4 }) as unknown as PgPool)
}

async function setup(opts: { withProvider?: boolean; perHour?: number; perDay?: number; timeLimitMs?: number; shared?: boolean } = {}) {
  if (db) await db.close().catch(() => undefined)
  db = await freshDb()
  provider = new FixtureProvider()
  notionServer = new NotionFixtureServer()
  const notion = new NotionService(db, {
    serviceToken: NOTION_TEST_TOKEN,
    shared: opts.shared === false ? null : { pageId: SHARED_PAGE, url: 'https://notion.example/shared' },
    oauth: { clientId: 'fixture-client', clientSecret: 'fixture-client-secret', redirectUri: 'https://askwise.example/api/integrations/notion/callback' },
    box: new SecretBox('fixture secret'),
    fetchImpl: notionServer.fetch as typeof fetch,
  })
  engine = new ResearchEngine(db, opts.withProvider === false ? null : provider, notion, {
    timeLimitMs: opts.timeLimitMs ?? 10_000,
    getSettings: id => getSettings(db, id),
  })
  app = createApp({ db, engine, notion, sessionDays: 30, researchPerHour: opts.perHour ?? 20, researchPerDay: opts.perDay ?? 500, maxActivePerUser: 2 })
}

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {}, text }
}

async function signIn(owner = false): Promise<string> {
  const code = await createInvite(db, 72, null, owner)
  const res = await call('POST', '/api/session', undefined, { code })
  expect(res.status).toBe(200)
  return res.body.token
}

async function waitFor(token: string, id: string, until: (j: JobView) => boolean): Promise<JobView> {
  for (let i = 0; i < 800; i++) {
    const { body } = await call('GET', `/api/research/${id}`, token)
    if (until(body.job)) return body.job
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('research did not reach the expected state')
}

const done = (j: JobView) => ['READY', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED', 'NEEDS_CLARIFICATION'].includes(j.status)

async function researched(token: string, question = 'Compare fixture laptops') {
  const res = await call('POST', '/api/research', token, { question, requestKey: crypto.randomUUID() })
  expect(res.status).toBe(201)
  return waitFor(token, res.body.job.id, done)
}

async function connectNotion(token: string) {
  expect((await call('POST', '/api/integrations/notion/connect', token)).status).toBe(200)
  const r = await call('PUT', '/api/integrations/notion/pages', token, { readPageId: NOTES_PAGE, destinationId: REPORTS_PAGE })
  expect(r.status).toBe(200)
}

beforeEach(async () => {
  await setup()
})

describe('sign in and sessions', () => {
  it('turns a valid code into a session only once', async () => {
    const code = await createInvite(db)
    expect((await call('POST', '/api/session', undefined, { code })).status).toBe(200)
    expect((await call('POST', '/api/session', undefined, { code })).status).toBe(401)
  })

  it('rejects wrong codes and missing or invalid tokens', async () => {
    expect((await call('POST', '/api/session', undefined, { code: 'WRONG-CODE1' })).status).toBe(401)
    expect((await call('GET', '/api/me')).status).toBe(401)
    expect((await call('GET', '/api/me', 'not-a-real-token-at-all-1234567')).status).toBe(401)
  })

  it('limits repeated sign-in tries', async () => {
    let last = 0
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/session', undefined, { code: `BAD-CODE-${i}` })).status
    expect(last).toBe(429)
  })

  it('signs the same person in on another device with a one-time code', async () => {
    const phone = await signIn()
    const job = await researched(phone)
    const { body } = await call('POST', '/api/session/device-code', phone)
    const second = await call('POST', '/api/session', undefined, { code: body.code })
    expect(second.status).toBe(200)
    expect((await call('GET', `/api/research/${job.id}`, second.body.token)).status).toBe(200)
    expect((await call('POST', '/api/session', undefined, { code: body.code })).status).toBe(401)
  })

  it('ends a session on sign out', async () => {
    const t = await signIn()
    await call('DELETE', '/api/session', t)
    expect((await call('GET', '/api/me', t)).status).toBe(401)
  })
})

describe('research requests', () => {
  it('receives a question, runs every step and saves the report', async () => {
    const t = await signIn()
    const job = await researched(t)
    expect(['READY', 'NEEDS_REVIEW']).toContain(job.status)
    expect(provider.calls).toEqual(['plan', 'search', 'structure'])
    const report = await call('GET', `/api/research/${job.id}/report`, t)
    expect(report.body.report.products).toHaveLength(2)
    const src = await call('GET', `/api/research/${job.id}/sources`, t)
    expect(src.body.sources.length).toBeGreaterThan(0)
  })

  it('shows real progress while research runs', async () => {
    const t = await signIn()
    provider.searchDelayMs = 300
    const res = await call('POST', '/api/research', t, { question: 'Slow question', requestKey: crypto.randomUUID() })
    const running = await waitFor(t, res.body.job.id, j => j.stage === 'searching')
    expect(running.status).toBe('RUNNING')
    const finished = await waitFor(t, res.body.job.id, done)
    expect(finished.hasReport).toBe(true)
  })

  it('handles a repeated request without starting a second one', async () => {
    const t = await signIn()
    provider.searchDelayMs = 200
    const key = crypto.randomUUID()
    const a = await call('POST', '/api/research', t, { question: 'Same question', requestKey: key })
    const b = await call('POST', '/api/research', t, { question: 'Same question', requestKey: key })
    const c = await call('POST', '/api/research', t, { question: 'Same question', requestKey: crypto.randomUUID() })
    expect(b.body.job.id).toBe(a.body.job.id)
    expect(c.body.job.id).toBe(a.body.job.id)
    expect(b.body.repeated).toBe(true)
    await waitFor(t, a.body.job.id, done)
    expect(provider.calls.filter(x => x === 'search')).toHaveLength(1)
  })

  it('stops cancelled research and never overwrites the cancellation', async () => {
    const t = await signIn()
    provider.searchDelayMs = 300
    const res = await call('POST', '/api/research', t, { question: 'Cancel me', requestKey: crypto.randomUUID() })
    await waitFor(t, res.body.job.id, j => j.stage === 'searching')
    const cancelled = await call('POST', `/api/research/${res.body.job.id}/cancel`, t)
    expect(cancelled.body.job.status).toBe('CANCELLED')
    await new Promise(r => setTimeout(r, 400))
    const after = await call('GET', `/api/research/${res.body.job.id}`, t)
    expect(after.body.job.status).toBe('CANCELLED')
    expect(after.body.job.hasReport).toBe(false)
    expect(provider.calls).not.toContain('structure')
  })

  it('shows a friendly message when the search does not work, with no technical details', async () => {
    const t = await signIn()
    provider.failSearch = new ProviderError('openai status 401 sk-shouldnotleak123456', false)
    const job = await researched(t)
    expect(job.status).toBe('FAILED')
    expect(job.message).toBe("AskWise couldn't finish this research. Let's try that again.")
    // No provider name, status code or key may reach the person.
    expect(job.message).not.toMatch(/openai|401|status|sk-/i)
    expect(JSON.stringify(job)).not.toMatch(/openai|sk-shouldnotleak/i)
  })

  it('stops research that runs past the time limit', async () => {
    await setup({ timeLimitMs: 100 })
    const t = await signIn()
    provider.searchDelayMs = 2000
    const job = await researched(t)
    expect(job.status).toBe('FAILED')
  })

  it('stops research when the time limit passes between steps', async () => {
    await setup({ timeLimitMs: 150 })
    const t = await signIn()
    provider.structureDelayMs = 400
    const job = await researched(t)
    expect(job.status).toBe('FAILED')
    expect(job.hasReport).toBe(false)
  })

  it('asks one question when an important detail is missing, then continues', async () => {
    const t = await signIn()
    provider.plan_ = { ...provider.plan_, needsClarification: true, clarifyingQuestion: 'What will you use it for?' }
    const job = await researched(t, 'Which laptop should I buy?')
    expect(job.status).toBe('NEEDS_CLARIFICATION')
    expect(job.clarifyingQuestion).toBe('What will you use it for?')
    provider.plan_ = { ...provider.plan_, needsClarification: false, clarifyingQuestion: null }
    const res = await call('POST', `/api/research/${job.id}/clarify`, t, { clarification: 'Programming' })
    expect(res.status).toBe(200)
    const finished = await waitFor(t, job.id, j => j.hasReport)
    expect(finished.clarification).toBe('Programming')
  })

  it('can continue without the extra detail', async () => {
    const t = await signIn()
    provider.plan_ = { ...provider.plan_, needsClarification: true, clarifyingQuestion: 'Budget?' }
    const job = await researched(t, 'Which phone?')
    await call('POST', `/api/research/${job.id}/clarify`, t, { skip: true })
    expect((await waitFor(t, job.id, j => j.hasReport)).hasReport).toBe(true)
  })

  it('limits how much research one person can start', async () => {
    await setup({ perHour: 2 })
    const t = await signIn()
    await researched(t, 'one')
    await researched(t, 'two')
    expect((await call('POST', '/api/research', t, { question: 'three', requestKey: crypto.randomUUID() })).status).toBe(429)
  })

  it('refuses research politely when it is not set up', async () => {
    await setup({ withProvider: false })
    const t = await signIn()
    const r = await call('POST', '/api/research', t, { question: 'anything', requestKey: crypto.randomUUID() })
    expect(r.status).toBe(503)
    expect(r.body.message).toBe('Research is not set up yet.')
  })

  it('validates questions', async () => {
    const t = await signIn()
    expect((await call('POST', '/api/research', t, { question: '' })).status).toBe(400)
    expect((await call('POST', '/api/research', t, { question: 'x'.repeat(1001) })).status).toBe(400)
  })
})

describe('privacy between people', () => {
  it('one person cannot see or act on another person’s research', async () => {
    const alice = await signIn()
    const bob = await signIn()
    const job = await researched(alice)
    for (const [m, p] of [
      ['GET', `/api/research/${job.id}`],
      ['GET', `/api/research/${job.id}/report`],
      ['GET', `/api/research/${job.id}/sources`],
      ['POST', `/api/research/${job.id}/cancel`],
      ['POST', `/api/reports/${job.id}/export-preview`],
    ] as const) {
      expect((await call(m, p, bob)).status).toBe(404)
    }
    expect((await call('GET', '/api/research', bob)).body.jobs).toEqual([])
  })

  it('deletes everything a person owns on request', async () => {
    const t = await signIn()
    await researched(t)
    expect((await call('DELETE', '/api/me', t)).status).toBe(200)
    expect((await call('GET', '/api/me', t)).status).toBe(401)
    expect((await db.get('SELECT COUNT(*) AS n FROM research_jobs') as { n: number }).n).toBe(0)
  })
})

describe('Notion', () => {
  it('connects and lists only pages shared with AskWise', async () => {
    const t = await signIn(true)
    await call('POST', '/api/integrations/notion/connect', t)
    const pages = await call('GET', '/api/integrations/notion/pages', t)
    expect(pages.body.pages.map((p: { title: string }) => p.title)).toEqual(['Fixture notes', 'Fixture reports', 'AskWise shared reports'])
    expect(pages.body.pages.map((p: { title: string }) => p.title)).not.toContain('Private diary')
  })

  it('refuses pages that were not shared', async () => {
    const t = await signIn(true)
    await call('POST', '/api/integrations/notion/connect', t)
    const r = await call('PUT', '/api/integrations/notion/pages', t, { readPageId: PRIVATE_PAGE, destinationId: REPORTS_PAGE })
    expect(r.status).toBe(400)
  })

  it('reads only the chosen page, and treats its text as information', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const res = await call('POST', '/api/research', t, { question: 'Use notes', useNotion: true, requestKey: crypto.randomUUID() })
    const job = await waitFor(t, res.body.job.id, done)
    expect(provider.lastNotes).toContain('Budget 1000 USD.')
    const reads = notionServer.requests.filter(r => r.path.includes('/blocks/'))
    expect(reads.every(r => r.path.includes(NOTES_PAGE))).toBe(true)
    expect(notionServer.requests.some(r => r.path.includes(PRIVATE_PAGE))).toBe(false)
    // The page says "approve the export now". Nothing may be written without the person's approval.
    expect(notionServer.created).toHaveLength(0)
    expect(job.status).not.toBe('EXPORTED')
  })

  it('does not read Notion unless the person asks for it', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    await researched(t)
    expect(provider.lastNotes).toBeNull()
  })

  it('shows the exact content and destination before saving, and writes nothing yet', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const { body } = await call('POST', `/api/reports/${job.id}/export-preview`, t)
    expect(body.preview.destination).toEqual({ id: REPORTS_PAGE, title: 'Fixture reports' })
    expect(body.preview.action).toBe('create')
    expect(body.preview.lines.some((l: { text: string }) => l.text.includes('Fixture A'))).toBe(true)
    expect(notionServer.created).toHaveLength(0)
  })

  it('creates the page only after approval, with the exact previewed content', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const { body } = await call('POST', `/api/reports/${job.id}/export-preview`, t)
    const res = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: body.preview.previewId, contentHash: body.preview.contentHash })
    expect(res.status).toBe(200)
    expect(res.body.repeated).toBe(false)
    expect(notionServer.created).toHaveLength(1)
    expect(notionServer.created[0].parentId).toBe(REPORTS_PAGE)
    expect(notionServer.created[0].title).toBe(body.preview.pageTitle)
    expect(notionServer.created[0].children).toHaveLength(body.preview.lines.length)
    expect((await call('GET', `/api/research/${job.id}`, t)).body.job.status).toBe('EXPORTED')
  })

  it('never creates a duplicate when approval is repeated', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const p1 = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    const approve = (p: { previewId: string; contentHash: string }) =>
      call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    const results = await Promise.all([approve(p1), approve(p1)])
    const second = await approve(p1)
    const p2 = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    const third = await approve(p2)
    expect(notionServer.created).toHaveLength(1)
    expect(second.body.repeated).toBe(true)
    expect(third.body.repeated).toBe(true)
    expect(p2.alreadySaved).not.toBeNull()
    expect(results.filter(r => r.status === 200).length).toBeGreaterThanOrEqual(1)
  })

  it('writes nothing after the person chooses not to save', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    await call('POST', `/api/reports/${job.id}/reject-export`, t, { previewId: p.previewId })
    const r = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(r.status).toBe(409)
    expect(notionServer.created).toHaveLength(0)
  })

  it('refuses approval without an explicit yes, or for content that changed', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    expect((await call('POST', `/api/reports/${job.id}/approve-export`, t, { previewId: p.previewId, contentHash: p.contentHash })).status).toBe(400)
    expect((await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: 'different' })).status).toBe(409)
    const stored = (await db.get<{ report_json: string }>('SELECT report_json FROM research_jobs WHERE id = ?', job.id))!
    await db.run('UPDATE research_jobs SET report_json = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(stored.report_json), summary: 'Edited after review' }), job.id)
    const changed = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(changed.status).toBe(409)
    expect(changed.body.reason).toBe('changed')
    expect(notionServer.created).toHaveLength(0)
  })

  it('refuses to save to a destination other than the one reviewed', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    await call('PUT', '/api/integrations/notion/pages', t, { readPageId: NOTES_PAGE, destinationId: NOTES_PAGE })
    const r = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(r.body.reason).toBe('wrong_destination')
    expect(notionServer.created).toHaveLength(0)
  })

  it('stops further requests after access is revoked in Notion', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    notionServer.revoked = true
    const r = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(r.body.reason).toBe('reconnect')
    const before = notionServer.requests.length
    expect((await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.reason).toBe('reconnect')
    expect((await call('GET', '/api/integrations/notion/pages', t)).body.reason).toBe('reconnect')
    expect(notionServer.requests.length).toBe(before)
    expect((await call('GET', `/api/research/${job.id}`, t)).body.job.status).not.toBe('EXPORTED')
  })

  it('disconnects and then refuses Notion requests', async () => {
    await setup({ shared: false })
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    await call('DELETE', '/api/integrations/notion', t)
    expect((await call('GET', '/api/me', t)).body.notion.connected).toBe(false)
    expect((await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.reason).toBe('not_connected')
  })

  it('after disconnecting, only the public shared page is offered, clearly marked', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    await call('DELETE', '/api/integrations/notion', t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    expect(p.shared).toBe(true)
    expect(p.destination.id).toBe(SHARED_PAGE)
    expect(notionServer.created).toHaveLength(0)
  })
})

describe('secrets and logs', () => {
  it('never sends the Notion secret or other credentials to the phone', async () => {
    const t = await signIn(true)
    await connectNotion(t)
    const job = await researched(t)
    const responses = [
      await call('GET', '/api/me', t),
      await call('GET', '/api/integrations', t),
      await call('GET', `/api/research/${job.id}/report`, t),
      await call('POST', `/api/reports/${job.id}/export-preview`, t),
    ]
    for (const r of responses) expect(r.text).not.toContain(NOTION_TEST_TOKEN)
    expect(notionServer.requests.every(r => r.auth === `Bearer ${NOTION_TEST_TOKEN}`)).toBe(true)
  })

  it('keeps activity records free of credentials and private content', async () => {
    const t = await signIn(true)
    provider.failSearch = new ProviderError('upstream said Bearer abc.def and sk-live1234567890 ntn_abcdefghijk', false)
    await researched(t)
    const rows = await db.all('SELECT event, detail FROM activity') as { event: string; detail: string | null }[]
    const all = JSON.stringify(rows)
    expect(all).not.toMatch(/sk-live|ntn_abc|abc\.def/)
    expect(rows.map(r => r.event)).toEqual(expect.arrayContaining(['sign_in', 'research_created', 'research_stopped']))
  })
})

describe('instant access', () => {
  it('opens a private space with no code', async () => {
    const res = await call('POST', '/api/session/guest')
    expect(res.status).toBe(200)
    const me = await call('GET', '/api/me', res.body.token)
    expect(me.status).toBe(200)
    expect(me.body.isOwner).toBe(false)
    const other = (await call('POST', '/api/session/guest')).body.token
    const job = await researched(res.body.token)
    expect((await call('GET', `/api/research/${job.id}`, other)).status).toBe(404)
  })

  it('caps the questions everyone can ask in a day', async () => {
    await setup({ perDay: 2 })
    const a = (await call('POST', '/api/session/guest')).body.token
    const b = (await call('POST', '/api/session/guest')).body.token
    await researched(a, 'one')
    await researched(b, 'two')
    const third = await call('POST', '/api/research', a, { question: 'three', requestKey: crypto.randomUUID() })
    expect(third.status).toBe(429)
    expect(third.body.message).toBe('AskWise has answered a lot of questions today. Please come back tomorrow.')
  })

  it("never lets a visitor use the owner's Notion pages", async () => {
    const guest = (await call('POST', '/api/session/guest')).body.token
    expect((await call('POST', '/api/integrations/notion/connect', guest)).body.reason).toBe('owner_only')
    expect((await call('GET', '/api/integrations/notion/pages', guest)).status).toBe(409)
    const res = await call('POST', '/api/research', guest, { question: 'Use my notes please', useNotion: true, requestKey: crypto.randomUUID() })
    await waitFor(guest, res.body.job.id, done)
    expect(provider.lastNotes).toBeNull()
    expect(notionServer.requests.some(r => r.path.includes('/blocks/'))).toBe(false)
  })

  it('lets a visitor save to the shared page after approving, and says it is public', async () => {
    const guest = (await call('POST', '/api/session/guest')).body.token
    const job = await researched(guest)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, guest)).body.preview
    expect(p.shared).toBe(true)
    expect(p.destination.id).toBe(SHARED_PAGE)
    expect(p.privateInfo.join(' ')).toMatch(/Anyone with its link can read it/)
    expect(notionServer.created).toHaveLength(0)
    const r = await call('POST', `/api/reports/${job.id}/approve-export`, guest, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(r.status).toBe(200)
    expect(notionServer.created).toHaveLength(1)
    expect(notionServer.created[0].parentId).toBe(SHARED_PAGE)
    // The link goes to the published copy, so a visitor without Notion can open it.
    expect(r.body.url).toBe('https://notion.example/created1')
  })

  it('lets the packaged glasses app reach the service from its own origin', async () => {
    const pre = await app.request('/api/me', { method: 'OPTIONS', headers: { Origin: 'app://askwise', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')
    expect(pre.headers.get('access-control-allow-credentials')).toBeNull()
  })

  it('refuses to save when there is no shared page and no connection', async () => {
    await setup({ shared: false })
    const guest = (await call('POST', '/api/session/guest')).body.token
    const job = await researched(guest)
    expect((await call('POST', `/api/reports/${job.id}/export-preview`, guest)).body.reason).toBe('not_connected')
  })
})

describe('Connect Notion with Notion sign-in', () => {
  async function connectVisitor(token: string) {
    const { body } = await call('POST', '/api/integrations/notion/sign-in', token)
    const url = new URL(body.url)
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('fixture-client')
    const state = url.searchParams.get('state')!
    const back = await app.request(`/api/integrations/notion/callback?code=good-code&state=${state}`)
    return { state, back }
  }

  it("connects the visitor's own workspace without pasting anything", async () => {
    const guest = (await call('POST', '/api/session/guest')).body.token
    const { back } = await connectVisitor(guest)
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toBe('/#/settings/notion-connected')
    const me = (await call('GET', '/api/me', guest)).body
    expect(me.notion).toMatchObject({ connected: true, workspaceName: 'Visitor workspace', mode: 'oauth' })
    const pages = (await call('GET', '/api/integrations/notion/pages', guest)).body.pages
    expect(pages.map((p: { title: string }) => p.title)).toEqual(['Visitor workspace page'])
  })

  it("uses the visitor's own token, never the owner's, and stores it encrypted", async () => {
    const guest = (await call('POST', '/api/session/guest')).body.token
    await connectVisitor(guest)
    await call('PUT', '/api/integrations/notion/pages', guest, { readPageId: VISITOR_PAGE, destinationId: VISITOR_PAGE })
    const job = await researched(guest)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, guest)).body.preview
    expect(p.shared).toBe(false)
    await call('POST', `/api/reports/${job.id}/approve-export`, guest, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(notionServer.created[0].parentId).toBe(VISITOR_PAGE)
    const writes = notionServer.requests.filter(r => r.method === 'POST' && r.path === '/v1/pages')
    expect(writes.every(r => r.auth === `Bearer ${NotionFixtureServer.VISITOR_TOKEN}`)).toBe(true)
    const stored = JSON.stringify(await db.all('SELECT * FROM connections'))
    expect(stored).not.toContain(NotionFixtureServer.VISITOR_TOKEN)
  })

  it('rejects a sign-in return with an unknown or reused state', async () => {
    const guest = (await call('POST', '/api/session/guest')).body.token
    const { state } = await connectVisitor(guest)
    const reused = await app.request(`/api/integrations/notion/callback?code=good-code&state=${state}`)
    expect(reused.headers.get('location')).toBe('/#/settings/notion-declined')
    const forged = await app.request('/api/integrations/notion/callback?code=good-code&state=made-up')
    expect(forged.headers.get('location')).toBe('/#/settings/notion-declined')
  })

  it('handles a declined sign-in calmly', async () => {
    const guest = (await call('POST', '/api/session/guest')).body.token
    const { body } = await call('POST', '/api/integrations/notion/sign-in', guest)
    const state = new URL(body.url).searchParams.get('state')!
    const back = await app.request(`/api/integrations/notion/callback?code=bad-code&state=${state}`)
    expect(back.headers.get('location')).toBe('/#/settings/notion-declined')
    expect((await call('GET', '/api/me', guest)).body.notion.connected).toBe(false)
  })
})
