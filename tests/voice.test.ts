import { describe, expect, it } from 'vitest'
import { measureTextWrap } from '@evenrealities/pretext'
import { createApp } from '../server/app.ts'
import { openDb } from '../server/db.ts'
import { ResearchEngine } from '../server/research/engine.ts'
import { NotionService } from '../server/notion/service.ts'
import { SecretBox } from '../server/secret-box.ts'
import { isShortWav, OpenAITranscriber } from '../server/voice/transcribe.ts'
import type { Transcriber } from '../server/voice/transcribe.ts'
import { pcmToWav, VoiceCapture, MAX_SECONDS, SAMPLE_RATE } from '../web/src/glasses/voice.ts'
import { draftScreen, gettingReadyScreen, listeningScreen, voiceProblemScreen, writingScreen } from '../web/src/glasses/screens.ts'
import { BODY_INNER, BODY_MAX_LINES } from '../web/src/glasses/display.ts'

// TEST FIXTURE: one second of silence as 16-bit PCM.
const silence = (seconds: number) => new Uint8Array(Math.round(seconds * SAMPLE_RATE * 2))

function appWith(transcriber: Transcriber | null) {
  const db = openDb(':memory:')
  const notion = new NotionService(db, { serviceToken: null, shared: null, oauth: null, box: new SecretBox('t') })
  const engine = new ResearchEngine(db, null, null, { timeLimitMs: 1000, getSettings: () => ({ country: null, currency: null }) })
  return createApp({ db, engine, notion, sessionDays: 1, researchPerHour: 10, researchPerDay: 10, maxActivePerUser: 1, transcriber })
}

async function guest(app: ReturnType<typeof appWith>) {
  return ((await (await app.request('/api/session/guest', { method: 'POST' })).json()) as { token: string }).token
}

const send = (app: ReturnType<typeof appWith>, token: string, body: Uint8Array) =>
  app.request('/api/voice', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' }, body: new Uint8Array(body) })

describe('voice capture on the glasses', () => {
  it('packs microphone audio as a valid WAV file', () => {
    const wav = pcmToWav([silence(1)])
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(wav.length).toBe(44 + SAMPLE_RATE * 2)
    expect(isShortWav(wav)).toBe(true)
  })

  it(`stops recording at ${MAX_SECONDS} seconds`, () => {
    const c = new VoiceCapture()
    for (let i = 0; i < 30; i++) c.push(silence(1))
    expect(c.seconds).toBe(MAX_SECONDS)
  })

  it('rejects files that are not short WAV audio', () => {
    expect(isShortWav(new TextEncoder().encode('not audio at all, just some text here to fill bytes'))).toBe(false)
    expect(isShortWav(pcmToWav([silence(25)]))).toBe(false)
  })

  it('voice screens fit the display and use plain words', () => {
    for (const s of [gettingReadyScreen(), listeningScreen(), writingScreen(), draftScreen('Compare two phones for battery life'), voiceProblemScreen("I didn't catch that. Hold and try again.")]) {
      expect(measureTextWrap(s.body, BODY_INNER.width).lineCount).toBeLessThanOrEqual(BODY_MAX_LINES)
      expect(measureTextWrap(s.footer, BODY_INNER.width).lineCount).toBe(1)
    }
    expect(draftScreen('x').footer).toMatch(/Tap: ask/)
    expect(draftScreen('x').footer).toMatch(/Double-tap: discard/)
  })
})

describe('turning speech into a question', () => {
  it('returns the words as a draft and starts no research', async () => {
    const app = appWith({ transcribe: async () => '  Compare two   phones  ' })
    const t = await guest(app)
    const res = await send(app, t, pcmToWav([silence(2)]))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Compare two phones' })
    const list = (await (await app.request('/api/research', { headers: { Authorization: `Bearer ${t}` } })).json()) as { jobs: unknown[] }
    expect(list.jobs).toHaveLength(0)
  })

  it('says kindly when nothing was heard', async () => {
    const app = appWith({ transcribe: async () => '' })
    const res = await send(app, await guest(app), pcmToWav([silence(1)]))
    expect(res.status).toBe(422)
    expect(((await res.json()) as { message: string }).message).toBe("I didn't catch that. Hold and try again.")
  })

  it('refuses audio that is not a short recording, and refuses without a session', async () => {
    const app = appWith({ transcribe: async () => 'x' })
    expect((await send(app, await guest(app), new Uint8Array(100))).status).toBe(400)
    expect((await app.request('/api/voice', { method: 'POST', body: new Uint8Array(pcmToWav([silence(1)])) })).status).toBe(401)
  })

  it('hides technical details when the speech service has a problem', async () => {
    const app = appWith({ transcribe: async () => { throw new Error('openai status 500') } })
    const res = await send(app, await guest(app), pcmToWav([silence(1)]))
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toMatch(/openai|500/)
  })

  it('sends the audio to OpenAI with the chosen model', async () => {
    let seen: { url: string; model: unknown; file: unknown } | null = null
    const f = (async (url: string, init: RequestInit) => {
      const form = init.body as FormData
      seen = { url, model: form.get('model'), file: form.get('file') }
      return new Response(JSON.stringify({ text: 'hello there' }), { status: 200 })
    }) as unknown as typeof fetch
    const text = await new OpenAITranscriber('test-key', 'gpt-4o-mini-transcribe', f).transcribe(pcmToWav([silence(1)]), new AbortController().signal)
    expect(text).toBe('hello there')
    expect(seen!.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(seen!.model).toBe('gpt-4o-mini-transcribe')
    expect(seen!.file).toBeInstanceOf(Blob)
  })
})
