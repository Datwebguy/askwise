import { describe, expect, it } from 'vitest'
import { checkClaim, glassesText, needsReview, verifyReport } from '../server/research/verify.ts'
import { numberSources, normaliseUrl } from '../server/research/sources.ts'
import { PRICE_UNCONFIRMED } from '../shared/labels.ts'
import { FIXTURE_SEARCH, fixtureRawReport } from './fixtures/research.ts'

const sources = numberSources(FIXTURE_SEARCH.sources)
const ctx = { question: 'Fixture question', researchType: 'product_comparison' as const, sources, checkedAt: '2026-11-26T10:00:00.000Z', usedNotionPage: null }

describe('checking step: no invented sources', () => {
  const report = verifyReport(fixtureRawReport(), ctx)

  it('drops source numbers that the web search never returned', () => {
    const invented = report.claims.find(c => c.text === 'Claim with an invented source.')!
    expect(invented.sourceIds).toEqual([])
    expect(invented.status).toBe('UNVERIFIED')
  })

  it('never marks an unsupported claim as confirmed', () => {
    const unsupported = report.claims.find(c => c.text === 'Claim with no source.')!
    expect(unsupported.status).toBe('UNVERIFIED')
    for (const c of report.claims) {
      if (c.status === 'VERIFIED' || c.status === 'CORROBORATED') expect(c.sourceIds.length).toBeGreaterThan(0)
    }
  })

  it('needs two different publishers for "backed by several sources"', () => {
    expect(report.claims.find(c => c.text === 'Same publisher twice.')!.status).toBe('VERIFIED')
    expect(report.claims.find(c => c.text === 'Two publishers agree.')!.status).toBe('CORROBORATED')
  })

  it('needs two sources to say sources disagree', () => {
    expect(report.claims.find(c => c.text === 'One-sided disagreement.')!.status).toBe('UNVERIFIED')
    expect(report.conflicts).toHaveLength(1)
    expect(report.conflicts[0].topic).toBe('Battery')
  })

  it('keeps conclusions separate from facts', () => {
    expect(report.claims.find(c => c.text === 'A is the better pick.')!.status).toBe('INFERRED')
  })

  it('removes product links that were not found by the search', () => {
    expect(report.products[0].url).toBe('https://shop.example/laptop-a')
    expect(report.products[1].url).toBeNull()
  })

  it('lists only sources the report uses', () => {
    expect(report.sources.map(s => s.url)).not.toContain('https://unused.example/page')
    for (const s of report.sources) expect(FIXTURE_SEARCH.sources.map(f => f.url)).toContain(s.url)
  })
})

describe('checking step: no invented prices or specifications', () => {
  const report = verifyReport(fixtureRawReport(), ctx)
  const a = report.products[0]

  it('keeps only prices with a real source, currency, shop and country', () => {
    expect(a.prices).toHaveLength(1)
    expect(a.prices[0]).toMatchObject({ amount: 999, currency: 'USD', country: 'US', shop: 'Fixture Shop', sourceId: 3 })
  })

  it('records when each price was checked', () => {
    expect(a.prices[0].checkedAt).toBe(ctx.checkedAt)
    expect(report.evidence.pricesCheckedAt).toBe(ctx.checkedAt)
  })

  it('leaves missing prices unconfirmed', () => {
    expect(report.products[1].prices).toEqual([])
    expect(report.products[1].priceNote).toBe(PRICE_UNCONFIRMED)
    expect(a.priceNote).toBeNull()
  })

  it('marks specifications without a source as not confirmed', () => {
    expect(a.specs.find(s => s.name === 'Battery')!.confirmed).toBe(true)
    expect(a.specs.find(s => s.name === 'Weight')!.confirmed).toBe(false)
  })

  it('keeps exact model and variant separate per product', () => {
    expect(a.model).toBe('A-100')
    expect(a.variant).toBe('16GB/512GB')
    expect(report.products[1].model).toBe('B-200')
  })

  it('drops reviews without a source', () => {
    expect(a.reviews).toHaveLength(1)
    expect(a.reviews[0].reviewType).toBe('expert')
  })

  it('removes a price with an invalid amount or currency', () => {
    const raw = fixtureRawReport()
    raw.products[0].prices = [
      { amount: -5, currency: 'USD', country: 'US', shop: 'S', priceType: 'regular', sourceId: 3 },
      { amount: 10, currency: 'dollars', country: 'US', shop: 'S', priceType: 'regular', sourceId: 3 },
      { amount: null, currency: 'USD', country: 'US', shop: 'S', priceType: 'regular', sourceId: 3 },
    ]
    expect(verifyReport(raw, ctx).products[0].prices).toEqual([])
  })
})

describe('checking step: recommendations and review flags', () => {
  it('drops the best pick when there is no clear winner', () => {
    const raw = fixtureRawReport({ recommendation: { choice: 'X', why: 'Close call.', drawback: '', alternative: null, noClearWinner: true } })
    const r = verifyReport(raw, ctx)
    expect(r.recommendation.choice).toBeNull()
    expect(r.glasses.bestOption).toBeNull()
  })

  it('asks for a closer look when sources disagree or evidence is weak', () => {
    expect(needsReview(verifyReport(fixtureRawReport(), ctx))).toBe(true)
    const calm = verifyReport(
      fixtureRawReport({
        conflicts: [],
        claims: [
          { text: 'a', status: 'VERIFIED', sourceIds: [1], note: '' },
          { text: 'b', status: 'CORROBORATED', sourceIds: [1, 2], note: '' },
          { text: 'c', status: 'VERIFIED', sourceIds: [3], note: '' },
        ],
      }),
      ctx,
    )
    expect(calm.evidence.strength).toBe('strong')
    expect(needsReview(calm)).toBe(false)
  })

  it('flags old information only with a source', () => {
    expect(checkClaim({ text: 'Old', status: 'OUTDATED', note: '2019' }, [], new Map()).status).toBe('UNVERIFIED')
    expect(checkClaim({ text: 'Old', status: 'OUTDATED', note: '2019' }, [1], new Map([[1, 'a.example']])).status).toBe('OUTDATED')
  })
})

describe('glasses text', () => {
  it('removes markdown, emoji and extra spaces, and fits the limit', () => {
    const t = glassesText('**Best** pick 🚀 is [A](https://x.example)   because   reasons and more reasons', 30)
    expect(t).not.toMatch(/[*[\]🚀]/u)
    expect(t.length).toBeLessThanOrEqual(30)
    expect(t.startsWith('Best pick is A')).toBe(true)
  })
})

describe('source addresses', () => {
  it('removes tracking parameters and rejects non-web links', () => {
    expect(normaliseUrl('https://a.example/x?utm_source=openai&id=2#top')).toBe('https://a.example/x?id=2')
    expect(normaliseUrl('javascript:alert(1)')).toBeNull()
  })
})
