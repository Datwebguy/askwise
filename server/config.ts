import path from 'node:path'

export interface Config {
  port: number
  dataDir: string
  openaiApiKey: string | null
  notionToken: string | null
  researchModel: string
  plannerModel: string
  /** Maximum time one research run may take, in milliseconds. */
  researchTimeLimitMs: number
  /** Maximum research runs one person can start per hour. */
  researchPerHour: number
  /** Maximum research runs one person can have in progress at once. */
  maxActivePerUser: number
  sessionDays: number
  publicDir: string | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: path.resolve(env.ASKWISE_DATA_DIR ?? './data'),
    openaiApiKey: env.OPENAI_API_KEY?.trim() || null,
    notionToken: env.NOTION_TOKEN?.trim() || null,
    researchModel: env.ASKWISE_RESEARCH_MODEL ?? 'gpt-5.4-nano',
    plannerModel: env.ASKWISE_PLANNER_MODEL ?? 'gpt-5.4-nano',
    researchTimeLimitMs: Number(env.ASKWISE_RESEARCH_TIME_LIMIT_MS ?? 6 * 60_000),
    researchPerHour: Number(env.ASKWISE_RESEARCH_PER_HOUR ?? 20),
    maxActivePerUser: Number(env.ASKWISE_MAX_ACTIVE ?? 2),
    sessionDays: Number(env.ASKWISE_SESSION_DAYS ?? 30),
    publicDir: env.ASKWISE_PUBLIC_DIR ?? path.resolve('dist'),
  }
}
