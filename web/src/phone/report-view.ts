// The full report on the phone: the answer up front, details one tap away.
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

function refs(ids: number[], sources: Source[]): string {
  return ids
    .map(id => sources.find(s => s.id === id))
    .filter((s): s is Source => !!s)
    .map(s => `<a class="ref" href="${safeHref(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${s.id}</a>`)
    .join('')
}

const unconfirmed = () => `<span class="label muted">${esc(CLAIM_LABELS.UNVERIFIED)}</span>`

export function productName(p: Product): string {
  const name = p.model || p.name
  // Software is often named after its maker ("Notion" by Notion): never repeat the brand.
  if (!p.brand || name.toLowerCase().startsWith(p.brand.toLowerCase())) return name || p.brand
  return `${p.brand} ${name}`
}

function isBest(p: Product, report: Report): boolean {
  const choice = (report.recommendation.choice ?? report.glasses.bestOption ?? '').toLowerCase()
  if (!choice) return false
  const key = (p.model || p.name).toLowerCase()
  return choice.includes(key) || key.includes(choice)
}

function compareTable(report: Report): string {
  const ps = report.products
  if (ps.length < 2) return ''
  const names: string[] = []
  for (const p of ps) for (const s of p.specs) if (!names.includes(s.name)) names.push(s.name)
  const best = ps.map(p => isBest(p, report))
  const cls = (i: number) => (best[i] ? ' class="best-col"' : '')
  const rows = names.slice(0, 12).map(name => {
    const cells = ps.map((p, i) => {
      const s = p.specs.find(x => x.name === name)
      if (!s) return `<td${cls(i)}><span class="muted">—</span></td>`
      return `<td${cls(i)}>${esc(s.value)}${s.confirmed ? refs(s.sourceIds, report.sources) : ` ${unconfirmed()}`}</td>`
    })
    return `<tr><th scope="row">${esc(name)}</th>${cells.join('')}</tr>`
  })
  const prices = ps.map((p, i) => {
    const low = [...p.prices].sort((a, b) => a.amount - b.amount)[0]
    return low
      ? `<td${cls(i)}>${esc(fmtMoney(low.amount, low.currency))}${refs([low.sourceId], report.sources)}<div class="small">${esc(low.shop)}</div></td>`
      : `<td${cls(i)}><span class="small">${esc(p.priceNote ?? '')}</span></td>`
  })
  return `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th></th>${ps.map((p, i) => `<th scope="col"${cls(i)}>${esc(productName(p))}${best[i] ? '<div class="small" style="color:var(--accent-text)">Best match</div>' : ''}</th>`).join('')}</tr></thead>
        <tbody><tr class="price"><th scope="row">Price</th>${prices.join('')}</tr>${rows.join('')}</tbody>
      </table></div>
    </div>`
}

