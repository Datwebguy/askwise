import path from 'node:path'
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
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

const config = loadConfig()
const db = openDb(path.join(config.dataDir, 'askwise.db'))

removeExpired(db)
const interrupted = markInterrupted(db, MESSAGES.interrupted)
if (interrupted) log(`${interrupted} research request(s) were interrupted by a restart`)

const provider = config.openaiApiKey
  ? new OpenAIResearchProvider({
      apiKey: config.openaiApiKey,
      researchModel: config.researchModel,
      plannerModel: config.plannerModel,
    })
  : null
const notion = new NotionService(db, {
  serviceToken: config.notionToken,
  shared: config.notionSharedPageId ? { pageId: config.notionSharedPageId, url: config.notionSharedPageUrl } : null,
  oauth: config.notionOAuth,
  box: new SecretBox(loadSecret(config.secret, config.dataDir)),
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
  transcriber: config.openaiApiKey ? new OpenAITranscriber(config.openaiApiKey, config.transcribeModel) : null,
  maxActivePerUser: config.maxActivePerUser,
})

if (config.publicDir && fs.existsSync(config.publicDir)) {
  const root = path.relative(process.cwd(), config.publicDir) || '.'
  app.use('/*', serveStatic({ root }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
}

if (!provider) log('OPENAI_API_KEY is missing: research requests will be refused')
if (!config.notionToken) log('NOTION_TOKEN is missing: Notion features will be refused')

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, info => {
  log(`listening on http://localhost:${info.port}`)
})
