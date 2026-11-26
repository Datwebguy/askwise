// Connects the glasses gestures and screens to the shared research state.
import { OsEventTypeList, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Tracker, TrackerState } from '../tracker.ts'
import { GlassesDisplay, paginateBody } from './display.ts'
import { viewFor } from './screens.ts'
import type { GlassesView, Screen } from './screens.ts'
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

export class GlassesController {
  private showResult = false
  private pages: Screen[] = []
  private index = 0
  private lastJobKey = ''
  private view: GlassesView | null = null

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
    this.view = viewFor(state, this.showResult)
    this.pages = pagesOf(this.view)
    if (this.index >= this.pages.length) this.index = 0
    void this.display.show(this.pages[this.index])
  }

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
      const sys = eventTypeOf(event.sysEvent)
      const text = eventTypeOf(event.textEvent)
      if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || text === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        void this.bridge.shutDownPageContainer(1)
        return
      }
      if (text === OsEventTypeList.SCROLL_TOP_EVENT) return this.previous()
      if (text === OsEventTypeList.SCROLL_BOTTOM_EVENT) return this.next()
      if (sys === OsEventTypeList.CLICK_EVENT || text === OsEventTypeList.CLICK_EVENT) return this.next()
      if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
        void this.tracker.refresh()
        return
      }
      if (sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) unsubscribe()
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
