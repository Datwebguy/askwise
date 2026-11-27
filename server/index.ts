// Standalone AskWise server: the app and the service on one port.
import path from 'node:path'
import fs from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { loadConfig } from './config.ts'
import { buildService } from './build.ts'
import { log } from './activity.ts'

const config = loadConfig()
const { app } = await buildService(config)

if (config.publicDir && fs.existsSync(config.publicDir)) {
  const root = path.relative(process.cwd(), config.publicDir) || '.'
  app.use('/*', serveStatic({ root }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, info => {
  log(`listening on http://localhost:${info.port}`)
})
