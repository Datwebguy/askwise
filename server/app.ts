import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import type { Db } from './db.ts'
import { createGuest, createInvite, endSession, isOwner, redeemInvite, userForToken } from './auth.ts'
import { log, record } from './activity.ts'
import { MESSAGES } from '../shared/labels.ts'
import { ACTIVE_STATUSES } from '../shared/types.ts'
import type { Relation, Report, Settings } from '../shared/types.ts'
import type { ResearchEngine } from './research/engine.ts'
import * as jobs from './research/jobs.ts'
import { NotionRefused } from './notion/service.ts'
import type { NotionRefusal, NotionService } from './notion/service.ts'
import { NotionError } from './notion/client.ts'
import { AttemptLimiter } from './limits.ts'
import { isShortWav, TranscribeError } from './voice/transcribe.ts'
import type { Transcriber } from './voice/transcribe.ts'

export interface AppDeps {
  db: Db
  engine: ResearchEngine
  notion: NotionService
  sessionDays: number
  researchPerHour: number
  researchPerDay: number
  maxActivePerUser: number
  transcriber?: Transcriber | null
  /** Keeps background work alive after the reply is sent (needed on serverless hosts). */
  background?: (work: Promise<unknown>) => void
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
  owner_only: { status: 409, message: 'Use "Connect Notion" to link your own workspace.' },
  sign_in_failed: { status: 400, message: "Notion didn't finish connecting. Please try again." },
}

