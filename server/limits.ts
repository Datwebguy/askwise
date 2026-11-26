/** Counts attempts per key inside a sliding window. */
export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const t = Date.now()
    const recent = (this.hits.get(key) ?? []).filter(x => t - x < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    return true
  }
}
