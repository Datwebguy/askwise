import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../server/config.ts'
import { buildService } from '../server/build.ts'
import { createGuest } from '../server/auth.ts'
import * as jobs from '../server/research/jobs.ts'
import { MESSAGES } from '../shared/labels.ts'

describe('research cut off by a restart', () => {
  it('is marked interrupted within a minute instead of showing "researching" forever, and recent research is left alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askwise-sweep-'))
    const config = loadConfig({ ASKWISE_DATA_DIR: dir, ASKWISE_RESEARCH_TIME_LIMIT_MS: '0', ASKWISE_SECRET: 'fixture-secret-for-tests-only-0123456789' })
    const { db } = await buildService(config, { sweepEveryMs: 0 })
    const { userId } = await createGuest(db, 30)
    const stuck = await jobs.createJob(db, userId, 'Fixture question cut off', false, null)
    await jobs.setStage(db, stuck.id, 'RUNNING', 'searching')
    // Pretend the stuck request went quiet two minutes ago; the other one is still working.
    await db.run('UPDATE research_jobs SET updated_at = ? WHERE id = ?', new Date(Date.now() - 120_000).toISOString(), stuck.id)
    const working = await jobs.createJob(db, userId, 'Fixture question still running', false, null)
    await jobs.setStage(db, working.id, 'RUNNING', 'searching')

    const again = await buildService(config, { sweepEveryMs: 20 })
    await new Promise(r => setTimeout(r, 80))
    const a = (await jobs.getJobRow(again.db, stuck.id))!
    expect(a.status).toBe('FAILED')
    expect(a.message).toBe(MESSAGES.interrupted)
    expect((await jobs.getJobRow(again.db, working.id))!.status).toBe('RUNNING')
  })
})
