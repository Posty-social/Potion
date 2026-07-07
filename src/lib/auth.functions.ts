import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '#/lib/auth'
import { getRuntimeEnv } from '#/lib/db/connection'

export const getSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    return auth.api.getSession({ headers: getRequestHeaders() })
  },
)

/**
 * Which OAuth providers have credentials configured, so the login page only
 * renders buttons that actually work.
 */
export const getEnabledSocialProviders = createServerFn({
  method: 'GET',
}).handler(async () => {
  const env = getRuntimeEnv()

  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
  }
})
