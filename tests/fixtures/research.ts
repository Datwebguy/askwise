// TEST FIXTURES ONLY. Hand-written inputs for automated tests. Never used by the app.
import type { RawReport, Plan } from '../../server/research/schema.ts'
import type { ResearchProvider, SearchResult } from '../../server/research/provider.ts'
import { ProviderError } from '../../server/research/provider.ts'

export const FIXTURE_PLAN: Plan = {
  researchType: 'product_comparison',
  title: 'Fixture laptops',
  requirements: ['battery life'],
  country: 'United States',
  currency: 'USD',
  needsClarification: false,
  clarifyingQuestion: null,
  searchFocus: ['Fixture Laptop A', 'Fixture Laptop B'],
}

export const FIXTURE_SEARCH: SearchResult = {
  notes: 'Fixture notes. Laptop A battery 15h [a.example]. Laptop B battery 12h [b.example].',
  sources: [
    { url: 'https://a.example/review', title: 'Fixture review A', cited: true },
    { url: 'https://b.example/specs', title: 'Fixture specs B', cited: true },
    { url: 'https://shop.example/laptop-a', title: 'Fixture shop', cited: true },
    { url: 'https://unused.example/page', title: 'Fixture unused', cited: false },
  ],
}

export function fixtureRawReport(over: Partial<RawReport> = {}): RawReport {
  return {
    title: 'Fixture A vs Fixture B',
    summary: 'Fixture summary.',
    glasses: { answer: 'Fixture A lasts longer.', bestOption: 'Fixture A', reason: 'Longer battery.', drawback: 'Heavier.', alternatives: ['Fixture B'] },
    recommendation: { choice: 'Fixture A', why: 'Battery.', drawback: 'Weight.', alternative: 'Fixture B', noClearWinner: false },
    products: [
      {
        brand: 'FixtureCo',
        name: 'Laptop A',
        model: 'A-100',
        variant: '16GB/512GB',
        region: 'US',
        url: 'https://shop.example/laptop-a',
        specs: [
          { name: 'Battery', value: '15h', sourceIds: [1] },
          { name: 'Weight', value: '1.2kg', sourceIds: [] },
        ],
        prices: [
          { amount: 999, currency: 'usd', country: 'US', shop: 'Fixture Shop', priceType: 'regular', sourceId: 3 },
          { amount: 899, currency: 'USD', country: 'US', shop: 'Nowhere', priceType: 'discount', sourceId: null },
          { amount: 799, currency: 'USD', country: 'US', shop: 'Invented', priceType: 'discount', sourceId: 99 },
        ],
        reviews: [
          { summary: 'Fixture expert review.', reviewType: 'expert', sourceId: 1 },
          { summary: 'Unsourced review.', reviewType: 'customer', sourceId: null },
        ],
        pros: ['Battery'],
        cons: ['Weight'],
      },
      {
        brand: 'FixtureCo',
        name: 'Laptop B',
        model: 'B-200',
        variant: '',
        region: 'US',
        url: 'https://invented.example/b',
        specs: [{ name: 'Battery', value: '12h', sourceIds: [2] }],
        prices: [],
        reviews: [],
        pros: [],
        cons: [],
      },
    ],
    claims: [
      { text: 'A has 15h battery.', status: 'VERIFIED', sourceIds: [1], note: '' },
      { text: 'Claim with no source.', status: 'VERIFIED', sourceIds: [], note: '' },
      { text: 'Claim with an invented source.', status: 'CORROBORATED', sourceIds: [42], note: '' },
      { text: 'Same publisher twice.', status: 'CORROBORATED', sourceIds: [1, 1], note: '' },
      { text: 'Two publishers agree.', status: 'CORROBORATED', sourceIds: [1, 2], note: '' },
      { text: 'One-sided disagreement.', status: 'CONFLICTING', sourceIds: [2], note: '' },
      { text: 'A is the better pick.', status: 'INFERRED', sourceIds: [], note: '' },
    ],
    conflicts: [
      { topic: 'Battery', details: 'Sources differ.', sourceIds: [1, 2] },
      { topic: 'Unsourced conflict', details: 'No sources.', sourceIds: [] },
    ],
    missingInfo: ['Fixture missing info'],
    followUps: ['Fixture follow-up?'],
    ...over,
  }
}

/** A research provider for tests. Each step can be delayed, made to throw, or replaced. */
export class FixtureProvider implements ResearchProvider {
  readonly name = 'fixture'
  calls: string[] = []
  plan_: Plan = { ...FIXTURE_PLAN }
  raw: RawReport = fixtureRawReport()
  searchDelayMs = 0
  failSearch: ProviderError | null = null
  lastNotes: string | null = null

  async plan(req: { notes: string | null }) {
    this.calls.push('plan')
    this.lastNotes = req.notes
    return this.plan_
  }
  async search(_req: unknown, signal: AbortSignal) {
    this.calls.push('search')
    if (this.searchDelayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.searchDelayMs)
        signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new Error('aborted'))
        })
      })
    }
    if (this.failSearch) throw this.failSearch
    return FIXTURE_SEARCH
  }
  structureDelayMs = 0
  async structure() {
    this.calls.push('structure')
    // Ignores cancellation on purpose, like work that finishes after the time limit.
    if (this.structureDelayMs) await new Promise(r => setTimeout(r, this.structureDelayMs))
    return this.raw
  }
}
