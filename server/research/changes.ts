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

const FILLER = new Set(['the', 'and', 'with', 'inch', 'in', 'model', 'edition'])
/** The meaningful parts of a name: "MacBook Air M4 (13-inch)" and "MacBook Air (13-inch, M4, 2025)" give the same parts. */
const parts = (s: string | null | undefined) => new Set(norm(s).split(' ').filter(w => w && !FILLER.has(w) && !/^(19|20)\d\d$/.test(w)))
/** Same item when the parts of one name all appear in the other. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parts(a), y = parts(b)
  if (!x.size || !y.size) return x.size === y.size
  const [small, big] = x.size <= y.size ? [x, y] : [y, x]
  return [...small].every(w => big.has(w))
}

/** Finds the matching product by name. */
function match(p: Product, list: Product[]): Product | null {
  return list.find(q => sameName(label(q), label(p))) ?? list.find(q => sameName(q.name, p.name)) ?? null
}

/** Number-and-unit pairs in a value, for example "1.21 kg (2.67 lb)" gives kg 1.21 and lb 2.67. */
function measures(v: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const [, n, u] of v.toLowerCase().replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*([a-z"%]+)?/g)) {
    const unit = u ?? ''
    if (!m.has(unit)) m.set(unit, Number(n))
  }
  return m
}

/**
 * A specification counts as changed only when both values give a number in the same unit
 * and those numbers really differ (more than rounding). Rewording is never a change.
 */
export function specChanged(before: string, after: string): boolean {
  const a = measures(before), b = measures(after)
  for (const [unit, x] of a) {
    const y = b.get(unit)
    if (y === undefined || !unit) continue
    return Math.abs(x - y) > Math.max(Math.abs(x), Math.abs(y)) * 0.03
  }
  return false
}

export function diffReports(before: Report, after: Report): Change[] {
  const out: Change[] = []

  // Best pick
  const a = before.recommendation, b = after.recommendation
  const pickA = a.noClearWinner ? null : a.choice, pickB = b.noClearWinner ? null : b.choice
  if (sameName(pickA, pickB)) {
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
      else out.push({ kind: 'price', same: false, text: `${label(p)}: lowest price found ${money(was)} (${was.shop}) → ${money(now)} (${now.shop})` })
    } else if (now && !was) {
      out.push({ kind: 'price', same: false, text: `${label(p)}: price found this time, ${money(now)} (${now.shop})` })
    } else if (!now && was) {
      out.push({ kind: 'price', same: false, text: `${label(p)}: earlier price ${money(was)} (${was.shop}) could not be confirmed this time` })
    }
    for (const s of p.specs) {
      if (!s.confirmed) continue
      const o = old.specs.find(x => norm(x.name) === norm(s.name) && x.confirmed)
      if (o && specChanged(o.value, s.value)) out.push({ kind: 'spec', same: false, text: `${label(p)} ${s.name.toLowerCase()}: ${o.value} → ${s.value}` })
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
