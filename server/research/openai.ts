// OpenAI research provider: Responses API with the web_search tool and
// strict structured outputs.
import { isPlan, isRawReport, PLAN_SCHEMA, REPORT_SCHEMA } from './schema.ts'
import type { Plan, RawReport } from './schema.ts'
import {
  PLANNER_INSTRUCTIONS,
  plannerInput,
  SEARCH_INSTRUCTIONS,
  searchInput,
  STRUCTURE_INSTRUCTIONS,
  structureInput,
} from './prompts.ts'
import { ProviderError } from './provider.ts'
import type { FoundSource, PlanRequest, ResearchProvider, SearchRequest, SearchResult, StructureRequest } from './provider.ts'
import { normaliseUrl } from './sources.ts'

type FetchLike = typeof fetch

export interface OpenAIOptions {
  apiKey: string
  researchModel: string
  plannerModel: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

interface ResponsesOutputItem {
  type: string
  action?: { type?: string; url?: string; sources?: { type?: string; url?: string; title?: string }[] }
  content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[]
}

interface ResponsesBody {
  status?: string
  error?: { message?: string } | null
  incomplete_details?: { reason?: string } | null
  output?: ResponsesOutputItem[]
}

export class OpenAIResearchProvider implements ResearchProvider {
  readonly name = 'openai'
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string

  constructor(private readonly opts: OpenAIOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.baseUrl = opts.baseUrl ?? 'https://api.openai.com/v1'
  }

  async plan(req: PlanRequest, signal: AbortSignal): Promise<Plan> {
    const body = await this.call(
      {
        model: this.opts.plannerModel,
        instructions: PLANNER_INSTRUCTIONS,
        input: plannerInput(req.question, req.clarification, req.settings, req.notes),
        text: { format: { type: 'json_schema', name: 'research_plan', strict: true, schema: PLAN_SCHEMA } },
        max_output_tokens: 4000,
        reasoning: { effort: 'low' },
      },
      signal,
    )
    const parsed = parseJson(outputText(body))
    if (!isPlan(parsed)) throw new ProviderError('plan did not match schema', true)
    return parsed
  }

  async search(req: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
    const body = await this.call(
      {
        model: this.opts.researchModel,
        instructions: SEARCH_INSTRUCTIONS,
        input: searchInput(req.question, req.clarification, req.plan, req.notes),
        tools: [{ type: 'web_search' }],
        include: ['web_search_call.action.sources'],
        max_output_tokens: 16000,
        reasoning: { effort: 'low' },
      },
      signal,
    )
    const notes = outputText(body).trim()
    if (!notes) throw new ProviderError('search returned no notes', true)
    return { notes, sources: collectSources(body) }
  }

  async structure(req: StructureRequest, signal: AbortSignal): Promise<RawReport> {
    const body = await this.call(
      {
        model: this.opts.researchModel,
        instructions: STRUCTURE_INSTRUCTIONS,
        input: structureInput(req.question, req.plan, req.notes, req.sources),
        text: { format: { type: 'json_schema', name: 'research_report', strict: true, schema: REPORT_SCHEMA } },
        max_output_tokens: 16000,
        reasoning: { effort: 'low' },
      },
      signal,
    )
    const parsed = parseJson(outputText(body))
    if (!isRawReport(parsed)) throw new ProviderError('report did not match schema', true)
    return parsed
  }

  private async call(payload: Record<string, unknown>, signal: AbortSignal): Promise<ResponsesBody> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (e) {
      if (signal.aborted) throw e
      throw new ProviderError(`network: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500
      throw new ProviderError(`openai status ${res.status}`, retryable)
    }
    const body = (await res.json()) as ResponsesBody
    if (body.error) throw new ProviderError(`openai: ${body.error.message ?? 'unknown'}`, false)
    if (body.status && body.status !== 'completed') {
      throw new ProviderError(`openai response ${body.status} ${body.incomplete_details?.reason ?? ''}`, true)
    }
    return body
  }
}

export function outputText(body: ResponsesBody): string {
  const parts: string[] = []
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue
    for (const c of item.content ?? []) if (c.type === 'output_text' && c.text) parts.push(c.text)
  }
  return parts.join('\n')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError('output was not valid JSON', true)
  }
}

/** Collects every page the web search actually returned or cited. */
export function collectSources(body: ResponsesBody): FoundSource[] {
  const found = new Map<string, FoundSource>()
  const add = (rawUrl: string | undefined, title: string | undefined, cited: boolean) => {
    const url = rawUrl ? normaliseUrl(rawUrl) : null
    if (!url) return
    const prev = found.get(url)
    if (prev) {
      prev.cited ||= cited
      if (!prev.title && title) prev.title = title
    } else {
      found.set(url, { url, title: title?.trim() ?? '', cited })
    }
  }
  for (const item of body.output ?? []) {
    if (item.type === 'web_search_call') {
      for (const s of item.action?.sources ?? []) add(s.url, s.title, false)
      if (item.action?.type === 'open_page') add(item.action.url, undefined, false)
    }
    if (item.type === 'message') {
      for (const c of item.content ?? []) {
        for (const a of c.annotations ?? []) if (a.type === 'url_citation') add(a.url, a.title, true)
      }
    }
  }
  return [...found.values()]
}
