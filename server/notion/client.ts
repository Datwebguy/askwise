// Minimal Notion client covering what AskWise needs: identify the
// connection, list shared pages, read one page and create a report page.
type FetchLike = typeof fetch

export const NOTION_VERSION = '2022-06-28'

export class NotionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
  /** True when the connection no longer has access (removed, revoked or page unshared). */
  get accessLost(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404
  }
}

export interface NotionPage {
  id: string
  title: string
  url: string
}

export interface NotionBlock {
  object: 'block'
  type: string
  [key: string]: unknown
}

interface RichText {
  plain_text?: string
}

export class NotionClient {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly token: string,
    fetchImpl?: FetchLike,
    private readonly baseUrl = 'https://api.notion.com/v1',
  ) {
    this.fetchImpl = fetchImpl ?? fetch
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e) {
      throw new NotionError(`network: ${(e as Error).message}`, 0)
    }
    if (!res.ok) throw new NotionError(`notion status ${res.status} on ${method} ${path.split('?')[0]}`, res.status)
    return (await res.json()) as T
  }

  async workspaceName(): Promise<string> {
    const me = await this.req<{ bot?: { workspace_name?: string } }>('GET', '/users/me')
    return me.bot?.workspace_name ?? 'Notion'
  }

  /** Pages the person has shared with the AskWise connection. */
  async sharedPages(): Promise<NotionPage[]> {
    const pages: NotionPage[] = []
    let cursor: string | undefined
    for (let i = 0; i < 5; i++) {
      const res = await this.req<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>('POST', '/search', {
        filter: { property: 'object', value: 'page' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
      for (const r of res.results) pages.push(toPage(r))
      if (!res.has_more || !res.next_cursor) break
      cursor = res.next_cursor
    }
    return pages
  }

  async page(id: string): Promise<NotionPage> {
    return toPage(await this.req('GET', `/pages/${encodeURIComponent(id)}`))
  }

  /** Plain text of a page's top-level blocks, up to maxChars. */
  async pageText(id: string, maxChars = 8000): Promise<string> {
    const lines: string[] = []
    let cursor: string | undefined
    let size = 0
    for (let i = 0; i < 5 && size < maxChars; i++) {
      const q = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : '?page_size=100'
      const res = await this.req<{ results: NotionBlock[]; has_more: boolean; next_cursor: string | null }>(
        'GET',
        `/blocks/${encodeURIComponent(id)}/children${q}`,
      )
      for (const b of res.results) {
        const text = blockText(b)
        if (text) {
          lines.push(text)
          size += text.length
        }
      }
      if (!res.has_more || !res.next_cursor) break
      cursor = res.next_cursor
    }
    return lines.join('\n').slice(0, maxChars)
  }

  async createPage(parentId: string, title: string, children: NotionBlock[]): Promise<NotionPage> {
    const first = children.slice(0, 100)
    const created = await this.req<unknown>('POST', '/pages', {
      parent: { page_id: parentId },
      properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
      children: first,
    })
    const page = toPage(created)
    for (let i = 100; i < children.length; i += 100) {
      await this.req('PATCH', `/blocks/${encodeURIComponent(page.id)}/children`, { children: children.slice(i, i + 100) })
    }
    return page
  }
}

function toPage(raw: unknown): NotionPage {
  const r = raw as { id: string; url?: string; properties?: Record<string, { type?: string; title?: RichText[] }> }
  let title = ''
  for (const prop of Object.values(r.properties ?? {})) {
    if (prop.type === 'title' && prop.title) title = prop.title.map(t => t.plain_text ?? '').join('')
  }
  return { id: r.id, title: title || 'Untitled', url: r.url ?? '' }
}

const TEXT_BLOCKS = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'quote',
  'callout',
  'toggle',
]

export function blockText(b: NotionBlock): string {
  if (!TEXT_BLOCKS.includes(b.type)) return ''
  const data = b[b.type] as { rich_text?: RichText[] } | undefined
  const text = (data?.rich_text ?? []).map(t => t.plain_text ?? '').join('').trim()
  if (!text) return ''
  if (b.type.startsWith('heading')) return `\n${text}`
  if (b.type.endsWith('list_item') || b.type === 'to_do') return `- ${text}`
  return text
}
