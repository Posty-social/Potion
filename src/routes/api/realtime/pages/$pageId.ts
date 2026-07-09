import { createFileRoute } from '@tanstack/react-router'

import { getRuntimeEnv } from '#/lib/db/connection'
import { hasWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

export const Route = createFileRoute('/api/realtime/pages/$pageId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const pageId = params.pageId

        if (!isSafePageId(pageId)) {
          return Response.json({ error: 'invalid_page_id' }, { status: 400 })
        }

        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          return Response.json(
            {
              status: 'websocket-required',
              pageId,
            },
            { status: 426 },
          )
        }

        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        // Browsers cannot set custom headers on WebSocket upgrades, so the
        // client identifies its tab via the `client` query param instead.
        const clientId = new URL(request.url).searchParams.get('client')

        const headers = new Headers(request.headers)
        headers.set('x-potion-page-id', pageId)
        headers.set('x-potion-user-id', access.user?.id ?? 'local-dev')
        headers.set(
          'x-potion-user-name',
          access.user?.name || access.user?.email || 'Someone',
        )
        headers.set(
          'x-potion-client-id',
          clientId ?? headers.get('x-potion-client-id') ?? crypto.randomUUID(),
        )

        const id = getRuntimeEnv().PAGE_DOC.idFromName(pageId)
        const stub = getRuntimeEnv().PAGE_DOC.get(id)

        return stub.fetch(new Request(request, { headers }))
      },
    },
  },
})

function isSafePageId(pageId: string) {
  return /^[a-zA-Z0-9_-]{1,120}$/.test(pageId)
}
