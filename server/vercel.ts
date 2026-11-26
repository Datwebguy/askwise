// Vercel function: the AskWise service behind /api. Research keeps running
// after the reply with waitUntil, within the function's time allowance.
import { getRequestListener } from '@hono/node-server'
import { waitUntil } from '@vercel/functions'
import { loadConfig } from './config.ts'
import { buildService } from './build.ts'

const ready = buildService(loadConfig(), { background: work => waitUntil(work) })

export default getRequestListener(async request => {
  const { app } = await ready
  return app.fetch(request)
})
