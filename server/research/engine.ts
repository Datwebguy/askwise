// Runs one research request from question to checked report. Each step
// updates the stored status, so the glasses and phone always show real progress.
import type { Db } from '../db.ts'
import { log, record } from '../activity.ts'
import { MESSAGES } from '../../shared/labels.ts'
import type { ProviderError, ResearchProvider } from './provider.ts'
import type { Plan } from './schema.ts'
import { numberSources } from './sources.ts'
import { needsReview, verifyReport } from './verify.ts'
import { diffReports } from './changes.ts'
import { previousReport } from './prompts.ts'
import * as jobs from './jobs.ts'

export interface NotesReader {
  /** Text of the Notion page the person chose for research, or null when none is chosen. */
  readSelectedPage(userId: string): Promise<{ title: string; text: string } | null>
}

export interface EngineOptions {
  timeLimitMs: number
  getSettings(userId: string): Promise<{ country: string | null; currency: string | null }>
}

export class ResearchEngine {
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly db: Db,
    private readonly provider: ResearchProvider | null,
    private readonly notes: NotesReader | null,
    private readonly opts: EngineOptions,
  ) {}

  get available(): boolean {
    return this.provider !== null
  }

  /** Starts research in the background. Returns immediately. */
  start(jobId: string, opts: { skipClarification?: boolean } = {}): Promise<void> {
    const controller = new AbortController()
    this.running.set(jobId, controller)
    const done = jobs
      .setStatus(this.db, jobId, 'QUEUED')
      .then(() => this.run(jobId, controller, opts.skipClarification ?? false))
      .finally(() => this.running.delete(jobId))
    return done
  }

  cancel(jobId: string): void {
    this.running.get(jobId)?.abort()
    this.running.delete(jobId)
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId)
  }

  private async run(jobId: string, controller: AbortController, skipClarification: boolean): Promise<void> {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.opts.timeLimitMs)])
    const row = await jobs.getJobRow(this.db, jobId)
    if (!row || !this.provider) return
    const provider = this.provider
    const step = async (status: 'RUNNING' | 'VERIFYING', stage: Parameters<typeof jobs.setStage>[3]) => {
      if (signal.aborted || !(await jobs.setStage(this.db, jobId, status, stage))) throw new StopSignal()
    }

    try {
      await step('RUNNING', 'understanding')
      const notes = row.use_notion && this.notes ? await this.notes.readSelectedPage(row.user_id) : null
      const notesText = notes ? notes.text : null
      const parentRow = row.parent_id ? await jobs.getOwnedJob(this.db, row.user_id, row.parent_id) : null
      const parent = parentRow ? jobs.getReport(parentRow) : null
      const previous = parent && row.relation ? previousReport(parent, row.relation) : null

      let plan: Plan
      if (row.plan_json) {
        plan = JSON.parse(row.plan_json) as Plan
      } else {
        const settings = await this.opts.getSettings(row.user_id)
        plan = await withRetry(() =>
          provider.plan(
            {
              question: row.question,
              clarification: row.clarification,
              settings,
              notes: notesText,
              previous,
            },
            signal,
          ),
        )
        await jobs.savePlan(this.db, jobId, plan)
      }

      // A fresh check repeats a question that was already answered, so it never stops to ask again.
      if (plan.needsClarification && plan.clarifyingQuestion && !row.clarification && !skipClarification && row.relation !== 'recheck') {
        await jobs.askClarification(this.db, jobId, plan.clarifyingQuestion)
        return
      }

      await step('RUNNING', 'searching')
      const found = await withRetry(() =>
        provider.search({ question: row.question, clarification: row.clarification, plan, notes: notesText, previous }, signal),
      )
      const checkedAt = new Date().toISOString()
      const sources = numberSources(found.sources)

      await step('RUNNING', 'organising')
      const raw = await withRetry(() => provider.structure({ question: row.question, plan, notes: found.notes, sources }, signal))

      await step('VERIFYING', 'checking')
      const report = verifyReport(raw, {
        question: row.clarification ? `${row.question} (${row.clarification})` : row.question,
        researchType: plan.researchType,
        sources,
        checkedAt,
        usedNotionPage: notes?.title ?? null,
        citedIds: sources.filter(s => found.sources.some(f => f.cited && f.url === s.url)).map(s => s.id),
      })

      if (parent && parentRow && row.relation) {
        report.basedOn = { id: parentRow.id, title: parent.title, createdAt: parent.createdAt, relation: row.relation }
        if (row.relation === 'recheck') report.changes = diffReports(parent, report)
      }

      await step('VERIFYING', 'writing')
      await jobs.saveReport(this.db, jobId, report, needsReview(report) ? 'NEEDS_REVIEW' : 'READY')
    } catch (e) {
      // Stopped by the person: the cancellation is already recorded.
      if (controller.signal.aborted) return
      // Stopped because the record changed state (for example it was deleted or cancelled elsewhere).
      if (e instanceof StopSignal && !signal.aborted) return
      const reason = signal.aborted ? 'time limit reached' : (e as Error).message
      log(`research ${jobId} stopped: ${reason}`)
      record(this.db, row.user_id, 'research_stopped', reason)
      await jobs.setStatus(this.db, jobId, 'FAILED', { message: MESSAGES.researchStopped })
    }
  }
}

class StopSignal extends Error {}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const retryable = (e as ProviderError).retryable === true
      if (!retryable || i === attempts - 1) throw e
      await new Promise(r => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw last
}
