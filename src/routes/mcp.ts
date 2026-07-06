import { createFileRoute } from '@tanstack/react-router'

const mcpTools = [
  'search_pages',
  'read_page',
  'create_page',
  'update_block',
  'move_block',
  'list_collection_rows',
  'comment_on_page',
]

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          name: 'Potion MCP',
          status: 'auth-ready',
          transport: 'streamable-http',
          tools: mcpTools,
        }),
      POST: () =>
        Response.json(
          {
            error:
              'MCP transport is scaffolded but not connected to tools yet.',
          },
          { status: 501 },
        ),
    },
  },
})
