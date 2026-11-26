import type { Source } from '../../shared/types.ts'
import type { FoundSource } from './provider.ts'

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/

/** Returns a clean http(s) URL without tracking parameters, or null if it is not a web address. */
export function normaliseUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
  u.hash = ''
  return u.toString()
}

export function publisherOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Numbers the pages found by the search. Cited pages come first. */
export function numberSources(found: FoundSource[], limit = 40): Source[] {
  const ordered = [...found.filter(f => f.cited), ...found.filter(f => !f.cited)].slice(0, limit)
  return ordered.map((f, i) => ({
    id: i + 1,
    url: f.url,
    title: f.title || publisherOf(f.url),
    publisher: publisherOf(f.url),
  }))
}
