import { getRuntimeEnv } from '#/lib/db/connection'
import type { WorkspaceNotifier } from '#/lib/workspace/repository'

/**
 * Realtime write notifier: after a repository write, ping the changed page's
 * PageDoc Durable Object so every connected viewer (other tabs, other users,
 * MCP-triggered edits) is told to refetch. Strictly best-effort — a realtime
 * failure must never fail the write, so every error is swallowed.
 */
export function createPageDocNotifier(): WorkspaceNotifier {
  return {
    async pageChanged(pageId: string) {
      try {
        const namespace = getRuntimeEnv().PAGE_DOC
        const stub = namespace.get(namespace.idFromName(pageId))

        await stub.fetch('https://page-doc/broadcast', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'doc:update', pageId }),
        })
      } catch {
        // Realtime is best-effort; the write already succeeded.
      }
    },
  }
}
