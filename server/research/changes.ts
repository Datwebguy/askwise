// Compares an earlier report with a fresh check of the same question.
// Every change is read from the two real reports; nothing is guessed.
import type { Change, Price, Product, Report } from '../../shared/types.ts'

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const label = (p: Product) => (p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.name : `${p.brand} ${p.name}`).trim()

function money(pr: Price): string {
  const n = pr.amount.toLocaleString('en-US', { minimumFractionDigits: pr.amount % 1 ? 2 : 0, maximumFractionDigits: 2 })
  return `${n} ${pr.currency}`
}
function lowest(prices: Price[], currency?: string): Price | null {
  const list = currency ? prices.filter(p => p.currency === currency) : prices
  return list.length ? list.reduce((a, b) => (b.amount < a.amount ? b : a)) : null
}

const keyOf = (p: Product) => norm(label(p))

/** Finds the matching product: same brand and name, or one name containing the other. */
function match(p: Product, list: Product[]): Product | null {
  const k = keyOf(p)
  return list.find(q => keyOf(q) === k) ?? list.find(q => { const j = keyOf(q); return j.length > 3 && (j.includes(k) || k.includes(j)) }) ?? null
}

export function diffReports(before: Report, after: Report): Change[] {
  const out: Change[] = []

  // Best pick
  const a = before.recommendation, b = after.recommendation
  const pickA = a.noClearWinner ? null : a.choice, pickB = b.noClearWinner ? null : b.choice
  if (norm(pickA) === norm(pickB)) {
    out.push({ kind: 'pick', same: true, text: pickB ? `Best pick unchanged: ${pickB}` : 'Still no clear winner' })
  } else {
    out.push({ kind: 'pick', same: false, text: `Best pick changed: ${pickA ?? 'no clear winner'} → ${pickB ?? 'no clear winner'}` })
  }

  // Products, prices and specs
  for (const p of after.products) {
    const old = match(p, before.products)
    if (!old) { out.push({ kind: 'product', same: false, text: `New in this check: ${label(p)}` }); continue }
    const now = lowest(p.prices)
    const was = now ? lowest(old.prices, now.currency) : lowest(old.prices)
    if (now && was) {
      if (now.amount === was.amount) out.push({ kind: 'price', same: true, text: `${label(p)}: price unchanged at ${money(now)} (${now.shop})` })
      else out.push({ kind: 'price', same: false, text: `${label(p)}: ${money(was)} (${was.shop}) → ${money(now)} (${now.shop})` })
    } else if (now && !was) {
      out.push({ kind: 'price', same: false, text: `${label(p)}: price found this time, ${money(now)} (${now.shop})` })
    } else if (!now && was) {
      out.push({ kind: 'price', same: false, text: `${label(p)}: earlier price ${money(was)} (${was.shop}) could not be confirmed this time` })
    }
    for (const s of p.specs) {
      if (!s.confirmed) continue
      const o = old.specs.find(x => norm(x.name) === norm(s.name) && x.confirmed)
      if (o && norm(o.value) !== norm(s.value)) out.push({ kind: 'spec', same: false, text: `${label(p)} ${s.name.toLowerCase()}: ${o.value} → ${s.value}` })
    }
  }
  for (const p of before.products) {
    if (!match(p, after.products)) out.push({ kind: 'product', same: false, text: `Not in this check: ${label(p)}` })
  }

  // Evidence
  const ea = before.evidence, eb = after.evidence
  const conf = (e: Report['evidence']) => e.counts.VERIFIED + e.counts.CORROBORATED
  out.push({
    kind: 'evidence',
    same: ea.sourceCount === eb.sourceCount && conf(ea) === conf(eb),
    text: `Evidence: ${eb.sourceCount} sources and ${conf(eb)} confirmed facts (was ${ea.sourceCount} and ${conf(ea)})`,
  })
  return out
}
