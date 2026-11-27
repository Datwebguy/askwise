// Strict JSON schemas the research model must follow. Every field is required
// (strict mode), and optional values are expressed as nullable types.
import { CLAIM_STATUSES, PRICE_TYPES, RESEARCH_TYPES, REVIEW_TYPES } from '../../shared/types.ts'
import type { ClaimStatus, PriceType, ResearchType, ReviewType } from '../../shared/types.ts'

const str = { type: 'string' } as const
const nullableStr = { type: ['string', 'null'] } as const
const strList = { type: 'array', items: str } as const
const idList = { type: 'array', items: { type: 'integer' } } as const

function obj(properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
}

export const PLAN_SCHEMA = obj({
  researchType: { type: 'string', enum: [...RESEARCH_TYPES] },
  title: str,
  requirements: strList,
  country: nullableStr,
  currency: nullableStr,
  needsClarification: { type: 'boolean' },
  clarifyingQuestion: nullableStr,
  searchFocus: strList,
})

export interface Plan {
  researchType: ResearchType
  title: string
  requirements: string[]
  country: string | null
  currency: string | null
  needsClarification: boolean
  clarifyingQuestion: string | null
  searchFocus: string[]
}

export const REPORT_SCHEMA = obj({
  title: str,
  summary: str,
  glasses: obj({
    answer: str,
    bestOption: nullableStr,
    reason: str,
    drawback: str,
    alternatives: strList,
  }),
  recommendation: obj({
    choice: nullableStr,
    why: str,
    drawback: str,
    alternative: nullableStr,
    noClearWinner: { type: 'boolean' },
  }),
  products: {
    type: 'array',
    items: obj({
      brand: str,
      name: str,
      model: str,
      variant: str,
      region: str,
      url: nullableStr,
      specs: { type: 'array', items: obj({ name: str, value: str, sourceIds: idList }) },
      prices: {
        type: 'array',
        items: obj({
          amount: { type: ['number', 'null'] },
          currency: str,
          country: str,
          shop: str,
          priceType: { type: 'string', enum: [...PRICE_TYPES] },
          sourceId: { type: ['integer', 'null'] },
        }),
      },
      reviews: {
        type: 'array',
        items: obj({
          summary: str,
          reviewType: { type: 'string', enum: [...REVIEW_TYPES] },
          sourceId: { type: ['integer', 'null'] },
        }),
      },
      pros: strList,
      cons: strList,
    }),
  },
  claims: {
    type: 'array',
    items: obj({
      text: str,
      status: { type: 'string', enum: [...CLAIM_STATUSES] },
      sourceIds: idList,
      note: str,
    }),
  },
  conflicts: { type: 'array', items: obj({ topic: str, details: str, sourceIds: idList }) },
  missingInfo: strList,
  followUps: strList,
})

/** Report exactly as the model returns it, before AskWise checks it. */
export interface RawReport {
  title: string
  summary: string
  glasses: { answer: string; bestOption: string | null; reason: string; drawback: string; alternatives: string[] }
  recommendation: {
    choice: string | null
    why: string
    drawback: string
    alternative: string | null
    noClearWinner: boolean
  }
  products: {
    brand: string
    name: string
    model: string
    variant: string
    region: string
    url: string | null
    specs: { name: string; value: string; sourceIds: number[] }[]
    prices: {
      amount: number | null
      currency: string
      country: string
      shop: string
      priceType: PriceType
      sourceId: number | null
    }[]
    reviews: { summary: string; reviewType: ReviewType; sourceId: number | null }[]
    pros: string[]
    cons: string[]
  }[]
  claims: { text: string; status: ClaimStatus; sourceIds: number[]; note: string }[]
  conflicts: { topic: string; details: string; sourceIds: number[] }[]
  missingInfo: string[]
  followUps: string[]
}

// Shape checks used when reading model output. Structured outputs already
// enforce the schema; these guard against truncated or altered responses.
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const isStr = (v: unknown) => typeof v === 'string'
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string'
const isStrArr = (v: unknown) => Array.isArray(v) && v.every(isStr)

export function isPlan(v: unknown): v is Plan {
  return (
    isObj(v) &&
    (RESEARCH_TYPES as readonly unknown[]).includes(v.researchType) &&
    isStr(v.title) &&
    isStrArr(v.requirements) &&
    isStrOrNull(v.country) &&
    isStrOrNull(v.currency) &&
    typeof v.needsClarification === 'boolean' &&
    isStrOrNull(v.clarifyingQuestion) &&
    isStrArr(v.searchFocus)
  )
}

export function isRawReport(v: unknown): v is RawReport {
  if (!isObj(v)) return false
  const g = v.glasses
  const r = v.recommendation
  return (
    isStr(v.title) &&
    isStr(v.summary) &&
    isObj(g) &&
    isStr(g.answer) &&
    isStr(g.reason) &&
    isStr(g.drawback) &&
    isStrArr(g.alternatives) &&
    isObj(r) &&
    isStr(r.why) &&
    typeof r.noClearWinner === 'boolean' &&
    Array.isArray(v.products) &&
    v.products.every(p => isObj(p) && Array.isArray(p.specs) && Array.isArray(p.prices) && Array.isArray(p.reviews)) &&
    Array.isArray(v.claims) &&
    v.claims.every(c => isObj(c) && isStr(c.text) && (CLAIM_STATUSES as readonly unknown[]).includes(c.status) && Array.isArray(c.sourceIds)) &&
    Array.isArray(v.conflicts) &&
    isStrArr(v.missingInfo) &&
    isStrArr(v.followUps)
  )
}
