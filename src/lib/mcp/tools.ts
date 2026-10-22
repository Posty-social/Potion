import { z, ZodError } from 'zod'

import {
  CellValueError,
  buildRowConditions,
  normalizeCellValue,
  normalizeRowValues,
  valuesByName,
  type MemberRef,
} from '#/lib/workspace/cell-values'
import {
  WorkspaceRepositoryError,
  type AgentPage,
  type WorkspaceRepository,
} from '#/lib/workspace/repository'
import {
  addPagePropertyOptionSchema,
  addPagePropertySchema,
  addPropertyOptionSchema,
  addPropertySchema,
  attachPagePropertySchema,
  createBlockSchema,
  createPageSchema,
  deleteBlockSchema,
  deletePagePropertyOptionSchema,
  deletePagePropertySchema,
  deletePageSchema,
  deletePropertyOptionSchema,
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
  updatePropertyOptionSchema,
  updatePropertySchema,
  updateRowBodySchema,
} from '#/lib/workspace/schemas'
import type { CellValue, DatabaseProperty } from '#/lib/workspace/types'

import { prepareAssetUpload, uploadAssetInputSchema } from './assets'

/** The subset of the repository the MCP tools depend on. */
export type McpRepository = Pick<
  WorkspaceRepository,
  | 'listPages'
  | 'searchPages'
  | 'getPageForAgent'
  | 'getDatabaseRowsPage'
  | 'searchRows'
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
  | 'updateRowBody'
  | 'deleteRow'
  | 'addProperty'
  | 'updateProperty'
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
  | 'listMembers'
  | 'getPageById'
  | 'getDatabaseSchema'
  | 'getRow'
  | 'setRowsArchived'
  | 'addPropertyOption'
  | 'updatePropertyOption'
  | 'deletePropertyOption'
  | 'uploadAsset'
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
  'update_row_body',
  'delete_row',
  'add_database_property',
  'update_database_property',
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
  'list_members',
  'read_row',
  'search_rows',
  'archive_row',
  'unarchive_row',
  'add_database_option',
  'update_database_option',
  'remove_database_option',
  'upload_asset',
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
const DEFAULT_ROW_LIMIT = 100
const MAX_ROW_LIMIT = 500
// read_page inlines at most this many (non-archived, body-less) rows per
// database; read_database pages through the rest.
const PAGE_ROW_PREVIEW_LIMIT = 50
const mcpId = z.string().min(1).max(120)
const valueFormatSchema = z.enum(['ids', 'names']).optional()
const readDatabaseInputSchema = z.object({
  databaseId: mcpId,
  includeArchived: z.boolean().optional(),
  includeBodies: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_ROW_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  where: z.record(z.string(), z.unknown()).optional(),
  valueFormat: valueFormatSchema,
})
const readRowInputSchema = z.object({
  rowId: mcpId,
  valueFormat: valueFormatSchema,
})
const readPageInputSchema = getPageSchema.extend({
  valueFormat: valueFormatSchema,
})
const DEFAULT_ROW_SEARCH_LIMIT = 20
const searchRowsInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  databaseId: mcpId.optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
})
const rowValuesInputSchema = z.record(z.string(), z.unknown())
const addRowInputSchema = z.object({
  databaseId: mcpId,
  values: rowValuesInputSchema.optional(),
  body: z.string().max(100_000).optional(),
})
const updateRowInputSchema = z.object({
  rowId: mcpId,
  values: rowValuesInputSchema,
  expectedVersion: z.number().int().min(1).optional(),
})
const archiveRowInputSchema = z
  .object({
    rowId: mcpId.optional(),
    rowIds: z.array(mcpId).min(1).max(200).optional(),
  })
  .refine((input) => input.rowId || input.rowIds, {
    message: 'Provide rowId or rowIds.',
  })
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
  'page',
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
    description: `Read a workspace page (blocks, page properties and databases) by slug. To keep the response small, each database inlines at most ${PAGE_ROW_PREVIEW_LIMIT} non-archived rows without their bodies; use read_database to page through rows and read_row for a full row body.`,
    annotations: { title: 'Read page', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        valueFormat: {
          type: 'string',
          enum: ['ids', 'names'],
          description:
            '"ids" (default) returns cells keyed by column id with option/user ids. "names" returns them keyed by column name with option names, people as { id, name, email }, and url cells as lists — the same names add_row/update_row accept.',
        },
        ...workspaceIdProperty,
      },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_database',
    description: `Read a database's columns (with option ids/names/colours), views and rows by id (from a database block in read_page). Rows are paged (default ${DEFAULT_ROW_LIMIT}, max ${MAX_ROW_LIMIT}; follow \`paging.nextOffset\`). Archived rows are left out unless includeArchived is true — \`archivedRowsHidden\` says how many. Row bodies are left out unless includeBodies is true (each row has \`hasBody\`); read_row returns one row with its body.`,
    annotations: { title: 'Read database', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        includeArchived: {
          type: 'boolean',
          description: 'Include archived rows (default false).',
        },
        includeBodies: {
          type: 'boolean',
          description: 'Include each row Markdown body (default false).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_ROW_LIMIT,
          description: `Rows per page (default ${DEFAULT_ROW_LIMIT}).`,
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Rows to skip (default 0).',
        },
        where: {
          type: 'object',
          additionalProperties: true,
          description:
            'Filter rows. Keys are column ids or names; each value is a value, a list of alternatives, or null for "empty". Option names, member emails and ISO dates work as in add_row; text, url, email and phone columns match by case-insensitive "contains". All keys must match, e.g. { "Status": "Done", "Owner": "ada@posty.social" }.',
        },
        valueFormat: {
          type: 'string',
          enum: ['ids', 'names'],
          description:
            '"ids" (default) returns cells keyed by column id with option/user ids. "names" returns them keyed by column name with option names, people as { id, name, email }, and url cells as lists — the same names add_row/update_row accept.',
        },
        ...workspaceIdProperty,
      },
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
    description:
      'Append a block to the end of a page. For image/video blocks, `content` is the media URL — an /api/assets/… path (from upload_asset or an app upload) or any https URL; video also accepts YouTube/Vimeo links, which render as embeds.',
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
            'image',
            'video',
            'database',
          ],
        },
        content: { type: 'string', maxLength: 20_000 },
        databaseTitle: {
          type: 'string',
          maxLength: 120,
          description: 'For database blocks: the database title.',
        },
        initialView: {
          type: 'string',
          enum: ['table', 'board', 'list', 'gallery', 'calendar'],
          description:
            'For database blocks: the first view (default table). A board groups cards by the Status column.',
        },
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
      'Add a row (card) to a database, optionally with its Markdown `body`. `values` maps column ids or column names to cell values: title/text/email/phone = string; number = number; checkbox = boolean; select/status = option id or option name; multi_select = array of option ids/names; person = array of user ids, emails or names (see list_members); date = ISO date "YYYY-MM-DD" (a datetime keeps its date part); url = one URL, several URLs one per line, or an array of URLs; page = page id; null clears a cell. Unknown columns or options are rejected with the valid choices — add missing options with add_database_option.',
    annotations: { title: 'Add database row' },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
        body: { type: 'string', maxLength: 100_000 },
        ...workspaceIdProperty,
      },
      required: ['databaseId'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_row',
    description:
      'Update cell values on a database row; provided values are merged into the existing row. `values` maps column ids or column names to cell values: title/text/email/phone = string; number = number; checkbox = boolean; select/status = option id or option name; multi_select = array of option ids/names; person = array of user ids, emails or names (see list_members); date = ISO date "YYYY-MM-DD" (a datetime keeps its date part); url = one URL, several URLs one per line, or an array of URLs; page = page id; null clears a cell. Unknown columns or options are rejected with the valid choices — add missing options with add_database_option.',
    annotations: { title: 'Update database row', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rowId: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
        expectedVersion: {
          type: 'integer',
          minimum: 1,
          description:
            "Optional: the row `version` you last read. The update fails with a version conflict if the row has changed since, instead of overwriting someone else's edit. Only the given cells are written either way.",
        },
        ...workspaceIdProperty,
      },
      required: ['rowId', 'values'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_row_body',
    description:
      "Set a database row's page body — the Markdown content shown in the side panel when the row (card) is opened. Replaces the existing body. Embed screenshots with ![alt](/api/assets/…) using the path from upload_asset.",
    annotations: { title: 'Update row body', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rowId: { type: 'string' },
        body: { type: 'string', maxLength: 100_000 },
        ...workspaceIdProperty,
      },
      required: ['rowId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_row',
    description:
      'Permanently delete a database row. This cannot be undone — to clear finished cards off a board, prefer archive_row.',
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
    name: 'add_database_property',
    description:
      'Add a column (property) to a database. Returns the new propertyId (and option ids for select/multi_select/status columns seeded via `options`); set cell values with add_row/update_row. Manage options later with add_database_option / update_database_option / remove_database_option.',
    annotations: { title: 'Add database column' },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        type: { type: 'string', enum: [...PROPERTY_TYPE_VALUES] },
        options: {
          type: 'array',
          maxItems: 50,
          description:
            'Initial options for select/multi_select/status columns: names, or { name, color } objects. Palette colour name: blue, green, yellow, purple, red, teal or gray (hex values from the same palette also work). Omitted colours are chosen automatically.',
          items: {
            anyOf: [
              { type: 'string', maxLength: 80 },
              {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 80 },
                  color: { type: 'string' },
                },
                required: ['name'],
                additionalProperties: false,
              },
            ],
          },
        },
        ...workspaceIdProperty,
      },
      required: ['databaseId', 'name', 'type'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_database_property',
    description:
      'Rename or retype a database column. The title column cannot be retyped.',
    annotations: { title: 'Update database column', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        propertyId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        type: { type: 'string', enum: [...PROPERTY_TYPE_VALUES] },
        ...workspaceIdProperty,
      },
      required: ['databaseId', 'propertyId'],
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
      'Set a page property value (not a database cell — use update_row for those). `value` depends on the property type: text/email/phone = string, date = ISO date "YYYY-MM-DD", url = one or more URLs (one per line or an array), person = array of user ids, emails or names (see list_members), page = a workspace page id (a link to that page), number = number, checkbox = boolean, select/status = option id or name, multi_select = array of option ids or names, or null to clear. Unknown options are rejected. Get property and option ids from read_page.',
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
      'Add an option to a shared page property (select/multi_select/status, from read_page or list_workspace_properties). The option is shared across every page that uses the property. For database columns use add_database_option.',
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
      'Rename an option of a shared page property (shared across every page that uses it). For database columns use update_database_option.',
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
      'Delete an option of a shared page property (removes it everywhere the property is used and clears it from this page value). This cannot be undone. For database columns use remove_database_option.',
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
  {
    name: 'list_members',
    description:
      'List the members of a workspace: user id, name, email and role. Use these to set person columns (add_row/update_row also accept an email or unique name directly).',
    annotations: { title: 'List members', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { ...workspaceIdProperty },
      additionalProperties: false,
    },
  },
  {
    name: 'read_row',
    description:
      'Read one database row (card) by id, including its Markdown body, archive state and databaseId.',
    annotations: { title: 'Read database row', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rowId: { type: 'string' },
        valueFormat: {
          type: 'string',
          enum: ['ids', 'names'],
          description:
            '"ids" (default) returns cells keyed by column id with option/user ids. "names" returns them keyed by column name with option names, people as { id, name, email }, and url cells as lists — the same names add_row/update_row accept.',
        },
        ...workspaceIdProperty,
      },
      required: ['rowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_rows',
    description:
      'Find database rows (cards) by text: matches title, text, url, email and phone cells and the row body, case-insensitively, across the workspace or within one database. Returns row and database ids, the title, where it matched and an excerpt. Archived rows are skipped unless includeArchived is true. To filter by status, owner or date use read_database `where`.',
    annotations: { title: 'Search database rows', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200 },
        databaseId: {
          type: 'string',
          description: 'Optional: only search this database.',
        },
        includeArchived: { type: 'boolean' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          description: `Max results (default ${DEFAULT_ROW_SEARCH_LIMIT}).`,
        },
        ...workspaceIdProperty,
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'archive_row',
    description:
      'Archive one or more database rows (cards). Archived rows keep all their data but are hidden from board/table views and from read_database by default. Reversible with unarchive_row; nothing is deleted.',
    annotations: { title: 'Archive database rows', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rowId: { type: 'string' },
        rowIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 200,
        },
        ...workspaceIdProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'unarchive_row',
    description:
      'Restore archived database rows so they show in views and read_database again.',
    annotations: { title: 'Unarchive database rows', idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rowId: { type: 'string' },
        rowIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 200,
        },
        ...workspaceIdProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_database_option',
    description:
      'Add an option to a database select, multi_select or status column (board columns are the options of the grouping column). Returns the new option id. Omit `color` to pick an unused palette colour.',
    annotations: { title: 'Add database column option' },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        propertyId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        color: {
          type: 'string',
          description:
            'Palette colour name: blue, green, yellow, purple, red, teal or gray (hex values from the same palette also work).',
        },
        ...workspaceIdProperty,
      },
      required: ['databaseId', 'propertyId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_database_option',
    description:
      'Rename and/or recolour an option of a database select, multi_select or status column. Cells keep pointing at the option.',
    annotations: {
      title: 'Update database column option',
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        propertyId: { type: 'string' },
        optionId: { type: 'string' },
        name: { type: 'string', maxLength: 80 },
        color: {
          type: 'string',
          description:
            'Palette colour name: blue, green, yellow, purple, red, teal or gray (hex values from the same palette also work).',
        },
        ...workspaceIdProperty,
      },
      required: ['databaseId', 'propertyId', 'optionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_database_option',
    description:
      'Delete an option from a database select, multi_select or status column and clear it from every row that used it. This cannot be undone.',
    annotations: {
      title: 'Remove database column option',
      destructiveHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string' },
        propertyId: { type: 'string' },
        optionId: { type: 'string' },
        ...workspaceIdProperty,
      },
      required: ['databaseId', 'propertyId', 'optionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_asset',
    description:
      'Upload an image (PNG, JPEG, GIF, WebP or AVIF, max 10MB) to the workspace and get its /api/assets/… path. Send base64 `data` (a data: URL is fine) or an https `url` for the server to fetch. Use the returned `path` as an image block `content` (append_block type image) or in a row body as the returned `markdown` (![alt](path)).',
    annotations: { title: 'Upload image asset' },
    inputSchema: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          maxLength: 180,
          description: 'Optional file name, e.g. "login-bug.png".',
        },
        mime: {
          type: 'string',
          description:
            'Optional MIME type (must be image/*). The stored type is detected from the bytes.',
        },
        data: { type: 'string', description: 'Base64-encoded image bytes.' },
        url: { type: 'string', description: 'An https image URL to fetch.' },
        ...workspaceIdProperty,
      },
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
  'read_database (by id, found on database blocks; rows are paged, archived rows',
  'and row bodies are left out by default; read_row returns one full row). Pages',
  'have Notion-style properties whose definitions are shared workspace-wide:',
  'list_workspace_properties shows the catalog, attach_page_property reuses one',
  'on a page, add_page_property creates a new one, set_page_property sets a value,',
  'and add/rename/remove_property_option edit their options. Databases have their',
  'own per-database columns: add_database_property adds one,',
  'update_database_property renames or retypes it, add/update/remove_database_option',
  'manage select/status options (board columns), and cell values are set through',
  'add_row/update_row (option names, member emails and ISO dates are accepted).',
  'list_members maps user ids to names. upload_asset stores an image and returns',
  'an /api/assets path for image blocks and row-body Markdown. archive_row hides',
  'finished cards reversibly. Writes are scoped to the chosen workspace;',
  'delete/remove tools are destructive and cannot be undone.',
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
    const requested = (params as { name?: unknown } | undefined)?.name
    return {
      status: 400,
      body: jsonRpcError(
        id,
        -32602,
        typeof requested === 'string' &&
          !mcpToolNameSchema.safeParse(requested).success
          ? `Unknown tool "${requested}". Call tools/list for the available tools.`
          : 'Invalid MCP tool call.',
        { issues: parsedParams.error.issues },
      ),
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
    const data = readPageInputSchema.parse(rest ?? {})
    const page = await repository.getPageForAgent(
      data.slug,
      PAGE_ROW_PREVIEW_LIMIT,
    )

    if (!page) {
      throw pageSlugNotFound(data.slug)
    }

    const light = stripBodies(page)
    if (data.valueFormat !== 'names') {
      return toolResult({ page: light })
    }
    const members = await membersFor(
      repository,
      page.databases.flatMap((database) => database.properties),
    )
    return toolResult({
      page: {
        ...light,
        databases: light.databases.map((database) =>
          Object.assign({}, database, {
            rows: database.rows.map((row) =>
              withReadableValues(row, database.properties, members),
            ),
          }),
        ),
      },
    })
  }

  if (tool === 'read_database') {
    const data = readDatabaseInputSchema.parse(rest ?? {})
    const where = data.where ?? {}
    const schema =
      Object.keys(where).length > 0 || data.valueFormat === 'names'
        ? await repository.getDatabaseSchema(data.databaseId)
        : null
    const members =
      schema &&
      (data.valueFormat === 'names' || touchesPerson(schema.properties, where))
        ? await repository.listMembers()
        : []
    const conditions = schema
      ? buildRowConditions({
          databaseId: data.databaseId,
          properties: schema.properties,
          where,
          members,
        })
      : []
    const result = await repository.getDatabaseRowsPage(data.databaseId, {
      includeArchived: data.includeArchived ?? false,
      includeBodies: data.includeBodies ?? false,
      limit: data.limit ?? DEFAULT_ROW_LIMIT,
      offset: data.offset ?? 0,
      where: conditions,
    })
    const response = readDatabaseResult(result, data)

    if (data.valueFormat !== 'names') {
      return toolResult(response)
    }
    return toolResult({
      ...response,
      database: {
        ...response.database,
        rows: response.database.rows.map((row) =>
          withReadableValues(row, result.database.properties, members),
        ),
      },
    })
  }

  if (tool === 'read_row') {
    const data = readRowInputSchema.parse(rest ?? {})
    const row = await repository.getRow(data.rowId)

    if (data.valueFormat !== 'names') {
      return toolResult({ row })
    }
    const { properties } = await repository.getDatabaseSchema(row.databaseId)
    const members = await membersFor(repository, properties)
    return toolResult({ row: withReadableValues(row, properties, members) })
  }

  if (tool === 'search_rows') {
    const data = searchRowsInputSchema.parse(rest ?? {})
    const rows = await repository.searchRows({
      query: data.query,
      databaseId: data.databaseId,
      includeArchived: data.includeArchived ?? false,
      limit: data.limit ?? DEFAULT_ROW_SEARCH_LIMIT,
    })

    return toolResult({ rows })
  }

  if (tool === 'list_members') {
    const members = await repository.listMembers()

    return toolResult({ members })
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
    const data = addRowInputSchema.parse(rest ?? {})
    const values = await normalizeValuesFor(
      repository,
      data.databaseId,
      data.values ?? {},
    )
    const row = await repository.addRow({ databaseId: data.databaseId, values })

    if (data.body?.trim()) {
      await repository.updateRowBody({ rowId: row.rowId, body: data.body })
    }

    return toolResult({ row: { ...row, values } })
  }

  if (tool === 'update_row') {
    const data = updateRowInputSchema.parse(rest ?? {})
    const current = await repository.getRow(data.rowId)
    const values = await normalizeValuesFor(
      repository,
      current.databaseId,
      data.values,
    )
    const { version } = await repository.updateRow({
      rowId: data.rowId,
      values,
      expectedVersion: data.expectedVersion,
    })

    return toolResult({ row: { rowId: data.rowId, values, version } })
  }

  if (tool === 'archive_row' || tool === 'unarchive_row') {
    const data = archiveRowInputSchema.parse(rest ?? {})
    const result = await repository.setRowsArchived({
      rowIds: [...(data.rowId ? [data.rowId] : []), ...(data.rowIds ?? [])],
      archived: tool === 'archive_row',
    })

    return toolResult(result)
  }

  if (tool === 'update_row_body') {
    const data = updateRowBodySchema.parse(rest ?? {})
    const result = await repository.updateRowBody(data)

    return toolResult(result)
  }

  if (tool === 'delete_row') {
    const data = deleteRowSchema.parse(rest ?? {})
    const result = await repository.deleteRow(data)

    return toolResult(result)
  }

  if (tool === 'add_database_property') {
    const data = addPropertySchema.parse(rest ?? {})
    const result = await repository.addProperty(data)

    return toolResult(result)
  }

  if (tool === 'add_database_option') {
    const data = addPropertyOptionSchema.parse(rest ?? {})
    const result = await repository.addPropertyOption(data)

    return toolResult(result)
  }

  if (tool === 'update_database_option') {
    const data = updatePropertyOptionSchema.parse(rest ?? {})
    const result = await repository.updatePropertyOption(data)

    return toolResult(result)
  }

  if (tool === 'remove_database_option') {
    const data = deletePropertyOptionSchema.parse(rest ?? {})
    const result = await repository.deletePropertyOption(data)

    return toolResult(result)
  }

  if (tool === 'upload_asset') {
    const data = uploadAssetInputSchema.parse(rest ?? {})
    const upload = await prepareAssetUpload(data)
    const asset = await repository.uploadAsset(upload)
    const alt = asset.fileName.replace(/\.[^.]+$/, '')

    return toolResult({
      asset,
      path: asset.path,
      markdown: `![${alt}](${asset.path})`,
    })
  }

  if (tool === 'update_database_property') {
    const data = updatePropertySchema.parse(rest ?? {})
    const result = await repository.updateProperty(data)

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
    const page = await repository.getPageById(data.pageId)
    if (!page) {
      throw new WorkspaceRepositoryError(
        'page_not_found',
        `Page "${data.pageId}" was not found in this workspace.`,
      )
    }
    const property = page.properties.find((p) => p.id === data.propertyId)
    if (!property) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        `Property "${data.propertyId}" is not attached to page "${page.id}". Attached: ${
          page.properties.map((p) => `"${p.name}" (${p.id})`).join(', ') ||
          '(none)'
        }. Attach it with attach_page_property.`,
      )
    }
    const value = normalizeCellValue(property, data.value, {
      members: property.type === 'person' ? await repository.listMembers() : [],
      addOptionHint: `Add it first with add_property_option (pageId "${page.id}", propertyId "${property.id}").`,
    })
    const result = await repository.setPagePropertyValue({ ...data, value })

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
  const page = await repository.getPageForAgent(slug, PAGE_ROW_PREVIEW_LIMIT)

  if (!page) {
    throw pageSlugNotFound(slug)
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(stripBodies(page)),
      },
    ],
  }
}

