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
    <header class="top"><a href="#/" class="brand"><span class="logo"></span>AskWise</a>
      <nav class="nav">${tab('#/', 'ask', 'Ask')}${tab('#/history', 'history', 'History')}${tab('#/settings', 'settings', 'Settings')}</nav></header>
    <main id="view" class="view-enter">${content}</main>`
}

function notice(text: string, kind: 'info' | 'warn' = 'info'): string {
  return `<p class="notice ${kind}" role="status">${esc(text)}</p>`
}

// ---- Sign in -----------------------------------------------------------
function renderSignIn(root: HTMLElement, message = ''): void {
  root.innerHTML = `
    <main class="signin stagger">
      <span class="logo"></span>
      <h1>Know what to choose.</h1>
      <p class="lead" style="margin-bottom:28px">AskWise reads the web for you, checks the sources and gives you a straight answer on your glasses.</p>
      <form id="signin">
        <label for="code">Sign-in code</label>
        <input id="code" class="code-input" name="code" autocomplete="one-time-code" autocapitalize="characters" required minlength="6" maxlength="40" />
        <div class="row"><button class="primary" type="submit" style="width:100%">Continue</button></div>
        <p id="msg" class="small" role="status">${esc(message)}</p>
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
    const pct = Math.max(8, Math.round(((current + 0.5) / STAGES.length) * 100))
    return `
      <section class="card" aria-live="polite">
        <p class="eyebrow">Working on it</p>
        <p class="question">${esc(job.question)}</p>
        <div class="progress-bar"><span style="width:${pct}%"></span></div>
        <ol class="steps">${STAGES.map(
          (s, i) => `<li class="${i < current ? 'done' : i === current ? 'now' : ''}">${esc(STAGE_LABELS[s])}</li>`,
        ).join('')}</ol>
        <button id="cancel" class="ghost">Stop</button>
      </section>`
  }
  if (job.status === 'NEEDS_CLARIFICATION') {
    return `
      <section class="card">
        <p class="eyebrow">One quick question</p>
        <p class="question">${esc(job.question)}</p>
        <form id="clarify">
          <label for="clar" style="color:var(--text);font-size:1rem">${esc(job.clarifyingQuestion ?? '')}</label>
          <input id="clar" required maxlength="500" />
          <div class="row"><button class="primary" type="submit">Continue</button>
          <button id="skip" class="ghost" type="button">Skip</button></div>
        </form>
      </section>`
  }
  if (job.status === 'FAILED' || job.status === 'CANCELLED') {
    return `<section class="card"><p class="question" style="margin-bottom:12px">${esc(job.question)}</p>${notice(job.message ?? MESSAGES.retry, 'warn')}
      <button id="again" class="primary">Ask again</button></section>`
  }
  if (job.hasReport) {
    return `<a class="card" href="#/report/${esc(job.id)}" style="display:block;color:inherit">
      <p class="eyebrow">Latest${job.researchType ? ` · ${esc(RESEARCH_TYPE_LABELS[job.researchType])}` : ''}</p>
      <h3>${esc(job.title ?? job.question)}</h3>
      <span class="small" style="color:var(--blue)">Open report →</span></a>`
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
    <div class="hero">
      <h1>What are you <span class="grad">deciding?</span></h1>
      <p class="lead">Name the options and what matters to you. AskWise checks the sources and sends the answer to your glasses.</p>
    </div>
    <form id="ask" class="composer" style="margin-bottom:16px">
      <label for="q" class="sr">Your question</label>
      <textarea id="q" rows="3" maxlength="1000" required>${esc(draftQuestion)}</textarea>
      <div class="composer-bar">
        ${readPage ? `<label class="check"><input type="checkbox" id="useNotion" /> <span class="small">Use “${esc(readPage.title)}”</span></label>` : '<span></span>'}
        <button class="primary" type="submit" ${me?.researchAvailable ? '' : 'disabled'}>Research</button>
      </div>
    </form>
    <p id="askmsg" class="small" role="status"></p>
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
    $(root, '#view').innerHTML = reportHtml(job, report)
    on(root, '[data-tab]', 'click', (_e, el) => {
      root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === el))
      root.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('active', (p as HTMLElement).dataset.panel === el.dataset.tab))
    })
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
        <p class="eyebrow">Save to Notion</p>
        <h1>Check it, then save it.</h1>
        ${preview.alreadySaved ? notice(`Already saved on ${fmtDate(preview.alreadySaved.at)}. Saving again won't make a copy.`) : ''}
        <dl class="kv">
          <dt>Where</dt><dd>Inside “${esc(preview.destination.title)}”</dd>
          <dt>What happens</dt><dd>One new page: “${esc(preview.pageTitle)}”</dd>
        </dl>
        ${preview.privateInfo.map(p => notice(p, 'warn')).join('')}
      </section>
      <section class="card preview">
        <p class="eyebrow">Exactly what goes into Notion</p>
        <div class="preview-body">${lines.replace(/(<li>.*?<\/li>)+/g, m => `<ul>${m}</ul>`)}</div>
      </section>
      <section class="card">
        <label class="check"><input type="checkbox" id="confirm" /> I've read it. Save this to Notion.</label>
        <div class="row"><button id="approve" class="primary" disabled>Save to Notion</button>
        <button id="reject" class="ghost">Don't save</button></div>
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
        $(view, '#savemsg').innerHTML = `<p class="notice info">${res.repeated ? 'Already in Notion, so no copy was made.' : 'Saved to Notion.'}</p><a href="${safeHref(res.url)}" target="_blank" rel="noopener">Open in Notion</a>`
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
    view.innerHTML = notice(friendly(err), 'warn') + `<div class="row"><a class="button ghost" href="#/report/${esc(id)}">Back to the report</a><a class="button primary" href="#/settings">Open settings</a></div>`
  }
}

