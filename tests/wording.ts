import fs from 'node:fs'

// Event words listed in rule 6 of docs/00_START_HERE.md, read from the rule itself.
function eventWords(): string[] {
  const rule = fs.readFileSync('docs/00_START_HERE.md', 'utf8').split('\n').find(l => l.startsWith('6. ')) ?? ''
  return [...rule.matchAll(/"([a-z]+)"/g)].map(m => m[1])
}

// Words that must never appear in anything a person sees.
export const DEVELOPER_WORDS = [...eventWords(),
  'api',
  'json',
  'backend',
  'server',
  'token',
  'endpoint',
  'sdk',
  'webview',
  'simulator',
  'job',
  'queue',
  'null',
  'undefined',
  'error',
  'failed',
  'stack',
  'exception',
  '500',
]