const COUNTRY_RE = /^[\p{L} .'-]{2,56}$/u
const CURRENCY_RE = /^[A-Z]{3}$/

export function createApp(deps: AppDeps): Hono<Env> {
  const { db, engine, notion } = deps
  const background = deps.background ?? ((work: Promise<unknown>) => void work.catch(() => undefined))
  const app = new Hono<Env>()
  const signInLimiter = new AttemptLimiter(10, 15 * 60_000)
  const guestLimiter = new AttemptLimiter(30, 60 * 60_000)
  const clientKey = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'

  app.use('*', secureHeaders({ crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: 'cross-origin', contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'self'"],
  } }))
  // The packaged glasses app runs from its own origin. Sign-in uses a bearer token, never cookies.
  app.use('/api/*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], maxAge: 86400 }))
  const smallBodies = bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ message: MESSAGES.checkInput }, 413) })
  const voiceBodies = bodyLimit({ maxSize: 1024 * 1024, onError: c => c.json({ message: 'That was a bit long. Please keep it under 15 seconds.' }, 413) })
  app.use('/api/*', (c, next) => (c.req.path === '/api/voice' ? voiceBodies(c, next) : smallBodies(c, next)))
  const voiceLimiter = new AttemptLimiter(40, 60 * 60_000)

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
  /** Opens AskWise instantly: a new private space for this device, with no code or details to enter. */
  app.post('/api/session/guest', async c => {
    if (!guestLimiter.allow(clientKey(c))) return c.json({ message: 'Too many new visits from here. Please wait a little.' }, 429)
    const session = await createGuest(db, deps.sessionDays)
    record(db, session.userId, 'sign_in', 'instant')
    return c.json({ token: session.token, expiresAt: session.expiresAt })
  })

  /** Notion sends people back here after they approve the connection. */
  app.get('/api/integrations/notion/callback', async c => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    if (!code || !state) return c.redirect('/#/settings/notion-declined')
    try {
      await notion.finishSignIn(state, code)
      return c.redirect('/#/settings/notion-connected')
    } catch (e) {
      log(`notion sign-in: ${(e as Error).message}`)
      return c.redirect('/#/settings/notion-declined')
    }
  })

  app.post('/api/session', async c => {
    const ip = clientKey(c)
    if (!signInLimiter.allow(ip)) return c.json({ message: 'Too many tries. Please wait a few minutes.' }, 429)
    const body = await readJson(c)
    const code = typeof body.code === 'string' ? body.code : ''
    if (code.length < 6 || code.length > 40) return c.json({ message: 'Please enter your sign-in code.' }, 400)
    const session = await redeemInvite(db, code, deps.sessionDays)
    if (!session) {
      record(db, null, 'sign_in_refused')
      return c.json({ message: "That code didn't work. Please check it and try again." }, 401)
    }
    record(db, session.userId, 'sign_in')
    return c.json({ token: session.token, expiresAt: session.expiresAt })
  })

  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'POST' && (c.req.path === '/api/session' || c.req.path === '/api/session/guest')) return next()
    if (c.req.method === 'GET' && c.req.path === '/api/integrations/notion/callback') return next()
    const auth = c.req.header('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    const userId = await userForToken(db, token)
    if (!userId) {
      record(db, null, 'access_refused', c.req.path.split('/').slice(0, 3).join('/'))
      return c.json({ message: MESSAGES.signInAgain }, 401)
    }
    c.set('userId', userId)
    c.set('token', token)
    return next()
  })

  app.delete('/api/session', async c => {
    await endSession(db, c.get('token'))
    return c.json({ ok: true })
  })

  /** A short-lived, one-time code that signs the same person in on another device. */
  app.post('/api/session/device-code', async c => {
    const code = await createInvite(db, 0.25, c.get('userId'))
    return c.json({ code, minutes: 15 })
  })

  // ---- Account and settings ------------------------------------------
  app.get('/api/me', async c => {
    const userId = c.get('userId')
    return c.json({
      settings: await getSettings(db, userId),
      researchAvailable: engine.available,
      notionAvailable: notion.configured,
      notionSignIn: notion.oauthAvailable,
      voiceAvailable: !!deps.transcriber,
      notionShared: notion.sharedPage,
      isOwner: await isOwner(db, userId),
      notion: await notion.view(userId),
    })
  })

  app.put('/api/settings', async c => {
    const body = await readJson(c)
    const country = body.country === null || body.country === '' ? null : String(body.country ?? '').trim()
    const currency = body.currency === null || body.currency === '' ? null : String(body.currency ?? '').trim().toUpperCase()
    if ((country !== null && !COUNTRY_RE.test(country)) || (currency !== null && !CURRENCY_RE.test(currency))) {
      return c.json({ message: MESSAGES.checkInput }, 400)
    }
    await db.run('UPDATE users SET country = ?, currency = ? WHERE id = ?', country, currency, c.get('userId'))
    return c.json({ settings: await getSettings(db, c.get('userId')) })
  })

  /** Deletes the person's research, saved exports, connections and account. */
  app.delete('/api/me', async c => {
    const userId = c.get('userId')
    for (const row of await jobs.listJobs(db, userId, 1000)) engine.cancel(row.id)
    await db.run('DELETE FROM users WHERE id = ?', userId)
    await db.run('UPDATE activity SET user_id = NULL, detail = NULL WHERE user_id = ?', userId)
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
      const existing = await jobs.findByRequestKey(db, userId, requestKey)
      if (existing) return c.json({ job: jobs.toView(existing, await notion.exportedInfo(existing.id)), repeated: true })
    }
    const same = await jobs.findActiveSameQuestion(db, userId, question)
    if (same) return c.json({ job: jobs.toView(same, null), repeated: true })
    const limited = await overLimit(userId)
    if (limited) return c.json({ message: limited }, 429)

    const useNotion = body.useNotion === true && (await notion.view(userId)).readPage !== null
    const row = await jobs.createJob(db, userId, question, useNotion, requestKey)
    record(db, userId, 'research_created')
    background(engine.start(row.id))
    return c.json({ job: jobs.toView((await jobs.getJobRow(db, row.id))!, null) }, 201)
  })

  /** The fair-use limits every new research request goes through. Returns the message to show, or null. */
  async function overLimit(userId: string): Promise<string | null> {
    if (await jobs.countActive(db, userId) >= deps.maxActivePerUser) return MESSAGES.tooMany
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    if (await jobs.countSince(db, userId, hourAgo) >= deps.researchPerHour) return MESSAGES.busy
    const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()
    if (await jobs.countAllSince(db, dayStart) >= deps.researchPerDay) return MESSAGES.dailyLimit
    return null
  }

  /** Starts research linked to an earlier report: a fresh check of the same question, or a follow-up question. */
  async function startLinked(c: Context<Env>, relation: Relation) {
    const userId = c.get('userId')
    if (!engine.available) return c.json({ message: 'Research is not set up yet.' }, 503)
    const parent = await jobs.getOwnedJob(db, userId, c.req.param('id') ?? '')
    if (!parent || !jobs.getReport(parent)) return c.json({ message: MESSAGES.notFound }, 404)
    const body = await readJson(c)
    const requestKey = typeof body.requestKey === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(body.requestKey) ? body.requestKey : null
    if (requestKey) {
      const existing = await jobs.findByRequestKey(db, userId, requestKey)
      if (existing) return c.json({ job: jobs.toView(existing, await notion.exportedInfo(existing.id)), repeated: true })
    }
    const question = relation === 'recheck'
      ? parent.question
      : typeof body.question === 'string' ? body.question.replace(/\s+/g, ' ').trim() : ''
    if (question.length < 3 || question.length > 1000) return c.json({ message: 'Please type a question.' }, 400)
    const limited = await overLimit(userId)
    if (limited) return c.json({ message: limited }, 429)
    const readPage = (await notion.view(userId)).readPage !== null
    const useNotion = readPage && (relation === 'recheck' ? parent.use_notion === 1 : body.useNotion === true)
    const row = await jobs.createJob(db, userId, question, useNotion, requestKey, {
      id: parent.id,
      relation,
      clarification: relation === 'recheck' ? parent.clarification : null,
    })
    record(db, userId, relation === 'recheck' ? 'research_recheck' : 'research_follow_up')
    background(engine.start(row.id))
    return c.json({ job: jobs.toView((await jobs.getJobRow(db, row.id))!, null) }, 201)
  }

  app.post('/api/research/:id/recheck', c => startLinked(c, 'recheck'))
  app.post('/api/research/:id/follow-up', c => startLinked(c, 'follow_up'))

  /** Turns a short spoken question from the glasses into text. Nothing is researched until the person confirms it. */
  app.post('/api/voice', async c => {
    if (!deps.transcriber) return c.json({ message: 'Voice is being set up.' }, 503)
    if (!voiceLimiter.allow(c.get('userId'))) return c.json({ message: MESSAGES.busy }, 429)
    const audio = new Uint8Array(await c.req.arrayBuffer())
    if (!isShortWav(audio)) return c.json({ message: "I didn't catch that. Hold and try again." }, 400)
    try {
      const text = (await deps.transcriber.transcribe(audio, AbortSignal.timeout(30_000))).replace(/\s+/g, ' ').trim()
      if (text.length < 3) return c.json({ message: "I didn't catch that. Hold and try again." }, 422)
      return c.json({ text: text.slice(0, 1000) })
    } catch (e) {
      log(`voice: ${e instanceof TranscribeError ? e.message : (e as Error).message}`)
      return c.json({ message: MESSAGES.retry }, 502)
    }
  })

  app.get('/api/research', async c => {
    const rows = await jobs.listJobs(db, c.get('userId'))
    return c.json({ jobs: await Promise.all(rows.map(async r => jobs.toView(r, await notion.exportedInfo(r.id)))) })
  })

  app.get('/api/research/latest', async c => {
    const row = (await jobs.listJobs(db, c.get('userId'), 1))[0]
    return c.json({ job: row ? jobs.toView(row, await notion.exportedInfo(row.id)) : null })
  })

  app.get('/api/research/:id', async c => {
    const row = await jobs.getOwnedJob(db, c.get('userId'), c.req.param('id'))
    if (!row) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ job: jobs.toView(row, await notion.exportedInfo(row.id)) })
  })

  app.get('/api/research/:id/report', async c => {
    const row = await jobs.getOwnedJob(db, c.get('userId'), c.req.param('id'))
    const report = row ? jobs.getReport(row) : null
    if (!row || !report) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ job: jobs.toView(row, await notion.exportedInfo(row.id)), report })
  })

  app.get('/api/research/:id/sources', async c => {
    const row = await jobs.getOwnedJob(db, c.get('userId'), c.req.param('id'))
    const report = row ? jobs.getReport(row) : null
    if (!report) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ sources: report.sources })
  })

  app.post('/api/research/:id/clarify', async c => {
    const userId = c.get('userId')
    const row = await jobs.getOwnedJob(db, userId, c.req.param('id'))
    if (!row) return c.json({ message: MESSAGES.notFound }, 404)
    if (row.status !== 'NEEDS_CLARIFICATION') return c.json({ message: 'This research is already under way.' }, 409)
    const body = await readJson(c)
    if (body.skip === true) {
      background(engine.start(row.id, { skipClarification: true }))
    } else {
      const text = typeof body.clarification === 'string' ? body.clarification.replace(/\s+/g, ' ').trim() : ''
      if (text.length < 1 || text.length > 500) return c.json({ message: 'Please type your answer.' }, 400)
      await jobs.saveClarification(db, row.id, text)
      background(engine.start(row.id))
    }
    return c.json({ job: jobs.toView((await jobs.getJobRow(db, row.id))!, null) })
  })

  app.post('/api/research/:id/cancel', async c => {
    const userId = c.get('userId')
    const row = await jobs.getOwnedJob(db, userId, c.req.param('id'))
    if (!row) return c.json({ message: MESSAGES.notFound }, 404)
    if (![...ACTIVE_STATUSES, 'NEEDS_CLARIFICATION'].includes(row.status)) {
      return c.json({ job: jobs.toView(row, await notion.exportedInfo(row.id)) })
    }
    await jobs.setStatus(db, row.id, 'CANCELLED', { message: 'You stopped this research.' })
    engine.cancel(row.id)
    record(db, userId, 'research_cancelled')
    return c.json({ job: jobs.toView((await jobs.getJobRow(db, row.id))!, null) })
  })

  // ---- Integrations --------------------------------------------------
  app.get('/api/integrations', async c => c.json({ integrations: [await notion.view(c.get('userId'))], notionAvailable: notion.configured }))

  app.post('/api/integrations/notion/connect', async c => c.json({ notion: await notion.connect(c.get('userId')) }))

  /** Returns the Notion sign-in address for "Connect Notion". */
  app.post('/api/integrations/notion/sign-in', async c => c.json({ url: await notion.startSignIn(c.get('userId')) }))

  app.get('/api/integrations/notion/pages', async c => c.json({ pages: await notion.pages(c.get('userId')) }))

  app.put('/api/integrations/notion/pages', async c => {
    const body = await readJson(c)
    const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-fA-F-]{32,36}$/.test(v) ? v : null)
    if ((body.readPageId && !id(body.readPageId)) || (body.destinationId && !id(body.destinationId))) {
      return c.json({ message: MESSAGES.checkInput }, 400)
    }
    return c.json({ notion: await notion.choosePages(c.get('userId'), id(body.readPageId), id(body.destinationId)) })
  })

  app.delete('/api/integrations/notion', async c => {
    await notion.disconnect(c.get('userId'))
    return c.json({ notion: await notion.view(c.get('userId')) })
  })

  // ---- Report exports ------------------------------------------------
  const ownedReport = async (c: Context<Env>): Promise<{ id: string; report: Report } | null> => {
    const row = await jobs.getOwnedJob(db, c.get('userId'), c.req.param('id') ?? '')
    const report = row ? jobs.getReport(row) : null
    return row && report ? { id: row.id, report } : null
  }

  app.post('/api/reports/:id/export-preview', async c => {
    const found = await ownedReport(c)
    if (!found) return c.json({ message: MESSAGES.notFound }, 404)
    return c.json({ preview: await notion.preview(c.get('userId'), found.id, found.report) })
  })

  app.post('/api/reports/:id/approve-export', async c => {
    const found = await ownedReport(c)
    if (!found) return c.json({ message: MESSAGES.notFound }, 404)
    const body = await readJson(c)
    if (body.approved !== true || typeof body.previewId !== 'string' || typeof body.contentHash !== 'string') {
      return c.json({ message: 'Please confirm that you want to save this report.' }, 400)
    }
    const result = await notion.approve(c.get('userId'), found.id, body.previewId, body.contentHash, found.report)
    return c.json(result)
  })

  app.post('/api/reports/:id/reject-export', async c => {
    const found = await ownedReport(c)
    if (!found) return c.json({ message: MESSAGES.notFound }, 404)
    const body = await readJson(c)
    if (typeof body.previewId !== 'string') return c.json({ message: MESSAGES.checkInput }, 400)
    await notion.reject(c.get('userId'), found.id, body.previewId)
    return c.json({ ok: true })
  })

  app.all('/api/*', async c => c.json({ message: MESSAGES.notFound }, 404))

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

export async function getSettings(db: Db, userId: string): Promise<Settings> {
  const row = await db.get('SELECT country, currency FROM users WHERE id = ?', userId) as
    | { country: string | null; currency: string | null }
    | undefined
  return { country: row?.country ?? null, currency: row?.currency ?? null }
}
