// Collects microphone audio from the glasses while the touchpad is held, and
// packs it as a WAV file. The glasses send PCM, 16-bit little-endian, 16 kHz, mono.
export const SAMPLE_RATE = 16_000
export const MAX_SECONDS = 15

export class VoiceCapture {
  private chunks: Uint8Array[] = []
  private size = 0

  get seconds(): number {
    return this.size / (SAMPLE_RATE * 2)
  }

  push(pcm: Uint8Array): void {
    const room = MAX_SECONDS * SAMPLE_RATE * 2 - this.size
    if (room <= 0) return
    const part = pcm.length > room ? pcm.subarray(0, room) : pcm
    this.chunks.push(part)
    this.size += part.length
  }

  toWav(): Uint8Array {
    return pcmToWav(this.chunks, this.size)
  }
}

export function pcmToWav(chunks: Uint8Array[], size = chunks.reduce((n, c) => n + c.length, 0)): Uint8Array {
  const out = new Uint8Array(44 + size)
  const v = new DataView(out.buffer)
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + size, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, SAMPLE_RATE, true)
  v.setUint32(28, SAMPLE_RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, size, true)
  let at = 44
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
