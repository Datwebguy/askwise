// Creates a one-time sign-in code for a new AskWise account.
import path from 'node:path'
import { loadConfig } from '../server/config.ts'
import { openDb } from '../server/db.ts'
import { createInvite } from '../server/auth.ts'

const config = loadConfig()
const db = openDb(path.join(config.dataDir, 'askwise.db'))
const hours = Number(process.argv[2] ?? 72)
console.log(`Sign-in code (valid ${hours} hours, single use): ${createInvite(db, hours)}`)
