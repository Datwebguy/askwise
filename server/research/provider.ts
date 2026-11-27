import type { Plan, RawReport } from './schema.ts'
import type { Source } from '../../shared/types.ts'

export interface PlanRequest {
  question: string
  clarification: string | null
  settings: { country: string | null; currency: string | null }
  notes: string | null
}

export interface SearchRequest {
  question: string
  clarification: string | null
  plan: Plan
  notes: string | null
}

export interface FoundSource {
  url: string
  title: string
  /** True when the research notes cite this page directly. */
  cited: boolean
}

export interface SearchResult {
  notes: string
  sources: FoundSource[]
}

export interface StructureRequest {
  question: string
  plan: Plan
  notes: string
  sources: Source[]
}

/** A research provider. OpenAI is the first one; others can be added behind the same interface. */
export interface ResearchProvider {
  readonly name: string
  plan(req: PlanRequest, signal: AbortSignal): Promise<Plan>
  search(req: SearchRequest, signal: AbortSignal): Promise<SearchResult>
  structure(req: StructureRequest, signal: AbortSignal): Promise<RawReport>
}

/** Raised when the provider cannot produce a usable result. The message is for logs only. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}
