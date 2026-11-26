// The full research report on the phone.
import {
  CLAIM_EXPLANATIONS,
  CLAIM_LABELS,
  PRICE_TYPE_LABELS,
  RESEARCH_TYPE_LABELS,
  REVIEW_TYPE_LABELS,
  STRENGTH_LABELS,
} from '../../../shared/labels.ts'
import { CLAIM_STATUSES } from '../../../shared/types.ts'
import type { ClaimStatus, JobView, Product, Report, Source } from '../../../shared/types.ts'
import { esc, fmtDate, fmtMoney, safeHref } from './dom.ts'

const LABEL_CLASS: Record<ClaimStatus, string> = {
  VERIFIED: 'ok',
  CORROBORATED: 'ok',
  CONFLICTING: 'warn',
  UNVERIFIED: 'muted',
  OUTDATED: 'warn',
  INFERRED: 'info',
}

export function label(status: ClaimStatus): string {
  return `<span class="label ${LABEL_CLASS[status]}">${esc(CLAIM_LABELS[status])}</span>`
}

function sourceRefs(ids: number[], sources: Source[]): string {
  if (!ids.length) return ''
  const links = ids
    .map(id => sources.find(s => s.id === id))
    .filter((s): s is Source => !!s)
    .map(s => `<a class="ref" href="${safeHref(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${s.id}</a>`)
  return links.length ? `<span class="refs">${links.join('')}</span>` : ''
}

function productName(p: Product): string {
  return [p.brand, p.model || p.name, p.variant].filter(Boolean).join(' ')
}

function comparisonTable(report: Report): string {
  if (report.products.length < 2) return ''
  const names: string[] = []
  for (const p of report.products) for (const s of p.specs) if (!names.includes(s.name)) names.push(s.name)
  const rows = names.slice(0, 14).map(name => {
    const cells = report.products.map(p => {
      const s = p.specs.find(x => x.name === name)
      if (!s) return '<td class="muted">Not found</td>'
      return `<td>${esc(s.value)}${s.confirmed ? sourceRefs(s.sourceIds, report.sources) : ` <span class="label muted">${esc(CLAIM_LABELS.UNVERIFIED)}</span>`}</td>`
    })
    return `<tr><th scope="row">${esc(name)}</th>${cells.join('')}</tr>`
  })
  const priceCells = report.products.map(p => {
    const best = [...p.prices].sort((a, b) => a.amount - b.amount)[0]
    return best
      ? `<td>${esc(fmtMoney(best.amount, best.currency))}<div class="small">${esc(best.shop)}, ${esc(best.country)}</div>${sourceRefs([best.sourceId], report.sources)}</td>`
      : `<td class="muted">${esc(p.priceNote ?? '')}</td>`
  })
  rows.push(`<tr><th scope="row">Price</th>${priceCells.join('')}</tr>`)
  return `
    <section class="card">
      <h2>Comparison</h2>
      <div class="table-wrap"><table>
        <thead><tr><th></th>${report.products.map(p => `<th scope="col">${esc(productName(p))}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table></div>
    </section>`
}

function productCard(p: Product, report: Report): string {
  const prices = p.prices.length
    ? `<ul class="plain">${p.prices
        .map(
          pr => `<li><strong>${esc(fmtMoney(pr.amount, pr.currency))}</strong> · ${esc(PRICE_TYPE_LABELS[pr.priceType])}
            <div class="small">${esc(pr.shop)}, ${esc(pr.country)} · checked ${esc(fmtDate(pr.checkedAt))}${sourceRefs([pr.sourceId], report.sources)}</div></li>`,
        )
        .join('')}</ul>`
    : `<p class="muted">${esc(p.priceNote ?? '')}</p>`
  const specs = p.specs.length
    ? `<dl class="specs">${p.specs
        .map(
          s => `<dt>${esc(s.name)}</dt><dd>${esc(s.value)} ${s.confirmed ? sourceRefs(s.sourceIds, report.sources) : `<span class="label muted">${esc(CLAIM_LABELS.UNVERIFIED)}</span>`}</dd>`,
        )
        .join('')}</dl>`
    : ''
  const reviews = p.reviews.length
    ? `<h4>Reviews</h4><ul class="plain">${p.reviews
        .map(r => `<li><span class="tag">${esc(REVIEW_TYPE_LABELS[r.reviewType])}</span> ${esc(r.summary)}${sourceRefs([r.sourceId], report.sources)}</li>`)
        .join('')}</ul>`
    : ''
  const list = (title: string, items: string[]) => (items.length ? `<h4>${title}</h4><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '')
  return `
    <section class="card product">
      <h3>${esc(productName(p))}</h3>
      ${p.region ? `<p class="small">Region: ${esc(p.region)}</p>` : ''}
      ${p.url ? `<p class="small"><a href="${safeHref(p.url)}" target="_blank" rel="noopener">Product page</a></p>` : ''}
      <h4>Prices</h4>${prices}
      ${specs ? `<h4>Specifications</h4>${specs}` : ''}
      ${reviews}
      ${list('Good', p.pros)}
      ${list('Watch out', p.cons)}
    </section>`
}

