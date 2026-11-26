// Connects the glasses gestures and screens to the shared research state.
// Hold the touchpad to ask by voice; the question appears as a draft that is
// only sent after a tap. Double-tap discards a draft, otherwise it exits.
import { OsEventTypeList, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Tracker, TrackerState } from '../tracker.ts'
import { api, newRequestKey } from '../api.ts'
import { MESSAGES } from '../../../shared/labels.ts'
import { GlassesDisplay, paginateBody } from './display.ts'
import { draftScreen, gettingReadyScreen, listeningScreen, viewFor, voiceProblemScreen, writingScreen } from './screens.ts'
import type { GlassesView, Screen } from './screens.ts'
import { VoiceCapture } from './voice.ts'
import { ACTIVE_STATUSES } from '../../../shared/types.ts'

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

/** Expands screens into display pages, keeping each screen's heading and hint. */
export function pagesOf(view: GlassesView, paginate: (t: string) => string[] = paginateBody): Screen[] {
  const screens = view.kind === 'result' ? view.screens : [view.screen]
  return screens.flatMap(s => paginate(s.body).map(body => ({ ...s, body })))
}

type Voice =
  | { step: 'off' }
  | { step: 'listening'; capture: VoiceCapture; ready: boolean }
  | { step: 'writing' }
  | { step: 'draft'; text: string }
  | { step: 'sending'; text: string }
  | { step: 'problem'; message: string }

