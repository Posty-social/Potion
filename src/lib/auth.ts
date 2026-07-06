import { apiKey } from '@better-auth/api-key'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { mcp, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db, getRuntimeEnv } from '#/lib/db/connection'
import * as schema from '#/lib/db/schema'

const runtimeEnv = getRuntimeEnv()

const authUrl = normalizeUrl(
  runtimeEnv.BETTER_AUTH_URL ?? runtimeEnv.APP_DOMAIN,
)
const trustedOrigins = uniqueValues([
  authUrl,
  ...parseOriginList(runtimeEnv.TRUSTED_ORIGINS),
])

const socialProviders = {
  ...(runtimeEnv.GOOGLE_CLIENT_ID && runtimeEnv.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: runtimeEnv.GOOGLE_CLIENT_ID,
          clientSecret: runtimeEnv.GOOGLE_CLIENT_SECRET,
        },
      }
    : {}),
  ...(runtimeEnv.GITHUB_CLIENT_ID && runtimeEnv.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: runtimeEnv.GITHUB_CLIENT_ID,
          clientSecret: runtimeEnv.GITHUB_CLIENT_SECRET,
        },
      }
    : {}),
}

export const auth = betterAuth({
  baseURL: authUrl,
  secret: runtimeEnv.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema,
    transaction: false,
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
  trustedOrigins,
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      membershipLimit: 100,
    }),
    apiKey({
      references: 'organization',
    }),
    mcp({
      loginPage: '/',
    }),
    tanstackStartCookies(),
  ],
})

function normalizeUrl(value?: string) {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

function parseOriginList(value?: string) {
  return (
    value
      ?.split(',')
      .map((origin) => normalizeUrl(origin))
      .filter((origin): origin is string => Boolean(origin)) ?? []
  )
}

function uniqueValues(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  )
}
