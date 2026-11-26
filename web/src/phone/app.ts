// The phone experience: ask, follow progress, read the full report, approve
// saving to Notion, see earlier research and manage settings.
import { MESSAGES, STAGE_LABELS, STATUS_LABELS, RESEARCH_TYPE_LABELS } from '../../../shared/labels.ts'
import { ACTIVE_STATUSES } from '../../../shared/types.ts'
import type { JobView, NotionPageChoice } from '../../../shared/types.ts'
import { api, getToken, newRequestKey, setToken } from '../api.ts'
import type { Me } from '../api.ts'
import { tracker } from '../tracker.ts'
import { $, esc, fmtDate, on, safeHref } from './dom.ts'
import { reportHtml } from './report-view.ts'

const STAGES = ['understanding', 'searching', 'organising', 'checking', 'writing'] as const

let me: Me | null = null
let draftQuestion = ''

function friendly(e: unknown): string {
  return e instanceof Error && e.message ? e.message : MESSAGES.retry
}

function shell(active: string, content: string): string {
  const tab = (href: string, name: string, text: string) =>
    `<a href="${href}" class="${active === name ? 'active' : ''}">${text}</a>`
  return `
    <header class="top"><a href="#/" class="brand">AskWise</a></header>
    <main id="view">${content}</main>
    <nav class="tabs">${tab('#/', 'ask', 'Ask')}${tab('#/history', 'history', 'History')}${tab('#/settings', 'settings', 'Settings')}</nav>`
}

function notice(text: string, kind: 'info' | 'warn' = 'info'): string {
  return `<p class="notice ${kind}" role="status">${esc(text)}</p>`
}

// ---- Sign in -----------------------------------------------------------
function renderSignIn(root: HTMLElement, message = ''): void {
  root.innerHTML = `
    <main class="center">
      <h1 class="brand-big">AskWise</h1>
      <p class="lead">Research anything. Compare your options. Know what to choose.</p>
      <form id="signin" class="card">
        <label for="code">Your sign-in code</label>
        <input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" required minlength="6" maxlength="40" />
        <button class="primary" type="submit">Sign in</button>
        <p id="msg" class="small">${esc(message)}</p>
      </form>
    </main>`
  $(root, '#signin').addEventListener('submit', async e => {
    e.preventDefault()
    const code = ($(root, '#code') as HTMLInputElement).value
    $(root, '#msg').textContent = 'Signing in…'
    try {
      const { token } = await api.signIn(code)
      setToken(token)
      location.hash = '#/'
    } catch (err) {
      $(root, '#msg').textContent = friendly(err)
    }
  })
}

// ---- Ask and progress --------------------------------------------------
function progressCard(job: JobView): string {
  if (ACTIVE_STATUSES.includes(job.status)) {
    const current = job.stage ? STAGES.indexOf(job.stage) : -1
    return `
      <section class="card progress" aria-live="polite">
        <p class="eyebrow">Researching</p>
        <p class="question">“${esc(job.question)}”</p>
        <ol class="steps">${STAGES.map(
          (s, i) => `<li class="${i < current ? 'done' : i === current ? 'now' : ''}">${esc(STAGE_LABELS[s])}</li>`,
        ).join('')}</ol>
        <button id="cancel" class="ghost">Stop research</button>
      </section>`
  }
  if (job.status === 'NEEDS_CLARIFICATION') {
    return `
      <section class="card">
        <p class="eyebrow">One quick question</p>
        <p class="question">“${esc(job.question)}”</p>
        <form id="clarify">
          <label for="clar">${esc(job.clarifyingQuestion ?? '')}</label>
          <input id="clar" required maxlength="500" />
          <button class="primary" type="submit">Continue</button>
          <button id="skip" class="ghost" type="button">Research without it</button>
        </form>
      </section>`
  }
  if (job.status === 'FAILED' || job.status === 'CANCELLED') {
    return `<section class="card"><p class="question">“${esc(job.question)}”</p>${notice(job.message ?? MESSAGES.retry, 'warn')}
      <button id="again" class="primary">Ask again</button></section>`
  }
  if (job.hasReport) {
    return `<section class="card"><p class="eyebrow">Latest answer${job.researchType ? ` · ${esc(RESEARCH_TYPE_LABELS[job.researchType])}` : ''}</p>
      <p class="big">${esc(job.title ?? job.question)}</p>
      <a class="button primary" href="#/report/${esc(job.id)}">Open full report</a></section>`
  }
  return ''
}