export function reportHtml(job: JobView, report: Report, notionReady: boolean): string {
  const rec = report.recommendation
  const e = report.evidence
  const claims = report.claims
    .map(c => `<li>${label(c.status)} ${esc(c.text)}${sourceRefs(c.sourceIds, report.sources)}${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}</li>`)
    .join('')
  const conflicts = report.conflicts
    .map(c => `<li><strong>${esc(c.topic)}</strong>: ${esc(c.details)}${sourceRefs(c.sourceIds, report.sources)}</li>`)
    .join('')
  const legend = CLAIM_STATUSES.map(s => `<li>${label(s)} ${esc(CLAIM_EXPLANATIONS[s])}</li>`).join('')
  const saved = job.exported
    ? `<p class="saved">Saved to Notion on ${esc(fmtDate(job.exported.at))}. <a href="${safeHref(job.exported.url)}" target="_blank" rel="noopener">Open in Notion</a></p>`
    : ''

  return `
    <article class="report">
      <p class="eyebrow">${esc(RESEARCH_TYPE_LABELS[report.researchType])} · ${esc(fmtDate(report.createdAt))}</p>
      <h1>${esc(report.title)}</h1>
      <p class="question">“${esc(report.question)}”</p>
      ${report.usedNotionPage ? `<p class="small">Used your Notion page: ${esc(report.usedNotionPage)}</p>` : ''}

      <section class="card answer">
        <h2>Answer</h2>
        <p class="big">${esc(report.glasses.answer)}</p>
        <p>${esc(report.summary)}</p>
        <p><span class="strength ${e.strength}">${esc(STRENGTH_LABELS[e.strength])}</span> <span class="small">${e.sourceCount} sources</span></p>
      </section>

      <section class="card">
        <h2>Recommendation</h2>
        ${rec.noClearWinner ? '<p><strong>No clear winner.</strong></p>' : rec.choice ? `<p class="big">${esc(rec.choice)}</p>` : ''}
        <p>${esc(rec.why)}</p>
        ${rec.drawback ? `<p><strong>Main drawback:</strong> ${esc(rec.drawback)}</p>` : ''}
        ${rec.alternative ? `<p><strong>Best alternative:</strong> ${esc(rec.alternative)}</p>` : ''}
      </section>

      ${comparisonTable(report)}
      ${report.products.map(p => productCard(p, report)).join('')}

      ${claims ? `<section class="card"><h2>What AskWise checked</h2><ul class="claims">${claims}</ul>
        <details><summary>What the labels mean</summary><ul class="plain">${legend}</ul></details></section>` : ''}

      ${conflicts ? `<section class="card warn-card"><h2>Where sources disagree</h2><ul>${conflicts}</ul></section>` : ''}

      ${report.missingInfo.length ? `<section class="card"><h2>Still missing</h2><ul>${report.missingInfo.map(m => `<li>${esc(m)}</li>`).join('')}</ul></section>` : ''}

      ${report.followUps.length ? `<section class="card"><h2>Ask next</h2><div class="chips">${report.followUps.map(f => `<button class="chip" data-followup="${esc(f)}">${esc(f)}</button>`).join('')}</div></section>` : ''}

      <section class="card">
        <h2>Sources</h2>
        <ol class="sources">${report.sources.map(s => `<li value="${s.id}"><a href="${safeHref(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="small">${esc(s.publisher)}</span></li>`).join('')}</ol>
      </section>

      <section class="card save">
        ${saved}
        ${notionReady ? `<a class="button primary" href="#/save/${esc(job.id)}">${job.exported ? 'Review save again' : 'Save to Notion'}</a>` : `<p class="small">Connect Notion in <a href="#/settings">Settings</a> to save reports.</p>`}
      </section>
    </article>`
}