export class GlassesController {
  private showResult = false
  private pages: Screen[] = []
  private index = 0
  private lastJobKey = ''
  private view: GlassesView | null = null
  private voice: Voice = { step: 'off' }

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly display: GlassesDisplay,
    private readonly tracker: Tracker,
  ) {}

  private render(state: TrackerState): void {
    const job = state.job
    const key = `${job?.id ?? ''}:${job?.status ?? ''}`
    if (key !== this.lastJobKey) {
      const wasActive = this.lastJobKey !== '' && ACTIVE_STATUSES.includes(this.lastJobKey.split(':')[1] as never)
      // A result that just finished opens straight away.
      if (wasActive && job?.hasReport) this.showResult = true
      if (job && ACTIVE_STATUSES.includes(job.status)) this.showResult = false
      this.lastJobKey = key
      this.index = 0
    }
    if (this.voice.step !== 'off') return this.renderVoice()
    this.view = viewFor(state, this.showResult)
    this.pages = pagesOf(this.view)
    if (this.index >= this.pages.length) this.index = 0
    void this.display.show(this.pages[this.index])
  }

  private renderVoice(): void {
    const v = this.voice
    const screen =
      v.step === 'listening'
        ? v.ready
          ? listeningScreen()
          : gettingReadyScreen()
        : v.step === 'writing' || v.step === 'sending'
          ? writingScreen()
          : v.step === 'draft'
            ? draftScreen(v.text)
            : v.step === 'problem'
              ? voiceProblemScreen(v.message)
              : null
    if (screen) void this.display.show({ ...screen, body: paginateBody(screen.body)[0] })
  }

  private setVoice(v: Voice): void {
    this.voice = v
    if (v.step === 'off') this.render(this.tracker.state)
    else this.renderVoice()
  }

  // ---- Voice ---------------------------------------------------------
  private async startListening(): Promise<void> {
    if (!this.tracker.state.signedIn || this.voice.step === 'listening' || this.voice.step === 'writing' || this.voice.step === 'sending') return
    this.setVoice({ step: 'listening', capture: new VoiceCapture(), ready: false })
    const ok = await this.bridge.audioControl(true).catch(() => false)
    if (!ok && (this.voice as Voice).step === 'listening') this.setVoice({ step: 'problem', message: "The microphone isn't available right now." })
  }

  private async stopListening(): Promise<void> {
    if (this.voice.step !== 'listening') return
    const capture = this.voice.capture
    await this.bridge.audioControl(false).catch(() => false)
    if (capture.seconds < 0.6) return this.setVoice({ step: 'problem', message: 'Hold the touchpad while you speak, then let go.' })
    this.setVoice({ step: 'writing' })
    try {
      const { text } = await api.transcribe(capture.toWav())
      this.setVoice({ step: 'draft', text })
    } catch (e) {
      this.setVoice({ step: 'problem', message: e instanceof Error && e.message ? e.message : MESSAGES.retry })
    }
  }

  private async sendDraft(text: string): Promise<void> {
    this.setVoice({ step: 'sending', text })
    try {
      const { job } = await api.ask(text, false, newRequestKey())
      this.voice = { step: 'off' }
      this.showResult = false
      this.tracker.follow(job)
    } catch (e) {
      this.setVoice({ step: 'problem', message: e instanceof Error && e.message ? e.message : MESSAGES.retry })
    }
  }

  // ---- Navigation ----------------------------------------------------
  private next(): void {
    if (!this.view) return
    if (this.view.kind === 'home') {
      this.showResult = true
      this.index = 0
      this.render(this.tracker.state)
      return
    }
    if (this.view.kind === 'result' && this.index === this.pages.length - 1) {
      this.showResult = false
      this.index = 0
      this.render(this.tracker.state)
      return
    }
    if (this.index < this.pages.length - 1) {
      this.index += 1
      void this.display.show(this.pages[this.index])
    }
  }

  private previous(): void {
    if (this.index > 0) {
      this.index -= 1
      void this.display.show(this.pages[this.index])
    } else if (this.view?.kind === 'result') {
      this.showResult = false
      this.render(this.tracker.state)
    }
  }

  attach(): void {
    this.tracker.subscribe(s => this.render(s))
    const unsubscribe = this.bridge.onEvenHubEvent(event => {
      const pcm = event.audioEvent?.audioPcm
      if (pcm && this.voice.step === 'listening') {
        this.voice.capture.push(pcm)
        // Say "Listening" only once sound is really arriving, so people know when to start talking.
        if (!this.voice.ready) {
          this.voice.ready = true
          this.renderVoice()
        }
      }

      const sys = eventTypeOf(event.sysEvent)
      const text = eventTypeOf(event.textEvent)
      const is = (t: OsEventTypeList) => sys === t || text === t

      if (is(OsEventTypeList.LONG_PRESS_EVENT)) return void this.startListening()
      if (is(OsEventTypeList.LONG_PRESS_RELEASE_EVENT)) return void this.stopListening()
      if (this.voice.step === 'listening' || this.voice.step === 'writing' || this.voice.step === 'sending') return

      if (is(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
        // A draft is thrown away; anywhere else double-tap leaves the app.
        if (this.voice.step === 'draft') return this.setVoice({ step: 'off' })
        void this.bridge.shutDownPageContainer(1)
        return
      }
      if (this.voice.step === 'draft' && is(OsEventTypeList.CLICK_EVENT)) return void this.sendDraft(this.voice.text)
      if (this.voice.step === 'problem' && (is(OsEventTypeList.CLICK_EVENT) || text === OsEventTypeList.SCROLL_TOP_EVENT)) {
        return this.setVoice({ step: 'off' })
      }
      if (this.voice.step !== 'off') return

      if (text === OsEventTypeList.SCROLL_TOP_EVENT) return this.previous()
      if (text === OsEventTypeList.SCROLL_BOTTOM_EVENT) return this.next()
      if (is(OsEventTypeList.CLICK_EVENT)) return this.next()
      if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        void this.tracker.refresh()
        return
      }
      if (sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        void this.bridge.audioControl(false)
        unsubscribe()
      }
    })
  }
}

/** Starts the glasses experience when AskWise runs inside the Even Realities app. */
export async function startGlasses(tracker: Tracker): Promise<void> {
  const bridge = await waitForEvenAppBridge()
  const display = new GlassesDisplay(bridge)
  await display.start(pagesOf(viewFor(tracker.state, false))[0])
  new GlassesController(bridge, display, tracker).attach()
}
