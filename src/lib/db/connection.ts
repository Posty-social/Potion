import { env } from 'cloudflare:workers'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'

import * as schema from './schema'

export type AppDatabase = DrizzleD1Database<typeof schema>

export type RuntimeEnv = Env & {
  APP_DOMAIN?: string
  BETTER_AUTH_URL?: string
  BETTER_AUTH_SECRET: string
  CLOUDFLARE_ACCOUNT_ID?: string
  DB: D1Database
  ASSETS: R2Bucket
  PAGE_DOC: DurableObjectNamespace
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET_NAME?: string
  TRUSTED_ORIGINS?: string
  WORKSPACE_AUTH_REQUIRED?: string
}

export function createDb(database: D1Database): AppDatabase {
  return drizzle(database, { schema })
}

export function getRuntimeEnv(): RuntimeEnv {
  return env as RuntimeEnv
}

export const db = createDb(getRuntimeEnv().DB)
