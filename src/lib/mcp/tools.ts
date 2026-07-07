import { z, ZodError } from 'zod'

import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '#/lib/workspace/repository'
import {
  createBlockSchema,
  createPageSchema,
  getPageSchema,
  importTextSchema,
  updateBlockSchema,
} from '#/lib/workspace/schemas'

/** The subset of the repository the MCP tools depend on. */
export type McpRepository = Pick<
  WorkspaceRepository,
  | 'listPages'
  | 'getPage'
  | 'createPage'
  | 'createBlock'
  | 'updateBlock'
  | 'importText'
>

const mcpToolNames = [
  'search_pages',
  'read_page',
  'create_page',
  'append_block',
  'update_block',
  'import_text',
] as const

export type McpToolName = (typeof mcpToolNames)[number]

type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: unknown
}

type McpHttpResult = {
  status: number
  body: unknown
}

const mcpToolNameSchema = z.enum(mcpToolNames)
const unknownRecordSchema = z.record(z.string(), z.unknown())
const searchPagesInputSchema = z.object({
  query: z.string().max(120).optional(),
})
const legacyToolRequestSchema = z.object({
  tool: mcpToolNameSchema,
  input: z.unknown().optional(),
})
const jsonRpcIdSchema = z.union([z.string(), z.number(), z.null()])
const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: jsonRpcIdSchema.optional(),
  method: z.string(),
  params: unknownRecordSchema.optional(),
})
const toolCallParamsSchema = z.object({
  name: mcpToolNameSchema,
  arguments: z.unknown().optional(),
})

export const mcpToolDefinitions = [
  {
    name: 'search_pages',
    description: 'Search the workspace pages you have access to.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 120 } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    description: 'Read a workspace page (blocks and collections) by slug.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_page',
    description: 'Create a new page, optionally nested under a parent page.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        parentPageId: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'append_block',
    description: 'Append a block to the end of a page.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        type: {
          type: 'string',
          enum: [
            'paragraph',
            'heading_1',
            'heading_2',
            'heading_3',
            'to_do',
            'quote',
            'callout',
            'divider',
            'database',
          ],
        },
        content: { type: 'string', maxLength: 20_000 },
      },
      required: ['pageId', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_block',
    description: 'Update a block using page, block, and version checks.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        blockId: { type: 'string' },
        content: { type: 'string', maxLength: 20_000 },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['pageId', 'blockId', 'content', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_text',
    description: 'Import sanitized text as a new page.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 100_000 },
        source: { type: 'string', maxLength: 120 },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
] satisfies Array<{
  name: McpToolName
  description: string
  inputSchema: Record<string, unknown>
}>

const serverInfo = {
  name: 'Potion MCP',
  version: '1.0.0',
}

export type McpRequestContext = {
  repository: McpRepository | null
}

export async function resolveMcpHttpRequest(
  body: unknown,
  context: McpRequestContext,
): Promise<McpHttpResult> {
  const legacyRequest = legacyToolRequestSchema.safeParse(body)

  if (legacyRequest.success) {
    if (!context.repository) {
      return { status: 401, body: { error: 'unauthenticated' } }
    }

    return toHttpResult(
      callMcpTool(
        legacyRequest.data.tool,
        legacyRequest.data.input,
        context.repository,
      ),
    )
  }

  const rpcRequest = jsonRpcRequestSchema.safeParse(body)

  if (!rpcRequest.success) {
    return {
      status: 400,
      body: { error: 'invalid_mcp_request', issues: rpcRequest.error.issues },
    }
  }

  const { method, params } = rpcRequest.data
  const id = rpcRequest.data.id ?? null

  // Notifications (no id) never expect a response body.
  if (method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }

  if (method === 'initialize') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo,
        },
      },
    }
  }

  if (method === 'ping') {
    return { status: 200, body: { jsonrpc: '2.0', id, result: {} } }
  }

  if (method === 'tools/list') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: { tools: mcpToolDefinitions },
      },
    }
  }

  if (method !== 'tools/call') {
    return {
      status: 404,
      body: jsonRpcError(id, -32601, 'Unsupported MCP method.'),
    }
  }

  if (!context.repository) {
    return {
      status: 401,
      body: jsonRpcError(id, -32001, 'Authentication required.'),
    }
  }

  const parsedParams = toolCallParamsSchema.safeParse(params ?? {})

  if (!parsedParams.success) {
    return {
      status: 400,
      body: jsonRpcError(id, -32602, 'Invalid MCP tool call.', {
        issues: parsedParams.error.issues,
      }),
    }
  }

  try {
    const result = await callMcpTool(
      parsedParams.data.name,
      parsedParams.data.arguments,
      context.repository,
    )

    return { status: 200, body: { jsonrpc: '2.0', id, result } }
  } catch (error) {
    const mapped = mapToolError(error)

    return {
      status: mapped.status,
      body: jsonRpcError(id, mapped.rpcCode, mapped.message, mapped.data),
    }
  }
}

export async function callMcpTool(
  tool: McpToolName,
  input: unknown,
  repository: McpRepository,
): Promise<McpToolResult> {
  if (tool === 'search_pages') {
    const data = searchPagesInputSchema.parse(input ?? {})
    const query = data.query?.trim().toLowerCase()
    const pages = await repository.listPages()

    return toolResult({
      pages: query
        ? pages.filter((page) =>
            `${page.title} ${page.slug}`.toLowerCase().includes(query),
          )
        : pages,
    })
  }

  if (tool === 'read_page') {
    const data = getPageSchema.parse(input ?? {})
    const page = await repository.getPage(data.slug)

    if (!page) {
      throw new WorkspaceRepositoryError(
        'page_not_found',
        'Workspace page was not found.',
      )
    }

    return toolResult({ page })
  }

  if (tool === 'create_page') {
    const data = createPageSchema.parse(input ?? {})
    const page = await repository.createPage(data)

    return toolResult({ page })
  }

  if (tool === 'append_block') {
    const data = createBlockSchema.parse(input ?? {})
    const block = await repository.createBlock(data)

    return toolResult({ block })
  }

  if (tool === 'update_block') {
    const data = updateBlockSchema.parse(input ?? {})
    const update = await repository.updateBlock(data)

    return toolResult({ update })
  }

  const data = importTextSchema.parse(input ?? {})
  const page = await repository.importText(data)

  return toolResult({ page })
}

async function toHttpResult(
  result: Promise<McpToolResult>,
): Promise<McpHttpResult> {
  try {
    return { status: 200, body: await result }
  } catch (error) {
    const mapped = mapToolError(error)

    return {
      status: mapped.status,
      body: { error: mapped.code, message: mapped.message, data: mapped.data },
    }
  }
}

function toolResult(structuredContent: unknown): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

function mapToolError(error: unknown) {
  if (error instanceof WorkspaceRepositoryError) {
    const status =
      error.code === 'version_conflict'
        ? 409
        : error.code === 'page_not_found' ||
            error.code === 'block_not_found' ||
            error.code === 'database_not_found' ||
            error.code === 'view_not_found' ||
            error.code === 'property_not_found' ||
            error.code === 'row_not_found'
          ? 404
          : 400

    return {
      status,
      rpcCode: -32002,
      code: error.code,
      message: error.message,
      data: null,
    }
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      rpcCode: -32602,
      code: 'invalid_input',
      message: 'Invalid MCP tool input.',
      data: { issues: error.issues },
    }
  }

  return {
    status: 500,
    rpcCode: -32603,
    code: 'internal_error',
    message: 'MCP tool call failed.',
    data: null,
  }
}
