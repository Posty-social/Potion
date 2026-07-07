import { createFileRoute } from '@tanstack/react-router'

import { db } from '#/lib/db/connection'
import {
  mcpToolDefinitions,
  resolveMcpHttpRequest,
  type McpWorkspaceGateway,
} from '#/lib/mcp/tools'
import {
  listUserWorkspaces,
  resolveMcpContext,
} from '#/lib/workspace/access.server'
import {
  createWorkspaceRepository,
  WorkspaceRepositoryError,
} from '#/lib/workspace/repository'

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

        // Multi-workspace gateway: lets MCP clients list workspaces and target
        // one by id. `context.organizationId` is the default (primary) one.
        const workspaces: McpWorkspaceGateway | null = context
          ? {
              async list() {
                const memberships = await listUserWorkspaces(context.userId)
                return memberships.map((workspace) => ({
                  ...workspace,
                  isDefault: workspace.id === context.organizationId,
                }))
              },
              async repositoryFor(workspaceId) {
                const memberships = await listUserWorkspaces(context.userId)
                if (!memberships.some((w) => w.id === workspaceId)) {
                  throw new WorkspaceRepositoryError(
                    'invalid_input',
                    'You are not a member of that workspace.',
                  )
                }
                return createWorkspaceRepository(db, {
                  organizationId: workspaceId,
                  userId: context.userId,
                })
              },
            }
          : null

        const result = await resolveMcpHttpRequest(body, {
          repository,
          workspaces,
        })
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