function renderAsk(root: HTMLElement): void {
  const readPage = me?.notion.readPage
  const job = tracker.state.job
  root.innerHTML = shell(
    'ask',
    `
    ${!me?.researchAvailable ? notice('Research is being set up. Please check back soon.', 'warn') : ''}
    ${tracker.state.offline ? notice(MESSAGES.offline, 'warn') : ''}
    <form id="ask" class="card">
      <label for="q">What do you want to research?</label>
      <textarea id="q" rows="4" maxlength="1000" required>${esc(draftQuestion)}</textarea>
      <p class="small">Try a product comparison with your needs and budget, or any topic you want explained.</p>
      ${
        readPage
          ? `<label class="check"><input type="checkbox" id="useNotion" /> Use my Notion page “${esc(readPage.title)}”</label>`
          : ''
      }
      <button class="primary" type="submit" ${me?.researchAvailable ? '' : 'disabled'}>Research</button>
      <p id="askmsg" class="small" role="status"></p>
    </form>
    <div id="current">${job ? progressCard(job) : ''}</div>`,
  )

  $(root, '#q').addEventListener('input', e => (draftQuestion = (e.target as HTMLTextAreaElement).value))
  $(root, '#ask').addEventListener('submit', async e => {
    e.preventDefault()
    const button = root.querySelector<HTMLButtonElement>('#ask button[type=submit]')!
    button.disabled = true
    $(root, '#askmsg').textContent = 'Starting…'
    try {
      const useNotion = root.querySelector<HTMLInputElement>('#useNotion')?.checked ?? false
      const { job: started } = await api.ask(draftQuestion, useNotion, newRequestKey())
      draftQuestion = ''
      tracker.follow(started)
    } catch (err) {
      $(root, '#askmsg').textContent = friendly(err)
      button.disabled = false
    }
  })
  bindProgress(root)
}

function bindProgress(root: HTMLElement): void {
  const job = tracker.state.job
  if (!job) return
  root.querySelector('#cancel')?.addEventListener('click', async () => {
    try {
      tracker.follow((await api.cancel(job.id)).job)
    } catch (err) {
      alert(friendly(err))
    }
  })
  root.querySelector('#clarify')?.addEventListener('submit', async e => {
    e.preventDefault()
    try {
      tracker.follow((await api.clarify(job.id, ($(root, '#clar') as HTMLInputElement).value)).job)
    } catch (err) {
      alert(friendly(err))
    }
  })
  root.querySelector('#skip')?.addEventListener('click', async () => {
    try {
      tracker.follow((await api.skipClarify(job.id)).job)
    } catch (err) {
      alert(friendly(err))
    }
  })
  root.querySelector('#again')?.addEventListener('click', () => {
    draftQuestion = job.question
    renderAsk(root)
  })
}

// ---- Report ------------------------------------------------------------
async function renderReport(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = shell('history', '<p class="small">Opening report…</p>')
  try {
    const { job, report } = await api.report(id)
    const ready = !!me?.notion.connected && !!me.notion.destinationPage && !me.notion.needsReconnect
    $(root, '#view').innerHTML = reportHtml(job, report, ready)
    on(root, '[data-followup]', 'click', (_e, el) => {
      draftQuestion = el.dataset.followup ?? ''
      location.hash = '#/'
    })
  } catch (err) {
    $(root, '#view').innerHTML = notice(friendly(err), 'warn')
  }
}

