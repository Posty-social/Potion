import handler from '@tanstack/react-start/server-entry'

import { runWithSession } from './lib/db/connection'

export { PageDoc } from './lib/realtime/page-doc'

export default {
  // One D1 session per request: all reads in the request route to the same
  // replica and stay monotonically consistent (read replication is enabled
  // on the production database).
  fetch: (request: Request) => runWithSession(() => handler.fetch(request)),
}
