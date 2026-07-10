// `node:async_hooks` resolves to the Cloudflare Workers built-in
// AsyncLocalStorage when `nodejs_compat` is enabled — the canonical Workers
// pattern for request-scoped state.
// https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/
import { AsyncLocalStorage } from 'node:async_hooks'

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
  // Transactional email: Resend when the key is set, else the Cloudflare
  // Email binding; sender defaults to noreply@APP_DOMAIN.
  RESEND_API_KEY?: string
  FROM_EMAIL_ADDRESS?: string
  SEND_EMAIL?: SendEmail
}

export function createDb(database: D1Database): AppDatabase {
  return drizzle(database, { schema })
}

/**
 * Drizzle instance backed by a per-request D1 Session. Sessions route reads
 * to the nearest replica (when read replication is enabled) while keeping
 * reads within the request monotonically consistent. Create once per request
 * — never at module scope.
 *
 * @see https://developers.cloudflare.com/d1/best-practices/read-replication/#use-sessions-api
 */
export function createSessionDb(database: D1Database): AppDatabase {
  return drizzle(
    database.withSession('first-unconstrained') as unknown as D1Database,
    { schema },
  )
}

const sessionStorage = new AsyncLocalStorage<AppDatabase>()

/**
 * Run `fn` inside a fresh per-request D1 session. Every `db` access during
 * `fn` (and anything it transitively calls) resolves to that one session, so
 * all reads in the request hit the same replica. Called once per request at
 * the worker entry (src/server.ts).
 */
export function runWithSession<T>(fn: () => T): T {
  return sessionStorage.run(createSessionDb(getRuntimeEnv().DB), fn)
}

export function getRuntimeEnv(): RuntimeEnv {
  return env as RuntimeEnv
}

/**
 * Resolves to the active request's session-bound database. Outside a
 * `runWithSession` scope (module init, tests, Durable Objects), falls back to
 * a plain D1 wrapper so it stays safe to import anywhere.
 */
export const db = new Proxy({} as AppDatabase, {
  get(_target, prop, receiver) {
    const active = sessionStorage.getStore() ?? createDb(getRuntimeEnv().DB)
    const value = Reflect.get(active, prop, receiver)

    return typeof value === 'function' ? value.bind(active) : value
  },
})
