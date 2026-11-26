// Checks the glasses in the official simulator for the harder moments:
// a follow-up question, stopping research, losing the connection, and the
// app being closed while research continues. Saves a screenshot of each.
//
// Needs: the AskWise service started by restartService(), the simulator on
// automation port 9898 and X display $DISPLAY, xdotool and Playwright.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [, , outDir, phoneToken, measureToken, simCommand] = process.argv
const SIM = 'http://127.0.0.1:9898'
const APP = 'http://localhost:8787'
const WEBVIEW = { x: 204, y: 50, w: 600, h: 800 }
fs.mkdirSync(outDir, { recursive: true })
const results = []

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const xdo = (...args) => execFileSync('xdotool', args.map(String))

async function shot(name) {
  for (const [kind, file] of [['glasses', `glasses-${name}.png`], ['webview', `phone-${name}.png`]]) {
    try {
      const res = await fetch(`${SIM}/api/screenshot/${kind}`)
      fs.writeFileSync(path.join(outDir, file), Buffer.from(await res.arrayBuffer()))
    } catch {
      /* the simulator may be closed on purpose */
    }
  }
}
async function api(method, pathname, body) {
  const res = await fetch(`${APP}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${phoneToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}
const latest = async () => (await api('GET', '/api/research/latest')).job

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: WEBVIEW.w, height: WEBVIEW.h }, deviceScaleFactor: 1 })
await ctx.addInitScript(t => localStorage.setItem('askwise.session', t), measureToken)
const page = await ctx.newPage()
async function where(hash, selector) {
  await page.goto('about:blank')
  await page.goto(`${APP}/${hash}`)
  await page.waitForSelector(selector, { timeout: 20000 })
  const box = await page.locator(selector).first().boundingBox()
  return { x: Math.round(WEBVIEW.x + box.x + box.width / 2), y: Math.round(WEBVIEW.y + box.y + box.height / 2) }
}
async function click(pos) {
  xdo('mousemove', pos.x, pos.y)
  await sleep(250)
  xdo('click', 1)
}
async function ask(question) {
  await click(await where('#/', '#q'))
  xdo('type', '--delay', 20, question)
  await sleep(300)
  await click(await where('#/', '#ask button[type=submit]'))
}
async function waitFor(fn, ms = 300_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const job = await latest()
    if (job && fn(job)) return job
    await sleep(1500)
  }
  throw new Error('timed out')
}
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  log(ok ? 'PASS' : 'FAIL', name, detail)
}

// 1. A follow-up question when a key detail is missing.
log('1. vague question')
await ask('Which laptop should I buy?')
let job = await waitFor(j => !['CREATED', 'QUEUED', 'RUNNING', 'VERIFYING'].includes(j.status))
await sleep(2500)
await shot('1-clarify')
check('Follow-up question shows on the glasses', job.status === 'NEEDS_CLARIFICATION', job.clarifyingQuestion ?? job.status)
if (job.status === 'NEEDS_CLARIFICATION') {
  // 2. Stop research part-way.
  await click(await where('#/', '#clar'))
  xdo('type', '--delay', 20, 'Programming and school, budget 900 USD, United States')
  await sleep(300)
  await click(await where('#/', '#clarify button[type=submit]'))
  await waitFor(j => j.stage === 'searching')
  await sleep(1500)
  await shot('2-researching')
  log('2. stopping research')
  await click(await where('#/', '#cancel'))
  job = await waitFor(j => j.status === 'CANCELLED', 30_000)
  await sleep(2500)
  await shot('2-stopped')
  check('Stopping research shows a calm stopped screen', job.status === 'CANCELLED')
}

// 3. App closed while research continues; reopening shows the result.
log('3. closing the app mid-research')
await ask('Explain the current state of passkeys for everyday users.')
await waitFor(j => j.stage === 'searching')
await shot('3-before-close')
execFileSync('bash', ['-c', 'pkill -f "[s]im-linux-x64/bin" || true'])
log('simulator closed; research keeps running on the service')
job = await waitFor(j => j.hasReport || j.status === 'FAILED')
const sim = spawn('bash', ['-c', simCommand], { detached: true, stdio: 'ignore' })
sim.unref()
for (let i = 0; i < 30; i++) {
  await sleep(1000)
  try {
    if ((await fetch(`${SIM}/api/ping`)).ok) break
  } catch {
    /* starting */
  }
}
await sleep(6000)
await shot('3-reopened')
check('Research finished while the app was closed', job.hasReport, job.status)

// 4. Lost connection and recovery.
log('4. dropping the connection')
execFileSync('bash', ['-c', 'pkill -f "[t]sx server/index.ts" || true'])
await sleep(9000)
await shot('4-offline')
spawn('bash', ['-c', 'cd /home/user/askwise && exec npx tsx server/index.ts >> /tmp/claude-0/server.log 2>&1'], { detached: true, stdio: 'ignore' }).unref()
for (let i = 0; i < 30; i++) {
  await sleep(1000)
  try {
    if ((await fetch(`${APP}/api/research/latest`, { headers: { authorization: `Bearer ${phoneToken}` } })).ok) break
  } catch {
    /* restarting */
  }
}
await sleep(20000)
await shot('4-recovered')
check('Connection comes back on its own', (await latest())?.hasReport === true)

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
await browser.close()
