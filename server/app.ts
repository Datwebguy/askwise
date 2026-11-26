import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import type { Db } from './db.ts'
import { createSession, endSession, redeemInvite, userForToken } from './auth.ts'
import { log, record } from './activity.ts'
import { MESSAGES } from '../shared/labels.ts'
import { ACTIVE_STATUSES } from '../shared/types.ts'
import type { Report, Settings } from '../shared/types.ts'
import type { ResearchEngine } from './research/engine.ts'
import * as jobs from './research/jobs.ts'
import { NotionRefused } from './notion/service.ts'
import type { NotionRefusal, NotionService } from './notion/service.ts'
import { NotionError } from './notion/client.ts'
import { AttemptLimiter } from './limits.ts'

export interface AppDeps {
  db: Db
  engine: ResearchEngine
  notion: NotionService
  sessionDays: number
  researchPerHour: number
  maxActivePerUser: number
}

type Env = { Variables: { userId: string; token: string } }

const NOTION_MESSAGES: Record<NotionRefusal, { status: 400 | 404 | 409; message: string }> = {
  not_configured: { status: 409, message: 'Notion is not set up for AskWise yet.' },
  not_connected: { status: 409, message: 'Connect Notion first.' },
  reconnect: { status: 409, message: MESSAGES.notionReconnect },
  no_destination: { status: 409, message: 'Choose a Notion page to save reports under.' },
  page_not_shared: { status: 400, message: 'AskWise can only use pages you shared with it in Notion.' },
  changed: { status: 409, message: MESSAGES.changedSinceReview },
  wrong_destination: { status: 409, message: 'The save location changed. Please review the report again.' },
  not_found: { status: 404, message: MESSAGES.notFound },
  in_progress: { status: 409, message: 'Saving is already in progress.' },
  rejected: { status: 409, message: 'You chose not to save this. Review it again to save.' },
}

