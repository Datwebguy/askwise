// Types shared by the AskWise service, the phone pages and the glasses screens.

export const JOB_STATUSES = [
  'CREATED',
  'NEEDS_CLARIFICATION',
  'QUEUED',
  'RUNNING',
  'VERIFYING',
  'READY',
  'NEEDS_REVIEW',
  'APPROVED_FOR_EXPORT',
  'EXPORTED',
  'FAILED',
  'CANCELLED',
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** Statuses where research is still in progress. */
export const ACTIVE_STATUSES: readonly JobStatus[] = ['CREATED', 'QUEUED', 'RUNNING', 'VERIFYING']
/** Statuses where a finished report exists. */
export const REPORT_STATUSES: readonly JobStatus[] = ['READY', 'NEEDS_REVIEW', 'APPROVED_FOR_EXPORT', 'EXPORTED']

/** Fine-grained step shown while research runs. */
export type ResearchStage = 'understanding' | 'searching' | 'organising' | 'checking' | 'writing'

export const RESEARCH_TYPES = ['product_comparison', 'product', 'general', 'software', 'technical'] as const
export type ResearchType = (typeof RESEARCH_TYPES)[number]

export const CLAIM_STATUSES = ['VERIFIED', 'CORROBORATED', 'CONFLICTING', 'UNVERIFIED', 'OUTDATED', 'INFERRED'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const PRICE_TYPES = ['regular', 'discount', 'used', 'estimate'] as const
export type PriceType = (typeof PRICE_TYPES)[number]

export const REVIEW_TYPES = ['expert', 'lab_test', 'customer', 'discussion'] as const
export type ReviewType = (typeof REVIEW_TYPES)[number]

export interface Source {
  id: number
  url: string
  title: string
  publisher: string
}

export interface Spec {
  name: string
  value: string
  sourceIds: number[]
  /** True when at least one real source backs this value. */
  confirmed: boolean
}

export interface Price {
  amount: number
  currency: string
  country: string
  shop: string
  priceType: PriceType
  sourceId: number
  checkedAt: string
}

export interface Review {
  summary: string
  reviewType: ReviewType
  sourceId: number
}

export interface Product {
  brand: string
  name: string
  model: string
  variant: string
  region: string
  url: string | null
  specs: Spec[]
  prices: Price[]
  /** Set when no price could be confirmed from a real source. */
  priceNote: string | null
  reviews: Review[]
  pros: string[]
  cons: string[]
}

export interface Claim {
  text: string
  status: ClaimStatus
  sourceIds: number[]
  note: string
}

export interface Conflict {
  topic: string
  details: string
  sourceIds: number[]
}

export interface Recommendation {
  choice: string | null
  why: string
  drawback: string
  alternative: string | null
  noClearWinner: boolean
}

export interface GlassesSummary {
  answer: string
  bestOption: string | null
  reason: string
  drawback: string
  alternatives: string[]
}

export interface EvidenceSummary {
  sourceCount: number
  counts: Record<ClaimStatus, number>
  /** Overall strength shown on the glasses. */
  strength: 'strong' | 'mixed' | 'weak'
  pricesCheckedAt: string | null
}

/** How a research request relates to an earlier report. */
export type Relation = 'recheck' | 'follow_up'

/** One difference between an earlier report and a fresh check of the same question, computed from both real reports. */
export interface Change {
  kind: 'pick' | 'price' | 'spec' | 'product' | 'evidence'
  text: string
  /** True when this item was checked again and stayed the same. */
  same: boolean
}

export interface Report {
  researchType: ResearchType
  title: string
  question: string
  summary: string
  glasses: GlassesSummary
  recommendation: Recommendation
  products: Product[]
  claims: Claim[]
  conflicts: Conflict[]
  missingInfo: string[]
  followUps: string[]
  sources: Source[]
  evidence: EvidenceSummary
  createdAt: string
  usedNotionPage: string | null
  /** The earlier report this one checks again or follows up on. */
  basedOn?: { id: string; title: string; createdAt: string; relation: Relation } | null
  /** For a fresh check: what changed since the earlier report. */
  changes?: Change[] | null
}

export interface JobView {
  id: string
  question: string
  clarification: string | null
  clarifyingQuestion: string | null
  status: JobStatus
  stage: ResearchStage | null
  message: string | null
  researchType: ResearchType | null
  title: string | null
  createdAt: string
  updatedAt: string
  hasReport: boolean
  exported: { url: string; at: string } | null
  basedOn: { id: string; relation: Relation } | null
}

export interface NotionPageChoice {
  id: string
  title: string
}

export interface ConnectionView {
  provider: 'notion'
  connected: boolean
  workspaceName: string | null
  readPage: NotionPageChoice | null
  destinationPage: NotionPageChoice | null
  needsReconnect: boolean
  /** How this connection was made: the owner's service connection, or the person's own Notion sign-in. */
  mode: 'owner' | 'oauth' | null
}

export interface ExportPreview {
  previewId: string
  destination: NotionPageChoice
  action: 'create'
  pageTitle: string
  /** Exact text that will be written, one entry per block. */
  lines: { kind: 'heading' | 'paragraph' | 'bullet' | 'link'; text: string; url?: string }[]
  contentHash: string
  privateInfo: string[]
  /** True when the report goes to the public shared page rather than the person's own Notion. */
  shared: boolean
  alreadySaved: { url: string; at: string } | null
}

export interface Settings {
  country: string | null
  currency: string | null
}
