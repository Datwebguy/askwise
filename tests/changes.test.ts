import { describe, expect, it } from 'vitest'
import { diffReports, sameName } from '../server/research/changes.ts'
import { verifyReport } from '../server/research/verify.ts'
import { numberSources } from '../server/research/sources.ts'
import { FIXTURE_SEARCH, fixtureRawReport } from './fixtures/research.ts'
import type { RawReport } from '../server/research/schema.ts'

// Test fixtures only: two versions of the same fixture report.
const build = (raw: RawReport) =>
  verifyReport(raw, { question: 'Fixture question', researchType: 'product_comparison', sources: numberSources(FIXTURE_SEARCH.sources), checkedAt: '2026-11-27T10:00:00.000Z', usedNotionPage: null })

describe('what changed between two checks', () => {
  it('says plainly when nothing changed', () => {
    const r = build(fixtureRawReport())
    const c = diffReports(r, r)
    expect(c.every(x => x.same)).toBe(true)
    expect(c.map(x => x.text)).toContain('Best pick unchanged: Fixture A')
    expect(c.map(x => x.text)).toContain('FixtureCo Laptop A: price unchanged at 999 USD (Fixture Shop)')
  })

  it('reports a changed specification only when both values are confirmed', () => {
    const before = build(fixtureRawReport())
    const raw = fixtureRawReport()
    raw.products[0].specs[0].value = '14h'
    raw.products[0].specs[1].value = '1.1kg' // unconfirmed in both: never reported
    const c = diffReports(before, build(raw)).map(x => x.text)
    expect(c).toContain('FixtureCo Laptop A battery: 15h → 14h')
    expect(c.some(t => t.includes('weight'))).toBe(false)
  })

  it('notes products that appear or drop out, and prices that could not be confirmed again', () => {
    const before = build(fixtureRawReport())
    const raw = fixtureRawReport()
    raw.products[0].prices = []
    raw.products[1] = { ...raw.products[1], name: 'Laptop C', model: 'C-300' }
    const c = diffReports(before, build(raw)).map(x => x.text)
    expect(c).toContain('FixtureCo Laptop A: earlier price 999 USD (Fixture Shop) could not be confirmed this time')
    expect(c).toContain('New in this check: FixtureCo Laptop C')
    expect(c).toContain('Not in this check: FixtureCo Laptop B')
  })
})

describe('recognising the same product written two ways', () => {
  it('treats reordered names, years and "inch" as the same product', () => {
    // From a real check: the same laptop named differently by two research runs.
    expect(sameName('MacBook Air M4 (13-inch)', 'MacBook Air (13-inch, M4, 2025)')).toBe(true)
    expect(sameName('Dell XPS 13', 'Dell XPS 13 9350')).toBe(true)
    expect(sameName('MacBook Air M4', 'MacBook Pro M4')).toBe(false)
    expect(sameName('Laptop A', 'Laptop B')).toBe(false)
  })

  it('does not report a changed pick when only the name is written differently', () => {
    const before = build(fixtureRawReport())
    const raw = fixtureRawReport({ recommendation: { choice: 'Fixture A (2025)', why: 'Battery.', drawback: 'Weight.', alternative: 'Fixture B', noClearWinner: false } })
    expect(diffReports(before, build(raw))[0]).toEqual({ kind: 'pick', same: true, text: 'Best pick unchanged: Fixture A (2025)' })
  })
})
