import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as labels from '../shared/labels.ts'
import { reportLines } from '../server/notion/report-page.ts'
import { verifyReport } from '../server/research/verify.ts'
import { numberSources } from '../server/research/sources.ts'
import { FIXTURE_SEARCH, fixtureRawReport } from './fixtures/research.ts'
import { DEVELOPER_WORDS } from './wording.ts'

const bad = (text: string) => DEVELOPER_WORDS.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(text))

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

describe('everyday wording', () => {
  it('uses the agreed friendly labels', () => {
    expect(labels.CLAIM_LABELS).toEqual({
      VERIFIED: 'Confirmed',
      CORROBORATED: 'Backed by several sources',
      CONFLICTING: 'Sources disagree',
      UNVERIFIED: 'Not confirmed yet',
      OUTDATED: 'May be out of date',
      INFERRED: 'Our conclusion',
    })
    expect(labels.PRICE_UNCONFIRMED).toBe("Check the shop for today's price.")
  })

  it('has no developer words in any label or message', () => {
    for (const group of Object.values(labels)) {
      const texts = typeof group === 'string' ? [group] : Object.values(group as Record<string, string>)
      for (const t of texts) expect(bad(t), t).toEqual([])
    }
  })

  it('has no developer words in the page saved to Notion', () => {
    const report = verifyReport(fixtureRawReport(), {
      question: 'Fixture question',
      researchType: 'product_comparison',
      sources: numberSources(FIXTURE_SEARCH.sources),
      checkedAt: '2026-11-26T10:00:00.000Z',
      usedNotionPage: 'Fixture notes',
    })
    const lines = reportLines(report).filter(l => l.kind !== 'link')
    for (const l of lines) expect(bad(l.text.replace(/Fixture[\w ]*/g, '')), l.text).toEqual([])
  })

  it('has no developer words in visible text written in the phone and glasses code', () => {
    const files = walk('web/src').filter(f => f.endsWith('.ts'))
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      // Visible text sits between HTML tags or in quoted sentences that start with a capital letter.
      const visible = [
        ...[...src.matchAll(/>([^<>{}$`\n]{3,})</g)].map(m => m[1]),
        ...[...src.matchAll(/'([A-Z][^'$]{6,})'/g)].map(m => m[1]),
      ]
      for (const t of visible) expect(bad(t), `${file}: ${t}`).toEqual([])
    }
  })
})
