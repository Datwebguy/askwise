// Turns a checked report into the exact lines saved to Notion. The same lines
// are shown in the phone preview, so what the person approves is what is written.
import { CLAIM_LABELS, PRICE_TYPE_LABELS, RESEARCH_TYPE_LABELS } from '../../shared/labels.ts'
import type { ExportPreview, Report } from '../../shared/types.ts'
import type { NotionBlock } from './client.ts'

export type ExportLine = ExportPreview['lines'][number]

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'

const fmtAmount = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

export function reportPageTitle(report: Report): string {
  return `AskWise: ${report.title}`.slice(0, 200)
}

export function reportLines(report: Report): ExportLine[] {
  const out: ExportLine[] = []
  const h = (text: string) => out.push({ kind: 'heading', text })
  const p = (text: string) => text && out.push({ kind: 'paragraph', text })
  const b = (text: string) => text && out.push({ kind: 'bullet', text })
  const srcs = (ids: number[]) => (ids.length ? ` (sources ${ids.join(', ')})` : '')

  p(`Question: ${report.question}`)
  p(`${RESEARCH_TYPE_LABELS[report.researchType]}, researched ${fmtDate(report.createdAt)}.`)
  if (report.usedNotionPage) p(`Used your Notion page: ${report.usedNotionPage}`)

  h('Answer')
  p(report.glasses.answer)
  p(report.summary)

  h('Recommendation')
  const rec = report.recommendation
  if (rec.noClearWinner) p('No clear winner.')
  else if (rec.choice) p(`Best match: ${rec.choice}`)
  p(rec.why)
  if (rec.drawback) p(`Main drawback: ${rec.drawback}`)
  if (rec.alternative) p(`Best alternative: ${rec.alternative}`)

  if (report.products.length) {
    h('Products compared')
    for (const prod of report.products) {
      const name = [prod.brand, prod.model || prod.name, prod.variant].filter(Boolean).join(' ')
      p(`${name}${prod.region ? ` (${prod.region})` : ''}`)
      for (const s of prod.specs) b(`${s.name}: ${s.value}${s.confirmed ? srcs(s.sourceIds) : ' (not confirmed yet)'}`)
      for (const pr of prod.prices) {
        b(
          `${PRICE_TYPE_LABELS[pr.priceType]}: ${fmtAmount(pr.amount)} ${pr.currency} at ${pr.shop}, ${pr.country}. Checked ${fmtDate(pr.checkedAt)}${srcs([pr.sourceId])}`,
        )
      }
      if (prod.priceNote) b(`Price: ${prod.priceNote}`)
      for (const pro of prod.pros) b(`Good: ${pro}`)
      for (const con of prod.cons) b(`Watch out: ${con}`)
    }
  }

  if (report.claims.length) {
    h('What AskWise checked')
    for (const c of report.claims) b(`${CLAIM_LABELS[c.status]}: ${c.text}${srcs(c.sourceIds)}`)
  }

  if (report.conflicts.length) {
    h('Where sources disagree')
    for (const c of report.conflicts) b(`${c.topic}: ${c.details}${srcs(c.sourceIds)}`)
  }

  if (report.missingInfo.length) {
    h('Still missing')
    for (const m of report.missingInfo) b(m)
  }

  h('Sources')
  for (const s of report.sources) out.push({ kind: 'link', text: `[${s.id}] ${s.title}`, url: s.url })

  return out
}

function rich(text: string, url?: string) {
  const chunks: { type: 'text'; text: { content: string; link: { url: string } | null } }[] = []
  for (let i = 0; i < text.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: text.slice(i, i + 1900), link: url ? { url } : null } })
  }
  return chunks.slice(0, 10)
}

export function toNotionBlocks(lines: ExportLine[]): NotionBlock[] {
  return lines.map(line => {
    switch (line.kind) {
      case 'heading':
        return { object: 'block', type: 'heading_2', heading_2: { rich_text: rich(line.text) } }
      case 'bullet':
        return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(line.text) } }
      case 'link':
        return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(line.text, line.url) } }
      default:
        return { object: 'block', type: 'paragraph', paragraph: { rich_text: rich(line.text) } }
    }
  })
}
