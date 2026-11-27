// Proves voice questions in the official simulator: holds the touchpad,
// plays a real spoken question into the simulator's microphone, lets go,
// checks the draft, taps to ask and follows the research to the answer.
//
// Needs: the simulator on automation port 9898 using a microphone that
// hears the PulseAudio sink named by --sink, and paplay.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [, , outDir, phoneToken, audioFile, sink = 'askwise_voice'] = process.argv
const SIM = 'http://127.0.0.1:9898'
const APP = process.env.ASKWISE_URL ?? 'http://localhost:8787'
fs.mkdirSync(outDir, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const input = action =>
  fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
async function shot(name) {
  const res = await fetch(`${SIM}/api/screenshot/glasses`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(path.join(outDir, `glasses-${name}.png`), buf)
  return buf
}
const latest = async () =>
  (await (await fetch(`${APP}/api/research/latest`, { headers: { authorization: `Bearer ${phoneToken}` } })).json()).job

const before = await latest()
await shot('0-before')

log('holding the touchpad')
await input('long_press')
await sleep(300)
// Like a person: wait until the glasses say "Listening", then speak.
const ready = await shot('1-getting-ready')
for (let i = 0; i < 40; i++) {
  await sleep(150)
  if (!(await shot('1-listening')).equals(ready)) break
}
log('speaking into the microphone')
execFileSync('paplay', ['-d', sink, audioFile])
await sleep(700)
log('letting go')
await input('long_press_release')

// Wait until the "writing it down" screen is replaced by the draft (or a problem message).
await sleep(600)
const writing = await shot('2-writing')
for (let i = 0; i < 60; i++) {
  await sleep(500)
  const buf = await shot('3-draft')
  if (!buf.equals(writing)) break
}
await sleep(400)
await shot('3-draft')
const consoleOut = await (await fetch(`${SIM}/api/console`)).json()
const voiceCalls = consoleOut.entries.filter(e => e.message.includes('/api/voice'))
log('voice requests with problems:', voiceCalls.length)

if (process.env.DISCARD) {
  log('double-tapping to discard the draft')
  await input('double_click')
  await sleep(2500)
  await shot('6-discarded')
  const after = await latest()
  const ok = (after?.id ?? null) === (before?.id ?? null)
  log(ok ? 'PASS discarded draft started no research' : 'FAIL a discarded draft started research')
  process.exit(ok ? 0 : 2)
}

log('tapping to ask')
await input('click')
let job = null
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  job = await latest()
  if (job && job.id !== before?.id) break
}
if (!job || job.id === before?.id) {
  log('FAIL no research started')
  process.exit(2)
}
log('research started for:', job.question)
await sleep(1500)
await shot('4-researching')
for (let i = 0; i < 200; i++) {
  job = await latest()
  if (!['CREATED', 'QUEUED', 'RUNNING', 'VERIFYING'].includes(job.status)) break
  await sleep(2000)
}
await sleep(2500)
await shot('5-answer')
log('finished:', job.status)
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ question: job.question, status: job.status, hasReport: job.hasReport }, null, 2))
