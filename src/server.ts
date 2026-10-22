import handler from '@tanstack/react-start/server-entry'

import { deleteUnusedAssets } from './lib/assets/cleanup.server'
import { db, getRuntimeEnv, runWithSession } from './lib/db/connection'

export { PageDoc } from './lib/realtime/page-doc'

export default {
  // One D1 session per request: all reads in the request route to the same
  // replica and stay monotonically consistent (read replication is enabled
  // on the production database).
  fetch: (request: Request) => runWithSession(() => handler.fetch(request)),

  // Daily cron (wrangler.jsonc `triggers`): remove uploads nothing uses.
  scheduled: (
    _controller: ScheduledController,
    _env: unknown,
    ctx: ExecutionContext,
  ) => {
    ctx.waitUntil(
      runWithSession(async () => {
        const { deleted } = await deleteUnusedAssets({
          db,
          bucket: getRuntimeEnv().ASSETS,
        })
        // oxlint-disable-next-line no-console -- surfaces in Workers logs
        console.log(`asset cleanup: deleted ${deleted.length} unused upload(s)`)
      }),
    )
  },
}
