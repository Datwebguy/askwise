import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { redact } from '../server/activity.ts'

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

const KEY_PATTERNS = [/sk-[A-Za-z0-9_-]{20,}/, /ntn_[A-Za-z0-9]{20,}/, /secret_[A-Za-z0-9]{20,}/]

describe('keys stay on the service', () => {
  it('the phone and glasses code never reads keys or talks to OpenAI or Notion directly', () => {
    for (const file of walk('web/src')) {
      const src = fs.readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/OPENAI_API_KEY|NOTION_TOKEN|api\.openai\.com|api\.notion\.com|process\.env/)
    }
  })

  it('no key is written into the repository or the built app', () => {
    const files = [...walk('server'), ...walk('shared'), ...walk('web'), ...walk('scripts'), ...walk('dist'), 'README.md', '.env.example', 'app.json']
    for (const file of files.filter(f => fs.existsSync(f) && !/\.(png|woff2?|ttf)$/.test(f))) {
      const src = fs.readFileSync(file, 'utf8')
      for (const p of KEY_PATTERNS) expect(p.test(src), file).toBe(false)
    }
  })

  it('removes credentials from anything written to logs', () => {
    expect(redact('Bearer abc.def sk-abcdefghijklmnop ntn_abcdefghijklmnop')).toBe('[hidden] [hidden] [hidden]')
  })

  it('keeps the environment file out of the repository', () => {
    expect(fs.readFileSync('.gitignore', 'utf8')).toMatch(/^\.env$/m)
  })
})

describe('sealed values', () => {
  it('rejects a shortened authentication tag', async () => {
    const { SecretBox } = await import('../server/secret-box')
    const box = new SecretBox('k')
    const [iv, tag, data] = box.seal('hello').split('.')
    expect(box.open([iv, tag, data].join('.'))).toBe('hello')
    const short = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url')
    expect(() => box.open([iv, short, data].join('.'))).toThrow()
  })
})