function productDetail(p: Product, report: Report): string {
  const prices = p.prices.length
    ? p.prices
        .map(
          pr => `<div class="price-line"><div><span class="amount">${esc(fmtMoney(pr.amount, pr.currency))}</span>
            <span class="small"> · ${esc(PRICE_TYPE_LABELS[pr.priceType])}</span><div class="small">${esc(pr.shop)}, ${esc(pr.country)} · checked ${esc(fmtDate(pr.checkedAt))}</div></div>${refs([pr.sourceId], report.sources)}</div>`,
        )
        .join('')
    : `<p class="small">${esc(p.priceNote ?? '')}</p>`
  const specs = p.specs.length
    ? `<dl class="kv">${p.specs.map(s => `<dt>${esc(s.name)}</dt><dd>${esc(s.value)}${s.confirmed ? refs(s.sourceIds, report.sources) : ` ${unconfirmed()}`}</dd>`).join('')}</dl>`
    : ''
  const reviews = p.reviews.length
    ? `<p class="eyebrow" style="margin-top:14px">What reviewers say</p><ul class="dots">${p.reviews
        .map(r => `<li><span class="label muted">${esc(REVIEW_TYPE_LABELS[r.reviewType])}</span>${esc(r.summary)}${refs([r.sourceId], report.sources)}</li>`)
        .join('')}</ul>`
    : ''
  const goodBad =
    p.pros.length || p.cons.length
      ? `<div class="facts" style="margin-top:12px">
          ${p.pros.length ? `<div class="fact good"><p class="eyebrow">Good</p><ul class="dots">${p.pros.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          ${p.cons.length ? `<div class="fact bad"><p class="eyebrow">Watch out</p><ul class="dots">${p.cons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        </div>`
      : ''
  return `
    <div class="product">
      <h3>${esc(productName(p))} ${isBest(p, report) ? '<span class="pill best">Best match</span>' : ''}</h3>
      <p class="small" style="margin:0 0 8px">${esc([p.variant, p.region].filter(Boolean).join(' · '))}${p.url ? ` · <a href="${safeHref(p.url)}" target="_blank" rel="noopener">Product page</a>` : ''}</p>
      ${prices}
      ${specs}
      ${reviews}
      ${goodBad}
    </div>`
}

/** What changed since the earlier report: changes first, then what stayed the same. */
function changesHtml(report: Report): string {
  const list = report.changes
  if (!list?.length || !report.basedOn) return ''
  const changed = list.filter(c => !c.same)
  const same = list.filter(c => c.same)
  return `<section class="card" style="border-color:var(--accent-text)">
    <p class="eyebrow">What changed since ${esc(fmtDate(report.basedOn.createdAt))}</p>
    ${changed.length ? `<ul class="list">${changed.map(c => `<li><strong>${esc(c.text)}</strong></li>`).join('')}</ul>` : '<p style="margin:0"><strong>Nothing important changed.</strong></p>'}
    ${same.length ? `<ul class="dots" style="margin-top:10px;color:var(--text-2)">${same.map(c => `<li>${esc(c.text)}</li>`).join('')}</ul>` : ''}
  </section>`
}

export function reportHtml(job: JobView, report: Report, canSave = true): string {
  const rec = report.recommendation
  const e = report.evidence
  const checks = report.claims.length + report.conflicts.length
  const tabs = [
    { id: 'overview', name: 'Overview', count: null },
    report.products.length ? { id: 'compare', name: report.products.length > 1 ? 'Compare' : 'Details', count: report.products.length } : null,
    { id: 'checks', name: 'Checks', count: checks },
    { id: 'sources', name: 'Sources', count: report.sources.length },
  ].filter((t): t is { id: string; name: string; count: number | null } => t !== null)

  const overview = `
    <div class="card">
      <p class="eyebrow">${rec.noClearWinner ? 'No clear winner' : 'Our pick'}</p>
      ${rec.choice ? `<h2 style="margin-bottom:6px">${esc(rec.choice)}</h2>` : ''}
      <p style="margin:0;color:var(--text-2)">${esc(rec.why)}</p>
      ${rec.alternative ? `<p class="small" style="margin:10px 0 0">Also worth a look: <span style="color:var(--text)">${esc(rec.alternative)}</span></p>` : ''}
    </div>
    <div class="card"><p style="margin:0;color:var(--text-2)">${esc(report.summary)}</p></div>
    ${report.missingInfo.length ? `<div class="card"><p class="eyebrow">What we couldn't confirm</p><ul class="dots">${report.missingInfo.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    <form class="card" id="askmore">
      <p class="eyebrow">Ask more about this</p>
      ${report.followUps.length ? `<div class="chips" style="margin-bottom:12px">${report.followUps.map(f => `<button type="button" class="chip" data-followup="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : ''}
      <textarea id="more" rows="2" maxlength="1000" placeholder="For example: which one has the better keyboard?"></textarea>
      <div class="row" style="margin-top:10px;justify-content:space-between;align-items:center">
        <span class="small" id="moremsg">AskWise keeps this report in mind.</span>
        <button class="button primary" type="submit">Ask</button>
      </div>
    </form>
    <div class="card">
      <p class="eyebrow">Check again</p>
      <p style="margin:0 0 12px;color:var(--text-2)">Prices and details change. AskWise can research this question again and show you exactly what changed.</p>
      <button class="button ghost" id="checkagain" type="button">Check again</button> <span class="small" id="checkmsg"></span>
    </div>`

  const compare = report.products.length
    ? `${compareTable(report)}<div class="card">${report.products.map(p => productDetail(p, report)).join('')}</div>`
    : ''

  const checksPanel = `
    ${report.conflicts.length ? `<div class="card" style="border-color:var(--amber)"><p class="eyebrow" style="color:var(--amber-text)">Where sources disagree</p><ul class="list">${report.conflicts.map(c => `<li><strong>${esc(c.topic)}</strong><div style="color:var(--text-2)">${esc(c.details)}${refs(c.sourceIds, report.sources)}</div></li>`).join('')}</ul></div>` : ''}
    <div class="card">
      <ul class="list">${report.claims.map(c => `<li>${label(c.status)}<div style="margin-top:6px">${esc(c.text)}${refs(c.sourceIds, report.sources)}</div>${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}</li>`).join('')}</ul>
      <details><summary>What these labels mean</summary><ul class="list" style="margin-top:10px">${CLAIM_STATUSES.map(s => `<li>${label(s)} <span class="small">${esc(CLAIM_EXPLANATIONS[s])}</span></li>`).join('')}</ul></details>
    </div>`

  const sources = `
    <div class="card"><ol class="sources">${report.sources
      .map(s => `<li><span class="n">${s.id}</span><div><a href="${safeHref(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><div class="small">${esc(s.publisher)}</div></div></li>`)
      .join('')}</ol></div>`

  const panels: Record<string, string> = { overview, compare, checks: checksPanel, sources }

  return `
    <article class="stagger">
      <div style="margin:4px 0 14px">
        <p class="eyebrow">${esc(RESEARCH_TYPE_LABELS[report.researchType])} · ${esc(fmtDate(report.createdAt))}</p>
        <h1>${esc(report.title)}</h1>
        <p class="question">${esc(report.question)}</p>
        ${report.usedNotionPage ? `<p class="small" style="margin:6px 0 0">With your Notion page “${esc(report.usedNotionPage)}”</p>` : ''}
        ${report.basedOn ? `<p class="small" style="margin:6px 0 0">${report.basedOn.relation === 'recheck' ? 'Checked again from' : 'Follows up on'} <a href="#/report/${esc(report.basedOn.id)}">“${esc(report.basedOn.title)}”, ${esc(fmtDate(report.basedOn.createdAt))}</a></p>` : ''}
      </div>
      ${changesHtml(report)}

      <section class="card answer-card">
        <p class="eyebrow">The short answer</p>
        <p class="big">${esc(report.glasses.answer)}</p>
        <div class="facts">
          <div class="fact good"><p class="eyebrow">Why</p><p>${esc(report.glasses.reason || rec.why)}</p></div>
          <div class="fact bad"><p class="eyebrow">Watch out</p><p>${esc(report.glasses.drawback || rec.drawback)}</p></div>
        </div>
        <div class="meter ${e.strength}"><span class="bars"><i></i><i></i><i></i></span>
          <span>${esc(STRENGTH_LABELS[e.strength])} · ${e.sourceCount} sources${e.pricesCheckedAt ? ` · prices checked ${esc(fmtDate(e.pricesCheckedAt))}` : ''}</span></div>
      </section>

      <div>
        <div class="tabs" role="tablist">${tabs
          .map((t, i) => `<button role="tab" data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.name}${t.count ? ` <span class="count">${t.count}</span>` : ''}</button>`)
          .join('')}</div>
        ${tabs.map((t, i) => `<section class="panel ${i === 0 ? 'active' : ''}" data-panel="${t.id}">${panels[t.id]}</section>`).join('')}
      </div>
    </article>
    <div class="savebar"><div class="inner">${
      job.exported
        ? `<span class="small"><span class="saved-dot"></span>Saved to Notion</span><a class="button ghost" href="${safeHref(job.exported.url)}" target="_blank" rel="noopener">Open</a>`
        : canSave
          ? `<span class="small">Keep this report?</span><a class="button primary" href="#/save/${esc(job.id)}">Save to Notion</a>`
          : `<span class="small">Connect Notion to keep reports.</span><a class="button ghost" href="#/settings">Settings</a>`
    }</div></div>`
}
