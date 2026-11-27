// Builds the AskWise service from settings. Used by the standalone server and by the Vercel function.
import path from 'node:path'
import type { Config } from './config.ts'
import { openDb, openPostgres } from './db.ts'
import type { Db } from './db.ts'
import { removeExpired } from './auth.ts'
import { createApp, getSettings } from './app.ts'
import { log } from './activity.ts'
import { MESSAGES } from '../shared/labels.ts'
import { ResearchEngine } from './research/engine.ts'
import { markInterrupted } from './research/jobs.ts'
import { OpenAIResearchProvider } from './research/openai.ts'
import { NotionService } from './notion/service.ts'
import { loadSecret, SecretBox } from './secret-box.ts'
import { OpenAITranscriber } from './voice/transcribe.ts'

export async function buildService(config: Config, opts: { background?: (work: Promise<unknown>) => void; sweepEveryMs?: number } = {}) {
  const db: Db = config.databaseUrl ? await openPostgres(config.databaseUrl) : openDb(path.join(config.dataDir, 'askwise.db'))

  await removeExpired(db)
  // Research that has been quiet for longer than the time limit can no longer finish (for example
  // the service restarted while it ran). It is marked so the person sees a clear message instead of
  // waiting forever. Checked at start and then every minute.
  const sweep = async () => {
    const quietSince = new Date(Date.now() - config.researchTimeLimitMs - 60_000).toISOString()
    const interrupted = await markInterrupted(db, MESSAGES.interrupted, quietSince)
    if (interrupted) log(`${interrupted} research request(s) were interrupted`)
  }
  await sweep()
  if (opts.sweepEveryMs !== 0) setInterval(() => void sweep().catch(() => undefined), opts.sweepEveryMs ?? 60_000).unref()

  const provider = config.openaiApiKey
    ? new OpenAIResearchProvider({ apiKey: config.openaiApiKey, researchModel: config.researchModel, plannerModel: config.plannerModel })
    : null
  const notion = new NotionService(db, {
    serviceToken: config.notionToken,
    shared: config.notionSharedPageId ? { pageId: config.notionSharedPageId, url: config.notionSharedPageUrl } : null,
    oauth: config.notionOAuth,
    box: new SecretBox(config.secret ?? loadSecret(null, config.dataDir)),
  })
  const engine = new ResearchEngine(db, provider, notion, {
    timeLimitMs: config.researchTimeLimitMs,
    getSettings: userId => getSettings(db, userId),
  })
  const app = createApp({
    db,
    engine,
    notion,
    sessionDays: config.sessionDays,
    researchPerHour: config.researchPerHour,
    researchPerDay: config.researchPerDay,
    maxActivePerUser: config.maxActivePerUser,
    transcriber: config.openaiApiKey ? new OpenAITranscriber(config.openaiApiKey, config.transcribeModel) : null,
    background: opts.background,
  })
  if (!provider) log('OPENAI_API_KEY is missing: research requests will be refused')
  if (!config.notionToken) log('NOTION_TOKEN is missing: Notion saving will be refused')
  return { app, db, engine }
}
