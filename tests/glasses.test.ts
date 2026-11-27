import { describe, expect, it } from 'vitest'
import { measureTextWrap } from '@evenrealities/pretext'
import { BODY_INNER, BODY_MAX_LINES, paginateBody } from '../web/src/glasses/display.ts'
import { draftScreen, listeningScreen, resultScreens, viewFor, researchingScreen } from '../web/src/glasses/screens.ts'
import { pagesOf } from '../web/src/glasses/controller.ts'
import { verifyReport } from '../server/research/verify.ts'
import { numberSources } from '../server/research/sources.ts'
import { FIXTURE_SEARCH, fixtureRawReport } from './fixtures/research.ts'
import { diffReports } from '../server/research/changes.ts'
import type { JobView } from '../shared/types.ts'
import { DEVELOPER_WORDS } from './wording.ts'

const report = verifyReport(fixtureRawReport(), {
  question: 'Fixture question',
  researchType: 'product_comparison',
  sources: numberSources(FIXTURE_SEARCH.sources),
  checkedAt: '2026-11-26T10:00:00.000Z',
  usedNotionPage: null,
})

const job = (over: Partial<JobView> = {}): JobView => ({
  id: 'fixture-job',
  question: 'Fixture question about laptops',
  clarification: null,
  clarifyingQuestion: null,
  status: 'READY',
  stage: null,
  message: null,
  researchType: 'product_comparison',
  title: 'Fixture',
  createdAt: '2026-11-26T10:00:00.000Z',
  updatedAt: '2026-11-26T10:00:00.000Z',
  hasReport: true,
  exported: null,
  basedOn: null,
  ...over,
})

const allStates = [
  viewFor({ signedIn: false, job: null, report: null, offline: false }, false),
  viewFor({ signedIn: true, job: null, report: null, offline: false }, false),
  viewFor({ signedIn: true, job: job({ status: 'RUNNING', stage: 'searching', hasReport: false }), report: null, offline: false }, false),
  viewFor({ signedIn: true, job: job({ status: 'NEEDS_CLARIFICATION', clarifyingQuestion: 'Budget?', hasReport: false }), report: null, offline: false }, false),
  viewFor({ signedIn: true, job: job({ status: 'FAILED', message: "Let's try that again.", hasReport: false }), report: null, offline: false }, false),
  viewFor({ signedIn: true, job: job({ status: 'CANCELLED', hasReport: false }), report: null, offline: false }, false),
  viewFor({ signedIn: true, job: null, report: null, offline: true }, false),
  viewFor({ signedIn: true, job: job(), report, offline: false }, false),
  viewFor({ signedIn: true, job: job(), report, offline: false }, true),
  viewFor({ signedIn: true, job: job({ status: 'EXPORTED', exported: { url: 'https://n.example', at: '2026-11-26T11:00:00Z' } }), report, offline: false }, true),
]

describe('glasses screens', () => {
  it('picks the right screen for each state', () => {
    expect(allStates.map(v => v.kind)).toEqual(['welcome', 'welcome', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting', 'home', 'result', 'result'])
  })

  it('shows the real research step while working', () => {
    const s = researchingScreen(job({ status: 'RUNNING', stage: 'checking', hasReport: false }))
    expect(s.body).toContain('[x] Searching the web')
    expect(s.body).toContain('[>] Checking sources')
    expect(s.body).toContain('[ ] Writing your answer')
  })

  it('shows the answer, reason, drawback, evidence, price check time and save step', () => {
    const titles = resultScreens(job(), report).map(s => s.title.replace(/\s+\d+\/\d+$/, ''))
    expect(titles).toEqual(['Answer', 'Why', 'Watch out', 'Evidence', 'More options', 'Save'])
    const evidence = resultScreens(job(), report)[3].body
    expect(evidence).toMatch(/sources/)
    expect(evidence).toMatch(/Prices checked/)
  })

  it('never approves a save from the glasses; it points to the phone', () => {
    const save = resultScreens(job(), report).at(-1)!
    expect(save.body).toMatch(/approve it on your phone/)
  })

  it('fits every page in the display and stays under the text limits', () => {
    for (const view of allStates) {
      for (const page of pagesOf(view)) {
        expect(measureTextWrap(page.body, BODY_INNER.width).lineCount).toBeLessThanOrEqual(BODY_MAX_LINES)
        expect(page.body.length).toBeLessThan(1000)
        expect(measureTextWrap(page.title, BODY_INNER.width).lineCount).toBe(1)
        expect(measureTextWrap(page.footer, BODY_INNER.width).lineCount).toBe(1)
      }
    }
  })

  it('fits the whole research progress on one page', () => {
    const s = researchingScreen(job({ status: 'RUNNING', stage: 'writing', hasReport: false, question: 'x '.repeat(200) }))
    expect(paginateBody(s.body)).toHaveLength(1)
  })

  it('splits long text into pages without losing words', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const pages = paginateBody(long)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.join(' ').split(/\s+/)).toEqual(long.split(' '))
  })

  it('uses plain words only, with no emoji', () => {
    for (const view of allStates) {
      for (const page of pagesOf(view)) {
        const text = `${page.title} ${page.body} ${page.footer}`
        expect(text).not.toMatch(/[\u{1F000}-\u{1FFFF}]/u)
        for (const w of DEVELOPER_WORDS) expect(text.toLowerCase()).not.toMatch(new RegExp(`\\b${w}\\b`))
      }
    }
  })
})

describe('checking again and asking more on the glasses', () => {
  // Test fixtures only: a fresh check of the fixture report with a changed price and pick.
  const before = report
  const raw = fixtureRawReport({ recommendation: { choice: 'Laptop B', why: 'Lighter.', drawback: 'Battery.', alternative: 'Laptop A', noClearWinner: false } })
  raw.products[0].prices[0].amount = 949
  const after = verifyReport(raw, { question: 'Fixture question', researchType: 'product_comparison', sources: numberSources(FIXTURE_SEARCH.sources), checkedAt: '2026-11-27T10:00:00.000Z', usedNotionPage: null })
  after.basedOn = { id: 'fixture-job', title: before.title, createdAt: before.createdAt, relation: 'recheck' }
  after.changes = diffReports(before, after)

  it('shows what changed right after the answer, and fits the display', () => {
    const screens = resultScreens(job({ basedOn: { id: 'fixture-job', relation: 'recheck' } }), after)
    expect(screens[1].title).toMatch(/^What changed/)
    expect(screens[1].body).toContain('Best pick changed: Fixture A → Laptop B')
    const view = viewFor({ signedIn: true, job: job(), report: after, offline: false }, true)
    for (const page of pagesOf(view)) {
      expect(measureTextWrap(page.body, BODY_INNER.width).lineCount).toBeLessThanOrEqual(BODY_MAX_LINES)
      for (const w of DEVELOPER_WORDS) expect(page.body.toLowerCase()).not.toContain(w)
    }
  })

  it('has no changes screen on a first report', () => {
    expect(resultScreens(job(), before).some(s => s.title.startsWith('What changed'))).toBe(false)
  })

  it('makes clear a spoken question is about the answer on the lens', () => {
    expect(listeningScreen(true).body).toContain('Ask about this answer')
    expect(draftScreen('Which one has the better keyboard?', true).title).toBe('About this answer')
    expect(draftScreen('Compare two phones').title).toBe('Your question')
  })
})
