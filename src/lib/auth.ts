import { apiKey } from '@better-auth/api-key'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { mcp, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { eq } from 'drizzle-orm'

import { db, getRuntimeEnv } from '#/lib/db/connection'
import * as schema from '#/lib/db/schema'
import { member } from '#/lib/db/schema'
import {
  ensurePersonalWorkspace,
  hasPendingInvitation,
} from '#/lib/workspace/personal-workspace.server'

const runtimeEnv = getRuntimeEnv()

const authUrl = normalizeUrl(
  runtimeEnv.BETTER_AUTH_URL ?? runtimeEnv.APP_DOMAIN,
)
const staticTrustedOrigins = uniqueValues(
  withLoopbackVariants([
    authUrl,
    ...parseOriginList(runtimeEnv.TRUSTED_ORIGINS),
  ]),
)

const loopbackOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

// Trust the configured origins plus, in local development, whichever loopback
// port the dev server actually bound to (e.g. 3001 when 3000 is taken). This
// prevents "Invalid origin" auth failures when the app is served off-port.
const trustedOrigins = (request?: Request): string[] => {
  const origin = request?.headers.get('origin')

  if (origin && loopbackOriginPattern.test(origin)) {
    return [...staticTrustedOrigins, origin]
  }

  return staticTrustedOrigins
}

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
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh session token daily
    // Serve getSession from a signed cookie instead of hitting D1 on every
    // server-function call. When the cache expires, Better Auth falls back
    // to the database via the session_token cookie and re-sets the cache;
    // sign-out and organization switches refresh it immediately.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  socialProviders,
  trustedOrigins,
  databaseHooks: {
    user: {
      create: {
        // Give a new user their own personal workspace so their pages have an
        // owner to be scoped to — UNLESS they're signing up in response to a
        // pending invitation. In that case they'll join the inviting workspace
        // when they accept (or get a personal workspace if they decline), so we
        // avoid provisioning an orphaned personal workspace up front.
        after: async (createdUser) => {
          if (await hasPendingInvitation(createdUser.email)) {
            return
          }

          await ensurePersonalWorkspace(createdUser.id, {
            name: createdUser.name,
            email: createdUser.email,
          })
        },
      },
    },
    session: {
      create: {
        // Pin the session to the user's workspace organization.
        before: async (createdSession) => {
          const organizationId = await getPrimaryOrganizationId(
            createdSession.userId,
          )

          if (!organizationId) {
            return
          }

          return {
            data: {
              ...createdSession,
              activeOrganizationId: organizationId,
            },
          }
        },
      },
    },
  },
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

async function getPrimaryOrganizationId(
  userId: string,
): Promise<string | null> {
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  return membership?.organizationId ?? null
}

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

// Treat localhost and 127.0.0.1 as interchangeable for local development so
// auth is not rejected as cross-origin when the app is reached via either host.
function withLoopbackVariants(origins: Array<string | undefined>) {
  const expanded: Array<string | undefined> = []

  for (const origin of origins) {
    expanded.push(origin)

    if (origin?.includes('localhost')) {
      expanded.push(origin.replace('localhost', '127.0.0.1'))
    } else if (origin?.includes('127.0.0.1')) {
      expanded.push(origin.replace('127.0.0.1', 'localhost'))
    }
  }

  return expanded
}
