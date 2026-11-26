import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import type { Db } from '../server/db.ts'
import { createApp, getSettings } from '../server/app.ts'
import { createInvite } from '../server/auth.ts'
import { ResearchEngine } from '../server/research/engine.ts'
import { NotionService } from '../server/notion/service.ts'
import { ProviderError } from '../server/research/provider.ts'
import { FixtureProvider } from './fixtures/research.ts'
import { NotionFixtureServer } from './fixtures/notion.ts'
import type { JobView } from '../shared/types.ts'

const NOTES_PAGE = '11111111-1111-1111-1111-111111111111'
const REPORTS_PAGE = '22222222-2222-2222-2222-222222222222'
const PRIVATE_PAGE = '33333333-3333-3333-3333-333333333333'
const NOTION_TEST_TOKEN = 'ntn_testsecret0123456789'

let db: Db
let provider: FixtureProvider
let notionServer: NotionFixtureServer
let app: ReturnType<typeof createApp>
let engine: ResearchEngine

function setup(opts: { withProvider?: boolean; perHour?: number; timeLimitMs?: number } = {}) {
  db = openDb(':memory:')
  provider = new FixtureProvider()
  notionServer = new NotionFixtureServer()
  const notion = new NotionService(db, NOTION_TEST_TOKEN, notionServer.fetch as typeof fetch)
  engine = new ResearchEngine(db, opts.withProvider === false ? null : provider, notion, {
    timeLimitMs: opts.timeLimitMs ?? 10_000,
    getSettings: id => getSettings(db, id),
  })
  app = createApp({ db, engine, notion, sessionDays: 30, researchPerHour: opts.perHour ?? 20, maxActivePerUser: 2 })
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

async function signIn(): Promise<string> {
  const code = createInvite(db)
  const res = await call('POST', '/api/session', undefined, { code })
  expect(res.status).toBe(200)
  return res.body.token
}

async function waitFor(token: string, id: string, until: (j: JobView) => boolean): Promise<JobView> {
  for (let i = 0; i < 200; i++) {
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

beforeEach(() => setup())

describe('sign in and sessions', () => {
  it('turns a valid code into a session only once', async () => {
    const code = createInvite(db)
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
    const body = JSON.stringify(job)
    expect(body).not.toMatch(/openai|401|sk-/)
  })

  it('stops research that runs past the time limit', async () => {
    setup({ timeLimitMs: 100 })
    const t = await signIn()
    provider.searchDelayMs = 2000
    const job = await researched(t)
    expect(job.status).toBe('FAILED')
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
    setup({ perHour: 2 })
    const t = await signIn()
    await researched(t, 'one')
    await researched(t, 'two')
    expect((await call('POST', '/api/research', t, { question: 'three', requestKey: crypto.randomUUID() })).status).toBe(429)
  })

  it('refuses research politely when it is not set up', async () => {
    setup({ withProvider: false })
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
    expect((db.prepare('SELECT COUNT(*) AS n FROM research_jobs').get() as { n: number }).n).toBe(0)
  })
})

describe('Notion', () => {
  it('connects and lists only pages shared with AskWise', async () => {
    const t = await signIn()
    await call('POST', '/api/integrations/notion/connect', t)
    const pages = await call('GET', '/api/integrations/notion/pages', t)
    expect(pages.body.pages.map((p: { title: string }) => p.title)).toEqual(['Fixture notes', 'Fixture reports'])
  })

  it('refuses pages that were not shared', async () => {
    const t = await signIn()
    await call('POST', '/api/integrations/notion/connect', t)
    const r = await call('PUT', '/api/integrations/notion/pages', t, { readPageId: PRIVATE_PAGE, destinationId: REPORTS_PAGE })
    expect(r.status).toBe(400)
  })

  it('reads only the chosen page, and treats its text as information', async () => {
    const t = await signIn()
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
    const t = await signIn()
    await connectNotion(t)
    await researched(t)
    expect(provider.lastNotes).toBeNull()
  })

  it('shows the exact content and destination before saving, and writes nothing yet', async () => {
    const t = await signIn()
    await connectNotion(t)
    const job = await researched(t)
    const { body } = await call('POST', `/api/reports/${job.id}/export-preview`, t)
    expect(body.preview.destination).toEqual({ id: REPORTS_PAGE, title: 'Fixture reports' })
    expect(body.preview.action).toBe('create')
    expect(body.preview.lines.some((l: { text: string }) => l.text.includes('Fixture A'))).toBe(true)
    expect(notionServer.created).toHaveLength(0)
  })

  it('creates the page only after approval, with the exact previewed content', async () => {
    const t = await signIn()
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
    const t = await signIn()
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
    const t = await signIn()
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    await call('POST', `/api/reports/${job.id}/reject-export`, t, { previewId: p.previewId })
    const r = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(r.status).toBe(409)
    expect(notionServer.created).toHaveLength(0)
  })

  it('refuses approval without an explicit yes, or for content that changed', async () => {
    const t = await signIn()
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    expect((await call('POST', `/api/reports/${job.id}/approve-export`, t, { previewId: p.previewId, contentHash: p.contentHash })).status).toBe(400)
    expect((await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: 'different' })).status).toBe(409)
    db.prepare(`UPDATE research_jobs SET report_json = json_set(report_json, '$.summary', 'Edited after review') WHERE id = ?`).run(job.id)
    const changed = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(changed.status).toBe(409)
    expect(changed.body.reason).toBe('changed')
    expect(notionServer.created).toHaveLength(0)
  })

  it('refuses to save to a destination other than the one reviewed', async () => {
    const t = await signIn()
    await connectNotion(t)
    const job = await researched(t)
    const p = (await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.preview
    await call('PUT', '/api/integrations/notion/pages', t, { readPageId: NOTES_PAGE, destinationId: NOTES_PAGE })
    const r = await call('POST', `/api/reports/${job.id}/approve-export`, t, { approved: true, previewId: p.previewId, contentHash: p.contentHash })
    expect(r.body.reason).toBe('wrong_destination')
    expect(notionServer.created).toHaveLength(0)
  })

  it('stops further requests after access is revoked in Notion', async () => {
    const t = await signIn()
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
    const t = await signIn()
    await connectNotion(t)
    const job = await researched(t)
    await call('DELETE', '/api/integrations/notion', t)
    expect((await call('GET', '/api/me', t)).body.notion.connected).toBe(false)
    expect((await call('POST', `/api/reports/${job.id}/export-preview`, t)).body.reason).toBe('not_connected')
  })
})

describe('secrets and logs', () => {
  it('never sends the Notion secret or other credentials to the phone', async () => {
    const t = await signIn()
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
    const t = await signIn()
    provider.failSearch = new ProviderError('upstream said Bearer abc.def and sk-live1234567890 ntn_abcdefghijk', false)
    await researched(t)
    const rows = db.prepare('SELECT event, detail FROM activity').all() as { event: string; detail: string | null }[]
    const all = JSON.stringify(rows)
    expect(all).not.toMatch(/sk-live|ntn_abc|abc\.def/)
    expect(rows.map(r => r.event)).toEqual(expect.arrayContaining(['sign_in', 'research_created', 'research_stopped']))
  })
})
