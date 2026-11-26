// Keeps the current research request up to date for both the phone and the
// glasses. Checks for progress while research runs and reconnects after
// network drops with a growing wait between tries.
import { ACTIVE_STATUSES, REPORT_STATUSES } from '../../shared/types.ts'
import type { JobView, Report } from '../../shared/types.ts'
import { api, getToken, Unreachable } from './api.ts'

export interface TrackerState {
  signedIn: boolean
  job: JobView | null
  report: Report | null
  offline: boolean
  loading: boolean
}

type Listener = (s: TrackerState) => void

const CURRENT_KEY = 'askwise.current'

export class Tracker {
  state: TrackerState = { signedIn: false, job: null, report: null, offline: false, loading: true }
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private failures = 0

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<TrackerState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(fn => fn(this.state))
  }

  /** Follows a specific research request. */
  follow(job: JobView): void {
    try {
      localStorage.setItem(CURRENT_KEY, job.id)
    } catch {
      /* not essential */
    }
    this.set({ job, report: this.state.job?.id === job.id ? this.state.report : null })
    void this.refresh()
  }

  /** Reloads the followed request, or the latest one. */
  async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!getToken()) {
      this.set({ signedIn: false, job: null, report: null, loading: false, offline: false })
      return
    }
    try {
      let id = this.state.job?.id ?? null
      if (!id) {
        try {
          id = localStorage.getItem(CURRENT_KEY)
        } catch {
          id = null
        }
      }
      let job: JobView | null = null
      if (id) job = await api.job(id).then(r => r.job).catch(() => null)
      if (!job) job = (await api.latest()).job
      let report = this.state.report
      if (job && REPORT_STATUSES.includes(job.status) && job.hasReport && (!report || this.state.job?.id !== job.id)) {
        report = (await api.report(job.id)).report
      }
      if (!job || !job.hasReport) report = null
      this.failures = 0
      this.set({ signedIn: !!getToken(), job, report, offline: false, loading: false })
      if (job && (ACTIVE_STATUSES.includes(job.status) || job.status === 'APPROVED_FOR_EXPORT')) this.schedule(2000)
    } catch (e) {
      if (e instanceof Unreachable) {
        this.failures += 1
        this.set({ offline: true, loading: false })
        this.schedule(Math.min(30_000, 2000 * 2 ** Math.min(this.failures, 4)))
      } else {
        this.set({ signedIn: !!getToken(), loading: false })
      }
    }
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), ms)
  }
}

export const tracker = new Tracker()
