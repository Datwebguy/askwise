// What each glasses screen says. Pure functions of the real research state,
// so nothing is shown that did not come from AskWise's research.
import { MESSAGES, STAGE_LABELS, STRENGTH_LABELS, CLAIM_LABELS } from '../../../shared/labels.ts'
import type { JobView, Report } from '../../../shared/types.ts'
import { ACTIVE_STATUSES } from '../../../shared/types.ts'

export interface Screen {
  /** Short heading line. */
  title: string
  /** Main text; long text is split into pages by the display. */
  body: string
  /** Gesture hint for this screen. */
  footer: string
}

export const HINT_HOME = 'Hold: speak   Tap: answer   Double-tap: exit'
export const HINT_PAGES = 'Tap: next   Swipe up: back   Double-tap: exit'
export const HINT_WAIT = 'Hold: speak   Double-tap: exit'
export const HINT_LISTEN = 'Let go when you are done'
export const HINT_DRAFT = 'Tap: ask   Double-tap: discard   Hold: again'
export const HINT_BACK = 'Tap: back   Hold: try again'

const STAGE_ORDER = ['understanding', 'searching', 'organising', 'checking', 'writing'] as const

export function welcomeScreen(signedIn: boolean): Screen {
  return {
    title: 'AskWise',
    body: signedIn
      ? 'Research anything. Compare your options.\n\nHold the touchpad and ask, or type a question in AskWise on your phone.'
      : 'Research anything. Compare your options.\n\nOpen AskWise on your phone and sign in to start.',
    footer: HINT_WAIT,
  }
}

export function homeScreen(job: JobView): Screen {
  return {
    title: 'AskWise',
    body: `Latest question:\n${job.question}\n\nHold the touchpad to ask something new.`,
    footer: HINT_HOME,
  }
}

export function researchingScreen(job: JobView): Screen {
  const current = job.stage ? STAGE_ORDER.indexOf(job.stage) : -1
  const lines = STAGE_ORDER.map((stage, i) => {
    const mark = i < current ? '[x]' : i === current ? '[>]' : '[ ]'
    return `${mark} ${STAGE_LABELS[stage]}`
  })
  return {
    title: 'Researching',
    body: `${truncate(job.question, 56)}\n\n${lines.join('\n')}`,
    footer: HINT_WAIT,
  }
}

export function clarifyScreen(job: JobView): Screen {
  return {
    title: 'One quick question',
    body: `${job.clarifyingQuestion ?? ''}\n\nAnswer on your phone to continue.`,
    footer: HINT_WAIT,
  }
}

export function stoppedScreen(job: JobView): Screen {
  return {
    title: job.status === 'CANCELLED' ? 'Research stopped' : MESSAGES.retry,
    body: `${job.message ?? MESSAGES.researchStopped}\n\nAsk again on your phone.`,
    footer: HINT_WAIT,
  }
}

export function offlineScreen(): Screen {
  return { title: 'AskWise', body: `${MESSAGES.offline}\n\nYour research keeps going and will appear here.`, footer: HINT_WAIT }
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The result, split into short screens the person taps through. */
export function resultScreens(job: JobView, report: Report): Screen[] {
  const g = report.glasses
  const screens: Screen[] = []
  const answer = [g.answer]
  if (g.bestOption) answer.push(`\nBest pick: ${g.bestOption}`)
  else if (report.recommendation.noClearWinner) answer.push('\nNo clear winner.')
  screens.push({ title: 'Answer', body: answer.join('\n'), footer: HINT_PAGES })

  if (g.reason) screens.push({ title: 'Why', body: g.reason, footer: HINT_PAGES })
  if (g.drawback) screens.push({ title: 'Watch out', body: g.drawback, footer: HINT_PAGES })

  const e = report.evidence
  const ev = [`${STRENGTH_LABELS[e.strength]} - ${e.sourceCount} sources`]
  const supported = e.counts.VERIFIED + e.counts.CORROBORATED
  if (supported) ev.push(`${supported} facts confirmed`)
  if (e.counts.CONFLICTING || report.conflicts.length) ev.push(`${CLAIM_LABELS.CONFLICTING}: ${Math.max(e.counts.CONFLICTING, report.conflicts.length)}`)
  if (e.counts.UNVERIFIED) ev.push(`${CLAIM_LABELS.UNVERIFIED}: ${e.counts.UNVERIFIED}`)
  if (e.pricesCheckedAt) ev.push(`Prices checked ${shortDate(e.pricesCheckedAt)}`)
  else if (report.products.length) ev.push("Check the shop for today's price.")
  screens.push({ title: 'Evidence', body: ev.join('\n'), footer: HINT_PAGES })

  if (g.alternatives.length) {
    screens.push({ title: 'More options', body: g.alternatives.map(a => `- ${a}`).join('\n'), footer: HINT_PAGES })
  }

  screens.push({
    title: job.exported ? 'Saved' : 'Save',
    body: job.exported
      ? 'This report is saved in Notion.\n\nThe full report and sources are on your phone.'
      : 'Full report and sources are on your phone.\n\nTo save it to Notion, review and approve it on your phone.',
    footer: HINT_PAGES,
  })
  return screens.map((s, i) => ({ ...s, title: `${s.title}  ${i + 1}/${screens.length}` }))
}

export type GlassesView =
  | { kind: 'welcome'; screen: Screen }
  | { kind: 'home'; screen: Screen }
  | { kind: 'waiting'; screen: Screen }
  | { kind: 'result'; screens: Screen[] }

export function viewFor(state: { signedIn: boolean; job: JobView | null; report: Report | null; offline: boolean }, showResult: boolean): GlassesView {
  const { job, report } = state
  if (state.offline && !report) return { kind: 'waiting', screen: offlineScreen() }
  if (!state.signedIn || !job) return { kind: 'welcome', screen: welcomeScreen(state.signedIn) }
  if (ACTIVE_STATUSES.includes(job.status)) return { kind: 'waiting', screen: researchingScreen(job) }
  if (job.status === 'NEEDS_CLARIFICATION') return { kind: 'waiting', screen: clarifyScreen(job) }
  if (job.status === 'FAILED' || job.status === 'CANCELLED') return { kind: 'waiting', screen: stoppedScreen(job) }
  if (report && job.hasReport) return showResult ? { kind: 'result', screens: resultScreens(job, report) } : { kind: 'home', screen: homeScreen(job) }
  return { kind: 'home', screen: homeScreen(job) }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

export function gettingReadyScreen(): Screen {
  return { title: 'One moment', body: 'Getting ready to listen…', footer: 'Keep holding' }
}

export function listeningScreen(): Screen {
  return { title: 'Listening', body: 'Ask your question now.\n\nFor example: compare two phones for battery life under 800 dollars.', footer: HINT_LISTEN }
}

export function writingScreen(): Screen {
  return { title: 'Got it', body: 'Writing down your question…', footer: 'One moment' }
}

export function draftScreen(text: string): Screen {
  return { title: 'Your question', body: text, footer: HINT_DRAFT }
}

export function voiceProblemScreen(message: string): Screen {
  return { title: 'AskWise', body: message, footer: HINT_BACK }
}