// --- Response shaping ----------------------------------------------------

function pageSlugNotFound(slug: string) {
  return new WorkspaceRepositoryError(
    'page_not_found',
    `Page with slug "${slug}" was not found in this workspace (use search_pages to find slugs).`,
  )
}

/** A row without its (possibly long) Markdown body; `hasBody` stays. */
function withoutBody<T extends { body: string | null }>(row: T) {
  const { body: _body, ...rest } = row
  return rest
}

/**
 * read_page payload: the repository already limited each database to a
 * preview of non-archived rows with counts; drop the (null) body fields.
 */
function stripBodies(page: AgentPage) {
  return {
    ...page,
    databases: page.databases.map((database) => ({
      ...database,
      rows: database.rows.map(withoutBody),
    })),
  }
}

function readDatabaseResult(
  result: Awaited<ReturnType<McpRepository['getDatabaseRowsPage']>>,
  options: z.infer<typeof readDatabaseInputSchema>,
) {
  const offset = options.offset ?? 0
  const limit = options.limit ?? DEFAULT_ROW_LIMIT
  const returned = result.database.rows.length
  const nextOffset = offset + returned < result.total ? offset + returned : null
  const archivedRowsHidden = options.includeArchived ? 0 : result.archivedCount

  return {
    database: {
      ...result.database,
      rows: options.includeBodies
        ? result.database.rows
        : result.database.rows.map(withoutBody),
    },
    paging: { offset, limit, returned, total: result.total, nextOffset },
    archivedRowsHidden,
    ...(archivedRowsHidden > 0
      ? {
          note: `${archivedRowsHidden} archived row${archivedRowsHidden === 1 ? ' is' : 's are'} hidden; pass includeArchived: true to include them.`,
        }
      : {}),
  }
}

