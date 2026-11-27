// Runs the full AskWise flow in the official Even Realities simulator:
// types a question on the phone page, follows the research on the glasses,
// taps through the answer and saves the approved report to Notion.
// Saves a screenshot of every screen. Real research and real Notion calls.
//
// Needs: the AskWise service on :8787, the simulator started with
// --automation-port 9898 on X display $DISPLAY, xdotool, and Playwright.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [, , outDir, phoneToken, measureToken, question] = process.argv
const SIM = 'http://127.0.0.1:9898'
const APP = 'http://localhost:8787'
const WEBVIEW = { x: 204, y: 50, w: 600, h: 800 }
fs.mkdirSync(outDir, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const xdo = (...args) => execFileSync('xdotool', args.map(String))
const timeline = []
const mark = name => timeline.push({ name, at: Date.now() })

async function glasses(name) {
  const res = await fetch(`${SIM}/api/screenshot/glasses`)
  fs.writeFileSync(path.join(outDir, `glasses-${name}.png`), Buffer.from(await res.arrayBuffer()))
}
async function phone(name) {
  const res = await fetch(`${SIM}/api/screenshot/webview`)
  fs.writeFileSync(path.join(outDir, `phone-${name}.png`), Buffer.from(await res.arrayBuffer()))
}
async function tap(action = 'click') {
  await fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
}
async function api(pathname) {
  const res = await fetch(`${APP}${pathname}`, { headers: { authorization: `Bearer ${phoneToken}` } })
  return res.json()
}

// Measures element positions in a browser with the same size as the simulator's phone view.
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: WEBVIEW.w, height: WEBVIEW.h }, deviceScaleFactor: 1 })
await ctx.addInitScript(t => localStorage.setItem('askwise.session', t), measureToken)
const page = await ctx.newPage()
async function where(hash, selector, { scroll = 0 } = {}) {
  await page.goto('about:blank')
  await page.goto(`${APP}/${hash}`)
  await page.waitForSelector(selector, { timeout: 15000 })
  if (scroll) {
    await page.mouse.move(300, 400)
    await page.mouse.wheel(0, scroll)
    await sleep(600)
  }
  const box = await page.locator(selector).first().boundingBox()
  return { x: Math.round(WEBVIEW.x + box.x + box.width / 2), y: Math.round(WEBVIEW.y + box.y + box.height / 2) }
}
async function click(pos) {
  xdo('mousemove', pos.x, pos.y)
  await sleep(250)
  xdo('click', 1)
}
async function scrollPhone(clicks) {
  xdo('mousemove', WEBVIEW.x + 300, WEBVIEW.y + 400)
  for (let i = 0; i < clicks; i++) {
    xdo('click', 5)
    await sleep(60)
  }
}

mark('start')
log('home screens')
await sleep(1500)
await glasses('01-home')
await phone('01-ask')

log('typing the question on the phone page')
await click(await where('#/', '#q'))
xdo('type', '--delay', 28, question)
await sleep(500)
const useNotion = await where('#/', '#useNotion').catch(() => null)
if (useNotion) await click(useNotion)
await sleep(400)
await phone('02-question-typed')
await click(await where('#/', '#ask button[type=submit]'))
mark('asked')

log('following the research')
const seen = new Set()
let job
for (let i = 0; i < 400; i++) {
  job = (await api('/api/research/latest')).job
  const key = `${job.status}-${job.stage ?? ''}`
  if (!seen.has(key)) {
    seen.add(key)
    log('state', key)
    await sleep(700)
    await glasses(`02-progress-${seen.size}-${key.toLowerCase()}`)
    if (seen.size === 2) await phone('03-progress')
  }
  if (!['CREATED', 'QUEUED', 'RUNNING', 'VERIFYING'].includes(job.status)) break
  await sleep(1500)
}
mark('answered')
log('finished with', job.status)
if (!job.hasReport) {
  await glasses('99-stopped')
  await phone('99-stopped')
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ timeline, job }, null, 2))
  await browser.close()
  process.exit(2)
}

log('tapping through the answer on the glasses')
await sleep(2500)
for (let i = 1; i <= 8; i++) {
  await glasses(`03-result-${i}`)
  const before = (await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer()).byteLength
  await tap('click')
  await sleep(2600)
  const after = (await (await fetch(`${SIM}/api/screenshot/glasses`)).arrayBuffer()).byteLength
  if (i > 1 && before === after) break
}
await glasses('04-back-home')
await tap('up')
await sleep(1500)
mark('glasses-done')

log('opening the full report on the phone')
await click(await where('#/', `a[href="#/report/${job.id}"]`))
await sleep(2500)
await phone('04-report')
await scrollPhone(4)
await sleep(1200)
await phone('05-report-answer')
await scrollPhone(6)
await sleep(800)
for (const tab of ['compare', 'checks', 'sources']) {
  const pos = await where(`#/report/${job.id}`, `[data-tab=${tab}]`, { scroll: 2000 })
  await click(pos)
  await sleep(1800)
  await phone(`06-${tab}`)
  await scrollPhone(5)
  await sleep(1500)
  await phone(`06-${tab}-more`)
  await scrollPhone(6)
  await sleep(600)
}
mark('report-done')

log('saving to Notion with approval')
await click(await where(`#/report/${job.id}`, '.savebar a.button'))
await sleep(3500)
await phone('07-save-preview')
xdo('mousemove', WEBVIEW.x + 300, WEBVIEW.y + 600)
for (let i = 0; i < 6; i++) { xdo('click', 5); await sleep(120) }
await sleep(1000)
await phone('08-save-before-approval')
await click(await where(`#/save/${job.id}`, '#confirm'))
await sleep(800)
await phone('08b-approval-ticked')
await click(await where(`#/save/${job.id}`, '#approve'))
for (let i = 0; i < 30; i++) {
  await sleep(1000)
  if ((await api(`/api/research/${job.id}`)).job.exported) break
}
await sleep(1500)
await phone('09-saved')
mark('saved')
const exported = (await api(`/api/research/${job.id}`)).job.exported

log('history')
await click(await where('#/', 'nav.nav a[href="#/history"]'))
await sleep(2000)
await phone('10-history')
await tap('click')
await sleep(2000)
await glasses('05-saved-answer')
mark('end')

fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ timeline, jobId: job.id, exported }, null, 2))
await browser.close()
log('done', exported?.url)
