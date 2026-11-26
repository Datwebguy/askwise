// AskWise's checking step. It enforces the evidence rules on whatever the
// model returned: only real sources from the web search count, unsupported
// claims are never marked as confirmed, and unconfirmed prices are removed.
import { CLAIM_STATUSES, PRICE_TYPES } from '../../shared/types.ts'
import type { Claim, ClaimStatus, EvidenceSummary, Product, Report, ResearchType, Source } from '../../shared/types.ts'
import { PRICE_UNCONFIRMED } from '../../shared/labels.ts'
import type { RawReport } from './schema.ts'
import { normaliseUrl } from './sources.ts'

export interface VerifyContext {
  question: string
  researchType: ResearchType
  sources: Source[]
  /** When the web search finished; recorded as the time prices were checked. */
  checkedAt: string
  usedNotionPage: string | null
  /** Sources the research notes cited directly. */
  citedIds?: number[]
}

const LIMITS = { answer: 90, bestOption: 40, reason: 110, drawback: 110, alternative: 40 }

/** Plain text for the glasses: no markdown, no emoji or symbols outside the basic planes, single spaces. */
export function glassesText(text: string | null | undefined, max: number): string {
  if (!text) return ''
  const clean = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

export function verifyReport(raw: RawReport, ctx: VerifyContext): Report {
  const validIds = new Set(ctx.sources.map(s => s.id))
  const publisherById = new Map(ctx.sources.map(s => [s.id, s.publisher]))
  const urls = new Set(ctx.sources.map(s => s.url))
  const keepIds = (ids: number[]) => [...new Set(ids.filter(id => Number.isInteger(id) && validIds.has(id)))]
  const keepId = (id: number | null) => (id !== null && validIds.has(id) ? id : null)

  const claims = raw.claims.map(c => checkClaim(c, keepIds(c.sourceIds), publisherById)).filter(c => c.text)

  const conflicts = raw.conflicts
    .map(c => ({ topic: plain(c.topic), details: plain(c.details), sourceIds: keepIds(c.sourceIds) }))
    .filter(c => c.topic && c.sourceIds.length > 0)

  const products: Product[] = raw.products.map(p => {
    const prices = p.prices
      .map(pr => ({ ...pr, sourceId: keepId(pr.sourceId), currency: plain(pr.currency).toUpperCase() }))
      .filter(
        pr =>
          pr.sourceId !== null &&
          typeof pr.amount === 'number' &&
          Number.isFinite(pr.amount) &&
          pr.amount > 0 &&
          /^[A-Z]{3}$/.test(pr.currency) &&
          plain(pr.shop) !== '' &&
          plain(pr.country) !== '' &&
          (PRICE_TYPES as readonly string[]).includes(pr.priceType),
      )
      .map(pr => ({
        amount: pr.amount as number,
        currency: pr.currency,
        country: plain(pr.country),
        shop: plain(pr.shop),
        priceType: pr.priceType,
        sourceId: pr.sourceId as number,
        checkedAt: ctx.checkedAt,
      }))
    const productUrl = p.url ? normaliseUrl(p.url) : null
    return {
      brand: plain(p.brand),
      name: plain(p.name),
      model: plain(p.model),
      variant: plain(p.variant),
      region: plain(p.region),
      url: productUrl && urls.has(productUrl) ? productUrl : null,
      specs: p.specs
        .map(s => {
          const ids = keepIds(s.sourceIds)
          return { name: plain(s.name), value: plain(s.value), sourceIds: ids, confirmed: ids.length > 0 }
        })
        .filter(s => s.name && s.value),
      prices,
      priceNote: prices.length ? null : PRICE_UNCONFIRMED,
      reviews: p.reviews
        .map(r => ({ summary: plain(r.summary), reviewType: r.reviewType, sourceId: keepId(r.sourceId) }))
        .filter((r): r is Product['reviews'][number] => r.sourceId !== null && r.summary !== ''),
      pros: p.pros.map(plain).filter(Boolean),
      cons: p.cons.map(plain).filter(Boolean),
    }
  })

  const sources = usedSources(ctx.sources, claims, conflicts, products, ctx.citedIds ?? [])
  const evidence = summariseEvidence(claims, sources.length, products)
  const rec = raw.recommendation

  return {
    researchType: ctx.researchType,
    title: plain(raw.title) || ctx.question.slice(0, 60),
    question: ctx.question,
    summary: plain(raw.summary),
    glasses: {
      answer: glassesText(raw.glasses.answer, LIMITS.answer),
      bestOption: rec.noClearWinner ? null : glassesText(raw.glasses.bestOption, LIMITS.bestOption) || null,
      reason: glassesText(raw.glasses.reason, LIMITS.reason),
      drawback: glassesText(raw.glasses.drawback, LIMITS.drawback),
      alternatives: raw.glasses.alternatives.map(a => glassesText(a, LIMITS.alternative)).filter(Boolean).slice(0, 3),
    },
    recommendation: {
      choice: rec.noClearWinner ? null : plain(rec.choice) || null,
      why: plain(rec.why),
      drawback: plain(rec.drawback),
      alternative: plain(rec.alternative) || null,
      noClearWinner: rec.noClearWinner,
    },
    products,
    claims,
    conflicts,
    missingInfo: raw.missingInfo.map(plain).filter(Boolean),
    followUps: raw.followUps.map(plain).filter(Boolean).slice(0, 3),
    sources,
    evidence,
    createdAt: ctx.checkedAt,
    usedNotionPage: ctx.usedNotionPage,
  }
}

/** Keeps only the sources the report refers to, so the list shows what was actually used. */
export function usedSources(all: Source[], claims: Claim[], conflicts: { sourceIds: number[] }[], products: Product[], citedIds: number[]): Source[] {
  const used = new Set<number>()
  claims.forEach(c => c.sourceIds.forEach(id => used.add(id)))
  conflicts.forEach(c => c.sourceIds.forEach(id => used.add(id)))
  for (const p of products) {
    p.specs.forEach(s => s.sourceIds.forEach(id => used.add(id)))
    p.prices.forEach(pr => used.add(pr.sourceId))
    p.reviews.forEach(r => used.add(r.sourceId))
    if (p.url) all.filter(s => s.url === p.url).forEach(s => used.add(s.id))
  }
  if (used.size === 0) citedIds.forEach(id => used.add(id))
  return all.filter(s => used.has(s.id))
}

/** Applies the label rules to one claim given only its real sources. */
export function checkClaim(
  c: { text: string; status: ClaimStatus; note: string },
  ids: number[],
  publisherById: Map<number, string>,
): Claim {
  const text = plain(c.text)
  const note = plain(c.note)
  let status: ClaimStatus = (CLAIM_STATUSES as readonly string[]).includes(c.status) ? c.status : 'UNVERIFIED'
  const publishers = new Set(ids.map(id => publisherById.get(id)).filter(Boolean))

  if (status === 'INFERRED') return { text, status, sourceIds: ids, note }
  if (ids.length === 0) return { text, status: 'UNVERIFIED', sourceIds: [], note }
  if (status === 'CORROBORATED' && publishers.size < 2) status = 'VERIFIED'
  if (status === 'CONFLICTING' && ids.length < 2) status = 'UNVERIFIED'
  return { text, status, sourceIds: ids, note }
}

export function summariseEvidence(claims: Claim[], sourceCount: number, products: Product[]): EvidenceSummary {
  const counts = Object.fromEntries(CLAIM_STATUSES.map(s => [s, 0])) as Record<ClaimStatus, number>
  for (const c of claims) counts[c.status] += 1
  const factual = claims.filter(c => c.status !== 'INFERRED').length
  const supported = counts.VERIFIED + counts.CORROBORATED
  const ratio = factual ? supported / factual : 0
  let strength: EvidenceSummary['strength'] = 'mixed'
  if (sourceCount < 2 || ratio < 0.34) strength = 'weak'
  else if (ratio >= 0.7 && counts.CONFLICTING === 0 && sourceCount >= 3) strength = 'strong'
  const priceTimes = products.flatMap(p => p.prices.map(pr => pr.checkedAt))
  return { sourceCount, counts, strength, pricesCheckedAt: priceTimes[0] ?? null }
}

/** A finished report needs a closer look when the evidence is weak or sources disagree. */
export function needsReview(report: Report): boolean {
  return report.evidence.strength === 'weak' || report.conflicts.length > 0 || report.evidence.counts.CONFLICTING > 0
}