/** Members, loaded only when some column is a person column. */
async function membersFor(
  repository: McpRepository,
  properties: DatabaseProperty[],
): Promise<MemberRef[]> {
  return properties.some((property) => property.type === 'person')
    ? repository.listMembers()
    : []
}

/** True if a values/where map names a person column (by id or name). */
function touchesPerson(
  properties: DatabaseProperty[],
  map: Record<string, unknown>,
): boolean {
  return Object.keys(map).some((key) =>
    properties.some(
      (property) =>
        property.type === 'person' &&
        (property.id === key ||
          property.name.trim().toLowerCase() === key.trim().toLowerCase()),
    ),
  )
}

/** A row with `values` keyed by column name with readable values. */
function withReadableValues<
  T extends {
    values: Record<string, CellValue>
    createdAt: string
    updatedAt: string
  },
>(row: T, properties: DatabaseProperty[], members: MemberRef[]) {
  return {
    ...row,
    values: valuesByName({ properties, row, members }),
  }
}

/**
 * Validate and normalize agent-supplied cell values against the database's
 * columns (names → ids, option names → ids, emails → user ids, ISO dates,
 * multi-link urls). Members are only loaded when a person column is written.
 */
async function normalizeValuesFor(
  repository: McpRepository,
  databaseId: string,
  values: Record<string, unknown>,
) {
  const schema = await repository.getDatabaseSchema(databaseId)
  const members: MemberRef[] = touchesPerson(schema.properties, values)
    ? await repository.listMembers()
    : []

  return normalizeRowValues({
    databaseId,
    properties: schema.properties,
    values,
    members,
  })
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

function toolResult(structuredContent?: unknown): McpToolResult {
  // Mutations that have nothing useful to return resolve to an empty result
  // (no content, no structuredContent) rather than a filler { ok: true }.
  if (structuredContent === undefined) {
    return { content: [], structuredContent: undefined }
  }
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
            error.code === 'option_not_found' ||
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

  if (error instanceof CellValueError) {
    return {
      status: 400,
      rpcCode: -32602,
      code: 'invalid_input',
      message: error.message,
      data: null,
    }
  }

  if (error instanceof ZodError) {
    // Spell the problems out in the message: many clients only show that.
    const details = error.issues
      .map((issue) =>
        issue.path.length > 0
          ? `${issue.path.join('.')}: ${issue.message}`
          : issue.message,
      )
      .join('; ')
    return {
      status: 400,
      rpcCode: -32602,
      code: 'invalid_input',
      message: `Invalid MCP tool input: ${details}`,
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