// ---- History -----------------------------------------------------------
async function renderHistory(root: HTMLElement): Promise<void> {
  root.innerHTML = shell('history', '<p class="small">Loading…</p>')
  try {
    const { jobs } = await api.jobs()
    $(root, '#view').innerHTML = jobs.length
      ? `<h1>History</h1><ul class="history stagger">${jobs
          .map(
            j => `<li><a href="${j.hasReport ? `#/report/${esc(j.id)}` : '#/'}" data-job="${esc(j.id)}">
              <span><span class="title">${esc(j.title ?? j.question)}</span><span class="small">${esc(fmtDate(j.createdAt))}</span></span>
              <span class="status ${j.exported || j.hasReport ? 'ok' : ACTIVE_STATUSES.includes(j.status) ? 'live' : 'off'}">${j.exported ? 'In Notion' : esc(STATUS_LABELS[j.status])}</span></a></li>`,
          )
          .join('')}</ul>`
      : '<h1>History</h1><p class="lead">Nothing here yet. Your questions and reports will show up here.</p>'
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
             <div class="row"><button class="primary" type="submit">Save choices</button>
             <button id="disconnect" class="ghost" type="button">Disconnect</button></div>
           </form>
           <p class="small">You'll only see pages you've shared with AskWise in Notion.</p>`

  view.innerHTML = `
    <h1>Settings</h1>
    ${message ? notice(message) : ''}
    <section class="card">
      <h2>Where you shop</h2>
      <form id="prefs">
        <label for="country">Country you shop in</label>
        <input id="country" maxlength="56" value="${esc(me.settings.country ?? '')}" />
        <label for="currency">Currency (3 letters, for example USD)</label>
        <input id="currency" maxlength="3" value="${esc(me.settings.currency ?? '')}" />
        <div class="row"><button class="primary" type="submit">Save</button></div>
      </form>
    </section>
    <section class="card"><h2>Notion</h2>${notionSection}</section>
    <section class="card">
      <h2>Your data</h2>
      <p class="small">AskWise keeps your questions and reports until you delete them.</p>
      <div class="row"><button id="signout" class="ghost">Sign out</button>
      <button id="delete" class="danger">Delete everything</button></div>
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