// ---- Save to Notion ----------------------------------------------------
async function renderSave(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = shell('history', '<p class="small">Preparing what will be saved…</p>')
  const view = $(root, '#view')
  try {
    const { preview } = await api.exportPreview(id)
    const lines = preview.lines
      .map(l => {
        if (l.kind === 'heading') return `<h3>${esc(l.text)}</h3>`
        if (l.kind === 'bullet') return `<li>${esc(l.text)}</li>`
        if (l.kind === 'link') return `<li><a href="${safeHref(l.url ?? '')}" target="_blank" rel="noopener">${esc(l.text)}</a></li>`
        return `<p>${esc(l.text)}</p>`
      })
      .join('')
    view.innerHTML = `
      <section class="card">
        <h1>Save to Notion</h1>
        ${preview.alreadySaved ? notice(`Already saved on ${fmtDate(preview.alreadySaved.at)}. Approving again will not make a copy.`) : ''}
        <dl class="specs">
          <dt>Where</dt><dd>Inside your Notion page “${esc(preview.destination.title)}”</dd>
          <dt>What happens</dt><dd>AskWise creates one new page called “${esc(preview.pageTitle)}”</dd>
        </dl>
        ${preview.privateInfo.map(p => notice(p, 'warn')).join('')}
      </section>
      <section class="card preview">
        <p class="eyebrow">Exactly what will be saved</p>
        <h2>${esc(preview.pageTitle)}</h2>
        <div class="preview-body">${lines.replace(/(<li>.*?<\/li>)+/g, m => `<ul>${m}</ul>`)}</div>
      </section>
      <section class="card">
        <label class="check"><input type="checkbox" id="confirm" /> I have checked this report and want to save it to Notion.</label>
        <button id="approve" class="primary" disabled>Save to Notion</button>
        <button id="reject" class="ghost">Don't save</button>
        <p id="savemsg" role="status"></p>
      </section>`
    const confirm = $(view, '#confirm') as HTMLInputElement
    const approve = $(view, '#approve') as HTMLButtonElement
    confirm.addEventListener('change', () => (approve.disabled = !confirm.checked))
    approve.addEventListener('click', async () => {
      approve.disabled = true
      $(view, '#savemsg').textContent = 'Saving…'
      try {
        const res = await api.approveExport(id, preview.previewId, preview.contentHash)
        $(view, '#savemsg').innerHTML = `${res.repeated ? 'This report was already saved, so no copy was made.' : 'Saved to Notion.'} <a href="${safeHref(res.url)}" target="_blank" rel="noopener">Open in Notion</a>`
        void tracker.refresh()
      } catch (err) {
        $(view, '#savemsg').textContent = friendly(err)
        approve.disabled = !confirm.checked
      }
    })
    $(view, '#reject').addEventListener('click', async () => {
      try {
        await api.rejectExport(id, preview.previewId)
      } finally {
        location.hash = `#/report/${id}`
      }
    })
  } catch (err) {
    view.innerHTML = notice(friendly(err), 'warn') + `<p><a href="#/report/${esc(id)}">Back to the report</a> · <a href="#/settings">Settings</a></p>`
  }
}

// ---- History -----------------------------------------------------------
async function renderHistory(root: HTMLElement): Promise<void> {
  root.innerHTML = shell('history', '<p class="small">Loading…</p>')
  try {
    const { jobs } = await api.jobs()
    $(root, '#view').innerHTML = jobs.length
      ? `<h1>Your research</h1><ul class="history">${jobs
          .map(
            j => `<li><a href="${j.hasReport ? `#/report/${esc(j.id)}` : '#/'}" data-job="${esc(j.id)}">
              <span class="big">${esc(j.title ?? j.question)}</span>
              <span class="small">${esc(fmtDate(j.createdAt))} · ${esc(STATUS_LABELS[j.status])}${j.exported ? ' · in Notion' : ''}</span></a></li>`,
          )
          .join('')}</ul>`
      : '<h1>Your research</h1><p>Your questions and reports will appear here.</p>'
    on(root, '[data-job]', 'click', (_e, el) => {
      const job = jobs.find(j => j.id === el.dataset.job)
      if (job && !job.hasReport) tracker.follow(job)
    })
  } catch (err) {
    $(root, '#view').innerHTML = notice(friendly(err), 'warn')
  }
}

