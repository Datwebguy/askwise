import path from 'node:path'

export interface Config {
  port: number
  dataDir: string
  /** Postgres address for hosted use; without it AskWise uses a local SQLite file. */
  databaseUrl: string | null
  openaiApiKey: string | null
  notionToken: string | null
  researchModel: string
  plannerModel: string
  transcribeModel: string
  /** Maximum time one research run may take, in milliseconds. */
  researchTimeLimitMs: number
  /** Maximum research runs one person can start per hour. */
  researchPerHour: number
  /** Maximum research runs one person can have in progress at once. */
  maxActivePerUser: number
  sessionDays: number
  publicDir: string | null
  /** Questions all visitors together may ask per day. */
  researchPerDay: number
  /** Notion page anyone can save reports to, and its public link. */
  notionSharedPageId: string | null
  notionSharedPageUrl: string | null
  /** Notion public connection details for the "Connect Notion" sign-in. */
  notionOAuth: { clientId: string; clientSecret: string; redirectUri: string } | null
  /** Key used to encrypt people's Notion tokens at rest. */
  secret: string | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: path.resolve(env.ASKWISE_DATA_DIR ?? './data'),
    databaseUrl: env.DATABASE_URL?.trim() || null,
    openaiApiKey: env.OPENAI_API_KEY?.trim() || null,
    notionToken: env.NOTION_TOKEN?.trim() || null,
    researchModel: env.ASKWISE_RESEARCH_MODEL ?? 'gpt-5.4-nano',
    plannerModel: env.ASKWISE_PLANNER_MODEL ?? 'gpt-5.4-nano',
    transcribeModel: env.ASKWISE_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe',
    researchTimeLimitMs: Number(env.ASKWISE_RESEARCH_TIME_LIMIT_MS ?? 6 * 60_000),
    researchPerHour: Number(env.ASKWISE_RESEARCH_PER_HOUR ?? 10),
    researchPerDay: Number(env.ASKWISE_RESEARCH_PER_DAY ?? 150),
    notionSharedPageId: env.NOTION_SHARED_PAGE_ID?.trim() || null,
    notionSharedPageUrl: env.NOTION_SHARED_PAGE_URL?.trim() || null,
    notionOAuth:
      env.NOTION_OAUTH_CLIENT_ID && env.NOTION_OAUTH_CLIENT_SECRET && env.NOTION_OAUTH_REDIRECT_URI
        ? {
            clientId: env.NOTION_OAUTH_CLIENT_ID.trim(),
            clientSecret: env.NOTION_OAUTH_CLIENT_SECRET.trim(),
            redirectUri: env.NOTION_OAUTH_REDIRECT_URI.trim(),
          }
        : null,
    secret: env.ASKWISE_SECRET?.trim() || null,
    maxActivePerUser: Number(env.ASKWISE_MAX_ACTIVE ?? 2),
    sessionDays: Number(env.ASKWISE_SESSION_DAYS ?? 30),
    publicDir: env.ASKWISE_PUBLIC_DIR ?? path.resolve('dist'),
  }
}
