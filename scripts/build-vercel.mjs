// Builds AskWise for Vercel using the Build Output API:
// .vercel/output/static holds the app, .vercel/output/functions/api.func the service.
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const out = '.vercel/output'
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(`${out}/functions/api.func`, { recursive: true })
fs.cpSync('dist', `${out}/static`, { recursive: true })

await build({
  entryPoints: ['server/vercel.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: `${out}/functions/api.func/index.mjs`,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
})

fs.writeFileSync(
  `${out}/functions/api.func/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 300, shouldAddHelpers: false }, null, 2),
)
fs.writeFileSync(`${out}/functions/api.func/package.json`, JSON.stringify({ type: 'module' }))
fs.writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)
const size = fs.statSync(path.join(out, 'functions/api.func/index.mjs')).size
console.log(`Vercel output ready (${Math.round(size / 1024)} KB service bundle)`)
