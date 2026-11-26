// Everyday wording for everything a person sees on the glasses or the phone.
import type { ClaimStatus, JobStatus, PriceType, ResearchStage, ReviewType, ResearchType } from './types.ts'

export const CLAIM_LABELS: Record<ClaimStatus, string> = {
  VERIFIED: 'Confirmed',
  CORROBORATED: 'Backed by several sources',
  CONFLICTING: 'Sources disagree',
  UNVERIFIED: 'Not confirmed yet',
  OUTDATED: 'May be out of date',
  INFERRED: 'Our conclusion',
}

export const CLAIM_EXPLANATIONS: Record<ClaimStatus, string> = {
  VERIFIED: 'A reliable source supports this.',
  CORROBORATED: 'More than one source supports this.',
  CONFLICTING: 'Reliable sources say different things.',
  UNVERIFIED: 'There is not enough evidence yet.',
  OUTDATED: 'This information is old and may have changed.',
  INFERRED: 'AskWise worked this out from the information it found.',
}

export const PRICE_UNCONFIRMED = "Check the shop for today's price."

export const PRICE_TYPE_LABELS: Record<PriceType, string> = {
  regular: 'Regular price',
  discount: 'Sale price',
  used: 'Used',
  estimate: 'Estimate',
}

export const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  expert: 'Expert review',
  lab_test: 'Lab test',
  customer: 'Customer reviews',
  discussion: 'Online discussion',
}

export const RESEARCH_TYPE_LABELS: Record<ResearchType, string> = {
  product_comparison: 'Product comparison',
  product: 'Product research',
  general: 'General research',
  software: 'Software and services',
  technical: 'Technical research',
}

export const STAGE_LABELS: Record<ResearchStage, string> = {
  understanding: 'Understanding your question',
  searching: 'Searching the web',
  organising: 'Comparing what was found',
  checking: 'Checking sources',
  writing: 'Writing your answer',
}

/** Short words for the job state, used on the phone history list. */
export const STATUS_LABELS: Record<JobStatus, string> = {
  CREATED: 'Starting',
  NEEDS_CLARIFICATION: 'Needs one detail',
  QUEUED: 'Starting',
  RUNNING: 'Researching',
  VERIFYING: 'Checking sources',
  READY: 'Ready',
  NEEDS_REVIEW: 'Ready',
  APPROVED_FOR_EXPORT: 'Saving to Notion',
  EXPORTED: 'Saved to Notion',
  FAILED: 'Stopped',
  CANCELLED: 'Stopped',
}

export const STRENGTH_LABELS = {
  strong: 'Well supported',
  mixed: 'Partly supported',
  weak: 'Few sources',
} as const

export const MESSAGES = {
  retry: "Let's try that again.",
  offline: 'Reconnecting to AskWise…',
  busy: 'AskWise is busy right now. Please try again in a moment.',
  tooMany: 'You have a few questions running. Please wait for one to finish.',
  interrupted: 'This research was interrupted. Ask again to restart it.',
  researchStopped: "AskWise couldn't finish this research. Let's try that again.",
  notionReconnect: 'Notion needs to be connected again.',
  signInAgain: 'Please sign in again.',
  notFound: "We couldn't find that.",
  checkInput: 'Please check what you entered.',
  changedSinceReview: 'The report changed since you reviewed it. Please review it again.',
} as const
