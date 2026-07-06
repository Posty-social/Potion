import { z, ZodError } from 'zod'

import {
  WorkspaceAccessError,
  requireWorkspaceAccess,
  type WorkspaceAccess,
} from '#/lib/workspace/access'
import {
  WorkspaceRepositoryError,
  workspaceRepository,
  type WorkspaceRepository,
} from '#/lib/workspace/repository'
import {
  getPageSchema,
  importPrivateChatSchema,
  updateBlockSchema,
} from '#/lib/workspace/schemas'

const mcpToolNames = [
  'search_pages',
  'read_page',
  'update_block',
  'import_private_chat',
] as const

export type McpToolName = (typeof mcpToolNames)[number]

type McpToolContext = {
  access: WorkspaceAccess
  repository?: WorkspaceRepository
}

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
    description: 'Search private workspace page summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 120 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    description: 'Read a private workspace page by slug.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
      },
      required: ['slug'],
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
    name: 'import_private_chat',
    description: 'Import sanitized private chat text as a private page.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        transcript: { type: 'string', maxLength: 100_000 },
        source: { type: 'string', maxLength: 120 },
      },
      required: ['title', 'transcript'],
      additionalProperties: false,
    },
  },
] satisfies Array<{
  name: McpToolName
  description: string
  inputSchema: Record<string, unknown>
}>

export async function resolveMcpHttpRequest(
  body: unknown,
  context: McpToolContext,
): Promise<McpHttpResult> {
  const legacyRequest = legacyToolRequestSchema.safeParse(body)

  if (legacyRequest.success) {
    return toHttpResult(
      callMcpTool(legacyRequest.data.tool, legacyRequest.data.input, context),
    )
  }

  const rpcRequest = jsonRpcRequestSchema.safeParse(body)

  if (!rpcRequest.success) {
    return {
      status: 400,
      body: {
        error: 'invalid_mcp_request',
        issues: rpcRequest.error.issues,
      },
    }
  }

  const id = rpcRequest.data.id ?? null

  if (rpcRequest.data.method === 'tools/list') {
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          tools: mcpToolDefinitions,
        },
      },
    }
  }

  if (rpcRequest.data.method !== 'tools/call') {
    return {
      status: 404,
      body: jsonRpcError(id, -32601, 'Unsupported MCP method.'),
    }
  }

  const params = toolCallParamsSchema.safeParse(rpcRequest.data.params ?? {})

  if (!params.success) {
    return {
      status: 400,
      body: jsonRpcError(id, -32602, 'Invalid MCP tool call.', {
        issues: params.error.issues,
      }),
    }
  }

  try {
    const result = await callMcpTool(
      params.data.name,
      params.data.arguments,
      context,
    )

    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id,
        result,
      },
    }
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
  { access, repository = workspaceRepository }: McpToolContext,
): Promise<McpToolResult> {
  requireWorkspaceAccess(access)

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

  if (tool === 'update_block') {
    const data = updateBlockSchema.parse(input ?? {})
    const update = await repository.updateBlock(data)

    return toolResult({ update })
  }

  const data = importPrivateChatSchema.parse(input ?? {})
  const page = await repository.importPrivateChat(data)

  return toolResult({ page })
}

async function toHttpResult(
  result: Promise<McpToolResult>,
): Promise<McpHttpResult> {
  try {
    return {
      status: 200,
      body: await result,
    }
  } catch (error) {
    const mapped = mapToolError(error)

    return {
      status: mapped.status,
      body: {
        error: mapped.code,
        message: mapped.message,
        data: mapped.data,
      },
    }
  }
}

function toolResult(structuredContent: unknown): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
  }
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  }
}

function mapToolError(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return {
      status: error.code === 'unauthenticated' ? 401 : 403,
      rpcCode: -32001,
      code: error.code,
      message: error.message,
      data: null,
    }
  }

  if (error instanceof WorkspaceRepositoryError) {
    const status =
      error.code === 'version_conflict'
        ? 409
        : error.code === 'page_not_found' || error.code === 'block_not_found'
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
      data: {
        issues: error.issues,
      },
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
