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

export async function findByRequestKey(db: Db, userId: string, key: string): Promise<JobRow | null> {
  return (await db.get('SELECT * FROM research_jobs WHERE user_id = ? AND request_key = ?', userId, key) as JobRow | undefined) ?? null
}

export async function findActiveSameQuestion(db: Db, userId: string, question: string): Promise<JobRow | null> {
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  return (
    (await db.get(`SELECT * FROM research_jobs WHERE user_id = ? AND question = ? AND status IN (${marks}) ORDER BY created_at DESC LIMIT 1`, userId, question, ...ACTIVE_STATUSES) as JobRow | undefined) ?? null
  )
}

export async function countActive(db: Db, userId: string): Promise<number> {
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  const row = await db.get(`SELECT COUNT(*) AS n FROM research_jobs WHERE user_id = ? AND status IN (${marks})`, userId, ...ACTIVE_STATUSES) as { n: number }
  return row.n
}

export async function countSince(db: Db, userId: string, sinceIso: string): Promise<number> {
  const row = await db.get('SELECT COUNT(*) AS n FROM research_jobs WHERE user_id = ? AND created_at >= ?', userId, sinceIso) as { n: number }
  return row.n
}

/** Research started by everyone since a moment in time; used for the daily limit. */
export async function countAllSince(db: Db, sinceIso: string): Promise<number> {
  return (await db.get('SELECT COUNT(*) AS n FROM research_jobs WHERE created_at >= ?', sinceIso) as { n: number }).n
}

export async function createJob(db: Db, userId: string, question: string, useNotion: boolean, requestKey: string | null): Promise<JobRow> {
  const id = crypto.randomUUID()
  const t = now()
  await db.run(`INSERT INTO research_jobs (id, user_id, request_key, question, use_notion, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?)`, id, userId, requestKey, question, useNotion ? 1 : 0, t, t)
  return (await getJobRow(db, id))!
}

export async function getJobRow(db: Db, id: string): Promise<JobRow | null> {
  return (await db.get('SELECT * FROM research_jobs WHERE id = ?', id) as JobRow | undefined) ?? null
}

/** Returns the job only when it belongs to this user. */
export async function getOwnedJob(db: Db, userId: string, id: string): Promise<JobRow | null> {
  return (await db.get('SELECT * FROM research_jobs WHERE id = ? AND user_id = ?', id, userId) as JobRow | undefined) ?? null
}

export async function listJobs(db: Db, userId: string, limit = 30): Promise<JobRow[]> {
  return await db.all('SELECT * FROM research_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit) as unknown as JobRow[]
}

/**
 * Moves a job to a new status. A job that was cancelled or stopped is never
 * moved again, so a late research result cannot overwrite a cancellation.
 */
export async function setStatus(
  db: Db,
  id: string,
  status: JobStatus,
  fields: { stage?: ResearchStage | null; message?: string | null } = {},
): Promise<boolean> {
  const marks = TERMINAL.map(() => '?').join(',')
  const res = await db.run(`UPDATE research_jobs SET status = ?, stage = ?, message = ?, updated_at = ? WHERE id = ? AND status NOT IN (${marks})`, status, fields.stage ?? null, fields.message ?? null, now(), id, ...TERMINAL)
  return Number(res.changes) > 0
}

export async function setStage(db: Db, id: string, status: JobStatus, stage: ResearchStage): Promise<boolean> {
  return setStatus(db, id, status, { stage })
}

export async function savePlan(db: Db, id: string, plan: Plan): Promise<void> {
  await db.run('UPDATE research_jobs SET plan_json = ?, research_type = ?, updated_at = ? WHERE id = ?', 
    JSON.stringify(plan),
    plan.researchType,
    now(),
    id,
  )
}

export async function askClarification(db: Db, id: string, question: string): Promise<boolean> {
  const res = await db.run(`UPDATE research_jobs SET status = 'NEEDS_CLARIFICATION', stage = NULL, clarifying_question = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('FAILED','CANCELLED')`, question, now(), id)
  return Number(res.changes) > 0
}

export async function saveClarification(db: Db, id: string, clarification: string): Promise<void> {
  await db.run(`UPDATE research_jobs SET clarification = ?, status = 'QUEUED', plan_json = NULL, updated_at = ? WHERE id = ?`, 
    clarification,
    now(),
    id,
  )
}

export async function saveReport(db: Db, id: string, report: Report, status: 'READY' | 'NEEDS_REVIEW'): Promise<boolean> {
  const res = await db.run(`UPDATE research_jobs SET report_json = ?, status = ?, stage = NULL, message = NULL, updated_at = ?
       WHERE id = ? AND status NOT IN ('FAILED','CANCELLED')`, JSON.stringify(report), status, now(), id)
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

/** Research that has gone quiet (its service stopped) cannot resume; mark it so the person can ask again. */
export async function markInterrupted(db: Db, message: string, quietSinceIso = now()): Promise<number> {
  const marks = ACTIVE_STATUSES.map(() => '?').join(',')
  const res = await db.run(
    `UPDATE research_jobs SET status = 'FAILED', stage = NULL, message = ?, updated_at = ? WHERE status IN (${marks}) AND updated_at < ?`,
    message,
    now(),
    ...ACTIVE_STATUSES,
    quietSinceIso,
  )
  return Number(res.changes)
}
