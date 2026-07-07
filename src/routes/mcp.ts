import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/lib/db/connection'
import { mcpToolDefinitions, resolveMcpHttpRequest } from '#/lib/mcp/tools'
import { resolveMcpContext } from '#/lib/workspace/access.server'
import { createWorkspaceRepository } from '#/lib/workspace/repository'

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          name: 'Potion MCP',
          status: 'ready',
          transport: 'streamable-http',
          tools: mcpToolDefinitions,
        }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null)
        const context = await resolveMcpContext(request.headers)
        const repository = context
          ? createWorkspaceRepository(db, context)
          : null

        const result = await resolveMcpHttpRequest(body, { repository })
        const headers = new Headers()

        if (result.status === 401) {
          const resourceMetadata = new URL(
            '/.well-known/oauth-protected-resource',
            request.url,
          ).toString()
          headers.set(
            'WWW-Authenticate',
            `Bearer resource_metadata="${resourceMetadata}"`,
          )
        }

        if (result.body === null) {
          return new Response(null, { status: result.status, headers })
        }

        return Response.json(result.body, { status: result.status, headers })
      },
    },
  },
})
