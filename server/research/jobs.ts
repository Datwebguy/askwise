import crypto from 'node:crypto'
import type { Db } from '../db.ts'
import { now } from '../db.ts'
import { ACTIVE_STATUSES, REPORT_STATUSES } from '../../shared/types.ts'
import type { JobStatus, JobView, Report, ResearchStage, ResearchType } from '../../shared/types.ts'
import type { Plan } from './schema.ts'

export interface JobRow {
  id: string
  user_id: string
  request_key: string | null
  question: string
  clarification: string | null
  clarifying_question: string | null
  use_notion: number
  research_type: ResearchType | null
  plan_json: string | null
  status: JobStatus
  stage: ResearchStage | null
  message: string | null
  report_json: string | null
  created_at: string
  updated_at: string
}

const TERMINAL: readonly JobStatus[] = ['FAILED', 'CANCELLED']

export function findByRequestKey(db: Db, userId: string, key: string): JobRow | null {
  return (db.prepare('SELECT * FROM research_jobs WHERE user_id = ? AND request_key = ?').get(userId, key) as JobRow | undefined) ?? null
}

export function findActiveSameQuestion(db: Db, userId: string, question: string): JobRow | null {
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  return (
    (db
      .prepare(`SELECT * FROM research_jobs WHERE user_id = ? AND question = ? AND status IN (${marks}) ORDER BY created_at DESC LIMIT 1`)
      .get(userId, question, ...ACTIVE_STATUSES) as JobRow | undefined) ?? null
  )
}

export function countActive(db: Db, userId: string): number {
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM research_jobs WHERE user_id = ? AND status IN (${marks})`)
    .get(userId, ...ACTIVE_STATUSES) as { n: number }
  return row.n
}

export function countSince(db: Db, userId: string, sinceIso: string): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM research_jobs WHERE user_id = ? AND created_at >= ?').get(userId, sinceIso) as { n: number }
  return row.n
}

/** Research started by everyone since a moment in time; used for the daily limit. */
export function countAllSince(db: Db, sinceIso: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM research_jobs WHERE created_at >= ?').get(sinceIso) as { n: number }).n
}

export function createJob(db: Db, userId: string, question: string, useNotion: boolean, requestKey: string | null): JobRow {
  const id = crypto.randomUUID()
  const t = now()
  db.prepare(
    `INSERT INTO research_jobs (id, user_id, request_key, question, use_notion, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?)`,
  ).run(id, userId, requestKey, question, useNotion ? 1 : 0, t, t)
  return getJobRow(db, id)!
}

export function getJobRow(db: Db, id: string): JobRow | null {
  return (db.prepare('SELECT * FROM research_jobs WHERE id = ?').get(id) as JobRow | undefined) ?? null
}

/** Returns the job only when it belongs to this user. */
export function getOwnedJob(db: Db, userId: string, id: string): JobRow | null {
  return (db.prepare('SELECT * FROM research_jobs WHERE id = ? AND user_id = ?').get(id, userId) as JobRow | undefined) ?? null
}

export function listJobs(db: Db, userId: string, limit = 30): JobRow[] {
  return db.prepare('SELECT * FROM research_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as unknown as JobRow[]
}

/**
 * Moves a job to a new status. A job that was cancelled or stopped is never
 * moved again, so a late research result cannot overwrite a cancellation.
 */
export function setStatus(
  db: Db,
  id: string,
  status: JobStatus,
  fields: { stage?: ResearchStage | null; message?: string | null } = {},
): boolean {
  const marks = TERMINAL.map(() => '?').join(',')
  const res = db
    .prepare(
      `UPDATE research_jobs SET status = ?, stage = ?, message = ?, updated_at = ? WHERE id = ? AND status NOT IN (${marks})`,
    )
    .run(status, fields.stage ?? null, fields.message ?? null, now(), id, ...TERMINAL)
  return Number(res.changes) > 0
}

export function setStage(db: Db, id: string, status: JobStatus, stage: ResearchStage): boolean {
  return setStatus(db, id, status, { stage })
}

export function savePlan(db: Db, id: string, plan: Plan): void {
  db.prepare('UPDATE research_jobs SET plan_json = ?, research_type = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(plan),
    plan.researchType,
    now(),
    id,
  )
}

export function askClarification(db: Db, id: string, question: string): boolean {
  const res = db
    .prepare(
      `UPDATE research_jobs SET status = 'NEEDS_CLARIFICATION', stage = NULL, clarifying_question = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('FAILED','CANCELLED')`,
    )
    .run(question, now(), id)
  return Number(res.changes) > 0
}

export function saveClarification(db: Db, id: string, clarification: string): void {
  db.prepare(`UPDATE research_jobs SET clarification = ?, status = 'QUEUED', plan_json = NULL, updated_at = ? WHERE id = ?`).run(
    clarification,
    now(),
    id,
  )
}

export function saveReport(db: Db, id: string, report: Report, status: 'READY' | 'NEEDS_REVIEW'): boolean {
  const res = db
    .prepare(
      `UPDATE research_jobs SET report_json = ?, status = ?, stage = NULL, message = NULL, updated_at = ?
       WHERE id = ? AND status NOT IN ('FAILED','CANCELLED')`,
    )
    .run(JSON.stringify(report), status, now(), id)
  return Number(res.changes) > 0
}

export function getReport(row: JobRow): Report | null {
  return row.report_json ? (JSON.parse(row.report_json) as Report) : null
}

export function toView(row: JobRow, exported: { url: string; at: string } | null): JobView {
  const report = getReport(row)
  return {
    id: row.id,
    question: row.question,
    clarification: row.clarification,
    clarifyingQuestion: row.status === 'NEEDS_CLARIFICATION' ? row.clarifying_question : null,
    status: row.status,
    stage: row.stage,
    message: row.message,
    researchType: row.research_type,
    title: report?.title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasReport: REPORT_STATUSES.includes(row.status) && report !== null,
    exported,
  }
}

/** Jobs that were running when the service stopped cannot resume; mark them so the person can ask again. */
export function markInterrupted(db: Db, message: string): number {
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  const res = db
    .prepare(`UPDATE research_jobs SET status = 'FAILED', stage = NULL, message = ?, updated_at = ? WHERE status IN (${marks})`)
    .run(message, now(), ...ACTIVE_STATUSES)
  return Number(res.changes)
}