// ---- Settings ----------------------------------------------------------
async function renderSettings(root: HTMLElement, message = ''): Promise<void> {
  root.innerHTML = shell('settings', '<p class="small">Loading…</p>')
  const view = $(root, '#view')
  try {
    me = await api.me()
  } catch (err) {
    view.innerHTML = notice(friendly(err), 'warn')
    return
  }
  const n = me.notion
  let pages: NotionPageChoice[] = []
  let pagesMessage = ''
  if (n.connected && !n.needsReconnect) {
    try {
      pages = (await api.notionPages()).pages
    } catch (err) {
      pagesMessage = friendly(err)
      me = await api.me()
    }
  }
  const options = (selected: string | null) =>
    `<option value="">None</option>${pages.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}`

  const notionSection = !me.notionAvailable
    ? '<p>Notion is being set up for AskWise.</p>'
    : !n.connected
      ? `<p>Connect Notion so AskWise can read a page you choose and save reports you approve.</p>
         <p class="small">AskWise only sees the pages you share with the AskWise connection in Notion.</p>
         <button id="connect" class="primary">Connect Notion</button>`
      : me.notion.needsReconnect
        ? `${notice(MESSAGES.notionReconnect, 'warn')}<button id="connect" class="primary">Connect again</button>
           <button id="disconnect" class="ghost">Disconnect</button>`
        : `<p>Connected to <strong>${esc(n.workspaceName ?? 'Notion')}</strong>.</p>
           ${pagesMessage ? notice(pagesMessage, 'warn') : ''}
           <form id="pages">
             <label for="readPage">Page AskWise may read for your research</label>
             <select id="readPage">${options(n.readPage?.id ?? null)}</select>
             <label for="destPage">Save approved reports inside</label>
             <select id="destPage">${options(n.destinationPage?.id ?? null)}</select>
             <button class="primary" type="submit">Save choices</button>
           </form>
           <p class="small">Only pages you shared with AskWise in Notion are listed.</p>
           <button id="disconnect" class="ghost">Disconnect Notion</button>`

  view.innerHTML = `
    <h1>Settings</h1>
    ${message ? notice(message) : ''}
    <section class="card">
      <h2>Prices</h2>
      <form id="prefs">
        <label for="country">Country you shop in</label>
        <input id="country" maxlength="56" value="${esc(me.settings.country ?? '')}" />
        <label for="currency">Currency (3 letters, for example USD)</label>
        <input id="currency" maxlength="3" value="${esc(me.settings.currency ?? '')}" />
        <button class="primary" type="submit">Save</button>
      </form>
    </section>
    <section class="card"><h2>Notion</h2>${notionSection}</section>
    <section class="card">
      <h2>Your data</h2>
      <p class="small">AskWise keeps your questions, reports and save history until you delete them.</p>
      <button id="signout" class="ghost">Sign out</button>
      <button id="delete" class="danger">Delete all my data</button>
    </section>`

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      await renderSettings(root, done)
    } catch (err) {
      await renderSettings(root, friendly(err))
    }
  }
  root.querySelector('#prefs')?.addEventListener('submit', e => {
    e.preventDefault()
    const country = ($(view, '#country') as HTMLInputElement).value.trim() || null
    const currency = ($(view, '#currency') as HTMLInputElement).value.trim().toUpperCase() || null
    void run(() => api.saveSettings({ country, currency }), 'Saved.')
  })
  root.querySelector('#connect')?.addEventListener('click', () => void run(() => api.connectNotion(), 'Notion is connected.'))
  root.querySelector('#disconnect')?.addEventListener('click', () => {
    if (confirm('Disconnect Notion? AskWise will stop reading and saving pages.')) {
      void run(() => api.disconnectNotion(), 'Notion is disconnected.')
    }
  })
  root.querySelector('#pages')?.addEventListener('submit', e => {
    e.preventDefault()
    const read = ($(view, '#readPage') as HTMLSelectElement).value || null
    const dest = ($(view, '#destPage') as HTMLSelectElement).value || null
    void run(() => api.chooseNotionPages(read, dest), 'Your Notion pages are saved.')
  })
  root.querySelector('#signout')?.addEventListener('click', async () => {
    await api.signOut().catch(() => undefined)
    setToken(null)
    location.hash = '#/'
  })
  root.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm('Delete all your AskWise research, settings and connections? This cannot be undone.')) return
    try {
      await api.deleteEverything()
      setToken(null)
      location.hash = '#/'
    } catch (err) {
      alert(friendly(err))
    }
  })
}

// ---- Router ------------------------------------------------------------
export async function route(root: HTMLElement): Promise<void> {
  if (!getToken()) return renderSignIn(root)
  if (!me) {
    try {
      me = await api.me()
    } catch (err) {
      if (!getToken()) return renderSignIn(root, friendly(err))
    }
  }
  const hash = location.hash.replace(/^#/, '') || '/'
  const [, section, id] = hash.split('/')
  if (section === 'report' && id) return renderReport(root, id)
  if (section === 'save' && id) return renderSave(root, id)
  if (section === 'history') return renderHistory(root)
  if (section === 'settings') return renderSettings(root)
  return renderAsk(root)
}

export function startPhone(root: HTMLElement): void {
  window.addEventListener('hashchange', () => void route(root))
  let lastKey = ''
  tracker.subscribe(s => {
    // Only the ask page shows live progress; refresh it when the research state changes.
    const key = `${s.signedIn}:${s.job?.id}:${s.job?.status}:${s.job?.stage}:${s.offline}`
    if (key === lastKey) return
    lastKey = key
    const onAsk = (location.hash.replace(/^#/, '') || '/') === '/'
    if (onAsk && getToken()) {
      const current = root.querySelector('#current')
      if (current && s.job) {
        current.innerHTML = progressCard(s.job)
        bindProgress(root)
      } else if (!current) void route(root)
    }
  })
  void route(root)
}

export function resetPhoneSession(): void {
  me = null
}
