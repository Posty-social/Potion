import handler from '@tanstack/react-start/server-entry'

import { deleteUnusedAssets } from './lib/assets/cleanup.server'
import {
  createSessionDb,
  getRuntimeEnv,
  runWithSession,
} from './lib/db/connection'

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
    // Reads start on the primary: deciding a file is unused must not rely
    // on a read replica that hasn't seen a just-written reference yet.
    const env = getRuntimeEnv()
    ctx.waitUntil(
      deleteUnusedAssets({
        db: createSessionDb(env.DB, 'first-primary'),
        bucket: env.ASSETS,
      }).then(({ deleted }) => {
        // oxlint-disable-next-line no-console -- surfaces in Workers logs
        console.log(`asset cleanup: deleted ${deleted.length} unused upload(s)`)
      }),
    )
  },
}
