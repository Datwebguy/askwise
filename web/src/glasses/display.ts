// Draws AskWise screens on the G2 display: a heading, a body and a gesture
// hint. Updates text in place (no flicker) and queues writes so fast
// gestures cannot overlap.
import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { measureTextWrap } from '@evenrealities/pretext'
import type { Screen } from './screens.ts'

export const DISPLAY = { width: 576, height: 288 }
const LINE_HEIGHT = 27
const PAD = 4

const BOX = {
  title: { id: 1, name: 'title', y: 0, h: 40 },
  body: { id: 2, name: 'body', y: 40, h: 216 },
  footer: { id: 3, name: 'footer', y: 256, h: 32 },
}

export const BODY_INNER = { width: DISPLAY.width - 2 * PAD, height: BOX.body.h - 2 * PAD }
export const BODY_MAX_LINES = Math.floor(BODY_INNER.height / LINE_HEIGHT)

/** Splits body text into pages that fit the body box. */
export function paginateBody(text: string, measure: (t: string) => number = t => measureTextWrap(t, BODY_INNER.width).lineCount): string[] {
  const lines = text.split('\n')
  const pages: string[] = []
  let current: string[] = []
  let used = 0
  const push = () => {
    if (current.length) pages.push(current.join('\n').replace(/^\n+|\n+$/g, ''))
    current = []
    used = 0
  }
  for (const line of lines) {
    const n = line.trim() === '' ? 1 : measure(line)
    if (n > BODY_MAX_LINES) {
      push()
      const words = line.split(' ')
      let chunk = ''
      for (const w of words) {
        const next = chunk ? `${chunk} ${w}` : w
        if (measure(next) > BODY_MAX_LINES) {
          pages.push(chunk)
          chunk = w
        } else chunk = next
      }
      current = [chunk]
      used = measure(chunk)
      continue
    }
    if (used + n > BODY_MAX_LINES) push()
    if (!(current.length === 0 && line.trim() === '')) {
      current.push(line)
      used += n
    }
  }
  push()
  return pages.length ? pages.filter(p => p.trim() !== '') : ['']
}

export class GlassesDisplay {
  private queue: Promise<unknown> = Promise.resolve()
  private last: Record<string, string> = {}

  constructor(private readonly bridge: EvenAppBridge) {}

  async start(first: Screen): Promise<void> {
    const box = (b: (typeof BOX)[keyof typeof BOX], content: string, capture: boolean) =>
      new TextContainerProperty({
        xPosition: 0,
        yPosition: b.y,
        width: DISPLAY.width,
        height: b.h,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: PAD,
        containerID: b.id,
        containerName: b.name,
        content,
        isEventCapture: capture ? 1 : 0,
      })
    const body = paginateBody(first.body)[0]
    await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 3,
        textObject: [box(BOX.title, first.title, false), box(BOX.body, body, true), box(BOX.footer, first.footer, false)],
      }),
    )
    this.last = { title: first.title, body, footer: first.footer }
  }

  show(page: Screen): Promise<void> {
    const next = this.queue.then(async () => {
      for (const key of ['title', 'body', 'footer'] as const) {
        const content = page[key]
        if (this.last[key] === content) continue
        const b = BOX[key]
        await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: b.id, containerName: b.name, content }))
        this.last[key] = content
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}
