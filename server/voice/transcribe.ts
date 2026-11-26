// Turns a short spoken question into text. OpenAI is the first provider;
// others can be added behind the same interface.
type FetchLike = typeof fetch

export interface Transcriber {
  transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string>
}

export class TranscribeError extends Error {}

export class OpenAITranscriber implements Transcriber {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    fetchImpl?: FetchLike,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {
    this.fetchImpl = fetchImpl ?? fetch
  }

  async transcribe(wav: Uint8Array, signal: AbortSignal): Promise<string> {
    const form = new FormData()
    form.append('model', this.model)
    form.append('response_format', 'json')
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'question.wav')
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal,
      })
    } catch (e) {
      throw new TranscribeError(`network: ${(e as Error).message}`)
    }
    if (!res.ok) throw new TranscribeError(`openai status ${res.status}`)
    const body = (await res.json()) as { text?: string }
    return (body.text ?? '').replace(/\s+/g, ' ').trim()
  }
}

/** Checks that the upload is a short 16-bit PCM WAV file, as the glasses produce. */
export function isShortWav(bytes: Uint8Array, maxSeconds = 20): boolean {
  if (bytes.length < 44) return false
  const text = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b))
  if (text(0, 4) !== 'RIFF' || text(8, 12) !== 'WAVE') return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const rate = view.getUint32(24, true)
  const bytesPerSecond = view.getUint32(28, true)
  if (rate < 8000 || rate > 48000 || bytesPerSecond === 0) return false
  return (bytes.length - 44) / bytesPerSecond <= maxSeconds
}