const COUNTRY_RE = /^[\p{L} .'-]{2,56}$/u
const CURRENCY_RE = /^[A-Z]{3}$/

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, engine, notion } = deps
  const app = new Hono<Env>()
  const signInLimiter = new AttemptLimiter(10, 15 * 60_000)

  app.use('*', secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }))
  app.use('/api/*', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ message: MESSAGES.checkInput }, 413) }))

  app.onError((err, c) => {
    if (err instanceof NotionRefused) {
      const m = NOTION_MESSAGES[err.reason]
      return c.json({ message: m.message, reason: err.reason }, m.status)
    }
    if (err instanceof NotionError) {
      log(`notion: ${err.message}`)
      return c.json({ message: MESSAGES.retry }, 502)
    }
    log(`request ${c.req.method} ${c.req.path}: ${err.message}`)
    return c.json({ message: MESSAGES.retry }, 500)
  })

  // ---- Session -------------------------------------------------------
  app.post('/api/session', async c => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    if (!signInLimiter.allow(ip)) return c.json({ message: 'Too many tries. Please wait a few minutes.' }, 429)
    const body = await readJson(c)
    const code = typeof body.code === 'string' ? body.code : ''
    if (code.length < 6 || code.length > 40) return c.json({ message: 'Please enter your sign-in code.' }, 400)
    const session = redeemInvite(db, code, deps.sessionDays)
    if (!session) {
      record(db, null, 'sign_in_refused')
      return c.json({ message: "That code didn't work. Please check it and try again." }, 401)
    }
    record(db, session.userId, 'sign_in')
    return c.json({ token: session.token, expiresAt: session.expiresAt })
  })

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/session' && c.req.method === 'POST') return next()
    const auth = c.req.header('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    const userId = userForToken(db, token)
    if (!userId) {
      record(db, null, 'access_refused', c.req.path.split('/').slice(0, 3).join('/'))
      return c.json({ message: MESSAGES.signInAgain }, 401)
    }
    c.set('userId', userId)
    c.set('token', token)
    return next()
  })

  app.delete('/api/session', c => {
    endSession(db, c.get('token'))
    return c.json({ ok: true })
  })

  /** Issues a second session for another device of the same person (for example the glasses app). */
  app.post('/api/session/device', c => {
    const s = createSession(db, c.get('userId'), deps.sessionDays)
    return c.json({ token: s.token, expiresAt: s.expiresAt })
  })

  // ---- Account and settings ------------------------------------------
  app.get('/api/me', c => {
    const userId = c.get('userId')
    return c.json({
      settings: getSettings(db, userId),
      researchAvailable: engine.available,
      notionAvailable: notion.configured,
      notion: notion.view(userId),
    })
  })

  app.put('/api/settings', async c => {
    const body = await readJson(c)
    const country = body.country === null || body.country === '' ? null : String(body.country ?? '').trim()
    const currency = body.currency === null || body.currency === '' ? null : String(body.currency ?? '').trim().toUpperCase()
    if ((country !== null && !COUNTRY_RE.test(country)) || (currency !== null && !CURRENCY_RE.test(currency))) {
      return c.json({ message: MESSAGES.checkInput }, 400)
    }
    db.prepare('UPDATE users SET country = ?, currency = ? WHERE id = ?').run(country, currency, c.get('userId'))
    return c.json({ settings: getSettings(db, c.get('userId')) })
  })

  /** Deletes the person's research, saved exports, connections and account. */
  app.delete('/api/me', c => {
    const userId = c.get('userId')
    for (const row of jobs.listJobs(db, userId, 1000)) engine.cancel(row.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
    db.prepare('UPDATE activity SET user_id = NULL, detail = NULL WHERE user_id = ?').run(userId)
    record(db, null, 'data_deleted')
    return c.json({ ok: true })
  })

  // ---- Research ------------------------------------------------------
  app.post('/api/research', async c => {
    const userId = c.get('userId')
    if (!engine.available) return c.json({ message: 'Research is not set up yet.' }, 503)
    const body = await readJson(c)
    const question = typeof body.question === 'string' ? body.question.replace(/\s+/g, ' ').trim() : ''
    const requestKey = typeof body.requestKey === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(body.requestKey) ? body.requestKey : null
    if (question.length < 3 || question.length > 1000) return c.json({ message: 'Please type a question.' }, 400)

    if (requestKey) {
      const existing = jobs.findByRequestKey(db, userId, requestKey)
      if (existing) return c.json({ job: jobs.toView(existing, notion.exportedInfo(existing.id)), repeated: true })
    }
    const same = jobs.findActiveSameQuestion(db, userId, question)
    if (same) return c.json({ job: jobs.toView(same, null), repeated: true })
    if (jobs.countActive(db, userId) >= deps.maxActivePerUser) return c.json({ message: MESSAGES.tooMany }, 429)
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    if (jobs.countSince(db, userId, hourAgo) >= deps.researchPerHour) return c.json({ message: MESSAGES.busy }, 429)

    const useNotion = body.useNotion === true && notion.view(userId).readPage !== null
    const row = jobs.createJob(db, userId, question, useNotion, requestKey)
    record(db, userId, 'research_created')
    void engine.start(row.id)
    return c.json({ job: jobs.toView(jobs.getJobRow(db, row.id)!, null) }, 201)
  })

  app.get('/api/research', c => {
    const rows = jobs.listJobs(db, c.get('userId'))
    return c.json({ jobs: rows.map(r => jobs.toView(r, notion.exportedInfo(r.id))) })
  })

  app.get('/api/research/latest', c => {
    const row = jobs.listJobs(db, c.get('userId'), 1)[0]
    return c.json({ job: row ? jobs.toView(row, notion.exportedInfo(row.id)) : null })
  })

  app.get('/api/research/:id', c => {
    const row = jobs.getOwnedJob(db, c.get('userId'), c.req.param('id'))
    if (!row) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ job: jobs.toView(row, notion.exportedInfo(row.id)) })
  })

  app.get('/api/research/:id/report', c => {
    const row = jobs.getOwnedJob(db, c.get('userId'), c.req.param('id'))
    const report = row ? jobs.getReport(row) : null
    if (!row || !report) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ job: jobs.toView(row, notion.exportedInfo(row.id)), report })
  })

  app.get('/api/research/:id/sources', c => {
    const row = jobs.getOwnedJob(db, c.get('userId'), c.req.param('id'))
    const report = row ? jobs.getReport(row) : null
    if (!report) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ sources: report.sources })
  })

  app.post('/api/research/:id/clarify', async c => {
    const userId = c.get('userId')
    const row = jobs.getOwnedJob(db, userId, c.req.param('id'))
    if (!row) return c.json({ message: MESSAGES.notFound }, 404)
    if (row.status !== 'NEEDS_CLARIFICATION') return c.json({ message: 'This research is already under way.' }, 409)
    const body = await readJson(c)
    if (body.skip === true) {
      void engine.start(row.id, { skipClarification: true })
    } else {
      const text = typeof body.clarification === 'string' ? body.clarification.replace(/\s+/g, ' ').trim() : ''
      if (text.length < 1 || text.length > 500) return c.json({ message: 'Please type your answer.' }, 400)
      jobs.saveClarification(db, row.id, text)
      void engine.start(row.id)
    }
    return c.json({ job: jobs.toView(jobs.getJobRow(db, row.id)!, null) })
  })

  app.post('/api/research/:id/cancel', c => {
    const userId = c.get('userId')
    const row = jobs.getOwnedJob(db, userId, c.req.param('id'))
    if (!row) return c.json({ message: MESSAGES.notFound }, 404)
    if (![...ACTIVE_STATUSES, 'NEEDS_CLARIFICATION'].includes(row.status)) {
      return c.json({ job: jobs.toView(row, notion.exportedInfo(row.id)) })
    }
    jobs.setStatus(db, row.id, 'CANCELLED', { message: 'You stopped this research.' })
    engine.cancel(row.id)
    record(db, userId, 'research_cancelled')
    return c.json({ job: jobs.toView(jobs.getJobRow(db, row.id)!, null) })
  })

  // ---- Integrations --------------------------------------------------
  app.get('/api/integrations', c => c.json({ integrations: [notion.view(c.get('userId'))], notionAvailable: notion.configured }))

  app.post('/api/integrations/notion/connect', async c => c.json({ notion: await notion.connect(c.get('userId')) }))

  app.get('/api/integrations/notion/pages', async c => c.json({ pages: await notion.pages(c.get('userId')) }))

  app.put('/api/integrations/notion/pages', async c => {
    const body = await readJson(c)
    const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-fA-F-]{32,36}$/.test(v) ? v : null)
    if ((body.readPageId && !id(body.readPageId)) || (body.destinationId && !id(body.destinationId))) {
      return c.json({ message: MESSAGES.checkInput }, 400)
    }
    return c.json({ notion: await notion.choosePages(c.get('userId'), id(body.readPageId), id(body.destinationId)) })
  })

  app.delete('/api/integrations/notion', c => {
    notion.disconnect(c.get('userId'))
    return c.json({ notion: notion.view(c.get('userId')) })
  })

  // ---- Report exports ------------------------------------------------
  const ownedReport = (c: Context<Env>): { id: string; report: Report } | null => {
    const row = jobs.getOwnedJob(db, c.get('userId'), c.req.param('id') ?? '')
    const report = row ? jobs.getReport(row) : null
    return row && report ? { id: row.id, report } : null
  }

  app.post('/api/reports/:id/export-preview', c => {
    const found = ownedReport(c)
    if (!found) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ preview: notion.preview(c.get('userId'), found.id, found.report) })
  })

  app.post('/api/reports/:id/approve-export', async c => {
    const found = ownedReport(c)
    if (!found) return c.json({ message: MESSAGES.notFound }, 404)
    const body = await readJson(c)
    if (body.approved !== true || typeof body.previewId !== 'string' || typeof body.contentHash !== 'string') {
      return c.json({ message: 'Please confirm that you want to save this report.' }, 400)
    }
    const result = await notion.approve(c.get('userId'), found.id, body.previewId, body.contentHash, found.report)
    return c.json(result)
  })

  app.post('/api/reports/:id/reject-export', async c => {
    const found = ownedReport(c)
    if (!found) return c.json({ message: MESSAGES.notFound }, 404)
    const body = await readJson(c)
    if (typeof body.previewId !== 'string') return c.json({ message: MESSAGES.checkInput }, 400)
    notion.reject(c.get('userId'), found.id, body.previewId)
    return c.json({ ok: true })
  })

  app.all('/api/*', c => c.json({ message: MESSAGES.notFound }, 404))

  return app
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json()
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function getSettings(db: Db, userId: string): Settings {
  const row = db.prepare('SELECT country, currency FROM users WHERE id = ?').get(userId) as
    | { country: string | null; currency: string | null }
    | undefined
  return { country: row?.country ?? null, currency: row?.currency ?? null }
}
