// Creates a one-time sign-in code. With --owner, the account can use the service's own Notion connection.
import path from 'node:path'
import { loadConfig } from '../server/config.ts'
import { openDb } from '../server/db.ts'
import { createInvite } from '../server/auth.ts'

const config = loadConfig()
const db = openDb(path.join(config.dataDir, 'askwise.db'))
// Usage: npm run invite [-- --owner] [hours]
const owner = process.argv.includes('--owner')
const hours = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) ?? 72)
const code = createInvite(db, hours, null, owner)
console.log(`${owner ? 'Owner sign-in' : 'Sign-in'} code (valid ${hours} hours, single use): ${code}`)
if (owner) console.log('Open AskWise, then go to the address ending in #/code/' + code + ' to use it.')
