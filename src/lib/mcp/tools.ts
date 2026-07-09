import { z, ZodError } from 'zod'

import {
  WorkspaceRepositoryError,
  type WorkspaceRepository,
} from '#/lib/workspace/repository'
import {
  addPagePropertyOptionSchema,
  addPagePropertySchema,
  addRowSchema,
  attachPagePropertySchema,
  createBlockSchema,
  createPageSchema,
  deleteBlockSchema,
  deletePagePropertyOptionSchema,
  deletePagePropertySchema,
  deletePageSchema,
  deleteRowSchema,
  getPageSchema,
  importTextSchema,
  renamePagePropertyOptionSchema,
  renamePageSchema,
  setBlockCheckedSchema,
  setPageIconSchema,
  setPagePropertyValueSchema,
  updateBlockSchema,
  updatePagePropertySchema,
  updateRowSchema,
} from '#/lib/workspace/schemas'

/** The subset of the repository the MCP tools depend on. */
export type McpRepository = Pick<
  WorkspaceRepository,
  | 'listPages'
  | 'searchPages'
  | 'getPage'
  | 'getDatabaseById'
  | 'createPage'
  | 'renamePage'
  | 'setPageIcon'
  | 'deletePage'
  | 'createBlock'
  | 'updateBlock'
  | 'setBlockChecked'
  | 'deleteBlock'
  | 'addRow'
  | 'updateRow'
  | 'deleteRow'
  | 'importText'
  | 'listWorkspaceProperties'
  | 'addPageProperty'
  | 'attachPageProperty'
  | 'updatePageProperty'
  | 'deletePageProperty'
  | 'setPagePropertyValue'
  | 'addPagePropertyOption'
  | 'renamePagePropertyOption'
  | 'deletePagePropertyOption'
>

const mcpToolNames = [
  'list_workspaces',
  'search_pages',
  'read_page',
  'read_database',
  'create_page',
  'rename_page',
  'set_page_icon',
  'delete_page',
  'append_block',
  'update_block',
  'toggle_todo',
  'delete_block',
  'add_row',
  'update_row',
  'delete_row',
  'import_text',
  'list_workspace_properties',
  'add_page_property',
  'attach_page_property',
  'update_page_property',
  'remove_page_property',
  'set_page_property',
  'add_property_option',
  'rename_property_option',
  'remove_property_option',
] as const

export type McpToolName = (typeof mcpToolNames)[number]

/** A workspace the authenticated user can act in, as reported to MCP clients. */
export type McpWorkspaceInfo = {
  id: string
  name: string
  slug: string
  role: string
  isDefault: boolean
}

/**
 * Multi-workspace support for MCP. When present on the request context it
 * enables `list_workspaces` and lets any tool target a specific workspace via a
 * `workspaceId` argument; when absent, tools act on the single default
 * repository (used by unit tests and legacy single-workspace callers).
 */
export type McpWorkspaceGateway = {
  list: () => Promise<McpWorkspaceInfo[]>
  // Build a repository for workspaceId, validating the user's membership.
  repositoryFor: (workspaceId: string) => Promise<McpRepository>
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
const DEFAULT_SEARCH_LIMIT = 25
const MAX_SEARCH_LIMIT = 100
const searchPagesInputSchema = z.object({
  query: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
})
const readDatabaseInputSchema = z.object({ databaseId: z.string().min(1) })
// The property types a page property can be (mirrors propertyTypeSchema;
// select/multi_select/status carry options).
const PROPERTY_TYPE_VALUES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'created_time',
  'last_edited_time',
] as const
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

// Every page tool accepts an optional `workspaceId` to target a specific
// workspace (obtained from `list_workspaces`). Omit it to use your default
// (primary) workspace.
const workspaceIdProperty = {
  workspaceId: {
    type: 'string',
    description:
      'Optional workspace id to act in (from list_workspaces). Defaults to your primary workspace.',
  },
} as const

// MCP tool annotations are hints clients use to decide auto-approval and
// destructive-action warnings. readOnly = no writes; destructive = removes
// data; idempotent = repeating the same call has no additional effect.
type ToolAnnotations = {
  title: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
}

