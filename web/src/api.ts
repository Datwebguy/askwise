import { MESSAGES } from '../../shared/labels.ts'
import type { ConnectionView, ExportPreview, JobView, NotionPageChoice, Report, Settings, Source } from '../../shared/types.ts'

const TOKEN_KEY = 'askwise.session'

/** A request the service answered with a friendly refusal. */
export class AskWiseRefusal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message)
  }
}

/** The service could not be reached. */
export class Unreachable extends Error {
  constructor() {
    super(MESSAGES.offline)
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage can be blocked in private browsing; the session then lasts for this visit */
  }
  sessionListeners.forEach(fn => fn(token))
}

const sessionListeners = new Set<(token: string | null) => void>()
export function onSessionChange(fn: (token: string | null) => void): () => void {
  sessionListeners.add(fn)
  return () => sessionListeners.delete(fn)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const audio = body instanceof Uint8Array
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(audio ? { 'Content-Type': 'audio/wav' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : audio ? new Blob([new Uint8Array(body)], { type: 'audio/wav' }) : JSON.stringify(body),
    })
  } catch {
    throw new Unreachable()
  }
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    if (!res.ok) throw new Unreachable()
  }
  if (res.status === 401 && !path.startsWith('/api/session')) {
    // Only sign out if this request used the current session; an older request must not undo a new sign-in.
    if (getToken() === token) setToken(null)
    throw new AskWiseRefusal(MESSAGES.signInAgain, 401)
  }
  if (!res.ok) {
    const message = typeof data.message === 'string' ? data.message : MESSAGES.retry
    throw new AskWiseRefusal(message, res.status, typeof data.reason === 'string' ? data.reason : undefined)
  }
  return data as T
}

export interface Me {
  settings: Settings
  researchAvailable: boolean
  notionAvailable: boolean
  notionSignIn: boolean
  voiceAvailable: boolean
  notionShared: { title: string; url: string | null } | null
  isOwner: boolean
  notion: ConnectionView
}

export const api = {
  signIn: (code: string) => request<{ token: string }>('POST', '/api/session', { code }),
  transcribe: (wav: Uint8Array) => request<{ text: string }>('POST', '/api/voice', wav),
  startInstantly: () => request<{ token: string }>('POST', '/api/session/guest'),
  notionSignIn: () => request<{ url: string }>('POST', '/api/integrations/notion/sign-in'),
  deviceCode: () => request<{ code: string; minutes: number }>('POST', '/api/session/device-code'),
  signOut: () => request<{ ok: true }>('DELETE', '/api/session'),
  me: () => request<Me>('GET', '/api/me'),
  saveSettings: (s: Settings) => request<{ settings: Settings }>('PUT', '/api/settings', s),
  deleteEverything: () => request<{ ok: true }>('DELETE', '/api/me'),

  ask: (question: string, useNotion: boolean, requestKey: string) =>
    request<{ job: JobView; repeated?: boolean }>('POST', '/api/research', { question, useNotion, requestKey }),
  jobs: () => request<{ jobs: JobView[] }>('GET', '/api/research'),
  latest: () => request<{ job: JobView | null }>('GET', '/api/research/latest'),
  job: (id: string) => request<{ job: JobView }>('GET', `/api/research/${encodeURIComponent(id)}`),
  report: (id: string) => request<{ job: JobView; report: Report }>('GET', `/api/research/${encodeURIComponent(id)}/report`),
  sources: (id: string) => request<{ sources: Source[] }>('GET', `/api/research/${encodeURIComponent(id)}/sources`),
  clarify: (id: string, clarification: string) =>
    request<{ job: JobView }>('POST', `/api/research/${encodeURIComponent(id)}/clarify`, { clarification }),
  skipClarify: (id: string) => request<{ job: JobView }>('POST', `/api/research/${encodeURIComponent(id)}/clarify`, { skip: true }),
  cancel: (id: string) => request<{ job: JobView }>('POST', `/api/research/${encodeURIComponent(id)}/cancel`),

  connectNotion: () => request<{ notion: ConnectionView }>('POST', '/api/integrations/notion/connect'),
  notionPages: () => request<{ pages: NotionPageChoice[] }>('GET', '/api/integrations/notion/pages'),
  chooseNotionPages: (readPageId: string | null, destinationId: string | null) =>
    request<{ notion: ConnectionView }>('PUT', '/api/integrations/notion/pages', { readPageId, destinationId }),
  disconnectNotion: () => request<{ notion: ConnectionView }>('DELETE', '/api/integrations/notion'),

  exportPreview: (id: string) => request<{ preview: ExportPreview }>('POST', `/api/reports/${encodeURIComponent(id)}/export-preview`),
  approveExport: (id: string, previewId: string, contentHash: string) =>
    request<{ url: string; repeated: boolean }>('POST', `/api/reports/${encodeURIComponent(id)}/approve-export`, {
      approved: true,
      previewId,
      contentHash,
    }),
  rejectExport: (id: string, previewId: string) =>
    request<{ ok: true }>('POST', `/api/reports/${encodeURIComponent(id)}/reject-export`, { previewId }),
}

export function newRequestKey(): string {
  return crypto.randomUUID()
}