export const mcpToolDefinitions = [
  {
    name: 'list_workspaces',
    description:
      'List the workspaces you can access, with their ids and roles. Pass a returned id as `workspaceId` to other tools to act in that workspace.',
    annotations: { title: 'List workspaces', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'search_pages',
    description:
      'Search pages by title, slug, or body text. Returns page summaries.',
    annotations: { title: 'Search pages', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 120 },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          description: `Max results (default ${DEFAULT_SEARCH_LIMIT}).`,
        },
        ...workspaceIdProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    description: 'Read a workspace page (blocks and databases) by slug.',
    annotations: { title: 'Read page', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string' }, ...workspaceIdProperty },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_database',
    description:
      'Read a database (its properties, views, and all rows) by id. Get the id from a database block in read_page.',
    annotations: { title: 'Read database', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { databaseId: { type: 'string' }, ...workspaceIdProperty },
      required: ['databaseId'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_page',
    description: 'Create a new page, optionally nested under a parent page.',
    annotations: { title: 'Create page' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        parentPageId: { type: 'string' },
        ...workspaceIdProperty,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'rename_page',
    description: 'Rename a page.',
    annotations: { title: 'Rename page', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        title: { type: 'string', maxLength: 120 },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_page_icon',
    description: 'Set a page icon (a single emoji or short string).',
    annotations: { title: 'Set page icon', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        icon: { type: 'string', maxLength: 16 },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'icon'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_page',
    description: 'Delete a page and its sub-pages. This cannot be undone.',
    annotations: {
      title: 'Delete page',
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string' }, ...workspaceIdProperty },
      required: ['pageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'append_block',
    description: 'Append a block to the end of a page.',
    annotations: { title: 'Append block' },
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
        ...workspaceIdProperty,
      },
      required: ['pageId', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_block',
    description: 'Update a block using page, block, and version checks.',
    annotations: { title: 'Update block' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        blockId: { type: 'string' },
        content: { type: 'string', maxLength: 20_000 },
        version: { type: 'integer', minimum: 1 },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'blockId', 'content', 'version'],
      additionalProperties: false,
    },
  },
  {
    name: 'toggle_todo',
    description: 'Check or uncheck a to-do block.',
    annotations: { title: 'Toggle to-do', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        blockId: { type: 'string' },
        checked: { type: 'boolean' },
        ...workspaceIdProperty,
      },
      required: ['blockId', 'checked'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_block',
    description:
      'Delete a block. Deleting a database block removes the database and its rows. This cannot be undone.',
    annotations: {
      title: 'Delete block',
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { blockId: { type: 'string' }, ...workspaceIdProperty },
      required: ['blockId'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_row',
    description:
      'Add a row to a database. `values` maps property ids to cell values (see the database schema from read_page/read_database).',
    annotations: { title: 'Add database row' },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
        ...workspaceIdProperty,
      },
      required: ['databaseId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_row',
    description:
      'Update cell values on a database row. Provided values are merged into the existing row.',
    annotations: { title: 'Update database row', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rowId: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
        ...workspaceIdProperty,
      },
      required: ['rowId', 'values'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_row',
    description: 'Delete a database row. This cannot be undone.',
    annotations: {
      title: 'Delete database row',
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { rowId: { type: 'string' }, ...workspaceIdProperty },
      required: ['rowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'import_text',
    description: 'Import sanitized text as a new page.',
    annotations: { title: 'Import text' },
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 120 },
        body: { type: 'string', maxLength: 100_000 },
        source: { type: 'string', maxLength: 120 },
        ...workspaceIdProperty,
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_workspace_properties',
    description:
      'List the workspace-wide catalog of page property definitions (id, name, type, options). Property definitions are shared across pages — attach one to a page with attach_page_property; its options are shared everywhere it is used.',
    annotations: { title: 'List workspace properties', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { ...workspaceIdProperty },
      additionalProperties: false,
    },
  },
  {
    name: 'add_page_property',
    description:
      'Create a new shared property and attach it to a page. Prefer attach_page_property when a matching property already exists (see list_workspace_properties) so pages reuse definitions and options.',
    annotations: { title: 'Add page property' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        type: { type: 'string', enum: [...PROPERTY_TYPE_VALUES] },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'name', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'attach_page_property',
    description:
      'Attach an existing shared property (by id, from list_workspace_properties) to a page.',
    annotations: { title: 'Attach page property', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_page_property',
    description:
      "Rename or retype a shared property. This changes the definition everywhere it's used, not just on this page.",
    annotations: { title: 'Update page property', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        type: { type: 'string', enum: [...PROPERTY_TYPE_VALUES] },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_page_property',
    description:
      "Remove a property from a page (and clear this page's value for it). The shared definition stays in the catalog for other pages.",
    annotations: { title: 'Remove page property', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_page_property',
    description:
      'Set a page property value. `value` depends on the property type: text/url/email/phone/date = string, person = array of workspace member user ids, number = number, checkbox = boolean, select/status = option id, multi_select = array of option ids, or null to clear. Get property and option ids from read_page.',
    annotations: { title: 'Set page property value', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        value: {
          type: ['string', 'number', 'boolean', 'array', 'null'],
          items: { type: 'string' },
          description: 'The cell value; shape depends on the property type.',
        },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_property_option',
    description:
      'Add a select option to a select/multi_select/status property. The option is shared across every page that uses the property.',
    annotations: { title: 'Add property option' },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'rename_property_option',
    description:
      'Rename a select option (shared across every page that uses the property).',
    annotations: { title: 'Rename property option', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        optionId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId', 'optionId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_property_option',
    description:
      'Delete a select option (removes it everywhere the property is used and clears it from this page value). This cannot be undone.',
    annotations: {
      title: 'Remove property option',
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        propertyId: { type: 'string' },
        optionId: { type: 'string' },
        ...workspaceIdProperty,
      },
      required: ['pageId', 'propertyId', 'optionId'],
      additionalProperties: false,
    },
  },
] satisfies Array<{
  name: McpToolName
  description: string
  annotations: ToolAnnotations
  inputSchema: Record<string, unknown>
}>

const serverInfo = {
  name: 'Potion MCP',
  version: '1.0.0',
}

// Guidance surfaced to clients on `initialize` so the model uses the server
// correctly without trial and error.
const serverInstructions = [
  'Potion is a Notion-style workspace of pages, blocks, and databases.',
  'Call list_workspaces first if the user may have more than one workspace;',
  'pass a workspaceId to any tool to act there, or omit it to use the primary',
  'workspace. Read a page with read_page (by slug) and a database with',
  'read_database (by id, found on database blocks). Pages have Notion-style',
  'properties whose definitions are shared workspace-wide: list_workspace_properties',
  'shows the catalog, attach_page_property reuses one on a page, add_page_property',
  'creates a new one, and set_page_property sets a value (ids come from read_page).',
  'Editing a shared property or its select options changes it on every page that',
  'uses it. Writes are scoped to the chosen workspace; delete/remove tools are',
  'destructive and cannot be undone.',
].join(' ')

// Pages are also exposed as MCP resources for the primary workspace.
const PAGE_RESOURCE_PREFIX = 'potion://page/'

export type McpRequestContext = {
  // The default (primary) workspace repository; null when unauthenticated.
  repository: McpRepository | null
  // Optional multi-workspace gateway; enables list_workspaces + workspaceId.
  workspaces?: McpWorkspaceGateway | null
}

/** Resolved, authenticated context handed to individual tool handlers. */
type McpToolContext = {
  defaultRepository: McpRepository
  workspaces: McpWorkspaceGateway | null
}

/** Repository for a tool call: the requested workspace, or the default. */
async function repositoryForCall(
  context: McpToolContext,
  workspaceId?: string,
): Promise<McpRepository> {
  if (workspaceId && context.workspaces) {
    return context.workspaces.repositoryFor(workspaceId)
  }

  return context.defaultRepository
}

/** Pull an optional `workspaceId` off tool arguments, leaving the rest. */
function takeWorkspaceId(input: unknown): {
  workspaceId?: string
  rest: unknown
} {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const { workspaceId, ...rest } = input as Record<string, unknown>

    return {
      workspaceId: typeof workspaceId === 'string' ? workspaceId : undefined,
      rest,
    }
  }

  return { rest: input }
}

export async function resolveMcpHttpRequest(
  body: unknown,
  context: McpRequestContext,
): Promise<McpHttpResult> {
  const toolContext = buildToolContext(context)

  const legacyRequest = legacyToolRequestSchema.safeParse(body)

  if (legacyRequest.success) {
    if (!toolContext) {
      return { status: 401, body: { error: 'unauthenticated' } }
    }

    return toHttpResult(
      callMcpTool(
        legacyRequest.data.tool,
        legacyRequest.data.input,
        toolContext,
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
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
          },
          serverInfo,
          instructions: serverInstructions,
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

  // --- Resources (pages of the primary workspace) ------------------------
  if (method === 'resources/templates/list') {
    return {
      status: 200,
      body: { jsonrpc: '2.0', id, result: { resourceTemplates: [] } },
    }
  }

  if (method === 'resources/list' || method === 'resources/read') {
    if (!toolContext) {
      return {
        status: 401,
        body: jsonRpcError(id, -32001, 'Authentication required.'),
      }
    }

    try {
      const result =
        method === 'resources/list'
          ? await listPageResources(toolContext.defaultRepository)
          : await readPageResource(toolContext.defaultRepository, params)

      return { status: 200, body: { jsonrpc: '2.0', id, result } }
    } catch (error) {
      const mapped = mapToolError(error)

      return {
        status: mapped.status,
        body: jsonRpcError(id, mapped.rpcCode, mapped.message, mapped.data),
      }
    }
  }

  if (method !== 'tools/call') {
    return {
      status: 404,
      body: jsonRpcError(id, -32601, 'Unsupported MCP method.'),
    }
  }

  if (!toolContext) {
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
      toolContext,
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

function buildToolContext(context: McpRequestContext): McpToolContext | null {
  if (!context.repository) {
    return null
  }

  return {
    defaultRepository: context.repository,
    workspaces: context.workspaces ?? null,
  }
}

export async function callMcpTool(
  tool: McpToolName,
  input: unknown,
  context: McpToolContext,
): Promise<McpToolResult> {
  if (tool === 'list_workspaces') {
    const workspaces = context.workspaces ? await context.workspaces.list() : []

    return toolResult({ workspaces })
  }

  const { workspaceId, rest } = takeWorkspaceId(input)
  const repository = await repositoryForCall(context, workspaceId)

  if (tool === 'search_pages') {
    const data = searchPagesInputSchema.parse(rest ?? {})
    const limit = data.limit ?? DEFAULT_SEARCH_LIMIT
    const query = data.query?.trim()
    const pages = query
      ? await repository.searchPages(query, limit)
      : (await repository.listPages()).slice(0, limit)

    return toolResult({ pages })
  }

  if (tool === 'read_page') {
    const data = getPageSchema.parse(rest ?? {})
    const page = await repository.getPage(data.slug)

    if (!page) {
      throw new WorkspaceRepositoryError(
        'page_not_found',
        'Workspace page was not found.',
      )
    }

    return toolResult({ page })
  }

  if (tool === 'read_database') {
    const data = readDatabaseInputSchema.parse(rest ?? {})
    const database = await repository.getDatabaseById(data.databaseId)

    if (!database) {
      throw new WorkspaceRepositoryError(
        'database_not_found',
        'Database was not found.',
      )
    }

    return toolResult({ database })
  }

  if (tool === 'create_page') {
    const data = createPageSchema.parse(rest ?? {})
    const page = await repository.createPage(data)

    return toolResult({ page })
  }

  if (tool === 'rename_page') {
    const data = renamePageSchema.parse(rest ?? {})
    const page = await repository.renamePage(data)

    return toolResult({ page })
  }

  if (tool === 'set_page_icon') {
    const data = setPageIconSchema.parse(rest ?? {})
    const result = await repository.setPageIcon(data)

    return toolResult(result)
  }

  if (tool === 'delete_page') {
    const data = deletePageSchema.parse(rest ?? {})
    const result = await repository.deletePage(data)

    return toolResult(result)
  }

  if (tool === 'append_block') {
    const data = createBlockSchema.parse(rest ?? {})
    const block = await repository.createBlock(data)

    return toolResult({ block })
  }

  if (tool === 'update_block') {
    const data = updateBlockSchema.parse(rest ?? {})
    const update = await repository.updateBlock(data)

    return toolResult({ update })
  }

  if (tool === 'toggle_todo') {
    const data = setBlockCheckedSchema.parse(rest ?? {})
    const result = await repository.setBlockChecked(data)

    return toolResult(result)
  }

  if (tool === 'delete_block') {
    const data = deleteBlockSchema.parse(rest ?? {})
    const result = await repository.deleteBlock(data)

    return toolResult(result)
  }

  if (tool === 'add_row') {
    const data = addRowSchema.parse(rest ?? {})
    const row = await repository.addRow(data)

    return toolResult({ row })
  }

  if (tool === 'update_row') {
    const data = updateRowSchema.parse(rest ?? {})
    const result = await repository.updateRow(data)

    return toolResult(result)
  }

  if (tool === 'delete_row') {
    const data = deleteRowSchema.parse(rest ?? {})
    const result = await repository.deleteRow(data)

    return toolResult(result)
  }

  if (tool === 'list_workspace_properties') {
    const properties = await repository.listWorkspaceProperties()

    return toolResult({ properties })
  }

  if (tool === 'add_page_property') {
    const data = addPagePropertySchema.parse(rest ?? {})
    const result = await repository.addPageProperty(data)

    return toolResult(result)
  }

  if (tool === 'attach_page_property') {
    const data = attachPagePropertySchema.parse(rest ?? {})
    const result = await repository.attachPageProperty(data)

    return toolResult(result)
  }

  if (tool === 'update_page_property') {
    const data = updatePagePropertySchema.parse(rest ?? {})
    const result = await repository.updatePageProperty(data)

    return toolResult(result)
  }

  if (tool === 'remove_page_property') {
    const data = deletePagePropertySchema.parse(rest ?? {})
    const result = await repository.deletePageProperty(data)

    return toolResult(result)
  }

  if (tool === 'set_page_property') {
    const data = setPagePropertyValueSchema.parse(rest ?? {})
    const result = await repository.setPagePropertyValue(data)

    return toolResult(result)
  }

  if (tool === 'add_property_option') {
    const data = addPagePropertyOptionSchema.parse(rest ?? {})
    const result = await repository.addPagePropertyOption(data)

    return toolResult(result)
  }

  if (tool === 'rename_property_option') {
    const data = renamePagePropertyOptionSchema.parse(rest ?? {})
    const result = await repository.renamePagePropertyOption(data)

    return toolResult(result)
  }

  if (tool === 'remove_property_option') {
    const data = deletePagePropertyOptionSchema.parse(rest ?? {})
    const result = await repository.deletePagePropertyOption(data)

    return toolResult(result)
  }

  const data = importTextSchema.parse(rest ?? {})
  const page = await repository.importText(data)

  return toolResult({ page })
}

// --- Resources -----------------------------------------------------------

async function listPageResources(repository: McpRepository) {
  const pages = await repository.listPages()

  return {
    resources: pages.map((page) => ({
      uri: `${PAGE_RESOURCE_PREFIX}${page.slug}`,
      name: page.title || 'Untitled',
      description: `Workspace page: ${page.title || 'Untitled'}`,
      mimeType: 'application/json',
    })),
  }
}

const resourceReadParamsSchema = z.object({ uri: z.string() })

async function readPageResource(repository: McpRepository, params: unknown) {
  const { uri } = resourceReadParamsSchema.parse(params ?? {})

  if (!uri.startsWith(PAGE_RESOURCE_PREFIX)) {
    throw new WorkspaceRepositoryError(
      'page_not_found',
      `Unknown resource uri: ${uri}`,
    )
  }

  const slug = uri.slice(PAGE_RESOURCE_PREFIX.length)
  const page = await repository.getPage(slug)

  if (!page) {
    throw new WorkspaceRepositoryError(
      'page_not_found',
      'Workspace page was not found.',
    )
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(page),
      },
    ],
  }
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
